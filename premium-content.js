/**
 * premium-content.js — Studyria Premium Content Integration v2.3
 *
 * PHASE 1: Premium Handwritten Notes unlocked for active Premium Members.
 *
 * STORAGE: Uses existing `site_config` table (key/value store).
 *   key:   'premium_categories_config'
 *   value: JSON array of enabled category names
 *          e.g. '["Premium Handwritten Notes"]'
 *
 * ZERO new tables. ZERO schema changes. ZERO SQL migrations.
 *
 * SAFETY CONTRACT:
 *   ✅ Reads: user_memberships, membership_plans, site_config, categories, pdfs
 *   ✅ Writes: site_config ONLY (existing table, existing columns, key/value)
 *   ✅ Zero new payment logic — uses existing buyPDF() / PPAY
 *   ✅ Zero changes to payment-service.js, Razorpay, buyPDF, purchased_pdfs
 *   ✅ Individual purchases always work regardless of membership
 *   ✅ Lifetime purchased PDFs NEVER affected
 */
(function () {
  'use strict';
  if (window.SMCI && window.SMCI._version === 'pci-2.6') return;

  /* ── Constants ─────────────────────────────────────────────────── */
  var CACHE_TTL_MS      = 60000;    /* 1-min membership status cache */
  var CAT_CACHE_TTL_MS  = 120000;   /* 2-min category config cache   */
  var SITE_CONFIG_KEY   = 'premium_categories_config';
  var SECTION_ID        = 'smci-premium-notes-section';

  /* Phase 1 hardcoded default — used when site_config has no entry yet.
   * This is a safe client-side fallback only; the real source of truth
   * is site_config in Supabase (or this default if not yet configured). */
  var DEFAULT_ENABLED_CATS = ['Premium Handwritten Notes'];

  /* ── State ─────────────────────────────────────────────────────── */
  var _state = { isLifetime: false, role: 'viewer',
    isPremium: false, status: 'none', planName: 'Free', planSlug: null,
    expiresAt: null, daysLeft: 0, fetchedAt: 0, fetching: false
  };
  /* Category config cache */
  var _catCache    = { cats: null, fetchedAt: 0 };
  var _premPdfCache = { pdfs: null, fetchedAt: 0, ttlMs: 90000 }; /* 90s TTL */

  /* PERSISTENT PDF STORE — survives window.PDFS replacement by pdf-list.js.
   * When _getPremiumCategoryPdfs returns PDFs, they are stored here.
   * When _openReadingRoomById can't find a PDF in window.PDFS, it checks
   * this store before falling back to Supabase. */
  var _smciPdfStore = {}; /* { id: pdfObject } */

  /* ── Utilities ─────────────────────────────────────────────────── */
  function _sb()    { return window.supabaseClient || null; }
  function _user()  { return window.currentUser    || null; }
  function _uid()   { var u = _user(); return u ? (u.uid || u.id || null) : null; }
  function _toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); }
  function _esc(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _log(m, d)  { if (d !== undefined) console.debug('[SMCI]', m, d); else console.debug('[SMCI]', m); }
  function _warn(m, e) { console.warn('[SMCI]', m, e || ''); }

  /* ─────────────────────────────────────────────────────────────────
     § MEMBERSHIP STATUS
  ──────────────────────────────────────────────────────────────────*/
  async function _fetchStatus() {
    var client = _sb();
    if (!client) {
      Object.assign(_state, { isPremium: false, status: 'none', planName: 'Free',
        planSlug: null, expiresAt: null, daysLeft: 0, fetchedAt: Date.now(), fetching: false });
      return;
    }
    // FIX: window.currentUser may not be set yet on first load — fall back to auth.getUser()
    // then auth.getSession() — covers all auth timing edge cases
    var uid = _uid();
    if (!uid) {
      try {
        var authRes = await client.auth.getUser();
        uid = authRes && authRes.data && authRes.data.user ? authRes.data.user.id : null;
      } catch (_) {}
    }
    if (!uid) {
      try {
        var sessRes = await client.auth.getSession();
        uid = sessRes && sessRes.data && sessRes.data.session && sessRes.data.session.user
          ? sessRes.data.session.user.id : null;
      } catch (_) {}
    }
    if (!uid) {
      // FIX: Auth not ready yet — RETRY up to 3 times with 500ms delay
      _state._retries = (_state._retries || 0) + 1;
      if (_state._retries <= 3) {
        _log('_fetchStatus: uid null, retry ' + _state._retries + '/3 in 500ms');
        await new Promise(function(r) { setTimeout(r, 600); });
        return _fetchStatus();
      }
      _warn('_fetchStatus: auth never resolved after 3 retries');
      _state._retries = 0;
      Object.assign(_state, { isPremium: false, status: 'none', planName: 'Free',
        planSlug: null, expiresAt: null, daysLeft: 0, fetchedAt: Date.now(), fetching: false });
      return;
    }
    _state._retries = 0;
    _state.fetching = true;

    // ENTERPRISE: Try secure RPC function first (database-level validation)
    try {
      var rpcRes = await client.rpc('check_membership_status', { p_user_id: uid });
      if (!rpcRes.error && rpcRes.data) {
        var d = rpcRes.data;
        Object.assign(_state, {
          isPremium: !!d.isPremium,
          status: d.status || 'none',
          planName: d.planName || 'Free',
          planSlug: d.planSlug || null,
          expiresAt: d.expiresAt || null,
          daysLeft: d.daysLeft !== null ? d.daysLeft : 0,
          isLifetime: !!d.isLifetime,
          role: d.role || 'viewer',
          fetchedAt: Date.now(),
          fetching: false
        });
        _log('Status from RPC', { isPremium: d.isPremium, plan: d.planName, daysLeft: d.daysLeft, lifetime: d.isLifetime });
        return;
      }
    } catch (rpcErr) {
      _warn('_fetchStatus: RPC not available, using direct query fallback', rpcErr.message || rpcErr);
    }

    // FALLBACK: Direct query (existing working logic — preserved for backward compat)
    try {
      var memRes = await client.from('user_memberships')
        .select('id,plan_id,status,started_at,expires_at,is_lifetime,role')
        .eq('user_id', uid).order('expires_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      var mem = (!memRes.error && memRes.data) ? memRes.data : null;

      if (!mem || mem.status !== 'active') {
        Object.assign(_state, { isPremium: false, status: mem ? 'expired' : 'none',
          planName: 'Free', planSlug: null, expiresAt: mem ? mem.expires_at : null,
          daysLeft: 0, fetchedAt: Date.now(), fetching: false });
        return;
      }
      // Check lifetime
      if (mem.is_lifetime) {
        var planNameLT = 'Lifetime', planSlugLT = null;
        if (mem.plan_id) {
          try {
            var prLT = await client.from('membership_plans').select('name,slug').eq('id', mem.plan_id).maybeSingle();
            if (!prLT.error && prLT.data) { planNameLT = prLT.data.name || 'Lifetime'; planSlugLT = prLT.data.slug || null; }
          } catch (_) {}
        }
        Object.assign(_state, { isPremium: true, status: 'active', planName: planNameLT, planSlug: planSlugLT,
          expiresAt: null, daysLeft: null, isLifetime: true, role: mem.role || 'viewer',
          fetchedAt: Date.now(), fetching: false });
        _log('Lifetime premium', { plan: planNameLT });
        return;
      }
      var now = new Date(), exp = mem.expires_at ? new Date(mem.expires_at) : null;
      /* FIX: Lifetime members have expires_at = NULL + status='active'.
         NULL expiry means NEVER expires — should be treated as premium, NOT expired.
         Only mark expired if there IS an expiry date AND it's in the past. */
      if (exp && exp <= now) {
        Object.assign(_state, { isPremium: false, status: 'expired', planName: 'Free',
          planSlug: null, expiresAt: mem.expires_at, daysLeft: 0, fetchedAt: Date.now(), fetching: false });
        return;
      }
      var planName = 'Premium', planSlug = null;
      if (mem.plan_id) {
        try {
          var pr = await client.from('membership_plans').select('name,slug').eq('id', mem.plan_id).maybeSingle();
          if (!pr.error && pr.data) { planName = pr.data.name || 'Premium'; planSlug = pr.data.slug || null; }
        } catch (_) {}
      }
      var daysLeft = exp ? Math.max(0, Math.ceil((exp - now) / 86400000)) : 999999; /* lifetime = large number */
      Object.assign(_state, { isPremium: true, status: 'active', planName: planName, planSlug: planSlug,
        expiresAt: mem.expires_at, daysLeft: daysLeft, isLifetime: false, role: mem.role || 'viewer',
        fetchedAt: Date.now(), fetching: false });
      _log('Active premium', { plan: planName, daysLeft: daysLeft });
    } catch (e) {
      _warn('_fetchStatus exception', e);
      _state.isPremium = false; _state.status = 'none';
      _state.fetching = false; _state.fetchedAt = Date.now();
    }
  }

  /* INJECTION GUARD: After _injectStatus sets the correct status, don't
     let force=true override it for 3 seconds. This prevents the race
     where PRMDASH.render() force-refetches and gets a stale result
     while the navigate handler already determined the correct status. */
  var INJECTION_GUARD_MS = 3000;

  async function _getStatus(force) {
    var stale = (Date.now() - _state.fetchedAt) > CACHE_TTL_MS;
    var recentlyInjected = _state._injectedAt && (Date.now() - _state._injectedAt) < INJECTION_GUARD_MS;
    if ((force && !recentlyInjected) || stale || !_state.fetchedAt) await _fetchStatus();
    return Object.assign({}, _state);
  }

  /* _injectStatus: Allows external code (e.g. navigate('premium') handler)
     to inject the correct membership status directly into SMCI's cache.
     This ensures a SINGLE SOURCE OF TRUTH — the direct Supabase query
     result is propagated to all downstream consumers (PRMDASH, badges, etc.) */
  function _injectStatus(status) {
    if (!status) return;
    _state.isPremium  = !!status.isPremium;
    _state.status     = status.isPremium ? 'active' : 'none';
    _state.planName   = status.planName || (status.isPremium ? 'Premium' : 'Free');
    _state.planSlug   = status.planSlug || null;
    _state.expiresAt  = status.expiresAt || null;
    _state.daysLeft   = status.expiresAt
      ? Math.max(0, Math.ceil((new Date(status.expiresAt) - new Date()) / 86400000))
      : 0;
    _state.fetchedAt  = Date.now();
    _state._injectedAt = Date.now();
    _state.fetching   = false;
    _state._retries   = 0;
    _log('Status injected', { isPremium: _state.isPremium, planName: _state.planName, daysLeft: _state.daysLeft });
    /* Notify listeners that status was updated */
    try { window.dispatchEvent(new CustomEvent('smci:statusUpdated', { detail: Object.assign({}, _state) })); } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────────────
     § PREMIUM CATEGORY CONFIG
     Reads from site_config table (existing key/value store).
     Falls back to DEFAULT_ENABLED_CATS if not yet configured.
  ──────────────────────────────────────────────────────────────────*/
  async function _fetchCategoryConfig(force) {
    var sb = _sb();
    /* If no supabase, use hardcoded default */
    if (!sb) return DEFAULT_ENABLED_CATS.slice();

    var stale = (Date.now() - _catCache.fetchedAt) > CAT_CACHE_TTL_MS;
    if (!force && !stale && _catCache.cats !== null) return _catCache.cats.slice();

    try {
      var res = await sb.from('site_config')
        .select('value')
        .eq('key', SITE_CONFIG_KEY)
        .maybeSingle();

      if (res.error || !res.data) {
        /* No config saved yet — use Phase 1 default */
        _catCache.cats = DEFAULT_ENABLED_CATS.slice();
        _catCache.fetchedAt = Date.now();
        _log('Category config: using Phase 1 default', DEFAULT_ENABLED_CATS);
        return _catCache.cats.slice();
      }

      var parsed = [];
      try { parsed = JSON.parse(res.data.value); } catch (_) { parsed = DEFAULT_ENABLED_CATS.slice(); }
      if (!Array.isArray(parsed)) parsed = DEFAULT_ENABLED_CATS.slice();

      _catCache.cats = parsed;
      _catCache.fetchedAt = Date.now();
      _log('Category config loaded', parsed);
      return parsed.slice();
    } catch (e) {
      _warn('_fetchCategoryConfig error', e);
      /* On error use default — never block premium users */
      return _catCache.cats || DEFAULT_ENABLED_CATS.slice();
    }
  }

  async function _getEnabledCategoryNames(force) {
    var cats = await _fetchCategoryConfig(force);
    return cats.map(function(n) { return (n || '').toLowerCase().trim(); });
  }

  async function _isPdfInPremiumCategory(pdf, enabledCatsLower) {
    if (!enabledCatsLower || enabledCatsLower.length === 0) return false;
    var pdfCat = (pdf.category || '').toLowerCase().trim();
    if (!pdfCat) return false;
    /* BUG-1 FIX: exact match ONLY — never partial/includes */
    return enabledCatsLower.some(function(ec) {
      return pdfCat === ec;
    });
  }

  async function _getPremiumCategoryPdfs(force) {
    var enabledLower = await _getEnabledCategoryNames(force);
    if (enabledLower.length === 0) return [];

    /* FIX (BUG-1): Check module-level cache first — avoids repeated Supabase round-trips */
    if (!force && _premPdfCache.pdfs && _premPdfCache.pdfs.length > 0) {
      var cacheAge = Date.now() - _premPdfCache.fetchedAt;
      if (cacheAge < _premPdfCache.ttlMs) {
        _log('_getPremiumCategoryPdfs: using module cache (' + _premPdfCache.pdfs.length + ' PDFs)');
        return _premPdfCache.pdfs.slice();
      }
    }

    /* PRIMARY: filter window.PDFS (already loaded client-side array). */
    var localPdfs = (window.PDFS || []).filter(function(p) {
      if (!p || !p.title) return false;
      var pdfCat = (p.category || '').toLowerCase().trim();
      if (!pdfCat) return false;
      return enabledLower.some(function(ec) { return pdfCat === ec; });
    });

    if (localPdfs.length > 0) {
      _premPdfCache.pdfs = localPdfs; _premPdfCache.fetchedAt = Date.now();
      localPdfs.forEach(function(p) { _smciPdfStore[String(p.id)] = p; });
      return localPdfs;
    }

    /* Supabase fallback — only runs when window.PDFS is not yet populated */
    var sb = _sb();
    if (!sb) return [];
    /* Use original-case category names for the .in() query */
    var enabledOrig = await _fetchCategoryConfig(force);
    try {
      _log('_getPremiumCategoryPdfs: Supabase fallback query', { categories: enabledOrig });
      var res = await sb.from('pdfs')
        .select('id,title,category,price,cover_url,cover_image,pdf_url,free,slug,rating,downloads,discount,status')
        .in('category', enabledOrig)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(100);
      if (res.error) { _warn('Supabase PDF fetch error', res.error.message); return []; }
      _log('_getPremiumCategoryPdfs: Supabase returned', { count: (res.data||[]).length });
      var rows = res.data || [];
      /* Double-check exact match (server .in() is case-sensitive in Postgres) */
      var matched = rows.filter(function(p) {
        var pdfCat = (p.category || '').toLowerCase().trim();
        return enabledLower.some(function(ec) { return pdfCat === ec; });
      });
      /* FIX (BUG-1): Store in module cache AND merge into window.PDFS */
      if (matched.length > 0) {
        _premPdfCache.pdfs = matched; _premPdfCache.fetchedAt = Date.now();
        matched.forEach(function(p) {
          _smciPdfStore[String(p.id)] = p;
          if (!window.PDFS) window.PDFS = [];
          if (!window.PDFS.some(function(x) { return String(x.id) === String(p.id); })) {
            window.PDFS.push(p);
          }
        });
      }
      return matched;
    } catch (e) { _warn('Supabase PDF fallback error', e); return []; }
  }

  /* ─────────────────────────────────────────────────────────────────
     § SIGNED URL RESOLVER
  ──────────────────────────────────────────────────────────────────*/
  async function _resolveSignedUrl(rawUrl, client) {
    if (!rawUrl || rawUrl === '#') return '';
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      var m = rawUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
      if (!m) return rawUrl;
      rawUrl = decodeURIComponent(m[1]);
    }
    try {
      var res = await client.storage.from('pdfs').createSignedUrl(rawUrl, 3600);
      if (res.error) { _warn('signedUrl error', res.error.message); return ''; }
      return res.data.signedUrl || '';
    } catch (e) { _warn('signedUrl ex', e); return ''; }
  }

  /* ─────────────────────────────────────────────────────────────────
     § buyPDF PATCH — premium bypass for category-enabled PDFs only
  ──────────────────────────────────────────────────────────────────*/
  /* ════════════════════════════════════════════════════════════════
     § READING ROOM — Secure in-page PDF.js reader for premium members
     Features: PDF.js rendering, watermark, page navigation,
     reading progress (localStorage), resume last page, reader toolbar
     ════════════════════════════════════════════════════════════════ */
  var _rrOverlay = null;
  var _rrPdfDoc = null;
  var _rrCurrentPage = 1;
  var _rrTotalPages = 0;
  var _rrScale = 1.3;
  var _rrPdfId = null;
  var _rrRenderTask = null;
  var _rrTheme = 'dark';
  var _rrBookmarks = [];
  var _rrReadingStart = 0;
  var _rrReadingSeconds = 0;
  var _rrAntiCopyHandlers = null;

  /* ── THEME SYSTEM (Dark / Light / Sepia) ── */
  var _rrThemes = {
    dark:  { bg:'#0b0e14', panel:'#11151c', border:'rgba(255,255,255,0.06)', text:'#fff', subtext:'rgba(255,255,255,0.4)', btnBg:'rgba(255,255,255,.06)', btnBorder:'rgba(255,255,255,.12)' },
    light: { bg:'#f5f0e8', panel:'#fff', border:'rgba(0,0,0,0.08)', text:'#1c1b1a', subtext:'rgba(0,0,0,0.4)', btnBg:'rgba(0,0,0,.04)', btnBorder:'rgba(0,0,0,.1)' },
    sepia: { bg:'#1a140e', panel:'#231910', border:'rgba(212,180,140,0.12)', text:'#f0e4d0', subtext:'rgba(212,180,140,0.45)', btnBg:'rgba(212,180,140,.06)', btnBorder:'rgba(212,180,140,.15)' }
  };
  function _rrLoadTheme() {
    try { return localStorage.getItem('studyria_rr_theme') || 'dark'; } catch(e) { return 'dark'; }
  }
  function _rrApplyTheme(theme) {
    if (!_rrOverlay) return;
    var t = _rrThemes[theme] || _rrThemes.dark;
    _rrOverlay.style.background = t.bg;
    var header = _rrOverlay.querySelector('#rrHeader');
    var footer = _rrOverlay.querySelector('#rrFooter');
    var canvasWrap = _rrOverlay.querySelector('#rrCanvasWrap');
    if (header) { header.style.background = t.panel; header.style.borderBottomColor = t.border; }
    if (footer) { footer.style.background = t.panel; footer.style.borderTopColor = t.border; }
    if (canvasWrap) canvasWrap.style.background = t.bg;
    /* Update all buttons */
    var btns = _rrOverlay.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.id && b.id.indexOf('rrTheme') === 0) continue;
      b.style.background = t.btnBg;
      b.style.borderColor = t.btnBorder;
      b.style.color = t.text;
    }
    /* Update inputs */
    var inputs = _rrOverlay.querySelectorAll('input');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].style.background = t.btnBg;
      inputs[j].style.borderColor = t.btnBorder;
      inputs[j].style.color = t.text;
    }
    /* Update subtext elements */
    var subs = _rrOverlay.querySelectorAll('[data-rr-subtext]');
    for (var k = 0; k < subs.length; k++) subs[k].style.color = t.subtext;
    /* Update zoom label */
    var zl = _rrOverlay.querySelector('#rrZoomLabel');
    if (zl) zl.style.color = t.subtext;
    /* Update theme button active states */
    ['dark','light','sepia'].forEach(function(tn) {
      var btn = _rrOverlay.querySelector('#rrTheme' + tn);
      if (btn) {
        btn.style.opacity = tn === theme ? '1' : '0.4';
        btn.style.background = tn === theme ? t.btnBg : 'transparent';
      }
    });
    _rrTheme = theme;
    try { localStorage.setItem('studyria_rr_theme', theme); } catch(e) {}
  }

  /* ── BOOKMARK SYSTEM ── */
  function _rrGetBookmarkKey(pdfId) { return 'studyria_rr_bm_' + pdfId; }
  function _rrLoadBookmarks(pdfId) {
    try {
      var raw = localStorage.getItem(_rrGetBookmarkKey(pdfId));
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }
  function _rrSaveBookmarks(pdfId, marks) {
    try { localStorage.setItem(_rrGetBookmarkKey(pdfId), JSON.stringify(marks)); } catch(e) {}
  }
  function _rrToggleBookmark(pdfId, page) {
    var marks = _rrLoadBookmarks(pdfId);
    var idx = marks.indexOf(page);
    if (idx >= 0) marks.splice(idx, 1);
    else marks.push(page);
    marks.sort(function(a,b){ return a-b; });
    _rrSaveBookmarks(pdfId, marks);
    return marks;
  }
  function _rrUpdateBookmarkBtn() {
    var btn = _rrOverlay ? _rrOverlay.querySelector('#rrBookmarkBtn') : null;
    if (!btn) return;
    var isMarked = _rrBookmarks.indexOf(_rrCurrentPage) >= 0;
    btn.textContent = isMarked ? '\u2605' : '\u2606';
    btn.style.color = isMarked ? '#fbbf24' : '';
    btn.title = isMarked ? 'Remove bookmark' : 'Add bookmark';
  }
  function _rrRenderBookmarkMarkers() {
    if (!_rrOverlay) return;
    var bar = _rrOverlay.querySelector('#rrProgressBg');
    if (!bar || _rrTotalPages < 1) return;
    /* Remove old markers */
    var old = bar.querySelectorAll('.rr-bm-mark');
    for (var i = 0; i < old.length; i++) old[i].remove();
    /* Add new markers */
    for (var j = 0; j < _rrBookmarks.length; j++) {
      var pct = (_rrBookmarks[j] / _rrTotalPages) * 100;
      var mark = document.createElement('div');
      mark.className = 'rr-bm-mark';
      mark.style.cssText = 'position:absolute;top:0;left:' + pct + '%;width:2px;height:100%;background:#fbbf24;opacity:.7;pointer-events:none';
      bar.appendChild(mark);
    }
  }

  /* ── READING TIME TRACKING ── */
  function _rrStartTimer() { _rrReadingStart = Date.now(); }
  function _rrStopTimer() {
    if (_rrReadingStart) {
      _rrReadingSeconds += Math.round((Date.now() - _rrReadingStart) / 1000);
      _rrReadingStart = 0;
    }
    return _rrReadingSeconds;
  }

  /* ── ANTI-COPY / ANTI-DOWNLOAD ── */
  function _rrAntiCopyOn() {
    if (!_rrOverlay) return;
    function block(e) { e.preventDefault(); return false; }
    function blockKeys(e) {
      if ((e.ctrlKey || e.metaKey) && ['s','c','p','u'].indexOf((e.key||'').toLowerCase()) >= 0) {
        e.preventDefault(); return false;
      }
    }
    _rrOverlay.addEventListener('contextmenu', block);
    _rrOverlay.addEventListener('selectstart', block);
    _rrOverlay.addEventListener('copy', block);
    _rrOverlay.addEventListener('keydown', blockKeys);
    _rrAntiCopyHandlers = { block: block, blockKeys: blockKeys };
  }
  function _rrAntiCopyOff() {
    if (!_rrOverlay || !_rrAntiCopyHandlers) return;
    _rrOverlay.removeEventListener('contextmenu', _rrAntiCopyHandlers.block);
    _rrOverlay.removeEventListener('selectstart', _rrAntiCopyHandlers.block);
    _rrOverlay.removeEventListener('copy', _rrAntiCopyHandlers.block);
    _rrOverlay.removeEventListener('keydown', _rrAntiCopyHandlers.blockKeys);
    _rrAntiCopyHandlers = null;
  }

  function _rrWatermarkText() {
    var u = _user();
    if (u) {
      var email = (u.email || '').split('@')[0].slice(0, 12);
      return 'studyria.in \u00b7 ' + email;
    }
    return 'studyria.in \u00b7 Premium';
  }

  function _rrGetProgressKey(pdfId) {
    return 'studyria_rr_progress_' + pdfId;
  }

  function _rrSaveProgress(pdfId, page, total) {
    try {
      localStorage.setItem(_rrGetProgressKey(pdfId), JSON.stringify({ page: page, total: total, zoom: _rrScale, seconds: _rrReadingSeconds + (_rrReadingStart ? Math.round((Date.now()-_rrReadingStart)/1000) : 0), ts: Date.now() }));
    } catch(e) {}
  }

  function _rrLoadProgress(pdfId) {
    try {
      var raw = localStorage.getItem(_rrGetProgressKey(pdfId));
      if (raw) {
        var p = JSON.parse(raw);
        return p.page || 1;
      }
    } catch(e) {}
    return 1;
  }

  function _rrClose() {
    /* Stop reading timer and save final time */
    _rrStopTimer();
    if (_rrPdfId) _rrSaveProgress(_rrPdfId, _rrCurrentPage, _rrTotalPages);
    /* Remove anti-copy listeners */
    _rrAntiCopyOff();
    if (_rrRenderTask) { try { _rrRenderTask.cancel(); } catch(e) {} _rrRenderTask = null; }
    if (_rrOverlay) {
      _rrOverlay.style.opacity = '0';
      setTimeout(function() {
        if (_rrOverlay) { _rrOverlay.remove(); _rrOverlay = null; }
      }, 200);
    }
    if (_rrPdfDoc) { try { _rrPdfDoc.cleanup(); } catch(e) {} _rrPdfDoc = null; }
    document.body.style.overflow = '';
  }

  async function _rrRenderPage(pageNum) {
    if (!_rrPdfDoc || !_rrOverlay) return;
    var canvas = _rrOverlay.querySelector('#rrCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // Cancel any pending render
    if (_rrRenderTask) { try { _rrRenderTask.cancel(); } catch(e) {} }

    var page;
    try {
      page = await _rrPdfDoc.getPage(pageNum);
    } catch(e) { _warn('RR: getPage failed', e); return; }

    var viewport = page.getViewport({ scale: _rrScale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    _rrRenderTask = page.render({ canvasContext: ctx, viewport: viewport });
    try {
      await _rrRenderTask.promise;
      _rrRenderTask = null;
    } catch(e) {
      if (e && e.name !== 'RenderingCancelledException') _warn('RR: render failed', e);
      return;
    }

    // Burn watermark into canvas
    var wm = _rrWatermarkText();
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold ' + Math.max(14, canvas.width * 0.035) + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var step = canvas.width * 0.4;
    for (var x = -canvas.width; x < canvas.width * 2; x += step) {
      for (var y = -canvas.height; y < canvas.height * 2; y += step * 0.6) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(wm, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();

    // Update UI
    _rrCurrentPage = pageNum;
    var indicator = _rrOverlay.querySelector('#rrPageIndicator');
    if (indicator) indicator.textContent = pageNum + ' / ' + _rrTotalPages;
    var progress = _rrOverlay.querySelector('#rrProgressFill');
    if (progress) progress.style.width = Math.round((pageNum / _rrTotalPages) * 100) + '%';
    var progressTxt = _rrOverlay.querySelector('#rrProgressText');
    if (progressTxt) progressTxt.textContent = Math.round((pageNum / _rrTotalPages) * 100) + '%';

    // Save progress
    _rrSaveProgress(_rrPdfId, pageNum, _rrTotalPages);

    // Enable/disable nav buttons
    var prevBtn = _rrOverlay.querySelector('#rrPrevBtn');
    var nextBtn = _rrOverlay.querySelector('#rrNextBtn');
    if (prevBtn) prevBtn.style.opacity = pageNum <= 1 ? '0.3' : '1';
    if (nextBtn) nextBtn.style.opacity = pageNum >= _rrTotalPages ? '0.3' : '1';

    // Update bookmark button and markers
    _rrUpdateBookmarkBtn();
    _rrRenderBookmarkMarkers();
  }

  /* LAZY-LOAD pdf.js on demand — fixes "PDF reader not loaded" error.
   * pdf.js is loaded with defer in index.html, but CDN failures or timing
   * issues can leave window.pdfjsLib undefined. This loader fetches it
   * dynamically before giving up. */
  var _pdfjsLoading = null;
  function _ensurePdfjs() {
    if (window.pdfjsLib) return Promise.resolve(true);
    if (_pdfjsLoading) return _pdfjsLoading;
    var src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js';
    var worker = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
    _pdfjsLoading = new Promise(function(resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function() {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
          resolve(true);
        } else {
          _warn('pdf.js script loaded but window.pdfjsLib still undefined');
          resolve(false);
        }
      };
      s.onerror = function() {
        _warn('pdf.js CDN script failed to load');
        _pdfjsLoading = null; /* allow retry */
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return _pdfjsLoading;
  }

  async function _openReadingRoom(pdf, signedUrl) {
    if (!signedUrl) { _toast('PDF URL not available.', 'error'); return; }
    if (!window.pdfjsLib) {
      _log('pdfjsLib not loaded — lazy loading...');
      var loaded = await _ensurePdfjs();
      if (!loaded) { _toast('PDF reader not loaded. Please refresh.', 'error'); return; }
    }

    _rrPdfId = String(pdf.id);

    // Close any existing overlay
    if (_rrOverlay) _rrClose();

    // Create overlay
    _rrOverlay = document.createElement('div');
    _rrOverlay.id = 'smciReadingRoom';
    _rrOverlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'z-index:999999', 'background:#0b0e14',
      'display:flex', 'flex-direction:column',
      'opacity:0', 'transition:opacity .2s ease'
    ].join(';') + ';';
    _rrTheme = _rrLoadTheme();
    _rrBookmarks = _rrLoadBookmarks(_rrPdfId);
    _rrReadingSeconds = 0;
    var th = _rrThemes[_rrTheme] || _rrThemes.dark;
    _rrOverlay.innerHTML = [
      '<div id="rrHeader" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:' + th.panel + ';border-bottom:1px solid ' + th.border + ';flex-shrink:0">',
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">',
          '<button id="rrCloseBtn" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:8px;padding:6px 12px;font-size:.8rem;color:' + th.text + ';cursor:pointer;flex-shrink:0">\u2190 Close</button>',
          '<div style="min-width:0;overflow:hidden">',
            '<div style="font-size:.82rem;font-weight:700;color:#fbbf24;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(pdf.title || 'Premium PDF') + '</div>',
            '<div data-rr-subtext style="font-size:.65rem;color:' + th.subtext + '">\uD83D\uDC51 Premium Reading Room</div>',
          '</div>',
        '</div>',
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">',
          /* Theme buttons */
          '<button id="rrThemeDark" title="Dark theme" style="background:' + (_rrTheme==='dark' ? th.btnBg : 'transparent') + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:28px;height:28px;color:' + th.text + ';cursor:pointer;font-size:.8rem;opacity:' + (_rrTheme==='dark'?'1':'0.4') + '">\u25CF</button>',
          '<button id="rrThemeLight" title="Light theme" style="background:' + (_rrTheme==='light' ? th.btnBg : 'transparent') + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:28px;height:28px;color:' + th.text + ';cursor:pointer;font-size:.8rem;opacity:' + (_rrTheme==='light'?'1':'0.4') + '">\u25CB</button>',
          '<button id="rrThemeSepia" title="Sepia theme" style="background:' + (_rrTheme==='sepia' ? th.btnBg : 'transparent') + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:28px;height:28px;color:' + th.text + ';cursor:pointer;font-size:.8rem;opacity:' + (_rrTheme==='sepia'?'1':'0.4') + '">\u25D0</button>',
          '<div style="width:1px;height:24px;background:' + th.border + ';margin:0 4px"></div>',
          /* Bookmark button */
          '<button id="rrBookmarkBtn" title="Add bookmark" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:32px;height:32px;color:' + th.text + ';cursor:pointer;font-size:1rem">\u2606</button>',
          '<div style="width:1px;height:24px;background:' + th.border + ';margin:0 4px"></div>',
          /* Zoom controls */
          '<button id="rrZoomOut" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:32px;height:32px;color:' + th.text + ';cursor:pointer;font-size:1rem">\u2212</button>',
          '<span id="rrZoomLabel" data-rr-subtext style="font-size:.72rem;color:' + th.subtext + ';min-width:36px;text-align:center">130%</span>',
          '<button id="rrZoomIn" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;width:32px;height:32px;color:' + th.text + ';cursor:pointer;font-size:1rem">+</button>',
        '</div>',
      '</div>',
      '<div id="rrCanvasWrap" style="flex:1;overflow:auto;display:flex;justify-content:center;padding:16px;-webkit-overflow-scrolling:touch;background:' + th.bg + '">',
        '<canvas id="rrCanvas" style="max-width:100%;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,0.5)"></canvas>',
      '</div>',
      '<div id="rrFooter" style="display:flex;align-items:center;justify-content:center;gap:16px;padding:10px 16px;background:' + th.panel + ';border-top:1px solid ' + th.border + ';flex-shrink:0">',
        '<button id="rrPrevBtn" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:8px;padding:8px 16px;font-size:.8rem;color:' + th.text + ';cursor:pointer">\u2190 Prev</button>',
        '<div style="display:flex;align-items:center;gap:8px">',
          '<input id="rrPageInput" type="number" min="1" value="1" style="width:48px;text-align:center;background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:6px;padding:4px 6px;color:' + th.text + ';font-size:.78rem">',
          '<span data-rr-subtext style="font-size:.72rem;color:' + th.subtext + '">/</span>',
          '<span id="rrPageIndicator" data-rr-subtext style="font-size:.72rem;color:' + th.subtext + '">1 / 1</span>',
        '</div>',
        '<button id="rrNextBtn" style="background:' + th.btnBg + ';border:1px solid ' + th.btnBorder + ';border-radius:8px;padding:8px 16px;font-size:.8rem;color:' + th.text + ';cursor:pointer">Next \u2192</button>',
      '</div>',
      '<div id="rrProgressBg" style="height:3px;background:rgba(255,255,255,0.04);flex-shrink:0;position:relative;overflow:visible">',
        '<div id="rrProgressFill" style="height:100%;width:0%;background:linear-gradient(90deg,#fbbf24,#f59e0b);transition:width .3s ease;border-radius:0 2px 2px 0"></div>',
        '<span id="rrProgressText" data-rr-subtext style="position:absolute;right:8px;top:-18px;font-size:.65rem;color:' + th.subtext + '">0%</span>',
      '</div>',
    ].join('');

    document.body.appendChild(_rrOverlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function() { _rrOverlay.style.opacity = '1'; });

    // Wire events
    _rrOverlay.querySelector('#rrCloseBtn').addEventListener('click', _rrClose);
    _rrOverlay.querySelector('#rrPrevBtn').addEventListener('click', function() {
      if (_rrCurrentPage > 1) _rrRenderPage(_rrCurrentPage - 1);
    });
    _rrOverlay.querySelector('#rrNextBtn').addEventListener('click', function() {
      if (_rrCurrentPage < _rrTotalPages) _rrRenderPage(_rrCurrentPage + 1);
    });
    _rrOverlay.querySelector('#rrPageInput').addEventListener('change', function(e) {
      var p = parseInt(e.target.value, 10);
      if (p >= 1 && p <= _rrTotalPages) _rrRenderPage(p);
      else e.target.value = _rrCurrentPage;
    });
    _rrOverlay.querySelector('#rrZoomIn').addEventListener('click', function() {
      _rrScale = Math.min(3, _rrScale + 0.2);
      _rrOverlay.querySelector('#rrZoomLabel').textContent = Math.round(_rrScale * 100) + '%';
      _rrRenderPage(_rrCurrentPage);
    });
    _rrOverlay.querySelector('#rrZoomOut').addEventListener('click', function() {
      _rrScale = Math.max(0.5, _rrScale - 0.2);
      _rrOverlay.querySelector('#rrZoomLabel').textContent = Math.round(_rrScale * 100) + '%';
      _rrRenderPage(_rrCurrentPage);
    });

    /* Theme button handlers */
    _rrOverlay.querySelector('#rrThemeDark').addEventListener('click', function() { _rrApplyTheme('dark'); });
    _rrOverlay.querySelector('#rrThemeLight').addEventListener('click', function() { _rrApplyTheme('light'); });
    _rrOverlay.querySelector('#rrThemeSepia').addEventListener('click', function() { _rrApplyTheme('sepia'); });

    /* Bookmark handler */
    _rrOverlay.querySelector('#rrBookmarkBtn').addEventListener('click', function() {
      _rrBookmarks = _rrToggleBookmark(_rrPdfId, _rrCurrentPage);
      _rrUpdateBookmarkBtn();
      _rrRenderBookmarkMarkers();
      _toast(_rrBookmarks.indexOf(_rrCurrentPage) >= 0 ? 'Bookmark added on page ' + _rrCurrentPage : 'Bookmark removed', 'info');
    });

    /* Anti-copy / anti-download */
    _rrAntiCopyOn();

    /* Start reading timer */
    _rrStartTimer();

    // Keyboard navigation
    function _rrKeyHandler(e) {
      if (!_rrOverlay) { document.removeEventListener('keydown', _rrKeyHandler); return; }
      if (e.key === 'ArrowLeft') { if (_rrCurrentPage > 1) _rrRenderPage(_rrCurrentPage - 1); }
      else if (e.key === 'ArrowRight') { if (_rrCurrentPage < _rrTotalPages) _rrRenderPage(_rrCurrentPage + 1); }
      else if (e.key === 'Escape') { _rrClose(); document.removeEventListener('keydown', _rrKeyHandler); }
    }
    document.addEventListener('keydown', _rrKeyHandler);

    // Loading indicator
    var canvasContainer = _rrOverlay.querySelector('#rrCanvas').parentElement;
    var loadingEl = document.createElement('div');
    loadingEl.id = 'rrLoading';
    loadingEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,0.4);font-size:.9rem;text-align:center';
    loadingEl.innerHTML = '<div style="font-size:2rem;margin-bottom:8px">\uD83D\uDCD6</div>Loading PDF\u2026';
    canvasContainer.style.position = 'relative';
    canvasContainer.appendChild(loadingEl);

    // Load PDF
    try {
      _rrPdfDoc = await window.pdfjsLib.getDocument({
        url: signedUrl,
        withCredentials: false
      }).promise;
      _rrTotalPages = _rrPdfDoc.numPages || 1;

      // Resume from last page + restore zoom level
      var savedProgress = (function() {
        try { var raw = localStorage.getItem(_rrGetProgressKey(_rrPdfId)); return raw ? JSON.parse(raw) : null; } catch(e) { return null; }
      })();
      var resumePage = savedProgress ? (savedProgress.page || 1) : 1;
      if (savedProgress && savedProgress.zoom) {
        _rrScale = savedProgress.zoom;
        var zl = _rrOverlay.querySelector('#rrZoomLabel');
        if (zl) zl.textContent = Math.round(_rrScale * 100) + '%';
      }
      if (resumePage > _rrTotalPages) resumePage = 1;
      if (resumePage > 1) {
        _toast('Resuming from page ' + resumePage, 'info');
      }

      // Remove loading indicator
      var le = _rrOverlay.querySelector('#rrLoading');
      if (le) le.remove();

      // Update page input max
      var pageInput = _rrOverlay.querySelector('#rrPageInput');
      if (pageInput) pageInput.max = _rrTotalPages;

      // Render first/resume page
      await _rrRenderPage(resumePage);

      // Track reading session
      if (typeof window.trackReadingSession === 'function') window.trackReadingSession(_rrPdfId);
      if (typeof window.trackPdfDownloadEvent === 'function') window.trackPdfDownloadEvent(pdf, 'premium_member');
    } catch(e) {
      _warn('RR: load failed', e);
      var le2 = _rrOverlay.querySelector('#rrLoading');
      if (le2) le2.innerHTML = '<div style="font-size:2rem;margin-bottom:8px">\u26A0\uFE0F</div>Failed to load PDF.<br><span style="font-size:.72rem;color:rgba(255,255,255,0.3)">The file may be corrupted or inaccessible.</span>';
      _toast('Failed to load PDF in Reading Room.', 'error');
    }
  }

  function _patchBuyPDF() {
    var orig = window.buyPDF;
    if (!orig || orig._smciPatched) return;
    window.buyPDF = async function buyPDF_smci(pdfId, amount, legacyUrl) {
      /* Free PDFs → always original flow */
      var pdf = (window.PDFS || []).find(function(p) { return String(p.id) === String(pdfId); });
      if (pdf && typeof window.normalizePdf === 'function') pdf = window.normalizePdf(pdf);
      var isFree = pdf ? (pdf.free || Number(pdf.price || 0) === 0) : (Number(amount || 0) === 0);
      if (isFree) return orig.call(this, pdfId, amount, legacyUrl);

      /* Already individually purchased → permanent lifetime access, always works */
      if (typeof window._isOwned === 'function' && window._isOwned(String(pdfId))) {
        _log('Individual owner — lifetime access passthrough', pdfId);
        return orig.call(this, pdfId, amount, legacyUrl);
      }

      /* Not premium → normal purchase flow */
      var status = await _getStatus(false);
      if (!status.isPremium) return orig.call(this, pdfId, amount, legacyUrl);

      /* Premium but PDF not in an enabled category → normal purchase */
      var enabledCatsLower = await _getEnabledCategoryNames(false);
      var inPremCat = pdf ? await _isPdfInPremiumCategory(pdf, enabledCatsLower) : false;
      if (!inPremCat) {
        _log('PDF not in premium category — normal purchase flow', pdfId);
        return orig.call(this, pdfId, amount, legacyUrl);
      }

      /* Premium bypass — open PDF directly via signed URL */
      _log('Premium bypass buyPDF', pdfId);
      var client = _sb(), user = _user();
      if (!client || !user) { _warn('No client/user — fallback'); return orig.call(this, pdfId, amount, legacyUrl); }

      var pdfUrl = '';
      try {
        var row = await client.from('pdfs').select('pdf_url,title').eq('id', pdfId).single();
        if (row.data) pdfUrl = row.data.pdf_url || '';
      } catch (e) { _warn('pdf_url fetch', e); }
      if (!pdfUrl) pdfUrl = pdf ? (pdf.pdf_url || pdf.pdfUrl || '') : '';
      if (!pdfUrl) { _warn('No pdf_url — fallback'); return orig.call(this, pdfId, amount, legacyUrl); }

      var url = await _resolveSignedUrl(pdfUrl, client);
      if (!url) { _warn('No signed URL — fallback'); return orig.call(this, pdfId, amount, legacyUrl); }

      _openReadingRoom(pdf, url);
      _toast('Opening Reading Room\u2026 \uD83D\uDC51', 'success');
    };
    window.buyPDF._smciPatched = true;
    _log('buyPDF patched — category-based (site_config)');
  }

  function _patchTriggerPDFDownload() {
    var orig = window.triggerPDFDownload;
    if (!orig || orig._smciPatched) return;
    window.triggerPDFDownload = async function triggerPDFDownload_smci(pdfId) {
      if (typeof window._isOwned === 'function' && window._isOwned(String(pdfId))) return orig.call(this, pdfId);
      var status = await _getStatus(false);
      if (!status.isPremium) return orig.call(this, pdfId);
      var pdf = (window.PDFS || []).find(function(p) { return String(p.id) === String(pdfId); });
      var enabledCatsLower = await _getEnabledCategoryNames(false);
      if (!(pdf && await _isPdfInPremiumCategory(pdf, enabledCatsLower))) return orig.call(this, pdfId);

      _log('Premium bypass download', pdfId);
      var client = _sb(), user = _user();
      if (!client || !user) return orig.call(this, pdfId);

      var pdfUrl = '';
      try { var row = await client.from('pdfs').select('pdf_url').eq('id', pdfId).single(); if (row.data) pdfUrl = row.data.pdf_url || ''; } catch (_) {}
      if (!pdfUrl) return orig.call(this, pdfId);
      var url = await _resolveSignedUrl(pdfUrl, client);
      if (!url) return orig.call(this, pdfId);

      _toast('Downloading with Premium access! 📥👑', 'success');
      try {
        var a = document.createElement('a');
        a.href = url; a.download = ''; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } catch (_) { window.open(url, '_blank'); }
      if (typeof window.trackReadingSession === 'function') window.trackReadingSession(pdfId);
    };
    window.triggerPDFDownload._smciPatched = true;
    _log('triggerPDFDownload patched');
  }

  /* ─────────────────────────────────────────────────────────────────
     § MY LIBRARY — PREMIUM MEMBERSHIP SECTION
  ──────────────────────────────────────────────────────────────────*/
  /* BUG-5 HARDENED: Premium card uses openDetail() — not buyPDF().
     openDetail() → navigate('detail') → _hookRenderDetail intercepts
     → grants premium access. Zero Razorpay exposure. */
  function _buildPremiumCard(pdf) {
    var title = _esc(pdf.title || 'Untitled');
    var cover = pdf.coverImage || pdf.cover_image || pdf.cover_url || '';
    var cat   = _esc(pdf.category || '');
    var id    = String(pdf.id);
    /* BUG-FIX: Use quoted string concatenation that avoids inner single-quote breaks */
    var coverHtml = cover
      ? "<img src=\"" + cover + "\" alt=\"" + title + "\" style=\"width:100%;height:100%;object-fit:cover\" loading=\"lazy\" decoding=\"async\">"
      : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:linear-gradient(135deg,rgba(147,2,5,0.08),rgba(139,92,246,0.08))">&#x1F4CC;</div>';
    /* BUG-FIX (BUG-2): Open Free calls openReadingRoom directly — never goes to checkout */
    var onclickCard = "if(window.SMCI&&window.SMCI.openReadingRoom)window.SMCI.openReadingRoom('" + id + "');else if(typeof openDetail===\'function\')openDetail('" + id + "')";
    var onclickBtn  = "event.stopPropagation();" + onclickCard;
    return '<div style="cursor:pointer;border-radius:10px;flex:0 0 140px;width:140px;'
      + 'background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));'
      + 'overflow:hidden;transition:transform .15s,box-shadow .15s" onclick="' + onclickCard + '">'
      + '<div style="position:relative;height:110px;overflow:hidden">'
      + coverHtml
      + '<div style="position:absolute;top:5px;right:5px;background:linear-gradient(135deg,#fbbf24,#f59e0b);'
      + 'color:#000;font-size:.55rem;font-weight:800;padding:2px 6px;border-radius:10px">&#x1F451; PREMIUM</div>'
      + '</div>'
      + '<div style="padding:8px">'
      + '<div style="font-size:.74rem;font-weight:600;color:var(--text1);line-height:1.3;margin-bottom:3px;'
      + 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + title + '</div>'
      + (cat ? '<div style="font-size:.62rem;color:var(--text2);margin-bottom:5px">' + cat + '</div>' : '')
      + '<button onclick="' + onclickBtn + '" '
      + 'style="width:100%;padding:5px;border-radius:6px;border:none;cursor:pointer;font-size:.7rem;font-weight:700;'
      + 'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
      + 'color:#fbbf24;border:1px solid rgba(251,191,36,0.25)">&#x1F451; Open Free</button>'
      + '</div></div>';
  }

  /* BUG-3 FIX: Horizontal carousel shelves per category (one shelf per category).
     BUG-5 FIX: Cards use "👑 Open Free" — premium members never see Buy button. */
  function _buildPremiumSection(pdfs, status) {
    var expFmt = '';
    if (status.expiresAt) {
      try { expFmt = new Date(status.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) {}
    }
    /* Group PDFs by exact category name (order of first appearance) */
    var groups = {}, order = [];
    pdfs.forEach(function(pdf) {
      var cat = pdf.category || 'Premium Notes';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(pdf);
    });

    /* Inject shelf CSS once */
    if (!document.getElementById('smci-shelf-css')) {
      var s = document.createElement('style');
      s.id = 'smci-shelf-css';
      s.textContent = [
        '.smci-shelf-row{margin-bottom:20px}',
        '.smci-shelf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:0 2px}',
        '.smci-shelf-title{display:flex;align-items:center;gap:6px;font-size:.78rem;font-weight:700;color:rgba(251,191,36,0.85)}',
        '.smci-shelf-count{font-size:.62rem;color:rgba(255,255,255,0.35);font-weight:400}',
        '.smci-shelf-outer{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;cursor:grab;user-select:none}',
        '.smci-shelf-outer::-webkit-scrollbar{display:none}',
        '.smci-shelf-track{display:flex;gap:10px;padding-bottom:6px;width:max-content}',
      ].join('');
      document.head.appendChild(s);
    }

    var sectionsHtml = (order.length === 0)
      ? '<div style="text-align:center;padding:24px;color:var(--text2);font-size:.88rem">No Premium Notes in catalogue yet.</div>'
      : order.map(function(catName, ri) {
          var catPdfs = groups[catName];
          return '<div class="smci-shelf-row">'
            + '<div class="smci-shelf-head">'
            + '<div class="smci-shelf-title">'
            + '<span>📚</span>'
            + '<span>' + _esc(catName) + '</span>'
            + '<span class="smci-shelf-count">(' + catPdfs.length + ')</span>'
            + '</div>'
            + '</div>'
            + '<div class="smci-shelf-outer" id="smci-shelf-' + ri + '">'
            + '<div class="smci-shelf-track">'
            + catPdfs.map(_buildPremiumCard).join('')
            + '</div>'
            + '</div>'
            + '</div>';
        }).join('');

    /* Wire drag-to-scroll after insertion */
    setTimeout(function() {
      document.querySelectorAll('.smci-shelf-outer').forEach(function(el) {
        if (el._smciDrag) return;
        el._smciDrag = true;
        var dragging = false, startX = 0, scrollLeft = 0;
        el.addEventListener('mousedown', function(e) {
          dragging = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
          el.style.cursor = 'grabbing';
        });
        window.addEventListener('mouseup', function() {
          dragging = false; el.style.cursor = 'grab';
        });
        el.addEventListener('mousemove', function(e) {
          if (!dragging) return;
          e.preventDefault();
          el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX);
        });
      });
    }, 120);

    return '<div id="' + SECTION_ID + '" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.08))">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
      + '<div>'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:1.05rem">👑</span>'
      + '<span style="font-weight:700;font-size:.95rem;color:var(--text1)">⭐ Premium Membership</span>'
      + '<span style="font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:20px;'
      + 'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
      + 'color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">ACTIVE</span>'
      + '</div>'
      + (expFmt ? '<div style="font-size:.7rem;color:var(--text2);margin-top:3px">Access until ' + expFmt + ' · ' + _esc(status.planName) + '</div>' : '')
      + '</div>'
      + '<button onclick="navigate(\'premium-library\')" style="font-size:.75rem;color:var(--accent);'
      + 'background:none;border:1px solid rgba(147,2,5,0.25);border-radius:20px;'
      + 'padding:5px 12px;cursor:pointer;font-weight:600">View All →</button>'
      + '</div>'
      + sectionsHtml
      + '</div>';
  }


  async function injectLibrarySection(force) {
    /* Remove any existing premium section first */
    var old = document.getElementById(SECTION_ID);
    if (old) old.remove();

    /* Find the BSF panel — it's created dynamically by switchMeTab */
    var panel = document.getElementById('bsfTabPanel');
    if (!panel) {
      _log('bsfTabPanel not found — SMCI injection skipped');
      return;
    }

    var status = await _getStatus(force || false);
    if (!status.isPremium) { _log('Not premium — skip library section'); return; }

    var pdfs = await _getPremiumCategoryPdfs(force);
    _log('Injecting premium library section', pdfs.length + ' PDFs');

    /* Insert premium section BEFORE the sdl-root div (main BSF content)
       so it appears at the top of the library, above the bookshelf */
    var insertTarget = panel.querySelector('.sdl-root') || panel.firstChild || null;

    if (pdfs.length === 0) {
      /* Show placeholder — retry after 3s once PDFs finish loading */
      var noContentHtml = '<div id="' + SECTION_ID + '" style="margin:0 0 24px;padding:20px 24px;'
        + 'border-radius:16px;background:linear-gradient(135deg,rgba(251,191,36,0.05),rgba(245,158,11,0.03));'
        + 'border:1px solid rgba(251,191,36,0.15)">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span>👑</span><span style="font-weight:700;font-size:.95rem;color:var(--text1)">⭐ Premium Membership</span>'
        + '<span style="font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:20px;'
        + 'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
        + 'color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">ACTIVE</span>'
        + '</div>'
        + '<div style="color:var(--text2);font-size:.82rem">⏳ Loading Premium Notes…</div>'
        + '</div>';
      var frag = document.createElement('div');
      frag.innerHTML = noContentHtml;
      if (insertTarget) { panel.insertBefore(frag.firstChild, insertTarget); }
      else { panel.appendChild(frag.firstChild); }

      /* Auto-retry after PDFs finish loading */
      setTimeout(async function() {
        var old2 = document.getElementById(SECTION_ID);
        if (!old2) return; /* Already replaced */
        var retryPdfs = await _getPremiumCategoryPdfs(false);
        if (retryPdfs.length > 0) {
          old2.remove();
          var frag2 = document.createElement('div');
          frag2.innerHTML = _buildPremiumSection(retryPdfs, status);
          var panel2 = document.getElementById('bsfTabPanel');
          if (panel2) {
            var insertTarget2 = panel2.querySelector('.sdl-root') || panel2.firstChild || null;
            if (insertTarget2) { panel2.insertBefore(frag2.firstChild, insertTarget2); }
            else { panel2.appendChild(frag2.firstChild); }
          }
        }
      }, 3000);
      return;
    }

    var frag = document.createElement('div');
    frag.innerHTML = _buildPremiumSection(pdfs, status);
    if (insertTarget) { panel.insertBefore(frag.firstChild, insertTarget); }
    else { panel.appendChild(frag.firstChild); }
  }

  function _removePremiumSection() {
    var el = document.getElementById(SECTION_ID);
    if (el) el.remove();
  }

  function _updateBadges(isPremium) {
    document.querySelectorAll('[data-prm-status]').forEach(function(el) {
      el.textContent = isPremium ? '👑 Premium' : '🔒 Free';
    });
    var pip = document.querySelector('.p5d-tab-pip');
    if (pip) pip.style.display = isPremium ? 'block' : 'none';
    var banner = document.querySelector('#dashMain .me-premium-banner');
    if (banner) banner.style.display = isPremium ? 'none' : '';
    /* BADGE-FIX: Sync dashPlan badge with real status — exact required format */
    var planEl = document.getElementById('dashPlan');
    if (planEl) {
      if (isPremium) {
        planEl.innerHTML = '&#x1F451; PREMIUM MEMBER';
        planEl.className = (planEl.className || '').replace(/\bmb-level\b/g, '').trim() + ' mb-gold';
      } else {
        planEl.textContent = 'FREE MEMBER';
        planEl.className = (planEl.className || '').replace(/\bmb-gold\b/g, '').trim() + ' mb-level';
      }
      var br = document.getElementById('dashBadgeRow');
      if (br) br.style.display = '';
    }
    /* PREMIUM-TAB-FIX: Sync the new Premium tab status pill — single source of truth */
    var prmStatusEl = document.getElementById('prmNavMemberStatus');
    if (prmStatusEl) {
      prmStatusEl.innerHTML = isPremium
        ? '<span style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(251,191,36,0.18),rgba(245,158,11,0.12));border:1px solid rgba(251,191,36,0.35);border-radius:20px;padding:6px 16px;font-size:.82rem;font-weight:700;color:#fbbf24">&#x1F451; PREMIUM MEMBER</span>'
        : '<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:6px 16px;font-size:.82rem;font-weight:600;color:var(--text2)">FREE MEMBER</span>';
    }
  }

  async function syncAll(force) {
    var status = await _getStatus(force || false);
    _updateBadges(status.isPremium);
    /* BUG-4 FIX: Sync P5D premium badge — ensures dashPlan shows PREMIUM MEMBER not FREE */
    try {
      if (window.P5D && typeof window.P5D.refreshBadges === 'function') {
        window.P5D.refreshBadges();
      }
    } catch (_) {}
    /* Library section injection — only if bsfTabPanel exists (user is on My Library tab) */
    var panel = document.getElementById('bsfTabPanel');
    if (panel) {
      if (status.isPremium) await injectLibrarySection(false);
      else _removePremiumSection();
    }
    /* Home premium shelf — always check (section shows/hides based on status) */
    var homeSection = document.getElementById('smci-home-premium');
    if (homeSection) { renderHomePremiumShelf(false); }
    try { window.dispatchEvent(new CustomEvent('smci:statusUpdated', { detail: status })); } catch (_) {}
    return status;
  }


  /* ─────────────────────────────────────────────────────────────────
     § HOME PAGE — PREMIUM CONTENT SHELF
     Renders PDFs from premium categories into #smci-home-premium
     Uses SAME _getPremiumCategoryPdfs() as library section — single source of truth.
  ──────────────────────────────────────────────────────────────────*/

  /* Build a card for the home shelf (matches scardHTML style) */
  /* BUG-5 HARDENED (home shelf): uses openDetail() — no buyPDF(), no Razorpay. */
  function _buildHomePremiumCard(pdf) {
    var title = _esc(pdf.title || 'Untitled');
    var cover = pdf.cover_url || pdf.coverImage || pdf.cover_image || pdf.thumbnail || '';
    var id    = String(pdf.id);
    var imgHtml = cover
      ? '<img src="' + _esc(cover) + '" loading="lazy" decoding="async"'
        + ' style="width:100%;height:100%;object-fit:cover;border-radius:10px 10px 0 0"'
        + ' onerror="this.style.display=\'none\'">'
      : '';
    var iconHtml = cover ? '' :
      '<div style="width:100%;height:100%;display:flex;align-items:center;'
      + 'justify-content:center;font-size:2rem;border-radius:10px 10px 0 0;'
      + 'background:linear-gradient(135deg,rgba(251,191,36,0.08),rgba(245,158,11,0.05))">&#x1F4CC;</div>';
    var cardStyle = 'cursor:pointer;flex:0 0 140px;width:140px;border-radius:10px;'
      + 'background:var(--glass-bg,rgba(255,255,255,0.03));'
      + 'border:1px solid rgba(251,191,36,0.2);overflow:hidden;'
      + 'transition:transform .15s,box-shadow .15s;flex-shrink:0';
    var html = '<div style="' + cardStyle + '" '
      + 'onclick="if(window.SMCI&&window.SMCI.openReadingRoom)window.SMCI.openReadingRoom(\'' + id + '\');else if(typeof openDetail===\'function\')openDetail(\'' + id + '\')">';
    html += '<div style="position:relative;height:100px;overflow:hidden">';
    html += imgHtml + iconHtml;
    html += '<div style="position:absolute;top:5px;right:5px;background:linear-gradient(135deg,#fbbf24,#f59e0b);'
          + 'color:#000;font-size:.52rem;font-weight:800;padding:2px 6px;border-radius:8px">&#x1F451;</div>';
    html += '</div>';
    html += '<div style="padding:8px 8px 10px">';
    html += '<div style="font-size:.72rem;font-weight:600;color:var(--text1);line-height:1.3;'
          + 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'
          + title + '</div>';
    html += '<div style="font-size:.63rem;color:#fbbf24;font-weight:700;margin-top:4px">&#x1F451; Free with Premium</div>';
    html += '</div></div>';
    return html;
  }

  async function renderHomePremiumShelf(force) {
    var section = document.getElementById('smci-home-premium');
    var track   = document.getElementById('smci-home-premium-track');
    if (!section || !track) return; /* Section not in DOM yet */

    var status = await _getStatus(force || false);
    if (!status.isPremium) {
      /* Not premium — hide the section */
      section.style.display = 'none';
      return;
    }

    var pdfs = await _getPremiumCategoryPdfs(force || false);
    if (pdfs.length === 0) {
      section.style.display = 'none';
      return;
    }

    /* Render cards */
    track.innerHTML = pdfs.slice(0, 15).map(_buildHomePremiumCard).join('');
    section.style.display = '';
    _log('Home premium shelf rendered', pdfs.length + ' PDFs');
  }

  /* Hook renderHome() to also render premium shelf */
  /* BUG-4 FIX: Wrap renderDashboard to guarantee P5D.refreshBadges() fires
     AFTER the profile hero is populated. The existing P5D MutationObserver
     approach races against renderDashboard()'s synchronous badge write. */
  function _hookRenderDashboard() {
    var orig = window.renderDashboard;
    if (!orig || orig._smciHooked) return;
    window.renderDashboard = async function renderDashboard_smci() {
      var res = orig.apply(this, arguments);
      /* Wait for renderDashboard to fully resolve (it's async) then refresh badge */
      Promise.resolve(res).then(function() {
        setTimeout(function() {
          /* Trigger P5D badge refresh — uses its own _loadAll cache */
          if (window.P5D && typeof window.P5D.refreshBadges === 'function') {
            window.P5D.refreshBadges();
          }
          /* Also dispatch the event P5D's navigate listener expects, in case
             other code depends on it */
          try {
            window.dispatchEvent(new CustomEvent('studyria:navigate', { detail: { page: 'dashboard' } }));
          } catch (_) {}
        }, 200);
      });
      return res;
    };
    window.renderDashboard._smciHooked = true;
    _log('renderDashboard hooked for premium badge refresh (BUG-4)');
  }

  function _hookRenderHome() {
    var orig = window.renderHome;
    if (!orig || orig._smciHooked) return;
    window.renderHome = async function renderHome_smci() {
      var res = orig.apply(this, arguments);
      /* Render premium shelf async — does not block home page render */
      setTimeout(function() { renderHomePremiumShelf(false); }, 300);
      return res;
    };
    window.renderHome._smciHooked = true;
    _log('renderHome hooked for premium shelf');
  }

  /* ─────────────────────────────────────────────────────────────────
     § HOOKS
  ──────────────────────────────────────────────────────────────────*/
  function _hookSwitchMeTab() {
    var orig = window.switchMeTab;
    if (!orig || orig._smciHooked) return;
    window.switchMeTab = async function switchMeTab_smci(tab) {
      var res = orig.apply(this, arguments);
      if (tab === 'purchased') {
        var tries = 0;
        var tryInject = async function() {
          var panel = document.getElementById('bsfTabPanel');
          if (panel) { await injectLibrarySection(false); }
          else if (tries++ < 15) { setTimeout(tryInject, 200); }
        };
        setTimeout(tryInject, 700);
      }
      return res;
    };
    window.switchMeTab._smciHooked = true;
    window.switchMeTab._p5dHooked = orig._p5dHooked || false;
    _log('switchMeTab hooked');
  }

  function _hookRenderDetail() {
    var orig = window.renderDetail;
    if (!orig || orig._smciHooked) return;
    window.renderDetail = async function renderDetail_smci() {
      var res = orig.apply(this, arguments);
      var pdf = window.selectedPdf;
      if (!pdf || Number(pdf.price || 0) === 0) return res;
      var status = await _getStatus(false);
      if (!status.isPremium) return res;
      var enabledCatsLower = await _getEnabledCategoryNames(false);
      if (!(await _isPdfInPremiumCategory(pdf, enabledCatsLower))) return res;
      setTimeout(function() {
        var _rrPdfId = String(pdf.id);
        document.querySelectorAll('.pdp-cta-btn,.pdp-buy-primary,#pdpStickyBuy,.pdp-sticky-buy').forEach(function(btn) {
          if (/buy|purchase|⚡/i.test(btn.textContent)) {
            btn.textContent = '👑 Open with Premium';
            btn.style.background = 'linear-gradient(135deg,#fbbf24,#f59e0b)';
            btn.style.color = '#000';
            /* Open Reading Room directly — never checkout for premium users */
            btn.onclick = function(e) { e.preventDefault(); SMCI.openReadingRoom(_rrPdfId); return false; };
          }
        });
        document.querySelectorAll('.pdp-price-row,.pdp-price-wrap,.pdp-buy-section').forEach(function(el) {
          if (!el.querySelector('.smci-prm-tag')) {
            var tag = document.createElement('div');
            tag.className = 'smci-prm-tag';
            tag.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-top:6px;'
              + 'padding:4px 10px;border-radius:20px;font-size:.72rem;font-weight:700;'
              + 'background:linear-gradient(135deg,rgba(251,191,36,0.12),rgba(245,158,11,0.08));'
              + 'color:#fbbf24;border:1px solid rgba(251,191,36,0.25)';
            tag.innerHTML = '👑 Included in your ' + _esc(status.planName) + ' membership';
            el.appendChild(tag);
          }
        });
      }, 200);
      return res;
    };
    window.renderDetail._smciHooked = true;
    _log('renderDetail hooked');
  }

  function _hookSyncNavToAuth() {
    var orig = window.syncNavToAuth;
    if (!orig || orig._smciHooked) return;
    window.syncNavToAuth = function syncNavToAuth_smci(user) {
      var res = orig.apply(this, arguments);
      _state.fetchedAt = 0; _state.isPremium = false;
      if (!user) { _removePremiumSection(); _updateBadges(false); _log('Logout — premium cleared'); }
      else { setTimeout(function() { syncAll(true); }, 600); }
      return res;
    };
    window.syncNavToAuth._smciHooked = true;
    window.syncNavToAuth._p5dHooked = orig._p5dHooked || false;
    _log('syncNavToAuth hooked');
  }

  function _onActivated(e) {
    _log('membership:activated', e && e.detail);
    _state.fetchedAt = 0;
    _catCache.fetchedAt = 0;
    syncAll(true).then(function(s) {
      if (s.isPremium) {
        _toast('👑 Premium active! All Premium Notes unlocked.', 'success');
        injectLibrarySection(true);
        /* Also refresh home premium shelf if user is on home page */
        setTimeout(function() { renderHomePremiumShelf(true); }, 400);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     § ADMIN — PREMIUM CATEGORIES PANEL
     Uses site_config table (existing). Key: 'premium_categories_config'
     Value: JSON array of category names that are premium-unlocked.
     Zero new tables. Zero schema changes.
  ──────────────────────────────────────────────────────────────────*/
  window.renderAdminPremiumCategories = async function(container) {
    if (!container) return;
    var sb = _sb();
    if (!sb) {
      container.innerHTML = '<div style="padding:20px;color:#ff4d6d">⚠ Supabase not connected.</div>';
      return;
    }

    container.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4)">⏳ Loading categories…</div>';

    try {
      /* Load all categories from existing categories table */
      var catRes = await sb.from('categories').select('id,name,slug,sort_order').order('sort_order', { ascending: true });
      var allCats = (!catRes.error && catRes.data) ? catRes.data : [];

      /* Load current config from site_config */
      var enabledNames = await _fetchCategoryConfig(true);
      var enabledLower = enabledNames.map(function(n) { return n.toLowerCase().trim(); });

      var h = '<div>';
      h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
        + '<span style="font-size:1.1rem">⭐</span>'
        + '<div style="flex:1">'
        + '<div style="font-size:.95rem;font-weight:700;color:var(--text1,#f0f4f8)">Premium Category Management</div>'
        + '<div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-top:2px">'
        + 'Toggle which categories unlock for Premium Members. Config stored in <code>site_config</code>. Phase 1: Premium Handwritten Notes.'
        + '</div>'
        + '</div>'
        + '<button onclick="window.renderAdminPremiumCategories(this.closest(\'[id^=smci-admin]\').parentElement||this.parentElement.parentElement)" '
        + 'style="font-size:.72rem;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);'
        + 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);cursor:pointer;flex-shrink:0">↻ Refresh</button>'
        + '</div>';

      if (allCats.length === 0) {
        h += '<div style="padding:20px;color:rgba(255,255,255,0.4);font-size:.85rem">No categories found in database.</div>';
      } else {
        h += '<div style="display:flex;flex-direction:column;gap:8px" id="smci-cat-list">';
        allCats.forEach(function(cat) {
          var isEnabled = enabledLower.indexOf(cat.name.toLowerCase().trim()) > -1;
          var rowId = 'smci-cr-' + String(cat.id).replace(/[^a-zA-Z0-9]/g, '');
          var isPhase1 = cat.name === 'Premium Handwritten Notes';

          h += '<div id="' + rowId + '" style="display:flex;align-items:center;gap:12px;'
            + 'background:rgba(255,255,255,' + (isEnabled ? '.06' : '.025') + ');'
            + 'border:1px solid rgba(255,255,255,' + (isEnabled ? '.12' : '.06') + ');'
            + 'border-radius:10px;padding:12px 16px;transition:all .2s">'
            + '<span style="font-size:1.1rem;flex-shrink:0">' + (isEnabled ? '🟢' : '⚫') + '</span>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:.85rem;font-weight:600;color:var(--text1,#f0f4f8)">' + _esc(cat.name) + '</div>'
            + '<div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-top:2px">'
            + (isEnabled ? '✅ Unlocked for all active Premium Members' : '🔒 Not included in membership')
            + '</div>'
            + '</div>'
            + (isPhase1 ? '<span style="font-size:.6rem;padding:2px 8px;border-radius:10px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.25);font-weight:700;flex-shrink:0">Phase 1</span>' : '')
            + '<button onclick="window._smciToggleCategory(\'' + _esc(cat.name) + '\',' + (isEnabled ? 'false' : 'true') + ')" '
            + 'style="flex-shrink:0;padding:7px 16px;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;border:none;'
            + 'background:' + (isEnabled ? 'rgba(255,77,109,0.15)' : 'linear-gradient(135deg,rgba(16,217,142,0.2),rgba(6,182,212,0.15))') + ';'
            + 'color:' + (isEnabled ? '#ff4d6d' : '#10d98e') + ';'
            + 'border:1px solid ' + (isEnabled ? 'rgba(255,77,109,.3)' : 'rgba(16,217,142,.3)') + '">'
            + (isEnabled ? '⏸ Disable' : '▶ Enable')
            + '</button>'
            + '</div>';
        });
        h += '</div>';
      }

      h += '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(147,2,5,.08);'
        + 'border:1px solid rgba(147,2,5,.2);font-size:.72rem;color:rgba(255,255,255,.5);line-height:1.5">'
        + 'ℹ Config stored in <strong>site_config</strong> (key: <code>premium_categories_config</code>). '
        + 'Individual PDF purchases always work regardless of toggle. '
        + 'Toggling OFF only removes membership access — purchased content is never affected.'
        + '</div>';

      h += '</div>';
      container.innerHTML = h;
    } catch (err) {
      console.error('[SMCI Admin]', err);
      container.innerHTML = '<div style="padding:20px;color:#ff4d6d">⚠ Error: ' + _esc(err.message || String(err)) + '</div>';
    }
  };

  /* Toggle a category ON/OFF — writes to site_config (existing table) */
  window._smciToggleCategory = async function(categoryName, enable) {
    var sb = _sb();
    if (!sb) { _toast('Supabase not connected', 'error'); return; }

    /* Disable the button immediately to prevent double-click */
    var allBtns = document.querySelectorAll('#smci-cat-list button');
    allBtns.forEach(function(b) { b.disabled = true; });

    try {
      /* Read current config */
      var current = await _fetchCategoryConfig(true);
      var updated;

      if (enable) {
        /* Add category if not already in list */
        if (current.indexOf(categoryName) === -1) {
          updated = current.concat([categoryName]);
        } else {
          updated = current.slice();
        }
      } else {
        /* Remove category */
        updated = current.filter(function(n) { return n !== categoryName; });
      }

      /* Upsert to site_config — existing table, existing columns */
      var res = await sb.from('site_config').upsert({
        key:   SITE_CONFIG_KEY,
        value: JSON.stringify(updated)
      }, { onConflict: 'key' });

      if (res.error) throw new Error(res.error.message);

      /* Bust cache */
      _catCache.cats = updated;
      _catCache.fetchedAt = Date.now();

      _toast(
        (enable ? '✅ ' : '⏸ ') + categoryName + (enable ? ' unlocked for Premium members!' : ' removed from Premium.'),
        enable ? 'success' : 'info'
      );
      _log('Category toggled via site_config', { categoryName: categoryName, enable: enable, updated: updated });

      /* Re-render the admin panel */
      var wrap = document.getElementById('smci-admin-prem-cats-wrap');
      if (wrap && typeof window.renderAdminPremiumCategories === 'function') {
        window.renderAdminPremiumCategories(wrap);
      }

      /* Sync premium state if user is active member */
      if (window.SMCI) window.SMCI.refresh();

    } catch (e) {
      _warn('Toggle category error', e);
      _toast('Error: ' + e.message, 'error');
      /* Re-enable buttons on failure */
      allBtns.forEach(function(b) { b.disabled = false; });
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     § INIT
  ──────────────────────────────────────────────────────────────────*/
  function _init() {
    _patchBuyPDF();
    _patchTriggerPDFDownload();
    _hookSwitchMeTab();
    _hookRenderDetail();

    var _ha = 0;
    function _tryHookAuth() {
      if (window.syncNavToAuth) { _hookSyncNavToAuth(); }
      else if (_ha++ < 30) { setTimeout(_tryHookAuth, 300); }
    }
    _tryHookAuth();

    /* Hook renderHome for premium shelf — with retry until renderHome is available */
    var _rh = 0;
    function _tryHookRenderHome() {
      if (window.renderHome) { _hookRenderHome(); }
      else if (_rh++ < 30) { setTimeout(_tryHookRenderHome, 300); }
    }
    _tryHookRenderHome();

    /* BUG-4 FIX: Hook renderDashboard to refresh premium badge after profile renders.
       navigate('dashboard') does NOT dispatch studyria:navigate, so P5D's event
       listener never fires. We wrap renderDashboard() ourselves to guarantee
       P5D.refreshBadges() runs AFTER the profile hero is populated. */
    var _rd = 0;
    function _tryHookRenderDashboard() {
      if (window.renderDashboard) { _hookRenderDashboard(); }
      else if (_rd++ < 30) { setTimeout(_tryHookRenderDashboard, 300); }
    }
    _tryHookRenderDashboard();

    window.addEventListener('studyria:membership:activated', _onActivated);
    window.addEventListener('smci:refresh', function() {
      syncAll(true);
      renderHomePremiumShelf(true);
    });

    if (_uid()) { setTimeout(function() { syncAll(false); }, 900); }
    else {
      var _aw = 0;
      function _waitAuth() {
        if (_uid()) { syncAll(false); } else if (_aw++ < 20) { setTimeout(_waitAuth, 500); }
      }
      setTimeout(_waitAuth, 1200);
    }
    _log('Init complete — SMCI pci-2.6 (reading room, try-catch library page)');
  }


  /* ─────────────────────────────────────────────────────────────────
     § PREMIUM LIBRARY PAGE (BUG-2+3 FIX)
     Dedicated full-page premium library with horizontal category shelves.
     Called by navigate('premium-library') handler in index.html.
     Uses SAME _getPremiumCategoryPdfs() — single source of truth.
  ──────────────────────────────────────────────────────────────────*/
  async function renderPremiumLibraryPage(force) {
    console.trace('[SMCI] renderPremiumLibraryPage called', { force: force });
    var container = document.getElementById('prmLibContent');
    var subtitle  = document.getElementById('prmLibSubtitle');
    if (!container) { console.warn('[SMCI] prmLibContent not found'); return; }

    /* Loading state */
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">'
      + '<div style="font-size:2rem;margin-bottom:12px">👑</div>'
      + '<div style="font-size:.9rem">Loading Premium Library…</div>'
      + '</div>';

    /* BUG-FIX: Safety timeout — if any await hangs >12s, replace loading with retry */
    var _safetyTo = setTimeout(function() {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">'
        + '<div style="font-size:2rem;margin-bottom:12px">⚠</div>'
        + '<div style="font-size:.9rem;margin-bottom:16px">Loading timed out. Please retry.</div>'
        + '<button onclick="window.SMCI.renderPremiumLibraryPage(true)" style="background:linear-gradient(135deg,#930205,#0ea5e9);color:#fff;font-weight:700;padding:10px 24px;border-radius:20px;border:none;cursor:pointer;font-size:.85rem">↻ Retry</button>'
        + '</div>';
    }, 5000);

    try {

    var status = await _getStatus(force || false);
    // FIX: If state says not-premium but this wasn't a forced call, do one forced re-fetch.
    // Handles the race where SMCI state is stale when navigating straight to premium-library.
    if (!status.isPremium && !force) {
      _log('renderPremiumLibraryPage: cached isPremium=false, forcing re-fetch...');
      status = await _getStatus(true);
    }

    if (!status.isPremium) {
      /* Not a premium member — show upgrade prompt */
      clearTimeout(_safetyTo);
      container.innerHTML = '<div style="text-align:center;padding:48px 24px">'
        + '<div style="font-size:3rem;margin-bottom:16px">🔒</div>'
        + '<div style="font-size:1.1rem;font-weight:700;color:var(--text1);margin-bottom:8px">Premium Members Only</div>'
        + '<div style="font-size:.85rem;color:var(--text2);margin-bottom:24px">Unlock all Premium Handwritten Notes and more with a Premium Membership.</div>'
        + '<button onclick="navigate(\'premium\')" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;'
        + 'font-weight:700;padding:12px 28px;border-radius:24px;border:none;cursor:pointer;font-size:.9rem">'
        + '👑 View Plans →</button>'
        + '</div>';
      return;
    }

    /* Get enabled categories & PDFs */
    var enabledCats  = await _fetchCategoryConfig(force || false); /* original case names */
    var pdfs         = await _getPremiumCategoryPdfs(force || false);

    /* Update subtitle */
    if (subtitle) {
      var total = pdfs.length;
      subtitle.textContent = total + ' premium note' + (total !== 1 ? 's' : '') + ' across ' + enabledCats.length + ' categor' + (enabledCats.length !== 1 ? 'ies' : 'y');
    }

    if (pdfs.length === 0) {
      clearTimeout(_safetyTo);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">'
        + '<div style="font-size:2rem;margin-bottom:12px">📭</div>'
        + '<div>No Premium Notes in catalogue yet — check back soon!</div>'
        + '</div>';
      return;
    }

    /* Group by exact category (exact-match — same as _getPremiumCategoryPdfs) */
    var groups = {}, order = [];
    pdfs.forEach(function(pdf) {
      var cat = pdf.category || 'Premium Notes';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(pdf);
    });

    /* Inject shelf CSS if not already injected */
    if (!document.getElementById('smci-shelf-css')) {
      var s = document.createElement('style');
      s.id = 'smci-shelf-css';
      s.textContent = [
        '.smci-shelf-row{margin-bottom:28px}',
        '.smci-shelf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 2px}',
        '.smci-shelf-title{display:flex;align-items:center;gap:7px;font-size:.85rem;font-weight:700;color:rgba(251,191,36,0.9)}',
        '.smci-shelf-count{font-size:.65rem;color:rgba(255,255,255,0.35);font-weight:400}',
        '.smci-shelf-outer{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;cursor:grab;user-select:none}',
        '.smci-shelf-outer::-webkit-scrollbar{display:none}',
        '.smci-shelf-track{display:flex;gap:12px;padding-bottom:8px;width:max-content}',
      ].join('');
      document.head.appendChild(s);
    }

    /* Build horizontal shelf HTML for each category */
    var html = order.map(function(catName, ri) {
      var catPdfs = groups[catName];
      return '<div class="smci-shelf-row">'
        + '<div class="smci-shelf-head">'
        + '<div class="smci-shelf-title">'
        + '<span style="font-size:1.1rem">📚</span>'
        + '<span>' + _esc(catName) + '</span>'
        + '<span class="smci-shelf-count">(' + catPdfs.length + ' notes)</span>'
        + '</div>'
        + '</div>'
        + '<div class="smci-shelf-outer" id="prmlib-shelf-' + ri + '">'
        + '<div class="smci-shelf-track">'
        + catPdfs.map(function(pdf) {
            /* BUG-5 FIX: Always use _buildPremiumCard which shows "👑 Open Free" */
            return _buildPremiumCard(pdf);
          }).join('')
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    container.innerHTML = html;

    /* Wire drag-to-scroll on all shelves */
    setTimeout(function() {
      container.querySelectorAll('.smci-shelf-outer').forEach(function(el) {
        if (el._smciDrag) return;
        el._smciDrag = true;
        var dragging = false, startX = 0, scrollL = 0;
        el.addEventListener('mousedown', function(e) {
          dragging = true; startX = e.pageX - el.offsetLeft; scrollL = el.scrollLeft;
          el.style.cursor = 'grabbing';
        });
        window.addEventListener('mouseup', function() { dragging = false; el.style.cursor = 'grab'; });
        el.addEventListener('mousemove', function(e) {
          if (!dragging) return;
          e.preventDefault();
          el.scrollLeft = scrollL - (e.pageX - el.offsetLeft - startX);
        });
      });
    }, 120);

    _log('Premium Library page rendered', pdfs.length + ' PDFs, ' + order.length + ' shelves');

    } catch (_rrErr) {
      _warn('renderPremiumLibraryPage error', _rrErr);
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">'
          + '<div style="font-size:2rem;margin-bottom:12px">⚠</div>'
          + '<div style="font-size:.9rem;margin-bottom:16px">Could not load Premium Library.</div>'
          + '<button onclick="window.SMCI.renderPremiumLibraryPage(true)" style="background:linear-gradient(135deg,#930205,#0ea5e9);color:#fff;font-weight:700;padding:10px 24px;border-radius:20px;border:none;cursor:pointer;font-size:.85rem">↻ Retry</button>'
          + '</div>';
      }
    }
    clearTimeout(_safetyTo);
  }


  async function _openReadingRoomById(pdfId) {
    console.log('[SMCI] openReadingRoom called with pdfId:', pdfId, 'type:', typeof pdfId);
    if (!pdfId || pdfId === 'undefined' || pdfId === 'null') {
      _toast('Invalid PDF ID. Please refresh and try again.', 'error');
      return;
    }
    var pdfIdStr = String(pdfId);

    // STEP 1: Check window.PDFS
    var pdf = (window.PDFS || []).find(function(p) { return String(p.id) === pdfIdStr; });
    if (pdf && typeof window.normalizePdf === 'function') pdf = window.normalizePdf(pdf);
    console.log('[SMCI] window.PDFS lookup:', pdf ? 'FOUND' : 'NOT FOUND', '| window.PDFS length:', (window.PDFS||[]).length);

    // STEP 2: Check persistent _smciPdfStore (survives window.PDFS replacement)
    if (!pdf && _smciPdfStore[pdfIdStr]) {
      pdf = _smciPdfStore[pdfIdStr];
      if (typeof window.normalizePdf === 'function') pdf = window.normalizePdf(pdf);
      console.log('[SMCI] _smciPdfStore lookup: FOUND');
    }

    // STEP 3: Fetch from Supabase by ID
    if (!pdf) {
      _log('openReadingRoom: pdf ' + pdfIdStr + ' not in window.PDFS or _smciPdfStore, fetching from DB...');
      var sbClient = _sb();
      if (sbClient) {
        try {
          var fetchRes = await sbClient.from('pdfs').select('*').eq('id', pdfIdStr).single();
          console.log('[SMCI] Supabase fetch result:', { error: fetchRes.error, hasData: !!fetchRes.data });
          if (!fetchRes.error && fetchRes.data) {
            pdf = fetchRes.data;
            if (typeof window.normalizePdf === 'function') pdf = window.normalizePdf(pdf);
            // Store in persistent store AND window.PDFS
            if (pdf) {
              _smciPdfStore[pdfIdStr] = pdf;
              if (!window.PDFS) window.PDFS = [];
              if (!window.PDFS.some(function(x) { return String(x.id) === pdfIdStr; })) {
                window.PDFS.push(pdf);
              }
            }
          }
        } catch(e) { _warn('openReadingRoom: DB fetch failed', e); }
      }
    }
    if (!pdf) { _toast('PDF not found.', 'error'); return; }

    var status = await _getStatus(false);
    // FIX: If cached state says not-premium, force a fresh Supabase fetch before giving up.
    // This handles the race where SMCI state hasn't been populated from cache yet.
    if (!status.isPremium) {
      _log('openReadingRoom: cached isPremium=false, forcing re-fetch...');
      status = await _getStatus(true);
    }
    if (!status.isPremium) { _toast('Premium membership required.', 'info'); return; }

    var enabledCatsLower = await _getEnabledCategoryNames(false);
    if (!(await _isPdfInPremiumCategory(pdf, enabledCatsLower))) {
      _toast('This PDF is not included in Premium.', 'info');
      return;
    }

    var client = _sb();
    if (!client) { _toast('Connection error.', 'error'); return; }

    var pdfUrl = '';
    try {
      var row = await client.from('pdfs').select('pdf_url,title').eq('id', pdfId).single();
      if (row.data) pdfUrl = row.data.pdf_url || '';
    } catch(e) { _warn('RR: pdf_url fetch', e); }
    if (!pdfUrl) pdfUrl = pdf.pdf_url || pdf.pdfUrl || '';
    if (!pdfUrl) { _toast('PDF URL not found.', 'error'); return; }

    var url = await _resolveSignedUrl(pdfUrl, client);
    if (!url) { _toast('Could not generate secure URL.', 'error'); return; }

    _openReadingRoom(pdf, url);
  }

  window.SMCI = {
    _version:               'pci-2.6',
    openReadingRoom:        function(pdfId) { return _openReadingRoomById(pdfId); },
    _injectStatus:          function(status) { _injectStatus(status); },
    _getState:              function() { return Object.assign({}, _state); },
    isPremium:              function() { return _getStatus(false).then(function(s) { return s.isPremium; }); },
    getStatus:              function(f) { return _getStatus(f || false); },
    getPremiumCategoryPdfs: function(f) { return _getPremiumCategoryPdfs(f || false); },
    syncAll:                function(f) { return syncAll(f || false); },
    refresh:                function() { _state.fetchedAt = 0; _catCache.fetchedAt = 0; return syncAll(true); },
    injectLibrarySection:   function() { return injectLibrarySection(true); },
    renderHomePremiumShelf: function(f) { return renderHomePremiumShelf(f || false); },
    renderPremiumLibraryPage: function(f) { return renderPremiumLibraryPage(f || false); },
    getEnabledCategories:   function() { return _fetchCategoryConfig(false); },
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _init); }
  else { _init(); }
})();
