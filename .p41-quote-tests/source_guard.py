"""Read-only scope gate for the isolated quotation print candidate."""
import json
import os
import subprocess
from pathlib import Path

BASE = 'edf1c1886aac09958caa9e4b304502cca44f6937'
BRANCH = 'p41-quote-pagination-20261124'
EXACT = {'billing-print.html', 'assets/js/p41-quote-pagination.js',
         'assets/css/p41-quote-pagination.css', '.github/workflows/p41-quote-pagination.yml'}


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def main():
    out = Path('artifacts/p41-quote-pagination')
    out.mkdir(parents=True, exist_ok=True)
    result = {'status': 'BLOCKED', 'expectedBase': BASE, 'deploymentAuthorized': False,
              'productionDataTouched': False, 'publishGate': 'BLOCKED'}
    try:
        branch = os.environ.get('P41_BRANCH_CONTEXT') or git('branch', '--show-current')
        assert branch == BRANCH, f'Unsupported branch: {branch}'
        result['candidateCommit'] = git('rev-parse', 'HEAD')
        result['observedMain'] = git('rev-parse', 'origin/main')
        assert result['observedMain'] == BASE, 'Main changed: rebase/review the print candidate first'
        assert git('merge-base', BASE, 'HEAD') == BASE, 'Pinned main is not an ancestor'
        changed = git('diff', '--name-only', BASE + '...HEAD').splitlines()
        result['changedFiles'] = changed
        assert changed, 'Empty candidate'
        forbidden = [p for p in changed if p not in EXACT and not p.startswith('.p41-quote-tests/')]
        assert not forbidden, f'Out-of-scope changes: {forbidden}'
        result['status'] = 'PRINT_ONLY_SOURCE_SCOPE_VERIFIED'
    except Exception as error:
        result['failure'] = str(error)
        raise
    finally:
        (out / 'source-scope.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
