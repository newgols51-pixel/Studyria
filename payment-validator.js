/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-validator.js — Studyria Payment Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure validation functions for payment inputs.
 * All functions are stateless and have zero side effects.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • No API calls. No DOM writes. No storage writes.
 * • No Premium Membership activated. No payment processed.
 *
 * @module payment-validator
 */

'use strict';

import {
  DEFAULT_CURRENCY,
  PAISE_PER_RUPEE,
  MIN_AMOUNT_PAISE,
  MAX_AMOUNT_PAISE,
  MEMBERSHIP_PLANS,
  RAZORPAY_KEY_PREFIX_LIVE,
  RAZORPAY_KEY_PREFIX_TEST,
  WEBHOOK_EVENTS,
} from './payment-config.js';

import {
  InvalidAmountError,
  InvalidKeyError,
  PlanNotFoundError,
  WebhookValidationError,
  PaymentErrorCode,
} from './payment-errors.js';

// ── Currency validation ───────────────────────────────────────────────────────

/**
 * Returns true if the given currency code is accepted.
 *
 * @param {string} currency - ISO 4217 code, e.g. 'INR'.
 * @returns {boolean}
 *
 * @example
 * isValidCurrency('INR'); // true
 * isValidCurrency('USD'); // false
 */
export function isValidCurrency(currency) {
  return typeof currency === 'string' && currency.trim().toUpperCase() === DEFAULT_CURRENCY;
}

// ── Amount validation ─────────────────────────────────────────────────────────

/**
 * Validates an amount expressed in paise (smallest INR unit).
 *
 * Razorpay expects amounts in paise:
 *   ₹49  → 4900 paise
 *   ₹249 → 24900 paise
 *
 * @param {number} amountPaise - Amount in paise (integer).
 * @returns {{ valid: true } | { valid: false, error: InvalidAmountError }}
 *
 * @example
 * validateAmountPaise(4900);  // { valid: true }
 * validateAmountPaise(0);     // { valid: false, error: InvalidAmountError }
 * validateAmountPaise(50.5);  // { valid: false, error: InvalidAmountError }
 */
export function validateAmountPaise(amountPaise) {
  if (typeof amountPaise !== 'number' || !Number.isInteger(amountPaise) || isNaN(amountPaise)) {
    return {
      valid: false,
      error: new InvalidAmountError(
        `Amount must be a non-negative integer (paise). Received: ${amountPaise}`,
        PaymentErrorCode.INVALID_AMOUNT,
        { received: amountPaise },
      ),
    };
  }
  if (amountPaise < MIN_AMOUNT_PAISE) {
    return {
      valid: false,
      error: new InvalidAmountError(
        `Amount ${amountPaise} paise is below the minimum of ${MIN_AMOUNT_PAISE} paise (₹${MIN_AMOUNT_PAISE / PAISE_PER_RUPEE}).`,
        PaymentErrorCode.AMOUNT_TOO_LOW,
        { received: amountPaise, minPaise: MIN_AMOUNT_PAISE },
      ),
    };
  }
  if (amountPaise > MAX_AMOUNT_PAISE) {
    return {
      valid: false,
      error: new InvalidAmountError(
        `Amount ${amountPaise} paise exceeds the maximum of ${MAX_AMOUNT_PAISE} paise.`,
        PaymentErrorCode.AMOUNT_TOO_HIGH,
        { received: amountPaise, maxPaise: MAX_AMOUNT_PAISE },
      ),
    };
  }
  return { valid: true };
}

/**
 * Validates an amount expressed in INR (rupees).
 * Internally converts to paise and delegates to {@link validateAmountPaise}.
 *
 * @param {number} amountINR - Amount in rupees (e.g. 49, 249).
 * @returns {{ valid: true, amountPaise: number } | { valid: false, error: InvalidAmountError }}
 *
 * @example
 * validateAmountINR(49);   // { valid: true, amountPaise: 4900 }
 * validateAmountINR(0);    // { valid: false, error: ... }
 * validateAmountINR(-1);   // { valid: false, error: ... }
 */
