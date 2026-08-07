/* ═══════════════════════════════════════════════════════════════════════
   pass-renderer.js — Studyria Dynamic Pass Renderer  v3.0  (2026)
   ═══════════════════════════════════════════════════════════════════════

   Single source of truth: membership_plans (DB) → site_config → localStorage
   Renders ALL plans dynamically. No hardcoded prices.
   Auto-refreshes when admin saves from pass-management.js.

   PLAN SLUG CANONICAL MAP (used everywhere — single definition):
     trial_1day / trial_7day / trial_15day / monthly / quarterly
     half_year  / yearly     / lifetime

   PRICE SOURCE PRIORITY:
     1. membership_plans (DB) — most authoritative (admin edits DB directly)
     2. site_config.pass_management_config (admin panel saves here)
     3. localStorage cache (offline fallback)
     Never use hardcoded prices.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORAGE_KEY = 'studyria_pass_config';
  var _cfg         = null;
  var _loaded      = false;
  var _rendering   = false;

  /* ── SLUG MAP: name → canonical slug (single definition for whole app) ── */
  var SLUG_MAP = {
    '1 Day Trial':  'trial_1day',
    '7 Day Trial':  'trial_7day',
    '15 Day Trial': 'trial_15day',
    'Monthly':      'monthly',
    'Quarterly':    'quarterly',
    'Half Year':    'half_year',
    'Yearly':       'yearly',
    'Lifetime':     'lifetime',
  };

  /* ── CYCLE DAYS: slug → days (same as PPAY.CYCLE_DAYS — single source) ── */
  var CYCLE_DAYS = {
    trial_1day: 1, trial_7day: 7, trial_15day: 15,
    monthly: 30, quarterly: 90, half_year: 180,
    yearly: 365, lifetime: 36500,
  };

  /* ── CANONICAL DEFAULT PLANS (price comes from DB, this is just display fallback) ─ */
  var DEFAULT_PLANS = [
    { passId:'trial_1day',  name:'1 Day Trial',  offerPrice:9,   originalPrice:0,   duration:'1',   durationUnit:'days',    badge:'⚡ NEW',         badgeType:'blue',   buttonText:'Try Now',        icon:'⚡', gradient:'linear-gradient(135deg,#3d8ef8,#00c8e8)', order:1, active:true, discount:0 },
    { passId:'trial_7day',  name:'7 Day Trial',  offerPrice:29,  originalPrice:49,  duration:'7',   durationUnit:'days',    badge:'🌟 POPULAR',     badgeType:'green',  buttonText:'Get Pass',       icon:'🌟', gradient:'linear-gradient(135deg,#10d98e,#3d8ef8)', order:2, active:true, discount:41 },
    { passId:'trial_15day', name:'15 Day Trial', offerPrice:49,  originalPrice:99,  duration:'15',  durationUnit:'days',    badge:'🟢 POPULAR',     badgeType:'green',  buttonText:'Get Started',    icon:'🟢', gradient:'linear-gradient(135deg,#10d98e,#06b6d4)', order:3, active:true, discount:51 },
    { passId:'monthly',     name:'Monthly',      offerPrice:69,  originalPrice:149, duration:'30',  durationUnit:'days',    badge:'',               badgeType:'blue',   buttonText:'Subscribe',      icon:'🔵', gradient:'linear-gradient(135deg,#3d8ef8,#8b5cf6)', order:4, active:true, discount:54 },
    { passId:'quarterly',   name:'Quarterly',    offerPrice:249, originalPrice:449, duration:'90',  durationUnit:'days',    badge:'⭐ MOST POPULAR', badgeType:'purple', buttonText:'Best Choice',    icon:'🟣', gradient:'linear-gradient(135deg,#8b5cf6,#a855f7)', order:5, active:true, discount:45 },
    { passId:'half_year',   name:'Half Year',    offerPrice:449, originalPrice:899, duration:'180', durationUnit:'days',    badge:'👑 BEST VALUE',  badgeType:'gold',   buttonText:'Best Value',     icon:'👑', gradient:'linear-gradient(135deg,#f59e0b,#fbbf24)', order:6, active:true, discount:50 },
    { passId:'yearly',      name:'Yearly',       offerPrice:599, originalPrice:1499,duration:'365', durationUnit:'days',    badge:'🏆 BEST VALUE',  badgeType:'gold',   buttonText:'Get Yearly',     icon:'🏆', gradient:'linear-gradient(135deg,#fbbf24,#f59e0b)', order:7, active:true, discount:60 },
    { passId:'lifetime',    name:'Lifetime',     offerPrice:999, originalPrice:2999,duration:'0',   durationUnit:'lifetime',badge:'♾ LIFETIME',     badgeType:'gold',   buttonText:'Get Lifetime',   icon:'♾', gradient:'linear-gradient(135deg,#fbbf24,#f59e0b)', order:8, active:true, discount:67 },
  ];

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function _loadFromStorage() {
    try { var r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch(e) {}
    return null;
  }

  /* ── Resolve slug from a plan object (passId always wins) ── */
  function _slug(p) {
    return p.passId || SLUG_MAP[p.name] || (p.name || '').toLowerCase().replace(/\s+/g,'_');
  }

  /* ── Merge DB plans into config plans array ─────────────────────
     DB plans are authoritative for price. site_config is authoritative for
     display settings (badge, icon, gradient, buttonText, active status).
     Result: price always from DB, UI from admin panel config.
  ── */
  function _mergePlans(cfgPlans, dbPlans) {
    var dbBySlug = {};
    if (dbPlans && dbPlans.length) {
      dbPlans.forEach(function(p) { if (p.slug) dbBySlug[p.slug] = p; });
    }

    // Start with DEFAULT_PLANS to guarantee all 8 are present
    var base = JSON.parse(JSON.stringify(DEFAULT_PLANS));

    // Overlay with site_config plans (admin settings)
    if (cfgPlans && cfgPlans.length) {
      cfgPlans.forEach(function(cp) {
        var s = _slug(cp);
        var existing = base.find(function(b) { return b.passId === s; });
        if (existing) {
          // Overlay display settings from site_config
          if (cp.badge !== undefined)        existing.badge        = cp.badge;
          if (cp.badgeType !== undefined)    existing.badgeType    = cp.badgeType;
          if (cp.buttonText !== undefined)   existing.buttonText   = cp.buttonText;
          if (cp.icon !== undefined)         existing.icon         = cp.icon;
          if (cp.gradient !== undefined)     existing.gradient     = cp.gradient;
          if (cp.bgColor !== undefined)      existing.bgColor      = cp.bgColor;
          if (cp.order !== undefined)        existing.order        = cp.order;
          if (cp.active !== undefined)       existing.active       = cp.active;
          if (cp.name)                       existing.name         = cp.name;
          // Price from site_config (will be overridden by DB below if DB has it)
          if (cp.offerPrice !== undefined)   existing.offerPrice   = cp.offerPrice;
          if (cp.originalPrice !== undefined)existing.originalPrice= cp.originalPrice;
          if (cp.discount !== undefined)     existing.discount     = cp.discount;
        } else {
          // Unknown plan from site_config — add it
          cp.passId = cp.passId || s;
          base.push(cp);
        }
      });
    }

    // PRICE OVERRIDE from membership_plans DB (always wins)
    base.forEach(function(plan) {
      var db = dbBySlug[plan.passId];
      if (db) {
        if (typeof db.price_inr === 'number' && db.price_inr >= 0) {
          plan.offerPrice = db.price_inr;
        }
        if (db.is_active !== undefined) plan.active = db.is_active;
        if (db.name) plan.name = db.name;
        if (db.badge_label) plan.badge = plan.badge || db.badge_label;
      }
    });

    return base.filter(function(p) { return p.active !== false; })
               .sort(function(a,b) { return (a.order||99) - (b.order||99); });
  }

  /* ── Build feature list ── */
  function _features(cfg) {
    var base = ['All Pass Notes', 'Pass Reading Room'];
    if (cfg && cfg.features) {
      cfg.features.filter(function(f) { return f.active; })
        .sort(function(a,b) { return (a.order||0)-(b.order||0); })
        .forEach(function(f) { if (base.indexOf(f.name) === -1) base.push(f.name); });
    }
    return base;
  }

  /* ── Render pricing cards ── */
  function _renderCards(plans, cfg) {
    var grid = document.getElementById('prmPlansGrid') ||
               document.querySelector('.prm-plans-grid');
    if (!grid) return;
    if (!plans || !plans.length) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3,rgba(255,255,255,0.4))">No plans available. Please check back soon.</div>';
      return;
    }
    var showStrike   = !(cfg && cfg.pricing && cfg.pricing.showStrikePrice === false);
    var showDiscount = !(cfg && cfg.pricing && cfg.pricing.showDiscountBadge === false);
    var featuresList = _features(cfg);
    var h = '';
    plans.forEach(function(p) {
      var slug = p.passId || _slug(p);
      var durationText = p.durationUnit === 'lifetime'
        ? 'Lifetime Access'
        : (p.duration || CYCLE_DAYS[slug] || '?') + ' Days';
      var badgeHtml = p.badge
        ? '<div class="prm-plan-badge">' + _esc(p.badge) + '</div>' : '';
      var strikeHtml = (showStrike && p.originalPrice > p.offerPrice)
        ? '<span style="text-decoration:line-through;font-size:.75rem;color:var(--text3,rgba(255,255,255,0.4));margin-right:6px">₹' + p.originalPrice + '</span>' : '';
      var discHtml = (showDiscount && p.discount > 0)
        ? '<span style="font-size:.65rem;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(16,217,142,0.12);color:#10d98e;margin-left:6px">' + p.discount + '% OFF</span>' : '';
      var cardStyle = p.gradient ? 'style="background:' + p.gradient + ';"' : '';
      var featuresHtml = featuresList.slice(0, 6).map(function(f) { return '<li>' + _esc(f) + '</li>'; }).join('');
      h += '<div class="prm-plan-card" ' + cardStyle + '>'
        + badgeHtml
        + '<div class="prm-plan-emoji">' + _esc(p.icon || '⭐') + '</div>'
        + '<div class="prm-plan-name">' + _esc(p.name) + '</div>'
        + '<div class="prm-plan-price">' + strikeHtml + '₹' + p.offerPrice + discHtml + '</div>'
        + '<div class="prm-plan-only">Only</div>'
        + '<div class="prm-plan-duration">📅 ' + _esc(durationText) + '</div>'
        + '<ul class="prm-plan-features">' + featuresHtml + '</ul>'
        + '<button class="prm-plan-btn" data-plan="' + _esc(slug) + '" data-pass-id="' + _esc(slug) + '" '
        + 'onclick="(window.PPAY||window.PPAY_COMPAT||{checkout:function(){}}).checkout(\'' + _esc(slug) + '\', this)">'
        + _esc(p.buttonText || 'Get Pass') + ' →</button>'
        + '</div>';
    });
    grid.innerHTML = h;
  }

  function _renderHero(cfg) {
    if (!cfg || !cfg.hero) return;
    var el = document.querySelector('.prm-hero-title');
    if (el && cfg.hero.headline) el.innerHTML = _esc(cfg.hero.headline);
    var sub = document.querySelector('.prm-hero-sub');
    if (sub && cfg.hero.description) sub.textContent = cfg.hero.description;
  }

  function _renderBenefits(cfg) {
    if (!cfg || !cfg.benefits) return;
    var title = document.querySelector('.prm-section-title');
    if (title && cfg.benefits.sectionTitle) title.textContent = cfg.benefits.sectionTitle;
    var sub = document.querySelector('.prm-section-sub');
    if (sub && cfg.benefits.sectionSubtitle) sub.textContent = cfg.benefits.sectionSubtitle;
    var grid = document.querySelector('.prm-benefits-grid');
    if (grid && cfg.benefits.cards && cfg.benefits.cards.length) {
      grid.innerHTML = cfg.benefits.cards.map(function(c) {
        return '<div class="prm-benefit-card">'
          + '<div class="prm-benefit-icon" style="background:' + (c.color||'#fbbf24') + '20">' + _esc(c.icon||'⭐') + '</div>'
          + '<div class="prm-benefit-name">' + _esc(c.title) + '</div></div>';
      }).join('');
    }
  }

  /* ── Apply full config ── */
  function _applyConfig(cfg, dbPlans) {
    if (_rendering) return;
    _rendering = true;
    try {
      var plans = _mergePlans(cfg ? cfg.plans : null, dbPlans);
      _renderCards(plans, cfg);
      _renderHero(cfg);
      _renderBenefits(cfg);
      console.log('[PassRenderer v3] Rendered ' + plans.length + ' plans' + (dbPlans ? ' (prices from DB)' : ' (prices from config)'));
    } finally {
      _rendering = false;
    }
  }

  /* ── Fetch membership_plans from DB (price-authoritative) ── */
  function _fetchDBPlans(client) {
    return client
      .from('membership_plans')
      .select('slug, name, price_inr, is_active, badge_label, trial_days, sort_order')
      .order('sort_order', { ascending: true })
      .then(function(res) {
        if (res.error || !res.data) return null;
        return res.data;
      })
      .catch(function() { return null; });
  }

  /* ── Fetch site_config ── */
  function _fetchSiteConfig(client) {
    return client
      .from('site_config')
      .select('value')
      .eq('key', 'pass_management_config')
      .maybeSingle()
      .then(function(res) {
        if (res.error || !res.data || !res.data.value) return null;
        try { return JSON.parse(res.data.value); } catch(e) { return null; }
      })
      .catch(function() { return null; });
  }

  /* ── Main load: DB first, then overlay config, then localStorage ── */
  function _load(retry) {
    retry = retry || 0;
    var client = window.supabaseClient;
    if (!client) {
      if (retry < 5) { setTimeout(function() { _load(retry + 1); }, 800 * (retry + 1)); }
      else { _applyConfig(_loadFromStorage(), null); }
      return;
    }

    // Step 1: instant render from localStorage cache
    var cached = _loadFromStorage();
    if (cached && !_rendering) { _applyConfig(cached, null); }

    // Step 2: fetch both DB plans + site_config in parallel, then merge
    Promise.all([_fetchDBPlans(client), _fetchSiteConfig(client)])
      .then(function(results) {
        var dbPlans  = results[0];
        var siteCfg  = results[1];

        // Update localStorage if we got site_config
        if (siteCfg) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(siteCfg)); } catch(e) {}
        }

        var cfgToUse = siteCfg || cached;
        _applyConfig(cfgToUse, dbPlans);
      })
      .catch(function(e) {
        console.warn('[PassRenderer v3] Load error:', e);
        if (retry < 3) {
          setTimeout(function() { _load(retry + 1); }, 1500 * (retry + 1));
        } else {
          _applyConfig(cached, null);
        }
      });
  }

  /* ── Auto-refresh when admin saves ── */
  function _initEvents() {
    window.addEventListener('studyria:passConfigUpdated', function() {
      _cfg = _loadFromStorage();
      _load(0);
    });
    // Also refresh when premium page becomes visible
    document.addEventListener('studyria:pageChanged', function(e) {
      if (e.detail && e.detail.page === 'premium') { _load(0); }
    });
  }

  /* ── Public API ── */
  window.PassRenderer = {
    init:    function() { if (_loaded) return; _loaded = true; _initEvents(); _load(0); },
    refresh: function() { _loaded = true; _load(0); },
    SLUG_MAP: SLUG_MAP,
    CYCLE_DAYS: CYCLE_DAYS,
    DEFAULT_PLANS: DEFAULT_PLANS,
  };

  /* ── Hook into navigate() if it exists ── */
  var _origNav = window.navigate;
  if (typeof _origNav === 'function') {
    window.navigate = function(page) {
      var r = _origNav.apply(this, arguments);
      if (page === 'premium') { setTimeout(function() { window.PassRenderer.init(); _load(0); }, 300); }
      return r;
    };
  }

  /* ── Auto-init ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { window.PassRenderer.init(); }, 600);
    });
  } else {
    setTimeout(function() { window.PassRenderer.init(); }, 400);
  }

})();
