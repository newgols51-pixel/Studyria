/**
 * ═══════════════════════════════════════════════════════════════════════════
 * internship-hub.js — Studyria V5.1 Module 3: Internship & Placement Hub
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[InternshipHub] Core not loaded'); return; }

  let _tab = 'internships';
  let _search = '';
  let _filters = { location: '', type: '' };

  async function render(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="rm-tabs" id="ihTabs">
        <div class="rm-tab active" onclick="InternshipHub._setTab('internships')">💼 Internships</div>
        <div class="rm-tab" onclick="InternshipHub._setTab('placements')">🚀 Placements</div>
        <div class="rm-tab" onclick="InternshipHub._setTab('companies')">🏢 Companies</div>
        <div class="rm-tab" onclick="InternshipHub._setTab('saved')">💾 Saved Jobs</div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="rm-search" style="flex:1"><input type="text" placeholder="Search jobs, companies..." oninput="InternshipHub._search(this.value)"></div>
      </div>
      <div id="ihContent">${R().skeletonHTML(6)}</div>`;
    _loadContent();
  }

  function _setTab(t) {
    _tab = t;
    document.querySelectorAll('#ihTabs .rm-tab').forEach(x => x.classList.remove('active'));
    event?.target?.classList.add('active');
    _loadContent();
  }

  function _search(v) { _search = v; R().debounce(() => _loadContent(), 300)(); }

  async function _loadContent() {
    const c = document.getElementById('ihContent');
    if (!c) return;
    c.innerHTML = R().skeletonHTML(6);
    try {
      if (_tab === 'internships') {
        let q = R()._sb().from('internships').select('id,title,description,location,work_mode,duration,stipend,eligibility,last_date,is_featured,is_premium,company_id')
          .eq('is_published', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(20);
        if (_search) q = q.ilike('title', `%${_search}%`);
        const { data } = await q;
        _renderListings(c, data || [], 'internship');
      } else if (_tab === 'placements') {
        let q = R()._sb().from('placements').select('id,title,description,location,job_type,salary,eligibility,experience_required,last_date,is_featured,is_premium,company_id')
          .eq('is_published', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(20);
        if (_search) q = q.ilike('title', `%${_search}%`);
        const { data } = await q;
        _renderListings(c, data || [], 'placement');
      } else if (_tab === 'companies') {
        const { data } = await R()._sb().from('companies').select('id,name,description,logo_url,industry,location,employee_count,is_featured')
          .eq('is_published', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
        _renderCompanies(c, data || []);
      } else if (_tab === 'saved') {
        await _renderSaved(c);
      }
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  function _renderListings(c, items, type) {
    if (!items.length) { c.innerHTML = R().emptyHTML('💼', `No ${type}s available yet.`); return; }
    c.innerHTML = `<div class="rm-grid rm-grid-2">${items.map(j => `
      <div class="rm-card rm-product-card">
        ${j.is_featured ? '<span class="rm-badge rm-badge-featured">⭐ Featured</span>' : ''}
        <h3 class="rm-card-title">${R().sanitize(j.title)}</h3>
        <p class="rm-card-subtitle">${R().sanitize(j.description?.slice(0, 100) || '')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;font-size:0.78rem;color:var(--rm-text-muted)">
          ${j.location ? `<span>📍 ${R().sanitize(j.location)}</span>` : ''}
          ${j.work_mode ? `<span>💻 ${R().sanitize(j.work_mode)}</span>` : ''}
          ${j.job_type ? `<span>💼 ${R().sanitize(j.job_type?.replace(/_/g,' '))}</span>` : ''}
          ${j.stipend ? `<span>💰 ${R().sanitize(j.stipend)}</span>` : ''}
          ${j.salary ? `<span>💰 ${R().sanitize(j.salary)}</span>` : ''}
        </div>
        ${j.last_date ? `<div style="font-size:0.78rem;color:var(--rm-danger)">⏰ Apply by ${R().formatDate(j.last_date)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="rm-btn ${j.is_premium ? 'rm-btn-gold' : 'rm-btn-primary'}" style="flex:1" onclick="InternshipHub.apply('${j.id}','${type}')">Apply Now</button>
          <button class="rm-btn rm-btn-ghost" onclick="InternshipHub._save('${j.id}','${type}')">💾</button>
        </div>
      </div>`).join('')}</div>`;
  }

  function _renderCompanies(c, items) {
    if (!items.length) { c.innerHTML = R().emptyHTML('🏢', 'No companies listed yet.'); return; }
    c.innerHTML = `<div class="rm-grid rm-grid-3">${items.map(co => `
      <div class="rm-card rm-product-card" onclick="InternshipHub._companyDetail('${co.id}')">
        <div class="rm-product-thumb">${co.logo_url ? `<img src="${R().sanitize(co.logo_url)}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" alt="">` : '🏢'}</div>
        <h3 class="rm-card-title">${R().sanitize(co.name)}</h3>
        <p class="rm-card-subtitle">${R().sanitize(co.industry || '')}</p>
        <div style="font-size:0.78rem;color:var(--rm-text-muted)">📍 ${R().sanitize(co.location || 'Remote')}</div>
      </div>`).join('')}</div>`;
  }

  async function _renderSaved(c) {
    const user = await R()._user();
    if (!user) { c.innerHTML = R().emptyHTML('🔒', 'Please login to view saved jobs.'); return; }
    try {
      const { data } = await R()._sb().from('applications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      if (!data?.length) { c.innerHTML = R().emptyHTML('💾', 'No saved applications yet.'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-2">${data.map(a => `
        <div class="rm-card">
          <h3 class="rm-card-title">${R().sanitize(a.listing_type || 'Job')}</h3>
          <span class="rm-badge rm-badge-${a.status === 'offered' ? 'free' : 'new'}">${R().sanitize(a.status)}</span>
          <p style="font-size:0.78rem;color:var(--rm-text-muted);margin-top:8px">Applied ${R().timeAgo(a.created_at)}</p>
        </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function apply(listingId, type) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to apply.', 'info'); if (typeof navigate === 'function') navigate('login'); return; }
    try {
      await R().safeInsert('applications', { user_id: user.id, listing_id: listingId, listing_type: type, status: 'applied' });
      R().toast('Application submitted!', 'success');
    } catch (e) { R().toast('Could not apply: ' + e.message, 'error'); }
  }

  async function _save(listingId, type) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to save jobs.', 'info'); return; }
    try {
      await R().safeInsert('applications', { user_id: user.id, listing_id: listingId, listing_type: type, status: 'saved' });
      R().toast('Job saved!', 'success');
    } catch (e) { R().toast('Already saved or error: ' + e.message, 'error'); }
  }

  async function _companyDetail(companyId) {
    try {
      const { data } = await R()._sb().from('companies').select('*').eq('id', companyId).single();
      if (data) R().openModal(data.name, `<div>${data.description || 'No description.'}</div><p>📍 ${R().sanitize(data.location||'')}</p><p>🏭 ${R().sanitize(data.industry||'')}</p>`);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.InternshipHub = Object.freeze({
    render, apply, _setTab, _search, _save, _companyDetail,
    init: () => { const p = document.getElementById('page-internship-hub'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('internshipHub', root.InternshipHub);
  console.log('[InternshipHub] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
