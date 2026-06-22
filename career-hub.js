/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — CAREER HUB  v2 (premium)
   ═══════════════════════════════════════════════════════════════════
   Single source of truth: Supabase `jobs` table
   • Realtime push via Supabase channel
   • Safe date parsing — never "Invalid Date"
   • Safe vacancy — never "NaN Posts"
   • Stats auto-update from live data
   • Dynamic sections: Featured / Trending / Govt / Scholar / Intern
   • Skeleton loaders, smooth animations
   • Leaving-modal retention engine
   ═══════════════════════════════════════════════════════════════════ */

// ── Shared state ──────────────────────────────────────────────────
window._ch = window._ch || {
  jobs:        [],
  savedJobs:   JSON.parse(localStorage.getItem('ch_saved_jobs') || '[]'),
  inited:      false,
  rtSubscribed:false,
  cat:         'all',
  savedOnly:   false,
  search:      '',
  qual:        '',
  state:       '',
  source:      '',
  sort:        'latest',
};

// ── Entry point called by navigate() ─────────────────────────────
function chInit() {
  const s = window._ch;
  if (!s.inited) {
    s.inited = true;
    _chSavedCount();
    _chLoadSavedCloud();
    _chRealtime();
  }
  if (s.jobs.length) {
    _chStats();
    _chFeaturedBanner();
    _chDynamicSections();
    chFilterJobs();
  }
  chLoadJobs();
}

// ── Supabase fetch ────────────────────────────────────────────────
async function chLoadJobs(notify) {
  const s   = window._ch;
  const lst = document.getElementById('chJobsList');
  const err = document.getElementById('chJobsError');
  const ldg = document.getElementById('chJobsLoading');

  if (err) err.style.display = 'none';
  if (lst && !s.jobs.length) { lst.innerHTML = _skelHTML(5); lst.style.display = ''; }
  if (ldg) ldg.style.display = 'none';

  const sb = window.supabaseClient;
  if (!sb) { _chErr('Supabase not available.'); if (lst) lst.innerHTML = ''; return; }

  try {
    const { data, error } = await sb
      .from('jobs').select('*').eq('active', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at',   { ascending: false })
      .limit(300);
    if (error) throw error;
    s.jobs = (data || []).map(_map);
  } catch (e) {
    console.error('[CareerHub]', e);
    _chErr(e.message || 'Failed to load. Please retry.');
    if (lst) lst.innerHTML = '';
    return;
  }

  _chStats();
  _chFeaturedBanner();
  _chDynamicSections();
  chFilterJobs();
  if (notify && typeof showToast === 'function') showToast('Jobs refreshed ↺', 'info');
}

// ── Skeleton HTML ─────────────────────────────────────────────────
function _skelHTML(n) {
  return Array.from({length:n}, () => `
    <div class="ch-skel-card">
      <div class="ch-skel-row">
        <div class="ch-skel ch-skel-circle"></div>
        <div style="flex:1">
          <div class="ch-skel ch-skel-line lg"></div>
          <div class="ch-skel ch-skel-line md" style="margin-top:6px"></div>
        </div>
      </div>
      <div class="ch-skel-tags">
        <div class="ch-skel ch-skel-tag"></div>
        <div class="ch-skel ch-skel-tag"></div>
        <div class="ch-skel ch-skel-tag" style="width:88px"></div>
      </div>
      <div class="ch-skel-foot">
        <div class="ch-skel ch-skel-icon"></div>
        <div class="ch-skel ch-skel-icon"></div>
        <div class="ch-skel ch-skel-btn"></div>
      </div>
    </div>`).join('');
}

// ── Safe date parser — NEVER "Invalid Date" ───────────────────────
function _parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  // DD-MM-YYYY / DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }
  return null;
}

function _fmtDate(v) {
  const d = _parseDate(v);
  if (!d) return 'Check Notification';
  try {
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  } catch(_) { return 'Check Notification'; }
}

function _isUrgent(v) {
  const d = _parseDate(v);
  if (!d) return false;
  const diff = (d - Date.now()) / 86400000;
  return diff >= 0 && diff <= 7;
}

// ── Safe vacancy — NEVER "NaN Posts" ─────────────────────────────
function _parseVac(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return (isNaN(n) || n <= 0) ? null : n;
}

function _vacDisplay(j) {
  return j.posts ? j.posts.toLocaleString('en-IN') + ' Posts' : 'Various Posts';
}

