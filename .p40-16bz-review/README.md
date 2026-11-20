# P40-16BZ — isolated real-browser ERP recovery and accounting regression

**DRAFT ONLY. NO MERGE. NO DEPLOY. ALL DATA FAKE.**

This isolated evidence branch inherits PR #78 unchanged and adds only a fake Chromium test, a read-only report and a branch-restricted workflow. No real backup, user personal data, customer accounts, Supabase credentials or production financial rows are committed to GitHub.

## What is actually exercised

- Real, unmodified `assets/js/erp-store.js` and `assets/js/legacy-adapter.js`, served to actual headless Chromium **only on a throwaway `127.0.0.1` origin**; all requests outside the ephemeral origin are blocked and reported as failures.
- Only a hand-written FAKE source snapshot seeded into LocalStorage; official ERP store performs its own `IndexedDB` legacy bootstrap into `KuSheERP25_Core34_DB`/`erp`/`main`, commits the Emergency mirror, writes commit tokens and transaction journal.
- Reload and `readCommittedSnapshot`; invalid writes and an over-payment rejected without changing the committed version.
- Actual Store API operations on FAKE data: receipt→receivable→bank (net of fee), receipt idempotency (no duplicate), payable→payment→bank, retention collection→AR/billing→bank, output invoice→billing/AR, salary payment→bank, and manual commission `14,000 × 25% = 3,500`.
- Real Store `replaceSnapshot` with an **invented fake-authorized principal** only; stale baseline rejected, then valid fake same-data replacement committed and reloaded, accounting collection counts preserved. This fake mock is NOT an actual Supabase Auth/MFA test.
- Emergency mirror corruption must fail closed without altering IDB `main`, then is restored in the same disposable fake browser context and reloaded successfully.
- Localhost browser profile is deleted when test ends. No production browser, real user site, or formal data is accessed.

## Unverified and release blockers

- No real company session JWT/AAL2, live Supabase RLS/Storage, phone or Windows physical-device use, Cloudflare, or real backup import.
- A fake fixture is not sufficient to prove **all** financial modules (real quotation→billing, inventory→payable, retention claim, invoice management, concessions, salary payment approval, commission unlock, merged-region PDF) behave end to end. These remain unverified unless covered by follow-up isolated-specific tests.
- The user's real `KusheERP_safe_backup_20261121_000502.json` was analyzed separately in the private session; **not copied or represented in this repository**.
- Real deployment requires signed off visual PDF, newest SYNCED, a verified restorable backup, full regression and explicit separate owner approval.

**`production_release = BLOCKED` — no auto merge, branch changes, schema updates, deployment, or accounting corrections.**
