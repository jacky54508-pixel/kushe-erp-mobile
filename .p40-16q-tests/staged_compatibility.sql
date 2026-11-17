-- P40-16Q DISPOSABLE CI PostgreSQL 16 ONLY. NOT PRODUCTION MIGRATION.
-- Fake owner, company and devices ONLY. No Supabase real JWT/roles or data.
CREATE ROLE p40q_client LOGIN PASSWORD 'synthetic-q-client-only'
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA p40q_lab AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA p40q_lab FROM PUBLIC;

CREATE TABLE p40q_lab.fake_state (
 owner text PRIMARY KEY CHECK (owner='SYNTH-Q-OWNER'),
 phase text NOT NULL CHECK (phase IN ('legacy','shadow','guarded')),
 sync_version bigint NOT NULL CHECK(sync_version>=1),
 ledger_version bigint NOT NULL CHECK(ledger_version>=0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object')
);
CREATE TABLE p40q_lab.fake_clients (
 client_id text PRIMARY KEY CHECK(client_id LIKE 'SYNTH-%'),
 generation integer NOT NULL DEFAULT 1 CHECK(generation IN (1,2)),
 pending integer NOT NULL DEFAULT 0 CHECK(pending>=0),
 backup_verified boolean NOT NULL DEFAULT false,
 last_ack_sync bigint,
 last_ack_ledger bigint
);
CREATE TABLE p40q_lab.fake_events (
 operation_key text PRIMARY KEY CHECK(operation_key LIKE 'SYNTH-%'),
 kind text NOT NULL CHECK(kind IN ('discount','reversal')),
 gross_delta integer NOT NULL CHECK(gross_delta>0),
 reversed_key text UNIQUE REFERENCES p40q_lab.fake_events(operation_key),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((kind='discount')=(reversed_key IS NULL))
);

INSERT INTO p40q_lab.fake_state VALUES(
 'SYNTH-Q-OWNER','legacy',1,0,
 '{"original":{"doc":"SYNTH-Q-BILL","gross":632100,"sourceIds":["SYNTH-A","SYNTH-B"]},
   "ledgerProjection":{"gross":632100},"ui":{"note":"base"},
   "daily":[],"projects":[],"billings":[],"receivables":[],"invoices":[],
   "receipts":[],"retentionReceipts":[],"materials":[],"payables":[],
   "payroll":[],"commissions":[],"bankTransactions":[]}'::jsonb
);
INSERT INTO p40q_lab.fake_clients(client_id) VALUES('SYNTH-PC'),('SYNTH-PHONE');

ALTER TABLE p40q_lab.fake_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40q_lab.fake_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40q_lab.fake_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY q_single_fake_owner ON p40q_lab.fake_state FOR SELECT TO p40q_client
 USING (owner='SYNTH-Q-OWNER');
REVOKE ALL ON ALL TABLES IN SCHEMA p40q_lab FROM PUBLIC,p40q_client;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA p40q_lab FROM PUBLIC,p40q_client;
GRANT USAGE ON SCHEMA p40q_lab TO p40q_client;
GRANT SELECT ON p40q_lab.fake_state TO p40q_client;

-- Protect financial projection + original and freeze EVERY financial module
-- after any synthetic ledger posting. This is NOT full feature support;
-- complete module-specific finance operations are not implemented.
CREATE FUNCTION p40q_lab.check_payload(
 previous jsonb, proposed jsonb, financial_frozen boolean
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE field text; item jsonb;
BEGIN
 IF proposed IS NULL OR jsonb_typeof(proposed) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(proposed))<>16
    OR (SELECT count(*) FROM jsonb_object_keys(proposed) AS x
        WHERE x NOT IN ('original','ledgerProjection','ui','daily',
        'projects','billings','receivables','invoices','receipts',
        'retentionReceipts','materials','payables','payroll','commissions',
        'bankTransactions','settings'))<>0
    THEN RAISE EXCEPTION 'SYNTHETIC_SCHEMA_OR_UNTRUSTED_FIELD';END IF;
 IF proposed->'original' IS DISTINCT FROM previous->'original'
    OR proposed->'ledgerProjection' IS DISTINCT FROM previous->'ledgerProjection'
    THEN RAISE EXCEPTION 'UNTRUSTED_FINANCIAL_PROJECTION';END IF;
 IF jsonb_typeof(proposed->'ui') IS DISTINCT FROM 'object'
    OR (proposed->'ui')-'note'<>'{}'::jsonb
    OR jsonb_typeof(proposed->'ui'->'note') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'INVALID_UI';END IF;
 FOREACH field IN ARRAY ARRAY['daily','projects','billings','receivables',
      'invoices','receipts','retentionReceipts','materials','payables',
      'payroll','commissions','bankTransactions'] LOOP
   IF jsonb_typeof(proposed->field) IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'INVALID_SYNTHETIC_MODULE_ARRAY: %',field;END IF;
   IF financial_frozen AND proposed->field IS DISTINCT FROM previous->field
      THEN RAISE EXCEPTION 'MODULE_WRITES_NEED_ACCOUNTING_RPC: %',field;END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(proposed->field) LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
        coalesce(item->>'id','') NOT LIKE 'SYNTH-%'
        THEN RAISE EXCEPTION 'NON_SYNTHETIC_MODULE_ITEM';END IF;
   END LOOP;
 END LOOP;
 IF jsonb_typeof(proposed->'settings') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'INVALID_SETTINGS'; END IF;
