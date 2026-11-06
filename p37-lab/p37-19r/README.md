# P37-19R — actual Dashboard and Reports aligned to one effective synthetic read-only source

**Scope:** strictly isolated review in Chromium, `http://127.0.0.1` only. This work does **not** modify the real ERP Store, Dashboard, Reports, index.html, Cloud Sync, Supabase, beta or main. No formal invoice is issued, no account data is imported and no bank/receipt/salary writer is activated.

## Verified sources (not simulated replacements)

- Original `assets/js/erp-store.js` SHA `1d74daabcf51a6f47b03bac9bbc5407ca881272d`.
- Original `assets/js/dashboard.js` SHA `7526d31ad66cea0716eaa5351d25b7ccc72c3a5f`.
- Original `assets/js/reports.js` SHA `ee8f75817113c825313c95b2c5942ce54d55b984`.
- Original `assets/js/p37-billing-formal-readonly-projection.js` SHA `25a9ccd74871dab63894e7c0cce3ee63239dfe4d`.
- P37-18 effective-ledger source, to independently validate single bill/AR/invoice/credit-note relations and the original-versus-approved money math. The posted-shaped credit-note data is **synthetic** and is **not an officially verified tax voucher**.

## What is added

- An isolated browser-only augmentation makes three invented bills (one in October, two in November), including a *fake* approved-shaped allowance for NT$27,300. Every customer, project, billing, receivable, invoice and allowance ID is synthetic. The other deliberately unverified fixture from P37-19N is excluded from this **read-only** exercise. Actual production data is never touched.
- `effective-kpi-reader.js` is a pure projection: it verifies the original unmodified Store snapshot revision, each bill-to-AR relation, the **existing** P37-18/P37-19C ledgers, original dashboard amounts, the discount split and historical financial immutability. It yields an adjusted view without writing to any input object.
- The new lab controller feeds that adjusted view to the original `KusheDashboard.render` and makes `KusheReports.render` consume the **same** read-only snapshot using a wrapper that exists ONLY inside the disposable local test page. No original UI file or writer is patched or mounted in ERP `index.html`.
- The lab compares dashboard/report November revenue, outstanding AR, retention attention, project billed revenue and profit, and verifies unchanged October, bank cash, collected principal, payroll and historical invoice. It checks the original Store still rejects `addReceipt` on linked synthetic allowance. Fake voucher, duplicate identity, stale revision, non-synthetic ID, and forged official-tax flag all fail closed.

## Expected synthetic reconciliation

| Item | Original | Approved preview | Delta |
|---|---:|---:|---:|
| Nov untaxed sales | NT$1,348,000 | NT$1,322,000 | −26,000 |
| All open AR | NT$1,332,600 | NT$1,307,900 | −24,700 |
| Retention open | NT$135,300 | NT$132,700 | −2,600 |
| Project untaxed billed (lifetime) | NT$1,398,000 | NT$1,372,000 | −26,000 |
| Bank income | 0 | 0 | 0 |
| October untaxed sales | NT$50,000 | NT$50,000 | 0 |

### Deliberately not marked complete

Actual posted credit note/official invoice tax difference, chart trend series, original P21 KPI drilldowns, original commission unlock and payment writers, real cloud two-auth CAS and real device reconciliation **remain not integrated**. The calculator exposes `kpiDrilldownsIntegrated=false`, `dashboardTrendChartIntegrated=false`, `productionReady=false` and `canPost=false`. It must never be described as a production-ready finance presentation.

### Release guard

The P37-19Q formal release gate remains `NO_GO` with 17 blockers. Even if Chromium CI passes, this is only evidence that original dashboard/report screens **can** use a consistent read-only ledger in a sandbox. It is **not** permission to merge into beta/main or upload bank data. The existing `requireAllowancesFullyIntegrated` stays in effect for all actual receipts, cheques, retention and commission payouts.