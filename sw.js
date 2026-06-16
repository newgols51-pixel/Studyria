// ══════════════════════════════════════════════════════════════════
// sw.js — Studyria Service Worker
// Strategy:
//   • Navigation requests (HTML) — network-first, no caching.
//     This prevents a stale index.html from masking auth or JS fixes.
//   • Static assets (JS/CSS/fonts) — stale-while-revalidate, so
//     the page loads fast but the cache is updated in the background.
//   • API calls (Supabase / Razorpay / Pipedream) — bypassed entirely
//     so auth tokens are never intercepted or cached.
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME   = 'studyria-v6.2';
const OFFLINE_PAGE = '/404.html';

// ── INSTALL ──────────────────────────────────────────────────────
// Pre-cache only the offline fallback page.
// Do NOT pre-cache index.html — always fetch it fresh from the
// network so auth-state changes are never masked by a cached copy.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.add(OFFLINE_PAGE).catch(() => {
        // If 404.html is missing, skip without breaking install.
      });
    })
  );
  // Activate immediately — don't wait for existing tabs to close.
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────
// Delete every cache that isn't the current version.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  // Take control of all open clients immediately.
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ① Only intercept GET requests.
  if (request.method !== 'GET') return;

  // ② Bypass all third-party API calls — auth tokens must reach the
  //    network without any service-worker interference.
  if (
    url.hostname.includes('supabase.co')   ||
    url.hostname.includes('razorpay.com')  ||
    url.hostname.includes('pipedream.net') ||
    url.hostname.includes('googleapis.com')
  ) return;

  // ③ Bypass CDN scripts (Supabase SDK, Razorpay checkout, etc.) —
  //    let the browser's built-in HTTP cache handle them.
  if (
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('checkout.razorpay.com')
  ) return;

  // ④ HTML navigation — network-first, NO caching.
  //    This guarantees that index.html is always fresh, so any
  //    authentication or JavaScript changes deploy immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE))
        )
    );
    return;
  }

  // ⑤ Same-origin JS / CSS — stale-while-revalidate.
  //    Serve from cache for speed; update the cache entry in the
  //    background so the next load gets the latest version.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(request, res.clone());
          }
          return res;
        }).catch(() => null);
        // Return cached immediately if available; otherwise wait for network.
        return cached || networkFetch;
      })
    );
    return;
  }

  // ⑥ Everything else — pass through to network.
});
