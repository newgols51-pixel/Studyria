// ══════════════════════════════════════════════════════════════════
// pwa-update.js — Studyria Smart Update System  v3.1  (2026)
// ══════════════════════════════════════════════════════════════════
//
// Features:
//   • Semantic version management (v3.1.x)
//   • Silent background update (never interrupts session)
//   • Smart update banner — slide-up, premium UI
//   • One-click update with animated progress steps
//   • "What's New" dialog (once per version)
//   • Critical / force-update (full-screen gate)
//   • Asset validation before activation
//   • Smart cache cleanup
//   • Rollback protection
//   • Update analytics (gtag + dataLayer)
//   • Version display in Settings / About
//
// Dependencies: sw.js must handle SKIP_WAITING + GET_VERSION messages.
// This file is payment-safe — never reloads during active Razorpay session.
// ══════════════════════════════════════════════════════════════════
;(function StudyriaUpdateSystem() {
  'use strict';

  // ── APP VERSION ──────────────────────────────────────────────────
  const APP = {
    VERSION:       '3.1.1',
    BUILD:         '2026.07.18',
    NAME:          'Studyria',
    WHATS_NEW: [
      { type: 'new',  text: 'PWA V3 Smart Update System with one-click updates' },
      { type: 'new',  text: 'Animated splash screen on app launch' },
      { type: 'new',  text: '8 app shortcuts for quick access' },
      { type: 'fix',  text: 'Eliminated raw code leak below footer' },
      { type: 'fix',  text: 'Premium content category filtering fixed' },
      { type: 'perf', text: 'Image cache-first strategy — faster load' },
      { type: 'perf', text: 'Font CDN cached for instant renders' },
    ],
    // Set this to a version string to force update users below that version
    CRITICAL_MIN_VERSION: null,   // e.g. '3.0.0' — null = no force update
    CRITICAL_MESSAGE:     'A critical security update is required before you can continue.',
  };

  // ── STORAGE KEYS ─────────────────────────────────────────────────
  const KEY = {
    INSTALLED_VERSION: 'studyria_installed_version',
    WHATS_NEW_SEEN:    'studyria_whats_new_seen',
    UPDATE_DISMISSED:  'studyria_update_dismissed_at',
    ANALYTICS:         'studyria_pwa_analytics',
  };

  // ── STATE ─────────────────────────────────────────────────────────
  let _swReg       = null;
  let _waitingSW   = null;
  let _dismissed   = false;
  let _updating    = false;
  let _bannerEl    = null;
  let _progressEl  = null;
  let _whatsNewEl  = null;
  let _forceEl     = null;

  // ── SEMVER COMPARE ────────────────────────────────────────────────
  function semverGt(a, b) {
    if (!a || !b) return false;
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0;
    }
    return false;
  }

  // ── ANALYTICS ────────────────────────────────────────────────────
  function _track(event, params) {
    try {
      if (window.gtag) gtag('event', event, Object.assign({ event_category: 'PWA_Update' }, params));
      if (window.dataLayer) dataLayer.push(Object.assign({ event }, params));
      // Local analytics log
      const log = JSON.parse(localStorage.getItem(KEY.ANALYTICS) || '[]');
      log.push({ event, ts: Date.now(), v: APP.VERSION, ...params });
      if (log.length > 50) log.splice(0, log.length - 50);
      localStorage.setItem(KEY.ANALYTICS, JSON.stringify(log));
    } catch (_) {}
  }

  // ── PAYMENT-SAFE CHECK ────────────────────────────────────────────
  function _isSafeToReload() {
    return !document.querySelector('[data-payment-active]')
        && !window._razorpayOpen
        && !window._paymentInProgress;
  }

  // ── SAFE RELOAD ───────────────────────────────────────────────────
  function _safeReload() {
    if (_isSafeToReload()) {
      window.location.reload();
    } else {
      // Wait until payment closes, then reload
      const poll = setInterval(function() {
        if (_isSafeToReload()) {
          clearInterval(poll);
          window.location.reload();
        }
      }, 1000);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE BANNER — slide-up, premium UI
  // ══════════════════════════════════════════════════════════════════
  function _showUpdateBanner(swReg) {
    if (_dismissed) return;
    // Throttle: don't re-show within 30 min of dismissal
    const dismissedAt = parseInt(localStorage.getItem(KEY.UPDATE_DISMISSED) || '0', 10);
    if (Date.now() - dismissedAt < 30 * 60 * 1000) return;

    if (_bannerEl) { _bannerEl.classList.add('pwa-ub--visible'); return; }

    _bannerEl = document.createElement('div');
    _bannerEl.id        = 'pwaUpdateBanner';
    _bannerEl.className = 'pwa-ub';
    _bannerEl.setAttribute('role', 'alertdialog');
    _bannerEl.setAttribute('aria-label', 'App update available');
    _bannerEl.innerHTML = `
      <div class="pwa-ub-inner">
        <div class="pwa-ub-dot"></div>
        <div class="pwa-ub-text">
          <span class="pwa-ub-title">🚀 New Version <span id="pwaUBVersion">v${APP.VERSION}</span></span>
          <span class="pwa-ub-sub">Download complete — ready to install</span>
        </div>
        <div class="pwa-ub-actions">
          <button class="pwa-ub-btn pwa-ub-btn--now"   id="pwaUBUpdateNow">Update Now</button>
          <button class="pwa-ub-btn pwa-ub-btn--later" id="pwaUBLater">Later</button>
          <button class="pwa-ub-btn pwa-ub-btn--x"     id="pwaUBDismiss" aria-label="Dismiss">✕</button>
        </div>
      </div>`;

    document.body.appendChild(_bannerEl);
    requestAnimationFrame(() => _bannerEl.classList.add('pwa-ub--visible'));

    document.getElementById('pwaUBUpdateNow').addEventListener('click', function() {
      _runUpdate(swReg);
    });
    document.getElementById('pwaUBLater').addEventListener('click', function() {
      _dismissed = true;
      localStorage.setItem(KEY.UPDATE_DISMISSED, String(Date.now()));
      _bannerEl.classList.remove('pwa-ub--visible');
      _track('update_deferred', { version: APP.VERSION });
    });
    document.getElementById('pwaUBDismiss').addEventListener('click', function() {
      _dismissed = true;
      localStorage.setItem(KEY.UPDATE_DISMISSED, String(Date.now()));
      _bannerEl.classList.remove('pwa-ub--visible');
      _track('update_dismissed', { version: APP.VERSION });
    });

    _track('update_banner_shown', { version: APP.VERSION });
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE PROGRESS DIALOG
  // ══════════════════════════════════════════════════════════════════
  const STEPS = [
    { label: 'Preparing update…',   pct: 15 },
    { label: 'Validating assets…',  pct: 35 },
    { label: 'Installing…',         pct: 60 },
    { label: 'Cleaning up cache…',  pct: 80 },
    { label: 'Finishing…',          pct: 95 },
    { label: 'Done ✓',              pct: 100 },
  ];

  function _showProgressDialog() {
    if (_progressEl) return;
    _progressEl = document.createElement('div');
    _progressEl.id        = 'pwaUpdateProgress';
    _progressEl.className = 'pwa-upd';
    _progressEl.setAttribute('role', 'dialog');
    _progressEl.setAttribute('aria-modal', 'true');
    _progressEl.setAttribute('aria-label', 'Installing update');
    _progressEl.innerHTML = `
      <div class="pwa-upd-card">
        <div class="pwa-upd-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3d8ef8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="pwa-upd-title">Updating Studyria</div>
        <div class="pwa-upd-step"  id="pwaUpdStep">Preparing update…</div>
        <div class="pwa-upd-track"><div class="pwa-upd-bar" id="pwaUpdBar" style="width:0%"></div></div>
        <div class="pwa-upd-pct"   id="pwaUpdPct">0%</div>
      </div>`;
    document.body.appendChild(_progressEl);
    requestAnimationFrame(() => _progressEl.classList.add('pwa-upd--visible'));
  }

  function _setProgress(step) {
    const s = STEPS[step] || STEPS[STEPS.length - 1];
    const stepEl = document.getElementById('pwaUpdStep');
    const barEl  = document.getElementById('pwaUpdBar');
    const pctEl  = document.getElementById('pwaUpdPct');
    if (stepEl) stepEl.textContent = s.label;
    if (barEl)  barEl.style.width  = s.pct + '%';
    if (pctEl)  pctEl.textContent  = s.pct + '%';
  }

  function _hideProgressDialog() {
    if (_progressEl) {
      _progressEl.classList.remove('pwa-upd--visible');
      setTimeout(() => { if (_progressEl) { _progressEl.remove(); _progressEl = null; } }, 400);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ASSET VALIDATION
  // ══════════════════════════════════════════════════════════════════
  async function _validateAssets() {
    const critical = ['/', '/manifest.json', '/sw.js'];
    try {
      const results = await Promise.all(
        critical.map(url =>
          fetch(url, { method: 'HEAD', cache: 'no-store' })
            .then(r => r.ok)
            .catch(() => false)
        )
      );
      return results.every(Boolean);
    } catch (_) {
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CACHE CLEANUP
  // ══════════════════════════════════════════════════════════════════
  async function _cleanupOldCaches() {
    if (!('caches' in window)) return;
    try {
      const keys = await caches.keys();
      const current = ['studyria-v30', 'studyria-img-v30', 'studyria-font-v30'];
      const old = keys.filter(k => k.startsWith('studyria-') && !current.includes(k));
      await Promise.all(old.map(k => caches.delete(k)));
      if (old.length) console.log('[Update] Removed old caches:', old);
    } catch (e) {
      console.warn('[Update] Cache cleanup failed:', e);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ONE-CLICK UPDATE FLOW
  // ══════════════════════════════════════════════════════════════════
  async function _runUpdate(swReg) {
    if (_updating) return;
    _updating = true;

    // Hide banner
    if (_bannerEl) _bannerEl.classList.remove('pwa-ub--visible');
    // Also hide old app.js banner if present
    document.getElementById('_pwaUpdateBanner')?.remove();
    document.getElementById('pwaV3UpdateBanner')?.classList.remove('pwa-update-banner--visible');

    _showProgressDialog();
    _track('update_started', { version: APP.VERSION });

    try {
      // Step 0 — Prepare
      _setProgress(0);
      await _sleep(400);

      // Step 1 — Validate assets
      _setProgress(1);
      const valid = await _validateAssets();
      if (!valid) {
        throw new Error('Asset validation failed — network may be offline');
      }
      await _sleep(350);

      // Step 2 — Activate new SW
      _setProgress(2);
      const sw = (swReg && swReg.waiting) || _waitingSW;
      if (sw) {
        sw.postMessage({ type: 'SKIP_WAITING' });
      }
      await _sleep(500);

      // Step 3 — Clean caches
      _setProgress(3);
      await _cleanupOldCaches();
      await _sleep(400);

      // Step 4 — Finishing
      _setProgress(4);
      await _sleep(350);

      // Step 5 — Done
      _setProgress(5);
      _track('update_success', { version: APP.VERSION });
      localStorage.setItem(KEY.INSTALLED_VERSION, APP.VERSION);

      await _sleep(700);
      _hideProgressDialog();

      // Reload safely
      _safeReload();

    } catch (err) {
      // ROLLBACK PROTECTION — never leave the app broken
      console.warn('[Update] Update failed, staying on current version:', err.message);
      _track('update_failed', { version: APP.VERSION, error: err.message });
      _hideProgressDialog();
      _updating = false;

      // Show friendly error
      _showToastMsg('⚠️ Update failed — continuing with current version', 'warn');
    }
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ══════════════════════════════════════════════════════════════════
  // WHAT'S NEW DIALOG
  // ══════════════════════════════════════════════════════════════════
  function _maybeShowWhatsNew() {
    const seen = localStorage.getItem(KEY.WHATS_NEW_SEEN);
    if (seen === APP.VERSION) return;

    const prevVersion = localStorage.getItem(KEY.INSTALLED_VERSION);
    // Only show if user has been here before (has a prev version stored)
    if (!prevVersion) {
      localStorage.setItem(KEY.INSTALLED_VERSION, APP.VERSION);
      localStorage.setItem(KEY.WHATS_NEW_SEEN, APP.VERSION);
      return;
    }
    // Only show if this is genuinely a newer version than what was stored
    if (!semverGt(APP.VERSION, prevVersion)) return;

    // Show after a short delay so app finishes loading
    setTimeout(_showWhatsNewDialog, 2500);
  }

  function _showWhatsNewDialog() {
    if (_whatsNewEl) return;

    const icons = { new: '✨', fix: '🐛', perf: '⚡', security: '🔒' };

    _whatsNewEl = document.createElement('div');
    _whatsNewEl.id        = 'pwaWhatsNewDialog';
    _whatsNewEl.className = 'pwa-wn';
    _whatsNewEl.setAttribute('role', 'dialog');
    _whatsNewEl.setAttribute('aria-modal', 'true');
    _whatsNewEl.setAttribute('aria-label', "What's new in Studyria");
    _whatsNewEl.innerHTML = `
      <div class="pwa-wn-backdrop" id="pwaWNBackdrop"></div>
      <div class="pwa-wn-card">
        <div class="pwa-wn-header">
          <div class="pwa-wn-rocket">🚀</div>
          <div>
            <div class="pwa-wn-htitle">What's New</div>
            <div class="pwa-wn-version">Studyria v${APP.VERSION} — ${APP.BUILD}</div>
          </div>
        </div>
        <ul class="pwa-wn-list">
          ${APP.WHATS_NEW.map(item => `
            <li class="pwa-wn-item pwa-wn-item--${item.type}">
              <span class="pwa-wn-ico">${icons[item.type] || '•'}</span>
              <span>${item.text}</span>
            </li>`).join('')}
        </ul>
        <button class="pwa-wn-close" id="pwaWNClose">Got it 👍</button>
      </div>`;

    document.body.appendChild(_whatsNewEl);
    requestAnimationFrame(() => _whatsNewEl.classList.add('pwa-wn--visible'));

    const close = function() {
      localStorage.setItem(KEY.WHATS_NEW_SEEN, APP.VERSION);
      localStorage.setItem(KEY.INSTALLED_VERSION, APP.VERSION);
      _whatsNewEl.classList.remove('pwa-wn--visible');
      setTimeout(() => { if (_whatsNewEl) { _whatsNewEl.remove(); _whatsNewEl = null; } }, 350);
    };
    document.getElementById('pwaWNClose').addEventListener('click', close);
    document.getElementById('pwaWNBackdrop').addEventListener('click', close);
    _track('whats_new_shown', { version: APP.VERSION });
  }

  // ══════════════════════════════════════════════════════════════════
  // CRITICAL / FORCE UPDATE (full-screen gate)
  // ══════════════════════════════════════════════════════════════════
  function _checkCriticalUpdate() {
    if (!APP.CRITICAL_MIN_VERSION) return false;
    const installed = localStorage.getItem(KEY.INSTALLED_VERSION) || '0.0.0';
    if (!semverGt(APP.CRITICAL_MIN_VERSION, installed)) return false;

    _forceEl = document.createElement('div');
    _forceEl.id        = 'pwaForceUpdate';
    _forceEl.className = 'pwa-force';
    _forceEl.setAttribute('role', 'alertdialog');
    _forceEl.setAttribute('aria-modal', 'true');
    _forceEl.innerHTML = `
      <div class="pwa-force-card">
        <div class="pwa-force-icon">🔒</div>
        <div class="pwa-force-title">Update Required</div>
        <div class="pwa-force-body">${APP.CRITICAL_MESSAGE}</div>
        <div class="pwa-force-version">Current: v${installed} → Required: v${APP.CRITICAL_MIN_VERSION}+</div>
        <button class="pwa-force-btn" id="pwaForceUpdateBtn">Update Now</button>
      </div>`;
    document.body.appendChild(_forceEl);

    document.getElementById('pwaForceUpdateBtn').addEventListener('click', function() {
      window.location.reload();
    });
    _track('force_update_shown', { installed, required: APP.CRITICAL_MIN_VERSION });
    return true;
  }

  // ══════════════════════════════════════════════════════════════════
  // VERSION DISPLAY — injects into Settings & About
  // ══════════════════════════════════════════════════════════════════
  function _injectVersionDisplay() {
    // We patch into the Me Settings tab via MutationObserver
    // (the tab is rendered dynamically via innerHTML in switchMeTab)
    const observer = new MutationObserver(function() {
      // Settings tab: inject below the delete account button area
      const settingsPanel = document.querySelector('.me-tab-panel');
      if (settingsPanel && !settingsPanel.querySelector('.pwa-version-block')) {
        _appendVersionBlock(settingsPanel);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also inject immediately if already rendered
    const existing = document.querySelector('.me-tab-panel');
    if (existing && !existing.querySelector('.pwa-version-block')) {
      _appendVersionBlock(existing);
    }
  }

  function _appendVersionBlock(panel) {
    const block = document.createElement('div');
    block.className = 'pwa-version-block';
    block.innerHTML = `
      <div class="pwa-version-card">
        <div class="pwa-version-row">
          <span class="pwa-version-label">App Version</span>
          <span class="pwa-version-val">v${APP.VERSION}</span>
        </div>
        <div class="pwa-version-row">
          <span class="pwa-version-label">Build</span>
          <span class="pwa-version-val" style="font-size:.72rem;opacity:.6">${APP.BUILD}</span>
        </div>
        <div class="pwa-version-row">
          <span class="pwa-version-label">PWA Status</span>
          <span class="pwa-version-val pwa-version-installed" id="pwaVersionStatus">Checking…</span>
        </div>
        <div class="pwa-version-actions">
          <button class="pwa-version-check-btn" onclick="window.studyriaUpdate.checkForUpdates()">
            ↺ Check for Updates
          </button>
          <button class="pwa-version-wn-btn" onclick="window.studyriaUpdate.showWhatsNew()">
            ✨ What's New
          </button>
        </div>
      </div>`;
    panel.appendChild(block);

    // Set PWA status
    const status = document.getElementById('pwaVersionStatus');
    if (status) {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                        || navigator.standalone === true;
      status.textContent = isStandalone ? '✓ Installed (PWA)' : 'Browser Mode';
      status.style.color = isStandalone ? '#10b981' : 'rgba(255,255,255,0.4)';
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // TOAST (fallback if showToast not defined)
  // ══════════════════════════════════════════════════════════════════
  function _showToastMsg(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type === 'warn' ? 'warning' : type);
      return;
    }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2744;color:#e4e8f0;padding:10px 18px;border-radius:10px;font-size:13px;z-index:99998;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid rgba(61,142,248,0.3)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ══════════════════════════════════════════════════════════════════
  // SW INTEGRATION
  // ══════════════════════════════════════════════════════════════════
  function _onSWReady(reg) {
    _swReg = reg;

    // Already waiting (update landed while tab was in background)
    if (reg.waiting) {
      _waitingSW = reg.waiting;
      _showUpdateBanner(reg);
    }

    reg.addEventListener('updatefound', function() {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', function() {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          _waitingSW = sw;
          _showUpdateBanner(reg);
        }
      });
    });
  }

  function _initSW() {
    if (!('serviceWorker' in navigator)) return;

    // Prefer the pwa:registered event from app.js
    window.addEventListener('pwa:registered', function(e) {
      if (e.detail?.registration) _onSWReady(e.detail.registration);
    }, { once: true });

    // Fallback: navigator.serviceWorker.ready
    navigator.serviceWorker.ready.then(_onSWReady).catch(() => {});

    // Also hook into existing pwaAppCenter if present — override its showUpdateCard
    const _origShowUpdateCard = window.pwaAppCenter?.showUpdateCard;
    if (window.pwaAppCenter) {
      const _orig = window.pwaAppCenter.applyUpdate;
      window.pwaAppCenter.applyUpdate = function() {
        if (_swReg) {
          _runUpdate(_swReg);
        } else if (typeof _orig === 'function') {
          _orig.call(window.pwaAppCenter);
        }
      };
    }

    // Listen for SW controller change
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      _hideProgressDialog();
      if (_isSafeToReload()) window.location.reload();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════
  window.studyriaUpdate = {
    VERSION: APP.VERSION,
    BUILD:   APP.BUILD,

    checkForUpdates: async function() {
      if (!_swReg) {
        _showToastMsg('ℹ️ Service worker not active', 'info');
        return;
      }
      _showToastMsg('🔄 Checking for updates…', 'info');
      try {
        await _swReg.update();
        await _sleep(1800);
        if (_waitingSW) {
          _showUpdateBanner(_swReg);
        } else {
          _showToastMsg('✓ Studyria is up to date!', 'success');
        }
      } catch (e) {
        _showToastMsg('⚠️ Update check failed — try again', 'warn');
      }
    },

    showWhatsNew: function() {
      // Force show even if already seen
      localStorage.removeItem(KEY.WHATS_NEW_SEEN);
      _showWhatsNewDialog();
    },

    applyUpdate: function() {
      if (_swReg) _runUpdate(_swReg);
    },

    getVersion: function() {
      return { version: APP.VERSION, build: APP.BUILD };
    },

    getAnalytics: function() {
      return JSON.parse(localStorage.getItem(KEY.ANALYTICS) || '[]');
    },
  };

  // ══════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════
  function init() {
    // 1. Critical force-update check
    if (_checkCriticalUpdate()) return;  // Block app until updated

    // 2. SW integration
    _initSW();

    // 3. What's New dialog (only on actual version bump)
    _maybeShowWhatsNew();

    // 4. Version display in Settings tab (MutationObserver)
    _injectVersionDisplay();

    // 5. Run cache cleanup on idle
    if ('requestIdleCallback' in window) {
      requestIdleCallback(_cleanupOldCaches, { timeout: 15000 });
    } else {
      setTimeout(_cleanupOldCaches, 10000);
    }

    console.log('[StudyriaUpdate] v' + APP.VERSION + ' initialized ✅');
  }

  // Boot on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
