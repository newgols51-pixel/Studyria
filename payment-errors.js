/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-errors.js — Studyria Payment Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Typed payment error classes and a centralised error handler.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • No API calls. No DOM writes. No side effects.
 * • No Premium Membership activated. No payment processed.
 *
 * @module payment-errors
 */

'use strict';

// ── Error codes ───────────────────────────────────────────────────────────────
export const PaymentErrorCode = Object.freeze({
  // Configuration errors
  INVALID_KEY:              'PAYMENT_INVALID_KEY',
  MISSING_CONFIG:           'PAYMENT_MISSING_CONFIG',

  // Amount / currency validation
  INVALID_AMOUNT:           'PAYMENT_INVALID_AMOUNT',
  AMOUNT_TOO_LOW:           'PAYMENT_AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH:          'PAYMENT_AMOUNT_TOO_HIGH',
  INVALID_CURRENCY:         'PAYMENT_INVALID_CURRENCY',

  // Order errors
  ORDER_CREATION_FAILED:    'PAYMENT_ORDER_CREATION_FAILED',
  ORDER_NOT_FOUND:          'PAYMENT_ORDER_NOT_FOUND',
  ORDER_ALREADY_PAID:       'PAYMENT_ORDER_ALREADY_PAID',

  // Signature / integrity
  SIGNATURE_MISMATCH:       'PAYMENT_SIGNATURE_MISMATCH',
  SIGNATURE_MISSING:        'PAYMENT_SIGNATURE_MISSING',
  PAYLOAD_TAMPERED:         'PAYMENT_PAYLOAD_TAMPERED',

  // Webhook
  WEBHOOK_INVALID_PAYLOAD:  'PAYMENT_WEBHOOK_INVALID_PAYLOAD',
  WEBHOOK_UNKNOWN_EVENT:    'PAYMENT_WEBHOOK_UNKNOWN_EVENT',
  WEBHOOK_SIGNATURE_FAILED: 'PAYMENT_WEBHOOK_SIGNATURE_FAILED',

  // Plan
  PLAN_NOT_FOUND:           'PAYMENT_PLAN_NOT_FOUND',
  PLAN_PRICE_MISMATCH:      'PAYMENT_PLAN_PRICE_MISMATCH',

  // Network / SDK
  SDK_LOAD_FAILED:          'PAYMENT_SDK_LOAD_FAILED',
  NETWORK_ERROR:            'PAYMENT_NETWORK_ERROR',
  TIMEOUT:                  'PAYMENT_TIMEOUT',

  // Generic
  UNKNOWN:                  'PAYMENT_UNKNOWN',
});

// ── Base payment error ────────────────────────────────────────────────────────

/**
 * Base class for all Studyria payment errors.
 *
 * @extends Error
 */
export class StudyriaPaymentError extends Error {
  /**
   * @param {string} message     Human-readable description.
   * @param {string} code        One of {@link PaymentErrorCode}.
   * @param {unknown} [cause]    Original error that triggered this one (optional).
   * @param {object}  [meta]     Arbitrary extra context for logging (optional).
   */
  constructor(message, code = PaymentErrorCode.UNKNOWN, cause = null, meta = {}) {
    super(message);
    this.name    = 'StudyriaPaymentError';
    this.code    = code;
    this.cause   = cause;
    this.meta    = meta;
    this.timestamp = new Date().toISOString();

    // Maintain proper prototype chain in transpiled environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StudyriaPaymentError);
    }
  }

  /** @returns {object} Plain object safe for JSON serialisation / logging. */
  toJSON() {
    return {
      name:      this.name,
      code:      this.code,
      message:   this.message,
      timestamp: this.timestamp,
      meta:      this.meta,
      // Do NOT include stack or cause — avoids leaking internals to client logs
    };
  }
}

// ── Specialised subclasses ────────────────────────────────────────────────────

/** Thrown when Razorpay key_id format is invalid or missing. */
export class InvalidKeyError extends StudyriaPaymentError {
  constructor(message = 'Razorpay key_id is missing or has invalid format.', cause = null) {
    super(message, PaymentErrorCode.INVALID_KEY, cause);
    this.name = 'InvalidKeyError';
  }
}

/** Thrown when an amount fails range or type validation. */
export class InvalidAmountError extends StudyriaPaymentError {
  /**
   * @param {string} message
   * @param {string} code     INVALID_AMOUNT | AMOUNT_TOO_LOW | AMOUNT_TOO_HIGH
   * @param {object} [meta]   e.g. { received: 0, minPaise: 100 }
   */
  constructor(message, code = PaymentErrorCode.INVALID_AMOUNT, meta = {}) {
    super(message, code, null, meta);
    this.name = 'InvalidAmountError';
  }
}