// ── Row → normalised job object ───────────────────────────────────
function _map(r) {
  const rawDate = r.last_date || null;
  const posts   = _parseVac(r.vacancies || r.total_posts);
  const cats    = Array.isArray(r.category) ? r.category : (r.category ? [r.category] : []);

  return {
    id:          r.id,
    title:       (r.title || 'Untitled').trim(),
    org:         (r.org || r.organization || '').trim(),
    orgIcon:     r.org_icon || '💼',
    location:    (r.location || 'India').trim(),
    qual:        (r.qualification || 'Any').trim(),
    salary:      (r.salary || '').trim(),
    lastDate:    _fmtDate(rawDate),
    rawDate,
    urgentDate:  _isUrgent(rawDate),
    category:    cats,
    featured:    !!r.featured,
    isNew:       r.is_new != null ? !!r.is_new : _recent(r.published_at || r.created_at),
    isTrending:  !!r.is_trending,
    isUrgent:    !!r.is_urgent,
    applyUrl:    r.apply_url || r.link || '#',
    posts,
    desc:        (r.description || '').trim(),
    source:      r.source || 'manual',
    pubAt:       r.published_at || r.created_at || null,
    createdAt:   r.created_at || null,
    jobType:     r.job_type || '',
    appMode:     r.application_mode || '',
    slug:        r.slug || '',
    views:       r.views_count || 0,
    // structured sections
    vacDetails:  r.vacancy_details || '',
    eligibility: r.eligibility || '',
    ageLimit:    r.age_limit || '',
    qualDetails: r.qualification_details || '',
    selection:   r.selection_process || '',
    salDetails:  r.salary_details || '',
    fee:         r.application_fee || '',
    impDates:    r.important_dates || '',
    documents:   r.required_documents || '',
    examPat:     r.exam_pattern || '',
    syllabus:    r.syllabus || '',
    howToApply:  r.how_to_apply || '',
    faq:         r.faq || '',
    // links
    applyLink:   r.apply_url || r.link || '',
    notifLink:   r.notification_link || '',
    official:    r.official_website || '',
    regLink:     r.registration_link || '',
    articleHTML: r.article_content || '',
  };
}

function _recent(ts) {
  if (!ts) return false;
  return (Date.now() - new Date(ts)) / 86400000 <= 5;
}

// ── Realtime ──────────────────────────────────────────────────────
function _chRealtime() {
  const sb = window.supabaseClient;
  const s  = window._ch;
  if (!sb || s.rtSubscribed || typeof sb.channel !== 'function') return;
  try {
    sb.channel('ch-jobs-v2')
      .on('postgres_changes', { event:'*', schema:'public', table:'jobs' }, _handleRT)
      .subscribe();
    s.rtSubscribed = true;
  } catch(e) { console.warn('[CareerHub] realtime:', e); }
}

function _handleRT(p) {
  const s = window._ch;
  if (p.eventType === 'INSERT' && p.new) {
    if (p.new.active === false) return;
    const j = _map(p.new);
    if (!s.jobs.some(x => x.id === j.id)) {
      s.jobs.unshift(j);
      if (typeof showToast === 'function') showToast(`🆕 ${j.title}`, 'success');
    }
  } else if (p.eventType === 'UPDATE' && p.new) {
    const j   = _map(p.new);
    const idx = s.jobs.findIndex(x => x.id === j.id);
    if (j.active === false) { if (idx > -1) s.jobs.splice(idx, 1); }
    else { if (idx > -1) s.jobs[idx] = j; else s.jobs.unshift(j); }
  } else if (p.eventType === 'DELETE' && p.old) {
    s.jobs = s.jobs.filter(x => x.id !== p.old.id);
  }
  _chStats(); _chFeaturedBanner(); _chDynamicSections();
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chFilterJobs();
}

// ── Stats (real counts) ───────────────────────────────────────────
function _chStats() {
  const jobs = window._ch.jobs;
  const cat  = k => jobs.filter(j => j.category.map(c=>c.toLowerCase()).includes(k)).length;
  const fmt  = n => n.toLocaleString('en-IN');
  const set  = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    el.style.transform = 'scale(1.18)';
    setTimeout(() => { el.style.transition = 'transform .3s'; el.style.transform = ''; }, 160);
  };
  set('chStatJobs',    fmt(jobs.length));
  set('chStatGovt',    fmt(cat('govt')));
  set('chStatScholar', fmt(cat('scholarship')));
  set('chStatIntern',  fmt(cat('internship')));
}

// ── Featured banner ───────────────────────────────────────────────
function _chFeaturedBanner() {
  const jobs   = window._ch.jobs;
  const banner = document.getElementById('chFeaturedBanner');
  if (!banner) return;
  const j = jobs.find(x => x.featured) || jobs[0];
  if (!j) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  const t = document.getElementById('chFeaturedTitle');
  const m = document.getElementById('chFeaturedMeta');
  const b = document.getElementById('chFeaturedApplyBtn');
  const posts = j.posts ? ` — ${j.posts.toLocaleString('en-IN')} Posts` : '';
  if (t) t.textContent = j.title + posts;
  if (m) m.innerHTML  = `📍 ${_esc(j.location)} &nbsp;·&nbsp; 🎓 ${_esc(j.qual)} &nbsp;·&nbsp; ⏰ ${_esc(j.lastDate)}`;
  if (b) b.setAttribute('onclick', `chOpenDetail('${j.id}')`);
}

