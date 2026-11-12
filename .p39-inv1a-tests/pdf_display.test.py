"""P39-INV-1A print-only release gate with synthetic values and real Chrome PDF.
This runner ONLY visits 127.0.0.1; no real invoices, cloud, GitHub main or ERP writes.
"""
import base64
import json
import os
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ORIGIN="http://127.0.0.1:8797"
FIXTURE=ORIGIN+"/.p39-inv1-tests/fixture.html"

def make_document(seed):
    projected=seed.evaluate("""() => {
        const sources=JSON.parse(JSON.stringify(window.__p39synthetic.sources));
        sources[0].document.projectName='虛構甲區';
        sources[0].document.number='B20261004-001';
        sources[0].document.date='2026-10-04';
        sources[0].document.invoiceStatus='invoice_pending';
        sources[0].document.invoiceNo='';
        sources[0].document.invoiceDate='2026-10-04'; // legacy source-date fallback
        sources[1].document.projectName='虛構乙區';
        sources[1].document.number='LEGACY-SYN-ANY-999';
        sources[1].document.date='2026-10-04';
        sources[1].document.invoiceStatus='invoiced';
        sources[1].document.invoiceNo='SYN-ZX12345678';
        sources[1].document.invoiceDate='2026-06-26';
        return window.KusheExternalBillingInvoice.project(sources);
    }""")
    assert [x["invoiceStatus"] for x in projected["rows"]]==[
        "invoice_pending","invoiced"]
    amount=300000
    lines=[]
    for i in range(18):
        price=16000 if i<17 else amount-17*16000
        lines.append({
            "house":f"SYN-{i+1:02d}",
            "item":"虛構施工清潔與表面處理、完工檢驗" if i%3==0 else f"虛構工程項目 {i+1}",
            "unit":"式","qty":1,"price":price,"amount":price,
            "sourcePricingType":"external-document"
        })
    assert sum(x["amount"] for x in lines)==300000
    return {
        "schema":"kushe-external-document-v1",
        "documentType":"billing","title":"請款單",
        "customer":"虛構建商","project":"虛構甲區",
        "date":"2026-10-30","taxMode":"未稅","invoiceStatus":"invoice_pending",
        "publicNote":"","lines":lines,"salesAmount":300000,"taxAmount":15000,
        "totalAmount":315000,"retentionAmount":0,"receivableAmount":315000,
        "sourceInvoiceReferences":projected,
        "company":{"name":"虛構測試企業","taxId":"SYNTHETIC","englishName":"Synthetic Company"}
    }

def open_print(ctx,document):
    encoded=quote(base64.b64encode(json.dumps(
        document,ensure_ascii=False,separators=(",",":")).encode("utf-8")).decode())
    page=ctx.new_page()
    page.goto(ORIGIN+"/billing-print.html?print=0#"+encoded)
    page.wait_for_function("window.__billingPrintReady===true",timeout=25000)
    assert "無法讀取" not in page.locator("#paper").inner_text()
    return page

def test_grouped_pdf(browser):
    ctx=browser.new_context(viewport={"width":1250,"height":900})
    source=ctx.new_page()
    source.goto(FIXTURE)
    original=source.evaluate("JSON.stringify(window.__p39synthetic)")
    document=make_document(source)
    page=open_print(ctx,document)
    table=page.locator(".invoice-ref-table tbody tr")
    assert table.count()==2
    pending=table.nth(0).locator("td")
    issued=table.nth(1).locator("td")
    assert pending.nth(0).inner_text().startswith("虛構甲區")
    assert "原請款日期：2026-10-04" in pending.nth(0).inner_text()
    assert pending.nth(1).inner_text().startswith("待開票")
    assert pending.nth(2).inner_text()=="尚未開立",pending.nth(2).inner_text()
    assert issued.nth(1).inner_text()=="SYN-ZX12345678"
    assert issued.nth(2).inner_text()=="2026-06-26"
    assert "虛構甲區、虛構乙區" in page.locator(".merged-scope").inner_text()
    full=page.locator("#paper").inner_text()
    assert "合併請款範圍" in full
    assert "LEGACY-SYN" not in full and "B20261004-001" not in full
    assert "各戶施工明細（每筆原始項目保留）" not in full
    assert "施工明細" in full
    assert "原施工明細合計" in full
    assert "未開票者不列開立日期" in full
    assert "表列為原請款金額，非新增發票或應收" not in full
    assert page.locator(".dense-line-table tbody tr").count()==19
    assert page.locator(".invoice-ref-table tbody tr").count()==2
    assert "$300,000" in full and "$15,000" in full and "$315,000" in full
    page.emulate_media(media="print")
    font_a=page.locator(".dense-line-table tbody tr:first-child td.item").evaluate(
        "(el)=>parseFloat(getComputedStyle(el).fontSize)*72/96")
    font_b=page.locator(".invoice-ref-table tbody tr:first-child td").first.evaluate(
        "(el)=>parseFloat(getComputedStyle(el).fontSize)*72/96")
    assert font_a>=8.4 and font_b>=7.8,(font_a,font_b)
    pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    reader=PdfReader(BytesIO(pdf))
    assert len(reader.pages)==1,(
        f"BLOCK: refined 18-line invoice printed {len(reader.pages)} pages")
    width,height=map(float,(reader.pages[0].mediabox.width,
        reader.pages[0].mediabox.height))
    assert 594<=width<=596 and 841<=height<=843,(width,height)
    assert source.evaluate("JSON.stringify(window.__p39synthetic)")==original
    print("PASS: P39-INV-1A two-month pending/issued PDF, 18 rows, A4 one page,"
          " no LEGACY IDs, unchanged all source data",flush=True)
    ctx.close()

def test_original_single_invoice_unaffected(browser):
    ctx=browser.new_context()
    source=ctx.new_page()
    source.goto(FIXTURE)
    document=make_document(source)
    del document["sourceInvoiceReferences"]
    document["lines"]=document["lines"][:2]
    document["salesAmount"]=32000
    document["taxAmount"]=1600
    document["totalAmount"]=33600
    document["receivableAmount"]=33600
    page=open_print(ctx,document)
    assert page.locator(".merged-scope").count()==0
    assert page.locator(".invoice-ref-section").count()==0
    assert page.locator(".dense-original-details").count()==0
    assert page.locator(".detail").count()==1
    assert page.locator(".info").count()==1
    assert page.locator("#paper").inner_text().count("虛構甲區")==1
    print("PASS: normal single billing PDF not affected by grouped PDF refinements",
          flush=True)
    ctx.close()

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") if (
            os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1") else pw.chromium.launch(headless=True)
        test_grouped_pdf(browser)
        test_original_single_invoice_unaffected(browser)
        browser.close()
    print("P39_INV1A_PDF_DISPLAY_ACCEPTANCE_PASS",flush=True)

if __name__=="__main__":
    main()
