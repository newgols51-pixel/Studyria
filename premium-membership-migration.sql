-- ════════════════════════════════════════════════════════════════════════════
-- STUDYRIA — Premium Membership Schema Migration
-- Branch: feat/premium-membership
--
-- PASTE INTO: Supabase Dashboard → SQL Editor → New Query → Paste → Run
--
-- Creates: memberships table + profiles columns + RLS policies + indexes
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: Add premium columns to profiles ──────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_premium       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_plan     text,
  ADD COLUMN IF NOT EXISTS premium_expiry   timestamptz,
  ADD COLUMN IF NOT EXISTS premium_since    timestamptz;

-- ── STEP 2: Create memberships table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memberships (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  plan           text        NOT NULL,         -- '15d' | '1m' | '3m' | '6m'
  amount_inr     integer     NOT NULL,          -- 49 | 99 | 249 | 449
  days           integer     NOT NULL,          -- 15 | 30 | 90 | 180
  payment_id     text        NOT NULL UNIQUE,   -- razorpay_payment_id
  status         text        NOT NULL DEFAULT 'active',  -- 'active' | 'expired'
  starts_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── STEP 3: Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS memberships_user_id_idx    ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_email_idx      ON public.memberships (email);
CREATE INDEX IF NOT EXISTS memberships_expires_at_idx ON public.memberships (expires_at);
CREATE INDEX IF NOT EXISTS memberships_status_idx     ON public.memberships (status);
CREATE INDEX IF NOT EXISTS profiles_is_premium_idx    ON public.profiles    (is_premium);

-- ── STEP 4: Enable RLS ────────────────────────────────────────────────────
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Users can read their own memberships
CREATE POLICY IF NOT EXISTS "memberships_select_own"
  ON public.memberships FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own memberships (payment handler runs client-side)
CREATE POLICY IF NOT EXISTS "memberships_insert_own"
  ON public.memberships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin users can read all (matches existing admin_users table pattern)
CREATE POLICY IF NOT EXISTS "memberships_select_admin"
  ON public.memberships FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

-- ── STEP 5: Auto-update updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_membership_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memberships_updated_at ON public.memberships;
CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_membership_updated_at();

-- ── STEP 6: Function to sync profiles.is_premium after membership insert ──
-- Called by the application after successful payment insert.
-- Can also be wired as a DB trigger for double-safety.
CREATE OR REPLACE FUNCTION public.sync_premium_status(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_expiry   timestamptz;
  v_plan     text;
BEGIN
  -- Find the latest active membership
  SELECT expires_at, plan
    INTO v_expiry, v_plan
    FROM public.memberships
   WHERE user_id = p_user_id
     AND status  = 'active'
     AND expires_at > now()
   ORDER BY expires_at DESC
   LIMIT 1;

  IF FOUND AND v_expiry > now() THEN
    UPDATE public.profiles SET
      is_premium     = true,
      premium_plan   = v_plan,
      premium_expiry = v_expiry
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles SET
      is_premium     = false,
      premium_plan   = null,
      premium_expiry = null
    WHERE id = p_user_id;
  END IF;
END;
$$;

-- ── STEP 7: Auto DB trigger on memberships insert ─────────────────────────
CREATE OR REPLACE FUNCTION public.auto_sync_premium_on_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.sync_premium_status(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_sync_premium ON public.memberships;
CREATE TRIGGER auto_sync_premium
  AFTER INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.auto_sync_premium_on_membership();

-- ── STEP 8: Verification queries ──────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('is_premium','premium_plan','premium_expiry','premium_since')
ORDER BY column_name;

SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename='memberships';

SELECT policyname, cmd FROM pg_policies WHERE tablename='memberships';
