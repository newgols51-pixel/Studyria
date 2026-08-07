-- Migrations for Studyria Premium Membership Admin Panel Upgrade
-- File: /tmp/studyria_repo/sql/admin-membership-panel.sql
-- Idempotent, safe, and fully commented migration script.

BEGIN;

-- ==========================================
-- 1. ALTER user_memberships TABLE
-- Add columns if they do not exist
-- ==========================================

ALTER TABLE public.user_memberships 
  ADD COLUMN IF NOT EXISTS granted_by UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS grant_reason TEXT;

COMMENT ON COLUMN public.user_memberships.granted_by IS 'The UUID of the administrator who manually granted or modified this membership.';
COMMENT ON COLUMN public.user_memberships.notes IS 'Internal administrative notes regarding the custom plan or manual override.';
COMMENT ON COLUMN public.user_memberships.grant_reason IS 'The reason provided by the administrator for the manual membership grant.';


-- ==========================================
-- 2. CREATE TABLE admin_activity_logs
-- Idempotent creation with comments and indexes
-- ==========================================

CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT DEFAULT 'membership',
    target_id UUID,
    user_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Action check constraint to restrict to allowed action types
    CONSTRAINT check_admin_activity_action CHECK (action IN (
        'grant', 'extend', 'renew', 'suspend', 'resume', 
        'activate', 'deactivate', 'upgrade', 'downgrade', 
        'create_custom_plan', 'manual_grant'
    ))
);

-- Comments on admin_activity_logs and columns
COMMENT ON TABLE public.admin_activity_logs IS 'Tracks all administrative actions performed on user memberships and custom plans.';
COMMENT ON COLUMN public.admin_activity_logs.id IS 'Unique identifier for the activity log entry.';
COMMENT ON COLUMN public.admin_activity_logs.admin_id IS 'References the admin (auth.users) who initiated the action.';
COMMENT ON COLUMN public.admin_activity_logs.action IS 'The administrative action performed.';
COMMENT ON COLUMN public.admin_activity_logs.target_type IS 'The object category affected (default: membership).';
COMMENT ON COLUMN public.admin_activity_logs.target_id IS 'The UUID of the specific target (typically user_memberships.id).';
COMMENT ON COLUMN public.admin_activity_logs.user_id IS 'The UUID of the member whose membership was impacted.';
COMMENT ON COLUMN public.admin_activity_logs.details IS 'Structured JSON metadata holding historical changes and inputs (plan_name, plan_slug, duration_days, previous_status, new_status, previous_plan, new_plan, notes, custom_name, custom_duration, custom_expiry).';
COMMENT ON COLUMN public.admin_activity_logs.created_at IS 'The timestamp when this administrative log was created.';

-- Creating indexes for high performance administrative queries
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_created ON public.admin_activity_logs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_target_created ON public.admin_activity_logs (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_action_created ON public.admin_activity_logs (action, created_at DESC);


-- ==========================================
-- 3. RLS POLICIES FOR admin_activity_logs
-- Enable RLS and define SELECT and INSERT rules
-- ==========================================

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- Select policy: Allow access only to administrators
DROP POLICY IF EXISTS "Allow admins to select admin_activity_logs" ON public.admin_activity_logs;
CREATE POLICY "Allow admins to select admin_activity_logs" 
  ON public.admin_activity_logs
  FOR SELECT
  TO authenticated
  USING (public.is_membership_admin());

-- Insert policy: Allow authenticated administrators to insert log entries
DROP POLICY IF EXISTS "Allow admins to insert admin_activity_logs" ON public.admin_activity_logs;
CREATE POLICY "Allow admins to insert admin_activity_logs" 
  ON public.admin_activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_membership_admin());


-- ==========================================
-- 4. UPDATE membership_logs EVENT CHECK CONSTRAINT
-- Drop existing check constraint and recreate with new types
-- ==========================================

-- Safely identify and drop existing check constraint if it exists.
-- It typically targets the 'event' column. We attempt to drop it by name.
ALTER TABLE public.membership_logs 
  DROP CONSTRAINT IF EXISTS membership_logs_event_check;

-- Recreate the check constraint with the expanded event types
ALTER TABLE public.membership_logs
  ADD CONSTRAINT membership_logs_event_check CHECK (event IN (
    'activated', 'expired', 'cancelled', 'suspended', 'renewed', 'restored', 
    'admin_override', 'payment_received', 'refund_issued',
    'admin_grant', 'admin_extend', 'admin_suspend', 'admin_resume', 'admin_upgrade', 'admin_downgrade'
  ));

COMMENT ON COLUMN public.membership_logs.event IS 'The transaction or administrative event recorded for the membership.';


-- ==========================================
-- 5. UPDATE RLS POLICIES FOR membership_logs
-- Allow administrators to INSERT logs during operations
-- ==========================================

ALTER TABLE public.membership_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admins to insert membership_logs" ON public.membership_logs;
CREATE POLICY "Allow admins to insert membership_logs"
  ON public.membership_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_membership_admin());

COMMIT;
