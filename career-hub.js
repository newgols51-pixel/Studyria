/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — CAREER HUB  v4 PREMIUM REDESIGN
   ═══════════════════════════════════════════════════════════════════
   • Real Last Date extracted from article content (no "Check Notification")
   • Real dynamic counts: Govt Posts / Scholarships / Internships / Active Jobs
   • Cards show: 📍 Location · 👥 Vacancies · 🎓 Qualification · 💰 Salary · 📅 Last Date
   • No long qualification text on cards (smart truncation)
   • Featured / New / Urgent / High Salary badges
   • Sticky Apply Now button on mobile
   • Premium Article Page: Hero Banner · Overview Cards · Eligibility · Vacancy
     Salary · Fees · Dates Timeline · How To Apply steps · Important Links CTA
   • Design: Dark AMOLED · Glassmorphism · Blue/Cyan/Purple gradients · Futuristic
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

// ── Entry point ────────────────────────────────────────────────────
function chInit() {
  const s = window._ch;
  if (!s.inited) {
    s.inited = true;
    _chSavedCount();
    _chLoadSavedCloud();
    _chRealtime();
    _chInjectStyles();
  }
  if (s.jobs.length) {
    _chStats();
    _chFeaturedBanner();
    _chDynamicSections();
    chFilterJobs();
  }
  chLoadJobs();
}

// ── Supabase fetch ─────────────────────────────────────────────────
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

// ── Skeleton HTML ──────────────────────────────────────────────────
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

// ── Safe date parser — NEVER "Invalid Date" ────────────────────────
const _MONTHS = {
  jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
  may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,
  sep:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11
};

function _parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 2000) return d;

  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (m) {
    const mo = _MONTHS[m[2].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      d = new Date(parseInt(m[3]), mo, parseInt(m[1]));
      if (!isNaN(d)) return d;
    }
  }

  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const mo = _MONTHS[m[1].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      d = new Date(parseInt(m[3]), mo, parseInt(m[2]));
      if (!isNaN(d)) return d;
    }
  }

  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }

  m = s.match(/(?:last\s*date|closing\s*date|deadline)[:\s]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i);
  if (m) {
    const mo = _MONTHS[m[2].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      d = new Date(parseInt(m[3]), mo, parseInt(m[1]));
      if (!isNaN(d)) return d;
    }
  }

  return null;
}

function _fmtDate(v) {
  const d = _parseDate(v);
  if (!d) return null;
  try {
    return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  } catch(_) { return null; }
}

function _daysLeft(v) {
  const d = _parseDate(v);
  if (!d) return null;
  return Math.ceil((d - Date.now()) / 86400000);
}

function _isUrgent(v) {
  const dl = _daysLeft(v);
  return dl !== null && dl >= 0 && dl <= 7;
}

