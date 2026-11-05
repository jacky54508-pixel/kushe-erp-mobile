-- P37-19F | REAL PostgreSQL transaction regression, isolated lab ONLY.
-- APPROVED PROJECT ONLY: kushe-auth-lab (ldktrfgzzzmklhsnfrol).
-- This file must never be sent to a production ERP database.
-- Every test write is inside BEGIN ... ROLLBACK. No persistent fixture.
-- This is NOT evidence of two authenticated HTTP clients racing the same RPC.
--
-- A. Anonymous RLS/RPC denial in one rollback-only transaction.
BEGIN;
SET LOCAL ROLE anon;
DO $p3719f_anon$
BEGIN
  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      '00000000-0000-4000-8000-000000000019'::uuid,
      0,'P37-9B-IDEMP-00000000-0000-4000-8000-000000000019',
      26000,1300,24700,2600,NULL);
    RAISE EXCEPTION 'P37_19F_ANONYMOUS_UNEXPECTEDLY_POSTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_NOT_ALLOWLISTED%'
       AND SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'P37_19F_ANONYMOUS_DENIED_PASS';
END $p3719f_anon$;
ROLLBACK;

-- B. Impersonated authenticated role via SQL console (not a real JWT session).
--    Roll back every insert/update after asserting the two injected faults.
BEGIN;
SELECT set_config('request.jwt.claim.sub',
  (SELECT user_id::text FROM public.p37_lab_members WHERE enabled=true ORDER BY created_at LIMIT 1),
  true);
SET LOCAL ROLE authenticated;
DO $p3719f$
DECLARE
  v_case uuid;
  v_owner uuid := auth.uid();
  v_key text;
  v_out jsonb;
BEGIN
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.p37_lab_members WHERE user_id=v_owner AND enabled
  ) THEN RAISE EXCEPTION 'P37_19F_NO_ISOLATED_TEST_MEMBER'; END IF;

  INSERT INTO public.p37_lab_cases
    (owner_id,case_no,invoice_no,original_untaxed,original_tax,
     original_gross,original_receivable,original_retention)
  VALUES
    (v_owner,'P37-9B-TEST-P37-19F-TXN','P37-9B-INV-P37-19F-TXN',
     1248000,62400,1310400,1185600,124800)
  RETURNING id INTO v_case;
  v_key := 'P37-9B-IDEMP-' || v_case::text;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case,0,v_key,26000,1300,24700,2600,'AFTER_ALLOWANCE_INSERT');
    RAISE EXCEPTION 'P37_19F_INSERT_FAULT_NOT_TRIGGERED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_INJECTED_AFTER_ALLOWANCE%' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case)<>0 OR
     EXISTS (SELECT 1 FROM public.p37_lab_allowances WHERE case_id=v_case)
  THEN RAISE EXCEPTION 'P37_19F_INSERT_NOT_ATOMIC'; END IF;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case,0,v_key,26000,1300,24700,2600,'AFTER_REVISION_UPDATE');
    RAISE EXCEPTION 'P37_19F_REVISION_FAULT_NOT_TRIGGERED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_INJECTED_AFTER_REVISION%' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case)<>0 OR
     EXISTS (SELECT 1 FROM public.p37_lab_allowances WHERE case_id=v_case)
  THEN RAISE EXCEPTION 'P37_19F_REVISION_NOT_ATOMIC'; END IF;

  SELECT public.p37_lab_apply_synthetic_allowance(
    v_case,0,v_key,26000,1300,24700,2600,NULL) INTO v_out;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF v_out->>'scope'<>'P37_LAB_SYNTHETIC_ONLY'
     OR v_out->>'status'<>'P37_LAB_TEST_COMMITTED_ONLY'
     OR (v_out->>'discount_gross')::bigint<>27300
     OR (v_out->>'effective_gross')::bigint<>1283100
     OR (v_out->>'effective_receivable')::bigint<>1160900
     OR (v_out->>'effective_retention')::bigint<>122200
     OR (v_out->>'official_erp_posted')::boolean IS DISTINCT FROM false
     OR (SELECT revision FROM public.p37_lab_cases WHERE id=v_case)<>1
     OR (SELECT count(*) FROM public.p37_lab_allowances WHERE case_id=v_case)<>1
  THEN RAISE EXCEPTION 'P37_19F_BAD_BALANCE_OR_REVISION'; END IF;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case,0,v_key,26000,1300,24700,2600,NULL);
    RAISE EXCEPTION 'P37_19F_DUPLICATE_NOT_REJECTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_DUPLICATE_OR_VERSION_CONFLICT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case,1,v_key,26000,1300,24700,2600,NULL);
    RAISE EXCEPTION 'P37_19F_STALE_NOT_REJECTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_EXPECTED_ID_AND_VERSION_REQUIRED%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.p37_lab_allowances WHERE case_id=v_case)<>1 OR
     (SELECT revision FROM public.p37_lab_cases WHERE id=v_case)<>1
  THEN RAISE EXCEPTION 'P37_19F_REPLAY_CHANGED_RECORD'; END IF;
  RAISE NOTICE 'P37_19F_REAL_LAB_TRANSACTION_RLS_ROLLBACK_PASS';
END $p3719f$;
ROLLBACK;

-- C. Two outputs must equal 0, independent of the simulated commits above.
SELECT
 (SELECT count(*) FROM public.p37_lab_cases
  WHERE case_no='P37-9B-TEST-P37-19F-TXN') AS target_cases_after_rollback,
 (SELECT count(*) FROM public.p37_lab_allowances a
  JOIN public.p37_lab_cases c ON c.id=a.case_id
  WHERE c.case_no='P37-9B-TEST-P37-19F-TXN') AS target_allowances_after_rollback;
