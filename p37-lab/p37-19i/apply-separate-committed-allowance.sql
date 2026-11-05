-- P37-19I | COMMITTED allowance in a SEPARATE transaction.
-- Run ONLY in kushe-auth-lab (ldktrfgzzzmklhsnfrol).
-- First run p37-lab/p37-19g/stage-fixture.sql in this lab.
-- ALWAYS run p37-lab/p37-19g/cleanup-fixture.sql afterwards.
BEGIN;
SET LOCAL statement_timeout='15000ms';
DO $guard$
BEGIN
 IF current_user<>'postgres' OR
 (SELECT COUNT(*) FROM public.p37_lab_cases
  WHERE id='00000000-0000-4000-8000-000000019019'::uuid
  AND case_no='P37-9B-TEST-P37-19G-CLEANUP-20261105' AND revision=0)<>1 OR
 (SELECT COUNT(*) FROM public.p37_lab_allowances)<>0 THEN
 RAISE EXCEPTION 'P37_19I_STAGED_SOURCE_MISMATCH'; END IF;
END $guard$;
SELECT set_config('request.jwt.claim.sub',
 (SELECT user_id::text FROM public.p37_lab_members WHERE enabled LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $post$
DECLARE value jsonb;
BEGIN
 SELECT public.p37_lab_apply_synthetic_allowance(
  '00000000-0000-4000-8000-000000019019'::uuid,0,
  'P37-9B-IDEMP-00000000-0000-4000-8000-000000019019',
  26000,1300,24700,2600,NULL) INTO value;
 IF value->>'scope'<>'P37_LAB_SYNTHETIC_ONLY'
 OR value->>'status'<>'P37_LAB_TEST_COMMITTED_ONLY'
 OR (value->>'discount_gross')::bigint<>27300
 OR (value->>'effective_gross')::bigint<>1283100
 OR (value->>'effective_receivable')::bigint<>1160900
 OR (value->>'effective_retention')::bigint<>122200
 OR (value->>'official_erp_posted')::boolean IS DISTINCT FROM false THEN
 RAISE EXCEPTION 'P37_19I_DISCOUNT_POSTCHECK_FAILED'; END IF;
END $post$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
SELECT (SELECT COUNT(*) FROM public.p37_lab_cases) AS lab_cases,
 (SELECT COUNT(*) FROM public.p37_lab_allowances) AS lab_allowances,
 (SELECT revision FROM public.p37_lab_cases WHERE id='00000000-0000-4000-8000-000000019019'::uuid) AS revision,
 (SELECT discount_gross FROM public.p37_lab_allowances
  WHERE case_id='00000000-0000-4000-8000-000000019019'::uuid) AS discount_gross;
