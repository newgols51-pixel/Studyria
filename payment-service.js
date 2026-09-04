/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-service.js — Studyria Payment Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Orchestration layer: signature verification helper, SDK loader,
 * Razorpay checkout options builder, and transaction status resolver.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Contains NO order-creation API call.
 * • Contains NO Razorpay popup trigger.
 * • Contains NO membership activation.
 * • Contains NO database write.
 * • verifyPaymentSignature() MUST only be called server-side (Edge Function).
 *   The frontend import provides the helper for SSR / Edge use only.
 * • No Premium unlock. No access control changes.
 *
 * @module payment-service
 */

'use strict';

import {
  RAZORPAY_SDK_URL,
  MERCHANT_NAME,
  MERCHANT_DESCRIPTION,
  DEFAULT_CURRENCY,
  PAYMENT_STATUS,
} from './payment-config.js';

import {
  StudyriaPaymentError,
  SignatureMismatchError,
  SdkLoadError,
  handlePaymentError,
  PaymentErrorCode,
} from './payment-errors.js';

import {
  validateKeyId,
  isValidOrderId,
  isValidPaymentId,
  isValidSignatureFormat,
} from './payment-validator.js';

import {
  rupeesToPaise,
  formatPriceINR,
} from './payment-utils.js';

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Verifies a Razorpay payment signature.
 *
 * ⚠️  SERVER-SIDE ONLY.
 * This function uses the Node.js `crypto` module's HMAC-SHA256.
 * It must be called exclusively inside a Supabase Edge Function or server
 * environment. Calling it in a browser will throw (no `crypto.createHmac`).
 *
 * Razorpay signature formula:
 *   HMAC_SHA256(key=secret, data=`${orderId}|${paymentId}`)
 *
 * @param {object} params
 * @param {string} params.orderId        - Razorpay order_id (order_xxxx).
 * @param {string} params.paymentId      - Razorpay payment_id (pay_xxxx).
 * @param {string} params.signature      - Razorpay razorpay_signature from client callback.
 * @param {string} params.keySecret      - Razorpay key_secret (NEVER expose to client).
 * @returns {Promise<{ valid: true }> | never} Resolves if valid; throws SignatureMismatchError if not.
 * @throws {SignatureMismatchError} On signature mismatch.
 * @throws {StudyriaPaymentError}   On missing/invalid inputs.
 *
 * @example
 * // Inside Supabase Edge Function:
 * await verifyPaymentSignature({
 *   orderId:   req.body.razorpay_order_id,
 *   paymentId: req.body.razorpay_payment_id,
 *   signature: req.body.razorpay_signature,
 *   keySecret: Deno.env.get('RAZORPAY_KEY_SECRET'),
 * });
 */
export async function verifyPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  // ── Input validation ──────────────────────────────────────────────────
  if (!isValidOrderId(orderId)) {
    throw new StudyriaPaymentError(
      `verifyPaymentSignature: invalid orderId "${orderId}".`,
      PaymentErrorCode.SIGNATURE_MISSING,
    );
  }
  if (!isValidPaymentId(paymentId)) {
    throw new StudyriaPaymentError(
      `verifyPaymentSignature: invalid paymentId "${paymentId}".`,
      PaymentErrorCode.SIGNATURE_MISSING,
    );
  }
  if (!isValidSignatureFormat(signature)) {
    throw new StudyriaPaymentError(
      'verifyPaymentSignature: signature must be a 64-char hex string.',
      PaymentErrorCode.SIGNATURE_MISSING,
    );
  }
  if (!keySecret || typeof keySecret !== 'string' || keySecret.length < 10) {
    throw new StudyriaPaymentError(
      'verifyPaymentSignature: keySecret must be a non-empty string.',
      PaymentErrorCode.MISSING_CONFIG,
    );
  }

  // ── HMAC-SHA256 computation ───────────────────────────────────────────
  // Works in both Node.js (crypto.createHmac) and Deno/Edge (SubtleCrypto).
  const message = `${orderId}|${paymentId}`;
  let computedHex;

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      // ── Web Crypto API (Deno / Edge / modern Node ≥ 19) ─────────────
      const enc     = new TextEncoder();
      const keyData = enc.encode(keySecret);
      const msgData = enc.encode(message);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig    = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      computedHex  = Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      // ── Node.js crypto (CommonJS fallback) ──────────────────────────
      // Dynamic require to avoid bundler issues in browser builds
      const nodeCrypto = /** @type {any} */ (
        typeof require !== 'undefined' ? require('crypto') : null
      );
      if (!nodeCrypto) {
        throw new Error('No crypto implementation available in this environment.');
      }
      computedHex = nodeCrypto
        .createHmac('sha256', keySecret)
        .update(message)
        .digest('hex');
    }
  } catch (e) {
    throw new StudyriaPaymentError(
      'HMAC computation failed: ' + (e instanceof Error ? e.message : String(e)),
      PaymentErrorCode.SIGNATURE_MISMATCH,
      e,
    );
  }

  // ── Constant-time comparison to prevent timing attacks ───────────────
  if (!_constantTimeEqual(computedHex, signature)) {
    throw new SignatureMismatchError(
      'Razorpay payment signature does not match. Payment may have been tampered with.',
    );
  }

  return { valid: true };
}

