/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDP CHECKOUT & OWNERSHIP MODULE
   Extracted from index.html inline scripts so both the SPA shell
   AND standalone /pdf/*.html pages can share the same code.

   Depends on: supabase.js, pdf-list.js, pdp-v2.js (renderDetail, _esc)
   Optional SPA deps (guarded): navigate(), renderDashboard(),
   renderWishlist(), _refreshDashStats(), _refreshFreeButtonLabels()

   V2 — 2026-08-01
   ═══════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

// ── SPA-only function stubs (safe no-ops on standalone /pdf/ pages) ──
if (typeof window.renderWishlist !== 'function') window.renderWishlist = function() {};
if (typeof window.renderDashboard !== 'function') window.renderDashboard = function() {};
if (typeof window._refreshDashStats !== 'function') window._refreshDashStats = function() {};
if (typeof window._refreshFreeButtonLabels !== 'function') window._refreshFreeButtonLabels = function() {};
if (typeof window.loadWishlistFromSupabase !== 'function') window.loadWishlistFromSupabase = async function() {};
if (typeof window.cpCreditCreatorSale !== 'function') window.cpCreditCreatorSale = function() {};

/* ── Standalone-safe fallback cache ──────────────────────────────────
   index.html (SPA) declares `const _pdfFallbackCache = {}` in an inline
   script — a GLOBAL LEXICAL binding that does NOT exist on standalone
   /pdf/ pages. Bare reads below threw `ReferenceError: _pdfFallbackCache
   is not defined` from normalizePdf → renderDetail() → static pages were
   stuck on skeleton screens forever. Keep a self-contained, window-level
   cache so both SPA and standalone pages work identically. */
var _pdfFallbackCache = window._pdfFallbackCache = window._pdfFallbackCache || {};

/* ── normalizePdf ── */
function normalizePdf(p) {
  if (!p) return p;

  // ── Classification fields — always null when blank/undefined ─────
  ['category_id','subcategory_id','academic_level_id','stream_id','semester_class_id','subject_id'].forEach(k => {
    if (p[k] === undefined || p[k] === '' || p[k] === 'undefined' || p[k] === 'null') p[k] = null;
  });
  // Normalize display-only field (category text) — all _id columns handled above
  ['category'].forEach(k => {
    if (!p[k] || p[k] === 'undefined' || p[k] === 'null' || p[k] === '—') p[k] = null;
  });

  // ── Safe defaults for null/missing display fields ─────────────────
  if (!p.title || p.title === 'null' || p.title === 'undefined') p.title = 'Untitled PDF';
  if (!p.description || p.description === 'null' || p.description === 'undefined') p.description = '';
  if (!p.category) p.category = null; // leave null so chips are omitted; UI shows 'General' where needed

  // ── Cover image (check every possible Supabase column name) ──────
  p.coverImage = p.coverImage || p.cover_url || p.cover_image ||
                 p.thumbnail  || p.image     || p.image_url   || p.poster || '';

  // ── Pages ─────────────────────────────────────────────────────────
  p.pages = p.pages || p.total_pages || p.page_count || p.pdf_pages || 0;

  // ── Description / Preview ─────────────────────────────────────────
  p.description = p.description || p.preview || p.summary || p.about || p.details || p.content || '';

  // ── Price ─────────────────────────────────────────────────────────
  // CANONICAL: always resolve to a single numeric `price` field.
  // Old field names (selling_price, sale_price, discount_price, final_price) are
  // collapsed here so no renderer ever sees undefined/null and shows ₹null.
  p.price = Number(p.price ?? p.selling_price ?? p.sale_price ?? p.discount_price ?? p.final_price ?? 0);
  // Derive `free` from price if not already set explicitly
  if (p.free === undefined || p.free === null) p.free = (p.price === 0);
  p.originalPrice = Number(p.originalPrice ?? p.original_price ?? p.mrp ?? p.list_price ?? p.price ?? 0);
  // Debug: log first normalisation per session to confirm shape
  if (!window._pdfPriceLogDone) {
    console.log('[Studyria] normalizePdf sample →', { id: p.id, title: p.title, price: p.price, free: p.free });
    window._pdfPriceLogDone = true;
  }

  // ── PDF URL ───────────────────────────────────────────────────────
  // Always resolve from every possible column name. Never leave as empty string
  // if a valid URL exists anywhere on the object.
  p.pdfUrl = p.pdfUrl || p.pdf_url || p.file_url || p.download_url || p.megaLink || p.mega_link || '';
  // Also ensure the canonical snake_case column is set so DB re-fetch returns it
  if (!p.pdf_url && p.pdfUrl) p.pdf_url = p.pdfUrl;

  // ── Preview PDF URL ─────────────────────────────────────────────────
  p.previewPdfUrl = p.previewPdfUrl || p.preview_pdf_url || p.previewUrl || p.preview_url || '';
  if (!p.preview_pdf_url && p.previewPdfUrl) p.preview_pdf_url = p.previewPdfUrl;
  // Auto-generated preview images (stored as public URLs)
  p.previewPage1 = p.previewPage1 || p.preview_page_1 || '';
  p.previewPage2 = p.previewPage2 || p.preview_page_2 || '';
  p.previewPage3 = p.previewPage3 || p.preview_page_3 || '';
  p.previewGenerated = !!(p.preview_generated || p.previewGenerated || false);

  // ── Reviews & Sales — use DB values or generate realistic fallbacks
  const cached = _pdfFallbackCache[p.id] || {};

  const rawReviews = p.reviews || p.review_count || p.total_reviews || p.rating_count || 0;
  if (rawReviews) {
    p.reviews = rawReviews;
  } else {
    if (!cached.reviews) {
      // Generate based on tag/badge
      const tag = (p.tag || p.badge || '').toLowerCase();
      if (tag.includes('bestseller') || tag.includes('best seller')) {
        cached.reviews = 80 + Math.floor(seededRand(p.id, 1) * 170);   // 80-250
      } else if (tag.includes('featured')) {
        cached.reviews = 50 + Math.floor(seededRand(p.id, 2) * 130);   // 50-180
      } else if (tag.includes('popular') || tag.includes('trending')) {
        cached.reviews = 25 + Math.floor(seededRand(p.id, 3) * 50);    // 25-75
      } else {
        cached.reviews = 13 + Math.floor(seededRand(p.id, 4) * 12);    // 13-24
      }
      _pdfFallbackCache[p.id] = cached;
    }
    p.reviews = cached.reviews;
  }

  const rawSales = p.download_count || p.sales || 0;
  if (rawSales) {
    p.sales = rawSales;
  } else {
    if (!cached.sales) {
      const tag = (p.tag || p.badge || '').toLowerCase();
      if (tag.includes('bestseller') || tag.includes('best seller')) {
        cached.sales = 1000 + Math.floor(seededRand(p.id, 5) * 9000);  // 1000-10000
      } else if (tag.includes('featured')) {
        cached.sales = 300  + Math.floor(seededRand(p.id, 6) * 900);   // 300-1200
      } else if (tag.includes('popular') || tag.includes('trending')) {
        cached.sales = 150  + Math.floor(seededRand(p.id, 7) * 650);   // 150-800
      } else {
        cached.sales = 50   + Math.floor(seededRand(p.id, 8) * 100);   // 50-150
      }
      _pdfFallbackCache[p.id] = cached;
    }
    p.sales = cached.sales;
  }

  return p;
}

// Deterministic pseudo-random based on PDF id + a salt — ensures same PDF

