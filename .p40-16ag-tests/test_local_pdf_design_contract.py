"""P40-16AG: offline *design contract* tests for a future device-local PDF.

Pure stdlib synthetic examples, never imports the ERP, opens a browser,
fetches any company data or generates actual PDF bytes. This does NOT
establish PDF one-page / font / content correctness. The mock gate explicitly
uses fake validated metrics, solely to check required denial rules.
"""
import copy
import hashlib
import unittest
from dataclasses import dataclass

ALLOWED_TOP = {
    "schema", "documentType", "title", "customer", "project", "date",
    "taxMode", "lines", "itemSummary", "salesAmount", "taxAmount",
    "totalAmount", "retentionAmount", "receivableAmount", "publicNote",
    "company", "isMergedExternalBilling"
}
ALLOWED_LINE = {"house", "item", "unit", "qty", "price", "amount"}
ALLOWED_COMPANY = {"name", "englishName", "taxId", "address", "phone", "line"}
DISALLOWED_STRINGS = [
    "PRIVATE-INVOICE-08", "PRIVATE-INVOICE-10", "PRIVATE-BANK",
    "PRIVATE-SALARY", "PRIVATE-COMMISSION", "PRIVATE-AUTH",
    "PRIVATE-SNAPSHOT"
]

class StopExport(Exception):
    pass

def model_public_view(erp_owned_source, selected_project):
    """Fictional sample source, NOT the official ERP merged-billing adapter."""
    if not isinstance(erp_owned_source, dict):
        raise StopExport("INVALID_SOURCE")
    if erp_owned_source.get("project") != selected_project:
        raise StopExport("WRONG_PROJECT")
    if erp_owned_source.get("status") != "active":
        raise StopExport("HISTORICAL_REQUIRES_SEPARATE_PRIVACY_REVIEW")
    lines = erp_owned_source.get("lines")
    summary = erp_owned_source.get("itemSummary")
    if not isinstance(lines, list) or not lines or not isinstance(summary, list) or not summary:
        raise StopExport("MISSING_SOURCE_OR_SUMMARY")
    if any(not isinstance(l, dict) or not ALLOWED_LINE.issubset(l) for l in lines+summary):
        raise StopExport("INVALID_LINE_STRUCTURE")
    if len(lines)>300 or len(summary)>300:
        raise StopExport("NOT_SUPPORTED_BY_THIS_FIXTURE")
    try:
        view = {k:copy.deepcopy(erp_owned_source[k]) for k in ALLOWED_TOP
                if k not in ("lines", "itemSummary", "company")}
        view["lines"] = [{k:copy.deepcopy(l[k]) for k in ALLOWED_LINE} for l in lines]
        view["itemSummary"] = [{k:copy.deepcopy(l[k]) for k in ALLOWED_LINE} for l in summary]
        view["company"] = {k:copy.deepcopy(v) for k,v in erp_owned_source["company"].items()
                           if k in ALLOWED_COMPANY}
    except (KeyError, TypeError):
        raise StopExport("MISSING_PUBLIC_FIELD")
    if set(view) != ALLOWED_TOP:
        raise StopExport("PUBLIC_FIELDS_INCOMPLETE")
    if any(not l["item"] or not l["house"] for l in view["lines"]):
        raise StopExport("INVALID_ITEM_LABEL")
    # No recomputation of real ERP taxes/discounts/retentions in a PDF renderer.
    for k in ("salesAmount","taxAmount","totalAmount","retentionAmount","receivableAmount"):
        if isinstance(view[k],bool) or not isinstance(view[k],int) or view[k]<0:
            raise StopExport("UNTRUSTED_TOTAL")
    if view["salesAmount"] + view["taxAmount"] != view["totalAmount"]:
        raise StopExport("SYNTHETIC_TOTAL_MISMATCH")
    if view["totalAmount"] - view["retentionAmount"] != view["receivableAmount"]:
        raise StopExport("SYNTHETIC_RETENTION_MISMATCH")
    if any(s in repr(view) for s in DISALLOWED_STRINGS):
        raise StopExport("PRIVATE_DATA_LEAK")
    return view

