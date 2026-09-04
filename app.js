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
 *   - PWA diagnostics & performance monitoring
 *   - OneSignal Web Push (init, subscription helpers, public API)
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
    'border-bottom:1px solid rgba(147,2,5,0.3)',
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
      style="padding:8px 16px;background:linear-gradient(135deg,#930205,#c99a3c);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap;flex-shrink:0">
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
    'border:1px solid rgba(147,2,5,0.25)',
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
        style="flex:1;padding:10px;background:linear-gradient(135deg,#930205,#c99a3c);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer">
        ⬇ View & Install
      </button>
      <button id="_pwaInstallLater"
        style="padding:10px 14px;background:rgba(255,255,255,0.06);color:#7a8caa;border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:.85rem;cursor:pointer">
        Later
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('_pwaInstallConfirm').addEventListener('click', function() { dismissInstallBanner(); if (typeof navigate === 'function') navigate('pwa'); });
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
  // Both pwaHmInstallBtn (burger menu) and pwaInstallBtn (header) now navigate
  // to the App & Updates page. Show them whenever the app is not installed.
  ['pwaHmInstallBtn', 'pwaInstallBtn'].forEach(function(id) {
    var btn = document.getElementById(id);
    if (!btn) return;

    if (_isAlreadyInstalled()) {
      btn.style.display = 'none';
      return;
    }

    btn.style.display   = '';
    btn.disabled        = false;
    btn.style.opacity   = '';
    btn.style.cursor    = '';
  });
}

/**
 * _bindInstallButton — ensures the burger Install button visibility is correct.
 * The button now uses onclick="navigate('pwa')" to open the App & Updates page.
 * No click listener is needed here — the PWA page handles the actual install.
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

    // No click listener — the button uses onclick="navigate('pwa')"
    // to open the unified App & Updates page, where the actual install
    // is handled by the canonical window.PWA.promptInstall() handler.

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
    // No native install prompt available — show fallback instructions.
    // Do NOT disable the burger menu button — it now navigates to the
    // App & Updates page, which handles the fallback UI.
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
    'border-top:1px solid rgba(147,2,5,0.25)',
    'font-family:system-ui,sans-serif',
    'text-align:center',
    'box-shadow:0 -8px 40px rgba(0,0,0,0.6)',
  ].join(';');

  tip.innerHTML = `
    <div style="font-size:1.5rem;margin-bottom:10px">📱</div>
    <div style="color:#e4e8f0;font-weight:700;font-size:1rem;margin-bottom:6px">Install Studyria on iPhone</div>
    <div style="color:#7a8caa;font-size:.85rem;line-height:1.6">
      Tap <strong style="color:#930205">Share</strong> <span style="font-size:1rem">⬆</span> at the bottom of Safari,
      then tap <strong style="color:#930205">"Add to Home Screen"</strong> 
      <span style="font-size:1rem">➕</span>
    </div>
    <button onclick="document.getElementById('_pwaIOSTip').remove()"
      style="margin-top:14px;padding:10px 24px;background:linear-gradient(135deg,#930205,#c99a3c);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">
      Got it
    </button>
    <div style="font-size:1.5rem;position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#930205">▼</div>
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
      'background:var(--theme-error-bg, #7f1d1d)',
      'border-bottom:1px solid var(--theme-error-border, transparent)',
      'padding:10px 16px', 'display:flex', 'align-items:center', 'gap:8px',
      'font-family:var(--hp-font-body, system-ui, sans-serif)',
      'font-size:.85rem', 'color:var(--theme-error, #fecaca)',
      'box-shadow:var(--theme-shadow, 0 2px 12px rgba(0,0,0,0.5))',
    ].join(';');
    bar.innerHTML = `
      <span style="width:8px;height:8px;background:var(--theme-error, #ef4444);border-radius:50%;flex-shrink:0;animation:_pwaPulse 2s ease-in-out infinite"></span>
      <span style="flex:1">📡 You're offline${cachedCount > 0 ? ` — ${cachedCount} PDFs cached` : ' — some features may be unavailable'}</span>
      <button onclick="window.location.reload()" style="padding:4px 10px;background:var(--theme-surface-elevated);color:var(--theme-error);border:1px solid var(--theme-error-border);border-radius:6px;font-size:.75rem;cursor:pointer;flex-shrink:0">Retry</button>
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
// 9. ONESIGNAL WEB PUSH
// ═══════════════════════════════════════════════════════════════════════════
//
// Strategy:
//   • The OneSignal page SDK (<script defer>) and the deferred queue
//     (window.OneSignalDeferred) are both added by index.html — this file
//     must never touch those.
//   • We push a single callback into OneSignalDeferred.  OneSignal runs it
//     once the SDK is ready, which may be before or after DOMContentLoaded.
//   • init() is called exactly once thanks to _osState.initialized.
//   • No permission prompt fires on page load (autoPrompt: false).
//   • All public helpers are exposed on window.StudyriaNotifications.

const _osState = {
  initialized:  false,   // true after OneSignal.init() resolves
  initPromise:  null,    // the init Promise, so concurrent callers can await it
};

/**
 * _initOneSignal — called from inside window.OneSignalDeferred.
 * Runs once the SDK is ready; safe to call multiple times (idempotent).
 */
