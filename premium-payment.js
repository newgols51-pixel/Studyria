/**
 * ══════════════════════════════════════════════════════════════════
 * premium-payment.js — Studyria Premium Membership Payment Flow
 * ══════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE: Follows the EXACT same pattern as buyPDF().
 *
 * FLOW:
 *   1. Auth check → redirect to login if not authenticated
 *   2. Duplicate guard → check membership_transactions.provider_tx_id
 *   3. Check existing active membership → if active, show status or extend
 *   4. Open Razorpay checkout (same key as PDF purchases)
 *   5. On success callback:
 *      a. Replay guard: check provider_tx_id (Razorpay payment_id) in
 *         membership_transactions — skip if already processed
 *      b. Fetch plan details from membership_plans (slug → price_inr, billing_cycle)
 *      c. Compute expires_at: if active membership exists → EXTEND, else NEW
 *      d. UPSERT row in user_memberships
 *      e. INSERT immutable row in membership_transactions (provider_tx_id = payment_id)
 *   6. Show success toast, update UI
 *
 * DB TABLES (production schema verified 2026-07-13):
 *   membership_plans:        id, slug, name, price_inr, billing_cycle, is_active
 *   membership_transactions: id, user_id, plan_id, membership_id, provider,
 *                            provider_tx_id, amount_inr, currency, status, notes
 *   user_memberships:        id, user_id, plan_id, status, started_at, expires_at,
 *                            cancelled_at, auto_renew
 *
 * SAFETY CONTRACT:
 *   ✅ No edge function calls
 *   ✅ No server-side HMAC verification
 *   ✅ Same pattern as buyPDF — direct Supabase client writes
 *   ✅ provider_tx_id (Razorpay payment_id) = replay protection
 *   ✅ provider_tx_id UNIQUE constraint in DB prevents double activation
 *   ✅ Never touches: PDF reader, checkout, wishlist, library, auth, admin
 *   ✅ Namespace: window.PPAY
 *   ✅ monthly → +30 days, yearly → +365 days
 *
 * @module premium-payment
 * @version 1.0
 */

