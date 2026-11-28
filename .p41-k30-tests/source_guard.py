#!/usr/bin/env python3
"""K30 reviewed boundary: preserve K29 production and all 70 prior test files."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE='3a8fc71efa70ea56332fbbd781f8db78a680448f'
VERSION='p41-k30-allowance-posting-20261128-1'
RUNTIME={ 'assets/js/'+name+'.js' for name in ('erp-store','cloud-sync','receivable-cheques','dashboard','invoices','projects','external-billing-invoice','external-billing-invoice-ui','billing-groups','billing','reports','billing-allowance-ui') } | {'index.html'}
WORKFLOW='.github/workflows/p41-k30-allowance-posting.yml'
MIGRATION='supabase/migrations/20261128032204_k30_billing_allowance_guard.sql'
MANIFEST='.p41-k30-tests/SOURCE_MANIFEST.json'
LEGACY=('.p33-4-tests/','.p34-tests/','.p35-tests/','.p36-tests/','.p39-inv1-tests/',
        '.p41-k24-tests/','.p41-k25-tests/','.p41-k26-tests/','.p41-k27-tests/',
        '.p41-k28-tests/','.p41-k29-tests/','.p41-quote-tests/')

def git(root,*args): return subprocess.check_output(['git',*args],cwd=root)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--write-manifest',action='store_true')
    args=parser.parse_args();root=args.root.resolve();args.output.mkdir(parents=True,exist_ok=True)
    report={'schema':'k30-source-boundary-v1','baseCommit':BASE,'status':'BLOCKED','productionDataTouched':False,'publishGate':'BLOCKED','checks':[]}
    def check(name,passed):
        report['checks'].append({'name':name,'passed':bool(passed)})
        if not passed:raise AssertionError(name)
    try:
        report['headCommit']=git(root,'rev-parse','HEAD').decode().strip()
        check('K29 production remains an ancestor',subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],cwd=root).returncode==0)
        changed=set(git(root,'diff','--name-only',BASE).decode().splitlines())|set(git(root,'ls-files','--others','--exclude-standard').decode().splitlines())
        changed.discard('');report['changedFiles']=sorted(changed)
        check('all changed paths are reviewed K30 scope',all(p in RUNTIME or p in (WORKFLOW,MIGRATION) or p.startswith('.p41-k30-tests/') for p in changed))
        check('no private records or generated evidence in source',all('/private/' not in p and '/artifacts/' not in p and '/results/' not in p and '/__pycache__/' not in p and not p.endswith(('.pyc','.png','.pdf','.zip')) for p in changed))
        before=git(root,'show',BASE+':index.html').decode()
        names=('erp-store','cloud-sync','receivable-cheques','dashboard','invoices','projects','external-billing-invoice','external-billing-invoice-ui','billing-groups','billing','reports')
        expected=before
        for name in names:
            expected,count=re.subn(r'(src="assets/js/'+re.escape(name)+r'\.js)\?v=[^"]+',lambda m:m[1]+'?v='+VERSION,expected)
            check('one cache reference for '+name,count==1)
        marker='  <script src="assets/js/billing.js?v='+VERSION+'"></script>'
        expected=expected.replace(marker,'  <script src="assets/js/billing-allowance-ui.js?v='+VERSION+'"></script>\n'+marker)
        check('index only refreshes reviewed assets and adds one allowance UI script',expected==(root/'index.html').read_text())
        prior=git(root,'ls-tree','-r','--name-only',BASE).decode().splitlines()
        oldtests=[p for p in prior if p.startswith(LEGACY)]
        check('all prior test files preserve exact bytes and assertions',all((root/p).read_bytes()==git(root,'show',BASE+':'+p) for p in oldtests))
        report['legacyFilesVerified']=len(oldtests)
        check('at least 70 prior acceptance files protected',len(oldtests)>=70)
        for name in ('assets/js/billing-print.js','assets/js/billing-bundle-print.js','assets/js/external-billing-print.js','billing-print.html','billing-bundle-print.html','external-billing-print.html','assets/js/commissions.js','assets/js/payroll.js'):
            check(name+' remains byte-identical',(root/name).read_bytes()==git(root,'show',BASE+':'+name))
        old=(root/'.p41-k29-tests/sync_contract.cjs').read_text()
        expected_contract=old.replace('const additions={',"const additions={\n  postBillingAllowance:['billing-allowance-ui.js'],\n  reverseBillingAllowance:['billing-allowance-ui.js'],",1).replace("schema:'k29-cloud-editor-event-contract-v1'","schema:'k30-cloud-editor-event-contract-v1'").replace('// Actual cloud-sync module','// K30 extends only the two reviewed allowance writers; all K29 behavioral assertions retained.\n// Actual cloud-sync module',1).replace('K29_SYNC_EVENT_CONTRACT_PASS','K30_SYNC_EVENT_CONTRACT_PASS')
        check('new event suite retains all old assertions and adds only two normal writers',expected_contract==(root/'.p41-k30-tests/sync_editor_contract.cjs').read_text())
        files={}
        for name in sorted((RUNTIME|changed)-{MANIFEST}):
            if (root/name).is_file():
                raw=(root/name).read_bytes();files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        frozen={'baseCommit':BASE,'files':files};report['files']=files
        if args.write_manifest:(root/MANIFEST).write_text(json.dumps(frozen,ensure_ascii=False,indent=2)+'\n')
        else:check('all tested bytes match frozen source manifest',json.loads((root/MANIFEST).read_text())==frozen)
        report['status']='PASS'
    except Exception as exc:report['error']={'type':type(exc).__name__,'message':str(exc)}
    (args.output/'SOURCE_SCOPE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('status','headCommit','checks') if k in report},ensure_ascii=False))
    if 'error'in report:print(report['error'])
    return 0 if report['status']=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
