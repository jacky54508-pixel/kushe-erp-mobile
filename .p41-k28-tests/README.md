# K28 paid-month daily append candidate acceptance

All records are constructed by `k28_fixture.py` with `SYN-K28` identities. The browser runner uses an owned loopback server, exact local source bytes, fresh Chromium profiles, blocked service workers, and an exact GET allowlist. No production account, origin, database, backup, or uploaded user draft is used.

## Execution

Run from the repository root with Python 3.12 and Playwright available:

```sh
python .p41-k28-tests/source_guard.py --output /tmp/k28-source-evidence
python .p41-k28-tests/k28_browser_store.py --mode baseline --output /tmp/k28-baseline-evidence
python .p41-k28-tests/k28_browser_store.py --mode candidate --store assets/js/erp-store.js --output /tmp/k28-store-evidence
python .p41-k28-tests/test_daily_ui.py --root . --store assets/js/erp-store.js --output /tmp/k28-ui-evidence
```

`--browser /absolute/path/to/chrome` selects an explicit browser. Without it, the runner validates system candidates before falling back to the Playwright-managed browser. A missing executable or denied browser download is a blocked run, never a pass.

`.github/workflows/p41-k28-paid-month-append.yml` runs baseline, actual Store, and actual UI acceptance on Linux and Windows. A separate Linux job runs the original P33-4, P34, P35 UI, and P39 invoice Store tests without editing their assertions. The workflow is restricted to the candidate branch, has read-only repository permissions, and contains no deployment or business credentials.

## Core coverage

- Two baseline cases reproduce the original paid-month block with verified partial and full synthetic payments.
- Ten candidate success cases cover partial payment, full payment, an existing eligible unpaid summary, receipt reversal after a valid payment, same/new project, commission/day/hour/mixed compensation, one batch with paid and unpaid employees, and salary month priority over a later payment date.
- Twenty-two refusal cases cover legacy allocations, missing or conflicting bank evidence, missing/reused allocation keys, duplicate identity/source links, contradictory employee fields, malformed amount representations, missing daily detail, external employee/month references, stale payroll status, and a raw payroll summary inconsistent with its sources.
- Existing paid daily sources, commissions, and payroll adjustments remain protected against editing and deletion.
- One stale-snapshot case varies five evidence dependencies only in an explicit prior-state copy: payment bank transaction, bank account, other-day attendance and commission in the same salary month, and a foreign employee's payment allocation key. The copy is passed only to the read-only snapshot API. Every stale writer must return `DAILY_DRAFT_CONTEXT_CHANGED` and preserve all durable and published state.
- Four real persistence fault locations cover primary IndexedDB, emergency mirror, Store commit token, and receipt commit token. Failures must roll back business state and all captured mirrors, retain original history, and permit an explicit fresh retry that adds one batch.
- Successful writes are verified in the public Store, real IndexedDB, transaction journal, emergency mirror, and both commit tokens, including close/reopen persistence.

Every original paid or partial-paid payroll row, payment record, bank transaction, and original source is compared in full. A specifically identified unpaid summary may change only its calculated fields; the grouped payroll total must increase only by new sources and recorded payments must remain unchanged. New unbilled commissions remain unavailable for payment. Multi-employee construction is billable only once.

## Evidence limits

`probe_readonly.cjs` is a supplemental Node VM check using `loadEphemeralSnapshot` and read-only APIs. It does not execute a writer, a browser, IndexedDB, or transaction persistence. Its output explicitly records `browserTest:false` and `persistenceTest:false`.

Synthetic UI screenshots belong in the short-lived `internal-qa` evidence directory. Browser failures and incomplete results are retained. Test completion does not authorize merging, deploying, repairing historical data, or importing any draft into the ERP.
