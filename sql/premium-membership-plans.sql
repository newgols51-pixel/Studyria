-- =============================================================================
-- FILE: sql/premium-membership-plans.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Define the membership_plans table
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: membership_plans
-- Stores all available premium membership tiers.
-- Read-only for users; managed by admin only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.membership_plans (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Unique slug: 'monthly' | 'quarterly' | 'yearly' | 'lifetime'
    slug            TEXT        NOT NULL UNIQUE,

    -- Display name e.g. 'Monthly Premium'
    name            TEXT        NOT NULL,

    -- Full description for plan comparison UI
    description     TEXT,

    -- Duration in days this plan grants (30, 90, 365, 36500)
    duration_days   INTEGER     NOT NULL CHECK (duration_days > 0),

    -- Price in smallest unit (paise for INR: 39900 = Rs.399)
    price           BIGINT      NOT NULL CHECK (price >= 0),

    -- ISO 4217 currency code
    currency        TEXT        NOT NULL DEFAULT 'INR',

    -- Badge label: 'Best Value' | 'Popular' | 'Starter' | NULL
    badge           TEXT,

    -- Display sort order (lower = first)
    sort_order      INTEGER     NOT NULL DEFAULT 0,

    -- Feature map: {"offline_downloads": true, "ad_free": true, "mcq_unlimited": true}
    features        JSONB       NOT NULL DEFAULT '{}',

    -- Soft toggle: false = archived, hidden from purchase UI
    active          BOOLEAN     NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION public.update_membership_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_plans_updated_at ON public.membership_plans;
CREATE TRIGGER trg_membership_plans_updated_at
    BEFORE UPDATE ON public.membership_plans
    FOR EACH ROW EXECUTE FUNCTION public.update_membership_plans_updated_at();

COMMENT ON TABLE  public.membership_plans               IS 'Studyria Premium: available subscription tiers';
COMMENT ON COLUMN public.membership_plans.slug          IS 'URL-safe unique plan identifier';
COMMENT ON COLUMN public.membership_plans.duration_days IS 'Membership duration in days';
COMMENT ON COLUMN public.membership_plans.price         IS 'Price in smallest currency unit (paise for INR)';
COMMENT ON COLUMN public.membership_plans.features      IS 'JSONB map of feature keys enabled in this plan';
COMMENT ON COLUMN public.membership_plans.active        IS 'FALSE = archived plan, hidden from purchase UI';
