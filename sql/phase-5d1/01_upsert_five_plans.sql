-- =============================================================================
-- FILE    : sql/phase-5d1/01_upsert_five_plans.sql
-- PROJECT : Studyria Premium Membership — Phase 5D.1
-- PURPOSE : Upsert the five production membership plans into membership_plans.
--           Replaces old slugs (starter, biannual, yearly) with the
--           canonical five-plan set (trial_1day, trial_15day, monthly,
--           quarterly, half_year).
--           Idempotent — safe to run multiple times.
-- SCHEMA  : Uses confirmed production columns:
--             id, slug, name, description, price_inr, billing_cycle,
--             is_active, sort_order, features, badge_label, trial_days,
--             created_at, updated_at
-- RUN     : Supabase SQL Editor (service_role). Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — UPSERT five canonical plans
--          ON CONFLICT (slug) → UPDATE so re-runs are safe.
-- ---------------------------------------------------------------------------

INSERT INTO public.membership_plans
  (slug, name, description, price_inr, billing_cycle,
   is_active, sort_order, trial_days, badge_label, features)
VALUES

-- ── Plan 1: 1 Day Trial ─────────────────────────────────────────────────────
(
  'trial_1day',
  '1 Day Trial',
  'Try Premium for just ₹9. Full access for 24 hours — risk-free.',
  9,          -- ₹9 (price_inr in whole rupees, confirmed production column)
  'trial',
  true,
  1,
  1,          -- trial_days: 1
  'NEW',
  jsonb_build_object(
    'ad_free',           true,
    'offline_downloads', true,
    'mcq_unlimited',     true,
    'analytics',         true,
    'early_access',      false,
    'priority_support',  false,
    'reading_room',      true,
    'ai_summary',        false,
    'creator_access',    false,
    'premium_badge',     false
  )
),

-- ── Plan 2: 15 Day Trial ────────────────────────────────────────────────────
(
  'trial_15day',
  '15 Day Trial',
  'Explore everything for 15 days. Perfect for exam sprints.',
  49,         -- ₹49
  'trial',
  true,
  2,
  15,         -- trial_days: 15
  'POPULAR',
  jsonb_build_object(
    'ad_free',           true,
    'offline_downloads', true,
    'mcq_unlimited',     true,
    'analytics',         true,
    'early_access',      false,
    'priority_support',  false,
    'reading_room',      true,
    'ai_summary',        false,
    'creator_access',    false,
    'premium_badge',     true
  )
),

-- ── Plan 3: Monthly Premium ─────────────────────────────────────────────────
(
  'monthly',
  'Monthly Premium',
  'Full premium access for 30 days. Best for regular exam learners.',
  99,         -- ₹99/month
  'monthly',
  true,
  3,
  NULL,
  NULL,
  jsonb_build_object(
    'ad_free',           true,
    'offline_downloads', true,
    'mcq_unlimited',     true,
    'analytics',         true,
    'early_access',      true,
    'priority_support',  false,
    'reading_room',      true,
    'ai_summary',        true,
    'creator_access',    false,
    'premium_badge',     true
  )
),

-- ── Plan 4: Quarterly Premium ───────────────────────────────────────────────
(
  'quarterly',
  'Quarterly Premium',
  'Premium access for 90 days. Ideal for serious APSC/ADRE preparation.',
  249,        -- ₹249/quarter (~₹83/mo)
  'quarterly',
  true,
  4,
  NULL,
  'MOST POPULAR',
  jsonb_build_object(
    'ad_free',           true,
    'offline_downloads', true,
    'mcq_unlimited',     true,
    'analytics',         true,
    'early_access',      true,
    'priority_support',  true,
    'reading_room',      true,
    'ai_summary',        true,
    'creator_access',    false,
    'premium_badge',     true
  )
),

-- ── Plan 5: Half Year Premium ───────────────────────────────────────────────
(
  'half_year',
  'Half Year Premium',
  'Maximum value — full premium access for 180 days. Best for long-term aspirants.',
  449,        -- ₹449/6 months (~₹75/mo)
  'half_year',
  true,
  5,
  NULL,
  'BEST VALUE',
  jsonb_build_object(
    'ad_free',           true,
    'offline_downloads', true,
    'mcq_unlimited',     true,
    'analytics',         true,
    'early_access',      true,
    'priority_support',  true,
    'reading_room',      true,
    'ai_summary',        true,
    'creator_access',    true,
    'premium_badge',     true
  )
)

ON CONFLICT (slug) DO UPDATE SET
  name         = EXCLUDED.name,
  description  = EXCLUDED.description,
  price_inr    = EXCLUDED.price_inr,
  billing_cycle= EXCLUDED.billing_cycle,
  is_active    = EXCLUDED.is_active,
  sort_order   = EXCLUDED.sort_order,
  trial_days   = EXCLUDED.trial_days,
  badge_label  = EXCLUDED.badge_label,
  features     = EXCLUDED.features,
  updated_at   = now();

-- ---------------------------------------------------------------------------
-- STEP 2 — Deactivate legacy plans (starter, biannual, yearly)
--          that are replaced by the canonical five.
--          Does NOT delete them — existing user_memberships rows reference
--          their plan_id via FK and must remain valid.
--          Sets is_active = false so they no longer appear in plan listings.
-- ---------------------------------------------------------------------------

UPDATE public.membership_plans
SET    is_active  = false,
       updated_at = now()
WHERE  slug IN ('starter', 'biannual', 'yearly', 'lifetime', 'trial')
  AND  is_active = true;   -- only touch if currently active (idempotent)

-- ---------------------------------------------------------------------------
-- STEP 3 — Add billing_cycle → duration_days mapping for expiry calculation
--          Uses the PPAY CYCLE_DAYS map as the authoritative reference.
-- ---------------------------------------------------------------------------
-- NOTE: The actual expiry calculation lives in premium-payment.js (CYCLE_DAYS).
--       This comment block documents the canonical mapping for reference:
--
--   trial_1day  → billing_cycle = 'trial',    trial_days = 1   → +1 day
--   trial_15day → billing_cycle = 'trial',    trial_days = 15  → +15 days
--   monthly     → billing_cycle = 'monthly',  trial_days = NULL → +30 days
--   quarterly   → billing_cycle = 'quarterly',trial_days = NULL → +90 days
--   half_year   → billing_cycle = 'half_year',trial_days = NULL → +180 days
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 4 — Verification SELECT
-- ---------------------------------------------------------------------------

SELECT
  slug,
  name,
  price_inr,
  billing_cycle,
  sort_order,
  badge_label,
  trial_days,
  is_active
FROM public.membership_plans
ORDER BY sort_order;

-- Expected output (5 active + legacy deactivated):
--  trial_1day   | 1 Day Trial        |  9   | trial     | 1 | NEW          | 1    | true
--  trial_15day  | 15 Day Trial       | 49   | trial     | 2 | POPULAR      | 15   | true
--  monthly      | Monthly Premium    | 99   | monthly   | 3 | null         | null | true
--  quarterly    | Quarterly Premium  | 249  | quarterly | 4 | MOST POPULAR | null | true
--  half_year    | Half Year Premium  | 449  | half_year | 5 | BEST VALUE   | null | true
