
/* ══════════════════════════════════════════════════════════════════
   OTTLIB — OTT Library Engine (replaces legacy renderLibrary)
   All functions are backward-compatible with existing navigate() etc.
══════════════════════════════════════════════════════════════════ */

// ── Reading streak (localStorage) ────────────────────────────────
function ottlibGetStreak() {
  try {
    const data = JSON.parse(localStorage.getItem('studyria_streak') || '{}');
    const today = new Date().toDateString();
    const lastDate = data.lastDate;
    if (!lastDate) return 0;
    const diff = Math.round((new Date(today) - new Date(lastDate)) / 86400000);
    if (diff === 0) return data.streak || 0;
    if (diff === 1) return data.streak || 0;
    return 0;
  } catch(e) { return 0; }
}
function ottlibBumpStreak() {
  try {
    const data = JSON.parse(localStorage.getItem('studyria_streak') || '{}');
    const today = new Date().toDateString();
    if (data.lastDate === today) return;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const wasYesterday = data.lastDate === yesterday.toDateString();
    localStorage.setItem('studyria_streak', JSON.stringify({
      streak: wasYesterday ? (data.streak||0)+1 : 1,
      lastDate: today
    }));
  } catch(e) {}
}
ottlibBumpStreak();

// ── Recently Viewed (localStorage) ───────────────────────────────
function ottlibGetRecent() {
  try { return JSON.parse(localStorage.getItem('studyria_recent') || '[]'); } catch(e) { return []; }
}
function ottlibAddRecent(id) {
  try {
    let r = ottlibGetRecent().filter(x => x !== String(id));
    r.unshift(String(id)); r = r.slice(0,20);
    localStorage.setItem('studyria_recent', JSON.stringify(r));
  } catch(e) {}
}

