/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — CART 2.0 (Real Shopping Cart)
   ─────────────────────────────────────────────────────────────────────
   AUDIT-BASED DESIGN (nothing rebuilt that already works):
   • Products: existing `pdfs` table → window.PDFS (loaded by the SPA).
     No new product system. Cart items store ONLY the pdf id + a
     display snapshot; current data + prices are ALWAYS re-fetched
     from the database.
   • Ownership: existing `purchased_pdfs` table (user_id + pdf_uuid +
     status='paid') — the same table buyPDF() uses. No second
     access-control database.
   • Payment: the SAME Razorpay Standard Checkout flow buyPDF() uses
     (live key, theme #930205, same Pipedream webhook, same
     purchased_pdfs insert contract). Cart checkout simply batches the
     already-proven single-item flow into one verified payment.
   • Auth: existing Supabase client (window.supabaseClient). Purchases
     still require login — unchanged.
   • Wishlist / Study Collection: completely untouched, separate
     storage keys, separate table. The header basket button now goes
     to the Cart (was: wishlist — the routing bug).
   • Persistence: localStorage, mirroring the production guest-wishlist
     pattern — `studyria_cart_guest` for guests, `studyria_cart_u_<uid>`
     per signed-in user, merged (deduped) on login.
   • Arena/BrainLab: not imported, not referenced, not affected.

   PRICE SAFETY (spec §13/§14):
   The payable amount is computed ONLY from a fresh database query run
   at checkout time (`pdfs.price`). Stored cart prices are display
   snapshots and are never sent to Razorpay. Price changes surface as
   "Price updated ₹old → ₹new" before payment.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────── */
  const GUEST_KEY   = 'studyria_cart_guest';
  const RZP_KEY     = 'rzp_live_SxcnO1cOS2HAJT';              // same live key as buyPDF()
  const PIPEDREAM   = 'https://eod16l3iacfjwl6.m.pipedream.net'; // same webhook as buyPDF()
  const BADGE_IDS   = ['basketCount', 'dhMenuBasketCount'];

  /* ── Tiny helpers ───────────────────────────────────────────────── */
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[Cart]', msg);
  }
  function _ga4(ev, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', ev, params || {}); } catch (_) {}
  }
  function _client() { return window.supabaseClient || null; }
  function _uid() {
    try { return (window.currentUser && (window.currentUser.uid || window.currentUser.id)) || null; }
    catch (_) { return null; }
  }
  function _cartKey() { const u = _uid(); return u ? 'studyria_cart_u_' + u : GUEST_KEY; }

  /* ══════════════════════════════════════════════════════════════════
     PERSISTENCE — localStorage (guest + per-user), merge on login
     ══════════════════════════════════════════════════════════════════ */
  function _read(key) {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(arr) ? arr.filter(i => i && i.pdfId) : [];
    } catch (_) { return []; }
  }
  function _write(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items || [])); } catch (e) {
      console.warn('[Cart] localStorage write failed:', e);
    }
  }
  function _dedupe(items) {
    const seen = new Set(); const out = [];
    (items || []).forEach(i => {
      const id = String(i.pdfId);
      if (!seen.has(id)) { seen.add(id); out.push(i); }
    });
    return out;
  }

  function items() { return _dedupe(_read(_cartKey())); }
  function save(items) {
    const d = _dedupe(items || []);
    _write(_cartKey(), d);
    Cart.updateBadge();
    _broadcast(d);
    return d;
  }
  function has(pdfId) { return items().some(i => String(i.pdfId) === String(pdfId)); }
  function count() { return items().length; }   // unique items — consistent everywhere

  /* Guest → user merge (deduped, guest cleared). Safe if nothing to do. */
  function mergeGuestCart() {
    try {
      const uid = _uid(); if (!uid) return;
      const guest = _read(GUEST_KEY); if (!guest.length) return;
      const userKey = 'studyria_cart_u_' + uid;
      const merged = _dedupe(_read(userKey).concat(guest));
      _write(userKey, merged);
      localStorage.removeItem(GUEST_KEY);
      Cart.updateBadge();
      console.log('[Cart] merged', guest.length, 'guest item(s) into user cart');
    } catch (e) { console.warn('[Cart] merge failed:', e); }
  }

  /* Broadcast so pages/buttons can react without polling (§30) */
  function _broadcast(items) {
    try {
      window.dispatchEvent(new CustomEvent('studyria:cartChanged', { detail: { count: (items || []).length } }));
    } catch (_) {}
    try { if (typeof window.pdpRefreshCartState === 'function') window.pdpRefreshCartState(); } catch (_) {}
  }

  /* Cross-tab sync */
  try {
    window.addEventListener('storage', function (e) {
      if (e.key === _cartKey() || e.key === GUEST_KEY) Cart.updateBadge();
    });
  } catch (_) {}

  /* ══════════════════════════════════════════════════════════════════
     DB VERIFICATION — the authoritative product/price check (§13–§15)
     ══════════════════════════════════════════════════════════════════ */
  async function _db() {
    // Wait briefly for the Supabase client if it is still initializing.
    for (let i = 0; i < 40; i++) {
      if (_client()) return _client();
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  }

  async function verifyCart() { return verifyList(items()); }

  /* ── verifyList — generalized verification (cart OR direct checkout)
     list: [{pdfId, priceSnapshot}]. DB is always the only price source.
     Shared by the Cart checkout page and the PDF checkout page. */
  async function verifyList(list) {
    const cart = (list || []).filter(i => i && i.pdfId);
    if (!cart.length) return { items: [], ok: true };

    const db = await _db();
    if (!db) throw new Error('network');

    const ids = cart.map(i => i.pdfId);
    let rows = [];
    try {
      const { data, error } = await db.from('pdfs')
        .select('id,title,category,price,original_price,status,cover_url,pdf_url')
        .in('id', ids);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      console.warn('[Cart] product verify query failed:', e);
      throw new Error('network');
    }
    const byId = {};
    rows.forEach(r => { byId[String(r.id)] = r; });

    // Ownership check (§17) — only meaningful when signed in
    let owned = new Set();
    const uid = _uid();
    if (uid && db) {
      try {
        const { data: ownedRows } = await db.from('purchased_pdfs')
          .select('pdf_uuid').eq('user_id', uid).eq('status', 'paid').in('pdf_uuid', ids);
        (ownedRows || []).forEach(r => owned.add(String(r.pdf_uuid)));
      } catch (e) { console.warn('[Cart] ownership check failed:', e); }
    }

    return {
      ok: true,
      items: cart.map(ci => {
        const row = byId[String(ci.pdfId)];
        if (!row) return { ci, state: 'unavailable' };
        const dbPrice = Number(row.price ?? row.selling_price ?? 0);
        const changed = Number(ci.priceSnapshot) !== dbPrice && dbPrice > 0;
        return {
          ci,
          state: (row.status === 'published' || row.status === 'approved' || !row.status)
            ? (owned.has(String(ci.pdfId)) ? 'owned' : 'ok')
            : 'unavailable',
          dbPrice,
          dbOriginal: Number(row.original_price || 0),
          dbTitle: row.title,
          dbCategory: row.category,
          dbCover: row.cover_url,
          priceChanged: changed
        };
      })
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     MUTATIONS
     ══════════════════════════════════════════════════════════════════ */
  async function add(pdfId) {
    pdfId = String(pdfId);
    if (has(pdfId)) {                       // §4 no duplicate line items
      _toast('Already in your cart 🛒', 'info');
      return false;
    }
    const db = await _db();
    if (!db) { _toast('Network issue — please try again.', 'error'); return false; }

    // Resolve the real product (local cache first, DB fallback)
    let pdf = (window.PDFS || []).find(p => String(p.id) === pdfId) || null;
    if (!pdf) {
      try {
        const { data } = await db.from('pdfs').select('*').eq('id', pdfId).single();
        if (data) { pdf = data; if (window.PDFS) window.PDFS.push(data); }
      } catch (_) {}
    }
    if (!pdf) { _toast('Item not found.', 'error'); return false; }
    if (typeof window.normalizePdf === 'function') { try { window.normalizePdf(pdf); } catch (_) {} }

    const price = Number(pdf.price ?? 0);
    if (price === 0) {                      // §5 free content never enters checkout
      if (typeof window.downloadPDF === 'function') window.downloadPDF(pdfId);
      else _toast('This item is free — open it from the library.', 'info');
      return false;
    }

    // §17 duplicate-purchase protection at add time
    const uid = _uid();
    if (uid) {
      try {
        const { data: owned } = await db.from('purchased_pdfs')
          .select('id').eq('user_id', uid).eq('pdf_uuid', pdfId).eq('status', 'paid');
        if (owned && owned.length) {
          _toast('✓ Already Purchased — opening your PDF…', 'success');
          openOwned(pdfId);
          return false;
        }
      } catch (e) { /* proceed — checkout re-checks */ }
    }

    const snap = {
      id: 'pdf:' + pdfId, type: 'pdf', pdfId: pdfId,
      title: pdf.title || 'Study Material',
      category: pdf.category || '',
      cover: pdf.coverImage || pdf.cover_url || '',
      priceSnapshot: price,                 // display ONLY — checkout re-verifies from DB
      originalPriceSnapshot: Number(pdf.originalPrice || 0),
      addedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    save(items().concat([snap]));
    _ga4('add_to_cart', { currency: 'INR', value: price, items: [{ item_id: pdfId, item_name: snap.title, price: price }] });
    _toast('🛒 Added to cart — ' + snap.title, 'success');
    return true;
  }

  function remove(pdfId) {
    pdfId = String(pdfId);
    const it = items().find(i => String(i.pdfId) === pdfId);
    save(items().filter(i => String(i.pdfId) !== pdfId));
    if (it) _ga4('remove_from_cart', { currency: 'INR', value: it.priceSnapshot, items: [{ item_id: pdfId }] });
    renderCart();           // re-render if cart page is open (§26 no reload needed)
    _toast('Removed from cart', 'info');
  }

  function clearAll() { save([]); renderCart(); }

  /* Open an owned PDF via signed URL — mirrors the proven buyPDF owned path */
  async function openOwned(pdfId) {
    const db = await _db(); if (!db) return;
    try {
      const { data: row } = await db.from('pdfs').select('pdf_url').eq('id', pdfId).single();
      let url = row && row.pdf_url;
      if (!url || url === '#') { _toast('PDF link not available. Contact support.', 'error'); return; }
      let path = url;
      const m = url.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
      if (m) path = decodeURIComponent(m[1]);
      const { data: sd, error } = await db.storage.from('pdfs').createSignedUrl(path, 3600);
      if (error || !sd) { _toast('PDF link not available. Contact support.', 'error'); return; }
      window.open(sd.signedUrl, '_blank');
      if (typeof window.trackReadingSession === 'function') window.trackReadingSession(pdfId);
    } catch (e) { console.warn('[Cart] openOwned failed:', e); }
  }

  /* ══════════════════════════════════════════════════════════════════
     HEADER BADGE (§9) — unique item count, updated after EVERY change
     ══════════════════════════════════════════════════════════════════ */
  function updateBadge() {
    const n = count();
    BADGE_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = n;
    });
  }
  window.updateBasketCount = updateBadge;   // legacy name → real cart count

  /* ══════════════════════════════════════════════════════════════════
     CART PAGE (§2, §11–§16, §26, §31, §33, §34)
     ══════════════════════════════════════════════════════════════════ */
  const CART_ICO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>';

  function _el() { return document.getElementById('cartRoot'); }

  function renderCart() {
    const root = _el(); if (!root) return;
    const cart = items();
    if (!cart.length) { root.innerHTML = _emptyHTML(); return; }
    root.innerHTML = _skeletonHTML(cart.length);
    verifyCart()
      .then(res => { root.innerHTML = _listHTML(res); _bindPage(); })
      .catch(() => {
        root.innerHTML =
          '<div class="cart-error-box">⚠ Couldn\u2019t load your cart. Please check your connection.<br><br>' +
          '<button class="cart-btn cart-btn-primary" onclick="Cart.retryRender()">Try Again</button></div>';
      });
  }
  function retryRender() { renderCart(); }

  function _skeletonHTML(n) {
    let rows = '';
    for (let i = 0; i < Math.min(n, 4); i++) rows +=
      '<div class="cart-skel"><div class="cart-skel-img"></div><div style="flex:1"><div class="cart-skel-line" style="width:70%"></div><div class="cart-skel-line" style="width:40%"></div><div class="cart-skel-line" style="width:25%"></div></div></div>';
    return '<div class="cart-wrap"><div class="cart-title-row"><h1 class="cart-h1">🛒 Your Cart</h1><span class="cart-sub">Loading your items…</span></div>' + rows + '</div>';
  }

  function _emptyHTML() {
    return `
    <div class="cart-wrap">
      <div class="cart-empty">
        <div class="cart-empty-ico">${CART_ICO}</div>
        <h2 class="cart-empty-title">Your study cart is empty.</h2>
        <p class="cart-empty-sub">Save your favourite paid study resources here and continue when you\u2019re ready.</p>
        <div class="cart-empty-ctas">
          <button class="cart-btn cart-btn-primary" onclick="navigate('library')">Browse Study Materials</button>
          <button class="cart-btn cart-btn-ghost" onclick="navigate('free-materials')">Browse Free Materials</button>
        </div>
      </div>
    </div>`;
  }

  function _itemHTML(v) {
    const ci = v.ci;
    const cover = ci.cover || v.dbCover || '';
    const title = _esc(v.dbTitle || ci.title);
    const cat   = _esc(v.dbCategory || ci.category || 'Study Material');
    const isUnavail = v.state === 'unavailable';
    const isOwned   = v.state === 'owned';
    const price     = v.dbPrice > 0 ? v.dbPrice : ci.priceSnapshot;
    const orig      = v.dbOriginal > price ? v.dbOriginal : (ci.originalPriceSnapshot > price ? ci.originalPriceSnapshot : 0);

    const priceBox = isUnavail
      ? '<span class="cart-price-old">Unavailable</span>'
      : (isOwned
          ? '<span class="cart-price-owned">✓ Purchased</span>'
          : `<span class="cart-price-now">₹${price}</span>` +
            (orig > 0 ? `<span class="cart-price-was">₹${orig}</span>` : '') +
            (v.priceChanged
              ? `<div class="cart-price-upd">Price updated ₹${ci.priceSnapshot} → ₹${price}</div>`
              : ''));

    return `
    <div class="cart-item${isUnavail ? ' cart-item-dead' : ''}${isOwned ? ' cart-item-owned' : ''}">
      <div class="cart-item-img" onclick="openDetail('${_esc(ci.pdfId)}')" style="cursor:pointer">
        ${cover
          ? `<img src="${_esc(cover)}" alt="${title}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cart-item-noimg',innerHTML:'📚'}))">`
          : '<div class="cart-item-noimg">📚</div>'}
      </div>
      <div class="cart-item-body">
        <div class="cart-item-title" onclick="openDetail('${_esc(ci.pdfId)}')" title="View item">${title}</div>
        <div class="cart-item-cat">${cat}</div>
        ${isUnavail ? '<div class="cart-item-warn">⚠ Item unavailable</div>' : ''}
        ${isOwned ? '<div class="cart-item-owned-note">You already own this — no need to buy again.</div>' : ''}
        <div class="cart-item-actions">
          <span class="cart-qty" title="Digital products are limited to one copy per account">Qty ×1</span>
          ${isOwned
            ? `<button class="cart-item-link" onclick="Cart.openOwned('${_esc(ci.pdfId)}')">Open Content</button>`
            : `<button class="cart-item-link" onclick="openDetail('${_esc(ci.pdfId)}')">View</button>`}
          <button class="cart-item-remove" onclick="Cart.remove('${_esc(ci.pdfId)}')">Remove</button>
        </div>
      </div>
      <div class="cart-item-price">${priceBox}</div>
    </div>`;
  }

  function _listHTML(verified) {
    const rows = verified.items.map(_itemHTML).join('');
    const live = verified.items.filter(v => v.state === 'ok');
    const subtotal = live.reduce((s, v) => s + (v.dbPrice > 0 ? v.dbPrice : v.ci.priceSnapshot), 0);
    const mrp = live.reduce((s, v) => s + ((v.dbOriginal > (v.dbPrice || v.ci.priceSnapshot)) ? v.dbOriginal : ((v.ci.originalPriceSnapshot > (v.dbPrice || v.ci.priceSnapshot)) ? v.ci.originalPriceSnapshot : 0)), 0);
    const savings = mrp > subtotal ? mrp - subtotal : 0;
    const unavailable = verified.items.some(v => v.state === 'unavailable');
    const ownedCount = verified.items.filter(v => v.state === 'owned').length;

    return `
    <div class="cart-wrap">
      <div class="cart-main">
        <div class="cart-title-row">
          <h1 class="cart-h1">🛒 Your Cart</h1>
          <span class="cart-sub">${verified.items.length} item${verified.items.length !== 1 ? 's' : ''}${live.length ? ' · ' + live.length + ' ready to checkout' : ''}</span>
          <button class="cart-clear-btn" id="cartClearBtn">Clear Cart</button>
        </div>
        ${unavailable ? '<div class="cart-banner cart-banner-warn">⚠ Some items are unavailable and won\u2019t be charged. Remove them to keep your cart tidy.</div>' : ''}
        ${ownedCount ? `<div class="cart-banner cart-banner-ok">✓ ${ownedCount} item${ownedCount !== 1 ? 's' : ''} already purchased — shown for reference, never charged twice.</div>` : ''}
        <div class="cart-list">${rows}</div>
      </div>

      <aside class="cart-summary">
        <div class="cart-summary-card">
          <div class="cart-sum-title">Order Summary</div>
          <div class="cart-sum-row"><span>Subtotal</span><span>₹${subtotal}</span></div>
          ${savings > 0 ? `<div class="cart-sum-row cart-sum-save"><span>You save (MRP)</span><span>−₹${savings}</span></div>` : ''}
          <div class="cart-sum-total"><span>Total</span><span>₹${subtotal}</span></div>
          <button class="cart-btn cart-btn-primary cart-checkout-btn" ${live.length ? '' : 'disabled'}>
            Proceed to Checkout →
          </button>
          <div class="cart-sum-note">🔒 Prices are re-verified from our database at checkout before you pay.</div>
        </div>
      </aside>
    </div>`;
  }

  function _bindPage() {
    // Clear Cart — lightweight confirm (§27), never clears on single normal click
    const btn = document.getElementById('cartClearBtn');
    if (btn) {
      btn.disabled = !items().length;
      if (!items().length) return;
      btn.addEventListener('click', function () {
        if (btn.dataset.confirm === '1') { clearAll(); return; }
        btn.dataset.confirm = '1';
        btn.textContent = 'Confirm clear?';
        btn.classList.add('cart-clear-confirm');
        setTimeout(() => {
          if (!btn.isConnected) return;
          btn.dataset.confirm = ''; btn.textContent = 'Clear Cart';
          btn.classList.remove('cart-clear-confirm');
        }, 3500);
      });
    }
    // Checkout CTA
    const cta = document.querySelector('.cart-checkout-btn');
    if (cta && !cta.disabled) {
      cta.addEventListener('click', function (e) {
        e.preventDefault();
        goCheckout();
      });
    } else if (cta) {
      cta.addEventListener('click', function (e) { e.preventDefault(); });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     CHECKOUT PAGE (§18–§22) — verified prices, same Razorpay flow
     ══════════════════════════════════════════════════════════════════ */
  function goCheckout() {
    // Login gate — existing rule: purchases require an account
    if (!_uid()) {
      _toast('Please login to checkout.', 'info');
      if (typeof navigate === 'function') navigate('login');
      return;
    }
    if (typeof navigate === 'function') navigate('checkout');
  }

  function renderCheckout() {
    const root = document.getElementById('checkoutRoot'); if (!root) return;
    const cart = items();
    if (!cart.length) { if (typeof navigate === 'function') navigate('cart'); return; }
    root.innerHTML = _skeletonHTML(cart.length);
    verifyCart()
      .then(res => {
        root.innerHTML = _checkoutHTML(res);
        _bindCheckoutBtn(res);
      })
      .catch(() => {
        root.innerHTML =
          '<div class="cart-error-box">⚠ Couldn\u2019t verify prices right now. Please try again.<br><br>' +
          '<button class="cart-btn cart-btn-primary" onclick="Cart.renderCheckout()">Try Again</button> ' +
          '<button class="cart-btn cart-btn-ghost" onclick="navigate(\'cart\')">Back to Cart</button></div>';
      });
  }

  function _checkoutHTML(verified) {
    const live = verified.items.filter(v => v.state === 'ok');
    if (!live.length) {
      return '<div class="cart-wrap"><div class="cart-empty"><div class="cart-empty-ico">✓</div>' +
        '<h2 class="cart-empty-title">Nothing to pay for.</h2>' +
        '<p class="cart-empty-sub">Your cart has no chargeable items — everything is either already purchased or unavailable.</p>' +
        '<div class="cart-empty-ctas"><button class="cart-btn cart-btn-primary" onclick="navigate(\'cart\')">Back to Cart</button> ' +
        '<button class="cart-btn cart-btn-ghost" onclick="navigate(\'library\')">Browse Study Materials</button></div></div></div>';
    }

    const subtotal = live.reduce((s, v) => s + (v.dbPrice > 0 ? v.dbPrice : v.ci.priceSnapshot), 0);
    const mrp = live.reduce((s, v) => s + (v.dbOriginal > v.dbPrice ? v.dbOriginal : 0), 0);
    const savings = mrp > subtotal ? mrp - subtotal : 0;

    return `
    <div class="cart-wrap cart-wrap-checkout">
      <div class="cart-main">
        <div class="cart-title-row">
          <h1 class="cart-h1">Checkout</h1>
          <span class="cart-sub">Step 2 of 2 · Secure payment</span>
          <button class="cart-clear-btn" onclick="navigate('cart')">← Back to Cart</button>
        </div>
        <div class="cart-list">
          ${live.map(v => `
          <div class="cart-item">
            <div class="cart-item-img">
              ${(v.ci.cover || v.dbCover)
                ? `<img src="${_esc(v.ci.cover || v.dbCover)}" alt="${_esc(v.dbTitle || v.ci.title)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cart-item-noimg',innerHTML:'📚'}))">`
                : '<div class="cart-item-noimg">📚</div>'}
            </div>
            <div class="cart-item-body">
              <div class="cart-item-title">${_esc(v.dbTitle || v.ci.title)}</div>
              <div class="cart-item-cat">${_esc(v.dbCategory || v.ci.category || 'Study Material')}</div>
              <div class="cart-item-actions"><span class="cart-qty">Qty ×1</span></div>
            </div>
            <div class="cart-item-price"><span class="cart-price-now">₹${v.dbPrice > 0 ? v.dbPrice : v.ci.priceSnapshot}</span>
              ${v.priceChanged ? `<div class="cart-price-upd">Was ₹${v.ci.priceSnapshot} at add-time — current price shown</div>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>

      <aside class="cart-summary">
        <div class="cart-summary-card">
          <div class="cart-sum-title">Order Summary</div>
          <div class="cart-sum-row"><span>Items (${live.length})</span><span>₹${subtotal}</span></div>
          ${savings > 0 ? `<div class="cart-sum-row cart-sum-save"><span>You save (MRP)</span><span>−₹${savings}</span></div>` : ''}
          <div class="cart-sum-total"><span>To Pay</span><span>₹${subtotal}</span></div>
          <button class="cart-btn cart-btn-primary cart-checkout-btn" id="cartPayBtn">
            Pay ₹${subtotal}
          </button>
          <div class="cart-sum-note">🔒 Final amount re-verified from the database before the payment window opens.</div>
        </div>
      </aside>
    </div>`;
  }

  function _bindCheckoutBtn() {
    const btn = document.getElementById('cartPayBtn');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); pay(); });
  }

  /* ══════════════════════════════════════════════════════════════════
     PAYMENT — reuses the exact buyPDF() Razorpay pattern, batched
     ══════════════════════════════════════════════════════════════════ */
  let _paying = false;   // §36 idempotency guard — shared by every pay entry point

  /* ── removeQuiet — silent cart sync (no toast, no re-render) ────────
     Used after a direct checkout payment succeeds for a product that
     also happened to sit in the cart — keeps the badge honest without
     celebrating "Removed from cart" on a success screen. */
  function removeQuiet(pdfId) {
    pdfId = String(pdfId);
    save(items().filter(i => String(i.pdfId) !== pdfId));
    updateBadge();
  }

  /* ── _busyBtns — enable/disable every bound Pay button ───────────── */
  function _busyBtns(btns, busy, amount) {
    (btns || []).forEach(function (b) {
      if (!b) return;
      b.disabled = busy;
      b.textContent = busy ? 'Opening secure payment…' : 'Pay ₹' + amount;
    });
  }

  /* ═════════════════════════════════════════════════════════════════
     PAY CORE — the ONE Razorpay payment implementation (§ REUSE)
     Shared by Cart.pay() (multi-item) and the dedicated PDF checkout
     page (single item via Cart.payItems). Same key, same insert
     contract, same webhook, same idempotency guard — never a second
     payment system.
     ═════════════════════════════════════════════════════════════════ */
  async function payCore(payItems, opts) {
    if (_paying) return;                       // duplicate submission guard
    opts = opts || {};
    const btns = [].concat(opts.btn || [], opts.btns || []).filter(Boolean);

    const db = await _db();
    if (!db) { _toast('Network issue — please try again.', 'error'); return; }

    // Authenticated user (caller may pass the already-resolved session user)
    let user = opts.user || null;
    if (!user) {
      try { const { data: { user: u } } = await db.auth.getUser(); user = u; } catch (_) {}
    }
    if (!user) { _toast('Please login to checkout.', 'info'); if (typeof navigate === 'function') navigate('login'); return; }

    if (typeof Razorpay === 'undefined') {
      _toast('Payment gateway loading… please try again in a moment.', 'info');
      return;
    }

    const amount = payItems.reduce((s, p) => s + p.price, 0);   // DB-data amount only
    _paying = true;
    _busyBtns(btns, true);
    _ga4('begin_checkout', { currency: 'INR', value: amount, num_items: payItems.length });

    const options = {
      key: RZP_KEY,
      amount: amount * 100,
      currency: 'INR',
      name: 'Studyria',
      description: opts.description || ('Study Materials (' + payItems.length + ' item' + (payItems.length !== 1 ? 's' : '') + ')'),
      prefill: { email: user.email, name: (user.user_metadata && user.user_metadata.full_name) || '' },
      theme: { color: '#930205' },

      handler: async function (response) {
        const paymentId = response.razorpay_payment_id;
        const failed = [];
        for (const p of payItems) {
          // Same insert contract as buyPDF: duplicate-guarded purchased_pdfs row
          let ok = false;
          try {
            const { data: existRows } = await db.from('purchased_pdfs')
              .select('id').eq('user_id', user.id).eq('pdf_uuid', String(p.pdfId)).eq('status', 'paid');
            if (!existRows || !existRows.length) {
              const { error: insErr } = await db.from('purchased_pdfs').insert({
                user_id: user.id, email: user.email,
                pdf_uuid: String(p.pdfId), payment_id: paymentId, status: 'paid'
              });
              ok = !insErr;
              if (insErr) console.error('[Cart] purchase insert failed:', p.pdfId, insErr);
            } else { ok = true; }
          } catch (e) { console.error('[Cart] purchase insert exception:', e); }

          if (ok) {
            try {
              await fetch(PIPEDREAM, {   // same webhook as buyPDF
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email, user_id: user.id, pdf_uuid: String(p.pdfId), payment_id: paymentId, status: 'paid' })
              });
            } catch (e) { console.warn('[Cart] webhook error:', e); }
            try { if (typeof window.cpCreditCreatorSale === 'function') window.cpCreditCreatorSale(p.pdfId, p.price); } catch (_) {}
            try { if (typeof window.trackPdfDownloadEvent === 'function') window.trackPdfDownloadEvent({ id: p.pdfId, title: p.title, price: p.price }, 'premium_user'); } catch (_) {}
          } else {
            failed.push(p);
          }
        }

        const granted = payItems.filter(p => !failed.some(f => f.pdfId === p.pdfId));   // (§22)
        window._dashCache = null;
        try { if (typeof window._refreshDashStats === 'function') window._refreshDashStats(); } catch (_) {}
        _ga4('purchase', { currency: 'INR', value: amount, transaction_id: paymentId, num_items: payItems.length });
        _paying = false;

        if (typeof opts.onHandled === 'function') {
          try { opts.onHandled({ granted, failed, paymentId, amount, user }); }
          catch (e) { console.error('[Cart] onHandled error:', e); }
        }
      },

      modal: {
        ondismiss: function () {   // §21 payment failure/cancel — state stays intact
          _toast('Payment cancelled — your ' + (opts.itemNoun || 'cart') + ' is safe.', 'info');
          _paying = false;
          if (typeof opts.onDismiss === 'function') {
            try { opts.onDismiss(amount); } catch (e) {}
          } else {
            _busyBtns(btns, false, amount);
          }
        }
      }
    };

    try {
      new Razorpay(options).open();
    } catch (e) {
      console.error('[Cart] Razorpay open failed:', e);
      _toast('Could not open payment window. Please try again.', 'error');
      _paying = false;
      _busyBtns(btns, false, amount);
    }
  }

  /* ── Cart.pay — cart checkout entry point (behaviour unchanged) ─── */
  async function pay() {
    if (_paying) return;
    const db = await _db();
    if (!db) { _toast('Network issue — please try again.', 'error'); return; }

    // 1. Validate authenticated user
    let user = null;
    try { const { data: { user: u } } = await db.auth.getUser(); user = u; } catch (_) {}
    if (!user) { _toast('Please login to checkout.', 'info'); navigate('login'); return; }

    // 2. Fresh verification — DB is the only price source (§13)
    let verified;
    try { verified = await verifyCart(); }
    catch (e) { _toast('Couldn\u2019t verify prices. Please try again.', 'error'); return; }
    const live = verified.items.filter(v => v.state === 'ok');
    if (!live.length) { _toast('No chargeable items in your cart.', 'info'); renderCart(); navigate('cart'); return; }

    // 3. Final ownership re-check (race safety §17)
    try {
      const ids = live.map(v => v.ci.pdfId);
      const { data: owned } = await db.from('purchased_pdfs')
        .select('pdf_uuid').eq('user_id', user.id).eq('status', 'paid').in('pdf_uuid', ids);
      if (owned && owned.length) {
        const ownedIds = new Set(owned.map(o => String(o.pdf_uuid)));
        const stillLive = live.filter(v => !ownedIds.has(String(v.ci.pdfId)));
        if (stillLive.length !== live.length) {
          if (!stillLive.length) { _toast('✓ These items are already in your library.', 'success'); renderCart(); navigate('cart'); return; }
          _toast('Some items were already purchased — checkout continues with the rest.', 'info');
          live.length = 0; stillLive.forEach(v => live.push(v));
        }
      }
    } catch (_) {}

    // 4. Premium members bypass Razorpay for Pass content (same rule as buyPDF)
    if (window.SMCI && typeof window.SMCI.isPremium === 'function') {
      try {
        if (await window.SMCI.isPremium()) {
          _toast('👑 Premium member — opening your items directly.', 'success');
          for (const v of live) await openOwned(v.ci.pdfId);
          save(items().filter(i => !live.some(v => String(v.ci.pdfId) === String(i.pdfId))));
          renderCart(); navigate('cart');
          return;
        }
      } catch (_) {}
    }

    const payItems = live.map(v => ({ pdfId: v.ci.pdfId, price: v.dbPrice > 0 ? v.dbPrice : v.ci.priceSnapshot, title: v.dbTitle || v.ci.title }));

    return payCore(payItems, {
      user: user,
      btn: document.getElementById('cartPayBtn'),
      onHandled: function (res) {
        // Clear only successfully-granted items (§22)
        save(items().filter(i => !res.granted.some(g => String(g.pdfId) === String(i.pdfId))));
        if (typeof navigate === 'function') navigate('cart');
        renderCart();
        if (res.failed.length) {
          _toast('⚠️ Payment received but ' + res.failed.length + ' item(s) couldn\u2019t be saved. Contact support with ID: ' + res.paymentId, 'error');
        } else {
          _showSuccess(res.granted);
        }
      }
      // onDismiss omitted → default: re-enable the Pay button (same as before)
    });
  }

  function _showSuccess(granted) {
    const root = _el(); if (!root) return;
    root.innerHTML = `
    <div class="cart-wrap">
      <div class="cart-empty cart-success">
        <div class="cart-empty-ico cart-success-ico">🎉</div>
        <h2 class="cart-empty-title">Payment Successful</h2>
        <p class="cart-empty-sub">Your study materials are now available in your library${granted.length ? ' — ' + _esc(granted[0].title) + (granted.length > 1 ? ' and ' + (granted.length - 1) + ' more' : '') : ''}.</p>
        <div class="cart-empty-ctas">
          <button class="cart-btn cart-btn-primary" onclick="navigate('dashboard');setTimeout(function(){if(typeof switchMeTab==='function')switchMeTab('purchased');},400)">Open My Library</button>
          <button class="cart-btn cart-btn-ghost" onclick="navigate('library')">Continue Studying</button>
        </div>
      </div>
    </div>`;
    updateBadge();
  }

  /* ══════════════════════════════════════════════════════════════════
     PDP ADD-TO-CART BUTTON STATE (§4 — "✓ Added to Cart")
     ══════════════════════════════════════════════════════════════════ */
  window.pdpAddToCart = async function pdpAddToCart() {
    const pdf = window.selectedPdf;
    if (!pdf) return;
    const added = await add(pdf.id);
    if (added) pdpRefreshCartState();
  };

  window.pdpRefreshCartState = function pdpRefreshCartState() {
    const pdf = window.selectedPdf; if (!pdf) return;
    document.querySelectorAll('[data-pdp-cart-btn]').forEach(btn => {
      if (Cart.has(pdf.id)) {
        btn.innerHTML = '✓ Added to Cart';
        btn.classList.add('pdp-cart-added');
        btn.setAttribute('onclick', "navigate('cart')");
      } else {
        btn.innerHTML = '🛒 Add to Cart';
        btn.classList.remove('pdp-cart-added');
        btn.setAttribute('onclick', 'pdpAddToCart()');
      }
    });
  };

  /* ══════════════════════════════════════════════════════════════════
     INIT + AUTH WIRING
     ══════════════════════════════════════════════════════════════════ */
  function _initAuthListener(tries) {
    const db = _client();
    if (!db) {
      if ((tries || 0) < 40) setTimeout(() => _initAuthListener((tries || 0) + 1), 500);
      return;
    }
    try {
      db.auth.onAuthStateChange(function (ev) {
        if (ev === 'SIGNED_IN') mergeGuestCart();
        Cart.updateBadge();
      });
    } catch (e) { console.warn('[Cart] auth listener failed:', e); }
    mergeGuestCart();   // handle already-signed-in users at load
  }

  /* ── Export ─────────────────────────────────────────────────────── */
  window.Cart = {
    add, remove, removeQuiet, has, count, items, clearAll, openOwned,
    renderCart, renderCheckout, retryRender, goCheckout, pay,
    updateBadge, mergeGuestCart, verifyCart, verifyList,
    payItems: payCore
  };

  document.addEventListener('DOMContentLoaded', function () {
    updateBadge();
    _initAuthListener(0);
  });
  updateBadge();
  _initAuthListener(0);
})();
