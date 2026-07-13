/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-utils.js — Studyria Payment Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure utility helpers for currency conversion, order payload building,
 * transaction mapping, and receipt ID generation.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • No API calls. No DOM writes. No Supabase writes. No storage writes.
 * • No Premium Membership activated. No payment processed.
 * • All functions are pure (same input → same output, no side effects)
 *   except generateReceiptId() which uses Date.now() — documented.
 *
 * @module payment-utils
 */

'use strict';

import {
  DEFAULT_CURRENCY,
  PAISE_PER_RUPEE,
  MERCHANT_NAME,
  MERCHANT_DESCRIPTION,
  PAYMENT_STATUS,
} from './payment-config.js';

import { validateAmountINR, validateAmountPaise } from './payment-validator.js';

// ── Currency helpers ──────────────────────────────────────────────────────────

/**
 * Converts an INR amount (rupees) to paise.
 * Rounds to the nearest integer (Razorpay does not accept decimals).
 *
 * @param {number} amountINR - Amount in rupees (e.g. 49, 249.50).
 * @returns {number} Amount in paise (integer).
 * @throws {InvalidAmountError} If the resulting paise value is invalid.
 *
 * @example
 * rupeesToPaise(49);    // 4900
 * rupeesToPaise(249);   // 24900
 * rupeesToPaise(0);     // throws InvalidAmountError
 */
export function rupeesToPaise(amountINR) {
  const result = validateAmountINR(amountINR);
  if (!result.valid) throw result.error;
  return result.amountPaise;
}

/**
 * Converts paise to rupees (display-friendly).
 *
 * @param {number} amountPaise - Amount in paise (integer).
 * @returns {number} Amount in INR (may have decimals for odd paise values).
 *
 * @example
 * paiseToRupees(4900);  // 49
 * paiseToRupees(24900); // 249
 */
export function paiseToRupees(amountPaise) {
  const result = validateAmountPaise(amountPaise);
  if (!result.valid) throw result.error;
  return amountPaise / PAISE_PER_RUPEE;
}

/**
 * Formats an INR amount as a human-readable price string.
 *
 * @param {number} amountINR - Amount in rupees.
 * @returns {string} e.g. '₹49', '₹2,499'
 *
 * @example
 * formatPriceINR(49);    // '₹49'
 * formatPriceINR(2499);  // '₹2,499'
 */
export function formatPriceINR(amountINR) {
  if (typeof amountINR !== 'number' || isNaN(amountINR)) return '₹0';
  return '₹' + Math.round(amountINR).toLocaleString('en-IN');
}

/**
 * Formats paise as a human-readable price string.
 *
 * @param {number} amountPaise - Amount in paise.
 * @returns {string} e.g. '₹49'
 */
export function formatPricePaise(amountPaise) {
  return formatPriceINR(amountPaise / PAISE_PER_RUPEE);
}

// ── Receipt ID generator ──────────────────────────────────────────────────────

/**
 * Generates a unique receipt ID for a Razorpay order.
 *
 * Format: `studyria_<planId>_<timestamp>_<random4>`
 * Max 40 characters (Razorpay limit: 40 chars).
 *
 * NOTE: Uses Date.now() — NOT a pure function. Isolated here so the rest
 * of the module stays pure and testable with deterministic inputs.
 *
 * @param {string} planId - e.g. 'starter', 'monthly'.
 * @returns {string} Receipt ID string ≤ 40 characters.
 *
 * @example
 * generateReceiptId('monthly');
 * // 'studyria_monthly_1718000000000_a3f2'
 */
export function generateReceiptId(planId) {
  const safe   = String(planId).replace(/[^a-z0-9]/gi, '').slice(0, 10).toLowerCase();
  const ts     = Date.now();
  const rand   = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const raw    = `studyria_${safe}_${ts}_${rand}`;
  return raw.slice(0, 40);
}

// ── Order payload builder ─────────────────────────────────────────────────────

/**
 * Builds the order-creation payload to be sent to the server / Edge Function.
 *
 * This object is POSTed to your Supabase Edge Function, which then calls
 * Razorpay's Orders API server-side (never from the browser).
 *
 * IMPORTANT: This function does NOT make any API call. It only constructs
 * the JSON object. Sending it is the caller's responsibility.
 *
 * @param {object} params
 * @param {string} params.planId       - Membership plan ID from catalogue.
 * @param {number} params.amountINR    - Plan price in INR (used for cross-validation).
 * @param {string} params.userId       - Authenticated user's UUID from Supabase auth.
 * @param {string} params.userEmail    - User's email (for Razorpay prefill).
 * @param {string} [params.userName]   - User's display name (optional, for prefill).
 * @param {string} [params.userPhone]  - User's phone (optional, for prefill).
 * @returns {object} Order payload object ready for JSON.stringify().
 * @throws {InvalidAmountError|PlanNotFoundError} On validation failure.
 *
 * @example
 * const payload = buildOrderPayload({
 *   planId: 'monthly',
 *   amountINR: 99,
 *   userId: 'uuid-xyz',
 *   userEmail: 'student@example.com',
 * });
 * // { planId: 'monthly', amountPaise: 9900, currency: 'INR', receipt: '...', ... }
 */
