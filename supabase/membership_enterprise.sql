-- ═══════════════════════════════════════════════════════════════════
-- Studyria Enterprise Membership System — SQL Migration
-- Version: 1.0
-- Date: 2026-07-16
-- ═══════════════════════════════════════════════════════════════════
--
-- This migration creates the full enterprise membership architecture:
--   - Extends existing tables (user_memberships, membership_plans, membership_transactions)
--   - Creates new tables (membership_history, membership_audit_logs, etc.)
--   - Implements RLS policies for role-based access
--   - Creates database functions for secure operations
--   - Creates triggers for automatic audit logging
--   - Adds indexes for performance
--
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. EXTEND EXISTING TABLES ─────────────────────────────────────

-- Add missing columns to user_memberships
ALTER TABLE user_memberships
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS renewed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason   TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason      TEXT,
  ADD COLUMN IF NOT EXISTS granted_by         UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS grant_type         TEXT DEFAULT 'purchase' CHECK (grant_type IN ('purchase','manual','lifetime','custom','trial')),
  ADD COLUMN IF NOT EXISTS admin_notes        TEXT,
  ADD COLUMN IF NOT EXISTS role               TEXT DEFAULT 'viewer' CHECK (role IN ('super_admin','admin','moderator','support','viewer')),
  ADD COLUMN IF NOT EXISTS is_lifetime       BOOLEAN DEFAULT FALSE;

-- Add columns to membership_plans
ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS permissions       JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_notes      TEXT,
  ADD COLUMN IF NOT EXISTS sort_order        INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- Add columns to membership_transactions
ALTER TABLE membership_transactions
  ADD COLUMN IF NOT EXISTS order_id          TEXT,
  ADD COLUMN IF NOT EXISTS signature        TEXT,
  ADD COLUMN IF NOT EXISTS payment_method   TEXT,
  ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_status    TEXT DEFAULT 'none' CHECK (refund_status IN ('none','pending','completed','rejected')),
  ADD COLUMN IF NOT EXISTS refunded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- ─── 2. CREATE NEW TABLES ──────────────────────────────────────────

-- 2.1: membership_history — tracks every membership change
CREATE TABLE IF NOT EXISTS membership_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   UUID REFERENCES user_memberships(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('created','activated','renewed','extended','expired','suspended','cancelled','reactivated','plan_changed','manual_grant','lifetime_grant','custom_plan','deactivated')),
  old_status      TEXT,
  new_status      TEXT,
  old_expires_at  TIMESTAMPTZ,
  new_expires_at  TIMESTAMPTZ,
  old_plan_id     UUID REFERENCES membership_plans(id),
  new_plan_id     UUID REFERENCES membership_plans(id),
  changed_by      UUID REFERENCES auth.users(id),
  change_reason   TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2: membership_audit_logs — admin actions (never deleted)
CREATE TABLE IF NOT EXISTS membership_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  membership_id  UUID REFERENCES user_memberships(id) ON DELETE SET NULL,
  action          TEXT NOT NULL CHECK (action IN ('grant','revoke','suspend','cancel','reactivate','refund','delete','change_plan','custom_plan','lifetime_grant','manual_grant','export','import','bulk_action','settings_change')),
  old_value       JSONB,
  new_value       JSONB,
  reason          TEXT,
  admin_notes     TEXT,
  ip_address      INET,
  user_agent      TEXT,
  browser         TEXT,
  device          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3: membership_manual_grants — records of manual grants
