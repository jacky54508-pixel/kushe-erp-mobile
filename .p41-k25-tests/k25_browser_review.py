#!/usr/bin/env python3
"""K25 isolated real-browser acceptance of the candidate Store review APIs.

Only SYN-K25 in-memory fixtures are seeded into fresh owned Chromium profiles.
No production origin, account, cloud API, or business dataset is contacted.
"""
import argparse
import copy
import hashlib
import json
import os
import platform
import shutil
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright
from k25_fixture import fixture, PREFIX, GROUP, EMPLOYEES, HOUSES, PROTECTED

JOURNAL = 'store:transaction:journal:v1'
EMERGENCY = 'KuSheERP25_EMERGENCY'
STORE_TOKEN = 'KuSheERP25_LOCAL_COMMIT_TOKEN'
RECEIPT_TOKEN = 'KuSheERP25_RECEIPT_COMMIT_VERSION'
GATES = ('KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED')
LEDGER = 'commissionCorrectionReviews'
PREVIEW = 'commissionCorrectionPreview'
CREATE = 'createCommissionCorrectionReview'
REVIEWS = 'commissionCorrectionReviews'
ERROR_PREFIX = 'COMMISSION_CORRECTION_'
BASE_COMMIT = '75938e04b8f2db6b382dc3399a3a46d845684773'

