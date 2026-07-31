/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA CAMPUS — Module Logic (campus.js)
   Pure additive. Uses existing Supabase client (window.supabase).
   No existing functions modified.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.Campus = {
    currentTab: 'dashboard',
    initialized: false,
    _timerInterval: null,
    _timerSeconds: 0,
    _timerMode: 'focus',
    _timerRunning: false,

    /* ── Get Supabase client ── */
    client: function () {
      return window.supabase || (window.Supabase && window.Supabase.getClient());
    },

    /* ── Get current user ── */
    user: function () {
      return window.currentUser || null;
    },

    /* ── Tab switching ── */
    switchTab: function (tab) {
      this.currentTab = tab;
      document.querySelectorAll('.campus-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      document.querySelectorAll('.campus-tab-content').forEach(function (c) {
        c.style.display = c.dataset.tab === tab ? 'block' : 'none';
      });

      switch (tab) {
        case 'dashboard':   this.renderDashboard(); break;
        case 'feed':         this.renderFeed(); break;
        case 'notes':        this.renderNotes(); break;
        case 'timer':        this.renderTimer(); break;
        case 'calendar':     this.renderCalendar(); break;
        case 'goals':        this.renderGoals(); break;
        case 'history':      this.renderHistory(); break;
        case 'exams':        this.renderExams(); break;
        case 'vault':        this.renderVault(); break;
        case 'analytics':    this.renderAnalytics(); break;
      }
    },

    /* ── Dashboard ── */
    renderDashboard: function () {
      var container = document.getElementById('campus-dashboard');
      if (!container) return;
      var self = this;
      var html = '<div class="campus-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">';

      var features = [
        { tab: 'feed',     icon: '📋', title: "Today's Plan",    sub: 'Your daily study plan' },
        { tab: 'history',  icon: '📖', title: 'Continue Reading', sub: 'Pick up where you left off' },
        { tab: 'notes',    icon: '📝', title: 'Quick Notes',      sub: 'Capture ideas fast' },
        { tab: 'timer',    icon: '⏱️', title: 'Focus Timer',       sub: 'Deep work sessions' },
        { tab: 'calendar', icon: '📅', title: 'Study Calendar',    sub: 'Plan your schedule' },
        { tab: 'goals',    icon: '🎯', title: 'Goal Tracker',      sub: 'Track progress' },
        { tab: 'analytics', icon: '📊', title: 'Study Analytics',  sub: 'Insights & reports' },
        { tab: 'exams',    icon: '⏳', title: 'Exam Countdown',    sub: 'Never miss an exam' },
        { tab: 'vault',    icon: '🗄️', title: 'Document Vault',    sub: 'Resumes & certificates' }
      ];

      features.forEach(function (f) {
        html += '<div class="campus-card campus-fade-in" onclick="Campus.switchTab(\'' + f.tab + '\')">' +
          '<div class="campus-card-icon">' + f.icon + '</div>' +
          '<div class="campus-card-title">' + f.title + '</div>' +
          '<div class="campus-card-sub">' + f.sub + '</div>' +
        '</div>';
      });
      html += '</div>';

      // Quick stats
      html += '<h3 class="campus-section-title">Quick Stats</h3>';
      html += '<div class="campus-grid" style="grid-template-columns:repeat(3,1fr)" id="campus-quick-stats">' +
        '<div class="skeleton" style="height:70px"></div>' +
        '<div class="skeleton" style="height:70px"></div>' +
        '<div class="skeleton" style="height:70px"></div>' +
      '</div>';

      container.innerHTML = html;

      // Load stats async
      this.loadStats();
    },

    loadStats: async function () {
      var self = this;
      var client = this.client();
      var user = this.user();
      var statsContainer = document.getElementById('campus-quick-stats');
      if (!statsContainer || !client || !user) {
        if (statsContainer) statsContainer.innerHTML = '<div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Study Hours</div></div><div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Day Streak</div></div><div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Goals Met</div></div>';
        return;
      }

      try {
        var sessions = await client.from('study_sessions').select('duration_secs,started_at').eq('user_id', user.id).eq('is_deleted', false);
        var goals = await client.from('study_goals').select('status').eq('user_id', user.id).eq('is_deleted', false);

        var totalSeconds = 0;
        var sessionsData = (sessions.data || []);
        sessionsData.forEach(function (s) { totalSeconds += s.duration_secs || 0; });
        var hours = (totalSeconds / 3600).toFixed(1);
        var goalsMet = (goals.data || []).filter(function (g) { return g.status === 'completed'; }).length;

        statsContainer.innerHTML =
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + hours + '</div><div class="analytics-stat-label">Study Hours</div></div>' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + self.dayStreak() + '</div><div class="analytics-stat-label">Day Streak</div></div>' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + goalsMet + '</div><div class="analytics-stat-label">Goals Met</div></div>';
      } catch (e) {
        console.warn('Campus stats error:', e);
        statsContainer.innerHTML =
          '<div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Study Hours</div></div>' +
          '<div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Day Streak</div></div>' +
          '<div class="analytics-stat"><div class="analytics-stat-num">0</div><div class="analytics-stat-label">Goals Met</div></div>';
      }
    },

    dayStreak: function () {
      try {
        var data = JSON.parse(localStorage.getItem('campus_study_days') || '[]');
        if (!data.length) return 0;
        var today = new Date().toISOString().slice(0, 10);
        var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (data.indexOf(today) === -1 && data.indexOf(yesterday) === -1) return 0;
        var streak = 0;
        var d = new Date();
        while (data.indexOf(d.toISOString().slice(0, 10)) !== -1) {
          streak++;
          d.setDate(d.getDate() - 1);
        }
        return streak;
      } catch (_) { return 0; }
    },

    /* ── Feed ── */
    renderFeed: async function () {
      var container = document.getElementById('campus-feed');
      if (!container) return;
      container.innerHTML = '<div class="skeleton" style="height:60px;margin-bottom:8px"></div><div class="skeleton" style="height:60px;margin-bottom:8px"></div><div class="skeleton" style="height:60px"></div>';

      var client = this.client();
      var user = this.user();

      try {
        var items = [];
        // Continue reading from study_history
        if (client && user) {
          var history = await client.from('study_history').select('*').eq('user_id', user.id).eq('is_deleted', false).order('last_read_at', { ascending: false }).limit(3);
          (history.data || []).forEach(function (h) {
            items.push({ icon: '📖', title: h.pdf_title || 'Continue Reading', sub: 'Resume from where you left off', type: 'continue_reading', link: h.pdf_id });
          });

          // Pending revision (goals not completed)
          var goals = await client.from('study_goals').select('*').eq('user_id', user.id).eq('status', 'active').eq('is_deleted', false).limit(2);
          (goals.data || []).forEach(function (g) {
            items.push({ icon: '🎯', title: g.title, sub: 'Goal in progress: ' + g.current_value + '/' + g.target_value + ' ' + g.unit, type: 'goal', link: g.id });
          });

          // Upcoming exams
          var exams = await client.from('exam_countdown').select('*').eq('user_id', user.id).eq('is_deleted', false).order('exam_date', { ascending: true }).limit(2);
          (exams.data || []).forEach(function (e) {
            var days = Math.ceil((new Date(e.exam_date) - new Date()) / 86400000);
            items.push({ icon: '⏳', title: e.exam_name, sub: days > 0 ? days + ' days remaining' : 'Today!', type: 'exam', badge: days + 'd' });
          });
        }

        // Admin feed items
        if (client) {
          var feed = await client.from('campus_feed').select('*').eq('status', 'published').eq('is_deleted', false).order('priority', { ascending: false }).limit(5);
          (feed.data || []).forEach(function (f) {
            items.push({ icon: f.icon || '📋', title: f.title, sub: f.subtitle || '', type: f.feed_type, badge: f.feed_type === 'today_quiz' ? 'NEW' : null, link: f.link_data });
          });
        }

        if (!items.length) {
          container.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📭</div><div class="campus-empty-text">Your feed is empty. Start studying to see personalized recommendations here.</div></div>';
          return;
        }

        var html = '<div class="campus-feed">';
        items.forEach(function (item) {
          html += '<div class="feed-item campus-fade-in" onclick="Campus.handleFeedClick(\'' + (item.type || '') + '\',\'' + (item.link || '') + '\')">' +
            '<div class="feed-item-icon">' + (item.icon || '📋') + '</div>' +
            '<div class="feed-item-body">' +
              '<div class="feed-item-title">' + self.escape(item.title) + '</div>' +
              '<div class="feed-item-sub">' + self.escape(item.sub || '') + '</div>' +
            '</div>' +
            (item.badge ? '<div class="feed-item-badge">' + item.badge + '</div>' : '') +
          '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
      } catch (e) {
        console.warn('Campus feed error:', e);
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">⚠️</div><div class="campus-empty-text">Unable to load feed. Please check your connection.</div></div>';
      }
    },

    handleFeedClick: function (type, link) {
      if (type === 'continue_reading' && link) {
        window.navigate('detail');
        // Could pass pdf_id to detail page
      } else if (type === 'today_quiz') {
        window.navigate('brainlab');
        setTimeout(function () { if (window.BrainLab) BrainLab.switchTab('quiz'); }, 100);
      } else if (type === 'goal') {
        this.switchTab('goals');
      } else if (type === 'exam') {
        this.switchTab('exams');
      }
    },

    /* ── Notes ── */
    renderNotes: async function () {
      var container = document.getElementById('campus-notes');
      if (!container) return;
      var self = this;

      var html = '<div class="note-editor">' +
        '<input type="text" id="noteTitleInput" placeholder="Note title..." maxlength="100">' +
        '<textarea id="noteContentInput" placeholder="Write your note..." maxlength="5000"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button class="focus-btn focus-btn-primary" onclick="Campus.saveNote()">Save Note</button>' +
        '</div>' +
      '</div>';

      html += '<h3 class="campus-section-title">Your Notes <span class="badge" id="note-count">0</span></h3>';
      html += '<div class="note-list" id="note-list"><div class="skeleton" style="height:50px"></div></div>';

      container.innerHTML = html;
      this.loadNotes();
    },

    loadNotes: async function () {
      var client = this.client();
      var user = this.user();
      var list = document.getElementById('note-list');
      var countEl = document.getElementById('note-count');
      if (!list) return;

      if (!client || !user) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📝</div><div class="campus-empty-text">Sign in to save notes.</div></div>';
        return;
      }

      try {
        var res = await client.from('study_notes').select('*').eq('user_id', user.id).eq('is_deleted', false).order('pinned', { ascending: false }).order('updated_at', { ascending: false });
        var notes = res.data || [];
        if (countEl) countEl.textContent = notes.length;

        if (!notes.length) {
          list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📝</div><div class="campus-empty-text">No notes yet. Create your first note above.</div></div>';
          return;
        }

        list.innerHTML = notes.map(function (n) {
          return '<div class="note-item campus-fade-in" onclick="Campus.editNote(\'' + n.id + '\')">' +
            '<div class="note-item-title">' + self.escape(n.title) + (n.pinned ? ' 📌' : '') + '</div>' +
            '<div class="note-item-preview">' + self.escape((n.content || '').slice(0, 100)) + '</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">⚠️</div><div class="campus-empty-text">Error loading notes.</div></div>';
      }
    },

    saveNote: async function () {
      var client = this.client();
      var user = this.user();
      if (!client || !user) { this.toast('Please sign in first'); return; }

      var title = (document.getElementById('noteTitleInput') || {}).value || 'Untitled';
      var content = (document.getElementById('noteContentInput') || {}).value || '';
      if (!content.trim()) { this.toast('Note cannot be empty'); return; }

      try {
        await client.from('study_notes').insert({
          user_id: user.id,
          title: title.trim(),
          content: content.trim()
        });
        document.getElementById('noteTitleInput').value = '';
        document.getElementById('noteContentInput').value = '';
        this.toast('Note saved!');
        this.loadNotes();
      } catch (e) {
        this.toast('Error saving note');
        console.warn(e);
      }
    },

    editNote: function (id) {
      // Simple: load into editor
      var client = this.client();
      var user = this.user();
      var self = this;
      client.from('study_notes').select('*').eq('id', id).single().then(function (res) {
        if (res.data) {
          document.getElementById('noteTitleInput').value = res.data.title;
          document.getElementById('noteContentInput').value = res.data.content;
          self._editingNoteId = id;
        }
      });
    },

    /* ── Focus Timer ── */
    renderTimer: function () {
      var container = document.getElementById('campus-timer');
      if (!container) return;

      var html = '<div class="focus-timer">' +
        '<div class="focus-timer-mode" id="timer-mode-label">FOCUS MODE</div>' +
        '<div class="focus-timer-display" id="timer-display">25:00</div>' +
        '<div class="focus-timer-controls">' +
          '<button class="focus-btn focus-btn-primary" id="timer-start-btn" onclick="Campus.toggleTimer()">Start</button>' +
          '<button class="focus-btn focus-btn-secondary" onclick="Campus.resetTimer()">Reset</button>' +
          '<button class="focus-btn focus-btn-secondary" onclick="Campus.switchTimerMode()">Switch Mode</button>' +
        '</div>' +
        '<div style="margin-top:16px;font-size:0.75rem;color:var(--text-secondary,#94a3b8)">Tap start to begin a focus session. Your study time is logged automatically.</div>' +
      '</div>';

      html += '<h3 class="campus-section-title">Recent Sessions</h3>';
      html += '<div id="timer-sessions"><div class="skeleton" style="height:50px"></div></div>';

      container.innerHTML = html;
      this._timerSeconds = 25 * 60;
      this.updateTimerDisplay();
      this.loadSessions();
    },

    toggleTimer: function () {
      if (this._timerRunning) {
        this.stopTimer();
      } else {
        this.startTimer();
      }
    },

    startTimer: function () {
      var self = this;
      this._timerRunning = true;
      this._timerStartTime = Date.now();
      var btn = document.getElementById('timer-start-btn');
      if (btn) btn.textContent = 'Stop';

      this._timerInterval = setInterval(function () {
        self._timerSeconds--;
        self.updateTimerDisplay();
        if (self._timerSeconds <= 0) {
          self.completeTimer();
        }
      }, 1000);

      // Log study day
      this.logStudyDay();
    },

    stopTimer: function () {
      this._timerRunning = false;
      clearInterval(this._timerInterval);
      var btn = document.getElementById('timer-start-btn');
      if (btn) btn.textContent = 'Start';

      // Save partial session
      var elapsed = this._timerMode === 'focus' ? 25 * 60 - this._timerSeconds : 5 * 60 - this._timerSeconds;
      if (elapsed > 10) this.saveSession(elapsed);
    },

    resetTimer: function () {
      this._timerRunning = false;
      clearInterval(this._timerInterval);
      this._timerSeconds = this._timerMode === 'focus' ? 25 * 60 : 5 * 60;
      var btn = document.getElementById('timer-start-btn');
      if (btn) btn.textContent = 'Start';
      this.updateTimerDisplay();
    },

    completeTimer: function () {
      clearInterval(this._timerInterval);
      this._timerRunning = false;
      var elapsed = this._timerMode === 'focus' ? 25 * 60 : 5 * 60;
      this.saveSession(elapsed);
      this.toast(this._timerMode === 'focus' ? 'Focus session complete! 🎉' : 'Break over! Back to focus.');
      this.resetTimer();
    },

    switchTimerMode: function () {
      this._timerMode = this._timerMode === 'focus' ? 'break' : 'focus';
      this.resetTimer();
      var label = document.getElementById('timer-mode-label');
      if (label) label.textContent = this._timerMode === 'focus' ? 'FOCUS MODE' : 'BREAK MODE';
    },

    updateTimerDisplay: function () {
      var display = document.getElementById('timer-display');
      if (!display) return;
      var m = Math.floor(this._timerSeconds / 60);
      var s = this._timerSeconds % 60;
      display.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },

    saveSession: async function (durationSecs) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) return;
      try {
        await client.from('study_sessions').insert({
          user_id: user.id,
          duration_secs: durationSecs,
          mode: this._timerMode,
          started_at: new Date(Date.now() - durationSecs * 1000).toISOString(),
          ended_at: new Date().toISOString()
        });
        this.loadSessions();
      } catch (e) { console.warn('Save session error:', e); }
    },

    loadSessions: async function () {
      var client = this.client();
      var user = this.user();
      var container = document.getElementById('timer-sessions');
      if (!container) return;

      if (!client || !user) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Sign in to track sessions.</div></div>';
        return;
      }

      try {
        var res = await client.from('study_sessions').select('*').eq('user_id', user.id).eq('is_deleted', false).order('started_at', { ascending: false }).limit(5);
        var sessions = res.data || [];
        if (!sessions.length) {
          container.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">No sessions yet. Start the timer!</div></div>';
          return;
        }
        container.innerHTML = sessions.map(function (s) {
          var mins = Math.floor((s.duration_secs || 0) / 60);
          return '<div class="feed-item"><div class="feed-item-icon">' + (s.mode === 'focus' ? '🎯' : '☕') + '</div><div class="feed-item-body"><div class="feed-item-title">' + mins + ' min ' + (s.mode || 'focus') + '</div><div class="feed-item-sub">' + new Date(s.started_at).toLocaleDateString() + '</div></div></div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading sessions.</div></div>';
      }
    },

    logStudyDay: function () {
      try {
        var days = JSON.parse(localStorage.getItem('campus_study_days') || '[]');
        var today = new Date().toISOString().slice(0, 10);
        if (days.indexOf(today) === -1) {
          days.push(today);
          localStorage.setItem('campus_study_days', JSON.stringify(days));
        }
      } catch (_) {}
    },

    /* ── Calendar ── */
    renderCalendar: function () {
      var container = document.getElementById('campus-calendar');
      if (!container) return;

      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth();
      var self = this;

      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var today = now.getDate();
      var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      var html = '<h3 class="campus-section-title">' + monthNames[month] + ' ' + year + '</h3>';
      html += '<div class="campus-calendar">';
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) {
        html += '<div class="cal-day-header">' + d + '</div>';
      });
      for (var i = 0; i < firstDay; i++) {
        html += '<div class="cal-day other-month"></div>';
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var cls = 'cal-day';
        if (d === today) cls += ' today';
        html += '<div class="' + cls + '" onclick="Campus.addCalendarEvent(' + d + ')">' + d + '</div>';
      }
      html += '</div>';

      html += '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<input type="text" id="cal-event-title" placeholder="Event title..." style="flex:1;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:inherit;font-size:0.82rem;outline:none">' +
        '<button class="focus-btn focus-btn-primary" onclick="Campus.saveCalendarEvent()">Add Event</button>' +
      '</div>';

      html += '<div id="cal-events-list"><div class="skeleton" style="height:50px"></div></div>';

      container.innerHTML = html;
      this.loadCalendarEvents();
    },

    saveCalendarEvent: async function () {
      var client = this.client();
      var user = this.user();
      var titleEl = document.getElementById('cal-event-title');
      if (!titleEl || !titleEl.value.trim()) { this.toast('Enter event title'); return; }
      if (!client || !user) { this.toast('Sign in first'); return; }

      try {
        await client.from('study_calendar').insert({
          user_id: user.id,
          title: titleEl.value.trim(),
          scheduled_at: new Date().toISOString()
        });
        titleEl.value = '';
        this.toast('Event added!');
        this.loadCalendarEvents();
      } catch (e) { this.toast('Error adding event'); }
    },

    loadCalendarEvents: async function () {
      var client = this.client();
      var user = this.user();
      var list = document.getElementById('cal-events-list');
      if (!list) return;

      if (!client || !user) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Sign in to manage events.</div></div>';
        return;
      }

      try {
        var res = await client.from('study_calendar').select('*').eq('user_id', user.id).eq('is_deleted', false).order('scheduled_at', { ascending: true }).limit(10);
        var events = res.data || [];
        if (!events.length) {
          list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">No events scheduled.</div></div>';
          return;
        }
        list.innerHTML = events.map(function (e) {
          return '<div class="feed-item campus-fade-in">' +
            '<div class="feed-item-icon">📅</div>' +
            '<div class="feed-item-body"><div class="feed-item-title">' + e.title + '</div>' +
            '<div class="feed-item-sub">' + new Date(e.scheduled_at).toLocaleString() + '</div></div>' +
            (e.completed ? '' : '<button class="focus-btn focus-btn-secondary" style="padding:6px 12px" onclick="Campus.completeEvent(\'' + e.id + '\')">✓</button>') +
          '</div>';
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading events.</div></div>';
      }
    },

    completeEvent: async function (id) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) return;
      try {
        await client.from('study_calendar').update({ completed: true, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
        this.loadCalendarEvents();
      } catch (e) {}
    },

    /* ── Goals ── */
    renderGoals: function () {
      var container = document.getElementById('campus-goals');
      if (!container) return;
      var self = this;

      var html = '<div class="note-editor">' +
        '<input type="text" id="goal-title" placeholder="Goal title (e.g. Complete 100 pages)" maxlength="120">' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<input type="number" id="goal-target" placeholder="Target" style="width:80px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:inherit;outline:none">' +
          '<input type="text" id="goal-unit" placeholder="pages/hours/chapters" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:inherit;outline:none">' +
          '<button class="focus-btn focus-btn-primary" onclick="Campus.saveGoal()">Add Goal</button>' +
        '</div>' +
      '</div>';

      html += '<div id="goal-list"><div class="skeleton" style="height:70px"></div></div>';

      container.innerHTML = html;
      this.loadGoals();
    },

    saveGoal: async function () {
      var client = this.client();
      var user = this.user();
      var title = (document.getElementById('goal-title') || {}).value;
      var target = parseInt((document.getElementById('goal-target') || {}).value) || 1;
      var unit = (document.getElementById('goal-unit') || {}).value || 'pages';
      if (!title || !title.trim()) { this.toast('Enter goal title'); return; }
      if (!client || !user) { this.toast('Sign in first'); return; }

      try {
        await client.from('study_goals').insert({
          user_id: user.id,
          title: title.trim(),
          target_value: target,
          unit: unit
        });
        document.getElementById('goal-title').value = '';
        document.getElementById('goal-target').value = '';
        this.toast('Goal created!');
        this.loadGoals();
      } catch (e) { this.toast('Error creating goal'); }
    },

    loadGoals: async function () {
      var client = this.client();
      var user = this.user();
      var list = document.getElementById('goal-list');
      if (!list) return;

      if (!client || !user) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Sign in to track goals.</div></div>';
        return;
      }

      try {
        var res = await client.from('study_goals').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false });
        var goals = res.data || [];
        if (!goals.length) {
          list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">🎯</div><div class="campus-empty-text">No goals yet. Create one above.</div></div>';
          return;
        }
        var self = this;
        list.innerHTML = goals.map(function (g) {
          var pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
          return '<div class="goal-item campus-fade-in ' + (g.status === 'completed' ? 'goal-completed' : '') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<div class="campus-card-title">' + self.escape(g.title) + '</div>' +
              '<span class="bl-card-tag ' + (g.status === 'completed' ? 'easy' : 'medium') + '">' + g.status + '</span>' +
            '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-secondary,#94a3b8);margin-top:4px">' + g.current_value + '/' + g.target_value + ' ' + (g.unit || '') + ' (' + pct + '%)</div>' +
            '<div class="goal-progress-bar"><div class="goal-progress-fill" style="width:' + pct + '%"></div></div>' +
            (g.status === 'active' ? '<button class="focus-btn focus-btn-secondary" style="padding:6px 12px;margin-top:8px" onclick="Campus.updateGoal(\'' + g.id + '\',' + (g.current_value || 0) + ',' + g.target_value + ')">+1 ' + (g.unit || '') + '</button>' : '') +
          '</div>';
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading goals.</div></div>';
      }
    },

    updateGoal: async function (id, current, target) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) return;
      var newVal = current + 1;
      var status = newVal >= target ? 'completed' : 'active';
      try {
        await client.from('study_goals').update({ current_value: newVal, status: status, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
        this.loadGoals();
      } catch (e) {}
    },

    /* ── History ── */
    renderHistory: async function () {
      var container = document.getElementById('campus-history');
      if (!container) return;
      var self = this;

      var client = this.client();
      var user = this.user();

      if (!client || !user) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📖</div><div class="campus-empty-text">Sign in to see reading history.</div></div>';
        return;
      }

      container.innerHTML = '<div class="skeleton" style="height:60px;margin-bottom:8px"></div><div class="skeleton" style="height:60px"></div>';

      try {
        var res = await client.from('study_history').select('*').eq('user_id', user.id).eq('is_deleted', false).order('last_read_at', { ascending: false }).limit(20);
        var items = res.data || [];
        if (!items.length) {
          container.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📖</div><div class="campus-empty-text">No reading history yet.</div></div>';
          return;
        }
        container.innerHTML = items.map(function (h) {
          return '<div class="feed-item campus-fade-in" onclick="navigate(\'detail\')">' +
            '<div class="feed-item-icon">📄</div>' +
            '<div class="feed-item-body"><div class="feed-item-title">' + self.escape(h.pdf_title || 'Untitled') + '</div>' +
            '<div class="feed-item-sub">' + (h.pages_read || 0) + ' pages · ' + new Date(h.last_read_at).toLocaleDateString() + '</div></div>' +
          '</div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading history.</div></div>';
      }
    },

    /* ── Exam Countdown ── */
    renderExams: function () {
      var container = document.getElementById('campus-exams');
      if (!container) return;
      var self = this;

      var html = '<div class="note-editor">' +
        '<input type="text" id="exam-name" placeholder="Exam name..." maxlength="100">' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<input type="date" id="exam-date" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:inherit;outline:none">' +
          '<input type="text" id="exam-subject" placeholder="Subject (optional)" style="flex:1;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:inherit;outline:none">' +
          '<button class="focus-btn focus-btn-primary" onclick="Campus.saveExam()">Add</button>' +
        '</div>' +
      '</div>';
      html += '<div id="exam-list"><div class="skeleton" style="height:70px"></div></div>';

      container.innerHTML = html;
      this.loadExams();
    },

    saveExam: async function () {
      var client = this.client();
      var user = this.user();
      var name = (document.getElementById('exam-name') || {}).value;
      var date = (document.getElementById('exam-date') || {}).value;
      var subject = (document.getElementById('exam-subject') || {}).value;
      if (!name || !date) { this.toast('Enter exam name and date'); return; }
      if (!client || !user) { this.toast('Sign in first'); return; }

      try {
        await client.from('exam_countdown').insert({
          user_id: user.id,
          exam_name: name.trim(),
          exam_date: new Date(date).toISOString(),
          subject: subject || null
        });
        document.getElementById('exam-name').value = '';
        document.getElementById('exam-date').value = '';
        document.getElementById('exam-subject').value = '';
        this.toast('Exam added!');
        this.loadExams();
      } catch (e) { this.toast('Error adding exam'); }
    },

    loadExams: async function () {
      var client = this.client();
      var user = this.user();
      var list = document.getElementById('exam-list');
      if (!list) return;

      if (!client || !user) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Sign in to track exams.</div></div>';
        return;
      }

      try {
        var res = await client.from('exam_countdown').select('*').eq('user_id', user.id).eq('is_deleted', false).order('exam_date', { ascending: true });
        var exams = res.data || [];
        if (!exams.length) {
          list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">⏳</div><div class="campus-empty-text">No exams tracked. Add one above.</div></div>';
          return;
        }
        list.innerHTML = exams.map(function (e) {
          var days = Math.ceil((new Date(e.exam_date) - new Date()) / 86400000);
          return '<div class="exam-countdown-item campus-fade-in">' +
            '<div class="exam-countdown-days">' + (days > 0 ? days : 0) + '</div>' +
            '<div class="exam-countdown-info">' +
              '<div class="exam-countdown-name">' + e.exam_name + '</div>' +
              '<div class="exam-countdown-date">' + new Date(e.exam_date).toLocaleDateString() + (e.subject ? ' · ' + e.subject : '') + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading exams.</div></div>';
      }
    },

    /* ── Document Vault ── */
    renderVault: function () {
      var container = document.getElementById('campus-vault');
      if (!container) return;
      var self = this;

      var html = '<div style="display:flex;gap:8px;margin-bottom:16px">' +
        '<button class="focus-btn focus-btn-primary" onclick="Campus.uploadDocument(\'resume\')">Upload Resume</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="Campus.uploadDocument(\'certificate\')">Upload Certificate</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="Campus.uploadDocument(\'personal\')">Upload Document</button>' +
      '</div>';
      html += '<div id="vault-list"><div class="skeleton" style="height:80px"></div></div>';

      container.innerHTML = html;
      this.loadVault();
    },

    uploadDocument: function (type) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) { this.toast('Sign in first'); return; }

      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.jpg,.png,.webp';
      input.onchange = async function (e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { self.toast('File too large (max 5MB)'); return; }

        try {
          var fileName = user.id + '/documents/' + Date.now() + '_' + file.name;
          var upload = await client.storage.from('user-documents').upload(fileName, file);
          if (upload.error) throw upload.error;
          var url = client.storage.from('user-documents').getPublicUrl(fileName);

          await client.from('documents').insert({
            user_id: user.id,
            doc_type: type,
            title: file.name,
            file_url: url.data.publicUrl,
            file_size: file.size,
            mime_type: file.type
          });
          self.toast('Document uploaded!');
          self.loadVault();
        } catch (e) {
          self.toast('Upload failed');
          console.warn(e);
        }
      };
      input.click();
    },

    loadVault: async function () {
      var client = this.client();
      var user = this.user();
      var list = document.getElementById('vault-list');
      if (!list) return;

      if (!client || !user) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Sign in to access your vault.</div></div>';
        return;
      }

      try {
        var res = await client.from('documents').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false });
        var docs = res.data || [];
        if (!docs.length) {
          list.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">🗄️</div><div class="campus-empty-text">No documents yet. Upload your first document above.</div></div>';
          return;
        }
        var icons = { resume: '📄', certificate: '🏆', personal: '📋', other: '📎' };
        list.innerHTML = '<div class="vault-grid">' + docs.map(function (d) {
          return '<div class="vault-item campus-fade-in" onclick="window.open(\'' + (d.file_url || '#') + '\',\'_blank\')">' +
            '<div class="vault-item-icon">' + (icons[d.doc_type] || '📎') + '</div>' +
            '<div class="vault-item-name">' + self.escape(d.title) + '</div>' +
            '<div class="vault-item-type">' + d.doc_type + '</div>' +
          '</div>';
        }).join('') + '</div>';
      } catch (e) {
        list.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading documents.</div></div>';
      }
    },

    /* ── Analytics ── */
    renderAnalytics: async function () {
      var container = document.getElementById('campus-analytics');
      if (!container) return;
      var self = this;
      var client = this.client();
      var user = this.user();

      if (!client || !user) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-icon">📊</div><div class="campus-empty-text">Sign in to view analytics.</div></div>';
        return;
      }

      container.innerHTML = '<div class="skeleton" style="height:80px"></div>';

      try {
        var sessions = await client.from('study_sessions').select('duration_secs,mode,started_at').eq('user_id', user.id).eq('is_deleted', false);
        var goals = await client.from('study_goals').select('status').eq('user_id', user.id).eq('is_deleted', false);

        var totalSecs = 0, focusSecs = 0, breakSecs = 0;
        (sessions.data || []).forEach(function (s) {
          totalSecs += s.duration_secs || 0;
          if (s.mode === 'focus') focusSecs += s.duration_secs || 0;
          else breakSecs += s.duration_secs || 0;
        });

        var totalGoals = (goals.data || []).length;
        var completedGoals = (goals.data || []).filter(function (g) { return g.status === 'completed'; }).length;

        // Weekly study time (last 7 days)
        var weekData = [0,0,0,0,0,0,0];
        var now = new Date();
        (sessions.data || []).forEach(function (s) {
          var d = new Date(s.started_at);
          var dayDiff = Math.floor((now - d) / 86400000);
          if (dayDiff >= 0 && dayDiff < 7) {
            weekData[6 - dayDiff] += (s.duration_secs || 0) / 60;
          }
        });
        var maxMin = Math.max.apply(null, weekData) || 1;

        var html = '<div class="campus-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + (totalSecs/3600).toFixed(1) + '</div><div class="analytics-stat-label">Total Hours</div></div>' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + (focusSecs/3600).toFixed(1) + '</div><div class="analytics-stat-label">Focus Hours</div></div>' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + (sessions.data||[]).length + '</div><div class="analytics-stat-label">Sessions</div></div>' +
          '<div class="analytics-stat campus-fade-in"><div class="analytics-stat-num">' + completedGoals + '/' + totalGoals + '</div><div class="analytics-stat-label">Goals Done</div></div>' +
        '</div>';

        // Weekly bar chart (CSS)
        var dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        var todayIdx = (now.getDay() + 6) % 7;
        html += '<h3 class="campus-section-title">Weekly Study Time (minutes)</h3>';
        html += '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:12px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:20px">';
        weekData.forEach(function (mins, i) {
          var h = Math.max(2, (mins / maxMin) * 100);
          html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">' +
            '<div style="font-size:0.6rem;color:var(--text-secondary,#94a3b8)">' + Math.round(mins) + '</div>' +
            '<div style="width:100%;height:' + h + '%;border-radius:6px 6px 0 0;background:' + (i === todayIdx ? 'linear-gradient(180deg,#3d8ef8,#8b5cf6)' : 'rgba(61,142,248,0.3)') + '"></div>' +
            '<div style="font-size:0.6rem;color:var(--text-secondary,#94a3b8)">' + dayNames[i] + '</div>' +
          '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div class="campus-empty"><div class="campus-empty-text">Error loading analytics.</div></div>';
      }
    },

    /* ── Helpers ── */
    escape: function (str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    toast: function (msg) {
      if (window._showToast) { window._showToast(msg); return; }
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(15,20,30,0.95);color:#fff;padding:10px 20px;border-radius:12px;font-size:0.82rem;z-index:9999;transition:opacity 0.3s';
      document.body.appendChild(t);
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 2500);
    },

    /* ── Init ── */
    init: function () {
      if (this.initialized) return;
      this.initialized = true;
      this.switchTab('dashboard');
    }
  };
})();
