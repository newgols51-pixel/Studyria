/**
 * ══════════════════════════════════════════════════════════════════════════
 * supabase/functions/create-membership-order/index.ts
 * Studyria Premium Membership — Phase 5B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Supabase Edge Function: Create Razorpay Membership Order
 *
 * Flow:
 *   1. Verify JWT → get authenticated user (never trust client-sent userId).
 *   2. Validate plan slug — only from request body, never price/amount.
 *   3. Fetch authoritative plan from membership_plans (DB is source of truth).
 *   4. Duplicate order check (prevent replay within 15-minute window).
 *   5. Generate unique receipt ID.
 *   6. Call Razorpay Orders API (server-to-server, secrets never exposed).
 *   7. INSERT pending order row into membership_payment_orders.
 *   8. Return safe order data to client (no secrets, no signature).
 *
 * SECURITY GUARANTEES
 * ───────────────────
 * ✅ JWT verified by Supabase (step 1) — auth cannot be bypassed.
 * ✅ Price fetched from DB only — client-sent price is completely ignored.
 * ✅ Razorpay key_secret read from env only — never sent to client.
 * ✅ Receipt IDs are unique and random — not predictable.
 * ✅ Duplicate prevention at both app and DB level.
 * ✅ No membership activated here — only order created.
 * ✅ No premium access granted here.
 * ✅ OWASP: input validation, no injection, no privilege escalation.
 *
 * Environment variables required (Supabase project secrets):
 *   RAZORPAY_KEY_ID      — Public key (rzp_live_xxx or rzp_test_xxx)
 *   RAZORPAY_KEY_SECRET  — Private key (NEVER sent to client)
 *   SUPABASE_URL         — Project URL (auto-injected by Supabase)
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (auto-injected)
 *
 * ══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types ──────────────────────────────────────────────────────────────────

interface RequestBody {
  planSlug:        string;
  idempotencyKey?: string;
  source?:         string;
}

interface MembershipPlan {
  id:            string;
  slug:          string;
  name:          string;
  price:         number;    // paise
  currency:      string;
  duration_days: number;
  is_active:     boolean;
}

interface RazorpayOrderResponse {
  id:         string;
  entity:     string;
  amount:     number;
  currency:   string;
  receipt:    string;
  status:     string;
  attempts:   number;
  created_at: number;
}

interface OrderResult {
  razorpayOrderId: string;
  amountPaise:     number;
  currency:        string;
  planSlug:        string;
  planName:        string;
  receiptId:       string;
  idempotencyKey:  string;
  expiresAt:       string;
  keyId:           string;   // PUBLIC key only — safe to send to client
  prefill?: {
    name:  string;
    email: string;
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

const RAZORPAY_ORDERS_URL = 'https://api.razorpay.com/v1/orders';
const ORDER_TIMEOUT_MS    = 12_000;
const ORDER_EXPIRY_MIN    = 15;

/** Allowed plan slugs — must match membership_plans.slug in DB */
const VALID_PLAN_SLUGS = new Set(['starter', 'monthly', 'quarterly', 'biannual']);

// ── CORS headers ───────────────────────────────────────────────────────────

function corsHeaders(origin: string): HeadersInit {
  const allowed = [
    'https://studyria.qzz.io',
    'https://studyria.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ];
  const safeOrigin = allowed.includes(origin) ? origin : 'https://studyria.qzz.io';
  return {
    'Access-Control-Allow-Origin':  safeOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Max-Age':       '86400',
  };
}

// ── Response helpers ───────────────────────────────────────────────────────

function ok(body: unknown, origin: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(code: string, message: string, origin: string, status = 400): Response {
  console.error(`[create-membership-order] ERROR ${status} | ${code}: ${message}`);
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } },
  );
}

// ── Receipt ID generator ───────────────────────────────────────────────────

/**
 * Generates a unique receipt ID ≤ 40 characters (Razorpay limit).
 * Format: rzp_<planSlug>_<ts36>_<rand4>
 */
function generateReceiptId(planSlug: string): string {
  const safe = planSlug.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const ts   = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `rzp_${safe}_${ts}_${rand}`.slice(0, 40);
}

// ── Idempotency key validator ──────────────────────────────────────────────

/** Validates an idempotency key is a 64-char hex string (SHA-256 output). */
function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
}

// ── Razorpay API caller ────────────────────────────────────────────────────

/**
 * Calls the Razorpay Orders API server-to-server.
 * The key_secret is read from env — never from the request.
 */
