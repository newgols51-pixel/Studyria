-- =============================================================================
-- FILE    : sql/phase-5c/01_payment_order_payment_id.sql
-- PROJECT : Studyria Premium Membership — Phase 5C
-- PURPOSE : Add razorpay_payment_id + razorpay_signature columns to
--           membership_payment_orders, add payment_order_id FK to
--           user_memberships, and create the payment_audit_log table.
-- SAFE    : Additive only. Does NOT drop or modify any existing column.
-- IDEMPOTENT: Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. membership_payment_orders — add payment_id + signature columns
-- ---------------------------------------------------------------------------

-- razorpay_payment_id: populated after successful payment verification (Phase 5C)
ALTER TABLE public.membership_payment_orders
  ADD COLUMN IF NOT EXISTS razorpay_payment_id  TEXT  UNIQUE;

-- razorpay_signature: we store '[verified]' (never the raw signature)
ALTER TABLE public.membership_payment_orders
  ADD COLUMN IF NOT EXISTS razorpay_signature   TEXT;

-- Deduplication index: one payment_id per order (prevents replay)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_payment_id
  ON public.membership_payment_orders (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

COMMENT ON COLUMN public.membership_payment_orders.razorpay_payment_id IS
  'Razorpay pay_xxxx — populated after HMAC-SHA256 verification in Phase 5C.';

COMMENT ON COLUMN public.membership_payment_orders.razorpay_signature IS
  'Never stores raw signature — set to ''[verified]'' after successful HMAC check.';

-- ---------------------------------------------------------------------------
-- 2. user_memberships — add payment_order_id FK column
-- ---------------------------------------------------------------------------

-- Links each activated membership back to the order that funded it.
-- Used for idempotency check: one order → at most one active membership.
ALTER TABLE public.user_memberships
  ADD COLUMN IF NOT EXISTS payment_order_id  UUID
  REFERENCES public.membership_payment_orders(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_order_id
  ON public.user_memberships (payment_order_id)
  WHERE payment_order_id IS NOT NULL;

COMMENT ON COLUMN public.user_memberships.payment_order_id IS
  'FK to membership_payment_orders.id — links membership to the verified payment order.';

-- ---------------------------------------------------------------------------
-- 3. payment_audit_log — immutable security audit trail for Phase 5C
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_audit_log (

    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event type (e.g. 'verify.signature_attempt', 'verify.signature_failed',
    --             'verify.activation_success', 'verify.replay_detected')
    event                 TEXT        NOT NULL,

    user_id               UUID        NOT NULL,

    -- Razorpay identifiers (nullable for pre-verification events)
    razorpay_order_id     TEXT,
    razorpay_payment_id   TEXT,

    -- The resulting membership ID (nullable until activation)
    membership_id         UUID,

    plan_slug             TEXT,
    success               BOOLEAN     NOT NULL,

    -- Free-text reason for failures
    reason                TEXT,

    -- Additional context — never PII, never secrets
    meta                  JSONB       NOT NULL DEFAULT '{}',

    -- Immutable — no updated_at by design
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast audit lookups
CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON public.payment_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_order
  ON public.payment_audit_log (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_payment
  ON public.payment_audit_log (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_event
  ON public.payment_audit_log (event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_failures
  ON public.payment_audit_log (success, created_at DESC)
  WHERE success = FALSE;

-- ---------------------------------------------------------------------------
-- 4. RLS on payment_audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can only read their own audit entries
DROP POLICY IF EXISTS "audit_log: owner select" ON public.payment_audit_log;
CREATE POLICY "audit_log: owner select"
  ON public.payment_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only service_role can insert (Edge Functions)
-- No INSERT policy → only service_role can write

COMMENT ON TABLE public.payment_audit_log IS
  'Studyria Phase 5C: immutable security audit trail for payment verification events.';

COMMENT ON COLUMN public.payment_audit_log.event IS
  'verify.signature_attempt | verify.signature_success | verify.signature_failed | '
  'verify.replay_detected | verify.activation_success | verify.invalid_order_id | ...';

COMMENT ON COLUMN public.payment_audit_log.meta IS
  'Extra context — never PII, never secrets, never raw signatures or keys.';
