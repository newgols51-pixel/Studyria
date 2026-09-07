-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA — RLS HARDENING, PHASE 2 (follow-up to phase 1)
-- Generated 2026-09-07, after reviewing the phase-1 verification output.
--
-- GOOD NEWS CONFIRMED: phase 1 worked — all the old "ALL ... USING(true)"
-- catalog policies (pdfs, categories, streams, hero_settings, ...) are gone.
-- This phase closes the 5 gaps that remained in the verification list:
--   1. hero_content          — any signed-in user could write (admin only now)
--   2. website_settings       — leftover "admin_write" policy (any signed-in
--                               user could write; phase-1's admin policy covers
--                               real admins, public read policy is separate)
--   3. push_notifications     — any signed-in user could read/write ALL rows
--                               (only the admin push panel + CampusAdmin use it)
--   4. whatsapp_broadcasts    — same, table not even used by the frontend
--   5. purchased_pdfs         — "purchased_pdfs_insert" let ANONYMOUS visitors
--                               insert fake purchase rows. Dropped; phase-1's
--                               owner-checked insert policy covers the real flow.
--
-- Also dedupes harmless triple-insert policies on broken_pdf_reports /
-- pdf_requests (identical permissions; keeping one each).
--
-- LEFT ALONE ON PURPOSE (verified safe):
--   - membership_* / user_memberships — gated by is_membership_admin(), which
--     reads the JWT claim (app_metadata.role), not a table. Spoofing requires
--     editing your own Supabase app_metadata, which clients cannot do. Fine.
--   - reading_sessions, user_preferences, user_profile_extras, pdf_reviews,
--     user_wishlist, creator_withdrawals — properly owner-scoped (auth.uid()).
--   - broken_pdf_reports / pdf_requests / pdf_analytics anon INSERTs — real
--     product features (report a broken PDF, request a PDF, log an event).
--
-- AFTER RUNNING: the verification SELECT at the bottom should return ONLY
-- the intended anonymous feature inserts — broken_pdf_reports (1 row),
-- pdf_requests (1 row), pdf_analytics (1 row). Nothing else.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. hero_content ────────────────────────────────────────────────────────
-- Public read policy ("public_read") stays; the any-authenticated write goes.
DROP POLICY IF EXISTS "admin_write" ON public.hero_content;
CREATE POLICY "hero_content_admin_all" ON public.hero_content
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 2. website_settings (leftover policy phase-1 didn't know about) ────────
-- phase-1 already created "website_settings_admin_all_v2" (is_admin) and the
-- public read policies are separate — this one is pure leftover.
DROP POLICY IF EXISTS "admin_write" ON public.website_settings;

-- ─── 3. push_notifications (admin push panel + CampusAdmin only) ───────────
DROP POLICY IF EXISTS "Allow authenticated users" ON public.push_notifications;
CREATE POLICY "push_notifications_admin_all" ON public.push_notifications
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 4. whatsapp_broadcasts (unused by the current frontend) ────────────────
DROP POLICY IF EXISTS "Allow authenticated users" ON public.whatsapp_broadcasts;
CREATE POLICY "whatsapp_broadcasts_admin_all" ON public.whatsapp_broadcasts
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 5. purchased_pdfs — close the anonymous fake-purchase insert ───────────
-- (phase-1's "purchased_pdfs_own_insert" already covers the real checkout flow)
DROP POLICY IF EXISTS "purchased_pdfs_insert" ON public.purchased_pdfs;

-- ─── 6. Harmless duplicates — keep one anon-insert policy per table ─────────
DROP POLICY IF EXISTS "Allow Broken PDF Reports" ON public.broken_pdf_reports;
DROP POLICY IF EXISTS "broken_pdf_reports_insert" ON public.broken_pdf_reports;

DROP POLICY IF EXISTS "Allow PDF Requests" ON public.pdf_requests;
DROP POLICY IF EXISTS "pdf_requests_insert" ON public.pdf_requests;


-- ─── VERIFICATION — should return EXACTLY 3 rows, all INSERT, all intended:
--   broken_pdf_reports / pdf_requests / pdf_analytics
SELECT tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  AND (roles::text LIKE '%public%' OR roles::text LIKE '%anon%')
  AND (qual::text = 'true' OR with_check::text = 'true')
  AND tablename NOT IN (
    'reading_sessions','user_preferences','user_profile_extras',
    'user_wishlist','pdf_reviews','creator_withdrawals'
  )
ORDER BY tablename;
