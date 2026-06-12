/**
 * website-customization.js
 * Studyria — Website Customization → General Settings
 * All data is read/written via Supabase `website_settings` table.
 * Image uploads go to Supabase Storage bucket `website-assets`.
 *
 * Table schema (run once in Supabase SQL editor):
 * ─────────────────────────────────────────────────
 * create table if not exists website_settings (
 *   id            bigint generated always as identity primary key,
 *   key           text unique not null,
 *   value         text,
 *   updated_at    timestamptz default now()
 * );
 * -- RLS: allow service-role & authenticated admin writes, public reads
 * alter table website_settings enable row level security;
 * create policy "public_read"  on website_settings for select using (true);
 * create policy "admin_write"  on website_settings for all
 *   using (auth.role() = 'authenticated')
 *   with check (auth.role() = 'authenticated');
 *
 * Storage bucket: website-assets (public)
 * ─────────────────────────────────────────
 * Path layout:
 *   website-assets/logo/logo.<ext>
 *   website-assets/favicon/favicon.<ext>
 *   website-assets/app-icon/app-icon.<ext>
 */

'use strict';

/* ── helpers ─────────────────────────────────────────────── */
function _wc_sb() {
  return window.supabaseClient || null;
}

function _wc_toast(msg, type = 'info') {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log(`[${type}] ${msg}`);
}

function _wc_log(msg, color = 'blue') {
  if (typeof logAdminActivity === 'function') logAdminActivity(msg, color);
}

/* ── key map: field-id → supabase key ─────────────────────── */
const WC_KEYS = {
  tsSiteName:    'site_name',
  tsSiteTagline: 'site_tagline',
  tsSiteEmail:   'site_email',
  tsSitePhone:   'site_phone',
  tsSiteDesc:    'site_description',
  tsCopyright:   'copyright_text',
  tsSocialTw:    'social_twitter',
  tsSocialIg:    'social_instagram',
  tsSocialTg:    'social_telegram',
  tsSocialYt:    'social_youtube',
};

const WC_IMG_KEYS = ['logo_url', 'favicon_url', 'app_icon_url'];

/* ── load all settings from Supabase ──────────────────────── */
async function wcLoadSettings() {
  const sb = _wc_sb();
  if (!sb) {
    _wc_toast('⚠️ Supabase not initialised — settings not loaded.', 'error');
    return;
  }

  try {
    const { data, error } = await sb
      .from('website_settings')
      .select('key, value');

    if (error) throw error;

    const map = {};
    (data || []).forEach(row => { map[row.key] = row.value || ''; });

    // Populate text fields
    Object.entries(WC_KEYS).forEach(([elId, dbKey]) => {
      const el = document.getElementById(elId);
      if (el && map[dbKey] !== undefined) el.value = map[dbKey];
    });

    // Populate image previews
    WC_IMG_KEYS.forEach(key => {
      const url = map[key];
      if (url) _wcSetPreview(key, url);
    });

    console.log('[WC] Settings loaded from Supabase ✓');
  } catch (err) {
    console.error('[WC] Load error:', err);
    _wc_toast('❌ Could not load settings: ' + err.message, 'error');
  }
}

/* ── save all settings to Supabase ───────────────────────── */
async function wcSaveSettings() {
  const sb = _wc_sb();
  if (!sb) {
    _wc_toast('❌ Supabase not initialised.', 'error');
    return;
  }

  // Show saving state on button
  const btn = document.getElementById('wcSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    const rows = [];

    // Text / social fields
    Object.entries(WC_KEYS).forEach(([elId, dbKey]) => {
      const el = document.getElementById(elId);
      rows.push({ key: dbKey, value: el ? el.value.trim() : '', updated_at: new Date().toISOString() });
    });

    // Upsert in one call
    const { error } = await sb
      .from('website_settings')
      .upsert(rows, { onConflict: 'key' });

    if (error) throw error;

    _wc_toast('✅ All settings saved!', 'success');
    _wc_log('General site settings saved', 'green');

    // Refresh fields from DB to confirm round-trip
    await wcLoadSettings();
  } catch (err) {
    console.error('[WC] Save error:', err);
    _wc_toast('❌ Save failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save All Settings'; }
  }
}

/* ── image upload ─────────────────────────────────────────── */
/**
 * @param {File}   file
 * @param {'logo_url'|'favicon_url'|'app_icon_url'} dbKey
 */
