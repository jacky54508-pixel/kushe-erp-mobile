"""P39-INV-1 pre-release A4 page-count and 390px phone checks.
All data is generated on localhost from SYN- fixtures. No hosted ERP URLs,
no cloud APIs, no billing writes. Checks actual Chromium PDF with pypdf.
"""
from io import BytesIO
import base64
import json
import os
import urllib.parse
from pypdf import PdfReader
from playwright.sync_api import sync_playwright

ORIGIN="http://127.0.0.1:8797"
URL=ORIGIN+"/.p39-inv1-tests/fixture.html"

def prepare_document(page):
    refs=page.evaluate("""() => window.KusheExternalBillingInvoice.project(
       window.__p39synthetic.sources)""")
    assert [row["invoiceMonth"] for row in refs["rows"]]==["2026-08","2026-10"]
    # Two entirely synthetic original invoices, no real customer identifiers.
    document={
        "schema":"kushe-external-document-v1","documentType":"billing",
        "title":"請款單","customer":"虛構建商","project":"虛構 A 區 + B 區",
        "date":"2026-11-11","taxMode":"未稅","invoiceStatus":"invoice_pending",
        "publicNote":"虛構文件：僅驗證 A4 列印與明細完整性",
        "lines":[{"house":"A1","item":"虛構 A 區施工","unit":"式","qty":1,
                  "price":100000,"amount":100000,"sourcePricingType":"external-document"},
                 {"house":"B1","item":"虛構 B 區施工","unit":"式","qty":1,
                  "price":200000,"amount":200000,"sourcePricingType":"external-document"}],
        "salesAmount":300000,"taxAmount":15000,"totalAmount":315000,
        "retentionAmount":0,"receivableAmount":315000,
        "sourceInvoiceReferences":refs,
        "company":{"name":"虛構有限公司","taxId":"SYNTHETIC","englishName":"Synthetic Co"}
    }
    return document

def test_pdf_pages(browser):
    ctx=browser.new_context(viewport={"width":1250,"height":900})
    seed=ctx.new_page()
    seed.goto(URL)
    data=prepare_document(seed)
    encoded=urllib.parse.quote(base64.b64encode(
        json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    ).decode("utf-8"))
    printable=ctx.new_page()
    printable.goto(ORIGIN+"/billing-print.html?print=0#"+encoded)
    printable.wait_for_function("window.__billingPrintReady===true")
    assert printable.locator(".invoice-ref-table tbody tr").count()==0
    result=printable.evaluate("""()=>{
      const root=document.querySelector("#paper");
      return {invoiceSections:document.querySelectorAll(".invoice-ref-section").length,
        invoiceRows:document.querySelectorAll(".invoice-ref-table tbody tr").length,
        paperWidth:root.getBoundingClientRect().width}
    }""")
    assert result["invoiceSections"]==0 and result["invoiceRows"]==0,result
    visible=printable.locator("#paper").inner_text()
    assert "合併請款範圍" in visible and "$315,000" in visible
    for private in ["SYN-AA000001","SYN-BB000002","2026-08-20","2026-10-20","原請款／發票對照"]:
        assert private not in visible,private
    pdf=printable.pdf(format="A4",print_background=True,
                      prefer_css_page_size=True)
    reader=PdfReader(BytesIO(pdf),strict=False)
    pages=len(reader.pages)
    print("P39 INV1 A4 page-count diagnostic:",pages,
          "page-bytes:",len(pdf),
          "sections:",result,flush=True)
    assert pages==1,(
        f"A4 single-page gate blocked: Chromium printed {pages} pages for "
        "a standard two-invoice merged document; no main release"
    )
    page=reader.pages[0]
    width=float(page.mediabox.width)
    height=float(page.mediabox.height)
    assert 594<=width<=596 and 841<=height<=843,(width,height)
    assert pdf.startswith(b"%PDF") and len(pdf)>5000
    print(f"PASS: real Chrome PDF {pages} A4 page, {width:.1f}x{height:.1f} pt, "
          f"8月+10月 synthetic invoice comparison ({len(pdf)} bytes)",flush=True)
    ctx.close()

