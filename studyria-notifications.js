/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA LIVE NOTIFICATIONS — Frontend client
   Backend: Studyria Notifications Base44 app (superagent-f8acee03)
   — separate Base44 backend, NOT BrainLab Arena (solas-e60b5349).

   Public side : SN.fetchLive()        → live feed (read-only, no auth)
   Admin side  : SN.publish()          → auto-notification on content publish
                SN.deactivate()       → unpublish / expiry handling
                SN.adminPanel()     → Notification Studio (v3 admin UI)
   All write calls verify the admin server-side via the Supabase session
   token; nothing sensitive is stored in this file.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://superagent-f8acee03.base44.app/functions/';
  var FETCH_TIMEOUT = 8000;

  var TYPE_META = {
    PDF:             { label: 'New PDF',  icon: '📕' },
    JOB:             { label: 'Job Alert', icon: '💼' },
    QUIZ:            { label: 'Quiz',    icon: '🧠' },
    MOCK_TEST:       { label: 'Mock Test', icon: '📝' },
    CURRENT_AFFAIRS: { label: 'Affairs', icon: '📰' },
    ADRE:            { label: 'ADRE',    icon: '🗂️' },
    CATEGORY:        { label: 'Category', icon: '📂' },
    GENERAL:         { label: 'Update',  icon: '📢' }
  };

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
        return "window.open('" + escAttr(val) + "','_blank','noopener')";
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
        var meta = TYPE_META[n.type] || TYPE_META.GENERAL;
        return {
          type: String(n.type || 'GENERAL').toLowerCase(),
          typeLabel: meta.label,
          title: n.title || 'Update',
          message: n.message || '',
          time: n.published_at || null,
          icon: n.icon || meta.icon,
          poster_url: n.poster_url || '',
          cta: n.cta || '',
          action: destinationAction(n.destination)
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

  /* Auto-notification on publish. Fire-and-forget with one silent retry:
     a notification failure must NEVER fail the content publish itself. */
  function publish(contentType, contentId, opts) {
    opts = opts || {};
    if (contentType === 'PDF' && _looksLikeAdre(opts)) contentType = 'ADRE';
    return getAdminToken().then(function (token) {
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
    }).catch(function (e) {
      console.warn('[SN] publish failed (content publish unaffected):', e);
      return { ok: false };
    });
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

/* ═══════════ NOTIFICATION STUDIO (v3) — 10 presets, live Android
   preview, pre-send validation, custom poster upload, draft/schedule
   delivery. Built ON TOP of the existing v2 admin manager: every
   existing control (kill switch, test push, list, edit, delete) stays. */
var SN_PRESETS = {
  classic:  { name: 'Studyria Classic',     emoji: '\uD83D\uDCE2', type: 'GENERAL',       style: 'classic',  cta: 'Open \u2192',             prefix: '\uD83D\uDCE2 Important Announcement' },
  material: { name: 'New Study Material',    emoji: '\uD83D\uDCDA', type: 'PDF',           style: 'material', cta: 'Read Now \u2192',        prefix: '\uD83D\uDCDA New Study Material' },
  job:      { name: 'Job Alert',            emoji: '\uD83D\uDCBC', type: 'JOB',           style: 'job',       cta: 'View Job \u2192',        prefix: '\uD83D\uDCBC New Assam Job Alert' },
  exam:     { name: 'Exam Alert',           emoji: '\u23F0',       type: 'GENERAL',       style: 'exam',     cta: 'Open \u2192',             prefix: '\u23F0 Exam Alert' },
  adre:     { name: 'ADRE Special',         emoji: '\uD83C\uDFDB\uFE0F', type: 'ADRE',    style: 'adre',     cta: 'Start Paper \u2192',     prefix: '\uD83C\uDFDB\uFE0F New ADRE Paper' },
  mock:     { name: 'Mock Test',            emoji: '\uD83D\uDCDD', type: 'MOCK_TEST',     style: 'mock',     cta: 'Start Test \u2192',      prefix: '\uD83D\uDCDD New Mock Test' },
  affairs:  { name: 'Current Affairs',      emoji: '\uD83D\uDCF0', type: 'CURRENT_AFFAIRS', style: 'affairs', cta: 'Read Update \u2192',     prefix: '\uD83D\uDCF0 Current Affairs Update' },
  feature:  { name: 'New Feature',          emoji: '\u2728',       type: 'GENERAL',       style: 'feature',  cta: 'Try Now \u2192',          prefix: '\u2728 New on Studyria' },
  alert:    { name: 'Important Alert',      emoji: '\uD83D\uDEA8', type: 'GENERAL',       style: 'alert',    cta: 'Open \u2192',             prefix: '\uD83D\uDEA8 Important Update' },
  premium:  { name: 'Premium Announcement', emoji: '\uD83D\uDC51', type: 'GENERAL',       style: 'premium',  cta: 'Get Studyria Pass \u2192', prefix: '\uD83D\uDC51 Premium Announcement' }
};
var SN_SUGGEST = {
  PDF:             { kind: 'pdf',   cta: 'Read Now \u2192' },
  JOB:             { kind: 'job',   cta: 'View Job \u2192' },
  QUIZ:            { kind: 'quiz',  cta: 'Take Quiz \u2192' },
  MOCK_TEST:       { kind: 'mock',  cta: 'Start Test \u2192' },
  ADRE:            { kind: 'page', cta: 'Start Paper \u2192', val: 'adre' },
  CURRENT_AFFAIRS: { kind: 'affair', cta: 'Read Update \u2192' },
  CATEGORY:        { kind: 'page', cta: 'Explore \u2192' },
  GENERAL:         { kind: 'page', cta: 'Open \u2192' }
};

function _studioState() {
  window.__snStudio = window.__snStudio || { style: 'classic', posterMode: 'auto', posterUrl: '', mode: 'now', debounce: null };
  return window.__snStudio;
}

function _snStudioCss() {
  if (document.getElementById('snStudioCss')) return;
  var s = document.createElement('style');
  s.id = 'snStudioCss';
  s.textContent = [
    '.snst-grid { display:grid; grid-template-columns:1fr 340px; gap:16px; align-items:start; }',
    '@media (max-width:920px) { .snst-grid { grid-template-columns:1fr; } }',
    '.snst-card { background:var(--glass); border:1px solid var(--glass-border); border-radius:16px; padding:18px; margin-bottom:14px; }',
    '.snst-sec-title { font-weight:700; color:#C9A227; font-size:.85rem; letter-spacing:.4px; margin-bottom:10px; display:flex; align-items:center; gap:7px; }',
    '.snst-presets { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }',
    '@media (max-width:760px) { .snst-presets { grid-template-columns:repeat(2,1fr); } }',
    '.snst-preset { border:1px solid var(--glass-border); background:var(--glass); border-radius:12px; padding:9px 6px; text-align:center; cursor:pointer; transition:border-color .15s, transform .1s; }',
    '.snst-preset:hover { border-color:#C9A227; } .snst-preset:active { transform:scale(.97); }',
    '.snst-preset.on { border-color:#C9A227; background:rgba(201,162,39,.1); }',
    '.snst-preset-emoji { font-size:1.25rem; } .snst-preset-name { font-size:.62rem; color:var(--text2); margin-top:3px; line-height:1.2; }',
    '.snst-chip { display:inline-flex; align-items:center; gap:5px; font-size:.68rem; border:1px solid var(--glass-border); border-radius:100px; padding:3px 10px; color:var(--text2); }',
    '.snst-chip.on { color:#10d98e; border-color:rgba(16,217,142,.4); }',
    '.snst-check-item { display:flex; gap:8px; align-items:flex-start; font-size:.76rem; padding:3px 0; }',
    '.snst-ok { color:#10d98e; } .snst-bad { color:#ff6b85; }',
    '.snst-ready { margin-top:8px; font-weight:700; font-size:.82rem; color:#10d98e; }',
    '.snst-notready { margin-top:8px; font-weight:700; font-size:.82rem; color:#ff6b85; }',
    '.snst-counter { font-size:.66rem; color:var(--text2); float:right; }',
    '.snst-preview-phone { background:#F7F1E2; border-radius:20px; padding:12px; color:#2A1A12; box-shadow:0 8px 28px rgba(0,0,0,.25); }',
    '.snst-prev-head { display:flex; align-items:center; gap:7px; font-size:.66rem; color:#6B5B4E; margin-bottom:8px; }',
    '.snst-prev-appicon { width:18px; height:18px; border-radius:5px; }',
    '.snst-prev-title { font-weight:700; font-size:.82rem; line-height:1.25; }',
    '.snst-prev-msg { font-size:.72rem; color:#6B5B4E; margin-top:2px; line-height:1.3; }',
    '.snst-prev-poster { width:100%; height:96px; object-fit:cover; border-radius:10px; margin-top:8px; background:#EADFC4; display:block; }',
    '.snst-prev-cta { display:inline-block; margin-top:8px; background:#6B1D2B; color:#E3C878; font-size:.7rem; font-weight:700; padding:5px 14px; border-radius:100px; }',
    '.snst-note { font-size:.66rem; color:var(--text2); margin-top:8px; line-height:1.4; }',
    '.snst-poster-opt { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }',
    '.snst-poster-opt button { flex:0 0 auto; }',
    '.snst-thumb { width:100%; max-width:220px; height:80px; object-fit:cover; border-radius:10px; border:1px solid var(--glass-border); }'
  ].join('\n');
  document.head.appendChild(s);
}

function _studioPosterUrl() {
  var st = _studioState();
  if (st.posterMode === 'custom' && st.posterUrl) return st.posterUrl;
  var title = (document.getElementById('snTitle') || {}).value || 'Studyria Update';
  var msg = (document.getElementById('snMessage') || {}).value || '';
  var type = (document.getElementById('snType') || {}).value || 'GENERAL';
  return 'https://superagent-f8acee03.base44.app/functions/snPoster?type=' + encodeURIComponent(type) +
    '&title=' + encodeURIComponent(title.slice(0, 120)) +
    '&sub=' + encodeURIComponent(msg.slice(0, 200)) +
    '&style=' + encodeURIComponent(st.style);
}

function renderPanel(main) {
  _snStudioCss();
  var st = _studioState();
  var e = _state().editingId ? _find(_state().editingId) : null;
  var typeOptions = Object.keys(TYPE_META).map(function (t) {
    return '<option value="' + t + '">' + t + '</option>';
  }).join('');
  var presets = Object.keys(SN_PRESETS).map(function (k) {
    return '<button type="button" class="snst-preset' + (st.style === k ? ' on' : '') + '" onclick="SN.studioPreset(\'' + k + '\')" title="Apply preset">' +
      '<div class="snst-preset-emoji">' + SN_PRESETS[k].emoji + '</div><div class="snst-preset-name">' + SN_PRESETS[k].name + '</div></button>';
  }).join('');

  main.innerHTML = `
  <div class="admin-section-title">🎨 Studyria Notification Studio</div>
  <div class="admin-section-sub">Premium notification composer — presets, live preview, smart CTA, posters, drafts &amp; scheduling. Publishing PDFs/Jobs/Quizzes/Mock Tests/Current Affairs still creates notifications automatically.</div>
  <div style="display:flex;gap:8px;margin:14px 0;flex-wrap:wrap">
    <button class="btn btn-ghost btn-sm" onclick="SN.adminTestConn(this)">🔌 Test Connection</button>
    <span class="snst-chip" id="snAdminConn">checking…</span>
    <span class="snst-chip" id="snPushStatsChip">…</span>
  </div>

  <div class="snst-card">
    <div class="snst-sec-title">✨ Preset <span style="color:var(--text2);font-weight:400">— one tap, fully customizable after</span></div>
    <div class="snst-presets">${presets}</div>
  </div>

  <div class="snst-grid">
    <div>
      <div class="snst-card">
        <input type="hidden" id="snEditId" value="${e ? e.id : ''}" />
        <div class="snst-sec-title">📝 Content</div>
        <div class="form-group"><label class="form-label">Title <span class="snst-counter"><span id="snTitleCount">0</span>/65</span></label>
          <input class="form-input" id="snTitle" maxlength="65" placeholder="e.g. New ADRE Paper III — Solved PYQs" value="${e ? _escHtml(e.title) : ''}" oninput="SN.studioFieldChange()"/></div>
        <div class="form-group" style="margin-top:8px"><label class="form-label">Message <span class="snst-counter"><span id="snMsgCount">0</span>/200</span></label>
          <textarea class="form-input" id="snMessage" rows="2" maxlength="200" placeholder="Short message shown on the notification" oninput="SN.studioFieldChange()">${e ? _escHtml(e.message || '') : ''}</textarea></div>
        <div class="admin-form-grid" style="margin-top:8px">
          <div class="form-group"><label class="form-label">Category</label>
            <select class="form-input" id="snType" onchange="SN.studioTypeChange()">${typeOptions}</select></div>
          <div class="form-group"><label class="form-label">Priority</label>
            <select class="form-input" id="snPriority">
              <option value="normal">Normal</option><option value="high">High — urgent only</option><option value="low">Low</option>
            </select></div>
          <div class="form-group"><label class="form-label">Icon (emoji)</label>
            <input class="form-input" id="snIcon" maxlength="8" placeholder="📢" oninput="SN.studioFieldChange()" value="${e ? _escHtml(e.icon || '') : ''}"/></div>
          <div class="form-group"><label class="form-label">Language</label>
            <select class="form-input" id="snLang">
              <option value="en">English</option><option value="as">অসমীয়া</option><option value="bi">Bilingual</option>
            </select></div>
        </div>
      </div>

      <div class="snst-card">
        <div class="snst-sec-title">🎯 CTA &amp; Destination</div>
        <div class="admin-form-grid">
          <div class="form-group"><label class="form-label">Opens</label>
            <select class="form-input" id="snDestKind" onchange="SN.studioDestChange()">
              <option value="">— No CTA —</option>
              <option value="pdf">PDF page (id)</option>
              <option value="job">Job (id)</option>
              <option value="quiz">Quiz</option>
              <option value="mock">Mock Test</option>
              <option value="affair">Current Affairs item</option>
              <option value="page">Site page</option>
              <option value="url">Studyria URL</option>
            </select></div>
          <div class="form-group" id="snDestValWrap" style="display:none"><label class="form-label">Value</label>
            <input class="form-input" id="snDestVal" placeholder="content id / page id / https://studyria.qzz.io/…" oninput="SN.studioFieldChange()"/></div>
          <div class="form-group"><label class="form-label">CTA label</label>
            <input class="form-input" id="snCtaLabel" maxlength="40" placeholder="Read Now →" oninput="SN.studioFieldChange()"/></div>
        </div>
        <div class="snst-note">Tap on the notification opens this exact destination. Invalid destinations are blocked before sending.</div>
      </div>

      <div class="snst-card">
        <div class="snst-sec-title">🖼️ Poster</div>
        <div class="snst-poster-opt">
          <button class="btn btn-sm ${st.posterMode === 'auto' ? 'btn-primary' : 'btn-ghost'}" id="snPosterAutoBtn" onclick="SN.studioPosterMode('auto')">✨ Auto (branded)</button>
          <button class="btn btn-sm ${st.posterMode === 'custom' ? 'btn-primary' : 'btn-ghost'}" id="snPosterCustomBtn" onclick="SN.studioPosterMode('custom')">🖼️ Custom upload</button>
        </div>
        <div id="snPosterCustomWrap" style="display:${st.posterMode === 'custom' ? '' : 'none'}">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input type="file" id="snPosterFile" accept="image/jpeg,image/png,image/webp" style="max-width:240px"/>
            <button class="btn btn-ghost btn-sm" onclick="SN.studioUploadPoster(this)">⬆️ Upload</button>
            ${st.posterUrl ? '<button class="btn btn-ghost btn-sm" onclick="SN.studioRemovePoster()">✕ Remove</button>' : ''}
          </div>
          <div class="snst-note">JPG / PNG / WebP · max 2 MB · landscape (wide) looks best. The original file is never modified — an optimized copy is uploaded.</div>
        </div>
        <div style="margin-top:10px"><img id="snPosterPreview" class="snst-thumb" alt="Poster preview" src="${_studioPosterUrl()}" onerror="this.style.display='none'"/></div>
      </div>

      <div class="snst-card">
        <div class="snst-sec-title">🚀 Delivery</div>
        <div class="form-group"><label class="form-label">Mode</label>
          <select class="form-input" id="snMode" onchange="SN.studioModeChange()" ${e ? 'disabled' : ''}>
            <option value="now">🚀 Send Now — live + push immediately</option>
            <option value="draft">💾 Save as Draft — no push, publish later</option>
            <option value="schedule">🕐 Schedule — live + push at chosen time</option>
          </select></div>
        <div class="admin-form-grid" style="margin-top:8px">
          <div class="form-group" id="snPublishAtWrap" style="display:none"><label class="form-label">Publish at</label>
            <input class="form-input" id="snPublishAt" type="datetime-local" onchange="SN.studioFieldChange()"/></div>
          <div class="form-group"><label class="form-label">Expires (optional)</label>
            <input class="form-input" id="snExpires" type="datetime-local" onchange="SN.studioFieldChange()" value="${e && e.expires_at ? new Date(e.expires_at).toISOString().slice(0, 16) : ''}"/></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="snSendBtn" onclick="SN.studioSubmit()">${e ? '💾 Save Changes' : '🚀 Send Notification'}</button>
          ${e ? '<button class="btn btn-ghost btn-sm" onclick="SN.adminCancelEdit()">✕ Cancel</button>' : ''}
        </div>
        <div id="snSaveMsg" style="margin-top:10px;font-size:.8rem;display:none"></div>
      </div>
    </div>

    <div>
      <div class="snst-card" style="position:sticky;top:12px">
        <div class="snst-sec-title">📱 Live Preview</div>
        <div class="snst-preview-phone" aria-label="Notification preview">
          <div class="snst-prev-head">
            <img class="snst-prev-appicon" src="https://studyria.qzz.io/icon-192.png" alt=""/>
            <span><b>Studyria</b> · now</span>
          </div>
          <div class="snst-prev-title" id="snPrevTitle">Your title here</div>
          <div class="snst-prev-msg" id="snPrevMsg">Your message will appear here</div>
          <img class="snst-prev-poster" id="snPrevPoster" alt="Poster preview" src="${_studioPosterUrl()}" onerror="this.style.display='none'"/>
          <span class="snst-prev-cta" id="snPrevCta" style="display:none">Open →</span>
        </div>
        <div class="snst-note">Approximation of a modern Android/browser notification. Actual rendering varies by OS, browser &amp; device settings — the real notification is always the one that matters.</div>
      </div>

      <div class="snst-card">
        <div class="snst-sec-title">✅ Pre-Send Validation</div>
        <div id="snChecklist"></div>
        <div id="snReadyBanner"></div>
      </div>
    </div>
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
    var lg = main.querySelector('#snLang'); if (lg && e.metadata && e.metadata.language) lg.value = e.metadata.language;
    var cl = main.querySelector('#snCtaLabel'); if (cl && e.metadata && e.metadata.cta) cl.value = e.metadata.cta;
    if (e.published_at && new Date(e.published_at).getTime() > Date.now()) {
      var pb = main.querySelector('#snPublishAt'); if (pb) pb.value = new Date(e.published_at).toISOString().slice(0, 16);
      var md = main.querySelector('#snMode'); if (md) { md.disabled = false; md.value = 'schedule'; }
    }
    if (e.destination) {
      var m = String(e.destination).match(/^([a-z]+):(.*)$/);
      if (m) {
        var dk = main.querySelector('#snDestKind'); if (dk) dk.value = m[1];
        var dv = main.querySelector('#snDestVal'); if (dv) dv.value = m[2];
        SN.studioDestChange();
      }
    }
    if (e.metadata && e.metadata.poster_url) {
      st.posterMode = 'custom';
      st.posterUrl = String(e.metadata.poster_url);
      var ab = main.querySelector('#snPosterAutoBtn'); if (ab) ab.className = 'btn btn-sm btn-ghost';
      var cb = main.querySelector('#snPosterCustomBtn'); if (cb) cb.className = 'btn btn-sm btn-primary';
      var cw = main.querySelector('#snPosterCustomWrap'); if (cw) cw.style.display = '';
    }
  } else if (!e) {
    var st2 = _studioState();
    st2.posterMode = 'auto'; st2.posterUrl = '';
  }
  SN.studioFieldChange(true);
  SN.adminRefresh();
  SN.adminPushRefresh();
}

/* ── Studio helpers ─────────────────────────────────────────────── */
function studioPreset(key) {
  var p = SN_PRESETS[key]; if (!p) return;
  var st = _studioState();
  st.style = p.style;
  var titleEl = document.getElementById('snTitle');
  if (titleEl) {
    var cur = (titleEl.value || '').trim();
    var isPresetTitle = !cur;
    for (var k in SN_PRESETS) { if (cur === SN_PRESETS[k].prefix) { isPresetTitle = true; break; } }
    if (isPresetTitle) titleEl.value = p.prefix;
  }
  var typeEl = document.getElementById('snType'); if (typeEl) typeEl.value = p.type;
  var iconEl = document.getElementById('snIcon'); if (iconEl && !(iconEl.value || '').trim()) iconEl.value = p.emoji;
  var ctaEl = document.getElementById('snCtaLabel'); if (ctaEl && !(ctaEl.value || '').trim()) ctaEl.value = p.cta;
  var sug = SN_SUGGEST[p.type];
  if (sug) {
    var dk = document.getElementById('snDestKind'); if (dk) dk.value = sug.kind;
    var dv = document.getElementById('snDestVal');
    if (dv && sug.val && !(dv.value || '').trim()) dv.value = sug.val;
  }
  var mode = st.posterMode === 'custom' ? 'custom' : 'auto';
  var autoBtn = document.getElementById('snPosterAutoBtn'); if (autoBtn) autoBtn.className = 'btn btn-sm ' + (mode === 'auto' ? 'btn-primary' : 'btn-ghost');
  var custBtn = document.getElementById('snPosterCustomBtn'); if (custBtn) custBtn.className = 'btn btn-sm ' + (mode === 'custom' ? 'btn-primary' : 'btn-ghost');
  var main = document.getElementById('adminMain') || document.getElementById('admin-main');
  var cards = main ? main.querySelectorAll('.snst-preset') : [];
  for (var i = 0; i < cards.length; i++) cards[i].classList.remove('on');
  if (main) {
    var btns = main.querySelectorAll('.snst-preset');
    var keys = Object.keys(SN_PRESETS);
    for (var j = 0; j < btns.length; j++) if (keys[j] === key) btns[j].classList.add('on');
  }
  studioDestChange();
  studioFieldChange(true);
}

function studioTypeChange() {
  var typeEl = document.getElementById('snType');
  if (!typeEl) return;
  var sug = SN_SUGGEST[typeEl.value];
  if (sug) {
    var ctaEl = document.getElementById('snCtaLabel');
    if (ctaEl) {
      var cur = ctaEl.value || '';
      var prevSug = false;
      for (var k in SN_SUGGEST) if (cur === SN_SUGGEST[k].cta) { prevSug = true; break; }
      if (!cur.trim() || prevSug) ctaEl.value = sug.cta;
    }
    var dk = document.getElementById('snDestKind'); if (dk) dk.value = sug.kind;
    var dv = document.getElementById('snDestVal');
    if (dv && sug.val && !(dv.value || '').trim()) dv.value = sug.val;
  }
  studioDestChange();
  studioFieldChange(true);
}

function studioDestChange() {
  var kind = (document.getElementById('snDestKind') || {}).value || '';
  var wrap = document.getElementById('snDestValWrap');
  if (wrap) wrap.style.display = kind && kind !== 'quiz' && kind !== 'mock' && kind !== 'affair' ? '' : (kind ? '' : 'none');
  var dv = document.getElementById('snDestVal');
  if (dv) {
    dv.placeholder = kind === 'url' ? 'https://studyria.qzz.io/…'
      : kind === 'page' ? 'page id (library, career-hub, brainlab, adre…)'
      : kind ? 'content id' : '';
  }
  studioFieldChange(true);
}

function studioModeChange() {
  var mode = (document.getElementById('snMode') || {}).value || 'now';
  _studioState().mode = mode;
  var w = document.getElementById('snPublishAtWrap');
  if (w) w.style.display = mode === 'schedule' ? '' : 'none';
  var btn = document.getElementById('snSendBtn');
  if (btn && !_state().editingId) {
    btn.textContent = mode === 'draft' ? '💾 Save Draft' : mode === 'schedule' ? '🕐 Schedule' : '🚀 Send Notification';
  }
  studioFieldChange(true);
}

function studioPosterMode(mode) {
  var st = _studioState();
  st.posterMode = mode;
  var autoBtn = document.getElementById('snPosterAutoBtn'); if (autoBtn) autoBtn.className = 'btn btn-sm ' + (mode === 'auto' ? 'btn-primary' : 'btn-ghost');
  var custBtn = document.getElementById('snPosterCustomBtn'); if (custBtn) custBtn.className = 'btn btn-sm ' + (mode === 'custom' ? 'btn-primary' : 'btn-ghost');
  var cw = document.getElementById('snPosterCustomWrap'); if (cw) cw.style.display = mode === 'custom' ? '' : 'none';
  studioFieldChange(true);
}

function studioRemovePoster() {
  var st = _studioState();
  st.posterUrl = '';
  studioPosterMode('auto');
  var img = document.getElementById('snPosterPreview'); if (img) { img.src = _studioPosterUrl(); img.style.display = ''; }
}

function studioUploadPoster(btn) {
  var st = _studioState();
  var inp = document.getElementById('snPosterFile');
  var f = inp && inp.files && inp.files[0];
  var msg = document.getElementById('snSaveMsg');
  var showErr = function (m) { if (msg) { msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + m; } };
  if (!f) { showErr('Choose an image file first.'); return; }
  var okTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (okTypes.indexOf(f.type) === -1) { showErr('Unsupported file type — use JPG, PNG or WebP.'); return; }
  if (f.size > 2 * 1024 * 1024) { showErr('Image too large — max 2 MB.'); return; }
  var sb = window.supabaseClient;
  if (!sb || !sb.storage) { showErr('Upload unavailable — please log in again.'); return; }
  btn.disabled = true; btn.textContent = 'Uploading…';
  var ext = (f.name.split('.').pop() || 'png').toLowerCase();
  var fp = 'notification-posters/np_' + Date.now() + '.' + ext;
  sb.storage.from('covers').upload(fp, f, { upsert: false, contentType: f.type })
    .then(function () { return sb.storage.from('covers').getPublicUrl(fp); })
    .then(function (r) {
      var url = r && r.data && r.data.publicUrl;
      if (!url) throw new Error('No public URL returned');
      st.posterUrl = url;
      st.posterMode = 'custom';
      studioPosterMode('custom');
      var img = document.getElementById('snPosterPreview');
      if (img) { img.src = url; img.style.display = ''; }
      /* dimension check — warn (do not block) on small/portrait images */
      var probe = new Image();
      probe.onload = function () {
        if (probe.naturalWidth < 600 || probe.naturalHeight < 315) {
          if (msg) { msg.style.display = ''; msg.style.color = '#f59e0b'; msg.textContent = '⚠ Uploaded, but small (' + probe.naturalWidth + '×' + probe.naturalHeight + ') — wide 1200×630 images look best.'; }
        } else if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = '✓ Poster uploaded (' + probe.naturalWidth + '×' + probe.naturalHeight + ').'; }
      };
      probe.src = url;
      btn.disabled = false; btn.textContent = '⬆️ Upload';
      studioFieldChange(true);
    })
    .catch(function (err) {
      btn.disabled = false; btn.textContent = '⬆️ Upload';
      showErr('Upload failed — ' + ((err && (err.message || err.error)) || 'try again') + '.');
    });
}

/* Strict destination validation (spec §7) — blocks bad destinations
 * BEFORE anything is sent. Every path leads to a real Studyria page. */
function snValidateDest(kind, val) {
  val = String(val || '').trim();
  if (!kind) return { ok: true };
  if (kind === 'pdf' || kind === 'job' || kind === 'quiz' || kind === 'mock' || kind === 'affair') {
    if (!val) return { ok: false, msg: 'Destination value missing — enter the content id.' };
    if (!/^[A-Za-z0-9_\-\/\.]{1,120}$/.test(val)) return { ok: false, msg: 'Destination value contains invalid characters.' };
    return { ok: true };
  }
  if (kind === 'page') {
    if (!val) return { ok: false, msg: 'Page id missing (e.g. library, career-hub, brainlab).' };
    if (!/^[a-z0-9\-]{1,60}$/i.test(val)) return { ok: false, msg: 'Page id looks invalid — lowercase letters/digits/dashes only.' };
    return { ok: true };
  }
  if (kind === 'url') {
    if (!/^https:\/\/studyria\.qzz\.io(\/|$|\?|#)/.test(val)) {
      return { ok: false, msg: 'External URLs are blocked — destination must be a Studyria page (https://studyria.qzz.io/…).' };
    }
    return { ok: true };
  }
  return { ok: true };
}

function studioFieldChange(immediate) {
  var st = _studioState();
  if (st.debounce) clearTimeout(st.debounce);
  if (immediate) { _studioRender(); return; }
  st.debounce = setTimeout(_studioRender, 180);
}

function _studioRender() {
  /* counters + preview */
  var titleEl = document.getElementById('snTitle') || {};
  var msgEl = document.getElementById('snMessage') || {};
  var iconEl = document.getElementById('snIcon') || {};
  var ctaEl = document.getElementById('snCtaLabel') || {};
  var tc = document.getElementById('snTitleCount'); if (tc) tc.textContent = (titleEl.value || '').length;
  var mc = document.getElementById('snMsgCount'); if (mc) mc.textContent = (msgEl.value || '').length;
  var pt = document.getElementById('snPrevTitle'); if (pt) pt.textContent = (titleEl.value || 'Your title here').slice(0, 65);
  var pm = document.getElementById('snPrevMsg'); if (pm) pm.textContent = (msgEl.value || 'Your message will appear here').slice(0, 200);
  var pc = document.getElementById('snPrevCta');
  if (pc) {
    var lbl = (ctaEl.value || '').trim();
    if (lbl) { pc.style.display = ''; pc.textContent = lbl; } else { pc.style.display = 'none'; }
  }
  var img = document.getElementById('snPrevPoster');
  if (img) {
    var newSrc = _studioPosterUrl();
    if (img.getAttribute('src') !== newSrc) { img.src = newSrc; img.style.display = ''; }
  }
  var pimg = document.getElementById('snPosterPreview');
  if (pimg) {
    var n2 = _studioPosterUrl();
    if (pimg.getAttribute('src') !== n2) { pimg.src = n2; pimg.style.display = ''; }
  }
  _studioValidate();
}

function _studioValidate() {
  var st = _studioState();
  var editing = _state().editingId;
  var mode = editing ? 'edit' : ((document.getElementById('snMode') || {}).value || 'now');
  var title = ((document.getElementById('snTitle') || {}).value || '').trim();
  var msg = ((document.getElementById('snMessage') || {}).value || '').trim();
  var kind = (document.getElementById('snDestKind') || {}).value || '';
  var val = (document.getElementById('snDestVal') || {}).value || '';
  var cta = ((document.getElementById('snCtaLabel') || {}).value || '').trim();
  var exp = (document.getElementById('snExpires') || {}).value || '';
  var pub = (document.getElementById('snPublishAt') || {}).value || '';
  var items = [];
  var push = function (ok, label, detail) { items.push({ ok: ok, label: label, detail: detail || '' }); };

  var titleOk = title.length >= 3 && title.length <= 65;
  push(titleOk, 'Title', titleOk ? '' : '3–65 characters (concise titles are never truncated on phone screens)');
  var msgOk = mode === 'draft' ? msg.length <= 200 : (msg.length >= 5 && msg.length <= 200);
  push(msgOk, 'Message', msgOk ? '' : mode === 'draft' ? 'max 200 characters' : '5–200 characters');
  push(true, 'Category', 'selected');
  var dRes = snValidateDest(kind, val);
  var destOk = mode === 'draft' ? true : (kind ? dRes.ok : false);
  push(destOk, 'Destination', destOk ? 'opens a real Studyria page' : (kind ? dRes.msg : 'choose where the notification opens (CTA)'));
  var ctaOk = mode === 'draft' ? true : (!kind || cta.length > 0);
  push(ctaOk, 'CTA label', ctaOk ? '' : 'add a short button label (e.g. Read Now →)');
  var expOk = !exp || new Date(exp).getTime() > Date.now() + 60000;
  push(expOk, 'Expiry', expOk ? (exp ? 'valid' : 'none') : 'must be in the future');
  var pubOk = true;
  if (mode === 'schedule') {
    pubOk = !!pub && new Date(pub).getTime() > Date.now() + 120000;
    push(pubOk, 'Schedule time', pubOk ? '' : 'choose a future time (at least 2 minutes ahead)');
  }
  var posterOk = st.posterMode === 'custom' ? !!st.posterUrl : true;
  push(posterOk, 'Poster', st.posterMode === 'custom' ? (st.posterUrl ? 'custom image ready' : 'upload a custom image or switch to Auto') : 'auto-generated, branded');

  var allOk = true;
  for (var i = 0; i < items.length; i++) if (!items[i].ok) { allOk = false; break; }
  var wrap = document.getElementById('snChecklist');
  if (wrap) {
    wrap.innerHTML = items.map(function (it) {
      return '<div class="snst-check-item"><span class="' + (it.ok ? 'snst-ok' : 'snst-bad') + '">' + (it.ok ? '✓' : '✗') + '</span>' +
        '<span><b>' + it.label + '</b>' + (it.detail ? ' <span style="color:var(--text2)">— ' + it.detail + '</span>' : '') + '</span></div>';
    }).join('');
  }
  var banner = document.getElementById('snReadyBanner');
  var btn = document.getElementById('snSendBtn');
  if (mode === 'draft') {
    var minOk = titleOk;
    if (banner) banner.innerHTML = '<div class="' + (minOk ? 'snst-ready' : 'snst-notready') + '">' + (minOk ? '✓ Ready to save draft (no push is sent)' : '✗ Title needed to save draft') + '</div>';
    if (btn) btn.disabled = !minOk;
  } else {
    if (banner) banner.innerHTML = '<div class="' + (allOk ? 'snst-ready' : 'snst-notready') + '">' + (allOk ? '✓ Ready to Send' : '✗ Fix the items above to enable sending') + '</div>';
    if (btn) btn.disabled = !allOk;
  }
  return allOk;
}

/* ── Submit (send / draft / schedule) — replaces v2 adminSave ────── */
function studioSubmit() {
  var st = _studioState();
  var editingId = _state().editingId;
  var mode = editingId ? 'edit' : ((document.getElementById('snMode') || {}).value || 'now');
  var allOk = _studioValidate();
  if (!allOk && mode !== 'draft') {
    var msg0 = document.getElementById('snSaveMsg');
    if (msg0) { msg0.style.display = ''; msg0.style.color = '#ff6b85'; msg0.textContent = '✗ Fix the validation errors first.'; }
    return;
  }
  var title = (document.getElementById('snTitle').value || '').trim();
  var kind = (document.getElementById('snDestKind').value) || '';
  var val = (document.getElementById('snDestVal').value || '').trim();
  var dest = '';
  if (kind) dest = kind + ':' + val;
  var expVal = (document.getElementById('snExpires').value || '').trim();
  var cta = ((document.getElementById('snCtaLabel') || {}).value || '').trim();
  var lang = ((document.getElementById('snLang') || {}).value || 'en');
  var e = editingId ? _find(editingId) : null;

  /* metadata: merge with existing on edit (backend replaces the object) */
  var meta = Object.assign({}, (e && e.metadata) || {});
  meta.poster_style = st.style;
  meta.language = lang;
  if (cta) meta.cta = cta; else delete meta.cta;
  if (st.posterMode === 'custom' && st.posterUrl) meta.poster_url = st.posterUrl;
  else delete meta.poster_url;

  var payload = {
    op: editingId ? 'update' : 'create',
    source: 'manual',
    id: editingId || undefined,
    title: title,
    message: (document.getElementById('snMessage').value || '').trim(),
    notification_type: editingId ? undefined : (document.getElementById('snType').value || 'GENERAL'),
    priority: document.getElementById('snPriority').value || 'normal',
    destination: dest,
    icon: (document.getElementById('snIcon').value || '').trim(),
    expires_at: expVal ? new Date(expVal).toISOString() : null,
    metadata: meta
  };
  if (editingId) { delete payload.source; delete payload.notification_type; }
  if (!editingId && mode === 'draft') payload.is_active = false;
  if (!editingId && mode === 'schedule') payload.published_at = new Date(document.getElementById('snPublishAt').value).toISOString();

  var btn = document.getElementById('snSendBtn');
  var msg = document.getElementById('snSaveMsg');
  btn.disabled = true; btn.textContent = 'Saving…';

  adminCall(payload).then(function (res) {
    btn.disabled = false;
    btn.textContent = editingId ? '💾 Save Changes' : (mode === 'draft' ? '💾 Save Draft' : mode === 'schedule' ? '🕐 Schedule' : '🚀 Send Notification');
    if (res && res.ok) {
      var text, ok = true;
      if (editingId) { text = '✓ Changes saved — published notifications are never re-pushed.'; _state().editingId = null; }
      else if (mode === 'draft') { text = '💾 Draft saved — no push sent. Publish it from the list below when ready.'; }
      else if (mode === 'schedule') {
        var t = new Date(payload.published_at);
        text = '🕐 Scheduled for ' + t.toLocaleString() + ' — appears in Live Feed and pushes then.';
      } else {
        var p = res.push;
        if (p && (p.pushed || 0) > 0) text = '🚀 Sent — pushed to ' + p.pushed + ' device' + (p.pushed === 1 ? '' : 's') + '. Check your phone!';
        else if (p) text = '✓ Published — Live Feed updated. ' + (p.invalid || p.failed ? (p.invalid || 0) + ' invalid subscription(s) removed.' : 'No active push subscribers yet.');
        else text = '✓ Published — live within a minute.';
      }
      if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = text; }
      SN.adminRefresh();
      if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (err) {} }
    } else if (msg) {
      msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + ((res && res.error) || 'failed');
    }
  }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = editingId ? '💾 Save Changes' : (mode === 'draft' ? '💾 Save Draft' : mode === 'schedule' ? '🕐 Schedule' : '🚀 Send Notification');
    if (msg) { msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + (err && err.message || 'failed'); }
  });
}

/* Draft → live (sends push exactly once — server-side idempotent) */
function adminPublishDraft(id) {
  if (!confirm('Publish this draft now? It will go live and push to subscribers (once).')) return;
  adminCall({ op: 'publish', id: id }).then(function (res) {
    var msg = document.getElementById('snSaveMsg');
    if (res && res.ok) {
      var p = res.push;
      var text = (res.scheduled ? '🕐 Activated — scheduled time still in the future, it will push then.' :
        (p && (p.pushed || 0) > 0 ? '🚀 Published — pushed to ' + p.pushed + ' device(s).' : '✓ Published (no push subscribers or already sent).'));
      if (msg) { msg.style.display = ''; msg.style.color = '#10d98e'; msg.textContent = text; }
      SN.adminRefresh();
      if (typeof loadLiveNotifications === 'function') { try { loadLiveNotifications(true); } catch (e) {} }
    } else if (msg) { msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + ((res && res.error) || 'failed'); }
  }).catch(function (e) {
    var msg = document.getElementById('snSaveMsg');
    if (msg) { msg.style.display = ''; msg.style.color = '#ff6b85'; msg.textContent = '✗ ' + (e && e.message || 'failed'); }
  });
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
    if (!list.length) { wrap.innerHTML = '<div style="padding:16px;color:var(--text2)">📭 No notifications yet. Publish content or create one in the Studio above.</div>'; return; }
    var now = Date.now();
    wrap.innerHTML = '<table style="width:100%;border-collapse:collapse"><tbody>' + list.map(function (n) {
      var expired = n.expires_at && new Date(n.expires_at).getTime() <= now;
      var isDraft = !n.is_active && n.source === 'manual';
      var scheduled = n.is_active && n.published_at && new Date(n.published_at).getTime() > now;
      var state = isDraft ? '<span style="color:#f59e0b">💾 Draft</span>'
        : scheduled ? '<span style="color:#C9A227">🕐 ' + new Date(n.published_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span>'
        : !n.is_active ? '<span style="color:#f59e0b">Inactive</span>'
        : expired ? '<span style="color:#94a3b8">Expired</span>'
        : '<span style="color:#10d98e">● Live</span>';
      var srcBadge = n.source === 'auto' ? '<span style="background:rgba(147,2,5,.12);color:#930205;border-radius:6px;padding:1px 7px;font-size:.68rem">auto</span>' : '<span style="background:rgba(16,217,142,.12);color:#10d98e;border-radius:6px;padding:1px 7px;font-size:.68rem">manual</span>';
      var posterDot = (n.metadata && (n.metadata.poster_url || n.metadata.poster_style)) ? ' 🖼️' : '';
      return '<tr style="border-bottom:1px solid rgba(147,2,5,.1)">' +
        '<td style="padding:8px 8px 8px 0">' + (n.icon || '') + ' <b>' + _escHtml(n.title) + '</b><div style="font-size:.7rem;color:var(--text2)">' + _escHtml(n.notification_type) + ' · ' + srcBadge + posterDot + (n.content_id ? ' · ' + _escHtml(String(n.content_id).slice(0, 14)) : '') + '</div></td>' +
        '<td style="padding:8px;white-space:nowrap">' + state + '</td>' +
        '<td style="padding:8px;white-space:nowrap;text-align:right">' +
          '<button class="btn btn-ghost btn-sm" onclick="SN.adminEdit(\'' + n.id + '\')" title="Edit">✏️</button> ' +
          (isDraft ? '<button class="btn btn-primary btn-sm" onclick="SN.adminPublishDraft(\'' + n.id + '\')" title="Publish draft — goes live and pushes once">🚀 Publish</button> ' :
            '<button class="btn btn-ghost btn-sm" onclick="SN.adminToggle(\'' + n.id + '\')" title="Activate/Deactivate">' + (n.is_active ? '⏸️' : '▶️') + '</button> ') +
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
    publish: publish,
    deactivate: deactivate,
    destinationAction: destinationAction,
    adminPanel: renderPanel,
    adminTestConn: adminTestConn,
    adminRefresh: adminRefresh,
    adminSave: studioSubmit,          /* legacy alias — v2 callers keep working */
    adminCancelEdit: adminCancelEdit,
    adminEdit: adminEdit,
    adminToggle: adminToggle,
    adminDelete: adminDelete,
    adminPublishDraft: adminPublishDraft,
    adminPushRefresh: adminPushRefresh,
    adminPushToggle: adminPushToggle,
    adminPushTest: adminPushTest,
    studioPreset: studioPreset,
    studioTypeChange: studioTypeChange,
    studioDestChange: studioDestChange,
    studioModeChange: studioModeChange,
    studioFieldChange: studioFieldChange,
    studioPosterMode: studioPosterMode,
    studioUploadPoster: studioUploadPoster,
    studioRemovePoster: studioRemovePoster,
    studioSubmit: studioSubmit,
    push: {
      supported: pushSupported,
      enable: pushEnable,
      disable: pushDisable,
      status: pushStatus
    }
  };
})();
