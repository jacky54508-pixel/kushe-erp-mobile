-- P40-16J — DISPOSABLE CI PostgreSQL ONLY: no Supabase migration.
-- This private, synthetic schema models JSONB full-snapshot sync vs append-only
-- financial events to test a fail-closed architecture, NOT real accounting.
CREATE SCHEMA p40j_ci;
REVOKE ALL ON SCHEMA p40j_ci FROM PUBLIC;
CREATE ROLE p40j_client NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE p40j_operator NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA p40j_ci TO p40j_client,p40j_operator;

CREATE TABLE p40j_ci.fake_snapshots (
 document_id text PRIMARY KEY CHECK (document_id LIKE 'SYNTH-%'),
 data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
 sync_version bigint NOT NULL DEFAULT 1 CHECK (sync_version>=1),
 ledger_version bigint NOT NULL DEFAULT 0 CHECK (ledger_version>=0)
);
CREATE TABLE p40j_ci.fake_ledger (
 event_id text PRIMARY KEY CHECK (event_id LIKE 'SYNTH-%'),
 operation_key text NOT NULL UNIQUE CHECK (operation_key LIKE 'SYNTH-%'),
 document_id text NOT NULL REFERENCES p40j_ci.fake_snapshots(document_id),
 event_revision bigint NOT NULL CHECK(event_revision>=1),
 event_kind text NOT NULL CHECK(event_kind IN ('SIMULATED_ALLOWANCE','SIMULATED_REVERSAL')),
 reverses_event_id text UNIQUE REFERENCES p40j_ci.fake_ledger(event_id),
 gross_delta bigint NOT NULL CHECK(gross_delta>0),
 operation_fingerprint text NOT NULL CHECK(length(operation_fingerprint)=32),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,event_revision),
 CHECK ((event_kind='SIMULATED_ALLOWANCE' AND reverses_event_id IS NULL) OR
        (event_kind='SIMULATED_REVERSAL' AND reverses_event_id IS NOT NULL))
);
CREATE FUNCTION p40j_ci.immutable_history()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,p40j_ci,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Synthetic ledger is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER no_change_history BEFORE UPDATE OR DELETE ON p40j_ci.fake_ledger
 FOR EACH ROW EXECUTE FUNCTION p40j_ci.immutable_history();

CREATE VIEW p40j_ci.fake_projection WITH (security_invoker=true) AS
 SELECT s.document_id,s.sync_version,s.ledger_version,
   (s.data->'original'->>'gross')::bigint AS original_gross,
   COALESCE(sum(CASE WHEN l.event_kind='SIMULATED_ALLOWANCE' THEN l.gross_delta
                     WHEN l.event_kind='SIMULATED_REVERSAL' THEN -l.gross_delta
                     ELSE 0 END),0)::bigint AS net_discount,
   (s.data->'original'->>'gross')::bigint -
     COALESCE(sum(CASE WHEN l.event_kind='SIMULATED_ALLOWANCE' THEN l.gross_delta
                       WHEN l.event_kind='SIMULATED_REVERSAL' THEN -l.gross_delta
                       ELSE 0 END),0)::bigint AS projected_gross,
   count(l.event_id)::bigint AS event_count
 FROM p40j_ci.fake_snapshots s LEFT JOIN p40j_ci.fake_ledger l
 ON l.document_id=s.document_id
 GROUP BY s.document_id,s.sync_version,s.ledger_version,s.data;
GRANT SELECT ON p40j_ci.fake_snapshots,p40j_ci.fake_ledger,p40j_ci.fake_projection
 TO p40j_client,p40j_operator;

