"""K29 real PDF routing, precision, image guards, and 30x30 capacity evidence."""
import argparse
import base64
import json
import math
import re
import traceback
import unicodedata
import uuid
from collections import Counter
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright
from pdf_support import Report, Server, artifact_pdf, browser_options, pdf_image_paints, restrict, sha, source, synthetic_assets

FILES = ['billing-print.html', 'billing-bundle-print.html', 'external-billing-print.html',
         'assets/js/display-sort.js', 'assets/js/external-billing-invoice.js', 'assets/js/external-billing-print.js',
         'assets/js/p41-quote-pagination.js', 'assets/css/p41-quote-pagination.css', 'assets/css/p40-16cd-mint-quotation-billing.css']
PROBE = r'''window.__printed=0;window.print=()=>window.__printed++;window.__writes=[];
for(const method of ['setItem','removeItem','clear'])Storage.prototype[method]=function(){__writes.push(method);throw Error('SYN_K29_PRINT_WRITE_FORBIDDEN')};
IDBFactory.prototype.open=function(){__writes.push('indexedDB.open');throw Error('SYN_K29_PRINT_IDB_FORBIDDEN')};'''


def text_key(value):
    # PDF CJK fonts can map a visible character to its compatibility radical.
    # Preserve every glyph while normalizing that representation and line wraps.
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))


def bundle_pdf_fields(value):
    text = text_key(value)
    markers = ('SYN-BUNDLE-WORK', 'SYN-BUNDLE-A', 'SYN-BUNDLE-NO-A')
    return {'markers': {marker: len(re.findall(re.escape(marker) + r'(?![A-Z0-9_-])', text)) for marker in markers},
            'currencyTokens': dict(Counter(re.findall(r'\$[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?![0-9,.])', text)))}


BUNDLE_PDF_EXPECTED = {'markers': {'SYN-BUNDLE-WORK': 1, 'SYN-BUNDLE-A': 1, 'SYN-BUNDLE-NO-A': 2},
                       'currencyTokens': {'$100': 1, '$200': 3, '$10': 2, '$210': 4, '$0': 2}}


