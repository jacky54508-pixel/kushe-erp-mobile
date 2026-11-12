"""P39-INV-1 synthetic browser tests. No live login, Cloud, main or real ERP data."""
from playwright.sync_api import sync_playwright
import json

ORIGIN="http://127.0.0.1:8797"
URL=ORIGIN+"/.p39-inv1-tests/fixture.html"

def test_group(browser):
    ctx=browser.new_context()
    page=ctx.new_page()
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("!!window.KusheBillingGroups && !!window.KusheInvoices")
    before=page.evaluate("() => window.__p39synthetic.snapshot()")
    page.evaluate("() => window.KusheBillingGroups.openEditor(['SYN-B-A','SYN-B-B'])")
    page.locator('[data-bg-invoice-panel] .bg-invoice-crosscheck').wait_for()
    table=page.locator('[data-bg-invoice-panel] tbody tr')
    assert table.count()==2
    text=page.locator('[data-bg-invoice-panel]').inner_text()
    assert "2026-08-20" in text and "2026-10-20" in text,text
    assert "SYN-AA000001" in text and "SYN-BB000002" in text,text
    assert "$100,000" in text and "$200,000" in text and "$315,000" in text,text
    assert page.evaluate("() => window.__p39synthetic.snapshot()")==before
    assert not errors,errors

    # Open A's existing invoice editor without destroying the group.
    page.locator('[data-bg-manage-invoice="SYN-B-A"]').click()
    form=page.locator("#outputInvoiceForm")
    form.wait_for()
    assert page.locator(".bg-overlay").count()==1,"group modal must remain mounted"
    assert form.locator('[name="invoiceNumber"]').input_value()=="SYN-AA000001"
    assert form.locator('[name="invoiceDate"]').input_value()=="2026-08-20"
    form.locator('[name="invoiceNumber"]').fill("SYN-AA000009")
    form.locator('[name="invoiceDate"]').fill("2026-08-25")
    form.locator('button[type="submit"]').click()
    page.wait_for_timeout(1200)
    print('DBG_WRITES',page.evaluate("window.__p39synthetic.persistCalls"),flush=True)
    print('DBG_TOAST',page.evaluate("window.__p39synthetic.lastToast"),flush=True)
    print('DBG_ERRORS',errors,flush=True)
    assert page.evaluate("window.__p39synthetic.invoices[0].invoiceNumber")=='SYN-AA000009'
    assert page.locator("#outputInvoiceForm").count()==0,"child dialog should close, not group"
    assert page.locator(".bg-overlay").count()==1,"group dialog should survive child submit"
    after=page.evaluate("""() => {
      const s=window.__p39synthetic;
      return {invoices:s.invoices,billings:s.billings,receivables:s.receivables,
        bank:s.bankTransactions,payroll:s.payroll,receipts:s.receipts,
        writes:s.persistCalls,saveDisabled:document.querySelector('[data-bg-save]').disabled,
        feedback:document.querySelector('[data-bg-feedback]').textContent};
    }""")
    assert len(after["writes"])==1,after
    assert after["writes"][0]["type"]=="existing_source_invoice"
    assert after["writes"][0]["sourceId"]=="SYN-B-A"
    assert after["invoices"][1]["invoiceNumber"]=="SYN-BB000002",after
    assert after["invoices"][1]["invoiceDate"]=="2026-10-20",after
    assert after["billings"][1]["invoiceNo"]=="SYN-BB000002",after
    assert after["receivables"][1]["invoiceNo"]=="SYN-BB000002",after
    assert after["saveDisabled"] is True,after
    assert "重新開啟" in after["feedback"],after
    assert after["bank"]==after["payroll"]==after["receipts"]==[],after
    # Group save must not execute from stale invoice source.
    page.locator('[data-bg-save]').evaluate("(button)=>button.click()")
    assert page.evaluate("() => window.__p39synthetic.persistCalls.length")==1
    assert not errors,errors
    ctx.close()
    print("PASS: grouped original invoice A edited via existing writer; B, AR totals, bank, payroll and group document unchanged")