// ── Dynamic sections ──────────────────────────────────────────────
function _chDynamicSections() {
  const jobs = window._ch.jobs;
  if (!jobs.length) return;

  const hasCat   = (j, k) => j.category.map(c=>c.toLowerCase()).includes(k);
  const featured = jobs.filter(j => j.featured).slice(0, 8);
  const trending = jobs.filter(j => j.isTrending || j.isNew).slice(0, 10);
  const govt     = jobs.filter(j => hasCat(j,'govt')).slice(0, 8);
  const scholar  = jobs.filter(j => hasCat(j,'scholarship')).slice(0, 8);
  const intern   = jobs.filter(j => hasCat(j,'internship')).slice(0, 8);

  _injectSection('chFeaturedSection', 'gold', '⭐', 'Featured',     featured, 'featured', true);
  _injectSection('chTrendingSection', 'red',  '🔥', 'Trending',     trending, 'all',      false);
  _injectSection('chGovtSection',     'blue', '🏛️','Govt Jobs',     govt,     'govt',     false);
  _injectSection('chScholarSection',  'gold', '🏆', 'Scholarships', scholar,  'scholarship', false);
  _injectSection('chInternSection',   'green','🎓', 'Internships',  intern,   'internship',  false);
}

function _injectSection(cid, dotCls, icon, title, jobs, catKey, isFeat) {
  const el = document.getElementById(cid);
  if (!el) return;
  if (!jobs.length) { el.innerHTML = ''; return; }
  const cards = isFeat
    ? jobs.map(_featCard).join('')
    : jobs.map(_miniCard).join('');
  const seeAll = catKey !== 'all'
    ? `<button class="ch-see-all" onclick="chSelectCatByKey('${catKey}')">See All →</button>` : '';
  el.innerHTML = `
    <div style="padding:0 0 0 0">
      <div class="ch-section-hd" style="padding-top:20px;padding-bottom:10px">
        <div class="ch-section-title">
          <span class="ch-sec-dot ${dotCls}"></span>${icon} ${_esc(title)}
        </div>
        ${seeAll}
      </div>
      <div class="ch-hscroll">${cards}</div>
    </div>
    <div class="ch-sec-divider"></div>`;
}

function _featCard(j) {
  const posts = j.posts ? `<span class="ch-job-tag">${j.posts.toLocaleString('en-IN')} Posts</span>` : '';
  return `
    <div class="ch-feat-card" onclick="chOpenDetail('${j.id}')">
      <div class="fc-lbl">⭐ Featured</div>
      <div class="fc-title">${_esc(j.title)}</div>
      <div class="fc-org">${_esc(j.org)}</div>
      <div class="fc-tags">
        <span class="ch-job-tag loc">📍 ${_esc(j.location)}</span>
        ${posts}
        <span class="ch-job-tag date${j.urgentDate?' urgent':''}">⏰ ${_esc(j.lastDate)}</span>
      </div>
      <button class="fc-btn" onclick="event.stopPropagation();chOpenDetail('${j.id}')">View Details →</button>
    </div>`;
}

function _miniCard(j) {
  return `
    <div class="ch-mini-card" onclick="chOpenDetail('${j.id}')">
      <div class="mc-icon">${_esc(j.orgIcon)}</div>
      <div class="mc-title">${_esc(j.title)}</div>
      <div class="mc-org">${_esc(j.org)}</div>
      <div class="mc-meta">📍 ${_esc(j.location)} · ⏰ ${_esc(j.lastDate)}</div>
    </div>`;
}

// ── Filter / sort pipeline ────────────────────────────────────────
function _filtered() {
  const s  = window._ch;
  let jobs = [...s.jobs];

  if (s.savedOnly) {
    const sv = new Set(s.savedJobs);
    jobs = jobs.filter(j => sv.has(j.id));
  } else if (s.cat !== 'all') {
    jobs = jobs.filter(j => j.category.map(c=>c.toLowerCase()).includes(s.cat));
  }

  if (s.search) {
    const q = s.search;
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(q) ||
      j.org.toLowerCase().includes(q) ||
      j.location.toLowerCase().includes(q) ||
      j.desc.toLowerCase().includes(q));
  }
  if (s.qual)   jobs = jobs.filter(j => j.qual.toLowerCase().includes(s.qual));
  if (s.state) {
    const map = { assam:'assam', national:'national', northeast:'north east' };
    const nd  = map[s.state] || s.state;
    jobs = jobs.filter(j => j.location.toLowerCase().includes(nd));
  }
  if (s.source) jobs = jobs.filter(j => j.source.toLowerCase() === s.source);

  if (s.sort === 'deadline') {
    jobs.sort((a,b) => {
      const da = _parseDate(a.rawDate), db = _parseDate(b.rawDate);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return da - db;
    });
  } else if (s.sort === 'salary') {
    const n = v => parseInt((v||'0').replace(/[^0-9]/g,''),10)||0;
    jobs.sort((a,b) => n(b.salary) - n(a.salary));
  } else {
    jobs.sort((a,b) => {
      const ta = new Date(a.pubAt||0), tb = new Date(b.pubAt||0);
      if (tb-ta !== 0) return tb-ta;
      return (b.featured?1:0) - (a.featured?1:0);
    });
  }
  return jobs;
}

