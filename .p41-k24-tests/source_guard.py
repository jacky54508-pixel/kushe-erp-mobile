#!/usr/bin/env python3
"""K24 source/fixture gate. Reads Git and writes only its diagnostic output."""
import argparse
import hashlib
import json
import os
import subprocess
import traceback
from pathlib import Path

BASE = '09939153538416cfdc3a532b3ec0cd2af5e19238'
BRANCH = 'p41-k24-recovery-retry-20261126'
STORE = 'assets/js/erp-store.js'
WORKFLOW = '.github/workflows/p41-k24-recovery-retry.yml'
BASE_SHA256 = '316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e'
BASE_BLOB = '95773d5264d54fe1e1d1cfe54b37a2a2656a9fab'
CANDIDATE_SHA256 = '6d0753fb4c24febbc368d5fcca360e77972331b2c16d4a811841ccb81fe5b94e'
CANDIDATE_BLOB = '8e15b2f1c5ddec9d6120920ae024ca0ce9a1bf25'
DEPENDENCIES = {
    'k24_browser_recovery.py': 'ff187e426e42c4db3b7cc70d719420fe61b2d53a514906714ae87f1c466bee1f',
    'k23_browser_recovery.py': '6f986c9e3ffa9c0de34c30341346d0ce3f5ff2f433e1bc57d2c027ff8522d53b',
    'legacy_fault_observation.json': '97f0486560015e4ec8408c089ff05282a10fe8fff8916d3b165a57e987942d1f',
    'FIXTURE_MANIFEST.json': '3751407fb292e7eb98588377b06f8bf7ae25953586d6d49d8c96358019aec981',
}
CASES = {
    'PRIMARY_WRITTEN_before_emergency',
    'EMERGENCY_WRITTEN_before_store_token',
    'EMERGENCY_WRITTEN_before_receipt_token',
}
LEGACY_FILES = (
    '.p33-4-tests/regression.py', '.p33-4-tests/fixture.html',
    '.p34-tests/test.py', '.p34-tests/store.html',
    '.p39-inv1-tests/chrome_legacy.py', '.p39-inv1-tests/test_store.py',
    '.p39-inv1-tests/real-store.html',
)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = dict(schema='k24-source-guard-v1', status='RUNNING', baseCommit=BASE,
                  expectedBranch=BRANCH, productionDataTouched=False)
    git = lambda *items: subprocess.check_output(['git', '-C', str(root), *items])
    try:
        actual_branch = os.environ.get('GITHUB_REF_NAME', '')
        assert actual_branch == BRANCH, ('unexpected branch', actual_branch)
        subprocess.check_call(['git', '-C', str(root), 'merge-base', '--is-ancestor', BASE, 'HEAD'])
        result['headCommit'] = git('rev-parse', 'HEAD').decode().strip()
        changes = [p.decode('utf-8') for p in git('diff', '--name-only', '-z', BASE, 'HEAD').split(b'\0') if p]
        assert STORE in changes and WORKFLOW in changes, changes
        assert all(p in (STORE, WORKFLOW) or p.startswith('.p41-k24-tests/') for p in changes), changes
        result['changedFiles'] = changes
        baseline = git('show', BASE + ':' + STORE)
        candidate = (root / STORE).read_bytes()
        assert (sha256(baseline), blob(baseline)) == (BASE_SHA256, BASE_BLOB)
        assert (sha256(candidate), blob(candidate)) == (CANDIDATE_SHA256, CANDIDATE_BLOB)
        assert git('rev-parse', 'HEAD:' + STORE).decode().strip() == CANDIDATE_BLOB
        baseline_path = output / 'baseline-erp-store.js'
        baseline_path.write_bytes(baseline)
        result['baseline'] = dict(sha256=BASE_SHA256, gitBlob=BASE_BLOB, bytes=len(baseline))
        result['candidate'] = dict(sha256=CANDIDATE_SHA256, gitBlob=CANDIDATE_BLOB, bytes=len(candidate))
        tests = root / '.p41-k24-tests'
        result['dependencies'] = {}
        for name, expected in DEPENDENCIES.items():
            raw = (tests / name).read_bytes()
            assert sha256(raw) == expected, ('dependency changed', name)
            result['dependencies'][name] = dict(sha256=expected, bytes=len(raw))
        manifest = json.loads((tests / 'FIXTURE_MANIFEST.json').read_text(encoding='utf-8'))
        assert len(manifest) == 3 and {e['case'] for e in manifest} == CASES
        result['fixtures'] = []
        for entry in manifest:
            for file_key, length_key, hash_key in (('file','bytes','sha256'), ('baselineFile','baselineBytes','baselineSha256')):
                path = (tests / entry[file_key]).resolve()
                assert path.is_relative_to((tests / 'fixtures').resolve()), str(path)
                raw = path.read_bytes()
                assert len(raw) == entry[length_key] and sha256(raw) == entry[hash_key], str(path)
                snapshot = json.loads(raw.decode('utf-8-sig'))
                assert snapshot['idb']['main']['meta']['k21Synthetic'] is True
                if file_key == 'file':
                    assert snapshot['idb']['store:transaction:journal:v1']['before']['state']['meta']['k21Synthetic'] is True
                result['fixtures'].append(dict(file=entry[file_key], sha256=entry[hash_key], bytes=len(raw)))
        legacy = json.loads((tests / 'legacy_fault_observation.json').read_text(encoding='utf-8'))
        assert legacy['afterFaultObservation']['idb']['main']['meta']['k21Synthetic'] is True
        result['unchangedLegacyFiles'] = {}
        for name in LEGACY_FILES:
            raw = (root / name).read_bytes()
            assert raw == git('show', BASE + ':' + name), ('legacy regression changed', name)
            result['unchangedLegacyFiles'][name] = sha256(raw)
        result['status'] = 'K24_SOURCE_GUARD_PASS'
    except Exception as error:
        result['status'] = 'BLOCKED'
        result['error'] = dict(type=type(error).__name__, message=str(error), traceback=traceback.format_exc())
        raise
    finally:
        (output / 'SOURCE_GUARD_RESULT.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
