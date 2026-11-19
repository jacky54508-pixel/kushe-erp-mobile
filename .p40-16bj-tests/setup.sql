\set ON_ERROR_STOP on
-- P40-16BJ: CI-ONLY ephemeral PostgreSQL 17 test. ALL DATA IS FAKE.
-- NEVER RUN ON PRODUCTION SUPABASE. NO auth.users, real JWT or external ERP data.
CREATE ROLE p40bj_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE p40bj_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA p40bj;
REVOKE ALL ON SCHEMA p40bj FROM PUBLIC;
GRANT USAGE ON SCHEMA p40bj TO p40bj_reader, p40bj_writer;

CREATE TABLE p40bj.memberships (company text NOT NULL, user_id text NOT NULL, role text NOT NULL, active boolean NOT NULL, PRIMARY KEY(company,user_id));
CREATE TABLE p40bj.sessions (user_id text NOT NULL, session_id text NOT NULL, active boolean NOT NULL, PRIMARY KEY(user_id,session_id));
CREATE TABLE p40bj.document_acl (document_id uuid NOT NULL, user_id text NOT NULL, allowed boolean NOT NULL, PRIMARY KEY(document_id,user_id));
CREATE TABLE p40bj.snapshots (document_id uuid PRIMARY KEY, company text NOT NULL, sync_version bigint NOT NULL CHECK (sync_version>0), data jsonb NOT NULL);
CREATE TABLE p40bj.documents (
 id uuid PRIMARY KEY, company text NOT NULL, target_zone text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 source_version bigint NOT NULL CHECK(source_version>0), approved_revision integer NOT NULL,
 status text NOT NULL, source_digest text NOT NULL, public_view jsonb NOT NULL
);
CREATE TABLE p40bj.audit_events (event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, document_id uuid NOT NULL, source_version bigint NOT NULL, revision integer NOT NULL, source_digest text NOT NULL);

ALTER TABLE p40bj.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.document_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40bj.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE p40bj.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE p40bj.document_acl FORCE ROW LEVEL SECURITY;
ALTER TABLE p40bj.snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE p40bj.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE p40bj.audit_events FORCE ROW LEVEL SECURITY;

GRANT SELECT ON p40bj.memberships,p40bj.sessions,p40bj.document_acl,p40bj.documents TO p40bj_reader;
GRANT SELECT,UPDATE ON p40bj.snapshots,p40bj.documents TO p40bj_writer;
GRANT INSERT ON p40bj.audit_events TO p40bj_writer;
GRANT USAGE ON SEQUENCE p40bj.audit_events_event_id_seq TO p40bj_writer;

CREATE POLICY read_self_member ON p40bj.memberships FOR SELECT TO p40bj_reader
 USING (user_id=current_setting('request.jwt.claim.sub',true));
CREATE POLICY read_self_session ON p40bj.sessions FOR SELECT TO p40bj_reader
 USING (user_id=current_setting('request.jwt.claim.sub',true));
CREATE POLICY read_self_acl ON p40bj.document_acl FOR SELECT TO p40bj_reader
 USING (user_id=current_setting('request.jwt.claim.sub',true));
CREATE POLICY read_one_doc ON p40bj.documents FOR SELECT TO p40bj_reader
 USING (
   status='approved' AND approved_revision=revision AND current_setting('request.jwt.claim.aal',true)='aal2'
   AND EXISTS(SELECT 1 FROM p40bj.memberships m WHERE m.company=documents.company AND m.user_id=current_setting('request.jwt.claim.sub',true) AND m.active AND m.role IN('owner','admin','accounting'))
   AND EXISTS(SELECT 1 FROM p40bj.sessions s WHERE s.user_id=current_setting('request.jwt.claim.sub',true) AND s.session_id=current_setting('request.jwt.claim.session_id',true) AND s.active)
   AND EXISTS(SELECT 1 FROM p40bj.document_acl a WHERE a.document_id=documents.id AND a.user_id=current_setting('request.jwt.claim.sub',true) AND a.allowed)
 );
