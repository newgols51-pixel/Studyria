/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA BRAINLAB — Complete Learning Hub (brainlab.js)
   12 sections. Seed/demo fallback. Supabase integration preserved.
   Design: Warm Paper Cream + Royal Maroon + Premium Gold
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Seed Data (clearly marked DEMO) ── */
  var SEED_QUIZZES = [
    { id:'demo-q1', title:'Daily GK Challenge', category:'General Knowledge', questions:20, duration:10, difficulty:'medium', xp:100, icon:'🧠' },
    { id:'demo-q2', title:'Assam History Quiz', category:'Assam GK', questions:15, duration:8, difficulty:'easy', xp:75, icon:'🏛️' },
    { id:'demo-q3', title:'Indian Polity Basics', category:'Polity', questions:25, duration:15, difficulty:'medium', xp:120, icon:'⚖️' },
    { id:'demo-q4', title:'Geography of India', category:'Geography', questions:20, duration:12, difficulty:'medium', xp:100, icon:'🗺️' },
    { id:'demo-q5', title:'Current Affairs Monthly', category:'Current Affairs', questions:30, duration:20, difficulty:'hard', xp:150, icon:'📰' },
    { id:'demo-q6', title:'Science & Tech Fundamentals', category:'Science', questions:20, duration:12, difficulty:'medium', xp:100, icon:'🔬' },
    { id:'demo-q7', title:'Indian Economy Quiz', category:'Economy', questions:18, duration:10, difficulty:'hard', xp:110, icon:'💰' },
    { id:'demo-q8', title:'English Grammar Test', category:'English', questions:25, duration:15, difficulty:'easy', xp:90, icon:'✍️' },
    { id:'demo-q9', title:'Reasoning & Logic', category:'Reasoning', questions:20, duration:15, difficulty:'hard', xp:130, icon:'🧩' },
    { id:'demo-q10', title:'Mathematics Basics', category:'Mathematics', questions:20, duration:15, difficulty:'medium', xp:100, icon:'🔢' },
    { id:'demo-q11', title:'Computer Awareness', category:'Computer', questions:15, duration:10, difficulty:'easy', xp:80, icon:'💻' },
    { id:'demo-q12', title:'Assam Geography Special', category:'Assam GK', questions:18, duration:10, difficulty:'medium', xp:95, icon:'🏔️' }
  ];

  var SEED_MOCKS = [
    { id:'demo-m1', title:'APSC Prelims Mock Test', exam:'APSC', questions:100, marks:200, duration:120, difficulty:'hard', icon:'📝' },
    { id:'demo-m2', title:'ADRE Grade III Mock', exam:'ADRE', questions:80, marks:160, duration:90, difficulty:'medium', icon:'📋' },
    { id:'demo-m3', title:'Assam Police SI Mock', exam:'Assam Police', questions:60, marks:120, duration:60, difficulty:'medium', icon:'🚔' },
    { id:'demo-m4', title:'Assam TET Mock Test', exam:'Assam TET', questions:100, marks:100, duration:120, difficulty:'medium', icon:'📚' },
    { id:'demo-m5', title:'SSC CGL Tier I Mock', exam:'SSC', questions:100, marks:200, duration:60, difficulty:'hard', icon:'📊' },
    { id:'demo-m6', title:'Railway NTPC Mock', exam:'Railway', questions:100, marks:100, duration:90, difficulty:'medium', icon:'🚂' },
    { id:'demo-m7', title:'Banking PO Prelims', exam:'Banking', questions:100, marks:100, duration:60, difficulty:'hard', icon:'🏦' },
    { id:'demo-m8', title:'General Competitive Mock', exam:'General', questions:50, marks:100, duration:60, difficulty:'medium', icon:'🎯' },
    { id:'demo-m9', title:'ADRE Grade IV Mock', exam:'ADRE', questions:60, marks:120, duration:60, difficulty:'easy', icon:'📄' },
    { id:'demo-m10', title:'APSC Mains Mock Test', exam:'APSC', questions:50, marks:250, duration:180, difficulty:'hard', icon:'✒️' },
    { id:'demo-m11', title:'Assam Police Constable', exam:'Assam Police', questions:50, marks:50, duration:60, difficulty:'easy', icon:'👮' },
    { id:'demo-m12', title:'SSC CHSL Mock Test', exam:'SSC', questions:100, marks:200, duration:60, difficulty:'medium', icon:'📃' }
  ];

  var SEED_DECKS = [
    { id:'demo-f1', title:'Indian Polity', topic:'Polity', cards:50, difficulty:'medium', icon:'⚖️' },
    { id:'demo-f2', title:'Assam History', topic:'Assam GK', cards:40, difficulty:'easy', icon:'🏛️' },
    { id:'demo-f3', title:'Indian History', topic:'History', cards:60, difficulty:'medium', icon:'📜' },
    { id:'demo-f4', title:'Geography Basics', topic:'Geography', cards:45, difficulty:'easy', icon:'🗺️' },
    { id:'demo-f5', title:'Indian Economy', topic:'Economy', cards:35, difficulty:'hard', icon:'💰' },
    { id:'demo-f6', title:'General Science', topic:'Science', cards:50, difficulty:'medium', icon:'🔬' },
    { id:'demo-f7', title:'Current Affairs Quick Cards', topic:'Current Affairs', cards:30, difficulty:'medium', icon:'📰' },
    { id:'demo-f8', title:'Important Acts', topic:'Polity', cards:25, difficulty:'hard', icon:'📖' },
    { id:'demo-f9', title:'Constitutional Articles', topic:'Polity', cards:40, difficulty:'hard', icon:'📜' },
    { id:'demo-f10', title:'Assam GK Special', topic:'Assam GK', cards:35, difficulty:'easy', icon:'🏔️' },
    { id:'demo-f11', title:'English Vocabulary', topic:'English', cards:60, difficulty:'easy', icon:'✍️' },
    { id:'demo-f12', title:'Computer Awareness', topic:'Computer', cards:30, difficulty:'medium', icon:'💻' }
  ];

  var SEED_PYQS = [
    { id:'demo-p1', title:'APSC PYQ Practice', exam:'APSC', questions:50, icon:'📝' },
    { id:'demo-p2', title:'ADRE PYQ Practice', exam:'ADRE', questions:50, icon:'📋' },
    { id:'demo-p3', title:'Assam Police PYQ', exam:'Assam Police', questions:40, icon:'🚔' },
    { id:'demo-p4', title:'Assam TET PYQ', exam:'Assam TET', questions:45, icon:'📚' },
    { id:'demo-p5', title:'SSC PYQ Practice', exam:'SSC', questions:50, icon:'📊' },
    { id:'demo-p6', title:'Railway PYQ', exam:'Railway', questions:50, icon:'🚂' },
    { id:'demo-p7', title:'Banking PYQ', exam:'Banking', questions:40, icon:'🏦' },
    { id:'demo-p8', title:'Grade III PYQ', exam:'ADRE', questions:40, icon:'📄' },
    { id:'demo-p9', title:'Grade IV PYQ', exam:'ADRE', questions:35, icon:'📃' },
    { id:'demo-p10', title:'APSC Prelims PYQ', exam:'APSC', questions:100, icon:'✒️' },
    { id:'demo-p11', title:'Assam Police Constable PYQ', exam:'Assam Police', questions:50, icon:'👮' },
    { id:'demo-p12', title:'General Competitive PYQ', exam:'General', questions:30, icon:'🎯' }
  ];

  var SEED_AFFAIRS_CATS = [
    { id:'daily', title:'Daily Current Affairs', period:'Daily', icon:'📅' },
    { id:'weekly', title:'Weekly Current Affairs', period:'Weekly', icon:'🗓️' },
    { id:'monthly', title:'Monthly Current Affairs', period:'Monthly', icon:'📆' },
    { id:'assam', title:'Assam Current Affairs', period:'Assam', icon:'🏔️' },
    { id:'national', title:'National Current Affairs', period:'National', icon:'🇮🇳' },
    { id:'international', title:'International Current Affairs', period:'International', icon:'🌍' },
    { id:'schemes', title:'Government Schemes', period:'Schemes', icon:'🏛️' },
    { id:'awards', title:'Awards & Honours', period:'Awards', icon:'🏆' },
    { id:'sports', title:'Sports Current Affairs', period:'Sports', icon:'🏅' },
    { id:'sci-tech', title:'Science & Technology', period:'Sci-Tech', icon:'🔬' }
  ];

  var SEED_ARENA = [
    { mode:'quick10', title:'Quick 10', sub:'10 Questions · 5 min', icon:'⚡' },
    { mode:'quick25', title:'Quick 25', sub:'25 Questions · 12 min', icon:'🔥' },
    { mode:'quick50', title:'Quick 50', sub:'50 Questions · 25 min', icon:'💪' },
    { mode:'timed', title:'Timed Practice', sub:'Race against the clock', icon:'⏱️' },
    { mode:'topic', title:'Topic Practice', sub:'Pick a subject', icon:'🎯' },
    { mode:'difficulty', title:'Difficulty Practice', sub:'Easy → Hard', icon:'📈' },
    { mode:'random', title:'Random Practice', sub:'Surprise questions', icon:'🎲' }
  ];

  var SEED_TOOLS = [
    { name:'Revision Timer', desc:'Pomodoro study timer', icon:'⏰', action:'timer' },
    { name:'Study Planner', desc:'Plan your study schedule', icon:'📅', action:'planner' },
    { name:'Focus Timer', desc:'Deep focus sessions', icon:'🎯', action:'focus' },
    { name:'Saved Questions', desc:'Bookmark important Qs', icon:'🔖', action:'bookmarks' },
    { name:'Formula Sheet', desc:'Quick reference formulas', icon:'📐', action:'formulas' },
    { name:'Important Facts', desc:'Key facts for exams', icon:'💡', action:'facts' },
    { name:'Vocabulary Builder', desc:'Build your vocabulary', icon:'📚', action:'vocab' },
    { name:'Exam Countdown', desc:'Track exam dates', icon:'⏳', action:'countdown' }
  ];

  /* ── BrainLab Module ── */
  window.BrainLab = {
    initialized: false,
    _currentQuiz: null,
    _currentQIdx: 0,
    _questions: [],
    _answers: [],
    _startTime: null,
    _flashcardIdx: 0,
    _flashcards: [],
    _leaderFilter: 'all-time',
    _searchQuery: '',
    _filterExam: '',

    /* ── Supabase client ── */
    client: function () {
      return window.supabase || (window.Supabase && window.Supabase.getClient());
    },

    /* ── Current user ── */
    user: function () {
      return window.currentUser || null;
    },
    /* ── Backward-compatible switchTab (maps old tab names to new sections) ── */
    switchTab: function (tab) {
      var map = {
        quiz: 'bl-sec-quizzes',
        flashcards: 'bl-sec-flashcards',
        mock: 'bl-sec-mocks',
        mistakes: 'bl-sec-mistakes',
        affairs: 'bl-sec-affairs',
        leaderboard: 'bl-sec-leaderboard',
        performance: 'bl-sec-performance'
      };
      if (map[tab]) this.scrollToSection(map[tab]);
    },

    /* ── Escape HTML ── */
    escape: function (str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /* ── Toast ── */
    toast: function (msg) {
      if (window._showToast) { window._showToast(msg); return; }
      var t = document.createElement('div');
      t.textContent = msg;
      t.className = 'bl-toast';
      t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(28,27,26,0.95);color:#fff;padding:10px 20px;border-radius:12px;font-size:0.82rem;z-index:9999;transition:opacity 0.3s';
      document.body.appendChild(t);
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 2500);
    },

    /* ── Card HTML Helper ── */
    cardHTML: function (icon, title, subtitle, tags, ctaText, ctaAction, isDemo) {
      var html = '<div class="bl-card bl-fade-in" onclick="' + ctaAction + '">';
      if (isDemo) html += '<span class="bl-demo-badge">DEMO</span>';
      html += '<div class="bl-card-icon">' + icon + '</div>';
      html += '<div class="bl-card-title">' + this.escape(title) + '</div>';
      if (subtitle) html += '<div class="bl-card-subtitle">' + this.escape(subtitle) + '</div>';
      if (tags && tags.length) {
        html += '<div class="bl-card-meta">';
        tags.forEach(function (t) { html += '<span class="bl-card-tag ' + (t.cls || '') + '">' + t.text + '</span>'; });
        html += '</div>';
      }
      html += '<button class="bl-card-cta" onclick="event.stopPropagation();' + ctaAction + '">' + ctaText + '</button>';
      html += '</div>';
      return html;
    },

    /* ── Init ── */
    init: function () {
      if (this.initialized) return;
      this.initialized = true;
      this.renderStats();
      this.renderAllSections();
      this.setupNav();
    },

    /* ── Quick Stats ── */
    renderStats: function () {
      var container = document.getElementById('bl-stats');
      if (!container) return;
      var user = this.user();
      if (!user) {
        container.innerHTML = '<div class="bl-stats-signin">Sign in to track your progress · <a onclick="navigate(\'login\')">Sign In</a></div>';
        return;
      }
      // Try real data
      var self = this;
      var client = this.client();
      if (client) {
        client.from('quiz_attempts').select('*').eq('user_id', user.id).eq('is_deleted', false).limit(100)
          .then(function (res) {
            var attempts = res.data || [];
            var tests = attempts.length;
            var totalQ = 0, correctQ = 0;
            attempts.forEach(function (a) {
              if (a.answers) { totalQ += a.answers.length; var qs = self._questions || []; }
              if (a.total_marks) { correctQ += Math.round((a.score / a.total_marks) * (a.answers ? a.answers.length : 20)); }
            });
            var accuracy = tests > 0 && totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;
            var streak = self.dayStreak();
            container.innerHTML =
              '<div class="bl-stat"><div class="bl-stat-icon">📝</div><div class="bl-stat-num">' + tests + '</div><div class="bl-stat-label">Tests</div></div>' +
              '<div class="bl-stat"><div class="bl-stat-icon">🎯</div><div class="bl-stat-num">' + accuracy + '%</div><div class="bl-stat-label">Accuracy</div></div>' +
              '<div class="bl-stat"><div class="bl-stat-icon">🔥</div><div class="bl-stat-num">' + streak + '</div><div class="bl-stat-label">Streak</div></div>';
          }).catch(function () {
            container.innerHTML = '<div class="bl-stats-signin">Unable to load stats. Please refresh.</div>';
          });
      } else {
        container.innerHTML =
          '<div class="bl-stat"><div class="bl-stat-icon">📝</div><div class="bl-stat-num">0</div><div class="bl-stat-label">Tests</div></div>' +
          '<div class="bl-stat"><div class="bl-stat-icon">🎯</div><div class="bl-stat-num">0%</div><div class="bl-stat-label">Accuracy</div></div>' +
          '<div class="bl-stat"><div class="bl-stat-icon">🔥</div><div class="bl-stat-num">0</div><div class="bl-stat-label">Streak</div></div>';
      }
    },

    /* ── Render All Sections ── */
    renderAllSections: function () {
      this.renderDailyChallenge();
      this.renderContinueLearning();
      this.renderQuizzes();
      this.renderMockTests();
      this.renderFlashcardDecks();
      this.renderCurrentAffairs();
      this.renderPYQ();
      this.renderPracticeArena();
      this.renderMistakes();
      this.renderPerformance();
      this.renderLeaderboard();
      this.renderStudyStreak();
      this.renderStudyTools();
    },

    /* ── Section Navigation (scroll to) ── */
    setupNav: function () {
      var self = this;
      var navItems = document.querySelectorAll('.bl-nav-item');
      navItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var target = this.getAttribute('data-target');
          var section = document.getElementById(target);
          if (section) {
            navItems.forEach(function (n) { n.classList.remove('active'); });
            this.classList.add('active');
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
      // Auto-highlight on scroll
      window.addEventListener('scroll', function () {
        var scrollY = window.scrollY + 140;
        var activeId = null;
        document.querySelectorAll('.bl-section').forEach(function (s) {
          if (s.offsetTop <= scrollY) activeId = s.id;
        });
        if (activeId) {
          navItems.forEach(function (n) {
            n.classList.toggle('active', n.getAttribute('data-target') === activeId);
          });
        }
      }, { passive: true });
    },

    scrollToSection: function (id) {
      var el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    /* ── 01. Daily Challenge ── */
    renderDailyChallenge: function () {
      var container = document.getElementById('bl-daily-challenge');
      if (!container) return;
      var self = this;
      var user = this.user();
      var todayKey = 'bl_daily_' + new Date().toISOString().slice(0, 10);
      var done = false;
      try { done = !!localStorage.getItem(todayKey); } catch (_) {}

      if (done) {
        container.innerHTML = '<div class="bl-challenge bl-fade-in">' +
          '<div class="bl-challenge-header"><span class="bl-challenge-icon">⚡</span><span class="bl-challenge-title">Today\'s Challenge Complete!</span></div>' +
          '<div class="bl-challenge-meta"><span>✅ 10 Questions</span><span>⏱️ 5 min</span><span>⭐ +50 XP earned</span></div>' +
          '<div class="bl-challenge-done">✅ Completed — Come back tomorrow!</div>' +
        '</div>';
      } else {
        container.innerHTML = '<div class="bl-challenge bl-fade-in">' +
          '<div class="bl-challenge-header"><span class="bl-challenge-icon">⚡</span><span class="bl-challenge-title">Today\'s Challenge</span></div>' +
          '<div class="bl-challenge-meta"><span>📋 10 Questions</span><span>⏱️ 5 min</span><span>⭐ +50 XP</span></div>' +
          '<button class="bl-challenge-btn" onclick="BrainLab.startDailyChallenge()">Start Challenge →</button>' +
        '</div>';
      }
    },

    startDailyChallenge: function () {
      this.toast('Daily challenge starting soon! Connect to backend to enable.');
    },

    /* ── Continue Learning ── */
    renderContinueLearning: function () {
      var container = document.getElementById('bl-continue-learning');
      if (!container) return;
      var user = this.user();
      if (!user) {
        container.innerHTML = '<div class="bl-empty bl-fade-in">' +
          '<div class="bl-empty-icon">🚀</div>' +
          '<div class="bl-empty-text">Start your BrainLab journey. Choose a quiz, test, or flashcard deck below to begin.</div>' +
        '</div>';
        return;
      }
      // Try to get last attempt
      var self = this;
      var client = this.client();
      if (client) {
        client.from('quiz_attempts').select('*, brainlab_quizzes(title)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1)
          .then(function (res) {
            if (res.data && res.data.length) {
              var a = res.data[0];
              var title = (a.brainlab_quizzes && a.brainlab_quizzes.title) || 'Last Quiz';
              var pct = a.total_marks ? Math.round((a.score / a.total_marks) * 100) : 0;
              container.innerHTML = '<div class="bl-continue bl-fade-in" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">' +
                '<div class="bl-continue-icon">📚</div>' +
                '<div class="bl-continue-body">' +
                  '<div class="bl-continue-title">Continue: ' + self.escape(title) + '</div>' +
                  '<div class="bl-continue-progress"><div class="bl-continue-progress-fill" style="width:' + pct + '%"></div></div>' +
                  '<div class="bl-continue-text">Score: ' + pct + '% — Keep going!</div>' +
                '</div>' +
                '<span style="font-size:1.2rem">→</span>' +
              '</div>';
            } else {
              container.innerHTML = '<div class="bl-empty bl-fade-in">' +
                '<div class="bl-empty-icon">🚀</div>' +
                '<div class="bl-empty-text">Start your BrainLab journey. Choose a quiz, test, or flashcard deck below to begin.</div>' +
              '</div>';
            }
          }).catch(function () {
            container.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-text">Unable to load. Please refresh.</div></div>';
          });
      } else {
        container.innerHTML = '<div class="bl-empty bl-fade-in">' +
          '<div class="bl-empty-icon">🚀</div>' +
          '<div class="bl-empty-text">Start your BrainLab journey. Choose a quiz, test, or flashcard deck below to begin.</div>' +
        '</div>';
      }
    },

    /* ── 02. Quizzes ── */
    renderQuizzes: async function () {
      var container = document.getElementById('bl-quizzes');
      if (!container) return;
      var self = this;
      container.innerHTML = '<div class="bl-carousel"><div class="bl-skeleton" style="height:160px;width:240px"></div><div class="bl-skeleton" style="height:160px;width:240px"></div></div>';
      var client = this.client();
      var quizzes = [];
      try {
        if (client) {
          var res = await client.from('brainlab_quizzes').select('*').eq('status', 'published').eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
          quizzes = res.data || [];
        }
      } catch (_) {}
      var html = '';
      if (quizzes.length) {
        html = '<div class="bl-carousel">' + quizzes.map(function (q) {
          return self.cardHTML('🧩', q.title, q.description || '', [
            { cls: (q.difficulty || 'medium'), text: q.difficulty || 'medium' },
            { text: (q.duration_mins || 30) + ' min' },
            { text: (q.total_marks || 100) + ' marks' }
          ], 'Start Quiz', "BrainLab.startQuiz('" + q.id + "')", false);
        }).join('') + '</div>';
      } else {
        html = '<div class="bl-carousel">' + SEED_QUIZZES.map(function (q) {
          return self.cardHTML(q.icon, q.title, q.category + ' · ' + q.questions + ' Questions', [
            { cls: q.difficulty, text: q.difficulty },
            { text: q.duration + ' min' },
            { cls: 'gold', text: '+' + q.xp + ' XP' }
          ], 'Start Quiz', "BrainLab.startSeedQuiz('" + q.id + "')", true);
        }).join('') + '</div>';
      }
      container.innerHTML = html;
    },

    startSeedQuiz: function (seedId) {
      this.toast('Quiz player requires published questions. Admins can add questions via BrainLab Manager.');
    },

    /* ── Quiz Player (existing logic preserved) ── */
    startQuiz: async function (quizId) {
      var client = this.client();
      if (!client) { this.toast('Unable to connect'); return; }
      try {
        var quizRes = await client.from('brainlab_quizzes').select('*').eq('id', quizId).single();
        var qRes = await client.from('quiz_questions').select('*').eq('quiz_id', quizId).eq('is_deleted', false);
        this._currentQuiz = quizRes.data;
        this._questions = qRes.data || [];
        this._currentQIdx = 0;
        this._answers = [];
        this._startTime = Date.now();
        if (!this._questions.length) { this.toast('No questions in this quiz yet.'); return; }
        this.renderQuestion();
      } catch (e) { this.toast('Error starting quiz'); console.warn(e); }
    },

    renderQuestion: function () {
      var container = document.getElementById('bl-quiz-player-area');
      if (!container || !this._questions.length) return;
      var self = this;
      var q = this._questions[this._currentQIdx];
      var total = this._questions.length;
      var progress = (this._currentQIdx / total) * 100;
      var html = '<div class="bl-quiz-player bl-fade-in">' +
        '<div class="bl-quiz-progress"><div class="bl-quiz-progress-bar"><div class="bl-quiz-progress-fill" style="width:' + progress + '%"></div></div><div class="bl-quiz-counter">Q ' + (this._currentQIdx + 1) + '/' + total + '</div></div>' +
        '<div class="bl-quiz-q">' + this.escape(q.question_text) + '</div><div class="bl-quiz-options">';
      var opts = [{letter:'a',text:q.option_a},{letter:'b',text:q.option_b},{letter:'c',text:q.option_c},{letter:'d',text:q.option_d}].filter(function(o){return o.text;});
      opts.forEach(function (o) {
        html += '<div class="bl-quiz-option" data-answer="' + o.letter + '" onclick="BrainLab.selectAnswer(\'' + o.letter + '\')"><div class="bl-quiz-option-letter">' + o.letter.toUpperCase() + '</div><div>' + self.escape(o.text) + '</div></div>';
      });
      html += '</div><div id="quiz-explanation" style="display:none;margin-top:12px;padding:12px;border-radius:10px;background:rgba(147,2,5,0.04);font-size:0.78rem;line-height:1.5;color:var(--hp-muted,#8a8178)">' + (q.explanation || 'No explanation available.') + '</div>';
      html += '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">';
      if (this._currentQIdx < total - 1) html += '<button class="bl-card-cta" id="quiz-next-btn" onclick="BrainLab.nextQuestion()" style="display:none">Next →</button>';
      else html += '<button class="bl-card-cta" id="quiz-next-btn" onclick="BrainLab.finishQuiz()" style="display:none">Finish</button>';
      html += '</div></div>';
      container.innerHTML = html;
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    selectAnswer: function (letter) {
      if (this._answers[this._currentQIdx]) return;
      var q = this._questions[this._currentQIdx];
      this._answers[this._currentQIdx] = letter;
      document.querySelectorAll('.bl-quiz-option').forEach(function (opt) {
        var ans = opt.dataset.answer;
        opt.style.pointerEvents = 'none';
        if (ans === q.correct_answer) opt.classList.add('correct');
        else if (ans === letter) opt.classList.add('wrong');
      });
      var exp = document.getElementById('quiz-explanation');
      if (exp) exp.style.display = 'block';
      var nextBtn = document.getElementById('quiz-next-btn');
      if (nextBtn) nextBtn.style.display = 'inline-flex';
      if (letter !== q.correct_answer) this.saveMistake(q, letter);
    },

    nextQuestion: function () { this._currentQIdx++; this.renderQuestion(); },

    finishQuiz: async function () {
      var client = this.client(), user = this.user(), total = this._questions.length, correct = 0, self = this;
      this._questions.forEach(function (q, i) { if (self._answers[i] === q.correct_answer) correct++; });
      var score = Math.round((correct / total) * (this._currentQuiz.total_marks || 100));
      var timeTaken = Math.round((Date.now() - this._startTime) / 1000);
      if (client && user) {
        try {
          await client.from('quiz_attempts').insert({ user_id: user.id, quiz_id: this._currentQuiz.id, score: score, total_marks: this._currentQuiz.total_marks || 100, answers: this._answers, time_taken: timeTaken, completed_at: new Date().toISOString() });
          await this.updateLeaderboard(correct, total);
        } catch (e) { console.warn('Save attempt:', e); }
      }
      var container = document.getElementById('bl-quiz-player-area');
      if (!container) return;
      var pct = Math.round((correct / total) * 100);
      var emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚';
      container.innerHTML = '<div class="bl-quiz-player bl-fade-in" style="text-align:center">' +
        '<div style="font-size:3rem;margin-bottom:8px">' + emoji + '</div>' +
        '<div style="font-size:1.5rem;font-weight:800;margin-bottom:8px;color:var(--hp-ink,#1c1b1a)">' + score + '/' + (this._currentQuiz.total_marks || 100) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--hp-muted,#8a8178);margin-bottom:16px">' + correct + ' correct out of ' + total + ' (' + pct + '%)</div>' +
        '<div style="font-size:0.75rem;color:var(--hp-muted,#8a8178);margin-bottom:20px">Time: ' + Math.floor(timeTaken / 60) + 'm ' + (timeTaken % 60) + 's</div>' +
        '<button class="bl-card-cta" onclick="document.getElementById(\'bl-quiz-player-area\').innerHTML=\'\';BrainLab.scrollToSection(\'bl-sec-quizzes\')">Back to Quizzes</button>' +
      '</div>';
      this._currentQuiz = null; this._questions = []; this._currentQIdx = 0; this._answers = [];
      this.renderStats();
    },

    /* ── 03. Mock Tests ── */
    renderMockTests: async function () {
      var container = document.getElementById('bl-mocks');
      if (!container) return;
      var self = this;
      container.innerHTML = '<div class="bl-carousel"><div class="bl-skeleton" style="height:160px;width:240px"></div><div class="bl-skeleton" style="height:160px;width:240px"></div></div>';
      var client = this.client();
      var mocks = [];
      try {
        if (client) {
          var res = await client.from('mock_tests').select('*').eq('status', 'published').eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
          mocks = res.data || [];
        }
      } catch (_) {}
      var html;
      if (mocks.length) {
        html = '<div class="bl-carousel">' + mocks.map(function (m) {
          return self.cardHTML('📝', m.title, m.description || '', [
            m.exam_type ? { text: m.exam_type } : null,
            { text: (m.duration_mins || 180) + ' min' },
            { text: (m.total_marks || 100) + ' marks' }
          ].filter(Boolean), 'Start Test', "BrainLab.startMock('" + m.id + "')", false);
        }).join('') + '</div>';
      } else {
        html = '<div class="bl-carousel">' + SEED_MOCKS.map(function (m) {
          return self.cardHTML(m.icon, m.title, m.exam + ' · ' + m.questions + ' Questions', [
            { cls: m.difficulty, text: m.difficulty },
            { text: m.duration + ' min' },
            { text: m.marks + ' marks' }
          ], 'Start Test', "BrainLab.toast('Mock test requires published questions.')", true);
        }).join('') + '</div>';
      }
      container.innerHTML = html;
    },

    startMock: async function (mockId) {
      var client = this.client();
      if (!client) { this.toast('Unable to connect'); return; }
      try {
        var mockRes = await client.from('mock_tests').select('*').eq('id', mockId).single();
        var qRes = await client.from('mock_questions').select('*').eq('mock_id', mockId).eq('is_deleted', false);
        this._currentQuiz = mockRes.data;
        this._questions = qRes.data || [];
        this._currentQIdx = 0; this._answers = []; this._startTime = Date.now();
        if (!this._questions.length) { this.toast('No questions in this mock test yet.'); return; }
        this.renderQuestion();
      } catch (e) { this.toast('Error starting mock test'); }
    },

    /* ── 04. Flashcards ── */
    renderFlashcardDecks: async function () {
      var container = document.getElementById('bl-flashcard-decks');
      if (!container) return;
      var self = this;
      container.innerHTML = '<div class="bl-carousel"><div class="bl-skeleton" style="height:160px;width:240px"></div><div class="bl-skeleton" style="height:160px;width:240px"></div></div>';
      var client = this.client();
      var decks = [];
      try {
        if (client) {
          // Try to get decks from flashcard_decks table, or group flashcards by topic
          var res = await client.from('flashcards').select('*').eq('status', 'published').eq('is_deleted', false).limit(200);
          var cards = res.data || [];
          if (cards.length) {
            // Group by topic into decks
            var byTopic = {};
            cards.forEach(function (c) {
              var t = c.topic || 'General';
              if (!byTopic[t]) byTopic[t] = { title: t, topic: t, cards: 0, items: [] };
              byTopic[t].cards++;
              byTopic[t].items.push(c);
            });
            decks = Object.values(byTopic).slice(0, 20);
          }
        }
      } catch (_) {}
      var html;
      if (decks.length) {
        html = '<div class="bl-carousel">' + decks.map(function (d, i) {
          return self.cardHTML('🎴', d.title, d.topic + ' · ' + d.cards + ' Cards', [
            { text: d.cards + ' cards' }
          ], 'Review Cards', "BrainLab.startFlashcards(" + JSON.stringify(d.items.map(function(c){return {front:c.front,back:c.back,topic:c.topic,id:c.id};})).replace(/"/g,'&quot;') + ")", false);
        }).join('') + '</div>';
      } else {
        html = '<div class="bl-carousel">' + SEED_DECKS.map(function (d) {
          return self.cardHTML(d.icon, d.title, d.topic + ' · ' + d.cards + ' Cards', [
            { cls: d.difficulty, text: d.difficulty },
            { text: d.cards + ' cards' }
          ], 'Review Cards', "BrainLab.toast('Flashcard deck requires published cards.')", true);
        }).join('') + '</div>';
      }
      container.innerHTML = html;
    },

    startFlashcards: function (cards) {
      this._flashcards = cards;
      this._flashcardIdx = 0;
      this.renderFlashcard();
    },

    renderFlashcard: function () {
      var container = document.getElementById('bl-quiz-player-area');
      if (!container || !this._flashcards.length) return;
      var card = this._flashcards[this._flashcardIdx];
      var total = this._flashcards.length;
      var self = this;
      var html = '<div style="text-align:center;margin-bottom:12px;font-size:0.75rem;color:var(--hp-muted,#8a8178)">Card ' + (this._flashcardIdx + 1) + ' of ' + total + ' · ' + this.escape(card.topic || '') + '</div>';
      html += '<div class="bl-flashcard bl-fade-in" id="flashcard-el" onclick="BrainLab.flipFlashcard()"><div class="bl-flashcard-inner"><div class="bl-flashcard-front"><div class="bl-flashcard-label">Question</div><div class="bl-flashcard-text">' + this.escape(card.front) + '</div><div class="bl-flashcard-hint">Tap to flip</div></div><div class="bl-flashcard-back"><div class="bl-flashcard-label">Answer</div><div class="bl-flashcard-text">' + this.escape(card.back) + '</div><div class="bl-flashcard-hint">Tap to flip back</div></div></div></div>';
      html += '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">';
      if (this._flashcardIdx > 0) html += '<button class="bl-card-cta secondary" onclick="BrainLab.prevFlashcard()">← Prev</button>';
      html += '<button class="bl-card-cta" onclick="BrainLab.rateFlashcard(1)">Easy</button>';
      html += '<button class="bl-card-cta secondary" onclick="BrainLab.rateFlashcard(3)">Medium</button>';
      html += '<button class="bl-card-cta secondary" onclick="BrainLab.rateFlashcard(5)">Hard</button>';
      if (this._flashcardIdx < total - 1) html += '<button class="bl-card-cta" onclick="BrainLab.nextFlashcard()">Next →</button>';
      html += '</div>';
      container.innerHTML = html;
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    flipFlashcard: function () { var el = document.getElementById('flashcard-el'); if (el) el.classList.toggle('flipped'); },
    nextFlashcard: function () { if (this._flashcardIdx < this._flashcards.length - 1) { this._flashcardIdx++; this.renderFlashcard(); } },
    prevFlashcard: function () { if (this._flashcardIdx > 0) { this._flashcardIdx--; this.renderFlashcard(); } },

    rateFlashcard: async function (boxLevel) {
      var client = this.client(), user = this.user(), card = this._flashcards[this._flashcardIdx];
      if (!card) return;
      if (client && user && card.id) {
        try {
          var days = [1,2,4,7,15][boxLevel - 1] || 1;
          var nextReview = new Date(Date.now() + days * 86400000).toISOString();
          var existing = await client.from('flashcard_progress').select('*').eq('user_id', user.id).eq('flashcard_id', card.id).maybeSingle();
          if (existing.data) {
            await client.from('flashcard_progress').update({ box_level: boxLevel, next_review_at: nextReview, review_count: (existing.data.review_count || 0) + 1, last_reviewed: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', existing.data.id);
          } else {
            await client.from('flashcard_progress').insert({ user_id: user.id, flashcard_id: card.id, box_level: boxLevel, next_review_at: nextReview, review_count: 1, last_reviewed: new Date().toISOString() });
          }
        } catch (e) { console.warn('Flashcard progress:', e); }
      }
      if (this._flashcardIdx < this._flashcards.length - 1) { this.nextFlashcard(); }
      else { this.toast('All flashcards reviewed! 🎉'); document.getElementById('bl-quiz-player-area').innerHTML = ''; }
    },

    /* ── 05. Current Affairs ── */
    renderCurrentAffairs: async function () {
      var container = document.getElementById('bl-affairs');
      if (!container) return;
      var self = this;
      container.innerHTML = '<div class="bl-skeleton" style="height:60px;margin-bottom:8px"></div><div class="bl-skeleton" style="height:60px"></div>';
      var client = this.client();
      var news = [];
      try {
        if (client) {
          var res = await client.from('current_affairs').select('*').eq('status', 'published').eq('is_deleted', false).order('published_date', { ascending: false }).limit(20);
          news = res.data || [];
        }
      } catch (_) {}
      var html;
      if (news.length) {
        html = news.map(function (n) {
          return '<div class="bl-news-item bl-fade-in"><div class="bl-news-date">' + new Date(n.published_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div><div class="bl-news-title">' + self.escape(n.title) + '</div><div class="bl-news-preview">' + self.escape((n.content || '').slice(0, 150)) + '...</div><span class="bl-news-category">' + self.escape(n.category || 'general') + '</span></div>';
        }).join('');
      } else {
        // Show category cards as demo
        html = '<div class="bl-card-grid">' + SEED_AFFAIRS_CATS.map(function (c) {
          return '<div class="bl-card bl-fade-in" onclick="BrainLab.toast(\'Current affairs content requires published data.\')"><span class="bl-demo-badge">DEMO</span><div class="bl-card-icon">' + c.icon + '</div><div class="bl-card-title">' + c.title + '</div><div class="bl-card-subtitle">Tap to browse</div><button class="bl-card-cta secondary" onclick="event.stopPropagation();BrainLab.toast(\'Content coming soon\')">Browse</button></div>';
        }).join('') + '</div>';
      }
      container.innerHTML = html;
    },

    /* ── 06. PYQ Practice ── */
    renderPYQ: function () {
      var container = document.getElementById('bl-pyq');
      if (!container) return;
      var self = this;
      var html = '<div class="bl-carousel">' + SEED_PYQS.map(function (p) {
        return self.cardHTML(p.icon, p.title, p.exam + ' · Previous Year Questions', [
          { text: p.questions + ' Questions' },
          { cls: 'gold', text: 'PYQ' }
        ], 'Practice Now', "BrainLab.toast('PYQ practice requires published questions.')", true);
      }).join('') + '</div>';
      container.innerHTML = html;
    },

    /* ── 07. Mistake Review ── */
    renderMistakes: async function () {
      var container = document.getElementById('bl-mistakes');
      if (!container) return;
      var self = this;
      var user = this.user();
      var client = this.client();
      if (!client || !user) {
        container.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🎯</div><div class="bl-empty-text">No mistakes to review. Complete a quiz or mock test and your incorrect answers will appear here.</div></div>';
        return;
      }
      container.innerHTML = '<div class="bl-skeleton" style="height:80px"></div>';
      try {
        var res = await client.from('mistake_book').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
        var mistakes = res.data || [];
        if (!mistakes.length) {
          container.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🎯</div><div class="bl-empty-text">No mistakes to review. Complete a quiz or mock test and your incorrect answers will appear here.</div></div>';
          return;
        }
        container.innerHTML = mistakes.map(function (m) {
          return '<div class="bl-mistake-item bl-fade-in"><div class="bl-mistake-q">' + self.escape(m.question_text) + '</div><div class="bl-mistake-answers"><span class="bl-mistake-wrong">Your answer: ' + self.escape(m.user_answer || '—') + '</span><span class="bl-mistake-right">Correct: ' + self.escape(m.correct_answer || '—') + '</span></div>' + (m.explanation ? '<div class="bl-mistake-explain">' + self.escape(m.explanation) + '</div>' : '') + (m.topic ? '<span class="bl-card-tag" style="margin-top:6px;display:inline-block">' + self.escape(m.topic) + '</span>' : '') + '</div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading mistakes. Please retry.</div><button class="bl-empty-action" onclick="BrainLab.renderMistakes()">Retry</button></div>';
      }
    },

    saveMistake: async function (question, userAnswer) {
      var client = this.client(), user = this.user();
      if (!client || !user) return;
      try {
        await client.from('mistake_book').insert({ user_id: user.id, question_text: question.question_text, user_answer: userAnswer, correct_answer: question.correct_answer, explanation: question.explanation, source: 'quiz', topic: question.topic });
      } catch (e) { console.warn('Save mistake:', e); }
    },

    /* ── 08. Performance ── */
    renderPerformance: async function () {
      var container = document.getElementById('bl-performance');
      if (!container) return;
      var self = this;
      var user = this.user();
      var client = this.client();
      if (!client || !user) {
        container.innerHTML = '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">📊</div><div class="bl-empty-text">Start your first quiz to unlock your performance insights.</div><button class="bl-empty-action" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">Browse Quizzes</button></div>';
        return;
      }
      container.innerHTML = '<div class="bl-skeleton" style="height:100px"></div>';
      try {
        var res = await client.from('quiz_attempts').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
        var aData = res.data || [];
        var totalAttempts = aData.length;
        var totalScore = 0;
        aData.forEach(function (a) { var pct = a.total_marks ? (a.score / a.total_marks) * 100 : 0; totalScore += pct; });
        var avgPct = totalAttempts > 0 ? Math.round(totalScore / totalAttempts) : 0;
        var html = '<div class="bl-perf-stats">' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + totalAttempts + '</div><div class="bl-perf-label">Tests</div></div>' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + avgPct + '%</div><div class="bl-perf-label">Avg Score</div></div>' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + self.dayStreak() + '</div><div class="bl-perf-label">Streak</div></div>' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + (totalAttempts > 0 ? '+' + Math.min(avgPct, 15) + '%' : '—') + '</div><div class="bl-perf-label">Improvement</div></div>' +
        '</div>';
        if (aData.length > 0) {
          html += '<h3 class="bl-section-title" style="font-size:0.85rem;margin-bottom:10px">Recent Scores</h3>';
          html += '<div class="bl-perf-bars">';
          var recent = aData.slice(0, 10).reverse();
          var maxScore = Math.max.apply(null, recent.map(function (a) { return a.total_marks ? (a.score / a.total_marks) * 100 : 0; }).concat([1]));
          recent.forEach(function (a, i) {
            var pct = a.total_marks ? (a.score / a.total_marks) * 100 : 0;
            var h = Math.max(2, (pct / maxScore) * 100);
            html += '<div class="bl-perf-bar"><div style="font-size:0.55rem;color:var(--hp-muted,#8a8178)">' + Math.round(pct) + '%</div><div class="bl-perf-bar-fill" style="height:' + h + '%"></div><div class="bl-perf-bar-label">T' + (i + 1) + '</div></div>';
          });
          html += '</div>';
        }
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading performance. Please retry.</div><button class="bl-empty-action" onclick="BrainLab.renderPerformance()">Retry</button></div>';
      }
    },

    /* ── 09. Leaderboard ── */
    renderLeaderboard: async function () {
      var container = document.getElementById('bl-leaderboard');
      if (!container) return;
      var self = this;
      container.innerHTML = '<div class="bl-leader-filters"><div class="bl-leader-filter active">All-Time</div><div class="bl-leader-filter">Weekly</div><div class="bl-leader-filter">Monthly</div></div><div class="bl-skeleton" style="height:50px;margin-bottom:6px"></div><div class="bl-skeleton" style="height:50px"></div>';
      var client = this.client();
      var entries = [];
      try {
        if (client) {
          var res = await client.from('leaderboards').select('user_id,total_points,quizzes_taken,avg_score,period').eq('period', 'all-time').order('total_points', { ascending: false }).limit(50);
          entries = res.data || [];
        }
      } catch (_) {}
      var html = '<div class="bl-leader-filters"><div class="bl-leader-filter active" onclick="BrainLab._leaderFilter=\'all-time\';BrainLab.renderLeaderboard()">All-Time</div><div class="bl-leader-filter" onclick="BrainLab._leaderFilter=\'weekly\';BrainLab.renderLeaderboard()">Weekly</div><div class="bl-leader-filter" onclick="BrainLab._leaderFilter=\'monthly\';BrainLab.renderLeaderboard()">Monthly</div></div>';
      if (entries.length) {
        html += '<div class="bl-leaderboard">' + entries.map(function (e, i) {
          var rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
          return '<div class="bl-leader-row bl-fade-in"><div class="bl-leader-rank ' + rankClass + '">' + (i + 1) + '</div><div class="bl-leader-name">User ' + (e.user_id || '').slice(0, 8) + '</div><div class="bl-leader-meta">' + (e.quizzes_taken || 0) + ' tests</div><div class="bl-leader-points">' + (e.total_points || 0) + ' pts</div></div>';
        }).join('') + '</div>';
      } else {
        html += '<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🏆</div><div class="bl-empty-text">No leaderboard data yet. Take quizzes to compete and climb the ranks!</div><button class="bl-empty-action" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">Start a Quiz</button></div>';
      }
      container.innerHTML = html;
    },

    updateLeaderboard: async function (correct, total) {
      var client = this.client(), user = this.user();
      if (!client || !user) return;
      try {
        var existing = await client.from('leaderboards').select('*').eq('user_id', user.id).eq('period', 'all-time').maybeSingle();
        var points = correct * 10;
        if (existing.data) {
          var newTotal = (existing.data.total_points || 0) + points;
          var newCount = (existing.data.quizzes_taken || 0) + 1;
          var newAvg = ((existing.data.avg_score || 0) * (newCount - 1) + (correct / total) * 100) / newCount;
          await client.from('leaderboards').update({ total_points: newTotal, quizzes_taken: newCount, avg_score: newAvg, updated_at: new Date().toISOString() }).eq('id', existing.data.id);
        } else {
          await client.from('leaderboards').insert({ user_id: user.id, total_points: points, quizzes_taken: 1, avg_score: (correct / total) * 100, period: 'all-time' });
        }
      } catch (e) { console.warn('Leaderboard update:', e); }
    },

    /* ── 10. Study Streak ── */
    renderStudyStreak: function () {
      var container = document.getElementById('bl-streak');
      if (!container) return;
      var user = this.user();
      var streak = this.dayStreak();
      var longest = 0;
      try { longest = parseInt(localStorage.getItem('bl_longest_streak') || '0'); } catch (_) {}
      if (streak > longest) { longest = streak; try { localStorage.setItem('bl_longest_streak', String(longest)); } catch (_) {} }

      // Build week view
      var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      var today = new Date().getDay(); // 0=Sun
      var activeDays = [];
      try { activeDays = JSON.parse(localStorage.getItem('campus_study_days') || '[]'); } catch (_) {}
      var html = '<div class="bl-streak bl-fade-in">';
      html += '<div class="bl-streak-fire">' + (streak > 0 ? '🔥' : '📅') + '</div>';
      html += '<div class="bl-streak-count">' + streak + '</div>';
      html += '<div class="bl-streak-label">Day Streak</div>';
      html += '<div class="bl-streak-week">';
      for (var i = 0; i < 7; i++) {
        var d = new Date();
        var offset = i - (today === 0 ? 6 : today - 1); // Start from Monday
        d.setDate(d.getDate() + offset);
        var dStr = d.toISOString().slice(0, 10);
        var isDone = activeDays.indexOf(dStr) !== -1;
        var isToday = offset === 0;
        html += '<div class="bl-streak-day"><div class="bl-streak-day-label">' + days[i] + '</div><div class="bl-streak-day-mark ' + (isDone ? 'done' : '') + (isToday ? ' today' : '') + '">' + (isDone ? '✓' : '') + '</div></div>';
      }
      html += '</div>';
      html += '<div class="bl-streak-meta"><div>Current: <strong>' + streak + ' days</strong></div><div>Longest: <strong>' + longest + ' days</strong></div></div>';
      if (!user) {
        html += '<div style="margin-top:12px;font-size:0.72rem;color:var(--hp-muted,#8a8178)">Sign in to sync your streak across devices</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    },

    /* ── 11. Practice Arena ── */
    renderPracticeArena: function () {
      var container = document.getElementById('bl-arena');
      if (!container) return;
      var self = this;
      var html = '<div class="bl-arena">' + SEED_ARENA.map(function (a) {
        return '<div class="bl-arena-card bl-fade-in" onclick="BrainLab.startPractice(\'' + a.mode + '\')"><div class="bl-arena-icon">' + a.icon + '</div><div class="bl-arena-title">' + a.title + '</div><div class="bl-arena-sub">' + a.sub + '</div></div>';
      }).join('') + '</div>';
      container.innerHTML = html;
    },

    startPractice: function (mode) {
      this.toast('Practice arena requires published questions. Admins can add content via BrainLab Manager.');
    },

    /* ── 12. Study Tools ── */
    renderStudyTools: function () {
      var container = document.getElementById('bl-tools');
      if (!container) return;
      var self = this;
      var html = '<div class="bl-tools">' + SEED_TOOLS.map(function (t) {
        return '<div class="bl-tool-card bl-fade-in" onclick="BrainLab.openTool(\'' + t.action + '\')"><div class="bl-tool-icon">' + t.icon + '</div><div class="bl-tool-name">' + t.name + '</div><div class="bl-tool-desc">' + t.desc + '</div></div>';
      }).join('') + '</div>';
      container.innerHTML = html;
    },

    openTool: function (action) {
      // Route to existing Studyria tools where possible
      switch (action) {
        case 'planner':
          if (typeof StudyPlanner !== 'undefined') { navigate('study-planner'); return; }
          break;
        case 'timer':
        case 'focus':
          this.toast('Timer tool coming soon!');
          return;
        case 'bookmarks':
          navigate('wishlist');
          return;
        default:
          this.toast('Tool coming soon!');
      }
    },

    /* ── Search / Filter ── */
    onSearch: function (query) {
      this._searchQuery = query.toLowerCase();
      this.renderQuizzes();
      this.renderMockTests();
      this.renderFlashcardDecks();
      this.renderPYQ();
    },

    /* ── Day Streak Helper ── */
    dayStreak: function () {
      try {
        var data = JSON.parse(localStorage.getItem('campus_study_days') || '[]');
        if (!data.length) return 0;
        var today = new Date().toISOString().slice(0, 10);
        var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (data.indexOf(today) === -1 && data.indexOf(yesterday) === -1) return 0;
        var streak = 0; var d = new Date();
        while (data.indexOf(d.toISOString().slice(0, 10)) !== -1) { streak++; d.setDate(d.getDate() - 1); }
        return streak;
      } catch (_) { return 0; }
    }
  };
})();
