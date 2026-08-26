-- =============================================================================
-- FILE: sql/adre-attempts.sql
-- PROJECT: Studyria ADRE Papers System
-- PURPOSE: Define the adre_attempts table for storing user exam attempts
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: adre_attempts
-- Stores each user's attempt at an ADRE previous-year paper.
-- Includes full answer snapshot, score breakdown, and timing data.
-- One row per attempt (users can retry papers multiple times).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.adre_attempts (

    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Unique attempt identifier generated client-side
    -- Format: <paper_id>-<timestamp>-<random>
    -- Used for idempotent submission (prevent duplicates on refresh)
    attempt_id          TEXT        NOT NULL UNIQUE,

    -- Which paper this attempt belongs to
    paper_id            TEXT        NOT NULL,

    -- Which user took this attempt
    user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Score breakdown
    score               NUMERIC(6,2) NOT NULL DEFAULT 0,
    raw_score           NUMERIC(6,2) NOT NULL DEFAULT 0,
    negative_marks      NUMERIC(6,2) NOT NULL DEFAULT 0,
    maximum_marks       NUMERIC(6,2) NOT NULL DEFAULT 0,
    percentage          NUMERIC(5,2) NOT NULL DEFAULT 0,

    -- Question breakdown
    total_correct       INTEGER     NOT NULL DEFAULT 0,
    total_wrong         INTEGER     NOT NULL DEFAULT 0,
    total_unanswered    INTEGER     NOT NULL DEFAULT 0,
    accuracy            NUMERIC(5,2) NOT NULL DEFAULT 0,

    -- Timing
    time_spent_seconds  INTEGER     NOT NULL DEFAULT 0,

    -- Full answer snapshot (JSON: { question_id: 'a'/'b'/'c'/'d' })
    answers             JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Whether this was an auto-submit (time expired)
    is_auto_submit      BOOLEAN     NOT NULL DEFAULT false,

    -- Completion timestamp
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Audit
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    is_deleted          BOOLEAN     DEFAULT false

);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_adre_att_user
    ON public.adre_attempts (user_id);

CREATE INDEX IF NOT EXISTS idx_adre_att_paper
    ON public.adre_attempts (paper_id);

CREATE INDEX IF NOT EXISTS idx_adre_att_user_paper
    ON public.adre_attempts (user_id, paper_id);

CREATE INDEX IF NOT EXISTS idx_adre_att_attempt_id
    ON public.adre_attempts (attempt_id);

CREATE INDEX IF NOT EXISTS idx_adre_att_completed
    ON public.adre_attempts (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_adre_att_created
    ON public.adre_attempts (created_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.adre_attempts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own attempts
CREATE POLICY "adre_attempts_owner_read"
    ON public.adre_attempts
    FOR SELECT
    USING (
        user_id = auth.uid()
        AND is_deleted = false
    );

-- Users can insert their own attempts
CREATE POLICY "adre_attempts_owner_insert"
    ON public.adre_attempts
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND is_deleted = false
    );

-- Users can update their own attempts (e.g., for corrections)
CREATE POLICY "adre_attempts_owner_update"
    ON public.adre_attempts
    FOR UPDATE
    USING (
        user_id = auth.uid()
        AND is_deleted = false
    );

-- Admin can read all attempts (for analytics)
CREATE POLICY "adre_attempts_admin_read"
    ON public.adre_attempts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        AND is_deleted = false
    );

-- Users can delete their own attempts
CREATE POLICY "adre_attempts_owner_delete"
    ON public.adre_attempts
    FOR DELETE
    USING (
        user_id = auth.uid()
    );

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.adre_attempts IS
    'ADRE paper attempt records. One row per user attempt. Idempotent via attempt_id.';

COMMENT ON COLUMN public.adre_attempts.attempt_id IS
    'Unique client-generated ID. Used for idempotent submission to prevent duplicates on refresh.';

COMMENT ON COLUMN public.adre_attempts.answers IS
    'Full answer snapshot as JSON: { "question_uuid": "a" | "b" | "c" | "d" }';

COMMENT ON COLUMN public.adre_attempts.is_auto_submit IS
    'True if the exam was auto-submitted due to time expiry.';

COMMENT ON COLUMN public.adre_attempts.score IS
    'Final score after negative marks deduction: max(0, raw_score - negative_marks).';
