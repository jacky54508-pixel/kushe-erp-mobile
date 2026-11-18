"""P40-16AP: a read-only, source-grounded production PDF entrypoint audit.

No PDF generation, Supabase connection, ERP data read/write, external network,
or true documents. Green means detected official print contracts and BLOCKS
match the pinned production sources; it NEVER means release readiness.
"""
import json
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
READ=ROOT/".p40-16ap-review/release_matrix.json"
MATRIX=json.loads(READ.read_text(encoding="utf-8"))
def src(path):
    return (ROOT/path).read_text(encoding="utf-8")

SINGLE=src("assets/js/billing-print.js")
SINGLE_HTML=src("billing-print.html")
BUNDLE=src("assets/js/billing-bundle-print.js")
BUNDLE_HTML=src("billing-bundle-print.html")
CROSS=src("assets/js/external-billing-print.js")
CROSS_HTML=src("external-billing-print.html")
GROUP=src("assets/js/billing-groups.js")
INVOICE=src("assets/js/external-billing-invoice.js")
INVOICE_UI=src("assets/js/external-billing-invoice-ui.js")
DISCOUNT=src("assets/js/billing-discount-preview.js")
DISCOUNT_GROUP=src("assets/js/billing-group-discount-preview.js")
PAGES=src(".github/workflows/pages.yml")

