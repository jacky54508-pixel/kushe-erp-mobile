# P37-19L — Store commit and Cloud Sync CAS handoff, synthetic rehearsal

**Status: independent review branch only. NOT deployed to beta/main. NOT executed against a live browser or Supabase.**

## Scope and actual value

Builds on P37-19K's cloned synthetic finance transactions (receipt, fee/deduction, bank entry, retention and cheque) and P37-19J's strict read-only allowance balances. The new planner demonstrates the *necessary* handoff between a locally committed Store and an independently accepted cloud compare-and-swap (CAS), with two separate imaginary trusted devices. It never calls the real ERP Store or cloud APIs.

The formal ERP `commitStoreDraft` already uses a primary IndexedDB CAS, Emergency backup mirror, version tokens, journal, postcondition and restore fallback. The formal `cloud-sync.js` separately calls `erp_state_cas_write_v2` using an expected `sync_version`. These are **not one distributed transaction**. A local commit can succeed even when the cloud write is rejected, times out or has an ambiguous response. Do not silently assume rollback or remote success.

## Tested safeguards

- A synthetic financial action is evaluated with the existing P37-19K validation and only becomes a locally *mock-committed* snapshot after verifying original digest, local revision and source billing. No changes to the caller's original object.
- The simulated local commit must advance primary snapshot, Emergency digest, token digest and commit journal consistently. Failure injection at four stages returns no new scenario and leaves all pre-existing inputs byte-identical.
- The synthetic upload outbox carries original cloud version/fingerprint and proposed snapshot digest. Remote mock CAS accepts exactly one compatible version; the second conflicting device retains its *own* locally committed entry and enters `CONFLICT_STOP` without overwriting the remote winner.
- A timeout before remote application leaves the local draft intact and requires an explicit manual retry decision. A timeout *after* mock remote application is **not** claimed as success until a separate read confirms exact expected-next remote version and matching fingerprint. Unauthorized/failed remote outcomes never clear the outbox.
- Financial rows and bank postings are **synthetic-only**, and hypothetical commission eligibility does not unlock real payroll. There is no API for posting allowances, publishing, or updating production money.
- Inputs are accepted only with synthetic IDs, mock trusted device identity, correctly paired hashes, and original P37-19K snapshot / journal invariants.

## Missing before production

Real two-authenticated-client Supabase RPC concurrency and real-device cloud reconcile remain unverified; P37-19J confirms formal receipt/retention/cheque/report/payroll reader+writer integration is incomplete. Independent tax allowance voucher verification and real browser recovery/backup are also pending.

This is **not evidence of atomicity across local IndexedDB and Supabase**. Production integration needs a documented outbox/reconciliation protocol, recovery after ambiguous remote acknowledgements, original data read-only checks, true cross-device tests, and user approval. Existing `requireAllowancesFullyIntegrated` must remain in place until then.

Run Node CI: `node --test p37-lab/p37-19l-store-cloud-cas.test.cjs`. No live financial data, browser storage, Supabase keys or background tasks are used.