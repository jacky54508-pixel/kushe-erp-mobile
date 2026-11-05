# P37-19A: isolated transaction guard

Synthetic-only test fixture; this is not the real ERP posting feature.

- New JavaScript is not imported by the ERP or the existing P37 laboratory page.
- No ERP Store, IndexedDB, localStorage, network, Supabase, formal receipts, payroll or bank write is invoked.
- Hard deny for snapshots outside P37_LAB_SYNTHETIC_ONLY and synthetic identifiers.
- Local copy-only simulation verifies CAS revision, source snapshot, duplicate protection, tax/gross/receivable/retention balance, and non-zero receipt/cheque rejection.
- Three injected faults must leave the original snapshot byte-for-byte unchanged.
- Tests also exercise the existing P37-18 read-only inspection against a completely fictional ledger-shaped contract.
- All returned statuses say not posted; 0 production/cloud writes.

Not yet verified: real double-device concurrency, accountant-issued tax voucher, production atomic commit, formal collection/payment/KPI integration. Do not port this synthetic adapter to production or import it into ERP index.html.

Run: node --test p37-lab/p37-19-isolated-transaction.test.cjs
