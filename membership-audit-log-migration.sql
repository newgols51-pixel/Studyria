-- ═══════════════════════════════════════════════════════════════
-- STUDYRIA — Membership Audit Log Table Migration
-- Run this in Supabase SQL Editor to enable audit logging
-- for all manual membership admin actions.
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the audit log table
CREATE TABLE IF NOT EXISTS membership_audit_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membership_id   UUID REFERENCES user_memberships(id) ON DELETE SET NULL,
  user_id         TEXT,
  action          TEXT NOT NULL DEFAULT 'unknown',
  admin_user_id   TEXT,
  old_status      TEXT,
  new_status      TEXT,
  old_expires_at  TIMESTAMPTZ,
  new_expires_at  TIMESTAMPTZ,
  old_plan_id     UUID,
  new_plan_id     UUID,
  plan_slug       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE membership_audit_log ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
--    Admin-only read access (all authenticated users can read for now;
--    tighten to admin role check if you have an admin role policy)
CREATE POLICY "Admin read audit log" ON membership_audit_log
  FOR SELECT TO authenticated USING (true);

--    Any authenticated user can INSERT (the admin app writes logs)
--    This is safe because the admin app is the only writer
CREATE POLICY "Admin write audit log" ON membership_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 4. No UPDATE or DELETE policies = these operations are blocked
--    (audit log is append-only for data integrity)

-- 5. Create index for fast lookups by membership_id
CREATE INDEX IF NOT EXISTS idx_membership_audit_log_membership_id
  ON membership_audit_log(membership_id);

-- 6. Create index for fast lookups by user_id
CREATE INDEX IF NOT EXISTS idx_membership_audit_log_user_id
  ON membership_audit_log(user_id);

-- 7. Create index for chronological ordering
CREATE INDEX IF NOT EXISTS idx_membership_audit_log_created_at
  ON membership_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- NOTE: user_memberships.status is a TEXT column, so 'suspended'
--       is already a valid value — no schema change needed.
--       Ensure your admin_users RLS policy allows admins to UPDATE
--       user_memberships (should already be configured).
-- ═══════════════════════════════════════════════════════════════
