/* ════════════════════════════════════════════════════════════════
   brainlab-exams.js — STUDYRIA EXAM UNIVERSE (V8 additive layer)
   ════════════════════════════════════════════════════════════════
   A discovery/organization layer OVER the existing systems:
   • Test/Mock/PYQ/MCQ engines → existing BrainLab (incl. v7 + mock engine)
   • Study PDFs / Question Papers → existing Library/PDF system,
     access via canonical openDetail(id) — checkout/ownership untouched
   • Current Affairs → existing V7.startAffairsQuiz + affairs page
   • Progress/Continue → user's OWN bl_sessions only
   • No new data model. No new admin. No backend/DB/auth changes.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function B() { return window.BrainLab; }
  function V7() { return window.BrainLabV7 || {}; }
  var U = window.BrainLabUniverse = { _q: '' };

  function esc(s) { var bl = B(); return bl ? bl.escape(s) : String(s == null ? '' : s); }

  /* exam → filterQuestions exam key (existing EXAM_TOPICS keys) */
  function examKey(id) {
    return { adre: 'ADRE', adre4: 'ADRE', apsc: 'APSC', police: 'Assam Police', tet: 'Assam TET', ssc: 'SSC', dhs: 'General', other: 'General' }[id] || 'General';
  }
  /* exam → matching terms for REAL PDF metadata (category/tag/title) */
  function examTerms(id) {
    return { adre: ['adre'], adre4: ['adre'], apsc: ['apsc'], police: ['assam police', 'police'], tet: ['assam tet', 'tet'], ssc: ['ssc'], dhs: ['dhs'], other: [] }[id] || [];
  }
  function hub() { return (V7().EXAM_HUB || []); }
  function findExam(id) { return hub().filter(function (e) { return e.id === id; })[0]; }

  /* real question/PYQ counts via the v7 exam→subject mapping */
  function examQuestions(e) { return (V7().examCount ? V7().examCount(e.subjects) : 0); }
  function examPYQs(e) {
    var QB = window.STUDYRIA_QB || [], seen = {}, n = 0;
    QB.forEach(function (q) {
      var key = String(String(q[0]).slice(0, 60) + q[5]);
      if (seen[key]) return;
      if (q[17] === 'PYQ' && (e.subjects.indexOf(q[7]) !== -1 || e.subjects.indexOf(q[8]) !== -1)) { seen[key] = 1; n++; }
    });
    return n;
  }
  function examMock(id) {
    var want = { adre: 'ADRE', adre4: 'ADRE', apsc: 'APSC', police: 'Assam Police', tet: 'Assam TET', ssc: 'SSC' }[id];
    return (window.SM || []).filter(function (m) { return m.exam === want; })[0] || null;
  }
  function examPDFs(e) {
    var terms = examTerms(e.id); if (!terms.length) return [];
    var pdfs = (window.PDFS || []).filter(function (p) { return p && p.title; });
    var hay = function (p) { return [p.category, p.tag, p.subcategory, p.title].join(' ').toLowerCase(); };
    var out = pdfs.filter(function (p) {
      var h = hay(p);
      return terms.some(function (t) { return h.indexOf(t) !== -1; });
    });
    return out;
  }
  function owned(id) { return !!(window._ownedPdfIds && window._ownedPdfIds.has && window._ownedPdfIds.has(String(id))); }
  function fmtPrice(p) { return (p && p.free) ? 'FREE' : (p && p.price ? '₹' + p.price : ''); }

  /* ── user's OWN sessions for an exam ── */
  function examSessions(e) {
    var bl = B(); if (!bl) return [];
    var key = examKey(e.id);
    return (bl.getSessions() || []).filter(function (s) { return s.exam === key; });
  }

  /* ═════════ LANDING — #brainlab/exams ═════════ */
  U.renderLanding = function () {
    var c = document.getElementById('bl-sec-exams-body'); if (!c) return;
    var QB = window.STUDYRIA_QB || [];
    var pyqAll = 0; var seen = {};
    QB.forEach(function (q) { var k = String(String(q[0]).slice(0, 60) + q[5]); if (!seen[k]) { seen[k] = 1; if (q[17] === 'PYQ') pyqAll++; } });
    var stats = [
      ['🎯', 'Exams', hub().length],
      ['📝', 'Mock Tests', (window.SM || []).length],
      ['🧩', 'Questions', seen ? Object.keys(seen).length : 0],
      ['📚', 'PYQs', pyqAll]
    ];
    var pdfN = (window.PDFS || []).filter(function (p) { return p && p.title; }).length;
    if (pdfN) stats.push(['📄', 'Study PDFs', pdfN]);

    var h = '<div class="bl-eu-hero"><div class="bl-eu-h-title">🎯 Exam Universe</div>'
      + '<div class="bl-eu-h-sub">Everything you need to prepare for your exam — tests, PYQs, papers, practice and study resources in one place.</div>'
      + '<div class="bl-eu-stats">';
    stats.forEach(function (s) { h += '<div class="bl-eu-stat"><span class="bl-eu-stat-ic">' + s[0] + '</span><span class="bl-eu-stat-n">' + s[2].toLocaleString() + '</span><span class="bl-eu-stat-l">' + s[1] + '</span></div>'; });
    h += '</div>'
      + '<input type="search" class="bl-eu-search" id="bl-eu-search" placeholder="Search exams…" aria-label="Search exams">'
      + '</div><div class="bl-eu-grid" id="bl-eu-grid"></div>';
    c.innerHTML = h;
    U._renderGrid('');
    var inp = document.getElementById('bl-eu-search');
    if (inp) inp.addEventListener('input', function () { U._renderGrid(inp.value); });
  };

  U._renderGrid = function (q) {
    var g = document.getElementById('bl-eu-grid'); if (!g) return;
    q = String(q || '').toLowerCase().trim();
    var rows = hub().map(function (e) {
      return { e: e, n: examQuestions(e), pyq: examPYQs(e), mock: !!examMock(e.id), pdfs: examPDFs(e).length };
    });
    if (q) rows = rows.filter(function (r) { return (r.e.name + ' ' + r.e.desc + ' ' + r.e.subjects.join(' ')).toLowerCase().indexOf(q) !== -1; });
    if (!rows.length) { g.innerHTML = '<div class="bl-eu-empty">No exams match “' + esc(q) + '”.</div>'; return; }
    var h = '';
    rows.sort(function (a, b) { return b.n - a.n; }).forEach(function (r) {
      var e = r.e;
      h += '<div class="bl-eu-card" onclick="BrainLabUniverse.openExam(\'' + e.id + '\', true)">'
        + '<div class="bl-eu-card-top"><span class="bl-eu-card-ic">🎯</span><div><div class="bl-eu-card-name">' + esc(e.name) + '</div>'
        + '<div class="bl-eu-card-desc">' + esc(e.desc) + '</div></div><span class="bl-eu-arrow">›</span></div>'
        + '<div class="bl-eu-card-stats"><span>' + r.n.toLocaleString() + ' questions</span>'
        + (r.pyq ? '<span>' + r.pyq + ' PYQs</span>' : '')
        + (r.mock ? '<span>Mock test</span>' : '')
        + (r.pdfs ? '<span>' + r.pdfs + ' PDF' + (r.pdfs === 1 ? '' : 's') + '</span>' : '')
        + '</div><div class="bl-eu-card-sub">' + esc(e.subjects.slice(0, 4).join(' · ')) + '</div>'
        + '</div>';
    });
    g.innerHTML = h;
  };

  /* ═════════ DETAIL — #brainlab/exams/<id> ═════════ */
  U.openExam = function (id, push) {
    var e = findExam(id); if (!e) { U.renderLanding(); return; }
    if (push !== false) { location.hash = '#brainlab/exams/' + id; return; } /* hashchange → syncFromHash → openExam(id,false) */
    var bl = B(); if (!bl) return;
    var c = document.getElementById('bl-sec-exams-body'); if (!c) return;

    var n = examQuestions(e), pyq = examPYQs(e), mock = examMock(id), key = examKey(id);
    var sess = examSessions(e);

    var h = '<button class="bl-eu-back" onclick="BrainLabUniverse.back()">← Exam Universe</button>';
    h += '<div class="bl-eu-hero"><div class="bl-eu-h-title">🎯 ' + esc(e.name) + '</div>'
      + '<div class="bl-eu-h-sub">' + esc(e.desc) + ' — complete preparation hub.</div>'
      + '<div class="bl-eu-badges">'
      + (mock ? '<span class="bl-eu-badge">📝 Mock Tests</span>' : '')
      + (pyq ? '<span class="bl-eu-badge">📚 PYQs</span>' : '')
      + '<span class="bl-eu-badge">⚡ Practice</span><span class="bl-eu-badge">📰 Current Affairs</span>'
      + '</div>'
      + '<div class="bl-eu-stats">'
      + '<div class="bl-eu-stat"><span class="bl-eu-stat-ic">🧩</span><span class="bl-eu-stat-n">' + n.toLocaleString() + '</span><span class="bl-eu-stat-l">Questions</span></div>'
      + (pyq ? '<div class="bl-eu-stat"><span class="bl-eu-stat-ic">📚</span><span class="bl-eu-stat-n">' + pyq + '</span><span class="bl-eu-stat-l">PYQs</span></div>' : '')
      + (mock ? '<div class="bl-eu-stat"><span class="bl-eu-stat-ic">📝</span><span class="bl-eu-stat-n">1</span><span class="bl-eu-stat-l">Mock</span></div>' : '')
      + '<div class="bl-eu-stat" id="bl-eu-pdfstat" style="display:none"></div>'
      + '</div></div>';

    /* ── Your Progress (real, own sessions only) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">📊 Your ' + esc(e.name) + ' Progress</div>';
    if (sess.length) {
      var avg = Math.round(sess.reduce(function (a, s) { return a + (s.score || 0); }, 0) / sess.length);
      var best = Math.max.apply(null, sess.map(function (s) { return s.score || 0; }));
      var qs = sess.reduce(function (a, s) { return a + (s.total_questions || 0); }, 0);
      var last = sess.reduce(function (m, s) { var d = s.completed_at || ''; return d > m ? d : m; }, '');
      h += '<div class="bl-eu-prog">'
        + '<div class="bl-eu-p"><div class="bl-eu-p-n">' + avg + '%</div><div class="bl-eu-p-l">Accuracy</div></div>'
        + '<div class="bl-eu-p"><div class="bl-eu-p-n">' + sess.length + '</div><div class="bl-eu-p-l">Tests done</div></div>'
        + '<div class="bl-eu-p"><div class="bl-eu-p-n">' + qs.toLocaleString() + '</div><div class="bl-eu-p-l">Questions</div></div>'
        + '<div class="bl-eu-p"><div class="bl-eu-p-n">' + best + '%</div><div class="bl-eu-p-l">Best score</div></div>'
        + '</div>'
        + (last ? '<div class="bl-eu-meta">Last activity: ' + esc(last.slice(0, 10)) + '</div>' : '');
    } else {
      h += '<div class="bl-eu-empty">Start your first test to build your progress.</div>';
    }
    h += '</div>';

    /* ── Continue Preparation (real last session) ── */
    if (sess.length) {
      var s = sess[sess.length - 1];
      h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">🔥 Continue Preparation</div>'
        + '<div class="bl-eu-continue">'
        + '<div><div class="bl-eu-card-name">' + esc(s.title || 'Practice') + '</div>'
        + '<div class="bl-eu-card-desc">Last attempted · ' + (s.score || 0) + '% accuracy</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLab.retrySession(\'' + esc(s.id) + '\')">TRY AGAIN</button>'
        + '</div></div>';
    }

    /* ── Available Tests (real mock via existing engine) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">📝 Tests</div><div class="bl-eu-sec-s">Practice with exam-focused tests.</div>';
    if (mock) {
      h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">' + esc(mock.icon + ' ' + mock.title) + '</div>'
        + '<div class="bl-eu-card-desc">Full mock · ' + (B().countByExam ? B().countByExam(key) : 0).toLocaleString() + ' question pool · timed, auto-submit</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLab.startMock(\'' + mock.id + '\')">START TEST</button></div>';
    } else {
      h += '<div class="bl-eu-empty">No dedicated mock for this exam yet — use Quick Practice below.</div>';
    }
    h += '</div>';

    /* ── Quick Practice (existing engine) ── */
    h += '<div class="bl-eu-quick"><div class="bl-eu-sec-t">⚡ Quick Practice</div>'
      + '<div class="bl-eu-card-desc">Have a few minutes? Start a quick exam-focused session.</div>'
      + '<div class="bl-eu-quick-btns">'
      + [10, 25, 50].map(function (k) { return '<button class="bl-eu-btn" onclick="BrainLab.startQuizSession({mode:\'quiz\',title:\'' + esc(e.name) + ' Quick ' + k + '\',questions:' + k + ',exam:\'' + key + '\'})">QUICK ' + k + '</button>'; }).join('')
      + '</div></div>';

    /* ── Related PYQs (existing engine) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">📚 Related PYQs</div>';
    if (pyq) {
      h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">Previous year questions</div>'
        + '<div class="bl-eu-card-desc">' + pyq + ' PYQ questions mapped to this exam</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLabV7.startExamPYQ(\'' + key + '\')">PRACTICE</button></div>';
    } else {
      h += '<div class="bl-eu-empty">PYQs for this exam are coming soon — the PYQ bank is growing.</div>';
    }
    h += '</div>';

    /* ── Subject-wise (only subjects with real content) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">📖 Subject-wise Practice</div>';
    var subs = e.subjects.map(function (s) { return { s: s, n: bl.countByTopic(s, 'All') }; }).filter(function (r) { return r.n > 0; });
    U._subjRows = subs;
    if (subs.length) {
      h += '<div class="bl-eu-subj">';
      subs.forEach(function (r, i) {
        h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">' + esc(r.s) + '</div>'
          + '<div class="bl-eu-card-desc">' + r.n.toLocaleString() + ' questions</div></div>'
          + '<button class="bl-eu-btn" onclick="BrainLabUniverse.practiceSubject(' + i + ')">PRACTICE</button></div>';
      });
      h += '</div>';
    } else { h += '<div class="bl-eu-empty">No mapped subjects yet.</div>'; }
    h += '</div>';

    /* ── Question Papers + Study Materials (async, canonical PDF flow) ── */
    h += '<div class="bl-eu-sec" id="bl-eu-papers"><div class="bl-eu-sec-t">📄 Previous Year Question Papers</div><div class="bl-eu-empty" id="bl-eu-papers-body">Loading…</div></div>';
    h += '<div class="bl-eu-sec" id="bl-eu-mats"><div class="bl-eu-sec-t">📚 Study Materials</div><div class="bl-eu-empty" id="bl-eu-mats-body">Loading…</div></div>';

    /* ── Current Affairs (existing feature) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">📰 Current Affairs</div>'
      + '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">Stay exam-ready</div>'
      + '<div class="bl-eu-card-desc">Daily published affairs — quiz built from real updates</div></div>'
      + '<div class="bl-eu-btns2"><button class="bl-eu-btn" onclick="BrainLabV7.startAffairsQuiz()">QUIZ</button>'
      + '<button class="bl-eu-btn bl-eu-btn2" onclick="BrainLabPages.go(\'current-affairs\')">VIEW ALL</button></div></div></div>';

    /* ── Recommended (real activity only, no AI claims) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">✨ Recommended for ' + esc(e.name) + '</div>';
    var byCat = {};
    sess.forEach(function (s) { if (s.category && s.category !== 'All') { (byCat[s.category] = byCat[s.category] || []).push(s.score || 0); } });
    var weak = null;
    Object.keys(byCat).forEach(function (k) {
      var arr = byCat[k], av = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      if (arr.length >= 2 && (!weak || av < weak.pct)) weak = { cat: k, pct: Math.round(av) };
    });
    if (weak) {
      h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">🧩 Practice ' + esc(weak.cat) + '</div>'
        + '<div class="bl-eu-card-desc">Your accuracy here is ' + weak.pct + '% — revise this subject</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLabUniverse.practiceCategory(\'' + esc(weak.cat) + '\')">PRACTICE</button></div>';
    }
    if (mock) {
      h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">📝 ' + esc(e.name) + ' Mock Test</div>'
        + '<div class="bl-eu-card-desc">Full timed mock — exam-style experience</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLab.startMock(\'' + mock.id + '\')">START</button></div>';
    }
    if (pyq) {
      h += '<div class="bl-eu-testrow"><div><div class="bl-eu-card-name">📚 PYQ Practice</div>'
        + '<div class="bl-eu-card-desc">' + pyq + ' previous year questions</div></div>'
        + '<button class="bl-eu-btn" onclick="BrainLabV7.startExamPYQ(\'' + key + '\')">PRACTICE</button></div>';
    }
    if (!weak && !mock && !pyq) h += '<div class="bl-eu-empty">Complete a practice session to get real recommendations.</div>';
    h += '</div>';

    /* ── About (only fields that exist) ── */
    h += '<div class="bl-eu-sec"><div class="bl-eu-sec-t">ℹ️ About This Exam</div>'
      + '<div class="bl-eu-about"><div><span class="bl-eu-ab-l">Exam</span> ' + esc(e.name) + '</div>'
      + '<div><span class="bl-eu-ab-l">Focus</span> ' + esc(e.desc) + '</div>'
      + '<div><span class="bl-eu-ab-l">Subjects</span> ' + esc(e.subjects.join(', ')) + '</div></div></div>';

    c.innerHTML = h;
    U._loadPDFs(e);
    var top = document.getElementById('blv8-exams');
    if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── PDF discovery: prefer loaded window.PDFS, else one real Supabase query ── */
  U._loadPDFs = function (e) {
    var terms = examTerms(e.id);
    function fill(list) {
      var papers = list.filter(function (p) { return /question paper|previous year|solved paper|pyq/i.test([p.title, p.category].join(' ')); });
      var mats = list.filter(function (p) { return papers.indexOf(p) === -1; });
      function cardHTML(p) {
        var own = owned(p.id), free = !!p.free, price = fmtPrice(p);
        var badge = own ? '✓ OWNED' : (free ? 'FREE' : (price || 'PREMIUM'));
        return '<div class="bl-eu-pdf" onclick="openDetail(\'' + esc(p.id) + '\')">'
          + (p.cover_url ? '<img class="bl-eu-pdf-cov" src="' + esc(p.cover_url) + '" alt="" loading="lazy">' : '<div class="bl-eu-pdf-cov bl-eu-pdf-noc">📄</div>')
          + '<div class="bl-eu-pdf-mid"><div class="bl-eu-card-name">' + esc(p.title) + '</div>'
          + '<div class="bl-eu-card-desc">' + esc(p.category || 'Study material') + ' · ' + badge + '</div></div>'
          + '<span class="bl-eu-arrow">›</span></div>';
      }
      var pb = document.getElementById('bl-eu-papers-body'), mb = document.getElementById('bl-eu-mats-body');
      if (pb) pb.innerHTML = papers.length ? papers.map(cardHTML).join('') : '<div class="bl-eu-empty">No question papers published yet.</div>';
      if (mb) mb.innerHTML = mats.length ? mats.map(cardHTML).join('') : '<div class="bl-eu-empty">No study materials published yet.</div>';
      var st = document.getElementById('bl-eu-pdfstat');
      if (st && list.length) { st.style.display = ''; st.innerHTML = '<span class="bl-eu-stat-ic">📄</span><span class="bl-eu-stat-n">' + list.length + '</span><span class="bl-eu-stat-l">PDFs</span>'; }
    }
    var local = examPDFs(e);
    if (local.length) { fill(local); return; }
    var sb = window.supabase || window.supabaseClient;
    if (!terms.length || !sb) { fill([]); return; }
    sb.from('pdfs').select('id,title,category,free,price,cover_url,download_count').eq('status', 'published').limit(200)
      .then(function (res) {
        var data = (res && res.data) || [];
        var h = function (p) { return [p.category, p.tag, p.subcategory, p.title].join(' ').toLowerCase(); };
        fill(data.filter(function (p) { return terms.some(function (t) { return h(p).indexOf(t) !== -1; }); }));
      })
      .catch(function () { fill([]); });
  };

  /* ── controls ── */
  U.back = function () { location.hash = '#brainlab/exams'; };
  U.practiceSubject = function (i) {
    var bl = B(), r = (U._subjRows || [])[i]; if (!bl || !r) return;
    bl.showCountPicker({ title: r.s, category: r.s, pool: bl.filterQuestions({ category: r.s }), mode: 'quiz' });
  };
  U.practiceCategory = function (cat) {
    var bl = B(); if (!bl) return;
    bl.showCountPicker({ title: cat, category: cat, pool: bl.filterQuestions({ category: cat }), mode: 'quiz' });
  };
})();
