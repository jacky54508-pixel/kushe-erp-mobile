-- P40-16E: EPHEMERAL GITHUB ACTIONS POSTGRESQL SERVICE ONLY.
-- Never run against any Supabase / production database.
-- Synthetic-only, never legally effective invoices or business adjustments.
CREATE SCHEMA IF NOT EXISTS p40_16e_lab;

CREATE TABLE p40_16e_lab.synthetic_documents (
    document_id text PRIMARY KEY CHECK (length(document_id) BETWEEN 2 AND 200),
    snapshot_token text NOT NULL CHECK (length(snapshot_token) BETWEEN 2 AND 200),
    original_gross bigint NOT NULL CHECK (original_gross > 0),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE p40_16e_lab.synthetic_events (
    event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 2 AND 200),
    operation_key text NOT NULL UNIQUE CHECK (length(operation_key) BETWEEN 2 AND 200),
    document_id text NOT NULL REFERENCES p40_16e_lab.synthetic_documents(document_id),
    revision bigint NOT NULL CHECK (revision > 0),
    event_kind text NOT NULL CHECK (event_kind IN ('SIMULATED_ALLOWANCE','SIMULATED_REVERSAL')),
    reverses_event_id text UNIQUE REFERENCES p40_16e_lab.synthetic_events(event_id),
    basis_snapshot text NOT NULL,
    payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    gross_delta bigint NOT NULL CHECK (gross_delta > 0),
    net_delta bigint NOT NULL CHECK (net_delta >= 0),
    tax_delta bigint NOT NULL CHECK (tax_delta >= 0),
    retention_delta bigint NOT NULL CHECK (retention_delta >= 0),
    receivable_delta bigint NOT NULL CHECK (receivable_delta >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, revision),
    CHECK (gross_delta = net_delta + tax_delta),
    CHECK (receivable_delta = gross_delta - retention_delta),
    CHECK ((event_kind = 'SIMULATED_ALLOWANCE' AND reverses_event_id IS NULL) OR
           (event_kind = 'SIMULATED_REVERSAL' AND reverses_event_id IS NOT NULL))
);

CREATE TABLE p40_16e_lab.synthetic_event_allocations (
    event_id text NOT NULL REFERENCES p40_16e_lab.synthetic_events(event_id),
    original_billing_id text NOT NULL CHECK (length(original_billing_id) BETWEEN 2 AND 200),
    gross_delta bigint NOT NULL CHECK (gross_delta > 0),
    net_delta bigint NOT NULL CHECK (net_delta >= 0),
    tax_delta bigint NOT NULL CHECK (tax_delta >= 0),
    retention_delta bigint NOT NULL CHECK (retention_delta >= 0),
    receivable_delta bigint NOT NULL CHECK (receivable_delta >= 0),
    PRIMARY KEY(event_id,original_billing_id),
    CHECK (gross_delta = net_delta + tax_delta),
    CHECK (receivable_delta = gross_delta - retention_delta)
);

CREATE OR REPLACE FUNCTION p40_16e_lab.reject_history_changes()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
    RAISE EXCEPTION 'P40-16E synthetic event history is append-only; modification blocked'
        USING ERRCODE='23514';
END;
$func$;

CREATE TRIGGER synthetic_event_immutable
    BEFORE UPDATE OR DELETE ON p40_16e_lab.synthetic_events
    FOR EACH ROW EXECUTE FUNCTION p40_16e_lab.reject_history_changes();

CREATE TRIGGER synthetic_allocations_immutable
    BEFORE UPDATE OR DELETE ON p40_16e_lab.synthetic_event_allocations
    FOR EACH ROW EXECUTE FUNCTION p40_16e_lab.reject_history_changes();

COMMENT ON SCHEMA p40_16e_lab IS 'ISOLATED CI ONLY. Must never deploy to actual Supabase.';