CREATE POLICY writer_snapshots ON p40bj.snapshots FOR ALL TO p40bj_writer USING(true) WITH CHECK(true);
CREATE POLICY writer_documents ON p40bj.documents FOR ALL TO p40bj_writer USING(true) WITH CHECK(true);
CREATE POLICY writer_audit ON p40bj.audit_events FOR INSERT TO p40bj_writer WITH CHECK(true);

-- The projection is built INSIDE the fake trusted store, never from a browser-provided PDF payload.
CREATE FUNCTION p40bj.customer_projection(v jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE out_lines jsonb;
BEGIN
 IF jsonb_typeof(v) <> 'object' OR v->>'reviewed_public_note'<>'true'
     OR jsonb_typeof(v->'public_lines')<>'array'
     OR jsonb_array_length(v->'public_lines')<1 OR jsonb_array_length(v->'public_lines')>300
     OR coalesce(v->>'target_zone','')='' OR coalesce(v->>'gross_total','')!~'^[0-9]+$' THEN
   RAISE EXCEPTION 'UNAPPROVED_OR_INVALID_PUBLIC_SOURCE';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('house', l->>'house','item',l->>'item','unit',l->>'unit',
                  'qty',(l->>'qty')::numeric,'price',(l->>'price')::numeric,'amount',(l->>'amount')::bigint) ORDER BY ord)
 INTO out_lines FROM jsonb_array_elements(v->'public_lines') WITH ORDINALITY AS q(l,ord);
 RETURN jsonb_build_object('targetZone',v->>'target_zone','project',v->>'display_project',
                           'publicNote',v->>'public_note','grossTotal',(v->>'gross_total')::bigint,
                           'lines',out_lines);
