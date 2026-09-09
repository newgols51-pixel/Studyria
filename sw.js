// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  v93  (PWA V3 — 2026 Ultimate)
// ══════════════════════════════════════════════════════════════════
//
// Cache Strategies:
//   • Navigation (HTML)         — Network-first → cache fallback → offline.html
//   • Same-origin JS/CSS/fonts  — Stale-while-revalidate (instant + fresh bg)
//   • Images                    — Cache-first (long-lived, revalidate in bg)
//   • Fonts (CDN)               — Cache-first, 365-day TTL
//   • API / Supabase / Razorpay — Network-only (bypass entirely)
//
// Messages handled:
//   SKIP_WAITING         → activate waiting SW immediately
//   GET_VERSION          → reply with version info
//   CLEAR_CACHE          → wipe all caches
//   PREFETCH_URLS        → warm cache with given URL list
//
// Push: native VAPID Web Push (RFC 8291/8292) — dispatched by the Studyria notification backend.
// Periodic Sync: 'studyria-content-refresh' every 12 hours.
// Background Sync: 'sync-data' for deferred writes.
// ══════════════════════════════════════════════════════════════════

// ── [Studyria Push Migration] ────────────────────────────────────────
// OneSignal SW SDK removed (retired). Native VAPID Web Push handlers
// below (push / notificationclick) are the ONLY push handlers now —
// no duplicate notifications, no foreign SDK listeners.

