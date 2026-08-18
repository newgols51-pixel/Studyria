-- =============================================================================
-- FILE: sql/arena/03-arena-matches.sql
-- PROJECT: Studyria Arena — Match Records & History
-- PURPOSE: Define arena_matches and arena_match_participants tables
-- STATUS: READY TO EXECUTE IN SUPABASE SQL EDITOR
-- =============================================================================

-- =============================================================================
-- TABLE: arena_matches
-- One row per finalized Arena battle
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.arena_matches (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stable match identifier (for idempotency)
    match_key        TEXT       NOT NULL UNIQUE,

    -- Match configuration
    mode            TEXT        NOT NULL DEFAULT '1v1'
                    CHECK (mode IN ('1v1', '2v2', '3v3', '4v4')),

    question_count  INTEGER     NOT NULL DEFAULT 10,
    exam            TEXT        DEFAULT 'general',
    category        TEXT        DEFAULT 'general',
    difficulty      TEXT        NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),

    -- Match result (NULL until finalized)
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'finalized', 'cancelled', 'error')),

    -- Team scores
    team_a_score    INTEGER     NOT NULL DEFAULT 0,
    team_b_score    INTEGER     NOT NULL DEFAULT 0,

    -- Winner
    result          TEXT        CHECK (result IN ('team_a', 'team_b', 'draw')),

    -- Timestamps
    started_at      TIMESTAMPTZ DEFAULT now(),
    finalized_at    TIMESTAMPTZ

);

-- Enable RLS
ALTER TABLE public.arena_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read arena matches"
    ON public.arena_matches
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Authenticated can insert arena matches"
    ON public.arena_matches
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated can update arena matches"
    ON public.arena_matches
    FOR UPDATE TO authenticated
    USING (true);

-- =============================================================================
-- TABLE: arena_match_participants
-- One row per player/opponent per match
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.arena_match_participants (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    match_id        UUID        NOT NULL REFERENCES public.arena_matches(id) ON DELETE CASCADE,

    -- Participant identity
    participant_type TEXT       NOT NULL DEFAULT 'player'
                     CHECK (participant_type IN ('player', 'opponent')),

    -- For real players: references auth.users
    user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

    -- For fallback opponents: references arena_opponents
    opponent_id     UUID        REFERENCES public.arena_opponents(id) ON DELETE SET NULL,

    -- Display info
    display_name    TEXT        NOT NULL DEFAULT 'Player',
    avatar_url      TEXT,

    -- Team assignment
    team            TEXT        NOT NULL DEFAULT 'A'
                    CHECK (team IN ('A', 'B')),

    -- Slot within team (0-indexed)
    team_slot       INTEGER     NOT NULL DEFAULT 0,

    -- Pre-match state
    rating_before   INTEGER     NOT NULL DEFAULT 1000,

    -- Match performance
    score           INTEGER     NOT NULL DEFAULT 0,
    correct         INTEGER     NOT NULL DEFAULT 0,
    wrong           INTEGER     NOT NULL DEFAULT 0,
    timeout         INTEGER     NOT NULL DEFAULT 0,
    avg_response_ms INTEGER     NOT NULL DEFAULT 0,

    -- Post-match state
    rating_after    INTEGER     NOT NULL DEFAULT 1000,
    rating_change   INTEGER     NOT NULL DEFAULT 0,

    -- Result from this participant's perspective
    result          TEXT        CHECK (result IN ('win', 'loss', 'draw')),

    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT now()

);

-- Enable RLS
ALTER TABLE public.arena_match_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can read own match records"
    ON public.arena_match_participants
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Authenticated can insert match participants"
    ON public.arena_match_participants
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated can update match participants"
    ON public.arena_match_participants
    FOR UPDATE TO authenticated
    USING (true);

-- =============================================================================
-- TABLE: arena_match_answers
-- One row per answer per participant per question
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.arena_match_answers (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    match_id        UUID        NOT NULL REFERENCES public.arena_matches(id) ON DELETE CASCADE,
    participant_id  UUID        NOT NULL REFERENCES public.arena_match_participants(id) ON DELETE CASCADE,

    -- Question data (stored as JSON for flexibility)
    question_index  INTEGER     NOT NULL DEFAULT 0,
    question_text   TEXT        NOT NULL DEFAULT '',
    question_data   JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Answer
    selected_option INTEGER,
    correct_option  INTEGER,
    is_correct      BOOLEAN     NOT NULL DEFAULT false,
    is_timeout      BOOLEAN     NOT NULL DEFAULT false,
    response_ms     INTEGER     NOT NULL DEFAULT 0,

    -- Score for this question
    points_awarded  INTEGER     NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT now(),

    UNIQUE(match_id, participant_id, question_index)

);

-- Enable RLS
ALTER TABLE public.arena_match_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can read own answers"
    ON public.arena_match_answers
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Authenticated can insert answers"
    ON public.arena_match_answers
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON public.arena_matches(status);
CREATE INDEX IF NOT EXISTS idx_arena_matches_finalized ON public.arena_matches(finalized_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_match_participants_match ON public.arena_match_participants(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_match_participants_user ON public.arena_match_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_arena_match_answers_match ON public.arena_match_answers(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_match_answers_participant ON public.arena_match_answers(match_id, participant_id);
