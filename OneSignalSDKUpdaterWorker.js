/**
 * OneSignalSDKUpdaterWorker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Studyria — OneSignal Web Push Updater Service Worker Shim
 *
 * Some older OneSignal SDK versions and certain browsers look for this file
 * as a second service-worker entry point. Including it ensures maximum
 * compatibility across Chrome, Edge, Firefox, Android, and Safari.
 *
 * Like OneSignalSDKWorker.js, this file simply delegates to the CDN bundle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
