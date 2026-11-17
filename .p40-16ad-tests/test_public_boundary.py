"""P40-16AD architecture contract tests. PURE SYNTHETIC; NO NETWORK/PRODUCTION.

These tests prove only the intended narrow request/public-view contract
can be expressed without leaking an internally enriched source fixture.
No production PDF server, Supabase permissions, or billing calculations
are modified or certified by this standalone demonstration.
"""
import copy
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
REQUEST_KEYS = frozenset({
    "documentType", "billingId", "targetProjectId", "expectedRevision"
})
PUBLIC_KEYS = frozenset({
    "schema", "documentType", "title", "customer", "project", "date",
    "taxMode", "invoiceStatus", "lines", "salesAmount", "taxAmount",
    "totalAmount", "retentionAmount", "receivableAmount", "publicNote",
    "company", "mergedBillingProjects", "isMergedExternalBilling"
})
PUBLIC_LINE_KEYS = frozenset({"house", "item", "unit", "qty", "price", "amount"})
PUBLIC_COMPANY_KEYS = frozenset({
    "name", "englishName", "taxId", "address", "phone", "line"
})
PRIVATE_KEYS = frozenset({
    "sourceSnapshots", "settlementSnapshots", "invoiceNo",
    "invoiceDate", "invoiceRefs", "bankAccounts", "bank", "salary",
    "payroll", "commissions", "access_token", "refresh_token",
    "session", "service_role", "secretKey", "auth"
})

def reject(reason):
    raise ValueError(reason)

def narrow_request(request):
    if not isinstance(request, dict):
        reject("request not a JSON object")
    if set(request) != REQUEST_KEYS:
        reject("unexpected request fields (no document snapshot or credentials)")
    if request["documentType"] not in ("billing", "merged-billing"):
        reject("unsupported or historical document type")
    for key in ("billingId", "targetProjectId", "expectedRevision"):
        value = request[key]
        if not isinstance(value, str) or not value or len(value) > 128:
            reject("missing or oversized reference")
        if any(ord(c) < 32 for c in value):
            reject("control character in reference")
    return dict(request)

def money(number):
    if isinstance(number, bool) or not isinstance(number, (str, int)):
        reject("expected explicit integer/cents-safe amount")
    try:
        d = Decimal(str(number))
    except InvalidOperation:
        reject("invalid amount")
    if d != d.to_integral_value():
        reject("fractional fixture amount unsupported")
    return d

def public_view_from_trusted_fixture(trusted, target):
    """Only server-trusted fixture may call this. NEVER client POST payload."""
    if trusted.get("status") != "active":
        reject("historical / unapproved view not supported")
    if trusted.get("project") != target:
        reject("wrong target zone")
    line_items = trusted.get("lines")
    if not isinstance(line_items, list) or not line_items:
        reject("no line items")
    public_lines=[]
    for line in line_items:
        if not isinstance(line, dict):
            reject("invalid line")
        public_line={key: copy.deepcopy(line[key]) for key in PUBLIC_LINE_KEYS}
        if money(public_line["qty"]) * money(public_line["price"]) != money(public_line["amount"]):
            reject("fixture line total mismatch")
        public_lines.append(public_line)
    sales=money(trusted["salesAmount"])
    tax=money(trusted["taxAmount"])
    gross=money(trusted["totalAmount"])
    retained=money(trusted["retentionAmount"])
    due=money(trusted["receivableAmount"])
    # Synthetic straight-per-line billing ONLY. Production mixed tax/retention
    # must use formally verified existing ERP business rules instead.
    if sales != sum((money(x["amount"]) for x in public_lines), Decimal("0")):
        reject("fixture sales amount mismatch")
    if sales + tax != gross or gross - retained != due:
        reject("fixture accounting consistency mismatch")
    public={key: copy.deepcopy(trusted[key])
            for key in PUBLIC_KEYS
            if key not in ("lines","company","mergedBillingProjects","isMergedExternalBilling")}
    public["lines"]=public_lines
    public["company"]={k:copy.deepcopy(v) for k,v in trusted["company"].items()
                       if k in PUBLIC_COMPANY_KEYS}
    public["mergedBillingProjects"]=[target]
    public["isMergedExternalBilling"]=bool(trusted["isMergedExternalBilling"])
    assert set(public) == PUBLIC_KEYS
    return public

def protected_key_paths(obj,path=""):
    found=[]
    if isinstance(obj,dict):
        for key,value in obj.items():
            if key in PRIVATE_KEYS:
                found.append(path+"."+key)
            found += protected_key_paths(value,path+"."+key)
    elif isinstance(obj,list):
        for i,value in enumerate(obj):
            found += protected_key_paths(value,path+f"[{i}]")
    return found

