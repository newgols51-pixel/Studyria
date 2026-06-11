// ══════════════════════════════════════════════════════════════════
// WISHLIST PATCH — drop this in index.html replacing the existing
// loadWishlistFromSupabase, toggleWish, and renderWishlist blocks.
// Also remove the old window.loadWishlistFromSupabase = ... alias.
// ══════════════════════════════════════════════════════════════════

// ── LOAD ─────────────────────────────────────────────────────────
// NOTE: The authoritative implementation is now in supabase.js as
// window.loadWishlistFromSupabase.  This thin wrapper keeps any
// direct calls from index.html working without duplication.
// The _wishlistLoading guard lives in supabase.js and is shared.
async function loadWishlistFromSupabase() {
  return window.loadWishlistFromSupabase();
}

// ── REFRESH HEART BUTTONS ─────────────────────────────────────────
function _refreshAllWishButtons() {
  const current = (() => { try { return wishlist; } catch(e) { return window.wishlist || []; } })();
  document.querySelectorAll('[id^="wish-"]').forEach(btn => {
    const rawId = btn.id.replace('wish-', '');
    const numId = Number(rawId);
    const nowIn = current.includes(numId) || current.includes(rawId);
    btn.classList.toggle('active', nowIn);
    btn.title = nowIn ? 'Remove from wishlist' : 'Save to wishlist';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${nowIn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
  });
}
// Expose so supabase.js can call it after load
window._refreshAllWishButtons = _refreshAllWishButtons;

// ── TOGGLE ────────────────────────────────────────────────────────
// Delegates to window.toggleWishlistItem (defined in supabase.js).
async function toggleWish(id) {
  return window.toggleWishlistItem(id);
}

// ── RENDER WISHLIST PAGE ──────────────────────────────────────────
// FIX: Does NOT call loadWishlistFromSupabase() here to break the
// load → render → load → render infinite loop.
// Instead, callers that need fresh data should await
// loadWishlistFromSupabase() BEFORE calling renderWishlist().
// navigate('wishlist') and switchDashTab('wishlist') already do this.
async function renderWishlist() {
  const el      = document.getElementById('wishContent');
  const countEl = document.getElementById('wishCount');

  if (countEl) countEl.textContent = 'Loading…';
  if (el) el.innerHTML = `<div style="text-align:center;padding:60px 0;opacity:.5">Loading wishlist…</div>`;

  // Ensure we have fresh data — safe because loadWishlistFromSupabase
  // is now guarded by _wishlistLoading to prevent re-entrancy.
  await window.loadWishlistFromSupabase();

  const current = (() => { try { return wishlist; } catch(e) { return window.wishlist || []; } })();
  const pdfs = (window.PDFS || []).filter(p =>
    current.includes(Number(p.id)) || current.includes(String(p.id))
  );

  if (countEl) countEl.textContent = `${pdfs.length} saved item${pdfs.length !== 1 ? 's' : ''}`;
  if (!el) return;

  if (pdfs.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:80px 20px">${icon('heart', 56)}<h3 style="font-family:var(--font-display);margin-top:16px;margin-bottom:8px">Nothing saved yet</h3><p class="text-muted mb-4">Browse PDFs and click the heart icon to save them here.</p><button class="btn btn-primary btn-lg" onclick="navigate('library')">Explore Library</button></div>`;
  } else {
    el.innerHTML = `<div class="pdf-grid">${pdfs.map(pdfCardHTML).join('')}</div>`;
  }
}
// Expose for supabase.js event handlers
window.renderWishlist = renderWishlist;
