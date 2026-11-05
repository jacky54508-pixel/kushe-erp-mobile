# P37-19K — atomic synthetic receipt, cheque, retention and hypothetical commission integration

**Read-only production policy:** This work is in a separate review branch. No main or beta modifications. `index.html`, ERP Store, original receivables, receipts, bank, cloud sync, reports and payroll remain exactly unchanged. The new code imports only the synthetic P37-19J projector, Node `crypto`, and nothing capable of writing company data.

## Implemented: cloned in-memory draft transaction with checks

`p37-lab/p37-19k-atomic-settlement.cjs` creates a synthetic envelope. It uses the P37-18 allowance ledger through the P37-19C and P37-19J read-only projectors to obtain effective receivable and retention limits, rather than original billing amounts.

Each synthetic action verifies the exact caller snapshot digest, journal revision, business revision ID, unique idempotency key, source billing/receivable identity, positive money, withholding and cheque reservation limits. The **entire** synthetic operation is applied to a JSON deep clone; bank rows, receipts, AR/retention summary and cheque status must pass independent J projection before returning the proposed next draft. Nothing writes to persistent storage.

Supported experimental transaction types:

- Receipt add: cash plus customer deductions settles AR once, mock bank deposit equals cash minus simulated company fee; advances synthetic AR received.
- Retention receipt add: independent effective retention ceiling, mock bank credit and retention received; does not affect principal.
- Cheque registration: reserves face plus deductions; does NOT create receipt or bank income. Cancellation releases reservation.
- Cheque clearance: links the pending cheque, one new receipt, its fee-adjusted bank credit and principal settlement in one cloned draft. Duplicate or stale clearance fails.
- Receipt/retention reverse: only the new synthetic entries created by this module can be reversed, together with their matching mock bank credit and AR summary; never reverse unrelated or cheque-linked receipts.
- Hypothetical commission eligibility uses the entire effective principal settlement and synthetic bank evidence; real commission and salary writers remain disabled. **This is a conservative draft policy, not a deployed business rule.**

## Fault/rollback and source preservation

Fault injection after main receipt/cheque row, after bank step, after balance, before and after final cross-ledger postcondition. Every failure must leave the caller's original serialized JSON byte-identical, and the same original can be retried safely. The separate invoice, original billing amounts, original receivable amounts, synthetic allowance contracts and other billing rows must be immutable.

## Unresolved formal release blockers

- Real verified two authenticated Supabase HTTP clients racing on a common allowance transaction: not yet accepted.
- Formal ERP `requireAllowancesFullyIntegrated` remains active and blocks linked discounts for real receipts/retention/cheques.
- Formal Store CAS/journal/emergency recovery, Cloud Sync trusted-device versions, bank reversals and idempotency do not consume this draft. They require actual code integration, protected isolated browser testing and explicit approval.
- Official tax document verification, actual receipt deductions and fees, credit-note accounting, payroll commission release criteria, dashboard/report and PDF output remain unverified.
- Synthetic mock bank entries are not real bank transactions; a `syntheticBankEntries` count does NOT mean actual company money was received.

**Result criteria:** P37-19K synthetic atomic / fault rollback PASS if CI succeeds. Real production operation, formal release and `main` deployment remain BLOCKED.