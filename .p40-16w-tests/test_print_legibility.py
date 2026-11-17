"""P40-16W -- printable-PDF artifacts and legibility checks, entirely synthetic.

Reuse P40-16V's CSS profiles verbatim. Render original main billing-print.html
in isolated Chromium, no live authentication, network, ERP data or PDF writes.
GitHub artifact previews omit real company logo/seal via route interception.
"""
import ast
import base64
import functools
import http.server
import json
import re
import threading
from pathlib import Path
from urllib.parse import quote
import fitz
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".p40-16w-review"
OUT.mkdir(exist_ok=True)
assert not (ROOT / ".env").exists(), "STOP: do not run against any .env"
source = ast.parse((ROOT / ".p40-16v-tests/test_print_style_profiles.py").read_text())
profile_node = next(n for n in source.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == "PROFILES" for t in n.targets))
PROFILES = ast.literal_eval(profile_node.value)
assert set(PROFILES) == {"published-unchanged", "compact-a4-readable", "compact-a4-dense"}
server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_port}/"

def encode(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return quote(base64.b64encode(raw).decode(), safe="")

def fixture(count, unique):
    lines = []
    for i in range(count):
        item_num = i + 1 if unique else (i % 6) + 1
        lines.append({
            "house": f"SYNTH-H-{i+1:02d}", "item": f"SYNTH-ITEM-{item_num:02d}",
            "unit": "式", "qty": 1, "price": 100, "amount": 100,
            "sourcePricingType": "external-document", "pricingType": ""
        })
    return {
        "schema": "kushe-external-document-v1", "documentType": "billing",
        "title": "請款單", "number": "", "customer": "SYNTH-CUSTOMER",
        "project": "SYNTH-TARGET-M", "date": "2026-11-17",
        "taxMode": "未稅", "pricingMode": "", "invoiceStatus": "invoice_pending",
        "lines": lines, "salesAmount": count * 100, "taxAmount": count * 5,
        "totalAmount": count * 105, "retentionAmount": 0,
        "receivableAmount": count * 105,
        "publicNote": "SYNTHETIC TEST DOCUMENT - DO NOT SEND",
        "company": {"name": "SYNTH-TEST-COMPANY", "englishName": "SYNTHETIC ONLY",
                    "taxId": "00000000", "address": "SYNTH-LOCATION", "line": "TEST"},
        "fileName": "SYNTHETIC-DO-NOT-SEND.pdf",
        "mergedBillingProjects": ["SYNTH-TARGET-M"],
        "isMergedExternalBilling": True
    }

def block_external(route):
    url = route.request.url
    # Do not include the real corporate logo or any real stamp in public CI artifacts.
    if url.startswith(BASE + "enterprise/index.html"):
        return route.fulfill(status=200, content_type="text/html",
                             body="<script>const companyLogoAsset=''; const companySealAsset='';</script>")
    if url.startswith(BASE):
        return route.continue_()
    return route.abort()

case_specs = [(18, True), (30, False), (30, True)]
reports = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width":1280, "height":900})
        page.route("**/*", block_external)
        for count, unique in case_specs:
            key = f"{count}-{'unique' if unique else 'six-groups'}"
            for profile in ("published-unchanged", "compact-a4-dense"):
                page.goto(BASE + "billing-print.html?print=0&case=" + key
                          + "&profile=" + profile + "#" + encode(fixture(count, unique)),
                          wait_until="load")
                page.locator(".dense-original-details .dense-line-table").wait_for()
                if profile != "published-unchanged":
                    page.add_style_tag(content=PROFILES[profile])
                page.emulate_media(media="print")
                original_rows = page.locator(".dense-original-details .dense-line-table tbody tr")
                grouped_rows = page.locator(".grouped-item-summary .grouped-item-summary-table tbody tr")
                expected_summary = count if unique else 6
                assert original_rows.count() == count + 1, f"{key}: original line loss"
                assert grouped_rows.count() == expected_summary + 1, f"{key}: grouped summary loss"
                printable = page.locator("#paper").inner_text()
                assert "施工項目彙總" in printable and "原施工明細合計" in printable
                assert "SYNTH-TARGET-M" in printable and "SYNTH-OTHER-L" not in printable
                assert "SYNTH-INTERNAL-INVOICE" not in printable
                font_points = page.evaluate("""() => {
                  const cells=[...document.querySelectorAll(
                    '.dense-line-table th,.dense-line-table td,' +
                    '.grouped-item-summary-table th,.grouped-item-summary-table td')];
                  return cells.map(e => parseFloat(getComputedStyle(e).fontSize)*72/96);
                }""")
                min_pt = round(min(font_points), 2)
                pdf = page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
                stem = f"{key}-{profile}"
                (OUT / (stem + ".pdf")).write_bytes(pdf)
                doc = fitz.open(stream=pdf, filetype="pdf")
                extracted = "".join(pg.get_text(sort=True) for pg in doc)
                condensed = re.sub(r"\s+", "", extracted)
                missing = [f"SYNTH-H-{i:02d}" for i in range(1, count+1)
                           if f"SYNTH-H-{i:02d}" not in condensed]
                missing += [f"SYNTH-ITEM-{i:02d}" for i in range(1,expected_summary+1)
                            if f"SYNTH-ITEM-{i:02d}" not in condensed]
                page_count = len(doc)
                off_page = []
                for page_index, pdf_page in enumerate(doc):
                    assert 590 <= pdf_page.rect.width <= 597, "non-A4 width"
                    assert 839 <= pdf_page.rect.height <= 844, "non-A4 height"
                    for block in pdf_page.get_text("dict")["blocks"]:
                        if "lines" not in block:
                            continue
                        for line in block["lines"]:
                            for span in line["spans"]:
                                text = span["text"].strip()
                                if not text:
                                    continue
                                x0,y0,x1,y1 = span["bbox"]
                                if x0 < -0.5 or y0 < -0.5 or x1 > pdf_page.rect.width + 0.5 or y1 > pdf_page.rect.height + 0.5:
                                    off_page.append([page_index, text[:40]])
                    pdf_page.get_pixmap(matrix=fitz.Matrix(1.35,1.35), alpha=False).save(
                        str(OUT / f"{stem}-page{page_index+1}.png"))
                report = {
                    "case": key, "profile": profile, "pdf_pages": page_count,
                    "source_lines": count, "summary_groups": expected_summary,
                    "min_table_font_pt": min_pt, "missing_pdf_labels": missing,
                    "off_page_text": off_page,
                    "a4_single_page": page_count == 1,
                    "content_complete": not missing and not off_page
                }
                reports.append(report)
                print("READABILITY_RESULT " + json.dumps(report, ensure_ascii=False), flush=True)
                doc.close()
        browser.close()
finally:
    server.shutdown()

(OUT / "summary.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2))
required_cases = ("18-unique", "30-six-groups")
candidate = [r for r in reports if r["profile"]=="compact-a4-dense"]
issues = []
for item in candidate:
    if item["case"] in required_cases:
        if item["pdf_pages"] != 1:
            issues.append(f"{item['case']}: A4 overflow")
        if item["min_table_font_pt"] < 8.0:
            issues.append(f"{item['case']}: unreadably small table font")
        if not item["content_complete"]:
            issues.append(f"{item['case']}: missing/clipped PDF text")
    if item["case"]=="30-unique" and item["pdf_pages"] > 1:
        print("BLOCKED 30-unique exceeds 1 A4; NEVER omit original or grouped lines")
    if not item["content_complete"]:
        issues.append(f"{item['case']}: missing/clipped PDF text")
if issues:
    print("CANDIDATE_BLOCKED " + "; ".join(issues), flush=True)
    raise AssertionError("; ".join(issues))
print("CANDIDATE_FEASIBILITY_ONLY: 18 unique and 30 repeated on A4; artifact visual review still required")
print("NOT PRODUCTION PASS: 30 unique still requires separate safe handling and user approval")
