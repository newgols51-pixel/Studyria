-- ============================================================================
-- Studyria Creator Program 2.0 — Phase 1 schema
-- Run this in Supabase SQL editor. Safe to run multiple times (IF NOT EXISTS
-- guards everywhere). Does NOT touch the existing `creators`,
-- `creator_pdf_submissions`, `creator_ledger`, `creator_withdrawals` tables —
-- purely additive.
-- ============================================================================

-- 1. Creator KYC documents (formalizes what's currently only in Storage)
CREATE TABLE IF NOT EXISTS public.creator_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  doc_type      text NOT NULL CHECK (doc_type IN ('government_id','selfie','address_proof')),
  storage_path  text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  rejection_reason text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.creator_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "creator_documents: owner read" ON public.creator_documents
  FOR SELECT USING (creator_id IN (SELECT id FROM public.creators WHERE user_id = auth.uid()));
CREATE POLICY IF NOT EXISTS "creator_documents: owner insert" ON public.creator_documents
  FOR INSERT TO authenticated WITH CHECK (creator_id IN (SELECT id FROM public.creators WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_creator_documents_creator ON public.creator_documents(creator_id);

-- 2. Creator public store profile (Step 3 — Store Setup)
CREATE TABLE IF NOT EXISTS public.creator_stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid NOT NULL UNIQUE REFERENCES public.creators(id) ON DELETE CASCADE,
  store_name      text NOT NULL,
  store_url       text NOT NULL UNIQUE,   -- slug, e.g. /creator/store_url
  store_logo_url  text,
  store_banner_url text,
  description     text,
  specialization  text,
  categories      text[] DEFAULT '{}',
  support_email   text,
  social_links    jsonb DEFAULT '{}',     -- {instagram, facebook, youtube, whatsapp, telegram}
  follower_count  integer NOT NULL DEFAULT 0,
  is_verified     boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE public.creator_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "creator_stores: public read" ON public.creator_stores
  FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "creator_stores: owner write" ON public.creator_stores
  FOR ALL TO authenticated USING (creator_id IN (SELECT id FROM public.creators WHERE user_id = auth.uid()))
  WITH CHECK (creator_id IN (SELECT id FROM public.creators WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_creator_stores_url ON public.creator_stores(store_url);

-- 3. Follow system
CREATE TABLE IF NOT EXISTS public.creator_follows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (creator_id, user_id)
);
ALTER TABLE public.creator_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "creator_follows: public read" ON public.creator_follows
  FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "creator_follows: users manage own" ON public.creator_follows
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_creator_follows_creator ON public.creator_follows(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_follows_user ON public.creator_follows(user_id);

-- 4. Badge assignments (system-computed, e.g. Verified Creator / Top Rated / Featured)
CREATE TABLE IF NOT EXISTS public.creator_badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  badge       text NOT NULL,
  awarded_at  timestamptz DEFAULT now(),
  UNIQUE (creator_id, badge)
);
ALTER TABLE public.creator_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "creator_badges: public read" ON public.creator_badges
  FOR SELECT USING (true);

-- 5. AI Promotion Engine output (assets generated per published PDF)
CREATE TABLE IF NOT EXISTS public.promotion_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_id       uuid NOT NULL REFERENCES public.pdfs(id) ON DELETE CASCADE,
  creator_id   uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  asset_type   text NOT NULL CHECK (asset_type IN
    ('instagram_post','facebook_post','whatsapp_poster','telegram_banner','linkedin_post',
     'seo_title','seo_description','keywords','hashtags','qr_code','short_link','email_campaign','blog_draft')),
  content      text,            -- generated text/caption
  image_url    text,            -- generated poster/banner image, if applicable
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE public.promotion_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "promotion_assets: owner read" ON public.promotion_assets
  FOR SELECT USING (creator_id IN (SELECT id FROM public.creators WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_promotion_assets_pdf ON public.promotion_assets(pdf_id);

-- 6. Extend `creators` with fields the new wizard/level system needs
--    (all nullable/defaulted — zero impact on existing rows)
ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS display_name       text,
  ADD COLUMN IF NOT EXISTS country             text,
  ADD COLUMN IF NOT EXISTS state               text,
  ADD COLUMN IF NOT EXISTS languages           text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category_expertise  text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_links        jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS creator_level       text NOT NULL DEFAULT 'starter'
    CHECK (creator_level IN ('starter','rising','pro')),
  ADD COLUMN IF NOT EXISTS commission_creator_pct integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS commission_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocked          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS strike_count        integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_creators_level ON public.creators(creator_level);

-- 7. Automatic level → commission sync trigger (Starter 60/40, Rising 65/35, Pro 70/30)
CREATE OR REPLACE FUNCTION public.sync_creator_commission()
RETURNS trigger AS $$
BEGIN
  IF NEW.commission_override THEN
    RETURN NEW; -- admin has set a custom commission, don't overwrite
  END IF;
  NEW.commission_creator_pct := CASE NEW.creator_level
    WHEN 'starter' THEN 60
    WHEN 'rising'  THEN 65
    WHEN 'pro'     THEN 70
    ELSE 60
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_creator_commission ON public.creators;
CREATE TRIGGER trg_sync_creator_commission
  BEFORE INSERT OR UPDATE OF creator_level, commission_override ON public.creators
  FOR EACH ROW EXECUTE FUNCTION public.sync_creator_commission();

-- 8. Follower-count sync trigger on creator_stores
CREATE OR REPLACE FUNCTION public.sync_store_follower_count()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.creator_stores SET follower_count = follower_count + 1 WHERE creator_id = NEW.creator_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.creator_stores SET follower_count = GREATEST(0, follower_count - 1) WHERE creator_id = OLD.creator_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_store_follower_count ON public.creator_follows;
CREATE TRIGGER trg_sync_store_follower_count
  AFTER INSERT OR DELETE ON public.creator_follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_store_follower_count();
