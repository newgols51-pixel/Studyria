-- ════════════════════════════════════════════════════════════════════
-- STUDYRIA CLOUD — Storage & Content Management Migration
-- Run this in Supabase SQL Editor. 100% ADDITIVE.
-- Does NOT touch existing PDFs, purchases, users, orders, buckets,
-- storage policies or any existing data.
--
-- Creates:
--   cloud_files            — real file registry (upload/trash/restore state)
--   cloud_audit_log        — append-only admin action log
--   cloud_settings         — configurable quota / thresholds / limits
--   cloud_usage_snapshots  — daily real-usage snapshots (growth reports)
--
-- Admin authorization is enforced SERVER-SIDE by RLS: only Supabase
-- users whose email exists in public.admin_users may read/write.
-- ════════════════════════════════════════════════════════════════════

-- ── Helper: is the caller a Studyria admin? (server-side check) ─────
CREATE OR REPLACE FUNCTION public.sc_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ── 1. File registry ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cloud_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket         text NOT NULL,
  storage_path   text NOT NULL,
  filename       text NOT NULL,
  category       text NOT NULL DEFAULT 'other',
  mime           text NOT NULL DEFAULT '',
  bytes          bigint NOT NULL DEFAULT 0,
  sha256         text,
  status         text NOT NULL DEFAULT 'active',
  original_path  text,
  deleted_by     text,
  deleted_at    timestamptz,
  restored_at    timestamptz,
  content_ref    text,
  uploaded_by    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, storage_path)
);
CREATE INDEX IF NOT EXISTS idx_cloud_files_status ON public.cloud_files(status);
CREATE INDEX IF NOT EXISTS idx_cloud_files_sha   ON public.cloud_files(sha256);
CREATE INDEX IF NOT EXISTS idx_cloud_files_cat   ON public.cloud_files(category);

ALTER TABLE public.cloud_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc admin read files"   ON public.cloud_files;
DROP POLICY IF EXISTS "sc admin write files"  ON public.cloud_files;
CREATE POLICY "sc admin read files"  ON public.cloud_files FOR SELECT TO authenticated USING (public.sc_is_admin());
CREATE POLICY "sc admin write files" ON public.cloud_files FOR ALL    TO authenticated
  USING (public.sc_is_admin()) WITH CHECK (public.sc_is_admin());

-- ── 2. Audit log (append-only) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cloud_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL DEFAULT '',
  action      text NOT NULL,
  bucket      text,
  target      text,
  result      text NOT NULL DEFAULT 'ok',
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cloud_audit_created ON public.cloud_audit_log(created_at DESC);

ALTER TABLE public.cloud_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc admin read audit"  ON public.cloud_audit_log;
DROP POLICY IF EXISTS "sc admin write audit" ON public.cloud_audit_log;
CREATE POLICY "sc admin read audit"  ON public.cloud_audit_log FOR SELECT TO authenticated USING (public.sc_is_admin());
CREATE POLICY "sc admin write audit" ON public.cloud_audit_log FOR INSERT TO authenticated WITH CHECK (public.sc_is_admin());

-- ── 3. Configurable settings (quota, thresholds, limits, tiers) ─────
CREATE TABLE IF NOT EXISTS public.cloud_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cloud_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc admin read settings"  ON public.cloud_settings;
DROP POLICY IF EXISTS "sc admin write settings" ON public.cloud_settings;
CREATE POLICY "sc admin read settings"  ON public.cloud_settings FOR SELECT TO authenticated USING (public.sc_is_admin());
CREATE POLICY "sc admin write settings" ON public.cloud_settings FOR ALL    TO authenticated
  USING (public.sc_is_admin()) WITH CHECK (public.sc_is_admin());

INSERT INTO public.cloud_settings (key, value, updated_by) VALUES
  ('quota_bytes', '5368709120', 'migration'),
  ('warn_thresholds', '{"high":70,"almost_full":85,"critical":95,"full":100}', 'migration'),
  ('max_upload_mb', '500', 'migration'),
  ('allowed_types', '["application/pdf","image/jpeg","image/png","image/webp"]', 'migration'),
  ('trash_retention_days', '30', 'migration'),
  ('signed_url_expiry', '3600', 'migration'),
  ('storage_tiers', '[{"gb":5,"label":"Free Starter","active":true},{"gb":25,"label":"Creator","active":false},{"gb":100,"label":"Pro","active":false},{"gb":500,"label":"Business","active":false}]', 'migration')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Daily usage snapshots (real growth reports) ──────────────────
CREATE TABLE IF NOT EXISTS public.cloud_usage_snapshots (
  snapshot_date date PRIMARY KEY,
  total_bytes   bigint NOT NULL,
  per_bucket    jsonb,
  object_count  integer NOT NULL DEFAULT 0,
  taken_by      text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cloud_usage_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sc admin read snapshots"  ON public.cloud_usage_snapshots;
DROP POLICY IF EXISTS "sc admin write snapshots" ON public.cloud_usage_snapshots;
CREATE POLICY "sc admin read snapshots"  ON public.cloud_usage_snapshots FOR SELECT TO authenticated USING (public.sc_is_admin());
CREATE POLICY "sc admin write snapshots" ON public.cloud_usage_snapshots FOR ALL    TO authenticated
  USING (public.sc_is_admin()) WITH CHECK (public.sc_is_admin());

-- VERIFICATION (safe, read-only): SELECT key, value FROM public.cloud_settings ORDER BY key;

-- ── 5. 'cloud-assets' bucket for Brainlab / Career Hub / Current
--    Affairs / website / misc managed assets. NEW bucket only —
--    existing buckets and their policies are untouched. ────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('cloud-assets', 'cloud-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sc public read cloud-assets"  ON storage.objects;
DROP POLICY IF EXISTS "sc admin write cloud-assets" ON storage.objects;
CREATE POLICY "sc public read cloud-assets" ON storage.objects FOR SELECT
  USING (bucket_id = 'cloud-assets');
CREATE POLICY "sc admin write cloud-assets" ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'cloud-assets' AND public.sc_is_admin())
  WITH CHECK (bucket_id = 'cloud-assets' AND public.sc_is_admin());
