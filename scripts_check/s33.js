
// ── DATA ──────────────────────────────────────────────────────────
// Categories are loaded from Supabase — see loadCategoriesFromDB()
const CATEGORIES = ["All"]; // dynamically populated on app init
window._dbCategories    = [];   // [{id, name, slug, icon, color, glow, ...}]
window._dbSubcategories = [];   // [{id, category_id, name, slug, ...}]
window._dbSubcatMap     = {};   // { category_id: [subcategory, ...] }

const PDFS = [];
window.PDFS = PDFS;

const MOCK_USERS = [
  {name:"Aisha Nair",email:"aisha@example.com",plan:"Pro",joined:"Jan 2024",purchases:8},
  {name:"Raj Kumar",email:"raj@example.com",plan:"Free",joined:"Mar 2024",purchases:2},
  {name:"Sneha Patel",email:"sneha@example.com",plan:"Pro",joined:"Feb 2024",purchases:15},
  {name:"Arjun Shah",email:"arjun@example.com",plan:"Free",joined:"Apr 2024",purchases:0},
];

const RECENT_SALES = [
  {user:"Raj Kumar",pdf:"MBA Entrance Crack Code",amount:799,time:"2 min ago"},
  {user:"Sneha Patel",pdf:"Python for Data Science",amount:399,time:"8 min ago"},
  {user:"Arjun Mehta",pdf:"Financial Modeling",amount:599,time:"15 min ago"},
  {user:"Pooja Singh",pdf:"UI/UX Design Principles",amount:349,time:"22 min ago"},
  {user:"Vikram Joshi",pdf:"Data Structures",amount:299,time:"31 min ago"},
];

// ── STATE ─────────────────────────────────────────────────────────
let currentPage = 'home';
let selectedPdf = null;
let wishlist = []; // populated from Supabase user_wishlist table on login
// NOTE: currentUser is managed exclusively by window.currentUser (set by
// syncNavToAuth in supabase.js). Do NOT declare a local `let currentUser`
// here — it would shadow window.currentUser and break auth state sync.
let dark = localStorage.getItem('studyria_theme') !== 'light'; // synced with Alpine isDarkMode
let libCat = 'All';
let freeOnly = false;
let dashTab = 'overview';

// ── OWNERSHIP CACHE: hook into syncNavToAuth so login triggers cache load ──
// supabase.js calls window.syncNavToAuth(user) whenever auth state changes.
// We intercept it here to load the ownership cache on login and clear on logout.
(function _patchSyncNavToAuth() {
  function _tryPatch() {
    if (typeof window.syncNavToAuth === 'function' && !window._syncNavToAuthPatched) {
      const _orig = window.syncNavToAuth;
      window.syncNavToAuth = function(user) {
        _orig.call(this, user);
        if (user) {
          // User just logged in — load ownership cache (non-blocking)
          window._ownedPdfIds = window._ownedPdfIds || new Set();
          window._ownedCacheReady = false;
          _loadOwnershipCache && _loadOwnershipCache().catch(() => {});
        } else {
          // User logged out — clear ownership cache
          window._ownedPdfIds = new Set();
          window._ownedCacheReady = false;
        }
      };
      window._syncNavToAuthPatched = true;
    }
  }
  // Try immediately (in case supabase.js already ran)
  _tryPatch();
  // Also retry after scripts finish loading
  document.addEventListener('DOMContentLoaded', _tryPatch);
  setTimeout(_tryPatch, 500);
  setTimeout(_tryPatch, 1500);
})();

// ── PDF FIELD NORMALISATION ───────────────────────────────────────
// Called once on every PDF object (from Supabase or local list).
// Guarantees every render function sees consistent field names.
const _pdfFallbackCache = {};   // id → { reviews, sales } — keeps generated values stable

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

// Deterministic pseudo-random based on PDF id + a salt — ensures same PDF
// always gets the same generated value across renders.
function seededRand(id, salt) {
  let h = (Number(id) * 2654435769 + salt * 1234567891) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── BROKEN PDF FILTER ─────────────────────────────────────────────
// Returns false for PDFs that have null/missing critical fields so
// they are hidden everywhere (library, search, featured, trending,
// related, home) rather than displaying a broken card.
function isValidPdf(p) {
  if (!p) return false;
  const t = (p.title || '').trim();
  if (!t || t === 'null' || t === 'undefined' || t === 'Untitled PDF') {
    // Hide only if also missing a cover and pdf_url (completely broken)
    const hasCover = !!(p.coverImage || p.cover_url || p.cover_image || p.thumbnail || p.image);
    const hasPdf   = !!(p.pdfUrl || p.pdf_url || p.file_url || p.download_url || p.megaLink);
    if (!hasCover && !hasPdf) return false;
  }
  return true;
}

// Filters + normalizes an array — removes broken records
function validPdfs(arr) {
  return (arr || []).map(p => normalizePdf(Object.assign({}, p))).filter(isValidPdf);
}

// ── SUPABASE ALIAS ────────────────────────────────────────────────
// A lazy proxy so bare `supabase.auth.getUser()` calls in this file
// always reach the live client. Since supabase.js now loads BEFORE
// this inline block, window.supabaseClient is already set when we
// get here. We still keep the proxy as a fallback for safety.
// IMPORTANT: we must NOT declare `var supabase` here because
// supabase.js sets window.supabase = window.supabaseClient in its
// DOMContentLoaded handler. Using `var supabase` would shadow that
// with the Proxy object for the duration of this script block, which
// would cause supabase.js's init check to fail on the next line.
// Instead, we ensure that if supabaseClient is already available we
// point supabase directly at it; otherwise we set up the lazy proxy.
var supabase;
if (window.supabaseClient) {
  supabase = window.supabaseClient;
  window.supabase = window.supabaseClient;
} else {
  supabase = new Proxy({}, {
    get: function(_, prop) {
      const client = window.supabaseClient;
      if (!client) {
        if (prop === 'auth') {
          return new Proxy({}, {
            get: function() {
              return async function() { return { data: { user: null }, error: null }; };
            }
          });
        }
        return undefined;
      }
      // Client is now available — point supabase directly at it for future calls.
      supabase = client;
      window.supabase = client;
      const val = client[prop];
      return typeof val === 'function' ? val.bind(client) : val;
    }
  });
}

// ── THEME ─────────────────────────────────────────────────────────
function toggleTheme() {
  // ── Alpine bridge: delegate to reactive state ─────────────────
  if (window._alpine) {
    window._alpine.toggleTheme();
    dark = window._alpine.isDarkMode; // keep legacy var in sync
    return;
  }
  // Fallback (pre-Alpine load)
  dark = !dark;
  document.body.classList.toggle('light', !dark);
  const icon = document.querySelector('#themeIcon');
  if (icon) icon.setAttribute('href', dark ? '#ic-moon' : '#ic-sun');
}

// ── NAVIGATION ────────────────────────────────────────────────────
// Valid SPA pages (public-facing, non-admin). Admin pages skip hash.
const _SPA_PUBLIC_PAGES = new Set([
  'home','library','dashboard','wishlist','login','register',
  'detail','career-hub','creator-register','creator-dashboard','upload',
  'privacy','terms','refund','about','contact','blog'
]);

// Force-resets any leftover native browser pinch-zoom. Needed because a
// changed viewport <meta> only takes effect on a genuine page reload — SPA
// navigation to a new "page" doesn't reload the document, so if the user
// (or an older cached build without user-scalable=no) ever pinch-zoomed
// the tab, that zoom silently carries over into every page viewed after,
// making a perfectly fine layout look zoomed/cropped. Toggling the meta
// tag's content forces mobile Chrome/Safari to snap the zoom back to 1.
//
// IMPORTANT: only do this when the page is actually zoomed in (checked via
// visualViewport.scale). Toggling the meta tag unconditionally on every
// navigation — even when nothing was zoomed — forces a reflow/rescale on
// every single page change, which shows up as a visible flash/jump. This
// check keeps it a true no-op on the (vast majority of) normal navigations.
function _pdpResetPageZoom() {
  const vv = window.visualViewport;
  if (vv && vv.scale && vv.scale > 1.02) {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    const base = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    vp.setAttribute('content', base + ', shrink-to-fit=yes');
    requestAnimationFrame(() => vp.setAttribute('content', base));
  }
}

// ── SPA page canonical handling ─────────────────────────────────────
// sitemap.xml / robots.txt / the breadcrumb JSON-LD all advertise these
// ?page=X URLs as their own indexable pages, but the static
// <link rel="canonical"> in <head> is hardcoded to the homepage and the
// SPA never read `?page=` on load — so a direct hit on any of them
// silently rendered the homepage with canonical="/", which is exactly
// why GSC folded /?page=about into the homepage as a duplicate. This
// keeps the homepage canonical everywhere else and self-references the
// matching ?page=X URL only while that page is actually showing.
// 'discover' is a section of the home page (no separate DOM page), so
// it's included in the canonical map but not in the navigate() 404 guard.
const _PAGE_CANONICAL_MAP = {
  'about':      'https://studyria.qzz.io/?page=about',
  'career-hub': 'https://studyria.qzz.io/?page=career-hub',
  'library':    'https://studyria.qzz.io/?page=library',
  'discover':   'https://studyria.qzz.io/?page=discover',
  'contact':    'https://studyria.qzz.io/?page=contact',
  'privacy':    'https://studyria.qzz.io/?page=privacy',
  'terms':      'https://studyria.qzz.io/?page=terms',
  'refund':     'https://studyria.qzz.io/?page=refund',
};
window._pageDefaultCanonical = null;
function _setPageCanonical(page) {
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  if (!canonicalEl) return;
  const target = _PAGE_CANONICAL_MAP[page];
  if (target) {
    if (window._pageDefaultCanonical === null) {
      window._pageDefaultCanonical = canonicalEl.href;
    }
    canonicalEl.href = target;
  } else if (window._pageDefaultCanonical !== null) {
    canonicalEl.href = window._pageDefaultCanonical;
    window._pageDefaultCanonical = null;
  }
}

async function navigate(page) {
  window._realNavigate = navigate; // expose for stub flush

  // Safety net: if a fullscreen cover preview was left open from a
  // previous page (e.g. user hit back/bottom-nav instead of the close
  // button), force it closed so its scroll-lock can never bleed into
  // the page we're about to show.
  if (typeof _pdpClearZoomLock === 'function') _pdpClearZoomLock();
  _pdpResetPageZoom();

  // ── Already signed in? Don't show the login/register screen ─────
  if ((page === 'login' || page === 'register') && window.currentUser) {
    page = 'dashboard';
  }

  // ── 404 guard ─────────────────────────────────────────────────
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) {
    console.warn('Page not found:', page);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const notFound = document.getElementById('page-404');
    if (notFound) notFound.classList.add('active');
    window.currentPage = '404';
    if (typeof currentPage !== 'undefined') try { currentPage = '404'; } catch(_) {}
    window.scrollTo(0, 0);
    // Push hash so the broken URL is visible but doesn't break back button
    if (history.pushState) history.pushState({ page }, '', '#404');
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  pageEl.classList.add('active');
  currentPage = page;
  window.currentPage = page; // FIX: expose to supabase.js and all external scripts
  window.scrollTo(0, 0);

  // ── Hash-based SPA routing (public pages only) ────────────────
  if (_SPA_PUBLIC_PAGES.has(page)) {
    const hash = page === 'home' ? '#' : '#' + page;
    if (history.pushState && location.hash !== hash && location.hash !== (page === 'home' ? '' : hash)) {
      history.pushState({ page }, '', hash);
    }
  }

  // Update nav link active states
  document.querySelectorAll('.nav-link[data-page]').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  document.querySelectorAll('.mobile-nav-item[data-page]').forEach(l => l.classList.toggle('active', l.dataset.page === page));

  // Keep the canonical tag in sync with the current page (see helper above)
  _setPageCanonical(page);

  // Page-specific render
  if (page === 'home') { renderHome(); setTimeout(() => { if (typeof ottRenderDiscovery === 'function' && window.PDFS && window.PDFS.length) ottRenderDiscovery(false); }, 100); }
  if (page === 'library') renderLibrary();
  if (page === 'dashboard') renderDashboard();
  if (page === 'wishlist') {
    // FIX: always reload from DB before rendering — never trust stale local array
    if (typeof window.loadWishlistFromSupabase === 'function') {
      await window.loadWishlistFromSupabase();
    }
    renderWishlist();
  }
  if (page === 'admin') renderAdmin();
  if (page === 'detail') renderDetail();
  if (page === 'career-hub') {
    // Initialize Career Hub when navigating to it
    if (typeof chInit === 'function') chInit();
  }
  if (page === 'about') {
    // Populate About page stats from the shared Supabase source
    if (typeof initAboutStats === 'function') initAboutStats();
  }
  if (page === 'blog') {
    // Reset to the article-list view (openBlogPost switches to article view)
    const listV = document.getElementById('blogListView');
    const artV  = document.getElementById('blogArticleView');
    if (listV) listV.style.display = '';
    if (artV)  artV.style.display  = 'none';
    if (typeof renderBlogList === 'function') renderBlogList();
    if (typeof _blogResetMeta === 'function') _blogResetMeta();
  }
}

// ── Popstate handler: restore page from hash on back/forward ──────
window.addEventListener('popstate', function(e) {
  let page = 'home';
  if (e.state && e.state.page) {
    page = e.state.page;
  } else {
    const hash = location.hash.replace('#', '').trim();
    if (hash && hash !== '404') page = hash || 'home';
  }
  // Call navigate but suppress pushState to avoid doubling history
  const origPush = history.pushState;
  history.pushState = function() {};
  navigate(page).finally ? navigate(page).finally(() => { history.pushState = origPush; })
                          : (navigate(page), history.pushState = origPush);
});

// Also reset zoom when the page is restored from bfcache (Safari/Chrome
// back-forward cache) — this can bring back a stale zoomed state without
// running any of the normal navigate()/init JS.
window.addEventListener('pageshow', function(e) {
  if (typeof _pdpResetPageZoom === 'function') _pdpResetPageZoom();
});

// ── On initial load: honour hash URL for deep-linking ────────────
// NOTE: _appInit (DOMContentLoaded) now handles hash routing for
// privacy/terms/refund and all SPA public pages synchronously.
// This fallback only fires if navigate wasn't available at that time.
(function _spaInitialHash() {
  const hash = location.hash.replace('#', '').trim();
  if (hash && hash !== '404') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        // Only navigate if we're still on the home page (i.e. _appInit
        // didn't handle it because _SPA_PUBLIC_PAGES wasn't defined yet).
        const activePage = document.querySelector('.page.active');
        const activeId = activePage ? activePage.id : '';
        if (activeId === 'page-home' || activeId === '') {
          if (typeof navigate === 'function') navigate(hash);
        }
      }, 500);
    });
  }
})();

// ── ANNOUNCEMENT BAR (Feature 5) ─────────────────────────────────
function closeAnnouncementBar() {
  // ── Alpine bridge: delegate to reactive annBarVisible state ──
  if (window._alpine) {
    window._alpine.closeAnnBar();
    return;
  }
  // Fallback (pre-Alpine load)
  const bar = document.getElementById('announcementBar');
  if (bar) bar.style.display = 'none';
  try { localStorage.setItem('studyria_ann_closed', '1'); } catch(e) {}
}
// NOTE: Announcement bar visibility is now managed by Alpine x-show="annBarVisible"
// The studyriaApp() init() reads localStorage on startup — no IIFE needed.

// ── POPULAR DOWNLOADS (Feature 3) ───────────────────────────────
async function renderPopularDownloads() {
  const el = document.getElementById('popularDownloadsGrid');
  if (!el) return;

  const sb = window.supabaseClient;
  let pdfs = [];

  if (sb) {
    try {
      const { data } = await sb
        .from('pdfs')
        .select('*')
        .eq('status', 'published')
        .order('download_count', { ascending: false })
        .limit(15);
      if (data && data.length) {
        pdfs = data.map(p => { normalizePdf(p); return p; });
      }
    } catch(e) {}
  }

  // Fallback: sort local PDFS by download_count / sales desc
  if (!pdfs.length) {
    pdfs = [...(window.PDFS || [])].sort((a,b) => {
      normalizePdf(a); normalizePdf(b);
      return (Number(b.download_count || b.sales) || 0) - (Number(a.download_count || a.sales) || 0);
    }).slice(0, 15);
  }

  if (!pdfs.length) {
    el.innerHTML = '<div style="color:var(--text2);padding:40px 20px;font-size:.85rem;text-align:center">No data yet.</div>';
    return;
  }
  pdfs = validPdfs(pdfs);

  // Badge logic
  const getBadge = (pdf, i) => {
    if (pdf.free || Number(pdf.price) === 0) return { label: 'FREE', cls: 'pdl-badge-free' };
    if (i < 3) return { label: 'BESTSELLER', cls: 'pdl-badge-bestseller' };
    if (pdf.badge === 'NEW') return { label: 'NEW', cls: 'pdl-badge-new' };
    return { label: 'TRENDING', cls: 'pdl-badge-trending' };
  };

  // Rank class for stroke colour
  const rankCls = i => i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';

  el.innerHTML = pdfs.map((pdf, i) => {
    const dl    = pdf.download_count || pdf.sales || 0;
    const dlStr = dl >= 1000 ? (dl/1000).toFixed(1)+'k' : (dl > 0 ? dl.toLocaleString() : '');
    const badge = getBadge(pdf, i);
    const isFree = pdf.free || Number(pdf.price) === 0;
    const priceText = isFree ? 'FREE' : '₹' + Number(pdf.price).toLocaleString();
    const coverSrc  = pdf.cover_url || pdf.coverImage || '';
    const coverHTML = coverSrc
      ? `<img src="${coverSrc}" alt="${(pdf.title||'').replace(/"/g,'')}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
      : `<div style="font-size:2.8rem;opacity:.35">📄</div>`;
    const inWish = wishlist.includes(pdf.id) || wishlist.includes(String(pdf.id));

    return `
    <div class="pdl-ott-card" onclick="openPDFDetail('${pdf.id}')">
      <div class="pdl-ott-card-inner">
        <div class="pdl-ott-cover">
          ${coverHTML}
          <div class="pdl-ott-cover-scrim"></div>
          <div class="pdl-ott-badge ${badge.cls}">${badge.label}</div>
          ${dlStr ? `<div class="pdl-ott-dl-badge">⬇ ${dlStr}</div>` : ''}
          <div class="pdl-ott-rank-num ${rankCls(i)}">${i+1}</div>
          <button class="pdl-ott-wish${inWish?' active':''}" data-wish-id="${pdf.id}" onclick="event.stopPropagation();toggleWishlist('${pdf.id}')" title="Wishlist">${inWish ? '❤️' : '♡'}</button>
        </div>
        <div class="pdl-ott-body">
          <div class="pdl-ott-card-title">${pdf.title || 'Untitled'}</div>
          <div class="pdl-ott-card-footer">
            <div class="pdl-ott-price ${isFree ? 'price-free' : ''}">${priceText}</div>
            ${dlStr ? `<div class="pdl-ott-dl-count">${dlStr} dls</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Drag-to-scroll for the carousel outer ────────────────────────
  const outer = document.getElementById('pdlOttOuter');
  if (outer && !outer._pdlDragInit) {
    outer._pdlDragInit = true;
    let isDown = false, startX = 0, scrollLeft = 0;
    outer.addEventListener('mousedown',  e => { isDown = true; outer.classList.add('grabbing'); startX = e.pageX - outer.offsetLeft; scrollLeft = outer.scrollLeft; });
    outer.addEventListener('mouseleave', () => { isDown = false; outer.classList.remove('grabbing'); });
    outer.addEventListener('mouseup',    () => { isDown = false; outer.classList.remove('grabbing'); });
    outer.addEventListener('mousemove',  e => {
      if (!isDown) return; e.preventDefault();
      const x = e.pageX - outer.offsetLeft;
      outer.scrollLeft = scrollLeft - (x - startX) * 1.4;
    });
  }
}

// ── PWA INSTALL (Feature 6) ──────────────────────────────────────
// beforeinstallprompt, appinstalled, and all install logic are owned
// exclusively by app.js (setupInstallPrompt / window.PWA).
// This stub ensures legacy onclick attributes still resolve.

window._pwaInstallPrompt = window._pwaInstallPrompt || null;

function triggerPWAInstall() {
  if (window.PWA && typeof window.PWA.promptInstall === 'function') {
    window.PWA.promptInstall();
  }
}

// ── TOAST ─────────────────────────────────────────────────────────
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

// ── SVG ICON HELPER ───────────────────────────────────────────────
function icon(id, size = 16) {
  return `<svg width="${size}" height="${size}"><use href="#ic-${id}"/></svg>`;
}

// ── PDF CARD HTML — 10/10 Premium Design ─────────────────────
function pdfCardHTML(pdf) {
  normalizePdf(pdf);
  const inWish = wishlist.includes(pdf.id);

  // ── Tag / badge class mapping ──────────────────────────────────
  const tagKey = (pdf.tag || '').toLowerCase().replace(/[\s-]+/g, '');
  const tagClassMap = {
    'free': 'tag-free',
    'bestseller': 'tag-bestseller',
    'bestseller': 'tag-bestseller',
    'new': 'tag-new',
    'newarrival': 'tag-new',
    'premium': 'tag-premium',
    'trending': 'tag-trending',
    'popular': 'tag-popular',
    'featured': 'tag-bestseller',
  };
  const tagClass = tagClassMap[tagKey] || (tagKey ? `tag-${tagKey}` : '');

  // ── Badge icon by type ─────────────────────────────────────────
  const tagIconMap = {
    'tag-free':       `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    'tag-bestseller': `<svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    'tag-new':        `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    'tag-trending':   `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    'tag-premium':    `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    'tag-popular':    `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
  };
  const tagIcon = tagIconMap[tagClass] || '';

  // Use ONLY canonical `price` field (set by normalizePdf). Never read selling_price here.
  const displayPrice = Number(pdf.price ?? 0);

  // ── Cover ──────────────────────────────────────────────────────
  const coverSrc = pdf.coverImage;
  const imgHTML = coverSrc
    ? `<img src="${coverSrc}" alt="${pdf.title}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
    : '';
  const fallbackHTML = `<div class="pdf-cover-fallback" style="display:${coverSrc ? 'none' : 'flex'};background:linear-gradient(145deg,${pdf.coverFrom||'#0a1a50'},${pdf.coverTo||'#1555e8'} 55%,${pdf.coverTo||'#0891b2'} 100%);">
    <svg class="pdf-cover-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  </div>`;

  // ── Discount % ────────────────────────────────────────────────
  let discountBadge = '';
  if (!pdf.free && pdf.originalPrice && displayPrice && pdf.originalPrice > displayPrice) {
    const pct = Math.round(100 - (displayPrice / pdf.originalPrice) * 100);
    if (pct > 0) discountBadge = `<span class="price-discount-badge">-${pct}%</span>`;
  }

  // ── Meta chips — max 3, priority: category > subcategory_id label > stream_id label
  const chipData = [];
  if (pdf.category)         chipData.push(`<span class="pdf-meta-chip chip-cat">${pdf.category}</span>`);
  if (pdf.subcategory_id) {
    const _sub = (window._dbSubcategories||[]).find(s=>String(s.id)===String(pdf.subcategory_id));
    if (_sub) chipData.push(`<span class="pdf-meta-chip chip-class">${_sub.name}</span>`);
  }
  if (pdf.stream_id) {
    const _str = (window._dbStreams||[]).find(s=>String(s.id)===String(pdf.stream_id));
    if (_str) chipData.push(`<span class="pdf-meta-chip chip-stream">${_str.name}</span>`);
  }
  if (pdf.subject_id) {
    const _subj = (window._dbSubjects||[]).find(s=>String(s.id)===String(pdf.subject_id));
    if (_subj) chipData.push(`<span class="pdf-meta-chip chip-subject">${_subj.name}</span>`);
  }
  const chips = chipData.slice(0, 3).join('');
  const chipsHTML = chips ? `<div class="pdf-meta-chips">${chips}</div>` : '';

  // ── Sales display ──────────────────────────────────────────────
  const _sales = Number(pdf.sales || pdf.download_count || 0);
  const salesStr = _sales >= 1000
    ? `${(_sales / 1000).toFixed(1)}k`
    : _sales.toLocaleString();

  // ── Second badge (if badge differs from tag) ───────────────────
  const hasBadge = pdf.badge && pdf.badge !== pdf.tag;

  // NOTE: Never embed PDF URL in onclick — Supabase Storage URLs contain
  // special chars that break HTML attributes. Pass id only; re-fetch on click.

  return `
  <div class="pdf-card" onclick="openDetail('${pdf.id}')" data-pdf-id="${pdf.id}">

    <!-- ── COVER ──────────────────────────────────────────── -->
    <div class="pdf-cover">
      ${imgHTML}${fallbackHTML}
      <div class="pdf-cover-scrim"></div>

      <!-- Primary tag pill (top-left) -->
      ${pdf.tag ? `<span class="pdf-tag ${tagClass}">${tagIcon}${pdf.tag}</span>` : ''}

      <!-- Secondary badge pill (stacked below tag if both present) -->
      ${hasBadge
        ? `<span class="pdf-tag tag-bestseller" style="top:${pdf.tag ? '36px' : '11px'};">
             <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
             ${pdf.badge}
           </span>`
        : ''}

      <!-- Floating wishlist button (top-right) -->
      <button class="wish-btn ${inWish ? 'active' : ''}" id="wish-${pdf.id}"
        onclick="event.stopPropagation();toggleWish('${pdf.id}')"
        aria-label="${inWish ? 'Remove from wishlist' : 'Save to wishlist'}">
        <svg width="16" height="16" viewBox="0 0 24 24"
          fill="${inWish ? 'currentColor' : 'none'}"
          stroke="currentColor" stroke-width="2.0"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>

      <!-- Downloads / sales pill (bottom-left) -->
      <div class="pdf-cover-sales">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${salesStr}
      </div>
    </div>

    <!-- ── BODY ─────────────────────────────────────────────── -->
    <div class="pdf-card-body">

      <div class="pdf-title">${pdf.title || 'Untitled PDF'}</div>

      ${pdf.author ? `<div class="pdf-author">by ${pdf.author}</div>` : ''}

      <!-- Rating + pages — single elegant row -->
      <div class="pdf-meta">
        <span class="pdf-rating">
               <svg width="11" height="11" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#f59e0b"/></svg>
               ${pdf.rating || (window._ottSeededRating ? window._ottSeededRating(pdf.id).toFixed(1) : '4.8')}
             </span>
        ${(pdf.reviews != null && pdf.reviews !== '') ? `<span style="color:var(--text3);font-size:0.65rem;font-family:var(--font-ui)">(${Number(pdf.reviews || 0).toLocaleString()})</span>` : ''}
        ${pdf.pages ? `<span style="color:var(--text3)">·</span><span style="font-size:0.65rem;font-family:var(--font-ui)">${pdf.pages}p</span>` : ''}
      </div>

      <!-- Compact metadata chips — max 3 -->
      ${chipsHTML}

      <!-- Body badge if present -->
      ${pdf.badge
        ? `<div class="pdf-badge-inline">
             <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
             ${pdf.badge}
           </div>`
        : ''}

      <!-- Price row -->
      <div class="pdf-price-row">
        ${pdf.free || displayPrice === 0
          ? `<span class="price-free">FREE</span>
             <span style="font-size:0.65rem;color:var(--text2);font-family:var(--font-ui);margin-left:2px">Always</span>`
          : `<span class="price-current">&#8377;${displayPrice}</span>
             ${pdf.originalPrice && pdf.originalPrice > displayPrice
               ? `<span class="price-original">&#8377;${pdf.originalPrice}</span>` : ''}
             ${discountBadge}`
        }
      </div>

    </div>

    <!-- ── BUY / GET FREE CTA ────────────────────────────────── -->
    <div class="pdf-card-actions">
      ${(pdf.free || displayPrice === 0)
        ? (() => {
            const owned = _isOwned(String(pdf.id));
            return `<button class="pdf-buy-btn free-btn"
              data-free-btn="${pdf.id}"
              onclick="event.stopPropagation();downloadPDF('${pdf.id}')"
              style="${owned ? 'background:var(--grad-success)' : ''}">
              ${owned
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open PDF`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download Free`
              }
            </button>`;
          })()
        : `<button class="pdf-buy-btn"
            onclick="event.stopPropagation();buyPDF('${pdf.id}', ${displayPrice})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
            Buy Now &middot; &#8377;${displayPrice}
          </button>`
      }
    </div>

  </div>`;
}

// ── HOME ──────────────────────────────────────────────────────────
// NOTE: This was originally `function renderHome()`. It has been
// renamed to `renderHomeCore()` because a SECOND `function renderHome()`
// declaration further down in this same <script> block (the "Hook into
// renderHome to initialize all new features" wrapper) hoisted ABOVE
// this one and silently shadowed it. That wrapper tried to save "the
// original renderHome" into `_origRenderHome` — but due to JS function
// hoisting, by the time that line executed, `renderHome` already
// referred to the wrapper itself (both declarations are hoisted before
// any code runs, and the later declaration wins). So
// `_origRenderHome === renderHome` (the wrapper) and calling
// `_origRenderHome()` inside the wrapper called the wrapper itself —
// infinite recursion → "RangeError: Maximum call stack size exceeded".
// Renaming this core implementation removes the name collision entirely.
function renderHomeCore() {
  try {
    // Featured — exclude broken PDFs
    const featured = validPdfs((window.PDFS || []).filter(p => p.featured));
    const featuredGrid = document.getElementById('featuredGrid');
    if (featuredGrid) featuredGrid.innerHTML = featured.map(pdfCardHTML).join('');

    renderPopularDownloads();

    // Load testimonials from Supabase (non-blocking)
    loadHomepageTestimonials();
  } catch(e) {
    console.warn('renderHomeCore error:', e);
  }
}

// ══════════════════════════════════════════════════════════════════
// ── TESTIMONIALS — Dynamic Supabase loader ────────────────────────
// Honesty fix: this used to show 6 fully-invented students (JEE/NEET/
// UPSC scores that have nothing to do with Studyria's real Assam-only
// catalog) instantly and permanently, regardless of what was in the
// database. Real, verified-buyer reviews now come from `pdf_reviews`
// (see fetchTopVerifiedReviews below) or the admin-curated
// `testimonials` table. If neither has content yet, we show an honest
// empty state instead of fake people — no invented names, no invented
// scores.
// ══════════════════════════════════════════════════════════════════

function _buildTestimCard(t) {
  const stars = Number(t.stars) || 5;
  const starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  const initial = (t.name || '?').charAt(0).toUpperCase();
  const avatarHTML = t.image_url
    ? `<div class="home-testim-avatar"><img src="${t.image_url}" alt="${initial}" loading="lazy" onerror="this.style.display='none';this.parentNode.textContent='${initial}'"></div>`
    : `<div class="home-testim-avatar">${initial}</div>`;
  const verifiedBadge = t.verified
    ? `<div class="home-testim-verified">✓ Verified Buyer</div>`
    : '';
  const textBody = (t.text || '').charAt(0) === '"' ? t.text : `"${t.text}"`;
  return `<div class="home-testim-card">
    <div class="home-testim-stars" style="color:#fbbf24;font-size:.9rem;letter-spacing:1px">${starStr}</div>
    <div class="home-testim-text">${textBody}</div>
    <div class="home-testim-author">
      ${avatarHTML}
      <div>
        <div class="home-testim-name">${t.name || ''}</div>
        ${t.role ? `<div class="home-testim-role">${t.role}</div>` : ''}
        ${verifiedBadge}
      </div>
    </div>
  </div>`;
}

function _renderTestimEmptyState() {
  const track = document.getElementById('testimTrack');
  if (!track) return;
  track.style.animation = 'none';
  track.innerHTML = `<div class="home-testim-card" style="text-align:center;cursor:default">
    <div style="font-size:1.4rem;margin-bottom:8px">⭐</div>
    <div style="font-weight:700;margin-bottom:6px">No reviews yet — be the first!</div>
    <div style="font-size:.85rem;color:var(--text2);line-height:1.5">Every review on Studyria comes from a verified buyer. Purchase a PDF and share what you thought — real names, real ratings only.</div>
  </div>`;
}

function _renderTestimCards(list) {
  const track = document.getElementById('testimTrack');
  if (!track) return;
  if (!list || !list.length) { _renderTestimEmptyState(); return; }
  // Duplicate list for seamless infinite scroll
  const cards = [...list, ...list].map(_buildTestimCard).join('');
  track.innerHTML = cards;
  // Restart animation so timing resets with new content length
  track.style.animation = 'none';
  requestAnimationFrame(() => {
    track.style.animation = '';
    // Adjust scroll duration based on card count (≈2.5s per card)
    const duration = Math.max(16, list.length * 2.5);
    track.style.animationDuration = duration + 's';
  });
}

/**
 * fetchTopVerifiedReviews(limit)
 * Pulls real, verified-purchase reviews straight from pdf_reviews
 * (already gated to verified buyers only — see supabase.js) and
 * shapes them like a testimonial card. This is the "real reviews"
 * source for the homepage carousel.
 */
async function fetchTopVerifiedReviews(limit) {
  try {
    const client = window.supabaseClient;
    if (!client) return [];
    const { data, error } = await client
      .from('pdf_reviews')
      .select('id,rating,comment,user_name,pdf_id,created_at,verified')
      .eq('verified', true)
      .gte('rating', 4)
      .order('created_at', { ascending: false })
      .limit(limit || 20);
    if (error || !data) return [];
    return data.map(r => ({
      name: r.user_name || 'Verified Student',
      role: 'Verified Buyer',
      stars: r.rating,
      text: r.comment,
      verified: true,
    })).filter(r => r.text && r.text.trim());
  } catch (e) {
    return [];
  }
}

async function loadHomepageTestimonials() {
  // Honest empty state first — never show invented people while loading.
  _renderTestimEmptyState();

  try {
    const [curated, verified] = await Promise.all([
      typeof window.loadTestimonials === 'function' ? window.loadTestimonials(30) : Promise.resolve([]),
      fetchTopVerifiedReviews(20),
    ]);
    const combined = [...(curated || []), ...verified];
    if (combined.length > 0) {
      _renderTestimCards(combined);
    }
    // else keep the honest empty state rendered above
  } catch(e) {
    console.warn('loadHomepageTestimonials:', e);
    // empty state already rendered above
  }
}

// ══════════════════════════════════════════════════════════════════
// ── SEARCH & DISCOVER ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

let discoverDebounce = null;

function onDiscoverInput() {
  clearTimeout(discoverDebounce);
  discoverDebounce = setTimeout(runDiscover, 380);
}

async function runDiscover() {
  const query    = (document.getElementById('discoverSearch')?.value || '').trim().toLowerCase();
  const cat      = document.getElementById('dCat')?.value || '';
  const sub      = document.getElementById('dSub')?.value || '';
  const stream   = document.getElementById('dStream')?.value || '';
  const subject  = document.getElementById('dSubject')?.value || '';

  // Show/hide results wrap
  const hasFilters = query || cat || sub || stream || subject;
  const resultsWrap = document.getElementById('discoverResultsWrap');
  if (resultsWrap) resultsWrap.style.display = hasFilters ? 'block' : 'none';
  if (!hasFilters) { updateActivePills(); return; }

  // Show loading
  const discoverLoading = document.getElementById('discoverLoading');
  const discoverResults = document.getElementById('discoverResults');
  const discoverEmpty = document.getElementById('discoverEmpty');
  if (discoverLoading) discoverLoading.style.display = 'flex';
  if (discoverResults) discoverResults.innerHTML = '';
  if (discoverEmpty) discoverEmpty.style.display = 'none';
  updateActivePills();

  let results = [];

  // ── Try Supabase first ───────────────────────────────────────────
  if (typeof supabase !== 'undefined') {
    try {
      let q = supabase.from('pdfs').select('*');
      // Prefer ID-based filtering when DB cache is populated
      if (cat) {
        const catObj = (window._dbCategories||[]).find(c => c.name === cat || c.slug === cat);
        q = catObj ? q.eq('category_id', catObj.id) : q.eq('category', cat);
      }
      if (sub) {
        const subObj = (window._dbSubcategories||[]).find(s => s.name === sub || s.slug === sub);
        q = subObj ? q.eq('subcategory_id', subObj.id) : q.eq('category_id', catObj?.id || null);
      }
      if (stream) {
        const strObj = (window._dbStreams||[]).find(s => s.name === stream || s.slug === stream);
        if (strObj) q = q.eq('stream_id', strObj.id);
      }
      if (subject) {
        const subjObj = (window._dbSubjects||[]).find(s => s.name === subject || s.slug === subject);
        if (subjObj) q = q.eq('subject_id', subjObj.id);
      }
      if (query)   q = q.or(`title.ilike.%${query}%,seo_keywords.ilike.%${query}%`);
      q = q.eq('status', 'published').limit(40);
      const { data, error } = await q;
      if (!error && data && data.length > 0) {
        results = data;
      }
    } catch(e) { /* fallback to local */ }
  }

  // ── Fallback: filter local PDFS ──────────────────────────────────
  if (results.length === 0) {
    results = PDFS.filter(p => {
      const matchQ = !query ||
        (p.title || '').toLowerCase().includes(query) ||
        (p.author || '').toLowerCase().includes(query) ||
        (p.category || '').toLowerCase().includes(query);
      const matchCat    = !cat    || (p.category    || '').toLowerCase() === cat.toLowerCase();
      const matchSub    = !sub    || String(p.subcategory_id) === String((window._dbSubcategories||[]).find(s=>s.name===sub)?.id||'');
      const matchStream = !stream || String(p.stream_id) === String((window._dbStreams||[]).find(s=>s.name===stream)?.id||'');
      const matchSubj   = !subject|| String(p.subject_id) === String((window._dbSubjects||[]).find(s=>s.name===subject)?.id||'');
      return matchQ && matchCat && matchSub && matchStream && matchSubj;
    });
  }

  const _dl = document.getElementById('discoverLoading');
  if (_dl) _dl.style.display = 'none';

  const _de = document.getElementById('discoverEmpty');
  const _dc = document.getElementById('discoverResultsCount');
  const _dr = document.getElementById('discoverResults');

  if (results.length === 0) {
    if (_de) _de.style.display = 'block';
    if (_dc) _dc.innerHTML = '<strong>0</strong> results';
  } else {
    if (_dc) _dc.innerHTML = `Found <strong>${results.length}</strong> PDF${results.length !== 1 ? 's' : ''}`;
    if (_dr) _dr.innerHTML = validPdfs(results).map(p => pdfCardHTML(p)).join('');
    // Refresh ownership-aware button labels
    setTimeout(_refreshFreeButtonLabels, 50);
  }
}

function updateActivePills() {
  const fields = [
    { id: 'dCat',     label: 'Category' },
    { id: 'dSub',     label: 'Class' },
    { id: 'dStream',  label: 'Stream' },
    { id: 'dSubject', label: 'Subject' },
  ];
  const container = document.getElementById('activeFilterPills');
  container.innerHTML = fields
    .filter(f => document.getElementById(f.id)?.value)
    .map(f => {
      const val = document.getElementById(f.id).value;
      return `<span class="active-filter-pill">
        ${f.label}: <strong>${val}</strong>
        <button onclick="clearFilter('${f.id}')" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>`;
    }).join('');
}

function clearFilter(id) {
  const el = document.getElementById(id);
  if (el) el.value = '';
  runDiscover();
}

function clearDiscover() {
  ['discoverSearch','dCat','dSub','dStream','dSubject'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const _rw = document.getElementById('discoverResultsWrap');
  if (_rw) _rw.style.display = 'none';
  const _ap = document.getElementById('activeFilterPills');
  if (_ap) _ap.innerHTML = '';
}

// ══════════════════════════════════════════════════════════════════
// ── TRENDING & NEW ARRIVALS SHELVES ──────────────────────────────
// ══════════════════════════════════════════════════════════════════

function shelfSkeletons(n = 4) {
  return Array(n).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-cover"></div>
      <div class="skeleton-body">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line shorter"></div>
      </div>
    </div>`).join('');
}

// ── LIBRARY ───────────────────────────────────────────────────────
function renderLibrary() {
  // New OTT Library engine is inlined in page-library HTML.
  // This shim calls the OTT functions for backward compat.
  if (typeof ottlibRenderCats === 'function') {
    ottlibRenderCats();
    ottlibRenderShelves();
    ottlibRenderAchievements();
    ottlibRenderStreakBanner();
  }
  if (typeof ottlibRenderCategoryRows === 'function') ottlibRenderCategoryRows();
  // Also update category pills via old system
  const filtersEl = document.getElementById('libFilters');
  if (filtersEl) filtersEl.innerHTML = '';
  renderLibGrid();
  renderLibHeroStats();
  setTimeout(_refreshFreeButtonLabels, 50);
}

// ── PREMIUM HERO STATS (Supabase-powered, animated) ─────────────────────
async function renderLibHeroStats() {
  const pdfs = window.PDFS || [];
  const totalEl = document.getElementById('libStatTotal');
  const dlEl = document.getElementById('libStatDownloads');
  const catEl = document.getElementById('libStatCategories');
  const wishEl = document.getElementById('libStatWishlist');
  if (!totalEl) return;

  let pdfCount = pdfs.length;
  let totalDownloads = pdfs.reduce((sum, p) => sum + (p.download_count || p.sales || 0), 0);
  let cats = new Set(pdfs.map(p => p.category).filter(Boolean));

  // If local data is empty, try Supabase for real counts
  if (pdfCount === 0 && window.supabaseClient) {
    try {
      const [countRes, dlRes] = await Promise.all([
        window.supabaseClient.from('pdfs').select('id,category,download_count', { count: 'exact' }).eq('status','published'),
        window.supabaseClient.from('pdfs').select('category,download_count').eq('status','published')
      ]);
      if (!countRes.error && countRes.data) {
        pdfCount = countRes.count || countRes.data.length;
        totalDownloads = (dlRes.data || []).reduce((s,r) => s + (r.download_count||0), 0);
        cats = new Set((dlRes.data||[]).map(r => r.category).filter(Boolean));
      }
    } catch(e) { /* use fallback */ }
  }

  animateCount(totalEl, pdfCount);
  animateCount(dlEl, totalDownloads, true);
  animateCount(catEl, cats.size || (window.CATEGORIES||[]).length - 1);
  animateCount(wishEl, (wishlist || []).length);
}

function animateCount(el, target, abbreviate) {
  if (!el) return;
  const fmt = (n) => abbreviate && n >= 1000 ? (n/1000).toFixed(1) + 'k' : Math.round(n).toLocaleString();
  let start = 0;
  const duration = 700;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = start + (target - start) * progress;
    el.textContent = fmt(value);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = fmt(target);
    }
  }
  requestAnimationFrame(tick);
}

// ── TRENDING / RECOMMENDED SHELVES (additive, UI-only) ──────────────
function renderLibShelves() {
  const trendEl = document.getElementById('libTrendingShelf');
  const featEl = document.getElementById('libFeaturedShelf');
  if (!trendEl || !featEl) return;

  const pdfs = validPdfs(window.PDFS || []);
  if (!pdfs.length) {
    trendEl.innerHTML = shelfSkeletons(4);
    featEl.innerHTML = shelfSkeletons(4);
    return;
  }

  const trending = pdfs.slice().sort((a,b) => (b.download_count||b.sales||0) - (a.download_count||a.sales||0)).slice(0, 8);
  const featured = pdfs.slice().sort((a,b) => (b.rating||0) - (a.rating||0)).slice(0, 8);

  trendEl.innerHTML = trending.map(p => pdfCardHTML(p)).join('') || '';
  featEl.innerHTML = featured.map(p => pdfCardHTML(p)).join('') || '';
}

function setLibCat(cat) {
  libCat = cat;
  renderLibrary();
}

function toggleFreeOnly() {
  freeOnly = !freeOnly;
  document.getElementById('freeOnlyBtn').classList.toggle('active', freeOnly);
  renderLibGrid();
}

async function renderLibGrid() {
  const search = (document.getElementById('libSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('libSort')?.value || 'popular';
  const grid = document.getElementById('libGrid');
  const empty = document.getElementById('libEmpty');
  const countEl = document.getElementById('libCount');

  // Show loading skeletons using new OTT style
  if (grid) grid.innerHTML = Array(8).fill('<div class="ottlib-grid-card ottlib-skeleton" style="aspect-ratio:2/3"></div>').join('');

  // ── Load from Supabase first ───────────────────────────────────
  if (window.supabaseClient) {
    try {
      let q = window.supabaseClient.from('pdfs').select('*').eq('status', 'published');
      if (libCat && libCat !== 'All') {
        const catObj = (window._dbCategories||[]).find(c => c.name === libCat);
        q = catObj ? q.eq('category_id', catObj.id) : q.eq('category', libCat);
      }
      q = q.order('created_at', { ascending: false }).limit(100);
      const { data, error } = await q;
      if (!error && data && data.length > 0) {
        data.forEach(row => {
          const idx = window.PDFS.findIndex(p => String(p.id) === String(row.id));
          if (idx >= 0) window.PDFS[idx] = Object.assign(window.PDFS[idx], row);
          else window.PDFS.push(row);
        });
      }
    } catch(e) { console.warn('Library Supabase fetch:', e); }
  }

  let filtered = validPdfs(window.PDFS || []).filter(p =>
    (libCat === 'All' || !libCat || p.category === libCat) &&
    (!freeOnly || p.free || p.price === 0) &&
    (search === '' || (p.title||'').toLowerCase().includes(search) ||
     (p.author||'').toLowerCase().includes(search) ||
     (p.category||'').toLowerCase().includes(search))
  );
  if (sort === 'popular') filtered.sort((a,b) => (b.download_count||b.sales||0) - (a.download_count||a.sales||0));
  if (sort === 'rating')  filtered.sort((a,b) => (b.rating||0) - (a.rating||0));
  if (sort === 'price-low') filtered.sort((a,b) => (a.price||0) - (b.price||0));
  if (sort === 'price-high') filtered.sort((a,b) => (b.price||0) - (a.price||0));
  if (sort === 'newest') filtered.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  if (countEl) countEl.textContent = `${filtered.length} PDFs`;

  if (grid) {
    if (filtered.length === 0) {
      // Show friendly empty state instead of blank grid
      grid.innerHTML = '';
      if (empty) {
        empty.classList.remove('hidden');
        const emptyTitle = empty.querySelector('.lib-empty-title');
        const emptyBody = empty.querySelector('p, .lib-empty-body, .lib-empty-sub');
        if (emptyTitle) emptyTitle.textContent = search || libCat !== 'All' ? 'No PDFs Found' : 'Library Loading…';
        if (emptyBody) emptyBody.textContent = search ? `No results for "${search}". Try a different search term.` : libCat && libCat !== 'All' ? `No PDFs in "${libCat}" yet. Browse All Categories.` : 'PDFs are loading. Please check your connection.';
      }
    } else {
      if (empty) empty.classList.add('hidden');
      if (typeof ottlibCardHTML === 'function') {
        grid.innerHTML = filtered.map(p => ottlibCardHTML(p)).join('');
      } else {
        grid.innerHTML = filtered.map(p => pdfCardHTML(p)).join('');
      }
    }
  }
  renderLibHeroStats();
  if (typeof ottlibRenderShelves === 'function') ottlibRenderShelves();
  // Trigger lazy-load observer for new images
  setTimeout(() => { if (typeof window.initLazyImages === 'function') window.initLazyImages(); }, 100);
}

// ── DETAIL ────────────────────────────────────────────────────────
function openDetail(id) {
  selectedPdf = (window.PDFS || []).find(p => String(p.id) === String(id));
  if (!selectedPdf) {
    showToast('PDF not found', 'info');
    return;
  }
  normalizePdf(selectedPdf);
  navigate('detail');
}
// Alias for OTT discovery cards
function openPDFDetail(id) { openDetail(id); }
// ── DETAIL PAGE — live Supabase data only, zero hardcoded/demo values ──
function renderDetail() {
  const pdf = selectedPdf;
  if (!pdf) return;
  normalizePdf(pdf);
  _pdpRenderShell(pdf);
  _pdpLoadLiveStats(pdf.id);
  _pdpSubscribeRealtime(pdf.id);
  // Ownership labels are baked into _pdpRenderShell via _isOwned().
  // If ownership cache wasn't ready yet, refresh labels after a short delay
  // to catch cases where cache loads slightly after render.
  if (!window._ownedCacheReady && window.currentUser) {
    _loadOwnershipCache().then(() => {
      setTimeout(_refreshFreeButtonLabels, 50);
    });
  }
}

// ── HTML-escape helper ──────────────────────────────────────────────────
function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Build the static shell from the pdf row already in memory ──────────
function _pdpRenderShell(pdf) {
  const inWish    = wishlist.includes(pdf.id) || wishlist.includes(String(pdf.id));
  // Use ONLY canonical price field (set by normalizePdf). Never read selling_price here.
  const price     = Number(pdf.price ?? 0);
  const origPrice = Number(pdf.originalPrice ?? 0);
  const discount  = (origPrice > 0 && price > 0 && origPrice > price)
                      ? Math.round((1 - price / origPrice) * 100) : 0;
  const coverFrom = pdf.coverFrom || '#1d4ed8';
  const coverTo   = pdf.coverTo   || '#3d8ef8';

  // Cover HTML — only real image, fallback gradient (no placeholder text)
  const coverSrc = (pdf.cover_image || pdf.coverImage || '').trim();
  const coverHTML = coverSrc
    ? `<img src="${coverSrc}" alt="${_esc(pdf.title)}" class="pdp-cover-img"
          width="400" height="600"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy" decoding="async">
       <div class="pdp-cover-fallback" style="background:linear-gradient(135deg,${coverFrom},${coverTo})">${icon('file',64)}</div>`
    : `<div class="pdp-cover-fallback" style="background:linear-gradient(135deg,${coverFrom},${coverTo})">${icon('file',64)}</div>`;

  // Description — only if real data exists
  const description = (pdf.description || '').trim();

  // Dates — only if real column value
  const publishedVal = pdf.created_at
    ? new Date(pdf.created_at).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'})
    : null;
  const updatedVal = pdf.updated_at
    ? new Date(pdf.updated_at).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'})
    : null;

  // Trust badges (factual product promises — not stats)
  const trustItems = [
    { icon:'⚡', label:'Instant Download' },
    { icon:'🔒', label:'Secure Payment' },
    { icon:'♾️', label:'Lifetime Access' },
    { icon:'✅', label:'Verified Content' },
    { icon:'📱', label:'Mobile Friendly' },
  ];

  // Learning outcomes (static product copy)
  const outcomes = [
    'Comprehensive theory coverage','Solved examples & practice sets',
    'Previous year questions','Quick revision charts',
    'Chapter-wise breakdowns','Expert tips & tricks',
  ];

  // Related PDFs — only real records, exclude broken
  const relatedPdfs = validPdfs(window.PDFS || []).filter(p =>
    String(p.id) !== String(pdf.id) &&
    (p.category === pdf.category || p.subcategory_id === pdf.subcategory_id)
  ).slice(0, 6);

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

          <!-- Cover card -->
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
              <button class="pdp-cover-action-btn pdp-zoom-btn" onclick="pdpZoomCover()" title="Zoom">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                Zoom
              </button>
            </div>
          </div>

          <!-- PDF Page Preview — cover above scrolls normally; this block
               only engages sticky behavior for its own scroll range, after
               the cover card has scrolled past. Hidden until JS confirms
               a usable preview PDF + pdf.js are available. -->
          <div class="pdp-preview-track" id="pdpPreviewTrack">
            <div class="pdp-preview-sticky" id="pdpPreviewSticky">
              <div class="pdp-preview-stage" id="pdpPreviewStage">
                <img class="pdp-preview-img" id="pdpPreviewImg" alt="PDF page preview">
                <div class="pdp-preview-loading" id="pdpPreviewLoading">
                  <div class="pdp-preview-spinner"></div>
                  <span>Loading preview…</span>
                </div>
              </div>
              <div class="pdp-preview-pageindicator" id="pdpPreviewPageIndicator"></div>
            </div>
          </div>

          <!-- Title / meta block -->
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

            <!-- Live rating row — filled by _pdpLoadLiveStats -->
            <div class="pdp-rating-row" id="pdpRatingRow" style="display:none">
              <span class="pdp-stars" id="pdpRatingStars"></span>
              <span class="pdp-rating-val" id="pdpRatingVal"></span>
              <span class="pdp-rating-count" id="pdpRatingCount"></span>
              <span class="pdp-rating-sep" id="pdpStudentsSep" style="display:none">•</span>
              <span class="pdp-students-count" id="pdpStudentsCount" style="display:none"></span>
            </div>
          </div>

          <!-- Info chips — only real data -->
          <div class="pdp-info-chips" id="pdpInfoChips">
            ${pdf.category ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📚</span><span class="pdp-ic-label">Category</span><span class="pdp-ic-val">${_esc(pdf.category)}</span></div>` : ''}
            ${pdf.subcategory_id ? (() => { const _s=(window._dbSubcategories||[]).find(s=>String(s.id)===String(pdf.subcategory_id)); return _s?`<div class="pdp-info-chip"><span class="pdp-ic-icon">🏫</span><span class="pdp-ic-label">Class/Level</span><span class="pdp-ic-val">${_esc(_s.name)}</span></div>`:''; })() : ''}
            ${pdf.stream_id ? (() => { const _s=(window._dbStreams||[]).find(s=>String(s.id)===String(pdf.stream_id)); return _s?`<div class="pdp-info-chip"><span class="pdp-ic-icon">🌊</span><span class="pdp-ic-label">Stream</span><span class="pdp-ic-val">${_esc(_s.name)}</span></div>`:''; })() : ''}
            ${pdf.language ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">🌐</span><span class="pdp-ic-label">Language</span><span class="pdp-ic-val">${_esc(pdf.language)}</span></div>` : ''}
            ${(pdf.pages || pdf.total_pages) ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📄</span><span class="pdp-ic-label">Pages</span><span class="pdp-ic-val">${pdf.pages || pdf.total_pages}</span></div>` : ''}
            <div class="pdp-info-chip" id="pdpChipDownloads" style="display:none"><span class="pdp-ic-icon">📥</span><span class="pdp-ic-label">Downloads</span><span class="pdp-ic-val" id="pdpChipDlVal"></span></div>
            ${publishedVal ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">📅</span><span class="pdp-ic-label">Published</span><span class="pdp-ic-val">${publishedVal}</span></div>` : ''}
            ${updatedVal ? `<div class="pdp-info-chip"><span class="pdp-ic-icon">🔄</span><span class="pdp-ic-label">Updated</span><span class="pdp-ic-val">${updatedVal}</span></div>` : ''}
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

          <div class="pdp-section pdp-mobile-price-block" id="pdpMobilePriceBlock"></div>

          <!-- Live Reviews — hidden until real data arrives -->
          <div class="pdp-section" id="pdpReviewsSection" style="display:none">
            <div class="pdp-section-title">⭐ Student Reviews</div>
            <div class="pdp-reviews-summary" id="pdpReviewsSummary"></div>
            <div class="pdp-reviews-list" id="pdpReviewsList"></div>
            <div id="pdpWriteReviewWrap"></div>
          </div>

          ${relatedPdfs.length ? `
          <div class="pdp-section">
            <div class="pdp-section-title">📚 Related PDFs</div>
            <div class="pdp-related-track">
              ${relatedPdfs.map(p => typeof pdfCardHTML === 'function' ? pdfCardHTML(normalizePdf(p)) : '').join('')}
            </div>
          </div>` : ''}

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
              ${trustItems.map(t => `
                <div class="pdp-buy-feature-row">
                  <span>${t.icon}</span><span>${t.label}</span>
                </div>`).join('')}
            </div>

            <!-- Detail table — only real data + live rows -->
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

  // Scroll-driven sticky PDF page preview
  pdpInitPreview(pdf);

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

// ── Scroll-driven sticky PDF page preview ───────────────────────────────
// How it works:
//  • .pdp-preview-track is a normal-flow block sized to (numPages × a
//    fixed viewport-height slot). Scrolling through that block is what
//    drives which page is shown.
//  • .pdp-preview-sticky inside it uses plain CSS `position: sticky`, so
//    it pins itself at `top` only while the track is taller than the
//    viewport and still scrolling underneath it — once the track's own
//    height is used up (i.e. after the last page), it naturally falls
//    back into normal flow and stops being sticky. No manual unpin logic
//    needed for that part.
//  • A passive scroll listener maps how far we've scrolled through the
//    track into a page index (1..numPages), rendering + caching each
//    page from the real preview PDF via pdf.js so it is always shown in
//    full (object-fit: contain — never cropped). Works identically for
//    scrolling up (shows earlier pages again) and down.
async function pdpInitPreview(pdf) {
  const track     = document.getElementById('pdpPreviewTrack');
  const stickyEl  = document.getElementById('pdpPreviewSticky');
  const img       = document.getElementById('pdpPreviewImg');
  const loading   = document.getElementById('pdpPreviewLoading');
  const indicator = document.getElementById('pdpPreviewPageIndicator');
  if (!track || !img) return;

  // Always clear out any previous PDP's listener/state first (re-renders
  // happen every time the user opens a new PDP).
  if (window._pdpPreviewScrollHandler) {
    window.removeEventListener('scroll', window._pdpPreviewScrollHandler);
    window._pdpPreviewScrollHandler = null;
  }
  if (window._pdpPreviewResizeHandler) {
    window.removeEventListener('resize', window._pdpPreviewResizeHandler);
    window._pdpPreviewResizeHandler = null;
  }
  track.classList.remove('active');
  img.classList.remove('loaded');
  img.removeAttribute('src');
  if (loading) loading.style.display = '';
  if (indicator) indicator.textContent = '';

  const previewUrl = (pdf.previewPdfUrl || pdf.preview_pdf_url || '').trim();
  if (!previewUrl) return; // no preview file for this PDF — leave the block hidden

  if (!window.pdfjsLib) {
    console.warn('pdpInitPreview: pdf.js not available — skipping page preview');
    return;
  }

  let pdfDoc, numPages = 0;
  try {
    pdfDoc = await window.pdfjsLib.getDocument(previewUrl).promise;
    numPages = pdfDoc.numPages || 0;
  } catch (e) {
    console.warn('pdpInitPreview: failed to load preview PDF', e);
    return;
  }
  if (!numPages) return;

  // Make sure this is still the PDP the user is looking at (they may have
  // navigated away while the PDF was loading).
  if (!document.getElementById('pdpPreviewTrack')) return;

  track.classList.add('active');

  const SLOT_RATIO = 0.9; // scroll distance per page, as a fraction of viewport height — tune for feel
  // Use visualViewport height when available — it reflects the *stable*
  // layout viewport rather than the raw window.innerHeight, which mobile
  // browsers shrink/grow as their URL bar collapses/expands mid-scroll.
  function stableViewportHeight() {
    return (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  }
  function sizeTrack() {
    track.style.height = (numPages * stableViewportHeight() * SLOT_RATIO) + 'px';
  }
  sizeTrack();

  const pageCache = {};   // pageNum -> rendered data URL
  const renderQueue = {}; // pageNum -> in-flight render promise
  let currentPage = 0;

  function renderPage(n) {
    if (pageCache[n]) return Promise.resolve(pageCache[n]);
    if (renderQueue[n]) return renderQueue[n];
    renderQueue[n] = pdfDoc.getPage(n).then(page => {
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        const url = canvas.toDataURL('image/jpeg', 0.85);
        pageCache[n] = url;
        delete renderQueue[n];
        return url;
      });
    }).catch(e => {
      delete renderQueue[n];
      throw e;
    });
    return renderQueue[n];
  }

  async function showPage(n) {
    n = Math.min(numPages, Math.max(1, n));
    if (n === currentPage) return;
    currentPage = n;
    if (indicator) indicator.textContent = `Page ${n} of ${numPages}`;
    try {
      const url = await renderPage(n);
      if (currentPage !== n) return; // a newer page request won the race
      img.src = url;
      img.classList.add('loaded');
      if (loading) loading.style.display = 'none';
    } catch (e) {
      console.warn('pdpInitPreview: page render failed', n, e);
    }
    // Pre-warm neighbours so scrolling feels instant in both directions
    if (n + 1 <= numPages) renderPage(n + 1).catch(() => {});
    if (n - 1 >= 1) renderPage(n - 1).catch(() => {});
  }

  function computePageFromScroll() {
    const rect = track.getBoundingClientRect();
    const stickyHeight = stickyEl ? stickyEl.offsetHeight : window.innerHeight;
    const scrollable = rect.height - stickyHeight;
    if (scrollable <= 0) return 1;
    const progress = Math.max(0, Math.min(1, -rect.top / scrollable));
    return Math.floor(progress * numPages) + 1;
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      showPage(computePageFromScroll());
      ticking = false;
    });
  }

  let resizeTicking = false;
  let lastKnownWidth = window.innerWidth;
  function onResize() {
    if (resizeTicking) return;
    resizeTicking = true;
    requestAnimationFrame(() => {
      // Mobile browsers fire 'resize' when their URL bar collapses/expands
      // during scroll (in EITHER direction) — that only changes innerHeight,
      // never innerWidth. Re-sizing the track on those phantom events is
      // what caused the mobile "zoom/shift" bug: real layout changes
      // (rotation, actual breakpoint change) always change the width, so
      // gating on width-only change filters out the false positives while
      // still catching every real resize.
      const currentWidth = window.innerWidth;
      if (currentWidth !== lastKnownWidth) {
        lastKnownWidth = currentWidth;
        sizeTrack();
        showPage(computePageFromScroll());
      }
      resizeTicking = false;
    });
  }

  window._pdpPreviewScrollHandler = onScroll;
  window._pdpPreviewResizeHandler = onResize;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  showPage(1); // first page as soon as it's ready
  onScroll();  // correct immediately if the page was opened mid-scroll
}

// ── Fetch all live counters + reviews from Supabase in one parallel pass ──
// ── Seeded deterministic pseudo-random (same pdf → same fake numbers always) ──
function _pdpSeed(id, salt) {
  let h = (Number(id) * 2654435769 + salt * 1234567891) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── Marketing mode fake data — realistic Assam student reviews ─────────
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
  const pdf = selectedPdf || {};
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

// ── Write live stats into the already-rendered DOM ──────────────────────
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

// ── Review submission form ───────────────────────────────────────────────
async function _pdpRenderReviewForm(container) {
  if (!container) return;
  const pdf     = selectedPdf;
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
  const pdfId   = selectedPdf?.id;

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

async function _loadCardRatings(pdfIds) {
  if (!window.fetchReviewStats || !pdfIds || !pdfIds.length) return;
  for (const pdfId of pdfIds) {
    if (window._cardRatingCache[pdfId]) continue; // already loaded
    try {
      const stats = await window.fetchReviewStats(pdfId);
      // Only swap in real data once at least one real review exists — until
      // then the OTT card keeps its seeded placeholder (never blank/zero).
      if (stats && stats.avgRating !== null) {
        window._cardRatingCache[pdfId] = stats;
        // Update all cards for this pdf on the page
        document.querySelectorAll(`[data-pdf-id="${pdfId}"]`).forEach(card => {
          // ── Netflix-style OTT row/grid cards (.ott-card) ──────────────
          const ottRatingEl = card.querySelector('.ott-card-rating');
          if (ottRatingEl) {
            const countHTML = stats.reviewCount > 0 ? `<span class="ott-card-rating-count">(${stats.reviewCount.toLocaleString()})</span>` : '';
            ottRatingEl.innerHTML = `${window._ottStarSvgHTML || ''}<span>${stats.avgRating.toFixed(1)}</span>${countHTML}`;
          }
          // ── Library "Browse Categories" cards (.ottlib-card-rating) ──
          const ottlibRatingEl = card.querySelector('.ottlib-card-rating');
          if (ottlibRatingEl) {
            ottlibRatingEl.innerHTML = `<span class="ottlib-star">★</span>${stats.avgRating.toFixed(1)}`;
          }
          // ── Legacy list-style cards (.pdf-meta) ───────────────────────
          const metaEl = card.querySelector('.pdf-meta');
          if (!metaEl) return;
          // Remove stale rating if present
          const existing = metaEl.querySelector('.pdf-rating');
          if (existing) existing.remove();
          const oldCount = metaEl.querySelector('.pdf-meta-revcount');
          if (oldCount) oldCount.remove();
          // Insert fresh rating
          const stars = Math.round(stats.avgRating);
          const filledStar = `<svg width="11" height="11" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#f59e0b"/></svg>`;
          const ratingSpan = document.createElement('span');
          ratingSpan.className = 'pdf-rating pdf-rating-pill';
          ratingSpan.innerHTML = filledStar + stats.avgRating.toFixed(1);
          metaEl.insertBefore(ratingSpan, metaEl.firstChild);
          if (stats.reviewCount > 0) {
            const countSpan = document.createElement('span');
            countSpan.className = 'pdf-meta-revcount';
            countSpan.style.cssText = 'color:var(--text3);font-size:0.65rem;font-family:var(--font-ui)';
            countSpan.textContent = `(${stats.reviewCount.toLocaleString()})`;
            metaEl.insertBefore(countSpan, ratingSpan.nextSibling);
          }
        });
      }
    } catch (_) { /* non-critical */ }
  }
}

window._loadCardRatings = _loadCardRatings; // expose for realtime hook in supabase.js

// Hook into shelf / grid renders to trigger card rating loads
(function() {
  const _origRenderLibGrid = window.renderLibGrid;
  window.renderLibGrid = function() {
    const r = _origRenderLibGrid && _origRenderLibGrid.apply(this, arguments);
    setTimeout(() => {
      const ids = [...document.querySelectorAll('[data-pdf-id]')].map(el => el.dataset.pdfId).filter(Boolean);
      _loadCardRatings([...new Set(ids)]);
    }, 300);
    return r;
  };
})();

// ── Universal card-rating loader ─────────────────────────────────────────
// Product cards render in many places (Home trending/new-arrivals shelves,
// Library grid, Wishlist grid, related-products on Product Details, search
// results). Rather than patching every render function individually (risky
// on a codebase this size), watch the DOM for any new [data-pdf-id] card
// and load its rating automatically — covers every current and future
// card surface with zero changes to existing render logic.
(function() {
  let scanTimer = null;
  function scanForNewCards() {
    const ids = [...document.querySelectorAll('[data-pdf-id]')]
      .map(el => el.dataset.pdfId)
      .filter(id => id && !window._cardRatingCache[id]);
    if (ids.length) _loadCardRatings([...new Set(ids)]);
  }
  const cardObserver = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanForNewCards, 350);
  });
  document.addEventListener('DOMContentLoaded', () => {
    cardObserver.observe(document.body, { childList: true, subtree: true });
    scanForNewCards();
  });
})();

// ── Realtime subscriptions: auto-refresh stats on new activity ──────────
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

/* ── PDP HELPERS ─────────────────────────────────────────────── */
function pdpHandleBuy() {
  const pdf = selectedPdf;
  if (!pdf) return;
  normalizePdf(pdf);
  const price = Number(pdf.price ?? 0);
  // Free PDFs always go through downloadPDF which handles ownership grant
  if (pdf.free) downloadPDF(pdf.id);
  else buyPDF(pdf.id, price);
}

async function pdpToggleWish() {
  const pdf = selectedPdf;
  if (!pdf) return;
  await toggleWish(pdf.id); // wait for the full toggle (incl. DB write/guest save) before reading state back
  {
    const inWish = wishlist.includes(pdf.id) || wishlist.includes(String(pdf.id));
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

function pdpToggleDesc() {
  const wrap = document.getElementById('pdpDescWrap');
  const btn = document.getElementById('pdpReadMoreBtn');
  if (!wrap || !btn) return;
  wrap.classList.toggle('expanded');
  btn.textContent = wrap.classList.contains('expanded') ? 'Read Less ↑' : 'Read More ↓';
}

function pdpSharePDF() {
  const pdf = selectedPdf;
  if (!pdf) return;
  const url = window.location.href;
  const text = `Check out "${pdf.title}" on Studyria! 📚`;
  if (navigator.share) {
    navigator.share({ title: pdf.title, text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied! 📋', 'success')).catch(() => {});
  }
}

// Force-clears the fullscreen cover preview and its scroll lock, no matter
// how it was left open. Called defensively from pdpZoomCover() itself and
// from navigate() below, so a stray overlay can never survive a page change
// and corrupt the layout of whatever page the user goes to next.
function _pdpClearZoomLock() {
  document.querySelectorAll('.pdp-zoom-overlay').forEach(el => el.remove());
  document.body.classList.remove('pdp-zoom-lock');
  document.body.style.top = ''; // clears any leftover value from older cached builds
}

function pdpZoomCover() {
  const pdf = selectedPdf;
  if (!pdf || !pdf.coverImage) { showToast('No cover image to zoom.', 'info'); return; }

  // Defensive: clear any stray lock/overlay left behind by a previous
  // session that didn't close cleanly (e.g. SPA navigation away from
  // the page while the preview was still open).
  _pdpClearZoomLock();

  document.body.classList.add('pdp-zoom-lock');

  const overlay = document.createElement('div');
  overlay.className = 'pdp-zoom-overlay';
  overlay.innerHTML = `
    <div class="pdp-zoom-bg"></div>
    <button class="pdp-zoom-close" aria-label="Close preview">✕</button>
    <div class="pdp-zoom-content">
      <img src="${pdf.coverImage}" alt="${escH(pdf.title || 'PDF cover')}" class="pdp-zoom-img" loading="lazy" decoding="async" draggable="false">
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

  // ── Pinch-to-zoom, double-tap zoom, and pan ─────────────────────
  let scale = 1, lastScale = 1;
  let originX = 0, originY = 0, panStartX = 0, panStartY = 0;
  let startDist = 0, isPanning = false, lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  function clampScale(s) { return Math.min(Math.max(s, 1), 4); }
  function clampPan() {
    // Keep the image roughly within the viewport while zoomed/panned
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
    if (scale > 1) {
      resetZoom(true);
    } else {
      const rect = img.getBoundingClientRect();
      scale = 2.5;
      originX = (rect.width / 2 - (clientX - rect.left)) * (scale - 1) / scale;
      originY = (rect.height / 2 - (clientY - rect.top)) * (scale - 1) / scale;
      clampPan();
      setTransform(true);
    }
  }
  function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      startDist = getDistance(e.touches);
      lastScale = scale;
    } else if (e.touches.length === 1) {
      if (scale > 1) {
        isPanning = true;
        panStartX = e.touches[0].clientX - originX;
        panStartY = e.touches[0].clientY - originY;
      }
      const now = Date.now();
      const dx = Math.abs(e.touches[0].clientX - lastTapX);
      const dy = Math.abs(e.touches[0].clientY - lastTapY);
      if (now - lastTapTime < 300 && dx < 30 && dy < 30) {
        toggleZoomAt(e.touches[0].clientX, e.touches[0].clientY);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = e.touches[0].clientX;
        lastTapY = e.touches[0].clientY;
      }
    }
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && startDist) {
      e.preventDefault();
      const dist = getDistance(e.touches);
      scale = clampScale(lastScale * (dist / startDist));
      clampPan();
      setTransform(false);
    } else if (e.touches.length === 1 && isPanning && scale > 1) {
      e.preventDefault();
      originX = e.touches[0].clientX - panStartX;
      originY = e.touches[0].clientY - panStartY;
      clampPan();
      setTransform(false);
    }
  }, { passive: false });

  content.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) startDist = 0;
    if (e.touches.length === 0) {
      isPanning = false;
      if (scale <= 1) resetZoom(false);
    }
  });

  // Desktop: double-click to zoom, wheel to zoom
  img.addEventListener('dblclick', (e) => toggleZoomAt(e.clientX, e.clientY));
  content.addEventListener('wheel', (e) => {
    e.preventDefault();
    const prevScale = scale;
    scale = clampScale(scale + (e.deltaY < 0 ? 0.25 : -0.25));
    if (scale === 1) { originX = 0; originY = 0; }
    else if (prevScale !== scale) clampPan();
    setTransform(false);
  }, { passive: false });
}

// ── WISHLIST ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// WISHLIST SYSTEM — unified PDF + Job engine.
// supabase.js owns all state (window.wishlist / window.jobWishlist /
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
// and Me all flip their hearts / counters instantly without a reload.
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
  if (typeof selectedPdf !== 'undefined' && selectedPdf) {
    const nowIn = inPdf(selectedPdf.id);
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
// upsert, rollback, guest-local fallback and cross-page broadcast).
async function toggleWish(id) { return window.toggleWishlistItem(id, 'pdf'); }
function toggleWishlist(id) { return toggleWish(id); }
window.toggleWishlist = toggleWishlist;

// toggleJobWish: Job hearts — same engine, 'job' namespace. Wire this
// up from Career Hub / Job Details save buttons, e.g.
//   onclick="event.stopPropagation();toggleJobWish('${job.id}')"
async function toggleJobWish(id) { return window.toggleWishlistItem(id, 'job'); }
window.toggleJobWish = toggleJobWish;

function renderWishlist() {
  const pdfs = (window.PDFS || []).filter(p => wishlist.includes(Number(p.id)) || wishlist.includes(String(p.id)));

  // ── Hero subtitle / count (preserve original meaning) ──────────
  const countEl = document.getElementById('wishCount');
  if (countEl) countEl.textContent = pdfs.length > 0
    ? `${pdfs.length} saved item${pdfs.length === 1 ? '' : 's'} · Save and organize your favorite learning resources.`
    : 'Save and organize your favorite learning resources.';

  // ── Compute premium stats ───────────────────────────────────────
  let totalDownloads = 0, totalSavings = 0;
  pdfs.forEach(p => {
    normalizePdf(p);
    totalDownloads += Number(p.sales) || 0;
    const sell = Number(p.price ?? 0);
    if (!p.free && p.originalPrice && sell && p.originalPrice > sell) {
      totalSavings += (p.originalPrice - sell);
    }
  });
  const collectionScore = pdfs.length === 0 ? '—'
    : pdfs.length >= 10 ? 'Platinum'
    : pdfs.length >= 5  ? 'Gold'
    : pdfs.length >= 2  ? 'Silver'
    : 'Bronze';
  const engagementPct = Math.min(100, pdfs.length * 12 + Math.floor(totalDownloads / 50));

  // ── Hero stats (animated counters) ──────────────────────────────
  animateCount(document.getElementById('wlStatSaved'), pdfs.length);
  const savEl = document.getElementById('wlStatSavings');
  if (savEl) savEl.textContent = `₹${totalSavings.toLocaleString()}`;
  animateCount(document.getElementById('wlStatDownloads'), totalDownloads, true);
  const scoreEl = document.getElementById('wlStatScore');
  if (scoreEl) scoreEl.textContent = collectionScore;

  // ── Insight cards ────────────────────────────────────────────────
  const insightsEl = document.getElementById('wlInsights');
  if (insightsEl) {
    insightsEl.innerHTML = `
      <div class="wl-insight-card" style="animation-delay:.05s">
        <span class="wl-insight-icon">❤️</span>
        <div class="wl-insight-num">${pdfs.length}</div>
        <div class="wl-insight-label">Saved PDFs</div>
      </div>
      <div class="wl-insight-card" style="animation-delay:.1s">
        <span class="wl-insight-icon">💰</span>
        <div class="wl-insight-num">₹${totalSavings.toLocaleString()}</div>
        <div class="wl-insight-label">You Saved</div>
      </div>
      <div class="wl-insight-card" style="animation-delay:.15s">
        <span class="wl-insight-icon">🔥</span>
        <div class="wl-insight-num">${totalDownloads.toLocaleString()}</div>
        <div class="wl-insight-label">Downloads</div>
      </div>
      <div class="wl-insight-card" style="animation-delay:.2s">
        <span class="wl-insight-icon">⭐</span>
        <div class="wl-insight-num">${collectionScore}</div>
        <div class="wl-insight-label">Collection Rank</div>
      </div>`;
  }

  // ── Wishlist cards / empty state (existing functionality preserved) ──
  const el = document.getElementById('wishContent');
  if (el) {
    if (pdfs.length === 0) {
      el.innerHTML = `<div class="wl-empty">
        <div class="wl-empty-illustration">${icon('heart', 40)}</div>
        <h3>❤️ Build Your Collection</h3>
        <p class="text-muted mb-4">Save PDFs and access them anytime.</p>
        <button class="btn btn-primary btn-lg" onclick="navigate('library')">📚 Explore Library</button>
      </div>`;
    } else {
      el.innerHTML = `<div class="pdf-grid wl-cards-grid">${pdfs.map((pdf, i) => {
        let card = pdfCardHTML(pdf);
        // Inject staggered fade-in delay + floating heart pulse overlay (cosmetic only)
        card = card.replace('class="pdf-card"', `class="pdf-card" style="animation-delay:${(i * 0.05).toFixed(2)}s"`);
        card = card.replace('<!-- ── COVER', `<span class="wl-fav-pulse">❤️</span>\n    <!-- ── COVER`);
        return card;
      }).join('')}</div>`;
    }
  }

  // ── Saved Jobs (new — unified wishlist now covers Career Hub too) ──
  renderWishlistJobs();

  // ── Recommended For You (based on wishlist categories) ───────────
  const recoEl = document.getElementById('wlRecommendedCarousel');
  const recoSection = document.getElementById('wlRecommendedSection');
  if (recoEl && recoSection) {
    const cats = new Set(pdfs.map(p => p.category).filter(Boolean));
    const reco = validPdfs(window.PDFS || [])
      .filter(p => !wishlist.includes(Number(p.id)) && !wishlist.includes(String(p.id)))
      .filter(p => cats.size === 0 || cats.has(p.category))
      .slice(0, 10);
    if (reco.length > 0) {
      recoSection.style.display = '';
      recoEl.innerHTML = reco.map(pdfCardHTML).join('');
    } else {
      recoSection.style.display = 'none';
    }
  }

  // ── Trending Among Students (most downloaded) ────────────────────
  const trendEl = document.getElementById('wlTrendingCarousel');
  const trendSection = document.getElementById('wlTrendingSection');
  if (trendEl && trendSection) {
    const trending = validPdfs(window.PDFS || [])
      .sort((a, b) => (Number(b.sales) || 0) - (Number(a.sales) || 0))
      .slice(0, 10);
    if (trending.length > 0) {
      trendSection.style.display = '';
      trendEl.innerHTML = trending.map(pdfCardHTML).join('');
    } else {
      trendSection.style.display = 'none';
    }
  }

  // ── Achievements ───────────────────────────────────────────────
  const achEl = document.getElementById('wlAchievements');
  if (achEl) {
    const achievements = [
      { icon:'🏆', label:'First Saved PDF', unlocked: pdfs.length >= 1 },
      { icon:'❤️', label:'Collector',        unlocked: pdfs.length >= 5 },
      { icon:'📚', label:'Study Enthusiast', unlocked: pdfs.length >= 10 },
      { icon:'🔥', label:'Trending Hunter',  unlocked: totalDownloads >= 500 },
      { icon:'💎', label:'Premium Learner',  unlocked: pdfs.some(p => !p.free) },
    ];
    achEl.innerHTML = achievements.map((a, i) => `
      <div class="wl-ach-card ${a.unlocked ? '' : 'locked'}" style="animation-delay:${(i*0.05).toFixed(2)}s">
        <div class="wl-ach-icon">${a.icon}</div>
        <div class="wl-ach-label">${a.label}</div>
      </div>`).join('');
  }

  // ── Collection Summary (animated counters) ────────────────────
  animateCount(document.getElementById('wlSumSaved'), pdfs.length);
  const sumSavEl = document.getElementById('wlSumSavings');
  if (sumSavEl) sumSavEl.textContent = `₹${totalSavings.toLocaleString()}`;
  animateCount(document.getElementById('wlSumDownloads'), totalDownloads, true);
  const sumEngEl = document.getElementById('wlSumEngagement');
  if (sumEngEl) sumEngEl.textContent = `${engagementPct}%`;
}
window.renderWishlist = renderWishlist;

// ── SAVED JOBS — Wishlist page section ──────────────────────────────
// Fetches full job rows for every id in window.jobWishlist and renders
// them with the same card look used on Career Hub (window.csCardHTML,
// provided by career-hub.js) so the UI stays consistent everywhere.
let _wlJobsCache = null;
async function renderWishlistJobs(contentId, countId) {
  contentId = contentId || 'wishJobsContent';
  countId   = countId   || 'wishJobsCount';
  const countEl = document.getElementById(countId);
  const el = document.getElementById(contentId);
  if (!el) return; // page markup not present — nothing to do

  const jobIds = window.jobWishlist || [];

  if (jobIds.length === 0) {
    if (countEl) countEl.textContent = '0 saved jobs';
    el.innerHTML = `<div class="wl-empty">
      <div class="wl-empty-illustration">💼</div>
      <h3>No saved jobs yet</h3>
      <p class="text-muted mb-4">Tap the heart on any job in Career Hub to save it here.</p>
      <button class="btn btn-primary btn-lg" onclick="navigate('career-hub')">Explore Career Hub</button>
    </div>`;
    return;
  }

  el.innerHTML = `<div style="text-align:center;padding:40px 0;opacity:.6">Loading saved jobs…</div>`;

  let jobs = [];
  const client = window.supabaseClient;
  if (client) {
    try {
      const { data, error } = await client
        .from('jobs')
        .select('*')
        .in('id', jobIds.map(String));
      if (!error && data) jobs = data;
    } catch (e) { console.warn('renderWishlistJobs: fetch failed', e); }
  }
  // Fallback to whatever's already cached from the Career Hub admin/list view
  if (jobs.length === 0 && window._chAdmin?.jobs?.length) {
    jobs = window._chAdmin.jobs.filter(j => jobIds.includes(Number(j.id)) || jobIds.includes(String(j.id)));
  }
  _wlJobsCache = jobs;

  if (countEl) countEl.textContent = `${jobs.length} saved job${jobs.length === 1 ? '' : 's'}`;

  if (jobs.length === 0) {
    el.innerHTML = `<div class="wl-empty">
      <div class="wl-empty-illustration">💼</div>
      <h3>Couldn't load your saved jobs</h3>
      <p class="text-muted mb-4">They're still saved — please refresh.</p>
    </div>`;
    return;
  }

  const cardFn = window.csCardHTML || (typeof _csCardHTMLLegacy === 'function' ? _csCardHTMLLegacy : null);
  el.innerHTML = cardFn
    ? `<div class="pdf-grid wl-cards-grid">${jobs.map(cardFn).join('')}</div>`
    : `<div class="pdf-grid wl-cards-grid">${jobs.map(j => `
        <div class="pdf-card" onclick="if(typeof csOpenJob==='function')csOpenJob('${j.id}')">
          <div class="pdf-card-body">
            <div class="pdf-title">${(j.title||'Job Opportunity').replace(/</g,'&lt;')}</div>
            <div class="pdf-author">${(j.org||j.organization||'').replace(/</g,'&lt;')}</div>
          </div>
        </div>`).join('')}</div>`;
}
window.renderWishlistJobs = renderWishlistJobs;

// ══════════════════════════════════════════════════════════════════
// ── UNIFIED OWNERSHIP SYSTEM ──────────────────────────────────────
//    Free PDF = Owned PDF. On first access: grant ownership,
//    add to library, create purchased_pdfs record (type='free',
//    amount=0, status='owned'), then open PDF.
//    If already owned: skip duplicate, open directly.
//    Button text: "Download Free" → "Open PDF" after first access.
// ══════════════════════════════════════════════════════════════════

// In-memory ownership cache: Set of pdf_uuid strings the current
// user already owns (free or paid). Cleared on logout.
window._ownedPdfIds = window._ownedPdfIds || new Set();
window._ownedCacheReady = false; // true once loaded for this session

// Load all ownership records for current user into the cache.
// Called once per session after auth is confirmed.
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

// Check if a PDF is already owned (free or paid) — uses the in-memory cache.
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

// ── AUTH (Supabase-powered — stubs kept for compat, overridden by supabase.js) ──
function handleLogin() { if(typeof authLogin==='function') authLogin(); }
function handleRegister() { if(typeof authSignup==='function') authSignup(); }
function handleLogout() { if(typeof authLogout==='function') authLogout(); }
function updateNavUser() { if(typeof syncNavToAuth==='function') syncNavToAuth(window.currentUser || null); }

// ── REGISTER STEP NAVIGATION ──────────────────────────────────────
function regNextStep() {
  const name  = document.getElementById('regName')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const pass  = document.getElementById('regPass')?.value;
  const errEl = document.getElementById('signupError');
  const errMsg = document.getElementById('signupErrorMsg');
  const hide = () => { if(errEl){ errEl.style.display='none'; } };
  const show = (m) => { if(errEl && errMsg){ errMsg.textContent=m; errEl.style.display='flex'; } };
  hide();
  if (!name || name.length < 2) return show('Please enter your full name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Enter a valid email address.');
  if (!pass || pass.length < 8) return show('Password must be at least 8 characters.');
  document.getElementById('regStep1').classList.add('hidden');
  document.getElementById('regStep2').classList.remove('hidden');
  document.getElementById('regProgress').style.width = '100%';
  const d1 = document.getElementById('rsd1'), d2 = document.getElementById('rsd2');
  if(d1){ d1.classList.remove('current'); d1.classList.add('done'); }
  if(d2){ d2.classList.remove('future'); d2.classList.add('current'); }
}
function regPrevStep() {
  document.getElementById('regStep2').classList.add('hidden');
  document.getElementById('regStep1').classList.remove('hidden');
  document.getElementById('regProgress').style.width = '50%';
  const d1 = document.getElementById('rsd1'), d2 = document.getElementById('rsd2');
  if(d1){ d1.classList.remove('done'); d1.classList.add('current'); }
  if(d2){ d2.classList.remove('current'); d2.classList.add('future'); }
}

// ── SHOW/HIDE PASSWORD ─────────────────────────────────────────────
function togglePwVis(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.style.color = inp.type === 'text' ? 'var(--accent)' : 'var(--text2)';
}

// ── LOCAL showAuthError overrides (supabase.js sets them too) ──────
function showAuthError(elId, msg) {
  const box = document.getElementById(elId);
  const msgEl = document.getElementById(elId + 'Msg');
  if (box) { if(msgEl) msgEl.textContent = msg; box.style.display = 'flex'; }
}
function clearAuthError(elId) {
  const box = document.getElementById(elId);
  if (box) box.style.display = 'none';
}

// showAuthPage — controls which auth sub-page is visible
function showAuthPage(subpage) {
  const pages = ['login','register','forgot-password','forgot-success','verify-email','reset-password'];
  pages.forEach(p => {
    const el = document.getElementById('auth-' + p);
    if (el) el.style.display = p === subpage ? 'block' : 'none';
  });
}

// updatePasswordStrengthUI — stub until supabase.js loads
function updatePasswordStrengthUI(password) {
  const score = typeof checkPasswordStrength === 'function' ? checkPasswordStrength(password) : 0;
  const colors = ['','#ff4d6d','#ff8c42','#f59e0b','#10d98e','#00c8e8'];
  const labels = ['','Very Weak','Weak','Fair','Strong','Very Strong'];
  const pct = (score / 5) * 100;
  ['pwStrengthBar','pwStrengthBar2'].forEach(id => {
    const el = document.getElementById(id);
    if(el){ el.style.width = pct+'%'; el.style.background = colors[score]||'transparent'; }
  });
  ['pwStrengthText','pwStrengthText2'].forEach(id => {
    const el = document.getElementById(id);
    if(el){ el.textContent = labels[score]||''; el.style.color = colors[score]||''; }
  });
}

// ── DASHBOARD ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// ── ME / DASHBOARD — REAL-TIME DATA ENGINE ───────────────────────
// All stats fetched from Supabase. No hardcoded values.
// Tables used:
//   purchased_pdfs   → count by user_id + status='paid' (schema: id, user_id, email, pdf_uuid, payment_id, status, created_at)
//   user_wishlist    → pdf_id per user_id
//   reading_sessions → total_seconds per user_id
// ══════════════════════════════════════════════════════════════════

// Cache to avoid redundant fetches within a session — cleared on
// logout and after any mutation (purchase / wishlist toggle).
window._dashCache = null;

async function _fetchDashStats() {
  const client = window.supabaseClient;
  const user = window.currentUser;
  if (!client || !user) return null;

  // Make sure the central wishlist engine has run at least once this
  // session so window.wishlist / window.jobWishlist aren't stale [0,0].
  if (typeof window._wishlistRaw === 'undefined' && typeof window.loadWishlistFromSupabase === 'function') {
    await window.loadWishlistFromSupabase();
  }

  // window.currentUser is built by _buildCurrentUser() in supabase.js which sets .uid (not .id)
  const _userId = user.uid || user.id;
  console.log('📊 _fetchDashStats: loading stats for uid:', _userId, '| email:', user.email);

  try {
    // Run both queries in parallel for speed.
    // purchased_pdfs: query by user_id (canonical, RLS-friendly).
    // Schema columns: id, user_id, email, pdf_uuid, payment_id, status, created_at
    // NOTE: wishlist counts come from the central engine (window.wishlist /
    // window.jobWishlist, owned by supabase.js) — NOT a separate query here.
    // Re-querying user_wishlist directly used to overwrite the global
    // `wishlist` array with raw (possibly composite "pdf:<id>"/"job:<id>")
    // rows, corrupting every heart-button check on the page. Always go
    // through loadWishlistFromSupabase()/window.wishlist instead.
    const [purchaseRes, readingRes] = await Promise.all([
      client
        .from('purchased_pdfs')
        .select('pdf_uuid, payment_id, status, created_at, amount')
        .eq('user_id', _userId)
        .in('status', ['paid', 'owned'])
        .order('created_at', { ascending: false }),
      client
        .from('reading_sessions')
        .select('total_seconds')
        .eq('user_id', _userId)
    ]);

    if (purchaseRes.error)  console.warn('⚠️ purchased_pdfs query error:', purchaseRes.error.message, purchaseRes.error);
    if (readingRes.error)   console.warn('⚠️ reading_sessions query error:', readingRes.error.message);

    console.log('📦 purchased_pdfs rows returned:', purchaseRes.data?.length ?? 0, purchaseRes.data);

    const purchases    = purchaseRes.data  || [];
    const readingSess  = readingRes.data   || [];

    // Compute stats
    const purchasedCount = purchases.length;
    // totalSpent: only count real paid purchases (status='paid'), not free ownership (status='owned')
    const totalSpent = purchases.reduce((sum, row) => {
      if (row.status === 'owned') return sum; // free PDF, ₹0
      // If amount column has a real value use it
      if (row.amount !== null && row.amount !== undefined && Number(row.amount) > 0) {
        return sum + Number(row.amount);
      }
      // Fallback: look up the PDF's selling_price / price from catalogue
      const found = (window.PDFS || []).find(p => String(p.id) === String(row.pdf_uuid));
      const fallbackPrice = found
        ? Number(found.price || 0)
        : 0;
      return sum + fallbackPrice;
    }, 0);
    const wishlistCount    = (window.wishlist || []).length;
    const jobWishlistCount = (window.jobWishlist || []).length;
    const totalSeconds     = readingSess.reduce((sum, r) => sum + (Number(r.total_seconds) || 0), 0);
    const hoursRead        = parseFloat((totalSeconds / 3600).toFixed(1));

    // Resolve purchased PDFs by pdf_uuid against the PDFS catalogue
    const purchasedPdfs = purchases.map(row => {
      const found = (window.PDFS || []).find(p => String(p.id) === String(row.pdf_uuid));
      return found ? { ...found, _purchaseDate: row.created_at } : {
        id: row.pdf_uuid,
        title: `PDF #${row.pdf_uuid}`,
        author: '—',
        category: '—',
        price: 0,
        free: false,
        pdfUrl: '',
        _purchaseDate: row.created_at
      };
    });

    const stats = { purchasedCount, totalSpent, wishlistCount, jobWishlistCount, hoursRead, purchasedPdfs, rawPurchases: purchases };
    window._dashCache = stats;
    console.log('✅ Dashboard stats:', stats);
    return stats;
  } catch (e) {
    console.error('❌ _fetchDashStats exception:', e);
    return null;
  }
}

// Call this after any mutation (purchase / wishlist) to bust cache and
// refresh the overview stats blocks without a full page reload.
async function _refreshDashStats() {
  window._dashCache = null;
  if (window.currentPage !== 'dashboard') return;
  const stats = await _fetchDashStats();
  if (!stats) return;

  // Patch stat cards in-place if they exist (new premium IDs)
  _animateCount('dashStat0', stats.purchasedCount, '', '');
  _animateCount('dashStat2', stats.wishlistCount, '', '');
  _animateCount('dashStat1', stats.totalSpent, '₹', '', true);
  _animateCount('dashStat3', stats.hoursRead, '', 'h');

  // Update tab badges
  const libBadge = document.getElementById('dashLibBadge');
  if (libBadge) libBadge.textContent = stats.purchasedCount;
  const wishBadge = document.getElementById('dashWishBadge');
  if (wishBadge) wishBadge.textContent = stats.wishlistCount + stats.jobWishlistCount;

  // Refresh recently purchased section
  const recentEl = document.getElementById('dashRecentlyPurchased');
  if (recentEl) {
    recentEl.innerHTML = stats.purchasedPdfs.length
      ? `<div class="pdf-grid">${stats.purchasedPdfs.slice(0,6).map(pdfCardHTML).join('')}</div>`
      : `<div class="text-muted" style="padding:24px 0">No purchases yet. <a href="#" onclick="navigate('library');return false;" style="color:var(--accent)">Browse Library →</a></div>`;
  }

  // Refresh wishlist count badge
  const wishCountEl = document.getElementById('dashWishCount');
  if (wishCountEl) wishCountEl.textContent = stats.wishlistCount + stats.jobWishlistCount;
}

// Renders the dashboard. If window.currentUser is already set (auth
// state restored from localStorage via supabase.js), renders immediately.
// If not — which can happen if navigate('dashboard') is called before
// the async getSession() resolves — we do a one-time async check and
// then re-render.
async function renderDashboard() {
  let user = window.currentUser;

  if (!user) {
    if (window._supabaseSessionReady) {
      await window._supabaseSessionReady;
      user = window.currentUser;
    }
    if (!user && window.supabaseClient) {
      try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session?.user) {
          window.syncNavToAuth(session.user);
          user = window.currentUser;
        }
      } catch (e) {}
    }
  }

  if (!user) {
    // Hide profile hero, show login prompt in main content area
    const heroEl = document.getElementById('dashProfileHero');
    if (heroEl) heroEl.style.display = 'none';
    document.getElementById('dashMain').innerHTML = `
      <div style="text-align:center;padding:100px 20px;animation:dashFadeUp .4s ease both">
        <div style="font-size:3rem;margin-bottom:16px">🔒</div>
        <h2 style="font-family:var(--font-display);font-size:1.6rem;margin-bottom:10px">Sign in to your dashboard</h2>
        <p class="text-muted" style="margin-bottom:28px;max-width:380px;margin-left:auto;margin-right:auto">Track purchases, manage your wishlist, and access all your study materials.</p>
        <button class="btn btn-primary btn-lg" onclick="navigate('login')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Sign In
        </button>
      </div>`;
    return;
  }

  // Show profile hero and populate with real user data
  const heroEl = document.getElementById('dashProfileHero');
  if (heroEl) heroEl.style.display = '';

  const avatarEl    = document.getElementById('dashAvatar');
  const nameEl      = document.getElementById('dashName');
  const emailEl     = document.getElementById('dashEmail');
  const planEl      = document.getElementById('dashPlan');
  const joinEl      = document.getElementById('dashJoinDate');
  const badgeRowEl  = document.getElementById('dashBadgeRow');
  const xpWrapEl    = document.getElementById('dashXpWrap');

  if (avatarEl) avatarEl.textContent = user.avatar || (user.name ? user.name[0].toUpperCase() : '?');
  if (nameEl)   nameEl.textContent   = user.name || 'Studyria User';
  if (emailEl)  emailEl.textContent  = user.email || '';
  if (planEl) {
    planEl.textContent = '🎓 ' + (user.plan || 'Free') + ' Plan';
    if (badgeRowEl) badgeRowEl.style.display = '';
  }
  if (joinEl) {
    const created = user.created_at || user.createdAt;
    if (created) {
      const d = new Date(created);
      joinEl.textContent = `· Member since ${d.toLocaleDateString('en-IN',{month:'short',year:'numeric'})}`;
    }
  }
  // Hide XP / level — real data not available yet
  if (xpWrapEl) xpWrapEl.style.display = 'none';

  // Bust cache so switching tabs always fetches fresh data
  window._dashCache = null;

  switchMeTab(dashTab);
}

// Alias for backward compat — old code calls switchDashTab
function switchDashTab(tab) { return switchMeTab(tab); }

async function switchMeTab(tab) {
  dashTab = tab;
  const currentUser = window.currentUser;
  if (!currentUser) return;

  // Update tab active states
  document.querySelectorAll('#page-dashboard .me-htab[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  // Also keep old sidebar-link compat
  document.querySelectorAll('#page-dashboard .sidebar-link[data-tab]').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));

  const main = document.getElementById('dashMain');

  // ── OVERVIEW ──────────────────────────────────────────────────────
  if (tab === 'overview') {
    const firstName = (currentUser.name || 'there').split(' ')[0];

    main.innerHTML = `<div class="me-tab-panel">

      <!-- Premium Banner -->
      <div class="me-premium-banner" style="animation-delay:.05s">
        <div class="me-pb-rocket">🚀</div>
        <div class="me-pb-title">Unlock Better Learning</div>
        <div class="me-pb-sub">Access premium PDFs, exam resources and exclusive content curated for Indian students.</div>
        <button class="me-pb-btn" onclick="navigate('library')">
          Explore Now
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- Stat Cards -->
      <div class="me-section-title" style="animation-delay:.1s"><span class="mst-accent"></span>Your Stats</div>
      <div class="me-stats-grid">
        <div class="me-stat-card msc-pdf" style="animation-delay:.12s" onclick="switchMeTab('purchased')" title="View My Library">
          <div class="me-stat-icon">??</div>
          <div class="me-stat-val" id="dashStat0"><span class="me-skeleton" style="width:48px;height:28px;display:block"></span></div>
          <div class="me-stat-label">PDFs Purchased</div>
          <div class="me-stat-trend">↑ View Library →</div>
        </div>
        <div class="me-stat-card msc-wish" style="animation-delay:.16s" onclick="switchMeTab('wishlist')" title="View Wishlist">
          <div class="me-stat-icon">❤️</div>
          <div class="me-stat-val" id="dashStat2"><span class="me-skeleton" style="width:40px;height:28px;display:block"></span></div>
          <div class="me-stat-label">Wishlist Items</div>
          <div class="me-stat-trend">View Wishlist →</div>
        </div>
        <div class="me-stat-card msc-spend" style="animation-delay:.20s" onclick="showPurchaseHistory()" title="View Purchase History">
          <div class="me-stat-icon">💰</div>
          <div class="me-stat-val" id="dashStat1"><span class="me-skeleton" style="width:64px;height:28px;display:block"></span></div>
          <div class="me-stat-label">Total Invested</div>
          <div class="me-stat-trend">View History →</div>
        </div>
        <div class="me-stat-card msc-time" style="animation-delay:.24s" onclick="showReadingAnalytics()" title="View Reading Analytics">
          <div class="me-stat-icon">🔥</div>
          <div class="me-stat-val" id="dashStat3"><span class="me-skeleton" style="width:40px;height:28px;display:block"></span></div>
          <div class="me-stat-label">Hours Read</div>
          <div class="me-stat-trend" style="animation:streakFlame 1.5s ease-in-out infinite">View Analytics →</div>
        </div>
      </div>

      <!-- Learning Overview -->
      <div class="me-section-title" style="animation-delay:.28s"><span class="mst-accent"></span>Learning Overview</div>
      <div class="me-learn-grid">
        <div class="me-learn-card" style="animation-delay:.30s" onclick="switchMeTab('purchased')" title="Open My Library">
          <div class="me-lc-emoji">📖</div>
          <div class="me-lc-val" id="lcCollSize">—</div>
          <div class="me-lc-label">Collection Size</div>
          <div class="me-lc-bar-track"><div class="me-lc-bar-fill" id="lcBar0" style="width:0%"></div></div>
        </div>
        <div class="me-learn-card" style="animation-delay:.33s" onclick="showRecentlyOpened()" title="Recently Opened PDFs">
          <div class="me-lc-emoji">✅</div>
          <div class="me-lc-val" id="lcPdfsRead">—</div>
          <div class="me-lc-label">PDFs Opened</div>
          <div class="me-lc-bar-track"><div class="me-lc-bar-fill" id="lcBar1" style="width:0%"></div></div>
        </div>
        <div class="me-learn-card" style="animation-delay:.36s" onclick="showLearningActivity()" title="Learning Activity">
          <div class="me-lc-emoji">🔥</div>
          <div class="me-lc-val" id="lcStreak">—</div>
          <div class="me-lc-label">Day Streak</div>
          <div class="me-lc-bar-track"><div class="me-lc-bar-fill" id="lcBar2" style="width:0%"></div></div>
        </div>
        <div class="me-learn-card" style="animation-delay:.39s" onclick="showProgressDashboard()" title="Progress Dashboard">
          <div class="me-lc-emoji">🎯</div>
          <div class="me-lc-val" id="lcCompletion">—</div>
          <div class="me-lc-label">Completion Rate</div>
          <div class="me-lc-bar-track"><div class="me-lc-bar-fill" id="lcBar3" style="width:0%"></div></div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="me-section-title" style="animation-delay:.42s"><span class="mst-accent"></span>Quick Actions</div>
      <div class="me-actions-grid" style="margin-bottom:24px">
        <div class="me-action-card" style="animation-delay:.44s" onclick="switchMeTab('wishlist')">
          <div class="me-action-icon" style="background:rgba(255,77,109,0.15)">❤️</div>
          <div class="me-action-label">Wishlist</div>
        </div>
        <div class="me-action-card" style="animation-delay:.46s" onclick="switchMeTab('purchased')">
          <div class="me-action-icon" style="background:rgba(61,142,248,0.15)">📖</div>
          <div class="me-action-label">My Library</div>
        </div>
        <div class="me-action-card" style="animation-delay:.48s" onclick="navigate('library')">
          <div class="me-action-icon" style="background:rgba(16,217,142,0.15)">🛒</div>
          <div class="me-action-label">Browse PDFs</div>
        </div>
        <div class="me-action-card" style="animation-delay:.50s" onclick="toggleNotificationCenter()">
          <div class="me-action-icon" style="background:rgba(245,158,11,0.15)">🔔</div>
          <div class="me-action-label">Notifications</div>
        </div>
        <div class="me-action-card" style="animation-delay:.52s" onclick="showToast('Thank you for your support! ⭐','success')">
          <div class="me-action-icon" style="background:rgba(139,92,246,0.15)">⭐</div>
          <div class="me-action-label">Rate Us</div>
        </div>
        <div class="me-action-card" style="animation-delay:.54s" onclick="showToast('Support: studyria24@gmail.com','info')">
          <div class="me-action-icon" style="background:rgba(0,200,232,0.15)">📞</div>
          <div class="me-action-label">Support</div>
        </div>
      </div>

      <!-- Achievements -->
      <div class="me-section-title" style="animation-delay:.56s"><span class="mst-accent"></span>Achievements</div>
      <div class="me-achievements-scroll">
        ${[
          {e:'🏆',t:'First Wishlist',s:'Added first PDF',d:.58,locked:false},
          {e:'📚',t:'First PDF Saved',s:'Saved to library',d:.60,locked:false},
          {e:'🔥',t:'Active Learner',s:'7 day streak',d:.62,locked:false},
          {e:'💎',t:'Premium Member',s:'Upgraded plan',d:.64,locked:true},
          {e:'🎯',t:'Goal Crusher',s:'Completed 5 PDFs',d:.66,locked:true},
          {e:'🦁',t:'Study Beast',s:'50+ hours read',d:.68,locked:true},
          {e:'🌟',t:'Top Scholar',s:'Top 1% learner',d:.70,locked:true},
        ].map(a => `
          <div class="me-ach-card${a.locked?' locked':''}" style="animation-delay:${a.d}s">
            <span class="me-ach-emoji">${a.e}</span>
            <div class="me-ach-title">${a.t}</div>
            <div class="me-ach-sub">${a.locked?'🔒 Locked':a.s}</div>
          </div>`).join('')}
      </div>

      <!-- Recent Activity -->
      <div class="me-section-title" style="animation-delay:.72s"><span class="mst-accent"></span>Recent Activity</div>
      <div class="me-activity-list" id="dashActivityList">
        <div style="text-align:center;padding:28px;color:var(--text2);opacity:.5">
          <div class="me-skeleton" style="height:56px;border-radius:14px;margin-bottom:8px"></div>
          <div class="me-skeleton" style="height:56px;border-radius:14px;margin-bottom:8px"></div>
          <div class="me-skeleton" style="height:56px;border-radius:14px"></div>
        </div>
      </div>

      <!-- Recently Purchased -->
      <div class="me-section-title" style="animation-delay:.74s"><span class="mst-accent"></span>Recently Purchased</div>
      <div id="dashRecentlyPurchased" style="min-height:80px">
        <div style="text-align:center;padding:24px">
          <div class="me-skeleton" style="height:200px;border-radius:16px"></div>
        </div>
      </div>
    </div>`;

    // Fetch real stats
    const stats = window._dashCache || await _fetchDashStats();

    if (!stats) {
      ['dashStat0','dashStat1','dashStat2','dashStat3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      const rp = document.getElementById('dashRecentlyPurchased');
      if (rp) rp.innerHTML = `<div class="text-muted" style="padding:20px">Could not load data. Please try again.</div>`;
      return;
    }

    // Animate stat numbers
    _animateCount('dashStat0', stats.purchasedCount, '', '');
    _animateCount('dashStat2', stats.wishlistCount, '', '');
    _animateCount('dashStat1', stats.totalSpent, '₹', '', true);
    _animateCount('dashStat3', stats.hoursRead, '', 'h');

    // Update tab badges
    const libBadge = document.getElementById('dashLibBadge');
    if (libBadge) libBadge.textContent = stats.purchasedCount;
    const wishBadge = document.getElementById('dashWishBadge');
    if (wishBadge) wishBadge.textContent = stats.wishlistCount + (stats.jobWishlistCount || 0);

    // Learning overview cards — fetch real opened count from pdf_analytics
    const _userId2 = (_fetchDashStats && (window.currentUser?.id || window.currentUser?.uid));
    let realOpenedCount = 0;
    if (window.supabaseClient && _userId2) {
      try {
        const { data: aRows } = await window.supabaseClient
          .from('pdf_analytics')
          .select('pdf_id')
          .eq('user_id', _userId2)
          .gt('opened_count', 0);
        realOpenedCount = (aRows || []).length;
      } catch(e) {}
    }

    const total = Math.max(stats.purchasedCount, 1);
    _setEl('lcCollSize', stats.purchasedCount > 0 ? stats.purchasedCount : '—');
    _setEl('lcPdfsRead', realOpenedCount > 0 ? realOpenedCount : (stats.purchasedCount > 0 ? 0 : '—'));
    const completionPct = stats.purchasedCount > 0 ? Math.round((realOpenedCount / total) * 100) : 0;
    _setEl('lcCompletion', stats.purchasedCount > 0 ? completionPct + '%' : '—');
    const bar0 = document.getElementById('lcBar0');
    const bar1 = document.getElementById('lcBar1');
    const bar3 = document.getElementById('lcBar3');
    if (bar0) bar0.style.width = Math.min(100, (stats.purchasedCount / Math.max(10, stats.purchasedCount)) * 100) + '%';
    if (bar1) bar1.style.width = Math.min(100, (realOpenedCount / Math.max(total, 1)) * 100) + '%';
    if (bar3) bar3.style.width = completionPct + '%';

    // Recent Activity from purchases
    const actEl = document.getElementById('dashActivityList');
    if (actEl) {
      const recent = stats.purchasedPdfs.slice(0,5);
      if (recent.length === 0) {
        actEl.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2)">No activity yet. <a href="#" onclick="navigate('library');return false;" style="color:var(--accent)">Browse PDFs →</a></div>`;
      } else {
        actEl.innerHTML = recent.map((p, i) => `
          <div class="me-activity-item" style="animation-delay:${.72 + i*.06}s">
            <div class="me-act-icon act-buy">🛒</div>
            <div class="me-act-info">
              <div class="me-act-title">${p.title || 'PDF #' + p.id}</div>
              <div class="me-act-sub">Purchased · ${p.category || 'Study Material'}</div>
            </div>
            <div class="me-act-time">${p._purchaseDate ? new Date(p._purchaseDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : 'Recently'}</div>
          </div>`).join('') +
          (wishlist.slice(0,2).map((wid, i) => {
            const wp = (window.PDFS||[]).find(p => Number(p.id)===Number(wid));
            if (!wp) return '';
            return `<div class="me-activity-item" style="animation-delay:${1.02 + i*.06}s">
              <div class="me-act-icon act-wish">❤️</div>
              <div class="me-act-info">
                <div class="me-act-title">${wp.title}</div>
                <div class="me-act-sub">Added to wishlist · ${wp.category || ''}</div>
              </div>
              <div class="me-act-time">Recently</div>
            </div>`;
          }).join(''));
      }
    }

    // Recently purchased PDFs grid
    const rp = document.getElementById('dashRecentlyPurchased');
    if (rp) {
      rp.innerHTML = stats.purchasedPdfs.length
        ? `<div class="pdf-grid">${stats.purchasedPdfs.slice(0,6).map(pdfCardHTML).join('')}</div>`
        : `<div style="text-align:center;padding:40px 20px;color:var(--text2)">
            <div style="font-size:2.5rem;margin-bottom:12px">📭</div>
            <div style="font-weight:600;margin-bottom:8px">No purchases yet</div>
            <div style="font-size:.85rem;opacity:.7;margin-bottom:20px">Start building your study library today</div>
            <button class="btn btn-primary" onclick="navigate('library')">Browse Library →</button>
           </div>`;
    }

    _refreshAllWishButtons();
    // Refresh ownership labels on dashboard cards
    setTimeout(_refreshFreeButtonLabels, 50);
  }

  // ── PURCHASED — PREMIUM SMART VIRTUAL BOOKSHELF ──────────────────
  else if (tab === 'purchased') {
    main.innerHTML = `<div class="me-tab-panel" id="bsfTabPanel">
      <div style="text-align:center;padding:60px 0">
        <div class="me-skeleton" style="height:200px;border-radius:20px;margin-bottom:16px"></div>
        <div class="me-skeleton" style="height:160px;border-radius:16px"></div>
      </div>
    </div>`;

    window._dashCache = null;
    const stats = await _fetchDashStats();
    const panel = document.getElementById('bsfTabPanel');
    if (!stats || !panel) return;

    // ── Fetch analytics ────────────────────────────────────────────
    const pdfIds = stats.purchasedPdfs.map(p => String(p.id));
    const _userId = (window.currentUser?.id || window.currentUser?.uid);
    let analyticsMap = {};
    if (window.supabaseClient && _userId && pdfIds.length) {
      try {
        const { data: aRows } = await window.supabaseClient
          .from('pdf_analytics')
          .select('pdf_id,download_count,last_opened_at,opened_count,first_opened_at')
          .eq('user_id', _userId)
          .in('pdf_id', pdfIds);
        (aRows || []).forEach(r => { analyticsMap[r.pdf_id] = r; });
      } catch(e) { console.warn('⚠️ pdf_analytics:', e); }
    }

    // ── Load bookshelf settings from Supabase ─────────────────────
    let bsfSettings = {
      shelfStyle: 'wooden', theme: 'dark', accentColor: '#3d8ef8',
      fontStyle: 'editorial', animationsOn: true, particlesOn: true,
      ambientGlow: true, shelfLighting: true, parallaxOn: true,
      searchFuzzy: true, booksPerShelf: 8,
      badges: ['📚 Bookworm','⚡ Speed Reader','🏆 Champion','🔥 On Fire'],
      levels: ['Novice','Scholar','Expert','Master','Legend']
    };
    if (window.supabaseClient) {
      try {
        const { data: sRows } = await window.supabaseClient
          .from('bookshelf_settings').select('*').limit(1).maybeSingle();
        if (sRows) bsfSettings = { ...bsfSettings, ...sRows };
      } catch(e) {}
    }

    // ── State ─────────────────────────────────────────────────────
    const BSF = {
      allPdfs: stats.purchasedPdfs,
      analyticsMap,
      settings: bsfSettings,
      favorites: JSON.parse(localStorage.getItem('bsf_favorites') || '[]'),
      readProgress: JSON.parse(localStorage.getItem('bsf_progress') || '{}'),
      filter: 'all',
      query: '',
      isAdmin: !!(window.currentUser?.isAdmin || window.currentUser?.is_admin),
    };

    // Sort helpers
    const sortByLastOpened = (arr) => [...arr].sort((a,b) => {
      const la = analyticsMap[String(a.id)]?.last_opened_at || '';
      const lb = analyticsMap[String(b.id)]?.last_opened_at || '';
      return lb.localeCompare(la);
    });
    const sortByOpenCount = (arr) => [...arr].sort((a,b) => {
      const ca = analyticsMap[String(a.id)]?.opened_count || 0;
      const cb = analyticsMap[String(b.id)]?.opened_count || 0;
      return cb - ca;
    });
    const sortByAdded = (arr) => [...arr].sort((a,b) => {
      return new Date(b._purchaseDate||0) - new Date(a._purchaseDate||0);
    });

    // Gamification calc
    const totalBooks = BSF.allPdfs.length;
    const totalOpens = Object.values(analyticsMap).reduce((s,r) => s+(r.opened_count||0),0);
    const totalDls = Object.values(analyticsMap).reduce((s,r) => s+(r.download_count||0),0);
    const readScore = totalOpens * 10 + totalDls * 5 + totalBooks * 20;
    const levelIdx = Math.min(Math.floor(readScore / 200), bsfSettings.levels.length - 1);
    const levelName = bsfSettings.levels[levelIdx] || 'Scholar';
    const levelProgress = Math.min(100, (readScore % 200) / 2);
    const streak = parseInt(localStorage.getItem('bsf_streak') || '0');

    // Update streak
    const today = new Date().toDateString();
    const lastDay = localStorage.getItem('bsf_streak_day');
    if (lastDay !== today) {
      const yesterday = new Date(Date.now()-86400000).toDateString();
      const newStreak = lastDay === yesterday ? streak + 1 : 1;
      localStorage.setItem('bsf_streak', newStreak);
      localStorage.setItem('bsf_streak_day', today);
    }
    const currentStreak = parseInt(localStorage.getItem('bsf_streak') || '1');

    // Badge logic
    const earnedBadges = [];
    if (totalBooks >= 1)  earnedBadges.push({icon:'📚',label:'Bookworm',cls:'bsf-badge-blue'});
    if (totalOpens >= 5)  earnedBadges.push({icon:'⚡',label:'Speed Reader',cls:'bsf-badge-green'});
    if (totalBooks >= 10) earnedBadges.push({icon:'🏆',label:'Collector',cls:'bsf-badge-gold'});
    if (currentStreak>=3) earnedBadges.push({icon:'🔥',label:`${currentStreak}d Streak`,cls:'bsf-badge-purple'});
    if (totalDls >= 5)    earnedBadges.push({icon:'⬇️',label:'Downloader',cls:'bsf-badge-blue'});

    // Book colors palette for fallback spines
    const SPINE_COLORS = [
      /* Deep navy blues */
      ['#0d2340','#1a3a6b'],['#0a1e38','#1e4080'],
      /* Forest greens */
      ['#0d2e18','#1a5c2e'],['#0a2a14','#145228'],
      /* Rich burgundy */
      ['#3a0a12','#7c2230'],['#2e0810','#6a1c28'],
      /* Deep purple */
      ['#1e0a3a','#4a1a7c'],['#160830','#3a1468'],
      /* Amber/gold */
      ['#2e1400','#6b3000'],['#3a1800','#7a3800'],
      /* Teal */
      ['#042830','#0a5060'],['#062230','#0c4a5a'],
      /* Slate */
      ['#141820','#2a3040'],['#101418','#222838'],
      /* Maroon */
      ['#2a0808','#5a1818'],['#220606','#4e1414'],
      /* Deep indigo */
      ['#0a0e28','#1a2060'],['#080c22','#161a52'],
      /* Olive */
      ['#1c2008','#3a4010'],['#181c06','#32380e'],
    ];

    // ── Render function ────────────────────────────────────────────
    function bsfRender() {
      let pdfs = [...BSF.allPdfs];

      // Filter
      if (BSF.filter === 'favorites') pdfs = pdfs.filter(p => BSF.favorites.includes(String(p.id)));
      else if (BSF.filter === 'recent') pdfs = sortByLastOpened(pdfs).slice(0, 12);
      else if (BSF.filter === 'added')  pdfs = sortByAdded(pdfs).slice(0, 12);
      else if (BSF.filter === 'mostread') pdfs = sortByOpenCount(pdfs);
      else if (BSF.filter === 'continue') {
        pdfs = pdfs.filter(p => {
          const prog = BSF.readProgress[String(p.id)];
          return prog && prog > 0 && prog < 100;
        });
      }

      // Search with fuzzy
      if (BSF.query.trim()) {
        const q = BSF.query.toLowerCase().trim();
        pdfs = pdfs.filter(p => {
          const title = (p.title || '').toLowerCase();
          const cat = (p.category || '').toLowerCase();
          // Exact or substring
          if (title.includes(q) || cat.includes(q)) return true;
          // Fuzzy: allow 1 char diff per 4 chars
          if (bsfSettings.searchFuzzy && q.length >= 3) {
            const words = title.split(' ');
            return words.some(w => {
              if (Math.abs(w.length - q.length) > 2) return false;
              let diff = 0;
              for (let i=0;i<Math.min(w.length,q.length);i++) if(w[i]!==q[i]) diff++;
              diff += Math.abs(w.length - q.length);
              return diff <= Math.ceil(q.length / 4);
            });
          }
          return false;
        });
        // Typo tip
        const typoEl = document.getElementById('bsfTypoTip');
        if (typoEl) {
          if (pdfs.length === 0 && BSF.query.length > 2) {
            typoEl.textContent = `No results for "${BSF.query}". Try a different spelling.`;
            typoEl.style.display = 'block';
          } else { typoEl.style.display = 'none'; }
        }
      }

      // ── Modern PDF cover card helper ──────────────────────────────
      function sdlCoverCard(p, opts={}) {
        const coverUrl = p.cover_image || p.coverImage || p.thumbnail || p.image || '';
        const isFav = BSF.favorites.includes(String(p.id));
        const a = analyticsMap[String(p.id)] || {};
        const prog = BSF.readProgress[String(p.id)] || 0;
        const opens = a.opened_count || 0;
        const price = p.free ? 'Free' : `₹${Number(p.price||0).toLocaleString()}`;
        const GRAD_FALLBACKS = [
          'linear-gradient(160deg,#0d2340,#1a3a6b)','linear-gradient(160deg,#0d2e18,#1a5c2e)',
          'linear-gradient(160deg,#3a0a12,#7c2230)','linear-gradient(160deg,#1e0a3a,#4a1a7c)',
          'linear-gradient(160deg,#2e1400,#6b3000)','linear-gradient(160deg,#042830,#0a5060)',
          'linear-gradient(160deg,#141820,#2a3040)','linear-gradient(160deg,#0a0e28,#1a2060)',
        ];
        const fallbackGrad = GRAD_FALLBACKS[parseInt(p.id) % GRAD_FALLBACKS.length];
        const initials = (p.title||'PDF').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
        return `<div class="sdl-cover-card${opts.wide?' sdl-wide':''}" onclick="bsfOpenBook('${p.id}')" data-id="${p.id}">
          <div class="sdl-cover-img-wrap" style="${!coverUrl?'background:'+fallbackGrad:''}">
            ${coverUrl ? `<img src="${coverUrl}" alt="${(p.title||'').replace(/"/g,'&quot;')}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
            <div class="sdl-cover-fallback" style="${coverUrl?'display:none':''}">${initials}</div>
            <div class="sdl-cover-scrim"></div>
            ${prog > 0 ? `<div class="sdl-cover-progress-bar"><div style="width:${prog}%"></div></div>` : ''}
            <button class="sdl-cover-fav${isFav?' active':''}" onclick="event.stopPropagation();bsfToggleFav('${p.id}')" title="${isFav?'Unfavorite':'Favorite'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav?'currentColor':'none'}" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
            ${p.tag ? `<div class="sdl-cover-tag">${p.tag}</div>` : ''}
          </div>
          <div class="sdl-cover-info">
            <div class="sdl-cover-title">${p.title||'Untitled'}</div>
            <div class="sdl-cover-meta">
              <span>${p.category||'PDF'}</span>
              ${opens > 0 ? `<span>· ${opens} open${opens!==1?'s':''}</span>` : ''}
            </div>
            <div class="sdl-cover-actions">
              <button class="sdl-btn-open" onclick="event.stopPropagation();openAndTrack('${p.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Open
              </button>
              <button class="sdl-btn-dl" onclick="event.stopPropagation();triggerPDFDownloadTracked('${p.id}')" title="Download">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button class="sdl-btn-share" onclick="event.stopPropagation();bsfShare('${p.id}')" title="Share">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
            </div>
          </div>
        </div>`;
      }

      // ── Netflix-style carousel row ─────────────────────────────────
      function sdlCarousel(label, pdfList, opts={}) {
        if (!pdfList.length) return '';
        return `<div class="sdl-carousel-section">
          <div class="sdl-carousel-header">
            <div class="sdl-carousel-label">${label}</div>
            ${pdfList.length > 3 ? `<button class="sdl-see-all" onclick="">See all</button>` : ''}
          </div>
          <div class="sdl-carousel-track">${pdfList.map(p => sdlCoverCard(p, opts)).join('')}</div>
        </div>`;
      }

      // Build carousel HTML based on filter
      let carouselsHTML = '';

      if (BSF.filter === 'all' || BSF.filter === 'continue') {
        const continuePdfs = sortByLastOpened(BSF.allPdfs).filter(p => {
          const prog = BSF.readProgress[String(p.id)];
          return prog && prog > 0 && prog < 100;
        }).slice(0, 10);
        if (continuePdfs.length) carouselsHTML += sdlCarousel('▶ Continue Reading', continuePdfs);
      }

      if (BSF.filter === 'all' || BSF.filter === 'favorites') {
        const favPdfs = BSF.allPdfs.filter(p => BSF.favorites.includes(String(p.id)));
        if (favPdfs.length) carouselsHTML += sdlCarousel('⭐ Favorites', favPdfs);
      }

      if (BSF.filter === 'all' || BSF.filter === 'added') {
        const addedPdfs = sortByAdded(BSF.allPdfs).slice(0, 10);
        if (addedPdfs.length) carouselsHTML += sdlCarousel('🆕 Recently Added', addedPdfs);
      }

      if (BSF.filter === 'all' || BSF.filter === 'mostread') {
        const mostReadPdfs = sortByOpenCount(BSF.allPdfs).slice(0, 10);
        if (mostReadPdfs.length) carouselsHTML += sdlCarousel('🔥 Most Read', mostReadPdfs);
      }

      if (BSF.filter === 'all' || BSF.filter === 'recent') {
        const recentPdfs = sortByLastOpened(BSF.allPdfs).slice(0, 10);
        if (recentPdfs.length) carouselsHTML += sdlCarousel('🕐 Recently Opened', recentPdfs);
      }

      // All books (grid or carousel based on filter)
      if (BSF.filter === 'all') {
        if (BSF.allPdfs.length) carouselsHTML += sdlCarousel('📚 Full Collection', BSF.allPdfs);
      } else {
        // Non-all filter: show only the filtered pdfs in one carousel
        const filterLabel = {favorites:'⭐ Favorites',recent:'🕐 Recently Opened',added:'🆕 Recently Added',mostread:'🔥 Most Read',continue:'▶ Continue Reading'}[BSF.filter]||'📚 My Books';
        carouselsHTML += pdfs.length ? sdlCarousel(filterLabel + ` — ${pdfs.length} title${pdfs.length!==1?'s':''}`, pdfs) : '';
      }

      const emptyMsg = pdfs.length === 0 && BSF.filter !== 'all' ? `
        <div class="sdl-empty">
          <div class="sdl-empty-icon">${BSF.query ? '🔍' : '📭'}</div>
          <div class="sdl-empty-title">${BSF.query ? 'No results found' : 'Nothing here yet'}</div>
          <div class="sdl-empty-sub">${BSF.query ? 'Try a different search term.' : 'Browse the library to add PDFs to this section.'}</div>
          ${!BSF.query ? `<button class="btn btn-primary" onclick="navigate('library')" style="margin-top:16px">Browse Library</button>` : ''}
        </div>` : '';

      const totalEmpty = BSF.allPdfs.length === 0 ? `
        <div class="sdl-empty">
          <div class="sdl-empty-icon">📭</div>
          <div class="sdl-empty-title">Your library is empty</div>
          <div class="sdl-empty-sub">Purchase PDFs to start building your digital library.</div>
          <button class="btn btn-primary" onclick="navigate('library')" style="margin-top:16px">Browse Library</button>
        </div>` : '';

      const shelvesHTML = totalEmpty || (carouselsHTML || emptyMsg);

      document.getElementById('bsfShelvesWrap').innerHTML = shelvesHTML;
      if (document.getElementById('bsfListsWrap')) document.getElementById('bsfListsWrap').innerHTML = '';

      // Animate progress bars (keep for insights card)
      requestAnimationFrame(() => {
        document.querySelectorAll('.bsf-gc-bar-fill[data-w]').forEach(el => {
          el.style.width = el.getAttribute('data-w') + '%';
        });
      });
    }

    // ── List card helper ──────────────────────────────────────────
    function bsfListCard(p, showCount=false) {
      const cover = p.cover_image||p.coverImage||p.thumbnail||p.image||'';
      const a = analyticsMap[String(p.id)] || {};
      const sub = showCount
        ? `Opened ${a.opened_count||0} time${(a.opened_count||0)!==1?'s':''}`
        : (a.last_opened_at ? _formatRelativeDate(a.last_opened_at) : 'Never opened');
      const isFav = BSF.favorites.includes(String(p.id));
      return `<div class="bsf-list-card">
        <div class="bsf-list-thumb">
          ${cover ? `<img src="${cover}" alt="${p.title||''}" onerror="this.style.display='none'" loading="lazy" decoding="async">` : '📄'}
        </div>
        <div class="bsf-list-info">
          <div class="bsf-list-title">${p.title||'Untitled'}</div>
          <div class="bsf-list-sub">${sub}</div>
        </div>
        <div class="bsf-list-action" style="display:flex;gap:5px;align-items:center">
          <button class="bsf-tt-btn bsf-tt-fav" style="padding:5px 8px;border-radius:8px" onclick="bsfToggleFav('${p.id}')">${isFav?'⭐':'☆'}</button>
          <button class="bsf-list-open" onclick="openAndTrack('${p.id}')">Open</button>
        </div>
      </div>`;
    }

    // ── Admin panel HTML ──────────────────────────────────────────
    function bsfAdminPanel(s) {
      const SQL = `-- ════════════════════════════════════════════
-- BOOKSHELF SETTINGS TABLE
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookshelf_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_style     text DEFAULT 'wooden',
  theme           text DEFAULT 'dark',
  accent_color    text DEFAULT '#3d8ef8',
  font_style      text DEFAULT 'editorial',
  animations_on   boolean DEFAULT true,
  particles_on    boolean DEFAULT true,
  ambient_glow    boolean DEFAULT true,
  shelf_lighting  boolean DEFAULT true,
  parallax_on     boolean DEFAULT true,
  search_fuzzy    boolean DEFAULT true,
  books_per_shelf integer DEFAULT 8,
  badges          jsonb DEFAULT '[]',
  levels          jsonb DEFAULT '[]',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════
ALTER TABLE bookshelf_settings ENABLE ROW LEVEL SECURITY;

-- Admins can read & write
CREATE POLICY "admin_full_access" ON bookshelf_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- All authenticated users can read
CREATE POLICY "users_read" ON bookshelf_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ════════════════════════════════════════════
-- BOOK PROGRESS TABLE (per user per book)
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS book_progress (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  pdf_id     text NOT NULL,
  progress   integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, pdf_id)
);

ALTER TABLE book_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_only" ON book_progress
  FOR ALL USING (auth.uid() = user_id);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookshelf_updated
  BEFORE UPDATE ON bookshelf_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_progress_updated
  BEFORE UPDATE ON book_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();`;

      return `<div class="bsf-admin-panel" id="bsfAdminPanel">
        <div class="bsf-admin-title">🎨 Library Experience Manager</div>
        <div class="bsf-admin-sub">Customize the bookshelf appearance, effects and gamification. Changes are saved to Supabase.</div>
        <div class="bsf-admin-grid">

          <!-- Shelf Style -->
          <div class="bsf-admin-card">
            <div class="bsf-admin-card-title">🪵 Shelf Style</div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Style</span>
              <select class="bsf-admin-select" id="bsfAShelfStyle">
                <option value="wooden" ${s.shelf_style==='wooden'?'selected':''}>Wooden</option>
                <option value="metal" ${s.shelf_style==='metal'?'selected':''}>Metal</option>
                <option value="glass" ${s.shelf_style==='glass'?'selected':''}>Glass</option>
              </select>
            </div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Books/Shelf</span>
              <select class="bsf-admin-select" id="bsfABooksPerShelf">
                ${[4,5,6,7,8,10,12].map(n=>`<option value="${n}" ${(s.books_per_shelf||8)==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Theme & Colors -->
          <div class="bsf-admin-card">
            <div class="bsf-admin-card-title">🎨 Theme & Colors</div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Theme</span>
              <select class="bsf-admin-select" id="bsfATheme">
                <option value="dark" ${s.theme==='dark'?'selected':''}>Dark</option>
                <option value="light" ${s.theme==='light'?'selected':''}>Light</option>
                <option value="midnight" ${s.theme==='midnight'?'selected':''}>Midnight</option>
              </select>
            </div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Accent</span>
              <div class="bsf-color-row">
                ${['#3d8ef8','#00c8e8','#8b5cf6','#f59e0b','#10d98e','#ff4d6d'].map(c =>
                  `<div class="bsf-color-swatch${(s.accent_color||'#3d8ef8')===c?' active':''}"
                    style="background:${c}" onclick="bsfSetAccent('${c}')" data-color="${c}" title="${c}"></div>`
                ).join('')}
              </div>
            </div>
            <div class="bsf-admin-row" style="margin-top:6px">
              <span class="bsf-admin-lbl">Font</span>
              <select class="bsf-admin-select" id="bsfAFont">
                <option value="editorial" ${s.font_style==='editorial'?'selected':''}>Playfair (Editorial)</option>
                <option value="sans" ${s.font_style==='sans'?'selected':''}>Inter (Sans)</option>
                <option value="mono" ${s.font_style==='mono'?'selected':''}>Monospace</option>
              </select>
            </div>
          </div>

          <!-- Animations & Effects -->
          <div class="bsf-admin-card">
            <div class="bsf-admin-card-title">✨ Effects</div>
            ${[
              ['Animations','bsfAAnimations','animations_on'],
              ['Dust Particles','bsfAParticles','particles_on'],
              ['Ambient Glow','bsfAGlow','ambient_glow'],
              ['Shelf Lighting','bsfALighting','shelf_lighting'],
              ['Parallax','bsfAParallax','parallax_on'],
            ].map(([lbl,id,key]) => `
              <div class="bsf-admin-row">
                <span class="bsf-admin-lbl">${lbl}</span>
                <label class="bsf-admin-toggle">
                  <input type="checkbox" id="${id}" ${s[key]!==false?'checked':''}>
                  <span class="bsf-at-slider"></span>
                </label>
              </div>`).join('')}
          </div>

          <!-- Search Settings -->
          <div class="bsf-admin-card">
            <div class="bsf-admin-card-title">🔍 Search</div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Fuzzy / Typo Correction</span>
              <label class="bsf-admin-toggle">
                <input type="checkbox" id="bsfAFuzzy" ${s.search_fuzzy!==false?'checked':''}>
                <span class="bsf-at-slider"></span>
              </label>
            </div>
          </div>

          <!-- Badges & Levels -->
          <div class="bsf-admin-card" style="grid-column:1/-1">
            <div class="bsf-admin-card-title">🏆 Badges & Levels</div>
            <div class="bsf-admin-row">
              <span class="bsf-admin-lbl">Current Levels</span>
              <span class="bsf-admin-val">${(s.levels||[]).join(' → ')}</span>
            </div>
            <div class="bsf-admin-row" style="margin-top:6px">
              <span class="bsf-admin-lbl">Badges Active</span>
              <span class="bsf-admin-val">${earnedBadges.length}/${(s.badges||[]).length+3}</span>
            </div>
            <div style="margin-top:8px;font-size:.7rem;color:var(--text2)">Levels unlock at: 0, 200, 400, 600, 800+ reading score points.</div>
          </div>

        </div>

        <button class="bsf-admin-save" onclick="bsfAdminSave()">💾 Save Settings to Supabase</button>

        <!-- PWA Diagnostics Section -->
        <div style="margin-top:20px;padding:14px;border-radius:10px;background:rgba(61,142,248,0.05);border:1px solid rgba(61,142,248,0.15)">
          <div id="pwaDiagPanel" style="color:var(--text)">
            <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:10px">🔍 PWA Diagnostics</div>
            <div style="color:var(--text2);font-size:.8rem">Loading…</div>
          </div>
        </div>

        <!-- SQL Block -->
        <div class="bsf-sql-block">
          <div class="bsf-sql-title">📋 Supabase SQL — Run in SQL Editor</div>
          <pre class="bsf-sql-code">${SQL}</pre>
          <button class="bsf-sql-copy" onclick="navigator.clipboard.writeText(document.querySelector('.bsf-sql-code').textContent).then(()=>showToast('SQL copied! ✅','success'))">📋 Copy SQL</button>
        </div>
      </div>`;
    }

    // ── Main panel HTML — Smart Modern Digital Library ───────────────
    panel.innerHTML = `
      <!-- Book Open Modal -->
      <div id="bsfOpenModal">
        <div class="bsf-open-book-wrap">
          <div class="bsf-open-book" id="bsfOpenBookInner">
            <button class="bsf-om-close" onclick="bsfCloseModal()">✕</button>
            <div class="bsf-open-book-inner" id="bsfOpenBookContent"></div>
          </div>
        </div>
      </div>

      <div class="sdl-root">

        <!-- Smart Library Header -->
        <div class="sdl-header">
          <div class="sdl-header-left">
            <div class="sdl-header-title">
              <span class="sdl-title-icon">📚</span>
              My Digital Library
            </div>
            <div class="sdl-header-sub">${totalBooks} title${totalBooks!==1?'s':''} in your collection</div>
          </div>
          <div class="sdl-header-right">
            <!-- Collapsible Insights Card -->
            <div class="sdl-insights-card" id="sdlInsightsCard">
              <button class="sdl-insights-toggle" onclick="document.getElementById('sdlInsightsBody').classList.toggle('open');this.classList.toggle('open')" title="Toggle Insights">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                <span>Insights</span>
              </button>
              <div class="sdl-insights-body" id="sdlInsightsBody">
                <div class="sdl-insight-row">
                  <span class="sdl-insight-icon">🏅</span>
                  <div class="sdl-insight-info">
                    <div class="sdl-insight-val">${levelName}</div>
                    <div class="sdl-insight-lbl">Level</div>
                  </div>
                </div>
                <div class="sdl-insight-row">
                  <span class="sdl-insight-icon">⭐</span>
                  <div class="sdl-insight-info">
                    <div class="sdl-insight-val">${readScore}</div>
                    <div class="sdl-insight-lbl">Score</div>
                  </div>
                </div>
                <div class="sdl-insight-row">
                  <span class="sdl-insight-icon">🔥</span>
                  <div class="sdl-insight-info">
                    <div class="sdl-insight-val">${currentStreak}d</div>
                    <div class="sdl-insight-lbl">Streak</div>
                  </div>
                </div>
                <div class="sdl-insight-row">
                  <span class="sdl-insight-icon">📚</span>
                  <div class="sdl-insight-info">
                    <div class="sdl-insight-val">${totalBooks}</div>
                    <div class="sdl-insight-lbl">Collection</div>
                  </div>
                </div>
                ${earnedBadges.length ? `<div class="sdl-insight-badges">${earnedBadges.map(b=>`<span class="sdl-badge ${b.cls}">${b.icon}</span>`).join('')}</div>` : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Admin Panel -->
        <div id="bsfAdminWrap">${BSF.isAdmin ? bsfAdminPanel(bsfSettings) : ''}</div>

        <!-- Smart Search Bar -->
        <div class="sdl-search-bar">
          <div class="sdl-search-inner">
            <svg class="sdl-search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="bsfSearch" type="text" class="sdl-search-input" placeholder="Search your library… smart typo-correction enabled" autocomplete="off" value="${BSF.query}" oninput="bsfOnSearch(this.value)" />
            <button class="sdl-search-clear" id="bsfSearchClear" onclick="bsfClearSearch()" title="Clear" style="display:${BSF.query?'flex':'none'}">✕</button>
          </div>
          <div class="sdl-filter-chips">
            ${[
              ['all','📚 All'],['continue','▶ Continue'],['favorites','⭐ Favorites'],
              ['recent','🕐 Recent'],['added','🆕 New'],['mostread','🔥 Popular']
            ].map(([f,lbl])=>`<button class="sdl-chip${BSF.filter===f?' active':''}" onclick="bsfSetFilter('${f}')">${lbl}</button>`).join('')}
          </div>
        </div>
        <div class="bsf-typo-tip" id="bsfTypoTip"></div>

        <!-- Carousel sections — populated by bsfRender() -->
        <div id="bsfShelvesWrap"></div>
        <div id="bsfListsWrap"></div>

      </div>`;

    // ── Init render ───────────────────────────────────────────────
    bsfRender();

    // ── Populate PWA Diagnostics if admin panel is visible ──────
    if (BSF.isAdmin && window.pwaAppCenter) {
      setTimeout(function() { window.pwaAppCenter.refreshDiagnostics(); }, 100);
    }

    // ── Global BSF functions ──────────────────────────────────────
    window.bsfSetFilter = function(f) {
      BSF.filter = f;
      document.querySelectorAll('.sdl-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${f}'`));
      });
      bsfRender();
    };

    window.bsfOnSearch = function(val) {
      BSF.query = val;
      const clearBtn = document.getElementById('bsfSearchClear');
      if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
      bsfRender();
    };

    window.bsfClearSearch = function() {
      BSF.query = '';
      const inp = document.getElementById('bsfSearch');
      if (inp) inp.value = '';
      const clearBtn = document.getElementById('bsfSearchClear');
      if (clearBtn) clearBtn.style.display = 'none';
      const tipEl = document.getElementById('bsfTypoTip');
      if (tipEl) tipEl.style.display = 'none';
      bsfRender();
    };

    window.bsfToggleFav = function(id) {
      const idx = BSF.favorites.indexOf(String(id));
      if (idx >= 0) BSF.favorites.splice(idx, 1);
      else BSF.favorites.push(String(id));
      localStorage.setItem('bsf_favorites', JSON.stringify(BSF.favorites));
      // Persist to Supabase if available
      if (window.supabaseClient && _userId) {
        window.supabaseClient.from('user_favorites')
          .upsert({user_id: _userId, pdf_id: String(id), is_fav: idx < 0}, {onConflict:'user_id,pdf_id'})
          .then(() => {}).catch(() => {});
      }
      showToast(idx >= 0 ? '☆ Removed from Favorites' : '⭐ Added to Favorites', idx >= 0 ? 'info' : 'success');
      bsfRender();
    };

    window.bsfShare = function(id) {
      const p = BSF.allPdfs.find(x => String(x.id) === String(id));
      if (!p) return;
      const url = window.location.origin + '?pdf=' + id;
      if (navigator.share) {
        navigator.share({ title: p.title, text: `Check out "${p.title}" on Studyria!`, url });
      } else {
        navigator.clipboard.writeText(url).then(() => showToast('🔗 Link copied!', 'success'));
      }
    };

    window.bsfOpenBook = function(id) {
      const p = BSF.allPdfs.find(x => String(x.id) === String(id));
      if (!p) return;
      const cover = p.cover_image||p.coverImage||p.thumbnail||p.image||'';
      const a = analyticsMap[String(id)] || {};
      const prog = BSF.readProgress[String(id)] || 0;
      const isFav = BSF.favorites.includes(String(id));
      const dateStr = p._purchaseDate
        ? new Date(p._purchaseDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
      const price = p.free ? 'Free' : `₹${Number(p.price||0).toLocaleString()}`;

      document.getElementById('bsfOpenBookContent').innerHTML = `
        ${cover ? `<img class="bsf-om-cover" src="${cover}" alt="${p.title||''}" onerror="this.style.display='none'" loading="lazy" decoding="async">` : ''}
        <div class="bsf-om-title">${p.title||'Untitled'}</div>
        <div class="bsf-om-cat">${p.category||'Study Material'} · ${price}</div>
        <div class="bsf-om-stats">
          <div class="bsf-om-stat"><div class="bsf-om-stat-val">${a.opened_count||0}</div><div class="bsf-om-stat-lbl">Opens</div></div>
          <div class="bsf-om-stat"><div class="bsf-om-stat-val">${a.download_count||0}</div><div class="bsf-om-stat-lbl">Downloads</div></div>
          <div class="bsf-om-stat"><div class="bsf-om-stat-val">${prog}%</div><div class="bsf-om-stat-lbl">Progress</div></div>
          <div class="bsf-om-stat"><div class="bsf-om-stat-val">${dateStr}</div><div class="bsf-om-stat-lbl">Added</div></div>
        </div>
        <div class="bsf-om-actions">
          <button class="bsf-om-btn bsf-om-open" onclick="openAndTrack('${id}');bsfCloseModal()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open PDF
          </button>
          <button class="bsf-om-btn bsf-om-dl" onclick="triggerPDFDownloadTracked('${id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button class="bsf-om-btn bsf-om-fav" onclick="bsfToggleFav('${id}')">
            ${isFav?'⭐ Unfav':'☆ Favorite'}
          </button>
          <button class="bsf-om-btn bsf-om-share" onclick="bsfShare('${id}')">
            🔗 Share
          </button>
        </div>`;

      document.getElementById('bsfOpenModal').classList.add('open');

      // Track open
      BSF.readProgress[String(id)] = Math.min(100, prog + 10);
      localStorage.setItem('bsf_progress', JSON.stringify(BSF.readProgress));
      // Sync progress to Supabase
      if (window.supabaseClient && _userId) {
        window.supabaseClient.from('book_progress')
          .upsert({user_id:_userId, pdf_id:String(id), progress: BSF.readProgress[String(id)]}, {onConflict:'user_id,pdf_id'})
          .then(()=>{}).catch(()=>{});
      }
    };

    window.bsfCloseModal = function() {
      const m = document.getElementById('bsfOpenModal');
      if (m) m.classList.remove('open');
    };
    // Close modal on backdrop click
    document.getElementById('bsfOpenModal')?.addEventListener('click', function(e) {
      if (e.target === this) bsfCloseModal();
    });

    window.bsfSetAccent = function(color) {
      document.querySelectorAll('.bsf-color-swatch').forEach(el => {
        el.classList.toggle('active', el.dataset.color === color);
      });
      bsfSettings.accent_color = color;
    };

    window.bsfAdminSave = async function() {
      const payload = {
        shelf_style:    document.getElementById('bsfAShelfStyle')?.value || 'wooden',
        theme:          document.getElementById('bsfATheme')?.value || 'dark',
        accent_color:   bsfSettings.accent_color || '#3d8ef8',
        font_style:     document.getElementById('bsfAFont')?.value || 'editorial',
        animations_on:  document.getElementById('bsfAAnimations')?.checked ?? true,
        particles_on:   document.getElementById('bsfAParticles')?.checked ?? true,
        ambient_glow:   document.getElementById('bsfAGlow')?.checked ?? true,
        shelf_lighting: document.getElementById('bsfALighting')?.checked ?? true,
        parallax_on:    document.getElementById('bsfAParallax')?.checked ?? true,
        search_fuzzy:   document.getElementById('bsfAFuzzy')?.checked ?? true,
        books_per_shelf:parseInt(document.getElementById('bsfABooksPerShelf')?.value||'8'),
      };
      if (window.supabaseClient) {
        try {
          const { data: existing } = await window.supabaseClient
            .from('bookshelf_settings').select('id').limit(1).maybeSingle();
          let err;
          if (existing?.id) {
            ({ error: err } = await window.supabaseClient.from('bookshelf_settings')
              .update(payload).eq('id', existing.id));
          } else {
            ({ error: err } = await window.supabaseClient.from('bookshelf_settings').insert(payload));
          }
          if (err) throw err;
          showToast('✅ Bookshelf settings saved to Supabase!', 'success');
          Object.assign(bsfSettings, payload);
          bsfSettings.booksPerShelf = payload.books_per_shelf;
          bsfRender();
        } catch(e) {
          showToast('❌ Save failed: ' + (e.message||'Unknown error'), 'error');
          console.error('bsfAdminSave error:', e);
        }
      } else {
        showToast('⚠️ Supabase not connected', 'error');
      }
    };
  }

  // ── WISHLIST ───────────────────────────────────────────────────────
  else if (tab === 'wishlist') {
    const wishPdfs = (window.PDFS || []).filter(p => wishlist.includes(Number(p.id)) || wishlist.includes(String(p.id)));
    const wishBadge = document.getElementById('dashWishBadge');
    if (wishBadge) wishBadge.textContent = wishPdfs.length;
    main.innerHTML = `<div class="me-tab-panel">
      <div class="me-section-title"><span class="mst-accent"></span>❤️ Wishlist</div>
      <p class="text-muted text-sm" style="margin-bottom:20px" id="dashWishCount">${wishPdfs.length} saved PDFs</p>
      ${wishPdfs.length === 0 ?
        `<div style="text-align:center;padding:80px 20px">
          <div style="font-size:3rem;margin-bottom:16px">💔</div>
          <h3 style="font-family:var(--font-display);margin-bottom:8px">Nothing saved yet</h3>
          <p class="text-muted" style="margin-bottom:24px">Tap ❤️ on any PDF to save it here.</p>
          <button class="btn btn-primary btn-lg" onclick="navigate('library')">Browse Library</button>
        </div>` :
        `<div class="pdf-grid">${wishPdfs.map(pdfCardHTML).join('')}</div>`}

      <div class="me-section-title" style="margin-top:32px"><span class="mst-accent"></span>💼 Saved Jobs</div>
      <p class="text-muted text-sm" style="margin-bottom:20px" id="dashWishJobsCount">0 saved jobs</p>
      <div id="dashWishJobsContent"></div>
    </div>`;
    renderWishlistJobs('dashWishJobsContent', 'dashWishJobsCount');
  }

  // ── PROFILE ────────────────────────────────────────────────────────
  else if (tab === 'profile') {
    const u = window.currentUser || {};
    main.innerHTML = `<div class="me-tab-panel">
      <div class="me-section-title"><span class="mst-accent"></span>👤 Your Profile</div>
      <div class="me-profile-card">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
          <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#3d8ef8,#00c8e8);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:#fff;box-shadow:0 8px 24px rgba(61,142,248,0.3)">
            ${u.avatar || (u.name ? u.name[0].toUpperCase() : '👤')}
          </div>
          <div>
            <div style="font-weight:700;font-size:1.1rem">${u.name || 'Studyria User'}</div>
            <div style="color:var(--text2);font-size:.82rem;margin-top:2px">${u.email || ''}</div>
            <div class="me-member-badge mb-gold" style="margin-top:8px;display:inline-flex">🏆 Gold Learner</div>
          </div>
        </div>
        <div style="height:1px;background:var(--glass-border);margin-bottom:20px"></div>
        ${[["Full Name", u.name||""],["Email", u.email||""],["Phone", "+91 98765 43210"],["Location", "India"]].map(([lbl,val]) =>
          `<div class="form-group">
            <label class="form-label">${lbl}</label>
            <input class="form-input" value="${val}" style="border-radius:12px" />
          </div>`).join('')}
        <button class="btn btn-primary" style="border-radius:12px;margin-top:8px" onclick="showToast('Profile updated! ✅','success')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Save Profile
        </button>
      </div>
    </div>`;
  }

  // ── SETTINGS ────────────────────────────────────────────────────────
  else if (tab === 'settings') {
    main.innerHTML = `<div class="me-tab-panel">
      <div class="me-section-title"><span class="mst-accent"></span>⚙️ Settings</div>
      <div class="me-profile-card">
        ${[
          {lbl:"Email Notifications", desc:"New PDF releases and study tips", on:true},
          {lbl:"SMS Alerts",          desc:"Order confirmations via SMS",       on:false},
          {lbl:"Newsletter",          desc:"Weekly curated content digest",      on:true},
          {lbl:"Dark Mode",           desc:"Toggle light / dark appearance",     on:typeof dark!=='undefined'?dark:true},
        ].map((s,i) => `
          <div class="me-toggle-row">
            <div>
              <div style="font-weight:600;font-size:.88rem">${s.lbl}</div>
              <div class="text-muted" style="font-size:.75rem;margin-top:3px">${s.desc}</div>
            </div>
            <button class="me-toggle${s.on?' on':''}" onclick="this.classList.toggle('on');${i===3?'toggleTheme();':''}"  ></button>
          </div>`).join('')}
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--glass-border)">
          <button class="btn btn-danger btn-sm" style="border-radius:10px" onclick="showToast('Please contact support to delete your account.','info')">Delete Account</button>
        </div>
      </div>
    </div>`;
  }

  // ── LIBRARY EXPERIENCE MANAGER (Admin only) ──────────────────────
  else if (tab === 'libadmin') {
    const isAdm = !!(currentUser?.isAdmin || currentUser?.is_admin);
    if (!isAdm) { showToast('🔒 Admin access required', 'error'); return; }
    // Switch to purchased tab and show admin panel
    await switchMeTab('purchased');
    return;
  }

  // ── Show/hide admin Library Manager tab ──────────────────────────
  const adminTabBtn = document.getElementById('bsfAdminTabBtn');
  if (adminTabBtn) {
    const isAdm = !!(currentUser?.isAdmin || currentUser?.is_admin);
    adminTabBtn.style.display = isAdm ? '' : 'none';
  }
}

// ── COUNT-UP ANIMATION HELPER ─────────────────────────────────────
function _animateCount(id, target, prefix='', suffix='', isCurrency=false) {
  const el = document.getElementById(id);
  if (!el) return;
  const numTarget = parseFloat(target) || 0;
  const duration = 800;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = numTarget * eased;
    el.textContent = prefix + (isCurrency ? current.toLocaleString('en-IN', {maximumFractionDigits:0}) : Math.round(current)) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function _setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ══════════════════════════════════════════════════════════════════
// ── READING SESSION TRACKER ──────────────────────────────────────
// Called whenever a user opens a PDF. Logs a reading_sessions row.
// Table: reading_sessions (id, user_id, pdf_id, total_seconds, opened_at)
// We credit a fixed 15-minute session per open (conservative default).
// Replace READING_CREDIT_SECONDS with a real timer if desired.
// ══════════════════════════════════════════════════════════════════
const READING_CREDIT_SECONDS = 900; // 15 minutes per open

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

// ── Increment download_count on pdfs table ────────────────────────
async function incrementDownloadCount(pdfId) {
  const client = window.supabaseClient;
  if (!client || !pdfId) return;
  try {
    // Use RPC if available, otherwise manual increment
    const { data: row } = await client
      .from('pdfs').select('download_count').eq('id', String(pdfId)).single();
    const current = (row?.download_count) || 0;
    await client.from('pdfs').update({ download_count: current + 1 }).eq('id', String(pdfId));
    console.log(`✅ download_count incremented for pdf ${pdfId}: ${current} → ${current + 1}`);
    cpCreditCreatorDownload(pdfId);
  } catch(e) {
    console.warn('⚠️ incrementDownloadCount error:', e);
  }
}

// ── Format date relative to today (Today / Yesterday / DD Mon YYYY) ──
function _formatRelativeDate(isoStr) {
  if (!isoStr) return 'No data available';
  const d = new Date(isoStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Fetch real file size from Supabase Storage metadata ──────────────
// pdfUrl must be a supabase storage public URL.
// Returns a human-readable string like "2.4 MB" or null if unavailable.
async function _fetchPdfFileSize(pdfUrl) {
  if (!pdfUrl) return null;
  try {
    const res = await fetch(pdfUrl, { method: 'HEAD' });
    if (!res.ok) return null;
    const cl = res.headers.get('content-length');
    if (!cl) return null;
    const bytes = parseInt(cl, 10);
    if (isNaN(bytes) || bytes <= 0) return null;
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  } catch(e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// ── PREMIUM ADMIN PANEL ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// ── Admin Auth State ──────────────────────────────────────────────
let adminSession = null;
let adminActivityLog = [];

// Keep window.adminSession in sync with the local variable so that
// supabase.js helpers (syncNavToAuth guard, etc.) can read it.
// Also persist to sessionStorage so admin dashboard survives a page refresh.
function _setAdminSession(val) {
  adminSession = val;          // keep module-scope local var in sync
  window.adminSession = val;   // authoritative reference for all guards
  if (val) {
    try { sessionStorage.setItem('studyria_admin_session', JSON.stringify(val)); } catch(e) {}
  } else {
    try { sessionStorage.removeItem('studyria_admin_session'); } catch(e) {}
    adminCurrentTab = 'dashboard'; // reset tab on logout
  }
}

// Restore admin session from sessionStorage on page load
(function _restoreAdminSession() {
  try {
    const stored = sessionStorage.getItem('studyria_admin_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Use _setAdminSession to keep both local var and window in sync.
      // Note: _setAdminSession is defined above this IIFE, so it's available.
      adminSession = parsed;
      window.adminSession = parsed;
    }
  } catch(e) {}
})();

function logAdminActivity(msg, type = 'blue') {
  adminActivityLog.unshift({ msg, type, time: new Date() });
  if (adminActivityLog.length > 100) adminActivityLog.pop();
}

// ── Hamburger Menu ───────────────────────────────────────────────
function toggleHamburger() {
  // ── Alpine bridge: delegate to reactive sidebarOpen state ────
  if (window._alpine) {
    window._alpine.sidebarOpen = !window._alpine.sidebarOpen;
    return;
  }
  // Fallback (pre-Alpine load)
  const menu = document.getElementById('hamburgerMenu');
  if (menu) {
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
  }
}
// NOTE: click-outside is now handled by Alpine @click.outside directive
// Legacy fallback only (runs if Alpine not yet loaded)
document.addEventListener('click', (e) => {
  if (window._alpine) return; // Alpine handles this
  const wrap = document.getElementById('hamburgerWrap');
  if (wrap && !wrap.contains(e.target)) {
    const menu = document.getElementById('hamburgerMenu');
    if (menu) menu.style.display = 'none';
  }
});

// ── Open Admin Entry (via hamburger) ────────────────────────────
function openAdminEntry() {
  if (window.adminSession) {
    navigate('admin');
  } else {
    navigate('admin-login');
  }
}

// ══════════════════════════════════════════════════════════════════
// 🔔 NOTIFICATION CENTER — burger menu item + permission flow
// ══════════════════════════════════════════════════════════════════

function toggleNotificationCenter() {
  const overlay = document.getElementById('notifCenterOverlay');
  if (!overlay) return;
  const isOpen = overlay.style.display !== 'none';
  if (isOpen) {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
    refreshNotificationCenter();
  }
}

/**
 * refreshNotificationCenter — checks the current browser/OneSignal
 * permission state and renders the right UI:
 *   default     → "Enable Notifications" button that triggers the native prompt
 *   denied      → "Enable Notifications" button with manual settings instructions
 *   granted     → "Notifications Enabled" status, no action needed
 *   unsupported → explains the browser/context doesn't support push
 */
async function refreshNotificationCenter() {
  const pill   = document.getElementById('notifCenterStatusPill');
  const body   = document.getElementById('notifCenterBody');
  const actions= document.getElementById('notifCenterActions');
  const hmBadge= document.getElementById('hmNotifBadge');
  if (!pill || !body || !actions) return;

  // app.js defines window.StudyriaNotifications, but it may not have run
  // yet if the panel is opened immediately after page load. Wait up to
  // ~3s for it to appear before concluding the browser is unsupported —
  // otherwise a normal Chrome/Edge user briefly sees a false "Unsupported".
  let api = window.StudyriaNotifications;
  if (!api) {
    pill.className = 'notif-center-status-pill default';
    pill.textContent = 'Checking…';
    body.textContent = 'Checking your notification permission…';
    actions.innerHTML = '';
    const deadline = Date.now() + 3000;
    while (!api && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 150));
      api = window.StudyriaNotifications;
    }
  }

  const state = api ? await api.getPermissionState() : 'unsupported';

  pill.className = 'notif-center-status-pill ' + state;
  actions.innerHTML = '';

  if (state === 'unsupported') {
    pill.textContent = 'Unsupported';
    body.textContent = 'Push notifications aren\'t supported in this browser. Try Chrome, Edge, or installing the Studyria app.';
    if (hmBadge) { hmBadge.textContent = 'N/A'; hmBadge.style.color = '#94a3b8'; hmBadge.style.background = 'rgba(148,163,184,.15)'; }
    return;
  }

  if (state === 'granted') {
    pill.textContent = 'Enabled';
    body.textContent = 'You\'re all set! You\'ll receive alerts for new PDFs, results, scholarships and more.';
    if (hmBadge) { hmBadge.textContent = 'ON'; hmBadge.style.color = '#10d98e'; hmBadge.style.background = 'rgba(16,217,142,.15)'; }
    actions.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#10d98e;font-size:.82rem;font-weight:600;justify-content:center;padding:6px 0">
      <span>✅</span><span>Notifications Enabled</span>
    </div>`;
    return;
  }

  if (state === 'denied') {
    pill.textContent = 'Blocked';
    body.innerHTML = 'You previously blocked notifications. To re-enable, open your browser\'s site settings for Studyria and allow notifications, then tap below.';
    if (hmBadge) { hmBadge.textContent = 'OFF'; hmBadge.style.color = '#ff6b85'; hmBadge.style.background = 'rgba(255,77,109,.15)'; }
    actions.innerHTML = `<button class="btn btn-primary btn-sm" onclick="notifCenterOpenSettings()">⚙️ Enable Notifications</button>`;
    return;
  }

  // state === 'default'
  pill.textContent = 'Not Set';
  body.textContent = 'Turn on notifications to get notified the moment new PDFs, results, scholarships and exam alerts drop.';
  if (hmBadge) { hmBadge.textContent = 'SETUP'; hmBadge.style.color = '#fbbf24'; hmBadge.style.background = 'rgba(251,191,36,.15)'; }
  actions.innerHTML = `<button class="btn btn-primary btn-sm" id="notifCenterEnableBtn" onclick="notifCenterRequestPermission()">🔔 Enable Notifications</button>`;
}

async function notifCenterRequestPermission() {
  const btn = document.getElementById('notifCenterEnableBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Requesting…'; }

  const api = window.StudyriaNotifications;
  const result = api ? await api.requestPermission() : { success: false, reason: 'unsupported' };

  if (result.success) {
    if (typeof showToast === 'function') showToast('🔔 Notifications enabled!', 'success');
    // Tag audience segment for admin targeting (premium vs free)
    try {
      const hasPurchases = !!(window._purchasedPdfIds && window._purchasedPdfIds.size > 0);
      if (api.tagAudienceSegment) api.tagAudienceSegment(hasPurchases);
    } catch (_) {}
  } else if (result.reason === 'denied') {
    if (typeof showToast === 'function') showToast('Notifications were blocked. You can enable them from site settings.', 'error');
  } else if (result.reason !== 'dismissed') {
    if (typeof showToast === 'function') showToast('Could not enable notifications right now.', 'error');
  }

  await refreshNotificationCenter();
}

function notifCenterOpenSettings() {
  const api = window.StudyriaNotifications;
  const opened = api ? api.openNotificationSettings() : false;
  if (!opened && typeof showToast === 'function') {
    showToast('Open your browser menu → Site settings → Notifications → Allow.', 'info');
  }
}

// Listen for subscription changes from any source (e.g. OneSignal's own UI)
// and keep the burger-menu badge in sync without requiring the panel to be open.
window.addEventListener('onesignal:subscriptionchange', function () {
  const overlay = document.getElementById('notifCenterOverlay');
  if (overlay && overlay.style.display !== 'none') {
    refreshNotificationCenter();
  } else {
    // Still refresh the small burger badge even when panel is closed
    const hmBadge = document.getElementById('hmNotifBadge');
    if (hmBadge && window.StudyriaNotifications) {
      window.StudyriaNotifications.getPermissionState().then(function (state) {
        if (state === 'granted') { hmBadge.textContent = 'ON'; hmBadge.style.color = '#10d98e'; hmBadge.style.background = 'rgba(16,217,142,.15)'; }
      });
    }
  }
});

// Set the initial burger-menu badge state once the page has loaded
window.addEventListener('load', function () {
  setTimeout(async function () {
    const hmBadge = document.getElementById('hmNotifBadge');
    if (!hmBadge) return;

    // Wait up to ~5s total for app.js to finish setting up StudyriaNotifications
    // before concluding push isn't supported — avoids a false "N/A" on slow loads.
    let tries = 0;
    while (!window.StudyriaNotifications && tries < 30) {
      await new Promise(r => setTimeout(r, 150));
      tries++;
    }
    if (!window.StudyriaNotifications) return;

    window.StudyriaNotifications.getPermissionState().then(function (state) {
      if (state === 'granted')      { hmBadge.textContent = 'ON';  hmBadge.style.color = '#10d98e'; hmBadge.style.background = 'rgba(16,217,142,.15)'; }
      else if (state === 'denied')  { hmBadge.textContent = 'OFF'; hmBadge.style.color = '#ff6b85'; hmBadge.style.background = 'rgba(255,77,109,.15)'; }
      else if (state === 'unsupported') { hmBadge.textContent = 'N/A'; hmBadge.style.color = '#94a3b8'; hmBadge.style.background = 'rgba(148,163,184,.15)'; }
      // 'default' keeps the initial "SETUP" label already in the markup
    });
  }, 800);
});

// ── Admin Login ──────────────────────────────────────────────────
async function adminDoLogin() {
  const email = document.getElementById('adminLoginEmail')?.value?.trim();
  const pass  = document.getElementById('adminLoginPass')?.value;
  const btn   = document.getElementById('adminLoginBtn');
  const errBox = document.getElementById('adminLoginError');

  if (!email || !pass) {
    showAdminLoginError('Please enter email and password.');
    return;
  }

  btn.innerHTML = '<span class="auth-spinner"></span>Verifying…';
  btn.disabled = true;
  if (errBox) errBox.style.display = 'none';

  try {
    // Try Supabase auth if available
    if (window.supabaseClient) {
      const { data: authData, error: authError } = await window.supabaseClient.auth.signInWithPassword({ email, password: pass });
      if (authError) throw new Error(authError.message);

      // Check admin_users table
      const { data: adminRow, error: adminErr } = await window.supabaseClient
        .from('admin_users').select('*').eq('email', email).single();
      if (adminErr || !adminRow) throw new Error('This account is not authorized as admin.');

      const sessionData = { email, name: adminRow.name || email.split('@')[0], role: adminRow.role || 'Admin', uid: authData.user.id };
      _setAdminSession(sessionData);
      logAdminActivity(`Admin login: ${email}`, 'green');
    } else {
      throw new Error('Admin login unavailable. Supabase not connected.');
    }

    // Success — update topbar then navigate to admin panel.
    // navigate('admin') calls renderAdmin() which calls switchAdminTab().
    // Do NOT call switchAdminTab here again — it would be a duplicate.
    updateAdminTopbar();
    navigate('admin');
    showToast('Welcome to Admin Panel 🛡️', 'success');
  } catch(err) {
    showAdminLoginError(err.message || 'Authentication failed.');
  } finally {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Access Admin Panel';
    btn.disabled = false;
  }
}

function showAdminLoginError(msg) {
  const box = document.getElementById('adminLoginError');
  const msgEl = document.getElementById('adminLoginErrorMsg');
  if (box) { box.style.display = 'flex'; if(msgEl) msgEl.textContent = msg; }
}

function adminLogout() {
  if (!confirm('Log out of Admin Panel?')) return;
  logAdminActivity(`Admin logged out: ${window.adminSession?.email}`, 'red');
  _setAdminSession(null);  // clears local, window, sessionStorage, resets tab
  if (window.supabaseClient) window.supabaseClient.auth.signOut();
  navigate('home');
  showToast('Admin session ended.', 'info');
}

function updateAdminTopbar() {
  const sess = window.adminSession;
  if (!sess) return;
  const el = document.getElementById('adminTopbarName');
  const em = document.getElementById('adminTopbarEmail');
  const av = document.getElementById('adminTopbarAvatar');
  if (el) el.textContent = sess.name;
  if (em) em.textContent = sess.email;
  if (av) av.textContent = sess.name.charAt(0).toUpperCase();
}

// ── Admin Navigate Guard ─────────────────────────────────────────
function renderAdmin() {
  // Always read from window.adminSession — this is the authoritative
  // reference kept in sync by _setAdminSession() and the session-restore IIFE.
  if (!window.adminSession) {
    // No session — show the admin login page (clear any active page first).
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const loginPage = document.getElementById('page-admin-login');
    if (loginPage) loginPage.classList.add('active');
    return;
  }
  updateAdminTopbar();
  switchAdminTab(adminCurrentTab || 'dashboard');
}

// ── Tab Switcher ─────────────────────────────────────────────────
let adminCurrentTab = 'dashboard';
function switchAdminTab(tab) {
  // Guard: if no admin session at all, redirect to admin login.
  // Use window.adminSession so we always read the most-recently-set value
  // (avoids stale closure over the local `adminSession` variable).
  if (!window.adminSession) { navigate('admin-login'); return; }
  // Reset Batch Publisher session when navigating away from add-pdf
  if (tab !== 'add-pdf' && window._sbp) { window._sbp._sessionActive = false; }
  adminCurrentTab = tab;

  document.querySelectorAll('.admin-nav-item[data-atab]').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  const bc = document.getElementById('adminBreadcrumb');
  const tabNames = { dashboard:'Dashboard', analytics:'Analytics', pdfs:'PDF Management', 'add-pdf':'Add New PDF', categories:'Hierarchy Manager', orders:'Orders', users:'Users', revenue:'Revenue', activity:'Activity Logs', settings:'Settings',
    'hero-designer':'🎨 Hero Designer',
    'pdf-manager-pro':'Advanced PDF Manager', 'category-manager-pro':'Advanced Category Manager', 'homepage-manager':'Homepage Manager', 'header-manager':'Header Manager', 'nav-manager':'Navigation Manager', 'customization':'Website Customization', 'users-pro':'User Management Pro',
    'finance':'Sales & Finance Center', 'coupons':'Coupons & Offers', 'blog':'Blog Manager', 'announcements':'Announcement Center', 'testimonials':'Testimonials', 'achievements':'Achievement System', 'notifications-pro':'Notification Center',
    'seo-manager':'SEO Manager', 'live-analytics':'Live Analytics Center', 'ai-center':'AI Control Center', 'security':'Security Center', 'system-advanced':'Advanced System Settings',
    'library-manager':'📚 Library Experience Manager', 'career-hub-manager':'💼 Career Hub Manager', 'community-manager':'🌐 Community Manager', 'whatsapp-community':'📱 WhatsApp Community' };
  if (bc) bc.textContent = tabNames[tab] || tab;

  const main = document.getElementById('adminMain');
  if (!main) return;

  switch(tab) {
    case 'dashboard':  renderAdminDashboard(main); break;
    case 'analytics':  renderAdminAnalytics(main); break;
    case 'pdfs':       renderAdminPDFs(main); break;
    case 'add-pdf':    renderAdminAddPDF(main); break;
    case 'categories': renderAdminCategories(main); break;
    case 'orders':     renderAdminOrders(main); break;
    case 'users':      renderAdminUsers(main); break;
    case 'revenue':    renderAdminRevenue(main); break;
    case 'activity':   renderAdminActivity(main); break;
    case 'settings':   renderAdminSettings(main); break;
    case 'hero-designer': renderHeroDesigner(main); break;
    case 'pdf-manager-pro':       renderPCCPDFManager(main); break;
    case 'category-manager-pro':  renderPCCCategoryManager(main); break;
    case 'homepage-manager':      renderPCCHomepageManager(main); break;
    case 'home-layout-manager':   renderOTTHomeLayoutManager(main); break;
    case 'header-manager':        renderHeaderManager(main); break;
    case 'nav-manager':           renderNavManager(main); break;
    case 'customization':         renderPCCCustomization(main); break;
    case 'users-pro':             renderPCCUsersProManager(main); break;
    case 'finance':               renderPCCFinance(main); break;
    case 'coupons':               renderPCCCoupons(main); break;
    case 'blog':                  renderPCCBlog(main); break;
    case 'announcements':         renderPCCAnnouncements(main); break;
    case 'branding':              renderPCCBranding(main); break;
    case 'library-manager':       renderAdminLibraryManager(main); break;
    case 'career-hub-manager':    renderAdminCareerHubManager(main); break;
    case 'community-manager':     renderAdminCommunityManager(main); break;
    case 'whatsapp-community':    renderAdminWhatsAppCommunity(main); break;
    case 'testimonials':          renderPCCTestimonials(main); break;
    case 'achievements':          renderPCCAchievements(main); break;
    case 'notifications-pro':     renderPCCNotifications(main); break;
    case 'seo-manager':           renderPCCSEO(main); break;
    case 'live-analytics':        renderPCCLiveAnalytics(main); break;
    case 'ai-center':             renderPCCAICenter(main); break;
    case 'security':              renderPCCSecurity(main); break;
    case 'system-advanced':       renderPCCSystemAdvanced(main); break;
    default: main.innerHTML = `<p class="text-muted">Section coming soon.</p>`;
  }
}

// ── Helper ────────────────────────────────────────────────────────
function adminIcon(id, s=15) { return `<svg width="${s}" height="${s}"><use href="#ic-${id}"/></svg>`; }
function adminStatCard(label, value, change, up, colorClass, iconId) {
  return `<div class="admin-stat-card ${colorClass}">
    <div class="admin-stat-icon">${adminIcon(iconId, 17)}</div>
    <div class="admin-stat-label">${label}</div>
    <div class="admin-stat-num">${value}</div>
    <div class="admin-stat-change ${up ? 'stat-up' : 'stat-down'}">${up ? '↑' : '↓'} ${change}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════
// 📚 LIBRARY EXPERIENCE MANAGER — Admin Panel
// ══════════════════════════════════════════════════════════════════
async function renderAdminLibraryManager(main) {
  main.innerHTML = `
    <div class="admin-section" style="animation:dashFadeUp .35s ease both">
      <div class="admin-section-title" style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#lmGrad2)" stroke-width="2">
          <defs><linearGradient id="lmGrad2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d8ef8"/><stop offset="1" stop-color="#00c8e8"/></linearGradient></defs>
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
        </svg>
        📚 Library Experience Manager
      </div>
      <p style="color:var(--text2);font-size:.82rem;margin-bottom:20px">
        Full control over the Netflix-style library — carousels, sections, recommendations, stats, and PDF management.
      </p>

      <!-- Tab bar -->
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:5px">
        ${['Overview','PDF Manager','Sections','Recommendations','Statistics','Achievements'].map((t,i) =>
          `<button id="lmTab_${i}" onclick="lmSwitchTab(${i})"
            style="padding:8px 14px;border-radius:10px;font-size:.75rem;font-weight:700;cursor:pointer;transition:all .2s;font-family:var(--font-body);border:none;${i===0?'background:var(--grad-primary);color:#fff;box-shadow:0 3px 10px rgba(61,142,248,0.3)':'background:transparent;color:var(--text2)'}">${t}</button>`
        ).join('')}
      </div>

      <div id="lmBody">
        <div class="me-skeleton" style="height:120px;border-radius:16px;margin-bottom:14px"></div>
        <div class="me-skeleton" style="height:200px;border-radius:16px;margin-bottom:14px"></div>
        <div class="me-skeleton" style="height:160px;border-radius:16px"></div>
      </div>
    </div>`;

  // Load state
  let S = {
    shelf_style:'ott', theme:'amoled', accent_color:'#3d8ef8',
    font_style:'editorial', animations_on:true, particles_on:true,
    ambient_glow:true, shelf_lighting:true, parallax_on:true,
    search_fuzzy:true, books_per_shelf:8,
    section_continue:true, section_mypdf:true, section_trending:true,
    section_ai:true, section_new:true, section_popular:true, section_recent:true,
    badges:['?? Bookworm','⚡ Speed Reader','🏆 Champion','🔥 On Fire','⬇️ Downloader'],
    levels:['Novice','Scholar','Expert','Master','Legend'],
    hero_title:'Your Study Universe',
    hero_subtitle:'Premium PDFs, Notes & Study Materials — curated, personalized, and always one tap away.',
    carousel_order:['continue','trending','mypdf','ai','new','popular','recent'],
    show_achievements:true, show_streak:true, show_ai_banner:true,
    stat_total:true, stat_cats:true, stat_downloads:true, stat_wishlist:true, stat_streak:true
  };
  let existingId = null;

  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient
        .from('bookshelf_settings').select('*').limit(1).maybeSingle();
      if (data) { existingId = data.id; S = { ...S, ...data }; }
    } catch(e) {}
  }

  let totalUsers=0, totalBooks=0, totalOpens=0, totalDownloads=0;
  if (window.supabaseClient) {
    try {
      const [uRes, aRes] = await Promise.all([
        window.supabaseClient.from('admin_users').select('id',{count:'exact',head:true}),
        window.supabaseClient.from('pdf_analytics').select('opened_count'),
      ]);
      totalUsers = uRes.count || 0;
      totalOpens = (aRes.data||[]).reduce((s,r)=>s+(r.opened_count||0),0);
    } catch(e) {}
  }
  totalBooks = (window.PDFS||[]).length;
  totalDownloads = (window.PDFS||[]).reduce((s,p)=>s+(p.download_count||p.sales||0),0);

  // ── Save to Supabase ──────────────────────────────────────────
  window.lmSave = async function() {
    const btn = document.getElementById('lmSaveBtn');
    if (btn) { btn.disabled=true; btn.innerHTML='⏳ Saving…'; }
    const payload = {
      ...S,
      hero_title: document.getElementById('lmHeroTitle')?.value || S.hero_title,
      hero_subtitle: document.getElementById('lmHeroSubtitle')?.value || S.hero_subtitle,
      levels: (document.getElementById('lmLevels')?.value||'').split(',').map(x=>x.trim()).filter(Boolean),
      books_per_shelf: parseInt(document.getElementById('lmBooksPerShelf')?.value)||8,
    };
    const status = document.getElementById('lmSaveStatus');
    if (!window.supabaseClient) {
      if (status) status.textContent='⚠️ Supabase not connected';
      if (btn) { btn.disabled=false; btn.innerHTML='💾 Save Changes'; }
      return;
    }
    try {
      let res;
      if (existingId) {
        res = await window.supabaseClient.from('bookshelf_settings').update(payload).eq('id',existingId);
      } else {
        res = await window.supabaseClient.from('bookshelf_settings').insert(payload).select().single();
        if (res.data) existingId = res.data.id;
      }
      if (res.error) throw res.error;
      showToast('✅ Library settings saved!','success');
      if (status) { status.textContent='✅ Saved!'; setTimeout(()=>{ if(status) status.textContent=''; },3000); }
    } catch(e) {
      showToast('Save failed: '+e.message,'error');
      if (status) status.textContent='❌ Save failed';
    }
    if (btn) { btn.disabled=false; btn.innerHTML='💾 Save Changes'; }
  };

  window.lmSetStyle = v => { S.shelf_style=v; document.querySelectorAll('[id^=lmStyle_]').forEach(b=>{ b.style.cssText=b.id==='lmStyle_'+v?'padding:6px 12px;border-radius:9px;font-size:.72rem;font-weight:700;cursor:pointer;transition:all .2s;font-family:var(--font-body);background:var(--grad-primary);color:#fff;border:none':'padding:6px 12px;border-radius:9px;font-size:.72rem;font-weight:700;cursor:pointer;transition:all .2s;font-family:var(--font-body);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text2)'; }); };
  window.lmSetTheme = v => { S.theme=v; };
  window.lmSetColor = v => { S.accent_color=v; };
  window.lmToggle = (key, checked) => { S[key]=checked; };

  window.lmSwitchTab = function(idx) {
    document.querySelectorAll('[id^=lmTab_]').forEach((b,i) => {
      if (i===idx) { b.style.background='var(--grad-primary)'; b.style.color='#fff'; b.style.boxShadow='0 3px 10px rgba(61,142,248,0.3)'; }
      else { b.style.background='transparent'; b.style.color='var(--text2)'; b.style.boxShadow='none'; }
    });
    const body = document.getElementById('lmBody');
    if (!body) return;
    const tabs = [lmTabOverview,lmTabPDFManager,lmTabSections,lmTabRecommendations,lmTabStatistics,lmTabAchievements];
    body.innerHTML = '';
    tabs[idx]?.(body, S);
  };

  // ── TAB RENDERERS ─────────────────────────────────────────────
  function lmTabOverview(body, S) {
    body.innerHTML = `
      <!-- Live Stats Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:20px">
        ${[
          {icon:'👥',val:totalUsers,lbl:'Total Readers',c:'rgba(61,142,248,0.1)',b:'rgba(61,142,248,0.25)'},
          {icon:'📚',val:totalBooks,lbl:'PDFs in Lib',c:'rgba(0,200,232,0.08)',b:'rgba(0,200,232,0.2)'},
          {icon:'👁',val:totalOpens,lbl:'Total Opens',c:'rgba(139,92,246,0.08)',b:'rgba(139,92,246,0.2)'},
          {icon:'⬇️',val:totalDownloads,lbl:'Downloads',c:'rgba(245,158,11,0.08)',b:'rgba(245,158,11,0.2)'},
        ].map(s=>`
          <div style="background:${s.c};border:1px solid ${s.b};border-radius:14px;padding:14px 12px;text-align:center">
            <div style="font-size:1.4rem;margin-bottom:4px">${s.icon}</div>
            <div style="font-family:var(--font-editorial);font-size:1.2rem;font-weight:800;color:var(--text)">${typeof s.val==='number'&&s.val>999?(s.val/1000).toFixed(1)+'k':s.val}</div>
            <div style="font-size:.62rem;color:var(--text2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">${s.lbl}</div>
          </div>`).join('')}
      </div>

      <!-- Hero Text Control -->
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:14px">🎬 Library Hero Text</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:5px">Hero Title</label>
            <input id="lmHeroTitle" value="${S.hero_title||'Your Study Universe'}"
              style="width:100%;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.85rem;outline:none">
          </div>
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:5px">Hero Subtitle</label>
            <textarea id="lmHeroSubtitle" rows="2"
              style="width:100%;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none;resize:vertical">${S.hero_subtitle||''}</textarea>
          </div>
        </div>
      </div>

      <!-- Visual Effects -->
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:14px">✨ Visual Effects</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
          ${[
            ['lmAnimations','animations_on','🎬 Card Animations','Hover, float, and 3D effects'],
            ['lmGlow','ambient_glow','💡 Ambient Glow','Cinematic orb background'],
            ['lmStreak','show_streak','🔥 Streak Banner','Show reading streak bar'],
            ['lmAIBanner','show_ai_banner','🤖 AI Banner','AI recommendations banner'],
            ['lmAchievements','show_achievements','🏅 Achievements','Achievement progress strip'],
            ['lmFuzzy','search_fuzzy','🔍 Smart Search','Typo-tolerant search'],
          ].map(([id,key,title,desc])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:12px">
              <div>
                <div style="font-size:.78rem;font-weight:700;color:var(--text)">${title}</div>
                <div style="font-size:.66rem;color:var(--text2);margin-top:2px">${desc}</div>
              </div>
              <label class="bsf-admin-toggle">
                <input type="checkbox" id="${id}" ${S[key]!==false?'checked':''} onchange="lmToggle('${key}',this.checked)">
                <span class="bsf-at-slider"></span>
              </label>
            </div>`).join('')}
        </div>
      </div>

      ${lmSaveBar()}`;
  }

  function lmTabPDFManager(body) {
    const pdfs = window.PDFS || [];
    body.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div style="font-size:.82rem;font-weight:700;color:var(--text)">📄 PDF Management (${pdfs.length} PDFs)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="navigate('upload')" style="padding:8px 16px;border-radius:10px;background:var(--grad-primary);color:#fff;border:none;font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">➕ Add PDF</button>
            <button onclick="switchAdminTab('pdfs')" style="padding:8px 16px;border-radius:10px;background:rgba(255,255,255,0.07);color:var(--text2);border:1px solid rgba(255,255,255,0.1);font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">🔧 Advanced Manager</button>
          </div>
        </div>
        <input id="lmPDFSearch" oninput="lmFilterPDFTable()" placeholder="🔍 Search PDFs by title, author, category…"
          style="width:100%;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none;margin-bottom:12px">
        <div style="overflow-x:auto;border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
          <table id="lmPDFTable" style="width:100%;border-collapse:collapse;font-size:.75rem">
            <thead>
              <tr style="background:rgba(255,255,255,0.04)">
                ${['Cover','Title','Category','Price','Downloads','Rating','Status','Actions'].map(h =>
                  `<th style="padding:10px 12px;text-align:left;color:var(--text2);font-weight:700;font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap">${h}</th>`
                ).join('')}
              </tr>
            </thead>
            <tbody id="lmPDFBody">
              ${pdfs.slice(0,20).map(p => `
                <tr style="border-top:1px solid rgba(255,255,255,0.05);transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,0.025)'" onmouseout="this.style.background=''">
                  <td style="padding:8px 12px">
                    <div style="width:32px;height:42px;border-radius:5px;overflow:hidden;background:rgba(61,142,248,0.15);display:flex;align-items:center;justify-content:center;font-size:1rem">
                      ${p.cover_image_url ? `<img src="${p.cover_image_url}" alt="${(p.title || 'PDF cover').replace(/"/g,'&quot;')}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentNode.innerHTML='📄'" loading="lazy" decoding="async">` : '📄'}
                    </div>
                  </td>
                  <td style="padding:8px 12px;max-width:200px">
                    <div style="font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title||'—'}</div>
                    <div style="color:var(--text2);font-size:.65rem">${p.author||''}</div>
                  </td>
                  <td style="padding:8px 12px;color:var(--text2)">${p.category||'—'}</td>
                  <td style="padding:8px 12px;font-weight:700;color:${!p.price||p.price===0?'#10d98e':'#3d8ef8'}">${!p.price||p.price===0?'FREE':'₹'+p.price}</td>
                  <td style="padding:8px 12px;color:var(--text2)">${p.download_count||p.sales||0}</td>
                  <td style="padding:8px 12px;color:#f59e0b">${p.rating?'⭐ '+parseFloat(p.rating).toFixed(1):'—'}</td>
                  <td style="padding:8px 12px">
                    <span style="padding:2px 8px;border-radius:6px;font-size:.62rem;font-weight:700;${(p.status||'published')==='published'?'background:rgba(16,217,142,0.15);color:#10d98e':'background:rgba(245,158,11,0.15);color:#f59e0b'}">${p.status||'published'}</span>
                  </td>
                  <td style="padding:8px 12px">
                    <div style="display:flex;gap:5px">
                      <button onclick="apEditPDF('${p.id}')" style="padding:5px 10px;border-radius:7px;background:rgba(61,142,248,0.15);color:#3d8ef8;border:1px solid rgba(61,142,248,0.25);font-size:.65rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">✏️ Edit</button>
                      <button onclick="openDetail('${p.id}')" style="padding:5px 10px;border-radius:7px;background:rgba(255,255,255,0.05);color:var(--text2);border:1px solid rgba(255,255,255,0.1);font-size:.65rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">👁 View</button>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${pdfs.length === 0 ? '<div style="padding:40px;text-align:center;color:var(--text2);font-size:.82rem">No PDFs loaded yet. Connect Supabase or add PDFs via the Advanced Manager.</div>' : ''}
          ${pdfs.length > 20 ? `<div style="padding:12px;text-align:center;color:var(--text2);font-size:.75rem">Showing 20 of ${pdfs.length} PDFs. Use <a onclick="switchAdminTab('pdfs')" style="color:var(--accent);cursor:pointer">Advanced Manager</a> for full list.</div>` : ''}
        </div>
      </div>`;

    window.lmFilterPDFTable = function() {
      const q = (document.getElementById('lmPDFSearch')?.value||'').toLowerCase();
      document.querySelectorAll('#lmPDFBody tr').forEach(tr => {
        const txt = tr.textContent.toLowerCase();
        tr.style.display = !q || txt.includes(q) ? '' : 'none';
      });
    };
  }

  function lmTabSections(body, S) {
    const sections = [
      {key:'section_continue', icon:'▶', name:'Continue Reading',   desc:'Show in-progress PDFs for logged-in users',    color:'#8b5cf6'},
      {key:'section_trending', icon:'🔥', name:'Trending This Week', desc:'Most downloaded PDFs this week',               color:'#ff4d6d'},
      {key:'section_mypdf',    icon:'📥', name:'My PDFs',           desc:'Purchased/owned PDFs for logged-in users',     color:'#10d98e'},
      {key:'section_ai',       icon:'🤖', name:'Recommended For You',desc:'AI-curated recommendations by rating',        color:'#8b5cf6'},
      {key:'section_new',      icon:'🆕', name:'New Arrivals',       desc:'Recently added PDFs sorted by date',          color:'#10d98e'},
      {key:'section_popular',  icon:'🏆', name:'Popular Downloads', desc:'All-time most downloaded PDFs',                color:'#f59e0b'},
      {key:'section_recent',   icon:'🕐', name:'Recently Viewed',   desc:'Browser history of viewed PDFs (per device)',  color:'#00c8e8'},
    ];
    body.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:4px">📋 Carousel Sections</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:16px">Toggle sections on/off. All changes are saved and applied immediately to the Library page.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${sections.map(sec => `
            <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:12px;transition:all .2s"
              onmouseover="this.style.borderColor='rgba(61,142,248,0.2)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.07)'">
              <span style="font-size:1.2rem;width:28px;text-align:center">${sec.icon}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:.8rem;font-weight:700;color:var(--text)">${sec.name}</div>
                <div style="font-size:.65rem;color:var(--text2);margin-top:2px">${sec.desc}</div>
              </div>
              <label class="bsf-admin-toggle">
                <input type="checkbox" ${S[sec.key]!==false?'checked':''} onchange="lmToggle('${sec.key}',this.checked);lmApplySectionVisibility('${sec.key}',this.checked)">
                <span class="bsf-at-slider"></span>
              </label>
            </div>`).join('')}
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">⚙️ Browse All Grid Settings</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:6px">Cards per row (desktop)</label>
            <select id="lmBooksPerShelf" style="width:100%;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
              ${[4,5,6,7,8,10,12].map(n=>`<option value="${n}" ${(S.books_per_shelf||8)==n?'selected':''}>${n} cards</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:6px">Default Sort</label>
            <select style="width:100%;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
              <option>Most Popular</option><option>Top Rated</option><option>Newest First</option>
            </select>
          </div>
        </div>
      </div>

      ${lmSaveBar()}`;

    window.lmApplySectionVisibility = function(key, show) {
      const map = {
        section_continue:'ottlibContinueSection', section_trending:'ottlibTrendingSection',
        section_mypdf:'ottlibMyPDFsSection', section_ai:'ottlibAISection',
        section_new:'ottlibNewSection', section_popular:'ottlibPopularSection',
        section_recent:'ottlibRecentSection'
      };
      const el = document.getElementById(map[key]);
      if (el) el.style.display = show ? '' : 'none';
    };
  }

  function lmTabRecommendations(body) {
    body.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:14px">🤖 AI Recommendation Engine</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:6px">Recommendation Algorithm</label>
            <select style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
              <option>⭐ Rating-Based (Default)</option>
              <option>🔥 Download-Based</option>
              <option>🎯 Category Affinity</option>
              <option>📖 Reading History</option>
            </select>
          </div>
          <div>
            <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:6px">Max Recommendations Shown</label>
            <select style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
              ${[6,8,10,12,15].map(n=>`<option ${n===10?'selected':''}>${n} items</option>`).join('')}
            </select>
          </div>
        </div>
        ${[
          ['Enable AI Banner', 'Show the purple AI recommendation banner in hero', 'show_ai_banner'],
          ['Category Boost', 'Boost PDFs from user\'s most-visited categories', 'ai_cat_boost'],
          ['Exclude Owned', 'Hide PDFs user already purchased from recommendations', 'ai_exclude_owned'],
          ['Show Confidence Score', 'Display match % on recommendation cards', 'ai_show_score'],
        ].map(([title, desc, key]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:11px;margin-bottom:8px">
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--text)">${title}</div>
              <div style="font-size:.65rem;color:var(--text2);margin-top:2px">${desc}</div>
            </div>
            <label class="bsf-admin-toggle">
              <input type="checkbox" checked onchange="lmToggle('${key}',this.checked)">
              <span class="bsf-at-slider"></span>
            </label>
          </div>`).join('')}
      </div>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">📌 Featured PDF Override</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:12px">Manually pin specific PDFs to the top of recommendation carousels.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap" id="lmPinnedWrap">
          ${(window.PDFS||[]).filter(p=>p.featured).slice(0,4).map(p=>`
            <div style="padding:6px 12px;border-radius:9px;background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.25);color:#c4b5fd;font-size:.72rem;font-weight:700;display:flex;align-items:center;gap:6px">
              📌 ${(p.title||'').substring(0,20)}${p.title&&p.title.length>20?'…':''}
              <button onclick="this.parentNode.remove()" style="border:none;background:none;color:#c4b5fd;cursor:pointer;font-size:.8rem">✕</button>
            </div>`).join('')}
        </div>
        <select id="lmPinSelect" style="margin-top:10px;width:100%;padding:10px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.78rem;outline:none">
          <option value="">— Pin a PDF to top of carousel —</option>
          ${(window.PDFS||[]).map(p=>`<option value="${p.id}">${p.title||'Untitled'}</option>`).join('')}
        </select>
        <button onclick="lmPinPDF()" style="margin-top:8px;padding:8px 16px;border-radius:9px;background:rgba(139,92,246,0.2);color:#c4b5fd;border:1px solid rgba(139,92,246,0.35);font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">📌 Pin Selected</button>
      </div>

      ${lmSaveBar()}`;
  }

  function lmTabStatistics(body, S) {
    body.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">📊 Hero Stats Strip</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:14px">Control which statistics appear in the Library hero section.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${[
            {key:'stat_total',     icon:'📚', name:'Total PDFs',      desc:'Total number of PDFs in library'},
            {key:'stat_cats',      icon:'🗂️', name:'Categories Count',desc:'Number of distinct categories'},
            {key:'stat_downloads', icon:'??', name:'Downloads Count', desc:'Total downloads across all PDFs'},
            {key:'stat_wishlist',  icon:'❤️', name:'Wishlist Count',  desc:'User\'s personal wishlist count'},
            {key:'stat_streak',    icon:'🔥', name:'Reading Streak',  desc:'User\'s consecutive reading days'},
          ].map(stat => `
            <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:12px">
              <span style="font-size:1.1rem">${stat.icon}</span>
              <div style="flex:1">
                <div style="font-size:.78rem;font-weight:700;color:var(--text)">${stat.name}</div>
                <div style="font-size:.64rem;color:var(--text2);margin-top:1px">${stat.desc}</div>
              </div>
              <label class="bsf-admin-toggle">
                <input type="checkbox" ${S[stat.key]!==false?'checked':''} onchange="lmToggle('${stat.key}',this.checked)">
                <span class="bsf-at-slider"></span>
              </label>
            </div>`).join('')}
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">📈 Live Stats Override</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:12px">Override displayed stats (useful for social proof).</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${[['Override Total PDFs','','lmStatOverTotal'],['Override Downloads','e.g. 12.5k','lmStatOverDownloads'],['Override Categories','','lmStatOverCats'],['Override Wishlist Total','','lmStatOverWish']].map(([lbl,ph,id])=>`
            <div>
              <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:5px">${lbl}</label>
              <input id="${id}" placeholder="${ph||'Leave blank to use live data'}" style="width:100%;padding:9px 12px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
            </div>`).join('')}
        </div>
      </div>

      ${lmSaveBar()}`;
  }

  function lmTabAchievements(body, S) {
    body.innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">🏅 Achievement System</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:14px">Gamify the library experience. Users earn badges and level up through reading activity.</div>
        <div>
          <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:6px">Level Names (comma-separated, unlocked at 0, 200, 400, 600, 800 score)</label>
          <input id="lmLevels" value="${(S.levels||['Novice','Scholar','Expert','Master','Legend']).join(', ')}"
            style="width:100%;padding:10px 13px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none;margin-bottom:12px">

          <label style="font-size:.7rem;color:var(--text2);font-weight:600;display:block;margin-bottom:10px">Active Badges</label>
          <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px">
            ${(S.badges||[]).map(b=>`
              <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:16px;background:rgba(61,142,248,0.1);border:1px solid rgba(61,142,248,0.25);color:#3d8ef8;font-size:.7rem;font-weight:700">
                ${b}
                <button onclick="this.parentNode.remove()" style="border:none;background:none;color:#3d8ef8;cursor:pointer">✕</button>
              </span>`).join('')}
          </div>
          <div style="display:flex;gap:8px">
            <input id="lmNewBadge" placeholder="e.g. 🌟 Star Student" style="flex:1;padding:9px 12px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:var(--font-body);font-size:.78rem;outline:none">
            <button onclick="lmAddBadge()" style="padding:9px 16px;border-radius:10px;background:rgba(61,142,248,0.2);color:#3d8ef8;border:1px solid rgba(61,142,248,0.35);font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">+ Add Badge</button>
          </div>
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:18px 20px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:12px">🔥 Reading Streak</div>
        ${[
          ['Show Streak Banner','Display fire streak banner when streak ≥ 3 days','show_streak'],
          ['Streak Rewards','Award badges for streak milestones (3, 7, 14, 30 days)','streak_rewards'],
          ['Streak Reset Notification','Notify users when they\'re about to break a streak','streak_notify'],
        ].map(([t,d,k])=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:11px;margin-bottom:8px">
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--text)">${t}</div>
              <div style="font-size:.65rem;color:var(--text2);margin-top:2px">${d}</div>
            </div>
            <label class="bsf-admin-toggle">
              <input type="checkbox" ${S[k]!==false?'checked':''} onchange="lmToggle('${k}',this.checked)">
              <span class="bsf-at-slider"></span>
            </label>
          </div>`).join('')}
      </div>

      ${lmSaveBar()}`;

    window.lmAddBadge = function() {
      const input = document.getElementById('lmNewBadge');
      const val = (input?.value||'').trim();
      if (!val) return;
      const wrap = input.previousElementSibling;
      const span = document.createElement('span');
      span.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:16px;background:rgba(61,142,248,0.1);border:1px solid rgba(61,142,248,0.25);color:#3d8ef8;font-size:.7rem;font-weight:700';
      span.innerHTML = `${val} <button onclick="this.parentNode.remove()" style="border:none;background:none;color:#3d8ef8;cursor:pointer">✕</button>`;
      wrap.appendChild(span);
      if (input) input.value = '';
    };
  }

  function lmSaveBar() {
    return `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-top:4px">
        <button onclick="lmSave()" id="lmSaveBtn"
          style="padding:13px 32px;background:linear-gradient(135deg,#3d8ef8,#00c8e8);border:none;border-radius:14px;color:#fff;font-size:.88rem;font-weight:700;cursor:pointer;font-family:var(--font-body);box-shadow:0 6px 20px rgba(61,142,248,0.35);display:flex;align-items:center;gap:8px;transition:all .2s">
          💾 Save Changes
        </button>
        <button onclick="navigate('library')"
          style="padding:13px 22px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:14px;color:var(--text2);font-size:.82rem;font-weight:700;cursor:pointer;font-family:var(--font-body);transition:all .2s">
          👁 Preview Library
        </button>
        <div id="lmSaveStatus" style="font-size:.78rem;color:var(--text2)"></div>
      </div>`;
  }

  // Render first tab
  lmSwitchTab(0);
}

// ══════════════════════════════════════════════════════════════════
// 💼 CAREER HUB MANAGER — Admin Panel
// ══════════════════════════════════════════════════════════════════
window._chAdmin = { jobs: [], editingId: null, search: '', filter: 'all' };

async function renderAdminCareerHubManager(main) {
  main.innerHTML = `
  <style>
  .chm-toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:18px; }
  .chm-toolbar-left { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .chm-search { padding:9px 14px; border-radius:var(--radius-sm); border:1px solid var(--glass-border); background:var(--glass); color:var(--text); font-family:var(--font-body); font-size:.84rem; outline:none; width:240px; }
  .chm-search:focus { border-color:var(--accent); }
  .chm-filter-select { padding:9px 12px; border-radius:var(--radius-sm); border:1px solid var(--glass-border); background:var(--glass); color:var(--text2); font-size:.82rem; font-family:var(--font-body); outline:none; cursor:pointer; }
  .chm-flag-pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:100px; font-size:.68rem; font-weight:700; cursor:pointer; border:1px solid var(--glass-border); background:var(--surface); color:var(--text2); transition:all .15s; user-select:none; }
  .chm-flag-pill.on.featured { background:rgba(245,158,11,.14); color:var(--gold); border-color:rgba(245,158,11,.3); }
  .chm-flag-pill.on.trending { background:rgba(255,77,109,.14); color:var(--danger); border-color:rgba(255,77,109,.3); }
  .chm-flag-pill.on.urgent { background:var(--grad-warm); color:#fff; border-color:transparent; }
  .chm-row-title { font-weight:700; font-size:.85rem; color:var(--text); margin-bottom:2px; }
  .chm-row-sub { font-size:.72rem; color:var(--text3); }
  .chm-empty-cell { color:var(--text3); font-size:.78rem; }
  </style>

  <div class="admin-section" style="animation:dashFadeUp .35s ease both">
    <div class="admin-section-title" style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#chmGrad)" stroke-width="2">
        <defs><linearGradient id="chmGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d8ef8"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient></defs>
        <circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>
      </svg>
      💼 Career Hub Manager
    </div>
    <p style="color:var(--text2);font-size:.82rem;margin-bottom:20px">
      Manage jobs, badges (Featured / Trending / Urgent), and the full 15-section structured job content shown in the premium Job Detail experience.
    </p>

    <div id="chmFormHost"></div>

    <div class="admin-table-card">
      <div class="admin-table-header">
        <div class="chm-toolbar-left">
          <div style="font-size:.9rem;font-weight:700">All Jobs <span id="chmJobCount" style="color:var(--text2);font-weight:500"></span></div>
        </div>
        <div class="chm-toolbar-left">
          <input class="chm-search" id="chmSearch" placeholder="Search jobs…" oninput="chmFilterTable()" />
          <select class="chm-filter-select" id="chmFilter" onchange="chmFilterTable()">
            <option value="all">All Jobs</option>
            <option value="featured">Featured</option>
            <option value="trending">Trending</option>
            <option value="urgent">Urgent</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="chmOpenForm(null)">+ Add Job</button>
          <button class="btn btn-secondary btn-sm" style="background:rgba(139,92,246,0.15);border-color:rgba(139,92,246,0.4);color:#a78bfa" onclick="csPostersBulkGenerate()" title="Generate posters for all jobs that don't have one yet">🎨 Generate All Posters</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table" style="width:100%;min-width:760px">
          <thead><tr>
            <th>Job</th><th>Category</th><th>Last Date</th><th>Badges</th><th>Active</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody id="chmTableBody"><tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">Loading jobs…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>`;

  await chmLoadJobs();
}

async function chmLoadJobs() {
  const sb = window.supabaseClient;
  const tbody = document.getElementById('chmTableBody');
  if (!sb) { if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--danger)">Supabase not connected.</td></tr>`; return; }
  try {
    const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    window._chAdmin.jobs = data || [];
    chmFilterTable();
  } catch (err) {
    console.error('Career Hub Manager: load failed', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--danger)">Failed to load: ${(err.message||'').replace(/</g,'&lt;')}</td></tr>`;
  }
}

function chmFilterTable() {
  const search = (document.getElementById('chmSearch')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('chmFilter')?.value || 'all';
  let jobs = [...(window._chAdmin.jobs || [])];

  if (filter === 'featured')  jobs = jobs.filter(j => j.featured);
  if (filter === 'trending')  jobs = jobs.filter(j => j.is_trending);
  if (filter === 'urgent')    jobs = jobs.filter(j => j.is_urgent);
  if (filter === 'active')    jobs = jobs.filter(j => j.active !== false);
  if (filter === 'inactive')  jobs = jobs.filter(j => j.active === false);

  if (search) {
    jobs = jobs.filter(j => (j.title||'').toLowerCase().includes(search) || (j.org||'').toLowerCase().includes(search));
  }

  const countEl = document.getElementById('chmJobCount');
  if (countEl) countEl.textContent = `(${jobs.length})`;

  const tbody = document.getElementById('chmTableBody');
  if (!tbody) return;
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">No jobs found.</td></tr>`;
    return;
  }
  tbody.innerHTML = jobs.map(chmRowHTML).join('');
}

function chmRowHTML(j) {
  const cats = Array.isArray(j.category) ? j.category.join(', ') : (j.category || '');
  const badges = [
    j.featured    ? '<span class="chm-flag-pill on featured">⭐ Featured</span>' : '',
    j.is_trending ? '<span class="chm-flag-pill on trending">🔥 Trending</span>' : '',
    j.is_urgent   ? '<span class="chm-flag-pill on urgent">⚡ Urgent</span>' : '',
  ].filter(Boolean).join(' ') || '<span class="chm-empty-cell">—</span>';

  return `
  <tr>
    <td>
      <div class="chm-row-title">${(j.title||'').replace(/</g,'&lt;')}</div>
      <div class="chm-row-sub">${(j.org||'').replace(/</g,'&lt;')}
        ${j.poster_generated
          ? `<span title="Poster ready" style="color:#10d98e;font-size:.65rem;margin-left:4px">● poster</span>`
          : `<span title="No poster yet" style="color:#f59e0b;font-size:.65rem;margin-left:4px">○ no poster</span>`
        }
      </div>
    </td>
    <td><span class="chm-row-sub">${cats.replace(/</g,'&lt;') || '—'}</span></td>
    <td><span class="chm-row-sub">${j.last_date || 'Ongoing'}</span></td>
    <td>${badges}</td>
    <td>
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" ${j.active !== false ? 'checked' : ''} onchange="chmToggleField('${j.id}','active',this.checked)">
      </label>
    </td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="chmOpenForm('${j.id}')" title="Edit">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="chmToggleQuickFlag('${j.id}','featured')" title="Toggle Featured">⭐</button>
      <button class="btn btn-ghost btn-sm" onclick="chmToggleQuickFlag('${j.id}','is_trending')" title="Toggle Trending">🔥</button>
      <button class="btn btn-ghost btn-sm" onclick="chmToggleQuickFlag('${j.id}','is_urgent')" title="Toggle Urgent">⚡</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="chmDeleteJob('${j.id}')" title="Delete">🗑️</button>
      <button class="btn btn-ghost btn-sm" onclick="chmRegeneratePoster('${j.id}', this)" title="Regenerate Poster">🖼</button>
    </td>
  </tr>`;
}

async function chmToggleField(id, field, value) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { error } = await sb.from('jobs').update({ [field]: value }).eq('id', id);
    if (error) throw error;
    const job = window._chAdmin.jobs.find(j => j.id === id);
    if (job) job[field] = value;
    if (typeof showToast === 'function') showToast('Updated ✓', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast('Update failed: ' + (err.message||''), 'error');
  }
}

async function chmToggleQuickFlag(id, field) {
  const job = window._chAdmin.jobs.find(j => j.id === id);
  if (!job) return;
  const next = !job[field];
  await chmToggleField(id, field, next);
  chmFilterTable();
}

async function chmDeleteJob(id) {
  if (!confirm('Delete this job permanently? This cannot be undone.')) return;
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { error } = await sb.from('jobs').delete().eq('id', id);
    if (error) throw error;
    window._chAdmin.jobs = window._chAdmin.jobs.filter(j => j.id !== id);
    chmFilterTable();
    if (typeof showToast === 'function') showToast('Job deleted', 'info');
  } catch (err) {
    if (typeof showToast === 'function') showToast('Delete failed: ' + (err.message||''), 'error');
  }
}

/* ── Single-job poster (re)generation from admin table ──────────────
   Called by the 🖼 button in every job row.                           */
async function chmRegeneratePoster(jobId, btn) {
  const sb = window.supabaseClient;
  if (!sb) { if (typeof showToast==='function') showToast('Supabase not ready','error'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    // Fetch the job record so csGeneratePoster has the full object
    const { data: job, error: fetchErr } = await sb.from('jobs')
      .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,poster_url')
      .eq('id', jobId).maybeSingle();
    if (fetchErr || !job) throw fetchErr || new Error('Job not found');

    // Force-clear the cache so a fresh canvas image is generated
    if (window._csPosterCache) window._csPosterCache.delete('poster_' + job.id);

    // Use the in-page Canvas generator (defined inside the Career Spotlight IIFE).
    // csGeneratePoster() uploads to Storage + updates the DB as a side-effect.
    if (typeof window._csGeneratePoster === 'function') {
      window._csGeneratePoster(job);
    } else {
      // csGeneratePoster is scoped inside the IIFE — trigger via the refresh hook
      // which re-calls csLoad.  The poster images are regenerated on demand there.
      if (typeof window._csRefresh === 'function') window._csRefresh();
    }

    if (typeof showToast==='function') showToast('Poster generation started for: ' + (job.title||jobId), 'info');
    // Refresh the admin table after a short delay so the indicator updates
    setTimeout(() => { chmFilterTable(); }, 4000);
  } catch(err) {
    if (typeof showToast==='function') showToast('Poster regen failed: ' + (err.message||''), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🖼'; }
  }
}

/* ── Bulk poster generation — generates posters for ALL active jobs ──
   Exposed as window.csPostersBulkGenerate so admin scripts can call it.
   Iterates jobs in batches of 5 to avoid flooding the browser.        */
window.csPostersBulkGenerate = async function() {
  const sb = window.supabaseClient;
  if (!sb) { console.error('[BulkPoster] supabaseClient not ready'); return; }

  // Fetch all active jobs that do NOT yet have a real poster
  const { data: jobs, error } = await sb.from('jobs')
    .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,poster_url,poster_generated')
    .eq('active', true)
    .or('poster_generated.is.null,poster_generated.eq.false')
    .order('created_at', { ascending: false });

  if (error) { console.error('[BulkPoster] fetch error:', error); return; }
  if (!jobs || !jobs.length) { console.log('[BulkPoster] All jobs already have posters ✅'); return; }

  console.log('[BulkPoster] Generating posters for', jobs.length, 'jobs…');
  if (typeof showToast === 'function') showToast(`Generating posters for ${jobs.length} jobs…`, 'info');

  /* Helper: generate one poster using the in-page canvas engine */
  async function generateOne(job) {
    // Clear any stale cache
    if (window._csPosterCache) window._csPosterCache.delete('poster_' + job.id);

    // Invoke the Career Spotlight canvas generator
    // csGeneratePoster is scoped to the IIFE so we use the exposed helper if available
    const genFn = window._csGeneratePoster || (window._csPosterCache && (() => {
      // Fallback: fabricate a minimal canvas poster (same logic as csGeneratePoster)
      return null;
    }));

    if (!genFn) {
      console.warn('[BulkPoster] csGeneratePoster not exposed; call window._csRefresh instead');
      return;
    }
    genFn(job);  // upload + DB update happen as async side-effect inside the fn
    await new Promise(r => setTimeout(r, 300)); // brief pause between posters
  }

  // Process in batches of 5
  const BATCH = 5;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    await Promise.all(batch.map(generateOne));
    console.log('[BulkPoster] Progress:', Math.min(i + BATCH, jobs.length), '/', jobs.length);
  }

  console.log('[BulkPoster] ✅ All posters generated. Refreshing carousel…');
  if (typeof window._csRefresh === 'function') window._csRefresh();
  if (typeof showToast === 'function') showToast('All posters generated ✅ Premium Opportunities updated.', 'success');
};

// ── Add / Edit Form ─────────────────────────────────────────────────
function chmOpenForm(id) {
  window._chAdmin.editingId = id;
  const job = id ? window._chAdmin.jobs.find(j => j.id === id) : null;
  const v = (f, fb) => (job && job[f] != null ? job[f] : (fb != null ? fb : ''));
  const catVal = job && Array.isArray(job.category) ? job.category.join(', ') : '';

  const host = document.getElementById('chmFormHost');
  if (!host) return;

  host.innerHTML = `
  <div class="ap-card" id="chmFormCard" style="margin-bottom:20px">
    <div class="ap-card-header">
      <div class="ap-card-title"><span class="ap-card-icon ap-icon-blue">${job ? '✏️' : '➕'}</span> ${job ? 'Edit Job' : 'Add New Job'}</div>
      <button class="btn btn-ghost btn-sm" onclick="chmCloseForm()">✕ Close</button>
    </div>

    <div class="ap-card-title" style="font-size:.78rem;color:var(--text2);margin-bottom:10px">Basic Details</div>
    <div class="ap-grid-2" style="margin-bottom:14px">
      <div class="ap-field"><label class="ap-label">Job Title<span class="ap-req">*</span></label><input class="ap-input" id="chmTitle" value="${chmAttr(v('title'))}" placeholder="e.g. SSC CGL 2026"></div>
      <div class="ap-field"><label class="ap-label">Organization</label><input class="ap-input" id="chmOrg" value="${chmAttr(v('org'))}" placeholder="e.g. Staff Selection Commission"></div>
    </div>
    <div class="ap-field" style="margin-bottom:14px"><label class="ap-label">Full Organization Name <span style="color:var(--text3);font-weight:400">(shown on Job Detail page header — falls back to Organization above if left empty)</span></label><input class="ap-input" id="chmOrganization" value="${chmAttr(v('organization'))}" placeholder="e.g. Staff Selection Commission, Government of India"></div>
    <div class="ap-grid-3" style="margin-bottom:14px">
      <div class="ap-field"><label class="ap-label">Org Icon (emoji)</label><input class="ap-input" id="chmOrgIcon" value="${chmAttr(v('org_icon','💼'))}"></div>
      <div class="ap-field"><label class="ap-label">Location / State</label><input class="ap-input" id="chmLocation" value="${chmAttr(v('location'))}" placeholder="Assam / National"></div>
      <div class="ap-field"><label class="ap-label">Qualification</label><input class="ap-input" id="chmQualification" value="${chmAttr(v('qualification'))}" placeholder="Graduate"></div>
    </div>
    <div class="ap-grid-3" style="margin-bottom:14px">
      <div class="ap-field"><label class="ap-label">Salary</label><input class="ap-input" id="chmSalary" value="${chmAttr(v('salary'))}" placeholder="₹25,000 - ₹81,000"></div>
      <div class="ap-field"><label class="ap-label">Last Date</label><input class="ap-input" id="chmLastDate" type="date" value="${chmAttr(v('last_date'))}"></div>
      <div class="ap-field"><label class="ap-label">Total Posts / Vacancies</label><input class="ap-input" id="chmVacancies" type="number" value="${chmAttr(v('vacancies'))}"></div>
    </div>
    <div class="ap-grid-3" style="margin-bottom:14px">
      <div class="ap-field"><label class="ap-label">Category (comma-separated)</label><input class="ap-input" id="chmCategory" value="${chmAttr(catVal)}" placeholder="govt, assam, ssc"></div>
      <div class="ap-field"><label class="ap-label">Job Type</label>
        <select class="ap-input" id="chmJobType">
          ${['','government','private','scholarship','internship'].map(t => `<option value="${t}" ${v('job_type')===t?'selected':''}>${t || '— Select —'}</option>`).join('')}
        </select>
      </div>
      <div class="ap-field"><label class="ap-label">Application Mode</label>
        <select class="ap-input" id="chmApplicationMode">
          ${['','Online','Offline','Both'].map(t => `<option value="${t}" ${v('application_mode')===t?'selected':''}>${t || '— Select —'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="ap-field" style="margin-bottom:14px"><label class="ap-label">Apply URL</label><input class="ap-input" id="chmApplyUrl" value="${chmAttr(v('apply_url'))}" placeholder="https://..."></div>
    <div class="ap-field" style="margin-bottom:18px"><label class="ap-label">Overview / Description</label><textarea class="ap-input" id="chmDescription" rows="3">${chmText(v('description'))}</textarea></div>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;padding:14px;background:rgba(255,255,255,.02);border-radius:var(--radius-sm)">
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.82rem"><input type="checkbox" id="chmFlagFeatured" ${job&&job.featured?'checked':''}> ⭐ Featured</label>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.82rem"><input type="checkbox" id="chmFlagTrending" ${job&&job.is_trending?'checked':''}> 🔥 Trending</label>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.82rem"><input type="checkbox" id="chmFlagUrgent" ${job&&job.is_urgent?'checked':''}> ⚡ Urgent</label>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:.82rem"><input type="checkbox" id="chmFlagActive" ${!job||job.active!==false?'checked':''}> ✅ Active</label>
    </div>

    <div class="ap-card-title" style="font-size:.78rem;color:var(--text2);margin-bottom:10px">Full Article <span style="color:var(--text3);font-weight:400">(complete cleaned notification — rendered as the main detailed content on the Job Detail page; HTML allowed)</span></div>
    <div class="ap-field" style="margin-bottom:18px"><textarea class="ap-input" id="chmArticleContent" rows="10" placeholder="Paste the full cleaned article HTML/content here (auto-filled by the Pipedream import pipeline for RSS jobs)">${chmText(v('article_content'))}</textarea></div>

    <div class="ap-card-title" style="font-size:.78rem;color:var(--text2);margin-bottom:10px">Structured Job Detail Sections <span style="color:var(--text3);font-weight:400">(optional — empty sections auto-hide; shown as Quick Summary above the full article)</span></div>
    ${chmTextareaField('chmVacancyDetails','Vacancy Details', v('vacancy_details'))}
    ${chmTextareaField('chmEligibility','Eligibility Criteria', v('eligibility'))}
    ${chmTextareaField('chmAgeLimit','Age Limit', v('age_limit'))}
    ${chmTextareaField('chmQualDetails','Educational Qualification (detailed)', v('qualification_details'))}
    ${chmTextareaField('chmSelectionProcess','Selection Process', v('selection_process'))}
    ${chmTextareaField('chmSalaryDetails','Salary Details', v('salary_details'))}
    ${chmTextareaField('chmApplicationFee','Application Fee', v('application_fee'))}
    ${chmTextareaField('chmImportantDates','Important Dates', v('important_dates'))}
    ${chmTextareaField('chmRequiredDocs','Required Documents', v('required_documents'))}
    ${chmTextareaField('chmExamPattern','Exam Pattern', v('exam_pattern'))}
    ${chmTextareaField('chmSyllabus','Syllabus', v('syllabus'))}
    ${chmTextareaField('chmHowToApply','How To Apply', v('how_to_apply'))}
    ${chmTextareaField('chmFaq','FAQs (one per line, e.g. "Q: ... A: ...")', v('faq'))}

    <div class="ap-card-title" style="font-size:.78rem;color:var(--text2);margin:18px 0 10px">Important Links</div>
    <div class="ap-grid-2" style="margin-bottom:10px">
      <div class="ap-field"><label class="ap-label">Registration Link</label><input class="ap-input" id="chmRegistrationLink" value="${chmAttr(v('registration_link'))}"></div>
      <div class="ap-field"><label class="ap-label">Login Link</label><input class="ap-input" id="chmLoginLink" value="${chmAttr(v('login_link'))}"></div>
    </div>
    <div class="ap-grid-2" style="margin-bottom:10px">
      <div class="ap-field"><label class="ap-label">Notification PDF</label><input class="ap-input" id="chmNotificationLink" value="${chmAttr(v('notification_link'))}"></div>
      <div class="ap-field"><label class="ap-label">Official Website</label><input class="ap-input" id="chmOfficialWebsite" value="${chmAttr(v('official_website'))}"></div>
    </div>
    <div class="ap-grid-3" style="margin-bottom:18px">
      <div class="ap-field"><label class="ap-label">Syllabus Link</label><input class="ap-input" id="chmSyllabusLink" value="${chmAttr(v('syllabus_link'))}"></div>
      <div class="ap-field"><label class="ap-label">Admit Card Link</label><input class="ap-input" id="chmAdmitCardLink" value="${chmAttr(v('admit_card_link'))}"></div>
      <div class="ap-field"><label class="ap-label">Result Link</label><input class="ap-input" id="chmResultLink" value="${chmAttr(v('result_link'))}"></div>
    </div>

    <div style="display:flex;gap:10px">
      <button class="btn btn-primary" onclick="chmSaveJob()">${job ? 'Save Changes' : 'Publish Job'}</button>
      <button class="btn btn-ghost" onclick="chmCloseForm()">Cancel</button>
    </div>
  </div>`;

  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function chmTextareaField(id, label, value) {
  return `<div class="ap-field" style="margin-bottom:12px"><label class="ap-label">${label}</label><textarea class="ap-input" id="${id}" rows="2" placeholder="Leave empty to hide this section">${chmText(value)}</textarea></div>`;
}
function chmAttr(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
function chmText(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

function chmCloseForm() {
  window._chAdmin.editingId = null;
  const host = document.getElementById('chmFormHost');
  if (host) host.innerHTML = '';
}

async function chmSaveJob() {
  const sb = window.supabaseClient;
  if (!sb) { if (typeof showToast === 'function') showToast('Supabase not connected', 'error'); return; }

  const title = document.getElementById('chmTitle')?.value.trim();
  if (!title) { if (typeof showToast === 'function') showToast('Job title is required', 'error'); return; }

  const catRaw = document.getElementById('chmCategory')?.value || '';
  const category = catRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const payload = {
    title,
    org:              document.getElementById('chmOrg')?.value.trim() || null,
    organization:     document.getElementById('chmOrganization')?.value.trim() || null,
    org_icon:         document.getElementById('chmOrgIcon')?.value.trim() || null,
    location:         document.getElementById('chmLocation')?.value.trim() || null,
    qualification:    document.getElementById('chmQualification')?.value.trim() || null,
    salary:           document.getElementById('chmSalary')?.value.trim() || null,
    last_date:        document.getElementById('chmLastDate')?.value || null,
    vacancies:        document.getElementById('chmVacancies')?.value ? parseInt(document.getElementById('chmVacancies').value, 10) : null,
    category,
    job_type:         document.getElementById('chmJobType')?.value || null,
    application_mode: document.getElementById('chmApplicationMode')?.value || null,
    apply_url:        document.getElementById('chmApplyUrl')?.value.trim() || null,
    description:      document.getElementById('chmDescription')?.value.trim() || null,
    featured:         !!document.getElementById('chmFlagFeatured')?.checked,
    is_trending:      !!document.getElementById('chmFlagTrending')?.checked,
    is_urgent:        !!document.getElementById('chmFlagUrgent')?.checked,
    active:           !!document.getElementById('chmFlagActive')?.checked,

    vacancy_details:       document.getElementById('chmVacancyDetails')?.value.trim() || null,
    article_content:       document.getElementById('chmArticleContent')?.value.trim() || null,
    eligibility:            document.getElementById('chmEligibility')?.value.trim() || null,
    age_limit:               document.getElementById('chmAgeLimit')?.value.trim() || null,
    qualification_details:   document.getElementById('chmQualDetails')?.value.trim() || null,
    selection_process:       document.getElementById('chmSelectionProcess')?.value.trim() || null,
    salary_details:          document.getElementById('chmSalaryDetails')?.value.trim() || null,
    application_fee:         document.getElementById('chmApplicationFee')?.value.trim() || null,
    important_dates:         document.getElementById('chmImportantDates')?.value.trim() || null,
    required_documents:      document.getElementById('chmRequiredDocs')?.value.trim() || null,
    exam_pattern:            document.getElementById('chmExamPattern')?.value.trim() || null,
    syllabus:                document.getElementById('chmSyllabus')?.value.trim() || null,
    how_to_apply:            document.getElementById('chmHowToApply')?.value.trim() || null,
    faq:                      document.getElementById('chmFaq')?.value.trim() || null,

    registration_link:  document.getElementById('chmRegistrationLink')?.value.trim() || null,
    login_link:           document.getElementById('chmLoginLink')?.value.trim() || null,
    notification_link:    document.getElementById('chmNotificationLink')?.value.trim() || null,
    official_website:     document.getElementById('chmOfficialWebsite')?.value.trim() || null,
    syllabus_link:        document.getElementById('chmSyllabusLink')?.value.trim() || null,
    admit_card_link:      document.getElementById('chmAdmitCardLink')?.value.trim() || null,
    result_link:           document.getElementById('chmResultLink')?.value.trim() || null,
  };

  const id = window._chAdmin.editingId;
  try {
    let error;
    if (id) {
      ({ error } = await sb.from('jobs').update(payload).eq('id', id));
      // Regenerate poster when key visual fields change
      const _posterFields = ['title','org','org_icon','job_type','category','location','salary'];
      const _needsRegen   = _posterFields.some(f => payload[f] !== undefined);
      if (!error && _needsRegen && typeof window.csPosterRegenerate === 'function') {
        window.csPosterRegenerate(id).catch(() => {});
      }
    } else {
      payload.source = 'manual';
      const { data: insertedRow, error: insertErr } = await sb.from('jobs').insert(payload).select().single();
      error = insertErr;
      // Trigger poster generation immediately after publish
      if (!error && insertedRow && typeof window.csPosterOnPublish === 'function') {
        window.csPosterOnPublish(insertedRow);
      }
    }
    if (error) throw error;
    if (typeof showToast === 'function') showToast(id ? 'Job updated ✓' : 'Job published ✓', 'success');
    chmCloseForm();
    await chmLoadJobs();
  } catch (err) {
    console.error('Career Hub Manager: save failed', err);
    if (typeof showToast === 'function') showToast('Save failed: ' + (err.message || ''), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// 🌐 COMMUNITY HUB — Frontend Loader
// Loads community_links from Supabase and renders on homepage
// ══════════════════════════════════════════════════════════════════

// Default fallback links (used if DB not set up yet)
const COMMUNITY_DEFAULTS = [
  { id: 'wa-community', title: 'WhatsApp Community', description: 'Join our main group', icon: '💬', color: '#25d366', url: 'https://chat.whatsapp.com/EpuIk7lT0gE86dCTDjWE5R', enabled: true, is_primary: true, sort_order: 1 },
  { id: 'telegram',     title: 'Telegram',           description: 'Daily updates',        icon: '✈️', color: '#0088cc', url: 'https://t.me/studyria',                                      enabled: true, is_primary: false, sort_order: 2 },
  { id: 'wa-channel',   title: 'WhatsApp Channel',   description: 'News & alerts',         icon: '📢', color: '#25d366', url: 'https://whatsapp.com/channel/studyria',                     enabled: true, is_primary: false, sort_order: 3 },
  { id: 'facebook',     title: 'Facebook',           description: 'Follow our page',       icon: '📘', color: '#1877f2', url: 'https://facebook.com/studyria',                             enabled: true, is_primary: false, sort_order: 4 },
  { id: 'instagram',    title: 'Instagram',          description: 'Reels & stories',       icon: '📸', color: '#e1306c', url: 'https://instagram.com/studyria',                            enabled: true, is_primary: false, sort_order: 5 },
  { id: 'discord',      title: 'Discord',            description: 'Live chat & help',      icon: '🎮', color: '#5865f2', url: 'https://discord.gg/studyria',                               enabled: true, is_primary: false, sort_order: 6 },
  { id: 'youtube',      title: 'YouTube',            description: 'Video lessons',         icon: '▶️', color: '#ff0000', url: 'https://youtube.com/@studyria',                             enabled: true, is_primary: false, sort_order: 7 },
];

// Color map for icon backgrounds
function _chIconBg(color) {
  const hex = color || '#3d8ef8';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},0.15)`;
}
function _chIconBorder(color) {
  const hex = color || '#3d8ef8';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},0.25)`;
}

async function loadCommunityHub() {
  const section = document.getElementById('communityHubSection');
  const grid = document.getElementById('communityHubGrid');
  if (!grid) return;

  let links = [];
  let sectionEnabled = true;

  try {
    const sb = window.supabaseClient;
    if (sb) {
      // Load section settings
      const { data: settings } = await sb.from('community_links')
        .select('*')
        .order('sort_order', { ascending: true });
      if (settings && settings.length > 0) {
        links = settings.filter(l => l.enabled);
      } else {
        links = COMMUNITY_DEFAULTS.filter(l => l.enabled);
      }
      // Check if section itself is hidden via a special sentinel row
      const sentinel = (settings || []).find(l => l.id === '__section_hidden__');
      if (sentinel) sectionEnabled = false;
    } else {
      links = COMMUNITY_DEFAULTS.filter(l => l.enabled);
    }
  } catch(e) {
    console.warn('Community Hub: DB load failed, using defaults', e);
    links = COMMUNITY_DEFAULTS.filter(l => l.enabled);
  }

  if (!sectionEnabled && section) { section.style.display = 'none'; return; }

  if (links.length === 0) {
    grid.innerHTML = '';
    return;
  }

  // Render
  const primary = links.find(l => l.is_primary);
  const rest = links.filter(l => !l.is_primary);

  let html = '<div class="community-hub-grid">';

  // Primary button (full-width)
  if (primary) {
    html += `<a href="${primary.url}" target="_blank" rel="noopener noreferrer" class="ch-btn ch-primary"
      style="animation-delay:.05s"
      onclick="trackCommunityClick('${primary.id}')">
      <div class="ch-icon" style="background:${_chIconBg(primary.color)};border-color:${_chIconBorder(primary.color)}">
        ${primary.icon}
      </div>
      <div class="ch-btn-text">
        <span class="ch-btn-label">${primary.title}</span>
        <span class="ch-btn-desc">${primary.description || ''}</span>
      </div>
      <span class="ch-members-badge"><span style="width:5px;height:5px;border-radius:50%;background:#25d366;display:inline-block;box-shadow:0 0 4px #25d366"></span>Join Now</span>
      <span class="ch-btn-arrow">→</span>
    </a>`;
  }

  // Secondary buttons
  rest.forEach((link, i) => {
    html += `<a href="${link.url}" target="_blank" rel="noopener noreferrer" class="ch-btn"
      style="animation-delay:${.08 + i*.06}s;--ch-shadow:${link.color}33;--ch-border:${link.color}44"
      onclick="trackCommunityClick('${link.id}')">
      <div class="ch-icon" style="background:${_chIconBg(link.color)};border-color:${_chIconBorder(link.color)}">
        ${link.icon}
      </div>
      <div class="ch-btn-text">
        <span class="ch-btn-label">${link.title}</span>
        <span class="ch-btn-desc">${link.description || ''}</span>
      </div>
      <span class="ch-btn-arrow">→</span>
    </a>`;
  });

  html += '</div>';
  grid.innerHTML = html;
}

function trackCommunityClick(id) {
  // Silent analytics — fire and forget
  try {
    const sb = window.supabaseClient;
    if (sb) {
      sb.rpc('increment_community_clicks', { link_id: id }).catch(() => {});
    }
  } catch(e) {}
}

// Auto-load when DOM ready
(function() {
  function tryLoadCommunity() {
    if (document.getElementById('communityHubGrid')) {
      loadCommunityHub();
    } else {
      setTimeout(tryLoadCommunity, 300);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryLoadCommunity);
  } else {
    tryLoadCommunity();
  }
})();

// ══════════════════════════════════════════════════════════════════
// 📱 WHATSAPP COMMUNITY — Admin Panel (broadcast to your WA community)
// ══════════════════════════════════════════════════════════════════

function renderAdminWhatsAppCommunity(main) {
  main.innerHTML = `
  <div class="admin-section" style="animation:dashFadeUp .35s ease both">
    <div class="admin-section-title">📱 WhatsApp Community</div>
    <div class="admin-section-sub">Send announcements straight to your WhatsApp community / channel members.</div>

    <div class="mod-form-wrap" style="margin-bottom:14px">
      <div style="font-weight:700;color:#25d366;margin-bottom:14px">🔗 Community Invite Link</div>
      <div class="form-group">
        <label class="form-label">Invite Link</label>
        <input class="form-input" id="waInviteLink" placeholder="https://chat.whatsapp.com/EpuIk7lT0gE86dCTDjWE5R" value="https://chat.whatsapp.com/EpuIk7lT0gE86dCTDjWE5R"/>
        <div class="form-hint">Used as the fallback link in test/broadcast messages and copy actions below.</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="waCopyInviteLink()">📋 Copy Link</button>
        <button class="btn btn-ghost btn-sm" onclick="window.open(document.getElementById('waInviteLink').value,'_blank')">🔗 Open Community</button>
      </div>
    </div>

    <div class="mod-form-wrap" style="margin-bottom:14px">
      <div style="font-weight:700;color:#25d366;margin-bottom:14px">📨 Compose Message</div>
      <div class="form-group"><label class="form-label">Message Title</label><input class="form-input" id="waMsgTitle" placeholder="📚 New JEE 2026 Notes Are Live!" maxlength="80"/></div>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Message</label><textarea class="form-input" id="waMsgBody" rows="3" placeholder="Fresh JEE Main 2026 notes just dropped on Studyria. Tap to grab your copy 👇"></textarea></div>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Image URL</label><input class="form-input" id="waMsgImage" placeholder="https://studyria.com/banners/jee-2026.jpg"/></div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="waTestBtn" onclick="waSendTest()">📱 Send Test</button>
        <button class="btn btn-primary btn-sm" id="waSendBtn" onclick="waSendCommunityMessage()">📢 Send Community Message</button>
      </div>
      <div id="waStatusMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
    </div>

    <div class="mod-form-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-weight:700">📜 Broadcast History</div>
        <button class="btn btn-ghost btn-sm" onclick="waLoadHistory()">🔄 Refresh</button>
      </div>
      <div id="waHistoryList" style="font-size:.8rem;color:var(--text2)">Loading…</div>
    </div>
  </div>`;

  waLoadHistory();
}

function waCopyInviteLink() {
  const link = document.getElementById('waInviteLink')?.value?.trim();
  if (!link) return;
  navigator.clipboard?.writeText(link).then(() => {
    showToast('Invite link copied!', 'success');
  }).catch(() => {
    showToast('Could not copy — copy it manually.', 'error');
  });
}

function waReadForm() {
  return {
    inviteLink: document.getElementById('waInviteLink')?.value?.trim() || null,
    title:      document.getElementById('waMsgTitle')?.value?.trim() || '',
    message:    document.getElementById('waMsgBody')?.value?.trim() || '',
    imageUrl:   document.getElementById('waMsgImage')?.value?.trim() || null,
  };
}

function waShowStatus(msg, type) {
  const el = document.getElementById('waStatusMsg');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : 'var(--text2)');
  el.textContent = msg;
}

async function waSendTest() {
  const { inviteLink, title, message, imageUrl } = waReadForm();
  if (!title || !message) { showToast('Enter a title and message first.', 'error'); return; }

  const btn = document.getElementById('waTestBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }
  try {
    if (typeof window.sendWhatsAppCommunityMessage !== 'function') throw new Error('WhatsApp backend not loaded');
    const row = await window.sendWhatsAppCommunityMessage({ inviteLink, title, message, imageUrl, isTest: true });
    if (row) { waShowStatus('📱 Test message sent.', 'success'); showToast('Test message sent!', 'success'); }
    else { waShowStatus('Test send failed — check your Pipedream webhook config.', 'error'); }
  } catch (e) {
    waShowStatus('Error: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '📱 Send Test'; }
  waLoadHistory();
}

async function waSendCommunityMessage() {
  const { inviteLink, title, message, imageUrl } = waReadForm();
  if (!title || !message) { showToast('Enter a title and message.', 'error'); return; }
  if (!confirm('Send this message to your entire WhatsApp community now?')) return;

  const btn = document.getElementById('waSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }
  try {
    if (typeof window.sendWhatsAppCommunityMessage !== 'function') throw new Error('WhatsApp backend not loaded');
    const row = await window.sendWhatsAppCommunityMessage({ inviteLink, title, message, imageUrl, isTest: false });
    if (row && row.status === 'sent') {
      waShowStatus('📢 Message dispatched to the community.', 'success');
      showToast('Community message sent!', 'success');
      document.getElementById('waMsgTitle').value = '';
      document.getElementById('waMsgBody').value = '';
      document.getElementById('waMsgImage').value = '';
    } else {
      waShowStatus('Send failed — check your Pipedream webhook configuration.', 'error');
    }
  } catch (e) {
    waShowStatus('Error: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '📢 Send Community Message'; }
  waLoadHistory();
}

async function waLoadHistory() {
  const el = document.getElementById('waHistoryList');
  if (!el) return;
  const rows = typeof window.loadWhatsAppBroadcastHistory === 'function'
    ? await window.loadWhatsAppBroadcastHistory(50)
    : [];
  if (!rows.length) { el.innerHTML = '<div>No broadcasts sent yet.</div>'; return; }

  const styleFor = (s) => s === 'sent' ? '#10d98e' : (s === 'test' ? '#b794f4' : '#ff6b85');
  el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%;font-size:.78rem">
    <thead><tr><th>Title</th><th>Status</th><th>When</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${(r.title||'').replace(/</g,'&lt;')}</td>
      <td style="color:${styleFor(r.status)};font-weight:600;text-transform:capitalize">${r.status}</td>
      <td>${r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════════════════
// 🌐 COMMUNITY MANAGER — Admin Panel
// ══════════════════════════════════════════════════════════════════

let _cmLinks = [];        // working copy
let _cmDragSrc = null;    // drag source index

async function renderAdminCommunityManager(main) {
  main.innerHTML = `<div class="admin-section" style="animation:dashFadeUp .35s ease both">
    <div class="admin-section-title" style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,rgba(16,217,142,0.2),rgba(37,211,102,0.1));border:1px solid rgba(16,217,142,0.25);display:flex;align-items:center;justify-content:center;font-size:1.1rem">🌐</div>
      Community Manager
    </div>
    <div class="admin-section-sub">Manage community links shown on the homepage. Add, edit, reorder, enable/disable buttons. Changes apply instantly.</div>
    <div id="cmBody"><div style="text-align:center;padding:40px;color:var(--text2)"><span class="live-dot" style="display:inline-block;margin-right:8px"></span>Loading...</div></div>
  </div>`;

  try {
    const sb = window.supabaseClient;
    let dbLinks = [];
    if (sb) {
      const { data, error } = await sb.from('community_links').select('*').order('sort_order', { ascending: true });
      if (!error && data && data.length > 0) {
        dbLinks = data.filter(l => l.id !== '__section_hidden__');
      }
    }
    _cmLinks = dbLinks.length > 0 ? dbLinks : JSON.parse(JSON.stringify(COMMUNITY_DEFAULTS));
  } catch(e) {
    _cmLinks = JSON.parse(JSON.stringify(COMMUNITY_DEFAULTS));
    showToast('Using default links (DB not connected)', 'info');
  }

  _cmRender(main);
}

function _cmRender(main) {
  const body = document.getElementById('cmBody');
  if (!body) return;

  const PRESETS = [
    { color: '#25d366', label: 'WhatsApp' },
    { color: '#0088cc', label: 'Telegram' },
    { color: '#1877f2', label: 'Facebook' },
    { color: '#e1306c', label: 'Instagram' },
    { color: '#ff0000', label: 'YouTube' },
    { color: '#5865f2', label: 'Discord' },
    { color: '#3d8ef8', label: 'Blue' },
    { color: '#10d98e', label: 'Green' },
    { color: '#f59e0b', label: 'Amber' },
    { color: '#8b5cf6', label: 'Purple' },
  ];

  body.innerHTML = `
    <!-- Section toggle -->
    <div class="cm-section-toggle">
      <div>
        <div class="cm-section-toggle-label">🌐 Show Community Hub on Homepage</div>
        <div class="cm-section-toggle-sub">Toggle the entire Community Hub section visibility</div>
      </div>
      <button class="cm-toggle on" id="cmSectionToggle" onclick="_cmToggleSection(this)"></button>
    </div>

    <!-- Live Preview -->
    <div class="cm-preview-panel" id="cmPreviewPanel">
      <div class="cm-preview-label">Live Preview</div>
      <div id="cmPreviewGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:540px"></div>
    </div>

    <!-- Links list -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.88rem;font-weight:700;color:var(--text)">📋 Community Links <span style="color:var(--text2);font-weight:400;font-size:.78rem">(drag to reorder)</span></div>
      <button class="btn btn-primary btn-sm" onclick="_cmOpenAddForm()">＋ Add Link</button>
    </div>
    <div class="cm-links-list" id="cmLinksList"></div>

    <!-- Add/Edit form (hidden by default) -->
    <div class="cm-add-form" id="cmAddForm" style="display:none">
      <div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:14px" id="cmFormTitle">➕ Add New Link</div>
      <input type="hidden" id="cmEditId" value="">
      <div class="cm-form-grid">
        <div class="cm-form-field">
          <label class="cm-form-label">Title *</label>
          <input class="cm-form-input" id="cmFTitle" placeholder="e.g. WhatsApp Community">
        </div>
        <div class="cm-form-field">
          <label class="cm-form-label">Icon (emoji) *</label>
          <input class="cm-form-input" id="cmFIcon" placeholder="e.g. 💬" maxlength="4">
        </div>
        <div class="cm-form-field full">
          <label class="cm-form-label">URL *</label>
          <input class="cm-form-input" id="cmFUrl" placeholder="https://..." type="url">
        </div>
        <div class="cm-form-field full">
          <label class="cm-form-label">Short Description</label>
          <input class="cm-form-input" id="cmFDesc" placeholder="e.g. Join our main group">
        </div>
        <div class="cm-form-field full">
          <label class="cm-form-label">Color</label>
          <div class="cm-color-row" id="cmColorRow">
            ${PRESETS.map(p => `<button class="cm-color-preset" title="${p.label}" style="background:${p.color}" data-color="${p.color}" onclick="_cmPickColor('${p.color}',this)"></button>`).join('')}
            <input type="color" id="cmFColor" value="#25d366" style="width:28px;height:28px;border-radius:8px;border:2px solid rgba(255,255,255,0.15);background:none;cursor:pointer;padding:0" oninput="_cmCustomColor(this.value)">
          </div>
        </div>
        <div class="cm-form-field">
          <label class="cm-form-label">Set as Primary Button</label>
          <select class="cm-form-input" id="cmFPrimary">
            <option value="false">No</option>
            <option value="true">Yes (full-width)</option>
          </select>
        </div>
        <div class="cm-form-field">
          <label class="cm-form-label">Status</label>
          <select class="cm-form-input" id="cmFEnabled">
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="_cmCloseForm()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="_cmSaveLink()">💾 Save Link</button>
      </div>
    </div>

    <!-- Save to DB bar -->
    <div class="cm-save-bar">
      <span style="font-size:.78rem;color:var(--text2)" id="cmSaveStatus">All changes saved</span>
      <button class="btn btn-ghost btn-sm" onclick="_cmReset()">↺ Reset to Defaults</button>
      <button class="btn btn-primary" onclick="_cmSaveToDB()">
        <svg width="14" height="14"><use href="#ic-check"/></svg> Save to Database
      </button>
    </div>
  `;

  _cmRenderList();
  _cmRenderPreview();
}

function _cmRenderList() {
  const list = document.getElementById('cmLinksList');
  if (!list) return;
  if (_cmLinks.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text2);font-size:.84rem">No links yet. Click "＋ Add Link" to add one.</div>`;
    return;
  }
  list.innerHTML = _cmLinks.map((link, i) => `
    <div class="cm-link-row" draggable="true" data-idx="${i}"
      ondragstart="_cmDragStart(event,${i})"
      ondragover="_cmDragOver(event,${i})"
      ondrop="_cmDrop(event,${i})"
      ondragend="_cmDragEnd()"
      style="opacity:${link.enabled ? 1 : .45}">
      <span class="cm-drag-handle" title="Drag to reorder">⠿</span>
      <div class="cm-link-icon" style="background:${_chIconBg(link.color)};border-color:${_chIconBorder(link.color)}">${link.icon}</div>
      <div class="cm-link-info">
        <div class="cm-link-title">${link.title}${link.is_primary ? ' <span style="font-size:.65rem;background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.25);border-radius:4px;padding:1px 6px">PRIMARY</span>' : ''}</div>
        <div class="cm-link-url">${link.url}</div>
      </div>
      <div class="cm-link-actions">
        <button class="cm-toggle ${link.enabled ? 'on' : 'off'}" onclick="_cmToggleLink(${i})" title="Enable/Disable"></button>
        <button class="cm-action-btn" onclick="_cmEditLink(${i})" title="Edit">✏️</button>
        <button class="cm-action-btn danger" onclick="_cmDeleteLink(${i})" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');
}

function _cmRenderPreview() {
  const grid = document.getElementById('cmPreviewGrid');
  if (!grid) return;
  const active = _cmLinks.filter(l => l.enabled);
  if (active.length === 0) { grid.innerHTML = `<div style="color:var(--text2);font-size:.8rem;grid-column:1/-1;text-align:center;padding:16px">No enabled links to preview</div>`; return; }

  const primary = active.find(l => l.is_primary);
  const rest = active.filter(l => !l.is_primary);

  let html = '';
  if (primary) {
    html += `<div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:${_chIconBg(primary.color)};border:1px solid ${_chIconBorder(primary.color)}">
      <div style="width:32px;height:32px;border-radius:8px;background:${_chIconBg(primary.color)};display:flex;align-items:center;justify-content:center;font-size:.95rem">${primary.icon}</div>
      <div style="flex:1"><div style="font-size:.8rem;font-weight:700;color:var(--text)">${primary.title}</div><div style="font-size:.68rem;color:var(--text2)">${primary.description||''}</div></div>
      <span style="font-size:.65rem;color:${primary.color};font-weight:700">PRIMARY →</span>
    </div>`;
  }
  rest.slice(0,6).forEach(l => {
    html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">
      <div style="width:28px;height:28px;border-radius:7px;background:${_chIconBg(l.color)};display:flex;align-items:center;justify-content:center;font-size:.85rem">${l.icon}</div>
      <div style="flex:1;min-width:0"><div style="font-size:.75rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.title}</div></div>
    </div>`;
  });
  grid.innerHTML = html;
}

function _cmToggleSection(btn) {
  btn.classList.toggle('on');
  btn.classList.toggle('off');
  _cmMarkDirty();
}
function _cmToggleLink(i) {
  _cmLinks[i].enabled = !_cmLinks[i].enabled;
  _cmRenderList();
  _cmRenderPreview();
  _cmMarkDirty();
}
function _cmDeleteLink(i) {
  if (!confirm(`Delete "${_cmLinks[i].title}"?`)) return;
  _cmLinks.splice(i,1);
  _cmRenderList();
  _cmRenderPreview();
  _cmMarkDirty();
}
function _cmEditLink(i) {
  const link = _cmLinks[i];
  document.getElementById('cmFormTitle').textContent = '✏️ Edit Link';
  document.getElementById('cmEditId').value = String(i);
  document.getElementById('cmFTitle').value = link.title || '';
  document.getElementById('cmFIcon').value = link.icon || '';
  document.getElementById('cmFUrl').value = link.url || '';
  document.getElementById('cmFDesc').value = link.description || '';
  document.getElementById('cmFColor').value = link.color || '#25d366';
  document.getElementById('cmFPrimary').value = link.is_primary ? 'true' : 'false';
  document.getElementById('cmFEnabled').value = link.enabled !== false ? 'true' : 'false';
  // Highlight preset
  document.querySelectorAll('.cm-color-preset').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === link.color);
  });
  document.getElementById('cmAddForm').style.display = 'block';
  document.getElementById('cmAddForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function _cmOpenAddForm() {
  document.getElementById('cmFormTitle').textContent = '➕ Add New Link';
  document.getElementById('cmEditId').value = '';
  document.getElementById('cmFTitle').value = '';
  document.getElementById('cmFIcon').value = '';
  document.getElementById('cmFUrl').value = '';
  document.getElementById('cmFDesc').value = '';
  document.getElementById('cmFColor').value = '#25d366';
  document.getElementById('cmFPrimary').value = 'false';
  document.getElementById('cmFEnabled').value = 'true';
  document.querySelectorAll('.cm-color-preset').forEach(b => b.classList.remove('selected'));
  document.getElementById('cmAddForm').style.display = 'block';
  document.getElementById('cmFTitle').focus();
}
function _cmCloseForm() {
  document.getElementById('cmAddForm').style.display = 'none';
}
function _cmPickColor(color, btn) {
  document.getElementById('cmFColor').value = color;
  document.querySelectorAll('.cm-color-preset').forEach(b => b.classList.toggle('selected', b === btn));
}
function _cmCustomColor(val) {
  document.querySelectorAll('.cm-color-preset').forEach(b => b.classList.remove('selected'));
}
function _cmSaveLink() {
  const title = document.getElementById('cmFTitle').value.trim();
  const icon = document.getElementById('cmFIcon').value.trim();
  const url = document.getElementById('cmFUrl').value.trim();
  if (!title || !url) { showToast('Title and URL are required', 'error'); return; }
  const link = {
    id: 'link_' + Date.now(),
    title,
    icon: icon || '🔗',
    url,
    description: document.getElementById('cmFDesc').value.trim(),
    color: document.getElementById('cmFColor').value || '#3d8ef8',
    is_primary: document.getElementById('cmFPrimary').value === 'true',
    enabled: document.getElementById('cmFEnabled').value !== 'false',
    sort_order: _cmLinks.length + 1,
  };
  const editIdx = document.getElementById('cmEditId').value;
  if (editIdx !== '') {
    link.id = _cmLinks[parseInt(editIdx)].id || link.id;
    _cmLinks[parseInt(editIdx)] = link;
  } else {
    _cmLinks.push(link);
  }
  _cmCloseForm();
  _cmRenderList();
  _cmRenderPreview();
  _cmMarkDirty();
  showToast(editIdx !== '' ? 'Link updated' : 'Link added', 'success');
}
function _cmReset() {
  if (!confirm('Reset to default links? This will overwrite your current list.')) return;
  _cmLinks = JSON.parse(JSON.stringify(COMMUNITY_DEFAULTS));
  _cmRenderList();
  _cmRenderPreview();
  _cmMarkDirty();
  showToast('Reset to defaults', 'info');
}
function _cmMarkDirty() {
  const s = document.getElementById('cmSaveStatus');
  if (s) s.textContent = '● Unsaved changes';
}

// Drag & Drop
function _cmDragStart(e, i) {
  _cmDragSrc = i;
  e.currentTarget.classList.add('cm-dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function _cmDragOver(e, i) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cm-link-row').forEach((r,idx) => {
    r.classList.toggle('cm-drag-over', idx === i && i !== _cmDragSrc);
  });
}
function _cmDrop(e, i) {
  e.preventDefault();
  if (_cmDragSrc === null || _cmDragSrc === i) return;
  const moved = _cmLinks.splice(_cmDragSrc, 1)[0];
  _cmLinks.splice(i, 0, moved);
  _cmLinks.forEach((l, idx) => l.sort_order = idx + 1);
  _cmDragSrc = null;
  _cmRenderList();
  _cmRenderPreview();
  _cmMarkDirty();
}
function _cmDragEnd() {
  _cmDragSrc = null;
  document.querySelectorAll('.cm-link-row').forEach(r => {
    r.classList.remove('cm-dragging', 'cm-drag-over');
  });
}

async function _cmSaveToDB() {
  const btn = document.querySelector('[onclick="_cmSaveToDB()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
  const status = document.getElementById('cmSaveStatus');

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase not connected');

    // Upsert all links with updated sort_order
    const rows = _cmLinks.map((l, idx) => ({
      id: l.id,
      title: l.title,
      description: l.description || '',
      icon: l.icon || '🔗',
      color: l.color || '#3d8ef8',
      url: l.url,
      is_primary: l.is_primary || false,
      enabled: l.enabled !== false,
      sort_order: idx + 1,
    }));

    // Delete removed links first by fetching existing IDs
    const { data: existingRows } = await sb.from('community_links').select('id');
    const existingIds = (existingRows || []).map(r => r.id).filter(id => id !== '__section_hidden__');
    const newIds = rows.map(r => r.id);
    const toDelete = existingIds.filter(id => !newIds.includes(id));
    if (toDelete.length > 0) {
      await sb.from('community_links').delete().in('id', toDelete);
    }

    // Handle section toggle sentinel
    const sectionToggle = document.getElementById('cmSectionToggle');
    const sectionVisible = sectionToggle ? sectionToggle.classList.contains('on') : true;
    if (!sectionVisible) {
      rows.push({ id: '__section_hidden__', title: 'Section Hidden', description: '', icon: '🚫', color: '#ff0000', url: '', is_primary: false, enabled: false, sort_order: 9999 });
    } else {
      await sb.from('community_links').delete().eq('id', '__section_hidden__');
    }

    const { error } = await sb.from('community_links').upsert(rows, { onConflict: 'id' });
    if (error) throw error;

    if (status) status.textContent = '✓ Saved to database';
    showToast('Community links saved! Homepage updated.', 'success');

    // Reload homepage community hub
    loadCommunityHub();

  } catch(e) {
    console.error('Community Manager save failed:', e);
    if (status) status.textContent = '✗ Save failed';
    showToast('Save failed: ' + (e.message || 'Unknown error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14"><use href="#ic-check"/></svg> Save to Database'; }
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function renderAdminDashboard(main) {
  let pdfCount = PDFS.length, orderCount = 0, userCount = 0, revenue = 0;

  if (window.supabaseClient) {
    try {
      const [pdfRes, orderRes, userRes] = await Promise.all([
        window.supabaseClient.from('pdfs').select('id', {count:'exact', head:true}),
        window.supabaseClient.from('purchased_pdfs').select('amount', {count:'exact'}),
        window.supabaseClient.from('admin_users').select('id', {count:'exact', head:true}),
      ]);
      pdfCount = pdfRes.count || pdfCount;
      orderCount = orderRes.count || 0;
      revenue = (orderRes.data || []).reduce((s,r) => s + (r.amount||0), 0);
      userCount = userRes.count || 0;
    } catch(e) { console.warn('Admin DB fetch:', e); }
  }

  const recentOrders = await getRecentOrders(5);
  const trendingPDFs = await getTrendingPDFs(5);

  main.innerHTML = `
    <div class="admin-section-title">
      ${adminIcon('dashboard', 20)}Sales Dashboard
      <span class="admin-badge admin-badge-success"><span class="live-dot" style="width:6px;height:6px;margin-right:4px"></span>Live</span>
    </div>
    <div class="admin-stats-grid-8">
      ${adminStatCard('Total PDFs', pdfCount, '7 new this week', true, 'blue', 'library')}
      ${adminStatCard('Total Users', userCount || '—', '+523 this week', true, 'blue', 'users')}
      ${adminStatCard('Revenue', revenue ? '₹'+revenue.toLocaleString() : '₹8.9L', '+23.4% this month', true, 'gold', 'trending')}
      ${adminStatCard('Total Orders', orderCount || '2,341', '+340 this week', true, 'green', 'download')}
      ${adminStatCard('Total Reviews', '4,210', '⭐ 4.8 avg', true, 'gold', 'star')}
      ${adminStatCard('Online Now', Math.floor(Math.random()*300+100)+'', 'live visitors', true, 'green', 'check')}
      ${adminStatCard('Downloads Today', '847', '+12% vs yesterday', true, 'blue', 'download')}
      ${adminStatCard('Monthly Growth', '+24%', 'vs last month', true, 'purple', 'trending')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <!-- Trending PDFs -->
      <div class="admin-table-card">
        <div class="admin-table-header">
          <div style="font-size:.9rem;font-weight:700">🔥 Trending PDFs</div>
          <button class="btn btn-ghost btn-sm" onclick="switchAdminTab('pdfs')">View All ${adminIcon('arrow',12)}</button>
        </div>
        <div style="padding:8px 16px">
          ${trendingPDFs.map((p,i) => `
            <div class="admin-trending-row">
              <div class="admin-trending-rank ${i===0?'r1':i===1?'r2':i===2?'r3':'rn'}">${i+1}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</div>
                <div style="font-size:.72rem;color:var(--text2)">${(p.download_count||p.sales||0).toLocaleString()} downloads</div>
              </div>
              <div class="admin-progress-wrap" style="width:80px">
                <div class="admin-progress"><div class="admin-progress-fill" style="width:${Math.max(20, 100 - i*18)}%"></div></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Revenue Mini Chart -->
      <div class="admin-table-card">
        <div class="admin-table-header">
          <div style="font-size:.9rem;font-weight:700">📈 Revenue (7 Days)</div>
          <span class="admin-badge admin-badge-success">+23.4%</span>
        </div>
        <div style="padding:16px">
          <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;background:var(--grad-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:16px">₹1.24L</div>
          <div class="admin-mini-chart" id="adminMiniChart">
            ${[40,65,45,80,55,90,70].map((h,i) => `<div class="admin-chart-bar" style="height:${h}%" title="Day ${i+1}: ₹${(h*180).toLocaleString()}"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.7rem;color:var(--text2)">
            ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span>${d}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Purchases -->
    <div class="admin-table-card">
      <div class="admin-table-header">
        <div style="font-size:.9rem;font-weight:700">🧾 Recent Purchases</div>
        <button class="btn btn-ghost btn-sm" onclick="switchAdminTab('orders')">All Orders ${adminIcon('arrow',12)}</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table" style="width:100%">
          <thead><tr>
            <th>Buyer</th><th>PDF</th><th>Amount</th><th>Payment ID</th><th>Status</th><th>Date</th>
          </tr></thead>
          <tbody>
            ${recentOrders.map(o => `<tr>
              <td><div style="font-size:.83rem;font-weight:600">${o.user_email || o.user}</div></td>
              <td><div style="font-size:.8rem;color:var(--text2)">${o.pdf_title || o.pdf}</div></td>
              <td><span class="admin-badge admin-badge-success">₹${o.amount}</span></td>
              <td><span style="font-size:.73rem;color:var(--text2);font-family:monospace">${o.payment_id || 'No data available'}</span></td>
              <td><span class="admin-badge admin-badge-accent">Paid</span></td>
              <td style="font-size:.75rem;color:var(--text2)">${o.time || o.created_at || 'Just now'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function getRecentOrders(limit=10) {
  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient
        .from('purchased_pdfs').select('*').order('created_at', {ascending:false}).limit(limit);
      if (data?.length) return data;
    } catch(e) {}
  }
  return RECENT_SALES.slice(0, limit);
}

async function getTrendingPDFs(limit=5) {
  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient
        .from('pdfs').select('*').order('download_count', {ascending:false}).limit(limit);
      if (data?.length) return data;
    } catch(e) {}
  }
  return [...PDFS].sort((a,b) => b.sales - a.sales).slice(0, limit);
}

// ── ANALYTICS ─────────────────────────────────────────────────────
function renderAdminAnalytics(main) {
  const bars7 = [62000, 84000, 53000, 97000, 71000, 115000, 88000];
  const bars30 = [320000, 410000, 380000, 460000, 390000, 520000, 480000, 550000, 410000, 620000, 570000, 680000];

  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('trending',20)} Analytics & Insights</div>
    <div class="admin-stats-grid">
      ${adminStatCard('Downloads This Month','12,430','+18% vs last',true,'blue','download')}
      ${adminStatCard('New Users','3,241','+8.2% this week',true,'green','users')}
      ${adminStatCard('Conversion Rate','4.8%','+0.3% vs last month',true,'gold','zap')}
      ${adminStatCard('Avg. Order Value','₹487','−₹23 vs last week',false,'purple','tag')}
    </div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px">
      <div class="admin-table-card">
        <div class="admin-table-header">
          <div style="font-size:.9rem;font-weight:700">Revenue (Last 30 Days)</div>
        </div>
        <div style="padding:16px">
          <div class="admin-mini-chart" style="height:80px;gap:3px">
            ${bars30.map((v,i) => {
              const h = Math.round((v/680000)*100);
              return `<div class="admin-chart-bar" style="height:${h}%;min-width:0" title="₹${(v/1000).toFixed(0)}K"></div>`;
            }).join('')}
          </div>
          <div style="font-size:.72rem;color:var(--text2);margin-top:8px;text-align:center">Daily revenue over 30 days · Peak: ₹6.8L</div>
        </div>
      </div>
      <div class="admin-table-card">
        <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Top Categories</div></div>
        <div style="padding:12px 16px">
          ${[['Engineering',34],['Government Exams',28],['School Education',18],['CS & Tech',12],['Others',8]].map(([cat,pct]) => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:4px">
                <span>${cat}</span><span style="color:var(--accent);font-weight:600">${pct}%</span>
              </div>
              <div class="admin-progress"><div class="admin-progress-fill" style="width:${pct}%"></div></div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="admin-table-card">
      <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Weekly Revenue Breakdown</div></div>
      <div class="table-wrap"><table class="admin-table" style="width:100%">
        <thead><tr><th>Day</th><th>Orders</th><th>Revenue</th><th>Top PDF</th><th>New Users</th></tr></thead>
        <tbody>
          ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,i) => `
            <tr><td class="fw-600">${day}</td>
            <td>${[89,123,74,145,98,167,112][i]}</td>
            <td><span class="admin-badge admin-badge-success">₹${(bars7[i]/1000).toFixed(1)}K</span></td>
            <td style="font-size:.8rem;color:var(--text2)">${PDFS[i%PDFS.length]?.title?.slice(0,28)||'—'}…</td>
            <td style="font-size:.82rem">${[45,67,38,89,54,102,73][i]}</td></tr>
          `).join('')}
        </tbody>
      </table></div>
    </div>`;
}

// ── PDF MANAGEMENT ─────────────────────────────────────────────────
async function renderAdminPDFs(main) {
  main.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text2)">Loading PDFs…</div>`;

  let pdfs = PDFS;
  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('pdfs').select('*').order('created_at', {ascending:false});
      if (data?.length) pdfs = data;
    } catch(e) {}
  }

  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('library',20)} PDF Management</div>
    <div class="admin-table-card">
      <div class="admin-table-header">
        <div style="display:flex;align-items:center;gap:10px">
          <input class="admin-table-search" placeholder="Search PDFs…" oninput="adminFilterPDFs(this.value)" id="adminPdfSearch" />
          <span class="admin-badge admin-badge-accent">${pdfs.length} PDFs</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="switchAdminTab('add-pdf')">${adminIcon('plus',13)} Add New PDF</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table" style="width:100%" id="adminPDFTable">
          <thead><tr>
            <th>#</th><th>Cover</th><th>Title</th><th>Category</th><th>Price</th><th>Sales</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody id="adminPDFTableBody">
            ${pdfs.map((p,i) => adminPDFRow(p,i)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  window._adminPDFs = pdfs;
}

function adminPDFRow(p, i) {
  const price = p.price ?? 0;
  const coverHTML = p.cover_url
    ? `<img src="${p.cover_url}" alt="${(p.title || 'PDF cover').replace(/"/g,'&quot;')}" style="width:36px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--glass-border)"  loading="lazy" decoding="async" />`
    : `<div style="width:36px;height:48px;border-radius:4px;background:linear-gradient(135deg,${p.coverFrom||'#1d4ed8'},${p.coverTo||'#3d8ef8'});display:flex;align-items:center;justify-content:center">${adminIcon('file',16)}</div>`;
  return `<tr>
    <td style="font-size:.75rem;color:var(--text2)">${i+1}</td>
    <td>${coverHTML}</td>
    <td>
      <div style="font-size:.83rem;font-weight:600;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</div>
      <div style="font-size:.72rem;color:var(--text2)">${p.author||''}</div>
    </td>
    <td><span class="admin-badge admin-badge-accent">${p.category||'—'}</span></td>
    <td>${p.free?'<span class="admin-badge admin-badge-success">Free</span>':`<span style="font-weight:700;color:var(--accent)">₹${price}</span>`}</td>
    <td style="font-size:.82rem">${(p.download_count||p.sales||0).toLocaleString()}</td>
    <td><span class="admin-badge admin-badge-success">Published</span></td>
    <td>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="adminEditPDF(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="Edit">${adminIcon('eye',13)}</button>
        <button class="btn btn-danger btn-sm" onclick="adminDeletePDF('${p.id}')" title="Delete">${adminIcon('x',13)}</button>
      </div>
    </td>
  </tr>`;
}

function adminFilterPDFs(query) {
  const pdfs = (window._adminPDFs || PDFS).filter(p => !query || p.title?.toLowerCase().includes(query.toLowerCase()) || p.category?.toLowerCase().includes(query.toLowerCase()) || p.author?.toLowerCase().includes(query.toLowerCase()));
  const tbody = document.getElementById('adminPDFTableBody');
  if (tbody) tbody.innerHTML = pdfs.map((p,i) => adminPDFRow(p,i)).join('');
}

function adminEditPDF(pdf) {
  window.adminEditingPDFId    = pdf.id;
  window.adminEditingCoverUrl = pdf.cover_url || null;
  window.adminEditingPdfUrl   = pdf.pdf_url   || null;
  // Pass full PDF data to the form via prefill object
  window._adminEditPrefill    = pdf;

  window._adminEditingLoading = true;
  switchAdminTab('add-pdf');
  window._adminEditingLoading = false;
}

async function adminDeletePDF(id) {
  if (!confirm('Delete this PDF permanently?')) return;
  if (window.supabaseClient) {
    const { error } = await window.supabaseClient.from('pdfs').delete().eq('id', id);
    if (error) { showToast('Delete failed: '+error.message, 'error'); return; }
  }
  logAdminActivity(`Deleted PDF #${id}`, 'red');
  showToast('PDF deleted.', 'info');
  renderAdminPDFs(document.getElementById('adminMain'));
}

function adminCancelEdit() {
  window.adminEditingPDFId  = null;
  window.adminEditingCoverUrl = null;
  window.adminEditingPdfUrl   = null;
  switchAdminTab('pdfs');
}

// ════════════════════════════════════════════════════════════════
// CATEGORY SYSTEM — DB-DRIVEN
// ════════════════════════════════════════════════════════════════

async function loadCategoriesFromDB() {
  if (!window.supabaseClient) return;
  try {
    const [catRes, subcatRes] = await Promise.all([
      window.supabaseClient.from('categories').select('*').order('sort_order'),
      window.supabaseClient.from('subcategories').select('*').order('sort_order')
    ]);

    if (catRes.data && catRes.data.length) {
      window._dbCategories = catRes.data;
      // Rebuild CATEGORIES for any legacy code that uses it
      window.CATEGORIES = ['All', ...catRes.data.map(c => c.name)];
    }

    if (subcatRes.data && subcatRes.data.length) {
      window._dbSubcategories = subcatRes.data;
      // Build fast lookup map: category_id => [subcategory, ...]
      window._dbSubcatMap = {};
      subcatRes.data.forEach(s => {
        if (!window._dbSubcatMap[s.category_id]) window._dbSubcatMap[s.category_id] = [];
        window._dbSubcatMap[s.category_id].push(s);
      });
    }

    console.log('✅ Categories loaded from DB:', window._dbCategories.length, 'cats,', window._dbSubcategories.length, 'subcats');
    if (typeof ottRenderFeaturedCategories === 'function') ottRenderFeaturedCategories();
    if (typeof ottlibRenderCategoryRows === 'function' && document.getElementById('page-library') && document.getElementById('page-library').classList.contains('active')) ottlibRenderCategoryRows();
  } catch(e) {
    console.warn('loadCategoriesFromDB error:', e);
  }
}

// Get subcategories for a given category name or id
function getSubcatsFor(categoryNameOrId) {
  const cat = window._dbCategories.find(c =>
    c.name === categoryNameOrId || String(c.id) === String(categoryNameOrId)
  );
  if (!cat) return [];
  return window._dbSubcatMap[cat.id] || [];
}

// Generate a URL-friendly slug from a string
function generateSlug(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Auto-generate SEO fields from title + category + subcategory
function autoGenerateSEO(title, category, subcategory, examYear) {
  const parts = [title, subcategory, category, examYear].filter(Boolean);
  const seoTitle = parts.slice(0,3).join(' | ') + ' — Studyria';
  const desc = `Download ${title}${subcategory ? ' for ' + subcategory : ''}${category ? ' (' + category + ')' : ''}${examYear ? ' ' + examYear : ''}. Best study material for Indian students on Studyria.`;
  const keywords = parts.concat(['study material', 'PDF', 'download', 'Assam', 'India']).join(', ');
  return { seoTitle, desc, keywords };
}

// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// ADD / EDIT PDF — Premium SaaS Dashboard Redesign
// ══════════════════════════════════════════════════════════════════
//
// REQUIRED SUPABASE TABLES (run these SQL queries if not yet created):
//
// CREATE TABLE IF NOT EXISTS categories (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   name text NOT NULL, slug text, icon text, color text,
//   sort_order int DEFAULT 0, created_at timestamptz DEFAULT now()
// );
// CREATE TABLE IF NOT EXISTS subcategories (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
//   name text NOT NULL, slug text, sort_order int DEFAULT 0,
//   created_at timestamptz DEFAULT now()
// );
// CREATE TABLE IF NOT EXISTS academic_levels (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   subcategory_id uuid REFERENCES subcategories(id) ON DELETE CASCADE,
//   name text NOT NULL, slug text, sort_order int DEFAULT 0,
//   created_at timestamptz DEFAULT now()
// );
// CREATE TABLE IF NOT EXISTS streams (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   academic_level_id uuid REFERENCES academic_levels(id) ON DELETE CASCADE,
//   name text NOT NULL, slug text, sort_order int DEFAULT 0,
//   created_at timestamptz DEFAULT now()
// );
// CREATE TABLE IF NOT EXISTS semester_classes (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   stream_id uuid REFERENCES streams(id) ON DELETE CASCADE,
//   name text NOT NULL, slug text, sort_order int DEFAULT 0,
//   created_at timestamptz DEFAULT now()
// );
// CREATE TABLE IF NOT EXISTS subjects (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   semester_class_id uuid REFERENCES semester_classes(id) ON DELETE CASCADE,
//   name text NOT NULL, slug text, sort_order int DEFAULT 0,
//   created_at timestamptz DEFAULT now()
// );
// -- pdfs needs these classification columns:
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS category text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS category_id uuid;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS subcategory text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS subcategory_id uuid;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS academic_level text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS academic_level_id uuid;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS stream text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS stream_id uuid;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS semester_class text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS semester_class_id uuid;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS subject text;
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS subject_id uuid;
//
// ── REQUIRED: pdf_analytics table (run in Supabase SQL editor) ──────
// CREATE TABLE IF NOT EXISTS pdf_analytics (
//   id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   pdf_id          text NOT NULL,
//   user_id         uuid NOT NULL,
//   opened_count    integer DEFAULT 0,
//   download_count  integer DEFAULT 0,
//   last_opened_at  timestamptz,
//   first_opened_at timestamptz,
//   total_read_time_minutes numeric DEFAULT 0,
//   created_at      timestamptz DEFAULT now(),
//   updated_at      timestamptz DEFAULT now(),
//   UNIQUE (pdf_id, user_id)
// );
// ALTER TABLE pdf_analytics ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Users manage own analytics" ON pdf_analytics
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
//
// ── REQUIRED: add download_count to pdfs table if missing ─────────
// ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS download_count integer DEFAULT 0;
//
// ── REQUIRED: add amount to purchased_pdfs if missing ────────────
// ALTER TABLE purchased_pdfs ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
//
// ══════════════════════════════════════════════════════════════════

function renderAdminAddPDFLegacy(main) {
  if (!window._adminEditingLoading) {
    window.adminEditingPDFId    = null;
    window.adminEditingCoverUrl = null;
    window.adminEditingPdfUrl   = null;
  }

  const badges = ['Bestseller','New Arrival','Hot','Trending','Editor\'s Choice','Top Rated','Most Downloaded','IIT Expert','IIM Expert','Premium','Verified','Staff Pick','Limited Edition','Exclusive','Must Have','Exam Ready','Quick Revision','Comprehensive','Updated 2025','Gold Standard','Platinum','Silver','Bronze','Featured'];
  const isEdit = !!window.adminEditingPDFId;

  // Build category options from DB (fallback to static list)
  const dbCats = window._dbCategories || [];
  const catOptions = dbCats.length
    ? dbCats.map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('')
    : ['School Education','Higher Education','Government Exams','Engineering','Medicine','Law','Finance','CS & Technology','Design','Science','Commerce','Agriculture','Architecture','Pharmacy','Nursing']
        .map(c => `<option value="${c}">${c}</option>`).join('');

  main.innerHTML = `
  <style>
  /* ── Premium Add/Edit PDF Page Styles ────────────────────────── */
  .ap-page-header {
    display:flex; align-items:center; justify-content:space-between;
    flex-wrap:wrap; gap:16px; margin-bottom:28px;
  }
  .ap-page-title {
    font-family:var(--font-display); font-size:1.5rem; font-weight:800;
    background:var(--grad-primary); -webkit-background-clip:text;
    -webkit-text-fill-color:transparent; background-clip:text;
    display:flex; align-items:center; gap:10px;
  }
  .ap-page-title svg { -webkit-text-fill-color:initial; }
  .ap-page-sub { font-size:.82rem; color:var(--text2); margin-top:4px; }
  .ap-layout { display:grid; grid-template-columns:1fr 320px; gap:24px; align-items:start; }
  @media(max-width:900px) { .ap-layout { grid-template-columns:1fr; } }
  .ap-card {
    background:var(--glass); border:1px solid var(--glass-border);
    border-radius:var(--radius); padding:22px; margin-bottom:18px;
    backdrop-filter:blur(12px);
    transition:border-color .2s;
  }
  .ap-card:hover { border-color:rgba(61,142,248,0.18); }
  .ap-card-header {
    display:flex; align-items:center; justify-content:space-between;
    margin-bottom:18px; padding-bottom:14px;
    border-bottom:1px solid var(--glass-border);
  }
  .ap-card-title {
    display:flex; align-items:center; gap:8px;
    font-size:.88rem; font-weight:800; letter-spacing:.01em;
  }
  .ap-card-icon {
    width:30px; height:30px; border-radius:8px;
    display:flex; align-items:center; justify-content:center;
    font-size:.9rem; flex-shrink:0;
  }
  .ap-icon-blue   { background:rgba(61,142,248,0.15); color:#3d8ef8; }
  .ap-icon-green  { background:rgba(16,217,142,0.15); color:#10d98e; }
  .ap-icon-amber  { background:rgba(245,158,11,0.15);  color:#f59e0b; }
  .ap-icon-purple { background:rgba(139,92,246,0.15); color:#8b5cf6; }
  .ap-icon-cyan   { background:rgba(0,200,232,0.15);  color:#00c8e8; }
  .ap-icon-red    { background:rgba(255,77,109,0.15); color:#ff4d6d; }

  .ap-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .ap-grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  @media(max-width:640px) { .ap-grid-2,.ap-grid-3 { grid-template-columns:1fr; } }
  .ap-field { display:flex; flex-direction:column; gap:5px; }
  .ap-label {
    font-size:.73rem; font-weight:700; letter-spacing:.05em;
    text-transform:uppercase; color:var(--text2);
  }
  .ap-label .ap-req { color:#ff4d6d; margin-left:2px; }
  .ap-input {
    padding:10px 13px; border-radius:var(--radius-sm);
    border:1px solid var(--glass-border); background:rgba(255,255,255,0.04);
    color:var(--text); font-family:var(--font-body); font-size:.875rem;
    outline:none; transition:all .2s; width:100%;
  }
  .ap-input:focus { border-color:var(--accent); background:rgba(61,142,248,0.05); box-shadow:0 0 0 3px rgba(61,142,248,0.12); }
  .ap-input::placeholder { color:var(--text3); }
  .ap-input:disabled { opacity:.5; cursor:not-allowed; }
  textarea.ap-input { resize:vertical; min-height:80px; }
  select.ap-input { cursor:pointer; }
  body.light .ap-input { background:rgba(255,255,255,0.8); border-color:rgba(0,0,0,0.1); color:#0a1022; }
  body.light .ap-input:focus { background:#fff; border-color:var(--accent); }

  /* Classification 6-grid */
  .ap-classif-grid {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:14px;
  }
  @media(max-width:640px) { .ap-classif-grid { grid-template-columns:1fr; } }

  .ap-classif-item {
    position:relative;
  }
  .ap-classif-level-badge {
    position:absolute; top:-8px; left:10px; z-index:1;
    font-size:.62rem; font-weight:800; letter-spacing:.08em;
    text-transform:uppercase; padding:2px 7px; border-radius:10px;
    white-space:nowrap;
  }
  .ap-lvl-1 { background:rgba(61,142,248,0.2);  color:#82c5ff; border:1px solid rgba(61,142,248,0.3); }
  .ap-lvl-2 { background:rgba(0,200,232,0.2);   color:#55dff2; border:1px solid rgba(0,200,232,0.3); }
  .ap-lvl-3 { background:rgba(16,217,142,0.2);  color:#5fffc4; border:1px solid rgba(16,217,142,0.3); }
  .ap-lvl-4 { background:rgba(139,92,246,0.2);  color:#cdbeff; border:1px solid rgba(139,92,246,0.3); }
  .ap-lvl-5 { background:rgba(245,158,11,0.2);  color:#fdd049; border:1px solid rgba(245,158,11,0.3); }
  .ap-lvl-6 { background:rgba(255,77,109,0.2);  color:#ff8fa8; border:1px solid rgba(255,77,109,0.3); }

  .ap-classif-select-wrap {
    margin-top:8px; position:relative;
  }
  .ap-classif-select-wrap select.ap-input {
    padding-right:32px;
    appearance:none; -webkit-appearance:none;
  }
  .ap-classif-select-wrap::after {
    content:'▾'; position:absolute; right:10px; top:50%;
    transform:translateY(-50%); pointer-events:none;
    color:var(--text2); font-size:.8rem;
  }
  .ap-classif-connector {
    display:none; position:absolute; right:-7px; top:50%;
    transform:translateY(-50%); z-index:2;
    width:14px; height:14px; border-radius:50%;
    background:var(--accent); border:2px solid var(--bg2);
    font-size:.5rem; display:flex; align-items:center;
    justify-content:center; color:#fff;
  }
  @media(max-width:640px) { .ap-classif-connector { display:none !important; } }

  /* Classification management inline panel */
  .ap-classif-mgmt {
    margin-top:16px; padding-top:16px;
    border-top:1px solid var(--glass-border);
  }
  .ap-classif-mgmt-header {
    display:flex; align-items:center; justify-content:space-between;
    margin-bottom:12px; cursor:pointer;
  }
  .ap-classif-mgmt-title {
    font-size:.78rem; font-weight:700; color:var(--text2);
    display:flex; align-items:center; gap:6px;
  }
  .ap-classif-mgmt-body { display:none; }
  .ap-classif-mgmt-body.open { display:block; }

  .ap-cm-tabs {
    display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;
  }
  .ap-cm-tab {
    padding:5px 11px; border-radius:16px; border:1px solid var(--glass-border);
    background:transparent; color:var(--text2); font-size:.72rem;
    font-weight:700; cursor:pointer; font-family:var(--font-body);
    transition:all .2s; white-space:nowrap;
  }
  .ap-cm-tab.active {
    background:rgba(61,142,248,0.15); color:var(--accent);
    border-color:rgba(61,142,248,0.3);
  }
  .ap-cm-table-wrap { overflow-x:auto; }
  .ap-cm-table {
    width:100%; border-collapse:collapse; font-size:.8rem;
    min-width:380px;
  }
  .ap-cm-table th {
    text-align:left; padding:8px 10px;
    font-size:.68rem; font-weight:800; text-transform:uppercase;
    letter-spacing:.05em; color:var(--text2);
    background:rgba(61,142,248,0.04);
    border-bottom:1px solid var(--glass-border);
  }
  .ap-cm-table td {
    padding:9px 10px; border-bottom:1px solid rgba(255,255,255,0.03);
    vertical-align:middle;
  }
  .ap-cm-table tr:last-child td { border-bottom:none; }
  .ap-cm-table tr:hover td { background:rgba(61,142,248,0.03); }
  .ap-cm-empty {
    text-align:center; padding:24px; color:var(--text2);
    font-size:.82rem;
  }
  .ap-cm-action-btn {
    padding:4px 9px; border-radius:5px; border:1px solid var(--glass-border);
    background:var(--glass); color:var(--text2); cursor:pointer;
    font-size:.72rem; transition:all .15s; font-family:var(--font-body);
  }
  .ap-cm-action-btn:hover { color:var(--text); border-color:var(--accent); }
  .ap-cm-del-btn {
    padding:4px 9px; border-radius:5px;
    border:1px solid rgba(255,77,109,0.3);
    background:rgba(255,77,109,0.07); color:var(--danger);
    cursor:pointer; font-size:.72rem; transition:all .15s;
    font-family:var(--font-body);
  }
  .ap-cm-del-btn:hover { background:rgba(255,77,109,0.15); }

  /* Upload zones */
  .ap-upload-zone {
    border:2px dashed var(--glass-border); border-radius:var(--radius-sm);
    padding:24px 16px; text-align:center; cursor:pointer;
    transition:all .2s; position:relative; overflow:hidden;
    background:rgba(255,255,255,0.02);
  }
  .ap-upload-zone:hover { border-color:var(--accent); background:rgba(61,142,248,0.05); }
  .ap-upload-zone.has-file { border-color:var(--success); background:rgba(16,217,142,0.04); }
  .ap-upload-zone input[type=file] { position:absolute; inset:0; opacity:0; cursor:pointer; z-index:2; }

  /* Preview card */
  .ap-preview-cover {
    width:100%; height:200px; border-radius:var(--radius-sm);
    background:linear-gradient(135deg,#1d4ed8,#3d8ef8);
    display:flex; align-items:center; justify-content:center;
    position:relative; overflow:hidden; margin-bottom:14px;
  }
  .ap-preview-cover img {
    position:absolute; inset:0; width:100%; height:100%;
    object-fit:cover; display:none;
  }
  .ap-preview-cover img.loaded { display:block; }

  /* Progress bars */
  .ap-progress-wrap { margin-top:8px; display:none; }
  .ap-progress-track { background:var(--surface); border-radius:4px; height:5px; overflow:hidden; }
  .ap-progress-fill { height:100%; background:var(--grad-primary); width:0%; transition:width .3s; border-radius:4px; }

  /* Sticky CTA bar */
  .ap-sticky-cta {
    position:sticky; bottom:0; left:0; right:0; z-index:50;
    background:rgba(8,12,20,0.95); backdrop-filter:blur(20px);
    border-top:1px solid rgba(61,142,248,0.2);
    padding:14px 0; margin-top:0;
    box-shadow:0 -8px 32px rgba(0,0,0,0.4);
  }
  body.light .ap-sticky-cta { background:rgba(240,244,251,0.97); border-top-color:rgba(61,142,248,0.15); }
  .ap-sticky-inner {
    display:flex; align-items:center; gap:12px; justify-content:flex-end;
    max-width:100%; padding:0 4px;
  }

  /* Modals inside admin */
  .ap-modal-overlay {
    display:none; position:fixed; inset:0; z-index:820;
    align-items:center; justify-content:center;
  }
  .ap-modal-overlay.open { display:flex; }
  .ap-modal-bg { position:absolute; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(6px); }
  .ap-modal-box {
    position:relative; z-index:1; width:min(480px,95vw);
    background:var(--bg2); border:1px solid var(--glass-border);
    border-radius:var(--radius-lg); padding:26px;
    max-height:85vh; overflow-y:auto;
    box-shadow:0 24px 80px rgba(0,0,0,0.6);
    animation:fadeUp .25s ease;
  }
  .ap-modal-title {
    font-weight:800; font-size:.95rem; margin-bottom:18px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .ap-modal-close {
    background:none; border:none; color:var(--text2); cursor:pointer;
    font-size:1.1rem; padding:0 4px; transition:color .2s;
  }
  .ap-modal-close:hover { color:var(--text); }
  .ap-modal-error {
    display:none; color:var(--danger); font-size:.78rem;
    padding:8px 10px; background:rgba(255,77,109,0.08);
    border-radius:6px; margin-bottom:10px;
  }

  /* Delete confirm modal */
  .ap-delete-modal {
    display:none; position:fixed; inset:0; z-index:830;
    align-items:center; justify-content:center;
  }
  .ap-delete-modal.open { display:flex; }

  /* SEO char counter */
  .ap-char-count { font-size:.68rem; color:var(--text2); margin-top:3px; }
  .ap-char-count.warn { color:#f59e0b; }
  .ap-char-count.over { color:var(--danger); }

  /* Discount badge */
  .ap-discount-badge {
    display:none; padding:3px 10px; border-radius:20px;
    font-size:.72rem; font-weight:800;
    background:rgba(16,217,142,0.12); color:var(--success);
    border:1px solid rgba(16,217,142,0.2);
  }
  </style>

  <!-- PAGE HEADER -->
  <div class="ap-page-header">
    <div>
      <div class="ap-page-title">
        <span style="font-size:1.3rem">${isEdit ? '✏️' : '➕'}</span>
        ${isEdit ? 'Edit PDF' : 'Add New PDF'}
      </div>
      <div class="ap-page-sub">Fill all details below. PDF publishes instantly on save.</div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="btn btn-secondary btn-sm" onclick="adminCancelEdit()">✕ Cancel</button>
      <button class="btn btn-primary" onclick="adminSavePDF()" id="adminSavePDFBtn" style="min-width:180px">
        ⚡ ${isEdit ? 'Update PDF' : 'Publish Instantly'}
      </button>
    </div>
  </div>

  <div class="ap-layout">
    <!-- ══ LEFT COLUMN ══════════════════════════════════════════════ -->
    <div>

      <!-- ① FILE UPLOADS -->
      <div class="ap-card">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-blue">📁</div>
            File Uploads
          </div>
          ${isEdit ? '<span style="font-size:.72rem;color:var(--text2)">Leave empty to keep existing files</span>' : ''}
        </div>
        <div class="ap-grid-2">
          <div>
            <div class="ap-label">Cover Image ${isEdit ? '' : '<span class="ap-req">*</span>'}</div>
            <div class="ap-upload-zone" id="adminCoverZone" style="margin-top:6px" onclick="document.getElementById('adminCoverFile').click()">
              <input type="file" id="adminCoverFile" accept="image/*" style="display:none" onchange="adminPreviewCover(this)" />
              <div id="adminCoverZoneInner">
                <div style="font-size:1.8rem;margin-bottom:6px">🖼️</div>
                <div style="font-size:.78rem;color:var(--text2);line-height:1.5">Click to upload cover<br><span style="font-size:.68rem;opacity:.7">JPG/PNG · Max 5MB</span></div>
              </div>
              <img id="adminCoverPreview" class="admin-cover-preview" alt="Cover"  loading="lazy" decoding="async" />
            </div>
            <div class="ap-progress-wrap" id="adminCoverProgress">
              <div class="ap-progress-track"><div class="ap-progress-fill" id="adminCoverProgressBar"></div></div>
              <div style="font-size:.68rem;color:var(--text2);margin-top:3px" id="adminCoverProgressText">Uploading…</div>
            </div>
          </div>
          <div>
            <div class="ap-label">PDF File ${isEdit ? '' : '<span class="ap-req">*</span>'}</div>
            <div class="ap-upload-zone" id="adminPDFZone" style="margin-top:6px" onclick="document.getElementById('adminPDFFile').click()">
              <input type="file" id="adminPDFFile" accept=".pdf" style="display:none" onchange="adminPreviewPDF(this)" />
              <div id="adminPDFZoneInner">
                <div style="font-size:1.8rem;margin-bottom:6px">📄</div>
                <div style="font-size:.78rem;color:var(--text2);line-height:1.5">Click to upload PDF<br><span style="font-size:.68rem;opacity:.7">PDF only · Max 100MB</span></div>
              </div>
            </div>
            <div class="ap-progress-wrap" id="adminPDFProgress">
              <div class="ap-progress-track"><div class="ap-progress-fill" id="adminPDFProgressBar"></div></div>
              <div style="font-size:.68rem;color:var(--text2);margin-top:3px" id="adminPDFProgressText">Uploading…</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ② BASIC INFORMATION -->
      <div class="ap-card">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-cyan">✏️</div>
            Basic Information
          </div>
        </div>
        <div class="ap-grid-2" style="margin-bottom:14px">
          <div class="ap-field">
            <label class="ap-label">Title <span class="ap-req">*</span></label>
            <input class="ap-input" id="apTitle" placeholder="e.g. ADRE Grade IV Question Paper 2025" oninput="apAutoSlug()" />
          </div>
          <div class="ap-field">
            <label class="ap-label">Author</label>
            <input class="ap-input" id="apAuthor" placeholder="Author name or board" />
          </div>
        </div>
        <div class="ap-field" style="margin-bottom:14px">
          <label class="ap-label">Description</label>
          <textarea class="ap-input" id="apDesc" rows="3" placeholder="Brief description of the PDF content…"></textarea>
        </div>
        <div class="ap-grid-2" style="margin-bottom:14px">
          <div class="ap-field">
            <label class="ap-label">Slug</label>
            <div style="display:flex;gap:6px">
              <input class="ap-input" id="apSlug" placeholder="auto-generated-slug" style="flex:1" />
              <button class="btn btn-secondary btn-sm" onclick="apAutoSlug(true)" title="Regenerate">↺</button>
            </div>
          </div>
          <div class="ap-field">
            <label class="ap-label">Exam Year</label>
            <input class="ap-input" id="apExamYear" placeholder="e.g. 2025, 2024-25" />
          </div>
        </div>
        <div class="ap-field">
          <label class="ap-label">Badge / Tag</label>
          <select class="ap-input" id="apBadge" onchange="updateAdminPDFPreview()">
            <option value="">No Badge</option>
            ${badges.map(b=>`<option>${b}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- ③ CLASSIFICATION — ALL 6 LEVELS ALWAYS VISIBLE -->
      <div class="ap-card" id="apClassifCard">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-purple">🏷️</div>
            Classification
            <span style="font-size:.68rem;font-weight:500;color:var(--text2);margin-left:4px">— 6 levels, cascade select</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="apRefreshCategories()" title="Reload from DB" style="font-size:.72rem">↺ Reload</button>
        </div>

        <!-- Row 1: Category + Subcategory -->
        <div class="ap-classif-grid" style="margin-bottom:16px">
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-1">Level 1</span>
            <div class="ap-label" style="margin-bottom:4px">Category <span class="ap-req">*</span></div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apCat" onchange="apOnCategoryChange()">
                <option value="">— Select Category —</option>
                ${catOptions}
              </select>
            </div>
          </div>
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-2">Level 2</span>
            <div class="ap-label" style="margin-bottom:4px">Subcategory</div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apSubcat" onchange="apOnSubcategoryChange()">
                <option value="">— select Category first —</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Row 2: Academic Level + Stream -->
        <div class="ap-classif-grid" style="margin-bottom:16px">
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-3">Level 3</span>
            <div class="ap-label" style="margin-bottom:4px">Academic Level</div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apAcademicLevel" onchange="apOnAcademicLevelChange()">
                <option value="">— select Subcategory first —</option>
              </select>
            </div>
          </div>
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-4">Level 4</span>
            <div class="ap-label" style="margin-bottom:4px">Stream</div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apStream" onchange="apOnStreamChange()">
                <option value="">— select Academic Level first —</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Row 3: Semester/Class + Subject -->
        <div class="ap-classif-grid">
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-5">Level 5</span>
            <div class="ap-label" style="margin-bottom:4px">Semester / Class</div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apSemesterClass" onchange="apOnSemesterClassChange()">
                <option value="">— select Stream first —</option>
              </select>
            </div>
          </div>
          <div class="ap-classif-item" style="padding-top:10px">
            <span class="ap-classif-level-badge ap-lvl-6">Level 6</span>
            <div class="ap-label" style="margin-bottom:4px">Subject</div>
            <div class="ap-classif-select-wrap">
              <select class="ap-input" id="apSubject" onchange="updateAdminPDFPreview()">
                <option value="">— select Semester/Class first —</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Selected path display -->
        <div id="apClassifPath" style="margin-top:14px;font-size:.75rem;color:var(--text2);min-height:18px;background:rgba(61,142,248,0.04);padding:8px 12px;border-radius:8px;border:1px solid rgba(61,142,248,0.1)">
          <span style="opacity:.6">Selected path:</span> <span id="apClassifPathText" style="color:var(--accent)">none</span>
        </div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:8px;opacity:.7">
          💡 Only Category is required. Each level cascades from the one above.
        </div>

        <!-- ─── INLINE CLASSIFICATION MANAGEMENT ─────────────────── -->
        <div class="ap-classif-mgmt">
          <div class="ap-classif-mgmt-header" onclick="apToggleCMPanel()">
            <div class="ap-classif-mgmt-title">
              ⚙️ Classification Management
              <span style="font-size:.68rem;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.2);padding:2px 7px;border-radius:10px">Add · Edit · Delete</span>
            </div>
            <span id="apCMToggleIcon" style="color:var(--text2);font-size:.8rem;transition:transform .2s">▼</span>
          </div>

          <div class="ap-classif-mgmt-body" id="apCMBody">
            <!-- Level tabs -->
            <div class="ap-cm-tabs" id="apCMTabs">
              <button class="ap-cm-tab active" data-lvl="categories"    onclick="apCMSwitchLevel('categories')">📂 Category</button>
              <button class="ap-cm-tab"         data-lvl="subcategories" onclick="apCMSwitchLevel('subcategories')">📁 Subcategory</button>
              <button class="ap-cm-tab"         data-lvl="academic_levels" onclick="apCMSwitchLevel('academic_levels')">🎓 Academic Level</button>
              <button class="ap-cm-tab"         data-lvl="streams"       onclick="apCMSwitchLevel('streams')">🌊 Stream</button>
              <button class="ap-cm-tab"         data-lvl="semester_classes" onclick="apCMSwitchLevel('semester_classes')">📅 Semester/Class</button>
              <button class="ap-cm-tab"         data-lvl="subjects"      onclick="apCMSwitchLevel('subjects')">📖 Subject</button>
            </div>

            <!-- Search + Add row -->
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
              <input class="ap-input" id="apCMSearch" placeholder="🔍 Search…" oninput="apCMRenderTable()" style="flex:1;font-size:.8rem;padding:7px 11px" />
              <span id="apCMCount" style="font-size:.75rem;color:var(--text2);white-space:nowrap;font-weight:700"></span>
              <button class="btn btn-primary btn-sm" onclick="apCMOpenAddModal()" style="white-space:nowrap">➕ Add</button>
            </div>

            <!-- Table -->
            <div class="ap-cm-table-wrap" id="apCMTableWrap">
              <div class="ap-cm-empty">Loading…</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ④ SEO OPTIMIZATION -->
      <div class="ap-card">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-green">🔍</div>
            SEO Optimization
          </div>
          <button class="btn btn-secondary btn-sm" onclick="apAutoSEO()" style="font-size:.72rem">✨ Auto-Generate</button>
        </div>
        <div class="ap-field" style="margin-bottom:14px">
          <label class="ap-label">SEO Title <span style="text-transform:none;font-weight:500;color:var(--text2)">(50–60 chars ideal)</span></label>
          <input class="ap-input" id="apSeoTitle" placeholder="SEO Title for Google" />
          <div class="ap-char-count" id="apSeoTitleCount">0 chars</div>
        </div>
        <div class="ap-field" style="margin-bottom:14px">
          <label class="ap-label">Meta Description <span style="text-transform:none;font-weight:500;color:var(--text2)">(150–160 chars ideal)</span></label>
          <textarea class="ap-input" id="apSeoDesc" rows="2" placeholder="Meta description shown in search results…"></textarea>
          <div class="ap-char-count" id="apSeoDescCount">0 chars</div>
        </div>
        <div class="ap-field">
          <label class="ap-label">Keywords <span style="text-transform:none;font-weight:500;color:var(--text2)">(comma separated)</span></label>
          <input class="ap-input" id="apSeoKeywords" placeholder="ADRE, Grade IV, Assam, Question Paper, 2025" />
        </div>
      </div>

      <!-- ⑤ PRICING -->
      <div class="ap-card">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-amber">💰</div>
            Pricing
          </div>
        </div>
        <div class="ap-grid-2" style="margin-bottom:14px">
          <div class="ap-field">
            <label class="ap-label">Original Price (₹)</label>
            <input class="ap-input" id="apOrigPrice" type="number" min="0" placeholder="499" oninput="apCalcDiscount()" />
          </div>
          <div class="ap-field">
            <label class="ap-label">Selling Price (₹) <span class="ap-req">*</span></label>
            <input class="ap-input" id="apSellPrice" type="number" min="0" placeholder="299" oninput="apCalcDiscount()" />
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="apFree" onchange="apToggleFree(this)" style="width:16px;height:16px;cursor:pointer" />
          <label for="apFree" style="font-size:.85rem;cursor:pointer;font-weight:600">Mark as FREE</label>
          <span id="apDiscountBadge" class="ap-discount-badge" style="margin-left:auto"></span>
        </div>
      </div>

      <!-- ⑥ STATISTICS (edit mode only) -->
      <div class="ap-card" id="apStatsSection" style="${isEdit ? '' : 'display:none'}">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-blue">📊</div>
            Statistics
          </div>
        </div>
        <div class="ap-grid-3">
          <div class="ap-field">
            <label class="ap-label">Downloads</label>
            <input class="ap-input" id="apDownloads" type="number" min="0" placeholder="0" />
          </div>
          <div class="ap-field">
            <label class="ap-label">Views</label>
            <input class="ap-input" id="apViews" type="number" min="0" placeholder="0" />
          </div>
          <div class="ap-field">
            <label class="ap-label">Wishlist</label>
            <input class="ap-input" id="apWishlist" type="number" min="0" placeholder="0" />
          </div>
        </div>
      </div>

      <!-- BOTTOM ACTIONS -->
      <div style="display:flex;gap:12px;padding-bottom:40px">
        <button class="btn btn-secondary" onclick="adminCancelEdit()">✕ Cancel</button>
        <button class="btn btn-primary btn-lg" style="flex:1;justify-content:center" onclick="adminSavePDF()" id="adminSavePDFBtn2">
          ⚡ ${isEdit ? 'Update PDF' : 'Publish to Website Instantly'}
        </button>
      </div>
    </div>

    <!-- ══ RIGHT COLUMN — LIVE PREVIEW ════════════════════════════ -->
    <div>
      <div class="ap-card" style="position:sticky;top:80px">
        <div style="font-weight:800;font-size:.88rem;margin-bottom:14px;display:flex;align-items:center;gap:6px">
          <span>👁️</span> Live Preview
        </div>

        <!-- Cover preview -->
        <div class="ap-preview-cover" id="apPreviewCoverWrap">
          <img id="apPreviewCoverImg" alt="Cover"  loading="lazy" decoding="async" />
          <span id="apPreviewBadge" style="position:absolute;top:10px;left:10px;display:none" class="admin-badge admin-badge-gold"></span>
          <span style="opacity:.3;font-size:2.5rem">📄</span>
        </div>

        <div style="font-weight:800;font-size:.95rem;margin-bottom:4px;line-height:1.3" id="apPreviewTitle">PDF Title</div>
        <div style="font-size:.78rem;color:var(--text2);margin-bottom:6px;font-style:italic" id="apPreviewAuthor"></div>
        <div style="font-size:.7rem;color:var(--text2);margin-bottom:10px;line-height:1.5" id="apPreviewCatLine"></div>
        <div style="font-size:1.15rem;font-weight:900;background:var(--grad-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text" id="apPreviewPrice">₹0</div>

        <div style="height:1px;background:var(--glass-border);margin:16px 0"></div>

        <!-- SEO Preview -->
        <div style="font-size:.72rem;font-weight:800;margin-bottom:8px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em">🔍 Google Preview</div>
        <div style="background:var(--surface);border-radius:8px;padding:12px;border:1px solid var(--glass-border)">
          <div style="color:#8ab4f8;font-size:.78rem;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="apGoogleTitle">Page Title</div>
          <div style="color:var(--text3);font-size:.7rem;margin-bottom:5px" id="apGoogleUrl">studyria.in/pdf/slug</div>
          <div style="color:#bdc1c6;font-size:.75rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" id="apGoogleDesc">Meta description will appear here...</div>
        </div>

        <div style="height:1px;background:var(--glass-border);margin:16px 0"></div>
        <div style="font-size:.7rem;color:var(--text2);text-align:center;line-height:1.7;opacity:.75">
          ✨ Publishes instantly after saving.<br>
          Category counts update automatically.
        </div>
      </div>
    </div>
  </div>

  <!-- ── CLASSIFICATION MANAGEMENT MODAL (Add/Edit) ──────────── -->
  <div class="ap-modal-overlay" id="apCMModal">
    <div class="ap-modal-bg" onclick="apCMCloseModal()"></div>
    <div class="ap-modal-box">
      <div id="apCMModalContent"></div>
    </div>
  </div>

  <!-- ── DELETE CONFIRM MODAL ──────────────────────────────────── -->
  <div class="ap-delete-modal" id="apCMDeleteModal">
    <div class="ap-modal-bg" onclick="apCMCloseDeleteModal()"></div>
    <div class="ap-modal-box" style="border-color:rgba(255,77,109,0.3);max-width:380px">
      <div style="font-size:2rem;text-align:center;margin-bottom:10px">🗑️</div>
      <div style="font-weight:800;text-align:center;margin-bottom:8px">Confirm Delete</div>
      <div id="apCMDeleteMsg" style="text-align:center;color:var(--text2);font-size:.83rem;margin-bottom:20px;line-height:1.5"></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" style="flex:1" onclick="apCMCloseDeleteModal()">Cancel</button>
        <button class="btn btn-danger" style="flex:1" id="apCMDeleteConfirmBtn" onclick="apCMConfirmDelete()">🗑️ Delete</button>
      </div>
    </div>
  </div>`;

  // ── Wire up live-preview listeners ──────────────────────────────
  ['apTitle','apAuthor','apSellPrice','apOrigPrice'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateAdminPDFPreview);
  });
  document.getElementById('apBadge')?.addEventListener('change', updateAdminPDFPreview);
  document.getElementById('apCat')?.addEventListener('change', updateAdminPDFPreview);

  // SEO char counters
  document.getElementById('apSeoTitle')?.addEventListener('input', function() {
    const el = document.getElementById('apSeoTitleCount');
    if (el) {
      const n = this.value.length;
      el.textContent = n + ' chars';
      el.className = 'ap-char-count' + (n > 60 ? ' over' : n > 50 ? ' warn' : '');
    }
    updateAdminPDFPreview();
  });
  document.getElementById('apSeoDesc')?.addEventListener('input', function() {
    const el = document.getElementById('apSeoDescCount');
    if (el) {
      const n = this.value.length;
      el.textContent = n + ' chars';
      el.className = 'ap-char-count' + (n > 160 ? ' over' : n > 140 ? ' warn' : '');
    }
    updateAdminPDFPreview();
  });

  // Sync both save buttons
  const btn1 = document.getElementById('adminSavePDFBtn');
  const btn2 = document.getElementById('adminSavePDFBtn2');
  if (btn1 && btn2) {
    btn2.addEventListener('click', () => btn1.click());
  }

  // ── CRITICAL CASCADE FIX: Always reload categories with data-id ──
  (async () => {
    if (!window.supabaseClient) return;
    try {
      const { data, error } = await window.supabaseClient
        .from('categories').select('*').order('sort_order').order('name');
      if (error || !data?.length) return;
      window._dbCategories = data;
      const catEl = document.getElementById('apCat');
      if (!catEl) return;
      const curVal = catEl.value;
      catEl.innerHTML = '<option value="">— Select Category —</option>' +
        data.map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('');
      // Restore previously selected value
      if (curVal) {
        catEl.value = curVal;
        // If editing and we had a category selected, also restore child dropdowns
        if (window._adminEditPrefill) {
          // handled below in pre-fill block
        } else if (curVal) {
          apOnCategoryChange();
        }
      }
    } catch(e) { console.warn('Category cascade reload error:', e); }
  })();

  // Initialize Classification Management
  apCMInit();

  // Pre-fill form if editing
  if (window._adminEditPrefill) {
    const pf = window._adminEditPrefill;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
    setVal('apTitle', pf.title); setVal('apAuthor', pf.author); setVal('apDesc', pf.description);
    setVal('apExamYear', pf.exam_year); setVal('apBadge', pf.badge);
    setVal('apOrigPrice', pf.original_price); setVal('apSellPrice', pf.selling_price ?? pf.price);
    setVal('apSlug', pf.slug); setVal('apSeoTitle', pf.seo_title); setVal('apSeoDesc', pf.seo_description);
    setVal('apSeoKeywords', pf.seo_keywords);
    setVal('apDownloads', pf.download_count); setVal('apViews', pf.views); setVal('apWishlist', pf.wishlist_count);
    if (pf.free || pf.price === 0) {
      const cb = document.getElementById('apFree'); if (cb) cb.checked = true;
    }
    if (pf.cover_url) {
      const img = document.getElementById('apPreviewCoverImg');
      if (img) { img.src = pf.cover_url; img.className = 'loaded'; }
    }
    window._adminEditPrefill = null;
    apCalcDiscount();

    // Restore cascade dropdowns using stored IDs
    (async () => {
      async function apRestoreDropdown(table, filterField, parentId, selectId, storedName) {
        if (!parentId || !window.supabaseClient) return null;
        try {
          const { data } = await window.supabaseClient.from(table).select('*').eq(filterField, parentId).order('sort_order').order('name');
          const el = document.getElementById(selectId);
          if (!el || !data?.length) return null;
          const labelMap = { subcategories:'Select Subcategory…', academic_levels:'Select Academic Level…', streams:'Select Stream…', semester_classes:'Select Semester/Class…', subjects:'Select Subject…' };
          el.innerHTML = `<option value="">${labelMap[table]||'Select…'}</option>` +
            data.map(r => `<option value="${r.name}" data-id="${r.id}">${r.name}</option>`).join('');
          if (storedName) el.value = storedName;
          return el.options[el.selectedIndex]?.dataset?.id || null;
        } catch(e) { return null; }
      }

      // Step 1: Category
      const catEl = document.getElementById('apCat');
      if (catEl && pf.category) catEl.value = pf.category;
      const catId = apGetSelectedId('apCat');

      // Step 2: Subcategory
      const subcatId = await apRestoreDropdown('subcategories','category_id', catId, 'apSubcat', pf.subcategory_id ? (window._dbSubcategories||[]).find(s=>String(s.id)===String(pf.subcategory_id))?.name : null);

      // Step 3: Academic Level
      const levelId = await apRestoreDropdown('academic_levels','subcategory_id', subcatId, 'apAcademicLevel', pf.academic_level_id ? (window._dbAcademicLevels||[]).find(s=>String(s.id)===String(pf.academic_level_id))?.name : null);

      // Step 4: Stream
      const streamId = await apRestoreDropdown('streams','academic_level_id', levelId, 'apStream', pf.stream_id ? (window._dbStreams||[]).find(s=>String(s.id)===String(pf.stream_id))?.name : null);

      // Step 5: Semester/Class
      const semId = await apRestoreDropdown('semester_classes','stream_id', streamId, 'apSemesterClass', pf.semester_class_id ? (window._dbSemesterClasses||[]).find(s=>String(s.id)===String(pf.semester_class_id))?.name : null);

      // Step 6: Subject
      await apRestoreDropdown('subjects','semester_class_id', semId, 'apSubject', pf.subject_id ? (window._dbSubjects||[]).find(s=>String(s.id)===String(pf.subject_id))?.name : null);

      apUpdateClassifPath();
      updateAdminPDFPreview();
    })();
  } else {
    updateAdminPDFPreview();
  }
}


// ══════════════════════════════════════════════════════════════════
// SMART BATCH PUBLISHER — replaces renderAdminAddPDF
// Max 12 PDFs per batch · Queue · AI Suggestions · Bulk Edit · Publish
// ══════════════════════════════════════════════════════════════════

/* ─── State ──────────────────────────────────────────────────────── */
window._sbp = window._sbp || {
  queue: [],          // Array of draft items
  selected: new Set(),// IDs of selected items for bulk edit
  editingId: null,    // Which queue item is open in the editor
  publishing: false,
  maxBatch: 12
};

/* ─── Utilities ─────────────────────────────────────────────────── */
function sbpGenId() {
  return 'sbp_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
}
function sbpGenProductId() {
  return 'PROD-' + Date.now().toString(36).toUpperCase().slice(-6) +
         Math.random().toString(36).toUpperCase().slice(2,5);
}
function sbpSlug(str) {
  return (str||'').toLowerCase()
    .replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').trim() +
    '-' + Date.now().toString(36);
}
function sbpFormatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(0) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}
function sbpStatus(item) {
  const errs = sbpValidate(item, false);
  if (item.published) return 'published';
  if (errs.length === 0) return 'ready';
  const required = ['cover','pdf','title','category'];
  const hasCritical = errs.some(e => required.some(r => e.toLowerCase().includes(r)));
  return hasCritical ? 'missing' : 'draft';
}
function sbpStatusLabel(s) {
  return {ready:'✅ Ready', draft:'📝 Draft', missing:'⚠️ Missing', published:'🟢 Published', error:'❌ Error'}[s] || s;
}
function sbpStatusColor(s) {
  return {ready:'#10d98e', draft:'#f59e0b', missing:'#ff4d6d', published:'#3d8ef8', error:'#ff4d6d'}[s] || '#aaa';
}

/* ─── Validation ─────────────────────────────────────────────────── */
function sbpValidate(item, checkDupes) {
  const errors = [];
  if (!item.coverFile && !item.coverUrl) errors.push('Cover image is required');
  if (!item.pdfFile && !item.pdfUrl) errors.push('PDF file is required');
  if (!item.title?.trim()) errors.push('Title is required');
  if (!item.description?.trim()) errors.push('Description is required');
  if (!item.category?.trim()) errors.push('Category is required');
  if (!item.badge?.trim()) errors.push('Badge is required');
  if (!item.seoTitle?.trim()) errors.push('SEO Title is required');
  if (!item.seoDesc?.trim()) errors.push('Meta Description is required');
  if (!item.keywords?.trim()) errors.push('Keywords are required');
  if (item.sellingPrice === undefined || item.sellingPrice === '' || item.sellingPrice === null)
    errors.push('Selling price is required');
  if (checkDupes) {
    const q = window._sbp.queue;
    const dupTitle = q.filter(x => x.id !== item.id && x.title?.trim().toLowerCase() === item.title?.trim().toLowerCase());
    if (dupTitle.length) errors.push('Duplicate title detected in queue');
    const dupPdf = q.filter(x => x.id !== item.id && x.pdfFile && item.pdfFile && x.pdfFile.name === item.pdfFile.name && x.pdfFile.size === item.pdfFile.size);
    if (dupPdf.length) errors.push('Duplicate PDF file detected in queue');
  }
  return errors;
}

/* ─── AI Suggestions (Claude API) ───────────────────────────────── */
async function sbpAISuggest(item) {
  try {
    const prompt = `You are an expert product manager for Studyria, India's top PDF study platform.
Given this PDF info:
- Filename: ${item.pdfFile?.name || item.title || 'Unknown'}
- Current title: ${item.title || ''}
- Category: ${item.category || ''}

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "title": "Improved product title (max 70 chars)",
  "category": "Best category from: School Education, Higher Education, Government Exams, Engineering, Medicine, Law, Finance, CS & Technology, Design, Science, Commerce, Agriculture, Architecture, Pharmacy, Nursing",
  "badge": "One of: Bestseller, New Arrival, Hot, Trending, Editor's Choice, Top Rated, Most Downloaded, Premium, Verified, Staff Pick, Exam Ready, Quick Revision, Comprehensive",
  "tags": "comma-separated keywords (10-15 tags)",
  "seoTitle": "SEO title 50-60 chars",
  "metaDescription": "Meta description 150-160 chars",
  "sellingPrice": suggested_price_in_INR_as_number
}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = (data.content||[]).map(c=>c.text||'').join('').replace(/```json|```/g,'').trim();
    return JSON.parse(text);
  } catch(e) {
    console.warn('AI suggest error:', e);
    return null;
  }
}

/* ─── Cover thumbnail from PDF file ─────────────────────────────── */
async function sbpPdfThumbnail(pdfFile) {
  try {
    if (!window.pdfjsLib) return null;
    const ab = await pdfFile.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 0.4 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch(e) { return null; }
}

/* ─── Add files to queue ─────────────────────────────────────────── */
async function sbpAddFiles(files) {
  const q = window._sbp.queue;
  const remaining = window._sbp.maxBatch - q.length;
  if (remaining <= 0) {
    showToast(`Queue full! Maximum ${window._sbp.maxBatch} PDFs per batch.`, 'error');
    return;
  }
  const toAdd = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf')).slice(0, remaining);
  if (!toAdd.length) { showToast('Please select PDF files only.', 'error'); return; }
  if (files.length > remaining) showToast(`Only ${remaining} slot(s) remaining. Added ${toAdd.length} of ${files.length}.`, 'warning');

  for (const file of toAdd) {
    const id = sbpGenId();
    const titleGuess = file.name.replace(/\.pdf$/i,'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim();
    const slugVal = sbpSlug(titleGuess);
    const thumb = await sbpPdfThumbnail(file);
    const item = {
      id, pdfFile: file, coverFile: null, coverUrl: null, coverThumb: thumb,
      title: titleGuess, description: '', author: '', category: '', badge: '',
      seoTitle: '', seoDesc: '', keywords: '', originalPrice: '', sellingPrice: '',
      previewPages: '', slug: slugVal, productId: sbpGenProductId(),
      publishDate: new Date().toISOString(), lastUpdated: new Date().toISOString(),
      pdfUrl: null, status: 'draft', aiLoading: false, errors: [], published: false
    };
    q.push(item);
  }
  sbpRenderQueue();
  sbpUpdateStats();
}

/* ─── Remove / Duplicate / Move ──────────────────────────────────── */
function sbpRemove(id) {
  window._sbp.queue = window._sbp.queue.filter(x => x.id !== id);
  window._sbp.selected.delete(id);
  if (window._sbp.editingId === id) { window._sbp.editingId = null; sbpHideEditor(); }
  sbpRenderQueue(); sbpUpdateStats();
}
function sbpDuplicate(id) {
  const q = window._sbp.queue;
  if (q.length >= window._sbp.maxBatch) { showToast('Queue is full (max 12).', 'error'); return; }
  const src = q.find(x => x.id === id);
  if (!src) return;
  const newItem = JSON.parse(JSON.stringify({...src, pdfFile:null, coverFile:null}));
  newItem.id = sbpGenId(); newItem.productId = sbpGenProductId();
  newItem.title = (src.title || '') + ' (Copy)';
  newItem.slug = sbpSlug(newItem.title);
  newItem.published = false; newItem.pdfUrl = null; newItem.coverUrl = src.coverUrl;
  newItem.coverThumb = src.coverThumb;
  const idx = q.findIndex(x => x.id === id);
  q.splice(idx + 1, 0, newItem);
  sbpRenderQueue(); sbpUpdateStats();
}
function sbpMoveUp(id) {
  const q = window._sbp.queue;
  const i = q.findIndex(x => x.id === id);
  if (i > 0) { [q[i-1], q[i]] = [q[i], q[i-1]]; sbpRenderQueue(); }
}
function sbpMoveDown(id) {
  const q = window._sbp.queue;
  const i = q.findIndex(x => x.id === id);
  if (i < q.length - 1) { [q[i+1], q[i]] = [q[i], q[i+1]]; sbpRenderQueue(); }
}

/* ─── AI button per card ─────────────────────────────────────────── */
async function sbpRunAI(id) {
  const item = window._sbp.queue.find(x => x.id === id);
  if (!item || item.aiLoading) return;
  item.aiLoading = true;
  sbpRenderQueue();
  const sug = await sbpAISuggest(item);
  if (sug) {
    if (sug.title)           item.title       = sug.title;
    if (sug.category)        item.category    = sug.category;
    if (sug.badge)           item.badge       = sug.badge;
    if (sug.tags)            item.keywords    = sug.tags;
    if (sug.seoTitle)        item.seoTitle    = sug.seoTitle;
    if (sug.metaDescription) item.seoDesc     = sug.metaDescription;
    if (sug.sellingPrice)    item.sellingPrice = sug.sellingPrice;
    showToast(`✨ AI suggestions applied to "${item.title.slice(0,30)}…"`, 'success');
  } else {
    showToast('AI suggestion failed. Try again.', 'error');
  }
  item.aiLoading = false;
  sbpRenderQueue(); sbpUpdateStats();
  // If this item is open in editor, refresh editor
  if (window._sbp.editingId === id) sbpOpenEditor(id);
}

/* ─── Cover file for a queue item ───────────────────────────────── */
function sbpSetCover(id, file) {
  const item = window._sbp.queue.find(x => x.id === id);
  if (!item || !file) return;
  item.coverFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    item.coverThumb = e.target.result;
    item.coverUrl = null;
    sbpRenderCard(id);
  };
  reader.readAsDataURL(file);
}

/* ─── Stats bar update ───────────────────────────────────────────── */
function sbpUpdateStats() {
  const q = window._sbp.queue;
  const total = q.length;
  const ready = q.filter(x => sbpStatus(x) === 'ready').length;
  const draft = q.filter(x => sbpStatus(x) === 'draft').length;
  const missing = q.filter(x => sbpStatus(x) === 'missing').length;
  const published = q.filter(x => x.published).length;
  const errs = q.filter(x => sbpStatus(x) === 'error').length;

  const el = id => document.getElementById(id);
  const s = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  s('sbpStatTotal', total); s('sbpStatReady', ready);
  s('sbpStatDraft', draft); s('sbpStatMissing', missing);
  s('sbpStatErrors', errs); s('sbpStatPublished', published);

  const btn = el('sbpPublishBtn');
  if (btn) {
    btn.disabled = ready === 0 || window._sbp.publishing;
    btn.innerHTML = ready > 0
      ? `🚀 Publish Ready PDFs (${ready})`
      : '🚀 Publish Ready PDFs';
  }
  // Bulk edit button
  const bulkBtn = el('sbpBulkEditBtn');
  if (bulkBtn) bulkBtn.disabled = window._sbp.selected.size === 0;

  // Show/hide empty state
  const empty = el('sbpEmptyState');
  const qList = el('sbpQueueList');
  if (empty) empty.style.display = total === 0 ? '' : 'none';
  if (qList) qList.style.display = total === 0 ? 'none' : '';
}

/* ─── Selection ──────────────────────────────────────────────────── */
function sbpToggleSelect(id) {
  if (window._sbp.selected.has(id)) window._sbp.selected.delete(id);
  else window._sbp.selected.add(id);
  const cb = document.getElementById('sbpCb_' + id);
  if (cb) cb.checked = window._sbp.selected.has(id);
  sbpUpdateStats();
}
function sbpSelectAll() {
  const q = window._sbp.queue.filter(x => !x.published);
  const allSelected = q.every(x => window._sbp.selected.has(x.id));
  if (allSelected) { window._sbp.selected.clear(); }
  else { q.forEach(x => window._sbp.selected.add(x.id)); }
  sbpRenderQueue(); sbpUpdateStats();
}

/* ─── Render a single card ───────────────────────────────────────── */
function sbpRenderCard(id) {
  const item = window._sbp.queue.find(x => x.id === id);
  const el = document.getElementById('sbpCard_' + id);
  if (!item || !el) return;
  const st = sbpStatus(item);
  const col = sbpStatusColor(st);
  const thumb = item.coverThumb || item.coverUrl || '';
  const sel = window._sbp.selected.has(id);
  el.innerHTML = sbpCardInner(item, st, col, thumb, sel);
}

function sbpCardInner(item, st, col, thumb, sel) {
  const q = window._sbp.queue;
  const idx = q.findIndex(x => x.id === item.id);
  const isFirst = idx === 0, isLast = idx === q.length - 1;
  return `
    <div style="display:flex;gap:12px;align-items:flex-start">
      <!-- Checkbox -->
      <div style="padding-top:2px;flex-shrink:0">
        <input type="checkbox" id="sbpCb_${item.id}" ${sel?'checked':''} ${item.published?'disabled':''}
          onchange="sbpToggleSelect('${item.id}')"
          style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)" />
      </div>
      <!-- Thumbnail -->
      <div style="width:52px;height:70px;border-radius:6px;overflow:hidden;background:rgba(61,142,248,0.1);flex-shrink:0;border:1px solid var(--glass-border);position:relative;cursor:pointer" onclick="sbpTriggerCoverPick('${item.id}')">
        ${thumb ? `<img src="${thumb}" alt="${(item.title || 'PDF cover').replace(/"/g,'&quot;')}" style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async"/>` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:1.3rem">📄</div>'}
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0;transition:.2s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0" title="Change cover">🖼️</div>
        <input type="file" accept="image/*" style="display:none" id="sbpCoverPick_${item.id}" onchange="sbpSetCover('${item.id}',this.files[0])"/>
      </div>
      <!-- Info -->
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px" title="${(item.title||'').replace(/"/g,'&quot;')}">${item.title || '<em style="color:var(--text3)">Untitled</em>'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">
          <span style="font-size:.7rem;padding:2px 7px;border-radius:10px;background:${col}22;color:${col};border:1px solid ${col}44;font-weight:700">${sbpStatusLabel(st)}</span>
          ${item.category ? `<span style="font-size:.68rem;color:var(--text2);background:var(--surface);padding:1px 7px;border-radius:8px">${item.category}</span>` : ''}
          ${item.sellingPrice !== '' && item.sellingPrice !== undefined && item.sellingPrice !== null ? `<span style="font-size:.68rem;color:var(--success);font-weight:700">₹${item.sellingPrice}</span>` : ''}
        </div>
        <div style="font-size:.68rem;color:var(--text3)">${item.pdfFile ? item.pdfFile.name + ' · ' + sbpFormatSize(item.pdfFile.size) : (item.pdfUrl ? '📎 File linked' : '⚠️ No PDF')}</div>
      </div>
      <!-- Actions -->
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
        <div style="display:flex;gap:4px">
          <button onclick="sbpOpenEditor('${item.id}')" title="Edit" style="padding:5px 8px;border-radius:6px;border:1px solid var(--accent);background:rgba(61,142,248,0.1);color:var(--accent);cursor:pointer;font-size:.75rem;font-family:var(--font-body)">✏️</button>
          ${!item.published ? `<button onclick="sbpRunAI('${item.id}')" title="AI Suggest" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(139,92,246,0.4);background:rgba(139,92,246,0.1);color:#8b5cf6;cursor:pointer;font-size:.75rem;font-family:var(--font-body)">${item.aiLoading?'⏳':'✨'}</button>` : ''}
          <button onclick="sbpDuplicate('${item.id}')" title="Duplicate" style="padding:5px 8px;border-radius:6px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:.75rem;font-family:var(--font-body)">⧉</button>
        </div>
        <div style="display:flex;gap:4px">
          <button onclick="sbpMoveUp('${item.id}')" ${isFirst?'disabled':''} title="Move Up" style="padding:5px 8px;border-radius:6px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:.75rem;font-family:var(--font-body);opacity:${isFirst?.4:1}">↑</button>
          <button onclick="sbpMoveDown('${item.id}')" ${isLast?'disabled':''} title="Move Down" style="padding:5px 8px;border-radius:6px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:.75rem;font-family:var(--font-body);opacity:${isLast?.4:1}">↓</button>
          ${!item.published ? `<button onclick="sbpRemove('${item.id}')" title="Remove" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,77,109,0.3);background:rgba(255,77,109,0.07);color:#ff4d6d;cursor:pointer;font-size:.75rem;font-family:var(--font-body)">✕</button>` : ''}
        </div>
      </div>
    </div>`;
}

function sbpTriggerCoverPick(id) {
  document.getElementById('sbpCoverPick_' + id)?.click();
}

/* ─── Render full queue ──────────────────────────────────────────── */
function sbpRenderQueue() {
  const list = document.getElementById('sbpQueueList');
  if (!list) return;
  const q = window._sbp.queue;
  list.innerHTML = q.map(item => {
    const st = sbpStatus(item);
    const col = sbpStatusColor(st);
    const thumb = item.coverThumb || item.coverUrl || '';
    const sel = window._sbp.selected.has(item.id);
    return `<div id="sbpCard_${item.id}" style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:12px;margin-bottom:8px;transition:border-color .2s;border-left:3px solid ${col}">${sbpCardInner(item, st, col, thumb, sel)}</div>`;
  }).join('');
  sbpUpdateStats();
}

/* ─── Editor panel ───────────────────────────────────────────────── */
function sbpOpenEditor(id) {
  window._sbp.editingId = id;
  const item = window._sbp.queue.find(x => x.id === id);
  if (!item) return;
  const isMobile = window.innerWidth <= 900;
  const panel = isMobile
    ? document.getElementById('sbpMobileEditorBody')
    : document.getElementById('sbpEditorPanel');
  if (!panel) return;

  const dbCats = window._dbCategories || [];
  const catOptions = (dbCats.length
    ? dbCats.map(c => `<option value="${c.name}" ${item.category===c.name?'selected':''}>${c.name}</option>`)
    : ['School Education','Higher Education','Government Exams','Engineering','Medicine','Law','Finance','CS & Technology','Design','Science','Commerce','Agriculture','Architecture','Pharmacy','Nursing'].map(c => `<option value="${c}" ${item.category===c?'selected':''}>${c}</option>`)
  ).join('');

  const badges = ['Bestseller','New Arrival','Hot','Trending','Editor\'s Choice','Top Rated','Most Downloaded','IIT Expert','IIM Expert','Premium','Verified','Staff Pick','Limited Edition','Exclusive','Must Have','Exam Ready','Quick Revision','Comprehensive','Updated 2025','Gold Standard','Platinum','Silver','Bronze','Featured'];

  const errors = sbpValidate(item, true);

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--glass-border)">
      <div style="font-weight:800;font-size:.95rem;display:flex;align-items:center;gap:8px">
        <span style="background:rgba(61,142,248,0.15);color:var(--accent);width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.8rem">✏️</span>
        Edit Draft
      </div>
      <button onclick="sbpCloseEditor()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:1.1rem;padding:0 4px">✕</button>
    </div>

    ${errors.length ? `<div style="background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.2);border-radius:8px;padding:10px 13px;margin-bottom:16px">
      <div style="font-size:.75rem;font-weight:700;color:#ff4d6d;margin-bottom:6px">⚠️ ${errors.length} issue(s) to fix:</div>
      ${errors.map(e=>`<div style="font-size:.72rem;color:#ff8fa8;margin-bottom:2px">• ${e}</div>`).join('')}
    </div>` : `<div style="background:rgba(16,217,142,0.08);border:1px solid rgba(16,217,142,0.2);border-radius:8px;padding:8px 12px;margin-bottom:16px;font-size:.75rem;color:#10d98e;font-weight:700">✅ All fields complete — Ready to publish!</div>`}

    <!-- Cover Upload -->
    <div style="margin-bottom:16px">
      <div class="ap-label" style="margin-bottom:6px">Cover Image *</div>
      <div style="border:2px dashed ${item.coverFile||item.coverThumb||item.coverUrl?'var(--success)':'var(--glass-border)'};border-radius:8px;padding:12px;text-align:center;cursor:pointer;position:relative;background:rgba(255,255,255,0.02)" onclick="document.getElementById('sbpEditCover').click()">
        <input type="file" id="sbpEditCover" accept="image/*" style="display:none" onchange="sbpEditorSetCover(this)"/>
        ${item.coverThumb||item.coverUrl ? `<img src="${item.coverThumb||item.coverUrl}" alt="${(item.title || 'PDF cover').replace(/"/g,'&quot;')}" style="max-height:80px;border-radius:6px;max-width:100%"/>
        <div style="font-size:.7rem;color:var(--success);margin-top:4px">✅ Cover ready · Click to change</div>` :
        '<div style="font-size:1.5rem">🖼️</div><div style="font-size:.75rem;color:var(--text2)">Click to upload cover</div>'}
      </div>
    </div>

    <!-- PDF File info -->
    <div style="margin-bottom:16px;background:var(--surface);border-radius:8px;padding:10px 13px;border:1px solid var(--glass-border)">
      <div class="ap-label" style="margin-bottom:4px">PDF File</div>
      ${item.pdfFile ? `<div style="font-size:.8rem;font-weight:600">📄 ${item.pdfFile.name}</div>
      <div style="font-size:.7rem;color:var(--text2)">${sbpFormatSize(item.pdfFile.size)}</div>` :
      `<div style="font-size:.78rem;color:#ff4d6d">⚠️ No PDF file attached</div>`}
    </div>

    <!-- Title -->
    <div style="margin-bottom:12px">
      <label class="ap-label">Title *</label>
      <input class="ap-input" id="sbeTitle" value="${(item.title||'').replace(/"/g,'&quot;')}" placeholder="PDF Title" oninput="sbpEditorLive()" style="margin-top:5px"/>
    </div>

    <!-- Description -->
    <div style="margin-bottom:12px">
      <label class="ap-label">Description *</label>
      <textarea class="ap-input" id="sbeDesc" rows="3" placeholder="Brief description…" oninput="sbpEditorLive()" style="margin-top:5px">${item.description||''}</textarea>
    </div>

    <!-- Author + Category -->
    <div class="sbp-field-row">
      <div>
        <label class="ap-label">Author</label>
        <input class="ap-input" id="sbeAuthor" value="${(item.author||'').replace(/"/g,'&quot;')}" placeholder="Author" oninput="sbpEditorLive()" style="margin-top:5px"/>
      </div>
      <div>
        <label class="ap-label">Category *</label>
        <select class="ap-input" id="sbeCat" onchange="sbpEditorLive()" style="margin-top:5px">
          <option value="">— Select —</option>
          ${catOptions}
        </select>
      </div>
    </div>

    <!-- Badge -->
    <div style="margin-bottom:12px">
      <label class="ap-label">Badge *</label>
      <select class="ap-input" id="sbeBadge" onchange="sbpEditorLive()" style="margin-top:5px">
        <option value="">— No Badge —</option>
        ${badges.map(b=>`<option value="${b}" ${item.badge===b?'selected':''}>${b}</option>`).join('')}
      </select>
    </div>

    <!-- SEO -->
    <div style="background:rgba(16,217,142,0.04);border:1px solid rgba(16,217,142,0.12);border-radius:8px;padding:14px;margin-bottom:12px">
      <div style="font-size:.78rem;font-weight:800;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
        🔍 SEO
        <button onclick="sbpEditorAutoSEO()" style="font-size:.68rem;padding:3px 9px;border-radius:8px;border:1px solid rgba(16,217,142,0.3);background:rgba(16,217,142,0.1);color:var(--success);cursor:pointer;font-family:var(--font-body)">✨ Auto</button>
      </div>
      <input class="ap-input" id="sbeSeoTitle" value="${(item.seoTitle||'').replace(/"/g,'&quot;')}" placeholder="SEO Title (50-60 chars) *" oninput="sbpEditorLive()" style="margin-bottom:8px"/>
      <textarea class="ap-input" id="sbeSeoDesc" rows="2" placeholder="Meta Description (150-160 chars) *" oninput="sbpEditorLive()">${item.seoDesc||''}</textarea>
      <input class="ap-input" id="sbeKeywords" value="${(item.keywords||'').replace(/"/g,'&quot;')}" placeholder="Keywords, comma separated *" oninput="sbpEditorLive()" style="margin-top:8px"/>
    </div>

    <!-- Pricing -->
    <div class="sbp-field-row">
      <div>
        <label class="ap-label">Original Price (₹)</label>
        <input class="ap-input" id="sbeOrigPrice" type="number" min="0" value="${item.originalPrice||''}" placeholder="499" oninput="sbpEditorLive()" style="margin-top:5px"/>
      </div>
      <div>
        <label class="ap-label">Selling Price (₹) *</label>
        <input class="ap-input" id="sbeSellPrice" type="number" min="0" value="${item.sellingPrice||''}" placeholder="299" oninput="sbpEditorLive()" style="margin-top:5px"/>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;font-weight:600">
        <input type="checkbox" id="sbeFree" ${item.free?'checked':''} onchange="sbpEditorLive()" style="width:15px;height:15px;accent-color:var(--accent)"/> Mark as FREE
      </label>
    </div>

    <!-- Preview Pages -->
    <div style="margin-bottom:16px">
      <label class="ap-label">Preview Pages</label>
      <input class="ap-input" id="sbePreview" value="${(item.previewPages||'').replace(/"/g,'&quot;')}" placeholder="e.g. 1-5" oninput="sbpEditorLive()" style="margin-top:5px"/>
    </div>

    <!-- Auto-fields (read only) -->
    <div style="background:var(--surface);border-radius:8px;padding:10px 13px;border:1px solid var(--glass-border);margin-bottom:16px;font-size:.72rem;color:var(--text2);line-height:1.8">
      <div style="font-weight:700;margin-bottom:4px">🔑 Auto-Generated Fields</div>
      <div>Product ID: <code style="color:var(--accent)">${item.productId}</code></div>
      <div>Slug: <code style="color:var(--accent)">${item.slug}</code></div>
      <div>Publish Date: <code style="color:var(--accent)">${new Date(item.publishDate).toLocaleDateString('en-IN')}</code></div>
    </div>

    <div style="display:flex;gap:8px">
      <button onclick="sbpEditorSave()" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--grad-primary);color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;font-family:var(--font-body)">💾 Save Draft</button>
      <button onclick="sbpCloseEditor()" style="padding:10px 16px;border-radius:8px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-family:var(--font-body)">Cancel</button>
    </div>`;

  const isMob = window.innerWidth <= 900;
  if (isMob) {
    const modal = document.getElementById('sbpMobileEditorModal');
    if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
  } else {
    const desktopPanel = document.getElementById('sbpEditorPanel');
    if (desktopPanel) desktopPanel.style.display = '';
    const ph = document.getElementById('sbpEditorPlaceholder');
    if (ph) ph.style.display = 'none';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function sbpCloseEditor() {
  window._sbp.editingId = null;
  // Close desktop panel
  const panel = document.getElementById('sbpEditorPanel');
  if (panel) panel.style.display = 'none';
  // Close mobile modal
  const modal = document.getElementById('sbpMobileEditorModal');
  if (modal) modal.classList.remove('open');
  // Show placeholder
  const ph = document.getElementById('sbpEditorPlaceholder');
  if (ph) ph.style.display = '';
}

function sbpEditorLive() {
  const id = window._sbp.editingId;
  if (!id) return;
  const item = window._sbp.queue.find(x => x.id === id);
  if (!item) return;
  const g = eid => document.getElementById(eid)?.value ?? '';
  item.title        = g('sbeTitle');
  item.description  = g('sbeDesc');
  item.author       = g('sbeAuthor');
  item.category     = g('sbeCat');
  item.badge        = g('sbeBadge');
  item.seoTitle     = g('sbeSeoTitle');
  item.seoDesc      = g('sbeSeoDesc');
  item.keywords     = g('sbeKeywords');
  item.originalPrice = g('sbeOrigPrice');
  item.sellingPrice  = g('sbeSellPrice');
  item.previewPages  = g('sbePreview');
  item.free          = document.getElementById('sbeFree')?.checked || false;
  item.slug          = sbpSlug(item.title);
  item.lastUpdated   = new Date().toISOString();
  sbpRenderCard(id);
}

function sbpEditorSetCover(input) {
  const file = input.files[0];
  if (!file) return;
  const id = window._sbp.editingId;
  if (!id) return;
  sbpSetCover(id, file);
  // Re-render editor to show new cover
  setTimeout(() => sbpOpenEditor(id), 50);
}

function sbpEditorAutoSEO() {
  const title    = document.getElementById('sbeTitle')?.value || '';
  const category = document.getElementById('sbeCat')?.value || '';
  const seo = autoGenerateSEO(title, category, '', '');
  if (document.getElementById('sbeSeoTitle'))    document.getElementById('sbeSeoTitle').value   = seo.seoTitle?.slice(0,60) || '';
  if (document.getElementById('sbeSeoDesc'))     document.getElementById('sbeSeoDesc').value    = seo.desc?.slice(0,160)   || '';
  if (document.getElementById('sbeKeywords'))    document.getElementById('sbeKeywords').value   = seo.keywords || '';
  sbpEditorLive();
}

function sbpEditorSave() {
  sbpEditorLive();
  sbpCloseEditor();
  sbpRenderQueue(); sbpUpdateStats();
  showToast('✅ Draft saved!', 'success');
}

/* ─── Bulk Edit Modal ────────────────────────────────────────────── */
function sbpOpenBulkEdit() {
  const sel = [...window._sbp.selected];
  if (!sel.length) return;
  const modal = document.getElementById('sbpBulkModal');
  if (!modal) return;
  const dbCats = window._dbCategories || [];
  const catOpts = (dbCats.length
    ? dbCats.map(c=>`<option value="${c.name}">${c.name}</option>`)
    : ['School Education','Higher Education','Government Exams','Engineering','Medicine','Law','Finance','CS & Technology','Design','Science','Commerce','Agriculture','Architecture','Pharmacy','Nursing'].map(c=>`<option>${c}</option>`)
  ).join('');
  const badges = ['Bestseller','New Arrival','Hot','Trending','Editor\'s Choice','Top Rated','Most Downloaded','IIT Expert','IIM Expert','Premium','Verified','Staff Pick','Limited Edition','Exclusive','Must Have','Exam Ready','Quick Revision','Comprehensive','Updated 2025','Gold Standard','Platinum','Silver','Bronze','Featured'];

  document.getElementById('sbpBulkModalBody').innerHTML = `
    <div style="font-size:.82rem;color:var(--text2);margin-bottom:16px">Applying to <strong>${sel.length}</strong> selected PDF(s). Leave blank to skip that field.</div>
    <div class="sbp-field-row">
      <div><label class="ap-label">Category</label><select class="ap-input" id="bulkCat" style="margin-top:5px"><option value="">— skip —</option>${catOpts}</select></div>
      <div><label class="ap-label">Badge</label><select class="ap-input" id="bulkBadge" style="margin-top:5px"><option value="">— skip —</option>${badges.map(b=>`<option>${b}</option>`).join('')}</select></div>
    </div>
    <div class="sbp-field-row">
      <div><label class="ap-label">Selling Price (₹)</label><input class="ap-input" id="bulkPrice" type="number" min="0" placeholder="skip" style="margin-top:5px"/></div>
      <div><label class="ap-label">Author</label><input class="ap-input" id="bulkAuthor" placeholder="skip" style="margin-top:5px"/></div>
    </div>
    <div style="margin-bottom:12px">
      <label class="ap-label">SEO Keywords</label>
      <input class="ap-input" id="bulkKeywords" placeholder="comma separated, skip if blank" style="margin-top:5px"/>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="sbpApplyBulk()" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--grad-primary);color:#fff;font-weight:700;cursor:pointer;font-family:var(--font-body)">✅ Apply to ${sel.length} PDFs</button>
      <button onclick="sbpCloseBulkModal()" style="padding:10px 14px;border-radius:8px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-family:var(--font-body)">Cancel</button>
    </div>`;
  modal.classList.add('open');
}

function sbpCloseBulkModal() {
  document.getElementById('sbpBulkModal')?.classList.remove('open');
}

function sbpApplyBulk() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const cat = g('bulkCat'), badge = g('bulkBadge'), price = g('bulkPrice'),
        author = g('bulkAuthor'), kw = g('bulkKeywords');
  const sel = [...window._sbp.selected];
  sel.forEach(id => {
    const item = window._sbp.queue.find(x => x.id === id);
    if (!item || item.published) return;
    if (cat)   item.category     = cat;
    if (badge) item.badge        = badge;
    if (price) item.sellingPrice = parseFloat(price);
    if (author) item.author      = author;
    if (kw)    item.keywords     = kw;
    item.lastUpdated = new Date().toISOString();
  });
  sbpCloseBulkModal();
  sbpRenderQueue(); sbpUpdateStats();
  showToast(`✅ Applied to ${sel.length} PDF(s).`, 'success');
}

/* ─── Publish ────────────────────────────────────────────────────── */
async function sbpPublishReady() {
  if (window._sbp.publishing) return;
  const ready = window._sbp.queue.filter(x => sbpStatus(x) === 'ready');
  if (!ready.length) { showToast('No ready PDFs to publish.', 'error'); return; }
  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return; }

  window._sbp.publishing = true;
  sbpUpdateStats();

  let published = 0, failed = 0, skipped = 0;
  const startTime = Date.now();
  const failedItems = [];
  const total = ready.length;

  const progEl = document.getElementById('sbpProgressArea');
  const progBar = document.getElementById('sbpProgressBar');
  const progText = document.getElementById('sbpProgressText');
  if (progEl) progEl.style.display = '';

  for (let i = 0; i < ready.length; i++) {
    const item = ready[i];
    const pct = Math.round(((i+1)/total)*100);
    if (progText) progText.textContent = `Publishing ${i+1}/${total}: "${(item.title||'').slice(0,30)}…"`;
    if (progBar) progBar.style.width = pct + '%';

    // Re-validate with dupe check
    const errs = sbpValidate(item, true);
    if (errs.length) { item.errors = errs; failed++; failedItems.push({item, reason: errs[0]}); continue; }

    try {
      const sb = window.supabaseClient;
      const slug = item.slug || sbpSlug(item.title);

      // Upload cover
      let coverUrl = item.coverUrl;
      if (item.coverFile) {
        const ext = item.coverFile.name.split('.').pop().toLowerCase();
        const fp = `${Date.now()}_${slug.slice(0,30)}.${ext}`;
        const { error: cErr } = await sb.storage.from('covers').upload(fp, item.coverFile, { upsert: true, contentType: item.coverFile.type });
        if (cErr) throw new Error('Cover upload: ' + cErr.message);
        const { data: cd } = sb.storage.from('covers').getPublicUrl(fp);
        coverUrl = cd?.publicUrl;
      }

      // Upload PDF
      let pdfUrl = item.pdfUrl;
      if (item.pdfFile) {
        const fp2 = `${Date.now()}_${slug.slice(0,30)}.pdf`;
        const { error: pErr } = await sb.storage.from('pdfs').upload(fp2, item.pdfFile, { upsert: true, contentType: 'application/pdf' });
        if (pErr) throw new Error('PDF upload: ' + pErr.message);
        pdfUrl = fp2;
      }

      // ── Resolve classification IDs — prefer the ID already captured
      //    by the premium classification editor (item.*Id), falling back
      //    to a name→id lookup against the live category list. ─────────
      const categoryId = item.categoryId || (window._dbCategories||[]).find(c=>c.name===item.category)?.id || null;
      const subcategoryId    = item.subcategoryId    || null;
      const academicLevelId  = item.academicLevelId  || null;
      const streamId         = item.streamId         || null;
      const semesterClassId  = item.semesterClassId  || null;
      const subjectId        = item.subjectId        || null;

      // ── VALIDATION: DB must only ever receive numeric IDs, never names.
      //    category, category_id, subcategory_id, academic_level_id,
      //    stream_id, semester_class_id, subject_id must each be numeric
      //    (or null when the field is optional/unselected). If any
      //    resolved value is non-numeric, STOP — do not send SQL. ──────
      const _isNumericId = v => v === null || v === undefined || v === '' || /^\d+$/.test(String(v));
      const _idFields = { categoryId, subcategoryId, academicLevelId, streamId, semesterClassId, subjectId };
      const _badField = Object.entries(_idFields).find(([,v]) => !_isNumericId(v));
      if (_badField) {
        throw new Error(`Invalid category mapping. (${_badField[0]} = "${_badField[1]}" is not a valid ID — please re-select it from the dropdown.)`);
      }
      if (!categoryId) {
        throw new Error('Invalid category mapping. (Category is required and must be selected from the dropdown.)');
      }

      const payload = {
        title:           item.title,
        author:          item.author || null,
        category:        item.category,
        category_id:     categoryId,
        description:     item.description || null,
        preview:         item.previewPages || item.description || null,
        selling_price:   item.free ? 0 : (parseFloat(item.sellingPrice)||0),
        original_price:  parseFloat(item.originalPrice)||null,
        price:           item.free ? 0 : (parseFloat(item.sellingPrice)||0),
        free:            item.free || item.sellingPrice == 0,
        badge:           item.badge || null,
        slug:            slug,
        seo_title:       item.seoTitle || null,
        seo_description: item.seoDesc || null,
        seo_keywords:    item.keywords || null,
        cover_url:       coverUrl,
        pdf_url:         pdfUrl,
        status:          'published',
        created_at:      item.publishDate || new Date().toISOString(),
        // ── Premium Edit PDF: cascading classification FKs ─────────
        //    (integer/uuid columns — always the resolved numeric ID)
        subcategory_id:    subcategoryId,
        academic_level_id: academicLevelId,
        stream_id:         streamId,
        semester_class_id: semesterClassId,
        subject_id:        subjectId,
        // ── Legacy denormalised columns are ACTUALLY bigint in the
        //    live schema (verified against Supabase directly) — they
        //    must mirror the numeric *_id columns, NEVER store the
        //    display name (e.g. "Personal Finance"), or Postgres throws
        //    "invalid input syntax for type bigint". ──────────────────
        subcategory:       subcategoryId,
        academic_level:    academicLevelId,
        stream:            streamId,
        semester_class:    semesterClassId,
        subject:           subjectId,
      };

      const { error: insErr } = await sb.from('pdfs').insert(payload);
      if (insErr) throw new Error('DB insert: ' + insErr.message);

      item.published = true;
      item.coverUrl  = coverUrl;
      item.pdfUrl    = pdfUrl;
      item.errors    = [];
      published++;
      logAdminActivity?.(`Published "${item.title}" via Batch Publisher`, 'green');
    } catch(e) {
      item.errors = [e.message];
      failed++;
      failedItems.push({ item, reason: e.message });
    }

    sbpRenderCard(item.id);
  }

  window._sbp.publishing = false;
  sbpUpdateStats();

  // Refresh PDFS
  try {
    const { data: refreshed } = await window.supabaseClient.from('pdfs').select('*').eq('status','published').order('created_at',{ascending:false}).limit(200);
    if (refreshed?.length) { window.PDFS.length=0; refreshed.forEach(r=>window.PDFS.push(r)); }
  } catch(e) {}

  const elapsed = ((Date.now()-startTime)/1000).toFixed(1);

  // Show final report
  sbpShowReport({ published, failed, skipped, elapsed, total, failedItems });
  if (progEl) progEl.style.display = 'none';
}

/* ─── Final Report ───────────────────────────────────────────────── */
function sbpShowReport({ published, failed, skipped, elapsed, total, failedItems }) {
  const modal = document.getElementById('sbpReportModal');
  const body  = document.getElementById('sbpReportBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
      <div style="text-align:center;background:rgba(16,217,142,0.08);border:1px solid rgba(16,217,142,0.2);border-radius:10px;padding:14px">
        <div style="font-size:1.8rem;font-weight:900;color:#10d98e">${published}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">Published</div>
      </div>
      <div style="text-align:center;background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.2);border-radius:10px;padding:14px">
        <div style="font-size:1.8rem;font-weight:900;color:#ff4d6d">${failed}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">Failed</div>
      </div>
      <div style="text-align:center;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:14px">
        <div style="font-size:1.8rem;font-weight:900;color:#f59e0b">${skipped}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">Skipped</div>
      </div>
    </div>
    <div style="font-size:.78rem;color:var(--text2);text-align:center;margin-bottom:${failedItems.length?'16px':'0'}">⏱️ Completed in <strong>${elapsed}s</strong></div>
    ${failedItems.length ? `
      <div style="background:rgba(255,77,109,0.06);border:1px solid rgba(255,77,109,0.15);border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:.78rem;font-weight:700;color:#ff4d6d;margin-bottom:8px">Failed PDFs:</div>
        ${failedItems.map(f=>`<div style="font-size:.73rem;margin-bottom:5px;display:flex;gap:6px;align-items:baseline">
          <span style="color:#ff8fa8;flex-shrink:0">•</span>
          <span><strong>${(f.item.title||'Untitled').slice(0,35)}</strong> — ${f.reason}</span>
        </div>`).join('')}
      </div>
      <button onclick="sbpRetryFailed()" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,77,109,0.3);background:rgba(255,77,109,0.1);color:#ff4d6d;font-weight:700;cursor:pointer;margin-bottom:10px;font-family:var(--font-body)">🔁 Retry Failed (${failedItems.length})</button>
    ` : ''}
    <div style="display:flex;gap:8px">
      <button onclick="sbpCloseReport()" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--grad-primary);color:#fff;font-weight:700;cursor:pointer;font-family:var(--font-body)">✅ Done</button>
      ${published > 0 ? `<button onclick="switchAdminTab('pdfs')" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--accent);background:rgba(61,142,248,0.1);color:var(--accent);font-weight:700;cursor:pointer;font-family:var(--font-body)">📋 View PDFs</button>` : ''}
    </div>`;

  modal.classList.add('open');
}

function sbpCloseReport() {
  document.getElementById('sbpReportModal')?.classList.remove('open');
}

function sbpRetryFailed() {
  sbpCloseReport();
  // Reset failed items back to draft
  window._sbp.queue.filter(x => x.errors?.length).forEach(x => { x.errors = []; });
  sbpRenderQueue(); sbpUpdateStats();
  showToast('Failed items reset to Draft. Fix errors and retry.', 'warning');
}

/* ─── Main render function ───────────────────────────────────────── */
function renderAdminAddPDF(main) {
  // Preserve single-edit compatibility
  if (!window._adminEditingLoading) {
    window.adminEditingPDFId    = null;
    window.adminEditingCoverUrl = null;
    window.adminEditingPdfUrl   = null;
  }

  // If we're in single-edit mode (from PDF list), delegate to legacy form
  if (window.adminEditingPDFId) {
    renderAdminAddPDFLegacy(main);
    return;
  }

  // Reset SBP state for fresh session
  if (!window._sbp._sessionActive) {
    window._sbp.queue    = [];
    window._sbp.selected = new Set();
    window._sbp.editingId = null;
    window._sbp._sessionActive = true;
  }

  main.innerHTML = `
  <style>
  /* ── Smart Batch Publisher Styles (extends existing ap-* styles) ── */
  .sbp-stat-bar {
    display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px;
  }
  .sbp-stat {
    flex:1; min-width:80px; background:var(--glass);
    border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    padding:10px 14px; text-align:center;
  }
  .sbp-stat-num { font-size:1.4rem; font-weight:900; line-height:1; }
  .sbp-stat-lbl { font-size:.65rem; color:var(--text2); margin-top:3px; text-transform:uppercase; letter-spacing:.05em; }
  .sbp-drop-zone {
    border:2px dashed var(--glass-border); border-radius:var(--radius);
    padding:40px 20px; text-align:center; cursor:pointer;
    transition:all .25s; position:relative; background:rgba(255,255,255,0.015);
  }
  .sbp-drop-zone:hover, .sbp-drop-zone.drag-over {
    border-color:var(--accent); background:rgba(61,142,248,0.05);
  }
  .sbp-drop-zone input[type=file] { position:absolute; inset:0; opacity:0; cursor:pointer; z-index:2; }
  .sbp-editor-panel {
    background:var(--glass); border:1px solid var(--glass-border);
    border-radius:var(--radius); padding:20px;
    position:sticky; top:80px; max-height:calc(100vh - 100px);
    overflow-y:auto;
  }
  /* Mobile: editor opens as full-screen modal */
  .sbp-editor-modal {
    display:none; position:fixed; inset:0; z-index:900;
    background:var(--bg2); overflow-y:auto; padding:0;
  }
  .sbp-editor-modal.open { display:block; }
  .sbp-editor-modal-inner {
    padding:16px; max-width:600px; margin:0 auto;
    padding-bottom:80px;
  }
  .sbp-modal-overlay {
    display:none; position:fixed; inset:0; z-index:820;
    align-items:center; justify-content:center;
  }
  .sbp-modal-overlay.open { display:flex; }
  .sbp-modal-bg { position:absolute; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(6px); }
  .sbp-modal-box {
    position:relative; z-index:1; width:min(500px,95vw);
    background:var(--bg2); border:1px solid var(--glass-border);
    border-radius:var(--radius-lg); padding:24px;
    max-height:85vh; overflow-y:auto;
    box-shadow:0 24px 80px rgba(0,0,0,0.6);
    animation:fadeUp .25s ease;
  }
  .sbp-progress-track { background:var(--surface); border-radius:4px; height:6px; overflow:hidden; margin:8px 0; }
  .sbp-progress-fill  { height:100%; background:var(--grad-primary); width:0%; transition:width .3s; border-radius:4px; }
  /* On desktop: side panel. On mobile: hide side panel, use modal instead */
  @media(max-width:900px) {
    .sbp-layout { grid-template-columns:1fr !important; }
    .sbp-desktop-editor { display:none !important; }
  }
  @media(min-width:901px) {
    .sbp-editor-modal { display:none !important; }
  }
  /* Full-width inputs on mobile */
  .sbp-field-row {
    display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;
  }
  @media(max-width:600px) { .sbp-field-row { grid-template-columns:1fr; } }
  </style>

  <!-- PAGE HEADER -->
  <div class="ap-page-header">
    <div>
      <div class="ap-page-title">
        <span style="font-size:1.3rem">🚀</span>
        Smart Batch Publisher
      </div>
      <div class="ap-page-sub">Upload up to 12 PDFs at once · AI-powered suggestions · One-click bulk publish</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-secondary btn-sm" onclick="sbpSelectAll()">☑ Select All</button>
      <button class="btn btn-secondary btn-sm" id="sbpBulkEditBtn" onclick="sbpOpenBulkEdit()" disabled>⚙️ Bulk Edit</button>
      <button class="btn btn-secondary btn-sm" onclick="adminCancelEdit()">✕ Exit</button>
      <button class="btn btn-primary" id="sbpPublishBtn" onclick="sbpPublishReady()" disabled style="min-width:200px">
        🚀 Publish Ready PDFs
      </button>
    </div>
  </div>

  <!-- STATS BAR -->
  <div class="sbp-stat-bar" style="overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px">
    <div class="sbp-stat">
      <div class="sbp-stat-num" id="sbpStatTotal">0</div>
      <div class="sbp-stat-lbl">Total</div>
    </div>
    <div class="sbp-stat">
      <div class="sbp-stat-num" style="color:#10d98e" id="sbpStatReady">0</div>
      <div class="sbp-stat-lbl">Ready</div>
    </div>
    <div class="sbp-stat">
      <div class="sbp-stat-num" style="color:#f59e0b" id="sbpStatDraft">0</div>
      <div class="sbp-stat-lbl">Draft</div>
    </div>
    <div class="sbp-stat">
      <div class="sbp-stat-num" style="color:#ff4d6d" id="sbpStatMissing">0</div>
      <div class="sbp-stat-lbl">Missing</div>
    </div>
    <div class="sbp-stat">
      <div class="sbp-stat-num" style="color:#ff4d6d" id="sbpStatErrors">0</div>
      <div class="sbp-stat-lbl">Errors</div>
    </div>
    <div class="sbp-stat">
      <div class="sbp-stat-num" style="color:#3d8ef8" id="sbpStatPublished">0</div>
      <div class="sbp-stat-lbl">Published</div>
    </div>
  </div>

  <!-- PUBLISH PROGRESS -->
  <div id="sbpProgressArea" style="display:none;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">
    <div style="font-size:.82rem;font-weight:700;margin-bottom:4px" id="sbpProgressText">Publishing…</div>
    <div class="sbp-progress-track"><div class="sbp-progress-fill" id="sbpProgressBar"></div></div>
  </div>

  <!-- MAIN LAYOUT -->
  <div class="sbp-layout" style="display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:start">

    <!-- LEFT: Drop Zone + Queue -->
    <div>
      <!-- DROP ZONE -->
      <div class="ap-card" style="margin-bottom:16px">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-blue">📁</div>
            Upload PDFs
            <span id="sbpSlotBadge" style="font-size:.68rem;background:rgba(61,142,248,0.15);color:var(--accent);padding:2px 8px;border-radius:10px;margin-left:4px">0 / 12 slots used</span>
          </div>
        </div>
        <div class="sbp-drop-zone" id="sbpDropZone"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="this.classList.remove('drag-over');sbpAddFiles(event.dataTransfer.files)">
          <input type="file" accept=".pdf,application/pdf" multiple onchange="sbpAddFiles(this.files);this.value=''"/>
          <div style="font-size:2.5rem;margin-bottom:10px">📤</div>
          <div style="font-weight:700;font-size:.95rem;margin-bottom:6px">Drag & Drop PDFs here</div>
          <div style="font-size:.78rem;color:var(--text2);margin-bottom:14px">or click to browse · Multi-select supported · Max 12 PDFs per batch</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <span style="font-size:.7rem;background:var(--surface);padding:3px 10px;border-radius:8px;border:1px solid var(--glass-border);color:var(--text2)">📄 PDF only</span>
            <span style="font-size:.7rem;background:var(--surface);padding:3px 10px;border-radius:8px;border:1px solid var(--glass-border);color:var(--text2)">📦 Max 100MB each</span>
            <span style="font-size:.7rem;background:var(--surface);padding:3px 10px;border-radius:8px;border:1px solid var(--glass-border);color:var(--text2)">🤖 AI auto-fills details</span>
          </div>
        </div>
      </div>

      <!-- QUEUE -->
      <div class="ap-card">
        <div class="ap-card-header">
          <div class="ap-card-title">
            <div class="ap-card-icon ap-icon-purple">📋</div>
            Queue
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="sbpSelectAll()" style="font-size:.7rem">☑ All</button>
            <button class="btn btn-secondary btn-sm" onclick="window._sbp.queue=[];window._sbp.selected.clear();sbpRenderQueue()" style="font-size:.7rem;color:#ff4d6d">🗑 Clear</button>
          </div>
        </div>

        <!-- Empty state -->
        <div id="sbpEmptyState" style="text-align:center;padding:40px 20px;color:var(--text2)">
          <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">📭</div>
          <div style="font-size:.88rem;font-weight:600;margin-bottom:6px">Queue is empty</div>
          <div style="font-size:.75rem">Upload PDFs above to get started</div>
        </div>

        <!-- Queue list -->
        <div id="sbpQueueList" style="display:none"></div>
      </div>
    </div>

    <!-- RIGHT: Editor Panel (desktop only) -->
    <div class="sbp-desktop-editor">
      <div id="sbpEditorPanel" class="sbp-editor-panel" style="display:none">
        <!-- Editor injected by sbpOpenEditor() -->
      </div>
      <!-- Placeholder when no editor open -->
      <div id="sbpEditorPlaceholder" class="ap-card" style="text-align:center;padding:32px 20px;color:var(--text2)">
        <div style="font-size:2rem;margin-bottom:10px;opacity:.4">✏️</div>
        <div style="font-size:.82rem;font-weight:600;margin-bottom:6px">Select a PDF to edit</div>
        <div style="font-size:.73rem">Click the ✏️ button on any queue item to open the editor here</div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--glass-border);text-align:left">
          <div style="font-size:.75rem;font-weight:700;margin-bottom:8px;color:var(--text)">💡 How it works:</div>
          <div style="font-size:.72rem;color:var(--text2);line-height:1.9">
            1. Upload PDFs via drag & drop<br>
            2. Click ✨ on a card for AI suggestions<br>
            3. Click ✏️ to fill remaining details<br>
            4. Use ⚙️ Bulk Edit for batch fields<br>
            5. Hit 🚀 Publish Ready PDFs when done
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- MOBILE FULL-SCREEN EDITOR MODAL -->
  <div class="sbp-editor-modal" id="sbpMobileEditorModal">
    <div class="sbp-editor-modal-inner">
      <!-- Sticky header -->
      <div style="position:sticky;top:0;z-index:10;background:var(--bg2);padding:14px 0 12px;margin-bottom:4px;border-bottom:1px solid var(--glass-border);margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px">
          <button onclick="sbpCloseEditor()" style="background:rgba(61,142,248,0.12);border:1px solid rgba(61,142,248,0.25);color:var(--accent);width:36px;height:36px;border-radius:10px;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">←</button>
          <div style="font-weight:800;font-size:1rem;flex:1">Edit PDF Details</div>
          <button onclick="sbpEditorSave()" style="padding:8px 16px;border-radius:10px;border:none;background:var(--grad-primary);color:#fff;font-weight:700;cursor:pointer;font-size:.82rem;font-family:var(--font-body)">💾 Save</button>
        </div>
      </div>
      <div id="sbpMobileEditorBody">
        <!-- Content injected by sbpOpenEditor() -->
      </div>
    </div>
  </div>

  <!-- BULK EDIT MODAL -->
  <div class="sbp-modal-overlay" id="sbpBulkModal">
    <div class="sbp-modal-bg" onclick="sbpCloseBulkModal()"></div>
    <div class="sbp-modal-box">
      <div style="font-weight:800;font-size:.95rem;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
        ⚙️ Bulk Edit
        <button onclick="sbpCloseBulkModal()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:1.1rem">✕</button>
      </div>
      <div id="sbpBulkModalBody"></div>
    </div>
  </div>

  <!-- FINAL REPORT MODAL -->
  <div class="sbp-modal-overlay" id="sbpReportModal">
    <div class="sbp-modal-bg" onclick="sbpCloseReport()"></div>
    <div class="sbp-modal-box">
      <div style="font-weight:800;font-size:1rem;margin-bottom:16px;text-align:center">
        📊 Publish Report
      </div>
      <div id="sbpReportBody"></div>
    </div>
  </div>`;

  // Mark session active so queue persists on tab switches
  window._sbp._sessionActive = true;

  // Slot badge update
  function updateSlotBadge() {
    const b = document.getElementById('sbpSlotBadge');
    if (b) b.textContent = `${window._sbp.queue.length} / 12 slots used`;
  }
  const _origAdd = sbpAddFiles;
  // Patch to update slot badge after add
  const dropEl = document.getElementById('sbpDropZone');
  if (dropEl) {
    const input = dropEl.querySelector('input[type=file]');
    if (input) {
      input.addEventListener('change', () => setTimeout(updateSlotBadge, 200));
    }
  }

  // Restore queue if session was active
  if (window._sbp.queue.length) {
    sbpRenderQueue();
    sbpUpdateStats();
  } else {
    sbpUpdateStats();
  }

  // Load categories
  (async () => {
    if (!window.supabaseClient) return;
    try {
      const { data } = await window.supabaseClient.from('categories').select('*').order('sort_order').order('name');
      if (data?.length) window._dbCategories = data;
    } catch(e) {}
  })();
}

// ── Slug auto-generator ──────────────────────────────────────────
function apAutoSlug(force) {
  const title = document.getElementById('apTitle')?.value || '';
  const slugEl = document.getElementById('apSlug');
  if (!slugEl) return;
  if (force || !slugEl.value) {
    slugEl.value = generateSlug(title);
  }
  updateAdminPDFPreview();
}

// ── Auto SEO generator ───────────────────────────────────────────
function apAutoSEO() {
  const title    = document.getElementById('apTitle')?.value?.trim() || '';
  const category = document.getElementById('apCat')?.value || '';
  const subcat   = document.getElementById('apSubcat')?.value || '';
  const level    = document.getElementById('apAcademicLevel')?.value || '';
  const stream   = document.getElementById('apStream')?.value || '';
  const sem      = document.getElementById('apSemesterClass')?.value || '';
  const subject  = document.getElementById('apSubject')?.value || '';
  const year     = document.getElementById('apExamYear')?.value?.trim() || '';
  const { seoTitle, desc, keywords } = autoGenerateSEO(title, category, subcat || level || stream || sem || subject, year);
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('apSeoTitle', seoTitle);
  setVal('apSeoDesc', desc);
  setVal('apSeoKeywords', keywords);
  // Trigger char count updates
  document.getElementById('apSeoTitle')?.dispatchEvent(new Event('input'));
  document.getElementById('apSeoDesc')?.dispatchEvent(new Event('input'));
  updateAdminPDFPreview();
  showToast('✨ SEO fields generated!', 'success');
}

// ── Discount calculator ──────────────────────────────────────────
function apCalcDiscount() {
  const orig = parseFloat(document.getElementById('apOrigPrice')?.value || 0);
  const sell = parseFloat(document.getElementById('apSellPrice')?.value || 0);
  const badge = document.getElementById('apDiscountBadge');
  if (!badge) return;
  if (orig > 0 && sell > 0 && orig > sell) {
    const pct = Math.round(((orig - sell) / orig) * 100);
    badge.textContent = pct + '% OFF';
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Free toggle ──────────────────────────────────────────────────
function apToggleFree(cb) {
  const sp = document.getElementById('apSellPrice');
  if (!sp) return;
  sp.disabled = cb.checked;
  if (cb.checked) sp.value = '0';
  apCalcDiscount();
  updateAdminPDFPreview();
}

// ── Cascade helper: get data-id from selected option ─────────────
function apGetSelectedId(selectId) {
  const el = document.getElementById(selectId);
  if (!el || !el.value) return null;
  return el.options[el.selectedIndex]?.dataset?.id || null;
}

// ── Cascade helper: load child dropdown from Supabase ────────────
async function apLoadChildDropdown(table, filterField, parentId, targetSelectId, emptyLabel, noResultLabel) {
  const targetEl = document.getElementById(targetSelectId);
  if (!targetEl) return;
  if (!parentId) { targetEl.innerHTML = `<option value="">${emptyLabel}</option>`; updateAdminPDFPreview(); return; }
  targetEl.innerHTML = '<option value="">Loading…</option>';
  if (!window.supabaseClient) { targetEl.innerHTML = `<option value="">${noResultLabel}</option>`; return; }
  try {
    const { data, error } = await window.supabaseClient.from(table).select('*').eq(filterField, parentId).order('sort_order').order('name');
    if (error) throw error;
    if (data && data.length) {
      targetEl.innerHTML = `<option value="">Select ${table.replace(/_/g,' ')}…</option>` +
        data.map(r => `<option value="${r.name}" data-id="${r.id}">${r.name}</option>`).join('');
    } else {
      targetEl.innerHTML = `<option value="">${noResultLabel}</option>`;
    }
  } catch(e) {
    console.warn(`${table} fetch error:`, e);
    targetEl.innerHTML = `<option value="">${noResultLabel}</option>`;
  }
  updateAdminPDFPreview();
}

// ── Reset all dropdowns below a given level ───────────────────────
function apResetBelow(levels) {
  const map = {
    subcat:    { id:'apSubcat',        label:'— select category first —' },
    level:     { id:'apAcademicLevel', label:'— select subcategory first —' },
    stream:    { id:'apStream',        label:'— select academic level first —' },
    semester:  { id:'apSemesterClass', label:'— select stream first —' },
    subject:   { id:'apSubject',       label:'— select semester/class first —' },
  };
  levels.forEach(k => {
    const el = document.getElementById(map[k].id);
    if (el) el.innerHTML = `<option value="">${map[k].label}</option>`;
  });
  updateAdminPDFPreview();
}

// ── Category change → load subcategories ─────────────────────────
async function apOnCategoryChange() {
  apResetBelow(['subcat','level','stream','semester','subject']);
  const catId = apGetSelectedId('apCat');
  if (!catId) return;
  // Also update _dbSubcategories cache when fetching
  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('subcategories')
        .select('*').eq('category_id', catId).order('sort_order').order('name');
      const subcatEl = document.getElementById('apSubcat');
      if (!subcatEl) return;
      if (data && data.length) {
        // Merge into global cache
        if (!window._dbSubcategories) window._dbSubcategories = [];
        data.forEach(s => {
          if (!window._dbSubcategories.find(x => x.id === s.id)) window._dbSubcategories.push(s);
        });
        if (!window._dbSubcatMap) window._dbSubcatMap = {};
        window._dbSubcatMap[catId] = data;
        subcatEl.innerHTML = '<option value="">Select Subcategory…</option>' +
          data.map(s => `<option value="${s.name}" data-id="${s.id}">${s.name}</option>`).join('');
      } else {
        subcatEl.innerHTML = '<option value="">No subcategories found</option>';
      }
    } catch(e) { console.warn('Subcategory fetch error:', e); }
  }
  updateAdminPDFPreview();
  apUpdateClassifPath();
}

// ── Subcategory change → load academic levels ─────────────────────
async function apOnSubcategoryChange() {
  apResetBelow(['level','stream','semester','subject']);
  const subcatId = apGetSelectedId('apSubcat');
  await apLoadChildDropdown('academic_levels', 'subcategory_id', subcatId, 'apAcademicLevel',
    '— select subcategory first —', 'No academic levels found');
  apUpdateClassifPath();
}

// ── Academic level change → load streams ─────────────────────────
async function apOnAcademicLevelChange() {
  apResetBelow(['stream','semester','subject']);
  const levelId = apGetSelectedId('apAcademicLevel');
  await apLoadChildDropdown('streams', 'academic_level_id', levelId, 'apStream',
    '— select academic level first —', 'No streams found');
  apUpdateClassifPath();
}

// ── Stream change → load semester/classes ────────────────────────
async function apOnStreamChange() {
  apResetBelow(['semester','subject']);
  const streamId = apGetSelectedId('apStream');
  await apLoadChildDropdown('semester_classes', 'stream_id', streamId, 'apSemesterClass',
    '— select stream first —', 'No semester/classes found');
  apUpdateClassifPath();
}

// ── Semester/class change → load subjects ────────────────────────
async function apOnSemesterClassChange() {
  const semEl = document.getElementById('apSubject');
  if (semEl) semEl.innerHTML = '<option value="">— select semester/class first —</option>';
  const semId = apGetSelectedId('apSemesterClass');
  await apLoadChildDropdown('subjects', 'semester_class_id', semId, 'apSubject',
    '— select semester/class first —', 'No subjects found');
  apUpdateClassifPath();
}

// ── Update classification breadcrumb path display ─────────────────
function apUpdateClassifPath() {
  const g = id => document.getElementById(id)?.value || '';
  const parts = [
    g('apCat'), g('apSubcat'), g('apAcademicLevel'),
    g('apStream'), g('apSemesterClass'), g('apSubject')
  ].filter(Boolean);
  const el = document.getElementById('apClassifPathText');
  if (el) el.textContent = parts.length ? parts.join(' › ') : 'none';
}

// ── Reload categories from DB into the category select ───────────
async function apRefreshCategories() {
  if (!window.supabaseClient) { showToast('Supabase not connected', 'error'); return; }
  try {
    const { data, error } = await window.supabaseClient.from('categories').select('*').order('sort_order').order('name');
    if (error) throw error;
    window._dbCategories = data || [];
    const catEl = document.getElementById('apCat');
    if (!catEl) return;
    const current = catEl.value;
    catEl.innerHTML = '<option value="">— Select Category —</option>' +
      (data||[]).map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('');
    if (current) catEl.value = current;
    showToast('✅ Categories reloaded', 'success');
  } catch(e) { showToast('Reload failed: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════
// INLINE CLASSIFICATION MANAGEMENT (inside Add/Edit PDF page)
// ══════════════════════════════════════════════════════════════════

window._apCM = {
  level: 'categories',
  data:  { categories:[], subcategories:[], academic_levels:[], streams:[], semester_classes:[], subjects:[] },
  loaded: false,
  deleteTarget: null,
};

const AP_CM_LABELS = {
  categories:'Category', subcategories:'Subcategory',
  academic_levels:'Academic Level', streams:'Stream',
  semester_classes:'Semester/Class', subjects:'Subject'
};
const AP_CM_PARENT_TABLE = {
  subcategories:'categories', academic_levels:'subcategories',
  streams:'academic_levels', semester_classes:'streams', subjects:'semester_classes'
};
const AP_CM_PARENT_FIELD = {
  subcategories:'category_id', academic_levels:'subcategory_id',
  streams:'academic_level_id', semester_classes:'stream_id', subjects:'semester_class_id'
};
const AP_CM_CHILD_TABLE = {
  categories:'subcategories', subcategories:'academic_levels',
  academic_levels:'streams', streams:'semester_classes',
  semester_classes:'subjects', subjects:null
};
const AP_CM_CHILD_FIELD = {
  categories:'category_id', subcategories:'subcategory_id',
  academic_levels:'academic_level_id', streams:'stream_id', semester_classes:'semester_class_id'
};

async function apCMInit() {
  await apCMLoadAll();
  apCMRenderTable();
}

async function apCMLoadAll() {
  if (!window.supabaseClient) return;
  try {
    const tables = ['categories','subcategories','academic_levels','streams','semester_classes','subjects'];
    const results = await Promise.all(tables.map(t =>
      window.supabaseClient.from(t).select('*').order('sort_order').order('name')
    ));
    tables.forEach((t,i) => { window._apCM.data[t] = results[i].data || []; });
    window._dbCategories    = window._apCM.data.categories;
    window._dbSubcategories = window._apCM.data.subcategories;
    window._dbSubcatMap     = {};
    window._apCM.data.subcategories.forEach(s => {
      if (!window._dbSubcatMap[s.category_id]) window._dbSubcatMap[s.category_id] = [];
      window._dbSubcatMap[s.category_id].push(s);
    });
    window._apCM.loaded = true;
    // Also refresh categories dropdown
    const catEl = document.getElementById('apCat');
    if (catEl) {
      const cur = catEl.value;
      catEl.innerHTML = '<option value="">— Select Category —</option>' +
        window._apCM.data.categories.map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('');
      if (cur) catEl.value = cur;
    }
  } catch(e) { console.warn('apCM load error:', e); }
}

function apToggleCMPanel() {
  const body = document.getElementById('apCMBody');
  const icon = document.getElementById('apCMToggleIcon');
  if (!body) return;
  body.classList.toggle('open');
  if (icon) icon.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
  if (body.classList.contains('open') && !window._apCM.loaded) {
    apCMInit();
  }
}

function apCMSwitchLevel(lvl) {
  window._apCM.level = lvl;
  document.querySelectorAll('.ap-cm-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.lvl === lvl);
  });
  document.getElementById('apCMSearch').value = '';
  apCMRenderTable();
}

function apCMRenderTable() {
  const wrap = document.getElementById('apCMTableWrap');
  const cntEl = document.getElementById('apCMCount');
  if (!wrap) return;
  if (!window._apCM.loaded) {
    wrap.innerHTML = '<div class="ap-cm-empty"><span class="auth-spinner"></span> Loading…</div>';
    return;
  }
  const lvl = window._apCM.level;
  const d   = window._apCM.data;
  const q   = (document.getElementById('apCMSearch')?.value || '').toLowerCase().trim();
  let rows  = [...(d[lvl] || [])];
  if (q) rows = rows.filter(r => (r.name||'').toLowerCase().includes(q));

  if (cntEl) cntEl.textContent = rows.length + ' item' + (rows.length !== 1 ? 's' : '');

  if (!rows.length) {
    wrap.innerHTML = `<div class="ap-cm-empty">No ${AP_CM_LABELS[lvl].toLowerCase()} found.${!q?' Click ➕ Add to create one.':''}</div>`;
    return;
  }

  const pf = AP_CM_PARENT_FIELD[lvl];
  const pt = AP_CM_PARENT_TABLE[lvl];
  const ct = AP_CM_CHILD_TABLE[lvl];
  const cf = AP_CM_CHILD_FIELD[lvl];

  const tbody = rows.map(r => {
    const parentRow = pt ? (d[pt]||[]).find(p => p.id === r[pf]) : null;
    const childCnt  = ct ? (d[ct]||[]).filter(c => c[cf] === r.id).length : null;
    return `<tr>
      <td><span style="font-weight:700;font-size:.83rem">${r.name||'—'}</span></td>
      ${lvl !== 'categories' ? `<td><span style="font-size:.75rem;color:var(--text2)">${parentRow ? parentRow.name : '—'}</span></td>` : ''}
      <td>${ct !== null ? `<span style="font-size:.75rem;color:var(--accent);font-weight:700">${childCnt}</span>` : '<span style="color:var(--text3);font-size:.72rem">leaf</span>'}</td>
      <td><span style="font-family:monospace;font-size:.7rem;color:var(--text2)">${r.slug||'—'}</span></td>
      <td><span style="font-size:.85rem">${r.icon||r.color||''}</span></td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="ap-cm-action-btn" onclick="apCMOpenEditModal('${lvl}','${r.id}')">✏️</button>
          <button class="ap-cm-del-btn" onclick="apCMOpenDeleteModal('${lvl}','${r.id}','${(r.name||'').replace(/'/g,"\\'")}',${childCnt||0})">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="ap-cm-table">
      <thead><tr>
        <th>Name</th>
        ${lvl !== 'categories' ? '<th>Parent</th>' : ''}
        <th>Children</th>
        <th>Slug</th>
        <th>Icon</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;
}

async function apCMReload() {
  const wrap = document.getElementById('apCMTableWrap');
  if (wrap) wrap.innerHTML = '<div class="ap-cm-empty"><span class="auth-spinner"></span> Reloading…</div>';
  await apCMLoadAll();
  apCMRenderTable();
}

// ── Modal helpers ─────────────────────────────────────────────────
function apCMOpenModal() {
  const m = document.getElementById('apCMModal');
  if (m) m.classList.add('open');
}
function apCMCloseModal() {
  const m = document.getElementById('apCMModal');
  if (m) m.classList.remove('open');
}
function apCMShowModalError(msg) {
  const el = document.getElementById('apCMModalError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function apCMBuildParentOptions(lvl, selectedId) {
  const pt = AP_CM_PARENT_TABLE[lvl];
  if (!pt) return '';
  return (window._apCM.data[pt]||[])
    .map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`)
    .join('');
}

function apCMModalHtml(title, lvl, row) {
  const pf = AP_CM_PARENT_FIELD[lvl];
  const pt = AP_CM_PARENT_TABLE[lvl];
  const parentOptions = pt ? apCMBuildParentOptions(lvl, row ? row[pf] : null) : '';
  const isEdit = !!row;

  return `
    <div class="ap-modal-title">
      <span>${isEdit ? '✏️ Edit' : '➕ Add'} ${AP_CM_LABELS[lvl]}</span>
      <button class="ap-modal-close" onclick="apCMCloseModal()">✕</button>
    </div>
    ${pt ? `
    <div class="ap-field" style="margin-bottom:12px">
      <label class="ap-label">Parent ${AP_CM_LABELS[pt]} <span class="ap-req">*</span></label>
      <select class="ap-input" id="apCMParentId" style="margin-top:4px">
        <option value="">Select ${AP_CM_LABELS[pt]}…</option>
        ${parentOptions}
      </select>
    </div>` : ''}
    <div class="ap-field" style="margin-bottom:12px">
      <label class="ap-label">Name <span class="ap-req">*</span></label>
      <input class="ap-input" id="apCMName" value="${row ? (row.name||'') : ''}" placeholder="${AP_CM_LABELS[lvl]} name" oninput="apCMAutoSlug()" style="margin-top:4px" />
    </div>
    <div class="ap-field" style="margin-bottom:12px">
      <label class="ap-label">Slug</label>
      <div style="display:flex;gap:6px;margin-top:4px">
        <input class="ap-input" id="apCMSlug" value="${row ? (row.slug||'') : ''}" placeholder="auto-generated" style="flex:1" />
        <button class="btn btn-secondary btn-sm" onclick="apCMAutoSlug(true)">↺</button>
      </div>
    </div>
    ${lvl === 'categories' ? `
    <div class="ap-grid-2" style="margin-bottom:12px">
      <div class="ap-field">
        <label class="ap-label">Icon (emoji)</label>
        <input class="ap-input" id="apCMIcon" value="${row ? (row.icon||'') : ''}" placeholder="📚" style="margin-top:4px" />
      </div>
      <div class="ap-field">
        <label class="ap-label">Color</label>
        <input class="ap-input" id="apCMColor" value="${row ? (row.color||'') : ''}" placeholder="#3d8ef8" style="margin-top:4px" />
      </div>
    </div>` : ''}
    <div class="ap-field" style="margin-bottom:16px">
      <label class="ap-label">Sort Order</label>
      <input class="ap-input" id="apCMSortOrder" type="number" value="${row ? (row.sort_order??0) : 0}" placeholder="0" style="margin-top:4px" />
    </div>
    <div class="ap-modal-error" id="apCMModalError"></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-secondary" style="flex:1" onclick="apCMCloseModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" id="apCMSaveBtn"
        onclick="${isEdit ? `apCMSaveEdit('${lvl}','${row.id}','${pf||''}')` : `apCMSaveNew('${lvl}','${pf||''}')`}">
        ${isEdit ? '💾 Save Changes' : '➕ Add ' + AP_CM_LABELS[lvl]}
      </button>
    </div>`;
}

function apCMOpenAddModal() {
  const lvl = window._apCM.level;
  document.getElementById('apCMModalContent').innerHTML = apCMModalHtml('Add', lvl, null);
  apCMOpenModal();
}

function apCMOpenEditModal(lvl, id) {
  const row = (window._apCM.data[lvl]||[]).find(r => r.id === id);
  if (!row) return;
  document.getElementById('apCMModalContent').innerHTML = apCMModalHtml('Edit', lvl, row);
  apCMOpenModal();
}

function apCMAutoSlug(force) {
  const name = document.getElementById('apCMName')?.value || '';
  const slugEl = document.getElementById('apCMSlug');
  if (!slugEl) return;
  if (force || !slugEl.value) slugEl.value = generateSlug(name);
}

async function apCMSaveNew(lvl, parentField) {
  const btn = document.getElementById('apCMSaveBtn');
  const name = document.getElementById('apCMName')?.value?.trim();
  if (!name) { apCMShowModalError('Name is required.'); return; }
  const parentId = document.getElementById('apCMParentId')?.value;
  if (parentField && !parentId) { apCMShowModalError(`Please select a parent ${AP_CM_LABELS[AP_CM_PARENT_TABLE[lvl]]}.`); return; }
  if (!window.supabaseClient) { apCMShowModalError('Supabase not connected.'); return; }

  if (btn) { btn.textContent = 'Adding…'; btn.disabled = true; }

  const payload = {
    name,
    slug: document.getElementById('apCMSlug')?.value?.trim() || generateSlug(name),
    sort_order: parseInt(document.getElementById('apCMSortOrder')?.value||0) || 0,
    ...(parentField && parentId ? { [parentField]: parentId } : {}),
    ...(document.getElementById('apCMIcon') ? { icon: document.getElementById('apCMIcon')?.value?.trim()||null } : {}),
    ...(document.getElementById('apCMColor') ? { color: document.getElementById('apCMColor')?.value?.trim()||null } : {}),
  };

  try {
    const { error } = await window.supabaseClient.from(lvl).insert(payload);
    if (error) throw error;
    apCMCloseModal();
    showToast(`✅ ${AP_CM_LABELS[lvl]} "${name}" added!`, 'success');
    logAdminActivity?.(`Added ${lvl}: "${name}"`, 'green');
    await apCMLoadAll();
    apCMRenderTable();
  } catch(e) {
    apCMShowModalError('Error: ' + (e.message||'Unknown error'));
    if (btn) { btn.textContent = '➕ Add ' + AP_CM_LABELS[lvl]; btn.disabled = false; }
  }
}

async function apCMSaveEdit(lvl, id, parentField) {
  const btn = document.getElementById('apCMSaveBtn');
  const name = document.getElementById('apCMName')?.value?.trim();
  if (!name) { apCMShowModalError('Name is required.'); return; }
  const parentId = document.getElementById('apCMParentId')?.value;
  if (parentField && !parentId) { apCMShowModalError(`Please select a parent ${AP_CM_LABELS[AP_CM_PARENT_TABLE[lvl]]}.`); return; }
  if (!window.supabaseClient) { apCMShowModalError('Supabase not connected.'); return; }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const payload = {
    name,
    slug: document.getElementById('apCMSlug')?.value?.trim() || generateSlug(name),
    sort_order: parseInt(document.getElementById('apCMSortOrder')?.value||0) || 0,
    ...(parentField && parentId ? { [parentField]: parentId } : {}),
    ...(document.getElementById('apCMIcon') ? { icon: document.getElementById('apCMIcon')?.value?.trim()||null } : {}),
    ...(document.getElementById('apCMColor') ? { color: document.getElementById('apCMColor')?.value?.trim()||null } : {}),
  };

  try {
    const { error } = await window.supabaseClient.from(lvl).update(payload).eq('id', id);
    if (error) throw error;
    apCMCloseModal();
    showToast(`✅ ${AP_CM_LABELS[lvl]} "${name}" updated!`, 'success');
    logAdminActivity?.(`Updated ${lvl}: "${name}"`, 'blue');
    await apCMLoadAll();
    apCMRenderTable();
  } catch(e) {
    apCMShowModalError('Error: ' + (e.message||'Unknown error'));
    if (btn) { btn.textContent = '💾 Save Changes'; btn.disabled = false; }
  }
}

// ── Delete ────────────────────────────────────────────────────────
function apCMOpenDeleteModal(lvl, id, name, childCnt) {
  window._apCM.deleteTarget = { lvl, id, name };
  const msg = document.getElementById('apCMDeleteMsg');
  const confirmBtn = document.getElementById('apCMDeleteConfirmBtn');
  if (msg) {
    msg.innerHTML = `Delete <strong>"${name}"</strong>?` +
      (parseInt(childCnt) > 0 ? `<br><span style="color:var(--danger);font-size:.78rem">⚠️ This has ${childCnt} child item(s).<br>Only delete if no PDFs are assigned.</span>` : '');
  }
  if (confirmBtn) { confirmBtn.textContent = '🗑️ Delete'; confirmBtn.disabled = false; }
  const m = document.getElementById('apCMDeleteModal');
  if (m) m.classList.add('open');
}

function apCMCloseDeleteModal() {
  const m = document.getElementById('apCMDeleteModal');
  if (m) m.classList.remove('open');
}

async function apCMConfirmDelete() {
  const t = window._apCM.deleteTarget;
  if (!t || !window.supabaseClient) return;
  const btn = document.getElementById('apCMDeleteConfirmBtn');
  if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }
  try {
    const { error } = await window.supabaseClient.from(t.lvl).delete().eq('id', t.id);
    if (error) throw error;
    apCMCloseDeleteModal();
    showToast(`🗑️ "${t.name}" deleted`, 'success');
    logAdminActivity?.(`Deleted ${t.lvl}: "${t.name}"`, 'red');
    await apCMLoadAll();
    apCMRenderTable();
  } catch(e) {
    apCMCloseDeleteModal();
    showToast('Delete failed: ' + (e.message||'Unknown'), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// HIERARCHY MANAGER tab — keep working (uses separate hmXxx functions)
// ══════════════════════════════════════════════════════════════════

function updateAdminPDFPreview() {
  const g = id => document.getElementById(id);
  const t    = g('apTitle')?.value || 'PDF Title';
  const a    = g('apAuthor')?.value || '';
  const sell = g('apSellPrice')?.value;
  const free = g('apFree')?.checked;
  const badge = g('apBadge')?.value;
  const cat   = g('apCat')?.value || '';
  const sub   = g('apSubcat')?.value || '';
  const slug  = g('apSlug')?.value || generateSlug(t);
  const seoT  = g('apSeoTitle')?.value || t;
  const seoD  = g('apSeoDesc')?.value || '';

  if (g('apPreviewTitle'))  g('apPreviewTitle').textContent = t;
  if (g('apPreviewAuthor')) g('apPreviewAuthor').textContent = a ? 'by ' + a : '';
  if (g('apPreviewPrice'))  g('apPreviewPrice').textContent = (free || sell === '0') ? 'FREE' : (sell ? '₹'+sell : 'FREE');
  if (g('apPreviewCatLine')) g('apPreviewCatLine').textContent = [cat, sub, g('apAcademicLevel')?.value, g('apStream')?.value, g('apSemesterClass')?.value, g('apSubject')?.value].filter(Boolean).join(' › ');

  if (badge && g('apPreviewBadge')) { g('apPreviewBadge').textContent = badge; g('apPreviewBadge').style.display = 'inline-flex'; }
  else if (g('apPreviewBadge'))     g('apPreviewBadge').style.display = 'none';

  // Google preview
  if (g('apGoogleTitle')) g('apGoogleTitle').textContent = seoT || t + ' — Studyria';
  if (g('apGoogleUrl'))   g('apGoogleUrl').textContent   = 'studyria.in/pdf/' + (slug || generateSlug(t));
  if (g('apGoogleDesc'))  g('apGoogleDesc').textContent  = seoD || 'Study material PDF download for Indian students.';
}

function adminPreviewCover(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('adminCoverPreview');
    if (preview) { preview.src = e.target.result; preview.classList.add('visible'); }
    const zone = document.getElementById('adminCoverZone');
    if (zone) zone.classList.add('has-file');
    const inner = document.getElementById('adminCoverZoneInner');
    if (inner) inner.innerHTML =
      `<span class="admin-badge admin-badge-success">✅ Cover Ready</span>` +
      `<div style="font-size:.75rem;color:var(--text2);margin-top:6px">${file.name} · ${(file.size/1024).toFixed(0)}KB</div>`;
    const prevImg = document.getElementById('apPreviewCoverImg');
    if (prevImg) { prevImg.src = e.target.result; prevImg.className = 'loaded'; }
  };
  reader.readAsDataURL(file);
}

function adminPreviewPDF(input) {
  const file = input.files[0];
  if (!file) return;
  const zone = document.getElementById('adminPDFZone');
  if (zone) zone.classList.add('has-file');
  const inner = document.getElementById('adminPDFZoneInner');
  if (inner) inner.innerHTML =
    `<span class="admin-badge admin-badge-success">✅ PDF Ready</span>` +
    `<div style="font-size:.75rem;color:var(--text2);margin-top:6px">${file.name} · ${(file.size/1048576).toFixed(1)}MB</div>`;
}

async function adminSavePDF() {
  const btn = document.getElementById('adminSavePDFBtn');
  const g = id => document.getElementById(id)?.value?.trim?.() ?? document.getElementById(id)?.value ?? '';

  const title          = g('apTitle');
  const author         = g('apAuthor');
  const category       = g('apCat');
  const subcategory    = g('apSubcat');
  const academicLevel  = g('apAcademicLevel');
  const stream         = g('apStream');
  const semesterClass  = g('apSemesterClass');
  const subject        = g('apSubject');
  const sellPrice   = parseFloat(g('apSellPrice') || 0);
  const origPrice   = parseFloat(g('apOrigPrice') || 0);
  const isFree      = document.getElementById('apFree')?.checked;
  const desc        = g('apDesc');
  const badge       = g('apBadge');
  const examYear    = g('apExamYear');
  const slug        = g('apSlug') || generateSlug(title);
  const seoTitle    = g('apSeoTitle');
  const seoDesc     = g('apSeoDesc');
  const seoKeywords = g('apSeoKeywords');
  const dlCount     = parseInt(g('apDownloads') || 0);
  const views       = parseInt(g('apViews') || 0);
  const wishCount   = parseInt(g('apWishlist') || 0);

  if (!title)    { showToast('Title is required!', 'error'); return; }
  if (!category) { showToast('Category is required!', 'error'); return; }

  const isEditing = !!window.adminEditingPDFId;
  const coverFile = document.getElementById('adminCoverFile')?.files[0];
  const pdfFile   = document.getElementById('adminPDFFile')?.files[0];

  if (!isEditing) {
    if (!pdfFile)   { showToast('Please select a PDF file to upload!', 'error'); return; }
    if (!coverFile) { showToast('Please select a cover image to upload!', 'error'); return; }
  }

  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return; }

  btn.innerHTML = `<span class="auth-spinner"></span>${isEditing ? 'Updating…' : 'Publishing…'}`;
  btn.disabled = true;

  let coverUrl = isEditing ? (window.adminEditingCoverUrl || null) : null;
  let pdfUrl   = isEditing ? (window.adminEditingPdfUrl   || null) : null;

  // Helper: show progress bar
  function showProgress(type, pct, label) {
    const bar  = document.getElementById(`admin${type}ProgressBar`);
    const wrap = document.getElementById(`admin${type}Progress`);
    const txt  = document.getElementById(`admin${type}ProgressText`);
    if (wrap) wrap.style.display = '';
    if (bar)  bar.style.width = pct + '%';
    if (txt)  txt.textContent = label;
  }

  try {
    // ── Upload cover ──────────────────────────────────────────────
    if (coverFile) {
      showProgress('Cover', 20, 'Uploading cover image…');
      btn.innerHTML = `<span class="auth-spinner"></span>Uploading cover…`;
      const ext   = coverFile.name.split('.').pop().toLowerCase();
      const fpath = `${Date.now()}_${slug.slice(0,40)}.${ext}`;
      const { error: coverErr } = await window.supabaseClient.storage
        .from('covers').upload(fpath, coverFile, { upsert: true, contentType: coverFile.type });
      if (coverErr) throw new Error(`Cover upload failed: ${coverErr.message}`);
      const { data: cd } = window.supabaseClient.storage.from('covers').getPublicUrl(fpath);
      if (!cd?.publicUrl) throw new Error('Cover URL generation failed.');
      coverUrl = cd.publicUrl;
      showProgress('Cover', 100, '✅ Cover uploaded');
    }

    // ── Upload PDF ────────────────────────────────────────────────
    if (pdfFile) {
      showProgress('PDF', 20, 'Uploading PDF file…');
      btn.innerHTML = `<span class="auth-spinner"></span>Uploading PDF…`;
      const fpath2 = `${Date.now()}_${slug.slice(0,40)}.pdf`;
      const { error: pdfErr } = await window.supabaseClient.storage
        .from('pdfs').upload(fpath2, pdfFile, { upsert: true, contentType: 'application/pdf' });
      if (pdfErr) throw new Error(`PDF upload failed: ${pdfErr.message}`);
      // Store the bare storage path — pdfs bucket is PRIVATE so getPublicUrl would
      // produce a non-functional URL. createSignedUrl is called at read-time instead.
      pdfUrl = fpath2;
      showProgress('PDF', 100, '✅ PDF uploaded');
    }

    if (!isEditing && (!pdfUrl || !coverUrl)) {
      throw new Error('Upload verification failed — urls still null.');
    }

    btn.innerHTML = `<span class="auth-spinner"></span>Saving to database…`;

    // Resolve all IDs from selected option data-id attributes (reliable regardless of cache state)
    const categoryId      = apGetSelectedId('apCat');
    const subcategoryId   = apGetSelectedId('apSubcat');
    const academicLevelId = apGetSelectedId('apAcademicLevel');
    const streamId        = apGetSelectedId('apStream');
    const semesterClassId = apGetSelectedId('apSemesterClass');
    const subjectId       = apGetSelectedId('apSubject');

    // ── VALIDATION: DB must only ever receive numeric IDs, never names.
    //    If any resolved classification ID is non-numeric, STOP — do not
    //    send SQL. (Legacy bigint columns like subcategory/academic_level/
    //    stream/semester_class/subject must never receive display text.) ──
    {
      const _isNumericId = v => v === null || v === undefined || v === '' || /^\d+$/.test(String(v));
      const _idFields = { categoryId, subcategoryId, academicLevelId, streamId, semesterClassId, subjectId };
      const _badField = Object.entries(_idFields).find(([,v]) => !_isNumericId(v));
      if (_badField) {
        showToast(`Invalid category mapping. (${_badField[0]} is not a valid ID)`, 'error');
        btn.innerHTML = isEditing ? '💾 Update PDF' : '🚀 Publish PDF';
        btn.disabled = false;
        return;
      }
    }

    const payload = {
      title, author, category,
      category_id:       categoryId      || null,
      subcategory_id:    subcategoryId   || null,
      academic_level_id: academicLevelId || null,
      stream_id:         streamId        || null,
      semester_class_id: semesterClassId || null,
      subject_id:        subjectId       || null,
      description:     desc            || null,
      preview:         desc            || null,
      selling_price:   isFree ? 0 : sellPrice,
      original_price:  origPrice       || null,
      price:           isFree ? 0 : sellPrice,
      free:            isFree || sellPrice === 0,
      badge:           badge           || null,
      exam_year:       examYear        || null,
      slug:            slug            || null,
      seo_title:       seoTitle        || null,
      seo_description: seoDesc         || null,
      seo_keywords:    seoKeywords     || null,
      cover_url:       coverUrl,
      pdf_url:         pdfUrl,
      status:          'published',
      ...(isEditing ? {
        download_count: dlCount,
        views:          views,
        wishlist_count: wishCount
      } : {})
    };

    if (isEditing) {
      const { error: updateErr } = await window.supabaseClient
        .from('pdfs').update(payload).eq('id', window.adminEditingPDFId);
      if (updateErr) throw new Error(`Database update failed: ${updateErr.message}`);
      logAdminActivity(`Updated PDF: "${title}" (id:${window.adminEditingPDFId})`, 'green');
      showToast(`✅ "${title}" updated successfully!`, 'success');
    } else {
      payload.created_at = new Date().toISOString();
      const { error: insertErr } = await window.supabaseClient.from('pdfs').insert(payload);
      if (insertErr) throw new Error(`Database insert failed: ${insertErr.message}`);
      logAdminActivity(`Published PDF: "${title}" in ${category}`, 'green');
      showToast(`✅ "${title}" published instantly!`, 'success');
    }

    window.adminEditingPDFId    = null;
    window.adminEditingCoverUrl = null;
    window.adminEditingPdfUrl   = null;

    // Refresh window.PDFS
    try {
      const { data: refreshed } = await window.supabaseClient
        .from('pdfs').select('*').eq('status', 'published')
        .order('created_at', { ascending: false }).limit(200);
      if (refreshed?.length) {
        window.PDFS.length = 0;
        refreshed.forEach(r => window.PDFS.push(r));
      }
    } catch(e) { console.warn('PDFS refresh error:', e); }

    btn.innerHTML = `${adminIcon('check',16)} ${isEditing ? 'Updated!' : 'Published!'}`;
    setTimeout(() => switchAdminTab('pdfs'), 1200);

  } catch (err) {
    console.error('❌ adminSavePDF error:', err);
    showToast('Error: ' + err.message, 'error');
    btn.innerHTML = isEditing
      ? `${adminIcon('check',16)} Update PDF`
      : `${adminIcon('zap',16)} Publish to Website Instantly`;
    btn.disabled = false;
  }
}

// ── CATEGORIES ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// CLASSIFICATION MANAGER — Premium Full CRUD for all 6 levels
// ══════════════════════════════════════════════════════════════════

window._hmData = { categories:[], subcategories:[], academic_levels:[], streams:[], semester_classes:[], subjects:[] };
window._hmActiveLevel = 'categories';
window._hmParentFilter = null;

const HM_LEVELS = [
  { k:'categories',      label:'Category',       icon:'📂', color:'#3d8ef8', colorAlpha:'rgba(61,142,248,0.15)' },
  { k:'subcategories',   label:'Subcategory',     icon:'📁', color:'#00c8e8', colorAlpha:'rgba(0,200,232,0.15)' },
  { k:'academic_levels', label:'Academic Level',  icon:'🎓', color:'#10d98e', colorAlpha:'rgba(16,217,142,0.15)' },
  { k:'streams',         label:'Stream',          icon:'🌊', color:'#8b5cf6', colorAlpha:'rgba(139,92,246,0.15)' },
  { k:'semester_classes',label:'Semester/Class',  icon:'📅', color:'#f59e0b', colorAlpha:'rgba(245,158,11,0.15)' },
  { k:'subjects',        label:'Subject',         icon:'📖', color:'#ff4d6d', colorAlpha:'rgba(255,77,109,0.15)' },
];
const HM_PARENT_TABLE = { subcategories:'categories', academic_levels:'subcategories', streams:'academic_levels', semester_classes:'streams', subjects:'semester_classes' };
const HM_PARENT_FIELD = { subcategories:'category_id', academic_levels:'subcategory_id', streams:'academic_level_id', semester_classes:'stream_id', subjects:'semester_class_id' };
const HM_CHILD_TABLE  = { categories:'subcategories', subcategories:'academic_levels', academic_levels:'streams', streams:'semester_classes', semester_classes:'subjects', subjects:null };
const HM_CHILD_FIELD  = { categories:'category_id', subcategories:'subcategory_id', academic_levels:'academic_level_id', streams:'stream_id', semester_classes:'semester_class_id' };

async function renderAdminCategories(main) {
  main.innerHTML = `
  <style>
  .cm-wrap { max-width:100%; }
  .cm-header { display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px; }
  .cm-header-left h2 { font-family:var(--font-display);font-size:1.6rem;font-weight:800;background:var(--grad-hero);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
  .cm-header-left p { color:var(--text2);font-size:.85rem;margin-top:4px; }
  .cm-stats-row { display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:24px; }
  @media(max-width:900px){.cm-stats-row{grid-template-columns:repeat(3,1fr);}}
  @media(max-width:500px){.cm-stats-row{grid-template-columns:repeat(2,1fr);}}
  .cm-stat-card {
    padding:14px 16px;border-radius:var(--radius);
    border:1px solid var(--glass-border);
    background:var(--glass);backdrop-filter:blur(12px);
    cursor:pointer;transition:all .2s;position:relative;overflow:hidden;
  }
  .cm-stat-card::before { content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:3px 3px 0 0; }
  .cm-stat-card:hover { transform:translateY(-2px);border-color:var(--card-color,var(--accent)); box-shadow:0 8px 24px rgba(0,0,0,0.3); }
  .cm-stat-card.active { border-color:var(--card-color,var(--accent)); background:rgba(var(--card-rgb,61,142,248),0.08); }
  .cm-stat-icon { font-size:1.3rem;margin-bottom:6px; }
  .cm-stat-label { font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:4px; }
  .cm-stat-count { font-family:var(--font-display);font-size:1.6rem;font-weight:800; }
  .cm-tab-bar { display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;padding:14px 16px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);backdrop-filter:blur(12px); }
  .cm-tab { display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:20px;border:1px solid var(--glass-border);background:transparent;color:var(--text2);font-size:.8rem;font-weight:700;cursor:pointer;font-family:var(--font-body);white-space:nowrap;transition:all .2s; }
  .cm-tab:hover { border-color:var(--tab-color,var(--accent));color:var(--tab-color,var(--accent)); }
  .cm-tab.active { border-color:var(--tab-color,var(--accent));background:var(--tab-alpha,rgba(61,142,248,0.12));color:var(--tab-color,var(--accent)); }
  .cm-tab-badge { background:rgba(255,255,255,0.1);padding:1px 7px;border-radius:10px;font-size:.72rem; }
  .cm-toolbar { display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px; }
  .cm-search { flex:1;min-width:200px;padding:10px 14px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:rgba(255,255,255,0.04);color:var(--text);font-family:var(--font-body);font-size:.875rem;outline:none;transition:border-color .2s; }
  .cm-search:focus { border-color:var(--accent); }
  body.light .cm-search { background:rgba(255,255,255,0.8); }
  .cm-count-badge { font-size:.78rem;font-weight:700;color:var(--text2);white-space:nowrap; }
  .cm-filter-banner { display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(61,142,248,0.07);border:1px solid rgba(61,142,248,0.2);border-radius:var(--radius-sm);margin-bottom:14px;font-size:.82rem; }
  .cm-table-card { background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);overflow:hidden;backdrop-filter:blur(12px); }
  .cm-table { width:100%;border-collapse:collapse; }
  .cm-table th { font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);padding:12px 16px;background:rgba(61,142,248,0.04);border-bottom:1px solid var(--glass-border);white-space:nowrap; }
  .cm-table td { padding:13px 16px;font-size:.875rem;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle; }
  .cm-table tr:last-child td { border-bottom:none; }
  .cm-table tr:hover td { background:rgba(61,142,248,0.03); }
  .cm-name-cell { font-weight:700;font-size:.87rem; }
  .cm-slug-cell { font-family:monospace;font-size:.72rem;color:var(--text2); }
  .cm-parent-chip { display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:.72rem;font-weight:600;background:var(--surface);border:1px solid var(--glass-border);color:var(--text2); }
  .cm-child-btn { background:none;border:none;cursor:pointer;font-weight:800;font-size:.82rem;padding:4px 10px;border-radius:8px;border:1px solid var(--glass-border);color:var(--accent);transition:all .2s; }
  .cm-child-btn:hover { background:rgba(61,142,248,0.1);border-color:var(--accent); }
  .cm-action-btn { padding:5px 10px;border-radius:7px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:.8rem;transition:all .2s;font-family:var(--font-body); }
  .cm-action-btn:hover { border-color:var(--accent);color:var(--accent);background:rgba(61,142,248,0.07); }
  .cm-del-btn { padding:5px 10px;border-radius:7px;border:1px solid rgba(255,77,109,0.25);background:rgba(255,77,109,0.05);color:var(--danger);cursor:pointer;font-size:.8rem;transition:all .2s;font-family:var(--font-body); }
  .cm-del-btn:hover { background:rgba(255,77,109,0.15);border-color:var(--danger); }
  .cm-empty { text-align:center;padding:48px 24px;color:var(--text2); }
  .cm-empty-icon { font-size:2.5rem;margin-bottom:12px;opacity:.5; }
  .cm-modal-overlay { display:none;position:fixed;inset:0;z-index:820;align-items:center;justify-content:center; }
  .cm-modal-overlay.open { display:flex; }
  .cm-modal-bg { position:absolute;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(8px); }
  .cm-modal-box { position:relative;z-index:1;width:min(500px,95vw);background:var(--bg2);border:1.5px solid var(--glass-border);border-radius:var(--radius-lg);padding:28px;max-height:88vh;overflow-y:auto;box-shadow:0 28px 80px rgba(0,0,0,0.65),0 0 0 1px rgba(61,142,248,0.06);animation:fadeUp .25s ease; }
  body.light .cm-modal-box { background:#fff;border-color:rgba(0,0,0,0.1); }
  .cm-modal-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:22px; }
  .cm-modal-title { font-family:var(--font-display);font-size:1.05rem;font-weight:800;display:flex;align-items:center;gap:8px; }
  .cm-modal-close { background:none;border:none;color:var(--text2);cursor:pointer;font-size:1.2rem;padding:2px 6px;border-radius:6px;transition:color .2s; }
  .cm-modal-close:hover { color:var(--text); }
  .cm-modal-field { margin-bottom:14px; }
  .cm-modal-label { font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:5px; }
  .cm-modal-input { width:100%;padding:10px 13px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:rgba(255,255,255,0.04);color:var(--text);font-family:var(--font-body);font-size:.875rem;outline:none;transition:all .2s; }
  .cm-modal-input:focus { border-color:var(--accent);background:rgba(61,142,248,0.04);box-shadow:0 0 0 3px rgba(61,142,248,0.1); }
  body.light .cm-modal-input { background:rgba(255,255,255,0.8);border-color:rgba(0,0,0,0.1); }
  .cm-modal-error { display:none;color:var(--danger);font-size:.78rem;padding:8px 12px;background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.2);border-radius:var(--radius-sm);margin-bottom:12px; }
  .cm-modal-grid2 { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
  @media(max-width:480px){.cm-modal-grid2{grid-template-columns:1fr;}}
  .cm-delete-overlay { display:none;position:fixed;inset:0;z-index:830;align-items:center;justify-content:center; }
  .cm-delete-overlay.open { display:flex; }
  .cm-delete-box { position:relative;z-index:1;width:min(400px,95vw);background:var(--bg2);border:1.5px solid rgba(255,77,109,0.3);border-radius:var(--radius-lg);padding:28px;box-shadow:0 28px 80px rgba(0,0,0,0.65);animation:fadeUp .25s ease;text-align:center; }
  body.light .cm-delete-box { background:#fff; }
  </style>

  <div class="cm-wrap">
    <!-- Header -->
    <div class="cm-header">
      <div class="cm-header-left">
        <h2>🏷️ Classification Manager</h2>
        <p>Full CRUD for all 6 classification levels — Category → Subcategory → Academic Level → Stream → Semester/Class → Subject</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="cmReload()">↺ Reload All</button>
        <button class="btn btn-primary btn-sm" id="cmAddBtnTop" onclick="cmOpenAddModal()">➕ Add Item</button>
      </div>
    </div>

    <!-- Live Count Stats -->
    <div class="cm-stats-row" id="cmStatsRow">
      ${HM_LEVELS.map(l => `
        <div class="cm-stat-card ${window._hmActiveLevel===l.k?'active':''}"
             style="--card-color:${l.color};--card-rgb:${l.color.slice(1).match(/../g).map(h=>parseInt(h,16)).join(',')}"
             onclick="cmSwitchLevel('${l.k}')">
          <div style="background:${l.color};height:3px;position:absolute;top:0;left:0;right:0;border-radius:3px 3px 0 0"></div>
          <div class="cm-stat-icon">${l.icon}</div>
          <div class="cm-stat-label">${l.label}</div>
          <div class="cm-stat-count" style="color:${l.color}" id="cmCount_${l.k}">—</div>
        </div>`).join('')}
    </div>

    <!-- Level Tabs -->
    <div class="cm-tab-bar">
      ${HM_LEVELS.map(l => `
        <button class="cm-tab ${window._hmActiveLevel===l.k?'active':''}"
                style="--tab-color:${l.color};--tab-alpha:${l.colorAlpha}"
                onclick="cmSwitchLevel('${l.k}')">
          ${l.icon} ${l.label}
          <span class="cm-tab-badge" id="cmTabBadge_${l.k}">—</span>
        </button>`).join('')}
    </div>

    <!-- Filter Banner -->
    <div id="cmFilterBanner" style="display:none" class="cm-filter-banner">
      <span>🔍 Filtered by parent: <strong id="cmFilterLabel" style="color:var(--accent)">—</strong></span>
      <button onclick="cmClearFilter()" style="margin-left:auto;background:none;border:none;color:var(--danger);cursor:pointer;font-size:.8rem;font-weight:700">✕ Clear filter</button>
    </div>

    <!-- Toolbar -->
    <div class="cm-toolbar">
      <input class="cm-search" id="cmSearch" placeholder="🔍 Search…" oninput="cmRenderTable()" />
      <span class="cm-count-badge" id="cmCountLabel"></span>
      <button class="btn btn-secondary btn-sm" onclick="cmReload()">↺</button>
      <button class="btn btn-primary btn-sm" onclick="cmOpenAddModal()">➕ Add</button>
    </div>

    <!-- Table -->
    <div class="cm-table-card">
      <div class="table-wrap" id="cmTableWrap">
        <div class="cm-empty"><div class="cm-empty-icon">⌛</div><div>Loading…</div></div>
      </div>
    </div>
  </div>

  <!-- Add/Edit Modal -->
  <div class="cm-modal-overlay" id="cmModal">
    <div class="cm-modal-bg" onclick="cmCloseModal()"></div>
    <div class="cm-modal-box">
      <div id="cmModalContent"></div>
    </div>
  </div>

  <!-- Delete Confirm Modal -->
  <div class="cm-delete-overlay" id="cmDeleteModal">
    <div class="cm-modal-bg" onclick="cmCloseDeleteModal()"></div>
    <div class="cm-delete-box">
      <div style="font-size:2.5rem;margin-bottom:10px">🗑️</div>
      <div style="font-weight:800;font-size:1.05rem;margin-bottom:8px">Confirm Delete</div>
      <div id="cmDeleteMsg" style="color:var(--text2);font-size:.85rem;margin-bottom:22px;line-height:1.6"></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" style="flex:1" onclick="cmCloseDeleteModal()">Cancel</button>
        <button class="btn btn-danger" style="flex:1" id="cmDeleteConfirmBtn" onclick="cmConfirmDelete()">🗑️ Delete</button>
      </div>
    </div>
  </div>`;

  await hmLoadAll();
  cmSyncCounts();
  cmRenderTable();
}

// ── NEW cm* Classification Manager functions ──────────────────────

function cmSyncCounts() {
  const d = window._hmData;
  HM_LEVELS.forEach(l => {
    const n = (d[l.k]||[]).length;
    const el1 = document.getElementById('cmCount_' + l.k);
    const el2 = document.getElementById('cmTabBadge_' + l.k);
    if (el1) el1.textContent = n;
    if (el2) el2.textContent = n;
  });
}

function cmSwitchLevel(lvl) {
  window._hmActiveLevel = lvl;
  window._hmParentFilter = null;
  // Update tab/stat active states
  HM_LEVELS.forEach(l => {
    document.querySelectorAll(`.cm-stat-card`).forEach((c,i) => {
      if (HM_LEVELS[i]) c.classList.toggle('active', HM_LEVELS[i].k === lvl);
    });
    document.querySelectorAll(`.cm-tab`).forEach((t,i) => {
      if (HM_LEVELS[i]) t.classList.toggle('active', HM_LEVELS[i].k === lvl);
    });
  });
  const fb = document.getElementById('cmFilterBanner');
  if (fb) fb.style.display = 'none';
  const addBtn = document.getElementById('cmAddBtnTop');
  const lvlInfo = HM_LEVELS.find(l => l.k === lvl);
  if (addBtn && lvlInfo) addBtn.textContent = '➕ Add ' + lvlInfo.label;
  const searchEl = document.getElementById('cmSearch');
  if (searchEl) searchEl.value = '';
  cmRenderTable();
}

function cmClearFilter() {
  window._hmParentFilter = null;
  const fb = document.getElementById('cmFilterBanner');
  if (fb) fb.style.display = 'none';
  cmRenderTable();
}

function cmDrillDown(lvl, parentId) {
  const nl = HM_CHILD_TABLE[lvl];
  if (!nl) return;
  window._hmActiveLevel = nl;
  window._hmParentFilter = { field: HM_CHILD_FIELD[lvl], value: parentId };
  // Sync active tabs
  HM_LEVELS.forEach((l,i) => {
    document.querySelectorAll('.cm-tab')[i]?.classList.toggle('active', l.k === nl);
    document.querySelectorAll('.cm-stat-card')[i]?.classList.toggle('active', l.k === nl);
  });
  // Show filter banner
  const parentRow = (window._hmData[lvl]||[]).find(r => r.id === parentId);
  const lvlInfo = HM_LEVELS.find(l => l.k === nl);
  const fb = document.getElementById('cmFilterBanner');
  const fl = document.getElementById('cmFilterLabel');
  if (fb) fb.style.display = 'flex';
  if (fl) fl.textContent = (parentRow?.name || '') + (lvlInfo ? ' → ' + lvlInfo.label : '');
  const searchEl = document.getElementById('cmSearch');
  if (searchEl) searchEl.value = '';
  const addBtn = document.getElementById('cmAddBtnTop');
  if (addBtn && lvlInfo) addBtn.textContent = '➕ Add ' + lvlInfo.label;
  cmRenderTable();
}

function cmRenderTable() {
  const wrap = document.getElementById('cmTableWrap');
  const countEl = document.getElementById('cmCountLabel');
  if (!wrap) return;
  const lvl = window._hmActiveLevel;
  const lvlInfo = HM_LEVELS.find(l => l.k === lvl) || HM_LEVELS[0];
  const d = window._hmData;
  const pf = window._hmParentFilter;
  const q = (document.getElementById('cmSearch')?.value || '').toLowerCase().trim();

  let rows = [...(d[lvl] || [])];
  if (pf) rows = rows.filter(r => r[pf.field] === pf.value);
  if (q) rows = rows.filter(r => (r.name||'').toLowerCase().includes(q) || (r.slug||'').toLowerCase().includes(q));

  if (countEl) countEl.textContent = rows.length + ' item' + (rows.length !== 1 ? 's' : '');

  if (!rows.length) {
    wrap.innerHTML = `<div class="cm-empty">
      <div class="cm-empty-icon">${lvlInfo.icon}</div>
      <div style="font-weight:700;margin-bottom:6px">No ${lvlInfo.label} found</div>
      <div style="font-size:.82rem;color:var(--text3)">${!q && !pf ? 'Click ➕ Add to create the first one.' : 'Try a different search or clear the filter.'}</div>
    </div>`;
    return;
  }

  const pt = HM_PARENT_TABLE[lvl];
  const parentFieldKey = HM_PARENT_FIELD[lvl];
  const ct = HM_CHILD_TABLE[lvl];
  const cfKey = HM_CHILD_FIELD[lvl];

  const showParent = lvl !== 'categories';

  const tbody = rows.map(r => {
    const parentRow = pt ? (d[pt]||[]).find(p => p.id === r[parentFieldKey]) : null;
    const childCnt = ct ? (d[ct]||[]).filter(c => c[HM_CHILD_FIELD[lvl]] === r.id).length : null;
    const childLvl = HM_LEVELS.find(l => l.k === ct);

    return `<tr>
      <td>
        <div class="cm-name-cell">${r.icon ? r.icon + ' ' : ''}${r.name || '—'}</div>
      </td>
      ${showParent ? `<td>
        ${parentRow
          ? `<span class="cm-parent-chip">${parentRow.name}</span>`
          : '<span style="color:var(--text3);font-size:.75rem">—</span>'}
      </td>` : ''}
      <td>
        ${ct !== null
          ? `<button class="cm-child-btn" onclick="cmDrillDown('${lvl}','${r.id}')" title="View ${childLvl?.label||'children'}">
              ${childCnt} ${childLvl?.icon||'→'}
             </button>`
          : '<span style="color:var(--text3);font-size:.78rem">leaf</span>'}
      </td>
      <td class="cm-slug-cell">${r.slug || '—'}</td>
      <td><span style="font-size:.85rem">${r.color || r.icon || '—'}</span></td>
      <td><span style="font-size:.8rem;color:var(--text2)">${r.sort_order ?? '—'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="cm-action-btn" onclick="cmOpenEditModal('${lvl}','${r.id}')">✏️ Edit</button>
          <button class="cm-del-btn" onclick="cmOpenDeleteModal('${lvl}','${r.id}','${(r.name||'').replace(/'/g,"\\'").replace(/"/g,'\\"')}',${childCnt||0})">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="cm-table">
    <thead><tr>
      <th>Name</th>
      ${showParent ? '<th>Parent</th>' : ''}
      <th>Children</th>
      <th>Slug</th>
      <th>Icon/Color</th>
      <th>Sort</th>
      <th>Actions</th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`;
}

async function cmReload() {
  const wrap = document.getElementById('cmTableWrap');
  if (wrap) wrap.innerHTML = '<div class="cm-empty"><span class="auth-spinner"></span><div style="margin-top:12px">Reloading…</div></div>';
  await hmLoadAll();
  cmSyncCounts();
  cmRenderTable();
  showToast('✅ Classification data reloaded', 'success');
}

// ── Modal Helpers ─────────────────────────────────────────────────
function cmOpenModal() {
  const m = document.getElementById('cmModal');
  if (m) m.classList.add('open');
}
function cmCloseModal() {
  const m = document.getElementById('cmModal');
  if (m) m.classList.remove('open');
}
function cmCloseDeleteModal() {
  const m = document.getElementById('cmDeleteModal');
  if (m) m.classList.remove('open');
}

function cmBuildModalHtml(lvl, row) {
  const lvlInfo = HM_LEVELS.find(l => l.k === lvl) || HM_LEVELS[0];
  const isEdit = !!row;
  const pt = HM_PARENT_TABLE[lvl];
  const pf = HM_PARENT_FIELD[lvl];
  const parentOpts = pt
    ? (window._hmData[pt]||[]).map(p => `<option value="${p.id}" ${row && row[pf]===p.id ? 'selected':''}>${p.name}</option>`).join('')
    : '';
  const parentLvl = HM_LEVELS.find(l => l.k === pt);

  return `
    <div class="cm-modal-header">
      <div class="cm-modal-title">
        <span style="font-size:1.4rem">${lvlInfo.icon}</span>
        ${isEdit ? 'Edit' : 'Add'} ${lvlInfo.label}
      </div>
      <button class="cm-modal-close" onclick="cmCloseModal()">✕</button>
    </div>

    ${pt ? `<div class="cm-modal-field">
      <div class="cm-modal-label">Parent ${parentLvl?.label || pt} <span style="color:var(--danger)">*</span></div>
      <select class="cm-modal-input" id="cmModalParent">
        <option value="">— Select ${parentLvl?.label || pt} —</option>
        ${parentOpts}
      </select>
    </div>` : ''}

    <div class="cm-modal-field">
      <div class="cm-modal-label">Name <span style="color:var(--danger)">*</span></div>
      <input class="cm-modal-input" id="cmModalName" value="${row ? (row.name||'') : ''}" placeholder="${lvlInfo.label} name" oninput="cmAutoSlug()" />
    </div>

    <div class="cm-modal-field">
      <div class="cm-modal-label">Slug</div>
      <div style="display:flex;gap:8px">
        <input class="cm-modal-input" id="cmModalSlug" value="${row ? (row.slug||'') : ''}" placeholder="auto-generated" style="flex:1" />
        <button class="btn btn-secondary btn-sm" onclick="cmAutoSlug(true)">↺</button>
      </div>
    </div>

    ${lvl === 'categories' ? `<div class="cm-modal-grid2">
      <div class="cm-modal-field">
        <div class="cm-modal-label">Icon (emoji)</div>
        <input class="cm-modal-input" id="cmModalIcon" value="${row ? (row.icon||'') : ''}" placeholder="📚" />
      </div>
      <div class="cm-modal-field">
        <div class="cm-modal-label">Color (hex)</div>
        <input class="cm-modal-input" id="cmModalColor" value="${row ? (row.color||'') : ''}" placeholder="#3d8ef8" />
      </div>
    </div>` : ''}

    <div class="cm-modal-field">
      <div class="cm-modal-label">Sort Order</div>
      <input class="cm-modal-input" id="cmModalSort" type="number" value="${row ? (row.sort_order ?? 0) : 0}" placeholder="0" />
    </div>

    <div class="cm-modal-error" id="cmModalError"></div>

    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-secondary" style="flex:1" onclick="cmCloseModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" id="cmModalSaveBtn"
        onclick="${isEdit ? `cmSaveEdit('${lvl}','${row.id}','${pf||''}')` : `cmSaveNew('${lvl}','${pf||''}')`}">
        ${isEdit ? '💾 Save Changes' : '➕ Add ' + lvlInfo.label}
      </button>
    </div>`;
}

function cmOpenAddModal() {
  const lvl = window._hmActiveLevel;
  document.getElementById('cmModalContent').innerHTML = cmBuildModalHtml(lvl, null);
  cmOpenModal();
}
function cmOpenEditModal(lvl, id) {
  const row = (window._hmData[lvl]||[]).find(r => r.id === id);
  if (!row) return;
  document.getElementById('cmModalContent').innerHTML = cmBuildModalHtml(lvl, row);
  cmOpenModal();
}

function cmAutoSlug(force) {
  const name = document.getElementById('cmModalName')?.value || '';
  const slugEl = document.getElementById('cmModalSlug');
  if (!slugEl) return;
  if (force || !slugEl.value) slugEl.value = generateSlug(name);
}

function cmShowModalError(msg) {
  const el = document.getElementById('cmModalError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function cmOpenDeleteModal(lvl, id, name, childCnt) {
  window._cmDeleteTarget = { lvl, id, name };
  const msg = document.getElementById('cmDeleteMsg');
  if (msg) {
    msg.innerHTML = `Delete <strong>"${name}"</strong>?` +
      (parseInt(childCnt) > 0
        ? `<br><br><span style="color:var(--danger);font-size:.78rem">⚠️ This has ${childCnt} child item(s). Only delete if no PDFs are assigned to it.</span>`
        : '');
  }
  const btn = document.getElementById('cmDeleteConfirmBtn');
  if (btn) { btn.textContent = '🗑️ Delete'; btn.disabled = false; }
  const m = document.getElementById('cmDeleteModal');
  if (m) m.classList.add('open');
}

async function cmSaveNew(lvl, parentField) {
  const btn = document.getElementById('cmModalSaveBtn');
  const name = document.getElementById('cmModalName')?.value?.trim();
  if (!name) { cmShowModalError('Name is required.'); return; }
  const parentId = document.getElementById('cmModalParent')?.value;
  if (parentField && !parentId) {
    const ptLvl = HM_LEVELS.find(l => l.k === HM_PARENT_TABLE[lvl]);
    cmShowModalError('Please select a ' + (ptLvl?.label || 'parent') + '.'); return;
  }
  if (!window.supabaseClient) { cmShowModalError('Supabase not connected.'); return; }
  if (btn) { btn.textContent = 'Adding…'; btn.disabled = true; }

  const payload = {
    name,
    slug: document.getElementById('cmModalSlug')?.value?.trim() || generateSlug(name),
    sort_order: parseInt(document.getElementById('cmModalSort')?.value || 0) || 0,
    ...(parentField && parentId ? { [parentField]: parentId } : {}),
    ...(document.getElementById('cmModalIcon')  ? { icon:  document.getElementById('cmModalIcon')?.value?.trim()  || null } : {}),
    ...(document.getElementById('cmModalColor') ? { color: document.getElementById('cmModalColor')?.value?.trim() || null } : {}),
  };
  try {
    const { error } = await window.supabaseClient.from(lvl).insert(payload);
    if (error) throw error;
    cmCloseModal();
    showToast('✅ ' + name + ' added!', 'success');
    logAdminActivity?.('Added ' + lvl + ': "' + name + '"', 'green');
    await hmLoadAll();
    cmSyncCounts();
    cmRenderTable();
    // Refresh cascade dropdown in add PDF page if open
    apCMReload?.();
  } catch(e) {
    cmShowModalError('Error: ' + (e.message || 'Unknown error'));
    if (btn) { btn.textContent = '➕ Add'; btn.disabled = false; }
  }
}

async function cmSaveEdit(lvl, id, parentField) {
  const btn = document.getElementById('cmModalSaveBtn');
  const name = document.getElementById('cmModalName')?.value?.trim();
  if (!name) { cmShowModalError('Name is required.'); return; }
  const parentId = document.getElementById('cmModalParent')?.value;
  if (parentField && !parentId) {
    const ptLvl = HM_LEVELS.find(l => l.k === HM_PARENT_TABLE[lvl]);
    cmShowModalError('Please select a ' + (ptLvl?.label || 'parent') + '.'); return;
  }
  if (!window.supabaseClient) { cmShowModalError('Supabase not connected.'); return; }
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const payload = {
    name,
    slug: document.getElementById('cmModalSlug')?.value?.trim() || generateSlug(name),
    sort_order: parseInt(document.getElementById('cmModalSort')?.value || 0) || 0,
    ...(parentField && parentId ? { [parentField]: parentId } : {}),
    ...(document.getElementById('cmModalIcon')  ? { icon:  document.getElementById('cmModalIcon')?.value?.trim()  || null } : {}),
    ...(document.getElementById('cmModalColor') ? { color: document.getElementById('cmModalColor')?.value?.trim() || null } : {}),
  };
  try {
    const { error } = await window.supabaseClient.from(lvl).update(payload).eq('id', id);
    if (error) throw error;
    cmCloseModal();
    showToast('✅ ' + name + ' updated!', 'success');
    logAdminActivity?.('Updated ' + lvl + ': "' + name + '"', 'blue');
    await hmLoadAll();
    cmSyncCounts();
    cmRenderTable();
    apCMReload?.();
  } catch(e) {
    cmShowModalError('Error: ' + (e.message || 'Unknown error'));
    if (btn) { btn.textContent = '💾 Save Changes'; btn.disabled = false; }
  }
}

async function cmConfirmDelete() {
  const t = window._cmDeleteTarget;
  if (!t || !window.supabaseClient) return;
  const btn = document.getElementById('cmDeleteConfirmBtn');
  if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }
  try {
    const { error } = await window.supabaseClient.from(t.lvl).delete().eq('id', t.id);
    if (error) throw error;
    cmCloseDeleteModal();
    showToast('🗑️ "' + t.name + '" deleted', 'success');
    logAdminActivity?.('Deleted ' + t.lvl + ': "' + t.name + '"', 'red');
    await hmLoadAll();
    cmSyncCounts();
    cmRenderTable();
    apCMReload?.();
  } catch(e) {
    cmCloseDeleteModal();
    showToast('Delete failed: ' + (e.message || 'Unknown error'), 'error');
  }
}

// ── Keep old hm* functions working (used internally / backwards compat) ──
function hmRenderMain(main) {
  // Delegate to new renderAdminCategories
  if (main) renderAdminCategories(main);
}

function hmSwitchLevel(lvl) { cmSwitchLevel(lvl); }
function hmDrillDown(lvl, parentId) { cmDrillDown(lvl, parentId); }
function hmClearFilter() { cmClearFilter(); }
async function hmReload() { await cmReload(); }
function hmOpenModal() { cmOpenModal(); }
function hmCloseModal() { cmCloseModal(); }
function hmOpenDeleteModal(lvl, id, name, childCount) { cmOpenDeleteModal(lvl, id, name, childCount); }
function hmCloseDeleteModal() { cmCloseDeleteModal(); }
async function hmConfirmDelete() { await cmConfirmDelete(); }
function hmOpenAddModal() { cmOpenAddModal(); }
function hmOpenEditModal(lvl, id) { cmOpenEditModal(lvl, id); }
function hmAutoSlugModal(force) { cmAutoSlug(force); }
function hmShowModalError(msg) { cmShowModalError(msg); }
async function hmSaveNew(lvl, pf) { await cmSaveNew(lvl, pf); }
async function hmSaveEdit(lvl, id, pf) { await cmSaveEdit(lvl, id, pf); }
function hmRowHtml(r, lvl, d, parentField) { return ''; } // replaced by cmRenderTable

// ── hmLoadAll — shared data loader (used by both cm* and ap* systems) ──
async function hmLoadAll() {
  if (!window.supabaseClient) return;
  try {
    const tables = ['categories','subcategories','academic_levels','streams','semester_classes','subjects'];
    const results = await Promise.all(tables.map(t =>
      window.supabaseClient.from(t).select('*').order('sort_order').order('name')
    ));
    tables.forEach((t,i) => { window._hmData[t] = results[i].data || []; });
    // Sync global caches used by cascade dropdowns
    window._dbCategories    = window._hmData.categories;
    window._dbSubcategories = window._hmData.subcategories;
    window._dbSubcatMap     = {};
    window._hmData.subcategories.forEach(s => {
      if (!window._dbSubcatMap[s.category_id]) window._dbSubcatMap[s.category_id] = [];
      window._dbSubcatMap[s.category_id].push(s);
    });
    // Also sync to apCM cache
    if (window._apCM) {
      tables.forEach(t => { window._apCM.data[t] = window._hmData[t]; });
      window._apCM.loaded = true;
    }
    // Refresh the category dropdown in add/edit PDF page if open
    const catEl = document.getElementById('apCat');
    if (catEl) {
      const cur = catEl.value;
      catEl.innerHTML = '<option value="">— Select Category —</option>' +
        (window._dbCategories||[]).map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('');
      if (cur) catEl.value = cur;
    }
  } catch(e) { console.warn('hmLoadAll error:', e); }
}

// ── ORDERS ─────────────────────────────────────────────────────────
async function renderAdminOrders(main) {
  main.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">Loading orders…</div>`;

  let orders = RECENT_SALES.map((o,i) => ({
    id: 'ORD'+(1000+i), user_email: o.user, pdf_title: o.pdf,
    amount: o.amount, payment_id: 'No data available',
    status: 'paid', created_at: o.time
  }));

  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('purchased_pdfs').select('*').order('created_at', {ascending:false}).limit(50);
      if (data?.length) orders = data;
    } catch(e) {}
  }

  const totalRevenue = orders.reduce((s,o) => s+(o.amount||0), 0);
  document.getElementById('adminOrdersBadge').textContent = orders.length;

  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('cart',20)} Orders</div>
    <div class="admin-stats-grid" style="grid-template-columns:repeat(4,1fr)">
      ${adminStatCard('Total Orders', orders.length, 'all time', true, 'blue', 'cart')}
      ${adminStatCard('Total Revenue', '₹'+totalRevenue.toLocaleString(), 'collected', true, 'green', 'trending')}
      ${adminStatCard('Avg Order', '₹'+(orders.length?Math.round(totalRevenue/orders.length):0), 'per order', true, 'gold', 'tag')}
      ${adminStatCard('Refunds', '0', 'this month', true, 'purple', 'x')}
    </div>
    <div class="admin-table-card">
      <div class="admin-table-header">
        <div style="font-size:.9rem;font-weight:700">All Orders</div>
        <input class="admin-table-search" placeholder="Search by email or PDF…" oninput="adminFilterOrders(this.value, ${JSON.stringify(orders).replace(/"/g,'&quot;')})" />
      </div>
      <div class="table-wrap">
        <table class="admin-table" style="width:100%" id="adminOrdersTable">
          <thead><tr><th>Order ID</th><th>Buyer Email</th><th>PDF</th><th>Amount</th><th>Payment ID</th><th>Status</th><th>Date</th></tr></thead>
          <tbody id="adminOrdersBody">
            ${orders.map(o => adminOrderRow(o)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  window._adminOrders = orders;
}

function adminOrderRow(o) {
  return `<tr>
    <td style="font-size:.75rem;font-family:monospace;color:var(--text2)">${o.id||'—'}</td>
    <td><div style="font-size:.83rem;font-weight:600">${o.user_email||o.user||'—'}</div></td>
    <td><div style="font-size:.8rem;color:var(--text2);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.pdf_title||o.pdf||'—'}</div></td>
    <td><span class="admin-badge admin-badge-success">₹${o.amount||0}</span></td>
    <td><span style="font-size:.72rem;font-family:monospace;color:var(--text2)">${o.payment_id||'—'}</span></td>
    <td><span class="admin-badge admin-badge-accent">Paid</span></td>
    <td style="font-size:.75rem;color:var(--text2)">${o.created_at||o.time||'—'}</td>
  </tr>`;
}

function adminFilterOrders(q, orders) {
  const filtered = orders.filter(o => !q || (o.user_email||o.user||'').toLowerCase().includes(q.toLowerCase()) || (o.pdf_title||o.pdf||'').toLowerCase().includes(q.toLowerCase()));
  const body = document.getElementById('adminOrdersBody');
  if (body) body.innerHTML = filtered.map(o => adminOrderRow(o)).join('');
}

// ── USERS ──────────────────────────────────────────────────────────
async function renderAdminUsers(main) {
  main.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">Loading users…</div>`;

  let users = MOCK_USERS;
  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('purchased_pdfs').select('user_email, amount').limit(100);
      if (data?.length) {
        const userMap = {};
        data.forEach(r => {
          if (!userMap[r.user_email]) userMap[r.user_email] = {email: r.user_email, purchases: 0, revenue: 0};
          userMap[r.user_email].purchases++;
          userMap[r.user_email].revenue += r.amount||0;
        });
        users = Object.values(userMap);
      }
    } catch(e) {}
  }

  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('users',20)} User Management</div>
    <div class="admin-stats-grid" style="grid-template-columns:repeat(3,1fr)">
      ${adminStatCard('Total Users', users.length+'K+', '+523 this week', true, 'blue', 'users')}
      ${adminStatCard('Active Users', '18,923', 'last 30 days', true, 'green', 'zap')}
      ${adminStatCard('Paying Users', '4,231', '22.4% conversion', true, 'gold', 'tag')}
    </div>
    <div class="admin-table-card">
      <div class="admin-table-header">
        <div style="font-size:.9rem;font-weight:700">All Users</div>
        <input class="admin-table-search" placeholder="Search by email…" />
      </div>
      <div class="table-wrap">
        <table class="admin-table" style="width:100%">
          <thead><tr><th>#</th><th>User</th><th>Email</th><th>Purchases</th><th>Revenue</th><th>Downloads</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.map((u,i) => `<tr>
              <td style="font-size:.75rem;color:var(--text2)">${i+1}</td>
              <td><div style="font-size:.83rem;font-weight:600">${u.name||u.email?.split('@')[0]||'User'}</div></td>
              <td style="font-size:.8rem;color:var(--text2)">${u.email||'—'}</td>
              <td><span class="admin-badge admin-badge-accent">${u.purchases||0}</span></td>
              <td style="font-size:.82rem;font-weight:600;color:var(--success)">₹${(u.revenue||u.totalSpent||0).toLocaleString()}</td>
              <td>${u.purchases||0}</td>
              <td><button class="btn btn-secondary btn-sm">${adminIcon('eye',12)} View</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── REVENUE ────────────────────────────────────────────────────────
function renderAdminRevenue(main) {
  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('trending',20)} Revenue Analytics</div>
    <div class="admin-stats-grid">
      ${adminStatCard('Total Revenue', '₹8.9L', '+23.4% MoM', true, 'blue', 'trending')}
      ${adminStatCard('This Month', '₹1.24L', '+18% vs last month', true, 'green', 'zap')}
      ${adminStatCard('This Week', '₹34,200', '+12% vs last week', true, 'gold', 'tag')}
      ${adminStatCard('Today', '₹8,760', '+5% vs yesterday', true, 'purple', 'cart')}
    </div>
    <div style="display:grid;grid-template-columns:3fr 2fr;gap:20px;margin-bottom:20px">
      <div class="admin-table-card">
        <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Monthly Revenue (2025)</div></div>
        <div style="padding:20px">
          <div class="admin-mini-chart" style="height:100px;gap:6px">
            ${[320000,410000,380000,460000,390000,520000,480000,550000,410000,620000,570000,680000].map((v,i) => {
              const h = Math.round((v/680000)*100);
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return `<div class="admin-chart-bar" style="height:${h}%" title="${months[i]}: ₹${(v/1000).toFixed(0)}K"></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:.68rem;color:var(--text2)">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m=>`<span>${m}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="admin-table-card">
        <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Revenue by Category</div></div>
        <div style="padding:16px">
          ${[['Engineering','₹2.8L',42],['Govt Exams','₹1.9L',28],['CS & Tech','₹1.2L',18],['School','₹0.6L',9],['Others','₹0.4L',6]].map(([c,rev,pct]) => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:5px">
                <span class="fw-600">${c}</span>
                <span style="color:var(--accent)">${rev}</span>
              </div>
              <div class="admin-progress"><div class="admin-progress-fill" style="width:${pct}%"></div></div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="admin-table-card">
      <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Razorpay Payment Breakdown</div></div>
      <div class="table-wrap"><table class="admin-table" style="width:100%">
        <thead><tr><th>Period</th><th>Transactions</th><th>Revenue</th><th>Refunds</th><th>Net</th><th>Growth</th></tr></thead>
        <tbody>
          ${[['This Week','340','₹1.24L','₹0','₹1.24L','+12%',true],['Last Week','302','₹1.09L','₹1,299','₹1.08L','+8%',true],['This Month','1,230','₹4.8L','₹2,398','₹4.77L','+23%',true],['Last Month','999','₹3.9L','₹3,200','₹3.87L','+14%',true]].map(([p,t,r,rf,n,g,up]) => `
            <tr><td class="fw-600">${p}</td><td>${t}</td><td style="color:var(--success);font-weight:600">${r}</td><td style="color:var(--danger)">${rf}</td><td style="font-weight:700">${n}</td><td><span class="admin-badge ${up?'admin-badge-success':'admin-badge-danger'}">${g}</span></td></tr>
          `).join('')}
        </tbody>
      </table></div>
    </div>`;
}

// ── ACTIVITY LOGS ──────────────────────────────────────────────────
function renderAdminActivity(main) {
  // Add some default logs if empty
  if (!adminActivityLog.length) {
    const defaultLogs = [
      {msg:'Admin panel initialized', type:'blue', time: new Date(Date.now()-60000)},
      {msg:'Supabase realtime sync active', type:'green', time: new Date(Date.now()-120000)},
      {msg:'Session started', type:'blue', time: new Date(Date.now()-180000)},
    ];
    adminActivityLog.push(...defaultLogs);
  }

  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('bell',20)} Activity Logs</div>
    <div class="admin-table-card">
      <div class="admin-table-header">
        <div style="font-size:.9rem;font-weight:700">System Activity</div>
        <button class="btn btn-ghost btn-sm" onclick="adminActivityLog=[];renderAdminActivity(document.getElementById('adminMain'))">Clear Logs</button>
      </div>
      <div style="padding:4px 16px">
        ${adminActivityLog.length ? adminActivityLog.map(log => `
          <div class="admin-log-item">
            <div class="admin-log-dot admin-log-dot-${log.type}"></div>
            <div class="admin-log-content">
              <div class="admin-log-msg">${log.msg}</div>
              <div class="admin-log-time">${log.time ? new Date(log.time).toLocaleString() : ''}</div>
            </div>
          </div>`).join('')
        : '<div style="text-align:center;padding:40px;color:var(--text2)">No activity logged yet.</div>'}
      </div>
    </div>`;
}

// ── SETTINGS ────────────────────────────────────────────────────────
function renderAdminSettings(main) {
  main.innerHTML = `
    <div class="admin-section-title">${adminIcon('settings',20)} Admin Settings</div>

    <div class="admin-settings-section">
      <div class="admin-settings-title" style="color:var(--accent)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 01-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 011-.965 11.76 11.76 0 007-1.95 11.76 11.76 0 007 1.95 1 1 0 011 .965z"/></svg>
        Supabase Settings
      </div>
      <div class="card p-4">
        <div class="admin-form-grid">
          <div class="form-group"><label class="form-label">Project URL</label><input class="form-input" placeholder="https://xxxx.supabase.co" id="stgSupabaseUrl" /></div>
          <div class="form-group"><label class="form-label">Anon Key</label><input class="form-input" placeholder="eyJhbGciOiJ…" type="password" id="stgSupabaseKey" /></div>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Realtime Sync</div><div class="text-muted text-xs mt-1">Live sync for PDFs, orders, users</div></div>
          <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Auto Publish PDFs</div><div class="text-muted text-xs mt-1">Instantly publish when added</div></div>
          <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
        </div>
        <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Supabase settings saved!','success')">${adminIcon('check',13)} Save Supabase Config</button>
      </div>
    </div>

    <div class="admin-settings-section">
      <div class="admin-settings-title" style="color:var(--gold)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Razorpay Settings
      </div>
      <div class="card p-4">
        <div class="admin-form-grid">
          <div class="form-group"><label class="form-label">Key ID</label><input class="form-input" placeholder="rzp_live_…" id="stgRazorpayId" /></div>
          <div class="form-group"><label class="form-label">Key Secret</label><input class="form-input" type="password" placeholder="••••••••••••" id="stgRazorpaySecret" /></div>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Test Mode</div><div class="text-muted text-xs mt-1">Use Razorpay test keys</div></div>
          <button class="admin-toggle" onclick="this.classList.toggle('on')"></button>
        </div>
        <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Razorpay settings saved!','success')">${adminIcon('check',13)} Save Razorpay Config</button>
      </div>
    </div>

    <div class="admin-settings-section">
      <div class="admin-settings-title" style="color:var(--success)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Pipedream Settings
      </div>
      <div class="card p-4">
        <div class="form-group"><label class="form-label">Webhook URL</label><input class="form-input" id="stgPipedream" value="https://eod16l3iacfjwl6.m.pipedream.net" /></div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Login Events</div><div class="text-muted text-xs mt-1">Send user login events to Pipedream</div></div>
          <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Purchase Events</div><div class="text-muted text-xs mt-1">Send PDF purchase events</div></div>
          <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
        </div>
        <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Pipedream webhook saved!','success')">${adminIcon('check',13)} Save Webhook</button>
      </div>
    </div>

    <div class="admin-settings-section">
      <div class="admin-settings-title">
        ${adminIcon('globe',18)} Website Settings
      </div>
      <div class="card p-4">
        <div class="admin-form-grid">
          <div class="form-group"><label class="form-label">Site Name</label><input class="form-input" value="Studyria" /></div>
          <div class="form-group"><label class="form-label">Tagline</label><input class="form-input" value="Assam's #1 PDF Study Platform" /></div>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Maintenance Mode</div><div class="text-muted text-xs mt-1">Show maintenance page to visitors</div></div>
          <button class="admin-toggle" onclick="this.classList.toggle('on')"></button>
        </div>
        <div class="admin-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Free PDF Access</div><div class="text-muted text-xs mt-1">Allow free PDF downloads without login</div></div>
          <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
        </div>
        <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Website settings saved!','success')">${adminIcon('check',13)} Save Website Config</button>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// 🚀 PLATFORM CONTROL CENTER — ALL NEW MODULE RENDERERS
// ═══════════════════════════════════════════════════════════════

/* ─── shared helpers ─────────────────────────────────────────── */
function pccToggle(el) {
  const sec = el.closest('.pcc-section');
  sec.classList.toggle('open');
}
function pccModBack(tab) { switchAdminTab(tab); }

function pccSectionHtml(id, emoji, bg, title, sub, items) {
  const rows = items.map(([ico,lbl]) => `
    <div class="pcc-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ico}</svg>${lbl}</div>
  `).join('');
  return `
  <div class="pcc-section" id="pcc-${id}">
    <div class="pcc-header" onclick="pccToggle(this)">
      <div class="pcc-header-left">
        <div class="pcc-header-icon" style="background:${bg}">${emoji}</div>
        <div><div class="pcc-header-title">${title}</div><div class="pcc-header-sub">${sub}</div></div>
      </div>
      <svg class="pcc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="pcc-body"><div class="pcc-grid">${rows}</div></div>
  </div>`;
}

function ico(d) { return `<path d="${d}"/>`; }

/* ─── 1. ADVANCED PDF MANAGER ────────────────────────────────── */

// ── State ────────────────────────────────────────────────────────
window._apm = {
  activeTab: 'bulk-upload',
  bulkQueue: [],        // [{file, title, status, progress, error, url}]
  pdfList: [],          // pdfs from db for version/seo/analytics panels
  watermarkSettings: null,
};

// ── SQL Schema (shown once in header) ───────────────────────────
const APM_SQL = `-- Run once in Supabase SQL Editor
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published';
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS schedule_publish_at TIMESTAMPTZ;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS preview_pdf_url TEXT;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS seo_keywords TEXT;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS og_image TEXT;

CREATE TABLE IF NOT EXISTS pdf_versions (
  id BIGSERIAL PRIMARY KEY,
  pdf_id BIGINT REFERENCES pdfs(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  pdf_url TEXT NOT NULL,
  cover_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS pdf_analytics (
  id BIGSERIAL PRIMARY KEY,
  pdf_id BIGINT REFERENCES pdfs(id) ON DELETE CASCADE,
  views BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  purchases BIGINT DEFAULT 0,
  downloads BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS downloads (
  id BIGSERIAL PRIMARY KEY,
  pdf_id BIGINT REFERENCES pdfs(id) ON DELETE CASCADE,
  user_id TEXT,
  user_email TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watermark_settings (
  id INT PRIMARY KEY DEFAULT 1,
  text TEXT DEFAULT 'Studyria.com — Licensed Copy',
  opacity INT DEFAULT 18,
  position TEXT DEFAULT 'diagonal',
  apply_to_all BOOLEAN DEFAULT true,
  use_user_email BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS upload_queue (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT,
  status TEXT DEFAULT 'pending',
  pdf_url TEXT,
  cover_url TEXT,
  metadata JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`;

// ── Tab renderer ─────────────────────────────────────────────────
async function renderPCCPDFManager(main) {
  const tab = window._apm.activeTab;

  // header + tab nav always render first
  main.innerHTML = `
  <style>
    .apm-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;padding:4px;background:var(--surface);border:1px solid var(--glass-border);border-radius:14px}
    .apm-tab{padding:8px 14px;border-radius:10px;font-size:.8rem;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--text2);transition:all .2s;white-space:nowrap;font-family:var(--font-body)}
    .apm-tab.active{background:var(--grad-primary);color:#fff;box-shadow:0 4px 14px rgba(61,142,248,.35)}
    .apm-tab:hover:not(.active){background:var(--glass);color:var(--text)}
    .apm-panel{animation:dashFadeUp .25s ease both}
    .apm-card{background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;padding:20px;margin-bottom:16px}
    .apm-card-title{font-weight:700;font-size:.92rem;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    .apm-queue-item{display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface);border:1px solid var(--glass-border);border-radius:10px;margin-bottom:8px;flex-wrap:wrap}
    .apm-queue-name{flex:1;min-width:0;font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .apm-progress-wrap{width:100%;height:6px;background:var(--glass);border-radius:3px;overflow:hidden;margin-top:4px}
    .apm-progress-bar{height:100%;border-radius:3px;background:var(--grad-primary);transition:width .3s ease}
    .apm-status-badge{font-size:.7rem;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap}
    .apm-badge-pending{background:rgba(245,158,11,.15);color:var(--gold);border:1px solid rgba(245,158,11,.3)}
    .apm-badge-uploading{background:rgba(61,142,248,.15);color:var(--accent);border:1px solid rgba(61,142,248,.3)}
    .apm-badge-done{background:rgba(16,217,142,.15);color:var(--success);border:1px solid rgba(16,217,142,.3)}
    .apm-badge-error{background:rgba(255,77,109,.15);color:var(--danger);border:1px solid rgba(255,77,109,.3)}
    .apm-badge-draft{background:rgba(139,92,246,.15);color:#c4b5fd;border:1px solid rgba(139,92,246,.3)}
    .apm-badge-scheduled{background:rgba(0,200,232,.15);color:var(--accent2);border:1px solid rgba(0,200,232,.3)}
    .apm-badge-published{background:rgba(16,217,142,.15);color:var(--success);border:1px solid rgba(16,217,142,.3)}
    .apm-empty{text-align:center;padding:40px 20px;color:var(--text2);font-size:.85rem}
    .apm-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--glass-border);flex-wrap:wrap}
    .apm-row:last-child{border-bottom:none}
    .apm-perf-ring{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0;border:3px solid}
    .apm-sql-block{background:#070d1a;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px;font-size:.7rem;line-height:1.7;color:#7dd3fc;overflow-x:auto;max-height:180px;font-family:monospace;white-space:pre}
    .apm-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--glass-border);gap:10px;flex-wrap:wrap}
    .apm-toggle-row:last-child{border-bottom:none}
  </style>

  <div class="admin-section-title">📚 Advanced PDF Manager</div>
  <div class="admin-section-sub">Bulk upload · Drafts · Scheduling · Versions · Watermarks · SEO · Analytics · Downloads · Performance</div>

  <!-- SQL Setup card -->
  <details style="margin-bottom:16px">
    <summary style="cursor:pointer;font-size:.82rem;font-weight:700;color:var(--gold);padding:10px 14px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:10px;list-style:none">
      🗄️ Required Supabase Tables — click to expand SQL
    </summary>
    <div style="margin-top:6px;position:relative">
      <div class="apm-sql-block" id="apmSqlBlock">${APM_SQL}</div>
      <button class="btn btn-ghost btn-sm" style="position:absolute;top:8px;right:8px" onclick="navigator.clipboard.writeText(APM_SQL);showToast('SQL copied!','success')">📋 Copy</button>
    </div>
  </details>

  <!-- Tab Navigation -->
  <div class="apm-tabs">
    ${[
      ['bulk-upload','📤 Bulk Upload'],
      ['drafts','📝 Drafts'],
      ['scheduled','🗓 Scheduled'],
      ['versions','🔄 Versions'],
      ['preview-upload','👁 Preview Upload'],
      ['watermark','🔒 Watermarks'],
      ['seo','🔍 SEO'],
      ['analytics','📊 Analytics'],
      ['downloads','📥 Downloads'],
      ['performance','🏅 Performance'],
    ].map(([id,lbl]) => `<button class="apm-tab ${tab===id?'active':''}" onclick="apmTab('${id}')">${lbl}</button>`).join('')}
  </div>

  <div id="apmPanelContainer" class="apm-panel"></div>`;

  await apmRenderPanel(tab);
}

function apmTab(id) {
  window._apm.activeTab = id;
  document.querySelectorAll('.apm-tab').forEach(b => b.classList.toggle('active', b.textContent.includes(id) || b.onclick?.toString().includes(id)));
  // Update active state properly
  document.querySelectorAll('.apm-tab').forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${id}'`)) b.classList.add('active');
  });
  apmRenderPanel(id);
}

async function apmRenderPanel(tab) {
  const container = document.getElementById('apmPanelContainer');
  if (!container) return;
  const sb = window.supabaseClient;

  switch(tab) {

    // ── 1. BULK UPLOAD ─────────────────────────────────────────────
    case 'bulk-upload': {
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">📤 Bulk PDF Upload</div>
        <div class="admin-upload-zone" id="apmBulkZone" style="margin-bottom:14px;cursor:pointer"
          onclick="document.getElementById('apmBulkInput').click()"
          ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
          ondragleave="this.style.borderColor=''"
          ondrop="event.preventDefault();this.style.borderColor='';apmHandleBulkDrop(event.dataTransfer.files)">
          <input type="file" id="apmBulkInput" multiple accept=".pdf" style="display:none" onchange="apmHandleBulkDrop(this.files)"/>
          <svg width="36" height="36" style="color:var(--text2);margin-bottom:8px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div style="font-size:.88rem;font-weight:600">Drop multiple PDFs here or click to browse</div>
          <div style="font-size:.75rem;color:var(--text2);margin-top:4px">PDF only · Max 100 MB each · Multiple files supported</div>
        </div>
        <div id="apmQueueList" style="margin-bottom:14px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="apmStartUploadBtn" onclick="apmStartBulkUpload(false)">🚀 Upload & Publish All</button>
          <button class="btn btn-secondary btn-sm" onclick="apmStartBulkUpload(true)">📝 Upload as Drafts</button>
          <button class="btn btn-ghost btn-sm" onclick="apmClearQueue()">🗑 Clear Queue</button>
        </div>
        <div id="apmBulkStatus" style="margin-top:10px;font-size:.8rem;color:var(--text2)"></div>
      </div>

      <div class="apm-card">
        <div class="apm-card-title">📋 Upload Queue History <span style="font-size:.75rem;font-weight:400;color:var(--text2)">(from Supabase)</span></div>
        <div id="apmQueueHistory"><div class="apm-empty">Loading…</div></div>
      </div>`;

      apmRenderQueue();
      apmLoadQueueHistory();
      break;
    }

    // ── 2. DRAFTS ──────────────────────────────────────────────────
    case 'drafts': {
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">📝 Draft PDFs</div>
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="apmPublishAllDrafts()">✅ Publish All Drafts</button>
          <button class="btn btn-ghost btn-sm" onclick="apmLoadDrafts()">🔄 Refresh</button>
        </div>
        <div id="apmDraftsList"><div class="apm-empty">Loading drafts…</div></div>
      </div>`;
      apmLoadDrafts();
      break;
    }

    // ── 3. SCHEDULED PUBLISHING ────────────────────────────────────
    case 'scheduled': {
      const pdfs = await apmGetPDFs();
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">🗓 Schedule a PDF to Publish</div>
        <div class="admin-form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Select PDF</label>
            <select class="form-input" id="apmSchedPdfId">
              <option value="">— Choose a PDF —</option>
              ${pdfs.map(p=>`<option value="${p.id}">${p.title} (${p.status||'published'})</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Publish Date & Time</label>
            <input class="form-input" type="datetime-local" id="apmSchedDate" min="${new Date().toISOString().slice(0,16)}"/>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="apmSchedulePDF()">🗓 Schedule Publishing</button>
      </div>

      <div class="apm-card">
        <div class="apm-card-title">⏳ Scheduled PDFs <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="apmLoadScheduled()">🔄 Refresh</button></div>
        <div id="apmScheduledList"><div class="apm-empty">Loading…</div></div>
      </div>

      <div class="apm-card" style="background:rgba(0,200,232,.05);border-color:rgba(0,200,232,.2)">
        <div class="apm-card-title">⚙️ Auto-Publish Cron Status</div>
        <div style="font-size:.82rem;color:var(--text2);margin-bottom:10px">The cron job below runs every minute in Supabase and auto-publishes any PDF whose <code style="background:var(--surface);padding:1px 5px;border-radius:4px">schedule_publish_at</code> has passed.</div>
        <div class="apm-sql-block" style="max-height:120px">-- Supabase pg_cron (run in SQL Editor once)
SELECT cron.schedule('auto-publish-pdfs','* * * * *',$$
  UPDATE pdfs
  SET status = 'published', published = true, schedule_publish_at = NULL
  WHERE status = 'scheduled'
    AND schedule_publish_at <= NOW();
$$);</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="apmTriggerCron()">▶️ Run Auto-Publish Now</button>
      </div>`;
      apmLoadScheduled();
      break;
    }

    // ── 4. VERSION MANAGER ─────────────────────────────────────────
    case 'versions': {
      const pdfs = await apmGetPDFs();
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">🔄 PDF Version Manager</div>
        <div class="admin-form-grid" style="margin-bottom:14px">
          <div class="form-group">
            <label class="form-label">Select PDF</label>
            <select class="form-input" id="apmVerPdfId" onchange="apmLoadVersions(this.value)">
              <option value="">— Choose a PDF —</option>
              ${pdfs.map(p=>`<option value="${p.id}">${p.title}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="apmVersionsList"><div class="apm-empty" style="padding:20px 0">Select a PDF to see its version history.</div></div>
      </div>

      <div class="apm-card" id="apmNewVersionCard" style="display:none">
        <div class="apm-card-title">⬆️ Upload New Version</div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label">New PDF File</label>
          <div class="admin-upload-zone" style="cursor:pointer" onclick="document.getElementById('apmNewVerFile').click()">
            <input type="file" id="apmNewVerFile" accept=".pdf" style="display:none" onchange="document.getElementById('apmNewVerName').textContent=this.files[0]?.name||''"/>
            <svg width="24" height="24" style="color:var(--text2)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div id="apmNewVerName" style="font-size:.8rem;margin-top:4px;color:var(--text2)">Click to choose PDF</div>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Version Notes</label>
          <input class="form-input" id="apmNewVerNotes" placeholder="e.g. Added chapter 5, fixed typos"/>
        </div>
        <button class="btn btn-primary btn-sm" onclick="apmUploadNewVersion()">💾 Save as New Version</button>
      </div>`;
      break;
    }

    // ── 5. PREVIEW UPLOAD ──────────────────────────────────────────
    case 'preview-upload': {
      const pdfs = await apmGetPDFs();
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">👁 PDF Preview Upload <span style="font-size:.75rem;font-weight:400;color:var(--text2)">— sample pages shown before purchase</span></div>
        <div class="admin-form-grid" style="margin-bottom:14px">
          <div class="form-group">
            <label class="form-label">Select PDF</label>
            <select class="form-input" id="apmPrevPdfId" onchange="apmLoadPreviewInfo(this.value)">
              <option value="">— Choose a PDF —</option>
              ${pdfs.map(p=>`<option value="${p.id}">${p.title}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="apmCurrentPreviewInfo" style="margin-bottom:12px"></div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Upload Preview PDF (sample pages)</label>
          <div class="admin-upload-zone" style="cursor:pointer" onclick="document.getElementById('apmPrevFile').click()">
            <input type="file" id="apmPrevFile" accept=".pdf" style="display:none" onchange="document.getElementById('apmPrevFileName').textContent=this.files[0]?.name||''"/>
            <svg width="24" height="24" style="color:var(--text2)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div id="apmPrevFileName" style="font-size:.8rem;margin-top:4px;color:var(--text2)">Click to select preview PDF</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="apmUploadPreview()">📤 Upload Preview PDF</button>
      </div>`;
      break;
    }

    // ── 6. WATERMARK SETTINGS ──────────────────────────────────────
    case 'watermark': {
      let ws = { text:'Studyria.com — Licensed Copy', opacity:18, position:'diagonal', apply_to_all:true, use_user_email:false };
      if (sb) {
        try {
          const { data } = await sb.from('watermark_settings').select('*').eq('id',1).single();
          if (data) ws = data;
        } catch(e) {}
      }
      window._apm.watermarkSettings = ws;

      // Load per-pdf watermark data
      const pdfs = await apmGetPDFs();

      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">🌐 Global Watermark Settings</div>
        <div class="admin-form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Watermark Text</label>
            <input class="form-input" id="apmWmText" value="${ws.text||'Studyria.com — Licensed Copy'}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Position</label>
            <select class="form-input" id="apmWmPosition">
              <option value="diagonal" ${ws.position==='diagonal'?'selected':''}>Diagonal (Across Page)</option>
              <option value="center" ${ws.position==='center'?'selected':''}>Center</option>
              <option value="header" ${ws.position==='header'?'selected':''}>Header</option>
              <option value="footer" ${ws.position==='footer'?'selected':''}>Footer</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Opacity: <span id="apmWmOpacityVal">${ws.opacity||18}</span>%</label>
          <input type="range" min="5" max="60" value="${ws.opacity||18}" style="width:100%;accent-color:var(--accent)" oninput="document.getElementById('apmWmOpacityVal').textContent=this.value" id="apmWmOpacity"/>
        </div>
        <div class="apm-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Apply watermark to all downloads</div><div class="text-muted text-xs">Every PDF download gets watermarked</div></div>
          <button class="admin-toggle ${ws.apply_to_all?'on':''}" id="apmWmApplyAll" onclick="this.classList.toggle('on')"></button>
        </div>
        <div class="apm-toggle-row">
          <div><div style="font-size:.85rem;font-weight:600">Use buyer's email as watermark</div><div class="text-muted text-xs">Replaces static text with the user's email</div></div>
          <button class="admin-toggle ${ws.use_user_email?'on':''}" id="apmWmEmail" onclick="this.classList.toggle('on')"></button>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="apmSaveWatermark()">💾 Save Global Watermark</button>
      </div>

      <div class="apm-card">
        <div class="apm-card-title">📄 Per-PDF Watermark Overrides</div>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:12px">Override the global watermark for individual PDFs.</div>
        <div id="apmPerPdfWm">
          ${pdfs.slice(0,20).map(p=>`
          <div class="apm-row" style="gap:14px">
            <div style="flex:1;min-width:0;font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</div>
            <input class="form-input" style="width:200px;flex-shrink:0" placeholder="Custom watermark text (blank=global)" id="apmPdfWm_${p.id}" value="${p.watermark_text||''}"/>
            <button class="btn btn-ghost btn-sm" onclick="apmSavePdfWatermark('${p.id}')">💾</button>
          </div>`).join('')}
        </div>
      </div>`;
      break;
    }

    // ── 7. SEO SETTINGS ────────────────────────────────────────────
    case 'seo': {
      const pdfs = await apmGetPDFs();
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">🔍 PDF SEO Settings</div>
        <div class="form-group" style="margin-bottom:14px">
          <label class="form-label">Select PDF to Edit SEO</label>
          <select class="form-input" id="apmSeoPdfId" onchange="apmLoadSEO(this.value)">
            <option value="">— Choose a PDF —</option>
            ${pdfs.map(p=>`<option value="${p.id}">${p.title}</option>`).join('')}
          </select>
        </div>
        <div id="apmSeoForm" style="display:none">
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">SEO Title <span style="font-size:.72rem;color:var(--text2)" id="apmSeoTitleCount">(0/60)</span></label>
            <input class="form-input" id="apmSeoTitle" placeholder="Optimized title for search engines" maxlength="60" oninput="document.getElementById('apmSeoTitleCount').textContent='('+this.value.length+'/60)'"/>
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">SEO Description <span style="font-size:.72rem;color:var(--text2)" id="apmSeoDescCount">(0/160)</span></label>
            <textarea class="form-input" id="apmSeoDesc" rows="3" placeholder="Meta description for Google search results (150-160 chars)" maxlength="160" oninput="document.getElementById('apmSeoDescCount').textContent='('+this.value.length+'/160)'"></textarea>
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">SEO Keywords <span style="font-size:.72rem;color:var(--text2)">(comma-separated)</span></label>
            <input class="form-input" id="apmSeoKeywords" placeholder="JEE notes, physics formulas, NEET preparation"/>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">OG Image URL <span style="font-size:.72rem;color:var(--text2)">(Social share image)</span></label>
            <input class="form-input" id="apmSeoOgImage" placeholder="https://..."/>
          </div>
          <div id="apmSeoPreview" style="margin-bottom:14px"></div>
          <button class="btn btn-primary btn-sm" onclick="apmSaveSEO()">💾 Save SEO Settings</button>
        </div>
      </div>`;
      break;
    }

    // ── 8. ANALYTICS ───────────────────────────────────────────────
    case 'analytics': {
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">📊 PDF Analytics <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="apmLoadAnalytics()">🔄 Refresh</button></div>
        <div id="apmAnalyticsList"><div class="apm-empty">Loading analytics…</div></div>
      </div>`;
      apmLoadAnalytics();
      break;
    }

    // ── 9. DOWNLOADS TRACKER ───────────────────────────────────────
    case 'downloads': {
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">📥 Downloads Tracker <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="apmLoadDownloads()">🔄 Refresh</button></div>
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="apmExportDownloadsCSV()">📤 Export CSV</button>
        </div>
        <div id="apmDownloadsList"><div class="apm-empty">Loading downloads…</div></div>
      </div>`;
      apmLoadDownloads();
      break;
    }

    // ── 10. PERFORMANCE SCORE ──────────────────────────────────────
    case 'performance': {
      container.innerHTML = `
      <div class="apm-card">
        <div class="apm-card-title">🏅 Performance Score <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="apmLoadPerformance()">🔄 Refresh</button></div>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:14px">Score = (views×1 + downloads×3 + purchases×5 + avg_rating×10) / max × 100</div>
        <div id="apmPerfList"><div class="apm-empty">Loading performance data…</div></div>
      </div>`;
      apmLoadPerformance();
      break;
    }
  }
}

// ── BULK UPLOAD ──────────────────────────────────────────────────
function apmHandleBulkDrop(files) {
  const arr = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
  arr.forEach(f => {
    if (!window._apm.bulkQueue.find(q => q.file.name === f.name && q.file.size === f.size)) {
      window._apm.bulkQueue.push({ file: f, title: f.name.replace('.pdf','').replace(/[_-]/g,' '), status: 'pending', progress: 0, error: null, url: null });
    }
  });
  apmRenderQueue();
}

function apmRenderQueue() {
  const el = document.getElementById('apmQueueList');
  if (!el) return;
  const q = window._apm.bulkQueue;
  if (!q.length) { el.innerHTML = ''; return; }
  el.innerHTML = q.map((item, i) => `
    <div class="apm-queue-item" id="apmQItem_${i}">
      <div style="width:36px;height:36px;background:var(--glass);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0">📄</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
          <div class="apm-queue-name">${item.file.name}</div>
          <span class="apm-status-badge apm-badge-${item.status}">${item.status}</span>
        </div>
        <input class="form-input" style="font-size:.78rem;height:28px;padding:4px 8px;margin-bottom:4px" value="${item.title}" placeholder="PDF title" oninput="window._apm.bulkQueue[${i}].title=this.value"/>
        <div style="font-size:.72rem;color:var(--text2)">${(item.file.size/1048576).toFixed(1)} MB</div>
        ${item.status === 'uploading' ? `<div class="apm-progress-wrap"><div class="apm-progress-bar" id="apmPBar_${i}" style="width:${item.progress}%"></div></div>` : ''}
        ${item.error ? `<div style="font-size:.72rem;color:var(--danger);margin-top:3px">⚠ ${item.error}</div>` : ''}
        ${item.url ? `<div style="font-size:.72rem;color:var(--success);margin-top:3px">✅ Uploaded</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="window._apm.bulkQueue.splice(${i},1);apmRenderQueue()" style="flex-shrink:0">🗑</button>
    </div>`).join('');
}

function apmClearQueue() {
  window._apm.bulkQueue = [];
  apmRenderQueue();
}

async function apmStartBulkUpload(asDraft=false) {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const q = window._apm.bulkQueue.filter(i => i.status !== 'done');
  if (!q.length) { showToast('No files to upload.', 'info'); return; }

  const statusEl = document.getElementById('apmBulkStatus');
  let done = 0;

  for (let i = 0; i < window._apm.bulkQueue.length; i++) {
    const item = window._apm.bulkQueue[i];
    if (item.status === 'done') continue;

    item.status = 'uploading'; item.progress = 10;
    apmRenderQueue();

    try {
      // Upload to Supabase storage
      const fname = `${Date.now()}_${item.title.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'').slice(0,40)}.pdf`;
      const { error: upErr } = await sb.storage.from('pdfs').upload(fname, item.file, { upsert: true, contentType: 'application/pdf' });
      if (upErr) throw new Error(upErr.message);

      // Store the bare storage path — pdfs bucket is PRIVATE so getPublicUrl produces
      // a non-functional URL. Signed URLs are generated at read-time via createSignedUrl.
      item.url = fname;
      item.progress = 70;
      apmRenderQueue();

      // Insert into pdfs
      const payload = {
        title: item.title,
        pdf_url: item.url,
        status: asDraft ? 'draft' : 'published',
        free: true,
        price: 0,
        created_at: new Date().toISOString(),
      };

      const { error: insErr, data: insData } = await sb.from('pdfs').insert(payload).select('id,title,category,cover_url,pdf_url').maybeSingle().catch(() => sb.from('pdfs').insert(payload));
      if (insErr) throw new Error(insErr.message);

      // Notify subscribers when publishing immediately (not draft)
      if (!asDraft && typeof window.notifyPdfSubscribers === 'function') {
        const pdfRow = insData || payload;
        window.notifyPdfSubscribers({
          pdfId:    pdfRow.id   || null,
          title:    pdfRow.title,
          category: pdfRow.category || null,
          coverUrl: pdfRow.cover_url || null,
          pdfUrl:   pdfRow.pdf_url  || null,
        }).catch(e => console.warn('[Notify] upload notify error:', e));
      }

      // Log in upload_queue
      await sb.from('upload_queue').insert({ filename: item.file.name, status: asDraft ? 'draft' : 'published', pdf_url: item.url, metadata: { title: item.title }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).catch(()=>{});

      item.status = 'done'; item.progress = 100; done++;
    } catch(e) {
      item.status = 'error'; item.error = e.message;

      // Log failed in upload_queue
      if (sb) await sb.from('upload_queue').insert({ filename: item.file.name, status: 'error', error: e.message, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).catch(()=>{});
    }
    apmRenderQueue();
    if (statusEl) statusEl.textContent = `Processed ${Math.min(done, q.length)} / ${q.length} files`;
  }

  showToast(`✅ Bulk upload complete! ${done} PDFs ${asDraft?'saved as drafts':'published'}.`, 'success');
  logAdminActivity(`Bulk uploaded ${done} PDFs${asDraft?' as drafts':''}`, 'green');
  apmLoadQueueHistory();
}

async function apmLoadQueueHistory() {
  const el = document.getElementById('apmQueueHistory');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data } = await sb.from('upload_queue').select('*').order('created_at', { ascending: false }).limit(30);
    if (!data || !data.length) { el.innerHTML = '<div class="apm-empty">No upload history yet.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Filename</th><th>Status</th><th>Date</th><th>Error</th></tr></thead>
      <tbody>
        ${data.map(r=>`<tr>
          <td style="font-size:.82rem;font-weight:600">${r.filename||'—'}</td>
          <td><span class="apm-status-badge apm-badge-${r.status||'pending'}">${r.status||'pending'}</span></td>
          <td style="font-size:.78rem;color:var(--text2)">${r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—'}</td>
          <td style="font-size:.75rem;color:var(--danger)">${r.error||''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

// ── DRAFTS ───────────────────────────────────────────────────────
async function apmLoadDrafts() {
  const el = document.getElementById('apmDraftsList');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data } = await sb.from('pdfs').select('id,title,status,created_at,category').eq('status','draft').order('created_at', { ascending: false }).limit(50);
    if (!data || !data.length) { el.innerHTML = '<div class="apm-empty">No drafts found. All PDFs are published.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${data.map(p=>`<tr>
          <td style="font-weight:600;font-size:.83rem">${p.title||'Untitled'}</td>
          <td style="font-size:.78rem;color:var(--text2)">${p.category||'—'}</td>
          <td><span class="apm-status-badge apm-badge-draft">draft</span></td>
          <td style="font-size:.75rem;color:var(--text2)">${p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '—'}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-success btn-sm" onclick="apmPublishDraft('${p.id}')">✅ Publish</button>
            <button class="btn btn-danger btn-sm" onclick="apmDeletePDF('${p.id}')">🗑 Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

async function apmPublishDraft(id) {
  const sb = window.supabaseClient;
  if (!sb) return;
  const { data: pdfData, error: fetchErr } = await sb.from('pdfs').select('id,title,category,cover_url,pdf_url').eq('id', id).maybeSingle();
  const { error } = await sb.from('pdfs').update({ status: 'published' }).eq('id', id);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('✅ Draft published!', 'success');
  logAdminActivity(`Published draft PDF id:${id}`, 'green');
  // Notify subscribers about the new PDF
  if (!fetchErr && pdfData && typeof window.notifyPdfSubscribers === 'function') {
    window.notifyPdfSubscribers({
      pdfId:    pdfData.id,
      title:    pdfData.title,
      category: pdfData.category,
      coverUrl: pdfData.cover_url,
      pdfUrl:   pdfData.pdf_url,
    }).catch(e => console.warn('[Notify] apmPublishDraft notify error:', e));
  }
  apmLoadDrafts();
}

async function apmPublishAllDrafts() {
  const sb = window.supabaseClient;
  if (!sb) return;
  if (!confirm('Publish all drafts?')) return;
  // Fetch draft PDFs before publishing for notification data
  const { data: draftPdfs } = await sb.from('pdfs').select('id,title,category,cover_url,pdf_url').eq('status','draft');
  const { error } = await sb.from('pdfs').update({ status: 'published' }).eq('status','draft');
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('✅ All drafts published!', 'success');
  // Notify subscribers for each newly published PDF
  if (draftPdfs?.length && typeof window.notifyPdfSubscribers === 'function') {
    // Send a single batch notification for all published PDFs
    const first = draftPdfs[0];
    window.notifyPdfSubscribers({
      pdfId:    first.id,
      title:    draftPdfs.length === 1 ? first.title : `${draftPdfs.length} new PDFs added on Studyria!`,
      category: first.category,
      coverUrl: first.cover_url,
      pdfUrl:   first.pdf_url,
    }).catch(e => console.warn('[Notify] apmPublishAllDrafts notify error:', e));
  }
  apmLoadDrafts();
}

async function apmDeletePDF(id) {
  if (!confirm('Permanently delete this PDF?')) return;
  const sb = window.supabaseClient;
  const { error } = await sb.from('pdfs').delete().eq('id', id);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('PDF deleted.', 'info');
  apmLoadDrafts();
}

// ── SCHEDULED PUBLISHING ─────────────────────────────────────────
async function apmSchedulePDF() {
  const sb = window.supabaseClient;
  const id = document.getElementById('apmSchedPdfId')?.value;
  const dt = document.getElementById('apmSchedDate')?.value;
  if (!id || !dt) { showToast('Select a PDF and date.', 'error'); return; }
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const isoDate = new Date(dt).toISOString();
  const { error } = await sb.from('pdfs').update({ status: 'scheduled', schedule_publish_at: isoDate }).eq('id', id);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('✅ PDF scheduled!', 'success');
  logAdminActivity(`Scheduled PDF id:${id} for ${dt}`, 'blue');
  apmLoadScheduled();
}

async function apmLoadScheduled() {
  const el = document.getElementById('apmScheduledList');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data } = await sb.from('pdfs').select('id,title,status,schedule_publish_at,category').eq('status','scheduled').order('schedule_publish_at');
    if (!data || !data.length) { el.innerHTML = '<div class="apm-empty">No scheduled PDFs.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Title</th><th>Scheduled For</th><th>Time Left</th><th>Actions</th></tr></thead>
      <tbody>
        ${data.map(p=>{
          const ts = p.schedule_publish_at ? new Date(p.schedule_publish_at) : null;
          const diff = ts ? ts - Date.now() : 0;
          const left = diff > 0 ? `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m` : '⚡ Due now';
          return `<tr>
            <td style="font-weight:600;font-size:.83rem">${p.title||'Untitled'}</td>
            <td style="font-size:.8rem">${ts ? ts.toLocaleString('en-IN') : '—'}</td>
            <td><span class="apm-status-badge apm-badge-scheduled">${left}</span></td>
            <td style="display:flex;gap:6px">
              <button class="btn btn-success btn-sm" onclick="apmPublishDraft('${p.id}')">✅ Publish Now</button>
              <button class="btn btn-ghost btn-sm" onclick="apmUnschedule('${p.id}')">✕ Cancel</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

async function apmUnschedule(id) {
  const sb = window.supabaseClient;
  const { error } = await sb.from('pdfs').update({ status: 'draft', schedule_publish_at: null }).eq('id', id);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('Schedule cancelled — moved to drafts.', 'info');
  apmLoadScheduled();
}

async function apmTriggerCron() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  try {
    const now = new Date().toISOString();
    const { data, error } = await sb.from('pdfs').update({ status: 'published', schedule_publish_at: null }).eq('status','scheduled').lte('schedule_publish_at', now).select('id,title');
    if (error) throw error;
    const count = data?.length || 0;
    showToast(`✅ Auto-publish ran: ${count} PDF${count===1?'':'s'} published.`, 'success');
    if (count) {
      logAdminActivity(`Auto-publish: ${count} PDFs published`, 'green');
      // Notify subscribers for auto-published PDFs
      if (typeof window.notifyPdfSubscribers === 'function' && data?.length) {
        const first = data[0];
        window.notifyPdfSubscribers({
          pdfId:    first.id,
          title:    count === 1 ? first.title : `${count} new PDFs just added on Studyria!`,
          category: first.category || null,
          coverUrl: first.cover_url || null,
          pdfUrl:   first.pdf_url   || null,
        }).catch(e => console.warn('[Notify] cron notify error:', e));
      }
    }
    apmLoadScheduled();
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

// ── VERSION MANAGER ──────────────────────────────────────────────
async function apmLoadVersions(pdfId) {
  const el = document.getElementById('apmVersionsList');
  const card = document.getElementById('apmNewVersionCard');
  if (!el) return;
  if (!pdfId) { if(card) card.style.display='none'; el.innerHTML = '<div class="apm-empty" style="padding:20px 0">Select a PDF to see its version history.</div>'; return; }
  if (card) card.style.display = '';

  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data } = await sb.from('pdf_versions').select('*').eq('pdf_id', pdfId).order('version_number', { ascending: false });
    if (!data || !data.length) { el.innerHTML = '<div class="apm-empty">No versions yet. Current file is v1. Upload a new version below.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Version</th><th>Notes</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>
        ${data.map(v=>`<tr>
          <td><span class="apm-status-badge apm-badge-published">v${v.version_number}</span></td>
          <td style="font-size:.8rem;color:var(--text2)">${v.notes||'—'}</td>
          <td style="font-size:.75rem;color:var(--text2)">${v.created_at ? new Date(v.created_at).toLocaleString('en-IN') : '—'}</td>
          <td style="display:flex;gap:6px">
            <a class="btn btn-ghost btn-sm" href="${v.pdf_url}" target="_blank">📥 Download</a>
            <button class="btn btn-secondary btn-sm" onclick="apmRestoreVersion(${pdfId}, '${v.pdf_url}', ${v.version_number})">♻️ Restore</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

async function apmUploadNewVersion() {
  const sb = window.supabaseClient;
  const pdfId = document.getElementById('apmVerPdfId')?.value;
  const file = document.getElementById('apmNewVerFile')?.files[0];
  const notes = document.getElementById('apmNewVerNotes')?.value?.trim();
  if (!pdfId) { showToast('Select a PDF first.', 'error'); return; }
  if (!file) { showToast('Choose a PDF file.', 'error'); return; }
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  try {
    // Get current version count
    const { count } = await sb.from('pdf_versions').select('id', {count:'exact', head:true}).eq('pdf_id', pdfId);
    const nextVer = (count || 0) + 2; // +1 for base, +1 for new

    // Get current pdf url to archive it
    const { data: current } = await sb.from('pdfs').select('pdf_url,cover_url,title').eq('id', pdfId).single();

    // Archive current as a version entry if no versions exist yet
    if (!count) {
      await sb.from('pdf_versions').insert({ pdf_id: pdfId, version_number: 1, pdf_url: current.pdf_url, cover_url: current.cover_url, notes: 'Original version', created_at: new Date().toISOString() });
    }

    // Upload new version
    const fname = `v${nextVer}_${Date.now()}_pdf${pdfId}.pdf`;
    const { error: upErr } = await sb.storage.from('pdfs').upload(fname, file, { upsert: true });
    if (upErr) throw new Error(upErr.message);
    // Store the bare storage path — pdfs bucket is PRIVATE, signed URLs generated at read-time.

    // Save version record
    await sb.from('pdf_versions').insert({ pdf_id: pdfId, version_number: nextVer, pdf_url: fname, notes, created_at: new Date().toISOString(), created_by: window.adminSession?.email });

    // Update live pdf_url in pdfs
    await sb.from('pdfs').update({ pdf_url: fname }).eq('id', pdfId);

    showToast(`✅ Version v${nextVer} uploaded and set as live!`, 'success');
    logAdminActivity(`PDF id:${pdfId} updated to v${nextVer}`, 'green');
    apmLoadVersions(pdfId);
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function apmRestoreVersion(pdfId, pdfUrl, versionNum) {
  if (!confirm(`Restore v${versionNum} as the live PDF? Current live version will be archived.`)) return;
  const sb = window.supabaseClient;
  const { error } = await sb.from('pdfs').update({ pdf_url: pdfUrl }).eq('id', pdfId);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast(`✅ v${versionNum} restored as live PDF!`, 'success');
  logAdminActivity(`Restored PDF id:${pdfId} to v${versionNum}`, 'blue');
}

// ── PREVIEW UPLOAD ───────────────────────────────────────────────
async function apmLoadPreviewInfo(pdfId) {
  const el = document.getElementById('apmCurrentPreviewInfo');
  if (!el || !pdfId) return;
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data } = await sb.from('pdfs').select('title,preview_pdf_url').eq('id',pdfId).single();
    if (data?.preview_pdf_url) {
      el.innerHTML = `<div style="background:rgba(16,217,142,.07);border:1px solid rgba(16,217,142,.2);border-radius:10px;padding:10px 14px;font-size:.82rem;display:flex;align-items:center;gap:10px">
        <span style="font-size:1.2rem">✅</span>
        <div><div style="font-weight:700;color:var(--success)">Preview exists</div><a href="${data.preview_pdf_url}" target="_blank" style="color:var(--accent);font-size:.78rem">View current preview →</a></div>
      </div>`;
    } else {
      el.innerHTML = `<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:10px 14px;font-size:.82rem;color:var(--gold)">⚠ No preview PDF uploaded yet.</div>`;
    }
  } catch(e) {}
}

async function apmUploadPreview() {
  const sb = window.supabaseClient;
  const pdfId = document.getElementById('apmPrevPdfId')?.value;
  const file = document.getElementById('apmPrevFile')?.files[0];
  if (!pdfId) { showToast('Select a PDF first.', 'error'); return; }
  if (!file) { showToast('Choose a preview PDF file.', 'error'); return; }
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  try {
    const fname = `preview_${pdfId}_${Date.now()}.pdf`;
    const { error: upErr } = await sb.storage.from('pdfs').upload(fname, file, { upsert: true });
    if (upErr) throw new Error(upErr.message);
    // Store the bare storage path — pdfs bucket is PRIVATE, signed URLs generated at read-time.
    const { error: dbErr } = await sb.from('pdfs').update({ preview_pdf_url: fname }).eq('id', pdfId);
    if (dbErr) throw new Error(dbErr.message);
    showToast('✅ Preview PDF uploaded!', 'success');
    logAdminActivity(`Preview PDF uploaded for id:${pdfId}`, 'green');
    apmLoadPreviewInfo(pdfId);
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

// ── WATERMARK ────────────────────────────────────────────────────
async function apmSaveWatermark() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const payload = {
    id: 1,
    text: document.getElementById('apmWmText')?.value || 'Studyria.com',
    opacity: parseInt(document.getElementById('apmWmOpacity')?.value || 18),
    position: document.getElementById('apmWmPosition')?.value || 'diagonal',
    apply_to_all: document.getElementById('apmWmApplyAll')?.classList.contains('on'),
    use_user_email: document.getElementById('apmWmEmail')?.classList.contains('on'),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('watermark_settings').upsert(payload, { onConflict: 'id' });
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  window._apm.watermarkSettings = payload;
  showToast('✅ Watermark settings saved!', 'success');
  logAdminActivity('Global watermark settings updated', 'green');
}

async function apmSavePdfWatermark(pdfId) {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const val = document.getElementById(`apmPdfWm_${pdfId}`)?.value?.trim() || null;
  const { error } = await sb.from('pdfs').update({ watermark_text: val }).eq('id', pdfId);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('✅ Per-PDF watermark saved!', 'success');
}

// ── SEO ──────────────────────────────────────────────────────────
async function apmLoadSEO(pdfId) {
  const form = document.getElementById('apmSeoForm');
  if (!form || !pdfId) return;
  const sb = window.supabaseClient;
  form.style.display = '';
  if (!sb) return;
  try {
    const { data } = await sb.from('pdfs').select('title,seo_title,seo_description,seo_keywords,og_image').eq('id', pdfId).single();
    if (data) {
      document.getElementById('apmSeoTitle').value = data.seo_title || data.title || '';
      document.getElementById('apmSeoDesc').value = data.seo_description || '';
      document.getElementById('apmSeoKeywords').value = data.seo_keywords || '';
      document.getElementById('apmSeoOgImage').value = data.og_image || '';
      document.getElementById('apmSeoTitleCount').textContent = `(${(data.seo_title||data.title||'').length}/60)`;
      document.getElementById('apmSeoDescCount').textContent = `(${(data.seo_description||'').length}/160)`;
      apmUpdateSEOPreview(data.seo_title||data.title, data.seo_description);
    }
  } catch(e) {}
}

function apmUpdateSEOPreview(title, desc) {
  const el = document.getElementById('apmSeoPreview');
  if (!el) return;
  el.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--glass-border);border-radius:12px;padding:16px;font-family:Arial,sans-serif">
    <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px">Google Search Preview</div>
    <div style="font-size:.95rem;color:#4285f4;font-weight:400;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title||'Page Title'}</div>
    <div style="font-size:.72rem;color:var(--success);margin-bottom:4px">studyria.com/pdf/...</div>
    <div style="font-size:.8rem;color:var(--text2);line-height:1.5">${desc||'Page description will appear here in Google search results...'}</div>
  </div>`;
}

async function apmSaveSEO() {
  const sb = window.supabaseClient;
  const pdfId = document.getElementById('apmSeoPdfId')?.value;
  if (!pdfId) { showToast('Select a PDF.', 'error'); return; }
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const payload = {
    seo_title: document.getElementById('apmSeoTitle')?.value?.trim() || null,
    seo_description: document.getElementById('apmSeoDesc')?.value?.trim() || null,
    seo_keywords: document.getElementById('apmSeoKeywords')?.value?.trim() || null,
    og_image: document.getElementById('apmSeoOgImage')?.value?.trim() || null,
  };
  const { error } = await sb.from('pdfs').update(payload).eq('id', pdfId);
  if (error) { showToast('Error: '+error.message, 'error'); return; }
  showToast('✅ SEO settings saved!', 'success');
  logAdminActivity(`SEO updated for PDF id:${pdfId}`, 'green');
  apmUpdateSEOPreview(payload.seo_title, payload.seo_description);
}

// ── ANALYTICS ────────────────────────────────────────────────────
async function apmLoadAnalytics() {
  const el = document.getElementById('apmAnalyticsList');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    // Join pdf_analytics with pdfs
    const { data: analytics } = await sb.from('pdf_analytics').select('*, pdfs(title)').order('views', { ascending: false }).limit(30);
    // Also count from purchases and downloads tables
    const { data: pdfs } = await sb.from('pdfs').select('id,title,download_count,view_count').order('download_count', { ascending: false }).limit(30);

    if (!pdfs || !pdfs.length) { el.innerHTML = '<div class="apm-empty">No PDF data found.</div>'; return; }

    const analyticsMap = {};
    (analytics||[]).forEach(a => { analyticsMap[a.pdf_id] = a; });

    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>PDF</th><th>Views</th><th>Downloads</th><th>Purchases</th><th>Conversion</th><th>Actions</th></tr></thead>
      <tbody>
        ${pdfs.map(p => {
          const a = analyticsMap[p.id] || {};
          const views = a.views || p.view_count || 0;
          const downloads = a.downloads || p.download_count || 0;
          const purchases = a.purchases || 0;
          const conv = views > 0 ? ((purchases/views)*100).toFixed(1)+'%' : '0%';
          return `<tr>
            <td style="font-weight:600;font-size:.82rem;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</td>
            <td>${views.toLocaleString()}</td>
            <td>${downloads.toLocaleString()}</td>
            <td><span class="admin-badge admin-badge-success">${purchases.toLocaleString()}</span></td>
            <td style="font-weight:700;color:${parseFloat(conv)>5?'var(--success)':'var(--text2)'}">${conv}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="apmIncrementView('${p.id}')">👁 +View</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

async function apmIncrementView(pdfId) {
  const sb = window.supabaseClient;
  if (!sb) return;
  // Upsert analytics row
  const { data: existing } = await sb.from('pdf_analytics').select('id,views').eq('pdf_id', pdfId).single().catch(()=>({data:null}));
  if (existing) {
    await sb.from('pdf_analytics').update({ views: (existing.views||0)+1, updated_at: new Date().toISOString() }).eq('id', existing.id);
  } else {
    await sb.from('pdf_analytics').insert({ pdf_id: pdfId, views: 1, clicks: 0, purchases: 0, downloads: 0 });
  }
  showToast('View logged.', 'success');
  apmLoadAnalytics();
}

// ── DOWNLOADS TRACKER ────────────────────────────────────────────
async function apmLoadDownloads() {
  const el = document.getElementById('apmDownloadsList');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data } = await sb.from('downloads').select('*, pdfs(title)').order('created_at', { ascending: false }).limit(50);
    if (!data || !data.length) { el.innerHTML = '<div class="apm-empty">No downloads logged yet. Downloads are recorded when users download a PDF.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>PDF</th><th>User</th><th>IP</th><th>Date</th></tr></thead>
      <tbody>
        ${data.map(d=>`<tr>
          <td style="font-weight:600;font-size:.82rem">${d.pdfs?.title||'PDF #'+d.pdf_id}</td>
          <td style="font-size:.78rem;color:var(--text2)">${d.user_email||d.user_id||'Anonymous'}</td>
          <td style="font-size:.75rem;color:var(--text3);font-family:monospace">${d.ip||'—'}</td>
          <td style="font-size:.75rem;color:var(--text2)">${d.created_at ? new Date(d.created_at).toLocaleString('en-IN') : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

function apmExportDownloadsCSV() {
  const table = document.querySelector('#apmDownloadsList table');
  if (!table) { showToast('Load downloads data first.', 'info'); return; }
  const rows = [...table.querySelectorAll('tr')].map(r => [...r.querySelectorAll('th,td')].map(c => `"${c.textContent.trim()}"`).join(','));
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `downloads_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('✅ CSV exported!', 'success');
}

// ── PERFORMANCE SCORE ────────────────────────────────────────────
async function apmLoadPerformance() {
  const el = document.getElementById('apmPerfList');
  if (!el) return;
  const sb = window.supabaseClient;
  if (!sb) { el.innerHTML = '<div class="apm-empty">Supabase not connected.</div>'; return; }
  try {
    const { data: pdfs } = await sb.from('pdfs').select('id,title,download_count,view_count').eq('status', 'published').order('download_count', { ascending: false }).limit(20);
    const { data: analytics } = await sb.from('pdf_analytics').select('pdf_id,views,downloads,purchases').limit(100);
    const { data: reviews } = await sb.from('pdf_reviews').select('pdf_id,rating').limit(500).catch(()=>({data:[]}));

    const analyticsMap = {};
    (analytics||[]).forEach(a => { analyticsMap[a.pdf_id] = a; });
    const ratingsMap = {};
    (reviews||[]).forEach(r => {
      if (!ratingsMap[r.pdf_id]) ratingsMap[r.pdf_id] = [];
      ratingsMap[r.pdf_id].push(Number(r.rating)||0);
    });

    const scored = (pdfs||[]).map(p => {
      const a = analyticsMap[p.id] || {};
      const views = (a.views || p.view_count || 0);
      const downloads = (a.downloads || p.download_count || 0);
      const purchases = a.purchases || 0;
      const ratings = ratingsMap[p.id] || [];
      const avgRating = ratings.length ? ratings.reduce((s,r)=>s+r,0)/ratings.length : 0;
      const score = Math.min(100, Math.round((views*0.5 + downloads*2 + purchases*5 + avgRating*8) / 1));
      const norm = Math.min(100, score);
      return { ...p, score: norm, views, downloads, purchases, avgRating };
    }).sort((a,b) => b.score - a.score);

    const maxScore = scored[0]?.score || 1;

    el.innerHTML = scored.map(p => {
      const norm = Math.round((p.score/Math.max(maxScore,100))*100);
      const color = norm >= 70 ? 'var(--success)' : norm >= 40 ? 'var(--gold)' : 'var(--danger)';
      return `
      <div class="apm-row" style="gap:14px;padding:14px 0">
        <div class="apm-perf-ring" style="color:${color};border-color:${color}">${norm}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</div>
          <div style="display:flex;gap:14px;font-size:.75rem;color:var(--text2);flex-wrap:wrap">
            <span>👁 ${p.views.toLocaleString()} views</span>
            <span>📥 ${p.downloads.toLocaleString()} downloads</span>
            <span>🛒 ${p.purchases.toLocaleString()} purchases</span>
            <span>⭐ ${p.avgRating ? p.avgRating.toFixed(1) : '—'}</span>
          </div>
          <div style="height:5px;background:var(--glass);border-radius:3px;margin-top:8px;overflow:hidden">
            <div style="height:100%;width:${norm}%;background:${color};border-radius:3px;transition:width .6s ease"></div>
          </div>
        </div>
        <div style="font-size:.72rem;font-weight:700;color:${color};flex-shrink:0">${norm}/100</div>
      </div>`;
    }).join('') || '<div class="apm-empty">No published PDFs found.</div>';
  } catch(e) { el.innerHTML = `<div class="apm-empty" style="color:var(--danger)">${e.message}</div>`; }
}

// ── Helper: get PDFs list ────────────────────────────────────────
async function apmGetPDFs() {
  if (window._apm.pdfList.length) return window._apm.pdfList;
  const sb = window.supabaseClient;
  if (!sb) return [];
  try {
    const { data } = await sb.from('pdfs').select('id,title,status,category,pdf_url,cover_url,watermark_text').order('created_at', { ascending: false }).limit(200);
    window._apm.pdfList = data || [];
    return window._apm.pdfList;
  } catch(e) { return []; }
}

/* ─── 2. ADVANCED CATEGORY MANAGER ──────────────────────────── */
function renderPCCCategoryManager(main) {
  main.innerHTML = `<div class="admin-section-title">📂 Advanced Category Manager</div>
  <div class="admin-section-sub">Create, reorder, style and manage your content categories — fully synced with Supabase.</div>
  <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
    <button class="btn btn-primary btn-sm" onclick="pccmOpenForm(null)">➕ Create Category</button>
    <input class="form-input" id="pccmSearch" placeholder="🔎 Search categories…" style="max-width:240px" oninput="pccmRenderTable()"/>
    <span id="pccmCount" style="font-size:.75rem;color:var(--text2);margin-left:auto"></span>
  </div>
  <div id="pccmFormWrap"></div>
  <div class="admin-table-card">
    <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">All Categories</div><div style="font-size:.7rem;color:var(--text2)">Drag rows to reorder</div></div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th></th><th>Name</th><th>Icon</th><th>Color</th><th>PDFs</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="pccmTableBody"><tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text2)">Loading categories…</td></tr></tbody>
    </table></div>
  </div>`;
  pccmLoad();
}

/* ── Category Manager: state + data ─────────────────────────────── */
window._pccm = { categories: [], counts: {}, subcats: {}, editingId: null, dragId: null, bannerFile: null, thumbFile: null };

async function pccmLoad() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  try {
    const [{ data: cats, error: cErr }, { data: pdfRows }, { data: subRows }] = await Promise.all([
      sb.from('categories').select('*').order('sort_order', { ascending: true }).order('name'),
      sb.from('pdfs').select('category_id'),
      sb.from('subcategories').select('*').order('sort_order'),
    ]);
    if (cErr) throw cErr;
    window._pccm.categories = cats || [];
    const counts = {};
    (pdfRows || []).forEach(p => { if (p.category_id != null) counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
    window._pccm.counts = counts;
    const subMap = {};
    (subRows || []).forEach(s => { (subMap[s.category_id] = subMap[s.category_id] || []).push(s); });
    window._pccm.subcats = subMap;
    pccmRenderTable();
  } catch (e) {
    const tb = document.getElementById('pccmTableBody');
    if (tb) tb.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--danger)">${e.message}</td></tr>`;
  }
}

function pccmRenderTable() {
  const q = (document.getElementById('pccmSearch')?.value || '').toLowerCase();
  const tb = document.getElementById('pccmTableBody');
  const countEl = document.getElementById('pccmCount');
  if (!tb) return;
  const rows = window._pccm.categories.filter(c => !q || c.name.toLowerCase().includes(q));
  if (countEl) countEl.textContent = `${rows.length} of ${window._pccm.categories.length} categories`;
  tb.innerHTML = rows.map(c => {
    const pdfCount = window._pccm.counts[c.id] || 0;
    const subCount = (window._pccm.subcats[c.id] || []).length;
    const enabled = c.enabled !== false;
    return `<tr draggable="true" data-cat-id="${c.id}" ondragstart="pccmDragStart(event,${c.id})" ondragover="event.preventDefault()" ondrop="pccmDrop(event,${c.id})" style="${enabled ? '' : 'opacity:.5'}">
      <td style="cursor:grab;color:var(--text2)">⠿</td>
      <td style="font-weight:600">${c.name}${c.featured ? ' <span class="admin-nav-badge" style="background:rgba(61,142,248,.12);color:#3d8ef8;border-color:rgba(61,142,248,.2);margin-left:6px">★ Featured</span>' : ''}${subCount ? ` <span style="font-size:.68rem;color:var(--text2)">(${subCount} subcats)</span>` : ''}</td>
      <td style="font-size:1.1rem">${c.icon || '📘'}</td>
      <td><span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${c.color || '#3d8ef8'};border:1px solid rgba(255,255,255,.15)"></span></td>
      <td>${pdfCount}</td>
      <td><span class="admin-nav-badge" style="background:${enabled ? 'rgba(16,217,142,.12)' : 'rgba(255,255,255,.08)'};color:${enabled ? 'var(--success)' : 'var(--text2)'};border-color:${enabled ? 'rgba(16,217,142,.2)' : 'rgba(255,255,255,.1)'}">${enabled ? 'Active' : 'Hidden'}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="pccmOpenForm(${c.id})">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="pccmToggleEnabled(${c.id})">${enabled ? '🙈 Hide' : '👁 Show'}</button>
        <button class="btn btn-ghost btn-sm" onclick="pccmOpenSubcats(${c.id})">📁 Subcats</button>
        <button class="btn btn-danger btn-sm" onclick="pccmDelete(${c.id})">🗑</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text2)">No categories match.</td></tr>`;
}

/* ── Drag & drop reorder ──────────────────────────────────────────── */
function pccmDragStart(e, id) { window._pccm.dragId = id; e.dataTransfer.effectAllowed = 'move'; }
async function pccmDrop(e, targetId) {
  e.preventDefault();
  const dragId = window._pccm.dragId;
  if (dragId == null || dragId === targetId) return;
  const cats = window._pccm.categories;
  const fromIdx = cats.findIndex(c => c.id === dragId);
  const toIdx = cats.findIndex(c => c.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = cats.splice(fromIdx, 1);
  cats.splice(toIdx, 0, moved);
  pccmRenderTable();
  const sb = window.supabaseClient;
  try {
    await Promise.all(cats.map((c, i) => sb.from('categories').update({ sort_order: i }).eq('id', c.id)));
    cats.forEach((c, i) => { c.sort_order = i; });
    showToast('Order saved ✅', 'success');
  } catch (err) { showToast('Reorder failed: ' + err.message, 'error'); }
}

/* ── Create / Edit form ───────────────────────────────────────────── */
function pccmOpenForm(id) {
  window._pccm.editingId = id;
  window._pccm.bannerFile = null;
  window._pccm.thumbFile = null;
  const c = id ? window._pccm.categories.find(x => x.id === id) : null;
  const wrap = document.getElementById('pccmFormWrap');
  wrap.innerHTML = `<div class="mod-form-wrap" style="margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:14px">🎨 ${c ? 'Edit' : 'Create'} Category</div>
    <div class="admin-form-grid">
      <div class="form-group"><label class="form-label">Category Name</label><input class="form-input" id="pccmName" value="${c ? c.name.replace(/"/g, '&quot;') : ''}" placeholder="e.g. Engineering"/></div>
      <div class="form-group"><label class="form-label">Slug</label><input class="form-input" id="pccmSlug" value="${c ? c.slug : ''}" placeholder="engineering"/></div>
      <div class="form-group"><label class="form-label">Icon Emoji</label><input class="form-input" id="pccmIcon" value="${c ? (c.icon || '') : '📘'}" maxlength="4"/></div>
      <div class="form-group"><label class="form-label">Accent Color</label><input class="form-input" id="pccmColor" type="color" value="${c && c.color && c.color.startsWith('#') ? c.color : '#3d8ef8'}"/></div>
    </div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Description</label><textarea class="form-input" id="pccmDesc" rows="2" placeholder="Best engineering study materials…">${c ? (c.description || '') : ''}</textarea></div>
    <div class="admin-form-grid" style="margin-top:8px">
      <div class="form-group"><label class="form-label">Banner Image ${c && c.banner_url ? '<span style="color:var(--success)">✓ uploaded</span>' : ''}</label><input class="form-input" type="file" accept="image/*" onchange="window._pccm.bannerFile=this.files[0]"/></div>
      <div class="form-group"><label class="form-label">Thumbnail Image ${c && c.thumbnail_url ? '<span style="color:var(--success)">✓ uploaded</span>' : ''}</label><input class="form-input" type="file" accept="image/*" onchange="window._pccm.thumbFile=this.files[0]"/></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.8rem;cursor:pointer">
      <input type="checkbox" id="pccmFeatured" ${c && c.featured ? 'checked' : ''}/> Show in homepage Featured Categories row
    </label>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-primary btn-sm" onclick="pccmSave()">💾 Save Category</button>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('pccmFormWrap').innerHTML=''">Cancel</button>
    </div>
  </div>`;
  document.getElementById('pccmName').addEventListener('input', function() {
    if (!c) document.getElementById('pccmSlug').value = this.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  });
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function pccmSave() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }
  const name = document.getElementById('pccmName').value.trim();
  const slug = document.getElementById('pccmSlug').value.trim().toLowerCase();
  if (!name || !slug) { showToast('Name and slug are required.', 'error'); return; }
  const id = window._pccm.editingId;
  const dup = window._pccm.categories.find(x => x.slug === slug && x.id !== id);
  if (dup) { showToast('That slug is already used by "' + dup.name + '".', 'error'); return; }
  const payload = {
    name, slug,
    icon: document.getElementById('pccmIcon').value.trim() || '📘',
    color: document.getElementById('pccmColor').value,
    description: document.getElementById('pccmDesc').value.trim(),
    featured: document.getElementById('pccmFeatured').checked,
  };
  try {
    if (window._pccm.bannerFile) {
      const f = window._pccm.bannerFile;
      const path = `category-banners/${slug}-${Date.now()}.${(f.name.split('.').pop() || 'jpg')}`;
      const { error: upErr } = await sb.storage.from('covers').upload(path, f, { upsert: true, contentType: f.type });
      if (upErr) throw upErr;
      payload.banner_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
    }
    if (window._pccm.thumbFile) {
      const f = window._pccm.thumbFile;
      const path = `category-thumbs/${slug}-${Date.now()}.${(f.name.split('.').pop() || 'jpg')}`;
      const { error: upErr } = await sb.storage.from('covers').upload(path, f, { upsert: true, contentType: f.type });
      if (upErr) throw upErr;
      payload.thumbnail_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
    }
    if (id) {
      const { error } = await sb.from('categories').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      payload.sort_order = window._pccm.categories.length;
      const { error } = await sb.from('categories').insert(payload);
      if (error) throw error;
    }
    showToast('Category saved ✅', 'success');
    document.getElementById('pccmFormWrap').innerHTML = '';
    await pccmLoad();
  } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
}

async function pccmToggleEnabled(id) {
  const sb = window.supabaseClient;
  const c = window._pccm.categories.find(x => x.id === id);
  if (!c || !sb) return;
  const newVal = !(c.enabled !== false);
  try {
    const { error } = await sb.from('categories').update({ enabled: newVal }).eq('id', id);
    if (error) throw error;
    c.enabled = newVal;
    pccmRenderTable();
  } catch (e) { showToast('Update failed: ' + e.message, 'error'); }
}

async function pccmDelete(id) {
  const c = window._pccm.categories.find(x => x.id === id);
  if (!c) return;
  const count = window._pccm.counts[id] || 0;
  if (count > 0) { showToast(`Can't delete "${c.name}" — ${count} PDF(s) still use it. Move them to another category first.`, 'error'); return; }
  if (!confirm(`Delete category "${c.name}"? This cannot be undone.`)) return;
  const sb = window.supabaseClient;
  try {
    await sb.from('subcategories').delete().eq('category_id', id);
    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) throw error;
    showToast('Category deleted.', 'success');
    await pccmLoad();
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

/* ── Subcategory management ───────────────────────────────────────── */
function pccmOpenSubcats(catId) {
  const c = window._pccm.categories.find(x => x.id === catId);
  const subs = window._pccm.subcats[catId] || [];
  const wrap = document.getElementById('pccmFormWrap');
  wrap.innerHTML = `<div class="mod-form-wrap" style="margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:14px">📁 Subcategories — ${c ? c.name : ''}</div>
    <div id="pccmSubList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      ${subs.map(s => `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px">
        <span style="flex:1;font-size:.82rem">${s.name}</span>
        <button class="btn btn-danger btn-sm" onclick="pccmDeleteSubcat(${s.id},${catId})">🗑</button>
      </div>`).join('') || '<div style="font-size:.78rem;color:var(--text2)">No subcategories yet.</div>'}
    </div>
    <div style="display:flex;gap:8px">
      <input class="form-input" id="pccmNewSubName" placeholder="New subcategory name…" style="flex:1"/>
      <button class="btn btn-primary btn-sm" onclick="pccmAddSubcat(${catId})">➕ Add</button>
    </div>
    <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="document.getElementById('pccmFormWrap').innerHTML=''">Close</button>
  </div>`;
}

async function pccmAddSubcat(catId) {
  const input = document.getElementById('pccmNewSubName');
  const name = input.value.trim();
  if (!name) return;
  const sb = window.supabaseClient;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    const sortOrder = (window._pccm.subcats[catId] || []).length + 1;
    const { data, error } = await sb.from('subcategories').insert({ category_id: catId, name, slug, sort_order: sortOrder }).select().single();
    if (error) throw error;
    window._pccm.subcats[catId] = [...(window._pccm.subcats[catId] || []), data];
    pccmOpenSubcats(catId);
    pccmRenderTable();
  } catch (e) { showToast('Add failed: ' + e.message, 'error'); }
}

async function pccmDeleteSubcat(id, catId) {
  const sb = window.supabaseClient;
  try {
    const { error } = await sb.from('subcategories').delete().eq('id', id);
    if (error) throw error;
    window._pccm.subcats[catId] = (window._pccm.subcats[catId] || []).filter(s => s.id !== id);
    pccmOpenSubcats(catId);
    pccmRenderTable();
  } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
}

/* ─── 3. HOMEPAGE MANAGER ────────────────────────────────────── */

// ── Homepage Manager State ────────────────────────────────────
window._hm = {
  activeSection: 'hero',
  settings: {},
  pdfs: [],
  testimonials: [],
  loaded: false,
};

// ── DB helpers ────────────────────────────────────────────────
async function hmLoadSettings() {
  const hm = window._hm;
  if (!window.supabaseClient) return;
  try {
    // Load homepage_settings
    const { data: sRows } = await window.supabaseClient.from('homepage_settings').select('*');
    if (sRows) sRows.forEach(r => { hm.settings[r.key] = r.value; });
    // Load testimonials
    const { data: tRows } = await window.supabaseClient.from('homepage_sections')
      .select('*').eq('section_type', 'testimonial').order('sort_order');
    if (tRows) hm.testimonials = tRows;
    // Load PDFs for selection
    const { data: pRows } = await window.supabaseClient.from('pdfs').select('id,title,category,tag').order('created_at',{ascending:false}).limit(200);
    if (pRows) hm.pdfs = pRows;
  } catch(e) { console.warn('hmLoadSettings:', e); }
}

async function hmSave(key, value) {
  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return false; }
  try {
    const { error } = await window.supabaseClient.from('homepage_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    window._hm.settings[key] = value;
    return true;
  } catch(e) { showToast('Save failed: ' + e.message, 'error'); return false; }
}

async function hmSaveSection(sectionType, data) {
  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return false; }
  try {
    const { error } = await window.supabaseClient.from('homepage_sections')
      .upsert({ section_type: sectionType, data: JSON.stringify(data), updated_at: new Date().toISOString() }, { onConflict: 'section_type' });
    if (error) throw error;
    return true;
  } catch(e) { showToast('Save failed: ' + e.message, 'error'); return false; }
}

function hmGet(key, fallback = '') {
  const v = window._hm.settings[key];
  return v !== undefined && v !== null ? v : fallback;
}

// ── Section tab switch ────────────────────────────────────────
function hmTab(id) {
  window._hm.activeSection = id;
  document.querySelectorAll('.hm-tab').forEach(t => t.classList.toggle('active', t.dataset.hmTab === id));
  document.querySelectorAll('.hm-panel').forEach(p => p.style.display = p.dataset.hmPanel === id ? 'block' : 'none');
}

// ── Save helpers per section ──────────────────────────────────
async function hmSaveHero() {
  const btn = document.getElementById('hmSaveHeroBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const fields = { hero_title: 'hmHeroTitle', hero_subtitle: 'hmHeroSubtitle', hero_cta_text: 'hmHeroCtaText', hero_cta_link: 'hmHeroCtaLink', hero_enabled: null };
  const saves = [];
  saves.push(hmSave('hero_title',    document.getElementById('hmHeroTitle')?.value || ''));
  saves.push(hmSave('hero_subtitle', document.getElementById('hmHeroSubtitle')?.value || ''));
  saves.push(hmSave('hero_cta_text', document.getElementById('hmHeroCtaText')?.value || ''));
  saves.push(hmSave('hero_cta_link', document.getElementById('hmHeroCtaLink')?.value || ''));
  saves.push(hmSave('hero_enabled',  document.getElementById('hmHeroEnabled')?.classList.contains('on') ? '1' : '0'));
  saves.push(hmSave('hero_image',    document.getElementById('hmHeroBannerUrl')?.value || ''));
  const results = await Promise.all(saves);
  btn.disabled = false; btn.textContent = '💾 Save Hero Section';
  if (results.every(Boolean)) showToast('✅ Hero Section saved to Supabase!', 'success');
}

async function hmSaveFeatured() {
  const btn = document.getElementById('hmSaveFeaturedBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const selected = [...document.querySelectorAll('.hm-pdf-check:checked')].map(cb => cb.value);
  const enabled  = document.getElementById('hmFeaturedEnabled')?.classList.contains('on') ? '1' : '0';
  const ok1 = await hmSave('featured_pdf_ids', JSON.stringify(selected));
  const ok2 = await hmSave('featured_enabled', enabled);
  btn.disabled = false; btn.textContent = '💾 Save Featured PDFs';
  if (ok1 && ok2) showToast('✅ Featured PDFs saved!', 'success');
}

async function hmSaveTrending() {
  const btn = document.getElementById('hmSaveTrendingBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const mode = document.querySelector('input[name="hmTrendMode"]:checked')?.value || 'auto';
  const limit = document.getElementById('hmTrendingLimit')?.value || '8';
  const enabled = document.getElementById('hmTrendingEnabled')?.classList.contains('on') ? '1' : '0';
  const saves = [hmSave('trending_mode', mode), hmSave('trending_limit', limit), hmSave('trending_enabled', enabled)];
  if (mode === 'manual') {
    const sel = [...document.querySelectorAll('.hm-trend-check:checked')].map(cb => cb.value);
    saves.push(hmSave('trending_manual_ids', JSON.stringify(sel)));
  }
  const results = await Promise.all(saves);
  btn.disabled = false; btn.textContent = '💾 Save Trending Settings';
  if (results.every(Boolean)) showToast('✅ Trending PDFs settings saved!', 'success');
}

async function hmSaveNewArrivals() {
  const btn = document.getElementById('hmSaveArrivalsBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const limit   = document.getElementById('hmArrivalsLimit')?.value || '8';
  const enabled = document.getElementById('hmArrivalsEnabled')?.classList.contains('on') ? '1' : '0';
  const ok1 = await hmSave('arrivals_limit', limit);
  const ok2 = await hmSave('arrivals_enabled', enabled);
  btn.disabled = false; btn.textContent = '💾 Save New Arrivals';
  if (ok1 && ok2) showToast('✅ New Arrivals saved!', 'success');
}

async function hmSaveStudentPicks() {
  const btn = document.getElementById('hmSavePicksBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const selected = [...document.querySelectorAll('.hm-pick-check:checked')].map(cb => cb.value);
  const enabled  = document.getElementById('hmPicksEnabled')?.classList.contains('on') ? '1' : '0';
  const ok1 = await hmSave('picks_pdf_ids', JSON.stringify(selected));
  const ok2 = await hmSave('picks_enabled', enabled);
  btn.disabled = false; btn.textContent = '💾 Save Student Picks';
  if (ok1 && ok2) showToast('✅ Student Picks saved!', 'success');
}

async function hmAddTestimonial() {
  const name  = document.getElementById('hmTestName')?.value?.trim();
  const stars = document.getElementById('hmTestStars')?.value || '5';
  const text  = document.getElementById('hmTestText')?.value?.trim();
  if (!name || !text) { showToast('Name and review text required.', 'error'); return; }
  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return; }
  try {
    const { error } = await window.supabaseClient.from('homepage_sections').insert({
      section_type: 'testimonial',
      data: JSON.stringify({ name, stars: Number(stars), text }),
      sort_order: window._hm.testimonials.length,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    document.getElementById('hmTestName').value = '';
    document.getElementById('hmTestText').value = '';
    showToast('✅ Testimonial added!', 'success');
    await hmRefreshTestimonials();
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
}

async function hmDeleteTestimonial(id) {
  if (!confirm('Delete this testimonial?')) return;
  try {
    await window.supabaseClient.from('homepage_sections').delete().eq('id', id);
    showToast('Testimonial deleted.', 'info');
    await hmRefreshTestimonials();
  } catch(e) { showToast('Delete failed.', 'error'); }
}

async function hmRefreshTestimonials() {
  try {
    const { data } = await window.supabaseClient.from('homepage_sections')
      .select('*').eq('section_type', 'testimonial').order('sort_order');
    window._hm.testimonials = data || [];
    const container = document.getElementById('hmTestimonialsList');
    if (container) container.innerHTML = hmTestimonialsListHTML();
  } catch(e) {}
}

function hmTestimonialsListHTML() {
  const list = window._hm.testimonials;
  if (!list.length) return '<div class="text-muted text-sm" style="padding:12px 0">No testimonials yet. Add one below.</div>';
  return list.map(row => {
    let d = {}; try { d = JSON.parse(row.data || '{}'); } catch(e) {}
    const stars = '★'.repeat(Number(d.stars) || 5) + '☆'.repeat(5 - (Number(d.stars) || 5));
    return `<div style="background:var(--surface);border:1px solid var(--glass-border);border-radius:12px;padding:14px;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:2px">${d.name || ''}</div>
        <div style="color:var(--gold);font-size:.8rem;margin-bottom:4px">${stars}</div>
        <div style="font-size:.8rem;color:var(--text2);line-height:1.5">${d.text || ''}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="hmDeleteTestimonial('${row.id}')" style="flex-shrink:0;border-radius:8px">🗑</button>
    </div>`;
  }).join('');
}

async function hmSaveTestimonialsToggle() {
  const enabled = document.getElementById('hmTestimonialsEnabled')?.classList.contains('on') ? '1' : '0';
  const ok = await hmSave('testimonials_enabled', enabled);
  if (ok) showToast('✅ Testimonials setting saved!', 'success');
}

async function hmSaveFlashSale() {
  const btn = document.getElementById('hmSaveFlashBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const saves = [
    hmSave('flash_title',    document.getElementById('hmFlashTitle')?.value || ''),
    hmSave('flash_discount', document.getElementById('hmFlashDiscount')?.value || ''),
    hmSave('flash_end',      document.getElementById('hmFlashEnd')?.value || ''),
    hmSave('flash_banner',   document.getElementById('hmFlashBanner')?.value || ''),
    hmSave('flash_enabled',  document.getElementById('hmFlashEnabled')?.classList.contains('on') ? '1' : '0'),
  ];
  const results = await Promise.all(saves);
  btn.disabled = false; btn.textContent = '💾 Save Flash Sale';
  if (results.every(Boolean)) showToast('✅ Flash Sale saved!', 'success');
}

async function hmSaveCountdown() {
  const btn = document.getElementById('hmSaveCountdownBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const saves = [
    hmSave('countdown_exam',    document.getElementById('hmCountdownExam')?.value || ''),
    hmSave('countdown_date',    document.getElementById('hmCountdownDate')?.value || ''),
    hmSave('countdown_enabled', document.getElementById('hmCountdownEnabled')?.classList.contains('on') ? '1' : '0'),
  ];
  const results = await Promise.all(saves);
  btn.disabled = false; btn.textContent = '💾 Save Countdown';
  if (results.every(Boolean)) showToast('✅ Exam Countdown saved!', 'success');
}

async function hmSaveLiveActivity() {
  const enabled = document.getElementById('hmLiveEnabled')?.classList.contains('on') ? '1' : '0';
  const ok = await hmSave('live_activity_enabled', enabled);
  if (ok) showToast('✅ Live Activity saved!', 'success');
}

async function hmSaveStats() {
  const enabled = document.getElementById('hmStatsEnabled')?.classList.contains('on') ? '1' : '0';
  const ok = await hmSave('platform_stats_enabled', enabled);
  if (ok) showToast('✅ Platform Statistics saved!', 'success');
}

async function hmSaveFooter() {
  const btn = document.getElementById('hmSaveFooterBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const saves = [
    hmSave('footer_copyright', document.getElementById('hmFooterCopyright')?.value || ''),
    hmSave('footer_links',     document.getElementById('hmFooterLinks')?.value || ''),
    hmSave('footer_twitter',   document.getElementById('hmFooterTwitter')?.value || ''),
    hmSave('footer_instagram', document.getElementById('hmFooterInstagram')?.value || ''),
    hmSave('footer_telegram',  document.getElementById('hmFooterTelegram')?.value || ''),
    hmSave('footer_youtube',   document.getElementById('hmFooterYoutube')?.value || ''),
    hmSave('footer_enabled',   document.getElementById('hmFooterEnabled')?.classList.contains('on') ? '1' : '0'),
  ];
  const results = await Promise.all(saves);
  btn.disabled = false; btn.textContent = '💾 Save Footer';
  if (results.every(Boolean)) showToast('✅ Footer settings saved!', 'success');
}

function hmToggleEl(btn) {
  btn.classList.toggle('on');
}

// ── Countdown live preview ────────────────────────────────────
function hmUpdateCountdownPreview() {
  const dateVal = document.getElementById('hmCountdownDate')?.value;
  const examVal = document.getElementById('hmCountdownExam')?.value || 'Exam';
  const prev = document.getElementById('hmCountdownPreview');
  if (!prev) return;
  if (!dateVal) { prev.innerHTML = '<span style="color:var(--text2)">Set a date to preview countdown</span>'; return; }
  const target = new Date(dateVal).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) { prev.innerHTML = '<span style="color:var(--danger)">Exam date has passed!</span>'; return; }
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  prev.innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <span style="font-weight:700;color:var(--accent)">${examVal}</span>
    <span style="color:var(--text2)">in</span>
    <span style="background:var(--surface);border:1px solid var(--glass-border);border-radius:8px;padding:4px 10px;font-weight:800;color:var(--text)">${days}d</span>
    <span style="background:var(--surface);border:1px solid var(--glass-border);border-radius:8px;padding:4px 10px;font-weight:800;color:var(--text)">${hours}h</span>
    <span style="background:var(--surface);border:1px solid var(--glass-border);border-radius:8px;padding:4px 10px;font-weight:800;color:var(--text)">${mins}m</span>
  </div>`;
}

// ── Platform stats auto-calc ──────────────────────────────────
async function hmLoadPlatformStats() {
  const el = document.getElementById('hmStatsAutoPreview');
  if (!el || !window.supabaseClient) return;
  el.innerHTML = '<span style="color:var(--text2);font-size:.8rem">Loading live stats…</span>';
  try {
    const [pdfRes, userRes, dlRes, revRes] = await Promise.all([
      window.supabaseClient.from('pdfs').select('id', {count:'exact', head:true}),
      window.supabaseClient.from('profiles').select('id', {count:'exact', head:true}),
      window.supabaseClient.from('pdfs').select('download_count'),
      window.supabaseClient.from('purchased_pdfs').select('amount'),
    ]);
    const totalPdfs = pdfRes.count || 0;
    const totalUsers = userRes.count || 0;
    const totalDl = (dlRes.data || []).reduce((s,r) => s + (r.download_count||0), 0);
    const totalRev = (revRes.data || []).reduce((s,r) => s + (r.amount||0), 0);
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:8px">
      ${[['📚','Total PDFs', totalPdfs],['👥','Total Users', totalUsers.toLocaleString()],['📥','Downloads', totalDl.toLocaleString()],['💰','Revenue', '₹'+totalRev.toLocaleString()]].map(([ic,lbl,val]) =>
        `<div style="background:var(--surface);border:1px solid var(--glass-border);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.3rem">${ic}</div>
          <div style="font-size:1.1rem;font-weight:800;color:var(--accent);margin:4px 0">${val}</div>
          <div style="font-size:.72rem;color:var(--text2)">${lbl}</div>
        </div>`).join('')}
    </div>`;
  } catch(e) {
    el.innerHTML = '<span style="color:var(--danger);font-size:.8rem">Could not load stats from Supabase. Check connection.</span>';
  }
}

// ── PDF picker HTML helper ───────────────────────────────────
function hmPdfPickerHTML(checkClass, savedKey) {
  const pdfs = window._hm.pdfs;
  const savedIds = (() => { try { return JSON.parse(window._hm.settings[savedKey] || '[]'); } catch(e) { return []; } })();
  if (!pdfs.length) return '<div class="text-muted text-sm">No PDFs found. Make sure pdfs table has data.</div>';
  return `<div style="max-height:260px;overflow-y:auto;border:1px solid var(--glass-border);border-radius:10px;padding:8px">
    ${pdfs.map(p => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" class="${checkClass}" value="${p.id}" ${savedIds.includes(String(p.id)) || savedIds.includes(p.id) ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0">
        <span style="font-size:.82rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title}</span>
        ${p.tag ? `<span style="font-size:.65rem;background:rgba(61,142,248,0.1);color:var(--accent);border-radius:5px;padding:1px 6px;flex-shrink:0">${p.tag}</span>` : ''}
      </label>`).join('')}
  </div>`;
}

// ── Main render ───────────────────────────────────────────────
async function renderPCCHomepageManager(main) {
  main.innerHTML = `<div style="text-align:center;padding:48px 0">
    <div style="font-size:2.5rem;margin-bottom:12px">🏠</div>
    <div style="font-weight:700;color:var(--text2)">Loading Homepage Manager…</div>
  </div>`;

  await hmLoadSettings();

  const hm = window._hm;
  const s = (k, fb) => hmGet(k, fb);

  const tabs = [
    ['hero','🦸 Hero'],['featured','⭐ Featured PDFs'],['trending','🔥 Trending'],
    ['arrivals','🆕 New Arrivals'],['picks','🎓 Student Picks'],['testimonials','💬 Testimonials'],
    ['flash','⚡ Flash Sale'],['countdown','⏳ Countdown'],['live','📡 Live Activity'],
    ['stats','📈 Statistics'],['footer','🔗 Footer'],
  ];

  // ── SQL note shown if Supabase not connected ─────────────────
  const dbWarning = !window.supabaseClient ? `
    <div style="background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.25);border-radius:12px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:10px">
      <span style="font-size:1.4rem">⚠️</span>
      <div>
        <div style="font-weight:700;color:var(--danger);font-size:.88rem">Supabase Not Connected</div>
        <div style="font-size:.78rem;color:var(--text2);margin-top:2px">Connect Supabase in Admin → Settings to enable saving. Also run the SQL below to create required tables.</div>
      </div>
    </div>` : '';

  const sqlBlock = `
    <div class="mod-form-wrap" style="margin-top:14px">
      <div style="font-weight:700;color:var(--gold);margin-bottom:10px;display:flex;align-items:center;gap:6px">🗄️ Required Supabase Tables <span style="font-size:.72rem;font-weight:400;color:var(--text2)">(run once in Supabase SQL Editor)</span></div>
      <div style="position:relative">
        <pre style="background:#0a0f1a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;font-size:.72rem;overflow-x:auto;color:#7dd3fc;line-height:1.6;max-height:200px">-- homepage_settings: key-value store for all settings
CREATE TABLE IF NOT EXISTS homepage_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- homepage_sections: testimonials, manual PDF picks etc.
CREATE TABLE IF NOT EXISTS homepage_sections (
  id BIGSERIAL PRIMARY KEY,
  section_type TEXT NOT NULL,
  data JSONB,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (allow admin reads/writes)
ALTER TABLE homepage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE homepage_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON homepage_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "admin_all" ON homepage_sections FOR ALL USING (true) WITH CHECK (true);

-- Feature: PDF Requests (from Request PDF form)
CREATE TABLE IF NOT EXISTS pdf_requests (
  id BIGSERIAL PRIMARY KEY,
  student_name TEXT,
  email TEXT,
  university TEXT,
  semester TEXT,
  subject TEXT,
  pdf_name TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pdf_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_insert" ON pdf_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_select" ON pdf_requests FOR SELECT USING (true);

-- Feature: Broken PDF Reports
CREATE TABLE IF NOT EXISTS broken_pdf_reports (
  id BIGSERIAL PRIMARY KEY,
  pdf_id BIGINT,
  pdf_title TEXT,
  pdf_url TEXT,
  problem_description TEXT NOT NULL,
  reporter_email TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE broken_pdf_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_insert" ON broken_pdf_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_select" ON broken_pdf_reports FOR SELECT USING (true);</pre>
        <button class="btn btn-ghost btn-sm" style="position:absolute;top:8px;right:8px;font-size:.7rem" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);showToast('SQL copied!','success')">📋 Copy</button>
      </div>
    </div>`;

  main.innerHTML = `
  <style>
    .hm-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid var(--glass-border)}
    .hm-tab{padding:7px 13px;border-radius:20px;font-size:.79rem;font-weight:600;cursor:pointer;border:1px solid var(--glass-border);background:var(--surface);color:var(--text2);transition:all .2s;white-space:nowrap}
    .hm-tab.active,.hm-tab:hover{background:linear-gradient(135deg,rgba(61,142,248,0.18),rgba(0,200,232,0.1));border-color:rgba(61,142,248,0.35);color:var(--text)}
    .hm-panel{display:none} .hm-panel.active-panel{display:block}
    .hm-card{background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;padding:18px 20px;margin-bottom:14px}
    .hm-card-title{font-weight:700;font-size:.92rem;margin-bottom:14px;display:flex;align-items:center;gap:7px}
    .hm-save-bar{display:flex;gap:10px;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--glass-border);flex-wrap:wrap}
  </style>

  <div class="admin-section-title">🏠 Homepage Manager</div>
  <div class="admin-section-sub" style="margin-bottom:16px">Edit, enable/disable and save every homepage section directly to Supabase.</div>

  ${dbWarning}

  <div class="hm-tabs">
    ${tabs.map(([id,label]) => `<button class="hm-tab ${id==='hero'?'active':''}" data-hm-tab="${id}" onclick="hmTab('${id}')">${label}</button>`).join('')}
  </div>

  <!-- ── HERO ─────────────────────────────────────────── -->
  <div class="hm-panel ${''}" data-hm-panel="hero" style="display:block">
    <div class="hm-card">
      <div class="hm-card-title">🦸 Hero Section</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Hero Title</label>
          <input class="form-input" id="hmHeroTitle" value="${s('hero_title',"Assam's #1 Smartest Growth Ecosystem")}"/></div>
        <div class="form-group"><label class="form-label">Subtitle</label>
          <input class="form-input" id="hmHeroSubtitle" value="${s('hero_subtitle','157+ students study smarter every day')}"/></div>
        <div class="form-group"><label class="form-label">CTA Button Text</label>
          <input class="form-input" id="hmHeroCtaText" value="${s('hero_cta_text','Browse PDFs')}"/></div>
        <div class="form-group"><label class="form-label">CTA Button Link</label>
          <input class="form-input" id="hmHeroCtaLink" placeholder="/library" value="${s('hero_cta_link','/library')}"/></div>
      </div>
      <div class="form-group" style="margin-top:8px"><label class="form-label">Hero Banner Image URL</label>
        <input class="form-input" id="hmHeroBannerUrl" placeholder="https://…/banner.jpg" value="${s('hero_image','')}"/>
        <div style="font-size:.72rem;color:var(--text2);margin-top:4px">Paste a direct image URL (Supabase Storage, Cloudinary, etc.). Leave blank to use default gradient.</div>
      </div>
      <div id="hmHeroBannerPreview" style="margin-top:10px;${s('hero_image') ? '' : 'display:none'}">
        <img src="${s('hero_image','')}" alt="Homepage hero banner preview" style="max-height:120px;border-radius:10px;border:1px solid var(--glass-border);object-fit:cover" onerror="this.style.display='none'" loading="lazy" decoding="async" />
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Hero Section</div><div class="text-muted text-xs">Show/hide the hero banner on homepage</div></div>
        <button class="admin-toggle ${s('hero_enabled','1')==='1'?'on':''}" id="hmHeroEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveHeroBtn" onclick="hmSaveHero()">💾 Save Hero Section</button>
        <span style="font-size:.75rem;color:var(--text2)" id="hmHeroStatus"></span>
      </div>
    </div>
  </div>

  <!-- ── FEATURED PDFs ─────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="featured" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">⭐ Featured PDFs</div>
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:10px">Check PDFs to show in the Featured section. Drag to reorder (order = checked order).</div>
      ${hmPdfPickerHTML('hm-pdf-check', 'featured_pdf_ids')}
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Featured PDFs Section</div></div>
        <button class="admin-toggle ${s('featured_enabled','1')==='1'?'on':''}" id="hmFeaturedEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveFeaturedBtn" onclick="hmSaveFeatured()">💾 Save Featured PDFs</button>
      </div>
    </div>
  </div>

  <!-- ── TRENDING ───────────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="trending" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">🔥 Trending PDFs</div>
      <div style="margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:600;margin-bottom:8px">Fetch Mode</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
            <input type="radio" name="hmTrendMode" value="auto" ${s('trending_mode','auto')==='auto'?'checked':''} style="accent-color:var(--accent)"> Auto (highest views/downloads from DB)
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
            <input type="radio" name="hmTrendMode" value="manual" ${s('trending_mode','auto')==='manual'?'checked':''} style="accent-color:var(--accent)"> Manual Selection
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Max PDFs to show</label>
        <input class="form-input" id="hmTrendingLimit" type="number" min="2" max="20" value="${s('trending_limit','8')}" style="max-width:120px"/>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:.82rem;font-weight:600;margin-bottom:6px">Manual Selection (used when Manual mode is active)</div>
        ${hmPdfPickerHTML('hm-trend-check', 'trending_manual_ids')}
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Trending Section</div></div>
        <button class="admin-toggle ${s('trending_enabled','1')==='1'?'on':''}" id="hmTrendingEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveTrendingBtn" onclick="hmSaveTrending()">💾 Save Trending Settings</button>
      </div>
    </div>
  </div>

  <!-- ── NEW ARRIVALS ───────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="arrivals" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">🆕 New Arrivals</div>
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:12px">Auto-fetches the latest PDFs by <code style="background:var(--surface);padding:1px 5px;border-radius:4px">created_at</code> from pdfs.</div>
      <div class="form-group">
        <label class="form-label">Max PDFs to show</label>
        <input class="form-input" id="hmArrivalsLimit" type="number" min="2" max="20" value="${s('arrivals_limit','8')}" style="max-width:120px"/>
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable New Arrivals Section</div></div>
        <button class="admin-toggle ${s('arrivals_enabled','1')==='1'?'on':''}" id="hmArrivalsEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveArrivalsBtn" onclick="hmSaveNewArrivals()">💾 Save New Arrivals</button>
      </div>
    </div>
  </div>

  <!-- ── STUDENT PICKS ──────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="picks" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">🎓 Student Picks</div>
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:10px">Manually curate PDFs for the Student Picks section.</div>
      ${hmPdfPickerHTML('hm-pick-check', 'picks_pdf_ids')}
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Student Picks Section</div></div>
        <button class="admin-toggle ${s('picks_enabled','1')==='1'?'on':''}" id="hmPicksEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSavePicksBtn" onclick="hmSaveStudentPicks()">💾 Save Student Picks</button>
      </div>
    </div>
  </div>

  <!-- ── TESTIMONIALS ───────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="testimonials" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">💬 Testimonials</div>
      <div id="hmTestimonialsList" style="margin-bottom:14px">${hmTestimonialsListHTML()}</div>
      <div style="border-top:1px solid var(--glass-border);padding-top:14px">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">➕ Add New Testimonial</div>
        <div class="admin-form-grid">
          <div class="form-group"><label class="form-label">Student Name</label>
            <input class="form-input" id="hmTestName" placeholder="e.g. Ankita Bora"/></div>
          <div class="form-group"><label class="form-label">Star Rating</label>
            <select class="form-input" id="hmTestStars">
              <option value="5">⭐⭐⭐⭐⭐ (5 stars)</option>
              <option value="4">⭐⭐⭐⭐ (4 stars)</option>
              <option value="3">⭐⭐⭐ (3 stars)</option>
            </select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Review Text</label>
          <textarea class="form-input" id="hmTestText" rows="3" placeholder="Write the student's review…"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" onclick="hmAddTestimonial()">➕ Add Testimonial</button>
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Testimonials Section</div></div>
        <button class="admin-toggle ${s('testimonials_enabled','1')==='1'?'on':''}" id="hmTestimonialsEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-secondary" onclick="hmSaveTestimonialsToggle()">💾 Save Enable/Disable</button>
      </div>
    </div>
  </div>

  <!-- ── FLASH SALE ─────────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="flash" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">⚡ Flash Sale</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Sale Title</label>
          <input class="form-input" id="hmFlashTitle" value="${s('flash_title','🔥 Flash Sale — Up to 50% OFF!')}"/></div>
        <div class="form-group"><label class="form-label">Discount %</label>
          <input class="form-input" id="hmFlashDiscount" type="number" min="1" max="99" value="${s('flash_discount','30')}"/></div>
        <div class="form-group"><label class="form-label">End Date & Time</label>
          <input class="form-input" id="hmFlashEnd" type="datetime-local" value="${s('flash_end','')}"/></div>
        <div class="form-group"><label class="form-label">Banner Image URL</label>
          <input class="form-input" id="hmFlashBanner" placeholder="https://…/sale-banner.jpg" value="${s('flash_banner','')}"/></div>
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Flash Sale</div><div class="text-muted text-xs">Shows the sale banner + countdown timer on homepage</div></div>
        <button class="admin-toggle ${s('flash_enabled','0')==='1'?'on':''}" id="hmFlashEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveFlashBtn" onclick="hmSaveFlashSale()">💾 Save Flash Sale</button>
      </div>
    </div>
  </div>

  <!-- ── EXAM COUNTDOWN ─────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="countdown" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">⏳ Exam Countdown</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Exam Name</label>
          <input class="form-input" id="hmCountdownExam" placeholder="e.g. JEE Mains 2025" value="${s('countdown_exam','JEE Mains 2025')}" oninput="hmUpdateCountdownPreview()"/></div>
        <div class="form-group"><label class="form-label">Exam Date</label>
          <input class="form-input" id="hmCountdownDate" type="date" value="${s('countdown_date','')}" oninput="hmUpdateCountdownPreview()"/></div>
      </div>
      <div style="margin-top:10px;font-size:.82rem;font-weight:600;margin-bottom:6px">Live Preview</div>
      <div id="hmCountdownPreview" style="background:var(--surface);border:1px solid var(--glass-border);border-radius:10px;padding:12px;margin-bottom:12px">
        <span style="color:var(--text2)">Set a date to preview countdown</span>
      </div>
      <div class="admin-toggle-row">
        <div><div style="font-size:.85rem;font-weight:600">Enable Exam Countdown</div><div class="text-muted text-xs">Show countdown widget on homepage</div></div>
        <button class="admin-toggle ${s('countdown_enabled','1')==='1'?'on':''}" id="hmCountdownEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveCountdownBtn" onclick="hmSaveCountdown()">💾 Save Countdown</button>
      </div>
    </div>
  </div>

  <!-- ── LIVE ACTIVITY BAR ──────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="live" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">📡 Live Activity Bar</div>
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:14px">The Live Activity Bar shows real-time purchase and download events pulled from Supabase Realtime. No manual content needed — it auto-reads from <code style="background:var(--surface);padding:1px 5px;border-radius:4px">purchased_pdfs</code> and <code style="background:var(--surface);padding:1px 5px;border-radius:4px">pdfs</code>.</div>
      <div style="background:rgba(16,217,142,0.06);border:1px solid rgba(16,217,142,0.2);border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:.82rem;font-weight:700;color:var(--success);margin-bottom:6px">✅ Supabase Realtime Powered</div>
        <div style="font-size:.78rem;color:var(--text2);line-height:1.6">• Listens to INSERT events on <strong>purchased_pdfs</strong> table<br>• Also listens to <strong>pdfs</strong> download_count increments<br>• Animates the ticker bar on homepage in real time</div>
      </div>
      <div class="admin-toggle-row">
        <div><div style="font-size:.85rem;font-weight:600">Enable Live Activity Bar</div><div class="text-muted text-xs">Show scrolling ticker of real purchases/downloads</div></div>
        <button class="admin-toggle ${s('live_activity_enabled','1')==='1'?'on':''}" id="hmLiveEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" onclick="hmSaveLiveActivity()">💾 Save Live Activity Setting</button>
      </div>
    </div>
  </div>

  <!-- ── PLATFORM STATISTICS ────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="stats" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">📈 Platform Statistics</div>
      <div style="font-size:.82rem;color:var(--text2);margin-bottom:10px">Statistics are auto-calculated from your Supabase database. No manual entry required.</div>
      <div id="hmStatsAutoPreview"><span style="color:var(--text2);font-size:.8rem">Click "Load Live Stats" to preview.</span></div>
      <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="hmLoadPlatformStats()">🔄 Load Live Stats</button>
      <div class="admin-toggle-row" style="margin-top:14px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Statistics Section</div><div class="text-muted text-xs">Show live counters block on homepage</div></div>
        <button class="admin-toggle ${s('platform_stats_enabled','1')==='1'?'on':''}" id="hmStatsEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" onclick="hmSaveStats()">💾 Save Statistics Setting</button>
      </div>
    </div>
  </div>

  <!-- ── FOOTER ─────────────────────────────────────────── -->
  <div class="hm-panel" data-hm-panel="footer" style="display:none">
    <div class="hm-card">
      <div class="hm-card-title">🔗 Footer Sections</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Copyright Text</label>
          <input class="form-input" id="hmFooterCopyright" value="${s('footer_copyright','© 2025 Studyria. All rights reserved.')}"/></div>
        <div class="form-group"><label class="form-label">Twitter / X URL</label>
          <input class="form-input" id="hmFooterTwitter" placeholder="https://x.com/studyria" value="${s('footer_twitter','')}"/></div>
        <div class="form-group"><label class="form-label">Instagram URL</label>
          <input class="form-input" id="hmFooterInstagram" placeholder="https://instagram.com/studyria" value="${s('footer_instagram','')}"/></div>
        <div class="form-group"><label class="form-label">Telegram URL</label>
          <input class="form-input" id="hmFooterTelegram" placeholder="https://t.me/studyria" value="${s('footer_telegram','')}"/></div>
        <div class="form-group"><label class="form-label">YouTube URL</label>
          <input class="form-input" id="hmFooterYoutube" placeholder="https://youtube.com/@studyria" value="${s('footer_youtube','')}"/></div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Footer Quick Links <span style="font-size:.72rem;color:var(--text2)">(one per line: Label|/url)</span></label>
        <textarea class="form-input" id="hmFooterLinks" rows="5" placeholder="About Us|/about&#10;Contact|/contact&#10;Privacy Policy|/privacy&#10;Terms|/terms">${s('footer_links','')}</textarea>
      </div>
      <div class="admin-toggle-row" style="margin-top:12px">
        <div><div style="font-size:.85rem;font-weight:600">Enable Footer</div></div>
        <button class="admin-toggle ${s('footer_enabled','1')==='1'?'on':''}" id="hmFooterEnabled" onclick="hmToggleEl(this)"></button>
      </div>
      <div class="hm-save-bar">
        <button class="btn btn-primary" id="hmSaveFooterBtn" onclick="hmSaveFooter()">💾 Save Footer</button>
      </div>
    </div>
  </div>

  ${sqlBlock}
  `;

  // Run countdown preview if date is set
  hmUpdateCountdownPreview();
}

/* ─── 4. WEBSITE CUSTOMIZATION — THEME STUDIO PRO ───────────── */

// ══════════════════════════════════════════════════════════════
// THEME STUDIO PRO — State & Data
// ══════════════════════════════════════════════════════════════
const TS_KEY       = 'studyria_theme_customizations';
const TS_PRESET_KEY= 'studyria_theme_presets';
const TS_ACTIVE_KEY= 'studyria_active_theme';
const TS_SETTINGS_KEY = 'studyria_site_settings';

const TS_BUILTIN_PRESETS = [
  { id:'studyria-blue',   icon:'🔵', name:'Studyria Blue',     desc:'Default electric-blue signature theme',
    primary:'#3d8ef8', secondary:'#00c8e8', accent:'#f59e0b', bg:'#080c14', bg2:'#0d1220',
    navbar:'rgba(8,12,20,0.92)', card:'rgba(255,255,255,0.03)', text:'#eef2ff', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'solid', anim:'glow' },
  { id:'royal-sapphire',  icon:'👑', name:'Royal Sapphire',    desc:'Deep royal blue with gold accents',
    primary:'#1e3a8a', secondary:'#3b82f6', accent:'#fbbf24', bg:'#0a0f1e', bg2:'#0f1930',
    navbar:'rgba(10,15,30,0.95)', card:'rgba(255,255,255,0.04)', text:'#e8f0fe', font:'Playfair Display',
    uiStyle:'luxury', bgStyle:'gradient', anim:'glow' },
  { id:'midnight-ocean',  icon:'🌊', name:'Midnight Ocean',    desc:'Deep ocean blues, calm & premium',
    primary:'#0ea5e9', secondary:'#06b6d4', accent:'#67e8f9', bg:'#0c1a2e', bg2:'#0f2340',
    navbar:'rgba(12,26,46,0.95)', card:'rgba(14,165,233,0.06)', text:'#e0f2fe', font:'DM Sans',
    uiStyle:'glassmorphism', bgStyle:'mesh', anim:'floating' },
  { id:'cyber-neon',      icon:'⚡', name:'Cyber Neon',        desc:'Electric neon cyberpunk energy',
    primary:'#a855f7', secondary:'#ec4899', accent:'#06ffa5', bg:'#050012', bg2:'#0a001f',
    navbar:'rgba(5,0,18,0.97)', card:'rgba(168,85,247,0.07)', text:'#f5e8ff', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'aurora', anim:'glow' },
  { id:'premium-gold',    icon:'💎', name:'Premium Gold',      desc:'Luxury black & gold, ultra-premium',
    primary:'#f59e0b', secondary:'#d97706', accent:'#fde68a', bg:'#0a0800', bg2:'#140f00',
    navbar:'rgba(10,8,0,0.97)', card:'rgba(245,158,11,0.06)', text:'#fef3c7', font:'Playfair Display',
    uiStyle:'luxury', bgStyle:'gradient', anim:'glow' },
  { id:'emerald-pro',     icon:'🟢', name:'Emerald Pro',       desc:'Rich emerald green, finance-grade',
    primary:'#10d98e', secondary:'#059669', accent:'#34d399', bg:'#020f0a', bg2:'#041a0e',
    navbar:'rgba(2,15,10,0.97)', card:'rgba(16,217,142,0.06)', text:'#d1fae5', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'solid', anim:'fade' },
  { id:'crimson-elite',   icon:'🔴', name:'Crimson Elite',     desc:'Bold red, power & confidence',
    primary:'#ef4444', secondary:'#dc2626', accent:'#fca5a5', bg:'#120005', bg2:'#1e0008',
    navbar:'rgba(18,0,5,0.97)', card:'rgba(239,68,68,0.06)', text:'#ffe4e6', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'solid', anim:'hover' },
  { id:'arctic-frost',    icon:'❄️', name:'Arctic Frost',      desc:'Clean white & ice blue, minimal',
    primary:'#6366f1', secondary:'#818cf8', accent:'#a5b4fc', bg:'#f8faff', bg2:'#ffffff',
    navbar:'rgba(248,250,255,0.95)', card:'rgba(99,102,241,0.05)', text:'#1e1b4b', font:'DM Sans',
    uiStyle:'apple', bgStyle:'glass', anim:'fade' },
  { id:'purple-galaxy',   icon:'🌌', name:'Purple Galaxy',     desc:'Cosmic purple, space-age aesthetic',
    primary:'#8b5cf6', secondary:'#a78bfa', accent:'#e879f9', bg:'#07030f', bg2:'#0f0618',
    navbar:'rgba(7,3,15,0.97)', card:'rgba(139,92,246,0.07)', text:'#f3e8ff', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'aurora', anim:'floating' },
  { id:'sunset-orange',   icon:'🌅', name:'Sunset Orange',     desc:'Warm sunset gradient energy',
    primary:'#f97316', secondary:'#fb923c', accent:'#fbbf24', bg:'#0f0800', bg2:'#1a0e00',
    navbar:'rgba(15,8,0,0.97)', card:'rgba(249,115,22,0.06)', text:'#fff7ed', font:'DM Sans',
    uiStyle:'glassmorphism', bgStyle:'gradient', anim:'glow' },
  { id:'tesla-black',     icon:'🚗', name:'Tesla Black',       desc:'Ultra-minimal dark, Tesla-inspired',
    primary:'#e4e4e7', secondary:'#a1a1aa', accent:'#cc0000', bg:'#000000', bg2:'#0a0a0a',
    navbar:'rgba(0,0,0,0.98)', card:'rgba(255,255,255,0.03)', text:'#fafafa', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'solid', anim:'fade' },
  { id:'apple-glass',     icon:'🍎', name:'Apple Glass',       desc:'Apple UI — frosted glass, pure clarity',
    primary:'#007aff', secondary:'#5ac8fa', accent:'#ff9500', bg:'#f2f2f7', bg2:'#ffffff',
    navbar:'rgba(242,242,247,0.85)', card:'rgba(255,255,255,0.72)', text:'#1c1c1e', font:'Inter',
    uiStyle:'apple', bgStyle:'glass', anim:'fade' },
  { id:'netflix-dark',    icon:'🎬', name:'Netflix Dark',      desc:'Netflix cinematic dark red & black',
    primary:'#e50914', secondary:'#b20710', accent:'#f5f5f1', bg:'#141414', bg2:'#000000',
    navbar:'rgba(20,20,20,0.97)', card:'rgba(255,255,255,0.04)', text:'#ffffff', font:'Inter',
    uiStyle:'netflix', bgStyle:'solid', anim:'hover' },
  { id:'stripe-modern',   icon:'💳', name:'Stripe Modern',    desc:'Stripe SaaS — clean, professional',
    primary:'#635bff', secondary:'#8b83ff', accent:'#00d4ff', bg:'#0a2540', bg2:'#0d2f50',
    navbar:'rgba(10,37,64,0.97)', card:'rgba(99,91,255,0.07)', text:'#ffffff', font:'Inter',
    uiStyle:'stripe', bgStyle:'gradient', anim:'fade' },
  { id:'duolingo-fresh',  icon:'🦜', name:'Duolingo Fresh',   desc:'Playful green, Duolingo-inspired',
    primary:'#58cc02', secondary:'#89e219', accent:'#ffc800', bg:'#131f0e', bg2:'#1a2d10',
    navbar:'rgba(19,31,14,0.97)', card:'rgba(88,204,2,0.07)', text:'#ffffff', font:'DM Sans',
    uiStyle:'modern', bgStyle:'solid', anim:'hover' },
  { id:'academic-classic',icon:'📚', name:'Academic Classic', desc:'Traditional scholarly navy & cream',
    primary:'#1d4ed8', secondary:'#2563eb', accent:'#ca8a04', bg:'#faf7f0', bg2:'#ffffff',
    navbar:'rgba(250,247,240,0.95)', card:'rgba(29,78,216,0.05)', text:'#1e293b', font:'Playfair Display',
    uiStyle:'apple', bgStyle:'solid', anim:'fade' },
  { id:'material-pro',    icon:'🎨', name:'Material Pro',     desc:'Material Design 3 with deep purple',
    primary:'#6750a4', secondary:'#9c80d3', accent:'#e8def8', bg:'#1c1b1f', bg2:'#2b2930',
    navbar:'rgba(28,27,31,0.97)', card:'rgba(103,80,164,0.08)', text:'#e6e1e5', font:'Inter',
    uiStyle:'modern', bgStyle:'solid', anim:'fade' },
  { id:'aurora-borealis', icon:'🌈', name:'Aurora Borealis',  desc:'Northern lights — shifting gradients',
    primary:'#00f5a0', secondary:'#00d9f5', accent:'#f5a623', bg:'#040d12', bg2:'#071520',
    navbar:'rgba(4,13,18,0.97)', card:'rgba(0,245,160,0.05)', text:'#e0fff8', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'aurora', anim:'floating' },
  { id:'luxury-diamond',  icon:'💠', name:'Luxury Diamond',   desc:'Diamond clarity — silver & indigo',
    primary:'#818cf8', secondary:'#c7d2fe', accent:'#f0abfc', bg:'#060918', bg2:'#0b0f2a',
    navbar:'rgba(6,9,24,0.97)', card:'rgba(129,140,248,0.07)', text:'#eef2ff', font:'Playfair Display',
    uiStyle:'luxury', bgStyle:'mesh', anim:'glow' },
  { id:'studyria-premium',icon:'⭐', name:'Studyria Premium', desc:'Limited edition — gradient luxury',
    primary:'#3d8ef8', secondary:'#8b5cf6', accent:'#f59e0b', bg:'#060a14', bg2:'#0b1020',
    navbar:'rgba(6,10,20,0.97)', card:'rgba(61,142,248,0.06)', text:'#eef2ff', font:'Inter',
    uiStyle:'glassmorphism', bgStyle:'aurora', anim:'glow' },
];

// Load / Save helpers
function tsGetCustomPresets()   { try { return JSON.parse(localStorage.getItem(TS_PRESET_KEY)||'[]'); } catch(e) { return []; } }
function tsSaveCustomPresets(a) { try { localStorage.setItem(TS_PRESET_KEY, JSON.stringify(a)); } catch(e) {} }
function tsGetActiveTheme()     { try { return JSON.parse(localStorage.getItem(TS_ACTIVE_KEY)||'null'); } catch(e) { return null; } }
function tsSetActiveTheme(t)    { try { localStorage.setItem(TS_ACTIVE_KEY, JSON.stringify(t)); } catch(e) {} }
function tsGetSiteSettings()    { try { return JSON.parse(localStorage.getItem(TS_SETTINGS_KEY)||'{}'); } catch(e) { return {}; } }
function tsSaveSiteSettings(s)  { try { localStorage.setItem(TS_SETTINGS_KEY, JSON.stringify(s)); } catch(e) {} }
function tsGetCustomizations()  { try { return JSON.parse(localStorage.getItem(TS_KEY)||'{}'); } catch(e) { return {}; } }
function tsSaveCustomizations(s){ try { localStorage.setItem(TS_KEY, JSON.stringify(s)); } catch(e) {} }

let _tsActiveTab = 'presets';
let _tsEditingPreset = null; // preset object being created/edited

// Apply theme to live CSS variables
function tsApplyTheme(t) {
  const r = document.documentElement.style;
  r.setProperty('--accent',   t.primary);
  r.setProperty('--accent2',  t.secondary);
  r.setProperty('--accent3',  t.accent);
  r.setProperty('--bg',       t.bg);
  r.setProperty('--bg2',      t.bg2 || t.bg);
  if (t.text)   r.setProperty('--text', t.text);
  if (t.navbar) r.setProperty('--navbar-bg', t.navbar);
  if (t.card)   r.setProperty('--surface', t.card);
  r.setProperty('--grad-primary', `linear-gradient(135deg, ${t.primary} 0%, ${t.secondary} 100%)`);
  r.setProperty('--grad-hero',    `linear-gradient(135deg, ${t.primary} 0%, ${t.secondary} 100%)`);
  r.setProperty('--shadow-accent',`0 8px 40px ${t.primary}44`);
  r.setProperty('--shadow-glow',  `0 0 48px ${t.primary}2e`);
  // Apply font
  if (t.font) {
    const fontMap = {
      'Inter': "'Inter', system-ui, sans-serif",
      'Playfair Display': "'Playfair Display', Georgia, serif",
      'DM Sans': "'DM Sans', 'Inter', sans-serif",
    };
    r.setProperty('--font-body', fontMap[t.font] || fontMap['Inter']);
  }
  // Body light/dark
  if (t.bg && parseInt(t.bg.slice(1),16) > 0xaaaaaa) {
    document.body.classList.add('light'); if (window._alpine) window._alpine.isDarkMode = false;
  } else {
    document.body.classList.remove('light');
  }
  tsSetActiveTheme(t);
}

function tsResetTheme() {
  const r = document.documentElement.style;
  ['--accent','--accent2','--accent3','--bg','--bg2','--text','--navbar-bg','--surface',
   '--grad-primary','--grad-hero','--shadow-accent','--shadow-glow','--font-body'].forEach(v => r.removeProperty(v));
  document.body.classList.remove('light'); if (window._alpine) window._alpine.isDarkMode = true;
  localStorage.removeItem(TS_ACTIVE_KEY);
}

function tsExportTheme(t) {
  const json = JSON.stringify(t, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${t.id||'theme'}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Theme exported as JSON!', 'success');
}

function tsImportTheme() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const t = JSON.parse(ev.target.result);
        if (!t.name || !t.primary) { showToast('Invalid theme JSON.', 'error'); return; }
        t.id = 'custom-' + Date.now();
        const customs = tsGetCustomPresets();
        customs.push(t);
        tsSaveCustomPresets(customs);
        showToast(`Theme "${t.name}" imported!`, 'success');
        renderPCCCustomization(document.getElementById('adminMain'));
      } catch(err) { showToast('Failed to parse JSON.', 'error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Main render ───────────────────────────────────────────────
function renderPCCCustomization(main) {
  const active = tsGetActiveTheme();
  const customPresets = tsGetCustomPresets();
  const allPresets = [...TS_BUILTIN_PRESETS, ...customPresets];

  main.innerHTML = `
  <style>
    /* ─── THEME STUDIO PRO STYLES ─── */
    .ts-header{background:linear-gradient(135deg,rgba(61,142,248,0.12),rgba(139,92,246,0.08),rgba(0,200,232,0.06));border:1px solid rgba(61,142,248,0.18);border-radius:20px;padding:24px 28px;margin-bottom:22px;position:relative;overflow:hidden}
    .ts-header::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(61,142,248,0.1),transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(139,92,246,0.08),transparent 50%);pointer-events:none}
    .ts-header-title{font-size:1.45rem;font-weight:800;background:linear-gradient(135deg,#3d8ef8,#8b5cf6,#00c8e8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:4px}
    .ts-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px}
    .ts-tab{padding:8px 16px;border-radius:30px;font-size:.82rem;font-weight:600;cursor:pointer;border:1px solid var(--glass-border);background:var(--surface);color:var(--text2);transition:all .2s;white-space:nowrap}
    .ts-tab.active,.ts-tab:hover{background:linear-gradient(135deg,rgba(61,142,248,0.18),rgba(0,200,232,0.12));border-color:rgba(61,142,248,0.35);color:var(--text)}
    .ts-section{display:none} .ts-section.active{display:block}

    /* Preset grid */
    .ts-preset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:20px}
    .ts-preset-card{border-radius:16px;border:2px solid var(--glass-border);background:var(--surface);cursor:pointer;overflow:hidden;transition:all .25s;position:relative}
    .ts-preset-card:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,0.4)}
    .ts-preset-card.active-theme{border-color:var(--accent);box-shadow:0 0 0 3px rgba(61,142,248,0.2)}
    .ts-preset-thumb{height:72px;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
    .ts-preset-thumb-icon{font-size:1.8rem;z-index:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.4))}
    .ts-preset-info{padding:10px 12px}
    .ts-preset-name{font-size:.82rem;font-weight:700;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ts-preset-desc{font-size:.7rem;color:var(--text2);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .ts-preset-actions{display:flex;gap:4px;padding:0 10px 10px;flex-wrap:wrap}
    .ts-preset-dot{width:10px;height:10px;border-radius:50%;border:1px solid rgba(255,255,255,0.2)}
    .ts-active-badge{position:absolute;top:8px;right:8px;background:var(--accent);color:#fff;font-size:.62rem;font-weight:700;padding:2px 6px;border-radius:8px}

    /* Color Manager */
    .ts-color-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
    .ts-color-item{background:var(--surface);border:1px solid var(--glass-border);border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px}
    .ts-color-swatch{width:44px;height:44px;border-radius:10px;border:2px solid var(--glass-border);cursor:pointer;flex-shrink:0;position:relative;overflow:hidden}
    .ts-color-swatch input[type=color]{position:absolute;inset:-4px;width:calc(100%+8px);height:calc(100%+8px);opacity:0;cursor:pointer}
    .ts-color-label{font-size:.82rem;font-weight:600;margin-bottom:2px}
    .ts-color-hex{font-size:.73rem;color:var(--text2);font-family:monospace}

    /* Background Studio */
    .ts-bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:20px}
    .ts-bg-card{border-radius:14px;border:2px solid var(--glass-border);cursor:pointer;overflow:hidden;transition:all .2s;text-align:center;padding:16px 10px}
    .ts-bg-card:hover,.ts-bg-card.active{border-color:var(--accent);background:rgba(61,142,248,0.08)}
    .ts-bg-card-icon{font-size:1.5rem;margin-bottom:6px}
    .ts-bg-card-name{font-size:.77rem;font-weight:600}

    /* Animation Studio */
    .ts-anim-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px}
    .ts-anim-card{border-radius:14px;border:2px solid var(--glass-border);background:var(--surface);cursor:pointer;padding:16px;text-align:center;transition:all .2s}
    .ts-anim-card:hover,.ts-anim-card.active{border-color:var(--accent);background:rgba(61,142,248,0.08)}
    .ts-anim-preview{height:40px;display:flex;align-items:center;justify-content:center;margin-bottom:8px}
    .ts-anim-dot{width:16px;height:16px;border-radius:50%;background:var(--accent)}

    /* Typography */
    .ts-font-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px}
    .ts-font-card{border-radius:14px;border:2px solid var(--glass-border);background:var(--surface);cursor:pointer;padding:16px;text-align:center;transition:all .2s}
    .ts-font-card:hover,.ts-font-card.active{border-color:var(--accent);background:rgba(61,142,248,0.08)}
    .ts-font-preview{font-size:1.3rem;font-weight:700;margin-bottom:6px;white-space:nowrap;overflow:hidden}
    .ts-font-name{font-size:.75rem;color:var(--text2)}

    /* UI Styles */
    .ts-ui-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px}
    .ts-ui-card{border-radius:14px;border:2px solid var(--glass-border);background:var(--surface);cursor:pointer;padding:18px 14px;text-align:center;transition:all .2s}
    .ts-ui-card:hover,.ts-ui-card.active{border-color:var(--accent);background:rgba(61,142,248,0.08)}

    /* Live Preview */
    .ts-preview-frame{border-radius:18px;border:1px solid var(--glass-border);overflow:hidden;background:var(--bg2);margin-bottom:20px}
    .ts-preview-tabs{display:flex;gap:4px;padding:12px 16px 0;flex-wrap:wrap}
    .ts-preview-tab{padding:5px 12px;border-radius:8px 8px 0 0;font-size:.77rem;font-weight:600;cursor:pointer;background:var(--surface);border:1px solid var(--glass-border);border-bottom:none;color:var(--text2)}
    .ts-preview-tab.active{background:var(--bg2);color:var(--text);border-color:var(--accent) var(--glass-border) var(--bg2)}
    .ts-preview-area{padding:20px;min-height:200px}
    .ts-preview-navbar{border-radius:10px;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .ts-preview-hero{border-radius:14px;padding:28px 24px;text-align:center;margin-bottom:16px}
    .ts-preview-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .ts-preview-card{border-radius:10px;padding:14px;border:1px solid}
    .ts-preview-btn{display:inline-block;padding:8px 20px;border-radius:8px;font-size:.8rem;font-weight:700;margin:4px}

    /* Custom Builder */
    .ts-builder-form{background:var(--surface);border:1px solid var(--glass-border);border-radius:16px;padding:20px;margin-bottom:16px}
    .ts-builder-title{font-weight:700;font-size:.95rem;margin-bottom:16px;color:var(--accent)}
    .ts-builder-colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:12px}
    .ts-col-wrap{display:flex;flex-direction:column;gap:4px}
    .ts-col-wrap label{font-size:.75rem;color:var(--text2)}
    .ts-col-swatch{width:100%;height:36px;border-radius:8px;border:1px solid var(--glass-border);cursor:pointer;overflow:hidden;position:relative}
    .ts-col-swatch input[type=color]{position:absolute;inset:-4px;width:calc(100%+8px);height:calc(100%+8px);opacity:0;cursor:pointer}

    /* Action bar */
    .ts-action-bar{display:flex;gap:8px;flex-wrap:wrap;padding:16px;background:var(--surface);border:1px solid var(--glass-border);border-radius:16px;align-items:center}
  </style>

  <!-- Header -->
  <div class="ts-header">
    <div class="ts-header-title">🎨 Theme Studio Pro</div>
    <div style="color:var(--text2);font-size:.85rem;margin-bottom:16px">20 built-in themes · Unlimited custom themes · One-click site-wide apply</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span style="padding:4px 10px;border-radius:20px;background:rgba(61,142,248,0.15);font-size:.75rem;font-weight:600;color:var(--accent)">🔵 theme_presets</span>
      <span style="padding:4px 10px;border-radius:20px;background:rgba(0,200,232,0.12);font-size:.75rem;font-weight:600;color:var(--accent2)">🎨 theme_customizations</span>
      <span style="padding:4px 10px;border-radius:20px;background:rgba(245,158,11,0.12);font-size:.75rem;font-weight:600;color:var(--gold)">⚙ site_settings</span>
      ${active ? `<span style="padding:4px 10px;border-radius:20px;background:rgba(16,217,142,0.12);font-size:.75rem;font-weight:600;color:var(--success)">✅ Active: ${active.icon||''} ${active.name}</span>` : ''}
    </div>
  </div>

  <!-- Tab Nav -->
  <div class="ts-tabs">
    ${[
      ['presets',   '🔥 Presets (20)'],
      ['colors',    '🌈 Colors'],
      ['background','🖼 Background'],
      ['animations','✨ Animations'],
      ['typography','🔤 Typography'],
      ['uistyles',  '🧩 UI Styles'],
      ['builder',   '🎨 Custom Builder'],
      ['preview',   '📱 Live Preview'],
      ['general',   '⚙ General'],
    ].map(([id,lbl]) => `<div class="ts-tab ${_tsActiveTab===id?'active':''}" onclick="tsTab('${id}')">${lbl}</div>`).join('')}
  </div>

  <!-- PRESETS SECTION -->
  <div id="ts-sec-presets" class="ts-section ${_tsActiveTab==='presets'?'active':''}">
    <div style="font-size:.85rem;color:var(--text2);margin-bottom:16px">Click any preset to preview · Apply to instantly update your entire site</div>
    <div class="ts-preset-grid" id="tsPresetGrid">
      ${[...TS_BUILTIN_PRESETS, ...tsGetCustomPresets()].map(t => tsPresetCardHTML(t, active)).join('')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button class="btn btn-secondary btn-sm" onclick="tsImportTheme()">📥 Import JSON</button>
      <button class="btn btn-ghost btn-sm" onclick="tsTab('builder')">➕ Create Custom Theme</button>
    </div>
  </div>

  <!-- COLORS SECTION -->
  <div id="ts-sec-colors" class="ts-section ${_tsActiveTab==='colors'?'active':''}">
    <div class="mod-form-wrap" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px">🌈 Color Manager — 10 Site Colors</div>
      <div class="ts-color-grid" id="tsColorGrid">
        ${[
          ['Primary',    'primary',   active?.primary    || '#3d8ef8'],
          ['Secondary',  'secondary', active?.secondary  || '#00c8e8'],
          ['Accent',     'accent',    active?.accent     || '#f59e0b'],
          ['Background', 'bg',        active?.bg         || '#080c14'],
          ['Navbar',     'navbar',    active?.navbar?.replace(/rgba?\([^)]+\)/,'') || '#080c14'],
          ['Card',       'card',      '#0d1220'],
          ['Border',     'border',    '#1a2540'],
          ['Button',     'btn',       active?.primary    || '#3d8ef8'],
          ['Text',       'text',      active?.text       || '#eef2ff'],
          ['Footer',     'footer',    '#080c14'],
        ].map(([lbl,key,val]) => `
          <div class="ts-color-item">
            <div class="ts-color-swatch" id="tsSwatchBg_${key}" style="background:${val}">
              <input type="color" value="${val}" oninput="tsSwatchChange('${key}',this.value)" />
            </div>
            <div>
              <div class="ts-color-label">${lbl}</div>
              <div class="ts-color-hex" id="tsHex_${key}">${val}</div>
            </div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <button class="btn btn-primary btn-sm" onclick="tsApplyColorCustomizations()">✅ Apply Colors</button>
        <button class="btn btn-ghost btn-sm" onclick="tsResetColors()">↺ Reset to Theme</button>
      </div>
    </div>
  </div>

  <!-- BACKGROUND SECTION -->
  <div id="ts-sec-background" class="ts-section ${_tsActiveTab==='background'?'active':''}">
    <div class="mod-form-wrap" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px">🖼 Background Studio</div>
      <div class="ts-bg-grid">
        ${[
          ['solid',     '⬛', 'Solid'],
          ['gradient',  '🌈', 'Gradient'],
          ['mesh',      '🕸', 'Mesh'],
          ['aurora',    '🌌', 'Aurora'],
          ['particles', '✨', 'Particles'],
          ['glass',     '🪟', 'Glass'],
          ['image',     '🖼', 'Image Upload'],
          ['video',     '🎬', 'Video BG'],
        ].map(([id,icon,name]) => `
          <div class="ts-bg-card ${(active?.bgStyle||'solid')===id?'active':''}" onclick="tsBgSelect('${id}',this)">
            <div class="ts-bg-card-icon">${icon}</div>
            <div class="ts-bg-card-name">${name}</div>
          </div>`).join('')}
      </div>
      <div id="tsBgOptions" style="margin-top:12px"></div>
    </div>
    <div class="mod-form-wrap">
      <div style="font-weight:700;margin-bottom:14px">🎨 Gradient Builder</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Color Stop 1</label><input class="form-input" type="color" value="#3d8ef8" id="tsGrad1" oninput="tsGradPreview()"/></div>
        <div class="form-group"><label class="form-label">Color Stop 2</label><input class="form-input" type="color" value="#8b5cf6" id="tsGrad2" oninput="tsGradPreview()"/></div>
        <div class="form-group"><label class="form-label">Angle</label><input class="form-input" type="range" min="0" max="360" value="135" id="tsGradAngle" oninput="tsGradPreview()"/></div>
      </div>
      <div id="tsGradPreviewBox" style="height:60px;border-radius:12px;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);margin:10px 0;transition:background .3s"></div>
      <button class="btn btn-primary btn-sm" onclick="tsApplyGradient()">🎨 Apply Gradient Background</button>
    </div>
  </div>

  <!-- ANIMATIONS SECTION -->
  <div id="ts-sec-animations" class="ts-section ${_tsActiveTab==='animations'?'active':''}">
    <div class="mod-form-wrap" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px">✨ Animation Studio</div>
      <div class="ts-anim-grid">
        ${[
          ['glow',     '💫', 'Glow',     'Neon glow pulses'],
          ['hover',    '🎯', 'Hover',    'Scale on hover'],
          ['floating', '🎈', 'Floating', 'Float up/down'],
          ['fade',     '🌫', 'Fade',     'Smooth fades'],
          ['scroll',   '📜', 'Scroll Reveal','Reveal on scroll'],
          ['bounce',   '⚡', 'Bounce',   'Springy bounce'],
          ['slide',    '➡️', 'Slide',    'Slide in panels'],
          ['none',     '⛔', 'None',     'Disable all'],
        ].map(([id,icon,name,desc]) => `
          <div class="ts-anim-card ${(active?.anim||'glow')===id?'active':''}" onclick="tsAnimSelect('${id}',this)">
            <div class="ts-anim-preview">${icon}</div>
            <div style="font-size:.82rem;font-weight:700;margin-bottom:3px">${name}</div>
            <div style="font-size:.7rem;color:var(--text2)">${desc}</div>
          </div>`).join('')}
      </div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Animation Speed</label>
          <select class="form-input" id="tsAnimSpeed">
            <option value="0.5s">Fast (0.5s)</option>
            <option value="0.8s" selected>Normal (0.8s)</option>
            <option value="1.2s">Slow (1.2s)</option>
            <option value="2s">Very Slow (2s)</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Motion Presets</label>
          <select class="form-input" id="tsMotionPreset">
            <option>Luxury Ease</option>
            <option>Spring Bounce</option>
            <option>Snappy</option>
            <option>Linear</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Animation settings applied!','success')">✨ Apply Animations</button>
    </div>
  </div>

  <!-- TYPOGRAPHY SECTION -->
  <div id="ts-sec-typography" class="ts-section ${_tsActiveTab==='typography'?'active':''}">
    <div class="mod-form-wrap" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px">🔤 Typography Studio</div>
      <div class="ts-font-grid">
        ${[
          ['Inter',          'Inter, system-ui, sans-serif',          'Modern · Clean'],
          ['Playfair Display','Playfair Display, Georgia, serif',      'Elegant · Serif'],
          ['DM Sans',        'DM Sans, Inter, sans-serif',            'Friendly · Round'],
          ['Poppins',        'Poppins, Inter, sans-serif',            'Geometric · Soft'],
          ['Space Grotesk',  'Space Grotesk, Inter, sans-serif',      'Tech · Editorial'],
          ['Sora',           'Sora, Inter, sans-serif',               'Futuristic · Bold'],
        ].map(([name,family,desc]) => `
          <div class="ts-font-card ${(active?.font||'Inter')===name?'active':''}" onclick="tsFontSelect('${name}',this)">
            <div class="ts-font-preview" style="font-family:${family}">${name}</div>
            <div class="ts-font-name">${desc}</div>
          </div>`).join('')}
      </div>
      <div class="admin-form-grid" style="margin-top:8px">
        <div class="form-group"><label class="form-label">Body Size</label>
          <select class="form-input"><option>14px</option><option selected>16px</option><option>18px</option></select>
        </div>
        <div class="form-group"><label class="form-label">Heading Weight</label>
          <select class="form-input"><option>600</option><option selected>700</option><option>800</option><option>900</option></select>
        </div>
        <div class="form-group"><label class="form-label">Letter Spacing</label>
          <select class="form-input"><option>-0.02em</option><option selected>0em</option><option>0.02em</option><option>0.05em</option></select>
        </div>
        <div class="form-group"><label class="form-label">Line Height</label>
          <select class="form-input"><option>1.4</option><option selected>1.6</option><option>1.8</option></select>
        </div>
      </div>
      <div class="form-group" style="margin-top:10px">
        <label class="form-label">Google Fonts Import URL</label>
        <input class="form-input" placeholder="https://fonts.googleapis.com/css2?family=..."/>
      </div>
      <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Typography saved!','success')">💾 Apply Typography</button>
    </div>
  </div>

  <!-- UI STYLES SECTION -->
  <div id="ts-sec-uistyles" class="ts-section ${_tsActiveTab==='uistyles'?'active':''}">
    <div class="mod-form-wrap" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px">🧩 UI Style System</div>
      <div class="ts-ui-grid">
        ${[
          ['glassmorphism','🪟','Glassmorphism','Frosted glass cards, blur effects'],
          ['neumorphism',  '🌊','Neumorphism',  'Soft extruded 3D shadows'],
          ['apple',        '🍎','Apple UI',      'Ultra-clean minimal clarity'],
          ['netflix',      '🎬','Netflix UI',    'Bold content-first dark'],
          ['stripe',       '💳','Stripe SaaS',  'Professional indigo, crisp'],
          ['modern',       '⚡','Modern SaaS',  'Utility-first sharp corners'],
          ['luxury',       '👑','Luxury Dark',  'Gold & dark premium feel'],
        ].map(([id,icon,name,desc]) => `
          <div class="ts-ui-card ${(active?.uiStyle||'glassmorphism')===id?'active':''}" onclick="tsUISelect('${id}',this)">
            <div style="font-size:1.6rem;margin-bottom:8px">${icon}</div>
            <div style="font-size:.83rem;font-weight:700;margin-bottom:3px">${name}</div>
            <div style="font-size:.7rem;color:var(--text2)">${desc}</div>
          </div>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" onclick="showToast('UI Style applied site-wide!','success')">🧩 Apply UI Style</button>
    </div>
    <div class="mod-form-wrap">
      <div style="font-weight:700;margin-bottom:14px">🎛 Fine-tune</div>
      <div class="admin-form-grid">
        <div class="form-group"><label class="form-label">Border Radius</label>
          <select class="form-input"><option>4px Flat</option><option>8px Subtle</option><option selected>14px Rounded</option><option>22px Pill</option></select>
        </div>
        <div class="form-group"><label class="form-label">Glass Blur</label>
          <select class="form-input"><option>4px</option><option selected>12px</option><option>24px</option><option>40px</option></select>
        </div>
        <div class="form-group"><label class="form-label">Shadow Depth</label>
          <select class="form-input"><option>None</option><option>Subtle</option><option selected>Medium</option><option>Heavy</option></select>
        </div>
        <div class="form-group"><label class="form-label">Card Opacity</label>
          <input class="form-input" type="range" min="0" max="20" value="3" step="1"/>
        </div>
      </div>
    </div>
  </div>

  <!-- CUSTOM BUILDER SECTION -->
  <div id="ts-sec-builder" class="ts-section ${_tsActiveTab==='builder'?'active':''}">
    <div class="ts-builder-form">
      <div class="ts-builder-title">🎨 Custom Theme Builder</div>

      <div class="admin-form-grid" style="margin-bottom:14px">
        <div class="form-group"><label class="form-label">Theme Name</label><input class="form-input" id="tbName" placeholder="My Custom Theme"/></div>
        <div class="form-group"><label class="form-label">Theme Icon</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="tbIconPicker">
            ${['🔵','👑','⚡','🌌','💎','🟢','🔴','❄️','🍎','🎬','🚀','🌈','🎯','💫','🌊','⭐'].map(ic =>
              `<span onclick="tsPickIcon('${ic}')" style="font-size:1.2rem;cursor:pointer;padding:4px;border-radius:8px;border:2px solid transparent;transition:all .2s" class="ts-icon-opt">${ic}</span>`
            ).join('')}
          </div>
          <input class="form-input" id="tbIcon" value="🎨" style="margin-top:8px;width:80px" maxlength="4"/>
        </div>
        <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="tbDesc" placeholder="A beautiful custom theme…"/></div>
        <div class="form-group"><label class="form-label">Base Style</label>
          <select class="form-input" id="tbStyle">
            <option value="glassmorphism">Glassmorphism</option>
            <option value="apple">Apple UI</option>
            <option value="luxury">Luxury Dark</option>
            <option value="modern">Modern SaaS</option>
          </select>
        </div>
      </div>

      <div style="font-size:.82rem;font-weight:700;margin-bottom:10px;color:var(--text2)">🎨 Theme Colors</div>
      <div class="ts-builder-colors">
        ${[
          ['Primary',    'tbPrimary',   '#3d8ef8'],
          ['Secondary',  'tbSecondary', '#00c8e8'],
          ['Accent',     'tbAccent',    '#f59e0b'],
          ['Background', 'tbBg',        '#080c14'],
          ['Background 2','tbBg2',      '#0d1220'],
          ['Text',       'tbText',      '#eef2ff'],
        ].map(([lbl,id,val]) => `
          <div class="ts-col-wrap">
            <label>${lbl}</label>
            <div class="ts-col-swatch" id="${id}Swatch" style="background:${val}">
              <input type="color" id="${id}" value="${val}" oninput="document.getElementById('${id}Swatch').style.background=this.value"/>
            </div>
          </div>`).join('')}
      </div>

      <div class="admin-form-grid" style="margin-top:12px">
        <div class="form-group"><label class="form-label">Font</label>
          <select class="form-input" id="tbFont">
            <option>Inter</option><option>Playfair Display</option><option>DM Sans</option><option>Poppins</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Background Style</label>
          <select class="form-input" id="tbBgStyle">
            <option value="solid">Solid</option><option value="gradient">Gradient</option>
            <option value="mesh">Mesh</option><option value="aurora">Aurora</option><option value="glass">Glass</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Animation</label>
          <select class="form-input" id="tbAnim">
            <option value="glow">Glow</option><option value="hover">Hover</option>
            <option value="floating">Floating</option><option value="fade">Fade</option><option value="none">None</option>
          </select>
        </div>
      </div>

      <!-- Live mini preview -->
      <div style="margin-top:16px;margin-bottom:16px">
        <div style="font-size:.82rem;font-weight:700;margin-bottom:8px;color:var(--text2)">👁 Builder Preview</div>
        <div id="tbMiniPreview" style="border-radius:14px;padding:20px;border:1px solid var(--glass-border);background:var(--surface);transition:all .4s">
          <div style="font-weight:800;font-size:1.1rem;margin-bottom:8px" id="tbPreviewTitle">My Custom Theme</div>
          <div style="font-size:.8rem;opacity:.6;margin-bottom:14px" id="tbPreviewDesc">Preview of your theme…</div>
          <div style="display:flex;gap:8px">
            <div id="tbPreviewBtn" style="padding:8px 18px;border-radius:8px;font-size:.8rem;font-weight:700;color:#fff;background:#3d8ef8;cursor:pointer">Browse PDFs</div>
            <div id="tbPreviewCard" style="padding:8px 16px;border-radius:8px;font-size:.8rem;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04)">PDF Card</div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="tsSaveCustomTheme()">💾 Save Theme</button>
        <button class="btn btn-secondary btn-sm" onclick="tsPreviewCustomTheme()">👁 Preview</button>
        <button class="btn btn-ghost btn-sm" onclick="tsClearBuilder()">🗑 Clear</button>
      </div>
    </div>

    <!-- Saved Custom Themes -->
    <div class="ts-builder-form">
      <div class="ts-builder-title">📦 My Custom Themes (${tsGetCustomPresets().length})</div>
      <div id="tsCustomList">
        ${tsGetCustomPresets().length === 0
          ? '<div style="text-align:center;padding:30px;color:var(--text2)">No custom themes yet. Create one above!</div>'
          : tsGetCustomPresets().map(t => tsCustomThemeRow(t)).join('')}
      </div>
    </div>
  </div>

  <!-- LIVE PREVIEW SECTION -->
  <div id="ts-sec-preview" class="ts-section ${_tsActiveTab==='preview'?'active':''}">
    <div class="ts-preview-frame">
      <div class="ts-preview-tabs">
        ${['Navbar','Hero','PDF Cards','Buttons','Footer'].map((n,i) =>
          `<div class="ts-preview-tab ${i===0?'active':''}" onclick="tsPreviewTab('${n}',this)">${n}</div>`
        ).join('')}
      </div>
      <div class="ts-preview-area" id="tsPreviewArea">
        ${tsRenderPreviewNavbar()}
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="tsSyncAllPages()">🚀 Apply to All Pages</button>
      <button class="btn btn-ghost btn-sm" onclick="tsResetTheme();showToast('Theme reset to defaults.','info')">↺ Reset Theme</button>
    </div>
  </div>

  <!-- GENERAL SETTINGS SECTION — rendered by website-customization.js -->
  <div id="ts-sec-general" class="ts-section ${_tsActiveTab==='general'?'active':''}">
    ${wcRenderGeneralSection()}
  </div>`;

  // Init builder live preview
  setTimeout(() => tsBuilderLivePreview(), 50);
}

// ── Tab switch ────────────────────────────────────────────────
function tsTab(id) {
  _tsActiveTab = id;
  document.querySelectorAll('.ts-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ts-section').forEach(s => s.classList.remove('active'));
  const tabEl = document.querySelector(`.ts-tab[onclick="tsTab('${id}')"]`);
  if (tabEl) tabEl.classList.add('active');
  const sec = document.getElementById('ts-sec-' + id);
  if (sec) sec.classList.add('active');
}

// ── Preset card HTML ──────────────────────────────────────────
function tsPresetCardHTML(t, active) {
  const isActive = active && active.id === t.id;
  const stops = `${t.primary},${t.secondary}`;
  return `
  <div class="ts-preset-card ${isActive?'active-theme':''}" title="${t.desc}">
    ${isActive ? '<div class="ts-active-badge">✓ Active</div>' : ''}
    <div class="ts-preset-thumb" style="background:linear-gradient(135deg,${stops})">
      <div class="ts-preset-thumb-icon">${t.icon||'🎨'}</div>
    </div>
    <div class="ts-preset-info">
      <div class="ts-preset-name">${t.name}</div>
      <div class="ts-preset-desc">${t.desc}</div>
      <div style="display:flex;gap:4px;margin-top:6px">
        <div class="ts-preset-dot" style="background:${t.primary}"></div>
        <div class="ts-preset-dot" style="background:${t.secondary}"></div>
        <div class="ts-preset-dot" style="background:${t.accent}"></div>
        <div class="ts-preset-dot" style="background:${t.bg}"></div>
      </div>
    </div>
    <div class="ts-preset-actions">
      <button class="btn btn-primary btn-sm" style="flex:1;font-size:.72rem" onclick="tsApplyPreset('${t.id}')">✅ Apply</button>
      <button class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:5px 8px" onclick="tsExportTheme(tsGetPresetById('${t.id}'))" title="Export">📤</button>
      ${t.id.startsWith('custom-') ? `<button class="btn btn-danger btn-sm" style="font-size:.72rem;padding:5px 8px" onclick="tsDeleteCustomPreset('${t.id}')" title="Delete">🗑</button>` : ''}
    </div>
  </div>`;
}

function tsGetPresetById(id) {
  return [...TS_BUILTIN_PRESETS, ...tsGetCustomPresets()].find(t => t.id === id) || TS_BUILTIN_PRESETS[0];
}

// ── Apply preset ──────────────────────────────────────────────
function tsApplyPreset(id) {
  const t = tsGetPresetById(id);
  tsApplyTheme(t);
  logAdminActivity(`Applied theme: ${t.name}`, 'blue');
  showToast(`✅ Theme "${t.name}" applied site-wide!`, 'success');
  // Re-render to update active badges
  renderPCCCustomization(document.getElementById('adminMain'));
}

// ── Color manager ─────────────────────────────────────────────
function tsSwatchChange(key, val) {
  const sw = document.getElementById('tsSwatchBg_' + key);
  if (sw) sw.style.background = val;
  const hex = document.getElementById('tsHex_' + key);
  if (hex) hex.textContent = val;
}

function tsApplyColorCustomizations() {
  const map = {
    primary:   '--accent',
    secondary: '--accent2',
    accent:    '--accent3',
    bg:        '--bg',
    text:      '--text',
  };
  const r = document.documentElement.style;
  Object.entries(map).forEach(([key, cssVar]) => {
    const swatch = document.getElementById('tsSwatchBg_' + key);
    if (swatch) {
      const val = swatch.querySelector('input')?.value;
      if (val) r.setProperty(cssVar, val);
    }
  });
  showToast('Colors applied!', 'success');
  logAdminActivity('Custom colors applied from Color Manager', 'blue');
}

function tsResetColors() {
  const active = tsGetActiveTheme();
  if (active) { tsApplyTheme(active); showToast('Colors reset to active theme.', 'info'); }
  else { tsResetTheme(); showToast('Colors reset to defaults.', 'info'); }
  renderPCCCustomization(document.getElementById('adminMain'));
}

// ── Background Studio ─────────────────────────────────────────
function tsBgSelect(id, el) {
  document.querySelectorAll('.ts-bg-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const opts = document.getElementById('tsBgOptions');
  const bgMessages = {
    solid:     () => { opts.innerHTML = '<div class="form-group"><label class="form-label">Solid Color</label><input class="form-input" type="color" value="#080c14" oninput="document.body.style.background=this.value"/></div>'; },
    gradient:  () => { opts.innerHTML = '<div style="font-size:.82rem;color:var(--text2)">Use the Gradient Builder below ↓</div>'; },
    mesh:      () => { document.documentElement.style.setProperty('--bg','#0c0e1a'); opts.innerHTML = '<div style="font-size:.82rem;color:var(--success)">Mesh gradient activated!</div>'; showToast('Mesh gradient applied!','success'); },
    aurora:    () => { opts.innerHTML = '<div style="font-size:.82rem;color:var(--accent2)">Aurora background will animate across the page.</div>'; showToast('Aurora BG activated!','success'); },
    particles: () => { opts.innerHTML = '<div style="font-size:.82rem;color:var(--text2)">Particles engine will be injected via JS on page load.</div>'; showToast('Particles BG queued!','info'); },
    glass:     () => { opts.innerHTML = '<div style="font-size:.82rem;color:var(--text2)">Glass backdrop applied. Works best with a light image background.</div>'; showToast('Glass BG applied!','success'); },
    image:     () => { opts.innerHTML = '<div class="admin-upload-zone" onclick="showToast(\'Upload background image via Supabase Storage.\',\'info\')">🖼 Upload Background Image<br/><span class="text-muted text-xs">JPG/PNG, min 1920×1080</span></div>'; },
    video:     () => { opts.innerHTML = '<div class="form-group"><label class="form-label">Video URL (MP4)</label><input class="form-input" placeholder="https://...video.mp4"/></div><button class="btn btn-primary btn-sm mt-4" onclick="showToast(\'Video background applied!\',\'success\')">🎬 Apply</button>'; },
  };
  if (bgMessages[id]) bgMessages[id]();
}

function tsGradPreview() {
  const c1 = document.getElementById('tsGrad1')?.value || '#3d8ef8';
  const c2 = document.getElementById('tsGrad2')?.value || '#8b5cf6';
  const angle = document.getElementById('tsGradAngle')?.value || '135';
  const box = document.getElementById('tsGradPreviewBox');
  if (box) box.style.background = `linear-gradient(${angle}deg,${c1},${c2})`;
}

function tsApplyGradient() {
  const c1 = document.getElementById('tsGrad1')?.value || '#3d8ef8';
  const c2 = document.getElementById('tsGrad2')?.value || '#8b5cf6';
  const angle = document.getElementById('tsGradAngle')?.value || '135';
  document.documentElement.style.setProperty('--bg', c1);
  document.documentElement.style.setProperty('--grad-hero', `linear-gradient(${angle}deg,${c1},${c2})`);
  showToast('Gradient background applied!', 'success');
}

// ── Animations ────────────────────────────────────────────────
function tsAnimSelect(id, el) {
  document.querySelectorAll('.ts-anim-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  showToast(`Animation: "${id}" selected.`, 'info');
}

// ── Typography ────────────────────────────────────────────────
function tsFontSelect(name, el) {
  document.querySelectorAll('.ts-font-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const fontMap = {
    'Inter':           "'Inter', system-ui, sans-serif",
    'Playfair Display':"'Playfair Display', Georgia, serif",
    'DM Sans':         "'DM Sans', 'Inter', sans-serif",
    'Poppins':         "'Poppins', 'Inter', sans-serif",
    'Space Grotesk':   "'Space Grotesk', 'Inter', sans-serif",
    'Sora':            "'Sora', 'Inter', sans-serif",
  };
  if (fontMap[name]) {
    document.documentElement.style.setProperty('--font-body', fontMap[name]);
    document.documentElement.style.setProperty('--font-display', fontMap[name]);
  }
  showToast(`Font "${name}" applied!`, 'success');
}

// ── UI Style ──────────────────────────────────────────────────
function tsUISelect(id, el) {
  document.querySelectorAll('.ts-ui-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  // Apply CSS variable presets per UI style
  const r = document.documentElement.style;
  const uiMap = {
    glassmorphism: { '--glass': 'rgba(255,255,255,0.055)', '--radius': '14px' },
    apple:         { '--glass': 'rgba(255,255,255,0.72)', '--radius': '12px' },
    luxury:        { '--glass': 'rgba(245,158,11,0.05)', '--radius': '16px' },
    netflix:       { '--glass': 'rgba(255,255,255,0.04)', '--radius': '4px' },
    stripe:        { '--glass': 'rgba(99,91,255,0.06)', '--radius': '8px' },
    modern:        { '--glass': 'rgba(255,255,255,0.04)', '--radius': '6px' },
    neumorphism:   { '--glass': 'rgba(255,255,255,0.08)', '--radius': '18px' },
  };
  if (uiMap[id]) Object.entries(uiMap[id]).forEach(([k,v]) => r.setProperty(k,v));
  showToast(`UI Style "${id}" applied!`, 'success');
}

// ── Custom Builder ────────────────────────────────────────────
function tsPickIcon(ic) {
  const inp = document.getElementById('tbIcon');
  if (inp) inp.value = ic;
  document.querySelectorAll('.ts-icon-opt').forEach(el => {
    el.style.borderColor = el.textContent === ic ? 'var(--accent)' : 'transparent';
    el.style.background  = el.textContent === ic ? 'rgba(61,142,248,0.15)' : '';
  });
  tsBuilderLivePreview();
}

function tsBuilderLivePreview() {
  const primary = document.getElementById('tbPrimary')?.value || '#3d8ef8';
  const bg      = document.getElementById('tbBg')?.value      || '#080c14';
  const text    = document.getElementById('tbText')?.value    || '#eef2ff';
  const name    = document.getElementById('tbName')?.value    || 'My Custom Theme';
  const desc    = document.getElementById('tbDesc')?.value    || 'Preview of your theme…';
  const prev    = document.getElementById('tbMiniPreview');
  const prevTitle = document.getElementById('tbPreviewTitle');
  const prevDesc  = document.getElementById('tbPreviewDesc');
  const prevBtn   = document.getElementById('tbPreviewBtn');
  if (!prev) return;
  prev.style.background = bg;
  prev.style.color = text;
  if (prevTitle) prevTitle.textContent = name;
  if (prevDesc)  prevDesc.textContent  = desc || 'A beautiful custom theme for Studyria.';
  if (prevBtn)   prevBtn.style.background = primary;
}

// Wire live preview to inputs
setTimeout(() => {
  ['tbPrimary','tbSecondary','tbBg','tbBg2','tbText','tbName','tbDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', tsBuilderLivePreview);
  });
}, 200);

function tsPreviewCustomTheme() {
  const t = tsBuildThemeFromForm();
  if (!t) return;
  tsApplyTheme(t);
  showToast(`👁 Previewing "${t.name}"…`, 'info');
}

function tsBuildThemeFromForm() {
  const name = document.getElementById('tbName')?.value?.trim();
  if (!name) { showToast('Please enter a theme name.', 'error'); return null; }
  return {
    id:        'custom-' + Date.now(),
    name,
    icon:       document.getElementById('tbIcon')?.value      || '🎨',
    desc:       document.getElementById('tbDesc')?.value      || '',
    primary:    document.getElementById('tbPrimary')?.value   || '#3d8ef8',
    secondary:  document.getElementById('tbSecondary')?.value || '#00c8e8',
    accent:     document.getElementById('tbAccent')?.value    || '#f59e0b',
    bg:         document.getElementById('tbBg')?.value        || '#080c14',
    bg2:        document.getElementById('tbBg2')?.value       || '#0d1220',
    text:       document.getElementById('tbText')?.value      || '#eef2ff',
    font:       document.getElementById('tbFont')?.value      || 'Inter',
    uiStyle:    document.getElementById('tbStyle')?.value     || 'glassmorphism',
    bgStyle:    document.getElementById('tbBgStyle')?.value   || 'solid',
    anim:       document.getElementById('tbAnim')?.value      || 'glow',
    navbar:     'rgba(8,12,20,0.97)',
    card:       'rgba(255,255,255,0.04)',
  };
}

function tsSaveCustomTheme() {
  const t = tsBuildThemeFromForm();
  if (!t) return;
  const customs = tsGetCustomPresets();
  // If editing existing, replace
  const idx = customs.findIndex(c => c.id === _tsEditingPreset?.id);
  if (idx >= 0) { customs[idx] = {...t, id: _tsEditingPreset.id}; }
  else { customs.push(t); }
  tsSaveCustomPresets(customs);
  tsApplyTheme(t);
  _tsEditingPreset = null;
  logAdminActivity(`Custom theme saved: "${t.name}"`, 'green');
  showToast(`✅ Theme "${t.name}" saved & applied!`, 'success');
  renderPCCCustomization(document.getElementById('adminMain'));
}

function tsClearBuilder() {
  ['tbName','tbDesc','tbIcon'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  _tsEditingPreset = null;
  tsBuilderLivePreview();
}

function tsCustomThemeRow(t) {
  return `
  <div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--glass-border);flex-wrap:wrap">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${t.primary},${t.secondary});display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">${t.icon||'🎨'}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:.88rem">${t.name}</div>
      <div style="font-size:.73rem;color:var(--text2)">${t.desc||'Custom theme'}</div>
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-primary btn-sm" onclick="tsApplyPreset('${t.id}')">✅ Apply</button>
      <button class="btn btn-ghost btn-sm" onclick="tsEditCustomPreset('${t.id}')">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="tsExportTheme(tsGetPresetById('${t.id}'))">📤</button>
      <button class="btn btn-danger btn-sm" onclick="tsDeleteCustomPreset('${t.id}')">🗑</button>
    </div>
  </div>`;
}

function tsEditCustomPreset(id) {
  const t = tsGetCustomPresets().find(c => c.id === id);
  if (!t) return;
  _tsEditingPreset = t;
  tsTab('builder');
  setTimeout(() => {
    const set = (eid, val) => { const el=document.getElementById(eid); if(el) el.value=val; };
    set('tbName', t.name); set('tbIcon', t.icon||'🎨'); set('tbDesc', t.desc||'');
    set('tbPrimary', t.primary); set('tbSecondary', t.secondary);
    set('tbAccent', t.accent); set('tbBg', t.bg); set('tbBg2', t.bg2||t.bg); set('tbText', t.text||'#eef2ff');
    set('tbFont', t.font||'Inter'); set('tbStyle', t.uiStyle||'glassmorphism');
    // Update swatch colors
    ['tbPrimary','tbSecondary','tbAccent','tbBg','tbBg2','tbText'].forEach(fid => {
      const sw = document.getElementById(fid+'Swatch');
      const inp = document.getElementById(fid);
      if (sw && inp) sw.style.background = inp.value;
    });
    tsBuilderLivePreview();
  }, 100);
}

function tsDeleteCustomPreset(id) {
  if (!confirm('Delete this custom theme?')) return;
  const customs = tsGetCustomPresets().filter(c => c.id !== id);
  tsSaveCustomPresets(customs);
  showToast('Custom theme deleted.', 'info');
  renderPCCCustomization(document.getElementById('adminMain'));
}

// ── Live Preview ──────────────────────────────────────────────
function tsPreviewTab(name, el) {
  document.querySelectorAll('.ts-preview-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const area = document.getElementById('tsPreviewArea');
  if (!area) return;
  const active = tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  const previews = {
    'Navbar':    tsRenderPreviewNavbar,
    'Hero':      tsRenderPreviewHero,
    'PDF Cards': tsRenderPreviewCards,
    'Buttons':   tsRenderPreviewButtons,
    'Footer':    tsRenderPreviewFooter,
  };
  if (previews[name]) area.innerHTML = previews[name](active);
}

function tsRenderPreviewNavbar(t) {
  t = t || tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  return `<div class="ts-preview-navbar" style="background:${t.navbar||'rgba(8,12,20,0.95)'};border:1px solid rgba(255,255,255,0.08)">
    <div style="font-weight:800;background:linear-gradient(135deg,${t.primary},${t.secondary});-webkit-background-clip:text;-webkit-text-fill-color:transparent">Studyria</div>
    <div style="display:flex;gap:14px;font-size:.83rem;color:${t.text||'#eef2ff'}">
      <span>Home</span><span>Library</span><span>Wishlist</span>
    </div>
    <div style="padding:7px 18px;border-radius:8px;background:linear-gradient(135deg,${t.primary},${t.secondary});color:#fff;font-size:.8rem;font-weight:700;cursor:pointer">Login</div>
  </div>
  <div style="font-size:.75rem;color:var(--text2);margin-top:8px;text-align:center">↑ Navbar preview with active theme</div>`;
}

function tsRenderPreviewHero(t) {
  t = t || tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  return `<div class="ts-preview-hero" style="background:linear-gradient(135deg,${t.primary}22,${t.secondary}11);border:1px solid ${t.primary}33">
    <div style="font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,${t.primary},${t.secondary});-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px">Assam's #1 PDF Study Platform</div>
    <div style="font-size:.85rem;color:${t.text||'#eef2ff'};opacity:.7;margin-bottom:16px">157+ students study smarter with Studyria</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <div style="padding:9px 22px;border-radius:10px;background:linear-gradient(135deg,${t.primary},${t.secondary});color:#fff;font-weight:700;font-size:.85rem">Browse PDFs</div>
      <div style="padding:9px 22px;border-radius:10px;border:1px solid ${t.primary};color:${t.text||'#eef2ff'};font-size:.85rem">Free Downloads</div>
    </div>
  </div>`;
}

function tsRenderPreviewCards(t) {
  t = t || tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  return `<div class="ts-preview-cards">
    ${['JEE Advanced 2025','UPSC Notes','NEET Biology'].map((title,i) => `
      <div class="ts-preview-card" style="background:${t.card||'rgba(255,255,255,0.03)'};border-color:${t.primary}22">
        <div style="height:64px;border-radius:8px;background:linear-gradient(135deg,${t.primary},${t.secondary});margin-bottom:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">📄</div>
        <div style="font-weight:700;font-size:.82rem;margin-bottom:4px;color:${t.text||'#eef2ff'}">${title}</div>
        <div style="font-size:.72rem;color:${t.secondary};margin-bottom:8px">₹${(i+1)*99}</div>
        <div style="padding:6px;border-radius:6px;background:linear-gradient(135deg,${t.primary},${t.secondary});color:#fff;font-size:.72rem;font-weight:700;text-align:center">Buy Now</div>
      </div>`).join('')}
  </div>`;
}

function tsRenderPreviewButtons(t) {
  t = t || tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:10px">
    <div class="ts-preview-btn" style="background:linear-gradient(135deg,${t.primary},${t.secondary});color:#fff">Primary</div>
    <div class="ts-preview-btn" style="border:1px solid ${t.primary};color:${t.primary}">Secondary</div>
    <div class="ts-preview-btn" style="background:${t.accent||'#f59e0b'};color:#000">Accent</div>
    <div class="ts-preview-btn" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:${t.text||'#eef2ff'}">Ghost</div>
    <div class="ts-preview-btn" style="background:#ef4444;color:#fff">Danger</div>
    <div class="ts-preview-btn" style="background:#10d98e;color:#000">Success</div>
  </div>`;
}

function tsRenderPreviewFooter(t) {
  t = t || tsGetActiveTheme() || TS_BUILTIN_PRESETS[0];
  return `<div style="background:${t.bg||'#080c14'};border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06)">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:16px">
      <div>
        <div style="font-weight:800;font-size:1rem;background:linear-gradient(135deg,${t.primary},${t.secondary});-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px">Studyria</div>
        <div style="font-size:.75rem;color:${t.text||'#eef2ff'};opacity:.5">Assam's #1 PDF Study Platform</div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        ${['Explore','Company','Legal'].map(col => `
          <div>
            <div style="font-weight:600;font-size:.78rem;color:${t.primary};margin-bottom:6px">${col}</div>
            <div style="font-size:.72rem;color:${t.text||'#eef2ff'};opacity:.5;line-height:1.8">Link 1<br>Link 2<br>Link 3</div>
          </div>`).join('')}
      </div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;font-size:.72rem;color:${t.text||'#eef2ff'};opacity:.4;text-align:center">© 2025 Studyria. All rights reserved.</div>
  </div>`;
}

// ── Sync all pages ────────────────────────────────────────────
function tsSyncAllPages() {
  const active = tsGetActiveTheme();
  if (!active) { showToast('Apply a theme first.', 'error'); return; }
  tsApplyTheme(active);
  logAdminActivity(`Theme synced site-wide: ${active.name}`, 'green');
  showToast(`🚀 "${active.name}" applied to all pages!`, 'success');
}

// ── Save general settings ─────────────────────────────────────
function tsSaveGeneral() {
  // Delegates to website-customization.js → wcSaveSettings (real Supabase save)
  if (typeof wcSaveSettings === 'function') {
    wcSaveSettings();
  } else {
    showToast('❌ website-customization.js not loaded.', 'error');
  }
}

// ── Restore active theme on page load ────────────────────────
(function _tsRestoreTheme() {
  const saved = tsGetActiveTheme();
  if (saved && saved.primary) {
    try { tsApplyTheme(saved); } catch(e) {}
  }
})();

/* ─── 5. USER MANAGEMENT PRO ─────────────────────────────────── */
function renderPCCUsersProManager(main) {
  const users = [
    {name:'Arjun Sharma',email:'arjun@example.com',plan:'Premium',status:'Active',pdfs:14,last:'2h ago'},
    {name:'Priya Verma',email:'priya@example.com',plan:'Free',status:'Active',pdfs:3,last:'1d ago'},
    {name:'Rahul Das',email:'rahul@example.com',plan:'Premium',status:'Suspended',pdfs:22,last:'3d ago'},
    {name:'Sneha Patel',email:'sneha@example.com',plan:'Free',status:'Active',pdfs:1,last:'5m ago'},
  ];
  main.innerHTML = `
  <div class="admin-section-title">👨‍🎓 User Management Pro</div>
  <div class="admin-section-sub">Complete user profiles, history, activity and moderation tools.</div>
  <div class="admin-stats-grid" style="margin-bottom:20px">
    ${adminStatCard('Total Users','18,432','12% this month',true,'blue','users')}
    ${adminStatCard('Premium Users','3,210','↑ 8%',true,'gold','star')}
    ${adminStatCard('Suspended','12','↓ 2',false,'red','shield')}
    ${adminStatCard('Online Now','247','live',true,'green','check')}
  </div>
  <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-primary btn-sm" onclick="showToast('Export users CSV — coming soon.','info')">📤 Export Users</button>
    <button class="btn btn-ghost btn-sm" onclick="showToast('Bulk email — coming soon.','info')">📧 Bulk Email</button>
    <button class="btn btn-danger btn-sm" onclick="showToast('Select users to bulk suspend.','info')">🚫 Bulk Suspend</button>
  </div>
  <div class="admin-table-card">
    <div class="admin-table-header">
      <div style="font-size:.9rem;font-weight:700">All Users</div>
      <input class="admin-table-search" placeholder="Search users…"/>
    </div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>User</th><th>Plan</th><th>PDFs Bought</th><th>Status</th><th>Last Active</th><th>Actions</th></tr></thead>
      <tbody>
        ${users.map(u => `<tr>
          <td>
            <div style="font-weight:600">${u.name}</div>
            <div style="font-size:.75rem;color:var(--text2)">${u.email}</div>
          </td>
          <td><span class="admin-nav-badge ${u.plan==='Premium'?'admin-nav-badge-orange':''}">${u.plan}</span></td>
          <td>${u.pdfs}</td>
          <td><span class="admin-nav-badge" style="${u.status==='Active'?'background:rgba(16,217,142,.1);color:var(--success);border-color:rgba(16,217,142,.2)':'background:rgba(255,77,109,.1);color:var(--danger);border-color:rgba(255,77,109,.2)'}">${u.status}</span></td>
          <td style="color:var(--text2);font-size:.8rem">${u.last}</td>
          <td style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="showToast('User profile — coming soon.','info')">👤</button>
            <button class="btn btn-ghost btn-sm" onclick="showToast('Purchase history — coming soon.','info')">🛒</button>
            <button class="btn btn-danger btn-sm" onclick="showToast('User suspended.','info')">🚫</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ─── 6. SALES & FINANCE CENTER ──────────────────────────────── */
function renderPCCFinance(main) {
  main.innerHTML = `
  <div class="admin-section-title">💰 Sales & Finance Center</div>
  <div class="admin-section-sub">Revenue analytics, refund management, invoices and export tools.</div>
  <div class="admin-stats-grid" style="margin-bottom:20px">
    ${adminStatCard('Today\'s Revenue','₹12,480','↑ 18%',true,'green','trending')}
    ${adminStatCard('This Month','₹3.2L','↑ 24%',true,'blue','trending')}
    ${adminStatCard('Pending Refunds','7','₹2,100',false,'red','x')}
    ${adminStatCard('Yearly Total','₹28.6L','↑ 31%',true,'gold','star')}
  </div>
  <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
    <button class="btn btn-primary btn-sm" onclick="showToast('Generating report…','info')">📊 Generate Report</button>
    <button class="btn btn-secondary btn-sm" onclick="showToast('Exporting CSV…','info')">📤 Export CSV</button>
    <button class="btn btn-ghost btn-sm" onclick="showToast('Invoice generator — coming soon.','info')">🧾 Invoice Generator</button>
  </div>
  <div class="admin-table-card">
    <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Recent Transactions</div></div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Order ID</th><th>User</th><th>PDF</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>
        ${[['#ORD-8821','Arjun Sharma','JEE Advanced 2024','₹199','Paid','Today 2:14pm'],
           ['#ORD-8820','Priya Verma','UPSC Prelims Notes','₹149','Paid','Today 11:02am'],
           ['#ORD-8819','Ravi Kumar','NEET Biology','₹179','Refund Req','Yesterday'],
           ['#ORD-8818','Meena Das','SSC CGL Maths','₹99','Paid','Yesterday'],
        ].map(([id,u,p,a,s,d]) => `<tr>
          <td style="font-weight:600;color:var(--accent)">${id}</td>
          <td>${u}</td><td>${p}</td><td style="font-weight:700">${a}</td>
          <td><span class="admin-nav-badge ${s==='Paid'?'':'admin-nav-badge-orange'}">${s}</span></td>
          <td style="color:var(--text2);font-size:.8rem">${d}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ─── 7. COUPONS & OFFERS ────────────────────────────────────── */
function renderPCCCoupons(main) {
  main.innerHTML = `
  <div class="admin-section-title">🎟 Coupon & Offers Manager</div>
  <div class="admin-section-sub">Create discount codes, flash sales and limited-time offers.</div>
  <div class="mod-form-wrap" style="margin-bottom:20px">
    <div style="font-weight:700;margin-bottom:14px">➕ Create New Coupon</div>
    <div class="admin-form-grid">
      <div class="form-group"><label class="form-label">Coupon Code</label><input class="form-input" placeholder="STUDY50" style="text-transform:uppercase"/></div>
      <div class="form-group"><label class="form-label">Discount Type</label>
        <select class="form-input"><option>Percentage (%)</option><option>Fixed Amount (₹)</option></select>
      </div>
      <div class="form-group"><label class="form-label">Discount Value</label><input class="form-input" placeholder="50" type="number"/></div>
      <div class="form-group"><label class="form-label">Expiry Date</label><input class="form-input" type="date"/></div>
      <div class="form-group"><label class="form-label">Usage Limit</label><input class="form-input" placeholder="100" type="number"/></div>
      <div class="form-group"><label class="form-label">Min Order (₹)</label><input class="form-input" placeholder="0" type="number"/></div>
    </div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Flash Sale Mode</div><div class="text-muted text-xs">Show countdown timer with this coupon</div></div>
      <button class="admin-toggle" onclick="this.classList.toggle('on')"></button>
    </div>
    <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Coupon STUDY50 created!','success')">🎟 Create Coupon</button>
  </div>
  <div class="admin-table-card">
    <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">Active Coupons</div></div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Limit</th><th>Expires</th><th>Actions</th></tr></thead>
      <tbody>
        ${[['STUDY50','50%','34','100','31 Dec 2025'],['EXAM2025','₹30','12','50','15 Jan 2026'],['FREEPDF','100%','5','10','20 Jun 2025']].map(([c,d,u,l,e]) => `<tr>
          <td><code style="background:rgba(61,142,248,.12);padding:3px 8px;border-radius:5px;color:var(--accent)">${c}</code></td>
          <td>${d}</td><td>${u}</td><td>${l}</td>
          <td style="color:var(--text2);font-size:.8rem">${e}</td>
          <td><button class="btn btn-danger btn-sm" onclick="showToast('Coupon deactivated.','info')">🗑 Delete</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/* ─── 8. BLOG MANAGER ────────────────────────────────────────── */
function renderPCCBlog(main) {
  main.innerHTML = `
  <style>
    .bam-toolbar { display:flex; gap:6px; flex-wrap:wrap; padding:8px; border:1px solid var(--glass-border); border-bottom:none;
      border-radius:12px 12px 0 0; background:var(--glass); }
    .bam-toolbar button { width:30px; height:30px; border-radius:7px; border:1px solid transparent; background:transparent;
      color:var(--text2); cursor:pointer; font-size:.85rem; font-weight:700; }
    .bam-toolbar button:hover { background:rgba(61,142,248,0.12); color:var(--accent); border-color:rgba(61,142,248,0.25); }
    .bam-editor { min-height:220px; max-height:420px; overflow-y:auto; padding:14px 16px; border:1px solid var(--glass-border);
      border-radius:0 0 12px 12px; background:var(--card); color:var(--text); font-size:.9rem; line-height:1.7; outline:none; }
    .bam-editor:empty:before { content: attr(data-placeholder); color: var(--text3); }
    .bam-editor h2, .bam-editor h3 { font-family:var(--font-editorial); }
    .bam-row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .bam-row .form-group { flex:1; min-width:200px; margin-bottom:0; }
    .bam-status-badge { font-size:.68rem; font-weight:700; padding:2px 9px; border-radius:20px; letter-spacing:.04em; text-transform:uppercase; }
    .bam-status-badge.published { background:rgba(16,217,142,0.12); color:var(--success); border:1px solid rgba(16,217,142,0.25); }
    .bam-status-badge.draft { background:rgba(255,255,255,0.05); color:var(--text3); border:1px solid var(--glass-border); }
  </style>

  <div class="admin-section-title">📰 Blog Manager</div>
  <div class="admin-section-sub">Publish study tips, exam guides and news articles — SEO metadata included.</div>

  <div class="ann-admin-form" style="margin-bottom:20px">
    <div class="ann-admin-form-title" id="bamFormLabel">➕ New Article</div>
    <input type="hidden" id="bamEditId" value="">

    <div class="bam-row">
      <div class="form-group">
        <label class="form-label">Title <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="bamTitle" placeholder="e.g. How to Crack JEE in 3 Months" maxlength="140" oninput="bamAutoSlug()">
      </div>
      <div class="form-group">
        <label class="form-label">URL Slug</label>
        <input class="form-input" id="bamSlug" placeholder="how-to-crack-jee-in-3-months" maxlength="90">
      </div>
    </div>

    <div class="bam-row">
      <div class="form-group">
        <label class="form-label">Category</label>
        <input class="form-input" id="bamCategory" placeholder="e.g. JEE Tips">
      </div>
      <div class="form-group">
        <label class="form-label">Tags (comma separated)</label>
        <input class="form-input" id="bamTags" placeholder="jee, physics, revision">
      </div>
      <div class="form-group">
        <label class="form-label">Cover Image URL</label>
        <input class="form-input" id="bamCover" placeholder="https://…">
      </div>
    </div>

    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Excerpt (short summary shown on cards)</label>
      <input class="form-input" id="bamExcerpt" placeholder="One or two sentences…" maxlength="220">
    </div>

    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Article Content <span style="color:var(--danger)">*</span></label>
      <div class="bam-toolbar">
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('bold')" title="Bold"><b>B</b></button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('italic')" title="Italic"><i>I</i></button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('formatBlock','H2')" title="Heading">H2</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('formatBlock','H3')" title="Subheading">H3</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('formatBlock','P')" title="Paragraph">¶</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('insertUnorderedList')" title="Bullet list">•—</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('insertOrderedList')" title="Numbered list">1.</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('formatBlock','BLOCKQUOTE')" title="Quote">❝</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamLink()" title="Insert link">🔗</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamImage()" title="Insert image">🖼</button>
        <button type="button" onmousedown="event.preventDefault()" onclick="bamCmd('removeFormat')" title="Clear formatting">✕</button>
      </div>
      <div class="bam-editor" id="bamEditor" contenteditable="true" data-placeholder="Write your article here…"></div>
    </div>

    <div class="bam-row">
      <div class="form-group">
        <label class="form-label">SEO Meta Title</label>
        <input class="form-input" id="bamMetaTitle" placeholder="Defaults to article title" maxlength="70">
      </div>
      <div class="form-group">
        <label class="form-label">SEO Meta Description</label>
        <input class="form-input" id="bamMetaDesc" placeholder="Defaults to excerpt" maxlength="160">
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--text2);cursor:pointer">
        <input type="checkbox" id="bamPublished"> Publish immediately
      </label>
      <button class="btn btn-primary btn-sm" onclick="bamSave()">💾 Save Article</button>
      <button class="btn btn-ghost btn-sm" onclick="bamCancelEdit()" id="bamCancelBtn" style="display:none">✕ Cancel Edit</button>
      <span id="bamFormMsg" style="font-size:.78rem;display:none"></span>
    </div>
  </div>

  <div class="admin-table-card">
    <div class="admin-table-header">
      <div style="font-size:.9rem;font-weight:700">All Articles</div>
      <input class="admin-table-search" placeholder="Search articles…" oninput="bamSearchList(this.value)">
    </div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>Title</th><th>Category</th><th>Views</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="bamListBody"><tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2)">⏳ Loading…</td></tr></tbody>
    </table></div>
  </div>`;

  bamLoadList();
}

/* ── BLOG ADMIN — rich text + CRUD ─────────────────────────────── */
function bamCmd(cmd, val) {
  document.getElementById('bamEditor')?.focus();
  document.execCommand(cmd, false, val || null);
}
function bamLink() {
  const url = prompt('Link URL:');
  if (url) bamCmd('createLink', url);
}
function bamImage() {
  const url = prompt('Image URL:');
  if (url) bamCmd('insertImage', url);
}
function bamAutoSlug() {
  const slugEl = document.getElementById('bamSlug');
  if (!slugEl || slugEl.dataset.touched === '1') return;
  const title = document.getElementById('bamTitle')?.value || '';
  slugEl.value = typeof _slugify === 'function' ? _slugify(title) : title.toLowerCase().replace(/\s+/g, '-');
}
(function () {
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'bamSlug') e.target.dataset.touched = '1';
  });
})();

let _bamAllPosts = [];
async function bamLoadList() {
  const tbody = document.getElementById('bamListBody');
  if (!tbody) return;
  if (!window.adminListBlogPosts) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px">Blog module not loaded.</td></tr>`; return; }
  _bamAllPosts = await window.adminListBlogPosts();
  bamRenderList(_bamAllPosts);
}
function bamRenderList(posts) {
  const tbody = document.getElementById('bamListBody');
  if (!tbody) return;
  if (!posts.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2)">📭 No articles yet — create one above.</td></tr>`; return; }
  tbody.innerHTML = posts.map(p => `<tr>
    <td style="font-weight:600">${escHtml(p.title)}</td>
    <td>${escHtml(p.category || '—')}</td>
    <td>${Number(p.view_count || 0).toLocaleString()}</td>
    <td><span class="bam-status-badge ${p.status}">${p.status}</span></td>
    <td style="display:flex;gap:5px">
      <button class="btn btn-ghost btn-sm" onclick="bamEdit('${p.id}')">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="bamDelete('${p.id}')">🗑</button>
    </td>
  </tr>`).join('');
}
function bamSearchList(q) {
  q = (q || '').toLowerCase();
  bamRenderList(!q ? _bamAllPosts : _bamAllPosts.filter(p => (p.title || '').toLowerCase().includes(q)));
}

function bamEdit(id) {
  const p = _bamAllPosts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('bamFormLabel').textContent = '✏️ Edit Article';
  document.getElementById('bamEditId').value = p.id;
  document.getElementById('bamTitle').value = p.title || '';
  const slugEl = document.getElementById('bamSlug'); slugEl.value = p.slug || ''; slugEl.dataset.touched = '1';
  document.getElementById('bamCategory').value = p.category || '';
  document.getElementById('bamTags').value = (p.tags || []).join(', ');
  document.getElementById('bamCover').value = p.cover_image || '';
  document.getElementById('bamExcerpt').value = p.excerpt || '';
  document.getElementById('bamEditor').innerHTML = p.content || '';
  document.getElementById('bamMetaTitle').value = p.meta_title || '';
  document.getElementById('bamMetaDesc').value = p.meta_description || '';
  document.getElementById('bamPublished').checked = p.status === 'published';
  document.getElementById('bamCancelBtn').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function bamCancelEdit() {
  document.getElementById('bamFormLabel').textContent = '➕ New Article';
  ['bamEditId','bamTitle','bamSlug','bamCategory','bamTags','bamCover','bamExcerpt','bamMetaTitle','bamMetaDesc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const slugEl = document.getElementById('bamSlug'); if (slugEl) slugEl.dataset.touched = '';
  const ed = document.getElementById('bamEditor'); if (ed) ed.innerHTML = '';
  document.getElementById('bamPublished').checked = false;
  document.getElementById('bamCancelBtn').style.display = 'none';
}
async function bamSave() {
  const msgEl = document.getElementById('bamFormMsg');
  const post = {
    id: document.getElementById('bamEditId').value || null,
    title: document.getElementById('bamTitle').value.trim(),
    slug: document.getElementById('bamSlug').value.trim(),
    category: document.getElementById('bamCategory').value.trim(),
    tags: document.getElementById('bamTags').value,
    cover_image: document.getElementById('bamCover').value.trim(),
    excerpt: document.getElementById('bamExcerpt').value.trim(),
    content: document.getElementById('bamEditor').innerHTML.trim(),
    meta_title: document.getElementById('bamMetaTitle').value.trim(),
    meta_description: document.getElementById('bamMetaDesc').value.trim(),
    status: document.getElementById('bamPublished').checked ? 'published' : 'draft',
  };
  if (!window.adminSaveBlogPost) { showToast('Blog module not loaded.', 'error'); return; }
  const result = await window.adminSaveBlogPost(post);
  if (!result.success) {
    if (msgEl) { msgEl.textContent = result.error; msgEl.style.color = 'var(--danger)'; msgEl.style.display = ''; }
    showToast(result.error || 'Failed to save article', 'error');
    return;
  }
  showToast(post.id ? 'Article updated!' : 'Article created!', 'success');
  if (msgEl) msgEl.style.display = 'none';
  bamCancelEdit();
  bamLoadList();
}
async function bamDelete(id) {
  if (!confirm('Delete this article? This cannot be undone.')) return;
  const result = await window.adminDeleteBlogPost(id);
  if (!result.success) { showToast(result.error || 'Delete failed', 'error'); return; }
  showToast('Article deleted.', 'success');
  bamLoadList();
}

/* ─── 9. ANNOUNCEMENT CENTER ─────────────────────────────────── */
function renderPCCAnnouncements(main) {
  main.innerHTML = `
  <style>
  .ann-admin-form { background:var(--glass); border:1px solid var(--glass-border); border-radius:16px; padding:20px 22px; margin-bottom:20px; }
  .ann-admin-form-title { font-weight:800; font-size:.95rem; color:var(--text); margin-bottom:14px; }
  .ann-admin-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px; }
  .ann-admin-row .form-group { flex:1; min-width:180px; margin-bottom:0; }
  .ann-list { display:flex; flex-direction:column; gap:10px; }
  .ann-item {
    background:var(--glass); border:1px solid var(--glass-border); border-radius:14px;
    padding:14px 16px; display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap;
    transition: border-color .2s;
  }
  .ann-item.ann-active { border-color:rgba(61,142,248,0.35); background:rgba(61,142,248,0.04); }
  .ann-item-body { flex:1; min-width:0; }
  .ann-item-title { font-weight:700; font-size:.9rem; color:var(--text); margin-bottom:3px; word-break:break-word; }
  .ann-item-msg { font-size:.8rem; color:var(--text2); line-height:1.5; word-break:break-word; }
  .ann-item-meta { font-size:.7rem; color:var(--text3); margin-top:5px; }
  .ann-item-actions { display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap; align-items:center; }
  .ann-status-badge {
    font-size:.68rem; font-weight:700; padding:2px 9px; border-radius:20px; letter-spacing:.04em; text-transform:uppercase;
  }
  .ann-status-badge.active { background:rgba(16,217,142,0.12); color:var(--success); border:1px solid rgba(16,217,142,0.25); }
  .ann-status-badge.inactive { background:rgba(255,255,255,0.05); color:var(--text3); border:1px solid var(--glass-border); }
  .ann-empty { text-align:center; padding:36px 20px; color:var(--text2); font-size:.88rem; }
  .ann-spinner { text-align:center; padding:28px; color:var(--text2); font-size:.88rem; }
  </style>

  <div class="admin-section-title">📢 Announcements</div>
  <div class="admin-section-sub">Manage dynamic announcement banners shown at the top of your site.</div>

  <!-- ADD / EDIT FORM -->
  <div class="ann-admin-form">
    <div class="ann-admin-form-title" id="annFormLabel">➕ New Announcement</div>
    <input type="hidden" id="annEditId" value=""/>
    <div class="ann-admin-row">
      <div class="form-group">
        <label class="form-label">Title <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="annFieldTitle" placeholder="e.g. New PDFs Added!" maxlength="80"/>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Message</label>
      <input class="form-input" id="annFieldMessage" placeholder="Optional extra text shown after the title…" maxlength="200"/>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary btn-sm" onclick="annSave()">💾 Save Announcement</button>
      <button class="btn btn-ghost btn-sm" onclick="annCancelEdit()" id="annCancelBtn" style="display:none">✕ Cancel Edit</button>
    </div>
  </div>

  <!-- LIST -->
  <div id="annListWrap">
    <div class="ann-spinner">⏳ Loading announcements…</div>
  </div>`;

  annLoadList();
}

/* ── ANNOUNCEMENTS CRUD ────────────────────────────────────────── */
async function annLoadList() {
  const wrap = document.getElementById('annListWrap');
  if (!wrap) return;
  const sb = window.supabaseClient;
  if (!sb) { wrap.innerHTML = '<div class="ann-empty">⚠️ Supabase not connected.</div>'; return; }

  const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) { wrap.innerHTML = `<div class="ann-empty">❌ Error: ${error.message}</div>`; return; }
  if (!data || !data.length) { wrap.innerHTML = '<div class="ann-empty">📭 No announcements yet. Add one above.</div>'; return; }

  wrap.innerHTML = `<div class="ann-list">${data.map(a => `
    <div class="ann-item ${a.active ? 'ann-active' : ''}" id="ann-row-${a.id}">
      <div class="ann-item-body">
        <div class="ann-item-title">📢 ${escHtml(a.title)}</div>
        ${a.message ? `<div class="ann-item-msg">${escHtml(a.message)}</div>` : ''}
        <div class="ann-item-meta">Created ${new Date(a.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}</div>
      </div>
      <div class="ann-item-actions">
        <span class="ann-status-badge ${a.active ? 'active' : 'inactive'}">${a.active ? '● Active' : '○ Off'}</span>
        <button class="btn btn-ghost btn-sm" onclick="annToggle('${a.id}', ${a.active})">${a.active ? '⏸ Deactivate' : '▶ Activate'}</button>
        <button class="btn btn-ghost btn-sm" onclick="annEdit('${a.id}', ${JSON.stringify(a.title).replace(/'/g,"&#39;")}, ${JSON.stringify(a.message||'').replace(/'/g,"&#39;")})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="annDelete('${a.id}')">🗑</button>
      </div>
    </div>`).join('')}</div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function annSave() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected','error'); return; }
  const id    = document.getElementById('annEditId').value.trim();
  const title = document.getElementById('annFieldTitle').value.trim();
  const msg   = document.getElementById('annFieldMessage').value.trim();
  if (!title) { showToast('Title is required','error'); return; }

  if (id) {
    // UPDATE
    const { error } = await sb.from('announcements').update({ title, message: msg }).eq('id', id);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Announcement updated ✓', 'success');
  } else {
    // INSERT (new announcements are inactive by default)
    const { error } = await sb.from('announcements').insert({ title, message: msg, active: false });
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Announcement created ✓', 'success');
  }
  annCancelEdit();
  annLoadList();
}

function annEdit(id, title, msg) {
  document.getElementById('annEditId').value = id;
  document.getElementById('annFieldTitle').value = title;
  document.getElementById('annFieldMessage').value = msg;
  document.getElementById('annFormLabel').textContent = '✏️ Edit Announcement';
  document.getElementById('annCancelBtn').style.display = '';
  document.getElementById('annFieldTitle').focus();
}

function annCancelEdit() {
  document.getElementById('annEditId').value = '';
  document.getElementById('annFieldTitle').value = '';
  document.getElementById('annFieldMessage').value = '';
  document.getElementById('annFormLabel').textContent = '➕ New Announcement';
  const cb = document.getElementById('annCancelBtn');
  if (cb) cb.style.display = 'none';
}

async function annToggle(id, currentlyActive) {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected','error'); return; }

  // If activating, deactivate all others first (only one active at a time)
  if (!currentlyActive) {
    await sb.from('announcements').update({ active: false }).neq('id', id);
  }
  const { error } = await sb.from('announcements').update({ active: !currentlyActive }).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(!currentlyActive ? '✅ Announcement activated' : 'Announcement deactivated', 'success');
  annLoadList();
  // Refresh the live bar on the page
  loadActiveAnnouncement();
}

async function annDelete(id) {
  if (!confirm('Delete this announcement?')) return;
  const sb = window.supabaseClient;
  if (!sb) return;
  const { error } = await sb.from('announcements').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Deleted', 'info');
  annLoadList();
  loadActiveAnnouncement();
}

/* ── LOAD ACTIVE ANNOUNCEMENT INTO THE BAR ─────────────────────── */
async function loadActiveAnnouncement() {
  const sb = window.supabaseClient;
  const bar = document.getElementById('announcementBar');
  if (!sb || !bar) return;

  const { data, error } = await sb
    .from('announcements')
    .select('id, title, message')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (window._alpine) window._alpine.annBarVisible = false;
    return;
  }

  // Check if user already dismissed THIS announcement
  const dismissedId = localStorage.getItem('studyria_ann_closed_id');
  if (dismissedId === String(data.id)) {
    if (window._alpine) window._alpine.annBarVisible = false;
    return;
  }

  const titleEl = document.getElementById('annTitle');
  const msgEl   = document.getElementById('annMessage');
  if (titleEl) titleEl.textContent = data.title;
  if (msgEl)   msgEl.textContent   = data.message ? ' · ' + data.message : '';
  bar.dataset.annId = data.id;

  if (window._alpine) window._alpine.annBarVisible = true;
}

/* ─── BRANDING MANAGER ───────────────────────────────────────── */
function renderPCCBranding(main) {
  main.innerHTML = `
  <style>
  .brand-admin-preview {
    position:relative; overflow:hidden; border-radius:14px;
    background:linear-gradient(100deg,#05090f 0%,#091428 30%,#0c1e4a 55%,#091428 78%,#05090f 100%);
    background-size:260% 100%; animation:brandShift 9s ease-in-out infinite;
    border:1px solid rgba(61,142,248,0.22); padding:10px 20px;
    display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap;
    margin-bottom:20px; min-height:40px;
  }
  .brand-admin-preview::before {
    content:''; position:absolute; inset:0;
    background:linear-gradient(90deg,transparent 0%,rgba(61,142,248,0.10) 40%,rgba(0,200,232,0.12) 55%,transparent 100%);
    animation:brandSweep 4s ease-in-out infinite; pointer-events:none;
  }
  .bap-title {
    font-family:var(--font-editorial); font-size:.82rem; font-weight:700; letter-spacing:.06em;
    background:linear-gradient(90deg,#a8c8ff,#3d8ef8 35%,#00c8e8 65%,#b0f0ff);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    position:relative; z-index:1; filter:drop-shadow(0 0 8px rgba(61,142,248,.35));
  }
  .bap-dot { width:3px;height:3px;border-radius:50%;background:rgba(61,142,248,.5);flex-shrink:0;position:relative;z-index:1; }
  .bap-credit {
    display:inline-flex;align-items:center;gap:5px;padding:2px 11px 2px 8px;border-radius:20px;
    background:rgba(255,255,255,0.04);border:1px solid rgba(61,142,248,0.22);
    font-size:.68rem;font-weight:600;color:rgba(255,255,255,.62);letter-spacing:.05em;
    position:relative;z-index:1;
  }
  .bap-credit-name { background:linear-gradient(90deg,#3d8ef8,#00c8e8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700; }
  .brand-admin-form { background:var(--glass);border:1px solid var(--glass-border);border-radius:16px;padding:20px 22px;margin-bottom:16px; }
  .brand-admin-form-title { font-weight:800;font-size:.95rem;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px; }
  .brand-status-row { display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--glass-border);margin-top:12px; }
  .brand-status-label { font-size:.85rem;font-weight:600;color:var(--text); }
  .brand-status-sub { font-size:.72rem;color:var(--text2);margin-top:2px; }
  </style>

  <div class="admin-section-title">🎨 Branding Manager</div>
  <div class="admin-section-sub">Control the premium banner shown at the top of every page.</div>

  <!-- Live Preview -->
  <div style="font-size:.72rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Live Preview</div>
  <div class="brand-admin-preview" id="brandPreviewBox">
    <div class="bap-title" id="brandPreviewTitle">🎓 Assam's Smart Education Platform</div>
    <div class="bap-dot"></div>
    <div class="bap-credit">
      <span>Crafted with</span> <span>❤️</span> <span>by</span>
      <span class="bap-credit-name" id="brandPreviewSubtitle">PKD</span>
    </div>
  </div>

  <!-- Edit Form -->
  <div class="brand-admin-form">
    <div class="brand-admin-form-title">✏️ Edit Branding</div>

    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Banner Title <span style="color:var(--danger)">*</span></label>
      <input class="form-input" id="brandFieldTitle" placeholder="🎓 Assam's Smart Education Platform" maxlength="100"
        oninput="document.getElementById('brandPreviewTitle').textContent=this.value||'…'"/>
    </div>

    <div class="form-group" style="margin-bottom:4px">
      <label class="form-label">Credit Name <span style="color:var(--text2);font-weight:400">(shown after "Crafted with ❤️ by")</span></label>
      <input class="form-input" id="brandFieldSubtitle" placeholder="PKD" maxlength="60"
        oninput="document.getElementById('brandPreviewSubtitle').textContent=this.value||'PKD'"/>
    </div>

    <div class="brand-status-row">
      <div>
        <div class="brand-status-label">Show Banner</div>
        <div class="brand-status-sub">Hide to remove the banner from the site entirely</div>
      </div>
      <button class="admin-toggle on" id="brandToggleBtn" onclick="this.classList.toggle('on')"></button>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
      <button class="btn btn-primary btn-sm" onclick="brandSave()">💾 Save &amp; Publish</button>
      <button class="btn btn-ghost btn-sm" onclick="brandLoadIntoForm()">↺ Reset to Saved</button>
    </div>
    <div id="brandSaveMsg" style="display:none;margin-top:10px;font-size:.8rem;color:var(--success);font-weight:600"></div>
  </div>`;

  brandLoadIntoForm();
}

/* load current DB values into the edit form */
async function brandLoadIntoForm() {
  const sb = window.supabaseClient;
  if (!sb) return;
  const { data } = await sb.from('site_branding').select('*').eq('id', 1).maybeSingle();
  if (!data) return;

  const tf = document.getElementById('brandFieldTitle');
  const sf = document.getElementById('brandFieldSubtitle');
  const tb = document.getElementById('brandToggleBtn');
  const pt = document.getElementById('brandPreviewTitle');
  const ps = document.getElementById('brandPreviewSubtitle');
  const pb = document.getElementById('brandPreviewBox');

  if (tf) tf.value = data.title || '';
  if (sf) sf.value = data.subtitle || '';
  if (tb) { tb.classList.toggle('on', !!data.active); }
  if (pt) pt.textContent = data.title || '…';
  if (ps) ps.textContent = data.subtitle || 'PKD';
  if (pb) pb.style.display = data.active ? '' : 'none';
}

async function brandSave() {
  const sb = window.supabaseClient;
  if (!sb) { showToast('Supabase not connected', 'error'); return; }

  const title    = (document.getElementById('brandFieldTitle')?.value || '').trim();
  const subtitle = (document.getElementById('brandFieldSubtitle')?.value || '').trim();
  const active   = document.getElementById('brandToggleBtn')?.classList.contains('on') ?? true;
  const msgEl    = document.getElementById('brandSaveMsg');

  if (!title) { showToast('Title is required', 'error'); return; }

  const { error } = await sb.from('site_branding').upsert({ id: 1, title, subtitle, active }, { onConflict: 'id' });
  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  showToast('Branding saved ✓', 'success');
  if (msgEl) { msgEl.textContent = '✅ Saved! Changes are now live on the homepage.'; msgEl.style.display = ''; setTimeout(() => { msgEl.style.display = 'none'; }, 4000); }

  // Update the live banner immediately
  loadBrandingFromDB();
}

/* ── LOAD BRANDING INTO THE LIVE BANNER ────────────────────────── */
async function loadBrandingFromDB() {
  const sb = window.supabaseClient;
  const banner = document.getElementById('topBanner');
  if (!sb || !banner) return;

  const { data, error } = await sb.from('site_branding').select('title, subtitle, active').eq('id', 1).maybeSingle();

  if (error || !data) return; // keep static defaults on error

  const titleEl    = document.getElementById('brandTitle');
  const subtitleEl = document.getElementById('brandSubtitle');

  if (titleEl && data.title)    titleEl.textContent    = data.title;
  if (subtitleEl && data.subtitle) subtitleEl.textContent = data.subtitle;

  // Show/hide the whole banner based on active flag
  banner.style.display = data.active === false ? 'none' : '';
}

/* ─── 10. TESTIMONIALS ───────────────────────────────────────── */
function renderPCCTestimonials(main) {
  const reviews = [
    {name:'Arjun Sharma',text:'Studyria helped me crack JEE Advanced. Best PDF platform!',rating:5,featured:true},
    {name:'Priya Verma',text:'All UPSC materials in one place. Saved so much time.',rating:5,featured:false},
    {name:'Rahul Das',text:'Affordable and high quality. Worth every rupee.',rating:4,featured:true},
  ];
  main.innerHTML = `
  <div class="admin-section-title">⭐ Testimonial Manager</div>
  <div class="admin-section-sub">Manage student reviews displayed on the homepage.</div>
  <div class="mod-form-wrap" style="margin-bottom:20px">
    <div style="font-weight:700;margin-bottom:14px">➕ Add Review</div>
    <div class="admin-form-grid">
      <div class="form-group"><label class="form-label">Student Name</label><input class="form-input" placeholder="Arjun Sharma"/></div>
      <div class="form-group"><label class="form-label">Rating</label><select class="form-input"><option>⭐⭐⭐⭐⭐</option><option>⭐⭐⭐⭐</option><option>⭐⭐⭐</option></select></div>
    </div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Review Text</label><textarea class="form-input" rows="2" placeholder="Write the student's review…"></textarea></div>
    <button class="btn btn-primary btn-sm mt-4" onclick="showToast('Review added!','success')">⭐ Add Review</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${reviews.map(r => `
      <div class="mod-form-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700">${r.name}</div>
            <div style="color:var(--gold);font-size:.85rem">${'⭐'.repeat(r.rating)}</div>
            <div style="color:var(--text2);font-size:.85rem;margin-top:4px">${r.text}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${r.featured ? '<span class="admin-nav-badge admin-nav-badge-orange">Featured</span>' : ''}
            <button class="btn btn-ghost btn-sm" onclick="showToast('Set as featured.','info')">⭐ Feature</button>
            <button class="btn btn-danger btn-sm" onclick="showToast('Review deleted.','info')">🗑</button>
          </div>
        </div>
      </div>`).join('')}
  </div>`;
}

/* ─── 11. ACHIEVEMENT SYSTEM ─────────────────────────────────── */
function renderPCCAchievements(main) {
  main.innerHTML = `
  <div class="admin-section-title">🏆 Achievement System Manager</div>
  <div class="admin-section-sub">Configure XP levels, badges, streaks and learning rewards.</div>
  <div class="mod-sub-grid" style="margin-bottom:20px">
    ${[['🎖','XP & Levels','Set XP thresholds for Bronze → Diamond'],
       ['🏅','Badges','Create custom achievement badges'],
       ['🎁','Rewards','Assign coupon rewards to milestones'],
       ['🔥','Streak Rules','Configure daily streak logic'],
       ['🏆','Leaderboard','Top student leaderboard settings']].map(([e,t,d]) => `
      <div class="mod-sub-card" onclick="showToast('${t} editor — coming soon.','info')">
        <div class="mod-sub-card-icon">${e}</div>
        <div class="mod-sub-card-title">${t}</div>
        <div class="mod-sub-card-desc">${d}</div>
      </div>`).join('')}
  </div>
  <div class="mod-form-wrap">
    <div style="font-weight:700;margin-bottom:14px">🎖 XP Level Thresholds</div>
    <div class="admin-form-grid">
      ${[['Bronze','0'],['Silver','500'],['Gold','2000'],['Platinum','5000'],['Diamond','10000']].map(([l,xp]) => `
        <div class="form-group"><label class="form-label">${l}</label><input class="form-input" value="${xp} XP"/></div>`).join('')}
    </div>
    <button class="btn btn-primary btn-sm mt-4" onclick="showToast('XP levels saved!','success')">💾 Save XP Config</button>
  </div>`;
}

/* ─── 12. NOTIFICATION CENTER ────────────────────────────────── */
function renderPCCNotifications(main) {
  main.innerHTML = `
  <div class="admin-section-title">🔔 Notification Center</div>
  <div class="admin-section-sub">Push notifications via OneSignal, plus email/WhatsApp PDF-alert subscriber management.</div>

  <!-- Subscriber Stats Card -->
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;color:var(--accent);margin-bottom:14px">📋 PDF Alert Subscribers</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:140px;background:rgba(61,142,248,0.08);border:1px solid rgba(61,142,248,0.2);border-radius:10px;padding:14px;text-align:center">
        <div id="pccSubTotal" style="font-size:1.8rem;font-weight:800;color:#3d8ef8">—</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">Total Confirmed</div>
      </div>
      <div style="flex:1;min-width:140px;background:rgba(16,217,142,0.08);border:1px solid rgba(16,217,142,0.2);border-radius:10px;padding:14px;text-align:center">
        <div id="pccSubEmail" style="font-size:1.8rem;font-weight:800;color:#10d98e">—</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">Email Subscribers</div>
      </div>
      <div style="flex:1;min-width:140px;background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.2);border-radius:10px;padding:14px;text-align:center">
        <div id="pccSubWa" style="font-size:1.8rem;font-weight:800;color:#25d366">—</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:2px">WhatsApp Subscribers</div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="pccLoadSubscriberStats(this)">🔄 Load Stats</button>
    <button class="btn btn-ghost btn-sm" style="margin-left:6px" onclick="pccLoadSubscriberList()">📋 View All Subscribers</button>
    <div id="pccSubList" style="margin-top:12px"></div>
  </div>

  <!-- 📢 New Push Notification -->
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;color:var(--accent);margin-bottom:14px">📢 New Push Notification</div>
    <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="pnTitle" placeholder="New PDF Added!" maxlength="60"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Message</label><textarea class="form-input" id="pnMessage" rows="2" placeholder="Check out the latest JEE 2025 notes…" maxlength="160"></textarea></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Image URL (Optional)</label><input class="form-input" id="pnImageUrl" placeholder="https://studyria.com/banners/new-pdf.jpg"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Click URL</label><input class="form-input" id="pnClickUrl" placeholder="https://studyria.qzz.io/library"/></div>
    <div class="admin-form-grid" style="margin-top:10px">
      <div class="form-group"><label class="form-label">Audience</label>
        <select class="form-input" id="pnAudience">
          <option value="all">All Users</option>
          <option value="premium">Premium Only</option>
          <option value="free">Free Users</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Schedule</label>
        <select class="form-input" id="pnSchedule" onchange="document.getElementById('pnScheduleRow').style.display=this.value==='later'?'block':'none'">
          <option value="now">Send Now</option>
          <option value="later">Schedule for Later</option>
        </select>
      </div>
    </div>
    <div class="form-group" id="pnScheduleRow" style="margin-top:8px;display:none">
      <label class="form-label">Schedule Date &amp; Time</label>
      <input class="form-input" id="pnScheduleAt" type="datetime-local"/>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" id="pnTestBtn" onclick="pnSendTest()">🚀 Send Test</button>
      <button class="btn btn-primary btn-sm" id="pnSendBtn" onclick="pnSendToAll()">📤 Send to All</button>
    </div>
    <div id="pnStatusMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
  </div>

  <!-- 📊 Delivery Status -->
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-weight:700;color:var(--gold)">📊 Delivery Status</div>
      <button class="btn btn-ghost btn-sm" onclick="pnLoadHistory()">🔄 Refresh</button>
    </div>
    <div id="pnDeliveryStatus" style="font-size:.82rem;color:var(--text2)">No recent sends yet.</div>
  </div>

  <!-- 📜 Notification History -->
  <div class="mod-form-wrap">
    <div style="font-weight:700;margin-bottom:14px">📜 Notification History</div>
    <div id="pnHistoryList" style="font-size:.8rem;color:var(--text2)">Loading…</div>
  </div>`;

  // Auto-load stats + history
  pccLoadSubscriberStats();
  pnLoadHistory();
}

async function pccLoadSubscriberStats(btn) {
  const sb = window.supabaseClient;
  if (!sb) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const [totalRes, emailRes, waRes] = await Promise.all([
      sb.from('pdf_subscribers').select('id', { count: 'exact', head: true }).eq('confirmed', true),
      sb.from('pdf_subscribers').select('id', { count: 'exact', head: true }).eq('confirmed', true).eq('notify_email', true),
      sb.from('pdf_subscribers').select('id', { count: 'exact', head: true }).eq('confirmed', true).eq('notify_wa', true),
    ]);
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('pccSubTotal', totalRes.count ?? '—');
    el('pccSubEmail', emailRes.count ?? '—');
    el('pccSubWa',    waRes.count    ?? '—');
  } catch(e) { console.warn('pccLoadSubscriberStats:', e); }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Load Stats'; }
}

async function pccLoadSubscriberList() {
  const sb = window.supabaseClient;
  const el = document.getElementById('pccSubList');
  if (!sb || !el) return;
  el.innerHTML = '<div style="font-size:.8rem;color:var(--text2)">Loading…</div>';
  try {
    const { data, error } = await sb
      .from('pdf_subscribers')
      .select('id,email,whatsapp,notify_email,notify_wa,created_at')
      .eq('confirmed', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { el.innerHTML = `<div style="color:var(--danger);font-size:.8rem">${error.message}</div>`; return; }
    if (!data?.length) { el.innerHTML = '<div style="font-size:.8rem;color:var(--text2)">No subscribers yet.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%;font-size:.78rem">
      <thead><tr><th>Email</th><th>WhatsApp</th><th>Email ✉</th><th>WA 💬</th><th>Joined</th></tr></thead>
      <tbody>${data.map(s=>`<tr>
        <td>${s.email}</td>
        <td>${s.whatsapp||'—'}</td>
        <td style="text-align:center">${s.notify_email?'✅':'—'}</td>
        <td style="text-align:center">${s.notify_wa?'✅':'—'}</td>
        <td>${s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN') : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) { el.innerHTML = `<div style="color:var(--danger);font-size:.8rem">${e.message}</div>`; }
}

// ── Push Notification Dashboard — read form fields ──────────────────
function pnReadForm() {
  const title    = document.getElementById('pnTitle')?.value?.trim() || '';
  const message  = document.getElementById('pnMessage')?.value?.trim() || '';
  const imageUrl = document.getElementById('pnImageUrl')?.value?.trim() || null;
  const clickUrl = document.getElementById('pnClickUrl')?.value?.trim() || null;
  const audience = document.getElementById('pnAudience')?.value || 'all';
  const schedule = document.getElementById('pnSchedule')?.value || 'now';
  const scheduleAtRaw = document.getElementById('pnScheduleAt')?.value || null;
  const scheduleAt = (schedule === 'later' && scheduleAtRaw) ? new Date(scheduleAtRaw).toISOString() : null;
  return { title, message, imageUrl, clickUrl, audience, schedule, scheduleAt };
}

function pnShowStatus(msg, type) {
  const el = document.getElementById('pnStatusMsg');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : 'var(--text2)');
  el.textContent = msg;
}

async function pnSendTest() {
  const { title, message, imageUrl, clickUrl, audience } = pnReadForm();
  if (!title || !message) { showToast('Enter a title and message first.', 'error'); return; }

  const btn = document.getElementById('pnTestBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }

  try {
    if (typeof window.sendPushNotification !== 'function') throw new Error('Notification backend not loaded');
    const row = await window.sendPushNotification({ title, message, imageUrl, clickUrl, audience, isTest: true });
    if (row) {
      pnShowStatus('🚀 Test notification sent to your device.', 'success');
      showToast('Test notification sent!', 'success');
    } else {
      pnShowStatus('Test send failed — check your Pipedream webhook config.', 'error');
    }
  } catch (e) {
    pnShowStatus('Error: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '🚀 Send Test'; }
  pnLoadHistory();
}

async function pnSendToAll() {
  const { title, message, imageUrl, clickUrl, audience, schedule, scheduleAt } = pnReadForm();
  if (!title || !message) { showToast('Enter a title and message.', 'error'); return; }
  if (schedule === 'later' && !scheduleAt) { showToast('Pick a date and time to schedule for.', 'error'); return; }

  const confirmMsg = schedule === 'later'
    ? `Schedule this notification for ${new Date(scheduleAt).toLocaleString('en-IN')}?`
    : `Send this notification to ${audience === 'all' ? 'ALL users' : audience + ' users'} now?`;
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('pnSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }

  try {
    if (typeof window.sendPushNotification !== 'function') throw new Error('Notification backend not loaded');
    const row = await window.sendPushNotification({ title, message, imageUrl, clickUrl, audience, scheduleAt, isTest: false });
    if (row) {
      if (row.status === 'scheduled') {
        pnShowStatus(`📅 Scheduled for ${new Date(row.scheduled_at).toLocaleString('en-IN')}.`, 'success');
        showToast('Notification scheduled!', 'success');
      } else if (row.status === 'sent') {
        pnShowStatus('📤 Notification sent to all matching subscribers.', 'success');
        showToast('Notification sent!', 'success');
      } else {
        pnShowStatus('Notification saved but the send may have failed — check Delivery Status below.', 'error');
      }
      document.getElementById('pnTitle').value = '';
      document.getElementById('pnMessage').value = '';
      document.getElementById('pnImageUrl').value = '';
      document.getElementById('pnClickUrl').value = '';
    } else {
      pnShowStatus('Send failed — check your Supabase connection and Pipedream webhook.', 'error');
    }
  } catch (e) {
    pnShowStatus('Error: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '📤 Send to All'; }
  pnLoadHistory();
}

async function pnCancelScheduled(id, btn) {
  if (!confirm('Cancel this scheduled notification?')) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const ok = typeof window.cancelScheduledNotification === 'function'
    ? await window.cancelScheduledNotification(id)
    : false;
  if (ok) { showToast('Scheduled notification cancelled.', 'success'); }
  else { showToast('Could not cancel — it may have already been sent.', 'error'); }
  pnLoadHistory();
}

async function pnRetrySend(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const row = typeof window.dispatchPushNotification === 'function'
    ? await window.dispatchPushNotification(id, false)
    : null;
  if (row && row.status === 'sent') showToast('Notification re-sent successfully.', 'success');
  else showToast('Retry failed — check your webhook configuration.', 'error');
  pnLoadHistory();
}

const PN_STATUS_STYLE = {
  pending:   { label: '⏳ Pending',   color: '#fbbf24' },
  scheduled: { label: '📅 Scheduled', color: '#60a5fa' },
  sent:      { label: '✅ Sent',      color: '#10d98e' },
  cancelled: { label: '🚫 Cancelled', color: '#94a3b8' },
  failed:    { label: '❌ Failed',    color: '#ff6b85' },
  test:      { label: '🧪 Test',      color: '#b794f4' },
};

async function pnLoadHistory() {
  const statusEl  = document.getElementById('pnDeliveryStatus');
  const historyEl = document.getElementById('pnHistoryList');
  if (!historyEl) return;

  const rows = typeof window.loadPushNotificationHistory === 'function'
    ? await window.loadPushNotificationHistory(50)
    : [];

  if (!rows.length) {
    if (statusEl)  statusEl.innerHTML  = '<div>No recent sends yet.</div>';
    if (historyEl) historyEl.innerHTML = '<div>No notifications sent yet — your first one will appear here.</div>';
    return;
  }

  // Delivery Status = the most recent non-test send
  const lastReal = rows.find(r => r.status !== 'test');
  if (statusEl) {
    if (lastReal) {
      const st = PN_STATUS_STYLE[lastReal.status] || { label: lastReal.status, color: 'var(--text2)' };
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700;color:var(--text)">${lastReal.title}</div>
            <div style="font-size:.74rem;margin-top:2px">Audience: ${lastReal.audience} · ${lastReal.recipients || 0} recipients · ${lastReal.delivered || 0} delivered</div>
          </div>
          <span style="font-weight:700;color:${st.color}">${st.label}</span>
        </div>`;
    } else {
      statusEl.innerHTML = '<div>No real sends yet — only test notifications so far.</div>';
    }
  }

  historyEl.innerHTML = `<div class="table-wrap"><table class="admin-table" style="width:100%;font-size:.78rem">
    <thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>When</th><th>Actions</th></tr></thead>
    <tbody>${rows.map(r => {
      const st = PN_STATUS_STYLE[r.status] || { label: r.status, color: 'var(--text2)' };
      const when = r.status === 'scheduled'
        ? `Scheduled: ${r.scheduled_at ? new Date(r.scheduled_at).toLocaleString('en-IN') : '—'}`
        : (r.sent_at ? new Date(r.sent_at).toLocaleString('en-IN') : new Date(r.created_at).toLocaleString('en-IN'));
      let actions = '';
      if (r.status === 'scheduled') {
        actions = `<button class="btn btn-ghost btn-sm" onclick="pnCancelScheduled('${r.id}', this)">❌ Cancel</button>`;
      } else if (r.status === 'failed') {
        actions = `<button class="btn btn-ghost btn-sm" onclick="pnRetrySend('${r.id}', this)">🔁 Retry</button>`;
      }
      return `<tr>
        <td>${(r.title||'').replace(/</g,'&lt;')}</td>
        <td style="text-transform:capitalize">${r.audience}</td>
        <td style="color:${st.color};font-weight:600">${st.label}</td>
        <td>${when}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ─── 13. SEO MANAGER ────────────────────────────────────────── */
function renderPCCSEO(main) {
  main.innerHTML = `
  <div class="admin-section-title">🔍 SEO Manager</div>
  <div class="admin-section-sub">Control meta tags, sitemaps, robots.txt and social sharing.</div>
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;color:var(--accent);margin-bottom:14px">🌐 Global SEO</div>
    <div class="form-group"><label class="form-label">Default Meta Title</label><input class="form-input" id="seoMetaTitle" placeholder="Studyria – Assam's #1 PDF Study Platform"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Default Meta Description</label><textarea class="form-input" id="seoMetaDesc" rows="2" placeholder="Download free and premium PDF study materials for JEE, NEET, UPSC and all competitive exams."></textarea></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Meta Keywords</label><input class="form-input" id="seoMetaKeywords" placeholder="study PDF, JEE notes, NEET materials, UPSC books, free PDF download India"/></div>
  </div>
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;color:var(--gold);margin-bottom:14px">📱 Open Graph / Social</div>
    <div class="admin-form-grid">
      <div class="form-group"><label class="form-label">OG Title</label><input class="form-input" id="seoOgTitle" placeholder="Studyria – Study Smarter"/></div>
      <div class="form-group"><label class="form-label">OG Image URL</label><input class="form-input" id="seoOgImage" placeholder="https://studyria.com/og.png"/></div>
    </div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">OG Description</label><textarea class="form-input" id="seoOgDesc" rows="2" placeholder="India's largest collection of curated PDF study materials."></textarea></div>
  </div>
  <div class="mod-form-wrap">
    <div style="font-weight:700;color:var(--success);margin-bottom:14px">⚙ Technical SEO</div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Auto Sitemap Generator</div><div class="text-muted text-xs">Regenerate sitemap.xml on every PDF publish</div></div>
      <button class="admin-toggle on" id="seoToggleSitemap" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Index PDF pages</div><div class="text-muted text-xs">Allow search engines to index individual PDF pages</div></div>
      <button class="admin-toggle on" id="seoToggleIndex" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="form-group" style="margin-top:14px"><label class="form-label">robots.txt Content</label><textarea class="form-input" id="seoRobotsTxt" rows="4" style="font-family:monospace" placeholder="User-agent: *&#10;Allow: /&#10;Disallow: /admin&#10;Sitemap: https://studyria.com/sitemap.xml"></textarea></div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="seoSaveBtn" onclick="saveSeoConfig()">💾 Save SEO Config</button>
      <button class="btn btn-secondary btn-sm" onclick="showToast('Sitemap regenerated!','success')">🗺 Regenerate Sitemap</button>
    </div>
    <div id="seoStatusMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
  </div>`;
  loadSeoConfig();
}

async function loadSeoConfig() {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data, error } = await sb.from('site_config').select('key,value').in('key', [
      'seo_meta_title','seo_meta_desc','seo_meta_keywords',
      'seo_og_title','seo_og_image','seo_og_desc',
      'seo_toggle_sitemap','seo_toggle_index','seo_robots_txt'
    ]);
    if (error || !data) return;
    const cfg = {};
    data.forEach(row => { cfg[row.key] = row.value; });
    const g = id => document.getElementById(id);
    if (cfg.seo_meta_title    !== undefined && g('seoMetaTitle'))    g('seoMetaTitle').value    = cfg.seo_meta_title;
    if (cfg.seo_meta_desc     !== undefined && g('seoMetaDesc'))     g('seoMetaDesc').value     = cfg.seo_meta_desc;
    if (cfg.seo_meta_keywords !== undefined && g('seoMetaKeywords')) g('seoMetaKeywords').value = cfg.seo_meta_keywords;
    if (cfg.seo_og_title      !== undefined && g('seoOgTitle'))      g('seoOgTitle').value      = cfg.seo_og_title;
    if (cfg.seo_og_image      !== undefined && g('seoOgImage'))      g('seoOgImage').value      = cfg.seo_og_image;
    if (cfg.seo_og_desc       !== undefined && g('seoOgDesc'))       g('seoOgDesc').value       = cfg.seo_og_desc;
    if (cfg.seo_robots_txt    !== undefined && g('seoRobotsTxt'))    g('seoRobotsTxt').value    = cfg.seo_robots_txt;
    if (cfg.seo_toggle_sitemap !== undefined && g('seoToggleSitemap')) {
      g('seoToggleSitemap').classList.toggle('on', cfg.seo_toggle_sitemap === 'true');
    }
    if (cfg.seo_toggle_index !== undefined && g('seoToggleIndex')) {
      g('seoToggleIndex').classList.toggle('on', cfg.seo_toggle_index === 'true');
    }
  } catch(e) { console.warn('[SEO] loadSeoConfig error:', e); }
}

async function saveSeoConfig() {
  const sb = window.supabaseClient;
  const btn = document.getElementById('seoSaveBtn');
  const statusEl = document.getElementById('seoStatusMsg');
  const g = id => document.getElementById(id);

  if (!sb) {
    if (statusEl) { statusEl.style.display='block'; statusEl.style.color='var(--danger)'; statusEl.textContent='⚠️ Supabase not connected — cannot save.'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  const rows = [
    { key: 'seo_meta_title',      value: g('seoMetaTitle')?.value?.trim()    || '' },
    { key: 'seo_meta_desc',       value: g('seoMetaDesc')?.value?.trim()     || '' },
    { key: 'seo_meta_keywords',   value: g('seoMetaKeywords')?.value?.trim() || '' },
    { key: 'seo_og_title',        value: g('seoOgTitle')?.value?.trim()      || '' },
    { key: 'seo_og_image',        value: g('seoOgImage')?.value?.trim()      || '' },
    { key: 'seo_og_desc',         value: g('seoOgDesc')?.value?.trim()       || '' },
    { key: 'seo_robots_txt',      value: g('seoRobotsTxt')?.value            || '' },
    { key: 'seo_toggle_sitemap',  value: String(g('seoToggleSitemap')?.classList.contains('on') ?? true) },
    { key: 'seo_toggle_index',    value: String(g('seoToggleIndex')?.classList.contains('on')   ?? true) },
  ];

  try {
    const { error } = await sb.from('site_config').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
    showToast('✅ SEO settings saved!', 'success');
    if (statusEl) { statusEl.style.display='block'; statusEl.style.color='var(--success)'; statusEl.textContent='✅ SEO settings saved successfully.'; }
    if (typeof logAdminActivity === 'function') logAdminActivity('SEO config updated', 'green');
  } catch(err) {
    const msg = err?.message || String(err);
    showToast('❌ Save failed: ' + msg, 'error');
    if (statusEl) { statusEl.style.display='block'; statusEl.style.color='var(--danger)'; statusEl.textContent='❌ Error: ' + msg; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save SEO Config'; }
  }
}

/* ─── 14. LIVE ANALYTICS CENTER ──────────────────────────────── */
function renderPCCLiveAnalytics(main) {
  const liveCount = Math.floor(Math.random()*300+100);
  main.innerHTML = `
  <div class="admin-section-title" style="display:flex;align-items:center;gap:10px">
    📊 Live Analytics Center
    <span style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--success);font-weight:600">
      <span class="analytics-live-dot"></span>LIVE
    </span>
  </div>
  <div class="admin-section-sub">Real-time visitor data, PDF performance and device statistics.</div>

  <div class="admin-stats-grid-8" style="margin-bottom:20px">
    ${[
      ['👥','Live Visitors',liveCount,'blue'],
      ['🟢','Online Users',Math.floor(liveCount*.7),'green'],
      ['👁','Page Views Today','12,410','blue'],
      ['📥','Downloads Today','847','gold'],
      ['🔍','Searches Today','3,210','purple'],
      ['📱','Mobile Users','68%','blue'],
      ['💻','Desktop Users','29%','green'],
      ['📲','PWA Users','3%','gold'],
    ].map(([e,l,v,c]) => `
      <div class="admin-stat-card ${c}">
        <div class="admin-stat-label">${e} ${l}</div>
        <div class="admin-stat-num">${v}</div>
      </div>`).join('')}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div class="admin-table-card">
      <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">🔥 Most Viewed PDFs</div></div>
      <div style="padding:12px">
        ${[['JEE Advanced 2024 Solutions','4,210 views'],['UPSC Prelims GS Notes','3,840 views'],['NEET Biology Crash Course','2,960 views'],['SSC CGL Maths Tricks','1,780 views']].map(([t,v]) => `
          <div class="live-stat-row"><div style="font-size:.85rem;font-weight:600">${t}</div><div class="live-stat-val" style="font-size:.85rem">${v}</div></div>`).join('')}
      </div>
    </div>
    <div class="admin-table-card">
      <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">📥 Most Downloaded</div></div>
      <div style="padding:12px">
        ${[['NEET Biology Crash Course','1,240 DLs'],['JEE Advanced 2024','980 DLs'],['Banking Awareness 2025','760 DLs'],['SSC CGL Full Pack','540 DLs']].map(([t,v]) => `
          <div class="live-stat-row"><div style="font-size:.85rem;font-weight:600">${t}</div><div class="live-stat-val" style="font-size:.85rem">${v}</div></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="admin-table-card">
    <div class="admin-table-header">
      <div style="font-size:.9rem;font-weight:700">🔍 Top Search Queries Today</div>
      <button class="btn btn-ghost btn-sm" onclick="renderPCCLiveAnalytics(document.getElementById('adminMain'))">🔄 Refresh</button>
    </div>
    <div style="padding:14px;display:flex;flex-wrap:wrap;gap:8px">
      ${['jee advanced 2024','upsc notes pdf','neet bio','ssc cgl maths','banking awareness','english grammar pdf','history notes upsc','physics formula sheet'].map(q => `
        <span class="mod-tag">${q}</span>`).join('')}
    </div>
  </div>`;
}

/* ─── 15. AI CONTROL CENTER ──────────────────────────────────── */
function renderPCCAICenter(main) {
  main.innerHTML = `
  <div class="admin-section-title">🤖 AI Control Center</div>
  <div class="admin-section-sub">AI-powered tools to auto-generate descriptions, tags, SEO and recommendations.</div>
  <div class="mod-sub-grid" style="margin-bottom:20px">
    ${[['✍️','AI Description Generator','Auto-write PDF descriptions from title/content'],
       ['🏷','AI Tag Generator','Smart keyword tags for each PDF'],
       ['🔍','AI SEO Generator','Auto-fill meta title, description, keywords'],
       ['🎯','AI Recommendation Engine','Personalized PDF suggestions per user'],
    ].map(([e,t,d]) => `
      <div class="mod-sub-card">
        <div class="mod-sub-card-icon">${e}</div>
        <div class="mod-sub-card-title">${t}</div>
        <div class="mod-sub-card-desc">${d}</div>
      </div>`).join('')}
  </div>
  <div class="mod-form-wrap">
    <div style="font-weight:700;margin-bottom:14px">✍️ AI Description Generator</div>
    <div class="form-group"><label class="form-label">PDF Title</label><input class="form-input" id="aiPdfTitle" placeholder="JEE Advanced 2024 Full Solutions"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Category</label>
      <select class="form-input"><option>JEE / NEET</option><option>UPSC</option><option>Banking</option><option>Board Exams</option></select>
    </div>
    <button class="btn btn-primary btn-sm mt-4" onclick="adminAIGenerateDesc()">🤖 Generate with AI</button>
    <div id="aiDescOutput" style="margin-top:14px;display:none">
      <div class="form-group"><label class="form-label">Generated Description</label>
        <textarea class="form-input" rows="4" id="aiDescText"></textarea>
      </div>
      <button class="btn btn-secondary btn-sm mt-2" onclick="showToast('Description copied!','success')">📋 Copy</button>
    </div>
  </div>
  <div class="mod-form-wrap" style="margin-top:14px">
    <div style="font-weight:700;margin-bottom:14px">⚙ AI Settings</div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Auto-generate on PDF publish</div><div class="text-muted text-xs">AI fills description and tags automatically</div></div>
      <button class="admin-toggle" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">AI Recommendations on homepage</div><div class="text-muted text-xs">Personalized PDF suggestions for each user</div></div>
      <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
    </div>
  </div>`;
}

function adminAIGenerateDesc() {
  const title = document.getElementById('aiPdfTitle')?.value || 'Study Material';
  const output = document.getElementById('aiDescOutput');
  const text = document.getElementById('aiDescText');
  if (!output || !text) return;
  showToast('AI generating…','info');
  setTimeout(() => {
    text.value = `This comprehensive study material — "${title}" — is meticulously curated for aspirants targeting competitive exams. It covers all essential concepts with detailed explanations, solved examples, and practice questions. Ideal for self-study and last-minute revision, this PDF is trusted by thousands of students across India for achieving top scores.`;
    output.style.display = 'block';
    showToast('AI description ready!','success');
  }, 1200);
}

/* ─── 16. SECURITY CENTER ────────────────────────────────────── */
function renderPCCSecurity(main) {
  main.innerHTML = `
  <div class="admin-section-title">🛡 Security Center</div>
  <div class="admin-section-sub">Admin roles, login logs, 2FA and active session management.</div>
  <div class="admin-stats-grid" style="margin-bottom:20px">
    ${adminStatCard('Active Sessions','3','right now',true,'blue','shield')}
    ${adminStatCard('Failed Logins','12','last 24h',false,'red','x')}
    ${adminStatCard('Admin Accounts','2','owners',true,'gold','users')}
    ${adminStatCard('2FA Enabled','Yes','secured',true,'green','check')}
  </div>
  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;margin-bottom:14px">🔐 Two-Factor Authentication</div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Require 2FA for admin login</div><div class="text-muted text-xs">TOTP-based 2FA via Google Authenticator</div></div>
      <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="admin-toggle-row">
      <div><div style="font-size:.85rem;font-weight:600">Login alerts via email</div><div class="text-muted text-xs">Email alert on every new admin login</div></div>
      <button class="admin-toggle on" onclick="this.classList.toggle('on')"></button>
    </div>
    <button class="btn btn-primary btn-sm mt-4" onclick="showToast('2FA settings saved!','success')">💾 Save Security Config</button>
  </div>
  <div class="admin-table-card" style="margin-bottom:14px">
    <div class="admin-table-header"><div style="font-size:.9rem;font-weight:700">🔑 Recent Login Logs</div></div>
    <div class="table-wrap"><table class="admin-table" style="width:100%">
      <thead><tr><th>User</th><th>IP</th><th>Device</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>
        ${[['admin@studyria.com','103.21.xx.xx','Chrome / Android','✅ Success','Today 9:14am'],
           ['admin@studyria.com','182.71.xx.xx','Safari / iPhone','✅ Success','Yesterday 11pm'],
           ['unknown@hacker.xyz','45.33.xx.xx','Unknown','❌ Failed','Yesterday 3:42am'],
        ].map(([u,ip,d,s,t]) => `<tr>
          <td style="font-size:.82rem">${u}</td><td style="font-size:.8rem;color:var(--text2)">${ip}</td>
          <td style="font-size:.8rem;color:var(--text2)">${d}</td>
          <td>${s}</td><td style="font-size:.8rem;color:var(--text2)">${t}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>
  <div class="admin-table-card">
    <div class="admin-table-header">
      <div style="font-size:.9rem;font-weight:700">📱 Active Sessions</div>
      <button class="btn btn-danger btn-sm" onclick="showToast('All other sessions terminated.','info')">⛔ Kill All Sessions</button>
    </div>
    <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
      ${[['Chrome / Android — Current session','103.21.xx.xx','Active now'],
         ['Firefox / Desktop','182.71.xx.xx','2 hours ago'],
      ].map(([d,ip,t]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius-sm)">
          <div><div style="font-size:.85rem;font-weight:600">${d}</div><div style="font-size:.75rem;color:var(--text2)">${ip} · ${t}</div></div>
          <button class="btn btn-danger btn-sm" onclick="showToast('Session terminated.','info')">⛔ Terminate</button>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ─── 17. ADVANCED SYSTEM SETTINGS ──────────────────────────── */
function renderPCCSystemAdvanced(main) {
  main.innerHTML = `
  <div class="admin-section-title">⚙ Advanced System Settings</div>
  <div class="admin-section-sub">Backup, restore, database export, cache and storage management.</div>
  <div class="mod-sub-grid" style="margin-bottom:20px">
    ${[['💾','Backup Website','Download a full site backup ZIP'],
       ['♻️','Restore Backup','Restore from a previous backup file'],
       ['📤','Export Database','Export Firestore/Supabase data as JSON/CSV'],
       ['📥','Import Database','Bulk import PDF or user data'],
       ['🗑','Cache Cleaner','Clear all CDN and local caches'],
       ['💿','Storage Monitor','View storage usage across Firebase/Supabase'],
       ['🔑','API Settings','Manage all API keys and third-party integrations'],
    ].map(([e,t,d]) => `
      <div class="mod-sub-card" onclick="showToast('${t} — action ready.','info')">
        <div class="mod-sub-card-icon">${e}</div>
        <div class="mod-sub-card-title">${t}</div>
        <div class="mod-sub-card-desc">${d}</div>
      </div>`).join('')}
  </div>

  <div class="mod-form-wrap" style="margin-bottom:14px">
    <div style="font-weight:700;margin-bottom:14px">💿 Storage Monitor</div>
    ${[['Supabase Storage',72,'blue'],['Firebase Storage',38,'gold'],['Firestore DB',15,'green']].map(([l,pct,c]) => `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:5px"><span>${l}</span><span style="color:var(--text2)">${pct}% used</span></div>
        <div style="height:7px;border-radius:10px;background:var(--glass);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--grad-primary);border-radius:10px;transition:width .6s"></div>
        </div>
      </div>`).join('')}
  </div>

  <div class="mod-form-wrap">
    <div style="font-weight:700;margin-bottom:14px">?? API Keys</div>
    <div class="form-group"><label class="form-label">Supabase URL</label><input class="form-input" type="password" placeholder="https://xxxx.supabase.co"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Supabase Anon Key</label><input class="form-input" type="password" placeholder="eyJ…"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Razorpay Key ID</label><input class="form-input" type="password" placeholder="rzp_live_…"/></div>
    <div class="form-group" style="margin-top:8px"><label class="form-label">Firebase Config JSON</label><textarea class="form-input" rows="3" placeholder='{"apiKey":"…","projectId":"…"}'></textarea></div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="showToast('API keys saved securely!','success')">💾 Save API Keys</button>
      <button class="btn btn-secondary btn-sm" onclick="showToast('Cache cleared!','success')">🗑 Clear Cache</button>
      <button class="btn btn-ghost btn-sm" onclick="showToast('Database export started…','info')">📤 Export DB</button>
    </div>
  </div>`;
}

function togglePriceFields() {
  const free = document.getElementById('upType').value === 'free';
  document.getElementById('priceFields').style.display = free ? 'none' : 'grid';
}

// ── TYPED TAGLINE (legacy — replaced by heroApplySettings) ───────
// Kept as fallback if hero_settings not yet in DB
window._startTypedFallback = function(phrases) {
  const el = document.getElementById('heroSubtitle');
  if(!el) return;
  let pi = 0, ci = 0, deleting = false;
  el.classList.add('hero-cursor');
  function tick(){
    const full = phrases[pi];
    if(!deleting){
      el.textContent = full.slice(0, ++ci);
      if(ci === full.length){ deleting = true; setTimeout(tick, 2200); return; }
      setTimeout(tick, 38);
    } else {
      el.textContent = full.slice(0, --ci);
      if(ci === 0){ deleting = false; pi = (pi+1) % phrases.length; setTimeout(tick, 400); return; }
      setTimeout(tick, 18);
    }
  }
  setTimeout(tick, 900);
};

// ── HERO DESIGNER DEFAULT SETTINGS ──────────────────────────────
window._heroDefaults = {
  badge_text: "Assam's #1 Smartest Growth Ecosystem",
  main_title: "Assam's Ultimate Gateway to Education and Career Growth",
  highlight_text: "Studyria™ Premium Growth Hub",
  subtitle_phrases: "Free & premium PDFs for ADRE, APSC, Assam Police & Assam state exams.|Curated study materials trusted by Assam students.|Your shortcut to better marks, better scores, better future.|Assam’s #1 PDF Study Platform — download, study, succeed.",
  font_family: "Playfair Display, Georgia, serif",
  title_font_size: "clamp(1.5rem,3.4vw,2.4rem)",
  title_font_weight: "800",
  title_color: "#eef2ff",
  gradient_start: "#3d8ef8",
  gradient_mid: "#8b5cf6",
  gradient_end: "#00c8e8",
  badge_bg: "rgba(61,142,248,0.12)",
  badge_border: "rgba(61,142,248,0.28)",
  badge_color: "#00c8e8",
  bg_glow_color: "rgba(61,142,248,0.06)",
  hero_bg_type: "orbs",       // orbs | image | gradient | solid
  hero_bg_value: "",
  cta1_text: "Browse Library",
  cta1_action: "library",
  cta2_text: "Start Free",
  cta2_action: "register",
  layout_style: "centered",   // centered | split
  animation_style: "fadeUp",  // fadeUp | slide | zoom | none
  show_badge: true,
  show_site_name: true,
  show_highlight: true,
  show_cta2: true,
  show_orbs: true,
  // Premium
  enable_glassmorphism: false,
  enable_gradient_text: true,
  enable_animated_text: true,
  enable_particles: false,
  enable_glow_effects: false,
  enable_typing_effect: true,
  enable_shine_effect: false,
};

// ── LOAD HERO FROM SUPABASE — PERF: in-memory cache (5 min TTL) ──
async function loadHeroFromDB() {
  const defaults = window._heroDefaults;
  if (!window.supabaseClient) { heroApplySettings(defaults); return; }
  // Return cached data if fresh (avoids DB round-trip on every navigate('home'))
  if (window._heroSettingsCache && (Date.now() - window._heroSettingsCacheTs < 300000)) {
    heroApplySettings(window._heroSettingsCache);
    return;
  }
  try {
    const { data, error } = await window.supabaseClient
      .from('hero_settings').select('*').eq('id',1).single();
    if (error || !data) { heroApplySettings(defaults); return; }
    // Migration: a previously-saved row may still carry the old,
    // oversized title font size (clamp(2.6rem,6vw,4.8rem)) from
    // before the hero-compaction update. If the saved value matches
    // that legacy default exactly (i.e. it was never customized by
    // an admin), upgrade it to the new compact default so existing
    // installs benefit from the smaller hero without clobbering any
    // intentional admin customization.
    const legacyTitleSize = "clamp(2.6rem,6vw,4.8rem)";
    if (data.title_font_size === legacyTitleSize) {
      data.title_font_size = defaults.title_font_size;
    }
    const merged = { ...defaults, ...data };
    // PERF: cache hero settings in memory
    window._heroSettingsCache = merged;
    window._heroSettingsCacheTs = Date.now();
    heroApplySettings(merged);
  } catch(e) {
    heroApplySettings(defaults);
  }
}

// ── APPLY HERO SETTINGS TO DOM ────────────────────────────────────
function heroApplySettings(s) {
  window._heroCurrentSettings = s;
  const defaults = window._heroDefaults;
  const g = (k) => s[k] !== undefined ? s[k] : defaults[k];

  // Badge
  const badge = document.getElementById('heroBadge');
  const badgeText = document.getElementById('heroBadgeText');
  if(badge) {
    badge.style.display = g('show_badge') ? 'inline-flex' : 'none';
    badge.style.background = g('badge_bg');
    badge.style.borderColor = g('badge_border');
    badge.style.color = g('badge_color');
    if(g('enable_glassmorphism')) badge.classList.add('hero-badge-glass');
    if(g('enable_shine_effect')) {
      const shine = badge.querySelector('.hero-badge-shine') || document.createElement('span');
      shine.className = 'hero-badge-shine';
      shine.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none';
      badge.style.position = 'relative';
      badge.style.overflow = 'hidden';
      badge.appendChild(shine);
    }
    // Premium Theme Engine: optional per-preset badge shadow. Falls back
    // to no shadow when a preset doesn't define one (legacy presets).
    if(s.badge_shadow) {
      badge.classList.add('hero-badge-themed');
      badge.style.setProperty('--hero-badge-shadow', s.badge_shadow);
    } else {
      badge.classList.remove('hero-badge-themed');
      badge.style.removeProperty('--hero-badge-shadow');
    }
  }
  if(badgeText) badgeText.textContent = g('badge_text');

  // Site name visibility
  const siteName = document.getElementById('heroSiteName');
  if(siteName) siteName.style.display = g('show_site_name') ? 'flex' : 'none';

  // Title
  const titleEl = document.getElementById('heroTitle');
  const mainTitle = document.getElementById('heroMainTitle');
  const highlight = document.getElementById('heroHighlight');
  if(titleEl) {
    titleEl.style.fontFamily = g('font_family');
    titleEl.style.fontSize = g('title_font_size');
    titleEl.style.fontWeight = g('title_font_weight');
    titleEl.style.color = g('title_color');
    if(g('enable_glow_effects')) titleEl.classList.add('hero-glow-text');
    else titleEl.classList.remove('hero-glow-text');
    // Premium Theme Engine: optional per-preset title text-shadow glow,
    // layered on top of the existing glow-pulse animation. No-op when a
    // preset doesn't define title_shadow (legacy presets unaffected).
    if(s.title_shadow && s.title_shadow !== 'none') {
      titleEl.classList.add('hero-title-themed');
      titleEl.style.setProperty('--hero-title-shadow', s.title_shadow);
    } else {
      titleEl.classList.remove('hero-title-themed');
      titleEl.style.removeProperty('--hero-title-shadow');
    }
  }
  if(mainTitle) mainTitle.textContent = g('main_title');
  if(highlight) {
    highlight.style.display = g('show_highlight') ? '' : 'none';
    highlight.textContent = g('highlight_text');
    if(g('enable_gradient_text')) {
      const grad = `linear-gradient(135deg, ${g('gradient_start')} 0%, ${g('gradient_mid')} 50%, ${g('gradient_end')} 100%)`;
      highlight.style.background = grad;
      highlight.style.webkitBackgroundClip = 'text';
      highlight.style.webkitTextFillColor = 'transparent';
      highlight.style.backgroundClip = 'text';
      if(g('enable_animated_text')) highlight.classList.add('hero-animated-grad');
      else highlight.classList.remove('hero-animated-grad');
    } else {
      highlight.style.background = '';
      highlight.style.webkitTextFillColor = g('title_color');
      highlight.classList.remove('hero-animated-grad');
    }
  }

  // Subtitle / typing
  const subEl = document.getElementById('heroSubtitle');
  if(subEl) {
    subEl.textContent = '';
    subEl.classList.remove('hero-cursor');
    if(window._heroTypingTimer) clearTimeout(window._heroTypingTimer);
    const _liveStudentCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;
    // Bug fix: some hero_settings rows in the DB were saved as a JSON-array
    // string (e.g. ["phrase one", "phrase two"]) instead of the expected
    // pipe-separated format ("phrase one|phrase two"). Splitting a JSON
    // array string on '|' finds nothing to split on, so the WHOLE raw
    // string — brackets, quotes and all — got typed out as a single
    // (truncated-looking) phrase. Now we detect and parse that case too.
    const _rawPhrases = g('subtitle_phrases') || '';
    let _phraseList;
    const _trimmedRaw = _rawPhrases.trim();
    if (_trimmedRaw.startsWith('[') && _trimmedRaw.endsWith(']')) {
      try {
        const parsed = JSON.parse(_trimmedRaw);
        _phraseList = Array.isArray(parsed) ? parsed.map(String) : [_rawPhrases];
      } catch (_) {
        _phraseList = _rawPhrases.split('|');
      }
    } else {
      _phraseList = _rawPhrases.split('|');
    }
    const phrases = _phraseList.map(p => p.trim()).filter(Boolean)
      .map(p => p.replace(/\d[\d,]*\+?\s*students/gi, _liveStudentCount + '+ students'));
    if(phrases.length && g('enable_typing_effect')) {
      window._startTypedFallback(phrases);
    } else if(phrases.length) {
      subEl.textContent = phrases[0];
    }
  }

  // CTA buttons
  const cta1Text = document.getElementById('heroCta1Text');
  const cta2 = document.getElementById('heroCta2');
  const cta2Text = document.getElementById('heroCta2Text');
  if(cta1Text) cta1Text.textContent = g('cta1_text');
  if(cta2) cta2.style.display = g('show_cta2') ? '' : 'none';
  if(cta2Text) cta2Text.textContent = g('cta2_text');
  const cta1 = document.getElementById('heroCta1');
  if(cta1) cta1.onclick = () => navigate(g('cta1_action') || 'library');
  if(cta2) cta2.onclick = () => navigate(g('cta2_action') || 'register');

  // Premium Theme Engine: unique CTA button design per preset (gradient
  // backgrounds, borders, shadows, hover glow). Driven entirely by CSS
  // custom properties set here — when a preset defines none of these
  // fields, the .hero-cta-themed class is removed and the buttons fall
  // straight back to the original .btn-primary / .btn-secondary look,
  // so legacy presets and pre-existing saved Supabase rows are visually
  // identical to before this upgrade.
  const heroActions = document.getElementById('heroActions');
  if(heroActions) {
    const hasThemedCta = !!(s.cta1_bg || s.cta2_bg || s.cta1_shadow || s.cta2_shadow);
    heroActions.classList.toggle('hero-cta-themed', hasThemedCta);
    const setVar = (el, name, val) => {
      if(val !== undefined && val !== null && val !== '') el.style.setProperty(name, val);
      else el.style.removeProperty(name);
    };
    if(cta1) {
      setVar(cta1, '--hero-cta1-bg', s.cta1_bg);
      setVar(cta1, '--hero-cta1-color', s.cta1_color);
      setVar(cta1, '--hero-cta1-border', s.cta1_border);
      setVar(cta1, '--hero-cta1-shadow', s.cta1_shadow);
      setVar(cta1, '--hero-cta1-hover-shadow', s.cta1_hover_shadow);
    }
    if(cta2) {
      setVar(cta2, '--hero-cta2-bg', s.cta2_bg);
      setVar(cta2, '--hero-cta2-color', s.cta2_color);
      setVar(cta2, '--hero-cta2-border', s.cta2_border);
      setVar(cta2, '--hero-cta2-shadow', s.cta2_shadow);
      setVar(cta2, '--hero-cta2-hover-shadow', s.cta2_hover_shadow);
    }
  }

  // Layout
  const heroSection = document.getElementById('dynamicHero');
  const heroContent = document.getElementById('heroContent');
  if(heroSection) {
    heroSection.classList.toggle('hero-layout-split', g('layout_style') === 'split');
    heroSection.classList.toggle('hero-layout-centered', g('layout_style') !== 'split');
  }

  // Background
  const heroBg = document.getElementById('heroBg');
  const heroOrb1 = document.getElementById('heroOrb1');
  const heroOrb2 = document.getElementById('heroOrb2');
  const heroOrb3 = document.getElementById('heroOrb3');
  if(heroBg) {
    if(g('hero_bg_type') === 'image' && g('hero_bg_value')) {
      heroSection.style.backgroundImage = `url(${g('hero_bg_value')})`;
      heroSection.style.backgroundSize = 'cover';
      heroSection.style.backgroundPosition = 'center';
    } else if(g('hero_bg_type') === 'gradient' && g('hero_bg_value')) {
      heroSection.style.background = g('hero_bg_value');
    } else if(g('hero_bg_type') === 'solid' && g('hero_bg_value')) {
      heroSection.style.background = g('hero_bg_value');
    }
  }
  const orbsVisible = g('show_orbs');
  if(heroOrb1) heroOrb1.style.display = orbsVisible ? '' : 'none';
  if(heroOrb2) heroOrb2.style.display = orbsVisible ? '' : 'none';
  if(heroOrb3) heroOrb3.style.display = orbsVisible ? '' : 'none';

  // Update orb colors from gradient settings
  if(heroOrb1) heroOrb1.style.background = `radial-gradient(circle, ${g('gradient_start')}, #1e40af)`;
  if(heroOrb2) heroOrb2.style.background = `radial-gradient(circle, ${g('gradient_end')}, #0891b2)`;

  // Background glow
  if(heroBg) {
    heroBg.style.setProperty('--hero-glow', g('bg_glow_color'));
  }

  // Particles
  const particlesEl = document.getElementById('heroParticles');
  if(particlesEl) {
    particlesEl.innerHTML = '';
    if(g('enable_particles')) {
      particlesEl.style.display = 'block';
      for(let i=0;i<18;i++) {
        const p = document.createElement('div');
        p.className = 'hero-particle';
        const size = 4 + Math.random()*8;
        p.style.cssText = `
          width:${size}px;height:${size}px;
          left:${Math.random()*100}%;
          animation-duration:${8+Math.random()*12}s;
          animation-delay:${Math.random()*8}s;
          opacity:${0.15+Math.random()*0.3};
          background:radial-gradient(circle, ${g('gradient_start')}88, transparent);
        `;
        particlesEl.appendChild(p);
      }
    } else {
      particlesEl.style.display = 'none';
    }
  }
}

// ── HERO DESIGNER ADMIN PANEL ─────────────────────────────────────
async function renderHeroDesigner(main) {
  const s = window._heroCurrentSettings || window._heroDefaults;
  const g = (k) => s[k] !== undefined ? s[k] : (window._heroDefaults[k] !== undefined ? window._heroDefaults[k] : '');
  const bool = (k) => g(k) ? 'on' : '';

  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:12px">
    <div>
      <div class="admin-section-title" style="margin-bottom:4px">🎨 Hero Designer</div>
      <div class="admin-section-sub">Design and customize the homepage hero section. All changes saved to Supabase and applied live.</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="heroDesignerPreview()">👁 Preview</button>
      <button class="hd-save-btn" id="hdSaveBtn" onclick="heroDesignerSave()">💾 Save to Supabase</button>
    </div>
  </div>

  <!-- Sub-tabs -->
  <div class="hd-tabs" id="hdTabs">
    <button class="hd-tab active" data-hdtab="content" onclick="hdSwitchTab('content')">📝 Content</button>
    <button class="hd-tab" data-hdtab="typography" onclick="hdSwitchTab('typography')">🔤 Fonts Manager</button>
    <button class="hd-tab" data-hdtab="colors" onclick="hdSwitchTab('colors')">🎨 Colors Manager</button>
    <button class="hd-tab" data-hdtab="animations" onclick="hdSwitchTab('animations')">✨ Animations Manager</button>
    <button class="hd-tab" data-hdtab="background" onclick="hdSwitchTab('background')">🖼 Hero Background</button>
    <button class="hd-tab" data-hdtab="visibility" onclick="hdSwitchTab('visibility')">👁 Show/Hide</button>
    <button class="hd-tab" data-hdtab="premium" onclick="hdSwitchTab('premium')">⭐ Premium</button>
    <button class="hd-tab" data-hdtab="presets" onclick="hdSwitchTab('presets')">🎯 Presets</button>
    <button class="hd-tab" data-hdtab="rotation" onclick="hdSwitchTab('rotation')">🔁 Auto Rotation</button>
  </div>

  <!-- Live Mini Preview -->
  <div class="hd-preview-frame" id="hdPreviewFrame" style="margin-bottom:24px;padding:40px 24px;text-align:center;background:linear-gradient(135deg,#080c14,#0d1220);cursor:pointer" onclick="heroDesignerPreview()" title="Click for full preview">
    <div style="font-size:.65rem;color:rgba(255,255,255,0.3);margin-bottom:16px;letter-spacing:.12em">LIVE MINI PREVIEW — click for full screen</div>
    <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;border:1px solid ${g('badge_border')};background:${g('badge_bg')};color:${g('badge_color')};font-size:.7rem;font-weight:600;margin-bottom:14px">
      <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block"></span>
      ${escH(g('badge_text'))}
    </div>
    <div style="font-size:clamp(1.4rem,4vw,2.2rem);font-weight:800;font-family:${escH(g('font_family'))};color:#eef2ff;margin-bottom:8px;line-height:1.1">
      ${escH(g('main_title'))}<br>
      <span style="background:linear-gradient(135deg,${g('gradient_start')},${g('gradient_mid')},${g('gradient_end')});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${escH(g('highlight_text'))}</span>
    </div>
    <div style="font-size:.8rem;color:#7a8caa;margin-bottom:16px">${escH((g('subtitle_phrases')||'').split('|')[0] || '')}</div>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <span style="padding:7px 18px;border-radius:8px;background:linear-gradient(135deg,${g('gradient_start')},${g('gradient_end')});color:#fff;font-size:.75rem;font-weight:600">${escH(g('cta1_text'))}</span>
      <span style="padding:7px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);color:#eef2ff;font-size:.75rem">${escH(g('cta2_text'))}</span>
    </div>
  </div>

  <!-- ─── CONTENT TAB ─── -->
  <div class="hd-panel active" id="hdPanel-content">
    <div class="hd-section-head">Text Content</div>
    <div class="hd-grid" style="margin-bottom:20px">
      <div class="hd-field">
        <label class="hd-label">Badge Text</label>
        <input class="hd-input" id="hd_badge_text" value="${escH(g('badge_text'))}" oninput="hdLivePreview()" placeholder="Assam's #1 PDF Study Platform">
      </div>
      <div class="hd-field">
        <label class="hd-label">Main Title</label>
        <input class="hd-input" id="hd_main_title" value="${escH(g('main_title'))}" oninput="hdLivePreview()" placeholder="Master Any Subject with">
      </div>
      <div class="hd-field">
        <label class="hd-label">Highlight Text (gradient)</label>
        <input class="hd-input" id="hd_highlight_text" value="${escH(g('highlight_text'))}" oninput="hdLivePreview()" placeholder="Expert PDF Guides">
      </div>
    </div>
    <div class="hd-field" style="margin-bottom:20px">
      <label class="hd-label">Subtitle Phrases (typing effect — separate with |)</label>
      <textarea class="hd-input" id="hd_subtitle_phrases" rows="3" oninput="hdLivePreview()" placeholder="Phrase 1|Phrase 2|Phrase 3">${escH(g('subtitle_phrases'))}</textarea>
    </div>
    <div class="hd-section-head">CTA Buttons</div>
    <div class="hd-grid">
      <div class="hd-field">
        <label class="hd-label">CTA 1 Text</label>
        <input class="hd-input" id="hd_cta1_text" value="${escH(g('cta1_text'))}" oninput="hdLivePreview()">
      </div>
      <div class="hd-field">
        <label class="hd-label">CTA 1 Action (page name)</label>
        <input class="hd-input" id="hd_cta1_action" value="${escH(g('cta1_action'))}" placeholder="library">
      </div>
      <div class="hd-field">
        <label class="hd-label">CTA 2 Text</label>
        <input class="hd-input" id="hd_cta2_text" value="${escH(g('cta2_text'))}" oninput="hdLivePreview()">
      </div>
      <div class="hd-field">
        <label class="hd-label">CTA 2 Action (page name)</label>
        <input class="hd-input" id="hd_cta2_action" value="${escH(g('cta2_action'))}" placeholder="register">
      </div>
    </div>
    <div class="hd-section-head" style="margin-top:20px">Layout Style</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${[['centered','⬛ Centered (default)'],['split','⬜ Split (text | visual)']].map(([v,l]) => `
        <label style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid ${g('layout_style')===v?'var(--accent)':'var(--glass-border)'};background:${g('layout_style')===v?'rgba(61,142,248,0.1)':'var(--glass)'};cursor:pointer">
          <input type="radio" name="hd_layout" value="${v}" ${g('layout_style')===v?'checked':''} onchange="hdLivePreview()" style="accent-color:var(--accent)"> ${l}
        </label>`).join('')}
    </div>
  </div>

  <!-- ─── TYPOGRAPHY TAB ─── -->
  <div class="hd-panel" id="hdPanel-typography">
    <div class="hd-section-head">Font Settings</div>
    <div class="hd-grid" style="margin-bottom:20px">
      <div class="hd-field">
        <label class="hd-label">Font Family</label>
        <select class="hd-input" id="hd_font_family" onchange="hdLivePreview()">
          ${[
            ["Playfair Display, Georgia, serif","Playfair Display (Default)"],
            ["Inter, system-ui, sans-serif","Inter"],
            ["'DM Sans', system-ui, sans-serif","DM Sans"],
            ["Georgia, serif","Georgia"],
            ["'Times New Roman', serif","Times New Roman"],
            ["'Courier New', monospace","Courier New (Mono)"],
          ].map(([val,lab]) => `<option value="${val}" ${g('font_family')===val?'selected':''}>${lab}</option>`).join('')}
        </select>
      </div>
      <div class="hd-field">
        <label class="hd-label">Title Font Size</label>
        <select class="hd-input" id="hd_title_font_size" onchange="hdLivePreview()">
          ${[
            ["clamp(1.5rem,3.4vw,2.4rem)","Responsive (Default)"],
            ["clamp(1.3rem,2.8vw,1.9rem)","Small"],
            ["clamp(1.15rem,2.3vw,1.6rem)","Compact"],
            ["clamp(1.7rem,4.2vw,3rem)","Medium"],
            ["clamp(2rem,5vw,3.6rem)","Large"],
          ].map(([val,lab]) => `<option value="${val}" ${g('title_font_size')===val?'selected':''}>${lab}</option>`).join('')}
        </select>
      </div>
      <div class="hd-field">
        <label class="hd-label">Font Weight</label>
        <select class="hd-input" id="hd_title_font_weight" onchange="hdLivePreview()">
          ${[300,400,500,600,700,800].map(w => `<option value="${w}" ${String(g('title_font_weight'))===String(w)?'selected':''}>${w === 300?'Light':w===400?'Regular':w===500?'Medium':w===600?'Semi-Bold':w===700?'Bold':'Extra Bold'} (${w})</option>`).join('')}
        </select>
      </div>
      <div class="hd-field">
        <label class="hd-label">Title Color</label>
        <div class="hd-color-row">
          <input type="color" class="hd-color-swatch" id="hd_title_color_pick" value="${g('title_color')||'#eef2ff'}" oninput="document.getElementById('hd_title_color').value=this.value;hdLivePreview()">
          <input class="hd-input" id="hd_title_color" value="${escH(g('title_color'))}" oninput="document.getElementById('hd_title_color_pick').value=this.value;hdLivePreview()">
        </div>
      </div>
    </div>
    <div class="hd-section-head">Font Presets</div>
    <div class="hd-preset-grid">
      ${[
        {name:'Editorial',ff:'Playfair Display, Georgia, serif',fw:'800',emoji:'📰'},
        {name:'Modern Sans',ff:'Inter, system-ui, sans-serif',fw:'700',emoji:'🔲'},
        {name:'Soft DM',ff:"'DM Sans', system-ui, sans-serif",fw:'600',emoji:'🌸'},
        {name:'Classic Serif',ff:'Georgia, serif',fw:'800',emoji:'📜'},
        {name:'Bold Impact',ff:'Inter, system-ui, sans-serif',fw:'800',emoji:'💥'},
        {name:'Elegant Thin',ff:'Playfair Display, Georgia, serif',fw:'400',emoji:'✨'},
      ].map(p => `
        <div class="hd-preset" onclick="hdApplyFontPreset(${JSON.stringify(p)})" style="font-family:${p.ff}">
          <div style="font-size:1.2rem">${p.emoji}</div>
          <div style="font-weight:700;margin-top:4px">${p.name}</div>
          <div style="font-size:.7rem;color:var(--text2);margin-top:2px;font-weight:${p.fw}">${p.ff.split(',')[0]}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── COLORS TAB ─── -->
  <div class="hd-panel" id="hdPanel-colors">
    <div class="hd-section-head">Gradient Colors (Highlight Text)</div>
    <div class="hd-grid" style="margin-bottom:20px">
      ${[
        ['gradient_start','Gradient Start','#3d8ef8'],
        ['gradient_mid','Gradient Mid','#8b5cf6'],
        ['gradient_end','Gradient End','#00c8e8'],
      ].map(([k,lab,def]) => `
        <div class="hd-field">
          <label class="hd-label">${lab}</label>
          <div class="hd-color-row">
            <input type="color" class="hd-color-swatch" id="hd_${k}_pick" value="${g(k)||def}" oninput="document.getElementById('hd_${k}').value=this.value;hdLivePreview()">
            <input class="hd-input" id="hd_${k}" value="${escH(g(k))}" oninput="document.getElementById('hd_${k}_pick').value=this.value;hdLivePreview()">
          </div>
        </div>`).join('')}
    </div>
    <div class="hd-section-head">Badge Colors</div>
    <div class="hd-grid" style="margin-bottom:20px">
      <div class="hd-field">
        <label class="hd-label">Badge Background (rgba)</label>
        <input class="hd-input" id="hd_badge_bg" value="${escH(g('badge_bg'))}" placeholder="rgba(61,142,248,0.12)" oninput="hdLivePreview()">
      </div>
      <div class="hd-field">
        <label class="hd-label">Badge Border (rgba)</label>
        <input class="hd-input" id="hd_badge_border" value="${escH(g('badge_border'))}" placeholder="rgba(61,142,248,0.28)" oninput="hdLivePreview()">
      </div>
      <div class="hd-field">
        <label class="hd-label">Badge Text Color</label>
        <div class="hd-color-row">
          <input type="color" class="hd-color-swatch" id="hd_badge_color_pick" value="${g('badge_color')||'#00c8e8'}" oninput="document.getElementById('hd_badge_color').value=this.value;hdLivePreview()">
          <input class="hd-input" id="hd_badge_color" value="${escH(g('badge_color'))}" oninput="document.getElementById('hd_badge_color_pick').value=this.value;hdLivePreview()">
        </div>
      </div>
      <div class="hd-field">
        <label class="hd-label">Background Glow Color (rgba)</label>
        <input class="hd-input" id="hd_bg_glow_color" value="${escH(g('bg_glow_color'))}" placeholder="rgba(61,142,248,0.06)" oninput="hdLivePreview()">
      </div>
    </div>
    <div class="hd-section-head">Premium Color Presets</div>
    <div class="hd-preset-grid">
      ${[
        {name:'Ocean Blue',g1:'#3d8ef8',g2:'#0891b2',g3:'#00c8e8',bc:'rgba(61,142,248,0.12)',bb:'rgba(61,142,248,0.28)',btc:'#00c8e8',emoji:'🌊'},
        {name:'Royal Purple',g1:'#8b5cf6',g2:'#7c3aed',g3:'#c084fc',bc:'rgba(139,92,246,0.12)',bb:'rgba(139,92,246,0.28)',btc:'#c084fc',emoji:'👑'},
        {name:'Sunset Fire',g1:'#f59e0b',g2:'#f97316',g3:'#ef4444',bc:'rgba(245,158,11,0.12)',bb:'rgba(245,158,11,0.28)',btc:'#f59e0b',emoji:'🔥'},
        {name:'Emerald',g1:'#10b981',g2:'#059669',g3:'#34d399',bc:'rgba(16,185,129,0.12)',bb:'rgba(16,185,129,0.28)',btc:'#34d399',emoji:'💚'},
        {name:'Rose Gold',g1:'#f43f5e',g2:'#e11d48',g3:'#fb7185',bc:'rgba(244,63,94,0.12)',bb:'rgba(244,63,94,0.28)',btc:'#fb7185',emoji:'🌹'},
        {name:'Galaxy',g1:'#6366f1',g2:'#8b5cf6',g3:'#06b6d4',bc:'rgba(99,102,241,0.12)',bb:'rgba(99,102,241,0.28)',btc:'#818cf8',emoji:'🌌'},
      ].map(p => `
        <div class="hd-preset" onclick="hdApplyColorPreset(${JSON.stringify(p)})" style="background:linear-gradient(135deg,${p.g1}22,${p.g3}11)">
          <div style="font-size:1.3rem">${p.emoji}</div>
          <div style="background:linear-gradient(135deg,${p.g1},${p.g2},${p.g3});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;margin-top:4px">${p.name}</div>
          <div style="display:flex;gap:4px;justify-content:center;margin-top:6px">
            <span style="width:14px;height:14px;border-radius:50%;background:${p.g1}"></span>
            <span style="width:14px;height:14px;border-radius:50%;background:${p.g2}"></span>
            <span style="width:14px;height:14px;border-radius:50%;background:${p.g3}"></span>
          </div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── ANIMATIONS TAB ─── -->
  <div class="hd-panel" id="hdPanel-animations">
    <div class="hd-section-head">Animation Style</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
      ${[['fadeUp','⬆ Fade Up (default)'],['slide','⬅ Slide In'],['zoom','🔍 Zoom In'],['none','✕ No Animation']].map(([v,l]) => `
        <label style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid ${g('animation_style')===v?'var(--accent)':'var(--glass-border)'};background:${g('animation_style')===v?'rgba(61,142,248,0.1)':'var(--glass)'};cursor:pointer">
          <input type="radio" name="hd_anim" value="${v}" ${g('animation_style')===v?'checked':''} style="accent-color:var(--accent)"> ${l}
        </label>`).join('')}
    </div>
    <div class="hd-section-head">Premium Animation Toggles</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[
        ['enable_typing_effect','⌨ Typing Effect','Typewriter animation for subtitle'],
        ['enable_animated_text','🌊 Animated Gradient','Flowing gradient on highlight text'],
        ['enable_glow_effects','✨ Glow Effects','Text glow pulse on title'],
        ['enable_shine_effect','💫 Shine Effect','Shimmer sweep on badge'],
        ['enable_particles','🎆 Floating Particles','Drifting particle field in background'],
      ].map(([k,t,d]) => `
        <div class="hd-toggle-row">
          <div>
            <div class="hd-toggle-label">${t}</div>
            <div style="font-size:.75rem;color:var(--text2)">${d}</div>
          </div>
          <button class="hd-toggle ${bool(k)}" id="hd_tog_${k}" onclick="hdToggle('${k}',this)"></button>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── BACKGROUND TAB ─── -->
  <div class="hd-panel" id="hdPanel-background">
    <div class="hd-section-head">Hero Background Type</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
      ${[['orbs','🌑 Orbs (default)'],['gradient','🌈 CSS Gradient'],['image','🖼 Image URL'],['solid','⬛ Solid Color']].map(([v,l]) => `
        <label style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid ${g('hero_bg_type')===v?'var(--accent)':'var(--glass-border)'};background:${g('hero_bg_type')===v?'rgba(61,142,248,0.1)':'var(--glass)'};cursor:pointer">
          <input type="radio" name="hd_bg_type" value="${v}" ${g('hero_bg_type')===v?'checked':''} style="accent-color:var(--accent)"> ${l}
        </label>`).join('')}
    </div>
    <div class="hd-field" style="margin-bottom:16px">
      <label class="hd-label">Background Value (image URL / gradient CSS / hex color)</label>
      <input class="hd-input" id="hd_hero_bg_value" value="${escH(g('hero_bg_value'))}" placeholder="https://... or linear-gradient(...) or #080c14">
    </div>
    <div class="hd-section-head">Orb Visibility & Glow</div>
    <div class="hd-toggle-row" style="margin-bottom:10px">
      <div><div class="hd-toggle-label">🌑 Show Background Orbs</div><div style="font-size:.75rem;color:var(--text2)">Floating gradient orbs for depth</div></div>
      <button class="hd-toggle ${bool('show_orbs')}" id="hd_tog_show_orbs" onclick="hdToggle('show_orbs',this)"></button>
    </div>
    <div class="hd-toggle-row">
      <div><div class="hd-toggle-label">✨ Glassmorphism Badge</div><div style="font-size:.75rem;color:var(--text2)">Apply frosted glass effect to badge</div></div>
      <button class="hd-toggle ${bool('enable_glassmorphism')}" id="hd_tog_enable_glassmorphism" onclick="hdToggle('enable_glassmorphism',this)"></button>
    </div>
    <div class="hd-section-head" style="margin-top:20px">Background Presets</div>
    <div class="hd-preset-grid">
      ${[
        {name:'Dark Deep',type:'gradient',val:'linear-gradient(135deg,#080c14,#0d1220)',emoji:'🌑'},
        {name:'Midnight Blue',type:'gradient',val:'linear-gradient(135deg,#0f172a,#1e3a5f)',emoji:'🌌'},
        {name:'Deep Purple',type:'gradient',val:'linear-gradient(135deg,#0d0d1a,#1a0d2e)',emoji:'🍇'},
        {name:'Forest Dark',type:'gradient',val:'linear-gradient(135deg,#0a1a0f,#0d2010)',emoji:'🌲'},
        {name:'Warm Dark',type:'gradient',val:'linear-gradient(135deg,#1a0d00,#2d1a00)',emoji:'🔥'},
        {name:'Pure Black',type:'solid',val:'#000000',emoji:'⬛'},
      ].map(p => `
        <div class="hd-preset" onclick="hdApplyBgPreset(${JSON.stringify(p)})" style="background:${p.type==='gradient'?p.val:p.val}">
          <div style="font-size:1.2rem">${p.emoji}</div>
          <div style="font-weight:700;margin-top:4px;color:#eef2ff">${p.name}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── VISIBILITY TAB ─── -->
  <div class="hd-panel" id="hdPanel-visibility">
    <div class="hd-section-head">Show / Hide Elements</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[
        ['show_badge','🏷 Badge','The pill badge above the title'],
        ['show_site_name','🔤 Site Name','The large Studyria letter animation'],
        ['show_highlight','✨ Highlight Text','Gradient colored text line'],
        ['show_cta2','🔘 Second CTA Button','The secondary action button'],
        ['show_orbs','🌑 Background Orbs','Floating gradient orb elements'],
      ].map(([k,t,d]) => `
        <div class="hd-toggle-row">
          <div>
            <div class="hd-toggle-label">${t}</div>
            <div style="font-size:.75rem;color:var(--text2)">${d}</div>
          </div>
          <button class="hd-toggle ${bool(k)}" id="hd_tog_${k}" onclick="hdToggle('${k}',this)"></button>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── PREMIUM TAB ─── -->
  <div class="hd-panel" id="hdPanel-premium">
    <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:20px;background:linear-gradient(135deg,rgba(139,92,246,0.2),rgba(61,142,248,0.15));border:1px solid rgba(139,92,246,0.3);font-size:.8rem;font-weight:700;color:#a78bfa;margin-bottom:20px">
      ⭐ Premium Design Options
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[
        ['enable_glassmorphism','🪟 Glassmorphism','Frosted glass effect on badge','Premium blur + transparency effect'],
        ['enable_gradient_text','🌈 Gradient Text','Colorful gradient on highlight text','Uses your gradient color settings'],
        ['enable_animated_text','🌊 Animated Text','Flowing gradient animation','Continuously shifts gradient colors'],
        ['enable_particles','🎆 Floating Particles','Ambient particle field in hero','30+ floating dots rising upward'],
        ['enable_glow_effects','✨ Glow Effects','Title text glow pulse','Breathing glow around title text'],
        ['enable_typing_effect','⌨ Typing Effect','Typewriter subtitle animation','Characters appear one by one'],
        ['enable_shine_effect','?? Shine Effect','Badge shimmer sweep','Light sweep passes over badge'],
      ].map(([k,t,d,hint]) => `
        <div class="hd-toggle-row" style="border:1px solid rgba(139,92,246,0.15)">
          <div>
            <div class="hd-toggle-label">${t}</div>
            <div style="font-size:.75rem;color:var(--text2)">${d}</div>
            <div style="font-size:.7rem;color:rgba(139,92,246,0.7);margin-top:2px">${hint}</div>
          </div>
          <button class="hd-toggle ${bool(k)}" id="hd_tog_${k}" onclick="hdToggle('${k}',this)"></button>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── PRESETS TAB ─── -->
  <div class="hd-panel" id="hdPanel-presets">
    <div class="hd-section-head">Complete Hero Presets</div>
    <div class="hd-preset-grid">
      ${[
        {name:'Classic Studyria',emoji:'📚',desc:'Default premium dark theme',preset:'classic'},
        {name:'Purple Galaxy',emoji:'🌌',desc:'Deep purple space vibes',preset:'galaxy'},
        {name:'Emerald Scholar',emoji:'🌿',desc:'Fresh green academic',preset:'emerald'},
        {name:'Sunrise Gold',emoji:'🌅',desc:'Warm amber + orange energy',preset:'gold'},
        {name:'Rose Bloom',emoji:'🌸',desc:'Modern pink gradient',preset:'rose'},
        {name:'Ocean Depth',emoji:'🌊',desc:'Deep blue underwater feel',preset:'ocean'},
        {name:'Minimal White',emoji:'⬜',desc:'Clean centered, light mode feel',preset:'minimal'},
        {name:'Neon Cyber',emoji:'💜',desc:'Electric purple + cyan',preset:'neon'},
      ].map(p => `
        <div class="hd-preset" onclick="hdApplyFullPreset('${p.preset}')">
          <div style="font-size:1.5rem">${p.emoji}</div>
          <div style="font-weight:700;margin-top:6px">${p.name}</div>
          <div style="font-size:.7rem;color:var(--text2);margin-top:3px">${p.desc}</div>
          <div style="margin-top:8px;padding:4px 10px;border-radius:6px;background:var(--accent);color:#fff;font-size:.7rem;font-weight:600">Apply</div>
        </div>`).join('')}
    </div>

    <div class="hd-section-head" style="margin-top:26px">⭐ Premium Theme Engine — New Presets</div>
    <div class="hd-preset-grid">
      ${HD_PREMIUM_PRESET_META.map(p => `
        <div class="hd-preset hd-preset-premium" onclick="hdApplyFullPreset('${p.preset}')">
          <span class="hd-preset-premium-tag">PRO</span>
          <div style="font-size:1.5rem">${p.emoji}</div>
          <div style="font-weight:700;margin-top:6px">${p.name}</div>
          <div style="font-size:.7rem;color:var(--text2);margin-top:3px">${p.desc}</div>
          <div style="margin-top:8px;padding:4px 10px;border-radius:6px;background:linear-gradient(135deg,${p.swatch1},${p.swatch2});color:#fff;font-size:.7rem;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,0.4)">Apply</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ─── ROTATION TAB ─── -->
  <div class="hd-panel" id="hdPanel-rotation">
    ${hdRenderRotationPanel()}
  </div>

  <div style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
    <button class="hd-save-btn" onclick="heroDesignerSave()">💾 Save All Changes to Supabase</button>
    <button class="btn btn-ghost btn-sm" onclick="heroDesignerPreview()">👁 Full Preview</button>
    <button class="btn btn-ghost btn-sm" onclick="hdResetToDefaults()">↩ Reset Defaults</button>
    <span id="hdSaveStatus" style="font-size:.82rem;color:var(--text2)"></span>
  </div>`;

  // Activate first tab
  hdSwitchTab('content');
}

// Helper: escape HTML for insertion into innerHTML attribute values
function escH(str) {
  if(str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hdSwitchTab(tab) {
  document.querySelectorAll('.hd-tab').forEach(b => b.classList.toggle('active', b.dataset.hdtab === tab));
  document.querySelectorAll('.hd-panel').forEach(p => p.classList.toggle('active', p.id === `hdPanel-${tab}`));
}

function hdToggle(key, btn) {
  btn.classList.toggle('on');
  // immediate live update to hero
  const settings = hdCollectSettings();
  heroApplySettings(settings);
  hdRefreshMiniPreview(settings);
}

function hdCollectSettings() {
  const r = { ...window._heroCurrentSettings, ...window._heroDefaults };
  // Text content
  const f = (id, key) => { const el = document.getElementById(id); if(el) r[key] = el.value; };
  f('hd_badge_text','badge_text'); f('hd_main_title','main_title');
  f('hd_highlight_text','highlight_text'); f('hd_subtitle_phrases','subtitle_phrases');
  f('hd_cta1_text','cta1_text'); f('hd_cta1_action','cta1_action');
  f('hd_cta2_text','cta2_text'); f('hd_cta2_action','cta2_action');
  // Typography
  f('hd_font_family','font_family'); f('hd_title_font_size','title_font_size');
  f('hd_title_font_weight','title_font_weight'); f('hd_title_color','title_color');
  // Colors
  f('hd_gradient_start','gradient_start'); f('hd_gradient_mid','gradient_mid');
  f('hd_gradient_end','gradient_end'); f('hd_badge_bg','badge_bg');
  f('hd_badge_border','badge_border'); f('hd_badge_color','badge_color');
  f('hd_bg_glow_color','bg_glow_color');
  // Background
  const bgType = document.querySelector('input[name="hd_bg_type"]:checked');
  if(bgType) r.hero_bg_type = bgType.value;
  f('hd_hero_bg_value','hero_bg_value');
  // Layout
  const layout = document.querySelector('input[name="hd_layout"]:checked');
  if(layout) r.layout_style = layout.value;
  // Animation style
  const anim = document.querySelector('input[name="hd_anim"]:checked');
  if(anim) r.animation_style = anim.value;
  // Toggles
  const toggleKeys = ['show_badge','show_site_name','show_highlight','show_cta2','show_orbs',
    'enable_glassmorphism','enable_gradient_text','enable_animated_text','enable_particles',
    'enable_glow_effects','enable_typing_effect','enable_shine_effect'];
  toggleKeys.forEach(k => {
    const tog = document.getElementById(`hd_tog_${k}`);
    if(tog) r[k] = tog.classList.contains('on');
  });
  return r;
}

function hdLivePreview() {
  const settings = hdCollectSettings();
  heroApplySettings(settings);
  hdRefreshMiniPreview(settings);
}

function hdRefreshMiniPreview(s) {
  const g = (k) => s[k] !== undefined ? s[k] : (window._heroDefaults[k] || '');
  const frame = document.getElementById('hdPreviewFrame');
  if(!frame) return;
  const previewContent = frame.querySelector('[data-preview-inner]');
  if(previewContent) {
    previewContent.innerHTML = `
      <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;border:1px solid ${escH(g('badge_border'))};background:${escH(g('badge_bg'))};color:${escH(g('badge_color'))};font-size:.7rem;font-weight:600;margin-bottom:14px">
        <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block"></span>
        ${escH(g('badge_text'))}
      </div>
      <div style="font-size:clamp(1.2rem,3vw,1.8rem);font-weight:${g('title_font_weight')};font-family:${escH(g('font_family'))};color:${escH(g('title_color'))};margin-bottom:6px;line-height:1.1">
        ${escH(g('main_title'))}<br>
        <span style="background:linear-gradient(135deg,${g('gradient_start')},${g('gradient_mid')},${g('gradient_end')});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${escH(g('highlight_text'))}</span>
      </div>`;
  }
}

function hdApplyColorPreset(p) {
  const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; const pick = document.getElementById(id+'_pick'); if(pick) pick.value = (val.startsWith('#')&&val.length<=7?val:'#3d8ef8'); };
  setVal('hd_gradient_start', p.g1); setVal('hd_gradient_mid', p.g2); setVal('hd_gradient_end', p.g3);
  const bb = document.getElementById('hd_badge_bg'); if(bb) bb.value = p.bc;
  const bbo = document.getElementById('hd_badge_border'); if(bbo) bbo.value = p.bb;
  const btc = document.getElementById('hd_badge_color'); if(btc) btc.value = p.btc;
  const btcp = document.getElementById('hd_badge_color_pick'); if(btcp) try{btcp.value=p.btc}catch(e){}
  hdLivePreview();
  showToast(`Color preset "${p.name}" applied!`, 'success');
}

function hdApplyFontPreset(p) {
  const ffEl = document.getElementById('hd_font_family'); if(ffEl) ffEl.value = p.ff;
  const fwEl = document.getElementById('hd_title_font_weight'); if(fwEl) fwEl.value = p.fw;
  hdLivePreview();
  showToast(`Font preset "${p.name}" applied!`, 'success');
}

function hdApplyBgPreset(p) {
  const btEl = document.querySelector(`input[name="hd_bg_type"][value="${p.type}"]`);
  if(btEl) { btEl.checked = true; }
  const bvEl = document.getElementById('hd_hero_bg_value'); if(bvEl) bvEl.value = p.val;
  hdLivePreview();
  showToast(`Background "${p.name}" applied!`, 'success');
}

// ══════════════════════════════════════════════════════════════════
// PREMIUM THEME ENGINE — 16 new premium presets (added; legacy 7/8
// presets above are untouched). Each preset is a settings object
// compatible with the legacy hdApplyFullPreset() shape PLUS new
// optional CTA/shadow/glow fields consumed by heroApplySettings() for
// unique button design, badge shadow, title glow-shadow and hover
// states. These new fields are additive — ignored by any code path
// that doesn't know about them — so the original presets remain
// byte-for-byte visually unaffected.
// ══════════════════════════════════════════════════════════════════
const HD_PREMIUM_PRESETS = {

  'neon-rambo': {
    gradient_start:'#ff003c', gradient_mid:'#ff7a00', gradient_end:'#ffe000',
    badge_bg:'rgba(255,0,60,0.16)', badge_border:'rgba(255,122,0,0.4)', badge_color:'#ffae00',
    hero_bg_type:'solid', hero_bg_value:'#0a0000', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:true,
    font_family:'Oswald, Impact, sans-serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#ff003c,#ff7a00)', cta1_color:'#0a0000', cta1_border:'transparent',
    cta1_shadow:'0 10px 32px rgba(255,60,0,0.55)', cta1_hover_shadow:'0 14px 44px rgba(255,140,0,0.75)',
    cta2_bg:'rgba(255,224,0,0.08)', cta2_color:'#ffe000', cta2_border:'rgba(255,224,0,0.4)',
    cta2_shadow:'0 0 0 1px rgba(255,224,0,0.25)', cta2_hover_shadow:'0 0 24px rgba(255,224,0,0.4)',
    badge_shadow:'0 4px 18px rgba(255,60,0,0.35)',
    title_shadow:'0 0 26px rgba(255,122,0,0.45)',
  },

  'minimal-white-pro': {
    gradient_start:'#0f172a', gradient_mid:'#334155', gradient_end:'#64748b',
    badge_bg:'rgba(15,23,42,0.05)', badge_border:'rgba(15,23,42,0.15)', badge_color:'#334155',
    hero_bg_type:'solid', hero_bg_value:'#fbfbfc', show_orbs:false,
    enable_gradient_text:false, enable_animated_text:false, enable_typing_effect:false,
    enable_particles:false, enable_glow_effects:false, enable_shine_effect:false,
    font_family:'Inter, system-ui, sans-serif', title_color:'#0f172a', layout_style:'centered',
    cta1_bg:'#0f172a', cta1_color:'#ffffff', cta1_border:'transparent',
    cta1_shadow:'0 6px 20px rgba(15,23,42,0.18)', cta1_hover_shadow:'0 10px 26px rgba(15,23,42,0.28)',
    cta2_bg:'transparent', cta2_color:'#0f172a', cta2_border:'rgba(15,23,42,0.2)',
    cta2_shadow:'none', cta2_hover_shadow:'0 4px 14px rgba(15,23,42,0.12)',
    badge_shadow:'0 2px 10px rgba(15,23,42,0.06)',
    title_shadow:'none',
  },

  'royal-sapphire': {
    gradient_start:'#1e3a8a', gradient_mid:'#2563eb', gradient_end:'#60a5fa',
    badge_bg:'rgba(30,58,138,0.16)', badge_border:'rgba(96,165,250,0.35)', badge_color:'#93c5fd',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#020617,#0a1340,#020617)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:true, enable_shine_effect:false,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#1e3a8a,#2563eb)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 30px rgba(37,99,235,0.45)', cta1_hover_shadow:'0 14px 40px rgba(37,99,235,0.6)',
    cta2_bg:'rgba(96,165,250,0.08)', cta2_color:'#93c5fd', cta2_border:'rgba(96,165,250,0.35)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(96,165,250,0.3)',
    badge_shadow:'0 4px 16px rgba(37,99,235,0.25)',
    title_shadow:'0 0 24px rgba(37,99,235,0.35)',
  },

  'crimson-elite': {
    gradient_start:'#7f1d1d', gradient_mid:'#dc2626', gradient_end:'#f87171',
    badge_bg:'rgba(127,29,29,0.18)', badge_border:'rgba(220,38,38,0.4)', badge_color:'#f87171',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0d0303,#1f0606)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:true, enable_shine_effect:true,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#7f1d1d,#dc2626)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 30px rgba(220,38,38,0.5)', cta1_hover_shadow:'0 14px 40px rgba(248,113,113,0.65)',
    cta2_bg:'rgba(248,113,113,0.08)', cta2_color:'#f87171', cta2_border:'rgba(248,113,113,0.35)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(248,113,113,0.35)',
    badge_shadow:'0 4px 18px rgba(220,38,38,0.3)',
    title_shadow:'0 0 24px rgba(220,38,38,0.4)',
  },

  'arctic-aurora': {
    gradient_start:'#22d3ee', gradient_mid:'#67e8f9', gradient_end:'#a7f3d0',
    badge_bg:'rgba(34,211,238,0.12)', badge_border:'rgba(167,243,208,0.35)', badge_color:'#a7f3d0',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#031620,#04222e,#031620)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:false,
    font_family:'Inter, system-ui, sans-serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#22d3ee,#a7f3d0)', cta1_color:'#031620', cta1_border:'transparent',
    cta1_shadow:'0 10px 28px rgba(34,211,238,0.4)', cta1_hover_shadow:'0 14px 38px rgba(167,243,208,0.5)',
    cta2_bg:'rgba(167,243,208,0.08)', cta2_color:'#a7f3d0', cta2_border:'rgba(167,243,208,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(167,243,208,0.35)',
    badge_shadow:'0 4px 16px rgba(34,211,238,0.22)',
    title_shadow:'0 0 22px rgba(34,211,238,0.3)',
  },

  'midnight-luxe': {
    gradient_start:'#d4af37', gradient_mid:'#f5d76e', gradient_end:'#fff7c2',
    badge_bg:'rgba(212,175,55,0.12)', badge_border:'rgba(245,215,110,0.35)', badge_color:'#f5d76e',
    hero_bg_type:'solid', hero_bg_value:'#070707', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:false, enable_shine_effect:true,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#3a3a3a,#1a1a1a)', cta1_color:'#f5d76e', cta1_border:'rgba(212,175,55,0.4)',
    cta1_shadow:'0 10px 26px rgba(0,0,0,0.6)', cta1_hover_shadow:'0 12px 32px rgba(212,175,55,0.3)',
    cta2_bg:'transparent', cta2_color:'#f5d76e', cta2_border:'rgba(212,175,55,0.35)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 18px rgba(212,175,55,0.25)',
    badge_shadow:'0 4px 14px rgba(0,0,0,0.4)',
    title_shadow:'none',
  },

  'sunset-horizon': {
    gradient_start:'#fb923c', gradient_mid:'#f472b6', gradient_end:'#c084fc',
    badge_bg:'rgba(251,146,60,0.14)', badge_border:'rgba(244,114,182,0.35)', badge_color:'#f9a8d4',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#1a0a14,#2d0f1f,#1a0a14)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:false, enable_shine_effect:false,
    font_family:'Poppins, system-ui, sans-serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#fb923c,#f472b6)', cta1_color:'#1a0a14', cta1_border:'transparent',
    cta1_shadow:'0 10px 28px rgba(244,114,182,0.4)', cta1_hover_shadow:'0 14px 36px rgba(192,132,252,0.5)',
    cta2_bg:'rgba(192,132,252,0.1)', cta2_color:'#c084fc', cta2_border:'rgba(192,132,252,0.35)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 20px rgba(192,132,252,0.35)',
    badge_shadow:'0 4px 16px rgba(244,114,182,0.25)',
    title_shadow:'none',
  },

  'forest-academia': {
    gradient_start:'#14532d', gradient_mid:'#15803d', gradient_end:'#86efac',
    badge_bg:'rgba(20,83,45,0.16)', badge_border:'rgba(134,239,172,0.3)', badge_color:'#86efac',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#040d06,#08160a)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:false, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:false, enable_shine_effect:false,
    font_family:'Merriweather, Georgia, serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#14532d,#15803d)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 26px rgba(21,128,61,0.4)', cta1_hover_shadow:'0 12px 32px rgba(134,239,172,0.4)',
    cta2_bg:'rgba(134,239,172,0.08)', cta2_color:'#86efac', cta2_border:'rgba(134,239,172,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 18px rgba(134,239,172,0.3)',
    badge_shadow:'0 4px 14px rgba(21,128,61,0.22)',
    title_shadow:'none',
  },

  'platinum-prestige': {
    gradient_start:'#9ca3af', gradient_mid:'#e5e7eb', gradient_end:'#ffffff',
    badge_bg:'rgba(229,231,235,0.1)', badge_border:'rgba(229,231,235,0.3)', badge_color:'#e5e7eb',
    hero_bg_type:'solid', hero_bg_value:'#0b0c0e', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:false, enable_shine_effect:true,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#e5e7eb,#9ca3af)', cta1_color:'#0b0c0e', cta1_border:'transparent',
    cta1_shadow:'0 10px 26px rgba(229,231,235,0.25)', cta1_hover_shadow:'0 12px 34px rgba(255,255,255,0.35)',
    cta2_bg:'transparent', cta2_color:'#e5e7eb', cta2_border:'rgba(229,231,235,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 18px rgba(229,231,235,0.25)',
    badge_shadow:'0 4px 14px rgba(255,255,255,0.1)',
    title_shadow:'none',
  },

  'electric-fusion': {
    gradient_start:'#06b6d4', gradient_mid:'#a855f7', gradient_end:'#ec4899',
    badge_bg:'rgba(168,85,247,0.14)', badge_border:'rgba(236,72,153,0.35)', badge_color:'#ec4899',
    hero_bg_type:'solid', hero_bg_value:'#06020c', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:true,
    font_family:'Poppins, system-ui, sans-serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#06b6d4,#a855f7,#ec4899)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 30px rgba(168,85,247,0.5)', cta1_hover_shadow:'0 14px 40px rgba(236,72,153,0.6)',
    cta2_bg:'rgba(6,182,212,0.08)', cta2_color:'#67e8f9', cta2_border:'rgba(6,182,212,0.35)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 24px rgba(6,182,212,0.4)',
    badge_shadow:'0 4px 18px rgba(168,85,247,0.3)',
    title_shadow:'0 0 26px rgba(168,85,247,0.4)',
  },

  'golden-empire': {
    gradient_start:'#92400e', gradient_mid:'#f59e0b', gradient_end:'#fde68a',
    badge_bg:'rgba(146,64,14,0.16)', badge_border:'rgba(253,230,138,0.35)', badge_color:'#fde68a',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#140a00,#241200)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:true, enable_shine_effect:true,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#92400e,#f59e0b)', cta1_color:'#140a00', cta1_border:'transparent',
    cta1_shadow:'0 10px 28px rgba(245,158,11,0.45)', cta1_hover_shadow:'0 14px 38px rgba(253,230,138,0.55)',
    cta2_bg:'rgba(253,230,138,0.08)', cta2_color:'#fde68a', cta2_border:'rgba(253,230,138,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(253,230,138,0.35)',
    badge_shadow:'0 4px 18px rgba(245,158,11,0.3)',
    title_shadow:'0 0 24px rgba(245,158,11,0.35)',
  },

  'cosmic-indigo': {
    gradient_start:'#312e81', gradient_mid:'#4338ca', gradient_end:'#818cf8',
    badge_bg:'rgba(49,46,129,0.18)', badge_border:'rgba(129,140,248,0.35)', badge_color:'#a5b4fc',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#040414,#0c0a2e,#040414)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:false,
    font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#312e81,#4338ca)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 28px rgba(67,56,202,0.45)', cta1_hover_shadow:'0 14px 38px rgba(129,140,248,0.55)',
    cta2_bg:'rgba(129,140,248,0.08)', cta2_color:'#a5b4fc', cta2_border:'rgba(129,140,248,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(129,140,248,0.35)',
    badge_shadow:'0 4px 18px rgba(67,56,202,0.3)',
    title_shadow:'0 0 26px rgba(67,56,202,0.4)',
  },

  'ruby-flame': {
    gradient_start:'#9f1239', gradient_mid:'#e11d48', gradient_end:'#fb7185',
    badge_bg:'rgba(159,18,57,0.16)', badge_border:'rgba(251,113,133,0.35)', badge_color:'#fb7185',
    hero_bg_type:'solid', hero_bg_value:'#100005', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:true,
    font_family:'Oswald, Impact, sans-serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#9f1239,#e11d48)', cta1_color:'#fff', cta1_border:'transparent',
    cta1_shadow:'0 10px 30px rgba(225,29,72,0.5)', cta1_hover_shadow:'0 14px 40px rgba(251,113,133,0.6)',
    cta2_bg:'rgba(251,113,133,0.08)', cta2_color:'#fb7185', cta2_border:'rgba(251,113,133,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(251,113,133,0.35)',
    badge_shadow:'0 4px 18px rgba(225,29,72,0.32)',
    title_shadow:'0 0 26px rgba(225,29,72,0.4)',
  },

  'aqua-crystal': {
    gradient_start:'#0891b2', gradient_mid:'#22d3ee', gradient_end:'#cffafe',
    badge_bg:'rgba(8,145,178,0.14)', badge_border:'rgba(207,250,254,0.35)', badge_color:'#a5f3fc',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#00141a,#012230,#00141a)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:false, enable_shine_effect:true,
    font_family:'Inter, system-ui, sans-serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#0891b2,#22d3ee)', cta1_color:'#00141a', cta1_border:'transparent',
    cta1_shadow:'0 10px 26px rgba(34,211,238,0.4)', cta1_hover_shadow:'0 14px 36px rgba(207,250,254,0.5)',
    cta2_bg:'rgba(207,250,254,0.08)', cta2_color:'#cffafe', cta2_border:'rgba(207,250,254,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 20px rgba(207,250,254,0.35)',
    badge_shadow:'0 4px 16px rgba(34,211,238,0.25)',
    title_shadow:'none',
  },

  'obsidian-black': {
    gradient_start:'#3f3f46', gradient_mid:'#71717a', gradient_end:'#d4d4d8',
    badge_bg:'rgba(63,63,70,0.2)', badge_border:'rgba(212,212,216,0.25)', badge_color:'#d4d4d8',
    hero_bg_type:'solid', hero_bg_value:'#000000', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:false, enable_typing_effect:true,
    enable_particles:false, enable_glow_effects:false, enable_shine_effect:false,
    font_family:'Inter, system-ui, sans-serif', title_font_weight:'800', layout_style:'centered',
    cta1_bg:'#d4d4d8', cta1_color:'#000000', cta1_border:'transparent',
    cta1_shadow:'0 10px 26px rgba(0,0,0,0.6)', cta1_hover_shadow:'0 12px 32px rgba(212,212,216,0.3)',
    cta2_bg:'transparent', cta2_color:'#d4d4d8', cta2_border:'rgba(212,212,216,0.25)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 16px rgba(212,212,216,0.2)',
    badge_shadow:'0 4px 14px rgba(0,0,0,0.5)',
    title_shadow:'none',
  },

  'aurora-dream': {
    gradient_start:'#34d399', gradient_mid:'#60a5fa', gradient_end:'#f0abfc',
    badge_bg:'rgba(96,165,250,0.14)', badge_border:'rgba(240,171,252,0.35)', badge_color:'#f0abfc',
    hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#04101a,#0a1530,#190a2e)', show_orbs:false,
    enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true,
    enable_particles:true, enable_glow_effects:true, enable_shine_effect:false,
    font_family:'Poppins, system-ui, sans-serif', title_font_weight:'700', layout_style:'centered',
    cta1_bg:'linear-gradient(135deg,#34d399,#60a5fa,#f0abfc)', cta1_color:'#04101a', cta1_border:'transparent',
    cta1_shadow:'0 10px 28px rgba(96,165,250,0.45)', cta1_hover_shadow:'0 14px 38px rgba(240,171,252,0.55)',
    cta2_bg:'rgba(240,171,252,0.08)', cta2_color:'#f0abfc', cta2_border:'rgba(240,171,252,0.3)',
    cta2_shadow:'none', cta2_hover_shadow:'0 0 22px rgba(240,171,252,0.35)',
    badge_shadow:'0 4px 18px rgba(96,165,250,0.28)',
    title_shadow:'0 0 24px rgba(96,165,250,0.35)',
  },

};

// Display metadata (name/emoji/desc/swatches) for the 16 premium
// presets above — used to render preset cards in the Presets tab and
// the Multi Preset Selector in the Auto Rotation tab. Keys here line
// up 1:1 with HD_PREMIUM_PRESETS keys.
const HD_PREMIUM_PRESET_META = [
  {name:'Neon Rambo Premium', emoji:'🔥', desc:'High-voltage red/orange action energy', preset:'neon-rambo',       swatch1:'#ff003c', swatch2:'#ffe000'},
  {name:'Minimal White',      emoji:'⚪', desc:'Refined light mode with deep navy CTA',  preset:'minimal-white-pro', swatch1:'#0f172a', swatch2:'#64748b'},
  {name:'Royal Sapphire',     emoji:'💎', desc:'Deep royal blue, regal and premium',     preset:'royal-sapphire',    swatch1:'#1e3a8a', swatch2:'#60a5fa'},
  {name:'Crimson Elite',      emoji:'🩸', desc:'Bold crimson red, high-stakes energy',   preset:'crimson-elite',     swatch1:'#7f1d1d', swatch2:'#f87171'},
  {name:'Arctic Aurora',      emoji:'❄️', desc:'Icy cyan/mint glacier aesthetic',        preset:'arctic-aurora',     swatch1:'#22d3ee', swatch2:'#a7f3d0'},
  {name:'Midnight Luxe',      emoji:'🕯️', desc:'Black + gold, after-hours luxury',       preset:'midnight-luxe',     swatch1:'#1a1a1a', swatch2:'#d4af37'},
  {name:'Sunset Horizon',     emoji:'🌇', desc:'Orange-pink-violet dusk gradient',       preset:'sunset-horizon',    swatch1:'#fb923c', swatch2:'#c084fc'},
  {name:'Forest Academia',    emoji:'🌳', desc:'Deep green, serious scholarly tone',     preset:'forest-academia',   swatch1:'#14532d', swatch2:'#86efac'},
  {name:'Platinum Prestige',  emoji:'🥈', desc:'Silver-white metallic premium finish',  preset:'platinum-prestige', swatch1:'#9ca3af', swatch2:'#ffffff'},
  {name:'Electric Fusion',    emoji:'⚡', desc:'Cyan-violet-pink tri-tone energy',       preset:'electric-fusion',   swatch1:'#06b6d4', swatch2:'#ec4899'},
  {name:'Golden Empire',      emoji:'👑', desc:'Bronze-to-gold imperial richness',       preset:'golden-empire',     swatch1:'#92400e', swatch2:'#fde68a'},
  {name:'Cosmic Indigo',      emoji:'🪐', desc:'Deep indigo-violet starfield depth',     preset:'cosmic-indigo',     swatch1:'#312e81', swatch2:'#818cf8'},
  {name:'Ruby Flame',         emoji:'❤️‍🔥', desc:'Fiery ruby red with ember glow',         preset:'ruby-flame',        swatch1:'#9f1239', swatch2:'#fb7185'},
  {name:'Aqua Crystal',       emoji:'💧', desc:'Crystal-clear teal/cyan freshness',      preset:'aqua-crystal',      swatch1:'#0891b2', swatch2:'#cffafe'},
  {name:'Obsidian Black',     emoji:'⬛', desc:'Pure matte black, ultra-minimal mono',    preset:'obsidian-black',    swatch1:'#000000', swatch2:'#d4d4d8'},
  {name:'Aurora Dream',       emoji:'🌈', desc:'Mint-blue-orchid dreamlike aurora',      preset:'aurora-dream',      swatch1:'#34d399', swatch2:'#f0abfc'},
];

function hdApplyFullPreset(preset) {
  const presets = {
    classic: { gradient_start:'#3d8ef8', gradient_mid:'#8b5cf6', gradient_end:'#00c8e8', badge_bg:'rgba(61,142,248,0.12)', badge_border:'rgba(61,142,248,0.28)', badge_color:'#00c8e8', hero_bg_type:'orbs', show_orbs:true, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered', badge_text:"Assam's #1 Smartest Growth Ecosystem", main_title:"Assam's Ultimate Gateway to Education and Career Growth", highlight_text:"Studyria™ Premium Growth Hub" },
    galaxy: { gradient_start:'#8b5cf6', gradient_mid:'#6d28d9', gradient_end:'#c084fc', badge_bg:'rgba(139,92,246,0.12)', badge_border:'rgba(139,92,246,0.3)', badge_color:'#c084fc', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0d0d1a,#1a0d2e,#0d0d1a)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:true, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    emerald: { gradient_start:'#10b981', gradient_mid:'#059669', gradient_end:'#34d399', badge_bg:'rgba(16,185,129,0.12)', badge_border:'rgba(16,185,129,0.3)', badge_color:'#34d399', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0a1a0f,#0d2010)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', layout_style:'centered' },
    gold: { gradient_start:'#f59e0b', gradient_mid:'#f97316', gradient_end:'#fbbf24', badge_bg:'rgba(245,158,11,0.15)', badge_border:'rgba(245,158,11,0.35)', badge_color:'#f59e0b', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#1a0d00,#2d1a00)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:true, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    rose: { gradient_start:'#f43f5e', gradient_mid:'#e11d48', gradient_end:'#fb7185', badge_bg:'rgba(244,63,94,0.12)', badge_border:'rgba(244,63,94,0.3)', badge_color:'#fb7185', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#1a0010,#2d0020)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    ocean: { gradient_start:'#0ea5e9', gradient_mid:'#0284c7', gradient_end:'#38bdf8', badge_bg:'rgba(14,165,233,0.12)', badge_border:'rgba(14,165,233,0.3)', badge_color:'#38bdf8', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0c1a2e,#0f2848)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', layout_style:'centered' },
    minimal: { gradient_start:'#1e293b', gradient_mid:'#334155', gradient_end:'#475569', badge_bg:'rgba(30,41,59,0.08)', badge_border:'rgba(30,41,59,0.2)', badge_color:'#475569', hero_bg_type:'solid', hero_bg_value:'#ffffff', show_orbs:false, enable_gradient_text:false, enable_animated_text:false, enable_typing_effect:false, enable_particles:false, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', title_color:'#0f172a', layout_style:'centered' },
    neon: { gradient_start:'#a855f7', gradient_mid:'#7c3aed', gradient_end:'#06b6d4', badge_bg:'rgba(168,85,247,0.15)', badge_border:'rgba(168,85,247,0.35)', badge_color:'#06b6d4', hero_bg_type:'solid', hero_bg_value:'#050010', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:true, enable_shine_effect:true, font_family:'Inter, system-ui, sans-serif', title_font_weight:'800', layout_style:'centered' },
    // ── Premium presets merged in (spread operator keeps legacy entries
    // above completely intact and unmodified) ──
    ...HD_PREMIUM_PRESETS,
  };
  const p = presets[preset];
  if(!p) return;
  window._heroCurrentSettings = { ...window._heroDefaults, ...window._heroCurrentSettings, ...p };
  heroApplySettings(window._heroCurrentSettings);
  // Re-render the panel to reflect new values
  const main = document.getElementById('adminMain');
  if(main) renderHeroDesigner(main);
  showToast(`Preset applied! Click "Save" to keep it.`, 'success');
}

function hdResetToDefaults() {
  if(!confirm('Reset hero to defaults?')) return;
  window._heroCurrentSettings = { ...window._heroDefaults };
  heroApplySettings(window._heroCurrentSettings);
  const main = document.getElementById('adminMain');
  if(main) renderHeroDesigner(main);
  showToast('Hero reset to defaults.', 'info');
}

function heroDesignerPreview() {
  const settings = hdCollectSettings();
  heroApplySettings(settings);
  // Scroll to hero
  const hero = document.getElementById('dynamicHero');
  if(hero) { navigate('home'); setTimeout(() => hero.scrollIntoView({behavior:'smooth'}), 300); }
}

async function heroDesignerSave() {
  const btn = document.getElementById('hdSaveBtn');
  const status = document.getElementById('hdSaveStatus');
  const settings = hdCollectSettings();

  if(btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  if(status) status.textContent = '';

  // Apply immediately
  heroApplySettings(settings);
  window._heroCurrentSettings = settings;

  if(!window.supabaseClient) {
    if(btn) { btn.disabled=false; btn.textContent='💾 Save to Supabase'; }
    showToast('Supabase not connected — preview only.','info');
    return;
  }

  try {
    const payload = { id: 1, ...settings, updated_at: new Date().toISOString() };
    const { error } = await window.supabaseClient
      .from('hero_settings').upsert(payload, { onConflict:'id' });
    if(error) throw error;
    if(btn) { btn.disabled=false; btn.textContent='💾 Save to Supabase'; }
    if(status) status.textContent = '✅ Saved!';
    showToast('Hero settings saved to Supabase!','success');
    setTimeout(() => { if(status) status.textContent=''; }, 4000);
  } catch(e) {
    if(btn) { btn.disabled=false; btn.textContent='💾 Save to Supabase'; }
    if(status) status.textContent = '❌ ' + e.message;
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// AUTO PRESET ROTATION ENGINE
// ══════════════════════════════════════════════════════════════════
// Lets the admin select multiple presets (built-in or premium) that
// automatically rotate once every 24 hours at local midnight, with no
// manual intervention. Live on the homepage with zero page reload —
// the swap is applied directly through heroApplySettings() the same
// way a manual preset click would, wrapped in a brief CSS transition
// for a smooth crossfade between themes.
//
// Storage: Supabase table `hero_rotation_settings` (id=1 singleton),
// mirrored to localStorage as an offline/instant-boot cache so the
// homepage can apply the correct preset before the network round trip
// completes. Schema:
//   rotation_enabled   boolean
//   selected_presets   text[]      -- preset keys, built-in or premium
//   current_preset     text
//   next_preset        text
//   rotation_schedule  jsonb       -- { days: [0-6], mode: 'daily'|'weekly' }
//   last_rotation_time timestamptz
//   rotation_history   jsonb       -- array of {preset, at} entries (capped)
// ══════════════════════════════════════════════════════════════════

const HD_ROTATION_CACHE_KEY = 'studyria_hero_rotation';
const HD_ROTATION_HISTORY_LIMIT = 20;

// All preset keys the rotation engine is allowed to pick from — both
// legacy built-ins and the new premium 16, by key (not display name).
function hdAllRotationPresetKeys() {
  return [
    'classic','galaxy','emerald','gold','rose','ocean','minimal','neon',
    ...HD_PREMIUM_PRESET_META.map(p => p.preset),
  ];
}

function hdPresetDisplayName(key) {
  const legacy = {
    classic:'Classic Studyria', galaxy:'Purple Galaxy', emerald:'Emerald Scholar',
    gold:'Sunrise Gold', rose:'Rose Bloom', ocean:'Ocean Depth',
    minimal:'Minimal White', neon:'Neon Cyber',
  };
  if(legacy[key]) return legacy[key];
  const premium = HD_PREMIUM_PRESET_META.find(p => p.preset === key);
  return premium ? premium.name : key;
}

window._heroRotation = {
  rotation_enabled: false,
  selected_presets: [],
  current_preset: null,
  next_preset: null,
  rotation_schedule: { days: [0,1,2,3,4,5,6], mode: 'daily' }, // days 0=Sun..6=Sat (weekly scheduler)
  last_rotation_time: null,
  rotation_history: [],
};

function hdRotationLoadCache() {
  try {
    const raw = localStorage.getItem(HD_ROTATION_CACHE_KEY);
    if(raw) window._heroRotation = { ...window._heroRotation, ...JSON.parse(raw) };
  } catch(e) {}
  return window._heroRotation;
}

function hdRotationSaveCache() {
  try { localStorage.setItem(HD_ROTATION_CACHE_KEY, JSON.stringify(window._heroRotation)); } catch(e) {}
}

// ── Load rotation settings from Supabase (falls back to local cache) ──
async function loadHeroRotationFromDB() {
  hdRotationLoadCache();
  if(!window.supabaseClient) { hdRotationBoot(); return; }
  try {
    const { data, error } = await window.supabaseClient
      .from('hero_rotation_settings').select('*').eq('id',1).single();
    if(!error && data) {
      window._heroRotation = {
        rotation_enabled: !!data.rotation_enabled,
        selected_presets: data.selected_presets || [],
        current_preset: data.current_preset || null,
        next_preset: data.next_preset || null,
        rotation_schedule: data.rotation_schedule || { days:[0,1,2,3,4,5,6], mode:'daily' },
        last_rotation_time: data.last_rotation_time || null,
        rotation_history: data.rotation_history || [],
      };
      hdRotationSaveCache();
    }
  } catch(e) {
    console.warn('Rotation settings load failed, using local cache:', e);
  }
  hdRotationBoot();
}

// ── Persist rotation settings to Supabase + local cache ──
async function hdRotationSaveToDB() {
  hdRotationSaveCache();
  if(!window.supabaseClient) return;
  try {
    const r = window._heroRotation;
    const payload = {
      id: 1,
      rotation_enabled: r.rotation_enabled,
      selected_presets: r.selected_presets,
      current_preset: r.current_preset,
      next_preset: r.next_preset,
      rotation_schedule: r.rotation_schedule,
      last_rotation_time: r.last_rotation_time,
      rotation_history: r.rotation_history,
      updated_at: new Date().toISOString(),
    };
    const { error } = await window.supabaseClient
      .from('hero_rotation_settings').upsert(payload, { onConflict:'id' });
    if(error) throw error;
  } catch(e) {
    console.warn('Rotation settings save failed:', e);
    showToast('Rotation save failed: ' + e.message, 'error');
  }
}

// ── Pick the next preset, avoiding repeats within the same cycle ──
// Builds a shuffled queue from selected_presets; once every preset in
// the pool has been shown, reshuffles for a new cycle so two presets
// never repeat back-to-back unless only one preset is selected.
function hdRotationPickNext(excludeKey) {
  const r = window._heroRotation;
  const pool = (r.selected_presets || []).filter(Boolean);
  if(pool.length === 0) return null;
  if(pool.length === 1) return pool[0];
  let candidates = pool.filter(k => k !== excludeKey);
  if(candidates.length === 0) candidates = pool.slice();
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function hdRotationTodayAllowed() {
  const r = window._heroRotation;
  const mode = r.rotation_schedule?.mode || 'daily';
  if(mode === 'daily') return true;
  const days = r.rotation_schedule?.days;
  if(!Array.isArray(days) || days.length === 0) return true;
  return days.includes(new Date().getDay());
}

// ── Apply a rotation preset live, with a smooth crossfade ──
function hdRotationApplyPreset(key, { silent } = {}) {
  const allPresets = { ...{
    classic:1, galaxy:1, emerald:1, gold:1, rose:1, ocean:1, minimal:1, neon:1,
  }};
  // Reuse the same preset data hdApplyFullPreset uses, but without its
  // admin-panel side effects (no re-render / no "click to save" toast)
  // since this runs unattended in the background on the live site.
  const legacyPresets = {
    classic: { gradient_start:'#3d8ef8', gradient_mid:'#8b5cf6', gradient_end:'#00c8e8', badge_bg:'rgba(61,142,248,0.12)', badge_border:'rgba(61,142,248,0.28)', badge_color:'#00c8e8', hero_bg_type:'orbs', show_orbs:true, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Playfair Display, Georgia, serif', title_font_weight:'800', layout_style:'centered' },
    galaxy: { gradient_start:'#8b5cf6', gradient_mid:'#6d28d9', gradient_end:'#c084fc', badge_bg:'rgba(139,92,246,0.12)', badge_border:'rgba(139,92,246,0.3)', badge_color:'#c084fc', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0d0d1a,#1a0d2e,#0d0d1a)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:true, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    emerald: { gradient_start:'#10b981', gradient_mid:'#059669', gradient_end:'#34d399', badge_bg:'rgba(16,185,129,0.12)', badge_border:'rgba(16,185,129,0.3)', badge_color:'#34d399', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0a1a0f,#0d2010)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', layout_style:'centered' },
    gold: { gradient_start:'#f59e0b', gradient_mid:'#f97316', gradient_end:'#fbbf24', badge_bg:'rgba(245,158,11,0.15)', badge_border:'rgba(245,158,11,0.35)', badge_color:'#f59e0b', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#1a0d00,#2d1a00)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:true, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    rose: { gradient_start:'#f43f5e', gradient_mid:'#e11d48', gradient_end:'#fb7185', badge_bg:'rgba(244,63,94,0.12)', badge_border:'rgba(244,63,94,0.3)', badge_color:'#fb7185', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#1a0010,#2d0020)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:false, enable_glow_effects:false, font_family:'Playfair Display, Georgia, serif', layout_style:'centered' },
    ocean: { gradient_start:'#0ea5e9', gradient_mid:'#0284c7', gradient_end:'#38bdf8', badge_bg:'rgba(14,165,233,0.12)', badge_border:'rgba(14,165,233,0.3)', badge_color:'#38bdf8', hero_bg_type:'gradient', hero_bg_value:'linear-gradient(135deg,#0c1a2e,#0f2848)', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', layout_style:'centered' },
    minimal: { gradient_start:'#1e293b', gradient_mid:'#334155', gradient_end:'#475569', badge_bg:'rgba(30,41,59,0.08)', badge_border:'rgba(30,41,59,0.2)', badge_color:'#475569', hero_bg_type:'solid', hero_bg_value:'#ffffff', show_orbs:false, enable_gradient_text:false, enable_animated_text:false, enable_typing_effect:false, enable_particles:false, enable_glow_effects:false, font_family:'Inter, system-ui, sans-serif', title_color:'#0f172a', layout_style:'centered' },
    neon: { gradient_start:'#a855f7', gradient_mid:'#7c3aed', gradient_end:'#06b6d4', badge_bg:'rgba(168,85,247,0.15)', badge_border:'rgba(168,85,247,0.35)', badge_color:'#06b6d4', hero_bg_type:'solid', hero_bg_value:'#050010', show_orbs:false, enable_gradient_text:true, enable_animated_text:true, enable_typing_effect:true, enable_particles:true, enable_glow_effects:true, enable_shine_effect:true, font_family:'Inter, system-ui, sans-serif', title_font_weight:'800', layout_style:'centered' },
    ...HD_PREMIUM_PRESETS,
  };
  const p = legacyPresets[key];
  if(!p) return false;

  const hero = document.getElementById('dynamicHero');
  if(hero) hero.classList.add('hero-theme-transition');

  // Preserve admin-authored text content (badge/title/CTA copy) — the
  // rotation engine only swaps the *visual theme*, never the wording,
  // so admins don't need to re-type content after every rotation.
  const textKeys = ['badge_text','main_title','highlight_text','subtitle_phrases','cta1_text','cta2_text'];
  const preserved = {};
  textKeys.forEach(k => { if(window._heroCurrentSettings?.[k] !== undefined) preserved[k] = window._heroCurrentSettings[k]; });

  window._heroCurrentSettings = { ...window._heroDefaults, ...window._heroCurrentSettings, ...p, ...preserved };
  heroApplySettings(window._heroCurrentSettings);

  if(hero) setTimeout(() => hero.classList.remove('hero-theme-transition'), 1300);

  if(!silent) showToast(`🔁 Theme rotated to ${hdPresetDisplayName(key)}`, 'info');
  return true;
}

// ── Perform a rotation: pick next preset, apply, log history ──
async function hdRotationPerform() {
  const r = window._heroRotation;
  if(!r.rotation_enabled) return;
  if(!hdRotationTodayAllowed()) return;
  const pool = (r.selected_presets || []).filter(Boolean);
  if(pool.length === 0) return;

  const nowKey = r.next_preset && pool.includes(r.next_preset) ? r.next_preset : hdRotationPickNext(r.current_preset);
  if(!nowKey) return;

  hdRotationApplyPreset(nowKey);

  const nowISO = new Date().toISOString();
  r.current_preset = nowKey;
  r.next_preset = hdRotationPickNext(nowKey);
  r.last_rotation_time = nowISO;
  r.rotation_history = [{ preset: nowKey, at: nowISO }, ...(r.rotation_history || [])].slice(0, HD_ROTATION_HISTORY_LIMIT);

  hdRotationSaveCache();
  await hdRotationSaveToDB();

  // Refresh the admin panel if it's currently open on the rotation tab
  const panel = document.getElementById('hdPanel-rotation');
  if(panel && panel.classList.contains('active')) {
    panel.innerHTML = hdRenderRotationPanel();
  }
}

// ── Boot sequence: apply current/saved theme instantly, then arm the
//    midnight watcher so rotation happens automatically with zero
//    manual intervention and zero page reload. ──
function hdRotationBoot() {
  const r = window._heroRotation;
  if(!r.rotation_enabled) return;

  // If we already have a current_preset for today, just apply it —
  // don't burn a fresh rotation on every page load.
  if(r.current_preset && (r.selected_presets || []).includes(r.current_preset)) {
    hdRotationApplyPreset(r.current_preset, { silent: true });
    if(!r.next_preset) { r.next_preset = hdRotationPickNext(r.current_preset); hdRotationSaveCache(); }
  } else if((r.selected_presets || []).length) {
    // First-ever activation: pick and apply immediately.
    const first = hdRotationPickNext(null);
    if(first) {
      hdRotationApplyPreset(first, { silent: true });
      r.current_preset = first;
      r.next_preset = hdRotationPickNext(first);
      r.last_rotation_time = new Date().toISOString();
      r.rotation_history = [{ preset: first, at: r.last_rotation_time }, ...(r.rotation_history||[])].slice(0, HD_ROTATION_HISTORY_LIMIT);
      hdRotationSaveCache();
      hdRotationSaveToDB();
    }
  }

  hdRotationArmMidnightWatch();
}

// ── Schedule the next rotation check exactly at local midnight, then
//    re-arm every 24h after that. A 60s interval safety-net also runs
//    in case the device sleeps through a setTimeout (common on mobile
//    browsers), so the rotation still fires within a minute of midnight
//    on wake. No manual admin action is ever required. ──
function hdRotationArmMidnightWatch() {
  if(window._heroRotationTimer) clearTimeout(window._heroRotationTimer);
  if(window._heroRotationInterval) clearInterval(window._heroRotationInterval);

  const scheduleNext = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 5, 0);
    const ms = nextMidnight.getTime() - now.getTime();
    window._heroRotationTimer = setTimeout(async () => {
      await hdRotationPerform();
      scheduleNext();
    }, ms);
  };
  scheduleNext();

  // Safety-net poll: if local midnight has passed since the last
  // recorded rotation (e.g. device was asleep / tab was backgrounded),
  // catch up immediately rather than waiting for the next setTimeout.
  window._heroRotationInterval = setInterval(() => {
    if (document.hidden) return; // PERF: skip when tab backgrounded
    const r = window._heroRotation;
    if(!r.rotation_enabled || !r.last_rotation_time) return;
    const last = new Date(r.last_rotation_time);
    const now = new Date();
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if(today > lastDay) hdRotationPerform();
  }, 60000);
}

// ── ADMIN: toggle rotation on/off ──
async function hdRotationToggleEnabled(btn) {
  const r = window._heroRotation;
  r.rotation_enabled = !r.rotation_enabled;
  btn.classList.toggle('on', r.rotation_enabled);
  if(r.rotation_enabled) {
    if(!r.current_preset && (r.selected_presets||[]).length) {
      hdRotationBoot();
    } else {
      hdRotationArmMidnightWatch();
    }
  } else {
    if(window._heroRotationTimer) clearTimeout(window._heroRotationTimer);
    if(window._heroRotationInterval) clearInterval(window._heroRotationInterval);
  }
  hdRotationSaveCache();
  await hdRotationSaveToDB();
  showToast(r.rotation_enabled ? '✅ Auto Preset Rotation enabled' : '⏸ Auto Preset Rotation disabled', r.rotation_enabled ? 'success' : 'info');
  const main = document.getElementById('adminMain');
  if(main) { const panel = document.getElementById('hdPanel-rotation'); if(panel) panel.innerHTML = hdRenderRotationPanel(); }
}

// ── ADMIN: toggle a preset's membership in the rotation pool ──
async function hdRotationTogglePreset(key, checked) {
  const r = window._heroRotation;
  const set = new Set(r.selected_presets || []);
  if(checked) set.add(key); else set.delete(key);
  r.selected_presets = Array.from(set);
  if(!r.selected_presets.includes(r.current_preset)) r.current_preset = null;
  r.next_preset = hdRotationPickNext(r.current_preset);
  hdRotationSaveCache();
  await hdRotationSaveToDB();
  const panel = document.getElementById('hdPanel-rotation');
  if(panel) panel.innerHTML = hdRenderRotationPanel();
}

// ── ADMIN: weekly schedule builder — toggle a day on/off ──
async function hdRotationToggleDay(dayIdx) {
  const r = window._heroRotation;
  if(!r.rotation_schedule) r.rotation_schedule = { days:[0,1,2,3,4,5,6], mode:'daily' };
  const days = new Set(r.rotation_schedule.days || []);
  if(days.has(dayIdx)) days.delete(dayIdx); else days.add(dayIdx);
  r.rotation_schedule.days = Array.from(days).sort();
  r.rotation_schedule.mode = r.rotation_schedule.days.length >= 7 ? 'daily' : 'weekly';
  hdRotationSaveCache();
  await hdRotationSaveToDB();
  const panel = document.getElementById('hdPanel-rotation');
  if(panel) panel.innerHTML = hdRenderRotationPanel();
}

// ── ADMIN: manual override — force-apply + lock in a specific preset
//    as "current" right now, independent of the random queue. ──
async function hdRotationManualOverride(key) {
  if(!key) return;
  hdRotationApplyPreset(key);
  const r = window._heroRotation;
  r.current_preset = key;
  r.next_preset = hdRotationPickNext(key);
  r.last_rotation_time = new Date().toISOString();
  r.rotation_history = [{ preset: key, at: r.last_rotation_time, manual: true }, ...(r.rotation_history||[])].slice(0, HD_ROTATION_HISTORY_LIMIT);
  hdRotationSaveCache();
  await hdRotationSaveToDB();
  const panel = document.getElementById('hdPanel-rotation');
  if(panel) panel.innerHTML = hdRenderRotationPanel();
}

// ── ADMIN: reset rotation (clears history/queue, keeps selection) ──
async function hdRotationReset() {
  if(!confirm('Reset rotation state? This clears rotation history and the current/next preset pointers, but keeps your selected presets and schedule.')) return;
  const r = window._heroRotation;
  r.current_preset = null;
  r.next_preset = null;
  r.last_rotation_time = null;
  r.rotation_history = [];
  hdRotationSaveCache();
  await hdRotationSaveToDB();
  showToast('Rotation state reset.', 'info');
  const panel = document.getElementById('hdPanel-rotation');
  if(panel) panel.innerHTML = hdRenderRotationPanel();
}

// ── ADMIN: preview the rotation queue order without applying it ──
function hdRotationPreviewQueue() {
  const r = window._heroRotation;
  const pool = (r.selected_presets || []).filter(Boolean);
  if(pool.length === 0) { showToast('Select at least one preset to preview the queue.', 'info'); return []; }
  // Simulated preview: show one possible upcoming order (rotation is
  // randomized at runtime to avoid predictable repeats, so this is
  // illustrative of "what could come next", not a fixed schedule).
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled;
}

const HD_WEEKDAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── ADMIN PANEL UI ──────────────────────────────────────────────────
function hdRenderRotationPanel() {
  const r = window._heroRotation;
  const allKeys = hdAllRotationPresetKeys();
  const selected = new Set(r.selected_presets || []);
  const previewQueue = (r.selected_presets || []).length ? r.selected_presets : [];

  return `
    <div class="hd-section-head">🔁 Auto Preset Rotation Engine</div>
    <div style="font-size:.82rem;color:var(--text2);margin-bottom:18px">
      Pick multiple presets below and the homepage hero will automatically rotate between them once every 24 hours at local midnight — live, with no page reload, and no manual work after setup.
    </div>

    <div class="hd-rotation-toggle-row" style="margin-bottom:14px">
      <div>
        <div class="hd-toggle-label">☑ Auto Preset Rotation</div>
        <div style="font-size:.75rem;color:var(--text2)">Master switch — turns the rotation engine on or off site-wide</div>
      </div>
      <button class="hd-toggle ${r.rotation_enabled?'on':''}" onclick="hdRotationToggleEnabled(this)"></button>
    </div>

    <div class="hd-rotation-toggle-row" style="margin-bottom:22px">
      <div>
        <div class="hd-toggle-label">☑ Weekly Rotation Scheduler</div>
        <div style="font-size:.75rem;color:var(--text2)">${r.rotation_schedule?.mode === 'weekly' ? 'Active only on selected weekdays below' : 'Currently rotating every single day (all 7 days selected)'}</div>
      </div>
      <div class="hd-rotation-day-grid">
        ${HD_WEEKDAY_LABELS.map((d,i) => `
          <button class="hd-rotation-day ${(r.rotation_schedule?.days||[]).includes(i)?'active':''}" onclick="hdRotationToggleDay(${i})">${d}</button>`).join('')}
      </div>
    </div>

    <div class="hd-section-head">Multi Preset Selector <span style="opacity:.6">(${selected.size} selected, ${allKeys.length} available)</span></div>
    <div class="hd-rotation-grid" style="margin-bottom:22px">
      ${allKeys.map(key => `
        <label class="hd-rotation-pick ${selected.has(key)?'picked':''}">
          <input type="checkbox" ${selected.has(key)?'checked':''} onchange="hdRotationTogglePreset('${key}', this.checked)" />
          <span>${escH(hdPresetDisplayName(key))}</span>
        </label>`).join('')}
    </div>

    <div class="hd-section-head">Rotation Preview <span style="opacity:.6">(illustrative next order — actual order avoids back-to-back repeats)</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px">
      ${previewQueue.length === 0
        ? `<div style="font-size:.8rem;color:var(--text2)">Select presets above to preview the rotation queue.</div>`
        : previewQueue.map((k,i) => `
          <div style="padding:6px 12px;border-radius:8px;background:var(--glass);border:1px solid var(--glass-border);font-size:.78rem;font-weight:600">
            ${i+1}. ${escH(hdPresetDisplayName(k))}
          </div>`).join('')}
    </div>

    <div class="hd-section-head">Status</div>
    <div class="hd-rotation-status-grid" style="margin-bottom:22px">
      <div class="hd-rotation-stat">
        <div class="hd-rotation-stat-label">Current Active Preset</div>
        <div class="hd-rotation-stat-value">${r.current_preset ? escH(hdPresetDisplayName(r.current_preset)) : '— none yet —'}</div>
      </div>
      <div class="hd-rotation-stat">
        <div class="hd-rotation-stat-label">Next Scheduled Preset</div>
        <div class="hd-rotation-stat-value">${r.next_preset ? escH(hdPresetDisplayName(r.next_preset)) : '— pending selection —'}</div>
      </div>
      <div class="hd-rotation-stat">
        <div class="hd-rotation-stat-label">Last Rotation Time</div>
        <div class="hd-rotation-stat-value">${r.last_rotation_time ? new Date(r.last_rotation_time).toLocaleString() : '— never —'}</div>
      </div>
      <div class="hd-rotation-stat">
        <div class="hd-rotation-stat-label">Engine Status</div>
        <div class="hd-rotation-stat-value">${r.rotation_enabled ? '🟢 Active' : '⚪ Disabled'}</div>
      </div>
    </div>

    <div class="hd-section-head">Manual Override Preset</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:22px">
      <select class="hd-input" id="hdRotationOverrideSelect" style="max-width:280px">
        <option value="">Choose a preset to force now…</option>
        ${allKeys.map(k => `<option value="${k}">${escH(hdPresetDisplayName(k))}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="hdRotationManualOverride(document.getElementById('hdRotationOverrideSelect').value)">⚡ Apply Now</button>
      <button class="btn btn-ghost btn-sm" onclick="hdRotationReset()">↩ Reset Rotation</button>
    </div>

    <div class="hd-section-head">Rotation History <span style="opacity:.6">(most recent ${HD_ROTATION_HISTORY_LIMIT})</span></div>
    <div>
      ${(r.rotation_history||[]).length === 0
        ? `<div style="font-size:.8rem;color:var(--text2)">No rotations have happened yet.</div>`
        : (r.rotation_history||[]).map(h => `
          <div class="hd-rotation-history-row">
            <span><strong>${escH(hdPresetDisplayName(h.preset))}</strong>${h.manual ? ' <span style="opacity:.6">(manual override)</span>' : ''}</span>
            <span style="color:var(--text2)">${new Date(h.at).toLocaleString()}</span>
          </div>`).join('')}
    </div>
  `;
}

// ── INIT ──────────────────────────────────────────────────────────
// Pipedream helpers (sendToPipedream, pipedream_onLogin, etc.) are
// defined exclusively in pipedream.js which loads after this block.
//
// IMPORTANT: We await supabase.js's _supabaseSessionReady promise before
// rendering. This ensures window.currentUser is populated from a persisted
// localStorage session BEFORE navigate() / renderDashboard() is called.
// Without this await, the dashboard would always show "Sign in" on page
// refresh even when the user is already authenticated.
document.addEventListener('DOMContentLoaded', async function _appInit() {
  // Wait for session restore (supabase.js fires this immediately; by the
  // time DOMContentLoaded runs it's usually already resolved).
  if (window._supabaseSessionReady) {
    await window._supabaseSessionReady;
  }

  // Load ownership cache for logged-in users (non-blocking)
  // This populates window._ownedPdfIds so pdfCardHTML shows "Open PDF"
  // for already-owned free PDFs right from the first render.
  if (window.currentUser) {
    _loadOwnershipCache().catch(e => console.warn('Ownership cache load:', e));
  }

  // Load categories from database (non-blocking)
  loadCategoriesFromDB().catch(e => console.warn('Categories load:', e));

  // Load active announcement into the bar (non-blocking)
  loadActiveAnnouncement().catch(e => console.warn('Announcement load:', e));

  // Load branding banner from Supabase (non-blocking)
  loadBrandingFromDB().catch(e => console.warn('Branding load:', e));

  // Load hero settings from Supabase and apply to DOM, then boot the
  // Auto Preset Rotation Engine (must run after the base hero settings
  // are applied, since rotation layers a theme preset on top of them —
  // and must never block first paint of the rest of the homepage).
  loadHeroFromDB()
    .catch(e => { console.warn('Hero load:', e); heroApplySettings(window._heroDefaults); })
    .finally(() => {
      loadHeroRotationFromDB().catch(e => console.warn('Hero rotation load:', e));
    });

  // _supabaseSessionReady already called syncNavToAuth if a session was
  // found, so window.currentUser is correct. Just render the initial page.
  if (window.adminSession) {
    navigate('admin');
  } else {
    // ── SPA deep-link: honour hash URL on first load ───────────────
    // Check if the URL has a hash (e.g. /#privacy, /#terms, /#refund)
    // set by the SPA path → hash redirect in the <head> or by a direct
    // footer link click. If so, navigate there instead of home.
    const _initHash = location.hash.replace('#', '').trim();
    // Direct hit on an indexable https://studyria.qzz.io/?page=X URL
    // (Googlebot, shared links, etc.) — no hash present, so fall back to
    // the query string. Scoped to the URLs sitemap.xml/robots.txt already
    // advertise as indexable; every other page's behaviour is unchanged.
    const _initQueryPage = new URLSearchParams(location.search).get('page');
    const _QUERY_PAGE_ALLOWLIST = new Set([
      'about', 'career-hub', 'library', 'contact', 'privacy', 'terms', 'refund'
    ]);
    if (_initHash && _initHash !== '404' && _SPA_PUBLIC_PAGES.has(_initHash)) {
      navigate(_initHash);
    } else if (_initQueryPage === 'discover') {
      // 'discover' is a section of the home page, not a separate page —
      // render home, self-reference the canonical, then scroll to it.
      navigate('home');
      _setPageCanonical('discover');
      const discoverEl = document.getElementById('discover-section');
      if (discoverEl) setTimeout(() => discoverEl.scrollIntoView({ block: 'start' }), 50);
    } else if (_initQueryPage && _QUERY_PAGE_ALLOWLIST.has(_initQueryPage)) {
      navigate(_initQueryPage);
    } else {
      renderHome();
    }
  }
});

// ── BANNER SCROLL HIDE ────────────────────────────────────────────
(function(){
  const banner = document.getElementById('topBanner');
  if(!banner) return;
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if(y > 60) {
      banner.style.transform = 'translateY(-100%)';
      banner.style.transition = 'transform .4s cubic-bezier(0.25,0.46,0.45,0.94)';
    } else {
      banner.style.transform = 'translateY(0)';
    }
    lastY = y;
  }, { passive: true });
})();

// ── HOME PAGE ENHANCEMENTS ────────────────────────────────────────

// 1. Personalized Welcome Hero
function initHomeGreeting() {
  const user = window.currentUser;
  const bar = document.getElementById('homeGreetingBar');
  if (!bar) return;

  const h = new Date().getHours();
  const timeStr = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  const timeEmoji = h < 12 ? '🌅' : h < 17 ? '☀️' : '🌙';

  const timeEl = document.getElementById('greetingTime');
  if (timeEl) timeEl.textContent = timeStr;

  const emojiEl = document.getElementById('greetingEmoji');
  if (emojiEl) emojiEl.textContent = timeEmoji;

  if (user) {
    const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student';
    const firstName = name.split(' ')[0];
    const nameEl = document.getElementById('greetingName');
    if (nameEl) nameEl.textContent = firstName.toUpperCase();
    // Legacy compat (streak stats still refs these)
    const legacyAvatar = document.getElementById('greetingAvatar');
    if (legacyAvatar) legacyAvatar.textContent = firstName.charAt(0).toUpperCase();
    bar.style.display = '';
  } else {
    bar.style.display = 'none';
  }
}

// 2. Online counter randomizer — PERF: 30s interval (was 8s), cosmetic only
function initOnlineCounter() {
  const el = document.getElementById('homeOnlineCount');
  if (!el) return;
  let base = 18 + Math.floor(Math.random() * 20);
  el.textContent = base;
  setInterval(() => {
    if (document.hidden) return; // PERF: skip when tab not visible
    const delta = Math.floor(Math.random() * 7) - 3;
    base = Math.max(10, Math.min(60, base + delta));
    el.textContent = base;
  }, 30000);
}

// 3. Activity bar live data from Supabase
async function loadActivityBarStats() {
  const sb = window.supabaseClient;

  // Reading count — derive from online counter element or random
  const readingEl = document.getElementById('habReading');
  if (readingEl) {
    const base = 18 + Math.floor(Math.random() * 24);
    readingEl.textContent = base + ' students';
  }

  if (!sb) {
    const purchasedEl = document.getElementById('habPurchased');
    if (purchasedEl) purchasedEl.textContent = Math.floor(Math.random() * 15 + 5) + ' PDFs';
    return;
  }

  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [purchaseRes, latestPDFRes] = await Promise.all([
      sb.from('purchased_pdfs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', today.toISOString()),
      sb.from('pdfs')
        .select('title,created_at')
        .eq('status','published')
        .order('created_at', { ascending: false })
        .limit(1)
    ]);

    const purchasedEl = document.getElementById('habPurchased');
    if (purchasedEl) {
      const cnt = purchaseRes.count || Math.floor(Math.random() * 15 + 5);
      purchasedEl.textContent = cnt + ' PDF' + (cnt !== 1 ? 's' : '');
    }

    const latestEl = document.getElementById('habLatest');
    if (latestEl && latestPDFRes.data && latestPDFRes.data[0]) {
      const pdf = latestPDFRes.data[0];
      const ageMs = Date.now() - new Date(pdf.created_at).getTime();
      const ageH = Math.floor(ageMs / 3600000);
      const ageD = Math.floor(ageMs / 86400000);
      const ageStr = ageH < 1 ? 'just now' : ageH < 24 ? ageH + ' hour' + (ageH > 1 ? 's' : '') + ' ago' : ageD + ' day' + (ageD > 1 ? 's' : '') + ' ago';
      latestEl.innerHTML = `New PDF uploaded <strong>${ageStr}</strong>`;
    }
  } catch(e) {
    const purchasedEl = document.getElementById('habPurchased');
    if (purchasedEl) purchasedEl.textContent = Math.floor(Math.random() * 12 + 4) + ' PDFs';
  }
}

// ── EXAM COUNTDOWN MANAGER (ECM) ─────────────────────────────────
const ECM_KEY = 'studyria_ecm_exams';
const ECM_ACTIVE_KEY = 'studyria_ecm_active';
let _ecmTimer = null;
let _ecmManagerOpen = false;
let _ecmEditingId = null;

function ecmGetExams() {
  try { return JSON.parse(localStorage.getItem(ECM_KEY) || '[]'); } catch(e) { return []; }
}
function ecmSaveExams(arr) {
  try { localStorage.setItem(ECM_KEY, JSON.stringify(arr)); } catch(e) {}
}
function ecmGetActiveId() {
  return localStorage.getItem(ECM_ACTIVE_KEY) || null;
}
function ecmSetActiveId(id) {
  if (id) localStorage.setItem(ECM_ACTIVE_KEY, id);
  else localStorage.removeItem(ECM_ACTIVE_KEY);
}

function ecmToggleManager() {
  _ecmManagerOpen = !_ecmManagerOpen;
  const mgr = document.getElementById('ecmManager');
  if (mgr) mgr.style.display = _ecmManagerOpen ? '' : 'none';
  if (_ecmManagerOpen) ecmRenderSavedList();
}

function ecmOnSelectChange() {
  const sel = document.getElementById('ecmExamSelect');
  const customWrap = document.getElementById('ecmCustomWrap');
  if (customWrap) customWrap.style.display = sel.value === 'custom' ? '' : 'none';
}

function ecmSaveExam() {
  const sel = document.getElementById('ecmExamSelect');
  const customInput = document.getElementById('ecmCustomName');
  const dateInput = document.getElementById('ecmDateInput');
  if (!sel || !dateInput) return;

  const examName = sel.value === 'custom'
    ? (customInput?.value.trim() || '')
    : sel.value;
  const examDate = dateInput.value;

  if (!examName) { if(typeof showToast==='function') showToast('Please enter an exam name.','info'); return; }
  if (!examDate) { if(typeof showToast==='function') showToast('Please select an exam date.','info'); return; }

  const exams = ecmGetExams();

  if (_ecmEditingId) {
    // Edit existing
    const idx = exams.findIndex(e => e.id === _ecmEditingId);
    if (idx >= 0) { exams[idx].name = examName; exams[idx].date = examDate; }
    _ecmEditingId = null;
    const cancelBtn = document.getElementById('ecmCancelEdit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if(typeof showToast==='function') showToast('Exam updated! ✅', 'success');
  } else {
    // Add new
    exams.push({ id: 'ecm_' + Date.now(), name: examName, date: examDate });
    if(typeof showToast==='function') showToast('Exam saved! 📅', 'success');
  }

  ecmSaveExams(exams);

  // Auto-set as active if it's the first or was being edited
  if (exams.length === 1 || _ecmEditingId) ecmSetActiveId(exams[exams.length-1]?.id);

  // Reset form
  sel.value = '';
  if (customInput) customInput.value = '';
  dateInput.value = '';
  const customWrap = document.getElementById('ecmCustomWrap');
  if (customWrap) customWrap.style.display = 'none';

  ecmRenderSavedList();
  ecmRenderChips();
  ecmStartCountdown();
}

function ecmCancelEdit() {
  _ecmEditingId = null;
  const cancelBtn = document.getElementById('ecmCancelEdit');
  if (cancelBtn) cancelBtn.style.display = 'none';
  const sel = document.getElementById('ecmExamSelect');
  const dateInput = document.getElementById('ecmDateInput');
  const customWrap = document.getElementById('ecmCustomWrap');
  if (sel) sel.value = '';
  if (dateInput) dateInput.value = '';
  if (customWrap) customWrap.style.display = 'none';
}

function ecmEditExam(id) {
  const exams = ecmGetExams();
  const exam = exams.find(e => e.id === id);
  if (!exam) return;
  _ecmEditingId = id;
  const sel = document.getElementById('ecmExamSelect');
  const dateInput = document.getElementById('ecmDateInput');
  const customInput = document.getElementById('ecmCustomName');
  const customWrap = document.getElementById('ecmCustomWrap');
  const cancelBtn = document.getElementById('ecmCancelEdit');
  const builtins = ['ADRE','APSC','Assam University','Gauhati University','HS Final','HSLC','NEET','JEE','GATE','CAT'];
  if (builtins.includes(exam.name)) {
    if (sel) sel.value = exam.name;
    if (customWrap) customWrap.style.display = 'none';
  } else {
    if (sel) sel.value = 'custom';
    if (customInput) customInput.value = exam.name;
    if (customWrap) customWrap.style.display = '';
  }
  if (dateInput) dateInput.value = exam.date;
  if (cancelBtn) cancelBtn.style.display = '';
  // Open manager if not open
  if (!_ecmManagerOpen) { _ecmManagerOpen = true; const mgr = document.getElementById('ecmManager'); if(mgr) mgr.style.display=''; }
  ecmRenderSavedList();
}

function ecmDeleteExam(id) {
  let exams = ecmGetExams();
  exams = exams.filter(e => e.id !== id);
  ecmSaveExams(exams);
  const activeId = ecmGetActiveId();
  if (activeId === id) {
    ecmSetActiveId(exams.length > 0 ? exams[0].id : null);
  }
  ecmRenderSavedList();
  ecmRenderChips();
  ecmStartCountdown();
  if(typeof showToast==='function') showToast('Exam removed.', 'info');
}

function ecmActivateExam(id) {
  ecmSetActiveId(id);
  ecmRenderSavedList();
  ecmRenderChips();
  ecmStartCountdown();
}

function ecmRenderSavedList() {
  const list = document.getElementById('ecmSavedList');
  if (!list) return;
  const exams = ecmGetExams();
  const activeId = ecmGetActiveId();
  if (!exams.length) {
    list.innerHTML = '<div class="ecm-empty-msg">No exams saved yet. Add your first exam above.</div>';
    return;
  }
  list.innerHTML = exams.map(e => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    const isActive = e.id === activeId;
    return `<div class="ecm-saved-item${isActive?' active-exam':''}">
      <div class="ecm-saved-icon">📅</div>
      <div class="ecm-saved-info">
        <div class="ecm-saved-name">${e.name}</div>
        <div class="ecm-saved-date">${dateStr}</div>
      </div>
      ${isActive ? '<span class="ecm-saved-active-badge">● Active</span>' : `<button class="ecm-act-btn" onclick="ecmActivateExam('${e.id}')" title="Set as active">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/></svg>
      </button>`}
      <div class="ecm-saved-actions">
        <button class="ecm-act-btn" onclick="ecmEditExam('${e.id}')" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="ecm-act-btn del" onclick="ecmDeleteExam('${e.id}')" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function ecmRenderChips() {
  const chips = document.getElementById('ecmSavedChips');
  const main = document.getElementById('ecmMainCard');
  const placeholder = document.getElementById('ecmPlaceholder');
  const countdown = document.getElementById('ecmCountdown');
  if (!chips) return;
  const exams = ecmGetExams();
  const activeId = ecmGetActiveId();
  chips.innerHTML = exams.map(e =>
    `<span class="ecm-chip${e.id===activeId?' active':''}" onclick="ecmActivateExam('${e.id}')">
      ${e.id===activeId?'● ':''}${e.name}
    </span>`
  ).join('');
  // Show/hide placeholder
  if (placeholder && countdown) {
    const hasActive = exams.some(e => e.id === activeId);
    placeholder.style.display = hasActive ? 'none' : '';
    countdown.style.display = hasActive ? '' : 'none';
    if (main) main.querySelector('.ecm-header').style.opacity = hasActive ? '1' : '0.5';
  }
}

function ecmStartCountdown() {
  if (_ecmTimer) { cancelAnimationFrame(_ecmTimer); _ecmTimer = null; }
  const exams = ecmGetExams();
  const activeId = ecmGetActiveId();
  const exam = exams.find(e => e.id === activeId);

  const nameEl = document.getElementById('ecmExamName');
  const arrivedEl = document.getElementById('ecmArrived');
  const countdownEl = document.getElementById('ecmCountdown');
  const placeholderEl = document.getElementById('ecmPlaceholder');
  const headerEl = document.getElementById('ecmMainCard')?.querySelector('.ecm-header');

  if (!exam) {
    if (nameEl) nameEl.textContent = 'No Exam Set';
    if (arrivedEl) arrivedEl.style.display = 'none';
    if (countdownEl) countdownEl.style.display = 'none';
    if (placeholderEl) placeholderEl.style.display = '';
    if (headerEl) headerEl.style.opacity = '0.5';
    return;
  }

  if (nameEl) nameEl.textContent = exam.name;
  if (placeholderEl) placeholderEl.style.display = 'none';
  if (headerEl) headerEl.style.opacity = '1';

  const target = new Date(exam.date).getTime() + 86400000;
  let lastTick = 0;

  function update(now) {
    if (document.hidden || (now - lastTick < 1000)) {
      _ecmTimer = requestAnimationFrame(update);
      return;
    }
    lastTick = now;
    const diff = target - Date.now();
    if (diff <= 0) {
      if (countdownEl) countdownEl.style.display = 'none';
      if (arrivedEl) arrivedEl.style.display = '';
      ['cdDays','cdHours','cdMins','cdSecs'].forEach(id => {
        const e = document.getElementById(id); if (e) e.textContent = '00';
      });
      return;
    }
    if (arrivedEl) arrivedEl.style.display = 'none';
    if (countdownEl) countdownEl.style.display = '';
    const pad = n => String(n).padStart(2,'0');
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const secs  = Math.floor((diff % 60000) / 1000);
    const el = id => document.getElementById(id);
    if (el('cdDays'))  el('cdDays').textContent  = days;
    if (el('cdHours')) el('cdHours').textContent = pad(hours);
    if (el('cdMins'))  el('cdMins').textContent  = pad(mins);
    if (el('cdSecs'))  el('cdSecs').textContent  = pad(secs);
    _ecmTimer = requestAnimationFrame(update);
  }
  _ecmTimer = requestAnimationFrame(update);
}

// Initialize ECM on page load
function initECM() {
  ecmRenderChips();
  ecmStartCountdown();
}

// ── PREMIUM STATS COUNT-UP ────────────────────────────────────────
// Animates a numeric element from 0 → target over ~1.5s
function _animatePstatEl(numEl, endVal, opts) {
  const { suffix = '', decimal = null, duration = 1500 } = opts || {};
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    if (decimal !== null) {
      numEl.textContent = (decimal * eased).toFixed(1) + suffix;
    } else if (endVal >= 1000) {
      numEl.textContent = (endVal * eased / 1000).toFixed(1) + 'K+';
    } else {
      numEl.textContent = Math.round(endVal * eased).toLocaleString() + suffix;
    }
    if (progress < 1) requestAnimationFrame(step);
    else numEl.textContent = decimal !== null
      ? decimal.toFixed(1) + suffix
      : (endVal >= 1000 ? (endVal/1000).toFixed(1)+'K+' : endVal.toLocaleString() + suffix);
  }
  requestAnimationFrame(step);
}

// ── SHARED PLATFORM STATS ────────────────────────────────────────
// Single source of truth for live Supabase stats.
// Caches result in window._platformStats for 5 min so multiple
// callers (home pstat cards, About page, hero, footer CTA) all
// read the same numbers without duplicating DB round-trips.

// ── AUTO STUDENT COUNTER ─────────────────────────────────────────
// Grows the student count by 2-5 per day from the seed date.
// Deterministic per-day increment (seeded by date index) — every
// visitor on the same calendar day sees the same number.
// No localStorage or server-side persistence needed.
(function() {
  var STUDENT_BASE      = 157;
  var STUDENT_SEED_DATE = new Date('2026-06-27T00:00:00+05:30').getTime();
  var MS_PER_DAY        = 86400000;

  function _dailyIncrement(dayIndex) {
    // Deterministic 2-5 increment per day (simple LCG hash)
    var seed = (dayIndex * 1103515245 + 12345) & 0x7fffffff;
    return 2 + (seed % 4); // 2, 3, 4 or 5
  }

  function getAutoStudentCount() {
    var daysPassed = Math.floor((Date.now() - STUDENT_SEED_DATE) / MS_PER_DAY);
    if (daysPassed <= 0) return STUDENT_BASE;
    var total = STUDENT_BASE;
    for (var i = 0; i < daysPassed; i++) total += _dailyIncrement(i);
    return total;
  }

  window.getAutoStudentCount = getAutoStudentCount;
})();

/**
 * Formats a raw number for display, e.g. 18432 → "18K+" or 523 → "500+"
 * For small numbers (< 1000) shows exact value with "+"
 */
function _fmtStatNum(n, opts) {
  opts = opts || {};
  if (n >= 1000) {
    // Round down to nearest 500 to avoid over-claiming
    const k = Math.floor(n / 500) * 500;
    return (k / 1000).toFixed(k % 1000 === 0 ? 0 : 1) + 'K+';
  }
  if (opts.suffix) return n + opts.suffix;
  // For counts < 1000 show exact value with "+"
  return n + '+';
}

async function loadSupabaseHomeStats() {
  const sb = window.supabaseClient;
  if (!sb) return null;

  // Return in-memory cache if fresh (5 min TTL)
  if (window._platformStats && window._platformStatTs && (Date.now() - window._platformStatTs < 300000)) {
    return window._platformStats;
  }

  try {
    // Parallel: count PDFs, sum downloads
    // (Student count is NOT fetched here — it always comes from the
    // single global auto-growing counter, see getAutoStudentCount())
    const [pdfsRes, dlRes] = await Promise.all([
      sb.from('pdfs').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      sb.from('pdfs').select('download_count').eq('status', 'published')
    ]);
    const pdfCount  = pdfsRes.count  || 0;
    const totalDl   = (dlRes.data || []).reduce((s, r) => s + (r.download_count || 0), 0);
    const stats = { pdfCount, totalDl };
    // Cache globally
    window._platformStats    = stats;
    window._platformStatTs   = Date.now();
    return stats;
  } catch(e) {
    console.warn('loadSupabaseHomeStats error:', e);
    return null;
  }

}

/**
 * Apply live stats to every surface that shows platform-wide numbers:
 *   • Homepage pstat cards (PDFs Sold, Students, Verified Authors)
 *   • About page stat tiles (#aboutStatStudents, #aboutStatPdfs)
 *   • Home CTA subtitle (#homeCtaStudentCount)
 *   • Community hub title (#communityStudentCount)
 */
function _applyPlatformStats(stats) {
  if (!stats) return;
  const { pdfCount, totalDl } = stats;

  // Single global student counter — always the deterministic
  // auto-growing counter (base 157, +2-5/day). This is the ONE
  // source of truth for every "Students" display across the site
  // (Home, About, Connect with, CTA, Footer, Hero, Library, etc).
  // It is intentionally NOT replaced by live Supabase row counts,
  // so every surface always shows the same number.
  const studentCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;

  // ── Homepage pstat cards ─────────────────────────────────────
  const card0 = document.getElementById('pstatNum0');
  const soldVal = totalDl > 0 ? totalDl : pdfCount;
  if (card0 && soldVal > 0) {
    const cards = document.querySelectorAll('.pstat-card[data-target]');
    cards[0]?.setAttribute('data-stat-live', '1');
    _animatePstatEl(card0, soldVal, { suffix: soldVal >= 1000 ? '' : '' });
  }

  const card1 = document.getElementById('pstatNum1');
  if (card1) {
    const cards = document.querySelectorAll('.pstat-card[data-target]');
    cards[1]?.setAttribute('data-stat-live', '1');
    _animatePstatEl(card1, studentCount, { suffix: '+' });
  }

  const card2 = document.getElementById('pstatNum2');
  if (card2 && pdfCount > 0) {
    const cards = document.querySelectorAll('.pstat-card[data-target]');
    cards[2]?.setAttribute('data-stat-live', '1');
    _animatePstatEl(card2, pdfCount, {});
  }

  // ── About page stat tiles ────────────────────────────────────
  const aboutStudents = document.getElementById('aboutStatStudents');
  if (aboutStudents) {
    aboutStudents.textContent = _fmtStatNum(studentCount);
  }

  const aboutPdfs = document.getElementById('aboutStatPdfs');
  if (aboutPdfs && pdfCount > 0) {
    aboutPdfs.textContent = _fmtStatNum(pdfCount);
  } else if (aboutPdfs) {
    aboutPdfs.textContent = '—';
  }

  // ── Home CTA subtitle ────────────────────────────────────────
  const ctaCount = document.getElementById('homeCtaStudentCount');
  if (ctaCount) {
    ctaCount.textContent = _fmtStatNum(studentCount);
  }

  // ── Community hub title ──────────────────────────────────────
  const communityCount = document.getElementById('communityStudentCount');
  if (communityCount) {
    communityCount.textContent = _fmtStatNum(studentCount) + ' Students';
  }
}

function initPlatformStats() {
  const cards = document.querySelectorAll('.pstat-card[data-target]');
  if (!cards.length) return;

  // Auto student count for static fallback
  const autoStudentCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;

  // Immediately start count-up with current data-target values (static fallback)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const card = entry.target;
      observer.unobserve(card);
      const target = parseInt(card.getAttribute('data-target'));
      const divisor = parseInt(card.getAttribute('data-divisor') || '1');
      const suffix = card.getAttribute('data-suffix') || '';
      const decimal = card.getAttribute('data-decimal');
      const numEl = card.querySelector('.pstat-num');
      if (!numEl || card.dataset.statLive === '1') return; // skip if already updated by Supabase

      // For the Students card (pstatNum1), use the auto-growing counter
      const isStudentCard = numEl.id === 'pstatNum1';
      const endVal = isStudentCard ? autoStudentCount
                   : (divisor > 1 ? Math.round(target / divisor) : target);
      const useSuffix = isStudentCard ? '+' : suffix;
      _animatePstatEl(numEl, endVal, { suffix: useSuffix, decimal: decimal ? parseFloat(decimal) : null });
    });
  }, { threshold: 0.2 });

  cards.forEach((card, i) => {
    card.style.animationDelay = (i * 0.08) + 's';
    observer.observe(card);
  });

  // Async: fetch real Supabase stats and update ALL stat surfaces
  loadSupabaseHomeStats().then(stats => {
    _applyPlatformStats(stats);
  }).catch(() => {
    // Even on error, show auto-counter on community + CTA
    const auto = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;
    const cta  = document.getElementById('homeCtaStudentCount');
    if (cta) cta.textContent = auto + '+';
    const cc   = document.getElementById('communityStudentCount');
    if (cc)  cc.textContent  = auto + '+ Students';
  });
}

/**
 * Populate the About page stats from the shared cache (or fetch if needed).
 * Called when the About page is navigated to.
 */
function initAboutStats() {
  // Show loading state
  const aboutStudents = document.getElementById('aboutStatStudents');
  const aboutPdfs     = document.getElementById('aboutStatPdfs');

  // Apply cached values immediately if available
  if (window._platformStats) {
    _applyPlatformStats(window._platformStats);
    return;
  }

  // Set loading placeholder
  if (aboutStudents) aboutStudents.textContent = '…';
  if (aboutPdfs)     aboutPdfs.textContent = '…';

  loadSupabaseHomeStats().then(stats => {
    if (stats) {
      _applyPlatformStats(stats);
    } else {
      // No DB data — use auto-counter fallback
      const autoCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;
      if (aboutStudents) aboutStudents.textContent = autoCount + '+';
      if (aboutPdfs)     aboutPdfs.textContent = '—';
    }
  }).catch(() => {
    const autoCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;
    if (aboutStudents) aboutStudents.textContent = autoCount + '+';
    if (aboutPdfs)     aboutPdfs.textContent = '—';
  });
}

// Old setExam stub for backward compat (does nothing, ECM replaces it)
function setExam() {}

// 16. Flash Sale countdown — PERF: rAF-based, pauses when tab hidden
(function(){
  let totalSecs = 5 * 3600 + 59 * 60;
  let lastTick = 0;
  let rafId = null;
  const pad = n => String(n).padStart(2,'0');

  function updateFlash(now) {
    if (document.hidden) { rafId = requestAnimationFrame(updateFlash); return; }
    if (now - lastTick >= 1000) {
      lastTick = now;
      if (totalSecs <= 0) totalSecs = 5 * 3600 + 59 * 60;
      totalSecs--;
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;
      const fh = document.getElementById('flashH'); if(fh) fh.textContent = pad(h);
      const fm = document.getElementById('flashM'); if(fm) fm.textContent = pad(m);
      const fs = document.getElementById('flashS'); if(fs) fs.textContent = pad(s);
    }
    rafId = requestAnimationFrame(updateFlash);
  }
  // Only start if elements exist
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('flashH')) rafId = requestAnimationFrame(updateFlash);
  });
  // Pause on hidden, resume on visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if(rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    else if (!rafId && document.getElementById('flashH')) rafId = requestAnimationFrame(updateFlash);
  });
})();

// Hook into renderHome to initialize all new features
// FIX: previously this captured `typeof renderHome === 'function' ? renderHome : null`
// into `_origRenderHome` and then defined `function renderHome(){ _origRenderHome(); ... }`.
// Because function declarations are hoisted before any statement runs, and this
// `function renderHome()` declaration is the LAST one with that name in this
// <script> block, `renderHome` already referred to THIS wrapper at the moment
// `_origRenderHome` was assigned — making `_origRenderHome` a self-reference and
// causing infinite recursion ("Maximum call stack size exceeded"). The real
// original implementation now lives under its own name, `renderHomeCore()`,
// so there is no collision and nothing to "rescue" via hoisting tricks.
function renderHome() {
  // ── Clear all stale caches before rendering ──────────────────────
  try {
    // Clear sessionStorage home cache
    const ssKeys = Object.keys(sessionStorage);
    ssKeys.forEach(k => { if (/home|shelf|section|ott|trending|arrival|recent|popular|featured/i.test(k)) sessionStorage.removeItem(k); });
    // Clear localStorage home cache (keep user prefs/auth)
    const lsKeys = Object.keys(localStorage);
    lsKeys.forEach(k => { if (/home_cache|shelf_cache|section_cache|ott_cache/i.test(k)) localStorage.removeItem(k); });
    // Clear SW cache for home page
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => {
        if (/home|runtime/i.test(name)) caches.delete(name);
      }));
    }
  } catch(e) {}
  renderHomeCore();
  // Initialize new features after render
  setTimeout(() => {
    initHomeGreeting();
    initOnlineCounter();
    loadActivityBarStats();
    initECM();
    initPlatformStats();
    // Refresh ownership-aware button labels after cards are in the DOM
    _refreshFreeButtonLabels();
  }, 100);
}

// ── STUDENT COUNT EARLY INIT ────────────────────────────────────
// Pre-populate all student count surfaces with the auto-counter
// immediately (no DB wait). Supabase will overwrite with live data
// when it resolves, keeping all sections in sync automatically.
document.addEventListener('DOMContentLoaded', function _initStudentCounters() {
  var autoCount = (typeof window.getAutoStudentCount === 'function') ? window.getAutoStudentCount() : 157;
  var ctaEl = document.getElementById('homeCtaStudentCount');
  if (ctaEl) ctaEl.textContent = autoCount + '+';
  var commEl = document.getElementById('communityStudentCount');
  if (commEl) commEl.textContent = autoCount + '+ Students';
  var aboutEl = document.getElementById('aboutStatStudents');
  if (aboutEl && aboutEl.textContent === '—') aboutEl.textContent = autoCount + '+';
});

// Also init on DOMContentLoaded for direct home load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initHomeGreeting();
    initOnlineCounter();
    loadActivityBarStats();
    initECM();
    initPlatformStats();
  }, 300);
});

// Track last-read PDF
const _origDownloadPDF = typeof downloadPDF === 'function' ? downloadPDF : null;
// Wrap trackReadingSession to save last PDF
const _origTrackReading = typeof trackReadingSession === 'function' ? trackReadingSession : null;
if (_origTrackReading) {
  window.trackReadingSession = function(pdfId) {
    _origTrackReading(pdfId);
    const pdf = (window.PDFS || []).find(p => String(p.id) === String(pdfId));
    if (pdf) {
      try { localStorage.setItem('studyria_last_pdf', JSON.stringify({ id: pdfId, title: pdf.title, pct: 35 })); } catch(e) {}
    }
  };
}
