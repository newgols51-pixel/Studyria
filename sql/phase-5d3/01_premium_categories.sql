-- ══════════════════════════════════════════════════════════════════════
-- FILE    : sql/phase-5d3/01_premium_categories.sql
-- PROJECT : Studyria — Phase 1: Premium Handwritten Notes Access
-- PURPOSE : Create premium_categories table that controls which
--           categories are unlocked for Premium Members.
-- SAFETY  : Does NOT modify existing tables. Idempotent.
-- RUN     : Supabase SQL Editor (service_role)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.premium_categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name   text        NOT NULL UNIQUE,
  is_enabled      boolean     NOT NULL DEFAULT false,
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.premium_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "premium_categories_read" ON public.premium_categories;
CREATE POLICY "premium_categories_read"
  ON public.premium_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "premium_categories_admin_write" ON public.premium_categories;
CREATE POLICY "premium_categories_admin_write"
  ON public.premium_categories FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Phase 1: Enable ONLY "Premium Handwritten Notes"
INSERT INTO public.premium_categories (category_name, is_enabled, sort_order)
VALUES ('Premium Handwritten Notes', true, 1)
ON CONFLICT (category_name) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.set_premium_categories_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_premium_categories_updated ON public.premium_categories;
CREATE TRIGGER trg_premium_categories_updated
  BEFORE UPDATE ON public.premium_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_premium_categories_updated_at();
