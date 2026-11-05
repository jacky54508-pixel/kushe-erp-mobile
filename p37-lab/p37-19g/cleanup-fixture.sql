-- P37-19G MANUAL ADMIN CLEANUP. Strictly kushe-auth-lab (ldktrfgzzzmklhsnfrol).
-- Never change grants/RLS. Fail closed on foreign rows or unknown fixture identity.
BEGIN;
SET LOCAL statement_timeout='15000ms';
DO $cleanup$
DECLARE v_id uuid:='00000000-0000-4000-8000-000000019019'::uuid; v_rows integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'P37_19G_ADMIN_REQUIRED'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_members WHERE enabled)<>1 THEN
  RAISE EXCEPTION 'P37_19G_MEMBER_CHANGED'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_cases WHERE id<>v_id)<>0 OR
    (SELECT COUNT(*) FROM public.p37_lab_allowances WHERE case_id<>v_id)<>0 THEN
  RAISE EXCEPTION 'P37_19G_FOREIGN_ROWS_PRESENT_NO_CLEANUP'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_cases WHERE id=v_id)=0 THEN
  IF (SELECT COUNT(*) FROM public.p37_lab_allowances)<>0 THEN
   RAISE EXCEPTION 'P37_19G_ORPHAN_ALLOWANCE'; END IF;
  RAISE NOTICE 'P37_19G_ALREADY_CLEAN'; RETURN;
 END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_cases
      WHERE id=v_id AND case_no='P37-9B-TEST-P37-19G-CLEANUP-20261105'
       AND invoice_no='P37-9B-INV-P37-19G-CLEANUP-20261105'
       AND owner_id=(SELECT user_id FROM public.p37_lab_members WHERE enabled)
       AND source_tag='P37_LAB_SYNTHETIC_ONLY'
       AND original_gross=1310400 AND original_receivable=1185600
       AND original_retention=124800 AND revision IN (0,1))<>1 THEN
  RAISE EXCEPTION 'P37_19G_FIXTURE_IDENTITY_MISMATCH'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_allowances WHERE case_id=v_id
     AND (idempotency_key<>'P37-9B-IDEMP-'||v_id::text
       OR source_tag<>'P37_LAB_SYNTHETIC_ONLY'
       OR discount_gross<>27300 OR receivable_reduction<>24700
       OR retention_reduction<>2600))<>0 THEN
  RAISE EXCEPTION 'P37_19G_UNEXPECTED_ALLOWANCE'; END IF;
 DELETE FROM public.p37_lab_allowances
  WHERE case_id=v_id AND idempotency_key='P37-9B-IDEMP-'||v_id::text
    AND source_tag='P37_LAB_SYNTHETIC_ONLY';
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows>1 THEN RAISE EXCEPTION 'P37_19G_TOO_MANY_DELETED'; END IF;
 DELETE FROM public.p37_lab_cases
  WHERE id=v_id AND case_no='P37-9B-TEST-P37-19G-CLEANUP-20261105'
    AND source_tag='P37_LAB_SYNTHETIC_ONLY';
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'P37_19G_CASE_NOT_CLEANED'; END IF;
 IF (SELECT COUNT(*) FROM public.p37_lab_cases)<>0 OR
    (SELECT COUNT(*) FROM public.p37_lab_allowances)<>0 THEN
  RAISE EXCEPTION 'P37_19G_NOT_ZERO'; END IF;
 RAISE NOTICE 'P37_19G_ADMIN_CLEANUP_PASS';
END $cleanup$;
COMMIT;
SELECT (SELECT COUNT(*) FROM public.p37_lab_cases) AS lab_cases,
       (SELECT COUNT(*) FROM public.p37_lab_allowances) AS lab_allowances;
