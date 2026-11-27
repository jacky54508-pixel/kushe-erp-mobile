# K29 bulk input readiness candidate

This candidate is based on formal `main` commit
`15eff6fc574fb64480682656daf88dc7a906baa8`. It contains no production data,
credentials, migrations, automatic historical repair, or deployment job.

## Changes under review

- Manual commission entry reads the saved pretax and gross billing amounts.
  Retention does not reduce the commission basis, and a no-invoice source is
  not divided by a tax factor. Source contradictions and stale selections
  fail before saving. An unchanged financial context preserves original raw
  commission amounts when only its note is edited. Existing paid-month,
  settlement, and daily-log editing locks remain in place.
- CloudSync accepts the explicit normal Store writer names used by the UI.
  Dirty-editor release still requires a verified durable commit from the
  same principal and editor generation, a safe editor surface, and matching
  revision/audit evidence. Pending view closure must not clear later input.
- Receivable groups have a compact summary while keeping original source
  records, balances, invoice states, actions, and version history available.
  The code moves the existing action nodes; it does not rewrite account data.
- Merged billing print waits for decoded logo/seal assets, preserves the
  supported four-decimal external/historical line values, and displays a
  clear error above the existing 50-line limit. Its print button and automatic
  print route share the ready gate; this is not a browser Ctrl+P interceptor.
- Dense merged billing can arrange the existing summary rows in two columns
  and place the existing footer blocks together. It measures the complete
  print style cascade after image/font readiness and retains the layout only
  when its A4 height and text widths fit. Otherwise it restores the original
  complete multipage layout. No font size, saved amount, or source row changes.
- Cache query values are updated through every affected billing print route.
  Quote routing and data projection are covered by the unchanged K27 suite.

## Isolation and evidence

New browser suites use fresh contexts, synthetic fixtures, and an exact owned
loopback resource allowlist. They do not load production configuration or
log in to an ERP account. Baseline runs reproduce the specified old defects;
they are not evidence that the baseline is fixed. Node contract checks are
reported separately from real browser checks.

The new source guard verifies the frozen manifest, exact cache-only changes,
and unchanged bytes of the original regression suites. It does not execute
the ERP. No old test assertion or old source guard is relaxed to accept K29.

Run these commands from the repository root:

```sh
python .p41-k29-tests/source_guard.py --output artifacts/source
python .p41-k29-tests/run_acceptance.py --group candidate --output artifacts/candidate
python .p41-k29-tests/run_acceptance.py --group legacy --output artifacts/legacy
```

The candidate group runs baseline/candidate sync contracts, actual Store and
CloudSync browser integration, actual commission UI, actual receivable UI,
real print routing/PDF extraction, and unchanged K28 paid-month Store/UI
checks. A separate bulk-input suite starts with approximately 1.7 MB of
synthetic ERP data, performs 100 sequential daily-work saves, and reloads the
same origin to verify complete records, durable mirrors, and unchanged paid
history. A storage failure is a failure, not permission to reduce the fixture.
The legacy group runs the original P33-4, P34, P35, P36, P39 invoice,
K24 recovery, K25 review, and K27 projection/export suites against the same
candidate. The K24 baseline blob remains pinned to its original bytes.

The branch-only workflow uses Windows and Linux for the candidate group, with
Linux for the unchanged legacy group. Every suite log is retained on failure.
Missing executables, missing summaries, timeouts, and unexecuted suites are
not passes. Synthetic screenshots/PDFs are separated into three-day QA
artifacts; structured evidence is retained for fourteen days.

The standard 30-original-row/30-summary-row fixture must produce one actual
A4 page with all content and unchanged font sizes. Boundary row counts,
long Chinese descriptions, large four-decimal values, and long notes with
retention verify content preservation and measured fallback. This is not a
promise that arbitrary text lengths fit one page. Mobile UI acceptance uses
the actual page frame and checks the target is inside the viewport.

## Release boundary

Passing this workflow does not merge or deploy the candidate. A concrete
review of the final source, actual results, and rendered output is required
before release. No test restores a backup or updates production records.
Device-local unsent data and physical power-loss recovery require separate
observation; this synthetic suite does not claim to establish either.
