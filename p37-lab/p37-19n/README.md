# P37-19N — ORIGINAL ERP Store loaded in a completely isolated Chromium origin

Unlike stages M and earlier, this tests the actual, **unmodified** `assets/js/erp-store.js` source in a fresh Chromium browser session. The Python localhost HTTP server refuses every path except an explicitly fabricated fixture, fake fixture script, and the original Store JS. Before serving it, the server verifies the exact Git blob SHA `1d74daabcf51a6f47b03bac9bbc5407ca881272d` from reviewed branch P37-19M. No formal login, real customer data, official ERP index, Cloud Sync or Supabase is loaded.

All test data are invented P37-19-SYN identifiers; the real Store's `KuSheERP25_Core34_DB` IndexedDB and `KuSheERP25_EMERGENCY` mirror are created **only within an isolated 127.0.0.1 origin and ephemeral CI browser profile**. These origin-scoped stores cannot access the user's actual browser ERP data. Never deploy this isolated test fixture under the public ERP GitHub Pages origin.

## Covered by real browser/Store contract tests

- Load a synthetic legacy snapshot through a fixture-only `window.KuSheLegacyData.getState`, inspect frozen public Store state, verify `persist()` is disabled.
- Ensure allowance-linked synthetic receivable and retention attempts are rejected by the *real* `requireAllowancesFullyIntegrated`. No actual IDB writer for that case.
- Make a non-financial synthetic settings transaction via actual Store writer to bootstrap versioned IndexedDB + Emergency + commit token/journal, then reload the browser and independently check the committed durable snapshot.
- On an **unadjusted** synthetic receivable only, exercise real `addReceipt`: 20,000 cash, 2,000 customer deduction, 100 company-paid fee, exactly one matching bank credit of 19,900 and receivable settlement 22,000. Replay same idempotency key must not duplicate receipt or bank credit; over-limit input must reject.
- Inject a low quota response into real browser `navigator.storage.estimate`, verify the real Store rejects the transaction before any partial commit.
- Open a second stale tab on the **same** isolated origin, load the same snapshot, change settings in the first tab and ensure the stale writer cannot overwrite the fresh IndexedDB revision.
- Corrupt the Emergency mirror only inside the disposable test origin and confirm a new Store writer is rejected without overwriting the previous committed state.

## NOT established

- This is not the formal ERP website and does not use a genuine authenticated business session. Auth-related functions are not certified.
- Live company accounts, full bank/payroll/retention/cheque write path, true Supabase two-authenticated-HTTP-client RPC concurrency and official tax voucher verification remain untested.
- The sample contains a linked synthetic allowance in **review-only** status. We assert it remains blocked, not that it can be posted.
- The initial fixture is supplied by a lab stub; this cannot prove production legacy migration or all cross-device recovery paths.

All tests run from GitHub Actions under an isolated temporary localhost environment. No repository's main/beta branch, original Store JS, official company records, Supabase project or existing ERP IndexedDB is edited. Production allowance posting remains **BLOCKED**.