function chFilterJobs() {
  const s = window._ch;
  s.search = (document.getElementById('chSearchInput')?.value || '').toLowerCase().trim();
  s.qual   = (document.getElementById('chQualFilter')?.value  || '').toLowerCase();
  s.state  = (document.getElementById('chStateFilter')?.value || '').toLowerCase();
  s.source = (document.getElementById('chSourceFilter')?.value|| '').toLowerCase();
  s.sort   =  document.getElementById('chSortFilter')?.value  || 'latest';
  _renderJobs(_filtered());
}

// ── Render list ───────────────────────────────────────────────────
function _renderJobs(jobs) {
  const lst = document.getElementById('chJobsList');
  const emp = document.getElementById('chJobsEmpty');
  const err = document.getElementById('chJobsError');
  if (!lst) return;
  if (err) err.style.display = 'none';
  if (!jobs.length) {
    lst.innerHTML = '';
    if (emp) {
      emp.style.display = 'block';
      const t = document.getElementById('chJobsEmptyText');
      if (t) t.innerHTML = window._ch.savedOnly
        ? 'No saved jobs yet.<br>Tap 🤍 on any card to save.'
        : 'No jobs match your search.<br>Try different keywords or clear filters.';
    }
    return;
  }
  if (emp) emp.style.display = 'none';
  lst.innerHTML = jobs.map(_cardHTML).join('');
}

// ── Premium job card ──────────────────────────────────────────────
function _cardHTML(j) {
  const saved = window._ch.savedJobs.includes(j.id);
  // Qualification truncated to 28 chars max
  const qual  = j.qual.length > 28 ? j.qual.slice(0,28) + '…' : j.qual;
  const posts = j.posts
    ? `<span class="ch-posts-pill">👥 ${j.posts.toLocaleString('en-IN')} Posts</span>` : '';
  const urgCls = j.urgentDate ? ' urgent' : '';

  return `
<div class="ch-job-card${j.featured?' ch-featured-card':''}${j.isNew?' ch-new':''}"
     id="chCard-${j.id}" onclick="chOpenDetail('${j.id}')">
  ${_badgesHTML(j, 3)}
  <div class="ch-job-top">
    <div class="ch-job-org-logo">${_esc(j.orgIcon)}</div>
    <div class="ch-job-info">
      <div class="ch-job-title">${_esc(j.title)}</div>
      <div class="ch-job-org-line">${_esc(j.org)} ${posts}</div>
    </div>
  </div>
  <div class="ch-job-tags">
    <span class="ch-job-tag loc">📍 ${_esc(j.location)}</span>
    <span class="ch-job-tag qual">🎓 ${_esc(qual)}</span>
    <span class="ch-job-tag date${urgCls}">⏰ ${_esc(j.lastDate)}</span>
    ${j.urgentDate ? '<span class="ch-job-tag date urgent">🚨 Closing Soon</span>' : ''}
  </div>
  <div class="ch-job-footer">
    <button class="ch-job-save-btn${saved?' saved':''}"
      onclick="event.stopPropagation();chToggleSave('${j.id}',this)"
      title="${saved?'Unsave':'Save'}">${saved?'❤️':'🤍'}</button>
    <button class="ch-job-share-btn"
      onclick="event.stopPropagation();chShareJob('${j.id}')" title="Share">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>
    <button class="ch-job-apply-btn"
      onclick="event.stopPropagation();chOpenDetail('${j.id}')">
      View Details
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>
</div>`;
}

// ── Badges ────────────────────────────────────────────────────────
function _badges(j) {
  const out  = [];
  const cats = j.category.map(c=>c.toLowerCase());
  const sal  = parseInt((j.salary||'0').replace(/[^0-9]/g,''),10)||0;
  if (j.isNew)            out.push({l:'NEW',c:'new'});
  if (j.featured)         out.push({l:'FEATURED',c:'featured'});
  if (j.isTrending)       out.push({l:'TRENDING',c:'trending'});
  if (j.isUrgent)         out.push({l:'URGENT',c:'urgent'});
  if (sal >= 50000)       out.push({l:'HIGH SALARY',c:'salary'});
  if (j.jobType==='government'||cats.includes('govt'))  out.push({l:'GOVT',c:'govt'});
  if (j.jobType==='private'   ||cats.includes('private')) out.push({l:'PRIVATE',c:'private'});
  if (cats.includes('scholarship')) out.push({l:'SCHOLARSHIP',c:'scholarship'});
  if (cats.includes('internship'))  out.push({l:'INTERNSHIP',c:'internship'});
  return out;
}

