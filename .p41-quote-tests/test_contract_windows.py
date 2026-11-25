"""Targeted native-Windows contract pagination checks; synthetic and isolated.

Reuses all DOM/source/font-size/overflow assertions. Windows PDF checks cover
page count, A4 boxes and CJK text presence; exact per-page PDF text verification
remains in the full Linux/Poppler job. Actual PDF files are retained for review.
"""
import argparse
import importlib.util
import json
import platform
import re
import subprocess
import sys
import traceback
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/p41-contract-windows'))
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    spec = importlib.util.spec_from_file_location('accepted_contract_checks', root / '.p41-quote-tests/test_quotation_pagination.py')
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)
    report = checks.Reporter(output)
    report.result.update(schema='p41-native-windows-contract-spacing-v1', platform=platform.platform(),
                         platformFonts=[], pdfTextScope='Exact DOM/source; PDF A4 boxes, page count and CJK presence. Full PDF text gate runs on Linux.')
    original_ready = checks.ready

    def ready_with_font_evidence(page):
        original_ready(page)
        session = page.context.new_cdp_session(page)
        samples = []
        try:
            session.send('DOM.enable')
            session.send('CSS.enable')
            document = session.send('DOM.getDocument', {'depth': 0})['root']['nodeId']
            for selector in ['#paper .detail td.item', '#paper .p41-quote-note-line', '#paper .p41-quote-clause-heading']:
                node = session.send('DOM.querySelector', {'nodeId': document, 'selector': selector})['nodeId']
                if node:
                    fonts = session.send('CSS.getPlatformFontsForNode', {'nodeId': node})['fonts']
                    samples.append({'selector': selector, 'fonts': fonts})
            evidence = {'path': page.url.split('#', 1)[0], 'samples': samples,
                        'PMingLiUObserved': any('pmingliu' in (font.get('familyName', '') + font.get('postScriptName', '')).lower()
                                               for item in samples for font in item['fonts'])}
            report.result['platformFonts'].append(evidence)
            cjk_fonts = [font for item in samples if item['selector'].endswith('p41-quote-clause-heading')
                         for font in item['fonts'] if font.get('glyphCount', 0) > 0 and not font.get('isCustomFont') and
                         re.search(r'ming|jheng|yahei|simsun|dengxian|kaiti|meiryo|gothic|mincho|malgun|batang|gulim|cjk|arial unicode',
                                   font.get('familyName', '') + font.get('postScriptName', ''), re.I)]
            report.check('native Windows CJK glyphs use an observed platform font', bool(cjk_fonts), evidence)
        finally:
            session.detach()

    def windows_pdf(report, name, page, metrics, output, minimum_pages=1, maximum_pages=None):
        data = page.pdf(format='A4', print_background=True, prefer_css_page_size=True,
                        margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
        (output / (name + '.pdf')).write_bytes(data)
        reader = checks.PdfReader(checks.BytesIO(data))
        count = len(reader.pages)
        report.check(name + ': Windows PDF page count matches complete visible pages',
                     count == len(metrics['pages']) and count >= minimum_pages and (maximum_pages is None or count <= maximum_pages),
                     {'pdfPages': count, 'visiblePages': len(metrics['pages']), 'minimum': minimum_pages, 'maximum': maximum_pages})
        texts = []
        for index, sheet in enumerate(reader.pages, 1):
            width, height = float(sheet.mediabox.width), float(sheet.mediabox.height)
            report.check(f'{name}: Windows PDF page {index} is portrait A4', 594 <= width <= 596 and 841 <= height <= 843, [width, height])
            text = sheet.extract_text() or ''
            texts.append(text)
            han = sum('\u3400' <= char <= '\u9fff' or '\u2e80' <= char <= '\u2fff' for char in text)
            report.check(f'{name}: Windows PDF page {index} contains painted CJK text', han > 0, {'extractedCjkCharacters': han})
        (output / (name + '-pypdf-diagnostic-text.txt')).write_text('\n\f\n'.join(texts), encoding='utf-8')
        return count

    checks.ready = ready_with_font_evidence
    checks.check_pdf = windows_pdf
    try:
        report.check('targeted acceptance runs on native Windows', sys.platform == 'win32', platform.platform())
        report.result['candidateCommit'] = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        with checks.FixtureServer(root, output) as server, checks.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                operations = [
                    ('baseline-all-backup11', lambda: checks.baseline_spacing_reproduction(browser, server, report, constrained=False)),
                    ('baseline-constrained-scope', lambda: checks.baseline_spacing_reproduction(browser, server, report, constrained=True)),
                    ('windows-all-backup11', lambda: checks.quote_case(browser, server, report, 'windows-all-backup11', checks.spacing_document(),
                                                                    minimum_pages=2, maximum_pages=2, spacing_check=True)),
                    ('windows-constrained-scope', lambda: checks.quote_case(browser, server, report, 'windows-constrained-scope', checks.spacing_document(True),
                                                                         minimum_pages=2, spacing_check=True, require_shared=True)),
                ]
                for name, operation in operations:
                    checks.independent_case(report, name, operation)
                report.check('Windows fixtures make no external requests or unexpected asset reads',
                             not report.result['externalRequests'] and not server.unknown,
                             {'external': report.result['externalRequests'], 'unknown': server.unknown})
            finally:
                browser.close()
        if report.result['caseFailures']:
            raise AssertionError('Windows cases failed: ' + ', '.join(item['case'] for item in report.result['caseFailures']))
        report.result['status'] = 'NATIVE_WINDOWS_CONTRACT_SPACING_VERIFIED'
        print('NATIVE_WINDOWS_CONTRACT_SPACING_VERIFIED__PUBLISH_BLOCKED', flush=True)
    except Exception as error:
        report.result['status'] = 'BLOCKED'
        report.result['completionFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
        if report.result['failure'] is None:
            report.result['failure'] = report.result['completionFailure']
        raise
    finally:
        (output / 'WINDOWS_PLATFORM_FONTS.json').write_text(json.dumps(report.result['platformFonts'], indent=2), encoding='utf-8')
        report.flush()


if __name__ == '__main__':
    main()
