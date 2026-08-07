-- =============================================================================
-- FILE    : sql/phase-5c-v2/01_migrate_to_v2.sql  (VALIDATED v2.2)
-- PROJECT : Studyria Premium Membership — Phase 5C v2
-- PURPOSE : Migrate from membership_payment_orders architecture to reusing
--           the existing payment flow (membership_transactions table).
-- AUTHOR  : Validated 2026-07-13 against ACTUAL production schema.
-- SAFE    : Idempotent. IF NOT EXISTS / IF EXISTS on every object.
--           Additive only — does NOT drop tables or columns.
-- RUN     : Supabase SQL Editor (service_role). Safe to re-run.
--
-- PRODUCTION SCHEMA VERIFIED 2026-07-13:
--   membership_transactions columns:
--     id, user_id, plan_id, membership_id, provider, provider_tx_id,
--     amount_inr, amount_usd, currency, status, notes, created_at, updated_at
--   membership_plans columns:
--     id, slug, name, description, price_inr, price_usd, billing_cycle,
--     is_active, sort_order, features, badge_label, trial_days,
--     created_at, updated_at
--   user_memberships columns:
--     id, user_id, plan_id, status, started_at, expires_at,
--     cancelled_at, auto_renew, created_at, updated_at
--   membership_payment_orders: DOES NOT EXIST (already removed)
--   payment_audit_log: DOES NOT EXIST (table was never applied)
--   membership_logs: DOES NOT EXIST (table was never applied)
--
-- CHANGES v2.1 → v2.2 (this file):
--   ✅ Block 1: DO $$ FK-drop is now a safe no-op because membership_payment_orders
--              does not exist in production — no constraint to drop.
--   ✅ Block 2: UNIQUE index now targets provider_tx_id (the actual production
--              replay-protection column) — NOT payment_reference (which does NOT exist).
--   ✅ Block 3: idx_user_memberships_user_plan_status — unchanged, safe.
--   ❌ Block 4: REMOVED — payment_audit_log table does NOT exist; indexing
--              a nonexistent table would error. Removed entirely.
--   ✅ Verification SELECT added at end.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 — Remove FK constraint: user_memberships → membership_payment_orders
--
-- membership_payment_orders does NOT exist in production (already removed or
-- never fully applied). This block is a safe no-op in that case.
-- The DO $$ guard prevents any error.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- Only attempt if the referenced table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'membership_payment_orders'
  ) THEN
    SELECT conname
    INTO   v_conname
    FROM   pg_constraint
    WHERE  conrelid  = 'public.user_memberships'::regclass
    AND    confrelid = 'public.membership_payment_orders'::regclass
    LIMIT  1;

    IF v_conname IS NOT NULL THEN
      EXECUTE 'ALTER TABLE public.user_memberships DROP CONSTRAINT '
              || quote_ident(v_conname);
      RAISE NOTICE 'Dropped FK constraint: %', v_conname;
    ELSE
      RAISE NOTICE 'No FK from user_memberships → membership_payment_orders found — skipping.';
    END IF;
  ELSE
    RAISE NOTICE 'membership_payment_orders does not exist — Block 1 is a no-op.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 2 — UNIQUE index on membership_transactions.provider_tx_id
--
-- This is the Phase 5C v2 replay-protection mechanism.
-- Prevents the same Razorpay payment_id from activating Premium twice.
--
-- Production column is provider_tx_id (NOT payment_reference — that column
-- does not exist in production). The partial WHERE ensures NULL values are
-- excluded from uniqueness checks.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_txn_provider_tx_id_unique
  ON public.membership_transactions (provider_tx_id)
  WHERE provider_tx_id IS NOT NULL;

COMMENT ON INDEX public.idx_mem_txn_provider_tx_id_unique IS
  'Phase 5C v2.2 replay-protection: one Razorpay payment_id → at most one membership activation.';


-- ---------------------------------------------------------------------------
-- BLOCK 3 — Additional index on user_memberships for cross-plan lookups
--
-- Used by the edge function Step 5 active-membership guard:
--   .eq('user_id').eq('plan_id').eq('status', 'active').gt('expires_at', now)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_plan_status
  ON public.user_memberships (user_id, plan_id, status);

COMMENT ON INDEX public.idx_user_memberships_user_plan_status IS
  'Phase 5C v2: fast lookup for active membership by user + plan (duplicate-activation guard).';


-- ---------------------------------------------------------------------------
-- Verification — confirm the UNIQUE index exists on the correct column
-- ---------------------------------------------------------------------------
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'membership_transactions'
  AND indexname = 'idx_mem_txn_provider_tx_id_unique';

-- ---------------------------------------------------------------------------
-- Completion marker
-- ---------------------------------------------------------------------------
SELECT 'Phase 5C v2.2 migration complete — validated against production schema 2026-07-13.' AS status;