@dataclass(frozen=True)
class MockPdfAudit:
    """Fixture-only simulated evaluation: production must parse actual PDF."""
    page_count: int | None
    page_size: str | None
    min_text_pt: float | None
    original_items: int | None
    summary_items: int | None
    monetary_fields_verified: bool
    font_and_logo_verified: bool
    no_clipping: bool
    no_private_text: bool
    selected_region_only: bool

class FutureLocalOnlyHandoff:
    """Strict policy sketch. It does NOT verify any actual PDF content."""
    def __init__(self):
        self.verified = {}

    def gate(self, b, view, audit):
        if not isinstance(b,bytes) or not b.startswith(b"%PDF"):
            raise StopExport("NO_PDF_BYTES")
        if not isinstance(audit,MockPdfAudit):
            raise StopExport("NO_INDEPENDENT_AUDIT")
        if (audit.page_count != 1 or audit.page_size != "A4"
            or audit.min_text_pt is None or audit.min_text_pt < 8.0
            or audit.original_items != len(view["lines"])
            or audit.summary_items != len(view["itemSummary"])
            or not all((audit.monetary_fields_verified, audit.font_and_logo_verified,
                        audit.no_clipping,audit.no_private_text,audit.selected_region_only))):
            raise StopExport("RENDER_OR_CONTENT_NOT_VERIFIED")
        digest=hashlib.sha256(b).hexdigest()
        self.verified[digest] = b
        return digest

    def deliver(self, digest, submitted):
        if digest not in self.verified or self.verified[digest] != submitted:
            raise StopExport("PDF_BYTES_DIFFER_FROM_VERIFIED")
        if hashlib.sha256(submitted).hexdigest() != digest:
            raise StopExport("PDF_DIGEST_DIFFERS")
        return submitted

def fictional_source(count=18):
    lines=[
        {"house":f"H{i:02d}", "item":f"TEST-ITEM-{i:02d} 中文修補",
         "unit":"式","qty":1,"price":100,"amount":100,
         "invoiceNo":"PRIVATE-INVOICE-08","bank":"PRIVATE-BANK"}
        for i in range(1,count+1)]
    return {
        "schema":"kushe-external-document-v1", "documentType":"billing",
        "title":"請款單", "customer":"虛構建商", "project":"FAKE-M區",
        "date":"2026-11-18", "taxMode":"未稅", "status":"active",
        "lines":lines,"itemSummary":copy.deepcopy(lines),
        "salesAmount":count*100,"taxAmount":count*5,"totalAmount":count*105,
        "retentionAmount":0,"receivableAmount":count*105,
        "publicNote":"這是虛構測試資料",
        "company":{"name":"虛構公司","taxId":"00000000",
                   "bank":"PRIVATE-BANK","secret":"PRIVATE-AUTH"},
        "isMergedExternalBilling":True,
        "sourceSnapshots":[{"invoiceNo":"PRIVATE-INVOICE-10",
                            "salary":"PRIVATE-SALARY",
                            "commission":"PRIVATE-COMMISSION",
                            "data":"PRIVATE-SNAPSHOT"}],
        "auth":{"token":"PRIVATE-AUTH"}
    }

def passed_audit(n):
    return MockPdfAudit(1,"A4",8.1,n,n,True,True,True,True,True)

