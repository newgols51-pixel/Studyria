-- ═══════════════════════════════════════════════════════════════════════
-- STUDYRIA ARENA — DATABASE MIGRATION
-- Production-ready Arena matchmaking & battle system
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. ARENA OPPONENTS TABLE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arena_opponents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    gender          text NOT NULL DEFAULT 'male',
    avatar          text DEFAULT '',
    rating          integer NOT NULL DEFAULT 1000,
    accuracy        numeric(5,2) NOT NULL DEFAULT 70.0,
    wins            integer NOT NULL DEFAULT 0,
    losses          integer NOT NULL DEFAULT 0,
    draws           integer NOT NULL DEFAULT 0,
    matches         integer NOT NULL DEFAULT 0,
    current_streak  integer NOT NULL DEFAULT 0,
    best_streak     integer NOT NULL DEFAULT 0,
    recent_form     text[] DEFAULT ARRAY[]::text[],
    strengths       text[] DEFAULT ARRAY[]::text[],
    weaknesses      text[] DEFAULT ARRAY[]::text[],
    difficulty_level text NOT NULL DEFAULT 'medium',
    response_speed  integer NOT NULL DEFAULT 5,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arena_opponents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena opponents: public read" ON public.arena_opponents
    FOR SELECT USING (true);

-- ── 2. ARENA MATCHES TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arena_matches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_code      text UNIQUE NOT NULL,
    mode            text NOT NULL DEFAULT '1v1',
    status          text NOT NULL DEFAULT 'waiting',
    question_count  integer NOT NULL DEFAULT 10,
    exam_type       text DEFAULT '',
    category        text DEFAULT '',
    difficulty      text DEFAULT 'medium',
    questions       jsonb DEFAULT '[]'::jsonb,
    host_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    host_score      integer NOT NULL DEFAULT 0,
    host_correct    integer NOT NULL DEFAULT 0,
    host_answers    jsonb DEFAULT '[]'::jsonb,
    host_rating_before integer DEFAULT 1000,
    host_rating_after  integer DEFAULT 1000,
    opponent_id     uuid REFERENCES public.arena_opponents(id) ON DELETE SET NULL,
    opponent_name   text DEFAULT '',
    opponent_score  integer NOT NULL DEFAULT 0,
    opponent_correct integer NOT NULL DEFAULT 0,
    opponent_answers jsonb DEFAULT '[]'::jsonb,
    opponent_rating_before integer DEFAULT 1000,
    opponent_rating_after  integer DEFAULT 1000,
    winner          text DEFAULT '',
    team_a          jsonb DEFAULT '[]'::jsonb,
    team_b          jsonb DEFAULT '[]'::jsonb,
    team_a_score    integer NOT NULL DEFAULT 0,
    team_b_score    integer NOT NULL DEFAULT 0,
    duration_seconds integer DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);
ALTER TABLE public.arena_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena matches: owner read" ON public.arena_matches
    FOR SELECT TO authenticated USING (auth.uid() = host_id);