// ── VERSION ───────────────────────────────────────────────────────
const CACHE_VERSION = 'v112' // v112: EXAM UNIVERSE — new additive brainlab-exams.js/.css. #brainlab/exams upgraded to Exam Universe landing (real stats + search) and NEW detail route #brainlab/exams/<id>: progress (own sessions), continue, real mock start, quick 10/25/50, PYQs, subject-wise, question papers + study materials via canonical openDetail PDF flow (checkout/ownership untouched), current affairs, real recommendations, about. Dashboard Exam Universe strip. Zero backend/DB/auth/payment changes. // v111: BrainLab final UX — Why Studyria BrainLab section (10 real-feature points), feature quick-access strip moved directly below hero, home flow per spec Part 5 (Hero → Strip → Stats → personal sections → module directory → Why), NEW Subject-wise Practice page #brainlab/subjects with real QB counts (topics/MCQs/PYQs per category), search, subject detail #brainlab/subjects/<slug> with real topic list + real user progress (own sessions only) + Start Full Subject/Topic Practice via existing count picker & learn player. brainlab-pages.js v20260908d / css v20260908c. No backend/checkout/payment/auth/DB changes. // v110: BrainLab Phase B — Mock Test Engine (brainlab-mock.js/.css, additive layer): exam-style mock player for mode==='mock' ONLY — no instant feedback, change/clear answers, question palette with answered/marked states, mark-for-review, countdown timer (1 min/question) with auto-submit at 00:00, submit summary; quiz/arena/daily keep the original learn player untouched; scoring/session/streak/mistakes still via the ORIGINAL _finishQuiz. No backend/checkout/payment/auth change. // v109: BrainLab Home IA order — Quick Access (Arena banner + Learning Modules directory) now sits directly under Hero/Stats, personal sections (Continue/Daily/Recommended/Streak/Tools) follow it; brainlab-pages.js -> v20260908c. Spec §7 flow. No backend/checkout/payment/auth change. // v108: BrainLab Home dashboard — prominent Practice Arena hero banner (real SA modes: Quick 10/25/50, Custom, Topic, Difficulty, Random — tappable, start the real player) + ENTER ARENA route; brainlab-pages.js/.css -> v20260908b. No backend/checkout/payment/auth change. // v107: BrainLab V8 modular pages (Dashboard + 11 dedicated module pages, brainlab-pages.js/.css new files) — bump wipes stale SWR HTML/JS so devices that had the site open before this deploy actually fetch the new index.html + new brainlab-pages bundle instead of running mismatched old cached code on the BrainLab nav item. No backend/checkout/payment/auth change. // v106: dedicated My Library page — #my-library is the ONE canonical personal-library route (openMyLibrary() → renderMyLibraryPage() → single-source BSF panel in #myLibMain); burger/header/Downloads 'My Library', PDF owned-state 'Go to My Library', free + paid payment success 'Open My Library', Pass page and Pass-Content CTAs all route there instead of the public catalog (#library) or the dashboard detour; Premium Library Universe sub-tab now always visible with a polished locked/upgrade state for non-members; legacy #premium-library hash deep-links to the Premium Universe tab; guest gate with sign-in + Explore button; empty state copy updated; cart.js→v20260907b, pco.js→v20260907d. Public/universal Library untouched. // v105: ONE canonical checkout routing — every PDF card click (paid/FREE/owned/premium, home/library/search/wishlist/featured/most-read/recently-added) now opens PCO directly via openDetail; card-level free/owned/price heuristics removed (they were the bug sending free + own PDFs to the old PDP checkout); free card CTAs route through the checkout FREE ACCESS experience (₹0/FREE → Get Free Access → grantFreeOwnership → premium success screen with Open in Library / Open PDF); owned card buttons keep intended direct open; handleBuy routes paid to PCO with buyPDF only as last-resort fallback. Asset versions v20260907c. // v104: premium checkout upgrade — dedicated FAILED/CANCELLED/FREE payment states, premium success screen (animated check, product card, payment ID, verified/library/lifetime checklist, Open Library + Read/Download CTAs), mobile swipe preview (stage-isolated passive pointer events, vertical scroll & pinch zoom untouched), refresh-safe checkout via #pdf-checkout/<id> hash + pco_last fallback, smart Back (returns to origin grid, never dead-ends on PDP), You-save line, focus-visible + aria-live/a11y, free-PDFs never open Razorpay, unused key constant removed; asset versions v20260907b. // v103: direct-to-checkout — every paid PDF card click (Library/Home/Search/OTT) now opens the premium PCO checkout directly, bypassing the PDP for the purchase flow; PDP retained for free + owned items; payment logic unchanged. Bump wipes stale SWR HTML/JS. // v102: single canonical checkout — old cart #checkout page RETIRED (page div, Cart.renderCheckout/_checkoutHTML/_bindCheckoutBtn removed); cart CTA routes single chargeable item to premium PCO checkout, multi-item carts batch-pay directly from the cart page; legacy #checkout URLs redirect to cart; cart.js/pco.js/cart.css bumped to v=20260907. Bump wipes stale SWR entries so devices fetch fresh JS. // v101: route-lazy architecture — 25 heavy route scripts (question-bank 2.4MB, ADRE papers, BrainLab/Arena, Campus, admin tools) + 4 route CSS now load on-demand via navigate() preload; creator-program.js extracted from index.html; studyria-notifications.js BrainLab deep-links now use __blReady retry. Bump wipes stale SWR entries so devices fetch fresh JS. // v100: standalone _ownedPdfIds init — _isOwned threw 'undefined has' killing static-page hydration; assets -> v20260906e; // v99: pdp-checkout.js ReferenceError fix (_pdfFallbackCache) — static /pdf/ pages were stuck on skeletons; bump wipes v98 entries so stale devices fetch v20260906d. // v98: checkout rebuild — pco.js/pco.css added, asset versions v=20260906*, static /pdf/ pages bumped to v=20260906c. Bump wipes v97 SWR entries that kept serving the OLD pdp-checkout.js (old checkout page) to devices.
const CACHE_NAME    = 'studyria-' + CACHE_VERSION;
const IMG_CACHE     = 'studyria-img-' + CACHE_VERSION;
const FONT_CACHE    = 'studyria-font-' + CACHE_VERSION;
const SW_BUILD      = '2026.09.07-one-checkout';
const OFFLINE_PAGE  = '/offline.html';

const WHATS_NEW = '🖼️ Custom banners: each notification\'s own banner/poster now appears on push notifications — auto-generated Studyria poster stays as fallback.';

