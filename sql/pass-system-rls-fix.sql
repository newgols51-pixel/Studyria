-- =============================================================================
-- FILE: sql/pass-system-rls-fix.sql
-- PROJECT: Studyria Pass System — RLS Fix
-- PURPOSE: Fix Row Level Security so authenticated admin users can
--          INSERT, UPDATE, DELETE on site_config and membership_plans.
--          Normal authenticated users remain read-only.
-- SAFETY: Does NOT modify any existing data. Only sets policies.
-- =============================================================================

-- =============================================================================
-- 1. SITE_CONFIG TABLE — RLS Policies
-- =============================================================================
-- Enable RLS if not already enabled
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can SELECT (read) site_config
DROP POLICY IF EXISTS "pass_site_config_select_all" ON public.site_config;
CREATE POLICY "pass_site_config_select_all"
  ON public.site_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only admin users can INSERT/UPDATE/DELETE site_config
-- Admin is identified by checking the user's role in profiles or user metadata
DROP POLICY IF EXISTS "pass_site_config_admin_write" ON public.site_config;
CREATE POLICY "pass_site_config_admin_write"
  ON public.site_config
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR p.role = 'superadmin' OR p.is_admin = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR p.role = 'superadmin' OR p.is_admin = true)
    )
  );

-- =============================================================================
-- 2. MEMBERSHIP_PLANS TABLE — RLS Policies
-- =============================================================================
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can SELECT (read) membership_plans
DROP POLICY IF EXISTS "pass_plans_select_all" ON public.membership_plans;
CREATE POLICY "pass_plans_select_all"
  ON public.membership_plans
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only admin users can INSERT/UPDATE/DELETE membership_plans
DROP POLICY IF EXISTS "pass_plans_admin_write" ON public.membership_plans;
CREATE POLICY "pass_plans_admin_write"
  ON public.membership_plans
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR p.role = 'superadmin' OR p.is_admin = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR p.role = 'superadmin' OR p.is_admin = true)
    )
  );

-- =============================================================================
-- 3. MEMBERSHIP_TRANSACTIONS — Ensure users can INSERT their own rows
-- =============================================================================
DROP POLICY IF EXISTS "pass_tx_user_insert" ON public.membership_transactions;
CREATE POLICY "pass_tx_user_insert"
  ON public.membership_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can SELECT their own transactions
DROP POLICY IF EXISTS "pass_tx_user_select" ON public.membership_transactions;
CREATE POLICY "pass_tx_user_select"
  ON public.membership_transactions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- 4. USER_MEMBERSHIPS — Ensure users can INSERT/UPDATE their own rows
-- =============================================================================
DROP POLICY IF EXISTS "pass_um_user_insert" ON public.user_memberships;
CREATE POLICY "pass_um_user_insert"
  ON public.user_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pass_um_user_update" ON public.user_memberships;
CREATE POLICY "pass_um_user_update"
  ON public.user_memberships
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "pass_um_user_select" ON public.user_memberships;
CREATE POLICY "pass_um_user_select"
  ON public.user_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
SELECT 'RLS policies created successfully' as status;

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN ('site_config', 'membership_plans', 'membership_transactions', 'user_memberships')
ORDER BY tablename, policyname;
