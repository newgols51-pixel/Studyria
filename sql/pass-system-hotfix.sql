-- =============================================================================
-- FILE: sql/pass-system-hotfix.sql
-- PROJECT: Studyria Pass System — Hotfix
-- PURPOSE: 
--   1. Upsert all 7 plans into membership_plans with CORRECT prices
--   2. Add trial_7day (7 Day Trial) which was missing
--   3. Allow anon role to SELECT site_config (so pass page works for all users)
-- SAFE: Idempotent — uses ON CONFLICT DO UPDATE. No destructive ops.
-- RUN IN: Supabase SQL Editor (service_role or superuser)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BLOCK 1: Upsert all plans with correct prices into membership_plans
-- ---------------------------------------------------------------------------
INSERT INTO public.membership_plans
  (slug, name, description, price_inr, billing_cycle, is_active, sort_order, trial_days, badge_label, features)
VALUES
  -- 1 Day Trial
  ('trial_1day',  '1 Day Trial',   'Try Studyria Pass for just ₹9. Full access for 24 hours.',
   9,   'trial', true, 1, 1,  'NEW',        '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- 7 Day Trial (WAS MISSING — caused "Plan not found")
  ('trial_7day',  '7 Day Trial',   'Try Studyria Pass for a full week at ₹29.',
   29,  'trial', true, 2, 7,  'POPULAR',    '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- 15 Day Trial
  ('trial_15day', '15 Day Trial',  'Two weeks of unlimited premium learning at ₹49.',
   49,  'trial', true, 3, 15, 'POPULAR',    '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- Monthly
  ('monthly',     'Monthly',       'Full month of premium learning at ₹69.',
   69,  'monthly', true, 4, null, '',       '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- Quarterly
  ('quarterly',   'Quarterly',     '3 months best value at ₹249.',
   249, 'quarterly', true, 5, null, 'MOST POPULAR', '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- Half Year
  ('half_year',   'Half Year',     '6 months maximum savings at ₹449.',
   449, 'half_year', true, 6, null, 'BEST VALUE', '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- Yearly
  ('yearly',      'Yearly',        '12 months maximum savings at ₹599.',
   599, 'yearly', true, 7, null, 'BEST VALUE', '{"ad_free":true,"offline_downloads":true}'::jsonb),
  -- Lifetime
  ('lifetime',    'Lifetime',      'Lifetime access — never expires at ₹999.',
   999, 'lifetime', true, 8, null, 'LIFETIME', '{"ad_free":true,"offline_downloads":true}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  price_inr   = EXCLUDED.price_inr,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active   = EXCLUDED.is_active,
  sort_order  = EXCLUDED.sort_order,
  trial_days  = EXCLUDED.trial_days,
  badge_label = EXCLUDED.badge_label,
  features    = EXCLUDED.features,
  updated_at  = NOW();

-- ---------------------------------------------------------------------------
-- BLOCK 2: Allow anon role to SELECT from site_config
--   This is safe — site_config only contains public configuration,
--   not user data. Anon reads it to render pass prices for all visitors.
-- ---------------------------------------------------------------------------
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

-- Drop existing anon-blocking policy if any
DROP POLICY IF EXISTS "pass_site_config_select_all" ON public.site_config;
DROP POLICY IF EXISTS "site_config_anon_read" ON public.site_config;

-- Allow BOTH anon and authenticated users to SELECT
CREATE POLICY "site_config_public_read"
  ON public.site_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Admin-only write policy (keep existing — admins are authenticated)
DROP POLICY IF EXISTS "pass_site_config_admin_write" ON public.site_config;
CREATE POLICY "site_config_admin_write"
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

-- Allow anon to read membership_plans too (for payment validation)
DROP POLICY IF EXISTS "pass_plans_select_all" ON public.membership_plans;
CREATE POLICY "membership_plans_public_read"
  ON public.membership_plans
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
SELECT slug, name, price_inr, is_active, trial_days, badge_label
FROM public.membership_plans
ORDER BY sort_order, slug;

SELECT 'Hotfix applied successfully' AS status;
