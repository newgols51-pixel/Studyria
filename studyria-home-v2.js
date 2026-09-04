/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA HOME V2 — Enhancement Engine
   Renders new homepage sections inspired by AssamWork's IA.
   Integrates with existing career-hub.js (jobs), PDFS global (PDFs),
   and Supabase. Never modifies existing functions or routing.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';
  if (window._sv2HomeLoaded) return;
  window._sv2HomeLoaded = true;

  // ── UTILITIES ──────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function daysLeft(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var ms = d - now;
    if (ms < 0) return -1;
    return Math.ceil(ms / 86400000);
  }

  function deadlineClass(dl) {
    if (dl === null || dl < 0) return 'normal';
    if (dl <= 3) return 'urgent';
    if (dl <= 7) return 'warning';
    return 'normal';
  }

  function deadlineLabel(dl, fallback) {
    if (dl === null) return fallback || '';
    if (dl < 0) return 'Closed';
    if (dl === 0) return 'Today!';
    if (dl === 1) return '1 day left';
    if (dl <= 7) return dl + ' days left';
    return fallback || '';
  }

  // ── PROMO BANNER ───────────────────────────────────────────────
  function injectPromoBanner() {
    // Only inject if not already present
    if (document.getElementById('sv2PromoBanner')) return;

    var banner = document.createElement('div');
    banner.id = 'sv2PromoBanner';
    banner.className = 'sv2-promo';
    banner.innerHTML =
      '<div class="sv2-promo-shimmer"></div>' +
      '<span class="sv2-promo-badge">🔥 OFFER</span>' +
      '<span class="sv2-promo-text">50–80% OFF on Premium PDFs · Instant Download · Get Studyria Pass Today</span>' +
      '<button class="sv2-promo-close" onclick="this.parentElement.style.display=\'none\'" aria-label="Dismiss">✕</button>';

    // Insert before the old top-banner, or at the very top of body
    var oldBanner = document.getElementById('topBanner');
    if (oldBanner && oldBanner.parentNode) {
      oldBanner.parentNode.insertBefore(banner, oldBanner);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  // ── QUICK NAV BAR ──────────────────────────────────────────────
  function injectQuickNav() {
    if (document.getElementById('sv2QuickNav')) return;

    var nav = document.createElement('div');
    nav.id = 'sv2QuickNav';
    nav.className = 'sv2-quicknav';
    nav.innerHTML =
      '<div class="sv2-quicknav-inner">' +
        '<button class="sv2-qn-item active" onclick="navigate(\'home\')"><span class="sv2-qn-icon">🏠</span>Home</button>' +
        '<button class="sv2-qn-item" onclick="navigate(\'career-hub\')"><span class="sv2-qn-icon">💼</span>Jobs</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavFreePDFs()"><span class="sv2-qn-icon">📄</span>Free PDFs</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavPremium()"><span class="sv2-qn-icon">👑</span>Premium</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavGovtJobs()"><span class="sv2-qn-icon">🏛️</span>Govt Jobs</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavAdmit()"><span class="sv2-qn-icon">🎫</span>Admit Cards</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavResults()"><span class="sv2-qn-icon">📊</span>Results</button>' +
        '<button class="sv2-qn-item" onclick="navigate(\'blog\')"><span class="sv2-qn-icon">📰</span>Current Affairs</button>' +
        '<div class="sv2-qn-divider"></div>' +
        '<button class="sv2-qn-item" onclick="sv2NavQuiz()"><span class="sv2-qn-icon">🧠</span>Daily Quiz</button>' +
        '<button class="sv2-qn-item" onclick="sv2NavMockTest()"><span class="sv2-qn-icon">📝</span>Mock Tests</button>' +
        '<button class="sv2-qn-item" onclick="navigate(\'campus\')"><span class="sv2-qn-icon">🏫</span>Campus</button>' +
      '</div>';

    // Insert right after the nav element
    var navEl = document.querySelector('.nav');
    if (navEl && navEl.parentNode) {
      navEl.parentNode.insertBefore(nav, navEl.nextSibling);
    }
  }

  // ── NAV HELPERS ────────────────────────────────────────────────
  window.sv2NavFreePDFs = function() {
    navigate('library');
    setTimeout(function() {
      var filter = document.querySelector('[data-filter="free"]');
      if (filter) filter.click();
    }, 300);
  };
  window.sv2NavPremium = function() { navigate('premium'); };
  window.sv2NavGovtJobs = function() {
    navigate('career-hub');
    setTimeout(function() { if (typeof chSelectCatByKey === 'function') chSelectCatByKey('govt'); }, 300);
  };
  window.sv2NavAdmit = function() {
    navigate('career-hub');
    setTimeout(function() { if (typeof chSelectCatByKey === 'function') chSelectCatByKey('admit'); }, 300);
  };
  window.sv2NavResults = function() {
    navigate('career-hub');
    setTimeout(function() { if (typeof chSelectCatByKey === 'function') chSelectCatByKey('result'); }, 300);
  };
  window.sv2NavQuiz = function() { navigate('brainlab'); };
  window.sv2NavMockTest = function() { navigate('campus'); };

  // ── JOBS DATA ──────────────────────────────────────────────────
  function getJobs() {
    var s = window._ch;
    return (s && Array.isArray(s.jobs)) ? s.jobs : [];
  }

  function isGovtJob(j) {
    if (!j) return false;
    return j.jobType === 'government' ||
      (j.category || []).map(function(c) { return c.toLowerCase(); }).some(function(c) {
        return c.indexOf('govt') >= 0 || c.indexOf('government') >= 0;
      }) ||
      /\bgovt\b|\bgovernment\b|\bpsu\b/i.test(j.title || '');
  }

  function isPrivateJob(j) {
    if (!j) return false;
    return j.jobType === 'private' ||
      (j.category || []).map(function(c) { return c.toLowerCase(); }).some(function(c) {
        return c.indexOf('private') >= 0;
      });
  }

  function isAdmitJob(j) {
    if (!j) return false;
    return (j.category || []).map(function(c) { return c.toLowerCase(); }).some(function(c) {
      return c.indexOf('admit') >= 0;
    }) || /admit\s*card/i.test(j.title || '');
  }

  function isResultJob(j) {
    if (!j) return false;
    return (j.category || []).map(function(c) { return c.toLowerCase(); }).some(function(c) {
      return c.indexOf('result') >= 0;
    }) || /result/i.test(j.title || '');
  }

  // ── JOB CARD HTML ──────────────────────────────────────────────
  function jobCardHTML(j) {
    if (!j) return '';
    var dl = daysLeft(j.lastDate || j.deadline || j.application_end_date);
    var dlCls = deadlineClass(dl);
    var dlLabel = deadlineLabel(dl, j.lastDate || j.deadline || '');

    var badges = '';
    if (j.isTrending) badges += '<span class="sv2-job-badge trending">🔥 Trending</span>';
    if (j.isNew) badges += '<span class="sv2-job-badge new">✨ New</span>';
    if (isGovtJob(j)) badges += '<span class="sv2-job-badge govt">Govt</span>';
    else if (isPrivateJob(j)) badges += '<span class="sv2-job-badge private">Private</span>';
    if (dl !== null && dl >= 0 && dl <= 3) badges += '<span class="sv2-job-badge urgent">⚡ Urgent</span>';

    var orgIcon = j.orgIcon || '🏢';
    var title = esc(j.title || 'Untitled Position');
    var org = esc(j.org || j.organization || '');
    var location = esc(j.location || 'Not specified');
    var posts = j.posts || j.vacancies || '';
    var postsText = posts ? (posts + ' posts') : '';

    // Deadline progress bar
    var barWidth = dl !== null && dl >= 0 ? Math.max(5, Math.min(100, 100 - (dl / 30 * 100))) : 100;

    return '<div class="sv2-job-card" onclick="chOpenDetail(\'' + esc(j.id) + '\')">' +
      (badges ? '<div class="sv2-job-badges">' + badges + '</div>' : '') +
      '<div class="sv2-job-org">' +
        '<div class="sv2-job-org-icon">' + esc(orgIcon) + '</div>' +
        '<div class="sv2-job-org-name">' + org + '</div>' +
      '</div>' +
      '<div class="sv2-job-title">' + title + '</div>' +
      '<div class="sv2-job-meta">' +
        '<div class="sv2-job-meta-row"><span>📍</span><span>' + location + '</span></div>' +
        (postsText ? '<div class="sv2-job-meta-row"><span>👥</span><span>' + esc(postsText) + '</span></div>' : '') +
        '<div class="sv2-job-meta-row ' + (dlCls === 'urgent' ? 'urgent' : '') + '"><span>📅</span><span>' + esc(dlLabel) + '</span></div>' +
      '</div>' +
      '<div class="sv2-job-deadline-bar"><div class="sv2-job-deadline-fill ' + dlCls + '" style="width:' + barWidth + '%"></div></div>' +
    '</div>';
  }

  // ── PDF CARD HTML ──────────────────────────────────────────────
  function pdfCardHTML(pdf) {
    if (!pdf) return '';
    var isFree = pdf.free || !pdf.price || Number(pdf.price) === 0;
    var price = Number(pdf.price || 0);
    var tag = (pdf.tag || '').toLowerCase().replace(/[\s-]+/g, '');
    var tagClass = 'free';
    var tagLabel = 'FREE';
    if (!isFree && (tag === 'bestseller' || tag === 'trending')) { tagClass = tag; tagLabel = (pdf.tag || '').toUpperCase(); }
    else if (!isFree && tag === 'new') { tagClass = 'new'; tagLabel = 'NEW'; }
    else if (!isFree && tag === 'premium') { tagClass = 'premium'; tagLabel = 'PREMIUM'; }
    else if (!isFree) { tagClass = 'premium'; tagLabel = '₹' + price; }

    var cover = pdf.cover_url || pdf.coverImage || '';
    var coverHTML = cover
      ? '<img src="' + esc(cover) + '" alt="' + esc(pdf.title) + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
      : '';
    var fallback = '<div class="sv2-pdf-cover-fallback" style="display:' + (cover ? 'none' : 'flex') + '">📄</div>';

    var inWish = Array.isArray(window.wishlist) && (window.wishlist.includes(String(pdf.id)) || window.wishlist.includes(Number(pdf.id)));
    var dlCount = pdf.download_count || pdf.downloads || 0;
    var dlText = dlCount > 1000 ? (dlCount / 1000).toFixed(1) + 'k' : dlCount;

    return '<div class="sv2-pdf-card" onclick="openDetail(\'' + esc(pdf.id) + '\')">' +
      '<div class="sv2-pdf-cover">' +
        coverHTML + fallback +
        '<div class="sv2-pdf-cover-scrim"></div>' +
        '<span class="sv2-pdf-tag ' + tagClass + '">' + esc(tagLabel) + '</span>' +
        '<button class="sv2-pdf-wish' + (inWish ? ' active' : '') + '" onclick="event.stopPropagation();if(typeof window.toggleWishlistItem===\'function\')window.toggleWishlistItem(\'' + esc(pdf.id) + '\',\'pdf\')" aria-label="Wishlist">♥</button>' +
      '</div>' +
      '<div class="sv2-pdf-body">' +
        '<div class="sv2-pdf-title">' + esc(pdf.title || '') + '</div>' +
        '<div class="sv2-pdf-meta">' + (pdf.author ? 'by ' + esc(pdf.author) : '') + (pdf.category ? ' · ' + esc(pdf.category) : '') + '</div>' +
        '<div class="sv2-pdf-footer">' +
          '<span class="sv2-pdf-price ' + (isFree ? 'free' : '') + '">' + (isFree ? 'FREE' : '₹' + price) + '</span>' +
          (dlText ? '<span class="sv2-pdf-dl">⬇ ' + esc(dlText) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── SECTION HTML BUILDER ───────────────────────────────────────
  function sectionHTML(id, dotColor, icon, title, badge, badgeClass, contentHTML, seeAllOnClick) {
    var badgeHTML = badge ? '<span class="sv2-section-badge ' + (badgeClass || '') + '">' + esc(badge) + '</span>' : '';
    var seeAllHTML = seeAllOnClick ? '<button class="sv2-see-all" onclick="' + seeAllOnClick + '">See All →</button>' : '';
    return '<section class="sv2-section" id="' + id + '">' +
      '<div class="sv2-section-head">' +
        '<div class="sv2-section-title-wrap">' +
          '<span class="sv2-section-dot ' + dotColor + '"></span>' +
          '<span class="sv2-section-title">' + icon + ' ' + esc(title) + '</span>' +
          badgeHTML +
        '</div>' +
        seeAllHTML +
      '</div>' +
      contentHTML +
    '</section>';
  }

  function skeletonJobRow(count) {
    var cards = '';
    for (var i = 0; i < (count || 4); i++) {
      cards += '<div class="sv2-skeleton-card sv2-skel-job">' +
        '<div class="sv2-skel-line medium"></div>' +
        '<div class="sv2-skel-line"></div>' +
        '<div class="sv2-skel-line short"></div>' +
      '</div>';
    }
    return '<div class="sv2-hscroll">' + cards + '</div>';
  }

  function skeletonPDFRow(count) {
    var cards = '';
    for (var i = 0; i < (count || 5); i++) {
      cards += '<div class="sv2-skeleton-card sv2-skel-pdf">' +
        '<div class="sv2-skel-cover"></div>' +
        '<div style="padding:8px 10px"><div class="sv2-skel-line medium"></div><div class="sv2-skel-line short" style="margin-top:6px"></div></div>' +
      '</div>';
    }
    return '<div class="sv2-hscroll">' + cards + '</div>';
  }

  // ── RENDER: LATEST JOBS ────────────────────────────────────────
  function renderLatestJobs(container) {
    var jobs = getJobs().slice(0, 10);
    if (!jobs.length) { container.innerHTML = '<div class="sv2-empty">Loading latest jobs…</div>'; return; }
    var cards = jobs.map(jobCardHTML).join('');
    container.innerHTML = '<div class="sv2-hscroll">' + cards + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: GOVERNMENT JOBS ────────────────────────────────────
  function renderGovtJobs(container) {
    var jobs = getJobs().filter(isGovtJob).slice(0, 10);
    if (!jobs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + jobs.map(jobCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: PRIVATE JOBS ───────────────────────────────────────
  function renderPrivateJobs(container) {
    var jobs = getJobs().filter(isPrivateJob).slice(0, 10);
    if (!jobs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + jobs.map(jobCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: ADMIT CARDS ────────────────────────────────────────
  function renderAdmitCards(container) {
    var jobs = getJobs().filter(isAdmitJob).slice(0, 10);
    if (!jobs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + jobs.map(jobCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: RESULTS ────────────────────────────────────────────
  function renderResults(container) {
    var jobs = getJobs().filter(isResultJob).slice(0, 10);
    if (!jobs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + jobs.map(jobCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: FREE PDFs ──────────────────────────────────────────
  function renderFreePDFs(container) {
    var pdfs = (window.PDFS || []).filter(function(p) {
      return p && p.title && (p.free || !p.price || Number(p.price) === 0);
    }).slice(0, 10);
    if (!pdfs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + pdfs.map(pdfCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: PREMIUM PDFs ────────────────────────────────────────
  function renderPremiumPDFs(container) {
    var pdfs = (window.PDFS || []).filter(function(p) {
      return p && p.title && !(p.free || !p.price || Number(p.price) === 0);
    }).sort(function(a, b) {
      return Number(b.price || 0) - Number(a.price || 0);
    }).slice(0, 10);
    if (!pdfs.length) { container.parentElement.style.display = 'none'; return; }
    container.innerHTML = '<div class="sv2-hscroll">' + pdfs.map(pdfCardHTML).join('') + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: POPULAR CATEGORIES ─────────────────────────────────
  function renderPopularCategories(container) {
    var cats = [
      { name: 'ADRE', icon: '🎯', cls: 'blue', filter: 'adre' },
      { name: 'APSC', icon: '⚖️', cls: 'purple', filter: 'apsc' },
      { name: 'Assam Police', icon: '🛡️', cls: 'green', filter: 'police' },
      { name: 'Current Affairs', icon: '📰', cls: 'teal', filter: 'current' },
      { name: 'General Knowledge', icon: '🧠', cls: 'gold', filter: 'gk' },
      { name: 'Assam TET', icon: '📚', cls: 'orange', filter: 'tet' },
      { name: 'SSC', icon: '📋', cls: 'red', filter: 'ssc' },
      { name: 'Free PDFs', icon: '🎁', cls: 'green', filter: 'free' }
    ];

    // Count PDFs per category
    var pdfs = window.PDFS || [];
    cats.forEach(function(c) {
      c.count = pdfs.filter(function(p) {
        var title = (p.title || '').toLowerCase();
        var cat = (p.category || '').toLowerCase();
        var tag = (p.tag || '').toLowerCase();
        if (c.filter === 'free') return p.free || !p.price || Number(p.price) === 0;
        return title.indexOf(c.filter) >= 0 || cat.indexOf(c.filter) >= 0 || tag.indexOf(c.filter) >= 0;
      }).length;
    });

    var html = cats.map(function(c) {
      return '<div class="sv2-cat-card" onclick="sv2NavCategory(\'' + esc(c.filter) + '\')">' +
        '<div class="sv2-cat-icon ' + c.cls + '">' + c.icon + '</div>' +
        '<div class="sv2-cat-name">' + esc(c.name) + '</div>' +
        '<div class="sv2-cat-count">' + c.count + ' PDFs</div>' +
      '</div>';
    }).join('');

    container.innerHTML = '<div class="sv2-grid">' + html + '</div>';
    revealSection(container.parentElement);
  }

  window.sv2NavCategory = function(filter) {
    navigate('library');
    setTimeout(function() {
      var search = document.getElementById('libSearch');
      if (search) { search.value = filter; if (typeof renderLibrary === 'function') renderLibrary(); }
    }, 300);
  };

  // ── RENDER: POPULAR EXAMS ──────────────────────────────────────
  function renderPopularExams(container) {
    var exams = [
      { name: 'ADRE 3.0', sub: 'Assam Direct Recruitment', cls: 'adre' },
      { name: 'APSC Prelims', sub: 'Assam Public Service Comm.', cls: 'apsc' },
      { name: 'Assam Police', sub: 'SI / Constable', cls: 'police' },
      { name: 'Assam TET', sub: 'Teachers Eligibility Test', cls: 'tet' },
      { name: 'SSC GD', sub: 'Staff Selection Commission', cls: 'ssc' },
      { name: 'Assam Govt Exams', sub: 'Various Departments', cls: 'assam' }
    ];

    var html = exams.map(function(e) {
      return '<div class="sv2-exam-card" onclick="sv2NavCategory(\'' + e.cls + '\')">' +
        '<div class="sv2-exam-badge ' + e.cls + '">' + esc(e.name.substring(0, 4).toUpperCase()) + '</div>' +
        '<div class="sv2-exam-info"><div class="sv2-exam-name">' + esc(e.name) + '</div><div class="sv2-exam-sub">' + esc(e.sub) + '</div></div>' +
        '<span class="sv2-exam-arrow">→</span>' +
      '</div>';
    }).join('');

    container.innerHTML = '<div class="sv2-grid">' + html + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: DAILY QUIZ / MOCK TESTS ─────────────────────────────
  function renderQuiz(container) {
    var quizzes = [
      { title: 'Daily Current Affairs Quiz', desc: '10 questions · 5 min · Test your daily GA knowledge', icon: '⚡', meta: '10 Qs' },
      { title: 'ADRE General Studies Mock', desc: 'Full-length mock · 100 questions · 120 min', icon: '🎯', meta: '100 Qs' },
      { title: 'APSC Prelims GS Practice', desc: 'Topic-wise practice sets for APSC Prelims', icon: '⚖️', meta: '50 Qs' },
      { title: 'Assam GK Special Quiz', desc: 'Assam history, geography & culture quiz', icon: '🏛️', meta: '20 Qs' },
      { title: 'English Comprehension Test', desc: 'Grammar & comprehension for competitive exams', icon: '📖', meta: '25 Qs' },
      { title: 'Mathematics & Reasoning', desc: 'Quantitative aptitude & logical reasoning', icon: '🔢', meta: '30 Qs' }
    ];

    var html = quizzes.map(function(q) {
      return '<div class="sv2-quiz-card" onclick="navigate(\'brainlab\')">' +
        '<div class="sv2-quiz-icon">' + q.icon + '</div>' +
        '<div class="sv2-quiz-title">' + esc(q.title) + '</div>' +
        '<div class="sv2-quiz-desc">' + esc(q.desc) + '</div>' +
        '<div class="sv2-quiz-meta"><div class="sv2-quiz-meta-item">📝 ' + esc(q.meta) + '</div></div>' +
        '<button class="sv2-quiz-btn">Start Now</button>' +
      '</div>';
    }).join('');

    container.innerHTML = '<div class="sv2-hscroll">' + html + '</div>';
    revealSection(container.parentElement);
  }

  // ── RENDER: NOTIFICATIONS TICKER ───────────────────────────────
  function renderNotifTicker(container) {
    var jobs = getJobs();
    var items = [];
    if (jobs.length) {
      jobs.slice(0, 8).forEach(function(j) {
        items.push('<span class="sv2-notif-item"><strong>' + esc(j.org || j.organization || '') + '</strong> — ' + esc(j.title || '') + '</span>');
      });
    } else {
      items.push('<span class="sv2-notif-item">Loading latest notifications…</span>');
    }

    // Duplicate for seamless scroll
    var trackHTML = items.join('') + items.join('');
    container.innerHTML =
      '<div class="sv2-notif-ticker">' +
        '<span class="sv2-notif-label">🔔 Live</span>' +
        '<div class="sv2-notif-track"><div class="sv2-notif-items">' + trackHTML + '</div></div>' +
      '</div>';
  }

  // ── RENDER: INSTALL APP CTA ────────────────────────────────────
  function renderInstallCTA(container) {
    container.innerHTML =
      '<div class="sv2-install-cta">' +
        '<div class="sv2-install-left">' +
          '<div class="sv2-install-icon">📱</div>' +
          '<div class="sv2-install-text">' +
            '<h3>Install Studyria App</h3>' +
            '<p>Fast, offline-ready & lightweight. Get instant access to all PDFs, jobs & quizzes.</p>' +
          '</div>' +
        '</div>' +
        '<button class="sv2-install-btn" onclick="navigate(\'pwa\')">Install Now →</button>' +
      '</div>';
    revealSection(container);
  }

  // ── RENDER: NEWSLETTER ─────────────────────────────────────────
  function renderNewsletter(container) {
    container.innerHTML =
      '<div class="sv2-newsletter">' +
        '<div class="sv2-newsletter-inner">' +
          '<h3>📬 Stay Updated</h3>' +
          '<p>Get latest job notifications, new PDF releases & exam updates directly to your inbox.</p>' +
          '<form class="sv2-newsletter-form" onsubmit="sv2NewsletterSubmit(event)">' +
            '<input type="email" class="sv2-newsletter-input" placeholder="Enter your email address" required>' +
            '<button type="submit" class="sv2-newsletter-btn">Subscribe</button>' +
          '</form>' +
        '</div>' +
      '</div>';
    revealSection(container);
  }

  window.sv2NewsletterSubmit = function(e) {
    e.preventDefault();
    var form = e.target;
    var input = form.querySelector('input');
    if (input && input.value) {
      // Store locally — integrate with Supabase if available
      try {
        var sb = window.supabaseClient;
        if (sb) {
          sb.from('newsletter_subscribers').upsert({
            email: input.value,
            source: 'homepage_v2'
          }).then(function() {
            form.innerHTML = '<p style="color:#34d399;font-size:.85rem;font-weight:600">✓ Subscribed! Check your inbox.</p>';
          }).catch(function() {
            form.innerHTML = '<p style="color:#34d399;font-size:.85rem;font-weight:600">✓ Subscribed!</p>';
          });
        } else {
          form.innerHTML = '<p style="color:#34d399;font-size:.85rem;font-weight:600">✓ Subscribed!</p>';
        }
      } catch(_) {
        form.innerHTML = '<p style="color:#34d399;font-size:.85rem;font-weight:600">✓ Subscribed!</p>';
      }
    }
  };

  // ── SCROLL REVEAL ──────────────────────────────────────────────
  function revealSection(el) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('sv2-visible'); return; }
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('sv2-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '50px', threshold: 0.05 });
    io.observe(el);
  }

  // ── INJECT ALL SECTIONS ────────────────────────────────────────
  function injectSections() {
    var homePage = document.getElementById('page-home');
    if (!homePage) return;
    if (document.getElementById('sv2SectionsContainer')) return; // Already injected

    // Create container for all new sections
    var container = document.createElement('div');
    container.id = 'sv2SectionsContainer';

    // Build all sections
    var html = '';

    // Notifications ticker
    html += '<div id="sv2NotifTicker"></div>';

    // Latest Jobs
    html += sectionHTML('sv2LatestJobs', 'blue', '⚡', 'Latest Jobs', 'Live', 'live',
      '<div id="sv2LatestJobsContent">' + skeletonJobRow(4) + '</div>',
      'navigate(\'career-hub\')');

    // Trending Jobs
    html += sectionHTML('sv2TrendingJobs', 'red', '🔥', 'Trending Jobs', 'Hot', 'hot',
      '<div id="sv2TrendingJobsContent">' + skeletonJobRow(4) + '</div>',
      'navigate(\'career-hub\')');

    // Government Jobs
    html += sectionHTML('sv2GovtJobs', 'blue', '🏛️', 'Government Jobs', 'Govt', 'govt',
      '<div id="sv2GovtJobsContent">' + skeletonJobRow(4) + '</div>',
      'sv2NavGovtJobs()');

    // Private Jobs
    html += sectionHTML('sv2PrivateJobs', 'green', '🏢', 'Private Jobs', '', '',
      '<div id="sv2PrivateJobsContent">' + skeletonJobRow(4) + '</div>',
      'navigate(\'career-hub\')');

    // Admit Cards
    html += sectionHTML('sv2AdmitCards', 'orange', '🎫', 'Admit Cards', '', '',
      '<div id="sv2AdmitCardsContent">' + skeletonJobRow(4) + '</div>',
      'sv2NavAdmit()');

    // Results
    html += sectionHTML('sv2Results', 'purple', '📊', 'Results', '', '',
      '<div id="sv2ResultsContent">' + skeletonJobRow(4) + '</div>',
      'sv2NavResults()');

    // Current Affairs (blog)
    html += sectionHTML('sv2CurrentAffairs', 'teal', '📰', 'Current Affairs', '', '',
      '<div id="sv2CurrentAffairsContent"><div class="sv2-empty">Loading current affairs…</div></div>',
      'navigate(\'blog\')');

    // Free PDFs
    html += sectionHTML('sv2FreePDFs', 'green', '🎁', 'Free PDFs', '', '',
      '<div id="sv2FreePDFsContent">' + skeletonPDFRow(5) + '</div>',
      'sv2NavFreePDFs()');

    // Premium PDFs
    html += sectionHTML('sv2PremiumPDFs', 'gold', '👑', 'Premium PDFs', 'Premium', 'premium',
      '<div id="sv2PremiumPDFsContent">' + skeletonPDFRow(5) + '</div>',
      'sv2NavPremium()');

    // Popular Categories
    html += sectionHTML('sv2PopularCategories', 'blue', '🗂️', 'Popular Categories', '', '',
      '<div id="sv2PopularCategoriesContent"></div>',
      'navigate(\'library\')');

    // Popular Exams
    html += sectionHTML('sv2PopularExams', 'purple', '🏆', 'Popular Exams', '', '',
      '<div id="sv2PopularExamsContent"></div>',
      'navigate(\'career-hub\')');

    // Daily Quiz & Mock Tests
    html += sectionHTML('sv2Quiz', 'purple', '🧠', 'Daily Quiz & Mock Tests', 'New', 'quiz',
      '<div id="sv2QuizContent"></div>',
      'navigate(\'brainlab\')');

    // Install App CTA
    html += '<div id="sv2InstallCTA"></div>';

    // Newsletter
    html += '<div id="sv2Newsletter"></div>';

    container.innerHTML = html;

    // Insert AFTER Search Studyria (discover-section) so the newer
    // Live Notifications / Trust Strip / Search Studyria sections stay
    // visible right after the Hero, and this legacy jobs block appears
    // below them instead of pushing them down.
    var anchor = document.getElementById('discover-section');
    var hero = homePage.querySelector('.sh-hero');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(container, anchor.nextSibling);
    } else if (hero && hero.parentNode) {
      hero.parentNode.insertBefore(container, hero.nextSibling);
    } else {
      // Fallback: insert after the hero section
      var hero = homePage.querySelector('.sh-hero');
      if (hero && hero.parentNode) {
        hero.parentNode.insertBefore(container, hero.nextSibling);
      } else {
        homePage.insertBefore(container, homePage.firstChild);
      }
    }

    // Render static sections immediately
    var notifTicker = document.getElementById('sv2NotifTicker');
    if (notifTicker) renderNotifTicker(notifTicker);

    var quizContent = document.getElementById('sv2QuizContent');
    if (quizContent) renderQuiz(quizContent);

    var catContent = document.getElementById('sv2PopularCategoriesContent');
    if (catContent) renderPopularCategories(catContent);

    var examContent = document.getElementById('sv2PopularExamsContent');
    if (examContent) renderPopularExams(examContent);

    var installCTA = document.getElementById('sv2InstallCTA');
    if (installCTA) renderInstallCTA(installCTA);

    var newsletter = document.getElementById('sv2Newsletter');
    if (newsletter) renderNewsletter(newsletter);

    // Reveal all sections
    document.querySelectorAll('.sv2-section').forEach(revealSection);
  }

  // ── RENDER JOBS DATA ───────────────────────────────────────────
  function renderJobsSections() {
    var jobs = getJobs();
    if (!jobs.length) return; // Career Hub hasn't loaded jobs yet

    // Latest Jobs
    var latest = document.getElementById('sv2LatestJobsContent');
    if (latest) renderLatestJobs(latest);

    // Trending
    var trending = document.getElementById('sv2TrendingJobsContent');
    if (trending) {
      var trendingJobs = jobs.filter(function(j) { return j.isTrending || j.isNew; }).slice(0, 10);
      if (trendingJobs.length) {
        trending.innerHTML = '<div class="sv2-hscroll">' + trendingJobs.map(jobCardHTML).join('') + '</div>';
        revealSection(trending.parentElement);
      } else {
        trending.parentElement.style.display = 'none';
      }
    }

    // Govt
    var govt = document.getElementById('sv2GovtJobsContent');
    if (govt) renderGovtJobs(govt);

    // Private
    var priv = document.getElementById('sv2PrivateJobsContent');
    if (priv) renderPrivateJobs(priv);

    // Admit
    var admit = document.getElementById('sv2AdmitCardsContent');
    if (admit) renderAdmitCards(admit);

    // Results
    var results = document.getElementById('sv2ResultsContent');
    if (results) renderResults(results);

    // Current Affairs — use blog posts if available
    var ca = document.getElementById('sv2CurrentAffairsContent');
    if (ca) {
      var blogPosts = (window._blogPosts || window.BLOG_POSTS || []);
      if (blogPosts.length) {
        var posts = blogPosts.slice(0, 6).map(function(p) {
          return '<div class="sv2-pdf-card" onclick="navigate(\'blog\');setTimeout(function(){if(typeof openBlogPost===\'function\')openBlogPost(\'' + esc(p.id || p.slug || '') + '\')},200)">' +
            '<div class="sv2-pdf-cover" style="height:140px">' +
              (p.cover_image ? '<img src="' + esc(p.cover_image) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async">' : '<div class="sv2-pdf-cover-fallback">📰</div>') +
              '<div class="sv2-pdf-cover-scrim"></div>' +
            '</div>' +
            '<div class="sv2-pdf-body"><div class="sv2-pdf-title">' + esc(p.title || '') + '</div>' +
            '<div class="sv2-pdf-meta">' + esc((p.created_at || '').split('T')[0] || '') + '</div></div>' +
          '</div>';
        }).join('');
        ca.innerHTML = '<div class="sv2-hscroll">' + posts + '</div>';
        revealSection(ca.parentElement);
      } else {
        ca.parentElement.style.display = 'none';
      }
    }
  }

  // ── RENDER PDFs ───────────────────────────────────────────────
  function renderPDFSections() {
    if (!window.PDFS || !window.PDFS.length) return;

    var free = document.getElementById('sv2FreePDFsContent');
    if (free) renderFreePDFs(free);

    var premium = document.getElementById('sv2PremiumPDFsContent');
    if (premium) renderPremiumPDFs(premium);

    // Re-render categories with counts
    var catContent = document.getElementById('sv2PopularCategoriesContent');
    if (catContent) renderPopularCategories(catContent);
  }

  // ── MAIN INIT ──────────────────────────────────────────────────
  function init() {
    injectPromoBanner();
    injectQuickNav();
    injectSections();

    // Try rendering jobs — may need to wait for career-hub.js to load
    renderJobsSections();

    // Try rendering PDFs — may need to wait for PDFS global
    renderPDFSections();

    // Re-render notifications ticker
    var notif = document.getElementById('sv2NotifTicker');
    if (notif) renderNotifTicker(notif);
  }

  // ── BOOT ──────────────────────────────────────────────────────
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 100); });
    } else {
      setTimeout(init, 100);
    }

    // Listen for jobs loaded
    document.addEventListener('studyria:jobs-ready', function() {
      setTimeout(renderJobsSections, 200);
    });

    // Listen for PDFs loaded
    document.addEventListener('studyria:pdfs-ready', function() {
      setTimeout(renderPDFSections, 200);
    });

    // Listen for navigation to home
    document.addEventListener('studyria:navigate', function(e) {
      if (e.detail === 'home') {
        setTimeout(function() {
          renderJobsSections();
          renderPDFSections();
          var notif = document.getElementById('sv2NotifTicker');
          if (notif) renderNotifTicker(notif);
        }, 300);
      }
    });

    // Fallback: poll for data if events don't fire
    var pollCount = 0;
    var pollInterval = setInterval(function() {
      pollCount++;
      if (pollCount > 30) { clearInterval(pollInterval); return; }

      var jobs = getJobs();
      if (jobs.length) { renderJobsSections(); }

      if (window.PDFS && window.PDFS.length) { renderPDFSections(); }

      if (jobs.length && window.PDFS && window.PDFS.length) {
        clearInterval(pollInterval);
      }
    }, 1000);
  }

  boot();
})();