async function _initOneSignal(OneSignal) {
  // Guard: never init twice
  if (_osState.initialized) return;

  // If a concurrent call has already started init, wait for it
  if (_osState.initPromise) {
    await _osState.initPromise;
    return;
  }

  _osState.initPromise = (async () => {
    try {
      await OneSignal.init({
        appId:         '12e09fd8-9362-49ef-87d9-14ba353db7a6',
        safari_web_id: 'web.onesignal.auto.613528e9-2930-4b07-a098-5a9518822d98',
        notifyButton:  { enable: false },
        promptOptions: { autoPrompt: false },
      });

      _osState.initialized = true;
      console.log('[OneSignal] Initialized ✅');

      // Listen for future subscription changes (user opts in/out)
      OneSignal.User.PushSubscription.addEventListener('change', function(event) {
        console.log('[OneSignal] Subscription changed →',
          'optedIn:', event.current.optedIn,
          'id:', event.current.id || '—'
        );
        window.dispatchEvent(new CustomEvent('onesignal:subscriptionchange', {
          detail: {
            optedIn: event.current.optedIn,
            id:      event.current.id || null,
          }
        }));
      });

    } catch (err) {
      console.warn('[OneSignal] Init failed — push notifications unavailable:', err);
      // Do not rethrow: a OneSignal failure must never break the page.
    }
  })();

  await _osState.initPromise;
}

// Push the init callback into the deferred queue.
// If the SDK loaded before this line runs, OneSignal processes the queue
// synchronously on the next microtask; if not, it processes it once the SDK
// script finishes loading.  Either way, _initOneSignal receives the SDK
// instance as its first argument.
window.OneSignalDeferred = window.OneSignalDeferred || [];
// [Studyria Push Migration] OneSignal retired — native VAPID Web Push
// (SN.push, studyria-notifications.js) now owns the permission flow.
// OneSignal init intentionally disabled to prevent duplicate push systems.
// window.OneSignalDeferred.push(_initOneSignal);

// ── Helper: wait until init is complete ─────────────────────────────────────

/**
 * _waitForOneSignal — resolves once OneSignal.init() has completed.
 * Rejects after a 15-second timeout so callers never hang.
 */
function _waitForOneSignal() {
  return new Promise(function(resolve, reject) {
    if (_osState.initialized) { resolve(); return; }

    var deadline = Date.now() + 15000;

    function poll() {
      if (_osState.initialized) { resolve(); return; }
      if (Date.now() >= deadline) { reject(new Error('OneSignal init timed out')); return; }
      setTimeout(poll, 200);
    }
    poll();
  });
}

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * isNotificationSupported — true when the browser has everything needed for
 * push notifications (Notification API + Service Worker + PushManager +
 * secure context).  This is the canonical check used by all Notification
 * Center UI paths; it never falls back to UA sniffing.
 *
 * Android Chrome passes all four conditions once the Service Worker is
 * registered and the page is served over HTTPS (or localhost).
 */
function isNotificationSupported() {
  return (
    'Notification'    in window &&
    'serviceWorker'   in navigator &&
    'PushManager'     in window &&
    window.isSecureContext === true
  );
}

/**
 * isSubscribed — resolves to true when the user is currently opted in.
 * Returns false (not throws) if OneSignal is unavailable.
 */
async function isSubscribed() {
  try {
    await _waitForOneSignal();
    return !!window.OneSignal?.User?.PushSubscription?.optedIn;
  } catch (_) {
    return false;
  }
}

/**
 * getSubscriptionId — resolves to the OneSignal subscription ID string,
 * or null if the user is not subscribed or OneSignal is unavailable.
 */
