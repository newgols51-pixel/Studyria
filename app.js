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
  VERSION:           '3.1.0',
  SW_PATH:           '/sw.js',
  SW_SCOPE:          '/',
  OFFLINE_PAGE:      '/offline.html',

  // Must match CACHE_NAME in sw.js
  CACHE_NAME:        'studyria-v13',

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

  // pwaAppCenter registers sw.js on the 'load' event — if it has already done
  // so, reuse the existing registration instead of creating a second one.
  // Double-registration to the same scope is allowed by spec and won't break
  // anything, but it triggers an extra network fetch of sw.js and can cause a
  // transient race between two installations running concurrently.
  try {
    // Prefer an existing registration over a fresh one.
    const existing = await navigator.serviceWorker.getRegistration(PWA_CONFIG.SW_SCOPE);
    if (existing) {
      _state.swRegistration = existing;
      _caps.sync         = 'sync'         in existing;
      _caps.periodicSync = 'periodicSync' in existing;
      _caps.pushManager  = 'pushManager'  in existing;
      console.log('[PWA] Service Worker already registered — reusing ✅', existing.scope);

      if (existing.active) _querySwVersion(existing.active);
      if (existing.waiting && navigator.serviceWorker.controller) {
        _state.waitingSW = existing.waiting;
        _onUpdateReady(existing.waiting);
      }
      existing.addEventListener('updatefound', _onUpdateFound);
      navigator.serviceWorker.addEventListener('controllerchange', _onControllerChange);
      navigator.serviceWorker.addEventListener('message', _onSwMessage);
      _scheduleUpdateChecks();
      return;
    }
  } catch (_) { /* fall through to fresh registration */ }

  try {
    const reg = await navigator.serviceWorker.register(PWA_CONFIG.SW_PATH, {
      scope:          PWA_CONFIG.SW_SCOPE,
      updateViaCache: 'none',
    });
    _state.swRegistration = reg;

    _caps.sync         = 'sync'         in reg;
    _caps.periodicSync = 'periodicSync' in reg;
    _caps.pushManager  = 'pushManager'  in reg;

    console.log('[PWA] Service Worker registered ✅', reg.scope);

    if (reg.active) {
      _querySwVersion(reg.active);
    }

    if (reg.waiting && navigator.serviceWorker.controller) {
      _state.waitingSW = reg.waiting;
      _onUpdateReady(reg.waiting);
    }

    reg.addEventListener('updatefound', _onUpdateFound);
    navigator.serviceWorker.addEventListener('controllerchange', _onControllerChange);
    navigator.serviceWorker.addEventListener('message', _onSwMessage);
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

  // Periodic check (4 hours)
  if (_state.updateCheckTimer) clearInterval(_state.updateCheckTimer);
  _state.updateCheckTimer = setInterval(checkForUpdates, PWA_CONFIG.UPDATE_INTERVAL_MS);

  // Also check once after 30 seconds (catches updates that land shortly after load)
  setTimeout(checkForUpdates, 30000);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. INSTALL PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function setupInstallPrompt() {
  // ── Global guard: only one beforeinstallprompt + appinstalled listener ever ──
  // This flag is checked before every call so that inline scripts, pwaAppCenter,
  // main.js, or any other file that also calls setupInstallPrompt() cannot
  // register a second pair of listeners.
  if (window.__pwaInstallListenersRegistered) return;
  window.__pwaInstallListenersRegistered = true;

  // Remove any duplicate beforeinstallprompt handlers that may have been
  // attached by old inline code or main.js before app.js loaded.
  // We achieve this by moving to a named handler that can be referenced.

  function _onBeforeInstallPrompt(e) {
    e.preventDefault();
    _state.deferredPrompt    = e;
    window._pwaInstallPrompt = e;
    console.log('[PWA] beforeinstallprompt captured ✅ — prompt ready');

    // Show burger install button if not already installed
    _updateInstallButtonVisibility();

    window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { prompt: e } }));
  }

  function _onAppInstalled() {
    console.log('[PWA] App installed ✅');
    _state.isInstalled       = true;
    _state.deferredPrompt    = null;
    window._pwaInstallPrompt = null;
    window._pwaInstallToastShown = true;
    document.documentElement.setAttribute('data-pwa-installed', 'true');

    // Hide / mark every known install button
    _markBurgerInstalled();
    ['pwaInstallBtn', 'pwaHmInstallBtn', 'installAppBtn'].forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) btn.style.display = 'none';
    });

    document.getElementById('_pwaInstallBanner')?.remove();
    window.dispatchEvent(new CustomEvent('pwa:installed'));

    if (window.gtag) {
      window.gtag('event', 'app_installed', { app_name: PWA_CONFIG.NAME });
    }

    if (typeof showToast === 'function') {
      showToast('✅ Studyria App installed!', 'success');
    }
  }

  window.addEventListener('beforeinstallprompt', _onBeforeInstallPrompt);
  window.addEventListener('appinstalled', _onAppInstalled);

  // Bind the burger-menu install button exactly once
  _bindInstallButton();
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