export function validateAmountINR(amountINR) {
  if (typeof amountINR !== 'number' || isNaN(amountINR) || !isFinite(amountINR)) {
    return {
      valid: false,
      error: new InvalidAmountError(
        `amountINR must be a finite number. Received: ${amountINR}`,
        PaymentErrorCode.INVALID_AMOUNT,
        { received: amountINR },
      ),
    };
  }
  const paise  = Math.round(amountINR * PAISE_PER_RUPEE);
  const result = validateAmountPaise(paise);
  if (!result.valid) return result;
  return { valid: true, amountPaise: paise };
}

// ── Key validation ────────────────────────────────────────────────────────────

/**
 * Validates a Razorpay key_id format.
 *
 * Razorpay key_ids follow the pattern:
 *   Live: rzp_live_<alphanumeric>
 *   Test: rzp_test_<alphanumeric>
 *
 * @param {string} keyId - The key_id string to validate.
 * @returns {{ valid: true, mode: 'live'|'test' } | { valid: false, error: InvalidKeyError }}
 *
 * @example
 * validateKeyId('rzp_test_abc123');  // { valid: true, mode: 'test' }
 * validateKeyId('');                 // { valid: false, error: ... }
 */
export function validateKeyId(keyId) {
  if (typeof keyId !== 'string' || !keyId.trim()) {
    return { valid: false, error: new InvalidKeyError('Razorpay key_id must be a non-empty string.') };
  }
  if (keyId.startsWith(RAZORPAY_KEY_PREFIX_LIVE)) {
    return { valid: true, mode: 'live' };
  }
  if (keyId.startsWith(RAZORPAY_KEY_PREFIX_TEST)) {
    return { valid: true, mode: 'test' };
  }
  return {
    valid: false,
    error: new InvalidKeyError(
      `key_id "${keyId.slice(0, 12)}…" does not match expected Razorpay format (rzp_live_* or rzp_test_*).`,
    ),
  };
}

// ── Plan validation ───────────────────────────────────────────────────────────

/**
 * Checks whether a plan ID exists in the membership catalogue.
 *
 * @param {string} planId - e.g. 'starter', 'monthly', 'quarterly', 'biannual'.
 * @returns {{ valid: true, plan: object } | { valid: false, error: PlanNotFoundError }}
 *
 * @example
 * validatePlanId('monthly');   // { valid: true, plan: { id: 'monthly', priceINR: 99, ... } }
 * validatePlanId('unknown');   // { valid: false, error: PlanNotFoundError }
 */
export function validatePlanId(planId) {
  /* Plans are now fetched from database — no hardcoded plan lookup */
  const plan = null;
  if (!plan) {
    return { valid: false, error: new PlanNotFoundError(planId) };
  }
  return { valid: true, plan };
}

/**
 * Cross-validates a plan ID against a claimed price in INR.
 * Prevents price tampering where a client sends a lower amount for a higher plan.
 *
 * @param {string} planId
 * @param {number} claimedPriceINR
 * @returns {{ valid: true, plan: object, amountPaise: number } | { valid: false, error: Error }}
 *
 * @example
 * validatePlanWithPrice('starter', 49);   // { valid: true, ... }
 * validatePlanWithPrice('starter', 1);    // { valid: false, error: ... (mismatch) }
 */
export function validatePlanWithPrice(planId, claimedPriceINR) {
  const planResult = validatePlanId(planId);
  if (!planResult.valid) return planResult;

  const { plan } = planResult;
  if (plan.priceINR !== claimedPriceINR) {
    const { StudyriaPaymentError } = /** @type {any} */ ({ StudyriaPaymentError: null });
    // Import-free inline to avoid circular dep:
    const err = Object.assign(new Error(
      `Plan price mismatch: plan "${planId}" costs ₹${plan.priceINR} but received ₹${claimedPriceINR}.`,
    ), {
      code: PaymentErrorCode.PLAN_PRICE_MISMATCH,
      meta: { planId, expected: plan.priceINR, received: claimedPriceINR },
    });
    return { valid: false, error: err };
  }

  const amountResult = validateAmountINR(plan.priceINR);
  if (!amountResult.valid) return amountResult;

  return { valid: true, plan, amountPaise: amountResult.amountPaise };
}