END $$;

CREATE FUNCTION p40q_lab.legacy_write(
 p_owner text,p_sync bigint,p_payload jsonb
) RETURNS TABLE(outcome text,current_sync bigint,current_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE s p40q_lab.fake_state%ROWTYPE;
BEGIN
 IF p_owner IS DISTINCT FROM 'SYNTH-Q-OWNER'
    THEN RAISE EXCEPTION 'FAKE_OWNER_ONLY';END IF;
 SELECT * INTO STRICT s FROM p40q_lab.fake_state WHERE owner=p_owner FOR UPDATE;
 IF s.phase='guarded' OR s.ledger_version<>0 THEN
    RETURN QUERY SELECT 'UPGRADE_REQUIRED'::text,s.sync_version,s.ledger_version;RETURN;
 END IF;
 IF p_sync IS DISTINCT FROM s.sync_version THEN
    RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version;RETURN;
 END IF;
 PERFORM p40q_lab.check_payload(s.snapshot,p_payload,false);
 UPDATE p40q_lab.fake_state SET snapshot=p_payload,
    sync_version=sync_version+1 WHERE owner=p_owner RETURNING * INTO s;
 RETURN QUERY SELECT 'LEGACY_APPLIED'::text,s.sync_version,s.ledger_version;
END $$;

CREATE FUNCTION p40q_lab.modern_write(
 p_owner text,p_sync bigint,p_ledger bigint,p_payload jsonb
) RETURNS TABLE(outcome text,current_sync bigint,current_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE s p40q_lab.fake_state%ROWTYPE;
BEGIN
 IF p_owner IS DISTINCT FROM 'SYNTH-Q-OWNER'
    THEN RAISE EXCEPTION 'FAKE_OWNER_ONLY';END IF;
 SELECT * INTO STRICT s FROM p40q_lab.fake_state WHERE owner=p_owner FOR UPDATE;
 IF s.phase='legacy' THEN
    RETURN QUERY SELECT 'UPGRADE_NOT_STAGED'::text,s.sync_version,s.ledger_version;RETURN;
 END IF;
 IF p_sync IS DISTINCT FROM s.sync_version OR
    p_ledger IS DISTINCT FROM s.ledger_version THEN
    RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version;RETURN;
 END IF;
 PERFORM p40q_lab.check_payload(s.snapshot,p_payload,s.ledger_version>0);
 UPDATE p40q_lab.fake_state SET snapshot=p_payload,
    sync_version=sync_version+1 WHERE owner=p_owner RETURNING * INTO s;
 RETURN QUERY SELECT 'MODERN_APPLIED'::text,s.sync_version,s.ledger_version;
END $$;

-- DO NOT expose these four admin procedures to the client. They only model
-- an out-of-band operator controlled change on disposable CI.
CREATE FUNCTION p40q_lab.admin_ack(
 p_client text,p_generation integer,p_pending integer,p_verified boolean
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE s p40q_lab.fake_state%ROWTYPE;
BEGIN
 SELECT * INTO STRICT s FROM p40q_lab.fake_state WHERE owner='SYNTH-Q-OWNER';
 UPDATE p40q_lab.fake_clients SET generation=p_generation,
  pending=p_pending, backup_verified=p_verified,
  last_ack_sync=CASE WHEN p_generation=2 THEN s.sync_version ELSE NULL END,
  last_ack_ledger=CASE WHEN p_generation=2 THEN s.ledger_version ELSE NULL END
  WHERE client_id=p_client;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_SYNTHETIC_CLIENT';END IF;
 RETURN 'CLIENT_ACK_RECORDED';
END $$;

CREATE FUNCTION p40q_lab.admin_phase(p_target text,p_operator_ack boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE s p40q_lab.fake_state%ROWTYPE;
BEGIN
 SELECT * INTO STRICT s FROM p40q_lab.fake_state WHERE owner='SYNTH-Q-OWNER' FOR UPDATE;
 IF p_target='shadow' AND s.phase='legacy' THEN
   UPDATE p40q_lab.fake_state SET phase='shadow',sync_version=sync_version+1
    WHERE owner=s.owner;
   RETURN 'SHADOW_ENABLED';
 END IF;
 IF p_target='guarded' AND s.phase='shadow' THEN
   IF NOT coalesce(p_operator_ack,false) THEN
      RAISE EXCEPTION 'OPERATOR_ACK_REQUIRED';END IF;
   IF (SELECT count(*) FROM p40q_lab.fake_clients)<2 OR
      EXISTS(SELECT 1 FROM p40q_lab.fake_clients WHERE generation<>2
        OR pending<>0 OR backup_verified IS DISTINCT FROM true
        OR last_ack_sync IS NULL OR last_ack_ledger IS DISTINCT FROM s.ledger_version)
   THEN RAISE EXCEPTION 'LEGACY_CLIENT_OR_DIRTY_DRAFT_REMAINS';END IF;
   UPDATE p40q_lab.fake_state SET phase='guarded',sync_version=sync_version+1
    WHERE owner=s.owner;
   RETURN 'GUARD_ENABLED_AFTER_DEVICE_DRAIN';
 END IF;
 IF p_target IN ('shadow','legacy') AND s.phase IN ('guarded','shadow') THEN
   IF s.ledger_version<>0 THEN RAISE EXCEPTION 'GUARD_ROLLBACK_AFTER_LEDGER_BLOCKED';END IF;
   UPDATE p40q_lab.fake_state SET phase=p_target,sync_version=sync_version+1
    WHERE owner=s.owner;
   RETURN 'PRE_LEDGER_ROLLBACK';
 END IF;
 RAISE EXCEPTION 'INVALID_PHASE_TRANSITION';
END $$;

CREATE FUNCTION p40q_lab.admin_fake_ledger(
 p_key text,p_kind text,p_amount integer,p_reverse text,
 p_sync bigint,p_ledger bigint
) RETURNS TABLE(outcome text,current_sync bigint,current_ledger bigint,current_gross bigint)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40q_lab,pg_temp AS $$
DECLARE s p40q_lab.fake_state%ROWTYPE;
        prior p40q_lab.fake_events%ROWTYPE;
        origin p40q_lab.fake_events%ROWTYPE;
        gross bigint;
BEGIN
 IF p_key IS NULL OR p_key NOT LIKE 'SYNTH-%' OR
    p_kind NOT IN ('discount','reversal') OR p_amount IS NULL OR p_amount<=0
    THEN RAISE EXCEPTION 'BAD_SYNTHETIC_EVENT';END IF;
 SELECT * INTO STRICT s FROM p40q_lab.fake_state
    WHERE owner='SYNTH-Q-OWNER' FOR UPDATE;
 IF s.phase<>'guarded' THEN RAISE EXCEPTION 'GUARD_REQUIRED';END IF;
 SELECT * INTO prior FROM p40q_lab.fake_events WHERE operation_key=p_key;
 IF FOUND THEN
   IF prior.kind IS DISTINCT FROM p_kind OR prior.gross_delta IS DISTINCT FROM p_amount
      OR prior.reversed_key IS DISTINCT FROM p_reverse THEN
       RAISE EXCEPTION 'OPERATION_KEY_REUSED';END IF;
   RETURN QUERY SELECT 'REPLAY'::text,s.sync_version,s.ledger_version,
      (s.snapshot->'ledgerProjection'->>'gross')::bigint;RETURN;
 END IF;
 IF p_sync IS DISTINCT FROM s.sync_version OR
    p_ledger IS DISTINCT FROM s.ledger_version THEN
    RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version,
      (s.snapshot->'ledgerProjection'->>'gross')::bigint;RETURN;
 END IF;
 gross:=(s.snapshot->'ledgerProjection'->>'gross')::bigint;
 IF p_kind='discount' THEN
   IF p_reverse IS NOT NULL OR p_amount>gross
      THEN RAISE EXCEPTION 'BAD_FAKE_DISCOUNT';END IF;
   gross:=gross-p_amount;
 ELSE
   SELECT * INTO origin FROM p40q_lab.fake_events
    WHERE operation_key=p_reverse AND kind='discount';
   IF NOT FOUND OR origin.gross_delta<>p_amount
      OR EXISTS(SELECT 1 FROM p40q_lab.fake_events WHERE reversed_key=p_reverse)
      THEN RAISE EXCEPTION 'INVALID_FAKE_REVERSAL';END IF;
   gross:=gross+p_amount;
 END IF;
 INSERT INTO p40q_lab.fake_events(operation_key,kind,gross_delta,reversed_key)
 VALUES(p_key,p_kind,p_amount,p_reverse);
 UPDATE p40q_lab.fake_state
 SET snapshot=jsonb_set(snapshot,'{ledgerProjection,gross}',to_jsonb(gross),false),
    sync_version=sync_version+1,ledger_version=ledger_version+1
 WHERE owner=s.owner RETURNING * INTO s;
 RETURN QUERY SELECT 'POSTED_SYNTHETIC'::text,s.sync_version,s.ledger_version,gross;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p40q_lab FROM PUBLIC,p40q_client;
GRANT EXECUTE ON FUNCTION p40q_lab.legacy_write(text,bigint,jsonb) TO p40q_client;
GRANT EXECUTE ON FUNCTION p40q_lab.modern_write(text,bigint,bigint,jsonb) TO p40q_client;
COMMENT ON SCHEMA p40q_lab IS
 'P40-16Q disposable synthetic no-downtime migration study; never deploy to ERP';