def test_cancel_and_exempt(browser):
    ctx=browser.new_context()
    page=ctx.new_page()
    page.goto(URL)
    page.evaluate("""() => {
      const s=window.__p39synthetic;
      s.sources[1].document.invoiceStatus='no_invoice';
      s.sources[1].document.invoiceNo='';
      s.sources[1].document.invoiceDate='';
      s.sources[1].document.anchors.tax=0;
      s.sources[1].document.anchors.grossTotal=200000;
      s.sources[1].document.anchors.receivable=200000;
      window.KusheBillingGroups.openEditor(['SYN-B-A','SYN-B-B']);
    }""")
    assert page.locator('[data-bg-manage-invoice="SYN-B-B"]').count()==0
    assert page.locator('[data-bg-manage-invoice="SYN-B-A"]').count()==1
    page.locator('[data-bg-manage-invoice="SYN-B-A"]').click()
    page.locator('#outputInvoiceForm [data-close-detail]').click()
    assert page.locator(".bg-overlay").count()==1
    assert page.locator("#outputInvoiceForm").count()==0
    assert page.evaluate("() => window.__p39synthetic.persistCalls.length")==0
    ctx.close()
    print("PASS: exempt original cannot become invoice, close child preserves group, no writes")

def test_pdf(browser):
    ctx=browser.new_context()
    page=ctx.new_page()
    page.goto(URL)
    model=page.evaluate("""() => {
       const data=window.__p39synthetic.sources;
       const helper=window.KusheExternalBillingInvoice;
       return helper.project(data);
    }""")
    assert [r["invoiceMonth"] for r in model["rows"]]==["2026-08","2026-10"]
    data={
      "schema":"kushe-external-document-v1",
      "documentType":"billing","title":"請款單","customer":"虛構建商",
      "project":"虛構合併工程","date":"2026-11-11","taxMode":"未稅",
      "invoiceStatus":"invoice_pending","publicNote":"虛構資料：不作為正式請款",
      "lines":[
        {"house":"A1","item":"虛構施工 A","unit":"式","qty":1,"price":100000,
         "amount":100000,"sourcePricingType":"external-document"},
        {"house":"B1","item":"虛構施工 B","unit":"式","qty":1,"price":200000,
         "amount":200000,"sourcePricingType":"external-document"}
      ],
      "salesAmount":300000,"taxAmount":15000,"totalAmount":315000,
      "retentionAmount":0,"receivableAmount":315000,
      "sourceInvoiceReferences":model,
      "company":{"name":"虛構有限公司","taxId":"SYNTHETIC","englishName":"Synthetic"}
    }
    import base64,urllib.parse
    payload=urllib.parse.quote(base64.b64encode(json.dumps(data,ensure_ascii=False).encode()).decode())
    pdfpage=ctx.new_page()
    pdfpage.goto(ORIGIN+"/billing-print.html?print=0#"+payload)
    pdfpage.wait_for_function("window.__billingPrintReady===true",timeout=12000)
    assert pdfpage.locator(".invoice-ref-table tbody tr").count()==0
    assert pdfpage.locator(".invoice-ref-section").count()==0
    txt=pdfpage.locator("#paper").inner_text()
    assert "合併請款範圍" in txt
    for private in ["SYN-AA000001","SYN-BB000002","2026-08-20",
                    "2026-10-20","原請款／發票對照","發票對照"]:
        assert private not in txt,private
    assert "$100,000" in txt and "$200,000" in txt and "$315,000" in txt
    assert pdfpage.locator(".detail tbody tr").count()>2
    assert "$315,000" in pdfpage.locator(".summary").inner_text()
    # Test Chrome's real print engine, not just DOM string assembly.
    binary=pdfpage.pdf(format="A4",print_background=True)
    assert binary[:4]==b"%PDF" and len(binary)>5000,len(binary)
    print(f"PASS: historic merged payload prints public billing without invoice metadata ({len(binary)} bytes)")
    ctx.close()

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel='chrome') if __import__('os').environ.get('P39_INV_USE_SYSTEM_CHROME')=='1' else pw.chromium.launch(headless=True)
        test_group(browser)
        test_cancel_and_exempt(browser)
        test_pdf(browser)
        browser.close()
    print("P39_INV1_SYNTHETIC_UI_AND_PDF_PASS")

if __name__=="__main__":
    main()
