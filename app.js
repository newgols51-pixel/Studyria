/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STUDYRIA PWA APPLICATION LAYER  v3.0  (Production-Ready)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles:
 *   - Service Worker registration & lifecycle
 *   - Install prompt (Android, Windows, Edge, Chrome) + iOS guidance
 *   - Update detection, "Update Now" + "Restart" flow
 *   - Offline / Online detection
 *   - Cache versioning & cleanup
 *   - Background Sync
 *   - Push Notification subscription
 *   - PWA diagnostics & performance monitoring
 *
 * USAGE: Include this file AFTER your main page scripts.
 *   <script src="app.js" defer></script>
 *
 * IMPORTANT: This file is a supplementary PWA layer. If your page already
 * has an inline App Center engine (pwaAppCenter), this file will detect
 * that and defer install/update UI to it, only adding missing functionality.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION & STATE
// ═══════════════════════════════════════════════════════════════════════════

const PWA_CONFIG = {
  NAME:              'Studyria',
  VERSION:           '3.0.0',
  SW_PATH:           '/sw.js',
  SW_SCOPE:          '/',
  OFFLINE_PAGE:      '/offline.html',

  // Must match CACHE_NAME in sw.js
  CACHE_NAME:        'studyria-v7',

  // How often to poll for SW updates (4 hours)
  UPDATE_INTERVAL_MS: 4 * 60 * 60 * 1000,
};

// Internal mutable state (not exposed directly)
const _state = {
  swRegistration:   null,
  waitingSW:        null,
  deferredPrompt:   null,   // beforeinstallprompt event
  isInstalled:      false,
  isOnline:         typeof navigator !== 'undefined' ? navigator.onLine : true,
  updateDismissed:  false,
  initialized:      false,
  updateCheckTimer: null,
};

// Capability flags (set once at init)
const _caps = {
  sw:           'serviceWorker' in navigator,
  sync:         false,     // set after SW registers
  notification: 'Notification' in window,
  periodicSync: false,     // set after SW registers
  pushManager:  false,     // set after SW registers
};