CREATE POLICY "Arena matches: owner insert" ON public.arena_matches
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Arena matches: owner update" ON public.arena_matches
    FOR UPDATE TO authenticated USING (auth.uid() = host_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_host ON public.arena_matches(host_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON public.arena_matches(status);
CREATE INDEX IF NOT EXISTS idx_arena_matches_code ON public.arena_matches(match_code);

-- ── 3. ARENA BATTLE HISTORY TABLE ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arena_battle_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    match_id        uuid REFERENCES public.arena_matches(id) ON DELETE SET NULL,
    mode            text NOT NULL DEFAULT '1v1',
    opponent_name   text NOT NULL DEFAULT '',
    opponent_type   text NOT NULL DEFAULT 'ai',
    result          text NOT NULL,
    user_score      integer NOT NULL DEFAULT 0,
    opponent_score  integer NOT NULL DEFAULT 0,
    user_correct    integer NOT NULL DEFAULT 0,
    opponent_correct integer NOT NULL DEFAULT 0,
    question_count  integer NOT NULL DEFAULT 10,
    exam_type       text DEFAULT '',
    category        text DEFAULT '',
    difficulty      text DEFAULT 'medium',
    rating_before   integer NOT NULL DEFAULT 1000,
    rating_after    integer NOT NULL DEFAULT 1000,
    rating_change   integer NOT NULL DEFAULT 0,
    duration_seconds integer DEFAULT 0,
    weak_areas      jsonb DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arena_battle_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena history: owner read" ON public.arena_battle_history
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Arena history: owner insert" ON public.arena_battle_history
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_arena_history_user ON public.arena_battle_history(user_id);
CREATE INDEX IF NOT EXISTS idx_arena_history_created ON public.arena_battle_history(created_at DESC);

-- ── 4. ARENA USER STATS TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arena_user_stats (
    user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    rating          integer NOT NULL DEFAULT 1000,
    wins            integer NOT NULL DEFAULT 0,
    losses          integer NOT NULL DEFAULT 0,
    draws           integer NOT NULL DEFAULT 0,
    matches         integer NOT NULL DEFAULT 0,
    current_streak  integer NOT NULL DEFAULT 0,
    best_streak     integer NOT NULL DEFAULT 0,
    recent_form     text[] DEFAULT ARRAY[]::text[],
    total_xp        integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.arena_user_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena stats: owner read" ON public.arena_user_stats
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Arena stats: owner insert" ON public.arena_user_stats
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Arena stats: owner update" ON public.arena_user_stats
    FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ── 5. ARENA LEADERBOARD VIEW ──────────────────────────────────────
CREATE OR REPLACE VIEW public.arena_leaderboard AS
SELECT s.user_id, u.raw_user_meta_data->>'full_name' AS display_name,
    u.raw_user_meta_data->>'avatar' AS avatar, s.rating, s.wins, s.losses,
    s.draws, s.matches, s.current_streak, s.best_streak, s.total_xp
FROM public.arena_user_stats s
JOIN auth.users u ON u.id = s.user_id
WHERE s.matches > 0 ORDER BY s.rating DESC;
ALTER TABLE public.arena_leaderboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Arena leaderboard: public read" ON public.arena_leaderboard FOR SELECT USING (true);

-- ── 6. ELO RATING FUNCTION ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.arena_calculate_elo(
    p_player_rating integer, p_opponent_rating integer, p_result text, p_k_factor integer DEFAULT 32
) RETURNS integer AS $$
DECLARE v_expected_score numeric; v_actual_score numeric; v_rating_change numeric;
BEGIN
    v_expected_score := 1.0 / (1.0 + power(10.0, (p_opponent_rating - p_player_rating) / 400.0));
    IF p_result = 'win' THEN v_actual_score := 1.0;
    ELSIF p_result = 'draw' THEN v_actual_score := 0.5;
    ELSE v_actual_score := 0.0; END IF;
    v_rating_change := p_k_factor * (v_actual_score - v_expected_score);
    RETURN GREATEST(100, ROUND(p_player_rating + v_rating_change));
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER;

-- ── 7. SEED 8 PERMANENT OPPONENTS ──────────────────────────────────
INSERT INTO public.arena_opponents (name, gender, rating, accuracy, difficulty_level, response_speed, strengths, weaknesses) VALUES
('Rituraj Saikia',   'male',   1080, 72.5, 'medium', 3, ARRAY['GK','Current Affairs'], ARRAY['History','Polity']),
('Parthajit Bora',   'male',   1120, 81.0, 'hard',   6, ARRAY['Polity','History'],     ARRAY['Geography']),
('Ankur Hazarika',   'male',   1050, 75.0, 'medium', 5, ARRAY['History','Geography'],  ARRAY['Math']),
('Debojit Dutta',    'male',   1150, 68.0, 'hard',   2, ARRAY['GK','Geography'],       ARRAY['Polity','Science']),
('Junali Saikia',    'female', 1030, 74.0, 'medium', 5, ARRAY['Current Affairs','GK'],  ARRAY['Math']),
('Nandita Bora',     'female', 1100, 83.0, 'hard',   7, ARRAY['Assam GK','History'],   ARRAY['Geography']),
('Priyanka Hazarika','female', 1060, 71.0, 'medium', 3, ARRAY['Geography','Science'],  ARRAY['Polity']),
('Mousumi Dutta',    'female', 1090, 78.0, 'medium', 6, ARRAY['History','Polity'],     ARRAY['Current Affairs'])
ON CONFLICT DO NOTHING;

-- ── 8. AUTO-CREATE USER STATS ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.arena_ensure_user_stats(p_user_id uuid)
RETURNS void AS $$
BEGIN
    INSERT INTO public.arena_user_stats (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 9. FINALIZE MATCH RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.arena_finalize_match(
    p_match_id uuid, p_user_score integer, p_user_correct integer, p_user_answers jsonb, p_duration integer
) RETURNS jsonb AS $$
DECLARE
    v_match public.arena_matches%ROWTYPE;
    v_result text; v_new_rating integer; v_old_rating integer; v_rating_change integer;
    v_opp_new_rating integer; v_opp_old_rating integer;
BEGIN
    SELECT * INTO v_match FROM public.arena_matches WHERE id = p_match_id AND host_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Match not found or not authorized'); END IF;
    IF v_match.status = 'completed' THEN RETURN jsonb_build_object('success', false, 'error', 'Match already completed'); END IF;

    PERFORM public.arena_ensure_user_stats(auth.uid());
    SELECT rating INTO v_old_rating FROM public.arena_user_stats WHERE user_id = auth.uid();
    IF p_user_score > v_match.opponent_score THEN v_result := 'win';
    ELSIF p_user_score < v_match.opponent_score THEN v_result := 'loss';
    ELSE v_result := 'draw'; END IF;

    v_new_rating := public.arena_calculate_elo(v_old_rating, v_match.opponent_rating_before, v_result);
    v_rating_change := v_new_rating - v_old_rating;

    SELECT rating INTO v_opp_old_rating FROM public.arena_opponents WHERE id = v_match.opponent_id;
    IF FOUND THEN
        IF v_result = 'win' THEN v_opp_new_rating := public.arena_calculate_elo(v_opp_old_rating, v_old_rating, 'loss');
        ELSIF v_result = 'loss' THEN v_opp_new_rating := public.arena_calculate_elo(v_opp_old_rating, v_old_rating, 'win');
        ELSE v_opp_new_rating := v_opp_old_rating; END IF;
        UPDATE public.arena_opponents SET
            rating = v_opp_new_rating, matches = matches + 1,
            wins = wins + CASE WHEN v_result = 'loss' THEN 1 ELSE 0 END,
            losses = losses + CASE WHEN v_result = 'win' THEN 1 ELSE 0 END,
            draws = draws + CASE WHEN v_result = 'draw' THEN 1 ELSE 0 END,
            current_streak = CASE WHEN v_result = 'loss' THEN current_streak + 1 ELSE 0 END,
            best_streak = CASE WHEN v_result = 'loss' AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END,
            updated_at = now()
        WHERE id = v_match.opponent_id;
    END IF;

    UPDATE public.arena_user_stats SET
        rating = v_new_rating,
        wins = wins + CASE WHEN v_result = 'win' THEN 1 ELSE 0 END,
        losses = losses + CASE WHEN v_result = 'loss' THEN 1 ELSE 0 END,
        draws = draws + CASE WHEN v_result = 'draw' THEN 1 ELSE 0 END,
        matches = matches + 1,
        current_streak = CASE WHEN v_result = 'win' THEN current_streak + 1 ELSE 0 END,
        best_streak = CASE WHEN v_result = 'win' AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END,
        total_xp = total_xp + CASE WHEN v_result = 'win' THEN 50 + p_user_correct * 5 WHEN v_result = 'draw' THEN 20 + p_user_correct * 3 ELSE p_user_correct * 2 END,
        updated_at = now()
    WHERE user_id = auth.uid();

    UPDATE public.arena_matches SET
        host_score = p_user_score, host_correct = p_user_correct, host_answers = p_user_answers,
        host_rating_before = v_old_rating, host_rating_after = v_new_rating,
        opponent_rating_after = COALESCE(v_opp_new_rating, v_match.opponent_rating_before),
        status = 'completed', winner = v_result, duration_seconds = p_duration, completed_at = now()
    WHERE id = p_match_id;

    INSERT INTO public.arena_battle_history (user_id, match_id, mode, opponent_name, opponent_type, result,
        user_score, opponent_score, user_correct, opponent_correct, question_count, exam_type, category, difficulty,
        rating_before, rating_after, rating_change, duration_seconds)
    VALUES (auth.uid(), p_match_id, v_match.mode, v_match.opponent_name, 'ai', v_result,
        p_user_score, v_match.opponent_score, p_user_correct, v_match.opponent_correct,
        v_match.question_count, v_match.exam_type, v_match.category, v_match.difficulty,
        v_old_rating, v_new_rating, v_rating_change, p_duration);

    RETURN jsonb_build_object('success', true, 'result', v_result, 'rating_before', v_old_rating,
        'rating_after', v_new_rating, 'rating_change', v_rating_change, 'user_score', p_user_score,
        'opponent_score', v_match.opponent_score, 'user_correct', p_user_correct,
        'opponent_correct', v_match.opponent_correct, 'opponent_name', v_match.opponent_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ═══════════════════════════════════════════════════════════════════════