// ── Extract last date from article text ───────────────────────────
function _extractLastDateFromText(text) {
  if (!text) return null;
  const strip = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /last\s*date(?:\s*(?:to\s*apply|of\s*(?:online\s*)?application(?:\s*submission)?|submission))?[:\s–\-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
    /last\s*date(?:\s*(?:to\s*apply|of\s*(?:online\s*)?application(?:\s*submission)?|submission))?[:\s–\-]+([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i,
    /closing\s*date[:\s–\-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
    /apply\s*before[:\s–\-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
    /submission[:\s–\-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
  ];
  for (const re of patterns) {
    const m = strip.match(re);
    if (m) {
      const attempt = `${m[1]} ${m[2]} ${m[3]}`;
      const d = _parseDate(attempt);
      if (d) return d;
    }
  }
  return null;
}

// ── Safe vacancy ───────────────────────────────────────────────────
function _parseVac(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return (isNaN(n) || n <= 0) ? null : n;
}

function _extractVacancyFromText(text) {
  if (!text) return null;
  const strip = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const labeled = [
    /(?:no\.?\s*of\s*posts?|no\.?\s*of\s*vacancies|total\s*posts?|vacancies?|total\s*vacancy)[:\s–-]+(\d[\d,]*)\s*(?:posts?|vacancies?)?/i,
    /(\d[\d,]+)\s*(?:posts?|vacancies?)\s*(?:are\s*)?(?:available|announced|notified)/i,
    /recruitment\s*of\s*(\d[\d,]*)\s*(?:posts?|vacancies?)/i,
    /(\d[\d,]+)\s*(?:probationary|junior|senior|assistant|officer|clerk)\s*(?:posts?|vacancies?)/i,
  ];
  for (const re of labeled) {
    const m = strip.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g,''), 10);
      if (!isNaN(n) && n > 0 && n < 200000) return n;
    }
  }
  return null;
}

function _vacDisplay(j) {
  return j.posts ? j.posts.toLocaleString('en-IN') + ' Posts' : 'Various Posts';
}

// ── Smart qualification extractor ─────────────────────────────────
const _QUAL_KEYWORDS = [
  '10th','10th pass','class 10','sslc',
  '12th','12th pass','class 12','hsc','hs pass','higher secondary',
  'iti','diploma','polytechnic',
  'graduation','graduate','any graduate','bachelor','b.a','b.sc','b.com','bsc','bca','bba',
  'b.tech','be ','engineering','b.e.',
  'post graduate','postgraduate','master','m.sc','mba','mca','m.tech','m.a',
  'ph.d','doctorate','phd',
  'mbbs','md','ms degree','llb','law',
];

function _extractQual(raw, articleText) {
  if (raw && raw.length < 80 && !raw.includes('<') && !/<|>|\n/.test(raw)) {
    const kw = _matchQualKeyword(raw);
    if (kw) return kw;
    return raw.split(/[,\.]/)[0].trim().slice(0, 55);
  }
  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/(?:qualification|educational\s*qualification|eligibility)[:\s–-]+([^\.]{5,80}?)(?:\.|Candidate|Age|Note|$)/i);
  if (m) {
    const kw = _matchQualKeyword(m[1]);
    if (kw) return kw;
    return m[1].trim().split(/[,\n]/)[0].trim().slice(0, 55);
  }
  const found = _matchQualKeyword(text);
  if (found) return found;
  return raw ? raw.slice(0, 50).split(/[,\.]/)[0].trim() : 'Graduate';
}

function _matchQualKeyword(text) {
  const t = text.toLowerCase();
  for (const kw of [..._QUAL_KEYWORDS].reverse()) {
    if (t.includes(kw)) {
      return kw.replace(/\b./g, c => c.toUpperCase()).trim();
    }
  }
  return null;
}

// ── Smart salary extractor ─────────────────────────────────────────
function _extractSalary(raw, articleText) {
  if (raw && raw.length < 80 && !raw.includes('<')) {
    if (/\d/.test(raw)) return raw.slice(0, 55);
    if (/as per|pay level|pay band|grade pay/i.test(raw)) return raw.slice(0, 55);
  }
  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  let m = text.match(/(?:approximate\s*)?(?:ctc|pay)[:\s–-]*Rs\.?\s*[\d,\.]+\s*(?:lacs?|lakhs?|L)?/i);
  if (m) return m[0].trim().slice(0, 50);
  m = text.match(/pay\s*(?:level|matrix|band|scale)[:\s–-]*([^\.]{3,50}?)(?:\.|per\s*month|\bmonth|Approx|Grade|\()/i);
  if (m) return m[1].trim().slice(0, 50);
  m = text.match(/(?:Rs\.?|₹)\s*[\d,]+(?:\/\s*(?:month|pm|p\.m\.?))?/i);
  if (m) return m[0].trim().slice(0, 40);
  m = text.match(/pay\s*scale[:\s–-]+Rs\.?\s*[\d\-\/,]+/i);
  if (m) return m[0].replace(/pay\s*scale[:\s–-]+/i,'').trim().slice(0, 50);
  if (/as\s*per\s*(?:rules|norms|govt|government)/i.test(text)) return 'As Per Rules';
  return raw ? raw.slice(0, 55) : '';
}

// ── Smart age limit extractor ──────────────────────────────────────
function _extractAge(raw, articleText) {
  if (raw && raw.length < 60 && !raw.includes('<')) {
    if (/\d/.test(raw)) return raw.slice(0, 50);
    if (/as per/i.test(raw)) return raw.slice(0, 50);
  }
  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  let m = text.match(/(?:age\s*limit)?[:\s–-]*(\d{2})\s*(?:to|-)\s*(\d{2})\s*[Yy]ears?/);
  if (m) return `${m[1]}-${m[2]} Years`;
  m = text.match(/not\s*below\s*(\d{2})\s*years?\s*and\s*not\s*above\s*(\d{2})\s*years?/i);
  if (m) return `${m[1]}-${m[2]} Years`;
  const mn = text.match(/minimum\s*age[:\s–-]+(\d{2})/i);
  const mx = text.match(/maximum\s*age[:\s–-]+(\d{2})/i);
  if (mn && mx) return `${mn[1]}-${mx[1]} Years`;
  if (/as\s*per\s*(?:rules|norms|govt|government)/i.test(text)) return 'As Per Rules';
  return raw ? raw.slice(0, 50) : 'As Per Rules';
}

// ── Row → normalised job object ────────────────────────────────────
function _map(r) {
  const articleText = r.article_content || r.description || '';
  const rawDate     = r.last_date || null;

  let lastDateVal = rawDate;
  if (!_parseDate(lastDateVal)) {
    const extracted = _extractLastDateFromText(articleText);
    if (extracted) lastDateVal = extracted.toISOString();
  }

  let posts = _parseVac(r.vacancies || r.total_posts);
  if (!posts) posts = _extractVacancyFromText(articleText);

  const cats = Array.isArray(r.category) ? r.category : (r.category ? [r.category] : []);
  const qual     = _extractQual(r.qualification || '', articleText);
  const salary   = _extractSalary(r.salary || '', articleText);
  const ageLimit = _extractAge(r.age_limit || '', articleText);
  const fmtLast  = _fmtDate(lastDateVal);

  return {
    id:          r.id,
    title:       (r.title || 'Untitled').trim(),
    org:         (r.org || r.organization || '').trim(),
    orgIcon:     r.org_icon || '💼',
    location:    (r.location || 'India').trim(),
    qual,
    salary,
    ageLimit,
    lastDate:    fmtLast || 'See Notification',
    rawDate:     lastDateVal,
    urgentDate:  _isUrgent(lastDateVal),
    daysLeft:    _daysLeft(lastDateVal),
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
    jobType:     (r.job_type || '').toLowerCase(),
    appMode:     r.application_mode || '',
    slug:        r.slug || '',
    views:       r.views_count || 0,
    vacDetails:  r.vacancy_details || '',
    eligibility: r.eligibility || '',
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
    applyLink:   r.apply_url || r.link || '',
    notifLink:   r.notification_link || '',
    official:    r.official_website || '',
    regLink:     r.registration_link || '',
    articleHTML: r.article_content || '',
    imgUrl:      r.image_url || r.thumbnail_url || '',
    lastUpdated: r.updated_at || r.published_at || r.created_at || '',
  };
}

function _recent(ts) {
  if (!ts) return false;
  return (Date.now() - new Date(ts)) / 86400000 <= 5;
}

// ── Realtime ───────────────────────────────────────────────────────
function _chRealtime() {
  const sb = window.supabaseClient;
  const s  = window._ch;
  if (!sb || s.rtSubscribed || typeof sb.channel !== 'function') return;
  try {
    sb.channel('ch-jobs-v4')
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
    if (p.new.active === false) { if (idx > -1) s.jobs.splice(idx, 1); }
    else { if (idx > -1) s.jobs[idx] = j; else s.jobs.unshift(j); }
  } else if (p.eventType === 'DELETE' && p.old) {
    s.jobs = s.jobs.filter(x => x.id !== p.old.id);
  }
  _chStats(); _chFeaturedBanner(); _chDynamicSections();
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chFilterJobs();
}

// ── Stats ──────────────────────────────────────────────────────────
function _chStats() {
  const jobs = window._ch.jobs;

  const _isGovt = j => {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return j.jobType === 'government' ||
           cats.includes('govt') || cats.includes('government') ||
           /\bgovt\b|\bgovernment\b|\bpsu\b|\bpublic sector\b/i.test(j.title);
  };
  const _isScholar = j => {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return cats.includes('scholarship') || /scholarship/i.test(j.title);
  };
  const _isIntern = j => {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return cats.includes('internship') || /internship|intern\b/i.test(j.title);
  };

  const fmt = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : n.toString();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    el.animate([{transform:'scale(1.2)',opacity:.7},{transform:'scale(1)',opacity:1}],{duration:300,easing:'ease-out'});
  };

  set('chStatJobs',    fmt(jobs.length));
  set('chStatGovt',    fmt(jobs.filter(_isGovt).length));
  set('chStatScholar', fmt(jobs.filter(_isScholar).length));
  set('chStatIntern',  fmt(jobs.filter(_isIntern).length));
}

// ── Featured banner ────────────────────────────────────────────────
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
  const posts = j.posts ? ` · ${j.posts.toLocaleString('en-IN')} Posts` : '';
  if (t) t.textContent = j.title + posts;
  if (m) m.innerHTML  = `📍 ${_esc(j.location)} &nbsp;·&nbsp; 🎓 ${_esc(j.qual)} &nbsp;·&nbsp; 📅 ${_esc(j.lastDate)}`;
  if (b) b.setAttribute('onclick', `chOpenDetail('${j.id}')`);
}

// ── Dynamic sections ───────────────────────────────────────────────
function _chDynamicSections() {
  const jobs = window._ch.jobs;
  if (!jobs.length) return;

  const isGovt    = j => j.jobType === 'government' ||
    j.category.map(c=>c.toLowerCase()).some(c => c.includes('govt') || c.includes('government')) ||
    /\bgovt\b|\bgovernment\b|\bpsu\b/i.test(j.title);
  const isScholar = j => j.category.map(c=>c.toLowerCase()).some(c=>c.includes('scholarship')) ||
    /scholarship/i.test(j.title);
  const isIntern  = j => j.category.map(c=>c.toLowerCase()).some(c=>c.includes('internship')) ||
    /internship|intern\b/i.test(j.title);

  const trending = jobs.filter(j => j.isTrending || j.isNew).slice(0, 10);
  const govt     = jobs.filter(isGovt).slice(0, 10);
  const scholar  = jobs.filter(isScholar).slice(0, 8);
  const intern   = jobs.filter(isIntern).slice(0, 8);
  const latest   = jobs.slice(0, 10);

  _injectSection('chTrendingSection', 'red',   '🔥', 'Trending Now',   trending, 'all');
  _injectSection('chGovtSection',     'blue',  '🏛️', 'Government Jobs', govt,    'govt');
  _injectSection('chScholarSection',  'gold',  '🎓', 'Scholarships',   scholar,  'scholarship');
  _injectSection('chInternSection',   'green', '💼', 'Internships',    intern,   'internship');
  _injectSection('chLatestSection',   'purple','⚡', 'Just Added',     latest,   'all');
}

