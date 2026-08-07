-- ═══════════════════════════════════════════════════════════════════
-- Studyria PWA V3.2 — Database Tables Migration
-- ═══════════════════════════════════════════════════════════════════
-- Creates tables for:
--   1. pwa_release_notes — AI auto release notes
--   2. pwa_notifications — Notification V2.0 with rich media
--   3. pwa_config — Remote configuration & feature flags
-- ═══════════════════════════════════════════════════════════════════

-- 1. Release Notes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pwa_release_notes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version     TEXT NOT NULL,
  release_date DATE DEFAULT CURRENT_DATE,
  added       JSONB DEFAULT '[]'::jsonb,
  improved    JSONB DEFAULT '[]'::jsonb,
  fixed       JSONB DEFAULT '[]'::jsonb,
  security    JSONB DEFAULT '[]'::jsonb,
  changelog   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE pwa_release_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read release notes" ON pwa_release_notes FOR SELECT USING (true);
CREATE POLICY "Admins can insert release notes" ON pwa_release_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);
CREATE POLICY "Admins can update release notes" ON pwa_release_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);
CREATE POLICY "Admins can delete release notes" ON pwa_release_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);

-- 2. Notifications ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pwa_notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID,  -- null = broadcast to all
  title         TEXT NOT NULL,
  body          TEXT,
  image         TEXT,
  badge         TEXT,
  icon          TEXT,
  actions       JSONB DEFAULT '[]'::jsonb,
  deep_link     TEXT,
  topic         TEXT,
  scheduled_for TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE pwa_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own notifications" ON pwa_notifications FOR SELECT USING (
  user_id IS NULL OR user_id = auth.uid()
);
CREATE POLICY "Admins can insert notifications" ON pwa_notifications FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);
CREATE POLICY "Admins can update notifications" ON pwa_notifications FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);
CREATE POLICY "Users can update their own notifications" ON pwa_notifications FOR UPDATE USING (
  user_id = auth.uid()
);

-- 3. Remote Config ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pwa_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE pwa_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read config" ON pwa_config FOR SELECT USING (true);
CREATE POLICY "Admins can write config" ON pwa_config FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);
CREATE POLICY "Admins can update config" ON pwa_config FOR UPDATE USING (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);

-- Seed default config
INSERT INTO pwa_config (key, value, description) VALUES
  ('feature_flags', '{"download_manager":true,"offline_reading":true,"predictive_loading":true,"notification_v2":true,"route_prefetch":true,"smart_cache":true}'::jsonb, 'PWA feature flags'),
  ('maintenance', '{"enabled":false,"message":""}'::jsonb, 'Maintenance mode settings'),
  ('splash', '{"duration":2200,"showOnLaunch":true}'::jsonb, 'Splash screen configuration'),
  ('update_rules', '{"autoUpdate":true,"forceMin":null,"silentUpdate":true}'::jsonb, 'Update rules')
ON CONFLICT (key) DO NOTHING;

-- 4. Download Queue ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pwa_download_queue (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid(),
  pdf_id      TEXT NOT NULL,
  title       TEXT,
  status      TEXT DEFAULT 'queued',  -- queued, downloading, paused, completed, failed
  progress    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pwa_download_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own downloads" ON pwa_download_queue FOR ALL USING (user_id = auth.uid());

-- 5. Analytics Events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pwa_analytics (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event       TEXT NOT NULL,  -- install, update, notif_open, offline_session
  user_id     UUID,
  device_info JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pwa_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert analytics" ON pwa_analytics FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can read analytics" ON pwa_analytics FOR SELECT USING (
  EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pwa_release_notes_version ON pwa_release_notes (version);
CREATE INDEX IF NOT EXISTS idx_pwa_notifications_user ON pwa_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_pwa_notifications_topic ON pwa_notifications (topic);
CREATE INDEX IF NOT EXISTS idx_pwa_download_queue_user ON pwa_download_queue (user_id);
CREATE INDEX IF NOT EXISTS idx_pwa_analytics_event ON pwa_analytics (event);

-- ═══════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ═══════════════════════════════════════════════════════════════════
