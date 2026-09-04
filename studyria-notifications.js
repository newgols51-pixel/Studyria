/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA LIVE NOTIFICATIONS — Frontend client  (v3 — Smart Announcement Engine)
   v3 upgrade (additive, backward-compatible):
     • CTA labels per announcement type (Read Now / View Job / Start Quiz…)
     • Safe destination fallbacks: missing/unknown destination falls back
       to the relevant Studyria section instead of a dead card
     • Client-side dedup guard on publish (double-click / double-fire of
       the same content event; server-side content_id dedupe still rules)
     • GA4 (GTM dataLayer) events for notification card opens
   Backend: Studyria Notifications Base44 app (superagent-f8acee03)
   — separate Base44 backend, NOT BrainLab Arena (solas-e60b5349).

   Public side : SN.fetchLive()        → live feed (read-only, no auth)
   Admin side  : SN.publish()          → auto-notification on content publish
                SN.deactivate()       → unpublish / expiry handling
                SN.adminPanelInit()   → admin "Live Feed" manager UI
   All write calls verify the admin server-side via the Supabase session
   token; nothing sensitive is stored in this file.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://superagent-f8acee03.base44.app/functions/';
  var FETCH_TIMEOUT = 8000;

  var TYPE_META = {
    PDF:             { label: 'New PDF',  icon: '📚', cta: 'Read Now' },
    JOB:             { label: 'Job Alert', icon: '💼', cta: 'View Job' },
    QUIZ:            { label: 'Quiz',    icon: '📝', cta: 'Start Quiz' },
    MOCK_TEST:       { label: 'Mock Test', icon: '🎯', cta: 'Take Test' },
    CURRENT_AFFAIRS: { label: 'Affairs', icon: '📰', cta: 'Read Now' },
    ADRE:            { label: 'ADRE',    icon: '🗂️', cta: 'View Details' },
    CATEGORY:        { label: 'Category', icon: '📂', cta: 'Explore' },
    GENERAL:         { label: 'Update',  icon: '📢', cta: 'View' }
  };

  /* Section fallback when an announcement has no destination (or an
     unknown one) — never leaves the user on a dead card. */
  var TYPE_SECTION = {
    PDF:             "navigate('library')",
    JOB:             "navigate('career-hub')",
    QUIZ:            "navigate('brainlab')",
    MOCK_TEST:       "navigate('brainlab')",
    CURRENT_AFFAIRS: "navigate('brainlab')",
    ADRE:            "navigate('library')",
    CATEGORY:        "navigate('library')",
    GENERAL:         ''
  };

  /* Fire-and-forget GA4 event via the existing GTM dataLayer.
     Never throws, never blocks navigation. */
  function _trackOpen(evt, ntype) {
    try {
      (window.dataLayer || (window.dataLayer = [])).push({
        event: evt,
        notif_type: String(ntype || 'GENERAL')
      });
    } catch (e) { /* analytics must never break UX */ }
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\\/g, '&#92;');
  }

  /* Map a backend destination descriptor to an inline onclick action,
   * using ONLY existing SPA routes/handlers (never invented routes). */
  function destinationAction(dest) {
    if (!dest) return '';
    var i = String(dest).indexOf(':');
    if (i < 0) return '';
    var kind = String(dest).slice(0, i);
    var val  = String(dest).slice(i + 1);
    switch (kind) {
      case 'pdf':
        return "openDetail('" + escAttr(val) + "')";
      case 'job':
        return "navigate('career-hub');setTimeout(function(){if(typeof chOpenDetail==='function')chOpenDetail('" + escAttr(val) + "')},350)";
      case 'quiz':
        return "navigate('brainlab');setTimeout(function(){if(window.BrainLab&&BrainLab.switchTab)BrainLab.switchTab('quiz')},350)";
      case 'mock':
        return "navigate('brainlab');setTimeout(function(){if(window.BrainLab&&BrainLab.switchTab)BrainLab.switchTab('mock')},350)";
      case 'affair':
        return "navigate('brainlab');setTimeout(function(){if(window.BrainLab&&BrainLab.switchTab)BrainLab.switchTab('affairs')},350)";
      case 'page':
        return "navigate('" + escAttr(val) + "')";
      case 'url':
        // Trusted-destination guard: only https Studyria URLs open directly;
        // anything else falls back to the homepage (never a broken/foreign URL).
        if (/^https:\/\/studyria\.qzz\.io\//.test(val)) {
          return "SN._trackOpen('notification_card_open','URL');window.open('" + escAttr(val) + "','_blank','noopener')";
        }
        return '';
      default:
        return '';
    }
  }

  function _fetch(path, body, timeoutMs) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || FETCH_TIMEOUT) : null;
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Bad response' }; });
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /* ── PUBLIC: fetch the live feed, normalized for the existing
        renderNotifications() card shape. Never throws. ───────────── */
  function fetchLive() {
    return _fetch('snLive', {}).then(function (res) {
      if (!res || res.ok !== true || !Array.isArray(res.notifications)) {
        throw new Error((res && res.error) || 'Live notifications unavailable');
      }
      return res.notifications.map(function (n) {
        var rawType = String(n.type || 'GENERAL');
        var meta = TYPE_META[rawType] || TYPE_META.GENERAL;
        var dest = destinationAction(n.destination);
        var track = "SN._trackOpen('notification_card_open','" + escAttr(rawType) + "');";
        var action = dest
          ? (track + dest)
          : (TYPE_SECTION[rawType] ? (track + TYPE_SECTION[rawType]) : '');
        return {
          type: rawType.toLowerCase(),
          typeLabel: meta.label,
          title: n.title || 'Update',
          message: n.message || '',
          time: n.published_at || null,
          icon: n.icon || meta.icon,
          ctaLabel: meta.cta,
          action: action
        };
      });
    });
  }

  /* ── ADMIN helpers ────────────────────────────────────────────── */
  function getAdminToken() {
    var sb = window.supabaseClient;
    if (!sb || !sb.auth || !sb.auth.getSession) return Promise.resolve(null);
    return sb.auth.getSession().then(function (r) {
      return (r && r.data && r.data.session && r.data.session.access_token) || null;
    }).catch(function () { return null; });
  }

  /* Client-side dedup guard (Smart Announcement Engine, additive):
     • in-flight guard  → the same event fired twice concurrently shares
       one request (double-click, double hook fire)
     • recent guard     → the identical (type,id,title,message) event is
       skipped for 30s within the tab session (page refresh / retry
       double-fire). Legitimate re-publishes with changed content always
       pass through. The server-side content_id dedupe remains the
       authoritative layer; this is a polite first line of defense. */
  var _publishInflight = {};

  function _recentPublishes() {
    try { return JSON.parse(sessionStorage.getItem('snRecentPublishes') || '{}'); }
    catch (e) { return {}; }
  }
  function _setRecentPublish(map) {
    try { sessionStorage.setItem('snRecentPublishes', JSON.stringify(map)); } catch (e) {}
  }

  /* Auto-notification on publish. Fire-and-forget with one silent retry:
     a notification failure must NEVER fail the content publish itself. */
  function publish(contentType, contentId, opts) {
    opts = opts || {};
    if (contentType === 'PDF' && _looksLikeAdre(opts)) contentType = 'ADRE';

    var dedupeKey = contentType + '|' + (contentId || '') + '|' +
                    (opts.title || '') + '|' + (opts.message || '');

    // Concurrent identical call → share the in-flight promise
    if (_publishInflight[dedupeKey]) return _publishInflight[dedupeKey];

    // Same event already published < 30s ago in this tab session → skip
    var recent = _recentPublishes();
    var now = Date.now();
    for (var k in recent) { if (now - recent[k] > 30000) delete recent[k]; }
    if (recent[dedupeKey]) {
      return Promise.resolve({ ok: true, deduped: true });
    }
    recent[dedupeKey] = now;
    _setRecentPublish(recent);

    _publishInflight[dedupeKey] = getAdminToken().then(function (token) {
      if (!token) { console.warn('[SN] publish skipped — no admin session'); return { ok: false, skipped: true }; }
      var payload = {
        op: 'create', source: 'auto',
        adminToken: token,
        notification_type: contentType,
        content_id: contentId || null,
        title: opts.title || '',
        message: opts.message || '',
        icon: opts.icon || '',
        destination: opts.destination || '',
        priority: opts.priority || 'normal',
        expires_at: opts.expiresAt || null,
        metadata: opts.metadata || {}
      };
      return _fetch('snMutate', payload).then(function (res) {
        if (!res || res.ok !== true) {
          // single silent retry after 5s (transient backend/network failure)
          return new Promise(function (resolve) {
            setTimeout(function () { _fetch('snMutate', payload).then(resolve).catch(resolve); }, 5000);
          });
        }
        return res;
      });
    }).then(function (res) {
      // If the backend ultimately rejected the event, un-block the key so
      // a later legitimate attempt isn't swallowed by the recent guard.
      if (!res || res.ok !== true) {
        var m2 = _recentPublishes();
        if (m2[dedupeKey]) { delete m2[dedupeKey]; _setRecentPublish(m2); }
      }
      return res;
    }).catch(function (e) {
      var m3 = _recentPublishes();
      if (m3[dedupeKey]) { delete m3[dedupeKey]; _setRecentPublish(m3); }
      console.warn('[SN] publish failed (content publish unaffected):', e);
      return { ok: false };
    }).finally(function () {
      delete _publishInflight[dedupeKey];
    });
    return _publishInflight[dedupeKey];
  }

  function _looksLikeAdre(opts) {
    var hay = ((opts.title || '') + ' ' + (opts.message || '') + ' ' + ((opts.metadata && opts.metadata.category) || '')).toUpperCase();
    return hay.indexOf('ADRE') !== -1;
  }

  /* Deactivate the auto-notification when content is unpublished/deleted. */
  function deactivate(contentType, contentId) {
    if (!contentId) return Promise.resolve({ ok: false });
    return getAdminToken().then(function (token) {
      if (!token) return { ok: false, skipped: true };
      return _fetch('snMutate', {
        op: 'deactivate', adminToken: token,
        notification_type: contentType, content_id: String(contentId)
      });
    }).catch(function (e) {
      console.warn('[SN] deactivate failed:', e);
      return { ok: false };
    });
  }

  /* ── ADMIN PANEL: "Live Feed" manager UI ──────────────────────── */
  function adminCall(payload) {
    return getAdminToken().then(function (token) {
      if (!token) throw new Error('No admin session — please log in again.');
      return _fetch('snMutate', Object.assign({ adminToken: token }, payload));
    });
  }

  function _state() {
    window.__snAdmin = window.__snAdmin || { list: [], editingId: null };
    return window.__snAdmin;
  }

  function renderPanel(main) {
    var st = _state();
    var typeOptions = Object.keys(TYPE_META).map(function (t) {
      return '<option value="' + t + '">' + t + '</option>';
    }).join('');
    var e = st.editingId ? _find(st.editingId) : null;

    main.innerHTML = `
      <div class="admin-section-title">📡 Live Feed Notifications</div>
      <div class="admin-section-sub">Real-time notification system. Publishing content (PDFs, Jobs, Quizzes, Mock Tests, Current Affairs, Announcements) creates notifications automatically. Create manual announcements here — they appear in the homepage "Live Notifications" section within a minute.</div>

      <div style="display:flex;gap:8px;margin:14px 0">
        <button class="btn btn-ghost btn-sm" onclick="SN.adminTestConn(this)">🔌 Test Connection</button>
        <span id="snAdminConn" style="font-size:.78rem;color:var(--text2);align-self:center"></span>
      </div>

      <div class="mod-form-wrap" style="margin-bottom:14px">
        <div style="font-weight:700;color:var(--accent);margin-bottom:12px">${e ? '✏️ Edit Notification' : '➕ New Manual Notification'}</div>
        <input type="hidden" id="snEditId" value="${e ? e.id : ''}" />
        <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="snTitle" maxlength="120" placeholder="e.g. ADRE 2.0 — Paper III Added" value="${e ? _escHtml(e.title) : ''}"/></div>
        <div class="form-group" style="margin-top:8px"><label class="form-label">Message</label><textarea class="form-input" id="snMessage" rows="2" maxlength="300" placeholder="Short message shown on the notification card">${e ? _escHtml(e.message || '') : ''}</textarea></div>
        <div class="admin-form-grid" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Type</label>
            <select class="form-input" id="snType">${typeOptions}</select></div>
          <div class="form-group"><label class="form-label">Priority</label>
            <select class="form-input" id="snPriority">
              <option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>
            </select></div>
        </div>
        <div class="admin-form-grid" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Destination (CTA)</label>
            <select class="form-input" id="snDestKind" onchange="SN.adminDestKindChange()">
              <option value="">No CTA</option>
              <option value="page">Site page</option>
              <option value="url">External URL</option>
            </select></div>
          <div class="form-group" id="snDestValWrap" style="display:none"><label class="form-label">Value</label>
            <input class="form-input" id="snDestVal" placeholder="page id (library, career-hub, brainlab) or https://…"/></div>
        </div>
        <div class="admin-form-grid" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Icon (emoji, optional)</label><input class="form-input" id="snIcon" maxlength="8" placeholder="📢"/></div>
          <div class="form-group"><label class="form-label">Expires (optional)</label><input class="form-input" id="snExpires" type="datetime-local"/></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="SN.adminSave(this)">${e ? '💾 Save Changes' : '🚀 Publish Notification'}</button>
          ${e ? '<button class="btn btn-ghost btn-sm" onclick="SN.adminCancelEdit()">✕ Cancel</button>' : ''}
        </div>
        <div id="snSaveMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
      </div>

      <div class="mod-form-wrap">
        <div style="font-weight:700;color:var(--accent);margin-bottom:12px">🔔 Mobile Push Delivery</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="font-size:.82rem;font-weight:600">Global Push Switch</div>
            <div style="font-size:.74rem;color:var(--text2);margin-top:2px">Emergency kill switch — when OFF no new pushes are sent; Live Notifications keep working.</div>
          </div>
          <button class="btn btn-sm" id="snPushKill" onclick="SN.adminPushToggle(this)">⏳…</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="SN.adminPushTest(this)">📤 Send Test Push</button>
          <span id="snPushStats" style="font-size:.78rem;color:var(--text2)"></span>
        </div>
        <div id="snPushMsg" style="margin-top:8px;font-size:.78rem;display:none"></div>
      </div>

      <div class="mod-form-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-weight:700">📜 All Notifications</div>
          <button class="btn btn-ghost btn-sm" onclick="SN.adminRefresh(this)">🔄 Refresh</button>
        </div>
        <div id="snAdminList" style="font-size:.82rem">Loading…</div>
      </div>`;

    if (e) {
      var sel = main.querySelector('#snType'); if (sel) sel.value = e.notification_type || 'GENERAL';
      var pr = main.querySelector('#snPriority'); if (pr) pr.value = e.priority || 'normal';
      if (e.destination) {
        var m = String(e.destination).match(/^(page|url):(.*)$/);
        if (m) {
          var dk = main.querySelector('#snDestKind'); if (dk) dk.value = m[1];
          var dv = main.querySelector('#snDestVal'); if (dv) dv.value = m[2];
          var dw = main.querySelector('#snDestValWrap'); if (dw) dw.style.display = '';
        }
      }
    }
    SN.adminRefresh();
    SN.adminPushRefresh();
  }

  /* ── ADMIN: push controls (kill switch + test push + stats) ──── */
  function adminPushRefresh() {
    adminCall({ op: 'push-settings' }).then(function (res) {
      var btn = document.getElementById('snPushKill');
      var stats = document.getElementById('snPushStats');
      if (!btn) return;
      var on = !!(res && res.ok && res.pushEnabled);
      btn.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost');
      btn.textContent = on ? '🟢 ON' : '🔴 OFF';
      if (stats) {
        var n = (res && res.subscribers) || 0;
        stats.textContent = n + ' device' + (n === 1 ? '' : 's') + ' subscribed';
      }
    }).catch(function () {
      var btn = document.getElementById('snPushKill');
      if (btn) { btn.textContent = '—'; btn.disabled = true; }
    });
  }

  function adminPushToggle(btn) {
    btn.disabled = true; btn.textContent = '…';
    adminCall({ op: 'push-settings' }).then(function (cur) {
      var next = !(cur && cur.ok && cur.pushEnabled);
      return adminCall({ op: 'push-settings', enabled: next }).then(function () {
        _pushMsg(next ? '✅ Push notifications ON — new content will push to subscribers.'
                      : '🛑 Push OFF — no new pushes. Live Notifications still work.', next);
        adminPushRefresh();
      });
    }).catch(function (e) { _pushMsg('❌ ' + (e && e.message || 'Failed'), false); adminPushRefresh(); });
  }

  function adminPushTest(btn) {
    btn.disabled = true; btn.textContent = 'Sending…';
    adminCall({ op: 'push-test' }).then(function (res) {
      if (res && res.ok) {
        _pushMsg('📤 Sent to ' + (res.pushed || 0) + ' device(s). Invalid removed: ' + (res.invalid || 0) +
                 ((res.pushed || 0) === 0 ? ' — subscribe a device first (hamburger menu → Notifications).' : ''), true);
      } else {
        _pushMsg('❌ ' + ((res && res.error) || 'Failed'), false);
      }
    }).catch(function (e) { _pushMsg('❌ ' + (e && e.message || 'Failed'), false); })
      .finally(function () { btn.disabled = false; btn.textContent = '📤 Send Test Push'; });
  }

  function _pushMsg(text, ok) {
    var el = document.getElementById('snPushMsg');
    if (!el) return;
    el.style.display = '';
    el.style.color = ok ? '#10d98e' : '#ff6b85';
    el.textContent = text;
  }

  function _escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _find(id) {
    var st = _state();
    for (var i = 0; i < st.list.length; i++) if (st.list[i].id === id) return st.list[i];
    return null;
  }

  function adminTestConn(btn) {
    btn.disabled = true; btn.textContent = '…';
    adminCall({ op: 'ping' }).then(function (res) {
      var el = document.getElementById('snAdminConn');
      if (el) el.innerHTML = res && res.ok ? '<span style="color:#10d98e">✓ Connected as ' + _escHtml(res.admin) + '</span>' : '<span style="color:#ef4444">✗ ' + _escHtml((res && res.error) || 'failed') + '</span>';
      btn.disabled = false; btn.textContent = '🔌 Test Connection';
    }).catch(function (e) {
      var el = document.getElementById('snAdminConn');
      if (el) el.innerHTML = '<span style="color:#ef4444">✗ ' + _escHtml(e.message || 'failed') + '</span>';
      btn.disabled = false; btn.textContent = '🔌 Test Connection';
    });
  }

  function adminDestKindChange() {
    var kind = document.getElementById('snDestKind').value;
    var wrap = document.getElementById('snDestValWrap');
    if (wrap) wrap.style.display = kind ? '' : 'none';
  }

  function adminSave(btn) {
    var title = (document.getElementById('snTitle').value || '').trim();
    if (!title) { alert('Title is required'); return; }
    var kind = (document.getElementById('snDestKind').value) || '';
    var val = (document.getElementById('snDestVal').value || '').trim();
    var dest = '';
    if (kind === 'page') dest = 'page:' + (val || 'home');
    else if (kind === 'url') dest = 'url:' + val;
    var expVal = (document.getElementById('snExpires').value || '').trim();
    var st = _state();
    var msg = document.getElementById('snSaveMsg');
    btn.disabled = true; btn.textContent = 'Saving…';

    var payload = {
      op: st.editingId ? 'update' : 'create',
      source: 'manual',
      id: st.editingId || undefined,
      title: title,
      message: (document.getElementById('snMessage').value || '').trim(),
      notification_type: st.editingId ? undefined : (document.getElementById('snType').value || 'GENERAL'),
      priority: document.getElementById('snPriority').value || 'normal',
      destination: dest,
      icon: (document.getElementById('snIcon').value || '').trim(),
      expires_at: expVal ? new Date(expVal).toISOString() : null
    };
    if (st.editingId) { delete payload.source; delete payload.notification_type; }

    adminCall(payload).then(function (res) {
      btn.disabled = false; btn.textContent = st.editingId ? '💾 Save Changes' : '🚀 Publish Notification';
      if (res && res.ok) {
        if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = st.editingId ? '✓ Updated' : '✓ Published — live within a minute'; }
        st.editingId = null;
        SN.adminRefresh();
        if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (e) {} }
      } else if (msg) {
        msg.style.display = ''; msg.style.color = '#ef4444'; msg.textContent = '✗ ' + ((res && res.error) || 'failed');
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = st.editingId ? '💾 Save Changes' : '🚀 Publish Notification';
      if (msg) { msg.style.display = ''; msg.style.color = '#ef4444'; msg.textContent = '✗ ' + (e.message || 'failed'); }
    });
  }

  function adminCancelEdit() {
    _state().editingId = null;
    var main = document.getElementById('adminMain') || document.getElementById('admin-main');
    if (main) renderPanel(main);
  }

  function adminRefresh(btn) {
    if (btn) { btn.disabled = true; }
    adminCall({ op: 'list' }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
      if (!res || res.ok !== true) return;
      _state().list = res.notifications || [];
      _renderList();
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
    });
  }

  function _renderList() {
    var wrap = document.getElementById('snAdminList');
    if (!wrap) return;
    var list = _state().list;
    if (!list.length) { wrap.innerHTML = '<div style="padding:16px;color:var(--text2)">📭 No notifications yet. Publish content or create one above.</div>'; return; }
    var now = Date.now();
    wrap.innerHTML = '<table style="width:100%;border-collapse:collapse"><tbody>' + list.map(function (n) {
      var expired = n.expires_at && new Date(n.expires_at).getTime() <= now;
      var state = !n.is_active ? '<span style="color:#f59e0b">Inactive</span>' : expired ? '<span style="color:#94a3b8">Expired</span>' : '<span style="color:#10d98e">● Live</span>';
      var srcBadge = n.source === 'auto' ? '<span style="background:rgba(147,2,5,.12);color:#930205;border-radius:6px;padding:1px 7px;font-size:.68rem">auto</span>' : '<span style="background:rgba(16,217,142,.12);color:#10d98e;border-radius:6px;padding:1px 7px;font-size:.68rem">manual</span>';
      return '<tr style="border-bottom:1px solid rgba(147,2,5,.1)">' +
        '<td style="padding:8px 8px 8px 0">' + (n.icon || '') + ' <b>' + _escHtml(n.title) + '</b><div style="font-size:.7rem;color:var(--text2)">' + _escHtml(n.notification_type) + ' · ' + srcBadge + (n.content_id ? ' · ' + _escHtml(String(n.content_id).slice(0, 14)) : '') + '</div></td>' +
        '<td style="padding:8px;white-space:nowrap">' + state + '</td>' +
        '<td style="padding:8px;white-space:nowrap;text-align:right">' +
          '<button class="btn btn-ghost btn-sm" onclick="SN.adminEdit(\'' + n.id + '\')" title="Edit">✏️</button> ' +
          '<button class="btn btn-ghost btn-sm" onclick="SN.adminToggle(\'' + n.id + '\')" title="Activate/Deactivate">' + (n.is_active ? '⏸️' : '▶️') + '</button> ' +
          '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="SN.adminDelete(\'' + n.id + '\')" title="Delete">🗑️</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function adminEdit(id) {
    _state().editingId = id;
    var main = document.getElementById('adminMain') || document.getElementById('admin-main');
    if (main) renderPanel(main);
  }

  function adminToggle(id) {
    adminCall({ op: 'toggle', id: id }).then(function () {
      SN.adminRefresh();
      if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (e) {} }
    });
  }

  function adminDelete(id) {
    if (!confirm('Delete this notification permanently?')) return;
    adminCall({ op: 'delete', id: id }).then(function () {
      SN.adminRefresh();
      if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (e) {} }
    });
  }


  /* ═══════════════ WEB PUSH (VAPID) — user side ═══════════════
   * Real Web Push: Service Worker + Push API + Notification API.
   * VAPID public key only (private key lives server-side in the
   * notification backend). Permission is ONLY requested from the
   * existing Notification Center UI after a user taps "Enable".
   */
  var VAPID_PUBLIC_KEY = 'BN38ElWuX1HY1_X5SFtM5_q-D5z1Cgf6h_y9I0W68zvDKxe0FzxUXMJ-gsAQYyeP4KmoZ_Cpbe_tr7hWEUvADkU';

  function _b64ToUint8(b64) {
    var padding = '='.repeat((4 - b64.length % 4) % 4);
    var base = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window &&
           'Notification' in window && location.protocol === 'https:';
  }

  function _swReady() {
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.ready;
    return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(function () { return navigator.serviceWorker.ready; });
  }

  /* Best-effort user email for subscription attribution — guest (empty)
   * is perfectly fine; pushes are keyed to the device, not the account. */
  function _userEmail() {
    var sb = window.supabaseClient;
    if (sb && sb.auth && sb.auth.getSession) {
      return sb.auth.getSession().then(function (r) {
        return (r && r.data && r.data.session && r.data.session.user && r.data.session.user.email) || '';
      }).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function pushEnable() {
    if (!pushSupported()) return Promise.resolve({ success: false, reason: 'not_supported' });
    if (Notification.permission === 'denied') return Promise.resolve({ success: false, reason: 'denied' });

    var permPromise = Notification.permission === 'granted'
      ? Promise.resolve('granted')
      : Notification.requestPermission();

    return permPromise.then(function (perm) {
      if (perm !== 'granted') return { success: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
      return _swReady().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          var needNew = !existing;
          if (existing) {
            var curKey = existing.options && existing.options.applicationServerKey;
            var wantKey = _b64ToUint8(VAPID_PUBLIC_KEY);
            var same = curKey && curKey.byteLength === wantKey.byteLength;
            if (same) {
              var a = new Uint8Array(curKey), b = wantKey;
              for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
            }
            needNew = !same;
          }
          if (!needNew) return existing;
          if (existing) { try { existing.unsubscribe(); } catch (e) {} }
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: _b64ToUint8(VAPID_PUBLIC_KEY)
          });
        });
      });
    }).then(function (sub) {
      if (!sub) return { success: false, reason: 'subscribe_failed' };
      return _userEmail().then(function (email) {
        return _fetch('snPushOps', {
          op: 'subscribe',
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent,
          userEmail: email
        });
      }).then(function (res) {
        if (!res || res.ok !== true) return { success: false, reason: 'backend_failed' };
        try { localStorage.setItem('snPush', 'on'); } catch (e) {}
        return { success: true, subscriptionId: sub.endpoint };
      });
    }).catch(function (e) {
      console.warn('[SN.push] enable failed:', e);
      return { success: false, reason: 'error' };
    });
  }

  function pushDisable() {
    var p = Promise.resolve(null);
    try {
      p = ('serviceWorker' in navigator)
        ? navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
        : Promise.resolve(null);
    } catch (e) {}
    return p.then(function (sub) {
      if (!sub) return { success: true };
      return _fetch('snPushOps', { op: 'unsubscribe', endpoint: sub.endpoint })
        .catch(function () {})
        .then(function () {
          try { return sub.unsubscribe(); } catch (e) { return false; }
        })
        .then(function () {
          try { localStorage.setItem('snPush', 'off'); } catch (e) {}
          return { success: true };
        });
    }).catch(function () { return { success: false, reason: 'error' }; });
  }

  function pushStatus() {
    var st = { supported: pushSupported(), permission: 'unsupported', subscribed: false };
    if (!st.supported) return Promise.resolve(st);
    st.permission = Notification.permission;
    if (Notification.permission !== 'granted') return Promise.resolve(st);
    try {
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          st.subscribed = !!sub;
          return st;
        });
      }).catch(function () { return st; });
    } catch (e) { return Promise.resolve(st); }
  }

  /* Live feed + push subscribe/unsubscribe refreshes */
  window.addEventListener('sn-push-changed', function () {
    if (typeof refreshNotificationCenter === 'function') {
      try { refreshNotificationCenter(); } catch (e) {}
    }
  });

  /* ── Public API ───────────────────────────────────────────────── */
  window.SN = {
    fetchLive: fetchLive,
    _trackOpen: _trackOpen,
    publish: publish,
    deactivate: deactivate,
    destinationAction: destinationAction,
    adminPanel: renderPanel,
    adminTestConn: adminTestConn,
    adminRefresh: adminRefresh,
    adminSave: adminSave,
    adminCancelEdit: adminCancelEdit,
    adminDestKindChange: adminDestKindChange,
    adminEdit: adminEdit,
    adminToggle: adminToggle,
    adminDelete: adminDelete,
    adminPushRefresh: adminPushRefresh,
    adminPushToggle: adminPushToggle,
    adminPushTest: adminPushTest,
    push: {
      supported: pushSupported,
      enable: pushEnable,
      disable: pushDisable,
      status: pushStatus
    }
  };
})();
