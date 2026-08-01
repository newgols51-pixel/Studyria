/**
 * ═══════════════════════════════════════════════════════════════════════════
 * resume-builder.js — Studyria V5.1 Module 2: ATS Resume Builder
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[ResumeBuilder] Core not loaded'); return; }

  let _editing = null; // current resume being edited

  async function render(container) {
    if (!container) return;
    const user = await R()._user();
    if (!user) { container.innerHTML = R().emptyHTML('🔒', 'Please login to build your resume.'); return; }

    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <button class="rm-btn rm-btn-primary" onclick="ResumeBuilder.create()">+ New Resume</button>
      </div>
      <div id="rbList">${R().skeletonHTML(4)}</div>`;

    try {
      const sb = R()._sb();
      const { data } = await sb.from('resumes')
        .select('id,title,full_name,template_id,is_premium,created_at,updated_at')
        .eq('user_id', user.id).is('deleted_at', null).order('updated_at', { ascending: false });
      if (!data?.length) { document.getElementById('rbList').innerHTML = R().emptyHTML('📄', 'No resumes yet. Create your first resume!'); return; }
      document.getElementById('rbList').innerHTML = `<div class="rm-grid rm-grid-3">${data.map(r => `
        <div class="rm-card">
          <h3 class="rm-card-title">${R().sanitize(r.title)}</h3>
          <p class="rm-card-subtitle">${R().sanitize(r.full_name || 'Untitled')}</p>
          <div style="margin-top:8px"><span class="rm-badge ${r.is_premium ? 'rm-badge-premium' : 'rm-badge-free'}">${r.is_premium ? 'Premium' : 'Free'}</span></div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="rm-btn rm-btn-primary" style="flex:1" onclick="ResumeBuilder.edit('${r.id}')">Edit</button>
            <button class="rm-btn rm-btn-ghost" style="flex:1" onclick="ResumeBuilder.preview('${r.id}')">Preview</button>
          </div>
          <button class="rm-btn rm-btn-ghost" style="width:100%;margin-top:8px" onclick="ResumeBuilder.requestReview('${r.id}')">Request Review</button>
        </div>`).join('')}</div>`;
    } catch (e) { document.getElementById('rbList').innerHTML = R().errorHTML(e.message); }
  }

  async function create() {
    const user = await R()._user();
    if (!user) return;
    try {
      const r = await R().safeInsert('resumes', {
        user_id: user.id, title: 'My Resume', full_name: user.user_metadata?.full_name || '',
        email: user.email || '', education: [], experience: [], skills: [], projects: [],
        certifications: [], languages: [], social_links: {}
      });
      if (r) edit(r.id);
    } catch (e) { R().toast('Could not create resume: ' + e.message, 'error'); }
  }

  async function edit(resumeId) {
    try {
      const sb = R()._sb();
      const { data } = await sb.from('resumes').select('*').eq('id', resumeId).single();
      if (!data) { R().toast('Resume not found.', 'error'); return; }
      _editing = data;

      const templates = await R().safeQuery('resume_templates', {
        select: 'id,name,description,thumbnail_url,is_premium,sort_order',
        order: { column: 'sort_order', ascending: true }, limit: 20
      });

      const modal = R().openModal('Edit Resume', `
        <div style="display:flex;gap:12px;margin-bottom:16px">
          <button class="rm-tab active" onclick="ResumeBuilder._editTab('form')">Edit</button>
          <button class="rm-tab" onclick="ResumeBuilder._editTab('preview')">Preview</button>
          <button class="rm-tab" onclick="ResumeBuilder._editTab('template')">Template</button>
        </div>
        <div id="rbEditArea"></div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="rm-btn rm-btn-primary" onclick="ResumeBuilder.save()">Save</button>
          <button class="rm-btn rm-btn-gold" onclick="ResumeBuilder.downloadPDF()">Download PDF</button>
        </div>
      `);
      _editTab('form');
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  function _editTab(tab) {
    const area = document.getElementById('rbEditArea');
    if (!area || !_editing) return;
    document.querySelectorAll('.rm-modal .rm-tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList.add('active');

    if (tab === 'form') {
      area.innerHTML = `
        <div class="rm-field-group"><label class="rm-label">Title</label><input class="rm-input" id="rTitle" value="${R().sanitize(_editing.title || '')}"></div>
        <div class="rm-grid rm-grid-2">
          <div class="rm-field-group"><label class="rm-label">Full Name</label><input class="rm-input" id="rName" value="${R().sanitize(_editing.full_name || '')}"></div>
          <div class="rm-field-group"><label class="rm-label">Email</label><input class="rm-input" id="rEmail" value="${R().sanitize(_editing.email || '')}"></div>
          <div class="rm-field-group"><label class="rm-label">Phone</label><input class="rm-input" id="rPhone" value="${R().sanitize(_editing.phone || '')}"></div>
          <div class="rm-field-group"><label class="rm-label">Summary</label><textarea class="rm-textarea" id="rSummary">${R().sanitize(_editing.summary || '')}</textarea></div>
        </div>
        <div class="rm-field-group"><label class="rm-label">Skills (comma separated)</label><input class="rm-input" id="rSkills" value="${(_editing.skills || []).join(', ')}"></div>
        <div class="rm-field-group"><label class="rm-label">Languages (comma separated)</label><input class="rm-input" id="rLangs" value="${(_editing.languages || []).join(', ')}"></div>
        <p style="color:var(--rm-text-muted);font-size:0.82rem;margin-top:16px">Education, Experience, Projects, Certifications can be added in detailed mode.</p>`;
    } else if (tab === 'preview') {
      area.innerHTML = renderPreview(_editing);
    } else if (tab === 'template') {
      area.innerHTML = `<div class="rm-grid rm-grid-2"><div class="rm-card" style="cursor:pointer;text-align:center" onclick="ResumeBuilder._setTemplate('classic')">
        <div style="font-size:2rem;margin-bottom:8px">📄</div><h3 class="rm-card-title">Classic ATS</h3><p class="rm-card-subtitle">Simple, ATS-friendly</p></div>
        <div class="rm-card rm-locked" style="cursor:pointer" onclick="ResumeBuilder._setTemplate('modern')">
          <div style="font-size:2rem;margin-bottom:8px">🎨</div><h3 class="rm-card-title">Modern</h3><p class="rm-card-subtitle">Premium template</p>
          <div class="rm-locked-content"><div class="lock-icon">🔒</div><div class="lock-text">Premium</div><button class="rm-btn rm-btn-gold" onclick="navigate('premium')">Upgrade</button></div>
        </div></div>`;
    }
  }

  function renderPreview(r) {
    return `<div class="rm-resume-preview">
      <h1>${R().sanitize(r.full_name || 'Your Name')}</h1>
      <p>${R().sanitize(r.email || '')} ${r.phone ? '| ' + R().sanitize(r.phone) : ''}</p>
      ${r.summary ? `<h2>Summary</h2><p>${R().sanitize(r.summary)}</p>` : ''}
      ${(r.education?.length) ? `<h2>Education</h2>${(r.education || []).map(e => `<p>${R().sanitize(e.degree || '')}, ${R().sanitize(e.institution || '')} (${R().sanitize(e.year || '')})</p>`).join('')}` : ''}
      ${(r.experience?.length) ? `<h2>Experience</h2>${(r.experience || []).map(e => `<p><strong>${R().sanitize(e.role || '')}</strong> - ${R().sanitize(e.company || '')}<br>${R().sanitize(e.description || '')}</p>`).join('')}` : ''}
      ${(r.skills?.length) ? `<h2>Skills</h2><p>${(r.skills || []).map(s => R().sanitize(s)).join(', ')}</p>` : ''}
      ${(r.projects?.length) ? `<h2>Projects</h2>${(r.projects || []).map(p => `<p><strong>${R().sanitize(p.name || '')}</strong> - ${R().sanitize(p.description || '')}</p>`).join('')}` : ''}
      ${(r.languages?.length) ? `<h2>Languages</h2><p>${(r.languages || []).join(', ')}</p>` : ''}
    </div>`;
  }

  async function save() {
    if (!_editing) return;
    const title = document.getElementById('rTitle')?.value || _editing.title;
    const name = document.getElementById('rName')?.value || _editing.full_name;
    const email = document.getElementById('rEmail')?.value || _editing.email;
    const phone = document.getElementById('rPhone')?.value || _editing.phone;
    const summary = document.getElementById('rSummary')?.value || _editing.summary;
    const skills = (document.getElementById('rSkills')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const langs = (document.getElementById('rLangs')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

    try {
      await R().safeUpdate('resumes', _editing.id, { title, full_name: name, email, phone, summary, skills, languages: langs });
      _editing = { ..._editing, title, full_name: name, email, phone, summary, skills, languages: langs };
      R().toast('Resume saved!', 'success');
    } catch (e) { R().toast('Save failed: ' + e.message, 'error'); }
  }

  function downloadPDF() {
    if (!_editing) return;
    const preview = renderPreview(_editing);
    const w = window.open('', '_blank');
    if (!w) { R().toast('Please allow popups to download PDF.', 'info'); return; }
    w.document.write(`<html><head><title>${R().sanitize(_editing.full_name || 'Resume')}</title>
      <style>body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1a1a2e}
      h1{font-size:24px;margin:0}h2{font-size:14px;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:16px}
      p{font-size:13px;margin:4px 0}</style></head>
      <body>${preview.replace('rm-resume-preview','')}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  async function preview(resumeId) {
    try {
      const sb = R()._sb();
      const { data } = await sb.from('resumes').select('*').eq('id', resumeId).single();
      if (data) { R().openModal('Resume Preview', renderPreview(data)); }
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function requestReview(resumeId) {
    const user = await R()._user();
    if (!user) return;
    try {
      await R().safeInsert('resume_reviews', { resume_id: resumeId, user_id: user.id, status: 'pending' });
      R().toast('Review requested! Our team will review your resume soon.', 'success');
    } catch (e) { R().toast('Could not request review: ' + e.message, 'error'); }
  }

  function _setTemplate(t) { R().toast('Template selection requires premium.', 'info'); }

  // ── Export ────────────────────────────────────────────────────────────────
  root.ResumeBuilder = Object.freeze({
    render, create, edit, save, preview, requestReview, downloadPDF, _editTab, _setTemplate,
    init: () => { const p = document.getElementById('page-resume-builder'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('resumeBuilder', root.ResumeBuilder);
  console.log('[ResumeBuilder] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
