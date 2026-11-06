-- P37-19W: run only in manually selected kushe-auth-lab:
-- ldktrfgzzzmklhsnfrol. READ ONLY. Never the production ERP project.
-- This is a momentary management-side baseline, NOT signed HTTP verification.
SELECT
 (SELECT count(*)::integer FROM public.p37_lab_cases) AS synthetic_cases,
 (SELECT count(*)::integer FROM public.p37_lab_allowances) AS synthetic_allowances,
 (SELECT count(*)::integer FROM public.p37_lab_members WHERE enabled=true) AS enabled_test_members,
 (SELECT count(*)::integer FROM auth.sessions
    WHERE user_id IN (SELECT user_id FROM public.p37_lab_members WHERE enabled=true))
   AS session_rows_not_live_jwt_evidence;
SELECT
 count(*) FILTER (WHERE relrowsecurity)::integer AS rls_enabled_count,
 count(*)::integer AS expected_public_lab_tables
FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE n.nspname='public' AND c.relname IN
 ('p37_lab_cases','p37_lab_allowances','p37_lab_members');
SELECT p.proname, p.prosecdef AS security_definer,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public' AND p.proname='p37_lab_apply_synthetic_allowance';
SELECT column_name,privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='p37_lab_cases'
 AND grantee='authenticated' AND privilege_type='UPDATE'
ORDER BY column_name;
