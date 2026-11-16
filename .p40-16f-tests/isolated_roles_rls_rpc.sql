-- P40-16F: disposable GitHub Actions PostgreSQL ONLY; NEVER deploy to Supabase.
-- Fake tenants + explicitly granted least-privilege SQL roles; no real ERP records.
CREATE ROLE p40f_company_a LOGIN PASSWORD 'synthetic-a-ci-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE p40f_company_b LOGIN PASSWORD 'synthetic-b-ci-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE p40f_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE SCHEMA p40_16f_lab;
REVOKE ALL ON SCHEMA p40_16f_lab FROM PUBLIC;
GRANT USAGE ON SCHEMA p40_16f_lab TO p40f_company_a,p40f_company_b,p40f_executor;

CREATE TABLE p40_16f_lab.fake_documents(
    document_id text PRIMARY KEY CHECK(length(document_id) BETWEEN 2 AND 120),
    tenant_id text NOT NULL CHECK(tenant_id IN ('SYNTH-A','SYNTH-B')),
    revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
    snapshot_token text NOT NULL CHECK(length(snapshot_token)>=2),
    gross_total bigint NOT NULL CHECK(gross_total>0),
    UNIQUE(document_id,tenant_id)
);
CREATE TABLE p40_16f_lab.fake_sources(
    document_id text NOT NULL,
    tenant_id text NOT NULL,
    source_id text NOT NULL CHECK(length(source_id)>=2),
    untaxed bigint NOT NULL CHECK(untaxed>=0),
    tax bigint NOT NULL CHECK(tax>=0),
    gross_total bigint NOT NULL CHECK(gross_total=untaxed+tax AND gross_total>0),
    retention bigint NOT NULL DEFAULT 0 CHECK(retention>=0),
    receivable bigint NOT NULL CHECK(receivable=gross_total-retention),
    invoice_state text NOT NULL CHECK(invoice_state IN('pending','issued')),
    received bigint NOT NULL DEFAULT 0 CHECK(received>=0 AND received<=receivable),
    retention_received bigint NOT NULL DEFAULT 0 CHECK(retention_received>=0 AND retention_received<=retention),
    cheque_reserved bigint NOT NULL DEFAULT 0 CHECK(cheque_reserved>=0 AND cheque_reserved<=receivable-received),
    PRIMARY KEY(document_id,source_id),
    FOREIGN KEY(document_id,tenant_id) REFERENCES p40_16f_lab.fake_documents(document_id,tenant_id)
);
CREATE TABLE p40_16f_lab.fake_events(
    event_id text PRIMARY KEY CHECK(length(event_id)>=2),
    operation_key text UNIQUE NOT NULL CHECK(length(operation_key)>=2),
    document_id text NOT NULL,
    tenant_id text NOT NULL,
    revision bigint NOT NULL CHECK(revision>0),
    basis_snapshot text NOT NULL,
    amount_hash text NOT NULL,
    delta_untaxed bigint NOT NULL CHECK(delta_untaxed>=0),
    delta_tax bigint NOT NULL CHECK(delta_tax>=0),
    delta_gross bigint NOT NULL CHECK(delta_gross=delta_untaxed+delta_tax AND delta_gross>0),
    delta_retention bigint NOT NULL CHECK(delta_retention>=0),
    delta_receivable bigint NOT NULL CHECK(delta_receivable=delta_gross-delta_retention),
    allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array'),
    UNIQUE(document_id,revision),
    FOREIGN KEY(document_id,tenant_id) REFERENCES p40_16f_lab.fake_documents(document_id,tenant_id)
);
CREATE OR REPLACE FUNCTION p40_16f_lab.deny_fake_event_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,p40_16f_lab,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Immutable synthetic event history' USING ERRCODE='23514';
END $$;
CREATE TRIGGER event_append_only BEFORE UPDATE OR DELETE
 ON p40_16f_lab.fake_events FOR EACH ROW EXECUTE FUNCTION p40_16f_lab.deny_fake_event_changes();

ALTER TABLE p40_16f_lab.fake_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40_16f_lab.fake_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40_16f_lab.fake_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_read_docs ON p40_16f_lab.fake_documents FOR SELECT
 TO p40f_company_a,p40f_company_b USING
 (tenant_id=CASE current_user WHEN 'p40f_company_a' THEN 'SYNTH-A'
  WHEN 'p40f_company_b' THEN 'SYNTH-B' ELSE '__DENY__' END);
CREATE POLICY tenant_read_sources ON p40_16f_lab.fake_sources FOR SELECT
 TO p40f_company_a,p40f_company_b USING
 (tenant_id=CASE current_user WHEN 'p40f_company_a' THEN 'SYNTH-A'
  WHEN 'p40f_company_b' THEN 'SYNTH-B' ELSE '__DENY__' END);
CREATE POLICY tenant_read_events ON p40_16f_lab.fake_events FOR SELECT
 TO p40f_company_a,p40f_company_b USING
 (tenant_id=CASE current_user WHEN 'p40f_company_a' THEN 'SYNTH-A'
  WHEN 'p40f_company_b' THEN 'SYNTH-B' ELSE '__DENY__' END);

