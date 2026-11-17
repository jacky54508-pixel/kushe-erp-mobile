-- P40-16G: GITHUB CI TEMPORARY POSTGRESQL ONLY, NEVER A PRODUCTION MIGRATION.
-- Simulates a trusted API gateway that has already verified a JWT and then sets
-- request.jwt.claim.*. Direct SQL callers CAN set such GUCs, so production must
-- independently prove gateway verification and restrict direct DB access.
-- Synthetic fake IDs, companies, invoices, receipts and sources only.

CREATE ROLE p40g_authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE p40g_anon NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA p40g_ci;
REVOKE ALL ON SCHEMA p40g_ci FROM PUBLIC;
GRANT USAGE ON SCHEMA p40g_ci TO p40g_authenticated,p40g_anon;

CREATE FUNCTION p40g_ci.claim_uid()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  RETURN NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
CREATE FUNCTION p40g_ci.aal2_valid()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(
    current_setting('request.jwt.claim.role',true)='authenticated'
    AND current_setting('request.jwt.claim.aal',true)='aal2'
    AND NULLIF(current_setting('request.jwt.claim.exp',true),'')::bigint
        > EXTRACT(epoch FROM now())::bigint,
    false)
$$;
REVOKE ALL ON FUNCTION p40g_ci.claim_uid() FROM PUBLIC;
REVOKE ALL ON FUNCTION p40g_ci.aal2_valid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40g_ci.claim_uid(),p40g_ci.aal2_valid() TO p40g_authenticated;

