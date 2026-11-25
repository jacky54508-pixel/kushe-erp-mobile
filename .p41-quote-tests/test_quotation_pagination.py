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
import time
import traceback
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from playwright.sync_api import Error as PlaywrightError, sync_playwright
from pypdf import PdfReader

BASE = '49edb30257707a786329d19207b92fec951d3906'
PAGE = '.p41-quote-page'
BODY = '.p41-quote-page-body'
NOTE = '[data-quote-note-fragment]'
ASSETS = {'billing-print.html', 'assets/js/display-sort.js',
          'assets/js/external-billing-invoice.js',
          'assets/css/p40-16cd-mint-quotation-billing.css',
          'assets/js/p41-quote-pagination.js', 'assets/css/p41-quote-pagination.css'}
BOLD = re.compile(r'(?<!\*)\*\*([^*\r\n]+)\*\*(?!\*)')


def normalized(text):
    return re.sub(r'\s+', '', str(text))


def bold_matches(text):
    """Independent display grammar; unmatched or cross-line markers stay literal."""
    def escaped(index):
        count = 0
        while index > 0 and text[index - 1] == '\\':
            count += 1
            index -= 1
        return count % 2 == 1
    return [match for match in BOLD.finditer(text)
            if match.group(1) == match.group(1).strip() and match.group(1).strip()
            and not escaped(match.start()) and not escaped(match.end() - 2)]


def source_utf16(text):
    return text.encode('utf-16-le')


def source_visible_span(text, start, end):
    """Apply only original, valid marker offsets, even across page splits."""
    raw = source_utf16(text)
    hidden = set()
    for match in bold_matches(text):
        for offset in (match.start(), match.end() - 2):
            unit = len(source_utf16(text[:offset])) // 2
            hidden.update((unit, unit + 1))
    return b''.join(raw[index * 2:index * 2 + 2] for index in range(start, end)
                    if index not in hidden).decode('utf-16-le')


def extract_pdf_pages(pdf_path, page_count, mode='layout'):
    """Read painted page text with Poppler and preserve its exact Unicode.

    pypdf remains the page-box reader, but its extraction of the CI Chrome/Noto
    PDF maps some Chinese ideographs to different Kangxi radical code points.
    Do not normalize those characters away: require exact source characters
    from an independent PDF text extractor instead.
    """
    assert mode in ('layout', 'raw')
    result = []
    for number in range(1, page_count + 1):
        output = subprocess.check_output(
            ['pdftotext', '-f', str(number), '-l', str(number), '-' + mode,
             '-enc', 'UTF-8', str(pdf_path), '-'], timeout=30)
        result.append(output.decode('utf-8'))
    return result


def extract_layout_pages(pdf_path, page_count):
    return extract_pdf_pages(pdf_path, page_count, 'layout')


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


CONTRACT_HEADINGS = [
    '一、虛構計價說明', '二、虛構資料核對方式', '三、虛構進場安排',
    '四、虛構完工確認原則', '五、虛構異動處理流程', '六、虛構文件留存方式',
    '七、虛構聯絡確認事項',
]
CONTRACT_SCOPE = 'SYN-SCOPE 本測試範圍為虛構甲棟門窗樣品及模擬安裝區域，數量依測試表列項目，僅供版面驗收。'
CONTRACT_EXCLUSION = '測試不含虛構區外項目'
CONTRACT_SUPPLEMENTS = ['特殊品項依虛構規格另議', '非人為測試因素保固2年']