/**
 * Constant-time string equality comparison.
 * Prevents timing-based side-channel attacks on HMAC comparison.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 * @private
 */
function _constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── SDK loader ────────────────────────────────────────────────────────────────

/** @type {Promise<void> | null} In-flight or resolved SDK load promise. */
let _sdkLoadPromise = null;

/**
 * Lazily loads the Razorpay checkout.js SDK from CDN.
 *
 * Safe to call multiple times — subsequent calls return the same promise.
 * The SDK is NOT loaded on module import; it loads only when this function
 * is called (typically just before showing the checkout modal).
 *
 * ⚠️  Browser-only. Throws {@link SdkLoadError} in non-browser environments.
 *
 * @returns {Promise<void>} Resolves when `window.Razorpay` is available.
 * @throws {SdkLoadError} If the script fails to load.
 *
 * @example
 * await loadRazorpaySdk();
 * const rz = new window.Razorpay(options);
 */
export function loadRazorpaySdk() {
  // Already loaded
  if (typeof window !== 'undefined' && window.Razorpay) {
    return Promise.resolve();
  }

  if (_sdkLoadPromise) return _sdkLoadPromise;

  _sdkLoadPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new SdkLoadError('loadRazorpaySdk: document is not available (non-browser environment).'));
      _sdkLoadPromise = null;
      return;
    }

    const script   = document.createElement('script');
    script.src     = RAZORPAY_SDK_URL;
    script.async   = true;
    script.defer   = true;
    script.id      = 'razorpay-sdk';

    script.onload = () => {
      if (typeof window !== 'undefined' && window.Razorpay) {
        resolve();
      } else {
        const err = new SdkLoadError('Razorpay SDK loaded but window.Razorpay is not defined.');
        _sdkLoadPromise = null;
        reject(err);
      }
    };

    script.onerror = (e) => {
      const err = new SdkLoadError('Failed to load Razorpay SDK from CDN.', e);
      _sdkLoadPromise = null;
      // Remove the failed script tag so a future call can retry
      script.remove();
      reject(err);
    };

    document.head.appendChild(script);
  });

  return _sdkLoadPromise;
}

/**
 * Resets the cached SDK load promise.
 * Useful in unit tests or after a failed load attempt.
 */
export function resetSdkLoader() {
  _sdkLoadPromise = null;
}

// ── Checkout options builder ──────────────────────────────────────────────────

/**
 * Builds the Razorpay checkout options object.
 *
 * This is the configuration passed to `new window.Razorpay(options)`.
 * It does NOT open the checkout modal — calling `rz.open()` is the
 * caller's responsibility (Phase 5B, not yet implemented).
 *
 * IMPORTANT: `handler` callback is a stub here. Real payment capture
 * must be verified server-side before any membership is granted.
 *
 * @param {object} params
 * @param {string} params.keyId          - Razorpay public key_id.
 * @param {string} params.orderId        - Razorpay order_id from server.
 * @param {number} params.amountPaise    - Order amount in paise.
 * @param {string} params.planLabel      - Display label for the plan.
 * @param {string} params.userEmail      - Prefill email.
 * @param {string} [params.userName]     - Prefill name.
 * @param {string} [params.userPhone]    - Prefill phone.
 * @param {function} [params.onSuccess]  - Called with Razorpay response on payment success.
 * @param {function} [params.onDismiss]  - Called when user closes the modal.
 * @returns {object} Razorpay checkout options (ready to pass to new window.Razorpay()).
 * @throws {InvalidKeyError} If keyId format is invalid.
 *
 * @example
 * const options = buildCheckoutOptions({
 *   keyId: 'rzp_test_xxx',
 *   orderId: 'order_yyy',
 *   amountPaise: 9900,
 *   planLabel: '🔵 Monthly',
 *   userEmail: 'student@example.com',
 *   onSuccess: (response) => console.log('Payment response:', response),
 * });
 * // Later (Phase 5B): const rz = new window.Razorpay(options); rz.open();
 */
