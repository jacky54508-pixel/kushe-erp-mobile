"""K27 quotation UI -> export button -> print=1 -> rendered PDF integration.

Uses the real quotations and export scripts in their index.html load order,
with a frozen synthetic Store. No real ERP Store, account, or business data is
loaded. window.print is observed at its actual call boundary; the OS print
dialog itself is not automated. Actual PDFs are produced from that document.
"""
import argparse
import base64
import copy
import hashlib
import html
import importlib.util
import json
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


BASE = '4c02e3c707473c4483946afd5222c7cf05d8fb63'
LEGACY_PRODUCER_COMMIT = '668334605342e5766027c3f73b4fe1b29036dec0'
LEGACY_PRODUCER_SHA256 = 'd22d21d7337ccd0291160a062ceea1a9bb634987125a3c31a8bdebc546895f6e'
EXPECTED_VERSION = 'p41-k27-quote-export-20261127-2'
SCRIPT_PATHS = (
    'assets/js/billing-print.js',
    'assets/js/billing-bundle-print.js',
    'assets/js/display-sort.js',
    'assets/js/quotations.js',
)
PRIVATE = ('INTERNAL-QUOTE-K27-9031', 'INTERNAL-LINE-K27-7364', 'PRIVATE-PRICE-K27-2218')
USER_NOTE = '不含拋光磚.全室地壁磚.全室門檻.車庫地磚'
CASE_NAMES = ('actual', 'mixed', 'total', 'legacy', 'manual', 'long', 'toolbar')


def load_checks(root):
    spec = importlib.util.spec_from_file_location(
        'accepted_k27_quote_checks', root / '.p41-quote-tests/test_quotation_pagination.py')
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)
    checks.BASE = BASE
    return checks


def fixture(kind):
    def line(index, item, price, note='', **extra):
        return dict(id=f'SYN-L-{index:02d}', house='', item=item, unit='戶', qty=1,
                    price=price, subtotal=price, lumpSumAmount=price,
                    pricingType='actual', priceSource='manual', priceId='', note=note,
                    internalNote=PRIVATE[1], **extra)

    rows = [
        line(1, '室內鋁窗美容', 15000, USER_NOTE),
        line(2, '室內鋁窗美容', 21000, 'SYN-NOTE-21000 僅含合成鋁窗施工範圍。'),
        line(3, 'SYN-LIFT 合成電梯扇', 500, '備用單價'),
        line(4, 'SYN-MANUAL 合成手動報價', 15000, 'SYN-NOTE-MANUAL 手動單價不推定備用。'),
        line(5, 'SYN-MISMATCH 合成歷史價格', 15100, 'SYN-NOTE-MISMATCH 已調整金額不沿用舊標記。'),
        line(6, 'SYN-MULTILINE 合成多行說明', 800,
             'SYN-LINE-ONE 第一行工作範圍。\nSYN-LINE-TWO <img src=x onerror="window.__k27Xss=true"> & 原文保留。'),
    ]
    rows[0].update(priceSource='project', priceId='SYN-PRICE-OLD')
    rows[1].update(priceSource='project', priceId='SYN-PRICE-NORMAL')
    rows[3].update(priceSource='manual', priceId='SYN-PRICE-MANUAL')
    rows[4].update(priceSource='project', priceId='SYN-PRICE-MISMATCH')
    prices = [
        dict(id='SYN-PRICE-OLD', scope='project', customerId='SYN-C', projectId='SYN-P',
             item=rows[0]['item'], unit='戶', price=15000, isBackupPrice=True,
             effectiveDate='2026-09-03', internalNote=PRIVATE[2]),
        dict(id='SYN-PRICE-NEW', scope='project', customerId='SYN-C', projectId='SYN-P',
             item=rows[0]['item'], unit='戶', price=17000, isBackupPrice=False,
             effectiveDate='2026-11-27', internalNote=PRIVATE[2]),
        dict(id='SYN-PRICE-NORMAL', scope='project', customerId='SYN-C', projectId='SYN-P',
             item=rows[1]['item'], unit='戶', price=21000, isBackupPrice=False,
             effectiveDate='2026-09-03', internalNote=PRIVATE[2]),
        dict(id='SYN-PRICE-MANUAL', scope='project', customerId='SYN-C', projectId='SYN-P',
             item=rows[3]['item'], unit='戶', price=15000, isBackupPrice=True,
             effectiveDate='2026-09-03', internalNote=PRIVATE[2]),
        dict(id='SYN-PRICE-MISMATCH', scope='project', customerId='SYN-C', projectId='SYN-P',
             item=rows[4]['item'], unit='戶', price=15000, isBackupPrice=True,
             effectiveDate='2026-09-03', internalNote=PRIVATE[2]),
    ]
    mode = 'mixed' if kind == 'mixed' else 'lump_sum' if kind == 'total' else 'actual'
    expected_backups = [True, False, True, False, False, False]
    if kind == 'mixed':
        rows[1]['pricingType'] = 'lump_sum'
        rows[1]['lumpSumAmount'] = 23000
    if kind == 'total':
        for row in rows:
            row['pricingType'] = 'lump_sum'
        rows[1]['lumpSumAmount'] = 23000
    if kind == 'legacy':
        prices = []
        expected_backups[0] = False
    if kind == 'manual':
        rows[0]['priceSource'] = 'manual'
        rows[2]['note'] = 'SYN-NOTE-NORMAL 一般手動單價，未指定備用標記。'
        expected_backups = [False] * len(rows)
    if kind == 'long':
        for i in range(7, 23):
            rows.append(line(i, f'SYN-LONG-{i:02d} 合成長報價項目', 1000 + i,
                             f'SYN-NOTE-{i:02d}-A 此段為合成逐項對外施工範圍，必須完整隨品項保留。\n'
                             f'SYN-NOTE-{i:02d}-B 第二行列出限制條件，不能在分頁或列印時被截斷。'))
            expected_backups.append(False)
    amount = sum(row['lumpSumAmount'] if row['pricingType'] == 'lump_sum' else row['subtotal'] for row in rows)
    record = dict(id='SYN-Q', number='SYNTHETIC-K27', customer='SYN-C', project='SYN-P',
                  customerName='合成測試客戶', projectName='合成報價匯出測試',
                  status='草稿', date='2026-11-27', pricingMode=mode, taxMode='未稅',
                  amount=amount, tax=round(amount * .05), total=amount + round(amount * .05),
                  publicNote='SYN-DOC-START 本文件僅為隔離測試。\nSYN-DOC-END 特殊品項依合成現場條件另行報價。',
                  internalNote=PRIVATE[0], lines=rows)
    state = dict(settings={}, quotations=[record], quotationPrices=prices, quotationTemplates=[],
                 itemPresets=[], dailyItemPresets=[],
                 customers=[dict(id='SYN-C', name='合成測試客戶')],
                 projects=[dict(id='SYN-P', customer='SYN-C', name='合成報價匯出測試')])
    if kind == 'legacy':
        state.pop('quotationPrices')
    return state, expected_backups


