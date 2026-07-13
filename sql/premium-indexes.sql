-- =============================================================================
-- FILE: sql/premium-indexes.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Performance indexes for all membership tables
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- NOTE: Run AFTER table creation SQL files.
-- =============================================================================

-- =============================================================================
-- membership_plans indexes
-- =============================================================================

-- Fast lookup by slug (used in plan selection UI and service methods)
CREATE INDEX IF NOT EXISTS idx_membership_plans_slug
    ON public.membership_plans (slug)
    WHERE active = TRUE;

-- Sort order for plan listing
CREATE INDEX IF NOT EXISTS idx_membership_plans_sort
    ON public.membership_plans (sort_order ASC)
    WHERE active = TRUE;

-- =============================================================================
-- user_memberships indexes
-- =============================================================================

-- Primary lookup: find active membership for a user
-- Most frequent query: "does this user have an active membership?"
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_status
    ON public.user_memberships (user_id, status)
    WHERE status = 'active';

-- Expiry sweep: find all memberships expiring soon (for cron job in Phase 4B)
CREATE INDEX IF NOT EXISTS idx_user_memberships_expires
    ON public.user_memberships (expires_at ASC)
    WHERE status = 'active';

-- Plan analytics: how many users are on each plan
CREATE INDEX IF NOT EXISTS idx_user_memberships_plan
    ON public.user_memberships (plan_id, status);

-- =============================================================================
-- membership_transactions indexes
-- (additional indexes — base indexes created in transactions SQL file)
-- =============================================================================

-- Status-based queries for admin reporting
CREATE INDEX IF NOT EXISTS idx_membership_tx_status
    ON public.membership_transactions (status, created_at DESC);

-- =============================================================================
-- membership_logs indexes
-- (additional indexes — base indexes created in logs SQL file)
-- =============================================================================

-- None additional — covered by indexes in premium-membership-logs.sql

-- =============================================================================
-- membership_features indexes
-- =============================================================================

-- Fast feature_key lookup (used constantly by client-side hasFeature() checks)
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_features_key
    ON public.membership_features (feature_key);

-- Enabled feature scan
CREATE INDEX IF NOT EXISTS idx_membership_features_enabled
    ON public.membership_features (enabled)
    WHERE enabled = TRUE;