/* ── seededRand ── */
function seededRand(id, salt) {
  let h = (Number(id) * 2654435769 + salt * 1234567891) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── BROKEN PDF FILTER ─────────────────────────────────────────────
// Returns false for PDFs that have null/missing critical fields so
// they are hidden everywhere (library, search, featured, trending,

/* ── toastId + showToast ── */
let toastId = 0;
function showToast(msg, type = 'info') {
  const id = ++toastId;
  const icon = type === 'success' ? '#ic-check' : '#ic-zap';
  const el = document.createElement('div');
  el.className = 'toast card';
  el.innerHTML = `<svg width="16" height="16" style="color:var(--accent);flex-shrink:0"><use href="${icon}"/></svg><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}


/* ── _pdpSeed ── */
function _pdpSeed(id, salt) {
  let h = (Number(id) * 2654435769 + salt * 1234567891) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── Marketing mode fake data — realistic Assam student reviews ─────────

/* ── _pdpMarketingData ── */
function _pdpMarketingData(pdfId) {
  const s = (n) => _pdpSeed(pdfId, n);

  // Realistic rating: 4.2 – 4.9 (weighted towards 4.5–4.8)
  const avgRating = 4.2 + s(1) * 0.7;  // 4.2 → 4.9
  const revCount  = 3 + Math.floor(s(2) * 3);  // 3, 4, or 5 reviews

  // Rating distribution — realistic bell shape around 4-5 stars
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (let i = 0; i < revCount; i++) {
    const r = s(10 + i);
    // 55% → 5★, 30% → 4★, 10% → 3★, 5% → 2★ (no 1★ for marketing)
    const star = r < 0.55 ? 5 : r < 0.85 ? 4 : r < 0.95 ? 3 : 2;
    dist[star]++;
  }

  // Fake download count — realistic for a new PDF (80 – 850)
  // Based on category/tag: bestseller gets more, new gets less
  const pdf = window.selectedPdf || {};
  const tag = ((pdf.tag || pdf.badge || '')).toLowerCase();
  let baseDownloads;
  if (tag.includes('bestseller'))       baseDownloads = 400 + Math.floor(s(3) * 450);
  else if (tag.includes('featured'))    baseDownloads = 200 + Math.floor(s(3) * 300);
  else if (tag.includes('popular') || tag.includes('trending'))
                                         baseDownloads = 150 + Math.floor(s(3) * 200);
  else                                  baseDownloads =  80 + Math.floor(s(3) * 170);

  // Assam student names + realistic review texts
  const NAMES = [
    ['Ankita Bora',     'Guwahati'],
    ['Rajib Das',       'Dibrugarh'],
    ['Priyanka Gogoi',  'Jorhat'],
    ['Bikash Kalita',   'Nagaon'],
    ['Rupam Nath',      'Tezpur'],
    ['Sanjukta Deka',   'Kamrup'],
    ['Dhruba Hazarika', 'Sivasagar'],
    ['Pallavi Bhuyan',  'Bongaigaon'],
    ['Himangsu Baruah', 'Nalbari'],
    ['Rima Sarma',      'Dhubri'],
  ];
  const TEXTS = [
    'Excellent study material! Ekdom helpful hoise exam preparation t. Highly recommend all students ke.',
    'Crystal clear explanations. Coaching notes r thekio bhalo lagil. Worth every rupee!',
    'PDF ti khub well structured. Last minute revision r babé perfect. Aro PDF kinibo etia.',
    'Simple language t explain kora, okol padile bujha jai. Assam r students r babé ideal.',
    'Previous year questions gulo cover kora ase. Exam r age must buy kora uchit.',
    'Chapters wise breakdown ase, khub help korse. 3-4 ghonta t porhibo parisa.',
    'Quality content, no filler. Exactly what I needed for my board preparation.',
    'Teacher r notes r thekio comprehensive. Smart charts and quick tips included.',
    'Downloaded it night before exam — covered everything. Scored well! Grateful.',
    'Trusted source, verified content. Language simple, diagrams helpful.',
  ];

  // Pick 3–5 unique reviews seeded by pdfId
  const reviews = [];
  const usedNames = new Set();
  for (let i = 0; i < revCount; i++) {
    let ni = Math.floor(s(20 + i) * NAMES.length);
    while (usedNames.has(ni)) ni = (ni + 1) % NAMES.length;
    usedNames.add(ni);
    const [name, loc] = NAMES[ni];
    const ti = Math.floor(s(30 + i) * TEXTS.length);
    const starRoll = s(40 + i);
    const star = starRoll < 0.55 ? 5 : starRoll < 0.85 ? 4 : 3;
    // Fake date: 3–90 days ago, deterministic
    const daysAgo = 3 + Math.floor(s(50 + i) * 87);
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    reviews.push({ name, loc, star, text: TEXTS[ti], date: d });
  }

  return { avgRating, revCount, dist, baseDownloads, reviews };
}


/* ── _pdpLoadLiveStats ── */
async function _pdpLoadLiveStats(pdfId) {
  const client = window.supabaseClient;
  if (!client || !pdfId) return;
  try {
    // ── FIX: table/column mismatches ────────────────────────────────
    // Previous queries referenced tables that don't exist in this
    // project's schema ('purchases', 'wishlist', 'reviews'), causing
    // failed network requests on every PDF detail page load. The real
    // tables are 'purchased_pdfs', 'user_wishlist' and 'pdf_reviews'.
    // Both purchased_pdfs.pdf_id and user_wishlist.pdf_id are TEXT
    // columns, so they must be compared with String(pdfId).
    // pdf_reviews.pdf_id and downloads.pdf_id are UUID (FK → pdfs.id, which is uuid).
    const [dlRes, purchRes, wishRes, revRes, revRowsRes] = await Promise.all([
      client.from('downloads').select('id', { count:'exact', head:true  }).eq('pdf_id', pdfId),
      // Query by pdf_uuid (canonical column only — no legacy pdf_id in schema)
      client.from('purchased_pdfs').select('id', { count:'exact', head:true }).eq('pdf_uuid', String(pdfId)).eq('status', 'paid'),
      client.from('user_wishlist' ).select('id', { count:'exact', head:true  }).or(`pdf_id.eq.pdf:${pdfId},pdf_id.eq.${pdfId}`),
      client.from('pdf_reviews'   ).select('rating', { count:'exact' }        ).eq('pdf_id', pdfId),
      client.from('pdf_reviews'   ).select('id,rating,comment,created_at,user_id').eq('pdf_id', pdfId).order('created_at',{ascending:false}).limit(10),
    ]);

    const dlCount    = dlRes.error    ? null : (dlRes.count    ?? 0);
    const purchCount = purchRes.error ? null : (purchRes.count ?? 0);
    const revCount   = revRes.error   ? null : (revRes.count   ?? 0);
    const revRows    = revRowsRes.error ? [] : (revRowsRes.data || []);

    // ── MARKETING MODE ──────────────────────────────────────────────────
    // Trigger: no real downloads AND no real reviews yet (fresh/upcoming PDF)
    const isMarketing = (dlCount === 0 || dlCount === null) && (revCount === 0 || revCount === null);

    if (isMarketing) {
      const mkt = _pdpMarketingData(pdfId);
      // Display = fake base (seeded) — no real downloads yet so no addition needed
      _pdpApplyLiveStats({
        dlCount:    mkt.baseDownloads,
        purchCount: Math.floor(mkt.baseDownloads * 0.65),  // ~65% of downloads = purchases
        revCount:   mkt.revCount,
        avgRating:  mkt.avgRating,
        ratingDist: mkt.dist,
        revRows:    null,           // use fake review cards below
        fakeReviews: mkt.reviews,
      });
      return;
    }

    // ── REAL DATA MODE ──────────────────────────────────────────────────
    // Real reviews exist → compute real avg
    let avgRating = null;
    let ratingDist = {};
    if (revCount > 0 && revRes.data && revRes.data.length > 0) {
      const ratings = revRes.data.map(r => Number(r.rating)).filter(r => r >= 1 && r <= 5);
      if (ratings.length > 0) {
        avgRating = ratings.reduce((s,r) => s+r, 0) / ratings.length;
        [1,2,3,4,5].forEach(s => { ratingDist[s] = ratings.filter(r => Math.round(r) === s).length; });
      }
    }

    // Real downloads: add fake base so counter doesn't reset to 0 after marketing phase
    const mkt = _pdpMarketingData(pdfId);
    const displayDl    = (dlCount    || 0) + mkt.baseDownloads;
    const displayPurch = (purchCount || 0) + Math.floor(mkt.baseDownloads * 0.65);

    _pdpApplyLiveStats({
      dlCount:    displayDl,
      purchCount: displayPurch,
      revCount,
      avgRating,
      ratingDist,
      revRows,
      fakeReviews: null,
    });
  } catch(e) {
    console.warn('_pdpLoadLiveStats error:', e);
  }
}


/* ── _pdpApplyLiveStats ── */
function _pdpApplyLiveStats({ dlCount, purchCount, revCount, avgRating, ratingDist, revRows, fakeReviews }) {
  // Downloads
  if (dlCount !== null && dlCount > 0) {
    const chipDl      = document.getElementById('pdpChipDownloads');
    const chipDlVal   = document.getElementById('pdpChipDlVal');
    const detailDlRow = document.getElementById('pdpDetailDlRow');
    const detailDlVal = document.getElementById('pdpDetailDlVal');
    if (chipDl && chipDlVal)         { chipDlVal.textContent   = dlCount.toLocaleString()+'+'; chipDl.style.display = ''; }
    if (detailDlRow && detailDlVal)  { detailDlVal.textContent = dlCount.toLocaleString()+'+'; detailDlRow.style.display = ''; }
  }

  // Students / purchases
  if (purchCount !== null && purchCount > 0) {
    const el  = document.getElementById('pdpStudentsCount');
    const sep = document.getElementById('pdpStudentsSep');
    if (el)  { el.textContent = `👨‍🎓 ${purchCount.toLocaleString()} students`; el.style.display = ''; }
    if (sep) sep.style.display = '';
    const ctaSub = document.getElementById('pdpCtaSub');
    if (ctaSub) ctaSub.textContent = `Join ${purchCount.toLocaleString()}+ students already studying with this PDF`;
  }

  // Rating + Reviews (only if real data)
  if (avgRating !== null && revCount > 0) {
    const stars = '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating));

    const ratingRow       = document.getElementById('pdpRatingRow');
    const starsEl         = document.getElementById('pdpRatingStars');
    const valEl           = document.getElementById('pdpRatingVal');
    const countEl         = document.getElementById('pdpRatingCount');
    const detailRatingRow = document.getElementById('pdpDetailRatingRow');
    const detailRatingVal = document.getElementById('pdpDetailRatingVal');

    if (starsEl)         starsEl.textContent         = stars;
    if (valEl)           valEl.textContent           = avgRating.toFixed(1);
    if (countEl)         countEl.textContent         = `(${revCount.toLocaleString()} reviews)`;
    if (ratingRow)       ratingRow.style.display     = '';
    if (detailRatingVal) detailRatingVal.textContent = avgRating.toFixed(1) + ' / 5';
    if (detailRatingRow) detailRatingRow.style.display = '';

    const section = document.getElementById('pdpReviewsSection');
    const summary = document.getElementById('pdpReviewsSummary');
    const list    = document.getElementById('pdpReviewsList');
    if (section) section.style.display = '';

    if (summary) {
      const total = Object.values(ratingDist).reduce((s,n)=>s+n,0) || 1;
      summary.innerHTML = `
        <div class="pdp-rev-big">${avgRating.toFixed(1)}</div>
        <div class="pdp-rev-right">
          <div class="pdp-stars-big">${stars}</div>
          <div class="pdp-rev-count">${revCount.toLocaleString()} ratings</div>
          <div class="pdp-rev-bars">
            ${[5,4,3,2,1].map(s => {
              const cnt = ratingDist[s] || 0;
              const pct = Math.round((cnt/total)*100);
              return `<div class="pdp-rev-bar-row">
                <span class="pdp-rev-bar-lbl">${s}★</span>
                <div class="pdp-rev-bar-track"><div class="pdp-rev-bar-fill" style="width:${pct}%"></div></div>
                <span class="pdp-rev-bar-pct">${pct}%</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // ── Review cards: fake (marketing) or real ──
    if (list) {
      if (fakeReviews && fakeReviews.length > 0) {
        // Marketing mode: seeded realistic Assam student reviews
        list.innerHTML = fakeReviews.map(r => {
          const rStars = '★'.repeat(r.star) + '☆'.repeat(5 - r.star);
          const initials = r.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
          const dateStr = r.date.toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'});
          return `<div class="pdp-review-card">
            <div class="pdp-rev-header">
              <div class="pdp-rev-avatar">${initials}</div>
              <div class="pdp-rev-meta">
                <div class="pdp-rev-name">${_esc(r.name)}</div>
                <div class="pdp-rev-loc">📍 ${_esc(r.loc)}</div>
              </div>
              <div class="pdp-rev-stars">${rStars}</div>
            </div>
            <div class="pdp-rev-text">${_esc(r.text)}</div>
          </div>`;
        }).join('');

        // Write a Review form (also shown in marketing mode)
        const writeWrapMkt = document.getElementById('pdpWriteReviewWrap');
        if (writeWrapMkt) _pdpRenderReviewForm(writeWrapMkt);
      } else if (revRows && revRows.length > 0) {
        // Real data mode: actual Supabase review rows
        list.innerHTML = revRows.map(r => {
          const rStars   = '★'.repeat(Math.round(r.rating||0)) + '☆'.repeat(5-Math.round(r.rating||0));
          const initials = (r.user_id||'?').slice(0,2).toUpperCase();
          const dateStr  = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}) : '';
          const verifiedBadge = r.verified
            ? `<span class="pdp-rev-verified-badge">✓ Verified Purchase</span>`
            : '';
          return `<div class="pdp-review-card">
            <div class="pdp-rev-header">
              <div class="pdp-rev-avatar">${initials}</div>
              <div class="pdp-rev-meta">
                <div class="pdp-rev-name" style="display:flex;align-items:center;gap:6px;">
                  ${r.verified ? 'Verified Buyer' : 'Student'}
                  ${verifiedBadge}
                </div>
                ${dateStr ? `<div class="pdp-rev-loc">📅 ${dateStr}</div>` : ''}
              </div>
              <div class="pdp-rev-stars">${rStars}</div>
            </div>
            ${r.comment ? `<div class="pdp-rev-text">${_esc(r.comment)}</div>` : ''}
          </div>`;
        }).join('');
      }
    }

    // ── Write a Review form ──
    const writeWrap = document.getElementById('pdpWriteReviewWrap');
    if (writeWrap) {
      _pdpRenderReviewForm(writeWrap);
    }
  }
  // No reviews → section stays display:none
}


/* ── _pdpRenderReviewForm + pdpSetReviewStar + pdpSubmitReview ── */
async function _pdpRenderReviewForm(container) {
  if (!container) return;
  const pdf     = window.selectedPdf;
  const pdfId   = pdf?.id;
  const user    = window.currentUser;

  if (!user) {
    container.innerHTML = `<div class="pdp-rev-login-prompt">
      Want to share your experience? <a onclick="navigate('login')">Sign in</a> to leave a review.
    </div>`;
    return;
  }

  // Only students who purchased this PDF may write a review.
  const purchased = typeof window.hasUserPurchasedPdf === 'function'
    ? await window.hasUserPurchasedPdf(pdfId, user.id)
    : false;

  if (!purchased) {
    container.innerHTML = `<div class="pdp-rev-login-prompt">
      Only students who've purchased this PDF can leave a review.
      <a onclick="pdpHandleBuy()">Buy this PDF</a> to unlock reviewing.
    </div>`;
    return;
  }

  // Check for existing review
  let existingReview = null;
  if (typeof window.checkUserReview === 'function') {
    existingReview = await window.checkUserReview(pdfId);
  }

  const selectedRating = existingReview?.rating || 0;
  const existingComment = existingReview?.comment || '';

  container.innerHTML = `
    <div class="pdp-review-form" id="pdpReviewFormBox">
      <div class="pdp-review-form-title">${existingReview ? '✏️ Edit Your Review' : '✍️ Write a Review'}</div>
      <div class="pdp-star-selector" id="pdpFormStars">
        ${[1,2,3,4,5].map(s => `
          <button type="button" class="${s <= selectedRating ? 'active' : ''}"
            data-star="${s}"
            onclick="pdpSetReviewStar(${s})"
            title="${s} star${s > 1 ? 's' : ''}"
            aria-label="${s} stars">★</button>`).join('')}
      </div>
      <textarea class="pdp-review-textarea" id="pdpReviewComment"
        placeholder="Share your experience with this PDF… (optional)"
        maxlength="500">${_esc(existingComment)}</textarea>
      <button class="pdp-review-submit-btn" id="pdpReviewSubmitBtn"
        onclick="pdpSubmitReview()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ${existingReview ? 'Update Review' : 'Submit Review'}
      </button>
      <div id="pdpReviewFormMsg" style="margin-top:8px;font-size:.75rem;font-family:var(--font-ui);display:none"></div>
    </div>`;

  window._pdpCurrentReviewRating = selectedRating;
}

window.pdpSetReviewStar = function pdpSetReviewStar(star) {
  window._pdpCurrentReviewRating = star;
  const btns = document.querySelectorAll('#pdpFormStars button');
  btns.forEach((b, i) => {
    b.classList.toggle('active', i < star);
  });
};

window.pdpSubmitReview = async function pdpSubmitReview() {
  const btn     = document.getElementById('pdpReviewSubmitBtn');
  const msgEl   = document.getElementById('pdpReviewFormMsg');
  const comment = (document.getElementById('pdpReviewComment')?.value || '').trim();
  const rating  = window._pdpCurrentReviewRating || 0;
  const pdfId   = window.selectedPdf?.id;

  if (!rating) {
    if (msgEl) { msgEl.textContent = 'Please select a star rating.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = ''; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  const result = await (window.submitProductReview || function() { return { success: false, error: 'Not available' }; })(pdfId, rating, comment);

  if (btn) { btn.disabled = false; btn.textContent = 'Submit Review'; }

  if (!result.success) {
    if (msgEl) { msgEl.textContent = result.error || 'Failed to submit. Please try again.'; msgEl.style.color = 'var(--danger)'; msgEl.style.display = ''; }
    return;
  }

  const verifiedNote = result.verified ? ' ✓ Marked as verified purchase.' : '';
  if (msgEl) {
    msgEl.textContent = 'Review submitted! Thank you.' + verifiedNote;
    msgEl.style.color = 'var(--success)';
    msgEl.style.display = '';
  }

  // Refresh the detail stats after a short delay
  setTimeout(() => { if (pdfId) _pdpLoadLiveStats(pdfId); }, 800);
};

// ── Load real avg rating onto cards asynchronously ──────────────────────
window._cardRatingCache = window._cardRatingCache || {};


/* ── _pdpSubscribeRealtime ── */
function _pdpSubscribeRealtime(pdfId) {
  if (window._pdpRealtimeSubs) {
    window._pdpRealtimeSubs.forEach(sub => { try { sub.unsubscribe(); } catch(e) {} });
  }
  window._pdpRealtimeSubs = [];
  const client = window.supabaseClient;
  if (!client || !pdfId) return;
  ['downloads','purchases','user_wishlist','pdf_reviews'].forEach(table => {
    try {
      // user_wishlist.pdf_id now stores composite "pdf:<id>"/"job:<id>"
      // keys (see supabase.js wishlist engine), so it can't be matched
      // with a plain eq filter here — listen unfiltered instead and let
      // _pdpLoadLiveStats() do its own scoped count query.
      const config = table === 'user_wishlist'
        ? { event:'*', schema:'public', table }
        : { event:'*', schema:'public', table, filter:`pdf_id=eq.${pdfId}` };
      const sub = client
        .channel(`pdp_${table}_${pdfId}_${Date.now()}`)
        .on('postgres_changes', config, () => { _pdpLoadLiveStats(pdfId); })
        .subscribe();
      window._pdpRealtimeSubs.push(sub);
    } catch(e) { console.warn(`_pdpSubscribeRealtime(${table}):`, e); }
  });
}


/* ── pdpHandleBuy ── */
function pdpHandleBuy() {
  const pdf = window.selectedPdf;
  if (!pdf) return;
  normalizePdf(pdf);
  const price = Number(pdf.price ?? 0);
  // Free PDFs always go through downloadPDF which handles ownership grant
  if (pdf.free) { downloadPDF(pdf.id); return; }

  // NEW PREMIUM PDF CHECKOUT — SPA flow (Buy Now → dedicated checkout page).
  if (window.PCO && typeof window.PCO.open === 'function' &&
      document.getElementById('page-pdf-checkout')) {
    PCO.open(pdf.id);
    return;
  }

  // Standalone /pdf/ static pages (no SPA): send the buyer to the
  // checkout deep link on the main app — same premium checkout for
  // every normal user flow.
  if (!document.getElementById('page-detail')) {
    try {
      const base = location.origin && location.origin !== 'null' ? location.origin : 'https://studyria.qzz.io';
      location.href = base + '/#pdf-checkout/' + encodeURIComponent(pdf.id);
      return;
    } catch (e) { /* fall through to legacy direct buy */ }
  }

  // Legacy fallback (kept only as a safety net for non-SPA contexts)
  buyPDF(pdf.id, price);
}


/* ── pdpToggleWish ── */
async function pdpToggleWish() {
  const pdf = window.selectedPdf;
  if (!pdf) return;
  await toggleWish(pdf.id); // wait for the full toggle (incl. DB write/guest save) before reading state back
  {
    const inWish = window.wishlist.includes(pdf.id) || window.wishlist.includes(String(pdf.id));
    // Update all wish buttons on page
    ['pdpWishBtn','pdpCoverWishBtn','pdpStickyWish'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (id === 'pdpStickyWish') { btn.textContent = inWish ? '💔' : '❤️'; return; }
      if (id === 'pdpCoverWishBtn') {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${inWish?'var(--danger)':'none'}" stroke="${inWish?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>${inWish?'Saved':'Wishlist'}`;
        return;
      }
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${inWish?'var(--danger)':'none'}" stroke="${inWish?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>${inWish?'Saved to Wishlist':'❤️ Add to Wishlist'}`;
    });
  }
}


/* ── _slugifyTitle ── */
function _slugifyTitle(s) {
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);
}

/* ── _pdfStaticUrl ── */
function _pdfStaticUrl(pdf) {
  // Generate the canonical static-page URL matching generate-static-pages.mjs logic
  const slug = _slugifyTitle(pdf.title);
  return 'https://studyria.qzz.io/pdf/' + slug + '.html';
}

/* ── pdpSharePDF ── */
function pdpSharePDF() {
  const pdf = window.selectedPdf;
  if (!pdf) return;
  const url = _pdfStaticUrl(pdf);
  const text = 'Check out "' + pdf.title + '" on Studyria! 📚';
  if (navigator.share) {
    navigator.share({ title: pdf.title, text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied! 📋', 'success')).catch(() => {});
  }
}


// ── WISHLIST ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// WISHLIST SYSTEM — unified PDF + Job engine.
// supabase.js owns all state (wishlist / window.jobWishlist /
// window._wishlistRaw) and all Supabase reads/writes. Everything below
// is thin UI wiring: heart-button rendering + the Wishlist page.
// ══════════════════════════════════════════════════════════════════

// NOTE: loadWishlistFromSupabase is defined once, on window, by
// supabase.js (the authoritative implementation — loop-guarded,
// guest-local fallback, realtime multi-device sync). A local wrapper
// used to be declared here as `function loadWishlistFromSupabase(){}`,
// but because top-level function declarations in a non-module <script>
// become properties of `window` themselves, that wrapper silently
// overwrote window.loadWishlistFromSupabase with itself — and its body
// called `window.loadWishlistFromSupabase()`, i.e. called itself,
// forever. That infinite recursion is what threw "Maximum call stack
// size exceeded" the moment SIGNED_IN fired (e.g. right after Admin
// Login's signInWithPassword() call). Removed. All call sites in this
// file already call window.loadWishlistFromSupabase() directly, so no
// local wrapper is needed.

// ── REFRESH HEART BUTTONS + COUNTS EVERYWHERE ───────────────────────
// Called by supabase.js's _syncWishlistUI() after every load/toggle,
// so Home, Library, PDF Details, Career Hub, Job Details, Wishlist

/* ── _refreshAllWishButtons ── */
function _refreshAllWishButtons() {
  const pdfIds = window.wishlist    || [];
  const jobIds = window.jobWishlist || [];
  const inPdf  = (id) => pdfIds.includes(Number(id)) || pdfIds.includes(String(id));
  const inJob  = (id) => jobIds.includes(Number(id)) || jobIds.includes(String(id));
  const heartSvg = (on) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;

  // Standard heart buttons (Home / Search / PDP / Wishlist page) — PDFs.
  // Job heart buttons use the "wish-job-<id>" id prefix so they never
  // collide with a PDF of the same numeric id.
  document.querySelectorAll('[id^="wish-"]').forEach(btn => {
    const isJob = btn.id.startsWith('wish-job-');
    const id    = isJob ? btn.id.replace('wish-job-', '') : btn.id.replace('wish-', '');
    const nowIn = isJob ? inJob(id) : inPdf(id);
    btn.classList.toggle('active', nowIn);
    btn.title = nowIn ? 'Remove from wishlist' : 'Save to wishlist';
    btn.innerHTML = heartSvg(nowIn);
  });

  // Library "OTT" cards — emoji heart, keyed by data-wish-id (PDFs)
  document.querySelectorAll('.ottlib-wish[data-wish-id]').forEach(btn => {
    const nowIn = inPdf(btn.dataset.wishId);
    btn.classList.toggle('active', nowIn);
    btn.textContent = nowIn ? '❤️' : '🤍';
  });

  // "PDF of the Day" / trending carousel cards — emoji heart (PDFs)
  document.querySelectorAll('.pdl-ott-wish[data-wish-id]').forEach(btn => {
    const nowIn = inPdf(btn.dataset.wishId);
    btn.classList.toggle('active', nowIn);
    btn.textContent = nowIn ? '❤️' : '♡';
  });

  // Job save buttons on Career Hub / Job Details cards, if present —
  // keyed by data-wish-job-id so career-hub.js can adopt this same
  // convention without any risk of colliding with PDF ids.
  document.querySelectorAll('[data-wish-job-id]').forEach(btn => {
    const nowIn = inJob(btn.dataset.wishJobId);
    btn.classList.toggle('active', nowIn);
    btn.classList.toggle('saved', nowIn);
  });

  // Product Details page buttons, if mounted right now
  if (typeof window.selectedPdf !== 'undefined' && window.selectedPdf) {
    const nowIn = inPdf(window.selectedPdf.id);
    ['pdpWishBtn', 'pdpCoverWishBtn', 'pdpStickyWish'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (id === 'pdpStickyWish') { btn.textContent = nowIn ? '💔' : '❤️'; return; }
      if (id === 'pdpCoverWishBtn') {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${nowIn?'var(--danger)':'none'}" stroke="${nowIn?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>${nowIn?'Saved':'Wishlist'}`;
        return;
      }
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${nowIn?'var(--danger)':'none'}" stroke="${nowIn?'var(--danger)':'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>${nowIn?'Saved to Wishlist':'❤️ Add to Wishlist'}`;
    });
  }

  // Counters that live outside renderWishlist()/renderDashboard() cycles
  const libWishEl = document.getElementById('libStatWishlist');
  if (libWishEl) libWishEl.textContent = pdfIds.length;
  const chSavedEl = document.getElementById('chSavedCount');
  if (chSavedEl) chSavedEl.textContent = jobIds.length;
}
// Also expose globally so supabase.js's _syncWishlistUI() can always reach it
window._refreshAllWishButtons = _refreshAllWishButtons;

// toggleWish / toggleWishlist: PDF hearts — delegates to supabase.js's
// toggleWishlistItem (the authoritative version with live getUser(),

/* ── toggleWish + toggleWishlist ── */
async function toggleWish(id) { return window.toggleWishlistItem(id, 'pdf'); }
function toggleWishlist(id) { return toggleWish(id); }
window.toggleWishlist = toggleWishlist;

// toggleJobWish: Job hearts — same engine, 'job' namespace. Wire this
// up from Career Hub / Job Details save buttons, e.g.
//   onclick="event.stopPropagation();toggleJobWish('${job.id}')"
async function toggleJobWish(id) { return window.toggleWishlistItem(id, 'job'); }
window.toggleJobWish = toggleJobWish;

/* ── _loadOwnershipCache ── */
async function _loadOwnershipCache() {
  const client = window.supabaseClient;
  const user = window.currentUser;
  if (!client || !user) return;
  const uid = user.uid || user.id;
  if (!uid) return;
  try {
    // Fetch both 'paid' and 'owned' (free) records
    const { data, error } = await client
      .from('purchased_pdfs')
      .select('pdf_uuid, status')
      .eq('user_id', uid)
      .in('status', ['paid', 'owned']);
    if (error) { console.warn('⚠️ _loadOwnershipCache error:', error.message); return; }
    (data || []).forEach(r => window._ownedPdfIds.add(String(r.pdf_uuid)));
    window._ownedCacheReady = true;
    console.log('✅ Ownership cache loaded:', window._ownedPdfIds.size, 'owned PDFs');
    // Refresh any visible cards so buttons update to "Open PDF"
    _refreshFreeButtonLabels();
  } catch(e) { console.warn('⚠️ _loadOwnershipCache exception:', e); }
}


/* ── _isOwned ── */
function _isOwned(pdfId) {
  return window._ownedPdfIds.has(String(pdfId));
}

// Grant ownership for a free PDF: insert into purchased_pdfs with
// type='free', amount=0, status='owned'. Duplicate-safe via upsert check.

/* ── grantFreeOwnership ── */
async function grantFreeOwnership(pdfId) {
  const client = window.supabaseClient;
  if (!client) { console.warn('⚠️ grantFreeOwnership: no supabase client'); return false; }

  // Get live auth user
  let user = null;
  try {
    const { data: { user: u } } = await client.auth.getUser();
    user = u;
  } catch(e) {}
  if (!user) return false;

  const uid = user.id;
  const pdfUuid = String(pdfId);

  // Already in local cache → skip DB round-trip
  if (_isOwned(pdfUuid)) {
    console.log('ℹ️ grantFreeOwnership: already owned (cache hit)', pdfUuid);
    return true;
  }

  // Check DB for existing record (covers both 'owned' and 'paid')
  try {
    const { data: existing } = await client
      .from('purchased_pdfs')
      .select('id, status')
      .eq('user_id', uid)
      .eq('pdf_uuid', pdfUuid)
      .in('status', ['paid', 'owned'])
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('ℹ️ grantFreeOwnership: already in DB', pdfUuid, existing[0].status);
      window._ownedPdfIds.add(pdfUuid);
      return true;
    }
  } catch(e) { console.warn('⚠️ grantFreeOwnership pre-check error:', e); }

  // Insert ownership record
  const pdf = normalizePdf((window.PDFS || []).find(p => String(p.id) === pdfUuid));
  const insertPayload = {
    user_id:    uid,
    email:      user.email,
    pdf_uuid:   pdfUuid,
    payment_id: 'free_access',
    amount:     0,
    type:       'free',
    status:     'owned',
    created_at: new Date().toISOString()
  };
  console.log('📝 grantFreeOwnership: inserting record', insertPayload);

  try {
    const { data: insertData, error: insertErr } = await client
      .from('purchased_pdfs')
      .insert(insertPayload)
      .select();

    if (insertErr) {
      // If column 'type' or 'amount' doesn't exist yet, retry without them
      if (insertErr.code === '42703' || (insertErr.message && insertErr.message.includes('column'))) {
        console.warn('⚠️ grantFreeOwnership: schema missing type/amount columns, retrying minimal insert');
        const minimal = { user_id: uid, email: user.email, pdf_uuid: pdfUuid, payment_id: 'free_access', status: 'owned' };
        const { error: e2 } = await client.from('purchased_pdfs').insert(minimal);
        if (e2) { console.error('❌ grantFreeOwnership minimal insert failed:', e2.message); return false; }
      } else {
        console.error('❌ grantFreeOwnership insert failed:', insertErr.message);
        return false;
      }
    } else {
      console.log('✅ grantFreeOwnership: ownership record created', insertData);
    }

    // Add to local cache immediately
    window._ownedPdfIds.add(pdfUuid);
    // Bust dashboard cache so My Library reflects new item
    window._dashCache = null;
    // Refresh stats + library in background
    _refreshDashStats?.();
    // Update button labels everywhere
    _refreshFreeButtonLabels();
    return true;
  } catch(e) {
    console.error('❌ grantFreeOwnership exception:', e);
    return false;
  }
}