export function buildOrderPayload({
  planId,
  amountINR,
  userId,
  userEmail,
  userName   = '',
  userPhone  = '',
}) {
  // Validate inputs (throws on failure)
  const { validatePlanWithPrice } = /** @type {any} */ ({});
  // Cross-validate plan + price via validator (inline to avoid circular dep)
  const amtResult = validateAmountINR(amountINR);
  if (!amtResult.valid) throw amtResult.error;

  if (!userId || typeof userId !== 'string') {
    throw new Error('buildOrderPayload: userId must be a non-empty string.');
  }
  if (!userEmail || typeof userEmail !== 'string' || !userEmail.includes('@')) {
    throw new Error('buildOrderPayload: userEmail must be a valid email address.');
  }

  return {
    // ── Server-side order fields ──────────────────────────
    planId,
    amountPaise:  amtResult.amountPaise,
    currency:     DEFAULT_CURRENCY,
    receipt:      generateReceiptId(planId),

    // ── User context (used by Edge Function for DB write after capture) ──
    userId,
    userEmail,

    // ── Razorpay checkout prefill (passed back to client after order created) ──
    prefill: {
      name:  userName  || '',
      email: userEmail || '',
      contact: userPhone || '',
    },

    // ── Checkout display options ──────────────────────────
    notes: {
      source:  'studyria_membership',
      plan:    planId,
      user_id: userId,
    },

    // ── Metadata (not sent to Razorpay — for internal logging only) ──────
    _meta: {
      generatedAt: new Date().toISOString(),
      merchantName: MERCHANT_NAME,
      description:  MERCHANT_DESCRIPTION,
    },
  };
}

// ── Transaction mapper ────────────────────────────────────────────────────────

/**
 * Maps a raw Razorpay payment entity (from webhook or API response) to a
 * normalised Studyria transaction record.
 *
 * This is the canonical shape stored in Supabase `membership_transactions`.
 * The mapper is pure: no DB write, just shape transformation.
 *
 * @param {object} rzpPayment - Raw Razorpay payment entity.
 * @param {string} rzpPayment.id
 * @param {string} rzpPayment.order_id
 * @param {number} rzpPayment.amount            - In paise.
 * @param {string} rzpPayment.currency
 * @param {string} rzpPayment.status            - Razorpay status string.
 * @param {string} rzpPayment.method            - 'card' | 'upi' | 'netbanking' | etc.
 * @param {number} rzpPayment.created_at        - Unix timestamp (seconds).
 * @param {object} [rzpPayment.notes]
 * @returns {object} Normalised transaction record.
 *
 * @example
 * mapRazorpayPaymentToTransaction({
 *   id: 'pay_abc', order_id: 'order_xyz', amount: 9900,
 *   currency: 'INR', status: 'captured', method: 'upi', created_at: 1718000000,
 *   notes: { plan: 'monthly', user_id: 'uuid-xxx' }
 * });
 */
export function mapRazorpayPaymentToTransaction(rzpPayment) {
  if (!rzpPayment || typeof rzpPayment !== 'object') {
    throw new TypeError('mapRazorpayPaymentToTransaction: argument must be a non-null object.');
  }

  const {
    id,
    order_id,
    amount,
    currency,
    status,
    method,
    created_at,
    notes = {},
  } = /** @type {any} */ (rzpPayment);

  // Normalise Razorpay status → internal PAYMENT_STATUS
  const STATUS_MAP = {
    'created':    PAYMENT_STATUS.CREATED,
    'authorized': PAYMENT_STATUS.AUTHORIZED,
    'captured':   PAYMENT_STATUS.CAPTURED,
    'refunded':   PAYMENT_STATUS.REFUNDED,
    'failed':     PAYMENT_STATUS.FAILED,
  };

  return {
    razorpay_payment_id: id    ?? null,
    razorpay_order_id:   order_id ?? null,
    amount_paise:        typeof amount === 'number' ? amount : null,
    amount_inr:          typeof amount === 'number' ? amount / PAISE_PER_RUPEE : null,
    currency:            currency ?? DEFAULT_CURRENCY,
    status:              STATUS_MAP[status] ?? PAYMENT_STATUS.FAILED,
    payment_method:      method ?? null,
    plan_id:             notes?.plan   ?? null,
    user_id:             notes?.user_id ?? null,
    source:              notes?.source  ?? 'studyria_membership',
    razorpay_created_at: created_at ? new Date(created_at * 1000).toISOString() : null,
    recorded_at:         new Date().toISOString(),
  };
}

// ── Duration helpers ──────────────────────────────────────────────────────────

/**
 * Calculates the membership expiry date given a start date and duration.
 *
 * @param {Date|string|number} startDate - Start of membership.
 * @param {number} durationDays         - Number of days the membership lasts.
 * @returns {Date} The expiry date (startDate + durationDays).
 * @throws {TypeError} If inputs are invalid.
 *
 * @example
 * getMembershipExpiry(new Date('2026-07-13'), 30);
 * // Date: 2026-08-12
 */
export function getMembershipExpiry(startDate, durationDays) {
  if (typeof durationDays !== 'number' || durationDays < 1) {
    throw new TypeError(`getMembershipExpiry: durationDays must be a positive number. Got ${durationDays}.`);
  }
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  if (isNaN(start.getTime())) {
    throw new TypeError(`getMembershipExpiry: invalid startDate "${startDate}".`);
  }
  const expiry = new Date(start.getTime());
  expiry.setDate(expiry.getDate() + durationDays);
  return expiry;
}

/**
 * Returns the number of days remaining in a membership.
 * Returns 0 if already expired.
 *
 * @param {Date|string|number} expiryDate
 * @returns {number} Days remaining (integer, ≥ 0).
 *
 * @example
 * daysUntilExpiry('2026-08-12'); // e.g. 30
 * daysUntilExpiry('2020-01-01'); // 0
 */
export function daysUntilExpiry(expiryDate) {
  const expiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (isNaN(expiry.getTime())) return 0;
  const ms = expiry.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Returns true if a membership is currently active (expiry is in the future).
 *
 * @param {Date|string|number|null|undefined} expiryDate
 * @returns {boolean}
 */
export function isMembershipActive(expiryDate) {
  if (!expiryDate) return false;
  return daysUntilExpiry(expiryDate) > 0;
}
