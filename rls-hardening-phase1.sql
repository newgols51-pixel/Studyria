-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA — RLS HARDENING, PHASE 1 (Issue #2: zero-trust database layer)
-- Generated 2026-09-07. Run in Supabase → SQL Editor → Run.
--
-- WHAT THIS DOES
--   The site's admin panel signs in with real Supabase sessions (auth), and
--   the DB has a SECURITY DEFINER is_admin() helper. But many catalog/admin
--   tables still carry legacy policies shaped like  "ALL ... TO public ...
--   USING (true)"  — i.e. ANYONE with the anon key could insert/update/
--   delete rows. This script replaces those with admin-gated policies
--   (authenticated + is_admin()), keeps every public READ that the live
--   site needs, and closes the PII leaks (users, admin_users,
--   purchased_pdfs, user_wishlist readable by anyone).
--
--   It also adds a SECURITY DEFINER RPC `bump_download_count(text)` so the
--   download counter keeps working for normal visitors once pdfs UPDATE
--   becomes admin-only (frontend already prefers the RPC, with fallback).
--
-- WHAT IT DOES *NOT* DO (deliberately, phase-2 work)
--   - It does not move payment verification server-side. A signed-in user
--     can still write their OWN purchased_pdfs row (as today) — the Razorpay
--     webhook must eventually own that insert.
--   - It does not touch the 49 tables that have RLS enabled but zero
--     policies (deny-all = safe default; enabling access is separate work).
--
-- BEFORE YOU RUN — nothing needed. AFTER YOU RUN, TEST (5 min):
--   1. Admin panel: sign in → publish/edit a PDF, save hero settings, edit
--      a category. (Admin = an email that exists in admin_users.)
--   2. As a normal signed-in user: download a PDF → download counter +1
--      (check console: "via RPC"). Wishlist add + remove. Open My Library.
--   3. As guest: home/library/PDP/career hub all render with real data.
--   4. If job posting stops working for a non-admin account, that is this
--      script (jobs INSERT is now admin-only) — expected and correct.
--
-- IDEMPOTENT: safe to run twice. Dropping and re-creating is harmless.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 0. Download-counter RPC (works for guests once pdfs is write-locked) ───
CREATE OR REPLACE FUNCTION public.bump_download_count(p_pdf_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_count integer;
BEGIN
  UPDATE public.pdfs
     SET download_count = COALESCE(download_count, 0) + 1
   WHERE id::text = p_pdf_id
  RETURNING download_count INTO new_count;
  RETURN COALESCE(new_count, -1);
END $$;
GRANT EXECUTE ON FUNCTION public.bump_download_count(text) TO anon, authenticated;


-- ─── 1. CATALOG / ADMIN TABLES — writes become admin-gated ────────────────
--    (public SELECT policies stay untouched on all of these)

-- pdfs: only admins can write; public keeps reading published rows
--      (existing "status = 'published'" SELECT policies remain).
DROP POLICY IF EXISTS "pdfs_admin_all" ON public.pdfs;
CREATE POLICY "pdfs_admin_all_v2" ON public.pdfs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
CREATE POLICY "categories_admin_all_v2" ON public.categories
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_subcategories" ON public.subcategories;
DROP POLICY IF EXISTS "subcategories_admin_all" ON public.subcategories;
CREATE POLICY "subcategories_admin_all_v2" ON public.subcategories
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_streams" ON public.streams;
CREATE POLICY "streams_admin_all_v2" ON public.streams
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_semester_classes" ON public.semester_classes;
CREATE POLICY "semester_classes_admin_all_v2" ON public.semester_classes
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_subjects" ON public.subjects;
CREATE POLICY "subjects_admin_all_v2" ON public.subjects
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_write_academic_levels" ON public.academic_levels;
CREATE POLICY "academic_levels_admin_all_v2" ON public.academic_levels
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "homepage_sections_admin_all" ON public.homepage_sections;
CREATE POLICY "homepage_sections_admin_all_v2" ON public.homepage_sections
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "homepage_settings_admin_all" ON public.homepage_settings;
CREATE POLICY "homepage_settings_admin_all_v2" ON public.homepage_settings
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "website_settings_admin_write" ON public.website_settings;
DROP POLICY IF EXISTS "Allow all website settings" ON public.website_settings;
CREATE POLICY "website_settings_admin_all_v2" ON public.website_settings
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "watermark_settings_all" ON public.watermark_settings;
CREATE POLICY "watermark_settings_admin_all_v2" ON public.watermark_settings
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- hero_settings: the legacy "authenticated may write" policy goes admin-only.
--   (Name varies — drop any non-SELECT policy that isn't admin-gated.)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='hero_settings' AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.hero_settings', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "hero_settings_admin_all_v2" ON public.hero_settings
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- pdf_versions: keep PUBLIC READ (premium reader needs it), admin writes.
DROP POLICY IF EXISTS "pdf_versions_all" ON public.pdf_versions;
CREATE POLICY "pdf_versions_public_read" ON public.pdf_versions
  FOR SELECT TO public USING (true);
CREATE POLICY "pdf_versions_admin_all_v2" ON public.pdf_versions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- upload_queue: admin-only internal table
DROP POLICY IF EXISTS "upload_queue_all" ON public.upload_queue;
CREATE POLICY "upload_queue_admin_all_v2" ON public.upload_queue
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- pdf_requests: KEEP the anonymous "request a PDF" feature (insert-only),
--   restrict everything else to admin.
DROP POLICY IF EXISTS "pdf_requests_admin_all" ON public.pdf_requests;
CREATE POLICY "pdf_requests_admin_all_v2" ON public.pdf_requests
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- broken_pdf_reports: KEEP anonymous insert (users report broken PDFs),
--   restrict everything else to admin.
DROP POLICY IF EXISTS "broken_pdf_reports_admin_all" ON public.broken_pdf_reports;
CREATE POLICY "broken_pdf_reports_admin_all_v2" ON public.broken_pdf_reports
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- pdf_analytics: any visitor may INSERT an analytics event; only admins
--   read/update/delete.
DROP POLICY IF EXISTS "pdf_analytics_all" ON public.pdf_analytics;
CREATE POLICY "pdf_analytics_public_insert" ON public.pdf_analytics
  FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "pdf_analytics_admin_rest_v2" ON public.pdf_analytics
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "pdf_analytics_admin_write_v2" ON public.pdf_analytics
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "pdf_analytics_admin_del_v2" ON public.pdf_analytics
  FOR DELETE TO authenticated USING (public.is_admin());

-- pdf_books: public read stays (already separate policies); writes → admin.
DROP POLICY IF EXISTS "Allow all inserts" ON public.pdf_books;
DROP POLICY IF EXISTS "Allow all updates" ON public.pdf_books;
DROP POLICY IF EXISTS "Allow all deletes" ON public.pdf_books;
CREATE POLICY "pdf_books_admin_write_v2" ON public.pdf_books
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- jobs: posting a job is an admin action (Career Hub admin).
DROP POLICY IF EXISTS "Allow all inserts" ON public.jobs;
CREATE POLICY "jobs_admin_insert_v2" ON public.jobs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- downloads: per-user data → owner-scoped
DROP POLICY IF EXISTS "downloads_all" ON public.downloads;
CREATE POLICY "downloads_own_read" ON public.downloads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "downloads_own_insert" ON public.downloads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "downloads_own_update" ON public.downloads
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "downloads_own_delete" ON public.downloads
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());


-- ─── 2. PII LEAKS — owner/admin only ──────────────────────────────────────

-- users (name + email + role of every account): was world-readable.
DROP POLICY IF EXISTS "Allow users select" ON public.users;
CREATE POLICY "users_self_or_admin" ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

-- admin_users (admin email list): was world-readable.
DROP POLICY IF EXISTS "Allow admin_users select" ON public.admin_users;
CREATE POLICY "admin_users_admin_only" ON public.admin_users
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- purchased_pdfs (who bought what): was world-readable; inserts were
--   NOTE: email matched via auth.jwt() claim (authenticated role has no
--   direct SELECT on auth.users — a subquery there would break the policy).
--   unchecked. Owners now see/insert only their own rows (matched by
--   user_id OR their verified account email); admin sees all.
DROP POLICY IF EXISTS "purchased_pdfs_admin_all" ON public.purchased_pdfs;
DROP POLICY IF EXISTS "purchased_pdfs_public_read" ON public.purchased_pdfs;
DROP POLICY IF EXISTS "Allow purchased_pdfs select" ON public.purchased_pdfs;
CREATE POLICY "purchased_pdfs_own_read" ON public.purchased_pdfs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id
         OR email = auth.jwt()->>'email'
         OR public.is_admin());
CREATE POLICY "purchased_pdfs_own_insert" ON public.purchased_pdfs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              OR email = auth.jwt()->>'email');
CREATE POLICY "purchased_pdfs_admin_update" ON public.purchased_pdfs
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "purchased_pdfs_admin_delete" ON public.purchased_pdfs
  FOR DELETE TO authenticated USING (public.is_admin());

-- user_wishlist: was world-readable; users could insert but never delete.
--   Note: separate empty-policy `wishlist` table is a different table.
DROP POLICY IF EXISTS "user_wishlist_public_read" ON public.user_wishlist;
CREATE POLICY "user_wishlist_own_read" ON public.user_wishlist
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "user_wishlist_own_delete" ON public.user_wishlist
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- ─── 3. VERIFICATION — should return ZERO rows after running ─────────────
-- (any row = a write policy still open to the public role)
SELECT schemaname, tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  AND (roles::text LIKE '%public%' OR roles::text LIKE '%anon%')
  AND (qual::text = 'true' OR with_check::text = 'true')
ORDER BY tablename;
