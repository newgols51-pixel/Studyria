/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-checkout-service.js — Studyria Phase 5C
 * ══════════════════════════════════════════════════════════════════════════
 *
 * CLIENT-SIDE checkout orchestrator.
 *
 * Responsibilities:
 *   1. Load the Razorpay SDK on-demand (never pre-loaded globally).
 *   2. Use StudyriaPaymentOrderService (Phase 5B) to create an order via
 *      the Edge Function (server fetches price from DB — client never sends amount).
 *   3. Open the Razorpay checkout modal with the returned order data.
 *   4. On payment success callback: POST to the verify-membership-payment
 *      Edge Function with razorpayOrderId + razorpayPaymentId + razorpaySignature.
 *   5. The server verifies the HMAC-SHA256 signature, marks the order paid,
 *      and activates the membership (INSERT into user_memberships).
 *   6. Emit the result to the UI via callbacks and a CustomEvent.
 *   7. Handle failure / cancel / timeout gracefully — no false positives.
 *   8. Prevent duplicate payments via idempotency key from Phase 5B.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • NEVER activates Premium on the client side.
 * • NEVER trusts the Razorpay success callback as proof of payment.
 * • ALWAYS sends the signature to the server for HMAC-SHA256 verification.
 * • NEVER sends an amount or plan price to the verify endpoint.
 * • NEVER exposes RAZORPAY_KEY_SECRET — only keyId (public) is used here.
 * • SDK is loaded only when a checkout is initiated.
 * • All state machine transitions are validated before proceeding.
 * • Timeout (30s) on the server verification call.
 * • Idempotent: re-calling with the same order returns the cached result.
 *
 * DEPENDS ON (must load before this file):
 *   - supabase.js (sets window.supabaseClient)
 *   - js/membership/payment-order-service.js (Phase 5B)
 *   - js/membership/payment-audit-logger.js  (Phase 5B)
 *
 * EMITS:
 *   window CustomEvent: 'studyria:payment:success'  → { membershipId, planSlug, expiresAt }
 *   window CustomEvent: 'studyria:payment:failed'   → { reason, code }
 *   window CustomEvent: 'studyria:payment:cancelled'→ {}
 *
 * @module payment-checkout-service
 * @phase  5C
 */

'use strict';

