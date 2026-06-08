// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker
// NOTE: index.html registers './sw.js' (NOT 'service-worker.js').
// Keep this file named sw.js in the project root.
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'studyria-v1';
const OFFLINE_PAGE  = '/404.html';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/404.html',
  // External CDN assets are NOT pre-cached (they handle their own caching)
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────────────────
// Strategy: Network-first for HTML/API, cache-first for static assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin API calls (Supabase, Razorpay, Pipedream)
  if (request.method !== 'GET') return;
  if (
    url.hostname.includes('supabase.co')    ||
    url.hostname.includes('razorpay.com')   ||
    url.hostname.includes('pipedream.net')  ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('jsdelivr.net')
  ) return;

  // HTML navigation — network first, fallback to cache, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => { cacheResponse(request, res.clone()); return res; })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE))
        )
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        cacheResponse(request, res.clone());
        return res;
      });
    })
  );
});

function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  caches.open(CACHE_NAME).then(cache => cache.put(request, response));
}
