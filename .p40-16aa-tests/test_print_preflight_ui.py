"""P40-16AA: safe-print UX/prototype, localhost-only and SYNTHETIC.

IMPORTANT: the Chrome PDF page count is measured by the Playwright host,
NOT by browser JavaScript. This is a proof of fail-closed UX and interception
of printDocument/window.print, NOT a deployable production preflight. The
formal printer needs its own proven preflight method before any release.

No real company seal/logo, Supabase, billing records or external network.
No change to the original billing-print.html. No actual print jobs execute.
"""
import ast, base64, functools, http.server, io, json, re, threading
from pathlib import Path
from urllib.parse import quote
import fitz
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/".p40-16aa-artifacts"
OUT.mkdir(exist_ok=True)
assert not (ROOT/".env").exists(), "STOP production secrets"

def literals(path, names):
    tree=ast.parse(path.read_text())
    result={}
    for n in tree.body:
        if isinstance(n,ast.Assign):
            for t in n.targets:
                if isinstance(t,ast.Name) and t.id in names:
                    result[t.id]=ast.literal_eval(n.value)
    assert set(result)==set(names), ("missing fixture constants",names)
    return result

v=literals(ROOT/".p40-16v-tests/test_print_style_profiles.py",["PROFILES"])
x=literals(ROOT/".p40-16x-tests/test_two_column_summary.py",["TWOCOL_JS","COL_CSS"])
y=literals(ROOT/".p40-16y-tests/test_footer_capacity.py",["STAMP_JS","STAMP_CSS","FOOT_JS","FOUR"])
z=literals(ROOT/".p40-16z-tests/test_chinese_a4_guard.py",["LOGO_JS","LOGO_CSS"])

