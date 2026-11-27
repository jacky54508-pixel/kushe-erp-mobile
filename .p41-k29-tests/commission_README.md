# K29 manual commission basis acceptance

The real browser suite uses exact Store and commission UI bytes, a fresh owned
Chromium context, real IndexedDB/Web Storage, synthetic `SYN-K29-COMMISSION-*`
records, and an exact GET allowlist on a loopback origin. It reuses K28's browser
harness; only the harness fixture HTML's synthetic marker and principal change.
No production origin, cloud synchronization code, uploaded draft, or database
credential is used. It does not authorize changing historical financial data.

## Baseline reproduction

```sh
python .p41-k29-tests/commission_browser.py --mode baseline --baseline-ref 15eff6fc574fb64480682656daf88dc7a906baa8 --output /tmp/k29-commission-baseline
```

Both source files are read from the specified Git commit. Four actual UI + Store
cases reproduce reduced bases on new entries and note-only edits, for retained
taxable bills and no-invoice bills. Success means `K29_COMMISSION_BASELINE_REPRODUCED`,
not that the old behavior is acceptable.

## Candidate acceptance

```sh
python .p41-k29-tests/commission_browser.py --mode candidate --root . --store assets/js/erp-store.js --ui assets/js/commissions.js --output /tmp/k29-commission-candidate
```

Both commands accept `--browser /absolute/path/to/chrome`. Without that argument,
the existing harness verifies a system Chrome executable before trying the
Playwright-managed Chromium. An unavailable browser produces `BLOCKED`, never a
pass. Use writable output paths appropriate to Windows/Linux CI.

Candidate coverage includes taxable tax-included bills, retention, no-invoice
bills, new manual entries, desktop/mobile note-only edits, partial historical
bases, inconsistent historical commission totals, raw numeric strings, missing
or conflicting historical source links, missing/blank status and date fields,
intentional rate changes, employee and
month reassignment, project and status changes, an explicitly selected different
bill with the same amount, source amount alias conflicts/missing gross/duplicate
IDs, cross-project/source-number conflicts, legacy note-only source evidence,
stale row/source snapshots, removed edit IDs, paid-month refusal, and the
existing daily-source edit prohibition. Original finance/source fields and
payroll stay exact on note-only edits. Intentional financial changes verify the
corresponding salary group and old group cleanup through the real Store.
The date-required UI gate is retained for incomplete historical dates; direct
note-only Store calls preserve the raw missing date without assigning today.

Every successful save checks the durable primary, emergency mirror, public
state, commit journal/tokens, revision/audit count, and unrelated collections.
The suite does not mock the commission writer or the manual form's event handlers.

## Supplemental source check

```sh
python .p41-k29-tests/commission_fixture.py --output /tmp/k29-commission-fixtures.json
node .p41-k29-tests/commission_probe.cjs --store assets/js/erp-store.js --fixtures /tmp/k29-commission-fixtures.json --output /tmp/k29-commission-readonly.json
```

This Node check exercises only the source resolver against an ephemeral synthetic
snapshot. It is explicitly not browser, persistence, or writer acceptance.
