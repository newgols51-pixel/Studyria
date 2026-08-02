/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDF CHECKOUT PAGE V2 (Secure UI Upgrade)
   Modular JS for the Product Detail Page (PDP)

   This file REPLACES the inline PDP JS from index.html.
   All function signatures match the old ones so app.js, supabase.js,
   and all other modules keep working unchanged.

   V2.1 — 2026-08-03 — Root cause fix: removed pdpInitPreview call + preview-track HTML
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
   PDP ZOOM CONTROL V2
   • Resets browser zoom to 100% when PDP opens
   • Blocks double-tap auto-zoom on cover (touch-action: manipulation)
   • Blocks accidental pinch-zoom on the page
   • Cover image NEVER zooms — pointer-events:none on img
   • Only the dedicated zoom overlay (pdpZoomCover) allows zoom
   ═══════════════════════════════════════════════════════════════════════ */
function _pdpInstallZoomControl() {
  if (window._pdpZoomCleanup) {
    window._pdpZoomCleanup();
    window._pdpZoomCleanup = null;
  }

  // V2: Use touch-action: manipulation on cover wrap to natively
  // disable double-tap zoom without any JS handler needed.
  // This is the cleanest, most reliable approach — no custom
  // double-tap detection, no timing hacks, no transform toggling.
  const coverWrap = document.querySelector('.pdp-cover-wrap');
  if (coverWrap) {
    coverWrap.style.touchAction = 'manipulation';
  }

  // V2: Also ensure the viewport meta stays locked on PDP
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) {
    const current = vp.getAttribute('content') || '';
    if (!current.includes('maximum-scale')) {
      vp.setAttribute('content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
  }

  window._pdpZoomCleanup = function() {
    if (coverWrap) {
      coverWrap.style.touchAction = 'pan-y';
    }
  };
}
window._pdpInstallZoomControl = _pdpInstallZoomControl;

/* ═══════════════════════════════════════════════════════════════════════
   PDP RESET PAGE ZOOM (kept compatible with old calls)
   ═══════════════════════════════════════════════════════════════════════ */
function _pdpResetPageZoom() {
  const vv = window.visualViewport;
  if (vv && vv.scale && vv.scale > 1.02) {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    const base = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    vp.setAttribute('content', base + ', shrink-to-fit=yes');
    requestAnimationFrame(() => vp.setAttribute('content', base));
  }
}
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
  _pdpRenderShell(pdf);
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
  const coverFrom = pdf.coverFrom || '#1d4ed8';
  const coverTo   = pdf.coverTo   || '#3d8ef8';

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
                ${pdf.free || price === 0
                  ? (_isOwned(String(pdf.id)) ? '⚡ Open PDF' : '⚡ Download Free Now')
                  : `⚡ Buy Now – ₹${price}`}
              </button>
            </div>
          </div>

        </div><!-- /pdp-left -->

        <!-- ═══ RIGHT: Buy Card (desktop only) ═══ -->
        <div class="pdp-right">
          <div class="pdp-buy-card" id="pdpBuyCard">
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
              ${pdf.free
                ? _isOwned(String(pdf.id))
                  ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`
                  : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Free`
                : price > 0
                  ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>Buy Now — ₹${price}`
                  : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>Get Access`}
            </button>

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
  if (stickyTitle) stickyTitle.textContent = (pdf.title||'').slice(0,40) + ((pdf.title||'').length > 40 ? '…' : '');
  if (stickyPrice) stickyPrice.textContent = pdf.free ? 'FREE' : (price > 0 ? `₹${price}` : 'FREE');
  const _pdfOwned = pdf.free && _isOwned(String(pdf.id));
  if (stickyBuy)   stickyBuy.textContent   = _pdfOwned ? '⚡ Open PDF' : (pdf.free ? '⚡ Download Free' : (price > 0 ? `⚡ Buy ₹${price}` : '⚡ Download Free'));
  if (stickyBar)   stickyBar.style.display = '';

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
          ${pdf.free
            ? (_isOwned(String(pdf.id)) ? '⚡ Open PDF' : '⚡ Download Free')
            : price > 0 ? `⚡ Buy Now — ₹${price}` : '⚡ Download Free'}
        </button>
      </div>`;
  }

  // Scroll-based sticky bar reveal
  window._pdpScrollHandler = function() {
    const bar     = document.getElementById('pdpStickyBar');
    const buyCard = document.getElementById('pdpBuyCard');
    if (!bar) return;
    if (!buyCard) { bar.classList.add('visible'); return; }
    const rect = buyCard.getBoundingClientRect();
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
   PDP CLEAR ZOOM LOCK
   ═══════════════════════════════════════════════════════════════════════ */
function _pdpClearZoomLock() {
  document.body.classList.remove('pdp-zoom-lock');
}
window._pdpClearZoomLock = _pdpClearZoomLock;

/* ═══════════════════════════════════════════════════════════════════════
   PDP ZOOM COVER — full-screen cover zoom with pinch/pan
   (Unchanged from original — works perfectly)
   ═══════════════════════════════════════════════════════════════════════ */
window.pdpZoomCover = function pdpZoomCover() {
  const pdf = window.selectedPdf;
  if (!pdf || !pdf.coverImage) { if (typeof showToast === 'function') showToast('No cover image to zoom.', 'info'); return; }

  _pdpClearZoomLock();
  document.body.classList.add('pdp-zoom-lock');

  const overlay = document.createElement('div');
  overlay.className = 'pdp-zoom-overlay';
  overlay.innerHTML = `
    <div class="pdp-zoom-bg"></div>
    <button class="pdp-zoom-close" aria-label="Close preview">✕</button>
    <div class="pdp-zoom-content">
      <img src="${pdf.coverImage}" alt="${_esc(pdf.title || 'PDF cover')}" class="pdp-zoom-img" loading="lazy" decoding="async" draggable="false">
    </div>`;
  document.body.appendChild(overlay);

  const img = overlay.querySelector('.pdp-zoom-img');
  const content = overlay.querySelector('.pdp-zoom-content');
  const bg = overlay.querySelector('.pdp-zoom-bg');
  const closeBtn = overlay.querySelector('.pdp-zoom-close');

  let closed = false;
  function closeZoom() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.classList.add('pdp-zoom-closing');
    setTimeout(() => overlay.remove(), 150);
    document.body.classList.remove('pdp-zoom-lock');
  }
  function onKeyDown(e) { if (e.key === 'Escape') closeZoom(); }
  document.addEventListener('keydown', onKeyDown);
  bg.addEventListener('click', closeZoom);
  closeBtn.addEventListener('click', closeZoom);

  let scale = 1, lastScale = 1;
  let originX = 0, originY = 0, panStartX = 0, panStartY = 0;
  let startDist = 0, isPanning = false, lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  function clampScale(s) { return Math.min(Math.max(s, 1), 4); }
  function clampPan() {
    const maxOffsetX = (img.clientWidth * (scale - 1)) / 2 + 40;
    const maxOffsetY = (img.clientHeight * (scale - 1)) / 2 + 40;
    originX = Math.min(Math.max(originX, -maxOffsetX), maxOffsetX);
    originY = Math.min(Math.max(originY, -maxOffsetY), maxOffsetY);
  }
  function setTransform(animated) {
    img.style.transition = animated ? 'transform .25s ease' : 'none';
    img.style.transform = `translate(${originX}px, ${originY}px) scale(${scale})`;
    if (animated) setTimeout(() => { img.style.transition = ''; }, 260);
  }
  function resetZoom(animated) { scale = 1; originX = 0; originY = 0; setTransform(animated); }
  function toggleZoomAt(clientX, clientY) {
    if (scale > 1) { resetZoom(true); }
    else {
      const rect = img.getBoundingClientRect();
      scale = 2.5;
      originX = (rect.width / 2 - (clientX - rect.left)) * (scale - 1) / scale;
      originY = (rect.height / 2 - (clientY - rect.top)) * (scale - 1) / scale;
      clampPan(); setTransform(true);
    }
  }
  function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { startDist = getDistance(e.touches); lastScale = scale; }
    else if (e.touches.length === 1) {
      if (scale > 1) { isPanning = true; panStartX = e.touches[0].clientX - originX; panStartY = e.touches[0].clientY - originY; }
      const now = Date.now();
      const dx = Math.abs(e.touches[0].clientX - lastTapX);
      const dy = Math.abs(e.touches[0].clientY - lastTapY);
      if (now - lastTapTime < 300 && dx < 30 && dy < 30) { toggleZoomAt(e.touches[0].clientX, e.touches[0].clientY); lastTapTime = 0; }
      else { lastTapTime = now; lastTapX = e.touches[0].clientX; lastTapY = e.touches[0].clientY; }
    }
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && startDist) {
      e.preventDefault();
      const dist = getDistance(e.touches);
      scale = clampScale(lastScale * (dist / startDist));
      clampPan(); setTransform(false);
    } else if (e.touches.length === 1 && isPanning && scale > 1) {
      e.preventDefault();
      originX = e.touches[0].clientX - panStartX;
      originY = e.touches[0].clientY - panStartY;
      clampPan(); setTransform(false);
    }
  }, { passive: false });

  content.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) startDist = 0;
    if (e.touches.length === 0) { isPanning = false; if (scale <= 1) resetZoom(false); }
  });

  img.addEventListener('dblclick', (e) => toggleZoomAt(e.clientX, e.clientY));
  content.addEventListener('wheel', (e) => {
    e.preventDefault();
    const prevScale = scale;
    scale = clampScale(scale + (e.deltaY < 0 ? 0.25 : -0.25));
    if (scale === 1) { originX = 0; originY = 0; }
    else if (prevScale !== scale) clampPan();
    setTransform(false);
  }, { passive: false });
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
  document.body.classList.remove('pdp-zoom-lock');
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


async function pdpInitPreview(pdf) {
  // V3 guard: if V3 gallery is active, this V2 function should not run
  if (document.getElementById('pdpV3Gallery')) {
    console.log('[PDP V2] Skipping V2 pdpInitPreview — V3 gallery is active');
    return;
  }
  const track     = document.getElementById('pdpPreviewTrack');
  const stickyEl  = document.getElementById('pdpPreviewSticky');
  const img       = document.getElementById('pdpPreviewImg');
  const loading   = document.getElementById('pdpPreviewLoading');
  const indicator = document.getElementById('pdpPreviewPageIndicator');
  if (!track || !img) return;

  // ── Tear down previous session listeners ───────────────────────────────
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

  track.classList.remove('active');
  img.classList.remove('loaded');
  img.removeAttribute('src');
  if (loading) loading.style.display = '';
  if (indicator) indicator.textContent = '';

  // Remove previous thumbnail strip if any
  const oldStrip = document.getElementById('pdpThumbStrip');
  if (oldStrip) oldStrip.remove();

  const previewUrl = (pdf.previewPdfUrl || pdf.preview_pdf_url || '').trim();
  if (!previewUrl) return;

  if (!window.pdfjsLib) {
    console.warn('pdpInitPreview: pdf.js not available');
    return;
  }

  // ── Load PDF document ────────────────────────────────────────────────
  // Use withCredentials:false + no CORS header exposure (the URL is only
  // used inside pdf.js worker — never injected into DOM as an <a> or src)
  let pdfDoc, numPages = 0;
  try {
    pdfDoc = await window.pdfjsLib.getDocument({
      url: previewUrl,
      withCredentials: false,
      disableAutoFetch: false,
      disableStream: false,
    }).promise;
    numPages = pdfDoc.numPages || 0;
  } catch (e) {
    console.warn('pdpInitPreview: load failed', e);
    return;
  }
  if (!numPages) return;
  if (!document.getElementById('pdpPreviewTrack')) return; // navigated away

  // ── Determine allowed pages (admin restriction) ──────────────────────
  const previewPageSpec = pdf.preview_pages || pdf.previewPages || pdf.preview || null;
  // If spec is a text description (not a page range), allow all pages
  const looksLikeSpec  = previewPageSpec && /^\d/.test(String(previewPageSpec).trim());
  const allowedPages   = looksLikeSpec
    ? _pdpParsePreviewPages(previewPageSpec, numPages)
    : Array.from({ length: Math.min(numPages, 3) }, (_, i) => i + 1);
  // Clamp to actual page count
  const safePages = allowedPages.filter(p => p >= 1 && p <= numPages);
  if (!safePages.length) return;

  track.classList.add('active');

  // ── Page cache & render ───────────────────────────────────────────────
  const pageCache  = {};
  const thumbCache = {};
  const renderQ    = {};
  const thumbQ     = {};
  let   activePageIdx = 0; // index into safePages[]

  async function renderPage(pageNum) {
    if (pageCache[pageNum]) return pageCache[pageNum];
    if (renderQ[pageNum])   return renderQ[pageNum];
    renderQ[pageNum] = _pdpRenderPageToDataURL(pdfDoc, pageNum, 1.8).then(url => {
      pageCache[pageNum] = url;
      delete renderQ[pageNum];
      return url;
    }).catch(e => { delete renderQ[pageNum]; throw e; });
    return renderQ[pageNum];
  }

  async function renderThumb(pageNum) {
    if (thumbCache[pageNum]) return thumbCache[pageNum];
    if (thumbQ[pageNum])     return thumbQ[pageNum];
    thumbQ[pageNum] = _pdpRenderPageToDataURL(pdfDoc, pageNum, 0.35).then(url => {
      thumbCache[pageNum] = url;
      delete thumbQ[pageNum];
      return url;
    }).catch(e => { delete thumbQ[pageNum]; throw e; });
    return thumbQ[pageNum];
  }

  // ── Show a specific page (by index into safePages) ───────────────────
  async function showPageAtIndex(idx) {
    idx = Math.max(0, Math.min(safePages.length - 1, idx));
    if (idx === activePageIdx && img.classList.contains('loaded')) return;
    activePageIdx = idx;
    const pageNum = safePages[idx];

    // Update indicator
    if (indicator) indicator.textContent = `Page ${pageNum} of ${safePages.length} preview pages`;

    // Update thumb strip highlight
    const stripEl = document.getElementById('pdpThumbStrip');
    if (stripEl) {
      stripEl.querySelectorAll('.pdp-thumb-item').forEach((el, i) => {
        el.classList.toggle('pdp-thumb-active', i === idx);
      });
    }

    // Show loading
    if (loading) loading.style.display = '';
    img.classList.remove('loaded');

    try {
      const url = await renderPage(pageNum);
      if (activePageIdx !== idx) return; // race: user switched before this resolved
      img.src = url;
      img.classList.add('loaded');
      if (loading) loading.style.display = 'none';
    } catch (e) {
      console.warn('pdpInitPreview: render failed for page', pageNum, e);
    }

    // Pre-warm adjacent pages
    if (idx + 1 < safePages.length) renderPage(safePages[idx + 1]).catch(() => {});
    if (idx - 1 >= 0)               renderPage(safePages[idx - 1]).catch(() => {});
  }

  // ── Build thumbnail strip ─────────────────────────────────────────────
  function buildThumbStrip() {
    const stage = document.getElementById('pdpPreviewStage');
    if (!stage) return;

    const strip = document.createElement('div');
    strip.id        = 'pdpThumbStrip';
    strip.className = 'pdp-thumb-strip';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Preview pages');

    safePages.forEach((pageNum, idx) => {
      const item = document.createElement('button');
      item.className   = 'pdp-thumb-item' + (idx === 0 ? ' pdp-thumb-active' : '');
      item.type        = 'button';
      item.title       = 'Page ' + pageNum;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-label', 'Preview page ' + pageNum);
      item.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');

      // Placeholder while thumb renders
      item.innerHTML = '<div class="pdp-thumb-placeholder"><span>' + pageNum + '</span></div>';

      item.addEventListener('click', () => {
        showPageAtIndex(idx);
      });

      strip.appendChild(item);

      // Async load thumbnail into the button
      renderThumb(pageNum).then(url => {
        if (!document.getElementById('pdpThumbStrip')) return; // navigated away
        const img2 = document.createElement('img');
        img2.src             = url;
        img2.alt             = 'Page ' + pageNum;
        img2.draggable       = false;
        img2.style.width     = '100%';
        img2.style.height    = '100%';
        img2.style.objectFit = 'cover';
        img2.style.borderRadius = '4px';
        // Content protection on thumb
        img2.addEventListener('contextmenu', e => e.preventDefault());
        img2.addEventListener('dragstart',   e => e.preventDefault());
        item.innerHTML = '';
        item.appendChild(img2);
      }).catch(() => {});
    });

    // Insert strip BELOW the sticky viewer
    const sticky = document.getElementById('pdpPreviewSticky');
    if (sticky && sticky.parentNode) {
      sticky.parentNode.insertBefore(strip, sticky.nextSibling);
    } else {
      track.appendChild(strip);
    }
  }

  // ── Content protection on main viewer ────────────────────────────────
  function applyContentProtection() {
    const stage = document.getElementById('pdpPreviewStage');
    if (!stage) return;

    // Disable right-click
    stage.addEventListener('contextmenu', e => e.preventDefault());
    // Disable drag
    stage.addEventListener('dragstart',   e => e.preventDefault());
    // Disable text selection
    stage.style.userSelect       = 'none';
    stage.style.webkitUserSelect = 'none';
    // Disable long-press save on iOS (prevents callout menu)
    stage.style.webkitTouchCallout = 'none';
    // Disable image dragging
    img.setAttribute('draggable', 'false');
    img.addEventListener('contextmenu', e => e.preventDefault());
    img.addEventListener('dragstart',   e => e.preventDefault());
    // Block common dev shortcuts on the preview area (best-effort)
    stage.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && ['s','u','p','a'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    }, true);
  }

  // ── Blur on tab switch ────────────────────────────────────────────────
  function onVisibilityChange() {
    const stage = document.getElementById('pdpPreviewStage');
    if (!stage) return;
    if (document.hidden) {
      stage.style.filter = 'blur(12px)';
      stage.style.transition = 'filter 0.1s';
    } else {
      stage.style.filter = '';
    }
  }
  window._pdpPreviewVisibilityHandler = onVisibilityChange;
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── Scroll-driven page switching (unchanged logic — drives by index) ──
  function stableViewportHeight() {
    return (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  }
  function sizeTrack() {
    // Height: each allowed page gets one scroll slot
    track.style.height = (safePages.length * stableViewportHeight() * 0.9) + 'px';
  }
  sizeTrack();

  function computeIdxFromScroll() {
    const rect         = track.getBoundingClientRect();
    const stickyHeight = stickyEl ? stickyEl.offsetHeight : window.innerHeight;
    const scrollable   = rect.height - stickyHeight;
    if (scrollable <= 0) return 0;
    const progress = Math.max(0, Math.min(1, -rect.top / scrollable));
    return Math.min(safePages.length - 1, Math.floor(progress * safePages.length));
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      showPageAtIndex(computeIdxFromScroll());
      ticking = false;
    });
  }

  let resizeTicking = false;
  let lastKnownWidth = window.innerWidth;
  function onResize() {
    if (resizeTicking) return;
    resizeTicking = true;
    requestAnimationFrame(() => {
      const cw = window.innerWidth;
      if (cw !== lastKnownWidth) {
        lastKnownWidth = cw;
        sizeTrack();
        showPageAtIndex(computeIdxFromScroll());
      }
      resizeTicking = false;
    });
  }

  window._pdpPreviewScrollHandler = onScroll;
  window._pdpPreviewResizeHandler = onResize;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  // ── Initialise ────────────────────────────────────────────────────────
  buildThumbStrip();
  applyContentProtection();
  showPageAtIndex(0);
  onScroll();
}

// ── Fetch all live counters + reviews from Supabase in one parallel pass ──

window.pdpInitPreview = pdpInitPreview;
window._pdpParsePreviewPages = _pdpParsePreviewPages;
window._pdpWatermarkText = _pdpWatermarkText;
window._pdpRenderPageToDataURL = _pdpRenderPageToDataURL;
window._pdpRenderThumb = _pdpRenderThumb;

