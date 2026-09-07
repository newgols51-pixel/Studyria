/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PREMIUM PDF CHECKOUT (PCO)
   ═══════════════════════════════════════════════════════════════════════
   A NEW UI layer that plugs into the EXISTING trusted systems —
   it does NOT duplicate any business logic:

     Product data .... window.PDFS + window.normalizePdf (pdf-list.js)
     Price verify .... Cart.verifyList()  (cart.js — DB is the only price source)
     Payment ......... Cart.payItems()    (cart.js — THE one Razorpay impl:
                       duplicate-guarded purchased_pdfs insert, Pipedream
                       webhook, ownership re-check, premium bypass)
     Cart ............ Cart.add / has / count (cart.js)
     Wishlist ........ window.toggleWish / window.wishlist
     Ownership ....... purchased_pdfs via verifyList + Cart.openOwned
     Library ......... Cart.openOwned / #library route
     Auth ............ existing Supabase session + #login route

   PREVIEW SAFETY (hard guarantees):
     • No body/html/document overflow manipulation anywhere.
     • No global touch/pointer/wheel handlers — page scroll & browser
       pinch zoom stay 100% native.
     • The preview stage is a bounded box; images are object-fit:contain
       so they can never escape. No custom zoom at all.
     • The mobile sticky bar is fixed, safe-area aware, and the page
       reserves bottom padding for it — nothing is ever covered.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var RETURN_KEY = 'pco_return';
  var LAST_KEY  = 'pco_last';      // refresh-safe fallback product

  /* ── State ──────────────────────────────────────────────────────── */
  var S = {
    pdfId: null,
    phase: 'loading',      // loading|ready|guest|owned|premium|success|notfound|error
    pdf: null,              // normalized local product (display meta + preview data)
    db: null,               // DB-verified row via Cart.verifyList (price source of truth)
    user: null,
    isPremium: false,
    notice: null,           // { kind: 'info'|'warn', text }
    freeGrant: false,          // last action was a free-access grant
    payBusy: false,
    paymentId: null,        // last successful payment id (receipt display)
    payAmount: null,        // verified amount actually charged (receipt display)
    failMsg: null,          // last error message (failed state card)
    fromPage: null,         // SPA page the user came from (smart Back)
    retryCount: 0
  };
  var PV = { items: [], idx: 0, doc: null, cache: {} };   // preview state

  /* ── Helpers ────────────────────────────────────────────────────── */
  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* ── Self-bootstrap ────────────────────────────────────────────────
     The checkout page markup lives in index.html. If a device serves a
     stale shell (old SW / cached HTML) that lacks #page-pdf-checkout,
     PCO builds its own container instead of falling back to the legacy
     direct-Razorpay flow. The CSS link is injected too, so the page is
     fully functional even from a stale shell + fresh JS. */
  function _ensurePage() {
    if (document.getElementById('pcoRoot')) return true;
    try {
      var page = document.createElement('div');
      page.className = 'page';
      page.id = 'page-pdf-checkout';
      page.innerHTML = '<div id="pcoRoot"></div>';
      var anchor = document.getElementById('page-cart');   // old #page-checkout is retired
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(page, anchor.nextSibling);
      else document.body.appendChild(page);
      if (!document.querySelector('link[href*="pco.css"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/pco.css?v=20260907c';
        document.head.appendChild(link);
      }
      return true;
    } catch (_) { return false; }
  }
  function _root() { return document.getElementById('pcoRoot'); }
  function _client() { return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null); }
  function _toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'info'); }
  function _ga4(ev, params) { try { if (typeof window.gtag === 'function') window.gtag('event', ev, params || {}); } catch (_) {} }
  function _fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
  /* §12/§22 refresh-safe URL: keep #pdf-checkout/<id> in the address bar
     (replaceState — never adds history entries, Back still returns to the
     grid the user came from). On refresh the route re-hydrates from the id
     and load() re-verifies ownership from the DB. */
  function _syncHash() {
    if (!S.pdfId) return;
    try { history.replaceState(history.state, '', '#pdf-checkout/' + encodeURIComponent(S.pdfId)); } catch (e) {}
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  function open(pdfId) {
    _ensurePage();
    S.fromPage = (window.currentPage && window.currentPage !== 'pdf-checkout') ? window.currentPage : (S.fromPage || null);
    S.pdfId = String(pdfId || '');
    S.notice = null; S.failMsg = null; S.freeGrant = false; S.retryCount = 0;
    S.phase = 'loading';
    try { sessionStorage.setItem(LAST_KEY, S.pdfId); } catch (e) {}   // refresh-safe
    _syncHash();
    if (window.currentPage !== 'pdf-checkout') {
      // hash carries the id → shareable, refresh-safe, back-button friendly
      if (typeof navigate === 'function') { navigate('pdf-checkout/' + S.pdfId); return; }  // navigate() re-renders via renderFromRoute()
    }
    load();
  }

  /* Called by the navigate() case in index.html */
  function renderFromRoute() {
    _ensurePage();
    if (window._pcoDeepLinkId) { S.pdfId = String(window._pcoDeepLinkId); window._pcoDeepLinkId = null; S.notice = null; S.failMsg = null; }
    if (!S.pdfId) {
      // bare #pdf-checkout (e.g. refresh after success): fall back to the
      // last viewed product so the page never shows a dead end.
      var last = null;
      try { last = sessionStorage.getItem(LAST_KEY); } catch (e) {}
      if (last) { S.pdfId = String(last); }
      else { S.phase = 'notfound'; render(); return; }
    }
    try { sessionStorage.setItem(LAST_KEY, S.pdfId); } catch (e) {}
    _syncHash();
    load();
  }

  /* ── Data load (DB is the source of truth for price & status) ───── */
  async function load() {
    S.phase = 'loading';
    render();

    var client = _client();
    // product meta from the existing shared catalog
    var local = (window.PDFS || []).find(function (p) { return String(p.id) === String(S.pdfId); });
    if (local && window.normalizePdf) {
      try {
        var copy = Object.assign({}, local);
        window.normalizePdf(copy);
        local = copy;
      } catch (e) { /* keep raw */ }
    }

    if (!client) { S.phase = 'error'; render(); return; }

    // auth state
    var user = null;
    try { var r = await client.auth.getUser(); user = r && r.data && r.data.user; } catch (e) {}
    S.user = user;

    // DB verification — same system the cart uses (Cart.verifyList)
    var verify;
    try {
      verify = await window.Cart.verifyList([
        { pdfId: S.pdfId, priceSnapshot: local ? Number(local.price) || 0 : 0, title: local ? local.title : '' }
      ]);
    } catch (e) {
      console.warn('[PCO] verifyList failed:', e);
      S.phase = 'error'; render(); return;
    }

    var v = verify && verify.items && verify.items[0];
    if (!v || v.state === 'unavailable') { S.phase = 'notfound'; render(); return; }

    S.db = v;                       // dbPrice / dbOriginal / dbTitle / dbCategory / dbCover
    S.pdf = local || { id: S.pdfId, title: v.dbTitle || 'Study Material', category: v.dbCategory || null, coverImage: v.dbCover || '', pages: 0, description: '' };

    // Ownership — same pre-check pattern as buyPDF(): based on the fresh
    // auth.getUser() session (never the possibly-stale window.currentUser).
    if (v.state === 'owned') { S.phase = 'owned'; render(); return; }
    if (user) {
      try {
        const rr = await client.from('purchased_pdfs')
          .select('pdf_uuid').eq('user_id', user.id).eq('status', 'paid').eq('pdf_uuid', String(S.pdfId));
        if (rr && rr.data && rr.data.length) { S.phase = 'owned'; render(); return; }
      } catch (e) { /* verifyList flag above is the primary signal */ }
    }

    // §5 FREE PRODUCT — never enters the payment flow. Existing free-access
    // system (downloadPDF) is used; Razorpay is never opened for ₹0.
    if (v.state === 'ok' && !(Number(v.dbPrice) > 0)) { S.phase = 'free'; render(); return; }

    // premium members get instant access (same business rule as buyPDF / Cart.pay)
    S.isPremium = false;
    if (user && window.SMCI && typeof window.SMCI.isPremium === 'function') {
      try { S.isPremium = !!(await window.SMCI.isPremium()); } catch (e) {}
    }
    if (S.isPremium) { S.phase = 'premium'; render(); return; }

    S.phase = user ? 'ready' : 'guest';
    buildPreview();
    render();
  }

  /* ═══════════════════════════════════════════════════════════════════
     PREVIEW — isolated, bounded, zero viewport impact.
     Data source: same fields the PDP V3 viewer uses (previewPage1..3 /
     preview_page_1..3, preview_pdf_url). No zoom, no touch handlers.
     ═══════════════════════════════════════════════════════════════════ */
  function buildPreview() {
    PV.items = []; PV.idx = 0; PV.doc = null; PV.cache = {};
    var pdf = S.pdf || {};

    var cover = String(pdf.coverImage || pdf.cover_url || pdf.cover_image || '').trim();
    PV.items.push({ type: 'cover', label: 'Cover', src: cover });

    var pp1 = String(pdf.previewPage1 || pdf.preview_page_1 || '').trim();
    var pp2 = String(pdf.previewPage2 || pdf.preview_page_2 || '').trim();
    var pp3 = String(pdf.previewPage3 || pdf.preview_page_3 || '').trim();
    if (pp1) PV.items.push({ type: 'preview', label: 'Page 1', src: pp1 });
    if (pp2) PV.items.push({ type: 'preview', label: 'Page 2', src: pp2 });
    if (pp3) PV.items.push({ type: 'preview', label: 'Page 3', src: pp3 });
  }

  /* PDF.js fallback (only when pre-generated preview images are absent) */
  async function loadPdfFallback() {
    var pdf = S.pdf || {};
    var previewUrl = String(pdf.previewPdfUrl || pdf.preview_pdf_url || '').trim();
    if (!previewUrl || !window.pdfjsLib) return;
    try {
      var docUrl = previewUrl;
      if (!previewUrl.indexOf('http') === 0 && window.supabaseClient) {
        try {
          var sd = await window.supabaseClient.storage.from('pdfs').createSignedUrl(previewUrl, 3600);
          if (sd && sd.signedUrl) docUrl = sd.signedUrl;
        } catch (e) {}
      }
      var doc = await window.pdfjsLib.getDocument({ url: docUrl, withCredentials: false }).promise;
      PV.doc = doc;
      var total = doc.numPages || 0;
      for (var i = 1; i <= Math.min(total, 3); i++) {
        PV.items.push({ type: 'pdfjs', label: 'Page ' + i, pageNum: i });
      }
    } catch (e) {
      console.warn('[PCO] preview PDF fallback failed:', e);
    }
  }

  function _renderPdfPage(pageNum) {
    if (PV.cache[pageNum]) return Promise.resolve(PV.cache[pageNum]);
    return PV.doc.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: 1.8 });
      var c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
        var url = c.toDataURL('image/jpeg', 0.85);
        PV.cache[pageNum] = url;
        return url;
      });
    });
  }

  function _wm() {
    var u = S.user;
    if (u && u.email) return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION\n' + u.email.split('@')[0].slice(0, 14);
    return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION';
  }

  function _showItem(idx) {
    if (idx < 0 || idx >= PV.items.length) return;
    PV.idx = idx;
    var stage = document.getElementById('pcoStage');
    if (!stage) return;
    var err = document.getElementById('pcoPvErr');
    if (err) err.style.display = 'none';

    var item = PV.items[idx];
    var img = document.getElementById('pcoPvImg');
    var load = document.getElementById('pcoPvLoad');
    var wm = document.getElementById('pcoPvWm');
    var ind = document.getElementById('pcoPvInd');
    var prev = document.getElementById('pcoPvPrev');
    var next = document.getElementById('pcoPvNext');

    if (ind) ind.textContent = (idx + 1) + ' / ' + PV.items.length;
    if (prev) prev.disabled = (idx === 0);
    if (next) next.disabled = (idx === PV.items.length - 1);
    Array.prototype.forEach.call(document.querySelectorAll('.pco-thumb'), function (t) {
      t.classList.toggle('active', Number(t.getAttribute('data-i')) === idx);
    });

    if (item.type === 'cover') {
      if (wm) wm.classList.remove('pco-visible');
      if (load) load.style.display = 'none';
      if (img) {
        img.classList.remove('pco-visible');
        if (!item.src) {
          // no cover available — show a graceful placeholder
          img.src = '';
          img.removeAttribute('src');
          img.classList.add('pco-visible');
          img.style.background = 'rgba(147,2,5,0.06)';
        } else {
          img.style.background = '';
          img.src = item.src;
          if (img.complete && img.naturalWidth) img.classList.add('pco-visible');  // cached
          img.onload = function () { img.classList.add('pco-visible'); };
          img.onerror = function () { img.classList.remove('pco-visible'); };
        }
      }
      return;
    }

    // preview pages: watermark on
    if (wm) { document.getElementById('pcoPvWmText').textContent = _wm(); wm.classList.add('pco-visible'); }
    if (load) load.style.display = '';
    if (img) img.classList.remove('pco-visible');

    if (item.src) {
      var pre = new Image();
      pre.onload = function () {
        if (PV.idx !== idx || !document.getElementById('pcoStage')) return;
        if (img) { img.src = item.src; img.classList.add('pco-visible'); }
        if (load) load.style.display = 'none';
      };
      pre.onerror = function () {
        if (PV.idx !== idx || !document.getElementById('pcoStage')) return;
        if (load) load.style.display = 'none';
        var e2 = document.getElementById('pcoPvErr');
        if (e2) { e2.style.display = ''; document.getElementById('pcoPvErrMsg').textContent = 'Preview page could not load.'; }
      };
      pre.src = item.src;
      // pre-warm adjacent
      var n = PV.items[idx + 1], p = PV.items[idx - 1];
      if (n && n.src) { var nn = new Image(); nn.src = n.src; }
      if (p && p.src) { var pn = new Image(); pn.src = p.src; }
    } else if (item.type === 'pdfjs') {
      // lazily ensure the PDF fallback doc is loaded
      if (!PV.doc) {
        loadPdfFallback().then(function () { if (PV.idx === idx) { _rebuildThumbs(); _showItem(idx); } });
        return;
      }
      _renderPdfPage(item.pageNum).then(function (url) {
        if (PV.idx !== idx || !document.getElementById('pcoStage')) return;
        if (img) { img.src = url; img.classList.add('pco-visible'); }
        if (load) load.style.display = 'none';
      }).catch(function () {
        if (PV.idx !== idx) return;
        if (load) load.style.display = 'none';
        var e3 = document.getElementById('pcoPvErr');
        if (e3) { e3.style.display = ''; document.getElementById('pcoPvErrMsg').textContent = 'Preview page could not load.'; }
      });
    }
  }

  function _rebuildThumbs() {
    var strip = document.getElementById('pcoThumbs');
    if (!strip) return;
    strip.innerHTML = PV.items.map(function (it, i) {
      var inner;
      if (it.src) inner = '<img src="' + _esc(it.src) + '" alt="' + _esc(it.label) + '">';
      else inner = '<div class="pco-thumb-fallback">' + _esc(it.label) + '</div>';
      return '<button type="button" class="pco-thumb" data-i="' + i + '" onclick="PCO._thumb(' + i + ')" aria-label="Show ' + _esc(it.label) + '">' +
        inner + '<span class="pco-thumb-label">' + _esc(it.label) + '</span></button>';
    }).join('');
  }

  /* preview public handlers (inline onclick) */
  window.PCO = window.PCO || {};
  var _prevFn = function () { _showItem(Math.max(0, PV.idx - 1)); };
  var _nextFn = function () { _showItem(Math.min(PV.items.length - 1, PV.idx + 1)); };
  var _thumbFn = function (i) { _showItem(Number(i)); };
  var _retryPvFn = function () {
    var e = document.getElementById('pcoPvErr');
    if (e) e.style.display = 'none';
    _showItem(PV.idx);
  };

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  function render() {
    var root = _root();
    if (!root) return;

    switch (S.phase) {
      case 'loading': root.innerHTML = _skeletonHTML(); _setBar(false); return;
      case 'notfound': root.innerHTML = _notFoundHTML(); _setBar(false); return;
      case 'error': root.innerHTML = _errorHTML(); _setBar(false); return;
      case 'owned': root.innerHTML = _shellHTML(_stateCardHTML('owned'), null, true); _setBar(false); return;
      case 'premium': root.innerHTML = _shellHTML(_stateCardHTML('premium'), null, true); _setBar(false); return;
      case 'success': root.innerHTML = _shellHTML(_successHTML(), null, true); _setBar(false); return;
      case 'free': root.innerHTML = _shellHTML(_stateCardHTML('free'), null, true); _setBar(false); return;
      case 'failed': root.innerHTML = _shellHTML(_stateCardHTML('failed'), null, true); _setBar(false); return;
      case 'cancelled': root.innerHTML = _shellHTML(_stateCardHTML('cancelled'), null, true); _setBar(false); return;
      case 'guest': root.innerHTML = _shellHTML(_previewHTML() + _infoHTML(), _guestSummaryHTML(), true); _bindGuest(); _afterMount(); _setBar(true, true); return;
      default: /* ready */
        root.innerHTML = _shellHTML(_previewHTML() + _infoHTML(), _summaryHTML(), false);
        _bindReady();
        _afterMount();
        _setBar(true);
    }
  }

  function _afterMount() {
    _rebuildThumbs();
    if (PV.items.length > 1) {
      var p = document.getElementById('pcoPvPrev'), n = document.getElementById('pcoPvNext'), i = document.getElementById('pcoPvInd');
      if (p) p.style.display = '';
      if (n) n.style.display = '';
      if (i) i.style.display = '';
    } else {
      var p2 = document.getElementById('pcoPvPrev'), n2 = document.getElementById('pcoPvNext'), i2 = document.getElementById('pcoPvInd');
      if (p2) p2.style.display = 'none';
      if (n2) n2.style.display = 'none';
      if (i2) i2.style.display = 'none';
    }
    var strip = document.getElementById('pcoThumbs');
    if (strip) strip.style.display = PV.items.length > 1 ? '' : 'none';
    _bindStageGestures();
    _showItem(0);
  }

  /* §7 MOBILE SWIPE — pointer events isolated to the stage box only.
     touch-action: pan-y (CSS) keeps vertical scrolling 100% native; we
     only act on clearly-horizontal gestures so page scroll and browser
     pinch zoom are never hijacked. No global handlers, no preventDefault. */
  function _bindStageGestures() {
    var stage = document.getElementById('pcoStage');
    if (!stage || PV.items.length < 2) return;
    var sx = 0, sy = 0, tracking = false;

    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;         // mouse users have arrows/thumbs
      tracking = true; sx = e.clientX; sy = e.clientY;
    }, { passive: true });

    stage.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        if (dx < 0) _nextFn(); else _prevFn();
      }
    }, { passive: true });

    stage.addEventListener('pointercancel', function () { tracking = false; }, { passive: true });

    // keyboard accessibility (§19)
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', 'PDF preview — use left and right arrow keys to browse pages');
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _prevFn(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); _nextFn(); }
    });
  }

  function _setBar(show, guestMode) {
    var bar = document.getElementById('pcoStickyBar');
    if (bar) bar.remove();
    var root = _root();
    if (!show || !root) return;
    var d = document.createElement('div');
    d.className = 'pco-sticky'; d.id = 'pcoStickyBar';
    if (S.phase === 'guest') {
      d.innerHTML = '<div class="pco-sticky-inner">' +
        '<div class="pco-sticky-price"><span class="pco-sp-now">₹' + _fmt(_price()) + '</span>' + _mrpHTML(true) + '</div>' +
        '<button type="button" class="pco-sticky-buy" onclick="PCO._signIn()">Sign in & Buy ₹' + _fmt(_price()) + '</button></div>';
    } else {
      d.innerHTML = '<div class="pco-sticky-inner">' +
        '<div class="pco-sticky-price"><span class="pco-sp-now">₹' + _fmt(_price()) + '</span>' + _mrpHTML(true) + '</div>' +
        _wishBtnHTML(true) +
        _cartIconHTML(true) +
        '<button type="button" class="pco-sticky-buy" id="pcoStickyBuy" onclick="PCO._pay()">⚡ Buy ₹' + _fmt(_price()) + '</button></div>';
    }
    root.appendChild(d);
  }

  /* ── price helpers (DB-verified values only) ────────────────────── */
  function _price() { return S.db && Number(S.db.dbPrice) > 0 ? Number(S.db.dbPrice) : (S.pdf ? Number(S.pdf.price) || 0 : 0); }
  function _mrp() { return S.db && Number(S.db.dbOriginal) > 0 ? Number(S.db.dbOriginal) : (S.pdf ? Number(S.pdf.originalPrice) || 0 : 0); }
  function _off() { var m = _mrp(), p = _price(); return m > p ? m - p : 0; }
  function _mrpHTML(inline) {
    var m = _mrp(), off = _off();
    if (!m || m <= _price()) return '';
    var pct = Math.round((off / m) * 100);
    return '<span class="pco-sp-mrp">₹' + _fmt(m) + '</span>' + (inline ? '<span class="pco-sp-off">' + pct + '% OFF</span>' : '');
  }

  /* ── layout pieces ─────────────────────────────────────────────── */
  function _topHTML() {
    return '<div class="pco-top">' +
      '<button type="button" class="pco-back" onclick="PCO._back()">← Back</button>' +
      '<span class="pco-secure-tag"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>SSL Secured Checkout</span></div>';
  }

  function _identHTML() {
    var t = (S.db && S.db.dbTitle) || (S.pdf && S.pdf.title) || 'Study Material';
    var cat = (S.db && S.db.dbCategory) || (S.pdf && S.pdf.category) || null;
    var pages = S.pdf && Number(S.pdf.pages) || 0;
    var chips = '';
    if (cat) chips += '<span class="pco-chip">' + _esc(cat) + '</span>';
    if (pages) chips += '<span class="pco-chip pco-chip-plain">' + Number(pages) + ' pages</span>';
    chips += '<span class="pco-chip pco-chip-plain">PDF · Download</span>';
    return '<div class="pco-ident">' +
      '<span class="pco-eyebrow">Premium Study Material</span>' +
      '<h1 class="pco-title">' + _esc(t) + '</h1>' +
      '<div class="pco-meta">' + chips + '</div></div>';
  }

  function _previewHTML() {
    return '<div class="pco-preview">' +
      '<div class="pco-preview-head"><span>Inside this PDF</span><span class="pco-preview-badge">Free preview</span></div>' +
      '<div class="pco-stage" id="pcoStage">' +
        '<img id="pcoPvImg" class="pco-stage-img" alt="PDF preview" draggable="false">' +
        '<div class="pco-wm" id="pcoPvWm"><span id="pcoPvWmText"></span></div>' +
        '<div class="pco-stage-loading" id="pcoPvLoad" style="display:none"><div class="pco-spinner"></div><span>Loading preview…</span></div>' +
        '<div class="pco-stage-error" id="pcoPvErr" style="display:none"><span id="pcoPvErrMsg">Preview could not load.</span>' +
          '<button type="button" class="pco-btn pco-btn-secondary" style="width:auto;padding:8px 16px;font-size:0.78rem" onclick="PCO._retryPv()">Retry</button></div>' +
        '<button type="button" class="pco-arrow pdp-arrow-prev pco-arrow-prev" id="pcoPvPrev" style="display:none" onclick="PCO._prev()" aria-label="Previous page">‹</button>' +
        '<button type="button" class="pco-arrow pco-arrow-next" id="pcoPvNext" style="display:none" onclick="PCO._next()" aria-label="Next page">›</button>' +
        '<div class="pco-stage-ind" id="pcoPvInd" style="display:none"></div>' +
      '</div>' +
      '<div class="pco-thumbs" id="pcoThumbs"></div>' +
      '</div>';
  }

  function _infoHTML() {
    var d = (S.pdf && S.pdf.description) || '';
    var desc = d ? '<p class="pco-desc">' + _esc(String(d).slice(0, 320)) + (d.length > 320 ? '…' : '') + '</p>' : '';
    var benefits = '' +
      '<ul class="pco-benefits">' +
      '<li><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>Complete PDF, downloadable instantly after payment</li>' +
      '<li><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>Stored in your Studyria Library — open anytime, on any device</li>' +
      '<li><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>Secure payment via Razorpay — UPI, cards & net banking</li>' +
      '</ul>';
    return '<div class="pco-info">' + _identHTML() + desc + benefits + '</div>';
  }

  function _prodRowHTML() {
    var t = (S.db && S.db.dbTitle) || (S.pdf && S.pdf.title) || 'Study Material';
    var c = (S.db && S.db.dbCover) || (S.pdf && S.pdf.coverImage) || '';
    var cat = (S.db && S.db.dbCategory) || (S.pdf && S.pdf.category) || 'Study Material';
    var img = c
      ? '<img class="pco-prod-cover" src="' + _esc(c) + '" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'pco-prod-noimg\',innerHTML:\'📚\'}))">'
      : '<div class="pco-prod-noimg">📚</div>';
    return '<div class="pco-prod-row">' + img +
      '<div><div class="pco-prod-name">' + _esc(t) + '</div>' +
      '<div class="pco-prod-sub">' + _esc(cat) + ' · Digital PDF</div></div></div>';
  }

  function _priceRowsHTML() {
    var p = _price(), m = _mrp(), off = _off();
    var rows = '<div class="pco-price-row"><span>Original Price</span><span>' + (m > p ? '₹' + _fmt(m) : '—') + '</span></div>';
    if (off > 0) rows += '<div class="pco-price-row pco-save"><span>Discount (' + Math.round((off / m) * 100) + '%)</span><span>−₹' + _fmt(off) + '</span></div>';
    rows += '<div class="pco-price-row"><strong>You Pay</strong><strong>₹' + _fmt(p) + '</strong></div>';
    return '<div class="pco-price-rows">' + rows + '</div>';
  }

  function _trustHTML() {
    return '<div class="pco-trust">' +
      '<div class="pco-trust-item"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>Secure Payment<small>Razorpay · UPI / Cards</small></div>' +
      '<div class="pco-trust-item"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Instant Access<small>Unlocks right after payment</small></div>' +
      '<div class="pco-trust-item"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 018 17h12"/><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/></svg>Lifetime Access<small>Always in your Library</small></div>' +
      '</div>';
  }

  function _wishBtnHTML(inline) {
    var inWish = false;
    try { inWish = (window.wishlist || []).some(function (w) { return String(w) === String(S.pdfId); }); } catch (e) {}
    if (inline) {
      return '<button type="button" class="pco-sticky-icon' + (inWish ? ' on' : '') + '" id="pcoWishIcon" onclick="PCO._wish()" aria-label="' + (inWish ? 'Remove from wishlist' : 'Add to wishlist') + '">' + (inWish ? '❤️' : '🤍') + '</button>';
    }
    return '<button type="button" class="pco-btn pco-btn-ghost" id="pcoWishBtn" onclick="PCO._wish()">' + (inWish ? '❤️ Saved to Wishlist' : '🤍 Add to Wishlist') + '</button>';
  }

  function _cartIconHTML() {
    var inCart = window.Cart && Cart.has(S.pdfId);
    return '<button type="button" class="pco-sticky-icon' + (inCart ? ' on' : '') + '" id="pcoCartIcon" onclick="PCO._cart()" aria-label="Cart">' + '🛒' + '</button>';
  }

  function _noticeHTML() {
    if (!S.notice) return '';
    return '<div class="pco-notice ' + (S.notice.kind === 'warn' ? 'pco-notice-warn' : 'pco-notice-info') + '" role="status" aria-live="polite">' + _esc(S.notice.text) + '</div>';
  }

  function _summaryHTML() {
    var p = _price(), m = _mrp();
    var payLabel = S.payBusy ? 'Processing…' : 'Pay ₹' + _fmt(p) + ' Securely';
    var inCart = window.Cart && Cart.has(S.pdfId);
    var cartBtn = inCart
      ? '<button type="button" class="pco-btn pco-btn-secondary" onclick="navigate(\'cart\')">✓ Added to Cart · View Cart</button>'
      : '<button type="button" class="pco-btn pco-btn-secondary" id="pcoAddCartBtn" onclick="PCO._addCart()">🛒 Add to Cart</button>';
    return '<aside class="pco-summary">' +
      '<div class="pco-summary-head">Order Summary</div>' +
      _prodRowHTML() +
      _noticeHTML() +
      '<div class="pco-pricebox">' +
        '<div class="pco-price-final"><span class="pco-pay">₹' + _fmt(p) + '</span>' +
        (m > p ? '<span class="pco-mrp">₹' + _fmt(m) + '</span><span class="pco-off">' + Math.round(((_mrp() - p) / m) * 100) + '% OFF</span>' : '') +
        '</div>' +
        (m > p ? '<div class="pco-save-line">You save ₹' + _fmt(m - p) + ' (' + Math.round(((m - p) / m) * 100) + '%)</div>' : '') +
        _priceRowsHTML() +
      '</div>' +
      '<div class="pco-actions">' +
        '<button type="button" class="pco-btn pco-btn-primary" id="pcoPayBtn" onclick="PCO._pay()"' + (S.payBusy ? ' disabled' : '') + '>' + payLabel + '</button>' +
        '<div class="pco-cart-row">' + cartBtn + _wishBtnHTML(false) + '</div>' +
      '</div>' +
      '<div class="pco-note"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>Amount re-verified from our database before the payment window opens.</div>' +
      _trustHTML() +
      '</aside>';
  }

  function _guestSummaryHTML() {
    var p = _price(), m = _mrp();
    return '<aside class="pco-summary">' +
      '<div class="pco-summary-head">Order Summary</div>' +
      _prodRowHTML() +
      _noticeHTML() +
      '<div class="pco-pricebox">' +
        '<div class="pco-price-final"><span class="pco-pay">₹' + _fmt(p) + '</span>' +
        (m > p ? '<span class="pco-mrp">₹' + _fmt(m) + '</span><span class="pco-off">' + Math.round(((_mrp() - p) / m) * 100) + '% OFF</span>' : '') +
        '</div>' +
        (m > p ? '<div class="pco-save-line">You save ₹' + _fmt(m - p) + ' (' + Math.round(((m - p) / m) * 100) + '%)</div>' : '') +
        _priceRowsHTML() +
      '</div>' +
      '<div class="pco-actions">' +
        '<button type="button" class="pco-btn pco-btn-primary" onclick="PCO._signIn()">Sign In to Continue</button>' +
        '<button type="button" class="pco-btn pco-btn-ghost" onclick="PCO._back()">Keep Browsing</button>' +
      '</div>' +
      '<div class="pco-note">Your selection is saved — you’ll return right here after signing in.</div>' +
      _trustHTML() +
      '</aside>';
  }

  function _stateCardHTML(kind) {
    var ico = '', title = '', sub = '', ctas = '';
    if (kind === 'owned') {
      ico = '<div class="pco-state-ico pco-state-ico-green">✓</div>';
      title = 'You Own This';
      sub = 'This PDF is already in your Studyria Library — enjoy unlimited access.';
      ctas = '<button type="button" class="pco-btn pco-btn-green" onclick="Cart.openOwned(\'' + _esc(String(S.pdfId)) + '\')">Open PDF</button>' +
             '<button type="button" class="pco-btn pco-btn-secondary" onclick="navigate(\'library\')">Go to My Library</button>';
    } else if (kind === 'premium') {
      ico = '<div class="pco-state-ico pco-state-ico-gold">👑</div>';
      title = 'Included with Premium';
      sub = 'Your Studyria Premium membership covers this material — no payment needed.';
      ctas = '<button type="button" class="pco-btn pco-btn-green" onclick="Cart.openOwned(\'' + _esc(String(S.pdfId)) + '\')">Open with Premium</button>' +
             '<button type="button" class="pco-btn pco-btn-secondary" onclick="navigate(\'premium-library\')">Browse Premium Library</button>';
    } else if (kind === 'free') {
      ico = '<div class="pco-state-ico pco-state-ico-green">🎁</div>';
      title = 'FREE PDF';
      sub = 'This PDF is completely free — no payment needed. Get instant access and find it in your Library anytime.';
      ctas = '<div class="pco-free-price"><span class="pco-pay">₹0</span><span class="pco-free-tag">FREE</span></div>' +
             '<button type="button" class="pco-btn pco-btn-green" onclick="PCO._getFree()">📖 Get Free Access</button>' +
             '<button type="button" class="pco-btn pco-btn-secondary" onclick="navigate(\'library\')">Keep Browsing</button>';
    } else if (kind === 'failed') {
      ico = '<div class="pco-state-ico pco-state-ico-red">✕</div>';
      title = 'Payment could not be completed';
      sub = _esc(S.failMsg || 'No money was deducted. Please check your connection or try a different payment method, then try again.');
      ctas = '<button type="button" class="pco-btn pco-btn-primary" onclick="PCO._retryPay()">Try Again</button>' +
             '<button type="button" class="pco-btn pco-btn-secondary" onclick="PCO._backToCheckout()">Back to Checkout</button>';
    } else if (kind === 'cancelled') {
      ico = '<div class="pco-state-ico pco-state-ico-red">✕</div>';
      title = 'Payment cancelled';
      sub = 'No charge was made. Your selection is saved here — you can safely try again anytime.';
      ctas = '<button type="button" class="pco-btn pco-btn-primary" onclick="PCO._retryPay()">Try Payment Again</button>' +
             '<button type="button" class="pco-btn pco-btn-secondary" onclick="PCO._backToCheckout()">Back to Checkout</button>';
    }
    return '<div class="pco-state-card" role="status" aria-live="polite">' + ico + '<h2 class="pco-state-title">' + title + '</h2><p class="pco-state-sub">' + sub + '</p><div class="pco-state-ctas">' + ctas + '</div></div>';
  }

  /* ── §12 PREMIUM SUCCESS SCREEN ──────────────────────────────────
     Refresh-safe: on reload, load() re-verifies ownership in the DB and
     lands in the 'owned' state — the Library truth is always consistent. */
  function _successHTML() {
    var t = (S.db && S.db.dbTitle) || (S.pdf && S.pdf.title) || 'your PDF';
    var c = (S.db && S.db.dbCover) || (S.pdf && S.pdf.coverImage) || '';
    var isFree = !!S.freeGrant;
    var amt = S.payAmount != null ? S.payAmount : _price();
    var img = c
      ? '<img class="pco-succ-cover" src="' + _esc(c) + '" alt="' + _esc(t) + '" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="pco-succ-cover pco-succ-noimg">📚</div>';
    return '<div class="pco-state-card pco-succ" role="status" aria-live="polite">' +
      '<div class="pco-succ-check" aria-hidden="true"><svg viewBox="0 0 52 52" width="64" height="64"><circle class="pco-succ-c" cx="26" cy="26" r="24" fill="none"/><path class="pco-succ-p" fill="none" d="M14 27l8 8 16-16"/></svg></div>' +
      '<h2 class="pco-state-title">' + (isFree ? 'Free PDF Unlocked!' : 'Payment Successful!') + '</h2>' +
      '<p class="pco-state-sub">Your PDF is now unlocked and added to your Studyria Library.</p>' +
      '<div class="pco-succ-prod">' + img +
        '<div><div class="pco-succ-name">' + _esc(t) + '</div>' +
        '<div class="pco-succ-rows">' +
          '<div class="pco-succ-row"><span>' + (isFree ? 'Price' : 'Payment') + '</span><strong>' + (isFree ? 'FREE' : '₹' + _fmt(amt)) + '</strong></div>' +
          (S.paymentId ? '<div class="pco-succ-row"><span>Payment ID</span><strong>' + _esc(S.paymentId) + '</strong></div>' : '') +
        '</div></div></div>' +
      '<ul class="pco-succ-list">' +
        '<li>✓ ' + (isFree ? 'Free Access Granted' : 'Payment Verified') + '</li><li>✓ Added to Your Library</li><li>✓ Lifetime Access</li>' +
      '</ul>' +
      '<div class="pco-state-ctas">' +
        '<button type="button" class="pco-btn pco-btn-green" onclick="navigate(\'library\')">📚 Open My Library</button>' +
        '<button type="button" class="pco-btn pco-btn-secondary" onclick="Cart.openOwned(\'' + _esc(String(S.pdfId)) + '\')">⬇ Read / Download PDF</button>' +
      '</div></div>';
  }

  function _shellHTML(leftInner, summaryHTML, noBar) {
    var cls = 'pco-root' + (noBar ? ' pco-no-bar' : '');
    return '<div class="' + cls + '">' + _topHTML() +
      '<div class="pco-shell"><div>' + leftInner + '</div>' + (summaryHTML || '') + '</div></div>';
  }

  function _notFoundHTML() {
    return '<div class="pco-root pco-no-bar">' + _topHTML() +
      '<div class="pco-state-card"><div class="pco-state-ico pco-state-ico-red">🔍</div>' +
      '<h2 class="pco-state-title">Product Not Available</h2>' +
      '<p class="pco-state-sub">This item can’t be purchased right now — it may have been removed or is no longer published.</p>' +
      '<div class="pco-state-ctas"><button type="button" class="pco-btn pco-btn-primary" onclick="navigate(\'library\')">Browse Study Materials</button></div></div></div>';
  }

  function _errorHTML() {
    return '<div class="pco-root pco-no-bar">' + _topHTML() +
      '<div class="pco-state-card"><div class="pco-state-ico pco-state-ico-red">⚠️</div>' +
      '<h2 class="pco-state-title">Something Went Wrong</h2>' +
      '<p class="pco-state-sub">We couldn’t load this checkout right now. Please check your connection and try again.</p>' +
      '<div class="pco-state-ctas"><button type="button" class="pco-btn pco-btn-primary" onclick="PCO._reload()">Retry</button></div></div></div>';
  }

  function _skeletonHTML() {
    return '<div class="pco-root">' +
      '<div class="pco-top"><div class="pco-skel" style="height:34px;width:110px;border-radius:10px"></div><div class="pco-skel" style="height:16px;width:150px"></div></div>' +
      '<div class="pco-shell">' +
      '<div><div class="pco-skel pco-skel-title"></div><div class="pco-skel pco-skel-line"></div><div class="pco-skel pco-skel-line" style="width:70%"></div>' +
      '<div class="pco-skel pco-skel-stage" style="margin-top:16px"></div></div>' +
      '<div class="pco-skel pco-skel-card"></div></div></div>';
  }

  /* ── bind (ready state) ─────────────────────────────────────────── */
  function _bindReady() {}
  function _bindGuest() {}

  /* ═══════════════════════════════════════════════════════════════════
     ACTIONS
     ═══════════════════════════════════════════════════════════════════ */
  function _back() {
    if (typeof navigate === 'function') {
      // Direct-to-checkout flow: return to the grid the user came from.
      // The PDP is bypassed for purchases, so Back never dead-ends there.
      var dest = S.fromPage && S.fromPage !== 'pdf-checkout' ? S.fromPage : 'library';
      if (dest === 'detail') dest = 'library';
      navigate(dest);
    }
  }

  function _reload() { S.retryCount++; load(); }

  async function _addCart() {
    if (!window.Cart) return;
    var btn = document.getElementById('pcoAddCartBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try { await Cart.add(S.pdfId); } catch (e) {}
    render();   // re-render reflects ✓ Added state (badge already updated by Cart.add)
  }

  function _cart() {
    if (window.Cart && !Cart.has(S.pdfId)) { Cart.add(S.pdfId).then(function () { render(); }); return; }
    if (typeof navigate === 'function') navigate('cart');
  }

  async function _wish() {
    if (typeof window.toggleWish !== 'function') return;
    try { await window.toggleWish(S.pdfId); } catch (e) {}
    render();
  }

  function _signIn() {
    try { sessionStorage.setItem(RETURN_KEY, String(S.pdfId)); } catch (e) {}
    if (typeof navigate === 'function') navigate('login');
  }

  /* §5 FREE ACCESS — existing grant system, never Razorpay.
     Guest: same auth rule as the legacy download flow (sign in first,
     RETURN_KEY brings them right back to this checkout).
     Signed in: grantFreeOwnership() inserts the purchased_pdfs row
     (type='free', amount=0, status='owned') — the SAME existing system
     the old flow used — then the premium success screen confirms. */
  async function _getFree() {
    if (!S.user) { _signIn(); return; }
    var granted = false;
    if (typeof window.grantFreeOwnership === 'function') {
      try { granted = await window.grantFreeOwnership(String(S.pdfId)); } catch (e) { granted = false; }
    }
    if (!granted && typeof window.downloadPDF === 'function') {
      // Fallback: the existing download flow also grants ownership
      try { window.downloadPDF(String(S.pdfId)); } catch (e) {}
      return;
    }
    if (!granted) { S.notice = { kind: 'warn', text: 'Couldn\u2019t unlock the free PDF — please try again.' }; render(); return; }
    S.freeGrant = true;
    S.paymentId = null;
    S.payAmount = 0;
    S.phase = 'success';
    render();
  }

  /* §11 FAILED / CANCELLED → re-verify fresh from the DB, then re-open pay */
  async function _retryPay() {
    S.notice = null; S.failMsg = null;
    await load();
    if (S.phase === 'ready' && S.user) _pay();
  }
  async function _backToCheckout() {
    S.notice = null; S.failMsg = null;
    await load();
  }

  /* PAY — reuses the single shared Razorpay implementation (Cart.payItems) */
  async function _pay() {
    if (S.payBusy) return;
    if (!window.Cart || typeof Cart.payItems !== 'function') { _toast('Checkout is still loading — try again in a moment.', 'info'); return; }

    var p = _price();
    // §5 ₹0 never opens Razorpay — free-access flow instead
    if (!(p > 0)) { S.phase = 'free'; render(); _getFree(); return; }

    var title = (S.db && S.db.dbTitle) || (S.pdf && S.pdf.title) || 'Study Material';
    S.payBusy = true;
    _payingUI(true);

    var ui = {
      setBusy: function (on) { _payingUI(on); },
      onGranted: function (granted, paymentId, failed) {
        S.payBusy = false;
        S.paymentId = paymentId || null;
        S.payAmount = _price();          // receipt shows the DB-verified amount
        S.phase = 'success';
        if (window._dashCache !== undefined) window._dashCache = null;
        render();
        if (failed && failed.length) {
          _toast('⚠️ Payment received but a save issue occurred — contact support with ID: ' + (paymentId || ''), 'error');
        } else {
          _toast('Payment successful! 🎉', 'success');
        }
      },
      onPremium: function (premList) {
        S.payBusy = false;
        try { (premList || []).forEach(function (v) { Cart.openOwned(v.ci.pdfId); }); } catch (e) {}
        S.phase = 'success';
        S.paymentId = null;
        render();
      },
      onNothingToPay: function (verified) {
        S.payBusy = false;
        S.notice = null;
        load();   // re-verify → will land in owned / notfound state
      },
      onAllOwned: function () {
        S.payBusy = false;
        S.notice = null;
        load();
      },
      onSomeOwned: function () { /* single-product flow — cannot occur */ },
      onAuthRequired: function () {
        S.payBusy = false;
        S.phase = 'guest';
        render();
        _signIn();
      },
      onDismiss: function () {
        S.payBusy = false;
        S.notice = null; S.failMsg = null;
        S.phase = 'cancelled';           // §11 E — dedicated cancel state
        render();
      },
      onError: function (msg) {
        S.payBusy = false;
        S.notice = null;
        S.failMsg = msg || 'Payment could not start. Please try again.';
        S.phase = 'failed';              // §11 D — dedicated fail state
        render();
      }
    };

    try {
      await Cart.payItems([{ pdfId: S.pdfId, price: p, title: title }], ui);
    } catch (e) {
      S.payBusy = false;
      _payingUI(false);
      _toast('Could not open payment window. Please try again.', 'error');
    }
  }

  function _payingUI(on) {
    var btn = document.getElementById('pcoPayBtn');
    var sBtn = document.getElementById('pcoStickyBuy');
    if (btn) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); btn.textContent = on ? 'Securely processing payment…' : 'Pay ₹' + _fmt(_price()) + ' Securely'; }
    if (sBtn) { sBtn.disabled = on; sBtn.setAttribute('aria-busy', on ? 'true' : 'false'); sBtn.textContent = on ? 'Processing…' : '⚡ Buy ₹' + _fmt(_price()); }
  }

  /* ═══════════════════════════════════════════════════════════════════
     AUTH RETURN — come back to checkout after sign-in
     ═══════════════════════════════════════════════════════════════════ */
  function _initAuthListener(tries) {
    var client = _client();
    if (!client) {
      if ((tries || 0) < 40) setTimeout(function () { _initAuthListener((tries || 0) + 1); }, 500);
      return;
    }
    try {
      client.auth.onAuthStateChange(function (ev) {
        if (ev !== 'SIGNED_IN') return;
        var pending = null;
        try { pending = sessionStorage.getItem(RETURN_KEY); } catch (e) {}
        if (pending) {
          try { sessionStorage.removeItem(RETURN_KEY); } catch (e) {}
          setTimeout(function () { open(pending); }, 350);
        } else if (window.currentPage === 'pdf-checkout' && S.phase === 'guest') {
          setTimeout(function () { load(); }, 350);
        }
      });
    } catch (e) { console.warn('[PCO] auth listener failed:', e); }
  }

  /* ── expose ─────────────────────────────────────────────────────── */
  window.PCO = {
    open: open,
    renderFromRoute: renderFromRoute,
    _pay: _pay,
    _wish: _wish,
    _cart: _cart,
    _addCart: _addCart,
    _back: _back,
    _reload: _reload,
    _signIn: _signIn,
    _prev: _prevFn,
    _next: _nextFn,
    _thumb: _thumbFn,
    _retryPv: _retryPvFn,
    _getFree: _getFree,
    _retryPay: _retryPay,
    _backToCheckout: _backToCheckout
  };

  _initAuthListener(0);
})();
