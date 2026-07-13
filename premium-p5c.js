/**
 * ══════════════════════════════════════════════════════════════════════════
 * premium-p5c.js — Studyria Phase 5C v2 UI Integration
 * ══════════════════════════════════════════════════════════════════════════
 *
 * CHANGE FROM v1:
 *   v1 depended on StudyriaPaymentOrderService + membership_payment_orders.
 *   v2 reuses the existing Razorpay checkout pattern (same as buyPDF) but
 *   adds server-side HMAC-SHA256 verification via the verify-membership-payment
 *   edge function. No order table required.
 *
 * FLOW:
 *   1. User clicks a plan button ("Buy Monthly" etc.)
 *   2. Auth check — redirect to login if not authenticated.
 *   3. Fetch plan config from window.MembershipConfig.
 *   4. Load Razorpay SDK on-demand.
 *   5. Open Razorpay checkout modal.
 *   6. On success: POST {razorpayOrderId, razorpayPaymentId, razorpaySignature, planSlug}
 *      to the verify-membership-payment edge function.
 *   7. Edge function verifies HMAC-SHA256 and activates membership.
 *   8. Show success toast and refresh membership status.
 *
 * SAFETY CONTRACT:
 *   ✅ Never activates Premium on its own.
 *   ✅ Always POSTs to server for HMAC verification.
 *   ✅ Never sends price/amount to verify endpoint.
 *   ✅ Never touches PDF reader, Checkout, Wishlist, Library, Auth, Admin.
 *   ✅ No amount is trusted from client — server fetches from DB.
 *   ✅ Namespace: PP5C for all module globals.
 *
 * DEPENDS ON:
 *   - supabase.js (window.supabaseClient)
 *   - js/membership/membership-config.js (window.MembershipConfig)
 *   - js/membership/membership-service.js (window.MembershipService)
 *
 * @module premium-p5c
 * @phase  5C v2
 */

