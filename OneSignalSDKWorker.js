/**
 * OneSignalSDKWorker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Studyria — OneSignal Web Push Service Worker Shim
 *
 * This file MUST live at the root of your site (/OneSignalSDKWorker.js) so
 * the browser can register it with its default scope of "/".
 *
 * It simply imports the latest OneSignal service-worker bundle from the CDN.
 * OneSignal handles all push-subscription bookkeeping, notification display,
 * and notification-click routing internally — your sw.js (Studyria's own SW)
 * continues to handle caching, offline fallback, and background sync as usual.
 *
 * DO NOT add custom logic here. Customise notifications via the OneSignal
 * dashboard or via window.OneSignalDeferred in your page scripts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
