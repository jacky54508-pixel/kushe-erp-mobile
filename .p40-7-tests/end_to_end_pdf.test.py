"""P40-7: only synthetic, loopback-only browser tests for real public print handoff.
Never touches real Supabase, main, beta, or real invoice data.
"""
import base64
from io import BytesIO
import json
import os
from urllib.parse import quote, urlsplit
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

BASE="http://127.0.0.1:8797"
def encode(value):
    raw=json.dumps(value,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    return quote(base64.b64encode(raw).decode("ascii"),safe="")

def make_document(line_count=18,other_project="虛構耀時代O3-1",note=""):
    # Not copied from a real billing record: all names/IDs, quantities and amounts invented.
    lines=[]
    for i in range(line_count):
        line=dict(house=("L" if i%2==0 else "M")+str(i+1),
                  item=["虛構地板處理","虛構鋁窗美容","虛構門片美容"][i%3],
                  unit=["塊","戶","面"][i%3],
                  qty=1,price=1000,amount=1000)
        lines.append(line)
    amount=len(lines)*1000
    part_a=amount//2
    part_b=amount-part_a
    def source(code,project,untaxed):
        tax=round(untaxed*.05)
        gross=untaxed+tax
        return dict(billingId=code,number=code,receivableId=code+"-AR",
                    projectName=project,customerId="SYN-TEST-CUSTOMER",
                    invoiceStatus="invoice_pending",invoiceNo="",invoiceDate="",
                    taxMode="未稅",originalLines=[],
                    anchors=dict(untaxed=untaxed,tax=tax,grossTotal=gross,
                                 retention=0,receivable=gross))
    a=source("SYN-L","虛構耀時代L區",part_a)
    b=source("SYN-X",other_project,part_b)
    def settlement(s):
        due=s["anchors"]["receivable"]
        return dict(billingId=s["billingId"],received=0,outstanding=due,
                    pendingCheque=0,retentionReceived=0,retentionOutstanding=0,
                    availableToCollect=due)
    tax=a["anchors"]["tax"]+b["anchors"]["tax"]
    total=amount+tax
    return dict(schema="kushe-external-billing-group-v2",status="active",
                detailMode="unified",displayProjectName="虛構耀時代L區",
                targetBillingId="SYN-L",customerName="虛構建商",
                documentDate="2026-11-15",sourceIds=["SYN-L","SYN-X"],
                sourceSnapshots=[a,b],settlementSnapshots=[settlement(a),settlement(b)],
                note=note,
                unified=dict(taxMode="未稅",lines=lines,total=amount,target=amount,
                             reason="模擬重新編排說明，僅供測試"),
                totals=dict(untaxed=amount,tax=tax,grossTotal=total,
                            retention=0,receivable=total,received=0,
                            outstanding=total,retentionReceived=0,
                            retentionOutstanding=0,pendingCheque=0,
                            availableToCollect=total))

def open_through_real_external_route(context,document):
    page=context.new_page()
    payload=dict(schema="kushe-external-billing-print-v1",historical=False,document=document)
    page.goto(BASE+"/external-billing-print.html#"+encode(payload),wait_until="load")
    page.wait_for_url("**/billing-print.html*",timeout=30000)
    page.wait_for_function("window.__billingPrintReady===true",timeout=30000)
    return page

def verify_preserved_customer_rows(browser,amount_count=18):
    context=browser.new_context(viewport={"width":1250,"height":900})
    document=make_document(amount_count)
    unchanged=json.dumps(document,ensure_ascii=False,sort_keys=True)
    page=open_through_real_external_route(context,document)
    table=page.locator(".dense-line-table")
    assert table.count()==1,"must not replace original detail with a summary"
    assert table.locator("thead tr th").first.inner_text()=="序號"
    rows=table.locator("tbody tr")
    assert rows.count()==amount_count+1,("expected all originals plus subtotal",rows.count())
    for i in range(amount_count):
        values=rows.nth(i).locator("td").all_inner_texts()
        original=document["unified"]["lines"][i]
        assert values==[str(i+1),original["item"],original["unit"],str(original["qty"]),
                        "$1,000","$1,000"],("changed or missing original row",i,values)
    assert "施工項目彙總" in page.locator("#paper").inner_text()
    expected_groups=len(set(line["item"] for line in document["unified"]["lines"]))
    assert page.locator(".grouped-item-summary-table tbody tr").count()==expected_groups+1
    assert page.locator(".matrix").count()==0
    visible=page.locator("#paper").inner_text()
    assert "虛構耀時代L區" in visible
    for forbidden in ["M2","M4","M6","M8","M10","M12","M14","M16","M18",
                      "虛構耀時代O3-1","合併請款範圍"]:
        assert forbidden not in visible,("foreign zone leaked",forbidden)
    public=page.evaluate("""() => JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(location.hash.slice(1))))))""")
    assert len(public["lines"])==amount_count
    assert all(line["house"]=="" for line in public["lines"])
    assert public["salesAmount"]==amount_count*1000
    assert public["totalAmount"]==round(amount_count*1050)
    assert json.dumps(document,ensure_ascii=False,sort_keys=True)==unchanged
    page.emulate_media(media="print")
    pdf=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    reader=PdfReader(BytesIO(pdf))
    assert len(reader.pages)==1,("A4 overflow",len(reader.pages))
    print(f"PASS: {amount_count} unchanged per-line rows, neutral numbering, no foreign-house leaks, A4 one page")
    context.close()

def verify_regression(browser):
    context=browser.new_context()
    # Same-zone documents remain in their existing, non-masked per-house layout.
    page=open_through_real_external_route(context,make_document(18,other_project="虛構耀時代L區"))
    assert page.locator(".dense-line-table thead th").first.inner_text()=="戶別"
    assert page.locator(".dense-line-table tbody tr").nth(1).locator("td").first.inner_text()=="M2"
    page.close()
    # Public-note foreign zone references must be rejected rather than silently removed.
    invalid=make_document(18,note="依照 M區 原戶別施工")
    payload=dict(schema="kushe-external-billing-print-v1",historical=False,document=invalid)
    bad=context.new_page()
    bad.goto(BASE+"/external-billing-print.html#"+encode(payload),wait_until="load")
    assert bad.locator(".error").count()==1,bad.locator("#paper").inner_text()
    assert "來源區域" in bad.locator(".error").inner_text()
    assert urlsplit(bad.url).path.endswith("/external-billing-print.html"),bad.url
    context.close()
    print("PASS: same-zone layout retains real house labels; public-note foreign zone is blocked")

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
        verify_preserved_customer_rows(browser,18)
        verify_preserved_customer_rows(browser,2)
        verify_regression(browser)
        browser.close()
    print("PASS P40-7 ORIGINAL ROWS + CUSTOMER-ZONE PDF PRIVACY")

if __name__=="__main__":
    main()
