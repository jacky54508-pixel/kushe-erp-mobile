# P37-19B: synthetic consumer/receipt/cheque/KPI consistency (review-only)

Scope: isolated review branch, Node-only fixtures. No ERP UI imports, Supabase requests, IndexedDB, browser localStorage, formal money writers or cloud backup API calls.
P37-19A is a synthetic-only allowance simulation. P37-19B creates an independent view of its effective balance; this is not a verified official tax voucher or posted allowance.

Shared formulas:

- Effective receivable = original receivable - receivable allowance.
- Effective retention = original retention - retention allowance.
- Principal outstanding = effective receivable - hypothetical settled principal.
- Available to receive = principal outstanding - hypothetical pending cheque reservation.
- Retention outstanding = effective retention - hypothetical retention receipts.
- Cheque reservation does not count as cash receipt, bank income, actual payroll unlock or settled receivable.
- Cheque clearance is a hypothetical conversion from reserved to settled amount in a PURE simulation, NOT a formal bank transaction.
- KPI discount is -27,300 gross = -24,700 current receivable -2,600 retention for the synthetic case; actual bank, payroll and commissions remain unchanged.

Guardrails:

- Requires exactly one synthetic 19A case and allowance, strict idempotency source, matching case revision, and empty protected business arrays.
- Action history is validated by deterministic replay; stale scenario revisions, duplicate actions, foreign non-synthetic IDs, over-collection, pending cheque over-reserve, and malformed amounts all fail closed.
- Failure injection at append/revision/recheck preserves the caller's report and scenario exactly.
- `project` and `simulateAction` return read-only or cloned proposed snapshots, no actual writes.
- CI runs both 19A and 19B tests. P37-13 cross-reader comparison uses deliberately constructed synthetic fixtures only.

**IMPORTANT** Real ERP still reads legacy `ar.amount` in `billingReceiptState`, `assertReceivableSettlementBaseline`, `receivableChequeCapacity`, and `syncReceivableSummary`. Formal readers/writers, cheque clearing, dashboards, reports, and cross-device cloud CAS are not integrated here. P37-14 still prevents formal receipt operations for a linked allowance. DO NOT insert `billingAllowances` into live ERP or promote to main. The next phase needs an explicit end-to-end migration-free integration design and independent voucher approval.

Run: `node --test p37-lab/p37-19-isolated-transaction.test.cjs p37-lab/p37-19b-consumer-projection.test.cjs`
