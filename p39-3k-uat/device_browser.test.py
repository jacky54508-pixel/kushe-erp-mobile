"""P39-3K device-sized UAT smoke/visual checks on isolated synthetic package.
No live credentials, no real ERP business data, no external HTTP traffic.
"""
import os
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

ORIGIN=os.environ.get("P39_3K_ORIGIN","http://127.0.0.1:8798")
SCREENSHOTS=Path(os.environ.get("P39_3K_SCREENSHOTS","/tmp/p39-3k-screenshots"))
PRIVATE=["SYN-AA000001","SYN-BB000002","2026-08-20","2026-10-20",
         "原請款／發票對照","稅務／發票","已開發票","待開發票","免開發票"]
NOTE="P39-3K 虛構驗收－對外備註確認"
INTERNAL="原始合成備註"

# Real HTTP 308 server, not Playwright route interception: browser redirects
# bypass route handlers after the first request. This reproduces Pages' URL
# behavior with the package's *actual* _headers Content-Security-Policy.
SITE_DIR=Path(os.environ.get("P39_3K_SITE_DIR","/tmp/p39-3k-site"))
class CloudflareCleanURLHandler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(SITE_DIR),**kwargs)
    def do_GET(self):
        parts=urlsplit(self.path)
        path=parts.path
        suffix=("?"+parts.query) if parts.query else ""
        if path.endswith(".html") and path!="/index.html":
            self.send_response(308)
            self.send_header("Location",path[:-5]+suffix)
            self.end_headers()
            return
        if path in ("/note-fixture","/group-fixture","/billing-print",
                    "/external-billing-print","/billing-bundle-print"):
            self.path=path+".html"+suffix
        return super().do_GET()
    def end_headers(self):
        settings=SITE_DIR/"_headers"
        if settings.is_file():
            for line in settings.read_text(encoding="utf-8").splitlines():
                key,sep,value=line.strip().partition(": ")
                if sep and key in ("Content-Security-Policy","Cache-Control",
                                   "X-Content-Type-Options","Referrer-Policy"):
                    self.send_header(key,value)
        return super().end_headers()
    def log_message(self,*args):
        pass

def check_pdf(page,mode):
    try:
        if mode in ("single","merged"):
            page.wait_for_function("window.__billingPrintReady===true",timeout=14000)
        elif mode=="bundle":
            page.wait_for_function("window.__billingBundlePrintReady===true",timeout=14000)
        else:
            page.wait_for_function("document.querySelector('#print').disabled===false",timeout=14000)
    except Exception:
        print("PDF_BOOT_FAIL",mode,"url=",page.url,flush=True)
        try:
            print("PDF_TITLE",page.title(),flush=True)
            print("PDF_BODY",page.locator("body").inner_text(timeout=2000)[:1400],flush=True)
            print("PDF_LOCATION",page.evaluate("location.href"),flush=True)
        except Exception as inner:
            print("PDF_DIAGNOSTIC_FAILURE",str(inner)[:600],flush=True)
        raise
    body=page.locator("#paper").inner_text()
    assert "無法讀取" not in body and "無法匯出" not in body,(mode,body[:1200])
    assert NOTE in body,(mode,body[:1100])
    assert INTERNAL not in body,(mode,body[:1200])
    # P39-3K-1 deployed artifact is synthetic even though the ERP core is unchanged.
    banner=page.evaluate('getComputedStyle(document.body,"::after").content')
    assert "虛構測試" in banner and "禁止對外請款" in banner,(mode,banner)
    for field in ("82980636","瑞興路","eing0519"):
        assert field not in body,(mode,field)
    for private in PRIVATE:
        assert private not in body,(mode,private)
    if mode=="merged":
        assert page.locator(".dense-line-table tbody tr").count()==19
        assert page.locator(".grouped-item-summary").count()==1
        assert "$300,000" in page.locator(".grouped-item-summary").inner_text()
    if mode=="historical":
        assert page.locator(".historic").count()==1
        assert page.locator(".invoice-table").count()==0
    if mode=="bundle":
        assert page.locator(".project-section").count()==2
    if mode in ("merged","historical","bundle"):
        assert "$315,000" in body,(mode,body[:900])
    page.emulate_media(media="print")
    pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    pages=PdfReader(BytesIO(pdf)).pages
    assert len(pages)>0 and (len(pages)==1 if mode=="merged" else True),(mode,len(pages))
    for p in pages:
        w,h=map(float,(p.mediabox.width,p.mediabox.height))
        assert 594<=w<=596 and 841<=h<=843,(mode,w,h)
        extract=p.extract_text() or ""
        for private in ("SYN-AA000001","SYN-BB000002"):
            assert private not in extract,(mode,private)
    return len(pages)

