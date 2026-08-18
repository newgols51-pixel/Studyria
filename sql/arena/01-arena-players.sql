-- =============================================================================
-- FILE: sql/arena/01-arena-players.sql
-- PROJECT: Studyria Arena — Competitive Learning System
-- PURPOSE: Define the arena_players table for persistent player profiles
-- STATUS: READY TO EXECUTE IN SUPABASE SQL EDITOR
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.arena_players (

    -- Primary key — uses auth.users.id for 1:1 mapping
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References auth.users (Supabase Auth)
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    UNIQUE(user_id),

    -- Player identity
    display_name    TEXT        NOT NULL DEFAULT 'Player',
    avatar_url      TEXT,

    -- Arena rating (Elo-style, default 1000)
    rating          INTEGER     NOT NULL DEFAULT 1000,
    rating_peak     INTEGER     NOT NULL DEFAULT 1000,

    -- Win/Loss/Draw tracking
    wins            INTEGER     NOT NULL DEFAULT 0,
    losses          INTEGER     NOT NULL DEFAULT 0,
    draws           INTEGER     NOT NULL DEFAULT 0,
    battles         INTEGER     NOT NULL DEFAULT 0,

    -- Streak tracking
    current_streak  INTEGER     NOT NULL DEFAULT 0,
    best_streak     INTEGER     NOT NULL DEFAULT 0,

    -- Question statistics
    total_questions     INTEGER NOT NULL DEFAULT 0,
    correct_answers     INTEGER NOT NULL DEFAULT 0,
    wrong_answers       INTEGER NOT NULL DEFAULT 0,
    timeout_answers     INTEGER NOT NULL DEFAULT 0,

    -- Recent form (W=win, L=loss, D=draw, last 10 matches, newest first)
    recent_form     TEXT        NOT NULL DEFAULT '',

    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()

);

-- Enable RLS
ALTER TABLE public.arena_players ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Players can read own profile"
    ON public.arena_players
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Players can update own profile"
    ON public.arena_players
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Players can insert own profile"
    ON public.arena_players
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Public read for leaderboard
CREATE POLICY "Public can read arena players for leaderboard"
    ON public.arena_players
    FOR SELECT TO anon, authenticated
    USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arena_players_user_id ON public.arena_players(user_id);
CREATE INDEX IF NOT EXISTS idx_arena_players_rating ON public.arena_players(rating DESC);
CREATE INDEX IF NOT EXISTS idx_arena_players_updated ON public.arena_players(updated_at DESC);
