-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA — RLS HARDENING, PHASE 4: close the fake-purchase hole (GAP B)
--
-- ⛔ DO NOT RUN YET. Run ONLY after ALL of these are true:
--   1. srPdfAccess backend is deployed WITH the Razorpay key_secret and
--      Supabase service-role key embedded (ask the agent to redeploy),
--   2. `ping` returns { ok: true, configured: true },
--   3. one real test purchase verified server-side (console shows
--      "Purchase recorded via server-side Razorpay verification").
--
-- WHAT IT DOES:
--   Removes the last client-side write paths to purchased_pdfs, so a
--   signed-in user can no longer self-insert a fake 'paid' row (the
--   remaining owner-scoped insert policy from phase 1 is removed here).
--   After this, the ONLY writers are the service-role backend
--   (srPdfAccess claim / claim-free) and admins.
--
-- WHY IT IS SAFE TO WAIT: until this runs, the frontend tries the
-- server path first and falls back to the legacy insert; nothing breaks
-- either way. This file simply removes the fallback permanently.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── client-side purchase inserts → server-only ────────────────────────────
DROP POLICY IF EXISTS "purchased_pdfs_own_insert" ON public.purchased_pdfs;

-- ─── VERIFICATION ───────────────────────────────────────────────────────────
-- expect ZERO client-insertable policies on purchased_pdfs (read stays):
SELECT policyname, cmd, roles::text, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'purchased_pdfs'
 ORDER BY cmd;
-- Expected: own/admin SELECT + admin UPDATE/DELETE — and NO INSERT policy.
