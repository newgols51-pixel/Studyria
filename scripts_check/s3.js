
// === STUDYRIA PERFORMANCE LAYER ===
// Shared Supabase request cache — prevents duplicate DB calls across modules
window._supabaseCache = window._supabaseCache || new Map();
window._sbCacheTTL = 60000; // 60s TTL for cached responses

/**
 * cachedSupabaseQuery(key, queryFn, ttl?)
 * Returns cached result if fresh, otherwise calls queryFn() and caches result.
 * Use for read-only Supabase queries that don't need real-time freshness.
 */
window.cachedSupabaseQuery = async function(key, queryFn, ttl) {
  const cache = window._supabaseCache;
  const now = Date.now();
  const ttlMs = ttl || window._sbCacheTTL;
  if (cache.has(key)) {
    const { data, ts } = cache.get(key);
    if (now - ts < ttlMs) return data;
  }
  try {
    const data = await queryFn();
    cache.set(key, { data, ts: now });
    return data;
  } catch(e) {
    console.warn('cachedSupabaseQuery error:', key, e);
    return null;
  }
};

// Global IntersectionObserver for lazy-loading images
window._lazyObserver = null;
window.initLazyImages = function() {
  if (window._lazyObserver) return;
  window._lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      }
      window._lazyObserver.unobserve(img);
    });
  }, { rootMargin: '200px' });
  document.querySelectorAll('img[data-src]').forEach(img => window._lazyObserver.observe(img));
};

// Debounce helper (avoids flooding Supabase on rapid input)
window.debounce = function(fn, wait) {
  let t; return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
};

// Battery-aware animation control
if ('getBattery' in navigator) {
  navigator.getBattery().then(batt => {
    window._lowBattery = batt.level < 0.2 && !batt.charging;
    batt.addEventListener('levelchange', () => {
      window._lowBattery = batt.level < 0.2 && !batt.charging;
      if (window._lowBattery) document.body.classList.add('low-battery');
      else document.body.classList.remove('low-battery');
    });
    if (window._lowBattery) document.body.classList.add('low-battery');
  }).catch(() => {});
}