def contract_note():
    """New fictional wording; only structural paragraph counts resemble the reference."""
    paragraphs = [
        [
            'C1A 本文件為合約版面驗收用虛構案例，所有項目與條件僅供顯示測試，不代表真實工程。',
            'C1B 測試資料依**原始欄位內容**完整顯示。',
            'C1C 每筆單價與數量皆應保留，不任意合併。',
            'C1D 本段末尾檢查碼為**SYN-731**。',
        ],
        ['C2A 虛構雙方於測試前核對項目名稱、單位與數量，若畫面換頁，仍須保留全部文字與符號；本段所有描述僅用於測量行高及段落間距，不建立任何付款義務。'],
        ['C3A 虛構進場日期由測試人員填入示例資料，場地、材料與人員均為合成設定。所有安排皆只用來檢查頁面閱讀順序，並以書面樣例逐項呈現，確保後半段內容不因排版而遺漏。'],
        [
            'C4A 虛構完工確認依測試清單逐項核對，若文字超過一行應自然接續，保持原來順序及標點，不得縮成難以閱讀的小字。',
            'C4B 測試照片與附件僅作欄位說明，本案例沒有真實照片、住址、電話或任何客戶紀錄。',
        ],
        [
            'C5A 虛構異動必須保留原始名稱及測試註記，增加說明時應以獨立段落展示。這段文字刻意較長，用來驗證頁面能夠合理分配空間，同時完整呈現句首、句中與句尾；不應刪減說明、不應改寫數字，也不應將後段內容藏在頁面邊界之外。',
            'C5B **SYN-8462** 為虛構追蹤碼，僅供確認粗體標記的顯示效果；未加標記的文字仍依原文保留。',
        ],
        [
            'C6A 虛構文件以本頁列印成果作為顯示樣本，每次檢查皆使用全新測試環境，不讀取實際業務資料。',
            'C6B 同一條文字若跨頁，前後段必須完整連接；頁首及頁尾標示不能取代任何原始文字。',
            'C6C 測試紀錄只保留合成內容及驗收畫面，資料不寫回任何正式資料庫。',
            'C6D 此為虛構紀錄末行。',
        ],
        ['C7A 虛構聯絡資訊僅用來展示簽章與日期欄位，閱讀本頁不會送出表單或訊息。所有測試敘述至此完整結束，末尾識別碼為 SYN-END-59327。'],
    ]
    sections = ['\n'.join([heading] + body) for heading, body in zip(CONTRACT_HEADINGS, paragraphs)]
    return '\n'.join([CONTRACT_SCOPE, CONTRACT_EXCLUSION, '', '**工程請款及付款約定條款**', ''] +
                     ['\n\n'.join(sections), '', *CONTRACT_SUPPLEMENTS])


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
            'project': '虛構甲棟門窗修繕工程', 'date': '2026-11-25',
            'pricingMode': mode, 'taxMode': '未稅', 'publicNote': note,
            'lines': lines, 'salesAmount': total, 'taxAmount': tax,
            'totalAmount': total + tax, 'retentionAmount': 0,
            'receivableAmount': total + tax,
            'company': {'name': '虛構工程企業', 'englishName': 'Synthetic Company',
                        'taxId': 'SYNTHETIC', 'address': '虛構測試地址', 'phone': 'SYN-0000'}}


def spacing_document(constrained=False):
    """Reproduce the label/spacing boundary using newly written synthetic text."""
    scope = ('本範圍為虛構甲棟測試門窗與模擬施工區域，全部名稱和條件均為合成資料，僅供報價版面驗收使用。'
             '請保留原始項目、完整數量、單位及單價，範圍說明需自然換行，並將末尾補充與付款條款合理接續，不得留下只有兩行文字的獨立續頁。')
    scope = (scope + '虛構測試範圍內容保留。')[:110]
    assert len(scope) == 110
    if constrained:
        scope += ('虛構延伸範圍僅用於頁面邊界驗收，全部句子須完整保留，後續付款條款應接續本頁可用空間。' * 16)
    note = contract_note().replace(CONTRACT_SCOPE, scope, 1)
    doc = quote_document(11, 'actual', note, 'SYNTHETIC-CONSTRAINED-SCOPE' if constrained else 'SYNTHETIC-ALL-BACKUP11')
    for row in doc['lines']:
        row['isBackupPrice'] = True
    if constrained:
        doc['company'].update(name='虛構邊界測試工程企業股份有限公司',
                              englishName='Synthetic Boundary Layout Verification Company',
                              address='虛構測試地址，僅為字型及頁面寬度驗收資料；不代表任何真實公司、客戶、工程地點或聯絡資料。')
        doc['customer'] = '虛構版面邊界測試客戶暨合成資料確認單位'
        doc['project'] = '虛構甲棟門窗及附屬測試區域之完整工程名稱與範圍識別'
    return doc


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
                       'tests': [], 'cases': [], 'caseOutcomes': [], 'caseFailures': [],
                       'failure': None, 'externalRequests': [],
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


def independent_case(report, name, operation):
    """Keep every strict assertion; collect independent fresh-context failures.

    Each operation closes its own context in finally. A failing operation stops
    immediately, while another independent synthetic document can still produce
    useful evidence. Any failure makes the overall run fail with a nonzero exit.
    """
    first_assertion = len(report.result['tests']) + 1
    outcome = {'name': name, 'status': 'VERIFIED'}
    try:
        operation()
    except Exception as error:
        failure = {'case': name, 'type': type(error).__name__, 'message': str(error),
                   'traceback': traceback.format_exc()}
        outcome['status'] = 'FAILED'
        report.result['caseFailures'].append(failure)
        if report.result['failure'] is None:
            report.result['failure'] = failure
        report.result['status'] = 'BLOCKED'
        print('[CASE FAILED] ' + name + ': ' + str(error), flush=True)
    else:
        print('[CASE VERIFIED] ' + name, flush=True)
    finally:
        outcome['firstAssertion'] = first_assertion
        outcome['assertionsRecorded'] = len(report.result['tests']) - first_assertion + 1
        report.result['caseOutcomes'].append(outcome)
        report.flush()


