/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDF CHECKOUT PAGE V2 (Secure UI Upgrade)
   Modular JS for the Product Detail Page (PDP)

   This file REPLACES the inline PDP JS from index.html.
   All function signatures match the old ones so app.js, supabase.js,
   and all other modules keep working unchanged.

   V2.2 — 2026-09-05 — Removed ALL viewport-meta locking/mutation (root cause of
   mobile scroll-zoom desync). touch-action hardening only. Accessibility zoom preserved.
   ═══════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

/* ── PDF.js Worker Configuration ── */
/* Runs when pdp-v2.js executes (deferred, after pdf.min.js) */
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
}

/* ═══════════════════════════════════════════════════════════════════════
   PDP ZOOM CONTROL — V2.1 ROOT-CAUSE FIX (2026-09-05)
   The old version rewrote the <meta viewport> on every PDP mount
   (user-scalable=no, maximum-scale=1) and again from a visualViewport
   resize listener. Dynamically rewriting viewport meta mid-session
   desynchronises the visual viewport from the layout viewport on
   iOS/Android → the reported oversized/cropped/mispositioned preview
   after scroll or pinch. THE META TAG IS NEVER TOUCHED NOW.
   • Double-tap zoom on the cover is blocked LOCALLY via
     touch-action: manipulation (no meta needed).
   • Preview zoom is handled locally inside the V3 stage
     (pdp-v3.js zoom engine) — never the whole page.
   • Browser pinch-zoom remains available to the user (accessibility,
     WCAG 1.4.4). It can never corrupt layout because nothing fights it.
   ═══════════════════════════════════════════════════════════════════════ */
function _pdpInstallZoomControl() {
  // V3 ARCHITECTURE (2026-09-05): touch-action hardening ONLY.
  // NO viewport meta locking/mutation — browser accessibility zoom always
  // works. (Runtime meta mutation was the scroll-zoom desync root cause.)
  if (window._pdpZoomCleanup) {
    window._pdpZoomCleanup();
    window._pdpZoomCleanup = null;
  }
  const coverWrap = document.querySelector('.pdp-cover-wrap');
  if (coverWrap) coverWrap.style.touchAction = 'manipulation';
  const stage = document.querySelector('.pdp-v3-stage');
  if (stage) stage.style.touchAction = 'pan-y'; // vertical scroll passes through natively
  window._pdpZoomCleanup = function() {
    if (coverWrap) coverWrap.style.touchAction = '';
    if (stage) stage.style.touchAction = '';
  };
}
window._pdpInstallZoomControl = _pdpInstallZoomControl;

/* Kept for backwards compatibility with old call sites — TRUE NO-OP.
   The old implementation toggled the viewport meta at runtime
   ('shrink-to-fit' hack) — the scroll-zoom desync root cause.
   NEVER rewrite the viewport meta from JS. */
function _pdpResetPageZoom() {}
window._pdpResetPageZoom = _pdpResetPageZoom;

/* ═══════════════════════════════════════════════════════════════════════
   HTML-ESCAPE HELPER
   ═══════════════════════════════════════════════════════════════════════ */
function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
window._esc = _esc;

/* ═══════════════════════════════════════════════════════════════════════
   RENDER DETAIL — Entry point (same signature as old)
   ═══════════════════════════════════════════════════════════════════════ */
function renderDetail() {
  const pdf = window.selectedPdf;
  if (!pdf) return;
  if (typeof normalizePdf === 'function') normalizePdf(pdf);
  window._pdpRenderShell(pdf);
  if (typeof _pdpLoadLiveStats === 'function') _pdpLoadLiveStats(pdf.id);
  if (typeof _pdpSubscribeRealtime === 'function') _pdpSubscribeRealtime(pdf.id);
  if (!window._ownedCacheReady && window.currentUser) {
    if (typeof _loadOwnershipCache === 'function') {
      _loadOwnershipCache().then(() => {
        setTimeout(_refreshFreeButtonLabels, 50);
      });
    }
  }
}
window.renderDetail = renderDetail;

/* ═══════════════════════════════════════════════════════════════════════
   STAR SVG HELPER
   ═══════════════════════════════════════════════════════════════════════ */
