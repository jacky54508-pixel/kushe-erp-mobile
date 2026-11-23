\set ON_ERROR_STOP on
-- No real JWT here: all request.jwt.claim.* GUCs are fake harness inputs.
SET ROLE p40bj_reader;
SET request.jwt.claim.sub TO 'fake_owner_A';
SET request.jwt.claim.aal TO 'aal2';
SET request.jwt.claim.session_id TO 'session_A';
DO $$
DECLARE x jsonb;
BEGIN
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1))<>1 THEN RAISE EXCEPTION 'owner positive denied'; END IF;
 SELECT public_view INTO x FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1);
 IF x->>'targetZone'<>'FAKE_ZONE_A' OR x->'lines'->0->>'item'<>'Fake work' THEN RAISE EXCEPTION 'positive projection wrong'; END IF;
 IF x::text LIKE '%PRIVATE_%' OR x::text LIKE '%sourceInvoices%' OR x::text LIKE '%staffSalary%' OR x::text LIKE '%bankAccount%' OR x::text LIKE '%other_zone%' THEN RAISE EXCEPTION 'private data leaked'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a2','FAKE_ZONE_A2',1,1))<>0 THEN RAISE EXCEPTION 'same company unapproved document visible'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000b1','FAKE_ZONE_B',1,1))<>0 THEN RAISE EXCEPTION 'cross company visible'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_B',1,1))<>0 THEN RAISE EXCEPTION 'wrong zone visible'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',2,1))<>0 THEN RAISE EXCEPTION 'wrong source version visible'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,2))<>0 THEN RAISE EXCEPTION 'wrong revision visible'; END IF;
 IF has_table_privilege(current_user,'p40bj.snapshots','SELECT') THEN RAISE EXCEPTION 'reader can read full JSONB snapshot'; END IF;
 IF has_function_privilege(current_user,'p40bj.commit_fake_snapshot(uuid,bigint,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'reader can perform source commit'; END IF;
END $$;
\echo 'P40BJ_TEST_PASS owner ACL zone/source_version/revision privacy no-full-snapshot'
SET request.jwt.claim.aal TO 'aal1';
DO $$ BEGIN IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1))<>0 THEN RAISE EXCEPTION 'aal1 visible'; END IF; END $$;
\echo 'P40BJ_TEST_PASS fake aal1 denied'
SET request.jwt.claim.aal TO 'aal2';
SET request.jwt.claim.session_id TO 'no_session';
DO $$ BEGIN IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1))<>0 THEN RAISE EXCEPTION 'revoked/nonexistent session visible'; END IF; END $$;
\echo 'P40BJ_TEST_PASS fake session denied'
SET request.jwt.claim.session_id TO 'session_emp';
SET request.jwt.claim.sub TO 'fake_employee_A';
DO $$ BEGIN IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1))<>0 THEN RAISE EXCEPTION 'employee visible'; END IF; END $$;
\echo 'P40BJ_TEST_PASS fake employee denied'
SET request.jwt.claim.session_id TO 'session_acct';
SET request.jwt.claim.sub TO 'fake_accountant_A';
DO $$ BEGIN IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a2','FAKE_ZONE_A2',1,1))<>1 THEN RAISE EXCEPTION 'accountant acl failed'; END IF; END $$;
\echo 'P40BJ_TEST_PASS fake accountant own document'
RESET ROLE;
-- Function executes with fake restricted writer privileges (SECURITY INVOKER).
SET ROLE p40bj_writer;
DO $$
DECLARE before_data jsonb; before_version bigint; after_data jsonb; after_version bigint; rejected boolean:=false;
BEGIN
 SELECT data,sync_version INTO before_data,before_version FROM p40bj.snapshots WHERE document_id='00000000-0000-4000-8000-0000000000a1';
 -- Intentionally FAIL after an UPDATE inside a function. PostgreSQL exception subtransaction MUST undo it.
 BEGIN
  PERFORM p40bj.commit_fake_snapshot('00000000-0000-4000-8000-0000000000a1',1,1,
    jsonb_set(before_data,'{reviewed_public_note}','false'::jsonb));
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'unreviewed note was committed'; END IF;
 SELECT data,sync_version INTO after_data,after_version FROM p40bj.snapshots WHERE document_id='00000000-0000-4000-8000-0000000000a1';
 IF after_data<>before_data OR after_version<>before_version THEN RAISE EXCEPTION 'partial snapshot survived failure'; END IF;
 -- Wrong tenant/zone must similarly reject and roll back.
 rejected:=false;
 BEGIN
  PERFORM p40bj.commit_fake_snapshot('00000000-0000-4000-8000-0000000000a1',1,1,
    jsonb_set(before_data,'{target_zone}','"FAKE_OTHER_ZONE"'::jsonb));
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'wrong target committed'; END IF;
 SELECT data,sync_version INTO after_data,after_version FROM p40bj.snapshots WHERE document_id='00000000-0000-4000-8000-0000000000a1';
 IF after_data<>before_data OR after_version<>before_version THEN RAISE EXCEPTION 'wrong target broke atomicity'; END IF;
