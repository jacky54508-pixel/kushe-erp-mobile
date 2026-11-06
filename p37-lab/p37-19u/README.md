# P37-19U — Chromium acceptance of standalone P37-19T candidate

**Independent review branch, not beta/main.** Runs actual original ERP Store, original P21 KPI drawer, standalone P37-19T candidate and P37-18/P37-19C review ledgers against fictional documents in a new Chromium browser profile on a private `127.0.0.1` CI server.

## What passes in this isolated test

The candidate consumes the same original Store snapshot as the original Dashboard baseline. It returns a reconciled read-only adjusted view that is displayed through temporary **SHA-pinned Dashboard and Reports presentation copies**. Actual unmodified P21 dialog opens on a synthetic KPI button; its source rows sum to the exact revenue, outstanding receivable and retention balances displayed by original UI components. The real original Canvas trend renderer reads the candidate's 12-month, quarterly and annual chart points. Re-opening the browser re-reads IndexedDB and recomputes the candidate without a persistent parallel report data store.

Fictitious example: original November untaxed sales NT$1,348,000 -> proposed NT$1,322,000; original open AR NT$1,332,600 -> proposed NT$1,307,900; original open retention NT$135,300 -> proposed NT$132,700. October untaxed sales remains NT$50,000. These amounts are NOT company figures.

### Historical / incomplete source acceptance gate

The browser test constructs **in-memory-only cloned** legacy scenarios: a historical bill without its AR, an orphan AR without a bill, a duplicate bill, two receivables related to one bill, an inaccurate source number, an invoiced record without the invoice, duplicated voucher, and altered tax. In every case the actual candidate must refuse to calculate, with no modified original Store snapshot. Revoked/mismatched owner permission, stale revision, false official tax verification and attempted financial writer mode must all reject. This does **not** mean the candidate can already process all genuine historic ERP data; it intentionally blocks ambiguous data and provides no migration or automatic correction.

### Safety and limits

The test supplies a **fake** matching owner/company context to the read-only method; it does not authenticate with real Supabase. `serverSignatureVerified:false`, `releaseGate:'NO_GO'`, `mayMountProduction:false`, and `canPost:false` are mandatory. The unchanged formal Store must still reject attempts to receive money against the linked fake allowance.

Only the new `p37-lab/p37-19u` folder and an isolated GitHub Actions workflow are added. Dashboard and Reports are patched only as **temporary local files generated inside CI**, not in repository `assets/js`. Existing `assets/js/p37-19t-readonly-integration-candidate.js` is imported **unchanged**. No official ERP business records, company credentials, legal vouchers, true dual-authenticated Supabase RPC concurrency, cloud synchronization or payroll writer are involved.

Before any real beta/main deployment, the P37-19Q 17 formal release NO-GO criteria and owner approval remain required. This test demonstrates technical UI compatibility only.