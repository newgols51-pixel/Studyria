/* ═════════════════════════════════════════════════════════════════════════
   STUDYRIA CLOUD — Admin Cloud Storage & Content Manager
   Additive, isolated module (window.SCCloud). No existing logic touched.
   All numbers come from REAL Supabase storage listings and REAL
   database tables — nothing is hardcoded or simulated.
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SB_URL   = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
  var SB_ANON  = window.__SB_ANON_KEY || (window.supabaseClient && window.supabaseClient.supabaseKey) || '';
  var BUCKETS  = ['pdfs', 'covers', 'cloud-assets', 'creator-pdfs', 'avatars', 'profile-photos'];
  var CAT_BY_BUCKET = {
    'pdfs': 'PDF files', 'covers': 'Covers', 'cloud-assets': 'Cloud assets',
    'creator-pdfs': 'Creator assets', 'avatars': 'User avatars', 'profile-photos': 'Profile photos'
  };
  var DEFAULT_SETTINGS = {
    quota_bytes: 5368709120,                                  /* 5 GB starter (configurable) */
    warn_thresholds: { high: 70, almost_full: 85, critical: 95, full: 100 },
    max_upload_mb: 500,
    allowed_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    trash_retention_days: 30,
    signed_url_expiry: 3600,
    storage_tiers: [
      { gb: 5,   label: 'Free Starter', active: true },
      { gb: 25,  label: 'Creator',      active: false },
      { gb: 100, label: 'Pro',          active: false },
      { gb: 500, label: 'Business',     active: false }
    ]
  };

  var S = {
    view: 'overview',
    inv: null, invScanning: false,           /* real storage inventory */
    reg: [], regReady: null,                 /* cloud_files registry availability */
    settings: null, settingsReady: null,     /* cloud_settings availability */
    snaps: [], audit: [],
    pdfRows: [],
    q: '', fCat: '', fType: '', fStatus: '', sortK: 'updated', sortDir: -1,
    page: 0, PER: 100,
    detailRow: null, upBusy: false
  };

  /* ── tiny helpers ─────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtB(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function fmtD(iso) { try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return '—'; } }
  function $(id) { return document.getElementById(id); }
  function _sb() { return window.supabaseClient; }
  function adminEmail() { return (window.adminSession && window.adminSession.email) || ''; }

  function safeName(name) {
    return String(name || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'file';
  }
  function isPdf(mime, name) { return mime === 'application/pdf' || /\.pdf$/i.test(name); }

  /* ── REAL settings (cloud_settings) with honest default state ──── */
  function loadSettings(force) {
    if (S.settings && !force) return Promise.resolve(S.settings);
    var sb = _sb();
    if (!sb) { S.settingsReady = false; S.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); return Promise.resolve(S.settings); }
    return sb.from('cloud_settings').select('key,value').then(function (r) {
      if (r.error) { S.settingsReady = false; S.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); return S.settings; }
      S.settingsReady = true;
      var st = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      (r.data || []).forEach(function (row) {
        try {
          if (row.key === 'quota_bytes') st.quota_bytes = Number(row.value);
          else if (row.key) st[row.key] = row.value;
        } catch (e) {}
      });
      S.settings = st; return st;
    }).catch(function () {
      S.settingsReady = false; S.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); return S.settings;
    });
  }

  /* ── REAL registry (cloud_files) availability probe ───────────── */
  function loadRegistry(force) {
    if (S.regReady !== null && !force) return Promise.resolve(S.reg);
    var sb = _sb(); if (!sb) { S.regReady = false; return Promise.resolve([]); }
    return sb.from('cloud_files').select('*').order('created_at', { ascending: false }).limit(500).then(function (r) {
      if (r.error) { S.regReady = false; S.reg = []; return []; }
      S.regReady = true; S.reg = r.data || []; return S.reg;
    }).catch(function () { S.regReady = false; S.reg = []; return []; });
  }

  /* ── REAL storage inventory — paginated listing, real sizes ────── */
  function listBucket(bucket, prefix) {
    var out = [], offset = 0;
    function page() {
      return fetch(SB_URL + '/storage/v1/object/list/' + bucket, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON },
        body: JSON.stringify({ prefix: prefix || '', limit: 100, offset: offset, sortBy: { column: 'name', order: 'asc' } })
      }).then(function (r) { if (!r.ok) throw new Error(bucket + ' list HTTP ' + r.status); return r.json(); })
        .then(function (items) {
          if (!items || !items.length) return out;
          items.forEach(function (it) {
            if (it.id != null) {
              var md = it.metadata || {};
              out.push({ bucket: bucket, path: (prefix ? prefix + '/' : '') + it.name, name: it.name,
                bytes: md.size || 0, mime: md.mimetype || '', updated: it.updated_at || '', created: it.created_at || '' });
            } else { /* folder → recurse */ }
          });
          var folders = items.filter(function (it) { return it.id == null; }).map(function (it) { return it.name; });
          var subs = folders.map(function (f) { return listBucket(bucket, (prefix ? prefix + '/' : '') + f).catch(function () { return []; }); });
          offset += 100;
          var next = (items.length === 100) ? page() : Promise.resolve([]);
          return Promise.all([next].concat(subs)).then(function (all) {
            all.forEach(function (a) { a && a.forEach && a.forEach(function (x) { out.push(x); }); });
            return out;
          });
        });
    }
    return page();
  }

  function scanInventory(force) {
    if (S.inv && !force) return Promise.resolve(S.inv);
    if (S.invScanning) return S.invScanning;
    S.invScanning = Promise.all(BUCKETS.map(function (b) { return listBucket(b, '').catch(function (e) { return { _err: String(e && e.message || e) }; }); }))
      .then(function (res) {
        var files = [], errs = [], per = {};
        res.forEach(function (r, i) {
          var b = BUCKETS[i];
          if (r && r._err) { errs.push(b + ': ' + r._err); per[b] = { bytes: 0, count: 0 }; return; }
          per[b] = { bytes: 0, count: r.length };
          r.forEach(function (f) { per[b].bytes += f.bytes; files.push(f); });
        });
        var bytes = 0; files.forEach(function (f) { bytes += f.bytes; });
        S.inv = { files: files, per: per, bytes: bytes, count: files.length, errs: errs, scannedAt: Date.now() };
        S.invScanning = false;
        return S.inv;
      });
    return S.invScanning;
  }

  /* ── health analysis (real cross-checks) ───────────────────────── */
  function loadPdfs() {
    var sb = _sb(); if (!sb) return Promise.resolve([]);
    if (S.pdfRows.length) return Promise.resolve(S.pdfRows);
    return sb.from('pdfs').select('id,title,status,free,price,pdf_url,cover_url,created_at').order('created_at', { ascending: false }).limit(500)
      .then(function (r) { S.pdfRows = r.data || []; return S.pdfRows; }).catch(function () { return []; });
  }

  function analyze() {
    var inv = S.inv || { files: [], bytes: 0, count: 0, per: {} };
    var byKey = {}; inv.files.forEach(function (f) { byKey[f.bucket + '/' + f.path] = f; });
    var pdfSet = {}, coverSet = {};
    inv.files.forEach(function (f) {
      if (f.bucket === 'pdfs') pdfSet[f.path] = f;
      if (f.bucket === 'covers') coverSet[f.path] = f;
    });
    /* DB → storage missing references (REAL: e.g. published PDF with deleted file) */
    var missingPdfs = S.pdfRows.filter(function (p) {
      var fn = String(p.pdf_url || '').split('/').pop();
      return fn && !pdfSet[fn];
    });
    var missingCovers = S.pdfRows.filter(function (p) {
      var m = String(p.cover_url || '').match(/object\/public\/covers\/(.+?)(?:\?|$)/);
      return m && !coverSet[m[1]];
    });
    /* orphans: storage objects no DB row references and not in registry */
    var regKeys = {}; S.reg.forEach(function (r) { regKeys[r.bucket + '/' + r.storage_path] = r; });
    var referenced = {};
    S.pdfRows.forEach(function (p) {
      if (p.pdf_url) referenced['pdfs/' + String(p.pdf_url).split('/').pop()] = true;
      var m = String(p.cover_url || '').match(/object\/public\/covers\/(.+?)(?:\?|$)/);
      if (m) referenced['covers/' + m[1]] = true;
    });
    var orphans = inv.files.filter(function (f) {
      if (f.bucket === 'avatars' || f.bucket === 'profile-photos' || f.bucket === 'creator-pdfs') return false;
      return !referenced[f.bucket + '/' + f.path] && !regKeys[f.bucket + '/' + f.path];
    });
    /* duplicates: same real byte size + near-identical name (pre-hash heuristic for legacy files) */
    var seen = {}, dups = [];
    inv.files.forEach(function (f) {
      if (f.path.indexOf('.trash/') === 0) return;
      var k = f.bucket + '|' + f.bytes + '|' + f.name.replace(/^\d{10,}_/, '').toLowerCase();
      if (seen[k]) { dups.push([seen[k], f]); } else { seen[k] = f; }
    });
    /* registry rows whose storage object vanished (broken reference) */
    var brokenReg = S.reg.filter(function (r) { return r.status === 'active' && !byKey[r.bucket + '/' + r.storage_path]; });
    return { missingPdfs: missingPdfs, missingCovers: missingCovers, orphans: orphans, dups: dups, brokenReg: brokenReg };
  }

  function quotaState() {
    var st = S.settings || DEFAULT_SETTINGS;
    var used = (S.inv && S.inv.bytes) || 0;
    var quota = Number(st.quota_bytes) || 5368709120;
    var pct = quota ? (used / quota * 100) : 0;
    var t = st.warn_thresholds || DEFAULT_SETTINGS.warn_thresholds;
    var level = pct >= t.full ? 'full' : pct >= t.critical ? 'crit' : pct >= t.almost_full ? 'almost' : pct >= t.high ? 'high' : 'ok';
    var msgs = {
      high: '⚠️ Storage usage is getting high.',
      almost: '⚠️ Storage almost full.',
      crit: '🚨 Storage critically low.',
      full: '⛔ Storage limit reached. Expand storage to upload more content.'
    };
    return { used: used, quota: quota, avail: Math.max(0, quota - used), pct: pct, level: level, msg: msgs[level] || '', t: t };
  }

  /* ── audit (real rows) ─────────────────────────────────────────── */
  function audit(action, bucket, target, result, details) {
    var sb = _sb(); if (!sb || !S.regReady) return Promise.resolve(false);
    return sb.from('cloud_audit_log').insert({
      admin_email: adminEmail(), action: action, bucket: bucket || null,
      target: target || null, result: result || 'ok', details: details || null
    }).then(function (r) { return !r.error; }).catch(function () { return false; });
  }

  /* ══════════════ RENDER SHELL ══════════════ */
  var SUBS = [
    ['overview', '📊 Overview'], ['files', '🗂️ Files'], ['pdfs', '📕 PDF Health'],
    ['trash', '🗑️ Trash'], ['usage', '📈 Usage'], ['settings', '⚙️ Settings']
  ];

  function render(main) {
    if (!window.adminSession) { main.innerHTML = '<p class="text-muted" style="padding:32px">Admin login required.</p>'; return; }
    SB_ANON = window.__SB_ANON_KEY || SB_ANON;
    main.innerHTML =
      '<div class="sc-wrap" id="scRoot">'
      + '<div class="sc-head"><span style="font-size:1.5rem">☁️</span>'
      + '<div><div class="sc-title">Studyria Cloud</div></div></div>'
      + '<div class="sc-sub">Real storage &amp; content management — connected to Supabase storage and the production database. Every value below is live.</div>'
      + '<div id="scSetupBanner"></div>'
      + '<div class="sc-subnav" id="scSubnav">'
      + SUBS.map(function (x) { return '<button data-v="' + x[0] + '" class="' + (S.view === x[0] ? 'on' : '') + '" onclick="SCCloud._nav(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('')
      + '</div><div id="scView"></div></div>';
    if (!window.__SB_ANON_KEY) { /* mirror the public anon key already shipped in supabase.js */ }
    Promise.all([loadSettings(), loadRegistry(), scanInventory(), loadPdfs()]).then(function () {
      renderSetupBanner();
      renderView();
      maybeSnapshot();
    });
  }

  function renderSetupBanner() {
    var host = $('scSetupBanner'); if (!host) return;
    var parts = [];
    if (S.settingsReady === false || S.regReady === false) {
      parts.push('<b>One-time setup pending:</b> the Studyria Cloud tables are not in the database yet. '
        + 'Read-only monitoring works now; upload registry, trash, audit and configurable quota unlock after running '
        + '<code>cloud-storage-migration.sql</code> in the Supabase SQL Editor (or <code>SUPABASE_SERVICE_KEY=… node run-cloud-migration.js</code>). '
        + 'Until then the 5&nbsp;GB starter quota shown is the <b>default</b> (not a configured value).');
    }
    if (S.inv && S.inv.errs && S.inv.errs.length) {
      parts.push('<b>Provider note:</b> some buckets were not listable this session — ' + esc(S.inv.errs.join('; ')));
    }
    host.innerHTML = parts.map(function (p) { return '<div class="sc-setup">' + p + '</div>'; }).join('');
  }

  function _nav(v) {
    S.view = v; S.page = 0;
    document.querySelectorAll('#scSubnav button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    renderView();
  }

  function renderView() {
    var host = $('scView'); if (!host) return;
    if (S.view === 'overview') return viewOverview(host);
    if (S.view === 'files') return viewFiles(host);
    if (S.view === 'pdfs') return viewPdfs(host);
    if (S.view === 'trash') return viewTrash(host);
    if (S.view === 'usage') return viewUsage(host);
    if (S.view === 'settings') return viewSettings(host);
  }

  /* ══════════════ OVERVIEW ══════════════ */
  function viewOverview(host) {
    var q = quotaState(), a = analyze(), inv = S.inv || {};
    host.innerHTML =
      '<div class="sc-gauge">'
      + '<div class="sc-gauge-top"><span class="sc-gauge-used">' + fmtB(q.used) + ' <span style="font-size:.85rem;color:#8a7f70;font-weight:600">/ ' + fmtB(q.quota) + ' used</span></span>'
      + '<span class="sc-gauge-quota">' + fmtB(q.avail) + ' available · scanned ' + (inv.count || 0) + ' objects</span></div>'
      + '<div class="sc-bar ' + (q.level === 'full' || q.level === 'crit' ? 'crit' : q.level === 'almost' ? 'warn' : '') + '"><div style="width:' + Math.min(100, q.pct).toFixed(1) + '%"></div></div>'
      + '<div class="sc-pct">' + q.pct.toFixed(1) + '% used' + (S.settingsReady === false ? ' · default quota (migration pending)' : '') + '</div>'
      + '</div>'
      + (q.msg ? '<div class="sc-alert ' + (q.level === 'full' ? 'crit' : q.level === 'crit' ? 'crit' : q.level === 'almost' ? 'almost' : 'high') + '">' + q.msg + '</div>' : '')
      + '<div class="sc-cards">'
      + scCard('Total objects', inv.count || 0, 'across ' + Object.keys(CAT_BY_BUCKET).length + ' buckets')
      + scCard('Storage used', fmtB(q.used), 'real listing sum')
      + scCard('Published PDFs', S.pdfRows.filter(function (p) { return p.status === 'published'; }).length, S.pdfRows.length + ' records total')
      + scCard('⚠️ Missing files', a.missingPdfs.length, 'published PDFs whose file is gone')
      + scCard('Orphaned objects', a.orphans.length, 'no database reference')
      + scCard('Possible duplicates', a.dups.length, 'same size + name match')
      + '</div>'
      + '<div class="sc-row-grid"><div class="sc-panel"><h4>Storage by bucket (real)</h4>'
      + Object.keys(inv.per || {}).map(function (b) {
          var p = inv.per[b]; var max = 1; Object.keys(inv.per).forEach(function (k) { max = Math.max(max, inv.per[k].bytes); });
          return '<div class="sc-hbar"><span class="n">' + esc(b) + '</span><span class="t"><div style="width:' + (max ? p.bytes / max * 100 : 0) + '%"></div></span><span class="s">' + fmtB(p.bytes) + '</span></div>';
        }).join('')
      + '</div><div class="sc-panel"><h4>Content health (real cross-checks)</h4>'
      + healthLine('Published PDFs with missing file', a.missingPdfs.length, 'miss')
      + healthLine('Covers missing from covers bucket', a.missingCovers.length, 'miss')
      + healthLine('Orphaned storage objects', a.orphans.length, 'orphan')
      + healthLine('Possible duplicate files', a.dups.length, 'warn')
      + healthLine('Registry rows with vanished file', a.brokenReg.length, 'miss')
      + '<div style="margin-top:10px;font-size:.7rem;color:#8a7f70">Nothing is deleted automatically — review under Files / PDF Health.</div>'
      + '</div></div>'
      + '<div style="margin-top:12px"><button class="sc-btn ghost" onclick="SCCloud._rescan()">↻ Re-scan storage now</button></div>';
  }
  function scCard(k, v, m) { return '<div class="sc-card"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="m">' + esc(m || '') + '</div></div>'; }
  function healthLine(label, n, cls) {
    return '<div class="sc-hbar"><span class="n">' + esc(label) + '</span><span style="flex:1"></span>'
      + (n ? '<span class="sc-tag ' + cls + '">' + n + '</span>' : '<span class="sc-tag ok">0 ✓</span>') + '</div>';
  }

  function maybeSnapshot() {
    /* honest lightweight snapshot: first admin overview visit of the day stores the real total */
    var sb = _sb(); if (!sb || !S.regReady || !S.inv) return;
    var today = new Date().toISOString().slice(0, 10);
    sb.from('cloud_usage_snapshots').select('snapshot_date').eq('snapshot_date', today).limit(1).then(function (r) {
      if (r.error || (r.data && r.data.length)) return;
      return sb.from('cloud_usage_snapshots').insert({
        snapshot_date: today, total_bytes: S.inv.bytes, object_count: S.inv.count,
        per_bucket: S.inv.per, taken_by: adminEmail()
      });
    }).catch(function () {});
  }

  function _rescan() {
    S.inv = null;
    var host = $('scView'); if (host) host.innerHTML = '<div class="sc-skel"></div><div class="sc-skel"></div><div class="sc-skel"></div>';
    scanInventory(true).then(function () { renderSetupBanner(); renderView(); });
  }

  /* ══════════════ FILES (real inventory + upload + trash) ══════════════ */
  var UP_CATS = [
    ['cloud-assets', 'Image / asset (Brainlab, Career Hub, Current Affairs, website)', ['image/jpeg','image/png','image/webp']],
    ['covers', 'Book cover (goes to covers bucket)', ['image/jpeg','image/png','image/webp']],
    ['pdfs', 'PDF (private — for the pdfs bucket; use Smart Publish for full publish flow)', ['application/pdf']]
  ];

  function viewFiles(host) {
    var inv = S.inv || { files: [] };
    var rows = inv.files.slice();
    var q = S.q.toLowerCase();
    if (q) rows = rows.filter(function (f) { return (f.path + ' ' + f.mime).toLowerCase().indexOf(q) !== -1; });
    if (S.fCat) rows = rows.filter(function (f) { return f.bucket === S.fCat; });
    if (S.fType === 'pdf') rows = rows.filter(function (f) { return isPdf(f.mime, f.name); });
    if (S.fType === 'image') rows = rows.filter(function (f) { return /^image\//.test(f.mime); });
    if (S.fStatus === 'orphan') rows = analyze().orphans.filter(function (f) { return (!S.fCat || f.bucket === S.fCat) && (!q || (f.path + f.mime).toLowerCase().indexOf(q) !== -1); });
    rows.sort(function (a, b) {
      var k = S.sortK === 'name' ? 'path' : S.sortK === 'size' ? 'bytes' : 'updated';
      var va = a[k] || '', vb = b[k] || '';
      var c = (va < vb ? -1 : va > vb ? 1 : 0); return c * S.sortDir;
    });
    var totalPages = Math.max(1, Math.ceil(rows.length / S.PER));
    var page = Math.min(S.page, totalPages - 1);
    var slice = rows.slice(page * S.PER, (page + 1) * S.PER);
    var regKeys = {}; S.reg.forEach(function (r) { regKeys[r.bucket + '/' + r.storage_path] = r; });
    var a = analyze();
    var orphanSet = {}; a.orphans.forEach(function (f) { orphanSet[f.bucket + '/' + f.path] = true; });

    host.innerHTML =
      '<div class="sc-toolbar">'
      + '<input class="sc-input" style="flex:1;min-width:160px" placeholder="Search filename / type…" value="' + esc(S.q) + '" oninput="SCCloud._search(this.value)">'
      + '<select class="sc-select" onchange="SCCloud._f(\'fCat\',this.value)"><option value="">All buckets</option>'
      + BUCKETS.map(function (b) { return '<option value="' + b + '"' + (S.fCat === b ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select>'
      + '<select class="sc-select" onchange="SCCloud._f(\'fType\',this.value)"><option value="">All types</option><option value="pdf"' + (S.fType === 'pdf' ? ' selected' : '') + '>PDF</option><option value="image"' + (S.fType === 'image' ? ' selected' : '') + '>Images</option></select>'
      + '<select class="sc-select" onchange="SCCloud._f(\'fStatus\',this.value)"><option value="">All statuses</option><option value="orphan"' + (S.fStatus === 'orphan' ? ' selected' : '') + '>Orphaned only</option></select>'
      + '<select class="sc-select" onchange="SCCloud._sort(this.value)">'
      + ['updated:desc|Newest first', 'updated:asc|Oldest first', 'size:desc|Largest first', 'size:asc|Smallest first', 'name:asc|Name A→Z'].map(function (o) {
          var kv = o.split('|'); return '<option value="' + kv[0] + '"' + (S.sortK + ':' + (S.sortDir === -1 ? 'desc' : 'asc') === kv[0] ? ' selected' : '') + '>' + kv[1] + '</option>'; }).join('') + '</select>'
      + '<button class="sc-btn" onclick="SCCloud._uploadOpen()">⬆ Upload file</button>'
      + '</div>'
      + '<div class="sc-tablewrap"><table class="sc-table"><thead><tr><th>File</th><th>Bucket</th><th>Size</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>'
      + (slice.length ? slice.map(function (f) {
          var key = f.bucket + '/' + f.path; var reg = regKeys[key];
          var tag = reg && reg.status === 'trashed' ? '<span class="sc-tag trash">trashed</span>'
            : reg ? '<span class="sc-tag ok">registered</span>'
            : orphanSet[key] ? '<span class="sc-tag orphan">orphaned</span>'
            : '<span class="sc-tag ' + (isPdf(f.mime, f.name) ? 'pdf' : 'img') + '">' + esc(f.bucket) + '</span>';
          return '<tr><td class="sc-name" title="' + esc(f.path) + '">' + esc(f.path) + '</td><td>' + esc(f.bucket) + '</td>'
            + '<td>' + fmtB(f.bytes) + '</td><td>' + esc(f.mime || '—') + '</td><td>' + tag + '</td><td>' + fmtD(f.updated) + '</td>'
            + '<td style="white-space:nowrap"><button class="sc-btn ghost sm" onclick="SCCloud._detail(\'' + esc(key) + '\')">👁</button>'
            + (reg ? '' : ' <button class="sc-btn ghost sm" title="Import into registry" onclick="SCCloud._importFile(\'' + esc(key) + '\')">🔗</button>')
            + '</td></tr>';
        }).join('') : '<tr><td colspan="7"><div class="sc-empty">No files match.</div></td></tr>')
      + '</tbody></table></div>'
      + '<div class="sc-pager"><button class="sc-btn ghost sm" ' + (page === 0 ? 'disabled' : '') + ' onclick="SCCloud._page(-1)">← Prev</button>'
      + '<span>Page ' + (page + 1) + ' / ' + totalPages + ' · ' + rows.length + ' files</span>'
      + '<button class="sc-btn ghost sm" ' + (page >= totalPages - 1 ? 'disabled' : '') + ' onclick="SCCloud._page(1)">Next →</button></div>'
      + '<div class="sc-msg mut" style="margin-top:8px">Storage Health: ' + a.orphans.length + ' orphaned, ' + a.dups.length + ' possible duplicates (' + fmtB(a.dups.reduce(function (s, d) { return s + d[1].bytes; }, 0)) + ' potentially recoverable). Review only — nothing is deleted automatically.</div>';
  }

  function _search(v) { S.q = v; clearTimeout(S._qT); S._qT = setTimeout(renderView, 250); }
  function _f(k, v) { S[k] = v; S.page = 0; renderView(); }
  function _sort(v) { var p = v.split(':'); S.sortK = p[0]; S.sortDir = p[1] === 'desc' ? -1 : 1; renderView(); }
  function _page(d) { S.page += d; renderView(); }

  function findInv(key) { var f = (S.inv.files || []).filter(function (x) { return x.bucket + '/' + x.path === key; })[0]; return f; }

  function _detail(key) {
    var f = findInv(key); if (!f) return;
    var reg = S.reg.filter(function (r) { return r.bucket + '/' + r.storage_path === key; })[0];
    var isPublic = f.bucket !== 'pdfs';
    var html =
      '<div class="sc-overlay" onclick="SCCloud._closeDetail()"></div>'
      + '<div class="sc-detail"><h3>' + esc(f.name) + '</h3><div class="kv">'
      + '<b>Bucket</b><span>' + esc(f.bucket) + '</span>'
      + '<b>Path</b><span>' + esc(f.path) + '</span>'
      + '<b>Size</b><span>' + fmtB(f.bytes) + ' (real)</span>'
      + '<b>MIME</b><span>' + esc(f.mime || '—') + '</span>'
      + '<b>Created</b><span>' + esc(f.created || '—') + '</span>'
      + '<b>Updated</b><span>' + esc(f.updated || '—') + '</span>'
      + '<b>Access</b><span>' + (isPublic ? 'public read (bucket is public)' : 'private — signed URLs only (premium protection intact)') + '</span>'
      + '<b>Registry</b><span>' + (reg ? ('registered · ' + esc(reg.status)) : 'not in registry (legacy file)') + '</span>'
      + '</div><div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">'
      + (isPublic ? '<a class="sc-btn sm" style="text-decoration:none" target="_blank" href="' + esc(SB_URL + '/storage/v1/object/public/' + f.bucket + '/' + f.path) + '">Open public URL</a>' : '')
      + '<button class="sc-btn ghost sm" onclick="SCCloud._signedUrl(\'' + esc(key) + '\')">🔑 Signed URL (60s)</button>'
      + (reg && reg.status === 'active' ? '<button class="sc-btn danger sm" onclick="SCCloud._trash(\'' + esc(key) + '\')">🗑 Move to Trash</button>' : '')
      + '</div></div>';
    var d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d.firstChild); document.body.appendChild(d.lastChild);
  }
  function _closeDetail() {
    var o = document.querySelector('.sc-overlay'), p = document.querySelector('.sc-detail');
    if (o) o.remove(); if (p) p.remove();
  }

  function _signedUrl(key) {
    var f = findInv(key), sb = _sb(); if (!f || !sb) return;
    sb.storage.from(f.bucket).createSignedUrl(f.path, 60).then(function (r) {
      if (r.error) { alert('Signed URL failed: ' + r.error.message); return; }
      prompt('60-second signed URL (do not share publicly):', r.data.signedUrl);
    });
  }

  /* ── registry import (real insert from real listing) ──────────── */
  function _importFile(key) {
    var f = findInv(key), sb = _sb();
    if (!f || !sb) return;
    if (S.regReady === false) { alert('Registry not available yet — run cloud-storage-migration.sql first.'); return; }
    if (!confirm('Import this file into the Studyria Cloud registry?\n\n' + f.path)) return;
    sb.from('cloud_files').upsert({
      bucket: f.bucket, storage_path: f.path, filename: f.name,
      category: f.bucket === 'covers' ? 'cover' : (isPdf(f.mime, f.name) ? 'pdf' : 'other'),
      mime: f.mime, bytes: f.bytes, status: 'active', uploaded_by: adminEmail() + ' (import)'
    }).then(function (r) {
      if (r.error) { alert('Import failed: ' + r.error.message); return; }
      audit('import', f.bucket, f.path);
      loadRegistry(true).then(renderView);
    });
  }

  /* ── trash / restore / purge (real storage ops) ────────────────── */
  function _trash(key) {
    var f = findInv(key), sb = _sb(); if (!f || !sb) return;
    if (S.regReady === false) { alert('Registry not available yet — run the migration first.'); return; }
    if (!confirm('Move this file to Trash?\n\n' + f.path + '\n\nThe storage object is relocated inside the bucket (.trash/), nothing is deleted yet.')) return;
    var trashPath = '.trash/' + Date.now() + '-' + f.name;
    sb.storage.from(f.bucket).move(f.path, trashPath).then(function (r) {
      if (r.error) { alert('Trash move failed (storage policy): ' + r.error.message); return; }
      return sb.from('cloud_files').update({
        status: 'trashed', original_path: f.path, storage_path: trashPath,
        deleted_by: adminEmail(), deleted_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('bucket', f.bucket).eq('storage_path', f.path).select('id').single()
        .then(function (u) { audit('trash', f.bucket, f.path); _closeDetail(); return loadRegistry(true); })
        .then(function () { S.inv = null; return scanInventory(true); })
        .then(renderView);
    }).catch(function (e) { alert('Trash failed: ' + (e && e.message)); });
  }

  function viewTrash(host) {
    if (S.regReady === false) {
      host.innerHTML = '<div class="sc-setup">🗑️ Trash requires the cloud_files registry — run <code>cloud-storage-migration.sql</code> once. Until then nothing can be trashed (files stay safe).</div>';
      return;
    }
    var rows = S.reg.filter(function (r) { return r.status === 'trashed'; });
    host.innerHTML =
      '<div class="sc-sub" style="margin-bottom:10px">Trashed files are moved inside their bucket (.trash/…), never deleted until you confirm permanent deletion. Trash retention: '
      + ((S.settings && S.settings.trash_retention_days) || 30) + ' days (configurable in Settings).</div>'
      + '<div class="sc-tablewrap"><table class="sc-table"><thead><tr><th>File</th><th>Bucket</th><th>Size</th><th>Deleted</th><th>By</th><th></th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) {
          return '<tr><td class="sc-name" title="original: ' + esc(r.original_path || '') + '">' + esc(r.filename) + '</td><td>' + esc(r.bucket) + '</td>'
            + '<td>' + fmtB(r.bytes) + '</td><td>' + fmtD(r.deleted_at) + '</td><td>' + esc(r.deleted_by || '') + '</td>'
            + '<td style="white-space:nowrap"><button class="sc-btn sm" onclick="SCCloud._restore(\'' + esc(r.id) + '\')">↩ Restore</button> '
            + '<button class="sc-btn danger sm" onclick="SCCloud._purge(\'' + esc(r.id) + '\')">✖ Delete permanently</button></td></tr>';
        }).join('') : '<tr><td colspan="6"><div class="sc-empty">Trash is empty. Nothing has been deleted. 🎉</div></td></tr>')
      + '</tbody></table></div>';
  }

  function _restore(id) {
    var r = S.reg.filter(function (x) { return x.id === id; })[0], sb = _sb(); if (!r || !sb) return;
    if (!confirm('Restore this file to its original location?\n\n' + (r.original_path || r.storage_path))) return;
    sb.storage.from(r.bucket).move(r.storage_path, r.original_path).then(function (m) {
      if (m.error) { alert('Restore failed (storage): ' + m.error.message); return; }
      return sb.from('cloud_files').update({
        status: 'active', storage_path: r.original_path, restored_at: new Date().toISOString(),
        original_path: null, updated_at: new Date().toISOString()
      }).eq('id', id).select('id').single()
        .then(function (u) {
          if (u.error) return alert('Storage file was restored, but the registry update failed: ' + u.error.message + ' — the file is safe; fix the row in Settings → Audit.');
          audit('restore', r.bucket, r.original_path);
          return loadRegistry(true).then(function () { S.inv = null; return scanInventory(true); }).then(renderView);
        });
    }).catch(function (e) { alert('Restore failed: ' + (e && e.message)); });
  }

  function _purge(id) {
    var r = S.reg.filter(function (x) { return x.id === id; })[0], sb = _sb(); if (!r || !sb) return;
    if (!confirm('⚠️ PERMANENTLY DELETE this file? This cannot be undone.\n\n' + r.filename)) return;
    if (prompt('Type DELETE to confirm permanent removal:') !== 'DELETE') return;
    sb.storage.from(r.bucket).remove([r.storage_path]).then(function (m) {
      if (m.error) { alert('Permanent delete failed: ' + m.error.message); return; }
      return sb.from('cloud_files').delete().eq('id', id).select('id').single().then(function (d) {
        audit('purge', r.bucket, r.storage_path, 'ok', { bytes: r.bytes });
        return loadRegistry(true).then(function () { S.inv = null; return scanInventory(true); }).then(renderView);
      });
    }).catch(function (e) { alert('Permanent delete failed: ' + (e && e.message)); });
  }

  /* ══════════════ UPLOAD (real XHR + progress + validation) ══════════════ */
  function _uploadOpen() {
    var q = quotaState();
    if (q.level === 'full') { alert('⛔ Storage limit reached. Expand storage to upload more content.\n\nCurrent: ' + fmtB(q.used) + ' / ' + fmtB(q.quota)); return; }
    var html =
      '<div class="sc-overlay" onclick="SCCloud._closeDetail()"></div>'
      + '<div class="sc-detail" style="max-width:480px"><h3>⬆ Upload to Studyria Cloud</h3>'
      + '<div class="kv" style="margin-bottom:12px"><b>Quota now</b><span>' + fmtB(q.used) + ' / ' + fmtB(q.quota) + ' (' + q.pct.toFixed(1) + '%)</span>'
      + '<b>Available</b><span>' + fmtB(q.avail) + '</span>'
      + '<b>Max upload</b><span>' + ((S.settings && S.settings.max_upload_mb) || 500) + ' MB</span></div>'
      + '<div style="font-size:.72rem;color:#8a7f70;margin-bottom:6px">Destination bucket / category</div>'
      + '<select class="sc-select" id="scUpCat" style="width:100%">' + UP_CATS.map(function (c, i) {
          return '<option value="' + i + '">' + esc(c[1]) + '</option>'; }).join('') + '</select>'
      + '<div class="sc-upzone" id="scUpZone" style="margin-top:12px" onclick="document.getElementById(\'scUpFile\').click()">'
      + '<div class="big">📄</div><b>Choose a file</b><div class="sc-mut">' + ((S.settings && S.settings.allowed_types) || []).join(', ') + '</div></div>'
      + '<input type="file" id="scUpFile" style="display:none" onchange="SCCloud._uploadPicked(this)">'
      + '<div class="sc-prog" id="scUpProg"><div class="t"><div id="scUpBar" style="width:0%"></div></div>'
      + '<div class="sc-msg" id="scUpMsg"></div></div>'
      + '<div style="margin-top:12px;display:flex;gap:8px"><button class="sc-btn" id="scUpGo" disabled onclick="SCCloud._uploadGo()">Upload</button>'
      + '<button class="sc-btn ghost" onclick="SCCloud._closeDetail()">Cancel</button></div></div>';
    var d = document.createElement('div'); d.innerHTML = html;
    document.body.appendChild(d.firstChild); document.body.appendChild(d.lastChild);
  }

  var upFile = null, upSha = null;
  function _uploadPicked(input) {
    var f = input.files && input.files[0]; if (!f) return;
    var allowed = (S.settings && S.settings.allowed_types) || DEFAULT_SETTINGS.allowed_types;
    var maxMb = (S.settings && S.settings.max_upload_mb) || 500;
    var msg = $('scUpMsg'), bar = $('scUpBar'), prog = $('scUpProg');
    upFile = f; upSha = null; prog.style.display = 'block'; bar.style.width = '0%';
    if (allowed.indexOf(f.type) === -1) {
      msg.className = 'sc-msg err'; msg.textContent = '✖ Rejected: type "' + (f.type || 'unknown') + '" not in allowed list (' + allowed.join(', ') + ')';
      $('scUpGo').disabled = true; return;
    }
    if (f.size > maxMb * 1048576) {
      msg.className = 'sc-msg err'; msg.textContent = '✖ Rejected: ' + fmtB(f.size) + ' exceeds the ' + maxMb + ' MB upload limit.';
      $('scUpGo').disabled = true; return;
    }
    var q = quotaState();
    if (q.avail < f.size) {
      msg.className = 'sc-msg err'; msg.textContent = '✖ Rejected: only ' + fmtB(q.avail) + ' of quota available (file is ' + fmtB(f.size) + '). Expand storage.';
      $('scUpGo').disabled = true; return;
    }
    msg.className = 'sc-msg'; msg.textContent = 'Fingerprinting for duplicate check…';
    var reader = new FileReader();
    reader.onload = function () {
      crypto.subtle.digest('SHA-256', reader.result).then(function (h) {
        upSha = Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        /* REAL duplicate check: exact sha in registry + name/size heuristic over the live inventory */
        var exact = S.regReady ? S.reg.filter(function (r) { return r.sha256 && r.sha256 === upSha; }) : [];
        var heur = (S.inv.files || []).filter(function (x) { return x.bytes === f.size && x.name.replace(/^\d{10,}_/, '').toLowerCase() === safeName(f.name).toLowerCase(); });
        if (exact.length || heur.length) {
          var ex = exact[0];
          msg.className = 'sc-msg warn';
          msg.innerHTML = '⚠️ File already exists.<br>'
            + (ex ? '<b>' + esc(ex.filename) + '</b> · ' + fmtB(ex.bytes) + ' · uploaded ' + fmtD(ex.created_at) + ' · ' + esc(ex.bucket + '/' + ex.storage_path) + '<br>' : '')
            + (ex ? '' : heur.map(function (x) { return '<b>' + esc(x.name) + '</b> · ' + fmtB(x.bytes) + ' · ' + esc(x.bucket + '/' + x.path); }).join('<br>') + '<br>')
            + '<button class="sc-btn ghost sm" style="margin-top:6px" onclick="SCCloud._uploadGo(true)">Upload anyway</button>'
            + '<button class="sc-btn sm" style="margin-top:6px;margin-left:6px" onclick="SCCloud._closeDetail()">Use existing</button>';
          $('scUpGo').disabled = true; return;
        }
        msg.className = 'sc-msg ok'; msg.textContent = '✓ ' + fmtB(f.size) + ' · no duplicate found — ready to upload.';
        $('scUpGo').disabled = false;
      });
    };
    reader.readAsArrayBuffer(f);
  }

  function _uploadGo(force) {
    if (!upFile) return;
    if (S.upBusy) return; S.upBusy = true;
    var f = upFile, cat = UP_CATS[Number($('scUpCat').value)] || UP_CATS[0];
    var bucket = cat[0];
    var path = 'cloud/' + Date.now() + '-' + safeName(f.name);
    if (bucket === 'covers') path = Date.now() + '-' + safeName(f.name);
    var sb = _sb();
    var msg = $('scUpMsg'), bar = $('scUpBar');
    msg.className = 'sc-msg'; msg.textContent = 'Uploading… 0%';
    $('scUpGo').disabled = true;
    sb.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) throw new Error('Admin session expired — log in again.');
      /* REAL upload with real progress (XHR to the Supabase storage API) */
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', SB_URL + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(path).replace(/%2F/g, '/'));
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.setRequestHeader('apikey', SB_ANON || token);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var p = Math.round(e.loaded / e.total * 100);
            bar.style.width = p + '%'; msg.textContent = 'Uploading… ' + p + '% (' + fmtB(e.loaded) + ' / ' + fmtB(e.total) + ')';
          }
        };
        xhr.onload = function () { xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error('HTTP ' + xhr.status + ' — ' + xhr.responseText.slice(0, 160))); };
        xhr.onerror = function () { reject(new Error('Network error during upload')); };
        xhr.send(f);
      }).then(function () {
        /* verify the upload really landed (real HEAD check) */
        return fetch(SB_URL + '/storage/v1/object/list/' + bucket, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON },
          body: JSON.stringify({ prefix: path.split('/').slice(0, -1).join('/'), limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } })
        }).then(function (r) { return r.json(); }).then(function (items) {
          var found = items && items.some(function (it) { return it.name === path.split('/').pop(); });
          if (!found) throw new Error('Verification failed — uploaded object not found in ' + bucket + '.');
        });
      }).then(function () {
        /* DB reference (registry) — if this fails, roll the upload back (no broken records) */
        if (!S.regReady) return { skipped: true };
        return sb.from('cloud_files').insert({
          bucket: bucket, storage_path: path, filename: f.name,
          category: bucket === 'covers' ? 'cover' : (isPdf(f.type, f.name) ? 'pdf' : 'other'),
          mime: f.type, bytes: f.size, sha256: upSha, status: 'active', uploaded_by: adminEmail()
        }).then(function (r) {
          if (r.error) throw new Error('Registry insert failed (' + r.error.message + ') — rolling back the storage object.');
          return { ok: true };
        });
      }).catch(function (e) {
        /* clean up partial upload on any failure */
        return sb.storage.from(bucket).remove([path]).catch(function () {}).then(function () { throw e; });
      });
    }).then(function (res) {
      S.upBusy = false; _closeDetail();
      return audit('upload', bucket, path, 'ok', { bytes: f.size, sha256: upSha })
        .then(function () { S.inv = null; return loadRegistry(true).then(function () { return scanInventory(true); }); })
        .then(function () { renderSetupBanner(); renderView(); })
        .then(function () {
          if (window.showToast) showToast('☁️ Uploaded ' + f.name + ' (' + fmtB(f.size) + ') to ' + bucket + (res && res.skipped ? ' — registry pending migration' : ''), 'success');
        });
    }).catch(function (e) {
      S.upBusy = false;
      if (msg) { msg.className = 'sc-msg err'; msg.textContent = '✖ ' + (e && e.message || 'Upload failed'); }
      if ($('scUpGo')) $('scUpGo').disabled = false;
    });
  }

  /* ══════════════ PDF HEALTH (real DB ↔ storage cross-check) ══════════════ */
  function viewPdfs(host) {
    var a = analyze();
    host.innerHTML =
      '<div class="sc-sub" style="margin-bottom:10px">Every published PDF cross-checked between the pdfs table and the private pdfs bucket. New PDFs still go through <b>Smart Publish</b> (the existing, untouched pipeline) — this view watches the real relationship.</div>'
      + (a.missingPdfs.length ? '<div class="sc-alert crit">🚨 ' + a.missingPdfs.length + ' published PDF(s) reference a file that does NOT exist in storage. Buyers cannot download these until the file is re-uploaded via Smart Publish → Replace.</div>' : '<div class="sc-alert high" style="background:rgba(16,217,142,.08);border-color:rgba(16,217,142,.3);color:#047857">✓ All published PDFs resolve to real files.</div>')
      + '<div class="sc-tablewrap"><table class="sc-table"><thead><tr><th>PDF</th><th>Status</th><th>Price</th><th>File in storage</th><th>Cover</th></tr></thead><tbody>'
      + S.pdfRows.map(function (p) {
          var fn = String(p.pdf_url || '').split('/').pop();
          var pdfOk = fn && a.missingPdfs.indexOf(p) === -1;
          var cm = String(p.cover_url || '').match(/object\/public\/covers\/(.+?)(?:\?|$)/);
          var coverOk = !cm || a.missingCovers.indexOf(p) === -1;
          return '<tr><td class="sc-name" title="' + esc(p.id) + '">' + esc(p.title) + '</td>'
            + '<td>' + esc(p.status) + '</td><td>' + (p.free ? 'FREE' : '₹' + p.price) + '</td>'
            + '<td>' + (pdfOk ? '<span class="sc-tag ok">✓ present</span>' : '<span class="sc-tag miss">✖ missing</span>') + '</td>'
            + '<td>' + (coverOk ? (cm ? '<span class="sc-tag ok">✓</span>' : '<span class="sc-tag orphan">none</span>') : '<span class="sc-tag miss">✖ missing</span>') + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  /* ══════════════ USAGE (real snapshots + growth) ══════════════ */
  function viewUsage(host) {
    var sb = _sb();
    host.innerHTML = '<div class="sc-skel"></div><div class="sc-skel"></div>';
    var p = S.regReady !== false && sb ? sb.from('cloud_usage_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(60)
        .then(function (r) { return r.error ? [] : (r.data || []); }).catch(function () { return []; })
      : Promise.resolve([]);
    p.then(function (snaps) {
      S.snaps = snaps;
      var q = quotaState();
      var growth = null;
      if (snaps.length >= 2) {
        var latest = snaps[0].total_bytes, day = new Date();
        function daysAgo(n) { var d = new Date(day); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
        var s7 = snaps.filter(function (s) { return s.snapshot_date <= daysAgo(7); })[0];
        var s30 = snaps.filter(function (s) { return s.snapshot_date <= daysAgo(30); })[0];
        growth = {
          d7: s7 ? latest - s7.total_bytes : null,
          d30: s30 ? latest - s30.total_bytes : null
        };
      }
      host.innerHTML =
        '<div class="sc-cards">'
        + scCard('Storage used', fmtB(q.used), 'real listing sum')
        + scCard('Snapshots stored', snaps.length, S.regReady === false ? 'migration pending' : 'daily, taken on first admin visit')
        + scCard('Growth (7 days)', growth && growth.d7 != null ? (growth.d7 >= 0 ? '+' : '') + fmtB(growth.d7) : '—', growth && growth.d7 != null ? '' : 'needs a second snapshot')
        + scCard('Growth (30 days)', growth && growth.d30 != null ? (growth.d30 >= 0 ? '+' : '') + fmtB(growth.d30) : '—', growth && growth.d30 != null ? '' : 'needs ~30 days of snapshots')
        + '</div>'
        + '<div class="sc-panel"><h4>Snapshots (real)</h4>'
        + (snaps.length ? '<div class="sc-tablewrap"><table class="sc-table"><thead><tr><th>Date</th><th>Total</th><th>Objects</th><th>By</th></tr></thead><tbody>'
          + snaps.map(function (s) { return '<tr><td>' + esc(s.snapshot_date) + '</td><td>' + fmtB(s.total_bytes) + '</td><td>' + s.object_count + '</td><td>' + esc(s.taken_by || '') + '</td></tr>'; }).join('')
          + '</tbody></table></div>' : '<div class="sc-empty">No snapshots yet. The first one was just taken on this visit (if the migration is applied) — growth appears from the second day.</div>')
        + '</div>'
        + '<div class="sc-panel" style="margin-top:14px"><h4>Export (real data)</h4>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
        + '<button class="sc-btn ghost" onclick="SCCloud._export(\'inventory\')">⬇ Storage inventory (JSON)</button>'
        + '<button class="sc-btn ghost" onclick="SCCloud._export(\'manifest\')">⬇ Content manifest (JSON)</button>'
        + '</div><div class="sc-mut" style="margin-top:8px">Backups: <b>not configured</b> — these exports are real metadata snapshots, not full file backups. Automated backups would require a provider capability that is not currently connected.</div></div>';
    });
  }

  function _export(kind) {
    var payload;
    if (kind === 'inventory') payload = { exported_at: new Date().toISOString(), source: 'Supabase storage real listing', buckets: (S.inv && S.inv.per) || {}, files: (S.inv && S.inv.files) || [] };
    else payload = { exported_at: new Date().toISOString(), source: 'pdfs table + storage cross-check', pdfs: S.pdfRows, health: analyze() };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studyria-cloud-' + kind + '-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    audit('export', null, kind);
  }

  /* ══════════════ SETTINGS + EXPAND + AUDIT ══════════════ */
  function viewSettings(host) {
    var st = S.settings || DEFAULT_SETTINGS;
    var sb = _sb();
    host.innerHTML =
      (S.settingsReady === false
        ? '<div class="sc-setup">⚙️ Settings storage (cloud_settings) is not in the database yet — showing <b>defaults</b>. Run <code>cloud-storage-migration.sql</code> once, then reload this view to edit everything below for real.</div>'
        : '<div class="sc-setup" style="background:rgba(16,217,142,.07);border-color:rgba(16,217,142,.3)">✓ Connected to cloud_settings — changes below are enforced by database RLS (admin-only).</div>')
      + '<div class="sc-row-grid">'
      + '<div class="sc-panel"><h4>Quota &amp; limits</h4>'
      + setRow('Storage quota (GB)', '<input class="sc-input" id="scSetQuota" type="number" min="1" step="0.5" value="' + (st.quota_bytes / 1073741824) + '">', 'quota_bytes')
      + setRow('Max upload size (MB)', '<input class="sc-input" id="scSetMax" type="number" min="1" value="' + st.max_upload_mb + '">', 'max_upload_mb')
      + setRow('Trash retention (days)', '<input class="sc-input" id="scSetTrash" type="number" min="1" value="' + st.trash_retention_days + '">', 'trash_retention_days')
      + setRow('Signed URL expiry (s)', '<input class="sc-input" id="scSetSigned" type="number" min="60" value="' + st.signed_url_expiry + '">', 'signed_url_expiry')
      + '<button class="sc-btn" style="margin-top:10px" onclick="SCCloud._saveSettings()">💾 Save settings</button>'
      + '</div>'
      + '<div><div class="sc-panel"><h4>Storage expansion (architecture ready)</h4>'
      + '<div class="sc-mut" style="margin-bottom:8px">Tiers are configurable. Billing is NOT connected — no fake payments. The active tier defines the real quota enforced above.</div>'
      + (st.storage_tiers || []).map(function (t, i) {
          return '<div class="sc-hbar"><span class="n">' + esc(t.label) + '</span><span class="t"><div style="width:' + Math.min(100, t.gb / 5) + '%"></div></span><span class="s">' + t.gb + ' GB' + (t.active ? ' · active' : '') + '</span></div>';
        }).join('')
      + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
      + '<button class="sc-btn ghost" onclick="SCCloud._expand()">🚀 Expand Storage</button></div>'
      + '<div class="sc-mut" id="scExpandMsg" style="margin-top:8px">Expansion currently changes the quota directly (admin-authorized). Connect Razorpay or a provider plan API later for automated billing — the tier schema is already in place.</div>'
      + '</div>'
      + '<div class="sc-panel" style="margin-top:14px"><h4>Provider &amp; security</h4>'
      + '<div class="kv" style="font-size:.72rem">'
      + '<b>Provider</b><span>Supabase Storage (Supabase project qsdfmgcekdpjdcyqhuhi)</span>'
      + '<b>Buckets</b><span>' + BUCKETS.join(', ') + '</span>'
      + '<b>Premium PDFs</b><span>private bucket — signed URLs only (existing protection untouched)</span>'
      + '<b>Admin auth</b><span>Supabase auth + admin_users, enforced by RLS server-side</span>'
      + '<b>Secrets in frontend</b><span>none — only the public anon key</span>'
      + '</div></div></div></div>'
      + '<div class="sc-panel" style="margin-top:14px"><h4>Audit log (real admin actions)</h4><div id="scAuditBox"><div class="sc-skel" style="height:30px"></div></div></div>';
    if (sb && S.regReady !== false) {
      sb.from('cloud_audit_log').select('*').order('created_at', { ascending: false }).limit(50).then(function (r) {
        S.audit = r.data || [];
        var box = $('scAuditBox'); if (!box) return;
        box.innerHTML = S.audit.length
          ? '<div class="sc-tablewrap"><table class="sc-table"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>'
            + S.audit.map(function (a) { return '<tr><td>' + esc(new Date(a.created_at).toLocaleString()) + '</td><td>' + esc(a.admin_email) + '</td><td>' + esc(a.action) + '</td><td class="sc-name">' + esc(a.target || '') + '</td><td>' + esc(a.result) + '</td></tr>'; }).join('')
            + '</tbody></table></div>'
          : '<div class="sc-empty">No admin actions recorded yet — uploads, trashing, restores, purges and settings changes will appear here (append-only).</div>';
      });
    } else { var box = $('scAuditBox'); if (box) box.innerHTML = '<div class="sc-empty">Audit log requires the migration (cloud_audit_log table).</div>'; }
  }
  function setRow(label, control, key) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;font-size:.74rem"><span style="font-weight:700;color:#5b4a3a">' + esc(label) + '</span>' + control + '</div>';
  }

  function _saveSettings() {
    var sb = _sb();
    if (!sb || S.settingsReady === false) { alert('Settings storage not available — run cloud-storage-migration.sql first.'); return; }
    var rows = [
      ['quota_bytes', Number($('scSetQuota').value) * 1073741824],
      ['max_upload_mb', Number($('scSetMax').value)],
      ['trash_retention_days', Number($('scSetTrash').value)],
      ['signed_url_expiry', Number($('scSetSigned').value)]
    ];
    Promise.all(rows.map(function (kv) {
      return sb.from('cloud_settings').upsert({ key: kv[0], value: kv[1], updated_by: adminEmail(), updated_at: new Date().toISOString() });
    })).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { alert('Save failed: ' + bad.error.message); return; }
      audit('settings_change', null, 'quota/limits');
      return loadSettings(true).then(renderView);
    }).then(function () { if (window.showToast) showToast('☁️ Cloud settings saved', 'success'); });
  }

  function _expand() {
    var st = S.settings || DEFAULT_SETTINGS;
    var tiers = (st.storage_tiers || []).map(function (t) { return t.gb + ' GB — ' + t.label; }).join('\\n');
    var pick = prompt('Expand storage to which tier?\\n\\n' + tiers + '\\n\\nEnter GB (e.g. 25):');
    if (!pick) return;
    var gb = Number(pick);
    if (!gb || gb <= 0) { alert('Invalid value.'); return; }
    if (S.settingsReady === false) { alert('Run cloud-storage-migration.sql first — quota becomes configurable after that.'); return; }
    var sb = _sb(); if (!sb) return;
    sb.from('cloud_settings').upsert({ key: 'quota_bytes', value: gb * 1073741824, updated_by: adminEmail(), updated_at: new Date().toISOString() }).then(function (r) {
      if (r.error) { alert('Expand failed: ' + r.error.message); return; }
      audit('quota_change', null, 'quota→' + gb + 'GB');
      return loadSettings(true).then(renderView);
    }).then(function () {
      var m = $('scExpandMsg'); if (m) m.innerHTML = '✓ Quota expanded to ' + gb + ' GB. (Billing not connected — this was an authorized admin change. Tier schema is ready for a real billing integration.)';
      if (window.showToast) showToast('☁️ Storage expanded to ' + gb + ' GB', 'success');
    });
  }


  /* ══════════════ SMART PUBLISH INTEGRATION (additive) ══════════════
     uploadGuard: pre-upload validation (type / size / quota / duplicate)
       • returns {ok:true} or {ok:false, reason:'...'}
       • ALWAYS fail-open if the module state is unavailable (publishing
         must never break because of the cloud layer)
     registerUpload: post-upload registry + audit row (fire-and-forget)
     Used by the existing Smart Publish flows via 2-line hooks.        */
  function _sha256Of(file) {
    return file.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest('SHA-256', buf).then(function (h) {
        return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }).catch(function () { return null; });
  }

  function uploadGuard(file, opts) {
    opts = opts || {};
    if (!file) return Promise.resolve({ ok: true });
    var st = S.settings || DEFAULT_SETTINGS;
    var maxMb = Number(st.max_upload_mb) || 500;
    if (file.type && file.type !== 'application/pdf' && !/^image\//.test(file.type)) {
      return Promise.resolve({ ok: false, reason: 'Invalid file type: ' + file.type });
    }
    if (/\.exe|\.bat|\.cmd|\.hta|\.vbs|\.sh$/i.test(file.name || '')) {
      return Promise.resolve({ ok: false, reason: 'Blocked file type (security): ' + file.name });
    }
    if (file.size > maxMb * 1048576) {
      return Promise.resolve({ ok: false, reason: 'File exceeds ' + maxMb + ' MB upload limit (' + fmtB(file.size) + ')' });
    }
    return Promise.all([
      loadSettings(),
      scanInventory(),                       /* real usage, cached after first scan */
      loadRegistry(),
      _sha256Of(file)
    ]).then(function (all) {
      var sha = all[3];
      var q = quotaState();
      if (q.avail < file.size) {
        return { ok: false, reason: 'Storage quota insufficient: ' + fmtB(q.avail) + ' available, file is ' + fmtB(file.size) + '. Expand storage in Admin → ☁️ Cloud Storage → Settings.' };
      }
      if (sha && S.regReady && S.reg.some(function (r) { return r.sha256 === sha && r.status === 'active'; })) {
        return { ok: false, reason: 'Duplicate file: this exact file is already registered in Studyria Cloud.' };
      }
      return { ok: true, quota: { used: q.used, quota: q.quota }, sha: sha };
    }).catch(function () { return { ok: true }; });
  }

  function registerUpload(bucket, path, file, meta) {
    meta = meta || {};
    var sb = _sb(); if (!sb || !file) return Promise.resolve(false);
    return _sha256Of(file).then(function (sha) {
      if (S.regReady) {
        return sb.from('cloud_files').upsert({
          bucket: bucket, storage_path: path, filename: file.name || path,
          category: meta.kind === 'preview' ? 'preview' : 'pdf',
          mime: file.type || 'application/pdf', bytes: file.size, sha256: sha,
          status: 'active', content_ref: meta.pdfId ? ('pdf:' + meta.pdfId) : null,
          uploaded_by: adminEmail() || 'smart-publish'
        }).then(function (r) { return !r.error; }).catch(function () { return false; });
      }
      return false;
    }).then(function (regOk) {
      return audit('upload', bucket, path, 'ok', { via: 'smart-publish', bytes: file.size, registered: regOk });
    }).catch(function () { return false; });
  }

  /* ══════════════ EXPORT PUBLIC API ══════════════ */
  window.SCCloud = {
    render: render, _nav: _nav, _rescan: _rescan,
    _search: _search, _f: _f, _sort: _sort, _page: _page,
    _detail: _detail, _closeDetail: _closeDetail, _signedUrl: _signedUrl,
    _importFile: _importFile, _trash: _trash, _restore: _restore, _purge: _purge,
    _uploadOpen: _uploadOpen, _uploadPicked: _uploadPicked, _uploadGo: _uploadGo,
    _export: _export, _saveSettings: _saveSettings, _expand: _expand,
    uploadGuard: uploadGuard, registerUpload: registerUpload,
    /* diagnostics / tests */
    _state: function () { return { inv: S.inv, quota: quotaState(), health: analyze(), regReady: S.regReady, settingsReady: S.settingsReady }; }
  };
})();