class FixtureServer:
    def __init__(self, root, output):
        self.root, self.output = root, output
        self.requests = []
        self.unknown = []
        self.baseline = {}
        # Released main already includes both paginator assets. Billing must
        # load that exact baseline CSS/JS before the unchanged-image comparison.
        for path in ASSETS:
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
    # Observe readiness through DevTools directly. wait_for_function evaluates
    # its polling expression inside the page and conflicts with the offline
    # document's intentional CSP restriction on unsafe-eval.
    deadline = time.monotonic() + 25
    info = {'ready': False, 'error': None}
    while time.monotonic() < deadline:
        try:
            info = page.evaluate('() => ({ready:window.__billingPrintReady===true,error:window.__billingPrintError || null})')
        except PlaywrightError as error:
            if 'Execution context was destroyed' not in str(error):
                raise
            # A newly assigned srcdoc may still be replacing about:blank.
            time.sleep(0.05)
            continue
        if info['ready'] or info['error']:
            break
        time.sleep(0.05)
    assert info['ready'] is True, info
    page.evaluate('async()=>{if(document.fonts)await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')


METRICS = """() => {
 const pages=[...document.querySelectorAll('.p41-quote-page')];
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
 const scale=e=>{let value=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement){const s=getComputedStyle(n);value*=Number.parseFloat(s.zoom)||1;if(s.transform!=='none'){const m=new DOMMatrix(s.transform);value*=Math.hypot(m.a,m.b)}}return value};
 return {viewport:document.documentElement.clientWidth,documentWidth:document.documentElement.scrollWidth,
   preview:document.querySelector('.p41-quote-preview')?rect(document.querySelector('.p41-quote-preview')):null,
   windowScale:window.__quotationPrintScale??null,
   pages:pages.map((p,index)=>{const body=p.querySelector('.p41-quote-page-body'),r=p.getBoundingClientRect();
     const children=[...p.querySelectorAll('.head,.info,.detail,.detail td,.note,[data-quote-note-fragment],.summary,.sign,.p41-quote-scope,.p41-quote-terms,.p41-quote-contract-title,.p41-quote-clause-heading,.p41-quote-sign-date')];
     const outside=children.filter(e=>{const x=e.getBoundingClientRect();return x.width>0&&(x.left<r.left-1.5||x.right>r.right+1.5||x.bottom>r.bottom+1.5||x.top<r.top-1.5)}).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),rect:rect(e)}));
     return {index,rect:rect(p),bodyWidth:body?.clientWidth,bodyScrollWidth:body?.scrollWidth,
       bodyHeight:body?.clientHeight,bodyScrollHeight:body?.scrollHeight,outside,
       notes:[...p.querySelectorAll('[data-quote-note-fragment]')].map(e=>({text:e.textContent,fontPt:Math.min(...[e,...e.querySelectorAll('*')].map(n=>parseFloat(getComputedStyle(n).fontSize)*72/96)),scale:scale(e)})),
       tableHeaderFontPts:[...p.querySelectorAll('.detail th')].map(e=>parseFloat(getComputedStyle(e).fontSize)*72/96),
       rows:[...p.querySelectorAll('.detail tbody tr:not(.line-total)')].map(e=>({cells:[...e.cells].map(c=>c.innerText),fontPt:Math.min(...[...e.cells].map(c=>parseFloat(getComputedStyle(c).fontSize)*72/96)),scale:scale(e)}))};})};
}"""


def check_layout(report, name, metrics, printing=False):
    report.check(name + ': no document horizontal overflow', metrics['documentWidth'] <= metrics['viewport'] + 1, metrics)
    if not printing:
        report.check(name + ': sized preview wrapper exists', metrics['preview'] is not None)
    for item in metrics['pages']:
        key = f"{name}: page {item['index'] + 1}"
        if not printing:
            report.check(key + ' fits viewport', item['rect']['left'] >= -1.5 and item['rect']['right'] <= metrics['viewport'] + 1.5, item['rect'])
            wrapper, rect = metrics['preview'], item['rect']
            report.check(key + ' stays completely inside preview wrapper',
                         rect['left'] >= wrapper['left'] - 1.5 and rect['right'] <= wrapper['right'] + 1.5 and
                         rect['top'] >= wrapper['top'] - 1.5 and rect['bottom'] <= wrapper['bottom'] + 1.5,
                         {'page': rect, 'wrapper': wrapper})
        else:
            report.check(key + ' has unscaled A4 dimensions', 792 <= item['rect']['width'] <= 796 and 1121 <= item['rect']['height'] <= 1125, item['rect'])
        report.check(key + ' contains all visible content', not item['outside'], item['outside'])
        report.check(key + ' content does not overflow its body',
                     item['bodyWidth'] is not None and item['bodyScrollWidth'] <= item['bodyWidth'] + 2 and item['bodyScrollHeight'] <= item['bodyHeight'] + 2,
                     {k: item[k] for k in ['bodyWidth','bodyScrollWidth','bodyHeight','bodyScrollHeight']})
        if printing:
            report.check(key + ' keeps 10.5pt table text without scaling', all(r['fontPt'] >= 10.5 - 0.01 and 0.99 <= r['scale'] <= 1.01 for r in item['rows']), item['rows'])
            report.check(key + ' keeps 10pt table headings', all(size >= 10 - 0.01 for size in item['tableHeaderFontPts']), item['tableHeaderFontPts'])
            report.check(key + ' keeps 10.5pt notes without scaling', all(n['fontPt'] >= 10.5 - 0.01 and 0.99 <= n['scale'] <= 1.01 for n in item['notes']), [{'fontPt': n['fontPt'], 'scale': n['scale']} for n in item['notes']])


