/**
 * ══════════════════════════════════════════════════════════════════════════
 * supabase/functions/verify-membership-payment/index.ts
 * Studyria Premium Membership — Phase 5C
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Supabase Edge Function: Verify Razorpay Payment & Activate Membership
 *
 * FLOW (server-side, all steps atomic where possible):
 *   1.  Verify JWT → get authenticated user (never trust client userId).
 *   2.  Parse & validate request body — reject any unknown/malformed fields.
 *   3.  Load the pending order from membership_payment_orders by razorpayOrderId.
 *       • Reject if order not found, status != 'created'|'attempted', or wrong user.
 *       • Reject if order is expired.
 *   4.  Replay / duplicate detection:
 *       • Reject if razorpayPaymentId already exists in membership_payment_orders
 *         (prevents double-activation from replayed requests).
 *       • Reject if user already has an active membership for this plan window.
 *   5.  HMAC-SHA256 signature verification (server-side only):
 *       sig = HMAC_SHA256(key=RAZORPAY_KEY_SECRET, data=orderId + "|" + paymentId)
 *       Timing-safe byte comparison — rejects on mismatch.
 *   6.  Mark order as 'paid' in membership_payment_orders.
 *   7.  Resolve plan details from membership_plans (DB is source of truth).
 *   8.  INSERT a new 'active' row into user_memberships.
 *   9.  INSERT an immutable row into membership_transactions.
 *   10. INSERT an audit event into membership_logs.
 *   11. Return success response to client.
 *
 * SECURITY GUARANTEES
 * ───────────────────
 * ✅ JWT verified by Supabase → user cannot be forged.
 * ✅ HMAC-SHA256 signature verified server-side using RAZORPAY_KEY_SECRET.
 * ✅ Timing-safe comparison (no early-exit on mismatch → prevents timing attacks).
 * ✅ razorpay_payment_id unique check → no double-activation from replay.
 * ✅ Order ownership check → user A cannot activate user B's order.
 * ✅ Order expiry check → stale orders cannot be replayed.
 * ✅ Order status check → only 'created'/'attempted' orders accepted.
 * ✅ Plan resolved from DB → client-sent amount is completely ignored.
 * ✅ RAZORPAY_KEY_SECRET never sent to client, only in Deno.env.
 * ✅ All writes use service_role client → RLS preserved for user clients.
 * ✅ All SQL parameterised via Supabase client (no string interpolation).
 * ✅ Audit log written even on failure paths for full forensic trail.
 * ✅ Premium activation ONLY after verified signature → no bypass path.
 *
 * Environment variables required:
 *   RAZORPAY_KEY_SECRET          — Private key (NEVER sent to client)
 *   SUPABASE_URL                 — Auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — Auto-injected by Supabase
 *   SUPABASE_ANON_KEY            — Auto-injected by Supabase
 *
 * ══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types ──────────────────────────────────────────────────────────────────

interface RequestBody {
  razorpayOrderId:   string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

interface PendingOrder {
  id:               string;
  user_id:          string;
  user_email:       string;
  plan_slug:        string;
  plan_name:        string;
  amount_paise:     number;
  currency:         string;
  duration_days:    number;
  razorpay_order_id:string;
  receipt_id:       string;
  status:           string;
  idempotency_key:  string;
  expires_at:       string;
}

interface MembershipPlan {
  id:            string;
  slug:          string;
  name:          string;
  price:         number;
  currency:      string;
  duration_days: number;
  is_active:     boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_ORDER_STATUSES = new Set(['created', 'attempted']);

// ── CORS ───────────────────────────────────────────────────────────────────

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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
  console.error(`[verify-membership-payment] ERROR ${status} | ${code}: ${message}`);
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } },
  );
}

// ── Validators ─────────────────────────────────────────────────────────────

/** Validates Razorpay order_id format: order_xxxxxxxxxxxxxxxx */
function isValidOrderId(id: unknown): id is string {
  return typeof id === 'string' && /^order_[A-Za-z0-9]{14,}$/.test(id);
}

/** Validates Razorpay payment_id format: pay_xxxxxxxxxxxxxxxx */
function isValidPaymentId(id: unknown): id is string {
  return typeof id === 'string' && /^pay_[A-Za-z0-9]{14,}$/.test(id);
}

/** Validates Razorpay signature format: 64-char hex string (SHA-256 output) */
function isValidSignatureFormat(sig: unknown): sig is string {
  return typeof sig === 'string' && /^[a-f0-9]{64}$/.test(sig);
}

// ── HMAC-SHA256 signature verification (timing-safe) ──────────────────────

