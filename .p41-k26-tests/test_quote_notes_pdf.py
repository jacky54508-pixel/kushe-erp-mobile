"""K26: real quotation projection and PDF notes, with fresh synthetic browsers.

The accepted quotation layout/source assertions are reused unchanged for the
existing contract cases. New cases exercise billing-print.js before opening the
actual renderer; no ERP page, actual Store, account or business record is used.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import platform
import re
import subprocess
import sys
import traceback
from pathlib import Path

BASE = '668334605342e5766027c3f73b4fe1b29036dec0'
PRIVATE = ['INTERNAL-QUOTE-672839', 'INTERNAL-LINE-928137', 'PRIVATE-LINE-562983']
SHORT_NOTE = ('DOC-NOTE-3187 本報價為合成版面示例，施工範圍依各品項說明。\n'
              'DOC-PAY-5612 虛構付款條件需依雙方另行確認。\n'
              'DOC-END-7291 特殊品項依合成現場條件另行報價。')
FLOW_NOTE = '\n\n'.join([
    f'FLOW-{i:02d} 虛構對外說明需按原文呈現，段落先使用施工明細之後的可用空間；最後一段與簽章保留在同一頁。'
    for i in range(1, 5)])


def load_checks(root):
    spec = importlib.util.spec_from_file_location('accepted_k26_quote_checks', root / '.p41-quote-tests/test_quotation_pagination.py')
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)
    checks.BASE = BASE
    return checks


def fixture(count=6, mode='actual', rich=True, sample=False, note=SHORT_NOTE):
    rows = []
    for i in range(count):
        actual = mode == 'actual' or mode == 'mixed' and i % 2 == 0
        rows.append({'id': f'SYN-LINE-{i + 1:03d}', 'house': '',
                     'item': f'SYN-{i + 1:03d} 合成門窗修繕', 'unit': '式', 'qty': 1,
                     'price': 500 + i * 100, 'lumpSumAmount': 900 + i * 100,
                     'pricingType': 'actual' if actual else 'lump_sum',
                     'note': '', 'internalNote': PRIVATE[1], 'privateNote': PRIVATE[2]})
    if rich and len(rows) >= 6:
        rows[0].update(item='SYN-PAIR 合成室內鋁窗美容', price=15000,
                       note='LINE-A-15000 不含合成拋光磚、全室地壁磚、門檻及車庫地磚。')
        rows[1].update(item='SYN-PAIR 合成室內鋁窗美容', price=21000,
                       note='LINE-B-21000 僅含合成室內鋁窗範圍。')
        rows[2].update(item='SYN-LIFT 合成電梯扇', price=500, note='備用單價')
        rows[3]['note'] = ('LINE-ESCAPE-3816 <img data-hostile="yes" src=x onerror="window.__quoteXss=true">\n'
                           'LINE-SECOND-9273 & < > " \' 原始符號與第二行保留。')
        rows[4]['note'] = '  \r\n \t  '
        rows[5].pop('note')
    if sample:
        rows[3]['note'] = 'LINE-SCOPE-4821 依合成範例現場尺寸確認施工範圍。'
        for i in [4, 5, 7]:
            if i < len(rows):
                rows[i]['note'] = '備用單價'
    amount = sum(r['price'] if r['pricingType'] == 'actual' else r['lumpSumAmount'] for r in rows)
    return {'id': 'SYNTHETIC-K26', 'number': 'SYNTHETIC-K26',
            'customerName': '合成版面示例客戶', 'projectName': '合成門窗修繕工程',
            'date': '2026-11-27', 'pricingMode': mode, 'taxMode': '未稅',
            'amount': amount, 'tax': round(amount * .05), 'total': amount + round(amount * .05),
            'publicNote': note, 'internalNote': PRIVATE[0], 'lines': rows}


def producer(checks, browser, server, report, root, record, version):
    context = checks.fresh_context(browser, server, report)
    page = context.new_page()
    try:
        page.evaluate('()=>{window.KuSheERPStore={getState:()=>({settings:{}})};}')
        for relative in ['assets/js/display-sort.js', 'assets/js/billing-print.js']:
            source = (subprocess.check_output(['git', '-C', str(root), 'show', BASE + ':' + relative]).decode()
                      if version == 'baseline' else (root / relative).read_text(encoding='utf-8'))
            page.add_script_tag(content=source)
        facts = page.evaluate('''record => {
          window.__k26Source=record;
          const before=JSON.stringify(record);
          const view=window.KusheQuotationPrint.buildExternalView(record);
          return {view,sourceUnchanged:before===JSON.stringify(record),writes:window.__p41WriteAttempts};
        }''', record)
        report.check(version + ': producer never mutates source record or writes storage',
                     facts['sourceUnchanged'] and not facts['writes'])
        return facts['view']
    finally:
        context.close()


def candidate_view(checks, browser, server, report, root, record, name):
    before = producer(checks, browser, server, report, root, record, 'baseline')
    after = producer(checks, browser, server, report, root, record, 'candidate')
    comparable = copy.deepcopy(after)
    for line in comparable['lines']:
        line.pop('note', None)
    report.check(name + ': original output order, price, quantity, amount, totals and all other fields are identical', comparable == before)
    report.check(name + ': quotation payload has no internal note fields or private sentinel values',
                 not any(s in json.dumps(after, ensure_ascii=False) for s in PRIVATE) and
                 'internalNote' not in after and all('internalNote' not in row and 'privateNote' not in row for row in after['lines']))
    expected = {(r['item'], r['price']): str(r.get('note', '')).strip() for r in record['lines']}
    report.check(name + ': every outward line note crosses the real producer boundary',
                 all(row.get('note') == expected[(row['item'], row['price'])] for row in after['lines']))
    after['fileName'] = 'SYNTHETIC-K26-' + name + '.pdf'
    (report.output / (name + '-input.json')).write_text(
        json.dumps({'syntheticOnly': True, 'record': record, 'view': after}, ensure_ascii=False, indent=2), encoding='utf-8')
    return after


def note_expectation(view, row):
    actual = view['pricingMode'] == 'actual' or view['pricingMode'] == 'mixed' and all(r['pricingType'] == 'actual' for r in view['lines'])
    note = row.get('note', '')
    suppressed_badge_duplicate = actual and row.get('isBackupPrice') and note.strip() == '備用單價'
    return '' if not note.strip() or suppressed_badge_duplicate else note


def check_item_notes(checks, report, name, page, view):
    facts = page.locator('#paper .detail tbody tr:not(.line-total)').evaluate_all('''rows=>rows.map(row=>{
      const cells=[...row.cells],item=cells[0],note=item.querySelector('.p41-quote-line-note');
      const label=item.cloneNode(true);label.querySelectorAll('.actual-note,.p41-quote-line-note').forEach(n=>n.remove());
      return {item:label.textContent, badge:[...item.querySelectorAll('.actual-note')].map(n=>n.textContent),
        note:note?.textContent??'',noteCount:item.querySelectorAll('.p41-quote-line-note').length,
        noteFontPt:note?parseFloat(getComputedStyle(note).fontSize)*72/96:null,
        whiteSpace:note?getComputedStyle(note).whiteSpace:null,
        numeric:cells.slice(1).map(c=>c.innerText),markup:note?note.querySelectorAll('*').length:0};})''')
    actual = view['pricingMode'] == 'actual' or view['pricingMode'] == 'mixed' and all(r['pricingType'] == 'actual' for r in view['lines'])
    expected = []
    for row in view['lines']:
        expected.append({'item': row['item'], 'note': note_expectation(view, row),
                         'badge': ['備用單價'] if actual and row.get('isBackupPrice') else
                                  ['實做實算'] if not actual and row['pricingType'] == 'actual' else [],
                         'numeric': [row['unit'], checks.number(row['qty']), checks.money(row['price'])] +
                                    ([] if actual else [checks.money(row['amount'])])})
    report.check(name + ': every source item, outward note, pricing badge and numeric cell occurs in original output order',
                 [{key: row[key] for key in ['item', 'note', 'badge', 'numeric']} for row in facts] == expected,
                 {'expected': expected, 'actual': facts})
    report.check(name + ': outward notes remain plain wrapped readable text with no duplicate blank blocks',
                 all(row['noteCount'] == (1 if row['note'] else 0) and row['markup'] == 0 and
                     (not row['note'] or row['noteFontPt'] >= 9.5 - .01 and row['whiteSpace'] in ['pre-wrap', 'break-spaces']) for row in facts), facts)
    text = page.locator('#paper').inner_text()
    report.check(name + ': no internal notes or injected elements are printed',
                 not any(value in text for value in PRIVATE) and
                 page.locator('#paper img[data-hostile],#paper script').count() == 0 and page.evaluate('()=>window.__quoteXss===false'))
    if actual:
        report.check(name + ': actual pricing retains four columns without a financial total',
                     all(len(row['numeric']) == 3 for row in facts) and page.locator('#paper .summary,#paper .line-total').count() == 0)
    else:
        report.check(name + ': mixed and total-price quotations retain their exact total once',
                     page.locator('#paper .summary').count() == page.locator('#paper .line-total').count() == 1 and
                     checks.money(view['salesAmount']) in page.locator('#paper .line-total').inner_text() and
                     checks.money(view['totalAmount']) in page.locator('#paper .summary').inner_text())
    checks.check_source_notes(report, name, page, view['publicNote'])
    report.check(name + ': payload remains unchanged with no storage writes', page.evaluate('()=>d') == view and not page.evaluate('()=>window.__p41WriteAttempts'))
    report.check(name + ': exactly one signature and unique original logo and seal remain',
                 page.locator('#paper .sign').count() == page.locator('#formalCompanyLogo').count() == page.locator('#formalCompanySeal').count() == 1)
    return facts


def windows_pdf(checks, report, name, page, metrics, output, minimum_pages=1, maximum_pages=None):
    pdf = page.pdf(format='A4', print_background=True, prefer_css_page_size=True,
                   margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    (output / (name + '.pdf')).write_bytes(pdf)
    reader = checks.PdfReader(checks.BytesIO(pdf))
    count = len(reader.pages)
    report.check(name + ': Windows PDF page count matches all complete visible sheets',
                 count == len(metrics['pages']) and count >= minimum_pages and (maximum_pages is None or count <= maximum_pages),
                 {'pdfPages': count, 'visiblePages': len(metrics['pages']), 'maximum': maximum_pages})
    texts = []
    for i, pdf_page in enumerate(reader.pages):
        width, height = float(pdf_page.mediabox.width), float(pdf_page.mediabox.height)
        report.check(name + f': Windows PDF page {i+1} is A4', 594 <= width <= 596 and 841 <= height <= 843)
        text = pdf_page.extract_text() or ''
        texts.append(text)
        report.check(name + f': Windows PDF page {i+1} contains painted Chinese characters',
                     sum('\u3400' <= c <= '\u9fff' or '\u2e80' <= c <= '\u2fff' for c in text) > 0)
        expected = metrics['pages'][i]
        markers = re.findall(r'(?:LINE|DOC|FLOW|SYN)[A-Z0-9-]*', '\n'.join(
            [row['cells'][0] for row in expected['rows']] + [note['text'] for note in expected['notes']]))
        report.check(name + f': Windows PDF page {i+1} paints all line and note identifiers on their visible page',
                     all(marker in checks.normalized(text) for marker in markers), markers)
    (output / (name + '-pypdf-diagnostic-text.txt')).write_text('\n\f\n'.join(texts), encoding='utf-8')
    return count


def font_evidence(checks, report, name, page):
    session = page.context.new_cdp_session(page)
    try:
        session.send('DOM.enable'); session.send('CSS.enable')
        document = session.send('DOM.getDocument', {'depth': 0})['root']['nodeId']
        samples = []
        for selector in ['#paper .detail td.item', '#paper .p41-quote-line-note', '#paper .p41-quote-note-line']:
            node = session.send('DOM.querySelector', {'nodeId': document, 'selector': selector})['nodeId']
            if node:
                samples.append({'selector': selector, 'fonts': session.send('CSS.getPlatformFontsForNode', {'nodeId': node})['fonts']})
        report.result.setdefault('platformFonts', []).append({'name': name, 'samples': samples})
        if sys.platform == 'win32':
            fonts = [font for sample in samples for font in sample['fonts'] if font.get('glyphCount', 0) > 0]
            report.check(name + ': native Windows CJK typography is observed', any(re.search(
                r'ming|jheng|yahei|simsun|dengxian|kaiti|meiryo|gothic|mincho|malgun|batang|gulim|cjk|arial unicode',
                font.get('familyName', '') + font.get('postScriptName', ''), re.I) for font in fonts), samples)
    finally:
        session.detach()


def baseline_reproduction(checks, browser, server, report, root):
    name = 'baseline-missing-line-note'
    record = fixture(sample=True, count=11)
    before = producer(checks, browser, server, report, root, record, 'baseline')
    fixed_view = candidate_view(checks, browser, server, report, root, record, name)
    report.check(name + ': released producer drops the original outward line notes',
                 all('note' not in line for line in before['lines']) and any(row.get('note') for row in record['lines']))
    context = checks.fresh_context(browser, server, report)
    page = context.new_page()
    try:
        page.goto(checks.url_for(server.origin, 'baseline', fixed_view), wait_until='load')
        checks.ready(page)
        text = page.locator('#paper').inner_text()
        report.check(name + ': released renderer also omits a supplied per-line note',
                     'LINE-A-15000' not in text and 'LINE-B-21000' not in text)
        report.check(name + ': overall outward note was present in released rendering', 'DOC-NOTE-3187' in text and 'DOC-END-7291' in text)
        page.screenshot(path=str(report.output / (name + '.png')), full_page=True)
        page.pdf(path=str(report.output / (name + '.pdf')), format='A4', print_background=True, prefer_css_page_size=True)
        report.result['baselineReproduction'] = {'producerDropsLineNotes': True, 'rendererOmitsSuppliedLineNotes': True,
                                                'overallPublicNotePresent': True, 'baseCommit': BASE}
    finally:
        context.close()


def public_case(checks, browser, server, report, root, name, record, maximum_pages=None, flow=False):
    view = candidate_view(checks, browser, server, report, root, record, name)
    context = checks.fresh_context(browser, server, report)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(checks.url_for(server.origin, 'candidate', view), wait_until='load')
        checks.ready(page)
        check_item_notes(checks, report, name, page, view)
        font_evidence(checks, report, name, page)
        desktop = page.evaluate(checks.METRICS)
        checks.check_layout(report, name + ' desktop', desktop)
        page.screenshot(path=str(report.output / (name + '-desktop.png')), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        checks.check_layout(report, name + ' mobile', page.evaluate(checks.METRICS))
        check_item_notes(checks, report, name + ' mobile', page, view)
        page.screenshot(path=str(report.output / (name + '-mobile.png')), full_page=True)
        page.set_viewport_size({'width': 1366, 'height': 950})
        page.emulate_media(media='print')
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        metrics = page.evaluate(checks.METRICS)
        checks.check_layout(report, name + ' print', metrics, printing=True)
        count = checks.check_pdf(report, name, page, metrics, report.output, maximum_pages=maximum_pages)
        signatures = page.locator(checks.PAGE).last.locator('.sign').count()
        final_notes = page.locator(checks.PAGE).last.locator(checks.NOTE).all_text_contents()
        report.check(name + ': final signature remains with meaningful overall note text', signatures == 1 and bool(''.join(final_notes).strip()))
        page_flow = checks.contract_page_flow(page)
        (report.output / (name + '-page-flow.json')).write_text(json.dumps(page_flow, indent=2), encoding='utf-8')
        if flow:
            first = page.locator(checks.PAGE).first
            report.check(name + ': generic note begins in available space after the detail table',
                         first.locator('table.detail').count() > 0 and
                         any('FLOW-' in text for text in first.locator(checks.NOTE).all_text_contents()), page_flow)
            report.check(name + ': no intermediate sheet consists only of heading or footer',
                         all(item['rows'] or item['contentHeight'] > 120 for item in page_flow), page_flow)
        if sys.platform != 'win32':
            raw = checks.normalized((report.output / (name + '-pdf-raw-text.txt')).read_text(encoding='utf-8'))
            missing = [note_expectation(view, row) for row in view['lines'] if note_expectation(view, row) and checks.normalized(note_expectation(view, row)) not in raw]
            report.check(name + ': actual PDF contains each complete outward item note', not missing, missing)
            report.check(name + ': actual PDF never contains internal note sentinels', not any(value in raw for value in PRIVATE))
        report.check(name + ': no browser error or write attempts', not errors and not page.evaluate('()=>window.__p41WriteAttempts'), errors)
        report.result['cases'].append({'name': name, 'pdfPages': count, 'inputFile': name + '-input.json',
                                      'sourceRows': len(view['lines']), 'print': metrics, 'pageFlow': page_flow})
    except Exception:
        checks.capture_failure_artifacts(page, report, name)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/p41-k26'))
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    checks = load_checks(root)
    report = checks.Reporter(output)
    report.result.update(schema='p41-k26-public-notes-and-flow-v1', platform=platform.platform(),
                         candidateCommit=subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
                         pdfTextScope='Exact Poppler full text on Linux; exact DOM, A4 boxes and per-page ASCII markers on Windows; Windows PDFs retained for independent Poppler review.')
    if sys.platform == 'win32':
        checks.check_pdf = lambda *args, **kwargs: windows_pdf(checks, *args, **kwargs)
        checks.extract_layout_pages = lambda path, count: [p.extract_text() or '' for p in checks.PdfReader(str(path)).pages]
    try:
        with checks.FixtureServer(root, output) as server, checks.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, **({} if sys.platform == 'win32' else {'channel': 'chrome'}))
            try:
                long_record = fixture(24, 'mixed', rich=False, note=SHORT_NOTE + '\n\n')
                for i, row in enumerate(long_record['lines']):
                    row['note'] = f'LINE-LONG-{i+1:03d} 合成施工範圍與限制條件必須完整顯示，品項名稱重複時仍須保留各自說明。\n此為該品項第二行，不得截斷。'
                operations = [
                    ('baseline-missing-line-note', lambda: baseline_reproduction(checks, browser, server, report, root)),
                    ('actual-public-notes', lambda: public_case(checks, browser, server, report, root, 'actual-public-notes', fixture(11, sample=True))),
                    ('actual-escaped-notes', lambda: public_case(checks, browser, server, report, root, 'actual-escaped-notes', fixture(), maximum_pages=1)),
                    ('total-price-notes', lambda: public_case(checks, browser, server, report, root, 'total-price-notes', fixture(mode='lump_sum'))),
                    ('mixed-price-notes', lambda: public_case(checks, browser, server, report, root, 'mixed-price-notes', fixture(mode='mixed'))),
                    ('generic-notes-fill-space', lambda: public_case(checks, browser, server, report, root, 'generic-notes-fill-space', fixture(20, rich=False, note=FLOW_NOTE), flow=True)),
                    ('multipage-item-notes', lambda: public_case(checks, browser, server, report, root, 'multipage-item-notes', long_record)),
                    ('accepted-contract-spacing', lambda: checks.quote_case(browser, server, report, 'accepted-contract-spacing', checks.spacing_document(), minimum_pages=2, maximum_pages=2, spacing_check=True)),
                    ('accepted-constrained-contract', lambda: checks.quote_case(browser, server, report, 'accepted-constrained-contract', checks.spacing_document(True), minimum_pages=2, spacing_check=True, require_shared=True)),
                    ('accepted-short-no-item-note', lambda: checks.quote_case(browser, server, report, 'accepted-short-no-item-note', checks.quote_document(3, 'actual', 'SYN-SHORT-001 合成短備註。'), maximum_pages=1)),
                    ('accepted-long-note-tail', lambda: checks.quote_case(browser, server, report, 'accepted-long-note-tail', checks.quote_document(3, 'actual', '**' + ('SYN-LONG-TERM 合成長段落，原文依實際版面完整接續。' * 120) + '**\n\n'), minimum_pages=2)),
                    ('unchanged-billing', lambda: checks.billing_comparison(browser, server, report)),
                    ('unchanged-merged-billing', lambda: checks.billing_comparison(browser, server, report, merged=True)),
                ]
                for name, operation in operations:
                    checks.independent_case(report, name, operation)
                report.check('all K26 browser requests stay on the synthetic loopback allowlist', not report.result['externalRequests'] and not server.unknown,
                             {'externalRequests': report.result['externalRequests'], 'unexpectedLocalAssets': server.unknown})
            finally:
                browser.close()
        if report.result['caseFailures']:
            raise AssertionError('Cases failed: ' + ', '.join(case['case'] for case in report.result['caseFailures']))
        report.result['status'] = 'K26_QUOTATION_NOTES_AND_FLOW_VERIFIED'
        print('K26_QUOTATION_NOTES_AND_FLOW_VERIFIED__PUBLISH_PENDING', flush=True)
    except Exception as error:
        report.result['status'] = 'BLOCKED'
        report.result['completionFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
        raise
    finally:
        report.flush()


if __name__ == '__main__':
    main()
