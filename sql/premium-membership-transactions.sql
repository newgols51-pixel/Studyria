-- =============================================================================
-- FILE: sql/premium-membership-transactions.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Define the membership_transactions table
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: membership_transactions
-- Immutable payment audit trail.
-- One row per payment attempt (success or failure).
-- NEVER updated after creation — append-only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.membership_transactions (

    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The user who made the payment
    user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,

    -- The membership this payment activates/renews (nullable for failed attempts)
    membership_id       UUID        REFERENCES public.user_memberships(id) ON DELETE SET NULL,

    -- Payment provider slug: 'razorpay' | 'manual' | 'promo' | 'admin_grant'
    payment_provider    TEXT        NOT NULL DEFAULT 'razorpay',

    -- Provider-specific transaction/order reference ID
    payment_reference   TEXT,

    -- Amount charged in smallest currency unit (paise for INR)
    amount              BIGINT      NOT NULL CHECK (amount >= 0),

    -- ISO 4217 currency code
    currency            TEXT        NOT NULL DEFAULT 'INR',

    -- Transaction outcome: 'pending' | 'success' | 'failed' | 'refunded'
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','success','failed','refunded')),

    -- Free-form provider response, webhook payload, error details
    metadata            JSONB       NOT NULL DEFAULT '{}',

    -- Immutable — no updated_at by design
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for provider lookups (webhook deduplication)
CREATE INDEX IF NOT EXISTS idx_membership_tx_reference
    ON public.membership_transactions (payment_provider, payment_reference)
    WHERE payment_reference IS NOT NULL;

-- Index for user transaction history
CREATE INDEX IF NOT EXISTS idx_membership_tx_user
    ON public.membership_transactions (user_id, created_at DESC);

COMMENT ON TABLE  public.membership_transactions                    IS 'Studyria Premium: immutable payment audit trail';
COMMENT ON COLUMN public.membership_transactions.payment_provider   IS 'razorpay | manual | promo | admin_grant';
COMMENT ON COLUMN public.membership_transactions.payment_reference  IS 'Provider order/payment ID for deduplication';
COMMENT ON COLUMN public.membership_transactions.amount             IS 'Amount in smallest currency unit (paise)';
COMMENT ON COLUMN public.membership_transactions.status             IS 'pending | success | failed | refunded';
COMMENT ON COLUMN public.membership_transactions.metadata           IS 'Provider response, webhook payload, error details';
