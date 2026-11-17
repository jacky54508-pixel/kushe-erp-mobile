"""P40-16U: isolated synthetic dense customer billing PDF in desktop/mobile Chromium.

Not a test of real billing records, invoices, Supabase, or final external group adapter.
All browser network traffic is restricted to a loopback static server.
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
assert not (ROOT / '.env').exists(), 'STOP: forbidden .env'
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{server.server_port}/'

def encode(value):
    return quote(base64.b64encode(
        json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    ).decode(), safe='')

def specimen(size):
    # Unique item descriptions ensure missing rows cannot be hidden by grouping.
    lines = [
        {'house': f'SYNTH-{i:02d}', 'item': f'SYNTH-施工項目-{i:02d}',
         'unit': '式', 'qty': 1, 'price': 100, 'amount': 100,
         'pricingType': '', 'sourcePricingType': 'external-document'}
        for i in range(1, size + 1)
    ]
    return {
        'schema': 'kushe-external-document-v1', 'documentType': 'billing',
        'title': '請款單', 'number': '', 'customer': 'SYNTH-建商',
        'project': 'SYNTH-M區', 'date': '2026-11-17',
        'taxMode': '未稅', 'pricingMode': '', 'invoiceStatus': 'invoice_pending',
        'lines': lines, 'salesAmount': size*100, 'taxAmount': size*5,
        'totalAmount': size*105, 'retentionAmount': 0,
        'receivableAmount': size*105, 'publicNote': 'SYNTH-虛構測試，禁止對外使用',
        'company': {'name': '酷舍企業有限公司', 'englishName': 'Cool Sir Limited Company',
                    'taxId': '00000000', 'address': 'SYNTH-測試地點', 'line': 'SYNTH'},
        'fileName': 'SYNTH-TEST.pdf', 'mergedBillingProjects': ['SYNTH-M區'],
        'isMergedExternalBilling': True
    }

def verify_page(page, count):
    page.goto(ORIGIN+'billing-print.html?print=0#'+encode(specimen(count)), wait_until='load')
    page.locator('#paper .section').first.wait_for()
    text = page.locator('#paper').inner_text()
    assert 'SYNTH-M區' in text and 'SYNTH-L區' not in text
    assert '施工項目彙總' in text and '明細合計' in text
    assert 'SYNTH-PRIVATE-INVOICE-08' not in text
    assert 'SYNTH-PRIVATE-INVOICE-10' not in text
    assert '原票號／狀態' not in text
    for i in range(1, count+1):
        assert f'SYNTH-施工項目-{i:02d}' in text, ('missing row', i)
    # The real template renders TWO .detail tables for dense merged documents:
    # the per-house original lines and a separate item summary. Counting both
    # as one table gives a false assertion failure (18/30-line fixture).
    is_dense = page.locator('#paper').evaluate(
        "(el) => el.classList.contains('invoice-group-document') "
        "&& !!el.querySelector('.dense-original-details')"
    )
    # The published template selects dense mode when houses > 9,
    # item types > 5, OR original lines > 12. Inspect the rendered
    # structure instead of guessing from line count.
    assert is_dense == (count > 5), (
        'Unexpected print mode', count, is_dense)
    if is_dense:
        original_rows = page.locator('.dense-original-details .dense-line-table tbody tr')
        summary_rows = page.locator('.grouped-item-summary .grouped-item-summary-table tbody tr')
        assert original_rows.count() == count + 1, (
            'original lines count mismatch', count, original_rows.count())
        assert summary_rows.count() == count + 1, (
            'summary lines count mismatch', count, summary_rows.count())
        assert '原施工明細合計' in original_rows.last.inner_text()
        assert '明細合計' in summary_rows.last.inner_text()
    else:
        standard_rows = page.locator('.section .detail tbody tr')
        assert standard_rows.count() == count + 1, (
            'standard summary count mismatch', count, standard_rows.count())
    assert page.locator('#paper').evaluate('(el)=>el.scrollWidth <= el.clientWidth+2')
    return text

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.route('**/*', lambda route: route.continue_()
                   if route.request.url.startswith(ORIGIN) else route.abort())
        for count in (6, 18, 30):
            verify_page(page, count)
            pdf = page.pdf(format='A4', print_background=True,
                           prefer_css_page_size=True)
            pages = len(PdfReader(io.BytesIO(pdf)).pages)
            print(f'CASE {count} synthetic unique lines: rows verified, A4 PDF pages={pages}')
            # A4-one-page requirement is intentionally fail-closed.
            assert pages == 1, f'BLOCKED: {count} synthetic lines span {pages} pages; not A4 single page'
        mobile = browser.new_page(viewport={'width': 390, 'height': 844},
                                  device_scale_factor=1, is_mobile=True,
                                  has_touch=True)
        mobile.route('**/*', lambda route: route.continue_()
                     if route.request.url.startswith(ORIGIN) else route.abort())
        verify_page(mobile, 6)
        mobile_width=mobile.locator('body').evaluate('(el)=>el.scrollWidth')
        assert mobile_width <= 390+3, f'Unexpected mobile horizontal overflow {mobile_width}px'
        print('PASS mobile synthetic document, no horizontal overflow')
        browser.close()
finally:
    server.shutdown()
