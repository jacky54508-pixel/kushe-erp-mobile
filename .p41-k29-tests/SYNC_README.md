# K29: release the editor after verified normal commits

## Defects and bounded change

The current quotation UI saves through `saveQuotationBundle`, and the existing
unbilled-work editor uses `saveDailyUnbilledItems`. Both are protected Store
writers, but the CloudSync normal-commit allowlist omitted them. A successful
save therefore retained `EDITOR_DIRTY` even after the form closed. Local commit
and upload scheduling are separate from this gate: this defect blocks a later
automatic remote apply; it does not establish that a saved record was lost.

The same omission affects the reviewed normal UI operations listed below. K29
adds only these explicit names. It does not generate an allowlist from every
Store writer or remove the durable revision, operation, audit, no-change,
editor-generation, focus, composition or visible-form checks.

The event callback also lacked principal continuity. The original module can
release an editor's dirty state when the account changes after the commit event but
before its asynchronous verification finishes. K29 captures a nonempty
principal at the event, then checks the same principal before and after the
asynchronous verification. This is an editor-notification guard, not a new
authentication, login or database policy.

A third defect is independent of the omitted names: the original callback only
checks once. The unbilled-work UI removes its closing drawer after 180 ms, and
cheque saves display a read-only detail first. If the durable check finishes
while either surface is visible, the original callback leaves the dirty latch
set even after that surface closes.

K29 retains a pending commit only after the existing verification succeeds. A
DOM observer and focus-out event can request another check after the surface is
actually safe. That second check repeats the durable revision, operation and
audit validation; it still requires the same principal and editing generation.
New input, ordinary button navigation, route navigation, a replacement event,
or failed verification discards the pending commit. There is no polling loop.
Open-surface DOM changes do not reread storage. The only click that is not a new
editing generation is the existing `[data-cheque-close]` within a connected
`.cheque-overlay` containing no form, input, textarea, select or editable content.
It only dismisses an already read-only detail; actual removal and all commit
checks are still required. Closing an editable cheque surface invalidates the
candidate instead.

## Reviewed additions

Each name is present in `STORE_WRITER_NAMES` in `assets/js/erp-store.js` and is
called by the listed normal UI. `sync_contract.cjs` verifies these facts against
the checked-out source and records exact source line numbers in its JSON report.

| Writer | Normal UI source | Operation |
| --- | --- | --- |
| `saveQuotationBundle` | `assets/js/quotations.js` | Save a quotation with its optional price/template data |
| `saveDailyUnbilledItems` | `assets/js/commissions.js` | Save reviewed unbilled construction items |
| `saveVendor` | `assets/js/materials.js` | Save a material vendor |
| `addInventoryReceipt` | `assets/js/materials.js` | Record an inventory purchase |
| `recordInventoryReceiptPayable` | `assets/js/materials.js` | Explicitly record the payable for an existing inventory receipt |
| `setMaterialOpeningStock` | `assets/js/materials.js` | Set opening inventory through the existing confirmation UI |
| `saveReceivableCheque` | `assets/js/receivable-cheques.js`, `assets/js/billing.js` | Record a received cheque |
| `clearReceivableCheque` | `assets/js/receivable-cheques.js` | Confirm cheque clearance |
| `cancelReceivableCheque` | `assets/js/receivable-cheques.js` | Cancel a cheque through its existing confirmation flow |
| `saveExternalBillingDocument` | `assets/js/billing-groups.js` | Save an external billing document |
| `archiveExternalBillingDocument` | `assets/js/billing-groups.js` | Remove external grouping while retaining source bills |
| `addProjectCommissionSettlement` | `assets/js/commissions.js` | Record a selected project commission payment |

Excluded from this change: project merges, historical billing-detail editing,
historical commission review/repair, test-data cleanup, merged-payable repair,
daily-billing-link repair, recovery, snapshot replacement and snapshot loading.
The existing Store authorization and financial constraints still decide whether
any writer may execute. Adding its name here never calls that writer.

## Node event-contract evidence

Run from the repository root:

```sh
node .p41-k29-tests/sync_contract.cjs --mode baseline --output artifacts/k29-sync/node-baseline.json
node .p41-k29-tests/sync_contract.cjs --mode candidate --output artifacts/k29-sync/node-candidate.json
```

Both modes execute the complete unmodified CloudSync module in an isolated Node
VM. Baseline source is read from commit
`15eff6fc574fb64480682656daf88dc7a906baa8`; candidate source is the checked-out
file. Synthetic event, DOM and durable-read responses exercise the listener.
Storage mutation and network access are forbidden. This is not a database or
browser test.

Every added name is checked with valid commits and notification warnings, plus
rollback, recovery-required, no-change, open form, focused input, composition,
stale result/revision/audit, unavailable durability, already-observed operation,
new input and new operation races, throwing read gate, remote-apply notification
and recovery action. Excluded and unknown writers remain rejected. A previously
allowed writer separately reproduces the original principal race and verifies
the candidate refusal, including a missing event principal. The existing
temporary verified-cloud-commit branch is retained.

Additional delayed-close cases cover both an already allowed writer and the
new unbilled writer. They verify the second read, read-only detail dismissal,
focus-out, and refusal after new input, changed principal, changed durable
revision, changed operation, failed result, an initially invalid notification,
editable-dialog dismissal or other navigation. Unknown writers cannot become
trusted by closing a form. Fifty synthetic mutations while an editor is open
must cause no additional durable reads. Finished/rejected pending commits must
disconnect their observer. Each mode currently contains 292 cases and 983
assertions; these are event-contract results, not browser acceptance.

The baseline success status means the omissions/race were reproduced; it never
means the original implementation was fixed.

## Real browser/Store integration

With Python, Playwright and a working Chromium/Chrome executable:

```sh
python .p41-k29-tests/sync_browser.py --mode baseline --output artifacts/k29-sync/browser-baseline
python .p41-k29-tests/sync_browser.py --mode candidate --output artifacts/k29-sync/browser-candidate
```

Optional `--browser /absolute/path/to/chrome` selects a browser. Otherwise the
existing K28 helper validates system executable candidates before using the
Playwright-managed browser. A missing browser is `BLOCKED`, not a pass.

The browser runner reuses unchanged K28 loopback and synthetic fixture helpers.
It runs actual `saveQuotationBundle` and `saveDailyUnbilledItems` transactions,
then lets the actual CloudSync listener process their real commit events. For
each writer it checks immediate and 180 ms delayed closure, a still-open form,
a rejected writer, account changes and new input before the initial callback
and after its first successful verification. A recovery marker is deliberately
injected only into an owned synthetic profile to prove the later real Store
readiness check refuses invalid durable evidence. Read-only cheque-shaped
details may close later; an editable one must invalidate the pending commit.
The two writers provide 22 cases. One additional case drives the real
`KusheCommissions` unbilled-work drawer, review and submit handlers through its
actual 180 ms closing path. Raw before/after
snapshots, actual transaction results and events are retained. Old paid and
banking collections must stay unchanged. Reader inspection must not write.

The 22 general input surfaces are synthetic; the final case uses the real
unbilled-work UI. It does not claim the full quotation or cheque UI was driven.
Baseline mode uses the released main CloudSync with the same candidate Store,
UI and fixtures to isolate the CloudSync behavior. Exact loopback resources are allowed;
every other request is blocked and treated as a failure. Cloud auto-backup is
never started. No Supabase endpoint, real account, production database, user
backup, hardware-power-loss test or physical phone is involved.

The browser test source and commands are the same on Linux and Windows.
CI should run both Node modes and both browser modes, preserve `RESULT.json`
and per-case JSON even on failure, and record the exact checked-out source.
The parent task owns the workflow, overall source guard and index cache version.

## Operational limits

This change makes eligible completed normal operations release the existing
editor gate. It does not force remote data over a draft, merge competing device
edits, upload on the user's behalf, or prove that a particular signed-in account
currently shows `SYNCED`. Those account observations and an up-to-date full
backup remain separate from synthetic code validation.
