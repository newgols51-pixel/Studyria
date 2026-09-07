-- ═══════════════════════════════════════════════════════════════════════════
-- STUDYRIA — restore standard Supabase service_role table grants
-- 2026-09-07. A past REVOKE left service_role with only Dxtm (truncate/
-- references/trigger) on 95 of 101 public tables — NO select/insert/update.
-- (anon/authenticated are unaffected; storage schema is unaffected.)
--
-- Why it matters: the service_role key is what server-side code uses
-- (srPdfAccess claim writes, webhooks, any future server tooling). Without
-- grants, every service-key read/write on those tables fails with
-- "permission denied for table X". This restores the Supabase default.
--
-- Safe: service_role is a server-side secret key (never in the browser)
-- and still subject to being kept private. This does NOT change any RLS
-- policy and grants nothing to anon/authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- make FUTURE tables/sequences created by the SQL editor work too
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

-- VERIFICATION — expect broken = 0
SELECT count(*) AS broken
  FROM pg_tables t
 WHERE t.schemaname = 'public'
   AND NOT has_table_privilege('service_role',
         quote_ident(t.schemaname) || '.' || quote_ident(t.tablename), 'SELECT');
