-- =============================================================================
-- FILE: sql/premium-rls-policies.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Row Level Security policies for all membership tables
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table or policy.
-- NOTE: Run AFTER all table creation SQL files.
-- =============================================================================

-- =============================================================================
-- PREREQUISITE: Admin role check helper
-- Relies on existing is_admin() function or creates a safe fallback.
-- IMPORTANT: Only add if is_admin() does not already exist in this Supabase project.
-- =============================================================================

-- Safe admin check (uses app_metadata.role = 'admin' set via Supabase Auth)
CREATE OR REPLACE FUNCTION public.is_membership_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
        FALSE
    );
$$;

-- =============================================================================
-- RLS: membership_plans
-- Everyone can read active plans (needed for purchase UI).
-- Only admins can insert/update/delete.
-- =============================================================================

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

-- Guests + authenticated users can see active plans
DROP POLICY IF EXISTS "Plans: public read active" ON public.membership_plans;
CREATE POLICY "Plans: public read active"
    ON public.membership_plans
    FOR SELECT
    USING (active = TRUE);

-- Admins can see all plans including inactive
DROP POLICY IF EXISTS "Plans: admin full access" ON public.membership_plans;
CREATE POLICY "Plans: admin full access"
    ON public.membership_plans
    FOR ALL
    USING (public.is_membership_admin())
    WITH CHECK (public.is_membership_admin());

-- =============================================================================
-- RLS: user_memberships
-- Users can only read their OWN membership row(s).
-- Users CANNOT insert, update, or delete memberships (backend/admin only).
-- Admins have full access.
-- =============================================================================

ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;

-- Authenticated users: read own rows only
DROP POLICY IF EXISTS "Memberships: user read own" ON public.user_memberships;
CREATE POLICY "Memberships: user read own"
    ON public.user_memberships
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Admins: full access
DROP POLICY IF EXISTS "Memberships: admin full access" ON public.user_memberships;
CREATE POLICY "Memberships: admin full access"
    ON public.user_memberships
    FOR ALL
    USING (public.is_membership_admin())
    WITH CHECK (public.is_membership_admin());

-- Guests: NO access (no policy = no access)

-- =============================================================================
-- RLS: membership_transactions
-- Users can only read their own transactions (for receipts/history UI).
-- Users CANNOT insert/update/delete transactions.
-- Admins have full access.
-- =============================================================================

ALTER TABLE public.membership_transactions ENABLE ROW LEVEL SECURITY;

-- Authenticated users: read own rows only
DROP POLICY IF EXISTS "Transactions: user read own" ON public.membership_transactions;
CREATE POLICY "Transactions: user read own"
    ON public.membership_transactions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Admins: full access
DROP POLICY IF EXISTS "Transactions: admin full access" ON public.membership_transactions;
CREATE POLICY "Transactions: admin full access"
    ON public.membership_transactions
    FOR ALL
    USING (public.is_membership_admin())
    WITH CHECK (public.is_membership_admin());

-- =============================================================================
-- RLS: membership_logs
-- Users CANNOT read logs (internal audit only).
-- Admins have full read access.
-- No one can insert/update/delete via API (done via service role only).
-- =============================================================================

ALTER TABLE public.membership_logs ENABLE ROW LEVEL SECURITY;

-- Admins: read only (mutations via service_role only)
DROP POLICY IF EXISTS "Logs: admin read" ON public.membership_logs;
CREATE POLICY "Logs: admin read"
    ON public.membership_logs
    FOR SELECT
    USING (public.is_membership_admin());

-- =============================================================================
-- RLS: membership_features
-- Authenticated users can read enabled features (needed by client JS).
-- Guests: no access.
-- Admins: full access.
-- =============================================================================

ALTER TABLE public.membership_features ENABLE ROW LEVEL SECURITY;

-- Authenticated users: read enabled features only
DROP POLICY IF EXISTS "Features: authenticated read enabled" ON public.membership_features;
CREATE POLICY "Features: authenticated read enabled"
    ON public.membership_features
    FOR SELECT
    TO authenticated
    USING (enabled = TRUE);

-- Admins: full access including disabled features
DROP POLICY IF EXISTS "Features: admin full access" ON public.membership_features;
CREATE POLICY "Features: admin full access"
    ON public.membership_features
    FOR ALL
    USING (public.is_membership_admin())
    WITH CHECK (public.is_membership_admin());