class LocalPdfDecisionTests(unittest.TestCase):
    def setUp(self):
        self.source = fictional_source(18)
        self.clean = model_public_view(self.source,"FAKE-M區")
        self.handoff = FutureLocalOnlyHandoff()
        self.mock_pdf = b"%PDF-1.7\nSYNTHETIC-BYTES-NOT-A-VALID-PDF\n"

    def test_input_unchanged_and_output_new_copy(self):
        earlier=copy.deepcopy(self.source)
        self.assertEqual(self.source, earlier)
        self.clean["lines"][0]["item"]="changed-output-only"
        self.assertEqual(self.source, earlier)

    def test_internal_invoice_bank_salary_auth_not_in_public_projection(self):
        self.assertEqual(set(self.clean),ALLOWED_TOP)
        joined=repr(self.clean)
        for term in DISALLOWED_STRINGS + ["sourceSnapshots","invoiceNo","salary","bank","auth"]:
            self.assertNotIn(term,joined)

    def test_wrong_region_and_inactive_are_blocked(self):
        with self.assertRaises(StopExport):
            model_public_view(self.source,"FAKE-L區")
        self.source["status"]="archived"
        with self.assertRaises(StopExport):
            model_public_view(self.source,"FAKE-M區")

    def test_no_detail_or_summary_cannot_export(self):
        for key in ("lines","itemSummary"):
            broken=copy.deepcopy(self.source)
            broken[key]=[]
            with self.assertRaises(StopExport):
                model_public_view(broken,"FAKE-M區")

    def test_missing_monetary_fields_are_rejected(self):
        bad=copy.deepcopy(self.source)
        del bad["totalAmount"]
        with self.assertRaises(StopExport):
            model_public_view(bad,"FAKE-M區")

    def test_synthetic_amount_discrepancy_is_blocked(self):
        bad=copy.deepcopy(self.source)
        bad["taxAmount"]=123
        with self.assertRaises(StopExport):
            model_public_view(bad,"FAKE-M區")

    def test_no_pdf_or_no_audit_cannot_be_delivered(self):
        with self.assertRaises(StopExport):
            self.handoff.gate(b"",self.clean,passed_audit(18))
        with self.assertRaises(StopExport):
            self.handoff.gate(self.mock_pdf,self.clean,None)

    def test_mock_one_page_a4_can_be_marked_verified(self):
        # Pure policy fixture, NOT evidence this byte string is a valid PDF.
        digest=self.handoff.gate(self.mock_pdf,self.clean,passed_audit(18))
        self.assertEqual(self.handoff.deliver(digest,self.mock_pdf),self.mock_pdf)

    def test_unverified_and_tampered_delivery_is_rejected(self):
        with self.assertRaises(StopExport):
            self.handoff.deliver("never-approved",self.mock_pdf)
        digest=self.handoff.gate(self.mock_pdf,self.clean,passed_audit(18))
        with self.assertRaises(StopExport):
            self.handoff.deliver(digest,self.mock_pdf+b"tamper")

    def test_overflow_two_pages_blocks(self):
        audit=MockPdfAudit(2,"A4",8.1,18,18,True,True,True,True,True)
        with self.assertRaises(StopExport):
            self.handoff.gate(self.mock_pdf,self.clean,audit)

    def test_missing_rows_or_summary_blocks(self):
        for nsource,nsummary in ((17,18),(18,17)):
            audit=MockPdfAudit(1,"A4",8.1,nsource,nsummary,True,True,True,True,True)
            with self.assertRaises(StopExport):
                self.handoff.gate(self.mock_pdf,self.clean,audit)

    def test_readability_small_text_blocks(self):
        audit=MockPdfAudit(1,"A4",7.9,18,18,True,True,True,True,True)
        with self.assertRaises(StopExport):
            self.handoff.gate(self.mock_pdf,self.clean,audit)

    def test_missing_stamp_or_private_leak_blocks(self):
        for changes in ({"font_and_logo_verified":False},
                        {"no_private_text":False},
                        {"selected_region_only":False},
                        {"no_clipping":False}):
            a=passed_audit(18)
            d={**a.__dict__,**changes}
            with self.assertRaises(StopExport):
                self.handoff.gate(self.mock_pdf,self.clean,MockPdfAudit(**d))

    def test_true_renderer_and_real_cjk_validation_still_missing(self):
        # Enforce no new deployment/test harness is mistaken for actual PDF.
        self.assertIn(b"NOT-A-VALID-PDF",self.mock_pdf)
        self.assertNotEqual(self.handoff.gate.__doc__, "production PDF renderer")
        self.assertEqual(self.source["status"],"active")

if __name__=="__main__":
    unittest.main(verbosity=2)
