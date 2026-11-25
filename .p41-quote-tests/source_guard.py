"""Read-only scope gate for the isolated quotation print candidate."""
import json
import os
import subprocess
from pathlib import Path

BASE = '49edb30257707a786329d19207b92fec951d3906'
BRANCH = 'p41-quote-contract-spacing-20261125'
EXACT = {'billing-print.html', 'assets/js/p41-quote-pagination.js',
         'assets/css/p41-quote-pagination.css', '.github/workflows/p41-quote-pagination.yml',
         '.p41-quote-tests/source_guard.py', '.p41-quote-tests/test_quotation_pagination.py',
         '.p41-quote-tests/build_offline_quote.py', '.p41-quote-tests/ISSUE_RECORD.md',
         '.p41-quote-tests/test_contract_windows.py'}


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
        forbidden = [p for p in changed if p not in EXACT]
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
