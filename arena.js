/* ════════════════════════════════════════════════════════════════════
   ARENA.JS — Studyria Competitive Learning Arena
   Complete Engine: State Machine, Matchmaking, Battle, Scoring, Results
   ════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  if (window.ARENA && window.ARENA._version) return;

  // ── VERSION ──────────────────────────────────────────────────────
  const ARENA_VERSION = '1.0.0';

  // ── STATE ────────────────────────────────────────────────────────
  const state = {
    // Match state machine
    phase: 'IDLE', // IDLE | SEARCHING | MATCH_FOUND | READY | ACTIVE | FINALIZING | FINALIZED | ERROR

    // Player profile (cached)
    player: null,

    // Match configuration
    config: {
      mode: '1v1',
      questionCount: 10,
      exam: 'general',
      category: 'general',
      difficulty: 'medium'
    },

    // Current match
    match: null,

    // Questions for current match
    questions: [],

    // Current question index
    qIndex: 0,

    // Player answers for current match
    answers: [],

    // Timer
    timer: null,
    timerSeconds: 30,
    timerRemaining: 30,

    // Scores
    playerScore: 0,
    opponentScore: 0,

    // Opponent state
    opponent: null,
    opponentAnswers: [],

    // Finalization guard
    finalized: false,

    // Matchmaking
    matchmakingTimer: null,
    matchmakingStart: 0,
    matchmakingInterval: null,

    // Sound settings
    sound: {
      sfx: true,
      music: true,
      notifications: true,
      volume: 0.5
    },

    // Leaderboard cache
    leaderboard: [],

    // History cache
    history: [],

    // Active tab
    activeTab: 'lobby'
  };

  // ── CONSTANTS ────────────────────────────────────────────────────
  const MATCHMAKING_TIMEOUT = 50000; // 50 seconds
  const QUESTION_TIME = 30; // 30 seconds per question
  const BASE_POINTS = 10; // Base points per correct answer
  const SPEED_BONUS_MAX = 5; // Max speed bonus
  const DEFAULT_RATING = 1000;
  const K_FACTOR = 32; // Elo K-factor

  // 8 Permanent Assamese Opponents (in-memory cache; loaded from Supabase)
  let _opponentsCache = null;

  // ── SUPABASE HELPER ───────────────────────────────────────────────
  function sb() {
    return window.supabaseClient;
  }

  function uid() {
    if (!sb()) return null;
    const session = sb().auth?.session?.() || sb().auth?.getSession?.();
    if (session && session.user) return session.user.id;
    // Fallback: check currentUser
    if (window.currentUser && window.currentUser.id) return window.currentUser.id;
    return null;
  }

  async function getUid() {
    const c = sb();
    if (!c) return null;
    try {
      const { data } = await c.auth.getUser();
      return data?.user?.id || null;
    } catch(e) {
      return window.currentUser?.id || null;
    }
  }

  // ── SOUND ─────────────────────────────────────────────────────────
  let _audioCtx = null;
  function playSound(type) {
    if (!state.sound.sfx) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const vol = state.sound.volume;

      const sounds = {
        correct: { freq: 880, dur: 0.15, type: 'sine' },
        wrong: { freq: 220, dur: 0.2, type: 'sawtooth' },
        timeout: { freq: 440, dur: 0.15, type: 'triangle' },
        match: { freq: 660, dur: 0.3, type: 'sine' },
        victory: [{ freq: 523, dur: 0.15 }, { freq: 659, dur: 0.15 }, { freq: 784, dur: 0.3 }],
        defeat: [{ freq: 440, dur: 0.2 }, { freq: 330, dur: 0.3 }],
        countdown: { freq: 880, dur: 0.1, type: 'square' },
        tick: { freq: 1200, dur: 0.05, type: 'sine' }
      };

      const s = sounds[type];
      if (!s) return;

      if (Array.isArray(s)) {
        s.forEach((note, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = note.freq;
          gain.gain.value = vol * 0.3;
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.15);
          osc.stop(ctx.currentTime + i * 0.15 + note.dur);
        });
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = s.type || 'sine';
        osc.frequency.value = s.freq;
        gain.gain.value = vol * 0.3;
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + s.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + s.dur);
      }
    } catch(e) { /* audio not available */ }
  }

  // ── PLAYER PROFILE ────────────────────────────────────────────────
  async function loadPlayerProfile() {
    const userId = await getUid();
    if (!userId) {
      state.player = null;
      return null;
    }

    try {
      const c = sb();
      if (!c) return null;

      // Try to get existing arena profile
      const { data, error } = await c.from('arena_players')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (data) {
        // Migrate old data — ensure all fields are valid
        state.player = sanitizePlayer(data);
        return state.player;
      }

      // Create new profile
      // Get display name from auth user or profiles table
      let displayName = 'Player';
      try {
        const { data: authData } = await c.auth.getUser();
        if (authData?.user?.email) {
          displayName = authData.user.email.split('@')[0].replace(/[._]/g, ' ');
          displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
        }
      } catch(_) {}

      const newProfile = {
        user_id: userId,
        display_name: displayName,
        rating: DEFAULT_RATING,
        rating_peak: DEFAULT_RATING,
        wins: 0, losses: 0, draws: 0, battles: 0,
        current_streak: 0, best_streak: 0,
        total_questions: 0, correct_answers: 0, wrong_answers: 0, timeout_answers: 0,
        recent_form: ''
      };

      const { data: inserted, error: insertError } = await c.from('arena_players')
        .insert(newProfile)
        .select()
        .single();

      if (inserted) {
        state.player = sanitizePlayer(inserted);
      } else {
        // Fallback to in-memory
        state.player = sanitizePlayer({ ...newProfile, id: 'local-' + userId });
      }
      return state.player;
    } catch(e) {
      // Fallback: try localStorage
      const localKey = 'arena_player_' + userId;
      const local = localStorage.getItem(localKey);
      if (local) {
        state.player = sanitizePlayer(JSON.parse(local));
        return state.player;
      }
      // Create minimal in-memory profile
      state.player = sanitizePlayer({
        user_id: userId,
        display_name: 'Player',
        rating: DEFAULT_RATING,
        wins: 0, losses: 0, draws: 0, battles: 0,
        current_streak: 0, best_streak: 0,
        total_questions: 0, correct_answers: 0, wrong_answers: 0, timeout_answers: 0,
        recent_form: ''
      });
      return state.player;
    }
  }

  function sanitizePlayer(raw) {
    const p = raw || {};
    return {
      id: p.id || null,
      user_id: p.user_id,
      display_name: p.display_name || 'Player',
      avatar_url: p.avatar_url || null,
      rating: Number(p.rating) || DEFAULT_RATING,
      rating_peak: Number(p.rating_peak) || DEFAULT_RATING,
      wins: Number(p.wins) || 0,
      losses: Number(p.losses) || 0,
      draws: Number(p.draws) || 0,
      battles: Number(p.battles) || 0,
      current_streak: Number(p.current_streak) || 0,
      best_streak: Number(p.best_streak) || 0,
      total_questions: Number(p.total_questions) || 0,
      correct_answers: Number(p.correct_answers) || 0,
      wrong_answers: Number(p.wrong_answers) || 0,
      timeout_answers: Number(p.timeout_answers) || 0,
      recent_form: p.recent_form || ''
    };
  }

  function getWinRate() {
    if (!state.player || state.player.battles === 0) return 0;
    return Math.round((state.player.wins / state.player.battles) * 100);
  }

  function getAccuracy() {
    if (!state.player || state.player.total_questions === 0) return 0;
    return Math.round((state.player.correct_answers / state.player.total_questions) * 100);
  }

  // ── OPPONENTS (8 Permanent Assamese) ──────────────────────────────
  async function loadOpponents() {
    if (_opponentsCache) return _opponentsCache;

    // Fallback in-memory opponents (used if Supabase is unavailable)
    const fallback = [
      { opponent_key: 'junali_saikia', name: 'Junali Saikia', gender: 'female', rating: 1088, rating_peak: 1156, wins: 34, losses: 18, draws: 4, battles: 56, current_streak: 3, best_streak: 7, accuracy: 0.78, avg_score: 62.5, avg_response_ms: 7200, recent_form: 'WWLWWLWWWW', strengths: ['Geography','History','Polity'], weaknesses: ['Quantitative Aptitude','Economics'] },
      { opponent_key: 'mousumi_das', name: 'Mousumi Das', gender: 'female', rating: 1024, rating_peak: 1080, wins: 22, losses: 20, draws: 3, battles: 45, current_streak: 1, best_streak: 4, accuracy: 0.68, avg_score: 48.0, avg_response_ms: 9500, recent_form: 'WLWLDWLWWL', strengths: ['Current Affairs','General Science'], weaknesses: ['History','Geography'] },
      { opponent_key: 'rupali_borah', name: 'Rupali Borah', gender: 'female', rating: 965, rating_peak: 1010, wins: 15, losses: 24, draws: 2, battles: 41, current_streak: 0, best_streak: 3, accuracy: 0.62, avg_score: 38.5, avg_response_ms: 11000, recent_form: 'LLWLDWLLWL', strengths: ['Assam History','English'], weaknesses: ['Mathematics','Polity'] },
      { opponent_key: 'anjali_kalita', name: 'Anjali Kalita', gender: 'female', rating: 1142, rating_peak: 1205, wins: 41, losses: 12, draws: 5, battles: 58, current_streak: 5, best_streak: 9, accuracy: 0.84, avg_score: 71.0, avg_response_ms: 6800, recent_form: 'WWWWWLWWWW', strengths: ['Polity','Economics','Current Affairs'], weaknesses: ['Geography'] },
      { opponent_key: 'arup_das', name: 'Arup Das', gender: 'male', rating: 1050, rating_peak: 1098, wins: 28, losses: 16, draws: 3, battles: 47, current_streak: 2, best_streak: 6, accuracy: 0.74, avg_score: 55.0, avg_response_ms: 7800, recent_form: 'WWLWWWLWLW', strengths: ['Mathematics','Geography','General Science'], weaknesses: ['English'] },
      { opponent_key: 'bhaskar_gogoi', name: 'Bhaskar Gogoi', gender: 'male', rating: 998, rating_peak: 1045, wins: 20, losses: 22, draws: 2, battles: 44, current_streak: 0, best_streak: 3, accuracy: 0.66, avg_score: 44.0, avg_response_ms: 9000, recent_form: 'WLLWLDWLWW', strengths: ['History','Assam Culture'], weaknesses: ['Quantitative Aptitude','Economics'] },
      { opponent_key: 'dipankar_saikia', name: 'Dipankar Saikia', gender: 'male', rating: 920, rating_peak: 980, wins: 12, losses: 28, draws: 1, battles: 41, current_streak: 0, best_streak: 2, accuracy: 0.58, avg_score: 32.0, avg_response_ms: 12000, recent_form: 'LLWLLWLLWL', strengths: ['English','Current Affairs'], weaknesses: ['Mathematics','Geography','Polity'] },
      { opponent_key: 'pranjal_borah', name: 'Pranjal Borah', gender: 'male', rating: 1115, rating_peak: 1178, wins: 38, losses: 14, draws: 4, battles: 56, current_streak: 4, best_streak: 8, accuracy: 0.82, avg_score: 68.0, avg_response_ms: 7000, recent_form: 'WWWWLWWWLW', strengths: ['Economics','Polity','Current Affairs'], weaknesses: ['Assam History'] }
    ];

    try {
      const c = sb();
      if (!c) { _opponentsCache = fallback; return fallback; }

      const { data, error } = await c.from('arena_opponents')
        .select('*')
        .eq('is_active', true)
        .order('rating', { ascending: false });

      if (data && data.length > 0) {
        _opponentsCache = data.map(o => ({
          ...o,
          strengths: typeof o.strengths === 'string' ? JSON.parse(o.strengths) : (o.strengths || []),
          weaknesses: typeof o.weaknesses === 'string' ? JSON.parse(o.weaknesses) : (o.weaknesses || [])
        }));
        return _opponentsCache;
      }
    } catch(e) { /* use fallback */ }

    _opponentsCache = fallback;
    return _opponentsCache;
  }

  function pickOpponent(playerRating) {
    const opponents = _opponentsCache || [];
    if (opponents.length === 0) return null;

    // Find opponent with closest rating to player
    // Add some randomness for variety
    const sorted = [...opponents].sort((a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating));

    // Pick from top 4 closest, weighted toward closer
    const pool = sorted.slice(0, Math.min(4, sorted.length));
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  function pickOpponentsForTeam(playerRating, count, excludeKeys) {
    const opponents = _opponentsCache || [];
    const excluded = new Set(excludeKeys || []);
    const available = opponents.filter(o => !excluded.has(o.opponent_key));

    const sorted = [...available].sort((a, b) => Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating));

    // Pick variety of ratings
    const picked = [];
    const poolSize = Math.min(count * 2, sorted.length);
    const pool = sorted.slice(0, poolSize);

    for (let i = 0; i < count && pool.length > 0; ) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool[idx]);
      pool.splice(idx, 1);
      i++;
    }

    // Fill from remaining if needed
    while (picked.length < count && available.length > 0) {
      const remaining = available.filter(o => !picked.includes(o) && !excluded.has(o.opponent_key));
      if (remaining.length === 0) break;
      picked.push(remaining[Math.floor(Math.random() * remaining.length)]);
    }

    return picked;
  }

  // ── QUESTIONS ─────────────────────────────────────────────────────
  async function loadQuestions(count, exam, category, difficulty) {
    try {
      const c = sb();
      if (!c) return getFallbackQuestions(count);

      let query = c.from('arena_questions').select('*').eq('is_active', true);

      if (difficulty && difficulty !== 'mixed') {
        query = query.eq('difficulty', difficulty);
      }

      // Try to filter by exam/category
      if (exam && exam !== 'general') {
        query = query.eq('exam', exam);
      }

      const { data, error } = await query.limit(count * 2);

      if (data && data.length >= count) {
        // Shuffle and pick
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map(q => ({
          id: q.id,
          text: q.question_text,
          options: [q.option_a, q.option_b, q.option_c, q.option_d],
          correct: q.correct_answer,
          explanation: q.explanation || null,
          category: q.category,
          topic: q.topic,
          difficulty: q.difficulty
        }));
      }

      // If not enough filtered questions, try without filters
      const { data: allData } = await c.from('arena_questions').select('*').eq('is_active', true).limit(count * 3);
      if (allData && allData.length > 0) {
        const shuffled = [...allData].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map(q => ({
          id: q.id,
          text: q.question_text,
          options: [q.option_a, q.option_b, q.option_c, q.option_d],
          correct: q.correct_answer,
          explanation: q.explanation || null,
          category: q.category,
          topic: q.topic,
          difficulty: q.difficulty
        }));
      }

      return getFallbackQuestions(count);
    } catch(e) {
      return getFallbackQuestions(count);
    }
  }

  function getFallbackQuestions(count) {
    const pool = [
      { text: 'Which is the largest river island in the world?', options: ['Majuli', 'Umananda', 'Poa', 'Dibru-Saikhowa'], correct: 0, explanation: 'Majuli is recognized by Guinness World Records as the largest river island in the world.', category: 'Geography', difficulty: 'easy' },
      { text: 'When was the Battle of Saraighat fought?', options: ['1571', '1671', '1771', '1871'], correct: 1, explanation: 'The Battle of Saraighat was fought in 1671.', category: 'History', difficulty: 'medium' },
      { text: 'How many seats are there in the Assam Legislative Assembly?', options: ['116', '126', '136', '146'], correct: 1, explanation: 'The Assam Legislative Assembly has 126 seats.', category: 'Polity', difficulty: 'medium' },
      { text: 'Which National Park in Assam is famous for one-horned rhinoceros?', options: ['Dibru-Saikhowa', 'Kaziranga', 'Manas', 'Nameri'], correct: 1, explanation: 'Kaziranga National Park is a UNESCO World Heritage Site.', category: 'Geography', difficulty: 'easy' },
      { text: 'What is the capital of Assam?', options: ['Guwahati', 'Jorhat', 'Dispur', 'Dibrugarh'], correct: 2, explanation: 'Dispur is the capital of Assam.', category: 'Geography', difficulty: 'easy' },
      { text: 'What is the primary agricultural product of Assam?', options: ['Wheat', 'Tea', 'Rice', 'Sugarcane'], correct: 1, explanation: 'Assam is one of the largest tea-producing states in India.', category: 'Economics', difficulty: 'easy' },
      { text: 'Which dynasty ruled Assam for nearly 600 years?', options: ['Koch Dynasty', 'Ahom Dynasty', 'Kachari Dynasty', 'Chutia Dynasty'], correct: 1, explanation: 'The Ahom Dynasty ruled Assam for nearly 600 years (1228-1826).', category: 'History', difficulty: 'medium' },
      { text: 'Which festival is celebrated as the harvest festival of Assam?', options: ['Bihu', 'Durga Puja', 'Diwali', 'Holi'], correct: 0, explanation: 'Bihu is the major harvest festival of Assam.', category: 'Assam Culture', difficulty: 'easy' },
      { text: 'What is the chemical symbol for Gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correct: 2, explanation: 'The chemical symbol for Gold is Au, from Latin "Aurum".', category: 'Science', difficulty: 'easy' },
      { text: 'Which vitamin is produced when skin is exposed to sunlight?', options: ['Vitamin A', 'Vitamin B', 'Vitamin C', 'Vitamin D'], correct: 3, explanation: 'Vitamin D is synthesized in the skin upon exposure to sunlight.', category: 'Science', difficulty: 'easy' },
      { text: 'What is the SI unit of force?', options: ['Joule', 'Watt', 'Newton', 'Pascal'], correct: 2, explanation: 'The SI unit of force is the Newton (N).', category: 'Science', difficulty: 'medium' },
      { text: 'Choose the correct synonym for "Ephemeral":', options: ['Eternal', 'Short-lived', 'Powerful', 'Beautiful'], correct: 1, explanation: 'Ephemeral means lasting for a very short time.', category: 'English', difficulty: 'medium' },
      { text: 'If the simple interest on Rs. 1000 for 2 years at 5% per annum, what is the interest?', options: ['Rs. 50', 'Rs. 100', 'Rs. 150', 'Rs. 200'], correct: 1, explanation: 'SI = P × R × T / 100 = 1000 × 5 × 2 / 100 = Rs. 100.', category: 'Mathematics', difficulty: 'easy' },
      { text: 'What is the value of log₁₀(100)?', options: ['1', '2', '10', '100'], correct: 1, explanation: 'log₁₀(100) = 2 because 10² = 100.', category: 'Mathematics', difficulty: 'easy' },
      { text: 'Who is the executive head of an Indian state?', options: ['Chief Minister', 'Governor', 'President', 'Prime Minister'], correct: 1, explanation: 'The Governor is the executive head of a state in India.', category: 'Polity', difficulty: 'easy' }
    ];

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  // ── OPPONENT SIMULATION ENGINE ────────────────────────────────────
  function simulateOpponentAnswer(question, opponent) {
    if (!question || !opponent) return { selected: 0, isCorrect: false, responseMs: 15000 };

    const baseAccuracy = opponent.accuracy || 0.7;

    // Adjust accuracy based on difficulty
    let adjustedAccuracy = baseAccuracy;
    if (question.difficulty === 'easy') adjustedAccuracy += 0.05;
    if (question.difficulty === 'hard') adjustedAccuracy -= 0.15;

    // Adjust based on strengths/weaknesses
    const topic = (question.topic || '').toLowerCase();
    const category = (question.category || '').toLowerCase();
    const strengths = (opponent.strengths || []).map(s => s.toLowerCase());
    const weaknesses = (opponent.weaknesses || []).map(w => w.toLowerCase());

    if (strengths.some(s => topic.includes(s) || category.includes(s))) {
      adjustedAccuracy += 0.1;
    }
    if (weaknesses.some(w => topic.includes(w) || category.includes(w))) {
      adjustedAccuracy -= 0.1;
    }

    // Clamp
    adjustedAccuracy = Math.max(0.2, Math.min(0.95, adjustedAccuracy));

    // Determine if correct
    const isCorrect = Math.random() < adjustedAccuracy;

    // Pick answer
    let selected;
    if (isCorrect) {
      selected = question.correct;
    } else {
      // Pick a wrong answer
      const wrong = [0, 1, 2, 3].filter(i => i !== question.correct);
      selected = wrong[Math.floor(Math.random() * wrong.length)];
    }

    // Response time based on opponent's avg_response_ms with variation
    const baseTime = opponent.avg_response_ms || 8000;
    const variation = 0.5; // ±50%
    const responseMs = Math.round(baseTime * (1 + (Math.random() * 2 - 1) * variation));
    const clampedMs = Math.max(2000, Math.min(QUESTION_TIME * 1000 - 500, responseMs));

    return { selected, isCorrect, responseMs: clampedMs };
  }

  function simulateOpponentScore(questions, opponent) {
    let score = 0;
    const answers = questions.map(q => {
      const result = simulateOpponentAnswer(q, opponent);
      if (result.isCorrect) {
        // Opponent gets base points + partial speed bonus
        const speedFraction = 1 - (result.responseMs / (QUESTION_TIME * 1000));
        const speedBonus = Math.round(SPEED_BONUS_MAX * speedFraction);
        score += BASE_POINTS + speedBonus;
      }
      return result;
    });
    return { score, answers };
  }

  // ── SCORING ───────────────────────────────────────────────────────
  function calculateScore(isCorrect, responseMs) {
    if (!isCorrect) return 0;
    const speedFraction = 1 - (responseMs / (QUESTION_TIME * 1000));
    const speedBonus = Math.max(0, Math.round(SPEED_BONUS_MAX * speedFraction));
    return BASE_POINTS + speedBonus;
  }

  // ── ELO RATING ────────────────────────────────────────────────────
  function calculateElo(playerRating, opponentRating, result) {
    // result: 1 = win, 0.5 = draw, 0 = loss
    const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    const change = Math.round(K_FACTOR * (result - expected));
    return {
      change,
      newRating: Math.max(100, playerRating + change)
    };
  }

  // ── MATCH STATE MACHINE ───────────────────────────────────────────
  function setPhase(newPhase) {
    const validTransitions = {
      IDLE: ['SEARCHING', 'ERROR'],
      SEARCHING: ['MATCH_FOUND', 'ERROR', 'IDLE'],
      MATCH_FOUND: ['READY', 'ACTIVE', 'ERROR', 'IDLE'],
      READY: ['ACTIVE', 'ERROR', 'IDLE'],
      ACTIVE: ['FINALIZING', 'ERROR'],
      FINALIZING: ['FINALIZED', 'ERROR'],
      FINALIZED: ['IDLE'],
      ERROR: ['IDLE']
    };

    const allowed = validTransitions[state.phase] || [];
    if (!allowed.includes(newPhase)) {
      console.warn(`[ARENA] Invalid transition: ${state.phase} → ${newPhase}`);
      return false;
    }

    state.phase = newPhase;
    return true;
  }

  // ── MATCHMAKING ───────────────────────────────────────────────────
  async function startMatchmaking() {
    if (state.phase !== 'IDLE') return;
    if (!state.player) {
      await loadPlayerProfile();
      if (!state.player) return;
    }

    setPhase('SEARCHING');
    state.matchmakingStart = Date.now();

    const playerRating = state.player.rating;

    // Render searching UI
    renderSearching();

    // Simulate real-player search for 50 seconds
    // In production, this would query arena_matchmaking_queue for compatible players
    // For now, we search for 50 seconds then fall back to AI opponent

    let elapsed = 0;
    const intervalMs = 100;

    state.matchmakingInterval = setInterval(function() {
      elapsed = Date.now() - state.matchmakingStart;

      // Update timer display
      updateSearchTimer(elapsed);

      // Progressive rating window expansion
      const windowSize = 35 + Math.floor(elapsed / 5000) * 15; // +15 every 5 seconds

      // Check if we should match (after ~3 seconds for minimum search feel)
      if (elapsed >= 3000) {
        // Try to find a real player (placeholder for real matchmaking)
        // In production: query arena_matchmaking_queue for compatible players
        // For now: 10% chance per second after 3s to "find" a player
        // This makes the search feel real before fallback at 50s

        // Actually, we'll go straight to fallback at the right moment
        // to ensure consistent UX
      }

      // 50-second fallback
      if (elapsed >= MATCHMAKING_TIMEOUT) {
        clearInterval(state.matchmakingInterval);
        state.matchmakingInterval = null;
        // Fallback to AI opponent
        matchWithFallback();
      }
    }, intervalMs);
  }

  function cancelMatchmaking() {
    if (state.matchmakingInterval) {
      clearInterval(state.matchmakingInterval);
      state.matchmakingInterval = null;
    }
    setPhase('IDLE');
    renderLobby();
  }

  async function matchWithFallback() {
    const opponents = await loadOpponents();
    const playerRating = state.player.rating;

    if (state.config.mode === '1v1') {
      const opponent = pickOpponent(playerRating);
      if (!opponent) {
        renderError('No opponents available');
        return;
      }
      await startMatch([opponent], 'B');
    } else {
      // Team mode
      const teamSize = parseInt(state.config.mode.split('v')[0]);
      const teamBOpponents = pickOpponentsForTeam(playerRating, teamSize, []);
      await startMatch(teamBOpponents, 'B');
    }
  }

  async function startMatch(opponentTeam, team) {
    // Load questions
    state.questions = await loadQuestions(
      state.config.questionCount,
      state.config.exam,
      state.config.category,
      state.config.difficulty
    );

    if (state.questions.length === 0) {
      renderError('No questions available for this configuration');
      return;
    }

    // Generate unique match key
    const matchKey = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Set up match state
    state.match = {
      matchKey,
      mode: state.config.mode,
      question_count: state.questions.length,
      exam: state.config.exam,
      category: state.config.category,
      difficulty: state.config.difficulty,
      started_at: new Date().toISOString(),
      opponents: opponentTeam
    };

    state.answers = [];
    state.qIndex = 0;
    state.playerScore = 0;
    state.opponentScore = 0;
    state.finalized = false;

    // Simulate opponent answers
    if (state.config.mode === '1v1') {
      const oppResult = simulateOpponentScore(state.questions, opponentTeam[0]);
      state.opponentAnswers = oppResult.answers;
      state.opponentScore = oppResult.score;
      state.opponent = opponentTeam[0];
    } else {
      // Team mode: simulate each opponent
      state.opponentAnswers = opponentTeam.map(opp => simulateOpponentScore(state.questions, opp));
      state.opponentScore = state.opponentAnswers.reduce((sum, r) => sum + r.score, 0);
    }

    // Transition to MATCH_FOUND
    setPhase('MATCH_FOUND');

    // Show VS screen with countdown
    await renderVS();

    // After countdown, transition to ACTIVE
    setPhase('READY');
    setPhase('ACTIVE');

    // Start battle
    renderBattle();
    startTimer();
  }

  // ── TIMER ─────────────────────────────────────────────────────────
  function startTimer() {
    state.timerRemaining = QUESTION_TIME;
    updateTimerDisplay();

    state.timer = setInterval(function() {
      state.timerRemaining--;

      if (state.timerRemaining <= 5 && state.timerRemaining > 0) {
        playSound('tick');
      }

      if (state.timerRemaining <= 0) {
        clearInterval(state.timer);
        state.timer = null;
        handleTimeout();
      }

      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function updateTimerDisplay() {
    const el = document.getElementById('arenaTimer');
    if (el) {
      el.textContent = state.timerRemaining + 's';
      const container = el.closest('.arena-battle-timer');
      if (container) {
        container.classList.remove('warning', 'danger');
        if (state.timerRemaining <= 5) container.classList.add('danger');
        else if (state.timerRemaining <= 10) container.classList.add('warning');
      }
    }
  }

  function updateSearchTimer(elapsed) {
    const remaining = Math.max(0, Math.ceil((MATCHMAKING_TIMEOUT - elapsed) / 1000));
    const timerEl = document.getElementById('arenaSearchTimer');
    if (timerEl) timerEl.textContent = remaining + 's';

    const progressEl = document.getElementById('arenaSearchProgress');
    if (progressEl) {
      const pct = Math.min(100, (elapsed / MATCHMAKING_TIMEOUT) * 100);
      progressEl.style.width = pct + '%';
    }
  }

  // ── ANSWER HANDLING ───────────────────────────────────────────────
  function handleAnswer(optionIndex) {
    // Prevent double submission
    if (state.phase !== 'ACTIVE') return;
    if (state.answers[state.qIndex]) return; // Already answered

    stopTimer();
    const responseMs = (QUESTION_TIME - state.timerRemaining) * 1000;
    const question = state.questions[state.qIndex];
    const isCorrect = optionIndex === question.correct;

    // Calculate points
    const points = calculateScore(isCorrect, responseMs);
    state.playerScore += points;

    // Record answer
    state.answers[state.qIndex] = {
      selected: optionIndex,
      correct: question.correct,
      isCorrect,
      isTimeout: false,
      responseMs,
      points
    };

    // Play sound
    playSound(isCorrect ? 'correct' : 'wrong');

    // Show visual feedback
    showAnswerFeedback(optionIndex, isCorrect, question.correct);

    // Lock options
    document.querySelectorAll('.arena-battle-option').forEach(o => o.classList.add('locked'));

    // Move to next question after delay
    setTimeout(function() {
      state.qIndex++;

      if (state.qIndex >= state.questions.length) {
        finalizeMatch();
      } else {
        renderBattle();
        startTimer();
      }
    }, 1500);
  }

  function handleTimeout() {
    if (state.phase !== 'ACTIVE') return;
    if (state.answers[state.qIndex]) return;

    playSound('timeout');

    const question = state.questions[state.qIndex];

    // Record timeout
    state.answers[state.qIndex] = {
      selected: -1,
      correct: question.correct,
      isCorrect: false,
      isTimeout: true,
      responseMs: QUESTION_TIME * 1000,
      points: 0
    };

    // Show correct answer
    showAnswerFeedback(-1, false, question.correct);
    document.querySelectorAll('.arena-battle-option').forEach(o => o.classList.add('locked'));

    setTimeout(function() {
      state.qIndex++;
      if (state.qIndex >= state.questions.length) {
        finalizeMatch();
      } else {
        renderBattle();
        startTimer();
      }
    }, 2000);
  }

  function showAnswerFeedback(selectedIndex, isCorrect, correctIndex) {
    const options = document.querySelectorAll('.arena-battle-option');

    options.forEach(function(opt, i) {
      if (i === selectedIndex && !isCorrect) {
        opt.classList.add('wrong');
      }
      if (i === correctIndex) {
        opt.classList.add('correct');
      }
      if (i === selectedIndex && isCorrect) {
        opt.classList.add('selected');
      }
    });
  }

  // ── FINALIZATION ──────────────────────────────────────────────────
  async function finalizeMatch() {
    // Idempotency guard
    if (state.finalized) return;
    state.finalized = true;

    setPhase('FINALIZING');

    const playerScore = state.playerScore;
    const opponentScore = state.opponentScore;

    // Determine result
    let result;
    let eloResult;
    if (playerScore > opponentScore) {
      result = 'win';
      eloResult = 1;
    } else if (playerScore < opponentScore) {
      result = 'loss';
      eloResult = 0;
    } else {
      result = 'draw';
      eloResult = 0.5;
    }

    // Calculate rating change
    const opponentRating = state.opponent ? state.opponent.rating : DEFAULT_RATING;
    const elo = calculateElo(state.player.rating, opponentRating, eloResult);

    // Calculate stats
    let correctCount = 0;
    let wrongCount = 0;
    let timeoutCount = 0;
    state.answers.forEach(a => {
      if (a.isTimeout) timeoutCount++;
      else if (a.isCorrect) correctCount++;
      else wrongCount++;
    });

    // Show result immediately (optimistic UI)
    setPhase('FINALIZED');
    renderResult({
      result,
      playerScore,
      opponentScore,
      ratingChange: elo.change,
      newRating: elo.newRating,
      correct: correctCount,
      wrong: wrongCount,
      timeout: timeoutCount,
      accuracy: state.questions.length > 0 ? Math.round((correctCount / state.questions.length) * 100) : 0
    });

    // Play result sound
    playSound(result === 'win' ? 'victory' : result === 'loss' ? 'defeat' : 'timeout');

    // Save to Supabase in background
    try {
      await saveMatchResult(result, elo, correctCount, wrongCount, timeoutCount);
    } catch(e) {
      console.error('[ARENA] Failed to save match result:', e);
      // Result is still shown — match is recoverable
    }

    // Update local state
    updatePlayerStats(result, elo, correctCount, wrongCount, timeoutCount);
  }

  async function saveMatchResult(result, elo, correct, wrong, timeout) {
    const c = sb();
    if (!c) return;
    const userId = await getUid();
    if (!userId) return;

    // Create match record
    const { data: matchData, error: matchError } = await c.from('arena_matches').insert({
      match_key: state.match.matchKey,
      mode: state.match.mode,
      question_count: state.match.question_count,
      exam: state.match.exam,
      category: state.match.category,
      difficulty: state.match.difficulty,
      status: 'finalized',
      team_a_score: state.playerScore,
      team_b_score: state.opponentScore,
      result: result === 'win' ? 'team_a' : result === 'loss' ? 'team_b' : 'draw',
      finalized_at: new Date().toISOString()
    }).select().single();

    if (matchError) {
      // Try idempotent update (match_key already exists)
      const { data: existing } = await c.from('arena_matches')
        .select('id')
        .eq('match_key', state.match.matchKey)
        .maybeSingle();
      if (!existing) throw matchError;
      return; // Already saved
    }

    const matchId = matchData?.id;

    // Save participant (player)
    if (matchId) {
      await c.from('arena_match_participants').insert({
        match_id: matchId,
        participant_type: 'player',
        user_id: userId,
        display_name: state.player.display_name,
        team: 'A',
        team_slot: 0,
        rating_before: state.player.rating,
        score: state.playerScore,
        correct, wrong, timeout,
        rating_after: elo.newRating,
        rating_change: elo.change,
        result
      });

      // Save opponent participant
      if (state.opponent) {
        await c.from('arena_match_participants').insert({
          match_id: matchId,
          participant_type: 'opponent',
          opponent_id: state.opponent.id || null,
          display_name: state.opponent.name,
          team: 'B',
          team_slot: 0,
          rating_before: state.opponent.rating || DEFAULT_RATING,
          score: state.opponentScore,
          correct: state.opponentAnswers.filter(a => a.isCorrect).length,
          wrong: state.opponentAnswers.filter(a => !a.isCorrect && !a.isTimeout).length,
          timeout: 0,
          rating_after: state.opponent.rating || DEFAULT_RATING,
          rating_change: -elo.change,
          result: result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw'
        });
      }

      // Save answers
      const answerPromises = state.answers.map((a, i) => {
        return c.from('arena_match_answers').insert({
          match_id: matchId,
          participant_id: null, // Will be linked by match_id + index
          question_index: i,
          question_text: state.questions[i]?.text || '',
          question_data: state.questions[i] || {},
          selected_option: a.selected,
          correct_option: a.correct,
          is_correct: a.isCorrect,
          is_timeout: a.isTimeout,
          response_ms: a.responseMs,
          points_awarded: a.points
        });
      });

      await Promise.all(answerPromises);
    }

    // Update player profile
    const newForm = (result.charAt(0).toUpperCase() + state.player.recent_form).slice(0, 10);
    await c.from('arena_players').update({
      rating: elo.newRating,
      rating_peak: Math.max(state.player.rating_peak, elo.newRating),
      wins: state.player.wins + (result === 'win' ? 1 : 0),
      losses: state.player.losses + (result === 'loss' ? 1 : 0),
      draws: state.player.draws + (result === 'draw' ? 1 : 0),
      battles: state.player.battles + 1,
      current_streak: result === 'win' ? state.player.current_streak + 1 : 0,
      best_streak: Math.max(state.player.best_streak, result === 'win' ? state.player.current_streak + 1 : 0),
      total_questions: state.player.total_questions + state.questions.length,
      correct_answers: state.player.correct_answers + correct,
      wrong_answers: state.player.wrong_answers + wrong,
      timeout_answers: state.player.timeout_answers + timeout,
      recent_form: newForm,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
  }

  function updatePlayerStats(result, elo, correct, wrong, timeout) {
    if (!state.player) return;

    state.player.rating = elo.newRating;
    state.player.rating_peak = Math.max(state.player.rating_peak, elo.newRating);

    if (result === 'win') {
      state.player.wins++;
      state.player.current_streak++;
      state.player.best_streak = Math.max(state.player.best_streak, state.player.current_streak);
    } else {
      state.player.current_streak = 0;
      if (result === 'loss') state.player.losses++;
      else state.player.draws++;
    }

    state.player.battles++;
    state.player.total_questions += state.questions.length;
    state.player.correct_answers += correct;
    state.player.wrong_answers += wrong;
    state.player.timeout_answers += timeout;
    state.player.recent_form = (result.charAt(0).toUpperCase() + state.player.recent_form).slice(0, 10);

    // Save to localStorage as backup
    try {
      const localKey = 'arena_player_' + state.player.user_id;
      localStorage.setItem(localKey, JSON.stringify(state.player));
    } catch(_) {}
  }

  // ── HISTORY ────────────────────────────────────────────────────────
  async function loadHistory() {
    const userId = await getUid();
    if (!userId) { state.history = []; return []; }

    try {
      const c = sb();
      if (!c) { state.history = []; return []; }

      const { data, error } = await c.from('arena_match_participants')
        .select(`
          *,
          arena_matches (*)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        state.history = data.map(p => ({
          matchKey: p.arena_matches?.match_key || '',
          date: p.created_at,
          mode: p.arena_matches?.mode || '1v1',
          opponent: '', // Would need to join opponent data
          score: p.score,
          opponentScore: p.arena_matches?.team_b_score || 0,
          result: p.result,
          ratingBefore: p.rating_before,
          ratingChange: p.rating_change,
          ratingAfter: p.rating_after,
          correct: p.correct,
          wrong: p.wrong,
          timeout: p.timeout,
          questionCount: p.arena_matches?.question_count || 0,
          difficulty: p.arena_matches?.difficulty || 'medium'
        }));
      }
      return state.history;
    } catch(e) {
      // Try localStorage
      const local = localStorage.getItem('arena_history_' + userId);
      if (local) {
        state.history = JSON.parse(local);
        return state.history;
      }
      state.history = [];
      return [];
    }
  }

  // ── LEADERBOARD ───────────────────────────────────────────────────
  async function loadLeaderboard() {
    try {
      const c = sb();
      if (!c) { state.leaderboard = []; return []; }

      const { data, error } = await c.from('arena_players')
        .select('display_name, rating, wins, losses, draws, battles, current_streak')
        .order('rating', { ascending: false })
        .limit(20);

      if (data) {
        state.leaderboard = data;
        return data;
      }
      return [];
    } catch(e) {
      return [];
    }
  }

  // ── SOUND SETTINGS ────────────────────────────────────────────────
  function loadSoundSettings() {
    try {
      const saved = localStorage.getItem('arena_sound');
      if (saved) state.sound = { ...state.sound, ...JSON.parse(saved) };
    } catch(_) {}
  }

  function saveSoundSettings() {
    try {
      localStorage.setItem('arena_sound', JSON.stringify(state.sound));
    } catch(_) {}
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDERING
  // ═════════════════════════════════════════════════════════════════

  function getContainer() {
    return document.getElementById('arenaContent') || document.getElementById('page-arena');
  }

  async function render() {
    const container = getContainer();
    if (!container) return;

    // Check auth
    const userId = await getUid();
    if (!userId) {
      renderAuthRequired(container);
      return;
    }

    // Load player profile if not loaded
    if (!state.player) {
      await loadPlayerProfile();
    }

    // Load sound settings
    loadSoundSettings();

    // Render based on phase
    switch(state.phase) {
      case 'IDLE':
        renderLobby();
        break;
      case 'SEARCHING':
        renderSearching();
        break;
      case 'MATCH_FOUND':
        // VS screen is handled by startMatch
        break;
      case 'ACTIVE':
        renderBattle();
        break;
      case 'FINALIZED':
        // Result is shown by finalizeMatch
        break;
      default:
        renderLobby();
    }
  }

  function renderAuthRequired(container) {
    container.innerHTML = `
      <div class="arena-container">
        <div class="arena-auth-required">
          <div class="arena-auth-icon">⚔️</div>
          <div class="arena-auth-title">Sign In to Enter the Arena</div>
          <div class="arena-auth-sub">Compete with players across Assam in real-time quiz battles. Climb the leaderboard, improve your rating, and become a champion.</div>
          <button class="arena-result-btn arena-result-btn-primary" onclick="navigate('login')">
            Sign In to Continue
          </button>
        </div>
      </div>`;
  }

  function renderLobby() {
    const container = getContainer();
    if (!container) return;

    const p = state.player || {};
    const winRate = getWinRate();
    const accuracy = getAccuracy();
    const initials = (p.display_name || 'P').charAt(0).toUpperCase();

    container.innerHTML = `
      <div class="arena-container">

        <!-- ARENA BANNER (PRESERVED) -->
        <div class="arena-banner" onclick="ARENA.startQuickMatch()">
          <div class="arena-banner-orb arena-banner-orb-1"></div>
          <div class="arena-banner-orb arena-banner-orb-2"></div>
          <div class="arena-banner-inner">
            <div class="arena-banner-text">
              <h2>⚔️ Studyrya Arena</h2>
              <p>Battle real players in competitive quiz matches. Climb the ranks. Become a champion.</p>
            </div>
            <button class="arena-banner-cta">Quick Match →</button>
          </div>
        </div>

        <!-- PROFILE -->
        <div class="arena-profile">
          <div class="arena-profile-avatar">${initials}</div>
          <div class="arena-profile-info">
            <h3>${escapeHtml(p.display_name || 'Player')}</h3>
            <div class="arena-tag">⚡ Rating ${p.rating || DEFAULT_RATING}</div>
            <div class="arena-stats-grid">
              <div class="arena-stat">
                <div class="arena-stat-value">${p.battles || 0}</div>
                <div class="arena-stat-label">Battles</div>
              </div>
              <div class="arena-stat">
                <div class="arena-stat-value">${winRate}%</div>
                <div class="arena-stat-label">Win Rate</div>
              </div>
              <div class="arena-stat">
                <div class="arena-stat-value">${p.wins || 0}-${p.losses || 0}</div>
                <div class="arena-stat-label">W-L</div>
              </div>
              <div class="arena-stat">
                <div class="arena-stat-value">${p.current_streak || 0}</div>
                <div class="arena-stat-label">Streak</div>
              </div>
              <div class="arena-stat">
                <div class="arena-stat-value">${accuracy}%</div>
                <div class="arena-stat-label">Accuracy</div>
              </div>
              <div class="arena-stat">
                <div class="arena-stat-value">${p.best_streak || 0}</div>
                <div class="arena-stat-label">Best Streak</div>
              </div>
            </div>
          </div>
        </div>

        <!-- TABS -->
        <div class="arena-tabs">
          <button class="arena-tab active" data-tab="lobby" onclick="ARENA.switchTab('lobby')">⚔️ Battle</button>
          <button class="arena-tab" data-tab="history" onclick="ARENA.switchTab('history')">📜 History</button>
          <button class="arena-tab" data-tab="leaderboard" onclick="ARENA.switchTab('leaderboard')">🏆 Leaderboard</button>
          <button class="arena-tab" data-tab="sound" onclick="ARENA.switchTab('sound')">🔊 Sound</button>
        </div>

        <div id="arenaTabContent"></div>
      </div>`;

    renderLobbyTab();
  }

  function renderLobbyTab() {
    const el = document.getElementById('arenaTabContent');
    if (!el) return;

    el.innerHTML = `
      <!-- MODE SELECTION -->
      <div class="arena-section-head">
        <div class="arena-section-title">Select Battle Mode</div>
      </div>
      <div class="arena-mode-grid">
        <div class="arena-mode-card active" onclick="ARENA.selectMode('1v1')">
          <div class="arena-mode-icon">⚔️</div>
          <div class="arena-mode-title">1v1 Duel</div>
          <div class="arena-mode-desc">Head-to-head battle against one opponent</div>
        </div>
        <div class="arena-mode-card" onclick="ARENA.selectMode('2v2')">
          <div class="arena-mode-icon">🤝</div>
          <div class="arena-mode-title">2v2 Team</div>
          <div class="arena-mode-desc">Team up and battle another pair</div>
        </div>
        <div class="arena-mode-card" onclick="ARENA.selectMode('3v3')">
          <div class="arena-mode-icon">👥</div>
          <div class="arena-mode-title">3v3 Squad</div>
          <div class="arena-mode-desc">Squad battle with 3 players per side</div>
        </div>
        <div class="arena-mode-card" onclick="ARENA.selectMode('4v4')">
          <div class="arena-mode-icon">🛡️</div>
          <div class="arena-mode-title">4v4 Clash</div>
          <div class="arena-mode-desc">Full team battle with 4 players per side</div>
        </div>
      </div>

      <!-- CONFIGURATION -->
      <div class="arena-config">
        <div class="arena-config-row">
          <div class="arena-config-label">Question Count</div>
          <div class="arena-config-pills">
            <button class="arena-pill" onclick="ARENA.setConfig('questionCount', 5)">5 Questions</button>
            <button class="arena-pill active" onclick="ARENA.setConfig('questionCount', 10)">10 Questions</button>
            <button class="arena-pill" onclick="ARENA.setConfig('questionCount', 15)">15 Questions</button>
            <button class="arena-pill" onclick="ARENA.setConfig('questionCount', 20)">20 Questions</button>
          </div>
        </div>

        <div class="arena-config-row">
          <div class="arena-config-label">Difficulty</div>
          <div class="arena-config-pills">
            <button class="arena-pill" onclick="ARENA.setConfig('difficulty', 'easy')">Easy</button>
            <button class="arena-pill active" onclick="ARENA.setConfig('difficulty', 'medium')">Medium</button>
            <button class="arena-pill" onclick="ARENA.setConfig('difficulty', 'hard')">Hard</button>
            <button class="arena-pill" onclick="ARENA.setConfig('difficulty', 'mixed')">Mixed</button>
          </div>
        </div>

        <div class="arena-config-row">
          <div class="arena-config-label">Category</div>
          <div class="arena-config-pills">
            <button class="arena-pill active" onclick="ARENA.setConfig('category', 'general')">All Topics</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'History')">History</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Geography')">Geography</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Polity')">Polity</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Economics')">Economics</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'General Science')">Science</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Mathematics')">Mathematics</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'English')">English</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Current Affairs')">Current Affairs</button>
            <button class="arena-pill" onclick="ARENA.setConfig('category', 'Assam Culture')">Assam Culture</button>
          </div>
        </div>
      </div>

      <!-- FIND OPPONENT -->
      <button class="arena-result-btn arena-result-btn-primary" style="width:100%;justify-content:center;padding:16px;font-size:1rem;margin-bottom:24px" onclick="ARENA.findOpponent()">
        🔍 Find Opponent
      </button>
    `;
  }

  function renderSearching() {
    const container = getContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="arena-container">
        <button class="arena-back" onclick="ARENA.cancelSearch()">← Cancel Search</button>
        <div class="arena-matchmaking">
          <div class="arena-search-orb"></div>
          <div class="arena-search-title">Finding Opponent...</div>
          <div class="arena-search-sub">Searching for a compatible ${state.config.mode} player</div>
          <div class="arena-search-timer" id="arenaSearchTimer">50s</div>
          <div class="arena-search-progress">
            <div class="arena-search-progress-fill" id="arenaSearchProgress" style="width:0%"></div>
          </div>
          <div class="arena-search-sub" style="font-size:.78rem">Expanding search range automatically</div>
        </div>
      </div>`;
  }

  async function renderVS() {
    const container = getContainer();
    if (!container) return;

    const p = state.player || {};
    const pInitials = (p.display_name || 'P').charAt(0).toUpperCase();
    const pWinRate = getWinRate();
    const pStreak = p.current_streak || 0;

    const opp = state.opponent || {};
    const oppName = opp.name || 'Opponent';
    const oppInitials = oppName.charAt(0).toUpperCase();
    const oppRating = opp.rating || DEFAULT_RATING;

    const isTeam = state.config.mode !== '1v1';

    let playersHTML;

    if (!isTeam) {
      playersHTML = `
        <div class="arena-vs-players">
          <div class="arena-vs-player">
            <div class="arena-vs-avatar you">${pInitials}</div>
            <div class="arena-vs-name">${escapeHtml(p.display_name || 'You')}</div>
            <div class="arena-vs-rating">⚡ ${p.rating || DEFAULT_RATING}</div>
            <div class="arena-vs-stats">
              <span>W: ${pWinRate}%</span>
              <span>🔥 ${pStreak}</span>
            </div>
          </div>
          <div class="arena-vs-badge">VS</div>
          <div class="arena-vs-player">
            <div class="arena-vs-avatar opp">${oppInitials}</div>
            <div class="arena-vs-name">${escapeHtml(oppName)}</div>
            <div class="arena-vs-rating">⚡ ${oppRating}</div>
            <div class="arena-vs-stats">
              <span>Battles: ${opp.battles || 0}</span>
              <span>🎯 ${Math.round((opp.accuracy || 0) * 100)}%</span>
            </div>
          </div>
        </div>`;
    } else {
      // Team VS
      const teamSize = parseInt(state.config.mode.split('v')[0]);
      const teamB = state.match?.opponents || [];

      let teamAHTML = `<div class="arena-vs-team-member"><div class="arena-vs-team-member-avatar">${pInitials}</div><span>${escapeHtml(p.display_name || 'You')}</span></div>`;
      // Team A teammates (fallback opponents)
      const teamATeammates = pickOpponentsForTeam(p.rating || DEFAULT_RATING, teamSize - 1, [state.opponent?.opponent_key]);
      teamATeammates.forEach(t => {
        teamAHTML += `<div class="arena-vs-team-member"><div class="arena-vs-team-member-avatar">${t.name.charAt(0)}</div><span>${escapeHtml(t.name)}</span></div>`;
      });

      let teamBHTML = teamB.map(t => `<div class="arena-vs-team-member opp"><div class="arena-vs-team-member-avatar">${t.name.charAt(0)}</div><span>${escapeHtml(t.name)}</span></div>`).join('');

      playersHTML = `
        <div class="arena-vs-players">
          <div class="arena-vs-team">
            <div class="arena-vs-team-label">Your Team (A)</div>
            <div class="arena-vs-team-players">${teamAHTML}</div>
          </div>
          <div class="arena-vs-badge">VS</div>
          <div class="arena-vs-team">
            <div class="arena-vs-team-label">Opponent Team (B)</div>
            <div class="arena-vs-team-players">${teamBHTML}</div>
          </div>
        </div>`;
    }

    container.innerHTML = `
      <div class="arena-container">
        <div class="arena-vs">
          ${playersHTML}
          <div id="arenaCountdown" class="arena-vs-countdown">3</div>
        </div>
      </div>`;

    // Countdown
    await runCountdown();
  }

  async function runCountdown() {
    const el = document.getElementById('arenaCountdown');
    if (!el) return;

    return new Promise(function(resolve) {
      let count = 3;
      el.textContent = count;
      playSound('countdown');

      const interval = setInterval(function() {
        count--;
        if (count > 0) {
          el.textContent = count;
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = 'arenaCountdown 0.8s ease-out';
          playSound('countdown');
        } else if (count === 0) {
          el.textContent = 'BATTLE!';
          el.className = 'arena-vs-battle-text';
          playSound('match');
          setTimeout(function() {
            clearInterval(interval);
            resolve();
          }, 800);
        }
      }, 1000);
    });
  }

  function renderBattle() {
    const container = getContainer();
    if (!container) return;

    const q = state.questions[state.qIndex];
    if (!q) {
      renderError('Question not available');
      return;
    }

    const total = state.questions.length;
    const current = state.qIndex + 1;
    const letters = ['A', 'B', 'C', 'D'];

    container.innerHTML = `
      <div class="arena-container">
        <div class="arena-battle">
          <div class="arena-battle-header">
            <div class="arena-battle-scores">
              <div class="arena-battle-score">
                <div class="arena-battle-score-val">${state.playerScore}</div>
                <div class="arena-battle-score-label">You</div>
              </div>
              <div class="arena-battle-score">
                <div class="arena-battle-score-val">${state.opponentScore}</div>
                <div class="arena-battle-score-label">Opp</div>
              </div>
            </div>
            <div class="arena-battle-timer" id="arenaTimerContainer">
              <div class="arena-battle-timer-val" id="arenaTimer">${QUESTION_TIME}s</div>
            </div>
            <div class="arena-battle-progress">
              Q ${current}/${total}
            </div>
          </div>

          <div class="arena-battle-question">
            <div class="arena-battle-q-number">Question ${current} of ${total}</div>
            <div class="arena-battle-q-text">${escapeHtml(q.text)}</div>
            <div class="arena-battle-options">
              ${q.options.map(function(opt, i) {
                return `<button class="arena-battle-option" onclick="ARENA.answer(${i})">
                  <div class="arena-battle-option-letter">${letters[i]}</div>
                  <div class="arena-battle-option-text">${escapeHtml(opt)}</div>
                </button>`;
              }).join('')}
            </div>
          </div>

          <div class="arena-battle-opp-status">
            <div class="arena-battle-opp-dot"></div>
            <span>${escapeHtml(state.opponent?.name || 'Opponent')} is answering...</span>
          </div>
        </div>
      </div>`;
  }

  function renderResult(data) {
    const container = getContainer();
    if (!container) return;

    const banner = data.result === 'win' ? 'VICTORY' : data.result === 'loss' ? 'DEFEAT' : 'DRAW';
    const bannerClass = data.result === 'win' ? 'victory' : data.result === 'loss' ? 'defeat' : 'draw';
    const ratingClass = data.ratingChange > 0 ? 'positive' : data.ratingChange < 0 ? 'negative' : 'neutral';
    const ratingSign = data.ratingChange > 0 ? '+' : '';
    const oppName = state.opponent?.name || 'Opponent';

    let analysisHTML = state.questions.map(function(q, i) {
      const a = state.answers[i] || {};
      let icon = '✕';
      let iconClass = 'wrong';
      if (a.isCorrect) { icon = '✓'; iconClass = 'correct'; }
      else if (a.isTimeout) { icon = '⏱'; iconClass = 'timeout'; }

      const letters = ['A', 'B', 'C', 'D'];
      const userAnswer = a.selected >= 0 ? letters[a.selected] : '—';
      const correctAnswer = letters[q.correct];

      return `<div class="arena-analysis-item" onclick="this.classList.toggle('expanded')">
        <div class="arena-analysis-icon ${iconClass}">${icon}</div>
        <div class="arena-analysis-q">Q${i+1}: ${escapeHtml(q.text.substring(0, 60))}${q.text.length > 60 ? '...' : ''}</div>
      </div>
      <div class="arena-analysis-detail">
        <strong>Your answer:</strong> ${userAnswer}${a.isTimeout ? ' (Timeout)' : ''} | <strong>Correct:</strong> ${correctAnswer}
        ${q.explanation ? '<br><br>' + escapeHtml(q.explanation) : ''}
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="arena-container">
        <div class="arena-result">
          <div class="arena-result-banner ${bannerClass}">${banner}</div>
          <div class="arena-result-subtitle">vs ${escapeHtml(oppName)} • ${state.config.mode.toUpperCase()}</div>

          <div class="arena-result-scores">
            <div class="arena-result-score-card ${data.result === 'win' ? 'winner' : ''}">
              <div class="arena-result-score-name">You</div>
              <div class="arena-result-score-val">${data.playerScore}</div>
            </div>
            <div class="arena-result-vs">vs</div>
            <div class="arena-result-score-card ${data.result === 'loss' ? 'winner' : ''}">
              <div class="arena-result-score-name">${escapeHtml(oppName)}</div>
              <div class="arena-result-score-val">${data.opponentScore}</div>
            </div>
          </div>

          <div class="arena-result-rating">
            <div class="arena-result-rating-change ${ratingClass}">${ratingSign}${data.ratingChange}</div>
            <div>
              <div class="arena-result-rating-label">New Rating</div>
              <div class="arena-result-rating-new">${data.newRating}</div>
            </div>
          </div>

          <div class="arena-result-stats">
            <div class="arena-result-stat">
              <div class="arena-result-stat-val">${data.accuracy}%</div>
              <div class="arena-result-stat-label">Accuracy</div>
            </div>
            <div class="arena-result-stat">
              <div class="arena-result-stat-val">${data.correct}</div>
              <div class="arena-result-stat-label">Correct</div>
            </div>
            <div class="arena-result-stat">
              <div class="arena-result-stat-val">${data.wrong}</div>
              <div class="arena-result-stat-label">Wrong</div>
            </div>
            <div class="arena-result-stat">
              <div class="arena-result-stat-val">${data.timeout}</div>
              <div class="arena-result-stat-label">Timeout</div>
            </div>
          </div>

          <div class="arena-result-actions">
            <button class="arena-result-btn arena-result-btn-primary" onclick="ARENA.rematch()">⚔️ Battle Again</button>
            <button class="arena-result-btn arena-result-btn-secondary" onclick="ARENA.viewAnalysis()">📊 View Analysis</button>
            <button class="arena-result-btn arena-result-btn-secondary" onclick="ARENA.backToLobby()">🏠 Back to Arena</button>
          </div>

          <div id="arenaAnalysis" style="display:none;width:100%;max-width:600px;margin:0 auto">
            <div class="arena-analysis">
              <div class="arena-analysis-title">📊 Battle Analysis</div>
              <div class="arena-analysis-list">${analysisHTML}</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderHistoryTab() {
    const el = document.getElementById('arenaTabContent');
    if (!el) return;

    const history = state.history || [];

    if (history.length === 0) {
      el.innerHTML = `
        <div class="arena-empty">
          <div class="arena-empty-icon">📜</div>
          <div class="arena-empty-text">No battle history yet. Start your first match!</div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="arena-section-head">
        <div class="arena-section-title">📜 Match History</div>
      </div>
      <div class="arena-history-list">
        ${history.map(function(h) {
          const resultIcon = h.result === 'win' ? 'W' : h.result === 'loss' ? 'L' : 'D';
          const resultClass = h.result === 'win' ? 'win' : h.result === 'loss' ? 'loss' : 'draw';
          const ratingClass = h.ratingChange > 0 ? 'positive' : h.ratingChange < 0 ? 'negative' : '';
          const ratingSign = h.ratingChange > 0 ? '+' : '';
          const date = h.date ? new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

          return `<div class="arena-history-item">
            <div class="arena-history-result ${resultClass}">${resultIcon}</div>
            <div>
              <div class="arena-history-info">${h.mode.toUpperCase()} • ${h.questionCount}Q • ${h.difficulty}</div>
              <div class="arena-history-meta">${date}</div>
            </div>
            <div class="arena-history-score">${h.score}-${h.opponentScore}</div>
            <div class="arena-history-rating ${ratingClass}">${ratingSign}${h.ratingChange || 0}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  async function renderLeaderboardTab() {
    const el = document.getElementById('arenaTabContent');
    if (!el) return;

    el.innerHTML = `<div class="arena-loading"><div class="arena-loading-spinner"></div></div>`;

    const leaderboard = await loadLeaderboard();
    const userId = state.player?.user_id;

    if (leaderboard.length === 0) {
      el.innerHTML = `
        <div class="arena-empty">
          <div class="arena-empty-icon">🏆</div>
          <div class="arena-empty-text">No leaderboard data yet. Be the first to battle!</div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="arena-section-head">
        <div class="arena-section-title">🏆 Leaderboard</div>
      </div>
      <div class="arena-leaderboard-list">
        ${leaderboard.map(function(p, i) {
          const rank = i + 1;
          const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
          const isYou = p.user_id === userId;
          const winRate = p.battles > 0 ? Math.round((p.wins / p.battles) * 100) : 0;

          return `<div class="arena-leaderboard-item ${isYou ? 'you' : ''}">
            <div class="arena-leaderboard-rank ${rankClass}">${rank}</div>
            <div>
              <div class="arena-leaderboard-name">${escapeHtml(p.display_name)}${isYou ? ' (You)' : ''}</div>
              <div class="arena-leaderboard-info">${p.battles} battles • ${winRate}% WR • 🔥 ${p.current_streak || 0}</div>
            </div>
            <div class="arena-leaderboard-rating">${p.rating}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderSoundTab() {
    const el = document.getElementById('arenaTabContent');
    if (!el) return;

    const s = state.sound;

    el.innerHTML = `
      <div class="arena-section-head">
        <div class="arena-section-title">🔊 Sound Settings</div>
      </div>
      <div class="arena-sound-panel">
        <div class="arena-sound-row">
          <span class="arena-sound-label">Sound Effects</span>
          <button class="arena-sound-toggle ${s.sfx ? 'on' : ''}" onclick="ARENA.toggleSound('sfx')">
            <div class="arena-sound-toggle-knob"></div>
          </button>
        </div>
        <div class="arena-sound-row">
          <span class="arena-sound-label">Battle Notifications</span>
          <button class="arena-sound-toggle ${s.notifications ? 'on' : ''}" onclick="ARENA.toggleSound('notifications')">
            <div class="arena-sound-toggle-knob"></div>
          </button>
        </div>
        <div class="arena-sound-row">
          <span class="arena-sound-label">Master Volume</span>
          <input type="range" class="arena-sound-slider" min="0" max="100" value="${s.volume * 100}" 
            oninput="ARENA.setVolume(this.value / 100)">
        </div>
        <div class="arena-sound-row" style="border-top:1px solid var(--glass-border);padding-top:12px;margin-top:8px">
          <button class="arena-result-btn arena-result-btn-secondary" onclick="ARENA.testSound()">🔊 Test Sound</button>
          <button class="arena-result-btn arena-result-btn-secondary" onclick="ARENA.resetSound()">↺ Reset</button>
        </div>
      </div>`;
  }

  function renderError(message) {
    const container = getContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="arena-container">
        <div class="arena-empty" style="min-height:50vh;display:flex;flex-direction:column;justify-content:center;align-items:center">
          <div class="arena-empty-icon">⚠️</div>
          <div class="arena-empty-text">${escapeHtml(message || 'An error occurred')}</div>
          <button class="arena-result-btn arena-result-btn-primary" onclick="ARENA.backToLobby()">Back to Arena</button>
        </div>
      </div>`;
  }

  // ── UTILITY ───────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── PUBLIC API ────────────────────────────────────────────────────
  window.ARENA = {
    _version: ARENA_VERSION,
    state,

    // Init
    async init() {
      loadSoundSettings();
      await loadPlayerProfile();
      await loadOpponents();
      await loadHistory();
      render();
    },

    // Navigation
    switchTab(tab) {
      state.activeTab = tab;
      document.querySelectorAll('.arena-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      if (tab === 'lobby') renderLobbyTab();
      else if (tab === 'history') renderHistoryTab();
      else if (tab === 'leaderboard') renderLeaderboardTab();
      else if (tab === 'sound') renderSoundTab();
    },

    // Configuration
    selectMode(mode) {
      state.config.mode = mode;
      document.querySelectorAll('.arena-mode-card').forEach(c => c.classList.remove('active'));
      event?.target?.closest('.arena-mode-card')?.classList.add('active');
    },

    setConfig(key, value) {
      state.config[key] = value;
      // Update pill states
      const pills = event?.target?.parentElement?.querySelectorAll('.arena-pill');
      if (pills) {
        pills.forEach(p => p.classList.remove('active'));
        event.target.classList.add('active');
      }
    },

    // Matchmaking
    async findOpponent() {
      await startMatchmaking();
    },

    cancelSearch() {
      cancelMatchmaking();
    },

    startQuickMatch() {
      state.config.mode = '1v1';
      state.config.questionCount = 10;
      state.config.difficulty = 'medium';
      state.config.category = 'general';
      startMatchmaking();
    },

    // Battle
    answer(optionIndex) {
      handleAnswer(optionIndex);
    },

    // Results
    rematch() {
      // Reset match state but keep config
      state.match = null;
      state.answers = [];
      state.questions = [];
      state.qIndex = 0;
      state.playerScore = 0;
      state.opponentScore = 0;
      state.finalized = false;
      state.opponent = null;
      state.opponentAnswers = [];
      setPhase('IDLE');
      startMatchmaking();
    },

    viewAnalysis() {
      const el = document.getElementById('arenaAnalysis');
      if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        if (el.style.display === 'block') {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }
    },

    backToLobby() {
      state.match = null;
      state.answers = [];
      state.questions = [];
      state.qIndex = 0;
      state.playerScore = 0;
      state.opponentScore = 0;
      state.finalized = false;
      state.opponent = null;
      state.opponentAnswers = [];
      setPhase('IDLE');
      render();
    },

    // Sound
    toggleSound(key) {
      state.sound[key] = !state.sound[key];
      saveSoundSettings();
      renderSoundTab();
    },

    setVolume(vol) {
      state.sound.volume = vol;
      saveSoundSettings();
    },

    testSound() {
      playSound('victory');
    },

    resetSound() {
      state.sound = { sfx: true, music: true, notifications: true, volume: 0.5 };
      saveSoundSettings();
      renderSoundTab();
    },

    // Refresh (for login/logout/navigation)
    async refresh() {
      state.player = null;
      state.phase = 'IDLE';
      state.match = null;
      state.answers = [];
      state.questions = [];
      state.history = [];
      state.leaderboard = [];
      state.finalized = false;
      await this.init();
    }
  };

  // ── STATE RECOVERY ────────────────────────────────────────────────
  // Recover from refresh during battle
  async function recoverState() {
    try {
      const saved = sessionStorage.getItem('arena_active_match');
      if (saved) {
        const matchState = JSON.parse(saved);
        if (matchState.phase === 'ACTIVE' && matchState.qIndex < matchState.questions.length) {
          // Resume battle
          state.phase = 'ACTIVE';
          state.match = matchState.match;
          state.questions = matchState.questions;
          state.qIndex = matchState.qIndex;
          state.answers = matchState.answers || [];
          state.playerScore = matchState.playerScore || 0;
          state.opponentScore = matchState.opponentScore || 0;
          state.opponent = matchState.opponent;
          state.opponentAnswers = matchState.opponentAnswers || [];
          state.finalized = false;
          state.config = matchState.config || state.config;
          // Don't auto-resume — let user choose
          // For now, go back to lobby
        }
        sessionStorage.removeItem('arena_active_match');
      }
    } catch(_) {}
  }

  // Save state before refresh
  window.addEventListener('beforeunload', function() {
    if (state.phase === 'ACTIVE' && state.match) {
      try {
        sessionStorage.setItem('arena_active_match', JSON.stringify({
          phase: state.phase,
          match: state.match,
          questions: state.questions,
          qIndex: state.qIndex,
          answers: state.answers,
          playerScore: state.playerScore,
          opponentScore: state.opponentScore,
          opponent: state.opponent,
          opponentAnswers: state.opponentAnswers,
          config: state.config
        }));
      } catch(_) {}
    }
  });

  // Auto-init when Arena page is shown
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', recoverState);
  } else {
    recoverState();
  }

})();
