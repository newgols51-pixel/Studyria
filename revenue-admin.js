/**
 * ═══════════════════════════════════════════════════════════════════════════
 * revenue-admin.js — Studyria V5.1 Admin Panel for All Revenue Modules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Admin CRUD for all 8 modules. Uses service_role via Edge Functions
 * or direct Supabase queries with admin RLS bypass.
 *
 * SAFETY: Only accessible when window._studyriaIsAdmin === true
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[RevenueAdmin] Core not loaded'); return; }

  let _adminTab = 'dashboard';

  // ── Tables config ─────────────────────────────────────────────────────────
  const TABLES = {
    'mock-series':   { table: 'mock_test_series', label: 'Mock Test Series', fields: ['title','description','series_type','is_premium','is_published'] },
    'mock-tests':     { table: 'mock_tests', label: 'Mock Tests', fields: ['title','description','test_type','duration_minutes','total_marks','is_premium','is_published'] },
    'mock-questions': { table: 'mock_questions', label: 'Questions', fields: ['question_text','option_a','option_b','option_c','option_d','correct_answer','marks','difficulty'] },
    'companies':      { table: 'companies', label: 'Companies', fields: ['name','description','industry','location','is_published'] },
    'internships':    { table: 'internships', label: 'Internships', fields: ['title','description','location','work_mode','stipend','eligibility','is_published'] },
    'placements':     { table: 'placements', label: 'Placements', fields: ['title','description','location','job_type','salary','eligibility','is_published'] },
    'courses':        { table: 'courses', label: 'Courses', fields: ['title','description','category','is_premium','is_published'] },
    'course-lessons': { table: 'course_lessons', label: 'Lessons', fields: ['title','description','video_url','duration_seconds','is_preview'] },
    'interviews':     { table: 'interviews', label: 'Interviews', fields: ['title','description','category','difficulty','is_premium','is_published'] },
    'products':       { table: 'products', label: 'Products', fields: ['title','description','category','price','is_premium','is_published'] },
    'templates':      { table: 'resume_templates', label: 'Resume Templates', fields: ['name','description','is_premium','is_published'] },
  };

  async function render(container) {
    if (!container) return;
    if (!R()._isAdmin()) { container.innerHTML = R().emptyHTML('🔒', 'Admin access required.'); return; }
    const sb = R()._sb();
    if (!sb) { container.innerHTML = R().errorHTML('Supabase not available.'); return; }

    container.innerHTML = `
      <div class="rm-header">
        <div><h1>Revenue Admin Panel</h1><p>Manage all V5.1 revenue modules</p></div>
      </div>
      <div class="rm-tabs" id="raTabs" style="overflow-x:auto">
        ${Object.entries(TABLES).map(([k, v], i) =>
          `<div class="rm-tab ${i===0?'active':''}" onclick="RevenueAdmin._tab('${k}')">${v.label}</div>`
        ).join('')}
        <div class="rm-tab" onclick="RevenueAdmin._tab('reviews')">📝 Resume Reviews</div>
        <div class="rm-tab" onclick="RevenueAdmin._tab('applications')">📋 Applications</div>
        <div class="rm-tab" onclick="RevenueAdmin._tab('certificates')">📜 Certificates</div>
      </div>
      <div id="raContent">${R().skeletonHTML(6)}</div>`;

    _tab(Object.keys(TABLES)[0]);
  }

  function _tab(tab) {
    _adminTab = tab;
    document.querySelectorAll('#raTabs .rm-tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList.add('active');
    _loadContent();
  }

  async function _loadContent() {
    const c = document.getElementById('raContent');
    if (!c) return;
    c.innerHTML = R().skeletonHTML(6);

    try {
      if (_adminTab === 'reviews') return _loadReviews();
      if (_adminTab === 'applications') return _loadApplications();
      if (_adminTab === 'certificates') return _loadCertificates();

      const config = TABLES[_adminTab];
      if (!config) return;
      const sb = R()._sb();
      const { data, error } = await sb.from(config.table)
        .select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      _renderTable(c, data || [], config);
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  function _renderTable(c, data, config) {
    if (!data.length) { c.innerHTML = `${_addButtonHTML(config)}<br>` + R().emptyHTML('📭', `No ${config.label} yet.`); return; }
    c.innerHTML = `${_addButtonHTML(config)}
      <div class="rm-card" style="overflow-x:auto;margin-top:16px">
        <table class="rm-table">
          <thead><tr><th>Title</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${data.map(r => `
            <tr>
              <td>${R().sanitize(r.title || r.name || r.question_text?.slice(0,40) || 'Untitled')}</td>
              <td>
                ${r.is_published ? '<span class="rm-badge rm-badge-free">Published</span>' : '<span class="rm-badge rm-badge-premium">Draft</span>'}
                ${r.is_premium ? ' <span class="rm-badge rm-badge-premium">⭐</span>' : ''}
              </td>
              <td style="font-size:0.78rem;color:var(--rm-text-muted)">${R().timeAgo(r.created_at)}</td>
              <td>
                <button class="rm-btn rm-btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="RevenueAdmin._togglePublish('${config.table}','${r.id}')">
                  ${r.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <button class="rm-btn rm-btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="RevenueAdmin._delete('${config.table}','${r.id}')">Delete</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function _addButtonHTML(config) {
    return `<button class="rm-btn rm-btn-primary" onclick="RevenueAdmin._add('${_adminTab}')">+ Add ${config.label}</button>`;
  }

  async function _togglePublish(table, id) {
    try {
      const sb = R()._sb();
      const { data: r } = await sb.from(table).select('is_published').eq('id', id).single();
      if (!r) return;
      await sb.from(table).update({ is_published: !r.is_published }).eq('id', id);
      R().toast(r.is_published ? 'Unpublished.' : 'Published!', 'success');
      _loadContent();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _delete(table, id) {
    if (!confirm('Are you sure? This will soft-delete the item.')) return;
    try {
      const sb = R()._sb();
      await sb.from(table).update({ deleted_at: new Date().toISOString(), is_published: false }).eq('id', id);
      R().toast('Deleted.', 'info');
      _loadContent();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  function _add(tab) {
    const config = TABLES[tab];
    if (!config) return;
    let fields = '';
    for (const f of config.fields) {
      if (f === 'is_premium' || f === 'is_published' || f === 'is_preview') {
        fields += `<div class="rm-field-group"><label class="rm-label">${R().sanitize(f.replace(/_/g,' '))}</label>
          <select class="rm-select" id="add_${f}"><option value="true">Yes</option><option value="false" selected>No</option></select></div>`;
      } else if (f === 'correct_answer') {
        fields += `<div class="rm-field-group"><label class="rm-label">Correct Answer</label>
          <select class="rm-select" id="add_${f}"><option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option></select></div>`;
      } else if (f === 'series_type' || f === 'test_type' || f === 'category' || f === 'work_mode' || f === 'job_type' || f === 'difficulty' || f === 'task_type') {
        fields += `<div class="rm-field-group"><label class="rm-label">${R().sanitize(f.replace(/_/g,' '))}</label><input class="rm-input" id="add_${f}" placeholder="${R().sanitize(f)}"></div>`;
      } else if (f === 'description') {
        fields += `<div class="rm-field-group"><label class="rm-label">${R().sanitize(f)}</label><textarea class="rm-textarea" id="add_${f}"></textarea></div>`;
      } else if (f === 'duration_minutes' || f === 'total_marks' || f === 'marks' || f === 'price' || f === 'duration_seconds') {
        fields += `<div class="rm-field-group"><label class="rm-label">${R().sanitize(f.replace(/_/g,' '))}</label><input class="rm-input" type="number" id="add_${f}" value="60"></div>`;
      } else {
        fields += `<div class="rm-field-group"><label class="rm-label">${R().sanitize(f.replace(/_/g,' '))}</label><input class="rm-input" id="add_${f}"></div>`;
      }
    }
    R().openModal(`Add ${config.label}`, fields + `<button class="rm-btn rm-btn-primary" style="width:100%;margin-top:16px" onclick="RevenueAdmin._saveAdd('${tab}')">Save</button>`);
  }

  async function _saveAdd(tab) {
    const config = TABLES[tab];
    if (!config) return;
    const payload = {};
    for (const f of config.fields) {
      const el = document.getElementById('add_' + f);
      if (!el) continue;
      let v = el.value;
      if (v === 'true') v = true; else if (v === 'false') v = false;
      if (['duration_minutes','total_marks','marks','price','duration_seconds'].includes(f)) v = parseInt(v) || 0;
      payload[f] = v;
    }
    try {
      const sb = R()._sb();
      const user = await R()._user();
      if (user) payload.created_by = user.id;
      const { error } = await sb.from(config.table).insert(R().sanitizeObj(payload));
      if (error) throw error;
      R().closeModal();
      R().toast('Added successfully!', 'success');
      _loadContent();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _loadReviews() {
    const c = document.getElementById('raContent');
    if (!c) return;
    try {
      const { data } = await R()._sb().from('resume_reviews')
        .select('id,resume_id,user_id,status,score,suggestions,created_at,resumes(title,full_name)')
        .order('created_at', { ascending: false }).limit(30);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📝', 'No review requests yet.'); return; }
      c.innerHTML = `<div class="rm-card" style="overflow-x:auto"><table class="rm-table">
        <thead><tr><th>Resume</th><th>Status</th><th>Score</th><th>Requested</th><th>Actions</th></tr></thead>
        <tbody>${data.map(r => `<tr>
          <td>${R().sanitize(r.resumes?.title || 'Untitled')}</td>
          <td><span class="rm-badge rm-badge-${r.status === 'completed' ? 'free' : r.status === 'pending' ? 'new' : 'premium'}">${R().sanitize(r.status)}</span></td>
          <td>${r.score || '-'}</td><td>${R().timeAgo(r.created_at)}</td>
          <td><button class="rm-btn rm-btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="RevenueAdmin._reviewResume('${r.id}')">Review</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function _loadApplications() {
    const c = document.getElementById('raContent');
    if (!c) return;
    try {
      const { data } = await R()._sb().from('applications')
        .select('id,listing_id,listing_type,status,cover_letter,created_at')
        .order('created_at', { ascending: false }).limit(30);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📋', 'No applications yet.'); return; }
      c.innerHTML = `<div class="rm-card" style="overflow-x:auto"><table class="rm-table">
        <thead><tr><th>Type</th><th>Status</th><th>Applied</th><th>Actions</th></tr></thead>
        <tbody>${data.map(a => `<tr>
          <td>${R().sanitize(a.listing_type || '')}</td>
          <td><span class="rm-badge rm-badge-${a.status === 'offered' ? 'free' : 'new'}">${R().sanitize(a.status)}</span></td>
          <td>${R().timeAgo(a.created_at)}</td>
          <td><button class="rm-btn rm-btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="RevenueAdmin._updateApp('${a.id}')">Update Status</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function _loadCertificates() {
    const c = document.getElementById('raContent');
    if (!c) return;
    try {
      const { data } = await R()._sb().from('certificates')
        .select('id,certificate_id,user_name,course_title,issued_at,is_revoked')
        .order('issued_at', { ascending: false }).limit(30);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📜', 'No certificates issued yet.'); return; }
      c.innerHTML = `<div class="rm-card" style="overflow-x:auto"><table class="rm-table">
        <thead><tr><th>Cert ID</th><th>Name</th><th>Course</th><th>Issued</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${data.map(c => `<tr>
          <td style="font-family:monospace;font-size:0.78rem">${R().sanitize(c.certificate_id)}</td>
          <td>${R().sanitize(c.user_name)}</td><td>${R().sanitize(c.course_title)}</td>
          <td>${R().formatDate(c.issued_at)}</td>
          <td>${c.is_revoked ? '<span class="rm-badge rm-badge-premium">Revoked</span>' : '<span class="rm-badge rm-badge-free">Active</span>'}</td>
          <td>${!c.is_revoked ? `<button class="rm-btn rm-btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="RevenueAdmin._revokeCert('${c.id}')">Revoke</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function _revokeCert(certId) {
    const reason = prompt('Reason for revocation:');
    if (!reason) return;
    try {
      await R()._sb().from('certificates').update({ is_revoked: true, revoked_at: new Date().toISOString(), revoked_reason: reason }).eq('id', certId);
      R().toast('Certificate revoked.', 'info');
      _loadCertificates();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _reviewResume(reviewId) {
    const score = prompt('Score (0-100):', '80');
    if (score === null) return;
    const notes = prompt('Review notes:', 'Looks good!');
    try {
      await R()._sb().from('resume_reviews').update({ status: 'completed', score: parseInt(score) || 0, review_notes: notes || '', updated_at: new Date().toISOString() }).eq('id', reviewId);
      R().toast('Review completed!', 'success');
      _loadReviews();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _updateApp(appId) {
    const status = prompt('Status (applied/reviewing/shortlisted/interview/offered/rejected):', 'shortlisted');
    if (!status) return;
    try {
      await R()._sb().from('applications').update({ status, updated_at: new Date().toISOString() }).eq('id', appId);
      R().toast('Status updated!', 'success');
      _loadApplications();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.RevenueAdmin = Object.freeze({
    render, _tab, _add, _saveAdd, _togglePublish, _delete,
    _reviewResume, _updateApp, _revokeCert,
    init: () => { const p = document.getElementById('page-revenue-admin'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('revenueAdmin', root.RevenueAdmin);
  console.log('[RevenueAdmin] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
