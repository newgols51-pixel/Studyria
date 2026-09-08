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
    'leaderboard':  { sec: 'bl-sec-leaderboard',   label: 'Leaderboard',  icon: '🏆' }
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
    { p: 'leaderboard', label: '🏆 Leaderboard' }, { h: 'bl-sec-streak', label: '🔥 Streak' },
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

    /* dashboard preview grid FIRST — spec §7 flow: Hero → Stats → Quick Access (Arena banner + module directory) → personal sections */
    var dash = document.createElement('div');
    dash.id = 'blv8-dashboard';
    home.appendChild(dash);
    /* then the personal sections (keep visual order) */
    HOME_SECS.forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) home.appendChild(sec);
    });
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
    var m = (location.hash || '').match(/^#brainlab\/([a-z-]+)/);
    if (m && P.PAGES[m[1]]) { P.show(m[1], false); return true; }
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
})();