// Refresh all "Download Free" buttons to "Open PDF" for owned free PDFs.

/* ── trackPdfDownloadEvent ── */
function trackPdfDownloadEvent(pdf, userType) {
  try {
    if (!pdf || !pdf.id) return;
    const pdfId = String(pdf.id);
    const now = Date.now();
    const last = window._pdfDownloadFireGuard.get(pdfId) || 0;
    if (now - last < 2000) return; // debounce: collapse accidental double-fire within 2s
    window._pdfDownloadFireGuard.set(pdfId, now);

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event:     'pdf_download',
      pdf_title: pdf.title || '',
      pdf_id:    pdfId,
      category:  pdf.category || '',
      price:     Number(pdf.price ?? 0),
      author:    pdf.author || '',
      user_type: userType || (pdf.free ? 'free_user' : 'premium_user'),
      timestamp: new Date().toISOString(),
      page_url:  window.location.href
    });
  } catch(e) { console.error('❌ pdf_download GA4 tracking error:', e); }
}

/* ── downloadPDF ── */
async function downloadPDF(pdfId, _legacyUrl) {
  // _legacyUrl is intentionally ignored — we ALWAYS fetch the fresh URL from
  // the database to avoid stale / broken URLs embedded in HTML onclick attrs.

  const pdf = normalizePdf((window.PDFS || []).find(p => String(p.id) === String(pdfId)));
  if (!pdf) {
    // PDF not in local cache — try fetching from DB
    if (window.supabaseClient) {
      try {
        const { data } = await window.supabaseClient.from('pdfs').select('*').eq('id', pdfId).single();
        if (data) {
          normalizePdf(data);
          window.PDFS.push(data);
          return downloadPDF(pdfId);
        }
      } catch(e) {}
    }
    showToast('PDF not found in library.', 'error');
    return;
  }

  // ── STEP 1: Login check ───────────────────────────────────────
  let user = null;
  try {
    const { data: { user: u } } = await window.supabase.auth.getUser();
    user = u;
  } catch(e) {}

  if (!user) {
    showToast('Please login to download.', 'info');
    navigate('login');
    return;
  }

  // ── ALWAYS fetch fresh pdf_url from database ──────────────────
  let pdfUrl = '';
  const client = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  if (client) {
    try {
      const { data: bookRow, error: fetchErr } = await client
        .from('pdfs')
        .select('*')
        .eq('id', pdfId)
        .single();
      if (fetchErr) console.error('❌ DB fetch error:', fetchErr.message);
      if (bookRow) {
        // ── EXACT REQUESTED DEBUG LOGS ──────────────────────────
        console.log('PDF Record:', bookRow);
        console.log('PDF URL From DB:', bookRow.pdf_url);
        pdfUrl = bookRow.pdf_url || '';
      }
    } catch(e) { console.error('❌ DB fetch exception:', e); }
  }

  // Fallback to in-memory value if DB unreachable
  if (!pdfUrl) pdfUrl = pdf.pdfUrl || pdf.pdf_url || '';

  // ── HELPER: Resolve pdf_url → signed URL (pdfs bucket is PRIVATE) ───
  //
  // Rules (in order):
  //  1. If rawUrl is a bare path/filename (no http prefix)
  //     → generate a 1-hour signed URL via storage.from('pdfs').createSignedUrl().
  //  2. If rawUrl is already a full https Supabase storage URL
  //     → extract the storage object path and re-sign it, because the stored
  //        URL may be a stale public URL that no longer works on a private bucket.
  //
  // Returns: { signedUrl: string } or { signedUrl: '', error: string }
  const VALID_PDF_BUCKET = 'pdfs';

  async function resolvePdfUrlAsync(rawUrl) {
    if (!rawUrl || rawUrl === '#') return { signedUrl: '', error: 'No URL provided' };

    console.log('🔍 [PDF URL] resolvePdfUrlAsync called with:', rawUrl);

    const storageClient = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (!storageClient) {
      console.error('❌ [PDF URL] No Supabase client available');
      return { signedUrl: '', error: 'No Supabase client' };
    }

    // Determine the storage object path to sign
    let filePath = rawUrl;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      // Extract path after /object/public/<bucket>/ or /object/sign/<bucket>/
      const match = rawUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
      if (match) {
        filePath = decodeURIComponent(match[1]);
        console.log('🔍 [PDF URL] Extracted storage path from full URL:', filePath);
      } else {
        // URL is not a Supabase storage URL (e.g. external link) — open as-is
        console.log('✅ [PDF URL] Non-storage full URL — opening directly:', rawUrl);
        return { signedUrl: rawUrl };
      }
    }

    // Generate signed URL — valid for 1 hour (3600 seconds)
    const { data, error } = await storageClient.storage
      .from(VALID_PDF_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) {
      console.error('❌ [PDF URL] createSignedUrl failed | path:', filePath, '| error:', error.message);
      return { signedUrl: '', error: error.message };
    }

    console.log('✅ [PDF URL] Signed URL created | path:', filePath, '| url:', data.signedUrl);
    return { signedUrl: data.signedUrl };
  }

  // ── STEP 2: Free PDF — grant ownership then open ─────────────
  if (pdf.free) {
    const { signedUrl: resolvedUrl, error: resolveErr } = await resolvePdfUrlAsync(pdfUrl);
    // ── EXACT REQUESTED DEBUG LOG ───────────────────────────────
    console.log('Final URL Opened:', resolvedUrl);
    console.log('🆓 [Free PDF] pdfId:', pdfId, '| pdf_url from DB:', pdfUrl, '| final signed URL to open:', resolvedUrl);
    if (resolvedUrl) {
      // ── UNIFIED OWNERSHIP: grant before opening ──────────────
      const alreadyOwned = _isOwned(String(pdfId));
      await grantFreeOwnership(pdfId);
      // ── Open the PDF ─────────────────────────────────────────
      window.open(resolvedUrl, '_blank');
      trackReadingSession(pdfId);
      trackPdfDownloadEvent(pdf, 'free_user');
      const toastMsg = alreadyOwned
        ? `Opening "${pdf.title}" \uD83D\uDCD6`
        : `"${pdf.title}" added to your library! \uD83D\uDCDA`;
      showToast(toastMsg, 'success');
    } else {
      console.error('❌ [Free PDF] Could not resolve URL:', resolveErr);
      showToast('PDF link not available. Contact support.', 'error');
      return;
    }
    if (typeof window.sendToPipedream === 'function') {
      window.sendToPipedream({
        event: 'pdf_download',
        pdf_id: pdf.id,
        pdf_title: pdf.title,
        email: user.email,
        amount: 0,
        status: 'free'
      });
    }
    return;
  }

  // ── STEP 3: Supabase purchase check ──────────────────────────
  // Check by user_id (canonical — RLS-friendly) with email as fallback.
  showToast('Checking purchase…', 'info');
  let alreadyPaid = false;
  try {
    const _checkClient = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (_checkClient) {
      const { data: uidRows, error: uidErr } = await _checkClient
        .from('purchased_pdfs')
        .select('id')
        .eq('user_id', user.id)
        .eq('pdf_uuid', String(pdfId))
        .in('status', ['paid', 'owned']);

      if (uidErr) console.warn('⚠️ Ownership check (user_id) error:', uidErr.message);

      alreadyPaid = uidRows && uidRows.length > 0;

      // Email fallback for rows inserted before user_id fix
      if (!alreadyPaid) {
        const { data: emailRows, error: emailErr } = await _checkClient
          .from('purchased_pdfs')
          .select('id')
          .eq('email', user.email)
          .eq('pdf_uuid', String(pdfId))
          .in('status', ['paid', 'owned']);
        if (emailErr) console.warn('⚠️ Ownership check (email) error:', emailErr.message);
        alreadyPaid = emailRows && emailRows.length > 0;
      }

      console.log('🔍 Ownership check result — alreadyPaid:', alreadyPaid, 'for pdf_uuid:', pdfId);
    }
  } catch(e) {
    console.error("Supabase ownership check exception:", e);
  }

  // ── STEP 4: Already paid → open PDF ──────────────────────────
  if (alreadyPaid) {
    const { signedUrl: resolvedPaidUrl, error: paidResolveErr } = await resolvePdfUrlAsync(pdfUrl);
    console.log('💎 [Paid PDF] pdfId:', pdfId, '| pdf_url:', pdfUrl, '| final signed URL:', resolvedPaidUrl);
    if (resolvedPaidUrl) {
      window.open(resolvedPaidUrl, '_blank');
      trackReadingSession(pdfId);
      trackPdfDownloadEvent(pdf, 'premium_user');
      showToast('Download started! 📥', 'success');
    } else {
      console.error('❌ [Paid PDF] Could not resolve URL:', paidResolveErr);
      showToast('PDF link not available. Contact support.', 'error');
    }
    return;
  }

  // ── STEP 4.5: Premium Membership bypass ───────────────────────
  // If the user has an active Premium Membership, bypass ALL payment checks.
  // Premium members get unlimited access to all Premium Library content.
  // Never create a Razorpay order, never show payment UI for premium members.
  if (window.SMCI && typeof window.SMCI.isPremium === 'function') {
    try {
      const _isPrem = await window.SMCI.isPremium();
      if (_isPrem) {
        console.log('[Premium Bypass] User has active premium membership — bypassing payment for pdfId:', pdfId);
        const { signedUrl: _premUrl, error: _premErr } = await resolvePdfUrlAsync(pdfUrl);
        if (_premUrl) {
          window.open(_premUrl, '_blank');
          trackReadingSession(pdfId);
          trackPdfDownloadEvent(pdf, 'premium_user');
          showToast('Opening Pass PDF… 👑', 'success');
        } else {
          console.error('[Premium Bypass] Could not resolve URL:', _premErr);
          showToast('PDF link not available. Contact support.', 'error');
        }
        return; // NEVER reach Razorpay for premium members
      }
    } catch(e) {
      console.warn('[Premium Bypass] SMCI.isPremium check failed:', e.message);
    }
  }

  // ── STEP 5: Not paid → open Razorpay ─────────────────────────
  if (typeof Razorpay === 'undefined') {
    showToast('Payment gateway loading… please try again.', 'info');
    return;
  }

  const amount = Number(pdf.price ?? 0);

  const rzpOptions = {
    key: "rzp_live_SxcnO1cOS2HAJT",
    amount: amount * 100,   // paise
    currency: "INR",
    name: "Studyria",
    description: pdf.title,
    prefill: {
      email: user.email,
      name: user.user_metadata?.full_name || ""
    },
    theme: { color: "#930205" },

    handler: async function (response) {
      const paymentId = response.razorpay_payment_id;
      console.log('💳 Razorpay success callback fired. payment_id:', paymentId, '| pdf_uuid:', pdfId, '| user:', user.id, user.email);

      // ── 5a. Save purchase record to Supabase ──────────────────────
      const client = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
      if (!client) {
        console.error('❌ CRITICAL: No Supabase client available in payment handler!');
      } else {
        try {
          // Duplicate guard: check by user_id + pdf_uuid only (canonical columns)
          const { data: existRows, error: checkErr } = await client
            .from('purchased_pdfs')
            .select('id')
            .eq('user_id', user.id)
            .eq('pdf_uuid', String(pdfId))
            .eq('status', 'paid');

          if (checkErr) {
            console.warn('⚠️ Duplicate-check query error (proceeding with insert):', checkErr.message, checkErr);
          }

          const alreadyExists = existRows && existRows.length > 0;
          console.log('🔍 Duplicate check result — alreadyExists:', alreadyExists, '| rows:', existRows);

          if (!alreadyExists) {
            // INSERT only the columns that exist in your schema:
            // purchased_pdfs(id, user_id, email, pdf_uuid, payment_id, status)
            const insertPayload = {
              user_id:    user.id,
              email:      user.email,
              pdf_uuid:   String(pdfId),
              payment_id: paymentId,
              status:     'paid'
            };
            console.log('📝 Inserting purchased_pdfs row:', insertPayload);

            const { data: insertData, error: insertErr } = await client
              .from('purchased_pdfs')
              .insert(insertPayload)
              .select();

            if (insertErr) {
              console.error('❌ PURCHASE INSERT FAILED:', {
                message: insertErr.message,
                code:    insertErr.code,
                hint:    insertErr.hint,
                details: insertErr.details,
                payload: insertPayload
              });
              showToast('⚠️ Payment received but library save failed. Contact support with payment ID: ' + paymentId, 'error');
            } else {
              console.log('✅ purchased_pdfs INSERT SUCCESS:', insertData);
              cpCreditCreatorSale(pdfId, amount);
              // Bust cache so My Library loads fresh
              window._dashCache = null;
            }
          } else {
            console.log('ℹ️ Purchase record already exists — skipping duplicate insert.');
          }
        } catch(e) {
          console.error('❌ Supabase purchase record exception:', e);
        }
      }

      // ── 5b. pdfUrl was already fetched from DB above — use it directly ──
      console.log('✅ Opening PDF after payment:', pdfUrl);

      // ── 5c. Notify Pipedream webhook ──────────────────────────────
      try {
        await fetch("https://eod16l3iacfjwl6.m.pipedream.net", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email:      user.email,
            user_id:    user.id,
            pdf_uuid:   String(pdfId),
            payment_id: paymentId,
            status:     "paid"
          })
        });
      } catch(e) {
        console.error("Pipedream webhook error:", e);
      }

      // ── 5d. Open PDF immediately after payment ────────────────────
      showToast(`Payment successful! 🎉 Downloading "${pdf.title}"…`, 'success');
      const { signedUrl: resolvedPostPayUrl, error: postPayErr } = await resolvePdfUrlAsync(pdfUrl);
      console.log('💳 [Post-Payment PDF] pdfId:', pdfId, '| pdf_url:', pdfUrl, '| final signed URL:', resolvedPostPayUrl);
      if (resolvedPostPayUrl) {
        window.open(resolvedPostPayUrl, '_blank');
        trackReadingSession(pdfId);
        trackPdfDownloadEvent(pdf, 'premium_user');
      } else {
        console.error('❌ [Post-Payment PDF] Could not resolve URL:', postPayErr);
        showToast('PDF link not available yet. Contact support.', 'info');
      }
      // Bust dashboard cache and refresh stats
      window._dashCache = null;
      _refreshDashStats();
    },

    modal: {
      ondismiss: function () {
        showToast('Payment cancelled.', 'info');
      }
    }
  };

  const rzp = new Razorpay(rzpOptions);
  rzp.open();
}