(function () {
  'use strict';

  if (window.PPAY && window.PPAY._version === '1.0') return;  /* idempotent */

  /* ── Config ──────────────────────────────────────────────────── */
  var RZP_KEY     = 'rzp_live_SxcnO1cOS2HAJT';
  var RZP_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

  /* billing_cycle → days (requirement: monthly=30, yearly=365) */
  var CYCLE_DAYS = {
    trial_1day:  1,
    trial_15day: 15,
    monthly:     30,
    quarterly:   90,
    half_year:   180,
    // Legacy aliases (kept for safety — never break existing tx rows)
    starter:     15,
    biannual:    180,
    yearly:      365,
    annual:      365,
    lifetime:    36500,
  };

  /* Plan catalogue — fallback display prices if DB fetch fails.
     Server never trusts these amounts; they are for modal display only. */
  var PLAN_DISPLAY = {
    trial_1day:  { name: '1 Day Trial',       display_inr: 9   },
    trial_15day: { name: '15 Day Trial',      display_inr: 49  },
    monthly:     { name: 'Monthly Premium',   display_inr: 99  },
    quarterly:   { name: 'Quarterly Premium', display_inr: 249 },
    half_year:   { name: 'Half Year Premium', display_inr: 449 },
    // Legacy aliases
    starter:     { name: 'Starter',           display_inr: 49  },
    biannual:    { name: '6 Month',           display_inr: 449 },
    yearly:      { name: 'Yearly',            display_inr: 999 },
  };

  /* ── Logging ─────────────────────────────────────────────────── */
  function _log(fn, msg, d) {
    d !== undefined
      ? console.debug('[PPAY:' + fn + ']', msg, d)
      : console.debug('[PPAY:' + fn + ']', msg);
  }
  function _warn(fn, msg, d) { console.warn('[PPAY:' + fn + ']', msg, d || ''); }
  function _err(fn, msg, d)  { console.error('[PPAY:' + fn + ']', msg, d || ''); }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _sb() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.info('[PPAY toast ' + (type || 'info') + ']', msg);
  }

  function _navigate(page) {
    if (typeof window.navigate === 'function') window.navigate(page);
  }

  function _addDays(dateStr, days) {
    var d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  function _fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  function _cycleDays(billingCycle, planSlugOrTrialDays) {
    /* PRIORITY 1: slug-based lookup (most specific, always correct) */
    if (typeof planSlugOrTrialDays === 'string' && CYCLE_DAYS[planSlugOrTrialDays] > 0) {
      return CYCLE_DAYS[planSlugOrTrialDays];
    }
    /* PRIORITY 2: numeric trial_days from DB */
    if (typeof planSlugOrTrialDays === 'number' && planSlugOrTrialDays > 0) {
      return planSlugOrTrialDays;
    }
    /* PRIORITY 3: billing_cycle lookup */
    if (billingCycle && CYCLE_DAYS[billingCycle]) {
      return CYCLE_DAYS[billingCycle];
    }
    /* PRIORITY 4: lowercase billing_cycle */
    var lcCycle = (billingCycle || '').toLowerCase();
    if (CYCLE_DAYS[lcCycle]) {
      return CYCLE_DAYS[lcCycle];
    }
    /* SAFETY: if we reach here, log it — never silently give wrong duration */
    console.error('[PPAY:_cycleDays] UNKNOWN billing_cycle/slug:', billingCycle, planSlugOrTrialDays,
      '— defaulting to 1 day to prevent wrong expiry. Fix CYCLE_DAYS map.');
    return 1;  /* Safest default: 1 day, not 30 */
  }

  /* ── Razorpay SDK loader ─────────────────────────────────────── */
  var _sdkLoaded = false;
  function _loadSDK() {
    return new Promise(function (resolve, reject) {
      if (typeof Razorpay !== 'undefined' || _sdkLoaded) { resolve(); return; }
      var s    = document.createElement('script');
      s.src    = RZP_SDK_URL;
      s.async  = true;
      s.onload = function () { _sdkLoaded = true; resolve(); };
      s.onerror = function () { reject(new Error('Razorpay SDK failed to load')); };
      document.head.appendChild(s);
    });
  }

  /* ── Button state ─────────────────────────────────────────────── */
  function _btnLoading(btn) {
    if (!btn) return;
    btn.dataset.ppayOrig   = btn.textContent;
    btn.dataset.ppayStyle  = btn.getAttribute('style') || '';
    btn.disabled           = true;
    btn.textContent        = '⏳ Processing…';
    btn.style.opacity      = '0.65';
    btn.style.cursor       = 'not-allowed';
  }
  function _btnRestore(btn) {
    if (!btn) return;
    btn.disabled    = false;
    btn.textContent = btn.dataset.ppayOrig || btn.textContent;
    btn.setAttribute('style', btn.dataset.ppayStyle || '');
  }
  function _btnSuccess(btn) {
    if (!btn) return;
    btn.disabled         = false;
    btn.textContent      = '✅ Premium Active';
    btn.style.background = 'linear-gradient(135deg,#10d98e,#00c8e8)';
    btn.style.color      = '#0a2a1a';
    btn.style.cursor     = 'default';
    btn.style.opacity    = '1';
  }

  /* ── Main checkout function ────────────────────────────────────── */
  /**
   * @param {string} planSlug  - e.g. 'monthly', 'yearly'
   * @param {HTMLElement|null} triggerBtn - button that triggered the purchase
   */
  async function checkout(planSlug, triggerBtn) {
    _log('checkout', 'Starting checkout for plan:', planSlug);

    /* ── 1. Auth check ──────────────────────────────────────────── */
    var client = _sb();
    if (!client) {
      _toast('Service unavailable. Please refresh the page.', 'error');
      return;
    }

    var user = null;
    try {
      var authRes = await client.auth.getUser();
      user = authRes.data && authRes.data.user;
    } catch (e) {
      _warn('checkout', 'Auth error:', e);
    }

    if (!user) {
      _toast('Please log in to purchase a membership.', 'info');
      _navigate('login');
      return;
    }

    _btnLoading(triggerBtn);

    try {
      /* ── 2. Fetch plan from DB (price_inr, billing_cycle) ──────── */
      var plan = null;
      try {
        var planRes = await client
          .from('membership_plans')
          .select('id, slug, name, price_inr, billing_cycle, is_active, trial_days')
          .eq('slug', planSlug)
          .eq('is_active', true)
          .maybeSingle();

        if (planRes.error) {
          _warn('checkout', 'DB plan fetch error (using fallback):', planRes.error.message);
        }
        plan = planRes.data;
      } catch (e) {
        _warn('checkout', 'Plan fetch exception (using fallback):', e);
      }

      /* Fallback to display config if DB unavailable */
      if (!plan) {
        var fb = PLAN_DISPLAY[planSlug];
        if (!fb) {
          _toast('Plan not found. Please try again.', 'error');
          _btnRestore(triggerBtn);
          return;
        }
        plan = {
          id:            null,
          slug:          planSlug,
          name:          fb.name,
          price_inr:     fb.display_inr,
          billing_cycle: planSlug,
          is_active:     true,
        };
        _warn('checkout', 'Using fallback plan (DB unavailable):', plan);
      }

      var durationDays = _cycleDays(plan.billing_cycle, plan.trial_days || planSlug);
      _log('checkout', 'Expiry calculation:', {
        slug: planSlug, billing_cycle: plan.billing_cycle,
        trial_days: plan.trial_days, durationDays: durationDays,
      });

      /* GUARD: plan.id must be a valid UUID — null causes NOT NULL violation in DB */
      if (!plan.id) {
        _err('checkout', 'Plan ID is null — plan "' + planSlug + '" not found in membership_plans DB table.');
        _toast(
          '⚠️ Plan "' + planSlug + '" is not yet activated in the database. ' +
          'Please contact support or try again shortly.',
          'error'
        );
        _btnRestore(triggerBtn);
        return;
      }
      _log('checkout', 'Plan resolved:', { slug: planSlug, price_inr: plan.price_inr, days: durationDays });

      /* ── 3. Check existing active membership ──────────────────── */
      var existingMembership = null;
      try {
        var memRes = await client
          .from('user_memberships')
          .select('id, plan_id, status, expires_at')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!memRes.error) existingMembership = memRes.data;
      } catch (e) {
        _warn('checkout', 'Active membership check exception:', e);
      }

      _log('checkout', 'Existing active membership:', existingMembership);

      /* ── 4. Load Razorpay SDK ─────────────────────────────────── */
      await _loadSDK();
      if (typeof Razorpay === 'undefined') {
        throw new Error('Razorpay SDK unavailable after load');
      }

      /* ── 5. Open Razorpay checkout ────────────────────────────── */
      var paymentResponse = await new Promise(function (resolve, reject) {
        var options = {
          key:         RZP_KEY,
          amount:      plan.price_inr * 100,   /* paise */
          currency:    'INR',
          name:        'Studyria',
          description: plan.name + ' Membership',
          prefill: {
            email: user.email || '',
            name:  (user.user_metadata && user.user_metadata.full_name) || '',
          },
          theme: { color: '#fbbf24' },
          notes: {
            plan_slug: planSlug,
            user_id:   user.id,
          },
          handler: function (response) {
            resolve({
              payment_id: response.razorpay_payment_id || '',
              order_id:   response.razorpay_order_id   || '',
              signature:  response.razorpay_signature  || '',
            });
          },
          modal: {
            ondismiss: function () {
              reject(new Error('PAYMENT_CANCELLED'));
            },
          },
        };
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (r) {
          reject(new Error('PAYMENT_FAILED:' + ((r.error && r.error.description) || 'unknown')));
        });
        rzp.open();
      });

      _log('checkout', 'Razorpay success callback. payment_id:', paymentResponse.payment_id);

      /* ── 6. Replay protection: check provider_tx_id ───────────── */
      var alreadyProcessed = false;
      try {
        var dupRes = await client
          .from('membership_transactions')
          .select('id, membership_id')
          .eq('provider_tx_id', paymentResponse.payment_id)
          .maybeSingle();

        if (!dupRes.error && dupRes.data) {
          alreadyProcessed = true;
          _log('checkout', 'Duplicate payment_id — already processed:', dupRes.data);
        }
      } catch (e) {
        _warn('checkout', 'Duplicate check exception:', e);
      }

      if (alreadyProcessed) {
        _toast('This payment was already processed. Your membership should be active.', 'info');
        _btnSuccess(triggerBtn);
        _dispatchActivation(planSlug, null, null);
        return;
      }

      /* ── 7. Compute expires_at ────────────────────────────────── */
      var now       = new Date().toISOString();
      var startsAt  = now;
      var expiresAt;

      if (existingMembership) {
        /* Extend from current expiry */
        var baseDate = new Date(existingMembership.expires_at) > new Date(now)
          ? existingMembership.expires_at
          : now;
        expiresAt = _addDays(baseDate, durationDays);
        _log('checkout', 'Extending membership from', existingMembership.expires_at, '→', expiresAt);
      } else {
        expiresAt = _addDays(now, durationDays);
        _log('checkout', 'New membership, expires_at:', expiresAt);
      }

      /* ── 8. Upsert user_memberships ───────────────────────────── */
      var membershipId = null;
      try {
        if (existingMembership) {
          /* Update existing — extend expires_at */
          var updRes = await client
            .from('user_memberships')
            .update({
              plan_id:    plan.id,
              expires_at: expiresAt,
              status:     'active',
              auto_renew: false,
            })
            .eq('id', existingMembership.id)
            .eq('user_id', user.id)
            .select('id')
            .single();

          if (updRes.error) {
            _warn('checkout', 'user_memberships UPDATE error:', updRes.error.message);
          } else {
            membershipId = updRes.data && updRes.data.id;
            _log('checkout', 'user_memberships extended:', membershipId);
          }
        } else {
          /* Insert new membership */
          var insRes = await client
            .from('user_memberships')
            .insert({
              user_id:    user.id,
              plan_id:    plan.id,
              status:     'active',
              started_at: startsAt,
              expires_at: expiresAt,
              auto_renew: false,
            })
            .select('id')
            .single();

          if (insRes.error) {
            _err('checkout', 'user_memberships INSERT FAILED:', {
              message: insRes.error.message,
              code:    insRes.error.code,
              hint:    insRes.error.hint,
              details: insRes.error.details,
              insert:  { user_id: user.id, plan_id: plan.id, status:'active', started_at: startsAt, expires_at: expiresAt },
            });
          } else {
            membershipId = insRes.data && insRes.data.id;
            _log('checkout', 'user_memberships created:', membershipId);
          }
        }
      } catch (e) {
        _warn('checkout', 'user_memberships write exception:', e);
      }

      /* ── 9. Insert membership_transactions (immutable receipt) ── */
      try {
        var txInsert = {
          user_id:        user.id,
          plan_id:        plan.id,
          membership_id:  membershipId,
          provider:       'razorpay',
          provider_tx_id: paymentResponse.payment_id,   /* UNIQUE — replay protection */
          amount_inr:     plan.price_inr,
          currency:       'INR',
          status:         'completed',
          notes:          JSON.stringify({
            plan_slug:  planSlug,
            order_id:   paymentResponse.order_id,
            expires_at: expiresAt,
          }),
        };

        _log('checkout', 'Inserting membership_transactions:', txInsert);

        var txRes = await client
          .from('membership_transactions')
          .insert(txInsert)
          .select('id')
          .single();

        if (txRes.error) {
          /* UNIQUE constraint violation = duplicate — safe to ignore */
          if (txRes.error.code === '23505') {
            _log('checkout', 'membership_transactions: duplicate (23505) — already recorded, safe to ignore.');
          } else {
            _err('checkout', 'membership_transactions INSERT FAILED:', {
              message: txRes.error.message,
              code:    txRes.error.code,
              hint:    txRes.error.hint,
              details: txRes.error.details,
              insert:  txInsert,
            });
            _toast(
              '⚠️ Payment received but record write failed. ' +
              'Contact support with payment ID: ' + paymentResponse.payment_id,
              'error'
            );
          }
        } else {
          _log('checkout', 'membership_transactions INSERT success:', txRes.data);
        }
      } catch (e) {
        _warn('checkout', 'membership_transactions write exception:', e);
      }

      /* ── 10. Bust caches ─────────────────────────────────────── */
      if (typeof window._dashCache !== 'undefined') window._dashCache = null;

      /* ── 11. Success UI ──────────────────────────────────────── */
      _btnSuccess(triggerBtn);
      _toast(
        '🎉 ' + plan.name + ' membership activated! Active until ' + _fmtDate(expiresAt) + '.',
        'success'
      );
      _dispatchActivation(planSlug, membershipId, expiresAt);

    } catch (e) {
      _btnRestore(triggerBtn);
      var msg = e.message || '';

      if (msg === 'PAYMENT_CANCELLED') {
        _toast('Payment cancelled.', 'info');
      } else if (msg.startsWith('PAYMENT_FAILED')) {
        _err('checkout', 'Razorpay payment failed:', msg);
        _toast('Payment failed. Please try again.', 'error');
      } else {
        _err('checkout', 'Checkout error:', e);
        _toast('An error occurred during checkout. Please try again.', 'error');
      }
    }
  }

  /* ── Dispatch membership activated event ─────────────────────── */
  function _dispatchActivation(planSlug, membershipId, expiresAt) {
    window.dispatchEvent(new CustomEvent('studyria:membership:activated', {
      detail: { planSlug: planSlug, membershipId: membershipId, expiresAt: expiresAt }
    }));

    /* Update status badges */
    document.querySelectorAll('[data-prm-status]').forEach(function (el) {
      el.textContent = '👑 Premium';
    });
  }

  /* ── Wire plan buttons ────────────────────────────────────────── */
  function _wirePlanButtons() {
    /* Buttons with data-plan or data-slug attributes */
    document.querySelectorAll('.prm-plan-btn[data-plan], .prm-plan-btn[data-slug]').forEach(function (btn) {
      var slug = btn.getAttribute('data-plan') || btn.getAttribute('data-slug');
      if (!slug) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        checkout(slug, btn);
      });
    });

    /* Buttons with onclick="PPAY.checkout(...)" pattern */
    /* Already handled by onclick attrs in HTML */
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  function _init() {
    _wirePlanButtons();
    _log('init', 'PPAY v1.0 initialized — direct Razorpay + Supabase pattern (buyPDF-style)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ── Public API ───────────────────────────────────────────────── */
  window.PPAY = {
    _version: '1.0',
    checkout: checkout,
  };

})();
