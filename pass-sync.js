/**
 * ══════════════════════════════════════════════════════════════════════════
 * pass-sync.js — Studyria Pass System: Single Source of Truth Sync Engine
 * ══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Makes `membership_plans` the ONE source of truth for all pass pricing,
 *   durations, badges, and display data. Every other system reads from here.
 *
 * LOADING ORDER:
 *   1. supabase.js  -> sets window.supabaseClient
 *   2. pass-sync.js -> sets window.PassSync (this file)
 *   3. premium-payment.js, premium-p5d.js -> consume window.PassSync
 *
 * FALLBACK CHAIN:
 *   1. membership_plans (DB, live)         <- primary
 *   2. site_config.pass_management_config  <- secondary (if DB down)
 *   3. Graceful error                      <- last resort
 *
 * SAFETY CONTRACT:
 *   - Read-only (never writes to membership_plans)
 *   - Writes to site_config ONLY on admin trigger (auto-sync)
 *   - Zero payment logic, zero Razorpay, zero checkout
 *   - Cache with TTL + manual invalidation
 *   - Retry logic (never "Plan not found" if plan exists)
 *   - No hardcoded prices or plan IDs
 *
 * @module pass-sync
 * @version 1.0
 * ══════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (window.PassSync && window.PassSync._version === '1.0') return;

  /* -- Constants -- */
  var CACHE_TTL_PLANS_MS = 2 * 60 * 1000; /* 2 min for plan list */
  var RETRY_DELAY_MS     = 500;
  var RETRY_MAX          = 2;
  var SITE_CONFIG_KEY    = 'pass_management_config';

  /* -- Internal cache -- */
  var _plansCache        = null;
  var _plansCacheExpiry  = 0;
  var _planBySlugCache   = {};
  var _fetchInFlight     = null;

  /* -- Logging -- */
  function _log(fn, msg, d) {
    d !== undefined
      ? console.debug('[PassSync:' + fn + ']', msg, d)
      : console.debug('[PassSync:' + fn + ']', msg);
  }
  function _warn(fn, msg, d) { console.warn('[PassSync:' + fn + ']', msg, d || ''); }
  function _err(fn, msg, d)  { console.error('[PassSync:' + fn + ']', msg, d || ''); }

  /* -- Supabase accessor -- */
  function _sb() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  }

  function _sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* == 1 -- FETCH PLANS FROM DB (Primary Source) == */

  async function _fetchPlansFromDB(forceRefresh) {
    if (!forceRefresh && _plansCache && Date.now() < _plansCacheExpiry) {
      _log('_fetchPlansFromDB', 'Cache hit', _plansCache.length + ' plans');
      return _plansCache;
    }

    if (_fetchInFlight) {
      _log('_fetchPlansFromDB', 'Dedup -- awaiting in-flight fetch');
      return _fetchInFlight;
    }

    _fetchInFlight = (async function () {
      var client = _sb();
      if (!client) {
        _warn('_fetchPlansFromDB', 'Supabase client not available');
        return [];
      }

      for (var attempt = 0; attempt <= RETRY_MAX; attempt++) {
        try {
          var res = await client
            .from('membership_plans')
            .select('id, slug, name, description, price_inr, billing_cycle, duration_days, trial_days, is_active, sort_order, badge, features')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          if (res.error) {
            _warn('_fetchPlansFromDB', 'Attempt ' + (attempt + 1) + ' error:', res.error.message);
            if (attempt < RETRY_MAX) { await _sleep(RETRY_DELAY_MS); continue; }
            return [];
          }

          var plans = res.data || [];
          _log('_fetchPlansFromDB', 'Fetched ' + plans.length + ' plans from DB');

          _plansCache       = plans;
          _plansCacheExpiry = Date.now() + CACHE_TTL_PLANS_MS;

          _planBySlugCache = {};
          plans.forEach(function (p) { _planBySlugCache[p.slug] = p; });

          return plans;
        } catch (e) {
          _warn('_fetchPlansFromDB', 'Attempt ' + (attempt + 1) + ' exception:', e);
          if (attempt < RETRY_MAX) { await _sleep(RETRY_DELAY_MS); continue; }
          return [];
        }
      }

      return [];
    })();

    try {
      return await _fetchInFlight;
    } finally {
      _fetchInFlight = null;
    }
  }

  /* == 2 -- FALLBACK: site_config.pass_management_config == */

  async function _fetchPlansFromSiteConfig() {
    var client = _sb();
    if (!client) return [];

    try {
      var res = await client
        .from('site_config')
        .select('value')
        .eq('key', SITE_CONFIG_KEY)
        .maybeSingle();

      if (res.error || !res.data || !res.data.value) {
        _log('_fetchPlansFromSiteConfig', 'No site_config entry found');
        return [];
      }

      var config = typeof res.data.value === 'string'
        ? JSON.parse(res.data.value)
        : res.data.value;

      if (!config || !config.plans || !Array.isArray(config.plans)) {
        _log('_fetchPlansFromSiteConfig', 'site_config has no plans array');
        return [];
      }

      _log('_fetchPlansFromSiteConfig', 'Fetched ' + config.plans.length + ' plans from site_config');
      return config.plans;
    } catch (e) {
      _warn('_fetchPlansFromSiteConfig', 'Error:', e);
      return [];
    }
  }

  /* == 3 -- PUBLIC API: getPlans() & getPlanBySlug() == */

  async function getPlans(forceRefresh) {
    var plans = await _fetchPlansFromDB(forceRefresh);
    if (plans && plans.length > 0) return plans;

    _warn('getPlans', 'DB returned no plans -- falling back to site_config');
    plans = await _fetchPlansFromSiteConfig();
    if (plans && plans.length > 0) return plans;

    _warn('getPlans', 'No plans available from any source');
    return [];
  }

  async function getPlanBySlug(slug, forceRefresh) {
    if (!slug) return null;

    if (!forceRefresh && _planBySlugCache[slug] && Date.now() < _plansCacheExpiry) {
      _log('getPlanBySlug', 'Cache hit for slug:', slug);
      return _planBySlugCache[slug];
    }

    var plans = await getPlans(forceRefresh);

    for (var i = 0; i < plans.length; i++) {
      if (plans[i].slug === slug) {
        _log('getPlanBySlug', 'Found plan:', { slug: slug, price_inr: plans[i].price_inr });
        return plans[i];
      }
    }

    /* Retry once with force refresh */
    if (!forceRefresh) {
      _warn('getPlanBySlug', 'Plan not found -- retrying with force refresh:', slug);
      plans = await getPlans(true);
      for (var j = 0; j < plans.length; j++) {
        if (plans[j].slug === slug) {
          _log('getPlanBySlug', 'Found plan on retry:', { slug: slug, price_inr: plans[j].price_inr });
          return plans[j];
        }
      }
    }

    _warn('getPlanBySlug', 'Plan not found after all retries:', slug);
    return null;
  }

  /* == 4 -- CACHE INVALIDATION == */

  function invalidateCache() {
    _plansCache       = null;
    _plansCacheExpiry = 0;
    _planBySlugCache = {};
    _log('invalidateCache', 'All plan caches invalidated');
  }

  /* == 5 -- AUTO-SYNC: membership_plans -> site_config == */

  async function syncToSiteConfig() {
    var client = _sb();
    if (!client) {
      _warn('syncToSiteConfig', 'No Supabase client');
      return false;
    }

    try {
      var res = await client
        .from('membership_plans')
        .select('id, slug, name, description, price_inr, billing_cycle, duration_days, trial_days, is_active, sort_order, badge, features')
        .order('sort_order', { ascending: true });

      if (res.error) {
        _err('syncToSiteConfig', 'Failed to fetch plans:', res.error.message);
        return false;
      }

      var allPlans = res.data || [];

      var config = {
        version:     '2.0',
        last_synced:  new Date().toISOString(),
        source:      'membership_plans',
        plans:       allPlans,
      };

      var upsertRes = await client
        .from('site_config')
        .upsert({
          key:   SITE_CONFIG_KEY,
          value: JSON.stringify(config),
        }, { onConflict: 'key' });

      if (upsertRes.error) {
        _err('syncToSiteConfig', 'Failed to upsert site_config:', upsertRes.error.message);
        return false;
      }

      invalidateCache();

      _log('syncToSiteConfig', 'Synced ' + allPlans.length + ' plans to site_config');
      return true;
    } catch (e) {
      _err('syncToSiteConfig', 'Exception:', e);
      return false;
    }
  }

  /* == 6 -- DOM SYNC: Update plan cards with live DB prices == */

  async function syncDOM() {
    try {
      var plans = await getPlans();
      if (!plans || plans.length === 0) {
        _log('syncDOM', 'No plans to sync');
        return;
      }

      var planMap = {};
      plans.forEach(function (p) { planMap[p.slug] = p; });

      var cards = document.querySelectorAll('.prm-plan-card');
      _log('syncDOM', 'Found ' + cards.length + ' plan cards, ' + plans.length + ' DB plans');

      cards.forEach(function (card) {
        var btn = card.querySelector('[data-plan]');
        if (!btn) return;
        var slug = btn.getAttribute('data-plan');
        var plan = planMap[slug];
        if (!plan) {
          _warn('syncDOM', 'No DB plan for slug:', slug);
          return;
        }

        /* Update price text */
        var priceEl = card.querySelector('.prm-plan-price');
        if (priceEl && plan.price_inr != null) {
          priceEl.textContent = '\u20B9' + plan.price_inr;
        }

        /* Update plan name */
        var nameEl = card.querySelector('.prm-plan-name');
        if (nameEl && plan.name) {
          nameEl.textContent = plan.name;
        }

        /* Update duration */
        var durEl = card.querySelector('.prm-plan-duration');
        if (durEl) {
          var days = plan.duration_days || plan.trial_days || 0;
          if (days === 1) durEl.textContent = '\uD83D\uDCC5 1 Day';
          else if (days <= 15) durEl.textContent = '\uD83D\uDCC5 ' + days + ' Days';
          else if (days <= 31) durEl.textContent = '\uD83D\uDCC5 1 Month';
          else if (days <= 93) durEl.textContent = '\uD83D\uDCC5 3 Months';
          else if (days <= 190) durEl.textContent = '\uD83D\uDCC5 6 Months';
          else if (days <= 370) durEl.textContent = '\uD83D\uDCC5 1 Year';
          else durEl.textContent = '\uD83D\uDCC5 Lifetime';
        }

        /* Update badge if DB has one */
        if (plan.badge) {
          var badgeEl = card.querySelector('.prm-plan-badge');
          if (badgeEl) badgeEl.textContent = plan.badge;
        }

        /* Store price on button for PPAY to read */
        btn.setAttribute('data-price-inr', String(plan.price_inr));
        btn.setAttribute('data-plan-id', plan.id || '');
      });

      _log('syncDOM', 'DOM sync complete');
    } catch (e) {
      _warn('syncDOM', 'Error:', e);
    }
  }

  /* == 7 -- MEMBERSHIP STATUS (for dashboard badge) == */

  async function getMembershipStatus() {
    var client = _sb();
    if (!client) return { isPremium: false, planName: 'Free', expiresAt: null, daysLeft: 0 };

    try {
      var authRes = await client.auth.getUser();
      var user = authRes.data && authRes.data.user;
      if (!user) return { isPremium: false, planName: 'Free', expiresAt: null, daysLeft: 0 };

      var memRes = await client
        .from('user_memberships')
        .select('id, status, expires_at, plan_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (memRes.error || !memRes.data) {
        return { isPremium: false, planName: 'Free', expiresAt: null, daysLeft: 0 };
      }

      var mem = memRes.data;
      var now = Date.now();
      var expMs = mem.expires_at ? new Date(mem.expires_at).getTime() : 0;
      var isExpired = expMs > 0 && expMs <= now;

      if (isExpired) {
        return { isPremium: false, planName: 'Free', expiresAt: mem.expires_at, daysLeft: 0 };
      }

      /* Look up plan name from cache */
      var plans = await getPlans();
      var planName = 'Premium';
      for (var i = 0; i < plans.length; i++) {
        if (plans[i].id === mem.plan_id) {
          planName = plans[i].name || 'Premium';
          break;
        }
      }

      var daysLeft = expMs > 0 ? Math.ceil((expMs - now) / 86400000) : 0;

      return {
        isPremium:  true,
        planName:   planName,
        expiresAt:  mem.expires_at,
        daysLeft:   daysLeft,
      };
    } catch (e) {
      _warn('getMembershipStatus', 'Error:', e);
      return { isPremium: false, planName: 'Free', expiresAt: null, daysLeft: 0 };
    }
  }

  async function syncDashboardBadge() {
    try {
      var status = await getMembershipStatus();

      var planEl     = document.getElementById('dashPlan');
      var badgeRowEl = document.getElementById('dashBadgeRow');

      if (!planEl) return;

      if (status.isPremium) {
        planEl.textContent = '\uD83D\uDC51 ' + status.planName + ' Plan';
        if (badgeRowEl) badgeRowEl.style.display = '';
      } else {
        planEl.textContent = '\uD83C\uDF93 Free Plan';
        if (badgeRowEl) badgeRowEl.style.display = '';
      }

      _log('syncDashboardBadge', 'Badge updated:', status);
    } catch (e) {
      _warn('syncDashboardBadge', 'Error:', e);
    }
  }

  /* == 8 -- ADMIN SAVE HOOK == */

  async function onAdminSave() {
    _log('onAdminSave', 'Admin save detected -- auto-syncing...');

    invalidateCache();

    var syncOk = await syncToSiteConfig();

    await syncDOM();
    await syncDashboardBadge();

    window.dispatchEvent(new CustomEvent('studyria:pass:synced', {
      detail: { siteConfigSynced: syncOk, timestamp: new Date().toISOString() }
    }));

    _log('onAdminSave', 'Auto-sync complete', { siteConfigSynced: syncOk });
    return syncOk;
  }

  /* == 9 -- INIT == */

  async function _init() {
    _log('_init', 'PassSync v1.0 initializing...');

    await getPlans();
    await syncDOM();
    await syncDashboardBadge();

    var client = _sb();
    if (client && client.auth && client.auth.onAuthStateChange) {
      client.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          _log('_init', 'Auth event -- re-syncing:', event);
          invalidateCache();
          syncDashboardBadge();
        }
      });
    }

    window.addEventListener('studyria:admin:plan:saved', function () {
      _log('_init', 'Admin plan saved event received');
      onAdminSave();
    });

    _log('_init', 'PassSync v1.0 ready');
  }

  /* == 10 -- PUBLIC API == */

  window.PassSync = {
    _version:            '1.0',
    getPlans:            getPlans,
    getPlanBySlug:       getPlanBySlug,
    invalidateCache:     invalidateCache,
    syncToSiteConfig:    syncToSiteConfig,
    onAdminSave:         onAdminSave,
    syncDOM:             syncDOM,
    syncDashboardBadge:  syncDashboardBadge,
    getMembershipStatus: getMembershipStatus,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
