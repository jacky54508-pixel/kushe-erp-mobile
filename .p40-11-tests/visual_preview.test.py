"""P40-11: static preview UI smoke/visual test. SYNTHETIC data and localhost only."""
import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE="http://127.0.0.1:8797/.p40-11-lab/discount_preview.html"
OUT=Path("p40-11-preview-artifacts")
OUT.mkdir(exist_ok=True)
def money(n):
    return ("−" if n<0 else "")+"$"+format(abs(n),",")
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,channel="chrome") if os.environ.get("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
    page=browser.new_page(viewport={"width":1280,"height":1000},device_scale_factor=1)
    requests=[]
    page.on("request",lambda req:requests.append(req.url))
    page.goto(BASE,wait_until="load")
    page.wait_for_function("() => window.__P40PreviewResult?.mode==='PREVIEW_ONLY'")
    normal=page.evaluate("window.__P40PreviewResult")
    assert normal["original"]["grossTotal"]==105000,normal
    assert normal["proposed"]["grossTotal"]==99750,normal
    assert normal["proposed"]["retention"]==4988,normal
    assert normal["proposed"]["receivable"]==94762,normal
    assert normal["canPost"] is False
    assert page.locator("#comparison tbody tr").count()==5
    assert page.locator("#settlement tbody tr").count()==7
    assert len(normal["locks"])==0
    assert "未經確認不得入帳" in page.locator("#blockers").inner_text()
    page.screenshot(path=str(OUT/"P40-11_虛構_議價草稿_無收款.png"),full_page=True)
    page.locator("#case").select_option("paid")
    page.locator("#approved").fill("94500")
    page.wait_for_function("() => window.__P40PreviewResult?.approval?.targetGross===94500")
    paid=page.evaluate("window.__P40PreviewResult")
    locks={lock["code"] for lock in paid["locks"]}
    for key in ["ISSUED_INVOICE","MERGED_BILLING","RECEIPT_EXISTS","BANK_LINKED"]:
        assert key in locks,(key,paid)
    assert paid["canPost"] is False
    assert "人工核對" in page.locator("#status").inner_text()
    page.screenshot(path=str(OUT/"P40-11_虛構_議價草稿_已開票已收款.png"),full_page=True)
    page.locator("#case").select_option("cheque")
    page.wait_for_function("() => window.__P40PreviewResult?.settlement?.pendingCheque===15000")
    cheque=page.evaluate("window.__P40PreviewResult")
    assert any(x["code"]=="CHEQUE_EXISTS" for x in cheque["locks"])
    assert any(x["code"]=="RETENTION_RECEIPT_EXISTS" for x in cheque["locks"])
    page.locator("#case").select_option("noinvoice")
    page.wait_for_function("() => window.__P40PreviewResult?.proposed?.tax===0")
    assert page.evaluate("window.__P40PreviewResult.proposed.receivable")==89775
    noinvoice=page.evaluate("window.__P40PreviewResult")
    assert noinvoice["proposed"]["tax"]==0
    assert noinvoice["proposed"]["grossTotal"]==94500
    assert noinvoice["readOnly"] is True
    page.locator("#approved").fill("0")
    assert "已停止試算" in page.locator("#status").inner_text()
    assert page.locator("#comparison tbody tr").count()==0
    assert all(u.startswith("http://127.0.0.1:8797/") for u in requests),requests
    note={
       "status":"PASS","cases":["no-receipt","issued-received-merged","cheque-retention","no-invoice","invalid amount"],
       "main_or_beta_changed":False,"preview_only":True,"writes_to_ERP":0,
       "images":[path.name for path in OUT.glob("*.png")]
    }
    (OUT/"P40-11_畫面驗收與限制.json").write_text(json.dumps(note,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(note,ensure_ascii=False))
    browser.close()
