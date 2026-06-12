// ═══════════════════════════════════════════════════════════════
// website-customization.js — Studyria Website Customization
// Schema: website_settings (id, site_name, tagline, contact_email,
//   support_phone, site_description, logo_url, favicon_url,
//   app_icon_url, twitter_url, instagram_url, telegram_url,
//   youtube_url, copyright_text, updated_at)
// NO 'key' column — uses single-row pattern with .limit(1).single()
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Module state ──────────────────────────────────────────────
window._wc = window._wc || {
  settings: null,   // loaded row (null = not yet loaded)
  loading:  false,
};

// ── Supabase shorthand ────────────────────────────────────────
function wcSB() {
  return window.supabaseClient || null;
}

// ── Load settings row ─────────────────────────────────────────
async function wcLoadSettings() {
  const sb = wcSB();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('website_settings')
      .select('*')
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    window._wc.settings = data || null;
    return data || null;
  } catch (e) {
    console.warn('wcLoadSettings:', e.message);
    return null;
  }
}

// ── Save (update or insert) ───────────────────────────────────
async function wcPersist(fields) {
  const sb = wcSB();
  if (!sb) { showToast('Supabase not connected.', 'error'); return false; }
  try {
    const existing = window._wc.settings;
    if (existing && existing.id) {
      // UPDATE
      const { error } = await sb
        .from('website_settings')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
      window._wc.settings = { ...existing, ...fields };
    } else {
      // INSERT
      const { data, error } = await sb
        .from('website_settings')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      window._wc.settings = data;
    }
    return true;
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
    return false;
  }
}

// ── Upload a file to Supabase Storage ─────────────────────────
// bucket:   'site-assets'
// field:    'logo_url' | 'favicon_url' | 'app_icon_url'
// inputId:  id of the <input type="file"> element
async function wcUploadImage(inputId, field, label) {
  const sb = wcSB();
  if (!sb) { showToast('Supabase not connected.', 'error'); return; }

  const input = document.getElementById(inputId);
  if (!input || !input.files || !input.files[0]) {
    showToast('Please select a file first.', 'error');
    return;
  }

  const file   = input.files[0];
  const ext    = file.name.split('.').pop().toLowerCase();
  const fname  = `${field}_${Date.now()}.${ext}`;
  const bucket = 'site-assets';

  try {
    showToast(`Uploading ${label}…`, 'info');

    // Upload to storage
    const { error: upErr } = await sb.storage
      .from(bucket)
      .upload(fname, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;

    // Get public URL
    const { data: urlData } = sb.storage
      .from(bucket)
      .getPublicUrl(fname);
    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) throw new Error('Could not get public URL');

    // Persist only the relevant column
    const ok = await wcPersist({ [field]: publicUrl });
    if (!ok) return;

    // Update preview image in the UI
    const preview = document.getElementById('wc-preview-' + field);
    if (preview) preview.src = publicUrl;

    showToast(`✅ ${label} uploaded!`, 'success');
    if (typeof logAdminActivity === 'function') {
      logAdminActivity(`${label} updated`, 'green');
    }
  } catch (e) {
    showToast('Upload failed: ' + e.message, 'error');
    console.error('wcUploadImage:', e);
  }
}

// ── Convenience wrappers (called from HTML buttons) ───────────
async function wcUploadLogo()    { await wcUploadImage('wc-input-logo',    'logo_url',    'Logo'); }
async function wcUploadFavicon() { await wcUploadImage('wc-input-favicon', 'favicon_url', 'Favicon'); }
async function wcUploadAppIcon() { await wcUploadImage('wc-input-appicon', 'app_icon_url','App Icon'); }

// ── Save all general text fields ──────────────────────────────
async function wcSaveSettings() {
  const fields = {
    site_name:       (document.getElementById('wc-site-name')        || {}).value || '',
    tagline:         (document.getElementById('wc-tagline')           || {}).value || '',
    contact_email:   (document.getElementById('wc-contact-email')     || {}).value || '',
    support_phone:   (document.getElementById('wc-support-phone')     || {}).value || '',
    site_description:(document.getElementById('wc-site-description')  || {}).value || '',
    twitter_url:     (document.getElementById('wc-twitter-url')       || {}).value || '',
    instagram_url:   (document.getElementById('wc-instagram-url')     || {}).value || '',
    telegram_url:    (document.getElementById('wc-telegram-url')      || {}).value || '',
    youtube_url:     (document.getElementById('wc-youtube-url')       || {}).value || '',
    copyright_text:  (document.getElementById('wc-copyright-text')    || {}).value || '',
  };

  // Remove empty strings so we don't overwrite with blank
  Object.keys(fields).forEach(k => { if (!fields[k]) delete fields[k]; });

  const ok = await wcPersist(fields);
  if (ok) {
    showToast('✅ Website settings saved!', 'success');
    if (typeof logAdminActivity === 'function') {
      logAdminActivity('Website settings updated', 'green');
    }
  }
}

