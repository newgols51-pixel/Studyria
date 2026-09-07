-- ═══════════════════════════════════════════════════════════════════════════
-- EMERGENCY RESTORE: re-open the client purchase insert (phase-4 rollback)
-- Run this if rls-hardening-phase4.sql was run BEFORE srPdfAccess was
-- configured with secrets — otherwise paying customers get nothing
-- recorded. Once the agent confirms srPdfAccess is live + a test purchase
-- verified, run rls-hardening-phase4.sql again to close it permanently.
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "purchased_pdfs_own_insert" ON public.purchased_pdfs;
CREATE POLICY "purchased_pdfs_own_insert" ON public.purchased_pdfs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              OR email = auth.jwt()->>'email');

-- verify: expect 4 policies now (SELECT/INSERT/UPDATE/DELETE)
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'purchased_pdfs' ORDER BY cmd;
