/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — USER NOTIFICATION CENTER 4.0 (user-facing)
   ─────────────────────────────────────────────────────────────────
   Premium upgrade of the dedicated USER notifications page
   (#page-notifications · #notifications · /notifications ·
   ?page=notifications). Completely separate from the Admin
   Notification Studio — admin tools are never rendered here.

     • Data source  : the SAME public snLive endpoint that powers the
                      homepage Live Feed + Web Push — one real event
                      source, keyed by notification id. Real counts
                      only; no hard-coded numbers, no fake data.
     • Deep links   : SN.destinationAction — the exact routing the
                      Live Feed marquee uses. Missing destination →
                      honest "no longer available" state, never a
                      blind homepage redirect, never Admin.
     • Push status  : SN.push.status/enable/disable/selfTest — the
                      existing native VAPID pipeline (never rebuilt).
                      Status reflects the REAL subscription, not a
                      local boolean.
     • Read/unread,
       cleared, and
       category
       preferences : per-user, keyed to the signed-in account uid.
                      One user's read state never affects anyone else.
     • 4.0 upgrades: real-count filter chips, TODAY/YESTERDAY/EARLIER
                      day sections, expandable detail cards (full
                      message + poster + exact time + CTA), deep-link
                      fallback, HIGH priority accent (subtle, never
                      huge red blocks), deterministic same-day PDF
                      grouping (never groups urgent/jobs/ADRE),
                      toggle-row preferences, "Yesterday / Sep 4"
                      time formats, prefers-reduced-motion support.

   Mobile-first (360–430px verified), Paper Cream + Maroon + Gold,
   CLS-safe skeletons and posters, keyboard-accessible controls.
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
    QUIZ:            { label: 'Quiz',            icon: '🧩', cta: 'Start Quiz' },
    MOCK_TEST:       { label: 'Mock Test',       icon: '🎯', cta: 'Start Test' },
    ADRE:            { label: 'ADRE Paper',      icon: '🏛️', cta: 'View Paper' },
    CURRENT_AFFAIRS: { label: 'Current Affairs',  icon: '📰', cta: 'Read Update' },
    LIBRARY:         { label: 'Library',          icon: '📖', cta: 'Open Notes' },
    CATEGORY:        { label: 'New on Studyria', icon: '🔥', cta: 'Explore' },
    GENERAL:         { label: 'Important Update',icon: '📢', cta: 'Learn More' }
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
  function el(id) { return document.getElementById(id); }
  function isPageActive() { var p = el(PAGE_ID); return !!(p && p.classList && p.classList.contains('active')); }

  /* ── Human-friendly time (§25) ─────────────────────────────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(iso) { var d = iso ? new Date(iso) : new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function timeAgo(iso) {
    var t = iso ? new Date(iso).getTime() : 0;
    if (!t || isNaN(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'Just now';
    var m = Math.floor(s / 60);   if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (dayKey(new Date(t)) === dayKey(new Date())) return (h === 1 ? '1 hour' : h + ' hours') + ' ago';
    if (dayKey(new Date(t)) === dayKey(new Date(Date.now() - 864e5))) return 'Yesterday';
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function exactTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }

  /* ── Real data (§18/§24): snHistory mirrors snLive's exact read
     semantics at cap 30 — one source, no parallel dataset. Badge and
     marquee stay on light snLive. ─────────────────────────────────── */
  function fetchVia(fn) {
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    return fetch(API + fn, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { if (timer) clearTimeout(timer); return r.json(); })
      .then(function (res) {
        if (!res || res.ok !== true || !Array.isArray(res.notifications)) throw new Error('bad response');
        return res.notifications;
      });
  }
  function fetchLive()     { return fetchVia('snLive'); }     /* cap 10 — badges/marquee parity */
  function fetchHistory()  { return fetchVia('snHistory'); }  /* cap 30 — Center history (§24) */
  var PAGE_SIZE = 10, shown = PAGE_SIZE;                      /* §24 pagination */
  function dedupe(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) { var r = list[i]; if (!r || !r.id || seen[r.id]) continue; seen[r.id] = 1; out.push(r); }
    return out;
  }

  /* ── View state ─────────────────────────────────────────────────── */
  var records = [];            // raw snLive records (id-keyed, never duplicated)
  var filter  = 'all';         // 'all' | 'unread'
  var loading = false, loadErr = false;
  var expandedId = null;      // open detail card (deterministic record id)
  var groupOpen = {};         // dayKey → bool (PDF flood group)

  function isRead(id)    { return readSet.indexOf(id) !== -1; }
  function isCleared(id) { return clearedSet.indexOf(id) !== -1; }
  function markRead(id) {
    if (isRead(id)) return;
    readSet.push(id); persist(); updateBadges(unreadCount());
  }
  function typeMeta(t) { return TYPES[t] || TYPES.GENERAL; }
  function allowedByPrefs(rec) {
    var t = String(rec.type || 'GENERAL');
    return (PREF_CATEGORIES.indexOf(t) === -1) || prefs[t] !== false;
  }
  function allowedList() {
    return records.filter(function (r) { return !isCleared(r.id) && allowedByPrefs(r); });
  }
  function visibleList() {
    return allowedList().filter(function (r) { return filter === 'all' || !isRead(r.id); });
  }
  function unreadCount() {
    return records.filter(function (r) { return !isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r); }).length;
  }
  function recById(id) {
    for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i];
    return null;
  }

  /* ── Deep link: exact destination, same routing as the marquee ── */
  function actionFor(rec) {
    try {
      if (window.SN && typeof SN.destinationAction === 'function') return SN.destinationAction(rec.destination || '');
    } catch (e) {}
    return '';
  }

  window.SNC = {
    /* §10 — open a notification: expand detail + mark read (NOT a blind jump) */
    toggleCard: function (id) {
      expandedId = (expandedId === id) ? null : id;
      if (expandedId === id) markRead(id);
      renderList();
    },
    /* CTA — jump to the EXACT destination (never homepage/Campus/Admin) */
    cta: function (id) {
      var rec = recById(id);
      if (!rec) return;
      markRead(id);
      var act = actionFor(rec);
      if (act) { try { new Function(act)(); } catch (e) {} }
      else { renderList(); } // no valid destination → detail shows fallback
    },
    /* §11 — safe Studyria fallback destination */
    explore: function () { if (typeof navigate === 'function') navigate('library'); },
    /* §16 — expand a same-day PDF group (deterministic key, no random ids) */
    toggleGroup: function (key) {
      groupOpen[key] = !groupOpen[key];
      renderList();
    },
    setFilter: function (f) { filter = f; expandedId = null; shown = PAGE_SIZE; render(); },
    loadMore: function () { shown += PAGE_SIZE; renderList(); },
    markAllRead: function () {
      records.forEach(function (r) { if (!isRead(r.id) && allowedByPrefs(r)) readSet.push(r.id); });
      persist(); updateBadges(unreadCount()); render();
    },
    clearRead: function () {
      records.forEach(function (r) { if (isRead(r.id) && !isCleared(r.id)) clearedSet.push(r.id); });
      persist(); updateBadges(unreadCount()); render();
    },
    retry: function () { load(); },
    setPref: function (cat, on) {
      prefs[cat] = !!on; persist(); updateBadges(unreadCount()); renderList(); renderSettings();
    },
    pushToggle: function () {
      if (pushBusy || !(window.SN && SN.push)) return;
      pushBusy = true;
      SN.push.status().then(function (st) {
        var p = st.subscribed ? SN.push.disable() : SN.push.enable();
        return p.then(function () { pushBusy = false; renderSettings(); });
      }).catch(function () { pushBusy = false; renderSettings(); });
    },
    pushSelfTest: function () {
      if (window.SN && SN.push && SN.push.selfTest) SN.push.selfTest().then(function (r) {
        if (typeof showToast === 'function') showToast(r && r.ok ? '✅ Test push sent — check your notification tray.' : 'Self-test failed: ' + ((r && r.error) || 'unknown'), r && r.ok ? 'success' : 'error');
      });
    },
    goExplore: function () { if (typeof navigate === 'function') navigate('library'); },
    goSignIn:  function () { if (typeof navigate === 'function') navigate('login'); }
  };

  /* ── Burger badges: REAL unread count only (no fake numbers) ───── */
  function updateBadges(n) {
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
        '<p class="snc-sub">Stay ahead with the latest from Studyria.</p></div>' +
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
        '<h2 class="snc-set-h" id="sncSettingsTitle">⚙️ Notification Preferences</h2>' +
        '<div id="sncPushCard"></div>' +
        '<div id="sncPrefsCard"></div>' +
      '</section>' +
    '</div>');
  }

  function renderToolbarCounts() {
    var cA = el('sncChipAll'), cU = el('sncChipUnread');
    var all = allowedList().length;   /* REAL count regardless of active filter */
    var n = unreadCount();
    if (cA) {
      cA.setAttribute('aria-selected', filter === 'all' ? 'true' : 'false');
      cA.className = 'snc-chip' + (filter === 'all' ? ' on' : '');
      cA.textContent = 'All ' + all;           /* REAL count — even 0 (§5) */
    }
    if (cU) {
      cU.setAttribute('aria-selected', filter === 'unread' ? 'true' : 'false');
      cU.className = 'snc-chip' + (filter === 'unread' ? ' on' : '');
      cU.textContent = 'Unread ' + n;         /* REAL count — even 0 (§5) */
    }
    var ma = el('sncMarkAll'), cr = el('sncClearRead');
    var anyUnread = n > 0;
    var anyReadVisible = records.some(function (r) { return isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r); });
    if (ma) ma.style.display = anyUnread ? '' : 'none';
    if (cr) cr.style.display = anyReadVisible ? '' : 'none';
  }

  function skeleton() {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<div class="snc-card snc-sk" aria-hidden="true"><div class="snc-sk-ico"></div><div class="snc-sk-lines"><div class="snc-sk-l" style="width:70%"></div><div class="snc-sk-l" style="width:45%"></div><div class="snc-sk-l snc-sk-s" style="width:25%"></div></div></div>';
    return s;
  }

  /* ── Cards (§7) ─────────────────────────────────────────────────── */
  function thumbOf(rec) {
    return (rec.poster_url && /^https:\/\//.test(String(rec.poster_url))) ? String(rec.poster_url) : '';
  }
  function ctaLabel(rec) {
    return (rec.cta && String(rec.cta).slice(0, 40)) || typeMeta(rec.type).cta;
  }

  function card(rec) {
    var meta   = typeMeta(rec.type);
    var unread = !isRead(rec.id);
    var open   = (expandedId === rec.id);
    var thumb  = thumbOf(rec);
    var high   = String(rec.priority || '').toUpperCase() === 'HIGH';
    var hasDest = !!actionFor(rec);
    var act = 'SNC.toggleCard(\'' + esc(rec.id) + '\')';
    var keyNav = 'if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + act + '}';
    var h =
    '<article class="snc-card' + (unread ? ' unread' : '') + (high ? ' high' : '') + (open ? ' expanded' : '') + '" tabindex="0" role="button"' +
      ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' aria-label="' + esc((unread ? 'Unread notification: ' : '') + (high ? 'Urgent: ' : '') + meta.label + ' — ' + rec.title) + '"' +
      ' onclick="' + act + '" onkeydown="' + keyNav + '">' +
      (open && thumb
        ? '<img class="snc-poster" src="' + esc(thumb) + '" alt="" width="640" height="360" loading="lazy" onerror="this.style.display=\'none\'">'
        : '') +
      (!open && thumb
        ? '<img class="snc-thumb" src="' + esc(thumb) + '" alt="" width="64" height="64" loading="lazy" onerror="this.style.display=\'none\'">'
        : '') +
      '<span class="snc-ico' + (thumb ? ' has-thumb' : '') + '" aria-hidden="true">' + (rec.icon && rec.icon.length < 4 ? esc(rec.icon) : meta.icon) + '</span>' +
      '<div class="snc-body">' +
        '<div class="snc-card-top">' +
          '<span class="snc-cat">' + esc(meta.label) + '</span>' +
          (high ? '<span class="snc-urgent">URGENT</span>' : '') +
          (unread ? '<span class="snc-dot" title="Unread" aria-hidden="true"></span>' : '') +
          '<time class="snc-time" datetime="' + esc(rec.published_at || '') + '">' + esc(timeAgo(rec.published_at)) + '</time>' +
        '</div>' +
        '<h3 class="snc-title">' + esc(rec.title) + '</h3>' +
        (rec.message && !open ? '<p class="snc-msg">' + esc(rec.message) + '</p>' : '') +
      '</div>' +
      (!open ? '<button class="snc-cta" onclick="event.stopPropagation();SNC.cta(\'' + esc(rec.id) + '\')">' + esc(ctaLabel(rec)) + ' →</button>' : '') +
      (open ? '<span class="snc-chev" aria-hidden="true">▾</span>' : '');
    /* §10 — expanded detail: full content, poster, category, exact time, CTA */
    if (open) {
      h += '<div class="snc-detail">' +
        (rec.message ? '<p class="snc-detail-msg">' + esc(rec.message) + '</p>' : '') +
        '<p class="snc-detail-meta">' + esc(meta.label) + ' • ' + esc(exactTime(rec.published_at)) + '</p>' +
        '<div class="snc-detail-actions">' +
          (hasDest
            ? '<button class="snc-primary-btn" onclick="event.stopPropagation();SNC.cta(\'' + esc(rec.id) + '\')">' + esc(ctaLabel(rec)) + ' →</button>'
            /* §11 — honest fallback, never a blind homepage jump */
            : '<p class="snc-detail-na">Sorry, this content is no longer available.</p>' +
              '<button class="snc-ghost-btn" onclick="event.stopPropagation();SNC.explore()">Explore Studyria</button>') +
        '</div>' +
      '</div>';
    }
    h += '</article>';
    return h;
  }

  /* §16 — deterministic same-day grouping for study-material floods.
     Only PDF, only ≥3 same-day, never HIGH, never jobs/ADRE/general. */
  function groupable(rec) {
    return String(rec.type) === 'PDF' && String(rec.priority || '').toUpperCase() !== 'HIGH';
  }
  function groupCard(key, items) {
    var newest = items[0];
    var anyUnread = items.some(function (r) { return !isRead(r.id); });
    var open = !!groupOpen[key];
    var titles = items.slice(0, 2).map(function (r) { return r.title; }).join(' • ');
    if (items.length > 2) titles += ' +' + (items.length - 2) + ' more';
    var h =
    '<div class="snc-group' + (open ? ' open' : '') + '">' +
      '<article class="snc-card snc-grp' + (anyUnread ? ' unread' : '') + '" tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '"' +
        ' aria-label="Group: ' + items.length + ' new study materials"' +
        ' onclick="SNC.toggleGroup(\'' + key + '\')"' +
        ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();SNC.toggleGroup(\'' + key + '\')}">' +
        '<span class="snc-ico" aria-hidden="true">📚</span>' +
        '<div class="snc-body">' +
          '<div class="snc-card-top">' +
            '<span class="snc-cat">Study Material</span>' +
            (anyUnread ? '<span class="snc-dot" title="Unread" aria-hidden="true"></span>' : '') +
            '<time class="snc-time">' + esc(timeAgo(newest.published_at)) + '</time>' +
          '</div>' +
          '<h3 class="snc-title">' + items.length + ' New Study Materials</h3>' +
          '<p class="snc-msg">' + esc(titles) + '</p>' +
        '</div>' +
        '<button class="snc-cta" onclick="event.stopPropagation();SNC.toggleGroup(\'' + key + '\')">' + (open ? 'Hide' : 'View All') + ' →</button>' +
      '</article>' +
      '<div class="snc-grp-actions"><button class="snc-ghost-btn snc-grp-explore" onclick="SNC.explore()">Explore Materials</button></div>';
    if (open) {
      h += '<div class="snc-grp-list">';
      for (var i = 0; i < items.length; i++) h += card(items[i]);
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  /* ── List: day sections TODAY / YESTERDAY / EARLIER (§4, §25) ──── */
  function dayBucket(iso) {
    var t = iso ? new Date(iso).getTime() : 0;
    if (t && dayKey(new Date(t)) === dayKey(new Date())) return 'TODAY';
    if (t && dayKey(new Date(t)) === dayKey(new Date(Date.now() - 864e5))) return 'YESTERDAY';
    return 'EARLIER';
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
    var page = list.slice(0, shown);   /* §24 — paginate history, 10 at a time */
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

    /* order: newest first (snLive is already newest-first) */
    var buckets = { TODAY: [], YESTERDAY: [], EARLIER: [] };
    for (var i = 0; i < page.length; i++) buckets[dayBucket(page[i].published_at)].push(page[i]);

    var html = '';
    ['TODAY', 'YESTERDAY', 'EARLIER'].forEach(function (b) {
      if (!buckets[b].length) return;
      html += '<div class="snc-day" role="heading" aria-level="2">' + b + '</div>';
      /* §16 — group same-day PDF floods in this bucket */
      var grp = [], singles = [];
      for (var j = 0; j < buckets[b].length; j++) {
        if (groupable(buckets[b][j])) grp.push(buckets[b][j]);
      }
      var grpKey = grp.length && grp.length >= 3 ? 'pdf-' + dayKey(grp[0].published_at) : null;
      for (var k = 0; k < buckets[b].length; k++) {
        var rr = buckets[b][k];
        if (grpKey && groupable(rr)) continue;   // rendered inside the group
        singles.push(rr);
      }
      if (grpKey) {
        html += groupCard(grpKey, grp);
      }
      for (var m = 0; m < singles.length; m++) html += card(singles[m]);
    });
    var remaining = list.length - page.length;
    if (remaining > 0) {
      html += '<div class="snc-more"><button class="snc-ghost-btn" onclick="SNC.loadMore()">Load more (' + remaining + ')</button></div>';
    }
    box.innerHTML = html;
  }

  /* ── Settings: real push status (§20, §21) + toggle-row prefs ──── */
  var pushBusy = false;
  function renderSettings() {
    var box = el('sncPushCard');
    if (box) {
      if (!(window.SN && SN.push)) { box.innerHTML = ''; }
      else {
        box.innerHTML = '<div class="snc-card snc-set-card"><div class="snc-sk-lines"><div class="snc-sk-l snc-sk-s" style="width:40%"></div></div></div>';
        SN.push.status().then(function (st) {
          if (!el('sncPushCard')) return;
          var on = st.subscribed;   /* REAL subscription state (§21) */
          var sub = '', btns = '';
          if (on) {
            sub = 'Push alerts are enabled on this device — updates arrive even when the site is closed.';
            btns = '<button class="snc-linkbtn" onclick="SNC.pushSelfTest()">🧪 Send Test</button>';
          } else if (st.permission === 'denied') {
            sub = 'Notifications are blocked in your browser. Open your browser menu → Site settings → Notifications → Allow, then tap below.';
          } else if (st.permission === 'unsupported') {
            sub = 'Push notifications aren\'t supported in this browser. Try Chrome, Edge, or install the Studyria app.';
          } else {
            sub = 'Choose what you want to receive. Turn on to get notified the moment new PDFs, jobs, quizzes, mock tests and exam alerts drop.';
          }
          var canToggle = st.permission !== 'unsupported';
          box.innerHTML = '<div class="snc-card snc-set-card">' +
            '<div class="snc-row">' +
              '<div class="snc-row-txt"><span class="snc-row-name">🔔 Push Notifications</span><span class="snc-row-sub">' + esc(sub) + '</span></div>' +
              (canToggle
                ? '<label class="snc-switch" aria-label="Push notifications ' + (on ? 'on' : 'off') + '">' +
                    '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="SNC.pushToggle()"' +
                    (pushBusy ? ' disabled' : '') + '><span class="snc-sw-track"><span class="snc-sw-knob"></span></span></label>'
                : '<span class="snc-pill na">N/A</span>') +
            '</div>' +
            (btns ? '<div class="snc-row-btns">' + btns + '</div>' : '') +
          '</div>';
        }).catch(function () { box.innerHTML = ''; });
      }
    }
    var pb = el('sncPrefsCard');
    if (pb) {
      var rows = '';
      PREF_CATEGORIES.forEach(function (c) {
        rows += '<div class="snc-card snc-set-card"><div class="snc-row">' +
          '<div class="snc-row-txt"><span class="snc-row-name">' + TYPES[c].icon + ' ' + esc(TYPES[c].label) + '</span></div>' +
          '<label class="snc-switch" aria-label="' + esc(TYPES[c].label) + ' notifications">' +
            '<input type="checkbox" ' + (prefs[c] !== false ? 'checked' : '') +
            ' onchange="SNC.setPref(\'' + c + '\', this.checked)"><span class="snc-sw-track"><span class="snc-sw-knob"></span></span></label>' +
        '</div></div>';
      });
      pb.innerHTML = rows +
        '<p class="snc-note">Your choices shape which updates appear in this Notification Center.</p>';
    }
  }

  /* ── Guest view: sign-in wall, guest push setup preserved (§19/§46) ── */
  function renderGuest(host) {
    host.innerHTML = (
      '<div class="snc-wrap">' +
        '<header class="snc-head">' +
          '<div class="snc-head-ico" aria-hidden="true">🔔</div>' +
          '<div><h1 class="snc-h1">Notifications</h1>' +
          '<p class="snc-sub">Stay ahead with the latest from Studyria.</p></div>' +
        '</header>' +
        '<div class="snc-state" style="padding:36px 20px">' +
          '<div class="snc-state-ico" aria-hidden="true">🔔</div>' +
          '<p class="snc-state-t">Sign in to view your notifications</p>' +
          '<p class="snc-state-s">Your notification history, read state and preferences are tied to your Studyria account.</p>' +
          '<button class="snc-primary-btn" onclick="SNC.goSignIn()">Sign In</button>' +
        '</div>' +
        '<section class="snc-settings" aria-label="Device push settings">' +
          '<h2 class="snc-set-h">⚙️ Notification Preferences</h2>' +
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
    fetchHistory().then(function (list) {
      loading = false;
      /* key by id — one event appears exactly once, regardless of
         realtime reconnect / retry / poll overlap (§17 duplicate protection) */
      records = dedupe(list);
      syncPushClickRead();
      updateBadges(unreadCount());
      if (isPageActive()) { renderList(); renderToolbarCounts(); }
    }).catch(function () {
      loading = false; loadErr = true;
      if (isPageActive()) renderList();
    });
  }
  function startPoll() { stopPoll(); pollTimer = setInterval(load, POLL_MS); }
  function stopPoll()  { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  /* Push tap (?notif=<descriptor>) → the descriptor equals the record's
     destination → mark that notification read for this user (§44-J) */
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
  function badgeCountFrom(list) {
    return dedupe(list).filter(function (r) {
      return !isRead(r.id) && !isCleared(r.id) && allowedByPrefs(r);
    }).length;
  }
  function updateBadgesAsync() {
    fetchLive().then(function (list) {
      updateBadges(badgeCountFrom(list));
    }).catch(function () {});
  }

  /* ── Direct URL /notifications → SPA hash route (before boot read) ─ */
  if (location.pathname === '/notifications' || location.pathname === '/notifications/') {
    try { history.replaceState({ page: 'notifications' }, '', '#notifications'); } catch (e) {}
  }

  /* ── Brand styles — Paper Cream + Maroon + Gold, mobile-first ──── */
  function injectStyles() {
    if (el('snc-styles')) return;
    var s = document.createElement('style');
    s.id = 'snc-styles';
    s.textContent = [
      '#page-notifications{padding:24px 16px 48px;max-width:720px;margin:0 auto}',
      '.snc-wrap{animation:sncFade .25s ease}',
      '@keyframes sncFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.snc-head{display:flex;align-items:center;gap:14px;margin:6px 0 16px}',
      '.snc-head-ico{width:52px;height:52px;border-radius:16px;background:rgba(147,2,5,.09);border:1px solid rgba(201,154,60,.35);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex:0 0 auto}',
      '.snc-h1{font-size:1.5rem;font-weight:800;margin:0;color:var(--hp-ink,#2b1c1c);font-family:var(--font-editorial,inherit)}',
      '.snc-sub{margin:2px 0 0;font-size:.85rem;color:var(--text2,rgba(43,28,28,.6))}',
      '.snc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
      '.snc-chip{border:1px solid rgba(147,2,5,.18);background:transparent;color:var(--hp-ink,#2b1c1c);border-radius:999px;padding:7px 15px;font-size:.78rem;font-weight:700;cursor:pointer;min-height:36px;transition:all .15s;font-family:inherit}',
      '.snc-chip.on{background:#930205;color:#faf6ef;border-color:#930205}',
      '.snc-chip:focus-visible,.snc-linkbtn:focus-visible,.snc-cta:focus-visible,.snc-card:focus-visible,.snc-primary-btn:focus-visible,.snc-ghost-btn:focus-visible,.snc-switch input:focus-visible + .snc-sw-track{outline:2px solid #c99a3c;outline-offset:2px}',
      '.snc-tb-actions{margin-left:auto;display:flex;gap:10px}',
      '.snc-linkbtn{background:none;border:none;color:#930205;font-size:.76rem;font-weight:700;cursor:pointer;padding:8px 4px;min-height:36px;font-family:inherit}',
      /* day sections */
      '.snc-day{font-size:.68rem;font-weight:800;letter-spacing:.12em;color:var(--text2,rgba(43,28,28,.5));margin:16px 2px 8px;padding-bottom:6px;border-bottom:1px solid rgba(147,2,5,.10)}',
      'body.dark .snc-day{border-bottom-color:rgba(255,255,255,.08)}',
      /* cards */
      '.snc-card{display:flex;align-items:center;gap:12px;background:#faf6ef;border:1px solid rgba(147,2,5,.10);border-radius:16px;padding:14px;margin-bottom:10px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s;overflow:hidden}',
      '.snc-card:hover{border-color:rgba(147,2,5,.28);box-shadow:0 2px 10px rgba(43,28,28,.06)}',
      'body.dark .snc-card{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08)}',
      '.snc-card.unread{border-left:3px solid #930205;background:#fdfaf3}',
      'body.dark .snc-card.unread{border-left-color:#c99a3c}',
      /* §8 — HIGH priority: subtle gold accent, never huge red blocks */
      '.snc-card.high{border-left:3px solid #c99a3c}',
      '.snc-card.high.unread{border-left-color:#c99a3c}',
      '.snc-urgent{font-size:.6rem;font-weight:800;letter-spacing:.08em;color:#8a6a1e;background:rgba(201,154,60,.16);border:1px solid rgba(201,154,60,.35);border-radius:6px;padding:1px 6px}',
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
      '.snc-chev{color:var(--text2,rgba(43,28,28,.45));font-size:.8rem;flex:0 0 auto;transition:transform .2s}',
      /* expanded detail (§10) */
      '.snc-card.expanded{flex-wrap:wrap;cursor:default}',
      '.snc-card.expanded .snc-body{flex-basis:100%;order:2}',
      '.snc-poster{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;flex-basis:100%;order:1;background:rgba(147,2,5,.06)}',
      '.snc-card.expanded .snc-ico{display:none}',
      '.snc-detail{flex-basis:100%;order:3}',
      '.snc-card.expanded .snc-chev{order:4;transform:rotate(180deg);flex-basis:auto}',
      '.snc-detail-msg{margin:0 0 6px;font-size:.88rem;color:var(--hp-ink,#2b1c1c);line-height:1.55}',
      '.snc-detail-meta{margin:0 0 12px;font-size:.7rem;color:var(--text2,rgba(43,28,28,.5))}',
      '.snc-detail-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.snc-detail-na{margin:0;font-size:.8rem;font-style:italic;color:var(--text2,rgba(43,28,28,.6))}',
      /* grouping (§16) */
      '.snc-group{margin-bottom:10px}',
      '.snc-grp-actions{display:flex;justify-content:center;margin-top:-4px;margin-bottom:10px}',
      '.snc-grp-explore{padding:8px 16px;min-height:36px;font-size:.72rem}',
      '.snc-grp-list{margin-top:2px}',
      '.snc-grp-list .snc-card{background:#fdfaf3}',
      'body.dark .snc-grp-list .snc-card{background:rgba(255,255,255,.04)}',
      /* skeleton (CLS-safe reserved space) */
      '.snc-sk{pointer-events:none}',
      '.snc-sk-ico{width:46px;height:46px;border-radius:13px;background:rgba(147,2,5,.08);flex:0 0 auto;animation:sncSh 1.2s ease-in-out infinite}',
      '.snc-sk-lines{flex:1;display:flex;flex-direction:column;gap:8px}',
      '.snc-sk-l{height:12px;border-radius:6px;background:rgba(147,2,5,.08);animation:sncSh 1.2s ease-in-out infinite}',
      '.snc-sk-s{height:9px}',
      '@keyframes sncSh{0%,100%{opacity:.5}50%{opacity:1}}',
      /* states */
      '.snc-state{text-align:center;padding:40px 16px;background:#faf6ef;border:1px solid rgba(147,2,5,.10);border-radius:16px}',
      'body.dark .snc-state{background:rgba(255,255,255,.04)}',
      '.snc-state-ico{font-size:2.2rem;margin-bottom:8px}',
      '.snc-state-t{font-weight:800;font-size:1rem;margin:0 0 6px;color:var(--hp-ink,#2b1c1c)}',
      '.snc-state-s{font-size:.82rem;color:var(--text2,rgba(43,28,28,.6));margin:0 0 16px}',
      /* settings — visually secondary, toggle rows (§20) */
      '.snc-settings{margin-top:28px}',
      '.snc-set-h{font-size:.95rem;font-weight:800;color:var(--hp-ink,#2b1c1c);margin:0 0 10px}',
      '.snc-set-card{cursor:default;align-items:center;margin-bottom:8px;padding:12px 14px}',
      '.snc-row{display:flex;align-items:center;gap:12px;width:100%}',
      '.snc-row-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.snc-row-name{font-weight:700;font-size:.85rem;color:var(--hp-ink,#2b1c1c)}',
      '.snc-row-sub{font-size:.72rem;color:var(--text2,rgba(43,28,28,.55));line-height:1.45}',
      '.snc-row-btns{margin-top:10px}',
      '.snc-pill{font-size:.68rem;font-weight:800;padding:4px 10px;border-radius:999px}',
      '.snc-pill.na{background:rgba(148,163,184,.14);color:#94a3b8;border:1px solid rgba(148,163,184,.3)}',
      /* accessible toggle switch */
      '.snc-switch{position:relative;display:inline-block;flex:0 0 auto}',
      '.snc-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}',
      '.snc-sw-track{display:block;width:44px;height:25px;border-radius:999px;background:rgba(147,2,5,.15);border:1px solid rgba(147,2,5,.18);transition:background .2s,border-color .2s;position:relative}',
      '.snc-sw-knob{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#faf6ef;box-shadow:0 1px 3px rgba(43,28,28,.25);transition:transform .2s}',
      '.snc-switch input:checked + .snc-sw-track{background:#930205;border-color:#930205}',
      '.snc-switch input:checked + .snc-sw-track .snc-sw-knob{transform:translateX(19px)}',
      '.snc-switch input:disabled + .snc-sw-track{opacity:.5}',
      '.snc-primary-btn{background:#930205;color:#faf6ef;border:none;border-radius:999px;padding:11px 20px;font-size:.8rem;font-weight:800;cursor:pointer;min-height:42px;font-family:inherit}',
      '.snc-primary-btn:active{transform:scale(.97)}',
      '.snc-ghost-btn{background:transparent;border:1px solid rgba(147,2,5,.25);color:#930205;border-radius:999px;padding:11px 20px;font-size:.8rem;font-weight:700;cursor:pointer;min-height:42px;font-family:inherit}',
      '.snc-note{margin:2px 0 0;font-size:.7rem;color:var(--text2,rgba(43,28,28,.5))}',
      /* burger badge */
      '.snc-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;margin-left:auto;border-radius:999px;background:#930205;color:#faf6ef;font-size:.66rem;font-weight:800}',
      /* mobile 360–430px (§33) */
      '@media(max-width:767px){#page-notifications{padding:16px 12px 42px}.snc-card{flex-wrap:wrap;padding:12px}.snc-cta{width:100%;order:4;margin-top:2px}.snc-chev{display:none}.snc-h1{font-size:1.3rem}.snc-tb-actions{width:100%;margin-left:0;justify-content:space-between}.snc-detail-actions{flex-direction:column;align-items:stretch}.snc-detail-actions .snc-primary-btn,.snc-detail-actions .snc-ghost-btn{width:100%;text-align:center}}',
      '.snc-more{display:flex;justify-content:center;margin-top:6px}',
      '.snc-more .snc-ghost-btn{min-height:38px;padding:9px 18px;font-size:.74rem}',
      /* §35 — respect reduced motion */
      '@media(prefers-reduced-motion:reduce){.snc-wrap,.snc-chev,.snc-sw-knob,.snc-sw-track{animation:none !important;transition:none !important}}'
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
