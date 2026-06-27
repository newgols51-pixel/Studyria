// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  v8  (Production-Ready PWA + OneSignal)
// ══════════════════════════════════════════════════════════════════
//
// Cache Strategy:
//   • Navigation (HTML)         — Network-first, offline fallback.
//   • Same-origin JS/CSS/fonts  — Stale-while-revalidate.
//   • API / Supabase / Razorpay / Pipedream / CDN
//     — Bypassed entirely (always fresh from network).
//   • OneSignal SDK requests    — Bypassed (always fresh from CDN).
//
// Messages:
//   • SKIP_WAITING  → activates this waiting SW immediately.
//   • GET_VERSION   → replies with cache name, build label, whats new.
//   • CLEAR_CACHE   → wipes all caches.
//
// OneSignal Integration Notes:
//   This is a COMBINED service worker. OneSignal does not run a separate
//   worker/scope — its push runtime is imported directly below via
//   importScripts(), per OneSignal's official "merge with an existing
//   service worker" setup. OneSignal.init() in index.html points at this
//   exact file (serviceWorkerPath: "/sw.js", serviceWorkerParam: { scope: "/" }),
//   so there is only ONE service worker, ONE scope ("/"), and ONE
//   registration for the whole site — Studyria's caching/offline/PWA logic
//   AND OneSignal's push delivery both run inside it.
//
//   The 'push' and 'notificationclick' listeners below are Studyria's own
//   fallback handlers (used only for non-OneSignal pushes, e.g. raw
//   PushManager subscriptions from subscribeToPushNotifications() in
//   app.js). OneSignal's imported bundle registers its own internal
//   'push' / 'notificationclick' listeners that run independently and
//   handle all OneSignal-sent notifications — the two do not conflict
//   because each only acts on the data shape it owns.
// ══════════════════════════════════════════════════════════════════

// Must be the first statement that runs — wires this worker into
// OneSignal's push delivery pipeline. Always fetched fresh (see the
// bypass rule for onesignal.com in registerServiceWorker()'s updateViaCache:
// 'none', and the fetch-handler bypass below).
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME   = 'studyria-v13';           // ← bumped: fixed icon paths
const SW_BUILD     = '2026.06.27-r3-icon-path-fix';
const OFFLINE_PAGE = '/offline.html';

const WHATS_NEW = '🔧 Icon path fix: all PWA icons now served from root. No more 404s in Chrome DevTools Manifest panel.';

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

  // ③ Bypass CDN scripts (always fresh)
  const bypassCDNs = [
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    // OneSignal SDK files — always fetched fresh from their CDN
    // (this worker only importScripts() them once at startup; runtime
    // requests OneSignal's bundle makes are never cached by us)
    'onesignal.com',
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
        try {
          // 1. Try navigation preload (speeds up first frame when enabled)
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse && preloadResponse.ok) return preloadResponse;

          // 2. Always attempt to serve the cached SPA shell (/) first.
          //    This guarantees refresh on /library, /dashboard etc. never 404.
          const cache = await caches.open(CACHE_NAME);
          const cachedShell = await cache.match('/');
          if (cachedShell) return cachedShell;

          // 3. Cache miss — fetch the shell from the network and cache it.
          const networkShell = await fetch('/');
          if (networkShell && networkShell.ok) {
            cache.put('/', networkShell.clone());
            return networkShell;
          }

          // 4. Network also failed — try any cached copy of root.
          const anyRoot = await caches.match('/');
          if (anyRoot) return anyRoot;

          // 5. Last resort: offline page.
          const offlinePage = await caches.match(OFFLINE_PAGE);
          return offlinePage || new Response('Offline', { status: 503 });
        } catch {
          // Network error — serve cached shell or offline page.
          const cachedShell = await caches.match('/');
          if (cachedShell) return cachedShell;
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

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: event.data.text() }; }

  const title   = data.title   || 'Studyria';
  const options = {
    body:    data.body    || 'You have a new notification',
    icon:    data.icon    || '/icon-192.png',
    badge:   data.badge   || '/icon-96.png',
    image:   data.image   || undefined,
    tag:     data.tag     || 'studyria-push',
    data:    data.data    || { url: '/' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
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
