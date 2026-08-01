/**
 * ═══════════════════════════════════════════════════════════════════════════
 * study-planner.js — Studyria V5.1 Module 6: Study Planner Premium
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[StudyPlanner] Core not loaded'); return; }

  let _currentPlan = null;
  let _viewDate = new Date();

  async function render(container) {
    if (!container) return;
    const user = await R()._user();
    if (!user) { container.innerHTML = R().emptyHTML('🔒', 'Please login to use the study planner.'); return; }

    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <button class="rm-btn rm-btn-primary" onclick="StudyPlanner.createPlan()">+ New Plan</button>
      </div>
      <div id="spPlans">${R().skeletonHTML(3)}</div>
      <div id="spCalendar" style="margin-top:24px"></div>
      <div id="spTasks" style="margin-top:24px"></div>`;

    _loadPlans();
    _loadTodayTasks();
  }

  async function _loadPlans() {
    const c = document.getElementById('spPlans');
    if (!c) return;
    try {
      const user = await R()._user();
      const { data } = await R()._sb().from('study_planners')
        .select('id,title,plan_type,start_date,end_date,target_exam,study_hours_per_day,is_premium,ai_generated')
        .eq('user_id', user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(10);
      if (!data?.length) { c.innerHTML = R().emptyHTML('📅', 'No study plans yet. Create one to get started!'); return; }
      c.innerHTML = `<div class="rm-grid rm-grid-3">${data.map(p => `
        <div class="rm-card" onclick="StudyPlanner.openPlan('${p.id}')">
          <h3 class="rm-card-title">${R().sanitize(p.title)}</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
            <span class="rm-badge rm-badge-new">${R().sanitize(p.plan_type?.replace(/_/g,' ') || '')}</span>
            ${p.is_premium ? '<span class="rm-badge rm-badge-premium">⭐</span>' : ''}
            ${p.ai_generated ? '<span class="rm-badge rm-badge-featured">AI</span>' : ''}
          </div>
          <div style="font-size:0.78rem;color:var(--rm-text-muted)">
            📅 ${R().formatDate(p.start_date)} ${p.end_date ? '→ ' + R().formatDate(p.end_date) : ''}
            ${p.target_exam ? ' | 🎯 ' + R().sanitize(p.target_exam) : ''}
          </div>
          <div style="font-size:0.78rem;color:var(--rm-text-muted)">⏰ ${p.study_hours_per_day}h/day</div>
        </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  async function createPlan() {
    R().openModal('Create Study Plan', `
      <div class="rm-field-group"><label class="rm-label">Plan Title</label><input class="rm-input" id="spTitle" value="My Study Plan"></div>
      <div class="rm-grid rm-grid-2">
        <div class="rm-field-group"><label class="rm-label">Plan Type</label>
          <select class="rm-select" id="spType">
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option><option value="revision">Revision</option>
          </select></div>
        <div class="rm-field-group"><label class="rm-label">Start Date</label><input class="rm-input" type="date" id="spStart" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="rm-field-group"><label class="rm-label">End Date (optional)</label><input class="rm-input" type="date" id="spEnd"></div>
        <div class="rm-field-group"><label class="rm-label">Target Exam</label><input class="rm-input" id="spExam" placeholder="e.g. ADRE 3.0, APSC"></div>
        <div class="rm-field-group"><label class="rm-label">Hours per Day</label><input class="rm-input" type="number" id="spHours" value="4" min="1" max="24"></div>
      </div>
      <div class="rm-field-group"><label class="rm-label">Subjects (comma separated)</label><input class="rm-input" id="spSubjects" placeholder="GK, English, Math"></div>
      <button class="rm-btn rm-btn-primary" style="width:100%;margin-top:16px" onclick="StudyPlanner._savePlan()">Create Plan</button>
    `);
  }

  async function _savePlan() {
    const user = await R()._user();
    if (!user) return;
    const title = document.getElementById('spTitle')?.value || 'My Study Plan';
    const planType = document.getElementById('spType')?.value || 'daily';
    const startDate = document.getElementById('spStart')?.value;
    const endDate = document.getElementById('spEnd')?.value || null;
    const targetExam = document.getElementById('spExam')?.value || '';
    const hours = parseInt(document.getElementById('spHours')?.value || '4');
    const subjects = (document.getElementById('spSubjects')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

    try {
      await R().safeInsert('study_planners', {
        user_id: user.id, title, plan_type: planType, start_date: startDate, end_date: endDate,
        target_exam: targetExam, study_hours_per_day: hours, subjects, is_premium: false, ai_generated: false
      });
      R().closeModal();
      R().toast('Study plan created!', 'success');
      _loadPlans();
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function openPlan(planId) {
    try {
      const user = await R()._user();
      const { data: plan } = await R()._sb().from('study_planners').select('*').eq('id', planId).single();
      if (!plan) return;
      _currentPlan = plan;

      const { data: tasks } = await R()._sb().from('planner_tasks')
        .select('*').eq('planner_id', planId).eq('user_id', user.id)
        .order('scheduled_date', { ascending: true }).order('sort_order', { ascending: true }).limit(50);

      R().openModal(plan.title, `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span class="rm-badge rm-badge-new">${R().sanitize(plan.plan_type?.replace(/_/g,' ') || '')}</span>
          ${plan.target_exam ? `<span class="rm-badge rm-badge-featured">🎯 ${R().sanitize(plan.target_exam)}</span>` : ''}
          <span class="rm-badge">⏰ ${plan.study_hours_per_day}h/day</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="rm-btn rm-btn-primary" onclick="StudyPlanner._addTask('${planId}')">+ Add Task</button>
          <button class="rm-btn rm-btn-ghost" onclick="StudyPlanner._aiPlan('${planId}')">🤖 Generate AI Plan</button>
        </div>
        <div id="spTaskList">${(tasks || []).map(t => `
          <div class="rm-card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px">
            <input type="checkbox" ${t.is_completed ? 'checked' : ''} onchange="StudyPlanner._toggleTask('${t.id}')" style="width:20px;height:20px;cursor:pointer">
            <div style="flex:1">
              <div style="font-weight:600;color:var(--rm-text);text-decoration:${t.is_completed ? 'line-through' : 'none'}">${R().sanitize(t.title)}</div>
              <div style="font-size:0.75rem;color:var(--rm-text-muted)">${R().sanitize(t.subject || '')} | ${R().formatDate(t.scheduled_date)} | ${t.duration_minutes}min | ${R().sanitize(t.priority)}</div>
            </div>
            <span class="rm-badge rm-badge-${t.task_type === 'test' ? 'premium' : 'new'}">${R().sanitize(t.task_type || 'study')}</span>
          </div>`).join('') || R().emptyHTML('📋', 'No tasks yet. Add one or generate an AI plan!')}</div>
      `);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  function _addTask(planId) {
    R().closeModal();
    R().openModal('Add Task', `
      <div class="rm-field-group"><label class="rm-label">Title</label><input class="rm-input" id="tTitle" placeholder="Study GK Chapter 5"></div>
      <div class="rm-grid rm-grid-2">
        <div class="rm-field-group"><label class="rm-label">Subject</label><input class="rm-input" id="tSubject" placeholder="GK"></div>
        <div class="rm-field-group"><label class="rm-label">Date</label><input class="rm-input" type="date" id="tDate" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="rm-field-group"><label class="rm-label">Duration (min)</label><input class="rm-input" type="number" id="tDur" value="60"></div>
        <div class="rm-field-group"><label class="rm-label">Priority</label>
          <select class="rm-select" id="tPriority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div>
        <div class="rm-field-group"><label class="rm-label">Type</label>
          <select class="rm-select" id="tType"><option value="study">Study</option><option value="revision">Revision</option><option value="practice">Practice</option><option value="test">Test</option><option value="break">Break</option></select></div>
      </div>
      <button class="rm-btn rm-btn-primary" style="width:100%;margin-top:16px" onclick="StudyPlanner._saveTask('${planId}')">Add Task</button>
    `);
  }

  async function _saveTask(planId) {
    const user = await R()._user();
    if (!user) return;
    try {
      await R().safeInsert('planner_tasks', {
        planner_id: planId, user_id: user.id,
        title: document.getElementById('tTitle')?.value || 'Task',
        subject: document.getElementById('tSubject')?.value || '',
        scheduled_date: document.getElementById('tDate')?.value,
        duration_minutes: parseInt(document.getElementById('tDur')?.value || '60'),
        priority: document.getElementById('tPriority')?.value || 'medium',
        task_type: document.getElementById('tType')?.value || 'study',
        is_completed: false
      });
      R().closeModal();
      R().toast('Task added!', 'success');
      openPlan(planId);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _toggleTask(taskId) {
    try {
      const user = await R()._user();
      const { data: t } = await R()._sb().from('planner_tasks').select('is_completed').eq('id', taskId).eq('user_id', user.id).single();
      if (!t) return;
      const newVal = !t.is_completed;
      await R()._sb().from('planner_tasks').update({ is_completed: newVal, completed_at: newVal ? new Date().toISOString() : null }).eq('id', taskId).eq('user_id', user.id);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  function _aiPlan(planId) {
    R().toast('AI personalized planner is a Premium feature. Upgrade to unlock!', 'info');
  }

  async function _loadTodayTasks() {
    const c = document.getElementById('spTasks');
    if (!c) return;
    const user = await R()._user();
    if (!user) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await R()._sb().from('planner_tasks')
        .select('*').eq('user_id', user.id).eq('scheduled_date', today)
        .eq('is_completed', false).order('sort_order', { ascending: true }).limit(20);
      if (!data?.length) { c.innerHTML = `<h2 style="color:var(--rm-text);margin-bottom:12px">Today's Tasks</h2>` + R().emptyHTML('☕', 'No tasks scheduled for today. Enjoy or add some!'); return; }
      c.innerHTML = `<h2 style="color:var(--rm-text);margin-bottom:12px">Today's Tasks (${data.length})</h2>
        <div class="rm-grid rm-grid-2">${data.map(t => `
          <div class="rm-card" style="display:flex;align-items:center;gap:12px">
            <input type="checkbox" onchange="StudyPlanner._toggleTask('${t.id}')" style="width:20px;height:20px;cursor:pointer">
            <div style="flex:1"><div style="font-weight:600;color:var(--rm-text)">${R().sanitize(t.title)}</div>
            <div style="font-size:0.75rem;color:var(--rm-text-muted)">${R().sanitize(t.subject||'')} | ${t.duration_minutes}min</div></div>
          </div>`).join('')}</div>`;
    } catch (e) { c.innerHTML = ''; }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.StudyPlanner = Object.freeze({
    render, createPlan, openPlan, _savePlan, _addTask, _saveTask, _toggleTask, _aiPlan,
    init: () => { const p = document.getElementById('page-study-planner'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('studyPlanner', root.StudyPlanner);
  console.log('[StudyPlanner] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
