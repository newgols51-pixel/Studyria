/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA CAMPUS & BRAINLAB — Admin Panel (campus-admin.js)
   Admin modules for managing Campus and BrainLab content.
   Uses existing Supabase client. Pure additive.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function client() {
    return window.supabase || (window.Supabase && window.Supabase.getClient());
  }

  function escape(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════════════
     CAMPUS ADMIN
     ═══════════════════════════════════════════════════════════════════ */
  window.CampusAdmin = {
    currentSection: 'feed',

    switchSection: function (section) {
      this.currentSection = section;
      var container = document.getElementById('campus-admin-content');
      if (!container) return;

      // Update button styles
      document.querySelectorAll('[onclick^="CampusAdmin.switchSection"]').forEach(function (btn) {
        btn.classList.remove('focus-btn-primary');
        btn.classList.add('focus-btn-secondary');
      });
      var activeBtn = document.querySelector('[onclick="CampusAdmin.switchSection(\'' + section + '\')"]');
      if (activeBtn) { activeBtn.classList.remove('focus-btn-secondary'); activeBtn.classList.add('focus-btn-primary'); }

      switch (section) {
        case 'feed':         this.renderFeed(); break;
        case 'plans':        this.renderPlans(); break;
        case 'reminders':    this.renderReminders(); break;
        case 'notifications': this.renderNotifications(); break;
        case 'goals':        this.renderGoals(); break;
        case 'analytics':    this.renderAnalytics(); break;
      }
    },

    renderFeed: async function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="text-align:center;padding:30px"><div style="font-size:1.5rem;opacity:.5">Loading…</div></div>';

      var html = '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📋 Campus Feed Manager</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Publish personalized feed items for students</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="cf-title" placeholder="Feed title..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<input type="text" id="cf-subtitle" placeholder="Subtitle (optional)..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<select id="cf-type" style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
            '<option value="general">General</option>' +
            '<option value="continue_reading">Continue Reading</option>' +
            '<option value="today_quiz">Today\'s Quiz</option>' +
            '<option value="recommended_pdf">Recommended PDF</option>' +
            '<option value="recommended_job">Recommended Job</option>' +
            '<option value="pending_revision">Pending Revision</option>' +
            '<option value="upcoming_exam">Upcoming Exam</option>' +
            '<option value="ai_suggestion">AI Suggestion</option>' +
          '</select>' +
          '<input type="number" id="cf-priority" placeholder="Priority (0=low, 10=high)" value="5" style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none;width:200px">' +
          '<button onclick="CampusAdmin.publishFeed()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Publish Feed Item</button>' +
        '</div>' +
      '</div>';

      html += '<h4 style="font-size:0.88rem;font-weight:700;margin:20px 0 8px">Published Feed Items</h4>';
      html += '<div id="cf-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div>';
      c.innerHTML = html;

      // Load existing feed items
      try {
        var cl = client();
        if (!cl) { document.getElementById('cf-list').innerHTML = '<div style="padding:20px;color:#ef4444">Supabase not connected</div>'; return; }
        var res = await cl.from('campus_feed').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);
        var items = res.data || [];
        if (!items.length) {
          document.getElementById('cf-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No feed items published yet.</div>';
          return;
        }
        document.getElementById('cf-list').innerHTML = items.map(function (item) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="flex:1">' +
              '<div style="font-size:0.85rem;font-weight:600">' + escape(item.title) + '</div>' +
              '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + escape(item.feed_type) + ' · Priority: ' + (item.priority || 0) + ' · ' + (item.status || 'draft') + '</div>' +
            '</div>' +
            '<button onclick="CampusAdmin.toggleFeedStatus(\'' + item.id + '\',\'' + (item.status === 'published' ? 'archived' : 'published') + '\')" style="padding:4px 12px;border-radius:8px;background:' + (item.status === 'published' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)') + ';color:' + (item.status === 'published' ? '#22c55e' : '#fbbf24') + ';border:none;cursor:pointer;font-size:0.72rem;font-weight:600">' + (item.status === 'published' ? 'Published' : 'Draft') + '</button>' +
            '<button onclick="CampusAdmin.deleteFeed(\'' + item.id + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(239,68,68,0.1);color:#ef4444;border:none;cursor:pointer;font-size:0.72rem">Delete</button>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('cf-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    publishFeed: async function () {
      var cl = client();
      if (!cl) return;
      var title = document.getElementById('cf-title').value.trim();
      var subtitle = document.getElementById('cf-subtitle').value.trim();
      var type = document.getElementById('cf-type').value;
      var priority = parseInt(document.getElementById('cf-priority').value) || 0;
      if (!title) { alert('Enter a title'); return; }

      try {
        await cl.from('campus_feed').insert({
          title: title, subtitle: subtitle || null, feed_type: type,
          priority: priority, status: 'published', published_at: new Date().toISOString()
        });
        document.getElementById('cf-title').value = '';
        document.getElementById('cf-subtitle').value = '';
        this.renderFeed();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    toggleFeedStatus: async function (id, status) {
      var cl = client(); if (!cl) return;
      try { await cl.from('campus_feed').update({ status: status, updated_at: new Date().toISOString() }).eq('id', id); this.renderFeed(); }
      catch (e) { alert('Error: ' + (e.message || '')); }
    },

    deleteFeed: async function (id) {
      var cl = client(); if (!cl) return;
      try { await cl.from('campus_feed').update({ is_deleted: true }).eq('id', id); this.renderFeed(); }
      catch (e) { alert('Error: ' + (e.message || '')); }
    },

    renderPlans: function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📅 Study Plan Templates</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">Create reusable study plan templates for students</p>' +
        '<div style="padding:40px;text-align:center;color:var(--text-secondary,#94a3b8)">' +
          '<div style="font-size:2rem;margin-bottom:8px;opacity:.5">📅</div>' +
          '<div style="font-size:0.82rem">Study plan templates feature coming soon. Feed items above can serve as daily plans.</div>' +
        '</div>' +
      '</div>';
    },

    renderReminders: function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">🔔 Reminder Templates</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">Configure automated study reminder templates</p>' +
        '<div style="padding:40px;text-align:center;color:var(--text-secondary,#94a3b8)">' +
          '<div style="font-size:2rem;margin-bottom:8px;opacity:.5">🔔</div>' +
          '<div style="font-size:0.82rem">Reminder templates will be configurable here once notifications are deployed.</div>' +
        '</div>' +
      '</div>';
    },

    renderNotifications: function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📢 Campus Notifications</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">Send campus-wide notifications to students</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="cn-title" placeholder="Notification title..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<textarea id="cn-body" placeholder="Notification message..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none;min-height:80px;resize:vertical;font-family:inherit">' +
          '<button onclick="CampusAdmin.sendNotification()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Send Notification</button>' +
        '</div>' +
      '</div>';
    },

    sendNotification: async function () {
      var title = document.getElementById('cn-title').value.trim();
      var body = document.getElementById('cn-body').value.trim();
      if (!title || !body) { alert('Enter title and message'); return; }
      var cl = client(); if (!cl) return;
      try {
        // Use existing push_notifications table if available
        await cl.from('push_notifications').insert({ title: title, body: body, type: 'campus' });
        alert('Notification sent!');
        document.getElementById('cn-title').value = '';
        document.getElementById('cn-body').value = '';
      } catch (e) {
        alert('Error: ' + (e.message || ''));
      }
    },

    renderGoals: async function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px"><h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">🎯 Goal Analytics</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">View all student goals across the platform</p>' +
        '<div id="goals-admin-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div></div>';

      try {
        var cl = client(); if (!cl) return;
        var res = await cl.from('study_goals').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
        var goals = res.data || [];
        if (!goals.length) {
          document.getElementById('goals-admin-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No goals created by students yet.</div>';
          return;
        }
        document.getElementById('goals-admin-list').innerHTML = goals.map(function (g) {
          var pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
          return '<div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="font-size:0.85rem;font-weight:600">' + escape(g.title) + ' <span style="font-size:0.7rem;color:' + (g.status === 'completed' ? '#22c55e' : '#fbbf24') + '">' + g.status + '</span></div>' +
            '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + (g.current_value || 0) + '/' + g.target_value + ' ' + escape(g.unit || '') + '</div>' +
            '<div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#3d8ef8,#8b5cf6)"></div></div>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('goals-admin-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    renderAnalytics: async function () {
      var c = document.getElementById('campus-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px"><h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📊 Campus Analytics</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">Platform-wide study analytics</p>' +
        '<div id="ca-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px"><div style="text-align:center;padding:30px;opacity:.5">Loading…</div></div></div>';

      try {
        var cl = client(); if (!cl) return;
        var sessions = await cl.from('study_sessions').select('duration_secs,mode').eq('is_deleted', false);
        var notes = await cl.from('study_notes').select('id').eq('is_deleted', false);
        var goals = await cl.from('study_goals').select('status').eq('is_deleted', false);

        var totalSecs = 0, sessionCount = (sessions.data || []).length;
        (sessions.data || []).forEach(function (s) { totalSecs += s.duration_secs || 0; });
        var completedGoals = (goals.data || []).filter(function (g) { return g.status === 'completed'; }).length;

        document.getElementById('ca-stats').innerHTML =
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + (totalSecs/3600).toFixed(1) + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Total Study Hours</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + sessionCount + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Total Sessions</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + (notes.data || []).length + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Notes Created</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#3d8ef8,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + completedGoals + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Goals Completed</div></div>';
      } catch (e) {
        document.getElementById('ca-stats').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════════════
     BRAINLAB ADMIN
     ═══════════════════════════════════════════════════════════════════ */
  window.BrainLabAdmin = {
    currentSection: 'quizzes',

    switchSection: function (section) {
      this.currentSection = section;
      var container = document.getElementById('brainlab-admin-content');
      if (!container) return;

      document.querySelectorAll('[onclick^="BrainLabAdmin.switchSection"]').forEach(function (btn) {
        btn.classList.remove('focus-btn-primary');
        btn.classList.add('focus-btn-secondary');
      });
      var activeBtn = document.querySelector('[onclick="BrainLabAdmin.switchSection(\'' + section + '\')"]');
      if (activeBtn) { activeBtn.classList.remove('focus-btn-secondary'); activeBtn.classList.add('focus-btn-primary'); }

      switch (section) {
        case 'quizzes':     this.renderQuizzes(); break;
        case 'mocks':       this.renderMocks(); break;
        case 'flashcards':  this.renderFlashcards(); break;
        case 'affairs':     this.renderAffairs(); break;
        case 'leaderboard': this.renderLeaderboard(); break;
        case 'analytics':   this.renderAnalytics(); break;
      }
    },

    /* ── Quizzes ── */
    renderQuizzes: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="text-align:center;padding:30px"><div style="font-size:1.5rem;opacity:.5">Loading…</div></div>';

      var html = '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">🧩 Quiz Bank</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Create and publish quizzes with MCQ questions</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="qz-title" placeholder="Quiz title..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<input type="text" id="qz-desc" placeholder="Description (optional)..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<div style="display:flex;gap:8px">' +
            '<input type="text" id="qz-category" placeholder="Category" value="general" style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
            '<select id="qz-difficulty" style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
              '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option><option value="expert">Expert</option>' +
            '</select>' +
            '<input type="number" id="qz-duration" placeholder="Mins" value="30" style="width:80px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '</div>' +
          '<button onclick="BrainLabAdmin.createQuiz()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#fbbf24);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Create Quiz</button>' +
        '</div>' +
      '</div>';

      html += '<h4 style="font-size:0.88rem;font-weight:700;margin:20px 0 8px">Existing Quizzes</h4>';
      html += '<div id="qz-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div>';
      c.innerHTML = html;

      try {
        var cl = client();
        if (!cl) { document.getElementById('qz-list').innerHTML = '<div style="padding:20px;color:#ef4444">Supabase not connected</div>'; return; }
        var res = await cl.from('brainlab_quizzes').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);
        var quizzes = res.data || [];
        if (!quizzes.length) {
          document.getElementById('qz-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No quizzes created yet.</div>';
          return;
        }
        document.getElementById('qz-list').innerHTML = quizzes.map(function (q) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="flex:1">' +
              '<div style="font-size:0.85rem;font-weight:600">' + escape(q.title) + '</div>' +
              '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + escape(q.category || '') + ' · ' + escape(q.difficulty || '') + ' · ' + (q.status || 'draft') + '</div>' +
            '</div>' +
            '<button onclick="BrainLabAdmin.addQuestion(\'' + q.id + '\')" style="padding:4px 12px;border-radius:8px;background:rgba(61,142,248,0.15);color:#3d8ef8;border:none;cursor:pointer;font-size:0.72rem;font-weight:600">+ Question</button>' +
            '<button onclick="BrainLabAdmin.toggleQuizStatus(\'' + q.id + '\',\'' + (q.status === 'published' ? 'archived' : 'published') + '\')" style="padding:4px 12px;border-radius:8px;background:' + (q.status === 'published' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)') + ';color:' + (q.status === 'published' ? '#22c55e' : '#fbbf24') + ';border:none;cursor:pointer;font-size:0.72rem">' + (q.status === 'published' ? 'Live' : 'Draft') + '</button>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('qz-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    createQuiz: async function () {
      var cl = client(); if (!cl) return;
      var title = document.getElementById('qz-title').value.trim();
      if (!title) { alert('Enter quiz title'); return; }
      try {
        await cl.from('brainlab_quizzes').insert({
          title: title,
          description: document.getElementById('qz-desc').value.trim() || null,
          category: document.getElementById('qz-category').value || 'general',
          difficulty: document.getElementById('qz-difficulty').value,
          duration_mins: parseInt(document.getElementById('qz-duration').value) || 30,
          status: 'draft'
        });
        document.getElementById('qz-title').value = '';
        document.getElementById('qz-desc').value = '';
        this.renderQuizzes();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    addQuestion: async function (quizId) {
      // Simple prompt-based question adder
      var qText = prompt('Question text:');
      if (!qText) return;
      var optA = prompt('Option A:');
      var optB = prompt('Option B:');
      var optC = prompt('Option C (leave empty if N/A):');
      var optD = prompt('Option D (leave empty if N/A):');
      var correct = prompt('Correct answer (a/b/c/d):').toLowerCase();
      if (!['a','b','c','d'].includes(correct)) { alert('Invalid answer'); return; }
      var explanation = prompt('Explanation (optional):');

      var cl = client(); if (!cl) return;
      try {
        await cl.from('quiz_questions').insert({
          quiz_id: quizId,
          question_text: qText,
          option_a: optA, option_b: optB,
          option_c: optC || null, option_d: optD || null,
          correct_answer: correct,
          explanation: explanation || null
        });
        alert('Question added!');
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    toggleQuizStatus: async function (id, status) {
      var cl = client(); if (!cl) return;
      try {
        var update = { status: status, updated_at: new Date().toISOString() };
        if (status === 'published') update.published_at = new Date().toISOString();
        await cl.from('brainlab_quizzes').update(update).eq('id', id);
        // ── Live Notifications hook (fire-and-forget) ──
        try {
          if (window.SN) {
            if (status === 'published') {
              var qz = { title: 'New Quiz' };
              try {
                var qr = await cl.from('brainlab_quizzes').select('title, category').eq('id', id).single();
                if (qr && qr.data) qz = qr.data;
              } catch (e2) {}
              SN.publish('QUIZ', id, { title: (qz.title || 'New Quiz') + ' — Live Now', message: 'New quiz published in BrainLab', destination: 'quiz:' + id, metadata: { category: qz.category } });
            } else {
              SN.deactivate('QUIZ', id);
            }
          }
        } catch (e) { console.warn('SN quiz hook:', e); }
        this.renderQuizzes();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    /* ── Mock Tests ── */
    renderMocks: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="text-align:center;padding:30px"><div style="font-size:1.5rem;opacity:.5">Loading…</div></div>';

      var html = '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📝 Mock Tests</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Create full-length mock tests</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="mt-title" placeholder="Mock test title..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<input type="text" id="mt-exam" placeholder="Exam type (e.g. UPSC, SSC, NEET)..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<div style="display:flex;gap:8px">' +
            '<input type="number" id="mt-duration" placeholder="Duration (mins)" value="180" style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
            '<input type="number" id="mt-marks" placeholder="Total marks" value="100" style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '</div>' +
          '<button onclick="BrainLabAdmin.createMock()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#fbbf24);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Create Mock Test</button>' +
        '</div>' +
      '</div>';
      html += '<div id="mt-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div>';
      c.innerHTML = html;

      try {
        var cl = client(); if (!cl) return;
        var res = await cl.from('mock_tests').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);
        var mocks = res.data || [];
        if (!mocks.length) {
          document.getElementById('mt-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No mock tests created yet.</div>';
          return;
        }
        document.getElementById('mt-list').innerHTML = mocks.map(function (m) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="flex:1"><div style="font-size:0.85rem;font-weight:600">' + escape(m.title) + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + escape(m.exam_type || '') + ' · ' + (m.duration_mins || 180) + 'min · ' + (m.status || 'draft') + '</div></div>' +
            '<button onclick="BrainLabAdmin.addMockQuestion(\'' + m.id + '\')" style="padding:4px 12px;border-radius:8px;background:rgba(61,142,248,0.15);color:#3d8ef8;border:none;cursor:pointer;font-size:0.72rem;font-weight:600">+ Q</button>' +
            '<button onclick="BrainLabAdmin.toggleMockStatus(\'' + m.id + '\',\'' + (m.status === 'published' ? 'archived' : 'published') + '\')" style="padding:4px 12px;border-radius:8px;background:' + (m.status === 'published' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)') + ';color:' + (m.status === 'published' ? '#22c55e' : '#fbbf24') + ';border:none;cursor:pointer;font-size:0.72rem">' + (m.status === 'published' ? 'Live' : 'Draft') + '</button>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('mt-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    createMock: async function () {
      var cl = client(); if (!cl) return;
      var title = document.getElementById('mt-title').value.trim();
      if (!title) { alert('Enter title'); return; }
      try {
        await cl.from('mock_tests').insert({
          title: title,
          exam_type: document.getElementById('mt-exam').value.trim() || null,
          duration_mins: parseInt(document.getElementById('mt-duration').value) || 180,
          total_marks: parseInt(document.getElementById('mt-marks').value) || 100,
          status: 'draft'
        });
        document.getElementById('mt-title').value = '';
        document.getElementById('mt-exam').value = '';
        this.renderMocks();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    addMockQuestion: async function (mockId) {
      var qText = prompt('Question text:');
      if (!qText) return;
      var optA = prompt('Option A:');
      var optB = prompt('Option B:');
      var optC = prompt('Option C (leave empty if N/A):');
      var optD = prompt('Option D (leave empty if N/A):');
      var correct = prompt('Correct answer (a/b/c/d):').toLowerCase();
      if (!['a','b','c','d'].includes(correct)) { alert('Invalid answer'); return; }
      var cl = client(); if (!cl) return;
      try {
        await cl.from('mock_questions').insert({
          mock_id: mockId, question_text: qText,
          option_a: optA, option_b: optB, option_c: optC || null, option_d: optD || null,
          correct_answer: correct
        });
        alert('Question added!');
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    toggleMockStatus: async function (id, status) {
      var cl = client(); if (!cl) return;
      try {
        var update = { status: status, updated_at: new Date().toISOString() };
        if (status === 'published') update.published_at = new Date().toISOString();
        await cl.from('mock_tests').update(update).eq('id', id);
        // ── Live Notifications hook (fire-and-forget) ──
        try {
          if (window.SN) {
            if (status === 'published') {
              var mk = { title: 'New Mock Test', exam_type: '' };
              try {
                var mr = await cl.from('mock_tests').select('title, exam_type').eq('id', id).single();
                if (mr && mr.data) mk = mr.data;
              } catch (e2) {}
              SN.publish('MOCK_TEST', id, { title: (mk.title || 'New Mock Test') + ' Added', message: (mk.exam_type ? mk.exam_type + ' exam-style full-length test' : 'Full-length exam-style test now live'), destination: 'mock:' + id, metadata: { exam: mk.exam_type } });
            } else {
              SN.deactivate('MOCK_TEST', id);
            }
          }
        } catch (e) { console.warn('SN mock hook:', e); }
        this.renderMocks();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    /* ── Flashcards ── */
    renderFlashcards: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="text-align:center;padding:30px"><div style="font-size:1.5rem;opacity:.5">Loading…</div></div>';

      var html = '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">🎴 Flashcard Bank</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Create flashcards with spaced repetition support</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="fc-topic" placeholder="Topic (e.g. Indian History)..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<input type="text" id="fc-front" placeholder="Question / Front side..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<input type="text" id="fc-back" placeholder="Answer / Back side..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<select id="fc-difficulty" style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
            '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>' +
          '</select>' +
          '<button onclick="BrainLabAdmin.createFlashcard()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#fbbf24);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Add Flashcard</button>' +
        '</div>' +
      '</div>';
      html += '<div id="fc-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div>';
      c.innerHTML = html;

      try {
        var cl = client(); if (!cl) return;
        var res = await cl.from('flashcards').select('*').eq('is_deleted', false).order('created_at', { ascending: false }).limit(30);
        var cards = res.data || [];
        if (!cards.length) {
          document.getElementById('fc-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No flashcards created yet.</div>';
          return;
        }
        document.getElementById('fc-list').innerHTML = cards.map(function (card) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="flex:1"><div style="font-size:0.85rem;font-weight:600">' + escape(card.front) + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + escape(card.topic || '') + ' · ' + escape(card.difficulty || '') + '</div></div>' +
            '<button onclick="BrainLabAdmin.deleteFlashcard(\'' + card.id + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(239,68,68,0.1);color:#ef4444;border:none;cursor:pointer;font-size:0.72rem">Delete</button>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('fc-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    createFlashcard: async function () {
      var cl = client(); if (!cl) return;
      var topic = document.getElementById('fc-topic').value.trim();
      var front = document.getElementById('fc-front').value.trim();
      var back = document.getElementById('fc-back').value.trim();
      if (!topic || !front || !back) { alert('Fill all fields'); return; }
      try {
        await cl.from('flashcards').insert({
          topic: topic, front: front, back: back,
          difficulty: document.getElementById('fc-difficulty').value, status: 'published'
        });
        document.getElementById('fc-front').value = '';
        document.getElementById('fc-back').value = '';
        this.renderFlashcards();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    deleteFlashcard: async function (id) {
      var cl = client(); if (!cl) return;
      try { await cl.from('flashcards').update({ is_deleted: true }).eq('id', id); this.renderFlashcards(); }
      catch (e) { alert('Error: ' + (e.message || '')); }
    },

    /* ── Current Affairs ── */
    renderAffairs: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="text-align:center;padding:30px"><div style="font-size:1.5rem;opacity:.5">Loading…</div></div>';

      var html = '<div style="margin-bottom:16px">' +
        '<h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📰 Current Affairs</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Publish current affairs for students</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;max-width:600px">' +
          '<input type="text" id="ca-title" placeholder="Headline..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '<textarea id="ca-content" placeholder="Full article..." style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none;min-height:100px;resize:vertical;font-family:inherit">' +
          '<div style="display:flex;gap:8px">' +
            '<input type="text" id="ca-category" placeholder="Category (national/international/sports/tech)" value="national" style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
            '<input type="text" id="ca-source" placeholder="Source (optional)..." style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:inherit;font-size:0.82rem;outline:none">' +
          '</div>' +
          '<button onclick="BrainLabAdmin.publishAffair()" style="padding:10px 20px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#fbbf24);color:#fff;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;align-self:flex-start">Publish</button>' +
        '</div>' +
      '</div>';
      html += '<div id="ca-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div>';
      c.innerHTML = html;

      try {
        var cl = client(); if (!cl) return;
        var res = await cl.from('current_affairs').select('*').eq('is_deleted', false).order('published_date', { ascending: false }).limit(20);
        var affairs = res.data || [];
        if (!affairs.length) {
          document.getElementById('ca-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No current affairs published yet.</div>';
          return;
        }
        document.getElementById('ca-list').innerHTML = affairs.map(function (a) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="flex:1"><div style="font-size:0.85rem;font-weight:600">' + escape(a.title) + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + escape(a.category || '') + ' · ' + new Date(a.published_date).toLocaleDateString() + '</div></div>' +
            '<button onclick="BrainLabAdmin.deleteAffair(\'' + a.id + '\')" style="padding:4px 10px;border-radius:8px;background:rgba(239,68,68,0.1);color:#ef4444;border:none;cursor:pointer;font-size:0.72rem">Delete</button>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('ca-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    publishAffair: async function () {
      var cl = client(); if (!cl) return;
      var title = document.getElementById('ca-title').value.trim();
      var contentVal = document.getElementById('ca-content').value.trim();
      if (!title || !contentVal) { alert('Fill title and content'); return; }
      try {
        var _caIns = await cl.from('current_affairs').insert({
          title: title, content: contentVal,
          category: document.getElementById('ca-category').value || 'national',
          source: document.getElementById('ca-source').value || null,
          status: 'published', published_at: new Date().toISOString()
        }).select('id').single();
        // ── Live Notifications hook (fire-and-forget) ──
        try {
          if (window.SN && _caIns && _caIns.data && _caIns.data.id) {
            SN.publish('CURRENT_AFFAIRS', _caIns.data.id, { title: title, message: 'New current affairs update in BrainLab', destination: 'affair:' + _caIns.data.id });
          }
        } catch (e) { console.warn('SN affair hook:', e); }
        document.getElementById('ca-title').value = '';
        document.getElementById('ca-content').value = '';
        this.renderAffairs();
      } catch (e) { alert('Error: ' + (e.message || '')); }
    },

    deleteAffair: async function (id) {
      var cl = client(); if (!cl) return;
      try { await cl.from('current_affairs').update({ is_deleted: true }).eq('id', id); } catch (e) { alert('Error: ' + (e.message || '')); return; }
      try { if (window.SN) SN.deactivate('CURRENT_AFFAIRS', id); } catch (e2) { console.warn('SN affair delete hook:', e2); }
      this.renderAffairs();
    },

    /* ── Leaderboard ── */
    renderLeaderboard: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px"><h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">🏆 Leaderboard</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">View top performers across all quizzes</p>' +
        '<div id="lb-list" style="min-height:100px"><div style="text-align:center;padding:20px;opacity:.5">Loading…</div></div></div>';

      try {
        var cl = client(); if (!cl) return;
        var res = await cl.from('leaderboards').select('*').order('total_points', { ascending: false }).limit(50);
        var entries = res.data || [];
        if (!entries.length) {
          document.getElementById('lb-list').innerHTML = '<div style="padding:20px;color:var(--text-secondary,#94a3b8);font-size:0.82rem">No leaderboard entries yet.</div>';
          return;
        }
        document.getElementById('lb-list').innerHTML = entries.map(function (e, i) {
          var rankClass = i === 0 ? 'color:#fbbf24' : i === 1 ? 'color:#94a3b8' : i === 2 ? 'color:#d97706' : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:6px">' +
            '<div style="width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.85rem;background:rgba(255,255,255,0.05);' + rankClass + '">' + (i+1) + '</div>' +
            '<div style="flex:1;font-size:0.85rem;font-weight:600">User ' + escape((e.user_id || '').slice(0, 8)) + '</div>' +
            '<div style="font-size:0.85rem;font-weight:700;color:#fbbf24">' + (e.total_points || 0) + ' pts</div>' +
            '<div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">' + (e.quizzes_taken || 0) + ' quizzes · ' + (e.avg_score || 0).toFixed(1) + '% avg</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('lb-list').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    },

    /* ── Analytics ── */
    renderAnalytics: async function () {
      var c = document.getElementById('brainlab-admin-content');
      if (!c) return;
      c.innerHTML = '<div style="padding:20px"><h3 style="font-size:1rem;font-weight:700;margin:0 0 8px">📊 BrainLab Analytics</h3>' +
        '<p style="font-size:0.78rem;color:var(--text-secondary,#94a3b8);margin:0 0 16px">Platform-wide quiz and learning analytics</p>' +
        '<div id="bl-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px"><div style="text-align:center;padding:30px;opacity:.5">Loading…</div></div></div>';

      try {
        var cl = client(); if (!cl) return;
        var quizzes = await cl.from('brainlab_quizzes').select('status').eq('is_deleted', false);
        var attempts = await cl.from('quiz_attempts').select('score,total_marks').eq('is_deleted', false);
        var flashcards = await cl.from('flashcards').select('id').eq('is_deleted', false);
        var mistakes = await cl.from('mistake_book').select('id').eq('is_deleted', false);

        var publishedQuizzes = (quizzes.data || []).filter(function (q) { return q.status === 'published'; }).length;
        var totalAttempts = (attempts.data || []).length;
        var avgScore = 0;
        if (totalAttempts > 0) {
          var totalPct = 0;
          (attempts.data || []).forEach(function (a) { totalPct += a.total_marks ? (a.score / a.total_marks) * 100 : 0; });
          avgScore = Math.round(totalPct / totalAttempts);
        }

        document.getElementById('bl-stats').innerHTML =
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + publishedQuizzes + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Published Quizzes</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + totalAttempts + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Total Attempts</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + avgScore + '%</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Avg Score</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + (flashcards.data || []).length + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Flashcards</div></div>' +
          '<div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);text-align:center"><div style="font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + (mistakes.data || []).length + '</div><div style="font-size:0.72rem;color:var(--text-secondary,#94a3b8)">Mistakes Tracked</div></div>';
      } catch (e) {
        document.getElementById('bl-stats').innerHTML = '<div style="padding:20px;color:#ef4444;font-size:0.82rem">Error: ' + escape(e.message || '') + '</div>';
      }
    }
  };

  /* ── Render functions for switchAdminTab integration ── */
  window.CampusAdminRender = function (main) {
    main.innerHTML =
      '<div style="margin-bottom:20px">' +
        '<h2 style="font-size:1.3rem;font-weight:800;margin:0 0 4px">🏫 Campus Manager</h2>' +
        '<p style="font-size:0.82rem;color:var(--text-secondary,#94a3b8);margin:0">Manage campus feed, study plans, reminders & analytics</p>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">' +
        '<button class="focus-btn focus-btn-primary" onclick="CampusAdmin.switchSection(\'feed\')" style="padding:8px 14px;font-size:0.78rem">📋 Feed</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="CampusAdmin.switchSection(\'plans\')" style="padding:8px 14px;font-size:0.78rem">📅 Plans</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="CampusAdmin.switchSection(\'reminders\')" style="padding:8px 14px;font-size:0.78rem">🔔 Reminders</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="CampusAdmin.switchSection(\'notifications\')" style="padding:8px 14px;font-size:0.78rem">📢 Notifications</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="CampusAdmin.switchSection(\'goals\')" style="padding:8px 14px;font-size:0.78rem">🎯 Goals</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="CampusAdmin.switchSection(\'analytics\')" style="padding:8px 14px;font-size:0.78rem">📊 Analytics</button>' +
      '</div>' +
      '<div id="campus-admin-content" style="min-height:300px">' +
        '<div style="text-align:center;padding:40px 20px;color:var(--text-secondary,#94a3b8)"><div style="font-size:2rem;margin-bottom:8px">🏫</div><div style="font-size:0.85rem">Select a section above to manage campus content</div></div>' +
      '</div>';
    CampusAdmin.switchSection('feed');
  };

  window.BrainLabAdminRender = function (main) {
    main.innerHTML =
      '<div style="margin-bottom:20px">' +
        '<h2 style="font-size:1.3rem;font-weight:800;margin:0 0 4px">🧠 BrainLab Manager</h2>' +
        '<p style="font-size:0.82rem;color:var(--text-secondary,#94a3b8);margin:0">Manage quiz bank, mock tests, flashcards & analytics</p>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">' +
        '<button class="focus-btn focus-btn-primary" onclick="BrainLabAdmin.switchSection(\'quizzes\')" style="padding:8px 14px;font-size:0.78rem">🧩 Quizzes</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLabAdmin.switchSection(\'mocks\')" style="padding:8px 14px;font-size:0.78rem">📝 Mock Tests</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLabAdmin.switchSection(\'flashcards\')" style="padding:8px 14px;font-size:0.78rem">🎴 Flashcards</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLabAdmin.switchSection(\'affairs\')" style="padding:8px 14px;font-size:0.78rem">📰 Affairs</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLabAdmin.switchSection(\'leaderboard\')" style="padding:8px 14px;font-size:0.78rem">🏆 Leaderboard</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLabAdmin.switchSection(\'analytics\')" style="padding:8px 14px;font-size:0.78rem">📊 Analytics</button>' +
      '</div>' +
      '<div id="brainlab-admin-content" style="min-height:300px">' +
        '<div style="text-align:center;padding:40px 20px;color:var(--text-secondary,#94a3b8)"><div style="font-size:2rem;margin-bottom:8px">🧠</div><div style="font-size:0.85rem">Select a section above to manage BrainLab content</div></div>' +
      '</div>';
    BrainLabAdmin.switchSection('quizzes');
  };
})();