/**
 * _isAlreadyInstalled — true when the PWA is running in standalone mode
 * OR was recorded as installed during this session.
 */
function _isAlreadyInstalled() {
  return (
    _state.isInstalled ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

/**
 * _updateInstallButtonVisibility — hide button if installed, show if installable.
 * Safe to call multiple times.
 */
function _updateInstallButtonVisibility() {
  var btn = document.getElementById('pwaHmInstallBtn');
  if (!btn) return;

  if (_isAlreadyInstalled()) {
    btn.style.display = 'none';
    return;
  }

  // Show only when a native prompt is available
  if (_state.deferredPrompt || window._pwaInstallPrompt) {
    btn.style.display = '';
    btn.disabled      = false;
  }
}

/**
 * _bindInstallButton — attaches ONE click listener to the burger Install button.
 * Uses a guard flag so calling this multiple times is safe.
 */
function _bindInstallButton() {
  if (window.__pwaInstallBtnBound) return;

  // Button may not exist yet — wait for DOM
  function _attach() {
    var btn = document.getElementById('pwaHmInstallBtn');
    if (!btn) return false;

    if (window.__pwaInstallBtnBound) return true; // another call got here first
    window.__pwaInstallBtnBound = true;

    // If already installed, hide immediately and do nothing else
    if (_isAlreadyInstalled()) {
      btn.style.display = 'none';
      return true;
    }

    btn.addEventListener('click', function() {
      promptInstall();
    });

    return true;
  }

  if (!_attach()) {
    // DOM not ready yet — retry once after DOMContentLoaded
    document.addEventListener('DOMContentLoaded', _attach);
    // And again after a short delay for dynamically rendered menus
    setTimeout(_attach, 800);
    setTimeout(_attach, 2000);
  }
}

async function promptInstall() {
  // Never prompt if already installed
  if (_isAlreadyInstalled()) {
    _markBurgerInstalled();
    return;
  }

  var prompt = window._pwaInstallPrompt || _state.deferredPrompt;

  if (!prompt) {
    // Silently disable button — do not show repeated messages
    var btn = document.getElementById('pwaHmInstallBtn');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor  = 'not-allowed';
    }
    showiOSInstallTip();
    return;
  }

  try {
    prompt.prompt();
    var result = await prompt.userChoice;
    console.log('[PWA] Install prompt outcome:', result.outcome);

    // Clear prompt so it can never be re-used
    _state.deferredPrompt    = null;
    window._pwaInstallPrompt = null;

    dismissInstallBanner();

    if (result.outcome === 'accepted') {
      window._pwaInstallToastShown = true;
      _markBurgerInstalled();
      if (typeof showToast === 'function') showToast('🚀 Studyria installed!', 'success');
    }
  } catch (e) {
    console.warn('[PWA] Install prompt error:', e);
  }
}

/**
 * _markBurgerInstalled — hides the install button permanently after install.
 * Safe to call multiple times (idempotent).
 */
function _markBurgerInstalled() {
  // Hide all known install buttons
  ['pwaHmInstallBtn', 'pwaInstallBtn', 'installAppBtn'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.style.display = 'none';
    btn.disabled = true;
  });
  _state.isInstalled = true;
  document.documentElement.setAttribute('data-pwa-installed', 'true');
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

  // Re-load PDFs from Supabase so offline → online transition shows fresh data
  setTimeout(function() {
    if (typeof window.renderLibGrid === 'function') window.renderLibGrid();
    if (typeof window.loadActivityBarStats === 'function') window.loadActivityBarStats();
    if (typeof window.loadSupabaseHomeStats === 'function') window.loadSupabaseHomeStats();
  }, 1200);

  if (typeof showToast === 'function') {
    showToast('📶 You\'re back online!', 'success');
  }

  window.dispatchEvent(new CustomEvent('pwa:online', { detail: { ts: Date.now() } }));
}