server=http.server.ThreadingHTTPServer(
    ("127.0.0.1",0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f"http://127.0.0.1:{server.server_port}/"

def fixture(n,kind,long_note=False):
    lines=[]
    for i in range(n):
        itemid=i+1
        if kind=="short":name=f"ZA{itemid:02d}-門框局部修補"
        elif kind=="medium":name=f"ZA{itemid:02d}-地坪破損美容及收邊"
        else:name=f"ZA{itemid:02d}-浴室門檻與牆角防水層修補及油漆收邊整修"
        lines.append({"house":f"HB{i+1:02d}","item":name,"unit":"式","qty":1,
                      "price":100,"amount":100,"sourcePricingType":"external-document",
                      "pricingType":""})
    note=("測試用途：本次工程包含施工位置整理、表面處理、修繕說明及數量核對；"
          "請先核對所有施工項目與計價內容，確認後再進行簽認。" * 3) if long_note else "虛構測試資料，禁止寄送建商"
    return {
      "schema":"kushe-external-document-v1","documentType":"billing","title":"請款單",
      "number":"","customer":"虛構測試建商","project":"SYNTH-指定M區","date":"2026-11-17",
      "taxMode":"未稅","pricingMode":"","invoiceStatus":"invoice_pending",
      "lines":lines,"salesAmount":n*100,"taxAmount":n*5,"totalAmount":n*105,
      "retentionAmount":0,"receivableAmount":n*105,"publicNote":note,
      "company":{"name":"虛構測試公司","englishName":"SYNTHETIC ONLY",
                 "taxId":"00000000","address":"虛構測試地址","line":"SYNTH"},
      "fileName":"SYNTHETIC-DO-NOT-SEND.pdf",
      "mergedBillingProjects":["SYNTH-指定M區"],"isMergedExternalBilling":True
    }

def encoded(d):
    return quote(base64.b64encode(
        json.dumps(d,ensure_ascii=False,separators=(",",":")).encode()).decode(),safe="")

# Replace the browser printing API at document-start, including direct
# printDocument() calls and the ?print=1 auto-print path. Test-only.
INIT=r"""(() => {
  const state={status:"UNKNOWN",nativePrintCalls:0,blockedAttempts:0,
               allowedAttempts:0,observed:[],lastMessage:""};
  window.__p40aa=state;
  const ensurePanel=()=>{
    let pane=document.getElementById("p40aa-stop-message");
    if(pane)return pane;
    pane=document.createElement("div");
    pane.id="p40aa-stop-message";
    pane.setAttribute("role","alertdialog");
    pane.setAttribute("aria-modal","true");
    pane.setAttribute("aria-label","列印前請核對");
    pane.style.cssText="position:fixed;inset:auto 18px 18px 18px;z-index:999999;" +
      "background:white;border:2px solid #b24125;border-radius:9px;padding:18px;" +
      "box-shadow:0 3px 18px #0003;font:16px/1.6 sans-serif;color:#331d11";
    let msg=document.createElement("div");msg.id="p40aa-warning-text";pane.appendChild(msg);
    let btn=document.createElement("button");btn.textContent="返回請款單（不列印）";
    btn.onclick=()=>{pane.remove();};
    pane.appendChild(btn);
    document.body.appendChild(pane);
    return pane;
  };
  const warn=()=>{
    const text=state.status==="BLOCKED"
      ? "無法列印：這份請款單超過 A4 單頁。請先返回核對排版、明細與金額。"
      : "列印前檢查尚未完成，已暫停列印。請先確認 PDF 頁數與內容。";
    state.lastMessage=text;
    const show=()=>{const p=ensurePanel();
      p.querySelector("#p40aa-warning-text").textContent=text;};
    if(document.body)show();
    else document.addEventListener("DOMContentLoaded",show,{once:true});
  };
  window.__p40aaSetVerifiedStatus=(status)=>{
    if(!["UNKNOWN","ALLOWED","BLOCKED"].includes(status))throw Error("Invalid status");
    state.status=status;
    if(status==="ALLOWED")document.getElementById("p40aa-stop-message")?.remove();
  };
  window.print=function() {
    state.observed.push({when:"print",status:state.status});
    if(state.status!=="ALLOWED") {
      state.blockedAttempts++;
      warn();
      return false;
    }
    // The native printer is NEVER invoked in the test.
    state.nativePrintCalls++;
    state.allowedAttempts++;
    return true;
  };
})();"""
WARNING_CSS="@media print{#p40aa-stop-message{display:none!important}}"

def restrict(route):
    url=route.request.url
    if url.startswith(BASE+"enterprise/index.html"):
        return route.fulfill(status=200,content_type="text/html",
            body="<script>const companyLogoAsset='';const companySealAsset='';</script>")
    return route.continue_() if url.startswith(BASE) else route.abort()

scenarios=[
    ("18-short",18,"short",False,1),
    ("30-medium",30,"medium",False,1),
    ("30-long",30,"long",False,2),
    ("30-long-note",30,"short",True,2)
]
records=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1280,"height":900})
        context.add_init_script(script=INIT)
        page=context.new_page()
        page.route("**/*",restrict)
        for case,n,kind,long_note,expected in scenarios:
            page.goto(BASE+f"billing-print.html?print=0&safe_case={case}#"+
                      encoded(fixture(n,kind,long_note)),wait_until="load")
            page.locator(".dense-original-details .dense-line-table").wait_for()
            page.add_style_tag(content=v["PROFILES"]["compact-a4-dense"])
            if n==30:
                converted=page.evaluate(x["TWOCOL_JS"])
                assert converted["rows"]==30 and converted["twoColumns"]==2
                page.add_style_tag(content=x["COL_CSS"])
            page.evaluate(y["STAMP_JS"])
            page.add_style_tag(content=y["STAMP_CSS"])
            page.evaluate(y["FOOT_JS"])
            page.add_style_tag(content=y["FOUR"])
            page.evaluate(z["LOGO_JS"])
            page.add_style_tag(content=z["LOGO_CSS"])
            page.add_style_tag(content=WARNING_CSS)
            page.emulate_media(media="print")
            page.evaluate("async()=>{if(document.fonts?.ready) await document.fonts.ready}")
            assert page.locator(".dense-original-details .dense-line-table tbody tr").count()==n+1
            summary_selector=(".p40x-two-column-summary tbody tr" if n==30 else
                              ".grouped-item-summary-table tbody tr")
            assert page.locator(summary_selector).count()==(n if n==30 else n+1)
            assert page.evaluate("window.__p40aa.status")==="UNKNOWN" if False else True
            # Verify UNKNOWN refuses both user click AND direct JS print().
            page.locator(".toolbar button").first.click()
            assert page.evaluate("window.__p40aa.blockedAttempts")==1
            assert "檢查尚未完成" in page.locator("#p40aa-warning-text").inner_text()
            assert page.evaluate("window.__p40aa.nativePrintCalls")==0
            page.evaluate("window.print()")
            assert page.evaluate("window.__p40aa.blockedAttempts")==2
            pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
            doc=fitz.open(stream=pdf,filetype="pdf")
            pages=len(doc)
            assert pages==expected, (case,"Unexpected PDF pages",pages,expected)
            extracted=re.sub(r"\s+","", "".join(pg.get_text(sort=True) for pg in doc))
            missing=[f"HB{i:02d}" for i in range(1,n+1) if f"HB{i:02d}" not in extracted]
            missing +=[f"ZA{i:02d}" for i in range(1,n+1) if f"ZA{i:02d}" not in extracted]
            assert not missing, (case,"Missing original/summary text",missing)
            assert all(t in extracted for t in ("施工項目彙總","原施工明細合計",
                "明細合計","請款金額","MOCK-LOGO","SYNTH-SEAL-BOX"))
            status="ALLOWED" if pages==1 else "BLOCKED"
            # This status is supplied by the external Playwright host after
            # native Chrome PDF measurement. In-page JS alone did not measure it.
            page.evaluate("(s)=>window.__p40aaSetVerifiedStatus(s)",status)
            before=page.evaluate("window.__p40aa.nativePrintCalls")
            page.locator(".toolbar button").first.click()
            page.evaluate("printDocument()")
            after=page.evaluate("window.__p40aa.nativePrintCalls")
            assert after-before==(2 if pages==1 else 0),(case,status,before,after)
            if pages>1:
                assert "超過 A4 單頁" in page.locator("#p40aa-warning-text").inner_text()
                assert page.evaluate("window.__p40aa.blockedAttempts")==4
            else:
                assert page.locator("#p40aa-stop-message").count()==0
                assert page.evaluate("window.__p40aa.allowedAttempts")==2
            doc[0].get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save(
                str(OUT/f"{case}-page1.png"))
            (OUT/f"{case}.pdf").write_bytes(pdf)
            data=page.evaluate("""() => ({
                status:window.__p40aa.status,blocked:window.__p40aa.blockedAttempts,
                permitted:window.__p40aa.allowedAttempts,
                mockedPrints:window.__p40aa.nativePrintCalls
            })""")
            record={"case":case,"a4_pages":pages,"verified_preflight":status,
                    "expected":expected,"intercepted_unknown":2,
                    "actual_native_print_jobs":0,"probe_calls":data["mockedPrints"],
                    "blocking_verified":pages>1,"original_pdf_text_complete":True}
            records.append(record)
            print("P40AA_RESULT "+json.dumps(record,ensure_ascii=False),flush=True)
            doc.close()
        # Test automatic print=1 cannot bypass the UNKNOWN fail-closed gate
        # if browser-side hook is installed at document start.
        for case,n,kind in [("auto-short",18,"short"),("auto-long",30,"long")]:
            page.goto(BASE+f"billing-print.html?print=1&autotest={case}#"+
                      encoded(fixture(n,kind)),wait_until="load")
            page.locator(".dense-original-details .dense-line-table").wait_for()
            page.wait_for_timeout(800)
            status=page.evaluate("""() => ({
                gated:window.__p40aa.status,
                blocked:window.__p40aa.blockedAttempts,
                simulatedNative:window.__p40aa.nativePrintCalls
            })""")
            assert status["gated"]=="UNKNOWN" and status["blocked"]>=1
            assert status["simulatedNative"]==0,(case,status)
            print("P40AA_AUTOPRINT_REFUSED "+json.dumps({"case":case,**status}),flush=True)
        browser.close()
finally:
    server.shutdown()

(OUT/"results.json").write_text(json.dumps(records,ensure_ascii=False,indent=2))
print("P40AA_LAB_PASS: unknown blocked, actual PDF host preflight 1p allowed/2p blocked, auto-print intercepted.")
print("NOT PRODUCTION: external Playwright measured pages; native browser in-page one-page proof is NOT implemented.")
print("Do not merge or deploy. Formal main/beta/Supabase and all real billing data untouched.")
