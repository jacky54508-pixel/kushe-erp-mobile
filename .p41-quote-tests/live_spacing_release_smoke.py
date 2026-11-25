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
import re
import subprocess
import traceback
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

FORMAL_BASE = 'https://jacky54508-pixel.github.io/kushe-erp-mobile/'
RELEASE_COMMIT = '09939153538416cfdc3a532b3ec0cd2af5e19238'
EXPECTED = {
    'billing-print.html': ('?print=0', '7b49ca355584593abea1bcbbf819f02fcdff9a44d85ea99549d958ca25232a61'),
    'assets/js/p41-quote-pagination.js': ('?v=p41-quote-contract-20261125-2', '204bcb62f63995c649df066cfea454b88eef828deef7c60d81656e08c92e5f20'),
    'assets/css/p41-quote-pagination.css': ('?v=p41-quote-contract-20261125-2', 'c0136765817c341c334cb81e3aea26b742bbc936c88ab1f45f6bf259bda110a2'),
}
ALLOWED = {
    FORMAL_BASE + 'billing-print.html?print=0',
    FORMAL_BASE + 'assets/js/display-sort.js?v=20260913-p17-3-house-sort1',
    FORMAL_BASE + 'assets/js/external-billing-invoice.js?v=p39-inv1-source1',
    FORMAL_BASE + 'assets/js/p41-quote-pagination.js?v=p41-quote-contract-20261125-2',
    FORMAL_BASE + 'assets/css/p40-16cd-mint-quotation-billing.css?v=p40-16cd-1',
    FORMAL_BASE + 'assets/css/p41-quote-pagination.css?v=p41-quote-contract-20261125-2',
    FORMAL_BASE + 'enterprise/index.html',
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect while verifying an exact static print resource')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/p41-contract-spacing-live-release'))
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    test_path = root / '.p41-quote-tests/test_quotation_pagination.py'
    spec = importlib.util.spec_from_file_location('accepted_quote_checks', test_path)
    checks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checks)
    report = checks.Reporter(output)
    for key in ('baselineCommit', 'deploymentAuthorized', 'publishGate'):
        report.result.pop(key, None)
    report.result.update(schema='p41-live-contract-spacing-release-smoke-v1',
                         scope='Read-only verification of the deployed contract quotation spacing hotfix',
                         targetBaseUrl=FORMAL_BASE, approvedReleaseCommit=RELEASE_COMMIT,
                         deploymentPerformedByThisWorkflow=False,
                         expectedFiles={path: digest for path, (_, digest) in EXPECTED.items()},
                         allowedGetUrls=sorted(ALLOWED), liveFileHashes=[],
                         networkRequests=[], httpErrors=[], requestFailures=[])
    report.flush()
    try:
        report.check('approved spacing release commit is explicitly pinned before live requests',
                     re.fullmatch(r'[0-9a-f]{40}', RELEASE_COMMIT) is not None,
                     {'releaseCommit': RELEASE_COMMIT})
        subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', RELEASE_COMMIT, 'HEAD'], check=True)
        report.result['verificationCommit'] = subprocess.check_output(
            ['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        opener = build_opener(NoRedirect())
        for path, (query, expected) in EXPECTED.items():
            report.check('approved source SHA256: ' + path,
                         hashlib.sha256((root / path).read_bytes()).hexdigest() == expected)
            url = FORMAL_BASE + path + query
            request = Request(url, headers={'User-Agent': 'P41-Contract-Spacing-Release-Verification/1.0',
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

        # Reuse the accepted spacing regression plus the common layout, value,
        # font-size, complete-note, row-count, A4 PDF and overflow assertions.
        # The prior contract_structure fixture hardcodes its old scope text;
        # spacing_check validates this production-shaped synthetic scope instead.
        checks.url_for = live_url
        checks.fresh_context = restricted_context
        server = SimpleNamespace(origin=FORMAL_BASE.rstrip('/'))
        with checks.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, channel='chrome')
            try:
                # Reuse the accepted regression shape: seven synthetic clauses,
                # 110-character synthetic scope and a backup label on all 11 rows.
                # check_values also checks unnumbered presentation headings.
                contract_document = checks.spacing_document()
                contract_document['fileName'] = 'SYNTHETIC-LIVE-CONTRACT-SPACING-SEVEN'
                report.check('live primary fixture has eleven actual rows with eleven backup labels',
                             len(contract_document['lines']) == 11 and
                             all(row.get('isBackupPrice') is True and row.get('pricingType') == 'actual'
                                 for row in contract_document['lines']))
                documents = [
                    ('live-contract-all-backup11', contract_document, 2, 2, None, True),
                    ('live-actual-short', checks.quote_document(3, 'actual', 'SYN-LIVE-SHORT-001 虛構短備註，原文保留。', 'SYNTHETIC-LIVE-SHORT'), 1, 1, False, False),
                    ('live-normal38', checks.quote_document(38, 'lump_sum', 'SYN-LIVE-NORMAL-73819 虛構一般報價備註完整保留。', 'SYNTHETIC-LIVE-NORMAL38'), 2, None, False, False),
                ]
                for name, document, minimum, maximum, contract, spacing in documents:
                    checks.independent_case(report, name, lambda name=name, document=document, minimum=minimum, maximum=maximum, contract=contract, spacing=spacing:
                        checks.quote_case(browser, server, report, name, document, minimum, maximum,
                                          contract_structure=contract, spacing_check=spacing))
            finally:
                browser.close()
        report.check('live requests: only exact permitted static GET resources', not report.result['externalRequests'], report.result['externalRequests'])
        report.check('live requests: no HTTP or network failures', not report.result['httpErrors'] and not report.result['requestFailures'],
                     {'httpErrors': report.result['httpErrors'], 'requestFailures': report.result['requestFailures']})
        report.check('all three live synthetic quotation cases verified', not report.result['caseFailures'] and len(report.result['cases']) == 3,
                     report.result['caseOutcomes'])
        report.result['status'] = 'LIVE_CONTRACT_SPACING_A4_RELEASE_SMOKE_VERIFIED'
        print('LIVE_CONTRACT_SPACING_A4_RELEASE_SMOKE_VERIFIED', flush=True)
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