// ── PRECACHE ──────────────────────────────────────────────────────
const PRECACHE_ASSETS = [
  '/',
  OFFLINE_PAGE,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/icon-96.png',
  '/icon-144.png',
  '/sw.js',
  '/screenshot-home.png',
  '/screenshot-library.png',
  '/screenshot-premium.png',
  '/screenshot-career.png',
  '/screenshot-desktop.png',
];

// ── BYPASS HOSTS (always network) ─────────────────────────────────
const BYPASS_HOSTS = [
  'supabase.co',
  'razorpay.com',
  'checkout.razorpay.com',
  'pipedream.net',
  'm.pipedream.net',
  'googleapis.com',
  'gstatic.com',
  'rapidapi.com',
  'firebaseapp.com',
  'firebaseio.com',
];

const BYPASS_CDNS = [
  'jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'tailwindcss.com',
];

// Font CDNs to cache-first
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── INSTALL ───────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(e => console.warn('[SW] Precache miss:', url, e.message))
          )
        )
      )
      .then(() => console.log('[SW] v37 installed ✅'))
  );
  // CRITICAL: auto-skipWaiting for v41 — fixes must reach devices NOW, not on user click
  self.skipWaiting();
  // Normal mode: update UX owns SKIP_WAITING — re-enable after this deploy
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const keepCaches = [CACHE_NAME, IMG_CACHE, FONT_CACHE];
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(k => !keepCaches.includes(k))
            .map(k => { console.log('[SW] Purging old cache:', k); return caches.delete(k); })
        )
      ),
      (async () => {
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
          console.log('[SW] Navigation preload enabled ✅');
        }
      })(),
    ]).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Bypass third-party API/data hosts
  if (BYPASS_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;
  if (BYPASS_CDNS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // Font CDN — Cache-first, very long TTL
  if (FONT_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(fontCacheFirst(request));
    return;
  }

  // Navigation — SPA shell, Network-first
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(event));
    return;
  }

  // Images — Cache-first with background revalidate
  if (request.destination === 'image') {
    event.respondWith(imageCacheFirst(request));
    return;
  }

  // Same-origin JS/CSS/workers — Stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else — network passthrough
});

// ── STRATEGY: Navigation (SPA shell) ─────────────────────────────
async function navigationStrategy(event) {
  const cache = await caches.open(CACHE_NAME);

  // ── FIX (2026-09-05): navigation hijack bug ─────────────────────
  // The old strategy fetched '/' HARDCODED for every navigation — so
  // /pdf/<slug>.html and /job/<slug>.html (real, indexed product pages)
  // were silently replaced by the homepage shell for every user with
  // an installed service worker. It also clobbered the cached shell by
  // cache.put('/', <some /pdf page>) whenever navigation preload fired
  // for a sub-page. Now: serve the ACTUAL requested URL network-first,
  // cache the shell only when the shell is what was requested.
  const request = event.request;

  // 1. Try navigation preload (the real URL)
  try {
    const preload = await event.preloadResponse;
    if (preload && preload.ok) {
      if (new URL(request.url).pathname === '/') {
        cache.put('/', preload.clone());
      }
      return preload;
    }
  } catch (_) {}

  // 2. Network-first for the ACTUAL URL (no-store: never a stale page)
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res && res.ok) {
      if (new URL(request.url).pathname === '/') {
        cache.put('/', res.clone());
      }
      return res;
    }
  } catch (_) {}

  // 3. Cache fallback — exact URL first (static /pdf/, /job/ pages),
  //    then the cached SPA shell for hash routes.
  const cached = (await cache.match(request, { ignoreSearch: true })) ||
                 (await cache.match('/'));
  if (cached) return cached;

  // 4. Offline page
  const offline = await caches.match(OFFLINE_PAGE);
  return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