// ── Webhook payload validation ────────────────────────────────────────────────

/**
 * Validates the structural shape of a Razorpay webhook payload.
 *
 * Does NOT verify the HMAC signature — that is done server-side only.
 * This function checks that the payload has the minimum expected fields
 * so downstream code can safely destructure without crashing.
 *
 * @param {unknown} payload - Parsed webhook JSON body.
 * @returns {{ valid: true, event: string, entityId: string } | { valid: false, error: WebhookValidationError }}
 *
 * @example
 * validateWebhookPayload({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_xxx', order_id: 'order_yyy' } } } });
 * // { valid: true, event: 'payment.captured', entityId: 'pay_xxx' }
 */
export function validateWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      error: new WebhookValidationError(
        'Webhook payload must be a non-null object.',
        PaymentErrorCode.WEBHOOK_INVALID_PAYLOAD,
      ),
    };
  }

  const { event, payload: inner } = /** @type {any} */ (payload);

  if (typeof event !== 'string' || !event.trim()) {
    return {
      valid: false,
      error: new WebhookValidationError(
        'Webhook payload missing required "event" field.',
        PaymentErrorCode.WEBHOOK_INVALID_PAYLOAD,
        { received: event },
      ),
    };
  }

  const knownEvents = new Set(Object.values(WEBHOOK_EVENTS));
  if (!knownEvents.has(event)) {
    return {
      valid: false,
      error: new WebhookValidationError(
        `Unknown webhook event: "${event}".`,
        PaymentErrorCode.WEBHOOK_UNKNOWN_EVENT,
        { event },
      ),
    };
  }

  // Validate inner payload structure
  if (!inner || typeof inner !== 'object') {
    return {
      valid: false,
      error: new WebhookValidationError(
        'Webhook payload.payload must be a non-null object.',
        PaymentErrorCode.WEBHOOK_INVALID_PAYLOAD,
      ),
    };
  }

  // Try to extract entity id from known shapes
  const entityObj =
    inner?.payment?.entity ??
    inner?.order?.entity ??
    inner?.refund?.entity ??
    null;

  if (!entityObj || typeof entityObj !== 'object' || !entityObj.id) {
    return {
      valid: false,
      error: new WebhookValidationError(
        'Webhook payload is missing entity.id.',
        PaymentErrorCode.WEBHOOK_INVALID_PAYLOAD,
        { event },
      ),
    };
  }

  return {
    valid:    true,
    event,
    entityId: entityObj.id,
    orderId:  entityObj.order_id ?? null,
  };
}

// ── Order ID validation ───────────────────────────────────────────────────────

/**
 * Validates a Razorpay order_id format.
 * Razorpay order IDs follow the pattern: order_<alphanumeric>
 *
 * @param {string} orderId
 * @returns {boolean}
 *
 * @example
 * isValidOrderId('order_PfPjS6z9f1vYI1'); // true
 * isValidOrderId('');                      // false
 */
export function isValidOrderId(orderId) {
  return typeof orderId === 'string' && /^order_[A-Za-z0-9]{14,}$/.test(orderId);
}

/**
 * Validates a Razorpay payment_id format.
 * Pattern: pay_<alphanumeric>
 *
 * @param {string} paymentId
 * @returns {boolean}
 */
export function isValidPaymentId(paymentId) {
  return typeof paymentId === 'string' && /^pay_[A-Za-z0-9]{14,}$/.test(paymentId);
}

/**
 * Validates a Razorpay signature string (hex-encoded HMAC-SHA256).
 * Only checks format — cryptographic verification is in payment-service.js.
 *
 * @param {string} signature
 * @returns {boolean}
 */
export function isValidSignatureFormat(signature) {
  return typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature);
}
