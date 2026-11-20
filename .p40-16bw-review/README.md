# P40-16BW — match owner-supplied original invoice PDF design (isolated)

This is NOT a production release. The user's original **達莉心閱 2026-11** customer-facing A4 billing PDF is the visual baseline. That private original PDF has NOT been uploaded to GitHub. The uploaded fixture is not business test data.

## What changed

- `assets/js/external-billing-print.js`: mark ONLY the external merged customer print projection `referenceTemplateStyle:'dali-standard-2026-11'` (both current and historic), without changing line items, amounts, retention, customer info, invoice data, source snapshots, or trusted source rules.
- `billing-print.html`: add CSS rules strictly under `.paper.billing-document.reference-template` for reference grayscale labels, white section title/background and unfilled table/amount rows. Add CSS class only if the explicitly marked external customer projection arrives. Existing standard single billing and quotation outputs retain their previous CSS.
- One read-only fake Chromium script tests the real browser popup, 390px and 1280px, A4 PDFs, public line items, company seals, construction summary, hidden private source data, and computed style colors. Its control check removes opt-in class and confirms prior dark-blue/gradient styles remain.

## Limits

- Sample fake billing totals are not the owner's real bill. Colors/layout are reference approximations; do not claim pixel-perfect match until an independent visual check of the actual PDF.
- Original ERP/Supabase/accounting/billing source, `main`, `beta`, Cloudflare deploy and customer data are NOT touched.
- No true smartphone/device acceptance, real customer PDFs, SYNCED confirmation, full restorable backup, or complete module regression.
- Retained PR #77 secure one-use browser transfer; not a shareable URL.

**NO MERGE / NO DEPLOY / PRODUCTION RELEASE BLOCKED**. Separate explicit owner consent and full acceptance required.