// ── STRATEGY: Stale-while-revalidate ─────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // IMPORTANT: force this fetch to bypass the browser/CDN HTTP cache.
  // Without {cache:'no-store'}, a "fresh" fetch can still be silently
  // served from HTTP cache under the same URL, so a code fix can go live
  // on the server yet devices keep loading the old bytes indefinitely.
  const networkFetch = fetch(request, { cache: 'no-store' }).then(res => {
    if (res && res.status === 200 && res.type !== 'opaque') cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || networkFetch;
}

// ── STRATEGY: Image cache-first ───────────────────────────────────
async function imageCacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Background revalidate
    fetch(request).then(res => {
      if (res && res.status === 200) cache.put(request, res.clone());
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 503 });
  }
}

// ── STRATEGY: Font cache-first (long TTL) ─────────────────────────
async function fontCacheFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 503 });
  }
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-data' || event.tag === 'studyria-sync-progress') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_FIRED', tag: event.tag }))
      )
    );
  }
});

// ── PERIODIC BACKGROUND SYNC ─────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'studyria-content-refresh') {
    event.waitUntil(refreshCriticalAssets());
  }
});

async function refreshCriticalAssets() {
  const cache = await caches.open(CACHE_NAME);
  const urls  = ['/', '/manifest.json'];
  await Promise.allSettled(
    urls.map(url =>
      fetch(url, { cache: 'no-store' })
        .then(res => { if (res && res.ok) cache.put(url, res); })
        .catch(() => {})
    )
  );
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'CONTENT_REFRESHED' }));
}

// ── PUSH NOTIFICATIONS (native VAPID Web Push) ────────────────────
// Payload from the Studyria notification backend (snMutate dispatch):
//   { title, body, icon, badge, tag, requireInteraction, data:{ url } }
//
// SMART ANNOUNCEMENT ENGINE (v94, additive upgrade):
//   • The push data.url carries the ?notif=<kind>:<id> deep-link descriptor.
//     We derive the announcement kind from it and render the professional
//     branded template (📚 New Study Material Added / 💼 New Job Alert /
//     📝 New Quiz Available / 🎯 New Mock Test / 📰 New Current Affairs),
//     preserving the content title inside the body. Payloads that already
//     carry a branded title (or no descriptor) pass through untouched —
//     fully backward-compatible with the existing backend dispatch.
//   • A single CTA action button ("Read Now →" etc.) is added where the
//     browser supports notification actions (feature-detected via
//     'maxActions' in Notification). Unsupported browsers keep the
//     plain working notification — no breakage.
//   • Click handling is defensive: missing/invalid URL falls back to
//     the site root instead of throwing inside the service worker.

const PUSH_TEMPLATE = {
  pdf:    { title: '📚 New Study Material Added', cta: 'Read Now →' },
  job:    { title: '💼 New Job Alert',             cta: 'View Job →' },
  quiz:   { title: '📝 New Quiz Available',        cta: 'Start Quiz →' },
  mock:   { title: '🎯 New Mock Test',            cta: 'Take Test →' },
  affair: { title: '📰 New Current Affairs',      cta: 'Read Now →' },
};

function _notifKindFromUrl(url) {
  try {
    const u = new URL(String(url), self.location.origin);
    const m = /(?:\?|&)notif=([^&]+)/.exec(u.search);
    if (!m) return '';
    const raw = decodeURIComponent(m[1]);
    const i = raw.indexOf(':');
    return i < 0 ? '' : raw.slice(0, i);
  } catch (_) { return ''; }
}

// ── CUSTOM BANNER RESOLUTION (v95) ─────────────────────────────
// The composer uploads each notification's custom banner to public
// Supabase Storage at a deterministic path (covers bucket →
// sn-banners/<notificationId>.jpg) — the SAME url the live feed and
// the admin list already probe. The push payload has no banner field
// (dispatch backend untouched), so the service worker resolves the
// exact banner here. The backend's auto-generated Studyria poster
// (payload.image) remains the STRICT fallback — a failed or missing
// probe can never delay or break notification delivery: the push is
// ALWAYS shown first with the existing behavior, and the banner only
// ever replaces it silently (same tag → in-place update, renotify
// stays false → no second sound/vibration).
const SN_BANNER_BUCKETS   = ['covers', 'sn-banners'];
const SN_BANNER_PUBLIC    = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co/storage/v1/object/public/';
const SN_LIVE_ENDPOINT    = 'https://superagent-f8acee03.base44.app/functions/snLive';

