-- P40-16AU. ISOLATED EPHEMERAL POSTGRES CI CONTAINER ONLY.
-- NEVER execute on Supabase production, beta, or any persistent database.
-- This is a PROPOSED document-scoped data model, NOT an existing ERP schema.
-- No ERP snapshot, authentic project, invoice, banking, payroll or other data.
-- JWT claims below are SIMULATED by local SET; this test does not verify
-- JWT cryptographic signatures, issuer, expiry, session or MFA authenticity.
\set ON_ERROR_STOP on

CREATE SCHEMA p40au_lab;
REVOKE ALL ON SCHEMA p40au_lab FROM PUBLIC;
CREATE ROLE p40au_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE FUNCTION p40au_lab.fake_subject() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION p40au_lab.fake_aal2() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT coalesce(pg_catalog.current_setting('request.jwt.claim.aal',true)='aal2',false) $$;

CREATE TABLE p40au_lab.memberships (
 company_id uuid NOT NULL,
 user_id uuid NOT NULL,
 membership_role text NOT NULL CHECK(membership_role IN ('owner','admin','accounting','employee')),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,user_id)
);
CREATE TABLE p40au_lab.public_documents (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL,
 target_billing_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>=1),
 status text NOT NULL CHECK(status IN ('active','archived')),
 -- This column stores ONLY a previously reviewed customer-facing projection.
 -- The authorized producer/sync/ingestion pipeline is NOT implemented here.
 public_view jsonb NOT NULL CHECK(
   jsonb_typeof(public_view)='object'
   AND (public_view->>'schema')='kushe-external-document-v1'
   AND (public_view->>'documentType')='billing'
   AND (public_view->>'isMergedExternalBilling')='true'
   AND NOT (public_view ?| ARRAY[
      'sourceSnapshots','invoiceNo','invoiceDate',
      'sourceInvoiceReferences','salary','bankTransactions',
      'payroll','employeeCommissions','auth','erp_states','data'
   ])
 ),
 UNIQUE(company_id,id,target_billing_id)
);
CREATE TABLE p40au_lab.document_acl (
 document_id uuid NOT NULL REFERENCES p40au_lab.public_documents(id),
 user_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(document_id,user_id)
);

ALTER TABLE p40au_lab.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40au_lab.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE p40au_lab.public_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40au_lab.public_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE p40au_lab.document_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40au_lab.document_acl FORCE ROW LEVEL SECURITY;

CREATE POLICY member_reads_only_self
 ON p40au_lab.memberships FOR SELECT TO p40au_reader
 USING (user_id=(SELECT p40au_lab.fake_subject())
        AND (SELECT p40au_lab.fake_aal2()) AND active);
CREATE POLICY document_acl_reads_only_self
 ON p40au_lab.document_acl FOR SELECT TO p40au_reader
 USING (user_id=(SELECT p40au_lab.fake_subject())
        AND (SELECT p40au_lab.fake_aal2()) AND active);
CREATE POLICY approved_document_member_and_acl
 ON p40au_lab.public_documents FOR SELECT TO p40au_reader
 USING (
  status='active'
  AND (SELECT p40au_lab.fake_aal2())
  AND (SELECT p40au_lab.fake_subject()) IS NOT NULL
  AND EXISTS (
   SELECT 1 FROM p40au_lab.memberships m
   WHERE m.company_id=public_documents.company_id
     AND m.user_id=(SELECT p40au_lab.fake_subject())
     AND m.membership_role IN ('owner','admin','accounting')
     AND m.active
  )
  AND EXISTS (
   SELECT 1 FROM p40au_lab.document_acl dacl
   WHERE dacl.document_id=public_documents.id
     AND dacl.user_id=(SELECT p40au_lab.fake_subject())
     AND dacl.active
  )
 );

