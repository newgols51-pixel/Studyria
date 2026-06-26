/**
 * OneSignalSDKWorker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Studyria — DEPRECATED legacy OneSignal service worker shim.
 *
 * ⚠️ THIS FILE NO LONGER POWERS PUSH. Studyria migrated to OneSignal's
 * "combine with an existing service worker" setup — push is now handled
 * inside /sw.js (which importScripts() the OneSignal SW bundle itself),
 * and app.js's OneSignal.init() points explicitly at serviceWorkerPath:
 * 'sw.js'.
 *
 * Root cause of the "stuck on Preparing…" bug: this file still
 * imports the OneSignal SW bundle directly at the root scope ("/").
 * Browsers that installed THIS worker before the migration keep a stale
 * registration alive at the same scope that sw.js now also registers.
 * Two service workers cannot both own scope "/" — the conflict stalls
 * OneSignal.init()'s internal SW handshake indefinitely, which is what
 * left the "Enable Notifications" button frozen on "Preparing…" with no
 * way out.
 *
 * FIX: this file now unregisters itself on activation instead of
 * importing the OneSignal bundle, so any browser still running the old
 * registration self-heals on the next visit and cleanly hands scope "/"
 * back to sw.js. Do not delete this file outright — if it 404s, some
 * browsers keep retrying the last-known-good (broken) cached version
 * instead of detecting removal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

self.addEventListener('install', () => {
  // Activate immediately — we want this self-unregister to happen ASAP,
  // not sit waiting behind an old tab.
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil(
    (async () => {
      console.log('[OneSignalSDKWorker.js] Deprecated — unregistering self to release scope "/" to sw.js');
      try {
        await self.registration.unregister();
      } catch (err) {
        console.warn('[OneSignalSDKWorker.js] Unregister failed:', err);
      }
      // Force any open tabs to pick up sw.js as the real controller.
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
