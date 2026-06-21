/* ════════════════════════════════════════════════════════════════════
   STUDYRIA — CAREER HUB  (production build)
   ════════════════════════════════════════════════════════════════════
   Live data pipeline:
     AssamCareer RSS → Pipedream → Supabase `jobs` table → here

   • Auto-fetches on page load, ordered by published_at DESC
   • Supabase Realtime pushes new rows instantly (no refresh needed)
   • Search · Category · Qualification · State · Source · Sort filters
   • Loading / Empty / Error states
   • Apply Now button uses job.apply_url (job.link from RSS)
   • Saved jobs (localStorage + Supabase cross-device sync)
   • No hardcoded / demo jobs — Supabase is the single source of truth
   ════════════════════════════════════════════════════════════════════

   ── REQUIRED SUPABASE SQL (run once in SQL Editor) ──────────────────

   -- 1. jobs table
   CREATE TABLE IF NOT EXISTS jobs (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     title         TEXT NOT NULL,
     org           TEXT,
     org_icon      TEXT,
     location      TEXT,
     qualification TEXT,
     salary        TEXT,
     last_date     DATE,
     category      TEXT[],
     featured      BOOLEAN DEFAULT false,
     is_new        BOOLEAN DEFAULT false,
     apply_url     TEXT,
     link          TEXT,           -- RSS original link (alias for apply_url)
     vacancies     INTEGER,
     description   TEXT,
     source        TEXT,           -- 'manual'|'rss'|'jsearch'|'pipedream'
     source_id     TEXT UNIQUE,    -- dedupe key (upsert target)
     active        BOOLEAN DEFAULT true,
     published_at  TIMESTAMPTZ,    -- from RSS pubDate / JSearch date
     created_at    TIMESTAMPTZ DEFAULT now(),
     updated_at    TIMESTAMPTZ DEFAULT now()
   );

   -- Index for fast latest-first queries
   CREATE INDEX IF NOT EXISTS jobs_published_at_idx ON jobs (published_at DESC NULLS LAST);
   CREATE INDEX IF NOT EXISTS jobs_source_idx ON jobs (source);
   CREATE INDEX IF NOT EXISTS jobs_active_idx ON jobs (active);

   -- 2. RLS
   ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "public_read_active_jobs"
     ON jobs FOR SELECT USING (active = true);
   -- Pipedream uses SERVICE_ROLE key → bypasses RLS (never expose in browser)

   -- 3. Saved jobs
   CREATE TABLE IF NOT EXISTS career_hub_saved (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
     job_id     UUID REFERENCES jobs(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ DEFAULT now(),
     UNIQUE(user_id, job_id)
   );
   ALTER TABLE career_hub_saved ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "user_manage_own_saved" ON career_hub_saved
     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

   -- 4. Realtime (Pipedream inserts → browser updates instantly)
   ALTER PUBLICATION supabase_realtime ADD TABLE jobs;

   -- 5. Helper: auto-set updated_at on every UPDATE
   CREATE OR REPLACE FUNCTION set_updated_at()
   RETURNS TRIGGER LANGUAGE plpgsql AS $$
   BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
   DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
   CREATE TRIGGER trg_jobs_updated_at
     BEFORE UPDATE ON jobs
     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

   ════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────
window._chState = {
  initialized:       false,
  realtimeSubscribed:false,
  activeCategory:    'all',
  showSavedOnly:     false,
  searchQuery:       '',
  qualFilter:        '',
  stateFilter:       '',
  sourceFilter:      '',
  sortFilter:        'latest',
  savedJobs:         JSON.parse(localStorage.getItem('ch_saved_jobs') || '[]'),
  jobs:              [],
  error:             null,
  lastFetch:         0,
};

// ── Init ──────────────────────────────────────────────────────────
// Called by navigate('career-hub') every time the tab is opened.
// One-time setup (saved jobs, Realtime) only runs once per page load.
function chInit() {
  const s = window._chState;

  if (!s.initialized) {
    s.initialized = true;
    _chLoadSavedFromStorage();
    _chUpdateSavedCount();
    _chLoadSavedFromSupabase();   // merge cross-device saves, non-blocking
    _chSubscribeRealtime();        // Pipedream → Supabase → instant UI update
  } else if (s.jobs.length) {
    // Re-render from cache instantly while fresh fetch runs in background
    chRenderJobs(_chComputeFiltered());
  }

  chLoadJobs();
}

// ── Fetch jobs from Supabase ──────────────────────────────────────
async function chLoadJobs(notify) {
  const s      = window._chState;
  const listEl = document.getElementById('chJobsList');
  const loadEl = document.getElementById('chJobsLoading');
  const errEl  = document.getElementById('chJobsError');
  const firstLoad = !s.jobs.length;

  s.error = null;
  if (errEl) errEl.style.display = 'none';
  if (firstLoad && loadEl) { loadEl.style.display = 'flex'; if (listEl) listEl.style.display = 'none'; }

  const sb = window.supabaseClient;
  if (!sb) {
    _chShowError('Supabase client not available. Check your connection.');
    if (loadEl) loadEl.style.display = 'none';
    if (listEl) listEl.style.display = '';
    return;
  }

  try {
    const { data, error } = await sb
      .from('jobs')
      .select('*')
      .eq('active', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at',   { ascending: false })
      .limit(300);

    if (error) throw error;

    s.jobs      = (Array.isArray(data) ? data : []).map(_chMapRow);
    s.lastFetch = Date.now();
  } catch (err) {
    console.error('Career Hub: Supabase fetch failed:', err);
    s.error = err.message || 'Failed to load jobs. Please try again.';
    _chShowError(s.error);
  }

  if (loadEl) loadEl.style.display = 'none';
  if (listEl) listEl.style.display = '';

  _chUpdateStats();
  _chUpdateFeaturedBanner();
  chFilterJobs();

  if (notify && typeof showToast === 'function') showToast('Jobs refreshed ↺', 'info');
}

// Normalize a Supabase row into the shape used by the UI
function _chMapRow(row) {
  return {
    id:            row.id,
    title:         row.title || 'Untitled Opportunity',
    org:           row.org   || '',
    orgIcon:       row.org_icon || '💼',
    location:      row.location || 'India',
    qualification: row.qualification || 'Any',
    salary:        row.salary || '',
    lastDate:      row.last_date ? _chFmtDate(row.last_date) : 'Ongoing',
    category:      Array.isArray(row.category) ? row.category : (row.category ? [row.category] : []),
    featured:      !!row.featured,
    isNew:         row.is_new != null ? !!row.is_new : _chIsRecent(row.published_at || row.created_at),
    isTrending:    !!row.is_trending,
    isUrgent:      !!row.is_urgent,
    applyUrl:      row.apply_url || row.link || '#',
    vacancies:     row.vacancies || null,
    totalPosts:    row.total_posts || row.vacancies || null,
    description:   row.description || '',
    source:        row.source || 'manual',
    publishedAt:   row.published_at || row.created_at || null,
    createdAt:     row.created_at || null,
    applicationMode: row.application_mode || '',
    jobType:       row.job_type || '',
    slug:          row.slug || '',
    viewsCount:    row.views_count || 0,
    appliesCount:  row.applies_count || 0,

    // ── Structured 15-section content (all optional) ──
    vacancyDetails:       row.vacancy_details || '',
    eligibility:          row.eligibility || '',
    ageLimit:             row.age_limit || '',
    qualificationDetails: row.qualification_details || '',
    selectionProcess:     row.selection_process || '',
    salaryDetails:        row.salary_details || '',
    applicationFee:       row.application_fee || '',
    importantDates:       row.important_dates || '',
    requiredDocuments:    row.required_documents || '',
    examPattern:          row.exam_pattern || '',
    syllabusText:         row.syllabus || '',
    howToApply:           row.how_to_apply || '',
    faq:                  row.faq || '',

    // ── Important Links (ONLY these 3 may ever open externally) ──
    notificationLink:  row.notification_link || '',
    officialWebsite:   row.official_website || '',
    registrationLink:  row.registration_link || '',
    loginLink:         row.login_link || '',
    syllabusLink:      row.syllabus_link || '',
    admitCardLink:     row.admit_card_link || '',
    resultLink:        row.result_link || '',

    // ── Full Article Import (read entirely inside Studyria) ──
    organization:      row.organization || row.org || '',
    articleContent:    row.article_content || '',
    sourceUrl:         row.source_url || '',   // never rendered as a link — internal only
  };
}

function _chFmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (_) { return String(d); }
}

function _chIsRecent(ts) {
  if (!ts) return false;
  return (Date.now() - new Date(ts).getTime()) / 86400000 <= 5;
}

// ── Realtime subscription (Pipedream → Supabase → instant update) ──
function _chSubscribeRealtime() {
  const sb = window.supabaseClient;
  if (!sb || window._chState.realtimeSubscribed || typeof sb.channel !== 'function') return;
  try {
    sb.channel('ch-jobs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, _chHandleRealtime)
      .subscribe();
    window._chState.realtimeSubscribed = true;
  } catch (e) {
    console.warn('Career Hub: realtime unavailable.', e);
  }
}

function _chHandleRealtime(payload) {
  const s = window._chState;
  if (!Array.isArray(s.jobs)) return;

  if (payload.eventType === 'INSERT' && payload.new) {
    if (payload.new.active === false) return;
    const job = _chMapRow(payload.new);
    if (!s.jobs.some(j => j.id === job.id)) {
      s.jobs.unshift(job);
      if (typeof showToast === 'function') showToast(`🆕 ${job.title}`, 'success');
    }
  } else if (payload.eventType === 'UPDATE' && payload.new) {
    const job = _chMapRow(payload.new);
    const idx = s.jobs.findIndex(j => j.id === job.id);
    if (job.active === false) {
      if (idx > -1) s.jobs.splice(idx, 1);
    } else {
      if (idx > -1) s.jobs[idx] = job; else s.jobs.unshift(job);
    }
  } else if (payload.eventType === 'DELETE' && payload.old) {
    s.jobs = s.jobs.filter(j => j.id !== payload.old.id);
  }

  _chUpdateStats();
  _chUpdateFeaturedBanner();
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chFilterJobs();
}

// ── Error state ───────────────────────────────────────────────────
function _chShowError(msg) {
  let el = document.getElementById('chJobsError');
  if (!el) {
    // Inject error container if it isn't in the HTML yet
    el = document.createElement('div');
    el.id = 'chJobsError';
    el.className = 'ch-error-state';
    el.style.cssText = 'display:none;text-align:center;padding:48px 20px;color:var(--danger);font-size:.88rem';
    const list = document.getElementById('chJobsList');
    if (list) list.parentNode.insertBefore(el, list);
  }
  el.innerHTML = `<span style="font-size:2.4rem;display:block;margin-bottom:12px">⚠️</span>${_chEsc(msg)}<br><button onclick="chLoadJobs(true)" style="margin-top:16px;padding:10px 22px;border-radius:var(--radius-sm);border:1px solid var(--danger);background:rgba(255,77,109,.1);color:var(--danger);font-size:.82rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">Retry</button>`;
  el.style.display = 'block';
}

// ── Category / Filter API ────────────────────────────────────────
function chSelectCat(btn, cat) {
  document.querySelectorAll('.ch-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._chState.activeCategory = cat;
  window._chState.showSavedOnly  = false;
  _chSyncSavedUI();
  chFilterJobs();
  btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function chSelectCatByKey(cat) {
  const btn = document.querySelector(`.ch-cat-btn[data-cat="${cat}"]`);
  if (btn) chSelectCat(btn, cat);
}

function chToggleSavedView() {
  const s = window._chState;
  s.showSavedOnly = !s.showSavedOnly;
  _chSyncSavedUI();
  chFilterJobs();
}

function _chSyncSavedUI() {
  const s   = window._chState;
  const btn = document.getElementById('chSavedToggleBtn');
  const ttl = document.getElementById('chJobsSectionTitle');
  if (btn) btn.classList.toggle('active', s.showSavedOnly);
  if (ttl) ttl.innerHTML = s.showSavedOnly ? '<span>❤️</span> Saved Jobs' : '<span>💼</span> Latest Jobs';
}

// Master filter + sort computation — called on every filter change
function _chComputeFiltered() {
  const s = window._chState;
  let jobs = [...(s.jobs || [])];

  // Saved view
  if (s.showSavedOnly) {
    jobs = jobs.filter(j => (s.savedJobs || []).includes(j.id));
  } else if (s.activeCategory !== 'all') {
    jobs = jobs.filter(j => (j.category || []).includes(s.activeCategory));
  }

  // Search (title + org + location + description)
  if (s.searchQuery) {
    const q = s.searchQuery;
    jobs = jobs.filter(j =>
      (j.title       || '').toLowerCase().includes(q) ||
      (j.org         || '').toLowerCase().includes(q) ||
      (j.location    || '').toLowerCase().includes(q) ||
      (j.description || '').toLowerCase().includes(q)
    );
  }

  // Qualification filter (loose match)
  if (s.qualFilter) {
    jobs = jobs.filter(j => (j.qualification || '').toLowerCase().includes(s.qualFilter));
  }

  // State / region filter
  if (s.stateFilter) {
    const map = { assam: 'assam', national: 'national', northeast: 'north east' };
    const needle = map[s.stateFilter] || s.stateFilter;
    jobs = jobs.filter(j => (j.location || '').toLowerCase().includes(needle));
  }

  // Source filter
  if (s.sourceFilter) {
    jobs = jobs.filter(j => (j.source || '').toLowerCase() === s.sourceFilter);
  }

  // Sort
  if (s.sortFilter === 'deadline') {
    jobs.sort((a, b) => new Date(a.lastDate) - new Date(b.lastDate));
  } else if (s.sortFilter === 'salary') {
    const getN = v => parseInt((v || '0').replace(/[^0-9]/g, ''), 10) || 0;
    jobs.sort((a, b) => getN(b.salary) - getN(a.salary));
  } else {
    // Latest first — primary: published_at DESC, secondary: featured pinned
    jobs.sort((a, b) => {
      const ta = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.publishedAt || b.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return 0;
    });
  }

  return jobs;
}

// Read all filter controls and re-render
function chFilterJobs() {
  const s = window._chState;
  s.searchQuery  = (document.getElementById('chSearchInput')?.value  || '').toLowerCase().trim();
  s.qualFilter   = (document.getElementById('chQualFilter')?.value   || '').toLowerCase();
  s.stateFilter  = (document.getElementById('chStateFilter')?.value  || '').toLowerCase();
  s.sourceFilter = (document.getElementById('chSourceFilter')?.value || '').toLowerCase();
  s.sortFilter   =  document.getElementById('chSortFilter')?.value   || 'latest';
  chRenderJobs(_chComputeFiltered());
}

// ── Rendering ────────────────────────────────────────────────────
function chRenderJobs(jobs) {
  const listEl  = document.getElementById('chJobsList');
  const emptyEl = document.getElementById('chJobsEmpty');
  const errEl   = document.getElementById('chJobsError');
  if (!listEl) return;

  if (errEl) errEl.style.display = 'none';

  if (!jobs.length) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const txt = document.getElementById('chJobsEmptyText');
      if (txt) txt.innerHTML = window._chState.showSavedOnly
        ? 'No saved jobs yet.<br>Tap 🤍 on any job to save it here.'
        : 'No jobs match your search.<br>Try different keywords or clear filters.';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = jobs.map(_chCardHTML).join('');
}

function _chCardHTML(j) {
  const saved  = (window._chState.savedJobs || []).includes(j.id);
  const src    = j.source && j.source !== 'manual'
    ? `<span class="ch-job-tag" style="font-size:.63rem;opacity:.7">📡 ${_chEsc(j.source)}</span>` : '';
  return `
<div class="ch-job-card${j.featured?' ch-featured-card':''}${j.isNew?' ch-new':''}" id="chCard-${j.id}" onclick="chOpenJobDetail('${j.id}')">
  ${_chBadgesHTML(j, 3)}
  <div class="ch-job-top">
    <div class="ch-job-org-logo">${_chEsc(j.orgIcon||'💼')}</div>
    <div class="ch-job-info">
      <div class="ch-job-title">${_chEsc(j.title)}</div>
      <div class="ch-job-org">${_chEsc(j.org)}${j.totalPosts?` &nbsp;·&nbsp; ${Number(j.totalPosts).toLocaleString()} Posts`:''}</div>
    </div>
  </div>
  <div class="ch-job-tags">
    <span class="ch-job-tag loc">📍 ${_chEsc(j.location)}</span>
    <span class="ch-job-tag qual">🎓 ${_chEsc(j.qualification)}</span>
    ${j.salary?`<span class="ch-job-tag sal">💰 ${_chEsc(j.salary)}</span>`:''}
    <span class="ch-job-tag date">⏰ ${_chEsc(j.lastDate)}</span>
    ${src}
  </div>
  <div class="ch-job-footer">
    <button class="ch-job-save-btn${saved?' saved':''}" onclick="event.stopPropagation();chToggleSave('${j.id}',this)" title="${saved?'Unsave':'Save'}">${saved?'❤️':'🤍'}</button>
    <button class="ch-job-share-btn" onclick="event.stopPropagation();chShareJob('${j.id}')" title="Share">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    </button>
    <button class="ch-job-apply-btn" onclick="event.stopPropagation();chOpenJobDetail('${j.id}')">View Details →</button>
  </div>
</div>`;
}

function _chEsc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Badge computation (used on cards + detail sheet) ──────────────
// Returns an array of {label, cls} badges based on job flags/category.
function _chComputeBadges(j) {
  const badges = [];
  const cats = (j.category || []).map(c => String(c).toLowerCase());
  const salaryNum = parseInt((j.salary || '0').replace(/[^0-9]/g, ''), 10) || 0;

  if (j.isNew)              badges.push({ label: 'NEW',         cls: 'new' });
  if (j.featured)           badges.push({ label: 'FEATURED',    cls: 'featured' });
  if (j.isTrending)         badges.push({ label: 'TRENDING',    cls: 'trending' });
  if (j.isUrgent)           badges.push({ label: 'URGENT',      cls: 'urgent' });
  if (salaryNum >= 50000)   badges.push({ label: 'HIGH SALARY', cls: 'salary' });
  if (j.jobType === 'government' || cats.includes('govt')) badges.push({ label: 'GOVERNMENT', cls: 'govt' });
  if (j.jobType === 'private'    || cats.includes('private')) badges.push({ label: 'PRIVATE',    cls: 'private' });
  if (cats.includes('scholarship'))  badges.push({ label: 'SCHOLARSHIP', cls: 'scholarship' });
  if (cats.includes('internship'))   badges.push({ label: 'INTERNSHIP',  cls: 'internship' });

  return badges;
}

function _chBadgesHTML(j, max) {
  let badges = _chComputeBadges(j);
  if (max) badges = badges.slice(0, max);
  if (!badges.length) return '';
  return `<div class="ch-badges-row">${badges.map(b => `<span class="ch-badge ch-badge-${b.cls}">${b.label}</span>`).join('')}</div>`;
}

// ── Saved Jobs ───────────────────────────────────────────────────
function chToggleSave(id, btn) {
  const s   = window._chState;
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
  _chUpdateSavedCount();
  if (s.showSavedOnly) chFilterJobs();
  _chSyncSaveToSupabase(id, idx === -1);
}

async function _chSyncSaveToSupabase(jobId, isSaving) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return;
    const uid = session.user.id;
    if (isSaving) {
      await sb.from('career_hub_saved').upsert({ user_id: uid, job_id: jobId }, { onConflict: 'user_id,job_id' });
    } else {
      await sb.from('career_hub_saved').delete().eq('user_id', uid).eq('job_id', jobId);
    }
  } catch (_) {}
}

async function _chLoadSavedFromSupabase() {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await sb.from('career_hub_saved').select('job_id').eq('user_id', session.user.id);
    if (!error && Array.isArray(data)) {
      const merged = Array.from(new Set([...(window._chState.savedJobs || []), ...data.map(r => r.job_id)]));
      window._chState.savedJobs = merged;
      localStorage.setItem('ch_saved_jobs', JSON.stringify(merged));
      _chUpdateSavedCount();
      if (document.getElementById('page-career-hub')?.classList.contains('active')) chFilterJobs();
    }
  } catch (_) {}
}

function _chLoadSavedFromStorage() {
  window._chState.savedJobs = JSON.parse(localStorage.getItem('ch_saved_jobs') || '[]');
}

function _chUpdateSavedCount() {
  const n   = (window._chState.savedJobs || []).length;
  const btn = document.getElementById('chSavedToggleBtn');
  if (!btn) return;
  btn.innerHTML = `${n > 0 ? '❤️' : '🤍'} Saved (<span id="chSavedCount">${n}</span>)`;
  btn.classList.toggle('active', window._chState.showSavedOnly);
}

// ── Share / Detail Sheet ─────────────────────────────────────────
function _chFindJob(id) {
  return (window._chState.jobs || []).find(j => String(j.id) === String(id));
}

function chShareJob(id) {
  const j = _chFindJob(id);
  if (!j) return;
  const text = `💼 ${j.title}\n🏛️ ${j.org}\n📍 ${j.location} | 🎓 ${j.qualification}\n⏰ Last Date: ${j.lastDate}\n\nApply: ${j.applyUrl}\n\nVia Studyria Career Hub`;
  if (navigator.share) {
    navigator.share({ title: j.title, text, url: j.applyUrl }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    if (typeof showToast === 'function') showToast('Job details copied! 📋', 'success');
  }
}

// ── Recently Viewed (for recommendations + engagement) ─────────────
function _chTrackRecentlyViewed(id) {
  try {
    let arr = JSON.parse(localStorage.getItem('ch_recently_viewed') || '[]');
    arr = arr.filter(x => x !== id);
    arr.unshift(id);
    arr = arr.slice(0, 20);
    localStorage.setItem('ch_recently_viewed', JSON.stringify(arr));
  } catch (_) {}
}
function _chGetRecentlyViewed() {
  try { return JSON.parse(localStorage.getItem('ch_recently_viewed') || '[]'); }
  catch (_) { return []; }
}

// ── Recommendation engine ───────────────────────────────────────────
// Scores other jobs by shared category / qualification / location,
// boosts saved-category affinity, excludes the current job.
function _chGetRecommendations(j, limit) {
  const all = (window._chState.jobs || []).filter(x => x.id !== j.id);
  const myCats = new Set((j.category || []).map(c => String(c).toLowerCase()));
  const savedIds = new Set(window._chState.savedJobs || []);

  const scored = all.map(x => {
    let score = 0;
    const xCats = (x.category || []).map(c => String(c).toLowerCase());
    score += xCats.filter(c => myCats.has(c)).length * 3;
    if (x.qualification && j.qualification && x.qualification.toLowerCase() === j.qualification.toLowerCase()) score += 2;
    if (x.location && j.location && x.location.toLowerCase() === j.location.toLowerCase()) score += 1;
    if (savedIds.has(x.id)) score += 1;
    if (x.featured) score += 0.5;
    if (x.isNew) score += 0.5;
    return { job: x, score };
  });

  scored.sort((a, b) => b.score - a.score || (new Date(b.job.publishedAt||0) - new Date(a.job.publishedAt||0)));
  return scored.slice(0, limit || 6).map(s => s.job);
}

// ── Accordion section builder (auto-hides empty sections) ──────────
function _chSection(icon, title, content, open) {
  if (!content) return '';
  const id = 'chSec-' + Math.random().toString(36).slice(2, 9);
  return `
  <div class="ch-detail-accordion${open?' open':''}" id="${id}">
    <button class="ch-detail-accordion-hd" onclick="chToggleAccordion('${id}')">
      <span class="ch-detail-accordion-title"><span>${icon}</span> ${_chEsc(title)}</span>
      <svg class="ch-accordion-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="ch-detail-accordion-body"><div class="ch-detail-accordion-inner">${_chFormatLongText(content)}</div></div>
  </div>`;
}

function chToggleAccordion(id) {
  document.getElementById(id)?.classList.toggle('open');
}

// Preserve line breaks / simple bullet lines from admin-entered text
function _chFormatLongText(t) {
  if (!t) return '';
  return _chEsc(t).split(/\n+/).map(line => line.trim()).filter(Boolean)
    .map(line => /^[-•*]\s?/.test(line)
      ? `<div class="ch-detail-bullet">${line.replace(/^[-•*]\s?/, '')}</div>`
      : `<p>${line}</p>`
    ).join('');
}

// Important Links table — ONLY these 3 may ever send a user outside Studyria.
// Every other field (registration, login, syllabus, admit card, result, the
// original AssamCareer source) is informational/internal only and is never
// rendered as a clickable outbound link.
function _chImportantLinksHTML(j) {
  const rows = [
    ['Apply Online',      '🚀', j.applyUrl && j.applyUrl !== '#' ? j.applyUrl : ''],
    ['Notification PDF',  '📥', j.notificationLink],
    ['Official Website',  '🌐', j.officialWebsite],
  ].filter(([, , url]) => !!url);
  if (!rows.length) return '';
  return `
  <div class="ch-links-table">
    ${rows.map(([label, icon, url]) => `
      <a class="ch-links-row" href="javascript:void(0)" onclick="chGatedExternalLink('${_chEsc(url).replace(/'/g,"\\'")}','${j.id}')">
        <span class="ch-links-label"><span>${icon}</span> ${_chEsc(label)}</span>
        <span class="ch-links-go">Open ↗</span>
      </a>`).join('')}
  </div>`;
}

// ── Quick Overview Cards (Hero summary grid) ───────────────────────
function _chQuickOverviewCardsHTML(j, orgName) {
  const cards = [
    ['🏛️','Organization', orgName || j.location || '—'],
    ['🎓','Qualification', j.qualification || 'Any'],
    ['🎂','Age Limit', j.ageLimit || '—'],
    ['⏰','Last Date', j.lastDate, true],
  ];
  if (j.salary)     cards.push(['💰','Salary', j.salary]);
  if (j.totalPosts) cards.push(['👥','Vacancy Details', Number(j.totalPosts).toLocaleString() + ' Posts']);
  if (j.applicationMode) cards.push(['📝','Mode', j.applicationMode]);

  return `
  <div class="ch-detail-meta-grid">
    ${cards.map(([icon,label,val,danger]) => `
      <div class="ch-detail-meta-item">
        <span class="ch-dm-label">${icon} ${_chEsc(label)}</span>
        <span class="ch-dm-val"${danger?' style="color:var(--danger)"':''}>${_chEsc(val||'—')}</span>
      </div>`).join('')}
  </div>`;
}

// ── Important Dates Timeline ────────────────────────────────────────
// Parses admin-entered "Label: Date" lines (one per line, or auto-split
// from a single comma/semicolon separated block) into a vertical timeline.
function _chImportantDatesTimelineHTML(j) {
  if (!j.importantDates) return '';
  const raw = String(j.importantDates).trim();
  if (!raw) return '';

  const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const items = lines.map(line => {
    const m = line.match(/^(.+?)[:\-–]\s*(.+)$/);
    return m ? { label: m[1].trim(), date: m[2].trim() } : { label: 'Date', date: line };
  });
  if (!items.length) return '';

  return `
  <div class="ch-detail-section-label"><span>📅</span> Important Dates</div>
  <div class="ch-dates-timeline">
    ${items.map((it, i) => `
      <div class="ch-dates-row${i===items.length-1?' last':''}">
        <div class="ch-dates-dot"></div>
        <div class="ch-dates-info">
          <div class="ch-dates-label">${_chEsc(it.label)}</div>
          <div class="ch-dates-value">${_chEsc(it.date)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function chOpenJobDetail(id) {
  const j = _chFindJob(id);
  if (!j) return;

  _chTrackRecentlyViewed(j.id);
  window._chCurrentDetailId = j.id;

  const saved      = (window._chState.savedJobs || []).includes(j.id);
  const applyUrl   = j.applyUrl && j.applyUrl !== '#' ? j.applyUrl : null;
  const orgName    = j.organization || j.org || '';
  const articleWords = (j.articleContent || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const wordCount  = (j.description || '').split(/\s+/).filter(Boolean).length
                    + Object.values({a:j.eligibility,b:j.selectionProcess,c:j.howToApply,d:j.syllabusText}).join(' ').split(/\s+/).filter(Boolean).length
                    + articleWords;
  const readMins   = Math.max(1, Math.round(wordCount / 200));
  const hasStructured = !!(j.vacancyDetails || j.eligibility || j.ageLimit || j.qualificationDetails ||
    j.selectionProcess || j.salaryDetails || j.applicationFee || j.importantDates ||
    j.requiredDocuments || j.examPattern || j.syllabusText || j.howToApply || j.faq);
  const hasArticle = !!(j.articleContent && j.articleContent.trim());

  const recs = _chGetRecommendations(j, 6);

  document.getElementById('chJobSheetContent').innerHTML = `
    <div class="ch-detail-progress"><div class="ch-detail-progress-bar" id="chDetailProgressBar"></div></div>

    <!-- ── Hero Section ── -->
    <div class="ch-detail-header">
      <div class="ch-detail-org-logo">${_chEsc(j.orgIcon||'💼')}</div>
      <div class="ch-detail-head-info">
        <div class="ch-detail-title">${_chEsc(j.title)}</div>
        <div class="ch-detail-org">${_chEsc(orgName)}</div>
      </div>
    </div>

    ${_chBadgesHTML(j)}

    <div class="ch-detail-readtime">📖 ${readMins} min read ${j.viewsCount?`&nbsp;·&nbsp; 👁️ ${Number(j.viewsCount).toLocaleString()} views`:''} &nbsp;·&nbsp; Read fully on Studyria — no redirects</div>

    <!-- Sticky Smart Action Bar -->
    <div class="ch-detail-actionbar">
      <button class="ch-action-btn primary" onclick="chGatedExternalLink('${applyUrl?_chEsc(applyUrl).replace(/'/g,"\\'"):''}','${j.id}')" ${!applyUrl?'disabled':''}>Apply Now →</button>
      <button class="ch-action-btn icon${saved?' active':''}" id="chDetailSaveBtn" onclick="chToggleSave('${j.id}',this);chSyncDetailSaveBtn('${j.id}')" title="Save">${saved?'❤️':'🤍'}</button>
      <button class="ch-action-btn icon" onclick="chShareJob('${j.id}')" title="Share">📤</button>
      <button class="ch-action-btn icon" onclick="chCopyLink('${j.id}')" title="Copy Link">🔗</button>
      ${j.notificationLink ? `<button class="ch-action-btn icon" onclick="chGatedExternalLink('${_chEsc(j.notificationLink).replace(/'/g,"\\'")}','${j.id}')" title="Download Notification">📥</button>` : ''}
      <button class="ch-action-btn icon" onclick="chReportJob('${j.id}')" title="Report Issue">⚑</button>
    </div>

    <!-- ── Quick Overview Cards ── -->
    <div class="ch-detail-section-label" style="padding-top:18px"><span>⚡</span> Job Overview</div>
    ${_chQuickOverviewCardsHTML(j, orgName)}

    <!-- ── Important Dates Timeline ── -->
    ${_chImportantDatesTimelineHTML(j)}

    <!-- ── Important Links (Apply / Notification / Official Website only) ── -->
    ${_chImportantLinksHTML(j) ? `
    <div class="ch-detail-section-label"><span>🔗</span> Important Links</div>
    ${_chImportantLinksHTML(j)}` : ''}

    <!-- ── Quick Summary (structured sections) ── -->
    ${hasStructured ? `
    <div class="ch-detail-section-label"><span>📋</span> Quick Summary</div>
    <div class="ch-detail-sections">
      ${_chSection('📄','Overview', j.description, !hasArticle)}
      ${_chSection('👥','Vacancy Details', j.vacancyDetails)}
      ${_chSection('✅','Eligibility Criteria', j.eligibility)}
      ${_chSection('🎂','Age Limit', j.ageLimit)}
      ${_chSection('🎓','Educational Qualification', j.qualificationDetails)}
      ${_chSection('🧭','Selection Process', j.selectionProcess)}
      ${_chSection('💰','Salary Details', j.salaryDetails)}
      ${_chSection('💳','Application Fee', j.applicationFee)}
      ${_chSection('📑','Required Documents', j.requiredDocuments)}
      ${_chSection('📝','Exam Pattern', j.examPattern)}
      ${_chSection('📘','Syllabus', j.syllabusText)}
      ${_chSection('🚀','How To Apply', j.howToApply)}
      ${_chSection('❓','FAQs', j.faq)}
    </div>` : (!hasArticle ? `
    <div class="ch-detail-sections">
      <div class="ch-detail-overview-card">${_chFormatLongText(j.description) || '<p style="color:var(--text3)">No description available yet.</p>'}</div>
    </div>` : '')}

    <!-- ── Full Article (complete AssamCareer notification, imported in full) ── -->
    ${hasArticle ? `
    <div class="ch-detail-section-label"><span>📰</span> Full Notification</div>
    <div class="ch-article-body">${j.articleContent}</div>
    ` : ''}

    ${recs.length ? `
    <div class="ch-detail-section-label"><span>✨</span> Recommended For You</div>
    <div class="ch-rec-scroll">
      ${recs.map(r => `
        <div class="ch-rec-card" onclick="chOpenJobDetail('${r.id}')">
          ${_chBadgesHTML(r, 1)}
          <div class="ch-rec-org-logo">${_chEsc(r.orgIcon||'💼')}</div>
          <div class="ch-rec-title">${_chEsc(r.title)}</div>
          <div class="ch-rec-meta">📍 ${_chEsc(r.location)} &nbsp;·&nbsp; ⏰ ${_chEsc(r.lastDate)}</div>
        </div>`).join('')}
    </div>` : ''}

    <div style="height:90px"></div>
  `;

  const sheet = document.getElementById('chJobSheet');
  sheet.classList.add('ch-fullscreen');
  sheet.style.display  = 'flex';
  document.body.style.overflow = 'hidden';

  // Reading progress bar tracks scroll within the sheet
  const inner = document.getElementById('chJobSheetInner');
  if (inner) {
    inner.scrollTop = 0;
    inner.onscroll = () => {
      const bar = document.getElementById('chDetailProgressBar');
      if (!bar) return;
      const pct = inner.scrollTop / Math.max(1, inner.scrollHeight - inner.clientHeight);
      bar.style.width = Math.min(100, Math.max(0, pct * 100)) + '%';
    };
  }

  _chIncrementViewCount(j.id);
}

function chSyncDetailSaveBtn(id) {
  const btn = document.getElementById('chDetailSaveBtn');
  if (!btn) return;
  const saved = (window._chState.savedJobs || []).includes(id);
  btn.classList.toggle('active', saved);
  btn.textContent = saved ? '❤️' : '🤍';
}

async function _chIncrementViewCount(jobId) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try { await sb.rpc('increment_job_views', { job_id: jobId }); } catch (_) { /* optional RPC, ignore if missing */ }
}