async function getSubscriptionId() {
  try {
    await _waitForOneSignal();
    return window.OneSignal?.User?.PushSubscription?.id || null;
  } catch (_) {
    return null;
  }
}

/**
 * requestNotificationPermission — the single entry-point for requesting push
 * permission.  Call this from a user-gesture handler (button click, etc.).
 *
 * Returns:
 *   { success: true,  subscriptionId: '<id>' }   — user opted in
 *   { success: false, reason: '<why>' }           — denied, error, unsupported
 *
 * Guarantees:
 *   • Waits for OneSignal.init() before requesting — never races with init.
 *   • Never triggers a duplicate permission prompt.
 *   • Never throws — all errors are returned as { success: false }.
 */
async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    return { success: false, reason: 'not_supported' };
  }

  // Already denied by the browser — requesting again would be silently ignored
  // and would mislead the caller into thinking a prompt appeared.
  if (Notification.permission === 'denied') {
    console.warn('[OneSignal] Notification permission already denied by browser.');
    return { success: false, reason: 'denied' };
  }

  try {
    await _waitForOneSignal();
  } catch (err) {
    console.warn('[OneSignal] requestNotificationPermission: SDK not ready —', err.message);
    return { success: false, reason: 'sdk_not_ready' };
  }

  // Already subscribed — return immediately without showing a duplicate prompt
  if (window.OneSignal?.User?.PushSubscription?.optedIn) {
    return {
      success:        true,
      subscriptionId: window.OneSignal.User.PushSubscription.id || null,
    };
  }

  try {
    await window.OneSignal.Notifications.requestPermission();

    const optedIn = !!window.OneSignal?.User?.PushSubscription?.optedIn;
    if (optedIn) {
      return {
        success:        true,
        subscriptionId: window.OneSignal.User.PushSubscription.id || null,
      };
    }
    return { success: false, reason: 'dismissed' };

  } catch (err) {
    console.warn('[OneSignal] requestPermission error:', err);
    return { success: false, reason: err.message || 'error' };
  }
}

/**
 * getPermissionState — returns the current notification support/permission
 * state for building Notification Center UI without calling requestPermission():
 *
 *   'unsupported' — browser lacks Notification / SW / PushManager / secure ctx
 *   'default'     — supported, user hasn't been asked yet  → show Enable button
 *   'granted'     — permission granted                     → show "Enabled" status
 *   'denied'      — permission denied                      → show "Open Browser Settings"
 *
 * Never returns 'unsupported' on Android Chrome when SW is registered and
 * the page is served over HTTPS.
 */
async function getPermissionState() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/**
 * renderNotificationCenterUI — updates a Notification Center container with
 * the correct button/label for the current permission state.
 *
 * Expected DOM inside `container`:
 *   .notif-unsupported  — shown only when truly unsupported
 *   .notif-enable-btn   — "Enable Notifications" button (default state)
 *   .notif-enabled-msg  — "Notifications Enabled" label (granted state)
 *   .notif-settings-btn — "Open Browser Settings" button (denied state)
 *
 * Call this on page load and after any permission change.
 *
 * @param {Element} container  — wrapper element containing the four UI nodes
 */
async function renderNotificationCenterUI(container) {
  if (!container) return;

  const unsupportedEl = container.querySelector('.notif-unsupported');
  const enableBtn     = container.querySelector('.notif-enable-btn');
  const enabledMsg    = container.querySelector('.notif-enabled-msg');
  const settingsBtn   = container.querySelector('.notif-settings-btn');

  // Helper: hide all, then reveal one
  function _show(el) {
    [unsupportedEl, enableBtn, enabledMsg, settingsBtn].forEach(function(n) {
      if (n) n.style.display = 'none';
    });
    if (el) el.style.display = '';
  }

  const state = await getPermissionState();

  if (state === 'unsupported') {
    _show(unsupportedEl);
    return;
  }

  if (state === 'granted') {
    _show(enabledMsg);
    return;
  }

  if (state === 'denied') {
    _show(settingsBtn);
    // Wire up click to best-effort settings deep-link
    if (settingsBtn && !settingsBtn.__notifSettingsBound) {
      settingsBtn.__notifSettingsBound = true;
      settingsBtn.addEventListener('click', function() {
        openNotificationSettings();
      });
    }
    return;
  }

  // state === 'default'
  _show(enableBtn);
  if (enableBtn && !enableBtn.__notifEnableBound) {
    enableBtn.__notifEnableBound = true;
    enableBtn.addEventListener('click', async function() {
      enableBtn.disabled = true;
      try {
        const result = await requestNotificationPermission();
        // Re-render after the prompt resolves
        await renderNotificationCenterUI(container);
      } catch (_) {
        enableBtn.disabled = false;
      }
    });
  }
}

