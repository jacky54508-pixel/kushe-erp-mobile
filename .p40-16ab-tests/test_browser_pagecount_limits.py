"""P40-16AB: Browser-only preflight feasibility, NOT a production printing gate.

Caution: window.print()/beforeprint and CSS element geometry cannot give an
authoritative Chrome PDF page count. This test measures actual A4 PDF pages
versus CSS DOM approximations, including deliberate page-break false-positives.

All data fictitious, network loopback only, original ERP HTML never modified.
No browser native print jobs; PDF is produced by external Playwright driver.
"""
import ast, base64, functools, http.server, json, re, threading
from pathlib import Path
from urllib.parse import quote
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16ab-review"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(),"STOP secrets"

def literals(file,names):
    tree=ast.parse(file.read_text())
    result={}
    for node in tree.body:
        if isinstance(node,ast.Assign):
            for t in node.targets:
                if isinstance(t,ast.Name) and t.id in names:
                    result[t.id]=ast.literal_eval(node.value)
    assert set(result)==set(names),(file,result.keys())
    return result

v=literals(ROOT/".p40-16v-tests/test_print_style_profiles.py",["PROFILES"])
x=literals(ROOT/".p40-16x-tests/test_two_column_summary.py",["TWOCOL_JS","COL_CSS"])
y=literals(ROOT/".p40-16y-tests/test_footer_capacity.py",["STAMP_JS","STAMP_CSS","FOOT_JS","FOUR"])
z=literals(ROOT/".p40-16z-tests/test_chinese_a4_guard.py",["LOGO_JS","LOGO_CSS"])

