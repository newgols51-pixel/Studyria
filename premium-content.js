/**
 * premium-content.js — Studyria Premium Content Integration v2.0
 *
 * PHASE 1: Premium Handwritten Notes unlocked for active Premium Members.
 *
 * SAFETY CONTRACT:
 *   ✅ READS ONLY: user_memberships, membership_plans, premium_categories
 *   ✅ Zero new payment logic — uses existing buyPDF() / PPAY
 *   ✅ Zero changes to payment-service.js, Razorpay, buyPDF, purchased_pdfs
 *   ✅ Zero new DB writes (payment-related)
 *   ✅ All selectors namespaced under SMCI / smci-*
 *   ✅ Premium access = category controlled by admin toggle
 *   ✅ Individual purchases always work regardless of membership
 */
(function () {
  'use strict';
  if (window.SMCI && window.SMCI._version === 'pci-2.0') return;

  /* ── Constants ─────────────────────────────────────────────────── */
  var CACHE_TTL_MS      = 60000;           /* 1-min membership cache   */
  var CAT_CACHE_TTL_MS  = 300000;          /* 5-min category cache     */
  var SECTION_ID        = 'smci-premium-notes-section';
  var ADMIN_SECTION_ID  = 'smci-admin-prem-cats';

  /* ── State ─────────────────────────────────────────────────────── */
  var _state = {
    isPremium: false, status: 'none', planName: 'Free', planSlug: null,
    expiresAt: null, daysLeft: 0, fetchedAt: 0, fetching: false
  };
  var _catCache = { cats: null, fetchedAt: 0 }; /* premium_categories rows */

  /* ── Utilities ─────────────────────────────────────────────────── */
  function _sb()    { return window.supabaseClient || null; }
  function _user()  { return window.currentUser    || null; }
  function _uid()   { var u = _user(); return u ? (u.uid || u.id || null) : null; }
  function _toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); }
  function _esc(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _log(m, d) { if (d !== undefined) console.debug('[SMCI]', m, d); else console.debug('[SMCI]', m); }
  function _warn(m, e) { console.warn('[SMCI]', m, e || ''); }

  /* ─────────────────────────────────────────────────────────────────
     § MEMBERSHIP STATUS FETCH (unchanged from v1)
  ──────────────────────────────────────────────────────────────────*/
  async function _fetchStatus() {
    var client = _sb(), uid = _uid();
    if (!client || !uid) {
      Object.assign(_state, { isPremium: false, status: 'none', planName: 'Free',
        planSlug: null, expiresAt: null, daysLeft: 0, fetchedAt: Date.now(), fetching: false });
      return;
    }
    _state.fetching = true;
    try {
      var memRes = await client.from('user_memberships')
        .select('id,plan_id,status,started_at,expires_at')
        .eq('user_id', uid).order('expires_at', { ascending: false }).limit(1).maybeSingle();
      var mem = (!memRes.error && memRes.data) ? memRes.data : null;

      if (!mem || mem.status !== 'active') {
        Object.assign(_state, { isPremium: false, status: mem ? 'expired' : 'none',
          planName: 'Free', planSlug: null, expiresAt: mem ? mem.expires_at : null,
          daysLeft: 0, fetchedAt: Date.now(), fetching: false });
        return;
      }
      var now = new Date(), exp = mem.expires_at ? new Date(mem.expires_at) : null;
      if (!exp || exp <= now) {
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
      var daysLeft = Math.max(0, Math.ceil((exp - now) / 86400000));
      Object.assign(_state, { isPremium: true, status: 'active', planName: planName, planSlug: planSlug,
        expiresAt: mem.expires_at, daysLeft: daysLeft, fetchedAt: Date.now(), fetching: false });
      _log('Active premium', { plan: planName, daysLeft: daysLeft });
    } catch (e) {
      _warn('_fetchStatus exception', e);
      _state.isPremium = false; _state.status = 'none';
      _state.fetching = false; _state.fetchedAt = Date.now();
    }
  }

  async function _getStatus(force) {
    var stale = (Date.now() - _state.fetchedAt) > CACHE_TTL_MS;
    if (force || stale || !_state.fetchedAt) await _fetchStatus();
    return Object.assign({}, _state);
  }

  /* ─────────────────────────────────────────────────────────────────
     § PREMIUM CATEGORIES (fetched from Supabase admin toggle table)
  ──────────────────────────────────────────────────────────────────*/
  async function _fetchPremiumCategories(force) {
    var sb = _sb();
    if (!sb) return [];
    var stale = (Date.now() - _catCache.fetchedAt) > CAT_CACHE_TTL_MS;
    if (!force && !stale && _catCache.cats !== null) return _catCache.cats;

    try {
      var res = await sb.from('premium_categories')
        .select('id,category_name,is_enabled,sort_order')
        .eq('is_enabled', true)
        .order('sort_order', { ascending: true });

      var cats = (!res.error && res.data) ? res.data : [];
      _catCache.cats = cats;
      _catCache.fetchedAt = Date.now();
      _log('Premium categories loaded', cats.map(function(c){ return c.category_name; }));
      return cats;
    } catch (e) {
      _warn('_fetchPremiumCategories error', e);
      return _catCache.cats || [];
    }
  }

  /* Get the set of enabled category names (lower-cased for match) */
  async function _getEnabledCategoryNames(force) {
    var cats = await _fetchPremiumCategories(force);
    return cats.map(function(c) { return (c.category_name || '').toLowerCase().trim(); });
  }

  /* Check if a single PDF belongs to any enabled premium category */
  async function _isPdfInPremiumCategory(pdf, enabledCats) {
    if (!enabledCats || enabledCats.length === 0) return false;
    var pdfCat = (pdf.category || '').toLowerCase().trim();
    if (!pdfCat) return false;
    return enabledCats.some(function(ec) { return pdfCat === ec || pdfCat.includes(ec) || ec.includes(pdfCat); });
  }

  /* Get all PDFs that belong to enabled premium categories */
  async function _getPremiumCategoryPdfs(force) {
    var enabledCats = await _getEnabledCategoryNames(force);
    if (enabledCats.length === 0) return [];
    var allPdfs = window.PDFS || [];
    return allPdfs.filter(function(p) {
      if (!p || !p.title) return false;
      var pdfCat = (p.category || '').toLowerCase().trim();
      if (!pdfCat) return false;
      return enabledCats.some(function(ec) {
        return pdfCat === ec || pdfCat.includes(ec) || ec.includes(pdfCat);
      });
    });
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
     § BUY PDF PATCH — premium bypass for category-enabled PDFs
     Individual purchases ALWAYS work. Bypass ONLY when:
       1. User has active membership
       2. PDF's category is enabled in premium_categories
  ──────────────────────────────────────────────────────────────────*/
  function _patchBuyPDF() {
    var orig = window.buyPDF;
    if (!orig || orig._smciPatched) return;
    window.buyPDF = async function buyPDF_smci(pdfId, amount, legacyUrl) {
      /* Free PDFs → original flow */
      var pdf = (window.PDFS || []).find(function(p) { return String(p.id) === String(pdfId); });
      if (pdf && typeof window.normalizePdf === 'function') pdf = window.normalizePdf(pdf);
      var isFree = pdf ? (pdf.free || Number(pdf.price || 0) === 0) : (Number(amount || 0) === 0);
      if (isFree) return orig.call(this, pdfId, amount, legacyUrl);

      /* Already individually owned → original flow (permanent lifetime access) */
      if (typeof window._isOwned === 'function' && window._isOwned(String(pdfId))) {
        _log('Individual owner passthrough', pdfId);
        return orig.call(this, pdfId, amount, legacyUrl);
      }

      /* Check membership */
      var status = await _getStatus(false);
      if (!status.isPremium) return orig.call(this, pdfId, amount, legacyUrl);

      /* Check category — must be in an enabled premium category */
      var enabledCats = await _getEnabledCategoryNames(false);
      var inPremCat = pdf ? await _isPdfInPremiumCategory(pdf, enabledCats) : false;
      if (!inPremCat) {
        _log('PDF not in premium category — normal purchase', pdfId);
        return orig.call(this, pdfId, amount, legacyUrl);
      }

      /* Premium bypass — open PDF directly */
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

      window.open(url, '_blank');
      if (typeof window.trackReadingSession === 'function') window.trackReadingSession(pdfId);
      if (typeof window.trackPdfDownloadEvent === 'function') window.trackPdfDownloadEvent(pdf || { id: pdfId }, 'premium_member');
      _toast('Opening with Premium access! 👑', 'success');
    };
    window.buyPDF._smciPatched = true;
    _log('buyPDF patched (v2 — category-based)');
  }

  function _patchTriggerPDFDownload() {
    var orig = window.triggerPDFDownload;
    if (!orig || orig._smciPatched) return;
    window.triggerPDFDownload = async function triggerPDFDownload_smci(pdfId) {
      if (typeof window._isOwned === 'function' && window._isOwned(String(pdfId))) return orig.call(this, pdfId);
      var status = await _getStatus(false);
      if (!status.isPremium) return orig.call(this, pdfId);
      var pdf = (window.PDFS || []).find(function(p) { return String(p.id) === String(pdfId); });
      var enabledCats = await _getEnabledCategoryNames(false);
      var inPremCat = pdf ? await _isPdfInPremiumCategory(pdf, enabledCats) : false;
      if (!inPremCat) return orig.call(this, pdfId);

      _log('Premium bypass download', pdfId);
      var client = _sb(), user = _user();
      if (!client || !user) return orig.call(this, pdfId);

      var pdfUrl = '';
      try {
        var row = await client.from('pdfs').select('pdf_url').eq('id', pdfId).single();
        if (row.data) pdfUrl = row.data.pdf_url || '';
      } catch (e) {}
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
    _log('triggerPDFDownload patched (v2)');
  }

  /* ─────────────────────────────────────────────────────────────────
     § MY LIBRARY — PREMIUM MEMBERSHIP SECTION
  ──────────────────────────────────────────────────────────────────*/
  function _buildPremiumCard(pdf) {
    var title   = _esc(pdf.title || 'Untitled');
    var cover   = pdf.coverImage || pdf.cover_image || pdf.cover_url || '';
    var price   = Number(pdf.price || 0);
    var cat     = _esc(pdf.category || '');
    var id      = String(pdf.id);
    var coverHtml = cover
      ? '<img src="' + cover + '" alt="' + title + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'" loading="lazy" decoding="async">'
      : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:linear-gradient(135deg,rgba(61,142,248,0.08),rgba(139,92,246,0.08))">📌</div>';
    return '<div onclick="buyPDF(\'' + id + '\',' + price + ')" style="cursor:pointer;border-radius:10px;'
      + 'background:var(--glass-bg,rgba(255,255,255,0.03));border:1px solid var(--glass-border,rgba(255,255,255,0.08));'
      + 'overflow:hidden;transition:transform .15s,box-shadow .15s" '
      + 'onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 6px 20px rgba(0,0,0,.3)\'" '
      + 'onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'
      + '<div style="position:relative;height:110px;overflow:hidden">'
      + coverHtml
      + '<div style="position:absolute;top:5px;right:5px;background:linear-gradient(135deg,#fbbf24,#f59e0b);'
      + 'color:#000;font-size:.55rem;font-weight:800;padding:2px 6px;border-radius:10px">👑 PREMIUM</div>'
      + '</div>'
      + '<div style="padding:8px">'
      + '<div style="font-size:.74rem;font-weight:600;color:var(--text1);line-height:1.3;margin-bottom:3px;'
      + 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + title + '</div>'
      + (cat ? '<div style="font-size:.62rem;color:var(--text2);margin-bottom:5px">' + cat + '</div>' : '')
      + '<button onclick="event.stopPropagation();buyPDF(\'' + id + '\',' + price + ')" '
      + 'style="width:100%;padding:5px;border-radius:6px;border:none;cursor:pointer;font-size:.7rem;font-weight:700;'
      + 'background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));'
      + 'color:#fbbf24;border:1px solid rgba(251,191,36,0.25)">👑 Open Free</button>'
      + '</div></div>';
  }

  function _buildPremiumSection(pdfs, status, enabledCatNames) {
    var expFmt = '';
    if (status.expiresAt) {
      try { expFmt = new Date(status.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) {}
    }
    /* Group cards by category */
    var grouped = {};
    pdfs.forEach(function(pdf) {
      var cat = pdf.category || 'Premium Notes';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(pdf);
    });

    var sectionsHtml = '';
    Object.keys(grouped).forEach(function(catName) {
      var catPdfs = grouped[catName];
      sectionsHtml += '<div style="margin-bottom:20px">'
        + '<div style="font-size:.78rem;font-weight:700;color:rgba(251,191,36,0.8);margin-bottom:10px;'
        + 'display:flex;align-items:center;gap:6px">'
        + '<span>📚</span><span>' + _esc(catName) + '</span>'
        + '<span style="font-size:.62rem;color:rgba(255,255,255,0.35);font-weight:400">(' + catPdfs.length + ' notes)</span>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">'
        + catPdfs.map(_buildPremiumCard).join('')
        + '</div></div>';
    });

    if (!sectionsHtml) {
      sectionsHtml = '<div style="text-align:center;padding:24px;color:var(--text2);font-size:.88rem">No Premium Notes in catalogue yet.</div>';
    }

    return '<div id="' + SECTION_ID + '" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.08))">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">'
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
      + '<button onclick="navigate(\'library\')" style="font-size:.75rem;color:var(--accent);'
      + 'background:none;border:1px solid rgba(61,142,248,0.25);border-radius:20px;'
      + 'padding:5px 12px;cursor:pointer;font-weight:600">View All →</button>'
      + '</div>'
      + sectionsHtml
      + '</div>';
  }

  async function injectLibrarySection(force) {
    var panel = document.getElementById('bsfTabPanel');
    var old = document.getElementById(SECTION_ID);
    if (old) old.remove();
    if (!panel) return;

    var status = await _getStatus(force || false);
    if (!status.isPremium) { _log('Not premium — skip library section'); return; }

    var pdfs = await _getPremiumCategoryPdfs(force);
    var enabledCats = await _getEnabledCategoryNames(false);
    _log('Injecting premium section', pdfs.length + ' PDFs in ' + enabledCats.length + ' categories');

    if (pdfs.length === 0) {
      /* Still show the section header even if no PDFs match yet */
      var noContentHtml = '<div id="' + SECTION_ID + '" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--glass-border,rgba(255,255,255,0.08))">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">'
        + '<span>👑</span><span style="font-weight:700;font-size:.95rem;color:var(--text1)">⭐ Premium Membership</span>'
        + '<span style="font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:20px;background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(245,158,11,0.1));color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">ACTIVE</span>'
        + '</div>'
        + '<div style="text-align:center;padding:24px;color:var(--text2);font-size:.85rem">'
        + 'Premium Notes are loading… <a onclick="SMCI.syncAll(true)" style="color:#fbbf24;cursor:pointer">Refresh</a>'
        + '</div></div>';
      var frag = document.createElement('div');
      frag.innerHTML = noContentHtml;
      panel.insertBefore(frag.firstChild, panel.firstChild);
      return;
    }

    var frag = document.createElement('div');
    frag.innerHTML = _buildPremiumSection(pdfs, status, enabledCats);
    panel.insertBefore(frag.firstChild, panel.firstChild);
  }

  function _removePremiumSection() {
    var el = document.getElementById(SECTION_ID);
    if (el) el.remove();
  }

  /* ─────────────────────────────────────────────────────────────────
     § BADGES & GLOBAL STATE
  ──────────────────────────────────────────────────────────────────*/
  function _updateBadges(isPremium) {
    document.querySelectorAll('[data-prm-status]').forEach(function(el) {
      el.textContent = isPremium ? '👑 Premium' : '🔒 Free';
    });
    var pip = document.querySelector('.p5d-tab-pip');
    if (pip) pip.style.display = isPremium ? 'block' : 'none';
    var banner = document.querySelector('#dashMain .me-premium-banner');
    if (banner) banner.style.display = isPremium ? 'none' : '';
  }

  async function syncAll(force) {
    var status = await _getStatus(force || false);
    _updateBadges(status.isPremium);
    var panel = document.getElementById('bsfTabPanel');
    if (panel) {
      if (status.isPremium) await injectLibrarySection(false);
      else _removePremiumSection();
    }
    try { window.dispatchEvent(new CustomEvent('smci:statusUpdated', { detail: status })); } catch (_) {}
    return status;
  }

  /* ─────────────────────────────────────────────────────────────────
     § HOOKS (identical to v1 — do not break existing wiring)
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
      if (!pdf) return res;
      if (Number(pdf.price || 0) === 0) return res;
      var status = await _getStatus(false);
      if (!status.isPremium) return res;
      /* Check if this PDF's category is premium-enabled */
      var enabledCats = await _getEnabledCategoryNames(false);
      var inPremCat = await _isPdfInPremiumCategory(pdf, enabledCats);
      if (!inPremCat) return res;
      setTimeout(function() {
        document.querySelectorAll('.pdp-cta-btn,.pdp-buy-primary,#pdpStickyBuy,.pdp-sticky-buy').forEach(function(btn) {
          if (/buy|purchase|⚡/i.test(btn.textContent)) {
            btn.textContent = '👑 Open with Premium';
            btn.style.background = 'linear-gradient(135deg,#fbbf24,#f59e0b)';
            btn.style.color = '#000';
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
    _catCache.fetchedAt = 0; /* also bust category cache */
    syncAll(true).then(function(s) {
      if (s.isPremium) {
        _toast('👑 Premium active! All Premium Notes unlocked.', 'success');
        injectLibrarySection(true);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     § ADMIN — PREMIUM CATEGORIES PANEL
     Called by window.renderAdminPremiumCategories(container)
     Injected into the existing Memberships admin tab
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
      /* Load all categories from the categories table */
      var catRes = await sb.from('categories').select('id,name,slug,sort_order').order('sort_order', { ascending: true });
      var allCats = (!catRes.error && catRes.data) ? catRes.data : [];

      /* Load current premium_categories state */
      var premRes = await sb.from('premium_categories').select('*');
      var premRows = (!premRes.error && premRes.data) ? premRes.data : [];
      var premMap = {};
      premRows.forEach(function(r) { premMap[r.category_name.toLowerCase()] = r; });

      /* For Phase 1 — seed any categories not yet in premium_categories as disabled */
      /* (This happens silently — no writes needed, UI just shows them as OFF) */

      var h = '<div id="' + ADMIN_SECTION_ID + '" style="margin-top:0">';
      h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
        + '<span style="font-size:1.1rem">⭐</span>'
        + '<div>'
        + '<div style="font-size:.95rem;font-weight:700;color:var(--text1,#f0f4f8)">Premium Categories</div>'
        + '<div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-top:2px">Toggle which categories unlock for Premium Members. Phase 1: Only "Premium Handwritten Notes".</div>'
        + '</div>'
        + '<button onclick="window.renderAdminPremiumCategories(this.closest(\'#' + ADMIN_SECTION_ID + '\').parentElement)" '
        + 'style="margin-left:auto;font-size:.72rem;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);'
        + 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);cursor:pointer">↻ Refresh</button>'
        + '</div>';

      if (allCats.length === 0) {
        h += '<div style="padding:20px;color:rgba(255,255,255,0.4);font-size:.85rem">No categories found. Add categories first.</div>';
      } else {
        h += '<div style="display:flex;flex-direction:column;gap:8px">';
        allCats.forEach(function(cat) {
          var catKey = cat.name.toLowerCase();
          var premRow = premMap[catKey] || null;
          var isEnabled = premRow ? premRow.is_enabled : false;
          var rowId = 'smci-cat-row-' + String(cat.id).replace(/[^a-zA-Z0-9]/g, '');

          h += '<div id="' + rowId + '" style="display:flex;align-items:center;gap:12px;'
            + 'background:rgba(255,255,255,' + (isEnabled ? '.06' : '.025') + ');'
            + 'border:1px solid rgba(255,255,255,' + (isEnabled ? '.12' : '.06') + ');'
            + 'border-radius:10px;padding:12px 16px;transition:all .2s">'

            /* Icon */
            + '<span style="font-size:1.1rem;flex-shrink:0">' + (isEnabled ? '🟢' : '⚫') + '</span>'

            /* Name */
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:.85rem;font-weight:600;color:var(--text1,#f0f4f8)">' + _esc(cat.name) + '</div>'
            + '<div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-top:2px">'
            + (isEnabled ? '✅ Unlocked for all Premium Members' : '🔒 Not included in membership')
            + '</div>'
            + '</div>'

            /* Phase 1 note */
            + (cat.name === 'Premium Handwritten Notes'
              ? '<span style="font-size:.6rem;padding:2px 8px;border-radius:10px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.25);font-weight:700">Phase 1</span>'
              : '')

            /* Toggle button */
            + '<button onclick="window._smciToggleCategory(\'' + _esc(cat.name) + '\',' + (isEnabled ? 'false' : 'true') + ',\'' + rowId + '\')" '
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

      h += '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(61,142,248,.08);'
        + 'border:1px solid rgba(61,142,248,.2);font-size:.72rem;color:rgba(255,255,255,.5)">'
        + 'ℹ️ Individual purchases always work regardless of category toggle. '
        + 'Toggling OFF only affects membership access — it never removes purchased content.'
        + '</div>';

      h += '</div>';
      container.innerHTML = h;
    } catch (err) {
      console.error('[SMCI Admin]', err);
      container.innerHTML = '<div style="padding:20px;color:#ff4d6d">⚠ Error: ' + _esc(err.message || String(err)) + '</div>';
    }
  };

  /* ── Toggle a single category ON/OFF ─────────────────────────── */
  window._smciToggleCategory = async function(categoryName, enable, rowId) {
    var sb = _sb();
    if (!sb) { _toast('Supabase not connected', 'error'); return; }

    var btn = rowId ? document.querySelector('#' + rowId + ' button') : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }

    try {
      /* Upsert into premium_categories */
      var res = await sb.from('premium_categories').upsert({
        category_name: categoryName,
        is_enabled: enable,
        updated_at: new Date().toISOString()
      }, { onConflict: 'category_name' });

      if (res.error) throw new Error(res.error.message);

      /* Bust category cache */
      _catCache.fetchedAt = 0;

      _toast((enable ? '✅ ' : '⏸ ') + categoryName + (enable ? ' enabled for Premium!' : ' disabled.'), enable ? 'success' : 'info');
      _log('Category toggled', { categoryName: categoryName, enable: enable });

      /* Re-render the admin section */
      var container = rowId ? document.getElementById(rowId) : null;
      if (container) {
        var wrap = container.parentElement ? container.parentElement.parentElement : null;
        if (wrap) window.renderAdminPremiumCategories(wrap);
      }

      /* Also bust membership cache + sync if user is premium */
      if (window.SMCI) window.SMCI.refresh();

    } catch (e) {
      _warn('Toggle category error', e);
      _toast('Error: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = enable ? '▶ Enable' : '⏸ Disable'; }
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

    window.addEventListener('studyria:membership:activated', _onActivated);
    window.addEventListener('smci:refresh', function() { syncAll(true); });

    if (_uid()) { setTimeout(function() { syncAll(false); }, 900); }
    else {
      var _aw = 0;
      function _waitAuth() {
        if (_uid()) { syncAll(false); }
        else if (_aw++ < 20) { setTimeout(_waitAuth, 500); }
      }
      setTimeout(_waitAuth, 1200);
    }
    _log('Init complete — SMCI pci-2.0');
  }

  /* ── Public API ────────────────────────────────────────────────── */
  window.SMCI = {
    _version:            'pci-2.0',
    isPremium:           function() { return _getStatus(false).then(function(s) { return s.isPremium; }); },
    getStatus:           function(f) { return _getStatus(f || false); },
    syncAll:             function(f) { return syncAll(f || false); },
    refresh:             function() { _state.fetchedAt = 0; _catCache.fetchedAt = 0; return syncAll(true); },
    injectLibrarySection: function() { return injectLibrarySection(true); },
    getEnabledCategories: function() { return _getEnabledCategoryNames(false); },
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _init); }
  else { _init(); }
})();
