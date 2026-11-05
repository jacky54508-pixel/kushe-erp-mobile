-- P37-19G MANUAL ONLY. Strictly kushe-auth-lab (ldktrfgzzzmklhsnfrol).
-- This commits one synthetic case. Run cleanup-fixture.sql even on test failure.
BEGIN;
SET LOCAL statement_timeout='15000ms';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'P37_19G_ADMIN_REQUIRED'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_cases)<>0 OR
    (SELECT COUNT(*) FROM public.p37_lab_allowances)<>0 THEN
    RAISE EXCEPTION 'P37_19G_LAB_MUST_START_EMPTY'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_members WHERE enabled)<>1 THEN
    RAISE EXCEPTION 'P37_19G_SINGLE_MEMBER_REQUIRED'; END IF;
END $guard$;
SELECT set_config('request.jwt.claim.sub',
 (SELECT user_id::text FROM public.p37_lab_members WHERE enabled),true);
SET LOCAL ROLE authenticated;
INSERT INTO public.p37_lab_cases
 (id,owner_id,case_no,invoice_no,original_untaxed,original_tax,
  original_gross,original_receivable,original_retention)
VALUES
 ('00000000-0000-4000-8000-000000019019'::uuid,auth.uid(),
  'P37-9B-TEST-P37-19G-CLEANUP-20261105',
  'P37-9B-INV-P37-19G-CLEANUP-20261105',
  1248000,62400,1310400,1185600,124800);
RESET ROLE;
DO $verify$
BEGIN
 IF (SELECT COUNT(*) FROM public.p37_lab_cases
     WHERE id='00000000-0000-4000-8000-000000019019'::uuid
       AND case_no='P37-9B-TEST-P37-19G-CLEANUP-20261105' AND revision=0)<>1
 THEN RAISE EXCEPTION 'P37_19G_STAGING_FAILED'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_allowances)<>0
 THEN RAISE EXCEPTION 'P37_19G_UNEXPECTED_ALLOWANCE'; END IF;
END $verify$;
COMMIT;
SELECT COUNT(*) AS staged_cases FROM public.p37_lab_cases
 WHERE case_no='P37-9B-TEST-P37-19G-CLEANUP-20261105';
