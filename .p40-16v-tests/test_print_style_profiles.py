"""P40-16V: screen-free local synthetic browser PDF style laboratory.

CANDIDATE print CSS is injected into the browser test only; it is not
written to the original billing-print.html or any production JS.
No real users, data, credentials, ERP snapshots, Supabase or network.
All layouts preserve both original-line table and the grouped item summary.
"""
import base64
import functools
import http.server
import io
import json
import threading
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
assert not (ROOT / ".env").exists(), "STOP: secrets in workspace"
server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_port}/"

# Original layout = baseline. Two alternate CSS profiles only adjust
# whitespace; neither hides summary, original lines, or makes 8pt text smaller.
PROFILES = {
    "published-unchanged": "",
    "compact-a4-readable": r"""
@media print {
 .paper.invoice-group-document {padding:4mm 12mm 4mm !important}
 .paper.invoice-group-document .head {padding-bottom:1mm !important}
 .paper.invoice-group-document .info {margin:1.4mm 0 !important; padding:1mm !important; gap:.8mm 1.5mm !important}
 .paper.invoice-group-document .info div {min-height:7.2mm !important; padding:.7mm 1.4mm !important; font-size:8.5pt !important}
 .paper.invoice-group-document .section {margin-top:1.3mm !important}
 .paper.invoice-group-document .section-title {padding:1.1mm 2.2mm !important; font-size:9pt !important}
 .paper.invoice-group-document .dense-original-details .dense-line-table th,
 .paper.invoice-group-document .dense-original-details .dense-line-table td {padding:.55mm .72mm !important; font-size:8.3pt !important; line-height:1.12 !important}
 .paper.invoice-group-document .dense-original-details .dense-line-table td.item {font-size:8.5pt !important}
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table th,
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table td {padding:.55mm .72mm !important; font-size:8.2pt !important; line-height:1.12 !important}
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table td.item {font-size:8.4pt !important}
 .paper.invoice-group-document .summary {margin-top:1.3mm !important}
 .paper.invoice-group-document .summary-row {min-height:5.8mm !important; padding:.7mm 1.8mm !important; font-size:8.5pt !important}
 .paper.invoice-group-document .note {margin-top:1.3mm !important; padding:1.2mm 1.8mm !important; font-size:8.3pt !important}
 .paper.invoice-group-document .sign {margin-top:.7mm !important}
 .paper.invoice-group-document .client-sign {padding-top:4mm !important}
 .paper.invoice-group-document .seal-wrap {height:13mm !important}
 .paper.invoice-group-document .seal {max-height:12mm !important}
}
""",
    "compact-a4-dense": r"""
@media print {
 .paper.invoice-group-document {padding:3.5mm 10mm 3.5mm !important}
 .paper.invoice-group-document .head {padding-bottom:.7mm !important}
 .paper.invoice-group-document .info {margin:.7mm 0 !important; padding:.7mm !important; gap:.5mm 1mm !important}
 .paper.invoice-group-document .info div {min-height:6.5mm !important; padding:.5mm 1mm !important; font-size:8.5pt !important}
 .paper.invoice-group-document .section {margin-top:.8mm !important}
 .paper.invoice-group-document .section-title {padding:.7mm 1.5mm !important; font-size:8.5pt !important}
 .paper.invoice-group-document .dense-original-details .dense-line-table th,
 .paper.invoice-group-document .dense-original-details .dense-line-table td {padding:.3mm .5mm !important; font-size:8.1pt !important; line-height:1.09 !important}
 .paper.invoice-group-document .dense-original-details .dense-line-table td.item {font-size:8.2pt !important}
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table th,
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table td {padding:.3mm .5mm !important; font-size:8.1pt !important; line-height:1.09 !important}
 .paper.invoice-group-document .grouped-item-summary .grouped-item-summary-table td.item {font-size:8.2pt !important}
 .paper.invoice-group-document .summary {margin-top:.8mm !important}
 .paper.invoice-group-document .summary-row {min-height:5mm !important; padding:.5mm 1.5mm !important; font-size:8.3pt !important}
 .paper.invoice-group-document .note {margin-top:.8mm !important; padding:.8mm 1.5mm !important; font-size:8.1pt !important}
 .paper.invoice-group-document .sign {margin-top:.4mm !important}
 .paper.invoice-group-document .client-sign {padding-top:3mm !important}
 .paper.invoice-group-document .seal-wrap {height:11mm !important}
 .paper.invoice-group-document .seal {max-height:10mm !important}
}
"""
}

