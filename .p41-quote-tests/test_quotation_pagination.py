"""Synthetic quotation A4 pagination and unchanged billing browser acceptance.

Only a fresh Playwright context and a loopback HTTP server are used. The server
serves a short allowlist, substitutes synthetic PNG brand fixtures, and never
serves the ERP app, Store, credentials or real enterprise data. No deployment.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import threading
import traceback
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

BASE = 'edf1c1886aac09958caa9e4b304502cca44f6937'
PAGE = '.p41-quote-page'
BODY = '.p41-quote-page-body'
NOTE = '[data-quote-note-fragment]'
ASSETS = {'billing-print.html', 'assets/js/display-sort.js',
          'assets/js/external-billing-invoice.js',
          'assets/css/p40-16cd-mint-quotation-billing.css',
          'assets/js/p41-quote-pagination.js', 'assets/css/p41-quote-pagination.css'}
NEW_ASSETS = {'assets/js/p41-quote-pagination.js', 'assets/css/p41-quote-pagination.css'}


def normalized(text):
    return re.sub(r'\s+', '', str(text))


def extract_layout_pages(pdf_path, page_count):
    """Read painted page text using Poppler's layout-aware Unicode mapping.

    pypdf remains the page-box reader, but its extraction of the CI Chrome/Noto
    PDF maps some Chinese ideographs to different Kangxi radical code points.
    Do not normalize those characters away: require exact source characters
    from an independent PDF text extractor instead.
    """
    result = []
    for number in range(1, page_count + 1):
        output = subprocess.check_output(
            ['pdftotext', '-f', str(number), '-l', str(number), '-layout',
             '-enc', 'UTF-8', str(pdf_path), '-'], timeout=30)
        result.append(output.decode('utf-8'))
    return result


def number(value):
    if value is None or value == '':
        return '—'
    return f'{value:,.2f}'.rstrip('0').rstrip('.') if float(value) % 1 else f'{int(value):,}'


def money(value):
    return '$' + f'{int(value):,}'


def synthetic_png():
    """A deterministic, non-company image large enough for the normal asset gate."""
    width = height = 96
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            pixels.extend(((x * 11 + y * 3) % 211, (x * 5 + y * 13) % 223, (x * 17 + y * 7) % 227))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(pixels))) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')


def enterprise_fixture():
    image = synthetic_png()
    assert len(image) > 1024
    return ("<!doctype html><meta charset='utf-8'><script>\nconst companyLogoAsset='" + image +
            "';\nconst companySealAsset='" + image + "';\n</script>").encode('utf-8')


def long_note():
    titles = ['一、計價與施工範圍', '二、施工安排與交付', '三、驗收及保固說明', '四、現場配合與其他約定']
    sections = []
    for section, title in enumerate(titles, 1):
        paragraphs = []
        for index in range(1, 8):
            paragraphs.append(
                f'SEC{section}-{index:02d} 虛構驗收條款：本段僅供版面測試，施工位置及尺寸依雙方書面確認，'
                f'測試數量 {section * 10 + index}.25、測試單價 {section * 1000 + index * 37} 元均應完整呈現；'
                '材料保護、清潔、進場安排及完工確認應逐項保留，不得省略本段後半文字。')
        sections.append(title + '\n' + '\n'.join(paragraphs))
    return '\n\n'.join(sections) + '\nEND-ALL-FOUR-SECTIONS-93651'


def quote_document(count=11, mode='actual', note='', name='SYNTHETIC-QUOTE'):
    lines = []
    for index in range(count):
        price = 731 + index * 137
        qty = (index % 7 + 1) + (0.25 if index % 2 else 0.5)
        actual = mode == 'actual' or mode == 'mixed' and index % 2 == 0
        lines.append({'item': f'SYN-ROW-{index + 1:03d} 虛構門窗修繕項目', 'house': '', 'unit': '式',
                      'qty': qty, 'price': price, 'amount': int(qty * price),
                      'pricingType': 'actual' if actual else 'lump_sum',
                      'isBackupPrice': actual and index in [2, 7]})
    total = sum(row['amount'] for row in lines)
    tax = round(total * 0.05)
    return {'schema': 'kushe-external-document-v1', 'documentType': 'quotation',
            'title': '報價單', 'fileName': name, 'customer': '虛構建商測試客戶',
            'project': '虛構甲棟門窗修繕工程', 'date': '2026-11-24',
            'pricingMode': mode, 'taxMode': '未稅', 'publicNote': note,
            'lines': lines, 'salesAmount': total, 'taxAmount': tax,
            'totalAmount': total + tax, 'retentionAmount': 0,
            'receivableAmount': total + tax,
            'company': {'name': '虛構工程企業', 'englishName': 'Synthetic Company',
                        'taxId': 'SYNTHETIC', 'address': '虛構測試地址', 'phone': 'SYN-0000'}}


def billing_document(merged=False):
    doc = quote_document(18 if merged else 3, 'lump_sum', 'SYNTHETIC-BILLING-NOTE 請款顯示比較。')
    doc.update(documentType='billing', title='請款單', invoiceStatus='invoice_pending',
               isMergedExternalBilling=merged)
    doc.pop('pricingMode')
    for i, line in enumerate(doc['lines']):
        line.update(house=f'SYN-H-{i + 1:02d}', sourcePricingType='external-document')
    if merged:
        doc['mergedBillingProjects'] = ['虛構甲區', '虛構乙區']
    return doc


def url_for(origin, version, document):
    data = base64.b64encode(json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode()).decode()
    return f'{origin}/{version}/billing-print.html?print=0#' + quote(data, safe='')


class Reporter:
    def __init__(self, output):
        self.output = output
        output.mkdir(parents=True, exist_ok=True)
        self.result = {'status': 'RUNNING', 'baselineCommit': BASE, 'syntheticOnly': True,
                       'tests': [], 'cases': [], 'failure': None, 'externalRequests': [],
                       'productionDataTouched': False, 'deploymentAuthorized': False, 'publishGate': 'BLOCKED'}
        self.flush()

    def flush(self):
        (self.output / 'RESULT.json').write_text(json.dumps(self.result, ensure_ascii=False, indent=2), encoding='utf-8')

    def check(self, name, condition, detail=None):
        row = {'name': name, 'result': 'PASS' if condition else 'FAIL'}
        if detail is not None:
            row['detail'] = detail
        self.result['tests'].append(row)
        self.flush()
        print(f"[{row['result']}] {len(self.result['tests']):03d} {name}", flush=True)
        if not condition:
            raise AssertionError(name + (': ' + json.dumps(detail, ensure_ascii=False)[:2500] if detail is not None else ''))


class FixtureServer:
    def __init__(self, root, output):
        self.root, self.output = root, output
        self.requests = []
        self.unknown = []
        self.baseline = {}
        for path in ASSETS - NEW_ASSETS:
            self.baseline[path] = subprocess.check_output(['git', '-C', str(root), 'show', BASE + ':' + path])
        self.enterprise = enterprise_fixture()
        parent = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = unquote(urlsplit(self.path).path)
                parent.requests.append(path)
                if path.endswith('/favicon.ico'):
                    self.send_response(204); self.end_headers(); return
                if path == '/offline-export.html':
                    file = output / 'KUSHE_QUOTE_PAGINATED_EXPORT.html'
                    if file.is_file():
                        return self.send_data(file.read_bytes(), 'text/html; charset=utf-8')
                parts = path.lstrip('/').split('/', 1)
                if len(parts) != 2 or parts[0] not in ['candidate', 'baseline']:
                    parent.unknown.append(path); self.send_error(404); return
                version, name = parts
                if name == 'enterprise/index.html':
                    return self.send_data(parent.enterprise, 'text/html; charset=utf-8')
                if name not in ASSETS:
                    parent.unknown.append(path); self.send_error(404); return
                try:
                    content = parent.baseline[name] if version == 'baseline' else (root / name).read_bytes()
                except (KeyError, OSError):
                    parent.unknown.append(path); self.send_error(404); return
                mime = 'application/javascript; charset=utf-8' if name.endswith('.js') else 'text/css; charset=utf-8' if name.endswith('.css') else 'text/html; charset=utf-8'
                self.send_data(content, mime)
            def send_data(self, data, media):
                self.send_response(200)
                self.send_header('Content-Type', media)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers(); self.wfile.write(data)
            def log_message(self, *args):
                pass
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = 'http://127.0.0.1:' + str(self.httpd.server_port)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.httpd.shutdown(); self.httpd.server_close()
        (self.output / 'loopback-requests.json').write_text(json.dumps({'requests': self.requests, 'unservedRequests': self.unknown}, indent=2), encoding='utf-8')


WRITE_GUARDS = """() => {
 window.__p41WriteAttempts=[];window.__quoteXss=false;
 for(const name of ['setItem','removeItem','clear']) {
   Storage.prototype[name]=function(){window.__p41WriteAttempts.push('Storage.'+name);throw Error('TEST_STORAGE_WRITE_FORBIDDEN')};
 }
 for(const name of ['open','deleteDatabase']) {
   try{Object.defineProperty(indexedDB,name,{value:()=>{window.__p41WriteAttempts.push('indexedDB.'+name);throw Error('TEST_IDB_FORBIDDEN')}})}catch(_){}
 }
}"""


def fresh_context(browser, server, report, width=1366, allowed_file_urls=(), allow_loopback=True):
    ctx = browser.new_context(viewport={'width': width, 'height': 950}, device_scale_factor=1,
                              locale='zh-TW', timezone_id='Asia/Taipei', reduced_motion='reduce')
    ctx.add_init_script('(' + WRITE_GUARDS + ')()')
    exact_files = set(allowed_file_urls)
    def route(request):
        if request.request.url in exact_files or allow_loopback and request.request.url.startswith(server.origin + '/'):
            request.continue_()
        else:
            report.result['externalRequests'].append(request.request.url)
            request.abort()
    ctx.route('**/*', route)
    return ctx


def ready(page):
    page.wait_for_function('window.__billingPrintReady===true || Boolean(window.__billingPrintError)', timeout=25000)
    info = page.evaluate('() => ({ready:window.__billingPrintReady,error:window.__billingPrintError})')
    assert info['ready'] is True, info
    page.evaluate('async()=>{if(document.fonts)await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')


METRICS = """() => {
 const pages=[...document.querySelectorAll('.p41-quote-page')];
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
 const scale=e=>{let value=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);value*=Number.parseFloat(s.zoom)||1;if(s.transform!=='none'){const m=new DOMMatrix(s.transform);value*=Math.hypot(m.a,m.b)}}return value};
 return {viewport:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,
   windowScale:window.__quotationPrintScale??null,
   pages:pages.map((p,index)=>{const body=p.querySelector('.p41-quote-page-body'),r=p.getBoundingClientRect();
     const children=[...p.querySelectorAll('.head,.info,.detail,.detail td,.note,[data-quote-note-fragment],.summary,.sign')];
     const outside=children.filter(e=>{const x=e.getBoundingClientRect();return x.width>0&&(x.left<r.left-1.5||x.right>r.right+1.5||x.bottom>r.bottom+1.5||x.top<r.top-1.5)}).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),rect:rect(e)}));
     return {index,rect:rect(p),bodyWidth:body?.clientWidth,bodyScrollWidth:body?.scrollWidth,
       bodyHeight:body?.clientHeight,bodyScrollHeight:body?.scrollHeight,outside,
       notes:[...p.querySelectorAll('[data-quote-note-fragment]')].map(e=>({text:e.textContent,fontPt:parseFloat(getComputedStyle(e).fontSize)*72/96,scale:scale(e)})),
       rows:[...p.querySelectorAll('.detail tbody tr:not(.line-total)')].map(e=>({cells:[...e.cells].map(c=>c.innerText),fontPt:Math.min(...[...e.cells].map(c=>parseFloat(getComputedStyle(c).fontSize)*72/96)),scale:scale(e)}))};})};
}"""


def check_layout(report, name, metrics, printing=False):
    report.check(name + ': no document horizontal overflow', metrics['documentWidth'] <= metrics['viewport'] + 1, metrics)
    for item in metrics['pages']:
        key = f"{name}: page {item['index'] + 1}"
        if not printing:
            report.check(key + ' fits viewport', item['rect']['left'] >= -1.5 and item['rect']['right'] <= metrics['viewport'] + 1.5, item['rect'])
        else:
            report.check(key + ' has unscaled A4 dimensions', 792 <= item['rect']['width'] <= 796 and 1121 <= item['rect']['height'] <= 1125, item['rect'])
        report.check(key + ' contains all visible content', not item['outside'], item['outside'])
        report.check(key + ' content does not overflow its body',
                     item['bodyWidth'] is not None and item['bodyScrollWidth'] <= item['bodyWidth'] + 2 and item['bodyScrollHeight'] <= item['bodyHeight'] + 2,
                     {k: item[k] for k in ['bodyWidth','bodyScrollWidth','bodyHeight','bodyScrollHeight']})
        if printing:
            report.check(key + ' keeps readable table type without scaling', all(r['fontPt'] >= 8.5 - 0.01 and 0.99 <= r['scale'] <= 1.01 for r in item['rows']), item['rows'])
            report.check(key + ' keeps readable notes without scaling', all(n['fontPt'] >= 9 - 0.01 and 0.99 <= n['scale'] <= 1.01 for n in item['notes']), [{'fontPt': n['fontPt'], 'scale': n['scale']} for n in item['notes']])


def check_values(report, name, page, document):
    actual = document['pricingMode'] == 'actual' or document['pricingMode'] == 'mixed' and all(x['pricingType'] == 'actual' for x in document['lines'])
    rows = page.locator('#paper .detail tbody tr:not(.line-total)').evaluate_all('(rows)=>rows.map(r=>[...r.cells].map(c=>c.innerText))')
    report.check(name + ': every original row retained exactly once', len(rows) == len(document['lines']), {'expected': len(document['lines']), 'actual': len(rows)})
    expected = []
    for row in document['lines']:
        label = row['item']
        if actual and row.get('isBackupPrice'):
            label += '\n備用單價'
        elif not actual and row.get('pricingType') == 'actual':
            label += '\n實做實算'
        values = [label, row['unit'], number(row['qty']), money(row['price'])]
        if not actual:
            values.append(money(row['amount']))
        expected.append(values)
    report.check(name + ': every item quantity unit price and amount unchanged', rows == expected, {'expected': expected, 'actual': rows})
    notes = page.locator(NOTE).evaluate_all('(nodes)=>nodes.map(n=>n.textContent).join("")')
    report.check(name + ': complete note text retained character for character', notes.replace('\r\n','\n') == document['publicNote'].replace('\r\n','\n'), {'sourceCharacters': len(document['publicNote']), 'renderedCharacters': len(notes)})
    report.check(name + ': source payload remains unchanged', page.evaluate('()=>d') == document)
    report.check(name + ': original logo and seal IDs remain unique', page.locator('#formalCompanyLogo').count() == 1 and page.locator('#formalCompanySeal').count() == 1)
    if actual:
        report.check(name + ': actual quote retains four columns and no financial total', all(len(r) == 4 for r in rows) and page.locator('#paper .summary').count() == 0 and page.locator('#paper .line-total').count() == 0)
    else:
        report.check(name + ': normal or mixed totals appear once with original values', page.locator('#paper .line-total').count() == 1 and page.locator('#paper .summary').count() == 1 and money(document['salesAmount']) in page.locator('#paper .line-total').inner_text() and money(document['totalAmount']) in page.locator('#paper .summary').inner_text())
    report.check(name + ': no storage or IndexedDB writes', page.evaluate('()=>window.__p41WriteAttempts') == [])


def check_pdf(report, name, page, metrics, output, minimum_pages=1, maximum_pages=None):
    pdf = page.pdf(format='A4', print_background=True, prefer_css_page_size=True,
                   margin={'top':'0','bottom':'0','left':'0','right':'0'})
    pdf_path = output / (name + '.pdf')
    pdf_path.write_bytes(pdf)
    reader = PdfReader(BytesIO(pdf))
    count = len(reader.pages)
    report.check(name + ': actual PDF page count matches visible pages', count == len(metrics['pages']) and count >= minimum_pages and (maximum_pages is None or count <= maximum_pages), {'pdfPages':count, 'visiblePages':len(metrics['pages']), 'minimum':minimum_pages, 'maximum':maximum_pages})
    texts = extract_layout_pages(pdf_path, count)
    pypdf_texts = [p.extract_text() or '' for p in reader.pages]
    (output / (name + '-pdf-text.txt')).write_text('\n\f\n'.join(texts), encoding='utf-8')
    (output / (name + '-pypdf-diagnostic-text.txt')).write_text('\n\f\n'.join(pypdf_texts), encoding='utf-8')
    for index, pdf_page in enumerate(reader.pages):
        width, height = float(pdf_page.mediabox.width), float(pdf_page.mediabox.height)
        report.check(f'{name}: PDF page {index + 1} is portrait A4', 594 <= width <= 596 and 841 <= height <= 843, [width,height])
        text = texts[index]
        compact = normalized(text)
        expected = metrics['pages'][index]
        missing_notes = [note['text'][:100] for note in expected['notes'] if normalized(note['text']) and normalized(note['text']) not in compact]
        report.check(f'{name}: PDF page {index + 1} contains its complete note fragments', not missing_notes, missing_notes)
        missing_values = [value for row in expected['rows'] for value in row['cells'] if normalized(value) and normalized(value) not in compact]
        report.check(f'{name}: PDF page {index + 1} contains every displayed row value', not missing_values, missing_values)
    return count


def quote_case(browser, server, report, name, document, minimum_pages=1, maximum_pages=None):
    context = fresh_context(browser, server, report)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url_for(server.origin, 'candidate', document), wait_until='load')
        ready(page)
        report.check(name + ': paginator created pages', page.locator(PAGE).count() > 0)
        check_values(report, name, page, document)
        if document.get('publicNote', '').strip():
            final_note = page.locator(PAGE).last.locator('[data-quote-note-fragment]').all_text_contents()
            report.check(name + ': final signature page retains meaningful note text', bool(''.join(final_note).strip()))
        desktop = page.evaluate(METRICS)
        check_layout(report, name + ' desktop', desktop)
        page.screenshot(path=str(report.output / (name + '-desktop.png')), full_page=True, animations='disabled')
        page.set_viewport_size({'width':390,'height':844})
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        mobile = page.evaluate(METRICS)
        check_layout(report, name + ' mobile', mobile)
        check_values(report, name + ' mobile', page, document)
        page.screenshot(path=str(report.output / (name + '-mobile.png')), full_page=True, animations='disabled')
        page.set_viewport_size({'width':1366,'height':950})
        page.emulate_media(media='print')
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        printing = page.evaluate(METRICS)
        check_layout(report, name + ' print', printing, printing=True)
        count = check_pdf(report, name, page, printing, report.output, minimum_pages, maximum_pages)
        report.check(name + ': literal hostile text cannot execute or create elements', page.evaluate('()=>window.__quoteXss===false') and page.locator('#paper img[data-hostile], #paper script').count() == 0)
        report.check(name + ': no uncaught browser errors', not errors, errors)
        record = {'name':name, 'sourceRows':len(document['lines']), 'sourceNoteCharacters':len(document['publicNote']),
                  'sourceNoteSha256':hashlib.sha256(document['publicNote'].encode()).hexdigest(),
                  'pdfPages':count, 'desktop':desktop, 'mobile':mobile, 'print':printing}
        report.result['cases'].append(record)
        report.flush()
    except Exception:
        try:
            page.screenshot(path=str(report.output / (name + '-FAIL.png')), full_page=True)
            (report.output / (name + '-FAIL-dom.html')).write_text(page.content(), encoding='utf-8')
        except Exception:
            pass
        raise
    finally:
        context.close()


def billing_comparison(browser, server, report, merged=False):
    name = 'billing-merged' if merged else 'billing-single'
    document = billing_document(merged)
    context = fresh_context(browser, server, report)
    before = context.new_page(); after = context.new_page()
    try:
        before.goto(url_for(server.origin,'baseline',document)); after.goto(url_for(server.origin,'candidate',document))
        ready(before); ready(after)
        report.check(name + ': text and rows remain identical to pinned main', before.locator('#paper').inner_text() == after.locator('#paper').inner_text() and before.locator('#paper').inner_html() == after.locator('#paper').inner_html())
        report.check(name + ': quotation paginator does not run on billing', after.locator(PAGE).count() == 0)
        for viewport in [{'width':1366,'height':950},{'width':390,'height':844}]:
            images = []
            for version, page in [('before',before),('after',after)]:
                page.set_viewport_size(viewport)
                page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                images.append(page.screenshot(path=str(report.output / f'{name}-{viewport["width"]}-{version}.png'), full_page=True, animations='disabled'))
            report.check(f'{name}: {viewport["width"]}px screenshot remains byte-identical', images[0] == images[1], {'beforeSha256':hashlib.sha256(images[0]).hexdigest(),'afterSha256':hashlib.sha256(images[1]).hexdigest()})
        pdf_pages = []
        pdf_text = []
        for version, page in [('before',before),('after',after)]:
            page.set_viewport_size({'width':1366,'height':950}); page.emulate_media(media='print')
            pdf = page.pdf(format='A4',print_background=True,prefer_css_page_size=True)
            path = report.output / f'{name}-{version}.pdf'
            path.write_bytes(pdf)
            reader = PdfReader(BytesIO(pdf))
            extracted = extract_layout_pages(path,len(reader.pages))
            (report.output / f'{name}-{version}-pdf-text.txt').write_text('\n\f\n'.join(extracted),encoding='utf-8')
            pdf_pages.append(len(reader.pages)); pdf_text.append(extracted)
        report.check(name + ': PDF pages and complete extracted text unchanged', pdf_pages[0] == pdf_pages[1] and pdf_text[0] == pdf_text[1], {'pdfPageCounts':pdf_pages})
        report.check(name + ': original billing payload unchanged', after.evaluate('()=>d') == document and after.evaluate('()=>window.__p41WriteAttempts') == [])
    finally:
        context.close()


def offline_import(browser, server, report, root):
    builder = root / '.p41-quote-tests/build_offline_quote.py'
    target = report.output / 'KUSHE_QUOTE_PAGINATED_EXPORT.html'
    assert builder.is_file(), 'Offline utility builder missing'
    subprocess.run([sys.executable,str(builder),'--root',str(root),'--output',str(target),'--synthetic-assets'],check=True)
    rendered = report.output / 'OFFLINE_SYNTHETIC_RENDERED.html'
    context = fresh_context(browser,server,report,allowed_file_urls=(target.as_uri(),rendered.as_uri()),allow_loopback=False)
    page = context.new_page()
    requests, errors = [], []
    page.on('request',lambda request: requests.append(request.url))
    page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        hostile_tail = '\n</script><script>window.__quoteXss=true</script>\n<img data-hostile="yes" src=x onerror="window.__quoteXss=true">\nSYN-OFFLINE-LITERAL-72361'
        document = quote_document(11,'actual',long_note()+hostile_tail,'SYNTHETIC-OFFLINE-IMPORT')
        request_count = len(server.requests)
        page.goto(target.as_uri())
        page.locator('#quotationUrl').fill(url_for(server.origin,'candidate',document))
        page.locator('#renderQuotation').click()
        frame = page.locator('#quotationPreview').element_handle().content_frame()
        assert frame is not None, 'Offline preview iframe missing'
        ready(frame)
        report.check('offline importer: actual local file origin is exercised', page.url == target.as_uri())
        report.check('offline importer: long quote paginates', frame.locator(PAGE).count() >= 2)
        check_values(report,'offline importer',frame,document)
        report.check('offline importer: script terminators and hostile markup remain plain text', frame.evaluate('()=>window.__quoteXss===false') and frame.locator('#paper img[data-hostile], #paper script').count() == 0 and page.evaluate('()=>window.__quoteXss===false'))
        report.check('offline importer: all renderer resources are inlined', not server.requests[request_count:] and all(url == target.as_uri() or url.startswith(('data:','about:')) for url in requests),requests)
        report.check('offline importer: no external requests or parent storage writes', not report.result['externalRequests'] and page.evaluate('()=>window.__p41WriteAttempts') == [])
        page.screenshot(path=str(report.output/'offline-import-desktop.png'),full_page=True,animations='disabled')
        # Print the exact generated iframe document as its own file. Printing the
        # wrapper would exercise iframe clipping instead of its own print button.
        inner_html = page.locator('#quotationPreview').get_attribute('srcdoc')
        assert inner_html, 'Generated offline renderer document missing'
        rendered.write_text(inner_html,encoding='utf-8')
        printable = context.new_page()
        printable.on('pageerror',lambda error: errors.append(str(error)))
        printable.goto(rendered.as_uri())
        ready(printable)
        check_values(report,'offline printable file',printable,document)
        printable.emulate_media(media='print')
        printable.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        metrics = printable.evaluate(METRICS)
        check_layout(report,'offline printable file',metrics,printing=True)
        count = check_pdf(report,'offline-file-long11',printable,metrics,report.output,minimum_pages=2)
        report.check('offline importer and printable file: no browser errors or network access', not errors and not report.result['externalRequests'] and not server.requests[request_count:], {'errors':errors,'external':report.result['externalRequests']})
        report.result['cases'].append({'name':'offline-file-import','sourceRows':len(document['lines']),
                                      'sourceNoteCharacters':len(document['publicNote']),
                                      'pdfPages':count,'originType':'file','print':metrics})
        report.flush()
    finally:
        context.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root',type=Path,default=Path('.'))
    ap.add_argument('--output',type=Path,default=Path('artifacts/p41-quote-pagination'))
    args = ap.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    report = Reporter(output)
    try:
        report.result['candidateCommit'] = subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
        with FixtureServer(root,output) as server, sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True,channel='chrome') if os.environ.get('P41_USE_SYSTEM_CHROME') == '1' else pw.chromium.launch(headless=True)
            try:
                quote_case(browser,server,report,'actual-long11',quote_document(11,'actual',long_note()),minimum_pages=2)
                quote_case(browser,server,report,'actual-short',quote_document(3,'actual','SYN-SHORT-001 虛構短備註，原文保留。'),maximum_pages=1)
                quote_case(browser,server,report,'normal-long40',quote_document(40,'lump_sum','SYN-NORMAL-NOTE-84517 虛構一般報價內容保留。'),minimum_pages=2)
                quote_case(browser,server,report,'mixed-long38',quote_document(38,'mixed','SYN-MIXED-NOTE-57319 虛構混合報價內容保留。'),minimum_pages=2)
                all_actual = quote_document(3,'actual','SYN-MIXED-ALL-ACTUAL-54913'); all_actual['pricingMode']='mixed'
                quote_case(browser,server,report,'mixed-all-actual',all_actual,maximum_pages=1)
                hostile = '<img data-hostile="yes" src=x onerror="window.__quoteXss=true">\n<script>window.__quoteXss=true</script>\n& < > " \' SYN-LITERAL-39157\n  保留前後空白  \n末行'
                quote_case(browser,server,report,'hostile-note',quote_document(3,'actual',hostile),maximum_pages=1)
                quote_case(browser,server,report,'oversized-paragraph-tail',quote_document(3,'actual',('SYN-LONG-TERM 原文保留，單一長段落按實際版面接續。' * 120) + '\n\n'),minimum_pages=2)
                billing_comparison(browser,server,report,merged=False)
                billing_comparison(browser,server,report,merged=True)
                offline_import(browser,server,report,root)
                report.check('all fixtures: no external browser requests',not report.result['externalRequests'],report.result['externalRequests'])
                report.check('all fixtures: no unexpected local assets requested',not server.unknown,server.unknown)
            finally:
                browser.close()
        report.result['status']='QUOTATION_A4_PAGINATION_AND_BILLING_NONREGRESSION_VERIFIED'
        print('P41_QUOTATION_PAGINATION_VERIFIED__PUBLISH_BLOCKED',flush=True)
    except Exception as error:
        report.result['status']='BLOCKED'
        report.result['failure']={'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()}
        raise
    finally:
        report.flush()


if __name__ == '__main__':
    main()
