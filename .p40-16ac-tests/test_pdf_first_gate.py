"""P40-16AC: PDF-FIRST verification / controlled handoff -- SYNTHETIC LOCAL LAB.

This is NOT a production browser feature or authorization to deploy. An
external trusted Playwright host creates a PDF, Python/PyMuPDF checks the
actual serialized bytes, and only then a gate returns those SAME bytes.
Rejected PDF bytes never enter the lab's public approved artifact folder.

Never accesses real users, Supabase, live invoice records, company logo/seal,
network outside loopback, or formal main/beta. This script cannot stop browser
File > Print and should NOT be represented as such. The pipeline is a
feasibility proof for an eventual controlled server/desktop PDF export.
"""
import ast
import base64
from dataclasses import dataclass
import functools
import hashlib
import http.server
import json
import re
import threading
from pathlib import Path
from urllib.parse import quote

import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16ac-review"
APPROVED=OUT/"approved-synthetic-only"
APPROVED.mkdir(parents=True,exist_ok=True)
assert not (ROOT/".env").exists(),"STOP: .env in repository"

def constants(path,keys):
    t=ast.parse(path.read_text())
    result={}
    for n in t.body:
        if isinstance(n,ast.Assign):
            for key in n.targets:
                if isinstance(key,ast.Name) and key.id in keys:
                    result[key.id]=ast.literal_eval(n.value)
    assert set(result)==set(keys),("missing test fixtures",path,keys)
    return result

v=constants(ROOT/".p40-16v-tests/test_print_style_profiles.py",["PROFILES"])
x=constants(ROOT/".p40-16x-tests/test_two_column_summary.py",["TWOCOL_JS","COL_CSS"])
y=constants(ROOT/".p40-16y-tests/test_footer_capacity.py",["STAMP_JS","STAMP_CSS","FOOT_JS","FOUR"])
z=constants(ROOT/".p40-16z-tests/test_chinese_a4_guard.py",["LOGO_JS","LOGO_CSS"])