(function (root) {
  'use strict';

  // Guard against double-load
  if (root.StudyriaCheckoutService &&
      root.StudyriaCheckoutService._phase === '5C') return;

  // ── Dependency accessors ───────────────────────────────────────────────────
  const _orderSvc = () => root.StudyriaPaymentOrderService;
  const _audit    = () => root.StudyriaPaymentAuditLogger;
  const _sb       = () => root.supabaseClient;
  const _cfg      = () => root.STUDYRIA_CONFIG || {};

  // ── Constants ──────────────────────────────────────────────────────────────
  const SDK_URL              = 'https://checkout.razorpay.com/v1/checkout.js';
  const VERIFY_FN_NAME       = 'verify-membership-payment';
  const VERIFY_TIMEOUT_MS    = 30_000;   // 30 s for the server verification
  const SDK_LOAD_TIMEOUT_MS  = 15_000;   // 15 s SDK load timeout
  const MERCHANT_NAME        = 'Studyria';
  const MERCHANT_DESCRIPTION = 'Premium Membership — Unlimited Handwritten Notes';

  // ── State ──────────────────────────────────────────────────────────────────
  /**
   * Lightweight state machine to prevent concurrent or duplicate checkouts.
   * Possible values: 'idle' | 'loading_sdk' | 'creating_order' | 'awaiting_payment' | 'verifying' | 'done'
   */
  let _state = 'idle';

  // ── Logging ────────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    const tag = '[CheckoutService:' + fn + ']';
    data !== undefined ? console.debug(tag, msg, data) : console.debug(tag, msg);
  }
  function _warn(fn, msg, data) {
    console.warn('[CheckoutService:' + fn + ']', msg, data || '');
  }
  function _error(fn, msg, err) {
    console.error('[CheckoutService:' + fn + ']', msg, err || '');
  }

  // ── Custom events ──────────────────────────────────────────────────────────
  function _emit(name, detail) {
    try {
      root.dispatchEvent(new CustomEvent('studyria:payment:' + name, {
        detail:  detail || {},
        bubbles: false,
      }));
    } catch (e) {
      _warn('_emit', 'CustomEvent dispatch failed:', e);
    }
  }

  // ── State helpers ──────────────────────────────────────────────────────────
  function _setState(s) {
    _log('_setState', _state + ' → ' + s);
    _state = s;
  }
  function _resetState() { _state = 'idle'; }

  // ── Audit helper ───────────────────────────────────────────────────────────
  function _auditLog(event, data) {
    const logger = _audit();
    if (logger && typeof logger.log === 'function') {
      try { logger.log(event, data || {}); } catch (_) {}
    }
  }

  // ── Get user JWT for Authorization header ──────────────────────────────────
  async function _getAccessToken() {
    const client = _sb();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data?.session?.access_token || null;
    } catch {
      return null;
    }
  }

  // ── Edge Function URL resolver ─────────────────────────────────────────────
  function _resolveVerifyUrl() {
    const base = _cfg().edgeFunctionBaseUrl;
    if (base) return base.replace(/\/$/, '') + '/' + VERIFY_FN_NAME;

    // Fallback: derive from supabaseClient's URL (known at runtime)
    const client = _sb();
    if (client) {
      const url = (client && (client.supabaseUrl || client._supabaseUrl)) || '';
      if (url) return url.replace(/\/$/, '') + '/functions/v1/' + VERIFY_FN_NAME;
    }

    // Last resort: env variable
    if (root.SUPABASE_URL) {
      return root.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/' + VERIFY_FN_NAME;
    }

    throw new Error('Cannot resolve Edge Function URL. Set window.STUDYRIA_CONFIG.edgeFunctionBaseUrl.');
  }

  // ── Razorpay SDK loader ────────────────────────────────────────────────────

  /** Tracks the in-progress SDK load promise to avoid double-loading. */
  let _sdkLoadPromise = null;

  /**
   * Loads the Razorpay SDK script on-demand.
   * Skips if already loaded. Resolves when Razorpay is available on window.
   * @returns {Promise<void>}
   */
  function _loadSdk() {
    if (typeof root.Razorpay === 'function') {
      _log('_loadSdk', 'SDK already loaded');
      return Promise.resolve();
    }
    if (_sdkLoadPromise) return _sdkLoadPromise;

    _log('_loadSdk', 'Loading Razorpay SDK from CDN…');
    _auditLog('sdk.load_start', { url: SDK_URL });

    _sdkLoadPromise = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Razorpay SDK load timed out after ' + SDK_LOAD_TIMEOUT_MS + 'ms.'));
      }, SDK_LOAD_TIMEOUT_MS);

      var script = document.createElement('script');
      script.src   = SDK_URL;
      script.async = true;
      script.onload = function () {
        clearTimeout(timer);
        if (typeof root.Razorpay !== 'function') {
          reject(new Error('Razorpay SDK loaded but window.Razorpay is not a function.'));
        } else {
          _log('_loadSdk', '✅ SDK loaded');
          _auditLog('sdk.load_success', {});
          resolve();
        }
        // Clean up load promise after settled
        _sdkLoadPromise = null;
      };
      script.onerror = function (e) {
        clearTimeout(timer);
        _sdkLoadPromise = null;
        _auditLog('sdk.load_failed', { error: 'script.onerror' });
        reject(new Error('Failed to load Razorpay SDK. Check your internet connection.'));
      };

      document.head.appendChild(script);
    });

    return _sdkLoadPromise;
  }

  // ── Server verification call ───────────────────────────────────────────────

  /**
   * POSTs the payment result to the verify-membership-payment Edge Function.
   * The server performs HMAC-SHA256 signature verification and activates
   * the membership ONLY after a valid signature.
   *
   * @param {object} params
   * @param {string} params.razorpayOrderId
   * @param {string} params.razorpayPaymentId
   * @param {string} params.razorpaySignature
   * @param {string} params.token  — user JWT
   * @returns {Promise<object>} — server response body on success
   * @throws {Error} On verification failure or network error
   */
  async function _verifyOnServer(params) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, token } = params;

    const url = _resolveVerifyUrl();
    _log('_verifyOnServer', 'Calling verify endpoint', { url, orderId: razorpayOrderId });

    _auditLog('network.edge_function_call', {
      fn:      VERIFY_FN_NAME,
      orderId: razorpayOrderId,
    });

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, VERIFY_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (fetchErr && fetchErr.name === 'AbortError') {
        _auditLog('network.timeout', { fn: VERIFY_FN_NAME, orderId: razorpayOrderId });
        throw Object.assign(
          new Error('Payment verification timed out. If you were charged, contact support.'),
          { code: 'VERIFY_TIMEOUT' }
        );
      }
      _auditLog('network.edge_function_error', { fn: VERIFY_FN_NAME, error: fetchErr.message });
      throw Object.assign(
        new Error('Network error during payment verification. Please check your connection.'),
        { code: 'NETWORK_ERROR', cause: fetchErr }
      );
    } finally {
      clearTimeout(timer);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw Object.assign(
        new Error('Invalid response from payment server. Please contact support.'),
        { code: 'INVALID_RESPONSE', httpStatus: response.status }
      );
    }

    if (!response.ok) {
      const serverCode = body?.error?.code || 'SERVER_ERROR';
      const serverMsg  = body?.error?.message || ('Server error ' + response.status);
      _auditLog('network.edge_function_error', {
        fn:         VERIFY_FN_NAME,
        httpStatus: response.status,
        code:       serverCode,
      });
      throw Object.assign(new Error(serverMsg), {
        code:       serverCode,
        httpStatus: response.status,
      });
    }

    _auditLog('network.edge_function_success', {
      fn:           VERIFY_FN_NAME,
      orderId:      razorpayOrderId,
      membershipId: body?.membershipId,
    });

    return body;
  }

  // ── Main checkout launcher ─────────────────────────────────────────────────

  /**
   * Initiates the full Razorpay checkout flow for a membership plan.
   *
   * Flow:
   *   1. Check user auth → prevent anonymous checkout.
   *   2. Load Razorpay SDK (cached after first load).
   *   3. Call Phase 5B order service → create order via Edge Function.
   *   4. Open Razorpay modal.
   *   5. On success: POST to verify-membership-payment Edge Function.
   *   6. On success: emit 'studyria:payment:success' + call onSuccess.
   *   7. On failure/cancel: emit event + call handler, clear IDB cache.
   *
   * @param {object} params
   * @param {string} params.planSlug     - 'starter' | 'monthly' | 'quarterly' | 'biannual'
   * @param {function} [params.onSuccess]  - called with { membershipId, planSlug, expiresAt }
   * @param {function} [params.onFailure]  - called with { reason, code }
   * @param {function} [params.onCancel]   - called with {}
   * @param {function} [params.onStateChange] - called with string state name
   * @returns {Promise<void>}
   */
  async function startCheckout(params) {
    const {
      planSlug,
      onSuccess,
      onFailure,
      onCancel,
      onStateChange,
    } = params || {};

    // ── Prevent concurrent checkouts ──────────────────────────────────────
    if (_state !== 'idle' && _state !== 'done') {
      _warn('startCheckout', 'Checkout already in progress:', _state);
      return;
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    function _stateChange(s) {
      _setState(s);
      if (typeof onStateChange === 'function') {
        try { onStateChange(s); } catch (_) {}
      }
    }

    function _fail(reason, code) {
      _error('startCheckout', 'Payment failed:', { reason, code });
      _auditLog('error.generic', { reason, code, planSlug });
      _resetState();
      _emit('failed', { reason, code: code || 'PAYMENT_FAILED' });
      if (typeof onFailure === 'function') {
        try { onFailure({ reason, code }); } catch (_) {}
      }
    }

    function _cancel() {
      _log('startCheckout', 'Payment cancelled by user');
      _resetState();
      _emit('cancelled', {});
      if (typeof onCancel === 'function') {
        try { onCancel({}); } catch (_) {}
      }
    }

    _stateChange('loading_sdk');
    _auditLog('order.initiated', { planSlug });

    // ── 1. Check authentication ────────────────────────────────────────────
    const token = await _getAccessToken();
    if (!token) {
      _fail('You must be logged in to purchase a membership.', 'UNAUTHENTICATED');
      return;
    }

    // ── 2. Load SDK ────────────────────────────────────────────────────────
    try {
      await _loadSdk();
    } catch (sdkErr) {
      _fail(sdkErr.message || 'Failed to load payment SDK.', 'SDK_LOAD_FAILED');
      return;
    }

    // ── 3. Create order via Phase 5B ──────────────────────────────────────
    _stateChange('creating_order');

    const orderSvc = _orderSvc();
    if (!orderSvc || typeof orderSvc.createOrder !== 'function') {
      _fail('Payment system not ready. Please refresh and try again.', 'ORDER_SERVICE_UNAVAILABLE');
      return;
    }

    let order;
    try {
      order = await orderSvc.createOrder(planSlug);
    } catch (orderErr) {
      _fail(
        orderErr.message || 'Failed to create payment order. Please try again.',
        orderErr.code || 'ORDER_CREATION_FAILED'
      );
      return;
    }

    if (!order || !order.razorpayOrderId || !order.keyId) {
      _fail('Incomplete order data from server. Please try again.', 'INCOMPLETE_ORDER');
      return;
    }

    _log('startCheckout', '✅ Order created', {
      orderId:  order.razorpayOrderId,
      planSlug: order.planSlug,
      amount:   order.amountPaise,
    });
    _auditLog('order.created', {
      orderId:  order.razorpayOrderId,
      planSlug: order.planSlug,
    });

    // ── 4. Open Razorpay modal ─────────────────────────────────────────────
    _stateChange('awaiting_payment');

    const rzpOptions = {
      key:         order.keyId,       // PUBLIC key only — safe to pass to SDK
      order_id:    order.razorpayOrderId,
      amount:      order.amountPaise, // only for display — server re-verifies
      currency:    order.currency,
      name:        MERCHANT_NAME,
      description: MERCHANT_DESCRIPTION,
      prefill: {
        name:  (order.prefill && order.prefill.name)  || '',
        email: (order.prefill && order.prefill.email) || '',
      },
      theme: {
        color: '#f59e0b',   // Studyria gold
        backdrop_color: 'rgba(0,0,0,0.6)',
      },
      retry: {
        enabled:  true,
        max_count: 2,
      },
      // ── Payment success callback ─────────────────────────────────────────
      // The Razorpay callback provides the payment ID and signature.
      // We NEVER trust these alone — they MUST be verified server-side.
      handler: async function (response) {
        _log('startCheckout', 'Razorpay handler called', {
          orderId:   response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          hasSig:    !!response.razorpay_signature,
        });

        // Validate response shape before sending to server
        if (!response.razorpay_order_id ||
            !response.razorpay_payment_id ||
            !response.razorpay_signature) {
          _fail(
            'Payment callback data is incomplete. Please contact support.',
            'INCOMPLETE_CALLBACK'
          );
          return;
        }

        _stateChange('verifying');
        _auditLog('signature.attempt', {
          orderId:   response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
        });

        // Get a fresh access token (modal may have taken time)
        const freshToken = await _getAccessToken();
        if (!freshToken) {
          _fail('Session expired during payment. Please log in again.', 'SESSION_EXPIRED');
          return;
        }

        // ── POST to verify-membership-payment Edge Function ──────────────
        let verifyResult;
        try {
          verifyResult = await _verifyOnServer({
            razorpayOrderId:   response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
            token:             freshToken,
          });
        } catch (verifyErr) {
          _fail(
            verifyErr.message || 'Payment verification failed. Contact support if you were charged.',
            verifyErr.code || 'VERIFY_FAILED'
          );
          return;
        }

        if (!verifyResult || !verifyResult.success) {
          _fail(
            'Server did not confirm payment. Contact support if you were charged.',
            'VERIFY_REJECTED'
          );
          return;
        }

        // ── Verified → clear IDB cache + emit success ────────────────────
        try {
          if (order.idempotencyKey && typeof orderSvc.cancelCachedOrder === 'function') {
            await orderSvc.cancelCachedOrder(order.idempotencyKey);
          }
        } catch (_) {}

        _auditLog('signature.success', {
          orderId:      response.razorpay_order_id,
          membershipId: verifyResult.membershipId,
          planSlug:     verifyResult.planSlug,
        });

        _stateChange('done');

        const successPayload = {
          membershipId: verifyResult.membershipId,
          planSlug:     verifyResult.planSlug,
          planName:     verifyResult.planName,
          expiresAt:    verifyResult.expiresAt,
          durationDays: verifyResult.durationDays,
          message:      verifyResult.message,
        };

        _emit('success', successPayload);
        _resetState();

        if (typeof onSuccess === 'function') {
          try { onSuccess(successPayload); } catch (_) {}
        }

        _log('startCheckout', '✅ Membership activated', successPayload);
      },

      // ── Modal dismissed (cancel) ─────────────────────────────────────────
      modal: {
        ondismiss: function () {
          _log('startCheckout', 'Modal dismissed by user');

          // Only cancel if we are still awaiting payment (not verifying)
          if (_state === 'awaiting_payment') {
            // Clear IDB cache so the user can retry
            if (order && order.idempotencyKey && typeof orderSvc.cancelCachedOrder === 'function') {
              orderSvc.cancelCachedOrder(order.idempotencyKey).catch(function (_) {});
            }
            _cancel();
          }
        },
      },
    };

    let rzpInstance;
    try {
      rzpInstance = new root.Razorpay(rzpOptions);
    } catch (initErr) {
      _fail(
        'Failed to initialize payment modal. Please try again.',
        'SDK_INIT_FAILED'
      );
      return;
    }

    // Handle payment_failed event from the Razorpay SDK (separate from modal close)
    rzpInstance.on('payment.failed', function (response) {
      _error('startCheckout', 'payment.failed event:', response.error);
      _auditLog('error.generic', {
        code:        response.error?.code,
        description: response.error?.description,
        planSlug,
        orderId: order.razorpayOrderId,
      });

      // Clear IDB so next attempt generates a fresh order
      if (order && order.idempotencyKey && typeof orderSvc.cancelCachedOrder === 'function') {
        orderSvc.cancelCachedOrder(order.idempotencyKey).catch(function (_) {});
      }

      _fail(
        response.error?.description || 'Payment failed. Please try again.',
        response.error?.code || 'RAZORPAY_PAYMENT_FAILED'
      );
    });

    rzpInstance.open();
    _log('startCheckout', 'Razorpay modal opened', { orderId: order.razorpayOrderId });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  root.StudyriaCheckoutService = Object.freeze({
    _phase:        '5C',

    /** Launch the full checkout flow. See JSDoc above for params. */
    startCheckout,

    /** Preload the Razorpay SDK in the background (optional warm-up). */
    preloadSdk: _loadSdk,

    /** Current state of the checkout state machine. */
    getState: function () { return _state; },

    /** Returns true if a checkout is currently in progress. */
    isActive: function () {
      return _state !== 'idle' && _state !== 'done';
    },
  });

  _log('init', 'StudyriaCheckoutService Phase 5C ready.');

}(typeof self !== 'undefined' ? self : this));
