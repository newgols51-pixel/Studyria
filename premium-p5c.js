/**
 * ══════════════════════════════════════════════════════════════════════════
 * premium-p5c.js — Studyria Phase 5C UI Integration
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Responsibility: Wire the phase-p3 plan card buttons to the checkout
 * service (payment-checkout-service.js). Show loading/success/error states.
 * Refresh membership status after successful payment.
 *
 * SAFETY CONTRACT
 * ───────────────
 * ✅ Never activates Premium on its own — always goes through the server.
 * ✅ Never touches PDF reader, Checkout, Wishlist, Login, Auth, Admin,
 *    Dashboard, Library, Search, Career Hub, or global CSS.
 * ✅ Only modifies the .prm-plan-btn buttons and .prm-plan-coming divs.
 * ✅ No amount or price is sent to any API from this file.
 * ✅ Namespace: p5c-* for new DOM elements; no new global CSS.
 * ✅ All changes are non-destructive and reversible.
 * ✅ Works independently of other premium phases — additive only.
 *
 * DEPENDS ON (must load before this file):
 *   - supabase.js
 *   - js/membership/payment-order-service.js   (Phase 5B)
 *   - js/membership/payment-audit-logger.js    (Phase 5B)
 *   - js/membership/payment-checkout-service.js (Phase 5C)
 *
 * @module premium-p5c
 * @phase  5C
 */