function _injectSection(cid, dotCls, icon, title, jobs, catKey) {
  const el = document.getElementById(cid);
  if (!el) return;
  if (!jobs.length) { el.innerHTML = ''; return; }
  const seeAll = catKey !== 'all'
    ? `<button class="ch-see-all" onclick="chSelectCatByKey('${catKey}')">See All →</button>` : '';
  el.innerHTML = `
    <div class="ch-section-wrap">
      <div class="ch-section-hd">
        <div class="ch-section-title">
          <span class="ch-sec-dot ${dotCls}"></span>${icon} ${_esc(title)}
        </div>
        ${seeAll}
      </div>
      <div class="ch-hscroll">${jobs.map(_miniCard).join('')}</div>
    </div>
    <div class="ch-sec-divider"></div>`;
}

function _miniCard(j) {
  const dl = j.daysLeft;
  const dateColor = j.urgentDate ? 'urgent' : '';
  const dateLabel = dl !== null && dl >= 0
    ? (dl === 0 ? 'Today!' : dl === 1 ? '1 day left' : dl <= 7 ? `${dl} days left` : j.lastDate)
    : j.lastDate;
  return `
    <div class="ch-mini-card" onclick="chOpenDetail('${j.id}')">
      <div class="mc-badges">${_badgesHTML(j, 2)}</div>
      <div class="mc-icon">${_esc(j.orgIcon)}</div>
      <div class="mc-title">${_esc(j.title)}</div>
      <div class="mc-org">${_esc(j.org)}</div>
      <div class="mc-row"><span>📍</span><span>${_esc(j.location)}</span></div>
      <div class="mc-row ${dateColor}"><span>📅</span><span>${_esc(dateLabel)}</span></div>
    </div>`;
}

