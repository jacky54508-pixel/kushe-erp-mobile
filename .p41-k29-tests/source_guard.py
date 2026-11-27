#!/usr/bin/env python3
"""Verify the K29 candidate source boundary without executing the ERP."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE = '15eff6fc574fb64480682656daf88dc7a906baa8'
VERSION = 'p41-k29-bulk-input-readiness-20261127-1'
RUNTIME = {
    'assets/js/erp-store.js', 'assets/js/commissions.js',
    'assets/js/cloud-sync.js', 'assets/js/billing.js',
    'assets/js/billing-print.js', 'assets/js/billing-bundle-print.js',
    'assets/js/external-billing-print.js', 'assets/js/billing-groups.js',
    'assets/css/receivables-scoped.css', 'billing-print.html',
    'billing-bundle-print.html', 'external-billing-print.html', 'index.html',
}
WORKFLOW = '.github/workflows/p41-k29-bulk-input-readiness.yml'
MANIFEST = '.p41-k29-tests/SOURCE_MANIFEST.json'
LEGACY = ('.p33-4-tests/', '.p34-tests/', '.p35-tests/', '.p36-tests/',
          '.p39-inv1-tests/', '.p41-k24-tests/', '.p41-k25-tests/',
          '.p41-k26-tests/', '.p41-k27-tests/', '.p41-k28-tests/',
          '.p41-quote-tests/')


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--write-manifest', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'k29-source-scope-v1', 'status': 'BLOCKED',
              'baseCommit': BASE, 'productionDataTouched': False,
              'publishGate': 'BLOCKED', 'checks': []}

    def check(label, value):
        report['checks'].append({'name': label, 'passed': bool(value)})
        if not value:
            raise AssertionError(label)

    try:
        report['headCommit'] = git(root, 'rev-parse', 'HEAD').decode().strip()
        check('reviewed formal baseline remains an ancestor',
              subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], cwd=root).returncode == 0)
        changed = set(git(root, 'diff', '--name-only', BASE).decode().splitlines())
        changed.update(git(root, 'ls-files', '--others', '--exclude-standard').decode().splitlines())
        changed.discard('')
        report['changedFiles'] = sorted(changed)
        check('all differences are reviewed runtime, candidate tests or candidate CI',
              all(p in RUNTIME or p == WORKFLOW or p.startswith('.p41-k29-tests/') for p in changed))
        check('no private backup, generated result or screenshot is included',
              all('/private/' not in p and '/artifacts/' not in p and '/internal-qa/' not in p
                  and '/__pycache__/' not in p and not p.endswith(('.pyc', '.png', '.pdf', '.zip'))
                  for p in changed))

        before = git(root, 'show', BASE + ':index.html').decode('utf-8')
        pattern = r'((?:src|href)="assets/(?:js/(?:erp-store|commissions|cloud-sync|billing|billing-print|billing-bundle-print|billing-groups)\.js|css/receivables-scoped\.css))\?v=[^\"]+(\")'
        expected, count = re.subn(pattern, lambda m: m.group(1) + '?v=' + VERSION + m.group(2), before)
        check('index changes only the eight reviewed cache references',
              count == 8 and expected == (root / 'index.html').read_text(encoding='utf-8'))

        versions = {
            'assets/js/billing-print.js': ("QUOTATION_EXPORT_VERSION:'p30-history-1'", "QUOTATION_EXPORT_VERSION:'p41-k29-print-20261127-1'"),
            'assets/js/billing-bundle-print.js': ('billing-bundle-print.html?v=p30-history-1&print=', 'billing-bundle-print.html?v=p41-k29-print-20261127-1&print='),
            'assets/js/external-billing-print.js': ('billing-print.html?v=p39-inv1-pdf1&print=0', 'billing-print.html?v=p41-k29-print-20261127-1&print=0'),
            'assets/js/billing-groups.js': ('external-billing-print.html?v=p40-16bu-memory-handoff', 'external-billing-print.html?v=p41-k29-print-20261127-1'),
            'external-billing-print.html': ('assets/js/external-billing-print.js?v=p39-inv1-pdf1', 'assets/js/external-billing-print.js?v=p41-k29-print-20261127-1'),
        }
        for name, (old, new) in versions.items():
            baseline = git(root, 'show', BASE + ':' + name).decode('utf-8')
            check(name + ' changes only its billing HTML cache version',
                  baseline.count(old) == 1 and baseline.replace(old, new) == (root / name).read_text(encoding='utf-8'))

        prior = git(root, 'ls-tree', '-r', '--name-only', BASE).decode().splitlines()
        regression_files = [p for p in prior if p.startswith(LEGACY)]
        check('existing acceptance suites retain their original bytes and assertions',
              all((root / p).read_bytes() == git(root, 'show', BASE + ':' + p) for p in regression_files))
        report['legacyFilesVerified'] = len(regression_files)
        files = {}
        names = RUNTIME | {p for p in changed if p.startswith('.p41-k29-tests/') or p == WORKFLOW}
        for name in sorted(names - {MANIFEST}):
            path = root / name
            if path.is_file():
                raw = path.read_bytes()
                files[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        report['files'] = files
        manifest_path = root / MANIFEST
        if args.write_manifest:
            manifest_path.write_text(json.dumps({'baseCommit': BASE, 'files': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        elif manifest_path.is_file():
            expected_manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            check('every tested file matches the frozen source manifest',
                  expected_manifest == {'baseCommit': BASE, 'files': files})
        else:
            check('frozen source manifest exists', False)
        report['status'] = 'K29_SOURCE_SCOPE_PASS'
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
    (output / 'SOURCE_SCOPE.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['status'] == 'K29_SOURCE_SCOPE_PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