def script_order(source):
    ordered = [value for value in re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', source, re.I)
               if urlsplit(value).path in SCRIPT_PATHS]
    if [urlsplit(value).path for value in ordered] != list(SCRIPT_PATHS):
        raise AssertionError('Actual index quotation script load order changed: ' + repr(ordered))
    return ordered


UI_BOOTSTRAP = r"""
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(deepFreeze)}return value};
window.__k27SyntheticState=deepFreeze(SYNTHETIC_STATE);
window.__k27SourceBefore=JSON.stringify(window.__k27SyntheticState);
window.__k27LoadedScripts=[];
window.__k27StoreWrites=[];
window.__k27Toasts=[];
const store={
  load:async()=>window.__k27SyntheticState,
  getState:()=>window.__k27SyntheticState,
  masterOptions:key=>window.__k27SyntheticState[key]||[],
  quotationUsage:()=>({used:false})
};
window.KuSheERPStore=new Proxy(store,{get(target,key){
  if(key in target)return target[key];
  if(typeof key==='string'&&/^(?:save|set|delete|cancel|create|update|commit|reset|restore|import)/.test(key))return()=>{window.__k27StoreWrites.push(key);throw Error('SYNTHETIC_STORE_WRITE_FORBIDDEN:'+key)};
  return undefined;
}});
window.KusheKpi={register:()=>{}};
window.KushePhase1={toast:message=>window.__k27Toasts.push(String(message))};
window.KusheIcons={render:()=>{}};
window.KusheTableScroll={refresh:()=>{}};
document.addEventListener('click',event=>{
  if(!event.target.closest('#exportQuotation,#printQuotation'))return;
  console.info('__K27_SOURCE__'+JSON.stringify({
    sourceUnchanged:JSON.stringify(window.__k27SyntheticState)===window.__k27SourceBefore,
    sourceFrozen:Object.isFrozen(window.__k27SyntheticState.quotations[0].lines[0]),
    storeWrites:window.__k27StoreWrites,storageWrites:window.__p41WriteAttempts,
    toasts:window.__k27Toasts,loadedScripts:window.__k27LoadedScripts
  }));
});
"""