HTML = r'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>SYN-K25 isolated acceptance</title><link rel="icon" href="data:,"></head><body><p>SYN-K25 isolated financial review acceptance</p><script>
'use strict';
window.KUSHE_PHASE1_CONFIG={};
window.__k25Auth={principal:'SYN-K25-OWNER',hasToken:true,role:'owner',status:'active',shadowVerified:true,companyId:'SYN-K25-COMPANY',contextUser:'SYN-K25-OWNER'};
window.KusheAuthGate={session:()=>({access_token:__k25Auth.hasToken?'SYN-K25-LOCAL-ONLY-TOKEN':''}),user:()=>({id:__k25Auth.principal,email:'synthetic-k25@example.invalid'}),companyContext:()=>({userId:__k25Auth.contextUser,legacySourceUserId:__k25Auth.contextUser,companyId:__k25Auth.companyId,role:__k25Auth.role,status:__k25Auth.status,shadowVerified:__k25Auth.shadowVerified}),canWrite:()=>true,requireAuth:async()=>true,requireMfa:async()=>true};
window.KuSheLegacyData={refresh(){}};window.KusheRecovery={showResult(){}};
window.__k25Raw=async()=>{
 const out={idb:{},local:{},session:{}};
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>r.transaction.abort()});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readonly'),t=tx.objectStore('erp');for(const k of ['main','store:transaction:journal:v1','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED']){const r=t.get(k);r.onsuccess=()=>{out.idb[k]=r.result??null}}tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 for(const k of ['KuSheERP25_EMERGENCY','KuSheERP25_LOCAL_COMMIT_TOKEN','KuSheERP25_RECEIPT_COMMIT_VERSION','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_TRANSACTION_ACTIVE'])out.local[k]=localStorage.getItem(k);
 for(const k of ['KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED'])out.session[k]=sessionStorage.getItem(k);
 return out;
};
window.__k25Seed=async data=>{
 if(location.hostname!=='127.0.0.1'||window.__k25Seeded||data?.meta?.k25Synthetic!==true)throw Error('SYN_K25_FRESH_SYNTHETIC_ONLY');
 if(localStorage.length||sessionStorage.length||(await indexedDB.databases()).length)throw Error('SYN_K25_EMPTY_PROFILE_REQUIRED');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB',1);r.onupgradeneeded=()=>r.result.createObjectStore('erp');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readwrite');tx.objectStore('erp').put(data,'main');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(data));localStorage.setItem('kushe_erp_device_trust_v1',JSON.stringify({schema:'kushe-device-trust-v1',version:1,mode:'trusted',userId:'SYN-K25-OWNER'}));window.__k25Seeded=true;return true;
};
window.__k25Call=async({name,args=[]})=>{try{return {ok:true,result:await KuSheERPStore[name](...args)}}catch(e){return {ok:false,error:{name:e.name,message:e.message,code:e.code||'',transactionStatus:e.transactionStatus||'',operationId:e.operationId||''}}}};
</script></body></html>'''


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(raw):
    return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()


def stable(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf-8')


class Report:
    def __init__(self, output):
        self.output=output;output.mkdir(parents=True,exist_ok=True)
        self.data={'schema':'k25-real-store-review-browser-v1','status':'RUNNING','baseCommit':BASE_COMMIT,'productionDataTouched':False,'financialPostingTested':False,'productionAuthenticationTested':False,'publishGate':'BLOCKED','platform':platform.platform(),'checks':[],'cases':[],'failures':[],'externalRequests':[],'pageErrors':[]}
    def check(self,name,condition,details=None):
        row={'name':name,'passed':bool(condition)}
        if details is not None:row['details']=details
        self.data['checks'].append(row)
        if not condition:
            self.flush();raise AssertionError(name+(': '+str(details) if details is not None else ''))
    def save(self,name,value):
        (self.output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def flush(self):
        self.data['passCount']=sum(x['passed'] for x in self.data['checks']);self.data['failCount']=sum(not x['passed'] for x in self.data['checks']);self.save('RESULT.json',self.data)
    def case(self,name,kind,extra=None):
        self.data['cases'].append(dict(name=name,kind=kind,passed=True,**(extra or {})));self.flush()


class Server:
    def __init__(self, store, root):
        resources={'/fixture.html':(HTML.encode(),'text/html; charset=utf-8'),'/assets/js/erp-store.js':(store,'text/javascript; charset=utf-8')}
        for path,mime in [('assets/js/p41-commission-correction-ui.js','text/javascript; charset=utf-8'),('assets/css/p41-commission-correction.css','text/css; charset=utf-8')]:
            resources['/'+path]=((root/path).read_bytes(),mime)
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                entry=resources.get(urlsplit(self.path).path)
                if entry is None:self.send_error(404);return
                raw,mime=entry;self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
            def log_message(self,*args):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.origin='http://127.0.0.1:'+str(self.server.server_address[1]);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
    def __enter__(self):self.thread.start();return self
    def __exit__(self,*args):self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)


def restrict(context,server,report,name):
    allowed={server.origin+p for p in ('/fixture.html','/assets/js/erp-store.js','/assets/js/p41-commission-correction-ui.js','/assets/css/p41-commission-correction.css')}
    def route(r):
        if r.request.method=='GET' and r.request.url in allowed:r.continue_()
        else:report.data['externalRequests'].append({'case':name,'method':r.request.method,'url':r.request.url});r.abort()
    context.route('**/*',route)
    context.on('page',lambda page:page.on('pageerror',lambda error:report.data['pageErrors'].append({'case':name,'message':str(error)})))


def call(page,name,*args):return page.evaluate('x=>__k25Call(x)',{'name':name,'args':list(args)})
def raw(page):return page.evaluate('()=>__k25Raw()')
def public(page):return page.evaluate('()=>KuSheERPStore.getState()')
def ledger(data):return data.get('meta',{}).get(LEDGER,[])
def rows(plan):return [h for g in plan['groups'] for w in g['workers'] for h in w['houses']]
def holds(plan):return {x['code'] for g in plan['groups'] for v in [g,*g['workers'],*[h for w in g['workers'] for h in w['houses']]] for x in v.get('holdReasons',[])}
def flags(value):return all(value.get(k) is False for k in ('canApply','canPost','canPay'))


def open_page(context,server):
    page=context.new_page();page.set_default_timeout(20000);page.goto(server.origin+'/fixture.html',wait_until='load');return page


def boot(context,server,report,name,kind='unpaid'):
    restrict(context,server,report,name);page=open_page(context,server)
    report.check(name+': fresh fixture is synthetic',page.evaluate('x=>__k25Seed(x)',fixture(kind)) is True)
    page.add_script_tag(url=server.origin+'/assets/js/erp-store.js')
    loaded=call(page,'load');report.check(name+': exact Store loads fixture',loaded['ok'],loaded if not loaded['ok'] else None)
    setup=call(page,'saveCustomer',{'name':PREFIX+'CUSTOMER','note':'SYN-K25 fixture normalization committed'},PREFIX+'CUSTOMER')
    report.check(name+': ordinary setup writer commits normalization',setup['ok'],setup if not setup['ok'] else None)
    before=raw(page);report.check(name+': setup publication equals durable primary',public(page)==before['idb']['main'])
    return page,before


def preview(page,report,name):
    before=raw(page);mem=public(page);result=call(page,PREVIEW,{'groupId':GROUP})
    report.check(name+': preview returns read-only review plan',result['ok'] and result['result'].get('readOnly') is True,result if not result['ok'] else None)
    plan=result['result'];report.check(name+': preview cannot apply post or pay',flags(plan))
    report.check(name+': preview leaves every captured storage layer and public state unchanged',raw(page)==before and public(page)==mem)
    report.check(name+': preview token is a nonempty string',isinstance(plan.get('snapshot'),str) and len(plan['snapshot'])>0)
    return plan


def request(plan,keys=None):
    return {'keys':keys if keys is not None else [r['key'] for r in rows(plan)],'expectedSnapshot':plan['snapshot'],'confirmed':True,'confirmationText':'僅建立待核對紀錄','reason':'SYN-K25 合成驗收紀錄'}


def check_protected(report,name,before,after):
    report.check(name+': every original root collection and setting unchanged',all(after.get(k)==v for k,v in before.items() if k not in ('meta','audit')))
    report.check(name+': all protected financial collections byte-equivalent',all(stable(after.get(k))==stable(before.get(k)) for k in PROTECTED))
    skip={LEDGER,'updatedAt','businessSnapshotRevision','receiptCommitVersion'}
    report.check(name+': unrelated metadata preserved', {k:v for k,v in before['meta'].items() if k not in skip}=={k:v for k,v in after['meta'].items() if k not in skip})


def check_commit(report,name,before,current,result,expected_count):
    b,a=before['idb']['main'],current['idb']['main'];j=current['idb'][JOURNAL];rev=a['meta']['businessSnapshotRevision']
    report.check(name+': creates review records only',result['ok'] and result['result'].get('created') is True and flags(result['result']),result)
    report.check(name+': ledger has exact requested number of new unique records',len(ledger(a))==len(ledger(b))+expected_count and len({r['id'] for r in ledger(a)})==len(ledger(a)))
    report.check(name+': review records never carry applied or payable status',all(r.get('status') in ('DRAFT','HOLD') and r.get('schema')=='kushe-commission-correction-review-v1' for r in ledger(a)))
    check_protected(report,name,b,a)
    report.check(name+': exactly one new audit entry for atomic batch',len(a['audit'])==len(b['audit'])+1 and a['audit'][1:]==b['audit'])
    report.check(name+': revision advances once with correct parent',rev['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and rev['parentId']==b['meta']['businessSnapshotRevision']['id'])
    report.check(name+': real journal and all mirrors verify same new commit',j['phase']=='COMMIT_VERIFIED' and j['operationType']==CREATE and json.loads(current['local'][EMERGENCY])==a and json.loads(current['local'][STORE_TOKEN])['revisionId']==rev['id'] and current['local'][RECEIPT_TOKEN]==rev['id'])
    report.check(name+': no recovery gates after successful save',all(current[p][key] is None for p in ('idb','local','session') for key in GATES))


def positive_reopen(playwright,launch,server,report,profile):
    name='append-only-review-persists-after-browser-reopen';print('RUN',name,flush=True)
    ctx=playwright.chromium.launch_persistent_context(str(profile),**launch)
    try:
        page,before=boot(ctx,server,report,name,'unpaid');plan=preview(page,report,name)
        report.check(name+': full group pretax basis is used',len(plan['groups'])==1 and plan['groups'][0]['conditionalBase']==14000)
        report.check(name+': both workers retained at old1750 target3500 delta1750',len(plan['groups'][0]['workers'])==2 and all((w['rate'],w['original'],w['conditionalTarget'],w['conditionalDifference'])==(25,1750,3500,1750) for w in plan['groups'][0]['workers']))
        for w in plan['groups'][0]['workers']:
            hs=sorted(w['houses'],key=lambda h:h['house'])
            report.check(name+': exact original target and delta house allocations for '+w['employeeId'],[h['original'] for h in hs]==[583,584,583] and [h['conditionalTarget'] for h in hs]==[1166,1167,1167] and [h['conditionalDifference'] for h in hs]==[583,583,584],hs)
            report.check(name+': both allocation sums reconcile for '+w['employeeId'],sum(h['original'] for h in hs)==w['original'] and sum(h['conditionalTarget'] for h in hs)==w['conditionalTarget'] and sum(h['conditionalDifference'] for h in hs)==w['conditionalDifference'])
        report.check(name+': uncollected money remains explicitly held','RECEIPT_UNPAID' in holds(plan))
        report.check(name+': review keys differ from original payment allocation keys',all(h['key']!=json.dumps([w['commissionId'],h['house']],separators=(',',':')) for g in plan['groups'] for w in g['workers'] for h in w['houses']))
        payment_before={'pool':call(page,'commissionReleasePool'),'payroll':call(page,'monthlyPayrollGroups')}
        result=call(page,CREATE,request(plan));current=raw(page);check_commit(report,name,before,current,result,6)
        report.check(name+': public state is fully committed primary',public(page)==current['idb']['main'])
        report.check(name+': reviews do not enter salary source or commission payment pool',payment_before=={'pool':call(page,'commissionReleasePool'),'payroll':call(page,'monthlyPayrollGroups')})
        listed=call(page,REVIEWS);report.check(name+': new reviews are readable without becoming stale themselves',listed['ok'] and len(listed['result']['records'])==6 and flags(listed['result']) and all(r.get('sourceChanged') is False for r in listed['result']['records']),listed)
        unchanged=raw(page);duplicate=call(page,CREATE,request(plan));report.check(name+': duplicate request refuses with no new data or audit',not duplicate['ok'] and duplicate['error']['code'] in (ERROR_PREFIX+'DUPLICATE',ERROR_PREFIX+'STALE_PREVIEW') and raw(page)==unchanged,duplicate)
        fresh=preview(page,report,name+'-fresh');duplicate=call(page,CREATE,request(fresh));report.check(name+': duplicate keys with fresh token are rejected',not duplicate['ok'] and duplicate['error']['code']==ERROR_PREFIX+'DUPLICATE' and raw(page)==unchanged,duplicate)
        report.save(name+'.json',{'preview':plan,'save':result,'duplicate':duplicate,'before':before,'after':current,'reviews':listed})
    finally:ctx.close()
    ctx=playwright.chromium.launch_persistent_context(str(profile),**launch)
    try:
        restrict(ctx,server,report,name+'-reopen');page=open_page(ctx,server)
        report.check(name+': durable primary journal and mirrors survive reopen',raw(page)==current)
        page.add_script_tag(url=server.origin+'/assets/js/erp-store.js');loaded=call(page,'load')
        report.check(name+': reopening loads exact saved review ledger and financial sources',loaded['ok'] and loaded['result']==current['idb']['main'],loaded if not loaded['ok'] else None)
        after_list=call(page,REVIEWS);report.check(name+': readonly review list survives reopening',after_list==listed and raw(page)==current,after_list)
    finally:ctx.close()
    report.case(name,'durable-append-only')


def scenario(browser,server,report,name,kind,expected_hold=None,expected_difference=None,can_save=True):
    print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,kind);plan=preview(page,report,name)
        if expected_hold:report.check(name+': required hold is explicit',expected_hold in holds(plan),sorted(holds(plan)))
        if expected_difference is not None:report.check(name+': zero or negative original difference is preserved',all(w['conditionalDifference']==expected_difference for g in plan['groups'] for w in g['workers']),plan['groups'])
        if kind=='tax-conflict':report.check(name+': ambiguous tax basis has no verified target',all(w.get('verifiedTarget') is None and w.get('verifiedDifference') is None for g in plan['groups'] for w in g['workers']))
        if kind=='commission-amount-mismatch':
            workers=plan['groups'][0]['workers'];affected=next(w for w in workers if w['employeeId']==EMPLOYEES[0]);valid=next(w for w in workers if w['employeeId']==EMPLOYEES[1])
            report.check(name+': conflicting saved amounts remain visible and no verified target is invented',affected['original']==1750 and affected['originalDailyCommission']==1749 and affected['conditionalTarget']==3500 and affected['verifiedTarget'] is None and affected['verifiedDifference'] is None and all(h['verifiedTarget'] is None for h in affected['houses']) and valid['verifiedTarget']==3500,workers)
        if kind=='same-month-other-paid':report.check(name+': other source payment never marks original commission paid','ORIGINAL_COMMISSION_PAID' not in holds(plan),sorted(holds(plan)))
        if kind in ('received','billing-lines-subtotal-only'):report.check(name+': fully verified collection is not mislabeled unpaid or partial',not ({'RECEIPT_UNPAID','RECEIPT_PARTIAL','RECEIPT_INTEGRITY','BILLING_SOURCE_UNRESOLVED','BILLING_ALLOCATION_UNRESOLVED'} & holds(plan)),sorted(holds(plan)))
        if kind=='billing-lines-subtotal-only':report.check(name+': original subtotal-only billing lines prove the verified pretax basis',plan['groups'][0]['verifiedBase']==14000 and all(w['verifiedTarget']==3500 for w in plan['groups'][0]['workers']),plan['groups'])
        if kind=='decimal-rate-pool':
            workers=sorted(plan['groups'][0]['workers'],key=lambda w:w['employeeId'])
            report.check(name+': exact 5000 basis-point rate pool avoids floating-sum false hold','RATE_POOL_MISMATCH' not in holds(plan) and [w['rate'] for w in workers]==[0.01,32.16,17.83] and [w['verifiedTarget'] for w in workers]==[1,4502,2496],workers)
        if can_save:
            keys=[h['key'] for h in rows(plan) if h.get('canCreateReview')]
            report.check(name+': held sources remain reviewable when identity is unique',bool(keys),plan)
            result=call(page,CREATE,request(plan,keys));after=raw(page);check_commit(report,name,before,after,result,len(keys))
            if expected_hold:
                expected={h['key']:{v['code'] for v in h.get('holdReasons',[])} for h in rows(plan)}
                affected=[r for r in ledger(after['idb']['main']) if expected_hold in expected.get(r['key'],set())]
                report.check(name+': affected held reviews remain HOLD',bool(affected) and all(r['status']=='HOLD' for r in affected))
        else:
            ambiguous=json.dumps(['full-group-pretax-v1',GROUP,EMPLOYEES[0],HOUSES[0]],separators=(',',':'))
            selected=[ambiguous]+[h['key'] for h in rows(plan) if h['key']!=ambiguous][:1]
            result=call(page,CREATE,request(plan,selected));report.check(name+': unresolved identity blocks review creation',not result['ok'] and result['error']['code'] in (ERROR_PREFIX+'SOURCE_UNRESOLVED',ERROR_PREFIX+'INVALID_INPUT') and raw(page)==before,result)
        report.save(name+'.json',{'preview':plan,'result':result,'after':raw(page)})
        report.case(name,'financial-review-scenario')
    finally:ctx.close()


def scope_and_summary(browser,server,report):
    name='filtered-summary-and-noncommission-scope';print('RUN',name,flush=True)
    for kind in ('mixed-scope','inactive-work-only','inactive-disabled-zero','inactive-enabled-zero-rate','inactive-legacy-work','missing-nonzero-source'):
        ctx=browser.new_context(service_workers='block')
        try:
            case=name+'-'+kind;page,before=boot(ctx,server,report,case,kind)
            response=call(page,PREVIEW);report.check(case+': full preview succeeds',response['ok'],response)
            plan=response['result'];report.check(case+': full preview stays read-only and cannot post or pay',plan['readOnly'] is True and flags(plan) and raw(page)==before and public(page)==before['idb']['main'])
            if kind=='mixed-scope':
                report.check(case+': both distinct financial groups remain visible',len(plan['groups'])==2 and plan['summary']=={'groups':2,'workers':4,'houses':12,'conditionalDifference':2500},plan['summary'])
                expected=[(GROUP,3500),(PREFIX+'SECOND-GROUP',-1000),(PREFIX+'ABSENT-GROUP',0)]
                for group_id,difference in expected:
                    result=call(page,PREVIEW,{'groupId':group_id});report.check(case+': filtered preview succeeds for '+group_id,result['ok'],result)
                    filtered=result['result'];exists=group_id!=PREFIX+'ABSENT-GROUP'
                    summary={'groups':1 if exists else 0,'workers':2 if exists else 0,'houses':6 if exists else 0,'conditionalDifference':difference}
                    report.check(case+': summary counts only visible group '+group_id,filtered['summary']==summary and all(g['groupId']==group_id for g in filtered['groups']),filtered['summary'])
                    report.check(case+': filter preserves global source token '+group_id,filtered['snapshot']==plan['snapshot'])
            elif kind=='missing-nonzero-source':
                report.check(case+': missing source with nonzero saved commission remains visible',len(plan['groups'])==1 and len(rows(plan))==6 and 'SOURCE_LINK_MISMATCH' in holds(plan) and all(w['original'] is None and w['originalDailyCommission']==1750 and w['verifiedTarget'] is None for g in plan['groups'] for w in g['workers']) and plan['canCreateReview'] is False and all(h['canCreateReview'] is False for h in rows(plan)),plan)
            else:
                report.check(case+': ordinary zero-commission work is excluded without false financial alerts',plan['groups']==[] and plan['summary']=={'groups':0,'workers':0,'houses':0,'conditionalDifference':0} and plan['canCreateReview'] is False and plan['issues']==[],plan)
            report.check(case+': all previews preserve durable source and public state',raw(page)==before and public(page)==before['idb']['main'])
            report.save(case+'.json',{'preview':plan});report.case(case,'review-scope-and-summary')
        finally:ctx.close()


def invalid_requests(browser,server,report):
    name='invalid-input-and-atomic-rejection';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);plan=preview(page,report,name);valid=request(plan)
        variations=[('missing-confirmation',dict(valid,confirmed=False),'CONFIRMATION_REQUIRED'),('wrong-phrase',dict(valid,confirmationText='SYN-K25-NOT-CONFIRMED'),'CONFIRMATION_REQUIRED'),('missing-reason',dict(valid,reason=''),'INVALID_INPUT'),('empty-keys',dict(valid,keys=[]),'INVALID_INPUT'),('repeat-key',dict(valid,keys=[valid['keys'][0],valid['keys'][0]]),'INVALID_INPUT'),('unknown-key-in-batch',dict(valid,keys=[valid['keys'][0],'SYN-K25-UNKNOWN-KEY']),'SOURCE_UNRESOLVED'),('too-many-keys',dict(valid,keys=['SYN-K25-KEY-'+str(i) for i in range(101)]),'INVALID_INPUT'),('tampered-token',dict(valid,expectedSnapshot='SYN-K25-STALE'),'STALE_PREVIEW')]
        for label,req,code in variations:
            outcome=call(page,CREATE,req);report.check(name+': '+label+' rejects before all writes',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+code and raw(page)==before and public(page)==before['idb']['main'],outcome)
        forged=dict(valid,target=999999,paid=True,taxBasis='preTax',status='APPROVED',canPay=True)
        outcome=call(page,CREATE,forged);report.check(name+': caller-supplied money status and approval fields are rejected',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'INVALID_INPUT' and raw(page)==before,outcome)
        report.case(name,'validation-and-atomicity')
    finally:ctx.close()


def owner_refusals(browser,server,report):
    name='owner-auth-context-refusals';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);plan=preview(page,report,name);req=request(plan)
        defaults={'principal':'SYN-K25-OWNER','hasToken':True,'role':'owner','status':'active','shadowVerified':True,'companyId':'SYN-K25-COMPANY','contextUser':'SYN-K25-OWNER'}
        for field,value in [('hasToken',False),('role','staff'),('status','inactive'),('shadowVerified',False),('companyId',''),('contextUser','SYN-K25-OTHER-USER')]:
            page.evaluate('x=>{window.__k25Auth=x}',dict(defaults,**{field:value}))
            outcome=call(page,CREATE,req);report.check(name+': refuses '+field+' mismatch without writes',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'OWNER_REQUIRED' and raw(page)==before,outcome)
        page.evaluate('x=>{window.__k25Auth=x}',defaults);report.case(name,'owner-authorization')
    finally:ctx.close()


def stale_and_listing(browser,server,report):
    name='stale-preview-and-stale-ledger-detection';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);plan=preview(page,report,name);key=rows(plan)[0]['key']
        made=call(page,CREATE,request(plan,[key]));report.check(name+': one source review created',made['ok'],made)
        stale_plan=preview(page,report,name+'-before-source-update')
        # Existing receipt writer changes this synthetic source's collection evidence.
        changed=call(page,'addReceipt',{'receivableId':PREFIX+'AR','cashAmount':14700,'date':'2026-10-09','fee':0,'feePayer':'company','bankId':PREFIX+'BANK','collectionType':'bank','paymentMethod':'銀行轉帳','idempotencyKey':PREFIX+'SOURCE-UPDATE','note':'SYN-K25 source change'});report.check(name+': ordinary synthetic source change succeeds',changed['ok'],changed)
        changed_raw=raw(page);outcome=call(page,CREATE,request(stale_plan,[rows(stale_plan)[1]['key']]))
        report.check(name+': stale preview refuses after intervening committed writer',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'STALE_PREVIEW' and raw(page)==changed_raw,outcome)
        listing=call(page,REVIEWS);report.check(name+': saved evidence stays immutable and can be listed after source change',listing['ok'] and ledger(changed_raw['idb']['main'])==ledger(raw(page)['idb']['main']) and raw(page)==changed_raw and flags(listing['result']) and all(r.get('sourceChanged') is True for r in listing['result']['records']),listing)
        report.save(name+'.json',{'staleResult':outcome,'reviews':listing,'before':before,'after':changed_raw})
        report.case(name,'source-version')
    finally:ctx.close()


def corrupt_ledger(browser,server,report):
    name='malformed-ledger-preserved-and-refused';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'malformed-ledger');res=call(page,PREVIEW,{'groupId':GROUP})
        req={'keys':[json.dumps(['full-group-pretax-v1',GROUP,EMPLOYEES[0],HOUSES[0]],separators=(',',':'))],'expectedSnapshot':res.get('result',{}).get('snapshot','SYN-K25-INVALID'),'confirmed':True,'confirmationText':'僅建立待核對紀錄','reason':'SYN-K25 合成驗收紀錄'}
        outcome=call(page,CREATE,req);report.check(name+': invalid existing ledger is never replaced with empty ledger',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'LEDGER_INVALID' and raw(page)==before,outcome)
        report.case(name,'ledger-integrity')
    finally:ctx.close()


def rollback(browser,server,report,target):
    name='real-persistence-failure-'+target;print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);plan=preview(page,report,name);req=request(plan)
        page.evaluate('''target=>{
          const put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;window.__k25FaultCount=0;
          window.__k25Restore=()=>{IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set};
          const fault=()=>{window.__k25FaultCount++;throw Object.assign(new Error('SYN-K25-INJECTED-PERSISTENCE-FAILURE'),{code:'SYN_K25_PERSISTENCE_FAILURE'})};
          IDBObjectStore.prototype.put=function(value,key){if(target==='primary'&&this.name==='erp'&&key==='main'&&window.__k25FaultCount===0)fault();return put.call(this,value,key)};
          Storage.prototype.setItem=function(key,value){if(target!=='primary'&&this===localStorage&&key===target&&window.__k25FaultCount===0)fault();return set.call(this,key,value)};
        }''',target)
        try:outcome=call(page,CREATE,req)
        finally:page.evaluate('()=>__k25Restore()')
        after=raw(page);report.check(name+': injected fault actually fired once',page.evaluate('()=>__k25FaultCount')==1)
        report.check(name+': failed real commit reports no success',not outcome['ok'] and outcome['error']['code']=='SYN_K25_PERSISTENCE_FAILURE' and outcome['error']['transactionStatus'] in ('ROLLED_BACK','REJECTED'),outcome)
        report.check(name+': primary mirrors and public state retain complete baseline',after['idb']['main']==before['idb']['main'] and after['local']==before['local'] and after['session']==before['session'] and public(page)==before['idb']['main'])
        report.check(name+': failed batch creates no ledger records or audit',ledger(after['idb']['main'])==ledger(before['idb']['main']) and after['idb']['main']['audit']==before['idb']['main']['audit'])
        fresh=preview(page,report,name+'-retry');success=call(page,CREATE,request(fresh));current=raw(page);check_commit(report,name+'-retry',before,current,success,6)
        report.save(name+'.json',{'failed':outcome,'afterFailure':after,'retry':success,'afterRetry':current});report.case(name,'injected-persistence-rollback')
    finally:ctx.close()


def auth_changed_before_commit(browser,server,report,field):
    name='late-auth-change-before-idb-'+field;print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);plan=preview(page,report,name)
        page.evaluate("""field=>{
          const original=navigator.storage.estimate.bind(navigator.storage);window.__k25LateAuthCalls=0;
          navigator.storage.estimate=async()=>{const answer=await original();window.__k25LateAuthCalls++;if(field==='role')__k25Auth.role='staff';else if(field==='epoch')KuSheERPStore.clearEphemeralSession();else __k25Auth.principal='SYN-K25-CHANGED-PRINCIPAL';return answer};
          window.__k25RestoreEstimate=()=>{navigator.storage.estimate=original};
        }""",field)
        try:outcome=call(page,CREATE,request(plan))
        finally:page.evaluate('()=>__k25RestoreEstimate()')
        after=raw(page)
        report.check(name+': authorization changes after initial validation at real capacity await',page.evaluate('()=>__k25LateAuthCalls')==1)
        if field=='epoch':report.check(name+': principal stays the same while session epoch advances',page.evaluate('()=>__k25Auth.principal')=='SYN-K25-OWNER')
        report.check(name+': late authorization loss rejects the actual commit',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'OWNER_REQUIRED',outcome)
        report.check(name+': late refusal writes no review or financial changes',after['idb']['main']==before['idb']['main'] and after['local']==before['local'] and after['session']==before['session'] and public(page)==before['idb']['main'])
        report.save(name+'.json',{'result':outcome,'before':before,'after':after});report.case(name,'commit-time-owner-recheck')
    finally:ctx.close()


def untrusted_readonly(browser,server,report):
    name='untrusted-owner-preview-only';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);page.evaluate("()=>localStorage.removeItem('kushe_erp_device_trust_v1')")
        plan=preview(page,report,name);outcome=call(page,CREATE,request(plan))
        report.check(name+': global preview disables save on an untrusted device',plan['canCreateReview'] is False and any(h['canCreateReview'] for h in rows(plan)))
        report.check(name+': untrusted device can review but cannot save',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'NOT_READY' and raw(page)==before,outcome)
        report.case(name,'trusted-device-boundary')
    finally:ctx.close()


def ephemeral_readonly(browser,server,report):
    name='temporary-owner-never-calls-cloud-commit';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name)
        switched=page.evaluate("""async()=>{
          const data=structuredClone(KuSheERPStore.getState());localStorage.removeItem('kushe_erp_device_trust_v1');
          window.__k25CloudCommitCalls=0;window.KusheCloudSync={commitTemporarySnapshot:async()=>{window.__k25CloudCommitCalls++;throw Error('SYN_K25_CLOUD_WRITER_MUST_NOT_RUN')}};
          await KuSheERPStore.loadEphemeralSnapshot(data,{userId:'SYN-K25-OWNER',syncVersion:1});return KuSheERPStore.isEphemeralMode();
        }""")
        report.check(name+': temporary synthetic session setup is active',switched is True)
        memory=public(page);plan=preview(page,report,name);outcome=call(page,CREATE,request(plan))
        report.check(name+': global preview disables save in a temporary session',plan['canCreateReview'] is False)
        report.check(name+': temporary owner save is refused before any cloud callback',not outcome['ok'] and outcome['error']['code']==ERROR_PREFIX+'NOT_READY' and page.evaluate('()=>__k25CloudCommitCalls')==0,outcome)
        report.check(name+': temporary preview and refusal preserve memory and durable baseline',public(page)==memory and raw(page)==before)
        report.case(name,'temporary-device-boundary')
    finally:ctx.close()


def assert_ui_layout(page,report,name):
    bounds=page.evaluate("""()=>{
      const d=document.querySelector('.k25-dialog').getBoundingClientRect(),f=document.querySelector('.k25-footer').getBoundingClientRect();
      return {vw:innerWidth,vh:innerHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,dialog:{left:d.left,right:d.right,top:d.top,bottom:d.bottom},footer:{left:f.left,right:f.right,top:f.top,bottom:f.bottom},contentScrollable:document.querySelector('.k25-content').scrollHeight>=document.querySelector('.k25-content').clientHeight};
    }""")
    report.check(name+': document has no horizontal viewport overflow',bounds['documentWidth']<=bounds['vw']+1 and bounds['bodyWidth']<=bounds['vw']+1,bounds)
    report.check(name+': dialog and action footer remain within viewport',bounds['dialog']['left']>=-1 and bounds['dialog']['right']<=bounds['vw']+1 and bounds['dialog']['top']>=-1 and bounds['dialog']['bottom']<=bounds['vh']+1 and bounds['footer']['bottom']<=bounds['vh']+1 and bounds['footer']['top']>=0,bounds)
    return bounds


def ui_case(browser,server,report,viewport,label):
    name='real-ui-'+label;print('RUN',name,flush=True);ctx=browser.new_context(viewport=viewport,service_workers='block',accept_downloads=True)
    try:
        page,before=boot(ctx,server,report,name,'html-text')
        page.add_style_tag(content='html,body{margin:0;font-family:Arial,"Noto Sans CJK TC","Microsoft JhengHei",sans-serif}')
        page.add_style_tag(url=server.origin+'/assets/css/p41-commission-correction.css')
        page.add_script_tag(url=server.origin+'/assets/js/p41-commission-correction-ui.js')
        page.evaluate("""()=>{const b=document.createElement('button');b.id='openCommissionCorrectionReview';b.dataset.k25Open='';b.textContent='開啟核對';document.body.appendChild(b)}""")
        page.locator('[data-k25-open]').click();page.locator('#k25CommissionReview').wait_for()
        report.check(name+': opening the real UI is read-only',raw(page)==before)
        report.check(name+': saved business text is escaped and never parsed as markup',page.locator('#k25CommissionReview img').count()==0 and not page.evaluate('()=>window.__k25Injected||false') and '<img' in page.locator('[data-k25-group="0"]').inner_text())
        report.check(name+': save initially requires selection reason and confirmation',page.locator('[data-k25-save]').is_disabled())
        layout=[assert_ui_layout(page,report,name+'-overview')]
        qa=report.output/'internal-qa';qa.mkdir(exist_ok=True);page.screenshot(path=str(qa/(label+'-overview.png')),full_page=True)
        page.locator('[data-k25-group="0"]>summary').click()
        page.locator('[data-k25-group="0"] .k25-worker>summary').first.click()
        worker_button=page.locator('[data-k25-select-worker="0"][data-k25-worker-index="0"]')
        worker_button.click()
        report.check(name+': per-worker batching selects only that workers three houses',page.locator('[data-k25-selection-count]').inner_text()=='3' and page.locator('[data-k25-group="0"] .k25-worker').first.locator('[data-k25-key]:checked').count()==3 and page.locator('[data-k25-group="0"] .k25-worker').nth(1).locator('[data-k25-key]:checked').count()==0 and raw(page)==before)
        worker_button.click();report.check(name+': worker selection can be cleared before full-group review',page.locator('[data-k25-selection-count]').inner_text()=='0')
        page.locator('[data-k25-select-group="0"]').click()
        report.check(name+': six source houses selected without changing business data',page.locator('[data-k25-selection-count]').inner_text()=='6' and raw(page)==before)
        page.locator('[data-k25-reason]').fill('SYN-K25 真實介面合成驗收')
        report.check(name+': owner confirmation remains mandatory',page.locator('[data-k25-save]').is_disabled())
        page.locator('[data-k25-confirm]').check()
        report.check(name+': valid reviewed selection enables save',page.locator('[data-k25-save]').is_enabled())
        layout.append(assert_ui_layout(page,report,name+'-expanded'))
        page.screenshot(path=str(qa/(label+'-expanded.png')),full_page=True)
        page.evaluate("()=>dispatchEvent(new CustomEvent('kushe:data-updated',{detail:{synthetic:true}}))")
        report.check(name+': any intervening store update disables stale UI submission',page.locator('[data-k25-save]').is_disabled() and raw(page)==before)
        page.locator('[data-k25-refresh]').click();page.locator('[data-k25-group="0"]>summary').click();page.locator('[data-k25-select-group="0"]').click();page.locator('[data-k25-confirm]').check()
        report.check(name+': fresh explicit review can resume',page.locator('[data-k25-save]').is_enabled())
        with page.expect_download() as download_event:page.locator('[data-k25-export]').click()
        downloaded=download_event.value;payload=json.loads(Path(downloaded.path()).read_text(encoding='utf-8'))
        report.check(name+': export contains readonly preview and no payment permission',payload.get('schema')=='kushe-commission-correction-export-v1' and flags(payload['preview']) and flags(payload['reviews']) and raw(page)==before)
        page.locator('[data-k25-save]').click();page.wait_for_function("()=>document.querySelector('[data-k25-feedback]')?.textContent.includes('已保存 6 筆')")
        after=raw(page);report.check(name+': real UI saves exactly six held records',len(ledger(after['idb']['main']))==6 and all(r['status']=='HOLD' for r in ledger(after['idb']['main'])) and page.locator('.k25-record').count()==6)
        check_protected(report,name,before['idb']['main'],after['idb']['main'])
        report.check(name+': successful UI shows saved records and explicit pending financial state',page.locator('#k25-ledger-panel').is_visible() and '實際抽成與薪資金額尚未調整' in page.locator('[data-k25-feedback]').inner_text())
        layout.append(assert_ui_layout(page,report,name+'-saved'))
        page.screenshot(path=str(qa/(label+'-saved-records.png')),full_page=True)
        page.keyboard.press('Escape');report.check(name+': escape closes dialog and returns focus to entry',page.locator('#k25CommissionReview').count()==0 and page.evaluate("()=>document.activeElement.id")=='openCommissionCorrectionReview')
        report.save(name+'.json',{'viewport':viewport,'layout':layout,'savedCount':6,'sourceTextEscaped':True,'exportReadOnly':True});report.case(name,'actual-ui')
    finally:ctx.close()


def select_browser():
    exe=shutil.which('google-chrome') or shutil.which('google-chrome-stable') or shutil.which('chromium') or shutil.which('chrome')
    if not exe and os.name=='nt':
        for key in ('ProgramFiles','ProgramFiles(x86)'):
            value=os.environ.get(key)
            if value:
                candidate=Path(value)/'Google/Chrome/Application/chrome.exe'
                if candidate.is_file():exe=str(candidate);break
    return exe


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--store',type=Path,required=True);parser.add_argument('--store-sha256');parser.add_argument('--root',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    report=Report(args.output.resolve());store=args.store.read_bytes();report.data['source']={'sha256':sha(store),'gitBlob':blob(store),'bytes':len(store)}
    try:
        if args.store_sha256:report.check('exact candidate Store SHA-256',sha(store)==args.store_sha256)
        report.check('test fixture has no production identifiers',all(x.startswith(PREFIX) for x in EMPLOYEES+HOUSES) and fixture()['meta']['k25Synthetic'] is True)
        with tempfile.TemporaryDirectory(prefix='KUSHE_K25_SYN_ONLY_') as temp, Server(store,args.root.resolve() if args.root else args.store.resolve().parents[2]) as server, sync_playwright() as p:
            exe=select_browser();launch={'headless':True,'service_workers':'block'}
            if exe:launch['executable_path']=exe
            report.data['browserExecutable']=exe or 'Playwright managed Chromium'
            positive_reopen(p,launch,server,report,Path(temp)/'durable-profile')
            launch_browser={k:v for k,v in launch.items() if k!='service_workers'}
            browser=p.chromium.launch(**launch_browser)
            try:
                cases=[('verified-receipt-review','received',None,None,True),('partial-receipt-hold','partial-receipt','RECEIPT_PARTIAL',None,True),('original-paid-house-hold','paid-house','ORIGINAL_COMMISSION_PAID',None,True),('tax-basis-conflict-hold','tax-conflict','TAX_BASIS_CONFLICT',None,True),('pending-employee-cash-hold','pending-cash','EMPLOYEE_CASH_PENDING',None,True),('broken-bank-receipt-hold','broken-bank','RECEIPT_INTEGRITY',None,True),('legacy-receipt-hold','legacy-received','LEGACY_RECEIPT_REVIEW',None,True),('duplicate-receivable-hold','duplicate-ar','RECEIPT_INTEGRITY',None,True),('negative-difference-retained','negative','NEGATIVE_DIFFERENCE',-500,True),('zero-difference-retained','zero',None,0,True),('rate-pool-mismatch-hold','rate-pool','RATE_POOL_MISMATCH',None,True),('group-source-copy-mismatch','items-mismatch','SOURCE_GROUP_INCONSISTENT',None,True),('duplicate-source-blocked','duplicate-source','SOURCE_LINK_MISMATCH',None,False),('one-house-two-bills-hold','two-bills-one-house','RECEIPT_PARTIAL',None,True),('same-month-other-source-paid','same-month-other-paid','PAID_MONTH',None,True),('payment-missing-bank-evidence','payment-bank-missing','PAYMENT_INTEGRITY',None,True),('payment-missing-payroll-evidence','payment-payroll-missing','PAYMENT_INTEGRITY',None,True),('missing-tax-mode-not-defaulted','missing-tax','TAX_BASIS_UNKNOWN',None,True)]
                cases.append(('saved-commission-amount-conflict','commission-amount-mismatch','SOURCE_LINK_MISMATCH',None,True))
                cases.append(('billing-lines-use-original-subtotal','billing-lines-subtotal-only',None,None,True))
                cases.append(('decimal-rate-pool-exact-basis-points','decimal-rate-pool',None,None,True))
                for case in cases:scenario(browser,server,report,*case)
                scope_and_summary(browser,server,report)
                invalid_requests(browser,server,report);owner_refusals(browser,server,report);stale_and_listing(browser,server,report);corrupt_ledger(browser,server,report);untrusted_readonly(browser,server,report);ephemeral_readonly(browser,server,report)
                for field in ('role','principal','epoch'):auth_changed_before_commit(browser,server,report,field)
                for target in ('primary',EMERGENCY,STORE_TOKEN,RECEIPT_TOKEN):rollback(browser,server,report,target)
                for viewport,label in [({'width':1440,'height':1000},'desktop'),({'width':390,'height':844},'mobile')]:ui_case(browser,server,report,viewport,label)
            finally:browser.close()
        report.check('all requests remained on owned loopback fixture',not report.data['externalRequests'],report.data['externalRequests'])
        report.check('no unhandled browser page errors',not report.data['pageErrors'],report.data['pageErrors'])
        report.data['status']='K25_ISOLATED_REVIEW_BROWSER_PASS';return 0
    except Exception as error:
        report.data['status']='BLOCKED';report.data['failures'].append({'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()});traceback.print_exc();return 1
    finally:
        report.flush();print(json.dumps({k:report.data.get(k) for k in ('status','passCount','failCount','source','failures')},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':raise SystemExit(main())
