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
    applyUrl:      row.apply_url || row.link || '#',
    vacancies:     row.vacancies || null,
    description:   row.description || '',
    source:        row.source || 'manual',
    publishedAt:   row.published_at || row.created_at || null,
    createdAt:     row.created_at || null,
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
<div class="ch-job-card${j.featured?' ch-featured-card':''}${j.isNew?' ch-new':''}" id="chCard-${j.id}">
  <div class="ch-job-top">
    <div class="ch-job-org-logo">${_chEsc(j.orgIcon||'💼')}</div>
    <div class="ch-job-info">
      <div class="ch-job-title">${_chEsc(j.title)}</div>
      <div class="ch-job-org">${_chEsc(j.org)}${j.vacancies?` &nbsp;·&nbsp; ${Number(j.vacancies).toLocaleString()} Posts`:''}</div>
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
    <button class="ch-job-save-btn${saved?' saved':''}" onclick="chToggleSave('${j.id}',this)" title="${saved?'Unsave':'Save'}">${saved?'❤️':'🤍'}</button>
    <button class="ch-job-share-btn" onclick="chShareJob('${j.id}')" title="Share">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    </button>
    <a class="ch-job-apply-btn" href="${_chEsc(j.applyUrl)}" target="_blank" rel="noopener noreferrer">Apply Now →</a>
  </div>
</div>`;
}

function _chEsc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

function chOpenJobDetail(id) {
  const j = _chFindJob(id);
  if (!j) return;
  const saved = (window._chState.savedJobs || []).includes(j.id);
  const applyUrl = j.applyUrl && j.applyUrl !== '#' ? j.applyUrl : null;

  document.getElementById('chJobSheetContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
      <div style="width:52px;height:52px;border-radius:14px;background:var(--surface);border:1px solid var(--glass-border);display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0">${_chEsc(j.orgIcon||'💼')}</div>
      <div>
        <div style="font-family:var(--font-editorial);font-size:1.05rem;font-weight:800;color:var(--text);line-height:1.3">${_chEsc(j.title)}</div>
        <div style="font-size:.8rem;color:var(--text2);margin-top:3px">${_chEsc(j.org)}</div>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px">
      <span class="ch-job-tag loc">📍 ${_chEsc(j.location)}</span>
      <span class="ch-job-tag qual">🎓 ${_chEsc(j.qualification)}</span>
      ${j.salary?`<span class="ch-job-tag sal">💰 ${_chEsc(j.salary)}</span>`:''}
      <span class="ch-job-tag date">⏰ Last Date: ${_chEsc(j.lastDate)}</span>
      ${j.vacancies?`<span class="ch-job-tag" style="color:var(--accent);border-color:rgba(61,142,248,.3);background:rgba(61,142,248,.07)">👥 ${Number(j.vacancies).toLocaleString()} Posts</span>`:''}
      ${j.source&&j.source!=='manual'?`<span class="ch-job-tag" style="font-size:.68rem;opacity:.8">📡 ${_chEsc(j.source)}</span>`:''}
    </div>
    <div style="background:var(--surface);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:14px;margin-bottom:18px;font-size:.85rem;color:var(--text2);line-height:1.7">${_chEsc(j.description)||'No description available.'}</div>
    <div style="display:flex;gap:10px">
      <button onclick="chToggleSave('${j.id}',this);this.textContent=this.textContent.includes('Save')?'❤️ Saved':'🤍 Save'"
        style="flex:1;padding:13px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">${saved?'❤️ Saved':'🤍 Save'}</button>
      <button onclick="chShareJob('${j.id}')"
        style="padding:13px 16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);font-size:.85rem;cursor:pointer;font-family:var(--font-body)">📤</button>
      ${applyUrl
        ? `<a href="${_chEsc(applyUrl)}" target="_blank" rel="noopener noreferrer"
             style="flex:2;padding:13px;border-radius:var(--radius-sm);background:var(--grad-primary);color:#fff;font-size:.9rem;font-weight:800;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-body)">Apply Now →</a>`
        : `<button disabled style="flex:2;padding:13px;border-radius:var(--radius-sm);background:var(--glass);border:1px solid var(--glass-border);color:var(--text3);font-size:.9rem;font-family:var(--font-body)">No Apply Link</button>`
      }
    </div>`;
  document.getElementById('chJobSheet').style.display  = 'flex';
  document.body.style.overflow = 'hidden';
}

function chCloseJobSheet(e) {
  if (e && e.target !== document.getElementById('chJobSheet')) return;
  document.getElementById('chJobSheet').style.display = 'none';
  document.body.style.overflow = '';
}

// Kept for backward compat (used in older onclick attributes)
function chApplyJob(id) { chOpenJobDetail(id); }

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
