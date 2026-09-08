/* ════════════════════════════════════════════════════════════════
   brainlab-mock.js — Studyria Mock Test Engine (V8 Phase B, additive)
   ════════════════════════════════════════════════════════════════
   Real exam-style mock experience for mode==='mock' sessions ONLY.
   Every other mode (quiz/arena/daily/custom/pyq) keeps the original
   learn-player untouched — this layer wraps, never replaces.

   Features:
   - No instant feedback — answers stay private until submission
   - Change / clear answers freely (real exam behaviour)
   - Question palette drawer with live state (answered / marked / unseen)
   - Mark for review + clear response
   - Countdown timer (1 min per question — standard mock convention)
     with auto-submit at 00:00
   - Submit summary (attempted / marked / unanswered) before final submit
   - On submit -> original BrainLab._finishQuiz (session recording,
     streak, mistakes, review page — all existing logic preserved)

   ZERO changes to: backend, DB, RPC, auth, payment, session recording.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function B() { return window.BrainLab; }

  var M = window.BrainLabMock = {
    active: false, marked: {}, duration: 0, endAt: 0,
    tick: null, submitted: false, paletteOpen: false
  };
  M.reset = function () {
    if (M.tick) { clearInterval(M.tick); M.tick = null; }
    M.active = false; M.marked = {}; M.duration = 0; M.endAt = 0;
    M.submitted = false; M.paletteOpen = false;
  };

  function esc(s) { var bl = B(); return bl ? bl.escape(s) : String(s); }
  function t(en, as) { var bl = B(); return (bl && bl._lang === 'as') ? as : en; }

  function remaining() { return Math.max(0, Math.ceil((M.endAt - Date.now()) / 1000)); }
  function fmt(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  /* MOCK PLAYER UI */
  M.render = function () {
    var bl = B(); if (!bl || !M.active) return;
    var c = document.getElementById('bl-quiz-player-area'); if (!c) return;
    var idx = bl._currentQIdx, q = bl._currentQuiz.questions[idx];
    if (!q) return;
    var total = bl._currentQuiz.questions.length;
    var disp = (window.BrainLabTranslate && BrainLabTranslate.getDisplay(q, bl._lang)) || { question: q.question_text, options: q.options };
    if (!q._shuffled) {
      var fresh = [{ label: 'A', text: disp.options.A, original: 'a' === q.correct_answer },
                   { label: 'B', text: disp.options.B, original: 'b' === q.correct_answer },
                   { label: 'C', text: disp.options.C, original: 'c' === q.correct_answer },
                   { label: 'D', text: disp.options.D, original: 'd' === q.correct_answer }];
      q._shuffled = bl.shuffle(fresh);
    }
    var cur = bl._answers[idx];
    var selIdx = (cur && !cur.skipped) ? cur.selectedIndex : -1;
    var marked = !!M.marked[idx];
    var left = remaining();

    var h = '<div class="bl-mk">'
      + '<div class="bl-mk-head">'
      + '<div class="bl-mk-title">' + esc(bl._currentQuiz.title || 'Mock Test') + '</div>'
      + '<div class="bl-mk-timer' + (left <= 60 ? ' bl-mk-urgent' : '') + '" id="bl-mk-timer">&#9201; ' + fmt(left) + '</div>'
      + '</div>'
      + '<div class="bl-mk-bar"><div class="bl-mk-bar-fill" style="width:' + ((idx / total) * 100) + '%"></div></div>'
      + '<div class="bl-mk-info"><span>' + t('Question', '\u09AA\u09CD\u09B0\u09B6\u09CD\u09A8') + ' ' + (idx + 1) + ' / ' + total + '</span>'
      + '<button class="bl-mk-palette-btn" onclick="BrainLabMock.togglePalette()">&#9776; ' + t('Palette', '\u09AA\u09BE\u09B2\u09C7\u099F') + '</button></div>';

    /* palette drawer */
    var nDone = bl._answers.filter(function (x) { return x !== undefined && x !== null && !x.skipped; }).length;
    var nMark = Object.keys(M.marked).filter(function (k) { return M.marked[k]; }).length;
    h += '<div class="bl-mk-palette' + (M.paletteOpen ? ' bl-mk-open' : '') + '" id="bl-mk-palette">';
    h += '<div class="bl-mk-pl-grid">';
    for (var i = 0; i < total; i++) {
      var a = bl._answers[i];
      var cls = 'bl-mk-pl';
      if (a !== undefined && a !== null && !a.skipped) cls += ' bl-mk-pl-done';
      if (M.marked[i]) cls += ' bl-mk-pl-mark';
      if (i === idx) cls += ' bl-mk-pl-cur';
      h += '<button class="' + cls + '" onclick="BrainLabMock.jump(' + i + ')">' + (i + 1) + (M.marked[i] ? ' \u2691' : '') + '</button>';
    }
    h += '</div>';
    h += '<div class="bl-mk-pl-legend"><span class="bl-mk-pl bl-mk-pl-done">' + t('Answered', '\u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BF\u09DF\u09BE') + ': ' + nDone + '</span>'
      + '<span class="bl-mk-pl bl-mk-pl-mark">' + t('Marked', '\u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4') + ': ' + nMark + '</span>'
      + '<span class="bl-mk-pl">' + t('Unanswered', '\u0989\u09A4\u09CD\u09A4\u09B0 \u09A8\u09BF\u09A6\u09BF\u09DF\u09BE') + ': ' + (total - nDone) + '</span></div>'
      + '<button class="bl-mk-submit" onclick="BrainLabMock.confirmSubmit()">&#10003; ' + t('SUBMIT TEST', '\u099F\u09C7\u09B7\u09CD\u099F \u099C\u09AE\u09BE \u09A6\u09BF\u09DF\u0995') + '</button>'
      + '</div>';

    /* question */
    h += '<div class="bl-mk-topic">' + esc(q.topic || q.category || '') + (q.difficulty ? ' \u00B7 ' + esc(q.difficulty) : '') + '</div>'
      + '<div class="bl-mk-question">' + esc(disp.question) + '</div>'
      + '<div class="bl-mk-options">';
    q._shuffled.forEach(function (o, i) {
      h += '<div class="bl-mk-opt' + (i === selIdx ? ' bl-mk-sel' : '') + '" onclick="BrainLabMock.select(' + i + ')">'
        + '<span class="bl-mk-opt-l">' + o.label + '</span><span class="bl-mk-opt-t">' + esc(o.text) + '</span></div>';
    });
    h += '</div>';

    /* actions */
    h += '<div class="bl-mk-actions">'
      + (idx > 0 ? '<button class="bl-mk-btn" onclick="BrainLabMock.prev()">\u2190 ' + t('Prev', '\u0986\u0997\u09B0') + '</button>' : '<span></span>')
      + '<button class="bl-mk-btn' + (marked ? ' bl-mk-btn-on' : '') + '" onclick="BrainLabMock.mark()">\u2691 ' + (marked ? t('Marked', '\u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4') : t('Mark for Review', '\u09AA\u09B0\u09CD\u09AF\u09BE\u09B2\u09CB\u099A\u09A8\u09BE\u09F0 \u09AC\u09BE\u09AC\u09C7 \u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4')) + '</button>'
      + (cur ? '<button class="bl-mk-btn" onclick="BrainLabMock.clear()">' + t('Clear', '\u09AE\u099A\u0995') + '</button>' : '<span></span>')
      + (idx < total - 1
          ? '<button class="bl-mk-btn bl-mk-next" onclick="BrainLabMock.next()">' + t('Save & Next', '\u099C\u09AE\u09BE \u0995\u09B0\u09BF \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0') + ' \u2192</button>'
          : '<button class="bl-mk-btn bl-mk-next" onclick="BrainLabMock.confirmSubmit()">\u2713 ' + t('Submit', '\u099C\u09AE\u09BE \u09A6\u09BF\u09DF\u0995') + '</button>')
      + '</div>'
      + '<button class="bl-mk-quit" onclick="BrainLabMock.abort()">' + t('Abort Test', '\u099F\u09C7\u09B7\u09CD\u099F \u09AC\u09BE\u09A4\u09BF\u09B2') + '</button>'
      + '</div>';
    c.innerHTML = h;
    c.style.display = 'block';
  };

  /* mock controls */
  M.select = function (optIdx) {
    var bl = B(); if (!bl || !M.active || M.submitted) return;
    var q = bl._currentQuiz.questions[bl._currentQIdx]; if (!q || !q._shuffled) return;
    var sel = q._shuffled[optIdx];
    /* identical answer shape to the original selectAnswer — keeps
       _finishQuiz scoring, review page and mistake saving consistent */
    bl._answers[bl._currentQIdx] = { selectedAnswer: sel.original, isCorrect: !!sel.original, questionId: q.id, selectedIndex: optIdx };
    M.render();
  };
  M.clear = function () { var bl = B(); if (!bl) return; delete bl._answers[bl._currentQIdx]; M.render(); };
  M.mark = function () { var bl = B(); if (!bl) return; var i = bl._currentQIdx; M.marked[i] = !M.marked[i]; M.render(); };
  M.next = function () { var bl = B(); if (!bl) return; if (bl._currentQIdx < bl._currentQuiz.questions.length - 1) { bl._currentQIdx++; M.render(); } };
  M.prev = function () { var bl = B(); if (!bl) return; if (bl._currentQIdx > 0) { bl._currentQIdx--; M.render(); } };
  M.jump = function (i) { var bl = B(); if (!bl) return; if (i >= 0 && i < bl._currentQuiz.questions.length) { bl._currentQIdx = i; M.paletteOpen = false; M.render(); } };
  M.togglePalette = function () { M.paletteOpen = !M.paletteOpen; M.render(); };

  M.confirmSubmit = function () {
    var bl = B(); if (!bl || M.submitted) return;
    var total = bl._currentQuiz.questions.length;
    var nDone = bl._answers.filter(function (x) { return x !== undefined && x !== null && !x.skipped; }).length;
    var nMark = Object.keys(M.marked).filter(function (k) { return M.marked[k]; }).length;
    var msg = t('Submit this test?', '\u098F\u0987 \u099F\u09C7\u09B7\u09CD\u099F \u099C\u09AE\u09BE \u09A6\u09BF\u09AC \u09A8\u09C7?')
      + '\n\n' + t('Attempted', '\u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BF\u09DF\u09BE') + ': ' + nDone + ' / ' + total
      + '\n' + t('Marked for review', '\u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4') + ': ' + nMark
      + '\n' + t('Unanswered', '\u0989\u09A4\u09CD\u09A4\u09B0 \u09A8\u09BF\u09A6\u09BF\u09DF\u09BE') + ': ' + (total - nDone)
      + '\n\n' + t('Time left', '\u09AC\u09BE\u0995\u09C0 \u09B8\u09AE\u09DF') + ': ' + fmt(remaining());
    if (!confirm(msg)) return;
    M.submit();
  };

  M.submit = function () {
    var bl = B(); if (!bl || M.submitted) return;
    M.submitted = true;
    /* unanswered become null (same as the original nextQuestion on last q) */
    var total = bl._currentQuiz.questions.length;
    for (var i = 0; i < total; i++) { if (bl._answers[i] === undefined) bl._answers[i] = null; }
    M.reset();
    bl._finishQuiz(); /* original result + session recording */
  };

  M.abort = function () {
    if (!confirm(t('Abort this mock test? Your progress will be lost.', '\u098F\u0987 \u09AE\u0995 \u099F\u09C7\u09B7\u09CD\u099F \u09AC\u09BE\u09A4\u09BF\u09B2 \u0995\u09B0\u09BF\u09AC \u09A8\u09C7? \u09A4\u09CB\u09AE\u09BE\u09F0 \u0985\u0997\u09CD\u09B0\u0997\u09A4\u09BF \u09B9\u09C7\u09B0\u09BE\u09AC\u0964'))) return;
    var bl = B(); M.reset();
    if (bl) bl.quitQuiz();
  };

  /* countdown ticker — auto-submit at 00:00 */
  M.startTicker = function () {
    if (M.tick) clearInterval(M.tick);
    M.tick = setInterval(function () {
      if (!M.active) { clearInterval(M.tick); M.tick = null; return; }
      var el = document.getElementById('bl-mk-timer');
      var left = remaining();
      if (el) { el.textContent = '\u23F1 ' + fmt(left); if (left <= 60) el.classList.add('bl-mk-urgent'); }
      if (left <= 0) {
        var bl = B();
        if (bl && M.active && !M.submitted) {
          alert(t('Time is up! Your test is being submitted automatically.', '\u09B8\u09AE\u09DF \u09B6\u09C7\u09B7! \u09A4\u09CB\u09AE\u09BE\u09F0 \u099F\u09C7\u09B7\u09CD\u099F \u09B8\u09CD\u09AC\u09DF\u0982\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u099C\u09AE\u09BE \u09A6\u09BF\u09DF\u09BE \u09B9\u09C8\u099B\u09C7\u0964'));
          M.submit();
        }
      }
    }, 1000);
  };

  /* WRAP the player — mock mode only */
  function wrap() {
    var bl = B(); if (!bl || bl.__mockWrapped) return; bl.__mockWrapped = true;

    var oStart = bl._startPlayer, oRender = bl._renderQuestion,
        oTimer = bl._updateTimer, oQuit = bl.quitQuiz;

    bl._startPlayer = function (opts) {
      M.reset();
      if (opts && opts.mode === 'mock') {
        M.active = true;
        M.duration = Math.max(1, (opts.questions || []).length) * 60; /* 1 min/question */
        M.endAt = Date.now() + M.duration * 1000;
      }
      var r = oStart.apply(this, arguments);
      if (M.active) M.startTicker();
      return r;
    };
    bl._renderQuestion = function () {
      if (M.active) { M.render(); return; }
      return oRender.apply(this, arguments);
    };
    bl._updateTimer = function () {
      if (M.active) return; /* mock has its own countdown ticker */
      return oTimer.apply(this, arguments);
    };
    bl.quitQuiz = function () {
      M.reset();
      return oQuit.apply(this, arguments);
    };
  }

  /* boot after BrainLab exists (route scripts load in order) */
  function boot() {
    if (B()) { wrap(); return; }
    setTimeout(boot, 300);
  }
  boot();
})();