server=http.server.ThreadingHTTPServer(("127.0.0.1",0),
    functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def payload(n,kind,long_note=False):
    lines=[]
    for i in range(1,n+1):
        name=(
            f"AB{i:02d}-門框局部修補" if kind=="short" else
            f"AB{i:02d}-地坪破損美容及收邊" if kind=="medium" else
            f"AB{i:02d}-浴室門檻與牆角防水層修補及油漆收邊整修")
        lines.append({"house":f"TEST-{i:02d}","item":name,"unit":"式","qty":1,
                      "price":100,"amount":100,"sourcePricingType":"external-document",
                      "pricingType":""})
    publicnote=("測試長備註：施工位置及方法經過詳細核對，材料處理及修繕數量請以現場單據為準。" * 6
                if long_note else "虛構資料，不可對外寄送")
    return {
        "schema":"kushe-external-document-v1","documentType":"billing","title":"請款單",
        "number":"","customer":"虛構建商","project":"SYNTH-限定M區","date":"2026-11-17",
        "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
        "lines":lines,"salesAmount":n*100,"taxAmount":n*5,
        "totalAmount":n*105,"retentionAmount":0,"receivableAmount":n*105,
        "publicNote":publicnote,
        "company":{"name":"虛構測試公司","englishName":"SYNTHETIC ONLY",
                   "taxId":"00000000","address":"虛構地址","line":"TEST"},
        "fileName":"DO-NOT-SEND.pdf","mergedBillingProjects":["SYNTH-限定M區"],
        "isMergedExternalBilling":True
    }
def encoded(d):
    return quote(base64.b64encode(json.dumps(
        d,ensure_ascii=False,separators=(",",":")).encode()).decode(),safe="")
def only_loopback(route):
    if route.request.url.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
            body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    return route.continue_() if route.request.url.startswith(BASE) else route.abort()

# Demonstrate an intercepted JS print call, while host-side CDP PDF can
# still render a document independently. No native print dialog is launched.
HOOK=r"""(() => {
 const history={status:"UNKNOWN",blocked:0,simulatedNative:0};
 window.__p40ab=history;
 window.print=()=>{if(history.status!=="ALLOWED"){history.blocked++;return false}
   history.simulatedNative++;return true};
})();"""

cases=[
    ("18-short",18,"short",False,False),
    ("30-medium",30,"medium",False,False),
    ("30-long",30,"long",False,False),
    ("30-long-note",30,"short",True,False),
    ("18-short-forced-break",18,"short",False,True),
]
viewports=[("desktop",1280,900,False),("mobile",390,844,True)]
records=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        for device,width,height,mobile in viewports:
            ctx=browser.new_context(viewport={"width":width,"height":height},
                                    is_mobile=mobile,has_touch=mobile)
            ctx.add_init_script(script=HOOK)
            page=ctx.new_page()
            page.route("**/*",only_loopback)
            for label,n,kind,long_note,forced in cases:
                case=f"{device}-{label}"
                page.goto(BASE+f"billing-print.html?print=0&ab={case}#"+
                          encoded(payload(n,kind,long_note)),wait_until="load")
                page.locator(".dense-original-details .dense-line-table").wait_for()
                page.add_style_tag(content=v["PROFILES"]["compact-a4-dense"])
                if n==30:
                    out=page.evaluate(x["TWOCOL_JS"])
                    assert out["rows"]==30 and out["twoColumns"]==2
                    page.add_style_tag(content=x["COL_CSS"])
                page.evaluate(y["STAMP_JS"]);page.add_style_tag(content=y["STAMP_CSS"])
                page.evaluate(y["FOOT_JS"]);page.add_style_tag(content=y["FOUR"])
                page.evaluate(z["LOGO_JS"]);page.add_style_tag(content=z["LOGO_CSS"])
                if forced:
                    page.add_style_tag(content="@media print {.grouped-item-summary {break-before:page!important;page-break-before:always!important}}")
                page.emulate_media(media="print")
                page.evaluate("async()=>{if(document.fonts?.ready) await document.fonts.ready}")
                geometry=page.evaluate("""() => {
                  const el=document.querySelector('#paper');
                  const pxPerMm=96/25.4;
                  const boxes=[...el.querySelectorAll('.section,.grouped-item-summary,.p40y-footer')];
                  const boxRects=boxes.map(x=>({
                    cls:x.className,top:x.getBoundingClientRect().top,
                    bottom:x.getBoundingClientRect().bottom,
                    breakBefore:getComputedStyle(x).breakBefore,
                    breakInside:getComputedStyle(x).breakInside
                  }));
                  return {
                    scrollHeightPx:el.scrollHeight,
                    clientHeightPx:el.clientHeight,
                    rectHeightPx:el.getBoundingClientRect().height,
                    oneA4CssHeightPx:297*pxPerMm,
                    bodyScrollHeight:document.body.scrollHeight,
                    boxes:boxRects
                  };
                }""")
                original=page.locator(".dense-original-details .dense-line-table tbody tr").count()
                grouped=(page.locator(".p40x-two-column-summary tbody tr").count()
                        if n==30 else page.locator(".grouped-item-summary-table tbody tr").count()-1)
                assert original==n+1 and grouped==n,(case,original,grouped)
                assert page.evaluate("window.__p40ab.status")=="UNKNOWN"
                page.evaluate("printDocument()")
                assert page.evaluate("window.__p40ab.blocked")==1
                assert page.evaluate("window.__p40ab.simulatedNative")==0
                # CDP PDF rendering is intentionally independent of JS window.print.
                pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
                doc=fitz.open(stream=pdf,filetype="pdf")
                pages=len(doc)
                pdftext=re.sub(r"\s+","", "".join(pg.get_text(sort=True) for pg in doc))
                missing=[f"TEST-{i:02d}" for i in range(1,n+1)
                         if f"TEST-{i:02d}" not in pdftext]
                missing +=[f"AB{i:02d}" for i in range(1,n+1)
                           if f"AB{i:02d}" not in pdftext]
                assert not missing,(case,"lost content",missing)
                for need in ("施工項目彙總","原施工明細合計","明細合計","請款金額"):
                    assert need in pdftext,(case,"lost financial field",need)
                domFits=(geometry["scrollHeightPx"]<=geometry["oneA4CssHeightPx"]+1)
                record={
                  "case":case,"rendered_pages":pages,
                  "dom_height_mm":round(geometry["scrollHeightPx"]*25.4/96,2),
                  "a4_height_mm":297,"dom_height_suggests_one_page":domFits,
                  "dom_false_positive":bool(domFits and pages>1),
                  "forced_css_break":forced,
                  "source_lines":n,"summary_rows":n,
                  "window_print_intercepted":True,
                  "host_pdf_independent_of_print_hook":True,
                  "content_complete":True
                }
                records.append(record)
                print("P40AB_RESULT "+json.dumps(record,ensure_ascii=False),flush=True)
                doc.close()
            ctx.close()
        browser.close()
finally:
    server.shutdown()

(OUT/"report.json").write_text(json.dumps(records,ensure_ascii=False,indent=2))
forced=[r for r in records if r["forced_css_break"]]
assert len(forced)==2 and all(r["rendered_pages"]>=2 for r in forced),(
    "Forced break did not produce extra A4 pages",forced)
assert all(r["window_print_intercepted"] and r["content_complete"] for r in records)
# A diagnostic is not permission to implement a naive DOM-height allow rule.
falsep=[r["case"] for r in records if r["dom_false_positive"]]
print("P40AB_FALSE_POSITIVES "+json.dumps(falsep,ensure_ascii=False),flush=True)
print("P40AB_DECISION: Browser DOM height, intercepting window.print and pre-print event are not an authoritative page-count gate. Default UNKNOWN/BLOCKED; do not deploy without validated actual rendered PDF preflight.")
print("P40AB_COMPLETE: purely isolated synthetic diagnostics; no production app or financial data changed.")
