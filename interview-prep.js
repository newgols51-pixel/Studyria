/**
 * ═══════════════════════════════════════════════════════════════════════════
 * interview-prep.js — Studyria V5.1 Module 7: Interview Preparation
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[InterviewPrep] Core not loaded'); return; }

  let _tab = 'packages';

  async function render(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="rm-tabs" id="ipTabs">
        <div class="rm-tab active" onclick="InterviewPrep._tab('packages')">🎯 Interview Packages</div>
        <div class="rm-tab" onclick="InterviewPrep._tab('history')">📊 My Attempts</div>
      </div>
      <div id="ipContent">${R().skeletonHTML(6)}</div>`;
    _loadPackages();
  }

  function _tab(t) {
    _tab = t;
    document.querySelectorAll('#ipTabs .rm-tab').forEach(x => x.classList.remove('active'));
    event?.target?.classList.add('active');
    if (_tab === 'packages') _loadPackages();
    else _loadHistory();
  }

  async function _loadPackages() {
    const c = document.getElementById('ipContent');
    if (!c) return;
    try {
      const packages = await R().safeQuery('interviews', {
        select: 'id,title,description,category,difficulty,duration_minutes,is_premium,package_name,sort_order',
        order: { column: 'sort_order', ascending: true }, limit: 30
      });
      if (!packages.length) { c.innerHTML = R().emptyHTML('🎤', 'No interview packages available yet.'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-3">${packages.map(p => `
        <div class="rm-card rm-product-card" onclick="InterviewPrep._openPackage('${p.id}')">
          <div class="rm-product-thumb" style="background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(61,142,248,0.06))">🎤</div>
          <h3 class="rm-card-title">${R().sanitize(p.title)}</h3>
          <p class="rm-card-subtitle">${R().sanitize(p.description?.slice(0, 80) || '')}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
            <span class="rm-badge rm-badge-new">${R().sanitize(p.category || 'hr')}</span>
            <span class="rm-badge">📊 ${R().sanitize(p.difficulty || 'medium')}</span>
            <span class="rm-badge">⏱️ ${p.duration_minutes || 30}min</span>
            ${p.is_premium ? '<span class="rm-badge rm-badge-premium">⭐ Premium</span>' : ''}
          </div>
          <button class="rm-btn ${p.is_premium ? 'rm-btn-gold' : 'rm-btn-primary'}" style="width:100%">Start Practice</button>
        </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function _openPackage(pkgId) {
    try {
      const { data: pkg } = await R()._sb().from('interviews').select('*').eq('id', pkgId).single();
      if (!pkg) return;
      const questions = pkg.questions || [];

      R().openModal(pkg.title, `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span class="rm-badge rm-badge-new">${R().sanitize(pkg.category || 'hr')}</span>
          <span class="rm-badge">📊 ${R().sanitize(pkg.difficulty || 'medium')}</span>
          <span class="rm-badge">⏱️ ${pkg.duration_minutes || 30}min</span>
          ${pkg.is_premium ? '<span class="rm-badge rm-badge-premium">⭐ Premium</span>' : '<span class="rm-badge rm-badge-free">Free</span>'}
        </div>
        <p class="rm-card-subtitle">${R().sanitize(pkg.description || '')}</p>
        <h3 style="color:var(--rm-text);margin:16px 0 8px;font-size:1rem">Questions (${questions.length})</h3>
        <div id="ipQuestions">${questions.map((q, i) => `
          <div class="rm-card rm-interview-question">
            <div style="font-weight:600;color:var(--rm-text);margin-bottom:8px">Q${i+1}. ${R().sanitize(typeof q === 'string' ? q : (q.text || q.question || ''))}</div>
            ${typeof q === 'object' && q.tip ? `<div style="font-size:0.78rem;color:var(--rm-text-muted)">💡 ${R().sanitize(q.tip)}</div>` : ''}
          </div>`).join('') || R().emptyHTML('📝', 'No questions in this package yet.')}</div>
        ${pkg.is_premium ? `<button class="rm-btn rm-btn-gold" style="width:100%;margin-top:16px" onclick="navigate('premium')">Upgrade to Practice</button>`
          : `<button class="rm-btn rm-btn-primary" style="width:100%;margin-top:16px" onclick="InterviewPrep._startMock('${pkg.id}')">Start Mock Interview</button>`}
      `);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _startMock(pkgId) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to start a mock interview.', 'info'); if (typeof navigate === 'function') navigate('login'); return; }
    R().closeModal();

    try {
      const { data: pkg } = await R()._sb().from('interviews').select('*').eq('id', pkgId).single();
      if (!pkg) return;
      const questions = pkg.questions || [];
      if (!questions.length) { R().toast('No questions available.', 'info'); return; }

      const page = document.getElementById('page-interview-prep');
      if (!page) return;

      let currentIdx = 0;
      const answers = [];
      const startTime = Date.now();

      function renderQ() {
        const q = questions[currentIdx];
        const qText = typeof q === 'string' ? q : (q.text || q.question || '');
        page.innerHTML = `<div class="rm-container" style="max-width:700px">
          <button class="rm-btn rm-btn-ghost" style="margin-bottom:16px" onclick="navigate('interview-prep')">← Back</button>
          <div class="rm-card rm-interview-question">
            <div style="font-size:0.78rem;color:var(--rm-text-muted)">Question ${currentIdx + 1} of ${questions.length}</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--rm-text);margin:12px 0">${R().sanitize(qText)}</div>
            ${typeof q === 'object' && q.tip ? `<div style="font-size:0.82rem;color:var(--rm-text-muted);margin-bottom:12px">💡 ${R().sanitize(q.tip)}</div>` : ''}
            <textarea class="rm-textarea" id="ipAnswer" placeholder="Type your answer here..."></textarea>
            <div style="display:flex;gap:8px;margin-top:16px">
              ${currentIdx > 0 ? `<button class="rm-btn rm-btn-ghost" onclick="InterviewPrep._prevQ()">← Previous</button>` : ''}
              <button class="rm-btn rm-btn-primary" style="flex:1" onclick="InterviewPrep._nextQ()">${currentIdx < questions.length - 1 ? 'Next →' : 'Submit Interview'}</button>
            </div>
          </div>
        </div>`;
      }

      root.InterviewPrep._nextQ = () => {
        const ans = document.getElementById('ipAnswer')?.value || '';
        answers[currentIdx] = { question: typeof questions[currentIdx] === 'string' ? questions[currentIdx] : questions[currentIdx].text, answer: ans };
        if (currentIdx < questions.length - 1) { currentIdx++; renderQ(); }
        else _submitMock(pkgId, answers, startTime);
      };

      root.InterviewPrep._prevQ = () => { if (currentIdx > 0) { currentIdx--; renderQ(); } };
      renderQ();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _submitMock(pkgId, answers, startTime) {
    const user = await R()._user();
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const confidence = Math.min(100, Math.max(20, Math.round(answers.filter(a => a.answer?.length > 20).length / answers.length * 100)));

    try {
      const { data: attempt } = await R()._sb().from('interview_attempts').insert({
        interview_id: pkgId, user_id: user.id, answers,
        confidence_score: confidence, ai_feedback: { completed: true },
        duration_seconds: duration, is_premium: false
      }).select().single();

      const page = document.getElementById('page-interview-prep');
      if (page) {
        page.innerHTML = `<div class="rm-container" style="max-width:600px;text-align:center;padding-top:40px">
          <div class="rm-card" style="padding:32px">
            <div style="font-size:3rem;margin-bottom:12px">🎤</div>
            <h1 style="font-size:1.5rem;font-weight:800;color:var(--rm-text)">Interview Complete!</h1>
            <div class="rm-progress" style="margin:24px 0"><div class="rm-progress-fill" style="width:${confidence}%"></div></div>
            <p style="font-size:1.2rem;font-weight:700;color:${confidence >= 70 ? 'var(--rm-success)' : confidence >= 50 ? 'var(--rm-gold)' : 'var(--rm-danger)'}">Confidence Score: ${confidence}/100</p>
            <p style="color:var(--rm-text-muted);margin:12px 0">${confidence >= 70 ? 'Great job! You\'re well prepared.' : confidence >= 50 ? 'Good start, keep practicing!' : 'Need more practice. Review the questions and try again.'}</p>
            <p style="color:var(--rm-text-muted);font-size:0.82rem">⏱️ ${R().formatTime(duration)} | ${answers.length} questions answered</p>
            <button class="rm-btn rm-btn-primary" style="margin-top:16px" onclick="navigate('interview-prep')">Back to Packages</button>
          </div>
        </div>`;
      }
      R().toast('Interview submitted!', 'success');
    } catch (e) { R().toast('Error saving attempt: ' + e.message, 'error'); }
  }

  async function _loadHistory() {
    const c = document.getElementById('ipContent');
    if (!c) return;
    const user = await R()._user();
    if (!user) { c.innerHTML = R().emptyHTML('🔒', 'Please login to view your attempts.'); return; }
    try {
      const { data } = await R()._sb().from('interview_attempts')
        .select('id,interview_id,confidence_score,duration_seconds,rating,created_at,interviews(title)')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📊', 'No attempts yet. Start practicing!'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-2">${data.map(a => `
        <div class="rm-card">
          <h3 class="rm-card-title">${R().sanitize(a.interviews?.title || 'Interview Practice')}</h3>
          <div style="display:flex;gap:8px;align-items:center;margin:8px 0">
            <div class="rm-stat-value" style="color:${a.confidence_score >= 70 ? 'var(--rm-success)' : a.confidence_score >= 50 ? 'var(--rm-gold)' : 'var(--rm-danger)'}">${a.confidence_score}</div>
            <div class="rm-stat-label">Confidence</div>
          </div>
          <div style="font-size:0.78rem;color:var(--rm-text-muted)">⏱️ ${R().formatTime(a.duration_seconds||0)} | ${R().timeAgo(a.created_at)}</div>
        </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.InterviewPrep = Object.freeze({
    render, _tab, _openPackage, _startMock, _nextQ, _prevQ,
    init: () => { const p = document.getElementById('page-interview-prep'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('interviewPrep', root.InterviewPrep);
  console.log('[InterviewPrep] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
