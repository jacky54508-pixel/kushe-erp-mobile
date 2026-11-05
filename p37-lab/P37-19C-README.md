# P37-19C — formal-shaped read-only review branch

Not deployed to `beta` or `main`. Only synthetic fixtures are used in CI.

- Pure read-only ledger projection using existing P37-18 inspector (no posting, financial writes or tax voucher platform verification).
- Store adds `billingAllowanceFormalReadOnlyReport(receivableId,expectedRevisionId)` gated to BETA pathname, verified company context and finance permissions.
- Does NOT change existing receipts, retention, cheque, invoice, bank, commissions, payroll, dashboard, reports, PDF writers or P37-14 blocking logic.
- All calculations require unique linked original billing, receivable and matching P37-18 ledger, strict business snapshot revision, source accounting balance, collection/deduction consistency and pending cheque reservations.
- Returns a separate *proposed* projection, not a financial adjustment to existing data; readers and writers used by the ERP remain unchanged.
- A posted-shaped synthetic contract is **not** proof of a tax authority-issued invoice allowance, and this feature never verifies official voucher authenticity.
- Future actual settlement/write integration needs independent accountant confirmation, cross-device sync CAS tests, restore/rollback, existing history audit and explicit production approval.

Run `node --test p37-lab/p37-19-isolated-transaction.test.cjs p37-lab/p37-19b-consumer-projection.test.cjs p37-lab/p37-19c-formal-readonly.test.cjs`.