function _withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

function _notifIdFromUrl(url) {
  try {
    const u = new URL(String(url), self.location.origin);
    const m = /(?:\?|&)notif=([^&]+)/.exec(u.search);
    if (!m) return '';
    const raw = decodeURIComponent(m[1]);
    const i = raw.indexOf(':');
    return i < 0 ? '' : raw.slice(i + 1);
  } catch (_) { return ''; }
}

/* HEAD-probe the deterministic banner paths. Returns the exact public
   banner url, or null (→ strict auto-poster fallback). */
async function _probeBannerUrl(id) {
  if (!id) return null;
  for (const bucket of SN_BANNER_BUCKETS) {
    const url = SN_BANNER_PUBLIC + bucket + '/sn-banners/' + id + '.jpg';
    try {
      const res = await _withTimeout(fetch(url, { method: 'HEAD' }), 2500);
      if (res && res.ok && /^image\//i.test(res.headers.get('content-type') || '')) return url;
    } catch (_) { /* next bucket → fallback */ }
  }
  return null;
}

/* Resolve the notification record id for this push. The deep-link
   descriptor often carries a CONTENT id (auto pushes) rather than the
   notification record id, so: (a) try the descriptor id directly,
   (b) fall back to an exact-title match on the public live feed
   (tiny payload, same endpoint the homepage already calls). */
async function _resolveCustomBanner(payload, rawUrl) {
  const id = _notifIdFromUrl(rawUrl);
  let record = null;
  try {
    if (/^[a-f0-9]{16,}$/i.test(id)) {
      const direct = await _probeBannerUrl(id);
      if (direct) return { url: direct, retry: false };
    }
    const res = await _withTimeout(fetch(SN_LIVE_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }), 3000);
    if (!res || !res.ok) return { url: null, retry: true };          // transient → retry
    const j = await res.json();
    const t = String(payload.title || '').trim();
    const arr = (j && j.notifications) || [];
    record = arr.filter(n => n && n.title && String(n.title).trim() === t)
                .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))[0] || null;
    if (!record) return { url: null, retry: false };                  // unresolvable → stop
    if (record.source === 'auto') return { url: null, retry: false }; // auto records never carry banners
    const byRecord = await _probeBannerUrl(record.id);
    if (byRecord) return { url: byRecord, retry: false };
    return { url: null, retry: true };                                // manual + race with upload → retry
  } catch (_) {
    return { url: null, retry: !!record };                           // network hiccup → cautious retry
  }
}

/* The composer uploads the banner a few seconds AFTER create fires
   the push (banner path needs the new notification id), so the first
   probe can legitimately miss. Brief bounded retries; on hit, the
   same-tag re-show swaps the poster for the exact banner in place. */
async function _upgradeWithCustomBanner(payload, rawUrl, title, options) {
  for (const delay of [2000, 5000, 9000]) {
    await new Promise(r => setTimeout(r, delay));
    const r = await _resolveCustomBanner(payload, rawUrl);
    if (r.url) {
      options.image = r.url;
      await self.registration.showNotification(title, options);       // same tag → silent in-place replace
      return;
    }
    if (!r.retry) return;                                             // no banner will ever appear
  }
}

