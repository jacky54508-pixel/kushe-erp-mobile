# P40-16N — Actual ERP CloudSync browser ↔ Disposable PostgreSQL CAS (SYNTHETIC ONLY)

**Only a GitHub draft candidate. No actual customer, payroll, bank, invoice, retention or quote data read or written. No connection to production Supabase. No merging or deployment.**

## Verified earlier
- P40-16M directly loaded unchanged `assets/js/cloud-sync.js` and `assets/js/erp-store.js` on an isolated local Chrome origin. Its 13/13 actual JS tests and 55/55 isolated no-posting tests succeeded.
- P40-16I read only formal Supabase *metadata* (not customer JSONB): `erp_states` stores full `data jsonb` with `sync_version`, `last_writer_mode`, `last_base_sync_version`. The formal CloudSync requests `GET /rest/v1/erp_states?select=...` and `POST /rest/v1/rpc/erp_state_cas_write_v2`.
- In the real app, old direct `erp_states` update privileges may exist subject to original RLS; a future separate allowance ledger cannot safely assume these old writers are fenced. **Do not change the real policy or permissions.**

## What P40-16N actually implements
1. **`.p40-16n-tests/real_cloud_pg_fixture.html`**: dedicated synthetic-only test Chrome origin `127.0.0.1:8801`; loads the **real unchanged** formal ERP `erp-store.js` and `cloud-sync.js` directly, and supplies an explicit fake login, fake trusted device, local empty synthetic app data and **default-denied `window.confirm`**.
2. **`.p40-16n-tests/disposable_legacy_cas.sql`**: one-time PostgreSQL 16 `p40_16n_ci` database, `p40n_ci` private schema, `fake_erp_states` with PostgREST-compatible response columns, `fake_cas_write()` with real row locking and SQL transactions, fake `synthetic_ledger_fence` and `fake_legacy_update()` deliberately demonstrating unfenced legacy writes. SQL rejects any non-`SYNTH-*` customer names or nonempty invoices/billings/payroll/bank data; no production schemas, no migrations, no real account ids.
3. **`.p40-16n-tests/test_real_cloud_pg.py`**: 17 Playwright tests that run the actual CloudSync/Store in Chromium and intercept **only** `https://p40n-synthetic.invalid` to a Python PostgREST-shaped adapter backed by the disposable real PostgreSQL. All other external requests are aborted before network. The adapter is **NOT the real PostgREST or GoTrue server** and its fake credentials are not valid JWTs.
4. **`.github/workflows/p40-16n-real-cloud-pg.yml`**: strict only-candidate-branch GitHub CI, main/beta exact commit/allowlist gate, PostgreSQL 16 one-time service, playwright Chrome test, P40-16M actual-module 13 tests and earlier isolated accounting/sync regressions.

## Core test cases and safety meaning
- Actual Store `saveCustomer()` creates *only fictitious* customer `SYNTH-PC-CUSTOMER`; the actual CloudSync `inspect()` sees missing cloud row and `uploadLocal()` calls its exact production REST endpoints via a local intercepted adapter; fake PG CAS writes and returns its real transaction version, original CloudSync re-reads to verify.
- User refuses `window.confirm` by default, no upload is sent. Only explicit **in-test** replacement of confirm with true allows synthetic upload.
- Reload and separate Chrome profile read/check the same fake PG row without sharing local IndexedDB. Fake PC / fake phone version conflicts and forced concurrent transactions preserve a single accepted CAS writer.
- Fake offline network aborts outgoing requests and preserves the browser's local Store state. Network lost after PostgreSQL committed is **unknown until re-read**, does not prove application itself has durable idempotency keys.
- Exact version equality needed: two PostgreSQL commands concurrently using the same expected sync_version cannot both write.
- If a *different* synthetic finance event changes only `ledger_version`, old production contract CAS still only checks `sync_version`; it may accept a write that cannot be proven safe against the future financial event. This is a **deliberate negative test** and a **formal release blocker**, not a claim of production bug occurrence.
- The isolated fake legacy direct UPDATE can similarly overwrite a hypothetical cached amount after a fake ledger event. This is **not performed on production**, and does not establish the exact behavior of production RLS/migrations, but proves the proposed scheme does not yet fence such a pathway.
- Bad/malicious non-synthetic finance payload and incorrect fake owner are rejected at the mock adapter/DB. This is NOT formal authorization (the P40-16H earlier GoTrue JWT/RLS tests are separate).

## Non-negotiable limitations
- Actual CloudSync and Store source is unchanged and loaded, but Supabase Auth, PostgREST REST server, CORS and RLS are represented by a **local Playwright HTTP adapter**, not actual hosted Supabase. Real PostgreSQL SQL transactions are exercised.
- Real cloud `erp_state_cas_write_v2` behavior and formal `erp_states` policies are NOT called/modified; the emulation is only of the current observable API shape.
- No real ledgerVersion exists in the formal ERP. No actual issued-invoice credit note/tax evidence, receipt/retention adjustments, bank refunds, employee commission, paid salary or outward PDF modified or verified.
- Future independent SQL allowance ledger without a reliable atomic version fence across **all** legacy cloud writers remains **BLOCKED FOR PRODUCTION**. P40-16N PASS must not be interpreted as authorization for posting, merging any A–N candidate, or changing real Supabase.

## Before any production posting could be considered
1. Inventory every known DB/data/REST/RPC writer (including direct `erp_states` upsert, mobile/offline, cloud restore and legacy clients), then design a backwards-compatible lock and release strategy in independent test environment with fallback/rollback.
2. Secure actual session/AAL2/member authorization and all deployed REST grants/RLS (rather than assuming fake auth).
3. Decide canonical financial truth source and verified projections to original bill, receivables, invoices, issued-invoice legal allowances, retention, receipts, banking and wages/commission; approve under accounting and business rules.
4. Only after **new explicit owner consent**, latest SYNCED, verified safety backup, all CI, real mobile/desktop and external PDF acceptance, may a separately scoped formal release branch based on latest main be considered. Stop immediately if any gate fails.

**P40-16N does not add any live financial entry or production feature.**
