# P37-19M — real Chromium storage/reload and synthetic localhost CAS acceptance

**Scope: GitHub Actions isolated localhost browser fixtures, not live KuShe ERP or Supabase.** All names, source IDs, browser storage keys, account balances and remote server data are intentionally fake. No browser script imports the formal ERP, production Cloud Sync, P37 account credentials or company documents.

## What the automated acceptance genuinely exercises

- Actual Chromium `indexedDB` transactions and `localStorage` Emergency/commit-token mirrors, in a dedicated origin-bound fixture served by Python's 127.0.0.1 HTTP server. Two independent Playwright BrowserContexts represent isolated desktop/mobile storage profiles, not two physical customer devices.
- Synthetic NT$1,310,400 original gross, NT$27,300 hypothetical discount, NT$1,283,100 effective gross, NT$1,160,900 principal and NT$122,200 retention. Only one mock receipt and matching mock bank income may be added to the local snapshot; no official company money is written.
- Simulated faults after primary IndexedDB, Emergency mirror, and commit token. Reload the real browser between failure and recovery, require a provable rollback to the original snapshot with no ghost receipt/bank entry. A verified commit remains durable across reload.
- Simulated crash AFTER a journal is verified but BEFORE its cloud outbox is written. **Do not mislabel as rolled back or cloud-synced.** The fixture fails closed and requires manual reconciliation.
- Local-first mock CAS: both profiles commit distinct receipts against version 41; only one synthetic HTTP request can win version 42, the losing browser keeps its independently persisted unsynced receipt and enters `CONFLICT_STOP` without overwriting the winner.
- Ambiguous acknowledgments: a mock server can commit and then return HTTP 503; browser must keep `UNCERTAIN_REMOTE_ACK` until an independent GET confirms expected next version, digest and synthetic action. When server has not committed, browser retains local receipt and requires manual retry without automatic resend.
- Emergency mirror tampering after a verified journal is detected and blocked. Unexpected external browser requests are explicitly aborted and counted.

## Architecture / limits

The fixture implements **its own deliberately miniature IDB journal and mock server**, not a production copy of the ERP's `commitStoreDraft` / `restoreStoreCheckpoint`. Browser recovery in this test therefore cannot prove production IndexedDB crash safety or cloud synchronization. Cross-device true Supabase authenticated HTTP RPC concurrency, official tax-document verification and full formal receipt/retention/cheque/payroll/report integration remain unverified.

GitHub Actions installs pinned Playwright 1.57.0 and uses the runner's existing Chrome/Chromium (fallback installs the browser). All network is loopback HTTP, no Supabase or private secrets. The workflow reruns P37-19J/K/L and earlier safety regressions.

Release remains **BLOCKED**; beta and main are not changed. Existing `requireAllowancesFullyIntegrated` must remain in place. No unverified formal financial writer is authorized.