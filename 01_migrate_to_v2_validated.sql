-- =============================================================================
-- FILE    : sql/phase-5c-v2/01_migrate_to_v2.sql  (VALIDATED v2.1)
-- PROJECT : Studyria Premium Membership — Phase 5C v2
-- PURPOSE : Migrate from membership_payment_orders architecture to reusing
--           the existing payment flow (membership_transactions table).
-- AUTHOR  : Validated 2026-07-13 against production schema.
-- SAFE    : Idempotent. IF NOT EXISTS / IF EXISTS on every object.
--           Additive only — does NOT drop tables or columns.
-- RUN     : Supabase SQL Editor (service_role). Safe to re-run.
--
-- VALIDATION NOTES (vs original 01_migrate_to_v2.sql):
--   ✅ Block 1: DO $$ FK-drop is correct and safe.
--   ✅ Block 2: UNIQUE index on membership_transactions.payment_reference — NEW, needed.
--   ✅ Block 3: idx_user_memberships_user_status REMOVED — already exists from
--               premium-indexes.sql (CREATE INDEX IF NOT EXISTS with same name but
--               different WHERE clause causes a Postgres error; existing index already
--               covers the active-membership lookup pattern).
--   ✅ Block 3: idx_user_memberships_user_plan_status — NEW name, safe.
--   ✅ Block 4: idx_pal_user_id / idx_pal_payment_id — NEW names, safe (existing indexes
--               idx_audit_log_user / idx_audit_log_payment have different names, no conflict).
--   ✅ COMMENT ON COLUMN — valid SQL, correctly targets existing column.
--   ✅ No reference to membership_plans.active — production column is is_active.
--   ✅ No markdown artifacts. Pure PostgreSQL.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 — Remove FK constraint: user_memberships → membership_payment_orders
--
-- Drops the FK that was added by sql/phase-5c/01_payment_order_payment_id.sql.
-- After this, payment_order_id becomes a plain nullable UUID column (no FK).
-- In Phase 5C v2 the canonical idempotency key is
-- membership_transactions.payment_reference, not payment_order_id.
--
-- Uses pg_constraint lookup so it is safe regardless of what Postgres named
-- the constraint auto-generated from the ADD COLUMN … REFERENCES … clause.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conname TEXT;
BEGIN
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
END $$;

-- Document the new meaning of payment_order_id in v2.
-- (The column itself is preserved for backward compatibility.)
COMMENT ON COLUMN public.user_memberships.payment_order_id IS
  'Phase 5C v2: FK to membership_payment_orders removed. '
  'Column is retained for backward compatibility but no longer enforced. '
  'Canonical idempotency key is membership_transactions.payment_reference (UNIQUE index).';


-- ---------------------------------------------------------------------------
-- BLOCK 2 — UNIQUE index on membership_transactions.payment_reference
--
-- This is the Phase 5C v2 replay-protection mechanism.
-- Prevents the same Razorpay payment_id from activating Premium twice.
-- membership_transactions.payment_reference already exists as a nullable TEXT
-- column (defined in sql/premium-membership-transactions.sql).
-- The partial WHERE ensures NULL values are excluded from uniqueness checks.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_txn_payment_reference_unique
  ON public.membership_transactions (payment_reference)
  WHERE payment_reference IS NOT NULL;

COMMENT ON INDEX public.idx_mem_txn_payment_reference_unique IS
  'Phase 5C v2 replay-protection: one Razorpay payment_id → at most one membership activation.';


-- ---------------------------------------------------------------------------
-- BLOCK 3 — Additional index on user_memberships for cross-plan lookups
--
-- idx_user_memberships_user_status is intentionally omitted here: it already
-- exists from premium-indexes.sql as a partial index WHERE status = ''active''.
-- Creating an index with the same name but a different definition raises an
-- error even with IF NOT EXISTS.
--
-- idx_user_memberships_user_plan_status is a new name — safe to create.
-- Used by the edge function''s "already active for this plan" check
-- (Step 5: .eq(''user_id'').eq(''plan_id'').eq(''status'', ''active'')).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_plan_status
  ON public.user_memberships (user_id, plan_id, status);

COMMENT ON INDEX public.idx_user_memberships_user_plan_status IS
  'Phase 5C v2: fast lookup for active membership by user + plan (duplicate-activation guard).';


-- ---------------------------------------------------------------------------
-- BLOCK 4 — Supporting indexes on payment_audit_log
--
-- The table and its base indexes (idx_audit_log_user, idx_audit_log_order,
-- idx_audit_log_payment, idx_audit_log_event, idx_audit_log_failures) were
-- already created by sql/phase-5c/01_payment_order_payment_id.sql.
-- The names below are intentionally different so IF NOT EXISTS is safe.
--
-- idx_pal_user_id  — plain user_id lookup (existing idx_audit_log_user includes
--                    created_at DESC; this simpler index serves point lookups).
-- idx_pal_payment_id — mirrors idx_audit_log_payment with a different name;
--                      harmless redundancy, kept for forward-compat with any
--                      tooling that references this specific index name.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pal_user_id
  ON public.payment_audit_log (user_id);

CREATE INDEX IF NOT EXISTS idx_pal_payment_id
  ON public.payment_audit_log (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- BLOCK 5 — Optional: drop membership_payment_orders (commented out)
--
-- Uncomment ONLY after:
--   a) Confirming membership_payment_orders contains no live/pending orders.
--   b) Confirming no other code or cron job reads from this table.
--   c) Taking a manual backup / snapshot.
--
-- The FK from user_memberships was removed in Block 1, so DROP CASCADE is safe
-- from a constraint perspective but will also remove any dependent views/rules.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.membership_payment_orders CASCADE;


-- ---------------------------------------------------------------------------
-- Completion marker
-- ---------------------------------------------------------------------------
SELECT 'Phase 5C v2 migration complete — validated 2026-07-13.' AS status;
