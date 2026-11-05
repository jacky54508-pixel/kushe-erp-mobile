# P37-19O — original Store retention, cheque, bank, commission integration review

**Independent GitHub review branch ONLY. Not published to main or beta.**

This stage loads the exact, unmodified `assets/js/erp-store.js` with Git blob SHA `1d74daabcf51a6f47b03bac9bbc5407ca881272d` in real Chromium, with a synthetic-only legacy-data fixture hosted on `http://127.0.0.1` inside GitHub Actions. It extends P37-19N with one wholly invented non-allowance billing/receivable, a retention balance, and a synthetic linked commission. This test deliberately uses the REAL Store money writer implementation, not P37-19K's simplified model.

## Original Store behaviors to validate

- Existing allowance-linked AR is denied any retention receipt or cheque registration; `requireAllowancesFullyIntegrated` remains unchanged.
- Non-allowance synthetic retention recovery uses the actual `addRetentionReceipt`, `updateRetentionReceipt`, `deleteRetentionReceipt` methods. Assert bank income equals cash minus company fee; principal stays unchanged; deleting retention restores bank and retention totals, preserving original invoice and unrelated allowance record.
- Real `saveReceivableCheque`: pending cheque reserves amount plus the customer's synthetic deductions; registration creates NO bank income or receipt and does not unlock a commission. Replaying the same idempotency key produces no duplicate. Stale source snapshot rejects a second registration.
- Real `clearReceivableCheque`: only confirmed actual clearance creates one receipt and one bank income. Deduction reduces the amount of principal still outstanding while bank amount reflects deposited cash less fee. Duplicate confirmation produces no new receipt.
- Inject a failed Store capacity check during cheque clearance, **after the original writer has modified its draft**. Assert the original Store's published snapshot, IndexedDB, journal, Emergency mirror and linked bank counts remain unmodified, including after a browser reload.
- Complete the same fictitious receivable with a second ordinary receipt; verify the real `commissionReleasePool` reader transitions from not unlocked to potentially payable when the original AR is fully settled. NO salary payment is created by this read-only release status.
- CI independently reloads IndexedDB and checks the original Store journal phase is `COMMIT_VERIFIED`. Only mock company IDs beginning with `P37-19-SYN-` may be present.

## Known limitations and no-post gate

**This is not verification that discounts can be posted or collected against.** The linked allowance is intentionally blocked and original money writers are not rewritten to take an effective adjusted balance. The demonstrated commission release belongs to a distinct *unadjusted* synthetic invoice; no salary or commission is paid in this test.

The original Store's exact code is only loaded into disposable localhost Chromium storage. Supabase, a genuine login, cloud CAS, tax voucher API, employee payroll release writer, and live business files are not involved. The test data cannot reach the user's actual ERP browser origin. The original Store source and existing company data remain unmodified.

Actual dual-authenticated Supabase RPC races, cross-device live data reconciliation, legal tax vouchers and full effective allowance writer integration remain **PENDING**. This stage cannot authorize main or beta release.