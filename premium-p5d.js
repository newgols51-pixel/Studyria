/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — PHASE 5D: Premium Experience & Membership Management
   File     : premium-p5d.js
   Namespace: window.P5D

   SAFETY CONTRACT (enforced — do not relax):
   ✅  Reads from:  user_memberships, membership_transactions, membership_plans
   ✅  Writes via:  window.PPAY.checkout() ONLY — zero new payment logic
   ✅  Zero new Razorpay / edge function / payment pipeline code
   ✅  Zero changes to: buyPDF, payment-service.js, auth, PDF reader
   ✅  Hooks into existing: switchMeTab(), renderDashboard(), PPAY events
   ✅  All CSS in premium-p5d.css (.p5d-* namespace)
   ✅  All functions under window.P5D namespace
   ✅  Idempotent — re-registering the tab button is safe
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  if (window.P5D && window.P5D._version === '5d-1.0') return;

  /* ─────────────────────────────────────────────────────────────────
     § UTILITIES
  ──────────────────────────────────────────────────────────────────*/

  function _sb() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  }
  function _user() { return window.currentUser || null; }
  function _uid()  { var u = _user(); return u ? (u.uid || u.id) : null; }

  function _nav(page) {
    if (typeof window.navigate === 'function') window.navigate(page);
  }
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function _fmtMoney(n) {
    return '₹' + (Number(n) || 0).toLocaleString('en-IN');
  }
  function _diffDays(isoA, isoB) {
    /* isoA - isoB in whole days, positive = isoA is later */
    return Math.ceil((new Date(isoA) - new Date(isoB)) / 86400000);
  }
  function _capitalise(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  /* In-memory state */
  var _cache = {
    membership:   null,   /* current user_memberships row */
    transactions: null,   /* array of membership_transactions */
    plans:        null,   /* array of membership_plans */
    fetchedAt:    0,
  };
  var _TX_PAGE  = 10;     /* transactions per page */
  var _txPage   = 1;

  /* ─────────────────────────────────────────────────────────────────
     § DATA LAYER  (direct Supabase reads — no edge functions)
  ──────────────────────────────────────────────────────────────────*/

  async function _fetchMembership(uid) {
    var sb = _sb();
    if (!sb || !uid) return null;
    try {
      var res = await sb
        .from('user_memberships')
        .select('id, plan_id, status, started_at, expires_at, auto_renew, cancelled_at')
        .eq('user_id', uid)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return res.error ? null : res.data;
    } catch (_) { return null; }
  }

  async function _fetchTransactions(uid, page) {
    var sb = _sb();
    if (!sb || !uid) return [];
    var from = (page - 1) * _TX_PAGE;
    var to   = from + _TX_PAGE - 1;
    try {
      var res = await sb
        .from('membership_transactions')
        .select('id, plan_id, provider, provider_tx_id, amount_inr, currency, status, notes, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .range(from, to);
      return res.error ? [] : (res.data || []);
    } catch (_) { return []; }
  }

  async function _fetchPlans() {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb
        .from('membership_plans')
        .select('id, slug, name, price_inr, billing_cycle, is_active')
        .eq('is_active', true)
        .order('price_inr', { ascending: true });
      return res.error ? [] : (res.data || []);
    } catch (_) { return []; }
  }

  async function _loadAll(forceRefresh) {
    var uid = _uid();
    if (!uid) return;

    var now = Date.now();
    var stale = (now - _cache.fetchedAt) > 60000; /* 1-min cache */
    if (!forceRefresh && !stale && _cache.fetchedAt) return;

    /* fetch in parallel */
    var results = await Promise.allSettled([
      _fetchMembership(uid),
      _fetchTransactions(uid, 1),
      _fetchPlans(),
    ]);

    _cache.membership   = results[0].value || null;
    _cache.transactions = results[1].value || [];
    _cache.plans        = results[2].value || [];
    _cache.fetchedAt    = now;
    _txPage = 1;
  }

  /* ─────────────────────────────────────────────────────────────────
     § MEMBERSHIP STATUS LOGIC
  ──────────────────────────────────────────────────────────────────*/

  function _getMembershipStatus(mem) {
    if (!mem) return 'none';
    if (mem.status !== 'active') return 'expired';
    var now = new Date();
    var exp = mem.expires_at ? new Date(mem.expires_at) : null;
    if (!exp || exp <= now) return 'expired';
    return 'active';
  }

  function _getDaysRemaining(mem) {
    if (!mem || !mem.expires_at) return 0;
    return Math.max(0, _diffDays(mem.expires_at, new Date().toISOString()));
  }

  function _getTotalDays(mem) {
    if (!mem || !mem.started_at || !mem.expires_at) return 30;
    return Math.max(1, _diffDays(mem.expires_at, mem.started_at));
  }

  function _getPlanName(planId) {
    if (!planId || !_cache.plans) return 'Premium';
    var p = _cache.plans.find(function(p){ return p.id === planId; });
    return p ? p.name : 'Premium';
  }

  function _getPlanSlug(planId) {
    if (!planId || !_cache.plans) return 'monthly';
    var p = _cache.plans.find(function(p){ return p.id === planId; });
    return p ? p.slug : 'monthly';
  }

  /* ─────────────────────────────────────────────────────────────────
     § HTML BUILDERS
  ──────────────────────────────────────────────────────────────────*/

  function _buildLoadingSkeleton() {
    return '<div class="p5d-loading-wrap">'
      + '<div class="p5d-skeleton p5d-loading-card"></div>'
      + '<div class="p5d-skeleton p5d-loading-line"></div>'
      + '<div class="p5d-skeleton p5d-loading-line" style="width:40%"></div>'
      + '</div>';
  }

  function _buildActiveMembershipCard(mem, status, days, totalDays) {
    var planName    = _getPlanName(mem.plan_id);
    var planSlug    = _getPlanSlug(mem.plan_id);
    var pct         = totalDays > 0 ? Math.min(100, Math.round((days / totalDays) * 100)) : 0;
    var daysClass   = days > 14 ? 'p5d-days-ok' : days > 5 ? 'p5d-days-warn' : 'p5d-days-crit';
    var barClass    = days > 14 ? '' : days > 5 ? 'p5d-bar-warn' : 'p5d-bar-crit';
    var isExpired   = status === 'expired';
    var statusLabel = isExpired ? 'Expired' : 'Active';
    var statusCls   = isExpired ? 'p5d-status-expired' : 'p5d-status-active';

    /* Renewal prompt (≤7 days remaining) */
    var renewPrompt = '';
    if (!isExpired && days <= 7) {
      renewPrompt = '<div class="p5d-renew-prompt">'
        + '<span class="p5d-renew-icon">⏰</span>'
        + '<span class="p5d-renew-text">Your membership expires in ' + days + ' day' + (days !== 1 ? 's' : '') + '. Renew now to avoid losing access!</span>'
        + '</div>';
    }

    /* Expired banner */
    var expiredBanner = '';
    if (isExpired) {
      expiredBanner = '<div class="p5d-expired-banner">'
        + '<span class="p5d-expired-icon">🔒</span>'
        + '<div class="p5d-expired-text">'
        + '<div class="p5d-expired-title">Membership Expired</div>'
        + '<div class="p5d-expired-sub">Your Premium access has ended. Renew to restore access to all Premium Handwritten Notes.</div>'
        + '</div>'
        + '</div>';
    }

    /* Action buttons */
    var renewSlug = planSlug || 'monthly';
    var actionRow = isExpired
      ? '<div class="p5d-action-row">'
          + '<button class="p5d-btn p5d-btn-primary" onclick="P5D.renewMembership(\'' + _esc(renewSlug) + '\',this)">🔄 Renew Membership</button>'
          + '<button class="p5d-btn p5d-btn-secondary" onclick="navigate(\'premium\')">👑 View Plans</button>'
          + '</div>'
      : '<div class="p5d-action-row">'
          + '<button class="p5d-btn p5d-btn-primary" onclick="P5D.extendMembership(\'' + _esc(renewSlug) + '\',this)">✨ Extend Membership</button>'
          + '<button class="p5d-btn p5d-btn-secondary" onclick="navigate(\'premium\')">⬆️ Upgrade Plan</button>'
          + '</div>';

    return renewPrompt
      + expiredBanner
      + '<div class="p5d-mem-card">'
      /* header */
      + '<div class="p5d-mem-card-header">'
      + '<span class="p5d-mem-crown">👑</span>'
      + '<div class="p5d-mem-title-block">'
      + '<div class="p5d-mem-plan-name">' + _esc(planName) + ' Membership</div>'
      + '<span class="p5d-mem-status-badge ' + statusCls + '">'
      + '<span class="p5d-status-dot"></span>' + statusLabel
      + '</span>'
      + '</div>'
      + '</div>'
      /* details grid */
      + '<div class="p5d-mem-details">'
      + '<div class="p5d-mem-detail-item">'
      + '<div class="p5d-mem-detail-label">Started</div>'
      + '<div class="p5d-mem-detail-val">' + _fmtDate(mem.started_at) + '</div>'
      + '</div>'
      + '<div class="p5d-mem-detail-item">'
      + '<div class="p5d-mem-detail-label">Expires</div>'
      + '<div class="p5d-mem-detail-val">' + _fmtDate(mem.expires_at) + '</div>'
      + '</div>'
      + '<div class="p5d-mem-detail-item">'
      + '<div class="p5d-mem-detail-label">Days Remaining</div>'
      + '<div class="p5d-mem-detail-val ' + daysClass + '">' + (isExpired ? '—' : days + ' days') + '</div>'
      + '</div>'
      + '<div class="p5d-mem-detail-item">'
      + '<div class="p5d-mem-detail-label">Plan</div>'
      + '<div class="p5d-mem-detail-val">' + _esc(planName) + '</div>'
      + '</div>'
      + '</div>'
      /* days bar (only if active) */
      + (!isExpired
        ? '<div class="p5d-days-bar-wrap">'
          + '<div class="p5d-days-bar-label">'
          + '<span>' + days + ' days left</span>'
          + '<span>' + pct + '%</span>'
          + '</div>'
          + '<div class="p5d-days-bar-track">'
          + '<div class="p5d-days-bar-fill ' + barClass + '" style="width:' + pct + '%"></div>'
          + '</div>'
          + '</div>'
        : '')
      /* action buttons */
      + actionRow
      + '</div>';
  }

  function _buildFreeUserCard() {
    return '<div class="p5d-free-card">'
      + '<div class="p5d-free-icon">🌟</div>'
      + '<div class="p5d-free-title">Upgrade to Premium</div>'
      + '<div class="p5d-free-sub">Unlock unlimited access to all Premium Handwritten Notes, ad-free reading, and exclusive member benefits.</div>'
      + '<div class="p5d-free-perks">'
      + '<span class="p5d-perk-chip">📚 Premium Notes</span>'
      + '<span class="p5d-perk-chip">📖 Reading Room</span>'
      + '<span class="p5d-perk-chip">🚫 Ad-Free</span>'
      + '<span class="p5d-perk-chip">🔖 Continue Reading</span>'
      + '<span class="p5d-perk-chip">🏅 Premium Badge</span>'
      + '<span class="p5d-perk-chip">💰 Member Discounts</span>'
      + '</div>'
      + '<button class="p5d-btn p5d-btn-primary" style="min-width:200px" onclick="navigate(\'premium\')">👑 View Plans &amp; Pricing</button>'
      + '</div>';
  }

  function _buildTransactionRow(tx) {
    var planName = '—';
    if (tx.notes) {
      try {
        var n = JSON.parse(tx.notes);
        if (n.plan_slug) planName = _capitalise(n.plan_slug);
      } catch(_) {}
    }
    if (planName === '—' && tx.plan_id) planName = _getPlanName(tx.plan_id);

    var statusCls = tx.status === 'completed' ? '' : 'p5d-status-failed';
    var statusLbl = tx.status === 'completed' ? 'Success' : _capitalise(tx.status || 'Unknown');
    var dateStr   = _fmtDate(tx.created_at);
    var amount    = _fmtMoney(tx.amount_inr);

    return '<div class="p5d-txn-row">'
      + '<div class="p5d-txn-icon">👑</div>'
      + '<div class="p5d-txn-info">'
      + '<div class="p5d-txn-plan">' + _esc(planName) + ' Plan</div>'
      + '<div class="p5d-txn-date">' + dateStr + ' · ' + _esc(tx.provider || 'Razorpay') + '</div>'
      + '</div>'
      + '<div class="p5d-txn-right">'
      + '<div class="p5d-txn-amount">' + amount + '</div>'
      + '<span class="p5d-txn-status ' + statusCls + '">' + _esc(statusLbl) + '</span>'
      + '</div>'
      + '</div>';
  }

  function _buildTransactionSection(transactions) {
    var html = '<div class="p5d-txn-section">'
      + '<div class="p5d-txn-title">📋 Transaction History</div>'
      + '<div class="p5d-txn-list" id="p5dTxnList">';

    if (!transactions || transactions.length === 0) {
      html += '<div class="p5d-txn-empty">No transactions yet.</div>';
    } else {
      transactions.forEach(function(tx) {
        html += _buildTransactionRow(tx);
      });
    }

    html += '</div>';

    /* Load more button (shown if exactly TX_PAGE rows returned) */
    if (transactions && transactions.length === _TX_PAGE) {
      html += '<div class="p5d-txn-load-more">'
        + '<button onclick="P5D.loadMoreTransactions()">Load More</button>'
        + '</div>';
    }

    html += '</div>';
    return html;
  }

  function _buildSuccessScreen(mem) {
    var planName = _getPlanName(mem ? mem.plan_id : null);
    var expiresAt = mem ? mem.expires_at : null;
    var days = mem ? _getDaysRemaining(mem) : 0;

    return '<div class="p5d-success-screen">'
      + '<div class="p5d-success-burst">🎉</div>'
      + '<div class="p5d-success-title">You\'re Premium!</div>'
      + '<div class="p5d-success-sub">Your membership is now active. Enjoy unlimited access to all Premium Handwritten Notes.</div>'
      + '<div class="p5d-success-card">'
      + '<div class="p5d-success-row"><span class="p5d-success-row-label">Plan</span><span class="p5d-success-row-val">' + _esc(planName) + '</span></div>'
      + '<div class="p5d-success-row"><span class="p5d-success-row-label">Status</span><span class="p5d-success-row-val" style="color:#10d98e">Active</span></div>'
      + '<div class="p5d-success-row"><span class="p5d-success-row-label">Expires</span><span class="p5d-success-row-val">' + _fmtDate(expiresAt) + '</span></div>'
      + '<div class="p5d-success-row"><span class="p5d-success-row-label">Days Remaining</span><span class="p5d-success-row-val" style="color:#10d98e">' + days + ' days</span></div>'
      + '</div>'
      + '<button class="p5d-btn p5d-btn-primary" style="max-width:240px;margin:0 auto" onclick="navigate(\'library\')">🚀 Browse Premium Notes</button>'
      + '</div>';
  }

  /* ─────────────────────────────────────────────────────────────────
     § MAIN RENDER — MEMBERSHIP TAB
  ──────────────────────────────────────────────────────────────────*/

  async function renderMembershipTab(opts) {
    opts = opts || {};
    var container = document.getElementById('dashMain');
    if (!container) return;

    /* Show skeleton while loading */
    container.innerHTML = '<div class="me-tab-panel">' + _buildLoadingSkeleton() + '</div>';

    /* Refresh cache */
    await _loadAll(opts.forceRefresh || false);

    var mem    = _cache.membership;
    var status = _getMembershipStatus(mem);
    var days   = _getDaysRemaining(mem);
    var total  = _getTotalDays(mem);

    var html = '<div class="me-tab-panel">';

    /* ── Show success screen if just purchased ── */
    if (opts.showSuccess && mem && status === 'active') {
      html += _buildSuccessScreen(mem);
      html += _buildTransactionSection(_cache.transactions);
      html += '</div>';
      container.innerHTML = html;
      _updatePremiumBadges(true);
      return;
    }

    /* ── Membership card ── */
    if (status === 'none') {
      html += _buildFreeUserCard();
    } else {
      html += _buildActiveMembershipCard(mem, status, days, total);
    }

    /* ── Transaction history ── */
    html += _buildTransactionSection(_cache.transactions);

    html += '</div>';
    container.innerHTML = html;

    /* Update premium badges across UI */
    _updatePremiumBadges(status === 'active');
  }

  /* ─────────────────────────────────────────────────────────────────
     § PREMIUM BADGE & UI INDICATORS
  ──────────────────────────────────────────────────────────────────*/

  function _updatePremiumBadges(isActive) {
    /* Nav avatar / plan badge */
    var planEl = document.getElementById('dashPlan');
    if (planEl) {
      if (isActive) {
        var mem = _cache.membership;
        planEl.innerHTML = '👑 ' + _esc(_getPlanName(mem ? mem.plan_id : null)) + ' <span class="p5d-premium-badge">PREMIUM</span>';
      } else {
        planEl.textContent = '🎓 Free Plan';
      }
      var badgeRow = document.getElementById('dashBadgeRow');
      if (badgeRow) badgeRow.style.display = '';
    }

    /* Header nav premium indicator */
    var navPrem = document.getElementById('p5dNavPremiumBadge');
    if (navPrem) navPrem.style.display = isActive ? 'inline-flex' : 'none';

    /* Tab pip — yellow dot on membership tab when premium is active */
    var tabBtn = document.getElementById('p5dMembershipTabBtn');
    if (tabBtn) {
      tabBtn.classList.toggle('p5d-has-pip', isActive);
    }

    /* Lock/unlock premium content cards in library */
    _updateLibraryLocks(isActive);
  }

  function _updateLibraryLocks(isActive) {
    /* Remove existing overlays if now active */
    if (isActive) {
      document.querySelectorAll('.p5d-locked-overlay').forEach(function(el) {
        el.remove();
      });
      return;
    }
    /* Add locked overlay to .pdf-card elements with data-premium="true" */
    document.querySelectorAll('.pdf-card[data-premium="true"]').forEach(function(card) {
      if (card.querySelector('.p5d-locked-overlay')) return; /* already locked */
      if (getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }
      var ov = document.createElement('div');
      ov.className = 'p5d-locked-overlay';
      ov.innerHTML = '<div class="p5d-locked-icon">🔒</div>'
        + '<div class="p5d-locked-label">Premium Only</div>'
        + '<div class="p5d-locked-sub">Tap to unlock</div>';
      ov.addEventListener('click', function(e) {
        e.stopPropagation();
        _nav('premium');
      });
      card.appendChild(ov);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     § TAB INJECTION — inject "Membership" tab into dashboard
  ──────────────────────────────────────────────────────────────────*/

  function _injectMembershipTab() {
    /* Avoid duplicate injection */
    if (document.getElementById('p5dMembershipTabBtn')) return;

    /* Find the tabs container */
    var tabsBar = document.querySelector('#page-dashboard .me-hero-tabs');
    if (!tabsBar) return;

    /* Build tab button */
    var btn = document.createElement('button');
    btn.className   = 'me-htab';
    btn.id          = 'p5dMembershipTabBtn';
    btn.dataset.tab = 'membership';
    btn.innerHTML   = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'
      + '</svg>'
      + ' Membership'
      + '<span class="p5d-tab-pip"></span>';

    btn.addEventListener('click', function() {
      if (typeof window.switchMeTab === 'function') window.switchMeTab('membership');
    });

    /* Insert BEFORE the sign-out button (last button in tabs) */
    var signOutBtn = tabsBar.querySelector('button[onclick="handleLogout()"]');
    if (signOutBtn) {
      tabsBar.insertBefore(btn, signOutBtn);
    } else {
      tabsBar.appendChild(btn);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     § HOOK INTO switchMeTab
  ──────────────────────────────────────────────────────────────────*/

  function _hookSwitchMeTab() {
    var orig = window.switchMeTab;
    if (!orig || orig._p5dHooked) return;

    window.switchMeTab = function(tab) {
      if (tab === 'membership') {
        /* Update active state manually */
        document.querySelectorAll('#page-dashboard .me-htab[data-tab]').forEach(function(b) {
          b.classList.toggle('active', b.dataset.tab === 'membership');
        });
        if (typeof window.dashTab !== 'undefined') window.dashTab = 'membership';
        renderMembershipTab();
        return;
      }
      return orig.apply(this, arguments);
    };
    window.switchMeTab._p5dHooked = true;
  }

  /* ─────────────────────────────────────────────────────────────────
     § PUBLIC ACTIONS
  ──────────────────────────────────────────────────────────────────*/

  /* Renew — calls PPAY.checkout with the same plan slug */
  function renewMembership(planSlug, btn) {
    if (!window.PPAY || !window.PPAY.checkout) {
      _nav('premium');
      return;
    }
    window.PPAY.checkout(planSlug || 'monthly', btn);
  }

  /* Extend active membership — same as renew */
  function extendMembership(planSlug, btn) {
    renewMembership(planSlug, btn);
  }

  /* Load more transactions */
  async function loadMoreTransactions() {
    var uid = _uid();
    if (!uid) return;
    _txPage++;
    var more = await _fetchTransactions(uid, _txPage);
    if (!more || more.length === 0) { _txPage--; return; }

    var list = document.getElementById('p5dTxnList');
    if (!list) return;
    more.forEach(function(tx) {
      var div = document.createElement('div');
      div.innerHTML = _buildTransactionRow(tx);
      list.appendChild(div.firstChild);
    });
    if (more.length < _TX_PAGE) {
      var lm = document.querySelector('.p5d-txn-load-more');
      if (lm) lm.remove();
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     § MEMBERSHIP ACTIVATED EVENT LISTENER
     Triggered by PPAY after successful payment
  ──────────────────────────────────────────────────────────────────*/

  function _onMembershipActivated() {
    /* Bust cache and re-render membership tab with success screen */
    _cache.fetchedAt = 0;

    /* If we're on the dashboard membership tab — show success */
    if (window.currentPage === 'dashboard' && window.dashTab === 'membership') {
      renderMembershipTab({ forceRefresh: true, showSuccess: true });
      return;
    }

    /* Otherwise navigate to dashboard membership tab */
    _nav('dashboard');
    /* Wait for dashboard to render, then switch to membership tab */
    setTimeout(function() {
      if (typeof window.switchMeTab === 'function') {
        window.switchMeTab('membership');
        /* After tab renders, show success */
        setTimeout(function() {
          renderMembershipTab({ forceRefresh: true, showSuccess: true });
        }, 300);
      }
    }, 600);
  }

  /* ─────────────────────────────────────────────────────────────────
     § OVERVIEW TAB — inject membership status card into existing overview
  ──────────────────────────────────────────────────────────────────*/

  async function injectOverviewMembershipCard() {
    /* Wait a tick for the overview HTML to be rendered by switchMeTab */
    await new Promise(function(r){ setTimeout(r, 80); });

    var uid = _uid();
    if (!uid) return;

    await _loadAll(false);

    var mem    = _cache.membership;
    var status = _getMembershipStatus(mem);
    var days   = _getDaysRemaining(mem);
    var total  = _getTotalDays(mem);

    /* Find the premium banner placeholder in overview */
    var banner = document.querySelector('#dashMain .me-premium-banner');
    if (!banner) return;

    if (status === 'active') {
      /* Replace "Unlock Better Learning" banner with active membership summary */
      banner.style.cssText = [
        'background:linear-gradient(135deg,rgba(245,158,11,.15) 0%,rgba(249,115,22,.10) 100%)',
        'border:1.5px solid rgba(245,158,11,.3)',
        'border-radius:16px',
        'padding:18px 20px',
        'display:flex',
        'align-items:center',
        'gap:14px',
      ].join(';');
      banner.innerHTML = '<span style="font-size:2rem;flex-shrink:0">👑</span>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:.95rem;font-weight:700;color:#f59e0b;margin-bottom:3px">Premium Active</div>'
        + '<div style="font-size:.75rem;color:#718096">'
        + _esc(_getPlanName(mem.plan_id)) + ' · '
        + (status === 'active' ? days + ' days remaining' : 'Expired ' + _fmtDate(mem.expires_at))
        + '</div>'
        + '</div>'
        + '<button class="p5d-btn p5d-btn-secondary" style="min-width:0;padding:9px 14px;font-size:.75rem" onclick="switchMeTab(\'membership\')">Manage →</button>';
    } else if (status === 'expired') {
      /* Show expired prompt in banner */
      banner.style.background = 'linear-gradient(135deg,rgba(255,77,109,.12) 0%,rgba(244,63,94,.08) 100%)';
      banner.style.border = '1.5px solid rgba(255,77,109,.25)';
      var renewSlug = _getPlanSlug(mem ? mem.plan_id : null);
      banner.innerHTML = '<span style="font-size:2rem;flex-shrink:0">🔒</span>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:.9rem;font-weight:700;color:#ff4d6d;margin-bottom:3px">Membership Expired</div>'
        + '<div style="font-size:.74rem;color:#718096">Renew to restore Premium access</div>'
        + '</div>'
        + '<button class="p5d-btn p5d-btn-primary" style="min-width:0;padding:9px 14px;font-size:.75rem;background:linear-gradient(135deg,#ff4d6d,#f43f5e);color:#fff" onclick="switchMeTab(\'membership\')">Renew →</button>';
    }
    /* If status === 'none', leave the original "Unlock Better Learning" banner */

    /* Update badges */
    _updatePremiumBadges(status === 'active');
  }

  /* ─────────────────────────────────────────────────────────────────
     § HOOK INTO OVERVIEW TAB RENDER
  ──────────────────────────────────────────────────────────────────*/

  function _hookOverviewTab() {
    var origSwitch = window.switchMeTab;
    if (!origSwitch) return;
    var hooked = origSwitch;

    /* We already hooked switchMeTab once for 'membership' tab.
       Now also intercept 'overview' to inject membership card */
    var prev = window.switchMeTab;
    window.switchMeTab = function(tab) {
      var ret = prev.apply(this, arguments);
      if (tab === 'overview') {
        injectOverviewMembershipCard();
      }
      return ret;
    };
    window.switchMeTab._p5dHooked = true;
  }

  /* ─────────────────────────────────────────────────────────────────
     § INIT
  ──────────────────────────────────────────────────────────────────*/

  function _init() {
    /* Listen for membership activated events from PPAY */
    window.addEventListener('studyria:membership:activated', _onMembershipActivated);

    /* Hook switchMeTab to intercept 'membership' tab */
    _hookSwitchMeTab();
    _hookOverviewTab();

    /* Inject CSS link if not already present */
    if (!document.getElementById('p5dCssLink')) {
      var link = document.createElement('link');
      link.id  = 'p5dCssLink';
      link.rel = 'stylesheet';
      link.href = 'premium-p5d.css';
      document.head.appendChild(link);
    }

    /* Observe dashboard page — inject tab button when it becomes visible */
    var _tabInjected = false;
    function _tryInjectTab() {
      var hero = document.getElementById('dashProfileHero');
      if (hero && hero.style.display !== 'none') {
        if (!_tabInjected) {
          _injectMembershipTab();
          _tabInjected = true;
        }
      }
    }

    /* MutationObserver on the dashboard page */
    var dashPage = document.getElementById('page-dashboard');
    if (dashPage) {
      var obs = new MutationObserver(function() { _tryInjectTab(); });
      obs.observe(dashPage, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    /* Also try immediately (in case dashboard is already visible) */
    _tryInjectTab();

    /* Re-inject on navigate events (if app dispatches them) */
    window.addEventListener('studyria:navigate', function(e) {
      if (e && e.detail && e.detail.page === 'dashboard') {
        setTimeout(_tryInjectTab, 200);
      }
    });

    /* Auto-inject 2s after init as final fallback */
    setTimeout(function() {
      _tryInjectTab();
    }, 2000);

    console.debug('[P5D v5d-1.0] initialized — Premium Experience & Membership Management');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ─────────────────────────────────────────────────────────────────
     § PUBLIC API
  ──────────────────────────────────────────────────────────────────*/
  window.P5D = {
    _version:              '5d-1.0',
    renderMembershipTab:   renderMembershipTab,
    renewMembership:       renewMembership,
    extendMembership:      extendMembership,
    loadMoreTransactions:  loadMoreTransactions,
    injectOverviewCard:    injectOverviewMembershipCard,
    refreshBadges:         function() {
      _loadAll(true).then(function() {
        var status = _getMembershipStatus(_cache.membership);
        _updatePremiumBadges(status === 'active');
      });
    },
  };

})();
