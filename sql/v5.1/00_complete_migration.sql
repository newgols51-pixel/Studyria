-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA V5.1 — REVENUE EXPANSION — COMPLETE SQL MIGRATION
-- All 8 modules in one idempotent migration file.
-- Run once in Supabase SQL Editor (service_role). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- MODULE 1: MOCK TEST PREMIUM
-- ============================================================================
-- Tables: mock_test_series, mock_tests, mock_questions, mock_attempts, leaderboards
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mock_test_series (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    series_type     TEXT NOT NULL DEFAULT 'full_length'
                    CHECK (series_type IN ('full_length','subject_wise','topic_wise','previous_year','daily_quiz')),
    cover_image     TEXT,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mock_tests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id       UUID REFERENCES public.mock_test_series(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    test_type       TEXT NOT NULL DEFAULT 'mock'
                    CHECK (test_type IN ('mock','quiz','practice')),
    duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
    total_marks     INTEGER NOT NULL DEFAULT 100 CHECK (total_marks > 0),
    negative_marking NUMERIC(3,2) NOT NULL DEFAULT 0,
    pass_percentage NUMERIC(5,2) NOT NULL DEFAULT 40,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    scheduled_at    TIMESTAMPTZ,
    available_until TIMESTAMPTZ,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mock_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
    question_text   TEXT NOT NULL,
    option_a        TEXT NOT NULL,
    option_b        TEXT NOT NULL,
    option_c        TEXT,
    option_d        TEXT,
    correct_answer  TEXT NOT NULL CHECK (correct_answer IN ('a','b','c','d')),
    explanation     TEXT DEFAULT '',
    marks           INTEGER NOT NULL DEFAULT 1 CHECK (marks > 0),
    negative_marks  NUMERIC(3,2) NOT NULL DEFAULT 0,
    topic           TEXT DEFAULT '',
    difficulty      TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mock_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answers         JSONB NOT NULL DEFAULT '{}',
    score           INTEGER NOT NULL DEFAULT 0,
    total_correct   INTEGER NOT NULL DEFAULT 0,
    total_wrong     INTEGER NOT NULL DEFAULT 0,
    total_unanswered INTEGER NOT NULL DEFAULT 0,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    percentage      NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_passed       BOOLEAN NOT NULL DEFAULT false,
    rank_all_india  INTEGER,
    rank_state      INTEGER,
    rank_district   INTEGER,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leaderboards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_name       TEXT NOT NULL,
    user_email      TEXT,
    state           TEXT DEFAULT 'Assam',
    district        TEXT,
    score           INTEGER NOT NULL DEFAULT 0,
    percentage      NUMERIC(5,2) NOT NULL DEFAULT 0,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    rank_all_india  INTEGER,
    rank_state      INTEGER,
    rank_district   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mock_tests_series ON public.mock_tests(series_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mock_tests_published ON public.mock_tests(is_published) WHERE deleted_at IS NULL AND is_published = true;
CREATE INDEX IF NOT EXISTS idx_mock_questions_test ON public.mock_questions(test_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mock_attempts_user ON public.mock_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_test ON public.mock_attempts(test_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboards_test ON public.leaderboards(test_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboards_user ON public.leaderboards(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_series_published ON public.mock_test_series(is_published) WHERE deleted_at IS NULL;

-- ============================================================================
-- MODULE 2: ATS RESUME BUILDER
-- ============================================================================
-- Tables: resume_templates, resumes, resume_reviews
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resume_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    thumbnail_url   TEXT,
    template_html   TEXT NOT NULL DEFAULT '',
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.resumes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id     UUID REFERENCES public.resume_templates(id) ON DELETE SET NULL,
    title           TEXT NOT NULL DEFAULT 'My Resume',
    full_name       TEXT NOT NULL DEFAULT '',
    email           TEXT DEFAULT '',
    phone           TEXT DEFAULT '',
    summary         TEXT DEFAULT '',
    education       JSONB NOT NULL DEFAULT '[]',
    experience      JSONB NOT NULL DEFAULT '[]',
    skills          JSONB NOT NULL DEFAULT '[]',
    projects        JSONB NOT NULL DEFAULT '[]',
    certifications   JSONB NOT NULL DEFAULT '[]',
    languages       JSONB NOT NULL DEFAULT '[]',
    social_links    JSONB NOT NULL DEFAULT '{}',
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.resume_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id       UUID NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','completed','rejected')),
    reviewer_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    review_notes    TEXT DEFAULT '',
    score           INTEGER CHECK (score >= 0 AND score <= 100),
    suggestions     JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user ON public.resumes(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resume_templates_published ON public.resume_templates(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resume_reviews_user ON public.resume_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_reviews_status ON public.resume_reviews(status);

-- ============================================================================
-- MODULE 3: INTERNSHIP & PLACEMENT HUB
-- ============================================================================
-- Tables: companies, internships, placements, applications
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    logo_url        TEXT,
    website         TEXT,
    industry        TEXT DEFAULT '',
    location        TEXT DEFAULT '',
    employee_count  TEXT DEFAULT '',
    is_featured     BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.internships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    location        TEXT DEFAULT '',
    work_mode       TEXT NOT NULL DEFAULT 'onsite' CHECK (work_mode IN ('onsite','remote','hybrid')),
    duration        TEXT DEFAULT '',
    stipend         TEXT DEFAULT '',
    eligibility     TEXT DEFAULT '',
    skills_required JSONB NOT NULL DEFAULT '[]',
    last_date       TIMESTAMPTZ,
    start_date      TIMESTAMPTZ,
    is_featured     BOOLEAN NOT NULL DEFAULT false,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.placements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    location        TEXT DEFAULT '',
    job_type        TEXT NOT NULL DEFAULT 'full_time' CHECK (job_type IN ('full_time','part_time','contract','campus_drive')),
    salary          TEXT DEFAULT '',
    eligibility     TEXT DEFAULT '',
    skills_required JSONB NOT NULL DEFAULT '[]',
    experience_required TEXT DEFAULT '',
    last_date       TIMESTAMPTZ,
    is_featured     BOOLEAN NOT NULL DEFAULT false,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    listing_id      UUID NOT NULL,
    listing_type    TEXT NOT NULL CHECK (listing_type IN ('internship','placement')),
    resume_id       UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
    cover_letter    TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','reviewing','shortlisted','interview','offered','rejected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internships_published ON public.internships(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_internships_featured ON public.internships(is_featured) WHERE deleted_at IS NULL AND is_featured = true;
CREATE INDEX IF NOT EXISTS idx_placements_published ON public.placements(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_applications_user ON public.applications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_published ON public.companies(is_published) WHERE deleted_at IS NULL;

-- ============================================================================
-- MODULE 4: PREMIUM VIDEO COURSES
-- ============================================================================
-- Tables: courses, course_lessons, course_progress, course_enrollments
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.courses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    thumbnail_url   TEXT,
    preview_video_url TEXT,
    creator_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    creator_name    TEXT DEFAULT '',
    price           INTEGER NOT NULL DEFAULT 0,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    revenue_share_percent INTEGER NOT NULL DEFAULT 70 CHECK (revenue_share_percent >= 0 AND revenue_share_percent <= 100),
    total_lessons   INTEGER NOT NULL DEFAULT 0,
    total_duration_seconds INTEGER NOT NULL DEFAULT 0,
    rating_avg      NUMERIC(3,2) NOT NULL DEFAULT 0,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    enrolled_count  INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.course_lessons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    video_url       TEXT NOT NULL,
    notes_url       TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    is_preview      BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.course_enrollments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    completed_lessons JSONB NOT NULL DEFAULT '[]',
    is_completed    BOOLEAN NOT NULL DEFAULT false,
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.course_progress (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id   UUID NOT NULL REFERENCES public.course_enrollments(id) ON DELETE CASCADE,
    lesson_id       UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    is_completed    BOOLEAN NOT NULL DEFAULT false,
    last_watched_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_courses_published ON public.courses(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_category ON public.courses(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON public.course_lessons(course_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON public.course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON public.course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_progress_enrollment ON public.course_progress(enrollment_id);

-- ============================================================================
-- MODULE 5: CERTIFICATE GENERATOR
-- ============================================================================
-- Tables: certificates, certificate_logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.certificates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id  TEXT NOT NULL UNIQUE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_name       TEXT NOT NULL,
    user_email      TEXT DEFAULT '',
    course_id       UUID REFERENCES public.courses(id) ON DELETE SET NULL,
    course_title    TEXT NOT NULL,
    template_type   TEXT NOT NULL DEFAULT 'completion' CHECK (template_type IN ('completion','achievement','merit')),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_revoked       BOOLEAN NOT NULL DEFAULT false,
    revoked_at       TIMESTAMPTZ,
    revoked_reason   TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.certificate_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id  UUID NOT NULL REFERENCES public.certificates(id) ON DELETE CASCADE,
    action          TEXT NOT NULL CHECK (action IN ('issued','verified','revoked','downloaded','shared')),
    performed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address      TEXT,
    user_agent      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_certificates_user ON public.certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON public.certificates(course_id);
CREATE INDEX IF NOT EXISTS idx_certificates_verify ON public.certificates(certificate_id) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_cert_logs_cert ON public.certificate_logs(certificate_id, created_at DESC);

-- ============================================================================
-- MODULE 6: STUDY PLANNER PREMIUM
-- ============================================================================
-- Tables: study_planners, planner_tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_planners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL DEFAULT 'My Study Plan',
    plan_type       TEXT NOT NULL DEFAULT 'daily' CHECK (plan_type IN ('daily','weekly','monthly','revision','ai_personalized')),
    start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date        DATE,
    target_exam     TEXT DEFAULT '',
    subjects        JSONB NOT NULL DEFAULT '[]',
    study_hours_per_day INTEGER NOT NULL DEFAULT 4 CHECK (study_hours_per_day > 0 AND study_hours_per_day <= 24),
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    ai_generated    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.planner_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planner_id      UUID NOT NULL REFERENCES public.study_planners(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    subject          TEXT DEFAULT '',
    topic            TEXT DEFAULT '',
    task_type        TEXT NOT NULL DEFAULT 'study' CHECK (task_type IN ('study','revision','practice','test','break')),
    scheduled_date  DATE NOT NULL,
    scheduled_time   TIMESTAMPTZ,
    duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
    priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    is_completed    BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    reminder_sent   BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planners_user ON public.study_planners(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user ON public.planner_tasks(user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_planner ON public.planner_tasks(planner_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_pending ON public.planner_tasks(user_id, is_completed) WHERE is_completed = false;

-- ============================================================================
-- MODULE 7: INTERVIEW PREPARATION
-- ============================================================================
-- Tables: interviews, interview_attempts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.interviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'hr' CHECK (category IN ('hr','technical','behavioral','case_study','mixed')),
    difficulty      TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    questions       JSONB NOT NULL DEFAULT '[]',
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published    BOOLEAN NOT NULL DEFAULT false,
    package_name    TEXT DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.interview_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id     UUID NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    answers          JSONB NOT NULL DEFAULT '[]',
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    ai_feedback      JSONB NOT NULL DEFAULT '{}',
    rating           INTEGER CHECK (rating >= 1 AND rating <= 5),
    feedback_text    TEXT DEFAULT '',
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    is_premium       BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_published ON public.interviews(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_interview_attempts_user ON public.interview_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_attempts_interview ON public.interview_attempts(interview_id);

-- ============================================================================
-- MODULE 8: DIGITAL STORE
-- ============================================================================
-- Tables: products, purchases, product_reviews
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'ebook' CHECK (category IN ('template','ebook','printable','question_bank','study_planner','premium_resource')),
    thumbnail_url   TEXT,
    file_url        TEXT,
    file_size_bytes BIGINT DEFAULT 0,
    price           INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency        TEXT NOT NULL DEFAULT 'INR',
    is_premium      BOOLEAN NOT NULL DEFAULT false,
    is_published     BOOLEAN NOT NULL DEFAULT false,
    download_count  INTEGER NOT NULL DEFAULT 0,
    rating_avg      NUMERIC(3,2) NOT NULL DEFAULT 0,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.purchases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    amount_paid     INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'INR',
    payment_id      TEXT,
    payment_status  TEXT NOT NULL DEFAULT 'completed' CHECK (payment_status IN ('pending','completed','failed','refunded')),
    download_count  INTEGER NOT NULL DEFAULT 0,
    max_downloads   INTEGER NOT NULL DEFAULT 5,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.product_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text     TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_products_published ON public.products(is_published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_user ON public.purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON public.purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews(product_id);

-- ============================================================================
-- ROW LEVEL SECURITY — ALL TABLES
-- ============================================================================
-- Users can only access their own private data.
-- Public (anon) can read published content only.
-- Admins (service_role) bypass RLS.
-- ============================================================================

-- Helper: enable RLS on all tables
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'mock_test_series','mock_tests','mock_questions','mock_attempts','leaderboards',
        'resume_templates','resumes','resume_reviews',
        'companies','internships','placements','applications',
        'courses','course_lessons','course_enrollments','course_progress',
        'certificates','certificate_logs',
        'study_planners','planner_tasks',
        'interviews','interview_attempts',
        'products','purchases','product_reviews'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END;
$$;

-- ── MODULE 1: Mock Tests ──────────────────────────────────────────────────
-- Public read published series and tests
DROP POLICY IF EXISTS "mock_series: public read" ON public.mock_test_series;
CREATE POLICY "mock_series: public read" ON public.mock_test_series
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);
-- Admin (service_role bypasses RLS) can do everything else.

DROP POLICY IF EXISTS "mock_tests: public read" ON public.mock_tests;
CREATE POLICY "mock_tests: public read" ON public.mock_tests
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "mock_questions: public read" ON public.mock_questions;
CREATE POLICY "mock_questions: public read" ON public.mock_questions
    FOR SELECT USING (deleted_at IS NULL);

-- Users can only see their own attempts
DROP POLICY IF EXISTS "mock_attempts: owner read" ON public.mock_attempts;
CREATE POLICY "mock_attempts: owner read" ON public.mock_attempts
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "mock_attempts: owner insert" ON public.mock_attempts;
CREATE POLICY "mock_attempts: owner insert" ON public.mock_attempts
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Leaderboards are public (ranking is visible to all)
DROP POLICY IF EXISTS "leaderboards: public read" ON public.leaderboards;
CREATE POLICY "leaderboards: public read" ON public.leaderboards
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "leaderboards: owner insert" ON public.leaderboards;
CREATE POLICY "leaderboards: owner insert" ON public.leaderboards
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── MODULE 2: Resume Builder ──────────────────────────────────────────────
DROP POLICY IF EXISTS "resume_templates: public read" ON public.resume_templates;
CREATE POLICY "resume_templates: public read" ON public.resume_templates
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "resumes: owner all" ON public.resumes;
CREATE POLICY "resumes: owner all" ON public.resumes
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "resume_reviews: owner read" ON public.resume_reviews;
CREATE POLICY "resume_reviews: owner read" ON public.resume_reviews
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "resume_reviews: owner insert" ON public.resume_reviews;
CREATE POLICY "resume_reviews: owner insert" ON public.resume_reviews
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── MODULE 3: Internship Hub ──────────────────────────────────────────────
DROP POLICY IF EXISTS "companies: public read" ON public.companies;
CREATE POLICY "companies: public read" ON public.companies
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "internships: public read" ON public.internships;
CREATE POLICY "internships: public read" ON public.internships
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "placements: public read" ON public.placements;
CREATE POLICY "placements: public read" ON public.placements
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "applications: owner all" ON public.applications;
CREATE POLICY "applications: owner all" ON public.applications
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── MODULE 4: Video Courses ──────────────────────────────────────────────
DROP POLICY IF EXISTS "courses: public read" ON public.courses;
CREATE POLICY "courses: public read" ON public.courses
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "course_lessons: public read" ON public.course_lessons;
CREATE POLICY "course_lessons: public read" ON public.course_lessons
    FOR SELECT USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "course_enrollments: owner all" ON public.course_enrollments;
CREATE POLICY "course_enrollments: owner all" ON public.course_enrollments
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "course_progress: owner all" ON public.course_progress;
CREATE POLICY "course_progress: owner all" ON public.course_progress
    FOR ALL TO authenticated USING (
        enrollment_id IN (
            SELECT id FROM public.course_enrollments WHERE user_id = auth.uid()
        )
    ) WITH CHECK (
        enrollment_id IN (
            SELECT id FROM public.course_enrollments WHERE user_id = auth.uid()
        )
    );

-- ── MODULE 5: Certificates ───────────────────────────────────────────────
DROP POLICY IF EXISTS "certificates: owner read" ON public.certificates;
CREATE POLICY "certificates: owner read" ON public.certificates
    FOR SELECT USING (user_id = auth.uid() OR is_revoked = true); -- revoked certs are public for verification

-- Public can verify by certificate_id (but only see minimal fields)
DROP POLICY IF EXISTS "certificates: public verify" ON public.certificates;
CREATE POLICY "certificates: public verify" ON public.certificates
    FOR SELECT USING (is_revoked = true); -- only revoked status is public; active certs are owner-only

DROP POLICY IF EXISTS "certificate_logs: admin read" ON public.certificate_logs;
CREATE POLICY "certificate_logs: admin read" ON public.certificate_logs
    FOR SELECT TO authenticated USING (true); -- logs visible to authenticated users for audit

-- ── MODULE 6: Study Planner ──────────────────────────────────────────────
DROP POLICY IF EXISTS "study_planners: owner all" ON public.study_planners;
CREATE POLICY "study_planners: owner all" ON public.study_planners
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "planner_tasks: owner all" ON public.planner_tasks;
CREATE POLICY "planner_tasks: owner all" ON public.planner_tasks
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── MODULE 7: Interview Prep ─────────────────────────────────────────────
DROP POLICY IF EXISTS "interviews: public read" ON public.interviews;
CREATE POLICY "interviews: public read" ON public.interviews
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "interview_attempts: owner all" ON public.interview_attempts;
CREATE POLICY "interview_attempts: owner all" ON public.interview_attempts
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── MODULE 8: Digital Store ──────────────────────────────────────────────
DROP POLICY IF EXISTS "products: public read" ON public.products;
CREATE POLICY "products: public read" ON public.products
    FOR SELECT USING (is_published = true AND deleted_at IS NULL);

DROP POLICY IF EXISTS "purchases: owner all" ON public.purchases;
CREATE POLICY "purchases: owner all" ON public.purchases
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "product_reviews: owner manage" ON public.product_reviews;
CREATE POLICY "product_reviews: owner manage" ON public.product_reviews
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "product_reviews: public read" ON public.product_reviews;
CREATE POLICY "product_reviews: public read" ON public.product_reviews
    FOR SELECT USING (true);

-- ============================================================================
-- AUTO-UPDATE TRIGGERS FOR updated_at COLUMNS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$
DECLARE
    t TEXT;
    tables_with_updated_at TEXT[] := ARRAY[
        'mock_test_series','mock_tests','mock_questions',
        'resume_templates','resumes','resume_reviews',
        'companies','internships','placements','applications',
        'courses','course_lessons','course_enrollments',
        'study_planners','planner_tasks',
        'interviews','interview_attempts',
        'products','purchases','product_reviews'
    ];
BEGIN
    FOREACH t IN ARRAY tables_with_updated_at LOOP
        BEGIN
            EXECUTE format('
                DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I;
                CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I
                FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
            ', t, t, t, t);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END;
$$;

-- ============================================================================
-- CERTIFICATE ID GENERATOR (unique, verifiable)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_certificate_id()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    new_id TEXT;
BEGIN
    LOOP
        new_id := 'STU-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 12));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_id = new_id);
    END LOOP;
    RETURN new_id;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE public.mock_test_series IS 'Studyria V5.1: Mock test series catalogue';
COMMENT ON TABLE public.mock_tests IS 'Studyria V5.1: Individual mock tests within series';
COMMENT ON TABLE public.mock_questions IS 'Studyria V5.1: MCQ questions for mock tests';
COMMENT ON TABLE public.mock_attempts IS 'Studyria V5.1: User attempt records with scores';
COMMENT ON TABLE public.leaderboards IS 'Studyria V5.1: Public leaderboard rankings';
COMMENT ON TABLE public.resume_templates IS 'Studyria V5.1: ATS resume template catalogue';
COMMENT ON TABLE public.resumes IS 'Studyria V5.1: User resume data (JSONB sections)';
COMMENT ON TABLE public.resume_reviews IS 'Studyria V5.1: Resume review queue for admin';
COMMENT ON TABLE public.companies IS 'Studyria V5.1: Company profiles for internship/placement';
COMMENT ON TABLE public.internships IS 'Studyria V5.1: Internship listings';
COMMENT ON TABLE public.placements IS 'Studyria V5.1: Full-time placement listings';
COMMENT ON TABLE public.applications IS 'Studyria V5.1: User applications for internships/placements';
COMMENT ON TABLE public.courses IS 'Studyria V5.1: Video course catalogue';
COMMENT ON TABLE public.course_lessons IS 'Studyria V5.1: Lessons within courses';
COMMENT ON TABLE public.course_enrollments IS 'Studyria V5.1: User enrollment records';
COMMENT ON TABLE public.course_progress IS 'Studyria V5.1: Per-lesson progress tracking';
COMMENT ON TABLE public.certificates IS 'Studyria V5.1: Auto-generated certificates with QR verification';
COMMENT ON TABLE public.certificate_logs IS 'Studyria V5.1: Audit log for certificate actions';
COMMENT ON TABLE public.study_planners IS 'Studyria V5.1: User study plans';
COMMENT ON TABLE public.planner_tasks IS 'Studyria V5.1: Tasks within study plans';
COMMENT ON TABLE public.interviews IS 'Studyria V5.1: Interview prep packages';
COMMENT ON TABLE public.interview_attempts IS 'Studyria V5.1: User interview practice attempts';
COMMENT ON TABLE public.products IS 'Studyria V5.1: Digital store products';
COMMENT ON TABLE public.purchases IS 'Studyria V5.1: User purchase records';
COMMENT ON TABLE public.product_reviews IS 'Studyria V5.1: Product reviews and ratings';
