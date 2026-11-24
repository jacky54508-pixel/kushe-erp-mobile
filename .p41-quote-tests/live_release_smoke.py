"""Read-only smoke of the deployed print page with synthetic quote payloads.

Reuses the accepted pagination/value/PDF assertions without weakening them.
Only exact public print resources can be requested. No ERP app navigation,
business records, authenticated profile, storage writes, or deployment action.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import subprocess
import traceback
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

FORMAL_BASE = 'https://jacky54508-pixel.github.io/kushe-erp-mobile/'
RELEASE_COMMIT = 'f2f5d0b0d232e7a7ac9f948af9b643e15df948ff'
EXPECTED = {
    'billing-print.html': ('?print=0', 'ebd5ec4dcb5ac939cd9a0f7e2447d1f0094337dbf0397326cd4e4c89e78f5962'),
    'assets/js/p41-quote-pagination.js': ('?v=p41-quote-pagination-1', 'e1237bb2755b1918c7cf7f00067a18f2d347671421433841693293eb5f9c6cc5'),
    'assets/css/p41-quote-pagination.css': ('?v=p41-quote-pagination-1', 'fdca2786ec3fcb39243ecf93f5063b115139ac145682b0ab079151a3587bfd33'),
}
ALLOWED = {
    FORMAL_BASE + 'billing-print.html?print=0',
    FORMAL_BASE + 'assets/js/display-sort.js?v=20260913-p17-3-house-sort1',
    FORMAL_BASE + 'assets/js/external-billing-invoice.js?v=p39-inv1-source1',
    FORMAL_BASE + 'assets/js/p41-quote-pagination.js?v=p41-quote-pagination-1',
    FORMAL_BASE + 'assets/css/p40-16cd-mint-quotation-billing.css?v=p40-16cd-1',
    FORMAL_BASE + 'assets/css/p41-quote-pagination.css?v=p41-quote-pagination-1',
    FORMAL_BASE + 'enterprise/index.html',
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect while verifying an exact static print resource')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/p41-quote-live-release'))
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    test_path = root / '.p41-quote-tests/test_quotation_pagination.py'
    spec = importlib.util.spec_from_file_location('accepted_quote_checks', test_path)
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)
    report = checks.Reporter(output)
    for key in ('baselineCommit', 'deploymentAuthorized', 'publishGate'):
        report.result.pop(key, None)
    report.result.update(schema='p41-live-quotation-release-smoke-v1',
                         scope='Read-only verification of the deployed quotation print page',
                         targetBaseUrl=FORMAL_BASE, approvedReleaseCommit=RELEASE_COMMIT,
                         deploymentPerformedByThisWorkflow=False,
                         expectedFiles={path: digest for path, (_, digest) in EXPECTED.items()},
                         allowedGetUrls=sorted(ALLOWED), liveFileHashes=[],
                         networkRequests=[], httpErrors=[], requestFailures=[])
    report.flush()
    try:
        report.result['verificationCommit'] = subprocess.check_output(
            ['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        opener = build_opener(NoRedirect())
        for path, (query, expected) in EXPECTED.items():
            report.check('approved source SHA256: ' + path,
                         hashlib.sha256((root / path).read_bytes()).hexdigest() == expected)
            url = FORMAL_BASE + path + query
            request = Request(url, headers={'User-Agent': 'P41-Quotation-Release-Verification/1.0',
                                           'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'}, method='GET')
            with opener.open(request, timeout=30) as response:
                digest = hashlib.sha256(response.read()).hexdigest()
                evidence = {'url': url, 'status': response.status, 'sha256': digest,
                            'expectedSha256': expected, 'etag': response.headers.get('ETag')}
            report.result['liveFileHashes'].append(evidence)
            report.check('deployed SHA256: ' + path, evidence['status'] == 200 and digest == expected, evidence)
        (output / 'LIVE_FILE_HASHES.json').write_text(
            json.dumps(report.result['liveFileHashes'], indent=2), encoding='utf-8')

        def live_url(_origin, _version, document):
            assert document['documentType'] == 'quotation' and document['fileName'].startswith('SYNTHETIC-')
            payload = base64.b64encode(json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode()).decode()
            return FORMAL_BASE + 'billing-print.html?print=0#' + quote(payload, safe='')

        def restricted_context(browser, _server, _report, width=1366):
            context = browser.new_context(viewport={'width': width, 'height': 950}, device_scale_factor=1,
                                          locale='zh-TW', timezone_id='Asia/Taipei', reduced_motion='reduce',
                                          service_workers='block')
            context.add_init_script('(' + checks.WRITE_GUARDS + ')()')

            def route_request(route):
                request = route.request
                parts = urlsplit(request.url)
                url = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))
                allowed = request.method == 'GET' and url in ALLOWED
                report.result['networkRequests'].append({'method': request.method, 'url': url, 'allowed': allowed})
                if allowed:
                    route.continue_()
                else:
                    report.result['externalRequests'].append({'method': request.method, 'url': url})
                    route.abort()

            context.route('**/*', route_request)
            context.on('response', lambda response: report.result['httpErrors'].append(
                {'url': response.url, 'status': response.status}) if response.status >= 400 else None)
            context.on('requestfailed', lambda request: report.result['requestFailures'].append(
                {'url': request.url.split('#', 1)[0], 'failure': request.failure}))
            return context

        # Only the transport/context changes; accepted layout, value, font-size,
        # complete-note, row-count, A4 PDF and overflow assertions stay intact.
        checks.url_for = live_url
        checks.fresh_context = restricted_context
        server = SimpleNamespace(origin=FORMAL_BASE.rstrip('/'))
        with checks.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, channel='chrome')
            try:
                documents = [
                    ('live-actual-long11', checks.quote_document(11, 'actual', checks.long_note(), 'SYNTHETIC-LIVE-LONG11'), 2, None),
                    ('live-actual-short', checks.quote_document(3, 'actual', 'SYN-LIVE-SHORT-001 虛構短備註，原文保留。', 'SYNTHETIC-LIVE-SHORT'), 1, 1),
                    ('live-normal38', checks.quote_document(38, 'lump_sum', 'SYN-LIVE-NORMAL-73819 虛構一般報價備註完整保留。', 'SYNTHETIC-LIVE-NORMAL38'), 2, None),
                ]
                for name, document, minimum, maximum in documents:
                    checks.independent_case(report, name, lambda name=name, document=document, minimum=minimum, maximum=maximum:
                        checks.quote_case(browser, server, report, name, document, minimum, maximum))
            finally:
                browser.close()
        report.check('live requests: only exact permitted static GET resources', not report.result['externalRequests'], report.result['externalRequests'])
        report.check('live requests: no HTTP or network failures', not report.result['httpErrors'] and not report.result['requestFailures'],
                     {'httpErrors': report.result['httpErrors'], 'requestFailures': report.result['requestFailures']})
        report.check('all three live synthetic quotation cases verified', not report.result['caseFailures'] and len(report.result['cases']) == 3,
                     report.result['caseOutcomes'])
        report.result['status'] = 'LIVE_QUOTATION_A4_RELEASE_SMOKE_VERIFIED'
        print('LIVE_QUOTATION_A4_RELEASE_SMOKE_VERIFIED', flush=True)
    except Exception as error:
        report.result['status'] = 'BLOCKED'
        report.result['completionFailure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
        if report.result['failure'] is None:
            report.result['failure'] = report.result['completionFailure']
        raise
    finally:
        report.flush()


if __name__ == '__main__':
    main()