-- This is a controlled SYNTHETIC version-aware sync demonstration.
-- It accepts only two JSONB keys: original and ui. Original never mutates.
-- Any financial cache, direct effective-AR edit, or changed original is denied.
CREATE FUNCTION p40j_ci.safe_snapshot_sync(
 p_document text,p_expected_sync bigint,p_expected_ledger bigint,p_new_data jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40j_ci,pg_temp AS $$
DECLARE s p40j_ci.fake_snapshots%ROWTYPE;
BEGIN
 SELECT * INTO s FROM p40j_ci.fake_snapshots WHERE document_id=p_document FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown synthetic document';END IF;
 IF p_expected_sync IS DISTINCT FROM s.sync_version OR
    p_expected_ledger IS DISTINCT FROM s.ledger_version THEN
    RAISE EXCEPTION 'Snapshot/ledger CAS stale'; END IF;
 IF jsonb_typeof(p_new_data) IS DISTINCT FROM 'object' OR
   (SELECT count(*) FROM jsonb_object_keys(p_new_data) AS k WHERE k NOT IN ('original','ui'))<>0 OR
   (SELECT count(*) FROM jsonb_object_keys(p_new_data))<>2 OR
   p_new_data->'original' IS DISTINCT FROM s.data->'original' OR
   jsonb_typeof(p_new_data->'ui') IS DISTINCT FROM 'object' OR
   (SELECT count(*) FROM jsonb_object_keys(p_new_data->'ui') AS k WHERE k<>'note')<>0 OR
   jsonb_typeof(p_new_data->'ui'->'note') IS DISTINCT FROM 'string' THEN
     RAISE EXCEPTION 'Immutable original or untrusted finance projection in JSONB';
 END IF;
 UPDATE p40j_ci.fake_snapshots SET data=p_new_data,sync_version=sync_version+1
 WHERE document_id=p_document AND sync_version=p_expected_sync
   AND ledger_version=p_expected_ledger;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sync CAS lost';END IF;
 RETURN 'SYNTHETIC_SYNCED';
END $$;

-- Never exposed to a browser or actual authenticated roles. For CI only,
-- only a synthetic operator role may invoke this (untrusted client role may not).
CREATE FUNCTION p40j_ci.simulate_allowance(
 p_document text,p_expected_sync bigint,p_expected_ledger bigint,
 p_event text,p_op text,p_gross_discount bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40j_ci,pg_temp AS $$
DECLARE s p40j_ci.fake_snapshots%ROWTYPE;
 prior p40j_ci.fake_ledger%ROWTYPE;
 fp text;
 origin_gross bigint;
BEGIN
 IF p_gross_discount IS NULL OR p_gross_discount<=0 OR
    p_event NOT LIKE 'SYNTH-%' OR p_op NOT LIKE 'SYNTH-%' THEN
    RAISE EXCEPTION 'Invalid synthetic event'; END IF;
 SELECT * INTO s FROM p40j_ci.fake_snapshots
 WHERE document_id=p_document FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown synthetic document';END IF;
 fp:=md5(jsonb_build_object('doc',p_document,'event',p_event,'gross',p_gross_discount)::text);
 SELECT * INTO prior FROM p40j_ci.fake_ledger WHERE operation_key=p_op;
 IF FOUND THEN
    IF prior.event_id<>p_event OR prior.document_id<>p_document OR
       prior.event_kind<>'SIMULATED_ALLOWANCE' OR prior.operation_fingerprint<>fp THEN
       RAISE EXCEPTION 'Same idempotency key, changed event payload'; END IF;
    RETURN 'REPLAY';
 END IF;
 IF s.sync_version IS DISTINCT FROM p_expected_sync OR
    s.ledger_version IS DISTINCT FROM p_expected_ledger THEN
    RAISE EXCEPTION 'Allowance CAS stale'; END IF;
 origin_gross:=(s.data->'original'->>'gross')::bigint;
 IF p_gross_discount>=origin_gross THEN
    RAISE EXCEPTION 'Discount exceeds original gross';END IF;
 IF EXISTS(SELECT 1 FROM p40j_ci.fake_ledger
       WHERE document_id=p_document) THEN
    RAISE EXCEPTION 'History exists; require independent accounting review';END IF;
 INSERT INTO p40j_ci.fake_ledger
 (event_id,operation_key,document_id,event_revision,event_kind,
   gross_delta,operation_fingerprint)
 VALUES(p_event,p_op,p_document,s.ledger_version+1,'SIMULATED_ALLOWANCE',
        p_gross_discount,fp);
 UPDATE p40j_ci.fake_snapshots
 SET ledger_version=ledger_version+1
 WHERE document_id=p_document AND ledger_version=p_expected_ledger;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ledger CAS failed';END IF;
 RETURN 'SIMULATED_ALLOWANCE_APPENDED';
END $$;
CREATE FUNCTION p40j_ci.simulate_reversal(
 p_document text,p_expected_sync bigint,p_expected_ledger bigint,
 p_parent text,p_event text,p_op text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40j_ci,pg_temp AS $$
DECLARE s p40j_ci.fake_snapshots%ROWTYPE;
 prior p40j_ci.fake_ledger%ROWTYPE;
 parent p40j_ci.fake_ledger%ROWTYPE;
 fp text;
BEGIN
 IF p_event NOT LIKE 'SYNTH-%' OR p_op NOT LIKE 'SYNTH-%' THEN
    RAISE EXCEPTION 'Invalid synthetic reversal';END IF;
 SELECT * INTO s FROM p40j_ci.fake_snapshots
 WHERE document_id=p_document FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown synthetic document';END IF;
 fp:=md5(jsonb_build_object('doc',p_document,'event',p_event,'parent',p_parent)::text);
 SELECT * INTO prior FROM p40j_ci.fake_ledger WHERE operation_key=p_op;
 IF FOUND THEN
    IF prior.event_id<>p_event OR prior.document_id<>p_document OR
       prior.event_kind<>'SIMULATED_REVERSAL' OR prior.operation_fingerprint<>fp THEN
       RAISE EXCEPTION 'Same idempotency key, changed reversal payload';END IF;
    RETURN 'REPLAY';
 END IF;
 IF s.sync_version IS DISTINCT FROM p_expected_sync OR
    s.ledger_version IS DISTINCT FROM p_expected_ledger THEN
    RAISE EXCEPTION 'Reversal CAS stale';END IF;
 SELECT * INTO parent FROM p40j_ci.fake_ledger
 WHERE event_id=p_parent AND document_id=p_document
   AND event_kind='SIMULATED_ALLOWANCE';
 IF NOT FOUND THEN RAISE EXCEPTION 'Original allowance not found'; END IF;
 IF EXISTS(SELECT 1 FROM p40j_ci.fake_ledger WHERE reverses_event_id=p_parent)
   THEN RAISE EXCEPTION 'Already reversed';END IF;
 INSERT INTO p40j_ci.fake_ledger
 (event_id,operation_key,document_id,event_revision,event_kind,
  reverses_event_id,gross_delta,operation_fingerprint)
 VALUES(p_event,p_op,p_document,s.ledger_version+1,'SIMULATED_REVERSAL',
        p_parent,parent.gross_delta,fp);
 UPDATE p40j_ci.fake_snapshots
 SET ledger_version=ledger_version+1
 WHERE document_id=p_document AND ledger_version=p_expected_ledger;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reversal CAS failed';END IF;
 RETURN 'SIMULATED_REVERSAL_APPENDED';
END $$;
REVOKE ALL ON FUNCTION p40j_ci.safe_snapshot_sync(text,bigint,bigint,jsonb),
 p40j_ci.simulate_allowance(text,bigint,bigint,text,text,bigint),
 p40j_ci.simulate_reversal(text,bigint,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION p40j_ci.safe_snapshot_sync(text,bigint,bigint,jsonb)
 TO p40j_client;
GRANT EXECUTE ON FUNCTION p40j_ci.simulate_allowance(text,bigint,bigint,text,text,bigint),
 p40j_ci.simulate_reversal(text,bigint,bigint,text,text,text) TO p40j_operator;

INSERT INTO p40j_ci.fake_snapshots(document_id,data,sync_version,ledger_version) VALUES
('SYNTH-MERGED-A',
 '{"original":{"untaxed":602000,"tax":30100,"gross":632100,"retention":0,"receivable":632100},"ui":{"note":"synthetic baseline"}}'::jsonb,1,0),
('SYNTH-MERGED-B',
 '{"original":{"untaxed":400000,"tax":20000,"gross":420000,"retention":0,"receivable":420000},"ui":{"note":"second synthetic document"}}'::jsonb,1,0);
COMMENT ON SCHEMA p40j_ci IS 'P40-16J CI disposable: NO use for actual Supabase, never legal accounting';