// ══════════════════════════════════════════════════════════════════
// ── buyPDF — Clean Razorpay + Pipedream + Open PDF ───────────────

/* ── buyPDF ── */
async function buyPDF(pdfId, amount, _legacyUrl) {
  // _legacyUrl intentionally ignored — always fetch fresh from DB
  // ── LOGIN GUARD ───────────────────────────────────────────────────
  let buyUser = null;
  try {
    const client = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (client) {
      const { data: { user: u } } = await client.auth.getUser();
      buyUser = u;
    }
  } catch(e) {}

  if (!buyUser) {
    showToast('Please login to purchase this PDF.', 'info');
    navigate('login');
    return;
  }

  // Look up full PDF record (for GA4 pdf_download event fields) — falls
  // back to a minimal object with just id/price if not in the local cache.
  const pdf = normalizePdf((window.PDFS || []).find(p => String(p.id) === String(pdfId))) || { id: pdfId, price: amount };

  // ── PRE-PURCHASE CHECK — never open Razorpay if already paid ─────
  console.log('Current User ID:', buyUser?.id);
  console.log('Current PDF UUID:', pdfId);
  const _preCheckClient = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  let existingPurchase = null;
  if (_preCheckClient) {
    try {
      const { data: _ep, error: _epErr } = await _preCheckClient
        .from('purchased_pdfs')
        .select('*')
        .eq('user_id', buyUser.id)
        .eq('pdf_uuid', String(pdfId))
        .eq('status', 'paid')
        .maybeSingle();
      if (_epErr) console.warn('⚠️ buyPDF pre-check error:', _epErr.message, _epErr);
      existingPurchase = _ep;
    } catch(e) {
      console.error('❌ buyPDF pre-check exception:', e);
    }
  }
  console.log('Existing Purchase:', existingPurchase);

  if (existingPurchase) {
    // Already purchased — fetch PDF URL and open via signed URL
    showToast('✅ Already Purchased — opening your PDF…', 'success');
    let ownedUrl = '';
    try {
      if (_preCheckClient) {
        const { data: bookRow } = await _preCheckClient
          .from('pdfs')
          .select('pdf_url')
          .eq('id', pdfId)
          .single();
        ownedUrl = bookRow?.pdf_url || '';
      }
    } catch(e) {}
    if (ownedUrl && ownedUrl !== '#') {
      // Resolve via signed URL — pdfs bucket is private
      const _sc = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
      let _filePath = ownedUrl;
      if (ownedUrl.startsWith('http://') || ownedUrl.startsWith('https://')) {
        const _m = ownedUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
        if (_m) _filePath = decodeURIComponent(_m[1]);
        else { window.open(ownedUrl, '_blank'); trackReadingSession(pdfId); trackPdfDownloadEvent(pdf, 'premium_user'); return; }
      }
      const { data: _sd, error: _se } = await _sc.storage.from('pdfs').createSignedUrl(_filePath, 3600);
      if (_se) {
        console.error('❌ [buyPDF already-owned] createSignedUrl failed:', _se.message);
        showToast('PDF link not available. Contact support.', 'error');
      } else {
        console.log('✅ [buyPDF already-owned] Signed URL:', _sd.signedUrl);
        window.open(_sd.signedUrl, '_blank');
        trackReadingSession(pdfId);
        trackPdfDownloadEvent(pdf, 'premium_user');
      }
    } else {
      showToast('📚 Already Purchased — visit My Library to open this PDF.', 'info');
      navigate('library');
    }
    return;
  }

  // ── PREMIUM MEMBERSHIP BYPASS ────────────────────────────────────
  // Active Premium Members must NEVER see Razorpay for Premium Library content.
  // Check membership status and open the PDF directly if premium.
  if (window.SMCI && typeof window.SMCI.isPremium === 'function') {
    try {
      const _isPrem = await window.SMCI.isPremium();
      if (_isPrem) {
        console.log('[buyPDF Premium Bypass] User has active premium — opening PDF directly, skipping Razorpay');
        let _premUrl = '';
        try {
          const _pClient = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
          if (_pClient) {
            const { data: _pRow } = await _pClient.from('pdfs').select('pdf_url').eq('id', pdfId).single();
            if (_pRow) _premUrl = _pRow.pdf_url || '';
          }
        } catch(e) {}
        if (!_premUrl) _premUrl = pdf.pdf_url || pdf.pdfUrl || '';
        if (_premUrl && _premUrl !== '#') {
          const _sc = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
          let _filePath = _premUrl;
          if (_premUrl.startsWith('http://') || _premUrl.startsWith('https://')) {
            const _m = _premUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
            if (_m) _filePath = decodeURIComponent(_m[1]);
            else { window.open(_premUrl, '_blank'); trackReadingSession(pdfId); trackPdfDownloadEvent(pdf, 'premium_user'); return; }
          }
          if (_sc) {
            const { data: _sd, error: _se } = await _sc.storage.from('pdfs').createSignedUrl(_filePath, 3600);
            if (_se) {
              console.error('[buyPDF Premium Bypass] createSignedUrl failed:', _se.message);
              showToast('PDF link not available. Contact support.', 'error');
            } else {
              window.open(_sd.signedUrl, '_blank');
              trackReadingSession(pdfId);
              trackPdfDownloadEvent(pdf, 'premium_user');
              showToast('Opening Pass PDF… 👑', 'success');
            }
          } else {
            window.open(_premUrl, '_blank');
            trackReadingSession(pdfId);
            trackPdfDownloadEvent(pdf, 'premium_user');
          }
        } else {
          showToast('PDF link not available. Contact support.', 'error');
        }
        return; // NEVER reach Razorpay for premium members
      }
    } catch(e) {
      console.warn('[buyPDF Premium Bypass] SMCI.isPremium check failed:', e.message);
    }
  }

  // ── FETCH REAL PDF URL FROM DATABASE ─────────────────────────────
  let pdfUrl = '';
  try {
    const client = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (client) {
      const { data: bookRow, error: fetchErr } = await client
        .from('pdfs')
        .select('pdf_url')
        .eq('id', pdfId)
        .single();
      if (fetchErr) console.error('❌ buyPDF DB fetch error:', fetchErr.message);
      if (bookRow?.pdf_url) {
        pdfUrl = bookRow.pdf_url;
        console.log('✅ Opening PDF (buy):', pdfUrl);
      }
    }
  } catch(e) { console.error('❌ buyPDF fetch exception:', e); }

  const options = {
    key: "rzp_live_SxcnO1cOS2HAJT",
    amount: amount * 100,
    currency: "INR",
    name: "Studyria",
    description: "PDF Purchase",
    prefill: {
      email: buyUser.email,
      name: buyUser.user_metadata?.full_name || ""
    },
    theme: { color: "#930205" },

    handler: async function (response) {
      const paymentId = response.razorpay_payment_id;
      const client = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
      console.log('💳 buyPDF: Razorpay success. payment_id:', paymentId, '| pdf_uuid:', pdfId, '| user:', buyUser.id, buyUser.email);

      // ── Save purchase record to Supabase (with duplicate guard) ──
      if (!client) {
        console.error('❌ CRITICAL: No Supabase client in buyPDF payment handler!');
      } else {
        try {
          // Duplicate guard: use user_id + pdf_uuid (canonical columns only)
          const { data: existRows, error: checkErr } = await client
            .from('purchased_pdfs')
            .select('id')
            .eq('user_id', buyUser.id)
            .eq('pdf_uuid', String(pdfId))
            .eq('status', 'paid');

          if (checkErr) {
            console.warn('⚠️ buyPDF duplicate-check error (proceeding with insert):', checkErr.message, checkErr);
          }

          const alreadyExists2 = existRows && existRows.length > 0;
          console.log('🔍 buyPDF duplicate check — alreadyExists:', alreadyExists2, '| rows:', existRows);

          if (!alreadyExists2) {
            // INSERT only columns that exist in schema:
            // purchased_pdfs(id, user_id, email, pdf_uuid, payment_id, status)
            const insertPayload = {
              user_id:    buyUser.id,
              email:      buyUser.email,
              pdf_uuid:   String(pdfId),
              payment_id: paymentId,
              status:     'paid'
            };
            console.log('📝 buyPDF: Inserting purchased_pdfs row:', insertPayload);

            const { data: insertData, error: insertErr } = await client
              .from('purchased_pdfs')
              .insert(insertPayload)
              .select();

            if (insertErr) {
              console.error('❌ buyPDF PURCHASE INSERT FAILED:', {
                message: insertErr.message,
                code:    insertErr.code,
                hint:    insertErr.hint,
                details: insertErr.details,
                payload: insertPayload
              });
              showToast('⚠️ Payment received but library save failed. Contact support with ID: ' + paymentId, 'error');
            } else {
              console.log('✅ buyPDF purchased_pdfs INSERT SUCCESS:', insertData);
              cpCreditCreatorSale(pdfId, amount);
              window._dashCache = null;
            }
          } else {
            console.log('ℹ️ buyPDF: Purchase record already exists — skipping duplicate insert.');
          }
        } catch(e) {
          console.error('❌ buyPDF Supabase purchase record exception:', e);
        }
      }

      // ── Send to Pipedream webhook ─────────────────────────────────
      try {
        await fetch("https://eod16l3iacfjwl6.m.pipedream.net", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email:      buyUser.email,
            user_id:    buyUser.id,
            pdf_uuid:   String(pdfId),
            payment_id: paymentId,
            status:     "paid"
          })
        });
      } catch(e) {
        console.error('Pipedream webhook error:', e);
      }

      // ── Open PDF ──────────────────────────────────────────────────
      showToast('Payment successful! 🎉 PDF opening…', 'success');
      // Resolve via signed URL — pdfs bucket is PRIVATE, getPublicUrl does not work.
      {
        const _sc2 = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
        let _fp2 = pdfUrl;
        if (pdfUrl && (pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://'))) {
          const _m2 = pdfUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
          if (_m2) _fp2 = decodeURIComponent(_m2[1]);
        }
        if (_fp2 && _fp2 !== '#' && _sc2) {
          const { data: _sd2, error: _se2 } = await _sc2.storage.from('pdfs').createSignedUrl(_fp2, 3600);
          if (_se2) {
            console.error('❌ [buyPDF post-payment] createSignedUrl failed:', _se2.message);
            showToast('PDF link not available yet. Contact support.', 'info');
          } else {
            console.log('💳 [buyPDF Post-Payment] pdfUrl from DB:', pdfUrl, '| path:', _fp2, '| signed URL:', _sd2.signedUrl);
            window.open(_sd2.signedUrl, '_blank');
            trackReadingSession(pdfId);
            trackPdfDownloadEvent(pdf, 'premium_user');
          }
        } else {
          showToast('PDF link not available yet. Contact support.', 'info');
        }
      }
      // Bust dashboard cache so stats update instantly
      window._dashCache = null;
      _refreshDashStats();
    },

    modal: {
      ondismiss: function () {
        showToast('Payment cancelled.', 'info');
      }
    }
  };

  if (typeof Razorpay === 'undefined') {
    showToast('Payment gateway loading… please try again.', 'info');
    return;
  }
  new Razorpay(options).open();
}


