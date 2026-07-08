
// ── HOME PAGE CACHE BUST (Quick Actions + Learning Stats removed) ──────
(function() {
  const CACHE_VERSION = 'v_home_clean_2';
  const BUST_KEY = 'studyria_home_cache_busted';
  if (localStorage.getItem(BUST_KEY) !== CACHE_VERSION) {
    // Clear legacy home layout keys
    const keysToRemove = [
      'studyria_streak', 'studyria_pdfs_read', 'studyria_xp',
      'studyria_last_pdf', 'studyria_home_layout', 'studyria_home_sections',
      'home_cache', 'homepage_cache', 'studyria_quick_actions_cache',
      'studyria_stats_cache'
    ];
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
    // Clear sessionStorage home entries
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.includes('home') || k.includes('streak') || k.includes('quick')) {
          sessionStorage.removeItem(k);
        }
      });
    } catch(e) {}
    // Bust SW cache for home page
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          caches.open(name).then(cache => {
            cache.delete(location.origin + '/').catch(() => {});
            cache.delete(location.origin + '/index.html').catch(() => {});
          });
        });
      }).catch(() => {});
    }
    localStorage.setItem(BUST_KEY, CACHE_VERSION);
    console.log('✅ Studyria home cache cleared — sections updated');
  }
})();
