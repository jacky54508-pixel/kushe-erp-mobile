# P40-16M — Actual production ERP Store/CloudSync code in a local-only fake Chrome origin

**Work is confined to an isolated GitHub candidate branch, not deployed or merged. No real ERP account, project, invoice, payroll, bank, Supabase request, or business data is used.**

## What is materially different from P40-16L

P40-16L tested a newly written, simplified Chrome storage fixture. **P40-16M loads the actual unchanged files from formal main:**
`/assets/js/erp-store.js` and `/assets/js/cloud-sync.js`.
The local test page is **`.p40-16m-tests/actual_modules_fixture.html`**, served only on `127.0.0.1:8799` inside GitHub CI; it never loads the real ERP's `index.html`, app shell, live config, or auth gate.

- Replaces actual authentication with explicit fictitious `SYNTH-P40M-USER-0001` and fake session; no production JWT.
- Sets `window.confirm` to **false**, so ordinary cloud upload and remote restoration prompts cannot be approved by test automation.
- Configures only an invalid test host `https://p40m-synthetic.invalid`, intercepted by Playwright to a **local synthetic 503**. Browser routing blocks all other external traffic.
- Exercises real `KuSheERPStore.load()`, real protected `saveCustomer()` (fake customer), `readCommittedSnapshot()`, `storeTransactionDiagnostic()`, `remoteApplyReadiness()`, real IndexedDB+Emergency mirror+commit token and reload.
- Exercises real `KusheCloudSync.decideRemote()` branch classifications including source/user mismatch, unsafe editor, stale version, and `inspect()` fail-closed on blocked fake API.
- Verifies corrupted Emergency and corrupt local commit token are blocked, direct `KuSheERPStore.persist()` forbidden, no duplicate fake customer writes.

## What this DOES NOT validate

1. All external calls are blocked; it does not test real Supabase `erp_state_cas_write_v2`, real JWT/session behavior, cloud reconnection, or actual cross-device transfer. These were separately isolated under P40-16H/J/K/L but not combined into an official ERP production workflow.
2. It does not start the normal `index.html` UI, so some app/bootstrap routes and real browser prompt behavior differ. The fake auth gate is **not production security**.
3. IndexedDB has the *same database name string* as the real ERP but is bound to the GitHub CI **localhost origin and ephemeral Chrome profile**, so it cannot access the user's real IndexedDB or localStorage.
4. The real code may contain old writes `erp_states` with user_id scoped RLS beyond the guarded RPC. P40-16J's version-fence risk is not solved; no production code has been changed.
5. We do not test real invoicing, legal allowance/tax evidence, bank and retention receipts, paid salary, commission recalculation, outward PDF, cross-device emergency backup and restoration under actual hosted deployment.
6. This PR is a synthetic code-path proof only. **Never merge into main/beta or publish actual financial posting** without separately approved data/sync migration, latest SYNCED backup and complete E2E.

## Previous blockers
The JSONB live source of truth vs an independent append-only SQL discount ledger remains unresolved. Until each legacy writer is accounted for and safely fenced, formal allowance posting must remain disabled. No sample amounts, fake user, or tests imply any builder approval.

## Follow-on
P40-16N could plan a zero-write inventory of every ERP cloud writer with unit guard tests, and a fully isolated end-to-end workflow with the real cloud-sync code against a disposable PostgREST backend (not Supabase production), including offline and recovery. Formal/main remains fixed on P40-15C read-only discount preview.