def check_source_notes(report, name, page, source):
    facts = page.evaluate("""() => {
      const paper=document.querySelector('#paper');
      const fragments=[...paper.querySelectorAll('[data-quote-note-fragment]')];
      return {records:typeof window.KusheQuotePagination?.getSourceNotes==='function'
        ?window.KusheQuotePagination.getSourceNotes(paper):null,
        fragments:fragments.map(e=>({start:Number(e.dataset.quoteSourceStart),end:Number(e.dataset.quoteSourceEnd),
          role:e.dataset.quoteNoteRole,text:e.textContent,
          inlineBold:[...e.querySelectorAll('strong:not(.p41-quote-clause-heading):not(.p41-quote-contract-title)')].map(n=>n.textContent)}))};
    }""")
    records, fragments = facts['records'], facts['fragments']
    (report.output / (re.sub(r'[^A-Za-z0-9_-]', '-', name) + '-source-notes.json')).write_text(
        json.dumps({'source': source, 'sourceSha256': hashlib.sha256(source.encode()).hexdigest(), **facts},
                   ensure_ascii=False, indent=2), encoding='utf-8')
    report.check(name + ': source-offset evidence is available for every visible note fragment',
                 isinstance(records, list) and len(records) == len(fragments),
                 {'sourceRecords': None if records is None else len(records), 'visibleFragments': len(fragments)})
    raw = source_utf16(source)
    ordered = sorted(records, key=lambda item: item['start'])
    cursor = 0
    source_errors = []
    for record in ordered:
        start, end = record['start'], record['end']
        if type(start) is not int or type(end) is not int or start != cursor or end <= start or end * 2 > len(raw):
            source_errors.append({'start': start, 'end': end, 'expectedStart': cursor})
            continue
        expected_raw = raw[start * 2:end * 2].decode('utf-16-le')
        if record['rawText'] != expected_raw:
            source_errors.append({'start': start, 'end': end, 'rawMismatch': True})
        cursor = end
    report.check(name + ': raw source offsets cover original note exactly once without gaps or overlaps',
                 not source_errors and cursor * 2 == len(raw) and ''.join(r['rawText'] for r in ordered) == source,
                 {'sourceUtf16Units': len(raw) // 2, 'coveredUtf16Units': cursor, 'errors': source_errors})
    display_errors = []
    for record, fragment in zip(records, fragments):
        expected_visible = source_visible_span(source, record['start'], record['end'])
        if ((record['start'], record['end'], record['role']) != (fragment['start'], fragment['end'], fragment['role'])
                or record['visibleText'] != fragment['text'] or fragment['text'] != expected_visible):
            display_errors.append({'start': record['start'], 'end': record['end'], 'expected': expected_visible,
                                   'apiText': record['visibleText'], 'domText': fragment['text']})
    report.check(name + ': visible notes change only recognized bold delimiters and preserve CRLF and emoji',
                 not display_errors, display_errors)
    fragment_order = sorted(zip(records, fragments), key=lambda pair: pair[0]['start'])
    bold_text = ''.join(text for _, fragment in fragment_order for text in fragment['inlineBold'])
    expected_bold = ''.join(match.group(1) for match in bold_matches(source))
    report.check(name + ': every valid bold run is rendered as strong text without inventing markup',
                 bold_text == expected_bold, {'expectedBold': expected_bold, 'renderedBold': bold_text})
    if not bold_matches(source) and [r['start'] for r in records] == [r['start'] for r in ordered]:
        report.check(name + ': plain-note direct text remains byte-for-byte unchanged',
                     ''.join(fragment['text'] for fragment in fragments) == source)
    return facts


def check_contract_structure(report, name, page, expected_contract=False):
    facts = page.evaluate("""() => {
      const pages=[...document.querySelectorAll('.p41-quote-page')];
      const number=e=>pages.indexOf(e.closest('.p41-quote-page'));
      const locate=selector=>[...document.querySelectorAll(selector)].map(e=>({text:e.textContent.trim(),page:number(e)}));
      return {pages:pages.length,titles:locate('.p41-quote-contract-title'),headings:locate('.p41-quote-clause-heading'),
        termsPages:document.querySelectorAll('.p41-quote-terms-page').length,
        signatures:locate('#paper .sign'),dates:[...document.querySelectorAll('.p41-quote-sign-date')].map(e=>({text:e.textContent.trim(),page:number(e),
          party:e.closest('.client-sign')?'client':e.closest('.company-seals')?'company':null})),
        notes:[...document.querySelectorAll('[data-quote-note-fragment]')].map(e=>({text:e.textContent,page:number(e),
          scope:Boolean(e.closest('.p41-quote-scope')),terms:Boolean(e.closest('.p41-quote-terms'))}))};
    }""")
    if not expected_contract:
        report.check(name + ': unknown headings remain generic notes without a contract section',
                     not facts['titles'] and facts['termsPages'] == 0, facts)
        return
    report.check(name + ': recognized seven-clause quotation has exactly two visible pages', facts['pages'] == 2, facts['pages'])
    report.check(name + ': contract title is separate and appears once on page two',
                 facts['titles'] == [{'text': '工程請款及付款約定條款', 'page': 1}] and facts['termsPages'] == 1, facts['titles'])
    report.check(name + ': all seven original clause headings are separate and in order on page two',
                 facts['headings'] == [{'text': text, 'page': 1} for text in CONTRACT_HEADINGS], facts['headings'])
    for text in [CONTRACT_SCOPE, CONTRACT_EXCLUSION, *CONTRACT_SUPPLEMENTS]:
        locations = [fragment for fragment in facts['notes'] if text in fragment['text']]
        report.check(name + ': scope or trailing callout stays separate on page one: ' + text[:22],
                     len(locations) == 1 and locations[0]['page'] == 0 and locations[0]['scope'] and not locations[0]['terms'], locations)
    report.check(name + ': original signature region and one date per party stay on the last page',
                 len(facts['signatures']) == 1 and facts['signatures'][0]['page'] == 1 and
                 len(facts['dates']) == 2 and all(item['page'] == 1 and item['text'] for item in facts['dates']) and
                 {item['party'] for item in facts['dates']} == {'client', 'company'},
                 {'signatures': facts['signatures'], 'dates': facts['dates']})


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
    check_source_notes(report, name, page, document['publicNote'])
    report.check(name + ': source payload remains unchanged', page.evaluate('()=>d') == document)
    detail_labels = page.locator('#paper .p41-quote-section-label').all_text_contents()
    scope_labels = page.locator('#paper .p41-quote-scope .p41-quote-notes-heading').all_text_contents()
    report.check(name + ': generated section headings are unnumbered and original clause numbers stay separate',
                 bool(detail_labels) and all(label.strip().removesuffix('（續）') == '施工明細' for label in detail_labels) and
                 all(label.strip().removesuffix('（續）') == '施工範圍與補充說明' for label in scope_labels),
                 {'detail': detail_labels, 'scope': scope_labels})
    report.check(name + ': original logo and seal IDs remain unique', page.locator('#formalCompanyLogo').count() == 1 and page.locator('#formalCompanySeal').count() == 1)
    logo = page.evaluate("""() => {
      const image=document.querySelector('#formalCompanyLogo'),frame=image.closest('.company-logo-frame');
      const r=image.getBoundingClientRect(),f=frame.getBoundingClientRect();
      return {loaded:image.complete&&image.naturalWidth>0&&image.naturalHeight>0,
        objectFit:getComputedStyle(image).objectFit,width:r.width,height:r.height,
        inside:r.left>=f.left-.5&&r.top>=f.top-.5&&r.right<=f.right+.5&&r.bottom<=f.bottom+.5};
    }""")
    report.check(name + ': original logo is loaded at positive size and contained without clipping',
                 logo['loaded'] and logo['objectFit'] == 'contain' and logo['width'] > 0 and logo['height'] > 0 and logo['inside'], logo)
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
    raw_texts = extract_pdf_pages(pdf_path, count, 'raw')
    pypdf_texts = [p.extract_text() or '' for p in reader.pages]
    (output / (name + '-pdf-text.txt')).write_text('\n\f\n'.join(texts), encoding='utf-8')
    (output / (name + '-pdf-raw-text.txt')).write_text('\n\f\n'.join(raw_texts), encoding='utf-8')
    (output / (name + '-pypdf-diagnostic-text.txt')).write_text('\n\f\n'.join(pypdf_texts), encoding='utf-8')
    for index, pdf_page in enumerate(reader.pages):
        width, height = float(pdf_page.mediabox.width), float(pdf_page.mediabox.height)
        report.check(f'{name}: PDF page {index + 1} is portrait A4', 594 <= width <= 596 and 841 <= height <= 843, [width,height])
        text = texts[index]
        compact = normalized(text)
        expected = metrics['pages'][index]
        missing_notes = [note['text'][:100] for note in expected['notes'] if normalized(note['text']) and normalized(note['text']) not in compact]
        report.check(f'{name}: PDF page {index + 1} contains its complete note fragments', not missing_notes, missing_notes)
        # Content-stream order keeps a multiline table cell together. Layout
        # order can interleave adjacent numeric cells between a label and its
        # second-line pricing badge. Require every complete, unchanged cell on
        # this same PDF page; use layout order above for complete note paragraphs.
        raw_compact = normalized(raw_texts[index])
        missing_values = [value for row in expected['rows'] for value in row['cells'] if normalized(value) and normalized(value) not in raw_compact]
        report.check(f'{name}: PDF page {index + 1} contains every displayed row value', not missing_values, missing_values)
    return count


def capture_failure_artifacts(page, report, name):
    """Keep a reviewable screen, DOM and PDF even when readiness/structure fails."""
    failures = []
    actions = [
        ('screenshot', lambda: page.screenshot(path=str(report.output / (name + '-FAIL.png')), full_page=True)),
        ('DOM', lambda: (report.output / (name + '-FAIL-dom.html')).write_text(page.content(), encoding='utf-8')),
        ('PDF', lambda: page.pdf(path=str(report.output / (name + '-FAIL.pdf')), format='A4',
                                print_background=True, prefer_css_page_size=True,
                                margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})),
    ]
    for kind, action in actions:
        try:
            action()
        except Exception as error:
            failures.append({'artifact': kind, 'error': str(error)})
    if failures:
        (report.output / (name + '-capture-errors.json')).write_text(json.dumps(failures, indent=2), encoding='utf-8')


def contract_page_flow(page):
    return page.evaluate("""() => [...document.querySelectorAll('.p41-quote-page')].map((p,index)=>{
      const frame=p.querySelector('.p41-quote-page-body'),flow=p.querySelector('.p41-quote-page-flow');
      const fragments=[...p.querySelectorAll('[data-quote-note-fragment]')];
      const chars=role=>fragments.filter(e=>role.includes(e.dataset.quoteNoteRole)).reduce((n,e)=>n+e.textContent.replace(/\\s/g,'').length,0);
      return {page:index+1,rows:p.querySelectorAll('.detail tbody tr:not(.line-total)').length,
        scopeCharacters:chars(['scope','supplement']),termsCharacters:chars(['terms']),
        hasScopeBox:Boolean(p.querySelector('.p41-quote-scope')),hasTermsBox:Boolean(p.querySelector('.p41-quote-terms')),
        termsPage:p.classList.contains('p41-quote-terms-page'),roles:[...new Set(fragments.map(e=>e.dataset.quoteNoteRole))],
        contentHeight:flow.scrollHeight,bodyHeight:frame.clientHeight,remainingHeight:frame.clientHeight-flow.scrollHeight};
    })""")


def check_contract_packing(report, name, page, require_shared=False, exact_two=False):
    flow = contract_page_flow(page)
    (report.output / (name + '-page-flow.json')).write_text(json.dumps(flow, indent=2), encoding='utf-8')
    report.check(name + ': all eleven rows retain backup-price labels',
                 page.locator('#paper .detail tbody tr:not(.line-total)').count() == 11 and page.locator('#paper .detail .actual-note').count() == 11)
    if exact_two:
        report.check(name + ': eleven backup-price rows and wrapped scope use exactly two pages', len(flow) == 2, flow)
    orphan = [item for item in flow[:-1] if item['page'] > 1 and item['scopeCharacters'] > 0 and
              item['termsCharacters'] == 0 and item['rows'] == 0]
    report.check(name + ': no intermediate page contains only scope or supplements before the terms', not orphan, orphan)
    if require_shared:
        shared = [item for item in flow if item['hasScopeBox'] and item['hasTermsBox'] and
                  item['scopeCharacters'] > 0 and item['termsCharacters'] > 0 and item['termsPage']]
        report.check(name + ': constrained scope continuation shares a page with substantive terms', bool(shared), flow)
    headings = [value.strip() for value in page.locator('.p41-quote-clause-heading').all_text_contents()]
    report.check(name + ': all seven original numbered clause headings remain unchanged', headings == CONTRACT_HEADINGS, headings)
    report.check(name + ': original signature and both date fields remain on the final page',
                 page.locator(PAGE).last.locator('.sign').count() == 1 and
                 page.locator('.sign').count() == 1 and page.locator(PAGE).last.locator('.p41-quote-sign-date').count() == 2)
    return flow


def baseline_spacing_reproduction(browser, server, report, constrained=True):
    name = 'baseline-constrained-scope' if constrained else 'baseline-all-backup11'
    document = spacing_document(constrained)
    context = fresh_context(browser, server, report)
    page = context.new_page()
    try:
        page.goto(url_for(server.origin, 'baseline', document), wait_until='load')
        ready(page)
        flow = contract_page_flow(page)
        isolated = [item for item in flow[:-1] if item['page'] > 1 and item['scopeCharacters'] > 0 and
                    item['termsCharacters'] == 0 and item['rows'] == 0]
        record = {'baselineCommit': BASE, 'fixture': document, 'pages': flow,
                  'scopeOnlyIntermediatePages': isolated, 'layoutRegressionObserved': bool(isolated)}
        report.result.setdefault('baselineReproductions', []).append(record)
        (report.output / (name + '.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        page.screenshot(path=str(report.output / (name + '.png')), full_page=True)
        page.pdf(path=str(report.output / (name + '.pdf')), format='A4', print_background=True, prefer_css_page_size=True)
        if constrained:
            report.check(name + ': released baseline reproduces the isolated scope continuation', bool(isolated), flow)
        report.flush()
        return record
    except Exception:
        capture_failure_artifacts(page, report, name)
        raise
    finally:
        context.close()


def quote_case(browser, server, report, name, document, minimum_pages=1, maximum_pages=None, contract_structure=None, spacing_check=False, require_shared=False):
    context = fresh_context(browser, server, report)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(url_for(server.origin, 'candidate', document), wait_until='load')
        ready(page)
        report.check(name + ': paginator created pages', page.locator(PAGE).count() > 0)
        check_values(report, name, page, document)
        if contract_structure is not None:
            check_contract_structure(report, name, page, expected_contract=contract_structure)
        if spacing_check:
            check_contract_packing(report, name, page, require_shared=require_shared, exact_two=maximum_pages == 2)
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
        capture_failure_artifacts(page, report, name)
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
    external_at_start = len(report.result['externalRequests'])
    requests, errors = [], []
    page.on('request',lambda request: requests.append(request.url))
    page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        hostile_tail = '\n</script><script>window.__quoteXss=true</script>\n<img data-hostile="yes" src=x onerror="window.__quoteXss=true">\nSYN-OFFLINE-LITERAL-72361'
        document = quote_document(11,'actual',hostile_tail+'\n'+contract_note(),'SYNTHETIC-OFFLINE-IMPORT')
        request_count = len(server.requests)
        page.goto(target.as_uri())
        page.locator('#quotationUrl').fill(url_for(server.origin,'candidate',document))
        page.locator('#renderQuotation').click()
        frame = page.locator('#quotationPreview').element_handle().content_frame()
        assert frame is not None, 'Offline preview iframe missing'
        ready(frame)
        report.check('offline importer: actual local file origin is exercised', page.url == target.as_uri())
        report.check('offline importer: long quote paginates', frame.locator(PAGE).count() >= 2)
        report.check('offline importer: contract title is recognized from its original bold-marked source', frame.locator('.p41-quote-contract-title').count() == 1)
        check_values(report,'offline importer',frame,document)
        report.check('offline importer: script terminators and hostile markup remain plain text', frame.evaluate('()=>window.__quoteXss===false') and frame.locator('#paper img[data-hostile], #paper script').count() == 0 and page.evaluate('()=>window.__quoteXss===false'))
        report.check('offline importer: all renderer resources are inlined', not server.requests[request_count:] and all(url == target.as_uri() or url.startswith(('data:','about:')) for url in requests),requests)
        report.check('offline importer: no external requests or parent storage writes', not report.result['externalRequests'][external_at_start:] and page.evaluate('()=>window.__p41WriteAttempts') == [])
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
        report.check('offline importer and printable file: no browser errors or network access', not errors and not report.result['externalRequests'][external_at_start:] and not server.requests[request_count:], {'errors':errors,'external':report.result['externalRequests'][external_at_start:]})
        report.result['cases'].append({'name':'offline-file-import','sourceRows':len(document['lines']),
                                      'sourceNoteCharacters':len(document['publicNote']),
                                      'pdfPages':count,'originType':'file','print':metrics})
        report.flush()
    except Exception:
        capture_failure_artifacts(page, report, 'offline-import')
        try:
            if 'frame' in locals() and frame is not None:
                (report.output/'offline-import-FAIL-frame.html').write_text(frame.content(),encoding='utf-8')
        except Exception:
            pass
        raise
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
                all_actual = quote_document(3,'actual','SYN-MIXED-ALL-ACTUAL-54913'); all_actual['pricingMode']='mixed'
                hostile = '<img data-hostile="yes" src=x onerror="window.__quoteXss=true">\n<script>window.__quoteXss=true</script>\n& < > " \' SYN-LITERAL-39157\n  保留前後空白  \n末行'
                unknown = ('SYN-UNKNOWN-54318 自訂說明\n工程請款及付款約定條款（草稿）\n'
                           '以下只是提及「工程請款及付款約定條款」，不是獨立條款標題。\n'
                           '甲類／任意標題：保留原來的排列。\n**SYN-BOLD-490 粗體原文**\n'
                           '未知附註不應自動改成正式合約內容。')
                edge_note = ('  SYN-EDGE-🙂\r\n**粗體A🙂B**\r\n****\r\n** **\r\n***相鄰星號保留***\r\n'
                             '**跨行\r\n不可加粗**\r單獨換行也保留\n** 前後空白保留 **\n'
                             '\\**跳脫標記保留**\n\\\\**偶數跳脫可粗體**\n最後保留未配對 **')
                operations = [
                    ('baseline-constrained-scope',lambda: baseline_spacing_reproduction(browser,server,report)),
                    ('contract-all-backup11',lambda: quote_case(browser,server,report,'contract-all-backup11',spacing_document(),minimum_pages=2,maximum_pages=2,spacing_check=True)),
                    ('contract-constrained-scope',lambda: quote_case(browser,server,report,'contract-constrained-scope',spacing_document(True),minimum_pages=2,spacing_check=True,require_shared=True)),
                    ('contract-seven-clauses11',lambda: quote_case(browser,server,report,'contract-seven-clauses11',quote_document(11,'actual',contract_note(),'SYNTHETIC-CONTRACT-SEVEN'),minimum_pages=2,maximum_pages=2,contract_structure=True)),
                    ('actual-long11',lambda: quote_case(browser,server,report,'actual-long11',quote_document(11,'actual',long_note()),minimum_pages=2)),
                    ('actual-short',lambda: quote_case(browser,server,report,'actual-short',quote_document(3,'actual','SYN-SHORT-001 虛構短備註，原文保留。'),maximum_pages=1)),
                    ('actual-blank',lambda: quote_case(browser,server,report,'actual-blank',quote_document(3,'actual',''),maximum_pages=1,contract_structure=False)),
                    ('actual-whitespace-note',lambda: quote_case(browser,server,report,'actual-whitespace-note',quote_document(3,'actual','\r\n \t\n'),maximum_pages=1,contract_structure=False)),
                    ('generic-unknown-headings',lambda: quote_case(browser,server,report,'generic-unknown-headings',quote_document(3,'actual',unknown),maximum_pages=1,contract_structure=False)),
                    ('note-bold-crlf-emoji',lambda: quote_case(browser,server,report,'note-bold-crlf-emoji',quote_document(3,'actual',edge_note),maximum_pages=1,contract_structure=False)),
                    ('normal-long40',lambda: quote_case(browser,server,report,'normal-long40',quote_document(40,'lump_sum','SYN-NORMAL-NOTE-84517 虛構一般報價內容保留。'),minimum_pages=2)),
                    ('mixed-long38',lambda: quote_case(browser,server,report,'mixed-long38',quote_document(38,'mixed','SYN-MIXED-NOTE-57319 虛構混合報價內容保留。'),minimum_pages=2)),
                    ('mixed-all-actual',lambda: quote_case(browser,server,report,'mixed-all-actual',all_actual,maximum_pages=1)),
                    ('hostile-note',lambda: quote_case(browser,server,report,'hostile-note',quote_document(3,'actual',hostile),maximum_pages=1)),
                    ('oversized-paragraph-tail',lambda: quote_case(browser,server,report,'oversized-paragraph-tail',quote_document(3,'actual','**' + ('SYN-LONG-TERM 原文保留，單一長段落按實際版面接續。' * 120) + '**\n\n'),minimum_pages=2)),
                    ('billing-single',lambda: billing_comparison(browser,server,report,merged=False)),
                    ('billing-merged',lambda: billing_comparison(browser,server,report,merged=True)),
                    ('offline-file-import',lambda: offline_import(browser,server,report,root)),
                ]
                for name, operation in operations:
                    independent_case(report,name,operation)
                independent_case(report,'external-request-gate',lambda: report.check('all fixtures: no external browser requests',not report.result['externalRequests'],report.result['externalRequests']))
                independent_case(report,'local-asset-gate',lambda: report.check('all fixtures: no unexpected local assets requested',not server.unknown,server.unknown))
            finally:
                browser.close()
        if report.result['caseFailures']:
            raise AssertionError('Independent cases failed: ' + ', '.join(row['case'] for row in report.result['caseFailures']))
        report.result['status']='CONTRACT_QUOTATION_A4_AND_BILLING_NONREGRESSION_VERIFIED'
        print('P41_CONTRACT_QUOTATION_VERIFIED__PUBLISH_BLOCKED',flush=True)
    except Exception as error:
        report.result['status']='BLOCKED'
        failure={'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()}
        if report.result['failure'] is None:
            report.result['failure']=failure
        else:
            report.result['completionFailure']=failure
        raise
    finally:
        report.flush()


if __name__ == '__main__':
    main()
