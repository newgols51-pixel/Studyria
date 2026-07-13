-- =============================================================================
-- FILE    : sql/phase-5c-v2/01_migrate_to_v2.sql
-- PROJECT : Studyria Premium Membership — Phase 5C v2
-- PURPOSE : Migrate from membership_payment_orders architecture to
--           reusing existing payment flow (membership_transactions table).
-- SAFE    : Idempotent. Use IF EXISTS everywhere. Additive only where possible.
-- NOTE    : Run in Supabase SQL Editor AFTER backing up membership_payment_orders data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove FK constraint linking user_memberships → membership_payment_orders
--    (allows us to drop the orders table safely)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c TEXT;
BEGIN
  -- Find and drop FK constraint on user_memberships.payment_order_id → membership_payment_orders
  SELECT conname INTO c
  FROM   pg_constraint
  WHERE  conrelid  = 'public.user_memberships'::regclass
  AND    confrelid = 'public.membership_payment_orders'::regclass
  LIMIT  1;

  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_memberships DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
    RAISE NOTICE 'Dropped FK constraint: %', c;
  ELSE
    RAISE NOTICE 'No FK from user_memberships to membership_payment_orders found — skipping.';
  END IF;
END $$;

-- Make payment_order_id column just a plain UUID (no FK) so it can store any reference
-- This is already handled by dropping the constraint above.
COMMENT ON COLUMN public.user_memberships.payment_order_id IS
  'v2: stores razorpay_payment_id (the pay_xxx string) as text cast to UUID is removed. '
  'In v2, payment_reference in membership_transactions is the canonical idempotency key.';

-- ---------------------------------------------------------------------------
-- 2. Add UNIQUE constraint on membership_transactions.payment_reference
--    This is the v2 replay-protection mechanism (replaces membership_payment_orders unique index)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_txn_payment_reference_unique
  ON public.membership_transactions (payment_reference)
  WHERE payment_reference IS NOT NULL;

COMMENT ON INDEX idx_mem_txn_payment_reference_unique IS
  'Prevents duplicate membership activation from the same Razorpay payment_id (replay protection).';

-- ---------------------------------------------------------------------------
-- 3. Add composite index for fast active membership lookup
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_status
  ON public.user_memberships (user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_memberships_user_plan_status
  ON public.user_memberships (user_id, plan_id, status);

-- ---------------------------------------------------------------------------
-- 4. payment_audit_log — ensure indexes exist
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pal_user_id
  ON public.payment_audit_log (user_id);

CREATE INDEX IF NOT EXISTS idx_pal_payment_id
  ON public.payment_audit_log (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. (OPTIONAL — run manually after verifying no active orders remain)
--    DROP TABLE public.membership_payment_orders CASCADE;
--    DROP TABLE IF EXISTS public.payment_audit_log; -- only if you want to recreate it
-- Note: Commented out for safety. Uncomment after manual review.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.membership_payment_orders CASCADE;

SELECT 'Phase 5C v2 migration complete.' AS status;