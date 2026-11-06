# P37-19Q — formal readiness differential audit and same-origin adjusted settlement race

**Result is a NO-GO release assessment, not a financial production integration.**

## Why this phase exists

Previous P37-19P passed a genuine Chromium rehearsal of a temporary **127.0.0.1-only, SHA-pinned patched copy** of `assets/js/erp-store.js`. The production Store was **not** changed. This proves the accounting approach is feasible on synthetic data, NOT that the company can legally issue credits, post them, or deploy. In particular, formal dashboard/report/KPI, true Auth/Supabase CAS, tax voucher verification and real ERP settlement paths are not completed.

## Concrete controls added

- `release-readiness.cjs` checks the Git blob fingerprints of the exact unchanged production ERP Store, dashboard, reports, Cloud Sync and index.html; it also executes P37-19J's 12 original formal finance consumer checks.
- It verifies the formal P37-14 `requireAllowancesFullyIntegrated` money writer block is still in place, read-only formal-shaped projection is present, and no P/Q sandbox overlay is loaded by formal index.
- It checks previous authentic lab evidence: a real lab database synthetic allowance and admin cleanup succeeded, BUT two true authenticated HTTP Supabase RPC calls, legal/tax allowance verification, genuine live cross-device sync and complete formal finance writers **were not proven**.
- It returns **17 explicit BLOCKING requirements** covering voucher authority, owner identity, concurrent CAS, AR receipts, customer deductions/fees, retention, cheque, bank, dashboard, reports, commission/payroll, backup/restore, PDF, and approval to publish. Its result has no deployment side effects; `canMergeBeta`, `canMergeMain`, `canApproveRelease` and `issueMainPush` are unconditionally false.
- Tests mutate copies of source and lab evidence to ensure source drift or fake successful auth/tax claims cannot silently certify release.

## Added actual-browser contention rehearsal

`browser_concurrent_original_store.py` loads the SHA-verified **real** original Store with the P37-19P isolated-only overlay into two independent tabs on the same disposable Chromium origin, both initially based on the same committed IndexedDB revision. It submits two simultaneous synthetic receipts, each cash 800,000 plus 20,000 deduction against an effective AR of 1,160,900. Only one may commit; the other must fail, leaving exactly one AR settlement of 820,000 and one matching bank credit of 799,800 after fees. A second pair of concurrent retention receipts of 100,000 each races against approved retention 122,200; only one succeeds. Re-open a fresh browser tab and independently inspect the real Store journal, Emergency backup and original invoice values.

**IMPORTANT:** This is **same-origin / two-tab** contention using local IndexedDB and a synthetic-only patched Store copy. It is NOT a test of two computers, two independent accounts, physical devices, actual Supabase Auth, production cloud CAS or legal invoice systems. The P37-19P voucher is invented and can never authorize real posting.

## Changes allowed and prohibited

- Only `p37-lab/p37-19q/**` files and its isolated GitHub Actions workflow are added. Nothing in `assets/js/`, `index.html`, published Pages, Supabase, the real account, `main` or `beta` is written or deployed.
- The workflow runs offline Node strict audit, prior synthetic release and finance regressions, the unchanged P37-19O browser test, the P37-19P adjusted browser test, then the new same-origin Q race.
- Every browser network request is intercepted, and requests not addressed to ephemeral `http://127.0.0.1:<port>` abort.

## Next formal acceptance (NOT yet performed)

1. Independent official allowance/credit-note evidence verification and company authorization.
2. Two genuinely signed Supabase Auth sessions racing one lab PostgREST RPC, with privileged exact cleanup and zero residual records.
3. Formal Store money writers, bank and commission, dashboard/report/PDF and real cloud synchronization adapted under review without overriding existing data; browser real-device acceptance and an owner-approved beta/main rollout gate.

**P37-19Q CI PASS only means the safety gates and same-origin laboratory race passed. `NO-GO` for formal release continues even if CI turns green.**