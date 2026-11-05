-- P37-17 | Isolated PostgreSQL transaction, RLS, CAS and rollback regression
-- Target ONLY: Supabase project kushe-auth-lab (ldktrfgzzzmklhsnfrol)
-- NEVER run on kushe-erp-cloud or any live ERP database.
-- This is a test harness for the existing P37-9B synthetic schema and RPC.
-- Use a privileged, trusted SQL editor. SET LOCAL ROLE is a test of authenticated
-- RLS and the existing security-invoker RPC, NOT an authorization shortcut for clients.
-- NO real customer, project, billing, invoice, bank or payroll identifiers.
-- Every synthetic write below is rolled back; no fixture is retained.
-- These tests do not prove two simultaneous network clients or production sync.

-- 1. Unauthorized clients may not submit a synthetic allowance.
BEGIN;
SET LOCAL ROLE anon;
DO $p3717_anon$
BEGIN
  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      '00000000-0000-4000-8000-000000000017'::uuid,
      0,'P37-9B-IDEMP-00000000-0000-4000-8000-000000000017',
      26000,1300,24700,2600,NULL
    );
    RAISE EXCEPTION 'P37_17_ANON_WRITE_NOT_BLOCKED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_NOT_ALLOWLISTED%'
       AND SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
  END;
END $p3717_anon$;
ROLLBACK;

-- 2. The allowlisted test principal can create ONLY synthetic fixtures.
-- The two deliberate errors must rollback every column and event together.
-- The accepted transaction must balance 27,300 and refuse duplicates/stale CAS.
BEGIN;
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT user_id::text FROM public.p37_lab_members
   WHERE enabled=true ORDER BY created_at LIMIT 1),
  true
);
SET LOCAL ROLE authenticated;
DO $p3717$
DECLARE
  v_case_id uuid;
  v_result jsonb;
  v_owner uuid := auth.uid();
  v_key text;
BEGIN
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.p37_lab_members WHERE user_id=v_owner AND enabled
  ) THEN RAISE EXCEPTION 'P37_17_AUTH_REQUIRED'; END IF;

  INSERT INTO public.p37_lab_cases
    (owner_id,case_no,invoice_no,original_untaxed,original_tax,
     original_gross,original_receivable,original_retention)
  VALUES
    (v_owner,'P37-9B-TEST-P37-17-ATOMIC-001','P37-9B-INV-P37-17-ATOMIC-001',
     1248000,62400,1310400,1185600,124800)
  RETURNING id INTO v_case_id;
  v_key:='P37-9B-IDEMP-' || v_case_id::text;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case_id,0,v_key,26000,1300,24700,2600,'AFTER_ALLOWANCE_INSERT'
    );
    RAISE EXCEPTION 'P37_17_EXPECTED_INSERT_FAULT_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_INJECTED_AFTER_ALLOWANCE%' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case_id)<>0
     OR EXISTS(SELECT 1 FROM public.p37_lab_allowances WHERE case_id=v_case_id)
  THEN RAISE EXCEPTION 'P37_17_INSERT_FAULT_NOT_ATOMIC'; END IF;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case_id,0,v_key,26000,1300,24700,2600,'AFTER_REVISION_UPDATE'
    );
    RAISE EXCEPTION 'P37_17_EXPECTED_REVISION_FAULT_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_INJECTED_AFTER_REVISION%' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case_id)<>0
     OR EXISTS(SELECT 1 FROM public.p37_lab_allowances WHERE case_id=v_case_id)
  THEN RAISE EXCEPTION 'P37_17_REVISION_FAULT_NOT_ATOMIC'; END IF;

  SELECT public.p37_lab_apply_synthetic_allowance(
    v_case_id,0,v_key,26000,1300,24700,2600,NULL
  ) INTO v_result;
  IF v_result->>'scope'<>'P37_LAB_SYNTHETIC_ONLY'
     OR v_result->>'status'<>'P37_LAB_TEST_COMMITTED_ONLY'
     OR (v_result->>'revision')::integer<>1
     OR (v_result->>'discount_gross')::bigint<>27300
     OR (v_result->>'effective_gross')::bigint<>1283100
     OR (v_result->>'effective_receivable')::bigint<>1160900
     OR (v_result->>'effective_retention')::bigint<>122200
     OR (v_result->>'official_erp_posted')::boolean IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'P37_17_MATH_OR_STATUS_FAILED'; END IF;

  -- Flush initially deferred consistency triggers before final rollback.
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case_id)<>1
     OR (SELECT count(*) FROM public.p37_lab_allowances WHERE case_id=v_case_id)<>1
  THEN RAISE EXCEPTION 'P37_17_COMMIT_CANDIDATE_NOT_ATOMIC'; END IF;

  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case_id,0,v_key,26000,1300,24700,2600,NULL
    );
    RAISE EXCEPTION 'P37_17_EXPECTED_DUPLICATE_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_DUPLICATE_OR_VERSION_CONFLICT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case_id,1,v_key,26000,1300,24700,2600,NULL
    );
    RAISE EXCEPTION 'P37_17_EXPECTED_STALE_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_EXPECTED_ID_AND_VERSION_REQUIRED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.p37_lab_apply_synthetic_allowance(
      v_case_id,0,v_key,26000,1300,24701,2600,NULL
    );
    RAISE EXCEPTION 'P37_17_EXPECTED_UNBALANCED_NOT_RAISED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%P37_LAB_DISCOUNT_UNBALANCED%' THEN RAISE; END IF;
  END;
  IF (SELECT revision FROM public.p37_lab_cases WHERE id=v_case_id)<>1
     OR (SELECT count(*) FROM public.p37_lab_allowances WHERE case_id=v_case_id)<>1
  THEN RAISE EXCEPTION 'P37_17_FAILED_REPLAY_CHANGED_DATA'; END IF;
  RAISE NOTICE 'P37_17_POSTGRES_ROLLBACK_RLS_CAS_PASS';
END $p3717$;
ROLLBACK;

-- 3. Regression outcome: no synthetic fixture or allowance should remain.
SELECT
  'P37_17_PASS_IF_BOTH_ZERO' AS test_status,
  (SELECT count(*) FROM public.p37_lab_cases
    WHERE case_no='P37-9B-TEST-P37-17-ATOMIC-001') AS target_cases_remaining,
  (SELECT count(*) FROM public.p37_lab_allowances a
    JOIN public.p37_lab_cases c ON c.id=a.case_id
    WHERE c.case_no='P37-9B-TEST-P37-17-ATOMIC-001') AS target_allowances_remaining;