async function wcUploadImage(file, dbKey) {
  const sb = _wc_sb();
  if (!sb) { _wc_toast('❌ Supabase not initialised.', 'error'); return; }
  if (!file) return;

  // File type validation
  const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
  if (!allowed.includes(file.type)) {
    _wc_toast('❌ Invalid file type. Use PNG, SVG, JPG or ICO.', 'error');
    return;
  }

  // Size cap: 2 MB
  if (file.size > 2 * 1024 * 1024) {
    _wc_toast('❌ File too large (max 2 MB).', 'error');
    return;
  }

  const folderMap = { logo_url: 'logo', favicon_url: 'favicon', app_icon_url: 'app-icon' };
  const folder = folderMap[dbKey];
  const ext = file.name.split('.').pop();
  const storagePath = `${folder}/${folder}.${ext}`;

  // Show progress UI
  _wcSetUploadProgress(dbKey, 10, 'Uploading…');

  try {
    // Upload to Supabase Storage
    const { error: upErr } = await sb.storage
      .from('website-assets')
      .upload(storagePath, file, { upsert: true, contentType: file.type });

    if (upErr) throw upErr;

    _wcSetUploadProgress(dbKey, 70, 'Getting URL…');

    // Get public URL
    const { data: urlData } = sb.storage
      .from('website-assets')
      .getPublicUrl(storagePath);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) throw new Error('Could not get public URL');

    _wcSetUploadProgress(dbKey, 90, 'Saving…');

    // Save URL to website_settings
    const { error: saveErr } = await sb
      .from('website_settings')
      .upsert({ key: dbKey, value: publicUrl, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (saveErr) throw saveErr;

    _wcSetUploadProgress(dbKey, 100, 'Done!');
    _wcSetPreview(dbKey, publicUrl);
    _wc_toast(`✅ ${_wcFriendlyName(dbKey)} uploaded!`, 'success');
    _wc_log(`${_wcFriendlyName(dbKey)} updated`, 'green');

    setTimeout(() => _wcClearProgress(dbKey), 1500);
  } catch (err) {
    console.error('[WC] Upload error:', err);
    _wcSetUploadProgress(dbKey, 0, '');
    _wc_toast('❌ Upload failed: ' + err.message, 'error');
  }
}

/* ── UI helpers ───────────────────────────────────────────── */
function _wcFriendlyName(key) {
  return { logo_url: 'Logo', favicon_url: 'Favicon', app_icon_url: 'App Icon' }[key] || key;
}

function _wcSetPreview(dbKey, url) {
  const el = document.getElementById(`wcPreview_${dbKey}`);
  if (!el) return;
  el.innerHTML = `<img src="${url}" alt="${_wcFriendlyName(dbKey)}" style="max-height:60px;max-width:100%;border-radius:8px;margin-top:8px;display:block;" onerror="this.style.display='none'">
    <div style="font-size:.7rem;color:var(--text2);margin-top:4px;word-break:break-all;">${url.split('/').pop()}</div>`;

  const zone = document.getElementById(`wcZone_${dbKey}`);
  if (zone) zone.classList.add('has-file');
}

function _wcSetUploadProgress(dbKey, pct, label) {
  const bar = document.getElementById(`wcProg_${dbKey}`);
  if (!bar) return;
  bar.style.display = pct > 0 ? 'block' : 'none';
  bar.innerHTML = `
    <div style="height:4px;background:var(--glass-border);border-radius:4px;overflow:hidden;margin-top:8px">
      <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s;border-radius:4px"></div>
    </div>
    ${label ? `<div style="font-size:.7rem;color:var(--text2);margin-top:4px">${label}</div>` : ''}`;
}

function _wcClearProgress(dbKey) {
  const bar = document.getElementById(`wcProg_${dbKey}`);
  if (bar) bar.style.display = 'none';
}

/* ── render the General Settings section HTML ─────────────── */
/**
 * Call this instead of the old inline HTML block.
 * Returns an HTML string ready to be injected into the ts-sec-general div.
 */
function wcRenderGeneralSection() {
  return `
    <!-- Loading overlay -->
    <div id="wcLoadingBar" style="display:none;margin-bottom:12px">
      <div style="height:3px;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;animation:wcPulse 1.2s ease-in-out infinite"></div>
      <div style="font-size:.78rem;color:var(--text2);margin-top:6px">⏳ Loading settings from Supabase…</div>
    </div>
    <style>
      @keyframes wcPulse { 0%,100%{opacity:.4} 50%{opacity:1} }
      .wc-upload-zone {
        border: 2px dashed var(--glass-border);
        border-radius: 14px;
        padding: 18px 14px;
        text-align: center;
        cursor: pointer;
        transition: all .2s;
        position: relative;
        background: var(--surface);
        min-height: 90px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .wc-upload-zone:hover { border-color: var(--accent); background: rgba(61,142,248,0.07); }
      .wc-upload-zone.has-file { border-color: var(--success); background: rgba(16,217,142,0.05); }
      .wc-upload-zone input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 2; }
      .wc-upload-title { font-size: .82rem; font-weight: 700; }
      .wc-upload-hint { font-size: .7rem; color: var(--text2); }
    </style>

    <!-- ⚙ General Info -->
    <div class="mod-form-wrap">
      <div style="font-weight:700;color:var(--accent);margin-bottom:14px">⚙ General Site Settings</div>
      <div class="admin-form-grid">
        <div class="form-group">
          <label class="form-label">Website Name</label>
          <input class="form-input" placeholder="Studyria" id="tsSiteName"/>
        </div>
        <div class="form-group">
          <label class="form-label">Tagline</label>
          <input class="form-input" placeholder="India's #1 PDF Study Platform" id="tsSiteTagline"/>
        </div>
        <div class="form-group">
          <label class="form-label">Contact Email</label>
          <input class="form-input" type="email" placeholder="hello@studyria.com" id="tsSiteEmail"/>
        </div>
        <div class="form-group">
          <label class="form-label">Support Phone</label>
          <input class="form-input" placeholder="+91 00000 00000" id="tsSitePhone"/>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Site Description (meta)</label>
        <textarea class="form-input" rows="2" id="tsSiteDesc" placeholder="Best PDF study materials for JEE, NEET, UPSC…"></textarea>
      </div>
    </div>

    <!-- 🖼 Branding / Image Uploads -->
    <div class="mod-form-wrap" style="margin-top:14px">
      <div style="font-weight:700;color:var(--gold);margin-bottom:14px">🖼 Branding</div>
      <div class="pcc-grid">

        <!-- Logo -->
        <div>
          <div class="wc-upload-zone" id="wcZone_logo_url" title="Upload logo">
            <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp"
              onchange="wcUploadImage(this.files[0],'logo_url')">
            <div class="wc-upload-title">🖼 Upload Logo</div>
            <div class="wc-upload-hint">PNG / SVG · max 2 MB</div>
          </div>
          <div id="wcPreview_logo_url"></div>
          <div id="wcProg_logo_url" style="display:none"></div>
        </div>

        <!-- Favicon -->
        <div>
          <div class="wc-upload-zone" id="wcZone_favicon_url" title="Upload favicon">
            <input type="file" accept="image/x-icon,image/vnd.microsoft.icon,image/png"
              onchange="wcUploadImage(this.files[0],'favicon_url')">
            <div class="wc-upload-title">🔖 Upload Favicon</div>
            <div class="wc-upload-hint">ICO / PNG · 32×32 px</div>
          </div>
          <div id="wcPreview_favicon_url"></div>
          <div id="wcProg_favicon_url" style="display:none"></div>
        </div>

        <!-- App Icon -->
        <div>
          <div class="wc-upload-zone" id="wcZone_app_icon_url" title="Upload app icon">
            <input type="file" accept="image/png,image/webp"
              onchange="wcUploadImage(this.files[0],'app_icon_url')">
            <div class="wc-upload-title">📱 App Icon</div>
            <div class="wc-upload-hint">PNG · 512×512 px</div>
          </div>
          <div id="wcPreview_app_icon_url"></div>
          <div id="wcProg_app_icon_url" style="display:none"></div>
        </div>

      </div>
    </div>

    <!-- 🔗 Social & Footer -->
    <div class="mod-form-wrap" style="margin-top:14px">
      <div style="font-weight:700;color:var(--success);margin-bottom:14px">🔗 Social & Footer</div>
      <div class="admin-form-grid">
        <div class="form-group">
          <label class="form-label">Twitter / X</label>
          <input class="form-input" placeholder="https://x.com/studyria" id="tsSocialTw"/>
        </div>
        <div class="form-group">
          <label class="form-label">Instagram</label>
          <input class="form-input" placeholder="https://instagram.com/studyria" id="tsSocialIg"/>
        </div>
        <div class="form-group">
          <label class="form-label">Telegram</label>
          <input class="form-input" placeholder="https://t.me/studyria" id="tsSocialTg"/>
        </div>
        <div class="form-group">
          <label class="form-label">YouTube</label>
          <input class="form-input" placeholder="https://youtube.com/@studyria" id="tsSocialYt"/>
        </div>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Copyright Text</label>
        <input class="form-input" placeholder="© 2025 Studyria. All rights reserved." id="tsCopyright"/>
      </div>
    </div>

    <!-- Action Bar -->
    <div class="ts-action-bar" style="margin-top:16px">
      <button class="btn btn-primary" id="wcSaveBtn" onclick="wcSaveSettings()">💾 Save All Settings</button>
      <button class="btn btn-ghost btn-sm" onclick="wcLoadSettings()">🔄 Refresh from DB</button>
      <button class="btn btn-secondary btn-sm" onclick="tsExportTheme(tsGetActiveTheme()||TS_BUILTIN_PRESETS[0])">📤 Export Theme JSON</button>
      <button class="btn btn-ghost btn-sm" onclick="tsImportTheme()">📥 Import Theme JSON</button>
    </div>`;
}

/* ── auto-load when General tab becomes visible ─────────────── */
// Patch tsTab so switching to 'general' triggers a load
(function _wcPatchTsTab() {
  const _origTsTab = typeof tsTab === 'function' ? tsTab : null;
  window.tsTab = function(id) {
    if (_origTsTab) _origTsTab(id);
    if (id === 'general') {
      // Small delay so the DOM is injected first
      setTimeout(() => wcLoadSettings(), 80);
    }
  };
})();

/* ── patch tsSaveGeneral to delegate here ──────────────────── */
window.tsSaveGeneral = function() { wcSaveSettings(); };

/* ── expose publicly ─────────────────────────────────────────── */
window.wcLoadSettings   = wcLoadSettings;
window.wcSaveSettings   = wcSaveSettings;
window.wcUploadImage    = wcUploadImage;
window.wcRenderGeneralSection = wcRenderGeneralSection;

console.log('[website-customization.js] loaded ✓');
