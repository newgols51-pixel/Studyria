-- =============================================================================
-- FILE: sql/adre-paper-questions.sql
-- PROJECT: Studyria ADRE Papers System
-- PURPOSE: Define the adre_paper_questions table for storing official question data
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: adre_paper_questions
-- Stores individual questions for each ADRE previous-year paper.
-- Questions are imported from official ASSEB/SLRC PDF sources only.
-- No AI-generated or sample questions are permitted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.adre_paper_questions (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign key to the paper config (matches JS config IDs)
    -- e.g. 'adre2-2024-p1', 'adre1-2022-p3', etc.
    paper_id        TEXT        NOT NULL,

    -- Question number within the paper (1-based)
    question_number INTEGER     NOT NULL CHECK (question_number > 0),

    -- Sort order for display (usually same as question_number)
    sort_order      INTEGER     NOT NULL DEFAULT 0,

    -- The full question text
    question_text   TEXT        NOT NULL,

    -- Multiple choice options (at least 2, up to 4)
    option_a        TEXT        NOT NULL,
    option_b        TEXT        NOT NULL,
    option_c        TEXT,
    option_d        TEXT,

    -- Official correct answer: 'a', 'b', 'c', or 'd'
    -- Sourced from ASSEB official answer key
    correct_answer  TEXT        NOT NULL CHECK (correct_answer IN ('a','b','c','d')),

    -- Per-question marks (overrides paper default if set)
    -- Used for Paper IV where Q1-125 = 1 mark, Q126-150 = 2 marks
    marks           NUMERIC(4,2),

    -- Per-question negative marks (overrides paper default if set)
    negative_marks  NUMERIC(4,2),

    -- Topic/subject classification (e.g. 'General Studies', 'Reading Comprehension')
    topic           TEXT,

    -- Section within the paper (e.g. 'Part A', 'Part B')
    section         TEXT,

    -- Language of this question (for multilingual papers)
    language        TEXT        DEFAULT 'English',

    -- Import tracking
    imported_at     TIMESTAMPTZ DEFAULT now(),
    imported_from   TEXT,
    verified_by     TEXT,

    -- Audit
    created_date    TIMESTAMPTZ DEFAULT now(),
    updated_date    TIMESTAMPTZ DEFAULT now(),
    created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    is_deleted      BOOLEAN     DEFAULT false

);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_adre_q_paper_id
    ON public.adre_paper_questions (paper_id);

CREATE INDEX IF NOT EXISTS idx_adre_q_paper_sort
    ON public.adre_paper_questions (paper_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_adre_q_paper_qn
    ON public.adre_paper_questions (paper_id, question_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_adre_q_paper_qn_unique
    ON public.adre_paper_questions (paper_id, question_number)
    WHERE is_deleted = false;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.adre_paper_questions ENABLE ROW LEVEL SECURITY;

-- Public read access: all users (including anon) can read published questions
-- Questions are public exam prep content, not user-private data
CREATE POLICY "adre_questions_public_read"
    ON public.adre_paper_questions
    FOR SELECT
    USING (is_deleted = false);

-- Admin write: only authenticated admin users can insert/update/delete
-- Uses the same admin check pattern as other Studyria tables
CREATE POLICY "adre_questions_admin_insert"
    ON public.adre_paper_questions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "adre_questions_admin_update"
    ON public.adre_paper_questions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "adre_questions_admin_delete"
    ON public.adre_paper_questions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.adre_paper_questions IS
    'ADRE previous-year paper questions. Imported from official ASSEB/SLRC PDFs only.';

COMMENT ON COLUMN public.adre_paper_questions.paper_id IS
    'Matches the JS config ID in adre-papers.js (e.g. adre2-2024-p1)';

COMMENT ON COLUMN public.adre_paper_questions.marks IS
    'Per-question marks. Overrides paper default. Used for variable-marking papers like Paper IV.';

COMMENT ON COLUMN public.adre_paper_questions.negative_marks IS
    'Per-question negative marks. Overrides paper default. Set per question for variable-marking papers.';

COMMENT ON COLUMN public.adre_paper_questions.correct_answer IS
    'Official answer from ASSEB answer key. Only a/b/c/d accepted.';
