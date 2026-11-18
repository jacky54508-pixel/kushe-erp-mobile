"""P40-16AR — actual AQ current cross-zone browser print -> verifiable
PDF bytes -> one-use loopback HTTP response of EXACTLY those checked bytes.

Everything is fictional. Auth/MFA/company/revision checks use SYNTHETIC
objects created in this script. The local endpoint MUST NOT be deployed or
connected to the real ERP, Supabase, client hashes or genuine source data.
"""
import ast
import base64
import functools
import hashlib
import http.server
import importlib.util
import json
import re
import threading
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import quote

import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16ar-review"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(),"STOP: no secret-bearing file permitted"
SOURCE=ROOT/"billing-print.html"
assert "p40aq-current-customer-zone" in SOURCE.read_text(),"AQ candidate missing"
assert not (ROOT/"billing-print-main-baseline-ci.html").exists(),"unexpected old baseline file"

spec=importlib.util.spec_from_file_location(
    "p40ar_lab_gate", ROOT/".p40-16ar-tests/verified_bytes_handoff.py"
)
module=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=module
spec.loader.exec_module(module)
Refused=module.Refused
FakePrincipal=module.FakePrincipal
SyntheticRecord=module.SyntheticRecord
Store=module.SyntheticReadOnlyStore
Gate=module.VerifiedPdfHandoff
TicketServer=module.LabTicketHttpServer

# Load only the literal fictional fixture function from AQ's prior test,
# avoiding any incidental PDF generation or production data access.
existing=(ROOT/".p40-16aq-tests/test_cross_zone_candidate_pdf.py").read_text()
tree=ast.parse(existing)
node=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=="fixture")
ns={}
exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),
             "pure fictitious fixture","exec"),ns)
fixture=ns["fixture"]

original_logo="""<svg xmlns="http://www.w3.org/2000/svg" width="180" height="140">
<rect x="1" y="1" width="178" height="138" fill="#f3f3f3" stroke="#777"/></svg>"""
original_seal="""<svg xmlns="http://www.w3.org/2000/svg" width="540" height="240">
<rect x="1" y="1" width="538" height="238" fill="#fff" stroke="#777"/></svg>"""
def html_data(svg):
    return "data:image/svg+xml,"+quote(svg,safe="")

