// ══════════════════════════════════════════════════════════════════
// arena-match.js — Studyria BrainLab Arena 1v1 Matchmaking
// Real multiplayer matchmaking using Supabase Realtime Presence + Broadcast
// ══════════════════════════════════════════════════════════════════
//
// FIXES:
// 1. Added heartbeat (re-track presence every 5s) — prevents staleness
// 2. Removed 30-second stale check — Supabase handles presence expiration
// 3. track() called AFTER subscribe() succeeds — fixes timing issues
// 4. Responder actively sends "nudge" broadcast — initiator can claim
// 5. Broadcast-based handshake (claim → accept → match_created) — reliable
// 6. Presence sync as backup detection — double chance of matching
// 7. Claim timeout 15s, search timeout 2min — no infinite waiting
//

var ArenaMatch = {

  _lobbyChannel: null,
  _matchChannel: null,
  _pollTimer: null,
  _heartbeatTimer: null,
  _searchTimeout: null,
  _searchConfig: null,
  _matchId: null,
  _opponentId: null,
  _opponentName: null,
  _myStatus: 'idle',
  _myReady: false,
  _opponentReady: false,
  _questions: null,
  _myScore: 0,
  _opponentScore: 0,
  _opponentFinished: false,
  _iFinished: false,
  _battleStartTime: null,
  _origSelectAnswer: null,
  _origFinishQuiz: null,
  _origNextQuestion: null,
  _origQuitQuiz: null,
  _origExitQuiz: null,
  _subscribed: false,

  POLL_INTERVAL: 2000,
  HEARTBEAT_INTERVAL: 5000,
  SEARCH_TIMEOUT_MS: 120000,

  _client: function() { return window.supabaseClient || window.supabase || null; },
  _user: function() { return BrainLab.user(); },
  _userId: function() { var u = this._user(); return u ? u.uid : null; },
  _userName: function() { var u = this._user(); return u ? (u.name || u.email || 'Player') : 'Player'; },
  _userAvatar: function() { var u = this._user(); return u ? (u.avatar || '👤') : '👤'; },

  _isCompatible: function(a, b) {
    if (!a || !b) return false;
    if ((a.mode || '1v1') !== (b.mode || '1v1')) return false;
    if ((a.questionCount || 10) !== (b.questionCount || 10)) return false;
    if ((a.exam || 'All') !== (b.exam || 'All')) return false;
    if ((a.category || 'All') !== (b.category || 'All')) return false;
    if ((a.difficulty || 'mixed') !== (b.difficulty || 'mixed')) return false;
    return true;
  },

  _presencePayload: function(extra) {
    var base = {
      userId: this._userId(),
      name: this._userName(),
      avatar: this._userAvatar(),
      status: this._myStatus,
      config: this._searchConfig,
      timestamp: Date.now()
    };
    if (extra) { for (var k in extra) base[k] = extra[k]; }
    return base;
  },

  _heartbeat: function() {
    if (!this._lobbyChannel || !this._subscribed) return;
    if (this._myStatus === 'idle' || this._myStatus === 'in_battle' || this._myStatus === 'completed') return;
    var payload = this._presencePayload();
    console.log('[ArenaMatch] HEARTBEAT', { status: this._myStatus, ts: payload.timestamp });
    try { this._lobbyChannel.track(payload); } catch(e) { console.error('[ArenaMatch] Heartbeat error:', e); }
  },

  startSearch: function(config) {
    var s = this;
    var userId = this._userId();
    if (!userId) { BrainLab.toast('Please sign in to use Arena matchmaking'); return; }

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
    this._subscribed = false;

    console.log('[ArenaMatch] MATCHMAKING_SEARCH_STARTED', { userId: userId, config: config });

    var client = this._client();
    if (!client) { this._showError('Unable to connect to matchmaking service.'); return; }

    this._lobbyChannel = client.channel('arena-lobby', {
      config: { presence: { key: userId } }
    });

    this._lobbyChannel.on('presence', { event: 'sync' }, function() { s._onPresenceSync(); });
    this._lobbyChannel.on('broadcast', { event: 'claim' }, function(msg) { s._onClaimBroadcast(msg.payload); });
    this._lobbyChannel.on('broadcast', { event: 'accept' }, function(msg) { s._onAcceptBroadcast(msg.payload); });
    this._lobbyChannel.on('broadcast', { event: 'match_created' }, function(msg) { s._onMatchCreatedBroadcast(msg.payload); });
    this._lobbyChannel.on('broadcast', { event: 'cancel_search' }, function(msg) {
      console.log('[ArenaMatch] Opponent cancelled', msg.payload);
    });

    // Subscribe FIRST, then track presence
    this._lobbyChannel.subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        console.log('[ArenaMatch] ✅ Subscribed to arena-lobby');
        s._subscribed = true;
        s._lobbyChannel.track(s._presencePayload());
        console.log('[ArenaMatch] QUEUE_ENTRY_CREATED', { userId: userId });
        s._startPolling();
        s._startHeartbeat();
        s._startSearchTimeout();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[ArenaMatch] ❌ Channel error:', status);
        s._showError('Unable to connect to matchmaking. Please try again.');
      }
    });

    this._showSearching();
  },

  stopSearch: function() {
    console.log('[ArenaMatch] MATCH_CANCELLED');
    if (this._lobbyChannel && this._subscribed) {
      try { this._lobbyChannel.send({ type: 'broadcast', event: 'cancel_search', payload: { userId: this._userId() } }); } catch(e) {}
    }
    this._cleanup();
    BrainLab.hidePlayer();
    BrainLab.navigate('practice');
  },

  _startHeartbeat: function() {
    var s = this;
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(function() { s._heartbeat(); }, this.HEARTBEAT_INTERVAL);
  },

  _startPolling: function() {
    var s = this;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(function() { s._pollMatchmaking(); }, this.POLL_INTERVAL);
    setTimeout(function() { s._pollMatchmaking(); }, 1000);
    setTimeout(function() { s._pollMatchmaking(); }, 3000);
  },

  _startSearchTimeout: function() {
    var s = this;
    if (this._searchTimeout) clearTimeout(this._searchTimeout);
    this._searchTimeout = setTimeout(function() {
      if (s._myStatus === 'searching') { s._showSearchTimeout(); }
    }, this.SEARCH_TIMEOUT_MS);
  },

  _pollMatchmaking: function() {
    if (this._myStatus !== 'searching' && this._myStatus !== 'claiming') return;

    var presences = this._getPresences();
    var myId = this._userId();
    var myConfig = this._searchConfig;

    var searchingCount = 0;
    for (var i = 0; i < presences.length; i++) {
      if (presences[i].status === 'searching') searchingCount++;
    }

    console.log('[ArenaMatch] PLAYER_PRESENCE_UPDATED', {
      userId: myId, myStatus: this._myStatus,
      onlineCount: presences.length, searchingCount: searchingCount,
      users: presences.map(function(p) { return { id: p.userId ? p.userId.substring(0,8) : '?', st: p.status }; })
    });

    // If claiming, check if opponent accepted or left
    if (this._myStatus === 'claiming') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === this._opponentId) {
          if (p.status === 'accepting' && p.target === myId) {
            console.log('[ArenaMatch] Opponent accepted (polling)');
            this._createMatch();
            return;
          }
          if (p.status !== 'searching' && p.status !== 'accepting') {
            console.log('[ArenaMatch] Opponent gone, returning to search');
            this._returnToSearch();
            return;
          }
        }
      }
      return;
    }

    // If searching, look for compatible opponents
    for (var i = 0; i < presences.length; i++) {
      var p = presences[i];
      if (p.userId === myId) continue;
      if (p.status !== 'searching') continue;
      if (!this._isCompatible(myConfig, p.config)) {
        console.log('[ArenaMatch] CANDIDATE_REJECTED', { userId: p.userId, reason: 'incompatible' });
        continue;
      }

      console.log('[ArenaMatch] CANDIDATE_FOUND', { userId: p.userId, name: p.name });

      if (myId < p.userId) {
        // I'm initiator — claim
        this._claimOpponent(p);
      } else {
        // I'm responder — send nudge broadcast to initiator
        console.log('[ArenaMatch] I am responder, nudging initiator');
        try {
          this._lobbyChannel.send({
            type: 'broadcast', event: 'claim',
            payload: { fromUserId: myId, fromName: this._userName(), toUserId: p.userId, config: this._searchConfig, nudge: true }
          });
        } catch(e) { console.error('[ArenaMatch] Nudge error:', e); }
      }
      return;
    }
  },

  _claimOpponent: function(opponent) {
    var s = this;
    this._myStatus = 'claiming';
    this._opponentId = opponent.userId;
    this._opponentName = opponent.name;

    console.log('[ArenaMatch] MATCH_RESERVATION_STARTED', { opponent: opponent.userId });

    this._lobbyChannel.track(this._presencePayload({ status: 'claiming', target: opponent.userId }));

    try {
      this._lobbyChannel.send({
        type: 'broadcast', event: 'claim',
        payload: { fromUserId: this._userId(), fromName: this._userName(), toUserId: opponent.userId, config: this._searchConfig, nudge: false }
      });
    } catch(e) { console.error('[ArenaMatch] Claim broadcast error:', e); }

    setTimeout(function() {
      if (s._myStatus === 'claiming') {
        console.log('[ArenaMatch] Claim timeout 15s, returning to search');
        s._returnToSearch();
      }
    }, 15000);
  },

  _returnToSearch: function() {
    this._myStatus = 'searching';
    this._opponentId = null;
    this._opponentName = null;
    this._lobbyChannel.track(this._presencePayload({ status: 'searching' }));
    this._pollMatchmaking();
  },

  _onClaimBroadcast: function(payload) {
    if (payload.toUserId !== this._userId()) return;

    if (payload.nudge) {
      // Responder is nudging me (the initiator) to claim them
      if (this._myStatus === 'searching' && this._userId() < payload.fromUserId) {
        console.log('[ArenaMatch] Received nudge from', payload.fromUserId, '— claiming!');
        this._claimOpponent({ userId: payload.fromUserId, name: payload.fromName, config: payload.config });
      }
      return;
    }

    // Real claim — verify I'm responder
    if (this._myStatus !== 'searching') {
      console.log('[ArenaMatch] Claim received but status=' + this._myStatus);
      return;
    }
    if (this._userId() > payload.fromUserId) {
      if (!this._isCompatible(this._searchConfig, payload.config)) {
        console.log('[ArenaMatch] Claim rejected — incompatible');
        return;
      }
      console.log('[ArenaMatch] Accepting claim from', payload.fromUserId);
      this._acceptClaim({ userId: payload.fromUserId, name: payload.fromName });
    }
  },

  _acceptClaim: function(initiator) {
    var s = this;
    this._myStatus = 'accepting';
    this._opponentId = initiator.userId;
    this._opponentName = initiator.name;

    console.log('[ArenaMatch] Accepting claim', { initiator: initiator.userId });

    this._lobbyChannel.track(this._presencePayload({ status: 'accepting', target: initiator.userId }));

    try {
      this._lobbyChannel.send({
        type: 'broadcast', event: 'accept',
        payload: { fromUserId: this._userId(), fromName: this._userName(), toUserId: initiator.userId, config: this._searchConfig }
      });
    } catch(e) { console.error('[ArenaMatch] Accept broadcast error:', e); }
  },

  _onAcceptBroadcast: function(payload) {
    if (payload.toUserId !== this._userId()) return;
    if (this._myStatus !== 'claiming') {
      console.log('[ArenaMatch] Accept received but status=' + this._myStatus);
      return;
    }
    if (payload.fromUserId !== this._opponentId) return;
    if (!this._isCompatible(this._searchConfig, payload.config)) return;

    console.log('[ArenaMatch] Opponent accepted (broadcast)!');
    this._opponentName = payload.fromName;
    this._createMatch();
  },

  _onPresenceSync: function() {
    if (!this._subscribed) return;

    var presences = this._getPresences();
    var myId = this._userId();

    if (this._myStatus === 'searching') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === myId) continue;
        if (p.status === 'claiming' && p.target === myId && myId > p.userId) {
          if (this._isCompatible(this._searchConfig, p.config)) {
            console.log('[ArenaMatch] Claim detected (presence sync)');
            this._acceptClaim({ userId: p.userId, name: p.name });
          }
          return;
        }
      }
    }

    if (this._myStatus === 'claiming') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === this._opponentId && p.status === 'accepting' && p.target === myId) {
          console.log('[ArenaMatch] Acceptance detected (presence sync)');
          this._createMatch();
          return;
        }
      }
    }

    if (this._myStatus === 'accepting') {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (p.userId === this._opponentId && p.status === 'matched' && p.matchTarget === myId) {
          console.log('[ArenaMatch] Match detected (presence sync)');
          this._matchId = p.matchId;
          this._joinMatch();
          return;
        }
      }
    }
  },

  _createMatch: function() {
    var s = this;
    if (this._myStatus === 'matched') return;

    this._myStatus = 'matched';
    this._matchId = 'arena-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    console.log('[ArenaMatch] MATCH_CREATED', { matchId: this._matchId, opponent: this._opponentId });

    this._generateQuestions();

    this._lobbyChannel.track(this._presencePayload({ status: 'matched', matchId: this._matchId, matchTarget: this._opponentId }));

    try {
      this._lobbyChannel.send({
        type: 'broadcast', event: 'match_created',
        payload: {
          matchId: this._matchId,
          initiatorId: this._userId(), initiatorName: this._userName(),
          opponentId: this._opponentId, opponentName: this._opponentName,
          config: this._searchConfig, questions: this._questions
        }
      });
    } catch(e) { console.error('[ArenaMatch] match_created broadcast error:', e); }

    this._showMatchFound();
    setTimeout(function() { s._showLobby(); }, 2000);
  },

  _joinMatch: function() {
    var s = this;
    if (this._myStatus === 'matched') return;
    this._myStatus = 'matched';
    console.log('[ArenaMatch] MATCH_JOINED', { matchId: this._matchId });

    this._lobbyChannel.track(this._presencePayload({ status: 'matched', matchId: this._matchId, matchTarget: this._opponentId }));

    this._showMatchFound();
    setTimeout(function() { s._showLobby(); }, 2000);
  },

  _onMatchCreatedBroadcast: function(payload) {
    if (payload.opponentId !== this._userId()) return;
    if (this._myStatus !== 'accepting' && this._myStatus !== 'matched') return;
    if (this._myStatus === 'matched') return;

    this._matchId = payload.matchId;
    this._opponentName = payload.initiatorName;
    this._questions = payload.questions;
    console.log('[ArenaMatch] match_created received', { matchId: payload.matchId, qCount: payload.questions ? payload.questions.length : 0 });
    this._joinMatch();
  },

  _generateQuestions: function() {
    var config = this._searchConfig;
    var pool = BrainLab.filterQuestions({ category: config.category || 'All', exam: config.exam || 'All', difficulty: config.difficulty || 'mixed' });
    var count = Math.min(config.questionCount || 10, pool.length);
    if (count < 1) count = Math.min(10, pool.length);
    var selected = BrainLab.selectQuestions(pool, count);
    this._questions = BrainLab.toQuiz(selected);
    console.log('[ArenaMatch] Generated', this._questions.length, 'questions');
  },

  _getPresences: function() {
    if (!this._lobbyChannel) return [];
    var state = this._lobbyChannel.presenceState();
    var presences = [];
    for (var key in state) {
      if (state[key] && state[key][0]) presences.push(state[key][0]);
    }
    return presences;
  },

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

  _showMatchFound: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    var config = this._searchConfig;
    c.innerHTML = '<div class="bl-arena-searching">' +
      '<div class="bl-arena-searching-icon" style="font-size:3rem">🎉</div>' +
      '<h2>Match Found!</h2>' +
      '<p style="font-size:1rem;font-weight:600;margin:8px 0">' + BrainLab.escape(this._userName()) + ' vs ' + BrainLab.escape(this._opponentName || 'Opponent') + '</p>' +
      '<div class="bl-arena-searching-config">' +
        '<span>❓ ' + (config.questionCount || 10) + ' Questions</span>' +
        '<span>📝 ' + BrainLab.escape(config.exam || 'All') + '</span>' +
        '<span>📂 ' + BrainLab.escape(config.category || 'All') + '</span>' +
        '<span>📊 ' + BrainLab.escape(config.difficulty || 'Mixed') + '</span>' +
      '</div>' +
      '<p class="bl-arena-searching-hint">Preparing Arena lobby...</p>' +
      '<div class="bl-arena-spinner"></div>' +
    '</div>';
  },

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
    this._lobbyChannel.track(this._presencePayload({ status: 'searching' }));
    this._startSearchTimeout();
    this._showSearching();
    this._pollMatchmaking();
  },

  _showLobby: function() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._searchTimeout) { clearTimeout(this._searchTimeout); this._searchTimeout = null; }

    var s = this;
    var client = this._client();
    var matchChannelName = 'arena-match-' + this._matchId;

    console.log('[ArenaMatch] MATCH_READY — lobby', { matchId: this._matchId });

    if (this._matchChannel) { try { client.removeChannel(this._matchChannel); } catch(e) {} }

    this._matchChannel = client.channel(matchChannelName, {
      config: { presence: { key: this._userId() } }
    });

    this._matchChannel.on('broadcast', { event: 'ready' }, function(msg) {
      console.log('[ArenaMatch] Opponent ready');
      s._opponentReady = true; s._updateLobbyOpponentReady(); s._checkBothReady();
    });
    this._matchChannel.on('broadcast', { event: 'progress' }, function(msg) { s._onOpponentProgress(msg.payload); });
    this._matchChannel.on('broadcast', { event: 'leave' }, function(msg) { s._onOpponentLeave(); });
    this._matchChannel.on('broadcast', { event: 'battle_start' }, function(msg) { s._startBattle(); });

    this._matchChannel.track({ userId: this._userId(), name: this._userName(), status: 'in_lobby', timestamp: Date.now() });
    this._matchChannel.subscribe(function(status) {
      if (status === 'SUBSCRIBED') console.log('[ArenaMatch] ✅ Subscribed to match channel:', matchChannelName);
    });

    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    var config = this._searchConfig;
    c.innerHTML = '<div class="bl-arena-lobby">' +
      '<h2 class="bl-arena-lobby-title">⚔️ Arena Lobby</h2>' +
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

  setReady: function() {
    if (this._myReady) return;
    this._myReady = true;
    var btn = document.getElementById('bl-arena-ready-btn');
    if (btn) { btn.textContent = '✓ Ready'; btn.disabled = true; btn.classList.add('ready'); }
    var st = document.getElementById('bl-arena-my-ready');
    if (st) { st.textContent = '🟢 Ready'; st.classList.add('ready'); }
    if (this._matchChannel) {
      try { this._matchChannel.send({ type: 'broadcast', event: 'ready', payload: { userId: this._userId() } }); } catch(e) {}
    }
    console.log('[ArenaMatch] Player ready');
    this._checkBothReady();
  },

  _updateLobbyOpponentReady: function() {
    var st = document.getElementById('bl-arena-opp-ready');
    if (st) { st.textContent = '🟢 Ready'; st.classList.add('ready'); }
  },

  _checkBothReady: function() {
    if (this._myReady && this._opponentReady) this._startCountdown();
  },

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
        if (s._matchChannel) { try { s._matchChannel.send({ type: 'broadcast', event: 'battle_start', payload: { timestamp: Date.now() } }); } catch(e) {} }
        s._startBattle();
      }
    }, 1000);
  },

  _startBattle: function() {
    console.log('[ArenaMatch] MATCH_STARTED');
    this._myStatus = 'in_battle';
    this._myScore = 0; this._opponentScore = 0;
    this._iFinished = false; this._opponentFinished = false;
    this._battleStartTime = Date.now();

    if (!this._questions || !this._questions.length) {
      console.error('[ArenaMatch] No questions! Generating locally...');
      this._generateQuestions();
    }

    this._installBattleHooks();

    BrainLab._currentQuiz = { questions: this._questions };
    BrainLab._answers = [];
    BrainLab._currentQIdx = 0;
    BrainLab._startTime = Date.now();
    BrainLab._sessionMeta = {
      id: this._matchId, mode: 'arena_1v1',
      title: 'Arena 1v1 Battle vs ' + (this._opponentName || 'Opponent'),
      category: this._searchConfig.category || 'All',
      exam: this._searchConfig.exam || 'All',
      difficulty: this._searchConfig.difficulty || 'mixed',
      total_questions: this._questions.length,
      started_at: new Date().toISOString(), opponent: this._opponentName
    };

    BrainLab._renderQuestion();
    BrainLab.showPlayer();
    this._addBattleOverlay();
  },

  _installBattleHooks: function() {
    var s = this;
    this._origSelectAnswer = BrainLab.selectAnswer;
    this._origFinishQuiz = BrainLab._finishQuiz;
    this._origNextQuestion = BrainLab.nextQuestion;
    this._origQuitQuiz = BrainLab.quitQuiz;
    this._origExitQuiz = BrainLab.exitQuiz;

    BrainLab.selectAnswer = function(optIdx) {
      s._origSelectAnswer.call(BrainLab, optIdx);
      if (BrainLab._answers[BrainLab._currentQIdx]) {
        if (BrainLab._answers[BrainLab._currentQIdx].isCorrect) s._myScore++;
        if (s._matchChannel) {
          try { s._matchChannel.send({ type: 'broadcast', event: 'progress', payload: { userId: s._userId(), currentQuestion: BrainLab._currentQIdx + 1, totalQuestions: s._questions.length, score: s._myScore, finished: false } }); } catch(e) {}
        }
        s._updateBattleOverlay();
      }
    };

    BrainLab.nextQuestion = function() { s._origNextQuestion.call(BrainLab); s._updateBattleOverlay(); };

    BrainLab._finishQuiz = function() {
      s._iFinished = true;
      if (s._matchChannel) {
        try { s._matchChannel.send({ type: 'broadcast', event: 'progress', payload: { userId: s._userId(), currentQuestion: s._questions.length, totalQuestions: s._questions.length, score: s._myScore, finished: true } }); } catch(e) {}
      }
      if (s._opponentFinished) { s._showArenaResults(); } else { s._showWaitingForOpponent(); }
    };

    BrainLab.quitQuiz = function() {
      if (s._matchChannel) { try { s._matchChannel.send({ type: 'broadcast', event: 'leave', payload: { userId: s._userId() } }); } catch(e) {} }
      s._uninstallBattleHooks(); s._cleanup(); s._origQuitQuiz.call(BrainLab);
    };

    BrainLab.exitQuiz = function() {
      if (s._matchChannel) { try { s._matchChannel.send({ type: 'broadcast', event: 'leave', payload: { userId: s._userId() } }); } catch(e) {} }
      s._uninstallBattleHooks(); s._cleanup(); s._origExitQuiz.call(BrainLab);
    };
  },

  _uninstallBattleHooks: function() {
    if (this._origSelectAnswer) BrainLab.selectAnswer = this._origSelectAnswer;
    if (this._origFinishQuiz) BrainLab._finishQuiz = this._origFinishQuiz;
    if (this._origNextQuestion) BrainLab.nextQuestion = this._origNextQuestion;
    if (this._origQuitQuiz) BrainLab.quitQuiz = this._origQuitQuiz;
    if (this._origExitQuiz) BrainLab.exitQuiz = this._origExitQuiz;
    this._origSelectAnswer = null; this._origFinishQuiz = null; this._origNextQuestion = null;
    this._origQuitQuiz = null; this._origExitQuiz = null;
  },

  _addBattleOverlay: function() {
    var existing = document.getElementById('bl-arena-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'bl-arena-overlay';
    overlay.className = 'bl-arena-overlay';
    overlay.innerHTML = '<div class="bl-arena-ov-left"><span class="bl-arena-ov-name">' + BrainLab.escape(this._userName()) + '</span><span class="bl-arena-ov-score" id="bl-arena-my-score">0</span></div><div class="bl-arena-ov-center">VS</div><div class="bl-arena-ov-right"><span class="bl-arena-ov-name">' + BrainLab.escape(this._opponentName || 'Opponent') + '</span><span class="bl-arena-ov-score" id="bl-arena-opp-score">0</span></div>';
    var player = document.getElementById('bl-quiz-player-area');
    if (player) player.insertBefore(overlay, player.firstChild);
  },

  _updateBattleOverlay: function() {
    var myEl = document.getElementById('bl-arena-my-score');
    if (myEl) myEl.textContent = this._myScore;
    var oppEl = document.getElementById('bl-arena-opp-score');
    if (oppEl) oppEl.textContent = this._opponentScore;
  },

  _onOpponentProgress: function(payload) {
    if (payload.finished) {
      this._opponentFinished = true;
      this._opponentScore = payload.score || 0;
      this._updateBattleOverlay();
      if (this._iFinished) this._showArenaResults();
    } else {
      this._opponentScore = payload.score || 0;
      this._updateBattleOverlay();
    }
  },

  _onOpponentLeave: function() {
    console.log('[ArenaMatch] Opponent left');
    if (this._myStatus === 'in_battle' && !this._iFinished) this._showForfeitWin();
    else if (this._myStatus === 'in_lobby') this._showOpponentLeftLobby();
  },

  _showWaitingForOpponent: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-waiting"><div class="bl-arena-waiting-icon">⏳</div><h2>Battle Complete!</h2><p>Your score: <strong>' + this._myScore + '/' + this._questions.length + '</strong></p><p class="bl-arena-waiting-text">Waiting for opponent to finish...</p><div class="bl-arena-spinner"></div></div>';
    c.style.display = 'block';
  },

  _showArenaResults: function() {
    console.log('[ArenaMatch] MATCH_COMPLETED', { myScore: this._myScore, oppScore: this._opponentScore });
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
    c.innerHTML = '<div class="bl-arena-results ' + resultClass + '"><h2 class="bl-arena-results-title">' + resultText + '</h2><div class="bl-arena-results-players"><div class="bl-arena-results-player ' + (isWin ? 'winner' : '') + '"><div class="bl-arena-results-avatar">' + this._userAvatar() + '</div><div class="bl-arena-results-name">' + BrainLab.escape(this._userName()) + '</div><div class="bl-arena-results-score">' + this._myScore + '/' + total + '</div><div class="bl-arena-results-pct">' + myPct + '%</div></div><div class="bl-arena-results-vs">VS</div><div class="bl-arena-results-player ' + (!isWin && !isTie ? 'winner' : '') + '"><div class="bl-arena-results-avatar">👤</div><div class="bl-arena-results-name">' + BrainLab.escape(this._opponentName || 'Opponent') + '</div><div class="bl-arena-results-score">' + this._opponentScore + '/' + total + '</div><div class="bl-arena-results-pct">' + oppPct + '%</div></div></div><div class="bl-arena-results-actions"><button class="bl-arena-results-rematch" onclick="ArenaMatch._rematch()">Rematch</button><button class="bl-arena-results-exit" onclick="ArenaMatch._exitToArena()">Back to Arena</button></div></div>';
    c.style.display = 'block';
    c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this._saveMatchResult(isWin, isTie);
    this._uninstallBattleHooks();
  },

  _showForfeitWin: function() {
    console.log('[ArenaMatch] Opponent forfeited');
    this._myStatus = 'completed';
    this._uninstallBattleHooks();
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-results bl-arena-result-win"><h2 class="bl-arena-results-title">You Won! 🏆</h2><p class="bl-arena-forfeit-text">Your opponent left the match.</p><div class="bl-arena-results-actions"><button class="bl-arena-results-exit" onclick="ArenaMatch._exitToArena()">Back to Arena</button></div></div>';
    c.style.display = 'block';
    this._saveMatchResult(true, false);
  },

  _showOpponentLeftLobby: function() {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-searching"><div class="bl-arena-searching-icon">👋</div><h2>Opponent left the lobby</h2><p class="bl-arena-searching-hint">Your opponent disconnected before the match started.</p><button class="bl-arena-cancel-btn" onclick="ArenaMatch._exitToArena()">Back to Arena</button></div>';
    c.style.display = 'block';
  },

  _saveMatchResult: function(isWin, isTie) {
    try {
      var session = {
        id: this._matchId, mode: 'arena_1v1',
        title: 'Arena Battle vs ' + (this._opponentName || 'Opponent'),
        category: this._searchConfig.category || 'All', exam: this._searchConfig.exam || 'All',
        difficulty: this._searchConfig.difficulty || 'mixed',
        total_questions: this._questions.length, correct_count: this._myScore,
        wrong_count: this._questions.length - this._myScore, skipped_count: 0,
        score: Math.round((this._myScore / this._questions.length) * 100),
        time_taken: Math.floor((Date.now() - this._battleStartTime) / 1000),
        started_at: new Date(this._battleStartTime).toISOString(), completed_at: new Date().toISOString(),
        opponent: this._opponentName, result: isTie ? 'tie' : (isWin ? 'win' : 'lose')
      };
      BrainLab.saveSession(session); BrainLab.markStreak(); BrainLab.renderStats();
    } catch(e) { console.error('[ArenaMatch] Save error:', e); }
    this._persistMatchResult(isWin, isTie);
  },

  _persistMatchResult: function(isWin, isTie) {
    var client = this._client();
    if (!client) return;
    var winnerId = isTie ? null : (isWin ? this._userId() : this._opponentId);
    try {
      client.from('arena_matches').upsert({
        id: this._matchId, player1_id: this._userId(), player2_id: this._opponentId,
        player1_name: this._userName(), player2_name: this._opponentName,
        status: 'completed', config: this._searchConfig, question_count: this._questions.length,
        player1_score: this._myScore, player2_score: this._opponentScore,
        winner_id: winnerId, completed_at: new Date().toISOString()
      }).then(function(r) { console.log('[ArenaMatch] Result persisted'); }).catch(function(e) {});
    } catch(e) {}
  },

  _rematch: function() { this._cleanup(); this.startSearch(this._searchConfig); },
  _exitToArena: function() { this._cleanup(); this._uninstallBattleHooks(); BrainLab.hidePlayer(); BrainLab.navigate('practice'); },

  leaveMatch: function() {
    if (!confirm('Leave this match?')) return;
    console.log('[ArenaMatch] MATCH_CANCELLED — leaving');
    if (this._matchChannel) { try { this._matchChannel.send({ type: 'broadcast', event: 'leave', payload: { userId: this._userId() } }); } catch(e) {} }
    this._uninstallBattleHooks(); this._cleanup();
    BrainLab.hidePlayer(); BrainLab.navigate('practice');
  },

  _showError: function(msg) {
    var c = document.getElementById('bl-quiz-player-area');
    if (!c) return;
    c.innerHTML = '<div class="bl-arena-searching"><div class="bl-arena-searching-icon">⚠️</div><h2>' + BrainLab.escape(msg) + '</h2><button class="bl-arena-cancel-btn" onclick="ArenaMatch._exitToArena()">Back to Arena</button></div>';
    c.style.display = 'block';
  },

  _cleanup: function() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._searchTimeout) { clearTimeout(this._searchTimeout); this._searchTimeout = null; }
    var client = this._client();
    if (client) {
      if (this._lobbyChannel) { try { client.removeChannel(this._lobbyChannel); } catch(e) {} this._lobbyChannel = null; }
      if (this._matchChannel) { try { client.removeChannel(this._matchChannel); } catch(e) {} this._matchChannel = null; }
    }
    this._subscribed = false; this._myStatus = 'idle';
    this._myReady = false; this._opponentReady = false;
    this._matchId = null; this._opponentId = null; this._opponentName = null;
    this._questions = null; this._iFinished = false; this._opponentFinished = false;
  }
};
