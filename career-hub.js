/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — CAREER HUB  v3 (premium AMOLED)
   ═══════════════════════════════════════════════════════════════════
   • Fixed: Govt/Scholar/Intern stats (checks jobType + category + title)
   • Fixed: Last Date — handles all Indian date formats, never "Invalid Date"
   • Fixed: Vacancy — extracts from article/desc text, never "NaN Posts"
   • Fixed: Qualification/Salary/Age — smart text extraction
   • New:   AssamCareer-style premium cards with AMOLED glassmorphism
   • New:   Trending / Govt / Scholar / Intern horizontal sections
   • Keep:  All Supabase + Pipedream integrations intact
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
// Handles: "22 June 2026", "22nd June 2026", "June 22, 2026",
//          "22/06/2026", "2026-06-22", "08th July 2026", ISO strings
const _MONTHS = {
  jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
  may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,
  sep:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11
};

function _parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // 1. ISO / standard formats that JS Date handles
  let d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 2000) return d;

  // 2. "22nd June 2026" / "22 June 2026" / "08th July 2026"
  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (m) {
    const mo = _MONTHS[m[2].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      d = new Date(parseInt(m[3]), mo, parseInt(m[1]));
      if (!isNaN(d)) return d;
    }
  }

  // 3. "June 22, 2026" / "July 8, 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const mo = _MONTHS[m[1].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      d = new Date(parseInt(m[3]), mo, parseInt(m[2]));
      if (!isNaN(d)) return d;
    }
  }

  // 4. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    if (!isNaN(d)) return d;
  }

  // 5. Scrape "Last Date: 08 July 2026" style from text
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