function _onOffline() {
  _state.isOnline = false;
  document.documentElement.setAttribute('data-online', 'false');

  if (!document.getElementById('_pwaOfflineBar')) {
    const cachedCount = (window.PDFS || []).length;
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
      <span style="flex:1">📡 You're offline${cachedCount > 0 ? ` — ${cachedCount} PDFs cached` : ' — some features may be unavailable'}</span>
      <button onclick="window.location.reload()" style="padding:4px 10px;background:rgba(255,255,255,0.12);color:#fecaca;border:1px solid rgba(255,255,255,0.2);border-radius:6px;font-size:.75rem;cursor:pointer;flex-shrink:0">Retry</button>
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
    data: {
      pdfsLoaded:    (window.PDFS || []).length,
      supabaseReady: !!window.supabaseClient,
      currentPage:   window.currentPage || '—',
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
  setupInstallPrompt();      // registers beforeinstallprompt + appinstalled once
  setupNetworkListeners();

  // If already installed on load, hide the install button immediately
  if (_isAlreadyInstalled()) {
    _markBurgerInstalled();
  }

  // Also run after DOM is ready in case button isn't rendered yet
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      if (_isAlreadyInstalled()) _markBurgerInstalled();
      else _updateInstallButtonVisibility();
    });
  }

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
//
// ── ROOT CAUSE OF "requestPermission stays pending forever" (Chrome Android) ──
//
// Notification.requestPermission() (and by extension OneSignal's wrapper)
// MUST be called in the DIRECT synchronous call stack of a user gesture.
// Chrome Android PWA has a strict user-activation timeout: any `await`
// before requestPermission() consumes that activation window.
//
// Old broken flow:
//   click → await withTimeout → await _osReady (SDK init, can be slow)
//         → await _osVerifyServiceWorkerActive → requestPermission()
//
// By the time requestPermission() was reached, the user gesture was stale.
// Chrome silently held the pending promise forever without showing the
// dialog. Result: Notification.permission stayed "default", userId/token
// were never generated, button stayed on "Preparing…" / "Enabling…".
//
// ── THE FIX ───────────────────────────────────────────────────────────────
// 1. Call Notification.requestPermission() SYNCHRONOUSLY on click — before
//    ANY await — using the native browser API directly. This guarantees
//    the call is within the user-gesture window on Chrome Android PWA.
// 2. Store the returned Promise immediately, then await it.
// 3. Only AFTER permission resolves (granted/denied) do we then await the
//    OneSignal SDK and call optIn(). By then permission is already settled
//    so optIn() never needs to show a prompt and gesture timing is moot.
// 4. No "Preparing…" — button shows "Requesting…" only after user clicks
//    and transitions to "Enabling…" only after permission is granted.
// 5. No polling loop — use OneSignal PushSubscription 'change' event.
// 6. No withTimeout wrapper around the whole flow; individual async steps
//    have their own timeouts only where a network round-trip is involved.
//
// ── Files unchanged (already correct) ────────────────────────────────────
//   sw.js                        — importScripts OneSignal SW bundle ✅
//   OneSignalSDKWorker.js        — self-unregisters legacy scope conflict ✅
//   OneSignalSDKUpdaterWorker.js — self-unregisters legacy scope conflict ✅
//   index.html                   — loads OneSignalSDK.page.js with defer ✅
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
 * object is available. Callers should await this before touching OneSignal
 * APIs. Rejected if init fails so callers can fail fast instead of hanging.
 * @type {Promise<object>}
 */
