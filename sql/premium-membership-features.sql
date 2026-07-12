-- =============================================================================
-- FILE: sql/premium-membership-features.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Define the membership_features registry table
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: membership_features
-- Central registry of all features that can be toggled per plan.
-- feature_key in this table must match keys used in membership_plans.features JSONB.
-- Admin-managed. No user access.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.membership_features (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Machine-readable key used in membership_plans.features JSONB
    -- Examples: 'offline_downloads', 'ad_free', 'mcq_unlimited', 'priority_support'
    feature_key     TEXT        NOT NULL UNIQUE,

    -- Human-readable feature name for admin UI
    feature_name    TEXT        NOT NULL,

    -- Full description for admin/developer reference
    description     TEXT,

    -- Global kill-switch: false = feature disabled for ALL users regardless of plan
    -- Use for emergency rollbacks without modifying plan configs
    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Immutable creation timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No updated_at — changes to enabled state are meaningful and tracked by admin

COMMENT ON TABLE  public.membership_features              IS 'Studyria Premium: registry of all toggleable premium features';
COMMENT ON COLUMN public.membership_features.feature_key  IS 'Machine key matching keys in membership_plans.features JSONB';
COMMENT ON COLUMN public.membership_features.enabled      IS 'Global kill-switch — FALSE disables feature for all users';