PRINT_OBSERVER = r"""(() => {
  window.__k27PrintCalls=[];
  window.__k27PopupCalls=[];
  window.open=(...args)=>{window.__k27PopupCalls.push(args);throw Error('UNEXPECTED_POPUP')};
  window.__k27RowFacts=()=>[...document.querySelectorAll('#paper .detail tbody tr:not(.line-total)')].map(row=>{
    const cell=row.cells[0],name=cell.cloneNode(true);
    name.querySelectorAll('.actual-note,.p41-quote-line-note').forEach(n=>n.remove());
    const visible=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0};
    return {item:name.textContent,notes:[...cell.querySelectorAll('.p41-quote-line-note')].map(n=>({text:n.textContent,visible:visible(n),markup:n.querySelectorAll('*').length})),
      badges:[...cell.querySelectorAll('.actual-note')].map(n=>({text:n.textContent,visible:visible(n)})),
      cells:[...row.cells].map(n=>n.innerText)};
  });
  window.print=()=>{window.__k27PrintCalls.push({
    ready:window.__billingPrintReady===true,buttonDisabled:document.querySelector('#safePrintButton')?.disabled,
    pagination:window.__quotationPagination||null,rows:window.__k27RowFacts(),
    publicText:document.querySelector('#paper')?.innerText||'',urlSearch:location.search,
    writes:window.__p41WriteAttempts||[],popupCalls:window.__k27PopupCalls.length,
    hasSourceApp:!!window.KuSheERPStore
  });};
})();"""


class FixtureServer:
    def __init__(self, root, output, checks):
        self.root, self.output = root, output
        self.requests, self.unknown = [], []
        self.assets = set(checks.ASSETS) | set(SCRIPT_PATHS)
        self.baseline = {path: subprocess.check_output(['git', '-C', str(root), 'show', BASE + ':' + path])
                         for path in self.assets}
        self.legacy_producer = subprocess.check_output(['git', '-C', str(root), 'show',
            LEGACY_PRODUCER_COMMIT + ':assets/js/billing-print.js'])
        assert hashlib.sha256(self.legacy_producer).hexdigest() == LEGACY_PRODUCER_SHA256
        baseline_index = subprocess.check_output(['git', '-C', str(root), 'show', BASE + ':index.html']).decode()
        self.orders = {'baseline': script_order(baseline_index),
                       'candidate': script_order((root / 'index.html').read_text(encoding='utf-8'))}
        self.enterprise = checks.enterprise_fixture()
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = unquote(urlsplit(self.path).path)
                parent.requests.append(path)
                if path.endswith('/favicon.ico'):
                    self.send_response(204); self.end_headers(); return
                parts = path.lstrip('/').split('/', 1)
                if len(parts) != 2 or parts[0] not in ('baseline', 'candidate'):
                    return self.reject(path)
                version, name = parts
                match = re.fullmatch(r'k27-quote-ui-([a-z]+)\.html', name)
                if match and match[1] in CASE_NAMES:
                    return self.send_data(parent.ui(version, match[1]), 'text/html; charset=utf-8')
                if name == 'enterprise/index.html':
                    return self.send_data(parent.enterprise, 'text/html; charset=utf-8')
                if name not in parent.assets:
                    return self.reject(path)
                try:
                    data = parent.baseline[name] if version == 'baseline' else (root / name).read_bytes()
                except (KeyError, OSError):
                    return self.reject(path)
                media = 'application/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html'
                self.send_data(data, media + '; charset=utf-8')

            def reject(self, path):
                parent.unknown.append(path)
                self.send_error(404)

            def send_data(self, data, media):
                self.send_response(200)
                self.send_header('Content-Type', media)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = 'http://127.0.0.1:' + str(self.httpd.server_port)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def ui(self, version, kind):
        state, _ = fixture(kind)
        data = json.dumps(state, ensure_ascii=False).replace('<', '\\u003c')
        bootstrap = UI_BOOTSTRAP.replace('SYNTHETIC_STATE', data)
        scripts = ''.join('<script src="' + html.escape(src, quote=True) + '" onload="window.__k27LoadedScripts.push(this.getAttribute(\'src\'))"></script>'
                          for src in self.orders[version])
        source = ('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Synthetic K27 quote route</title>'
                  '<style>body{font:16px Arial,sans-serif}button{padding:8px;margin:4px}.mobile-quotations,.mobile-quotation-detail{display:none}'
                  '.commission-drawer-backdrop{display:none}table{border-collapse:collapse}td,th{padding:5px;border:1px solid #ddd}</style>'
                  '<main id="quotationsView"><div id="quotationsApp"></div></main>'
                  '<script>' + bootstrap + '</script>' + scripts +
                  '<script>window.KusheQuotations.activate().then(()=>{window.__k27UiReady=true}).catch(e=>{window.__k27UiError=String(e);throw e});</script></html>')
        return source.encode('utf-8')

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.httpd.shutdown()
        self.httpd.server_close()
        (self.output / 'loopback-requests.json').write_text(json.dumps(
            {'requests': self.requests, 'unservedRequests': self.unknown, 'actualIndexScriptOrder': self.orders},
            ensure_ascii=False, indent=2), encoding='utf-8')


def wait_for_call(page):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        calls = page.evaluate('()=>window.__k27PrintCalls||[]')
        if calls:
            return calls
        time.sleep(.05)
    raise AssertionError('Actual auto-print callback did not run after quotation export')


