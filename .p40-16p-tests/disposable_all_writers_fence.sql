-- P40-16P - ONE-TIME POSTGRES 16 CI LAB. NOT A SUPABASE MIGRATION.
-- There is intentionally ONE fictitious tenant. This lab DOES NOT test
-- Supabase's shared authenticated DB role / verified auth.uid() mapping.
-- Do not run against any existing database with real records.
CREATE ROLE p40p_client LOGIN PASSWORD 'synthetic-client-ci-only'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA p40p_lab AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA p40p_lab FROM PUBLIC;

CREATE TABLE p40p_lab.fake_snapshot(
    tenant text PRIMARY KEY CHECK(tenant='SYNTH-OWNER-P40P'),
    sync_version bigint NOT NULL CHECK(sync_version>=1),
    ledger_version bigint NOT NULL CHECK(ledger_version>=0),
    mode text NOT NULL CHECK(mode IN ('legacy_compatible','guarded')),
    data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE p40p_lab.fake_events(
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant text NOT NULL REFERENCES p40p_lab.fake_snapshot(tenant),
    operation_key text NOT NULL CHECK(operation_key LIKE 'SYNTH-%'),
    kind text NOT NULL CHECK(kind IN ('discount','reversal')),
    amount integer NOT NULL CHECK(amount>0),
    reverses_key text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant,operation_key),
    CHECK ((kind='reversal')=(reverses_key IS NOT NULL))
);
CREATE UNIQUE INDEX p40p_one_reversal_per_event
    ON p40p_lab.fake_events(tenant,reverses_key)
    WHERE reverses_key IS NOT NULL;

INSERT INTO p40p_lab.fake_snapshot(
  tenant,sync_version,ledger_version,mode,data
) VALUES (
  'SYNTH-OWNER-P40P',1,0,'legacy_compatible',
  '{"original":{"documentId":"SYNTH-BILLING-P40P","gross":632100,"sourceIds":["SYNTH-A","SYNTH-B"]},"financialProjection":{"gross":632100},"ui":{"note":"baseline"}}'::jsonb
);
-- Grants are purposefully limited to synthetic SELECT + two RPC entrypoints.
-- No direct table DML, no event insert/update, no event-posting RPC.
ALTER TABLE p40p_lab.fake_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE p40p_lab.fake_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_single_tenant_read ON p40p_lab.fake_snapshot
  FOR SELECT TO p40p_client USING (tenant='SYNTH-OWNER-P40P');
REVOKE ALL ON ALL TABLES IN SCHEMA p40p_lab FROM PUBLIC, p40p_client;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA p40p_lab FROM PUBLIC, p40p_client;
GRANT USAGE ON SCHEMA p40p_lab TO p40p_client;
GRANT SELECT ON p40p_lab.fake_snapshot TO p40p_client;

-- This synthetic client's only permitted data changes are its nonfinancial UI
-- note. The live ERP currently allows many more business changes; a real
-- migration must replace/authorize ALL those operations before any rollout.
CREATE FUNCTION p40p_lab.validate_client_snapshot(
  p_old jsonb, p_new jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40p_lab,pg_temp AS $$
BEGIN
 IF p_new IS NULL
    OR jsonb_typeof(p_new) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_new->'ui') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_new->'ui'->'note') IS DISTINCT FROM 'string'
    OR (p_new->'ui') - 'note' <> '{}'::jsonb
    OR (p_new - 'ui') IS DISTINCT FROM (p_old - 'ui')
    THEN RAISE EXCEPTION 'SYNTHETIC_FINANCIAL_OR_STRUCTURE_MUTATION_BLOCKED';
 END IF;
END $$;

