-- =============================================================================
-- FILE    : sql/phase-5d2/01_fix_and_seed_five_plans.sql
-- PROJECT : Studyria Premium Membership — Phase 5D.2
-- PURPOSE : Fix the membership activation pipeline.
--           1. Ensure membership_plans has all required production columns.
--           2. Upsert the five canonical plans with correct pricing + trial_days.
--           3. Ensure provider_tx_id UNIQUE index exists (replay protection).
--           4. Verify RLS allows authenticated users to INSERT into user_memberships
--              and membership_transactions.
-- SAFE    : Idempotent. IF NOT EXISTS everywhere. No DROP. No destructive ops.
-- RUN     : Supabase SQL Editor (service_role). Safe to re-run.
--
-- PRODUCTION SCHEMA (verified 2026-07-13 via phase-5c-v2):
--   membership_plans:        id, slug, name, description, price_inr, price_usd,
--                            billing_cycle, is_active, sort_order, features,
--                            badge_label, trial_days, created_at, updated_at
--   user_memberships:        id, user_id, plan_id, status, started_at, expires_at,
--                            cancelled_at, auto_renew, created_at, updated_at
--   membership_transactions: id, user_id, plan_id, membership_id, provider,
--                            provider_tx_id, amount_inr, amount_usd, currency,
--                            status, notes, created_at, updated_at
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BLOCK 1 — Ensure membership_plans has all columns the JS code references.
--           ADD COLUMN IF NOT EXISTS is idempotent.
-- ---------------------------------------------------------------------------

ALTER TABLE public.membership_plans
  ADD COLUMN IF NOT EXISTS price_inr      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_cycle  TEXT        NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS badge_label    TEXT,
  ADD COLUMN IF NOT EXISTS trial_days     INTEGER,
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS price_usd      INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure the slug UNIQUE constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.membership_plans'::regclass
      AND contype  = 'u'
      AND conname  LIKE '%slug%'
  ) THEN
    ALTER TABLE public.membership_plans ADD CONSTRAINT membership_plans_slug_key UNIQUE (slug);
    RAISE NOTICE 'Added UNIQUE constraint on membership_plans.slug';
  ELSE
    RAISE NOTICE 'UNIQUE constraint on membership_plans.slug already exists';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- BLOCK 2 — Ensure membership_transactions has all columns the JS code uses.
-- ---------------------------------------------------------------------------

ALTER TABLE public.membership_transactions
  ADD COLUMN IF NOT EXISTS plan_id        UUID        REFERENCES public.membership_plans(id),
  ADD COLUMN IF NOT EXISTS provider       TEXT        NOT NULL DEFAULT 'razorpay',
  ADD COLUMN IF NOT EXISTS provider_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS amount_inr     INTEGER,
  ADD COLUMN IF NOT EXISTS amount_usd     INTEGER,
  ADD COLUMN IF NOT EXISTS notes          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- BLOCK 3 — UNIQUE index on provider_tx_id (replay protection).
--           Prevents same Razorpay payment_id from activating twice.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_txn_provider_tx_id_unique
  ON public.membership_transactions (provider_tx_id)
  WHERE provider_tx_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BLOCK 4 — Upsert the five canonical membership plans.
--           ON CONFLICT (slug) → UPDATE so re-runs are safe.
-- ---------------------------------------------------------------------------

INSERT INTO public.membership_plans
  (slug, name, description, price_inr, billing_cycle,
   is_active, sort_order, trial_days, badge_label, features)
VALUES

-- Plan 1: 1 Day Trial
(
  'trial_1day',
  '1 Day Trial',
  'Try Premium for just ₹9. Full access for 24 hours — risk-free.',
  9, 'trial', true, 1, 1, 'NEW',
  jsonb_build_object('ad_free', true, 'offline_downloads', true,
    'mcq_unlimited', true, 'reading_room', true,
    'early_access', false, 'priority_support', false, 'premium_badge', false)
),

-- Plan 2: 15 Day Trial
(
  'trial_15day',
  '15 Day Trial',
  'Explore everything for 15 days. Perfect for exam sprints.',
  49, 'trial', true, 2, 15, 'POPULAR',
  jsonb_build_object('ad_free', true, 'offline_downloads', true,
    'mcq_unlimited', true, 'reading_room', true,
    'early_access', false, 'priority_support', false, 'premium_badge', true)
),

