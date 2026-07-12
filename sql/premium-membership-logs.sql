-- =============================================================================
-- FILE: sql/premium-membership-logs.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Define the membership_logs table
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- SAFE: Does NOT modify any existing table.
-- =============================================================================

-- =============================================================================
-- TABLE: membership_logs
-- Event-sourced audit log for every membership lifecycle change.
-- Append-only. Never updated.
-- Events: activated | expired | cancelled | suspended | renewed | restored | admin_override
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.membership_logs (

    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which membership this event belongs to
    membership_id   UUID        NOT NULL REFERENCES public.user_memberships(id) ON DELETE CASCADE,

    -- Event type identifier
    -- activated | expired | cancelled | suspended | renewed | restored | admin_override | payment_received | refund_issued
    event           TEXT        NOT NULL
                    CHECK (event IN (
                        'activated',
                        'expired',
                        'cancelled',
                        'suspended',
                        'renewed',
                        'restored',
                        'admin_override',
                        'payment_received',
                        'refund_issued'
                    )),

    -- Additional event context: previous status, actor, reason, etc.
    -- Example: {"previous_status": "pending", "actor": "webhook", "reason": "payment_confirmed"}
    metadata        JSONB       NOT NULL DEFAULT '{}',

    -- Immutable timestamp — no updated_at
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for membership event history timeline
CREATE INDEX IF NOT EXISTS idx_membership_logs_membership
    ON public.membership_logs (membership_id, created_at DESC);

-- Index for event-type analytics
CREATE INDEX IF NOT EXISTS idx_membership_logs_event
    ON public.membership_logs (event, created_at DESC);

COMMENT ON TABLE  public.membership_logs               IS 'Studyria Premium: append-only lifecycle event log';
COMMENT ON COLUMN public.membership_logs.membership_id IS 'Which membership this event occurred on';
COMMENT ON COLUMN public.membership_logs.event         IS 'Lifecycle event: activated | expired | cancelled | etc.';
COMMENT ON COLUMN public.membership_logs.metadata      IS 'Event context: previous state, actor, reason, etc.';
