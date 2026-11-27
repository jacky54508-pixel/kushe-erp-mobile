"""Constrain K27 export-only changes to the audited K26 release.

The baseline is the exact main revision inspected in ROUTE_AUDIT.json.
This guard verifies source scope and unchanged financial code; browser/PDF
behavior is established separately by test_quote_export_route.py.
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

BASE = '4c02e3c707473c4483946afd5222c7cf05d8fb63'
BASE_TREE = '642d1178c415c0a415c03c8475fd28e627f45701'
BRANCH = 'p41-k27-client-date-20261127'
VERSION = 'p41-k27-quote-export-20261127-4'
PRODUCT = {
    'index.html',
    'billing-print.html',
    'assets/js/billing-print.js',
    'assets/js/quotations.js',
    'assets/js/p41-quote-pagination.js',
}
TESTS = {
    '.p41-k27-tests/source_guard.py',
    '.p41-k27-tests/test_backup_projection.cjs',
    '.p41-k27-tests/test_quote_export_route.py',
}
WORKFLOW = '.github/workflows/p41-k27-quote-export-route.yml'
ALLOWED = PRODUCT | TESTS | {WORKFLOW}
PRESERVED = {
    'assets/js/erp-store.js',
    'assets/js/cloud-sync.js',
    'assets/js/commissions.js',
    'assets/js/payroll.js',
    'assets/js/banks.js',
    'assets/js/billing.js',
    'assets/css/p41-quote-pagination.css',
}
STORE_SHA256 = '6689c5cd746bc9360d54fcf7e7bbe3a4af4dacdd76a108263b9540fbd85b758b'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify_quotation_ui_scope(before, after):
    block = re.compile(r'^  // K27 quotation export integrity start\.\n.*?'
                       r'^  // K27 quotation export integrity end\.\n', re.M | re.S)
    assert len(block.findall(after)) == 1, 'expected exactly one export-integrity helper block'
    normalized = block.sub('', after)
    replacements = [
        ("$('#exportQuotation',node).onclick=()=>exportQuotation(source,true,node);",
         "$('#exportQuotation',node).onclick=()=>window.KusheQuotationPrint?.export(source);"),
        ("$('#printQuotation',node).onclick=()=>exportQuotation(source,false,node);",
         "$('#printQuotation',node).onclick=()=>window.KusheQuotationPrint?.print(source);"),
    ]
    for new, old in replacements:
        assert normalized.count(new) == 1, 'unexpected quotation handler change'
        normalized = normalized.replace(new, old, 1)
    assert normalized == before, 'quotation edits outside the export helpers and two button handlers'
    assert VERSION in block.search(after).group(), 'quotation loader must request the current producer'


def verify_quotation_date_scope(before, after):
    block = re.compile(r'^  // K27 quotation date presentation start\.\n.*?'
                       r'^  // K27 quotation date presentation end\.\n\n', re.M | re.S)
    assert len(block.findall(after)) == 1, 'expected exactly one date-formatting helper'
    normalized = block.sub('', after)
    replacements = [
        ('async function build({ paper, noteText, quotationDate })',
         'async function build({ paper, noteText })'),
        ("date.textContent = quotationSignatureDate(node.classList.contains('company-seals') ? quotationDate : '');",
         "date.textContent = '簽署日期：　　年　　月　　日';"),
        ('finished.set(paper, { noteText: rawNote, quotationDate, result });',
         'finished.set(paper, { noteText: rawNote, result });'),
        ("    const quotationDate = String(options.quotationDate ?? '').trim();\n", ''),
        ('prior.noteText !== noteText || prior.quotationDate !== quotationDate',
         'prior.noteText !== noteText'),
        ('build({ paper, noteText, quotationDate }).finally',
         'build({ paper, noteText }).finally'),
    ]
    for new, old in replacements:
        assert normalized.count(new) == 1, 'unexpected quotation date-adapter change'
        normalized = normalized.replace(new, old, 1)
    assert normalized == before, 'pagination algorithm changed outside the signature-date adapter'


def main():
    root = Path(__file__).resolve().parents[1]

    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])

    subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    assert git('rev-parse', BASE + '^{tree}').decode().strip() == BASE_TREE, 'unexpected baseline tree'
    candidate = git('rev-parse', 'HEAD').decode().strip()
    changed = set(git('diff', '--name-only', '--no-renames', BASE, 'HEAD').decode().splitlines())
    assert changed == ALLOWED, {
        'unexpected': sorted(changed - ALLOWED),
        'missing': sorted(ALLOWED - changed),
    }
    branch = os.environ.get('GITHUB_REF_NAME', '')
    if branch:
        assert branch == BRANCH, 'test workflow must run on the isolated K27 branch: ' + branch

    before = git('show', BASE + ':index.html').decode()
    after = (root / 'index.html').read_text(encoding='utf-8')
    script = re.compile(r"""(<script\b[^>]*\bsrc=["']assets/js/(?:billing-print|quotations)\.js\?v=)[^"']+""")
    assert len(script.findall(before)) == len(script.findall(after)) == 2, 'expected producer and quotation UI scripts'
    assert script.sub(r'\1CACHE_VERSION', before) == script.sub(r'\1CACHE_VERSION', after), 'index.html contains a non-cache edit'
    assert all(match.group(0).endswith(VERSION) for match in script.finditer(after)), 'index.html has a wrong quotation export version'
    producer = (root / 'assets/js/billing-print.js').read_text(encoding='utf-8')
    assert VERSION in producer, 'quotation navigation must use the matching print page version'
    verify_quotation_ui_scope(git('show', BASE + ':assets/js/quotations.js').decode(),
                              (root / 'assets/js/quotations.js').read_text(encoding='utf-8'))
    verify_quotation_date_scope(git('show', BASE + ':assets/js/p41-quote-pagination.js').decode(),
                                (root / 'assets/js/p41-quote-pagination.js').read_text(encoding='utf-8'))
    renderer = (root / 'billing-print.html').read_text(encoding='utf-8')
    assert f'assets/js/p41-quote-pagination.js?v={VERSION}' in renderer
    assert "paginate({paper,noteText:String(d.publicNote||''),quotationDate:d.date})" in renderer

    preserved = []
    for path in sorted(PRESERVED):
        old = git('show', BASE + ':' + path)
        committed = git('show', 'HEAD:' + path)
        disk = (root / path).read_bytes()
        assert old == committed == disk, 'protected source changed: ' + path
        preserved.append({'path': path, 'sha256': digest(disk), 'bytes': len(disk)})
    assert digest((root / 'assets/js/erp-store.js').read_bytes()) == STORE_SHA256, 'financial Store differs from the accepted release'

    files = []
    for path in sorted(changed):
        disk = (root / path).read_bytes()
        assert disk == git('show', 'HEAD:' + path), 'test checkout differs from candidate: ' + path
        mode = git('ls-tree', 'HEAD', '--', path).decode().split()[0]
        assert mode == '100644', 'unexpected file mode: ' + path + ' ' + mode
        files.append({'path': path, 'sha256': digest(disk), 'bytes': len(disk)})

    print(json.dumps({
        'status': 'K27_PRINT_ONLY_SOURCE_SCOPE_VERIFIED',
        'baseCommit': BASE,
        'baseTree': BASE_TREE,
        'candidateCommit': candidate,
        'changedFiles': files,
        'preservedFiles': preserved,
        'financialCoreChanges': False,
        'quotationEditorSaveChanges': False,
        'quotationExportEntryChanges': True,
        'paginationLayoutAlgorithmChanges': False,
        'quotationSignatureDateAdapterChanges': True,
        'quotationDateSource': 'company only: saved public quotation date; no system-clock fallback',
        'customerSignatureDateSource': 'blank year/month/day for manual signing',
        'indexChange': 'billing-print.js and quotations.js cache queries only',
        'quotationUiScope': 'one integrity helper block plus the existing export and print button handlers',
        'sourceAudit': {
            'ref': BASE,
            'finding': 'billing-print.js is the sole quotation print bridge; quotations.js is the sole caller',
            'limitation': 'source audit does not establish which version ran on the user device',
        },
        'behaviorEvidenceRequired': [
            'Node exact-history-ID backup mapping and unchanged numeric/private-field projection',
            'actual quotation detail button to print=1 navigation, decoded payload, settled page and PDF',
            'accepted contract layout and unchanged billing helpers',
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