(function () {
  'use strict';

  if (window.PP5C && window.PP5C._phase === '5C-v2') return;

  // ── Constants ──────────────────────────────────────────────────────────
  const RAZORPAY_KEY_ID    = 'rzp_live_SxcnO1cOS2HAJT';
  const RAZORPAY_SDK_URL   = 'https://checkout.razorpay.com/v1/checkout.js';
  const EDGE_FN_BASE       = (window.STUDYRIA_CONFIG || {}).edgeFunctionBaseUrl
                             || 'https://qsdfmgcekdpjdcyqhuhi.supabase.co/functions/v1';
  const VERIFY_ENDPOINT    = `${EDGE_FN_BASE}/verify-membership-payment`;

  // Plan configuration (amounts in INR rupees — displayed to user only; server ignores)
  // Plan configuration (amounts in INR rupees — for display in Razorpay modal only;
  // server ALWAYS fetches authoritative price from membership_plans DB — client amount is ignored).
  // MUST match slug values in membership_plans table.
  // Production DB plans (2026-07-13): monthly (₹149), yearly (₹999)
  const PLAN_CATALOGUE = {
    monthly:   { name: 'Premium Monthly',   amount_inr: 149, slug: 'monthly'  },
    yearly:    { name: 'Premium Yearly',    amount_inr: 999, slug: 'yearly'   },
    // Legacy slugs kept for backward-compat with older buttons (server will reject if not in DB)
    starter:   { name: 'Starter',          amount_inr: 49,  slug: 'starter'  },
    quarterly: { name: 'Premium Quarterly', amount_inr: 249, slug: 'quarterly'},
    biannual:  { name: 'Premium Biannual',  amount_inr: 449, slug: 'biannual' },
    annual:    { name: 'Premium Annual',    amount_inr: 799, slug: 'annual'   },
  };

  // ── Logging ────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    data !== undefined
      ? console.debug('[PP5C:' + fn + ']', msg, data)
      : console.debug('[PP5C:' + fn + ']', msg);
  }
  function _warn(fn, msg, data) {
    console.warn('[PP5C:' + fn + ']', msg, data || '');
  }
  function _error(fn, msg, data) {
    console.error('[PP5C:' + fn + ']', msg, data || '');
  }

  // ── Toast helper ──────────────────────────────────────────────────────
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.info('[PP5C toast]', msg);
  }

  // ── Navigate helper ───────────────────────────────────────────────────
  function _navigate(page) {
    if (typeof window.navigate === 'function') window.navigate(page);
  }

  // ── Button state helpers ───────────────────────────────────────────────
  function _btnLoading(btn) {
    if (!btn) return;
    btn.dataset.p5cOrigText  = btn.textContent;
    btn.dataset.p5cOrigStyle = btn.getAttribute('style') || '';
    btn.disabled             = true;
    btn.textContent          = '⏳ Processing…';
    btn.style.opacity        = '0.7';
    btn.style.cursor         = 'not-allowed';
  }

  function _btnRestore(btn) {
    if (!btn) return;
    btn.disabled     = false;
    btn.textContent  = btn.dataset.p5cOrigText  || btn.textContent;
    btn.setAttribute('style', btn.dataset.p5cOrigStyle || '');
  }

  // ── Button success helpers ─────────────────────────────────────────────
  function _btnSuccess(btn, label) {
    if (!btn) return;
    btn.disabled    = false;
    btn.textContent = label || '✅ Active';
    btn.style.background = 'var(--grad-success, #10b981)';
    btn.style.color      = '#fff';
    btn.style.cursor     = 'default';
  }

  // ── Auth helper ───────────────────────────────────────────────────────
  async function _getAuthToken() {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) throw new Error('Not authenticated');
    return { token: session.access_token, user: session.user };
  }

  // ── Razorpay SDK loader ────────────────────────────────────────────────
  let _sdkLoaded = false;
  function _loadRazorpaySDK() {
    return new Promise((resolve, reject) => {
      if (typeof Razorpay !== 'undefined' || _sdkLoaded) { resolve(); return; }
      const s = document.createElement('script');
      s.src   = RAZORPAY_SDK_URL;
      s.onload  = () => { _sdkLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Razorpay SDK failed to load'));
      document.head.appendChild(s);
    });
  }

  // ── Open Razorpay modal ────────────────────────────────────────────────
  function _openRazorpayModal(params) {
    return new Promise((resolve, reject) => {
      const options = {
        key:         RAZORPAY_KEY_ID,
        amount:      params.amountPaise,   // paise — display only, server ignores
        currency:    'INR',
        name:        'Studyria',
        description: params.planName + ' Membership',
        prefill: {
          email: params.userEmail || '',
          name:  params.userName  || '',
        },
        theme: { color: '#3d8ef8' },
        handler: function (response) {
          resolve({
            razorpayOrderId:   response.razorpay_order_id   || '',
            razorpayPaymentId: response.razorpay_payment_id || '',
            razorpaySignature: response.razorpay_signature  || '',
          });
        },
        modal: {
          ondismiss: function () {
            reject(new Error('PAYMENT_CANCELLED'));
          },
        },
      };
      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        reject(new Error('PAYMENT_FAILED:' + (response.error?.description || 'unknown')));
      });
      rzp.open();
    });
  }

  // ── Verify payment on server ───────────────────────────────────────────
  async function _verifyPaymentOnServer(params) {
    const { token, razorpayOrderId, razorpayPaymentId, razorpaySignature, planSlug } = params;

    _log('verify', 'Sending to edge function:', { orderId: razorpayOrderId, paymentId: razorpayPaymentId, planSlug });

    const res = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        planSlug,
        // NOTE: amount is intentionally NOT sent — server fetches from membership_plans
      }),
    });

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('SERVER_ERROR:Invalid JSON response from verify endpoint');
    }

    if (!res.ok) {
      const code    = data?.error?.code    || 'UNKNOWN_ERROR';
      const message = data?.error?.message || 'Payment verification failed.';
      throw new Error(`${code}:${message}`);
    }

    return data;
  }

  // ── Main checkout flow ────────────────────────────────────────────────
  async function initiateCheckout(planSlug, triggerBtn) {
    _log('initiateCheckout', 'Starting checkout for plan:', planSlug);

    const plan = PLAN_CATALOGUE[planSlug];
    if (!plan) {
      _toast('Unknown plan. Please try again.', 'error');
      _warn('initiateCheckout', 'Unknown planSlug:', planSlug);
      return;
    }

    // ── Loading state ─────────────────────────────────────────────────
    _btnLoading(triggerBtn);

    let token, user;
    try {
      ({ token, user } = await _getAuthToken());
    } catch (e) {
      _btnRestore(triggerBtn);
      _toast('Please log in to purchase a membership.', 'info');
      _navigate('login');
      return;
    }

    try {
      // ── Load Razorpay SDK ─────────────────────────────────────────
      await _loadRazorpaySDK();
      if (typeof Razorpay === 'undefined') {
        throw new Error('Razorpay SDK unavailable');
      }

      // ── Open Razorpay modal ───────────────────────────────────────
      _toast('Opening secure payment…', 'info');
      const paymentResponse = await _openRazorpayModal({
        amountPaise: plan.amount_inr * 100,
        planName:    plan.name,
        userEmail:   user.email || '',
        userName:    user.user_metadata?.full_name || '',
      });

      _log('initiateCheckout', 'Razorpay success callback:', {
        orderId:   paymentResponse.razorpayOrderId,
        paymentId: paymentResponse.razorpayPaymentId,
      });

      // ── Verify on server ──────────────────────────────────────────
      _toast('Verifying payment…', 'info');
      const result = await _verifyPaymentOnServer({
        token,
        razorpayOrderId:   paymentResponse.razorpayOrderId,
        razorpayPaymentId: paymentResponse.razorpayPaymentId,
        razorpaySignature: paymentResponse.razorpaySignature,
        planSlug,
      });

      _log('initiateCheckout', 'Server verify result:', result);

      // ── Success ───────────────────────────────────────────────────
      _btnSuccess(triggerBtn, '✅ Active');
      _toast(`🎉 ${plan.name} activated! Welcome to Premium.`, 'success');

      // Emit custom event for membership UI refresh
      window.dispatchEvent(new CustomEvent('studyria:membership:activated', {
        detail: {
          planSlug:     plan.slug,
          membershipId: result.membershipId,
          expiresAt:    result.expiresAt,
        },
      }));

      // Refresh membership status if service is available
      if (window.MembershipService && typeof window.MembershipService.init === 'function') {
        try { await window.MembershipService.init(); } catch (_) {}
      }

    } catch (e) {
      _btnRestore(triggerBtn);
      const msg = e.message || '';

      if (msg === 'PAYMENT_CANCELLED') {
        _toast('Payment cancelled.', 'info');
      } else if (msg.startsWith('PAYMENT_FAILED')) {
        _toast('Payment failed. Please try again.', 'error');
        _error('initiateCheckout', 'Razorpay payment failed:', msg);
      } else if (msg.startsWith('SIGNATURE_MISMATCH')) {
        _toast('Payment verification failed. Contact support if you were charged.', 'error');
        _error('initiateCheckout', 'HMAC mismatch:', msg);
      } else if (msg.startsWith('DUPLICATE_PAYMENT')) {
        _toast('This payment was already processed. Your membership should be active.', 'info');
      } else {
        _toast('An error occurred. Please try again or contact support.', 'error');
        _error('initiateCheckout', 'Checkout error:', msg);
      }
    }
  }

  // ── Wire plan buttons ─────────────────────────────────────────────────
  function _wirePlanButtons() {
    // Targets buttons with class .prm-plan-btn and data-plan attribute
    const btns = document.querySelectorAll('.prm-plan-btn[data-plan], .prm-plan-btn[data-slug]');
    btns.forEach(function (btn) {
      const planSlug = btn.getAttribute('data-plan') || btn.getAttribute('data-slug');
      if (!planSlug || !PLAN_CATALOGUE[planSlug]) return;

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        initiateCheckout(planSlug, btn);
      });
      _log('wirePlanButtons', 'Wired button for plan:', planSlug);
    });

    // Also wire by index (backward compat with Phase 3 buttons without data-plan)
    const PLAN_ORDER = ['starter', 'monthly', 'quarterly', 'biannual'];
    document.querySelectorAll('.prm-plan-btn:not([data-plan]):not([data-slug])').forEach(function (btn, idx) {
      const slug = PLAN_ORDER[idx];
      if (!slug) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        initiateCheckout(slug, btn);
      });
    });
  }

  // ── Membership activation listener ────────────────────────────────────
  function _listenForActivation() {
    window.addEventListener('studyria:membership:activated', function (e) {
      _log('activation', 'Membership activated event received:', e.detail);
      // Update any premium badge/status in the UI
      const statusEls = document.querySelectorAll('[data-prm-status]');
      statusEls.forEach(function (el) { el.textContent = '👑 Premium'; });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────
  function _init() {
    _wirePlanButtons();
    _listenForActivation();
    _log('init', 'PP5C v2 initialized — no order service dependency');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.PP5C = {
    _phase:           '5C-v2',
    initiateCheckout: initiateCheckout,
  };

})();