/** Thrown when cryptographic signature verification fails. */
export class SignatureMismatchError extends StudyriaPaymentError {
  constructor(message = 'Razorpay payment signature verification failed.', cause = null) {
    super(message, PaymentErrorCode.SIGNATURE_MISMATCH, cause);
    this.name = 'SignatureMismatchError';
  }
}

/** Thrown when a webhook payload cannot be parsed or is structurally invalid. */
export class WebhookValidationError extends StudyriaPaymentError {
  constructor(message, code = PaymentErrorCode.WEBHOOK_INVALID_PAYLOAD, meta = {}) {
    super(message, code, null, meta);
    this.name = 'WebhookValidationError';
  }
}

/** Thrown when a plan ID is not found in the local catalogue. */
export class PlanNotFoundError extends StudyriaPaymentError {
  constructor(planId) {
    super(
      `Membership plan "${planId}" not found in catalogue.`,
      PaymentErrorCode.PLAN_NOT_FOUND,
      null,
      { planId },
    );
    this.name = 'PlanNotFoundError';
  }
}

/** Thrown when Razorpay JS SDK fails to load from CDN. */
export class SdkLoadError extends StudyriaPaymentError {
  constructor(message = 'Failed to load Razorpay checkout SDK.', cause = null) {
    super(message, PaymentErrorCode.SDK_LOAD_FAILED, cause);
    this.name = 'SdkLoadError';
  }
}

// ── Centralised error handler ─────────────────────────────────────────────────

/**
 * Centralised payment error handler.
 *
 * Logs the error to console (non-PII details only) and returns a safe
 * user-facing message string. Does NOT throw — callers decide whether to
 * surface or swallow the error.
 *
 * @param {unknown} err - The caught error (may be any type).
 * @returns {{ code: string, userMessage: string, logged: boolean }}
 *
 * @example
 * try {
 *   await somePaymentOp();
 * } catch (err) {
 *   const { userMessage } = handlePaymentError(err);
 *   showToast(userMessage, 'error');
 * }
 */
export function handlePaymentError(err) {
  const isKnown = err instanceof StudyriaPaymentError;
  const code    = isKnown ? err.code : PaymentErrorCode.UNKNOWN;

  // Safe console output — no stack traces in production builds
  if (typeof console !== 'undefined') {
    const entry = isKnown ? err.toJSON() : { code, message: String(err) };
    console.warn('[Studyria Payment]', JSON.stringify(entry));
  }

  // Map internal codes → friendly messages
  const USER_MESSAGES = {
    [PaymentErrorCode.INVALID_KEY]:             'Payment configuration error. Please contact support.',
    [PaymentErrorCode.INVALID_AMOUNT]:          'The payment amount is invalid. Please try again.',
    [PaymentErrorCode.AMOUNT_TOO_LOW]:          'The amount is below the minimum allowed.',
    [PaymentErrorCode.AMOUNT_TOO_HIGH]:         'The amount exceeds the maximum allowed.',
    [PaymentErrorCode.INVALID_CURRENCY]:        'Unsupported currency. Only INR is accepted.',
    [PaymentErrorCode.ORDER_CREATION_FAILED]:   'Could not create a payment order. Please try again.',
    [PaymentErrorCode.ORDER_NOT_FOUND]:         'Payment order not found. Please restart the payment.',
    [PaymentErrorCode.ORDER_ALREADY_PAID]:      'This order has already been paid.',
    [PaymentErrorCode.SIGNATURE_MISMATCH]:      'Payment verification failed. Please contact support.',
    [PaymentErrorCode.SIGNATURE_MISSING]:       'Payment response is incomplete. Please contact support.',
    [PaymentErrorCode.PAYLOAD_TAMPERED]:        'Payment data integrity check failed.',
    [PaymentErrorCode.PLAN_NOT_FOUND]:          'Selected membership plan is not available.',
    [PaymentErrorCode.PLAN_PRICE_MISMATCH]:     'Plan price mismatch detected. Please refresh and retry.',
    [PaymentErrorCode.SDK_LOAD_FAILED]:         'Payment system could not load. Please check your connection.',
    [PaymentErrorCode.NETWORK_ERROR]:           'Network error during payment. Please try again.',
    [PaymentErrorCode.TIMEOUT]:                 'Payment request timed out. Please try again.',
    [PaymentErrorCode.UNKNOWN]:                 'An unexpected payment error occurred. Please try again.',
  };

  return {
    code,
    userMessage: USER_MESSAGES[code] ?? USER_MESSAGES[PaymentErrorCode.UNKNOWN],
    logged: true,
  };
}