let _osReadyResolve;
let _osReadyReject;
const _osReady = new Promise((resolve, reject) => {
  _osReadyResolve = resolve;
  _osReadyReject  = reject;
});

/**
 * _initOneSignal — queues OneSignal.init() on the SDK's deferred queue.
 * Called once from initPWA(). Uses autoPrompt:false so we never show the
 * permission dialog automatically — only on explicit user click.
 */
function _initOneSignal() {
  if (_osState.initialized) return;
  _osState.initialized = true;

  console.log('[OneSignal] Init — queuing…');

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.init({
        appId:             ONESIGNAL_APP_ID,
        // Combined service worker — sw.js importScripts the OneSignal SW
        // bundle at its top. Must match the scope registered by initPWA().
        serviceWorkerPath: 'sw.js',
        serviceWorkerParam:{ scope: '/' },
        // Re-subscribe returning users silently — no prompt on page load.
        autoResubscribe:   true,
        // Disable the OneSignal bell — we use our own burger-menu button.
        notifyButton:      { enable: false },
        promptOptions:     { autoPrompt: false },
      });

      _osState.sdkReady  = true;
      window.OneSignal   = OneSignal; // expose live SDK (replaces shim)
      _osReadyResolve(OneSignal);
      console.log('[OneSignal] Init — SDK ready ✅');

      await _osCheckSubscriptionState(OneSignal);

      // Show notification prompt only after user interaction OR 30 seconds —
      // never immediately on page load. Only triggered when permission is
      // still "default" (not yet asked).
      if (!_osState.subscribed && 'Notification' in window && Notification.permission === 'default') {
        _osScheduleAutoPrompt();
      }

    } catch (err) {
      console.error('[OneSignal] Init — FAILED:', err);
      _osReadyReject(err); // unblocks any awaiting click handler
    }
  });
}

/**
 * _osScheduleAutoPrompt — shows the burger notification button highlight
 * after a real user interaction (scroll / click / keydown) OR after 30
 * seconds, whichever comes first.  We never call requestPermission()
 * automatically — only the button click does that.  This function merely
 * scrolls the burger menu open or shows a subtle toast hint so the user
 * knows notifications are available.
 *
 * Called once from _initOneSignal() when permission is still "default".
 */
function _osScheduleAutoPrompt() {
  if (window.__osAutoPromptScheduled) return;
  window.__osAutoPromptScheduled = true;

  let _fired = false;

  function _showHint() {
    if (_fired) return;
    _fired = true;
    // Clean up interaction listeners
    ['click', 'scroll', 'keydown', 'touchstart'].forEach(function(ev) {
      document.removeEventListener(ev, _showHint, { passive: true });
    });
    console.log('[OneSignal] Auto-prompt hint — showing notification button highlight');
    // Highlight the burger notification button with a subtle pulse
    var btn = document.getElementById('osNotifBtn');
    if (btn && !_osState.subscribed) {
      btn.style.animation = 'osNotifPulse 1.5s ease-in-out 3';
      if (!document.getElementById('_osNotifPulseStyle')) {
        var s = document.createElement('style');
        s.id = '_osNotifPulseStyle';
        s.textContent = '@keyframes osNotifPulse{0%,100%{box-shadow:none}50%{box-shadow:0 0 0 4px rgba(61,142,248,0.35)}}';
        document.head.appendChild(s);
      }
    }
  }

  // Listen for any real user interaction
  ['click', 'scroll', 'keydown', 'touchstart'].forEach(function(ev) {
    document.addEventListener(ev, _showHint, { passive: true, once: true });
  });

  // 30-second fallback
  setTimeout(_showHint, 30000);
}