def fictional_source():
    return {
        "status":"active","schema":"kushe-external-document-v1",
        "documentType":"billing","title":"請款單","customer":"虛構建商",
        "project":"SYNTH-M區","date":"2026-11-17",
        "taxMode":"未稅","invoiceStatus":"invoice_pending",
        "lines":[
            {"house":"F01","item":"虛構門框美容","unit":"式","qty":1,
             "price":100,"amount":100,"invoiceNo":"PRIVATE-INV-01",
             "sourceSnapshots":{"private":"data"}},
            {"house":"F02","item":"虛構地坪修補","unit":"式","qty":2,
             "price":100,"amount":200,"bank":"NEVER_SEND"}
        ],
        "salesAmount":300,"taxAmount":15,"totalAmount":315,
        "retentionAmount":0,"receivableAmount":315,
        "publicNote":"虛構測試文件",
        "company":{"name":"虛構公司","englishName":"SYNTHETIC ONLY",
                   "taxId":"00000000","address":"虛構地址",
                   "secretKey":"DO_NOT_SEND"},
        "isMergedExternalBilling":True,
        "mergedBillingProjects":["SYNTH-M區","SYNTH-L區"],
        "sourceSnapshots":[{"invoiceNo":"REAL_LOOKALIKE-08","payroll":"PRIVATE"}],
        "settlementSnapshots":[{"invoiceDate":"PRIVATE"}],
        "auth":{"access_token":"NEVER_SEND"},
        "bankAccounts":[{"id":"NEVER_SEND"}],
        "salary":"NEVER_SEND",
        "commissions":"NEVER_SEND"
    }

class ReadOnlyContractTests(unittest.TestCase):
    def test_request_contains_only_references_not_source_snapshot(self):
        req={"documentType":"billing","billingId":"SYNTH-01",
             "targetProjectId":"SYNTH-M區","expectedRevision":"revision-001"}
        self.assertEqual(narrow_request(req),req)
        for field in ("sourceSnapshots","bank","invoiceNo","auth","access_token"):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    narrow_request({**req,field:"NEVER_SEND"})

    def test_client_cannot_switch_to_historical_document(self):
        req={"documentType":"archived","billingId":"SYNTH-01",
             "targetProjectId":"SYNTH-M區","expectedRevision":"revision-001"}
        with self.assertRaises(ValueError):
            narrow_request(req)

    def test_immutable_server_side_public_projection(self):
        trusted=fictional_source()
        original=copy.deepcopy(trusted)
        projected=public_view_from_trusted_fixture(trusted,"SYNTH-M區")
        self.assertEqual(trusted,original, "server-side projection must not modify source")
        self.assertEqual(set(projected),PUBLIC_KEYS)
        self.assertEqual(len(projected["lines"]),2)
        self.assertEqual(projected["project"],"SYNTH-M區")
        self.assertEqual(projected["mergedBillingProjects"],["SYNTH-M區"])
        self.assertEqual(protected_key_paths(projected),[])
        self.assertNotIn("PRIVATE-INV-01",json.dumps(projected))
        self.assertNotIn("NEVER_SEND",json.dumps(projected))
        self.assertNotIn("SYNTH-L區",json.dumps(projected,ensure_ascii=False))
        self.assertEqual(projected["totalAmount"],315)

    def test_target_project_cannot_be_switched_by_client(self):
        with self.assertRaises(ValueError):
            public_view_from_trusted_fixture(fictional_source(),"SYNTH-L區")

    def test_cost_tamper_is_denied_in_fixture(self):
        trusted=fictional_source()
        trusted["lines"][0]["price"]=999
        with self.assertRaises(ValueError):
            public_view_from_trusted_fixture(trusted,"SYNTH-M區")

    def test_archived_requires_separate_privacy_gate(self):
        trusted=fictional_source()
        trusted["status"]="archived"
        with self.assertRaises(ValueError):
            public_view_from_trusted_fixture(trusted,"SYNTH-M區")

    def test_no_pdf_server_added_to_main(self):
        # Contract check asserts this design is still not a production route.
        main=(ROOT/"billing-print.html").read_text()
        assert 'function printDocument()' in main
        assert 'window.print()' in main
        assert "const autoPrint=" in main
        view=(ROOT/"assets/js/billing-print.js").read_text()
        assert "url.hash=payload" in view
        group=(ROOT/"assets/js/billing-bundle-print.js").read_text()
        assert "url.hash=payload" in group
        public=(ROOT/"assets/js/external-billing-print.js").read_text()
        assert "sourceSnapshots" in public
        assert "originalTemplateView" in public
        assert "displayProjectName" in public

if __name__=="__main__":
    unittest.main(verbosity=2)