END $$;
\echo 'P40BJ_TEST_PASS fake writer rollback for invalid note and target'
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM p40bj.audit_events)<>0 THEN RAISE EXCEPTION 'failed atomic write created audit'; END IF;
 IF (SELECT count(*) FROM p40bj.documents WHERE source_version<>1 OR revision<>1)<>0 THEN RAISE EXCEPTION 'partial projection changed'; END IF;
END $$;
\echo 'P40BJ_TEST_PASS no partial audit or projection'
SET ROLE p40bj_writer;
DO $$
DECLARE newstate jsonb; updated integer; denied boolean:=false;
BEGIN
 SELECT jsonb_set(data,'{gross_total}','11000'::jsonb) INTO newstate FROM p40bj.snapshots
 WHERE document_id='00000000-0000-4000-8000-0000000000a1';
 updated:=p40bj.commit_fake_snapshot('00000000-0000-4000-8000-0000000000a1',1,1,newstate);
 IF updated<>2 THEN RAISE EXCEPTION 'version did not increment'; END IF;
 BEGIN
  PERFORM p40bj.commit_fake_snapshot('00000000-0000-4000-8000-0000000000a1',1,1,newstate);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'stale source CAS was accepted'; END IF;
END $$;
\echo 'P40BJ_TEST_PASS fake atomic success and stale writer rejection'
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM p40bj.audit_events)<>1 THEN RAISE EXCEPTION 'append-only audit event missing'; END IF;
 IF (SELECT count(*) FROM p40bj.documents d JOIN p40bj.snapshots s ON s.document_id=d.id
      WHERE d.id='00000000-0000-4000-8000-0000000000a1' AND d.source_version=s.sync_version AND d.source_version=2 AND d.revision=2 AND d.status='pending_review' AND d.approved_revision=0)<>1
 THEN RAISE EXCEPTION 'atomic revision/source mismatch'; END IF;
END $$;
SET ROLE p40bj_reader;
SET request.jwt.claim.sub TO 'fake_owner_A';
SET request.jwt.claim.aal TO 'aal2';
SET request.jwt.claim.session_id TO 'session_A';
DO $$ BEGIN
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',1,1))<>0 THEN RAISE EXCEPTION 'old approved version incorrectly accessible'; END IF;
 IF (SELECT count(*) FROM p40bj.read_one_document('00000000-0000-4000-8000-0000000000a1','FAKE_ZONE_A',2,2))<>0 THEN RAISE EXCEPTION 'new unreviewed version incorrectly accessible'; END IF;
END $$;
RESET ROLE;
\echo 'P40BJ_TEST_PASS unreviewed update blocks existing and new print access'
\echo 'P40BJ_ASSERTIONS_COMPLETE_FAKE_ONLY'
