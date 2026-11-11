-- P39-3E disposable PostgreSQL integration test, run ONLY in GitHub Actions.
-- Do not apply to any linked / remote Supabase project.
CREATE TABLE IF NOT EXISTS p39_synthetic_snapshots (
    store_id TEXT PRIMARY KEY CHECK (store_id = 'SYN-LAB-ONLY'),
    revision BIGINT NOT NULL CHECK (revision >= 1),
    payload JSONB NOT NULL CHECK (
        jsonb_typeof(payload) = 'object'
        AND payload ->> '__p39Synthetic' = 'kushe-p39-3-synthetic-fixture-v1'
        AND payload #>> '{meta,p39SyntheticSchema}' = 'kushe-p39-3-synthetic-fixture-v1'
    )
);
CREATE TABLE IF NOT EXISTS p39_synthetic_operations (
    idempotency_key TEXT PRIMARY KEY CHECK (idempotency_key LIKE 'p39::SYN-%'),
    billing_id TEXT NOT NULL CHECK (billing_id LIKE 'SYN-%'),
    intent_sha256 CHAR(64) NOT NULL,
    ledger_id TEXT NOT NULL CHECK (ledger_id LIKE 'p39-synthetic-%'),
    committed_revision BIGINT NOT NULL CHECK (committed_revision >= 2)
);