function _badgesHTML(j, max) {
  let b = _badges(j);
  if (max) b = b.slice(0, max);
  if (!b.length) return '';
  return `<div class="ch-badges-row">${b.map(x=>`<span class="ch-badge ch-badge-${x.c}">${x.l}</span>`).join('')}</div>`;
}

// ── Category helpers ──────────────────────────────────────────────
function chSelectCat(btn, cat) {
  document.querySelectorAll('.ch-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._ch.cat      = cat;
  window._ch.savedOnly = false;
  _syncSavedUI();
  chFilterJobs();
  btn.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
}
function chSelectCatByKey(cat) {
  const btn = document.querySelector(`.ch-cat-btn[data-cat="${cat}"]`);
  if (btn) chSelectCat(btn, cat);
}
function chToggleSavedView() {
  window._ch.savedOnly = !window._ch.savedOnly;
  _syncSavedUI();
  chFilterJobs();
}
function _syncSavedUI() {
  const s   = window._ch;
  const btn = document.getElementById('chSavedToggleBtn');
  const ttl = document.getElementById('chJobsSectionTitle');
  if (btn) btn.classList.toggle('active', s.savedOnly);
  if (ttl) ttl.innerHTML = s.savedOnly
    ? '<span class="ch-sec-dot red"></span>❤️ Saved Jobs'
    : '<span class="ch-sec-dot blue"></span>💼 Latest Jobs';
}

// ── Save / Unsave ─────────────────────────────────────────────────
function chToggleSave(id, btn) {
  const s   = window._ch;
  const idx = s.savedJobs.indexOf(id);
  if (idx === -1) {
    s.savedJobs.push(id);
    if (btn) { btn.classList.add('saved'); btn.textContent = '❤️'; }
    if (typeof showToast === 'function') showToast('Job saved! ❤️', 'success');
  } else {
    s.savedJobs.splice(idx, 1);
    if (btn) { btn.classList.remove('saved'); btn.textContent = '🤍'; }
    if (typeof showToast === 'function') showToast('Removed from saved', 'info');
  }
  localStorage.setItem('ch_saved_jobs', JSON.stringify(s.savedJobs));
  _chSavedCount();
  if (s.savedOnly) chFilterJobs();
  _syncSaveCloud(id, idx === -1);
}
async function _syncSaveCloud(jobId, saving) {
  const sb = window.supabaseClient; if (!sb) return;
  try {
    const { data:{ session } } = await sb.auth.getSession();
    if (!session?.user) return;
    const uid = session.user.id;
    if (saving) await sb.from('career_hub_saved').upsert({user_id:uid,job_id:jobId},{onConflict:'user_id,job_id'});
    else        await sb.from('career_hub_saved').delete().eq('user_id',uid).eq('job_id',jobId);
  } catch(_) {}
}
async function _chLoadSavedCloud() {
  const sb = window.supabaseClient; if (!sb) return;
  try {
    const { data:{ session } } = await sb.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await sb.from('career_hub_saved').select('job_id').eq('user_id',session.user.id);
    if (!error && data) {
      const merged = [...new Set([...window._ch.savedJobs, ...data.map(r=>r.job_id)])];
      window._ch.savedJobs = merged;
      localStorage.setItem('ch_saved_jobs', JSON.stringify(merged));
      _chSavedCount();
    }
  } catch(_) {}
}
function _chSavedCount() {
  const n   = window._ch.savedJobs.length;
  const btn = document.getElementById('chSavedToggleBtn');
  if (btn) btn.innerHTML = `${n?'❤️':'🤍'} Saved (<span id="chSavedCount">${n}</span>)`;
}

// ── Share ─────────────────────────────────────────────────────────
function chShareJob(id) {
  const j = _find(id); if (!j) return;
  const txt = `💼 ${j.title}\n🏛️ ${j.org}\n📍 ${j.location} | 🎓 ${j.qual}\n⏰ Last Date: ${j.lastDate}\n\nVia Studyria Career Hub`;
  if (navigator.share) navigator.share({title:j.title, text:txt, url:j.applyUrl}).catch(()=>{});
  else {
    navigator.clipboard?.writeText(txt);
    if (typeof showToast === 'function') showToast('Copied to clipboard! 📋', 'success');
  }
}

// ── Utility ───────────────────────────────────────────────────────
function _find(id) { return window._ch.jobs.find(j => String(j.id) === String(id)); }
function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _chErr(msg) {
  const el = document.getElementById('chJobsError');
  const t  = document.getElementById('chJobsErrorText');
  if (el) el.style.display = 'block';
  if (t)  t.textContent = msg;
}

// ── Recently viewed ───────────────────────────────────────────────
function _trackView(id) {
  try {
    let arr = JSON.parse(localStorage.getItem('ch_viewed') || '[]');
    arr = [id, ...arr.filter(x=>x!==id)].slice(0, 20);
    localStorage.setItem('ch_viewed', JSON.stringify(arr));
  } catch(_) {}
}

// ── Recommendations ───────────────────────────────────────────────
function _recs(j, limit) {
  const all   = window._ch.jobs.filter(x => x.id !== j.id);
  const myCat = new Set(j.category.map(c=>c.toLowerCase()));
  const saved = new Set(window._ch.savedJobs);
  return all.map(x => {
    let sc = 0;
    x.category.map(c=>c.toLowerCase()).forEach(c => { if (myCat.has(c)) sc += 3; });
    if (x.qual === j.qual) sc += 2;
    if (x.location === j.location) sc += 1;
    if (saved.has(x.id)) sc += 1;
    if (x.featured) sc += 0.5;
    if (x.isNew) sc += 0.5;
    return { j:x, sc };
  })
  .sort((a,b) => b.sc - a.sc || new Date(b.j.pubAt||0) - new Date(a.j.pubAt||0))
  .slice(0, limit||6).map(x => x.j);
}

// ── Accordion builder ─────────────────────────────────────────────
function _accordion(icon, title, body, open) {
  if (!body?.trim()) return '';
  const id = 'chAcc-' + Math.random().toString(36).slice(2,8);
  return `
  <div class="ch-detail-accordion${open?' open':''}" id="${id}">
    <button class="ch-detail-accordion-hd" onclick="chToggleAcc('${id}')">
      <span class="ch-detail-accordion-title"><span>${icon}</span> ${_esc(title)}</span>
      <svg class="ch-accordion-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="ch-detail-accordion-body">
      <div class="ch-detail-accordion-inner">${_fmtText(body)}</div>
    </div>
  </div>`;
}
function chToggleAcc(id) { document.getElementById(id)?.classList.toggle('open'); }

function _fmtText(t) {
  if (!t) return '';
  return _esc(String(t)
    .replace(/\[&hellip;\]/g,'…').replace(/&hellip;/g,'…')
    .replace(/\s{3,}/g,'\n\n').trim())
    .split(/\n+/).map(l=>l.trim()).filter(Boolean)
    .map(l => /^[-•*]\s?/.test(l)
      ? `<div class="ch-detail-bullet">${l.replace(/^[-•*]\s?/,'')}</div>`
      : `<p>${l}</p>`)
    .join('');
}

// ── Important links ───────────────────────────────────────────────
function _linksHTML(j) {
  const rows = [
    ['Apply Online',     '🚀', j.applyLink && j.applyLink !== '#' ? j.applyLink : ''],
    ['Notification PDF', '📥', j.notifLink],
    ['Official Website', '🌐', j.official],
    ['Registration',     '📝', j.regLink],
  ].filter(([,,u]) => !!u);
  if (!rows.length) return '';
  return `<div class="ch-links-table">
    ${rows.map(([label,icon,url])=>`
      <div class="ch-links-row" onclick="chLeave('${_esc(url).replace(/'/g,"\\'")}','${j.id}')">
        <span class="ch-links-label"><span>${icon}</span> ${_esc(label)}</span>
        <span class="ch-links-go">Open ↗</span>
      </div>`).join('')}
  </div>`;
}

