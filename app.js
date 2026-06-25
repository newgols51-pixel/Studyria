/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDYRIA PWA APPLICATION LAYER (v2.0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handles:
 * - Service Worker registration & lifecycle management
 * - Install prompt & installed app detection
 * - Update detection & restart flow
 * - Offline/Online detection & handling
 * - Cache versioning & cleanup
 * - Background Sync support
 * - Push notification handling
 * - PWA diagnostics & performance monitoring
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// 1. PWA CONFIGURATION & STATE
// ═══════════════════════════════════════════════════════════════════════════

const PWA = {
  // Core configuration
  NAME: 'Studyria',
  VERSION: '2.0.0',
  SW_PATH: '/sw.js',
  MANIFEST_PATH: '/manifest.json',
  OFFLINE_PAGE: '/offline.html',
  
  // Cache versioning
  CACHE_VERSION: 'studyria-v2.0.0',
  RUNTIME_CACHE: 'studyria-runtime-v2.0.0',
  STATIC_CACHE: 'studyria-static-v2.0.0',
  
  // Update polling interval (4 hours)
  UPDATE_CHECK_INTERVAL: 4 * 60 * 60 * 1000,
  
  // State tracking
  state: {
    swRegistration: null,
    pendingUpdate: null,
    isOnline: navigator.onLine,
    isInstalled: false,
    isInstallPromptShown: false,
    deferredPrompt: null,
    lastUpdateCheck: 0,
    swController: null,
  },
  
  // Diagnostics
  diagnostics: {
    swSupported: 'serviceWorker' in navigator,
    pwaCapable: true,
    offlineCapable: false,
    syncSupported: 'SyncManager' in window,
    notificationSupported: 'Notification' in window,
    periodicSyncSupported: 'periodicSync' in ServiceWorkerRegistration.prototype,
  },
  
  // Performance metrics
  metrics: {
    cacheHits: 0,
    cacheMisses: 0,
    networkErrors: 0,
    swInstallTime: 0,
    swActivateTime: 0,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. SERVICE WORKER REGISTRATION & LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize PWA: register service worker and set up listeners
 */
async function initPWA() {
  try {
    if (!PWA.diagnostics.swSupported) {
      console.warn('[PWA] Service Workers not supported on this browser');
      return;
    }

    // Register service worker
    PWA.state.swRegistration = await navigator.serviceWorker.register(PWA.SW_PATH, {
      scope: '/',
      updateViaCache: 'none', // Always check for updates
    });

    console.log('[PWA] Service Worker registered:', PWA.state.swRegistration);
    PWA.diagnostics.offlineCapable = true;

    // Set up listeners for SW lifecycle
    setupServiceWorkerListeners();
    
    // Check for installed state
    checkInstalledState();
    
    // Start update polling
    startUpdatePolling();
    
    // Set up online/offline listeners
    setupNetworkListeners();
    
    // Request notification permission (non-blocking)
    if (PWA.diagnostics.notificationSupported && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

  } catch (error) {
    console.error('[PWA] Registration failed:', error);
    PWA.diagnostics.pwaCapable = false;
  }
}

/**
 * Set up listeners for Service Worker updates and controller changes
 */
function setupServiceWorkerListeners() {
  const reg = PWA.state.swRegistration;
  if (!reg) return;

  // Listen for updates
  reg.addEventListener('updatefound', onUpdateFound);

  // Listen for controller change (indicates update was applied)
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

  // Listen for messages from SW
  navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);

  // If SW already installed, check for updates immediately
  if (reg.active && !reg.waiting && !reg.installing) {
    checkForUpdates();
  }
}

/**
 * Called when updatefound fires (new SW downloading/installing)
 */
function onUpdateFound() {
  const reg = PWA.state.swRegistration;
  if (!reg) return;

  const newWorker = reg.installing;
  if (!newWorker) return;

  console.log('[PWA] New Service Worker detected (installing)');

  newWorker.addEventListener('statechange', () => {
    if (newWorker.state === 'installed') {
      // New SW installed but not yet activated
      // Check if there's a controller (i.e., not the first install)
      if (navigator.serviceWorker.controller) {
        console.log('[PWA] New Service Worker ready - update available');
        PWA.state.pendingUpdate = newWorker;
        showUpdateNotification();
      } else {
        console.log('[PWA] Service Worker installed (first install)');
      }
    } else if (newWorker.state === 'activated') {
      console.log('[PWA] New Service Worker activated');
      // If there's no pending update notification shown, it means update was silent
      if (PWA.state.pendingUpdate === newWorker) {
        PWA.state.pendingUpdate = null;
      }
    }
  });
}

/**
 * Called when a new Service Worker takes control
 */
function onControllerChange() {
  console.log('[PWA] Service Worker controller changed - reloading app');
  // Clear the pending update
  PWA.state.pendingUpdate = null;
  
  // Reload the page to use the new SW version
  window.location.reload();
}

/**
 * Handle messages from Service Worker
 */
function onServiceWorkerMessage(event) {
  const { type, data } = event.data;

  switch (type) {
    case 'cache_hit':
      PWA.metrics.cacheHits++;
      console.log('[PWA] Cache hit:', data.url);
      break;

    case 'cache_miss':
      PWA.metrics.cacheMisses++;
      console.log('[PWA] Cache miss:', data.url);
      break;

    case 'network_error':
      PWA.metrics.networkErrors++;
      console.warn('[PWA] Network error for:', data.url);
      break;

    case 'sync_registered':
      console.log('[PWA] Background sync registered:', data.tag);
      break;

    case 'push_notification':
      console.log('[PWA] Push notification received:', data);
      break;

    default:
      console.log('[PWA] Unknown message from SW:', type);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. UPDATE DETECTION & MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check for Service Worker updates
 */
async function checkForUpdates() {
  try {
    if (!PWA.state.swRegistration) return;

    const now = Date.now();
    if (now - PWA.state.lastUpdateCheck < 60000) {
      // Skip if checked recently (within 1 minute)
      return;
    }

    PWA.state.lastUpdateCheck = now;
    console.log('[PWA] Checking for updates...');

    // Trigger update check
    await PWA.state.swRegistration.update();

    console.log('[PWA] Update check complete');
  } catch (error) {
    console.error('[PWA] Update check failed:', error);
  }
}

/**
 * Start periodic update polling
 */
function startUpdatePolling() {
  // Check immediately
  checkForUpdates();

  // Then check periodically
  setInterval(checkForUpdates, PWA.UPDATE_CHECK_INTERVAL);

  // Also check when app becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkForUpdates();
    }
  });
}

/**
 * Show update notification to user
 */
function showUpdateNotification() {
  // Check if notification already shown
  if (sessionStorage.getItem('updateNotificationShown')) {
    return;
  }

  sessionStorage.setItem('updateNotificationShown', 'true');

  // Create notification UI
  const notification = document.createElement('div');
  notification.className = 'pwa-update-banner';
  notification.innerHTML = `
    <div class="pwa-update-content">
      <div class="pwa-update-icon">🔄</div>
      <div class="pwa-update-text">
        <div class="pwa-update-title">Update Available</div>
        <div class="pwa-update-message">A new version of Studyria is ready</div>
      </div>
      <div class="pwa-update-actions">
        <button class="pwa-update-btn pwa-update-dismiss" onclick="dismissUpdateNotification()">Later</button>
        <button class="pwa-update-btn pwa-update-install" onclick="installUpdate()">Update Now</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentElement('afterbegin', notification);

  // Auto-dismiss after 10 seconds if not interacted
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 10000);
}

/**
 * Dismiss update notification
 */
function dismissUpdateNotification() {
  const notification = document.querySelector('.pwa-update-banner');
  if (notification) {
    notification.remove();
  }
}

/**
 * Install pending update
 */
function installUpdate() {
  const newWorker = PWA.state.pendingUpdate;
  if (newWorker) {
    console.log('[PWA] Installing update...');
    dismissUpdateNotification();
    
    // Tell the new SW to skip waiting and take control immediately
    newWorker.postMessage({ type: 'SKIP_WAITING' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. INSTALL PROMPT & APP INSTALLATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if app is already installed
 */
function checkInstalledState() {
  // Check for installed state
  if (window.matchMedia('(display-mode: standalone)').matches) {
    PWA.state.isInstalled = true;
    document.documentElement.setAttribute('data-pwa-installed', 'true');
    console.log('[PWA] App is running in standalone mode');
    return;
  }

  // iOS PWA detection
  if (window.navigator.standalone === true) {
    PWA.state.isInstalled = true;
    document.documentElement.setAttribute('data-pwa-installed', 'true');
    console.log('[PWA] App is running as iOS PWA');
    return;
  }

  // Listen for changes in display mode
  const displayModeMediaQuery = window.matchMedia('(display-mode: standalone)');
  displayModeMediaQuery.addEventListener('change', () => {
    PWA.state.isInstalled = displayModeMediaQuery.matches;
    document.documentElement.setAttribute('data-pwa-installed', PWA.state.isInstalled ? 'true' : 'false');
  });
}

/**
 * Listen for install prompt
 */
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing
    e.preventDefault();

    // Store the prompt for later use
    PWA.state.deferredPrompt = e;
    console.log('[PWA] Install prompt ready');

    // Show custom install button if not already installed
    if (!PWA.state.isInstalled) {
      showInstallPrompt();
    }
  });

  // Handle app installed
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed successfully');
    PWA.state.isInstalled = true;
    document.documentElement.setAttribute('data-pwa-installed', 'true');
    dismissInstallPrompt();

    // Send analytics
    if (window.gtag) {
      window.gtag('event', 'app_installed', {
        app_name: PWA.NAME,
        version: PWA.VERSION,
      });
    }
  });
}

/**
 * Show custom install prompt
 */
function showInstallPrompt() {
  if (PWA.state.isInstallPromptShown || PWA.state.isInstalled) {
    return;
  }

  PWA.state.isInstallPromptShown = true;

  const prompt = document.createElement('div');
  prompt.className = 'pwa-install-banner';
  prompt.innerHTML = `
    <div class="pwa-install-content">
      <div class="pwa-install-icon">📚</div>
      <div class="pwa-install-text">
        <div class="pwa-install-title">Install Studyria</div>
        <div class="pwa-install-message">Get offline access to your PDFs</div>
      </div>
      <div class="pwa-install-actions">
        <button class="pwa-install-btn pwa-install-dismiss" onclick="dismissInstallPrompt()">Not Now</button>
        <button class="pwa-install-btn pwa-install-confirm" onclick="promptInstall()">Install</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentElement('afterbegin', prompt);

  // Auto-dismiss after 15 seconds if not interacted
  setTimeout(() => {
    if (prompt.parentNode) {
      dismissInstallPrompt();
    }
  }, 15000);
}

/**
 * Trigger installation
 */
async function promptInstall() {
  const prompt = PWA.state.deferredPrompt;
  if (!prompt) return;

  // Show the install prompt
  prompt.prompt();

  // Log the result
  const { outcome } = await prompt.userChoice;
  console.log(`[PWA] User response to install prompt: ${outcome}`);

  // Clear the deferred prompt
  PWA.state.deferredPrompt = null;
}

/**
 * Dismiss install prompt
 */
function dismissInstallPrompt() {
  const prompt = document.querySelector('.pwa-install-banner');
  if (prompt) {
    prompt.remove();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. OFFLINE & ONLINE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set up network status listeners
 */
function setupNetworkListeners() {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Initial check
  updateNetworkStatus();
}

/**
 * Handle coming online
 */
function onOnline() {
  PWA.state.isOnline = true;
  document.documentElement.setAttribute('data-online', 'true');
  console.log('[PWA] App is online');

  // Remove offline indicator
  dismissOfflineIndicator();

  // Trigger background sync if supported
  if (PWA.diagnostics.syncSupported && PWA.state.swRegistration) {
    PWA.state.swRegistration.sync.register('sync-data').catch(() => {});
  }

  // Dispatch custom event for app to handle
  window.dispatchEvent(new CustomEvent('pwa:online', { detail: { timestamp: Date.now() } }));
}

/**
 * Handle going offline
 */
function onOffline() {
  PWA.state.isOnline = false;
  document.documentElement.setAttribute('data-online', 'false');
  console.log('[PWA] App is offline');

  // Show offline indicator
  showOfflineIndicator();

  // Dispatch custom event for app to handle
  window.dispatchEvent(new CustomEvent('pwa:offline', { detail: { timestamp: Date.now() } }));
}

/**
 * Update network status
 */
function updateNetworkStatus() {
  if (navigator.onLine) {
    onOnline();
  } else {
    onOffline();
  }
}

/**
 * Show offline indicator
 */
function showOfflineIndicator() {
  // Check if indicator already exists
  if (document.getElementById('pwaOfflineIndicator')) {
    return;
  }

  const indicator = document.createElement('div');
  indicator.id = 'pwaOfflineIndicator';
  indicator.className = 'pwa-offline-indicator';
  indicator.innerHTML = `
    <div class="pwa-offline-icon">📡</div>
    <div class="pwa-offline-text">You're offline</div>
  `;

  document.body.insertAdjacentElement('afterbegin', indicator);
}

/**
 * Dismiss offline indicator
 */
function dismissOfflineIndicator() {
  const indicator = document.getElementById('pwaOfflineIndicator');
  if (indicator) {
    indicator.remove();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CACHE MANAGEMENT & VERSIONING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clean up old cache versions
 */
async function cleanupOldCaches() {
  try {
    const cacheNames = await caches.keys();
    const validCaches = [PWA.CACHE_VERSION, PWA.RUNTIME_CACHE, PWA.STATIC_CACHE];

    const deletePromises = cacheNames
      .filter((name) => !validCaches.includes(name) && name.includes('studyria'))
      .map((name) => {
        console.log('[PWA] Deleting old cache:', name);
        return caches.delete(name);
      });

    await Promise.all(deletePromises);
    console.log('[PWA] Cache cleanup complete');
  } catch (error) {
    console.error('[PWA] Cache cleanup failed:', error);
  }
}

/**
 * Clear all caches (emergency)
 */
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    const deletePromises = cacheNames
      .filter((name) => name.includes('studyria'))
      .map((name) => caches.delete(name));

    await Promise.all(deletePromises);
    console.log('[PWA] All caches cleared');
  } catch (error) {
    console.error('[PWA] Failed to clear caches:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. BACKGROUND SYNC SUPPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register background sync task
 */
async function registerBackgroundSync(tag = 'sync-data') {
  try {
    if (!PWA.diagnostics.syncSupported || !PWA.state.swRegistration) {
      console.warn('[PWA] Background Sync not supported');
      return false;
    }

    await PWA.state.swRegistration.sync.register(tag);
    console.log('[PWA] Background sync registered:', tag);
    return true;
  } catch (error) {
    console.error('[PWA] Failed to register background sync:', error);
    return false;
  }
}

/**
 * Get pending sync tags
 */
async function getPendingSyncTags() {
  try {
    if (!PWA.state.swRegistration) return [];
    return await PWA.state.swRegistration.sync.getTags();
  } catch (error) {
    console.error('[PWA] Failed to get sync tags:', error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to push notifications
 */
async function subscribeToPushNotifications(vapidPublicKey) {
  try {
    if (!PWA.diagnostics.notificationSupported || !PWA.state.swRegistration) {
      console.warn('[PWA] Push notifications not supported');
      return null;
    }

    if (Notification.permission !== 'granted') {
      console.log('[PWA] Notification permission not granted');
      return null;
    }

    const subscription = await PWA.state.swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    console.log('[PWA] Push notification subscription:', subscription);
    return subscription;
  } catch (error) {
    console.error('[PWA] Failed to subscribe to push notifications:', error);
    return null;
  }
}

/**
 * Get current push subscription
 */
async function getPushSubscription() {
  try {
    if (!PWA.state.swRegistration) return null;
    return await PWA.state.swRegistration.pushManager.getSubscription();
  } catch (error) {
    console.error('[PWA] Failed to get push subscription:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications
 */
async function unsubscribeFromPushNotifications() {
  try {
    const subscription = await getPushSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      console.log('[PWA] Unsubscribed from push notifications');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[PWA] Failed to unsubscribe from push notifications:', error);
    return false;
  }
}

/**
 * Convert VAPID public key to Uint8Array
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. PWA DIAGNOSTICS & REPORTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive PWA diagnostics
 */
function getPWADiagnostics() {
  return {
    pwa: {
      name: PWA.NAME,
      version: PWA.VERSION,
      initialized: PWA.state.swRegistration !== null,
    },
    capabilities: {
      serviceWorkers: PWA.diagnostics.swSupported,
      offline: PWA.diagnostics.offlineCapable,
      backgroundSync: PWA.diagnostics.syncSupported,
      notifications: PWA.diagnostics.notificationSupported,
      periodicSync: PWA.diagnostics.periodicSyncSupported,
    },
    state: {
      isOnline: PWA.state.isOnline,
      isInstalled: PWA.state.isInstalled,
      hasPendingUpdate: PWA.state.pendingUpdate !== null,
      notificationPermission: Notification.permission || 'N/A',
    },
    metrics: {
      ...PWA.metrics,
      hitRate: PWA.metrics.cacheHits + PWA.metrics.cacheMisses > 0
        ? ((PWA.metrics.cacheHits / (PWA.metrics.cacheHits + PWA.metrics.cacheMisses)) * 100).toFixed(2) + '%'
        : 'N/A',
    },
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency || 'N/A',
      deviceMemory: navigator.deviceMemory || 'N/A',
    },
  };
}

/**
 * Log PWA diagnostics to console
 */
function logPWADiagnostics() {
  const diagnostics = getPWADiagnostics();
  console.group('[PWA] Diagnostics Report');
  console.table(diagnostics);
  console.groupEnd();
}

/**
 * Export PWA diagnostics
 */
function exportPWADiagnostics() {
  const diagnostics = getPWADiagnostics();
  const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studyria-pwa-diagnostics-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. PERFORMANCE MONITORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get performance metrics
 */
function getPerformanceMetrics() {
  if (!window.performance || !window.performance.timing) {
    return null;
  }

  const timing = performance.timing;
  const navigation = performance.navigation;

  return {
    dns: timing.domainLookupEnd - timing.domainLookupStart,
    tcp: timing.connectEnd - timing.connectStart,
    ttfb: timing.responseStart - timing.requestStart,
    download: timing.responseEnd - timing.responseStart,
    domInteractive: timing.domInteractive - timing.fetchStart,
    domComplete: timing.domComplete - timing.fetchStart,
    loadComplete: timing.loadEventEnd - timing.fetchStart,
    type: navigation.type === 0 ? 'navigate' : navigation.type === 1 ? 'reload' : 'backForward',
  };
}

/**
 * Send performance metrics to analytics
 */
function reportPerformanceMetrics() {
  const metrics = getPerformanceMetrics();
  if (!metrics || !window.gtag) return;

  window.gtag('event', 'page_view_timing', {
    'dns_time': metrics.dns,
    'tcp_time': metrics.tcp,
    'ttfb': metrics.ttfb,
    'download_time': metrics.download,
    'dom_interactive': metrics.domInteractive,
    'dom_complete': metrics.domComplete,
    'load_complete': metrics.loadComplete,
  });

  console.log('[PWA] Performance metrics reported:', metrics);
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize PWA when DOM is ready
 */
function initializeOnDOMReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPWA);
  } else {
    initPWA();
  }
}

/**
 * Set up all PWA features when script loads
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initPWA();
    setupInstallPrompt();
    cleanupOldCaches();
    
    // Report performance metrics after page load
    window.addEventListener('load', () => {
      setTimeout(reportPerformanceMetrics, 0);
    });
  });
} else {
  // Script loaded after DOMContentLoaded
  initPWA();
  setupInstallPrompt();
  cleanupOldCaches();
  
  // Report performance metrics
  if (document.readyState === 'complete') {
    setTimeout(reportPerformanceMetrics, 0);
  } else {
    window.addEventListener('load', () => {
      setTimeout(reportPerformanceMetrics, 0);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// Export PWA utilities to window for external use
window.PWA = {
  // Version and config
  VERSION: PWA.VERSION,
  
  // State queries
  isOnline: () => PWA.state.isOnline,
  isInstalled: () => PWA.state.isInstalled,
  hasPendingUpdate: () => PWA.state.pendingUpdate !== null,
  
  // Update management
  checkForUpdates,
  installUpdate,
  
  // Cache management
  cleanupOldCaches,
  clearAllCaches,
  
  // Install prompts
  promptInstall,
  dismissInstallPrompt,
  
  // Background sync
  registerBackgroundSync,
  getPendingSyncTags,
  
  // Push notifications
  subscribeToPushNotifications,
  getPushSubscription,
  unsubscribeFromPushNotifications,
  
  // Diagnostics
  getDiagnostics: getPWADiagnostics,
  logDiagnostics: logPWADiagnostics,
  exportDiagnostics: exportPWADiagnostics,
  
  // Performance
  getPerformanceMetrics,
  reportPerformanceMetrics,
};

console.log('[PWA] App initialized - use window.PWA for utilities');
