// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  v8  (Production-Ready PWA)
// ══════════════════════════════════════════════════════════════════
//
// Cache Strategy:
//   • Navigation (HTML)         — Network-first, offline fallback.
//   • Same-origin JS/CSS/fonts  — Stale-while-revalidate.
//   • API / Supabase / Razorpay / Pipedream / CDN
//     — Bypassed entirely (always fresh from network).
//
// Messages:
//   • SKIP_WAITING  → activates this waiting SW immediately.
//   • GET_VERSION   → replies with cache name, build label, whats new.
//   • CLEAR_CACHE   → wipes all caches.
//
// OneSignal:
//   • SDK imported via importScripts at the very top of this file,
//     before any custom event listeners, so the SDK can register its
//     own push/notificationclick handlers first.
//   • OneSignalSDKWorker.js is no longer needed; this file replaces it.
//   • The OneSignal SDK is only imported once (guard via a flag) to
//     prevent duplicate handler registration if the file is re-parsed.
// ══════════════════════════════════════════════════════════════════

// ── ONESIGNAL SDK (must be first, before any custom push handlers) ─
// importScripts is synchronous and runs immediately during SW evaluation.
// Placing it here guarantees OneSignal's push/notificationclick listeners
// are registered before our own listeners below, matching the behaviour
// OneSignal expects when it is the sole SW entry-point.
//
// We guard with a flag so that if the browser somehow re-evaluates this
// script (e.g. hot-update edge-cases) the import runs only once per
// SW context lifetime.
if (typeof self._oneSignalSDKLoaded === 'undefined') {
  self._oneSignalSDKLoaded = true;
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
}

const CACHE_NAME   = 'studyria-v24';  // premium page visibility fix
const SW_BUILD     = '2026.07.14-phase5d-premium-experience';
const OFFLINE_PAGE = '/offline.html';

const WHATS_NEW = '🐛 Fixed ReferenceError: _blockDoubleTap is not defined — function was renamed to _handleDoubleTap and cache was stale. All clients now receive the latest build.';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',           // SPA shell (index.html) — required for SPA fallback
  OFFLINE_PAGE,
  '/manifest.json',
  '/icon-72.png',
  '/icon-96.png',
  '/icon-128.png',
  '/icon-144.png',
  '/icon-152.png',
  '/icon-192.png',
  '/icon-384.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
];

// ── INSTALL ──────────────────────────────────────────────────────
// Do NOT call self.skipWaiting() unconditionally here.
// Doing so prevents the "waiting" state that triggers the App Center
// update card. SKIP_WAITING is sent from the page when the user
// explicitly clicks "Update Now".
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // allSettled: don't fail install if one asset is missing
      Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Pre-cache failed for:', url, err);
          })
        )
      )
    )
  );
  // NOT calling self.skipWaiting() — intentional.
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Delete all old caches (any studyria-vN that isn't current)
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
        )
      ),
      // Enable navigation preload if supported (speeds up navigation)
      (async () => {
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      })(),
    ])
  );
  // Take control of all clients immediately after activation
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
    'firebaseapp.com',
    'firebaseio.com',
    'firebase.google.com',
  ];
  if (bypassHosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ③ Bypass CDN scripts (always fresh).
  //    NOTE: onesignal.com is intentionally excluded from bypass so that
  //    the OneSignal SDK fetch (importScripts above) is not intercepted
  //    by this SW's own fetch handler. importScripts is handled by the
  //    browser internally and does not go through the fetch event, so
  //    there is no conflict — this comment is here for future clarity.
  const bypassCDNs = [
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
  ];
  if (bypassCDNs.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ④ HTML navigation — SPA fallback: always serve index.html (the SPA shell).
  //
  //    WHY: This is a Single-Page App. Every path (/library, /dashboard,
  //    /privacy, /terms, /refund, /about, /contact …) is rendered entirely
  //    by client-side JS inside index.html. The server has no separate file
  //    for those paths, so any direct visit or refresh returns a 404 from
  //    the origin. The Service Worker intercepts all navigate requests BEFORE
  //    they reach the network and returns the cached SPA shell instead,
  //    which then reads location.hash (set by the early path→hash redirect
  //    script in <head>) and renders the correct page — zero 404s, zero
  //    reloads.
  //
  //    On first visit (SW not yet installed) the path→hash redirect script
  //    in index.html's <head> handles the redirect client-side.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        // 1. Try navigation preload first (speeds up first frame when
        //    enabled) — this IS a live network response, so treat it the
        //    same as a fresh fetch: cache it, then serve it.
        try {
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse && preloadResponse.ok) {
            cache.put('/', preloadResponse.clone());
            return preloadResponse;
          }
        } catch (_) { /* fall through to network fetch below */ }

        // 2. NETWORK-FIRST for the SPA shell. This is the fix: previously
        //    step 2 served the cached shell before ever touching the
        //    network, so a fresh deploy (new index.html, new features like
        //    the WhatsApp button) could stay invisible to any returning
        //    visitor indefinitely — the SW would keep answering navigation
        //    requests out of the old cached copy forever. Always try the
        //    network first so new deploys are picked up on the very next
        //    visit; only fall back to cache when the network genuinely
        //    fails (offline / no connectivity).
        try {
          const networkShell = await fetch('/', { cache: 'no-store' });
          if (networkShell && networkShell.ok) {
            cache.put('/', networkShell.clone());
            return networkShell;
          }
          throw new Error('Network response not ok: ' + networkShell.status);
        } catch (_) {
          // 3. Network failed — fall back to whatever SPA shell we have
          //    cached, so /library, /dashboard etc. still work offline.
          const cachedShell = await cache.match('/');
          if (cachedShell) return cachedShell;

          // 4. No cache at all — last resort offline page.
          const offlinePage = await caches.match(OFFLINE_PAGE);
          return offlinePage || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // ⑤ Same-origin JS / CSS / fonts / images — Stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);

        // Always fetch in background to keep cache fresh
        const networkFetch = fetch(request)
          .then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        // Return cached immediately if available, else await network
        return cached || networkFetch;
      })
    );
    return;
  }

  // ⑥ Everything else — pass through to network
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      // Notify all clients that sync fired
      self.clients.matchAll().then(clients =>
        clients.forEach(client =>
          client.postMessage({ type: 'sync_registered', tag: event.tag })
        )
      )
    );
  }
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type } = event.data || {};

  // Activate this waiting SW immediately (called by "Update Now" button)
  if (type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — activating now');
    self.skipWaiting();
    return;
  }

  // App Center: query SW version & what's-new text
  if (type === 'GET_VERSION') {
    event.ports?.[0]?.postMessage({
      cacheName: CACHE_NAME,
      build:     SW_BUILD,
      version:   SW_BUILD,
      whatsNew:  WHATS_NEW,
    });
    return;
  }

  // Clear all caches (admin / force-refresh)
  if (type === 'CLEAR_CACHE') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => {
        event.ports?.[0]?.postMessage({ ok: true });
        console.log('[SW] All caches cleared on request.');
      });
    return;
  }
});
