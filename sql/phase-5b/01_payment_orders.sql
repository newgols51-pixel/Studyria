-- =============================================================================
-- FILE    : sql/phase-5b/01_payment_orders.sql
-- PROJECT : Studyria Premium Membership — Phase 5B
-- PURPOSE : Create membership_payment_orders table for Razorpay order tracking.
--           Append-only audit trail. NO membership activation here.
-- SAFE    : Additive only. Does NOT touch any existing table.
-- RUN     : Supabase SQL Editor (service_role). Idempotent — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. membership_payment_orders — one row per Razorpay order creation attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_payment_orders (

    -- Internal PK
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── User context ──────────────────────────────────────────────────────
    -- Set at creation; never changes. ON DELETE SET NULL so orphaned rows
    -- remain for audit even if the user account is deleted.
    user_id             UUID        NOT NULL REFERENCES auth.users(id)
                                    ON DELETE SET NULL,

    user_email          TEXT        NOT NULL,

    -- ── Plan reference ────────────────────────────────────────────────────
    -- Slug as stored in membership_plans.slug (e.g. 'monthly', 'quarterly').
    -- Denormalised for audit durability — plan row may be archived later.
    plan_slug           TEXT        NOT NULL,
    plan_name           TEXT        NOT NULL,

    -- ── Financials (server-verified, never trusted from client) ───────────
    amount_paise        BIGINT      NOT NULL CHECK (amount_paise > 0),
    currency            TEXT        NOT NULL DEFAULT 'INR'
                                    CHECK (currency = 'INR'),
    duration_days       INTEGER     NOT NULL CHECK (duration_days > 0),

    -- ── Razorpay identifiers ──────────────────────────────────────────────
    -- Populated after successful Razorpay Orders API call.
    razorpay_order_id   TEXT        UNIQUE,          -- order_xxxx
    receipt_id          TEXT        NOT NULL UNIQUE, -- studyria_<plan>_<ts>_<rand>

    -- ── State machine ─────────────────────────────────────────────────────
    -- 'created'   : order created on Razorpay, awaiting user payment
    -- 'attempted' : Razorpay modal opened, no result yet
    -- 'paid'      : Razorpay webhook confirmed payment.captured (Phase 5C)
    -- 'failed'    : payment failed or expired
    -- 'cancelled' : user dismissed the modal
    status              TEXT        NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','attempted','paid','failed','cancelled')),

    -- ── Duplicate / replay prevention ─────────────────────────────────────
    -- Idempotency key: one pending order per (user_id, plan_slug) window.
    -- The unique index below enforces this at DB level.
    idempotency_key     TEXT        NOT NULL UNIQUE,

    -- ── Audit fields ──────────────────────────────────────────────────────
    -- Razorpay API raw response stored for debugging (no secrets here).
    razorpay_response   JSONB       DEFAULT '{}',

    -- Client IP and user-agent for fraud detection (set by Edge Function).
    client_ip           TEXT,
    user_agent          TEXT,

    -- Timestamps — created_at is immutable; updated_at tracks state changes.
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Order expiry: Razorpay orders expire after 15 minutes by default.
    expires_at          TIMESTAMPTZ NOT NULL
                        DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- ---------------------------------------------------------------------------
-- 2. Auto-update trigger for updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_payment_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_orders_updated_at
    ON public.membership_payment_orders;

CREATE TRIGGER trg_payment_orders_updated_at
    BEFORE UPDATE ON public.membership_payment_orders
    FOR EACH ROW EXECUTE FUNCTION public.update_payment_orders_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
-- Fast lookup by Razorpay order ID (webhook handler)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_rzp_order
    ON public.membership_payment_orders (razorpay_order_id)
    WHERE razorpay_order_id IS NOT NULL;

-- Fast lookup by user + status (duplicate order prevention)
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_status
    ON public.membership_payment_orders (user_id, status, created_at DESC);

-- Receipt deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_receipt
    ON public.membership_payment_orders (receipt_id);

-- Idempotency enforcement at DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_idempotency
    ON public.membership_payment_orders (idempotency_key);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.membership_payment_orders ENABLE ROW LEVEL SECURITY;

-- Users can only SELECT their own rows.
DROP POLICY IF EXISTS "payment_orders: owner select" ON public.membership_payment_orders;
CREATE POLICY "payment_orders: owner select"
    ON public.membership_payment_orders
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- INSERT and UPDATE only via service_role (Edge Functions).
-- Authenticated users CANNOT write directly to this table.
-- (No INSERT policy = only service_role can insert.)

-- ---------------------------------------------------------------------------
-- 5. Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE  public.membership_payment_orders IS
    'Studyria Phase 5B: Razorpay order audit trail. '
    'Append-mostly. No membership activation stored here.';

COMMENT ON COLUMN public.membership_payment_orders.status IS
    'created | attempted | paid | failed | cancelled';

COMMENT ON COLUMN public.membership_payment_orders.idempotency_key IS
    'SHA-256(user_id + plan_slug + date-window) — prevents duplicate orders';

COMMENT ON COLUMN public.membership_payment_orders.razorpay_response IS
    'Raw Razorpay Orders API response (sanitised — no secret keys)';

COMMENT ON COLUMN public.membership_payment_orders.expires_at IS
    'Razorpay order expiry; stale created orders auto-expire after 15 min';

-- ---------------------------------------------------------------------------
-- 6. Expiry cleanup function (call via pg_cron or Supabase scheduled job)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_payment_orders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE public.membership_payment_orders
       SET status = 'failed'
     WHERE status = 'created'
       AND expires_at < NOW();
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_payment_orders IS
    'Mark created orders past their expiry as failed. '
    'Call via Supabase pg_cron: SELECT cron.schedule(''0 * * * *'', $$SELECT expire_stale_payment_orders()$$)';