def encode(obj):
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    return quote(base64.b64encode(data).decode(), safe="")

def sample(count, unique):
    lines = []
    for index in range(count):
        item = index if unique else index % 6
        lines.append({
            "house": f"SYNTH-H-{index+1:02d}",
            "item": f"SYNTH-ITEM-{item+1:02d}",
            "unit": "式", "qty": 1, "price": 100,
            "amount": 100, "sourcePricingType": "external-document",
            "pricingType": ""
        })
    return {
        "schema": "kushe-external-document-v1", "documentType": "billing",
        "title": "請款單", "number": "", "customer": "SYNTH-CUSTOMER",
        "project": "SYNTH-TARGET-M", "date": "2026-11-17",
        "taxMode": "未稅", "pricingMode": "", "invoiceStatus": "invoice_pending",
        "lines": lines, "salesAmount": count*100, "taxAmount": count*5,
        "totalAmount": count*105, "retentionAmount": 0,
        "receivableAmount": count*105, "publicNote": "SYNTHETIC TEST ONLY",
        "company": {"name": "酷舍企業有限公司", "englishName": "Cool Sir Limited Company",
                    "taxId": "00000000", "address": "SYNTH-LOCATION", "line": "TEST"},
        "fileName": "SYNTH.pdf", "mergedBillingProjects": ["SYNTH-TARGET-M"],
        "isMergedExternalBilling": True
    }

def check_rendered(page, count, unique):
    doc = page.locator("#paper")
    content = doc.inner_text()
    assert "SYNTH-TARGET-M" in content and "SYNTH-OTHER-L" not in content
    assert "施工項目彙總" in content
    assert "原施工明細合計" in content
    assert "原票號／狀態" not in content
    assert "SYNTH-INTERNAL-INVOICE" not in content
    assert page.locator(".dense-original-details .dense-line-table tbody tr").count() == count+1
    expected_summary = count if unique else 6
    assert page.locator(".grouped-item-summary .grouped-item-summary-table tbody tr").count() == expected_summary+1
    names = [f"SYNTH-ITEM-{i+1:02d}" for i in range(expected_summary)]
    assert all(n in content for n in names)
    assert doc.evaluate("(node)=>node.scrollWidth<=node.clientWidth+2"), "DOM horizontal clipping"
    assert page.locator(".dense-original-details .dense-line-table .line-total").count() == 1
    assert page.locator(".grouped-item-summary .line-total").count() == 1

cases = [(6,True), (18,True), (30,True), (30,False)]
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width":1280, "height":900})
        page.route("**/*", lambda route: route.continue_()
                   if route.request.url.startswith(BASE) else route.abort())
        for count, unique in cases:
            # Distinct path query, NOT hash-only navigation.
            case_tag = f"{count}-{int(unique)}"
            page.goto(BASE + f"billing-print.html?print=0&lab={case_tag}#" +
                      encode(sample(count,unique)), wait_until="load")
            page.locator(".dense-original-details .dense-line-table").wait_for()
            check_rendered(page,count,unique)
            for name, css in PROFILES.items():
                style = page.add_style_tag(content=css) if css else None
                pdf = page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
                pages = len(PdfReader(io.BytesIO(pdf)).pages)
                record = {"case": case_tag, "profile": name, "pages": pages}
                results.append(record)
                print("LAYOUT_RESULT " + json.dumps(record,ensure_ascii=False),flush=True)
                if style:
                    style.evaluate("(el)=>el.remove()")
        browser.close()
finally:
    server.shutdown()
# Profile approval requires 18 and 30 unique items both in a legible 1-page A4.
# This is diagnostic ONLY, and a green job never authorizes production changes.
by_profile = {}
for r in results:
    by_profile.setdefault(r["profile"], {})[r["case"]] = r["pages"]
for profile, values in by_profile.items():
    print("PROFILE_RESULT " + profile + " " +
          ("POSSIBLE" if all(values.get(case)==1 for case in ("18-1","30-1","30-0"))
           else "BLOCKED: >1 A4 page for at least one dense case"), flush=True)
print("DIAGNOSTIC COMPLETE: NO production CSS changed and NO release authorization", flush=True)
