-- ═══════════════════════════════════════════════════════════════════════
-- community-links-migration.sql
-- Fixes the Community Links "Save" errors (UUID errors, schema mismatch,
-- schema-cache errors) and connects the official Instagram + Telegram links.
--
-- ROOT CAUSES FIXED:
--   1. Frontend generated non-UUID ids ('wa-community', 'link_'+Date.now())
--      for a `uuid` primary key column -> "invalid input syntax for type uuid".
--   2. Section-visibility toggle wrote a sentinel row
--      (id = '__section_hidden__') into the SAME uuid-PK table -> same UUID
--      error. Replaced with a real boolean column on website_settings.
--   3. trackCommunityClick() called an RPC function
--      (increment_community_clicks) that never existed in the DB ->
--      PGRST202 "Could not find the function ... in the schema cache".
--
-- Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════

-- 1. community_links table — ensure it exists with the correct shape.
--    (Table already existed in prod; these are no-op if columns are present.)
CREATE TABLE IF NOT EXISTS public.community_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text DEFAULT '',
  icon        text DEFAULT '🔗',
  color       text DEFAULT '#3d8ef8',
  url         text NOT NULL,
  is_primary  boolean DEFAULT false,
  enabled     boolean DEFAULT true,
  sort_order  integer DEFAULT 0,
  click_count integer DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.community_links ADD COLUMN IF NOT EXISTS click_count integer DEFAULT 0;
ALTER TABLE public.community_links ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();
ALTER TABLE public.community_links ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- 2. RLS — public can read, only admins can write.
ALTER TABLE public.community_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_links_public_read" ON public.community_links;
CREATE POLICY "community_links_public_read"
  ON public.community_links FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "community_links_admin_write" ON public.community_links;
CREATE POLICY "community_links_admin_write"
  ON public.community_links FOR ALL
  USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));

-- 3. Click-tracking RPC — this was missing entirely, causing a schema-cache
--    error every time a visitor clicked a community link on the homepage.
CREATE OR REPLACE FUNCTION public.increment_community_clicks(link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.community_links
  SET click_count = COALESCE(click_count, 0) + 1
  WHERE id = link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_community_clicks(uuid) TO anon, authenticated;

-- 4. website_settings — real boolean column for "hide community section",
--    replacing the sentinel-row hack.
ALTER TABLE public.website_settings ADD COLUMN IF NOT EXISTS community_hub_enabled boolean DEFAULT true;

-- 5. Seed the two official social links (Instagram + Telegram).
--    Fixed UUIDs match the frontend's COMMUNITY_DEFAULTS fallback constants,
--    so admin panel and homepage stay in sync even before first manual save.
INSERT INTO public.community_links (id, title, description, icon, color, url, is_primary, enabled, sort_order)
VALUES
  ('a1b2c3d4-0001-4000-8000-000000000001', 'Studyria Official', 'Reels & stories on Instagram',
   '📸', '#e1306c', 'https://www.instagram.com/studyria.official/', true, true, 1),
  ('a1b2c3d4-0002-4000-8000-000000000002', 'Studyria Official', 'Daily updates on Telegram',
   '✈️', '#0088cc', 'https://t.me/studyria', true, true, 2)
ON CONFLICT (id) DO UPDATE SET
  title       = EXCLUDED.title,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  color       = EXCLUDED.color,
  url         = EXCLUDED.url,
  is_primary  = EXCLUDED.is_primary,
  enabled     = EXCLUDED.enabled,
  sort_order  = EXCLUDED.sort_order,
  updated_at  = now();

-- 6. Remove any leftover non-UUID rows / sentinel rows from earlier broken
--    saves, if present (safe no-op if none exist — id is uuid so these
--    could never have actually been inserted, but included for safety in
--    case of manual dashboard edits).
DELETE FROM public.community_links
WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 7. Refresh PostgREST's schema cache so the new function/columns are
--    visible immediately (Supabase normally does this automatically on
--    DDL, but this forces it).
NOTIFY pgrst, 'reload schema';
