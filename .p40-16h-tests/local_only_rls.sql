-- P40-16H: One-time GitHub Actions LOCAL PostgreSQL ONLY. NEVER Supabase migration.
-- PostgREST verifies the JWT signature BEFORE setting request.jwt.claims.
-- Direct SQL is inaccessible to clients. No financial writes or real data.
CREATE SCHEMA IF NOT EXISTS auth; -- required by GoTrue automatic migration in disposable CI only
ALTER ROLE postgres IN DATABASE p40_16h_ci SET search_path TO auth,public; -- GoTrue queries unqualified auth.identities; local test DB only
CREATE ROLE anon NOLOGIN NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
CREATE ROLE authenticator LOGIN PASSWORD 'ci-only-authenticator' NOINHERIT NOBYPASSRLS;
GRANT anon,authenticated TO authenticator;
CREATE SCHEMA p40h_ci;
REVOKE ALL ON SCHEMA p40h_ci FROM PUBLIC;
GRANT USAGE ON SCHEMA p40h_ci TO authenticated;

CREATE FUNCTION p40h_ci.jwt_sub()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE v text;
BEGIN
  v:=(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb)->>'sub';
  RETURN NULLIF(v,'')::uuid;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN RETURN NULL;
END $$;
CREATE FUNCTION p40h_ci.mfa_ok()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE claims jsonb;
BEGIN
  claims:=NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  RETURN COALESCE((claims->>'role')='authenticated'
              AND (claims->>'aal')='aal2'
              AND (claims->>'exp')::bigint>extract(epoch FROM now())::bigint,
              false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION p40h_ci.jwt_sub(),p40h_ci.mfa_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40h_ci.jwt_sub(),p40h_ci.mfa_ok() TO authenticated;

CREATE TABLE p40h_ci.fake_members (
  user_id uuid NOT NULL,
  company_id text NOT NULL,
  company_role text NOT NULL CHECK(company_role IN ('owner','admin','accounting','employee')),
  status text NOT NULL CHECK(status IN ('active','inactive')),
  PRIMARY KEY(user_id,company_id)
);
CREATE TABLE p40h_ci.fake_documents (
  document_id text PRIMARY KEY,
  company_id text NOT NULL,
  snapshot text NOT NULL,
  gross bigint NOT NULL CHECK(gross>0),
  invoice_issued boolean NOT NULL DEFAULT false,
  received bigint NOT NULL DEFAULT 0 CHECK(received>=0 AND received<=gross)
);
ALTER TABLE p40h_ci.fake_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40h_ci.fake_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_self ON p40h_ci.fake_members
  FOR SELECT TO authenticated USING (user_id=p40h_ci.jwt_sub());
CREATE POLICY owner_read ON p40h_ci.fake_documents
  FOR SELECT TO authenticated USING (
    p40h_ci.mfa_ok()
    AND (SELECT count(*) FROM p40h_ci.fake_members m
       WHERE m.user_id=p40h_ci.jwt_sub() AND m.status='active')=1
    AND EXISTS (SELECT 1 FROM p40h_ci.fake_members m
       WHERE m.user_id=p40h_ci.jwt_sub() AND m.company_id=fake_documents.company_id
         AND m.status='active' AND m.company_role IN ('owner','admin','accounting'))
  );
GRANT SELECT ON p40h_ci.fake_members,p40h_ci.fake_documents TO authenticated;

CREATE FUNCTION p40h_ci.preview_discount(p_document_id text,p_snapshot text,p_approved bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,p40h_ci,pg_temp AS $$
DECLARE d p40h_ci.fake_documents%ROWTYPE;
BEGIN
 IF NOT p40h_ci.mfa_ok() OR p40h_ci.jwt_sub() IS NULL THEN
   RETURN jsonb_build_object('status','DENIED','canPost',false,'canSave',false);
 END IF;
 SELECT * INTO d FROM p40h_ci.fake_documents WHERE document_id=p_document_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','DENIED','canPost',false,'canSave',false);END IF;
 IF d.snapshot<>p_snapshot OR p_approved IS NULL OR p_approved<=0 OR p_approved>=d.gross THEN
   RETURN jsonb_build_object('status','BLOCKED','canPost',false,'canSave',false);
 END IF;
 RETURN jsonb_build_object('status',
   CASE WHEN d.invoice_issued OR d.received>0 THEN 'REQUIRES_ACCOUNTING' ELSE 'REVIEW_ONLY' END,
   'documentId',d.document_id,'sourceVersion',d.snapshot,
   'originalGross',d.gross,'approvedGross',p_approved,'discountGross',d.gross-p_approved,
   'invoiceIssued',d.invoice_issued,'received',d.received,
   'canPost',false,'canSave',false,'readOnly',true);
END $$;
REVOKE ALL ON FUNCTION p40h_ci.preview_discount(text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40h_ci.preview_discount(text,text,bigint) TO authenticated;

INSERT INTO p40h_ci.fake_documents(document_id,company_id,snapshot,gross,invoice_issued,received) VALUES
('SYNTH-A-CLEAN','SYNTH-A','SYNTH-V1',632100,false,0),
('SYNTH-A-INVOICED','SYNTH-A','SYNTH-V2',632100,true,0),
('SYNTH-A-COLLECTED','SYNTH-A','SYNTH-V3',632100,false,25000),
('SYNTH-B-CLEAN','SYNTH-B','SYNTH-V1',632100,false,0);

COMMENT ON SCHEMA p40h_ci IS 'GitHub CI transient Supabase Auth + PostgREST JWT checks ONLY; not for production.';
