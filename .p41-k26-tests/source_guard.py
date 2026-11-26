"""Pin the quotation-only candidate to its accepted release before browser tests."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

BASE = '668334605342e5766027c3f73b4fe1b29036dec0'
PRODUCT = {'index.html', 'billing-print.html', 'assets/js/billing-print.js',
           'assets/js/p41-quote-pagination.js', 'assets/css/p41-quote-pagination.css'}
WORKFLOW = '.github/workflows/p41-k26-quote-notes.yml'


def main():
    root = Path(__file__).resolve().parents[1]
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    changed = set(git('diff', '--name-only', BASE, 'HEAD').decode().splitlines())
    unexpected = {p for p in changed if p not in PRODUCT and p != WORKFLOW and not p.startswith('.p41-k26-tests/')}
    assert changed and not unexpected, sorted(unexpected)
    before = git('show', BASE + ':index.html').decode()
    after = (root / 'index.html').read_text(encoding='utf-8')
    script = re.compile(r'(<script\b[^>]*\bsrc=["\']assets/js/billing-print\.js\?v=)[^"\']+')
    assert len(script.findall(before)) == len(script.findall(after)) == 1
    assert script.sub(r'\1CACHE_VERSION', before) == script.sub(r'\1CACHE_VERSION', after), 'index.html contains a non-cache edit'
    assert 'p41-k26-quote-notes-20261127-1' in script.search(after).group(0)
    branch = os.environ.get('GITHUB_REF_NAME', '')
    if branch:
        assert branch == 'p41-k26-quote-notes-20261127', branch
    files = [{'path': p, 'sha256': hashlib.sha256((root / p).read_bytes()).hexdigest(),
              'bytes': (root / p).stat().st_size} for p in sorted(changed)]
    print(json.dumps({'status': 'PRINT_ONLY_SOURCE_SCOPE_VERIFIED', 'baseCommit': BASE,
                      'candidateCommit': git('rev-parse', 'HEAD').decode().strip(),
                      'changedFiles': files, 'financialCoreChanges': False,
                      'indexChange': 'one billing-print.js cache query only'}, indent=2))


if __name__ == '__main__':
    main()
