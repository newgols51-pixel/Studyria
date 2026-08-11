// pdf-list.js — Studyria  Phase 1 (updated)
// Merges Supabase pdfs into the shared PDFS array on load.
// Runs after supabase.js sets window.supabaseClient.
// ══════════════════════════════════════════════════════════════════
//
// ── WHY WE MUTATE IN PLACE (do NOT change this) ─────────────────
// index.html declares:
//     const PDFS = [];
//     window.PDFS = PDFS;
// Both `PDFS` (bare binding used all over index.html) and
// `window.PDFS` point at the SAME array object.
// Doing `window.PDFS = newArray` breaks that shared reference —
// the bare `PDFS` binding still points at the original empty [].
// FIX: always mutate with `.length = 0` + `.push()` so both
// identifiers keep referencing the same object.
// ══════════════════════════════════════════════════════════════════

(async function () {
  'use strict';

  const MAX_RETRIES   = 2;       // retry on transient network error
  const PAGE_SIZE     = 200;     // rows per Supabase page (max 1000)
  const STATUSES      = ['published']; // show ONLY published — approved stays in Draft Queue (Smart Publish Manager)

  const client = window.supabaseClient;
  if (!client) {
    console.warn('pdf-list.js: supabaseClient not ready — using local PDFS only');
    return;
  }

  // ── 1. Show loading skeletons on library grid immediately ───────
  const libGrid = document.getElementById('libGrid');
  if (libGrid && !libGrid.dataset.loaded) {
    libGrid.innerHTML = Array(8)
      .fill('<div class="ottlib-grid-card ottlib-skeleton" style="aspect-ratio:2/3;border-radius:12px;background:var(--surface2,#1e2130);animation:pulse 1.4s ease-in-out infinite;"></div>')
      .join('');
  }

  // ── 2. Fetch all pages from Supabase ────────────────────────────
  async function fetchPage(from, to, attempt) {
    try {
      const { data, error } = await client
        .from('pdfs')
        .select('*')
        .in('status', STATUSES)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data || [];
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        return fetchPage(from, to, attempt + 1);
      }
      throw e;
    }
  }

  let allRows = [];
  try {
    // First page — most recent PDFs, usually enough
    const firstPage = await fetchPage(0, PAGE_SIZE - 1, 1);
    allRows = firstPage;

    // If a full page returned, fetch more (rare — most installs have < 200 PDFs)
    if (firstPage.length === PAGE_SIZE) {
      let page = 1;
      while (true) {
        const from = page * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;
        const next = await fetchPage(from, to, 1);
        allRows = allRows.concat(next);
        if (next.length < PAGE_SIZE) break;
        page++;
        if (page > 10) break; // safety cap: 2000 PDFs max
      }
    }
  } catch (e) {
    console.warn('pdf-list.js: fetch failed — falling back to local PDFS', e);
    // Clear skeletons and show local data if any
    _rerenderAll();
    return;
  }

  if (allRows.length === 0) {
    console.warn('pdf-list.js: Supabase returned 0 PDFs');
    _rerenderAll();
    return;
  }

  // ── 3. Normalise rows to the shape used in index.html ───────────
  const seen   = new Set();
  const dbPdfs = allRows
    .filter(p => {
      const key = String(p.id);
      if (seen.has(key)) return false; // deduplicate
      seen.add(key);
      return true;
    })
    .map(p => ({
      ...p,
      // ── Price resolution (canonical: `price`) ──────────────────
      price:         Number(p.price ?? p.selling_price ?? p.sale_price ?? 0),
      originalPrice: Number(p.original_price ?? p.originalPrice ?? p.mrp ?? 0),
      free:          !!(p.free || Number(p.price ?? p.selling_price ?? 0) === 0),

      // ── URL fields ─────────────────────────────────────────────
      pdfUrl:     p.pdf_url        || p.file_url       || p.download_url || p.megaLink || '',
      previewUrl: p.preview_pdf_url || p.preview_url   || '',

      // ── Cover image — store in data-src for lazy-load ──────────
      // normalizePdf() in index.html reads `coverImage` first
      coverImage: p.cover_url || p.cover_image || p.thumbnail || p.image_url || p.image || '',

      // ── Card gradient colours ──────────────────────────────────
      coverFrom: p.cover_from || '#1d4ed8',
      coverTo:   p.cover_to   || '#930205',

      // ── Misc ───────────────────────────────────────────────────
      tag:    p.badge || p.tag || null,
      sales:  Number(p.download_count || p.sales || 0),

      // ── Status normalisation ──────────────────────────────────
      // Treat 'approved' the same as 'published' for all UI logic
      status: p.status || 'published',
    }));

  // ── 4. Mutate the SHARED PDFS array IN PLACE ────────────────────
  // CRITICAL: do NOT do `window.PDFS = dbPdfs` — see header comment
  if (Array.isArray(window.PDFS)) {
    window.PDFS.length = 0;
    for (const p of dbPdfs) window.PDFS.push(p);
  } else {
    window.PDFS = dbPdfs; // fallback — should never happen
  }
  if (libGrid) libGrid.dataset.loaded = '1';

  console.log(`✅ pdf-list.js: ${dbPdfs.length} PDFs loaded (${STATUSES.join(', ')})`);

  // ── 5. Re-render all sections that depend on PDFS ───────────────
  _rerenderAll();

  // ── 6. Init lazy image observer for newly-injected cards ────────
  setTimeout(function () {
    if (typeof window.initLazyImages === 'function') window.initLazyImages();
  }, 120);

  // ── 7. Update homepage live stats now that we have real counts ──
  if (typeof window.initPlatformStats   === 'function') window.initPlatformStats();
  if (typeof window.loadActivityBarStats === 'function') window.loadActivityBarStats();

  // ── HELPER — trigger every render function that uses PDFS ───────
  function _rerenderAll() {
    // Home page sections
    if (typeof window.renderHome === 'function') {
      window.renderHome();
    } else {
      if (typeof window.renderHomeGrid         === 'function') window.renderHomeGrid();
      if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
      if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();
    }

    // Library grid (fixes "No PDFs Found" on first open)
    const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');
    if (pg === 'library' && typeof window.renderLibGrid === 'function') {
      window.renderLibGrid();
    }

    // OTT shelf system
    if (typeof window.ottlibRenderShelves === 'function') window.ottlibRenderShelves();

    // Category grid counts
    if (typeof window.mhRenderCategoriesFromDB === 'function') window.mhRenderCategoriesFromDB();

    // Ownership-aware button labels (Download vs Buy)
    if (typeof window._refreshFreeButtonLabels === 'function') window._refreshFreeButtonLabels();
  }

})();
