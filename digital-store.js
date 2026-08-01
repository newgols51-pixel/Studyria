/**
 * ═══════════════════════════════════════════════════════════════════════════
 * digital-store.js — Studyria V5.1 Module 8: Digital Store
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[DigitalStore] Core not loaded'); return; }

  let _category = 'all';
  let _search = '';

  async function render(container) {
    if (!container) return;
    const user = await R()._user();
    container.innerHTML = `
      <div class="rm-tabs" id="dsTabs">
        <div class="rm-tab active" onclick="DigitalStore._cat('all')">🛒 All Products</div>
        <div class="rm-tab" onclick="DigitalStore._cat('my')">📥 My Purchases</div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="rm-search" style="flex:1"><input type="text" placeholder="Search products..." oninput="DigitalStore._search(this.value)"></div>
        <select class="rm-select" style="width:auto" onchange="DigitalStore._filter(this.value)">
          <option value="all">All Categories</option>
          <option value="template">Templates</option>
          <option value="ebook">E-books</option>
          <option value="printable">Printables</option>
          <option value="question_bank">Question Banks</option>
          <option value="study_planner">Study Planners</option>
          <option value="premium_resource">Premium Resources</option>
        </select>
      </div>
      <div id="dsContent">${R().skeletonHTML(6)}</div>`;
    _loadProducts();
  }

  function _cat(c) {
    _category = c;
    document.querySelectorAll('#dsTabs .rm-tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList.add('active');
    if (c === 'all') _loadProducts(); else _loadMyPurchases();
  }

  function _search(v) { _search = v; R().debounce(() => { if (_category === 'all') _loadProducts(); }, 300)(); }
  function _filter(v) { _filterCategory = v; _loadProducts(); }
  let _filterCategory = 'all';

  async function _loadProducts() {
    const c = document.getElementById('dsContent');
    if (!c) return;
    c.innerHTML = R().skeletonHTML(6);
    try {
      let q = R()._sb().from('products')
        .select('id,title,description,category,thumbnail_url,price,currency,is_premium,download_count,rating_avg,rating_count')
        .eq('is_published', true).is('deleted_at', null)
        .order('sort_order', { ascending: true }).limit(30);

      if (_search) q = q.ilike('title', `%${_search}%`);
      if (_filterCategory && _filterCategory !== 'all') q = q.eq('category', _filterCategory);

      const { data } = await q;
      if (!data?.length) { c.innerHTML = R().emptyHTML('🛒', 'No products available yet.'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-3">${data.map(p => _productCard(p)).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  function _productCard(p) {
    const icons = { template: '📋', ebook: '📚', printable: '🖨️', question_bank: '❓', study_planner: '📅', premium_resource: '⭐' };
    return `<div class="rm-card rm-product-card">
      <div class="rm-product-thumb">${p.thumbnail_url ? `<img src="${R().sanitize(p.thumbnail_url)}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" alt="">` : (icons[p.category] || '📦')}</div>
      <h3 class="rm-card-title">${R().sanitize(p.title)}</h3>
      <p class="rm-card-subtitle">${R().sanitize(p.description?.slice(0, 80) || '')}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        <span class="rm-badge rm-badge-new">${R().sanitize(p.category?.replace(/_/g,' ') || '')}</span>
        ${p.is_premium ? '<span class="rm-badge rm-badge-premium">Premium</span>' : ''}
        ${p.rating_avg > 0 ? `<span class="rm-badge">⭐ ${p.rating_avg}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
        <span class="rm-product-price ${p.price === 0 ? 'free' : ''}">${p.price === 0 ? 'Free' : '₹' + p.price}</span>
        <span style="font-size:0.75rem;color:var(--rm-text-muted)">⬇️ ${p.download_count || 0}</span>
      </div>
      <button class="rm-btn ${p.price > 0 ? 'rm-btn-gold' : 'rm-btn-primary'}" style="width:100%;margin-top:12px"
        onclick="DigitalStore._action('${p.id}','${p.price}',${p.is_premium})">
        ${p.price === 0 ? '⬇️ Download Free' : '🛒 Purchase'}
      </button>
    </div>`;
  }

  async function _action(productId, price, isPremium) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to purchase/download.', 'info'); if (typeof navigate === 'function') navigate('login'); return; }
    try {
      if (parseInt(price) === 0) {
        await R().safeInsert('purchases', { user_id: user.id, product_id: productId, amount_paid: 0, payment_status: 'completed' });
        R().toast('Product added! Download starting...', 'success');
        await _download(productId);
      } else {
        if (isPremium && typeof Razorpay !== 'undefined') {
          R().toast('Payment integration coming soon! For now, contact support.', 'info');
        } else {
          R().toast('Paid products require payment integration. Coming soon!', 'info');
        }
      }
    } catch (e) {
      if (e.code === '23505') { R().toast('Already purchased! Downloading...', 'success'); await _download(productId); }
      else R().toast('Error: ' + e.message, 'error');
    }
  }

  async function _download(productId) {
    try {
      const { data: p } = await R()._sb().from('products').select('file_url,title').eq('id', productId).single();
      if (!p?.file_url) { R().toast('Download link not available yet.', 'info'); return; }
      const a = document.createElement('a');
      a.href = p.file_url; a.download = p.title || 'download';
      a.target = '_blank'; a.click();
      R().toast('Download started!', 'success');
    } catch (e) { R().toast('Download error: ' + e.message, 'error'); }
  }

  async function _loadMyPurchases() {
    const c = document.getElementById('dsContent');
    if (!c) return;
    const user = await R()._user();
    if (!user) { c.innerHTML = R().emptyHTML('🔒', 'Please login to view your purchases.'); return; }
    try {
      const { data } = await R()._sb().from('purchases')
        .select('id,product_id,amount_paid,payment_status,download_count,max_downloads,created_at,products(id,title,category,thumbnail_url,file_url)')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📥', 'No purchases yet. Browse the store!'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-3">${data.map(p => `
        <div class="rm-card rm-product-card">
          <div class="rm-product-thumb">${p.products?.thumbnail_url ? `<img src="${R().sanitize(p.products.thumbnail_url)}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" alt="">` : '📦'}</div>
          <h3 class="rm-card-title">${R().sanitize(p.products?.title || 'Product')}</h3>
          <div style="display:flex;gap:6px;margin:8px 0">
            <span class="rm-badge ${p.payment_status === 'completed' ? 'rm-badge-free' : 'rm-badge-premium'}">${R().sanitize(p.payment_status)}</span>
            <span style="font-size:0.75rem;color:var(--rm-text-muted)">⬇️ ${p.download_count}/${p.max_downloads} downloads</span>
          </div>
          <button class="rm-btn rm-btn-primary" style="width:100%" onclick="DigitalStore._download('${p.product_id}')">⬇️ Download Again</button>
        </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.DigitalStore = Object.freeze({
    render, _cat, _search, _filter, _action, _download,
    init: () => { const p = document.getElementById('page-digital-store'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('digitalStore', root.DigitalStore);
  console.log('[DigitalStore] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
