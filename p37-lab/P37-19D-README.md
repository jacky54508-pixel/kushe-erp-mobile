# P37-19D — independent precommit / synthetic two-device CAS review

This branch is **not** deployed to main or beta. There is no real browser ERP session, no live financial data, and no official tax voucher verification.

Implemented a pure Node-only preflight which *consumes* the P37-19C read-only projection and checks receipt, retention, cheque registration, and cheque-clearance limits against the projected effective balances.

Strict synthetic device envelope tests owner and company consistency, mock AAL2, trusted device, clean editor, no active transaction, no pending recovery, local business revision and remote CAS sync-version/fingerprint baselines.

The two-device race test deliberately operates on an **in-memory mock remote object**, with a stale second device refused after a mock first-version advancement. It proves no real two-browser or database concurrency: `realCloudRequests=0` and `cloudWrites=0`.

The gate always returns `canPost=false`, with blockers for tax-platform voucher verification, unsupported formal settlement writers, absent real remote CAS acceptance, and untested real browser backup / rollback. Never use it as an authorization token.

The original Cloud Sync and ERP Store JS are untouched; P37-14 still blocks direct collection for an allowance-linked receivable. This test does not open or alter any company bill, receipt, bank, payroll, cheque or ledger record.

Next release criterion: independent tax-document validation, actually isolated two-device browser tests, all real receipt/retention/cheque/KPI reader+writer coordination, rollback/backups, and explicit user approval. The test-mode schema and fake identity must never be reused in formal ERP.

Run: `node --test p37-lab/p37-19-isolated-transaction.test.cjs p37-lab/p37-19b-consumer-projection.test.cjs p37-lab/p37-19c-formal-readonly.test.cjs p37-lab/p37-19d-precommit-review.test.cjs`.