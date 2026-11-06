-- P37-19W: independent ADMIN read-only post-cleanup check in
-- kushe-auth-lab (ldktrfgzzzmklhsnfrol) only.
-- Must be executed AFTER the exact P37-19G cleanup-fixture.sql was
-- committed by the authorized lab administrator, in a separate session.
-- A zero row count here is NOT evidence that an RPC race ever occurred.
SELECT
 (SELECT count(*)::integer FROM public.p37_lab_cases) AS remaining_cases,
 (SELECT count(*)::integer FROM public.p37_lab_allowances) AS remaining_allowances,
 (SELECT count(*)::integer FROM public.p37_lab_members WHERE enabled=true)
  AS enabled_members_unchanged,
 (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n
  ON c.relnamespace=n.oid WHERE n.nspname='public' AND
  c.relname IN ('p37_lab_cases','p37_lab_allowances','p37_lab_members')
  AND c.relrowsecurity) AS rls_still_enabled_tables,
 (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n
  ON p.pronamespace=n.oid
  WHERE n.nspname='public' AND p.proname='p37_lab_apply_synthetic_allowance'
  AND p.prosecdef=false
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE'))
  AS guarded_invoker_rpc_count;
-- Acceptance condition: 0 / 0 / 1 / 3 / 1.
-- Compare this independent result with the sanitized signed runner
-- results and the exact test case ID. Do not unlock official ERP posting.
