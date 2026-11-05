# P37-19P — sandbox-only effective allowance settlement overlay on the original ERP Store

**NOT an ERP change, NOT legal/tax validation, NOT a production release.** This isolated review branch adds no changes to `assets/js/erp-store.js`, `assets/js/cloud-sync.js`, `index.html`, `beta`, or `main`. The original `requireAllowancesFullyIntegrated` code remains fully active for all production users.

## Purpose

Earlier P37-19N/O demonstrated actual unchanged Store's normal billing/receipt/bank/retention/cheque/commission flow and its correct protection against linked discounts. P37-19P tests what a limited, *lab-only future integration* would need to do so those financial writers consume an effective allowance-adjusted amount **without rewriting the original posted invoice, billing/AR principal or retention historical values**.

## Strict isolation

- Python `lab_overlay.py` verifies the Git blob SHA of the unmodified Store is EXACTLY `1d74daabcf51a6f47b03bac9bbc5407ca881272d`. Every replacement demands exactly the reviewed original source anchor and occurrence count; drift aborts test server startup.
- A generated patched copy of the real Store exists only as a temporary file inside a GitHub Actions runner, served at `127.0.0.1` with an allowlist of fixture assets. It is never written back into `assets/js`, committed as a public deployment file, merged, or loaded by the production ERP HTML.
- Runtime checks reject non-localhost origin, non-synthetic IDs, missing `window.P37P.isolatedFixture`, and any P37-18 read-only ledger whose source/voucher/amount/invoice relationship is malformed. **Fake** posted-shaped vouchers are only permitted inside the sandbox and may never authorize real financial transactions.
- The original test fixture retains a SECOND, deliberately unverified linked allowance. Real Store must continue rejecting its receipt. Unadjusted synthetic receivables remain on their original Store code paths.

## Test projections and original historical amount conservation

Test original: untaxed 1,248,000; tax 62,400; gross 1,310,400; current AR 1,185,600; retention 124,800. Fake approved deduction: untaxed 26,000; tax 1,300; gross 27,300; AR reduction 24,700; retention reduction 2,600. Effective current AR 1,160,900 and retention 122,200.

- The patched *temporary* copy consults existing `assets/js/p37-billing-effective-ledger.js` to verify single invoice, bill, AR, voucher format and approved mathematical invariants. It then applies only the effective **limits and derived status calculations** for the one synthetic billing.
- `assertReceivableSettlementBaseline`, `syncReceivableSummary`, `billingReceiptState`, and `commissionAllocationReleaseState` receive the approved AR value, so principal and commission review can agree with the adjusted amount. No actual payroll payment writer is executed.
- `addRetentionReceipt`, edit/summary and LoadState retention-derived fields receive the approved retention limit. Historical original `billings[].retention`, `billings[].retentionAmount`, `receivables[].retentionAmount` and invoice amounts are preserved; browser reload must not revert the remaining retention to original.
- Original Store receipt, customer deduction, fee, bank credit, cheque registration/clearance, IDB CAS + journal, Emergency mirror, idempotency and failure rollback mechanisms are still executed by Chromium.
- Malformed synthetic voucher/money/duplicated approval and foreign real-shaped IDs are rejected before storing any financial entry.

## Release gates still open

Production version has **not** been patched, and official tax-credit voucher has **not** been independently verified. True two authenticated Supabase HTTP RPC clients, formal cloud sync, automatic reconciliation of failed uploads, full financial integrity report and historical invoice/PDF alignment remain unproven. The CI results cannot authorize opening the live allowance posting/settlement feature.

The sole delivered result is a validated, reproducible **isolation-only feasibility test**. A separately reviewed formal implementation would need to preserve these guards, use durable backups and cross-device acceptance, and obtain explicit approval before beta/main release.