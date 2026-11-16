"""P40-12: real billing-detail UI with synthetic seeded Store, localhost only. No cloud access."""
import json
import os
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8797/.p40-12-tests/synthetic_billing.html"
def test():
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
  context=browser.new_context(viewport={"width":1100,"height":900})
  page=context.new_page()
  errors=[]
  page.on("pageerror",lambda error:errors.append(str(error)))
  external=[]
  page.on("request",lambda req:external.append(req.url) if not req.url.startswith("http://127.0.0.1:8797/") else None)
  page.goto(URL,wait_until="load")
  page.wait_for_function("() => !!window.KuSheERPStore && !!window.KusheBillingDiscountPreview && !!window.KusheBilling")
  page.evaluate("async()=>{await window.KuSheERPStore.load()}")
  before=page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")
  # Actual click path in the real billing detail modal, not merely a mocked button.
  page.evaluate("window.KusheBilling.openDetail('SYN-EDIT')")
  assert page.locator("[data-billing-discount-readonly]").count()==1
  page.locator("[data-billing-discount-readonly]").click()
  assert page.locator(".p40-12-shade").count()==1
  assert page.locator(".p40-12-modal button").all_inner_texts()==["關閉","試算差額（不儲存）"]
  assert page.locator(".p40-12-modal input").get_attribute("type")=="number"
  assert page.locator(".p40-12-modal form").count()==0
  page.locator(".p40-12-modal input").fill("99750")
  page.locator(".p40-12-modal button").last.click()
  assert page.locator("[data-preview-status='ok']").count()==1
  assert page.locator(".p40-12-result tbody tr").count()==5
  rows=page.locator(".p40-12-result tbody tr")
  vals=[row.locator("td").all_inner_texts() for row in rows.all()]
  assert vals==[
    ["未稅金額","$100,000","$95,000","−$5,000"],
    ["營業稅","$5,000","$4,750","−$250"],
    ["含稅／總額","$105,000","$99,750","−$5,250"],
    ["保留款","$5,250","$4,988","−$262"],
    ["本期應收","$99,750","$94,762","−$4,988"]],vals
  assert "僅供核對" in page.locator(".p40-12-result .alert").inner_text()
  assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
  page.locator(".p40-12-modal button").first.click()
  assert page.locator(".p40-12-shade").count()==0

  # Issued, paid, cheques and retention receipt have no edit/post action at all.
  for ident,word in [
    ("SYN-ISSUED","已開發票"),("SYN-RECEIVED","已有收款"),
    ("SYN-CHEQUE","支票登記存在"),("SYN-RETENTION","已有保留款")]:
   page.evaluate("(id)=>window.KusheBillingDiscountPreview.open(id)",ident)
   page.locator(".p40-12-modal input").fill("99750")
   page.locator(".p40-12-modal button").last.click()
   assert page.locator("[data-preview-status='ok']").count()==1
   notice=page.locator(".p40-12-result .alert").inner_text()
   assert word in notice,(ident,notice)
   assert "不能直接修改" in notice or "核對" in notice
   assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
   page.locator(".p40-12-modal button").first.click()

  # Incomplete and invalid inputs block without writing data.
  page.evaluate("window.KusheBillingDiscountPreview.open('SYN-EDIT')")
  page.locator(".p40-12-modal input").fill("10")
  page.locator(".p40-12-modal button").last.click()
  assert page.locator("[data-preview-status='blocked']").count()==1
  assert "停止試算" in page.locator(".p40-12-result .alert").inner_text()
  assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
  assert not external,external
  assert not errors,errors
  browser.close()
 print("PASS P40-12: real billing detail opens readonly modal; 5 accurate financial rows; paid/invoice/cheque/retention protected; no data writes")
if __name__=="__main__":
 test()