-- Private non-login executor has precisely the privileges needed by the protected RPC.
CREATE POLICY executor_doc ON p40_16f_lab.fake_documents FOR ALL
 TO p40f_executor USING(true) WITH CHECK(true);
CREATE POLICY executor_source ON p40_16f_lab.fake_sources FOR SELECT
 TO p40f_executor USING(true);
CREATE POLICY executor_events ON p40_16f_lab.fake_events FOR ALL
 TO p40f_executor USING(true) WITH CHECK(true);

GRANT SELECT ON p40_16f_lab.fake_documents,p40_16f_lab.fake_sources,
 p40_16f_lab.fake_events TO p40f_company_a,p40f_company_b;
GRANT SELECT ON p40_16f_lab.fake_documents,p40_16f_lab.fake_sources,
 p40_16f_lab.fake_events TO p40f_executor;
GRANT UPDATE(revision) ON p40_16f_lab.fake_documents TO p40f_executor;
GRANT INSERT ON p40_16f_lab.fake_events TO p40f_executor;

-- This is a synthetic guarded transaction, NOT an approved accounting API.
-- session_user maps to a real separate database LOGIN, not to client-editable metadata.
CREATE OR REPLACE FUNCTION p40_16f_lab.simulate_approved_adjustment(
  p_document_id text,p_event_id text,p_operation_key text,p_expected_revision bigint,
  p_expected_snapshot text,p_approved_gross bigint,p_allocations jsonb,
  p_synthetic_reviewer_confirmed boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40_16f_lab,pg_temp
AS $$
DECLARE
  trusted_tenant text;
  doc p40_16f_lab.fake_documents%ROWTYPE;
  existing p40_16f_lab.fake_events%ROWTYPE;
  s p40_16f_lab.fake_sources%ROWTYPE;
  row_data record;
  input_hash text;
  total_untaxed bigint := 0;
  total_tax bigint := 0;
  total_gross bigint := 0;
  total_retention bigint := 0;
  total_receivable bigint := 0;
  original_source_total bigint;
  source_count int;
  seen text[] := ARRAY[]::text[];
BEGIN
  trusted_tenant := CASE session_user
    WHEN 'p40f_company_a' THEN 'SYNTH-A'
    WHEN 'p40f_company_b' THEN 'SYNTH-B'
    ELSE NULL END;
  IF trusted_tenant IS NULL THEN RAISE EXCEPTION 'Unauthorized principal'; END IF;
  IF p_synthetic_reviewer_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Synthetic accountant review not acknowledged'; END IF;
  IF length(coalesce(p_document_id,''))<2 OR length(coalesce(p_event_id,''))<2
     OR length(coalesce(p_operation_key,''))<2 OR length(coalesce(p_expected_snapshot,''))<2
     OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION 'Incomplete synthetic operation identifiers';
  END IF;
  IF p_approved_gross IS NULL OR p_approved_gross<=0 OR
    jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_allocations) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Invalid synthetic approved value or allocations';
  END IF;
  SELECT * INTO doc FROM p40_16f_lab.fake_documents
   WHERE document_id=p_document_id AND tenant_id=trusted_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or unauthorized document'; END IF;
  IF doc.snapshot_token<>p_expected_snapshot THEN
    RAISE EXCEPTION 'Stale source document snapshot'; END IF;

  input_hash := md5(jsonb_build_object('doc',p_document_id,'event',p_event_id,
    'snapshot',p_expected_snapshot,'approved',p_approved_gross,'sources',p_allocations)::text);
  SELECT * INTO existing FROM p40_16f_lab.fake_events
   WHERE operation_key=p_operation_key;
  IF FOUND THEN
    IF existing.document_id<>p_document_id OR existing.tenant_id<>trusted_tenant OR
       existing.event_id<>p_event_id OR existing.amount_hash<>input_hash THEN
      RAISE EXCEPTION 'Conflicting reuse of synthetic operation key';
    END IF;
    RETURN 'REPLAY';
  END IF;
  IF doc.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'CAS expected revision mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM p40_16f_lab.fake_events WHERE document_id=p_document_id)
    THEN RAISE EXCEPTION 'An adjustment already exists for this source document'; END IF;
  SELECT COALESCE(SUM(gross_total),0),COUNT(*) INTO original_source_total,source_count
    FROM p40_16f_lab.fake_sources
   WHERE document_id=p_document_id AND tenant_id=trusted_tenant;
  IF original_source_total<>doc.gross_total OR source_count<>jsonb_array_length(p_allocations)
    THEN RAISE EXCEPTION 'Original source total / source count mismatch'; END IF;
  FOR row_data IN
    SELECT * FROM jsonb_to_recordset(p_allocations)
      AS x(source_id text,untaxed bigint,tax bigint,gross_total bigint,
          retention bigint,receivable bigint)
  LOOP
    IF row_data.source_id IS NULL OR row_data.source_id=ANY(seen) THEN
      RAISE EXCEPTION 'Missing or duplicate original source'; END IF;
    seen := array_append(seen,row_data.source_id);
    SELECT * INTO s FROM p40_16f_lab.fake_sources
      WHERE document_id=p_document_id AND source_id=row_data.source_id
        AND tenant_id=trusted_tenant; -- Only SELECT on immutable source rows; document FOR UPDATE protects CAS.
    IF NOT FOUND OR s.invoice_state<>'pending' OR s.received<>0 OR
       s.retention_received<>0 OR s.cheque_reserved<>0 THEN
      RAISE EXCEPTION 'Source is missing, invoiced, collected or has pending cheque'; END IF;
    IF row_data.untaxed IS NULL OR row_data.tax IS NULL OR row_data.gross_total IS NULL OR
       row_data.retention IS NULL OR row_data.receivable IS NULL OR
       row_data.gross_total<=0 OR row_data.untaxed<0 OR row_data.tax<0 OR
       row_data.retention<0 OR row_data.receivable<0 OR
       row_data.untaxed+row_data.tax<>row_data.gross_total OR
       row_data.gross_total-row_data.retention<>row_data.receivable OR
       row_data.untaxed>s.untaxed OR row_data.tax>s.tax OR
       row_data.gross_total>=s.gross_total OR row_data.retention>s.retention OR
       row_data.receivable>s.receivable THEN
      RAISE EXCEPTION 'Invalid per-source manual allocation'; END IF;
    total_untaxed:=total_untaxed+row_data.untaxed;
    total_tax:=total_tax+row_data.tax;
    total_gross:=total_gross+row_data.gross_total;
    total_retention:=total_retention+row_data.retention;
    total_receivable:=total_receivable+row_data.receivable;
  END LOOP;
  IF total_untaxed+total_tax<>total_gross OR
     total_gross-total_retention<>total_receivable OR
     doc.gross_total-total_gross<>p_approved_gross THEN
    RAISE EXCEPTION 'Gross/Tax/Retention/AR reconciliation failed'; END IF;

  INSERT INTO p40_16f_lab.fake_events(event_id,operation_key,document_id,tenant_id,
    revision,basis_snapshot,amount_hash,delta_untaxed,delta_tax,delta_gross,
    delta_retention,delta_receivable,allocations)
  VALUES(p_event_id,p_operation_key,p_document_id,trusted_tenant,
    doc.revision+1,p_expected_snapshot,input_hash,total_untaxed,total_tax,total_gross,
    total_retention,total_receivable,p_allocations);
  UPDATE p40_16f_lab.fake_documents SET revision=revision+1
    WHERE document_id=p_document_id AND revision=p_expected_revision
      AND tenant_id=trusted_tenant AND snapshot_token=p_expected_snapshot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Failed atomic synthetic CAS'; END IF;
  RETURN 'SYNTHETIC_RECORDED';
