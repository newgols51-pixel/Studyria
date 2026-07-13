-- =============================================================================
-- FILE: sql/premium-user-memberships.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Define the user_memberships table
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: user_memberships
-- One row per membership grant per user.
-- A user may have multiple rows (expired + active history).
-- Only ONE row should have status='active' per user at a time.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_memberships (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References auth.users (Supabase Auth)
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- References membership_plans
    plan_id         UUID        NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,

    -- Lifecycle status
    -- active | expired | cancelled | pending | suspended
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('active','expired','cancelled','pending','suspended')),

    -- Membership validity window
    started_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,

    -- Set when user cancels (but membership may still be active until expires_at)
    cancelled_at    TIMESTAMPTZ,

    -- Future: auto-renewal flag for recurring subscriptions
    auto_renew      BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION public.update_user_memberships_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_memberships_updated_at ON public.user_memberships;
CREATE TRIGGER trg_user_memberships_updated_at
    BEFORE UPDATE ON public.user_memberships
    FOR EACH ROW EXECUTE FUNCTION public.update_user_memberships_updated_at();

-- Constraint: only one active membership per user
-- (Enforced at application level + partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memberships_one_active
    ON public.user_memberships (user_id)
    WHERE status = 'active';

COMMENT ON TABLE  public.user_memberships              IS 'Studyria Premium: per-user membership grants';
COMMENT ON COLUMN public.user_memberships.user_id      IS 'References auth.users — the member';
COMMENT ON COLUMN public.user_memberships.plan_id      IS 'Which plan this membership was granted under';
COMMENT ON COLUMN public.user_memberships.status       IS 'active | expired | cancelled | pending | suspended';
COMMENT ON COLUMN public.user_memberships.expires_at   IS 'Hard expiry — after this Premium features are revoked';
COMMENT ON COLUMN public.user_memberships.cancelled_at IS 'When user requested cancellation (may still be active until expires_at)';
COMMENT ON COLUMN public.user_memberships.auto_renew   IS 'Reserved for future recurring billing support';