def test_multi_item_pdf_pages(browser):
    """Stress the PDF with 18 generic items, matching a real-world line count,
    WITHOUT uploading or embedding any customer data from the user's backup.
    """
    ctx=browser.new_context(viewport={"width":1250,"height":900})
    seed=ctx.new_page()
    seed.goto(URL)
    data=prepare_document(seed)
    # Status split (one pending, one issued) is not a bill or invoice write.
    refs=seed.evaluate("""()=>{
      const ss=JSON.parse(JSON.stringify(window.__p39synthetic.sources));
      ss[0].document.invoiceStatus='invoice_pending';
      ss[0].document.invoiceNo='';
      ss[0].document.invoiceDate='';
      return window.KusheExternalBillingInvoice.project(ss);
    }""")
    assert [refs["pending"],refs["issued"]]==[1,1]
    data["sourceInvoiceReferences"]=refs
    amount=300000
    data["lines"]=[]
    for i in range(18):
        unit_price=16000 if i < 17 else amount-16000*17
        data["lines"].append({
            "house":f"SYN-{i+1:02d}",
            "item": "虛構施工明細－階段測試、表面處理與完工檢測" if i<7
                    else "虛構鋁窗美容" if i<17 else "虛構門片修繕",
            "unit":"式","qty":1,"price":unit_price,"amount":unit_price,
            "sourcePricingType":"external-document"
        })
    assert sum(x["amount"] for x in data["lines"])==data["salesAmount"]
    encoded=urllib.parse.quote(base64.b64encode(
      json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    ).decode("utf-8"))
    printable=ctx.new_page()
    printable.goto(ORIGIN+"/billing-print.html?print=0#"+encoded)
    printable.wait_for_function("window.__billingPrintReady===true",timeout=15000)
    # The dense merged template replaces a quadratic house-by-item matrix
    # and grouped lines with every original row, showing all locations.
    assert printable.locator(".matrix").count()==0
    assert printable.locator(".dense-original-details").count()==1
    row_count=printable.locator(".dense-line-table tbody tr").count()
    assert row_count==19,row_count # 18 original entries + one total
    printed=printable.locator(".dense-line-table tbody tr").all()
    for i,line in enumerate(data["lines"]):
        cells=printed[i].locator("td").all_inner_texts()
        assert len(cells)==6,cells
        assert cells[0]==line["house"],(i,cells)
        assert cells[1]==line["item"],(i,cells)
        assert cells[2]==line["unit"],(i,cells)
        assert cells[3]==str(line["qty"]),(i,cells)
        assert cells[4]=="$"+f'{line["price"]:,}',(i,cells)
        assert cells[5]=="$"+f'{line["amount"]:,}',(i,cells)
    assert "$300,000" in printed[-1].inner_text()
    group_rows=printable.locator(".grouped-item-summary tbody tr")
    assert group_rows.count()==4,group_rows.count()
    assert "$112,000" in group_rows.nth(0).inner_text()
    assert "$160,000" in group_rows.nth(1).inner_text()
    assert "$28,000" in group_rows.nth(2).inner_text()
    assert "$300,000" in group_rows.last.inner_text()
    assert '$315,000' in printable.locator('.summary').inner_text()
    assert '虛構施工明細' in printable.locator('.detail').inner_text()
    printable.emulate_media(media="print")
    pt=printable.locator(".dense-line-table tbody tr:first-child td.item").evaluate(
      "(td)=>parseFloat(getComputedStyle(td).fontSize)*72/96")
    assert pt>=8.4,pt
    assert printable.locator(".invoice-ref-table tbody tr").count()==0
    paper=printable.locator("#paper").inner_text()
    for private in ["待開票","2026-10-20","SYN-AA000001","原請款／發票對照"]:
        assert private not in paper,private
    assert "合併請款範圍" in paper
    pdf=printable.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    pages=len(PdfReader(BytesIO(pdf),strict=False).pages)
    print("P39 INV1 representative 18-line A4 stress page count:",pages,flush=True)
    assert pages==1,(
      "A4 release blocker: a synthetic 18-item merged invoice renders "
      f"{pages} pages, so the present grouped document format is not safe "
      "to promise one-page A4"
    )
    print("PASS: 18-line synthetic mixed-status group remains one A4 page",flush=True)
    ctx.close()


def test_mobile(browser):
    ctx=browser.new_context(viewport={"width":390,"height":844},
                            device_scale_factor=2,is_mobile=True,has_touch=True)
    page=ctx.new_page()
    js_errors=[]
    page.on("pageerror",lambda err:js_errors.append(str(err)))
    page.goto(URL)
    before=page.evaluate("() => window.__p39synthetic.snapshot()")
    page.evaluate("() => window.KusheBillingGroups.openEditor(['SYN-B-A','SYN-B-B'])")
    panel=page.locator("[data-bg-invoice-panel] .bg-invoice-crosscheck")
    panel.wait_for()
    rows=page.locator("[data-bg-invoice-panel] tbody tr")
    assert rows.count()==2
    assert panel.locator("text=2026-08-20").count()>0
    assert panel.locator("text=2026-10-20").count()>0
    assert panel.locator("text=SYN-AA000001").count()>0
    assert panel.locator("text=SYN-BB000002").count()>0
    geometry=page.evaluate("""()=>{
      const root=document.querySelector('.bg-dialog');
      const scroll=document.querySelector('.bg-invoice-scroll');
      const rect=root.getBoundingClientRect();
      return {width:window.innerWidth,left:rect.left,right:rect.right,
        scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,
        overflowX:getComputedStyle(scroll).overflowX,
        footerVisible:!!document.querySelector('[data-bg-save]')}
    }""")
    assert geometry["width"]==390,geometry
    assert geometry["left"]>=-2 and geometry["right"]<=392,geometry
    assert geometry["scrollWidth"]>geometry["clientWidth"],geometry
    assert geometry["overflowX"]=="auto",geometry
    assert geometry["footerVisible"],geometry

    # Open the RIGHTMOST per-source editor on a narrow phone; Playwright must
    # scroll the actual table horizontally to reach its "管理發票" button.
    button=page.locator('[data-bg-manage-invoice="SYN-B-B"]')
    button.click()
    form=page.locator("#outputInvoiceForm")
    form.wait_for()
    assert form.locator('[name="invoiceNumber"]').input_value()=="SYN-BB000002"
    assert form.locator('[name="invoiceDate"]').input_value()=="2026-10-20"
    assert page.locator(".bg-overlay").count()==1
    form.locator('[data-close-detail]').click()
    assert page.locator("#outputInvoiceForm").count()==0
    assert page.locator(".bg-overlay").count()==1
    assert before==page.evaluate("() => window.__p39synthetic.snapshot()")
    assert not js_errors,js_errors
    print("PASS: 390px mobile invoice table scrolls horizontally, "
          "B source editor opens/closes without any accounting write",flush=True)
    ctx.close()

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") \
            if os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1" \
            else pw.chromium.launch(headless=True)
        test_mobile(browser)
        test_pdf_pages(browser)
        test_multi_item_pdf_pages(browser)
        browser.close()
    print("P39_INV1_A4_MOBILE_PREFLIGHT_PASS")

if __name__=="__main__":
    main()