server=http.server.ThreadingHTTPServer(("127.0.0.1",0),
        functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def fixture(n,kind,long_note=False):
    lines=[]
    for i in range(1,n+1):
        if kind=="short":item=f"AC{i:02d}-門框局部修補"
        elif kind=="medium":item=f"AC{i:02d}-地坪破損美容及收邊"
        else:item=f"AC{i:02d}-浴室門檻與牆角防水層修補及油漆收邊整修"
        lines.append({"house":f"HS{i:02d}","item":item,"unit":"式",
             "qty":1,"price":100,"amount":100,
             "sourcePricingType":"external-document","pricingType":""})
    note=("測試長備註：施工位置及方法需詳細核對，材料處理及修繕數量以施工確認為準。" * 6
          if long_note else "此為虛構測試文件，禁止寄送建商")
    return {
        "schema":"kushe-external-document-v1","documentType":"billing","title":"請款單",
        "number":"","customer":"虛構測試建商","project":"SYNTH-M區","date":"2026-11-17",
        "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
        "lines":lines,"salesAmount":100*n,"taxAmount":5*n,
        "totalAmount":105*n,"retentionAmount":0,"receivableAmount":105*n,
        "publicNote":note,
        "company":{"name":"虛構測試公司","englishName":"SYNTHETIC ONLY",
                   "taxId":"00000000","address":"虛構地址","line":"SYNTH"},
        "fileName":"SYNTHETIC-DO-NOT-SEND.pdf",
        "mergedBillingProjects":["SYNTH-M區"],"isMergedExternalBilling":True,
        # Sentinel exists in source input but must never appear in external PDF:
        "privateInvoiceNumber":"P40AC_PRIVATE_INVOICE_08",
        "internalInvoiceReferences":["P40AC_PRIVATE_INVOICE_10"]
    }

def encoded(d):
    return quote(base64.b64encode(json.dumps(
        d,ensure_ascii=False,separators=(",",":")).encode()).decode(),safe="")

def local_only(route):
    url=route.request.url
    if url.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
                body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    return route.continue_() if url.startswith(BASE) else route.abort()

class RejectedPdf(Exception):
    def __init__(self,reasons):
        super().__init__("; ".join(reasons))
        self.reasons=reasons

@dataclass(frozen=True)
class VerifiedPdf:
    digest:str
    n:int
    case:str

class ControlledHandoff:
    """In-memory only approved byte registry. Does not secure browser hotkeys."""
    def __init__(self):
        self._approved={}

    def verify(self,pdf_bytes,source,case,min_table_pt):
        problems=[]
        n=len(source["lines"])
        if not isinstance(pdf_bytes,bytes) or not pdf_bytes.startswith(b"%PDF"):
            raise RejectedPdf(["NOT_PDF"])
        try:
            doc=fitz.open(stream=pdf_bytes,filetype="pdf")
        except Exception:
            raise RejectedPdf(["UNREADABLE_PDF"])
        try:
            if len(doc)!=1:problems.append("NOT_ONE_A4_PAGE")
            for page in doc:
                if not (590<=page.rect.width<=597 and 839<=page.rect.height<=844):
                    problems.append("NOT_A4")
            content=re.sub(r"\s+","", "".join(p.get_text(sort=True) for p in doc))
            # Do not check only source length: the amount and source must agree.
            amount=sum(float(line["qty"])*float(line["price"]) for line in source["lines"])
            if amount!=source["salesAmount"] or amount+source["taxAmount"]!=source["totalAmount"]:
                problems.append("SOURCE_AMOUNTS_INCONSISTENT")
            if source["receivableAmount"]!=source["totalAmount"]-source["retentionAmount"]:
                problems.append("SOURCE_RECEIVABLE_INCONSISTENT")
            for i,line in enumerate(source["lines"],1):
                if f"HS{i:02d}" not in content:problems.append(f"MISSING_ORIGINAL_{i}")
                if f"AC{i:02d}" not in content:problems.append(f"MISSING_ITEM_{i}")
            for label in ("施工項目彙總","原施工明細合計","明細合計",
                          "請款金額","客戶簽章","公司大小章",
                          "MOCK-LOGO","SYNTH-SEAL-BOX","SYNTH-M區"):
                if label not in content:problems.append("MISSING_FIELD_"+label)
            total_string=f"{int(source['totalAmount']):,}"
            if total_string not in content and str(int(source["totalAmount"])) not in content:
                problems.append("WRONG_GROSS_AMOUNT")
            for forbidden in (
                "P40AC_PRIVATE_INVOICE_08","P40AC_PRIVATE_INVOICE_10",
                "原票號／狀態","SYNTH-L區"):
                if forbidden.replace(" ","") in content:
                    problems.append("PRIVACY_LEAK")
            if min_table_pt<8:problems.append("FONT_BELOW_8PT")
            for page in doc:
                for block in page.get_text("dict")["blocks"]:
                    for line in block.get("lines",[]):
                        for span in line.get("spans",[]):
                            if not span.get("text","").strip():continue
                            x0,y0,x1,y1=span["bbox"]
                            if x0<-.5 or y0<-.5 or x1>page.rect.width+.5 or y1>page.rect.height+.5:
                                problems.append("TEXT_OUTSIDE_A4")
                                break
        finally:
            doc.close()
        if problems:
            raise RejectedPdf(sorted(set(problems)))
        digest=hashlib.sha256(pdf_bytes).hexdigest()
        self._approved[digest]=pdf_bytes
        return VerifiedPdf(digest=digest,n=n,case=case)

    def deliver(self,verified):
        if not isinstance(verified,VerifiedPdf):
            raise RejectedPdf(["UNVERIFIED_REQUEST"])
        data=self._approved.get(verified.digest)
        if data is None or hashlib.sha256(data).hexdigest()!=verified.digest:
            raise RejectedPdf(["MISSING_OR_INVALID_VERIFIED_BLOB"])
        return data

    def reject_altered_delivery(self,verified,proposed_bytes):
        # Would also catch append-only PDF tampering which a parser might accept.
        if hashlib.sha256(proposed_bytes).hexdigest()!=verified.digest:
            raise RejectedPdf(["BYTES_DIFFER_FROM_VERIFIED_PDF"])
        return self.deliver(verified)

CASES=[
    ("18-short",18,"short",False,False,True),
    ("30-medium",30,"medium",False,False,True),
    ("30-long",30,"long",False,False,False),
    ("30-long-note",30,"short",True,False,False),
    ("18-forced-css-break",18,"short",False,True,False)
]
GATE=ControlledHandoff()
RESULTS=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        for device,viewport,is_mobile in [
            ("desktop",{"width":1280,"height":900},False),
            ("mobile-sim",{"width":390,"height":844},True)
        ]:
            ctx=browser.new_context(viewport=viewport,is_mobile=is_mobile,has_touch=is_mobile)
            page=ctx.new_page()
            page.route("**/*",local_only)
            for label,n,kind,long_note,forced,should_release in CASES:
                case=f"{device}-{label}"
                source=fixture(n,kind,long_note)
                page.goto(BASE+f"billing-print.html?print=0&ac={case}#"+
                          encoded(source),wait_until="load")
                page.locator(".dense-original-details .dense-line-table").wait_for()
                page.add_style_tag(content=v["PROFILES"]["compact-a4-dense"])
                if n==30:
                    result=page.evaluate(x["TWOCOL_JS"])
                    assert result["rows"]==30 and result["twoColumns"]==2
                    page.add_style_tag(content=x["COL_CSS"])
                page.evaluate(y["STAMP_JS"]);page.add_style_tag(content=y["STAMP_CSS"])
                page.evaluate(y["FOOT_JS"]);page.add_style_tag(content=y["FOUR"])
                page.evaluate(z["LOGO_JS"]);page.add_style_tag(content=z["LOGO_CSS"])
                if forced:
                    page.add_style_tag(content="@media print {.grouped-item-summary {break-before:page!important;page-break-before:always!important}}")
                page.emulate_media(media="print")
                page.evaluate("async()=>{if(document.fonts?.ready)await document.fonts.ready}")
                original=page.locator(".dense-original-details .dense-line-table tbody tr").count()
                summary=(page.locator(".p40x-two-column-summary tbody tr").count()
                         if n==30 else page.locator(".grouped-item-summary-table tbody tr").count()-1)
                assert original==n+1 and summary==n,(case,original,summary)
                minfont=page.eval_on_selector_all(
                    ".dense-line-table th,.dense-line-table td,"
                    ".grouped-item-summary-table th,.grouped-item-summary-table td",
                    "(nodes)=>Math.min(...nodes.map(el=>parseFloat(getComputedStyle(el).fontSize)*72/96))")
                pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
                page_num=len(fitz.open(stream=pdf,filetype="pdf"))
                result={"case":case,"measured_pages":page_num,
                        "source_rows":n,"summary_rows":n,
                        "issued":False,"denials":[],"sha256":None}
                try:
                    verified=GATE.verify(pdf,source,case,minfont)
                    assert should_release, ("unexpected release",case,page_num)
                    delivered=GATE.deliver(verified)
                    assert delivered==pdf,"Validated bytes and published bytes MUST be identical"
                    path=APPROVED/f"{case}.pdf"
                    path.write_bytes(delivered)
                    assert hashlib.sha256(path.read_bytes()).hexdigest()==verified.digest
                    result.update({"issued":True,"sha256":verified.digest})
                    # Tamper-after-validation and unverified request must be refused.
                    try:GATE.reject_altered_delivery(verified,delivered+b"TRAILING_UNVERIFIED_BYTES")
                    except RejectedPdf as exc:
                        assert "BYTES_DIFFER_FROM_VERIFIED_PDF" in exc.reasons
                    else:raise AssertionError("tampered PDF was accepted")
                except RejectedPdf as exc:
                    assert not should_release,("valid PDF rejected",case,exc.reasons)
                    assert "NOT_ONE_A4_PAGE" in exc.reasons,(case,exc.reasons)
                    result["denials"]=exc.reasons
                assert result["issued"]==should_release
                assert not (APPROVED/f"{case}.pdf").exists() if not should_release else True
                RESULTS.append(result)
                print("P40AC_GATE_RESULT "+json.dumps(result,ensure_ascii=False),flush=True)
            ctx.close()
        browser.close()
finally:
    server.shutdown()

# Explicit adversarial checks independent of browser print pagination.
try:GATE.deliver("unapproved-file.pdf")
except RejectedPdf as e:assert "UNVERIFIED_REQUEST" in e.reasons
else:raise AssertionError("Ungated delivery was allowed")

blank=fitz.open()
blank.new_page(width=595,height=842)
bad=blank.tobytes()
blank.close()
try:GATE.verify(bad,fixture(18,"short"),"tampered-blank-pdf",8.5)
except RejectedPdf as e:assert any(x.startswith("MISSING_") for x in e.reasons)
else:raise AssertionError("Blank one-page A4 PDF wrongly accepted")

# Safety: approved artifacts ONLY for expected 1-page documents, never
# permit a blocked artifact via a changed extension or an unverified path.
expected_approved={f"{d}-{case}.pdf" for d in ("desktop","mobile-sim")
                   for case in ("18-short","30-medium")}
assert {p.name for p in APPROVED.glob("*.pdf")}==expected_approved
manifest={"lab_only":True,"production_ready":False,
          "verified_bytes_only":True,"results":RESULTS,
          "warning":"Host-side Chrome PDF and PyMuPDF validation only; NOT browser-native or production-ready"}
(OUT/"verification-manifest.json").write_text(
    json.dumps(manifest,ensure_ascii=False,indent=2))
print("P40AC_LAB_PASS: release exactly verified 1-page PDF bytes, reject overpage, forced CSS break, blank, unverified and tampered files.")
print("NO PRODUCTION MERGE: no actual ERP print interception, credentials, billing changes, cloud service or native menu blocking.")
