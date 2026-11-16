"""P40-13 source-faithful real ERP billing detail screenshots. Synthetic only.
Runs against P40-12 candidate from pinned GitHub head, localhost in CI; no network/API/DB.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE="http://127.0.0.1:8797/.p40-12-tests/synthetic_billing.html"
OUT=Path("p40-13-ui-proof")
OUT.mkdir(exist_ok=True)

def make_page(browser,width):
    ctx=browser.new_context(viewport={"width":width,"height":910},device_scale_factor=1)
    page=ctx.new_page()
    outside=[]
    errors=[]
    page.on("request",lambda req:outside.append(req.url) if not req.url.startswith("http://127.0.0.1:8797/") else None)
    page.on("pageerror",lambda exc:errors.append(str(exc)))
    page.goto(BASE,wait_until="load")
    page.wait_for_function("() => window.KuSheERPStore && window.KusheBillingDiscountPreview && window.KusheBilling")
    page.evaluate("async()=>await window.KuSheERPStore.load()")
    return ctx,page,outside,errors

def money_table(page):
    rows=page.locator(".p40-12-result tbody tr")
    assert rows.count()==5,rows.count()
    found=[node.locator("td").all_inner_texts() for node in rows.all()]
    expected=[
        ["未稅金額","$100,000","$95,000","−$5,000"],
        ["營業稅","$5,000","$4,750","−$250"],
        ["含稅／總額","$105,000","$99,750","−$5,250"],
        ["保留款","$5,250","$4,988","−$262"],
        ["本期應收","$99,750","$94,762","−$4,988"]]
    assert found==expected,(found,expected)

def desktop(browser):
    ctx,page,outside,errors=make_page(browser,1280)
    before=page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")
    page.evaluate("window.KusheBilling.openDetail('SYN-EDIT')")
    button=page.locator("[data-billing-discount-readonly]")
    assert button.count()==1
    assert "議價折讓試算" in button.inner_text()
    page.screenshot(path=str(OUT/"01_虛構請款詳情_折讓試算按鈕.png"),full_page=True,animations="disabled")
    button.click()
    assert page.locator(".p40-12-shade").count()==1
    page.locator(".p40-12-modal input").fill("99750")
    page.locator(".p40-12-modal button").last.click()
    assert page.locator("[data-preview-status='ok']").count()==1
    money_table(page)
    assert page.locator(".p40-12-modal button").all_inner_texts()==["關閉","試算差額（不儲存）"]
    page.screenshot(path=str(OUT/"02_虛構請款_折讓差異_桌面.png"),full_page=True,animations="disabled")
    assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
    assert not outside and not errors,(outside,errors)
    ctx.close()

def mobile(browser):
    ctx,page,outside,errors=make_page(browser,390)
    before=page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")
    page.evaluate("window.KusheBillingDiscountPreview.open('SYN-EDIT')")
    page.locator(".p40-12-modal input").fill("99750")
    page.locator(".p40-12-modal button").last.click()
    assert page.locator("[data-preview-status='ok']").count()==1
    money_table(page)
    page.screenshot(path=str(OUT/"03_虛構請款_折讓差異_手機.png"),full_page=True,animations="disabled")
    assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
    assert not outside and not errors,(outside,errors)
    ctx.close()

def blocked(browser):
    ctx,page,outside,errors=make_page(browser,1280)
    before=page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")
    page.evaluate("window.KusheBillingDiscountPreview.open('SYN-ISSUED')")
    page.locator(".p40-12-modal input").fill("99750")
    page.locator(".p40-12-modal button").last.click()
    assert page.locator("[data-preview-status='ok']").count()==1
    assert "已開發票" in page.locator(".p40-12-result .alert").inner_text()
    assert "不能直接修改" in page.locator(".p40-12-result .alert").inner_text()
    page.screenshot(path=str(OUT/"04_虛構已開票請款_安全鎖定提示.png"),full_page=True,animations="disabled")
    assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
    assert not outside and not errors,(outside,errors)
    ctx.close()

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") if os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
        desktop(browser)
        mobile(browser)
        blocked(browser)
        browser.close()
    summary={
      "stage":"P40-13","status":"PASS","data":"synthetic-only",
      "screenshots":[p.name for p in sorted(OUT.glob("*.png"))],
      "finance_changes":0,"main_changes":0,"beta_changes":0,"supabase_changes":0,
      "limitations":"Only readonly preview. No discount posting and no live ERP UI verification.",
      "please_review":"Position/wording of button, five financial rows, mobile layout and locks; approval of layout is not deployment consent."
    }
    (OUT/"P40-13_驗收說明.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False))

if __name__=="__main__":
    main()
