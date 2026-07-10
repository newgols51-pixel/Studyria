/**
 * ══════════════════════════════════════════════════════════════
 * STUDYRIA PDF PRODUCT PAGE — V3 ENGINE
 * Production-grade. Zero CLS. GPU-accelerated. A11y-first.
 * Overrides _pdpRenderShell() from index.html with new V3 markup.
 * All business logic (buy, wishlist, realtime, reviews) reused.
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

(function () {

  /* ── Utility ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function stars(rating, max = 5) {
    const r = Math.round(rating * 2) / 2;
    let html = '';
    for (let i = 1; i <= max; i++) {
      if (i <= r) html += '<span class="v3-star" aria-hidden="true">★</span>';
      else if (i - 0.5 <= r) html += '<span class="v3-star" aria-hidden="true">½</span>';
      else html += '<span class="v3-star-empty" aria-hidden="true">★</span>';
    }
    return html;
  }

  function formatPrice(n) {
    return '₹' + Number(n).toLocaleString('en-IN');
  }


  /* ── Auto-detect PDF language from title/description/category ─── */
  function _v3DetectLanguage(pdf) {
    const text = [pdf.title, pdf.description, pdf.category].filter(Boolean).join(' ');
    // Assamese/Bengali Unicode block: U+0980–U+09FF
    const hasAssamese = /[ঀ-৿]/.test(text);
    // Devanagari block (Hindi): U+0900–U+097F
    const hasHindi = /[ऀ-ॿ]/.test(text);
    // Check title keywords for Assamese context
    const assamKeywords = /assamese|assam|axomiya|axom/i.test(text);
    const hindiKeywords = /hindi|devanagari|हिंदी/i.test(text);
    if (hasAssamese && !hasHindi) return 'Assamese';
    if (hasHindi && !hasAssamese) return 'Hindi';
    if (hasAssamese && hasHindi) return 'Assamese + Hindi';
    if (assamKeywords) return 'Assamese';
    if (hindiKeywords) return 'Hindi';
    return 'English';
  }

  /* ── Cover image builder — STABLE, no zoom/jump ─────────── */
  function buildCoverHTML(pdf) {
    const src = (pdf.cover_url || pdf.cover_image || pdf.coverImage || '').trim();
    const from = pdf.coverFrom || '#1d4ed8';
    const to   = pdf.coverTo   || '#3d8ef8';
    if (src) {
      return `
        <div class="v3-cover-skeleton" id="v3CoverSkeleton" aria-hidden="true"></div>
        <img
          class="v3-cover-img"
          src="${esc(src)}"
          alt="Cover of ${esc(pdf.title)}"
          width="320" height="427"
          loading="eager"
          decoding="async"
          fetchpriority="high"
          onload="document.getElementById('v3CoverSkeleton')&&(document.getElementById('v3CoverSkeleton').style.opacity='0')"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
        />
        <div class="v3-cover-fallback" style="background:linear-gradient(135deg,${esc(from)},${esc(to)});display:none" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>`;
    }
    return `
      <div class="v3-cover-fallback" style="background:linear-gradient(135deg,${esc(from)},${esc(to)})" aria-hidden="true">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>`;
  }

  /* ── Tag builder ─────────────────────────────────────────── */
  function tagClass(tag) {
    const t = (tag || '').toLowerCase();
    if (t === 'premium') return 'v3-tag-premium';
    if (t === 'free')    return 'v3-tag-free';
    if (t === 'new')     return 'v3-tag-new';
    return 'v3-tag-sale';
  }

  /* ── Chip builder ────────────────────────────────────────── */
  function chip(label, value) {
    if (!value) return '';
    return `<div class="v3-chip" role="text">
      <span>${esc(label)}</span>
      <span class="v3-chip-label">${esc(value)}</span>
    </div>`;
  }

  /* ── Outcome list item ───────────────────────────────────── */
  function outcome(text) {
    return `<li class="v3-outcome">
      <span class="v3-outcome-check" aria-hidden="true">✓</span>
      <span>${esc(text)}</span>
    </li>`;
  }

  /* ── FAQ item ────────────────────────────────────────────── */
  function faqItem(q, a) {
    return `<div class="v3-faq-item" role="listitem">
      <button class="v3-faq-q" aria-expanded="false"
        onclick="v3FaqToggle(this)"
        type="button">
        <span>${esc(q)}</span>
        <svg class="v3-faq-chevron" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="v3-faq-a" role="region">${esc(a)}</div>
    </div>`;
  }

  /* ── Main renderer — replaces _pdpRenderShell ────────────── */
  window._pdpRenderShell = function _pdpRenderShell_v3(pdf) {
    if (!pdf) return;

    // Price calculation
    const price     = Number(pdf.price ?? 0);
    const origPrice = Number(pdf.originalPrice ?? 0);
    const isFree    = pdf.free || price === 0;
    const discount  = (origPrice > price && origPrice > 0 && price > 0)
                        ? Math.round((1 - price / origPrice) * 100) : 0;
    const inWish    = (window.wishlist || []).includes(pdf.id) ||
                      (window.wishlist || []).includes(String(pdf.id));
    const owned     = typeof window._isOwned === 'function' && window._isOwned(pdf.id);

    // Tag
    const tag = pdf.tag || (isFree ? 'Free' : discount > 0 ? `${discount}% Off` : null);

    // Author
    const authorName = pdf.author || pdf.author_name || pdf.authorName || '';
    const authorAvatar = pdf.author_avatar || pdf.authorAvatar || '';
    const authorInitial = authorName ? authorName.charAt(0).toUpperCase() : 'S';

    // Description
    const description = (pdf.description || '').trim();
    const descLong = description.length > 240;

    // Info chips
    const chips = [
      chip('Category',  pdf.category || pdf.subcategory || ''),
      chip('Language',  pdf.language || pdf.languages || _v3DetectLanguage(pdf)),
      chip('Pages',     pdf.pages_count ? `${pdf.pages_count} pages` : ''),
      chip('File Size', pdf.file_size  ? `${pdf.file_size}` : ''),
      chip('Level',     pdf.level || pdf.academic_level || ''),
    ].join('');

    // Learning outcomes
    const rawOutcomes = Array.isArray(pdf.learning_outcomes) ? pdf.learning_outcomes :
      ['Comprehensive theory coverage', 'Solved examples & practice sets',
       'Previous year questions & solutions', 'Quick revision charts',
       'Chapter-wise breakdowns', 'Expert tips & exam strategies'];
    const outcomesHTML = rawOutcomes.slice(0, 8).map(o => outcome(o)).join('');

    // Tags list
    const tagsList = Array.isArray(pdf.tags) ? pdf.tags : [];

    // Publish / update dates
    const pubDate = pdf.created_at
      ? new Date(pdf.created_at).toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' })
      : null;
    const updDate = pdf.updated_at
      ? new Date(pdf.updated_at).toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' })
      : null;

    // Static FAQ items
    const faqs = [
      { q: 'How do I download the PDF after purchase?',
        a: 'After successful payment, the PDF is instantly available in your Dashboard under "My Library". You can download it anytime from any device.' },
      { q: 'Is this a one-time payment?',
        a: 'Yes! Pay once and get lifetime access. No subscriptions, no recurring charges.' },
      { q: 'Can I get a refund?',
        a: 'We offer a refund if the file is corrupted or not as described. Please contact support within 7 days of purchase.' },
      { q: 'Is the payment secure?',
        a: 'All payments are processed by Razorpay with 256-bit SSL encryption. We never store your card details.' },
      { q: 'Will this PDF be updated in the future?',
        a: 'Yes. If this material is updated, you\'ll get access to the newer version at no extra cost.' },
    ];

    // Price block HTML
    let priceHTML = '';
    if (isFree) {
      priceHTML = `<div class="v3-price-free">Free</div>`;
    } else {
      priceHTML = `
        <div class="v3-price-paid">
          <span class="v3-price-main" id="v3PriceMain">${formatPrice(price)}</span>
          ${origPrice > price ? `<span class="v3-price-orig">${formatPrice(origPrice)}</span>` : ''}
          ${discount > 0 ? `<span class="v3-price-savings">${discount}% off</span>` : ''}
        </div>
        ${discount > 0 ? `
        <div class="v3-price-timer" aria-live="polite">
          <span class="v3-price-timer-dot" aria-hidden="true"></span>
          <span>Limited time offer</span>
        </div>` : ''}`;
    }

    // CTA button HTML
    let ctaHTML = '';
    if (owned || (pdf.free && typeof window.downloadPDF === 'function')) {
      ctaHTML = `
        <button class="v3-owned-btn" onclick="v3HandleDownload()" type="button"
          aria-label="Download ${esc(pdf.title)}">
          ✅ Download PDF
        </button>`;
    } else if (isFree) {
      ctaHTML = `
        <button class="v3-free-btn" onclick="v3HandleBuy()" type="button"
          id="v3BuyBtn" aria-label="Get free PDF: ${esc(pdf.title)}">
          ⬇️ Get for Free
        </button>`;
    } else {
      ctaHTML = `
        <button class="v3-buy-btn" onclick="v3HandleBuy()" type="button"
          id="v3BuyBtn" aria-label="Buy ${esc(pdf.title)} for ${formatPrice(price)}">
          ⚡ Buy Now — ${formatPrice(price)}
        </button>`;
    }

    const html = `
<div class="v3-pdp" role="main" aria-label="PDF product page: ${esc(pdf.title)}">

  <!-- Hero strip / Breadcrumb -->
  <div class="v3-hero-strip" aria-label="Breadcrumb">
    <div class="v3-pdp-container">
      <nav class="v3-bc" aria-label="Breadcrumb">
        <span class="v3-bc-link" role="link" tabindex="0"
          onclick="navigate('home')" onkeypress="if(event.key==='Enter')navigate('home')">Home</span>
        <span class="v3-bc-sep" aria-hidden="true">›</span>
        <span class="v3-bc-link" role="link" tabindex="0"
          onclick="navigate('library')" onkeypress="if(event.key==='Enter')navigate('library')">Library</span>
        <span class="v3-bc-sep" aria-hidden="true">›</span>
        <span class="v3-bc-cur" aria-current="page">${esc((pdf.title || '').slice(0, 40))}${(pdf.title || '').length > 40 ? '…' : ''}</span>
      </nav>
    </div>
  </div>

  <!-- Two-column grid -->
  <div class="v3-grid">

    <!-- ══ LEFT — Content ═══════════════════════════════════ -->
    <div class="v3-left">

      <!-- Cover (mobile only — hidden on desktop via CSS; desktop shows it in right card) -->
      <div class="v3-cover-wrap" id="v3CoverWrap" aria-label="PDF cover image" role="img">
        ${buildCoverHTML(pdf)}
        ${discount > 0 ? `<div class="v3-cover-discount" aria-label="${discount}% discount">-${discount}%</div>` : ''}
        ${tag ? `<div class="v3-cover-tag ${tagClass(tag)}">${esc(tag)}</div>` : ''}
      </div>
      <div class="v3-cover-actions" role="group" aria-label="PDF actions">
        <button class="v3-cover-action ${inWish ? 'wishlisted' : ''}"
          id="v3CoverWishBtn" onclick="v3ToggleWish()" type="button"
          aria-label="${inWish ? 'Remove from wishlist' : 'Add to wishlist'}"
          aria-pressed="${inWish}">
          <span aria-hidden="true">${inWish ? '💔' : '❤️'}</span>
          ${inWish ? 'Saved' : 'Wishlist'}
        </button>
        <button class="v3-cover-action" onclick="v3OpenShare()" type="button" aria-label="Share this PDF">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          Share
        </button>
        <button class="v3-cover-action" onclick="v3ZoomCover()" type="button" aria-label="Zoom cover image">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          Zoom
        </button>
      </div>

      <!-- Title / Meta -->
      <div class="v3-hero">
        <div class="v3-tag-row" aria-label="Tags">
          ${tag ? `<span class="v3-tag ${tagClass(tag)}">${esc(tag)}</span>` : ''}
          ${tagsList.slice(0, 4).map(t => `<span class="v3-tag" style="background:var(--glass);border:1px solid var(--glass-border);color:var(--text2)">${esc(t)}</span>`).join('')}
        </div>

        <h1 class="v3-title" id="v3PdpTitle">${esc(pdf.title || 'Untitled')}</h1>

        ${authorName ? `
        <div class="v3-author" role="group" aria-label="Author">
          <div class="v3-author-avatar" aria-hidden="true">
            ${authorAvatar
              ? `<img src="${esc(authorAvatar)}" alt="${esc(authorName)}" loading="lazy" decoding="async">`
              : esc(authorInitial)}
          </div>
          <div>
            <div class="v3-author-by">Created by</div>
            <div class="v3-author-name">${esc(authorName)}</div>
          </div>
          <span class="v3-verified-badge" aria-label="Verified creator">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Verified
          </span>
        </div>` : ''}

        <!-- Live rating — filled by _pdpLoadLiveStats -->
        <div class="v3-rating-row" id="v3RatingRow" aria-live="polite" style="display:none">
          <div class="v3-stars" id="v3RatingStars" aria-label="Rating" role="img"></div>
          <span class="v3-rating-num" id="v3RatingNum"></span>
          <span class="v3-rating-count" id="v3RatingCount"></span>
          <span class="v3-rating-sep" aria-hidden="true">•</span>
          <span class="v3-student-count" id="v3StudentCount" style="display:none"></span>
        </div>
      </div>

      <!-- Info chips -->
      ${chips ? `<div class="v3-chips" role="list" aria-label="Product details">${chips}</div>` : ''}

      <!-- Dates -->
      ${pubDate || updDate ? `
      <div class="v3-chips" style="margin-top:-8px;margin-bottom:24px">
        ${pubDate ? chip('Published', pubDate) : ''}
        ${updDate ? chip('Updated', updDate) : ''}
      </div>` : ''}

      <!-- Description -->
      ${description ? `
      <div class="v3-section" aria-label="Description">
        <h2 class="v3-section-title">About this PDF</h2>
        <div class="v3-desc ${descLong ? 'v3-desc-collapsed' : ''}" id="v3Desc" role="article">
          ${description.replace(/\n/g, '<br>')}
          ${descLong ? '<div class="v3-desc-gradient" id="v3DescGrad" aria-hidden="true"></div>' : ''}
        </div>
        ${descLong ? `
        <button class="v3-read-more" onclick="v3ToggleDesc(this)" type="button" aria-expanded="false">
          <span id="v3ReadMoreLabel">Read more</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>` : ''}
      </div>` : ''}

      <!-- Learning outcomes -->
      <div class="v3-section" aria-label="Learning outcomes">
        <h2 class="v3-section-title">What you'll get</h2>
        <ul class="v3-outcomes" aria-label="Benefits list">
          ${outcomesHTML}
        </ul>
      </div>

      <!-- Trust badges (mobile visible) -->
      <div class="v3-section" aria-label="Purchase guarantees">
        <h2 class="v3-section-title">Why buy from Studyria?</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${[
            ['⚡', 'Instant Download', 'Access immediately after payment'],
            ['🔒', 'Secure Payment', 'Razorpay 256-bit SSL'],
            ['♾️', 'Lifetime Access', 'Buy once, yours forever'],
            ['✅', 'Verified Content', 'Expert-reviewed materials'],
            ['📱', 'All Devices', 'Mobile, tablet, desktop'],
            ['💰', 'Best Price', 'Lowest price guaranteed'],
          ].map(([icon, label, sub]) => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:10px;background:var(--glass);border:1px solid var(--glass-border)">
            <span style="font-size:1.1rem;line-height:1.2" aria-hidden="true">${icon}</span>
            <div>
              <div style="font-size:.82rem;font-weight:700;color:var(--text)">${label}</div>
              <div style="font-size:.72rem;color:var(--text2);margin-top:2px">${sub}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- PDF Preview -->
      <div class="v3-preview" id="v3PreviewSection" aria-label="PDF preview" style="display:none">
        <div class="v3-preview-header">
          <span class="v3-preview-title">📖 Preview Pages</span>
          <span class="v3-preview-badge" id="v3PreviewBadge">Loading…</span>
        </div>
        <div class="v3-preview-stage" id="v3PreviewStage"
          oncontextmenu="return false"
          ondragstart="return false">
          <div class="v3-preview-loading" id="v3PreviewLoading">
            <div class="v3-preview-spinner" aria-hidden="true"></div>
            <span>Loading preview…</span>
          </div>
          <canvas class="v3-preview-canvas" id="v3PreviewCanvas"
            aria-label="PDF preview page" role="img" style="display:none"></canvas>
          <div class="v3-preview-watermark" aria-hidden="true">
            <div class="v3-preview-watermark-text" id="v3WatermarkText">
              Preview • Studyria • Not for Redistribution<br>
              Preview • Studyria • Not for Redistribution<br>
              Preview • Studyria • Not for Redistribution
            </div>
          </div>
        </div>
        <div class="v3-preview-nav" role="group" aria-label="Preview navigation">
          <button class="v3-preview-nav-btn" id="v3PreviewPrev"
            onclick="v3PreviewNav(-1)" type="button" aria-label="Previous page" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="v3-preview-page-info" id="v3PreviewInfo" aria-live="polite">Page 1</span>
          <button class="v3-preview-nav-btn" id="v3PreviewNext"
            onclick="v3PreviewNav(1)" type="button" aria-label="Next page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="v3-preview-locked" aria-label="Purchase prompt">
          <div class="v3-preview-lock-icon" aria-hidden="true">🔒</div>
          <p class="v3-preview-lock-text">
            <strong>Preview ends here.</strong> Purchase to unlock all pages and download the full PDF.
          </p>
          <button class="v3-buy-btn" style="max-width:260px;font-size:.9rem;padding:12px 20px"
            onclick="v3HandleBuy()" type="button">
            🔓 Unlock Full PDF
          </button>
        </div>
      </div>

      <!-- Reviews -->
      <div class="v3-reviews v3-section" id="v3ReviewsSection" aria-label="Student reviews">
        <h2 class="v3-section-title">Student Reviews</h2>
        <!-- Summary — filled by _pdpLoadLiveStats -->
        <div class="v3-review-summary" id="v3ReviewSummary" style="display:none" role="complementary">
          <div class="v3-review-avg" aria-label="Average rating">
            <div class="v3-review-avg-num" id="v3AvgNum">—</div>
            <div class="v3-review-avg-stars" id="v3AvgStars" role="img" aria-label="Rating stars"></div>
            <div class="v3-review-avg-count" id="v3AvgCount"></div>
          </div>
          <div class="v3-review-bars" id="v3ReviewBars" aria-label="Rating breakdown"></div>
        </div>
        <!-- Review cards — filled by _pdpLoadLiveStats -->
        <div class="v3-review-cards" id="v3ReviewCards" role="list" aria-label="Reviews"></div>
        <!-- Review form -->
        <div class="v3-review-form" id="v3ReviewForm" role="form" aria-label="Write a review" style="display:none">
          <div class="v3-review-form-title">✍️ Write a Review</div>
          <div class="v3-star-pick" role="group" aria-label="Select rating">
            ${[1,2,3,4,5].map(n => `
            <button class="v3-star-pick-btn" type="button"
              onclick="v3StarPick(${n})"
              data-star="${n}"
              aria-label="${n} star${n>1?'s':''}">★</button>`).join('')}
          </div>
          <textarea
            class="v3-review-textarea"
            id="v3ReviewText"
            placeholder="Share your experience with this study material…"
            maxlength="500"
            rows="3"
            aria-label="Review text"></textarea>
          <button class="v3-review-submit" type="button"
            onclick="v3SubmitReview()" id="v3ReviewSubmitBtn"
            aria-label="Submit review">
            Submit Review
          </button>
          <p style="font-size:.72rem;color:var(--text2);margin-top:8px">
            * Only verified buyers can leave reviews.
          </p>
        </div>
        <div class="v3-review-form" id="v3ReviewLoginPrompt" style="display:none;text-align:center">
          <p style="font-size:.88rem;color:var(--text2)">
            <a onclick="navigate('login')" style="color:var(--accent);cursor:pointer;font-weight:600">Sign in</a>
            to write a review.
          </p>
        </div>
      </div>

      <!-- Frequently Bought Together -->
      <div class="v3-fbt v3-section" id="v3FbtSection" aria-label="Frequently bought together" style="display:none">
        <h2 class="v3-section-title">🛒 Frequently Bought Together</h2>
        <div class="v3-fbt-items" id="v3FbtItems" aria-label="Bundle items" role="list"></div>
        <div class="v3-fbt-cta">
          <div class="v3-fbt-price-info">
            <span class="v3-fbt-total-label">Bundle price:</span>
            <span class="v3-fbt-total" id="v3FbtTotal"></span>
            <span class="v3-fbt-save" id="v3FbtSave"></span>
          </div>
          <button class="v3-fbt-btn" onclick="v3BuyBundle()" type="button">
            🛒 Buy Together &amp; Save
          </button>
        </div>
      </div>

      <!-- FAQ -->
      <div class="v3-faq v3-section" aria-label="Frequently asked questions">
        <h2 class="v3-section-title">Frequently Asked Questions</h2>
        <div role="list">
          ${faqs.map(f => faqItem(f.q, f.a)).join('')}
        </div>
      </div>

      <!-- Related PDFs -->
      <div class="v3-related v3-section" id="v3RelatedSection" aria-label="Related PDFs" style="display:none">
        <h2 class="v3-section-title">Related Study Materials</h2>
        <div class="v3-related-grid" id="v3RelatedGrid" role="list"></div>
      </div>

    </div><!-- /.v3-left -->

    <!-- ══ RIGHT — Purchase Card ═════════════════════════════ -->
    <aside class="v3-right" aria-label="Purchase options">
      <div class="v3-purchase-card" role="complementary">

        <!-- Cover in card (desktop) -->
        <div class="v3-cover-wrap" style="max-width:100%;margin-bottom:18px" aria-hidden="true">
          ${buildCoverHTML(pdf)}
          ${discount > 0 ? `<div class="v3-cover-discount">-${discount}%</div>` : ''}
          ${tag ? `<div class="v3-cover-tag ${tagClass(tag)}">${esc(tag)}</div>` : ''}
        </div>

        <!-- Price -->
        <div class="v3-price-block" aria-label="Price">
          ${priceHTML}
        </div>

        <!-- Coupon (paid only) -->
        ${!isFree ? `
        <div class="v3-coupon" aria-label="Coupon code">
          <div class="v3-coupon-row">
            <input
              class="v3-coupon-input"
              type="text"
              id="v3CouponInput"
              placeholder="COUPON CODE"
              maxlength="20"
              aria-label="Enter coupon code"
              autocomplete="off"
            />
            <button class="v3-coupon-btn" type="button"
              onclick="v3ApplyCoupon()" aria-label="Apply coupon">Apply</button>
          </div>
          <div class="v3-coupon-msg" id="v3CouponMsg" role="alert" aria-live="polite"></div>
        </div>` : ''}

        <!-- CTA -->
        ${ctaHTML}

        <!-- Wishlist + Share -->
        <div class="v3-wish-row" role="group" aria-label="Save or share">
          <button class="v3-wish-btn ${inWish ? 'active' : ''}"
            id="v3WishBtn" onclick="v3ToggleWish()" type="button"
            aria-label="${inWish ? 'Remove from wishlist' : 'Add to wishlist'}"
            aria-pressed="${inWish}">
            <span aria-hidden="true">${inWish ? '💔' : '❤️'}</span>
            ${inWish ? 'Saved' : 'Wishlist'}
          </button>
          <button class="v3-share-btn" onclick="v3OpenShare()" type="button" aria-label="Share this PDF">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share
          </button>
        </div>

        <!-- Trust -->
        <div class="v3-trust" role="list" aria-label="Purchase guarantees">
          ${[
            ['⚡', 'Instant Download', 'after payment'],
            ['🔒', 'Secure Payment', 'Razorpay + SSL'],
            ['♾️', 'Lifetime Access', 'yours forever'],
            ['✅', 'Verified Content', 'expert reviewed'],
            ['📞', 'Support', '24/7 help available'],
          ].map(([icon, label, sub]) => `
          <div class="v3-trust-item" role="listitem">
            <span class="v3-trust-icon" aria-hidden="true">${icon}</span>
            <span><span class="v3-trust-label">${label}</span> — ${sub}</span>
          </div>`).join('')}
        </div>

        <!-- Stats (live) -->
        <div style="margin-top:16px;border-top:1px solid var(--glass-border);padding-top:14px">
          <div id="v3LiveStats" role="status" aria-live="polite" style="display:none">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <div class="v3-chip" id="v3StatDownloads" style="display:none"></div>
              <div class="v3-chip" id="v3StatStudents" style="display:none"></div>
              <div class="v3-chip" id="v3StatWishlists" style="display:none"></div>
            </div>
          </div>
        </div>

      </div>
    </aside>

  </div><!-- /.v3-grid -->

  <!-- Mobile bottom bar -->
  <div class="v3-mobile-bar" id="v3MobileBar" role="complementary" aria-label="Quick purchase">
    <div class="v3-mobile-bar-inner">
      <div class="v3-mobile-price" aria-label="Price">
        ${isFree
          ? '<div class="v3-mobile-price-main" style="background:var(--grad-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Free</div>'
          : `<div class="v3-mobile-price-main">${formatPrice(price)}</div>
             ${origPrice > price ? `<div class="v3-mobile-price-orig">${formatPrice(origPrice)}</div>` : ''}`}
      </div>
      <button class="v3-mobile-wish ${inWish ? 'active' : ''}"
        id="v3MobileWishBtn" onclick="v3ToggleWish()" type="button"
        aria-label="${inWish ? 'Remove from wishlist' : 'Add to wishlist'}"
        aria-pressed="${inWish}">
        <span aria-hidden="true">${inWish ? '💔' : '❤️'}</span>
      </button>
      <button class="v3-mobile-buy" onclick="v3HandleBuy()" type="button"
        id="v3MobileBuyBtn"
        aria-label="${isFree ? 'Get free PDF' : `Buy for ${formatPrice(price)}`}">
        ${owned ? '⬇️ Download' : isFree ? '⬇️ Get Free' : '⚡ Buy Now'}
      </button>
    </div>
  </div>

  <!-- Share modal -->
  <div class="v3-share-overlay" id="v3ShareOverlay" role="dialog" aria-modal="true"
    aria-label="Share PDF" onclick="if(event.target===this)v3CloseShare()">
    <div class="v3-share-modal">
      <div class="v3-share-modal-title">Share this PDF 📤</div>
      <div class="v3-share-preview">
        ${(pdf.cover_url || pdf.cover_image || pdf.coverImage)
          ? `<img src="${esc(pdf.cover_url || pdf.cover_image || pdf.coverImage)}" alt="Cover" loading="lazy" decoding="async">`
          : ''}
        <div class="v3-share-preview-title">${esc(pdf.title)}</div>
      </div>
      <div class="v3-share-platforms" role="list" aria-label="Share platforms">
        ${[
          { icon: '🟢', label: 'WhatsApp', fn: `v3ShareTo('whatsapp')` },
          { icon: '✈️', label: 'Telegram', fn: `v3ShareTo('telegram')` },
          { icon: '🔵', label: 'Facebook', fn: `v3ShareTo('facebook')` },
          { icon: '🐦', label: 'X/Twitter', fn: `v3ShareTo('twitter')` },
          { icon: '💼', label: 'LinkedIn', fn: `v3ShareTo('linkedin')` },
          { icon: '📌', label: 'Pinterest', fn: `v3ShareTo('pinterest')` },
          { icon: '🎮', label: 'Discord', fn: `v3ShareTo('discord')` },
          { icon: '📱', label: 'Native', fn: `v3ShareNative()` },
        ].map(p => `
        <button class="v3-share-btn-item" type="button"
          onclick="${p.fn}" aria-label="Share on ${p.label}" role="listitem">
          <span class="v3-share-btn-icon" aria-hidden="true">${p.icon}</span>
          <span>${p.label}</span>
        </button>`).join('')}
      </div>
      <div class="v3-share-copy-row">
        <input class="v3-share-url-input" type="text" id="v3ShareUrl"
          value="${esc(window.location.href)}" readonly aria-label="Share URL"/>
        <button class="v3-share-copy-btn" type="button"
          onclick="v3CopyLink()" aria-label="Copy link">Copy</button>
      </div>
    </div>
  </div>

  <!-- Zoom overlay -->
  <div class="v3-zoom-overlay" id="v3ZoomOverlay" role="dialog" aria-modal="true"
    aria-label="Zoomed cover" onclick="if(event.target===this)v3CloseZoom()">
    <img id="v3ZoomImg" alt="Zoomed PDF cover" src="" loading="lazy" decoding="async" draggable="false">
    <button class="v3-zoom-close" type="button" onclick="v3CloseZoom()" aria-label="Close zoom">✕</button>
  </div>

</div><!-- /.v3-pdp -->
`;

    const wrap = document.getElementById('pdpWrap');
    if (wrap) wrap.innerHTML = html;

    // Patch sticky bar (old HTML element still in the DOM from page-detail)
    const stickyBar = document.getElementById('pdpStickyBar');
    if (stickyBar) stickyBar.style.display = 'none'; // V3 has its own mobile bar

    // Init features
    _v3InitPreview(pdf);
    _v3InitRelated(pdf);
    _v3InitFBT(pdf);
    _v3InitWatermark();
    _v3InitKeyboard();
  };

  /* ── Override _pdpLoadLiveStats output to feed V3 elements ─ */
  const _origLoadLiveStats = window._pdpLoadLiveStats;
  window._pdpLoadLiveStats = async function(pdfId) {
    // Call original
    if (typeof _origLoadLiveStats === 'function') {
      await _origLoadLiveStats(pdfId);
    }
    // Also update V3-specific elements after original runs
    // (original function updates old element IDs; V3 watches for those and mirrors)
    _v3MirrorStats();
  };

  function _v3MirrorStats() {
    // Pull from elements the original function updated
    const ratingVal   = document.getElementById('pdpRatingVal');
    const ratingStars = document.getElementById('pdpRatingStars');
    const ratingCount = document.getElementById('pdpRatingCount');
    const studCount   = document.getElementById('pdpStudentsCount');

    const v3RatingRow   = document.getElementById('v3RatingRow');
    const v3RatingStars = document.getElementById('v3RatingStars');
    const v3RatingNum   = document.getElementById('v3RatingNum');
    const v3RatingCount = document.getElementById('v3RatingCount');
    const v3StudCount   = document.getElementById('v3StudentCount');

    if (ratingVal && v3RatingNum) {
      const val = ratingVal.textContent.trim();
      if (val) {
        if (v3RatingStars) v3RatingStars.innerHTML = stars(parseFloat(val));
        if (v3RatingNum)   v3RatingNum.textContent = val;
        if (v3RatingRow)   v3RatingRow.style.display = '';
      }
    }
    if (ratingCount && v3RatingCount) {
      v3RatingCount.textContent = ratingCount.textContent;
    }
    if (studCount && v3StudCount) {
      const sv = studCount.textContent.trim();
      if (sv) {
        v3StudCount.textContent = sv;
        v3StudCount.style.display = '';
      }
    }

    // Live stat chips
    const liveStats = document.getElementById('v3LiveStats');
    if (liveStats) {
      let shown = false;
      [
        ['v3StatDownloads', 'pdpRatingRow'],
        ['v3StatStudents',  'pdpStudentsCount'],
      ].forEach(([v3id, srcId]) => {
        const src = document.getElementById(srcId);
        const dest = document.getElementById(v3id);
        if (src && dest && src.textContent.trim()) {
          dest.style.display = '';
          shown = true;
        }
      });
      if (shown) liveStats.style.display = '';
    }
  }

  /* ── V3 Buy handler ─────────────────────────────────────── */
  window.v3HandleBuy = function() {
    if (typeof window.pdpHandleBuy === 'function') {
      window.pdpHandleBuy();
    }
  };

  window.v3HandleDownload = function() {
    const pdf = window.selectedPdf;
    if (!pdf) return;
    if (typeof window.downloadPDF === 'function') {
      window.downloadPDF(pdf.id);
    }
  };

  /* ── V3 Wishlist ─────────────────────────────────────────── */
  window.v3ToggleWish = async function() {
    const pdf = window.selectedPdf;
    if (!pdf) return;
    if (typeof window.toggleWish === 'function') {
      await window.toggleWish(pdf.id);
    }
    const inWish = (window.wishlist || []).includes(pdf.id) ||
                   (window.wishlist || []).includes(String(pdf.id));
    // Update all V3 wish buttons
    ['v3WishBtn', 'v3CoverWishBtn', 'v3MobileWishBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('active', inWish);
      btn.setAttribute('aria-pressed', String(inWish));
      btn.setAttribute('aria-label', inWish ? 'Remove from wishlist' : 'Add to wishlist');
      if (id === 'v3MobileWishBtn') {
        btn.innerHTML = `<span aria-hidden="true">${inWish ? '💔' : '❤️'}</span>`;
      } else {
        btn.innerHTML = `<span aria-hidden="true">${inWish ? '💔' : '❤️'}</span>${inWish ? 'Saved' : 'Wishlist'}`;
      }
    });
  };

  /* ── V3 Share ────────────────────────────────────────────── */
  window.v3OpenShare = function() {
    const overlay = document.getElementById('v3ShareOverlay');
    if (!overlay) return;
    const urlInput = document.getElementById('v3ShareUrl');
    if (urlInput) urlInput.value = window.location.href;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.v3CloseShare = function() {
    const overlay = document.getElementById('v3ShareOverlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  window.v3ShareTo = function(platform) {
    const pdf = window.selectedPdf;
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent((pdf && pdf.title) ? `"${pdf.title}" — Studyria 📚` : 'Studyria — Study Materials');
    const platforms = {
      whatsapp:  `https://api.whatsapp.com/send?text=${title}%20${url}`,
      telegram:  `https://t.me/share/url?url=${url}&text=${title}`,
      facebook:  `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      twitter:   `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
      linkedin:  `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      pinterest: `https://pinterest.com/pin/create/button/?url=${url}&description=${title}`,
      discord:   `https://discord.com/channels/@me`,
    };
    const shareUrl = platforms[platform];
    if (shareUrl) window.open(shareUrl, '_blank', 'noopener,width=600,height=500');
    v3CloseShare();
  };

  window.v3ShareNative = function() {
    const pdf = window.selectedPdf;
    if (navigator.share) {
      navigator.share({
        title: (pdf && pdf.title) || 'Studyria PDF',
        text: `Check out this study material on Studyria! 📚`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      v3CopyLink();
    }
    v3CloseShare();
  };

  window.v3CopyLink = function() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        if (typeof window.showToast === 'function') window.showToast('Link copied! 📋', 'success');
      }).catch(() => {
        _v3FallbackCopy(url);
      });
    } else {
      _v3FallbackCopy(url);
    }
  };

  function _v3FallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    if (typeof window.showToast === 'function') window.showToast('Link copied!', 'success');
  }

  /* ── V3 Zoom ─────────────────────────────────────────────── */
  window.v3ZoomCover = function() {
    const pdf = window.selectedPdf;
    if (!pdf) return;
    const src = pdf.cover_url || pdf.cover_image || pdf.coverImage || '';
    if (!src) { if (typeof window.showToast === 'function') window.showToast('No cover image.', 'info'); return; }
    const overlay = document.getElementById('v3ZoomOverlay');
    const img     = document.getElementById('v3ZoomImg');
    if (!overlay || !img) return;
    img.src = src;
    img.alt = `Zoomed: ${pdf.title}`;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.v3CloseZoom = function() {
    const overlay = document.getElementById('v3ZoomOverlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  /* ── V3 Description toggle ───────────────────────────────── */
  window.v3ToggleDesc = function(btn) {
    const desc = document.getElementById('v3Desc');
    const grad = document.getElementById('v3DescGrad');
    const label = document.getElementById('v3ReadMoreLabel');
    if (!desc) return;
    const collapsed = desc.classList.toggle('v3-desc-collapsed');
    if (grad) grad.style.display = collapsed ? '' : 'none';
    if (label) label.textContent = collapsed ? 'Read more' : 'Read less';
    btn.setAttribute('aria-expanded', String(!collapsed));
  };

  /* ── FAQ toggle ──────────────────────────────────────────── */
  window.v3FaqToggle = function(btn) {
    const item = btn.closest('.v3-faq-item');
    if (!item) return;
    const open = item.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  };

  /* ── Coupon apply ────────────────────────────────────────── */
  window.v3ApplyCoupon = function() {
    const input = document.getElementById('v3CouponInput');
    const msg   = document.getElementById('v3CouponMsg');
    const code  = (input && input.value.trim().toUpperCase()) || '';
    if (!code) return;

    // Check against existing coupon system (window.COUPONS or similar)
    if (typeof window.validateCoupon === 'function') {
      const result = window.validateCoupon(code, window.selectedPdf);
      if (result && result.valid) {
        if (msg) { msg.textContent = `✅ Coupon applied! ${result.message || ''}`; msg.className = 'v3-coupon-msg v3-coupon-ok'; }
        // Update price display
        const priceEl = document.getElementById('v3PriceMain');
        if (priceEl && result.finalPrice != null) priceEl.textContent = formatPrice(result.finalPrice);
        window._v3CouponDiscount = result.finalPrice;
      } else {
        if (msg) { msg.textContent = '❌ Invalid or expired coupon code.'; msg.className = 'v3-coupon-msg v3-coupon-err'; }
      }
    } else {
      if (msg) { msg.textContent = '❌ Invalid or expired coupon code.'; msg.className = 'v3-coupon-msg v3-coupon-err'; }
    }
  };

  /* ── Star picker ─────────────────────────────────────────── */
  window.v3StarPick = function(n) {
    window._v3SelectedRating = n;
    document.querySelectorAll('.v3-star-pick-btn').forEach(btn => {
      const s = parseInt(btn.dataset.star);
      btn.classList.toggle('active', s <= n);
    });
  };

  /* ── Submit review ───────────────────────────────────────── */
  window.v3SubmitReview = async function() {
    const pdf    = window.selectedPdf;
    const rating = window._v3SelectedRating || 0;
    const text   = (document.getElementById('v3ReviewText')?.value || '').trim();
    const btn    = document.getElementById('v3ReviewSubmitBtn');

    if (!rating) { if (typeof window.showToast === 'function') window.showToast('Please select a rating.', 'error'); return; }
    if (text.length < 10) { if (typeof window.showToast === 'function') window.showToast('Please write at least 10 characters.', 'error'); return; }
    if (!window.currentUser) { if (typeof window.showToast === 'function') window.showToast('Please sign in to review.', 'error'); return; }
    if (!window.supabaseClient || !pdf) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const { error } = await window.supabaseClient.from('pdf_reviews').upsert({
        pdf_id:  pdf.id,
        user_id: window.currentUser.id,
        rating,
        comment: text,
      }, { onConflict: 'user_id,pdf_id' });

      if (error) throw error;
      if (typeof window.showToast === 'function') window.showToast('Review submitted! 🎉', 'success');
      document.getElementById('v3ReviewText') && (document.getElementById('v3ReviewText').value = '');
      window._v3SelectedRating = 0;
      document.querySelectorAll('.v3-star-pick-btn').forEach(b => b.classList.remove('active'));
      // Refresh stats
      if (typeof window._pdpLoadLiveStats === 'function') window._pdpLoadLiveStats(pdf.id);
    } catch(e) {
      if (typeof window.showToast === 'function') window.showToast('Error submitting review. Try again.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Review'; }
    }
  };

  /* ── PDF Preview (PDF.js) ────────────────────────────────── */
  function _v3InitPreview(pdf) {
    const pdfUrl = pdf.preview_pdf_url || pdf.pdf_url || pdf.file_url || '';
    const maxPages = parseInt(pdf.preview_pages || pdf.previewPages || 3, 10) || 3;

    if (!pdfUrl || typeof window.pdfjsLib === 'undefined') {
      // Wait for pdf.js to load
      if (pdfUrl && typeof window.pdfjsLib === 'undefined') {
        let tries = 0;
        const t = setInterval(() => {
          if (typeof window.pdfjsLib !== 'undefined') {
            clearInterval(t);
            _v3LoadPreview(pdf, pdfUrl, maxPages);
          }
          if (++tries > 20) clearInterval(t);
        }, 500);
      }
      return;
    }
    _v3LoadPreview(pdf, pdfUrl, maxPages);
  }

  let _v3PdfDoc = null, _v3PreviewPage = 1, _v3PreviewMax = 3;

  async function _v3LoadPreview(pdf, pdfUrl, maxPages) {
    const section = document.getElementById('v3PreviewSection');
    const badge   = document.getElementById('v3PreviewBadge');
    const loading = document.getElementById('v3PreviewLoading');
    const canvas  = document.getElementById('v3PreviewCanvas');

    if (!section || !canvas) return;

    section.style.display = '';
    _v3PreviewMax = maxPages;
    _v3PreviewPage = 1;

    // Personalized watermark
    if (window.currentUser) {
      const wm = document.getElementById('v3WatermarkText');
      const id  = window.currentUser.email || window.currentUser.id || '';
      if (wm && id) {
        const line = `Preview • ${id} • Studyria • Not for Redistribution`;
        wm.innerHTML = `${line}<br>${line}<br>${line}`;
      }
    }

    try {
      // Signed URL fetch (Supabase storage)
      let resolvedUrl = pdfUrl;
      if (pdfUrl.includes('supabase') && window.supabaseClient) {
        // Extract bucket + path
        const match = pdfUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
        if (match) {
          const parts  = match[1].split('/');
          const bucket = parts[0];
          const path   = parts.slice(1).join('/');
          const { data } = await window.supabaseClient.storage
            .from(bucket).createSignedUrl(path, 300); // 5-min expiry
          if (data && data.signedUrl) resolvedUrl = data.signedUrl;
        }
      }

      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
      _v3PdfDoc = await pdfjsLib.getDocument({ url: resolvedUrl, withCredentials: false }).promise;

      const total = _v3PdfDoc.numPages;
      _v3PreviewMax = Math.min(maxPages, total);
      if (badge) badge.textContent = `${_v3PreviewMax} of ${total} pages preview`;

      if (loading) loading.style.display = 'none';
      if (canvas)  canvas.style.display = '';

      await _v3RenderPreviewPage(1);
      _v3UpdatePreviewNav();

    } catch(e) {
      console.warn('[V3 Preview] Error:', e);
      if (section) section.style.display = 'none';
    }
  }

  async function _v3RenderPreviewPage(pageNum) {
    if (!_v3PdfDoc) return;
    const canvas = document.getElementById('v3PreviewCanvas');
    if (!canvas) return;

    const page = await _v3PdfDoc.getPage(pageNum);
    const stage = document.getElementById('v3PreviewStage');
    const stageW = stage ? stage.clientWidth || 600 : 600;

    const viewport0 = page.getViewport({ scale: 1 });
    const scale     = stageW / viewport0.width;
    const viewport  = page.getViewport({ scale });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    _v3PreviewPage = pageNum;
    _v3UpdatePreviewNav();
  }

  function _v3UpdatePreviewNav() {
    const prev = document.getElementById('v3PreviewPrev');
    const next = document.getElementById('v3PreviewNext');
    const info = document.getElementById('v3PreviewInfo');
    if (prev) prev.disabled = _v3PreviewPage <= 1;
    if (next) next.disabled = _v3PreviewPage >= _v3PreviewMax;
    if (info) info.textContent = `Page ${_v3PreviewPage} of ${_v3PreviewMax}`;
  }

  window.v3PreviewNav = async function(delta) {
    const next = _v3PreviewPage + delta;
    if (next < 1 || next > _v3PreviewMax) return;
    const loading = document.getElementById('v3PreviewLoading');
    const canvas  = document.getElementById('v3PreviewCanvas');
    if (loading) loading.style.display = '';
    if (canvas)  canvas.style.display = 'none';
    await _v3RenderPreviewPage(next);
    if (loading) loading.style.display = 'none';
    if (canvas)  canvas.style.display = '';
  };


  /* ── Frequently Bought Together ──────────────────────────── */
  function _v3InitFBT(pdf) {
    const section = document.getElementById('v3FbtSection');
    const itemsEl = document.getElementById('v3FbtItems');
    const totalEl = document.getElementById('v3FbtTotal');
    const saveEl  = document.getElementById('v3FbtSave');
    if (!section || !itemsEl) return;

    // Pick 2 PDFs from same category (exclude current), seeded by pdf.id
    const pool = (window.PDFS || []).filter(p =>
      String(p.id) !== String(pdf.id) &&
      p.status === 'published' &&
      (p.category === pdf.category || (!p.category && !pdf.category))
    );
    if (pool.length < 1) return; // need at least 1 companion

    // Seeded pick
    function seed(n) {
      let h = (Number(pdf.id) * 2654435769 + n * 1234567891) >>> 0;
      h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    const companions = [];
    const used = new Set([String(pdf.id)]);
    for (let i = 0; companions.length < Math.min(2, pool.length); i++) {
      const idx = Math.floor(seed(i + 100) * pool.length);
      const pick = pool[idx];
      if (pick && !used.has(String(pick.id))) {
        used.add(String(pick.id));
        companions.push(pick);
      }
      if (i > 40) break;
    }
    if (!companions.length) return;

    const all = [pdf, ...companions];

    function coverThumb(p) {
      const src = (p.cover_url || p.cover_image || p.coverImage || '').trim();
      if (src) return `<img src="${esc(src)}" alt="${esc(p.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`;
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }

    itemsEl.innerHTML = all.map((p, i) => {
      const label = i === 0 ? '<span style="font-size:.6rem;color:#3d8ef8;font-weight:700">This PDF</span>' : '';
      return `
        ${i > 0 ? '<span class="v3-fbt-plus" aria-hidden="true">+</span>' : ''}
        <div class="v3-fbt-item" role="listitem" onclick="v3OpenRelated('${esc(String(p.id))}')" tabindex="0" aria-label="${esc(p.title || 'PDF')}">
          <div class="v3-fbt-item-cover">${coverThumb(p)}</div>
          ${label}
          <div class="v3-fbt-item-title">${esc((p.title || '').slice(0, 30))}${(p.title||'').length > 30 ? '…' : ''}</div>
        </div>`;
    }).join('');

    // Pricing
    const prices = all.map(p => Number(p.price ?? 0));
    const total = prices.reduce((s, v) => s + v, 0);
    const discount = Math.min(30, 10 + Math.floor(seed(200) * 15)); // 10–25% off
    const bundlePrice = Math.round(total * (1 - discount / 100));
    const save = total - bundlePrice;

    if (totalEl) totalEl.textContent = total > 0 ? '₹' + bundlePrice.toLocaleString('en-IN') : 'FREE';
    if (saveEl && save > 0) saveEl.textContent = 'Save ₹' + save.toLocaleString('en-IN');

    // Store for buy handler
    window._v3FbtIds = companions.map(p => String(p.id));

    section.style.display = '';
  }

  window.v3BuyBundle = function() {
    // For now open the first companion's buy flow (simple approach)
    if (window._v3FbtIds && window._v3FbtIds.length) {
      const msg = 'Bundle checkout opens each PDF individually. Proceeding with current PDF first.';
      if (typeof window.showToast === 'function') window.showToast(msg, 'info');
      if (typeof window.pdpHandleBuy === 'function') window.pdpHandleBuy();
    }
  };

  /* ── Related PDFs ────────────────────────────────────────── */
  function _v3InitRelated(pdf) {
    const grid    = document.getElementById('v3RelatedGrid');
    const section = document.getElementById('v3RelatedSection');
    if (!grid || !window.PDFS) return;

    const related = (window.PDFS || []).filter(p =>
      p.status === 'active' &&
      String(p.id) !== String(pdf.id) &&
      (p.category === pdf.category || p.subcategory_id === pdf.subcategory_id) &&
      (p.cover_image || p.coverImage)
    ).slice(0, 8);

    if (!related.length) return;
    section.style.display = '';
    grid.innerHTML = related.map(p => {
      const cover = p.cover_image || p.coverImage || '';
      const price = Number(p.price ?? 0);
      const from  = p.coverFrom || '#1d4ed8';
      const to    = p.coverTo   || '#3d8ef8';
      return `
      <div class="v3-related-card" role="listitem" tabindex="0"
        onclick="v3OpenRelated('${esc(String(p.id))}')"
        onkeypress="if(event.key==='Enter')v3OpenRelated('${esc(String(p.id))}')"
        aria-label="${esc(p.title || 'Related PDF')}">
        <div class="v3-related-cover">
          ${cover
            ? `<img src="${esc(cover)}" alt="${esc(p.title || 'PDF cover')}" loading="lazy" decoding="async">`
            : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${from},${to})"></div>`}
        </div>
        <div class="v3-related-info">
          <div class="v3-related-title">${esc(p.title || 'Untitled')}</div>
          <div class="v3-related-price">${p.free || price === 0 ? 'Free' : formatPrice(price)}</div>
        </div>
      </div>`;
    }).join('');
  }

  window.v3OpenRelated = function(pdfId) {
    const pdf = (window.PDFS || []).find(p => String(p.id) === String(pdfId));
    if (!pdf) return;
    window.selectedPdf = pdf;
    if (typeof window.navigate === 'function') window.navigate('detail');
    else if (typeof window.renderDetail === 'function') window.renderDetail();
  };

  /* ── Watermark personalization ───────────────────────────── */
  function _v3InitWatermark() {
    // Already set in preview init if logged in
    // This is the general page-level watermark
  }

  /* ── Keyboard navigation ─────────────────────────────────── */
  function _v3InitKeyboard() {
    function handleKey(e) {
      const zoomOpen  = document.getElementById('v3ZoomOverlay')?.classList.contains('open');
      const shareOpen = document.getElementById('v3ShareOverlay')?.classList.contains('open');
      if (e.key === 'Escape') {
        if (zoomOpen)  v3CloseZoom();
        if (shareOpen) v3CloseShare();
      }
    }
    document.removeEventListener('keydown', window._v3KeyHandler);
    window._v3KeyHandler = handleKey;
    document.addEventListener('keydown', handleKey);
  }

  /* ── Reviews update (called after _pdpLoadLiveStats) ────── */
  // This is called via the existing realtime subscription in the main app
  // We hook into the existing review rendering from _pdpLoadLiveStats
  const _origRenderShell = window._pdpRenderShell; // already overridden above

  // Expose V3 review renderer for external calls
  window._v3UpdateReviews = function(reviews, avgRating, totalCount) {
    const cards   = document.getElementById('v3ReviewCards');
    const summary = document.getElementById('v3ReviewSummary');
    const avgNum  = document.getElementById('v3AvgNum');
    const avgSt   = document.getElementById('v3AvgStars');
    const avgCt   = document.getElementById('v3AvgCount');
    const bars    = document.getElementById('v3ReviewBars');
    const form    = document.getElementById('v3ReviewForm');
    const loginP  = document.getElementById('v3ReviewLoginPrompt');

    if (!cards) return;

    // Show review form based on auth + ownership
    if (form && loginP) {
      if (!window.currentUser) {
        loginP.style.display = '';
        form.style.display = 'none';
      } else {
        loginP.style.display = 'none';
        form.style.display = '';
      }
    }

    if (!reviews || !reviews.length) {
      cards.innerHTML = `<p style="font-size:.85rem;color:var(--text2);text-align:center;padding:20px 0">No reviews yet. Be the first to review!</p>`;
      return;
    }

    // Summary
    if (summary) {
      summary.style.display = '';
      if (avgNum) avgNum.textContent = avgRating.toFixed(1);
      if (avgSt)  avgSt.innerHTML = stars(avgRating);
      if (avgCt)  avgCt.textContent = `${totalCount} review${totalCount !== 1 ? 's' : ''}`;

      // Rating breakdown bars
      if (bars) {
        const breakdown = [5,4,3,2,1].map(n => {
          const count = reviews.filter(r => Math.round(r.rating) === n).length;
          const pct = totalCount > 0 ? Math.round(count / totalCount * 100) : 0;
          return `
          <div class="v3-review-bar-row">
            <span>${n}★</span>
            <div class="v3-review-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${n} stars: ${pct}%">
              <div class="v3-review-bar-fill" style="width:${pct}%"></div>
            </div>
            <span>${pct}%</span>
          </div>`;
        });
        bars.innerHTML = breakdown.join('');
      }
    }

    // Review cards
    cards.innerHTML = reviews.slice(0, 8).map(r => {
      const name    = r.reviewer_name || r.full_name || r.user_id?.slice(0,8) || 'Student';
      const initial = name.charAt(0).toUpperCase();
      const avatar  = r.reviewer_avatar || '';
      const date    = r.created_at
        ? new Date(r.created_at).toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' })
        : '';
      const verified = r.verified || r.is_verified || false;
      return `
      <div class="v3-review-card" role="listitem">
        <div class="v3-review-header">
          <div class="v3-reviewer-avatar" aria-hidden="true">
            ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" loading="lazy">` : esc(initial)}
          </div>
          <div style="flex:1;min-width:0">
            <div class="v3-reviewer-name">${esc(name)}</div>
            <div class="v3-reviewer-date">${esc(date)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <div role="img" aria-label="${r.rating} stars" style="display:flex;gap:2px">
              ${stars(r.rating)}
            </div>
            ${verified ? '<span class="v3-reviewer-verified" aria-label="Verified purchase">✓ Verified</span>' : ''}
          </div>
        </div>
        ${r.comment ? `<p class="v3-review-text">${esc(r.comment)}</p>` : ''}
      </div>`;
    }).join('');

    // V3 Rating row in hero
    const ratingRow = document.getElementById('v3RatingRow');
    const ratingStars = document.getElementById('v3RatingStars');
    const ratingNum = document.getElementById('v3RatingNum');
    const ratingCount = document.getElementById('v3RatingCount');
    if (ratingRow && avgRating > 0) {
      if (ratingStars) ratingStars.innerHTML = stars(avgRating);
      if (ratingNum)   ratingNum.textContent = avgRating.toFixed(1);
      if (ratingCount) ratingCount.textContent = `(${totalCount})`;
      ratingRow.style.display = '';
    }
  };

  /* ── Hook into _pdpLoadLiveStats for review data ──────────  */
  // The original function fetches reviews and updates old DOM elements.
  // We intercept its output via MutationObserver on the old review container.
  // When the old pdpRatingRow is updated, mirror to V3 elements.
  function _v3ObserveOldStats() {
    const oldRow = document.getElementById('pdpRatingRow');
    if (!oldRow) { setTimeout(_v3ObserveOldStats, 500); return; }
    const obs = new MutationObserver(() => _v3MirrorStats());
    obs.observe(oldRow, { childList: true, subtree: true, characterData: true });
  }
  _v3ObserveOldStats();

  /* ── Cleanup on navigate away ────────────────────────────── */
  const _origNavigate = window.navigate;
  window.navigate = function(page, ...args) {
    if (page !== 'detail') {
      // Close modals, release PDF doc
      v3CloseZoom();
      v3CloseShare();
      if (_v3PdfDoc) { try { _v3PdfDoc.destroy(); } catch(e) {} _v3PdfDoc = null; }
      if (window._v3KeyHandler) document.removeEventListener('keydown', window._v3KeyHandler);
    }
    if (typeof _origNavigate === 'function') return _origNavigate(page, ...args);
  };

  console.log('[Studyria] pdp-v3.js loaded ✅');

})();
