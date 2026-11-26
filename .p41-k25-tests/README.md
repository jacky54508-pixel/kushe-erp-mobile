# K25 historical commission review candidate tests

This suite loads the exact candidate `assets/js/erp-store.js` and the actual new review UI into fresh, owned Chromium profiles on a loopback-only test server. All source records are built by `k25_fixture.py` with `SYN-K25` identifiers. It never opens the production ERP origin or invokes a real cloud service.

## Scope

- Full construction-group pretax amount × individual rate, preserving both workers and every house allocation.
- Original and target amounts use separate maximum-remainder allocations. The fixed 14,000 / 25% example verifies that the per-house difference is 583 / 583 / 584, not an independent split of the 1,750 total.
- Receipt, paid-month, already-settled source, tax, ambiguous link, zero-difference, and negative-difference reviews retain the appropriate holds.
- Original subtotal-only billing lines, saved-commission mismatches, filtered summaries, and ordinary zero-commission or legacy work-only records use realistic source shapes.
- Atomic creation of review metadata through the real Store writer; original financial collections, payment pools, and salary views remain unchanged.
- Confirmation, role, verified company context, trusted-device, late role/principal/session-epoch change, stale preview, duplicate, malformed ledger, and caller override refusal.
- Real IndexedDB and Web Storage fault injection at four persistence steps, complete rollback, explicit fresh retry, and ordinary close/reopen durability.
- Actual UI at desktop and mobile sizes: safe text rendering, readonly opening/export, explicit confirmation, stale UI gating, keyboard close/focus, viewport bounds, and committed record display.
- Unmodified existing P33-4, P34, P35 UI, and P39 invoice Store suites run separately.

`source_guard.py` verifies the reviewed source manifest and candidate file scope. Removing the single marked K25 addition and its three API registrations must restore the entire previous K24 Store byte for byte. This preserves all existing normalization, transaction, recovery, payroll, receipt, and bank logic.

## Execution

The authoritative browser evidence is generated in the Linux and Windows jobs of `.github/workflows/p41-k25-commission-review.yml`. No local browser fallback is used when the local execution environment refuses Chromium.

The optional `probe_preview.cjs` uses Node's `vm` with the existing `loadEphemeralSnapshot` and readonly preview APIs. It is only a source/fixture contract check. It does not test a browser, IndexedDB, Web Storage, or persistence and is never reported as a browser pass.

## Boundaries

K25 review records are `DRAFT` or `HOLD`. The new APIs always report `canApply=false`, `canPost=false`, and `canPay=false`. Saving a review does not correct or pay a historical amount. This suite does not authorize deployment, exercise production authentication, or establish real historical debts.

UI screenshots contain synthetic data and are kept in a separate, short-lived internal QA artifact. They are not part of the user-facing evidence archive. Raw failed results are retained so a failure cannot be mistaken for a successful run.