/**
 * openNotificationSettings — best-effort attempt to surface the browser's
 * site settings UI so the user can re-enable notifications after denying.
 * No browser exposes a direct JS API for this, so we:
 *   1. On Chrome/Edge/Android, deep-link to the relevant settings page where
 *      supported via chrome://settings (only works if already in that
 *      context — most mobile browsers ignore it, so this is paired with
 *      on-screen instructions in the Notification Center UI).
 *   2. Otherwise, just return false so the caller can show manual steps.
 */
function openNotificationSettings() {
  try {
    const ua = navigator.userAgent || '';
    const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
    if (isChrome) {
      // This only succeeds when the page itself is a chrome:// page, which
      // it never is for a normal site — included for completeness, but the
      // realistic path is always the manual-instructions fallback below.
      window.open('chrome://settings/content/notifications', '_blank');
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * tagAudienceSegment — tags the current OneSignal subscriber with a
 * 'user_type' of 'premium' or 'free' so admin sends can target audiences
 * via OneSignal segments/filters server-side. Call this after login and
 * after any purchase completes. Safe no-op if OneSignal isn't ready.
 *
 * NOTE: Studyria has no dedicated "is_premium" column today — this uses
 * "has at least one purchased PDF" as the premium signal. Adjust the
 * `isPremium` argument at the call site if a real premium/subscription
 * flag is added later.
 */
async function tagAudienceSegment(isPremium) {
  try {
    await _waitForOneSignal();
    await window.OneSignal?.User?.addTag?.('user_type', isPremium ? 'premium' : 'free');
  } catch (_) { /* OneSignal unavailable — never throw */ }
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * window.StudyriaNotifications — the stable public API for all OneSignal
 * interactions.  Other scripts (inline or third-party) should use this
 * rather than calling OneSignal directly.
 */
window.StudyriaNotifications = {
  // [Studyria Push Migration] Engine swapped OneSignal → native VAPID
  // Web Push (SN.push). UI shell unchanged; behavior identical to callers.
  requestPermission: async function () {
    if (window.SN && SN.push) return SN.push.enable();
    return { success: false, reason: 'unsupported' };
  },
  isSubscribed: async function () {
    if (window.SN && SN.push) {
      const st = await SN.push.status();
      return !!st.subscribed;
    }
    return false;
  },
  getSubscriptionId: async function () {
    if (window.SN && SN.push) {
      const st = await SN.push.status();
      return st.subscribed ? 'device-subscribed' : null;
    }
    return null;
  },
  getPermissionState: async function () {
    if (window.SN && SN.push) {
      if (!SN.push.supported()) return 'unsupported';
      return Notification.permission; // 'default' | 'granted' | 'denied'
    }
    return 'unsupported';
  },
  renderNotificationCenterUI: renderNotificationCenterUI,
  openNotificationSettings: openNotificationSettings,
  tagAudienceSegment:       async function () { /* retired with OneSignal */ },
};

console.log('[OneSignal] window.StudyriaNotifications ready');

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
      periodicSync:   _caps.periodicSync,
      pushManager:    _caps.pushManager,
    },
    state: {
      isOnline:            _state.isOnline,
      isInstalled:         _state.isInstalled,
      hasPendingUpdate:    !!(_state.waitingSW || reg?.waiting),
      swState:             reg?.active?.state || 'none',
    },
    metrics: {
      ..._metrics,
      hitRate: (_metrics.cacheHits + _metrics.cacheMisses) > 0
        ? ((_metrics.cacheHits / (_metrics.cacheHits + _metrics.cacheMisses)) * 100).toFixed(1) + '%'
        : 'N/A',
    },
    data: {
      pdfsLoaded:       (window.PDFS || []).length,
      supabaseReady:    !!window.supabaseClient,
      currentPage:      window.currentPage || '—',
      oneSignalInited:  _osState.initialized,
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

  console.log('[PWA] Studyria PWA v' + PWA_CONFIG.VERSION + ' initialized ✅');
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA);
} else {
  initPWA();
}

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
