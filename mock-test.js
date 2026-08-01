/**
 * ═══════════════════════════════════════════════════════════════════════════
 * mock-test.js — Studyria V5.1 Module 1: Mock Test Premium
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[MockTest] Revenue core not loaded'); return; }

  let _state = { currentTest: null, currentQuestions: [], answers: {}, startTime: 0, tab: 'all' };

  // ── Render: Test Series List ──────────────────────────────────────────────
  async function renderSeries(container) {
    if (!container) return;
    container.innerHTML = R().skeletonHTML(6);

    try {
      const series = await R().safeQuery('mock_test_series', {
        select: 'id,title,description,series_type,cover_image,is_premium,sort_order',
        order: { column: 'sort_order', ascending: true },
        limit: 50
      });

      if (!series.length) { container.innerHTML = R().emptyHTML('📝', 'No test series available yet.'); return; }

      container.innerHTML = series.map(s => `
        <div class="rm-card rm-product-card" onclick="MockTest.openSeries('${s.id}')">
          <div class="rm-product-thumb">${(s.cover_image ? `<img src="${R().sanitize(s.cover_image)}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" alt="">` : '📝')}</div>
          <h3 class="rm-card-title">${R().sanitize(s.title)}</h3>
          <p class="rm-card-subtitle">${R().sanitize(s.description?.slice(0, 80) || '')}</p>
          <div style="margin-top:8px">
            <span class="rm-badge ${s.is_premium ? 'rm-badge-premium' : 'rm-badge-free'}">${s.is_premium ? '⭐ Premium' : 'Free'}</span>
            <span class="rm-badge rm-badge-new" style="margin-left:4px">${R().sanitize(s.series_type?.replace(/_/g, ' ') || '')}</span>
          </div>
        </div>`).join('');
    } catch (e) { container.innerHTML = R().errorHTML(e.message); }
  }

  // ── Render: Tests within a series ─────────────────────────────────────────
  async function openSeries(seriesId) {
    const modal = R().openModal('Tests', '<div id="mtTestsList">' + R().skeletonHTML(4) + '</div>');
    try {
      const tests = await R().safeQuery('mock_tests', {
        select: 'id,title,description,duration_minutes,total_marks,is_premium,is_published,test_type,scheduled_at',
        eq: { series_id: seriesId },
        order: { column: 'sort_order', ascending: true },
        limit: 50
      });
      const body = document.getElementById('rmModalBody');
      if (!tests.length) { body.innerHTML = R().emptyHTML('📝', 'No tests in this series yet.'); return; }
      body.innerHTML = `<div class="rm-grid rm-grid-2">${tests.map(t => `
        <div class="rm-card" onclick="MockTest.startTest('${t.id}')">
          <h3 class="rm-card-title">${R().sanitize(t.title)}</h3>
          <p class="rm-card-subtitle">${R().sanitize(t.description?.slice(0, 60) || '')}</p>
          <div style="display:flex;gap:8px;margin:8px 0;font-size:0.78rem;color:var(--rm-text-muted)">
            <span>⏱️ ${t.duration_minutes} min</span><span>📊 ${t.total_marks} marks</span>
          </div>
          <button class="rm-btn ${t.is_premium ? 'rm-btn-gold' : 'rm-btn-primary'}" style="width:100%">
            ${t.is_premium ? '⭐ Start Premium Test' : 'Start Test'}
          </button>
        </div>`).join('')}</div>`;
    } catch (e) { body.innerHTML = R().errorHTML(e.message); }
  }

  // ── Start a test ──────────────────────────────────────────────────────────
  async function startTest(testId) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to take a test.', 'info'); if (typeof navigate === 'function') navigate('login'); return; }

    R().closeModal();
    const page = document.getElementById('page-mock-test');
    if (!page) return;

    page.innerHTML = `<div class="rm-container"><div id="mtTestArea">${R().skeletonHTML(4)}</div></div>`;

    try {
      const questions = await R().safeQuery('mock_questions', {
        select: 'id,question_text,option_a,option_b,option_c,option_d,marks,negative_marks,topic,difficulty,sort_order',
        eq: { test_id: testId },
        order: { column: 'sort_order', ascending: true },
        publishedOnly: false,
        limit: 100
      });

      const tests = await R().safeQuery('mock_tests', {
        select: 'id,title,duration_minutes,total_marks,negative_marking',
        eq: { id: testId },
        single: true,
        publishedOnly: false
      });

      if (!questions.length || !tests) { document.getElementById('mtTestArea').innerHTML = R().emptyHTML('📝', 'No questions in this test yet.'); return; }

      _state.currentTest = tests;
      _state.currentQuestions = questions;
      _state.answers = {};
      _state.startTime = Date.now();

      renderTestPage();
    } catch (e) { document.getElementById('mtTestArea').innerHTML = R().errorHTML(e.message); }
  }

  function renderTestPage() {
    const t = _state.currentTest;
    const qs = _state.currentQuestions;
    const page = document.getElementById('page-mock-test');
    if (!page || !t) return;

    page.innerHTML = `<div class="rm-container">
      <div class="rm-header">
        <div><h1>${R().sanitize(t.title)}</h1><p>⏱️ ${t.duration_minutes} min | 📊 ${t.total_marks} marks | ❌ Negative: ${t.negative_marking || 0}</p></div>
        <div id="mtTimer" style="font-size:1.3rem;font-weight:800;color:var(--rm-gold)">${t.duration_minutes}:00</div>
      </div>
      <div id="mtQuestions">${qs.map((q, i) => renderQuestion(q, i)).join('')}</div>
      <div style="margin:24px 0;text-align:center">
        <button class="rm-btn rm-btn-primary" onclick="MockTest.submitTest()" style="padding:14px 48px;font-size:1rem">Submit Test</button>
      </div>
    </div>`;

    // Timer
    const end = _state.startTime + t.duration_minutes * 60000;
    _state._timer = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      const el = document.getElementById('mtTimer');
      if (el) el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      if (left <= 0) { clearInterval(_state._timer); submitTest(); }
    }, 1000);
  }

  function renderQuestion(q, idx) {
    const opts = [
      { key: 'a', text: q.option_a },
      { key: 'b', text: q.option_b },
      { key: 'c', text: q.option_c },
      { key: 'd', q.option_d }
    ].filter(o => o.text);

    return `<div class="rm-card rm-question" data-q="${q.id}">
      <div class="rm-question-text">${idx + 1}. ${R().sanitize(q.question_text)}</div>
      <div class="rm-options">${opts.map(o => `
        <div class="rm-option" onclick="MockTest.selectAnswer('${q.id}','${o.key}')">
          <div class="rm-option-letter">${o.key.toUpperCase()}</div>
          <div class="rm-option-text">${R().sanitize(o.text)}</div>
        </div>`).join('')}</div>
      <div style="margin-top:8px;font-size:0.75rem;color:var(--rm-text-muted)">
        📁 ${R().sanitize(q.topic || 'General')} | 📊 ${q.marks} marks | ${R().sanitize(q.difficulty || 'medium')}
      </div>
    </div>`;
  }

  function selectAnswer(qId, answer) {
    _state.answers[qId] = answer;
    const card = document.querySelector(`[data-q="${qId}"]`);
    if (!card) return;
    card.querySelectorAll('.rm-option').forEach(opt => {
      opt.classList.remove('selected');
      const letter = opt.querySelector('.rm-option-letter').textContent.toLowerCase();
      if (letter === answer) opt.classList.add('selected');
    });
  }

  async function submitTest() {
    if (_state._timer) clearInterval(_state._timer);
    const t = _state.currentTest;
    const qs = _state.currentQuestions;
    if (!t || !qs) return;

    let correct = 0, wrong = 0, unanswered = 0, score = 0;

    qs.forEach(q => {
      const ans = _state.answers[q.id];
      if (!ans) { unanswered++; return; }
      if (ans === q.correct_answer) { correct++; score += q.marks; }
      else { wrong++; score -= (q.negative_marks || t.negative_marking || 0); }
    });

    score = Math.max(0, score);
    const percentage = Math.round((score / t.total_marks) * 100);
    const timeSpent = Math.floor((Date.now() - _state.startTime) / 1000);

    const user = await R()._user();
    if (user) {
      try {
        await R().safeInsert('mock_attempts', {
          test_id: t.id,
          user_id: user.id,
          answers: _state.answers,
          score, total_correct: correct, total_wrong: wrong, total_unanswered: unanswered,
          time_spent_seconds: timeSpent, percentage, is_passed: percentage >= (t.pass_percentage || 40),
          completed_at: new Date().toISOString()
        });
        await R().safeInsert('leaderboards', {
          test_id: t.id, user_id: user.id,
          user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
          state: 'Assam', score, percentage, time_spent_seconds: timeSpent
        });
      } catch (e) { console.error('[MockTest] Save attempt failed:', e); }
    }

    showResults(score, correct, wrong, unanswered, percentage, timeSpent);
  }

  function showResults(score, correct, wrong, unanswered, pct, time) {
    const page = document.getElementById('page-mock-test');
    if (!page) return;
    page.innerHTML = `<div class="rm-container" style="max-width:600px;text-align:center;padding-top:40px">
      <div class="rm-card" style="padding:40px">
        <div style="font-size:3rem;margin-bottom:12px">${pct >= 40 ? '🎉' : '💪'}</div>
        <h1 style="font-size:2.2rem;font-weight:800;color:${pct >= 40 ? 'var(--rm-success)' : 'var(--rm-danger)'}">${pct}%</h1>
        <p style="color:var(--rm-text-muted);margin:8px 0">${pct >= 40 ? 'Passed!' : 'Keep practicing!'}</p>
        <div class="rm-grid rm-grid-3" style="margin:24px 0">
          <div class="rm-card"><div class="rm-stat-value" style="color:var(--rm-success)">${correct}</div><div class="rm-stat-label">Correct</div></div>
          <div class="rm-card"><div class="rm-stat-value" style="color:var(--rm-danger)">${wrong}</div><div class="rm-stat-label">Wrong</div></div>
          <div class="rm-card"><div class="rm-stat-value">${unanswered}</div><div class="rm-stat-label">Skipped</div></div>
        </div>
        <div class="rm-grid rm-grid-2" style="margin:16px 0">
          <div class="rm-card"><div class="rm-stat-value">${score}</div><div class="rm-stat-label">Score</div></div>
          <div class="rm-card"><div class="rm-stat-value">${R().formatTime(time)}</div><div class="rm-stat-label">Time</div></div>
        </div>
        <button class="rm-btn rm-btn-primary" onclick="navigate('mock-test')">Back to Tests</button>
      </div>
    </div>`;
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────
  async function renderLeaderboard(container) {
    if (!container) return;
    container.innerHTML = R().skeletonHTML(8);
    try {
      const lb = await R().safeQuery('leaderboards', {
        select: 'user_name,score,percentage,state,district,time_spent_seconds,created_at',
        order: { column: 'score', ascending: false },
        limit: 50,
        publishedOnly: false
      });
      if (!lb.length) { container.innerHTML = R().emptyHTML('🏆', 'No leaderboard entries yet.'); return; }
      container.innerHTML = `<div class="rm-card" style="overflow-x:auto">
        <table class="rm-table"><thead><tr>
          <th>Rank</th><th>Name</th><th>Score</th><th>%</th><th>State</th><th>Time</th>
        </tr></thead><tbody>${lb.map((e, i) => `
          <tr><td style="font-weight:700;color:${i < 3 ? 'var(--rm-gold)' : 'var(--rm-text)'}">#${i + 1}</td>
          <td>${R().sanitize(e.user_name)}</td>
          <td style="font-weight:700">${e.score}</td>
          <td>${e.percentage}%</td>
          <td>${R().sanitize(e.state || 'Assam')}</td>
          <td>${R().formatTime(e.time_spent_seconds || 0)}</td>
          </tr>`).join('')}</tbody></table></div>`;
    } catch (e) { container.innerHTML = R().errorHTML(e.message); }
  }

  // ── My Attempts (history) ─────────────────────────────────────────────────
  async function renderMyAttempts(container) {
    if (!container) return;
    const user = await R()._user();
    if (!user) { container.innerHTML = R().emptyHTML('🔒', 'Please login to view your attempts.'); return; }
    container.innerHTML = R().skeletonHTML(4);
    try {
      const sb = R()._sb();
      const { data } = await sb.from('mock_attempts')
        .select('id,test_id,score,percentage,total_correct,total_wrong,time_spent_seconds,completed_at,created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      if (!data?.length) { container.innerHTML = R().emptyHTML('📝', 'No attempts yet. Take a test to see your history!'); return; }
      container.innerHTML = `<div class="rm-grid rm-grid-2">${data.map(a => `
        <div class="rm-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="rm-stat-value">${a.percentage}%</span>
            <span class="rm-badge ${a.percentage >= 40 ? 'rm-badge-free' : 'rm-badge-premium'}">${a.percentage >= 40 ? 'Passed' : 'Failed'}</span>
          </div>
          <div style="display:flex;gap:12px;margin-top:8px;font-size:0.78rem;color:var(--rm-text-muted)">
            <span>✅ ${a.total_correct}</span><span>❌ ${a.total_wrong}</span><span>⏱️ ${R().formatTime(a.time_spent_seconds || 0)}</span>
          </div>
          <div style="margin-top:6px;font-size:0.75rem;color:var(--rm-text-muted)">${R().timeAgo(a.created_at)}</div>
        </div>`).join('')}</div>`;
    } catch (e) { container.innerHTML = R().errorHTML(e.message); }
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function render(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="rm-tabs" id="mtTabs">
        <div class="rm-tab active" onclick="MockTest._tab('series')">📝 Test Series</div>
        <div class="rm-tab" onclick="MockTest._tab('leaderboard')">🏆 Leaderboard</div>
        <div class="rm-tab" onclick="MockTest._tab('history')">📊 My History</div>
      </div>
      <div id="mtContent"></div>`;
    _tab('series');
  }

  function _tab(tab) {
    _state.tab = tab;
    document.querySelectorAll('#mtTabs .rm-tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList.add('active');
    const content = document.getElementById('mtContent');
    if (!content) return;
    if (tab === 'series') renderSeries(content);
    else if (tab === 'leaderboard') renderLeaderboard(content);
    else if (tab === 'history') renderMyAttempts(content);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.MockTest = Object.freeze({
    render, renderSeries, openSeries, startTest, selectAnswer, submitTest, _tab,
    renderLeaderboard, renderMyAttempts,
    init: () => { const p = document.getElementById('page-mock-test'); if (p && p.classList.contains('active')) render(p.querySelector('#mtContent') || p); }
  });

  R().register('mockTest', root.MockTest);
  console.log('[MockTest] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