-- Plan 3: Monthly Premium
(
  'monthly',
  'Monthly Premium',
  'Full premium access for 30 days. Best for regular exam learners.',
  99, 'monthly', true, 3, NULL, NULL,
  jsonb_build_object('ad_free', true, 'offline_downloads', true,
    'mcq_unlimited', true, 'reading_room', true,
    'early_access', true, 'priority_support', false, 'premium_badge', true)
),

-- Plan 4: Quarterly Premium
(
  'quarterly',
  'Quarterly Premium',
  'Premium access for 90 days. Ideal for serious APSC/ADRE preparation.',
  249, 'quarterly', true, 4, NULL, 'MOST POPULAR',
  jsonb_build_object('ad_free', true, 'offline_downloads', true,
    'mcq_unlimited', true, 'reading_room', true,
    'early_access', true, 'priority_support', true, 'premium_badge', true)
),

-- Plan 5: Half Year Premium
(
  'half_year',
  'Half Year Premium',
  'Maximum value — full premium access for 180 days.',
  449, 'half_year', true, 5, NULL, 'BEST VALUE',
  jsonb_build_object('ad_free', true, 'offline_downloads', true,
    'mcq_unlimited', true, 'reading_room', true,
    'early_access', true, 'priority_support', true, 'premium_badge', true)
)

ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  price_inr     = EXCLUDED.price_inr,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active     = EXCLUDED.is_active,
  sort_order    = EXCLUDED.sort_order,
  trial_days    = EXCLUDED.trial_days,
  badge_label   = EXCLUDED.badge_label,
  features      = EXCLUDED.features,
  updated_at    = now();

-- ---------------------------------------------------------------------------
-- BLOCK 5 — Deactivate legacy plans.
--           Does NOT delete — FK integrity preserved.
-- ---------------------------------------------------------------------------

UPDATE public.membership_plans
SET    is_active  = false,
       updated_at = now()
WHERE  slug IN ('starter', 'biannual', 'yearly', 'lifetime', 'trial')
  AND  is_active = true;

-- ---------------------------------------------------------------------------
-- BLOCK 6 — RLS: ensure authenticated users can INSERT into user_memberships.
--           If RLS is enabled, we need the correct policy.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Enable RLS if not already enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename  = 'user_memberships'
      AND schemaname = 'public'
      AND rowsecurity = TRUE
  ) THEN
    ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'RLS enabled on user_memberships';
  END IF;
END $$;

-- Policy: users can insert their own membership rows
CREATE POLICY IF NOT EXISTS "Users can insert own membership"
  ON public.user_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: users can update their own membership rows
CREATE POLICY IF NOT EXISTS "Users can update own membership"
  ON public.user_memberships
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: users can read their own membership rows
CREATE POLICY IF NOT EXISTS "Users can read own membership"
  ON public.user_memberships
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- BLOCK 7 — RLS: ensure authenticated users can INSERT into membership_transactions.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename  = 'membership_transactions'
      AND schemaname = 'public'
      AND rowsecurity = TRUE
  ) THEN
    ALTER TABLE public.membership_transactions ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'RLS enabled on membership_transactions';
  END IF;
END $$;

CREATE POLICY IF NOT EXISTS "Users can insert own transactions"
  ON public.membership_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can read own transactions"
  ON public.membership_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- BLOCK 8 — Verification: confirm all 5 plans exist and are active.
-- ---------------------------------------------------------------------------

SELECT
  slug,
  name,
  price_inr,
  billing_cycle,
  trial_days,
  sort_order,
  badge_label,
  is_active
FROM public.membership_plans
WHERE slug IN ('trial_1day','trial_15day','monthly','quarterly','half_year')
ORDER BY sort_order;

-- Expected: 5 rows, all is_active = true
-- trial_1day   | 1 Day Trial        |  9   | trial     |  1 | 1 | NEW          | true
-- trial_15day  | 15 Day Trial       | 49   | trial     | 15 | 2 | POPULAR      | true
-- monthly      | Monthly Premium    | 99   | monthly   |    | 3 |              | true
-- quarterly    | Quarterly Premium  | 249  | quarterly |    | 4 | MOST POPULAR | true
-- half_year    | Half Year Premium  | 449  | half_year |    | 5 | BEST VALUE   | true
