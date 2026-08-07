// main.js — Studyria  Phase 1
// ══════════════════════════════════════════════════════════════════
// Global error boundary + performance monitoring.
// Loaded AFTER all other scripts (defer).
//
// NOTE: The previous version of this file contained only:
//   myUndefinedFunction();   ← intentional Sentry verify snippet
// That crash-on-load was left in by mistake. This file replaces it
// with proper production error handling and perf reporting.
// ══════════════════════════════════════════════════════════════════

'use strict';

// ── 1. Global error boundary ─────────────────────────────────────
// Catches unhandled JS errors and unhandled promise rejections.
// Logs to console; forwards to Sentry if the SDK is present.

window.addEventListener('error', function(event) {
  const { message, filename, lineno, colno, error } = event;

  // Ignore cross-origin script errors (no useful info available)
  if (message === 'Script error.' && !filename) return;

  console.error('[Studyria] Unhandled error:', message, `${filename}:${lineno}:${colno}`, error);

  // Forward to Sentry if loaded
  if (window.Sentry && typeof window.Sentry.captureException === 'function') {
    window.Sentry.captureException(error || new Error(message), {
      extra: { filename, lineno, colno },
    });
  }
});

window.addEventListener('unhandledrejection', function(event) {
  const reason = event.reason;
  console.error('[Studyria] Unhandled promise rejection:', reason);

  if (window.Sentry && typeof window.Sentry.captureException === 'function') {
    window.Sentry.captureException(
      reason instanceof Error ? reason : new Error(String(reason))
    );
  }

  // Prevent "Uncaught (in promise)" noise in the console for known
  // non-critical rejections (e.g. Supabase realtime reconnects)
  if (reason && typeof reason === 'object') {
    const msg = (reason.message || '').toLowerCase();
    if (
      msg.includes('supabase') ||
      msg.includes('realtimeclient') ||
      msg.includes('network request failed') ||
      msg.includes('load failed')
    ) {
      event.preventDefault();
    }
  }
});

// ── 2. Performance reporting (logged once after page load) ────────
window.addEventListener('load', function() {
  // Report after a tick so all perf entries are finalized
  setTimeout(function() {
    try {
      const entries = performance.getEntriesByType('navigation');
      if (entries && entries.length) {
        const nav = entries[0];
        const metrics = {
          ttfb:    +(nav.responseStart   - nav.requestStart).toFixed(0),
          fcp:     +(nav.domInteractive  - nav.fetchStart).toFixed(0),
          load:    +(nav.loadEventEnd    - nav.fetchStart).toFixed(0),
          domSize: document.querySelectorAll('*').length,
          pdfs:    (window.PDFS || []).length,
        };
        console.log('[Studyria] Perf:', metrics);

        // Forward to Sentry as breadcrumb
        if (window.Sentry && typeof window.Sentry.addBreadcrumb === 'function') {
          window.Sentry.addBreadcrumb({
            category: 'performance',
            message:  'Page load metrics',
            data:     metrics,
            level:    'info',
          });
        }

        // Warn if TTFB is very high (> 1500ms) — indicates slow Supabase / CDN
        if (metrics.ttfb > 1500) {
          console.warn('[Studyria] High TTFB:', metrics.ttfb + 'ms — check Supabase region or CDN');
        }
      }
    } catch (e) { /* non-critical */ }
  }, 0);
});

// ── 3. Supabase connection health check ───────────────────────────
// Runs once after DOMContentLoaded. Warns in console if Supabase
// client is missing (misconfigured script order, CSP block, etc.)
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (!window.supabaseClient) {
      console.error(
        '[Studyria] ⚠️  window.supabaseClient is not set.\n' +
        'Ensure supabase.js loads AFTER the @supabase/supabase-js CDN script.\n' +
        'Library, stats, auth and wishlist features will not work.'
      );
    } else {
      console.log('[Studyria] ✅ supabaseClient ready');
    }

    if (!window.PDFS || window.PDFS.length === 0) {
      console.warn('[Studyria] ⚠️  window.PDFS is empty after DOMContentLoaded — pdf-list.js may still be loading.');
    }
  }, 2000); // 2s — enough time for pdf-list.js to complete its first fetch
});

// ── 4. Visibility-based Supabase stats refresh ────────────────────
// When the user returns to the tab after > 5 minutes, refresh the
// homepage live stats so they reflect any new purchases/PDFs.
(function() {
  let _hiddenAt = 0;
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      _hiddenAt = Date.now();
    } else {
      const away = Date.now() - _hiddenAt;
      if (_hiddenAt > 0 && away > REFRESH_THRESHOLD_MS) {
        if (typeof window.loadSupabaseHomeStats  === 'function') window.loadSupabaseHomeStats();
        if (typeof window.loadActivityBarStats   === 'function') window.loadActivityBarStats();
        console.log('[Studyria] Stats refreshed after', Math.round(away / 1000) + 's away');
      }
    }
  });
})();

console.log('[Studyria] main.js loaded ✅');
