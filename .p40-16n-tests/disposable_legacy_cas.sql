-- P40-16N: CI-only synthetic PostgreSQL, NOT a Supabase migration.
-- This is a limited emulation of the pre-existing erp_state_cas_write_v2 shape.
-- All tables are confined to p40n_ci in one disposable GitHub runner database.
CREATE SCHEMA p40n_ci;
REVOKE ALL ON SCHEMA p40n_ci FROM PUBLIC;
CREATE TABLE p40n_ci.fake_erp_states (
 user_id text PRIMARY KEY CHECK(user_id='SYNTH-P40N-OWNER'),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 sync_version bigint NOT NULL DEFAULT 1 CHECK(sync_version>=1),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_writer_mode text NOT NULL CHECK(last_writer_mode IN ('trusted','temporary','legacy')),
 last_base_sync_version bigint
);
CREATE TABLE p40n_ci.synthetic_ledger_fence (
 user_id text PRIMARY KEY CHECK(user_id='SYNTH-P40N-OWNER'),
 ledger_version bigint NOT NULL DEFAULT 0 CHECK(ledger_version>=0)
);
CREATE TABLE p40n_ci.synthetic_ledger_events (
 operation_key text PRIMARY KEY CHECK(operation_key LIKE 'SYNTH-%'),
 kind text NOT NULL DEFAULT 'SIMULATED_ONLY',
 inserted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO p40n_ci.synthetic_ledger_fence(user_id,ledger_version)
VALUES('SYNTH-P40N-OWNER',0);
-- The function purposefully matches legacy CAS: only sync_version,
-- not future ledger_version, is fenced. This is a known RELEASE BLOCKER.
CREATE FUNCTION p40n_ci.fake_cas_write(
 p_user text,p_expected bigint,p_data jsonb,p_mode text
) RETURNS TABLE(
 status text,sync_version bigint,updated_at timestamptz,
 last_writer_mode text,last_base_sync_version bigint
)
LANGUAGE plpgsql SET search_path=pg_catalog,p40n_ci,pg_temp AS $$
DECLARE prior p40n_ci.fake_erp_states%ROWTYPE;
  applied p40n_ci.fake_erp_states%ROWTYPE;
BEGIN
 IF p_user IS DISTINCT FROM 'SYNTH-P40N-OWNER' OR
    p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR
    p_mode NOT IN ('trusted','temporary') THEN
    RAISE EXCEPTION 'SYNTHETIC_ONLY_INVALID_REQUEST';
 END IF;
 -- This disposable test MUST NOT accept actual invoice, bank, payroll data.
 IF coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_data->'billings')='array'
      THEN p_data->'billings' ELSE '[]'::jsonb END),0)>0 OR
    coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_data->'invoices')='array'
      THEN p_data->'invoices' ELSE '[]'::jsonb END),0)>0 OR
    coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_data->'payroll')='array'
      THEN p_data->'payroll' ELSE '[]'::jsonb END),0)>0 OR
    coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_data->'bankTransactions')='array'
      THEN p_data->'bankTransactions' ELSE '[]'::jsonb END),0)>0 OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_data->'customers')='array' THEN p_data->'customers'
           ELSE '[]'::jsonb END) AS c WHERE c->>'name' NOT LIKE 'SYNTH-%')
    THEN RAISE EXCEPTION 'NON_SYNTHETIC_OR_FINANCIAL_DATA_BLOCKED';
 END IF;
 SELECT * INTO prior FROM p40n_ci.fake_erp_states
   WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected IS NOT NULL THEN
   RETURN QUERY SELECT 'CONFLICT'::text,NULL::bigint,NULL::timestamptz,
     NULL::text,NULL::bigint;RETURN;
  END IF;
  INSERT INTO p40n_ci.fake_erp_states(
   user_id,data,sync_version,updated_at,last_writer_mode,last_base_sync_version)
   VALUES(p_user,p_data,1,clock_timestamp(),p_mode,NULL)
   RETURNING * INTO applied;
 ELSE
  IF p_expected IS NULL OR prior.sync_version<>p_expected THEN
   RETURN QUERY SELECT 'CONFLICT'::text,prior.sync_version,
     prior.updated_at,prior.last_writer_mode,prior.last_base_sync_version;RETURN;
  END IF;
  UPDATE p40n_ci.fake_erp_states
    SET data=p_data, sync_version=prior.sync_version+1,
    updated_at=GREATEST(clock_timestamp(),prior.updated_at+interval '1 microsecond'),
    last_writer_mode=p_mode,last_base_sync_version=p_expected
    WHERE user_id=p_user AND sync_version=p_expected
    RETURNING * INTO applied;
 END IF;
 RETURN QUERY SELECT 'APPLIED'::text,applied.sync_version,
  applied.updated_at,applied.last_writer_mode,applied.last_base_sync_version;
END $$;

-- Intentional synthetic legacy-write bypass emulator.
-- Do NOT copy this into production. Demonstrates why the old write path
-- must be inventoried and fenced before introducing a real finance ledger.
CREATE FUNCTION p40n_ci.fake_legacy_update(p_user text,p_data jsonb)
RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog,p40n_ci,pg_temp AS $$
DECLARE n bigint;
BEGIN
 IF p_user<>'SYNTH-P40N-OWNER' THEN RAISE EXCEPTION 'INVALID_OWNER';END IF;
 UPDATE p40n_ci.fake_erp_states
  SET data=p_data,sync_version=sync_version+1,
   updated_at=clock_timestamp(),last_writer_mode='legacy',
   last_base_sync_version=NULL
  WHERE user_id=p_user RETURNING sync_version INTO n;
 RETURN n;
END $$;
COMMENT ON SCHEMA p40n_ci IS 'Disposable test-only synthetic full JSONB sync vs external event fence; not production';