(function () {
  'use strict';

  if (window.PP5C && window.PP5C._phase === '5C') return;

  // ── Plan slug mapping ─────────────────────────────────────────────────────
  // Maps plan card button index to plan slug (order matches index.html #page-premium .prm-plans-grid)
  const PLAN_SLUGS = ['starter', 'monthly', 'quarterly', 'biannual'];

  // ── UI helpers ─────────────────────────────────────────────────────────────

  function _showToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
    } else {
      console.info('[PP5C] Toast:', msg);
    }
  }

  function _navigate(page) {
    if (typeof window.navigate === 'function') {
      window.navigate(page);
    }
  }

  // ── Button state helpers ───────────────────────────────────────────────────

  /**
   * Sets a plan button to loading state (spinner + disabled).
   * Saves original text so it can be restored.
   */
  function _btnLoading(btn) {
    if (!btn) return;
    btn.dataset.p5cOrigText   = btn.textContent;
    btn.dataset.p5cOrigStyle  = btn.getAttribute('style') || '';
    btn.disabled              = true;
    btn.textContent           = '⏳ Processing…';
    btn.style.opacity         = '0.75';
    btn.style.cursor          = 'not-allowed';
  }

  /** Restores a plan button from loading state. */
  function _btnRestore(btn) {
    if (!btn) return;
    btn.disabled     = false;
    btn.textContent  = btn.dataset.p5cOrigText || 'Get Started →';
    btn.setAttribute('style', btn.dataset.p5cOrigStyle || '');
  }

  /** Sets a plan button to a permanent success state. */
  function _btnSuccess(btn) {
    if (!btn) return;
    btn.disabled    = false;
    btn.textContent = '✅ Active — Thank You!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.cursor     = 'default';
  }

  // ── Success overlay ────────────────────────────────────────────────────────

  /**
   * Shows a full-screen success modal overlay after payment verification.
   * Removed automatically after 6 s or on click.
   */
  function _showSuccessOverlay(result) {
    // Remove any existing overlay
    var old = document.getElementById('p5cSuccessOverlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'p5cSuccessOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.82)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'animation:p5cFadeIn 0.3s ease',
    ].join(';');

    var expiresStr = '';
    if (result.expiresAt) {
      try {
        expiresStr = new Date(result.expiresAt).toLocaleDateString('en-IN', {
          year: 'numeric', month: 'short', day: 'numeric'
        });
      } catch (_) {}
    }

    overlay.innerHTML = [
      '<style>',
      '@keyframes p5cFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes p5cPop{from{transform:scale(0.8);opacity:0}to{transform:scale(1);opacity:1}}',
      '.p5c-modal{',
        'background:linear-gradient(135deg,#0f0a1e,#1a0e2d);',
        'border:1px solid rgba(251,191,36,.3);border-radius:24px;',
        'padding:40px 32px;max-width:380px;width:90%;text-align:center;',
        'animation:p5cPop 0.35s cubic-bezier(0.34,1.56,0.64,1);',
        'box-shadow:0 0 60px rgba(251,191,36,.15);',
      '}',
      '.p5c-crown{font-size:3.5rem;display:block;margin-bottom:12px}',
      '.p5c-modal-title{font-size:1.4rem;font-weight:800;',
        'background:linear-gradient(135deg,#fbbf24,#a78bfa);',
        '-webkit-background-clip:text;-webkit-text-fill-color:transparent;',
        'background-clip:text;margin-bottom:8px}',
      '.p5c-modal-sub{font-size:.84rem;color:rgba(200,210,230,.85);line-height:1.6;margin-bottom:20px}',
      '.p5c-modal-detail{font-size:.76rem;color:rgba(160,170,200,.7);margin-bottom:24px}',
      '.p5c-modal-btn{',
        'padding:12px 28px;border-radius:14px;border:none;cursor:pointer;font-weight:700;',
        'background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:.9rem;',
        'transition:transform 0.2s;',
      '}',
      '.p5c-modal-btn:hover{transform:translateY(-2px)}',
      '</style>',
      '<div class="p5c-modal">',
      '  <span class="p5c-crown">👑</span>',
      '  <div class="p5c-modal-title">Welcome to Premium!</div>',
      '  <div class="p5c-modal-sub">',
      '    Your <strong>' + _esc(result.planName || 'Premium') + '</strong> membership',
      '    is now active. Enjoy unlimited access!',
      '  </div>',
      expiresStr ? '<div class="p5c-modal-detail">Active until: ' + _esc(expiresStr) + '</div>' : '',
      '  <button class="p5c-modal-btn" id="p5cSuccessCloseBtn">Start Learning →</button>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);

    function close() {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 320);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    var closeBtn = overlay.querySelector('#p5cSuccessCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    // Auto-dismiss after 8 s
    setTimeout(close, 8000);
  }

  // ── Failure / retry UI ─────────────────────────────────────────────────────

  function _showPaymentError(msg, code) {
    var message = msg || 'Payment failed. Please try again.';

    // Append support link for server-side errors
    if (code === 'VERIFY_TIMEOUT' || code === 'VERIFY_FAILED' || code === 'ACTIVATION_FAILED') {
      message += ' If you were charged, contact support at studyria.qzz.io.';
    }

    _showToast(message, 'error');
  }

  // ── HTML escape ────────────────────────────────────────────────────────────
  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Wire plan card buttons ─────────────────────────────────────────────────

  /**
   * Replaces the "Payment coming soon" text and wires each plan button
   * to initiate a checkout via StudyriaCheckoutService.
   */
  function _wirePlanButtons() {
    var premiumPage = document.getElementById('page-premium');
    if (!premiumPage) {
      console.warn('[PP5C] #page-premium not found — aborting button wiring.');
      return;
    }

    var planCards = premiumPage.querySelectorAll('.prm-plan-card');
    if (!planCards.length) {
      console.warn('[PP5C] No .prm-plan-card elements found.');
      return;
    }

    planCards.forEach(function (card, index) {
      var planSlug = PLAN_SLUGS[index];
      if (!planSlug) return;

      // Remove "Payment coming soon" text
      var comingSoon = card.querySelector('.prm-plan-coming');
      if (comingSoon) comingSoon.style.display = 'none';

      // Wire the plan button
      var btn = card.querySelector('.prm-plan-btn');
      if (!btn) return;

      // Remove Phase 1's scrollToPlans onclick (harmless but clean)
      btn.removeAttribute('onclick');
      btn.setAttribute('data-plan-slug', planSlug);
      btn.setAttribute('data-p5c-wired', 'true');

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _onPlanBtnClick(btn, planSlug);
      });
    });

    console.debug('[PP5C] Wired', planCards.length, 'plan card buttons.');
  }

  // ── Click handler ──────────────────────────────────────────────────────────

  function _onPlanBtnClick(btn, planSlug) {
    // Guard: must be logged in
    if (!window.currentUser) {
      _showToast('Please log in to purchase a membership.', 'info');
      _navigate('login');
      return;
    }

    // Guard: checkout service must be available
    var svc = window.StudyriaCheckoutService;
    if (!svc || typeof svc.startCheckout !== 'function') {
      _showToast('Payment system not ready. Please refresh and try again.', 'error');
      return;
    }

    // Guard: prevent double-click during active checkout
    if (svc.isActive()) {
      _showToast('A checkout is already in progress. Please complete or cancel it.', 'info');
      return;
    }

    _btnLoading(btn);

    svc.startCheckout({
      planSlug: planSlug,

      onStateChange: function (state) {
        // Update button text to reflect current state
        if (state === 'creating_order') {
          btn.textContent = '📦 Creating order…';
        } else if (state === 'awaiting_payment') {
          btn.textContent = '💳 Opening payment…';
          btn.disabled    = false;  // re-enable so user can see it
        } else if (state === 'verifying') {
          btn.textContent = '🔒 Verifying…';
          btn.disabled    = true;
        }
      },

      onSuccess: function (result) {
        _btnSuccess(btn);
        _showSuccessOverlay(result);

        // Refresh membership engine if available
        var engine = window.StudyriaMembershipEngine;
        if (engine && typeof engine.refresh === 'function') {
          engine.refresh().catch(function (_) {});
        }
      },

      onFailure: function (err) {
        _btnRestore(btn);
        _showPaymentError(err.reason, err.code);
      },

      onCancel: function () {
        _btnRestore(btn);
        _showToast('Payment cancelled.', 'info');
      },
    });
  }

  // ── Me page Premium tab — wire the Upgrade Now button ─────────────────────

  /**
   * Called by PP2 after the premium-membership tab panel is rendered
   * so we can wire any Upgrade buttons inside it.
   */
  function _wireMeTabUpgradeBtn() {
    // Wire the pp2-plan-upgrade-btn and pp2MeExploreBtn (navigate to premium page)
    // These are handled by pp2.js already — they call navigate('premium').
    // Nothing additional needed here.
  }

  // ── Listen for payment events (for external consumers) ────────────────────

  window.addEventListener('studyria:payment:success', function (e) {
    console.debug('[PP5C] Payment success event received:', e.detail);
    // Optionally re-render premium page status badge here in a future phase
  });

  window.addEventListener('studyria:payment:failed', function (e) {
    console.debug('[PP5C] Payment failed event received:', e.detail);
  });

  window.addEventListener('studyria:payment:cancelled', function () {
    console.debug('[PP5C] Payment cancelled event received.');
  });

  // ── Boot ───────────────────────────────────────────────────────────────────

  /**
   * Waits for the premium page to be active, then wires buttons.
   * Uses MutationObserver on #page-premium so it works on SPA navigation.
   */
  function _boot() {
    // Also wire on initial load if premium page is already visible
    var premiumPage = document.getElementById('page-premium');
    if (premiumPage) {
      if (premiumPage.classList.contains('active')) {
        _wirePlanButtons();
      }

      // Re-wire on every navigation to #page-premium
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (premiumPage.classList.contains('active')) {
              setTimeout(_wirePlanButtons, 50);
            }
          }
        });
      });
      observer.observe(premiumPage, { attributes: true });
    }

    // Preload the Razorpay SDK in the background on the premium page
    // so it's ready when the user clicks (faster checkout experience)
    var svc = window.StudyriaCheckoutService;
    if (svc && typeof svc.preloadSdk === 'function') {
      setTimeout(function () {
        svc.preloadSdk().catch(function (_) {
          console.debug('[PP5C] SDK preload failed (non-fatal).');
        });
      }, 3000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.PP5C = Object.freeze({
    _phase:            '5C',
    wirePlanButtons:   _wirePlanButtons,
    showSuccessOverlay: _showSuccessOverlay,
  });

  console.debug('[PP5C] Phase 5C UI wiring ready.');

}());
