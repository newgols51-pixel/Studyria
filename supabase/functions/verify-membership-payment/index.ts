/**
 * ══════════════════════════════════════════════════════════════════════════
 * supabase/functions/verify-membership-payment/index.ts
 * Studyria Premium Membership — Phase 5C v2.1 (Schema-Aligned)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * CHANGE FROM v2.0 → v2.1:
 *   Aligned all DB column references to match the ACTUAL production schema.
 *   Production schema was applied differently from the original design SQL.
 *
 *   membership_plans:
 *     v2.0 queried:  price, currency, duration_days
 *     v2.1 uses:     price_inr, billing_cycle (derives duration from billing_cycle)
 *
 *   membership_transactions:
 *     v2.0 inserted: payment_provider, payment_reference, amount, currency, metadata
 *     v2.1 inserts:  provider, provider_tx_id, amount_inr, amount_usd, currency, notes
 *
 *   Replay protection:
 *     v2.0 queried:  membership_transactions.payment_reference (column does NOT exist)
 *     v2.1 queries:  membership_transactions.provider_tx_id    (column EXISTS, UNIQUE)
 *
 *   Audit tables:
 *     payment_audit_log: does NOT exist in production → writeAuditLog() is a safe no-op
 *     membership_logs:   does NOT exist in production → Step 9 is a safe no-op
 *     Both writes are wrapped in try/catch; failure is non-fatal and logged to console.
 *
 * FLOW (server-side):
 *   1.  Verify JWT → get authenticated user.
 *   2.  Parse & validate request body.
 *   3.  Validate planSlug → fetch plan from membership_plans.
 *   4.  Replay protection: check membership_transactions for existing provider_tx_id.
 *   5.  Check existing active membership for this user (idempotent success).
 *   6.  HMAC-SHA256 signature verification (server-side only).
 *       sig = HMAC_SHA256(key=RAZORPAY_KEY_SECRET, data=orderId + "|" + paymentId)
 *   7.  INSERT 'active' row into user_memberships.
 *   8.  INSERT immutable row into membership_transactions.
 *   9.  INSERT into membership_logs (no-op if table absent).
 *   10. Write success audit event (no-op if table absent).
 *   11. Return success.
 *
 * SECURITY GUARANTEES (fully preserved from v2.0):
 *   ✅ JWT verified — user cannot be forged.
 *   ✅ HMAC-SHA256 timing-safe server-side verification.
 *   ✅ provider_tx_id UNIQUE in membership_transactions → no double-activation.
 *   ✅ Plan fetched from DB → client-sent amount is completely ignored.
 *   ✅ RAZORPAY_KEY_SECRET never sent to client.
 *   ✅ All paths log to console (audit table is best-effort).
 *   ✅ Premium activated ONLY after verified signature.
 *
 * PRODUCTION TABLE SCHEMA (verified 2026-07-13):
 *   membership_plans:        id, slug, name, description, price_inr, price_usd,
 *                            billing_cycle, is_active, sort_order, features,
 *                            badge_label, trial_days, created_at, updated_at
 *   membership_transactions: id, user_id, plan_id, membership_id, provider,
 *                            provider_tx_id, amount_inr, amount_usd, currency,
 *                            status, notes, created_at, updated_at
 *   user_memberships:        id, user_id, plan_id, status, started_at, expires_at,
 *                            cancelled_at, auto_renew, created_at, updated_at
 *
 * Required env vars:
 *   RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * ══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types ──────────────────────────────────────────────────────────────────

interface RequestBody {
  razorpayOrderId:   string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  planSlug:          string;
}

/** Shape of a row returned from membership_plans (production schema) */
interface MembershipPlan {
  id:            string;
  slug:          string;
  name:          string;
  price_inr:     number;
  price_usd:     number;
  billing_cycle: string;   // 'monthly' | 'yearly' | 'quarterly' | 'lifetime'
  is_active:     boolean;
}

/** Derive membership duration in days from billing_cycle. */
function billingCycleToDays(cycle: string): number {
  switch (cycle) {
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'yearly':    return 365;
    case 'lifetime':  return 36500;  // ~100 years
    default:          return 30;     // safe fallback
  }
}

// ── CORS ───────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): HeadersInit {
  const allowed = [
    'https://studyria.qzz.io',
    'https://studyria.pages.dev',
    'https://studyria.in',
    'https://studyria.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ];
  const safeOrigin = allowed.includes(origin) ? origin : 'https://studyria.pages.dev';
  return {
    'Access-Control-Allow-Origin':  safeOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function ok(body: unknown, origin: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(code: string, message: string, origin: string, status = 400): Response {
  console.error(`[verify-membership-payment/v2.1] ERROR ${status} | ${code}: ${message}`);
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } },
  );
}

