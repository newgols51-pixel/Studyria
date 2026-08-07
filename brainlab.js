/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA BRAINLAB — Module Logic (brainlab.js)
   Pure additive. Uses existing Supabase client (window.supabase).
   No existing functions modified.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.BrainLab = {
    currentTab: 'quiz',
    initialized: false,
    _currentQuiz: null,
    _currentQIdx: 0,
    _answers: [],
    _startTime: null,
    _flashcardIdx: 0,
    _flashcards: [],

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
      document.querySelectorAll('.bl-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      document.querySelectorAll('.bl-tab-content').forEach(function (c) {
        c.style.display = c.dataset.tab === tab ? 'block' : 'none';
      });

      switch (tab) {
        case 'quiz':          this.renderQuizList(); break;
        case 'flashcards':     this.renderFlashcards(); break;
        case 'mock':          this.renderMockTests(); break;
        case 'mistakes':      this.renderMistakes(); break;
        case 'affairs':       this.renderCurrentAffairs(); break;
        case 'leaderboard':   this.renderLeaderboard(); break;
        case 'performance':   this.renderPerformance(); break;
      }
    },

    /* ── Quiz List ── */
    renderQuizList: async function () {
      var container = document.getElementById('bl-quiz');
      if (!container) return;
      var self = this;

      container.innerHTML = '<div class="bl-card-grid"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div></div>';

      var client = this.client();

      try {
        var quizzes = [];
        if (client) {
          var res = await client.from('brainlab_quizzes').select('*').eq('status', 'published').eq('is_deleted', false).order('created_at', { ascending: false });
          quizzes = res.data || [];
        }

        if (!quizzes.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">🧠</div><div class="bl-empty-text">No quizzes published yet. Check back soon!</div></div>';
          return;
        }

        container.innerHTML = '<div class="bl-card-grid">' + quizzes.map(function (q) {
          return '<div class="bl-card bl-fade-in" onclick="BrainLab.startQuiz(\'' + q.id + '\')">' +
            '<div class="bl-card-title">' + self.escape(q.title) + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-secondary,#94a3b8)">' + self.escape(q.description || '') + '</div>' +
            '<div class="bl-card-meta">' +
              '<span class="bl-card-tag ' + (q.difficulty || 'medium') + '">' + (q.difficulty || 'medium') + '</span>' +
              '<span class="bl-card-tag">' + (q.duration_mins || 30) + ' min</span>' +
              '<span class="bl-card-tag">' + (q.total_marks || 100) + ' marks</span>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">⚠️</div><div class="bl-empty-text">Error loading quizzes.</div></div>';
      }
    },

    /* ── Quiz Player ── */
    startQuiz: async function (quizId) {
      var client = this.client();
      var user = this.user();
      if (!client) return;

      try {
        var quizRes = await client.from('brainlab_quizzes').select('*').eq('id', quizId).single();
        var qRes = await client.from('quiz_questions').select('*').eq('quiz_id', quizId).eq('is_deleted', false);

        this._currentQuiz = quizRes.data;
        this._questions = qRes.data || [];
        this._currentQIdx = 0;
        this._answers = [];
        this._startTime = Date.now();

        if (!this._questions.length) {
          this.toast('No questions in this quiz yet.');
          return;
        }

        this.renderQuestion();
      } catch (e) {
        this.toast('Error starting quiz');
        console.warn(e);
      }
    },

    renderQuestion: function () {
      var container = document.getElementById('bl-quiz');
      if (!container || !this._questions.length) return;
      var self = this;
      var q = this._questions[this._currentQIdx];
      var total = this._questions.length;
      var progress = ((this._currentQIdx) / total) * 100;

      var html = '<div class="bl-quiz-player">' +
        '<div class="bl-quiz-progress">' +
          '<div class="bl-quiz-progress-bar"><div class="bl-quiz-progress-fill" style="width:' + progress + '%"></div></div>' +
          '<div class="bl-quiz-counter">Q ' + (this._currentQIdx + 1) + '/' + total + '</div>' +
        '</div>' +
        '<div class="bl-quiz-q">' + this.escape(q.question_text) + '</div>' +
        '<div class="bl-quiz-options">';

      var opts = [
        { letter: 'a', text: q.option_a },
        { letter: 'b', text: q.option_b },
        { letter: 'c', text: q.option_c },
        { letter: 'd', text: q.option_d }
      ].filter(function (o) { return o.text; });

      opts.forEach(function (o) {
        html += '<div class="bl-quiz-option" data-answer="' + o.letter + '" onclick="BrainLab.selectAnswer(\'' + o.letter + '\')">' +
          '<div class="bl-quiz-option-letter">' + o.letter.toUpperCase() + '</div>' +
          '<div>' + self.escape(o.text) + '</div>' +
        '</div>';
      });

      html += '</div>';

      // Explanation (hidden until answered)
      html += '<div id="quiz-explanation" style="display:none;margin-top:12px;padding:12px;border-radius:10px;background:rgba(61,142,248,0.06);font-size:0.78rem;line-height:1.5">' +
        (q.explanation || 'No explanation available.') +
      '</div>';

      html += '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">';
      if (this._currentQIdx < total - 1) {
        html += '<button class="focus-btn focus-btn-primary" id="quiz-next-btn" onclick="BrainLab.nextQuestion()" style="display:none">Next →</button>';
      } else {
        html += '<button class="focus-btn focus-btn-primary" id="quiz-next-btn" onclick="BrainLab.finishQuiz()" style="display:none">Finish</button>';
      }
      html += '</div></div>';

      container.innerHTML = html;
    },

    selectAnswer: function (letter) {
      if (this._answers[this._currentQIdx]) return; // Already answered

      var q = this._questions[this._currentQIdx];
      this._answers[this._currentQIdx] = letter;

      var options = document.querySelectorAll('.bl-quiz-option');
      options.forEach(function (opt) {
        var ans = opt.dataset.answer;
        opt.style.pointerEvents = 'none';
        if (ans === q.correct_answer) {
          opt.classList.add('correct');
        } else if (ans === letter) {
          opt.classList.add('wrong');
        }
      });

      // Show explanation
      var exp = document.getElementById('quiz-explanation');
      if (exp) exp.style.display = 'block';
      var nextBtn = document.getElementById('quiz-next-btn');
      if (nextBtn) nextBtn.style.display = 'inline-flex';

      // Save to mistake book if wrong
      if (letter !== q.correct_answer) {
        this.saveMistake(q, letter);
      }
    },

    nextQuestion: function () {
      this._currentQIdx++;
      this.renderQuestion();
    },

    finishQuiz: async function () {
      var client = this.client();
      var user = this.user();
      var total = this._questions.length;
      var correct = 0;
      var self = this;

      this._questions.forEach(function (q, i) {
        if (self._answers[i] === q.correct_answer) correct++;
      });

      var score = Math.round((correct / total) * (this._currentQuiz.total_marks || 100));
      var timeTaken = Math.round((Date.now() - this._startTime) / 1000);

      // Save attempt
      if (client && user) {
        try {
          await client.from('quiz_attempts').insert({
            user_id: user.id,
            quiz_id: this._currentQuiz.id,
            score: score,
            total_marks: this._currentQuiz.total_marks || 100,
            answers: this._answers,
            time_taken: timeTaken,
            completed_at: new Date().toISOString()
          });

          // Update leaderboard
          await this.updateLeaderboard(correct, total);
        } catch (e) { console.warn('Save quiz attempt:', e); }
      }

      // Show results
      var container = document.getElementById('bl-quiz');
      if (!container) return;
      var pct = Math.round((correct / total) * 100);
      var emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚';

      container.innerHTML = '<div class="bl-quiz-player" style="text-align:center">' +
        '<div style="font-size:3rem;margin-bottom:8px">' + emoji + '</div>' +
        '<div style="font-size:1.5rem;font-weight:800;margin-bottom:8px">' + score + '/' + (this._currentQuiz.total_marks || 100) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--text-secondary,#94a3b8);margin-bottom:16px">' + correct + ' correct out of ' + total + ' (' + pct + '%)</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary,#94a3b8);margin-bottom:20px">Time: ' + Math.floor(timeTaken / 60) + 'm ' + (timeTaken % 60) + 's</div>' +
        '<button class="focus-btn focus-btn-primary" onclick="BrainLab.switchTab(\'quiz\')">Back to Quizzes</button>' +
      '</div>';

      this._currentQuiz = null;
      this._questions = [];
      this._currentQIdx = 0;
      this._answers = [];
    },

    /* ── Flashcards ── */
    renderFlashcards: async function () {
      var container = document.getElementById('bl-flashcards');
      if (!container) return;
      var self = this;

      container.innerHTML = '<div class="skeleton" style="height:260px;max-width:500px;margin:0 auto"></div>';

      var client = this.client();

      try {
        var cards = [];
        if (client) {
          var res = await client.from('flashcards').select('*').eq('status', 'published').eq('is_deleted', false).limit(50);
          cards = res.data || [];
        }

        this._flashcards = cards;
        this._flashcardIdx = 0;

        if (!cards.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">🎴</div><div class="bl-empty-text">No flashcards published yet.</div></div>';
          return;
        }

        this.renderFlashcard();
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">⚠️</div><div class="bl-empty-text">Error loading flashcards.</div></div>';
      }
    },

    renderFlashcard: function () {
      var container = document.getElementById('bl-flashcards');
      if (!container || !this._flashcards.length) return;
      var card = this._flashcards[this._flashcardIdx];
      var total = this._flashcards.length;

      var html = '<div style="text-align:center;margin-bottom:12px">' +
        '<span style="font-size:0.75rem;color:var(--text-secondary,#94a3b8)">Card ' + (this._flashcardIdx + 1) + ' of ' + total + ' · ' + this.escape(card.topic) + '</span>' +
      '</div>';

      html += '<div class="bl-flashcard bl-fade-in" id="flashcard-el" onclick="BrainLab.flipFlashcard()">' +
        '<div class="bl-flashcard-inner">' +
          '<div class="bl-flashcard-front">' +
            '<div class="bl-flashcard-label">Question</div>' +
            '<div class="bl-flashcard-text">' + this.escape(card.front) + '</div>' +
            '<div class="bl-flashcard-hint">Tap to flip</div>' +
          '</div>' +
          '<div class="bl-flashcard-back">' +
            '<div class="bl-flashcard-label">Answer</div>' +
            '<div class="bl-flashcard-text">' + this.escape(card.back) + '</div>' +
            '<div class="bl-flashcard-hint">Tap to flip back</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      html += '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">' +
        (this._flashcardIdx > 0 ? '<button class="focus-btn focus-btn-secondary" onclick="BrainLab.prevFlashcard()">← Prev</button>' : '') +
        '<button class="focus-btn focus-btn-primary" onclick="BrainLab.rateFlashcard(1)">Easy</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLab.rateFlashcard(3)">Medium</button>' +
        '<button class="focus-btn focus-btn-secondary" onclick="BrainLab.rateFlashcard(5)">Hard</button>' +
        (this._flashcardIdx < total - 1 ? '<button class="focus-btn focus-btn-primary" onclick="BrainLab.nextFlashcard()">Next →</button>' : '') +
      '</div>';

      container.innerHTML = html;
    },

    flipFlashcard: function () {
      var el = document.getElementById('flashcard-el');
      if (el) el.classList.toggle('flipped');
    },

    nextFlashcard: function () {
      if (this._flashcardIdx < this._flashcards.length - 1) {
        this._flashcardIdx++;
        this.renderFlashcard();
      }
    },

    prevFlashcard: function () {
      if (this._flashcardIdx > 0) {
        this._flashcardIdx--;
        this.renderFlashcard();
      }
    },

    rateFlashcard: async function (boxLevel) {
      var client = this.client();
      var user = this.user();
      var card = this._flashcards[this._flashcardIdx];
      if (!card) return;

      if (client && user) {
        try {
          // Spaced repetition: calculate next review
          var days = [1, 2, 4, 7, 15][boxLevel - 1] || 1;
          var nextReview = new Date(Date.now() + days * 86400000).toISOString();

          // Upsert progress
          var existing = await client.from('flashcard_progress').select('*').eq('user_id', user.id).eq('flashcard_id', card.id).maybeSingle();
          if (existing.data) {
            await client.from('flashcard_progress').update({
              box_level: boxLevel,
              next_review_at: nextReview,
              review_count: (existing.data.review_count || 0) + 1,
              last_reviewed: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq('id', existing.data.id);
          } else {
            await client.from('flashcard_progress').insert({
              user_id: user.id,
              flashcard_id: card.id,
              box_level: boxLevel,
              next_review_at: nextReview,
              review_count: 1,
              last_reviewed: new Date().toISOString()
            });
          }
        } catch (e) { console.warn('Flashcard progress:', e); }
      }

      if (this._flashcardIdx < this._flashcards.length - 1) {
        this.nextFlashcard();
      } else {
        this.toast('All flashcards reviewed! 🎉');
        this.renderFlashcards();
      }
    },

    /* ── Mock Tests ── */
    renderMockTests: async function () {
      var container = document.getElementById('bl-mock');
      if (!container) return;
      var self = this;

      container.innerHTML = '<div class="bl-card-grid"><div class="skeleton" style="height:120px"></div></div>';

      var client = this.client();

      try {
        var mocks = [];
        if (client) {
          var res = await client.from('mock_tests').select('*').eq('status', 'published').eq('is_deleted', false).order('created_at', { ascending: false });
          mocks = res.data || [];
        }

        if (!mocks.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">📝</div><div class="bl-empty-text">No mock tests published yet.</div></div>';
          return;
        }

        container.innerHTML = '<div class="bl-card-grid">' + mocks.map(function (m) {
          return '<div class="bl-card bl-fade-in" onclick="BrainLab.startMock(\'' + m.id + '\')">' +
            '<div class="bl-card-title">' + self.escape(m.title) + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-secondary,#94a3b8)">' + self.escape(m.description || '') + '</div>' +
            '<div class="bl-card-meta">' +
              (m.exam_type ? '<span class="bl-card-tag">' + self.escape(m.exam_type) + '</span>' : '') +
              '<span class="bl-card-tag">' + (m.duration_mins || 180) + ' min</span>' +
              '<span class="bl-card-tag">' + (m.total_marks || 100) + ' marks</span>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading mock tests.</div></div>';
      }
    },

    startMock: async function (mockId) {
      // Reuse quiz player logic with mock questions
      var client = this.client();
      if (!client) return;

      try {
        var mockRes = await client.from('mock_tests').select('*').eq('id', mockId).single();
        var qRes = await client.from('mock_questions').select('*').eq('mock_id', mockId).eq('is_deleted', false);

        this._currentQuiz = mockRes.data;
        this._questions = qRes.data || [];
        this._currentQIdx = 0;
        this._answers = [];
        this._startTime = Date.now();
        this._isMock = true;

        if (!this._questions.length) {
          this.toast('No questions in this mock test yet.');
          return;
        }
        this.renderQuestion();
      } catch (e) {
        this.toast('Error starting mock test');
      }
    },

    /* ── Mistake Notebook ── */
    renderMistakes: async function () {
      var container = document.getElementById('bl-mistakes');
      if (!container) return;
      var self = this;

      var client = this.client();
      var user = this.user();

      if (!client || !user) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">📓</div><div class="bl-empty-text">Sign in to track mistakes.</div></div>';
        return;
      }

      container.innerHTML = '<div class="skeleton" style="height:80px"></div>';

      try {
        var res = await client.from('mistake_book').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
        var mistakes = res.data || [];
        if (!mistakes.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">📓</div><div class="bl-empty-text">No mistakes recorded yet. Take a quiz to build your mistake notebook.</div></div>';
          return;
        }
        container.innerHTML = mistakes.map(function (m) {
          return '<div class="bl-mistake-item bl-fade-in">' +
            '<div class="bl-mistake-q">' + self.escape(m.question_text) + '</div>' +
            '<div class="bl-mistake-answers">' +
              '<span class="bl-mistake-wrong">Your answer: ' + self.escape(m.user_answer || '—') + '</span>' +
              '<span class="bl-mistake-right">Correct: ' + self.escape(m.correct_answer || '—') + '</span>' +
            '</div>' +
            (m.explanation ? '<div class="bl-mistake-explain">' + self.escape(m.explanation) + '</div>' : '') +
            (m.topic ? '<span class="bl-card-tag" style="margin-top:6px;display:inline-block">' + self.escape(m.topic) + '</span>' : '') +
          '</div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading mistakes.</div></div>';
      }
    },

    saveMistake: async function (question, userAnswer) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) return;
      try {
        await client.from('mistake_book').insert({
          user_id: user.id,
          question_text: question.question_text,
          user_answer: userAnswer,
          correct_answer: question.correct_answer,
          explanation: question.explanation,
          source: 'quiz',
          topic: question.topic
        });
      } catch (e) { console.warn('Save mistake:', e); }
    },

    /* ── Current Affairs ── */
    renderCurrentAffairs: async function () {
      var container = document.getElementById('bl-affairs');
      if (!container) return;
      var self = this;

      container.innerHTML = '<div class="skeleton" style="height:80px;margin-bottom:8px"></div><div class="skeleton" style="height:80px"></div>';

      var client = this.client();

      try {
        var news = [];
        if (client) {
          var res = await client.from('current_affairs').select('*').eq('status', 'published').eq('is_deleted', false).order('published_date', { ascending: false }).limit(30);
          news = res.data || [];
        }

        if (!news.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">📰</div><div class="bl-empty-text">No current affairs published yet.</div></div>';
          return;
        }

        container.innerHTML = news.map(function (n) {
          return '<div class="bl-news-item bl-fade-in">' +
            '<div class="bl-news-date">' + new Date(n.published_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div>' +
            '<div class="bl-news-title">' + self.escape(n.title) + '</div>' +
            '<div class="bl-news-preview">' + self.escape((n.content || '').slice(0, 150)) + '...</div>' +
            '<span class="bl-news-category">' + self.escape(n.category || 'general') + '</span>' +
          '</div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading current affairs.</div></div>';
      }
    },

    /* ── Leaderboard ── */
    renderLeaderboard: async function () {
      var container = document.getElementById('bl-leaderboard');
      if (!container) return;
      var self = this;

      container.innerHTML = '<div class="bl-leaderboard"><div class="skeleton" style="height:50px;margin-bottom:6px"></div><div class="skeleton" style="height:50px"></div></div>';

      var client = this.client();

      try {
        var entries = [];
        if (client) {
          var res = await client.from('leaderboards').select('user_id,total_points,quizzes_taken,avg_score,period').eq('period', 'all-time').order('total_points', { ascending: false }).limit(50);
          entries = res.data || [];
        }

        if (!entries.length) {
          container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">🏆</div><div class="bl-empty-text">No leaderboard data yet. Take quizzes to compete!</div></div>';
          return;
        }

        container.innerHTML = '<div class="bl-leaderboard">' + entries.map(function (e, i) {
          var rankClass = '';
          if (i === 0) rankClass = 'gold';
          else if (i === 1) rankClass = 'silver';
          else if (i === 2) rankClass = 'bronze';
          return '<div class="bl-leader-row bl-fade-in">' +
            '<div class="bl-leader-rank ' + rankClass + '">' + (i + 1) + '</div>' +
            '<div class="bl-leader-name">User ' + (e.user_id || '').slice(0, 8) + '</div>' +
            '<div class="bl-leader-points">' + (e.total_points || 0) + ' pts</div>' +
          '</div>';
        }).join('') + '</div>';
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading leaderboard.</div></div>';
      }
    },

    updateLeaderboard: async function (correct, total) {
      var client = this.client();
      var user = this.user();
      if (!client || !user) return;
      try {
        var existing = await client.from('leaderboards').select('*').eq('user_id', user.id).eq('period', 'all-time').maybeSingle();
        var points = correct * 10;
        if (existing.data) {
          var newTotal = (existing.data.total_points || 0) + points;
          var newCount = (existing.data.quizzes_taken || 0) + 1;
          var newAvg = ((existing.data.avg_score || 0) * (newCount - 1) + (correct / total) * 100) / newCount;
          await client.from('leaderboards').update({
            total_points: newTotal,
            quizzes_taken: newCount,
            avg_score: newAvg,
            updated_at: new Date().toISOString()
          }).eq('id', existing.data.id);
        } else {
          await client.from('leaderboards').insert({
            user_id: user.id,
            total_points: points,
            quizzes_taken: 1,
            avg_score: (correct / total) * 100,
            period: 'all-time'
          });
        }
      } catch (e) { console.warn('Leaderboard update:', e); }
    },

    /* ── Performance ── */
    renderPerformance: async function () {
      var container = document.getElementById('bl-performance');
      if (!container) return;
      var self = this;

      var client = this.client();
      var user = this.user();

      if (!client || !user) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-icon">📊</div><div class="bl-empty-text">Sign in to view performance.</div></div>';
        return;
      }

      container.innerHTML = '<div class="skeleton" style="height:100px"></div>';

      try {
        var attempts = await client.from('quiz_attempts').select('*').eq('user_id', user.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
        var aData = attempts.data || [];

        var totalAttempts = aData.length;
        var totalScore = 0;
        var avgPct = 0;
        var topicStats = {};

        aData.forEach(function (a) {
          var pct = a.total_marks ? (a.score / a.total_marks) * 100 : 0;
          totalScore += pct;
        });
        avgPct = totalAttempts > 0 ? Math.round(totalScore / totalAttempts) : 0;

        var html = '<div class="bl-perf-stats">' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + totalAttempts + '</div><div class="bl-perf-label">Quizzes Taken</div></div>' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + avgPct + '%</div><div class="bl-perf-label">Avg Score</div></div>' +
          '<div class="bl-perf-stat bl-fade-in"><div class="bl-perf-num">' + self.dayStreak() + '</div><div class="bl-perf-label">Day Streak</div></div>' +
        '</div>';

        // Recent quiz scores
        html += '<h3 class="bl-section-title">Recent Quiz Scores</h3>';
        if (aData.length === 0) {
          html += '<div class="bl-empty"><div class="bl-empty-text">No quizzes taken yet.</div></div>';
        } else {
          html += '<div style="display:flex;align-items:flex-end;gap:6px;height:100px;padding:12px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);margin-bottom:20px">';
          var recent = aData.slice(0, 10).reverse();
          var maxScore = Math.max.apply(null, recent.map(function (a) { return a.total_marks ? (a.score / a.total_marks) * 100 : 0; }).concat([1]));
          recent.forEach(function (a) {
            var pct = a.total_marks ? (a.score / a.total_marks) * 100 : 0;
            var h = Math.max(2, (pct / maxScore) * 100);
            html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">' +
              '<div style="font-size:0.55rem;color:var(--text-secondary,#94a3b8)">' + Math.round(pct) + '%</div>' +
              '<div style="width:100%;height:' + h + '%;border-radius:6px 6px 0 0;background:' + (pct >= 60 ? 'linear-gradient(180deg,#22c55e,#16a34a)' : 'linear-gradient(180deg,#ef4444,#f97316)') + '"></div>' +
            '</div>';
          });
          html += '</div>';
        }

        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div class="bl-empty"><div class="bl-empty-text">Error loading performance.</div></div>';
      }
    },

    /* ── Helpers ── */
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
      this.switchTab('quiz');
    }
  };
})();