website=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT))
)
threading.Thread(target=website.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{website.server_port}/"

def no_external_access(route):
    url=route.request.url
    if url.split("?")[0].endswith("/enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",body="<title>Only fictitious branding</title>")
    if route.request.resource_type=="image":
        return route.fulfill(status=200,content_type="image/svg+xml",body=original_logo)
    if url.startswith(BASE) or url.startswith("data:"):
        return route.continue_()
    return route.abort()

def expected_denial(call,code,case):
    try:
        call()
    except Refused as e:
        assert e.code==code,(case,code,e.code)
        return code
    raise AssertionError((case,"IMPROPER_ACCEPT",code))

def http_redeem(server,session_name,ticket):
    body=json.dumps({
        "session":session_name,"ticket":ticket.opaque_id,"digest":ticket.digest
    }).encode("utf-8")
    request=urllib.request.Request(
        server.address+"/lab-only/verified-pdf",data=body,method="POST",
        headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(request,timeout=10) as response:
            return response.status,response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,exc.headers,exc.read()

CASES=[
    ("8-short",fixture((4,4)),True),
    ("18-six-groups",fixture((9,9),repeat_groups=6),True),
    ("18-nine-groups",fixture((9,9)),True),
    ("30-six-groups",fixture((15,15),repeat_groups=6),False),
    ("30-fifteen-groups",fixture((15,15)),False)
]
REPORT=[]
EVENTS=[]
try:
    with sync_playwright() as runner:
        browser=runner.chromium.launch(headless=True)
        for device,width,height,mobile in (
            ("desktop",1280,900,False),("mobile-sim",390,844,True)
        ):
            ctx=browser.new_context(
                viewport={"width":width,"height":height},
                is_mobile=mobile,has_touch=mobile
            )
            for label,private_payload,should_deliver in CASES:
                case=device+"-"+label
                page=ctx.new_page()
                page.route("**/*",no_external_access)
                data=base64.b64encode(json.dumps(
                    private_payload,ensure_ascii=False,separators=(",",":")
                ).encode("utf-8")).decode("ascii")
                page.goto(BASE+"external-billing-print.html#"+quote(data,safe=""),
                          wait_until="domcontentloaded")
                page.wait_for_url(re.compile(r"billing-print\.html\?"))
                page.wait_for_function("window.__billingPrintReady===true")
                assert page.evaluate(
                    "document.getElementById('paper').classList.contains('p40aq-current-customer-zone')"
                ),(case,"STYLED_DOCUMENT_SCOPE_MISSING")
                public_view=page.evaluate("""()=>{
                   const hash=decodeURIComponent(location.hash.slice(1));
                   return JSON.parse(decodeURIComponent(escape(atob(hash))));
                }""")
                assert private_payload["document"]["displayProjectName"]=="虛構M區"
                assert public_view["mergedBillingProjects"]==["虛構M區"]
                assert not public_view.get("sourceInvoiceReferences")
                assert "PRIVATE-INVOICE" not in json.dumps(public_view,ensure_ascii=False)
                for hidden in ("虛構L區","虛構K區","虛構S區"):
                    assert hidden not in json.dumps(public_view,ensure_ascii=False)
                page.evaluate("""({logo,seal})=>{
                  const a=document.getElementById('formalCompanyLogo');
                  const b=document.getElementById('formalCompanySeal');
                  a.hidden=false;a.style.display='block';a.src=logo;
                  b.hidden=false;b.src=seal;
                }""",{"logo":html_data(original_logo),"seal":html_data(original_seal)})
                page.wait_for_function("[...document.images].every(x=>!x.src||x.complete)")
                page.emulate_media(media="print")
                rendered=page.pdf(print_background=True,prefer_css_page_size=True,
                    margin={"top":"0","right":"0","bottom":"0","left":"0"})
                docid=f"SYNTHETIC-{device}-{label}"
                revision="FAKE-REV-20261118-01"
                company="FAKE-CO-001"
                store=Store()
                record=SyntheticRecord(
                    document_id=docid,company_id=company,revision=revision,
                    private_payload=private_payload,approved_public_view=public_view)
                store.add(record)
                gate=Gate(store)
                owner=FakePrincipal(
                    principal_id=f"FAKE-USER-{device}",
                    company_id=company,visible_documents=frozenset({docid}))
                request_session=f"FAKE-SESSION-{device}-{label}"
                server=TicketServer(gate,{request_session:owner,
                    "FAKE-NOT-YOURS":FakePrincipal(
                        principal_id="FAKE-OTHER-USER",company_id=company,
                        visible_documents=frozenset({docid})
                    )})
                server.start()
                case_result={"case":case,"source_count":len(
                    private_payload["document"]["sourceSnapshots"]),
                    "original_lines":len(public_view["lines"]),
                    "candidate_pdf_pages":len(fitz.open(stream=rendered,filetype="pdf")),
                    "released":False,"blocked":False,
                    "original_invoice_excluded_from_download":True}
                try:
                    if should_deliver:
                        ticket=gate.approve(owner,docid,revision,rendered)
                        # Even with a correct ticket, another principal cannot
                        # retrieve PDF bytes. Wrong attempt must not consume.
                        status,headers,body=http_redeem(server,"FAKE-NOT-YOURS",ticket)
                        assert status==403 and body==b"",(case,"OTHER_USER_DOWNLOAD")
                        status,headers,download=http_redeem(server,request_session,ticket)
                        assert status==200 and headers.get_content_type()=="application/pdf",(
                            case,"NO_HTTP_PDF",status)
                        assert headers["Cache-Control"]=="no-store"
                        assert headers["Content-Disposition"].startswith("attachment;")
                        assert headers["X-SHA256"]==ticket.digest
                        assert headers["Content-Length"]==str(len(download))
                        assert download==rendered,(case,"NOT_IDENTICAL_RENDERED_PDF_BYTES")
                        assert hashlib.sha256(download).hexdigest()==ticket.digest
                        # Only these identical bytes can be exported by the lab:
                        (OUT/(case+".pdf")).write_bytes(download)
                        assert hashlib.sha256((OUT/(case+".pdf")).read_bytes()
                          ).hexdigest()==ticket.digest
                        case_result.update({"released":True,"sha256":ticket.digest,
                            "delivered_exact_rendered_bytes":True})
                        retry,_,again=http_redeem(server,request_session,ticket)
                        assert retry==403 and again==b"",(case,"TICKET_REPLAY")
                        EVENTS.append({"case":case,"defense":"WRONG_OWNER_AND_REPLAY_BLOCKED"})
                    else:
                        result=expected_denial(
                            lambda:gate.approve(owner,docid,revision,rendered),
                            "NOT_EXACTLY_ONE_A4_PAGE",case)
                        case_result.update({"blocked":True,"denial":result})
                        assert not (OUT/(case+".pdf")).exists()
                finally:
                    server.stop()
                print("P40AR_PDF_FIRST "+json.dumps(
                    case_result,ensure_ascii=False),flush=True)
                REPORT.append(case_result)

                # Adversarial checks on actual 8-row PDF bytes (desktop only),
                # not fake DOM-height heuristics.
                if label=="8-short" and device=="desktop":
                    docid="SYNTHETIC-desktop-8-short"
                    # Missing/expired auth, MFA, sync, wrong company, access
                    # lists, stale revisions all fail closed.
                    checks=[
                      ("FAKE_MFA_OR_SYNC_NOT_OK",FakePrincipal(
                          owner.principal_id,company,owner.visible_documents,mfa=False),
                       docid,revision),
                      ("FAKE_MFA_OR_SYNC_NOT_OK",FakePrincipal(
                          owner.principal_id,company,owner.visible_documents,synced=False),
                       docid,revision),
                      ("NO_FAKE_SESSION",FakePrincipal(
                          owner.principal_id,company,owner.visible_documents,signed_in=False),
                       docid,revision),
                      ("CROSS_COMPANY_REQUEST",FakePrincipal(
                          owner.principal_id,"FAKE-CO-OTHER",owner.visible_documents),
                       docid,revision),
                      ("NOT_IN_FAKE_DOCUMENT_ACCESS_LIST",FakePrincipal(
                          owner.principal_id,company,frozenset()),
                       docid,revision),
                      ("STALE_DOCUMENT_REVISION",owner,docid,"FAKE-REV-OLD")
                    ]
                    for code,actor,doc_ref,rev in checks:
                        expected_denial(lambda actor=actor,doc_ref=doc_ref,rev=rev:
                            gate.approve(actor,doc_ref,rev,rendered),
                            code,"AUTH-"+code)
                        EVENTS.append({"defense":code,"decision":"BLOCKED"})
                    # Tamper a valid PDF AFTER verification, including
                    # append-only modifications accepted by PDF viewers.
                    issued=gate.approve(owner,docid,revision,rendered)
                    gate.simulated_corrupt_store_for_test(issued)
                    expected_denial(lambda:gate.redeem(owner,issued),
                        "STORED_BYTES_CHANGED_AFTER_VERIFICATION","TAMPER")
                    EVENTS.append({"defense":"TAMPER_AFTER_VALIDATION","decision":"BLOCKED"})
                    # A blank one-page A4 PDF passes pagecount but MUST fail
                    # original lines and required content checks.
                    blank=fitz.open()
                    blank.new_page(width=595.28,height=841.89)
                    fake_pdf=blank.tobytes()
                    blank.close()
                    expected_denial(lambda:gate.approve(owner,docid,revision,fake_pdf),
                        "REQUIRED_PRINT_SECTION_MISSING","BLANK_A4")
                    EVENTS.append({"defense":"BLANK_ONE_PAGE","decision":"BLOCKED"})
                    # Tamper the untrusted document projection; source-of-truth
                    # in the fake store must match raw original lines and sums.
                    old=record.approved_public_view
                    import copy
                    bad=copy.deepcopy(old)
                    bad["sourceSnapshots"]=private_payload["document"]["sourceSnapshots"]
                    record.approved_public_view=bad
                    expected_denial(lambda:gate.approve(owner,docid,revision,rendered),
                        "UNEXPECTED_PUBLIC_VIEW_SCHEMA","SENSITIVE_KEY")
                    bad=copy.deepcopy(old)
                    bad["project"]="虛構L區"
                    record.approved_public_view=bad
                    expected_denial(lambda:gate.approve(owner,docid,revision,rendered),
                        "PUBLIC_TARGET_ZONE_MISMATCH","TARGET_SWITCH")
                    bad=copy.deepcopy(old)
                    bad["lines"][0]["amount"]+=1
                    record.approved_public_view=bad
                    expected_denial(lambda:gate.approve(owner,docid,revision,rendered),
                        "ORIGINAL_LINE_DATA_TAMPERED","LINE_TAMPER")
                    bad=copy.deepcopy(old)
                    bad["receivableAmount"]+=100
                    record.approved_public_view=bad
                    expected_denial(lambda:gate.approve(owner,docid,revision,rendered),
                        "APPROVED_AMOUNT_TAMPERED","AMOUNT_TAMPER")
                    record.approved_public_view=old
                    EVENTS.extend([
                        {"defense":"SENSITIVE_SOURCE_KEY","decision":"BLOCKED"},
                        {"defense":"OTHER_ZONE_AS_TARGET","decision":"BLOCKED"},
                        {"defense":"SOURCE_LINE_CHANGED","decision":"BLOCKED"},
                        {"defense":"APPROVED_AMOUNT_CHANGED","decision":"BLOCKED"}])
                    # Revocation AFTER approval must also deny a download.
                    later=gate.approve(owner,docid,revision,rendered)
                    record.enabled=False
                    expected_denial(lambda:gate.redeem(owner,later),
                        "SOURCE_NOT_AVAILABLE","REVOKED")
                    record.enabled=True
                    record.revision="FAKE-REV-UPDATED"
                    expected_denial(lambda:gate.redeem(owner,later),
                        "STALE_DOCUMENT_REVISION","SOURCE_NEWER")
                    EVENTS.extend([
                        {"defense":"REVOKED_AFTER_APPROVAL","decision":"BLOCKED"},
                        {"defense":"REVISION_CHANGED_AFTER_APPROVAL","decision":"BLOCKED"}])
                    record.revision=revision

                    # Deliberately force a second A4 page in ACTUAL browser
                    # printing; reject despite unchanged original source.
                    page.add_style_tag(content=
                        "@media print {.grouped-item-summary{break-before:page!important;page-break-before:always!important}}")
                    forced=page.pdf(print_background=True,prefer_css_page_size=True)
                    assert len(fitz.open(stream=forced,filetype="pdf"))>=2
                    expected_denial(lambda:gate.approve(owner,docid,revision,forced),
                        "NOT_EXACTLY_ONE_A4_PAGE","FORCED_CSS")
                    EVENTS.append({"defense":"FORCED_SECOND_PAGE","decision":"BLOCKED"})

                    # A PDF that is one A4 page but shows a source private
                    # invoice ID is invalid even if other layout fields pass.
                    forbidden=fitz.open(stream=rendered,filetype="pdf")
                    forbidden[0].insert_text((70,80),"PRIVATE-INVOICE-01",fontsize=11)
                    exposed=forbidden.tobytes()
                    forbidden.close()
                    expected_denial(lambda:gate.approve(owner,docid,revision,exposed),
                        "PRIVATE_SOURCE_INFORMATION_PRINTED","INVOICE_LEAK")
                    EVENTS.append({"defense":"INVOICE_IN_PRINTED_PDF","decision":"BLOCKED"})

                page.close()
            ctx.close()
        browser.close()
finally:
    website.shutdown()
    website.server_close()

assert len(REPORT)==10
assert len([r for r in REPORT if r["released"]])==6
assert len([r for r in REPORT if r["blocked"]])==4
assert len(list(OUT.glob("*.pdf")))==6
assert all(r.get("delivered_exact_rendered_bytes") for r in REPORT if r["released"])
manifest={
    "phase":"P40-16AR","isolated_lab_only":True,
    "actual_production_service_deployed":False,
    "production_auth_or_mfa_integrated":False,
    "server_document_source":"SYNTHETIC_FAKE_IN_MEMORY_ONLY",
    "browser_native_print_blocked":False,
    "all_pdf_handoff_bytes_digest_locked":True,
    "allowed_case_count":6,"blocked_capacity_case_count":4,
    "adversarial_events":EVENTS,"cases":REPORT
}
(OUT/"results.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
print("P40AR_LAB_COMPLETE: deliver same verified bytes via one-time localhost HTTP POST; overflow/unauthorized/stale/tampered/blank/privacy rejected.")
print("PRODUCTION BLOCKED: no trusted live single-document source, no real Auth/MFA, no in-product button and no native File Print interception.")