// ── Category filter (extends existing libCat) ─────────────────────
function setLibCatFilter(cat) {
  libCat = cat;
  document.querySelectorAll('.ottlib-cat-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.cat === cat));
  renderLibGrid();
  ottlibRenderShelves();
}

// ── Build a single OTT card ───────────────────────────────────────
function ottlibCardHTML(p, opts = {}) {
  const { isContinue = false, progress = 0, rank = null } = opts;
  const title = p.title || 'Untitled';
  const cat = p.category || '';
  const downloads = p.download_count || p.sales || 0;
  const ratingVal = p.rating ? parseFloat(p.rating).toFixed(1) : (window._ottSeededRating ? window._ottSeededRating(p.id).toFixed(1) : '4.8');
  const isFree = !p.price || p.price === 0;
  const price = isFree ? 'FREE' : `₹${p.price}`;
  const origPrice = Number(p.originalPrice ?? p.original_price ?? p.mrp ?? p.list_price ?? 0);
  const hasDiscount = !isFree && origPrice && origPrice > Number(p.price);
  const discountPct = hasDiscount ? Math.round(100 - (Number(p.price) / origPrice) * 100) : 0;
  const inWish = (wishlist||[]).some(w => String(w) === String(p.id) || String(w.id) === String(p.id));
  const coverImg = p.cover_url || p.coverImage || p.cover_image || p.cover_image_url || p.thumbnail || p.image || '';

  // Badge logic
  let badge = '';
  const ageHours = p.created_at ? (Date.now() - new Date(p.created_at)) / 3600000 : 9999;
  if (isContinue) badge = `<span class="ottlib-card-badge ottlib-badge-reading">Reading</span>`;
  else if (ageHours < 72) badge = `<span class="ottlib-card-badge ottlib-badge-new">New</span>`;
  else if (downloads > 100) badge = `<span class="ottlib-card-badge ottlib-badge-trending">Trending</span>`;
  else if (isFree) badge = `<span class="ottlib-card-badge ottlib-badge-free">Free</span>`;

  const discountBadge = hasDiscount ? `<span class="ottlib-discount-badge">−${discountPct}%</span>` : '';
  const dlBadge = downloads > 0 ? `<span class="ottlib-dl-badge">⬇ ${downloads > 999 ? (downloads/1000).toFixed(1)+'k' : downloads}</span>` : '';

  const progressBar = (isContinue || progress > 0) ?
    `<div class="ottlib-progress-bar"><div class="ottlib-progress-fill" style="width:${Math.max(5,Math.min(100,progress))}%"></div></div>` : '';

  const coverContent = coverImg ?
    `<img src="${coverImg}" alt="${title}" loading="lazy" onerror="this.style.display='none'">` :
    `<div class="ottlib-cover-fallback">${(title[0]||'P').toUpperCase()}</div>`;

  const rankNum = rank !== null && rank <= 10 ?
    `<span class="pdl-ott-rank-num ${rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'rank-other'}">${rank}</span>` : '';

  const ratingHTML = ratingVal ? `<span class="ottlib-card-rating"><span class="ottlib-star">★</span>${ratingVal}</span>` : '';
  const priceRow = hasDiscount
    ? `<span class="ottlib-card-price">${price}</span><span class="ottlib-card-price-orig">₹${origPrice}</span>`
    : `<span class="ottlib-card-price${isFree?' is-free':''}">${price}</span>`;

  return `
    <div class="ottlib-card${isContinue?' is-continue':''}" onclick="ottlibOpenPDF('${p.id}')" data-pdf-id="${p.id}">
      <div class="ottlib-card-inner">
        <div class="ottlib-cover">
          ${coverContent}
          <div class="ottlib-cover-scrim"></div>
          <div class="ottlib-cover-sheen"></div>
          ${badge}
          ${discountBadge}
          ${dlBadge}
          ${rankNum}
          <button class="ottlib-wish${inWish?' active':''}" data-wish-id="${p.id}" onclick="event.stopPropagation();toggleWishlist('${p.id}')" title="Wishlist">
            ${inWish ? '❤️' : '🤍'}
          </button>
          ${progressBar}
        </div>
        <div class="ottlib-card-info">
          <div class="ottlib-card-title">${title}</div>
          <div class="ottlib-card-meta-row">
            ${cat ? `<span class="ottlib-card-meta">${cat}</span>` : ''}
            ${ratingHTML}
          </div>
          <div class="ottlib-card-bottom">
            ${priceRow}
          </div>
        </div>
        <button class="ottlib-card-open" onclick="event.stopPropagation();ottlibOpenPDF('${p.id}')">
          ${isFree ? '📖 Read Free' : '⚡ Get Now'}
        </button>
      </div>
    </div>`;
}

function ottlibSkeletons(n) {
  return Array(n).fill('<div class="ottlib-skeleton"></div>').join('');
}

// ── Open PDF — track recently viewed ─────────────────────────────
function ottlibOpenPDF(id) {
  ottlibAddRecent(id);
  openDetail(id);
}

// ── Render shelves ────────────────────────────────────────────────
function ottlibRenderShelves() {
  const pdfs = (window.PDFS||[]).filter(p => p.title && (p.status === 'published' || p.status === 'approved' || (!p.status && p.title)));
  const cat = libCat && libCat !== 'All' ? libCat : null;
  const filtered = cat ? pdfs.filter(p => p.category === cat) : pdfs;

  const byDownloads = [...filtered].sort((a,b) => (b.download_count||b.sales||0)-(a.download_count||a.sales||0));
  const byRating    = [...filtered].sort((a,b) => (b.rating||0)-(a.rating||0));
  const byNewest    = [...filtered].sort((a,b) => new Date(b.created_at||0)-new Date(a.created_at||0));

  // Trending
  const tEl = document.getElementById('ottlibTrendingTrack');
  if (tEl) {
    const trending = byDownloads.slice(0,10);
    tEl.innerHTML = trending.length
      ? trending.map((p,i) => ottlibCardHTML(p, {rank:i+1})).join('')
      : ottlibSkeletons(5);
  }

  // Recommended (by rating)
  const aEl = document.getElementById('ottlibAITrack');
  if (aEl) {
    const rec = byRating.slice(0,10);
    aEl.innerHTML = rec.length ? rec.map(p => ottlibCardHTML(p)).join('') : ottlibSkeletons(5);
  }

  // New Arrivals
  const nEl = document.getElementById('ottlibNewTrack');
  if (nEl) {
    const newPdfs = byNewest.slice(0,10);
    nEl.innerHTML = newPdfs.length ? newPdfs.map(p => ottlibCardHTML(p)).join('') : ottlibSkeletons(5);
  }

  // Popular
  const popEl = document.getElementById('ottlibPopularTrack');
  if (popEl) {
    const popular = byDownloads.slice(0,10);
    popEl.innerHTML = popular.length ? popular.map((p,i) => ottlibCardHTML(p, {rank:i+1})).join('') : ottlibSkeletons(5);
  }

  // Continue Reading (purchased with in-progress)
  const contEl = document.getElementById('ottlibContinueTrack');
  const contSec = document.getElementById('ottlibContinueSection');
  const purchased = window._userPurchases || [];
  if (contEl && purchased.length > 0) {
    const continueItems = purchased.slice(0,8);
    contEl.innerHTML = continueItems.map(p => {
      const progress = Math.floor(Math.random()*80+10); // Demo; replace with real progress
      return ottlibCardHTML(p, {isContinue: true, progress});
    }).join('');
    if (contSec) contSec.style.display = '';
  } else if (contEl) {
    if (contSec) contSec.style.display = 'none';
  }

  // My PDFs
  const myEl = document.getElementById('ottlibMyPDFsTrack');
  const mySec = document.getElementById('ottlibMyPDFsSection');
  const myDiv = document.getElementById('ottlibMyPDFsDivider');
  if (myEl && purchased.length > 0) {
    myEl.innerHTML = purchased.slice(0,10).map(p => ottlibCardHTML(p)).join('');
    if (mySec) mySec.style.display = '';
    if (myDiv) myDiv.style.display = '';
  } else {
    if (mySec) mySec.style.display = 'none';
    if (myDiv) myDiv.style.display = 'none';
  }

  // Recently Viewed
  const recentEl = document.getElementById('ottlibRecentTrack');
  const recentSec = document.getElementById('ottlibRecentSection');
  const recentIds = ottlibGetRecent();
  if (recentEl && recentIds.length > 0) {
    const recentPdfs = recentIds.map(id => pdfs.find(p => String(p.id) === id)).filter(Boolean).slice(0,10);
    if (recentPdfs.length) {
      recentEl.innerHTML = recentPdfs.map(p => ottlibCardHTML(p)).join('');
      if (recentSec) recentSec.style.display = '';
    } else {
      if (recentSec) recentSec.style.display = 'none';
    }
  } else {
    if (recentSec) recentSec.style.display = 'none';
  }
}

// ── Dynamic per-category OTT rows (Library page) ──────────────────
// Replaces the old category-card carousel with one full horizontal PDF
// slider per category — exact same .ottlib-section markup and
// ottlibCardHTML() card component as Trending/Popular/New Arrivals, so
// it's visually identical to the existing Library rows. Categories with
// zero published PDFs are skipped entirely (no "0 PDFs" rows, ever).
// Fully automatic: reads live window._dbCategories + window.PDFS, no
// manual assignment, nothing hardcoded, nothing to cache-bust.

// category_id is the primary/authoritative match — a PDF's category_id
// already points at the top-level category regardless of which
// subcategory it was filed under, so subcategories roll up for free.
// Falls back to plain-text `category` name match for legacy rows.
function ottlibPdfsForCategory(pdfs, cat) {
  return pdfs.filter(p => {
    if (!p || !p.title) return false;
    if (p.status === 'draft' || p.status === 'deleted' || p.status === 'archived') return false;
    if (p.category_id != null && cat.id != null) return String(p.category_id) === String(cat.id);
    return p.category === cat.name;
  });
}

function ottlibCategoryRowHTML(cat, pdfsInCat) {
  const color = (cat.color && cat.color.startsWith('#')) ? cat.color : '#3d8ef8';
  const sorted = [...pdfsInCat].sort((a, b) =>
    (Number(b.download_count || b.sales || 0)) - (Number(a.download_count || a.sales || 0)));
  const cards = sorted.slice(0, 15).map(p => ottlibCardHTML(p)).join('');
  const safeName = (cat.name || '').replace(/'/g, "\\'");
  return `
  <section class="ottlib-section" id="ottlibCatRow_${cat.id}">
    <div class="ottlib-section-head">
      <div class="ottlib-section-label">
        <span class="ottlib-section-dot" style="background:${color};box-shadow:0 0 8px ${color}"></span>
        <span class="ottlib-section-text">${cat.icon || '📚'} ${cat.name}</span>
        <span class="ottlib-section-badge" style="background:${color}1f;color:${color};border:1px solid ${color}4d">${pdfsInCat.length} PDF${pdfsInCat.length === 1 ? '' : 's'}</span>
      </div>
      <button class="ottlib-see-all" onclick="ottlibSeeAllCategory('${safeName}')">See All →</button>
    </div>
    <div class="ottlib-track-outer">
      <div class="ottlib-track">${cards}</div>
    </div>
  </section>
  <div class="ottlib-divider"></div>`;
}

function ottlibRenderCategoryRows() {
  const container = document.getElementById('ottlibCategoryRowsContainer');
  if (!container) return;
  const cats = (window._dbCategories || [])
    .filter(c => c.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const pdfs = window.PDFS || [];
  const rows = cats
    .map(c => ({ cat: c, pdfsInCat: ottlibPdfsForCategory(pdfs, c) }))
    .filter(r => r.pdfsInCat.length > 0)
    .map(r => ottlibCategoryRowHTML(r.cat, r.pdfsInCat));
  container.innerHTML = rows.join('');
}

// Category row's "See All →" → filter the Library grid + smooth-scroll
// down to the results.
function ottlibSeeAllCategory(name) {
  setLibCatFilter(name);
  const grid = document.getElementById('libGrid');
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Legacy alias kept for any old onclick= references still around.
function ottlibGoToCategory(name) { ottlibSeeAllCategory(name); }

// ── Category pills ─────────────────────────────────────────────────
function ottlibRenderCats() {
  const el = document.getElementById('ottlibCatPills');
  if (!el) return;
  const cats = ['All', ...(window.CATEGORIES||[]).filter(c => c !== 'All')];
  el.innerHTML = cats.map(c =>
    `<button class="ottlib-cat-pill${(libCat===c)||(!libCat&&c==='All')?' active':''}" data-cat="${c}" onclick="setLibCatFilter('${c}')">${c}</button>`
  ).join('');
}

// ── Achievement strip ─────────────────────────────────────────────
function ottlibRenderAchievements() {
  const el = document.getElementById('ottlibAchievements');
  if (!el) return;
  const pdfs = window.PDFS || [];
  const purchased = window._userPurchases || [];
  const recentIds = ottlibGetRecent();
  const streak = ottlibGetStreak();

  const achievements = [
    { icon:'📚', name:'Bookworm',     desc:'Read 5 PDFs',       progress: Math.min(recentIds.length, 5), max: 5 },
    { icon:'⚡', name:'Speed Reader', desc:'5-day streak',       progress: Math.min(streak, 5),          max: 5 },
    { icon:'💎', name:'Collector',    desc:'Own 3 PDFs',         progress: Math.min(purchased.length, 3), max: 3 },
    { icon:'🔥', name:'On Fire',      desc:'7-day streak',       progress: Math.min(streak, 7),          max: 7 },
    { icon:'🏆', name:'Champion',     desc:'Own 10 PDFs',        progress: Math.min(purchased.length, 10), max: 10 },
    { icon:'🎓', name:'Scholar',      desc:'Browse 20 PDFs',     progress: Math.min(recentIds.length, 20), max: 20 },
  ];

  el.innerHTML = achievements.map(a => {
    const pct = a.max > 0 ? Math.round((a.progress/a.max)*100) : 0;
    const unlocked = pct >= 100;
    return `
      <div class="ottlib-ach${unlocked?' unlocked':''}">
        <span class="ottlib-ach-icon">${unlocked ? a.icon : '🔒'}</span>
        <div class="ottlib-ach-info">
          <div class="ottlib-ach-name">${a.name}</div>
          <div class="ottlib-ach-desc">${a.desc} (${a.progress}/${a.max})</div>
          <div class="ottlib-ach-bar">
            <div class="ottlib-ach-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Streak banner ─────────────────────────────────────────────────
function ottlibRenderStreakBanner() {
  const streak = ottlibGetStreak();
  const el = document.getElementById('ottlibStreakBanner');
  const txt = document.getElementById('ottlibStreakText');
  if (!el || !txt) return;
  if (streak >= 3) {
    el.style.display = '';
    txt.textContent = `${streak}-Day Reading Streak! Keep it up!`;
  } else {
    el.style.display = 'none';
  }
}

// ── Stats ─────────────────────────────────────────────────────────
function renderLibHeroStats() {
  const pdfs = window.PDFS || [];
  const totalEl   = document.getElementById('libStatTotal');
  const dlEl      = document.getElementById('libStatDownloads');
  const catEl     = document.getElementById('libStatCategories');
  const wishEl    = document.getElementById('libStatWishlist');
  const streakEl  = document.getElementById('libStatStreak');
  if (!totalEl) return;
  const totalDownloads = pdfs.reduce((s,p) => s+(p.download_count||p.sales||0), 0);
  const cats = new Set(pdfs.map(p=>p.category).filter(Boolean));
  animateCount(totalEl, pdfs.length);
  animateCount(dlEl, totalDownloads, true);
  animateCount(catEl, cats.size || (window.CATEGORIES||[]).length - 1);
  animateCount(wishEl, (wishlist||[]).length);
  if (streakEl) streakEl.textContent = ottlibGetStreak() || '—';
}

// ── Main render (called by navigate → renderLibrary) ──────────────
function renderLibrary() {
  ottlibRenderCats();
  if (typeof ottlibRenderCategoryRows === 'function') ottlibRenderCategoryRows();
  renderLibGrid();
  renderLibHeroStats();
  ottlibRenderShelves();
  ottlibRenderAchievements();
  ottlibRenderStreakBanner();
  setTimeout(_refreshFreeButtonLabels, 50);
}

// ── Drag-to-scroll (attach after DOM ready via event delegation) ──
document.addEventListener('DOMContentLoaded', function() {
  // Attach drag-scroll to any ottlib-track-outer present or added later
  function ottlibAttachDrag(el) {
    if (el._ottlibDrag) return;
    el._ottlibDrag = true;
    let isDown=false, startX, scrollLeft;
    el.addEventListener('mousedown', e => { isDown=true; startX=e.pageX-el.offsetLeft; scrollLeft=el.scrollLeft; });
    el.addEventListener('mouseleave', ()=>{ isDown=false; });
    el.addEventListener('mouseup', ()=>{ isDown=false; });
    el.addEventListener('mousemove', e => { if(!isDown) return; e.preventDefault(); el.scrollLeft = scrollLeft-(e.pageX-el.offsetLeft-startX); });
  }
  document.querySelectorAll('.ottlib-track-outer').forEach(ottlibAttachDrag);
  // Also expose for dynamically added carousels
  window.ottlibAttachDrag = ottlibAttachDrag;
});