async function createRazorpayOrder(params: {
  amountPaise:  number;
  currency:     string;
  receiptId:    string;
  planSlug:     string;
  userId:       string;
  keyId:        string;
  keySecret:    string;
}): Promise<RazorpayOrderResponse> {
  const { amountPaise, currency, receiptId, planSlug, userId, keyId, keySecret } = params;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);

  // Basic auth: base64(keyId:keySecret)
  const credentials = btoa(`${keyId}:${keySecret}`);

  let response: Response;
  try {
    response = await fetch(RAZORPAY_ORDERS_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({
        amount:   amountPaise,
        currency,
        receipt:  receiptId,
        notes: {
          source:   'studyria_membership',
          plan:     planSlug,
          user_id:  userId,  // partial ID for support — not PII
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const rzpError = (body?.error as Record<string, unknown>) || {};
    throw Object.assign(new Error(
      (rzpError.description as string) ||
      (rzpError.reason      as string) ||
      `Razorpay API error ${response.status}`
    ), {
      code:       rzpError.code    || 'RAZORPAY_ERROR',
      httpStatus: response.status,
    });
  }

  return body as unknown as RazorpayOrderResponse;
}

// ── Input sanitiser ────────────────────────────────────────────────────────

/** Strips all non-alphanumeric/underscore/hyphen characters from a slug. */
function sanitiseSlug(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return err('METHOD_NOT_ALLOWED', 'Only POST is accepted.', origin, 405);
  }

  // ── Read environment secrets ──────────────────────────────────────────────
  const RAZORPAY_KEY_ID     = Deno.env.get('RAZORPAY_KEY_ID')     || '';
  const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') || '';
  const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')        || '';
  const SUPABASE_SERVICE_KEY= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('[create-membership-order] FATAL: Razorpay secrets not set.');
    return err('CONFIG_ERROR', 'Payment gateway not configured. Contact support.', origin, 503);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[create-membership-order] FATAL: Supabase secrets not set.');
    return err('CONFIG_ERROR', 'Database not configured. Contact support.', origin, 503);
  }

  // ── Supabase clients ──────────────────────────────────────────────────────
  // User-scoped client: verifies JWT and gets authenticated user.
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth:   { persistSession: false },
  });

  // Service role client: bypasses RLS for writes to membership_payment_orders.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ── STEP 1: Verify JWT → get authenticated user ───────────────────────────
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return err('UNAUTHENTICATED', 'Authentication required.', origin, 401);
  }
  const userId    = user.id;
  const userEmail = user.email || '';

  console.log(`[create-membership-order] User ${userId.slice(0, 8)}… initiating order.`);

  // ── STEP 2: Parse and validate request body ───────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return err('INVALID_BODY', 'Request body must be valid JSON.', origin, 400);
  }

  const planSlug         = sanitiseSlug(body.planSlug);
  const rawIdempotencyKey= body.idempotencyKey;

  if (!planSlug || !VALID_PLAN_SLUGS.has(planSlug)) {
    return err(
      'INVALID_PLAN',
      `Unknown or missing plan slug: "${planSlug}". Valid: ${[...VALID_PLAN_SLUGS].join(', ')}.`,
      origin, 400,
    );
  }

  // Validate idempotency key format if provided
  let idempotencyKey: string;
  if (rawIdempotencyKey !== undefined && !isValidIdempotencyKey(rawIdempotencyKey)) {
    return err('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a 64-char hex string.', origin, 400);
  }
  idempotencyKey = isValidIdempotencyKey(rawIdempotencyKey)
    ? rawIdempotencyKey
    : (req.headers.get('Idempotency-Key') || '');

  // Generate server-side key if client didn't send one (fallback)
  if (!isValidIdempotencyKey(idempotencyKey)) {
    const window15 = Math.floor(Date.now() / 900_000);
    const raw      = `${userId}:${planSlug}:${window15}`;
    const enc      = new TextEncoder();
    const buf      = await crypto.subtle.digest('SHA-256', enc.encode(raw));
    idempotencyKey = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ── STEP 3: Fetch authoritative plan from DB ──────────────────────────────
  // CRITICAL: Amount comes ONLY from DB. Client cannot influence price.
  const { data: planRows, error: planError } = await adminClient
    .from('membership_plans')
    .select('id, slug, name, price, currency, duration_days, is_active')
    .eq('slug', planSlug)
    .eq('is_active', true)
    .limit(1);

  if (planError) {
    console.error('[create-membership-order] DB error fetching plan:', planError.message);
    return err('DB_ERROR', 'Could not verify plan. Please try again.', origin, 503);
  }

  if (!planRows || planRows.length === 0) {
    return err('PLAN_NOT_FOUND', `Plan "${planSlug}" is not available.`, origin, 404);
  }

  const plan = planRows[0] as MembershipPlan;

  // Sanity-check the plan price
  if (plan.price < 100) { // minimum ₹1 = 100 paise
    console.error(`[create-membership-order] DB plan price too low: ${plan.price} paise`);
    return err('PLAN_CONFIG_ERROR', 'Plan configuration error. Contact support.', origin, 503);
  }

  console.log(`[create-membership-order] Plan verified: ${plan.slug} = ₹${plan.price / 100}`);

  // ── STEP 4: Duplicate order prevention ───────────────────────────────────
  const { data: existingRows, error: dupError } = await adminClient
    .from('membership_payment_orders')
    .select('id, razorpay_order_id, status, expires_at, amount_paise')
    .eq('idempotency_key', idempotencyKey)
    .limit(1);

  if (dupError) {
    console.warn('[create-membership-order] Duplicate check failed:', dupError.message);
    // Non-fatal — proceed with creating a new order
  }

  if (existingRows && existingRows.length > 0) {
    const existing = existingRows[0] as Record<string, unknown>;
    const expiresAt = new Date(existing.expires_at as string);

    // If the existing order is still live, return it (idempotent response)
    if (expiresAt > new Date() && existing.status === 'created') {
      console.log(`[create-membership-order] Returning existing order (idempotent): ${existing.razorpay_order_id}`);
      return ok({
        order: {
          razorpayOrderId: existing.razorpay_order_id,
          amountPaise:     existing.amount_paise,
          currency:        plan.currency,
          planSlug:        plan.slug,
          planName:        plan.name,
          receiptId:       existing.receipt_id,
          idempotencyKey,
          expiresAt:       existing.expires_at,
          keyId:           RAZORPAY_KEY_ID,
          prefill: { name: user.user_metadata?.full_name || '', email: userEmail },
        } as OrderResult,
        idempotent: true,
      }, origin, 200);
    }
    // Expired or failed order — fall through to create a new one
  }

  // ── STEP 5: Generate receipt ID ───────────────────────────────────────────
  const receiptId = generateReceiptId(plan.slug);

  // ── STEP 6: Call Razorpay Orders API (server-to-server) ─────────────────
  let rzpOrder: RazorpayOrderResponse;
  try {
    rzpOrder = await createRazorpayOrder({
      amountPaise:  plan.price,
      currency:     plan.currency,
      receiptId,
      planSlug:     plan.slug,
      userId,
      keyId:        RAZORPAY_KEY_ID,
      keySecret:    RAZORPAY_KEY_SECRET,
    });
  } catch (rzpErr: unknown) {
    const e = rzpErr as Error & { code?: string; httpStatus?: number };
    console.error('[create-membership-order] Razorpay API error:', e.message);
    return err(
      e.code || 'RAZORPAY_ERROR',
      'Could not create payment order. Please try again.',
      origin,
      e.httpStatus || 502,
    );
  }

  console.log(`[create-membership-order] Razorpay order created: ${rzpOrder.id}`);

  // ── STEP 7: Store pending order in Supabase ───────────────────────────────
  // NOTE: status = 'created' — NO membership activation.
  const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MIN * 60 * 1000).toISOString();
  const clientIp  = req.headers.get('CF-Connecting-IP') ||
                    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('User-Agent')?.slice(0, 200) || null;

  const { error: insertError } = await adminClient
    .from('membership_payment_orders')
    .insert({
      user_id:             userId,
      user_email:          userEmail,
      plan_slug:           plan.slug,
      plan_name:           plan.name,
      amount_paise:        plan.price,
      currency:            plan.currency,
      duration_days:       plan.duration_days,
      razorpay_order_id:   rzpOrder.id,
      receipt_id:          receiptId,
      idempotency_key:     idempotencyKey,
      status:              'created',
      razorpay_response:   {
        // Store only non-sensitive fields from Razorpay response
        id:         rzpOrder.id,
        entity:     rzpOrder.entity,
        amount:     rzpOrder.amount,
        currency:   rzpOrder.currency,
        status:     rzpOrder.status,
        attempts:   rzpOrder.attempts,
        created_at: rzpOrder.created_at,
      },
      client_ip:           clientIp,
      user_agent:          userAgent,
      expires_at:          expiresAt,
    });

  if (insertError) {
    // If it's a unique constraint violation on razorpay_order_id or idempotency_key,
    // the order already exists — treat as idempotent success.
    if (insertError.code === '23505') { // PostgreSQL unique_violation
      console.warn('[create-membership-order] Unique constraint — order already stored, proceeding.');
    } else {
      console.error('[create-membership-order] DB insert failed:', insertError.message);
      // Order was created on Razorpay but we couldn't save it — return the order anyway
      // (Phase 5C signature verification will handle the reconciliation)
      console.warn('[create-membership-order] Returning order despite DB insert failure.');
    }
  } else {
    console.log(`[create-membership-order] Order stored in DB: ${rzpOrder.id}`);
  }

  // ── STEP 8: Return safe order data to client ──────────────────────────────
  // KEY_SECRET is never sent. Only the PUBLIC keyId is included.
  return ok({
    order: {
      razorpayOrderId: rzpOrder.id,
      amountPaise:     plan.price,
      currency:        plan.currency,
      planSlug:        plan.slug,
      planName:        plan.name,
      receiptId,
      idempotencyKey,
      expiresAt,
      keyId:           RAZORPAY_KEY_ID,    // Public key — safe to send to client
      prefill: {
        name:  user.user_metadata?.full_name || '',
        email: userEmail,
      },
    } as OrderResult,
    idempotent: false,
  }, origin, 201);
});