// Performance counters
const _metrics = {
  cacheHits:    0,
  cacheMisses:  0,
  netErrors:    0,
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. STANDALONE / INSTALLED DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * detectStandalone — returns true ONLY when the browser confirms the PWA is
 * actually running as an installed app (outside the normal browser tab UI).
 *
 * ✅  display-mode media queries   — Android, Chrome, Edge, Samsung Internet
 * ✅  navigator.standalone === true — iOS Safari Add-to-Home-Screen
 * ✅  android-app:// referrer      — Android TWA / WebAPK wrapper
 *
 * ❌  NEVER use URL parameters such as ?source=pwa.
 *     The manifest start_url may contain ?source=pwa, which is appended even
 *     when the page is opened in a normal browser tab — making it completely
 *     unreliable as an install signal.
 * ❌  NEVER use localStorage / sessionStorage / cookies / custom flags.
 */
function detectStandalone() {
  // CSS display-mode: standalone fires only when running as installed PWA
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // display-mode: fullscreen / minimal-ui also indicate PWA launch
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  // iOS Safari sets navigator.standalone = true on Add-to-Home-Screen launch
  if (window.navigator.standalone === true) return true;
  // Android TWA: referrer is set to the android-app:// origin by the wrapper
  if (document.referrer.startsWith('android-app://')) return true;
  return false;
}

function checkInstalledState() {
  _state.isInstalled = detectStandalone();
  document.documentElement.setAttribute(
    'data-pwa-installed',
    _state.isInstalled ? 'true' : 'false'
  );
  if (_state.isInstalled) {
    console.log('[PWA] Running in standalone / installed mode ✅');
  } else {
    console.log('[PWA] Running in browser tab — not yet installed');
  }

  // Watch all display-mode variants so we catch dynamic state changes
  // (e.g. user installs while page is open)
  ['standalone', 'fullscreen', 'minimal-ui'].forEach(function(mode) {
    var mq = window.matchMedia('(display-mode: ' + mode + ')');
    if (mq.addEventListener) {
      mq.addEventListener('change', function() {
        var nowInstalled = detectStandalone();
        if (nowInstalled !== _state.isInstalled) {
          _state.isInstalled = nowInstalled;
          document.documentElement.setAttribute(
            'data-pwa-installed',
            _state.isInstalled ? 'true' : 'false'
          );
          console.log('[PWA] Install state changed → isInstalled:', _state.isInstalled);
          window.dispatchEvent(new CustomEvent('pwa:installstatechange', {
            detail: { isInstalled: _state.isInstalled }
          }));
        }
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SERVICE WORKER REGISTRATION & LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

async function registerServiceWorker() {
  if (!_caps.sw) {
    console.warn('[PWA] Service Workers not supported');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register(PWA_CONFIG.SW_PATH, {
      scope:          PWA_CONFIG.SW_SCOPE,
      updateViaCache: 'none',   // always re-fetch sw.js from network
    });
    _state.swRegistration = reg;

    // Detect capability support after registration
    _caps.sync         = 'sync'         in reg;
    _caps.periodicSync = 'periodicSync' in reg;
    _caps.pushManager  = 'pushManager'  in reg;

    console.log('[PWA] Service Worker registered ✅', reg.scope);

    // If SW already active, get version info
    if (reg.active) {
      _querySwVersion(reg.active);
    }

    // If a new SW is already waiting (e.g. user reloaded after update downloaded)
    if (reg.waiting && navigator.serviceWorker.controller) {
      _state.waitingSW = reg.waiting;
      _onUpdateReady(reg.waiting);
    }

    // Watch for a new SW installing
    reg.addEventListener('updatefound', _onUpdateFound);

    // SW controller changed → new version is now active
    navigator.serviceWorker.addEventListener('controllerchange', _onControllerChange);

    // Messages from SW
    navigator.serviceWorker.addEventListener('message', _onSwMessage);

    // Start polling for updates
    _scheduleUpdateChecks();

  } catch (err) {
    console.error('[PWA] SW registration failed:', err);
  }
}

function _onUpdateFound() {
  const reg = _state.swRegistration;
  if (!reg) return;
  const installing = reg.installing;
  if (!installing) return;

  console.log('[PWA] New Service Worker installing…');

  installing.addEventListener('statechange', () => {
    if (installing.state === 'installed') {
      if (navigator.serviceWorker.controller) {
        // There was an existing SW — this is an update
        console.log('[PWA] New SW installed & waiting — update available');
        _state.waitingSW = installing;
        _onUpdateReady(installing);
      } else {
        // First install — no controller yet
        console.log('[PWA] Service Worker installed (first-time)');
      }
    }
  });
}

function _onControllerChange() {
  // A new SW has taken control. This fires after SKIP_WAITING.
  // We do NOT auto-reload here — the restart card asks the user first.
  console.log('[PWA] SW controller changed (update applied)');
  // The restart card is shown via showRestartCard(), called from applyUpdate()
}

function _onSwMessage(event) {
  const { type, data } = event.data || {};
  switch (type) {
    case 'cache_hit':      _metrics.cacheHits++;  break;
    case 'cache_miss':     _metrics.cacheMisses++; break;
    case 'network_error':  _metrics.netErrors++;   break;
    case 'sync_registered':
      console.log('[PWA] Background sync registered:', data?.tag);
      break;
    default:
      break;
  }
}

function _querySwVersion(sw) {
  try {
    const mc = new MessageChannel();
    mc.port1.onmessage = e => {
      const { version, build, whatsNew } = e.data || {};
      console.log('[PWA] SW version:', version || build);
      // Dispatch to page-level handlers if present
      window.dispatchEvent(new CustomEvent('pwa:swversion', {
        detail: { version: version || build, whatsNew }
      }));
    };
    sw.postMessage({ type: 'GET_VERSION' }, [mc.port2]);
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. UPDATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function _onUpdateReady(waitingSW) {
  // If the page's own App Center is present, let it handle UI
  if (window.pwaAppCenter) {
    // pwaAppCenter handles its own update UI — just ensure _waitingSW is set
    return;
  }
  showUpdateBanner(waitingSW);
}

/**
 * Fallback update banner (used if pwaAppCenter is NOT present in the page)
 */
function showUpdateBanner(waitingSW) {
  // Remove any existing banner first
  const existing = document.getElementById('_pwaUpdateBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = '_pwaUpdateBanner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
    'background:linear-gradient(135deg,#1a2540,#0d1830)',
    'border-bottom:1px solid rgba(61,142,248,0.3)',
    'padding:12px 16px', 'display:flex', 'align-items:center',
    'gap:12px', 'font-family:system-ui,sans-serif',
    'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
  ].join(';');

  banner.innerHTML = `
    <div style="flex:1;min-width:0">
      <div style="color:#e4e8f0;font-weight:600;font-size:.9rem">🚀 New Version Available</div>
      <div style="color:#7a8caa;font-size:.78rem;margin-top:2px">What's New: bug fixes, performance & Career Hub improvements.</div>
    </div>
    <button id="_pwaUpdateNow"
      style="padding:8px 16px;background:linear-gradient(135deg,#3d8ef8,#00c8e8);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap;flex-shrink:0">
      Update Now
    </button>
    <button id="_pwaUpdateLater"
      style="padding:8px 12px;background:rgba(255,255,255,0.07);color:#7a8caa;border:1px solid rgba(255,255,255,0.12);border-radius:8px;font-size:.8rem;cursor:pointer;flex-shrink:0">
      Later
    </button>
  `;

  document.body.insertAdjacentElement('afterbegin', banner);

  document.getElementById('_pwaUpdateNow').addEventListener('click', () => {
    applyUpdate();
  });

  document.getElementById('_pwaUpdateLater').addEventListener('click', () => {
    _state.updateDismissed = true;
    banner.remove();
  });
}

/**
 * Tell the waiting SW to skip waiting (activate immediately)
 * Then show the restart card / banner
 */
function applyUpdate() {
  const sw = _state.waitingSW || _state.swRegistration?.waiting;
  if (!sw) return;

  sw.postMessage({ type: 'SKIP_WAITING' });

  // Remove update banner if visible
  document.getElementById('_pwaUpdateBanner')?.remove();

  // If pwaAppCenter handles restart, let it; otherwise show our fallback
  if (!window.pwaAppCenter) {
    showRestartBanner();
  }
}

function showRestartBanner() {
  const existing = document.getElementById('_pwaRestartBanner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = '_pwaRestartBanner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
    'background:linear-gradient(135deg,#064e3b,#065f46)',
    'border-bottom:1px solid rgba(16,217,142,0.3)',
    'padding:12px 16px', 'display:flex', 'align-items:center',
    'gap:12px', 'font-family:system-ui,sans-serif',
    'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
  ].join(';');

  banner.innerHTML = `
    <div style="flex:1">
      <div style="color:#e4e8f0;font-weight:600;font-size:.9rem">✅ Restart App to Finish Update</div>
      <div style="color:#a7f3d0;font-size:.78rem;margin-top:2px">Update installed! Restart to use the new version.</div>
    </div>
    <button id="_pwaRestartNow"
      style="padding:8px 16px;background:linear-gradient(135deg,#10d98e,#06b6d4);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap;flex-shrink:0">
      Restart Now
    </button>
  `;

  document.body.insertAdjacentElement('afterbegin', banner);

  document.getElementById('_pwaRestartNow').addEventListener('click', () => {
    window.location.reload();
  });
}

async function checkForUpdates() {
  try {
    if (!_state.swRegistration) return;
    console.log('[PWA] Checking for updates…');
    await _state.swRegistration.update();
  } catch (e) {
    console.warn('[PWA] Update check failed:', e);
  }
}

function _scheduleUpdateChecks() {
  // Check on visibility change (user returns to tab)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdates();
  });

  // Periodic check
  if (_state.updateCheckTimer) clearInterval(_state.updateCheckTimer);
  _state.updateCheckTimer = setInterval(checkForUpdates, PWA_CONFIG.UPDATE_INTERVAL_MS);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. INSTALL PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function setupInstallPrompt() {
  // Capture beforeinstallprompt (Android, Chrome Desktop, Edge, Samsung)
  window.addEventListener('beforeinstallprompt', e => {
    // ✅ Always prevent the browser's automatic install banner / mini-infobar.
    e.preventDefault();
    _state.deferredPrompt = e;

    // ⛔ NEVER show the legacy navbar install button.
    //    The custom "Download / Install Studyria App" card in the Burger Menu
    //    is the only install entry point.  prompt() fires only on explicit click.

    // Dispatch event so other handlers (pwaAppCenter, etc.) can react
    window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { prompt: e } }));

    console.log('[PWA] Install prompt captured ✅ (burger-menu card is the sole CTA)');
  });

  // App successfully installed
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed ✅');
    _state.isInstalled = true;
    _state.deferredPrompt = null;
    document.documentElement.setAttribute('data-pwa-installed', 'true');

    // Legacy navbar install button — keep hidden (burger menu is the sole entry point)
    const legacyBtn = document.getElementById('pwaInstallBtn');
    if (legacyBtn) legacyBtn.style.display = 'none';

    // Remove fallback install banner if somehow present
    document.getElementById('_pwaInstallBanner')?.remove();

    // Mark burger-menu install card as installed
    _markBurgerInstalled();

    window.dispatchEvent(new CustomEvent('pwa:installed'));

    // Analytics
    if (window.gtag) {
      window.gtag('event', 'app_installed', { app_name: PWA_CONFIG.NAME });
    }
    if (typeof showToast === 'function') {
      showToast('✅ Studyria App installed!', 'success');
    }
  });
}

/**
 * Fallback install banner (used if pwaAppCenter is NOT in the page)
 */
function showInstallBanner() {
  if (document.getElementById('_pwaInstallBanner')) return;

  const banner = document.createElement('div');
  banner.id = '_pwaInstallBanner';
  banner.setAttribute('role', 'complementary');
  banner.style.cssText = [
    'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:99998', 'max-width:420px', 'width:calc(100% - 32px)',
    'background:linear-gradient(135deg,#0d1830,#121e38)',
    'border:1px solid rgba(61,142,248,0.25)',
    'border-radius:16px', 'padding:16px',
    'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
    'font-family:system-ui,sans-serif',
    'animation:_pwaSlideUp .35s ease-out',
  ].join(';');

  // Inline keyframe
  if (!document.getElementById('_pwaAnimStyles')) {
    const style = document.createElement('style');
    style.id = '_pwaAnimStyles';
    style.textContent = `
      @keyframes _pwaSlideUp {
        from { opacity:0; transform:translateX(-50%) translateY(24px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:2rem;flex-shrink:0">📚</div>
      <div style="flex:1">
        <div style="color:#e4e8f0;font-weight:700;font-size:.95rem">Download / Install Studyria App</div>
        <div style="color:#7a8caa;font-size:.78rem;margin-top:2px">Offline access to your PDFs. No browser needed.</div>
      </div>
      <button id="_pwaInstallClose"
        style="background:none;border:none;color:#7a8caa;font-size:1.2rem;cursor:pointer;padding:4px;line-height:1;flex-shrink:0"
        aria-label="Close">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button id="_pwaInstallConfirm"
        style="flex:1;padding:10px;background:linear-gradient(135deg,#3d8ef8,#00c8e8);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer">
        ⬇ Install
      </button>
      <button id="_pwaInstallLater"
        style="padding:10px 14px;background:rgba(255,255,255,0.06);color:#7a8caa;border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:.85rem;cursor:pointer">
        Later
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('_pwaInstallConfirm').addEventListener('click', promptInstall);
  document.getElementById('_pwaInstallLater').addEventListener('click', dismissInstallBanner);
  document.getElementById('_pwaInstallClose').addEventListener('click', dismissInstallBanner);

  // Auto-dismiss after 15s if untouched
  setTimeout(dismissInstallBanner, 15000);
}

function dismissInstallBanner() {
  document.getElementById('_pwaInstallBanner')?.remove();
}

async function promptInstall() {
  const prompt = _state.deferredPrompt;
  if (!prompt) {
    // iOS / unsupported — show instructions
    showiOSInstallTip();
    return;
  }

  try {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);
    _state.deferredPrompt = null;
    dismissInstallBanner();

    if (outcome === 'accepted') {
      // Mark burger-menu install button as "App Installed ✅"
      _markBurgerInstalled();
      if (typeof showToast === 'function') showToast('🚀 Studyria installed!', 'success');
    }
  } catch (e) {
    console.warn('[PWA] Install prompt error:', e);
  }
}

/**
 * Update the burger-menu install card to "App Installed ✅" state.
 * Called after outcome === 'accepted' or after the appinstalled event.
 * Works whether pwaAppCenter or the fallback path is active.
 */
function _markBurgerInstalled() {
  const installBtn = document.getElementById('pwaHmInstallBtn');
  if (installBtn) {
    installBtn.textContent = 'App Installed ✅';
    installBtn.disabled = true;
    installBtn.style.cssText += ';background:rgba(16,217,142,0.15);border-color:rgba(16,217,142,0.4);color:#10d98e;cursor:default;animation:none';
  }
  // If pwaAppCenter is present it will re-render on appinstalled; that's fine.
}

/**
 * iOS Add to Home Screen instructions (Safari does not support beforeinstallprompt)
 */
function showiOSInstallTip() {
  if (document.getElementById('_pwaIOSTip')) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (!isIOS) {
    // Non-iOS without prompt: generic help
    if (typeof showToast === 'function') {
      showToast('📱 Tap browser menu → "Add to Home Screen" to install', 'info');
    }
    return;
  }

  const tip = document.createElement('div');
  tip.id = '_pwaIOSTip';
  tip.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'z-index:99999', 'padding:20px 20px 32px',
    'background:linear-gradient(0deg,#0d1830,#121e38)',
    'border-top:1px solid rgba(61,142,248,0.25)',
    'font-family:system-ui,sans-serif',
    'text-align:center',
    'box-shadow:0 -8px 40px rgba(0,0,0,0.6)',
  ].join(';');

  tip.innerHTML = `
    <div style="font-size:1.5rem;margin-bottom:10px">📱</div>
    <div style="color:#e4e8f0;font-weight:700;font-size:1rem;margin-bottom:6px">Install Studyria on iPhone</div>
    <div style="color:#7a8caa;font-size:.85rem;line-height:1.6">
      Tap <strong style="color:#3d8ef8">Share</strong> <span style="font-size:1rem">⬆</span> at the bottom of Safari,
      then tap <strong style="color:#3d8ef8">"Add to Home Screen"</strong> 
      <span style="font-size:1rem">➕</span>
    </div>
    <button onclick="document.getElementById('_pwaIOSTip').remove()"
      style="margin-top:14px;padding:10px 24px;background:linear-gradient(135deg,#3d8ef8,#00c8e8);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">
      Got it
    </button>
    <div style="font-size:1.5rem;position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#3d8ef8">▼</div>
  `;

  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 20000);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. OFFLINE / ONLINE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function setupNetworkListeners() {
  window.addEventListener('online',  _onOnline);
  window.addEventListener('offline', _onOffline);
  // Apply initial state
  _state.isOnline ? _onOnline() : _onOffline();
}

function _onOnline() {
  _state.isOnline = true;
  document.documentElement.setAttribute('data-online', 'true');
  document.getElementById('_pwaOfflineBar')?.remove();

  // Trigger background sync
  if (_caps.sync && _state.swRegistration) {
    _state.swRegistration.sync.register('sync-data').catch(() => {});
  }

  window.dispatchEvent(new CustomEvent('pwa:online', { detail: { ts: Date.now() } }));
}

function _onOffline() {
  _state.isOnline = false;
  document.documentElement.setAttribute('data-online', 'false');

  if (!document.getElementById('_pwaOfflineBar')) {
    const bar = document.createElement('div');
    bar.id = '_pwaOfflineBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:linear-gradient(135deg,#7f1d1d,#991b1b)',
      'padding:10px 16px', 'display:flex', 'align-items:center', 'gap:8px',
      'font-family:system-ui,sans-serif',
      'font-size:.85rem', 'color:#fecaca',
      'box-shadow:0 2px 12px rgba(0,0,0,0.5)',
    ].join(';');
    bar.innerHTML = `
      <span style="width:8px;height:8px;background:#ef4444;border-radius:50%;flex-shrink:0;animation:_pwaPulse 2s ease-in-out infinite"></span>
      <span>📡 You're offline — some features may be unavailable</span>
    `;

    if (!document.getElementById('_pwaAnimStyles')) {
      const style = document.createElement('style');
      style.id = '_pwaAnimStyles';
      style.textContent = `
        @keyframes _pwaSlideUp {
          from { opacity:0; transform:translateX(-50%) translateY(24px); }
          to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
        @keyframes _pwaPulse {
          0%,100% { opacity:1; }
          50% { opacity:.4; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.insertAdjacentElement('afterbegin', bar);
  }

  window.dispatchEvent(new CustomEvent('pwa:offline', { detail: { ts: Date.now() } }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

async function cleanupOldCaches() {
  try {
    const keys    = await caches.keys();
    const toDelete = keys.filter(k => k.startsWith('studyria-') && k !== PWA_CONFIG.CACHE_NAME);
    await Promise.all(toDelete.map(k => caches.delete(k)));
    if (toDelete.length) console.log('[PWA] Old caches deleted:', toDelete);
  } catch (e) {
    console.warn('[PWA] Cache cleanup failed:', e);
  }
}

async function clearAllCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('studyria-')).map(k => caches.delete(k)));
    console.log('[PWA] All Studyria caches cleared');
  } catch (e) {
    console.warn('[PWA] clearAllCaches failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. BACKGROUND SYNC
// ═══════════════════════════════════════════════════════════════════════════

async function registerBackgroundSync(tag = 'sync-data') {
  try {
    if (!_caps.sync || !_state.swRegistration) {
      console.warn('[PWA] Background Sync not supported or SW not ready');
      return false;
    }
    await _state.swRegistration.sync.register(tag);
    console.log('[PWA] Background sync registered:', tag);
    return true;
  } catch (e) {
    console.warn('[PWA] registerBackgroundSync failed:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Request push notification permission.
 * MUST be called from a user gesture (e.g. button click).
 */
async function requestNotificationPermission() {
  if (!_caps.notification) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';

  const permission = await Notification.requestPermission();
  return permission;
}

async function subscribeToPushNotifications(vapidPublicKey) {
  try {
    if (!_caps.pushManager || !_state.swRegistration) {
      console.warn('[PWA] Push Manager not supported or SW not ready');
      return null;
    }
    if (Notification.permission !== 'granted') {
      console.warn('[PWA] Notification permission not granted');
      return null;
    }
    const sub = await _state.swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(vapidPublicKey),
    });
    console.log('[PWA] Push subscription created ✅');
    return sub;
  } catch (e) {
    console.warn('[PWA] Push subscribe failed:', e);
    return null;
  }
}

async function getPushSubscription() {
  try {
    if (!_state.swRegistration) return null;
    return await _state.swRegistration.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

async function unsubscribeFromPush() {
  try {
    const sub = await getPushSubscription();
    if (sub) { await sub.unsubscribe(); return true; }
    return false;
  } catch (e) {
    return false;
  }
}

function _urlBase64ToUint8Array(b64) {
  const pad  = '='.repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw  = atob(base);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

function getDiagnostics() {
  const reg = _state.swRegistration;
  return {
    pwa: {
      name:        PWA_CONFIG.NAME,
      version:     PWA_CONFIG.VERSION,
      cacheName:   PWA_CONFIG.CACHE_NAME,
      initialized: _state.initialized,
    },
    capabilities: {
      serviceWorkers: _caps.sw,
      backgroundSync: _caps.sync,
      notifications:  _caps.notification,
      periodicSync:   _caps.periodicSync,
      pushManager:    _caps.pushManager,
    },
    state: {
      isOnline:            _state.isOnline,
      isInstalled:         _state.isInstalled,
      hasPendingUpdate:    !!(_state.waitingSW || reg?.waiting),
      swState:             reg?.active?.state || 'none',
      notificationPerm:    _caps.notification ? Notification.permission : 'N/A',
    },
    metrics: {
      ..._metrics,
      hitRate: (_metrics.cacheHits + _metrics.cacheMisses) > 0
        ? ((_metrics.cacheHits / (_metrics.cacheHits + _metrics.cacheMisses)) * 100).toFixed(1) + '%'
        : 'N/A',
    },
    browser: {
      userAgent:           navigator.userAgent,
      language:            navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency || 'N/A',
      deviceMemory:        navigator.deviceMemory        || 'N/A',
      onLine:              navigator.onLine,
    },
  };
}

function getPerformanceMetrics() {
  // Use modern Navigation Timing API v2 where available
  const entries = performance.getEntriesByType?.('navigation');
  if (entries?.length) {
    const nav = entries[0];
    return {
      dns:            nav.domainLookupEnd - nav.domainLookupStart,
      tcp:            nav.connectEnd      - nav.connectStart,
      ttfb:           nav.responseStart   - nav.requestStart,
      download:       nav.responseEnd     - nav.responseStart,
      domInteractive: nav.domInteractive  - nav.fetchStart,
      domComplete:    nav.domComplete     - nav.fetchStart,
      loadComplete:   nav.loadEventEnd    - nav.fetchStart,
      type:           nav.type,
    };
  }
  // Fallback: legacy timing API
  const t = performance.timing;
  if (!t) return null;
  return {
    dns:            t.domainLookupEnd - t.domainLookupStart,
    tcp:            t.connectEnd      - t.connectStart,
    ttfb:           t.responseStart   - t.requestStart,
    download:       t.responseEnd     - t.responseStart,
    domInteractive: t.domInteractive  - t.fetchStart,
    domComplete:    t.domComplete     - t.fetchStart,
    loadComplete:   t.loadEventEnd    - t.fetchStart,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. MAIN INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function initPWA() {
  if (_state.initialized) return;
  _state.initialized = true;

  checkInstalledState();
  setupInstallPrompt();
  setupNetworkListeners();

  // Register SW after load to avoid delaying first paint
  if (document.readyState === 'complete') {
    await registerServiceWorker();
    cleanupOldCaches();
  } else {
    window.addEventListener('load', async () => {
      await registerServiceWorker();
      cleanupOldCaches();
    });
  }

  // Initialize OneSignal after SW is ready
  _initOneSignal();

  console.log('[PWA] Studyria PWA v' + PWA_CONFIG.VERSION + ' initialized ✅');
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA);
} else {
  initPWA();
}

// ═══════════════════════════════════════════════════════════════════════════
// 11b. ONESIGNAL INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OneSignal App ID for Studyria
 * @const {string}
 */
const ONESIGNAL_APP_ID = '12e09fd8-9362-49ef-87d9-14ba353db7a6';

/**
 * Internal OneSignal state
 */
const _osState = {
  initialized:  false,
  sdkReady:     false,
  subscribed:   false,
  userId:       null,
};

/**
 * Resolves once OneSignal.init() has fully completed and the live SDK
 * object is available. Anything that touches OneSignal (the button
 * handler, diagnostics, etc.) should `await _osReady` instead of
 * checking window.OneSignal directly — window.OneSignal can still be
 * the temporary OneSignalDeferred shim (typeof "function") until this
 * resolves, which is exactly what caused "Notifications not ready yet".
 * @type {Promise<object>} resolves with the live OneSignal SDK instance
 */
let _osReadyResolve;
const _osReady = new Promise(resolve => { _osReadyResolve = resolve; });

/**
 * _initOneSignal — configures OneSignal in manual-permission mode
 * (no automatic prompt), registers it against Studyria's EXISTING
 * service worker (sw.js, which importScripts() the OneSignal SW bundle
 * — see sw.js header comment), then checks existing subscription state
 * to render the burger-menu button correctly.
 *
 * The OneSignal SDK script is loaded in <head> of index.html.
 * This function only needs to push the init callback onto the
 * already-existing window.OneSignalDeferred queue.
 *
 * Called once from initPWA() after the page has loaded.
 */
function _initOneSignal() {
  // Only run once
  if (_osState.initialized) return;
  _osState.initialized = true;

  // OneSignal v16 uses a promise-queue pattern. The SDK script in <head>
  // creates window.OneSignalDeferred; we just push our init callback.
  // (Guard in case the queue was somehow not created yet.)
  window.OneSignalDeferred = window.OneSignalDeferred || [];

  // Queue initialisation — runs when SDK script has loaded
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.init({
        appId:                        ONESIGNAL_APP_ID,

        // ── Combined service worker ─────────────────────────────────
        // Studyria already registers sw.js at the root scope for
        // offline caching / PWA support. OneSignal MUST point at the
        // same sw.js (which importScripts() the OneSignal SW bundle at
        // the top of that file) so both systems share the one
        // registration. Only one SW can own a given scope — two
        // competing registrations conflict silently. This is OneSignal's
        // officially documented "combine with an existing service
        // worker" setup.
        serviceWorkerPath:            'sw.js',
        serviceWorkerParam:           { scope: '/' },

        // IMPORTANT: autoResubscribe keeps existing subscribers seamlessly
        // re-subscribed on subsequent visits, but never shows a browser
        // permission prompt automatically to new visitors.
        autoResubscribe:              true,
        // Do NOT request permission automatically on page load.
        notifyButton:                 { enable: false },
        // Disable the OneSignal bell widget — we use our own burger button.
        promptOptions: {
          autoPrompt: false,
        },
      });

      _osState.sdkReady = true;
      window.OneSignal = OneSignal; // live SDK object, not the shim
      _osReadyResolve(OneSignal);
      console.log('[OneSignal] SDK ready ✅ — version:', OneSignal.Debug?.getRumVersion?.() || 'n/a');

      // Check whether this browser is already subscribed
      await _osCheckSubscriptionState(OneSignal);

    } catch (err) {
      console.warn('[OneSignal] Init error:', err);
    }
  });
}

/**
 * _osCheckSubscriptionState — reads the current OneSignal push-subscription
 * status and updates the burger-menu notification button to reflect it.
 * @param {object} OneSignal - the live OneSignal SDK instance
 */
async function _osCheckSubscriptionState(OneSignal) {
  try {
    // FIX: optedIn and .id are SYNCHRONOUS properties in OneSignal v16,
    // not promises. `await` on a non-promise value is harmless on its
    // own, but it signalled this integration was written against the
    // wrong API shape — kept as plain reads here, matching OneSignal's
    // documented usage (`var optedIn = OneSignal.User.PushSubscription.optedIn;`).
    const isPushEnabled = OneSignal.User.PushSubscription.optedIn;
    _osState.subscribed = !!isPushEnabled;

    if (_osState.subscribed) {
      _osState.userId = OneSignal.User.PushSubscription.id;
      _osSaveSubscriptionState();
      console.log('[OneSignal] Already subscribed ✅, id:', _osState.userId);
    }

    // Render the burger button in the correct initial state
    _osRenderBurgerButton();

    // Keep button in sync if the user changes permission in browser settings
    OneSignal.User.PushSubscription.addEventListener('change', function(event) {
      _osState.subscribed = !!event.current.optedIn;
      _osState.userId = event.current.id || null;
      _osSaveSubscriptionState();
      _osRenderBurgerButton();
    });

  } catch (err) {
    console.warn('[OneSignal] Subscription state check failed:', err);
    _osRenderBurgerButton(); // render default state
  }
}

/**
 * _osSaveSubscriptionState — persists the subscribed flag + OneSignal
 * subscription id locally so the burger button (and any other UI) can
 * render the correct state instantly on next page load, before OneSignal
 * has finished re-initialising. This is a read-through cache only —
 * OneSignal.User.PushSubscription remains the source of truth and
 * always overwrites this on init.
 */
function _osSaveSubscriptionState() {
  try {
    localStorage.setItem('studyria_onesignal_state', JSON.stringify({
      subscribed: _osState.subscribed,
      userId:     _osState.userId,
      savedAt:    Date.now(),
    }));
  } catch (e) { /* localStorage unavailable — non-critical */ }
}

/**
 * _osRenderBurgerButton — updates the #osNotifBtn element (injected into the
 * burger menu by _osInjectBurgerButton) to show the correct state:
 *   • Notifications Enabled ✅  (already subscribed)
 *   • Enable Notifications 🔔   (not yet subscribed)
 *   • Try Again 🔔              (permission previously denied)
 */
function _osRenderBurgerButton() {
  const btn = document.getElementById('osNotifBtn');
  if (!btn) return;

  const perm = 'Notification' in window ? Notification.permission : 'default';

  if (_osState.subscribed) {
    btn.textContent = 'Notifications Enabled ✅';
    btn.disabled = true;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(16,217,142,0.12);border-color:rgba(16,217,142,0.35);color:#10d98e;cursor:default;';
  } else if (perm === 'denied') {
    btn.textContent = 'Try Again 🔔';
    btn.disabled = false;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(255,77,109,0.1);border-color:rgba(255,77,109,0.3);color:#ff6b85;cursor:pointer;';
  } else {
    btn.textContent = 'Enable Notifications 🔔';
    btn.disabled = false;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.1);border-color:rgba(61,142,248,0.3);color:#60a5fa;cursor:pointer;';
  }
}

/** Shared button base styles */
function _osBtnBaseStyle() {
  return [
    'width:100%',
    'padding:10px 14px',
    'border-radius:10px',
    'border:1px solid',
    'font-family:var(--font-body,system-ui,sans-serif)',
    'font-size:.82rem',
    'font-weight:700',
    'text-align:left',
    'transition:all .2s',
    'display:flex',
    'align-items:center',
    'gap:8px',
  ].join(';') + ';';
}

/**
 * osRequestNotification — the click handler wired to the burger-menu button.
 * Requests browser notification permission, then subscribes to OneSignal.
 * Called by the button's onclick handler (injected into the DOM below).
 *
 * MUST be called from a user gesture (button click) so the browser allows the
 * Notification.requestPermission() call without throwing a SecurityError.
 */
window.osRequestNotification = async function() {
  const btn = document.getElementById('osNotifBtn');

  // Guard: already subscribed
  if (_osState.subscribed) return;

  // Show loading state immediately — covers the (usually instant) wait
  // for OneSignal to finish initialising if the click happens very early.
  if (btn) {
    btn.textContent = _osState.sdkReady ? 'Enabling…' : 'Preparing…';
    btn.disabled = true;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.08);border-color:rgba(61,142,248,0.2);color:#7a8caa;cursor:wait;';
  }

  // FIX: wait on the real readiness promise instead of bailing out with
  // "not ready yet". _osReady resolves the moment OneSignal.init()
  // finishes (almost always well under a second after page load), so the
  // button now completes the flow instead of dead-ending.
  let OneSignal;
  try {
    OneSignal = await _osReady;
  } catch (e) {
    OneSignal = null;
  }

  if (!OneSignal || !_osState.sdkReady) {
    if (typeof showToast === 'function') {
      showToast('Notifications could not start — please reload and try again.', 'error');
    }
    _osRenderBurgerButton();
    return;
  }

  try {
    // OneSignal v16: requestPermission() shows the native browser prompt.
    // It resolves true/false based on the browser's permission decision —
    // it does NOT by itself guarantee PushSubscription.optedIn flips to
    // true (that requires an explicit optIn() call, see below).
    await OneSignal.Notifications.requestPermission();

    // OneSignal.Notifications.permission is a SYNCHRONOUS boolean in v16
    // (not a method, not a promise) — read it directly.
    const granted = OneSignal.Notifications.permission === true;

    if (granted) {
      // Permission granted — immediately update the button so the user
      // gets instant feedback before the optIn() backend round-trip.
      if (btn) {
        btn.textContent = 'Notifications Enabled ✅';
        btn.disabled = true;
        btn.style.cssText = _osBtnBaseStyle() +
          'background:rgba(16,217,142,0.12);border-color:rgba(16,217,142,0.35);color:#10d98e;cursor:default;';
      }

      // Explicitly opt in. requestPermission() only asks the browser;
      // optIn() is what tells OneSignal to actually create/activate the
      // push subscription. This is the missing step that left
      // PushSubscription.optedIn stuck at false even after the browser
      // prompt was accepted.
      await OneSignal.User.PushSubscription.optIn();

      // optedIn updates synchronously, but the SDK's internal sync to
      // OneSignal's backend is async — poll briefly rather than guessing
      // a fixed delay, so slow networks aren't cut off too early.
      let isPushEnabled = OneSignal.User.PushSubscription.optedIn;
      for (let i = 0; i < 10 && !isPushEnabled; i++) {
        await new Promise(r => setTimeout(r, 300));
        isPushEnabled = OneSignal.User.PushSubscription.optedIn;
      }

      _osState.subscribed = !!isPushEnabled;
      _osState.userId = OneSignal.User.PushSubscription.id || null;
      _osSaveSubscriptionState();

      if (_osState.subscribed) {
        console.log('[OneSignal] Subscribed ✅, id:', _osState.userId);
        if (typeof showToast === 'function') {
          showToast('🔔 Notifications enabled! You\'ll get the latest updates from Studyria.', 'success');
        }
      } else {
        // Permission granted but the subscription itself never opted in
        // (rare — e.g. push service unreachable). Treat as a retryable
        // failure, not a denial.
        console.warn('[OneSignal] Permission granted but subscription did not opt in.');
        if (typeof showToast === 'function') {
          showToast('Could not finish enabling notifications — please try again.', 'error');
        }
      }
    } else {
      // Browser permission was denied or dismissed.
      console.warn('[OneSignal] Permission denied by user.');
      if (typeof showToast === 'function') {
        showToast('Notifications blocked. To enable, update your browser site settings.', 'info');
      }
    }

  } catch (err) {
    console.warn('[OneSignal] requestPermission error:', err);
    if (typeof showToast === 'function') {
      showToast('Could not enable notifications — please try again.', 'error');
    }
  } finally {
    _osRenderBurgerButton();
  }
};

/**
 * _osInjectBurgerButton — inserts the OneSignal notification button into the
 * burger menu, directly after the PWA App Center block and before
 * #dynamicMenuItems. Safe to call multiple times (idempotent).
 */
function _osInjectBurgerButton() {
  if (document.getElementById('osNotifSection')) return; // already injected

  // Find the anchor — the divider just before #dynamicMenuItems
  const dynamicMenu = document.getElementById('dynamicMenuItems');
  if (!dynamicMenu) return;

  const section = document.createElement('div');
  section.id = 'osNotifSection';
  section.style.cssText = 'padding:4px 12px 8px;';
  section.innerHTML = `
    <div style="font-size:.65rem;font-weight:700;letter-spacing:.08em;color:rgba(100,140,220,0.5);text-transform:uppercase;padding:6px 2px 4px;">
      🔔 NOTIFICATIONS
    </div>
    <button id="osNotifBtn" onclick="osRequestNotification()"
      style="${_osBtnBaseStyle()}background:rgba(61,142,248,0.1);border-color:rgba(61,142,248,0.3);color:#60a5fa;cursor:pointer;">
      Enable Notifications 🔔
    </button>
  `;

  // Insert before #dynamicMenuItems
  dynamicMenu.parentNode.insertBefore(section, dynamicMenu);

  // Immediately reflect correct state if SDK already resolved
  _osRenderBurgerButton();
}

// Inject the button as soon as the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _osInjectBurgerButton);
} else {
  _osInjectBurgerButton();
}
// Also try after a short delay in case Alpine.js rewrites the menu
setTimeout(_osInjectBurgerButton, 1200);

// ═══════════════════════════════════════════════════════════════════════════
// 12. PUBLIC API  (window.PWA)
// ═══════════════════════════════════════════════════════════════════════════

window.PWA = {
  VERSION: PWA_CONFIG.VERSION,

  // State queries
  isOnline:        () => _state.isOnline,
  isInstalled:     () => _state.isInstalled,
  hasPendingUpdate:() => !!(_state.waitingSW || _state.swRegistration?.waiting),

  // Update management
  checkForUpdates,
  applyUpdate,
  showRestartBanner,

  // Install
  promptInstall,
  markBurgerInstalled: _markBurgerInstalled,
  showiOSInstallTip,
  dismissInstallBanner,

  // Cache
  cleanupOldCaches,
  clearAllCaches,

  // Sync
  registerBackgroundSync,

  // Notifications (native Web Push — used as fallback / diagnostics)
  requestNotificationPermission,
  subscribeToPushNotifications,
  getPushSubscription,
  unsubscribeFromPush,

  // OneSignal
  oneSignal: {
    isSubscribed: () => _osState.subscribed,
    isReady:      () => _osState.sdkReady,
    whenReady:    () => _osReady,
    getUserId:    () => _osState.userId,
    requestPermission: () => window.osRequestNotification(),
  },

  // Diagnostics
  getDiagnostics,
  getPerformanceMetrics,
  logDiagnostics: () => {
    const d = getDiagnostics();
    console.group('[PWA] Diagnostics');
    console.table(d.state);
    console.table(d.capabilities);
    console.table(d.metrics);
    console.groupEnd();
    return d;
  },
};

console.log('[PWA] window.PWA ready — use window.PWA.logDiagnostics() to inspect');