CREATE TABLE p40g_ci.fake_members(
  user_id uuid NOT NULL,
  company_id text NOT NULL,
  app_role text NOT NULL CHECK (app_role IN ('owner','admin','accounting','employee')),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,company_id)
);
CREATE TABLE p40g_ci.fake_documents(
  document_id text PRIMARY KEY,
  company_id text NOT NULL,
  snapshot_version text NOT NULL,
  gross bigint NOT NULL CHECK(gross>0),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TABLE p40g_ci.fake_sources(
  company_id text NOT NULL,
  document_id text NOT NULL REFERENCES p40g_ci.fake_documents(document_id),
  source_id text NOT NULL,
  untaxed bigint NOT NULL CHECK(untaxed>=0),
  tax bigint NOT NULL CHECK(tax>=0),
  gross bigint NOT NULL CHECK(gross=untaxed+tax AND gross>0),
  retention bigint NOT NULL DEFAULT 0 CHECK(retention>=0),
  receivable bigint NOT NULL CHECK(receivable=gross-retention),
  PRIMARY KEY (document_id,source_id)
);
CREATE TABLE p40g_ci.fake_invoices(
  company_id text NOT NULL,
  document_id text NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','issued')),
  PRIMARY KEY(document_id,source_id),
  FOREIGN KEY(document_id,source_id) REFERENCES p40g_ci.fake_sources(document_id,source_id)
);
CREATE TABLE p40g_ci.fake_receipts(
  receipt_id text PRIMARY KEY,
  company_id text NOT NULL,
  document_id text NOT NULL,
  source_id text NOT NULL,
  amount bigint NOT NULL CHECK(amount>0),
  FOREIGN KEY(document_id,source_id) REFERENCES p40g_ci.fake_sources(document_id,source_id)
);

ALTER TABLE p40g_ci.fake_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40g_ci.fake_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40g_ci.fake_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40g_ci.fake_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40g_ci.fake_receipts ENABLE ROW LEVEL SECURITY;
-- This membership table is private. The user can see their own records but
-- cannot edit roles/status. Source-of-truth is database membership, not JWT
-- app_metadata (which can be stale) and never user_metadata (client-editable).
CREATE POLICY own_memberships ON p40g_ci.fake_members FOR SELECT TO p40g_authenticated
 USING (p40g_ci.claim_uid()=user_id);
CREATE POLICY allowed_documents ON p40g_ci.fake_documents FOR SELECT TO p40g_authenticated
 USING (
   p40g_ci.aal2_valid()
   AND (SELECT count(*) FROM p40g_ci.fake_members m
        WHERE m.user_id=p40g_ci.claim_uid() AND m.status='active')=1
   AND EXISTS(SELECT 1 FROM p40g_ci.fake_members m
        WHERE m.user_id=p40g_ci.claim_uid()
          AND m.company_id=fake_documents.company_id
          AND m.status='active'
          AND m.app_role IN ('owner','admin','accounting'))
 );
CREATE POLICY source_of_visible_document ON p40g_ci.fake_sources FOR SELECT TO p40g_authenticated
 USING (EXISTS(
     SELECT 1 FROM p40g_ci.fake_documents d
     WHERE d.document_id=fake_sources.document_id AND d.company_id=fake_sources.company_id
 ));
CREATE POLICY invoice_of_visible_document ON p40g_ci.fake_invoices FOR SELECT TO p40g_authenticated
 USING (EXISTS(
     SELECT 1 FROM p40g_ci.fake_documents d
     WHERE d.document_id=fake_invoices.document_id AND d.company_id=fake_invoices.company_id
 ));
CREATE POLICY receipt_of_visible_document ON p40g_ci.fake_receipts FOR SELECT TO p40g_authenticated
 USING (EXISTS(
     SELECT 1 FROM p40g_ci.fake_documents d
     WHERE d.document_id=fake_receipts.document_id AND d.company_id=fake_receipts.company_id
 ));
GRANT SELECT ON p40g_ci.fake_members,p40g_ci.fake_documents,p40g_ci.fake_sources,
 p40g_ci.fake_invoices,p40g_ci.fake_receipts TO p40g_authenticated;
-- Neither anon nor authenticated has INSERT/UPDATE/DELETE or CREATE privileges.

-- Read-only, SECURITY INVOKER: the caller's RLS policies apply even within RPC.
-- This is NOT a posting endpoint; no event, bank, payroll or invoice updates.
CREATE FUNCTION p40g_ci.preview_discount(
  p_document_id text,p_expected_snapshot text,p_approved_gross bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,p40g_ci,pg_temp AS $$
DECLARE d p40g_ci.fake_documents%ROWTYPE;
  gross_sum bigint;retention_sum bigint;ar_sum bigint;source_count integer;
  issued_count integer;receipt_total bigint;
BEGIN
  IF p40g_ci.claim_uid() IS NULL OR NOT p40g_ci.aal2_valid() THEN
    RETURN jsonb_build_object('status','DENIED','canPost',false,'canSave',false);
  END IF;
  SELECT * INTO d FROM p40g_ci.fake_documents WHERE document_id=p_document_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','DENIED','canPost',false,'canSave',false);
  END IF;
  IF d.snapshot_version IS DISTINCT FROM p_expected_snapshot OR
     p_approved_gross IS NULL OR p_approved_gross<=0 OR p_approved_gross>=d.gross THEN
    RETURN jsonb_build_object('status','BLOCKED','reason','STALE_OR_AMOUNT',
      'canPost',false,'canSave',false);
  END IF;
  SELECT COALESCE(SUM(gross),0),COALESCE(SUM(retention),0),
       COALESCE(SUM(receivable),0),COUNT(*)
    INTO gross_sum,retention_sum,ar_sum,source_count
    FROM p40g_ci.fake_sources
    WHERE document_id=p_document_id AND company_id=d.company_id;
  IF source_count=0 OR gross_sum<>d.gross OR ar_sum<>gross_sum-retention_sum THEN
    RETURN jsonb_build_object('status','BLOCKED','reason','SOURCE_MISMATCH',
      'canPost',false,'canSave',false);
  END IF;
  SELECT COUNT(*) INTO issued_count FROM p40g_ci.fake_invoices
   WHERE document_id=p_document_id AND company_id=d.company_id AND status='issued';
  SELECT COALESCE(SUM(amount),0) INTO receipt_total FROM p40g_ci.fake_receipts
   WHERE document_id=p_document_id AND company_id=d.company_id;
  RETURN jsonb_build_object(
    'status',CASE WHEN issued_count>0 OR receipt_total>0 THEN 'REQUIRES_ACCOUNTING' ELSE 'REVIEW_ONLY' END,
    'readOnly',true,'canPost',false,'canSave',false,'documentId',d.document_id,
    'revision',d.revision,'sourceCount',source_count,'originalGross',d.gross,
    'approvedGross',p_approved_gross,'grossDiscount',d.gross-p_approved_gross,
    'issuedCount',issued_count,'receiptTotal',receipt_total,
    'retentionBefore',retention_sum,'receivableBefore',ar_sum,
    'taxResolution','UNVERIFIED','payrollImpact','UNCHANGED'
  );
END $$;
REVOKE ALL ON FUNCTION p40g_ci.preview_discount(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40g_ci.preview_discount(text,text,bigint) TO p40g_authenticated;

CREATE VIEW p40g_ci.fake_ar_summary WITH(security_invoker=true) AS
 SELECT d.document_id,d.company_id,d.gross,d.snapshot_version,
       COALESCE(s.ar,0)::bigint AS original_ar,
       COALESCE(r.received,0)::bigint AS original_received,
       COALESCE(s.ar,0)::bigint-COALESCE(r.received,0)::bigint AS open_ar
 FROM p40g_ci.fake_documents d
 LEFT JOIN LATERAL (SELECT SUM(receivable) ar FROM p40g_ci.fake_sources s
                    WHERE s.document_id=d.document_id AND s.company_id=d.company_id) s ON true
 LEFT JOIN LATERAL (SELECT SUM(amount) received FROM p40g_ci.fake_receipts r
                    WHERE r.document_id=d.document_id AND r.company_id=d.company_id) r ON true;
REVOKE ALL ON p40g_ci.fake_ar_summary FROM PUBLIC;
GRANT SELECT ON p40g_ci.fake_ar_summary TO p40g_authenticated;
COMMENT ON SCHEMA p40g_ci IS 'SIMULATED gateway only, JWT validation NOT demonstrated. No production use.';