CREATE TABLE IF NOT EXISTS membership_manual_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id   UUID REFERENCES user_memberships(id) ON DELETE SET NULL,
  plan_id         UUID REFERENCES membership_plans(id),
  granted_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  grant_type      TEXT NOT NULL CHECK (grant_type IN ('manual','lifetime','custom','trial')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  duration_days   INT,
  is_lifetime    BOOLEAN DEFAULT FALSE,
  reason          TEXT NOT NULL,
  admin_notes     TEXT,
  custom_plan_name TEXT,
  custom_permissions JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.4: membership_plan_history — tracks plan changes
CREATE TABLE IF NOT EXISTS membership_plan_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   UUID REFERENCES user_memberships(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_plan_id     UUID REFERENCES membership_plans(id),
  new_plan_id     UUID REFERENCES membership_plans(id),
  changed_by      UUID REFERENCES auth.users(id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.5: membership_activity_logs — user activity tracking
CREATE TABLE IF NOT EXISTS membership_activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type   TEXT NOT NULL CHECK (activity_type IN ('login','logout','purchase','renewal','manual_grant','plan_change','suspension','activation','expiry','cancellation','premium_access','premium_content_view','export','import')),
  metadata        JSONB DEFAULT '{}',
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.6: membership_notifications — user notifications
CREATE TABLE IF NOT EXISTS membership_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('activated','renewed','extended','expiring_soon','expired','manual_grant','suspended','cancelled','lifetime_grant','custom_plan','refund')),
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. INDEXES ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_um_user_id        ON user_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_um_status         ON user_memberships(status);
CREATE INDEX IF NOT EXISTS idx_um_expires_at     ON user_memberships(expires_at);
CREATE INDEX IF NOT EXISTS idx_um_grant_type     ON user_memberships(grant_type);
CREATE INDEX IF NOT EXISTS idx_um_is_lifetime    ON user_memberships(is_lifetime);

CREATE INDEX IF NOT EXISTS idx_mt_user_id        ON membership_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mt_provider_tx_id ON membership_transactions(provider_tx_id);
CREATE INDEX IF NOT EXISTS idx_mt_status         ON membership_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mt_created_at     ON membership_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_membership_id  ON membership_transactions(membership_id);

CREATE INDEX IF NOT EXISTS idx_mh_user_id        ON membership_history(user_id);
CREATE INDEX IF NOT EXISTS idx_mh_membership_id  ON membership_history(membership_id);
CREATE INDEX IF NOT EXISTS idx_mh_action         ON membership_history(action);
CREATE INDEX IF NOT EXISTS idx_mh_created_at     ON membership_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_al_admin_id       ON membership_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_al_target_user    ON membership_audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_al_action         ON membership_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_al_created_at    ON membership_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mg_user_id        ON membership_manual_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_mg_granted_by     ON membership_manual_grants(granted_by);
CREATE INDEX IF NOT EXISTS idx_mg_created_at     ON membership_manual_grants(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_act_user_id       ON membership_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_act_type          ON membership_activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_act_created_at    ON membership_activity_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_user_id     ON membership_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_is_read     ON membership_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created_at  ON membership_notifications(created_at DESC);

-- ─── 4. ROW LEVEL SECURITY (RLS) ──────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE user_memberships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_manual_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_plan_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_notifications ENABLE ROW LEVEL SECURITY;

-- 4.1: user_memberships policies
-- Users can read their own membership
CREATE OR REPLACE POLICY "users_read_own_membership"
  ON user_memberships FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins (super_admin, admin, moderator, support) can read all
CREATE OR REPLACE POLICY "admins_read_all_memberships"
  ON user_memberships FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- Only super_admin can insert/update/delete memberships directly
-- (payment flow uses service_role bypass)
CREATE OR REPLACE POLICY "super_admin_write_memberships"
  ON user_memberships FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role = 'super_admin'
    )
  );

-- 4.2: membership_transactions policies
CREATE OR REPLACE POLICY "users_read_own_transactions"
  ON membership_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "admins_read_all_transactions"
  ON membership_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- 4.3: membership_history policies
CREATE OR REPLACE POLICY "users_read_own_history"
  ON membership_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "admins_read_all_history"
  ON membership_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- 4.4: membership_audit_logs policies (admin-only)
CREATE OR REPLACE POLICY "admins_read_audit_logs"
  ON membership_audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- 4.5: membership_manual_grants policies
CREATE OR REPLACE POLICY "users_read_own_grants"
  ON membership_manual_grants FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "admins_all_grants"
  ON membership_manual_grants FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin')
    )
  );

-- 4.6: membership_plan_history policies
CREATE OR REPLACE POLICY "users_read_own_plan_history"
  ON membership_plan_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "admins_read_all_plan_history"
  ON membership_plan_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- 4.7: membership_activity_logs policies
CREATE OR REPLACE POLICY "users_read_own_activity"
  ON membership_activity_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "admins_read_all_activity"
  ON membership_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_memberships um
      WHERE um.user_id = auth.uid()
        AND um.role IN ('super_admin','admin','moderator','support')
    )
  );

-- Users can insert their own activity logs
CREATE OR REPLACE POLICY "users_insert_own_activity"
  ON membership_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 4.8: membership_notifications policies
CREATE OR REPLACE POLICY "users_read_own_notifications"
  ON membership_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "users_update_own_notifications"
  ON membership_notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 5. DATABASE FUNCTIONS ────────────────────────────────────────