export function buildCheckoutOptions({
  keyId,
  orderId,
  amountPaise,
  planLabel    = 'Studyria Premium',
  userEmail    = '',
  userName     = '',
  userPhone    = '',
  onSuccess    = null,
  onDismiss    = null,
}) {
  // Validate key format
  const keyResult = validateKeyId(keyId);
  if (!keyResult.valid) throw keyResult.error;

  if (!isValidOrderId(orderId)) {
    throw new StudyriaPaymentError(
      `buildCheckoutOptions: invalid orderId "${orderId}".`,
      PaymentErrorCode.ORDER_NOT_FOUND,
    );
  }

  return {
    key:         keyId,
    amount:      amountPaise,
    currency:    DEFAULT_CURRENCY,
    order_id:    orderId,
    name:        MERCHANT_NAME,
    description: `${MERCHANT_DESCRIPTION} — ${planLabel}`,
    image:       'https://studyria.qzz.io/icon-192.png',

    prefill: {
      name:    userName  || '',
      email:   userEmail || '',
      contact: userPhone || '',
    },

    theme: {
      color:        '#930205',
      backdrop_blur: 5,
    },

    modal: {
      confirm_close: true,
      escape:        false, // prevent accidental Esc close
      animation:     true,
      ondismiss: () => {
        if (typeof onDismiss === 'function') {
          onDismiss();
        }
      },
    },

    retry: {
      enabled: true,
      max_count: 3,
    },

    /**
     * ── IMPORTANT ────────────────────────────────────────────────────────
     * This handler receives the Razorpay response AFTER user payment.
     * DO NOT unlock membership here. DO NOT write to Supabase here.
     *
     * The ONLY valid action is to POST the three Razorpay IDs to your
     * server-side Edge Function, which verifies the HMAC signature and
     * then — and only then — updates the membership row.
     *
     * Phase 5B will wire this up to a verifyAndActivate() Edge call.
     * ─────────────────────────────────────────────────────────────────────
     */
    handler: (response) => {
      // response = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
      if (typeof onSuccess === 'function') {
        onSuccess(response);
      }
    },
  };
}

// ── Payment status resolver ───────────────────────────────────────────────────

/**
 * Resolves a Razorpay status string to an internal {@link PAYMENT_STATUS} value.
 *
 * @param {string} rzpStatus - Raw status from Razorpay entity (e.g. 'captured').
 * @returns {string} One of the {@link PAYMENT_STATUS} values.
 *
 * @example
 * resolvePaymentStatus('captured');   // 'captured'
 * resolvePaymentStatus('authorized'); // 'authorized'
 * resolvePaymentStatus('junk');       // 'failed' (safe default)
 */
export function resolvePaymentStatus(rzpStatus) {
  const map = {
    'created':    PAYMENT_STATUS.CREATED,
    'attempted':  PAYMENT_STATUS.ATTEMPTED,
    'authorized': PAYMENT_STATUS.AUTHORIZED,
    'captured':   PAYMENT_STATUS.CAPTURED,
    'failed':     PAYMENT_STATUS.FAILED,
    'refunded':   PAYMENT_STATUS.REFUNDED,
  };
  return map[rzpStatus] ?? PAYMENT_STATUS.FAILED;
}

/**
 * Returns true only when a payment status indicates a successful, capturable payment.
 *
 * @param {string} status - Internal status value from {@link PAYMENT_STATUS}.
 * @returns {boolean}
 */
export function isPaymentSuccessful(status) {
  return status === PAYMENT_STATUS.CAPTURED || status === PAYMENT_STATUS.AUTHORIZED;
}

// ── Safe error wrapper ────────────────────────────────────────────────────────

/**
 * Wraps a payment operation in safe error handling.
 * Re-exports {@link handlePaymentError} for convenience so callers only
 * need one import.
 *
 * @param {unknown} err
 * @returns {{ code: string, userMessage: string, logged: boolean }}
 */
export { handlePaymentError };
