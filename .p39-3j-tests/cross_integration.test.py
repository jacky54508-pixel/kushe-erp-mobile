"""P39-3J cross-module acceptance, synthetic-only, bound to 127.0.0.1.
Exercises a guarded publicNote Store write followed by single, merged,
historical, and original-bundle PDF rendering. Never reads live ERP data.
"""
import base64
import json
import os
from io import BytesIO
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

BASE="http://127.0.0.1:8797"
NOTE_FIXTURE=BASE+"/.p39-3i-tests/fixture.html"
GROUP_FIXTURE=BASE+"/.p39-inv1-tests/fixture.html"
PUBLIC_NOTE="P39-3J 虛構建商對外修訂備註"
INTERNAL_NOTE="原始合成備註"
PRIVATE_INVOICES=("SYN-AA000001","SYN-BB000002","2026-08-20","2026-10-20")

def pack(data):
    blob=json.dumps(data,ensure_ascii=False,separators=(",",":")).encode()
    return quote(base64.b64encode(blob).decode())

def printable(page, require_one=False):
    page.emulate_media(media="print")
    pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    reader=PdfReader(BytesIO(pdf))
    count=len(reader.pages)
    assert count>=1 and (count==1 if require_one else True),count
    for sheet in reader.pages:
        width,height=map(float,(sheet.mediabox.width,sheet.mediabox.height))
        assert 594<=width<=596 and 841<=height<=843,(width,height)
        extracted=sheet.extract_text() or ""
        for invoice in PRIVATE_INVOICES[:2]:
            assert invoice not in extracted,invoice
        assert INTERNAL_NOTE not in extracted,"internal note leaked to printed PDF"
    return count

def clean_public(page, expected_note=PUBLIC_NOTE):
    text=page.locator("#paper").inner_text()
    assert expected_note in text,(expected_note,text[:1200])
    assert INTERNAL_NOTE not in text,"internal only note leaked"
    for private in (*PRIVATE_INVOICES,"原請款／發票對照","稅務／發票"):
        assert private not in text,(private,text[:1600])
    return text

def verify_note_writer_and_single_pdf(ctx):
    page=ctx.new_page()
    page.goto(NOTE_FIXTURE)
    page.wait_for_function("!!window.KuSheERPStore")
    result=page.evaluate("""async(note)=>{
      const store=window.KuSheERPStore;
      await store.load();
      const before=structuredClone(store.getState());
      const view=store.p39BillingNoteRevisionContext('syn-b');
      const done=await store.saveP39BillingNoteRevision('syn-b',{
        expectedSnapshot:view.snapshot,note,reason:'P39-3J 跨模組虛構測試'});
      const after=structuredClone(store.getState());
      if(!done.financialUnchanged)throw Error('Writer failed financial guard');
      if(after.billings[0].note!=='原始合成備註')
        throw Error('Internal original note changed');
      if(after.billings[0].publicNote!==note)
        throw Error('Public note failed');
      for(const k of ['receivables','invoices','receipts','retentionReceipts',
        'bankTransactions','commissions','payroll','salaryPayments','banks']){
        if(JSON.stringify(before[k])!==JSON.stringify(after[k]))
          throw Error('PROTECTED_COLLECTION_CHANGED '+k);
      }
      if(after.billings[0].noteRevisionHistory.length!==1)
        throw Error('Revision audit missing');
      return {public:after.billings[0].publicNote,
        internal:after.billings[0].note,amount:after.receivables[0].amount,
        gross:after.billings[0].grossTotal};
    }""",PUBLIC_NOTE)
    assert result=={"public":PUBLIC_NOTE,"internal":INTERNAL_NOTE,
                    "amount":100000,"gross":105000},result
    page.add_script_tag(url=BASE+"/assets/js/billing-print.js")
    view=page.evaluate("""()=>{
      const store=window.KuSheERPStore;
      return window.KusheBillingPrint.buildExternalView(
        store.getState().billings[0]);
    }""")
    assert view["publicNote"]==PUBLIC_NOTE
    assert view["totalAmount"]==105000 and view["taxAmount"]==5000
    assert view["retentionAmount"]==5000 and view["receivableAmount"]==100000
    pdf_page=ctx.new_page()
    pdf_page.goto(BASE+"/billing-print.html?print=0#"+pack(view))
    pdf_page.wait_for_function("window.__billingPrintReady===true",timeout=20000)
    text=clean_public(pdf_page)
    assert "$100,000" in text and "$105,000" in text
    assert printable(pdf_page,require_one=True)==1
    return page

def group_document(seed):
    return seed.evaluate("""()=>{
      const sources=window.__p39synthetic.sources.map(
        row=>JSON.parse(JSON.stringify(row)));
      const totals=window.KuSheERPStore.externalBillingContext(
        sources.map(s=>s.document.billingId)).totals;
      const lines=sources.flatMap(source=>source.document.originalLines.map(l=>({
        house:l.house,item:l.item,unit:l.unit,qty:l.qty,
        price:l.price,amount:l.subtotal
      })));
      return {
        schema:'kushe-external-billing-group-v2',status:'archived',
        detailMode:'unified',revision:3,updatedAt:'2026-11-12T00:00:00.000Z',
        documentDate:'2026-11-12',note:'P39-3J 虛構建商對外修訂備註',
        customerName:sources[0].document.customerName,
        sourceSnapshots:sources.map(s=>s.document),
        settlementSnapshots:sources.map(s=>s.settlement),
        sourceIds:sources.map(s=>s.document.billingId),
        targetBillingId:sources[0].document.billingId,
        displayProjectName:sources[0].document.projectName,totals,
        unified:{taxMode:'未稅',lines,total:300000,target:300000,reason:''}
      };
    }""")