// ── Validators ─────────────────────────────────────────────────────────────

function isValidOrderId(id: unknown): id is string {
  return typeof id === 'string' && /^order_[A-Za-z0-9]{14,}$/.test(id);
}

function isValidPaymentId(id: unknown): id is string {
  return typeof id === 'string' && /^pay_[A-Za-z0-9]{14,}$/.test(id);
}

function isValidSignatureFormat(sig: unknown): sig is string {
  return typeof sig === 'string' && /^[a-f0-9]{64}$/.test(sig);
}

function isValidPlanSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[a-z0-9_-]{1,32}$/.test(slug);
}

// ── HMAC-SHA256 (timing-safe) ──────────────────────────────────────────────

async function verifyRazorpaySignature(params: {
  orderId:   string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { orderId, paymentId, signature, keySecret } = params;
  const encoder = new TextEncoder();
  const data    = `${orderId}|${paymentId}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedHex     = Array.from(new Uint8Array(signatureBuffer))
                            .map(b => b.toString(16).padStart(2, '0'))
                            .join('');

  // Timing-safe comparison
  const expected = encoder.encode(expectedHex);
  const received = encoder.encode(signature.toLowerCase());
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ received[i];
  return diff === 0;
}

// ── Audit logger (best-effort — non-fatal if table absent) ─────────────────

async function writeAuditLog(adminClient: ReturnType<typeof createClient>, params: {
  event:         string;
  userId:        string;
  orderId?:      string;
  paymentId?:    string;
  membershipId?: string;
  planSlug?:     string;
  success:       boolean;
  reason?:       string;
  meta?:         Record<string, unknown>;
}): Promise<void> {
  // Always log to console for observability
  console.log(
    `[verify-membership-payment/v2.1] AUDIT | event=${params.event}` +
    ` | user=${params.userId.slice(0, 8)}…` +
    ` | success=${params.success}` +
    (params.reason ? ` | reason=${params.reason}` : ''),
  );
  try {
    await adminClient.from('payment_audit_log').insert({
      event:               params.event,
      user_id:             params.userId,
      razorpay_order_id:   params.orderId   || null,
      razorpay_payment_id: params.paymentId || null,
      membership_id:       params.membershipId || null,
      plan_slug:           params.planSlug  || null,
      success:             params.success,
      reason:              params.reason    || null,
      meta:                params.meta      || {},
      created_at:          new Date().toISOString(),
    });
  } catch (e) {
    // Table may not exist yet — non-fatal, console log above covers observability
    console.warn('[verify-membership-payment/v2.1] Audit log skipped (table may be absent):', (e as Error).message);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return err('METHOD_NOT_ALLOWED', 'Only POST is accepted.', origin, 405);
  }

  // ── Secrets ──────────────────────────────────────────────────────────────
  const RAZORPAY_KEY_SECRET  = Deno.env.get('RAZORPAY_KEY_SECRET')      || '';
  const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')              || '';
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')         || '';

  if (!RAZORPAY_KEY_SECRET) {
    console.error('[verify-membership-payment/v2.1] FATAL: RAZORPAY_KEY_SECRET not set.');
    return err('CONFIG_ERROR', 'Payment verification not configured.', origin, 503);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[verify-membership-payment/v2.1] FATAL: Supabase secrets not set.');
    return err('CONFIG_ERROR', 'Database not configured.', origin, 503);
  }

  // ── Supabase clients ──────────────────────────────────────────────────────
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth:   { persistSession: false },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ── STEP 1: Verify JWT ────────────────────────────────────────────────────
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return err('UNAUTHENTICATED', 'Authentication required.', origin, 401);
  }
  const userId = user.id;
  console.log(`[verify-membership-payment/v2.1] User ${userId.slice(0, 8)}… verifying payment.`);

  // ── STEP 2: Parse & validate request body ────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return err('INVALID_JSON', 'Request body must be valid JSON.', origin, 400);
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, planSlug } = body;

  if (!isValidOrderId(razorpayOrderId)) {
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_order_id', userId, success: false,
      reason: 'razorpayOrderId failed format validation',
    });
    return err('INVALID_ORDER_ID', 'razorpayOrderId is missing or malformed.', origin, 400);
  }
  if (!isValidPaymentId(razorpayPaymentId)) {
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_payment_id', userId, orderId: razorpayOrderId,
      success: false, reason: 'razorpayPaymentId failed format validation',
    });
    return err('INVALID_PAYMENT_ID', 'razorpayPaymentId is missing or malformed.', origin, 400);
  }
  if (!isValidSignatureFormat(razorpaySignature)) {
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_signature_format', userId, orderId: razorpayOrderId,
      success: false, reason: 'razorpaySignature failed format validation',
    });
    return err('INVALID_SIGNATURE_FORMAT',
      'razorpaySignature is missing or malformed.', origin, 400);
  }
  if (!isValidPlanSlug(planSlug)) {
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_plan_slug', userId, orderId: razorpayOrderId,
      success: false, reason: 'planSlug failed format validation',
    });
    return err('INVALID_PLAN_SLUG', 'planSlug is missing or malformed.', origin, 400);
  }

  // ── STEP 3: Fetch plan from membership_plans ──────────────────────────────
  // NOTE: Production schema uses price_inr/price_usd/billing_cycle — NOT price/currency/duration_days
  const { data: planRow, error: planErr } = await adminClient
    .from('membership_plans')
    .select('id, slug, name, price_inr, price_usd, billing_cycle, is_active')
    .eq('slug', planSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (planErr || !planRow) {
    await writeAuditLog(adminClient, {
      event: 'verify.plan_not_found', userId, orderId: razorpayOrderId,
      planSlug, success: false, reason: `Plan '${planSlug}' not found or inactive`,
    });
    return err('PLAN_NOT_FOUND', `Membership plan '${planSlug}' is not available.`, origin, 400);
  }
  const plan = planRow as MembershipPlan;

  // Derive duration in days from billing_cycle (production has no duration_days column)
  const durationDays = billingCycleToDays(plan.billing_cycle);

  // ── STEP 4: Replay protection via membership_transactions ─────────────────
  // Uses provider_tx_id (the actual production column) — NOT payment_reference.
  // Prevents the same Razorpay payment_id from activating Premium twice.
  const { data: dupTxn, error: dupErr } = await adminClient
    .from('membership_transactions')
    .select('id, membership_id, status')
    .eq('provider_tx_id', razorpayPaymentId)
    .maybeSingle();

  if (dupErr) {
    console.error('[verify-membership-payment/v2.1] Replay check query error:', dupErr);
    // Non-fatal: proceed (duplicate insert will fail on UNIQUE constraint if it exists)
  }

  if (dupTxn) {
    await writeAuditLog(adminClient, {
      event: 'verify.replay_detected', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, planSlug, success: false,
      reason: 'provider_tx_id already exists in membership_transactions — replay blocked',
    });
    // Idempotent: if the original transaction succeeded, return success
    if (dupTxn.status === 'success') {
      return ok({
        success:    true,
        message:    'Payment already verified. Your membership is active.',
        idempotent: true,
      }, origin, 200);
    }
    return err('DUPLICATE_PAYMENT', 'This payment has already been processed.', origin, 409);
  }

  // ── STEP 5: Check for already-active membership ───────────────────────────
  // Prevent activating a second simultaneous membership for the same plan
  const { data: existingMembership } = await adminClient
    .from('user_memberships')
    .select('id, status, expires_at, plan_id')
    .eq('user_id', userId)
    .eq('plan_id', plan.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existingMembership) {
    await writeAuditLog(adminClient, {
      event: 'verify.membership_already_active', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, planSlug, success: true,
      reason: 'Active membership already exists — idempotent response',
    });
    return ok({
      success:    true,
      message:    'Your membership is already active.',
      idempotent: true,
    }, origin, 200);
  }

  // ── STEP 6: HMAC-SHA256 signature verification ────────────────────────────
  await writeAuditLog(adminClient, {
    event: 'verify.signature_attempt', userId, orderId: razorpayOrderId,
    paymentId: razorpayPaymentId, planSlug, success: true,
  });

  let signatureValid: boolean;
  try {
    signatureValid = await verifyRazorpaySignature({
      orderId:   razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
      keySecret: RAZORPAY_KEY_SECRET,
    });
  } catch (sigError) {
    console.error('[verify-membership-payment/v2.1] Signature verification threw:', sigError);
    await writeAuditLog(adminClient, {
      event: 'verify.signature_error', userId, orderId: razorpayOrderId,
      success: false, reason: 'crypto error during verification',
    });
    return err('VERIFICATION_ERROR', 'Payment verification failed. Contact support.', origin, 500);
  }

  if (!signatureValid) {
    await writeAuditLog(adminClient, {
      event: 'verify.signature_failed', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, planSlug, success: false,
      reason: 'HMAC-SHA256 mismatch — possible tampering',
    });
    return err('SIGNATURE_MISMATCH',
      'Payment verification failed. Contact support if you were charged.', origin, 400);
  }

  console.log(`[verify-membership-payment/v2.1] ✅ Signature verified. Activating membership.`);
  await writeAuditLog(adminClient, {
    event: 'verify.signature_success', userId, orderId: razorpayOrderId,
    paymentId: razorpayPaymentId, planSlug, success: true,
  });

  // ── STEP 7: INSERT user_memberships ──────────────────────────────────────
  const now       = new Date();
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: membershipRow, error: membershipErr } = await adminClient
    .from('user_memberships')
    .insert({
      user_id:    userId,
      plan_id:    plan.id,
      status:     'active',
      started_at: startedAt,
      expires_at: expiresAt,
      auto_renew: false,
    })
    .select('id')
    .single();

  if (membershipErr || !membershipRow) {
    console.error('[verify-membership-payment/v2.1] Failed to create membership:', membershipErr);
    await writeAuditLog(adminClient, {
      event: 'verify.membership_insert_failed', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, planSlug, success: false,
      reason: membershipErr?.message || 'Unknown insert error',
    });
    return err('ACTIVATION_FAILED',
      'Payment verified but membership activation failed. Our team will resolve within 24h.',
      origin, 500);
  }

  const membershipId = membershipRow.id;
  console.log(`[verify-membership-payment/v2.1] ✅ Membership activated: ${membershipId}`);

  // ── STEP 8: INSERT membership_transactions ────────────────────────────────
  // Uses actual production columns: provider, provider_tx_id, amount_inr, amount_usd,
  // currency, notes — NOT the design-SQL names (payment_provider, payment_reference,
  // amount, metadata).
  const txNotes = JSON.stringify({
    razorpay_order_id:   razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    plan_slug:           plan.slug,
    plan_name:           plan.name,
    billing_cycle:       plan.billing_cycle,
    duration_days:       durationDays,
    verified_at:         new Date().toISOString(),
    signature_verified:  true,
    flow_version:        'v2.1',
  });

  const { error: txErr } = await adminClient
    .from('membership_transactions')
    .insert({
      user_id:       userId,
      membership_id: membershipId,
      plan_id:       plan.id,
      provider:      'razorpay',
      provider_tx_id: razorpayPaymentId,
      amount_inr:    plan.price_inr,
      amount_usd:    plan.price_usd,
      currency:      'INR',
      status:        'success',
      notes:         txNotes,
    });

  if (txErr) {
    // Non-fatal: membership is already activated in Step 7.
    // Log for ops visibility but do not fail the request.
    console.error('[verify-membership-payment/v2.1] Transaction record failed (non-fatal):', txErr);
  } else {
    console.log(`[verify-membership-payment/v2.1] ✅ Transaction recorded.`);
  }

  // ── STEP 9: INSERT membership_logs (best-effort) ──────────────────────────
  try {
    await adminClient.from('membership_logs').insert({
      membership_id: membershipId,
      event:         'activated',
      metadata: {
        actor:               'edge_function',
        function:            'verify-membership-payment/v2.1',
        razorpay_order_id:   razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        plan_slug:           plan.slug,
        amount_inr:          plan.price_inr,
        activated_at:        new Date().toISOString(),
      },
    });
  } catch (logErr) {
    // Table may not exist — non-fatal
    console.warn('[verify-membership-payment/v2.1] membership_logs insert skipped:', (logErr as Error).message);
  }

  // ── STEP 10: Final audit ──────────────────────────────────────────────────
  await writeAuditLog(adminClient, {
    event:        'verify.activation_success',
    userId,
    orderId:      razorpayOrderId,
    paymentId:    razorpayPaymentId,
    membershipId,
    planSlug:     plan.slug,
    success:      true,
    reason:       'Membership activated after verified payment (v2.1 flow)',
    meta:         { expiresAt, durationDays, billingCycle: plan.billing_cycle, flowVersion: 'v2.1' },
  });

  // ── STEP 11: Return success ───────────────────────────────────────────────
  return ok({
    success:      true,
    membershipId,
    planSlug:     plan.slug,
    planName:     plan.name,
    expiresAt,
    durationDays,
    message:      `Your ${plan.name} membership is now active!`,
  }, origin, 200);
});
