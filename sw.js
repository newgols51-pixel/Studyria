// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker  v30  (PWA V3 — 2026 Ultimate)
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
// Push: OneSignal SDK first, then our custom handlers.
// Periodic Sync: 'studyria-content-refresh' every 12 hours.
// Background Sync: 'sync-data' for deferred writes.
// ══════════════════════════════════════════════════════════════════

// ── ONESIGNAL (must be first) ─────────────────────────────────────
if (typeof self._oneSignalSDKLoaded === 'undefined') {
  self._oneSignalSDKLoaded = true;
  try {
    importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
  } catch (e) {
    console.warn('[SW] OneSignal SDK load failed:', e.message);
  }
}

// ── VERSION ───────────────────────────────────────────────────────
const CACHE_VERSION = 'v49'; /* fix BrainLab: restore full engine (getDailyStatus, pyq/mcq switchTab, answer locks, SVG icons) */
const CACHE_NAME    = 'studyria-' + CACHE_VERSION;
const IMG_CACHE     = 'studyria-img-' + CACHE_VERSION;
const FONT_CACHE    = 'studyria-font-' + CACHE_VERSION;
const SW_BUILD      = '2026.09.01-live-notifications-fix';
const OFFLINE_PAGE  = '/offline.html';

const WHATS_NEW = '🧠 BrainLab expanded: 12 learning sections with quizzes, mock tests, flashcards, PYQ practice, study streak, and more. Complete learning hub redesign.';

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
  'onesignal.com',
  'api.onesignal.com',
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

  // 1. Try navigation preload
  try {
    const preload = await event.preloadResponse;
    if (preload && preload.ok) {
      cache.put('/', preload.clone());
      return preload;
    }
  } catch (_) {}

  // 2. Network-first
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (res && res.ok) {
      cache.put('/', res.clone());
      return res;
    }
  } catch (_) {}

  // 3. Cache fallback (SPA shell)
  const cached = await cache.match('/');
  if (cached) return cached;

  // 4. Offline page
  const offline = await caches.match(OFFLINE_PAGE);
  return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

// ── STRATEGY: Stale-while-revalidate ─────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(res => {
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

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
// OneSignal handles push events first (via importScripts above).
// We add a fallback for any non-OneSignal pushes.
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch (_) { payload = { title: 'Studyria', body: event.data.text() }; }
  const title   = payload.title || 'Studyria';
  const options = {
    body:    payload.body    || '',
    icon:    payload.icon    || '/icon-192.png',
    badge:   payload.badge   || '/icon-96.png',
    image:   payload.image   || undefined,
    data:    payload.data    || {},
    tag:     payload.tag     || 'studyria-push',
    requireInteraction: payload.requireInteraction || false,
    actions: payload.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type, urls } = event.data || {};

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