// ── Render the General Settings section (called from HTML) ────
function wcRenderGeneralSection() {
  const s = window._wc.settings || {};

  return `
  <div class="admin-section-title">🌐 Website Customization</div>
  <div class="admin-section-sub">Manage your site identity, branding images, contact info and social links.</div>

  <!-- ── Site Identity ── -->
  <div class="admin-settings-section">
    <div class="admin-settings-title" style="color:var(--accent)">🏷 Site Identity</div>
    <div class="card p-4">
      <div class="admin-form-grid">
        <div class="form-group">
          <label class="form-label">Site Name</label>
          <input class="form-input" id="wc-site-name" value="${_wcEsc(s.site_name || 'Studyria')}" placeholder="Studyria" />
        </div>
        <div class="form-group">
          <label class="form-label">Tagline</label>
          <input class="form-input" id="wc-tagline" value="${_wcEsc(s.tagline || "India's #1 PDF Study Platform")}" placeholder="India's #1 PDF Study Platform" />
        </div>
        <div class="form-group">
          <label class="form-label">Contact Email</label>
          <input class="form-input" id="wc-contact-email" value="${_wcEsc(s.contact_email || '')}" placeholder="support@studyria.com" />
        </div>
        <div class="form-group">
          <label class="form-label">Support Phone</label>
          <input class="form-input" id="wc-support-phone" value="${_wcEsc(s.support_phone || '')}" placeholder="+91 XXXXX XXXXX" />
        </div>
      </div>
      <div class="form-group mt-3">
        <label class="form-label">Site Description</label>
        <textarea class="form-input" id="wc-site-description" rows="3" placeholder="Short description of your platform…">${_wcEsc(s.site_description || '')}</textarea>
      </div>
      <div class="form-group mt-3">
        <label class="form-label">Copyright Text</label>
        <input class="form-input" id="wc-copyright-text" value="${_wcEsc(s.copyright_text || '© 2025 Studyria. All rights reserved.')}" />
      </div>
    </div>
  </div>

  <!-- ── Branding Images ── -->
  <div class="admin-settings-section">
    <div class="admin-settings-title" style="color:var(--gold)">🖼 Branding Images</div>
    <div class="card p-4">
      <div class="admin-form-grid">

        <!-- Logo -->
        <div class="form-group">
          <label class="form-label">Logo</label>
          ${s.logo_url ? `<img id="wc-preview-logo_url" src="${_wcEsc(s.logo_url)}" alt="Logo" style="height:48px;border-radius:8px;margin-bottom:8px;display:block;object-fit:contain;background:rgba(255,255,255,0.05);padding:4px" />` : `<div id="wc-preview-logo_url" style="display:none"></div>`}
          <input type="file" class="form-input" id="wc-input-logo" accept="image/*" style="padding:6px" />
          <button class="btn btn-primary btn-sm mt-2" onclick="wcUploadLogo()">⬆ Upload Logo</button>
        </div>

        <!-- Favicon -->
        <div class="form-group">
          <label class="form-label">Favicon</label>
          ${s.favicon_url ? `<img id="wc-preview-favicon_url" src="${_wcEsc(s.favicon_url)}" alt="Favicon" style="height:32px;width:32px;border-radius:6px;margin-bottom:8px;display:block;object-fit:contain;background:rgba(255,255,255,0.05);padding:2px" />` : `<div id="wc-preview-favicon_url" style="display:none"></div>`}
          <input type="file" class="form-input" id="wc-input-favicon" accept="image/*" style="padding:6px" />
          <button class="btn btn-primary btn-sm mt-2" onclick="wcUploadFavicon()">⬆ Upload Favicon</button>
        </div>

        <!-- App Icon -->
        <div class="form-group">
          <label class="form-label">App Icon (PWA)</label>
          ${s.app_icon_url ? `<img id="wc-preview-app_icon_url" src="${_wcEsc(s.app_icon_url)}" alt="App Icon" style="height:48px;width:48px;border-radius:10px;margin-bottom:8px;display:block;object-fit:cover;background:rgba(255,255,255,0.05);padding:2px" />` : `<div id="wc-preview-app_icon_url" style="display:none"></div>`}
          <input type="file" class="form-input" id="wc-input-appicon" accept="image/*" style="padding:6px" />
          <button class="btn btn-primary btn-sm mt-2" onclick="wcUploadAppIcon()">⬆ Upload App Icon</button>
        </div>

      </div>
    </div>
  </div>

  <!-- ── Social Links ── -->
  <div class="admin-settings-section">
    <div class="admin-settings-title" style="color:var(--accent2)">🔗 Social Links</div>
    <div class="card p-4">
      <div class="admin-form-grid">
        <div class="form-group">
          <label class="form-label">Twitter / X</label>
          <input class="form-input" id="wc-twitter-url" value="${_wcEsc(s.twitter_url || '')}" placeholder="https://twitter.com/studyria" />
        </div>
        <div class="form-group">
          <label class="form-label">Instagram</label>
          <input class="form-input" id="wc-instagram-url" value="${_wcEsc(s.instagram_url || '')}" placeholder="https://instagram.com/studyria" />
        </div>
        <div class="form-group">
          <label class="form-label">Telegram</label>
          <input class="form-input" id="wc-telegram-url" value="${_wcEsc(s.telegram_url || '')}" placeholder="https://t.me/studyria" />
        </div>
        <div class="form-group">
          <label class="form-label">YouTube</label>
          <input class="form-input" id="wc-youtube-url" value="${_wcEsc(s.youtube_url || '')}" placeholder="https://youtube.com/@studyria" />
        </div>
      </div>
      <button class="btn btn-primary btn-sm mt-4" onclick="wcSaveSettings()">💾 Save All Settings</button>
    </div>
  </div>`;
}

// ── HTML-escape helper ────────────────────────────────────────
function _wcEsc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Auto-load settings when script is ready ───────────────────
(async function _wcInit() {
  try {
    // Wait for supabaseClient to be ready (it may init after this script)
    let tries = 0;
    while (!window.supabaseClient && tries < 20) {
      await new Promise(r => setTimeout(r, 250));
      tries++;
    }
    await wcLoadSettings();
  } catch (e) {
    console.warn('wcInit:', e);
  }
})();
