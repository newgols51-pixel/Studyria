-- =============================================================================
-- FILE: sql/arena/04-arena-matchmaking.sql
-- PROJECT: Studyria Arena — Matchmaking Queue
-- PURPOSE: Define arena_matchmaking_queue for real-player matchmaking
-- STATUS: READY TO EXECUTE IN SUPABASE SQL EDITOR
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.arena_matchmaking_queue (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name    TEXT        NOT NULL DEFAULT 'Player',
    rating          INTEGER     NOT NULL DEFAULT 1000,

    -- Match preferences
    mode            TEXT        NOT NULL DEFAULT '1v1'
                    CHECK (mode IN ('1v1', '2v2', '3v3', '4v4')),
    question_count  INTEGER     NOT NULL DEFAULT 10,
    exam            TEXT        DEFAULT 'general',
    category        TEXT        DEFAULT 'general',
    difficulty      TEXT        NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),

    -- Team slot preferences (for team modes)
    team_size       INTEGER     NOT NULL DEFAULT 1,

    -- Queue state
    status          TEXT        NOT NULL DEFAULT 'searching'
                    CHECK (status IN ('searching', 'matched', 'expired', 'cancelled')),

    -- Rating window for progressive matchmaking
    rating_window   INTEGER     NOT NULL DEFAULT 35,

    -- Timestamps
    queued_at       TIMESTAMPTZ DEFAULT now(),
    matched_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ DEFAULT now() + interval '90 seconds'

);

-- Enable RLS
ALTER TABLE public.arena_matchmaking_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own queue entries"
    ON public.arena_matchmaking_queue
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue entries"
    ON public.arena_matchmaking_queue
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue entries"
    ON public.arena_matchmaking_queue
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue entries"
    ON public.arena_matchmaking_queue
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arena_mmq_status ON public.arena_matchmaking_queue(status);
CREATE INDEX IF NOT EXISTS idx_arena_mmq_mode ON public.arena_matchmaking_queue(mode, status);
CREATE INDEX IF NOT EXISTS idx_arena_mmq_rating ON public.arena_matchmaking_queue(rating, status);
CREATE INDEX IF NOT EXISTS idx_arena_mmq_user ON public.arena_matchmaking_queue(user_id);