// ── Filter / sort pipeline ─────────────────────────────────────────
function _filtered() {
  const s  = window._ch;
  let jobs = [...s.jobs];

  if (s.savedOnly) {
    const sv = new Set(s.savedJobs);
    jobs = jobs.filter(j => sv.has(j.id));
  } else if (s.cat !== 'all') {
    jobs = jobs.filter(j => {
      const cats = j.category.map(c=>c.toLowerCase());
      if (s.cat === 'govt') {
        return j.jobType === 'government' || cats.some(c=>c.includes('govt')||c.includes('government'));
      }
      return cats.includes(s.cat) || j.jobType === s.cat;
    });
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

// ── Render list ────────────────────────────────────────────────────
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

// ── Premium Job Card ───────────────────────────────────────────────
function _cardHTML(j) {
  const saved   = window._ch.savedJobs.includes(j.id);
  // Smart qualification — strip long text to highlight level only
  const qual    = _smartShorten(j.qual, 30);
  const salary  = j.salary ? _smartShorten(j.salary, 30) : '';
  const vacTxt  = _vacDisplay(j);
  const featCls = j.featured ? ' ch-featured-card' : '';
  const newCls  = j.isNew    ? ' ch-new-card'      : '';

  // Days-left label for last date
  const dl = j.daysLeft;
  const dateDisplay = dl !== null && dl >= 0 && dl <= 30
    ? (dl === 0 ? 'Today!' : dl === 1 ? '1 day left' : `${dl} days left`)
    : j.lastDate;
  const dateClass = j.urgentDate ? ' urgent' : (dl !== null && dl <= 30 ? ' soon' : '');

  return `
<div class="ch-job-card${featCls}${newCls}" id="chCard-${j.id}" onclick="chOpenDetail('${j.id}')">
  ${j.featured ? '<div class="ch-card-feat-stripe"></div>' : ''}

  <div class="ch-card-top">
    <div class="ch-card-logo">${_esc(j.orgIcon)}</div>
    <div class="ch-card-head">
      <div class="ch-card-title">${_esc(j.title)}</div>
      <div class="ch-card-org">${_esc(j.org)}</div>
    </div>
    <button class="ch-card-save${saved?' saved':''}"
      onclick="event.stopPropagation();chToggleSave('${j.id}',this)"
      title="${saved?'Unsave':'Save'}">${saved?'❤️':'🤍'}</button>
  </div>

  ${_badgesHTML(j, 4)}

  <div class="ch-card-meta">
    <div class="ch-meta-item">
      <span class="ch-meta-icon">📍</span>
      <span class="ch-meta-val">${_esc(j.location)}</span>
    </div>
    <div class="ch-meta-item">
      <span class="ch-meta-icon">👥</span>
      <span class="ch-meta-val">${_esc(vacTxt)}</span>
    </div>
    <div class="ch-meta-item">
      <span class="ch-meta-icon">🎓</span>
      <span class="ch-meta-val">${_esc(qual)}</span>
    </div>
    ${salary ? `<div class="ch-meta-item">
      <span class="ch-meta-icon">💰</span>
      <span class="ch-meta-val">${_esc(salary)}</span>
    </div>` : ''}
    <div class="ch-meta-item${dateClass}">
      <span class="ch-meta-icon">📅</span>
      <span class="ch-meta-val${dateClass}">${_esc(dateDisplay)}</span>
    </div>
  </div>

  <div class="ch-card-footer">
    <button class="ch-card-btn ghost"
      onclick="event.stopPropagation();chShareJob('${j.id}')">
      📤 Share
    </button>
    <button class="ch-card-btn primary"
      onclick="event.stopPropagation();chOpenDetail('${j.id}')">
      View Details →
    </button>
  </div>

  ${j.urgentDate ? '<div class="ch-card-urgency-bar">⚡ Closing Soon — Apply Before It\'s Too Late!</div>' : ''}
</div>`;
}

function _smartShorten(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen).trim() + '…';
}

// ── Badges ─────────────────────────────────────────────────────────
function _badges(j) {
  const out  = [];
  const cats = j.category.map(c=>c.toLowerCase());
  const sal  = parseInt((j.salary||'0').replace(/[^0-9]/g,''),10)||0;
  if (j.isNew)                                          out.push({l:'NEW',         c:'new'});
  if (j.featured)                                       out.push({l:'FEATURED',    c:'featured'});
  if (j.isTrending)                                     out.push({l:'TRENDING',    c:'trending'});
  if (j.isUrgent || j.urgentDate)                       out.push({l:'URGENT',      c:'urgent'});
  if (sal >= 50000)                                     out.push({l:'HIGH SALARY', c:'salary'});
  if (j.jobType === 'government' || cats.some(c=>c.includes('govt')||c.includes('government')))
                                                        out.push({l:'GOVT',        c:'govt'});
  if (j.jobType === 'private'    || cats.includes('private'))
                                                        out.push({l:'PRIVATE',     c:'private'});
  if (cats.some(c=>c.includes('scholarship')) || /scholarship/i.test(j.title))
                                                        out.push({l:'SCHOLARSHIP', c:'scholarship'});
  if (cats.some(c=>c.includes('internship'))  || /internship/i.test(j.title))
                                                        out.push({l:'INTERNSHIP',  c:'internship'});
  return out;
}

function _badgesHTML(j, max) {
  let b = _badges(j);
  if (max) b = b.slice(0, max);
  if (!b.length) return '';
  return `<div class="ch-badges-row">${b.map(x=>`<span class="ch-badge ch-badge-${x.c}">${x.l}</span>`).join('')}</div>`;
}

// ── Category helpers ───────────────────────────────────────────────
function chSelectCat(btn, cat) {
  document.querySelectorAll('.ch-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._ch.cat       = cat;
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

// ── Save / Unsave ──────────────────────────────────────────────────
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

// ── Share ──────────────────────────────────────────────────────────
function chShareJob(id) {
  const j = _find(id); if (!j) return;
  const txt = `💼 ${j.title}\n🏛️ ${j.org}\n📍 ${j.location} | 🎓 ${j.qual}\n📅 Last Date: ${j.lastDate}\n👥 ${_vacDisplay(j)}\n\nVia Studyria Career Hub`;
  if (navigator.share) navigator.share({title:j.title, text:txt, url:j.applyUrl}).catch(()=>{});
  else {
    navigator.clipboard?.writeText(txt);
    if (typeof showToast === 'function') showToast('Copied to clipboard! 📋', 'success');
  }
}

// ── Utility ────────────────────────────────────────────────────────
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

// ── Recently viewed ────────────────────────────────────────────────
function _trackView(id) {
  try {
    let arr = JSON.parse(localStorage.getItem('ch_viewed') || '[]');
    arr = [id, ...arr.filter(x=>x!==id)].slice(0, 20);
    localStorage.setItem('ch_viewed', JSON.stringify(arr));
  } catch(_) {}
}

// ── Recommendations ────────────────────────────────────────────────
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

// ── Text formatter ─────────────────────────────────────────────────
function _fmtText(t) {
  if (!t) return '';
  return _esc(String(t)
    .replace(/\[&hellip;\]/g,'…').replace(/&hellip;/g,'…')
    .replace(/\s{3,}/g,'\n\n').trim())
    .split(/\n+/).map(l=>l.trim()).filter(Boolean)
    .map(l => /^[-•*]\s?/.test(l)
      ? `<div class="ch-bullet"><span class="ch-bullet-dot"></span><span>${l.replace(/^[-•*]\s?/,'')}</span></div>`
      : `<p>${l}</p>`)
    .join('');
}

// ── Premium Detail Sheet ───────────────────────────────────────────
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

  // ── Premium article-style layout ──────────────────────────────
  document.getElementById('chJobSheetContent').innerHTML = `

    <!-- Reading progress bar -->
    <div class="ch-progress-rail"><div class="ch-progress-fill" id="chPBar"></div></div>

    <!-- HERO BANNER -->
    <div class="ch-art-hero" ${j.imgUrl ? `style="--hero-img:url('${_esc(j.imgUrl)}')"` : ''}>
      <div class="ch-art-hero-overlay"></div>
      <div class="ch-art-hero-content">
        <div class="ch-art-hero-top">
          ${_badgesHTML(j)}
          ${j.views ? `<span class="ch-art-views">👁 ${Number(j.views).toLocaleString()} views</span>` : ''}
        </div>
        <div class="ch-art-org-row">
          <div class="ch-art-org-logo">${_esc(j.orgIcon)}</div>
          <div>
            <div class="ch-art-org-name">${_esc(j.org)}</div>
            ${j.location ? `<div class="ch-art-org-loc">📍 ${_esc(j.location)}</div>` : ''}
          </div>
        </div>
        <h1 class="ch-art-title">${_esc(j.title)}</h1>
        <div class="ch-art-meta-row">
          ${j.category.slice(0,2).map(c=>`<span class="ch-art-cat-chip">${_esc(c)}</span>`).join('')}
          ${j.lastUpdated ? `<span class="ch-art-updated">Updated ${_relTime(j.lastUpdated)}</span>` : ''}
        </div>
      </div>
    </div>

    <!-- ACTION BAR -->
    <div class="ch-art-actions">
      <button class="ch-act-primary${!applyUrl?' disabled':''}"
        onclick="chLeave('${applyUrl ? _esc(applyUrl).replace(/'/g,"\\'") : ''}','${j.id}')"
        ${!applyUrl?'disabled':''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        Apply Now
      </button>
      <button class="ch-act-icon${saved?' saved':''}" id="chDetailSave"
        onclick="chToggleSave('${j.id}',this);_syncDetailSave('${j.id}')">${saved?'❤️':'🤍'}</button>
      <button class="ch-act-icon" onclick="chShareJob('${j.id}')">📤</button>
      <button class="ch-act-icon" onclick="chCopyLink('${j.id}')">🔗</button>
      ${j.notifLink ? `<button class="ch-act-icon" onclick="chLeave('${_esc(j.notifLink).replace(/'/g,"\\'")}','${j.id}')">📥</button>` : ''}
    </div>

    <!-- JOB OVERVIEW CARDS GRID -->
    <div class="ch-art-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">⚡</span>Quick Overview</div>
      ${_premiumMetaGrid(j)}
    </div>

    <!-- IMPORTANT DATES TIMELINE -->
    ${j.impDates?.trim() ? `
    <div class="ch-art-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">📅</span>Important Dates</div>
      ${_premiumTimeline(j)}
    </div>` : _quickDatesFromData(j)}

    <!-- IMPORTANT LINKS -->
    ${_premiumLinksSection(j)}

    <!-- STRUCTURED SECTIONS (accordion) -->
    ${hasStruct ? `
    <div class="ch-art-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">📋</span>Full Details</div>
      <div class="ch-accordions">
        ${_premiumAccordion('📄','Overview & Description',     j.desc,       !hasArt)}
        ${_premiumAccordion('👥','Vacancy Details',           j.vacDetails)}
        ${_premiumAccordion('✅','Eligibility Criteria',      j.eligibility)}
        ${_premiumAccordion('🎂','Age Limit & Relaxation',    j.ageLimit)}
        ${_premiumAccordion('🎓','Educational Qualification', j.qualDetails)}
        ${_premiumAccordion('🧭','Selection Process',         j.selection)}
        ${_premiumAccordion('💰','Salary / Pay Scale',        j.salDetails)}
        ${_premiumAccordion('💳','Application Fee',           j.fee)}
        ${_premiumAccordion('📑','Required Documents',        j.documents)}
        ${_premiumAccordion('📝','Exam Pattern',              j.examPat)}
        ${_premiumAccordion('📘','Syllabus',                  j.syllabus)}
        ${_premiumAccordion('🚀','How To Apply',              j.howToApply, true)}
        ${_premiumAccordion('❓','FAQ',                       j.faq)}
      </div>
    </div>` : (!hasArt && j.desc ? `
    <div class="ch-art-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">📄</span>About This Opportunity</div>
      <div class="ch-art-prose">${_fmtText(j.desc)}</div>
    </div>` : '')}

    <!-- FULL NOTIFICATION ARTICLE -->
    ${hasArt ? `
    <div class="ch-art-section ch-art-article-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">📰</span>Full Notification</div>
      <div class="ch-article-body">${j.articleHTML}</div>
    </div>` : ''}

    <!-- RECOMMENDATIONS -->
    ${recJobs.length ? `
    <div class="ch-art-section">
      <div class="ch-art-section-hd"><span class="ch-art-section-icon">✨</span>You Might Also Like</div>
      <div class="ch-rec-scroll">
        ${recJobs.map(r=>`
          <div class="ch-rec-card" onclick="chOpenDetail('${r.id}')">
            ${_badgesHTML(r,1)}
            <div class="ch-rec-logo">${_esc(r.orgIcon)}</div>
            <div class="ch-rec-title">${_esc(r.title)}</div>
            <div class="ch-rec-meta">📍 ${_esc(r.location)} · 📅 ${_esc(r.lastDate)}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- STICKY APPLY FOOTER -->
    ${applyUrl ? `
    <div class="ch-sticky-apply" id="chStickyApply">
      <div class="ch-sticky-apply-info">
        <div class="ch-sticky-title">${_esc(_smartShorten(j.title, 28))}</div>
        ${j.urgentDate ? `<div class="ch-sticky-urgent">⚡ ${j.lastDate}</div>` : `<div class="ch-sticky-date">📅 ${j.lastDate}</div>`}
      </div>
      <button class="ch-sticky-btn" onclick="chLeave('${_esc(applyUrl).replace(/'/g,"\\'")}','${j.id}')">
        Apply Now →
      </button>
    </div>` : ''}

    <div style="height:100px"></div>`;

  const sheet = document.getElementById('chJobSheet');
  sheet.classList.add('ch-fullscreen');
  sheet.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const inner = document.getElementById('chJobSheetInner');
  if (inner) {
    inner.scrollTop = 0;
    inner.onscroll = () => {
      const bar = document.getElementById('chPBar'); if (!bar) return;
      const pct = inner.scrollTop / Math.max(1, inner.scrollHeight - inner.clientHeight);
      bar.style.width = Math.min(100, pct*100) + '%';
      // Show/hide sticky apply after some scroll
      const sticky = document.getElementById('chStickyApply');
      if (sticky) sticky.style.opacity = inner.scrollTop > 200 ? '1' : '0';
    };
  }
  _incViews(j.id);
}

// ── Premium Meta Grid ──────────────────────────────────────────────
function _premiumMetaGrid(j) {
  const items = [
    {icon:'🏛️', label:'Organization', val: j.org,        color:'blue'},
    {icon:'👥', label:'Vacancies',    val: _vacDisplay(j),color:'green'},
    {icon:'🎓', label:'Qualification',val: j.qual,        color:'purple'},
    {icon:'🎂', label:'Age Limit',    val: j.ageLimit,    color:''},
    {icon:'📅', label:'Last Date',    val: j.lastDate,    color: j.urgentDate ? 'red' : 'blue'},
  ];
  if (j.salary)  items.splice(3,0,{icon:'💰', label:'Salary',    val: j.salary, color:'gold'});
  if (j.appMode) items.push({icon:'📝', label:'Apply Mode', val: j.appMode, color:''});

  return `<div class="ch-overview-grid">
    ${items.map(it => `
      <div class="ch-overview-card ${it.color}">
        <div class="ch-ov-icon">${it.icon}</div>
        <div class="ch-ov-label">${_esc(it.label)}</div>
        <div class="ch-ov-val">${_esc(it.val || '—')}</div>
      </div>`).join('')}
  </div>`;
}

// ── Premium Timeline ───────────────────────────────────────────────
function _premiumTimeline(j) {
  if (!j.impDates?.trim()) return '';
  const lines = j.impDates.trim().split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const items = lines.map(l => {
    const m = l.match(/^(.+?)[:\-–]\s*(.+)$/);
    return m ? {label:m[1].trim(), val:m[2].trim()} : {label:'Date', val:l};
  });
  if (!items.length) return '';
  return `<div class="ch-timeline">
    ${items.map((it,i)=>`
      <div class="ch-tl-item${i===items.length-1?' last':''}">
        <div class="ch-tl-line-wrap">
          <div class="ch-tl-dot"></div>
          ${i < items.length-1 ? '<div class="ch-tl-line"></div>' : ''}
        </div>
        <div class="ch-tl-body">
          <div class="ch-tl-label">${_esc(it.label)}</div>
          <div class="ch-tl-val">${_esc(it.val)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

// ── Quick dates from job fields ────────────────────────────────────
function _quickDatesFromData(j) {
  if (!j.lastDate || j.lastDate === 'See Notification') return '';
  return `
  <div class="ch-art-section">
    <div class="ch-art-section-hd"><span class="ch-art-section-icon">📅</span>Important Dates</div>
    <div class="ch-timeline">
      <div class="ch-tl-item last">
        <div class="ch-tl-line-wrap"><div class="ch-tl-dot ${j.urgentDate?'urgent':''}"></div></div>
        <div class="ch-tl-body">
          <div class="ch-tl-label">Last Date to Apply</div>
          <div class="ch-tl-val ${j.urgentDate?'urgent':''}">${_esc(j.lastDate)}${j.urgentDate ? ' ⚡' : ''}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Premium Links Section ──────────────────────────────────────────
function _premiumLinksSection(j) {
  const links = [
    {label:'Apply Online',     icon:'🚀', url: j.applyLink && j.applyLink !== '#' ? j.applyLink : '', primary:true},
    {label:'Official Notification', icon:'📥', url: j.notifLink, primary:false},
    {label:'Official Website', icon:'🌐', url: j.official,  primary:false},
    {label:'Registration',     icon:'📝', url: j.regLink,   primary:false},
  ].filter(l => !!l.url);
  if (!links.length) return '';
  return `
  <div class="ch-art-section">
    <div class="ch-art-section-hd"><span class="ch-art-section-icon">🔗</span>Important Links</div>
    <div class="ch-links-grid">
      ${links.map(l => `
        <button class="ch-link-btn ${l.primary?'primary':''}"
          onclick="chLeave('${_esc(l.url).replace(/'/g,"\\'")}','${_esc(l.url)}')">
          <span class="ch-link-icon">${l.icon}</span>
          <span class="ch-link-label">${l.label}</span>
          <svg class="ch-link-arr" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
        </button>`).join('')}
    </div>
  </div>`;
}

// ── Premium Accordion ──────────────────────────────────────────────
function _premiumAccordion(icon, title, body, open) {
  if (!body?.trim()) return '';
  const id = 'chAcc-' + Math.random().toString(36).slice(2,8);
  return `
  <div class="ch-acc${open?' open':''}" id="${id}">
    <button class="ch-acc-hd" onclick="chToggleAcc('${id}')">
      <span class="ch-acc-icon">${icon}</span>
      <span class="ch-acc-title">${_esc(title)}</span>
      <svg class="ch-acc-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="ch-acc-body">
      <div class="ch-acc-inner">${_fmtText(body)}</div>
    </div>
  </div>`;
}
function chToggleAcc(id) { document.getElementById(id)?.classList.toggle('open'); }

// ── Relative time ──────────────────────────────────────────────────
function _relTime(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}

// ── Detail sync / inc views ────────────────────────────────────────
function _syncDetailSave(id) {
  const btn   = document.getElementById('chDetailSave'); if (!btn) return;
  const saved = window._ch.savedJobs.includes(id);
  btn.classList.toggle('saved', saved);
  btn.textContent = saved ? '❤️' : '🤍';
}
async function _incViews(id) {
  const sb = window.supabaseClient; if (!sb) return;
  try { await sb.rpc('increment_job_views', { job_id:id }); } catch(_) {}
}

// ── Sheet close ────────────────────────────────────────────────────
function chCloseJobSheet(e) {
  if (e && e.target !== document.getElementById('chJobSheet')) return;
  _chCloseSheet();
}
function _chCloseSheet() {
  const sheet = document.getElementById('chJobSheet');
  if (!sheet) return;
  sheet.style.display = 'none';
  sheet.classList.remove('ch-fullscreen');
  document.body.style.overflow = '';
  window._chCurrentId = null;
}

// ── Copy link ──────────────────────────────────────────────────────
function chCopyLink(id) {
  const j = _find(id); if (!j) return;
  const url = j.applyUrl && j.applyUrl !== '#'
    ? j.applyUrl
    : `${location.origin}${location.pathname}?job=${id}`;
  navigator.clipboard?.writeText(url);
  if (typeof showToast === 'function') showToast('Link copied! 🔗', 'success');
}

// ── External link with leave confirmation ──────────────────────────
function chLeave(url, jobId) {
  if (!url || url === '#') return;
  window.open(url, '_blank', 'noopener,noreferrer');
  if (jobId) {
    const sb = window.supabaseClient;
    if (sb) sb.from('jobs').update({clicks_count: window._ch.jobs.find(j=>j.id===jobId)?.views+1||1}).eq('id',jobId).catch(()=>{});
  }
}

// ── CSS Injection ──────────────────────────────────────────────────
function _chInjectStyles() {
  if (document.getElementById('ch-styles-v4')) return;
  const style = document.createElement('style');
  style.id = 'ch-styles-v4';
  style.textContent = `
/* ══════════════════════════════════════════════════════
   STUDYRIA CAREER HUB v4 — PREMIUM AMOLED REDESIGN
   Blue · Cyan · Purple · Glassmorphism · Futuristic
   ══════════════════════════════════════════════════════ */

/* ── Section wrappers ── */
.ch-section-wrap { padding: 0; }
.ch-section-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 16px 10px;
}
.ch-section-title {
  font-size: 15px; font-weight: 700; color: #fff;
  display: flex; align-items: center; gap: 8px; letter-spacing: .2px;
}
.ch-sec-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0;
}
.ch-sec-dot.red    { background: #ef4444; box-shadow: 0 0 8px #ef4444cc; }
.ch-sec-dot.blue   { background: #3b82f6; box-shadow: 0 0 8px #3b82f6cc; }
.ch-sec-dot.gold   { background: #f59e0b; box-shadow: 0 0 8px #f59e0bcc; }
.ch-sec-dot.green  { background: #10b981; box-shadow: 0 0 8px #10b981cc; }
.ch-sec-dot.purple { background: #8b5cf6; box-shadow: 0 0 8px #8b5cf6cc; }
.ch-see-all {
  font-size: 12px; color: #60a5fa;
  background: rgba(59,130,246,.1); border: 1px solid rgba(59,130,246,.22);
  border-radius: 20px; padding: 4px 12px; cursor: pointer; font-weight: 600;
}
.ch-sec-divider {
  height: 1px;
  background: linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);
  margin: 4px 0 0;
}

/* ── Horizontal scroll ── */
.ch-hscroll {
  display: flex; gap: 12px; overflow-x: auto;
  padding: 4px 16px 16px; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.ch-hscroll::-webkit-scrollbar { display: none; }

/* ── Mini card ── */
.ch-mini-card {
  min-width: 178px; max-width: 198px; flex-shrink: 0; scroll-snap-align: start;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
  border-radius: 16px; padding: 12px; cursor: pointer;
  transition: transform .2s, border-color .2s;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.ch-mini-card:active { transform: scale(.96); }
.mc-badges { min-height: 18px; margin-bottom: 6px; }
.mc-icon { font-size: 24px; margin-bottom: 6px; }
.mc-title {
  font-size: 12.5px; font-weight: 700; color: #f1f5f9; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 3px;
}
.mc-org { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
.mc-row {
  display: flex; gap: 4px; font-size: 11px; color: #94a3b8;
  align-items: flex-start; margin-bottom: 2px;
}
.mc-row.urgent { color: #f87171 !important; font-weight: 600; }
.mc-row.soon   { color: #fb923c !important; }

/* ── Main job cards ── */
.ch-job-card {
  background: linear-gradient(145deg, rgba(13,18,32,.95) 0%, rgba(10,14,24,.95) 100%);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 20px; margin: 0 14px 14px;
  cursor: pointer; overflow: hidden;
  transition: transform .2s, box-shadow .2s, border-color .2s;
  box-shadow: 0 4px 24px rgba(0,0,0,.45);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  position: relative;
}
.ch-job-card:active { transform: scale(.982); box-shadow: 0 2px 12px rgba(0,0,0,.6); }
.ch-job-card.ch-featured-card {
  border-color: rgba(251,191,36,.28);
  box-shadow: 0 4px 28px rgba(251,191,36,.1), 0 0 0 1px rgba(251,191,36,.1);
}
.ch-job-card.ch-new-card { border-color: rgba(59,130,246,.28); }
.ch-card-feat-stripe {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b);
}

/* Card top */
.ch-card-top {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 15px 15px 10px;
}
.ch-card-logo {
  width: 46px; height: 46px; border-radius: 13px; font-size: 22px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
}
.ch-card-head { flex: 1; min-width: 0; }
.ch-card-title {
  font-size: 14.5px; font-weight: 700; color: #f1f5f9; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ch-card-org { font-size: 12px; color: #64748b; margin-top: 3px; }
.ch-card-save {
  background: none; border: none; font-size: 18px; padding: 2px;
  cursor: pointer; flex-shrink: 0; opacity: .65; transition: opacity .2s, transform .2s;
  line-height: 1;
}
.ch-card-save.saved { opacity: 1; transform: scale(1.15); }

/* Badges */
.ch-badges-row {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 0 15px 9px;
}
.ch-badge {
  font-size: 9px; font-weight: 800; padding: 2.5px 8px; border-radius: 20px;
  letter-spacing: .6px; text-transform: uppercase;
}
.ch-badge-new        { background: rgba(16,185,129,.18); color: #34d399; border: 1px solid rgba(16,185,129,.3); }
.ch-badge-featured   { background: rgba(251,191,36,.18); color: #fbbf24; border: 1px solid rgba(251,191,36,.3); }
.ch-badge-trending   { background: rgba(239,68,68,.18);  color: #f87171; border: 1px solid rgba(239,68,68,.3); }
.ch-badge-urgent     { background: rgba(239,68,68,.22);  color: #fca5a5; border: 1px solid rgba(239,68,68,.38); animation: ch-pulse-badge 1.6s infinite; }
.ch-badge-salary     { background: rgba(16,185,129,.18); color: #6ee7b7; border: 1px solid rgba(16,185,129,.3); }
.ch-badge-govt       { background: rgba(59,130,246,.18); color: #93c5fd; border: 1px solid rgba(59,130,246,.3); }
.ch-badge-private    { background: rgba(139,92,246,.18); color: #c4b5fd; border: 1px solid rgba(139,92,246,.3); }
.ch-badge-scholarship{ background: rgba(245,158,11,.18); color: #fcd34d; border: 1px solid rgba(245,158,11,.3); }
.ch-badge-internship { background: rgba(6,182,212,.18);  color: #67e8f9; border: 1px solid rgba(6,182,212,.3); }

@keyframes ch-pulse-badge { 0%,100%{opacity:1;} 50%{opacity:.55;} }

/* Meta grid */
.ch-card-meta {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 5px 8px; padding: 8px 15px 10px;
  border-top: 1px solid rgba(255,255,255,.05);
}
.ch-meta-item {
  display: flex; align-items: flex-start; gap: 5px; min-width: 0;
}
.ch-meta-icon { font-size: 12px; flex-shrink: 0; margin-top: 1px; }
.ch-meta-val {
  font-size: 11.5px; color: #cbd5e1; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ch-meta-val.urgent { color: #f87171 !important; font-weight: 700; }
.ch-meta-val.soon   { color: #fb923c !important; font-weight: 600; }
.ch-meta-item.urgent .ch-meta-icon,
.ch-meta-item.urgent .ch-meta-val { color: #f87171; }
.ch-meta-item.soon .ch-meta-icon,
.ch-meta-item.soon .ch-meta-val   { color: #fb923c; }

/* Card footer */
.ch-card-footer {
  display: flex; gap: 8px; padding: 0 15px 15px;
}
.ch-card-btn {
  flex: 1; padding: 9px 10px; border-radius: 11px; font-size: 12.5px;
  font-weight: 600; cursor: pointer; border: none;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  transition: opacity .18s, transform .18s;
}
.ch-card-btn:active { opacity: .75; transform: scale(.97); }
.ch-card-btn.ghost {
  background: rgba(255,255,255,.05); color: #94a3b8;
  border: 1px solid rgba(255,255,255,.1);
}
.ch-card-btn.primary {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #fff; box-shadow: 0 3px 14px rgba(37,99,235,.4);
}

/* Urgency bar */
.ch-card-urgency-bar {
  background: linear-gradient(90deg, rgba(239,68,68,.22), rgba(239,68,68,.1));
  border-top: 1px solid rgba(239,68,68,.2);
  color: #f87171; font-size: 11.5px; font-weight: 700;
  padding: 7px 15px; text-align: center; letter-spacing: .3px;
}

/* Skeleton */
.ch-skel-card {
  background: rgba(255,255,255,.03); border-radius: 20px; margin: 0 14px 14px;
  padding: 15px; border: 1px solid rgba(255,255,255,.05);
}
.ch-skel {
  background: linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);
  background-size: 200% 100%; animation: ch-shimmer 1.4s ease-in-out infinite; border-radius: 8px;
}
@keyframes ch-shimmer { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }
.ch-skel-row { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.ch-skel-circle { width: 46px; height: 46px; border-radius: 13px; flex-shrink: 0; }
.ch-skel-line { height: 13px; border-radius: 7px; }
.ch-skel-line.lg { width: 72%; height: 16px; }
.ch-skel-line.md { width: 48%; }
.ch-skel-tags { display: flex; gap: 8px; margin-bottom: 12px; }
.ch-skel-tag { height: 22px; width: 70px; border-radius: 11px; }
.ch-skel-foot { display: flex; gap: 8px; }
.ch-skel-icon { width: 34px; height: 34px; border-radius: 9px; }
.ch-skel-btn { flex: 1; height: 36px; border-radius: 11px; }

/* ═══════════════════════════════════════════════════
   ARTICLE / DETAIL PAGE — PREMIUM REDESIGN
   ═══════════════════════════════════════════════════ */

/* Progress bar */
.ch-progress-rail {
  position: sticky; top: 0; left: 0; right: 0; height: 3px; z-index: 10;
  background: rgba(255,255,255,.06);
}
.ch-progress-fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4);
  transition: width .1s linear;
}

/* Hero banner */
.ch-art-hero {
  position: relative; min-height: 220px;
  background: linear-gradient(135deg, #0d1a3a 0%, #1a0d3a 50%, #0d2a3a 100%);
  overflow: hidden;
}
.ch-art-hero::before {
  content: ''; position: absolute; inset: 0;
  background: var(--hero-img, none) center/cover no-repeat;
  opacity: .18; filter: blur(2px);
}
.ch-art-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(8,12,20,.3) 0%, rgba(8,12,20,.85) 100%);
}
.ch-art-hero-content {
  position: relative; z-index: 2; padding: 20px 18px 22px;
}
.ch-art-hero-top {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; flex-wrap: wrap; gap: 6px;
}
.ch-art-views {
  font-size: 11px; color: rgba(255,255,255,.5); font-weight: 500;
}
.ch-art-org-row {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
}
.ch-art-org-logo {
  width: 44px; height: 44px; border-radius: 12px; font-size: 22px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15);
  flex-shrink: 0;
}
.ch-art-org-name { font-size: 13px; font-weight: 700; color: #94a3b8; }
.ch-art-org-loc  { font-size: 11.5px; color: #64748b; margin-top: 2px; }
.ch-art-title {
  font-size: clamp(1.1rem, 4vw, 1.4rem); font-weight: 800; color: #f1f5f9;
  line-height: 1.3; margin: 0 0 12px;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}
.ch-art-meta-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.ch-art-cat-chip {
  font-size: 10.5px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
  background: rgba(59,130,246,.2); border: 1px solid rgba(59,130,246,.3); color: #93c5fd;
  text-transform: capitalize; letter-spacing: .3px;
}
.ch-art-updated { font-size: 11px; color: #64748b; }

/* Action bar */
.ch-art-actions {
  display: flex; gap: 9px; padding: 14px 16px;
  background: rgba(13,18,32,.8); border-bottom: 1px solid rgba(255,255,255,.06);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  position: sticky; top: 3px; z-index: 9;
}
.ch-act-primary {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 18px; border-radius: 12px; border: none;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 20px rgba(37,99,235,.45);
  transition: transform .15s, box-shadow .15s;
}
.ch-act-primary:active { transform: scale(.97); box-shadow: 0 2px 10px rgba(37,99,235,.3); }
.ch-act-primary.disabled { opacity: .45; cursor: not-allowed; }
.ch-act-icon {
  width: 42px; height: 42px; border-radius: 12px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.05); font-size: 18px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .15s; flex-shrink: 0;
}
.ch-act-icon:active { transform: scale(.9); background: rgba(255,255,255,.1); }
.ch-act-icon.saved { background: rgba(239,68,68,.12); border-color: rgba(239,68,68,.25); }

/* Art sections */
.ch-art-section {
  padding: 0 0 4px;
  border-bottom: 1px solid rgba(255,255,255,.05);
}
.ch-art-section:last-of-type { border-bottom: none; }
.ch-art-section-hd {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 16px 12px;
  font-size: 14px; font-weight: 700; color: #e2e8f0;
  letter-spacing: .2px;
}
.ch-art-section-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: rgba(255,255,255,.07); display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}

/* Overview grid */
.ch-overview-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px; padding: 0 16px 16px;
}
.ch-overview-card {
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; padding: 12px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: border-color .2s;
}
.ch-overview-card.blue   { border-color: rgba(59,130,246,.25);  background: rgba(59,130,246,.06);  }
.ch-overview-card.green  { border-color: rgba(16,185,129,.25);  background: rgba(16,185,129,.06);  }
.ch-overview-card.purple { border-color: rgba(139,92,246,.25);  background: rgba(139,92,246,.06);  }
.ch-overview-card.gold   { border-color: rgba(245,158,11,.25);  background: rgba(245,158,11,.06);  }
.ch-overview-card.red    { border-color: rgba(239,68,68,.3);    background: rgba(239,68,68,.07);   }
.ch-ov-icon { font-size: 18px; margin-bottom: 5px; }
.ch-ov-label { font-size: 10.5px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
.ch-ov-val { font-size: 13px; font-weight: 700; color: #e2e8f0; line-height: 1.3; }
.ch-overview-card.red .ch-ov-val { color: #f87171; }
.ch-overview-card.gold .ch-ov-val { color: #fbbf24; }
.ch-overview-card.green .ch-ov-val { color: #34d399; }
.ch-overview-card.blue .ch-ov-val { color: #93c5fd; }
.ch-overview-card.purple .ch-ov-val { color: #c4b5fd; }

/* Timeline */
.ch-timeline { padding: 0 16px 16px; }
.ch-tl-item {
  display: flex; gap: 14px; padding-bottom: 16px;
}
.ch-tl-item.last { padding-bottom: 0; }
.ch-tl-line-wrap {
  display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0;
  margin-top: 4px;
}
.ch-tl-dot {
  width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  box-shadow: 0 0 8px rgba(59,130,246,.5);
}
.ch-tl-dot.urgent {
  background: linear-gradient(135deg, #ef4444, #f97316);
  box-shadow: 0 0 8px rgba(239,68,68,.6);
  animation: ch-pulse-badge 1.5s infinite;
}
.ch-tl-line {
  flex: 1; width: 2px; min-height: 14px;
  background: linear-gradient(to bottom, rgba(59,130,246,.3), transparent);
  margin-top: 4px;
}
.ch-tl-body { flex: 1; min-width: 0; }
.ch-tl-label { font-size: 11.5px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 3px; }
.ch-tl-val { font-size: 13.5px; font-weight: 700; color: #e2e8f0; }
.ch-tl-val.urgent { color: #f87171; }

/* Important links */
.ch-links-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px; padding: 0 16px 16px;
}
.ch-link-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 12px; border-radius: 13px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04);
  font-size: 12.5px; font-weight: 600; color: #94a3b8;
  transition: background .15s, border-color .15s, transform .15s;
  text-align: left;
}
.ch-link-btn:active { transform: scale(.96); }
.ch-link-btn.primary {
  grid-column: 1 / -1;
  background: linear-gradient(135deg, rgba(37,99,235,.2), rgba(124,58,237,.2));
  border-color: rgba(59,130,246,.35); color: #93c5fd;
  font-size: 14px; padding: 14px 16px;
  box-shadow: 0 2px 12px rgba(37,99,235,.2);
}
.ch-link-icon { font-size: 16px; flex-shrink: 0; }
.ch-link-label { flex: 1; }
.ch-link-arr { opacity: .5; flex-shrink: 0; }

/* Accordions */
.ch-accordions { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.ch-acc {
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03);
}
.ch-acc-hd {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 14px; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer; color: #e2e8f0;
}
.ch-acc-icon { font-size: 15px; flex-shrink: 0; }
.ch-acc-title { flex: 1; font-size: 13px; font-weight: 700; }
.ch-acc-chev { transition: transform .25s; flex-shrink: 0; opacity: .6; }
.ch-acc.open .ch-acc-chev { transform: rotate(180deg); }
.ch-acc-body {
  display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s ease;
}
.ch-acc.open .ch-acc-body { grid-template-rows: 1fr; }
.ch-acc-inner {
  overflow: hidden; padding: 0 14px 14px; font-size: 13px; color: #94a3b8; line-height: 1.7;
}
.ch-acc-inner p { margin: 0 0 8px; }
.ch-bullet { display: flex; gap: 8px; margin-bottom: 5px; }
.ch-bullet-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #3b82f6;
  flex-shrink: 0; margin-top: 7px;
}

/* Article body */
.ch-art-article-section { padding-top: 4px; }
.ch-article-body {
  padding: 0 16px 16px; font-size: 13.5px; color: #94a3b8;
  line-height: 1.75;
}
.ch-article-body h1,.ch-article-body h2,.ch-article-body h3 {
  color: #e2e8f0; font-weight: 700; margin: 16px 0 8px;
  font-size: 1.05rem;
}
.ch-article-body table {
  width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12.5px;
}
.ch-article-body th {
  background: rgba(59,130,246,.15); color: #93c5fd;
  padding: 8px 10px; border: 1px solid rgba(255,255,255,.08);
  font-weight: 700; text-align: left;
}
.ch-article-body td {
  padding: 8px 10px; border: 1px solid rgba(255,255,255,.06); color: #94a3b8;
}
.ch-article-body tr:nth-child(even) td { background: rgba(255,255,255,.02); }
.ch-article-body a { color: #60a5fa; text-decoration: none; }
.ch-article-body img { max-width: 100%; border-radius: 10px; margin: 8px 0; }
.ch-art-prose { padding: 0 16px 16px; font-size: 13.5px; color: #94a3b8; line-height: 1.75; }
.ch-art-prose p { margin: 0 0 10px; }

/* Recommendations */
.ch-rec-scroll {
  display: flex; gap: 12px; overflow-x: auto;
  padding: 0 16px 16px; -webkit-overflow-scrolling: touch;
}
.ch-rec-scroll::-webkit-scrollbar { display: none; }
.ch-rec-card {
  min-width: 160px; flex-shrink: 0; cursor: pointer;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; padding: 12px;
  transition: transform .2s;
}
.ch-rec-card:active { transform: scale(.96); }
.ch-rec-logo { font-size: 22px; margin: 4px 0 6px; }
.ch-rec-title {
  font-size: 12px; font-weight: 700; color: #e2e8f0; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 6px;
}
.ch-rec-meta { font-size: 11px; color: #64748b; line-height: 1.5; }

/* Sticky apply */
.ch-sticky-apply {
  position: sticky; bottom: 0; left: 0; right: 0; z-index: 20;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; margin: 0;
  background: rgba(8,12,20,.92);
  border-top: 1px solid rgba(255,255,255,.08);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  opacity: 0; transition: opacity .25s;
}
.ch-sticky-apply-info { flex: 1; min-width: 0; }
.ch-sticky-title { font-size: 12.5px; font-weight: 700; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-sticky-date  { font-size: 11px; color: #64748b; margin-top: 2px; }
.ch-sticky-urgent{ font-size: 11px; color: #f87171; margin-top: 2px; font-weight: 600; }
.ch-sticky-btn {
  padding: 10px 20px; border-radius: 12px; border: none;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
  white-space: nowrap; flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(37,99,235,.4);
  transition: transform .15s;
}
.ch-sticky-btn:active { transform: scale(.96); }
`;
  document.head.appendChild(style);
}

// ── Auto-init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chInit();
});
