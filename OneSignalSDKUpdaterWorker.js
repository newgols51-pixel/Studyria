/**
 * OneSignalSDKUpdaterWorker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Studyria — DEPRECATED legacy OneSignal service worker shim.
 *
 * See OneSignalSDKWorker.js for the full explanation. This file had the
 * exact same scope-conflict problem (importScripts of the OneSignal SW
 * bundle at the root scope) and is fixed the same way: self-unregister
 * instead of importing the bundle, so it stops fighting sw.js for
 * control of scope "/".
 * ─────────────────────────────────────────────────────────────────────────────
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil(
    (async () => {
      console.log('[OneSignalSDKUpdaterWorker.js] Deprecated — unregistering self to release scope "/" to sw.js');
      try {
        await self.registration.unregister();
      } catch (err) {
        console.warn('[OneSignalSDKUpdaterWorker.js] Unregister failed:', err);
      }
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
