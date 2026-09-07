-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA — RLS HARDENING, PHASE 3: PDF STORAGE LOCKDOWN (GAP A + GAP C)
-- 2026-09-07. Run AFTER phases 1 + 2. Safe to run independently of the
-- payment backend (it changes NOTHING about how checkout writes purchases).
--
-- WHAT THIS CLOSES (verified by direct exploit earlier today):
--   GAP A (CRITICAL): the storage policy "pdfs_public_read" granted public
--   SELECT on the entire private pdfs bucket — anyone with the public anon
--   key could sign and download ANY paid PDF (demonstrated: ₹39 Ultimate
--   Assam GK Guide, 1.39MB, no login, no payment). Also closes the
--   "pdfs_public_upload" hole (any signed-in user could upload into the
--   paid bucket).
--   GAP C (MEDIUM): two stale pdf_url values (an expired signed URL and an
--   old /object/public/ URL) made real buyers get HTTP 400 on download.
--
-- HOW IT WORKS:
--   The Supabase /object/sign endpoint enforces storage.objects RLS, so the
--   gate IS the policy. A SECURITY DEFINER helper (can_access_pdf_object)
--   checks, per object name: FREE published PDF → allow anyone; purchased
--   by the caller (status paid/owned) → allow; active Premium membership →
--   allow (SMCI premium bypass keeps working); admin → allow. Everything
--   else → deny. No frontend download code changes needed — the existing
--   client-side createSignedUrl calls now hit this gate per object.
--
-- AFTER RUNNING, VERIFY AT THE BOTTOM:
--   * stale absolute pdf_url rows: expect 0
--   * the two new storage policies listed
--   * the old exploit (anon signing a paid PDF) now fails — agent re-tests.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── GAP C: normalize stale pdf_url values to bare storage paths ───────────
-- 1a. Strip the query token from stored signed URLs (e.g. Hanuman Chalisa).
UPDATE pdfs
   SET pdf_url = split_part(pdf_url, '?', 1)
 WHERE pdf_url LIKE 'http%' AND pdf_url LIKE '%?%';

-- 1b. Extract the bare object path from any full storage URL variant
--     (/object/public/pdfs/<path> or /object/sign/pdfs/<path>).
UPDATE pdfs
   SET pdf_url = regexp_replace(pdf_url, '^.*/object/(?:public|sign)/pdfs/(.+)$', '\1')
 WHERE pdf_url ~ '/object/(public|sign)/pdfs/';


-- ─── SECURITY DEFINER helper: per-object access check ───────────────────────
-- Matches the object name to its pdfs row (pdf_url is now a bare path;
-- '%/' || name covers any remaining URL variants), then decides access.
CREATE OR REPLACE FUNCTION public.can_access_pdf_object(obj_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid  uuid := auth.uid();
  rec  record;
  mail text;
BEGIN
  IF obj_name IS NULL OR obj_name = '' THEN RETURN false; END IF;
  mail := auth.jwt()->>'email';

  FOR rec IN
    SELECT id, free, status FROM pdfs
     WHERE pdf_url = obj_name OR pdf_url LIKE '%/' || obj_name
  LOOP
    -- free + published → anyone (guests keep downloading free PDFs)
    IF rec.free = true AND rec.status = 'published' THEN RETURN true; END IF;

    -- anonymous visitor asking for a non-free PDF → deny
    IF uid IS NULL THEN CONTINUE; END IF;

    -- real buyer (per-user, paid or free-owned record)
    IF EXISTS (
      SELECT 1 FROM purchased_pdfs
       WHERE user_id = uid
         AND pdf_uuid::text = rec.id::text
         AND status IN ('paid','owned')
    ) THEN RETURN true; END IF;

    -- active Premium Membership (Studyria Pass bypass keeps working)
    IF EXISTS (
      SELECT 1 FROM user_memberships
       WHERE user_id = uid AND status = 'active' AND expires_at > now()
    ) THEN RETURN true; END IF;

    -- admin
    IF EXISTS (SELECT 1 FROM admin_users WHERE email = mail) THEN RETURN true; END IF;
  END LOOP;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.can_access_pdf_object(text) TO anon, authenticated;


-- ─── GAP A: replace the world-open storage policies ────────────────────────
DROP POLICY IF EXISTS "pdfs_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "pdfs_public_upload" ON storage.objects;

-- per-object gated read (signing + downloads go through this)
CREATE POLICY "pdfs_object_read_gated" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'pdfs' AND public.can_access_pdf_object(name));

-- uploads into the paid bucket: admins only
CREATE POLICY "pdfs_object_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdfs' AND public.is_admin());


-- ─── VERIFICATION ───────────────────────────────────────────────────────────
-- 1. no stale absolute URLs remain (expect 0 rows):
SELECT id, title, pdf_url FROM pdfs WHERE pdf_url LIKE 'http%';

-- 2. the pdfs bucket policies (expect exactly the 2 created above):
SELECT policyname, cmd, roles::text, qual
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND (qual LIKE '%''pdfs''%' OR with_check LIKE '%''pdfs''%');
