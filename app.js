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
  // Capture beforeinstallprompt (Android, Chrome Desktop, Edge, Samsung)
  window.addEventListener('beforeinstallprompt', e => {
    // ✅ Always prevent the browser's automatic install banner / mini-infobar.
    e.preventDefault();
    _state.deferredPrompt = e;

    // Show the professional install banner after a short delay so it doesn't
    // immediately compete with page load. Only shows when not yet installed and
    // not dismissed this session.
    setTimeout(function() {
      if (!_state.isInstalled && !_installBannerState.dismissed) {
        showInstallBanner();
      }
    }, 2500);

    // Dispatch event so other handlers (pwaAppCenter, etc.) can react
    window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { prompt: e } }));

    console.log('[PWA] Install prompt captured ✅');
  });

  // App successfully installed
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed ✅');
    _state.isInstalled = true;
    _state.deferredPrompt = null;
    _installBannerState.dismissed = true;   // never show again this session
    document.documentElement.setAttribute('data-pwa-installed', 'true');

    // Remove install banner immediately
    _dismissInstallBannerAnimated();

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

// ── Install Banner: session-level dismiss state ────────────────────────────
// Tracks whether user has dismissed the banner this session (not stored in
// localStorage — using localStorage would persist across sessions and block
// the banner even when the app is not installed yet after a browser restart).
const _installBannerState = {
  dismissed: false,   // user clicked "Later" or "✕" this session
  shown:     false,   // banner was displayed at least once this session
};

/**
 * _injectInstallBannerStyles — adds CSS keyframes + base styles once.
 */
