/* ═══════════════════════════════════════════════════════════════════════════
   STUDYRIA BRAINLAB — V7 UPGRADE (2026 BrainLab A-to-Z, Phase A)
   Additive layer. Loaded AFTER brainlab.js, brainlab-ext.js, arena.js.
   Pattern: wraps existing renderers (arena.js uses the same pattern) —
   never deletes or duplicates existing modules.
   Adds:
     1. Exam Hub (exam-first discovery, real question-bank counts only)
     2. Recommended For You + Weak Topics (real session history only)
     3. Premium Result Page (breakdown, subject perf, strong/weak, review tabs,
        practice-weak-areas CTA)
     4. Current Affairs Quiz (from real published affairs)
     5. Leaderboard tabs (Week/Month/All-Time) — real data when signed in
        (via bl_leaderboard RPC), honest fallback otherwise
     6. XP + Achievements (derived from real activity only)
     7. Streak milestones (real streak only)
     8. Quick 10/25 card upgrade + honest guest sign-in nudge
   STRICT RULES honored: no fake data, no fake participants, no fabricated
   rank. Empty states shown when no data. Correct answers never exposed
   before submission.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var V7 = {};
  var orig = {};

  /* ───────────────────────── helpers ───────────────────────── */
  function esc(s) { return BrainLab.escape(s); }

  /* Real activity stats (device-local history) */
  function realStats() {
    var s = BrainLab.getSessions();
    var q = 0, c = 0;
    s.forEach(function (x) { q += x.total_questions || 0; c += x.correct_count || 0; });
    return {
      tests: s.length,
      questions: q,
      correct: c,
      accuracy: q > 0 ? Math.round((c / q) * 100) : 0
    };
  }

  /* Honest XP: 10/correct + 2/completed test, derived only from real sessions */
  function computeXP() {
    var s = realStats();
    return s.correct * 10 + s.tests * 2;
  }

  /* Weak/strong topics from REAL session history (min 5 answered questions) */
  function topicPerformance(minQ) {
    minQ = minQ || 5;
    var perf = {};
    BrainLab.getSessions().forEach(function (s) {
      var key = s.category || 'General';
      if (!perf[key]) perf[key] = { total: 0, correct: 0 };
      perf[key].total += s.total_questions || 0;
      perf[key].correct += s.correct_count || 0;
    });
    var rows = [];
    Object.keys(perf).forEach(function (k) {
      var p = perf[k];
      if (p.total >= minQ) rows.push({ topic: k, total: p.total, correct: p.correct, pct: Math.round((p.correct / p.total) * 100) });
    });
    rows.sort(function (a, b) { return a.pct - b.pct; });
    return rows;
  }

  /* ───────────────────────── 1. EXAM HUB ───────────────────────── */
  /* Exam → subject mapping for REAL question-bank counts (no hardcoded numbers) */
  V7.EXAM_HUB = [
    { id: 'adre', name: 'ADRE Grade III', desc: 'Assam Direct Recruitment Exam', subjects: ['Assam GK', 'Assam History', 'Assam Geography', 'General Knowledge', 'Reasoning', 'Mathematics', 'Computer', 'Science', 'English', 'Environment'] },
    { id: 'adre4', name: 'ADRE Grade IV', desc: 'Assam Direct Recruitment — Grade IV', subjects: ['Assam GK', 'Assam Geography', 'Assam History', 'General Knowledge', 'Reasoning', 'Mathematics', 'Science'] },
    { id: 'apsc', name: 'APSC', desc: 'Assam Public Service Commission', subjects: ['Assam GK', 'Assam History', 'Assam Geography', 'Assam Polity', 'Polity', 'History', 'Geography', 'Economy', 'Science', 'Environment'] },
    { id: 'police', name: 'Assam Police', desc: 'SI / Constable preparation', subjects: ['Assam GK', 'Assam History', 'Reasoning', 'Mathematics', 'General Knowledge', 'Science'] },
    { id: 'tet', name: 'Assam TET', desc: 'Teacher Eligibility Test', subjects: ['English', 'Mathematics', 'Science', 'General Knowledge', 'Environment'] },
    { id: 'ssc', name: 'SSC', desc: 'SSC CGL / CHSL', subjects: ['Reasoning', 'Mathematics', 'English', 'General Knowledge', 'Science'] },
    { id: 'dhs', name: 'DHS Assam', desc: 'Health Services recruitment', subjects: ['Assam GK', 'General Knowledge', 'Science', 'English', 'Mathematics', 'Reasoning'] },
    { id: 'other', name: 'Other Assam Govt. Exams', desc: 'All Assam government recruitment', subjects: ['Assam GK', 'Assam History', 'Assam Geography', 'General Knowledge', 'Reasoning'] }
  ];

  V7.examCount = function (subjects) {
    var QB = window.STUDYRIA_QB || [];
    var n = 0, seen = {};
    QB.forEach(function (q) {
      var key = String(String(q[0]).slice(0, 60) + q[5]);
      if (seen[key]) return;
      if (subjects.indexOf(q[7]) !== -1 || subjects.indexOf(q[8]) !== -1) { seen[key] = 1; n++; }
    });
    return n;
  };

  V7.renderExamHub = function () {
    var c = document.getElementById('bl-sec-exams-body');
    if (!c) return;
    var h = '<div class="bl-section-header"><h2 class="bl-section-title">🎯 Exam Hub</h2><span class="bl-section-sub">Pick your exam — practice, mocks, PYQs & affairs in one place</span></div>';
    h += '<div class="bl-v7-exam-grid">';
    V7.EXAM_HUB.forEach(function (e) {
      var cnt = V7.examCount(e.subjects);
      var subj = e.subjects.slice(0, 3).map(esc).join(' · ');
      h += '<div class="bl-v7-exam-card" onclick="BrainLabV7.openExam(\'' + e.id + '\')">'
        + '<div class="bl-v7-exam-name">' + esc(e.name) + '</div>'
        + '<div class="bl-v7-exam-desc">' + esc(e.desc) + '</div>'
        + '<div class="bl-v7-exam-count">' + cnt.toLocaleString() + ' practice questions available</div>'
        + '<div class="bl-v7-exam-subjects">' + subj + '</div>'
        + '<button class="bl-v7-exam-btn">Open Exam →</button>'
        + '</div>';
    });
    h += '</div><div id="bl-v7-exam-detail"></div>';
    c.innerHTML = h;
  };

  V7.openExam = function (id) {
    var e = V7.EXAM_HUB.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var d = document.getElementById('bl-v7-exam-detail');
    if (!d) return;
    var examName = e.id === 'adre' || e.id === 'adre4' ? 'ADRE' : e.id === 'apsc' ? 'APSC' : e.id === 'police' ? 'Assam Police' : e.id === 'tet' ? 'Assam TET' : e.id === 'ssc' ? 'SSC' : 'General';
    var cnt = V7.examCount(e.subjects);
    var pyqN = (window.STUDYRIA_QB || []).filter(function (q) { return q[17] === 'PYQ' && (e.subjects.indexOf(q[7]) !== -1 || e.subjects.indexOf(q[8]) !== -1); }).length;
    var hasMock = typeof BrainLab.startPickedMock === 'function';
    d.innerHTML = '<div class="bl-v7-exam-detail bl-fade-in">'
      + '<div class="bl-v7-exam-detail-head"><div><div class="bl-v7-exam-name">' + esc(e.name) + '</div><div class="bl-v7-exam-desc">' + esc(e.desc) + '</div></div><button class="bl-v7-exam-close" onclick="this.closest(\'.bl-v7-exam-detail\').remove()">✕</button></div>'
      + '<div class="bl-v7-exam-actions">'
      + '<button class="bl-v7-ea" onclick="BrainLab.startQuizSession({mode:\'quiz\',title:\'' + esc(e.name) + ' Practice\',questions:20,exam:\'' + examName + '\'})">📋 Practice MCQs</button>'
      + (hasMock ? '<button class="bl-v7-ea" onclick="BrainLab.startPickedMock(\'' + examName + '\',\'' + esc(e.name) + ' Mock Test\')">📝 Mock Test</button>' : '')
      + '<button class="bl-v7-ea" onclick="BrainLabV7.startExamPYQ(\'' + examName + '\')">📚 PYQ Practice</button>'
      + '<button class="bl-v7-ea" onclick="BrainLab.scrollToSection(\'bl-sec-affairs\')">📰 Current Affairs</button>'
      + '</div>'
      + '<div class="bl-v7-exam-meta"><span>' + cnt.toLocaleString() + ' questions mapped</span><span>' + pyqN + ' PYQ questions</span></div>'
      + '<div class="bl-v7-exam-note">Subjects: ' + e.subjects.map(esc).join(', ') + '</div>'
      + '</div>';
    d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  V7.startExamPYQ = function (exam) {
    var pool = BrainLab.filterQuestions({ exam: exam }).filter(function (q) { return q[17] === 'PYQ'; });
    if (!pool.length) { BrainLab.toast('No PYQ questions for this exam yet — added soon.'); return; }
    BrainLab.startQuizSession({ mode: 'pyq', title: exam + ' PYQ Practice', questions: Math.min(10, pool.length), exam: exam });
  };

  /* ───────── 2. RECOMMENDED FOR YOU (real data only) ───────── */
  V7.renderRecommended = function () {
    var c = document.getElementById('bl-sec-recommended-body');
    if (!c) return;
    var st = realStats();
    var h = '<div class="bl-section-header"><h2 class="bl-section-title">✨ Recommended For You</h2><span class="bl-section-sub">Based on your real activity</span></div>';
    if (st.tests === 0) {
      h += '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">✨</div><div class="bl-empty-text">Take your first test — personalized recommendations appear here.</div><button class="bl-empty-action" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">Start a Quiz</button></div>';
      c.innerHTML = h;
      return;
    }
    var weak = topicPerformance(5).filter(function (r) { return r.pct < 70; });
    h += '<div class="bl-v7-reco">';
    if (weak.length) {
      var w = weak[0];
      h += '<div class="bl-v7-reco-card">'
        + '<div class="bl-v7-reco-title">YOUR WEAK AREAS</div>'
        + '<div class="bl-v7-reco-list">' + weak.slice(0, 3).map(function (r, i) { return '<span class="bl-v7-reco-rank">' + (i + 1) + '</span> ' + esc(r.topic) + ' <em>(' + r.pct + '% accuracy)</em>'; }).join('<br>') + '</div>'
        + '<div class="bl-v7-reco-title" style="margin-top:12px">TODAY\'S RECOMMENDATION</div>'
        + '<div class="bl-v7-reco-list">'
        + '<span class="bl-v7-reco-rank">→</span> ' + Math.min(20, w.total) + ' ' + esc(w.topic) + ' MCQs'
        + (weak[1] ? '<br><span class="bl-v7-reco-rank">→</span> 1 ' + esc(weak[1].topic) + ' practice round' : '')
        + '</div>'
        + '<button class="bl-v7-reco-btn" onclick="BrainLab.startQuizSession({mode:\'weak\',title:\'' + esc(w.topic) + ' — Weak Area Practice\',questions:10,category:\'' + esc(w.topic) + '\'})">START MY REVISION</button>'
        + '</div>';
    } else {
      h += '<div class="bl-v7-reco-card"><div class="bl-v7-reco-title">GREAT PROGRESS!</div><div class="bl-v7-reco-list">No weak areas detected yet — keep practicing to unlock deeper analysis.</div></div>';
    }
    h += '<div class="bl-v7-reco-side">'
      + '<div class="bl-v7-reco-mini" onclick="BrainLab.startArenaMode(\'quick10\')">⚡ Quick 10 <em>fast warm-up</em></div>'
      + '<div class="bl-v7-reco-mini" onclick="BrainLab.scrollToSection(\'bl-sec-challenge\')">⚡ Today\'s Challenge <em>keep your streak</em></div>'
      + '<div class="bl-v7-reco-mini" onclick="BrainLabV7.startAffairsQuiz()">📰 Test Today\'s Affairs</div>'
      + '</div>';
    h += '</div>';
    c.innerHTML = h;
  };

  /* ───────── 3. PREMIUM RESULT PAGE (replaces result rendering only) ───────── */
  BrainLab._finishQuiz = function () {
    if (BrainLab._timerInterval) clearInterval(BrainLab._timerInterval);
    var qs = BrainLab._currentQuiz.questions, ans = BrainLab._answers;
    var correct = 0, wrong = 0, skipped = 0;
    ans.forEach(function (a) { if (a === null || a === undefined || a.skipped) skipped++; else if (a.isCorrect) correct++; else wrong++; });
    var total = qs.length;
    var pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    var timeTaken = Math.floor((Date.now() - BrainLab._startTime) / 1000);
    var mins = Math.floor(timeTaken / 60), secs = timeTaken % 60;
    var session = BrainLab._sessionMeta || {};
    session.completed_at = new Date().toISOString();
    session.correct_count = correct; session.wrong_count = wrong; session.skipped_count = skipped;
    session.score = pct; session.time_taken = timeTaken; session.total_questions = total;
    BrainLab.saveSession(session);
    BrainLab.markStreak();
    if (BrainLab._sessionMeta && BrainLab._sessionMeta.mode === 'daily') BrainLab.saveDailyStatus(pct, correct, total);
    var attemptedIds = qs.map(function (q) { return String(q.question_text.slice(0, 50) + q.correct_answer); });
    BrainLab.markAttempted(attemptedIds);
    qs.forEach(function (q, i) {
      var a = ans[i];
      if (a && !a.skipped && !a.isCorrect) BrainLab.saveMistakeLocal(q, a.selectedAnswer);
    });

    /* subject performance from THIS attempt (real per-question data) */
    var subj = {};
    qs.forEach(function (q, i) {
      var k = q.category || q.topic || 'General';
      if (!subj[k]) subj[k] = { c: 0, t: 0 };
      subj[k].t++;
      var a = ans[i];
      if (a && !a.skipped && a.isCorrect) subj[k].c++;
    });
    var subjRows = Object.keys(subj).map(function (k) { return { s: k, c: subj[k].c, t: subj[k].t, pct: Math.round((subj[k].c / subj[k].t) * 100) }; });
    subjRows.sort(function (a, b) { return b.pct - a.pct; });
    var strong = subjRows.filter(function (r) { return r.pct >= 70; });
    var weakSub = subjRows.filter(function (r) { return r.pct < 60; });
    var weakest = weakSub.length ? weakSub[weakSub.length - 1] : null;

    var isAs = BrainLab._lang === 'as';
    var h = '<div class="bl-quiz-result"><div class="bl-result-hero"><div class="bl-result-score">' + pct + '%</div><div class="bl-result-label">' + (isAs ? 'স্ক' + 'োৰ' : 'Score') + '</div></div>';
    h += '<div class="bl-v7-result-banner">TEST COMPLETED — ' + correct + ' / ' + total + ' correct' + (session.title ? ' · ' + esc(session.title) : '') + '</div>';
    h += '<div class="bl-result-stats">'
      + '<div class="bl-result-stat"><div class="bl-result-stat-icon">✅</div><div class="bl-result-stat-num">' + correct + '</div><div class="bl-result-stat-label">' + (isAs ? 'শুদ্ধ' : 'Correct') + '</div></div>'
      + '<div class="bl-result-stat"><div class="bl-result-stat-icon">❌</div><div class="bl-result-stat-num">' + wrong + '</div><div class="bl-result-stat-label">' + (isAs ? 'ভুল' : 'Wrong') + '</div></div>'
      + '<div class="bl-result-stat"><div class="bl-result-stat-icon">⏭️</div><div class="bl-result-stat-num">' + skipped + '</div><div class="bl-result-stat-label">' + (isAs ? 'বাদ' : 'Skipped') + '</div></div>'
      + '<div class="bl-result-stat"><div class="bl-result-stat-icon">⏱️</div><div class="bl-result-stat-num">' + mins + ':' + (secs < 10 ? '0' : '') + secs + '</div><div class="bl-result-stat-label">Time</div></div>'
      + '<div class="bl-result-stat"><div class="bl-result-stat-icon">🎯</div><div class="bl-result-stat-num">' + pct + '%</div><div class="bl-result-stat-label">Accuracy</div></div>'
      + '</div>';
    if (subjRows.length > 1) {
      h += '<div class="bl-v7-subj"><h3>SUBJECT PERFORMANCE</h3>';
      subjRows.forEach(function (r) {
        var col = r.pct >= 70 ? 'var(--bl-ok,#2e7d32)' : r.pct >= 50 ? 'var(--bl-mid,#f57c00)' : 'var(--hp-red,#930205)';
        h += '<div class="bl-v7-subj-row"><span class="bl-v7-subj-name">' + esc(r.s) + '</span><span class="bl-v7-subj-bar"><span style="width:' + r.pct + '%;background:' + col + '"></span></span><span class="bl-v7-subj-pct">' + r.pct + '%</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="bl-v7-sw">';
    h += '<div class="bl-v7-sw-card"><h4>💪 STRONG AREAS</h4>' + (strong.length ? strong.map(function (r) { return '<span>' + esc(r.s) + ' · ' + r.pct + '%</span>'; }).join('') : '<span class="bl-v7-sw-empty">Keep practicing — strong areas appear here.</span>') + '</div>';
    h += '<div class="bl-v7-sw-card"><h4>🎯 WEAK AREAS</h4>' + (weakSub.length ? weakSub.map(function (r) { return '<span>' + esc(r.s) + ' · ' + r.pct + '%</span>'; }).join('') : '<span class="bl-v7-sw-empty">None this time — well done!</span>') + '</div>';
    h += '</div>';
    if (weakest) {
      h += '<div class="bl-v7-next-step"><h4>RECOMMENDED NEXT STEP</h4><p>'
        + Math.min(20, weakest.t) + ' ' + esc(weakest.s) + ' MCQs'
        + '</p><button class="bl-v7-reco-btn" onclick="BrainLab.startQuizSession({mode:\'weak\',title:\'' + esc(weakest.s) + ' — Practice\',questions:10,category:\'' + esc(weakest.s) + '\'})">PRACTICE WEAK AREAS</button></div>';
    }
    h += '<div class="bl-result-review"><h3>' + (isAs ? 'প্ৰশ্ন পৰ্যালোচনা' : 'Question Review') + '</h3><div class="bl-v7-review-tabs">'
      + '<button class="bl-v7-rt on" data-f="all" onclick="BrainLabV7.reviewTab(this,\'all\')">ALL (' + total + ')</button>'
      + '<button class="bl-v7-rt" data-f="correct" onclick="BrainLabV7.reviewTab(this,\'correct\')">CORRECT (' + correct + ')</button>'
      + '<button class="bl-v7-rt" data-f="wrong" onclick="BrainLabV7.reviewTab(this,\'wrong\')">WRONG (' + wrong + ')</button>'
      + '<button class="bl-v7-rt" data-f="skipped" onclick="BrainLabV7.reviewTab(this,\'skipped\')">SKIPPED (' + skipped + ')</button>'
      + '</div><div class="bl-v7-review-list">';
    qs.forEach(function (q, i) {
      var a = ans[i];
      var isSk = a === null || a === undefined || (a && a.skipped);
      var isCr = a && a.isCorrect;
      var cls = isSk ? 'bl-review-skipped' : isCr ? 'bl-review-correct' : 'bl-review-wrong';
      var fcls = isSk ? 'skipped' : isCr ? 'correct' : 'wrong';
      var disp = BrainLabTranslate.getDisplay(q, BrainLab._lang);
      h += '<div class="bl-review-item ' + cls + ' bl-v7-ri" data-f="' + fcls + '">'
        + '<div class="bl-review-q">' + (i + 1) + '. ' + esc(disp.question) + '</div>'
        + '<div class="bl-v7-ri-meta"><span>' + esc(q.category || '') + '</span><span>' + esc(q.topic || '') + '</span><span>' + esc(q.difficulty || '') + '</span>' + (q.question_type === 'PYQ' ? '<span class="bl-v7-pyq">PYQ</span>' : '') + '</div>';
      if (!isSk) {
        var ua = a.selectedAnswer; ua = ua && ua.length === 1 ? ua.toUpperCase() : ua;
        var ca = q.correct_answer.toUpperCase();
        h += '<div class="bl-review-ans">' + (isAs ? 'তোমাৰ উত্তৰ:' : 'Your answer:') + ' <strong>' + esc(ua) + '</strong> | ' + (isAs ? 'সঠিক:' : 'Correct:') + ' <strong style="color:var(--hp-red,#930205)">' + ca + '</strong></div>';
      } else {
        h += '<div class="bl-review-ans">' + (isAs ? 'বাদ দিলা' : 'Skipped') + ' | ' + (isAs ? 'সঠিক:' : 'Correct:') + ' <strong>' + q.correct_answer.toUpperCase() + '</strong></div>';
      }
      h += '<div class="bl-review-exp">' + esc(disp.explanation || 'No explanation available.') + '</div></div>';
    });
    h += '</div></div>';
    h += '<div class="bl-result-actions"><button class="bl-result-btn bl-result-retry" onclick="BrainLab.retryQuiz()">' + (isAs ? 'পুনঃ চেষ্টা' : 'Retry Quiz') + '</button><button class="bl-result-btn bl-result-exit" onclick="BrainLab.quitQuiz()">' + (isAs ? 'বাহিৰ ওলোৱা' : 'Back to BrainLab') + '</button></div></div>';
    var c = document.getElementById('bl-quiz-player-area');
    if (c) { c.innerHTML = h; c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    /* DB sync (fail-open, no-op when signed out / migration not run) */
    V7.syncAttempt(session);
    V7.afterResultRefresh();
  };

  V7.reviewTab = function (btn, f) {
    var wrap = btn.parentElement; if (!wrap) return;
    wrap.querySelectorAll('.bl-v7-rt').forEach(function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    var list = wrap.parentElement.querySelector('.bl-v7-review-list');
    if (!list) return;
    list.querySelectorAll('.bl-v7-ri').forEach(function (el) {
      el.style.display = (f === 'all' || el.getAttribute('data-f') === f) ? '' : 'none';
    });
  };

  /* after a completed attempt, refresh data-driven sections */
  V7.afterResultRefresh = function () {
    try { BrainLab.renderStats(); } catch (e) { }
    try { V7.renderRecommended(); } catch (e) { }
    try { BrainLab.renderStudyStreak(); } catch (e) { }
  };

  /* ───────── 4. CURRENT AFFAIRS QUIZ (from real published entries) ───────── */
  V7.startAffairsQuiz = function () {
    var cl = BrainLab.client();
    var build = function (rows) {
      var qs = [];
      rows.forEach(function (r, idx) {
        var txt = String(r.description || r.summary || r.content || '').trim();
        var title = String(r.title || '').trim();
        if (!txt || !title) return;
        /* Real comprehension question on this real published update */
        qs.push({
          id: 'ca-' + idx + '-' + Date.now(),
          question_text: 'From the update "' + title.slice(0, 120) + '" — which statement is correct?',
          option_a: txt.slice(0, 90).trim(),
          option_b: 'The update was published as an unrelated fiction story',
          option_c: 'This update has no relevance to competitive exams',
          option_d: 'None of the above',
          correct_answer: 'a',
          explanation: 'Straight from the published update: ' + txt.slice(0, 200),
          topic: 'Current Affairs', category: 'General Knowledge', difficulty: 'easy',
          question_type: 'AFFAIRS', source: r.source || 'Studyria Current Affairs',
          question_as: '', opt_a_as: '', opt_b_as: '', opt_c_as: '', opt_d_as: '', exp_as: ''
        });
      });
      return qs.slice(0, 10);
    };
    var start = function (rows) {
      var mcqs = build(rows);
      if (mcqs.length < 4) { BrainLab.toast('Not enough current affairs published yet to build a quiz.'); return; }
      BrainLab._sessionId = 'sess-ca-' + Date.now();
      BrainLab._sessionMeta = { id: BrainLab._sessionId, mode: 'affairs', title: 'Current Affairs Quiz', category: 'Current Affairs', topic: 'All', exam: 'All', difficulty: 'mixed', total_questions: mcqs.length, started_at: new Date().toISOString() };
      BrainLab._startPlayer({ title: 'Current Affairs Quiz', questions: mcqs, mode: 'affairs' });
    };
    if (cl) {
      cl.from('current_affairs').select('title,description,summary,content,source,created_at').eq('is_deleted', false).eq('status', 'published').order('created_at', { ascending: false }).limit(12)
        .then(function (r) { start(r.data || []); }).catch(function () { start([]); });
    } else start([]);
  };

  /* ───────── 5. LEADERBOARD TABS (real data when possible) ───────── */
  V7.lbPeriod = 'all-time';
  BrainLab.renderLeaderboard = function () {
    var c = document.getElementById('bl-leaderboard');
    if (!c) return;
    var user = BrainLab.user();
    var h = '<div class="bl-section-header"><h2 class="bl-section-title">Leaderboard</h2><span class="bl-section-sub">Compete with real Studyria learners</span></div>';
    h += '<div class="bl-v7-lb-tabs">'
      + '<button class="bl-v7-lbt' + (V7.lbPeriod === 'weekly' ? ' on' : '') + '" onclick="BrainLabV7.lbSwitch(\'weekly\')">THIS WEEK</button>'
      + '<button class="bl-v7-lbt' + (V7.lbPeriod === 'monthly' ? ' on' : '') + '" onclick="BrainLabV7.lbSwitch(\'monthly\')">THIS MONTH</button>'
      + '<button class="bl-v7-lbt' + (V7.lbPeriod === 'all-time' ? ' on' : '') + '" onclick="BrainLabV7.lbSwitch(\'all-time\')">ALL TIME</button>'
      + '</div>';
    if (!user) {
      var st = realStats();
      h += '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🏆</div><div class="bl-empty-text">Sign in to appear on the Studyria leaderboard and compete with other learners.</div>'
        + (st.tests > 0 ? '<div class="bl-v7-lb-localnote">Your device progress: <strong>' + st.tests + ' tests · ' + st.accuracy + '% accuracy</strong> — sign in to carry it into the competition.</div>' : '')
        + '</div>';
      c.innerHTML = h;
      return;
    }
    h += '<div id="bl-v7-lb-body"><div class="bl-v7-loading">Loading leaderboard…</div></div>';
    c.innerHTML = h;
    V7.loadLeaderboard(V7.lbPeriod);
  };

  V7.lbSwitch = function (p) {
    V7.lbPeriod = p;
    BrainLab.renderLeaderboard();
  };

  V7.loadLeaderboard = function (period) {
    var body = document.getElementById('bl-v7-lb-body');
    var cl = BrainLab.client();
    if (!body) return;
    if (!cl) { body.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Connectivity issue — try again.</div></div>'; return; }
    /* Server RPC (real, anti-farm validated). Fail-open to honest empty state. */
    cl.rpc('bl_leaderboard', { p_period: period }).then(function (r) {
      var rows = (r && r.data) || [];
      if (!rows.length) {
        body.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🏆</div><div class="bl-empty-text">No ranked attempts in this period yet — be the first! Complete a quiz to enter the leaderboard.</div><button class="bl-empty-action" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">Start a Quiz</button></div>';
        return;
      }
      var me = null;
      var h = '<div class="bl-leaderboard">';
      rows.forEach(function (e, i) {
        if (e.is_me) me = e;
        var rc = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        h += '<div class="bl-leader-row bl-fade-in' + (e.is_me ? ' bl-v7-lb-me' : '') + '"><div class="bl-leader-rank ' + rc + '">' + (e.rk || (i + 1)) + '</div><div class="bl-leader-name">' + esc(e.display_name || 'Learner') + (e.is_me ? ' (You)' : '') + '</div><div class="bl-leader-meta">' + (e.tests || 0) + ' tests</div><div class="bl-leader-points">' + (e.points || 0) + ' pts</div></div>';
      });
      h += '</div>';
      if (me) {
        var pctile = me.total > 1 ? Math.round((me.rk / me.total) * 1000) / 10 : 100;
        h += '<div class="bl-v7-yourank"><strong>YOUR RANK</strong><div class="bl-v7-yourank-num">#' + me.rk + ' / ' + me.total + '</div><div>' + pctile + ' percentile</div></div>';
      } else {
        h += '<div class="bl-v7-yourank bl-v7-sw-empty">Complete a ranked test to enter this leaderboard.</div>';
      }
      body.innerHTML = h;
    }).catch(function () {
      body.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🏆</div><div class="bl-empty-text">The global leaderboard isn\'t active yet on this database. Your progress is still saved — quizzes, streak and analytics keep working.</div></div>';
    });
  };

  /* Attempt sync → DB (fail-open). RPC bl_submit_attempt when migration is applied. */
  V7.syncAttempt = function (session) {
    var cl = BrainLab.client();
    var user = BrainLab.user();
    if (!cl || !user || !session) return; /* signed-out stays local by design */
    try {
      cl.rpc('bl_submit_attempt', {
        p_mode: session.mode || 'quiz',
        p_title: String(session.title || 'Quiz').slice(0, 120),
        p_category: session.category || null,
        p_total: session.total_questions || 0,
        p_correct: session.correct_count || 0,
        p_wrong: session.wrong_count || 0,
        p_skipped: session.skipped_count || 0,
        p_score: session.score || 0,
        p_time_taken: session.time_taken || 0
      }).then(function () { }, function () { });
    } catch (e) { }
  };

  /* ───────── 6+7. XP, ACHIEVEMENTS, STREAK MILESTONES (real data only) ───────── */
  V7.renderAchievements = function (host) {
    if (!host) return;
    var st = realStats();
    var streak = BrainLab.dayStreak();
    var A = [
      { icon: '🥇', name: 'First Test', ok: st.tests >= 1 },
      { icon: '🔟', name: '10 Tests', ok: st.tests >= 10 },
      { icon: '💯', name: '100 Questions', ok: st.questions >= 100 },
      { icon: '🚀', name: '1000 Questions', ok: st.questions >= 1000 },
      { icon: '🎯', name: '90% Accuracy (20+ Q)', ok: st.questions >= 20 && st.accuracy >= 90 },
      { icon: '🔥', name: '7-Day Streak', ok: streak >= 7 },
      { icon: '⚡', name: '30-Day Streak', ok: streak >= 30 }
    ];
    var h = '<div class="bl-v7-ach"><h3>🎖 XP & Achievements</h3><div class="bl-v7-xp"><span class="bl-v7-xp-num">' + computeXP().toLocaleString() + '</span><span class="bl-v7-xp-lab">XP earned from real activity</span></div><div class="bl-v7-ach-grid">';
    A.forEach(function (a) {
      h += '<div class="bl-v7-ach-item' + (a.ok ? ' earned' : '') + '"><div class="bl-v7-ach-icon">' + a.icon + '</div><div class="bl-v7-ach-name">' + a.name + '</div><div class="bl-v7-ach-st">' + (a.ok ? '✓ Earned' : 'Locked') + '</div></div>';
    });
    h += '</div></div>';
    host.insertAdjacentHTML('beforeend', h);
  };

  orig.renderStudyStreak = BrainLab.renderStudyStreak;
  BrainLab.renderStudyStreak = function () {
    orig.renderStudyStreak.call(BrainLab);
    var c = document.getElementById('bl-streak');
    if (!c || document.getElementById('bl-v7-ms-wrap')) return;
    var streak = BrainLab.dayStreak();
    var M = [7, 14, 30, 60, 100];
    var h = '<div id="bl-v7-ms-wrap" class="bl-v7-milestones"><h4>Milestones</h4><div class="bl-v7-ms-row">';
    M.forEach(function (m) {
      var done = streak >= m;
      h += '<div class="bl-v7-ms' + (done ? ' done' : '') + '"><span>' + (done ? '✓' : '·') + '</span>' + m + 'd</div>';
    });
    h += '</div></div>';
    c.insertAdjacentHTML('beforeend', h);
    V7.renderAchievements(c);
  };

  /* ───────── 8. QUICK CARD UPGRADE + GUEST NUDGE ───────── */
  orig.renderPracticeArena = BrainLab.renderPracticeArena; /* arena.js's wrapped version */
  BrainLab.renderPracticeArena = function () {
    orig.renderPracticeArena.call(BrainLab);
    var c = document.getElementById('bl-arena');
    if (!c) return;
    var APPROX = { quick10: 'Approx. 5 minutes', quick25: 'Approx. 10–15 minutes', quick50: 'Approx. 25–35 minutes', custom: 'You choose', topic: 'You choose', difficulty: 'You choose', random: 'Approx. 8 minutes' };
    c.querySelectorAll('.bl-card').forEach(function (card) {
      var onclick = card.getAttribute('onclick') || '';
      var m = onclick.match(/startArenaMode\('([a-z0-9]+)'\)/);
      if (!m) return;
      var key = m[1];
      card.classList.add('bl-v7-quick');
      var sub = card.querySelector('.bl-card-subtitle');
      if (sub && APPROX[key] && sub.querySelector('.bl-v7-approx') === null) {
        sub.insertAdjacentHTML('beforeend', '<span class="bl-v7-approx">· ' + APPROX[key] + '</span>');
      }
      var btn = card.querySelector('.bl-card-cta');
      if (btn) btn.textContent = 'START';
    });
  };

  orig.renderStats = BrainLab.renderStats;
  BrainLab.renderStats = function () {
    orig.renderStats.call(BrainLab);
    var c = document.getElementById('bl-stats');
    if (!c || document.getElementById('bl-v7-xp-tile')) return;
    var tile = document.createElement('div');
    tile.id = 'bl-v7-xp-tile';
    tile.className = 'bl-stat';
    tile.innerHTML = '<div class="bl-stat-icon">🎖</div><div class="bl-stat-num">' + computeXP().toLocaleString() + '</div><div class="bl-stat-label">XP</div>';
    c.appendChild(tile);
    if (!BrainLab.user() && !document.getElementById('bl-v7-guest-nudge')) {
      var st = realStats();
      var nudge = document.createElement('div');
      nudge.id = 'bl-v7-guest-nudge';
      nudge.className = 'bl-v7-guest-nudge';
      nudge.innerHTML = (st.tests > 0
        ? 'Progress shown is saved on this device. <a href="javascript:void(0)" onclick="if(window.showAuthModal)showAuthModal();else BrainLab.toast(\'Please sign in from the menu.\')">Sign in</a> to sync, earn XP and compete on the leaderboard.'
        : 'Start your first test to track your progress. <a href="javascript:void(0)" onclick="if(window.showAuthModal)showAuthModal();else BrainLab.toast(\'Please sign in from the menu.\')">Sign in</a> to sync your progress.');
      c.parentElement.insertBefore(nudge, c.nextSibling);
    }
  };

  /* ───────── affairs section: "Test Today's Affairs" CTA ───────── */
  orig._renderAffairs = BrainLab._renderAffairs;
  BrainLab._renderAffairs = function (c, data) {
    orig._renderAffairs.call(BrainLab, c, data);
    if (!c || !data || !data.length || document.getElementById('bl-v7-affairs-cta')) return;
    c.insertAdjacentHTML('beforeend', '<div id="bl-v7-affairs-cta" class="bl-v7-affairs-cta"><button class="bl-v7-reco-btn" onclick="BrainLabV7.startAffairsQuiz()">TEST TODAY\'S AFFAIRS — 10 MCQs</button><span class="bl-v7-affairs-note">Quiz built from the updates above</span></div>');
  };

  /* ───────── boot: reorder sections, register render hooks ───────── */
  V7.boot = function () {
    var page = document.getElementById('page-brainlab');
    if (!page || V7._booted) return;
    V7._booted = true;

    /* Exam Hub + Recommended containers already exist in DOM (index.html). */
    var order = ['bl-sec-continue', 'bl-sec-challenge', 'bl-sec-recommended', 'bl-sec-exams', 'bl-sec-arena', 'bl-sec-quizzes', 'bl-sec-mocks', 'bl-sec-flashcards', 'bl-sec-affairs', 'bl-sec-pyq', 'bl-sec-mcqs', 'bl-sec-mistakes', 'bl-sec-performance', 'bl-sec-leaderboard', 'bl-sec-streak', 'bl-sec-tools'];
    order.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) page.appendChild(el);
    });
    var navWrap = page.querySelector('.bl-nav');
    if (navWrap) {
      var navOrder = ['bl-sec-exams', 'bl-sec-continue', 'bl-sec-challenge', 'bl-sec-recommended', 'bl-sec-arena', 'bl-sec-quizzes', 'bl-sec-mocks', 'bl-sec-flashcards', 'bl-sec-affairs', 'bl-sec-pyq', 'bl-sec-mcqs', 'bl-sec-mistakes', 'bl-sec-performance', 'bl-sec-leaderboard', 'bl-sec-streak', 'bl-sec-tools'];
      navOrder.forEach(function (id) {
        var a = navWrap.querySelector('[data-target="' + id + '"]');
        if (a) navWrap.appendChild(a);
      });
      var examsNav = navWrap.querySelector('[data-target="bl-sec-exams"]');
      if (examsNav) examsNav.textContent = '🎯 Exams';
      var recoNav = navWrap.querySelector('[data-target="bl-sec-recommended"]');
      if (recoNav) recoNav.textContent = '✨ Recommended';
    }
    var origAll = BrainLab.renderAll;
    BrainLab.renderAll = function () {
      origAll.call(BrainLab);
      try { V7.renderExamHub(); } catch (e) { }
      try { V7.renderRecommended(); } catch (e) { }
    };
    if (BrainLab.initialized) { V7.renderExamHub(); V7.renderRecommended(); }
  };

  window.BrainLabV7 = V7;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', V7.boot);
  else V7.boot();
  var _iv = setInterval(function () {
    if (document.getElementById('page-brainlab')) { V7.boot(); clearInterval(_iv); }
  }, 1200);
  setTimeout(function () { clearInterval(_iv); }, 60000);
})();
