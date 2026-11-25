# P41-44K-23 — retained Journal/checkpoint recovery verification

This branch contains isolated verification code and copied synthetic fixtures only.
It does not modify the ERP Store, the quotation template, main, beta, or deployed data.

## Inputs and independent checks

- The exact K21 V4 Windows evidence snapshots, including their original UTF-8 BOM and bytes.
- The Journal.before checkpoint is the sole recovery candidate source.
- Separately saved normal-reopen baselines are independent test oracles only.
- Official Store source is pinned by SHA-256 and Git blob. The current main Store has the same blob.
- Every test page is served from a fresh loopback origin; all other page requests are rejected.
- Authentication is a fixed synthetic fixture identity. Real authentication and remote CAS are not tested.

## Workflows

The dedicated workflow runs the readonly calculator, its negative/purity regressions,
and the unmodified official Store recoveryPreview/recoverStore APIs in fresh Chromium
profiles. Three cases recover revision-2 business content through a NEW revision-4
commit, then close and reopen the profile. A second group verifies stale observations,
changed principals, unknown mirrors/tokens, foreign recovery markers, and receipt-active
markers are refused. A separately reported diagnostic injects one storage error during
recovery to observe retry readiness without treating a refusal as recovery success.

Every outcome remains `publishGate=BLOCKED`; these tests never authorize real data
restoration, historical commission correction, payroll/bank posting, or release.

The quotation numbering/blank-page hotfix already passed live verification and was
accepted by the user on 2026-11-25 (`pass 下一步`). Its product files are unchanged here.

## Local reproduction

```bash
node .p41-k23-tests/preview/run_preview.cjs .p41-k23-tests/fixtures assets/js/erp-store.js
node .p41-k23-tests/preview/test_preview.cjs .p41-k23-tests/fixtures assets/js/erp-store.js artifacts/p41-k23-recovery
python .p41-k23-tests/k23_browser_recovery.py --store assets/js/erp-store.js --evidence .p41-k23-tests/fixtures --output artifacts/p41-k23-recovery
```

The browser runner requires Playwright and an available Chrome/Chromium executable.
There is no instruction for users to run these tests against their everyday browser or real data.
