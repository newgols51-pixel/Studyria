// pdf-list.js — Studyria
// Merges Supabase pdfs into the local PDFS array on load.
// Runs after supabase.js sets window.supabaseClient.
// ══════════════════════════════════════════════════════════════════
//
// ── FIX (root-cause: "PDFS reassignment" bug) ──────────────────────
// index.html declares:
//     const PDFS = [];
//     window.PDFS = PDFS;
// `PDFS` and `window.PDFS` start out as the SAME array object.
// Any code in index.html that uses the bare identifier `PDFS`
// (e.g. renderHome's `featured = PDFS.filter(p => p.featured)`,
// the Discover-page fallback, admin PDF counters, etc.) holds a
// reference to that ORIGINAL array — NOT to whatever `window.PDFS`
// is later pointed at.
//
// The previous version of this file did:
//     window.PDFS = dbPdfs;        // <-- creates a brand-new array
// which broke the shared reference: `window.PDFS` now pointed at
// `dbPdfs`, while the bare `PDFS` binding (used all over index.html)
// still pointed at the original empty `[]` forever. Result: the
// "Featured" grid, Discover fallback search, and admin PDF counts
// never reflected Supabase data.
//
// FIX: mutate the EXISTING array in place (clear + push) so both
// `PDFS` and `window.PDFS` continue to reference the same object —
// exactly the pattern already used by adminSavePDF()'s refresh logic.
// ══════════════════════════════════════════════════════════════════

(async function () {
  const client = window.supabaseClient;
  if (!client) return; // Supabase not configured — local PDFS used as fallback

  try {
    const { data, error } = await client
      .from('pdfs')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
      if (error) console.warn('pdf-list.js: Supabase query error', error);
      return;
    }

    // Normalise DB rows to match the shape used in index.html.
    // CANONICAL: Only set `price`. normalizePdf() in index.html will collapse
    // all old field names (selling_price, sale_price, etc.) into Number(price).
    const dbPdfs = data.map(p => ({
      ...p,
      // Resolve price from every possible DB column into canonical `price`
      price:         Number(p.price ?? p.selling_price ?? p.sale_price ?? 0),
      originalPrice: Number(p.original_price ?? p.originalPrice ?? p.mrp ?? 0),
      free:          !!(p.free || p.price === 0 || p.selling_price === 0),
      pdfUrl:        p.pdf_url || '',
      previewUrl:    p.preview_pdf_url || p.preview_url || '',
      coverImage:    p.cover_url || p.cover_image || p.thumbnail || p.image_url || '',
      coverFrom:     p.cover_from || '#1d4ed8',
      coverTo:       p.cover_to   || '#3d8ef8',
      tag:           p.badge || p.tag || null,
      sales:         p.download_count || p.sales || 0,
    }));

    // ── Replace contents of the SHARED PDFS array IN PLACE ──────────
    // Keeps `window.PDFS` and the bare `PDFS` const binding pointing
    // at the same array object (see header comment above).
    if (Array.isArray(window.PDFS)) {
      window.PDFS.length = 0;
      for (const p of dbPdfs) window.PDFS.push(p);
    } else {
      // Fallback for environments where PDFS wasn't pre-declared
      window.PDFS = dbPdfs;
    }

    // ── Re-render everything that depends on PDFS ───────────────────
    // renderHome() re-renders the featured grid, home grid, trending
    // shelf, new-arrivals shelf, recently-added and popular-downloads
    // sections — i.e. every part of the homepage driven by PDFS.
    if (typeof window.renderHome === 'function') {
      window.renderHome();
    } else {
      // Narrow fallbacks if renderHome isn't available yet
      if (typeof window.renderHomeGrid       === 'function') window.renderHomeGrid();
      if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
      if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();
    }

    // Re-render category grid counts now that PDFS is populated
    if (typeof window.mhRenderCategoriesFromDB === 'function') {
      window.mhRenderCategoriesFromDB();
    }

    console.log(`✅ pdf-list.js: loaded ${dbPdfs.length} PDFs from Supabase`);
  } catch (e) {
    console.warn('pdf-list.js: fetch failed, using local PDFS', e);
  }
})();
