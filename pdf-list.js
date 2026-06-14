// pdf-list.js — Studyria
// Merges Supabase pdf_books into the local PDFS array on load.
// Runs after supabase.js sets window.supabaseClient.
// ══════════════════════════════════════════════════════════════════

(async function () {
  const client = window.supabaseClient;
  if (!client) return; // Supabase not configured — local PDFS used as fallback

  try {
    const { data, error } = await client
      .from('pdfs')
      .select('*')
      .eq('published', true)
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) return;

    // Normalise DB rows to match the shape used in index.html
    const dbPdfs = data.map(p => ({
      ...p,
      // Map DB field names to frontend field names
      price:         p.selling_price ?? p.price ?? 0,
      originalPrice: p.original_price ?? p.originalPrice ?? 0,
      free:          p.free || (p.selling_price === 0) || (p.price === 0),
      pdfUrl:        p.pdf_url || '',
      coverFrom:     p.cover_from || '#1d4ed8',
      coverTo:       p.cover_to   || '#3d8ef8',
      tag:           p.badge || p.tag || null,
      sales:         p.download_count || p.sales || 0,
    }));

    // Replace local PDFS array with live DB data
    // Keep local entries as fallback for any DB ids that don't exist
    if (typeof window.PDFS !== 'undefined') {
  window.PDFS = dbPdfs;
    }
    // Re-render any visible shelves/grids
    if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
    if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();

    console.log(`✅ pdf-list.js: loaded ${dbPdfs.length} PDFs from Supabase`);
  } catch (e) {
    console.warn('pdf-list.js: fetch failed, using local PDFS', e);
  }
})();