// ── Extract last date from article/description text ───────────────
function _extractLastDateFromText(text) {
  if (!text) return null;
  // Match "Last Date: 08 July 2026", "Last Date to Apply: July 8, 2026" etc.
  const patterns = [
    /last\s*date(?:\s*(?:to\s*apply|of\s*application)?)?[:\s–-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
    /last\s*date(?:\s*(?:to\s*apply|of\s*application)?)?[:\s–-]+([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i,
    /closing\s*date[:\s–-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
    /apply\s*before[:\s–-]+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      // Try both orderings: day-month-year and month-day-year
      const attempt1 = `${m[1]} ${m[2]} ${m[3]}`;
      const d = _parseDate(attempt1);
      if (d) return d;
    }
  }
  return null;
}

// ── Safe vacancy — NEVER "NaN Posts" ─────────────────────────────
function _parseVac(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return (isNaN(n) || n <= 0) ? null : n;
}

// Extract vacancy count from article/description text
function _extractVacancyFromText(text) {
  if (!text) return null;
  const strip = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Match labelled patterns first (most reliable)
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

// ── Smart qualification extractor ────────────────────────────────
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
  // If raw qual looks clean (short, no HTML, not a paragraph), use it
  if (raw && raw.length < 80 && !raw.includes('<') && !/<|>|\n/.test(raw)) {
    const kw = _matchQualKeyword(raw);
    if (kw) return kw;
    return raw.split(/[,\.]/)[0].trim().slice(0, 60);
  }

  // Try article text
  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // Look for explicit qualification label
  const m = text.match(/(?:qualification|educational\s*qualification|eligibility)[:\s–-]+([^\.]{5,80}?)(?:\.|Candidate|Age|Note|$)/i);
  if (m) {
    const kw = _matchQualKeyword(m[1]);
    if (kw) return kw;
    return m[1].trim().split(/[,\n]/)[0].trim().slice(0, 60);
  }

  // Scan for keywords
  const found = _matchQualKeyword(text);
  if (found) return found;

  return raw ? raw.slice(0, 50).split(/[,\.]/)[0].trim() : 'Check Notification';
}

function _matchQualKeyword(text) {
  const t = text.toLowerCase();
  // Check from highest to lowest
  for (const kw of [..._QUAL_KEYWORDS].reverse()) {
    if (t.includes(kw)) {
      return kw.replace(/\b./g, c => c.toUpperCase()).trim();
    }
  }
  return null;
}

// ── Smart salary extractor ────────────────────────────────────────
function _extractSalary(raw, articleText) {
  if (raw && raw.length < 80 && !raw.includes('<')) {
    if (/\d/.test(raw)) return raw.slice(0, 60);
    if (/as per|pay level|pay band|grade pay/i.test(raw)) return raw.slice(0, 60);
  }

  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Pay Level / Pay Matrix
  let m = text.match(/pay\s*(?:level|matrix|band|scale)[:\s–-]*([^\.]{3,50}?)(?:\.|per\s*month|\bmonth|Approx|Grade|\()/i);
  if (m) return m[1].trim().slice(0, 60);

  // Rs. xxxxx/month or ₹ xxxxx
  m = text.match(/(?:Rs\.?|₹)\s*[\d,]+(?:\/\s*(?:month|pm|p\.m\.?))?/i);
  if (m) return m[0].trim().slice(0, 40);

  // CTC / approximate pay
  m = text.match(/(?:approximate\s*)?(?:ctc|pay)[:\s–-]*Rs\.?\s*[\d,\.]+\s*(?:lacs?|lakhs?|L)?/i);
  if (m) return m[0].trim().slice(0, 50);

  // "Pay scale: 48480-62480"
  m = text.match(/pay\s*scale[:\s–-]+Rs\.?\s*[\d\-\/,]+/i);
  if (m) return m[0].replace(/pay\s*scale[:\s–-]+/i,'').trim().slice(0, 50);

  // As Per Rules / Norms
  if (/as\s*per\s*(?:rules|norms|govt|government)/i.test(text)) return 'As Per Rules';

  return raw ? raw.slice(0, 60) : '';
}

// ── Smart age limit extractor ────────────────────────────────────
function _extractAge(raw, articleText) {
  if (raw && raw.length < 60 && !raw.includes('<')) {
    if (/\d/.test(raw)) return raw.slice(0, 50);
    if (/as per/i.test(raw)) return raw.slice(0, 50);
  }

  const text = (articleText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // "21-30 Years" / "18 to 40 Years"
  let m = text.match(/(?:age\s*limit)?[:\s–-]*(\d{2})\s*(?:to|-)\s*(\d{2})\s*[Yy]ears?/);
  if (m) return `${m[1]}-${m[2]} Years`;

  // "should not be below 21 years and not above 30 years"
  m = text.match(/not\s*below\s*(\d{2})\s*years?\s*and\s*not\s*above\s*(\d{2})\s*years?/i);
  if (m) return `${m[1]}-${m[2]} Years`;

  // "minimum age: 18" or "maximum age: 35"
  const mn = text.match(/minimum\s*age[:\s–-]+(\d{2})/i);
  const mx = text.match(/maximum\s*age[:\s–-]+(\d{2})/i);
  if (mn && mx) return `${mn[1]}-${mx[1]} Years`;

  if (/as\s*per\s*(?:rules|norms|govt|government)/i.test(text)) return 'As Per Rules';

  return raw ? raw.slice(0, 50) : 'As Per Rules';
}

// ── Row → normalised job object ───────────────────────────────────
function _map(r) {
  const articleText = r.article_content || r.description || '';
  const rawDate     = r.last_date || null;

  // Last date: column → text extraction fallback
  let lastDateVal = rawDate;
  if (!_parseDate(lastDateVal)) {
    const extracted = _extractLastDateFromText(articleText);
    if (extracted) lastDateVal = extracted.toISOString();
  }

  // Vacancy: column → text extraction fallback
  let posts = _parseVac(r.vacancies || r.total_posts);
  if (!posts) posts = _extractVacancyFromText(articleText);

  const cats = Array.isArray(r.category) ? r.category : (r.category ? [r.category] : []);

  // Qualification / Salary / Age with smart extraction
  const qual     = _extractQual(r.qualification || '', articleText);
  const salary   = _extractSalary(r.salary || '', articleText);
  const ageLimit = _extractAge(r.age_limit || '', articleText);

  return {
    id:          r.id,
    title:       (r.title || 'Untitled').trim(),
    org:         (r.org || r.organization || '').trim(),
    orgIcon:     r.org_icon || '💼',
    location:    (r.location || 'India').trim(),
    qual,
    salary,
    ageLimit,
    lastDate:    _fmtDate(lastDateVal),
    rawDate:     lastDateVal,
    urgentDate:  _isUrgent(lastDateVal),
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
    // structured sections
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
    sb.channel('ch-jobs-v3')
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

// ── Stats — FIXED: checks jobType + category + title ─────────────
function _chStats() {
  const jobs = window._ch.jobs;

  function _isGovt(j) {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return j.jobType === 'government' ||
           cats.includes('govt') ||
           cats.includes('government') ||
           /\bgovt\b|\bgovernment\b|\bpsu\b|\bpublic sector\b/i.test(j.title);
  }
  function _isScholar(j) {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return cats.includes('scholarship') ||
           /scholarship/i.test(j.title);
  }
  function _isIntern(j) {
    const cats = j.category.map(c => c.toLowerCase()).join(' ');
    return cats.includes('internship') ||
           /internship|intern\b/i.test(j.title);
  }

  const fmt = n => n.toLocaleString('en-IN');
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    el.style.transform = 'scale(1.18)';
    setTimeout(() => { el.style.transition = 'transform .3s'; el.style.transform = ''; }, 160);
  };

  set('chStatJobs',    fmt(jobs.length));
  set('chStatGovt',    fmt(jobs.filter(_isGovt).length));
  set('chStatScholar', fmt(jobs.filter(_isScholar).length));
  set('chStatIntern',  fmt(jobs.filter(_isIntern).length));
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

  const isGovt   = j => j.jobType === 'government' ||
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

  _injectSection('chTrendingSection', 'red',   '🔥', 'Trending Jobs',  trending, 'all');
  _injectSection('chGovtSection',     'blue',  '🏛️','Government Jobs', govt,     'govt');
  _injectSection('chScholarSection',  'gold',  '🎓', 'Scholarships',   scholar,  'scholarship');
  _injectSection('chInternSection',   'green', '💼', 'Internships',    intern,   'internship');
  _injectSection('chLatestSection',   'purple','🆕', 'Latest Jobs',    latest,   'all');
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
  const urgCls = j.urgentDate ? ' urgent' : '';
  return `
    <div class="ch-mini-card" onclick="chOpenDetail('${j.id}')">
      <div class="mc-badges">${_badgesHTML(j, 2)}</div>
      <div class="mc-icon">${_esc(j.orgIcon)}</div>
      <div class="mc-title">${_esc(j.title)}</div>
      <div class="mc-org">${_esc(j.org)}</div>
      <div class="mc-row"><span>📍</span><span>${_esc(j.location)}</span></div>
      <div class="mc-row${urgCls}"><span>📅</span><span>${_esc(j.lastDate)}</span></div>
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

// ── Premium AssamCareer-style job card (AMOLED) ───────────────────
function _cardHTML(j) {
  const saved   = window._ch.savedJobs.includes(j.id);
  const qual    = j.qual.length > 32 ? j.qual.slice(0,32) + '…' : j.qual;
  const salary  = j.salary.length > 32 ? j.salary.slice(0,32) + '…' : j.salary;
  const urgCls  = j.urgentDate ? ' urgent' : '';
  const vacTxt  = _vacDisplay(j);
  const featCls = j.featured ? ' ch-featured-card' : '';
  const newCls  = j.isNew    ? ' ch-new'           : '';

  return `
<div class="ch-job-card${featCls}${newCls}" id="chCard-${j.id}" onclick="chOpenDetail('${j.id}')">

  <!-- Top row: org icon + title/org + save btn -->
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

  <!-- Badges -->
  ${_badgesHTML(j, 4)}

  <!-- Meta grid -->
  <div class="ch-card-meta">
    <div class="ch-card-meta-item">
      <span class="ch-meta-icon">📍</span>
      <span class="ch-meta-val">${_esc(j.location)}</span>
    </div>
    <div class="ch-card-meta-item">
      <span class="ch-meta-icon">🎓</span>
      <span class="ch-meta-val">${_esc(qual)}</span>
    </div>
    ${salary ? `<div class="ch-card-meta-item">
      <span class="ch-meta-icon">💰</span>
      <span class="ch-meta-val">${_esc(salary)}</span>
    </div>` : ''}
    <div class="ch-card-meta-item${urgCls}">
      <span class="ch-meta-icon">📅</span>
      <span class="ch-meta-val${urgCls}">${_esc(j.lastDate)}</span>
    </div>
    <div class="ch-card-meta-item">
      <span class="ch-meta-icon">👥</span>
      <span class="ch-meta-val">${_esc(vacTxt)}</span>
    </div>
  </div>

  <!-- Footer actions -->
  <div class="ch-card-footer">
    <button class="ch-card-btn ghost"
      onclick="event.stopPropagation();chShareJob('${j.id}')">
      🔗 Share
    </button>
    <button class="ch-card-btn primary"
      onclick="event.stopPropagation();chOpenDetail('${j.id}')">
      📄 Details →
    </button>
  </div>

  ${j.urgentDate ? '<div class="ch-card-urgency-bar">🚨 Closing Soon — Apply Now!</div>' : ''}
</div>`;
}

// ── Badges ────────────────────────────────────────────────────────
function _badges(j) {
  const out  = [];
  const cats = j.category.map(c=>c.toLowerCase());
  const sal  = parseInt((j.salary||'0').replace(/[^0-9]/g,''),10)||0;
  if (j.isNew)                                         out.push({l:'NEW',        c:'new'});
  if (j.featured)                                      out.push({l:'FEATURED',   c:'featured'});
  if (j.isTrending)                                    out.push({l:'TRENDING',   c:'trending'});
  if (j.isUrgent || j.urgentDate)                      out.push({l:'URGENT',     c:'urgent'});
  if (sal >= 50000)                                    out.push({l:'HIGH SALARY',c:'salary'});
  if (j.jobType === 'government' || cats.some(c=>c.includes('govt')||c.includes('government')))
                                                       out.push({l:'GOVT',       c:'govt'});
  if (j.jobType === 'private'    || cats.includes('private'))
                                                       out.push({l:'PRIVATE',    c:'private'});
  if (cats.some(c=>c.includes('scholarship')) || /scholarship/i.test(j.title))
                                                       out.push({l:'SCHOLARSHIP',c:'scholarship'});
  if (cats.some(c=>c.includes('internship'))  || /internship/i.test(j.title))
                                                       out.push({l:'INTERNSHIP', c:'internship'});
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
  const txt = `💼 ${j.title}\n🏛️ ${j.org}\n📍 ${j.location} | 🎓 ${j.qual}\n⏰ Last Date: ${j.lastDate}\n👥 ${_vacDisplay(j)}\n\nVia Studyria Career Hub`;
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
    {icon:'🏛️', label:'Organization', val: j.org || '—',          cls:''},
    {icon:'🎓', label:'Qualification', val: j.qual || 'Any',       cls:''},
    {icon:'🎂', label:'Age Limit',     val: j.ageLimit || '—',     cls:''},
    {icon:'⏰', label:'Last Date',     val: j.lastDate,            cls: j.urgentDate ? 'danger' : ''},
  ];
  if (j.salary)  cards.push({icon:'💰', label:'Salary',    val:j.salary,       cls:'success'});
  if (j.posts)   cards.push({icon:'👥', label:'Vacancies', val:_vacDisplay(j), cls:'success'});
  if (j.appMode) cards.push({icon:'📝', label:'Mode',      val:j.appMode,      cls:''});
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
    <div class="ch-detail-progress"><div class="ch-detail-progress-bar" id="chPBar"></div></div>

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

    <div class="ch-detail-readtime">
      <span>🔒 Full details inside Studyria</span>
      ${j.views ? `<span>👁️ ${Number(j.views).toLocaleString()} views</span>` : ''}
    </div>

    <div class="ch-detail-actionbar">
      <button class="ch-action-btn primary"
        onclick="chLeave('${applyUrl ? _esc(applyUrl).replace(/'/g,"\\'") : ''}','${j.id}')"
        ${!applyUrl?'disabled':''}>
        🚀 Apply Now →
      </button>
      <button class="ch-action-btn icon${saved?' active':''}" id="chDetailSave"
        onclick="chToggleSave('${j.id}',this);_syncDetailSave('${j.id}')" title="Save">
        ${saved?'❤️':'🤍'}
      </button>
      <button class="ch-action-btn icon" onclick="chShareJob('${j.id}')" title="Share">📤</button>
      <button class="ch-action-btn icon" onclick="chCopyLink('${j.id}')" title="Copy link">🔗</button>
      ${j.notifLink ? `<button class="ch-action-btn icon" onclick="chLeave('${_esc(j.notifLink).replace(/'/g,"\\'")}','${j.id}')" title="Notification">📥</button>` : ''}
    </div>

    <div class="ch-detail-section-label" style="padding-top:18px"><span>⚡</span> Overview</div>
    ${_metaGrid(j)}
    ${_datesTimeline(j)}
    ${_linksHTML(j) ? `<div class="ch-detail-section-label"><span>🔗</span> Important Links</div>${_linksHTML(j)}` : ''}

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

    ${hasArt ? `
    <div class="ch-detail-section-label"><span>📰</span> Full Notification</div>
    <div class="ch-article-body">${j.articleHTML}</div>` : ''}

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

// ── AMOLED Premium Styles injection ──────────────────────────────
function _chInjectStyles() {
  if (document.getElementById('ch-premium-styles')) return;
  const style = document.createElement('style');
  style.id = 'ch-premium-styles';
  style.textContent = `
/* ══ CAREER HUB v3 — AMOLED Glassmorphism ══════════════════════ */

/* --- Section wrapper --- */
.ch-section-wrap { padding: 0; }
.ch-section-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 16px 10px;
}
.ch-section-title {
  font-size: 15px; font-weight: 700; color: #fff;
  display: flex; align-items: center; gap: 8px; letter-spacing: .2px;
}
.ch-sec-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0;
}
.ch-sec-dot.red    { background: #ef4444; box-shadow: 0 0 6px #ef4444aa; }
.ch-sec-dot.blue   { background: #3b82f6; box-shadow: 0 0 6px #3b82f6aa; }
.ch-sec-dot.gold   { background: #f59e0b; box-shadow: 0 0 6px #f59e0baa; }
.ch-sec-dot.green  { background: #10b981; box-shadow: 0 0 6px #10b981aa; }
.ch-sec-dot.purple { background: #8b5cf6; box-shadow: 0 0 6px #8b5cf6aa; }

.ch-see-all {
  font-size: 12px; color: #60a5fa; background: rgba(59,130,246,.1);
  border: 1px solid rgba(59,130,246,.25); border-radius: 20px;
  padding: 4px 12px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.ch-see-all:active { opacity: .7; }

.ch-sec-divider {
  height: 1px; background: linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);
  margin: 4px 0 0;
}

/* --- Horizontal scroll --- */
.ch-hscroll {
  display: flex; gap: 12px; overflow-x: auto; padding: 4px 16px 16px;
  scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
}
.ch-hscroll::-webkit-scrollbar { display: none; }

/* --- Mini card (sections) --- */
.ch-mini-card {
  min-width: 180px; max-width: 200px; flex-shrink: 0; scroll-snap-align: start;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; padding: 12px 12px 10px; cursor: pointer;
  transition: transform .2s, box-shadow .2s;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.ch-mini-card:active { transform: scale(.97); }
.mc-badges { min-height: 18px; margin-bottom: 6px; }
.mc-icon { font-size: 22px; margin-bottom: 6px; }
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
.mc-row.urgent { color: #f87171 !important; }

/* --- Job Cards (main list) --- */
.ch-job-card {
  background: rgba(15,15,20,.85);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 16px; padding: 0; margin: 0 16px 14px;
  cursor: pointer; overflow: hidden;
  transition: transform .18s, box-shadow .18s;
  box-shadow: 0 2px 16px rgba(0,0,0,.35);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.ch-job-card:active { transform: scale(.985); }
.ch-job-card.ch-featured-card {
  border-color: rgba(251,191,36,.3);
  box-shadow: 0 4px 20px rgba(251,191,36,.12);
}
.ch-job-card.ch-new { border-color: rgba(59,130,246,.3); }

/* Card top row */
.ch-card-top {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 14px 14px 10px;
}
.ch-card-logo {
  width: 44px; height: 44px; border-radius: 12px; font-size: 22px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
}
.ch-card-head { flex: 1; min-width: 0; }
.ch-card-title {
  font-size: 14px; font-weight: 700; color: #f1f5f9; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ch-card-org { font-size: 12px; color: #94a3b8; margin-top: 2px; }
.ch-card-save {
  background: none; border: none; font-size: 18px; padding: 2px;
  cursor: pointer; flex-shrink: 0; opacity: .7; transition: opacity .2s, transform .2s;
}
.ch-card-save.saved { opacity: 1; transform: scale(1.15); }

/* Badges row */
.ch-badges-row {
  display: flex; flex-wrap: wrap; gap: 5px; padding: 0 14px 8px;
}
.ch-badge {
  font-size: 9.5px; font-weight: 700; padding: 2.5px 8px; border-radius: 20px;
  letter-spacing: .5px; text-transform: uppercase;
}
.ch-badge-new        { background: rgba(16,185,129,.2); color: #34d399; border: 1px solid rgba(16,185,129,.35); }
.ch-badge-featured   { background: rgba(251,191,36,.2); color: #fbbf24; border: 1px solid rgba(251,191,36,.35); }
.ch-badge-trending   { background: rgba(239,68,68,.2);  color: #f87171; border: 1px solid rgba(239,68,68,.35); }
.ch-badge-urgent     { background: rgba(239,68,68,.25); color: #fca5a5; border: 1px solid rgba(239,68,68,.4); animation: pulse-urgency 1.5s infinite; }
.ch-badge-salary     { background: rgba(16,185,129,.2); color: #6ee7b7; border: 1px solid rgba(16,185,129,.35); }
.ch-badge-govt       { background: rgba(59,130,246,.2); color: #93c5fd; border: 1px solid rgba(59,130,246,.35); }
.ch-badge-private    { background: rgba(139,92,246,.2); color: #c4b5fd; border: 1px solid rgba(139,92,246,.35); }
.ch-badge-scholarship{ background: rgba(245,158,11,.2); color: #fcd34d; border: 1px solid rgba(245,158,11,.35); }
.ch-badge-internship { background: rgba(6,182,212,.2);  color: #67e8f9; border: 1px solid rgba(6,182,212,.35); }

@keyframes pulse-urgency {
  0%,100% { opacity:1; } 50% { opacity:.6; }
}

/* Meta grid */
.ch-card-meta {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  padding: 0 14px 10px; border-top: 1px solid rgba(255,255,255,.05); padding-top: 8px;
}
.ch-card-meta-item {
  display: flex; align-items: flex-start; gap: 5px; min-width: 0;
}
.ch-meta-icon { font-size: 12px; flex-shrink: 0; margin-top: 1px; }
.ch-meta-val {
  font-size: 11.5px; color: #cbd5e1; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ch-meta-val.urgent { color: #f87171 !important; font-weight: 600; }
.ch-card-meta-item.urgent .ch-meta-val { color: #f87171; }

/* Footer actions */
.ch-card-footer {
  display: flex; gap: 8px; padding: 0 14px 14px;
}
.ch-card-btn {
  flex: 1; padding: 8px 10px; border-radius: 10px; font-size: 12.5px;
  font-weight: 600; cursor: pointer; border: none; transition: opacity .2s;
  display: flex; align-items: center; justify-content: center; gap: 5px;
}
.ch-card-btn:active { opacity: .75; }
.ch-card-btn.ghost {
  background: rgba(255,255,255,.06); color: #94a3b8;
  border: 1px solid rgba(255,255,255,.1);
}
.ch-card-btn.primary {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff; box-shadow: 0 2px 12px rgba(37,99,235,.4);
}

/* Urgency bar */
.ch-card-urgency-bar {
  background: linear-gradient(90deg, rgba(239,68,68,.2), rgba(239,68,68,.1));
  border-top: 1px solid rgba(239,68,68,.25);
  color: #f87171; font-size: 11.5px; font-weight: 600;
  padding: 7px 14px; text-align: center; letter-spacing: .3px;
}

/* --- Skeleton --- */
.ch-skel-card {
  background: rgba(255,255,255,.03); border-radius: 16px; margin: 0 16px 14px;
  padding: 14px; border: 1px solid rgba(255,255,255,.05);
}
.ch-skel { background: rgba(255,255,255,.07); border-radius: 6px; animation: skel-pulse 1.4s ease-in-out infinite; }
.ch-skel-row { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.ch-skel-circle { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; }
.ch-skel-line { height: 14px; border-radius: 7px; }
.ch-skel-line.lg { width: 75%; }
.ch-skel-line.md { width: 50%; }
.ch-skel-tags { display: flex; gap: 8px; margin-bottom: 12px; }
.ch-skel-tag { height: 20px; width: 70px; border-radius: 10px; }
.ch-skel-foot { display: flex; gap: 8px; align-items: center; }
.ch-skel-icon { width: 32px; height: 32px; border-radius: 8px; }
.ch-skel-btn { flex: 1; height: 34px; border-radius: 10px; }
@keyframes skel-pulse { 0%,100%{opacity:.5;} 50%{opacity:1;} }
  `;
  document.head.appendChild(style);
}

// ── Auto-init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('page-career-hub')?.classList.contains('active')) chInit();
});
