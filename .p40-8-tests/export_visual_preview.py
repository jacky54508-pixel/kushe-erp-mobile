"""P40-8: render actual candidate HTML with synthetic-only data, on 127.0.0.1."""
import importlib.util
import json
import os
from io import BytesIO
from pathlib import Path
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

test_path=Path(__file__).resolve().parents[1]/".p40-7-tests"/"end_to_end_pdf.test.py"
spec=importlib.util.spec_from_file_location("p40_seven_synthetic_fixture",test_path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT=Path("p40-8-preview-artifacts")
ROOT.mkdir(exist_ok=True)
test_data=module.make_document(18)
assert len(test_data["unified"]["lines"])==18
original=json.dumps(test_data,sort_keys=True,ensure_ascii=False)
fmt=lambda num:chr(36)+format(num,",.0f")
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
    context=browser.new_context(viewport={"width":1280,"height":950},device_scale_factor=1)
    page=module.open_through_real_external_route(context,test_data)
    page.wait_for_function("window.__billingPrintReady===true")
    rows=page.locator(".dense-line-table tbody tr")
    assert rows.count()==19,rows.count()
    for i in range(18):
        row=rows.nth(i).locator("td").all_inner_texts()
        old=test_data["unified"]["lines"][i]
        expected=[str(i+1),old["item"],old["unit"],str(old["qty"]),fmt(old["price"]),fmt(old["amount"])]
        assert row==expected,(i,row,expected)
    body=page.locator("#paper").inner_text()
    assert "虛構耀時代L區" in body and "施工明細" in body and "施工項目彙總" in body
    for illegal in ["虛構耀時代O3-1","M2","M4","M6","M8","M10","M12","M14","M16","M18","合併請款範圍"]:
        assert illegal not in body,illegal
    assert json.dumps(test_data,sort_keys=True,ensure_ascii=False)==original
    page.locator("#paper").screenshot(path=str(ROOT/"P40-8_虛構資料_18筆_畫面預覽.png"),animations="disabled")
    page.emulate_media(media="print")
    binary=page.pdf(format="A4",print_background=True,prefer_css_page_size=True)
    assert len(PdfReader(BytesIO(binary)).pages)==1
    (ROOT/"P40-8_虛構資料_18筆_A4正式候選排版.pdf").write_bytes(binary)
    (ROOT/"P40-8_驗收說明.txt").write_text(
        "P40-8 畫面驗收樣張\n\n此 PDF/PNG 由 P40-7 候選版的 HTML/JavaScript 與 Chrome 列印功能產生。\n"
        "資料均為虛構或樣板預設；不得作為對外請款依據。\n"
        "請核對：18 筆逐筆列印、序號 1 到 18、每筆品名/單位/數量/單價/金額、彙總、A4 單頁。\n"
        "沒有修改 main、beta、Supabase 或任何真實資料。\n",encoding="utf-8")
    print(json.dumps({"result":"PASS","rows":18,"pdf_pages":1,"protected_original":True,"files":[p.name for p in ROOT.iterdir()]},ensure_ascii=False))
    context.close()
    browser.close()
