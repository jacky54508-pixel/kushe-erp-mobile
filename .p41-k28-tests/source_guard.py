#!/usr/bin/env python3
"""Candidate scope guard and byte manifest; never invokes application code."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE='99102d1e23b1519ff317d62b48340a919c99d133'
RUNTIME={'assets/js/erp-store.js','assets/js/commissions.js','assets/js/daily-draft-review.js','assets/js/dashboard.js','index.html'}
WORKFLOW='.github/workflows/p41-k28-paid-month-append.yml'
LEGACY=('.p33-4-tests/','.p34-tests/','.p35-tests/','.p39-inv1-tests/')


def git(root,*args):return subprocess.check_output(['git',*args],cwd=root)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();root=args.root.resolve();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    result={'schema':'k28-source-scope-v1','status':'BLOCKED','baseCommit':BASE,'productionDataTouched':False,'publishGate':'BLOCKED','checks':[]}
    def check(label,value):
        result['checks'].append({'name':label,'passed':bool(value)})
        if not value:raise AssertionError(label)
    try:
        result['headCommit']=git(root,'rev-parse','HEAD').decode().strip()
        check('reviewed baseline is an ancestor of candidate',subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],cwd=root).returncode==0)
        changed=set(git(root,'diff','--name-only',BASE).decode().splitlines())
        changed.update(git(root,'ls-files','--others','--exclude-standard').decode().splitlines())
        changed={p for p in changed if p}
        result['changedFiles']=sorted(changed)
        check('candidate changes are restricted to reviewed runtime and K28 tests',all(p in RUNTIME or p==WORKFLOW or p.startswith('.p41-k28-tests/') for p in changed))
        check('no generated evidence or bytecode is committed as a test',not any('/__pycache__/' in p or p.endswith('.pyc') for p in changed))
        if 'index.html' in changed:
            before=git(root,'show',BASE+':index.html').decode('utf-8');after=(root/'index.html').read_text(encoding='utf-8')
            pattern=r'(src="assets/js/(?:erp-store|commissions|daily-draft-review|dashboard)\.js)\?v=[^\"]+(\")'
            expected,count=re.subn(pattern,lambda match:match.group(1)+'?v=p41-k28-paid-month-append-20261127-1'+match.group(2),before)
            check('index changes only the four reviewed runtime cache versions',count==4 and expected==after)
        legacy=git(root,'ls-tree','-r','--name-only',BASE).decode().splitlines()
        legacy=[p for p in legacy if p.startswith(LEGACY)]
        check('all original regression files remain byte-equivalent',all((root/p).read_bytes()==git(root,'show',BASE+':'+p) for p in legacy))
        result['legacyFilesVerified']=len(legacy)
        files={}
        for name in sorted(RUNTIME|{p for p in changed if p.startswith('.p41-k28-tests/') or p==WORKFLOW}):
            path=root/name
            if path.is_file():
                data=path.read_bytes();files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        result['files']=files;result['status']='K28_SOURCE_SCOPE_PASS'
    except Exception as error:result['error']={'type':type(error).__name__,'message':str(error)}
    (output/'SOURCE_SCOPE.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result['status']=='K28_SOURCE_SCOPE_PASS' else 1


if __name__=='__main__':raise SystemExit(main())
