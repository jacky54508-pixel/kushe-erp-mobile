# P37-19S — original Canvas trends and P21 KPI detail drawer, synthetic-only preview

**Status:** isolated GitHub review branch only; no production/beta deploy. This is a real Chromium UI integration test for an *ephemeral* SHA-pinned presentation overlay. It is not a formal allowance workflow or official tax-credit note. Every displayed amount belongs to fictitious `P37-19-SYN-*` source records on `127.0.0.1`.

## Background

P37-19R demonstrated an adjusted read-only view of the original ERP Dashboard and Reports, but the original chart's `trendPoints(activeVm.data, ...)`, Dashboard KPI card drilldowns, and Reports revenue detail were still using unadjusted billing sources or unavailable routes. The user must not see a headline of 1,322,000 while its chart/detail totals still read 1,348,000. P37-19S addresses this **within isolated UI only**.

## Actual unmodified components used

- `assets/js/erp-store.js` (`1d74daabcf51a6f47b03bac9bbc5407ca881272d`), with its original `requireAllowancesFullyIntegrated` blocking any actual synthetic linked-allowance receipt.
- `assets/js/kpi-navigation.js` (`5f38cde3656b1716050c5da5d3886e0274d0bf6c`) is loaded **unchanged**, including the actual P21 read-only dialog, model registry, pagination, search and keyboard interactions.
- `assets/js/dashboard.js` (`7526d31ad66cea0716eaa5351d25b7ccc72c3a5f`) and `assets/js/reports.js` (`ee8f75817113c825313c95b2c5942ce54d55b984`) are SHA-verified, then two strictly ephemeral **temporary file copies** are created by `lab_ui_overlay.py` in a disposable CI directory. The tracked originals are never modified.
- P37-19R's validated synthetic ledger adapter and original P37-18/P37-19C source checks are reused, not reimplemented as a second financial writer. R's original total reconciliation remains the source of truth.

## Tests and display consistency

- Render the original `KusheDashboard.init` and actual HTML5 Canvas chart from the adjusted source (not original billings). Verify November 2026 1,322,000; October 2026 50,000; Q4 2026 and whole 2026 both 1,372,000, with drawing pixels present.
- Press Enter on the original Dashboard revenue button to open the original P21 `<dialog>` with **two** synthetic source rows. Original vs reduction vs net values sum to 1,348,000 / 26,000 / 1,322,000 respectively.
- Open the retention alert's original P21 dialog, verifying 122,200 + 10,500 + 0 = **132,700**. Overall adjusted outstanding AR has **three** rows totaling **1,307,900**.
- Use the unmodified Reports renderer and original P21 model (`KusheKpi.model('reports.revenue')`, `reports.ar`) against the same approved source. Change Reports month to October and confirm unadjusted 50,000, then return to November.
- Reject unknown detail keys, stale/foreign/duplicate credit evidence through R/P37 readers and any real Store receipt write linked to an allowance. Independent browser reload recovers the same actual original Store snapshot from IndexedDB.

## Explicit limits

- The chart and drawer are **only** integrated inside the isolated fake UI. Real ERP Dashboard/Reports and original P21 app routing are unmodified; `main`, `beta`, formal financial data, PDF, bank, payroll, tax declarations and real Supabase RPC are untouched.
- This is **not** full formal report chart/KPI integration. Production UI still uses the original sources. True authenticated Supabase concurrency, official legal tax-credit vouchers, real-device cloud reconciliation, complete formal money writer integration, and owner release approval remain blocking.
- The P37-19Q 17-item formal release gate is still `NO_GO`. No P37-19S code may be auto-mounted in `index.html` or merged into formal code based solely on this isolated test.

**An isolated CI PASS here validates numeric source consistency, not real bank posting or permission to issue a credit note.**