-- Legacy adapter deliberately remains permitted ONLY before sealing.
-- Once guarded, even a correct syncVersion cannot permit legacy uploads.
CREATE FUNCTION p40p_lab.legacy_sync(
  p_tenant text, p_expected_sync bigint, p_new_data jsonb
) RETURNS TABLE(outcome text,new_sync bigint,new_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40p_lab,pg_temp AS $$
DECLARE s p40p_lab.fake_snapshot%ROWTYPE;
BEGIN
 IF p_tenant IS DISTINCT FROM 'SYNTH-OWNER-P40P'
    THEN RAISE EXCEPTION 'SYNTHETIC_TENANT_BLOCKED';END IF;
 SELECT * INTO STRICT s FROM p40p_lab.fake_snapshot
    WHERE tenant=p_tenant FOR UPDATE;
 IF s.mode='guarded' THEN
   RETURN QUERY SELECT 'UPGRADE_REQUIRED'::text,s.sync_version,s.ledger_version;
   RETURN;
 END IF;
 IF p_expected_sync IS DISTINCT FROM s.sync_version THEN
   RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version;
   RETURN;
 END IF;
 PERFORM p40p_lab.validate_client_snapshot(s.data,p_new_data);
 UPDATE p40p_lab.fake_snapshot
    SET data=p_new_data,sync_version=sync_version+1,updated_at=clock_timestamp()
    WHERE tenant=p_tenant
    RETURNING * INTO s;
 RETURN QUERY SELECT 'APPLIED_LEGACY'::text,s.sync_version,s.ledger_version;
END $$;

-- Modern adapter needs TWO current versions. Old clients lacking
-- expected_ledger do not have an overload for this RPC.
CREATE FUNCTION p40p_lab.fenced_sync(
  p_tenant text, p_expected_sync bigint, p_expected_ledger bigint,
  p_new_data jsonb
) RETURNS TABLE(outcome text,new_sync bigint,new_ledger bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,p40p_lab,pg_temp AS $$
DECLARE s p40p_lab.fake_snapshot%ROWTYPE;
BEGIN
 IF p_tenant IS DISTINCT FROM 'SYNTH-OWNER-P40P'
    THEN RAISE EXCEPTION 'SYNTHETIC_TENANT_BLOCKED';END IF;
 SELECT * INTO STRICT s FROM p40p_lab.fake_snapshot
    WHERE tenant=p_tenant FOR UPDATE;
 IF s.mode<>'guarded' THEN
    RETURN QUERY SELECT 'GUARD_NOT_ENABLED'::text,s.sync_version,s.ledger_version;
    RETURN;
 END IF;
 IF p_expected_sync IS DISTINCT FROM s.sync_version
    OR p_expected_ledger IS DISTINCT FROM s.ledger_version THEN
    RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version;
    RETURN;
 END IF;
 PERFORM p40p_lab.validate_client_snapshot(s.data,p_new_data);
 UPDATE p40p_lab.fake_snapshot
   SET data=p_new_data,sync_version=sync_version+1,updated_at=clock_timestamp()
   WHERE tenant=p_tenant
   RETURNING * INTO s;
 RETURN QUERY SELECT 'APPLIED_GUARDED'::text,s.sync_version,s.ledger_version;
END $$;

-- Synthetic server administrator only. Never grant to the client.
-- Guard activation is reversible only BEFORE any financial event.
-- Even in this lab, enabling the guard breaks ALL legacy write clients;
-- production deployment MUST plan a zero-downtime staged migration.
CREATE FUNCTION p40p_lab.admin_set_guard(p_guard boolean)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40p_lab,pg_temp AS $$
DECLARE s p40p_lab.fake_snapshot%ROWTYPE;
BEGIN
 SELECT * INTO STRICT s FROM p40p_lab.fake_snapshot
   WHERE tenant='SYNTH-OWNER-P40P' FOR UPDATE;
 IF p_guard IS FALSE AND s.ledger_version>0 THEN
    RAISE EXCEPTION 'GUARD_REVERSAL_AFTER_LEDGER_BLOCKED';
 END IF;
 UPDATE p40p_lab.fake_snapshot
   SET mode=CASE WHEN p_guard THEN 'guarded' ELSE 'legacy_compatible' END,
       sync_version=sync_version+1, updated_at=clock_timestamp()
   WHERE tenant=s.tenant;
 RETURN CASE WHEN p_guard THEN 'GUARD_ENABLED' ELSE 'GUARD_DISABLED_PRE_LEDGER' END;
END $$;

-- Atomic append-only discount/reversal + projection + dual revision bump.
-- Amounts are fictitious, no invoice or tax rules are implemented.
CREATE FUNCTION p40p_lab.admin_post_event(
 p_key text, p_kind text, p_amount integer, p_reverse_key text,
 p_expected_sync bigint, p_expected_ledger bigint
) RETURNS TABLE(outcome text,new_sync bigint,new_ledger bigint,new_gross integer)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,p40p_lab,pg_temp AS $$
DECLARE s p40p_lab.fake_snapshot%ROWTYPE;
        event p40p_lab.fake_events%ROWTYPE;
        base_event p40p_lab.fake_events%ROWTYPE;
        current_gross integer; updated_gross integer;
BEGIN
 IF p_key IS NULL OR p_key NOT LIKE 'SYNTH-%'
   OR p_amount IS NULL OR p_amount<=0
   OR p_kind NOT IN ('discount','reversal') THEN
   RAISE EXCEPTION 'INVALID_SYNTHETIC_EVENT';
 END IF;
 SELECT * INTO STRICT s FROM p40p_lab.fake_snapshot
   WHERE tenant='SYNTH-OWNER-P40P' FOR UPDATE;
 IF s.mode<>'guarded' THEN RAISE EXCEPTION 'LEDGER_REQUIRES_GUARD';END IF;
 SELECT * INTO event FROM p40p_lab.fake_events
   WHERE tenant=s.tenant AND operation_key=p_key;
 IF FOUND THEN
   IF event.kind IS DISTINCT FROM p_kind OR event.amount IS DISTINCT FROM p_amount
     OR event.reverses_key IS DISTINCT FROM p_reverse_key THEN
        RAISE EXCEPTION 'OPERATION_KEY_REUSED_WITH_DIFFERENT_PAYLOAD';
   END IF;
   RETURN QUERY SELECT 'DUPLICATE'::text,s.sync_version,s.ledger_version,
                         (s.data->'financialProjection'->>'gross')::integer;
   RETURN;
 END IF;
 IF p_expected_sync IS DISTINCT FROM s.sync_version OR
    p_expected_ledger IS DISTINCT FROM s.ledger_version THEN
    RETURN QUERY SELECT 'CONFLICT'::text,s.sync_version,s.ledger_version,
          (s.data->'financialProjection'->>'gross')::integer;
    RETURN;
 END IF;
 current_gross:=(s.data->'financialProjection'->>'gross')::integer;
 IF p_kind='discount' THEN
   IF p_reverse_key IS NOT NULL OR p_amount>current_gross THEN
     RAISE EXCEPTION 'BAD_DISCOUNT_OR_REVERSE_REFERENCE';
   END IF;
   updated_gross:=current_gross-p_amount;
 ELSE
   IF p_reverse_key IS NULL THEN RAISE EXCEPTION 'REVERSAL_SOURCE_REQUIRED';END IF;
   SELECT * INTO base_event FROM p40p_lab.fake_events
      WHERE tenant=s.tenant AND operation_key=p_reverse_key AND kind='discount';
   IF NOT FOUND OR base_event.amount<>p_amount THEN
      RAISE EXCEPTION 'REVERSAL_SOURCE_OR_AMOUNT_INVALID';
   END IF;
   IF EXISTS(SELECT 1 FROM p40p_lab.fake_events
      WHERE tenant=s.tenant AND reverses_key=p_reverse_key) THEN
       RAISE EXCEPTION 'ALREADY_REVERSED';
   END IF;
   updated_gross:=current_gross+p_amount;
 END IF;
 INSERT INTO p40p_lab.fake_events(tenant,operation_key,kind,amount,reverses_key)
   VALUES(s.tenant,p_key,p_kind,p_amount,p_reverse_key);
 UPDATE p40p_lab.fake_snapshot
   SET data=jsonb_set(data,'{financialProjection,gross}',to_jsonb(updated_gross),false),
       sync_version=sync_version+1,
       ledger_version=ledger_version+1,
       updated_at=clock_timestamp()
   WHERE tenant=s.tenant RETURNING * INTO s;
 RETURN QUERY SELECT 'POSTED'::text,s.sync_version,s.ledger_version,updated_gross;
END $$;

-- The next block is essential: PostgreSQL automatically grants EXECUTE on
-- newly-created functions to PUBLIC. Explicitly remove that before granting.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA p40p_lab FROM PUBLIC,p40p_client;
GRANT EXECUTE ON FUNCTION p40p_lab.legacy_sync(text,bigint,jsonb) TO p40p_client;
GRANT EXECUTE ON FUNCTION p40p_lab.fenced_sync(text,bigint,bigint,jsonb) TO p40p_client;
-- validate_client_snapshot uses SECURITY INVOKER from inside definer RPC.
-- Do not grant to p40p_client; its caller is the SQL RPC owner.
COMMENT ON SCHEMA p40p_lab IS
 'P40-16P disposable GitHub CI lab, fictional one-tenant data, NOT a real Supabase security model';
