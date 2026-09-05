/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — USER NOTIFICATION CENTER 3.0 (user-facing)
   ─────────────────────────────────────────────────────────────────
   A dedicated USER notifications page (#page-notifications, hash
   #notifications, direct URL /notifications). It is completely
   separate from the Admin Notification Studio:

     • Data source  : the SAME public snLive endpoint that powers the
                      homepage Live Feed + Web Push — one real event
                      source, keyed by notification id (no duplicates,
                      no fake entries, no hard-coded counts).
     • Deep links   : SN.destinationAction — the exact same routing the
                      Live Feed marquee uses (exact content page).
     • Push status  : SN.push.status/enable/disable/selfTest — the
                      existing native VAPID pipeline (never rebuilt).
     • Read/unread,
       cleared,
       category
       preferences : per-user state scoped to the signed-in account
                      (localStorage key includes the user uid). Nothing
                      is ever written to the shared notification
                      backend from this page — a user can never affect
                      another user's (or the global) notification state.
     • Admin tools  : NEVER rendered here. The admin composer lives
                      only behind the admin gate in the Admin panel.

   Mobile-first, Paper Cream + Maroon + Gold, CLS-safe skeletons,
   semantic headings, keyboard-accessible controls.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API      = 'https://superagent-f8acee03.base44.app/functions/';
  var PAGE_ID  = 'page-notifications';
  var POLL_MS  = 60000;

  /* ── Category metadata (user-facing labels; mirrors the marquee) ── */
  var TYPES = {
    PDF:             { label: 'Study Material',   icon: '📚', cta: 'Read Now' },
    JOB:             { label: 'Job Alert',       icon: '💼', cta: 'View Job' },
    QUIZ:            { label: 'Quiz',            icon: '🧩', cta: 'Take Quiz' },
    MOCK_TEST:       { label: 'Mock Test',       icon: '🎯', cta: 'Start Test' },
    ADRE:            { label: 'ADRE Paper',      icon: '🏛️', cta: 'Start Paper' },
    CURRENT_AFFAIRS: { label: 'Current Affairs',  icon: '📰', cta: 'Read Update' },
    LIBRARY:         { label: 'Library',          icon: '📖', cta: 'Open Notes' },
    CATEGORY:        { label: 'New on Studyria', icon: '🔥', cta: 'Explore' },
    GENERAL:         { label: 'Important Update',icon: '📢', cta: 'Open' }
  };
  var PREF_CATEGORIES = ['PDF','JOB','QUIZ','MOCK_TEST','ADRE','CURRENT_AFFAIRS','GENERAL'];

  /* ── Per-user state helpers (real, user-scoped, honest) ────────── */
  function ukey() { return (window.currentUser && window.currentUser.uid) ? String(window.currentUser.uid) : 'guest'; }
  function lsName(k) { return 'snc:' + k + ':' + ukey(); }
  function loadArr(k) {
    try { var v = JSON.parse(localStorage.getItem(lsName(k)) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveArr(k, a) { try { localStorage.setItem(lsName(k), JSON.stringify(a.slice(-500))); } catch (e) {} }
  var readSet    = loadArr('read');
  var clearedSet = loadArr('cleared');
  var prefs      = (function () {
    var d = {}; PREF_CATEGORIES.forEach(function (c) { d[c] = true; });
    try { var s = JSON.parse(localStorage.getItem(lsName('prefs')) || '{}'); PREF_CATEGORIES.forEach(function (c) { if (typeof s[c] === 'boolean') d[c] = s[c]; }); } catch (e) {}
    return d;
  })();
  function persist() { saveArr('read', readSet); saveArr('cleared', clearedSet); try { localStorage.setItem(lsName('prefs'), JSON.stringify(prefs)); } catch (e) {} }

  /* ── Small utils ───────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function timeAgo(iso) {
    var t = iso ? new Date(iso).getTime() : 0;
    if (!t || isNaN(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);      if (m < 60)  return m + ' min ago';
    var h = Math.floor(m / 60);     if (h < 24)  return (h === 1 ? '1 hour' : h + ' hours') + ' ago';
    var d = Math.floor(h / 24);     if (d < 30)  return (d === 1 ? '1 day' : d + ' days') + ' ago';
    return new Date(t).toLocaleDateString();
  }
  function el(id) { return document.getElementById(id); }
  function isPageActive() { var p = el(PAGE_ID); return !!(p && p.classList && p.classList.contains('active')); }

  /* ── Real data: same source as Live Feed + Web Push ───────────── */
  function fetchLive() {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    return fetch(API + 'snLive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { if (timer) clearTimeout(timer); return r.json(); })
      .then(function (res) {
        if (!res || res.ok !== true || !Array.isArray(res.notifications)) throw new Error('bad response');
        return res.notifications;
      });
  }

  /* ── State of the open page view ───────────────────────────────── */
  var records = [];      // raw snLive records (id-keyed, never duplicated)
  var filter  = 'all';   // 'all' | 'unread'
  var loading = false, loadErr = false;

  function isRead(id)    { return readSet.indexOf(id) !== -1; }
  function isCleared(id) { return clearedSet.indexOf(id) !== -1; }
  function markRead(id) {
    if (isRead(id)) return;
    readSet.push(id); persist(); updateBadges();
  }
  function typeMeta(t) { return TYPES[t] || TYPES.GENERAL; }
  function allowedByPrefs(rec) {
    var t = String(rec.type || 'GENERAL');
    return (PREF_CATEGORIES.indexOf(t) === -1) || prefs[t] !== false;
  }
  function visibleList() {
    return records.filter(function (r) {
      if (isCleared(r.id)) return false;
      if (!allowedByPrefs(r)) return false;
      return filter === 'all' || !isRead(r.id);
    });
  }
  function unreadCount() {
    return records.filter(function (r) { return !isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r); }).length;
  }

  /* ── Deep link: exact destination via the SAME routing as marquee ─ */
  function actionFor(rec) {
    try {
      if (window.SN && typeof SN.destinationAction === 'function') return SN.destinationAction(rec.destination || '');
    } catch (e) {}
    return '';
  }
  window.SNC = {
    open: function (id) {            // card / CTA click
      var rec = null;
      for (var i = 0; i < records.length; i++) if (records[i].id === id) { rec = records[i]; break; }
      if (!rec) return;
      markRead(id);
      var act = actionFor(rec);
      if (act) { try { new Function(act)(); } catch (e) {} }
      else if (typeof navigate === 'function') navigate('home');
      renderList();
    },
    setFilter: function (f) { filter = f; render(); },
    markAllRead: function () {
      records.forEach(function (r) { if (!isRead(r.id) && allowedByPrefs(r)) readSet.push(r.id); });
      persist(); updateBadges(); render();
    },
    clearRead: function () {
      records.forEach(function (r) { if (isRead(r.id) && !isCleared(r.id)) clearedSet.push(r.id); });
      persist(); updateBadges(); render();
    },
    retry: function () { load(); },
    setPref: function (cat, on) {
      prefs[cat] = !!on; persist(); updateBadges(); renderList(); renderSettings();
    },
    goExplore: function () { if (typeof navigate === 'function') navigate('library'); },
    goSignIn:  function () { if (typeof navigate === 'function') navigate('login'); }
  };

  /* ── Burger badges: REAL unread count only (no fake numbers) ───── */
  function updateBadges() {
    var n = unreadCount();
    var b = document.querySelectorAll('[data-snc-badge]');
    for (var i = 0; i < b.length; i++) {
      b[i].hidden = !(n > 0);
      if (n > 0) b[i].textContent = (n > 9 ? '9+' : String(n));
    }
  }

  /* ── Render ────────────────────────────────────────────────────── */
  function render() {
    var host = el(PAGE_ID);
    if (!host) return;
    if (!window.currentUser) { renderGuest(host); return; }
    if (!host.dataset.sncInit) {
      host.dataset.sncInit = '1';
      host.innerHTML = shell();
    }
    renderList(); renderSettings(); renderToolbarCounts();
  }

  function shell() { return (
    '<div class="snc-wrap">' +
      '<header class="snc-head">' +
        '<div class="snc-head-ico" aria-hidden="true">🔔</div>' +
        '<div><h1 class="snc-h1">Notifications</h1>' +
        '<p class="snc-sub">Stay updated with the latest from Studyria.</p></div>' +
      '</header>' +
      '<div class="snc-toolbar" role="tablist" aria-label="Notification filters">' +
        '<button class="snc-chip on" id="sncChipAll" role="tab" aria-selected="true" onclick="SNC.setFilter(\'all\')">All</button>' +
        '<button class="snc-chip" id="sncChipUnread" role="tab" aria-selected="false" onclick="SNC.setFilter(\'unread\')">Unread</button>' +
        '<span class="snc-tb-actions">' +
          '<button class="snc-linkbtn" id="sncMarkAll" onclick="SNC.markAllRead()">Mark all as read</button>' +
          '<button class="snc-linkbtn" id="sncClearRead" onclick="SNC.clearRead()">Clear read</button>' +
        '</span>' +
      '</div>' +
      '<div id="sncList" aria-live="polite"></div>' +
      '<section class="snc-settings" aria-labelledby="sncSettingsTitle">' +
        '<h2 class="snc-set-h" id="sncSettingsTitle">⚙️ Notification Settings</h2>' +
        '<div id="sncPushCard"></div>' +
        '<div id="sncPrefsCard"></div>' +
      '</section>' +
    '</div>');
  }

  function renderToolbarCounts() {
    var cA = el('sncChipAll'), cU = el('sncChipUnread');
    if (cA) { cA.setAttribute('aria-selected', filter === 'all' ? 'true' : 'false'); cA.className = 'snc-chip' + (filter === 'all' ? ' on' : ''); }
    if (cU) { cU.setAttribute('aria-selected', filter === 'unread' ? 'true' : 'false'); cU.className = 'snc-chip' + (filter === 'unread' ? ' on' : ''); }
    var n = unreadCount();
    if (cU) cU.textContent = 'Unread' + (n > 0 ? ' (' + (n > 9 ? '9+' : n) + ')' : '');
    var ma = el('sncMarkAll'), cr = el('sncClearRead');
    var anyUnread = records.some(function (r) { return !isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r); });
    var anyReadVisible = records.some(function (r) { return isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r); });
    if (ma) ma.style.display = anyUnread ? '' : 'none';
    if (cr) cr.style.display = anyReadVisible ? '' : 'none';
  }

  function skeleton() {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<div class="snc-card snc-sk" aria-hidden="true"><div class="snc-sk-ico"></div><div class="snc-sk-lines"><div class="snc-sk-l" style="width:70%"></div><div class="snc-sk-l" style="width:45%"></div><div class="snc-sk-l snc-sk-s" style="width:25%"></div></div></div>';
    return s;
  }

  function card(rec) {
    var meta  = typeMeta(rec.type);
    var unread = !isRead(rec.id);
    var cta   = (rec.cta && String(rec.cta).slice(0, 40)) || meta.cta;
    var thumb = (rec.poster_url && /^https:\/\//.test(String(rec.poster_url))) ? String(rec.poster_url) : '';
    return (
    '<article class="snc-card' + (unread ? ' unread' : '') + '" onclick="SNC.open(\'' + esc(rec.id) + '\')" tabindex="0" role="button"' +
      ' aria-label="' + esc((unread ? 'Unread notification: ' : '') + meta.label + ' — ' + rec.title) + '"' +
      ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();SNC.open(\'' + esc(rec.id) + '\')}">' +
      (thumb ? '<img class="snc-thumb" src="' + esc(thumb) + '" alt="" width="64" height="64" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
      '<span class="snc-ico' + (thumb ? ' has-thumb' : '') + '" aria-hidden="true">' + (rec.icon && rec.icon.length < 4 ? esc(rec.icon) : meta.icon) + '</span>' +
      '<div class="snc-body">' +
        '<div class="snc-card-top">' +
          '<span class="snc-cat">' + esc(meta.label) + '</span>' +
          (unread ? '<span class="snc-dot" title="Unread" aria-hidden="true"></span>' : '') +
          '<time class="snc-time">' + esc(timeAgo(rec.published_at)) + '</time>' +
        '</div>' +
        '<h3 class="snc-title">' + esc(rec.title) + '</h3>' +
        (rec.message ? '<p class="snc-msg">' + esc(rec.message) + '</p>' : '') +
      '</div>' +
      '<button class="snc-cta" onclick="event.stopPropagation();SNC.open(\'' + esc(rec.id) + '\')">' + esc(cta) + ' →</button>' +
    '</article>');
  }

  function renderList() {
    var box = el('sncList');
    if (!box) return;
    if (loading) { box.innerHTML = skeleton(); return; }
    if (loadErr) {
      box.innerHTML = '<div class="snc-state"><div class="snc-state-ico" aria-hidden="true">⚠️</div>' +
        '<p class="snc-state-t">Couldn\'t load notifications.</p>' +
        '<button class="snc-primary-btn" onclick="SNC.retry()">Try Again</button></div>';
      return;
    }
    var list = visibleList();
    if (!list.length) {
      if (records.length && filter === 'unread') {
        box.innerHTML = '<div class="snc-state"><div class="snc-state-ico" aria-hidden="true">✅</div><p class="snc-state-t">No unread notifications.</p></div>';
      } else {
        box.innerHTML = '<div class="snc-state"><div class="snc-state-ico" aria-hidden="true">🔔</div>' +
          '<p class="snc-state-t">You\'re all caught up.</p><p class="snc-state-s">New Studyria updates will appear here.</p>' +
          '<button class="snc-primary-btn" onclick="SNC.goExplore()">Explore Studyria</button></div>';
      }
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) html += card(list[i]);
    box.innerHTML = html;
  }

  /* ── Settings: push status card (native VAPID, real state only) ── */
  var pushBusy = false;
  window.SNC.pushToggle = function () {
    if (pushBusy || !(window.SN && SN.push)) return;
    pushBusy = true;
    SN.push.status().then(function (st) {
      var p = st.subscribed ? SN.push.disable() : SN.push.enable();
      return p.then(function () { pushBusy = false; renderSettings(); });
    }).catch(function () { pushBusy = false; renderSettings(); });
  };
  window.SNC.pushSelfTest = function () {
    if (window.SN && SN.push && SN.push.selfTest) SN.push.selfTest().then(function (r) {
      if (typeof showToast === 'function') showToast(r && r.ok ? '✅ Test push sent — check your notification tray.' : 'Self-test failed: ' + ((r && r.error) || 'unknown'), r && r.ok ? 'success' : 'error');
    });
  };
  function renderSettings() {
    var box = el('sncPushCard');
    if (box) {
      if (!(window.SN && SN.push)) { box.innerHTML = ''; }
      else {
        box.innerHTML = '<div class="snc-card snc-push-card"><div class="snc-sk-lines"><div class="snc-sk-l snc-sk-s" style="width:40%"></div></div></div>';
        SN.push.status().then(function (st) {
          if (!el('sncPushCard')) return;
          var on = st.subscribed;
          var body = '', pill = '';
          if (on) {
            pill = '<span class="snc-pill on">ON</span>';
            body = '<p class="snc-push-p">Push alerts are enabled on this device. You\'ll receive updates even when the site is closed.</p>' +
                   '<div class="snc-push-btns"><button class="snc-primary-btn" onclick="SNC.pushSelfTest()">🧪 Send Test</button>' +
                   '<button class="snc-ghost-btn" onclick="SNC.pushToggle()">Turn Off</button></div>';
          } else if (st.permission === 'denied') {
            pill = '<span class="snc-pill off">OFF</span>';
            body = '<p class="snc-push-p">Notifications are blocked in your browser. Open your browser menu → Site settings → Notifications → Allow, then tap below.</p>' +
                   '<div class="snc-push-btns"><button class="snc-primary-btn" onclick="SNC.pushToggle()">🔔 Enable Notifications</button></div>';
          } else if (st.permission === 'unsupported') {
            pill = '<span class="snc-pill na">N/A</span>';
            body = '<p class="snc-push-p">Push notifications aren\'t supported in this browser. Try Chrome, Edge, or install the Studyria app.</p>';
          } else {
            pill = '<span class="snc-pill off">OFF</span>';
            body = '<p class="snc-push-p">Turn on notifications to get notified the moment new PDFs, jobs, quizzes, mock tests and exam alerts drop.</p>' +
                   '<div class="snc-push-btns"><button class="snc-primary-btn" onclick="SNC.pushToggle()">🔔 Enable Notifications</button></div>';
          }
          box.innerHTML = '<div class="snc-card snc-push-card">' +
            '<div class="snc-push-head"><span class="snc-push-name">🔔 Push Notifications</span>' + pill + '</div>' + body + '</div>';
        }).catch(function () { box.innerHTML = ''; });
      }
    }
    var pb = el('sncPrefsCard');
    if (pb) {
      var rows = '';
      PREF_CATEGORIES.forEach(function (c) {
        rows += '<label class="snc-pref-row"><input type="checkbox" ' + (prefs[c] !== false ? 'checked' : '') +
          ' onchange="SNC.setPref(\'' + c + '\', this.checked)" aria-label="' + esc(TYPES[c].label) + '">' +
          '<span>' + TYPES[c].icon + ' ' + esc(TYPES[c].label) + '</span></label>';
      });
      pb.innerHTML = '<div class="snc-card snc-prefs-card"><div class="snc-push-head"><span class="snc-push-name">Categories</span></div>' +
        '<div class="snc-pref-grid">' + rows + '</div>' +
        '<p class="snc-note">Your choices shape which updates appear in this Notification Center.</p></div>';
    }
  }

  /* ── Guest view: sign-in wall, guest push setup preserved ─────── */
  function renderGuest(host) {
    host.innerHTML = (
      '<div class="snc-wrap">' +
        '<header class="snc-head">' +
          '<div class="snc-head-ico" aria-hidden="true">🔔</div>' +
          '<div><h1 class="snc-h1">Notifications</h1>' +
          '<p class="snc-sub">Stay updated with the latest from Studyria.</p></div>' +
        '</header>' +
        '<div class="snc-state" style="padding:36px 20px">' +
          '<div class="snc-state-ico" aria-hidden="true">🔔</div>' +
          '<p class="snc-state-t">Sign in to view your notifications</p>' +
          '<p class="snc-state-s">Your notification history, read state and preferences are tied to your Studyria account.</p>' +
          '<button class="snc-primary-btn" onclick="SNC.goSignIn()">Sign In</button>' +
        '</div>' +
        '<section class="snc-settings" aria-label="Device push settings">' +
          '<h2 class="snc-set-h">⚙️ Device Settings</h2>' +
          '<div id="sncPushCard"></div>' +
        '</section>' +
      '</div>');
    renderSettings();
  }

  /* ── Load + push-click read sync + live refresh while page open ── */
  var pollTimer = null;
  function load() {
    var box = el('sncList');
    if (!isPageActive()) { stopPoll(); return; }
    loading = true; loadErr = false;
    if (box) renderList();
    fetchLive().then(function (list) {
      loading = false;
      /* key by id — one event appears exactly once, regardless of
         realtime reconnect / retry / poll overlap (duplicate protection) */
      var seen = {}; records = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i]; if (!r || !r.id || seen[r.id]) continue;
        seen[r.id] = 1; records.push(r);
      }
      syncPushClickRead();
      updateBadges();
      if (isPageActive()) { renderList(); renderToolbarCounts(); }
    }).catch(function () {
      loading = false; loadErr = true;
      if (isPageActive()) renderList();
    });
  }
  function startPoll() { stopPoll(); pollTimer = setInterval(load, POLL_MS); }
  function stopPoll()  { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  /* If the visit came from a push tap (?notif=<descriptor>), the exact
     descriptor equals the record's destination → mark that
     notification read for this user, never duplicating it. */
  function syncPushClickRead() {
    var m = /(?:\?|&)notif=([^&]+)/.exec(location.search);
    if (!m) return;
    var desc = '';
    try { desc = decodeURIComponent(m[1]); } catch (e) { desc = m[1]; }
    for (var i = 0; i < records.length; i++) {
      if (records[i].destination && records[i].destination === desc) { markRead(records[i].id); return; }
    }
  }

  /* ── Page lifecycle: hook navigate() (wraps any previous wrapper) ─ */
  var origNavigate = window.navigate;
  window.navigate = function (page) {
    var p = origNavigate ? origNavigate.apply(this, arguments) : undefined;
    if (page === 'notifications') { render(); load(); startPoll(); }
    else { stopPoll(); }
    return p;
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && isPageActive()) { load(); }
    else if (document.visibilityState === 'hidden') { stopPoll(); }
  });

  /* Refresh burger badge (real count) whenever a burger opens */
  ['dhToggleHamburger', 'mhToggleBurger'].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function (e) { updateBadgesAsync(); return orig.apply(this, arguments); };
  });
  function updateBadgesAsync() {
    fetchLive().then(function (list) {
      var seen = {}; records = [];
      for (var i = 0; i < list.length; i++) { var r = list[i]; if (!r || !r.id || seen[r.id]) continue; seen[r.id] = 1; records.push(r); }
      updateBadges();
    }).catch(function () {});
  }

  /* ── Direct URL /notifications → SPA hash route (before boot read) ─ */
  if (location.pathname === '/notifications' || location.pathname === '/notifications/') {
    try { history.replaceState({ page: 'notifications' }, '', '#notifications'); } catch (e) {}
  }

  /* ── Brand styles (Paper Cream + Maroon + Gold), CLS-safe, mobile-first ─ */
  function injectStyles() {
    if (el('snc-styles')) return;
    var s = document.createElement('style');
    s.id = 'snc-styles';
    s.textContent = [
      '#page-notifications{padding:24px 16px 48px;max-width:760px;margin:0 auto}',
      '.snc-wrap{animation:sncFade .25s ease}',
      '@keyframes sncFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.snc-head{display:flex;align-items:center;gap:14px;margin:6px 0 18px}',
      '.snc-head-ico{width:52px;height:52px;border-radius:16px;background:rgba(147,2,5,.09);border:1px solid rgba(201,154,60,.35);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex:0 0 auto}',
      '.snc-h1{font-size:1.5rem;font-weight:800;margin:0;color:var(--hp-ink,#2b1c1c);font-family:var(--font-editorial,inherit)}',
      '.snc-sub{margin:2px 0 0;font-size:.85rem;color:var(--text2,rgba(43,28,28,.6))}',
      '.snc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      '.snc-chip{border:1px solid rgba(147,2,5,.18);background:transparent;color:var(--hp-ink,#2b1c1c);border-radius:999px;padding:7px 16px;font-size:.8rem;font-weight:700;cursor:pointer;min-height:36px;transition:all .15s;font-family:inherit}',
      '.snc-chip.on{background:#930205;color:#faf6ef;border-color:#930205}',
      '.snc-chip:focus-visible,.snc-linkbtn:focus-visible,.snc-cta:focus-visible,.snc-card:focus-visible,.snc-primary-btn:focus-visible,.snc-ghost-btn:focus-visible,.snc-pref-row input:focus-visible{outline:2px solid #c99a3c;outline-offset:2px}',
      '.snc-tb-actions{margin-left:auto;display:flex;gap:10px}',
      '.snc-card{display:flex;align-items:center;gap:12px;background:#faf6ef;border:1px solid rgba(147,2,5,.10);border-radius:16px;padding:14px;margin-bottom:10px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s;overflow:hidden}',
      '.snc-card:hover{border-color:rgba(147,2,5,.28);box-shadow:0 2px 10px rgba(43,28,28,.06)}',
      'body.dark .snc-card{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08)}',
      '.snc-card.unread{border-left:3px solid #930205;background:#fdfaf3}',
      'body.dark .snc-card.unread{border-left-color:#c99a3c}',
      '.snc-dot{width:8px;height:8px;border-radius:50%;background:#930205;flex:0 0 auto}',
      'body.dark .snc-dot{background:#c99a3c}',
      '.snc-thumb{width:64px;height:64px;border-radius:12px;object-fit:cover;flex:0 0 auto;background:rgba(147,2,5,.06)}',
      '.snc-ico{width:46px;height:46px;border-radius:13px;background:rgba(201,154,60,.16);border:1px solid rgba(201,154,60,.3);display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex:0 0 auto}',
      '.snc-ico.has-thumb{display:none}',
      '.snc-body{flex:1;min-width:0}',
      '.snc-card-top{display:flex;align-items:center;gap:8px;font-size:.68rem;color:var(--text2,rgba(43,28,28,.55))}',
      '.snc-cat{font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#930205}',
      'body.dark .snc-cat{color:#c99a3c}',
      '.snc-time{margin-left:auto;white-space:nowrap}',
      '.snc-title{margin:4px 0 0;font-size:.95rem;font-weight:700;color:var(--hp-ink,#2b1c1c);line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.snc-msg{margin:3px 0 0;font-size:.8rem;color:var(--text2,rgba(43,28,28,.6));line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.snc-cta{flex:0 0 auto;border:none;background:rgba(147,2,5,.06);color:#930205;border-radius:999px;padding:9px 14px;font-size:.76rem;font-weight:800;cursor:pointer;min-height:36px;white-space:nowrap;font-family:inherit}',
      'body.dark .snc-cta{background:rgba(201,154,60,.12);color:#c99a3c}',
      '@media(max-width:767px){#page-notifications{padding:16px 12px 42px}.snc-card{flex-wrap:wrap;padding:12px}.snc-cta{width:100%;order:4;margin-top:2px}.snc-h1{font-size:1.3rem}.snc-tb-actions{width:100%;margin-left:0;justify-content:space-between}}',
      '.snc-sk{pointer-events:none}',
      '.snc-sk-ico{width:46px;height:46px;border-radius:13px;background:rgba(147,2,5,.08);flex:0 0 auto;animation:sncSh 1.2s ease-in-out infinite}',
      '.snc-sk-lines{flex:1;display:flex;flex-direction:column;gap:8px}',
      '.snc-sk-l{height:12px;border-radius:6px;background:rgba(147,2,5,.08);animation:sncSh 1.2s ease-in-out infinite}',
      '.snc-sk-s{height:9px}',
      '@keyframes sncSh{0%,100%{opacity:.5}50%{opacity:1}}',
      '.snc-state{text-align:center;padding:40px 16px;background:#faf6ef;border:1px solid rgba(147,2,5,.10);border-radius:16px}',
      'body.dark .snc-state{background:rgba(255,255,255,.04)}',
      '.snc-state-ico{font-size:2.2rem;margin-bottom:8px}',
      '.snc-state-t{font-weight:800;font-size:1rem;margin:0 0 6px;color:var(--hp-ink,#2b1c1c)}',
      '.snc-state-s{font-size:.82rem;color:var(--text2,rgba(43,28,28,.6));margin:0 0 16px}',
      '.snc-settings{margin-top:26px}',
      '.snc-set-h{font-size:.95rem;font-weight:800;color:var(--hp-ink,#2b1c1c);margin:0 0 10px}',
      '.snc-card.snc-push-card,.snc-card.snc-prefs-card{cursor:default;flex-direction:column;align-items:stretch;gap:10px}',
      '.snc-push-head{display:flex;align-items:center;justify-content:space-between}',
      '.snc-push-name{font-weight:800;font-size:.88rem;color:var(--hp-ink,#2b1c1c)}',
      '.snc-pill{font-size:.68rem;font-weight:800;padding:4px 10px;border-radius:999px}',
      '.snc-pill.on{background:rgba(16,217,142,.14);color:#10d98e;border:1px solid rgba(16,217,142,.3)}',
      '.snc-pill.off{background:rgba(255,77,109,.12);color:#ff6b85;border:1px solid rgba(255,77,109,.3)}',
      '.snc-pill.na{background:rgba(148,163,184,.14);color:#94a3b8;border:1px solid rgba(148,163,184,.3)}',
      '.snc-push-p{margin:0;font-size:.8rem;color:var(--text2,rgba(43,28,28,.6));line-height:1.5}',
      '.snc-push-btns{display:flex;gap:8px;flex-wrap:wrap}',
      '.snc-primary-btn{background:#930205;color:#faf6ef;border:none;border-radius:999px;padding:11px 20px;font-size:.8rem;font-weight:800;cursor:pointer;min-height:42px;font-family:inherit}',
      '.snc-primary-btn:active{transform:scale(.97)}',
      '.snc-ghost-btn{background:transparent;border:1px solid rgba(147,2,5,.25);color:#930205;border-radius:999px;padding:11px 20px;font-size:.8rem;font-weight:700;cursor:pointer;min-height:42px;font-family:inherit}',
      '.snc-pref-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}',
      '@media(max-width:767px){.snc-pref-grid{grid-template-columns:1fr}}',
      '.snc-pref-row{display:flex;align-items:center;gap:10px;font-size:.82rem;font-weight:600;color:var(--hp-ink,#2b1c1c);background:rgba(147,2,5,.03);border:1px solid rgba(147,2,5,.07);border-radius:12px;padding:10px 12px;cursor:pointer;min-height:44px}',
      '.snc-pref-row input{accent-color:#930205;width:18px;height:18px;flex:0 0 auto}',
      '.snc-note{margin:2px 0 0;font-size:.7rem;color:var(--text2,rgba(43,28,28,.5))}',
      '.snc-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;margin-left:auto;border-radius:999px;background:#930205;color:#faf6ef;font-size:.66rem;font-weight:800}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── Boot ───────────────────────────────────────────────────────── */
  function boot() {
    injectStyles();
    updateBadgesAsync();
    if (location.hash === '#notifications') { render(); load(); startPoll(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
