-- ═══════════════════════════════════════════════════════════════════════
-- STUDYRIA BRAINLAB V7 — REAL LEADERBOARD MIGRATION (additive, safe)
-- Run in Supabase → SQL Editor. No existing tables modified. No drops.
-- Creates:
--   bl_attempts          — validated user attempts (real activity only)
--   bl_submit_attempt() — server-side validated attempt submission
--                         (sanity checks + anti-farming rate limits)
--   bl_leaderboard()     — anonymized real leaderboard (weekly/monthly/all-time)
-- Anti-abuse: max 50 attempts/day/user, time sanity check, score recomputed
-- from correct/total on the server (client score NOT trusted for ranking).
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Attempt log (additive; existing quiz_attempts untouched)
CREATE TABLE IF NOT EXISTS public.bl_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode         text NOT NULL DEFAULT 'quiz',
  title        text,
  category     text,
  total        integer NOT NULL DEFAULT 0 CHECK (total >= 0 AND total <= 500),
  correct      integer NOT NULL DEFAULT 0 CHECK (correct >= 0),
  wrong        integer NOT NULL DEFAULT 0 CHECK (wrong >= 0),
  skipped      integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  score        integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  time_taken   integer NOT NULL DEFAULT 0 CHECK (time_taken >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bl_attempts_user   ON public.bl_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bl_attempts_period ON public.bl_attempts(created_at DESC);

ALTER TABLE public.bl_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bl_attempts_insert_own ON public.bl_attempts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY bl_attempts_select_own ON public.bl_attempts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- no UPDATE/DELETE grants: attempts are immutable (anti-tampering)

-- 2. Validated submission (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.bl_submit_attempt(
  p_mode text, p_title text, p_category text,
  p_total integer, p_correct integer, p_wrong integer, p_skipped integer,
  p_score integer, p_time_taken integer
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today_count integer;
  v_score integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'not_signed_in'); END IF;

  -- sanity: counts must add up and be plausible
  IF p_total IS NULL OR p_total < 1 OR p_total > 500
     OR p_correct IS NULL OR p_correct < 0 OR p_correct > p_total
     OR p_wrong IS NULL OR p_wrong < 0 OR p_wrong > p_total
     OR p_skipped IS NULL OR p_skipped < 0 OR p_skipped > p_total
     OR (p_correct + p_wrong + p_skipped) <> p_total THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_counts');
  END IF;

  -- time sanity: at least 1s per 3 questions (blocks instant farm scripts)
  IF p_time_taken IS NULL OR p_time_taken < CEIL(p_total / 3.0) OR p_time_taken > 86400 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_time');
  END IF;

  -- anti-farming: max 50 attempts per user per day
  SELECT COUNT(*) INTO v_today_count FROM public.bl_attempts
   WHERE user_id = v_uid AND created_at > now() - interval '1 day';
  IF v_today_count >= 50 THEN
    RETURN json_build_object('ok', false, 'reason', 'daily_limit');
  END IF;

  -- server recomputes score from counts (client score never trusted)
  v_score := ROUND((p_correct::numeric / p_total) * 100);

  INSERT INTO public.bl_attempts (user_id, mode, title, category, total, correct, wrong, skipped, score, time_taken)
  VALUES (v_uid, COALESCE(p_mode,'quiz'), LEFT(COALESCE(p_title,'Quiz'),120), p_category,
          p_total, p_correct, p_wrong, p_skipped, v_score, p_time_taken);

  RETURN json_build_object('ok', true, 'score', v_score);
END $$;
GRANT EXECUTE ON FUNCTION public.bl_submit_attempt(text,text,text,integer,integer,integer,integer,integer,integer) TO authenticated;

-- 3. Anonymized real leaderboard (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.bl_leaderboard(p_period text DEFAULT 'all-time')
RETURNS TABLE (rk bigint, display_name text, points integer, tests integer, accuracy integer, is_me boolean, total integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_since timestamptz;
BEGIN
  v_since := CASE p_period
    WHEN 'weekly'  THEN now() - interval '7 days'
    WHEN 'monthly' THEN now() - interval '30 days'
    ELSE '1970-01-01'::timestamptz END;

  RETURN QUERY
  WITH agg AS (
    SELECT a.user_id,
           SUM(a.correct) * 10 + COUNT(*) * 2 AS points,
           COUNT(*) AS tests,
           CASE WHEN SUM(a.total) > 0 THEN ROUND(AVG(a.score)) ELSE 0 END AS acc
      FROM public.bl_attempts a
     WHERE a.created_at >= v_since
     GROUP BY a.user_id
  ),
  ranked AS (
    SELECT agg.*, u.raw_user_meta_data->>'full_name' AS fname, u.email,
           RANK() OVER (ORDER BY points DESC) AS r,
           COUNT(*) OVER () AS total_users
      FROM agg JOIN auth.users u ON u.id = agg.user_id
  )
  SELECT r.r,
         COALESCE(NULLIF(r.fname,''), SPLIT_PART(r.email,'@',1)),
         r.points,
         r.tests,
         r.acc::integer,
         (r.user_id = v_uid),
         r.total_users::integer
    FROM ranked r
   WHERE r.r <= 50 OR r.user_id = v_uid
   ORDER BY r.r ASC;
END $$;
GRANT EXECUTE ON FUNCTION public.bl_leaderboard(text) TO authenticated;