END $$;
REVOKE ALL ON FUNCTION p40bj.customer_projection(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40bj.customer_projection(jsonb) TO p40bj_writer;

-- Explicit document, target zone, revision and source version binding; caller must pass all.
CREATE FUNCTION p40bj.read_one_document(p_id uuid, p_zone text, p_source_version bigint, p_revision integer)
 RETURNS TABLE(document_id uuid, target_zone text, source_version bigint, revision integer, public_view jsonb)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT d.id,d.target_zone,d.source_version,d.revision,d.public_view FROM p40bj.documents AS d
 WHERE d.id=p_id AND d.target_zone=p_zone AND d.source_version=p_source_version AND d.revision=p_revision;
 $$;
REVOKE ALL ON FUNCTION p40bj.read_one_document(uuid,text,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40bj.read_one_document(uuid,text,bigint,integer) TO p40bj_reader;

-- Privileged *isolated* writer model. This is NOT an approved production ingestion gateway.
-- Whole fake source exists only inside the temporary Postgres service.
CREATE FUNCTION p40bj.commit_fake_snapshot(p_id uuid, p_expected_version bigint, p_expected_revision integer, p_new jsonb)
 RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE olddoc p40bj.documents%ROWTYPE; oldsource p40bj.snapshots%ROWTYPE;
        projected jsonb; fingerprint text;
BEGIN
 SELECT * INTO olddoc FROM p40bj.documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_DOCUMENT'; END IF;
 SELECT * INTO oldsource FROM p40bj.snapshots WHERE document_id=p_id FOR UPDATE;
 IF NOT FOUND OR oldsource.company<>olddoc.company OR oldsource.sync_version<>p_expected_version
    OR olddoc.source_version<>p_expected_version OR olddoc.revision<>p_expected_revision THEN
   RAISE EXCEPTION 'SOURCE_VERSION_CONFLICT';
 END IF;
 -- First mutate fake snapshot; any failure below MUST roll back this mutation too.
 UPDATE p40bj.snapshots SET data=p_new,sync_version=p_expected_version+1 WHERE document_id=p_id;
 IF p_new->>'target_zone'<>olddoc.target_zone OR p_new->>'company'<>olddoc.company THEN
   RAISE EXCEPTION 'WRONG_TENANT_OR_TARGET';
 END IF;
 projected:=p40bj.customer_projection(p_new);
 fingerprint:=encode(sha256(convert_to(p_new::text,'UTF8')),'hex');
 UPDATE p40bj.documents SET public_view=projected,source_digest=fingerprint,
     source_version=p_expected_version+1,revision=p_expected_revision+1,
     approved_revision=0,status='pending_review' WHERE id=p_id;
 INSERT INTO p40bj.audit_events(document_id,source_version,revision,source_digest)
 VALUES(p_id,p_expected_version+1,p_expected_revision+1,fingerprint);
 RETURN p_expected_revision+1;
END $$;
REVOKE ALL ON FUNCTION p40bj.commit_fake_snapshot(uuid,bigint,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40bj.commit_fake_snapshot(uuid,bigint,integer,jsonb) TO p40bj_writer;

-- Fake fixtures; all private strings are sentinels, not personal or production data.
INSERT INTO p40bj.memberships VALUES
 ('FAKE_A','fake_owner_A','owner',true),('FAKE_A','fake_accountant_A','accounting',true),
 ('FAKE_A','fake_employee_A','employee',true),('FAKE_A','fake_revoked_A','owner',false),
 ('FAKE_B','fake_owner_B','owner',true);
INSERT INTO p40bj.sessions VALUES
 ('fake_owner_A','session_A',true),('fake_accountant_A','session_acct',true),
 ('fake_employee_A','session_emp',true),('fake_revoked_A','session_revoked',false),
 ('fake_owner_B','session_B',true);
INSERT INTO p40bj.document_acl VALUES
 ('00000000-0000-4000-8000-0000000000a1','fake_owner_A',true),
 ('00000000-0000-4000-8000-0000000000a2','fake_accountant_A',true),
 ('00000000-0000-4000-8000-0000000000a1','fake_employee_A',true),
 ('00000000-0000-4000-8000-0000000000b1','fake_owner_B',true),
 ('00000000-0000-4000-8000-0000000000a1','fake_revoked_A',true);
INSERT INTO p40bj.snapshots VALUES
 ('00000000-0000-4000-8000-0000000000a1','FAKE_A',1,
 '{"company":"FAKE_A","target_zone":"FAKE_ZONE_A","display_project":"Fake site A","public_note":"For customer","reviewed_public_note":true,"gross_total":10500,"public_lines":[{"house":"A1","item":"Fake work","unit":"m2","qty":2,"price":5000,"amount":10000}],"other_zone":"PRIVATE_OTHER_ZONE","sourceInvoices":["PRIVATE_INVOICE"],"staffSalary":"PRIVATE_PAYROLL","bankAccount":"PRIVATE_BANK","internalReason":"PRIVATE_REVIEW"}'),
 ('00000000-0000-4000-8000-0000000000a2','FAKE_A',1,
 '{"company":"FAKE_A","target_zone":"FAKE_ZONE_A2","display_project":"Fake site A2","public_note":"For customer","reviewed_public_note":true,"gross_total":2500,"public_lines":[{"house":"2","item":"Fake repair","unit":"m2","qty":1,"price":2500,"amount":2500}],"staffSalary":"PRIVATE_PAYROLL"}'),
 ('00000000-0000-4000-8000-0000000000b1','FAKE_B',1,
 '{"company":"FAKE_B","target_zone":"FAKE_ZONE_B","display_project":"Fake site B","public_note":"For customer","reviewed_public_note":true,"gross_total":3000,"public_lines":[{"house":"B1","item":"Fake work","unit":"m2","qty":1,"price":3000,"amount":3000}],"other_zone":"PRIVATE_OTHER_ZONE"}');
INSERT INTO p40bj.documents
 SELECT document_id,company,data->>'target_zone',1,1,1,'approved',
 encode(sha256(convert_to(data::text,'UTF8')),'hex'),p40bj.customer_projection(data) FROM p40bj.snapshots;
\echo 'P40BJ_SETUP_FAKE_ONLY_COMPLETE'