-- 5.1: Verify and activate membership (called after Razorpay success)
-- SECURITY: This runs with SECURITY DEFINER so it bypasses RLS
-- Only callable by authenticated users
CREATE OR REPLACE FUNCTION verify_and_activate_membership(
  p_user_id       UUID,
  p_plan_id       UUID,
  p_payment_id    TEXT,
  p_order_id      TEXT DEFAULT NULL,
  p_signature     TEXT DEFAULT NULL,
  p_amount_inr    NUMERIC(10,2) DEFAULT 0,
  p_payment_method TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership    user_memberships%ROWTYPE;
  v_existing      user_memberships%ROWTYPE;
  v_plan          membership_plans%ROWTYPE;
  v_duration_days INT;
  v_now           TIMESTAMPTZ := NOW() AT TIME ZONE 'Asia/Kolkata';
  v_starts_at     TIMESTAMPTZ;
  v_expires_at    TIMESTAMPTZ;
  v_base_date     TIMESTAMPTZ;
  v_is_expired    BOOLEAN;
  v_tx_exists     BOOLEAN;
  v_membership_id UUID;
  v_result        JSONB;
BEGIN
  -- 1. Check for duplicate payment (replay protection)
  SELECT EXISTS(
    SELECT 1 FROM membership_transactions WHERE provider_tx_id = p_payment_id
  ) INTO v_tx_exists;

  IF v_tx_exists THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already processed', 'duplicate', true);
  END IF;

  -- 2. Fetch plan
  SELECT * INTO v_plan FROM membership_plans WHERE id = p_plan_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found or inactive');
  END IF;

  -- 3. Calculate duration
  v_duration_days := COALESCE(v_plan.trial_days, 0);
  IF v_duration_days = 0 THEN
    v_duration_days := CASE v_plan.billing_cycle
      WHEN '1day'   THEN 1
      WHEN '15days' THEN 15
      WHEN '30days' THEN 30
      WHEN '90days' THEN 90
      WHEN '180days' THEN 180
      WHEN '365days' THEN 365
      WHEN 'lifetime' THEN 36500  -- ~100 years
      ELSE 30
    END;
  END IF;

  -- 4. Check existing membership
  SELECT * INTO v_existing
  FROM user_memberships
  WHERE user_id = p_user_id
  ORDER BY expires_at DESC
  LIMIT 1;

  -- 5. Calculate expiry
  v_starts_at := v_now;
  IF FOUND AND v_existing.expires_at IS NOT NULL THEN
    IF v_existing.expires_at > v_now THEN
      -- Active membership: extend from current expiry
      v_base_date := v_existing.expires_at;
      v_is_expired := false;
    ELSE
      -- Expired: start fresh from now
      v_base_date := v_now;
      v_is_expired := true;
    END IF;
  ELSE
    v_base_date := v_now;
    v_is_expired := true;
  END IF;

  v_expires_at := v_base_date + (v_duration_days || ' days')::INTERVAL;

  -- 6. Upsert membership
  IF FOUND THEN
    UPDATE user_memberships SET
      plan_id    = p_plan_id,
      status     = 'active',
      expires_at = v_expires_at,
      started_at = CASE WHEN v_is_expired THEN v_now ELSE started_at END,
      renewed_at = v_now,
      updated_at = v_now,
      auto_renew = false,
      grant_type = 'purchase',
      is_lifetime = (v_plan.billing_cycle = 'lifetime')
    WHERE id = v_existing.id
    RETURNING * INTO v_membership;
    v_membership_id := v_membership.id;
  ELSE
    INSERT INTO user_memberships (user_id, plan_id, status, started_at, expires_at, auto_renew, grant_type, is_lifetime, role)
    VALUES (p_user_id, p_plan_id, 'active', v_starts_at, v_expires_at, false, 'purchase', (v_plan.billing_cycle = 'lifetime'), 'viewer')
    RETURNING * INTO v_membership;
    v_membership_id := v_membership.id;
  END IF;

  -- 7. Insert transaction
  INSERT INTO membership_transactions (
    user_id, plan_id, membership_id, provider, provider_tx_id, order_id, signature,
    amount_inr, currency, status, payment_method, verified_at
  ) VALUES (
    p_user_id, p_plan_id, v_membership_id, 'razorpay', p_payment_id, p_order_id, p_signature,
    p_amount_inr, 'INR', 'completed', p_payment_method, v_now
  );

  -- 8. Insert membership history
  INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, old_expires_at, new_expires_at, changed_by, metadata)
  VALUES (
    v_membership_id, p_user_id,
    CASE WHEN v_is_expired THEN 'renewed' ELSE 'extended' END,
    v_existing.status, 'active',
    v_existing.expires_at, v_expires_at,
    p_user_id,
    jsonb_build_object('payment_id', p_payment_id, 'plan_id', p_plan_id, 'duration_days', v_duration_days)
  );

  -- 9. Insert activity log
  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (p_user_id, 'purchase', jsonb_build_object('payment_id', p_payment_id, 'plan_id', p_plan_id, 'amount', p_amount_inr));

  -- 10. Create notification
  INSERT INTO membership_notifications (user_id, type, title, message, metadata)
  VALUES (
    p_user_id, 'activated', 'Membership Activated',
    'Your ' || v_plan.name || ' membership is now active. Expires on ' || TO_CHAR(v_expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.',
    jsonb_build_object('plan_name', v_plan.name, 'expires_at', v_expires_at)
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'expires_at', v_expires_at,
    'is_lifetime', (v_plan.billing_cycle = 'lifetime'),
    'message', 'Membership activated successfully'
  );
END;
$$;

-- 5.2: Grant manual membership (admin only)
CREATE OR REPLACE FUNCTION grant_manual_membership(
  p_user_id       UUID,
  p_plan_id       UUID DEFAULT NULL,
  p_started_at    TIMESTAMPTZ DEFAULT NOW(),
  p_expires_at    TIMESTAMPTZ DEFAULT NULL,
  p_duration_days INT DEFAULT NULL,
  p_grant_type    TEXT DEFAULT 'manual',
  p_reason        TEXT DEFAULT '',
  p_admin_notes   TEXT DEFAULT '',
  p_admin_id      UUID,
  p_custom_plan_name  TEXT DEFAULT NULL,
  p_custom_permissions JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      user_memberships%ROWTYPE;
  v_membership_id UUID;
  v_expires_at    TIMESTAMPTZ;
  v_starts_at     TIMESTAMPTZ := p_started_at;
  v_is_lifetime   BOOLEAN := FALSE;
  v_plan          membership_plans%ROWTYPE;
  v_admin_role    TEXT;
  v_client_info   JSONB;
BEGIN
  -- Verify admin is super_admin
  SELECT role INTO v_admin_role FROM user_memberships WHERE user_id = p_admin_id LIMIT 1;
  IF v_admin_role IS NULL OR v_admin_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only Super Admin can grant memberships');
  END IF;

  -- Determine if lifetime
  IF p_grant_type = 'lifetime' OR (p_duration_days IS NULL AND p_expires_at IS NULL) THEN
    v_is_lifetime := TRUE;
    v_expires_at := NULL;
  ELSIF p_expires_at IS NOT NULL THEN
    v_expires_at := p_expires_at;
  ELSIF p_duration_days IS NOT NULL THEN
    v_expires_at := v_starts_at + (p_duration_days || ' days')::INTERVAL;
  ELSE
    -- Default 30 days
    v_expires_at := v_starts_at + '30 days'::INTERVAL;
  END IF;

  -- Fetch plan if provided
  IF p_plan_id IS NOT NULL THEN
    SELECT * INTO v_plan FROM membership_plans WHERE id = p_plan_id;
  END IF;

  -- Check existing membership
  SELECT * INTO v_existing
  FROM user_memberships
  WHERE user_id = p_user_id
  ORDER BY expires_at DESC NULLS LAST
  LIMIT 1;

  -- Upsert membership
  IF FOUND THEN
    UPDATE user_memberships SET
      plan_id    = COALESCE(p_plan_id, plan_id),
      status     = 'active',
      started_at = v_starts_at,
      expires_at = v_expires_at,
      renewed_at = NOW(),
      updated_at = NOW(),
      grant_type = p_grant_type,
      granted_by = p_admin_id,
      admin_notes = p_admin_notes,
      is_lifetime = v_is_lifetime,
      role = COALESCE(role, 'viewer')
    WHERE id = v_existing.id
    RETURNING id INTO v_membership_id;
  ELSE
    INSERT INTO user_memberships (user_id, plan_id, status, started_at, expires_at, grant_type, granted_by, admin_notes, is_lifetime, role)
    VALUES (p_user_id, p_plan_id, 'active', v_starts_at, v_expires_at, p_grant_type, p_admin_id, p_admin_notes, v_is_lifetime, 'viewer')
    RETURNING id INTO v_membership_id;
  END IF;

  -- Insert manual grant record
  INSERT INTO membership_manual_grants (
    user_id, membership_id, plan_id, granted_by, grant_type, started_at, expires_at,
    duration_days, is_lifetime, reason, admin_notes, custom_plan_name, custom_permissions
  ) VALUES (
    p_user_id, v_membership_id, p_plan_id, p_admin_id, p_grant_type, v_starts_at, v_expires_at,
    p_duration_days, v_is_lifetime, p_reason, p_admin_notes, p_custom_plan_name, p_custom_permissions
  );

  -- Insert membership history
  INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, old_expires_at, new_expires_at, changed_by, change_reason, metadata)
  VALUES (
    v_membership_id, p_user_id,
    CASE WHEN p_grant_type = 'lifetime' THEN 'lifetime_grant' WHEN p_grant_type = 'custom' THEN 'custom_plan' ELSE 'manual_grant' END,
    v_existing.status, 'active',
    v_existing.expires_at, v_expires_at,
    p_admin_id, p_reason,
    jsonb_build_object('grant_type', p_grant_type, 'admin_id', p_admin_id, 'custom_plan_name', p_custom_plan_name)
  );

  -- Insert audit log
  INSERT INTO membership_audit_logs (admin_id, target_user_id, membership_id, action, old_value, new_value, reason, admin_notes)
  VALUES (
    p_admin_id, p_user_id, v_membership_id,
    CASE WHEN p_grant_type = 'lifetime' THEN 'lifetime_grant' WHEN p_grant_type = 'custom' THEN 'custom_plan' ELSE 'manual_grant' END,
    jsonb_build_object('status', v_existing.status, 'expires_at', v_existing.expires_at),
    jsonb_build_object('status', 'active', 'expires_at', v_expires_at, 'is_lifetime', v_is_lifetime),
    p_reason, p_admin_notes
  );

  -- Insert activity log
  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (p_user_id, 'manual_grant', jsonb_build_object('grant_type', p_grant_type, 'admin_id', p_admin_id));

  -- Create notification
  INSERT INTO membership_notifications (user_id, type, title, message, metadata)
  VALUES (
    p_user_id,
    CASE WHEN p_grant_type = 'lifetime' THEN 'lifetime_grant' WHEN p_grant_type = 'custom' THEN 'custom_plan' ELSE 'manual_grant' END,
    CASE WHEN p_grant_type = 'lifetime' THEN 'Lifetime Membership Granted' ELSE 'Membership Granted' END,
    CASE
      WHEN v_is_lifetime THEN 'You have been granted a Lifetime Membership. Enjoy unlimited access!'
      WHEN p_custom_plan_name IS NOT NULL THEN 'You have been granted a ' || p_custom_plan_name || ' membership.'
      ELSE 'Your membership has been granted by admin. ' || COALESCE('Expires: ' || TO_CHAR(v_expires_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'), 'Lifetime')
    END,
    jsonb_build_object('grant_type', p_grant_type, 'admin_id', p_admin_id, 'is_lifetime', v_is_lifetime)
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'expires_at', v_expires_at,
    'is_lifetime', v_is_lifetime,
    'message', 'Membership granted successfully'
  );
END;
$$;

-- 5.3: Suspend membership
CREATE OR REPLACE FUNCTION suspend_membership(
  p_user_id   UUID,
  p_reason    TEXT,
  p_admin_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership user_memberships%ROWTYPE;
  v_admin_role TEXT;
BEGIN
  SELECT role INTO v_admin_role FROM user_memberships WHERE user_id = p_admin_id LIMIT 1;
  IF v_admin_role IS NULL OR v_admin_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only Super Admin can suspend memberships');
  END IF;

  SELECT * INTO v_membership FROM user_memberships WHERE user_id = p_user_id ORDER BY expires_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No membership found');
  END IF;

  UPDATE user_memberships SET
    status = 'suspended',
    suspended_at = NOW(),
    suspended_reason = p_reason,
    updated_at = NOW()
  WHERE id = v_membership.id;

  INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, changed_by, change_reason)
  VALUES (v_membership.id, p_user_id, 'suspended', v_membership.status, 'suspended', p_admin_id, p_reason);

  INSERT INTO membership_audit_logs (admin_id, target_user_id, membership_id, action, old_value, new_value, reason)
  VALUES (p_admin_id, p_user_id, v_membership.id, 'suspend',
    jsonb_build_object('status', v_membership.status),
    jsonb_build_object('status', 'suspended'),
    p_reason);

  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (p_user_id, 'suspension', jsonb_build_object('reason', p_reason, 'admin_id', p_admin_id));

  INSERT INTO membership_notifications (user_id, type, title, message)
  VALUES (p_user_id, 'suspended', 'Membership Suspended', 'Your membership has been suspended. Reason: ' || p_reason);

  RETURN jsonb_build_object('success', true, 'message', 'Membership suspended');
END;
$$;

-- 5.4: Cancel membership
CREATE OR REPLACE FUNCTION cancel_membership(
  p_user_id   UUID,
  p_reason    TEXT,
  p_admin_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership user_memberships%ROWTYPE;
  v_admin_role TEXT;
BEGIN
  SELECT role INTO v_admin_role FROM user_memberships WHERE user_id = p_admin_id LIMIT 1;
  IF v_admin_role IS NULL OR v_admin_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only Super Admin can cancel memberships');
  END IF;

  SELECT * INTO v_membership FROM user_memberships WHERE user_id = p_user_id ORDER BY expires_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No membership found');
  END IF;

  UPDATE user_memberships SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancel_reason = p_reason,
    updated_at = NOW()
  WHERE id = v_membership.id;

  INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, changed_by, change_reason)
  VALUES (v_membership.id, p_user_id, 'cancelled', v_membership.status, 'cancelled', p_admin_id, p_reason);

  INSERT INTO membership_audit_logs (admin_id, target_user_id, membership_id, action, old_value, new_value, reason)
  VALUES (p_admin_id, p_user_id, v_membership.id, 'cancel',
    jsonb_build_object('status', v_membership.status),
    jsonb_build_object('status', 'cancelled'),
    p_reason);

  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (p_user_id, 'cancellation', jsonb_build_object('reason', p_reason, 'admin_id', p_admin_id));

  INSERT INTO membership_notifications (user_id, type, title, message)
  VALUES (p_user_id, 'cancelled', 'Membership Cancelled', 'Your membership has been cancelled. Reason: ' || p_reason);

  RETURN jsonb_build_object('success', true, 'message', 'Membership cancelled');
END;
$$;

-- 5.5: Delete/deactivate membership
CREATE OR REPLACE FUNCTION deactivate_membership(
  p_user_id   UUID,
  p_admin_id   UUID,
  p_action     TEXT DEFAULT 'deactivate'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership user_memberships%ROWTYPE;
  v_admin_role TEXT;
BEGIN
  SELECT role INTO v_admin_role FROM user_memberships WHERE user_id = p_admin_id LIMIT 1;
  IF v_admin_role IS NULL OR v_admin_role != 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only Super Admin can perform this action');
  END IF;

  SELECT * INTO v_membership FROM user_memberships WHERE user_id = p_user_id ORDER BY expires_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No membership found');
  END IF;

  IF p_action = 'delete' THEN
    -- Record audit before delete
    INSERT INTO membership_audit_logs (admin_id, target_user_id, membership_id, action, old_value, reason)
    VALUES (p_admin_id, p_user_id, v_membership.id, 'delete',
      jsonb_build_object('status', v_membership.status, 'plan_id', v_membership.plan_id, 'expires_at', v_membership.expires_at),
      'Membership deleted by admin');

    DELETE FROM user_memberships WHERE id = v_membership.id;
  ELSE
    UPDATE user_memberships SET
      status = 'expired',
      updated_at = NOW()
    WHERE id = v_membership.id;

    INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, changed_by)
    VALUES (v_membership.id, p_user_id, 'deactivated', v_membership.status, 'expired', p_admin_id);

    INSERT INTO membership_audit_logs (admin_id, target_user_id, membership_id, action, old_value, new_value, reason)
    VALUES (p_admin_id, p_user_id, v_membership.id, 'revoke',
      jsonb_build_object('status', v_membership.status),
      jsonb_build_object('status', 'expired'),
      'Membership deactivated by admin');
  END IF;

  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (p_user_id, 'expiry', jsonb_build_object('admin_id', p_admin_id, 'action', p_action));

  RETURN jsonb_build_object('success', true, 'message', 'Action completed: ' || p_action);
END;
$$;

-- 5.6: Get membership statistics (for admin dashboard)
CREATE OR REPLACE FUNCTION get_membership_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total        INT;
  v_active       INT;
  v_expired      INT;
  v_suspended    INT;
  v_lifetime     INT;
  v_trial        INT;
  v_manual       INT;
  v_today_rev    NUMERIC(10,2);
  v_month_rev    NUMERIC(10,2);
  v_total_rev    NUMERIC(10,2);
  v_exp_today    INT;
  v_exp_soon     INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM user_memberships;
  SELECT COUNT(*) INTO v_active FROM user_memberships WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW());
  SELECT COUNT(*) INTO v_expired FROM user_memberships WHERE status IN ('active','expired') AND expires_at IS NOT NULL AND expires_at <= NOW();
  SELECT COUNT(*) INTO v_suspended FROM user_memberships WHERE status = 'suspended';
  SELECT COUNT(*) INTO v_lifetime FROM user_memberships WHERE is_lifetime = true AND status = 'active';
  SELECT COUNT(*) INTO v_trial FROM user_memberships WHERE grant_type = 'trial' AND status = 'active';
  SELECT COUNT(*) INTO v_manual FROM user_memberships WHERE grant_type IN ('manual','lifetime','custom') AND status = 'active';

  SELECT COALESCE(SUM(amount_inr), 0) INTO v_today_rev
  FROM membership_transactions
  WHERE status = 'completed' AND created_at::date = NOW()::date;

  SELECT COALESCE(SUM(amount_inr), 0) INTO v_month_rev
  FROM membership_transactions
  WHERE status = 'completed' AND created_at >= date_trunc('month', NOW());

  SELECT COALESCE(SUM(amount_inr), 0) INTO v_total_rev
  FROM membership_transactions WHERE status = 'completed';

  SELECT COUNT(*) INTO v_exp_today
  FROM user_memberships
  WHERE status = 'active' AND expires_at::date = NOW()::date;

  SELECT COUNT(*) INTO v_exp_soon
  FROM user_memberships
  WHERE status = 'active' AND expires_at >= NOW() AND expires_at <= NOW() + '7 days'::INTERVAL;

  RETURN jsonb_build_object(
    'total', v_total,
    'active', v_active,
    'expired', v_expired,
    'suspended', v_suspended,
    'lifetime', v_lifetime,
    'trial', v_trial,
    'manual', v_manual,
    'today_revenue', v_today_rev,
    'monthly_revenue', v_month_rev,
    'total_revenue', v_total_rev,
    'expiring_today', v_exp_today,
    'expiring_soon', v_exp_soon
  );
END;
$$;

-- 5.7: Check membership status (secure — for frontend validation)
CREATE OR REPLACE FUNCTION check_membership_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership user_memberships%ROWTYPE;
  v_plan       membership_plans%ROWTYPE;
  v_days_left  INT;
BEGIN
  SELECT * INTO v_membership
  FROM user_memberships
  WHERE user_id = p_user_id
  ORDER BY expires_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('isPremium', false, 'status', 'none', 'planName', 'Free');
  END IF;

  -- Check if lifetime
  IF v_membership.is_lifetime AND v_membership.status = 'active' THEN
    SELECT name INTO v_plan FROM membership_plans WHERE id = v_membership.plan_id;
    RETURN jsonb_build_object(
      'isPremium', true,
      'status', 'active',
      'planName', COALESCE(v_plan.name, 'Lifetime'),
      'expiresAt', null,
      'daysLeft', null,
      'isLifetime', true,
      'role', v_membership.role
    );
  END IF;

  -- Check if expired
  IF v_membership.expires_at IS NOT NULL AND v_membership.expires_at <= NOW() THEN
    IF v_membership.status != 'expired' THEN
      UPDATE user_memberships SET status = 'expired', updated_at = NOW() WHERE id = v_membership.id;
      INSERT INTO membership_history (membership_id, user_id, action, old_status, new_status, old_expires_at, new_expires_at)
      VALUES (v_membership.id, p_user_id, 'expired', v_membership.status, 'expired', v_membership.expires_at, v_membership.expires_at);
    END IF;
    RETURN jsonb_build_object(
      'isPremium', false,
      'status', 'expired',
      'planName', 'Free',
      'expiresAt', v_membership.expires_at,
      'daysLeft', 0,
      'isLifetime', false,
      'role', v_membership.role
    );
  END IF;

  -- Active membership
  IF v_membership.status = 'active' THEN
    SELECT name INTO v_plan FROM membership_plans WHERE id = v_membership.plan_id;
    v_days_left := CEIL(EXTRACT(EPOCH FROM (v_membership.expires_at - NOW())) / 86400);

    -- Create "expiring soon" notification if within 3 days
    IF v_days_left <= 3 AND v_days_left > 0 THEN
      INSERT INTO membership_notifications (user_id, type, title, message, metadata)
      VALUES (p_user_id, 'expiring_soon', 'Membership Expiring Soon',
        'Your membership expires in ' || v_days_left || ' days. Renew now to keep your premium access.',
        jsonb_build_object('days_left', v_days_left, 'expires_at', v_membership.expires_at))
      ON CONFLICT DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'isPremium', true,
      'status', 'active',
      'planName', COALESCE(v_plan.name, 'Premium'),
      'expiresAt', v_membership.expires_at,
      'daysLeft', v_days_left,
      'isLifetime', false,
      'role', v_membership.role
    );
  END IF;

  -- Suspended, cancelled, etc.
  SELECT name INTO v_plan FROM membership_plans WHERE id = v_membership.plan_id;
  RETURN jsonb_build_object(
    'isPremium', false,
    'status', v_membership.status,
    'planName', COALESCE(v_plan.name, '—'),
    'expiresAt', v_membership.expires_at,
    'daysLeft', 0,
    'isLifetime', false,
    'role', v_membership.role
  );
END;
$$;

-- ─── 6. TRIGGERS ──────────────────────────────────────────────────

-- 6.1: Auto-update updated_at on user_memberships
CREATE OR REPLACE FUNCTION trg_update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_um_updated ON user_memberships;
CREATE TRIGGER trg_um_updated
  BEFORE UPDATE ON user_memberships
  FOR EACH ROW EXECUTE FUNCTION trg_update_timestamp();

DROP TRIGGER IF EXISTS trg_mt_updated ON membership_transactions;
CREATE TRIGGER trg_mt_updated
  BEFORE UPDATE ON membership_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_update_timestamp();

-- 6.2: Auto-insert membership_history on user_memberships INSERT
CREATE OR REPLACE FUNCTION trg_membership_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO membership_history (membership_id, user_id, action, new_status, new_expires_at, changed_by, metadata)
  VALUES (NEW.id, NEW.user_id, 'created', NEW.status, NEW.expires_at, NEW.user_id,
    jsonb_build_object('plan_id', NEW.plan_id, 'grant_type', NEW.grant_type));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_um_created ON user_memberships;
CREATE TRIGGER trg_um_created
  AFTER INSERT ON user_memberships
  FOR EACH ROW EXECUTE FUNCTION trg_membership_created();

-- 6.3: Auto-insert activity log on membership_transactions INSERT
CREATE OR REPLACE FUNCTION trg_tx_activity_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO membership_activity_logs (user_id, activity_type, metadata)
  VALUES (NEW.user_id, 'purchase', jsonb_build_object('payment_id', NEW.provider_tx_id, 'amount', NEW.amount_inr));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mt_activity ON membership_transactions;
CREATE TRIGGER trg_mt_activity
  AFTER INSERT ON membership_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_tx_activity_log();

-- ─── 7. GRANT PERMISSIONS ─────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON user_memberships TO authenticated;
GRANT SELECT ON membership_transactions TO authenticated;
GRANT SELECT ON membership_history TO authenticated;
GRANT SELECT ON membership_audit_logs TO authenticated;
GRANT SELECT ON membership_manual_grants TO authenticated;
GRANT SELECT ON membership_plan_history TO authenticated;
GRANT SELECT, INSERT ON membership_activity_logs TO authenticated;
GRANT SELECT, UPDATE ON membership_notifications TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES TO authenticated;

-- ─── 8. INITIAL DATA ──────────────────────────────────────────────

-- Ensure default plans exist with proper columns
INSERT INTO membership_plans (slug, name, price_inr, billing_cycle, is_active, sort_order, description)
VALUES
  ('1day',    '1 Day Trial',     9,   '1day',    true, 1,  '24-hour trial access'),
  ('15days',  '15 Days Plan',    49,   '15days',  true, 2,  '15-day premium access'),
  ('30days',  '30 Days Plan',    99,   '30days',  true, 3,  '30-day premium access'),
  ('90days',  '90 Days Plan',   249,   '90days',  true, 4,  '90-day premium access'),
  ('180days', '180 Days Plan',  449,   '180days', true, 5,  '180-day premium access'),
  ('365days', '365 Days Plan',  799,   '365days', true, 6,  '365-day premium access'),
  ('lifetime','Lifetime Plan', 1499,   'lifetime',true, 7,  'Lifetime premium access')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_inr = EXCLUDED.price_inr,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
