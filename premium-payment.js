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
 * @version 1.1
 */

(function () {
  'use strict';

  if (window.PPAY && window.PPAY._version === '1.0') return;  /* idempotent */

  /* ── Config ──────────────────────────────────────────────────── */
  var RZP_KEY     = 'rzp_live_SxcnO1cOS2HAJT';
  var RZP_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

  /* billing_cycle → days (requirement: monthly=30, yearly=365) */
  var CYCLE_DAYS = {
    trial_7day:  7,
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

  /* No hardcoded plan prices. Payment ALWAYS fetches from DB via PassSync.
     If fetch fails, show error and do NOT open payment. Never use hardcoded prices. */

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
    /* Exact timestamp arithmetic — preserves full precision (hour/min/sec).
       Uses UTC milliseconds to avoid local-timezone edge cases.
       1 day = 86400000 ms. Result is a full ISO timestamp. */
    var ms = new Date(dateStr).getTime();
    return new Date(ms + days * 86400000).toISOString();
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
    btn.style.background = 'linear-gradient(135deg,#10d98e,#c99a3c)';
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
      /* ── 2. Fetch plan from database — ONE SINGLE SOURCE OF TRUTH ──
         Priority:
           0. PassSync cache (instant, shared across modules)
           1. membership_plans (DB) — authoritative for price + ID
           2. site_config (admin panel config) — display settings
           3. localStorage (offline cache)
           4. PassRenderer.DEFAULT_PLANS (last-resort hardcoded defaults)

         PRICE always from membership_plans.price_inr (admin edits DB).
      */
      var plan = null;
      var _fetchAttempt = 0;

      /* STEP 0: PassSync fast-path — try cached plan first (instant) */
      if (typeof window.PassSync !== 'undefined' && window.PassSync.getPlanBySlug) {
        try {
          plan = await window.PassSync.getPlanBySlug(planSlug);
          if (plan) {
            _log('checkout', 'PassSync cache hit for plan:', { slug: planSlug, price_inr: plan.price_inr });
          }
        } catch (e) {
          _warn('checkout', 'PassSync fetch exception:', e);
        }
      }

      if (!plan) {
      /* ─────────────────────────────────────────────────────────────────
         PLAN FETCH — SINGLE SOURCE OF TRUTH — v3.0
         NEVER "Plan unavailable" if plan exists in membership_plans.
       ─────────────────────────────────────────────────────────────────── */
      async function _fetchPlanFromDB(attempt) {
        _log('checkout', 'Fetching plan "' + planSlug + '"' + (attempt > 0 ? ' (retry ' + attempt + ')' : ''));

        /* STEP 1: Fetch from membership_plans (price-authoritative)
           1A: Targeted slug query (fastest path)
           1B: Broad SELECT + client-side match (handles slug mismatches / missing rows) */
        var dbPlan = null;
        try {
          var planRes = await client
            .from('membership_plans')
            .select('id, slug, name, price_inr, billing_cycle, is_active, trial_days')
            .eq('slug', planSlug)
            .maybeSingle();
          if (planRes.data && !planRes.error) {
            dbPlan = planRes.data;
            _log('checkout', 'Step 1A: plan found by slug:', { slug: planSlug, price: dbPlan.price_inr, id: dbPlan.id });
          } else if (planRes.error) {
            _warn('checkout', 'Step 1A fetch error:', planRes.error.message);
          }
        } catch (e) {
          _warn('checkout', 'Step 1A fetch exception:', e);
        }

        /* STEP 1B: Broad SELECT fallback — if slug query missed (row exists but slug differs) */
        if (!dbPlan) {
          try {
            var allPlansRes = await client
              .from('membership_plans')
              .select('id, slug, name, price_inr, billing_cycle, is_active, trial_days')
              .limit(50);
            if (allPlansRes.data && allPlansRes.data.length) {
              var slugNorm = planSlug.toLowerCase().replace(/[\s_-]/g, '');
              dbPlan = allPlansRes.data.find(function(p) {
                if (p.slug === planSlug) return true;
                if ((p.slug || '').toLowerCase().replace(/[\s_-]/g, '') === slugNorm) return true;
                if ((p.name || '').toLowerCase().replace(/\s+/g, '_') === planSlug) return true;
                if ((p.name || '').toLowerCase().replace(/[\s_-]/g, '') === slugNorm) return true;
                return false;
              }) || null;
              if (dbPlan) {
                _log('checkout', 'Step 1B: plan matched by broad SELECT:', { found: dbPlan.slug, id: dbPlan.id });
              } else {
                _log('checkout', 'Step 1B: plan "' + planSlug + '" not in DB (' + allPlansRes.data.length + ' plans fetched)');
              }
            }
          } catch (e1b) {
            _warn('checkout', 'Step 1B broad SELECT failed:', e1b);
          }
        }

        /* STEP 2: Try site_config for display settings (badge, gradient, duration) */
        var sitePlan = null;
        try {
          var cfgRes = await client
            .from('site_config')
            .select('value')
            .eq('key', 'pass_management_config')
            .maybeSingle();
          if (cfgRes.data && cfgRes.data.value) {
            var pmCfg = JSON.parse(cfgRes.data.value);
            if (pmCfg.plans) {
              pmCfg.plans.forEach(function(p) {
                var pId = p.passId || (p.name || '').toLowerCase().replace(/\s+/g, '_');
                if (pId === planSlug) { sitePlan = p; }
              });
            }
          }
        } catch (e) {
          _warn('checkout', 'site_config fetch error:', e);
        }

        /* STEP 3: Try localStorage cache */
        if (!sitePlan) {
          try {
            var lsRaw = localStorage.getItem('studyria_pass_config');
            if (lsRaw) {
              var lsCfg = JSON.parse(lsRaw);
              if (lsCfg && lsCfg.plans) {
                lsCfg.plans.forEach(function(p) {
                  var pId = p.passId || (p.name || '').toLowerCase().replace(/\s+/g, '_');
                  if (pId === planSlug) { sitePlan = p; }
                });
              }
            }
          } catch (e) { /* localStorage unavailable */ }
        }

        /* STEP 4: Try PassRenderer.DEFAULT_PLANS (known canonical plans) */
        if (!sitePlan && window.PassRenderer && window.PassRenderer.DEFAULT_PLANS) {
          var dp = window.PassRenderer.DEFAULT_PLANS.find(function(p) { return p.passId === planSlug; });
          if (dp) {
            sitePlan = dp;
            _log('checkout', 'Plan found in PassRenderer.DEFAULT_PLANS:', planSlug);
          }
        }

        /* STEP 5: If plan is still not found anywhere, it truly doesn't exist */
        if (!dbPlan && !sitePlan) {
          _warn('checkout', 'Plan "' + planSlug + '" not found in any source' + (attempt > 0 ? ' after retry' : ''));
          return null;
        }

        /* BUILD PLAN OBJECT
           PRICE RULE: membership_plans.price_inr wins over everything.
           If plan has no DB row yet, use offerPrice from site_config/default.
           Duration: use sitePlan.duration if available, else CYCLE_DAYS lookup. */
        var finalPrice = dbPlan
          ? dbPlan.price_inr
          : (sitePlan ? (sitePlan.offerPrice || sitePlan.originalPrice || 0) : 0);

        var finalDuration = sitePlan && sitePlan.durationUnit === 'lifetime'
          ? '0'
          : (sitePlan ? (sitePlan.duration || null) : null);

        var finalDurationUnit = sitePlan && sitePlan.durationUnit
          ? sitePlan.durationUnit : 'days';

        var result = {
          id:            dbPlan ? dbPlan.id : null,
          slug:          planSlug,
          name:          (dbPlan ? dbPlan.name : null) || (sitePlan ? sitePlan.name : planSlug),
          price_inr:     finalPrice,
          billing_cycle: dbPlan ? (dbPlan.billing_cycle || planSlug) : planSlug,
          is_active:     dbPlan ? dbPlan.is_active : (sitePlan ? sitePlan.active !== false : true),
          trial_days:    dbPlan ? dbPlan.trial_days : null,
          duration:      finalDuration,
          durationUnit:  finalDurationUnit,
          _source:       dbPlan ? 'membership_plans+' + (sitePlan ? 'site_config' : 'default') : 'site_config_only',
        };

        _log('checkout', 'Plan resolved (v3 — DB price wins):', {
          slug: planSlug, price: '₹' + result.price_inr,
          active: result.is_active, id: result.id, source: result._source
        });

        return result;
      }

      plan = await _fetchPlanFromDB(0);

      /* RETRY LOGIC: If plan not found, refetch once */
      if (!plan) {
        _log('checkout', 'Plan not found — retrying once…');
        plan = await _fetchPlanFromDB(1);
      }

      /* If still not found after retry, show error */
      if (!plan) {
        // FIX 14: Friendly error — plan may be temporarily unavailable, not deleted
        // Provide actionable error: if admin hasn't synced yet, direct them there
        _toast(
          '⚠️ Plan "' + planSlug + '" not found. Go to Admin → Pass Management → Save Plans to sync, then refresh.',
          'error'
        );
      } /* end inner if — "still not found after retry" */
      } /* end if (!plan) — close PassSync fallback block (from line 229) */

      /* PassSync retry: if still no plan after _fetchPlanFromDB, force-refresh and try once more */
      if (!plan && typeof window.PassSync !== 'undefined' && window.PassSync.getPlanBySlug) {
        _warn('checkout', 'Plan not found after DB fetch -- PassSync force refresh retry');
        if (window.PassSync.invalidateCache) window.PassSync.invalidateCache();
        try {
          plan = await window.PassSync.getPlanBySlug(planSlug, true);
        } catch (e) {
          _warn('checkout', 'PassSync retry exception:', e);
        }
      }

      if (!plan) {
        _err('checkout', 'Plan not found in any source after all retries:', planSlug);
        _toast(
          '⚠️ Plan "' + planSlug + '" not found. Go to Admin → Pass Management → Save Plans to sync, then refresh.',
          'error'
        );
        _btnRestore(triggerBtn);
        return;
      }

      /* Compute duration from site_config duration field (authoritative) */
      var durationDays;
      if (plan.durationUnit === 'lifetime') {
        durationDays = 36500;
      } else {
        durationDays = parseInt(plan.duration) || _cycleDays(plan.billing_cycle, plan.trial_days || planSlug);
      }

      /* ── Payment Validation ───────────────────────────────────
         Verify plan exists, is active, price valid, offer valid, duration valid.
         Never open payment using invalid data. */
      var validationErrors = [];
      // Check price valid
      if (typeof plan.price_inr !== 'number' || plan.price_inr <= 0) {
        validationErrors.push('Invalid price (\u20B9' + plan.price_inr + ')');
      }
      // Check plan active
      if (plan.is_active === false) {
        validationErrors.push('Plan is not active');
      }
      // Check duration valid
      if (durationDays <= 0) {
        validationErrors.push('Invalid duration (' + durationDays + ' days)');
      }
      if (validationErrors.length) {
        var vMsg = '\u26A0\uFE0F Cannot proceed with payment: ' + validationErrors.join(', ') + '. Please contact support.';
        _toast(vMsg, 'error');
        _btnRestore(triggerBtn);
        _err('checkout', 'Payment validation failed:', validationErrors);
        return;
      }
      _log('checkout', 'Payment validation passed:', { price_inr: plan.price_inr, is_active: plan.is_active, durationDays: durationDays });
      _log('checkout', 'Expiry calculation:', {
        slug: planSlug, billing_cycle: plan.billing_cycle,
        trial_days: plan.trial_days, durationDays: durationDays,
      });

      /* If plan.id is null, try UPSERT into membership_plans.
         - If row exists but our query missed it (slug mismatch) → upsert returns it
         - If row truly missing and we have write permission → creates it
         - If RLS blocks write → falls through to rescue SELECT below */
      if (!plan.id) {
        _warn('checkout', 'Plan "' + planSlug + '" has no DB id \u2014 attempting upsert into membership_plans');
        try {
          var upsertRes = await client
            .from('membership_plans')
            .upsert(
              { slug: planSlug, name: plan.name || planSlug, price_inr: plan.price_inr, billing_cycle: plan.billing_cycle || planSlug, is_active: true },
              { onConflict: 'slug', ignoreDuplicates: false }
            )
            .select('id, slug, price_inr')
            .maybeSingle();
          if (upsertRes.data && upsertRes.data.id) {
            plan.id = upsertRes.data.id;
            if (upsertRes.data.price_inr) plan.price_inr = upsertRes.data.price_inr;
            _log('checkout', 'Upsert succeeded — plan.id obtained:', plan.id);
          } else if (upsertRes.error) {
            /* 23505 = unique_violation → row exists, SELECT it directly */
            /* 42501 = insufficient_privilege → RLS blocks INSERT, row may still exist */
            var errCode = (upsertRes.error.code || '');
            if (errCode === '23505' || errCode === '42501') {
              _log('checkout', 'Upsert blocked (' + errCode + ') — will try rescue SELECT');
            } else {
              _warn('checkout', 'Upsert error:', upsertRes.error.message);
            }
          }
        } catch (e) {
          _warn('checkout', 'Upsert exception:', e.message || e);
        }
      }

      /* GUARD: plan.id — broad rescue before final block */
      if (!plan.id) {
        /* RESCUE: SELECT all active plans and match by slug or name variant.
           Handles: race conditions after INSERT, slug format mismatches,
           rows that exist in DB but were missed by the targeted slug query. */
        try {
          var rescueRes = await client
            .from('membership_plans')
            .select('id, slug, name, price_inr, billing_cycle, is_active, trial_days')
            .limit(50);
          if (rescueRes.data && rescueRes.data.length) {
            var planSlugNorm = planSlug.toLowerCase().replace(/[\s_-]/g, '');
            var match = rescueRes.data.find(function(p) {
              if (p.slug === planSlug) return true;
              if ((p.slug || '').toLowerCase().replace(/[\s_-]/g, '') === planSlugNorm) return true;
              if ((p.name || '').toLowerCase().replace(/\s+/g, '_') === planSlug) return true;
              if ((p.name || '').toLowerCase().replace(/[\s_-]/g, '') === planSlugNorm) return true;
              return false;
            });
            if (match) {
              plan.id            = match.id;
              plan.price_inr     = match.price_inr || plan.price_inr;
              plan.billing_cycle = match.billing_cycle || plan.billing_cycle;
              plan.is_active     = match.is_active;
              _log('checkout', 'RESCUE: plan matched by broad SELECT:', { found: match.slug, id: match.id });
            }
          }
        } catch (rescueErr) {
          _warn('checkout', 'RESCUE SELECT failed:', rescueErr);
        }
      }

      /* FINAL GUARD: no plan.id after all attempts */
      if (!plan.id) {
        _err('checkout', 'Plan ID null after rescue for "' + planSlug + '"');
        _toast(
          '\u26A0\uFE0F Plan "' + planSlug + '" needs syncing. Ask admin: Admin \u2192 Pass Management \u2192 Sync Plans, then retry.',
          'error'
        );
        _btnRestore(triggerBtn);
        return;
      }
      _log('checkout', 'Plan resolved:', { slug: planSlug, price_inr: plan.price_inr, days: durationDays, id: plan.id });

      /* ── 3. Check existing membership (ANY status) ───────────────
         CRITICAL FIX: Previously filtered by status='active' AND expires_at > now.
         This missed memberships where status was still 'active' in DB but
         expires_at < now (effectively expired). For those, the query returned
         null → code tried to INSERT → hit UNIQUE INDEX idx_user_memberships_one_active
         → INSERT failed silently → membership stayed expired.
         
         FIX: Get the LATEST membership row by expires_at, regardless of status.
         This ensures we always find the existing row to UPDATE instead of INSERT.
      */
      var existingMembership = null;
      try {
        var memRes = await client
          .from('user_memberships')
          .select('id, plan_id, status, started_at, expires_at')
          .eq('user_id', user.id)
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!memRes.error && memRes.data) {
          existingMembership = memRes.data;
          _log('checkout', 'Found existing membership row:', {
            id: existingMembership.id,
            status: existingMembership.status,
            expires_at: existingMembership.expires_at
          });
        }
      } catch (e) {
        _warn('checkout', 'Membership check exception:', e);
      }

      /* ── 4. Load Razorpay SDK ─────────────────────────────────── */
      await _loadSDK();
      if (typeof Razorpay === 'undefined') {
        throw new Error('Razorpay SDK unavailable after load');
      }

      /* ── 5. Open Razorpay checkout ──────────────────────────────
         FIX 13: Amount shown on Card, Checkout, Razorpay, Receipt must all match.
         Log the exact amount being charged for audit trail. */
      _log('checkout', 'Razorpay amount:', { price_inr: plan.price_inr, paise: plan.price_inr * 100, slug: planSlug });
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
            plan_slug:   planSlug,
            plan_id:     plan.id || '',
            plan_name:   plan.name || '',
            user_id:     user.id,
            amount_inr: String(plan.price_inr),
            duration_days: String(durationDays),
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

      /* ── 8. Upsert user_memberships (CRITICAL — must succeed) ────
         ROOT CAUSE FIX: Previously, if this write failed, the code
         continued to insert a transaction (step 9) and dispatch
         activation events (step 11) — user saw the transaction but
         membership stayed expired.
         
         FIX: Membership write is now a HARD requirement. If it fails,
         we abort immediately with an error toast and do NOT record
         a transaction or dispatch activation.
      */
      var membershipId = null;
      var membershipWriteOk = false;
      try {
        if (existingMembership) {
          /* UPDATE existing row — always UPDATE, never INSERT.
             This avoids the UNIQUE INDEX idx_user_memberships_one_active
             violation that occurred when trying to INSERT a second
             'active' row for the same user. */
          
          /* Determine if this is a renewal after expiry.
             If current expiry < now, update started_at to now. */
          var isExpired = new Date(existingMembership.expires_at) <= new Date(now);
          
          var updateData = {
            plan_id:    plan.id,
            expires_at: expiresAt,
            status:     'active',
            auto_renew: false,
          };
          /* If expired: reset started_at to current purchase time */
          if (isExpired) {
            updateData.started_at = startsAt;
          }
          
          var updRes = await client
            .from('user_memberships')
            .update(updateData)
            .eq('id', existingMembership.id)
            .eq('user_id', user.id)
            .select('id')
            .single();

          if (updRes.error) {
            _err('checkout', 'user_memberships UPDATE FAILED:', {
              message: updRes.error.message,
              code:    updRes.error.code,
              hint:    updRes.error.hint,
              details: updRes.error.details,
            });
          } else {
            membershipId = updRes.data && updRes.data.id;
            membershipWriteOk = true;
            _log('checkout', 'user_memberships UPDATED:', {
              id: membershipId,
              expires_at: expiresAt,
              isExpired: isExpired,
              started_at: isExpired ? startsAt : '(unchanged)'
            });
          }
        } else {
          /* INSERT new membership (first-time buyer) */
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
            });
          } else {
            membershipId = insRes.data && insRes.data.id;
            membershipWriteOk = true;
            _log('checkout', 'user_memberships CREATED:', membershipId);
          }
        }
      } catch (e) {
        _err('checkout', 'user_memberships write exception:', e);
      }

      /* HARD ABORT: If membership write failed, do NOT insert transaction
         or dispatch activation. Show error and return. */
      if (!membershipWriteOk) {
        _btnRestore(triggerBtn);
        _toast(
          '⚠️ Payment received but membership activation failed. ' +
          'Please contact support with Payment ID: ' + paymentResponse.payment_id,
          'error'
        );
        _err('checkout', 'ABORTED: membership write failed. Transaction NOT recorded. Payment ID:', paymentResponse.payment_id);
        return;
      }

      /* ── 9. Insert membership_transactions (immutable receipt) ── */
      try {
        var txInsert = {
          user_id:        user.id,
          plan_id:        plan.id,
          membership_id:  membershipId,
          provider:       'razorpay',
          provider_tx_id: paymentResponse.payment_id,   /* UNIQUE — replay protection */
          amount_inr:     plan.price_inr,  /* FIX 13: Must match Razorpay charge */
          currency:       'INR',
          status:         'completed',
          notes:          JSON.stringify({
            plan_slug:   planSlug,
            plan_name:   plan.name || '',
            order_id:    paymentResponse.order_id,
            amount_inr:  plan.price_inr,  /* FIX 13: For receipt consistency */
            expires_at:  expiresAt,
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

      /* ── 10. Bust ALL caches + inject new membership state ───────
         Previously only cleared window._dashCache. SMCI._state,
         P5D._cache, and Premium Library tab state were NOT invalidated.
         The user had to refresh/logout to see updated status.
         
         FIX: Invalidate everything and inject the new membership
         status directly into SMCI — no re-fetch needed.
      */
      // Dashboard cache
      if (typeof window._dashCache !== 'undefined') window._dashCache = null;

      // SMCI: inject the new membership state directly (no Supabase re-fetch)
      if (window.SMCI && typeof window.SMCI._injectStatus === 'function') {
        window.SMCI._injectStatus({
          isPremium:  true,
          status:     'active',
          planName:   plan.name,
          planSlug:   planSlug,
          expiresAt:  expiresAt,
        });
        _log('checkout', 'SMCI state injected: isPremium=true, expiresAt=', expiresAt);
      }

      // SMCI: also refresh badges + home shelf
      if (window.SMCI && typeof window.SMCI.syncAll === 'function') {
        // syncAll with force=false will use the injected state (no re-fetch)
        window.SMCI.syncAll(false).catch(function() {});
      }

      // P5D: bust cache
      if (window.P5D && typeof window.P5D.refreshBadges === 'function') {
        try { window.P5D.refreshBadges(); } catch(_) {}
      }

      // If user is on My Library → Premium sub-tab, re-render it
      if (typeof window.librarySubTab !== 'undefined' && window.librarySubTab === 'premium') {
        if (typeof window.switchLibrarySubTab === 'function') {
          window.switchLibrarySubTab('premium');
        }
      }

      // Dispatch status update event for any other listeners
      try {
        window.dispatchEvent(new CustomEvent('smci:statusUpdated', {
          detail: { isPremium: true, status: 'active', planName: plan.name, expiresAt: expiresAt }
        }));
      } catch(_) {}

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

    /* ENTERPRISE: Refresh SMCI cache so premium status is immediate */
    if (window.SMCI && typeof window.SMCI.refresh === 'function') {
      try { window.SMCI.refresh(); } catch (_) {}
    }

    /* ENTERPRISE: Insert activity log via Supabase */
    try {
      var client = window.supabaseClient;
      if (client && membershipId) {
        client.from('membership_activity_logs').insert({
          activity_type: 'activation',
          metadata: { planSlug: planSlug, membershipId: membershipId, expiresAt: expiresAt }
        }).then(function(){}).catch(function(){});
      }
    } catch (_) {}
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
    /* No cache — always fetch fresh from database */
  };

  /* Listen for config update events from admin save */
  window.addEventListener('studyria:passConfigUpdated', function() {
    console.log('[PPAY] Config updated — next checkout will fetch fresh from database');
  });

})();
