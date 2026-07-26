/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA ME V3 — REFERENCE MATCH ENGINE
   Matches the reference screenshot exactly:
   - Left: Profile card (photo, name, badges, streak, calendar, goal, edit btn)
   - Right: Stats row → Continue Learning → Recent Downloads → Achievements → Settings
   Safe Mode: hooks into existing renderDashboard / switchMeTab.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Globals ─────────────────────────────────────────────────── */
  var V3 = window.MeV3 = window.MeV3 || {};
  V3.profile = null;
  V3.completion = 0;
  V3.verified = false;
  V3._initialized = false;

  var REQUIRED = ['avatar_url', 'full_name', 'dob', 'phone', 'address', 'gender'];

  /* ── Helpers ──────────────────────────────────────────────────── */
  function sb()   { return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null); }
  function uid()  { var u = window.currentUser || {}; return u.uid || u.id || null; }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function el(id) { return document.getElementById(id); }
  function txt(id, v) { var e = el(id); if (e) e.textContent = v; }
  function calcCompletion(p) {
    var n = 0;
    REQUIRED.forEach(function(f) { if (p && p[f] && String(p[f]).trim()) n++; });
    return Math.round((n / REQUIRED.length) * 100);
  }
  function days() {
    return ['M','T','W','T','F','S','S'];
  }

  /* ── Supabase: load profile ───────────────────────────────────── */
  V3.loadProfile = async function() {
    var client = sb(), userId = uid();
    if (!client || !userId) return null;
    try {
      var res = await client.from('profiles').select('*').eq('id', userId).single();
      if (res.data) {
        V3.profile = res.data;
      } else if (res.error && (res.error.code === 'PGRST116' || res.error.code === '406')) {
        V3.profile = await V3.createProfile();
      }
    } catch(e) { console.warn('V3.loadProfile:', e); }
    if (V3.profile) {
      V3.completion = calcCompletion(V3.profile);
      V3.verified   = V3.completion === 100;
    }
    return V3.profile;
  };

  /* ── Supabase: create profile row ────────────────────────────── */
  V3.createProfile = async function() {
    var client = sb(), userId = uid();
    if (!client || !userId) return null;
    var u = window.currentUser || {};
    try {
      var ins = await client.from('profiles').insert({
        id: userId, email: u.email||'', full_name: u.name||'',
        avatar_url: u.avatarUrl||'', profile_completed: false, verified: false,
        updated_at: new Date().toISOString()
      }).select().single();
      return ins.data || null;
    } catch(e) { return null; }
  };

  /* ── Supabase: save profile ───────────────────────────────────── */
  V3.saveProfile = async function(data) {
    var client = sb(), userId = uid();
    if (!client || !userId) return false;
    var clean = { id: userId, updated_at: new Date().toISOString() };
    Object.keys(data).forEach(function(k) {
      clean[k] = typeof data[k] === 'string' ? data[k].trim().substring(0,500) : data[k];
    });
    clean.profile_completed = calcCompletion(clean) === 100;
    clean.verified           = clean.profile_completed;
    try {
      var res = await client.from('profiles').upsert(clean, {onConflict:'id'}).select().single();
      if (res.data) {
        V3.profile    = res.data;
        V3.completion = calcCompletion(res.data);
        V3.verified   = res.data.verified || V3.completion === 100;
        return true;
      }
    } catch(e) {}
    return false;
  };

  /* ── Supabase: upload photo ───────────────────────────────────── */
  V3.uploadPhoto = async function(file) {
    if (!file) return {error:'No file'};
    if (file.size > 1024*1024) return {error:'Max 1MB allowed'};
    var allowed = ['image/jpeg','image/jpg','image/png','image/webp'];
    if (allowed.indexOf(file.type) === -1) return {error:'JPG / PNG / WEBP only'};
    var client = sb(), userId = uid();
    if (!client || !userId) return {error:'Not logged in'};
    try {
      var blob = await compressImg(file, 400, 0.82);
      var ext  = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      var path = userId + '/avatar-' + Date.now() + '.' + ext;
      var up   = await client.storage.from('avatars').upload(path, blob, {contentType:'image/'+ext, upsert:true});
      if (up.error) up = await client.storage.from('profile-photos').upload(path, blob, {contentType:'image/'+ext, upsert:true});
      if (up.error) return {error:up.error.message};
      var pu = client.storage.from('avatars').getPublicUrl(path);
      if (!pu.data || !pu.data.publicUrl) pu = client.storage.from('profile-photos').getPublicUrl(path);
      if (pu.data && pu.data.publicUrl) {
        var url = pu.data.publicUrl + '?t=' + Date.now();
        await V3.saveProfile({avatar_url: url});
        if (window.currentUser) window.currentUser.avatarUrl = url;
        return {url: url};
      }
    } catch(e) { return {error: e.message}; }
    return {error:'Unknown error'};
  };

  function compressImg(file, maxPx, quality) {
    return new Promise(function(resolve, reject) {
      var rd = new FileReader();
      rd.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height;
          if (w > h && w > maxPx) { h = h*(maxPx/w); w = maxPx; }
          else if (h > maxPx)     { w = w*(maxPx/h); h = maxPx; }
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          cv.toBlob(function(b) { resolve(b); }, 'image/jpeg', quality);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      rd.onerror = reject;
      rd.readAsDataURL(file);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     RENDER: OVERVIEW (reference layout)
     Left: profile card | Right: stats + sections
  ════════════════════════════════════════════════════════════════ */
  V3.renderOverview = async function(stats) {
    var main = el('dashMain');
    if (!main) return;

    var u = window.currentUser || {};
    var p = V3.profile || {};
    var photoUrl = p.avatar_url || u.avatarUrl || '';
    var name     = p.full_name  || u.name      || 'Student';
    var email    = p.email      || u.email     || '';
    var location = [p.district, p.state].filter(Boolean).join(', ') || 'Assam, India';
    var bio      = p.bio        || '"A learner today, a leader tomorrow."';
    var streak   = p.study_streak || 0;
    var joinDate = '';
    if (u.joined) joinDate = u.joined;
    else if (p.created_at) {
      var d = new Date(p.created_at);
      joinDate = 'Joined ' + d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    }

    var initials   = (name.charAt(0)||'S').toUpperCase();
    var comPct     = V3.completion || 0;
    var isVerified = V3.verified;
    var isPremium  = false;

    /* Check premium async */
    try {
      if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
        var st = window.SMCI._cached || {};
        isPremium = !!(st.isPremium);
      }
    } catch(e) {}

    /* Stats from _fetchDashStats */
    var dlCount     = 0;
    var wishCount   = (window.wishlist || []).length + ((window.jobWishlist||[]).length);
    var buyCount    = 0;
    var certCount   = p.certificates_count || 0;
    if (stats) {
      buyCount  = stats.purchasedCount || 0;
      /* downloads from V3 cache */
    }
    if (V3._ana) {
      dlCount = V3._ana.downloads || 0;
    }

    /* referral code */
    var refCode = (p.referral_code) || ('STUDY' + ((u.uid||'').substring(0,6).toUpperCase() || '000000'));

    /* 7-day streak calendar */
    var today = new Date().getDay(); /* 0=Sun */
    /* map Sun=0 → index 6, Mon=1 → index 0 ... */
    var dayMap = [6,0,1,2,3,4,5];
    var todayIdx = dayMap[today];
    var dayLabels = ['M','T','W','T','F','S','S'];
    var calHtml = dayLabels.map(function(lbl, i) {
      var active = i <= todayIdx ? 'active' : 'inactive';
      return '<div class="v3-pc-cal-day">'
        + '<div class="v3-pc-cal-dot ' + active + '">' + (i+1) + '</div>'
        + '<div class="v3-pc-cal-lbl">' + lbl + '</div>'
        + '</div>';
    }).join('');

    /* Goal — 50 PDFs / month */
    var goalTotal = 50;
    var goalDone  = buyCount;
    var goalPct   = Math.min(100, Math.round((goalDone / goalTotal) * 100));

    /* Avatar HTML */
    var avatarInner = photoUrl
      ? '<img src="' + esc(photoUrl) + '" alt="' + esc(name) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
        + '<div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:2rem;font-weight:800;">' + initials + '</div>'
      : initials;

    var premiumBadge = isPremium
      ? '<span class="v3-pc-badge premium">👑 Premium</span>'
      : '';
    var verifiedBadge = isVerified
      ? '<span class="v3-pc-badge verified"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>'
      : '';

    var verifiedTick = isVerified
      ? '<span class="v3-pc-verified-tick"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>'
      : '';

    /* ── LEFT PROFILE CARD ── */
    var leftCard = '<div class="v3-profile-card">'
      + '<div class="v3-pc-avatar-wrap">'
      +   '<div class="v3-pc-avatar" onclick="MeV3.openPhotoPicker()" id="v3PcAvatar">'
      +     avatarInner
      +     '<div class="v3-pc-avatar-overlay"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></div>'
      +   '</div>'
      +   (isVerified ? '<div class="v3-pc-online"></div>' : '<div class="v3-pc-online"></div>')
      + '</div>'

      + '<div class="v3-pc-name">' + esc(name) + verifiedTick + '</div>'
      + '<div class="v3-pc-badges">' + premiumBadge + verifiedBadge + '</div>'

      + '<div class="v3-pc-meta">'
      +   '<div class="v3-pc-meta-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2-2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' + esc(email) + '</div>'
      +   '<div class="v3-pc-meta-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' + esc(location) + '</div>'
      +   '<div class="v3-pc-meta-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + esc(joinDate) + '</div>'
      + '</div>'

      + (bio ? '<div class="v3-pc-bio">' + esc(bio) + '</div>' : '')

      /* Streak */
      + '<div class="v3-pc-streak-row">'
      +   '<div><div class="v3-pc-streak-label">🔥 Study Streak</div></div>'
      +   '<div class="v3-pc-streak-num">' + streak + '</div>'
      + '</div>'

      /* 7-day calendar */
      + '<div class="v3-pc-cal" id="v3PcCal">' + calHtml + '</div>'

      /* Monthly goal */
      + '<div class="v3-pc-goal">'
      +   '<div class="v3-pc-goal-head"><span>This Month Goal</span><span class="v3-pc-goal-num">' + goalDone + ' / ' + goalTotal + ' PDFs &nbsp; ' + goalPct + '%</span></div>'
      +   '<div class="v3-pc-goal-track"><div class="v3-pc-goal-fill" style="width:' + goalPct + '%"></div></div>'
      + '</div>'

      /* Profile completion */
      + '<div class="v3-pc-completion">'
      +   '<div class="v3-pc-completion-head"><span>Profile Completion</span><span class="v3-pc-completion-pct">' + comPct + '%</span></div>'
      +   '<div class="v3-pc-completion-track"><div class="v3-pc-completion-fill" style="width:' + comPct + '%"></div></div>'
      + '</div>'

      /* Edit Profile btn */
      + '<button class="v3-pc-edit-btn" onclick="MeV3.openEditProfile()">'
      +   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      +   'Edit Profile'
      + '</button>'

      /* Premium upsell card */
      + (isPremium ? '' :
        '<div class="v3-go-premium">'
        + '<div class="v3-gp-crown">👑</div>'
        + '<div class="v3-gp-title">Go Premium</div>'
        + '<div class="v3-gp-sub">Unlock unlimited access to premium PDFs, exclusive content &amp; more.</div>'
        + '<button class="v3-gp-btn" onclick="navigate(\'premium\')">Upgrade Now</button>'
        + '</div>')

      /* Referral card */
      + '<div class="v3-referral-card">'
      +   '<div>🎁</div>'
      +   '<div class="v3-ref-code-wrap"><div class="v3-ref-label">Your Referral Code</div><div class="v3-ref-code">' + esc(refCode) + '</div></div>'
      +   '<button class="v3-ref-copy-btn" onclick="MeV3.copyRef(\'' + esc(refCode) + '\')">Copy</button>'
      + '</div>'

      + '</div>'; /* end v3-profile-card */

    /* ── RIGHT MAIN COLUMN ── */

    /* Stats row */
    var statsRow = '<div class="v3-stats-row">'
      + '<div class="v3-stat-card" onclick="MeV3.openDownloads()" title="My Downloads"><div class="v3-stat-icon v3-si-blue">⬇️</div><div class="v3-stat-info"><div class="v3-stat-num" id="v3StatDl">' + dlCount + '</div><div class="v3-stat-lbl">Downloads</div></div></div>'
      + '<div class="v3-stat-card" onclick="switchMeTab(\'wishlist\')" title="My Wishlist"><div class="v3-stat-icon v3-si-red">❤️</div><div class="v3-stat-info"><div class="v3-stat-num" id="v3StatWl">' + wishCount + '</div><div class="v3-stat-lbl">Wishlist</div></div></div>'
      + '<div class="v3-stat-card" onclick="showPurchaseHistory()" title="My Purchases"><div class="v3-stat-icon v3-si-green">🛒</div><div class="v3-stat-info"><div class="v3-stat-num" id="v3StatBuy">' + buyCount + '</div><div class="v3-stat-lbl">Purchases</div></div></div>'
      + '<div class="v3-stat-card" title="Certificates"><div class="v3-stat-icon v3-si-purple">🏅</div><div class="v3-stat-info"><div class="v3-stat-num">' + certCount + '</div><div class="v3-stat-lbl">Certificates</div></div></div>'
      + '</div>';

    /* Continue Learning */
    var continueHtml = V3.buildContinueLearning(stats);

    /* Recent Downloads */
    var downloadsHtml = V3.buildRecentDownloads();

    /* Achievements */
    var achHtml = V3.buildAchievements(dlCount, wishCount, buyCount, streak);

    /* Settings */
    var settingsHtml = V3.buildSettings();

    var rightCol = '<div class="v3-main-col">'
      + statsRow
      + continueHtml
      + downloadsHtml
      + achHtml
      + settingsHtml
      + '</div>';

    main.innerHTML = '<div class="v3-overview-wrap">' + leftCard + rightCol + '</div>'
      + '<input type="file" id="v3PhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="MeV3.handlePhotoChange(this)">';

    /* Async: fetch analytics and fill in download count */
    V3.fetchAnalyticsNumbers();

    /* Async: check premium badge */
    (async function() {
      try {
        if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
          var s = await window.SMCI.getStatus(true);
          if (s.isPremium) {
            var badges = document.querySelector('#v3PcAvatar') && document.querySelector('.v3-pc-badges');
            if (badges && !badges.querySelector('.premium')) {
              badges.insertAdjacentHTML('afterbegin', '<span class="v3-pc-badge premium">👑 Premium</span>');
            }
            var gp = document.querySelector('.v3-go-premium');
            if (gp) gp.style.display = 'none';
          }
        }
      } catch(e) {}
    })();
  };

  /* ── Continue Learning ──────────────────────────────────────── */
  V3.buildContinueLearning = function(stats) {
    var pdfs = [];
    if (stats && stats.purchasedPdfs && stats.purchasedPdfs.length) {
      pdfs = stats.purchasedPdfs.slice(0, 6);
    }
    if (!pdfs.length && window.PDFS && window.PDFS.length) {
      pdfs = window.PDFS.slice(0, 6);
    }

    if (!pdfs.length) return '';

    var GRAD = [
      'linear-gradient(160deg,#0d2340,#1a3a6b)',
      'linear-gradient(160deg,#0d2e18,#1a5c2e)',
      'linear-gradient(160deg,#3a0a12,#7c2230)',
      'linear-gradient(160deg,#1e0a3a,#4a1a7c)',
      'linear-gradient(160deg,#2e1400,#6b3000)',
      'linear-gradient(160deg,#042830,#0a5060)',
    ];

    var cards = pdfs.map(function(p, i) {
      var coverUrl = p.cover_image || p.coverImage || p.thumbnail || p.image || '';
      var progress = 0;
      if (window.BSF && BSF.readProgress) {
        progress = BSF.readProgress[String(p.id)] || 0;
      }
      var isPrem = !!(p.premium || p.is_premium);
      var isFree = !!(p.free);
      var bg = GRAD[i % GRAD.length];
      var initials = (p.title||'PDF').split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();

      return '<div class="v3-cl-card" onclick="typeof bsfOpenBook===\'function\'?bsfOpenBook(\'' + p.id + '\'):navigate(\'dashboard\')">'
        + '<div class="v3-cl-cover" style="' + (coverUrl ? '' : 'background:' + bg) + '">'
        +   (coverUrl ? '<img src="' + esc(coverUrl) + '" loading="lazy" alt="" onerror="this.style.display=\'none\'">' : '')
        +   '<div class="v3-cl-cover-fallback">' + esc(p.title||'PDF') + '</div>'
        +   (isPrem ? '<div class="v3-cl-badge premium">Premium</div>' : '')
        +   (isFree && !isPrem ? '<div class="v3-cl-badge free">Free</div>' : '')
        +   '<div class="v3-cl-progress-bar"><div class="v3-cl-progress-fill" style="width:' + progress + '%"></div></div>'
        + '</div>'
        + '<div class="v3-cl-info">'
        +   '<div class="v3-cl-title">' + esc(p.title||'PDF') + '</div>'
        +   '<div class="v3-cl-prog-row"><span>' + progress + '%</span><span>' + (p.category||'') + '</span></div>'
        +   '<button class="v3-cl-continue-btn" onclick="event.stopPropagation();typeof bsfOpenBook===\'function\'?bsfOpenBook(\'' + p.id + '\'):navigate(\'dashboard\')">Continue</button>'
        + '</div>'
        + '</div>';
    }).join('');

    return '<div class="v3-cl-section">'
      + '<div class="v3-section-head">'
      +   '<div class="v3-section-title">Continue Learning</div>'
      +   '<span class="v3-section-link" onclick="switchMeTab(\'purchased\')">View All →</span>'
      + '</div>'
      + '<div class="v3-cl-track">' + cards + '</div>'
      + '</div>';
  };

  /* ── Recent Downloads ────────────────────────────────────────── */
  V3.buildRecentDownloads = function() {
    /* Will be populated async — render skeleton first */
    return '<div class="v3-dl-section" id="v3DlSection">'
      + '<div class="v3-section-head">'
      +   '<div class="v3-section-title">Recent Downloads</div>'
      +   '<span class="v3-section-link" onclick="switchMeTab(\'purchased\')">View All →</span>'
      + '</div>'
      + '<div class="v3-dl-list" id="v3DlList">'
      +   V3.skeletonRows(3)
      + '</div>'
      + '</div>';
  };

  V3.skeletonRows = function(n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      h += '<div style="height:58px;border-radius:14px;background:rgba(255,255,255,0.04);margin-bottom:8px;animation:meSkeletonPulse 1.4s ease-in-out infinite;animation-delay:' + (i*0.15) + 's"></div>';
    }
    return h;
  };

  V3.fillDownloads = async function() {
    var listEl = el('v3DlList');
    if (!listEl) return;
    var client = sb(), userId = uid();
    if (!client || !userId) { listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:.8rem">No downloads yet</div>'; return; }

    try {
      var res = await client.from('downloads')
        .select('pdf_id, created_at, file_size, file_path')
        .eq('user_id', userId)
        .order('created_at', {ascending:false})
        .limit(5);

      var rows = (res.data || []);
      if (!rows.length) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:.8rem">No downloads yet. <a style="color:var(--accent)" onclick="navigate(\'library\')">Browse PDFs →</a></div>';
        return;
      }

      listEl.innerHTML = rows.map(function(r) {
        var pdf = (window.PDFS||[]).find(function(p){return String(p.id)===String(r.pdf_id);});
        var title = pdf ? (pdf.title||'PDF') : ('PDF #'+r.pdf_id);
        var date  = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '';
        var size  = r.file_size ? (Math.round(r.file_size/1024/1024*10)/10 + ' MB') : '';
        var init  = title.split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase()||'PDF';
        return '<div class="v3-dl-item">'
          + '<div class="v3-dl-icon">' + init + '</div>'
          + '<div class="v3-dl-info"><div class="v3-dl-title">' + esc(title) + '</div>'
          +   '<div class="v3-dl-meta"><span>Downloaded on ' + date + '</span>' + (size?'<span>' + size + '</span>':'') + '</div></div>'
          + '<span class="v3-dl-badge">PDF</span>'
          + '<div class="v3-dl-actions">'
          +   '<button class="v3-dl-btn" title="Open" onclick="typeof openAndTrack===\'function\'&&openAndTrack(\'' + r.pdf_id + '\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>'
          +   '<button class="v3-dl-btn" title="More"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>'
          + '</div>'
          + '</div>';
      }).join('');

      /* Update download count in stats */
      txt('v3StatDl', rows.length >= 5 ? rows.length + '+' : rows.length);
    } catch(e) { listEl.innerHTML = ''; }
  };

  /* ── Achievements ────────────────────────────────────────────── */
  V3.buildAchievements = function(dl, wl, buy, streak) {
    var items = [
      {e:'🌱',lbl:'Early Starter',bg:'rgba(16,217,142,.15)',locked:false},
      {e:'📚',lbl:'Bookworm',bg:'rgba(61,142,248,.15)',locked:buy<10},
      {e:'🔥',lbl:'Consistent\nLearner',bg:'rgba(245,158,11,.15)',locked:streak<7},
      {e:'🔍',lbl:'Knowledge\nSeeker',bg:'rgba(139,92,246,.15)',locked:buy<25},
      {e:'👑',lbl:'Premium\nMember',bg:'rgba(251,191,36,.15)',locked:true},
      {e:'🏆',lbl:'+2 More',bg:'rgba(239,68,68,.15)',locked:true},
    ];
    var html = items.map(function(a) {
      return '<div class="v3-ach-badge' + (a.locked?' locked':'') + '" title="' + esc(a.lbl.replace('\n',' ')) + '">'
        + '<div class="v3-ach-icon" style="background:' + a.bg + '">' + a.e + '</div>'
        + '<div class="v3-ach-lbl">' + esc(a.lbl.replace('\n',' ')) + '</div>'
        + '</div>';
    }).join('');
    return '<div class="v3-ach-section">'
      + '<div class="v3-section-head">'
      +   '<div class="v3-section-title">Achievements</div>'
      +   '<span class="v3-section-link">View All →</span>'
      + '</div>'
      + '<div class="v3-ach-grid">' + html + '</div>'
      + '</div>';
  };

  /* ── Settings ────────────────────────────────────────────────── */
  V3.buildSettings = function() {
    var items = [
      {e:'👤',lbl:'Account Settings',desc:'Personal info & security',bg:'rgba(61,142,248,.12)',action:'switchMeTab(\'profile\')'},
      {e:'🔔',lbl:'Notification Settings',desc:'Manage your alerts',bg:'rgba(245,158,11,.12)',action:'toggleNotificationCenter&&toggleNotificationCenter()'},
      {e:'🔒',lbl:'Privacy Settings',desc:'Control your privacy',bg:'rgba(139,92,246,.12)',action:'showToast(\'Privacy settings coming soon\',\'info\')'},
      {e:'⬇️',lbl:'Download Settings',desc:'Manage downloads',bg:'rgba(16,217,142,.12)',action:'switchMeTab(\'purchased\')'},
      {e:'🎨',lbl:'Appearance',desc:'Dark Mode',bg:'rgba(239,68,68,.12)',action:'toggleTheme&&toggleTheme()'},
      {e:'🌐',lbl:'Language',desc:'English (India)',bg:'rgba(0,200,232,.12)',action:'showToast(\'Language settings coming soon\',\'info\')'},
    ];
    var html = items.map(function(a) {
      return '<div class="v3-settings-item" onclick="' + a.action + '">'
        + '<div class="v3-si-icon" style="background:' + a.bg + '">' + a.e + '</div>'
        + '<div class="v3-si-info"><div class="v3-si-label">' + esc(a.lbl) + '</div><div class="v3-si-desc">' + esc(a.desc) + '</div></div>'
        + '<div class="v3-si-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
        + '</div>';
    }).join('');
    return '<div class="v3-settings-section">'
      + '<div class="v3-section-head">'
      +   '<div class="v3-section-title">Settings &amp; Preferences</div>'
      +   '<span class="v3-section-link" onclick="switchMeTab(\'settings\')">View All →</span>'
      + '</div>'
      + '<div class="v3-settings-grid">' + html + '</div>'
      + '</div>';
  };

  /* ── Fetch analytics numbers (async fill) ──────────────────── */
  V3.fetchAnalyticsNumbers = async function() {
    var client = sb(), userId = uid();
    if (!client || !userId) return;
    try {
      var dlRes = await client.from('downloads').select('id',{count:'exact',head:true}).eq('user_id',userId);
      var count = dlRes.count || 0;
      V3._ana = {downloads: count};
      txt('v3StatDl', count);
      V3.fillDownloads();
    } catch(e) { V3.fillDownloads(); }
  };

  /* ── Edit Profile page ────────────────────────────────────── */
  V3.openEditProfile = async function() {
    var main = el('dashMain');
    if (!main) return;
    await V3.loadProfile();
    var p = V3.profile || {};
    var u = window.currentUser || {};
    var photoUrl = p.avatar_url || u.avatarUrl || '';
    var initials = ((p.full_name||u.name||'S').charAt(0)||'S').toUpperCase();

    var comPct = V3.completion || 0;
    var missing = [];
    REQUIRED.forEach(function(f) { if (!p[f]||!String(p[f]).trim()) missing.push(f.replace('_',' ')); });
    var banner = '';
    if (comPct < 100) {
      banner = '<div class="v3-completion-banner">'
        + '<div class="v3-cb-emoji">🎯</div>'
        + '<div class="v3-cb-body"><div class="v3-cb-title">Complete your profile</div><div class="v3-cb-sub">Missing: ' + missing.join(', ') + '</div></div>'
        + '<div class="v3-cb-pct">' + comPct + '%</div>'
        + '</div>';
    }

    var avatarPreview = photoUrl
      ? '<img src="' + esc(photoUrl) + '" id="v3EditAvatarImg" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
      : '<span id="v3EditAvatarInit">' + initials + '</span>';

    main.innerHTML = '<div class="v3-edit-wrap">'
      + '<div class="v3-edit-header">'
      +   '<button class="v3-edit-back" onclick="MeV3.backToOverview()" title="Back">'
      +     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>'
      +   '</button>'
      +   '<div class="v3-edit-title">Edit Profile</div>'
      + '</div>'
      + banner
      /* Photo picker */
      + '<div class="v3-edit-photo-row">'
      +   '<div class="v3-edit-photo">' + avatarPreview + '</div>'
      +   '<div class="v3-edit-photo-info">'
      +     '<div class="v3-edit-photo-title">Profile Photo</div>'
      +     '<div class="v3-edit-photo-hint">JPG, PNG, WEBP · Max 1MB · Auto-compressed</div>'
      +     '<button class="v3-edit-photo-btn" onclick="MeV3.openPhotoPicker()">'
      +       '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'
      +       'Change Photo'
      +     '</button>'
      +   '</div>'
      + '</div>'

      /* Personal info */
      + '<div class="v3-edit-card">'
      +   '<div class="v3-edit-card-title">Personal Information</div>'
      +   '<div class="v3-edit-grid">'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Full Name <span class="req">*</span></label><input class="v3-edit-input" id="veFullName" value="' + esc(p.full_name||u.name||'') + '" maxlength="100" placeholder="Your full name"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Email</label><input class="v3-edit-input" value="' + esc(p.email||u.email||'') + '" readonly></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Phone <span class="req">*</span></label><input class="v3-edit-input" id="vePhone" type="tel" value="' + esc(p.phone||'') + '" placeholder="+91 98765 43210" maxlength="15"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Date of Birth <span class="req">*</span></label><input class="v3-edit-input" id="veDob" type="date" value="' + esc(p.dob||'') + '"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Gender <span class="req">*</span></label><select class="v3-edit-select" id="veGender"><option value="">Select</option><option value="male"' + (p.gender==='male'?' selected':'') + '>Male</option><option value="female"' + (p.gender==='female'?' selected':'') + '>Female</option><option value="other"' + (p.gender==='other'?' selected':'') + '>Other</option></select></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Occupation</label><input class="v3-edit-input" id="veOccupation" value="' + esc(p.occupation||'') + '" placeholder="Student / Job seeker" maxlength="100"></div>'
      +   '</div>'
      + '</div>'

      /* Location */
      + '<div class="v3-edit-card">'
      +   '<div class="v3-edit-card-title">Location</div>'
      +   '<div class="v3-edit-grid">'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">District <span class="req">*</span></label><input class="v3-edit-input" id="veDistrict" value="' + esc(p.district||'') + '" placeholder="Kamrup / Dibrugarh" maxlength="60"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">State</label><input class="v3-edit-input" id="veState" value="' + esc(p.state||'Assam') + '" maxlength="60"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Country</label><input class="v3-edit-input" id="veCountry" value="' + esc(p.country||'India') + '" maxlength="60"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Address <span class="req">*</span></label><input class="v3-edit-input" id="veAddress" value="' + esc(p.address||'') + '" placeholder="Your address" maxlength="300"></div>'
      +   '</div>'
      + '</div>'

      /* Education */
      + '<div class="v3-edit-card">'
      +   '<div class="v3-edit-card-title">Education &amp; Study</div>'
      +   '<div class="v3-edit-grid">'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Exam Preparing For</label><input class="v3-edit-input" id="veExam" value="' + esc(p.exam_preparing||'') + '" placeholder="APSC / UPSC / SSC..." maxlength="100"></div>'
      +     '<div class="v3-edit-field"><label class="v3-edit-label">Language</label><select class="v3-edit-select" id="veLang"><option value="en"' + (p.language==='en'||!p.language?' selected':'') + '>English</option><option value="as"' + (p.language==='as'?' selected':'') + '>Assamese</option><option value="hi"' + (p.language==='hi'?' selected':'') + '>Hindi</option><option value="bn"' + (p.language==='bn'?' selected':'') + '>Bengali</option></select></div>'
      +     '<div class="v3-edit-field full"><label class="v3-edit-label">Bio</label><textarea class="v3-edit-textarea" id="veBio" maxlength="200" placeholder="Tell us about yourself...">' + esc(p.bio||'') + '</textarea></div>'
      +   '</div>'
      + '</div>'

      + '<div class="v3-edit-save-bar">'
      +   '<div class="v3-edit-save-hint">All data is encrypted and saved securely to Supabase.</div>'
      +   '<button class="v3-edit-save-btn" id="veSaveBtn" onclick="MeV3.handleSave()">'
      +     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
      +     'Save Profile'
      +   '</button>'
      + '</div>'

      + '</div>'
      + '<input type="file" id="v3PhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="MeV3.handlePhotoChange(this)">';
  };

  /* ── Handle Save ─────────────────────────────────────────── */
  V3.handleSave = async function() {
    var btn = el('veSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }
    var g = function(id) { var e = el(id); return e ? e.value : ''; };
    var ok = await V3.saveProfile({
      full_name: g('veFullName'), phone: g('vePhone'), dob: g('veDob'),
      gender: g('veGender'), occupation: g('veOccupation'),
      district: g('veDistrict'), state: g('veState'), country: g('veCountry'),
      address: g('veAddress'), exam_preparing: g('veExam'),
      language: g('veLang'), bio: g('veBio'),
      email: (window.currentUser||{}).email || ''
    });
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Save Profile'; }
    if (ok) {
      if (typeof showToast === 'function') showToast('Profile saved! ✅', 'success');
      setTimeout(function() { V3.backToOverview(); }, 800);
    } else {
      if (typeof showToast === 'function') showToast('Save failed. Try again.', 'error');
    }
  };

  /* ── Photo picker ────────────────────────────────────────── */
  V3.openPhotoPicker = function() {
    var inp = el('v3PhotoInput');
    if (inp) inp.click();
  };

  V3.handlePhotoChange = async function(inp) {
    if (!inp.files || !inp.files[0]) return;
    if (typeof showToast === 'function') showToast('Uploading photo...', 'info');
    var res = await V3.uploadPhoto(inp.files[0]);
    if (res && res.url) {
      if (typeof showToast === 'function') showToast('Photo updated! ✅', 'success');
      /* Update avatar preview in profile card */
      var av = el('v3PcAvatar');
      if (av) { av.innerHTML = '<img src="' + esc(res.url) + '" referrerpolicy="no-referrer">'; }
      /* Update edit page preview */
      var ep = el('v3EditAvatarImg') || el('v3EditAvatarInit');
      if (ep && ep.tagName === 'IMG') ep.src = res.url;
      /* Update existing me-avatar in header */
      var ha = el('dashAvatar');
      if (ha) ha.style.backgroundImage = 'url(' + res.url + ')';
    } else {
      if (typeof showToast === 'function') showToast((res && res.error) || 'Upload failed', 'error');
    }
    inp.value = '';
  };

  /* ── Back to overview ────────────────────────────────────── */
  V3.backToOverview = async function() {
    /* Re-run overview */
    var stats = window._dashCache || await _fetchDashStats().catch(function(){return null;});
    await V3.renderOverview(stats);
  };

  /* ── Copy referral ───────────────────────────────────────── */
  V3.copyRef = function(code) {
    try { navigator.clipboard.writeText(code); } catch(e) {}
    if (typeof showToast === 'function') showToast('Copied: ' + code + ' 🎁', 'success');
  };

  /* ── Downloads shortcut ──────────────────────────────────── */
  V3.openDownloads = function() {
    if (typeof switchMeTab === 'function') switchMeTab('purchased');
  };

  /* ── Enhanced Settings tab ───────────────────────────────── */
  V3.renderSettingsTab = function() {
    var main = el('dashMain');
    if (!main) return;
    var groups = [
      {
        head: 'Account',
        items: [
          {e:'👤',lbl:'Edit Profile',desc:'Update personal info',action:'MeV3.openEditProfile()',bg:'rgba(61,142,248,.12)'},
          {e:'🔐',lbl:'Change Password',desc:'Update your password',action:'showToast(\'Use password reset email\',\'info\')',bg:'rgba(139,92,246,.12)'},
          {e:'📧',lbl:'Email',desc:(window.currentUser&&window.currentUser.email)||'—',action:'',bg:'rgba(16,217,142,.12)'},
        ]
      },
      {
        head: 'Preferences',
        items: [
          {e:'🎨',lbl:'Appearance',desc:'Dark / Light mode',action:'typeof toggleTheme!==\'undefined\'&&toggleTheme()',bg:'rgba(239,68,68,.12)'},
          {e:'🌐',lbl:'Language',desc:'English (India)',action:'showToast(\'Language settings coming soon\',\'info\')',bg:'rgba(0,200,232,.12)'},
          {e:'🔔',lbl:'Notifications',desc:'Manage alerts',action:'typeof toggleNotificationCenter!==\'undefined\'&&toggleNotificationCenter()',bg:'rgba(245,158,11,.12)'},
        ]
      },
      {
        head: 'Privacy & Data',
        items: [
          {e:'🔒',lbl:'Privacy Settings',desc:'Control your data',action:'showToast(\'Privacy settings coming soon\',\'info\')',bg:'rgba(139,92,246,.12)'},
          {e:'📤',lbl:'Export Data',desc:'Download your data',action:'MeV3.exportData()',bg:'rgba(16,217,142,.12)'},
          {e:'🗑️',lbl:'Delete Account',desc:'Permanently remove account',action:'showToast(\'Contact studyria24@gmail.com\',\'info\')',bg:'rgba(239,68,68,.12)'},
        ]
      }
    ];
    var html = '<div class="me-tab-panel"><div class="me-section-title" style="margin-bottom:18px"><span class="mst-accent"></span>⚙️ Settings & Preferences</div>';
    groups.forEach(function(g) {
      html += '<div style="margin-bottom:22px"><div style="font-size:.75rem;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">' + g.head + '</div>'
        + '<div style="border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03)">';
      g.items.forEach(function(item, idx) {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:' + (idx<g.items.length-1?'1px solid rgba(255,255,255,.04)':'none') + ';cursor:pointer;transition:background .2s" onclick="' + item.action + '" onmouseover="this.style.background=\'rgba(61,142,248,.05)\'" onmouseout="this.style.background=\'\'">'
          + '<div style="width:36px;height:36px;border-radius:10px;background:' + item.bg + ';display:flex;align-items:center;justify-content:center;font-size:.95rem;flex-shrink:0">' + item.e + '</div>'
          + '<div style="flex:1;min-width:0"><div style="font-size:.85rem;font-weight:700">' + esc(item.lbl) + '</div><div style="font-size:.7rem;color:var(--text2);margin-top:1px">' + esc(item.desc) + '</div></div>'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.4;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>'
          + '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    main.innerHTML = html;
  };

  /* ── Export data ──────────────────────────────────────────── */
  V3.exportData = function() {
    var data = { profile: V3.profile, user: { name:(window.currentUser||{}).name, email:(window.currentUser||{}).email }, exportedAt: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studyria-profile-export.json';
    a.click();
    if (typeof showToast === 'function') showToast('Data exported! 📄', 'success');
  };

  /* ════════════════════════════════════════════════════════════
     HOOK INTO EXISTING renderDashboard + switchMeTab
  ════════════════════════════════════════════════════════════ */

  /* Hook renderDashboard — runs after existing function */
  var _origRender = window.renderDashboard;
  if (typeof _origRender === 'function') {
    window.renderDashboard = async function() {
      await _origRender.apply(this, arguments);
      /* After original renders, init V3 if user is logged in */
      if (window.currentUser) {
        setTimeout(async function() {
          await V3.loadProfile();
          /* Only patch the profile hero — don't touch tabs */
          var hero = el('dashProfileHero');
          if (hero) {
            /* Check if overview is active */
            var activeTab = window.dashTab || 'overview';
            if (activeTab === 'overview') {
              var stats = window._dashCache;
              /* Inject the full V3 overview AFTER clearing dashMain */
              await V3.renderOverview(stats);
            }
          }
          V3._initialized = true;
        }, 100);
      }
    };
  }

  /* Hook switchMeTab */
  var _origSwitch = window.switchMeTab;
  if (typeof _origSwitch === 'function') {
    window.switchMeTab = async function(tab) {
      /* Update active tab state first */
      window.dashTab = tab;
      document.querySelectorAll('#page-dashboard .me-htab[data-tab]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
      });

      if (tab === 'overview') {
        await V3.loadProfile();
        var stats = window._dashCache || await _fetchDashStats().catch(function(){return null;});
        await V3.renderOverview(stats);
        return;
      }

      if (tab === 'profile') {
        await V3.openEditProfile();
        return;
      }

      if (tab === 'settings') {
        V3.renderSettingsTab();
        return;
      }

      /* All other tabs — use original */
      return _origSwitch.apply(this, arguments);
    };
  }

  console.log('%c✨ Studyria Me V3 (Reference Match) loaded', 'color:#3d8ef8;font-weight:bold');
})();
