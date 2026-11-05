# P37-19E — local HTTP, two separate browser-context acceptance

**Do not confuse this with two physical devices connected to production.** This test runs two isolated Chromium BrowserContexts (desktop and mobile viewports) against an ephemeral HTTP service bound to `127.0.0.1` inside GitHub Actions. The API, login tokens, company, invoices, ledger and CAS state are entirely fake.

- No Supabase endpoint, production ERP account, IndexedDB, Cloud Sync, bank, payroll, invoice tax platform, or real customer data is accessed.
- No file outside `p37-lab/p37-19e/` plus its dedicated CI workflow is added or modified in this stage.
- Browser tests exercise actual local HTTP GET and POST requests, 401/403, two concurrent expected-version submissions, one CAS winner and one conflict, replay rejection, plus injected `AFTER_APPEND` and `AFTER_REVISION` failures that leave the mock server state unchanged.
- After a synthetic successful write, expected gross is 1,283,100, effective receivable 1,160,900, retention 122,200, with 27,300 allowance. The authoritative original values and all mocked protected financial arrays stay unchanged.
- The test server accepts only explicitly fabricated case IDs and a single predetermined exact synthetic discount; authorization tokens are fake and kept in browser memory, never persisted.
- A successful mock server CAS is **not a formal ERP Store transaction**, a Supabase RPC test, or true multi-device cloud sync acceptance.
- These tests are deliberately **not wired into the deployed `index.html` or `beta`**; P37-14 continues blocking any real receipt where an allowance is linked.

Before enabling production, independently verify tax documentation; integrate all existing receipt/retention/cheque/dashboard and sync writers; perform real isolated Supabase multi-client tests, browser backup/rollback with accepted synthetic data, then obtain explicit formal release approval.

Run on CI with Playwright 1.57.0: `python p37-lab/p37-19e/browser_test.py`.