def payload(count=13, fractional=True, historical=False, profile='standard'):
    lines = []
    for i in range(count):
        qty = 1.2345 if fractional else 1
        price = round(12.3456 + i, 4) if fractional else 100 + i
        item = f'SYN-ITEM-{i+1:03d}'
        if profile == 'long-chinese':
            item += '｜' + '公共區域耐候防水牆面修補及原工程細節完整保留' * 5
        if profile == 'large-decimals':
            qty, price = 1234.5678, round(1234567.8912 + i, 4)
        lines.append({'house': 'SYN-H-' + str(i + 1), 'item': item, 'unit': '式',
                      'qty': qty, 'price': price, 'amount': math.floor(qty * price + .5)})
    parts = [lines[:len(lines)//2], lines[len(lines)//2:]]
    documents, settlements = [], []
    keys = ('untaxed', 'tax', 'grossTotal', 'retention', 'receivable', 'received', 'outstanding', 'retentionReceived', 'retentionOutstanding', 'pendingCheque', 'availableToCollect')
    totals = dict.fromkeys(keys, 0)
    for i, part in enumerate(parts):
        amount = sum(l['amount'] for l in part)
        tax = math.floor(amount * .05 + .5)
        gross = amount + tax
        retention = math.floor(amount * .1) if profile == 'long-note-retention' else 0
        anchors = {'untaxed': amount, 'tax': tax, 'grossTotal': gross, 'retention': retention, 'receivable': gross - retention}
        settlement = {'billingId': 'SYN-SOURCE-' + str(i), 'received': 0, 'outstanding': gross - retention, 'retentionReceived': 0,
                      'retentionOutstanding': retention, 'pendingCheque': 0, 'availableToCollect': gross - retention}
        documents.append({'billingId': settlement['billingId'], 'projectName': 'SYN-PUBLIC-A' if i == 0 else 'SYN-PRIVATE-B-PROJECT',
                          'customerId': 'SYN-CUSTOMER', 'customerName': '合成建設', 'number': 'SYN-PRIVATE-SOURCE-' + str(i),
                          'date': '2026-08-17', 'invoiceStatus': 'invoiced', 'invoiceNo': 'SYN-PRIVATE-INVOICE-' + str(i),
                          'invoiceDate': '2026-08-18', 'anchors': anchors, 'taxMode': '未稅', 'originalLines': part})
        settlements.append(settlement)
        for key in keys:
            totals[key] += anchors.get(key, settlement.get(key, 0))
    doc = {'schema': 'kushe-external-billing-group-v2', 'id': 'SYN-K29-DOC', 'revision': 2, 'status': 'active',
           'sourceIds': [d['billingId'] for d in documents], 'targetBillingId': documents[0]['billingId'], 'displayProjectName': 'SYN-PUBLIC-A',
           'customerName': '合成建設', 'documentDate': '2026-11-27', 'note': 'SYN-PUBLIC-NOTE', 'sourceSnapshots': documents,
           'settlementSnapshots': settlements, 'totals': totals, 'detailMode': 'unified',
           'unified': {'taxMode': '未稅', 'lines': lines, 'total': totals['untaxed'], 'target': totals['untaxed'], 'reason': '合成對外文件驗收'}}
    if profile == 'long-note-retention':
        doc['note'] += '\n' + '\n'.join(f'SYN-NOTE-{i:02d}｜合成施工條件及保留款說明必須逐項完整保留。' for i in range(1, 13))
    result = {'schema': 'kushe-external-billing-print-v1', 'document': doc}
    if historical:
        result['template'] = {'schema': 'kushe-original-billing-template-v1', 'billingId': documents[0]['billingId'], 'historicalDetails': True}
    return result


def open_external(context, server, version, data):
    bridge = context.new_page()
    bridge.goto(server.origin + '/bridge.html')
    ticket = str(uuid.uuid4())
    bridge.evaluate('''({ticket,payload})=>{window.__payload=payload;window.__wire=new BroadcastChannel('kushe-external-print-'+ticket);__wire.onmessage=e=>{if(e.data?.type==='KUSHE_PRINT_GET'&&e.data.ticket===ticket)__wire.postMessage({type:'KUSHE_PRINT_DATA',ticket,serialized:JSON.stringify(__payload)})}}''', {'ticket': ticket, 'payload': data})
    page = context.new_page()
    page.goto(server.origin + '/' + version + '/external-billing-print.html?ksprint=' + ticket)
    page.wait_for_url('**/billing-print.html?**')
    return page, bridge


def context_for(browser, server, report, name, extra=''):
    context = browser.new_context(viewport={'width': 1380, 'height': 1000}, service_workers='block')
    restrict(context, server, report, name)
    context.add_init_script(PROBE + extra)
    return context


def check_document(browser, server, report, version, count, fractional, historical=False, profile='standard'):
    name = f'{version}-dense-{count}-' + ('fractional' if fractional else 'integer') + ('-historical' if historical else '') + ('' if profile == 'standard' else '-' + profile)
    data = payload(count, fractional, historical, profile)
    adaptive = version == 'after' and 26 <= count <= 50
    context = context_for(browser, server, report, name)
    try:
        page, bridge = open_external(context, server, version, data)
        page.wait_for_function('window.__billingPrintReady===true')
        view = page.evaluate('()=>d')
        report.check(name + ': actual one-time producer preserves all outward rows and saved totals', len(view['lines']) == count and view['salesAmount'] == data['document']['totals']['untaxed'])
        forbidden = ['SYN-PRIVATE-B-PROJECT', 'SYN-PRIVATE-INVOICE-', 'SYN-PRIVATE-SOURCE-', '2026-08-18']
        report.check(name + ': actual producer removes internal invoices and other source project', all(x not in json.dumps(view) for x in forbidden), view.get('mergedBillingProjects'))
        report.check(name + ': input payload unchanged by actual route', bridge.evaluate('()=>__payload') == data)
        if adaptive:
            layout = page.evaluate('()=>__billingDenseLayout')
            expected_mode = 'original-pages' if profile != 'standard' else 'single-page' if count == 30 else ('single-page' if layout.get('metrics', {}).get('fits') else 'original-pages')
            report.check(name + ': application prepares a measured layout before enabling print', layout['attempted'] and 'metrics' in layout and layout['mode'] == expected_mode and page.locator('iframe').count() == 0, layout)
            page.evaluate('()=>printDocument()')
            report.check(name + ': application print button uses the already prepared document', page.evaluate('()=>__printed') == 1 and page.evaluate('()=>__billingPrintReady'))
        rows = page.locator('.dense-line-table tbody tr:not(.line-total)')
        summary = page.locator('.grouped-item-summary-table tbody tr:not(.line-total)')
        report.check(name + ': every original and distinct summary row is present', rows.count() == count and summary.count() == count)
        totals = data['document']['totals']
        expected_footer = [['未稅金額', '$' + format(totals['untaxed'], ',')], ['營業稅', '$' + format(totals['tax'], ',')], ['請款金額', '$' + format(totals['grossTotal'], ',')]]
        if totals['retention']:
            expected_footer += [['保留款', '-$' + format(totals['retention'], ',')], ['本期實領／應收', '$' + format(totals['receivable'], ',')]]
        actual_footer = page.locator('.summary-row').evaluate_all('(nodes)=>nodes.map(node=>[node.querySelector("span").textContent,node.querySelector("strong").textContent])')
        report.check(name + ': every saved footer amount and label remains in its original order', actual_footer == expected_footer, actual_footer)
        for i, original in enumerate(data['document']['unified']['lines']):
            cells = rows.nth(i).locator('td').all_text_contents()
            grouped = summary.nth(i).locator('td').all_text_contents()
            expected_amount = '$' + format(original['amount'], ',')
            report.check(name + f': source row {i+1} and grouped item unchanged', cells[0] == original['house'] and cells[1] == original['item'] and grouped[0] == original['item'] and cells[5] == expected_amount and grouped[4] == expected_amount)
            if version == 'after' and fractional:
                decimal = lambda value: format(value, ',.4f').rstrip('0').rstrip('.')
                report.check(name + f': row {i+1} retains four-decimal quantity and price', cells[3] == decimal(original['qty']) and cells[4] == '$' + decimal(original['price']) and grouped[2] == decimal(original['qty']) and grouped[3] == '$' + decimal(original['price']), {'row': cells, 'summary': grouped})
        if version == 'before' and fractional:
            report.check(name + ': published baseline reproduces lost precision', rows.first.locator('td').nth(3).inner_text() == '1.23' and rows.first.locator('td').nth(4).inner_text() == '$12')
        page.screenshot(path=str(report.qa / (name + '.png')), full_page=True)
        page.emulate_media(media='print')
        print_geometry = page.evaluate('''()=>Object.fromEntries(['#paper','.dense-original-details','.grouped-item-summary','.summary','.sign'].map(selector=>{const node=document.querySelector(selector),r=node?.getBoundingClientRect();return [selector,r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}:null]}))''')
        print_geometry['fonts'] = page.evaluate('()=>({detail:getComputedStyle(document.querySelector(".dense-line-table td")).fontSize,summary:getComputedStyle(document.querySelector(".grouped-item-summary-table td")).fontSize})')
        if adaptive:
            print_geometry['actualPrintMetrics'] = page.evaluate('()=>denseBillingGeometry(paper)')
        report.save(name + '-print-geometry.json', print_geometry)
        pages, pdf_text, boxes = artifact_pdf(page, report.qa / (name + '.pdf'))
        compact_text = text_key(pdf_text)
        complete_text = all(compact_text.count(text_key(l['item'])) == 2 and len(re.findall(re.escape(l['house']) + r'(?!\d)', pdf_text)) == 1 for l in view['lines'])
        report.check(name + ': real PDF is A4 and retains every original and summary item', all(594 <= w <= 596 and 841 <= h <= 843 for w, h in boxes) and complete_text)
        report.check(name + ': PDF has no private invoice or source-area text', all(x not in pdf_text for x in forbidden))
        report.check(name + ': full public note and both signature labels remain in the PDF', text_key(data['document']['note']) in compact_text and '客戶簽章' in compact_text and '公司大小章' in compact_text)
        image_paints = pdf_image_paints(report.qa / (name + '.pdf'))
        report.check(name + ': PDF actually paints logo and company seal', sum(image_paints) >= 2, image_paints)
        if version == 'after' and fractional:
            expected_qty = decimal(view['lines'][0]['qty'])
            expected_price = decimal(view['lines'][0]['price'])
            report.check(name + ': PDF includes exact decimal values', expected_qty in compact_text and expected_price in compact_text)
        if adaptive:
            layout = page.evaluate('()=>__billingDenseLayout')
            report.check(name + ': actual PDF mode matches final geometry and complete content', (pages == 1 and layout['metrics']['fits'] and print_geometry['actualPrintMetrics']['fits'] if layout['mode'] == 'single-page' else not layout['metrics']['fits']) and (pages == 1 if profile == 'standard' and count == 30 else pages > 1 if profile != 'standard' else True), {'pages': pages, 'layout': layout, 'actualPrintMetrics': print_geometry['actualPrintMetrics']})
            if layout['mode'] == 'original-pages':
                report.check(name + ': failed fit restores the complete original structure', page.locator('.k29-summary-columns,.k29-billing-footer,.k29-dense-single').count() == 0 and page.locator('.grouped-item-summary-table').count() == 1 and page.locator('.grouped-item-summary-table .line-total').count() == 1)
            report.data.setdefault('adaptiveLayouts', []).append({'count': count, 'profile': profile, 'pages': pages, 'layout': layout})
        if count == 30:
            layout = page.evaluate('()=>window.__billingDenseLayout||null')
            report.data.setdefault('capacity30x30', []).append({'version': version, 'profile': profile, 'pages': pages, 'onePage': pages == 1, 'originalRows': count, 'summaryRows': count, 'allTextPresent': bool(complete_text), 'a4PageBoxes': boxes, 'printGeometry': print_geometry, 'layout': layout})
            print('CAPACITY_30x30_PAGES=' + str(pages) + ' (' + version + '/' + profile + ')', flush=True)
        report.check(name + ': print page performs no storage writes and retains payload', page.evaluate('()=>__writes') == [] and page.evaluate('()=>d') == view)
        report.data['cases'].append(name)
    finally:
        context.close()


def capacity_error(browser, server, report):
    name = 'after-over-50-clear-error'
    data = payload(51, False)
    context = context_for(browser, server, report, name)
    try:
        page, bridge = open_external(context, server, 'after', data)
        notice = page.locator('#billingValidationError')
        notice.wait_for()
        text = notice.inner_text()
        report.check(name + ': visible reason identifies actual count and unchanged limit', '51' in text and '50' in text and '原始請款資料未變更' in text and notice.get_attribute('role') == 'alert', text)
        page.evaluate('()=>printDocument()')
        report.check(name + ': neither automatic nor manual printing bypasses limit', page.locator('#safePrintButton').is_disabled() and page.evaluate('()=>[__billingPrintReady,__printed]') == [False, 0])
        report.check(name + ': all 51 source rows remain in payload and no writes occur', len(page.evaluate('()=>d.lines')) == 51 and bridge.evaluate('()=>__payload') == data and page.evaluate('()=>__writes') == [])
        page.screenshot(path=str(report.qa / (name + '.png')), full_page=True)
        report.data['cases'].append(name)
    finally:
        context.close()


def bundle_document():
    row = {'projectName': 'SYN-BUNDLE-A', 'number': 'SYN-BUNDLE-NO-A', 'date': '2026-11-27', 'taxMode': '未稅', 'invoiceStatus': 'invoice_pending',
           'lines': [{'house': 'A1', 'item': 'SYN-BUNDLE-WORK', 'unit': '式', 'qty': 2, 'price': 100, 'amount': 200}],
           'salesAmount': 200, 'taxAmount': 10, 'totalAmount': 210, 'retentionAmount': 0, 'receivableAmount': 210}
    return {'schema': 'kushe-combined-billing-v1', 'customer': '合成建設', 'company': {'name': '合成企業', 'englishName': 'Synthetic Only'},
            'billings': [row], 'projects': [row['projectName']], 'dateStart': row['date'], 'dateEnd': row['date'], 'taxMode': '未稅', 'invoiceStatus': 'invoice_pending',
            'totals': {k: row[k] for k in ('salesAmount', 'taxAmount', 'totalAmount', 'retentionAmount', 'receivableAmount')}}


def bundle_case(browser, server, report, scenario, version='after'):
    name = version + '-bundle-' + scenario
    slow = "const oldDecode=HTMLImageElement.prototype.decode;let release;window.__assetGate=new Promise(r=>release=r);window.__releaseAssetDecode=()=>release();HTMLImageElement.prototype.decode=async function(){window.__decodeWaiting=true;await __assetGate;return oldDecode.call(this)};" if scenario == 'slow' else ''
    context = context_for(browser, server, report, name, slow)
    data = bundle_document()
    try:
        if scenario == 'http-failure':
            context.route('**/enterprise/index.html', lambda route: route.fulfill(status=503, body='synthetic unavailable'))
        elif scenario == 'corrupt':
            invalid = "const companyLogoAsset='data:image/png;base64," + ('x' * 1800) + "';\nconst companySealAsset='data:image/png;base64," + ('x' * 1800) + "';\n"
            context.route('**/enterprise/index.html', lambda route: route.fulfill(status=200, body=invalid))
        page = context.new_page()
        encoded = quote(base64.b64encode(json.dumps(data, ensure_ascii=False).encode()).decode(), safe='')
        page.goto(server.origin + '/' + version + '/billing-bundle-print.html?print=1#' + encoded)
        if scenario == 'slow':
            page.wait_for_function('window.__decodeWaiting===true')
            page.evaluate('()=>printDocument()')
            report.check(name + ': actual image decode delay prevents both print routes', page.evaluate('()=>[__printed,__billingBundlePrintReady]') == [0, False] and page.locator('#safePrintButton').is_disabled())
            page.evaluate('()=>__releaseAssetDecode()')
        if scenario in ('success', 'slow'):
            page.wait_for_function('window.__billingBundlePrintReady===true && window.__printed===1')
            report.check(name + ': logo and seal are decoded before auto-print', page.evaluate('()=>[...document.querySelectorAll("#formalCompanyLogo,#formalCompanySeal")].every(i=>i.complete&&i.naturalWidth>0&&i.naturalHeight>0)'))
            if version == 'after':
                page.evaluate('()=>printDocument()')
                report.check(name + ': manual print uses the same ready gate', page.evaluate('()=>__printed') == 2)
            page.screenshot(path=str(report.qa / (name + '.png')), full_page=True)
            pages, text, _ = artifact_pdf(page, report.qa / (name + '.pdf'))
            fields = bundle_pdf_fields(text)
            report.check(name + ': PDF retains exact original bundle markers and complete currency tokens', fields == BUNDLE_PDF_EXPECTED, {'pages': pages, 'fields': fields})
        else:
            page.locator('#sealLoadError').wait_for()
            page.evaluate('()=>printDocument()')
            report.check(name + ': failure is clear and no PDF is printed', page.locator('#safePrintButton').is_disabled() and page.evaluate('()=>[__printed,__billingBundlePrintReady,__billingBundlePrintError]') == [0, False, 'COMPANY_IMAGES_NOT_READY'])
            page.screenshot(path=str(report.qa / (name + '.png')), full_page=True)
        report.check(name + ': payload and storage unchanged', page.evaluate('()=>data') == data and page.evaluate('()=>__writes') == [])
        report.data['cases'].append(name)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    report = Report(args.output.resolve(), 'k29-real-pdf-acceptance-v1')
    resources = {'/bridge.html': (b'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><p>Synthetic print sender</p>', 'text/html'),
                 '/favicon.ico': (b'', 'image/x-icon')}
    try:
        for version in ('before', 'after'):
            for path in FILES:
                raw = source(args.root, path, version)
                resources['/' + version + '/' + path] = (raw, 'text/html; charset=utf-8' if path.endswith('.html') else 'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8')
                report.data.setdefault('sources', {})[version + '/' + path] = sha(raw)
            resources['/' + version + '/enterprise/index.html'] = (synthetic_assets(), 'text/html')
        with Server(resources) as server, sync_playwright() as playwright:
            browser = playwright.chromium.launch(**browser_options(args.browser))
            try:
                for version in ('before', 'after'):
                    check_document(browser, server, report, version, 13, True)
                    check_document(browser, server, report, version, 30, False)
                    bundle_case(browser, server, report, 'success', version)
                check_document(browser, server, report, 'after', 13, True, historical=True)
                for profile in ('long-chinese', 'large-decimals', 'long-note-retention'):
                    check_document(browser, server, report, 'after', 30, profile == 'large-decimals', profile=profile)
                for count in (26, 31, 50):
                    check_document(browser, server, report, 'after', count, False)
                standard = [item for item in report.data['capacity30x30'] if item['profile'] == 'standard']
                report.check('standard 30x30 keeps the published detail and summary font sizes', len(standard) == 2 and standard[0]['printGeometry']['fonts'] == standard[1]['printGeometry']['fonts'], [item['printGeometry']['fonts'] for item in standard])
                capacity_error(browser, server, report)
                for scenario in ('http-failure', 'corrupt', 'slow'):
                    bundle_case(browser, server, report, scenario)
                report.check('all requests stay on exact owned loopback assets', not report.data['externalRequests'], report.data['externalRequests'])
                report.check('no uncaught browser errors', not report.data['pageErrors'], report.data['pageErrors'])
                report.data['status'] = 'PASS'
            finally:
                browser.close()
    except Exception as error:
        report.data['status'] = 'BLOCKED' if 'Executable doesn' in str(error) or 'browserType.launch' in str(error) else 'FAIL'
        report.data['failure'] = {'message': str(error), 'traceback': traceback.format_exc()}
    finally:
        report.flush()
    print(json.dumps({'status': report.data['status'], 'checks': report.data['passCount'], 'output': str(report.output)}, ensure_ascii=False))
    return 0 if report.data['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