/* ── trackReadingSession ── */
async function trackReadingSession(pdfId) {
  const client = window.supabaseClient;
  const user = window.currentUser;
  if (!client || !user) return;

  try {
    const _rsUserId = user.id || user.uid;
    const nowIso = new Date().toISOString();
    console.log(`📖 trackReadingSession: pdfId=${pdfId}, user=${_rsUserId}`);

    // 1. Insert reading session row
    const { error: rsErr } = await client.from('reading_sessions').insert({
      user_id: _rsUserId,
      pdf_id: String(pdfId),
      total_seconds: READING_CREDIT_SECONDS,
      opened_at: nowIso
    });
    if (rsErr) console.warn('⚠️ reading_sessions insert error:', rsErr.message);
    else console.log(`✅ Reading session recorded: +${READING_CREDIT_SECONDS}s for pdf ${pdfId}`);

    // 2. Update pdf_analytics: last_opened_at, opened_count, first_opened_at
    //    Uses upsert so it works even if row doesn't exist yet.
    const { data: existing } = await client
      .from('pdf_analytics')
      .select('opened_count, first_opened_at')
      .eq('pdf_id', String(pdfId))
      .eq('user_id', _rsUserId)
      .maybeSingle();

    const newOpened = ((existing?.opened_count) || 0) + 1;
    const firstOpened = existing?.first_opened_at || nowIso;

    await client.from('pdf_analytics').upsert({
      pdf_id: String(pdfId),
      user_id: _rsUserId,
      opened_count: newOpened,
      last_opened_at: nowIso,
      first_opened_at: firstOpened,
    }, { onConflict: 'pdf_id,user_id' });

    // Bust cache so next dashboard visit shows updated hours
    window._dashCache = null;
    _refreshDashStats();
  } catch (e) {
    console.error('❌ trackReadingSession exception:', e);
  }
}