function chCopyLink(id) {
  const j = _chFindJob(id);
  if (!j) return;
  const url = j.slug
    ? `${location.origin}${location.pathname}#career-hub/job/${j.slug}`
    : (j.applyUrl && j.applyUrl !== '#' ? j.applyUrl : location.href);
  navigator.clipboard?.writeText(url).then(() => {
    if (typeof showToast === 'function') showToast('Link copied! 🔗', 'success');
  }).catch(() => {});
}

function chReportJob(id) {
  const j = _chFindJob(id);
  if (!j) return;
  if (typeof showToast === 'function') showToast('Thanks — we\'ll review this listing. 🙏', 'info');
  const sb = window.supabaseClient;
  if (sb) {
    sb.from('career_hub_reports').insert({ job_id: j.id, reason: 'user_reported' }).then(() => {}).catch(() => {});
  }
}

function chCloseJobSheet(e) {
  if (e && e.target !== document.getElementById('chJobSheet')) return;
  const sheet = document.getElementById('chJobSheet');
  sheet.style.display = 'none';
  sheet.classList.remove('ch-fullscreen');
  document.body.style.overflow = '';
}

// Kept for backward compat (used in older onclick attributes)
function chApplyJob(id) { chOpenJobDetail(id); }

// ── User Retention Engine ("You're Leaving Studyria") ───────────────
// Gates every outbound link (Apply Now, Important Links) behind a
// premium modal that surfaces similar/trending opportunities first.
function chGatedExternalLink(url, jobId) {
  if (!url) return;
  const j = _chFindJob(jobId);
  const recs = j ? _chGetRecommendations(j, 4) : (window._chState.jobs || []).slice(0, 4);

  window._chPendingExternalUrl = url;

  let modal = document.getElementById('chLeavingModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chLeavingModal';
    modal.className = 'ch-leaving-overlay';
    modal.onclick = (e) => { if (e.target === modal) chCloseLeavingModal(); };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="ch-leaving-card">
      <div class="ch-leaving-icon">🚀</div>
      <div class="ch-leaving-title">You're Leaving Studyria</div>
      <div class="ch-leaving-sub">You're about to open an external site to continue your application.</div>

      ${recs.length ? `
      <div class="ch-leaving-recs-label">While you're here — explore more</div>
      <div class="ch-leaving-recs">
        ${recs.map(r => `
          <div class="ch-leaving-rec" onclick="chCloseLeavingModal();chOpenJobDetail('${r.id}')">
            <span class="ch-leaving-rec-icon">${_chEsc(r.orgIcon||'💼')}</span>
            <span class="ch-leaving-rec-title">${_chEsc(r.title)}</span>
          </div>`).join('')}
      </div>` : ''}

      <div class="ch-leaving-actions">
        <button class="ch-leaving-btn ghost" onclick="chCloseLeavingModal()">Explore More Opportunities</button>
        <button class="ch-leaving-btn primary" onclick="chConfirmLeave()">Continue to Apply →</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function chConfirmLeave() {
  const url = window._chPendingExternalUrl;
  chCloseLeavingModal();
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function chCloseLeavingModal() {
  const modal = document.getElementById('chLeavingModal');
  if (modal) modal.style.display = 'none';
  window._chPendingExternalUrl = null;
}

// ── Stats strip ──────────────────────────────────────────────────
function _chUpdateStats() {
  const jobs = window._chState.jobs || [];
  const cnt  = cat => jobs.filter(j => (j.category || []).includes(cat)).length;
  const set  = (id, n, fb) => { const el = document.getElementById(id); if (el) el.textContent = n > 0 ? n.toLocaleString('en-IN') + '+' : fb; };
  set('chStatJobs',    jobs.length,        '0');
  set('chStatGovt',    cnt('govt'),         '0');
  set('chStatScholar', cnt('scholarship'),  '0');
  set('chStatIntern',  cnt('internship'),   '0');
}

// ── Featured Banner (dynamic) ────────────────────────────────────
function _chUpdateFeaturedBanner() {
  const jobs    = window._chState.jobs || [];
  const banner  = document.getElementById('chFeaturedBanner');
  if (!banner) return;

  const featured = jobs.find(j => j.featured) || jobs[0];
  if (!featured) { banner.style.display = 'none'; return; }

  banner.style.display = 'flex';

  const titleEl = document.getElementById('chFeaturedTitle') || banner.querySelector('.ch-featured-title');
  const metaEl  = document.getElementById('chFeaturedMeta')  || banner.querySelector('.ch-featured-meta');
  const applyEl = document.getElementById('chFeaturedApplyBtn') || banner.querySelector('.ch-featured-apply');

  if (titleEl) titleEl.textContent = `${featured.title}${featured.vacancies ? ` — ${Number(featured.vacancies).toLocaleString()} Vacancies` : ''}`;
  if (metaEl)  metaEl.innerHTML    = `📍 ${_chEsc(featured.location)} &nbsp;·&nbsp; 🎓 ${_chEsc(featured.qualification)} &nbsp;·&nbsp; ⏰ Last Date: ${_chEsc(featured.lastDate)}`;
  if (applyEl) applyEl.setAttribute('onclick', `chOpenJobDetail('${featured.id}')`);
}

// ── Auto-init (if Career Hub is the landing page) ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chInit();
});