class PrintSourceAudit(unittest.TestCase):
    def test_matrix_remains_explicitly_release_blocked(self):
        self.assertEqual(MATRIX["disposition"],"PRODUCTION_RELEASE_BLOCKED")
        self.assertEqual(len(MATRIX["entrypoints"]),5)
        self.assertEqual({x["id"] for x in MATRIX["entrypoints"]},{
            "single","quotation","ordinary_combined","cross_zone_customer","cross_zone_archived"})
        self.assertTrue(all(x["status"]=="BLOCKED" for x in MATRIX["entrypoints"]))
        self.assertEqual(len(MATRIX["outstanding_gates"]),7)
        self.assertTrue(all(x["state"]=="BLOCK" for x in MATRIX["outstanding_gates"]))
        self.assertNotIn("READY",json.dumps(MATRIX["entrypoints"]))

    def test_official_single_and_quotation_share_one_renderer_but_distinct_modes(self):
        self.assertIn("window.KusheBillingPrint={",SINGLE)
        self.assertIn("window.KusheQuotationPrint={",SINGLE)
        self.assertIn("schema:'kushe-external-document-v1'",SINGLE)
        self.assertIn("documentType:type==='quotation'?'quotation':'billing'",SINGLE)
        self.assertIn("view.documentType==='quotation'?'酷舍_報價單':'酷舍_請款單'",SINGLE)
        self.assertIn("isQuote=d.documentType==='quotation'",SINGLE_HTML)
        self.assertIn("prepareQuotationPrint()",SINGLE_HTML)
        self.assertIn("isActual=isQuote",SINGLE_HTML)

    def test_official_single_protected_historical_amounts_are_source_of_truth(self):
        self.assertIn("billingDocumentState?.(record.id)",SINGLE)
        self.assertIn("documentInfo?.protected?documentInfo.amounts.untaxed",SINGLE)
        self.assertIn("documentInfo?.protected?documentInfo.amounts.retention",SINGLE)
        self.assertIn("documentInfo?.protected?documentInfo.amounts.receivable",SINGLE)
        self.assertIn("歷史請款金額或來源待核對，暫停匯出",SINGLE)
        self.assertIn("sourceType==='historical-supplement'",SINGLE)

    def test_single_pdf_is_native_print_without_exact_pdf_page_preflight(self):
        self.assertIn("new URL('billing-print.html",SINGLE)
        self.assertIn("location.assign(url.href)",SINGLE)
        self.assertIn("function printDocument()",SINGLE_HTML)
        self.assertIn("window.print()",SINGLE_HTML)
        self.assertIn("autoPrint=new URLSearchParams(location.search).get('print')==='1'",SINGLE_HTML)
        self.assertNotIn("pdf-lib",SINGLE_HTML.lower())
        self.assertNotIn("PyMuPDF",SINGLE_HTML)

    def test_ordinary_combined_has_independent_nested_schema_and_source_totals(self):
        self.assertIn("function buildCombinedView(rows)",BUNDLE)
        self.assertIn("schema:'kushe-combined-billing-v1'",BUNDLE)
        self.assertIn("documentType:'combined-billing'",BUNDLE)
        self.assertIn("sameCustomer(rows[0],row)",BUNDLE)
        self.assertIn("billings,",BUNDLE)
        self.assertIn("projects,",BUNDLE)
        self.assertIn("totals,",BUNDLE)
        self.assertIn("['salesAmount','taxAmount','totalAmount','retentionAmount','receivableAmount']",BUNDLE)

    def test_ordinary_combined_print_discloses_original_projects_and_invoice_status_only(self):
        self.assertIn("billings.map(billingSection)",BUNDLE_HTML)
        self.assertIn("來源請款單：",BUNDLE_HTML)
        self.assertIn("invoiceLabel(row.invoiceStatus)",BUNDLE_HTML)
        self.assertIn("合併請款總計",BUNDLE_HTML)
        self.assertIn("row.retentionAmount",BUNDLE_HTML)
        self.assertNotIn("row.invoiceNo",BUNDLE_HTML)
        self.assertNotIn("row.invoiceDate",BUNDLE_HTML)
        self.assertNotIn("sourceSnapshots",BUNDLE_HTML)
        self.assertNotIn("grouped-item-summary",BUNDLE_HTML)

    def test_general_combined_native_print_has_distinct_bypass_risk(self):
        self.assertIn("billing-bundle-print.html",BUNDLE)
        self.assertIn("location.assign(url.href)",BUNDLE)
        self.assertIn("function printDocument(){window.print()}",BUNDLE_HTML)
        self.assertIn("if(autoPrint)setTimeout(()=>window.print(),250)",BUNDLE_HTML)

    def test_cross_zone_active_print_reuses_single_original_template_and_target_only(self):
        self.assertIn("function originalTemplateView(payload,d)",CROSS)
        self.assertIn("const mergedBillingProjects=[String(d.displayProjectName||'').trim()]",CROSS)
        self.assertIn("project:d.displayProjectName",CROSS)
        self.assertIn("isMergedExternalBilling:true",CROSS)
        self.assertIn("if(!payload.historical)",CROSS)
        self.assertIn("billing-print.html?v=p39-inv1-pdf1&print=0",CROSS)
        self.assertIn("location.replace(url.href)",CROSS)
        self.assertIn("template.billingId!==d.targetBillingId",CROSS)
        self.assertNotIn("sourceSnapshots:",CROSS[CROSS.index("function originalTemplateView"):CROSS.index("document.getElementById('close')")])
        self.assertNotIn("sourceInvoiceReferences:",CROSS[CROSS.index("function originalTemplateView"):CROSS.index("document.getElementById('close')")])

    def test_archive_print_separately_prints_original_invoice_reference_details(self):
        historical=CROSS[CROSS.index("// Explicit historical-version viewing"):]
        self.assertIn("const refs=window.KusheExternalBillingInvoice.project",historical)
        self.assertIn("row.invoiceNo",historical)
        self.assertIn("row.invoiceDate",historical)
        self.assertIn("原請款／發票對照",historical)
        self.assertIn("payload.historical?",historical)
        self.assertIn("button.onclick=()=>window.print()",historical)
        self.assertIn("保存版本・僅供查閱",historical)

    def test_saved_document_print_switch_recognizes_archived_and_current_versions(self):
        self.assertIn("function printSaved(id,revision=0,historyOnly=false)",GROUP)
        self.assertIn("const historical=historyOnly||g.document.status!=='active'",GROUP)
        self.assertIn("if(!historical)",GROUP)
        self.assertIn("window.KusheBillingPrint.buildExternalView(primary)",GROUP)
        self.assertIn("external-billing-print.html?v=p39-inv1-invoice-reference",GROUP)
        self.assertIn("payload.template=",GROUP)
        self.assertIn("payload.document.history",GROUP)

    def test_invoice_projection_is_not_authority_to_rewrite_source_invoices(self):
        self.assertIn("window.KusheExternalBillingInvoice.project",CROSS)
        self.assertIn("sourceInvoiceReferences=window.KusheExternalBillingInvoice.project",CROSS)
        self.assertIn("發票對照來源請款／應收重複或缺漏",INVOICE)
        self.assertIn("原請款／發票對照",INVOICE_UI)
        self.assertIn("開票月份只取各原單實際發票日期",INVOICE_UI)

    def test_discount_entrances_are_read_only_and_independent_of_pdf(self):
        self.assertIn("Read-only billing concession preview",DISCOUNT)
        self.assertIn("No saves, sync, PDF or Store writes",DISCOUNT)
        self.assertIn("PREVIEW ONLY",DISCOUNT_GROUP)
        self.assertIn("原始請款、對外施工明細、發票、收款及薪資全部保持不變",DISCOUNT_GROUP)
        self.assertNotIn("KusheP40DiscountPreview",SINGLE_HTML)
        self.assertNotIn("KusheP40DiscountPreview",BUNDLE_HTML)

    def test_AO_style_was_lab_only_and_must_not_be_misrepresented_as_deployed(self):
        self.assertIn(".paper.invoice-group-document .seal-wrap{height:19mm}",SINGLE_HTML)
        self.assertIn("font-size:21pt",SINGLE_HTML)
        self.assertIn("font-size:21.5pt",SINGLE_HTML)
        self.assertNotIn("p40-16ao",SINGLE_HTML.lower())
        self.assertNotIn("p40-16ao",PAGES.lower())
        self.assertFalse((ROOT/".p40-16ao-tests").exists())
        self.assertEqual(MATRIX["evidence"][-1]["phase"],"P40-16AO")

    def test_static_pages_deploy_only_actual_main_beta_contents(self):
        self.assertIn("main",PAGES)
        self.assertIn("beta",PAGES)
        self.assertNotIn("p40-16ap",PAGES.lower())
        self.assertFalse((ROOT/"package.json").exists() and
                         "p40-16ap" in src("package.json").lower())

    def test_deliverable_requires_real_pdf_bytes_and_safe_all_routes(self):
        as_string=json.dumps(MATRIX,ensure_ascii=False)
        self.assertIn("PDF bytes",as_string)
        self.assertIn("window.print()",as_string)
        self.assertIn("original invoice",as_string)
        self.assertIn("historical",as_string)
        self.assertEqual(MATRIX["next_recommendation"]["id"],"P40-16AQ")

if __name__=="__main__":
    unittest.main()