// ── Export all functions to window ──────────────────────────────────
window.normalizePdf = normalizePdf;
window.seededRand = seededRand;
window.showToast = showToast;
window._pdpSeed = _pdpSeed;
window._pdpMarketingData = _pdpMarketingData;
window._pdpLoadLiveStats = _pdpLoadLiveStats;
window._pdpApplyLiveStats = _pdpApplyLiveStats;
window._pdpRenderReviewForm = _pdpRenderReviewForm;
window.pdpSetReviewStar = pdpSetReviewStar;
window.pdpSubmitReview = pdpSubmitReview;
window._pdpSubscribeRealtime = _pdpSubscribeRealtime;
window.pdpHandleBuy = pdpHandleBuy;
window.pdpToggleWish = pdpToggleWish;
window._slugifyTitle = _slugifyTitle;
window._pdfStaticUrl = _pdfStaticUrl;
window.pdpSharePDF = pdpSharePDF;
window._refreshAllWishButtons = _refreshAllWishButtons;
window.toggleWish = toggleWish;
window.toggleWishlist = toggleWishlist;
window._loadOwnershipCache = _loadOwnershipCache;
window._isOwned = _isOwned;
window.grantFreeOwnership = grantFreeOwnership;
window.trackPdfDownloadEvent = trackPdfDownloadEvent;
window.downloadPDF = downloadPDF;
window.buyPDF = buyPDF;
window.trackReadingSession = trackReadingSession;

// ── Toast fallback for standalone pages (no #toastContainer) ──────
if (!document.getElementById('toastContainer')) {
  const tc = document.createElement('div');
  tc.id = 'toastContainer';
  tc.className = 'toast-container';
  tc.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;pointer-events:none;display:flex;flex-direction:column;gap:8px;';
  document.body.appendChild(tc);
}

// ── navigate() stub for standalone pages ───────────────────────────
if (typeof window.navigate !== 'function') {
  window.navigate = function(page) {
    if (page === 'dashboard') window.location.href = '/#dashboard';
    else if (page === 'login') window.location.href = '/#login';
    else if (page === 'library') window.location.href = '/#library';
  };
}

})();
