
/* ══════════════════════════════════════════════════════════════════
   PWA APP CENTER ENGINE  v2.0  — Studyria Smart App Center
   Handles: SW registration, install prompt, update detection,
   update UI, restart flow, check-for-updates, cache versioning,
   PWA Diagnostics panel.
   ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  let _swReg        = null;   // ServiceWorkerRegistration
  let _waitingSW    = null;   // new SW waiting to take over
  let _installEvt   = null;   // beforeinstallprompt event
  let _isInstalled  = false;  // running as standalone PWA
  let _updateDismissed = false;
  let _swStatus     = 'not-supported'; // for diagnostics
  let _manifestOk   = false;           // for diagnostics
  let _currentVer   = '—';            // SW reported version

  // Detect standalone (installed) mode — covers Android, iOS, Desktop
  // ✅ display-mode media queries   (Chrome, Edge, Samsung Internet, Firefox)
  // ✅ navigator.standalone === true (iOS Safari Add-to-Home-Screen)
  // ✅ android-app:// referrer      (Android TWA / WebAPK)
  // ❌ NOT ?source=pwa URL param — the manifest start_url uses this param,
  //    so it fires even when opening the site in a normal browser tab.
  function detectStandalone() {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    if (window.navigator.standalone === true) return true;           // iOS Safari
    if (document.referrer.startsWith('android-app://')) return true; // TWA
    return false;
  }
  _isInstalled = detectStandalone();

  // Check manifest link validity
  (function checkManifest() {
    const link = document.querySelector('link[rel="manifest"]');
    _manifestOk = !!(link && link.href);
  })();

  // ── Helpers ────────────────────────────────────────────────────
  function show(id)  { const el = document.getElementById(id); if(el) el.style.display = ''; }
  function hide(id)  { const el = document.getElementById(id); if(el) el.style.display = 'none'; }
  function setText(id, txt) { const el = document.getElementById(id); if(el) el.textContent = txt; }
  function setCheckBtn(state) {
    ['pwaHmCheckBtn','pwaHmCheckBtn2'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.className = 'pwa-check-btn' + (state ? ' '+state : '');
      btn.textContent = state === 'checking' ? '⟳ Checking…'
                      : state === 'up-to-date' ? '✓ Up to date'
                      : '↻ Check';
      btn.disabled = (state === 'checking' || state === 'up-to-date');
    });
  }
  function setCheckTxt(txt) {
    ['pwaHmCheckTxt','pwaHmCheckTxt2'].forEach(id => setText(id, txt));
  }

  // ── PWA Diagnostics renderer ──────────────────────────────────
  function renderDiagnostics() {
    const el = document.getElementById('pwaDiagPanel');
    if (!el) return;
    const swOk = (_swStatus === 'active' || _swStatus === 'registered');
    const rows = [
      ['🔧 Service Worker', swOk ? '✅ ' + _swStatus : '❌ ' + _swStatus],
      ['📄 Manifest', _manifestOk ? '✅ Linked & valid' : '❌ Not found'],
      ['📲 Installable', _installEvt ? '✅ Yes' : (_isInstalled ? '— Already installed' : '❌ No prompt')],
      ['✅ Installed', _isInstalled ? '✅ Yes (standalone)' : '❌ No (browser tab)'],
      ['🏷️ Current Version', _currentVer],
      ['⬆️ Update Available', _waitingSW ? '✅ Yes — update ready' : '❌ None detected'],
    ];
    el.innerHTML = `
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:10px">🔍 PWA Diagnostics</div>
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        ${rows.map(([k,v])=>`
          <tr>
            <td style="padding:5px 8px;color:var(--text2);white-space:nowrap">${k}</td>
            <td style="padding:5px 8px;color:var(--text);font-weight:500">${v}</td>
          </tr>`).join('')}
      </table>
      <button onclick="window.pwaAppCenter.refreshDiagnostics()" style="margin-top:8px;font-size:.72rem;padding:4px 10px;border-radius:6px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer">↻ Refresh</button>
    `;
  }

  // ── Render install / installed card ───────────────────────────
  function renderInstallCard() {
    if (_isInstalled) {
      // Browser confirms the app is running in standalone mode → installed
      hide('pwaHmInstallCard');
      show('pwaHmInstalledCard');
      // Also hide the install button in case pwaHmInstallCard is still visible
      var installBtn = document.getElementById('pwaHmInstallBtn');
      if (installBtn) installBtn.style.display = 'none';
    } else {
      show('pwaHmInstallCard');
      hide('pwaHmInstalledCard');
      // Only show install button when the native prompt is available
      var installBtn = document.getElementById('pwaHmInstallBtn');
      if (installBtn) {
        if (_installEvt || window._pwaInstallPrompt) {
          installBtn.style.display = '';
          installBtn.textContent = 'INSTALL';
          installBtn.disabled = false;
        } else {
          // No prompt yet — hide button silently; app.js will show it when ready
          installBtn.style.display = 'none';
        }
      }
    }
    renderDiagnostics();
  }

  // ── Show update card with dynamic What's New from SW ────────────
  function fetchWhatsNew(sw, callback) {
    try {
      const mc = new MessageChannel();
      mc.port1.onmessage = function(e) {
        const data = e.data || {};
        // Update version display from SW build label
        if (data.version || data.build) {
          _currentVer = data.version || data.build;
          renderDiagnostics();
        }
        callback(data.whatsNew || null);
      };
      sw.postMessage({ type: 'GET_VERSION' }, [mc.port2]);
      setTimeout(function() { callback(null); }, 2000); // fallback timeout
    } catch(e) { callback(null); }
  }

  // ── Show update card ──────────────────────────────────────────
  function showUpdateCard(whatsNew) {
    if (_updateDismissed) return;
    const wn = document.getElementById('pwaWhatsNew');
    if (wn) wn.textContent = whatsNew || '✨ Bug fixes, performance improvements and new features.';
    show('pwaHmUpdateCard');
    hide('pwaHmRestartCard');
  }

  // ── Public API ─────────────────────────────────────────────────
  window.pwaAppCenter = {

    install: function() {
      // Delegate entirely to app.js — it owns beforeinstallprompt and the
      // single deferredPrompt instance. Never call prompt() from here.
      if (window.PWA && typeof window.PWA.promptInstall === 'function') {
        window.PWA.promptInstall();
      }
    },

    refreshDiagnostics: function() {
      _isInstalled = detectStandalone();
      renderInstallCard();
      renderDiagnostics();
    },

    checkForUpdates: async function() {
      if (!_swReg) {
        if (typeof showToast === 'function') showToast('ℹ️ Service worker not active', 'info');
        return;
      }
      setCheckBtn('checking');
      setCheckTxt('Checking for updates…');
      try {
        await _swReg.update();
        // Give SW 2s to detect a new version
        await new Promise(r => setTimeout(r, 2000));
        if (_waitingSW) {
          setCheckBtn('');
          setCheckTxt('Update found!');
          showUpdateCard();
        } else {
          setCheckBtn('up-to-date');
          setCheckTxt('Already up to date ✓');
          setTimeout(() => { setCheckBtn(''); setCheckTxt('Check for new updates'); }, 3500);
        }
      } catch(e) {
        setCheckBtn('');
        setCheckTxt('Check failed — try again');
        setTimeout(() => setCheckTxt('Check for new updates'), 3000);
      }
    },

    applyUpdate: function() {
      if (!_waitingSW) return;
      _waitingSW.postMessage({ type: 'SKIP_WAITING' });
      hide('pwaHmUpdateCard');
      show('pwaHmRestartCard');
    },

    dismissUpdate: function() {
      _updateDismissed = true;
      hide('pwaHmUpdateCard');
    },

    restart: function() {
      window.location.reload();
    }
  };

  // ── beforeinstallprompt ────────────────────────────────────────
  // The canonical beforeinstallprompt listener lives ABOVE this IIFE (see
  // "PWA INSTALL Feature 6" block).  pwaAppCenter subscribes to the custom
  // event it dispatches so _installEvt stays in sync without a second
  // native listener — this avoids any risk of the event being preventDefault()'d
  // twice or the prompt reference splitting between two owners.
  window.addEventListener('pwa:installable', function(e) {
    _installEvt = e.detail.prompt;
    // window._pwaInstallPrompt is already set by the outer listener.
    renderInstallCard();
  });

  // appinstalled is handled exclusively by app.js (window.PWA).
  // Subscribe to its custom event to keep _isInstalled in sync.
  window.addEventListener('pwa:installed', function() {
    _installEvt = null;
    _isInstalled = true;
    renderInstallCard();
  });

  // ── Service Worker registration ────────────────────────────────
  // Guard: app.js also registers /sw.js; reuse existing registration if
  // it already exists to avoid concurrent installs at the same scope.
  if ('serviceWorker' in navigator) {
    _swStatus = 'registering';
    window.addEventListener('load', function() {
      var _doRegister = function(existingReg) {
        if (existingReg) {
          console.log('[PWA] SW already registered — reusing in pwaAppCenter');
          return Promise.resolve(existingReg);
        }
        return navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
      };
      navigator.serviceWorker.getRegistration('/')
        .then(_doRegister)
        .then(function(reg) {
          _swReg = reg;
          _swStatus = 'registered';
          console.log('✅ Service Worker Registered');

          // Get version from active SW
          if (reg.active) {
            _swStatus = 'active';
            fetchWhatsNew(reg.active, function(_wn) {
              // version captured inside fetchWhatsNew via e.data.version
              renderDiagnostics();
            });
          }

          // Already waiting (page loaded after update downloaded)
          if (reg.waiting) {
            _waitingSW = reg.waiting;
            fetchWhatsNew(reg.waiting, function(wn) { showUpdateCard(wn); });
          }

          renderDiagnostics();

          // New SW installing → watch for it to go waiting
          reg.addEventListener('updatefound', function() {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', function() {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                _waitingSW = installing;
                fetchWhatsNew(installing, function(wn) { showUpdateCard(wn); });
              }
            });
          });

          // SW controller changed → update is live
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            // IMPORTANT: Do NOT auto-reload. Show the restart card so the user
            // can save work and reload at their convenience.
            if (_waitingSW) {
              hide('pwaHmUpdateCard');
              show('pwaHmRestartCard');
              if (typeof showToast === 'function') {
                showToast('✅ Update applied! Restart to finish.', 'success');
              }
              _waitingSW = null;
            }
          });
        })
        .catch(function(err) {
          _swStatus = 'failed';
          console.warn('SW registration failed:', err);
          renderDiagnostics();
        });
    });
  } else {
    _swStatus = 'not-supported';
  }

  // ── Init: render correct card state immediately on DOM ready ──────────────
  // renderInstallCard() now always shows the install card when not installed,
  // so we call it immediately — no need to defer for beforeinstallprompt.
  function initRender() {
    renderInstallCard();
    renderDiagnostics();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRender);
  } else {
    initRender();
  }

})();
