// ══════════════════════════════════════════════════════════════════
// arena-match.js — Studyria BrainLab Arena 1v1 Matchmaking
// Real multiplayer matchmaking using Supabase Realtime Presence + Broadcast
// ══════════════════════════════════════════════════════════════════
//
// ── REQUIRED SUPABASE TABLES (optional, for persistence) ──────────
// The matchmaking works via Realtime channels (no DB tables required).
// To persist match results, run this in Supabase → SQL Editor:
//
// CREATE TABLE IF NOT EXISTS public.arena_matches (
//   id          text PRIMARY KEY,
//   player1_id  uuid NOT NULL,
//   player2_id  uuid NOT NULL,
//   player1_name text,
//   player2_name text,
//   status      text DEFAULT 'lobby',
//   config      jsonb DEFAULT '{}',
//   question_count int DEFAULT 10,
//   player1_score int DEFAULT 0,
//   player2_score int DEFAULT 0,
//   winner_id   uuid,
//   created_at  timestamptz DEFAULT now(),
//   completed_at timestamptz
// );
// ALTER TABLE public.arena_matches ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Arena matches accessible to authenticated" ON public.arena_matches
//   FOR ALL TO authenticated USING (true) WITH CHECK (true);
//

var ArenaMatch = {

  // ── State ──────────────────────────────────────────────────────
  _lobbyChannel: null,
  _matchChannel: null,
  _pollTimer: null,
  _searchTimeout: null,
  _claimTimeout: null,
  _searchConfig: null,
  _matchId: null,
  _opponentId: null,
  _opponentName: null,
  _myStatus: 'idle',       // idle | searching | claiming | accepting | matched | in_lobby | in_battle | completed
  _myReady: false,
  _opponentReady: false,
  _questions: null,
  _currentQ: 0,
  _myScore: 0,
  _opponentScore: 0,
  _opponentFinished: false,
  _iFinished: false,
  _battleStartTime: null,
  _origSelectAnswer: null,
  _origFinishQuiz: null,
  _origNextQuestion: null,
  _origSkipQuestion: null,
  _origQuitQuiz: null,
  _origExitQuiz: null,

  // ── Constants ───────────────────────────────────────────────────
  POLL_INTERVAL: 2000,
  SEARCH_TIMEOUT_MS: 120000,   // 2 min search timeout
  CLAIM_TIMEOUT_MS: 10000,     // 10 sec claim timeout

  // ── Helpers ────────────────────────────────────────────────────
  _client: function() {
    return window.supabaseClient || window.supabase || null;
  },

  _user: function() {
    return BrainLab.user();
  },

  _userId: function() {
    var u = this._user();
    return u ? u.uid : null;
  },

  _userName: function() {
    var u = this._user();
    return u ? (u.name || u.email || 'Player') : 'Player';
  },

  _userAvatar: function() {
    var u = this._user();
    return u ? (u.avatar || '👤') : '👤';
  },

  // ── Compatibility Check ─────────────────────────────────────────
  _isCompatible: function(a, b) {
    if (!a || !b) return false;
    if ((a.mode || '1v1') !== (b.mode || '1v1')) return false;
    if ((a.questionCount || 10) !== (b.questionCount || 10)) return false;
    if ((a.exam || 'All') !== (b.exam || 'All')) return false;
    if ((a.category || 'All') !== (b.category || 'All')) return false;
    if ((a.difficulty || 'mixed') !== (b.difficulty || 'mixed')) return false;
    return true;
  },

  // ── Start Search ───────────────────────────────────────────────
  startSearch: function(config) {
    var s = this;
    var userId = this._userId();

    if (!userId) {
      BrainLab.toast('Please sign in to use Arena matchmaking');
      return;
    }

    // Reset state
    this._cleanup();
    this._searchConfig = config;
    this._myStatus = 'searching';
    this._myReady = false;
    this._opponentReady = false;
    this._matchId = null;
    this._opponentId = null;
    this._opponentName = null;
    this._iFinished = false;
    this._opponentFinished = false;

    console.log('[ArenaMatch] MATCHMAKING_SEARCH_STARTED', {
      userId: userId,
      config: config
    });

    var client = this._client();
    if (!client) {
      this._showError('Unable to connect to matchmaking service. Please check your connection.');
      return;
    }

    // Create / join the arena-lobby realtime channel
    this._lobbyChannel = client.channel('arena-lobby', {
      config: { presence: { key: userId } }
    });

    // Presence sync handler
    this._lobbyChannel.on('presence', { event: 'sync' }, function() {
      s._onPresenceSync();
    });

    // Broadcast: match created (received by responder)
    this._lobbyChannel.on('broadcast', { event: 'match_created' }, function(msg) {
      s._onMatchCreatedBroadcast(msg.payload);
    });

    // Track our presence
    this._lobbyChannel.track({
      userId: userId,
      name: this._userName(),
      avatar: this._userAvatar(),
      status: 'searching',
      config: config,
      timestamp: Date.now()
    });

    this._lobbyChannel.subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        console.log('[ArenaMatch] Subscribed to arena-lobby channel');
        console.log('[ArenaMatch] QUEUE_ENTRY_CREATED', { userId: userId });
        s._startPolling();
        s._startSearchTimeout();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[ArenaMatch] Channel error:', status);
        s._showError('Unable to connect to matchmaking. Please try again.');
      }
    });

    this._showSearching();
  },

  // ── Stop Search ────────────────────────────────────────────────
  stopSearch: function() {
    console.log('[ArenaMatch] MATCH_CANCELLED — stopping search');
    this._cleanup();
    BrainLab.hidePlayer();
    BrainLab.navigate('practice');
  },

  // ── Polling ────────────────────────────────────────────────────
  _startPolling: function() {
    var s = this;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(function() {
      s._pollMatchmaking();
    }, this.POLL_INTERVAL);
    // Also do an immediate poll
    setTimeout(function() { s._pollMatchmaking(); }, 500);
  },

  _startSearchTimeout: function() {
    var s = this;
    if (this._searchTimeout) clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(function() {
      if (s._myStatus === 'searching') {
        s._showSearchTimeout();
      }
    }, this.SEARCH_TIMEOUT_MS);
  },

  // ── Poll Matchmaking ───────────────────────────────────────────
  _pollMatchmaking: function() {
    if (this._myStatus !== 'searching') return;

    var presences = this._getPresences();
    var myId = this._userId();
    var myConfig = this._searchConfig;

    var searchingCount = 0;
    for (var i = 0; i < presences.length; i++) {
      if (presences[i].status === 'searching') searchingCount++;
    }

    console.log('[ArenaMatch] PLAYER_PRESENCE_UPDATED', {
      userId: myId,
      onlineCount: presences.length,
      searchingCount: searchingCount
    });

    for (var i = 0; i < presences.length; i++) {
      var p = presences[i];

      // Skip self
      if (p.userId === myId) continue;

      // Skip stale presences (older than 30 seconds)
      if (p.timestamp && (Date.now() - p.timestamp > 30000)) {
        continue;
      }

      // Skip non-searching users
      if (p.status !== 'searching') {
        continue;
      }

      // Check compatibility
      if (!this._isCompatible(myConfig, p.config)) {
        console.log('[ArenaMatch] CANDIDATE_REJECTED', {
          userId: p.userId,
          reason: 'incompatible config'
        });
        continue;
      }

      // Found a compatible opponent!
      console.log('[ArenaMatch] CANDIDATE_FOUND', {
        userId: p.userId,
        name: p.name
      });

      // Race-safe protocol: smaller userId is the initiator
      if (myId < p.userId) {
        this._claimOpponent(p);
      } else {
        // I'm the responder — wait for the initiator to claim me
        console.log('[ArenaMatch] Waiting for initiator (smaller userId) to claim');
      }
      return;
    }
  },

  // ── Claim Opponent (Initiator) ─────────────────────────────────
  _claimOpponent: function(opponent) {
    var s = this;
    this._myStatus = 'claiming';
    this._opponentId = opponent.userId;
    this._opponentName = opponent.name;

    console.log('[ArenaMatch] MATCH_RESERVATION_STARTED', {
      opponent: opponent.userId
    });

    // Update presence to 'claiming'
    this._lobbyChannel.track({
      userId: this._userId(),
      name: this._userName(),
      avatar: this._userAvatar(),
      status: 'claiming',
      target: opponent.userId,
      config: this._searchConfig,
      timestamp: Date.now()
    });

    // Claim timeout — return to searching if no acceptance
    if (this._claimTimeout) clearTimeout(this._claimTimeout);
    this._claimTimeout = setTimeout(function() {
      if (s._myStatus === 'claiming') {
        console.log('[ArenaMatch] Claim timeout, returning to search');
        s._myStatus = 'searching';
        s._opponentId = null;
        s._opponentName = null;
        s._lobbyChannel.track({
          userId: s._userId(),
          name: s._userName(),
          avatar: s._userAvatar(),
          status: 'searching',
          config: s._searchConfig,
          timestamp: Date.now()
        });
      }
    }, this.CLAIM_TIMEOUT_MS);
  },

  // ── Accept Claim (Responder) ───────────────────────────────────
  _acceptClaim: function(initiator) {
    var s = this;
    this._myStatus = 'accepting';
    this._opponentId = initiator.userId;
    this._opponentName = initiator.name;

    console.log('[ArenaMatch] Accepting claim from', initiator.userId);

    this._lobbyChannel.track({
      userId: this._userId(),
      name: this._userName(),
      avatar: this._userAvatar(),
      status: 'accepting',
      target: initiator.userId,
      config: this._searchConfig,
      timestamp: Date.now()
    });
  },

  // ── Presence Sync Handler ─────────────────────────────────────
  _onPresenceSync: function() {
    var presences = this._getPresences();
    var myId = this._userId();

    // If I'm searching, check if anyone is claiming me
    if (this._myStatus === 'searching') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === myId) continue;

        // Someone is claiming me — I should be the responder
        if (p.status === 'claiming' && p.target === myId) {
          // Verify I'm the responder (my userId > their userId)
          if (myId > p.userId) {
            // Verify compatibility
            if (this._isCompatible(this._searchConfig, p.config)) {
              this._acceptClaim(p);
            }
          }
          return;
        }
      }
    }

    // If I'm claiming, check if the opponent accepted
    if (this._myStatus === 'claiming') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === this._opponentId && p.status === 'accepting' && p.target === myId) {
          // Opponent accepted! Create the match.
          this._createMatch();
          return;
        }
      }
    }

    // If I'm accepting, check if the initiator created the match
    if (this._myStatus === 'accepting') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === this._opponentId && p.status === 'matched' && p.matchTarget === myId) {
          // Match created by initiator! Join the match.
          this._matchId = p.matchId;
          this._joinMatch();
          return;
        }
      }
    }
  },

  // ── Create Match (Initiator) ───────────────────────────────────
  _createMatch: function() {
    var s = this;
    this._myStatus = 'matched';
    this._matchId = 'arena-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    if (this._claimTimeout) clearTimeout(this._claimTimeout);

    console.log('[ArenaMatch] MATCH_CREATED', {
      matchId: this._matchId,
      opponent: this._opponentId
    });

    // Generate questions
    this._generateQuestions();

    // Update presence to 'matched'
    this._lobbyChannel.track({
      userId: this._userId(),
      name: this._userName(),
      avatar: this._userAvatar(),
      status: 'matched',
      matchId: this._matchId,
      matchTarget: this._opponentId,
      config: this._searchConfig,
      timestamp: Date.now()
    });

    // Broadcast match created to the opponent (with question data)
    this._lobbyChannel.send({
      type: 'broadcast',
      event: 'match_created',
      payload: {
        matchId: this._matchId,
        initiatorId: this._userId(),
        initiatorName: this._userName(),
        opponentId: this._opponentId,
        opponentName: this._opponentName,
        config: this._searchConfig,
        questions: this._questions  // Send question set to responder
      }
    });

    // Proceed to lobby
    setTimeout(function() {
      s._showLobby();
    }, 800);
  },

  // ── Join Match (Responder) ─────────────────────────────────────
  _joinMatch: function() {
    var s = this;
    this._myStatus = 'matched';

    console.log('[ArenaMatch] MATCH_JOINED', {
      matchId: this._matchId
    });

    // Update presence to 'matched'
    this._lobbyChannel.track({
      userId: this._userId(),
      name: this._userName(),
      avatar: this._userAvatar(),
      status: 'matched',
      matchId: this._matchId,
      matchTarget: this._opponentId,
      config: this._searchConfig,
      timestamp: Date.now()
    });

    // Proceed to lobby (questions will be received via broadcast)
    setTimeout(function() {
      s._showLobby();
    }, 800);
  },

  // ── Match Created Broadcast Handler (Responder) ────────────────
  _onMatchCreatedBroadcast: function(payload) {
    if (this._myStatus === 'accepting' && payload.opponentId === this._userId()) {
      this._matchId = payload.matchId;
      this._opponentName = payload.initiatorName;
      this._questions = payload.questions;  // Receive question set from initiator

      console.log('[ArenaMatch] Received match_created broadcast with', 
        (payload.questions ? payload.questions.length : 0), 'questions');

      this._joinMatch();
    }
  },

  // ── Generate Questions ────────────────────────────────────────
  _generateQuestions: function() {
    var config = this._searchConfig;
    var pool = BrainLab.filterQuestions({
      category: config.category || 'All',
      exam: config.exam || 'All',
      difficulty: config.difficulty || 'mixed'
    });
    var count = Math.min(config.questionCount || 10, pool.length);
    if (count < 1) count = Math.min(10, pool.length);
    var selected = BrainLab.selectQuestions(pool, count);
    this._questions = BrainLab.toQuiz(selected);

    console.log('[ArenaMatch] Generated', this._questions.length, 'questions for match');
  },

  // ── Get Presences ──────────────────────────────────────────────
  _getPresences: function() {
    if (!this._lobbyChannel) return [];
    var state = this._lobbyChannel.presenceState();
    var presences = [];
    for (var key in state) {
      if (state[key] && state[key][0]) {
        presences.push(state[key][0]);
      }
    }
    return presences;
  },

  // ── Show Searching UI ──────────────────────────────────────────
  _showSearching: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    var config = this._searchConfig;
    c.innerHTML = '<div class="bl-arena-searching">' +
      '<div class="bl-arena-searching-icon">⚔️</div>' +
      '<h2>Searching for online players...</h2>' +
      '<div class="bl-arena-spinner"></div>' +
      '<div class="bl-arena-searching-config">' +
        '<span>📋 Mode: ' + BrainLab.escape(config.mode || '1v1') + '</span>' +
        '<span>❓ Questions: ' + (config.questionCount || 10) + '</span>' +
        '<span>📝 Exam: ' + BrainLab.escape(config.exam || 'All') + '</span>' +
        '<span>📂 Category: ' + BrainLab.escape(config.category || 'All') + '</span>' +
        '<span>📊 Difficulty: ' + BrainLab.escape(config.difficulty || 'Mixed') + '</span>' +
      '</div>' +
      '<p class="bl-arena-searching-hint">Waiting for another player with the same settings...</p>' +
      '<button class="bl-arena-cancel-btn" onclick="ArenaMatch.stopSearch()">Cancel Search</button>' +
    '</div>';
    c.style.display = 'block';
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // ── Show Search Timeout ────────────────────────────────────────
  _showSearchTimeout: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-searching">' +
      '<div class="bl-arena-searching-icon">🔍</div>' +
      '<h2>No compatible player found yet.</h2>' +
      '<p class="bl-arena-searching-hint">No other player with matching Arena settings is currently online.</p>' +
      '<div class="bl-arena-timeout-actions">' +
        '<button class="bl-arena-keep-btn" onclick="ArenaMatch._keepSearching()">Keep Searching</button>' +
        '<button class="bl-arena-cancel-btn" onclick="ArenaMatch.stopSearch()">Cancel</button>' +
      '</div>' +
    '</div>';
  },

  _keepSearching: function() {
    this._myStatus = 'searching';
    this._startSearchTimeout();
    this._showSearching();
  },

  // ── Show Lobby ─────────────────────────────────────────────────
  _showLobby: function() {
    // Stop search polling and timeout
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._searchTimeout) { clearTimeout(this._searchTimeout); this._searchTimeout = null; }
    if (this._claimTimeout) { clearTimeout(this._claimTimeout); this._claimTimeout = null; }

    var s = this;
    var client = this._client();
    var matchChannelName = 'arena-match-' + this._matchId;

    console.log('[ArenaMatch] MATCH_READY — entering lobby', { matchId: this._matchId });

    // Join the match channel
    if (this._matchChannel) {
      try { client.removeChannel(this._matchChannel); } catch(e) {}
    }

    this._matchChannel = client.channel(matchChannelName, {
      config: { presence: { key: this._userId() } }
    });

    // Listen for opponent's ready
    this._matchChannel.on('broadcast', { event: 'ready' }, function(msg) {
      console.log('[ArenaMatch] Opponent ready');
      s._opponentReady = true;
      s._updateLobbyOpponentReady();
      s._checkBothReady();
    });

    // Listen for opponent's answer progress
    this._matchChannel.on('broadcast', { event: 'progress' }, function(msg) {
      s._onOpponentProgress(msg.payload);
    });

    // Listen for opponent leaving
    this._matchChannel.on('broadcast', { event: 'leave' }, function(msg) {
      s._onOpponentLeave();
    });

    // Listen for battle start (from countdown broadcast)
    this._matchChannel.on('broadcast', { event: 'battle_start' }, function(msg) {
      s._startBattle();
    });

    this._matchChannel.track({
      userId: this._userId(),
      name: this._userName(),
      status: 'in_lobby',
      timestamp: Date.now()
    });

    this._matchChannel.subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        console.log('[ArenaMatch] Subscribed to match channel:', matchChannelName);
      }
    });

    // Render lobby UI
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    var config = this._searchConfig;
    c.innerHTML = '<div class="bl-arena-lobby">' +
      '<h2 class="bl-arena-lobby-title">⚔️ Match Found!</h2>' +
      '<div class="bl-arena-lobby-players">' +
        '<div class="bl-arena-lobby-player">' +
          '<div class="bl-arena-lobby-avatar">' + this._userAvatar() + '</div>' +
          '<div class="bl-arena-lobby-name">' + BrainLab.escape(this._userName()) + ' (You)</div>' +
          '<div class="bl-arena-lobby-status" id="bl-arena-my-ready">Not Ready</div>' +
        '</div>' +
        '<div class="bl-arena-lobby-vs">VS</div>' +
        '<div class="bl-arena-lobby-player">' +
          '<div class="bl-arena-lobby-avatar">👤</div>' +
          '<div class="bl-arena-lobby-name">' + BrainLab.escape(this._opponentName || 'Opponent') + '</div>' +
          '<div class="bl-arena-lobby-status" id="bl-arena-opp-ready">Not Ready</div>' +
        '</div>' +
      '</div>' +
      '<div class="bl-arena-lobby-config">' +
        '<span>❓ ' + (config.questionCount || 10) + ' Questions</span>' +
        '<span>📝 ' + BrainLab.escape(config.exam || 'All') + '</span>' +
        '<span>📂 ' + BrainLab.escape(config.category || 'All') + '</span>' +
        '<span>📊 ' + BrainLab.escape(config.difficulty || 'Mixed') + '</span>' +
      '</div>' +
      '<button class="bl-arena-ready-btn" id="bl-arena-ready-btn" onclick="ArenaMatch.setReady()">Ready!</button>' +
      '<button class="bl-arena-leave-btn" onclick="ArenaMatch.leaveMatch()">Leave Match</button>' +
    '</div>';
    c.style.display = 'block';
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // ── Set Ready ─────────────────────────────────────────────────
  setReady: function() {
    if (this._myReady) return;
    this._myReady = true;

    var btn = document.getElementById('bl-arena-ready-btn');
    if (btn) {
      btn.textContent = '✓ Ready';
      btn.disabled = true;
      btn.classList.add('ready');
    }
    var st = document.getElementById('bl-arena-my-ready');
    if (st) {
      st.textContent = '🟢 Ready';
      st.classList.add('ready');
    }

    // Broadcast ready to opponent
    if (this._matchChannel) {
      this._matchChannel.send({
        type: 'broadcast',
        event: 'ready',
        payload: { userId: this._userId() }
      });
    }

    console.log('[ArenaMatch] Player ready');
    this._checkBothReady();
  },

  _updateLobbyOpponentReady: function() {
    var st = document.getElementById('bl-arena-opp-ready');
    if (st) {
      st.textContent = '🟢 Ready';
      st.classList.add('ready');
    }
  },

  _checkBothReady: function() {
    if (this._myReady && this._opponentReady) {
      this._startCountdown();
    }
  },

  // ── Countdown ─────────────────────────────────────────────────
  _startCountdown: function() {
    var s = this;
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;

    var count = 3;
    c.innerHTML = '<div class="bl-arena-countdown"><div class="bl-arena-countdown-num" id="bl-arena-cd">3</div></div>';

    var timer = setInterval(function() {
      count--;
      var el = document.getElementById('bl-arena-cd');
      if (el) el.textContent = count > 0 ? count : '⚔️';
      if (count <= 0) {
        clearInterval(timer);
        // Broadcast battle start to opponent
        if (s._matchChannel) {
          s._matchChannel.send({
            type: 'broadcast',
            event: 'battle_start',
            payload: { timestamp: Date.now() }
          });
        }
        s._startBattle();
      }
    }, 1000);
  },

  // ── Start Battle ──────────────────────────────────────────────
  _startBattle: function() {
    console.log('[ArenaMatch] MATCH_STARTED — battle begins');

    this._myStatus = 'in_battle';
    this._currentQ = 0;
    this._myScore = 0;
    this._opponentScore = 0;
    this._iFinished = false;
    this._opponentFinished = false;
    this._battleStartTime = Date.now();

    // Ensure we have questions
    if (!this._questions || !this._questions.length) {
      console.error('[ArenaMatch] No questions for battle! Generating locally...');
      this._generateQuestions();
    }

    // Hook into BrainLab's quiz player
    this._installBattleHooks();

    // Set up BrainLab state for the quiz player
    BrainLab._currentQuiz = { questions: this._questions };
    BrainLab._answers = [];
    BrainLab._currentQIdx = 0;
    BrainLab._startTime = Date.now();
    BrainLab._sessionMeta = {
      id: this._matchId,
      mode: 'arena_1v1',
      title: 'Arena 1v1 Battle vs ' + (this._opponentName || 'Opponent'),
      category: this._searchConfig.category || 'All',
      exam: this._searchConfig.exam || 'All',
      difficulty: this._searchConfig.difficulty || 'mixed',
      total_questions: this._questions.length,
      started_at: new Date().toISOString(),
      opponent: this._opponentName
    };

    // Render the first question
    BrainLab._renderQuestion();
    BrainLab.showPlayer();

    // Add arena battle overlay (opponent progress bar)
    this._addBattleOverlay();
  },

  // ── Install Battle Hooks ──────────────────────────────────────
  _installBattleHooks: function() {
    var s = this;

    // Save original functions
    this._origSelectAnswer = BrainLab.selectAnswer;
    this._origFinishQuiz = BrainLab._finishQuiz;
    this._origNextQuestion = BrainLab.nextQuestion;
    this._origQuitQuiz = BrainLab.quitQuiz;
    this._origExitQuiz = BrainLab.exitQuiz;

    // Override selectAnswer to broadcast progress
    BrainLab.selectAnswer = function(optIdx) {
      s._origSelectAnswer.call(BrainLab, optIdx);

      // After answering, check if correct and update score
      if (BrainLab._answers[BrainLab._currentQIdx]) {
        var isCorrect = BrainLab._answers[BrainLab._currentQIdx].isCorrect;
        if (isCorrect) s._myScore++;

        // Broadcast progress to opponent
        if (s._matchChannel) {
          s._matchChannel.send({
            type: 'broadcast',
            event: 'progress',
            payload: {
              userId: s._userId(),
              currentQuestion: BrainLab._currentQIdx + 1,
              totalQuestions: s._questions.length,
              score: s._myScore,
              finished: false
            }
          });
        }

        // Update battle overlay
        s._updateBattleOverlay();
      }
    };

    // Override nextQuestion to update overlay
    BrainLab.nextQuestion = function() {
      s._origNextQuestion.call(BrainLab);
      s._updateBattleOverlay();
    };

    // Override finishQuiz to show arena results
    BrainLab._finishQuiz = function() {
      s._iFinished = true;

      // Broadcast final score to opponent
      if (s._matchChannel) {
        s._matchChannel.send({
          type: 'broadcast',
          event: 'progress',
          payload: {
            userId: s._userId(),
            currentQuestion: s._questions.length,
            totalQuestions: s._questions.length,
            score: s._myScore,
            finished: true
          }
        });
      }

      // If opponent already finished, show results
      if (s._opponentFinished) {
        s._showArenaResults();
      } else {
        s._showWaitingForOpponent();
      }
    };

    // Override quit/exit to handle leaving
    BrainLab.quitQuiz = function() {
      if (s._matchChannel) {
        s._matchChannel.send({
          type: 'broadcast',
          event: 'leave',
          payload: { userId: s._userId() }
        });
      }
      s._uninstallBattleHooks();
      s._cleanup();
      s._origQuitQuiz.call(BrainLab);
    };

    BrainLab.exitQuiz = function() {
      if (s._matchChannel) {
        s._matchChannel.send({
          type: 'broadcast',
          event: 'leave',
          payload: { userId: s._userId() }
        });
      }
      s._uninstallBattleHooks();
      s._cleanup();
      s._origExitQuiz.call(BrainLab);
    };
  },

  _uninstallBattleHooks: function() {
    if (this._origSelectAnswer) BrainLab.selectAnswer = this._origSelectAnswer;
    if (this._origFinishQuiz) BrainLab._finishQuiz = this._origFinishQuiz;
    if (this._origNextQuestion) BrainLab.nextQuestion = this._origNextQuestion;
    if (this._origQuitQuiz) BrainLab.quitQuiz = this._origQuitQuiz;
    if (this._origExitQuiz) BrainLab.exitQuiz = this._origExitQuiz;
    this._origSelectAnswer = null;
    this._origFinishQuiz = null;
    this._origNextQuestion = null;
    this._origQuitQuiz = null;
    this._origExitQuiz = null;
  },

  // ── Battle Overlay ────────────────────────────────────────────
  _addBattleOverlay: function() {
    // Remove existing overlay
    var existing = document.getElementById('bl-arena-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bl-arena-overlay';
    overlay.className = 'bl-arena-overlay';
    overlay.innerHTML =
      '<div class="bl-arena-ov-left">' +
        '<span class="bl-arena-ov-name">' + BrainLab.escape(this._userName()) + '</span>' +
        '<span class="bl-arena-ov-score" id="bl-arena-my-score">0</span>' +
      '</div>' +
      '<div class="bl-arena-ov-center">VS</div>' +
      '<div class="bl-arena-ov-right">' +
        '<span class="bl-arena-ov-name">' + BrainLab.escape(this._opponentName || 'Opponent') + '</span>' +
        '<span class="bl-arena-ov-score" id="bl-arena-opp-score">0</span>' +
      '</div>';

    var player = document.getElementById('bl-quiz-player-area');
    if (player) player.insertBefore(overlay, player.firstChild);
  },

  _updateBattleOverlay: function() {
    var myEl = document.getElementById('bl-arena-my-score');
    if (myEl) myEl.textContent = this._myScore;
    var oppEl = document.getElementById('bl-arena-opp-score');
    if (oppEl) oppEl.textContent = this._opponentScore;
  },

  // ── Opponent Progress ─────────────────────────────────────────
  _onOpponentProgress: function(payload) {
    if (payload.finished) {
      this._opponentFinished = true;
      this._opponentScore = payload.score || 0;
      this._updateBattleOverlay();

      // If I've also finished, show results
      if (this._iFinished) {
        this._showArenaResults();
      }
    } else {
      this._opponentScore = payload.score || 0;
      this._updateBattleOverlay();
    }
  },

  // ── Opponent Leave ────────────────────────────────────────────
  _onOpponentLeave: function() {
    console.log('[ArenaMatch] Opponent left the match');

    if (this._myStatus === 'in_battle' && !this._iFinished) {
      // Opponent left during battle — show win by forfeit
      this._showForfeitWin();
    } else if (this._myStatus === 'in_lobby') {
      // Opponent left during lobby
      this._showOpponentLeftLobby();
    }
  },

  // ── Show Waiting for Opponent ─────────────────────────────────
  _showWaitingForOpponent: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-waiting">' +
      '<div class="bl-arena-waiting-icon">⏳</div>' +
      '<h2>Battle Complete!</h2>' +
      '<p>Your score: <strong>' + this._myScore + '/' + this._questions.length + '</strong></p>' +
      '<p class="bl-arena-waiting-text">Waiting for opponent to finish...</p>' +
      '<div class="bl-arena-spinner"></div>' +
    '</div>';
    c.style.display = 'block';
  },

  // ── Show Arena Results ────────────────────────────────────────
  _showArenaResults: function() {
    console.log('[ArenaMatch] MATCH_COMPLETED', {
      myScore: this._myScore,
      opponentScore: this._opponentScore
    });

    this._myStatus = 'completed';

    var total = this._questions.length;
    var myPct = total > 0 ? Math.round((this._myScore / total) * 100) : 0;
    var oppPct = total > 0 ? Math.round((this._opponentScore / total) * 100) : 0;
    var isWin = this._myScore > this._opponentScore;
    var isTie = this._myScore === this._opponentScore;

    var resultText = isTie ? "It's a Tie!" : (isWin ? "You Won! 🏆" : "You Lost 😔");
    var resultClass = isTie ? 'bl-arena-result-tie' : (isWin ? 'bl-arena-result-win' : 'bl-arena-result-lose');

    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-results ' + resultClass + '">' +
      '<h2 class="bl-arena-results-title">' + resultText + '</h2>' +
      '<div class="bl-arena-results-players">' +
        '<div class="bl-arena-results-player ' + (isWin ? 'winner' : '') + '">' +
          '<div class="bl-arena-results-avatar">' + this._userAvatar() + '</div>' +
          '<div class="bl-arena-results-name">' + BrainLab.escape(this._userName()) + '</div>' +
          '<div class="bl-arena-results-score">' + this._myScore + '/' + total + '</div>' +
          '<div class="bl-arena-results-pct">' + myPct + '%</div>' +
        '</div>' +
        '<div class="bl-arena-results-vs">VS</div>' +
        '<div class="bl-arena-results-player ' + (!isWin && !isTie ? 'winner' : '') + '">' +
          '<div class="bl-arena-results-avatar">👤</div>' +
          '<div class="bl-arena-results-name">' + BrainLab.escape(this._opponentName || 'Opponent') + '</div>' +
          '<div class="bl-arena-results-score">' + this._opponentScore + '/' + total + '</div>' +
          '<div class="bl-arena-results-pct">' + oppPct + '%</div>' +
        '</div>' +
      '</div>' +
      '<div class="bl-arena-results-actions">' +
        '<button class="bl-arena-results-rematch" onclick="ArenaMatch._rematch()">Rematch</button>' +
        '<button class="bl-arena-results-exit" onclick="ArenaMatch._exitToArena()">Back to Arena</button>' +
      '</div>' +
    '</div>';
    c.style.display = 'block';
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Save match to session history
    this._saveMatchResult(isWin, isTie);

    // Uninstall hooks
    this._uninstallBattleHooks();
  },

  // ── Show Forfeit Win ──────────────────────────────────────────
  _showForfeitWin: function() {
    console.log('[ArenaMatch] Opponent forfeited — win by default');
    this._myStatus = 'completed';
    this._uninstallBattleHooks();

    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-results bl-arena-result-win">' +
      '<h2 class="bl-arena-results-title">You Won! 🏆</h2>' +
      '<p class="bl-arena-forfeit-text">Your opponent left the match.</p>' +
      '<div class="bl-arena-results-actions">' +
        '<button class="bl-arena-results-exit" onclick="ArenaMatch._exitToArena()">Back to Arena</button>' +
      '</div>' +
    '</div>';
    c.style.display = 'block';
    this._saveMatchResult(true, false);
  },

  // ── Show Opponent Left Lobby ──────────────────────────────────
  _showOpponentLeftLobby: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-searching">' +
      '<div class="bl-arena-searching-icon">👋</div>' +
      '<h2>Opponent left the lobby</h2>' +
      '<p class="bl-arena-searching-hint">Your opponent disconnected before the match started.</p>' +
      '<button class="bl-arena-cancel-btn" onclick="ArenaMatch._exitToArena()">Back to Arena</button>' +
    '</div>';
    c.style.display = 'block';
  },

  // ── Save Match Result ─────────────────────────────────────────
  _saveMatchResult: function(isWin, isTie) {
    try {
      var session = {
        id: this._matchId,
        mode: 'arena_1v1',
        title: 'Arena Battle vs ' + (this._opponentName || 'Opponent'),
        category: this._searchConfig.category || 'All',
        exam: this._searchConfig.exam || 'All',
        difficulty: this._searchConfig.difficulty || 'mixed',
        total_questions: this._questions.length,
        correct_count: this._myScore,
        wrong_count: this._questions.length - this._myScore,
        skipped_count: 0,
        score: Math.round((this._myScore / this._questions.length) * 100),
        time_taken: Math.floor((Date.now() - this._battleStartTime) / 1000),
        started_at: new Date(this._battleStartTime).toISOString(),
        completed_at: new Date().toISOString(),
        opponent: this._opponentName,
        result: isTie ? 'tie' : (isWin ? 'win' : 'lose')
      };
      BrainLab.saveSession(session);
      BrainLab.markStreak();
      BrainLab.renderStats();
    } catch(e) {
      console.error('[ArenaMatch] Error saving match result:', e);
    }

    // Also try to persist to Supabase if arena_matches table exists
    this._persistMatchResult(isWin, isTie);
  },

  _persistMatchResult: function(isWin, isTie) {
    var client = this._client();
    if (!client) return;
    var winnerId = isTie ? null : (isWin ? this._userId() : this._opponentId);
    try {
      client.from('arena_matches').upsert({
        id: this._matchId,
        player1_id: this._userId(),
        player2_id: this._opponentId,
        player1_name: this._userName(),
        player2_name: this._opponentName,
        status: 'completed',
        config: this._searchConfig,
        question_count: this._questions.length,
        player1_score: this._myScore,
        player2_score: this._opponentScore,
        winner_id: winnerId,
        completed_at: new Date().toISOString()
      }).then(function(r) {
        console.log('[ArenaMatch] Match result persisted to DB');
      }).catch(function(e) {
        console.log('[ArenaMatch] arena_matches table may not exist (non-critical):', e.message);
      });
    } catch(e) {
      console.log('[ArenaMatch] Could not persist match (non-critical):', e.message);
    }
  },

  // ── Rematch ───────────────────────────────────────────────────
  _rematch: function() {
    this._cleanup();
    this.startSearch(this._searchConfig);
  },

  // ── Exit to Arena ─────────────────────────────────────────────
  _exitToArena: function() {
    this._cleanup();
    this._uninstallBattleHooks();
    BrainLab.hidePlayer();
    BrainLab.navigate('practice');
  },

  // ── Leave Match ───────────────────────────────────────────────
  leaveMatch: function() {
    if (!confirm('Leave this match?')) return;

    console.log('[ArenaMatch] MATCH_CANCELLED — leaving match');

    if (this._matchChannel) {
      this._matchChannel.send({
        type: 'broadcast',
        event: 'leave',
        payload: { userId: this._userId() }
      });
    }

    this._uninstallBattleHooks();
    this._cleanup();
    BrainLab.hidePlayer();
    BrainLab.navigate('practice');
  },

  // ── Show Error ────────────────────────────────────────────────
  _showError: function(msg) {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-searching">' +
      '<div class="bl-arena-searching-icon">⚠️</div>' +
      '<h2>' + BrainLab.escape(msg) + '</h2>' +
      '<button class="bl-arena-cancel-btn" onclick="ArenaMatch._exitToArena()">Back to Arena</button>' +
    '</div>';
    c.style.display = 'block';
  },

  // ── Cleanup ───────────────────────────────────────────────────
  _cleanup: function() {
    // Stop timers
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._searchTimeout) { clearTimeout(this._searchTimeout); this._searchTimeout = null; }
    if (this._claimTimeout) { clearTimeout(this._claimTimeout); this._claimTimeout = null; }

    // Remove channels
    var client = this._client();
    if (client) {
      if (this._lobbyChannel) {
        try { client.removeChannel(this._lobbyChannel); } catch(e) {}
        this._lobbyChannel = null;
      }
      if (this._matchChannel) {
        try { client.removeChannel(this._matchChannel); } catch(e) {}
        this._matchChannel = null;
      }
    }

    // Reset state
    this._myStatus = 'idle';
    this._myReady = false;
    this._opponentReady = false;
    this._matchId = null;
    this._opponentId = null;
    this._opponentName = null;
    this._questions = null;
    this._iFinished = false;
    this._opponentFinished = false;
  }
};

// Initialize on load
if (typeof ArenaMatch !== 'undefined') {
  ArenaMatch.init = ArenaMatch.init || function() {};
}
