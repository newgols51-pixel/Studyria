/**
 * mpa-pdp-bridge.js  — Studyria MPA Product Page Bridge
 * ═══════════════════════════════════════════════════════════════════════════
 * This file provides the buy/download/wishlist logic that lives in index.html
 * to standalone MPA pages like /pdf/<slug>.html (which don't load index.html).
 *
 * Loaded by: pdf-detail.template.html (after supabase.js)
 * NOT needed on: index.html (already has these inline)
 *
 * Exports (via window.*):
 *   window.normalizePdf, window.showToast,
 *   window.downloadPDF, window.buyPDF,
 *   window.pdpHandleBuy, window.grantFreeOwnership
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function() {
'use strict';

// ── Guard: if index.html is the host, these are already defined ────────────
if (typeof window._mpaBridgeLoaded !== 'undefined') return;
window._mpaBridgeLoaded = true;

// ── Shims needed by extracted functions ───────────────────────────────────
window.PDFS             = window.PDFS             || [];
window._ownedPdfIds     = window._ownedPdfIds     || new Set();
window._pdfDownloadFireGuard = window._pdfDownloadFireGuard || new Map();
window.dataLayer        = window.dataLayer        || [];

// navigate shim for MPA pages (no SPA router)
if (typeof window.navigate !== 'function') {
  window.navigate = function(page) {
    if (page === 'login') {
      window.location.href = '/?page=login';
    }
  };
}

// selectedPdf shim — V3 sets window.selectedPdf when it hydrates
// pdpHandleBuy reads it; on MPA it IS window.selectedPdf set by pdp-v3.js
if (typeof window.selectedPdf === 'undefined') window.selectedPdf = null;

// ── Extracted functions ────────────────────────────────────────────────────

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


function showToast(msg, type = 'info') {
  const id = ++toastId;
  const icon = type === 'success' ? '#ic-check' : '#ic-zap';
  const el = document.createElement('div');
  el.className = 'toast card';
  el.innerHTML = `<svg width="16" height="16" style="color:var(--accent);flex-shrink:0"><use href="${icon}"/></svg><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}


function _isOwned(pdfId) {
  return window._ownedPdfIds.has(String(pdfId));
}

// Grant ownership for a free PDF: insert into purchased_pdfs with
// type='free', amount=0, status='owned'. Duplicate-safe via upsert check.
// Returns true if newly granted or already owned.


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
// Targets the PDF card buttons rendered by pdfCardHTML.
function _refreshFreeButtonLabels() {
  if (!window._ownedCacheReady && window._ownedPdfIds.size === 0) return;
  // Update card action buttons: data-pdf-id attribute on the container
  document.querySelectorAll('[data-free-btn]').forEach(btn => {
    const pid = btn.getAttribute('data-free-btn');
    if (pid && _isOwned(pid)) {
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`;
      btn.style.background = 'var(--grad-success)';
    }
  });
  // Update PDP sticky bar and main button if on detail page
  const pdpBuyBtn = document.querySelector('.pdp-buy-primary');
  const stickyBuy = document.getElementById('pdpStickyBuy');
  const pdf = window.selectedPdf;
  if (pdf && pdf.free && _isOwned(String(pdf.id))) {
    if (pdpBuyBtn) {
      pdpBuyBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`;
      pdpBuyBtn.style.background = 'var(--grad-success)';
    }
    if (stickyBuy) stickyBuy.textContent = '⚡ Open PDF';
    // Update bottom CTA
    const ctaBtn = document.querySelector('.pdp-cta-btn');
    if (ctaBtn) ctaBtn.textContent = '⚡ Open PDF';
    // Update mobile price block button
    const mobilePriceBtn = document.querySelector('.pdp-mobile-price-card .pdp-buy-primary');
    if (mobilePriceBtn) {
      mobilePriceBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`;
      mobilePriceBtn.style.background = 'var(--grad-success)';
    }
  }
  // Update popular downloads list buttons
  document.querySelectorAll('[data-pdl-free-btn]').forEach(btn => {
    const pid = btn.getAttribute('data-pdl-free-btn');
    if (pid && _isOwned(pid)) {
      btn.textContent = '→ Open';
      btn.style.background = 'var(--grad-success)';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// ── UNIFIED DOWNLOAD UNLOCK SYSTEM ───────────────────────────────
//    Flow: Login check → Supabase check → Paid? Open PDF : Razorpay
// ══════════════════════════════════════════════════════════════════

// handleBuy kept for backward compat (detail page Buy Now button)
function handleBuy(id) {
  const pdf = normalizePdf((window.PDFS || []).find(p => String(p.id) === String(id)));
  if (!pdf) return;
  if (pdf.free) {
    downloadPDF(pdf.id);
  } else {
    const price = Number(pdf.price ?? 0);
    buyPDF(pdf.id, price);
  }
}

// ══════════════════════════════════════════════════════════════════
// ── GA4 PDF Download Event Tracking (via GTM dataLayer) ─────────────
// Fires the `pdf_download` GA4 event (through GTM's dataLayer) once per
// successful PDF download/open action. Called only from the success
// branches of downloadPDF / buyPDF / triggerPDFDownload — i.e. only
// AFTER a signed URL was resolved and window.open()/anchor-click
// actually fired. A short per-pdf debounce guards against the same
// action accidentally pushing the event twice (e.g. a double click or
// a function re-entry) without blocking a genuine later re-download.
// ══════════════════════════════════════════════════════════════════
window._pdfDownloadFireGuard = window._pdfDownloadFireGuard || new Map();


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
    const { data: { user: u } } = await supabase.auth.getUser();
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
    theme: { color: "#3d8ef8" },

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
// ══════════════════════════════════════════════════════════════════


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
    theme: { color: "#3d8ef8" },

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


function pdpHandleBuy() {
  const pdf = selectedPdf;
  if (!pdf) return;
  normalizePdf(pdf);
  const price = Number(pdf.price ?? 0);
  // Free PDFs always go through downloadPDF which handles ownership grant
  if (pdf.free) downloadPDF(pdf.id);
  else buyPDF(pdf.id, price);
}


// ── Expose to window (so V3 can call window.downloadPDF etc) ─────────────
window.normalizePdf           = normalizePdf;
window.showToast              = window.showToast || showToast;
window._isOwned               = _isOwned;
window.grantFreeOwnership     = grantFreeOwnership;
window.trackPdfDownloadEvent  = trackPdfDownloadEvent;
window.downloadPDF            = downloadPDF;
window.buyPDF                 = buyPDF;
window.pdpHandleBuy           = pdpHandleBuy;

})();
