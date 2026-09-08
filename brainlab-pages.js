/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA BRAINLAB — V8 MODULAR PAGES (Dashboard + dedicated module routes)
   Additive layer. Loaded LAST (after brainlab.js, brainlab-ext.js, arena.js,
   brainlab-v7.js). No existing system is deleted, duplicated or rebuilt —
   the existing bl-sec-* sections are MOVED (DOM appendChild, handlers and
   rendered content preserved) into dedicated page wrappers inside the
   existing #page-brainlab. Routes: #brainlab/<module> (hash sub-routing on
   top of the existing SPA router — one surgical normalization inside
   navigate() in index.html; everything else is handled here).

   Pages: home(dashboard) + exams, mocks, quizzes, mcqs, pyq, flashcards,
   affairs, mistakes, arena, performance, leaderboard. Daily Challenge,
   Continue Learning, Recommended, Streak and Tools remain on Home by
   design (spec §12/§17/§22/§23); their nav pills route Home + scroll.

   STRICT: no fake data anywhere; previews show only real counts/rows;
   empty states are honest. Lazy rendering: Home renders only Home modules;
   each module renders when its page is first opened (spec §20).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var P = {}; /* public API → window.BrainLabPages */
  var B = function () { return window.BrainLab; };

  /* module → section id + nav label + icon */
  P.PAGES = {
    'exams':        { sec: 'bl-sec-exams',        label: 'Exams',        icon: '🎯' },
    'mock-tests':   { sec: 'bl-sec-mocks',        label: 'Mock Tests',   icon: '📝' },
    'quizzes':      { sec: 'bl-sec-quizzes',      label: 'Quizzes',      icon: '🧩' },
    'mcqs':         { sec: 'bl-sec-mcqs',         label: 'MCQs',         icon: '📋' },
    'pyq':          { sec: 'bl-sec-pyq',          label: 'PYQ',          icon: '📚' },
    'flashcards':   { sec: 'bl-sec-flashcards',   label: 'Flashcards',   icon: '🎴' },
    'current-affairs': { sec: 'bl-sec-affairs',    label: 'Current Affairs', icon: '📰' },
    'mistakes':     { sec: 'bl-sec-mistakes',      label: 'Mistakes',     icon: '🎯' },
    'arena':        { sec: 'bl-sec-arena',         label: 'Arena',        icon: '⚔' },
    'performance':  { sec: 'bl-sec-performance',   label: 'Performance',  icon: '📊' },
    'leaderboard':  { sec: 'bl-sec-leaderboard',   label: 'Leaderboard',  icon: '🏆' },
    'subjects':     { sec: null,                   label: 'Subject-wise',  icon: '📚' }
  };
  /* sections that stay on Home */
  var HOME_SECS = ['bl-sec-continue', 'bl-sec-challenge', 'bl-sec-recommended', 'bl-sec-streak', 'bl-sec-tools'];
  /* nav order: page pills + home-scroll pills */
  var NAV = [
    { p: 'exams', label: '🎯 Exams' }, { h: 'bl-sec-challenge', label: '⚡ Daily' },
    { h: 'bl-sec-continue', label: '📚 Continue' }, { p: 'mock-tests', label: '📝 Mock Tests' },
    { p: 'quizzes', label: '🧩 Quizzes' }, { p: 'mcqs', label: '📋 MCQs' },
    { p: 'pyq', label: '📚 PYQ' }, { p: 'flashcards', label: '🎴 Flashcards' },
    { p: 'current-affairs', label: '📰 Affairs' }, { p: 'mistakes', label: '🎯 Mistakes' },
    { p: 'arena', label: '⚔ Arena' }, { p: 'performance', label: '📊 Performance' },
    { p: 'leaderboard', label: '🏆 Leaderboard' }, { p: 'subjects', label: '📚 Subjects' }, { h: 'bl-sec-streak', label: '🔥 Streak' },
    { h: 'bl-sec-tools', label: '🛠 Tools' }
  ];

  var booted = false;
  var current = 'home';

  function esc(s) { var bl = B(); return bl ? bl.escape(s) : String(s); }

  /* ── renderers for each module page (called every open — always fresh) ── */
  function renderersFor(page) {
    var bl = B(); if (!bl) return [];
    var v7 = window.BrainLabV7 || {};
    var fn = function (name) { return function () { return bl[name](); }; };
    switch (page) {
      case 'exams':        return [v7.renderExamHub];
      case 'mock-tests':   return [fn('renderMockTests'), P.renderMockFilters];
      case 'quizzes':      return [fn('renderQuizzes')];
      case 'mcqs':         return [fn('renderMCQs'), P.renderPracticeModes];
      case 'pyq':          return [fn('renderPYQ')];
      case 'flashcards':   return [fn('renderFlashcardDecks')];
      case 'current-affairs': return [fn('renderCurrentAffairs')];
      case 'mistakes':     return [fn('renderMistakes')];
      case 'arena':        return [fn('renderPracticeArena')];
      case 'performance':  return [fn('renderPerformance'), P.renderTrend];
      case 'leaderboard':  return [fn('renderLeaderboard')];
      case 'subjects':     return [P.renderSubjects];
      default:             return [];
    }
  }

  /* ── build wrappers + MOVE existing sections (DOM move, no rebuild) ── */
  function buildWrappers() {
    var pageEl = document.getElementById('page-brainlab');
    if (!pageEl || document.getElementById('blv8-home')) return;
    var container = pageEl.querySelector('.bl-container');
    if (!container) return;

    /* Home wrapper: holds the sections that stay + dashboard grid */
    var home = document.createElement('div');
    home.id = 'blv8-home'; home.className = 'blv8-page';
    var playerArea = document.getElementById('bl-quiz-player-area');
    if (playerArea) container.insertBefore(home, playerArea);
    else container.appendChild(home);

    /* module wrappers */
    Object.keys(P.PAGES).forEach(function (key) {
      var w = document.createElement('div');
      w.id = 'blv8-' + key; w.className = 'blv8-page';
      w.setAttribute('data-p', key);
      var m = P.PAGES[key];
      w.innerHTML = '<div class="blv8-crumb"><button class="blv8-back" onclick="BrainLabPages.go(\'home\')" aria-label="Back to BrainLab">← BrainLab</button><span class="blv8-crumb-title">' + m.icon + ' ' + m.label + '</span></div>';
      if (playerArea) container.insertBefore(w, playerArea);
      else container.appendChild(w);
      var sec = document.getElementById(m.sec);
      if (sec) w.appendChild(sec); /* DOM MOVE — content & handlers preserved */
    });

    /* feature quick-access strip (existing .bl-nav) sits DIRECTLY below the hero — Part 2 */
    var statsEl = document.getElementById('bl-stats');
    var navWrap = document.querySelector('.bl-nav-wrap');
    if (statsEl && navWrap && statsEl.parentNode === navWrap.parentNode) statsEl.parentNode.insertBefore(navWrap, statsEl);
    /* personal sections first (Part 5 flow: Hero → Strip → Stats → personal…) */
    HOME_SECS.forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) home.appendChild(sec);
    });
    /* …then the module directory dashboard (Arena banner + Learning Modules + subjects preview) */
    var dash = document.createElement('div');
    dash.id = 'blv8-dashboard';
    home.appendChild(dash);
    /* …then the Why Studyria BrainLab section */
    var why = document.createElement('div');
    why.id = 'blv8-why';
    home.appendChild(why);
  }

  /* ── lazy renderAll override: Home renders Home only (spec §20) ── */
  function wrapRenderAll() {
    var bl = B(); if (!bl || bl.__blv8Wrapped) return;
    bl.__blv8Wrapped = true;
    var origAll = bl.renderAll; /* v7-wrapped — kept as reference, not called at init */
    bl.renderAll = function () {
      /* Home modules only — module pages render on first open */
      try { bl.renderStats(); } catch (e) { }
      try { bl.renderContinueLearning(); } catch (e) { }
      try { bl.renderDailyChallenge(); } catch (e) { }
      try { bl.renderStudyStreak(); } catch (e) { }
      try { bl.renderStudyTools(); } catch (e) { }
      try { if (window.BrainLabV7) window.BrainLabV7.renderRecommended(); } catch (e) { }
      try { P.renderDashboard(); } catch (e) { }
      try { P.renderWhy(); } catch (e) { }
    };
  }

  /* ── scrollToSection override so legacy CTAs work across pages ── */
  function wrapScroll() {
    var bl = B(); if (!bl || bl.__blv8ScrollWrapped) return;
    bl.__blv8ScrollWrapped = true;
    bl.scrollToSection = function (id) {
      var sec = document.getElementById(id); if (!sec) return;
      var wrap = sec.closest ? sec.closest('.blv8-page') : null;
      if (wrap) { var p = wrap.getAttribute('data-p') || 'home'; if (p !== P.currentView()) P.show(p, false); }
      setTimeout(function () { var e2 = document.getElementById(id); if (e2) e2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
    };
  }

  /* ── rebuild nav pills as page links (fresh elements, old listeners gone) ── */
  function buildNav() {
    var wrap = document.querySelector('#page-brainlab .bl-nav');
    if (!wrap) return;
    wrap.innerHTML = '';
    NAV.forEach(function (item) {
      var a = document.createElement('a');
      a.className = 'bl-nav-item';
      a.textContent = item.label;
      if (item.p) { a.setAttribute('data-page', item.p); a.href = '#brainlab/' + item.p; }
      else { a.setAttribute('data-home', item.h); a.href = 'javascript:void(0)'; }
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (item.p) P.go(item.p);
        else { P.go('home'); setTimeout(function () { var s = document.getElementById(item.h); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); }
      });
      wrap.appendChild(a);
    });
    P.syncNav();
  }

  /* ── view switching ── */
  P.currentView = function () { return current; };

  P.show = function (page, push) {
    if (!P.PAGES[page] && page !== 'home') page = 'home';
    current = page;
    document.querySelectorAll('#page-brainlab .blv8-page').forEach(function (w) {
      w.classList.toggle('on', (page === 'home' ? w.id === 'blv8-home' : w.id === 'blv8-' + page));
    });
    /* first-open render of module pages (always fresh data) */
    if (P.PAGES[page]) renderersFor(page).forEach(function (fn) { try { fn && fn(); } catch (e) { } });
    if (page === 'home') { try { B().renderStats(); } catch (e) { } }
    P.syncNav();
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (push !== false && page !== 'home') {
      if (history.pushState) history.pushState({ page: 'brainlab' }, '', '#brainlab/' + page);
    }
  };

  P.go = function (page) {
    if (page === 'home') {
      if (history.pushState) history.pushState({ page: 'brainlab' }, '', '#brainlab');
      P.show('home', false);
      return;
    }
    P.show(page, true);
  };

  P.syncNav = function () {
    document.querySelectorAll('#page-brainlab .bl-nav-item').forEach(function (a) {
      var dp = a.getAttribute('data-page');
      a.classList.toggle('active', !!(dp && dp === current));
    });
  };

  /* sync view from URL hash — used after navigate()/popstate */
  P.syncFromHash = function () {
    var m = (location.hash || '').match(/^#brainlab\/([a-z-]+)(?:\/([a-z0-9-]+))?/);
    if (m && P.PAGES[m[1]]) { P.show(m[1], false); if (m[1] === 'subjects' && m[2]) P.openSubject(m[2], false); return true; }
    if (window._blPendingSub && P.PAGES[window._blPendingSub]) { var s = window._blPendingSub; window._blPendingSub = null; P.show(s, false); return true; }
    window._blPendingSub = null;
    if (current !== 'home') P.show('home', false);
    return false;
  };

  /* ═══════════ HOME DASHBOARD PREVIEWS (real data only) ═══════════ */
  P.renderDashboard = function () {
    var d = document.getElementById('blv8-dashboard');
    var bl = B(); if (!d || !bl) return;
    var QB = window.STUDYRIA_QB || [];
    var v7 = window.BrainLabV7 || {};
    var st = { tests: bl.getSessions().length, mistakes: (bl.getMistakes() || []).length };
    var qbN = QB.length;
    var pyqN = QB.filter(function (q) { return q[17] === 'PYQ'; }).length;
    var decks = (bl.getTopics('All') || []).filter(function (t) { return bl.countByTopic('All', t) >= 5; }).length;

    var card = function (icon, title, stat, cta, onclick) {
      return '<div class="blv8-card"><div class="blv8-card-head"><span class="blv8-card-icon">' + icon + '</span><span class="blv8-card-title">' + title + '</span></div>'
        + '<div class="blv8-card-stat">' + stat + '</div>'
        + '<button class="blv8-card-cta" onclick="' + onclick + '">' + cta + '</button></div>';
    };

    /* Arena hero banner — real modes from the SA array (brainlab.js), no fake stats */
    var arenaModes = window.BL_ARENA_MODES || window.SA || [];
    var banner = '<div class="blv8-arena-banner">'
      + '<div class="blv8-arena-banner-head"><span class="blv8-arena-banner-emoji">⚔️</span>'
      + '<div><div class="blv8-arena-banner-title">Practice Arena</div>'
      + '<div class="blv8-arena-banner-sub">Real-time quiz battles — 1v1, teams, free-for-all</div></div>'
      + '<button class="blv8-arena-banner-cta" onclick="BrainLabPages.go(\'arena\')">ENTER ARENA</button></div>'
      + '<div class="blv8-arena-modes">'
      + arenaModes.map(function (m) {
          return '<button class="blv8-arena-mode" onclick="BrainLab.startArenaMode(\'' + m.mode + '\')">'
            + '<span class="blv8-arena-mode-ic">' + m.icon + '</span>'
            + '<span class="blv8-arena-mode-t">' + m.title + '</span>'
            + '<span class="blv8-arena-mode-s">' + m.sub + '</span></button>';
        }).join('')
      + '</div></div>';

    var h = banner + '<div class="bl-section-header"><h2 class="bl-section-title">🧭 Learning Modules</h2><span class="bl-section-sub">Open any module for the full experience</span></div>';
    h += '<div class="blv8-grid">';
    h += card('🎯', 'Exams', v7.EXAM_HUB ? v7.EXAM_HUB.length + ' exam tracks — ADRE, APSC, Police, TET…' : 'Exam tracks', 'OPEN', "BrainLabPages.go('exams')");
    h += card('📝', 'Mock Tests', '9 exam-style mocks · timed · instant results', 'VIEW ALL MOCK TESTS', "BrainLabPages.go('mock-tests')");
    h += card('🧩', 'Quizzes', (bl.getCategories ? (bl.getCategories() || []).length : 12) + ' quiz categories, topic-wise', 'OPEN', "BrainLabPages.go('quizzes')");
    h += card('📋', 'MCQ Practice', qbN.toLocaleString() + ' practice questions', 'OPEN PRACTICE', "BrainLabPages.go('mcqs')");
    h += card('📚', 'PYQ', pyqN > 0 ? pyqN + ' previous year questions' : 'PYQ bank is being expanded', 'OPEN', "BrainLabPages.go('pyq')");
    h += card('🎴', 'Flashcards', decks + ' topic decks · flip & learn', 'OPEN', "BrainLabPages.go('flashcards')");
    h += card('📰', 'Current Affairs', '<span id="blv8-affair-preview">Loading latest update…</span>', 'READ FULL AFFAIRS', "BrainLabPages.go('current-affairs')");
    h += card('🎯', 'Mistakes', st.mistakes > 0 ? st.mistakes + ' questions need revision' : 'No mistakes recorded yet', st.mistakes > 0 ? 'REVIEW MISTAKES' : 'OPEN', "BrainLabPages.go('mistakes')");
    h += card('⚔', 'Arena', 'Real-time quiz battles — 1v1, teams, free-for-all', 'ENTER ARENA', "BrainLabPages.go('arena')");
    h += card('📊', 'Performance', st.tests > 0 ? st.tests + ' tests completed — view your trends' : 'Take a test to unlock analytics', 'VIEW ANALYTICS', "BrainLabPages.go('performance')");
    h += card('🏆', 'Leaderboard', bl.user() ? 'Your rank among Studyria learners' : 'Sign in to compete with real learners', 'VIEW LEADERBOARD', "BrainLabPages.go('leaderboard')");
    h += card('📚', 'Subject-wise Practice', (bl.getCategories() || []).length + ' subjects — pick one and focus your preparation', 'EXPLORE SUBJECTS', "BrainLabPages.go('subjects')");
    h += '</div>';
    d.innerHTML = h;

    /* latest affair preview — real single query, honest empty state */
    var cl = bl.client();
    var slot = document.getElementById('blv8-affair-preview');
    if (cl && slot) {
      cl.from('current_affairs').select('title').eq('is_deleted', false).eq('status', 'published').order('created_at', { ascending: false }).limit(1)
        .then(function (r) {
          var el = document.getElementById('blv8-affair-preview');
          if (!el) return;
          el.textContent = (r && r.data && r.data.length) ? 'Latest: ' + String(r.data[0].title).slice(0, 70) : 'Published updates appear here';
        }).catch(function () {
          var el = document.getElementById('blv8-affair-preview');
          if (el) el.textContent = 'Published updates appear here';
        });
    } else if (slot) slot.textContent = 'Published updates appear here';
  };

  /* ═══════════ MOCK TESTS PAGE: search + exam filter (real fields only) ═══════════ */
  P.renderMockFilters = function () {
    var sec = document.getElementById('bl-sec-mocks'); if (!sec) return;
    if (sec.querySelector('.blv8-mock-bar')) return;
    var bl = B();
    var mocks = window.SM || [];
    var exams = []; mocks.forEach(function (m) { if (exams.indexOf(m.exam) === -1) exams.push(m.exam); });
    var bar = document.createElement('div');
    bar.className = 'blv8-mock-bar';
    bar.innerHTML = '<input class="blv8-search" type="search" placeholder="Search mock tests…" aria-label="Search mock tests">'
      + '<div class="blv8-chips"><button class="blv8-chip on" data-exam="">All</button>'
      + exams.map(function (e) { return '<button class="blv8-chip" data-exam="' + esc(e) + '">' + esc(e) + '</button>'; }).join('')
      + '</div>';
    sec.insertBefore(bar, sec.firstChild);
    var search = bar.querySelector('.blv8-search');
    var chips = bar.querySelectorAll('.blv8-chip');
    function apply() {
      var q = (search.value || '').toLowerCase().trim();
      var ex = bar.querySelector('.blv8-chip.on');
      ex = ex ? ex.getAttribute('data-exam') : '';
      var cards = sec.querySelectorAll('#bl-mocks .bl-card');
      cards.forEach(function (c) {
        var t = c.textContent.toLowerCase();
        var okQ = !q || t.indexOf(q) !== -1;
        var okE = !ex || t.indexOf(ex.toLowerCase()) !== -1;
        c.style.display = (okQ && okE) ? '' : 'none';
      });
    }
    search.addEventListener('input', apply);
    chips.forEach(function (ch) {
      ch.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.remove('on'); });
        ch.classList.add('on');
        apply();
      });
    });
  };

  /* ═══════════ MCQ PAGE: practice modes (Quick 10…100, Random, Weak, Wrong) ═══════════ */
  P.renderPracticeModes = function () {
    var sec = document.getElementById('bl-sec-mcqs'); if (!sec) return;
    var old = document.getElementById('blv8-practice-modes');
    if (old) old.remove();
    var bl = B();
    var modes = [
      { icon: '⚡', t: 'Quick 10', s: 'Approx. 5 minutes', a: "BrainLab.startArenaMode('quick10')" },
      { icon: '🔥', t: 'Quick 25', s: 'Approx. 10–15 minutes', a: "BrainLab.startArenaMode('quick25')" },
      { icon: '💪', t: 'Quick 50', s: 'Approx. 25–35 minutes', a: "BrainLab.startArenaMode('quick50')" },
      { icon: '🚀', t: 'Quick 100', s: 'Marathon round', a: "BrainLab.startQuizSession({mode:'custom',title:'Quick 100',questions:100})" },
      { icon: '🎲', t: 'Random', s: 'Surprise mix', a: "BrainLab.startArenaMode('random')" },
      { icon: '🎯', t: 'Weak Topics', s: 'Practice what you miss', a: 'BrainLabPages.startWeakPractice()' },
      { icon: '❌', t: 'Previously Wrong', s: 'Retry your mistake book', a: 'BrainLab.retryMistakes()' }
    ];
    var h = '<div id="blv8-practice-modes" class="blv8-pmodes"><h3>⚡ Quick Practice</h3><div class="blv8-pgrid">';
    modes.forEach(function (m) {
      h += '<div class="blv8-pcard" onclick="' + m.a + '"><span class="blv8-picon">' + m.icon + '</span><span class="blv8-pt">' + m.t + '</span><span class="blv8-ps">' + m.s + '</span></div>';
    });
    h += '</div></div>';
    var body = sec.querySelector('#bl-mcqs');
    if (body) body.insertAdjacentHTML('beforebegin', h);
    else sec.insertAdjacentHTML('afterbegin', h);
  };

  P.startWeakPractice = function () {
    var bl = B();
    var weak = null, lo = 101, tot = 0, cor = 0;
    var perf = {};
    bl.getSessions().forEach(function (s) {
      var k = s.category || 'General';
      if (!perf[k]) perf[k] = { t: 0, c: 0 };
      perf[k].t += s.total_questions || 0; perf[k].c += s.correct_count || 0;
    });
    Object.keys(perf).forEach(function (k) {
      if (perf[k].t >= 5) {
        var pct = Math.round((perf[k].c / perf[k].t) * 100);
        if (pct < lo) { lo = pct; weak = k; }
      }
    });
    if (!weak) { bl.toast('Take a few tests first — weak topics appear after real activity.'); return; }
    bl.startQuizSession({ mode: 'weak', title: weak + ' — Weak Area Practice', questions: 10, category: weak });
  };

  /* ═══════════ PERFORMANCE PAGE: score trend (real session history) ═══════════ */
  P.renderTrend = function () {
    var sec = document.getElementById('bl-sec-performance'); if (!sec) return;
    var old = document.getElementById('blv8-trend');
    if (old) old.remove();
    var bl = B();
    var s = bl.getSessions().slice(-12);
    var h = '<div id="blv8-trend" class="blv8-trend">';
    if (s.length >= 2) {
      h += '<h3>📈 Score Trend (recent tests)</h3><div class="blv8-trend-bars">';
      var mx = 100;
      s.forEach(function (x, i) {
        var v = x.score || 0;
        h += '<div class="blv8-tbar" title="' + esc(x.title || 'Test') + ' — ' + v + '%"><span style="height:' + Math.max(6, v) + '%"></span><em>' + (i === s.length - 1 ? 'now' : (i + 1)) + '</em></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="bl-v7-sw-empty" style="padding:8px 2px">Complete at least 2 tests to unlock your score trend.</div>';
    }
    h += '</div>';
    var body = sec.querySelector('#bl-performance');
    if (body) body.insertAdjacentHTML('beforebegin', h);
    else sec.insertAdjacentHTML('afterbegin', h);
  };

  /* ═══════════ BOOT ═══════════ */
  P.boot = function () {
    if (booted) return;
    if (!document.getElementById('page-brainlab')) return;
    booted = true;

    buildWrappers();
    wrapRenderAll();
    wrapScroll();
    buildNav();

    /* setupNav override — init() must bind OUR nav, not the scroll nav */
    var bl = B();
    if (bl) bl.setupNav = function () { buildNav(); };

    /* if BrainLab already initialized (direct brainlab re-entry), re-render home */
    if (bl && bl.initialized) { bl.renderAll(); }

    P.show('home', false);

    /* wrap window.navigate: after every brainlab navigation, sync view from hash */
    var _nav = window.navigate;
    if (typeof _nav === 'function' && !_nav.__blv8) {
      var wrapped = function (page) {
        var r = _nav(page);
        if (typeof r !== 'undefined' && r !== null && typeof r.then === 'function') {
          r.then(function () { try { if (window.currentPage === 'brainlab') P.syncFromHash(); } catch (e) { } });
        } else {
          setTimeout(function () { try { if (window.currentPage === 'brainlab') P.syncFromHash(); } catch (e) { } }, 300);
        }
        return r;
      };
      wrapped.__blv8 = true;
      window.navigate = wrapped;
    }
    /* popstate: browser back/forward inside brainlab sub-routes */
    window.addEventListener('popstate', function () {
      setTimeout(function () { try { if (window.currentPage === 'brainlab') P.syncFromHash(); } catch (e) { } }, 60);
    });
    /* hashchange: manual URL edits / scripted hash jumps inside brainlab */
    window.addEventListener('hashchange', function () {
      try { if (window.currentPage === 'brainlab') P.syncFromHash(); } catch (e) { }
    });
    /* deep-link handled here too (navigate normalization sets _blPendingSub) */
    setTimeout(function () { try { if (window.currentPage === 'brainlab') P.syncFromHash(); } catch (e) { } }, 400);
  };

  window.BrainLabPages = P;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', P.boot);
  else P.boot();
  var _iv = setInterval(function () {
    if (document.getElementById('page-brainlab') && window.BrainLab) { P.boot(); clearInterval(_iv); }
  }, 800);
  setTimeout(function () { clearInterval(_iv); }, 30000);


/* ═══════════ WHY STUDYRIA BRAINLAB (Part 1 — all claims are real shipped features) ═══════════ */
P.renderWhy = function () {
  var d = document.getElementById('blv8-why'); if (!d) return;
  if (d.getAttribute('data-done')) return; d.setAttribute('data-done', '1');
  var pts = [
    ['🎯', 'Exam-Focused Practice', 'Practice built around Assam competitive exams — ADRE, APSC, Police, TET and more.'],
    ['🧩', 'Practice Your Weak Areas', 'Your real activity powers the Mistakes bank and Weak-Topics practice so revision targets what you actually got wrong.'],
    ['⚡', 'Daily Practice That Builds Habits', 'Daily challenges, quick practice modes and streaks keep your preparation consistent.'],
    ['📝', 'Real Test Experience', 'Timed mock tests with exam-style palettes, auto-submit and instant scoring — practise like the real exam.'],
    ['📚', 'One Place for Every Practice Mode', 'Quizzes, MCQs, PYQs, Mock Tests, Flashcards and Current Affairs in one connected system.'],
    ['📊', 'Know Your Performance', 'Accuracy, score trends, subject strength and weak areas — all from your real attempts.'],
    ['🔥', 'Streaks, XP & Achievements', 'Turn regular study into measurable progress with streaks, XP and milestone achievements.'],
    ['⚔️', 'Compete & Improve', 'Practice Arena battles and the real leaderboard create healthy competition among learners.'],
    ['📰', 'Stay Exam-Ready', 'Current Affairs quizzes and exam-focused practice keep you updated for the latest pattern.'],
    ['🧠', 'Personalized Learning', 'Recommended For You is built from your real sessions — BrainLab gets more useful the more you practise.']
  ];
  var h = '<div class="bl-section-header"><h2 class="bl-section-title">✨ Why Studyria BrainLab</h2><span class="bl-section-sub">Everything you need to practise smarter, track your progress, and prepare with confidence.</span></div>';
  h += '<div class="blv8-why-grid">';
  pts.forEach(function (p) {
    h += '<div class="blv8-why-card"><span class="blv8-why-ic">' + p[0] + '</span><div><div class="blv8-why-t">' + p[1] + '</div><div class="blv8-why-s">' + p[2] + '</div></div></div>';
  });
  h += '</div>';
  d.innerHTML = h;
};

/* ═══════════ SUBJECT-WISE PRACTICE (Part 3 — real QB data: q[7]=category, q[8]=topic, q[17]=type) ═══════════ */
function subjIcon(name) {
  var map = { assamese: '📖', english: '🔤', hindi: '🪔', mathematics: '🔢', math: '🔢', science: '🔬', history: '📜', geography: '🗺️', polity: '⚖️', economy: '💰', economics: '💰', reasoning: '🧩', computer: '💻', 'general knowledge': '🌐', culture: '🎭', environment: '🌱', 'current affairs': '📰', driving: '🚗' };
  return map[String(name).toLowerCase()] || '📘';
}
function subjSlug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

P.renderSubjects = function () {
  var w = document.getElementById('blv8-subjects'); if (!w) return;
  var bl = B(); if (!bl) return;
  var body = document.getElementById('blv8-subj-body');
  if (!body) { body = document.createElement('div'); body.id = 'blv8-subj-body'; w.appendChild(body); }
  var cats = bl.getCategories() || [];
  P._subjMap = {}; cats.forEach(function (c) { P._subjMap[subjSlug(c)] = c; });

  var h = '<div class="blv8-subj-hero"><div class="blv8-subj-h-title">📚 Subject-wise Practice</div>'
    + '<div class="blv8-subj-h-sub">Focus on one subject at a time. Practise real questions across the exams you are preparing for.</div>'
    + '<div class="blv8-subj-badges">'
    + '<span class="blv8-badge">📚 Subject-wise</span><span class="blv8-badge">🧩 Topic Practice</span>'
    + '<span class="blv8-badge">📊 Performance Tracking</span><span class="blv8-badge">🌐 English + Assamese</span>'
    + '</div>'
    + '<input type="search" class="blv8-subj-search" id="blv8-subj-search" placeholder="Search subjects…" aria-label="Search subjects">'
    + '</div><div class="blv8-subj-list" id="blv8-subj-list"></div>';
  body.innerHTML = h;
  P._renderSubjectList('');
  var inp = document.getElementById('blv8-subj-search');
  if (inp) inp.addEventListener('input', function () { P._renderSubjectList(inp.value); });
};

P._renderSubjectList = function (q) {
  var bl = B(); var list = document.getElementById('blv8-subj-list'); if (!list || !bl) return;
  var cats = bl.getCategories() || [];
  q = String(q || '').toLowerCase().trim();
  var rows = cats.map(function (c) {
    var pyq = bl.filterQuestions({ category: c }).filter(function (r) { return r[17] === 'PYQ'; }).length;
    return { name: c, topics: bl.getTopics(c).length, mcqs: bl.countByTopic(c, 'All'), pyq: pyq };
  });
  if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
  rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!rows.length) { list.innerHTML = '<div class="blv8-empty">No subjects match "' + esc(q) + '".</div>'; return; }
  var h = '';
  rows.forEach(function (r) {
    var sl = subjSlug(r.name);
    h += '<div class="blv8-subj-card" onclick="BrainLabPages.openSubject(\'' + sl + '\', true)">'
      + '<span class="blv8-subj-ic">' + subjIcon(r.name) + '</span>'
      + '<div class="blv8-subj-mid"><div class="blv8-subj-name">' + esc(r.name) + '</div>'
      + '<div class="blv8-subj-counts">' + r.topics + ' topic' + (r.topics === 1 ? '' : 's') + ' · ' + r.mcqs.toLocaleString() + ' MCQs' + (r.pyq ? ' · ' + r.pyq + ' PYQs' : '') + '</div></div>'
      + '<span class="blv8-subj-arrow">›</span></div>';
  });
  list.innerHTML = h;
};

P.openSubject = function (slug, push) {
  var bl = B(); if (!bl) return;
  var name = (P._subjMap || {})[slug];
  if (push !== false) { location.hash = '#brainlab/subjects/' + slug; return; } /* hashchange → syncFromHash → openSubject(slug,false) */
  if (!name) { /* direct URL: build map first */ var cats = bl.getCategories() || []; P._subjMap = {}; cats.forEach(function (c) { P._subjMap[subjSlug(c)] = c; }); name = P._subjMap[slug]; }
  if (!name) { P.renderSubjects(); return; }
  P._curSubjectName = name;
  var body = document.getElementById('blv8-subj-body'); if (!body) { P.renderSubjects(); return; }

  /* real user progress — only the signed-in user's own sessions */
  var sess = (bl.getSessions() || []).filter(function (s) { return s.category === name; });
  var progress = '';
  if (bl.user() && sess.length) {
    var avg = Math.round(sess.reduce(function (a, s) { return a + (s.score || 0); }, 0) / sess.length);
    var last = sess.reduce(function (m, s) { var d = s.completed_at || s.started_at || ''; return d > m ? d : m; }, '');
    progress = '<div class="blv8-subj-me">'
      + '<span>🧾 ' + sess.length + ' test' + (sess.length === 1 ? '' : 's') + ' attempted</span>'
      + '<span>🎯 ' + avg + '% avg accuracy</span>'
      + (last ? '<span>🕘 Last: ' + esc(String(last).slice(0, 10)) + '</span>' : '')
      + '</div>';
  }

  var topics = (bl.getTopics(name) || []).map(function (t) {
    return { cat: name, topic: t, n: bl.countByTopic(name, t) };
  }).sort(function (a, b) { return b.n - a.n; });
  P._subjTopics = topics;

  var h = '<button class="blv8-subj-back" onclick="BrainLabPages.subjectsBack()">← All Subjects</button>'
    + '<div class="blv8-subj-hero"><div class="blv8-subj-h-title">' + subjIcon(name) + ' ' + esc(name) + '</div>'
    + '<div class="blv8-subj-h-sub">' + (bl.countByTopic(name, 'All')).toLocaleString() + ' real questions · ' + topics.length + ' topic' + (topics.length === 1 ? '' : 's') + '</div>'
    + '<div class="blv8-subj-badges"><span class="blv8-badge">🧩 Topic Practice</span><span class="blv8-badge">🌐 English + Assamese</span></div>'
    + '</div>'
    + progress
    + '<button class="blv8-subj-full" onclick="BrainLabPages.startTopicPractice(-1)">▶ Start Full Subject Practice</button>'
    + '<div class="blv8-subj-topics">';
  topics.forEach(function (t, i) {
    h += '<div class="blv8-subj-trow"><div><div class="blv8-subj-name">' + esc(t.topic) + '</div>'
      + '<div class="blv8-subj-counts">' + t.n.toLocaleString() + ' questions</div></div>'
      + '<button class="blv8-card-cta" onclick="BrainLabPages.startTopicPractice(' + i + ')">PRACTICE</button></div>';
  });
  h += '</div>';
  body.innerHTML = h;
  var top = document.getElementById('blv8-subjects');
  if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

P.subjectsBack = function () { location.hash = '#brainlab/subjects'; };
P.startTopicPractice = function (i) {
  var bl = B(); if (!bl) return;
  var t = i === -1 ? { cat: P._curSubjectName || '', topic: 'All' } : (P._subjTopics || [])[i];
  if (!t || !t.cat) return;
  var pool = bl.filterQuestions({ category: t.cat, topic: t.topic });
  if (!pool.length) { bl.toast('No questions available for this selection.'); return; }
  bl.showCountPicker({ title: t.topic === 'All' ? t.cat + ' Practice' : t.topic, category: t.cat, pool: pool, mode: 'quiz' });
};

})();