self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch (_) { payload = { title: 'Studyria', body: event.data.text() }; }

  const data   = payload.data || {};
  const rawUrl = data.url || data.click_url || '/';
  const kind   = _notifKindFromUrl(rawUrl);
  const tmpl   = PUSH_TEMPLATE[kind];

  let title = payload.title || 'Studyria';
  let body  = payload.body || '';

  // Smart branded template — only when we know the kind and the title
  // is not already branded. Content title is preserved in the body.
  if (tmpl && !/^[📚💼📝🎯📰🗂️]/u.test(title)) {
    title = tmpl.title;
    body  = payload.title
      ? (body ? payload.title + ' — ' + body : payload.title)
      : body;
  }

  const options = {
    body:    body,
    icon:    payload.icon    || '/icon-192.png',
    badge:   payload.badge   || '/icon-96.png',
    image:   payload.image   || undefined,
    data:    { url: rawUrl },
    tag:     payload.tag     || ('studyria-push' + (kind ? '-' + kind : '')),
    requireInteraction: payload.requireInteraction || false,
  };

  // CTA action button — only where the browser actually supports actions.
  if (tmpl && self.Notification && ('maxActions' in self.Notification)) {
    options.actions = [{ action: 'open', title: tmpl.cta }];
  } else if (payload.actions && payload.actions.length) {
    options.actions = payload.actions;
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);   // instant — existing behavior first
    try { await _upgradeWithCustomBanner(payload, rawUrl, title, options); } catch (_) {} // v95: never blocks delivery
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close(); // works for both the body tap and the CTA button
  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  let target;
  try {
    target = new URL(String(rawUrl), self.location.origin);
    if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
    target = target.href;
  } catch (_) {
    target = new URL('/', self.location.origin).href; // never open a broken URL
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url === target && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }).catch(() => self.clients.openWindow(new URL('/', self.location.origin).href))
  );
});


// ── MESSAGE HANDLER ───────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type, urls } = event.data || {};

  // ── v95: SN_RESOLVE_BANNER — verification hook (read-only, public data) ──
  if (type === 'SN_RESOLVE_BANNER' && event.data && event.data.id) {
    _probeBannerUrl(String(event.data.id)).then(url => {
      event.source && event.source.postMessage({ type: 'SN_BANNER_RESOLVED', id: String(event.data.id), url: url || null });
    });
    return;
  }

  if (type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING — activating update');
    self.skipWaiting();
    return;
  }

  if (type === 'GET_VERSION') {
    event.source && event.source.postMessage({
      type:      'VERSION_INFO',
      cacheName: CACHE_NAME,
      build:     SW_BUILD,
      version:   SW_BUILD,
      whatsNew:  WHATS_NEW,
    });
    return;
  }

  if (type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.source && event.source.postMessage({ type: 'CACHE_CLEARED' }));
    return;
  }

  if (type === 'PREFETCH_URLS' && Array.isArray(urls)) {
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(urls.map(url => cache.add(url).catch(() => {})))
    );
    return;
  }

  // ── PWA V3.2: SHOW_NOTIFICATION — display notification from admin ──
  if (type === 'SHOW_NOTIFICATION') {
    const payload = event.data.payload || {};
    const title = payload.title || 'Studyria';
    const options = {
      body: payload.body || '',
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-96.png',
      image: payload.image || undefined,
      data: { url: payload.deep_link || '/' },
      tag: payload.tag || 'studyria-admin',
      requireInteraction: payload.requireInteraction || false,
      actions: payload.actions || [],
    };
    event.waitUntil(self.registration.showNotification(title, options));
    return;
  }

  // ── PWA V3.2: GET_CACHE_STATS — return cache size info ──
  if (type === 'GET_CACHE_STATS') {
    Promise.all([
      caches.open(CACHE_NAME).then(c => c.keys()).then(k => k.length),
      caches.open(IMG_CACHE).then(c => c.keys()).then(k => k.length),
      caches.open(FONT_CACHE).then(c => c.keys()).then(k => k.length),
    ]).then(function(stats) {
      event.source && event.source.postMessage({
        type: 'CACHE_STATS',
        mainCache: stats[0],
        imgCache: stats[1],
        fontCache: stats[2],
      });
    });
    return;
  }

  // ── PWA V3.2: REFRESH_SPECIFIC — refresh specific cached URLs ──
  if (type === 'REFRESH_URLS' && Array.isArray(urls)) {
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(urls.map(url =>
        fetch(url, { cache: 'no-store' }).then(res => {
          if (res && res.ok) cache.put(url, res);
        }).catch(() => {})
      ));
      event.source && event.source.postMessage({ type: 'REFRESH_COMPLETE' });
    })();
    return;
  }
});
