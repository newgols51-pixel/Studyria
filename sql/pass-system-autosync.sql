-- ============================================================================
-- FILE: sql/pass-system-autosync.sql
-- PROJECT: Studyria Pass System — Auto-Sync & Single Source of Truth
-- PURPOSE:
--   1. Ensure all 8 canonical plans exist in membership_plans (idempotent upsert)
--   2. Create a Postgres function that rebuilds site_config.pass_management_config
--      from membership_plans whenever any plan row changes.
--   3. Create a trigger: membership_plans → auto-sync → site_config
--   4. Fix RLS so both anon + authenticated users can read required tables
--   5. Verify the setup
--
-- SAFE: Idempotent. Uses ON CONFLICT. No data deletion. Rollback on failure.
-- RUN IN: Supabase SQL Editor (service_role / superuser)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- BLOCK 1: Ensure all 8 canonical plans exist in membership_plans
-- ---------------------------------------------------------------------------
INSERT INTO public.membership_plans
  (slug, name, description, price_inr, billing_cycle, is_active,
   sort_order, trial_days, badge_label, features)
VALUES
  ('trial_1day',  '1 Day Trial',   'Try Studyria Pass for 24 hours.',         9,   'trial',     true, 1, 1,    '⚡ NEW',         '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('trial_7day',  '7 Day Trial',   'Try Studyria Pass for a full week.',       29,  'trial',     true, 2, 7,    '🌟 POPULAR',    '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('trial_15day', '15 Day Trial',  'Two weeks of unlimited premium learning.', 49,  'trial',     true, 3, 15,   '🟢 POPULAR',    '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('monthly',     'Monthly',       'Full month of premium learning.',          69,  'monthly',   true, 4, null, '',              '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('quarterly',   'Quarterly',     '3 months best value.',                    249,  'quarterly', true, 5, null, '⭐ MOST POPULAR','{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('half_year',   'Half Year',     '6 months maximum savings.',               449,  'half_year', true, 6, null, '👑 BEST VALUE', '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('yearly',      'Yearly',        '12 months maximum savings.',              599,  'yearly',    true, 7, null, '🏆 BEST VALUE', '{"ad_free":true,"unlimited_notes":true}'::jsonb),
  ('lifetime',    'Lifetime',      'Lifetime access — never expires.',        999,  'lifetime',  true, 8, null, '♾ LIFETIME',   '{"ad_free":true,"unlimited_notes":true}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  price_inr   = EXCLUDED.price_inr,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active   = EXCLUDED.is_active,
  sort_order  = COALESCE(membership_plans.sort_order, EXCLUDED.sort_order),
  trial_days  = EXCLUDED.trial_days,
  badge_label = EXCLUDED.badge_label,
  features    = EXCLUDED.features,
  updated_at  = NOW();

-- ---------------------------------------------------------------------------
-- BLOCK 2: Auto-sync function: membership_plans → site_config
-- ---------------------------------------------------------------------------
-- This function reads ALL active plans from membership_plans and rebuilds
-- site_config.pass_management_config JSON.
-- Called by trigger on every INSERT/UPDATE/DELETE on membership_plans.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_plans_to_site_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the function owner (service_role) so it can write site_config
SET search_path = public
AS $$
DECLARE
  v_plans      JSONB;
  v_config     JSONB;
  v_existing   JSONB;
BEGIN
  -- Build plans array from membership_plans (all plans, ordered)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',            mp.id::text,
      'passId',        mp.slug,
      'name',          mp.name,
      'shortDesc',     COALESCE(mp.description, ''),
      'offerPrice',    mp.price_inr,
      'originalPrice', COALESCE((mp.features->>'original_price')::int, mp.price_inr),
      'discount',      CASE
                         WHEN (mp.features->>'original_price')::int > mp.price_inr
                         THEN ROUND(100.0 * (1 - mp.price_inr::float / NULLIF((mp.features->>'original_price')::int, 0)))
                         ELSE 0
                       END,
      'currency',      'INR',
      'duration',      CASE
                         WHEN mp.billing_cycle = 'lifetime' THEN '0'
                         WHEN mp.trial_days IS NOT NULL      THEN mp.trial_days::text
                         WHEN mp.billing_cycle = 'monthly'   THEN '30'
                         WHEN mp.billing_cycle = 'quarterly' THEN '90'
                         WHEN mp.billing_cycle = 'half_year' THEN '180'
                         WHEN mp.billing_cycle = 'yearly'    THEN '365'
                         ELSE '30'
                       END,
      'durationUnit',  CASE WHEN mp.billing_cycle = 'lifetime' THEN 'lifetime' ELSE 'days' END,
      'badge',         COALESCE(mp.badge_label, ''),
      'badgeType',     CASE
                         WHEN mp.badge_label ILIKE '%popular%' THEN 'green'
                         WHEN mp.badge_label ILIKE '%best%'    THEN 'gold'
                         WHEN mp.badge_label ILIKE '%new%'     THEN 'blue'
                         ELSE 'gold'
                       END,
      'buttonText',    CASE
                         WHEN mp.slug = 'trial_1day'  THEN 'Try Now'
                         WHEN mp.slug = 'lifetime'    THEN 'Get Lifetime'
                         ELSE 'Get Pass'
                       END,
      'active',        mp.is_active,
      'order',         COALESCE(mp.sort_order, 99),
      'gradient',      CASE
                         WHEN mp.slug = 'trial_1day'  THEN 'linear-gradient(135deg,#3d8ef8,#00c8e8)'
                         WHEN mp.slug = 'trial_7day'  THEN 'linear-gradient(135deg,#10d98e,#3d8ef8)'
                         WHEN mp.slug = 'trial_15day' THEN 'linear-gradient(135deg,#10d98e,#06b6d4)'
                         WHEN mp.slug = 'monthly'     THEN 'linear-gradient(135deg,#3d8ef8,#8b5cf6)'
                         WHEN mp.slug = 'quarterly'   THEN 'linear-gradient(135deg,#8b5cf6,#a855f7)'
                         WHEN mp.slug = 'half_year'   THEN 'linear-gradient(135deg,#f59e0b,#fbbf24)'
                         WHEN mp.slug = 'yearly'      THEN 'linear-gradient(135deg,#fbbf24,#f59e0b)'
                         WHEN mp.slug = 'lifetime'    THEN 'linear-gradient(135deg,#fbbf24,#f59e0b)'
                         ELSE 'linear-gradient(135deg,#3d8ef8,#10d98e)'
                       END,
      'icon',          CASE
                         WHEN mp.slug = 'trial_1day'  THEN '⚡'
                         WHEN mp.slug = 'trial_7day'  THEN '🌟'
                         WHEN mp.slug = 'trial_15day' THEN '🟢'
                         WHEN mp.slug = 'monthly'     THEN '🔵'
                         WHEN mp.slug = 'quarterly'   THEN '🟣'
                         WHEN mp.slug = 'half_year'   THEN '👑'
                         WHEN mp.slug = 'yearly'      THEN '🏆'
                         WHEN mp.slug = 'lifetime'    THEN '♾'
                         ELSE '⭐'
                       END
    )
    ORDER BY COALESCE(mp.sort_order, 99), mp.slug
  )
  INTO v_plans
  FROM public.membership_plans mp;

  -- Fetch existing config to preserve non-plan sections (hero, benefits, coupons, etc.)
  SELECT value::jsonb
  INTO v_existing
  FROM public.site_config
  WHERE key = 'pass_management_config';

  IF v_existing IS NOT NULL THEN
    -- Overlay only the plans array; keep everything else from admin panel
    v_config := v_existing || jsonb_build_object('plans', COALESCE(v_plans, '[]'::jsonb));
  ELSE
    -- No existing config — build minimal config with just plans
    v_config := jsonb_build_object(
      'plans',   COALESCE(v_plans, '[]'::jsonb),
      'pricing', jsonb_build_object(
        'showOffers', true, 'showStrikePrice', true,
        'showDiscountBadge', true, 'showPopularBadge', true
      )
    );
  END IF;

  -- Upsert into site_config
  INSERT INTO public.site_config (key, value)
  VALUES ('pass_management_config', v_config::text)
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = NOW();

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- BLOCK 3: Trigger: fire after any INSERT / UPDATE / DELETE on membership_plans
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_plans_to_site_config ON public.membership_plans;

CREATE TRIGGER trg_sync_plans_to_site_config
  AFTER INSERT OR UPDATE OR DELETE
  ON public.membership_plans
  FOR EACH STATEMENT  -- once per statement, not per row (avoids N calls for bulk upserts)
  EXECUTE FUNCTION public.fn_sync_plans_to_site_config();

-- ---------------------------------------------------------------------------
-- BLOCK 4: Fix RLS so anon + authenticated users can read what they need
-- ---------------------------------------------------------------------------

-- site_config: public read (config is not sensitive)
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "site_config_public_read"  ON public.site_config;
DROP POLICY IF EXISTS "site_config_anon_read"    ON public.site_config;
DROP POLICY IF EXISTS "pass_site_config_select_all" ON public.site_config;
CREATE POLICY "site_config_public_read"
  ON public.site_config FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "site_config_admin_write"      ON public.site_config;
DROP POLICY IF EXISTS "pass_site_config_admin_write" ON public.site_config;
CREATE POLICY "site_config_admin_write"
  ON public.site_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','superadmin') OR p.is_admin = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','superadmin') OR p.is_admin = true)
    )
  );

-- membership_plans: public read (prices are public)
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "membership_plans_public_read" ON public.membership_plans;
DROP POLICY IF EXISTS "pass_plans_select_all"        ON public.membership_plans;
CREATE POLICY "membership_plans_public_read"
  ON public.membership_plans FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- BLOCK 5: Run initial sync — populate site_config from current membership_plans
-- ---------------------------------------------------------------------------
-- Manually call the sync function once to seed site_config immediately
DO $$
DECLARE dummy_row public.membership_plans%ROWTYPE;
BEGIN
  PERFORM public.fn_sync_plans_to_site_config();
  RAISE NOTICE 'Initial sync complete — site_config.pass_management_config updated from membership_plans';
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
SELECT
  slug,
  name,
  price_inr,
  is_active,
  trial_days,
  sort_order
FROM public.membership_plans
ORDER BY sort_order, slug;

SELECT
  key,
  LEFT(value, 200) AS value_preview
FROM public.site_config
WHERE key = 'pass_management_config';

SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_orientation
FROM information_schema.triggers
WHERE trigger_name = 'trg_sync_plans_to_site_config';

SELECT 'Auto-sync setup complete ✅' AS status;
