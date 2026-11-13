"""P39-3H public PDF privacy: loopback synthetic-only, no production access."""
import base64, json, os
from io import BytesIO
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

URL="http://127.0.0.1:8797"
SEED=URL+"/.p39-inv1-tests/fixture.html"
PRIVATE=["原請款／發票對照","稅務／發票","已開發票","待開發票","免開發票",
         "SYN-AA000001","SYN-BB000002","2026-08-20","2026-10-20"]

def pack(data):
    return quote(base64.b64encode(json.dumps(data,ensure_ascii=False,
        separators=(",",":")).encode()).decode())

def verify_public_pdf(page):
    shown=page.locator("#paper").inner_text()
    assert "無法匯出" not in shown,shown[:800]
    for value in PRIVATE:
        assert value not in shown,(value,shown[:1000])
    page.emulate_media(media="print")
    binary=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    assert binary.startswith(b"%PDF") and len(binary)>3500
    reader=PdfReader(BytesIO(binary))
    assert len(reader.pages)>=1
    for p in reader.pages:
        w,h=float(p.mediabox.width),float(p.mediabox.height)
        assert 594<=w<=596 and 841<=h<=843,(w,h)
        extracted=p.extract_text() or ""
        for forbidden in ("SYN-AA000001","SYN-BB000002"):
            assert forbidden not in extracted,forbidden
    return shown,len(reader.pages)

def historical(browser):
    ctx=browser.new_context(viewport={"width":1250,"height":900})
    seed=ctx.new_page();seed.goto(SEED)
    before=seed.evaluate("window.__p39synthetic.snapshot()")
    doc=seed.evaluate("""()=>{
      const s=window.__p39synthetic.sources.map(v=>JSON.parse(JSON.stringify(v)));
      const totals=window.KuSheERPStore.externalBillingContext(
          s.map(v=>v.document.billingId)).totals;
      const lines=s.flatMap(v=>v.document.originalLines.map(x=>({
        house:x.house,item:x.item,unit:x.unit,qty:x.qty,price:x.price,amount:x.subtotal})));
      return {schema:'kushe-external-billing-group-v2',status:'archived',
        detailMode:'unified',revision:2,updatedAt:'2026-11-11T00:00:00.000Z',
        documentDate:'2026-11-11',note:'虛構公開備註',customerName:'虛構建商',
        sourceSnapshots:s.map(v=>v.document),
        settlementSnapshots:s.map(v=>v.settlement),
        sourceIds:s.map(v=>v.document.billingId),
        targetBillingId:s[0].document.billingId,
        displayProjectName:s[0].document.projectName,totals,
        unified:{taxMode:'未稅',lines,total:300000,target:300000,reason:''}};
    }""")
    assert doc["sourceSnapshots"][0]["invoiceNo"]=="SYN-AA000001"
    assert doc["totals"]["grossTotal"]==315000
    page=ctx.new_page();errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.goto(URL+"/external-billing-print.html#"+pack({
        "schema":"kushe-external-billing-print-v1","historical":True,"document":doc}))
    page.wait_for_function("document.querySelector('#print').disabled===false",timeout=22000)
    assert not errors,errors
    assert page.locator(".historic").count()==1
    assert page.locator(".invoice-table").count()==0
    assert page.locator(".detail tbody tr").count()==2
    shown,count=verify_public_pdf(page)
    for value in ("$100,000","$200,000","$300,000","$15,000",
                  "$315,000","虛構公開備註","保存版本"):
        assert value in shown,value
    assert seed.evaluate("window.__p39synthetic.snapshot()")==before
    print("PASS: historic PDF invoice details hidden, totals retained, A4 pages="+str(count))
    ctx.close()

def bundle(browser):
    ctx=browser.new_context(viewport={"width":1280,"height":900})
    seed=ctx.new_page();seed.goto(SEED)
    before=seed.evaluate("window.__p39synthetic.snapshot()")
    seed.evaluate("window.KusheBillingPrint={buildExternalView:r=>r._view}")
    seed.add_script_tag(url=URL+"/assets/js/billing-bundle-print.js")
    payload=seed.evaluate("""()=>{
      const rows=window.__p39synthetic.sources.map(x=>{
        const d=x.document,a=d.anchors;
        return {id:d.billingId,customer:d.customerId,customerName:d.customerName,
         project:d.projectId,projectName:d.projectName,number:d.number,date:d.date,
         invoiceNo:d.invoiceNo,invoiceStatus:d.invoiceStatus,
         _view:{number:d.number,customer:d.customerName,project:d.projectName,
           date:d.date,taxMode:d.taxMode,invoiceStatus:d.invoiceStatus,
           lines:d.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,
             qty:l.qty,price:l.price,amount:l.subtotal})),
           salesAmount:a.untaxed,taxAmount:a.tax,totalAmount:a.grossTotal,
           retentionAmount:a.retention,receivableAmount:a.receivable,
           publicNote:'虛構對外原單說明',
           company:{name:'虛構有限公司',taxId:'SYNTHETIC'}}};
      });
      return window.KusheBillingBundlePrint.buildCombinedView(rows);
    }""")
    assert payload["totals"]["salesAmount"]==300000
    assert payload["totals"]["taxAmount"]==15000
    assert payload["totals"]["totalAmount"]==315000
    assert not any(k in payload for k in ("invoiceStatus","invoiceDisplay"))
    assert all("invoiceStatus" not in x for x in payload["billings"])
    # Old copied links must also hide old metadata in visible output.
    payload["invoiceStatus"]="invoiced"
    payload["invoiceDisplay"]="已開發票"
    payload["billings"][0]["invoiceStatus"]="invoiced"
    payload["billings"][1]["invoiceStatus"]="invoice_pending"
    page=ctx.new_page();errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.goto(URL+"/billing-bundle-print.html?print=0#"+pack(payload))
    page.wait_for_function("window.__billingBundlePrintReady===true",timeout=22000)
    assert not errors,errors
    assert page.locator(".project-section").count()==2
    assert page.locator(".project-section .detail tbody tr").count()==2
    shown,count=verify_public_pdf(page)
    for value in ("$100,000","$200,000","$300,000","$15,000",
                  "$315,000","虛構對外原單說明"):
        assert value in shown,value
    assert seed.evaluate("window.__p39synthetic.snapshot()")==before
    print("PASS: original bundle hides invoice states for old and new URLs, A4 pages="+str(count))
    ctx.close()

if __name__=="__main__":
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel="chrome") if (
            os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1") else p.chromium.launch(headless=True)
        historical(browser)
        bundle(browser)
        browser.close()
    print("P39_3H_PUBLIC_PDF_PRIVACY_ACCEPTANCE_PASS")