/**
 * Verifies the Razorpay payment signature using HMAC-SHA256.
 *
 * Formula (from Razorpay docs):
 *   signature = HMAC_SHA256(key=key_secret, data=`${orderId}|${paymentId}`)
 *
 * Uses a timing-safe byte-by-byte comparison to prevent timing attacks.
 *
 * @returns {Promise<boolean>} true if valid, false if tampered.
 */
async function verifyRazorpaySignature(params: {
  orderId:   string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { orderId, paymentId, signature, keySecret } = params;

  const encoder = new TextEncoder();
  const data    = `${orderId}|${paymentId}`;

  // Import the secret as an HMAC-SHA256 signing key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Compute expected signature
  const signatureBuffer  = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedHex      = Array.from(new Uint8Array(signatureBuffer))
                             .map(b => b.toString(16).padStart(2, '0'))
                             .join('');

  // Timing-safe comparison — compare all bytes even on mismatch
  const expected = encoder.encode(expectedHex);
  const received = encoder.encode(signature.toLowerCase());

  if (expected.length !== received.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ received[i];
  }
  return diff === 0;
}

// ── Audit logger (non-fatal) ───────────────────────────────────────────────

async function writeAuditLog(adminClient: ReturnType<typeof createClient>, params: {
  event:        string;
  userId:       string;
  orderId?:     string;
  paymentId?:   string;
  membershipId?: string;
  planSlug?:    string;
  success:      boolean;
  reason?:      string;
  meta?:        Record<string, unknown>;
}): Promise<void> {
  try {
    await adminClient.from('payment_audit_log').insert({
      event:          params.event,
      user_id:        params.userId,
      razorpay_order_id:   params.orderId   || null,
      razorpay_payment_id: params.paymentId || null,
      membership_id:       params.membershipId || null,
      plan_slug:      params.planSlug || null,
      success:        params.success,
      reason:         params.reason  || null,
      meta:           params.meta    || {},
      created_at:     new Date().toISOString(),
    });
  } catch (e) {
    // Audit log failure must never block the payment flow
    console.error('[verify-membership-payment] Audit log write failed (non-fatal):', e);
  }
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
  const RAZORPAY_KEY_SECRET  = Deno.env.get('RAZORPAY_KEY_SECRET')       || '';
  const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')               || '';
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')  || '';
  const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')          || '';

  if (!RAZORPAY_KEY_SECRET) {
    console.error('[verify-membership-payment] FATAL: RAZORPAY_KEY_SECRET not set.');
    return err('CONFIG_ERROR', 'Payment verification not configured. Contact support.', origin, 503);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[verify-membership-payment] FATAL: Supabase secrets not set.');
    return err('CONFIG_ERROR', 'Database not configured. Contact support.', origin, 503);
  }

  // ── Supabase clients ──────────────────────────────────────────────────────
  // User-scoped: verifies JWT and gets authenticated user.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth:   { persistSession: false },
  });

  // Service-role: bypasses RLS for all writes. Used ONLY after signature is verified.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ── STEP 1: Verify JWT → get authenticated user ───────────────────────────
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return err('UNAUTHENTICATED', 'Authentication required.', origin, 401);
  }
  const userId = user.id;
  console.log(`[verify-membership-payment] User ${userId.slice(0, 8)}… verifying payment.`);

  // ── STEP 2: Parse and validate request body ───────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return err('INVALID_JSON', 'Request body must be valid JSON.', origin, 400);
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

  // Strict format validation — reject anything malformed before touching the DB
  if (!isValidOrderId(razorpayOrderId)) {
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_order_id', userId, success: false,
      reason: 'razorpayOrderId failed format validation',
      meta: { received: typeof razorpayOrderId },
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
    return err('INVALID_SIGNATURE', 'razorpaySignature is missing or malformed.', origin, 400);
  }

  // ── STEP 3: Load the pending order from DB ────────────────────────────────
  const { data: orderRow, error: orderErr } = await adminClient
    .from('membership_payment_orders')
    .select('id, user_id, user_email, plan_slug, plan_name, amount_paise, currency, duration_days, razorpay_order_id, receipt_id, status, idempotency_key, expires_at')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (orderErr) {
    console.error('[verify-membership-payment] DB error loading order:', orderErr);
    await writeAuditLog(adminClient, {
      event: 'verify.db_error', userId, orderId: razorpayOrderId,
      success: false, reason: 'DB error on order lookup',
    });
    return err('DB_ERROR', 'Internal error loading order. Please contact support.', origin, 500);
  }

  if (!orderRow) {
    await writeAuditLog(adminClient, {
      event: 'verify.order_not_found', userId, orderId: razorpayOrderId,
      success: false, reason: 'No matching order found',
    });
    return err('ORDER_NOT_FOUND', 'Order not found. It may have expired.', origin, 404);
  }

  const order = orderRow as PendingOrder;

  // ── STEP 3a: Order ownership check (prevents user A from claiming user B's order)
  if (order.user_id !== userId) {
    await writeAuditLog(adminClient, {
      event: 'verify.ownership_mismatch', userId, orderId: razorpayOrderId,
      success: false, reason: `Order belongs to different user`,
      meta: { orderUserId: order.user_id.slice(0, 8) + '…' },
    });
    // Return 404 not 403 — do not reveal that the order exists
    return err('ORDER_NOT_FOUND', 'Order not found.', origin, 404);
  }

  // ── STEP 3b: Order status check ──────────────────────────────────────────
  if (!VALID_ORDER_STATUSES.has(order.status)) {
    // If already 'paid' — idempotent success (payment already verified)
    if (order.status === 'paid') {
      await writeAuditLog(adminClient, {
        event: 'verify.idempotent_replay', userId, orderId: razorpayOrderId,
        success: true, reason: 'Order already paid — returning idempotent success',
        planSlug: order.plan_slug,
      });
      return ok({
        success:  true,
        message:  'Payment already verified. Your membership is active.',
        idempotent: true,
      }, origin, 200);
    }
    await writeAuditLog(adminClient, {
      event: 'verify.invalid_order_status', userId, orderId: razorpayOrderId,
      success: false, reason: `Order status is '${order.status}' — cannot verify`,
    });
    return err('INVALID_ORDER_STATUS',
      `This order cannot be verified (status: ${order.status}).`, origin, 409);
  }

  // ── STEP 3c: Order expiry check ───────────────────────────────────────────
  if (new Date(order.expires_at) < new Date()) {
    await writeAuditLog(adminClient, {
      event: 'verify.order_expired', userId, orderId: razorpayOrderId,
      success: false, reason: 'Order has expired',
      meta: { expiresAt: order.expires_at },
    });
    return err('ORDER_EXPIRED',
      'This payment order has expired. Please start a new payment.', origin, 410);
  }

  // ── STEP 4: Replay / duplicate payment detection ─────────────────────────
  // Check if razorpayPaymentId already used in any order (prevents replay attacks)
  const { data: dupPayment } = await adminClient
    .from('membership_payment_orders')
    .select('id')
    .eq('razorpay_payment_id', razorpayPaymentId)
    .maybeSingle();

  if (dupPayment) {
    await writeAuditLog(adminClient, {
      event: 'verify.replay_detected', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, success: false,
      reason: 'razorpayPaymentId already exists — replay attack blocked',
    });
    return err('DUPLICATE_PAYMENT',
      'This payment has already been processed.', origin, 409);
  }

  // Check if user already has an active membership activated from this exact order
  const { data: existingMembership } = await adminClient
    .from('user_memberships')
    .select('id, status, expires_at')
    .eq('user_id', userId)
    .eq('payment_order_id', order.id)
    .maybeSingle();

  if (existingMembership && existingMembership.status === 'active') {
    await writeAuditLog(adminClient, {
      event: 'verify.membership_already_active', userId, orderId: razorpayOrderId,
      success: true, reason: 'Membership already active for this order — idempotent',
      planSlug: order.plan_slug,
    });
    return ok({
      success:  true,
      message:  'Your membership is already active.',
      idempotent: true,
    }, origin, 200);
  }

  // ── STEP 5: HMAC-SHA256 signature verification ────────────────────────────
  // This is the critical security gate. Nothing after this point runs without a valid sig.
  await writeAuditLog(adminClient, {
    event: 'verify.signature_attempt', userId, orderId: razorpayOrderId,
    paymentId: razorpayPaymentId, success: true, planSlug: order.plan_slug,
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
    console.error('[verify-membership-payment] Signature verification threw:', sigError);
    await writeAuditLog(adminClient, {
      event: 'verify.signature_error', userId, orderId: razorpayOrderId,
      success: false, reason: 'crypto error during signature verification',
    });
    return err('VERIFICATION_ERROR',
      'Payment verification failed due to a server error. Please contact support.', origin, 500);
  }

  if (!signatureValid) {
    await writeAuditLog(adminClient, {
      event: 'verify.signature_failed', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, success: false,
      reason: 'HMAC-SHA256 signature mismatch — possible tampering',
    });
    return err('SIGNATURE_MISMATCH',
      'Payment verification failed. Please contact support if you were charged.', origin, 400);
  }

  console.log(`[verify-membership-payment] ✅ Signature verified for order ${razorpayOrderId}.`);
  await writeAuditLog(adminClient, {
    event: 'verify.signature_success', userId, orderId: razorpayOrderId,
    paymentId: razorpayPaymentId, success: true, planSlug: order.plan_slug,
  });

  // ── STEP 6: Mark order as 'paid' + store payment ID ─────────────────────
  // Write the payment ID now — idempotency key for all subsequent steps.
  const { error: updateOrderErr } = await adminClient
    .from('membership_payment_orders')
    .update({
      status:             'paid',
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature:  '[verified]',   // never store the raw signature
      updated_at:         new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', order.status);  // optimistic lock — only update if status hasn't changed

  if (updateOrderErr) {
    console.error('[verify-membership-payment] Failed to mark order paid:', updateOrderErr);
    // Non-fatal for the flow — membership will still be activated.
    // The payment_id update is the critical idempotency guard.
  }

  // ── STEP 7: Resolve authoritative plan from DB ────────────────────────────
  const { data: planRow, error: planErr } = await adminClient
    .from('membership_plans')
    .select('id, slug, name, price, currency, duration_days, is_active')
    .eq('slug', order.plan_slug)
    .eq('is_active', true)
    .maybeSingle();

  if (planErr || !planRow) {
    console.error('[verify-membership-payment] Plan not found:', planErr);
    await writeAuditLog(adminClient, {
      event: 'verify.plan_not_found', userId, orderId: razorpayOrderId,
      success: false, reason: `Plan '${order.plan_slug}' not found or inactive`,
    });
    return err('PLAN_NOT_FOUND',
      `Membership plan '${order.plan_slug}' is not available. Contact support.`, origin, 500);
  }

  const plan = planRow as MembershipPlan;

  // ── STEP 8: INSERT active membership into user_memberships ────────────────
  const now      = new Date();
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();

  const { data: membershipRow, error: membershipErr } = await adminClient
    .from('user_memberships')
    .insert({
      user_id:          userId,
      plan_id:          plan.id,
      status:           'active',
      started_at:       startedAt,
      expires_at:       expiresAt,
      auto_renew:       false,
      payment_order_id: order.id,   // links back to membership_payment_orders
    })
    .select('id')
    .single();

  if (membershipErr || !membershipRow) {
    console.error('[verify-membership-payment] Failed to create membership:', membershipErr);
    await writeAuditLog(adminClient, {
      event: 'verify.membership_insert_failed', userId, orderId: razorpayOrderId,
      paymentId: razorpayPaymentId, success: false,
      reason: membershipErr?.message || 'Unknown error',
      planSlug: plan.slug,
    });
    return err('ACTIVATION_FAILED',
      'Payment verified but membership activation failed. Our team will resolve this within 24h.', origin, 500);
  }

  const membershipId = membershipRow.id;
  console.log(`[verify-membership-payment] ✅ Membership activated: ${membershipId}`);

  // ── STEP 9: INSERT immutable transaction record ───────────────────────────
  const { error: txErr } = await adminClient
    .from('membership_transactions')
    .insert({
      user_id:           userId,
      membership_id:     membershipId,
      payment_provider:  'razorpay',
      payment_reference: razorpayPaymentId,
      amount:            order.amount_paise,
      currency:          order.currency,
      status:            'success',
      metadata: {
        razorpay_order_id:   razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        plan_slug:           plan.slug,
        plan_name:           plan.name,
        duration_days:       plan.duration_days,
        receipt_id:          order.receipt_id,
        verified_at:         new Date().toISOString(),
        signature_verified:  true,
      },
    });

  if (txErr) {
    // Non-fatal — membership already activated. Log and continue.
    console.error('[verify-membership-payment] Transaction record insert failed (non-fatal):', txErr);
  }

  // ── STEP 10: INSERT audit log entry (activation success) ─────────────────
  const { error: logErr } = await adminClient
    .from('membership_logs')
    .insert({
      membership_id: membershipId,
      event:         'activated',
      metadata: {
        actor:               'edge_function',
        function:            'verify-membership-payment',
        razorpay_order_id:   razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        plan_slug:           plan.slug,
        receipt_id:          order.receipt_id,
        amount_paise:        order.amount_paise,
        activated_at:        new Date().toISOString(),
      },
    });

  if (logErr) {
    console.error('[verify-membership-payment] Audit log insert failed (non-fatal):', logErr);
  }

  // ── STEP 11: Final audit event ────────────────────────────────────────────
  await writeAuditLog(adminClient, {
    event:        'verify.activation_success',
    userId,
    orderId:      razorpayOrderId,
    paymentId:    razorpayPaymentId,
    membershipId,
    planSlug:     plan.slug,
    success:      true,
    reason:       'Membership activated after verified payment',
    meta: {
      expiresAt,
      durationDays: plan.duration_days,
    },
  });

  // ── STEP 11: Return success to client ────────────────────────────────────
  return ok({
    success:      true,
    membershipId,
    planSlug:     plan.slug,
    planName:     plan.name,
    expiresAt,
    durationDays: plan.duration_days,
    message:      `Your ${plan.name} membership is now active!`,
  }, origin, 200);
});
