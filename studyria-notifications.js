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
  /* ── Canonical page-id resolver (notif spec §2/§4): case-insensitive,
     alias-aware, and EXISTENCE-checked against the real SPA page ids.
     Returns '' for unknown pages so every caller falls back honestly —
     never a blank page, never a blind homepage redirect for valid pages. */
  var PAGE_ALIASES = { homepage: 'home', main: 'home', index: 'home', start: 'home' };
  function resolvePageId(val) {
    var v = String(val == null ? '' : val).trim().toLowerCase();
    if (!/^[a-z0-9\-]{1,60}$/.test(v)) return '';
    if (PAGE_ALIASES[v]) v = PAGE_ALIASES[v];
    try { if (document.getElementById('page-' + v)) return v; } catch (e) {}
    return '';
  }

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
        return "navigate('brainlab');__blReady(function(){BrainLab.switchTab('quiz')})";
      case 'mock':
        return "navigate('brainlab');__blReady(function(){BrainLab.switchTab('mock')})";
      case 'affair':
        return "navigate('brainlab');__blReady(function(){BrainLab.switchTab('affairs')})";
      case 'page': {
        /* FIX: only emit navigation for REAL page ids (handles legacy
           destinations like page:Homepage case-insensitively); unknown
           page ids resolve to '' → the card shows the honest fallback. */
        var pid = resolvePageId(val);
        return pid ? "navigate('" + escAttr(pid) + "')" : '';
      }
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
          id: n.id,
          type: rawType.toLowerCase(),
          typeLabel: meta.label,
          title: n.title || 'Update',
          message: n.message || '',
          time: n.published_at || null,
          icon: n.icon || meta.icon,
          poster_url: n.poster_url || '',
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

  /* ═══════════ PREMIUM NOTIFICATION COMPOSER (additive) ═══════════
   * Five professional presets + live preview + per-notification custom
   * banners + drafts + duplicate/reuse. ZERO backend changes: presets map
   * onto existing whitelisted fields (type/icon/priority/destination),
   * banners live in Supabase Storage at a deterministic public path and
   * are probed by the feed with automatic snPoster fallback. The admin
   * mutation payload stays byte-identical to the previous implementation.
   * ──────────────────────────────────────────────────────────────── */
  /* 'covers' is the existing public-read bucket (book covers) — the only
   * banner-capable bucket that actually exists in Supabase Storage.
   * 'sn-banners' is kept as a forward-compatible second probe target
   * (used only if that bucket is ever created). Uploads go through the
   * same admin-authenticated window.supabaseClient that already writes
   * book covers today — no credentials, no policy changes. */
  var SN_BANNER_BUCKETS = ['covers', 'sn-banners'];
  var SN_BANNER_PATH = function (id) { return 'sn-banners/' + id + '.jpg'; };
  var SN_BANNER_PUBLIC = function (bucket, id) {
    return 'https://qsdfmgcekdpjdcyqhuhi.supabase.co/storage/v1/object/public/' + bucket + '/' + SN_BANNER_PATH(id);
  };
  var SN_BANNER_MAX_RAW = 5 * 1024 * 1024;
  var SN_BANNER_W = 1200, SN_BANNER_H = 630; /* recommended aspect 1.9:1 */

  var PRESETS = [
    { id: 'study',    name: 'Study Material',        icon: '📚', type: 'PDF',       priority: 'normal', style: 'material',
      desc: 'Academic / study-focused · clean premium education look' },
    { id: 'trending',name: 'New & Trending',        icon: '🔥', type: 'CATEGORY',  priority: 'high',  style: 'affairs',
      desc: 'High-attention announcement style for newly released content' },
    { id: 'exam',    name: 'Exam / Mock Test',      icon: '🎯', type: 'MOCK_TEST', priority: 'high',  style: 'mock',
      desc: 'Competitive-exam focused · strong CTA hierarchy' },
    { id: 'jobs',    name: 'Jobs / Career',         icon: '💼', type: 'JOB',       priority: 'normal', style: 'job',
      desc: 'Professional career-oriented visual hierarchy' },
    { id: 'announce',name: 'Important Announcement',icon: '📢', type: 'GENERAL',   priority: 'high',  style: 'classic',
      desc: 'Premium announcement / alert style' },
    { id: 'adre',    name: 'ADRE Special',          icon: '🏛️', type: 'ADRE',     priority: 'normal', style: 'adre',
      desc: 'Assam Direct Recruitment papers & updates' },
    { id: 'affairs', name: 'Current Affairs',       icon: '📰', type: 'CURRENT_AFFAIRS', priority: 'normal', style: 'affairs',
      desc: 'Daily current-affairs updates' },
    { id: 'feature', name: 'New Feature',          icon: '✨', type: 'GENERAL',   priority: 'normal', style: 'feature',
      desc: 'Something new on Studyria — Try Now CTA' },
    { id: 'premium', name: 'Premium Announcement', icon: '👑', type: 'GENERAL',   priority: 'high',  style: 'premium',
      desc: 'Pass / premium content announcement — gold look' },
    { id: 'urgent',  name: 'Important Alert',       icon: '🚨', type: 'GENERAL',   priority: 'high',  style: 'alert',
      desc: 'Urgent alerts — deadline, exam date, urgent update' }
  ];

  /* Mirror of sw.js PUSH_TEMPLATE — the preview shows EXACTLY what the
     service worker will render on device. Keep in sync with sw.js. */
  var SN_PUSH_TEMPLATES = {
    pdf:    { title: '📚 New Study Material Added', cta: 'Read Now →' },
    job:    { title: '💼 New Job Alert',             cta: 'View Job →' },
    quiz:   { title: '📝 New Quiz Available',        cta: 'Start Quiz →' },
    mock:   { title: '🎯 New Mock Test',             cta: 'Take Test →' },
    affair: { title: '📰 New Current Affairs',      cta: 'Read Now →' }
  };
  var SN_KIND_BY_TYPE = { PDF:'pdf', JOB:'job', QUIZ:'quiz', MOCK_TEST:'mock', CURRENT_AFFAIRS:'affair' };

  function _composer() {
    window.__snComposer = window.__snComposer || {
      presetId: 'study',
      banner: { staged: null, existing: null, fit: 'cover', busy: false },
      previewTab: 'android',
      pvTimer: null
    };
    return window.__snComposer;
  }

  function _field(id) { return document.getElementById(id); }
  function _fv(id) { var el = _field(id); return el ? String(el.value || '') : ''; }

  function _drafts() {
    try { return JSON.parse(localStorage.getItem('snDraftsV1') || '[]'); } catch (e) { return []; }
  }
  function _draftsSave(arr) { try { localStorage.setItem('snDraftsV1', JSON.stringify(arr.slice(0, 20))); } catch (e) {} }

  /* Deterministic custom-banner probe for a notification id.
     Feed side uses the same public URLs — hit → custom banner,
     miss → automatic snPoster fallback. */
  function bannerUrls(id) {
    return SN_BANNER_BUCKETS.map(function (b) { return SN_BANNER_PUBLIC(b, id); });
  }
  function probeBanner(id) {
    return new Promise(function (resolve) {
      var urls = bannerUrls(id), i = 0;
      (function next() {
        if (i >= urls.length) return resolve(null);
        var img = new Image();
        img.onload = function () { resolve(urls[i]); };
        img.onerror = function () { i++; next(); };
        img.src = urls[i];
      })();
    });
  }

  /* Apply a preset — only touches UNSET/derived fields so admin content
     is never destroyed. Changing preset keeps title/message/etc. */
  function applyPreset(pid, opts) {
    var p = PRESETS.filter(function (x) { return x.id === pid; })[0];
    if (!p) return;
    var c = _composer();
    c.presetId = pid;
    var t = _field('snType'), pr = _field('snPriority'), ic = _field('snIcon');
    if (t) t.value = p.type;
    if (pr) pr.value = p.priority;
    if (ic && (opts && opts.forceIcon || !_fv('snIcon'))) ic.value = p.icon;
    _renderPresetCards();
    _renderPreviewNow();
  }

  function _renderPresetCards() {
    var wrap = _field('snPresetRow');
    if (!wrap) return;
    var c = _composer();
    wrap.innerHTML = PRESETS.map(function (p) {
      var on = c.presetId === p.id;
      return '<button type="button" class="sn-preset-card' + (on ? ' sn-preset-on' : '') + '" onclick="SN.preset(\'' + p.id + '\')"'
        + ' aria-pressed="' + on + '" title="' + _escHtml(p.desc) + '">'
        + '<span class="sn-preset-ico">' + p.icon + '</span>'
        + '<span class="sn-preset-name">' + _escHtml(p.name) + '</span>'
        + '<span class="sn-preset-type">' + _escHtml(TYPE_META[p.type] ? TYPE_META[p.type].label : p.type) + '</span>'
        + '</button>';
    }).join('');
  }

  /* ── Live preview — renders EXACTLY what production renders ──── */
  function _pvDebounced() {
    var c = _composer();
    clearTimeout(c.pvTimer);
    c.pvTimer = setTimeout(_renderPreviewNow, 140);
  }

  function _previewRecord() {
    var kind = SN_KIND_BY_TYPE[_fv('snType')] || '';
    var tmpl = kind ? SN_PUSH_TEMPLATES[kind] : null;
    var title = _fv('snTitle') || 'Your notification title';
    var message = _fv('snMessage');
    var icon = _fv('snIcon') || (TYPE_META[_fv('snType')] || TYPE_META.GENERAL).icon;
    var pushTitle = title, pushBody = message;
    /* exact sw.js logic: template title when the content title isn't
       already emoji-branded; content title preserved in the body */
    if (tmpl && !/^[📚💼📝🎯📰🗂️]/u.test(title)) {
      pushTitle = tmpl.title;
      pushBody = title + (message ? ' — ' + message : '');
    }
    var meta = TYPE_META[_fv('snType')] || TYPE_META.GENERAL;
    return {
      kind: kind, tmpl: tmpl, title: title, message: message, icon: icon,
      pushTitle: pushTitle, pushBody: pushBody, priority: _fv('snPriority') || 'normal',
      typeLabel: meta.label, cta: meta.cta, presetId: _composer().presetId,
      banner: _stagedBannerUrl() || _composer().banner.existing
    };
  }

  function _stagedBannerUrl() {
    var b = _composer().banner;
    return b.staged ? b.staged.dataUrl : null;
  }

  function _presetStyle() {
    var p = PRESETS.filter(function (x) { return x.id === _composer().presetId; })[0];
    return (p && p.style) || 'classic';
  }

  function _posterUrl(r, w) {
    return 'https://superagent-f8acee03.base44.app/functions/snPoster?type='
      + encodeURIComponent(_fv('snType') || 'GENERAL') + '&title=' + encodeURIComponent(r.title || 'Studyria')
      + '&sub=' + encodeURIComponent(r.message || '') + '&style=' + encodeURIComponent(_presetStyle())
      + (w ? '&w=' + w : '');
  }

  /* ── pre-send validation (spec §23) — live, honest, blocks bad sends ── */
  function _renderValBox(mode) {
    var box = _field('snValBox');
    if (!box) return true;
    var title = _fv('snTitle').trim();
    var msg = _fv('snMessage').trim();
    var kind = _fv('snDestKind');
    var val = _fv('snDestVal').trim();
    var exp = _fv('snExpires');
    var pub = _fv('snPublishAt');
    var items = [];
    var ok = function (b, l) { items.push('<div><span style="color:' + (b ? '#10d98e' : '#ff6b85') + '">' + (b ? '✓' : '✗') + '</span> ' + l + '</div>'); };
    ok(title.length >= 3 && title.length <= 65, '<b>Title</b> ' + (title ? '(' + title.length + ' chars)' : '— 3–65 characters'));
    ok(msg.length === 0 || msg.length >= 5, '<b>Message</b>' + (msg.length ? '' : ' (empty is allowed, 5+ recommended)'));
    var dOk = true;
    if (kind === 'page') dOk = /^[a-z0-9\-]{1,60}$/i.test(val) && !!resolvePageId(val);
    else if (kind === 'url') dOk = /^https:\/\/studyria\.qzz\.io(\/|$|\?|#)/.test(val);
    if (kind) ok(dOk, '<b>Destination</b> ' + (dOk ? 'opens a real Studyria page' : (kind === 'url' ? 'must be https://studyria.qzz.io/…' : 'must be a real Studyria page id (home, library, career-hub…)')));
    ok(!exp || new Date(exp).getTime() > Date.now() + 60000, '<b>Expiry</b>' + (exp ? '' : ' — none'));
    var schedMsg = '';
    if (mode === 'schedule') {
      var pOk = !!pub && new Date(pub).getTime() > Date.now() + 120000;
      ok(pOk, '<b>Schedule time</b> — at least 2 minutes ahead');
      schedMsg = pOk ? ' — will appear in Live Feed and push at that time' : '';
    }
    var allOk = true;
    for (var i = 0; i < items.length; i++) if (items[i].indexOf('✗') !== -1) { allOk = false; break; }
    var btn = _field('snSaveBtn');
    if (btn && mode !== 'draft') btn.disabled = !allOk;
    var sb = _field('snSchedBtn');
    box.innerHTML = '<div style="font-size:.74rem;line-height:1.7">' + items.join('') +
      (allOk && mode !== 'schedule' ? '<div style="color:#10d98e;font-weight:700;margin-top:4px">✓ Ready to Send</div>' : '') + '</div>';
    return allOk;
  }

  function _renderPreviewNow() {
    var host = _field('snPreviewHost');
    if (!host) return;
    var c = _composer();
    var r = _previewRecord();
    var bannerSrc = r.banner || _posterUrl(r);
    var tabs = _field('snPvTabs');
    if (tabs) {
      tabs.innerHTML = ['android', 'desktop', 'feed'].map(function (t) {
        var lbl = t === 'android' ? '📱 Android' : t === 'desktop' ? '🖥️ Desktop' : '📰 Live Feed';
        return '<button type="button" class="sn-pv-tab' + (c.previewTab === t ? ' sn-pv-tab-on' : '') + '" onclick="SN.pvTab(\'' + t + '\')">' + lbl + '</button>';
      }).join('');
    }
    var html = '';
    if (c.previewTab === 'android' || c.previewTab === 'desktop') {
      var isAndroid = c.previewTab === 'android';
      html = '<div class="sn-pv-shade' + (isAndroid ? '' : ' sn-pv-desk') + '">'
        + '<div class="sn-pv-phone">'
          + '<div class="sn-pv-status"><span>9:41</span><span>📶 ▮▮▮</span></div>'
          + (isAndroid ? '' : '<div class="sn-pv-desk-hint">Chrome — desktop notification</div>')
          + '<div class="sn-pv-notif">'
            + '<div class="sn-pv-head"><img class="sn-pv-appico" src="/icon-192.png" alt="" onerror="this.style.display=\'none\'"/>'
            + '<span class="sn-pv-origin">studyria.qzz.io</span><span class="sn-pv-now">now</span></div>'
            + '<div class="sn-pv-body">'
              + '<div class="sn-pv-title">' + _escHtml(r.pushTitle) + '</div>'
              + (r.pushBody ? '<div class="sn-pv-text">' + _escHtml(r.pushBody) + '</div>' : '')
            + '</div>'
            + (r.tmpl ? '<div class="sn-pv-actions"><span class="sn-pv-cta">' + _escHtml(r.tmpl.cta) + '</span></div>' : '')
          + '</div>'
        + '</div></div>'
        + '<div class="sn-pv-note">' + (r.tmpl
            ? 'Branded template + CTA button — exactly what sw.js v94 renders on device.'
            : 'This type has no branded push template — sw.js renders the plain title (existing fallback).') + '</div>';
    } else {
      /* EXACT production feed card markup (ln-card) with real snPoster URL */
      html = '<div class="sn-pv-feedwrap">'
        + '<div class="ln-card" style="cursor:default">'
          + '<img class="ln-card-thumb" src="' + _escHtml(bannerSrc) + '" alt="" loading="lazy" onerror="this.remove()">'
          + '<div class="ln-card-icon">' + r.icon + '</div>'
          + '<div class="ln-card-body">'
            + '<div class="ln-card-title">' + _escHtml(r.title) + '</div>'
            + (r.message ? '<div class="ln-card-msg">' + _escHtml(r.message) + '</div>' : '')
            + '<div class="ln-card-time">just now</div>'
          + '</div>'
          + '<span class="ln-card-cta">' + _escHtml(r.cta) + ' →</span>'
          + '<span class="ln-card-type ln-type-' + (_fv('snType') || 'GENERAL').toLowerCase() + '">' + _escHtml(r.typeLabel) + '</span>'
        + '</div>'
        + (r.banner ? '<div class="sn-pv-note">Custom banner — will show in the Live Feed.</div>'
                    : '<div class="sn-pv-note">Auto-generated Studyria poster (snPoster) — one unique poster per notification.</div>')
        + '</div>';
    }
    host.innerHTML = html;
    _renderValBox();
  }

  /* ── Banner: validate → compress → stage; upload on publish/save ── */
  function bannerPick(input) {
    var c = _composer();
    var file = input && input.files && input.files[0];
    if (!file) return;
    var err = _field('snBannerMsg');
    var bad = function (m) { if (err) { err.style.display = ''; err.style.color = '#ff6b85'; err.textContent = '✗ ' + m; } };
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) { bad('Only JPG, PNG or WebP images are supported.'); input.value = ''; return; }
    if (file.size > SN_BANNER_MAX_RAW) { bad('File too large — max 5 MB (larger images are compressed after upload).'); input.value = ''; return; }
    c.banner.busy = true;
    if (err) { err.style.display = ''; err.style.color = 'var(--text2)'; err.textContent = '… compressing image'; }
    var reader = new FileReader();
    reader.onerror = function () { c.banner.busy = false; bad('Could not read this image.'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { c.banner.busy = false; bad('This file is not a valid image.'); };
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = SN_BANNER_W; canvas.height = SN_BANNER_H;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#F7F1E2'; ctx.fillRect(0, 0, SN_BANNER_W, SN_BANNER_H);
          var fit = c.banner.fit, s = Math.min(img.width / SN_BANNER_W, img.height / SN_BANNER_H);
          var dw = img.width / s, dh = img.height / s;
          if (fit === 'contain') {
            ctx.drawImage(img, (SN_BANNER_W - dw) / 2, (SN_BANNER_H - dh) / 2, dw, dh);
          } else { /* cover: center-crop */
            ctx.drawImage(img, (SN_BANNER_W - dw) / 2, (SN_BANNER_H - dh) / 2, dw, dh);
          }
          var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          c.banner.staged = { dataUrl: dataUrl, name: file.name };
          c.banner.busy = false;
          if (err) { err.style.display = ''; err.style.color = '#10d98e'; err.textContent = '✓ Banner ready — ' + Math.round(dataUrl.length / 1365) + ' KB compressed (' + (fit === 'contain' ? 'fit' : 'crop') + ')'; }
          _renderBannerBox();
          _renderPreviewNow();
        } catch (e) { c.banner.busy = false; bad('Could not process this image.'); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function _bannerImgError(imgEl) {
    var wrap = imgEl && imgEl.parentNode;
    if (wrap) wrap.innerHTML = '<div class="sn-banner-broken">\u26a0 image failed to load \u2014 will fall back to the Studyria poster</div>';
  }

  function _renderBannerBox() {
    var host = _field('snBannerBox');
    if (!host) return;
    var c = _composer();
    var showing = _stagedBannerUrl() || c.banner.existing;
    var staged = !!c.banner.staged;
    var isNewNote = !st_editingId() ? '<div class="sn-banner-note">Uploaded automatically after you publish.</div>' : '';
    host.innerHTML = showing
      ? '<div class="sn-banner-prev"><img src="' + _escHtml(showing) + '" alt="Banner preview" onerror="SN._bannerImgError(this)"/></div>'
        + '<div class="sn-banner-meta">' + (staged ? 'New banner staged' : 'Current custom banner') + '</div>'
        + '<div class="sn-banner-btns">'
          + '<label class="btn btn-ghost btn-sm" for="snBannerFile2">↻ Replace</label>'
          + '<button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="SN.bannerRemove()">🗑 Remove</button>'
        + '</div>'
        + '<input type="file" id="snBannerFile2" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="SN.bannerPick(this)"/>'
        + isNewNote
      : '<div class="sn-banner-empty">'
          + '<div class="sn-banner-empty-ico">🖼️</div>'
          + '<div>No custom banner — each notification automatically gets its own unique Studyria poster.</div>'
          + '<label class="btn btn-ghost btn-sm" for="snBannerFile1">⬆ Upload Banner</label>'
          + '<input type="file" id="snBannerFile1" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="SN.bannerPick(this)"/>'
        + '</div>';
  }

  function bannerRemove() {
    var c = _composer();
    if (c.banner.staged) {
      c.banner.staged = null;
      _renderBannerBox(); _renderPreviewNow();
      var err = _field('snBannerMsg'); if (err) { err.style.display = 'none'; }
      return;
    }
    if (c.banner.existing && st_editingId()) {
      /* delete from storage — feed falls back to the auto poster */
      var id = st_editingId();
      c.banner.busy = true;
      _sbStorage().then(function (sb) {
        var buckets = SN_BANNER_BUCKETS.slice();
        (function next() {
          if (!buckets.length) { c.banner.busy = false; return; }
          var b = buckets.shift();
          sb.storage.from(b).remove([SN_BANNER_PATH(id)]).then(function (res) {
            if (res && res.error) { next(); return; }
            c.banner.existing = null; c.banner.busy = false;
            _renderBannerBox(); _renderPreviewNow();
            var err = _field('snBannerMsg');
            if (err) { err.style.display = ''; err.style.color = '#10d98e'; err.textContent = '✓ Banner removed — auto poster restored'; }
          }).catch(next);
        })();
      }).catch(function (e) { c.banner.busy = false; _bannerErr('Could not remove: ' + (e.message || e)); });
    }
  }

  function _bannerErr(m) {
    var err = _field('snBannerMsg');
    if (err) { err.style.display = ''; err.style.color = '#ff6b85'; err.textContent = '✗ ' + m; }
  }

  function st_editingId() { return _state().editingId; }

  function _sbStorage() {
    return new Promise(function (resolve, reject) {
      var sb = window.supabaseClient;
      if (!sb || !sb.storage) { reject(new Error('Storage unavailable — log in again')); return; }
      resolve(sb);
    });
  }

  /* Upload the staged banner to the deterministic path for a notif id.
     Creates the dedicated bucket when the platform allows it, else uses
     the existing public bucket. Honest result reporting — no fakes. */
  function bannerUploadFor(id) {
    var c = _composer();
    if (!c.banner.staged || !id) return Promise.resolve({ ok: true, skipped: true });
    var dataUrl = c.banner.staged.dataUrl;
    c.banner.busy = true;
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      return _sbStorage().then(function (sb) {
        /* remember a bucket that already worked */
        var known = null;
        try { known = localStorage.getItem('snBannerBucket'); } catch (e) {}
        var order = known ? [known].concat(SN_BANNER_BUCKETS.filter(function (b) { return b !== known; })) : SN_BANNER_BUCKETS.slice();
        var i = 0;
        function tryNext() {
          if (i >= order.length) throw new Error('storage rejected the upload (bucket policy)');
          var bucket = order[i++];
          return sb.storage.from(bucket).upload(SN_BANNER_PATH(id), blob, { upsert: true, contentType: 'image/jpeg' })
            .then(function (res) {
              if (res && res.error) throw new Error(res.error.message || 'upload failed');
              try { localStorage.setItem('snBannerBucket', bucket); } catch (e) {}
              c.banner.busy = false;
              return { ok: true, bucket: bucket, url: SN_BANNER_PUBLIC(bucket, id), kb: Math.round(blob.size / 1024) };
            })
            .catch(function (e) {
              if (i < order.length) return tryNext();
              c.banner.busy = false;
              throw e;
            });
        }
        return tryNext();
      });
    });
  }

  /* ── Drafts (local-only — never auto-published) ──────────────── */
  function draftSave() {
    var r = {
      title: _fv('snTitle'), message: _fv('snMessage')
    };
    if (!r.title && !r.message) { alert('Nothing to save yet — add a title or message.'); return; }
    var c = _composer();
    var arr = _drafts();
    arr.unshift({
      id: 'draft-' + Date.now(), savedAt: new Date().toISOString(),
      presetId: c.presetId,
      fields: {
        title: r.title, message: r.message,
        type: _fv('snType'), priority: _fv('snPriority'), icon: _fv('snIcon'),
        destKind: _fv('snDestKind'), destVal: _fv('snDestVal'), expires: _fv('snExpires')
      },
      banner: c.banner.staged ? { fit: c.banner.fit, staged: (c.banner.staged.dataUrl.length < 1200000 ? c.banner.staged.dataUrl : null) } : null
    });
    _draftsSave(arr);
    var msg = _field('snSaveMsg');
    if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = '✓ Draft saved locally (not published)'; }
    _renderDrafts();
  }

  function _renderDrafts() {
    var host = _field('snDraftList');
    if (!host) return;
    var arr = _drafts();
    var wrap = _field('snDraftWrap');
    if (wrap) wrap.style.display = arr.length ? '' : 'none';
    host.innerHTML = arr.map(function (d) {
      return '<div class="sn-draft-row">'
        + '<span class="sn-draft-t">' + _escHtml(d.fields.title || 'Untitled draft') + '</span>'
        + '<span class="sn-draft-time">' + new Date(d.savedAt).toLocaleString() + '</span>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="SN.draftResume(\'' + d.id + '\')">▶ Resume</button> '
        + '<button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="SN.draftDelete(\'' + d.id + '\')">🗑</button>'
        + '</div>';
    }).join('');
  }

  function draftResume(id) {
    var d = _drafts().filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    var st = _state();
    st.editingId = null;
    var main = document.getElementById('adminMain') || document.getElementById('admin-main');
    if (main) renderPanel(main);
    applyPreset(d.presetId, { forceIcon: false });
    var f = d.fields;
    if (_field('snTitle')) _field('snTitle').value = f.title || '';
    if (_field('snMessage')) _field('snMessage').value = f.message || '';
    if (_field('snType')) _field('snType').value = f.type || '';
    if (_field('snPriority')) _field('snPriority').value = f.priority || 'normal';
    if (_field('snIcon')) _field('snIcon').value = f.icon || '';
    if (_field('snDestKind')) _field('snDestKind').value = f.destKind || '';
    if (_field('snDestVal')) { _field('snDestVal').value = f.destVal || ''; }
    if (_field('snDestValWrap')) _field('snDestValWrap').style.display = f.destKind ? '' : 'none';
    if (_field('snExpires')) _field('snExpires').value = f.expires || '';
    if (d.banner && d.banner.staged) { _composer().banner.staged = { dataUrl: d.banner.staged, name: 'draft' }; }
    _renderBannerBox(); _renderPreviewNow();
  }

  function draftDelete(id) {
    _draftsSave(_drafts().filter(function (x) { return x.id !== id; }));
    _renderDrafts();
  }

  function _loadRecordIntoComposer(n, mode) {
    /* mode: 'edit' | 'duplicate' | 'reuse' */
    var st = _state();
    st.editingId = mode === 'edit' ? n.id : null;
    st.duplicateNote = mode !== 'edit';
    var main = document.getElementById('adminMain') || document.getElementById('admin-main');
    if (main) renderPanel(main);
    if (mode === 'edit') {
      if (_field('snTitle')) _field('snTitle').value = n.title || '';
      if (_field('snMessage')) _field('snMessage').value = n.message || '';
    } else if (mode === 'duplicate') {
      if (_field('snTitle')) _field('snTitle').value = (n.title || '') + (n.title ? ' (Copy)' : '');
      if (_field('snMessage')) _field('snMessage').value = n.message || '';
    } else { /* reuse: preset/layout only */
      if (_field('snTitle')) _field('snTitle').value = '';
      if (_field('snMessage')) _field('snMessage').value = '';
    }
    if (_field('snType')) _field('snType').value = n.notification_type || 'GENERAL';
    if (_field('snPriority')) _field('snPriority').value = n.priority || 'normal';
    if (_field('snIcon')) _field('snIcon').value = n.icon || '';
    if (n.destination) {
      var m = String(n.destination).match(/^(page|url):(.*)$/);
      if (m) {
        if (_field('snDestKind')) _field('snDestKind').value = m[1];
        if (_field('snDestVal')) _field('snDestVal').value = m[2];
        if (_field('snDestValWrap')) _field('snDestValWrap').style.display = '';
      }
    } else {
      if (_field('snDestKind')) _field('snDestKind').value = '';
      if (_field('snDestValWrap')) _field('snDestValWrap').style.display = 'none';
    }
    var presetType = n.notification_type || 'GENERAL';
    var p = PRESETS.filter(function (x) { return x.type === presetType; })[0] || PRESETS[0];
    _composer().presetId = p.id;
    _renderPresetCards();
    if (mode === 'edit' && n.id) {
      probeBanner(n.id).then(function (url) {
        if (url) { _composer().banner.existing = url; _renderBannerBox(); _renderPreviewNow(); }
      });
    }
    _renderPreviewNow();
    if (mode !== 'edit') {
      var note = _field('snComposeNote');
      if (note) { note.style.display = ''; note.textContent = mode === 'duplicate' ? 'Duplicating — publishing creates a NEW notification (fresh identity).' : 'Reusing the design — enter new content.'; }
    }
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
    var c = _composer();

    main.innerHTML = `
      <div class="sn-hero">
        <div class="sn-hero-left">
          <div class="sn-hero-title">📡 Live Feed Notifications</div>
          <div class="sn-hero-sub">Studyria Premium Notification Center — real-time notification management. Publishing content creates notifications automatically; compose premium manual announcements here.</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="SN.adminTestConn(this)">🔌 Test Connection</button>
            <span id="snAdminConn" style="font-size:.78rem;color:var(--text2)"></span>
          </div>
        </div>
        <div class="sn-hero-right">
          <button class="btn btn-primary btn-sm" onclick="SN.composeNew()">✚ Create Notification</button>
        </div>
      </div>

      <div class="sn-layout">
        <div class="sn-main-col">

          <div class="sn-card" id="snComposerCard">
            <div class="sn-card-head">
              <div>
                <div class="sn-card-title">${e ? '✏️ Edit Notification' : '✚ Notification Composer'}</div>
                <div class="sn-card-sub">Presets, content, banner and action — with a live preview of what users will receive.</div>
              </div>
            </div>
            <div id="snComposeNote" class="sn-note" style="display:none"></div>
            <input type="hidden" id="snEditId" value="${e ? e.id : ''}" />

            <div class="sn-sec-label">🎨 PRESET</div>
            <div class="sn-preset-row" id="snPresetRow" role="group" aria-label="Notification presets"></div>

            <div class="sn-sec-label">📝 CONTENT</div>
            <div class="sn-grid">
              <div class="form-group sn-span2"><label class="form-label" for="snTitle">Title *</label>
                <input class="form-input" id="snTitle" maxlength="120" placeholder="e.g. ADRE 2.0 — Paper III Added" value="${e ? _escHtml(e.title) : ''}" oninput="SN._pv()"/></div>
              <div class="form-group sn-span2"><label class="form-label" for="snMessage">Message</label>
                <textarea class="form-input" id="snMessage" rows="2" maxlength="300" placeholder="Short message shown on the notification card" oninput="SN._pv()">${e ? _escHtml(e.message || '') : ''}</textarea></div>
              <div class="form-group"><label class="form-label" for="snType">Type</label>
                <select class="form-input" id="snType" onchange="SN._pv()">${typeOptions}</select></div>
              <div class="form-group"><label class="form-label" for="snPriority">Priority</label>
                <select class="form-input" id="snPriority" onchange="SN._pv()">
                  <option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>
                </select></div>
              <div class="form-group"><label class="form-label" for="snIcon">Icon (emoji, optional)</label>
                <input class="form-input" id="snIcon" maxlength="8" placeholder="📢" oninput="SN._pv()"/></div>
              <div class="form-group"><label class="form-label" for="snExpires">Expires (optional)</label>
                <input class="form-input" id="snExpires" type="datetime-local"/></div>
            </div>

            <div class="sn-sec-label">🖼️ VISUAL — CUSTOM BANNER</div>
            <div class="sn-banner-block">
              <div id="snBannerBox"></div>
              <div class="sn-banner-tips">
                <div class="sn-tip-row"><span class="sn-tip-k">Recommended</span> 1200 × 630 px (1.9:1 poster)</div>
                <div class="sn-tip-row"><span class="sn-tip-k">Formats</span> JPG · PNG · WebP — max 5 MB (auto-compressed)</div>
                <div class="sn-tip-row"><span class="sn-tip-k">Fit</span>
                  <label><input type="radio" name="snBannerFit" value="cover" checked onchange="SN.bannerFit('cover')"/> Center-crop to poster</label>
                  <label><input type="radio" name="snBannerFit" value="contain" onchange="SN.bannerFit('contain')"/> Fit whole image</label>
                </div>
              </div>
              <div id="snBannerMsg" style="font-size:.78rem;display:none;margin-top:8px"></div>
            </div>

            <div class="sn-sec-label">🎯 ACTION</div>
            <div class="sn-grid">
              <div class="form-group"><label class="form-label" for="snDestKind">CTA / Destination</label>
                <select class="form-input" id="snDestKind" onchange="SN.adminDestKindChange()">
                  <option value="">No CTA</option><option value="page">Site page</option><option value="url">External URL</option>
                </select></div>
              <div class="form-group" id="snDestValWrap" style="display:none"><label class="form-label" for="snDestVal">Value</label>
                <input class="form-input" id="snDestVal" placeholder="page id (library, career-hub, brainlab) or https://…"/></div>
            </div>
            <div class="sn-cta-note" id="snCtaNote"></div>
            <div class="sn-grid" style="margin-top:8px">
              <div class="form-group"><label class="form-label" for="snCtaLabel">CTA label override (optional)</label>
                <input class="form-input" id="snCtaLabel" maxlength="40" placeholder="auto (Read Now → / View Job → …)" oninput="SN._pv()"/></div>
              <div class="form-group"><label class="form-label" for="snPublishAt">Publish at — schedule (optional)</label>
                <input class="form-input" id="snPublishAt" type="datetime-local" onchange="SN._pv()"/></div>
            </div>
            <div class="sn-cta-note" id="snValBox"></div>

            <div class="sn-actions" id="snActions">
              <div class="sn-actions-inner">
                <button class="btn btn-primary" id="snSaveBtn" onclick="SN.adminSave(this)">${e ? '💾 Save Changes' : '🚀 Publish Notification'}</button>
                <button class="btn btn-ghost" onclick="SN.draftSave()">📥 Save Draft</button>
                <button class="btn btn-ghost" id="snSchedBtn" onclick="SN.adminSchedule(this)">🕐 Schedule</button>
                ${e ? '<button class="btn btn-ghost" onclick="SN.adminCancelEdit()">✕ Cancel</button>' : ''}
              </div>
            </div>
            <div id="snSaveMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
          </div>

          <div class="sn-card" id="snPushCard">
            <div class="sn-card-title">🔔 Mobile Push Delivery</div>
            <div class="sn-card-sub">Global kill switch and device test — unchanged production pipeline.</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px">
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

          <div class="sn-card" id="snDraftWrap" style="display:none">
            <div class="sn-card-title">📥 Saved Drafts (this device only)</div>
            <div id="snDraftList"></div>
          </div>

          <div class="sn-card">
            <div class="sn-card-head">
              <div>
                <div class="sn-card-title">📜 All Notifications</div>
                <div class="sn-card-sub">Search, filter and manage every notification.</div>
              </div>
              <button class="btn btn-ghost btn-sm" onclick="SN.adminRefresh(this)">🔄 Refresh</button>
            </div>
            <div class="sn-filters">
              <input class="form-input sn-f-search" id="snFQ" placeholder="🔍 Search title…" oninput="SN._listRender()"/>
              <select class="form-input" id="snFType" onchange="SN._listRender()"><option value="">All types</option></select>
              <select class="form-input" id="snFPrio" onchange="SN._listRender()">
                <option value="">All priorities</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
              </select>
              <select class="form-input" id="snFStatus" onchange="SN._listRender()">
                <option value="">All statuses</option><option value="live">● Live</option><option value="inactive">Inactive</option><option value="expired">Expired</option>
              </select>
              <select class="form-input" id="snFSort" onchange="SN._listRender()">
                <option value="new">Newest first</option><option value="old">Oldest first</option>
              </select>
            </div>
            <div id="snAdminList">Loading…</div>
          </div>

        </div>

        <div class="sn-preview-col">
          <div class="sn-card sn-preview-card">
            <div class="sn-card-head">
              <div>
                <div class="sn-card-title">👁️ Live Preview</div>
                <div class="sn-card-sub">Exactly what users receive — updates as you type.</div>
              </div>
            </div>
            <div class="sn-pv-tabs" id="snPvTabs"></div>
            <div id="snPreviewHost" aria-live="polite"></div>
          </div>
        </div>
      </div>

      <div id="snViewOverlay" class="sn-overlay" style="display:none" onclick="if(event.target===this)SN.viewClose()">
        <div class="sn-overlay-card" id="snViewBody"></div>
      </div>`;

    if (e) {
      var sel = main.querySelector('#snType'); if (sel) sel.value = e.notification_type || 'GENERAL';
      var pr = main.querySelector('#snPriority'); if (pr) pr.value = e.priority || 'normal';
      if (e.icon) { var ic = main.querySelector('#snIcon'); if (ic) ic.value = e.icon; }
      if (e.destination) {
        var m = String(e.destination).match(/^(page|url):(.*)$/);
        if (m) {
          var dk = main.querySelector('#snDestKind'); if (dk) dk.value = m[1];
          var dv = main.querySelector('#snDestVal'); if (dv) dv.value = m[2];
          var dw = main.querySelector('#snDestValWrap'); if (dw) dw.style.display = '';
        }
      }
      var p = PRESETS.filter(function (x) { return x.type === (e.notification_type || 'GENERAL'); })[0];
      if (p) c.presetId = p.id;
    }

    /* populate type filter from TYPE_META */
    var ft = main.querySelector('#snFType');
    if (ft) { ft.innerHTML = '<option value="">All types</option>' + Object.keys(TYPE_META).map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join(''); }

    _renderPresetCards();
    _renderBannerBox();
    _renderPreviewNow();
    _renderDrafts();
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

  function adminSave(btn, mode) {
    mode = mode || 'now';
    var title = (document.getElementById('snTitle').value || '').trim();
    if (!title) { alert('Title is required'); return; }
    var kind = (document.getElementById('snDestKind').value) || '';
    var val = (document.getElementById('snDestVal').value || '').trim();
    var dest = '';
    if (kind === 'page') dest = 'page:' + (val || 'home');
    else if (kind === 'url') dest = 'url:' + val;
    /* ── strict destination validation (spec §7) — block bad sends ── */
    var msg = document.getElementById('snSaveMsg');
    var bad = function (m) { if (msg) { msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + m; } btn.disabled = false; return; };
    if (kind === 'page') {
      if (!/^[a-z0-9\-]{1,60}$/i.test(val)) return bad('Invalid page id — letters, digits and dashes only.');
      /* FIX: block page ids that don't exist (e.g. "Homepage") — this is how
         page:Homepage got published and blank-screened user CTAs. */
      var normPage = resolvePageId(val);
      if (!normPage) return bad('Unknown page "' + val + '" — use a real Studyria page id (home, library, career-hub, brainlab…).');
      dest = 'page:' + normPage; /* normalized + verified */
    }
    if (kind === 'url' && !/^https:\/\/studyria\.qzz\.io(\/|$|\?|#)/.test(val)) return bad('External URLs are blocked — the destination must be a Studyria page (https://studyria.qzz.io/…).');
    var pubVal = (document.getElementById('snPublishAt') || {}).value || '';
    var scheduledAt = null;
    if (mode === 'schedule') {
      if (st_editing_check()) return bad('Scheduling applies to new notifications — save the edit instead.');
      if (!pubVal) return bad('Choose a schedule time first.');
      scheduledAt = new Date(pubVal);
      if (scheduledAt.getTime() <= Date.now() + 120000) return bad('Schedule time must be at least 2 minutes ahead.');
    }
    function st_editing_check() { return !!_state().editingId; }
    var expVal = (document.getElementById('snExpires').value || '').trim();
    var st = _state();
    btn.disabled = true; btn.textContent = mode === 'schedule' ? 'Scheduling…' : 'Saving…';

    /* metadata (server-side additive): poster preset style + CTA override.
     * The backend merge-replaces metadata, so on edit we merge with the
     * record's existing metadata first. */
    var meta = {};
    var rec = st.editingId ? _find(st.editingId) : null;
    if (rec && rec.metadata && typeof rec.metadata === 'object') meta = JSON.parse(JSON.stringify(rec.metadata));
    meta.poster_style = _presetStyle();
    var ctaVal = ((document.getElementById('snCtaLabel') || {}).value || '').trim();
    if (ctaVal) meta.cta = ctaVal; else delete meta.cta;

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
      expires_at: expVal ? new Date(expVal).toISOString() : null,
      metadata: meta
    };
    if (scheduledAt) payload.published_at = scheduledAt.toISOString();
    if (st.editingId) { delete payload.source; delete payload.notification_type; }

    adminCall(payload).then(function (res) {
      btn.disabled = false; btn.textContent = st.editingId ? '💾 Save Changes' : (mode === 'schedule' ? '🕐 Schedule' : '🚀 Publish Notification');
      if (res && res.ok) {
        var wasEdit = !!st.editingId;
        var editId = st.editingId;
        st.editingId = null;
        /* Custom banner: upload to the deterministic path so the feed
           picks it up; any failure is reported honestly and NEVER
           affects the published notification (auto poster fallback). */
        var c = _composer();
        if (c.banner.staged) {
          var newId = (res && (res.id || (res.notification && res.notification.id) || res.notification_id)) || null;
          var resolveId = Promise.resolve(newId);
          if (!wasEdit && !newId) {
            resolveId = adminCall({ op: 'list' }).then(function (lr) {
              var arr = (lr && lr.notifications) || [];
              var m2 = arr.filter(function (n) { return n.source === 'manual' && n.title === title && (!payload.notification_type || n.notification_type === payload.notification_type); })[0];
              return m2 ? m2.id : null;
            }).catch(function () { return null; });
          } else if (wasEdit) { resolveId = Promise.resolve(editId); }
          resolveId.then(function (id) {
            if (!id) { if (msg) { msg.style.color = '#f59e0b'; msg.textContent += ' — banner NOT uploaded (could not resolve the notification id)'; } return; }
            if (msg) { msg.style.color = '#f59e0b'; msg.textContent += ' — uploading banner…'; }
            bannerUploadFor(id).then(function (up) {
              if (up && up.ok && !up.skipped) {
                c.banner.staged = null; c.banner.existing = up.url;
                /* v3: persist the banner into the record metadata so the
                   push payload (scheduled sends), snLive feed and deep-link
                   layer all carry the custom image. Merge — never clobber. */
                adminCall({ op: 'list' }).then(function (lr) {
                  var r2 = ((lr && lr.notifications) || []).filter(function (x) { return x.id === id; })[0];
                  var m2 = (r2 && r2.metadata && typeof r2.metadata === 'object') ? JSON.parse(JSON.stringify(r2.metadata)) : {};
                  m2.poster_url = up.url;
                  return adminCall({ op: 'update', id: id, metadata: m2 });
                }).catch(function () { /* feed probe still covers this */ });
                if (msg) { msg.style.color = '#10d98e'; msg.textContent = '✓ Published — banner uploaded (' + up.kb + ' KB)'; }
              } else if (up && up.error) {
                if (msg) { msg.style.color = '#f59e0b'; msg.textContent += ' — banner failed: ' + up.error; }
              }
              _renderBannerBox();
            }).catch(function (e2) {
              if (msg) { msg.style.color = '#f59e0b'; msg.textContent += ' — banner failed: ' + (e2 && (e2.message || e2.error_description) || 'upload error'); }
            });
          });
        } else if (scheduledAt) {
          if (msg) { msg.style.display = ''; msg.style.color = '#C9A227'; msg.textContent = '🕐 Scheduled for ' + scheduledAt.toLocaleString() + ' — Live Feed + push at that time.'; }
          var pb = document.getElementById('snPublishAt'); if (pb) pb.value = '';
        } else {
          if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = wasEdit ? '✓ Updated — published notifications are never re-pushed' : '✓ Published — live within a minute'; }
        }
        SN.adminRefresh();
        if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (e) {} }
      } else if (msg) {
        msg.style.display = ''; msg.style.color = '#ef4444'; msg.textContent = '✗ ' + ((res && res.error) || 'failed');
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = st.editingId ? '💾 Save Changes' : (mode === 'schedule' ? '🕐 Schedule' : '🚀 Publish Notification');
      if (msg) { msg.style.display = ''; msg.style.color = '#ef4444'; msg.textContent = '✗ ' + (e.message || 'failed'); }
    });
  }

  function adminSchedule(btn) {
    return adminSave(btn, 'schedule');
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
      /* honest error state — never leave the admin staring at "Loading…" */
      var wrap = document.getElementById('snAdminList');
      if (wrap && !document.querySelector('#snAdminList .sn-row')) {
        wrap.innerHTML = '<div class="sn-empty">⚠️ Could not load notifications — your admin session may have expired.<br/><br/>'
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminRefresh(this)">↻ Retry</button></div>';
      }
    });
  }

  /* ── Notification list: thumbnails, filters, search, sort ────── */
  function _filters() {
    window.__snFilters = window.__snFilters || { q: '', type: '', priority: '', status: '', sort: 'new' };
    return window.__snFilters;
  }
  function _syncFilters() {
    var f = _filters();
    f.q = _fv('snFQ'); f.type = _fv('snFType'); f.priority = _fv('snFPrio'); f.status = _fv('snFStatus'); f.sort = _fv('snFSort') || 'new';
  }
  function _listRender() {
    _syncFilters();
    _renderList();
  }

  function _renderList() {
    var wrap = document.getElementById('snAdminList');
    if (!wrap) return;
    var list = _state().list.slice();
    var f = _filters();
    if (f.q) list = list.filter(function (n) { return String(n.title || '').toLowerCase().indexOf(f.q.toLowerCase()) !== -1; });
    if (f.type) list = list.filter(function (n) { return n.notification_type === f.type; });
    if (f.priority) list = list.filter(function (n) { return (n.priority || 'normal') === f.priority; });
    var now = Date.now();
    var stateOf = function (n) {
      if (!n.is_active) return 'inactive';
      if (n.expires_at && new Date(n.expires_at).getTime() <= now) return 'expired';
      return 'live';
    };
    if (f.status) list = list.filter(function (n) { return stateOf(n) === f.status; });
    list.sort(function (a, b) {
      var ta = new Date(a.published_at || a.created_date || 0).getTime();
      var tb = new Date(b.published_at || b.created_date || 0).getTime();
      return f.sort === 'old' ? ta - tb : tb - ta;
    });

    if (!_state().list.length) { wrap.innerHTML = '<div class="sn-empty">📭 No notifications yet. Publish content or compose one above.</div>'; return; }
    if (!list.length) { wrap.innerHTML = '<div class="sn-empty">🔍 No notifications match these filters.</div>'; return; }

    wrap.innerHTML = list.map(function (n) {
      var state = stateOf(n);
      var stateHtml = state === 'live' ? '<span class="sn-state sn-state-live">● Live</span>'
        : state === 'expired' ? '<span class="sn-state sn-state-expired">Expired</span>'
        : '<span class="sn-state sn-state-inactive">Inactive</span>';
      var srcBadge = n.source === 'auto' ? '<span class="sn-src sn-src-auto">auto</span>' : '<span class="sn-src sn-src-manual">manual</span>';
      var thumb = 'https://superagent-f8acee03.base44.app/functions/snPoster?type=' + encodeURIComponent(n.notification_type || 'GENERAL') + '&title=' + encodeURIComponent(n.title || 'Studyria') + '&sub=' + encodeURIComponent(n.message || '');
      var exp = n.expires_at ? new Date(n.expires_at).toLocaleDateString() : '—';
      var meta = TYPE_META[n.notification_type] || TYPE_META.GENERAL;
      return '<div class="sn-row" data-nid="' + _escHtml(n.id) + '">'
        + '<img class="sn-row-thumb" src="' + _escHtml(thumb) + '" alt="" loading="lazy" decoding="async" onerror="this.classList.add(\'sn-row-thumb-broken\')"/>'
        + '<div class="sn-row-body">'
          + '<div class="sn-row-title">' + (n.icon || '') + ' ' + _escHtml(n.title) + '</div>'
          + '<div class="sn-row-sub">' + _escHtml(meta.label) + ' · ' + srcBadge + (n.message ? ' · ' + _escHtml(n.message.slice(0, 60)) + (n.message.length > 60 ? '…' : '') : '') + '</div>'
          + '<div class="sn-row-meta">' + stateHtml + ' <span>' + escAttr(String(n.priority || 'normal')) + '</span> · <span>expires ' + escAttr(exp) + '</span></div>'
        + '</div>'
        + '<div class="sn-row-actions">'
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminView(\'' + n.id + '\')" title="View / Preview">👁</button> '
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminEdit(\'' + n.id + '\')" title="Edit">✏️</button> '
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminDuplicate(\'' + n.id + '\')" title="Duplicate (new identity)">⧉</button> '
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminReuse(\'' + n.id + '\')" title="Reuse design">♻</button> '
          + '<button class="btn btn-ghost btn-sm" onclick="SN.adminToggle(\'' + n.id + '\')" title="Activate/Deactivate">' + (n.is_active ? '⏸️' : '▶️') + '</button> '
          + '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="SN.adminDelete(\'' + n.id + '\')" title="Delete">🗑️</button>'
        + '</div>'
      + '</div>';
    }).join('');

    /* probe custom banners for thumbnails (miss → poster stays) */
    list.forEach(function (n) {
      if (window.__snThumbProbed && window.__snThumbProbed[n.id]) return;
      probeBanner(n.id).then(function (url) {
        if (!url) return;
        if (!window.__snThumbProbed) window.__snThumbProbed = {};
        window.__snThumbProbed[n.id] = true;
        var img = wrap.querySelector('.sn-row[data-nid="' + n.id + '"] .sn-row-thumb');
        if (img) img.src = url;
      });
    });
  }

  function adminView(id) {
    var n = _find(id);
    if (!n) return;
    var meta = TYPE_META[n.notification_type] || TYPE_META.GENERAL;
    var kind = SN_KIND_BY_TYPE[n.notification_type] || '';
    var tmpl = kind ? SN_PUSH_TEMPLATES[kind] : null;
    var pushTitle = n.title, pushBody = n.message || '';
    if (tmpl && !/^[📚💼📝🎯📰🗂️]/u.test(n.title || '')) {
      pushTitle = tmpl.title;
      pushBody = n.title + (n.message ? ' — ' + n.message : '');
    }
    var poster = 'https://superagent-f8acee03.base44.app/functions/snPoster?type=' + encodeURIComponent(n.notification_type || 'GENERAL') + '&title=' + encodeURIComponent(n.title || '') + '&sub=' + encodeURIComponent(n.message || '');
    var overlay = document.getElementById('snViewOverlay');
    var body = document.getElementById('snViewBody');
    if (!overlay || !body) return;
    body.innerHTML =
      '<div class="sn-card-title">👁 ' + _escHtml(n.title) + '</div>'
      + '<div class="sn-view-grid">'
        + '<div>'
          + '<div class="sn-sec-label">DEVICE PUSH (as rendered by sw.js)</div>'
          + '<div class="sn-pv-shade"><div class="sn-pv-phone">'
            + '<div class="sn-pv-status"><span>9:41</span><span>📶 ▮▮▮</span></div>'
            + '<div class="sn-pv-notif">'
              + '<div class="sn-pv-head"><img class="sn-pv-appico" src="/icon-192.png" alt="" onerror="this.style.display=\'none\'"/><span class="sn-pv-origin">studyria.qzz.io</span><span class="sn-pv-now">now</span></div>'
              + '<div class="sn-pv-body"><div class="sn-pv-title">' + _escHtml(pushTitle) + '</div>'
              + (pushBody ? '<div class="sn-pv-text">' + _escHtml(pushBody) + '</div>' : '') + '</div>'
              + (tmpl ? '<div class="sn-pv-actions"><span class="sn-pv-cta">' + _escHtml(tmpl.cta) + '</span></div>' : '')
            + '</div>'
          + '</div></div>'
        + '</div>'
        + '<div>'
          + '<div class="sn-sec-label">LIVE FEED CARD (production rendering)</div>'
          + '<div class="sn-pv-feedwrap"><div class="ln-card" style="cursor:default">'
            + '<img class="ln-card-thumb" data-viewthumb="' + _escHtml(n.id) + '" src="' + _escHtml(poster) + '" alt="" loading="lazy" onerror="this.remove()"/>'
            + '<div class="ln-card-icon">' + (n.icon || meta.icon) + '</div>'
            + '<div class="ln-card-body"><div class="ln-card-title">' + _escHtml(n.title) + '</div>'
            + (n.message ? '<div class="ln-card-msg">' + _escHtml(n.message) + '</div>' : '') + '</div>'
            + '<span class="ln-card-cta">' + _escHtml(meta.cta) + ' →</span>'
            + '<span class="ln-card-type ln-type-' + String(n.notification_type || 'GENERAL').toLowerCase() + '">' + _escHtml(meta.label) + '</span>'
          + '</div></div>'
        + '</div>'
      + '</div>'
      + '<div style="text-align:right;margin-top:12px"><button class="btn btn-ghost btn-sm" onclick="SN.viewClose()">✕ Close</button></div>';
    overlay.style.display = '';
    probeBanner(n.id).then(function (url) {
      if (!url) return;
      var im = body.querySelector('img[data-viewthumb="' + n.id + '"]');
      if (im) im.src = url;
    });
  }
  function viewClose() {
    var overlay = document.getElementById('snViewOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function composeNew() {
    _state().editingId = null;
    _composer().banner.staged = null; _composer().banner.existing = null;
    var main = document.getElementById('adminMain') || document.getElementById('admin-main');
    if (main) renderPanel(main);
    var card = document.getElementById('snComposerCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var t = document.getElementById('snTitle');
    if (t) setTimeout(function () { t.focus(); }, 350);
  }

  function adminDuplicate(id) {
    var n = _find(id);
    if (n) _loadRecordIntoComposer(n, 'duplicate');
  }
  function adminReuse(id) {
    var n = _find(id);
    if (n) _loadRecordIntoComposer(n, 'reuse');
  }

  function preset(pid) { applyPreset(pid, { forceIcon: true }); }
  function pvTab(t) { _composer().previewTab = t; _renderPreviewNow(); }
  function bannerFit(mode) { _composer().banner.fit = mode; }

  function adminEdit(id) {
    var n = _find(id);
    if (n) _loadRecordIntoComposer(n, 'edit');
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

  /* ── Device-scoped self-test (additive): presents THIS device's own
     subscription to snPushOps op:'self-test'. Backend verifies the caller
     IS the registered device (endpoint + key match), then sends exactly ONE
     hardcoded test push to this endpoint only, through the same VAPID
     production pipeline. Returns the backend's real response including the
     push-service status. No admin auth involved; no broadcast; no
     mutation beyond a per-endpoint cooldown timestamp. ──────────────── */
  function pushSelfTest() {
    if (!pushSupported()) return Promise.resolve({ ok: false, error: 'unsupported' });
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return { ok: false, error: 'this device is not subscribed' };
        return _fetch('snPushOps', { op: 'self-test', subscription: sub.toJSON() });
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'error' };
    });
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
    resolvePageId: resolvePageId,
    adminPanel: renderPanel,
    adminTestConn: adminTestConn,
    adminRefresh: adminRefresh,
    adminSave: adminSave,
    adminSchedule: adminSchedule,
    adminCancelEdit: adminCancelEdit,
    adminDestKindChange: adminDestKindChange,
    adminEdit: adminEdit,
    adminToggle: adminToggle,
    adminDelete: adminDelete,
    adminView: adminView,
    viewClose: viewClose,
    adminDuplicate: adminDuplicate,
    adminReuse: adminReuse,
    composeNew: composeNew,
    preset: preset,
    pvTab: pvTab,
    bannerPick: bannerPick,
    bannerRemove: bannerRemove,
    bannerFit: bannerFit,
    _bannerImgError: _bannerImgError,
    bannerUrls: bannerUrls,
    probeBanner: probeBanner,
    draftSave: draftSave,
    draftResume: draftResume,
    draftDelete: draftDelete,
    _pv: _pvDebounced,
    _listRender: _listRender,
    adminPushRefresh: adminPushRefresh,
    adminPushToggle: adminPushToggle,
    adminPushTest: adminPushTest,
    push: {
      supported: pushSupported,
      enable: pushEnable,
      disable: pushDisable,
      status: pushStatus,
      selfTest: pushSelfTest
    }
  };
})();