function _injectInstallBannerStyles() {
  if (document.getElementById('_pwaInstallStyles')) return;
  const style = document.createElement('style');
  style.id = '_pwaInstallStyles';
  style.textContent = `
    @keyframes _pwaInstallSlideUp {
      from { opacity:0; transform:translateX(-50%) translateY(28px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
    @keyframes _pwaInstallSlideDown {
      from { opacity:1; transform:translateX(-50%) translateY(0); }
      to   { opacity:0; transform:translateX(-50%) translateY(28px); }
    }
    @keyframes _pwaInstallPulse {
      0%,100% { box-shadow:0 0 0 0 rgba(61,142,248,0.35); }
      50%     { box-shadow:0 0 0 8px rgba(61,142,248,0); }
    }
    #_pwaInstallBanner {
      position:fixed;
      bottom:20px;
      left:50%;
      transform:translateX(-50%);
      z-index:99998;
      max-width:440px;
      width:calc(100% - 32px);
      background:linear-gradient(145deg,#0f1e38 0%,#0a1628 100%);
      border:1px solid rgba(61,142,248,0.28);
      border-radius:18px;
      padding:0;
      box-shadow:0 12px 48px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04) inset;
      font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      animation:_pwaInstallSlideUp .4s cubic-bezier(.22,.68,0,1.2) both;
      overflow:hidden;
    }
    #_pwaInstallBanner._dismissing {
      animation:_pwaInstallSlideDown .28s ease-in forwards;
    }
    #_pwaInstallBanner .pib-accent {
      height:3px;
      background:linear-gradient(90deg,#3d8ef8,#00c8e8,#3d8ef8);
      background-size:200% 100%;
    }
    #_pwaInstallBanner .pib-body {
      padding:16px 16px 18px;
    }
    #_pwaInstallBanner .pib-row1 {
      display:flex;align-items:center;gap:12px;
    }
    #_pwaInstallBanner .pib-icon {
      width:46px;height:46px;border-radius:12px;flex-shrink:0;
      background:linear-gradient(135deg,#3d8ef8,#00c8e8);
      display:flex;align-items:center;justify-content:center;
      font-size:1.4rem;
      animation:_pwaInstallPulse 2.4s ease-in-out infinite;
    }
    #_pwaInstallBanner .pib-text { flex:1;min-width:0; }
    #_pwaInstallBanner .pib-title {
      color:#e8edf8;font-weight:700;font-size:.95rem;
      letter-spacing:-.01em;line-height:1.3;
    }
    #_pwaInstallBanner .pib-sub {
      color:#6b80a8;font-size:.76rem;margin-top:3px;line-height:1.4;
    }
    #_pwaInstallBanner .pib-close {
      background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
      color:#6b80a8;width:28px;height:28px;border-radius:8px;
      cursor:pointer;font-size:.85rem;display:flex;align-items:center;
      justify-content:center;flex-shrink:0;transition:background .15s,color .15s;
    }
    #_pwaInstallBanner .pib-close:hover { background:rgba(255,255,255,0.12);color:#b0bdd4; }
    #_pwaInstallBanner .pib-features {
      display:flex;gap:6px;margin:12px 0;
      flex-wrap:wrap;
    }
    #_pwaInstallBanner .pib-chip {
      display:flex;align-items:center;gap:5px;
      background:rgba(61,142,248,0.08);
      border:1px solid rgba(61,142,248,0.18);
      border-radius:20px;padding:4px 10px;
      color:#7da9f0;font-size:.72rem;font-weight:500;
      white-space:nowrap;
    }
    #_pwaInstallBanner .pib-actions {
      display:flex;gap:8px;margin-top:4px;
    }
    #_pwaInstallBanner .pib-btn-install {
      flex:1;padding:11px 16px;
      background:linear-gradient(135deg,#3d8ef8 0%,#00c8e8 100%);
      color:#fff;border:none;border-radius:11px;
      font-weight:700;font-size:.9rem;cursor:pointer;
      letter-spacing:-.01em;
      transition:opacity .15s,transform .1s;
      display:flex;align-items:center;justify-content:center;gap:7px;
    }
    #_pwaInstallBanner .pib-btn-install:hover { opacity:.9; }
    #_pwaInstallBanner .pib-btn-install:active { transform:scale(.97); }
    #_pwaInstallBanner .pib-btn-later {
      padding:11px 14px;
      background:rgba(255,255,255,0.05);
      color:#6b80a8;
      border:1px solid rgba(255,255,255,0.09);
      border-radius:11px;font-size:.83rem;cursor:pointer;
      transition:background .15s,color .15s;
      white-space:nowrap;
    }
    #_pwaInstallBanner .pib-btn-later:hover {
      background:rgba(255,255,255,0.1);color:#9ab0d4;
    }
    @media (prefers-color-scheme: light) {
      #_pwaInstallBanner {
        background:linear-gradient(145deg,#ffffff 0%,#f4f7fd 100%);
        border-color:rgba(61,142,248,0.22);
        box-shadow:0 12px 48px rgba(61,142,248,0.12),0 2px 8px rgba(0,0,0,0.08);
      }
      #_pwaInstallBanner .pib-title  { color:#1a2a4a; }
      #_pwaInstallBanner .pib-sub    { color:#7a8caa; }
      #_pwaInstallBanner .pib-close  { background:rgba(0,0,0,0.05);border-color:rgba(0,0,0,0.1);color:#7a8caa; }
      #_pwaInstallBanner .pib-chip   { background:rgba(61,142,248,0.07);color:#3d6cbf; }
      #_pwaInstallBanner .pib-btn-later { background:rgba(0,0,0,0.05);color:#7a8caa;border-color:rgba(0,0,0,0.09); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * showInstallBanner — displays the professional PWA install prompt.
 *
 * Guards:
 *  • Already showing → no-op
 *  • Already installed (standalone mode) → no-op
 *  • User dismissed this session → no-op
 *  • No deferred prompt AND not iOS → no-op
 */
function showInstallBanner() {
  // Guard: already showing
  if (document.getElementById('_pwaInstallBanner')) return;
  // Guard: running as installed PWA
  if (_state.isInstalled) return;
  // Guard: dismissed this session
  if (_installBannerState.dismissed) return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const canNativeInstall = !!_state.deferredPrompt;

  // Only show if we can actually do something useful
  if (!canNativeInstall && !isIOS) return;

  _injectInstallBannerStyles();

  // Also inject the animation keyframe needed by the offline bar (shared)
  if (!document.getElementById('_pwaAnimStyles')) {
    const s = document.createElement('style');
    s.id = '_pwaAnimStyles';
    s.textContent = `
      @keyframes _pwaSlideUp {
        from { opacity:0; transform:translateX(-50%) translateY(24px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
      }
      @keyframes _pwaPulse {
        0%,100% { opacity:1; }
        50%      { opacity:.4; }
      }
    `;
    document.head.appendChild(s);
  }

  const banner = document.createElement('div');
  banner.id   = '_pwaInstallBanner';
  banner.setAttribute('role', 'complementary');
  banner.setAttribute('aria-label', 'Install Studyria App');

  const installLabel = isIOS ? '📱 Add to Home Screen' : '⬇ Install App';
  const subText = isIOS
    ? 'Add to your Home Screen for the full app experience.'
    : 'Install for offline access. Works without a browser.';

  banner.innerHTML = `
    <div class="pib-accent"></div>
    <div class="pib-body">
      <div class="pib-row1">
        <div class="pib-icon" aria-hidden="true">📚</div>
        <div class="pib-text">
          <div class="pib-title">Install Studyria App</div>
          <div class="pib-sub">${subText}</div>
        </div>
        <button class="pib-close" id="_pwaInstallClose" aria-label="Dismiss install prompt">✕</button>
      </div>
      <div class="pib-features">
        <span class="pib-chip">⚡ Instant launch</span>
        <span class="pib-chip">📶 Offline PDFs</span>
        <span class="pib-chip">🔔 Notifications</span>
      </div>
      <div class="pib-actions">
        <button class="pib-btn-install" id="_pwaInstallConfirm">${installLabel}</button>
        <button class="pib-btn-later"   id="_pwaInstallLater">Not now</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);
  _installBannerState.shown = true;

  // Wire buttons
  document.getElementById('_pwaInstallConfirm').addEventListener('click', () => {
    if (isIOS && !canNativeInstall) {
      showiOSInstallTip();
      _dismissInstallBannerAnimated();
    } else {
      promptInstall();
    }
  });
  document.getElementById('_pwaInstallLater').addEventListener('click', () => {
    _installBannerState.dismissed = true;
    _dismissInstallBannerAnimated();
  });
  document.getElementById('_pwaInstallClose').addEventListener('click', () => {
    _installBannerState.dismissed = true;
    _dismissInstallBannerAnimated();
  });

  // Auto-dismiss after 18s if untouched
  setTimeout(() => {
    if (document.getElementById('_pwaInstallBanner')) {
      _installBannerState.dismissed = true;
      _dismissInstallBannerAnimated();
    }
  }, 18000);
}

function _dismissInstallBannerAnimated() {
  const banner = document.getElementById('_pwaInstallBanner');
  if (!banner) return;
  banner.classList.add('_dismissing');
  banner.addEventListener('animationend', () => banner.remove(), { once: true });
  // Safety fallback
  setTimeout(() => banner.remove(), 400);
}

function dismissInstallBanner() {
  _installBannerState.dismissed = true;
  _dismissInstallBannerAnimated();
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

    } catch (err) {
      console.error('[OneSignal] Init — FAILED:', err);
      _osReadyReject(err); // unblocks any awaiting click handler
    }
  });
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
  if (_osState.subscribed) return;

  // Guard: permission already denied — direct user to browser settings
  if ('Notification' in window && Notification.permission === 'denied') {
    if (typeof showToast === 'function') {
      showToast('Notifications are blocked. Open your browser site settings to allow them.', 'info');
    }
    _osRenderBurgerButton();
    return;
  }

  // ── STEP 1: Initiate permission request SYNCHRONOUSLY ──────────────────
  // This call MUST happen before any await. Chrome Android PWA requires the
  // permission API to be triggered within the direct synchronous call stack
  // of the click event. We start the Promise here but do not await it yet.
  console.log('[OneSignal] Step: Permission — initiating (sync within gesture)…');

  // Disable button immediately to prevent double-tap
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Requesting…';
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.08);border-color:rgba(61,142,248,0.2);color:#7a8caa;cursor:wait;';
  }

  // Start the native permission request NOW — synchronous call within gesture
  const permissionPromise = Notification.requestPermission();

  // ── STEP 2: Await the permission dialog result ─────────────────────────
  // From here the user-gesture window is no longer relevant — the browser
  // dialog was already triggered in STEP 1.
  let permission;
  try {
    permission = await permissionPromise;
  } catch (err) {
    // SecurityError — should not happen since we called from a click event
    console.error('[OneSignal] Step: Permission — requestPermission() threw:', err);
    _osSetButtonError('Could not request notification permission.', err);
    return;
  }

  console.log('[OneSignal] Step: Permission —', permission);

  if (permission === 'denied') {
    // Requirement 6: show blocked message, update button.
    console.log('[OneSignal] Step: Permission — denied ❌');
    if (typeof showToast === 'function') {
      showToast('Notifications blocked. Open your browser site settings to allow them.', 'info');
    }
    _osRenderBurgerButton();
    return;
  }

  if (permission !== 'granted') {
    // Dismissed (user closed dialog without choosing) — restore for retry
    console.log('[OneSignal] Step: Permission — dismissed');
    _osRenderBurgerButton();
    return;
  }

  // Permission granted ✅ — proceed with async OneSignal work
  console.log('[OneSignal] Step: Permission — granted ✅');
  if (btn) {
    btn.textContent   = 'Enabling…';
    btn.style.cssText = _osBtnBaseStyle() +
      'background:rgba(61,142,248,0.08);border-color:rgba(61,142,248,0.2);color:#7a8caa;cursor:wait;';
  }

  try {
    // ── STEP 3: Wait for OneSignal SDK to be ready ───────────────────────
    console.log('[OneSignal] Step: Init — waiting for SDK…');
    // Race against a 15-second ceiling in case the CDN is unreachable.
    const OneSignal = await Promise.race([
      _osReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OneSignal SDK init timed out after 15s')), 15000)
      ),
    ]);
    console.log('[OneSignal] Step: Init — ready ✅');

    // ── STEP 4: Check service worker is active (non-fatal) ───────────────
    console.log('[OneSignal] Step: Service Worker — checking…');
    if ('serviceWorker' in navigator) {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SW ready timed out')), 5000)
        ),
      ]).catch(err => {
        // Non-fatal: SW may still be installing. Log and continue.
        console.warn('[OneSignal] Step: Service Worker — not ready, continuing:', err.message);
      });
    }
    console.log('[OneSignal] Step: Service Worker — checked ✅');

    // ── STEP 5: Subscribe via OneSignal optIn() ──────────────────────────
    // Permission is already granted at the native browser level (STEP 2).
    // optIn() registers/activates the OneSignal push subscription without
    // needing to show any prompt. We never call login() here — login()
    // would create an external user record before subscription is confirmed.
    console.log('[OneSignal] Step: Subscription — calling optIn()…');
    await OneSignal.User.PushSubscription.optIn();

    // ── STEP 6: Confirm subscription and update UI ───────────────────────
    const optedIn = OneSignal.User.PushSubscription.optedIn; // sync in v16
    console.log('[OneSignal] Step: Subscription — optedIn =', optedIn);

    if (!optedIn) {
      // Granted but subscription creation not yet confirmed (push service
      // may be slow). The 'change' listener set in _osCheckSubscriptionState
      // will fire when OneSignal's backend confirms — do not block the UI.
      console.warn('[OneSignal] optIn() called; awaiting backend confirmation via change event');
      if (typeof showToast === 'function') {
        showToast('Notifications enabled — syncing with server…', 'info');
      }
      _osRenderBurgerButton();
      return;
    }

    _osState.subscribed = true;
    _osState.userId     = OneSignal.User.PushSubscription.id || null;
    _osSaveSubscriptionState();

    console.log('[OneSignal] Step: Success — subscribed ✅',
      'id:', _osState.userId,
      'token:', OneSignal.User.PushSubscription.token ?? '(pending server sync)');

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
    // Any async failure (SDK timeout, optIn error, etc.) — restore button.
    _osSetButtonError('Could not enable notifications — please try again.', err);
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