/**
 * _osCheckSubscriptionState — reads current push-subscription state from
 * the live SDK and updates the burger button accordingly.
 * @param {object} OneSignal
 */
async function _osCheckSubscriptionState(OneSignal) {
  try {
    const isPushEnabled = OneSignal.User.PushSubscription.optedIn; // sync in v16
    _osState.subscribed = !!isPushEnabled;

    if (_osState.subscribed) {
      _osState.userId = OneSignal.User.PushSubscription.id || null;
      _osSaveSubscriptionState();
      console.log('[OneSignal] Already subscribed ✅ id:', _osState.userId);
    }

    _osRenderBurgerButton();

    // Stay in sync if the user changes permission in browser settings
    OneSignal.User.PushSubscription.addEventListener('change', function(event) {
      _osState.subscribed = !!event.current.optedIn;
      _osState.userId     = event.current.id || null;
      _osSaveSubscriptionState();
      _osRenderBurgerButton();
    });

  } catch (err) {
    console.warn('[OneSignal] Subscription state check failed:', err);
    _osRenderBurgerButton();
  }
}

/**
 * _osSaveSubscriptionState — caches subscription state in localStorage so
 * the button renders correctly on the next page load before SDK re-init.
 */
function _osSaveSubscriptionState() {
  try {
    localStorage.setItem('studyria_onesignal_state', JSON.stringify({
      subscribed: _osState.subscribed,
      userId:     _osState.userId,
      savedAt:    Date.now(),
    }));
  } catch (e) { /* non-critical */ }
}

/**
 * _osRenderBurgerButton — sets the #osNotifBtn text/style to match state:
 *   Notifications Enabled ✅   — already subscribed (button disabled)
 *   Notifications Blocked 🚫   — browser permission denied
 *   Enable Notifications 🔔    — default / not yet subscribed
 */
function _osRenderBurgerButton() {
  const btn = document.getElementById('osNotifBtn');
  if (!btn) return;

  const perm = 'Notification' in window ? Notification.permission : 'default';

  if (_osState.subscribed) {
    btn.textContent   = 'Notifications Enabled ✅';
    btn.disabled      = true;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(16,217,142,0.12);border-color:rgba(16,217,142,0.35);color:#10d98e;cursor:default;';
  } else if (perm === 'denied') {
    // Requirement 6: show blocked state when permission is denied.
    btn.textContent   = 'Notifications Blocked 🚫';
    btn.disabled      = false; // keep clickable so user can see the tip
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(255,77,109,0.1);border-color:rgba(255,77,109,0.3);color:#ff6b85;cursor:pointer;';
  } else {
    btn.textContent   = 'Enable Notifications 🔔';
    btn.disabled      = false;
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.1);border-color:rgba(61,142,248,0.3);color:#60a5fa;cursor:pointer;';
  }
}

/** Shared button base styles (flex, rounded, font, etc.) */
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
 * _osSetButtonError — restores the button to a clickable state and shows
 * the real error in a toast. Never leaves the button stuck on a loading state.
 */
function _osSetButtonError(userMessage, realError) {
  console.error('[OneSignal] Error —', realError);
  if (typeof showToast === 'function') showToast(userMessage, 'error');
  _osRenderBurgerButton(); // always restore
}