def exercise(browser,label,width,height,scale,mobile,touch):
    context=browser.new_context(
        viewport={"width":width,"height":height},device_scale_factor=scale,
        is_mobile=mobile,has_touch=touch
    )
    # Desktop uses the original local server. Mobile uses the separate
    # real-HTTP Cloudflare route and CSP simulator (started by main()).
    external=[]
    def monitor(request):
        if not request.url.startswith(ORIGIN) and not request.url.startswith("data:"):
            external.append(request.url)
    context.on("request",monitor)
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    if mobile:
        page.on("console",lambda msg: print("CLOUDFLARE_CONSOLE",msg.type,msg.text[:280],flush=True)
            if msg.type in ("error","warning") else None)
        page.on("requestfailed",lambda req: print("CLOUDFLARE_REQUEST_FAILED",req.url,req.failure,flush=True))
        page.on("response",lambda resp: print("CLOUDFLARE_4XX",resp.status,resp.url,flush=True)
            if resp.status>=400 else None)
    page.goto(ORIGIN+"/",wait_until="domcontentloaded")
    try:
        page.locator("#status.ready").wait_for(timeout=30000)
    except Exception:
        print("UAT_BOOT_STATUS:",page.locator("#status").inner_text(),flush=True)
        print("UAT_FEEDBACK:",page.locator("#feedback").inner_text(),flush=True)
        print("UAT_PAGE_ERRORS:",errors,flush=True)
        print("UAT_FRAME_URLS:",[frame.url for frame in page.frames],flush=True)
        if mobile:
            for frame in page.frames:
                try:
                    print("UAT_FRAME_ENV",frame.url,frame.evaluate("""()=>({
                        ready:document.readyState,
                        hasERP:!!window.KuSheERPStore,
                        hasSources:!!window.__p39synthetic,
                        scripts:[...document.scripts].map(x=>x.src||"<inline>")
                    })"""),flush=True)
                except Exception as err:
                    print("UAT_FRAME_ENV_ERROR",str(err)[:250],flush=True)
        SCREENSHOTS.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(SCREENSHOTS/(label+"_boot_failure.png")),full_page=True)
        raise
    if mobile:
        # Confirm the browser really ended up on the Cloudflare canonical paths.
        seen={urlsplit(frame.url).path for frame in page.frames}
        assert "/note-fixture" in seen and "/group-fixture" in seen,seen
    assert "沒有連雲端" in page.locator("#status").inner_text()
    assert not page.locator("button[data-pdf=merged]").is_disabled()
    body=page.locator("body").inner_text()
    assert "虛構資料" in body and "不能" not in page.locator("#status").inner_text()
    SCREENSHOTS.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(SCREENSHOTS/(label+"_landing.png")),full_page=True)

    frame=page.frame_locator("#note-frame")
    frame.locator("[data-p393-open]").click()
    frame.locator('.p393-note-form textarea[name="note"]').fill(NOTE)
    frame.locator('.p393-note-form input[name="reason"]').fill("P39-3K 合成虛構實機驗收")
    page.screenshot(path=str(SCREENSHOTS/(label+"_note_editor.png")),full_page=True)
    frame.locator(".p393-note-form button[type=submit]").click()
    expect(page.locator("#current-note")).to_contain_text(NOTE,timeout=26000)
    store=page.evaluate("""()=>{
      const s=document.querySelector('#note-frame').contentWindow.KuSheERPStore.getState();
      return {internal:s.billings[0].note,public:s.billings[0].publicNote,
        amount:s.receivables[0].amount,history:s.billings[0].noteRevisionHistory.length,
        bank:s.bankTransactions.length,invoice:s.invoices[0].grossAmount};
    }""")
    assert store=={"internal":INTERNAL,"public":NOTE,"amount":100000,
                   "history":1,"bank":0,"invoice":105000},store
    page.screenshot(path=str(SCREENSHOTS/(label+"_note_saved.png")),full_page=True)
    if mobile:
        dimensions=page.evaluate("""()=>{
          const e=document.documentElement;
          return [e.scrollWidth,e.clientWidth];
        }""")
        assert dimensions[0]<=dimensions[1]+1,("mobile layout exceeds width",dimensions)
    page_totals={}
    for mode in ["single","merged","historical","bundle"]:
        with page.expect_popup(timeout=30000) as popup_info:
            page.locator('[data-pdf="'+mode+'"]').click()
        printable=popup_info.value
        page_totals[mode]=check_pdf(printable,mode)
        if mode=="merged":
            printable.screenshot(path=str(SCREENSHOTS/(label+"_merged_preview.png")),full_page=True)
        printable.close()
    assert external==[],external
    assert not errors,errors
    context.close()
    print(f"PASS P39-3K {label}: original Store note protected, phone/desktop UI,"
          f" PDFs={page_totals}, zero external requests",flush=True)

def main():
    global ORIGIN
    assert (SITE_DIR/"index.html").is_file() and (SITE_DIR/"_headers").is_file()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel="chrome") if (
            os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1"
        ) else p.chromium.launch(headless=True)
        exercise(browser,"desktop",1280,900,1,False,False)
        server=ThreadingHTTPServer(("127.0.0.1",8799),CloudflareCleanURLHandler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            ORIGIN="http://127.0.0.1:8799"
            exercise(browser,"mobile",390,844,2,True,True)
        finally:
            server.shutdown()
            server.server_close()
            browser.close()
    print("P39_3K_DEVICE_EMULATION_AND_REAL_CLOUDFLARE_REDIRECT_CSP_PASS",flush=True)

if __name__=="__main__":
    main()
