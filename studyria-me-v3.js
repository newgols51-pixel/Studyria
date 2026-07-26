/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA ME SECTION V3 — PROFILE DASHBOARD ENGINE
   Safe Mode: Only enhances the Me section. Does not touch existing code.
   All Supabase calls respect RLS and only operate on the current user.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────── */
  var MeV3 = {
    profile: null,
    completion: 0,
    verified: false,
    loading: false
  };
  window.MeV3 = MeV3;

  /* ── Required fields for verification ──────────────────────────── */
  var REQUIRED_FIELDS = ['avatar_url', 'full_name', 'dob', 'phone', 'address', 'gender'];

  /* ── Get Supabase client safely ────────────────────────────────── */
  function sb() {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  }

  /* ── Get current user ID ───────────────────────────────────────── */
  function uid() {
    var u = window.currentUser || {};
    return u.uid || u.id || null;
  }

  /* ── Escape HTML ───────────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  /* ── Calculate completion % ────────────────────────────────────── */
  function calcCompletion(p) {
    var filled = 0;
    REQUIRED_FIELDS.forEach(function (f) {
      if (p && p[f] && String(p[f]).trim().length > 0) filled++;
    });
    return Math.round((filled / REQUIRED_FIELDS.length) * 100);
  }

  /* ── Load profile from Supabase ───────────────────────────────── */
  MeV3.loadProfile = async function () {
    var client = sb();
    var userId = uid();
    if (!client || !userId) return null;

    try {
      var res = await client.from('profiles').select('*').eq('id', userId).single();
      if (res.data) {
        MeV3.profile = res.data;
      } else if (res.error && res.error.code === 'PGRST116') {
        /* No row yet — create one */
        MeV3.profile = await MeV3.createProfileRow();
      }
    } catch (e) {
      console.warn('MeV3: loadProfile error', e);
    }

    if (MeV3.profile) {
      MeV3.completion = calcCompletion(MeV3.profile);
      MeV3.verified = MeV3.completion === 100;
    }
    return MeV3.profile;
  };

  /* ── Create profile row (auto on first access) ─────────────────── */
  MeV3.createProfileRow = async function () {
    var client = sb();
    var userId = uid();
    if (!client || !userId) return null;

    var u = window.currentUser || {};
    var row = {
      id: userId,
      full_name: u.name || '',
      email: u.email || '',
      avatar_url: u.avatarUrl || '',
      profile_completed: false,
      verified: false,
      updated_at: new Date().toISOString()
    };

    try {
      var res = await client.from('profiles').insert(row).select().single();
      if (res.data) return res.data;
    } catch (e) {
      console.warn('MeV3: createProfileRow error', e);
    }
    return null;
  };

  /* ── Save profile to Supabase ──────────────────────────────────── */
  MeV3.saveProfile = async function (data) {
    var client = sb();
    var userId = uid();
    if (!client || !userId) return false;

    /* Sanitize all string values */
    var clean = {};
    Object.keys(data).forEach(function (k) {
      if (typeof data[k] === 'string') {
        clean[k] = data[k].trim().substring(0, 500);
      } else {
        clean[k] = data[k];
      }
    });

    clean.id = userId;
    clean.updated_at = new Date().toISOString();
    clean.profile_completed = calcCompletion(clean) === 100;
    clean.verified = calcCompletion(clean) === 100;

    try {
      var res = await client.from('profiles').upsert(clean, { onConflict: 'id' }).select().single();
      if (res.data) {
        MeV3.profile = res.data;
        MeV3.completion = calcCompletion(res.data);
        MeV3.verified = res.data.verified || MeV3.completion === 100;
        return true;
      }
    } catch (e) {
      console.warn('MeV3: saveProfile error', e);
    }
    return false;
  };

  /* ── Upload photo to Supabase Storage ──────────────────────────── */
  MeV3.uploadPhoto = async function (file) {
    var client = sb();
    var userId = uid();
    if (!client || !userId) return null;

    /* Validate file */
    if (!file) return { error: 'No file selected' };
    if (file.size > 1024 * 1024) return { error: 'Image must be under 1MB' };
    var validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (validTypes.indexOf(file.type) === -1) return { error: 'Only JPG, PNG, WEBP allowed' };

    /* Compress with canvas */
    try {
      var compressed = await compressImage(file, 400, 0.82);
      var ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      var path = userId + '/avatar-' + Date.now() + '.' + ext;

      var upRes = await client.storage.from('avatars').upload(path, compressed, {
        contentType: 'image/' + ext,
        upsert: true
      });

      if (upRes.error) {
        /* Try bucket 'profile-photos' as fallback */
        upRes = await client.storage.from('profile-photos').upload(path, compressed, {
          contentType: 'image/' + ext,
          upsert: true
        });
      }

      if (upRes.error) return { error: 'Upload failed: ' + upRes.error.message };

      /* Get public URL */
      var urlRes = client.storage.from('avatars').getPublicUrl(path);
      if (!urlRes.data || !urlRes.data.publicUrl) {
        urlRes = client.storage.from('profile-photos').getPublicUrl(path);
      }

      if (urlRes.data && urlRes.data.publicUrl) {
        var photoUrl = urlRes.data.publicUrl + '?t=' + Date.now();
        /* Save to profile */
        await MeV3.saveProfile({ avatar_url: photoUrl });
        /* Update currentUser in memory */
        if (window.currentUser) {
          window.currentUser.avatarUrl = photoUrl;
        }
        return { url: photoUrl };
      }
    } catch (e) {
      return { error: 'Upload error: ' + e.message };
    }
    return { error: 'Unknown error' };
  };

  /* ── Image compression ─────────────────────────────────────────── */
  function compressImage(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement('canvas');
          var w = img.width, h = img.height;
          if (w > h && w > maxSize) { h = h * (maxSize / w); w = maxSize; }
          else if (h > maxSize) { w = w * (maxSize / h); h = maxSize; }
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            resolve(blob);
          }, 'image/jpeg', quality);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ── Render: Enhanced Hero ─────────────────────────────────────── */
  MeV3.renderHero = function () {
    var u = window.currentUser || {};
    var p = MeV3.profile || {};
    var photoUrl = p.avatar_url || u.avatarUrl || '';
    var name = p.full_name || u.name || 'Studyria User';
    var email = p.email || u.email || '';
    var initials = name.charAt(0).toUpperCase();

    var completionPct = MeV3.completion || 0;
    var isVerified = MeV3.verified;
    var isPremium = false;

    /* Check premium status */
    if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
      /* Async — will update later */
    }

    var streak = p.study_streak || 0;
    var joinDate = '';
    if (u.joined) joinDate = u.joined;
    else if (u.created_at) {
      var d = new Date(u.created_at);
      joinDate = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    }

    var avatarHtml = photoUrl
      ? '<img src="' + esc(photoUrl) + '" alt="' + esc(name) + '" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'' + initials + '\'">'
      : initials;

    var verifiedTick = isVerified
      ? '<span class="me-v3-name-tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>'
      : '';

    var verifiedBadge = isVerified
      ? '<span class="me-v3-badge verified"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>'
      : '';

    var streakBadge = streak > 0
      ? '<span class="me-v3-badge streak">🔥 ' + streak + ' Day Streak</span>'
      : '';

    var premiumBadge = '<span class="me-v3-badge premium" id="meV3PremiumBadge" style="display:none">👑 PREMIUM</span>';

    return '<div class="me-v3-hero">'
      + '<div class="me-v3-inner">'
      + '<div class="me-v3-top">'
      +   '<div class="me-v3-avatar-wrap">'
      +     '<div class="me-v3-avatar" id="meV3Avatar">' + avatarHtml + '</div>'
      +     (isVerified ? '<div class="me-v3-verified"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' : '')
      +     '<div class="me-v3-avatar-edit" onclick="MeV3.openPhotoPicker()" title="Change photo">'
      +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'
      +     '</div>'
      +   '</div>'
      +   '<div class="me-v3-info">'
      +     '<div class="me-v3-name-row">'
      +       '<div class="me-v3-name">' + esc(name) + '</div>'
      +       verifiedTick
      +     '</div>'
      +     '<div class="me-v3-email">' + esc(email) + '</div>'
      +     '<div class="me-v3-badges">'
      +       premiumBadge
      +       verifiedBadge
      +       streakBadge
      +       '<span class="me-v3-badge" style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa">📅 Joined ' + esc(joinDate) + '</span>'
      +     '</div>'
      +     '<div class="me-v3-completion">'
      +       '<div class="me-v3-completion-head">'
      +         '<span>Profile Completion</span>'
      +         '<span class="me-v3-completion-pct">' + completionPct + '%</span>'
      +       '</div>'
      +       '<div class="me-v3-completion-track">'
      +         '<div class="me-v3-completion-fill" style="width:' + completionPct + '%"></div>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="me-v3-quickstats">'
      +   '<div class="me-v3-qs-item"><div class="me-v3-qs-val" id="meV3QsDownloads">0</div><div class="me-v3-qs-label">Downloads</div></div>'
      +   '<div class="me-v3-qs-item"><div class="me-v3-qs-val" id="meV3QsBookmarks">0</div><div class="me-v3-qs-label">Bookmarks</div></div>'
      +   '<div class="me-v3-qs-item"><div class="me-v3-qs-val" id="meV3QsHours">0h</div><div class="me-v3-qs-label">Study Hours</div></div>'
      +   '<div class="me-v3-qs-item"><div class="me-v3-qs-val" id="meV3QsStreak">0</div><div class="me-v3-qs-label">Day Streak</div></div>'
      +   '<div class="me-v3-qs-item"><div class="me-v3-qs-val" id="meV3QsRank">—</div><div class="me-v3-qs-label">Rank</div></div>'
      + '</div>'
      + '<div class="me-v3-tabs" id="meV3Tabs"></div>'
      + '</div>'
      + '</div>'
      + '<input type="file" id="meV3PhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="MeV3.handlePhotoSelect(this)">';
  };

  /* ── Render: Edit Profile Tab ──────────────────────────────────── */
  MeV3.renderEditProfile = function () {
    var p = MeV3.profile || {};
    var u = window.currentUser || {};

    var completionPct = MeV3.completion || 0;
    var banner = '';
    if (completionPct < 100) {
      var missing = [];
      REQUIRED_FIELDS.forEach(function (f) {
        if (!p[f] || !String(p[f]).trim()) missing.push(f.replace('_', ' '));
      });
      banner = '<div class="me-v3-completion-banner">'
        + '<div class="me-v3-cb-icon">🎯</div>'
        + '<div class="me-v3-cb-text">'
        +   '<div class="me-v3-cb-title">Complete your profile (' + completionPct + '%)</div>'
        +   '<div class="me-v3-cb-sub">Missing: ' + missing.join(', ') + '</div>'
        + '</div>'
        + '<button class="me-v3-cb-action" onclick="document.getElementById(\'meV3FirstName\').focus()">Fill Now</button>'
        + '</div>';
    }

    return '<div class="me-tab-panel">'
      + '<div class="me-section-title"><span class="mst-accent"></span>✏️ Edit Profile</div>'
      + banner
      + '<div class="me-profile-card" style="max-width:none">'
      +   '<div class="me-v3-edit-grid">'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Full Name <span class="req">*</span></label>'
      +       '<input class="me-v3-input" id="meV3FirstName" value="' + esc(p.full_name || u.name || '') + '" placeholder="Your full name" maxlength="100">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Email (Read Only)</label>'
      +       '<input class="me-v3-input" value="' + esc(p.email || u.email || '') + '" readonly>'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Phone <span class="req">*</span></label>'
      +       '<input class="me-v3-input" id="meV3Phone" type="tel" value="' + esc(p.phone || '') + '" placeholder="+91 98765 43210" maxlength="15">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Date of Birth <span class="req">*</span></label>'
      +       '<input class="me-v3-input" id="meV3Dob" type="date" value="' + esc(p.dob || '') + '">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Gender <span class="req">*</span></label>'
      +       '<select class="me-v3-select" id="meV3Gender">'
      +         '<option value="">Select</option>'
      +         '<option value="male"' + (p.gender === 'male' ? ' selected' : '') + '>Male</option>'
      +         '<option value="female"' + (p.gender === 'female' ? ' selected' : '') + '>Female</option>'
      +         '<option value="other"' + (p.gender === 'other' ? ' selected' : '') + '>Other</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Occupation</label>'
      +       '<input class="me-v3-input" id="meV3Occupation" value="' + esc(p.occupation || '') + '" placeholder="Student / Job seeker" maxlength="100">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Exam Preparing For</label>'
      +       '<input class="me-v3-input" id="meV3Exam" value="' + esc(p.exam_preparing || '') + '" placeholder="UPSC / APSC / SSC..." maxlength="100">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Language Preference</label>'
      +       '<select class="me-v3-select" id="meV3Lang">'
      +         '<option value="en"' + (p.language === 'en' ? ' selected' : '') + '>English</option>'
      +         '<option value="as"' + (p.language === 'as' ? ' selected' : '') + '>Assamese</option>'
      +         '<option value="hi"' + (p.language === 'hi' ? ' selected' : '') + '>Hindi</option>'
      +         '<option value="bn"' + (p.language === 'bn' ? ' selected' : '') + '>Bengali</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">District</label>'
      +       '<input class="me-v3-input" id="meV3District" value="' + esc(p.district || '') + '" placeholder="Kamrup / Dibrugarh..." maxlength="50">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">State</label>'
      +       '<input class="me-v3-input" id="meV3State" value="' + esc(p.state || '') + '" placeholder="Assam" maxlength="50">'
      +     '</div>'
      +     '<div class="me-v3-field">'
      +       '<label class="me-v3-label">Country</label>'
      +       '<input class="me-v3-input" id="meV3Country" value="' + esc(p.country || 'India') + '" maxlength="50">'
      +     '</div>'
      +     '<div class="me-v3-field me-v3-field-full">'
      +       '<label class="me-v3-label">Address <span class="req">*</span></label>'
      +       '<textarea class="me-v3-textarea" id="meV3Address" placeholder="Your full address" maxlength="300">' + esc(p.address || '') + '</textarea>'
      +     '</div>'
      +     '<div class="me-v3-field me-v3-field-full">'
      +       '<label class="me-v3-label">Bio</label>'
      +       '<textarea class="me-v3-textarea" id="meV3Bio" placeholder="Tell us about yourself..." maxlength="200">' + esc(p.bio || '') + '</textarea>'
      +     '</div>'
      +   '</div>'
      +   '<div class="me-v3-save-bar">'
      +     '<div style="font-size:0.78rem;color:var(--text2)">Changes save to your profile securely</div>'
      +     '<button class="me-v3-save-btn" id="meV3SaveBtn" onclick="MeV3.handleSaveProfile()">'
      +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
      +       'Save Profile'
      +     '</button>'
      +   '</div>'
      + '</div>'
      + '</div>';
  };

  /* ── Render: Analytics Tab ─────────────────────────────────────── */
  MeV3.renderAnalytics = function () {
    return '<div class="me-tab-panel">'
      + '<div class="me-section-title"><span class="mst-accent"></span>📊 Profile Analytics</div>'
      + '<div class="me-v3-analytics-grid">'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(61,142,248,0.15)">⬇️</div><div class="me-v3-ana-val" id="meV3ADownloads">—</div><div class="me-v3-ana-label">Downloads</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(255,77,109,0.15)">🔖</div><div class="me-v3-ana-val" id="meV3ABookmarks">—</div><div class="me-v3-ana-label">Bookmarks</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(16,217,142,0.15)">⏱️</div><div class="me-v3-ana-val" id="meV3AHours">—</div><div class="me-v3-ana-label">Study Hours</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(245,158,11,0.15)">🎯</div><div class="me-v3-ana-val" id="meV3ACompletion">—</div><div class="me-v3-ana-label">Completion %</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(139,92,246,0.15)">🏆</div><div class="me-v3-ana-val" id="meV3ARank">—</div><div class="me-v3-ana-label">Learning Rank</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(239,68,68,0.15)">🔥</div><div class="me-v3-ana-val" id="meV3AStreak">—</div><div class="me-v3-ana-label">Current Streak</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(0,200,232,0.15)">🥇</div><div class="me-v3-ana-val" id="meV3ALongStreak">—</div><div class="me-v3-ana-label">Longest Streak</div></div>'
      +   '<div class="me-v3-ana-card"><div class="me-v3-ana-icon" style="background:rgba(251,191,36,0.15)">📜</div><div class="me-v3-ana-val" id="meV3ACerts">0</div><div class="me-v3-ana-label">Certificates</div></div>'
      + '</div>'
      + '<div class="me-section-title" style="margin-top:24px"><span class="mst-accent"></span>🏆 Achievements</div>'
      + '<div class="me-v3-ach-grid" id="meV3AchGrid"></div>'
      + '</div>';
  };

  /* ── Render: Settings Tab ─────────────────────────────────────── */
  MeV3.renderSettings = function () {
    return '<div class="me-tab-panel">'
      + '<div class="me-section-title"><span class="mst-accent"></span>⚙️ Settings</div>'

      + '<div class="me-v3-settings-group">'
      +   '<div class="me-v3-settings-head">Account</div>'
      +   '<div class="me-v3-settings-card">'
      +     '<div class="me-v3-setting-row" onclick="switchMeTab(\'profile\')">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Edit Profile</div><div class="me-v3-setting-desc">Update your personal information</div></div>'
      +       '<div class="me-v3-setting-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +     '</div>'
      +     '<div class="me-v3-setting-row" onclick="showToast(\'Password change via Supabase auth\',\'info\')">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Change Password</div><div class="me-v3-setting-desc">Update your account password</div></div>'
      +       '<div class="me-v3-setting-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +     '</div>'
      +     '<div class="me-v3-setting-row" onclick="toggleTheme()">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Appearance</div><div class="me-v3-setting-desc">Toggle dark / light mode</div></div>'
      +       '<div class="me-v3-setting-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="me-v3-settings-group">'
      +   '<div class="me-v3-settings-head">Preferences</div>'
      +   '<div class="me-v3-settings-card">'
      +     '<div class="me-v3-setting-row">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Email Notifications</div><div class="me-v3-setting-desc">New PDF releases and study tips</div></div>'
      +       '<button class="me-toggle on" onclick="this.classList.toggle(\'on\')"></button>'
      +     '</div>'
      +     '<div class="me-v3-setting-row">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Push Notifications</div><div class="me-v3-setting-desc">Order confirmations and alerts</div></div>'
      +       '<button class="me-toggle" onclick="this.classList.toggle(\'on\')"></button>'
      +     '</div>'
      +     '<div class="me-v3-setting-row">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Newsletter</div><div class="me-v3-setting-desc">Weekly curated content digest</div></div>'
      +       '<button class="me-toggle on" onclick="this.classList.toggle(\'on\')"></button>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="me-v3-settings-group">'
      +   '<div class="me-v3-settings-head">Data & Privacy</div>'
      +   '<div class="me-v3-settings-card">'
      +     '<div class="me-v3-setting-row" onclick="MeV3.exportData()">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Export Data</div><div class="me-v3-setting-desc">Download all your data</div></div>'
      +       '<div class="me-v3-setting-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +     '</div>'
      +     '<div class="me-v3-setting-row" onclick="showToast(\'Contact support@studyria for account deletion\',\'info\')">'
      +       '<div class="me-v3-setting-info"><div class="me-v3-setting-label">Delete Account</div><div class="me-v3-setting-desc">Permanently remove your account</div></div>'
      +       '<div class="me-v3-setting-arrow" style="color:var(--danger, #ef4444)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '</div>';
  };

  /* ── Render: Referral Card ─────────────────────────────────────── */
  MeV3.renderReferral = function () {
    var u = window.currentUser || {};
    var code = MeV3.profile && MeV3.profile.referral_code
      ? MeV3.profile.referral_code
      : 'STUDY' + (u.uid || '').substring(0, 6).toUpperCase();

    return '<div class="me-v3-referral">'
      + '<div style="font-size:1.4rem">🎁</div>'
      + '<div style="flex:1">'
      +   '<div style="font-weight:700;font-size:0.88rem">Invite Friends, Earn Rewards</div>'
      +   '<div style="font-size:0.76rem;color:var(--text2);margin-top:2px">Share your code and earn coins</div>'
      + '</div>'
      + '<div class="me-v3-ref-code">' + esc(code) + '</div>'
      + '<button class="me-v3-ref-copy" onclick="MeV3.copyReferral(\'' + esc(code) + '\')">Copy</button>'
      + '</div>';
  };

  /* ── Handle: Save Profile ──────────────────────────────────────── */
  MeV3.handleSaveProfile = async function () {
    var btn = document.getElementById('meV3SaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Saving...</span>'; }

    var data = {
      full_name: val('meV3FirstName'),
      phone: val('meV3Phone'),
      dob: val('meV3Dob'),
      gender: val('meV3Gender'),
      occupation: val('meV3Occupation'),
      exam_preparing: val('meV3Exam'),
      language: val('meV3Lang'),
      district: val('meV3District'),
      state: val('meV3State'),
      country: val('meV3Country'),
      address: val('meV3Address'),
      bio: val('meV3Bio'),
      email: (window.currentUser || {}).email || ''
    };

    var ok = await MeV3.saveProfile(data);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Save Profile';
    }

    if (ok) {
      if (typeof showToast === 'function') showToast('Profile saved! ✅', 'success');
      /* Re-render hero to update completion bar + verified badge */
      MeV3.refreshHero();
    } else {
      if (typeof showToast === 'function') showToast('Save failed. Please try again.', 'error');
    }
  };

  /* ── Handle: Photo Picker ──────────────────────────────────────── */
  MeV3.openPhotoPicker = function () {
    var input = document.getElementById('meV3PhotoInput');
    if (input) input.click();
  };

  /* ── Handle: Photo Select ──────────────────────────────────────── */
  MeV3.handlePhotoSelect = async function (input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];

    if (file.size > 1024 * 1024) {
      if (typeof showToast === 'function') showToast('Image must be under 1MB', 'error');
      return;
    }

    if (typeof showToast === 'function') showToast('Uploading photo...', 'info');

    var result = await MeV3.uploadPhoto(file);

    if (result && result.url) {
      if (typeof showToast === 'function') showToast('Photo updated! ✅', 'success');
      MeV3.refreshHero();
    } else {
      if (typeof showToast === 'function') showToast((result && result.error) || 'Upload failed', 'error');
    }

    /* Reset input */
    input.value = '';
  };

  /* ── Refresh hero after profile changes ────────────────────────── */
  MeV3.refreshHero = function () {
    var oldHero = document.getElementById('dashProfileHero');
    if (!oldHero) return;

    /* Keep the existing tabs from old hero */
    var oldTabs = oldHero.querySelector('.me-hero-tabs');
    var oldTabsHtml = oldTabs ? oldTabs.innerHTML : '';

    /* Re-render the hero with updated data */
    var newHeroHtml = MeV3.renderHero();
    var tmp = document.createElement('div');
    tmp.innerHTML = newHeroHtml;
    var newHero = tmp.firstElementChild;

    /* Replace tabs with existing ones (so switchMeTab keeps working) */
    var newTabs = newHero.querySelector('#meV3Tabs');
    if (newTabs && oldTabsHtml) {
      newTabs.innerHTML = oldTabsHtml;
    } else if (newTabs) {
      /* Build tabs matching existing me-htab buttons */
      newTabs.innerHTML = oldTabsHtml;
    }

    oldHero.replaceWith(newHero);
  };

  /* ── Copy referral ─────────────────────────────────────────────── */
  MeV3.copyReferral = function (code) {
    try {
      navigator.clipboard.writeText(code);
      if (typeof showToast === 'function') showToast('Copied: ' + code, 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Code: ' + code, 'info');
    }
  };

  /* ── Export data ───────────────────────────────────────────────── */
  MeV3.exportData = function () {
    var data = {
      profile: MeV3.profile,
      currentUser: window.currentUser ? {
        name: window.currentUser.name,
        email: window.currentUser.email
      } : null,
      exportedAt: new Date().toISOString()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'studyria-profile.json';
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Data exported! 📄', 'success');
  };

  /* ── Fetch analytics numbers ──────────────────────────────────── */
  MeV3.fetchAnalytics = async function () {
    var client = sb();
    var userId = uid();
    if (!client || !userId) return;

    try {
      /* Downloads count */
      var dlRes = await client.from('downloads').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      setVal('meV3QsDownloads', dlRes.count || 0);
      setVal('meV3ADownloads', dlRes.count || 0);

      /* Wishlist count */
      var wlRes = await client.from('wishlists').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      setVal('meV3QsBookmarks', wlRes.count || 0);
      setVal('meV3ABookmarks', wlRes.count || 0);

      /* Reading hours from reading_sessions */
      var rsRes = await client.from('reading_sessions').select('total_seconds').eq('user_id', userId);
      var totalSec = 0;
      if (rsRes.data) rsRes.data.forEach(function (r) { totalSec += (r.total_seconds || 0); });
      var hours = Math.round(totalSec / 3600);
      setVal('meV3QsHours', hours + 'h');
      setVal('meV3AHours', hours + 'h');

      /* Streak from profile */
      var streak = (MeV3.profile && MeV3.profile.study_streak) || 0;
      setVal('meV3QsStreak', streak);
      setVal('meV3AStreak', streak);

      /* Longest streak */
      var longStreak = (MeV3.profile && MeV3.profile.longest_streak) || streak;
      setVal('meV3ALongStreak', longStreak);

      /* Completion */
      setVal('meV3ACompletion', (MeV3.completion || 0) + '%');

      /* Rank — placeholder */
      setVal('meV3QsRank', '—');
      setVal('meV3ARank', '—');

      /* Certificates */
      setVal('meV3ACerts', (MeV3.profile && MeV3.profile.certificates_count) || 0);

      /* Achievements */
      MeV3.renderAchievements(dlRes.count || 0, wlRes.count || 0, hours, streak);
    } catch (e) {
      console.warn('MeV3: fetchAnalytics error', e);
    }
  };

  /* ── Render Achievements ──────────────────────────────────────── */
  MeV3.renderAchievements = function (downloads, bookmarks, hours, streak) {
    var grid = document.getElementById('meV3AchGrid');
    if (!grid) return;

    var ach = [
      { e: '🌱', t: 'Beginner', s: 'Welcome aboard', locked: false },
      { e: '📚', t: 'Active Learner', s: 'Opened 5+ PDFs', locked: downloads < 5 },
      { e: '⬇️', t: 'Top Downloader', s: '10+ downloads', locked: downloads < 10 },
      { e: '📦', t: '100 PDFs', s: 'Downloaded 100', locked: downloads < 100 },
      { e: '👑', t: 'Premium Member', s: 'Upgraded plan', locked: !(window.SMCI && window.SMCI.getStatus && window.SMCI.getStatus().isPremium) },
      { e: '🔥', t: 'Study Streak', s: '7 day streak', locked: streak < 7 },
      { e: '🎯', t: 'Mock Champion', s: '10 mock tests', locked: true },
      { e: '⚡', t: 'MCQ Master', s: '100 MCQs solved', locked: true },
      { e: '📋', t: 'PYQ Expert', s: '50 PYQs solved', locked: true },
      { e: '📜', t: 'Certified', s: 'Earned certificate', locked: true }
    ];

    grid.innerHTML = ach.map(function (a) {
      return '<div class="me-v3-ach' + (a.locked ? ' locked' : '') + '">'
        + '<div class="me-v3-ach-emoji">' + a.e + '</div>'
        + '<div class="me-v3-ach-title">' + a.t + '</div>'
        + '<div class="me-v3-ach-sub">' + (a.locked ? '🔒 ' : '') + a.s + '</div>'
        + '</div>';
    }).join('');
  };

  /* ── Init: Called from renderDashboard ─────────────────────────── */
  MeV3.init = async function () {
    await MeV3.loadProfile();

    /* Replace old hero with V3 hero */
    var oldHero = document.getElementById('dashProfileHero');
    if (!oldHero) return;

    /* Grab existing tabs HTML so switchMeTab keeps working */
    var oldTabs = oldHero.querySelector('.me-hero-tabs');
    var oldTabsHtml = oldTabs ? oldTabs.innerHTML : '';

    /* Build new hero */
    var newHtml = MeV3.renderHero();
    var tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    var newHero = tmp.firstElementChild;

    /* Restore existing tabs inside the V3 tabs container */
    var v3Tabs = newHero.querySelector('#meV3Tabs');
    if (v3Tabs && oldTabsHtml) {
      v3Tabs.innerHTML = oldTabsHtml;
    }

    oldHero.replaceWith(newHero);

    /* Fetch analytics in background */
    MeV3.fetchAnalytics();

    /* Check premium status and show badge */
    (async function () {
      try {
        if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
          var st = await window.SMCI.getStatus(true);
          var pb = document.getElementById('meV3PremiumBadge');
          if (pb && st.isPremium) pb.style.display = 'inline-flex';
        }
      } catch (e) {}
    })();
  };

  /* ── Helpers ───────────────────────────────────────────────────── */
  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  /* ── Auto-init when dashboard renders ──────────────────────────── */
  /* Hook into renderDashboard — called after it finishes */
  var _origRenderDashboard = window.renderDashboard;
  if (typeof _origRenderDashboard === 'function') {
    window.renderDashboard = async function () {
      await _origRenderDashboard.apply(this, arguments);
      /* After dashboard renders, init V3 */
      setTimeout(function () {
        if (window.currentUser) {
          MeV3.init();
        }
      }, 200);
    };
  }

  /* ── Hook switchMeTab for profile/settings V3 ─────────────────── */
  var _origSwitchMeTab = window.switchMeTab;
  if (typeof _origSwitchMeTab === 'function') {
    window.switchMeTab = async function (tab) {
      /* For profile tab, use V3 edit profile */
      if (tab === 'profile') {
        /* Let original run first to set active states */
        await _origSwitchMeTab.apply(this, arguments);
        /* Then override with V3 content */
        await MeV3.loadProfile();
        var main = document.getElementById('dashMain');
        if (main) {
          main.innerHTML = MeV3.renderEditProfile();
          /* Insert referral card before the form */
          var panel = main.querySelector('.me-tab-panel');
          if (panel) {
            var refHtml = MeV3.renderReferral();
            panel.insertAdjacentHTML('afterbegin', refHtml);
          }
        }
        return;
      }

      /* For settings tab, use V3 settings */
      if (tab === 'settings') {
        await _origSwitchMeTab.apply(this, arguments);
        var main2 = document.getElementById('dashMain');
        if (main2) {
          main2.innerHTML = MeV3.renderSettings();
        }
        return;
      }

      /* For overview tab, add analytics section after overview loads */
      if (tab === 'overview') {
        await _origSwitchMeTab.apply(this, arguments);
        /* Append analytics + referral to overview */
        setTimeout(function () {
          var main3 = document.getElementById('dashMain');
          if (main3) {
            var panel = main3.querySelector('.me-tab-panel');
            if (panel) {
              /* Add referral card */
              var refHtml = MeV3.renderReferral();
              panel.insertAdjacentHTML('afterbegin', refHtml);
              /* Add analytics section after recent activity */
              var anaHtml = MeV3.renderAnalytics();
              panel.insertAdjacentHTML('beforeend', anaHtml);
              MeV3.fetchAnalytics();
            }
          }
        }, 500);
        return;
      }

      /* All other tabs — use original */
      return _origSwitchMeTab.apply(this, arguments);
    };
  }

  console.log('%c✨ Studyria Me V3 loaded', 'color: #3d8ef8; font-weight: bold');
})();