END $$;
REVOKE ALL ON FUNCTION p40_16f_lab.simulate_approved_adjustment(text,text,text,bigint,text,bigint,jsonb,boolean) FROM PUBLIC;
-- Function owner is a NOLOGIN role without BYPASSRLS, rather than the CI superuser.
GRANT CREATE ON SCHEMA p40_16f_lab TO p40f_executor;
ALTER FUNCTION p40_16f_lab.simulate_approved_adjustment(text,text,text,bigint,text,bigint,jsonb,boolean) OWNER TO p40f_executor;
REVOKE CREATE ON SCHEMA p40_16f_lab FROM p40f_executor;
GRANT EXECUTE ON FUNCTION p40_16f_lab.simulate_approved_adjustment(text,text,text,bigint,text,bigint,jsonb,boolean)
 TO p40f_company_a,p40f_company_b;

CREATE VIEW p40_16f_lab.fake_ar_projection WITH (security_invoker=true) AS
SELECT d.document_id,d.tenant_id,d.gross_total,d.revision,
       COALESCE(s.original_receivable,0)::bigint AS original_receivable,
       COALESCE(e.discount_receivable,0)::bigint AS approved_reduction,
       COALESCE(s.original_receivable,0)::bigint-COALESCE(e.discount_receivable,0)::bigint AS adjusted_receivable,
       COALESCE(e.discount_tax,0)::bigint AS tax_impact_for_review,
       COALESCE(e.discount_retention,0)::bigint AS retention_impact_for_review
 FROM p40_16f_lab.fake_documents d
 LEFT JOIN LATERAL (SELECT SUM(receivable) original_receivable
   FROM p40_16f_lab.fake_sources WHERE document_id=d.document_id) s ON true
 LEFT JOIN LATERAL (SELECT SUM(delta_receivable) discount_receivable,
   SUM(delta_tax) discount_tax,SUM(delta_retention) discount_retention
   FROM p40_16f_lab.fake_events WHERE document_id=d.document_id) e ON true;
REVOKE ALL ON p40_16f_lab.fake_ar_projection FROM PUBLIC;
GRANT SELECT ON p40_16f_lab.fake_ar_projection TO p40f_company_a,p40f_company_b;
