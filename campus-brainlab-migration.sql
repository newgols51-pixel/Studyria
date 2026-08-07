-- ═══════════════════════════════════════════════════════════════════════
-- STUDYRIA V5.0 — CAMPUS & BRAINLAB MIGRATION
-- Additive only. No existing tables modified. No drops.
-- Run in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- ── CAMPUS TABLES ────────────────────────────────────────────────────

-- 1. Campus feed items (admin-published)
CREATE TABLE IF NOT EXISTS public.campus_feed (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  feed_type     text NOT NULL DEFAULT 'general'
    CHECK (feed_type IN ('continue_reading','today_quiz','recommended_pdf','recommended_job','pending_revision','upcoming_exam','ai_suggestion','general')),
  title         text NOT NULL,
  subtitle      text,
  link_data     jsonb DEFAULT '{}',
  icon          text,
  priority      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','review','published','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  created_by    uuid REFERENCES auth.users(id),
  updated_by    uuid REFERENCES auth.users(id),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_campus_feed_user     ON public.campus_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_campus_feed_status   ON public.campus_feed(status);
CREATE INDEX IF NOT EXISTS idx_campus_feed_priority ON public.campus_feed(priority DESC);

-- 2. Study sessions (focus timer logs)
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pdf_id          text,
  subject         text,
  duration_secs   integer NOT NULL DEFAULT 0,
  mode            text NOT NULL DEFAULT 'focus'
    CHECK (mode IN ('focus','break','deep_focus')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_deleted      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user  ON public.study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_start ON public.study_sessions(started_at DESC);

-- 3. Study notes (quick notes)
CREATE TABLE IF NOT EXISTS public.study_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pdf_id        text,
  title         text NOT NULL DEFAULT 'Untitled',
  content       text NOT NULL DEFAULT '',
  color         text DEFAULT '#1a1a2e',
  pinned        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_study_notes_user   ON public.study_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_study_notes_pinned ON public.study_notes(user_id, pinned DESC);

-- 4. Sticky notes (visual board)
CREATE TABLE IF NOT EXISTS public.sticky_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content       text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#ffeb9c',
  position_x    integer NOT NULL DEFAULT 0,
  position_y    integer NOT NULL DEFAULT 0,
  width         integer DEFAULT 200,
  height        integer DEFAULT 160,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_user ON public.sticky_notes(user_id);

-- 5. Bookmarks
CREATE TABLE IF NOT EXISTS public.bookmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pdf_id        text NOT NULL,
  page_number   integer,
  label         text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON public.bookmarks(user_id);

-- 6. Study calendar events
CREATE TABLE IF NOT EXISTS public.study_calendar (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  event_type    text NOT NULL DEFAULT 'study'
    CHECK (event_type IN ('study','exam','revision','deadline','reminder','break')),
  scheduled_at timestamptz NOT NULL,
  duration_mins integer DEFAULT 60,
  completed     boolean NOT NULL DEFAULT false,
  color         text DEFAULT '#3d8ef8',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_study_calendar_user   ON public.study_calendar(user_id);
CREATE INDEX IF NOT EXISTS idx_study_calendar_when   ON public.study_calendar(scheduled_at);

-- 7. Study goals
CREATE TABLE IF NOT EXISTS public.study_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  target_value  integer NOT NULL DEFAULT 1,
  current_value integer NOT NULL DEFAULT 0,
  unit          text DEFAULT 'pages',
  deadline      timestamptz,
  status        text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','abandoned')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_study_goals_user   ON public.study_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_study_goals_status ON public.study_goals(user_id, status);

-- 8. Reading/study history
CREATE TABLE IF NOT EXISTS public.study_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pdf_id        text NOT NULL,
  pdf_title     text,
  pages_read    integer DEFAULT 0,
  time_spent    integer DEFAULT 0,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_study_history_user  ON public.study_history(user_id);
CREATE INDEX IF NOT EXISTS idx_study_history_last  ON public.study_history(user_id, last_read_at DESC);

-- 9. Exam countdowns
CREATE TABLE IF NOT EXISTS public.exam_countdown (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_name     text NOT NULL,
  exam_date     timestamptz NOT NULL,
  subject       text,
  days_per_page integer DEFAULT 10,
  color         text DEFAULT '#ef4444',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_exam_countdown_user ON public.exam_countdown(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_countdown_date ON public.exam_countdown(exam_date);

-- 10. Personal documents (resume vault, certificates)
CREATE TABLE IF NOT EXISTS public.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type      text NOT NULL DEFAULT 'personal'
    CHECK (doc_type IN ('resume','certificate','personal','other')),
  title         text NOT NULL,
  file_url      text,
  file_size     bigint,
  mime_type     text,
  tags          text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents(user_id, doc_type);

-- ── BRAINLAB TABLES ───────────────────────────────────────────────────

-- 11. Quizzes (admin-created)
CREATE TABLE IF NOT EXISTS public.brainlab_quizzes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  category      text NOT NULL DEFAULT 'general',
  difficulty    text NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy','medium','hard','expert')),
  duration_mins integer DEFAULT 30,
  total_marks   integer DEFAULT 100,
  status        text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','published','archived')),
  created_by    uuid REFERENCES auth.users(id),
  updated_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_brainlab_quizzes_status   ON public.brainlab_quizzes(status);
CREATE INDEX IF NOT EXISTS idx_brainlab_quizzes_category ON public.brainlab_quizzes(category);

-- 12. Quiz questions
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES public.brainlab_quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  option_a      text NOT NULL,
  option_b      text NOT NULL,
  option_c      text,
  option_d      text,
  correct_answer text NOT NULL CHECK (correct_answer IN ('a','b','c','d')),
  explanation   text,
  topic         text,
  difficulty    text DEFAULT 'medium',
  marks         integer DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON public.quiz_questions(quiz_id);

-- 13. Quiz attempts (user)
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id       uuid NOT NULL REFERENCES public.brainlab_quizzes(id) ON DELETE CASCADE,
  score         integer NOT NULL DEFAULT 0,
  total_marks   integer DEFAULT 100,
  answers       jsonb DEFAULT '[]',
  time_taken    integer DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON public.quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON public.quiz_attempts(quiz_id);

-- 14. Mock tests
CREATE TABLE IF NOT EXISTS public.mock_tests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  exam_type     text,
  duration_mins integer DEFAULT 180,
  total_marks   integer DEFAULT 100,
  status        text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','published','archived')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mock_tests_status ON public.mock_tests(status);

-- 15. Mock test questions
CREATE TABLE IF NOT EXISTS public.mock_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mock_id       uuid NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  option_a      text NOT NULL,
  option_b      text NOT NULL,
  option_c      text,
  option_d      text,
  correct_answer text CHECK (correct_answer IN ('a','b','c','d')),
  explanation   text,
  topic         text,
  marks         integer DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mock_questions_mock ON public.mock_questions(mock_id);

-- 16. Mock test results
CREATE TABLE IF NOT EXISTS public.mock_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mock_id       uuid NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
  score         integer NOT NULL DEFAULT 0,
  total_marks   integer DEFAULT 100,
  answers       jsonb DEFAULT '[]',
  time_taken    integer DEFAULT 0,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mock_results_user ON public.mock_results(user_id);

-- 17. Flashcards (admin-created)
CREATE TABLE IF NOT EXISTS public.flashcards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         text NOT NULL,
  front         text NOT NULL,
  back          text NOT NULL,
  difficulty    text DEFAULT 'medium',
  status        text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','review','published','archived')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_flashcards_topic   ON public.flashcards(topic);
CREATE INDEX IF NOT EXISTS idx_flashcards_status ON public.flashcards(status);

-- 18. Flashcard progress (user)
CREATE TABLE IF NOT EXISTS public.flashcard_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flashcard_id     uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  box_level       integer NOT NULL DEFAULT 1
    CHECK (box_level BETWEEN 1 AND 5),
  next_review_at  timestamptz NOT NULL DEFAULT now(),
  review_count    integer NOT NULL DEFAULT 0,
  last_reviewed   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_progress_user   ON public.flashcard_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_fc_progress_review ON public.flashcard_progress(user_id, next_review_at);

-- 19. Mistake notebook (user)
CREATE TABLE IF NOT EXISTS public.mistake_book (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  user_answer   text,
  correct_answer text,
  explanation    text,
  source        text DEFAULT 'quiz',
  topic          text,
  mastered      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mistake_book_user ON public.mistake_book(user_id);

-- 20. Current affairs (admin-published)
CREATE TABLE IF NOT EXISTS public.current_affairs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  content       text NOT NULL,
  category      text DEFAULT 'national',
  source        text,
  published_date date NOT NULL DEFAULT CURRENT_DATE,
  status        text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','review','published','archived')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  is_deleted    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_current_affairs_date   ON public.current_affairs(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_current_affairs_status ON public.current_affairs(status);

-- 21. Leaderboard
CREATE TABLE IF NOT EXISTS public.leaderboards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_points  integer NOT NULL DEFAULT 0,
  quizzes_taken integer DEFAULT 0,
  avg_score     numeric(5,2) DEFAULT 0,
  rank          integer,
  period        text DEFAULT 'all-time'
    CHECK (period IN ('daily','weekly','monthly','all-time')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_points ON public.leaderboards(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_period ON public.leaderboards(period, total_points DESC);

-- 22. Performance reports (user analytics)
CREATE TABLE IF NOT EXISTS public.performance_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type   text NOT NULL DEFAULT 'weekly'
    CHECK (report_type IN ('daily','weekly','monthly')),
  data          jsonb DEFAULT '{}',
  weak_topics   text[],
  strong_topics text[],
  total_study_time integer DEFAULT 0,
  total_quizzes   integer DEFAULT 0,
  avg_quiz_score  numeric(5,2) DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  is_deleted      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_perf_reports_user ON public.performance_reports(user_id);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────
-- User-owned tables: users can only access their own records
-- Admin-published tables: authenticated users can read published, admins can write

-- Helper: check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- CAMPUS user-owned tables
ALTER TABLE public.campus_feed        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sticky_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_calendar      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_countdown      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents           ENABLE ROW LEVEL SECURITY;

-- BRAINLAB user-owned tables
ALTER TABLE public.quiz_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_progress  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mistake_book        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reports  ENABLE ROW LEVEL SECURITY;

-- BRAINLAB admin-published tables
ALTER TABLE public.brainlab_quizzes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_tests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.current_affairs      ENABLE ROW LEVEL SECURITY;

-- ── POLICIES: User-owned tables ──────────────────────────────────────
-- (campus_feed: published items readable by all authenticated, user items by owner)
CREATE POLICY "campus_feed_read" ON public.campus_feed
  FOR SELECT TO authenticated
  USING (is_deleted = false AND (status = 'published' OR auth.uid() = user_id OR is_admin()));
CREATE POLICY "campus_feed_write" ON public.campus_feed
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR is_admin())
  WITH CHECK (auth.uid() = user_id OR is_admin());

-- Study sessions
CREATE POLICY "study_sessions_own" ON public.study_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "study_sessions_admin" ON public.study_sessions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Study notes
CREATE POLICY "study_notes_own" ON public.study_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Sticky notes
CREATE POLICY "sticky_notes_own" ON public.sticky_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Bookmarks
CREATE POLICY "bookmarks_own" ON public.bookmarks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Study calendar
CREATE POLICY "study_calendar_own" ON public.study_calendar
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Study goals
CREATE POLICY "study_goals_own" ON public.study_goals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Study history
CREATE POLICY "study_history_own" ON public.study_history
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Exam countdown
CREATE POLICY "exam_countdown_own" ON public.exam_countdown
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- Documents
CREATE POLICY "documents_own" ON public.documents
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- ── POLICIES: BrainLab user-owned tables ──────────────────────────────
CREATE POLICY "quiz_attempts_own" ON public.quiz_attempts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mock_results_own" ON public.mock_results
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "flashcard_progress_own" ON public.flashcard_progress
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mistake_book_own" ON public.mistake_book
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "leaderboards_read" ON public.leaderboards
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "leaderboards_write" ON public.leaderboards
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "perf_reports_own" ON public.performance_reports
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND is_deleted = false)
  WITH CHECK (auth.uid() = user_id);

-- ── POLICIES: BrainLab admin-published tables ─────────────────────────
-- Published content readable by all authenticated; admin can do everything
CREATE POLICY "quizzes_read" ON public.brainlab_quizzes
  FOR SELECT TO authenticated
  USING (is_deleted = false AND (status = 'published' OR is_admin()));
CREATE POLICY "quizzes_admin" ON public.brainlab_quizzes
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "quiz_questions_read" ON public.quiz_questions
  FOR SELECT TO authenticated
  USING (is_deleted = false);
CREATE POLICY "quiz_questions_admin" ON public.quiz_questions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "mock_tests_read" ON public.mock_tests
  FOR SELECT TO authenticated
  USING (is_deleted = false AND (status = 'published' OR is_admin()));
CREATE POLICY "mock_tests_admin" ON public.mock_tests
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "mock_questions_read" ON public.mock_questions
  FOR SELECT TO authenticated
  USING (is_deleted = false);
CREATE POLICY "mock_questions_admin" ON public.mock_questions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "flashcards_read" ON public.flashcards
  FOR SELECT TO authenticated
  USING (is_deleted = false AND (status = 'published' OR is_admin()));
CREATE POLICY "flashcards_admin" ON public.flashcards
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "current_affairs_read" ON public.current_affairs
  FOR SELECT TO authenticated
  USING (is_deleted = false AND (status = 'published' OR is_admin()));
CREATE POLICY "current_affairs_admin" ON public.current_affairs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── REALTIME ─────────────────────────────────────────────────────────
ALTER TABLE public.campus_feed        REPLICA IDENTITY FULL;
ALTER TABLE public.study_notes        REPLICA IDENTITY FULL;
ALTER TABLE public.study_goals        REPLICA IDENTITY FULL;
ALTER TABLE public.leaderboards       REPLICA IDENTITY FULL;

-- ═══════════════════════════════════════════════════════════════════════
-- END MIGRATION — all tables additive, RLS enabled, no existing changes
-- ═══════════════════════════════════════════════════════════════════════
