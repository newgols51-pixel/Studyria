// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  (Smart App Center Edition)
// Version: studyria-v6  — PWA App Center update detection support
//
// Strategy:
//   • Navigation (HTML)        — network-first, no caching.
//   • Same-origin JS/CSS/fonts — stale-while-revalidate.
//   • API / Supabase / Razorpay / Pipedream / RapidAPI / RSS
//     — bypassed entirely.
//   • Career Hub jobs          — bypassed, always fresh.
//
// App Center additions:
//   • GET_VERSION → replies with cache name & build label.
//   • SKIP_WAITING → activates waiting SW immediately.
//   • CLEAR_CACHE  → wipes all caches (admin / force-refresh).
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME   = 'studyria-v6';          // bump this to force update
const SW_BUILD     = '2025.06.25-r1';         // human-readable version label
const OFFLINE_PAGE = '/404.html';

// Shown in the burger menu update card
const WHATS_NEW = '✨ Smart App Center, auto-update detection, faster offline caching & Career Hub improvements.';

// ── Static assets to pre-cache on install ────────────────────────
const PRECACHE_ASSETS = [
  OFFLINE_PAGE,
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
      )
    )
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────
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

  // ① Only intercept GET requests
  if (request.method !== 'GET') return;

  // ② Bypass all third-party API & data hosts
  const bypassHosts = [
    'supabase.co',
    'razorpay.com',
    'checkout.razorpay.com',
    'pipedream.net',
    'm.pipedream.net',
    'googleapis.com',
    'gstatic.com',
    'rapidapi.com',
    'jsearch.p.rapidapi.com',
    'sarkariresult.com',
    'freshersworld.com',
    'employmentnews.gov.in',
    'assamcareer.in',
  ];
  if (bypassHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ③ Bypass CDN scripts
  const bypassCDNs = [
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
  ];
  if (bypassCDNs.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ④ HTML navigation — network-first, NO caching
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE))
        )
    );
    return;
  }

  // ⑤ Same-origin JS / CSS / fonts — stale-while-revalidate
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
        return cached || networkFetch;
      })
    );
    return;
  }

  // ⑥ Everything else — pass through
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────
self.addEventListener('message', event => {

  // Clear all caches (admin / force-refresh)
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      event.ports?.[0]?.postMessage({ ok: true });
      console.log('[SW] All caches cleared on request.');
    });
  }

  // Activate waiting SW immediately (used by App Center "Update Now")
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // App Center queries SW version & what's new text
  if (event.data?.type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({
      cacheName: CACHE_NAME,
      build:     SW_BUILD,
      whatsNew:  WHATS_NEW,
    });
  }
});