-- One DOCUMENT ID + target original bill + expected revision is required.
-- SECURITY INVOKER means the caller's RLS remains in force.
-- The caller has no separate "read entire ERP snapshot" capability because
-- that table is intentionally absent in this EPHEMERAL schema.
CREATE FUNCTION p40au_lab.read_one_customer_pdf(
 requested_document_id uuid,
 requested_target_billing_id text,
 requested_revision bigint
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog
AS $$
 SELECT doc.public_view
 FROM p40au_lab.public_documents AS doc
 WHERE doc.id=requested_document_id
   AND doc.target_billing_id=requested_target_billing_id
   AND doc.revision=requested_revision
   AND doc.status='active'
 LIMIT 1
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA p40au_lab FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p40au_lab FROM PUBLIC;
GRANT USAGE ON SCHEMA p40au_lab TO p40au_reader;
GRANT SELECT ON p40au_lab.memberships,p40au_lab.document_acl,
 p40au_lab.public_documents TO p40au_reader;
GRANT EXECUTE ON FUNCTION p40au_lab.fake_subject() TO p40au_reader;
GRANT EXECUTE ON FUNCTION p40au_lab.fake_aal2() TO p40au_reader;
GRANT EXECUTE ON FUNCTION p40au_lab.read_one_customer_pdf(uuid,text,bigint) TO p40au_reader;

-- ALL test values are fictional, created only in the throwaway CI database.
INSERT INTO p40au_lab.memberships(company_id,user_id,membership_role,active) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','owner',true),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','accounting',true),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','employee',true),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','owner',true),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','owner',true),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','admin',false);

INSERT INTO p40au_lab.public_documents(
 id,company_id,target_billing_id,revision,status,public_view
) VALUES
 (
 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
 '11111111-1111-4111-8111-111111111111','FAKE-BILL-M',3,'active',
 jsonb_build_object(
 'schema','kushe-external-document-v1',
 'documentType','billing','isMergedExternalBilling',true,
 'project','FAKE-M-ZONE','mergedBillingProjects',jsonb_build_array('FAKE-M-ZONE'),
 'customer','FAKE-CUSTOMER-A','number','',
 'lines',jsonb_build_array(
   jsonb_build_object('house','1A','item','FAKE-DOOR','qty',1,'unit','式','amount',100),
   jsonb_build_object('house','2A','item','FAKE-WALL','qty',1,'unit','式','amount',200)
 ),
 'salesAmount',300,'taxAmount',15,'totalAmount',315,
 'retentionAmount',15,'receivableAmount',300,'publicNote','FAKE-NOTE'
 )
 ),
 (
 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
 '11111111-1111-4111-8111-111111111111','FAKE-BILL-K',5,'active',
 jsonb_build_object('schema','kushe-external-document-v1',
 'documentType','billing','isMergedExternalBilling',true,
 'project','FAKE-K-ZONE','mergedBillingProjects',jsonb_build_array('FAKE-K-ZONE'),
 'customer','FAKE-CUSTOMER-A','number','',
 'lines',jsonb_build_array(jsonb_build_object('house','10','item','FAKE-PATCH','amount',90)),
 'salesAmount',90,'taxAmount',5,'totalAmount',95,'retentionAmount',0,'receivableAmount',95)
 ),
 (
 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
 '22222222-2222-4222-8222-222222222222','FAKE-BILL-OTHER',8,'active',
 jsonb_build_object('schema','kushe-external-document-v1',
 'documentType','billing','isMergedExternalBilling',true,
 'project','FAKE-OTHER-COMPANY','mergedBillingProjects',jsonb_build_array('FAKE-OTHER-COMPANY'),
 'customer','FAKE-CUSTOMER-B','number','',
 'lines',jsonb_build_array(jsonb_build_object('house','B','item','FAKE-OTHER-WORK','amount',200)),
 'salesAmount',200,'taxAmount',10,'totalAmount',210,'retentionAmount',0,'receivableAmount',210)
 ),
 (
 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
 '11111111-1111-4111-8111-111111111111','FAKE-BILL-ARCHIVED',2,'archived',
 jsonb_build_object('schema','kushe-external-document-v1',
 'documentType','billing','isMergedExternalBilling',true,
 'project','FAKE-M-ZONE','mergedBillingProjects',jsonb_build_array('FAKE-M-ZONE'),
 'customer','FAKE-CUSTOMER-A','number','',
 'lines',jsonb_build_array(jsonb_build_object('house','D','item','FAKE-ARCHIVED','amount',100)),
 'salesAmount',100,'taxAmount',5,'totalAmount',105,'retentionAmount',0,'receivableAmount',105)
 );

INSERT INTO p40au_lab.document_acl(document_id,user_id,active) VALUES
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',true),
 ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true);

-- The fixture "fake_subject" GUC can be set manually inside a test DB.
-- Thus PASS is NOT a real JWT signature, MFA or production RLS audit.
