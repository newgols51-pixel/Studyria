// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker
// Strategy:
//   • Navigation (HTML)        — network-first, no caching.
//     Prevents stale index.html from masking auth or JS fixes.
//   • Same-origin JS/CSS/fonts — stale-while-revalidate, loads fast
//     and cache is updated in background.
//   • API calls (Supabase / Razorpay / Pipedream / RapidAPI / RSS)
//     — bypassed entirely so auth tokens & live data are never
//     intercepted or served stale.
//   • Career Hub jobs (Supabase) — bypassed so Pipedream-synced
//     jobs always appear fresh without a hard refresh.
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME   = 'studyria-v5';   // ← bumped from v4 → forces old cache purge
const OFFLINE_PAGE = '/404.html';

// ── Static assets to pre-cache on install ────────────────────────
// Keep this list minimal — only shell assets needed for the offline
// fallback. index.html is intentionally excluded (always network-first).
const PRECACHE_ASSETS = [
  OFFLINE_PAGE,
  // Add any critical CSS/icon files here if needed, e.g.:
  // '/icons/icon-192.png',
  // '/icons/icon-512.png',
];

// ── INSTALL ──────────────────────────────────────────────────────
// Pre-cache the offline fallback. skipWaiting() activates immediately
// so new service worker takes over without waiting for old tabs to close.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────
// Delete every cache entry that isn't the current version name.
// This purges the old 'studyria-v4' cache automatically.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ① Only intercept GET requests — POST/PUT/DELETE pass through untouched.
  if (request.method !== 'GET') return;

  // ② Bypass all third-party API & data hosts — auth tokens, live job
  //    data, RSS feeds and payment scripts must NEVER be cached or
  //    intercepted by the service worker.
  const bypassHosts = [
    // Supabase (auth, database, Realtime, Storage)
    'supabase.co',
    // Payment
    'razorpay.com',
    'checkout.razorpay.com',
    // Pipedream webhook & workflow triggers
    'pipedream.net',
    'm.pipedream.net',
    // Google APIs / Fonts served via googleapis
    'googleapis.com',
    'gstatic.com',
    // JSearch / RapidAPI (used by Pipedream workflow, not browser,
    // but bypass here as a safety net)
    'rapidapi.com',
    'jsearch.p.rapidapi.com',
    // RSS feed sources — always fetch live so Career Hub stays current
    'sarkariresult.com',
    'freshersworld.com',
    'employmentnews.gov.in',
    'assamcareer.in',
  ];
  if (bypassHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ③ Bypass CDN scripts — let the browser's built-in HTTP cache handle
  //    versioned CDN assets (Supabase SDK, etc.).
  const bypassCDNs = [
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
  ];
  if (bypassCDNs.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ④ HTML navigation — network-first, NO caching.
  //    Ensures index.html is always the latest deploy; no auth or
  //    Career Hub JS updates are ever masked by a cached copy.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE))
        )
    );
    return;
  }

  // ⑤ Same-origin JS / CSS / fonts — stale-while-revalidate.
  //    Covers: career-hub.js, supabase.js, pipedream.js and any other
  //    local scripts. Served instantly from cache; cache entry is
  //    refreshed in the background so the NEXT load is always fresh.
  //
  //    Note: because CACHE_NAME bumped to v5, all stale-while-revalidate
  //    entries from v4 are already gone — first load after update always
  //    fetches from network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached      = await cache.match(request);
        const networkFetch = fetch(request).then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(request, res.clone());
          }
          return res;
        }).catch(() => null);
        // Serve stale immediately if available; wait for network otherwise.
        return cached || networkFetch;
      })
    );
    return;
  }

  // ⑥ Everything else — pass through to network unmodified.
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────
// Allows the app to manually trigger a cache clear (e.g. after a
// forced update or admin action). Call from the app with:
//   navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHE' })
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      event.ports?.[0]?.postMessage({ ok: true });
      console.log('[SW] All caches cleared on request.');
    });
  }

  // SKIP_WAITING message — useful when the app detects a new SW
  // is waiting and wants to activate it without a tab close.
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
