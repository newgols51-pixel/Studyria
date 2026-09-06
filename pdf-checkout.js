/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA — PREMIUM PDF CHECKOUT PAGE
   ═════════════════════════════════════════════════════════════════════
   AUDIT-BASED DESIGN — reuses every proven system, builds none twice:

   • Product + price      : `pdfs` table via Supabase (same query the
                            PDP and Cart use), verified through
                            Cart.verifyList() — the DB is the ONLY
                            price source. No display price is ever sent
                            to Razorpay.
   • Payment              : Cart.payItems() — the exact payCore used by
                            the cart checkout (same live Razorpay key,
                            same duplicate-guarded purchased_pdfs insert,
                            same Pipedream webhook, same GA4 events,
                            same shared idempotency guard). There is NO
                            second payment implementation.
   • Entitlement / Library: identical purchased_pdfs contract + the
                            proven Cart.openOwned() signed-URL open.
   • Cart                 : the one localStorage cart (window.Cart).
                            A successful direct checkout quietly removes
                            the item from the cart (Cart.removeQuiet) so
                            the badge never lies. No checkout-only cart.
   • Preview             : the V3 viewer (pdp-v3.js) reused AS IS as a
                            single instance — the checkout mounts the
                            same gallery markup, the same local zoom /
                            pan engine, the same fullscreen overlay and
                            the same PDF.js + pre-generated preview
                            pipeline. Strict containment comes from the
                            V3 architecture: transforms apply only to
                            #pdpV3ZoomLayer inside an overflow:hidden
                            stage with touch-action:pan-y — the page
                            scroll, browser pinch zoom and checkout
                            layout are never touched.
   • Auth                : the existing Supabase session + existing
                            login page. Guest checkout renders fully,
                            gates payment behind sign-in, and returns
                            the user here after SIGNED_IN.
   • PDP                 : untouched. Only the paid path of
                            pdpHandleBuy() now points here (with a
                            legacy buyPDF() fallback for standalone
                            pages). renderDetail always rebuilds
                            #pdpWrap, so the single-instance preview
                            handoff is safe.

   ROUTE: navigate('pdf-checkout') · deep link #pdf-checkout/<pdfId>
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Constants / state ─────────────────────────────────────────── */
  const SS_ID   = 'studyria:pdfCheckout:id';
  const SS_BACK = 'studyria:pdfCheckout:return';
  const S = {
    pdfId: null, pdf: null, from: 'pdp', busy: false, authHooked: false, navHooked: false
  };

  /* ── Tiny helpers ───────────────────────────────────────────────── */
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[PdfCheckout]', msg);
  }
  function _root() { return document.getElementById('pdfCheckoutRoot'); }
  function _db() { return window.supabaseClient || null; }
  function _user() {
    try { const u = window.currentUser; return (u && u.email) ? u : null; }
    catch (_) { return null; }
  }
  function _ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function _ssSet(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (_) {} }

  function _fromHash() {
    const m = (location.hash || '').match(/^#pdf-checkout\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  /* ══════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════ */

  /* open(pdfId, {from}) — programmatic entry (PDP Buy Now, cart, etc.) */
  function open(pdfId, opts) {
    opts = opts || {};
    S.from = opts.from || 'pdp';
    pdfId = String(pdfId || '').trim();
    S.pdfId = pdfId || null;
    _ssSet(SS_ID, pdfId || null);
    if (typeof navigate === 'function') navigate('pdf-checkout');
    else route();
  }

  /* route() — invoked by the navigate() hook whenever the page shows */
  async function route() {
    const root = _root();
    if (!root) return;

    const id = S.pdfId || _ssGet(SS_ID) || _fromHash();
    if (!id) { _renderEmpty(); return; }
    S.pdfId = id;
    _ssSet(SS_ID, id);

    _renderSkeleton();

    let pdf = await _fetchPdf(id);
    if (!pdf) { _renderNotFound(id); return; }

    // Free products never enter checkout — same rule as Cart.add()
    if (pdf.free || Number(pdf.price ?? 0) === 0) { _renderFree(pdf); return; }

    // Verify live DB price / status / ownership through the SAME
    // trusted verification the cart checkout uses.
    let v = null;
    try {
      const res = await window.Cart.verifyList([{ pdfId: id, priceSnapshot: Number(pdf.price ?? 0) }]);
      v = (res && res.items && res.items[0]) || null;
    } catch (e) { /* network — fall through to retry state */ }

    if (!v) { _renderNetworkError(); return; }
    if (v.state === 'unavailable') { _renderUnavailable(pdf); return; }

    // Premium members bypass payment for Pass content (same rule as buyPDF)
    if (window.SMCI && typeof window.SMCI.isPremium === 'function') {
      try {
        if (await window.SMCI.isPremium()) { S.pdf = pdf; _renderPremium(pdf); return; }
      } catch (_) {}
    }

    if (v.state === 'owned') { _renderOwned(pdf, false); return; }

    S.pdf = pdf;
    _renderReady(pdf, v);
  }

  /* pay() — the only payment path. Re-verifies, then delegates to the
     shared Cart.payItems core. Never duplicates an order: the shared
     _paying guard blocks double submission and the insert is
     duplicate-guarded per product. */
  async function pay() {
    if (S.busy) return;
    const pdf = S.pdf;
    if (!pdf || !window.Cart || typeof window.Cart.payItems !== 'function') return;

    // Auth gate — purchases require the existing account system
    const db = _db();
    let user = _user();
    if (!user && db) {
      try { const { data: { user: u } } = await db.auth.getUser(); user = u; } catch (_) {}
    }
    if (!user) {
      _ssSet(SS_BACK, '1');
      _toast('Please sign in to complete your purchase.', 'info');
      if (typeof navigate === 'function') navigate('login');
      return;
    }

    // Fresh verification right before the payment window opens —
    // the DB is the only price source (same rule as Cart.pay()).
    let v;
    try {
      const res = await window.Cart.verifyList([{ pdfId: pdf.id, priceSnapshot: Number(pdf.price ?? 0) }]);
      v = (res && res.items && res.items[0]) || null;
    } catch (e) { v = null; }
    if (!v) { _toast('Couldn\u2019t verify the price right now. Please try again.', 'error'); return; }
    if (v.state === 'owned') { _renderOwned(pdf, false); return; }
    if (v.state === 'unavailable') { _renderUnavailable(pdf); return; }
    if (v.priceChanged) { S.pdf.price = v.dbPrice; _renderReady(pdf, v); _toast('Price updated to ₹' + v.dbPrice + ' — current price shown.', 'info'); return; }

    const price = v.dbPrice > 0 ? v.dbPrice : Number(pdf.price ?? 0);
    if (!(price > 0)) { _renderFree(pdf); return; }

    S.busy = true; // note: payCore has its own shared _paying guard too

    await window.Cart.payItems(
      [{ pdfId: pdf.id, price: price, title: pdf.title || 'Study Material' }],
      {
        user: user,
        btns: [document.getElementById('pcPayBtn'), document.getElementById('pcStickyPayBtn')].filter(Boolean),
        description: (pdf.title || 'Study Material').slice(0, 60),
        itemNoun: 'order',
        onHandled: function (res) { S.busy = false; _onPaymentHandled(pdf, res); },
        onDismiss: function () { S.busy = false; _onPaymentDismissed(pdf, price); }
      }
    );
    S.busy = false;
  }

  /* ══════════════════════════════════════════════════════════════════
     DATA
     ══════════════════════════════════════════════════════════════════ */
  async function _fetchPdf(id) {
    let pdf = (window.PDFS || []).find(p => String(p.id) === String(id)) || null;
    const db = _db();
    if (db) {
      try {
        const { data, error } = await db.from('pdfs').select('*').eq('id', String(id)).maybeSingle();
        if (!error && data) {
          pdf = data;
          const i = (window.PDFS || []).findIndex(p => String(p.id) === String(id));
          if (i > -1) window.PDFS[i] = data;
        }
      } catch (e) { console.warn('[PdfCheckout] product fetch failed:', e); }
    }
    if (pdf && typeof window.normalizePdf === 'function') {
      try { window.normalizePdf(pdf); } catch (_) {}
    }
    return pdf;
  }

  /* ══════════════════════════════════════════════════════════════════
     PAYMENT OUTCOMES
     ══════════════════════════════════════════════════════════════════ */
  function _onPaymentHandled(pdf, res) {
    if (res.failed && res.failed.length) {
      // Payment received but the library insert failed — never claim
      // success. Support ID shown for recovery (same contract as cart).
      _renderSaveFailed(pdf, res.paymentId);
      return;
    }
    // Keep the cart + badge honest: the product (if it was in the
    // cart) no longer belongs there.
    try { if (window.Cart && window.Cart.removeQuiet) window.Cart.removeQuiet(pdf.id); } catch (_) {}
    _renderSuccess(pdf, res.paymentId);
  }

  function _onPaymentDismissed(pdf, price) {
    // Cart/product/checkout state stays fully intact — only feedback.
    const note = document.getElementById('pcRetryNote');
    if (note) {
      note.style.display = '';
      const rb = note.querySelector('.pc-retry-btn');
      if (rb) rb.onclick = function () { pay(); };
    }
    [document.getElementById('pcPayBtn'), document.getElementById('pcStickyPayBtn')].forEach(function (b) {
      if (b) { b.disabled = false; b.textContent = 'Pay ₹' + price; }
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     PREVIEW — single-instance V3 mount (full reuse, zero viewer code)
     ══════════════════════════════════════════════════════════════════ */
  function _mountPreview(pdf) {
    const mount = document.getElementById('pcV3Mount');
    if (!mount) return;

    // Single-instance rule: the V3 viewer drives one #pdpV3Gallery via
    // fixed IDs. renderDetail() rebuilds #pdpWrap from scratch on every
    // product open, so clearing it here is always safe.
    const pdpWrap = document.getElementById('pdpWrap');
    if (pdpWrap) pdpWrap.innerHTML = '';

    if (typeof window._v3GalleryHTML !== 'function') {
      // Legacy fallback (pdp-v3.js missing): simple contained cover card
      const cover = (pdf.coverImage || pdf.cover_url || '').trim();
      mount.innerHTML = cover
        ? '<div class="pc-cover-fallback"><img src="' + _esc(cover) + '" alt="' + _esc(pdf.title || 'PDF cover') + '" draggable="false"></div>'
        : '<div class="pc-cover-fallback pc-cover-empty">📄</div>';
      return;
    }

    mount.innerHTML = window._v3GalleryHTML(pdf);

    // Wishlist / share actions belong to the PDP context (they act on
    // window.selectedPdf) — checkout preview is view-only.
    var actionRow = mount.querySelector('.pdp-v3-action-row');
    if (actionRow) actionRow.remove();

    var stage = document.getElementById('pdpV3Stage');
    if (stage) {
      if (typeof window._v3InstallStageSwipe === 'function') window._v3InstallStageSwipe(stage);
      if (typeof window._v3InstallStageZoom === 'function') window._v3InstallStageZoom(stage);
    }

    var ci = document.getElementById('pdpV3CoverImg');
    if (ci) {
      ci.addEventListener('error', function () {
        ci.style.display = 'none';
        var fb = document.getElementById('pdpV3CoverFallback');
        if (fb) fb.style.display = 'flex';
      });
      ci.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      ci.addEventListener('dragstart', function (e) { e.preventDefault(); });
    }

    if (typeof window.pdpInitPreview === 'function') window.pdpInitPreview(pdf);
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER — shared pieces
     ══════════════════════════════════════════════════════════════════ */
  function _headerHTML(backLabel, backOnclick) {
    return (
      '<header class="pc-header">' +
        '<div class="pc-header-brand">' +
          '<span class="pc-logo-mark">S</span>' +
          '<div class="pc-brand-text"><span class="pc-brand-name">Studyria</span>' +
          '<span class="pc-brand-sub">Secure Checkout</span></div>' +
        '</div>' +
        '<div class="pc-header-right">' +
          '<span class="pc-secure-pill"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg> 256-bit secure payment</span>' +
          '<button class="pc-back-btn" onclick="' + backOnclick + '">' + _esc(backLabel) + '</button>' +
        '</div>' +
      '</header>'
    );
  }

  function _metaChipsHTML(pdf) {
    const chips = [];
    if (pdf.category) chips.push(['📚', 'Category', pdf.category]);
    chips.push(['📋', 'Format', 'PDF']);
    const pages = Number(pdf.pages || 0);
    if (pages > 0) chips.push(['📄', 'Pages', pages + (pages === 1 ? ' page' : ' pages')]);
    chips.push(['♾️', 'Access', 'Lifetime']);
    if (pdf.author) chips.push(['✍️', 'By', pdf.author]);
    return chips.map(function (c) {
      return '<div class="pc-chip"><span class="pc-chip-ico">' + c[0] + '</span>' +
        '<span class="pc-chip-txt"><b>' + _esc(c[1]) + '</b>' + _esc(c[2]) + '</span></div>';
    }).join('');
  }

  function _summaryRowsHTML(pdf, v) {
    const price = v.dbPrice > 0 ? v.dbPrice : Number(pdf.price ?? 0);
    const orig = Number(v.dbOriginal || pdf.originalPrice || 0);
    const hasDiscount = orig > price && orig > 0;
    const save = hasDiscount ? orig - price : 0;
    let rows = '';

    rows += '<div class="pc-sum-row"><span>Price</span><span>₹' + price + '</span></div>';
    if (hasDiscount) {
      rows += '<div class="pc-sum-row pc-sum-discount"><span>Discount</span><span>−₹' + save + '</span></div>';
    }
    rows += '<div class="pc-sum-total"><span>Total</span><span>₹' + price + '</span></div>';
    if (hasDiscount) {
      rows += '<div class="pc-save-note">🎉 You save ₹' + save + ' on this order</div>';
    }
    if (v.priceChanged) {
      rows += '<div class="pc-price-note">Price updated ₹' + (v.ci && v.ci.priceSnapshot) + ' → ₹' + price + ' — current DB price shown</div>';
    }
    return rows;
  }

  function _trustHTML() {
    return (
      '<div class="pc-trust">' +
        '<div class="pc-trust-item"><span>🔒</span><div><b>Secure Payment</b><span>Processed via Razorpay</span></div></div>' +
        '<div class="pc-trust-item"><span>⚡</span><div><b>Instant Access</b><span>Unlocked the moment payment is verified</span></div></div>' +
        '<div class="pc-trust-item"><span>📚</span><div><b>Digital PDF</b><span>Read on any device, forever</span></div></div>' +
        '<div class="pc-trust-item"><span>✓</span><div><b>Verified Purchase</b><span>Your order is recorded in your account</span></div></div>' +
      '</div>'
    );
  }

  function _openActionsHTML() {
    return (
      '<div class="pc-cta-row">' +
        '<button class="pc-btn pc-btn-primary" onclick="PdfCheckout.openPdf()">⚡ Open PDF</button>' +
        '<button class="pc-btn pc-btn-ghost" onclick="navigate(\'library\')">📚 Go to Library</button>' +
      '</div>'
    );
  }

  function _openPdfNow() {
    const pdf = S.pdf;
    if (pdf && window.Cart && typeof window.Cart.openOwned === 'function') {
      window.Cart.openOwned(pdf.id);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER — states
     ══════════════════════════════════════════════════════════════════ */
  function _renderSkeleton() {
    const root = _root(); if (!root) return;
    root.innerHTML =
      _headerHTML('← Back', 'history.back()') +
      '<div class="pc-shell"><div class="pc-skeleton-grid">' +
        '<div class="pc-sk-card pc-sk-tall"></div><div class="pc-sk-card"></div>' +
      '</div></div>';
  }

  function _renderReady(pdf, v) {
    const root = _root(); if (!root) return;
    const price = v.dbPrice > 0 ? v.dbPrice : Number(pdf.price ?? 0);
    const orig = Number(v.dbOriginal || pdf.originalPrice || 0);
    const discount = (orig > price && orig > 0) ? Math.round((1 - price / orig) * 100) : 0;
    const cover = (pdf.coverImage || pdf.cover_url || '').trim();
    const guest = !_user();
    const inCart = !!(window.Cart && window.Cart.has(pdf.id));
    const payLabel = guest ? 'Sign in to Pay ₹' + price : 'Pay ₹' + price;

    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML(S.from === 'cart' ? '← Back to Cart' : '← Back to Product',
                  S.from === 'cart' ? "navigate('cart')" : 'PdfCheckout.backToProduct()') +
      '<div class="pc-grid">' +

        '<div class="pc-main">' +
          '<section class="pc-card pc-product">' +
            '<div class="pc-product-row">' +
              (cover
                ? '<img class="pc-product-cover" src="' + _esc(cover) + '" alt="' + _esc(pdf.title) + '" loading="lazy" onerror="this.style.display=\'none\'">'
                : '<div class="pc-product-cover pc-cover-empty">📄</div>') +
              '<div class="pc-product-info">' +
                '<h1 class="pc-title">' + _esc(pdf.title) + '</h1>' +
                '<div class="pc-product-meta">' +
                  (pdf.category ? '<span class="pc-cat">' + _esc(pdf.category) + '</span>' : '') +
                  (discount > 0 ? '<span class="pc-off-badge">' + discount + '% OFF</span>' : '') +
                  (inCart ? '<span class="pc-incart-badge">🛒 In your cart</span>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="pc-chips">' + _metaChipsHTML(pdf) + '</div>' +
          '</section>' +

          '<section class="pc-card pc-preview-card">' +
            '<div class="pc-card-head"><h2>Preview before you buy</h2><span class="pc-card-sub">Cover + first pages · watermark-protected</span></div>' +
            '<div id="pcV3Mount" class="pc-v3-mount"></div>' +
          '</section>' +

          '<section class="pc-card pc-info-card">' +
            '<div class="pc-card-head"><h2>What you\u2019ll get</h2></div>' +
            '<ul class="pc-get-list">' +
              '<li><span>📄</span><div><b>Complete digital PDF</b><span>' + (Number(pdf.pages || 0) > 0 ? Number(pdf.pages) + ' pages of curated content' : 'The full study material') + '</span></div></li>' +
              '<li><span>⚡</span><div><b>Instant access</b><span>Unlocked in your Library immediately after payment</span></div></li>' +
              '<li><span>♾️</span><div><b>Lifetime access</b><span>Download and read on any device, forever</span></div></li>' +
              '<li><span>🛡️</span><div><b>Verified order</b><span>Recorded against your account with a payment ID</span></div></li>' +
            '</ul>' +
          '</section>' +
        '</div>' +

        '<aside class="pc-side">' +
          '<section class="pc-card pc-summary">' +
            '<div class="pc-card-head"><h2>Order Summary</h2></div>' +
            '<div class="pc-sum-product">' +
              (cover
                ? '<img src="' + _esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
                : '<div class="pc-sum-noimg">📄</div>') +
              '<div><div class="pc-sum-title">' + _esc(pdf.title) + '</div>' +
              '<div class="pc-sum-cat">' + _esc(pdf.category || 'Study Material') + ' · Digital PDF</div></div>' +
            '</div>' +
            _summaryRowsHTML(pdf, v) +
            '<div class="pc-pay-note" id="pcRetryNote" style="display:none">' +
              '<div class="pc-pay-note-title">Payment could not be completed.</div>' +
              '<div class="pc-pay-note-sub">Your order and price are preserved — nothing was charged on our side.</div>' +
              '<button class="pc-retry-btn">Retry Payment</button>' +
            '</div>' +
            '<button class="pc-btn pc-btn-primary pc-pay-btn" id="pcPayBtn" onclick="PdfCheckout.pay()">' + _esc(payLabel) + '</button>' +
            (guest
              ? '<div class="pc-sub-note">You\u2019ll sign in with your existing Studyria account — your checkout stays preserved.</div>'
              : '<div class="pc-sub-note">🔒 Final amount re-verified from the database before the payment window opens.</div>') +
          '</section>' +
          _trustHTML() +
        '</aside>' +

      '</div>' +
      '<div class="pc-sticky-bar" id="pcStickyBar">' +
        '<div class="pc-sticky-inner">' +
          '<div class="pc-sticky-price"><span class="pc-sticky-total">' + _esc(pdf.title.length > 34 ? pdf.title.slice(0, 34) + '…' : pdf.title) + '</span>' +
          '<b>₹' + price + '</b></div>' +
          '<button class="pc-btn pc-btn-primary" id="pcStickyPayBtn" onclick="PdfCheckout.pay()">' + _esc(payLabel) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    _mountPreview(pdf);
  }

  function _renderOwned(pdf, isPremium) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico pc-state-ok">✓</div>' +
        '<h1 class="pc-state-title">You Own This</h1>' +
        '<p class="pc-state-sub"><b>' + _esc(pdf.title) + '</b> is already in your library' +
          (isPremium ? ' — included with your Premium membership.' : ' — no payment needed.') + '</p>' +
        _openActionsHTML() +
        '<button class="pc-btn pc-btn-ghost pc-state-alt" onclick="PdfCheckout.backToProduct()">View Product Page</button>' +
      '</div>' +
    '</div>';
  }

  function _renderPremium(pdf) { _renderOwned(pdf, true); }

  function _renderFree(pdf) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Product', 'PdfCheckout.backToProduct()') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico">🎁</div>' +
        '<h1 class="pc-state-title">This PDF is Free</h1>' +
        '<p class="pc-state-sub"><b>' + _esc(pdf.title) + '</b> is a free study material — no checkout required.</p>' +
        '<div class="pc-cta-row">' +
          '<button class="pc-btn pc-btn-primary" onclick="downloadPDF(\'' + _esc(String(pdf.id)).replace(/'/g, '') + '\')">⚡ Download Free</button>' +
          '<button class="pc-btn pc-btn-ghost" onclick="PdfCheckout.backToProduct()">View Product Page</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _renderSuccess(pdf, paymentId) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card pc-state-success">' +
        '<div class="pc-state-ico pc-state-ok">✓</div>' +
        '<h1 class="pc-state-title">Payment Successful</h1>' +
        '<p class="pc-state-sub"><b>' + _esc(pdf.title) + '</b> is now available in your Library.</p>' +
        (paymentId ? '<div class="pc-payment-id">Payment ID<span>' + _esc(paymentId) + '</span></div>' : '') +
        _openActionsHTML() +
      '</div>' +
    '</div>';
  }

  function _renderSaveFailed(pdf, paymentId) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico pc-state-warn">⚠️</div>' +
        '<h1 class="pc-state-title">Payment received — save failed</h1>' +
        '<p class="pc-state-sub">Your payment went through, but we couldn\u2019t write the purchase to your library. ' +
          'Please contact support with this payment ID and we\u2019ll unlock it immediately.</p>' +
        (paymentId ? '<div class="pc-payment-id">Payment ID<span>' + _esc(paymentId) + '</span></div>' : '') +
        '<div class="pc-cta-row"><button class="pc-btn pc-btn-primary" onclick="navigate(\'contact\')">Contact Support</button>' +
        '<button class="pc-btn pc-btn-ghost" onclick="navigate(\'library\')">Go to Library</button></div>' +
      '</div>' +
    '</div>';
  }

  function _renderUnavailable(pdf) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico pc-state-warn">⚠️</div>' +
        '<h1 class="pc-state-title">Product unavailable</h1>' +
        '<p class="pc-state-sub"><b>' + _esc((pdf && pdf.title) || 'This item') + '</b> is not available for purchase right now. Please check back later.</p>' +
        '<div class="pc-cta-row"><button class="pc-btn pc-btn-primary" onclick="navigate(\'library\')">Browse Study Materials</button></div>' +
      '</div>' +
    '</div>';
  }

  function _renderNotFound(id) {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico pc-state-warn">🔍</div>' +
        '<h1 class="pc-state-title">Product not found</h1>' +
        '<p class="pc-state-sub">We couldn\u2019t find the product you\u2019re trying to buy. It may have been removed.</p>' +
        '<div class="pc-cta-row"><button class="pc-btn pc-btn-primary" onclick="navigate(\'library\')">Browse Study Materials</button>' +
        '<button class="pc-btn pc-btn-ghost" onclick="history.back()">Go Back</button></div>' +
      '</div>' +
    '</div>';
  }

  function _renderNetworkError() {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back', 'history.back()') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico pc-state-warn">📡</div>' +
        '<h1 class="pc-state-title">Connection problem</h1>' +
        '<p class="pc-state-sub">We couldn\u2019t verify the price from the database right now. Nothing was charged.</p>' +
        '<div class="pc-cta-row"><button class="pc-btn pc-btn-primary" onclick="PdfCheckout.route()">Try Again</button>' +
        '<button class="pc-btn pc-btn-ghost" onclick="navigate(\'library\')">Browse Study Materials</button></div>' +
      '</div>' +
    '</div>';
  }

  function _renderEmpty() {
    const root = _root(); if (!root) return;
    root.innerHTML =
    '<div class="pc-shell">' +
      _headerHTML('← Back to Studyria', 'navigate(\'library\')') +
      '<div class="pc-state-card">' +
        '<div class="pc-state-ico">🛒</div>' +
        '<h1 class="pc-state-title">Nothing to check out</h1>' +
        '<p class="pc-state-sub">Open any premium PDF and press <b>Buy Now</b> to use this secure checkout.</p>' +
        '<div class="pc-cta-row"><button class="pc-btn pc-btn-primary" onclick="navigate(\'library\')">Browse Study Materials</button></div>' +
      '</div>' +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     NAV — back helpers, teardown, route hooking
     ══════════════════════════════════════════════════════════════════ */
  function backToProduct() {
    const pdf = S.pdf;
    if (pdf && typeof window.openDetail === 'function') { window.openDetail(pdf.id); return; }
    if (typeof history.back === 'function') history.back();
  }

  function _teardown() {
    // Close any open V3 fullscreen overlay (body scroll-lock release)
    if (typeof window._v3CloseFs === 'function') { try { window._v3CloseFs(); } catch (_) {} }
    const root = _root();
    if (root) root.innerHTML = '';   // removes the checkout gallery →
    // renderDetail() rebuilds #pdpWrap fresh on the next product open,
    // restoring the PDP as the single V3 instance.
  }

  /* Wrap navigate():
     • normalize deep links ('pdf-checkout/<id>' → 'pdf-checkout' + id)
       so popstate/back-button/hash entries can never hit the 404 guard
     • teardown when leaving the checkout page (keeps the DOM single-
       instance for the V3 viewer) */
  function _hookNavigate() {
    if (S.navHooked) return;
    const orig = window.navigate;
    if (typeof orig !== 'function') { setTimeout(_hookNavigate, 300); return; }
    if (orig.__pcWrapped) { S.navHooked = true; return; }   // already wrapped (double load) — stop
    S.navHooked = true;
    const wrapped = function (page) {
      let target = page;
      if (typeof page === 'string') {
        const m = page.match(/^pdf-checkout(?:\/([^/?#]+))?/);
        if (m) {
          if (m[1]) { S.pdfId = m[1]; _ssSet(SS_ID, m[1]); }
          target = 'pdf-checkout';
        }
      }
      if (window.currentPage === 'pdf-checkout' && target !== 'pdf-checkout') _teardown();
      return orig.call(this, target);
    };
    wrapped.__pcWrapped = true;
    window.navigate = wrapped;
  }

  /* Auth listener — return the user to checkout after sign-in */
  function _hookAuth(tries) {
    if (S.authHooked) return;
    const db = _db();
    if (!db) {
      if ((tries || 0) < 60) setTimeout(function () { _hookAuth((tries || 0) + 1); }, 500);
      return;
    }
    S.authHooked = true;
    try {
      db.auth.onAuthStateChange(function (ev) {
        if (ev === 'SIGNED_IN' && _ssGet(SS_BACK) === '1') {
          _ssSet(SS_BACK, null);
          setTimeout(function () { route(); }, 150);   // re-render signed-in
        }
      });
    } catch (e) { console.warn('[PdfCheckout] auth hook failed:', e); }
  }

  /* ══════════════════════════════════════════════════════════════════
     EXPORT + INIT
     ══════════════════════════════════════════════════════════════════ */
  window.PdfCheckout = {
    open: open,
    route: route,
    pay: pay,
    backToProduct: backToProduct,
    openPdf: _openPdfNow,
    get state() { return { pdfId: S.pdfId, busy: S.busy }; }
  };

  function _init() {
    _hookNavigate();
    _hookAuth();
    // Deep link on cold load — wait for navigate() to exist
    let tries = 0;
    (function waitNav() {
      if (typeof window.navigate === 'function') {
        if (_fromHash() && window.currentPage !== 'pdf-checkout') {
          S.pdfId = _fromHash();
          _ssSet(SS_ID, S.pdfId);
          window.navigate('pdf-checkout');
        }
      } else if (tries++ < 40) setTimeout(waitNav, 150);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();