def verify_external_group(ctx,doc,historical):
    page=ctx.new_page()
    payload={"schema":"kushe-external-billing-print-v1","document":{
        **doc,"status":"archived" if historical else "active"
    }}
    if historical:
        payload["historical"]=True
    page.goto(BASE+"/external-billing-print.html#"+pack(payload))
    if historical:
        page.wait_for_function("!document.querySelector('#print').disabled",timeout=22000)
        assert page.locator(".historic").count()==1
        assert page.locator(".invoice-table").count()==0
    else:
        page.wait_for_url("**/billing-print.html?*",timeout=22000)
        page.wait_for_function("window.__billingPrintReady===true",timeout=22000)
        assert page.locator(".grouped-item-summary").count()==1
        assert page.locator(".invoice-ref-section").count()==0
        public_payload=page.evaluate("""()=>{
          return JSON.parse(decodeURIComponent(escape(atob(
            decodeURIComponent(location.hash.slice(1))))));
        }""")
        assert "sourceInvoiceReferences" not in public_payload
        assert "invoiceNo" not in public_payload
        assert public_payload["publicNote"]==PUBLIC_NOTE
    text=clean_public(page)
    assert "$315,000" in text and "$15,000" in text and "$300,000" in text
    printable(page)

def verify_bundle(ctx,seed):
    seed.evaluate("window.KusheBillingPrint={buildExternalView:r=>r._publicView}")
    seed.add_script_tag(url=BASE+"/assets/js/billing-bundle-print.js")
    data=seed.evaluate("""()=>{
      const sources=window.__p39synthetic.sources;
      const rows=sources.map(s=>{
        const d=s.document,a=d.anchors;
        return {id:d.billingId,customer:d.customerId,customerName:d.customerName,
          project:d.projectId,projectName:d.projectName,date:d.date,
          number:d.number,invoiceStatus:d.invoiceStatus,invoiceNo:d.invoiceNo,
          _publicView:{
            number:d.number,customer:d.customerName,project:d.projectName,
            date:d.date,taxMode:d.taxMode,invoiceStatus:d.invoiceStatus,
            lines:d.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,
              qty:l.qty,price:l.price,amount:l.subtotal})),
            salesAmount:a.untaxed,taxAmount:a.tax,totalAmount:a.grossTotal,
            retentionAmount:a.retention,receivableAmount:a.receivable,
            publicNote:'P39-3J 虛構建商對外修訂備註',
            company:{name:'虛構有限公司',taxId:'SYNTHETIC'}
          }};
      });
      return window.KusheBillingBundlePrint.buildCombinedView(rows);
    }""")
    assert "invoiceStatus" not in data and "invoiceDisplay" not in data
    for row in data["billings"]:
        assert "invoiceStatus" not in row
        assert row["publicNote"]==PUBLIC_NOTE
    assert data["totals"]["totalAmount"]==315000
    # A stale external URL must still be safely rendered.
    data["invoiceDisplay"]="已開發票"
    data["billings"][0]["invoiceStatus"]="invoiced"
    print_page=ctx.new_page()
    print_page.goto(BASE+"/billing-bundle-print.html?print=0#"+pack(data))
    print_page.wait_for_function("window.__billingBundlePrintReady===true",timeout=22000)
    assert print_page.locator(".project-section").count()==2
    text=clean_public(print_page)
    assert "$315,000" in text and "$15,000" in text
    printable(print_page)

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") if (
            os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1"
        ) else pw.chromium.launch(headless=True)
        ctx=browser.new_context(viewport={"width":1260,"height":900})
        note_page=verify_note_writer_and_single_pdf(ctx)
        source=ctx.new_page()
        source.goto(GROUP_FIXTURE)
        original=source.evaluate("window.__p39synthetic.snapshot()")
        group=group_document(source)
        assert len(group["sourceSnapshots"])==2
        assert group["sourceSnapshots"][0]["invoiceNo"]=="SYN-AA000001"
        assert group["totals"]["grossTotal"]==315000
        verify_external_group(ctx,group,True)
        verify_external_group(ctx,group,False)
        verify_bundle(ctx,source)
        assert source.evaluate("window.__p39synthetic.snapshot()")==original
        assert note_page.evaluate(
            "window.KuSheERPStore.getState().billings[0].note")==INTERNAL_NOTE
        ctx.close()
        browser.close()
    print("PASS: P39-3J public-note CAS to 4 PDF exports;"
          " originals, totals, retention, invoice privacy, A4 and finance unchanged",flush=True)

if __name__=="__main__":
    main()