def check_rows(report, name, rows, view, backups):
    report.check(name + ': all source rows reach the final document in stable order', len(rows) == len(view['lines']))
    failures = []
    for index, (row, source, backup) in enumerate(zip(rows, view['lines'], backups)):
        note = source.get('note', '')
        expected_note = '' if note.strip() == '備用單價' and backup else note
        expected_notes = [expected_note] if expected_note else []
        notes = [value['text'] for value in row['notes']]
        labels = [value['text'] for value in row['badges']]
        if (row['item'] != source['item'] or notes != expected_notes or
                labels.count('備用單價') != int(backup) or
                any(not value['visible'] for value in row['notes'] + row['badges']) or
                any(value['markup'] for value in row['notes'])):
            failures.append({'index': index, 'expectedItem': source['item'], 'expectedNotes': expected_notes,
                             'expectedBackup': backup, 'actual': row})
    report.check(name + ': each item keeps its own complete visible scope note and exactly one expected backup label', not failures, failures)


def windows_pdf(checks, report, name, page, metrics, output, minimum_pages=1, maximum_pages=None):
    pdf_path = output / (name + '.pdf')
    pdf_path.write_bytes(page.pdf(format='A4', print_background=True, prefer_css_page_size=True,
                                  margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'}))
    reader = checks.PdfReader(str(pdf_path))
    count = len(reader.pages)
    report.check(name + ': PDF has one physical page for each complete rendered sheet',
                 count == len(metrics['pages']) and count >= minimum_pages and
                 (maximum_pages is None or count <= maximum_pages), {'pages': count})
    texts = []
    for i, sheet in enumerate(reader.pages):
        dimensions = [float(sheet.mediabox.width), float(sheet.mediabox.height)]
        report.check(name + f': physical PDF page {i+1} is portrait A4',
                     594 <= dimensions[0] <= 596 and 841 <= dimensions[1] <= 843, dimensions)
        text = sheet.extract_text() or ''
        texts.append(text)
        expected = metrics['pages'][i]
        markers = re.findall(r'(?:SYN|LINE|DOC|FLOW)[A-Z0-9-]*', '\n'.join(
            [row['cells'][0] for row in expected['rows']] + [note['text'] for note in expected['notes']]))
        report.check(name + f': PDF page {i+1} contains its exact ASCII source identifiers',
                     all(marker in checks.normalized(text) for marker in markers), markers)
    (output / (name + '-pypdf-diagnostic-text.txt')).write_text('\n\f\n'.join(texts), encoding='utf-8')
    report.result.setdefault('pendingExactUnicodePdfReview', []).append(name + '.pdf')
    return count


def inject_bridge_scenario(page, server, scenario):
    """Inject a previously shipped or unavailable bridge after normal UI loading."""
    if scenario in ('old', 'network-failure', 'wrong-version'):
        page.add_script_tag(content=server.legacy_producer.decode('utf-8'))
    elif scenario == 'missing':
        page.evaluate('()=>{window.KusheQuotationPrint=undefined}')
    elif scenario == 'incomplete':
        page.evaluate('''()=>{
          const engine=window.KusheQuotationPrint,prepare=engine.prepare.bind(engine);
          engine.prepare=record=>{
            const prepared=prepare(record),view=JSON.parse(JSON.stringify(prepared.view));
            view.lines[0].note='';
            const bad=()=>{console.error('__K27_BAD_BRIDGE__');throw Error('Incomplete bridge was used')};
            return {view,export:bad,print:bad};
          };
        }''')
    requests = []
    page.on('request', lambda request: requests.append(request.url)
            if urlsplit(request.url).path.endswith('/assets/js/billing-print.js') else None)
    if scenario == 'network-failure':
        page.route(re.compile(r'/assets/js/billing-print\.js\?'), lambda route: route.abort('failed'))
    elif scenario == 'wrong-version':
        page.route(re.compile(r'/assets/js/billing-print\.js\?'),
                   lambda route: route.fulfill(status=200,content_type='application/javascript',body=server.legacy_producer))
    return requests


def route_case(checks, browser, server, report, name, kind, version='candidate',
               bridge_scenario='', reproduce_missing=False):
    state, backups = fixture(kind)
    record = state['quotations'][0]
    if version == 'baseline':
        backups = [row['note'].strip() == '備用單價' for row in record['lines']]
    context = checks.fresh_context(browser, server, report)
    context.add_init_script(PRINT_OBSERVER)
    page = context.new_page()
    errors, source_events, bad_bridge_calls = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def console(message):
        if message.text.startswith('__K27_SOURCE__'):
            source_events.append(json.loads(message.text.removeprefix('__K27_SOURCE__')))
        if message.text.startswith('__K27_BAD_BRIDGE__'):
            bad_bridge_calls.append(message.text)

    page.on('console', console)
    try:
        page.goto(f'{server.origin}/{version}/k27-quote-ui-{kind}.html', wait_until='load')
        page.wait_for_function('()=>window.__k27UiReady===true')
        page.locator('.quotation-desktop-list [data-quote-view="SYN-Q"]').click()
        actual_notes = page.locator('.quotation-detail-table tbody tr td:last-child').all_text_contents()
        report.check(name + ': actual quotation detail UI displays every source line note',
                     actual_notes == [row['note'] or '—' for row in record['lines']], actual_notes)
        reload_requests = inject_bridge_scenario(page, server, bridge_scenario)
        toolbar = kind == 'toolbar'
        page.locator('#printQuotation' if toolbar else '#exportQuotation').click()
        page.wait_for_url(re.compile(r'/billing-print\.html\?'), wait_until='load')
        parsed = urlsplit(page.url)
        query = parse_qs(parsed.query)
        view = json.loads(base64.b64decode(unquote(parsed.fragment)).decode('utf-8'))
        report.check(name + ': real detail button navigates in the same tab to the intended renderer',
                     len(context.pages) == 1 and query.get('print') == ['0' if toolbar else '1'] and
                     parsed.path == f'/{version}/billing-print.html',
                     {'path': parsed.path, 'query': query, 'openTabs': len(context.pages)})
        if version == 'candidate':
            report.check(name + ': export URL identifies the current K27 template version', query.get('v') == [EXPECTED_VERSION], query)
        report.check(name + ': exact real index load order reaches the actual button without source mutation or writes',
                     len(source_events) == 1 and source_events[0]['sourceUnchanged'] and source_events[0]['sourceFrozen'] and
                     not source_events[0]['storeWrites'] and not source_events[0]['storageWrites'] and
                     not source_events[0]['toasts'] and source_events[0]['loadedScripts'] == server.orders[version], source_events)
        report.check(name + ': actual payload follows the expected line-note contract without private fields',
                     (all('note' not in row for row in view['lines']) if reproduce_missing else
                      [row['note'] for row in view['lines']] == [row['note'].strip() for row in record['lines']]) and
                     not any(marker in json.dumps(view, ensure_ascii=False) for marker in PRIVATE) and
                     not any('internalNote' in row or 'priceId' in row for row in view['lines']))
        if bridge_scenario and version == 'candidate':
            report.check(name + ': incompatible bridge is replaced once by the exact current producer before export',
                         len(reload_requests)==1 and
                         parse_qs(urlsplit(reload_requests[0]).query).get('v')==[EXPECTED_VERSION] and
                         not bad_bridge_calls, {'requests':reload_requests,'badBridgeCalls':bad_bridge_calls})
        else:
            report.check(name + ': compatible path has no unnecessary producer reload', not reload_requests, reload_requests)
        report.check(name + ': backup flags follow the saved source history or explicit legacy note',
                     [row['isBackupPrice'] for row in view['lines']] == backups,
                     {'expected': backups, 'actual': [row['isBackupPrice'] for row in view['lines']]})
        expected_amounts = [row['lumpSumAmount'] if record['pricingMode'] == 'lump_sum' or record['pricingMode'] == 'mixed' and row['pricingType'] == 'lump_sum' else row['qty'] * row['price']
                            for row in record['lines']]
        report.check(name + ': stored quantities, prices, per-line amounts and quotation totals are unchanged',
                     [row['qty'] for row in view['lines']] == [row['qty'] for row in record['lines']] and
                     [row['price'] for row in view['lines']] == [row['price'] for row in record['lines']] and
                     [row['amount'] for row in view['lines']] == expected_amounts and
                     [view[key] for key in ('salesAmount', 'taxAmount', 'totalAmount')] == [record[key] for key in ('amount', 'tax', 'total')])
        checks.ready(page)
        if toolbar:
            report.check(name + ': print=0 opens preview without automatically printing', page.evaluate('()=>window.__k27PrintCalls.length') == 0)
            page.locator('#safePrintButton').click()
        calls = wait_for_call(page)
        report.check(name + ': actual print callback runs exactly once after complete verified pagination',
                     len(calls) == 1 and calls[0]['ready'] and calls[0]['buttonDisabled'] is False and
                     calls[0]['pagination']['applied'] and not calls[0]['writes'] and
                     calls[0]['popupCalls'] == 0 and calls[0]['hasSourceApp'] is False,
                     {key: calls[0][key] for key in ('ready', 'buttonDisabled', 'pagination', 'writes', 'popupCalls', 'hasSourceApp')} if calls else calls)
        check_rows(report, name + ' at window.print', calls[0]['rows'], view, backups)
        if reproduce_missing:
            report.check(name + ': old producer reproduces a missing custom line note while the legacy backup label survives',
                         USER_NOTE not in calls[0]['publicText'] and '備用單價' in calls[0]['publicText'] and
                         'SYN-NOTE-21000' not in calls[0]['publicText'],
                         {'legacyProducerCommit':LEGACY_PRODUCER_COMMIT,
                          'scope':'Reproduced mechanism; actual user browser module version remains unproven'})
        report.check(name + ': private notes and escaped markup do not become printed content or executable HTML',
                     not any(marker in calls[0]['publicText'] for marker in PRIVATE) and
                     page.evaluate('()=>window.__k27Xss===undefined') and
                     page.locator('.p41-quote-line-note img').count() == 0)
        checks.check_source_notes(report, name, page, view['publicNote'])
        screen_metrics = page.evaluate(checks.METRICS)
        checks.check_layout(report, name + ' preview', screen_metrics)
        page.screenshot(path=str(report.output / (name + '.png')), full_page=True)
        page.emulate_media(media='print')
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        printed_rows = page.evaluate('()=>window.__k27RowFacts()')
        check_rows(report, name + ' print media', printed_rows, view, backups)
        metrics = page.evaluate(checks.METRICS)
        checks.check_layout(report, name + ' print media', metrics, printing=True)
        pdf_count = checks.check_pdf(report, name, page, metrics, report.output,
                                     minimum_pages=2 if kind == 'long' else 1)
        report.check(name + ': print document retains its exact payload and produces no page errors',
                     page.evaluate('()=>d') == view and not errors and not page.evaluate('()=>window.__p41WriteAttempts'), errors)
        details = {'syntheticOnly': True, 'case': name, 'version': version, 'inputState': state,
                   'view': view, 'expectedBackupFlags': backups, 'sourceEvidence': source_events,
                   'printCalls': calls, 'printMetrics': metrics, 'pdfPages': pdf_count,
                   'injectedBridgeScenario': bridge_scenario, 'producerReloadRequests': reload_requests,
                   'legacyNoteOmissionReproduced': reproduce_missing,
                   'operatingSystemPrintDialogTested': False}
        (report.output / (name + '-evidence.json')).write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding='utf-8')
        report.result['cases'].append({'name': name, 'mode': record['pricingMode'], 'rows': len(view['lines']),
                                       'pdfPages': pdf_count, 'actualButton': 'printQuotation' if toolbar else 'exportQuotation',
                                       'noteDisappearanceReproduced': reproduce_missing,
                                       'customScopeBackupMissingInBaseline': version == 'baseline' and backups[0] is False})
        return view
    except Exception:
        checks.capture_failure_artifacts(page, report, name)
        raise
    finally:
        context.close()


def blocked_reload_case(checks, browser, server, report, scenario):
    name='blocked-'+scenario
    context=checks.fresh_context(browser,server,report)
    context.add_init_script(PRINT_OBSERVER)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        url=f'{server.origin}/candidate/k27-quote-ui-actual.html'
        page.goto(url,wait_until='load')
        page.wait_for_function('()=>window.__k27UiReady===true')
        page.locator('.quotation-desktop-list [data-quote-view="SYN-Q"]').click()
        reload_requests=inject_bridge_scenario(page,server,scenario)
        page.locator('#exportQuotation').click()
        page.wait_for_function('''()=>window.__k27Toasts.length>0&&
            !document.querySelector('#exportQuotation').disabled&&
            !document.querySelector('#printQuotation').disabled''')
        facts=page.evaluate('''()=>({
          toasts:window.__k27Toasts,printCalls:window.__k27PrintCalls,popups:window.__k27PopupCalls,
          storeWrites:window.__k27StoreWrites,storageWrites:window.__p41WriteAttempts,
          sourceUnchanged:JSON.stringify(window.__k27SyntheticState)===window.__k27SourceBefore,
          exportText:document.querySelector('#exportQuotation').textContent,
          printText:document.querySelector('#printQuotation').textContent
        })''')
        report.check(name+': failing replacement never navigates or prints an incomplete quotation',
                     page.url==url and len(context.pages)==1 and not facts['printCalls'] and not facts['popups'])
        report.check(name+': exactly one current-version replacement is attempted',
                     len(reload_requests)==1 and parse_qs(urlsplit(reload_requests[0]).query).get('v')==[EXPECTED_VERSION],reload_requests)
        report.check(name+': failure restores usable buttons and explains the blocked export',
                     facts['exportText']=='匯出 PDF' and facts['printText']=='列印' and len(facts['toasts'])==1 and
                     ('載入失敗' in facts['toasts'][0] or '停止匯出' in facts['toasts'][0]),facts['toasts'])
        report.check(name+': failure leaves source and storage untouched with no unhandled page errors',
                     facts['sourceUnchanged'] and not facts['storeWrites'] and not facts['storageWrites'] and not errors,errors)
        details={'syntheticOnly':True,'case':name,'facts':facts,'reloadRequests':reload_requests,'urlUnchanged':page.url==url}
        (report.output/(name+'-evidence.json')).write_text(json.dumps(details,ensure_ascii=False,indent=2),encoding='utf-8')
        report.result.setdefault('blockedCases',[]).append({'name':name,'navigationPrevented':True,'sourceUnchanged':True})
    except Exception:
        checks.capture_failure_artifacts(page,report,name)
        raise
    finally:
        context.close()


def blocked_rendered_note_case(checks,browser,server,report):
    name='blocked-rendered-note-removal'
    context=checks.fresh_context(browser,server,report)
    context.add_init_script(PRINT_OBSERVER)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.goto(f'{server.origin}/candidate/k27-quote-ui-toolbar.html',wait_until='load')
        page.wait_for_function('()=>window.__k27UiReady===true')
        page.locator('.quotation-desktop-list [data-quote-view="SYN-Q"]').click()
        page.locator('#printQuotation').click()
        page.wait_for_url(re.compile(r'/billing-print\.html\?'),wait_until='load')
        checks.ready(page)
        report.check(name+': correct preview starts ready with its complete source note',
                     page.evaluate('note=>d.lines[0].note===note&&window.__billingPrintReady===true',USER_NOTE))
        page.locator('#paper .p41-quote-line-note').first.evaluate('(node)=>node.remove()')
        page.locator('#safePrintButton').click()
        page.wait_for_function("()=>window.__billingPrintError==='QUOTATION_PUBLIC_NOTES_INCOMPLETE'")
        facts=page.evaluate('''()=>({ready:window.__billingPrintReady,error:window.__billingPrintError,
          disabled:document.querySelector('#safePrintButton').disabled,button:document.querySelector('#safePrintButton').textContent,
          printCalls:window.__k27PrintCalls,writes:window.__p41WriteAttempts,payloadNote:d.lines[0].note})''')
        report.check(name+': last print boundary blocks missing rendered notes rather than issuing a damaged PDF',
                     facts['ready'] is False and facts['disabled'] and not facts['printCalls'] and
                     facts['error']=='QUOTATION_PUBLIC_NOTES_INCOMPLETE',facts)
        report.check(name+': blocked preview retains the source payload without writes or unhandled errors',
                     facts['payloadNote']==USER_NOTE and not facts['writes'] and not errors,errors)
        (report.output/(name+'-evidence.json')).write_text(json.dumps({'syntheticOnly':True,'facts':facts},ensure_ascii=False,indent=2),encoding='utf-8')
        report.result.setdefault('blockedCases',[]).append({'name':name,'printPrevented':True,'payloadPreserved':True})
    except Exception:
        checks.capture_failure_artifacts(page,report,name)
        raise
    finally:
        context.close()


def canceled_reload_case(checks,browser,server,report):
    name='canceled-delayed-producer-reload'
    context=checks.fresh_context(browser,server,report)
    context.add_init_script(PRINT_OBSERVER)
    page=context.new_page()
    pending=[]
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        url=f'{server.origin}/candidate/k27-quote-ui-actual.html'
        page.goto(url,wait_until='load')
        page.wait_for_function('()=>window.__k27UiReady===true')
        page.locator('.quotation-desktop-list [data-quote-view="SYN-Q"]').click()
        reload_requests=inject_bridge_scenario(page,server,'old')
        page.route(re.compile(r'/assets/js/billing-print\.js\?'),lambda route:pending.append(route))
        page.locator('#exportQuotation').click(no_wait_after=True)
        page.wait_for_function("()=>document.querySelector('#quotationLayer').getAttribute('aria-busy')==='true'")
        report.check(name+': unavailable bridge keeps export busy while the replacement is loading',
                     page.locator('#exportQuotation').is_disabled() and page.locator('#printQuotation').is_disabled())
        deadline=time.monotonic()+10
        while not pending and time.monotonic()<deadline:
            page.wait_for_timeout(25)
        report.check(name+': one delayed current producer request is pending',len(pending)==1 and len(reload_requests)==1)
        page.locator('.quotation-close').click()
        report.check(name+': closing the detail removes the active export surface',
                     not page.locator('#quotationLayer').evaluate("node=>node.classList.contains('is-open')"))
        pending.pop().fulfill(status=200,content_type='application/javascript',
                              body=(server.root/'assets/js/billing-print.js').read_bytes())
        page.wait_for_function('''version=>window.KusheQuotationPrint?.version===version&&
            document.querySelector('#quotationLayer').getAttribute('aria-busy')===null''',arg=EXPECTED_VERSION)
        facts=page.evaluate('''()=>({printCalls:window.__k27PrintCalls,popups:window.__k27PopupCalls,
            storageWrites:window.__p41WriteAttempts,storeWrites:window.__k27StoreWrites,toasts:window.__k27Toasts,
            sourceUnchanged:JSON.stringify(window.__k27SyntheticState)===window.__k27SourceBefore})''')
        report.check(name+': delayed completion does not navigate or print after the user closes the detail',
                     page.url==url and len(context.pages)==1 and not facts['printCalls'] and not facts['popups'])
        report.check(name+': cancellation preserves source and storage without an error or failure toast',
                     facts['sourceUnchanged'] and not facts['storeWrites'] and not facts['storageWrites'] and
                     not facts['toasts'] and not errors,{'facts':facts,'errors':errors})
        (report.output/(name+'-evidence.json')).write_text(json.dumps({'syntheticOnly':True,'facts':facts,
            'reloadRequests':reload_requests,'urlUnchanged':page.url==url},ensure_ascii=False,indent=2),encoding='utf-8')
        report.result.setdefault('blockedCases',[]).append({'name':name,'canceledNavigationPrevented':True,'sourceUnchanged':True})
    except Exception:
        checks.capture_failure_artifacts(page,report,name)
        raise
    finally:
        for route in pending:
            route.abort('failed')
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/p41-k27/route'))
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    checks = load_checks(root)
    report = checks.Reporter(output)
    has_poppler = shutil.which('pdftotext') is not None
    report.result.update(schema='p41-k27-actual-quotation-export-route-v1', platform=platform.platform(),
                         candidateCommit=subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
                         operatingSystemPrintDialogTested=False,
                         pdfTextVerification='EXACT_POPPLER_UNICODE' if has_poppler else 'ASCII_AND_A4_ONLY_PENDING_INDEPENDENT_UNICODE_REVIEW',
                         noteDisappearanceStatus='USER_PDF_OMISSION_CONFIRMED__LEGACY_PRODUCER_MECHANISM_TO_VERIFY',
                         userBrowserModuleVersion='NOT_IDENTIFIABLE_FROM_PDF',
                         sourceHistoryBackupStatus='BASELINE_REPRODUCTION_REQUIRED')
    if not has_poppler:
        if sys.platform != 'win32':
            raise RuntimeError('Linux verification requires independent pdftotext Unicode extraction')
        checks.check_pdf = lambda *args, **kwargs: windows_pdf(checks, *args, **kwargs)
        checks.extract_layout_pages = lambda path, count: [page.extract_text() or '' for page in checks.PdfReader(str(path)).pages]
    try:
        with FixtureServer(root, output, checks) as server, checks.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({} if sys.platform == 'win32' else {'channel': 'chrome'}))
            try:
                operations = [
                    ('baseline-real-ui-route', lambda: route_case(checks, browser, server, report, 'baseline-real-ui-route', 'actual', 'baseline')),
                    ('legacy-producer-note-omission', lambda: route_case(checks, browser, server, report,
                        'legacy-producer-note-omission','actual','baseline',bridge_scenario='old',reproduce_missing=True)),
                    *[(f'route-{kind}', lambda kind=kind: route_case(checks, browser, server, report, f'route-{kind}', kind))
                      for kind in CASE_NAMES],
                    *[(f'recovered-{scenario}-bridge', lambda scenario=scenario: route_case(checks,browser,server,report,
                        f'recovered-{scenario}-bridge','actual',bridge_scenario=scenario))
                      for scenario in ('old','missing','incomplete')],
                    *[(f'blocked-{scenario}', lambda scenario=scenario: blocked_reload_case(checks,browser,server,report,scenario))
                      for scenario in ('network-failure','wrong-version')],
                    ('blocked-rendered-note-removal',lambda:blocked_rendered_note_case(checks,browser,server,report)),
                    ('canceled-delayed-producer-reload',lambda:canceled_reload_case(checks,browser,server,report)),
                    ('accepted-contract-spacing', lambda: checks.quote_case(browser, server, report, 'accepted-contract-spacing', checks.spacing_document(), minimum_pages=2, maximum_pages=2, spacing_check=True)),
                    ('unchanged-billing', lambda: checks.billing_comparison(browser, server, report)),
                ]
                for name, operation in operations:
                    checks.independent_case(report, name, operation)
                report.check('all K27 browser requests stay on the synthetic asset allowlist',
                             not report.result['externalRequests'] and not server.unknown,
                             {'externalRequests': report.result['externalRequests'], 'unexpectedAssets': server.unknown})
            finally:
                browser.close()
        if report.result['caseFailures']:
            raise AssertionError('Cases failed: ' + ', '.join(case['case'] for case in report.result['caseFailures']))
        report.result['status'] = 'K27_ACTUAL_EXPORT_ROUTE_VERIFIED'
        report.result['sourceHistoryBackupStatus'] = 'BASELINE_MISSING_CUSTOM_NOTE_BACKUP__CANDIDATE_PRESERVES_BOTH'
        report.result['noteDisappearanceStatus'] = 'LEGACY_PRODUCER_OMISSION_REPRODUCED__CANDIDATE_RECOVERS_OR_BLOCKS'
        print('K27_ACTUAL_EXPORT_ROUTE_VERIFIED__PUBLISH_PENDING', flush=True)
    except Exception as error:
        report.result['status'] = 'BLOCKED'
        report.result['completionFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
        raise
    finally:
        report.flush()


if __name__ == '__main__':
    main()