function _starSVG(filled) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${filled ? '#f59e0b' : 'none'}" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}
function _starsHTML(rating) {
  const r = Math.round(rating);
  return [1,2,3,4,5].map(s => _starSVG(s <= r)).join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   _pdpRenderShell — V2 Premium Template
   ═══════════════════════════════════════════════════════════════════════ */
function _pdpRenderShell(pdf) {
  const inWish    = (window.wishlist || []).includes(pdf.id) || (window.wishlist || []).includes(String(pdf.id));
  const price     = Number(pdf.price ?? 0);
  const origPrice = Number(pdf.originalPrice ?? 0);
  const discount  = (origPrice > 0 && price > 0 && origPrice > price)
                      ? Math.round((1 - price / origPrice) * 100) : 0;
  const coverFrom = pdf.coverFrom || '#930205';
  const coverTo   = pdf.coverTo   || '#930205';

  // Cover — real image or gradient fallback (no placeholder text)
  const coverSrc = (pdf.cover_image || pdf.coverImage || '').trim();
  const coverHTML = coverSrc
    ? `<img src="${coverSrc}" alt="${_esc(pdf.title)}" class="pdp-cover-img"
          width="400" height="600"
          style="transform:none!important;transition:none!important;will-change:auto!important"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy" decoding="async">
       <div class="pdp-cover-fallback" style="display:none;background:linear-gradient(135deg,${coverFrom},${coverTo})">${typeof icon === 'function' ? icon('file',64) : '📄'}</div>`
    : `<div class="pdp-cover-fallback" style="background:linear-gradient(135deg,${coverFrom},${coverTo})">${typeof icon === 'function' ? icon('file',64) : '📄'}</div>`;

  const description = (pdf.description || '').trim();

  const publishedVal = pdf.created_at
    ? new Date(pdf.created_at).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'})
    : null;
  const updatedVal = pdf.updated_at
    ? new Date(pdf.updated_at).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'})
    : null;

  // V2: Trust badges (6 items as requested)
  const trustItems = [
    { icon: '🔒', label: '100% Secure Payment' },
    { icon: '⚡', label: 'Instant Access' },
    { icon: '✅', label: 'Verified Content' },
    { icon: '📥', label: 'Safe Download' },
    { icon: '🔐', label: 'Encrypted Delivery' },
    { icon: '🤝', label: 'Trusted by Students' },
  ];

  // V2: Feature cards (premium)
  const featureCards = [
    { icon: '📽️', label: 'HD Scan' },
    { icon: '📱', label: 'Mobile Friendly' },
    { icon: '🖨️', label: 'Printable' },
    { icon: '🆕', label: 'Latest Edition' },
    { icon: '💎', label: 'High Quality' },
    { icon: '✅', label: 'Verified Content' },
    { icon: '⚡', label: 'Instant Access' },
    { icon: '📴', label: 'Offline Reading' },
    { icon: '♾️', label: 'Lifetime Access' },
  ];

  // V2: Why choose cards
  const whyChoose = [
    { icon: '🎯', label: 'Exam Focused' },
    { icon: '📚', label: 'Updated Syllabus' },
    { icon: '🏆', label: 'Trusted Source' },
    { icon: '📝', label: 'Curated Notes' },
    { icon: '⏱️', label: 'Time Saving' },
    { icon: '🔄', label: 'Easy Revision' },
  ];

  // V2: Learning outcomes
  const outcomes = [
    'Comprehensive theory coverage','Solved examples & practice sets',
    'Previous year questions','Quick revision charts',
    'Chapter-wise breakdowns','Expert tips & tricks',
  ];

  // Related PDFs
  const relatedPdfs = (typeof validPdfs === 'function' ? validPdfs(window.PDFS || []) : (window.PDFS || []))
    .filter(p =>
      String(p.id) !== String(pdf.id) &&
      (p.category === pdf.category || p.subcategory_id === pdf.subcategory_id)
    ).slice(0, 6);

  const _isOwned = typeof window._isOwned === 'function' ? window._isOwned : () => false;
  /* Owned PAID product → the UI must never re-offer purchase (§12) */
  const ownedPaid = (!pdf.free && price > 0 && _isOwned(String(pdf.id)));

  const pdpHTML = `
  <div class="pdp-page">
    <div class="pdp-hero-strip">
      <div class="pdp-hero-orb pdp-hero-orb1"></div>
      <div class="pdp-hero-orb pdp-hero-orb2"></div>
      <div class="container">
        <div class="pdp-back-row">
          <button class="pdp-back-btn" onclick="navigate('library')">
            <svg width="14" height="14" style="transform:rotate(180deg)"><use href="#ic-arrow"/></svg>
            Back to Library
          </button>
          <div class="pdp-breadcrumb">
            <span onclick="navigate('home')" class="pdp-bc-link">Home</span>
            <span class="pdp-bc-sep">›</span>
            <span onclick="navigate('library')" class="pdp-bc-link">Library</span>
            <span class="pdp-bc-sep">›</span>
            <span class="pdp-bc-cur">${_esc((pdf.title||'').slice(0,30))}${(pdf.title||'').length > 30 ? '…' : ''}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="container pdp-container">
      <div class="pdp-layout">

        <div class="pdp-left">

          <!-- ═══ PREMIUM HEADER: Cover Card ═══ -->
          <div class="pdp-cover-card">
            <div class="pdp-cover-wrap">
              ${coverHTML}
              ${pdf.tag ? `<div class="pdp-cover-tag tag-${pdf.tag.toLowerCase().replace(/\s+/g,'')}">${_esc(pdf.tag)}</div>` : ''}
              ${discount > 0 ? `<div class="pdp-cover-discount">-${discount}%</div>` : ''}
            </div>
            <div class="pdp-cover-actions">
              <button class="pdp-cover-action-btn" onclick="pdpToggleWish()" id="pdpCoverWishBtn" title="Wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${inWish?'var(--danger)':'none'}" stroke="${inWish?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                ${inWish ? 'Saved' : 'Wishlist'}
              </button>
              <button class="pdp-cover-action-btn" onclick="pdpSharePDF()" title="Share">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Share
              </button>
            </div>
          </div>

          <!-- ═══ PDF PREVIEW — REMOVED: V3 gallery handles previews ═══ -->
          <!-- The scroll-driven sticky preview was the root cause of the auto-zoom bug -->
          <!-- V3 gallery (pdp-v3.js) replaces the cover-card with a click-driven gallery -->

          <!-- ═══ PREMIUM HEADER: Meta Block ═══ -->
          <div class="pdp-meta-block">
            <div class="pdp-tags-row">
              ${pdf.tag ? `<span class="pdp-inline-tag tag-${pdf.tag.toLowerCase().replace(/\s+/g,'')}">${_esc(pdf.tag)}</span>` : ''}
              ${discount > 0 ? `<span class="pdp-offer-badge"><span class="pdp-offer-dot"></span>🔥 ${discount}% OFF — Limited Time!</span>` : ''}
            </div>
            <h1 class="pdp-title">${_esc(pdf.title || 'Untitled')}</h1>

            ${pdf.author ? `
            <div class="pdp-author-row">
              <div class="pdp-author-avatar">${_esc(pdf.author.charAt(0).toUpperCase())}</div>
              <div>
                <div class="pdp-author-by">Created by</div>
                <div class="pdp-author-name">${_esc(pdf.author)}</div>
              </div>
            </div>` : ''}

            <div class="pdp-rating-row" id="pdpRatingRow" style="display:none">
              <span class="pdp-stars" id="pdpRatingStars"></span>
              <span class="pdp-rating-val" id="pdpRatingVal"></span>
              <span class="pdp-rating-count" id="pdpRatingCount"></span>
              <span class="pdp-rating-sep" id="pdpStudentsSep" style="display:none">•</span>
              <span class="pdp-students-count" id="pdpStudentsCount" style="display:none"></span>
            </div>
          </div>

          <!-- ═══ INFO CHIPS ═══ -->
          <div class="pdp-info-chips" id="pdpInfoChips">
            ${pdf.category ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📚</span><span class="pdp-ic-label">Category</span><span class="pdp-ic-val">${_esc(pdf.category)}</span></div>` : ''}
            ${pdf.subcategory_id ? (() => { const _s=(window._dbSubcategories||[]).find(s=>String(s.id)===String(pdf.subcategory_id)); return _s?`<div class="pdp-info-chip"><span class="pdp-ic-icon">🏫</span><span class="pdp-ic-label">Class/Level</span><span class="pdp-ic-val">${_esc(_s.name)}</span></div>`:''; })() : ''}
            ${pdf.stream_id ? (() => { const _s=(window._dbStreams||[]).find(s=>String(s.id)===String(pdf.stream_id)); return _s?`<div class="pdp-info-chip"><span class="pdp-ic-icon">🌊</span><span class="pdp-ic-label">Stream</span><span class="pdp-ic-val">${_esc(_s.name)}</span></div>`:''; })() : ''}
            ${pdf.language ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">🌐</span><span class="pdp-ic-label">Language</span><span class="pdp-ic-val">${_esc(pdf.language)}</span></div>` : ''}
            ${(pdf.pages || pdf.total_pages) ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📄</span><span class="pdp-ic-label">Pages</span><span class="pdp-ic-val">${pdf.pages || pdf.total_pages}</span></div>` : ''}
            <div class="pdp-info-chip" id="pdpChipDownloads" style="display:none"><span class="pdp-ic-icon">📥</span><span class="pdp-ic-label">Downloads</span><span class="pdp-ic-val" id="pdpChipDlVal"></span></div>
            ${publishedVal ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📅</span><span class="pdp-ic-label">Published</span><span class="pdp-ic-val">${publishedVal}</span></div>` : ''}
            ${updatedVal ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">🔄</span><span class="pdp-ic-label">Updated</span><span class="pdp-ic-val">${updatedVal}</span></div>` : ''}
            <div class="pdp-info-chip"><span class="pdp-ic-icon">📋</span><span class="pdp-ic-label">Format</span><span class="pdp-ic-val">PDF</span></div>
            <div class="pdp-info-chip"><span class="pdp-ic-icon">♾️</span><span class="pdp-ic-label">Access</span><span class="pdp-ic-val">Lifetime</span></div>
          </div>

          ${description ? `
          <div class="pdp-section">
            <div class="pdp-section-title">📖 About this PDF</div>
            <div class="pdp-desc-wrap" id="pdpDescWrap">
              <p class="pdp-desc-text" id="pdpDescText">${_esc(description)}</p>
            </div>
            <button class="pdp-read-more-btn" id="pdpReadMoreBtn" onclick="pdpToggleDesc()">Read More ↓</button>
          </div>` : ''}

          <!-- ═══ FEATURES SECTION ═══ -->
          <div class="pdp-section">
            <div class="pdp-section-title">✨ Premium Features</div>
            <div class="pdp-features-grid">
              ${featureCards.map(f => `
                <div class="pdp-feature-card">
                  <span class="pdp-feature-icon">${f.icon}</span>
                  <span>✓ ${f.label}</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- ═══ WHY CHOOSE THIS PDF ═══ -->
          <div class="pdp-section">
            <div class="pdp-section-title">🏆 Why Choose This PDF</div>
            <div class="pdp-outcomes-grid">
              ${whyChoose.map(w => `
                <div class="pdp-outcome-item">
                  <span class="pdp-outcome-check">✔</span>
                  <span>${w.label}</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- ═══ WHAT YOU'LL LEARN ═══ -->
          <div class="pdp-section">
            <div class="pdp-section-title">🎯 What You'll Learn</div>
            <div class="pdp-outcomes-grid">
              ${outcomes.map(o => `
                <div class="pdp-outcome-item">
                  <span class="pdp-outcome-check">✓</span>
                  <span>${o}</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- ═══ WHO SHOULD READ ═══ -->
          <div class="pdp-section">
            <div class="pdp-section-title">👥 Who Should Read This</div>
            <div class="pdp-audience-grid">
              ${[
                {icon:'📚', label: pdf.subject_id ? ((window._dbSubjects||[]).find(s=>String(s.id)===String(pdf.subject_id))?.name||'') + ' Students'
                            : pdf.subcategory_id ? ((window._dbSubcategories||[]).find(s=>String(s.id)===String(pdf.subcategory_id))?.name||'') + ' Students'
                            : pdf.category ? pdf.category + ' Students'
                            : 'Competitive Exam Students'},
                {icon:'🎯', label:'Exam Aspirants'},
                {icon:'🔄', label:'Quick Revision Seekers'},
                {icon:'💡', label:'Self-Learners'},
              ].map(a => `<div class="pdp-audience-chip"><span>${a.icon}</span><span>${a.label}</span></div>`).join('')}
            </div>
          </div>

          <!-- ═══ MOBILE PRICE BLOCK ═══ -->
          <div class="pdp-section pdp-mobile-price-block" id="pdpMobilePriceBlock"></div>

          <!-- ═══ TRUST SECTION ═══ -->
          <div class="pdp-section">
            <div class="pdp-section-title">🛡️ Why Trust Studyria</div>
            <div class="pdp-trust-grid">
              ${trustItems.map(t => `
                <div class="pdp-trust-badge">
                  <span class="pdp-trust-icon">${t.icon}</span>
                  <span class="pdp-trust-label">${t.label}</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- ═══ STUDENT REVIEWS ═══ -->
          <div class="pdp-section" id="pdpReviewsSection" style="display:none">
            <div class="pdp-section-title">⭐ Student Reviews</div>
            <div class="pdp-reviews-summary" id="pdpReviewsSummary"></div>
            <div class="pdp-reviews-list" id="pdpReviewsList"></div>
            <div id="pdpWriteReviewWrap"></div>
          </div>

          <!-- ═══ RELATED CONTENT ═══ -->
          ${relatedPdfs.length ? `
          <div class="pdp-section">
            <div class="pdp-section-title">📚 Related PDFs</div>
            <div class="pdp-related-track">
              ${relatedPdfs.map(p => typeof pdfCardHTML === 'function' ? pdfCardHTML(normalizePdf(p)) : '').join('')}
            </div>
          </div>` : ''}

          <!-- ═══ BOTTOM CTA ═══ -->
          <div class="pdp-bottom-cta">
            <div class="pdp-cta-orb"></div>
            <div class="pdp-cta-content">
              <div class="pdp-cta-icon">📚</div>
              <div class="pdp-cta-title">Start Learning Today</div>
              <div class="pdp-cta-sub" id="pdpCtaSub">Get instant access to this PDF</div>
              <button class="pdp-cta-btn" onclick="pdpHandleBuy()">
                ${ownedPaid
                  ? '⚡ Open PDF'
                  : pdf.free || price === 0
                  ? (_isOwned(String(pdf.id)) ? '⚡ Open PDF' : '⚡ Download Free Now')
                  : `⚡ Buy Now – ₹${price}`}
              </button>
            </div>
          </div>

        </div><!-- /pdp-left -->

        <!-- ═══ RIGHT: Buy Card (desktop only) ═══ -->
        <div class="pdp-right">
          <div class="pdp-buy-card" id="pdpBuyCard">
            ${ownedPaid ? `<div class="pdp-owned-banner">✓ Purchased — Lifetime Access</div>` : ''}
            ${pdf.free ? `
              <div class="pdp-price-row">
                <span class="pdp-price-free">FREE</span>
                <span class="pdp-free-badge">✅ No Cost</span>
              </div>
            ` : price > 0 ? `
              <div class="pdp-price-row">
                <span class="pdp-price-now">₹${price}</span>
                ${origPrice > 0 && origPrice > price ? `<span class="pdp-price-was">₹${origPrice}</span>` : ''}
                ${discount > 0 ? `<div class="pdp-discount-badge"><span class="pdp-discount-dot"></span>${discount}% OFF</div>` : ''}
              </div>
              ${discount > 0 ? `<div class="pdp-urgency-bar"><span class="pdp-urgency-dot"></span>🔥 Limited Offer — Ends Soon!</div>` : ''}
            ` : ''}

            <button class="pdp-buy-primary" onclick="pdpHandleBuy()">
              ${ownedPaid
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`
                : pdf.free
                ? _isOwned(String(pdf.id))
                  ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`
                  : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Free`
                : price > 0
                  ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>Buy Now — ₹${price}`
                  : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>Get Access`}
            </button>
            ${ownedPaid ? `<button class="pdp-cart-secondary" onclick="navigate('library')" style="text-align:center">📚 View in Library</button>` : ''}

            ${(pdf.free || price === 0 || (window.Cart && Cart.has(pdf.id)) || (typeof _isOwned === 'function' && _isOwned(String(pdf.id)))) ? '' : `<button class="pdp-cart-secondary" data-pdp-cart-btn onclick="pdpAddToCart()">🛒 Add to Cart</button>`}

            <button class="pdp-wish-secondary" id="pdpWishBtn" onclick="pdpToggleWish()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${inWish?'var(--danger)':'none'}" stroke="${inWish?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              ${inWish ? 'Saved to Wishlist' : '❤️ Add to Wishlist'}
            </button>

            <div class="pdp-buy-features">
              ${trustItems.slice(0,5).map(t => `
                <div class="pdp-buy-feature-row">
                  <span>${t.icon}</span><span>${t.label}</span>
                </div>`).join('')}
            </div>

            <div class="pdp-detail-table" id="pdpDetailTable">
              ${(pdf.pages || pdf.total_pages) ? `<div class="pdp-detail-row"><span class="pdp-detail-key">📄 Pages</span><span class="pdp-detail-val">${pdf.pages || pdf.total_pages}</span></div>` : ''}
              <div class="pdp-detail-row" id="pdpDetailRatingRow" style="display:none"><span class="pdp-detail-key">⭐ Rating</span><span class="pdp-detail-val" id="pdpDetailRatingVal"></span></div>
              <div class="pdp-detail-row" id="pdpDetailDlRow" style="display:none"><span class="pdp-detail-key">📥 Downloads</span><span class="pdp-detail-val" id="pdpDetailDlVal"></span></div>
              ${pdf.language ? `<div class="pdp-detail-row"><span class="pdp-detail-key">🌐 Language</span><span class="pdp-detail-val">${_esc(pdf.language)}</span></div>` : ''}
              <div class="pdp-detail-row"><span class="pdp-detail-key">📋 Format</span><span class="pdp-detail-val">PDF (Printable)</span></div>
              <div class="pdp-detail-row"><span class="pdp-detail-key">♾️ Access</span><span class="pdp-detail-val">Lifetime</span></div>
              <div class="pdp-detail-row"><span class="pdp-detail-key">📱 Device</span><span class="pdp-detail-val">All Devices</span></div>
            </div>

            <div class="pdp-guarantee">
              🛡️ <strong>30-Day Money Back Guarantee</strong>
              <div style="font-size:.72rem;color:var(--text2);margin-top:3px">Not satisfied? We'll refund — no questions asked.</div>
            </div>
          </div>
        </div><!-- /pdp-right -->

      </div><!-- /pdp-layout -->
    </div><!-- /container -->
  </div><!-- /pdp-page -->
  `;

  document.getElementById('pdpWrap').innerHTML = pdpHTML;

  // Preview init — REMOVED: V3 gallery handles this via window.pdpInitPreview
  // The V2 scroll-driven preview caused the auto-zoom bug (sticky element stayed fixed during scroll)
  // V3 patch (_patchRenderShell in pdp-v3.js) calls window.pdpInitPreview after gallery swap

  // Zoom control
  _pdpInstallZoomControl();

  // Sticky bar
  const stickyBar   = document.getElementById('pdpStickyBar');
  const stickyTitle = document.getElementById('pdpStickyTitle');
  const stickyPrice = document.getElementById('pdpStickyPrice');
  const stickyBuy   = document.getElementById('pdpStickyBuy');
  const stickyCart  = document.getElementById('pdpStickyCart');
  if (stickyTitle) stickyTitle.textContent = (pdf.title||'').slice(0,40) + ((pdf.title||'').length > 40 ? '…' : '');
  if (stickyPrice) stickyPrice.textContent = pdf.free ? 'FREE' : (price > 0 ? `₹${price}` : 'FREE');
  const _pdfOwned = _isOwned(String(pdf.id)) && (pdf.free || ownedPaid);
  if (stickyBuy)   stickyBuy.textContent   = _pdfOwned ? '⚡ Open PDF' : (pdf.free ? '⚡ Download Free' : (price > 0 ? `⚡ Buy ₹${price}` : '⚡ Download Free'));
  if (stickyBar)   stickyBar.style.display = '';
  /* Sticky Add to Cart — visible only for a paid, not-yet-owned, not-in-cart PDF */
  const _stickySyncCart = () => {
    const btn = document.getElementById('pdpStickyCart');
    if (!btn) return;
    const p = window.selectedPdf;
    if (!p) return;
    const isFree = p.free || Number(p.price ?? 0) === 0;
    const owned = typeof window._isOwned === 'function' && window._isOwned(String(p.id));
    if (isFree || owned) { btn.style.display = 'none'; return; }
    if (window.Cart && Cart.has(p.id)) {
      btn.style.display = '';
      btn.textContent = '✓ Added';
      btn.disabled = true;
    } else {
      btn.style.display = '';
      btn.textContent = '🛒 Cart';
      btn.disabled = false;
    }
  };
  if (stickyCart) {
    stickyCart.onclick = async () => {
      const p = window.selectedPdf;
      if (!p) return;
      await window.pdpAddToCart();
      _stickySyncCart();
    };
    _stickySyncCart();
  }
  window.removeEventListener('studyria:cartChanged', window._pdpStickyCartSync || (() => {}));
  window._pdpStickyCartSync = _stickySyncCart;
  window.addEventListener('studyria:cartChanged', _stickySyncCart);

  // Mobile price block
  const mobilePriceBlock = document.getElementById('pdpMobilePriceBlock');
  if (mobilePriceBlock) {
    mobilePriceBlock.innerHTML = `
      <div class="pdp-section-title">💰 Price</div>
      <div class="pdp-mobile-price-card">
        ${pdf.free
          ? `<span class="pdp-price-free">FREE</span>`
          : price > 0
            ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                 <span class="pdp-price-now">₹${price}</span>
                 ${origPrice > 0 && origPrice > price ? `<span class="pdp-price-was">₹${origPrice}</span>` : ''}
                 ${discount > 0 ? `<span class="pdp-discount-badge">${discount}% OFF</span>` : ''}
               </div>`
            : ''}
        <button class="pdp-buy-primary" style="margin-top:12px" onclick="pdpHandleBuy()">
          ${ownedPaid
            ? '⚡ Open PDF'
            : pdf.free
            ? (_isOwned(String(pdf.id)) ? '⚡ Open PDF' : '⚡ Download Free')
            : price > 0 ? `⚡ Buy Now — ₹${price}` : '⚡ Download Free'}
        </button>
        ${(pdf.free || price === 0 || (window.Cart && Cart.has(pdf.id)) || (typeof _isOwned === 'function' && _isOwned(String(pdf.id)))) ? '' : `<button class="pdp-cart-secondary" style="margin-top:10px" data-pdp-cart-btn onclick="pdpAddToCart()">🛒 Add to Cart</button>`}
      </div>`;
  }

  // Scroll-based sticky bar reveal.
  // ≥1024px: anchor on the desktop buy card (bar shows once it scrolls
  // past the top). <1024px the buy card is display:none (zero rect) — the
  // old code could therefore NEVER show the bar on phones/tablets. On
  // those widths the sticky bar is the ONLY purchase affordance while
  // scrolling, so anchor on the preview gallery: once it has scrolled
  // past, show the bar.
  window._pdpScrollHandler = function() {
    const bar = document.getElementById('pdpStickyBar');
    if (!bar) return;
    let anchor = document.getElementById('pdpBuyCard');
    if (!anchor || anchor.getBoundingClientRect().height === 0) {
      anchor = document.getElementById('pdpV3Gallery');
    }
    if (!anchor) { bar.classList.add('visible'); return; }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0) bar.classList.add('visible');
    else bar.classList.remove('visible');
  };
  window.removeEventListener('scroll', window._pdpScrollHandler);
  window.addEventListener('scroll', window._pdpScrollHandler, { passive: true });

  // Description expand
  setTimeout(() => {
    const descText = document.getElementById('pdpDescText');
    const btn      = document.getElementById('pdpReadMoreBtn');
    if (descText && btn && descText.scrollHeight <= 100) btn.style.display = 'none';
  }, 50);
}
window._pdpRenderShell = _pdpRenderShell;

/* ═══════════════════════════════════════════════════════════════════════
   PDP TOGGLE DESC
   ═══════════════════════════════════════════════════════════════════════ */
window.pdpToggleDesc = function pdpToggleDesc() {
  const wrap = document.getElementById('pdpDescWrap');
  const btn  = document.getElementById('pdpReadMoreBtn');
  if (!wrap || !btn) return;
  wrap.classList.toggle('expanded');
  btn.textContent = wrap.classList.contains('expanded') ? 'Show Less ↑' : 'Read More ↓';
};

/* ═══════════════════════════════════════════════════════════════════════
   PDP LEAVE PAGE CLEANUP
   ═══════════════════════════════════════════════════════════════════════ */
window._pdpLeavePage = function _pdpLeavePage() {
  if (window._pdpScrollHandler) {
    window.removeEventListener('scroll', window._pdpScrollHandler);
    window._pdpScrollHandler = null;
  }
  if (window._pdpPreviewScrollHandler) {
    window.removeEventListener('scroll', window._pdpPreviewScrollHandler);
    window._pdpPreviewScrollHandler = null;
  }
  if (window._pdpPreviewResizeHandler) {
    window.removeEventListener('resize', window._pdpPreviewResizeHandler);
    window._pdpPreviewResizeHandler = null;
  }
  if (window._pdpPreviewVisibilityHandler) {
    document.removeEventListener('visibilitychange', window._pdpPreviewVisibilityHandler);
    window._pdpPreviewVisibilityHandler = null;
  }
  if (window._pdpZoomCleanup) {
    window._pdpZoomCleanup();
    window._pdpZoomCleanup = null;
  }
  if (window._pdpRealtimeSubs) {
    window._pdpRealtimeSubs.forEach(sub => { try { sub.unsubscribe(); } catch(e) {} });
    window._pdpRealtimeSubs = [];
  }
  const bar = document.getElementById('pdpStickyBar');
  if (bar) bar.classList.remove('visible');
  document.body.style.top = '';
};

// Also expose the starSVG helpers for review rendering
window._starSVG = _starSVG;
window._starsHTML = _starsHTML;


})();

/* ═══════════════════════════════════════════════════════════════════════
   PDP PREVIEW HELPERS — PDF.js page rendering (kept from original)
   ═══════════════════════════════════════════════════════════════════════ */

function _pdpParsePreviewPages(spec, totalPages) {
  if (!spec || !String(spec).trim()) {
    // No restriction — all pages allowed
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const s = String(spec).trim();
  const allowed = new Set();
  // Support: "1-3" range and/or "1,2,5" list, mixed: "1-3,5,7"
  s.split(',').forEach(part => {
    part = part.trim();
    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const from = parseInt(range[1], 10);
      const to   = Math.min(parseInt(range[2], 10), totalPages);
      for (let p = from; p <= to; p++) {
        if (p >= 1 && p <= totalPages) allowed.add(p);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n) && n >= 1 && n <= totalPages) allowed.add(n);
    }
  });
  return allowed.size ? [...allowed].sort((a, b) => a - b) : Array.from({ length: totalPages }, (_, i) => i + 1);
}

/* Get watermark string for this session */
function _pdpWatermarkText() {
  const user = window.currentUser;
  if (user) {
    const email = (user.email || '').split('@')[0].slice(0, 12);
    return 'studyria.in · ' + email;
  }
  return 'studyria.in · Preview Only';
}

/* Render PDF page to canvas → dataURL (NEVER exposes the original PDF URL) */
async function _pdpRenderPageToDataURL(pdfDoc, pageNum, scale) {
  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: scale || 1.8 });
  const canvas   = document.createElement('canvas');
  canvas.width   = Math.ceil(viewport.width);
  canvas.height  = Math.ceil(viewport.height);
  const ctx      = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  // ── Burn watermark into the canvas (content protection) ──────────────
  const wm = _pdpWatermarkText();
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle   = '#1a1a2e';
  ctx.font        = `bold ${Math.max(14, canvas.width * 0.04)}px Arial, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  // Diagonal repeating pattern
  const step = canvas.width * 0.45;
  for (let x = -canvas.width; x < canvas.width * 2; x += step) {
    for (let y = -canvas.height; y < canvas.height * 2; y += step * 0.6) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(wm, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.88);
}

/* Render a small thumbnail for the strip */
async function _pdpRenderThumb(pdfDoc, pageNum) {
  return _pdpRenderPageToDataURL(pdfDoc, pageNum, 0.4);
}


/* ═══════════════════════════════════════════════════════════════════════
   V2 SCROLL-DRIVEN PREVIEW — REMOVED (2026-09-05)
   The entire scroll-driven sticky preview (pdpPreviewTrack / sticky stage /
   scroll+resize handlers / visualViewport sizing) was the original auto-zoom
   bug mechanism. It has been fully deleted — the V3 gallery
   (pdp-v3.js) is the only preview engine: click-driven thumbnails,
   CSS-contained stage (aspect-ratio + overflow:hidden + object-fit:contain),
   no scroll listeners, no viewport mutation. Stubs kept for compatibility.
   ═══════════════════════════════════════════════════════════════════════ */
window.pdpInitPreview = async function pdpInitPreview(pdf) {
  // V3 gallery owns previews. On static pages without pdp-v3.js this is a
  // harmless no-op (no preview-track elements exist).
  if (document.getElementById('pdpV3Gallery')) return;
  const track = document.getElementById('pdpPreviewTrack');
  if (!track) return; // nothing to drive — and nothing scroll-driven exists
};

