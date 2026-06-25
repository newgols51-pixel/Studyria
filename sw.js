// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  v7  (Production-Ready PWA)
// ══════════════════════════════════════════════════════════════════
//
// Cache Strategy:
//   • Navigation (HTML)         — Network-first, offline fallback.
//   • Same-origin JS/CSS/fonts  — Stale-while-revalidate.
//   • API / Supabase / Razorpay / Pipedream / CDN
//     — Bypassed entirely (always fresh from network).
//   • OneSignal SDK files       — Bypassed (handled by their own SW).
//
// Messages:
//   • SKIP_WAITING  → activates this waiting SW immediately.
//   • GET_VERSION   → replies with cache name, build label, whats new.
//   • CLEAR_CACHE   → wipes all caches.
//
// OneSignal Integration Notes:
//   OneSignal uses its own service workers (OneSignalSDKWorker.js and
//   OneSignalSDKUpdaterWorker.js at root scope). This SW does NOT
//   intercept push events from OneSignal — OneSignal's own SW handles
//   those. This SW only handles the Studyria-specific push events that
//   are sent directly to this registration (non-OneSignal pushes).
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME   = 'studyria-v7';           // ← bump on every deploy
const SW_BUILD     = '2025.06.25-r2';
const OFFLINE_PAGE = '/offline.html';          // FIX: was /404.html

const WHATS_NEW = '✨ Faster offline caching, improved update detection, background sync & Career Hub improvements.';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  OFFLINE_PAGE,
  // Add critical static assets here (icons, manifest, etc.)
  '/manifest.json',
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
    // OneSignal SDK — must always be fresh, handled by their own SW
    'onesignal.com',
  ];
  if (bypassCDNs.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // ③b Bypass OneSignal service-worker shim files on same origin
  //     These files import the OneSignal CDN bundle and must never be
  //     served stale from our cache.
  const bypassPaths = [
    '/OneSignalSDKWorker.js',
    '/OneSignalSDKUpdaterWorker.js',
  ];
  if (bypassPaths.includes(url.pathname)) return;

  // ④ HTML navigation — Network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try navigation preload response first
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) return preloadResponse;

          // Then try network
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch {
          // Network failed — try cache, then offline page
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
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
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/icon-96.png',
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
