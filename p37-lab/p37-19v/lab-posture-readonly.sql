-- P37-19V: READ ONLY verification for project kushe-auth-lab only.
-- Before running: select project ref ldktrfgzzzmklhsnfrol manually in console.
-- NEVER run against jimcybsztnwfzrnvexsp / formal ERP cloud.
-- SELECT/metadata only. No DDL, GRANT, RLS changes, staging or cleanup.
SELECT
 (SELECT count(*)::integer FROM public.p37_lab_cases) AS case_count,
 (SELECT count(*)::integer FROM public.p37_lab_allowances) AS allowance_count,
 (SELECT count(*)::integer FROM public.p37_lab_members WHERE enabled) AS enabled_member_count,
 (SELECT count(*)::integer FROM auth.sessions
   WHERE user_id IN(SELECT user_id FROM public.p37_lab_members WHERE enabled))
   AS auth_session_rows_not_jwt_proof,
 (SELECT count(DISTINCT id)::integer FROM auth.sessions
   WHERE user_id IN(SELECT user_id FROM public.p37_lab_members WHERE enabled))
   AS distinct_db_session_rows_not_signed_http_proof;
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
 AND c.relname IN ('p37_lab_members','p37_lab_cases','p37_lab_allowances')
ORDER BY c.relname;
SELECT
 p.proname, p.prosecdef AS security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_can_rpc,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_rpc
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='p37_lab_apply_synthetic_allowance';
SELECT column_name,privilege_type
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='p37_lab_cases'
 AND grantee='authenticated' AND privilege_type='UPDATE'
ORDER BY column_name;