/**
 * osRequestNotification — click handler for the burger-menu notification
 * button. Implements the correct Chrome Android PWA permission flow.
 *
 * CRITICAL ORDERING (do not change without reading the comment at the
 * top of section 11b):
 *
 *   STEP 1 — sync, MUST be first, within user-gesture window:
 *     Initiate Notification.requestPermission() immediately on click.
 *     No await before this call. Chrome Android PWA will silently drop
 *     the permission dialog if any await precedes this.
 *
 *   STEP 2 — async, after permission dialog resolves:
 *     Await the permission result (granted / denied / default).
 *
 *   STEP 3 — async, only if granted:
 *     Await the OneSignal SDK ready promise.
 *
 *   STEP 4 — async:
 *     Verify service worker is active (non-fatal if slow).
 *
 *   STEP 5 — async:
 *     Call OneSignal.User.PushSubscription.optIn() — never called before
 *     permission is confirmed (requirement 5).
 *
 *   STEP 6 — sync read + UI update:
 *     Confirm optedIn, save state, update button to "Enabled".
 */
window.osRequestNotification = async function() {
  const btn = document.getElementById('osNotifBtn');

  // Guard: already subscribed — nothing to do
  if (_osState.subscribed) {
    console.log('[OneSignal] Already subscribed — skipping');
    return;
  }

  // Guard: permission already denied — direct user to browser settings
  if ('Notification' in window && Notification.permission === 'denied') {
    console.log('[OneSignal] Permission — already denied; directing to settings');
    if (typeof showToast === 'function') {
      showToast('Notifications are blocked. Open your browser site settings to allow them.', 'info');
    }
    _osRenderBurgerButton();
    return;
  }

  // ── STEP 1: Initiate permission request SYNCHRONOUSLY ──────────────────
  // MUST be the very first thing — no await before this.
  // Chrome Android PWA silently drops the dialog if any await precedes it.
  console.log('[OneSignal] Step: Permission requested (sync within gesture)…');

  if (btn) {
    btn.disabled      = true;
    btn.textContent   = 'Requesting…';
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.08);border-color:rgba(61,142,248,0.2);color:#7a8caa;cursor:wait;';
  }

  const permissionPromise = Notification.requestPermission();

  // ── STEP 2: Await the permission result ───────────────────────────────
  let permission;
  try {
    permission = await permissionPromise;
  } catch (_err) {
    // Fallback: promise rejected on some browsers — read the actual value
    permission = 'Notification' in window ? Notification.permission : 'default';
    console.warn('[OneSignal] requestPermission() threw — using Notification.permission:', permission);
  }

  // Always treat Notification.permission as the authoritative source
  const actualPermission = 'Notification' in window ? Notification.permission : permission;
  console.log('[OneSignal] Step: Permission — promise returned:', permission, '| Notification.permission:', actualPermission);

  if (actualPermission === 'denied') {
    console.log('[OneSignal] Step: Permission denied ❌');
    if (typeof showToast === 'function') {
      showToast('Notifications blocked. Open your browser site settings to allow them.', 'info');
    }
    _osRenderBurgerButton();
    return;
  }

  if (actualPermission !== 'granted') {
    // User dismissed the dialog — restore button silently so they can retry
    console.log('[OneSignal] Step: Permission dismissed (default) — restoring button for retry');
    _osRenderBurgerButton();
    return;
  }

  // ── STEP 3: Permission granted ✅ ─────────────────────────────────────
  console.log('[OneSignal] Step: Permission granted ✅');
  if (btn) {
    btn.textContent   = 'Enabling…';
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.08);border-color:rgba(61,142,248,0.2);color:#7a8caa;cursor:wait;';
  }

  try {
    // ── STEP 4: Wait for OneSignal SDK ───────────────────────────────────
    console.log('[OneSignal] Step: Waiting for SDK…');
    const OneSignal = await Promise.race([
      _osReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OneSignal SDK timed out after 15s')), 15000)
      ),
    ]);
    console.log('[OneSignal] Step: SDK ready ✅');

    // ── STEP 5: Service worker check (non-fatal) ──────────────────────────
    if ('serviceWorker' in navigator) {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(resolve => setTimeout(resolve, 5000)), // non-fatal timeout
      ]).catch(() => {});
    }
    console.log('[OneSignal] Step: Service Worker checked ✅');

    // ── STEP 6: Call optIn() ──────────────────────────────────────────────
    // At this point Notification.permission === 'granted' so optIn() will not
    // show any dialog. It registers the push subscription with OneSignal's
    // backend. We treat optIn() resolving without throwing as success —
    // optedIn may still be false synchronously on Chrome Android PWA because
    // the token arrives asynchronously. The change event listener installed
    // in _osCheckSubscriptionState will update _osState when the token lands.
    console.log('[OneSignal] Step: Calling optIn()…');
    await OneSignal.User.PushSubscription.optIn();
    console.log('[OneSignal] Step: OneSignal subscribed ✅ — optIn() resolved without error');

    // Read whatever the SDK has synchronously — may be null on first subscribe
    const subId    = OneSignal.User.PushSubscription.id    || null;
    const optedIn  = OneSignal.User.PushSubscription.optedIn;
    console.log('[OneSignal] Subscription ID:', subId, '| optedIn:', optedIn);

    // ── STEP 7: Mark success ──────────────────────────────────────────────
    // Key insight: permission is granted AND optIn() resolved without error.
    // That is sufficient to show "Notifications Enabled". The push token /
    // subscription ID will arrive via the change event and be saved then.
    _osState.subscribed = true;
    _osState.userId     = subId;
    _osSaveSubscriptionState();

    // Listen for the token to arrive so we can persist the real subscription ID
    try {
      OneSignal.User.PushSubscription.addEventListener('change', function onFirstToken(event) {
        OneSignal.User.PushSubscription.removeEventListener('change', onFirstToken);
        _osState.userId = event.current.id || _osState.userId;
        _osSaveSubscriptionState();
        console.log('[OneSignal] Subscription ID (token arrived):', _osState.userId);
      });
    } catch (_) { /* non-critical */ }

    console.log('[OneSignal] Step: Success ✅');

    if (btn) {
      btn.textContent   = 'Notifications Enabled ✅';
      btn.disabled      = true;
      btn.style.cssText = _osBtnBaseStyle() +
        'background:rgba(16,217,142,0.12);border-color:rgba(16,217,142,0.35);color:#10d98e;cursor:default;';
    }
    if (typeof showToast === 'function') {
      showToast('🔔 Notifications enabled! You\'ll get the latest updates from Studyria.', 'success');
    }

  } catch (err) {
    // Only reaches here for genuine errors: SDK timeout, network failure, etc.
    // NEVER shown for the normal async token-pending state.
    console.error('[OneSignal] Failure reason:', err && err.message ? err.message : err);

    // If permission is still granted, the failure is a backend/network issue —
    // do NOT show "could not enable" because the subscription may still land.
    // Just restore the button so they can retry.
    const permNow = 'Notification' in window ? Notification.permission : 'default';
    if (permNow === 'granted') {
      console.warn('[OneSignal] Failure reason: SDK/network error with granted permission — suppressing error toast');
      // Restore button for retry without showing an error message
      _osRenderBurgerButton();
    } else if (permNow === 'denied') {
      console.log('[OneSignal] Failure reason: permission became denied');
      if (typeof showToast === 'function') {
        showToast('Notifications blocked. Open your browser site settings to allow them.', 'info');
      }
      _osRenderBurgerButton();
    } else {
      console.log('[OneSignal] Failure reason: SDK error, permission default — restoring button');
      _osRenderBurgerButton();
    }
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
  isInstalled:     () => _isAlreadyInstalled(),
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
  updateInstallButtonVisibility: _updateInstallButtonVisibility,

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
