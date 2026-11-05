# P37-19J — multi-document effective balance and formal integration gap audit

Status: **isolated review only** (NOT BETA, NOT MAIN, NOT production).

## What this phase materially proves

- Strict synthetic-only multi-document projection ties the previously verified P37-18 allowance ledger inspector to the P37-19C formal-shaped read-only adapter. Two unrelated bills, including an original unadjusted bill and an adjusted invoice, must agree across outstanding principal, received plus customer deductions, retention, pending cheque reservation, available receipt limits, tax, gross and per-month untaxed revenue.
- Projected minus original KPI deltas for the synthetic allowance: gross -27,300, current receivable -24,700, retention -2,600, untaxed billed revenue -26,000, tax -1,300. Existing bank income, receipt count, payroll and commission entries are ALWAYS zero-change in this module.
- A static reader checks 12 known real ERP finance code surfaces and rejects unexpected changes. No business writer is inserted, no database schema/Cloud Sync/receipt/retention/billing/PDF/cheque/commission logic is modified.

## Verified integration gaps — **blocking**, not PASS

- Formal `assertReceivableSettlementBaseline` and receipt add/edit/delete still use original `ar.amount` and protect allowance-linked records with `requireAllowancesFullyIntegrated`.
- Formal `billingReceiptState` and receivable summary still read original money. Payroll/commission unlock indirectly depends on that original state.
- Retention receipt/summary and cheque limits still read original amounts; pending cheques cannot be treated as deposited cash.
- Dashboard outstanding AR, retention summary, monthly revenue and per-project profit use original accounting values. `reports.js` reuses the dashboard KPI snapshot.
- Cloud Sync CAS is whole-state and has not been independently proven for posted allowances, true dual-auth HTTP RPC, or conflicting receipt/cheque updates.
- Official tax allowance voucher has NOT been independently verified. Current P37-18/19C posted-shaped records are **synthetic contract reviews only**.

## Safeguards

- Test requires an explicit `P37_LAB_SYNTHETIC_ONLY` schema; real user IDs and production records are rejected. It neither reads local browser data nor connects to any online API.
- No module from this phase is loaded by `index.html`. GitHub workflow runs only Node syntax checks and fabricated fixtures on the isolated review branch.
- Fail closed on stale snapshot revision, incorrect source identity, duplicate document, refund amount mismatch, unrecognized ledger state, negative money, excess pending cheque reservation, and any observable input mutation.
- Prior G/H/I true lab staging/cleanup safety evidence remains intact, but this stage does not perform a live Supabase RPC or a production ERP money transaction.

Release remains **BLOCKED**. After independent authenticated RPC concurrency acceptance, the actual receipt/retention/cheque/report/commission/Cloud Sync writers and readers must be integrated in protected atomic Store transactions with rollback and real-device verification, plus explicit user approval before main release.