// ── Meta overview grid ────────────────────────────────────────────
function _metaGrid(j) {
  const cards = [
    {icon:'🏛️', label:'Organization', val: j.org || '—',       cls:''},
    {icon:'🎓', label:'Qualification', val: j.qual || 'Any',    cls:''},
    {icon:'🎂', label:'Age Limit',     val: j.ageLimit || '—',  cls:''},
    {icon:'⏰', label:'Last Date',     val: j.lastDate,         cls: j.urgentDate ? 'danger' : ''},
  ];
  if (j.salary)  cards.push({icon:'💰', label:'Salary',    val:j.salary,          cls:'success'});
  if (j.posts)   cards.push({icon:'👥', label:'Vacancies', val:_vacDisplay(j),    cls:'success'});
  if (j.appMode) cards.push({icon:'📝', label:'Mode',      val:j.appMode,         cls:''});
  return `<div class="ch-detail-meta-grid">
    ${cards.map(c=>`
      <div class="ch-detail-meta-item">
        <span class="ch-dm-label">${c.icon} ${_esc(c.label)}</span>
        <span class="ch-dm-val${c.cls?' '+c.cls:''}">${_esc(c.val||'—')}</span>
      </div>`).join('')}
  </div>`;
}

// ── Dates timeline ────────────────────────────────────────────────
function _datesTimeline(j) {
  if (!j.impDates?.trim()) return '';
  const lines = j.impDates.trim().split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const items = lines.map(l => {
    const m = l.match(/^(.+?)[:\-–]\s*(.+)$/);
    return m ? {label:m[1].trim(), val:m[2].trim()} : {label:'Date', val:l};
  });
  if (!items.length) return '';
  return `
  <div class="ch-detail-section-label"><span>📅</span> Important Dates</div>
  <div class="ch-dates-timeline">
    ${items.map((it,i)=>`
      <div class="ch-dates-row${i===items.length-1?' last':''}">
        <div class="ch-dates-dot"></div>
        <div>
          <div class="ch-dates-label">${_esc(it.label)}</div>
          <div class="ch-dates-value">${_esc(it.val)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

// ── Premium Detail Sheet ──────────────────────────────────────────
function chOpenDetail(id) {
  const j = _find(id); if (!j) return;
  _trackView(j.id);
  window._chCurrentId = j.id;

  const saved    = window._ch.savedJobs.includes(j.id);
  const applyUrl = j.applyLink && j.applyLink !== '#' ? j.applyLink : null;
  const recJobs  = _recs(j, 6);
  const hasStruct = !!(j.vacDetails||j.eligibility||j.ageLimit||j.qualDetails||
    j.selection||j.salDetails||j.fee||j.documents||j.examPat||j.syllabus||j.howToApply||j.faq);
  const hasArt   = !!(j.articleHTML?.trim());

  document.getElementById('chJobSheetContent').innerHTML = `
    <!-- progress bar -->
    <div class="ch-detail-progress"><div class="ch-detail-progress-bar" id="chPBar"></div></div>

    <!-- hero -->
    <div class="ch-detail-hero">
      <div class="ch-detail-hero-row">
        <div class="ch-detail-org-logo">${_esc(j.orgIcon)}</div>
        <div style="flex:1;min-width:0;padding-top:2px">
          <div class="ch-detail-title">${_esc(j.title)}</div>
          <div class="ch-detail-org">${_esc(j.org)}</div>
          ${j.posts ? `<div class="ch-detail-posts-pill">👥 ${j.posts.toLocaleString('en-IN')} Posts Available</div>` : ''}
        </div>
      </div>
      ${_badgesHTML(j)}
    </div>

    <!-- read time -->
    <div class="ch-detail-readtime">
      <span>🔒 Full details inside Studyria</span>
      ${j.views ? `<span>👁️ ${Number(j.views).toLocaleString()} views</span>` : ''}
    </div>

    <!-- sticky action bar -->
    <div class="ch-detail-actionbar">
      <button class="ch-action-btn primary"
        onclick="chLeave('${applyUrl ? _esc(applyUrl).replace(/'/g,"\\'") : ''}','${j.id}')"
        ${!applyUrl?'disabled':''}>
        Apply Now →
      </button>
      <button class="ch-action-btn icon${saved?' active':''}" id="chDetailSave"
        onclick="chToggleSave('${j.id}',this);_syncDetailSave('${j.id}')" title="Save">
        ${saved?'❤️':'🤍'}
      </button>
      <button class="ch-action-btn icon" onclick="chShareJob('${j.id}')" title="Share">📤</button>
      <button class="ch-action-btn icon" onclick="chCopyLink('${j.id}')" title="Copy link">🔗</button>
      ${j.notifLink ? `<button class="ch-action-btn icon" onclick="chLeave('${_esc(j.notifLink).replace(/'/g,"\\'")}','${j.id}')" title="Notification">📥</button>` : ''}
    </div>

    <!-- overview -->
    <div class="ch-detail-section-label" style="padding-top:18px"><span>⚡</span> Overview</div>
    ${_metaGrid(j)}

    <!-- dates timeline -->
    ${_datesTimeline(j)}

    <!-- important links -->
    ${_linksHTML(j) ? `<div class="ch-detail-section-label"><span>🔗</span> Important Links</div>${_linksHTML(j)}` : ''}

    <!-- structured sections -->
    ${hasStruct ? `
    <div class="ch-detail-section-label"><span>📋</span> Full Details</div>
    <div class="ch-detail-sections">
      ${_accordion('📄','Overview',             j.desc,       !hasArt)}
      ${_accordion('👥','Vacancy Details',       j.vacDetails)}
      ${_accordion('✅','Eligibility Criteria',  j.eligibility)}
      ${_accordion('🎂','Age Limit',             j.ageLimit)}
      ${_accordion('🎓','Qualification',         j.qualDetails)}
      ${_accordion('🧭','Selection Process',     j.selection)}
      ${_accordion('💰','Salary / Pay Scale',    j.salDetails)}
      ${_accordion('💳','Application Fee',       j.fee)}
      ${_accordion('📑','Required Documents',    j.documents)}
      ${_accordion('📝','Exam Pattern',          j.examPat)}
      ${_accordion('📘','Syllabus',              j.syllabus)}
      ${_accordion('🚀','How To Apply',          j.howToApply)}
      ${_accordion('❓','FAQ',                   j.faq)}
    </div>` : (!hasArt && j.desc ? `
    <div class="ch-detail-section-label" style="padding-top:18px"><span>📄</span> About This Opportunity</div>
    <div style="padding:0 20px">
      <div class="ch-detail-overview-card">${_fmtText(j.desc)}</div>
    </div>` : '')}

    <!-- full article -->
    ${hasArt ? `
    <div class="ch-detail-section-label"><span>📰</span> Full Notification</div>
    <div class="ch-article-body">${j.articleHTML}</div>` : ''}

    <!-- recommendations -->
    ${recJobs.length ? `
    <div class="ch-detail-section-label"><span>✨</span> You Might Also Like</div>
    <div class="ch-rec-scroll">
      ${recJobs.map(r=>`
        <div class="ch-rec-card" onclick="chOpenDetail('${r.id}')">
          ${_badgesHTML(r,1)}
          <div class="ch-rec-org-logo">${_esc(r.orgIcon)}</div>
          <div class="ch-rec-title">${_esc(r.title)}</div>
          <div class="ch-rec-meta">📍 ${_esc(r.location)} · ⏰ ${_esc(r.lastDate)}</div>
        </div>`).join('')}
    </div>` : ''}

    <div style="height:80px"></div>`;

  // open sheet fullscreen
  const sheet = document.getElementById('chJobSheet');
  sheet.classList.add('ch-fullscreen');
  sheet.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // scroll progress
  const inner = document.getElementById('chJobSheetInner');
  if (inner) {
    inner.scrollTop = 0;
    inner.onscroll = () => {
      const bar = document.getElementById('chPBar'); if (!bar) return;
      const pct = inner.scrollTop / Math.max(1, inner.scrollHeight - inner.clientHeight);
      bar.style.width = Math.min(100, pct*100) + '%';
    };
  }
  _incViews(j.id);
}

function _syncDetailSave(id) {
  const btn   = document.getElementById('chDetailSave'); if (!btn) return;
  const saved = window._ch.savedJobs.includes(id);
  btn.classList.toggle('active', saved);
  btn.textContent = saved ? '❤️' : '🤍';
}

async function _incViews(id) {
  const sb = window.supabaseClient; if (!sb) return;
  try { await sb.rpc('increment_job_views', { job_id:id }); } catch(_) {}
}

function chCopyLink(id) {
  const j = _find(id); if (!j) return;
  const url = j.slug
    ? `${location.origin}${location.pathname}#career-hub/job/${j.slug}`
    : (j.applyLink && j.applyLink !== '#' ? j.applyLink : location.href);
  navigator.clipboard?.writeText(url).then(() => {
    if (typeof showToast === 'function') showToast('Link copied! 🔗', 'success');
  }).catch(()=>{});
}

function chCloseJobSheet(e) {
  if (e && e.target !== document.getElementById('chJobSheet')) return;
  const sheet = document.getElementById('chJobSheet');
  sheet.style.display = 'none';
  sheet.classList.remove('ch-fullscreen');
  document.body.style.overflow = '';
}

// backward compat
function chApplyJob(id) { chOpenDetail(id); }

// ── Leaving modal (retention engine) ─────────────────────────────
function chLeave(url, jobId) {
  if (!url) return;
  const j = _find(jobId);
  const suggestions = j ? _recs(j, 4) : window._ch.jobs.slice(0, 4);
  window._chPendingUrl = url;

  let modal = document.getElementById('chLeavingModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chLeavingModal';
    modal.className = 'ch-leaving-overlay';
    modal.onclick = e => { if (e.target === modal) chCloseLeavingModal(); };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="ch-leaving-card">
      <div class="ch-leaving-icon">🚀</div>
      <div class="ch-leaving-title">You're Leaving Studyria</div>
      <div class="ch-leaving-sub">You'll be taken to an external website to continue your application.</div>
      ${suggestions.length ? `
      <div class="ch-leaving-recs-label">Explore while you're here</div>
      <div class="ch-leaving-recs">
        ${suggestions.map(r=>`
          <div class="ch-leaving-rec" onclick="chCloseLeavingModal();chOpenDetail('${r.id}')">
            <span class="ch-leaving-rec-icon">${_esc(r.orgIcon)}</span>
            <span class="ch-leaving-rec-title">${_esc(r.title)}</span>
          </div>`).join('')}
      </div>` : ''}
      <div class="ch-leaving-actions">
        <button class="ch-leaving-btn ghost" onclick="chCloseLeavingModal()">Browse More Jobs</button>
        <button class="ch-leaving-btn primary" onclick="chConfirmLeave()">Continue to Apply →</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function chConfirmLeave() {
  const url = window._chPendingUrl;
  chCloseLeavingModal();
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function chCloseLeavingModal() {
  const m = document.getElementById('chLeavingModal');
  if (m) m.style.display = 'none';
  window._chPendingUrl = null;
}

// ── Auto-init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chInit();
});
