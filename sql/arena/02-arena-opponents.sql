-- =============================================================================
-- FILE: sql/arena/02-arena-opponents.sql
-- PROJECT: Studyria Arena — 8 Permanent Assamese Opponents
-- PURPOSE: Define the arena_opponents table for persistent fallback opponents
-- STATUS: READY TO EXECUTE IN SUPABASE SQL EDITOR
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.arena_opponents (

    -- Stable opponent ID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Human-readable stable ID (e.g., 'junali_saikia')
    opponent_key    TEXT        NOT NULL UNIQUE,

    -- Identity
    name            TEXT        NOT NULL,
    gender          TEXT        NOT NULL DEFAULT 'female'
                    CHECK (gender IN ('male', 'female')),
    avatar_url      TEXT,

    -- Rating (Elo-style)
    rating          INTEGER     NOT NULL DEFAULT 1000,
    rating_peak     INTEGER     NOT NULL DEFAULT 1000,

    -- Win/Loss/Draw
    wins            INTEGER     NOT NULL DEFAULT 0,
    losses          INTEGER     NOT NULL DEFAULT 0,
    draws           INTEGER     NOT NULL DEFAULT 0,
    battles         INTEGER     NOT NULL DEFAULT 0,

    -- Streak
    current_streak  INTEGER     NOT NULL DEFAULT 0,
    best_streak     INTEGER     NOT NULL DEFAULT 0,

    -- Performance
    accuracy        REAL        NOT NULL DEFAULT 0.70,
    avg_score       REAL        NOT NULL DEFAULT 50.0,
    avg_response_ms INTEGER     NOT NULL DEFAULT 8000,

    -- Recent form
    recent_form     TEXT        NOT NULL DEFAULT '',

    -- Strengths and weaknesses (JSON arrays of topics)
    strengths       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    weaknesses      JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Metadata
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()

);

-- Enable RLS (read-only for everyone — these are public profiles)
ALTER TABLE public.arena_opponents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read arena opponents"
    ON public.arena_opponents
    FOR SELECT TO anon, authenticated
    USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arena_opponents_rating ON public.arena_opponents(rating DESC);
CREATE INDEX IF NOT EXISTS idx_arena_opponents_active ON public.arena_opponents(is_active);

-- =============================================================================
-- SEED DATA: 8 Permanent Assamese Opponents (4 male, 4 female)
-- =============================================================================

INSERT INTO public.arena_opponents
    (opponent_key, name, gender, rating, rating_peak, wins, losses, draws, battles,
     current_streak, best_streak, accuracy, avg_score, avg_response_ms, recent_form,
     strengths, weaknesses)
VALUES
    -- 4 Female Opponents
    ('junali_saikia', 'Junali Saikia', 'female',
     1088, 1156, 34, 18, 4, 56, 3, 7, 0.78, 62.5, 7200, 'WWLWWLWWWW',
     '["Geography","History","Polity"]'::jsonb,
     '["Quantitative Aptitude","Economics"]'::jsonb),

    ('mousumi_das', 'Mousumi Das', 'female',
     1024, 1080, 22, 20, 3, 45, 1, 4, 0.68, 48.0, 9500, 'WLWLDWLWWL',
     '["Current Affairs","General Science"]'::jsonb,
     '["History","Geography"]'::jsonb),

    ('rupali_borah', 'Rupali Borah', 'female',
     965, 1010, 15, 24, 2, 41, 0, 3, 0.62, 38.5, 11000, 'LLWLDWLLWL',
     '["Assam History","English"]'::jsonb,
     '["Mathematics","Polity"]'::jsonb),

    ('anjali_kalita', 'Anjali Kalita', 'female',
     1142, 1205, 41, 12, 5, 58, 5, 9, 0.84, 71.0, 6800, 'WWWWWLWWWW',
     '["Polity","Economics","Current Affairs"]'::jsonb,
     '["Geography"]'::jsonb),

    -- 4 Male Opponents
    ('arup_das', 'Arup Das', 'male',
     1050, 1098, 28, 16, 3, 47, 2, 6, 0.74, 55.0, 7800, 'WWLWWWLWLW',
     '["Mathematics","Geography","General Science"]'::jsonb,
     '["English"]'::jsonb),

    ('bhaskar_gogoi', 'Bhaskar Gogoi', 'male',
     998, 1045, 20, 22, 2, 44, 0, 3, 0.66, 44.0, 9000, 'WLLWLDWLWW',
     '["History","Assam Culture"]'::jsonb,
     '["Quantitative Aptitude","Economics"]'::jsonb),

    ('dipankar_saikia', 'Dipankar Saikia', 'male',
     920, 980, 12, 28, 1, 41, 0, 2, 0.58, 32.0, 12000, 'LLWLLWLLWL',
     '["English","Current Affairs"]'::jsonb,
     '["Mathematics","Geography","Polity"]'::jsonb),

    ('pranjal_borah', 'Pranjal Borah', 'male',
     1115, 1178, 38, 14, 4, 56, 4, 8, 0.82, 68.0, 7000, 'WWWWLWWWLW',
     '["Economics","Polity","Current Affairs"]'::jsonb,
     '["Assam History"]'::jsonb)
ON CONFLICT (opponent_key) DO NOTHING;
