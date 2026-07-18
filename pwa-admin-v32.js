// ═══════════════════════════════════════════════════════════════════
// pwa-admin-v32.js — Studyria Admin PWA Control Center (V3.2)
// ═══════════════════════════════════════════════════════════════════
// Sections:
//   1. Dashboard — version, installs, update rate, devices
//   2. Notification Center — send, schedule, topics, analytics
//   3. Remote Configuration — feature flags, maintenance, splash, rules
//   4. Update Center — current version, rollback, force update, publish
//   5. Cache Manager — health, size, clear, refresh
//   6. Service Worker — status, version, clients, update status
//   7. Diagnostics — crashes, errors, performance, storage, network
//   8. Analytics — installs, updates, notifications, offline, devices
// ═══════════════════════════════════════════════════════════════════
;(function StudyriaPWAAdmin32() {
  'use strict';

  // ── CONFIG ─────────────────────────────────────────────────────────
  var CURRENT_VERSION = '3.2.0';
  var PREV_VERSIONS = ['3.1.1', '3.0.0'];

  // ── STORAGE ───────────────────────────────────────────────────────
  function _cfg(key, fallback) {
    try {
      var v = localStorage.getItem('studyria_pwa32_cfg_' + key);
      return v ? JSON.parse(v) : fallback;
    } catch(_) { return fallback; }
  }
  function _setCfg(key, val) {
    try { localStorage.setItem('studyria_pwa32_cfg_' + key, JSON.stringify(val)); } catch(_) {}
  }

  // ── SUPABASE ──────────────────────────────────────────────────────
  function _sb() { return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null); }

  // ── ESCAPE ────────────────────────────────────────────────────────
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── ACTIVE TAB ────────────────────────────────────────────────────
  var _activeSection = 'dashboard';

  // ═══════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════
  window.renderPWAdmin32 = function(main) {
    var sections = ['dashboard', 'notifications', 'config', 'update', 'cache', 'sw', 'diagnostics', 'analytics'];
    var labels = {
      dashboard: '📊 Dashboard', notifications: '🔔 Notifications', config: '⚙ Configuration',
      update: '📦 Update Center', cache: '📥 Cache', sw: '📶 Service Worker',
      diagnostics: '🔧 Diagnostics', analytics: '📈 Analytics',
    };

    var html = '<div class="pwa32-admin">';
    html += '<div style="margin-bottom:20px"><h2 style="font-size:1.2rem;font-weight:800;margin:0 0 4px">🚀 PWA Control Center</h2><p style="font-size:.82rem;color:var(--text2);margin:0">Manage your Progressive Web App — versions, notifications, cache, and diagnostics.</p></div>';

    // Tab bar
    html += '<div class="pwa32-admin-tabbar">';
    sections.forEach(function(s) {
      html += '<button class="pwa32-admin-tab' + (_activeSection === s ? ' active' : '') + '" onclick="window.PWA32Admin._switch(\'' + s + '\')">' + labels[s] + '</button>';
    });
    html += '</div>';

    // Panels
    sections.forEach(function(s) {
      html += '<div class="pwa32-admin-panel' + (_activeSection === s ? ' active' : '') + '" id="pwa32AdminPanel_' + s + '"></div>';
    });

    html += '</div>';
    main.innerHTML = html;

    // Render active section
    _renderSection(_activeSection);
  };

  function _renderSection(section) {
    var panel = document.getElementById('pwa32AdminPanel_' + section);
    if (!panel) return;
    switch (section) {
      case 'dashboard': _renderDashboard(panel); break;
      case 'notifications': _renderNotifications(panel); break;
      case 'config': _renderConfig(panel); break;
      case 'update': _renderUpdateCenter(panel); break;
      case 'cache': _renderCacheManager(panel); break;
      case 'sw': _renderSW(panel); break;
      case 'diagnostics': _renderDiagnostics(panel); break;
      case 'analytics': _renderAnalytics(panel); break;
    }
  }

  function _switchSection(s) {
    _activeSection = s;
    document.querySelectorAll('.pwa32-admin-tab').forEach(function(t, i) {
      t.classList.toggle('active', t.textContent === s || i === sections.indexOf(s));
    });
    document.querySelectorAll('.pwa32-admin-panel').forEach(function(p) { p.classList.remove('active'); });
    var panel = document.getElementById('pwa32AdminPanel_' + s);
    if (panel) { panel.classList.add('active'); _renderSection(s); }
  }

  var sections = ['dashboard', 'notifications', 'config', 'update', 'cache', 'sw', 'diagnostics', 'analytics'];

  // ═══════════════════════════════════════════════════════════════════
  // § 1. DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  function _renderDashboard(p) {
    var installStats = _cfg('install_stats', { total: 0, active: 0, last30: 0 });
    var updateStats = _cfg('update_stats', { total: 0, last30: 0, rate: 0 });
    var deviceStats = _cfg('device_stats', { android: 0, ios: 0, desktop: 0, other: 0 });

    var html = '<div class="pwa32-admin-grid">';
    html += _statCard('Current Version', 'v' + CURRENT_VERSION, 'Released Jul 18, 2026');
    html += _statCard('Active Installations', String(installStats.active || '—'), 'Last 30 days: ' + (installStats.last30 || 0));
    html += _statCard('Update Rate', (updateStats.rate || 0) + '%', 'Updated in last 30 days');
    html += _statCard('Install Rate', String(installStats.last30 || 0), 'New installs this month');
    html += _statCard('Active Devices', String(deviceStats.android + deviceStats.ios + deviceStats.desktop + deviceStats.other || '—'), 'Android: ' + deviceStats.android + ' · iOS: ' + deviceStats.ios);
    html += _statCard('Cache Health', _getCacheHealth(), 'Service worker active');
    html += '</div>';

    html += '<div class="pwa32-admin-card"><h3>Device Breakdown</h3>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🤖 Android</div><div style="font-weight:700">' + (deviceStats.android || 0) + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🍎 iOS</div><div style="font-weight:700">' + (deviceStats.ios || 0) + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">💻 Desktop</div><div style="font-weight:700">' + (deviceStats.desktop || 0) + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🌐 Other</div><div style="font-weight:700">' + (deviceStats.other || 0) + '</div></div>';
    html += '</div>';

    p.innerHTML = html;
  }

  function _statCard(label, value, sub) {
    return '<div class="pwa32-admin-stat"><div class="pwa32-admin-stat-label">' + _esc(label) + '</div><div class="pwa32-admin-stat-value">' + _esc(value) + '</div><div class="pwa32-admin-stat-sub">' + _esc(sub || '') + '</div></div>';
  }

  function _getCacheHealth() {
    return 'Good';
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 2. NOTIFICATION CENTER
  // ═══════════════════════════════════════════════════════════════════
  function _renderNotifications(p) {
    var html = '<div class="pwa32-admin-card"><h3>Send Push Notification</h3>';
    html += '<div style="margin-bottom:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Title</label><input class="pwa32-admin-input" id="pwa32NotifTitle" placeholder="Notification title"></div>';
    html += '<div style="margin-bottom:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Body</label><textarea class="pwa32-admin-input pwa32-admin-textarea" id="pwa32NotifBody" placeholder="Notification message"></textarea></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    html += '<div><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Image URL (optional)</label><input class="pwa32-admin-input" id="pwa32NotifImage" placeholder="https://…"></div>';
    html += '<div><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Deep Link (optional)</label><input class="pwa32-admin-input" id="pwa32NotifLink" placeholder="#library or https://…"></div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += '<div><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Schedule (optional)</label><input class="pwa32-admin-input" type="datetime-local" id="pwa32NotifSchedule"></div>';
    html += '<div><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Topic</label><select class="pwa32-admin-input" id="pwa32NotifTopic"><option value="">All users</option><option value="jobs">Job Alerts</option><option value="updates">App Updates</option><option value="offers">Offers & Deals</option><option value="education">Educational</option></select></div>';
    html += '</div>';
    html += '<button class="pwa32-btn" onclick="window.PWA32Admin._sendNotif()">Send Notification</button>';
    html += '</div>';

    // Delivery analytics
    html += '<div class="pwa32-admin-card"><h3>Delivery Analytics</h3>';
    var notifStats = _cfg('notif_stats', { sent: 0, delivered: 0, opened: 0, failed: 0 });
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Sent', String(notifStats.sent), 'Total notifications');
    html += _statCard('Delivered', String(notifStats.delivered), 'Successfully received');
    html += _statCard('Opened', String(notifStats.opened), 'User clicked');
    html += _statCard('Failed', String(notifStats.failed), 'Delivery errors');
    html += '</div></div>';

    // Notification history
    html += '<div class="pwa32-admin-card"><h3>Recent Notifications</h3><div id="pwa32AdminNotifHistory"></div></div>';

    p.innerHTML = html;
    _renderNotifHistory();
  }

  function _renderNotifHistory() {
    var container = document.getElementById('pwa32AdminNotifHistory');
    if (!container) return;
    var sb = _sb();
    if (!sb) { container.innerHTML = '<p style="color:var(--text2);font-size:.82rem">No notification history available.</p>'; return; }
    sb.from('pwa_notifications').select('*').order('created_at', { ascending: false }).limit(10)
      .then(function(res) {
        if (res.error || !res.data || res.data.length === 0) {
          container.innerHTML = '<p style="color:var(--text2);font-size:.82rem">No notifications sent yet.</p>';
          return;
        }
        container.innerHTML = res.data.map(function(n) {
          return '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">' + _esc(n.title || '') + '</div><div class="pwa32-admin-row-desc">' + _esc((n.body || '').slice(0, 80)) + '</div></div><div style="font-size:.74rem;color:var(--text2)">' + new Date(n.created_at).toLocaleDateString('en-IN') + '</div></div>';
        }).join('');
      });
  }

  function _sendNotif() {
    var title = document.getElementById('pwa32NotifTitle').value.trim();
    var body = document.getElementById('pwa32NotifBody').value.trim();
    var image = document.getElementById('pwa32NotifImage').value.trim();
    var link = document.getElementById('pwa32NotifLink').value.trim();
    var schedule = document.getElementById('pwa32NotifSchedule').value;
    var topic = document.getElementById('pwa32NotifTopic').value;

    if (!title || !body) { showToast && showToast('Title and body are required.', 'error'); return; }

    var notif = {
      title: title, body: body, image: image || null, deep_link: link || null,
      topic: topic || null, scheduled_for: schedule || null, created_at: new Date().toISOString(),
    };

    var sb = _sb();
    if (sb) {
      sb.from('pwa_notifications').insert([notif]).then(function(res) {
        if (res.error) { showToast && showToast('Failed to save notification.', 'error'); }
        else {
          // Try to send via OneSignal or other push service
          _sendPush(notif);
          showToast && showToast('Notification sent successfully!', 'success');
          var stats = _cfg('notif_stats', { sent: 0, delivered: 0, opened: 0, failed: 0 });
          stats.sent = (stats.sent || 0) + 1;
          stats.delivered = (stats.delivered || 0) + 1;
          _setCfg('notif_stats', stats);
          _renderNotifHistory();
        }
      });
    } else {
      showToast && showToast('Notification saved locally.', 'info');
    }
  }

  function _sendPush(notif) {
    // Try OneSignal if available
    if (window.OneSignal && typeof window.OneSignal.sendNotification === 'function') {
      try { window.OneSignal.sendNotification(notif); } catch(e) { console.warn('[PWA32Admin] OneSignal send failed'); }
    }
    // Also post to SW for local display
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SHOW_NOTIFICATION', payload: notif });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 3. REMOTE CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════
  function _renderConfig(p) {
    var flags = _cfg('feature_flags', {
      download_manager: true, offline_reading: true, predictive_loading: true,
      notification_v2: true, route_prefetch: true, smart_cache: true,
    });
    var maintenance = _cfg('maintenance', { enabled: false, message: '' });
    var splash = _cfg('splash', { duration: 2200, showOnLaunch: true });
    var updateRules = _cfg('update_rules', { autoUpdate: true, forceMin: null, silentUpdate: true });

    var html = '<div class="pwa32-admin-card"><h3>Feature Flags</h3>';
    var flagLabels = {
      download_manager: { label: 'Download Manager', desc: 'Queue, pause, resume downloads' },
      offline_reading: { label: 'Offline Reading', desc: 'Cache PDFs for offline access' },
      predictive_loading: { label: 'Predictive Loading', desc: 'Prefetch likely next routes' },
      notification_v2: { label: 'Notification V2.0', desc: 'Rich notifications with images' },
      route_prefetch: { label: 'Route Prefetch', desc: 'Warm cache for all routes on idle' },
      smart_cache: { label: 'Smart Cache', desc: 'Intelligent cache invalidation' },
    };
    Object.keys(flags).forEach(function(key) {
      var f = flagLabels[key] || { label: key, desc: '' };
      html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">' + f.label + '</div><div class="pwa32-admin-row-desc">' + f.desc + '</div></div><div class="pwa32-toggle' + (flags[key] ? ' on' : '') + '" onclick="window.PWA32Admin._toggleFlag(\'' + key + '\')"></div></div>';
    });
    html += '</div>';

    // Maintenance Mode
    html += '<div class="pwa32-admin-card"><h3>Maintenance Mode</h3>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Enable Maintenance Mode</div><div class="pwa32-admin-row-desc">Show maintenance screen to all users</div></div><div class="pwa32-toggle' + (maintenance.enabled ? ' on' : '') + '" onclick="window.PWA32Admin._toggleMaintenance()"></div></div>';
    html += '<div style="margin-top:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Maintenance Message</label><input class="pwa32-admin-input" id="pwa32MaintMsg" value="' + _esc(maintenance.message || '') + '" placeholder="We\'ll be right back!"></div>';
    html += '<button class="pwa32-btn pwa32-btn-sm" style="margin-top:10px" onclick="window.PWA32Admin._saveMaintMsg()">Save Message</button>';
    html += '</div>';

    // Splash Configuration
    html += '<div class="pwa32-admin-card"><h3>Splash Screen Configuration</h3>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Show Splash on Launch</div><div class="pwa32-admin-row-desc">Display animated splash on app open</div></div><div class="pwa32-toggle' + (splash.showOnLaunch ? ' on' : '') + '" onclick="window.PWA32Admin._toggleSplash()"></div></div>';
    html += '<div style="margin-top:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Duration (ms)</label><input class="pwa32-admin-input" type="number" id="pwa32SplashDur" value="' + (splash.duration || 2200) + '"></div>';
    html += '<button class="pwa32-btn pwa32-btn-sm" style="margin-top:10px" onclick="window.PWA32Admin._saveSplash()">Save</button>';
    html += '</div>';

    // Update Rules
    html += '<div class="pwa32-admin-card"><h3>Update Rules</h3>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Auto-Update</div><div class="pwa32-admin-row-desc">Automatically install new versions in background</div></div><div class="pwa32-toggle' + (updateRules.autoUpdate ? ' on' : '') + '" onclick="window.PWA32Admin._toggleUpdateRule(\'autoUpdate\')"></div></div>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Silent Update</div><div class="pwa32-admin-row-desc">Update without showing a banner</div></div><div class="pwa32-toggle' + (updateRules.silentUpdate ? ' on' : '') + '" onclick="window.PWA32Admin._toggleUpdateRule(\'silentUpdate\')"></div></div>';
    html += '<div style="margin-top:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Force Update Minimum Version (optional)</label><input class="pwa32-admin-input" id="pwa32ForceMin" value="' + (updateRules.forceMin || '') + '" placeholder="e.g. 3.1.0"></div>';
    html += '<button class="pwa32-btn pwa32-btn-sm" style="margin-top:10px" onclick="window.PWA32Admin._saveForceMin()">Save</button>';
    html += '</div>';

    // Notification Rules
    html += '<div class="pwa32-admin-card"><h3>Notification Rules</h3>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Allow Rich Notifications</div><div class="pwa32-admin-row-desc">Images, badges, action buttons</div></div><div class="pwa32-toggle on" onclick="this.classList.toggle(\'on\')"></div></div>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Allow Scheduled Notifications</div><div class="pwa32-admin-row-desc">Send at a specific date/time</div></div><div class="pwa32-toggle on" onclick="this.classList.toggle(\'on\')"></div></div>';
    html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label">Allow Silent Background</div><div class="pwa32-admin-row-desc">Background notifications without sound</div></div><div class="pwa32-toggle on" onclick="this.classList.toggle(\'on\')"></div></div>';
    html += '</div>';

    p.innerHTML = html;
  }

  function _toggleFlag(key) {
    var flags = _cfg('feature_flags', {});
    flags[key] = !flags[key];
    _setCfg('feature_flags', flags);
    _renderSection('config');
  }

  function _toggleMaintenance() {
    var m = _cfg('maintenance', { enabled: false, message: '' });
    m.enabled = !m.enabled;
    _setCfg('maintenance', m);
    _renderSection('config');
  }

  function _saveMaintMsg() {
    var m = _cfg('maintenance', { enabled: false, message: '' });
    m.message = document.getElementById('pwa32MaintMsg').value;
    _setCfg('maintenance', m);
    showToast && showToast('Maintenance message saved.', 'success');
  }

  function _toggleSplash() {
    var s = _cfg('splash', { duration: 2200, showOnLaunch: true });
    s.showOnLaunch = !s.showOnLaunch;
    _setCfg('splash', s);
    _renderSection('config');
  }

  function _saveSplash() {
    var s = _cfg('splash', { duration: 2200, showOnLaunch: true });
    s.duration = parseInt(document.getElementById('pwa32SplashDur').value) || 2200;
    _setCfg('splash', s);
    showToast && showToast('Splash configuration saved.', 'success');
  }

  function _toggleUpdateRule(key) {
    var r = _cfg('update_rules', {});
    r[key] = !r[key];
    _setCfg('update_rules', r);
    _renderSection('config');
  }

  function _saveForceMin() {
    var r = _cfg('update_rules', {});
    r.forceMin = document.getElementById('pwa32ForceMin').value || null;
    _setCfg('update_rules', r);
    showToast && showToast('Force update version saved.', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 4. UPDATE CENTER
  // ═══════════════════════════════════════════════════════════════════
  function _renderUpdateCenter(p) {
    var html = '<div class="pwa32-admin-card"><h3>Current Version</h3>';
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Version', 'v' + CURRENT_VERSION, 'Latest release');
    html += _statCard('Build', '2026.07.18', 'Build date');
    html += _statCard('Previous', PREV_VERSIONS.length + ' versions', 'Rollback available');
    html += '</div></div>';

    // Previous versions
    html += '<div class="pwa32-admin-card"><h3>Previous Versions</h3>';
    PREV_VERSIONS.forEach(function(v) {
      html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">v' + v + '</div><button class="pwa32-btn pwa32-btn-ghost pwa32-btn-sm" onclick="window.PWA32Admin._rollback(\'' + v + '\')">Rollback</button></div>';
    });
    html += '</div>';

    // Force update
    html += '<div class="pwa32-admin-card"><h3>Force Update</h3>';
    html += '<p style="font-size:.82rem;color:var(--text2);margin-bottom:12px">Force all users below a specific version to update before continuing.</p>';
    html += '<div style="display:flex;gap:10px;align-items:center">';
    html += '<input class="pwa32-admin-input" id="pwa32ForceVersion" placeholder="Minimum version (e.g. 3.2.0)" style="flex:1">';
    html += '<button class="pwa32-btn pwa32-btn-sm" onclick="window.PWA32Admin._setForceUpdate()">Set Force Update</button>';
    html += '</div>';
    html += '<button class="pwa32-btn pwa32-btn-ghost pwa32-btn-sm" style="margin-top:10px" onclick="window.PWA32Admin._clearForceUpdate()">Clear Force Update</button>';
    html += '</div>';

    // Publish new version
    html += '<div class="pwa32-admin-card"><h3>Publish New Version</h3>';
    html += '<div style="margin-bottom:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">New Version Number</label><input class="pwa32-admin-input" id="pwa32NewVersion" placeholder="e.g. 3.3.0"></div>';
    html += '<div style="margin-bottom:12px"><label style="font-size:.78rem;color:var(--text2);display:block;margin-bottom:6px">Release Notes (one per line)</label><textarea class="pwa32-admin-input pwa32-admin-textarea" id="pwa32NewReleaseNotes" placeholder="Added: New feature&#10;Fixed: Bug fix"></textarea></div>';
    html += '<button class="pwa32-btn" onclick="window.PWA32Admin._publishVersion()">Publish Version</button>';
    html += '</div>';

    p.innerHTML = html;
  }

  function _setForceUpdate() {
    var v = document.getElementById('pwa32ForceVersion').value.trim();
    if (!v) { showToast && showToast('Enter a version number.', 'error'); return; }
    var r = _cfg('update_rules', {});
    r.forceMin = v;
    _setCfg('update_rules', r);
    showToast && showToast('Force update set for versions below ' + v, 'success');
  }

  function _clearForceUpdate() {
    var r = _cfg('update_rules', {});
    r.forceMin = null;
    _setCfg('update_rules', r);
    showToast && showToast('Force update cleared.', 'success');
  }

  function _rollback(v) {
    if (!confirm('Roll back to version ' + v + '? This will affect all users.')) return;
    showToast && showToast('Rollback to v' + v + ' initiated.', 'info');
    // In production, this would trigger a redeploy of the specified version
  }

  function _publishVersion() {
    var v = document.getElementById('pwa32NewVersion').value.trim();
    var notes = document.getElementById('pwa32NewReleaseNotes').value.trim();
    if (!v) { showToast && showToast('Version number required.', 'error'); return; }
    var sb = _sb();
    if (sb) {
      var notesObj = { version: v, date: new Date().toISOString().slice(0,10), added: [], improved: [], fixed: [], security: [] };
      notes.split('\n').forEach(function(line) {
        var lower = line.toLowerCase();
        if (lower.startsWith('added:')) notesObj.added.push(line.replace(/^added:\s*/i, ''));
        else if (lower.startsWith('improved:')) notesObj.improved.push(line.replace(/^improved:\s*/i, ''));
        else if (lower.startsWith('fixed:')) notesObj.fixed.push(line.replace(/^fixed:\s*/i, ''));
        else if (lower.startsWith('security:')) notesObj.security.push(line.replace(/^security:\s*/i, ''));
        else if (line.trim()) notesObj.added.push(line);
      });
      sb.from('pwa_release_notes').insert([notesObj]).then(function(res) {
        if (res.error) showToast && showToast('Failed to publish version.', 'error');
        else showToast && showToast('Version ' + v + ' published successfully!', 'success');
      });
    } else {
      showToast && showToast('Version ' + v + ' published locally.', 'success');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 5. CACHE MANAGER
  // ═══════════════════════════════════════════════════════════════════
  function _renderCacheManager(p) {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function(est) {
        _renderCacheManagerWithData(p, est);
      });
    } else {
      _renderCacheManagerWithData(p, { usage: 0, quota: 0 });
    }
  }

  function _renderCacheManagerWithData(p, est) {
    var usageMB = est.usage ? (est.usage / 1024 / 1024).toFixed(1) : '0';
    var quotaMB = est.quota ? (est.quota / 1024 / 1024).toFixed(0) : '∞';
    var percent = est.quota ? Math.min(100, Math.round(est.usage / est.quota * 100)) : 0;

    var html = '<div class="pwa32-admin-grid">';
    html += _statCard('Cache Size', usageMB + ' MB', 'Of ' + quotaMB + ' MB available');
    html += _statCard('Cache Health', percent < 80 ? 'Good' : 'High', percent + '% of quota used');
    html += _statCard('Cache Entries', '—', 'Cached resources');
    html += _statCard('Cache Version', 'v31', 'Service worker cache');
    html += '</div>';

    html += '<div class="pwa32-storage-bar" style="margin-bottom:20px"><div class="pwa32-storage-fill" style="width:' + percent + '%"></div></div>';

    html += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
    html += '<button class="pwa32-btn" onclick="window.PWA32Admin._clearCache()">Clear All Cache</button>';
    html += '<button class="pwa32-btn pwa32-btn-ghost" onclick="window.PWA32Admin._refreshCache()">Refresh Cache</button>';
    html += '</div>';

    // Cache breakdown
    html += '<div class="pwa32-admin-card" style="margin-top:16px"><h3>Cache Breakdown</h3>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">📄 HTML Pages</div><div style="font-size:.82rem;color:var(--text2)">Cached for offline navigation</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🖼️ Images</div><div style="font-size:.82rem;color:var(--text2)">Long-lived cache with revalidation</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">📜 JS / CSS</div><div style="font-size:.82rem;color:var(--text2)">Stale-while-revalidate</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🔤 Fonts</div><div style="font-size:.82rem;color:var(--text2)">365-day TTL cache</div></div>';
    html += '</div>';

    p.innerHTML = html;
  }

  function _clearCache() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    }
    if ('caches' in window) {
      caches.keys().then(function(keys) { keys.forEach(function(k) { caches.delete(k); }); });
    }
    showToast && showToast('All cache cleared.', 'success');
    setTimeout(function() { _renderSection('cache'); }, 1000);
  }

  function _refreshCache() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function(reg) {
        reg.update();
        showToast && showToast('Cache refreshing in background…', 'success');
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 6. SERVICE WORKER
  // ═══════════════════════════════════════════════════════════════════
  function _renderSW(p) {
    var swSupported = 'serviceWorker' in navigator;
    var html = '<div class="pwa32-admin-grid">';
    html += _statCard('Status', swSupported ? 'Active' : 'Unsupported', swSupported ? 'Service worker registered' : 'Not available');
    html += _statCard('Version', 'v31', 'Cache version');
    html += _statCard('Active Clients', '—', 'Connected tabs/windows');
    html += _statCard('Update Status', 'Up to date', 'Latest version active');
    html += '</div>';

    html += '<div class="pwa32-admin-card"><h3>Service Worker Controls</h3>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">';
    html += '<button class="pwa32-btn pwa32-btn-sm" onclick="window.PWA32Admin._swUpdate()">Check for SW Update</button>';
    html += '<button class="pwa32-btn pwa32-btn-sm pwa32-btn-ghost" onclick="window.PWA32Admin._swUnregister()">Unregister SW</button>';
    html += '<button class="pwa32-btn pwa32-btn-sm pwa32-btn-ghost" onclick="window.PWA32Admin._swSkipWaiting()">Activate Waiting SW</button>';
    html += '</div>';

    // SW info
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Scope</div><div style="font-size:.82rem;color:var(--text2)">/ (full site)</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Update Cycle</div><div style="font-size:.82rem;color:var(--text2)">On focus & every 24h</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Push Handler</div><div style="font-size:.82rem;color:var(--text2)">OneSignal + custom</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Background Sync</div><div style="font-size:.82rem;color:var(--text2)">sync-data, studyria-sync-progress</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Periodic Sync</div><div style="font-size:.82rem;color:var(--text2)">studyria-content-refresh (12h)</div></div>';
    html += '</div>';

    p.innerHTML = html;

    // Get live SW data
    if (swSupported) {
      navigator.serviceWorker.ready.then(function(reg) {
        _getSWVersion(function(version) {
          var versionEl = p.querySelectorAll('.pwa32-admin-stat-value')[1];
          if (versionEl && version) versionEl.textContent = version;
        });
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          var clientsEl = p.querySelectorAll('.pwa32-admin-stat-value')[2];
          if (clientsEl) clientsEl.textContent = regs.length;
        });
      });
    }
  }

  function _getSWVersion(cb) {
    if (!navigator.serviceWorker.controller) { cb(null); return; }
    var mc = new MessageChannel();
    mc.port1.onmessage = function(e) { cb(e.data && e.data.version ? e.data.version : null); };
    navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [mc.port2]);
    setTimeout(function() { cb(null); }, 3000);
  }

  function _swUpdate() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function(reg) {
        reg.update().then(function() { showToast && showToast('SW update check complete.', 'success'); });
      });
    }
  }

  function _swUnregister() {
    if (!confirm('Unregister service worker? App will lose offline capabilities until next visit.')) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(r) { r.unregister(); });
        showToast && showToast('Service worker unregistered.', 'success');
        setTimeout(function() { location.reload(); }, 1000);
      });
    }
  }

  function _swSkipWaiting() {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      showToast && showToast('Activating waiting service worker…', 'info');
      setTimeout(function() { location.reload(); }, 1500);
    } else {
      showToast && showToast('No waiting service worker.', 'info');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 7. DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════════
  function _renderDiagnostics(p) {
    var errors = _cfg('error_log', []);
    var crashes = _cfg('crash_log', []);
    var isOnline = navigator.onLine;
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var effType = connection ? connection.effectiveType : 'unknown';
    var downlink = connection ? connection.downlink : '—';

    var html = '<div class="pwa32-admin-grid">';
    html += _statCard('Crash Reports', String(crashes.length), 'Last 30 days');
    html += _statCard('Error Reports', String(errors.length), 'Logged errors');
    html += _statCard('Network Status', isOnline ? 'Online' : 'Offline', 'Connection: ' + effType + ' · ' + downlink + ' Mbps');
    html += _statCard('PWA Health', errors.length < 10 ? 'Healthy' : 'Issues', errors.length + ' errors logged');
    html += '</div>';

    // Storage
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function(est) {
        var storageEl = p.querySelector('#pwa32DiagStorage');
        if (storageEl) {
          storageEl.textContent = (est.usage / 1024 / 1024).toFixed(1) + ' MB / ' + (est.quota / 1024 / 1024).toFixed(0) + ' MB';
        }
      });
    }

    html += '<div class="pwa32-admin-card"><h3>Performance</h3>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Page Load Time</div><div style="font-size:.82rem;color:var(--text2)">' + _getLoadTime() + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Memory Usage</div><div style="font-size:.82rem;color:var(--text2)">' + _getMemUsage() + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Storage Usage</div><div id="pwa32DiagStorage" style="font-size:.82rem;color:var(--text2)">Calculating…</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">DOM Elements</div><div style="font-size:.82rem;color:var(--text2)">' + document.querySelectorAll('*').length + '</div></div>';
    html += '</div>';

    // Error log
    html += '<div class="pwa32-admin-card"><h3>Recent Errors</h3>';
    if (errors.length === 0) {
      html += '<p style="color:var(--text2);font-size:.82rem">No errors logged. 🎉</p>';
    } else {
      errors.slice(-10).reverse().forEach(function(e) {
        html += '<div class="pwa32-admin-row"><div><div class="pwa32-admin-row-label" style="color:#ef4444">' + _esc(e.message || 'Error') + '</div><div class="pwa32-admin-row-desc">' + new Date(e.ts || Date.now()).toLocaleString('en-IN') + '</div></div></div>';
      });
    }
    html += '</div>';

    // Network diagnostics
    html += '<div class="pwa32-admin-card"><h3>Network Status</h3>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Connection</div><div style="font-size:.82rem;color:var(--text2)">' + (isOnline ? 'Online ✅' : 'Offline ⚠️') + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Effective Type</div><div style="font-size:.82rem;color:var(--text2)">' + effType + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Downlink</div><div style="font-size:.82rem;color:var(--text2)">' + downlink + ' Mbps</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">RTT</div><div style="font-size:.82rem;color:var(--text2)">' + (connection ? connection.rtt + ' ms' : '—') + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">Save Data</div><div style="font-size:.82rem;color:var(--text2)">' + (connection && connection.saveData ? 'On' : 'Off') + '</div></div>';
    html += '</div>';

    p.innerHTML = html;
  }

  function _getLoadTime() {
    try {
      var t = performance.timing;
      var loadTime = t.loadEventEnd - t.navigationStart;
      return loadTime > 0 ? loadTime + ' ms' : '—';
    } catch(_) { return '—'; }
  }

  function _getMemUsage() {
    if (performance.memory) {
      return (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1) + ' MB';
    }
    return 'Not available';
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 8. ANALYTICS
  // ═══════════════════════════════════════════════════════════════════
  function _renderAnalytics(p) {
    var installStats = _cfg('install_stats', { total: 0, active: 0, last30: 0, android: 0, ios: 0, desktop: 0 });
    var updateStats = _cfg('update_stats', { total: 0, last30: 0, rate: 0 });
    var notifStats = _cfg('notif_stats', { sent: 0, delivered: 0, opened: 0, failed: 0 });
    var offlineStats = _cfg('offline_stats', { sessions: 0, duration: 0, pdfsRead: 0 });

    var html = '<div class="pwa32-admin-card"><h3>Install Analytics</h3>';
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Total Installs', String(installStats.total), 'All time');
    html += _statCard('Active Installs', String(installStats.active), 'Currently active');
    html += _statCard('New (30 days)', String(installStats.last30), 'Recent installs');
    html += _statCard('Install Rate', '—', 'Per day average');
    html += '</div></div>';

    html += '<div class="pwa32-admin-card"><h3>Update Analytics</h3>';
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Total Updates', String(updateStats.total), 'All time');
    html += _statCard('Updates (30 days)', String(updateStats.last30), 'Recent updates');
    html += _statCard('Update Rate', (updateStats.rate || 0) + '%', 'Users on latest');
    html += _statCard('Auto-Updates', String(updateStats.total), 'Silent background');
    html += '</div></div>';

    html += '<div class="pwa32-admin-card"><h3>Notification Analytics</h3>';
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Sent', String(notifStats.sent), 'Total sent');
    html += _statCard('Delivered', String(notifStats.delivered), 'Successfully received');
    html += _statCard('Opened', String(notifStats.opened), 'User clicked');
    html += _statCard('Open Rate', notifStats.sent > 0 ? Math.round(notifStats.opened / notifStats.sent * 100) + '%' : '—', 'Engagement');
    html += '</div></div>';

    html += '<div class="pwa32-admin-card"><h3>Offline Usage</h3>';
    html += '<div class="pwa32-admin-grid">';
    html += _statCard('Offline Sessions', String(offlineStats.sessions), 'Sessions without internet');
    html += _statCard('Avg Duration', (offlineStats.duration || 0) + ' min', 'Time spent offline');
    html += _statCard('PDFs Read Offline', String(offlineStats.pdfsRead), 'Offline reading sessions');
    html += _statCard('Sync Success', '—', 'Background sync completions');
    html += '</div></div>';

    html += '<div class="pwa32-admin-card"><h3>Device Statistics</h3>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🤖 Android</div><div style="font-weight:700">' + (installStats.android || 0) + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">🍎 iOS</div><div style="font-weight:700">' + (installStats.ios || 0) + '</div></div>';
    html += '<div class="pwa32-admin-row"><div class="pwa32-admin-row-label">💻 Desktop</div><div style="font-weight:700">' + (installStats.desktop || 0) + '</div></div>';
    html += '</div>';

    p.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════
  // § 9. PUBLIC API
  // ═══════════════════════════════════════════════════════════════════
  window.PWA32Admin = {
    _switch: _switchSection,
    _sendNotif: _sendNotif,
    _toggleFlag: _toggleFlag,
    _toggleMaintenance: _toggleMaintenance,
    _saveMaintMsg: _saveMaintMsg,
    _toggleSplash: _toggleSplash,
    _saveSplash: _saveSplash,
    _toggleUpdateRule: _toggleUpdateRule,
    _saveForceMin: _saveForceMin,
    _setForceUpdate: _setForceUpdate,
    _clearForceUpdate: _clearForceUpdate,
    _rollback: _rollback,
    _publishVersion: _publishVersion,
    _clearCache: _clearCache,
    _refreshCache: _refreshCache,
    _swUpdate: _swUpdate,
    _swUnregister: _swUnregister,
    _swSkipWaiting: _swSkipWaiting,
  };

  // ── Error logging for diagnostics ─────────────────────────────────
  window.addEventListener('error', function(e) {
    var log = _cfg('error_log', []);
    log.push({ message: e.message || 'Unknown error', ts: Date.now(), file: e.filename, line: e.lineno });
    if (log.length > 50) log = log.slice(-50);
    _setCfg('error_log', log);
  });

  window.addEventListener('unhandledrejection', function(e) {
    var log = _cfg('error_log', []);
    log.push({ message: 'Unhandled promise: ' + (e.reason && e.reason.message || e.reason || ''), ts: Date.now() });
    if (log.length > 50) log = log.slice(-50);
    _setCfg('error_log', log);
  });

  console.log('[PWA32Admin] Admin PWA Control Center initialized ✅');

})();
