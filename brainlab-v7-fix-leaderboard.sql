-- ═══════════════════════════════════════════════════════════════════════
-- FIX: bl_leaderboard() — column-name collision with its own RETURNS TABLE
-- output names (points/tests) caused "column reference points is ambiguous".
-- Run this single statement in Supabase → SQL Editor. Safe: only replaces
-- the function, does not touch bl_attempts or bl_submit_attempt.
-- ═══════════════════════════════════════════════════════════════════════

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
    SELECT a.user_id AS uid,
           (SUM(a.correct) * 10 + COUNT(*) * 2)::integer AS pts,
           COUNT(*)::integer AS cnt,
           CASE WHEN SUM(a.total) > 0 THEN ROUND(AVG(a.score))::integer ELSE 0 END AS acc_pct
      FROM public.bl_attempts a
     WHERE a.created_at >= v_since
     GROUP BY a.user_id
  ),
  ranked AS (
    SELECT agg.uid, agg.pts, agg.cnt, agg.acc_pct,
           COALESCE(NULLIF(u.raw_user_meta_data->>'full_name',''), SPLIT_PART(u.email,'@',1)) AS uname,
           RANK() OVER (ORDER BY agg.pts DESC) AS rnk,
           COUNT(*) OVER ()::integer AS total_users
      FROM agg JOIN auth.users u ON u.id = agg.uid
  )
  SELECT ranked.rnk,
         ranked.uname,
         ranked.pts,
         ranked.cnt,
         ranked.acc_pct,
         (ranked.uid = v_uid),
         ranked.total_users
    FROM ranked
   WHERE ranked.rnk <= 50 OR ranked.uid = v_uid
   ORDER BY ranked.rnk ASC;
END $$;
GRANT EXECUTE ON FUNCTION public.bl_leaderboard(text) TO authenticated;
