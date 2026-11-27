#!/usr/bin/env python3
"""Real Store paid-month append acceptance; owned loopback + synthetic data only."""
import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import threading
import traceback
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright
from k28_fixture import (fixture, draft, PREFIX, OWNER, EMPLOYEE, OTHER_EMPLOYEE,
    CUSTOMER, PROJECT, NEW_PROJECT, PAYROLL, OLD_BATCH, OLD_COMMISSION, MONTH, NEW_DATE, NEW_COMMISSION)

BASE_COMMIT='99102d1e23b1519ff317d62b48340a919c99d133'
JOURNAL='store:transaction:journal:v1'
EMERGENCY='KuSheERP25_EMERGENCY'
STORE_TOKEN='KuSheERP25_LOCAL_COMMIT_TOKEN'
RECEIPT_TOKEN='KuSheERP25_RECEIPT_COMMIT_VERSION'
GATES=('KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED')
HTML=r'''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>SYN-K28 isolated acceptance</title><link rel="icon" href="data:,"></head><body><div id="commissionsApp"></div><script>
'use strict';window.KUSHE_PHASE1_CONFIG={};
window.__k28Auth={principal:'SYN-K28-OWNER',hasToken:true,role:'owner',status:'active',shadowVerified:true,companyId:'SYN-K28-COMPANY',contextUser:'SYN-K28-OWNER'};
window.KusheAuthGate={session:()=>({access_token:__k28Auth.hasToken?'SYN-K28-LOCAL-ONLY-TOKEN':''}),user:()=>({id:__k28Auth.principal,email:'synthetic-k28@example.invalid'}),companyContext:()=>({userId:__k28Auth.contextUser,legacySourceUserId:__k28Auth.contextUser,companyId:__k28Auth.companyId,role:__k28Auth.role,status:__k28Auth.status,shadowVerified:__k28Auth.shadowVerified}),canWrite:()=>true,canView:()=>true,requireAuth:async()=>true,requireMfa:async()=>true};
window.KuSheLegacyData={refresh(){}};window.KusheRecovery={showResult(){}};
window.__k28Raw=async()=>{
 const out={idb:{},local:{},session:{}};
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>r.transaction.abort()});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readonly'),t=tx.objectStore('erp');for(const k of ['main','store:transaction:journal:v1','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED']){const r=t.get(k);r.onsuccess=()=>{out.idb[k]=r.result??null}}tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 for(const k of ['KuSheERP25_EMERGENCY','KuSheERP25_LOCAL_COMMIT_TOKEN','KuSheERP25_RECEIPT_COMMIT_VERSION','KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_TRANSACTION_ACTIVE'])out.local[k]=localStorage.getItem(k);
 for(const k of ['KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED'])out.session[k]=sessionStorage.getItem(k);return out;
};
window.__k28Seed=async data=>{
 if(location.hostname!=='127.0.0.1'||window.__k28Seeded||data?.meta?.k28Synthetic!==true)throw Error('SYN_K28_FRESH_SYNTHETIC_ONLY');
 if(localStorage.length||sessionStorage.length||(await indexedDB.databases()).length)throw Error('SYN_K28_EMPTY_PROFILE_REQUIRED');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('KuSheERP25_Core34_DB',1);r.onupgradeneeded=()=>r.result.createObjectStore('erp');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('erp','readwrite');tx.objectStore('erp').put(data,'main');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(data));localStorage.setItem('kushe_erp_device_trust_v1',JSON.stringify({schema:'kushe-device-trust-v1',version:1,mode:'trusted',userId:'SYN-K28-OWNER'}));window.__k28Seeded=true;return true;
};
window.__k28Call=async({name,args=[]})=>{try{return {ok:true,result:await KuSheERPStore[name](...args)}}catch(e){return {ok:false,error:{name:e.name,message:e.message,code:e.code||'',transactionStatus:e.transactionStatus||'',operationId:e.operationId||''}}}};
</script></body></html>'''


def sha(raw):return hashlib.sha256(raw).hexdigest()
def stable(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))


class Report:
    def __init__(self,output,mode='candidate'):
        self.output=output;output.mkdir(parents=True,exist_ok=True)
        self.data={'schema':'k28-real-store-browser-v1','status':'RUNNING','mode':mode,'baseCommit':BASE_COMMIT,'productionDataTouched':False,'publishGate':'BLOCKED','platform':platform.platform(),'checks':[],'cases':[],'failures':[],'externalRequests':[],'pageErrors':[]}
    def check(self,name,condition,details=None):
        row={'name':name,'passed':bool(condition)}
        if details is not None:row['details']=details
        self.data['checks'].append(row)
        if not condition:self.flush();raise AssertionError(name+(': '+str(details) if details is not None else ''))
    def save(self,name,value):(self.output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def flush(self):
        self.data['passCount']=sum(x['passed'] for x in self.data['checks']);self.data['failCount']=sum(not x['passed'] for x in self.data['checks']);self.save('RESULT.json',self.data)
    def case(self,name):self.data['cases'].append({'name':name,'passed':True});self.flush()


class Server:
    def __init__(self,store,root,extra=None):
        self.resources={'/fixture.html':(HTML.encode(),'text/html; charset=utf-8'),'/assets/js/erp-store.js':(store,'text/javascript; charset=utf-8')}
        for path in (extra or []):
            self.resources['/'+path]=((root/path).read_bytes(),'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8')
        resources=self.resources
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
    allowed={server.origin+p for p in server.resources}
    def route(r):
        if r.request.method=='GET' and r.request.url in allowed:r.continue_()
        else:report.data['externalRequests'].append({'case':name,'method':r.request.method,'url':r.request.url});r.abort()
    context.route('**/*',route)
    context.on('page',lambda page:page.on('pageerror',lambda error:report.data['pageErrors'].append({'case':name,'message':str(error)})))


def call(page,name,*args):return page.evaluate('x=>__k28Call(x)',{'name':name,'args':list(args)})
def raw(page):return page.evaluate('()=>__k28Raw()')
def public(page):return page.evaluate('()=>KuSheERPStore.getState()')
def open_page(context,server):
    page=context.new_page();page.set_default_timeout(20000);page.goto(server.origin+'/fixture.html',wait_until='load');return page
def boot(context,server,report,name,kind='partial'):
    restrict(context,server,report,name);page=open_page(context,server)
    report.check(name+': seed uses owned empty browser profile',page.evaluate('x=>__k28Seed(x)',fixture(kind)) is True)
    seeded=raw(page);page.add_script_tag(url=server.origin+'/assets/js/erp-store.js')
    loaded=call(page,'load');report.check(name+': actual Store loads synthetic fixture',loaded['ok'],loaded if not loaded['ok'] else None)
    setup=call(page,'saveCustomer',{'name':CUSTOMER,'note':'SYN-K28 normalized fixture'},CUSTOMER)
    report.check(name+': synthetic baseline normalization commits',setup['ok'],setup if not setup['ok'] else None)
    before=raw(page);report.check(name+': baseline public state equals durable primary',public(page)==before['idb']['main'])
    report.save(name+'-baseline.json',{'seed':seeded,'normalized':before});return page,before


def options(page,values,batch=''):
    token=call(page,'dailyDraftSnapshot',values,batch)
    if not token['ok']:raise RuntimeError(token)
    return {'strictRows':True,'draftRowKeys':[PREFIX+'DRAFT-ROW-'+str(i) for i in range(len(values.get('lines',[])))],'expectedDailyDraftSnapshot':token['result'],'expectedDraftPrincipal':OWNER}
def review(page,report,name,values,batch=''):
    before=raw(page);state=public(page);answer=call(page,'dailyDraftReview',values,batch,state)
    report.check(name+': preview returns without mutation',answer['ok'] and raw(page)==before and public(page)==state,answer if not answer['ok'] else None)
    return answer['result']
def group(page,employee=EMPLOYEE,month=MONTH):
    answer=call(page,'monthlyPayrollGroups')
    if not answer['ok']:raise RuntimeError(answer)
    return next(g for g in answer['result'] if g['employeeId']==employee and g['month']==month)


def original_rows(report,name,before,after,mutable_payroll_ids=()):
    for key in ('dailyLogs','commissions','attendance','payroll','dailyItemPresets'):
        old=before.get(key,[]);by_id={str(r.get('id')):r for r in after.get(key,[])}
        protected=[r for r in old if not (key=='payroll' and r.get('id') in mutable_payroll_ids)]
        report.check(name+': every protected original '+key+' record preserved byte-equivalent',all(stable(by_id.get(str(r.get('id'))))==stable(r) for r in protected))
        if key=='payroll':
            derived={'days','hours','baseSalary','commission','fuel','total','updatedAt'}
            report.check(name+': explicitly allowed unpaid summary changes only calculated fields',all({k:v for k,v in r.items() if k not in derived}=={k:v for k,v in (by_id.get(str(r.get('id'))) or {}).items() if k not in derived} for r in old if r.get('id') in mutable_payroll_ids))
        report.check(name+': original '+key+' order preserved',[r.get('id') for r in after.get(key,[]) if str(r.get('id')) in {str(x.get('id')) for x in old}]==[r.get('id') for r in old])
    allowed={'dailyLogs','commissions','attendance','payroll','dailyItemPresets','meta','audit'}
    report.check(name+': all unrelated collections and settings byte-equivalent',all(stable(after.get(k))==stable(v) for k,v in before.items() if k not in allowed))


def committed(report,name,before,after,result,page,commission_delta,base_delta,mutable_payroll_ids=(),expected_date=NEW_DATE):
    report.check(name+': actual daily writer succeeds',result['ok'] and isinstance(result.get('result'),str) and bool(result['result']),result)
    b,a=before['idb']['main'],after['idb']['main'];original_rows(report,name,b,a,mutable_payroll_ids)
    logs=[r for r in a['dailyLogs'] if r.get('batchId')==result['result']]
    report.check(name+': one new employee daily source',len(logs)==1 and logs[0]['employee']==EMPLOYEE and logs[0]['date']==expected_date,logs)
    report.check(name+': new commission has exact full pretax basis',sum(r.get('commission',0) for r in logs)==commission_delta)
    new_com=[r for r in a['commissions'] if r['id'] not in {x['id'] for x in b['commissions']}]
    new_att=[r for r in a['attendance'] if r['id'] not in {x['id'] for x in b['attendance']}]
    report.check(name+': only expected new commission and attendance added',sum(r.get('commission',0) for r in new_com)==commission_delta and sum(r.get('amount',0) for r in new_att)==base_delta)
    report.check(name+': new salary source links identify only the new daily log',all(r.get('sourceType')=='daily-log' and r.get('sourceId')==logs[0]['id'] for r in new_com+new_att))
    report.check(name+': one durable revision and audit entry',a['meta']['businessSnapshotRevision']['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and len(a['audit'])==len(b['audit'])+1 and a['audit'][1:]==b['audit'])
    report.check(name+': actual journal and mirrors agree',after['idb'][JOURNAL]['phase']=='COMMIT_VERIFIED' and json.loads(after['local'][EMERGENCY])==a and json.loads(after['local'][STORE_TOKEN])['revisionId']==a['meta']['businessSnapshotRevision']['id'] and after['local'][RECEIPT_TOKEN]==a['meta']['businessSnapshotRevision']['id'])
    report.check(name+': public state is fully durable and no recovery gate remains',public(page)==a and all(after[k][gate] is None for k in ('idb','local','session') for gate in GATES))
    return logs


def positive(browser,server,report,kind='partial',mode='commission',same_project=False):
    name='append-'+kind+'-'+mode+('-same-project' if same_project else '-new-project');print('RUN',name,flush=True)
    ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,kind);values=draft(mode,PROJECT if same_project else draft()['lines'][0]['project']);g0=group(page);plan0=call(page,'salaryPaymentPlan',PAYROLL)['result']
        preview=review(page,report,name,values);report.check(name+': reviewed paid month admits new source only',not preview['issues'],preview['issues'])
        opts=options(page,values);result=call(page,'saveDailyBatch',values,'',opts);after=raw(page)
        comm=0 if mode in ('daily','hourly') else NEW_COMMISSION;base=500 if mode=='hourly' else 1000 if mode in ('daily','mixed') else 0
        logs=committed(report,name,before,after,result,page,comm,base,(PREFIX+'PAYROLL-OPEN',) if kind=='partial-summary' else ());g1=group(page)
        report.check(name+': only one editable cumulative summary is present',len([r for r in after['idb']['main']['payroll'] if r.get('employee')==EMPLOYEE and r.get('month')==MONTH])==2)
        report.check(name+': grouped total increments only by new sources',g1['total']==g0['total']+comm+base and g1['paid']==g0['paid'] and g1['outstanding']==g0['outstanding']+comm+base,{'before':g0,'after':g1})
        plan1=call(page,'salaryPaymentPlan',PAYROLL)['result']
        report.check(name+': old settled funds cannot become payable again',plan1['recordedPaid']==plan0['recordedPaid'] and plan1['settledCommission']==plan0['settledCommission'] and plan1['currentPayable']==plan0['currentPayable']+base,{'before':plan0,'after':plan1})
        if comm:
            report.check(name+': unbilled new commission remains payment-locked',plan1['lockedCommission']==plan0['lockedCommission']+comm and not any(r.get('commissionId') in {x['id'] for x in after['idb']['main']['commissions'] if x.get('sourceId')==logs[0]['id']} for r in plan1['available']))
        replay=call(page,'saveDailyBatch',values,'',opts)
        report.check(name+': stale original request cannot add a duplicate',not replay['ok'] and raw(page)==after,replay)
        report.save(name+'.json',{'preview':preview,'save':result,'replay':replay,'before':before,'after':after,'summaryBefore':g0,'summaryAfter':g1,'planBefore':plan0,'planAfter':plan1});report.case(name)
    finally:ctx.close()


def negative(browser,server,report,kind):
    name='refuse-'+kind;print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,kind);values=draft();preview=review(page,report,name,values)
        report.check(name+': review explains unresolved payment sources',bool(preview['issues']),preview)
        answer=call(page,'saveDailyBatch',values,'',options(page,values))
        report.check(name+': writer rejects without any primary mirror or public mutation',not answer['ok'] and raw(page)==before and public(page)==before['idb']['main'],answer)
        direct=call(page,'saveDailyBatch',values)
        report.check(name+': omitted UI options cannot bypass financial refusal',not direct['ok'] and direct['error']['code']=='DAILY_PAID_MONTH_UNVERIFIED' and raw(page)==before and public(page)==before['idb']['main'],direct)
        report.save(name+'.json',{'preview':preview,'strict':answer,'direct':direct,'before':before,'after':raw(page)});report.case(name)
    finally:ctx.close()


def protected_edits(browser,server,report):
    name='paid-original-edits-and-delete-still-refused';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);values=draft();results={}
        commission=dict(before['idb']['main']['commissions'][0],note='SYN-K28 forbidden paid-source edit')
        for method,args in [('saveDailyBatch',[values,OLD_BATCH]),('deleteDailyBatch',[OLD_BATCH]),('saveCommission',[commission,OLD_COMMISSION]),('deleteCommission',[OLD_COMMISSION]),('updatePayrollAdjustments',[PAYROLL,{'other':12}])]:
            outcome=call(page,method,*args);results[method]=outcome
            report.check(name+': '+method+' protects original paid history',not outcome['ok'] and outcome['error']['name']!='TypeError' and raw(page)==before and public(page)==before['idb']['main'],outcome)
        report.save(name+'.json',results);report.case(name)
    finally:ctx.close()


def snapshot_dependencies(browser,server,report):
    name='stale-snapshot-covers-bank-month-and-foreign-allocation-evidence';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);values=draft();state=public(page);current_options=options(page,values);current_token=current_options['expectedDailyDraftSnapshot']
        preview=review(page,report,name,values);report.check(name+': current source is independently eligible',not preview['issues'],preview)
        variants=[]
        original=deepcopy(state);next(row for row in original['bankTransactions'] if row['id']==PREFIX+'BANK-OUT')['amount']+=1;variants.append(('payment-bank-transaction',original))
        original=deepcopy(state);next(row for row in original['banks'] if row['id']==PREFIX+'BANK')['name']+='-OLDER-NAME';variants.append(('payment-bank-account',original))
        original=deepcopy(state);attendance=next(row for row in original['attendance'] if row['id']==PREFIX+'ATTENDANCE-OLD');report.check(name+': attendance dependency is on a different day in the same salary month',attendance['date']!=values['date'] and attendance['date'][:7]==values['date'][:7]);attendance['amount']+=25;variants.append(('other-day-month-attendance',original))
        original=deepcopy(state);commission=next(row for row in original['commissions'] if row['id']==OLD_COMMISSION);report.check(name+': commission dependency is on a different day in the same salary month',commission['date']!=values['date'] and commission['date'][:7]==values['date'][:7]);commission['commission']+=25;variants.append(('other-day-month-commission',original))
        original=deepcopy(state);foreign=deepcopy(original['salaryPayments'][0]);foreign.update(id=PREFIX+'FOREIGN-PAYMENT',payrollId=PREFIX+'PAYROLL-UNRELATED',employee=OTHER_EMPLOYEE,month='2026-03',commissionSelectionKeys=[json.dumps([OLD_COMMISSION,PREFIX+'HOUSE-B'],ensure_ascii=False,separators=(',',':'))],bankTransactionId=PREFIX+'FOREIGN-BANK-OUT');original['salaryPayments'].append(foreign);variants.append(('foreign-employee-allocation-key',original))
        outcomes=[]
        for label,original in variants:
            token=call(page,'dailyDraftSnapshot',values,'',original)
            report.check(name+': '+label+' changes the snapshot token',token['ok'] and isinstance(token.get('result'),str) and token['result']!=current_token,token if not token['ok'] else None)
            report.check(name+': '+label+' snapshot reader does not install the supplied copy',raw(page)==before and public(page)==state)
            stale_options=dict(current_options,expectedDailyDraftSnapshot=token['result']);answer=call(page,'saveDailyBatch',values,'',stale_options)
            report.check(name+': '+label+' stale actual writer is specifically refused',not answer['ok'] and answer['error']['code']=='DAILY_DRAFT_CONTEXT_CHANGED',answer)
            report.check(name+': '+label+' refusal leaves every durable layer and published state exact',raw(page)==before and public(page)==state)
            outcomes.append({'dependency':label,'oldTokenSha256':sha(token['result'].encode('utf-8')),'currentTokenSha256':sha(current_token.encode('utf-8')),'writer':answer})
        report.save(name+'.json',{'preview':preview,'dependencies':outcomes,'before':before,'after':raw(page)});report.case(name)
    finally:ctx.close()


def rollback(browser,server,report,target):
    name='rollback-'+target;print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name);values=draft();opts=options(page,values)
        page.evaluate('''target=>{const put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;window.__k28FaultCount=0;window.__k28Restore=()=>{IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set};const fault=()=>{window.__k28FaultCount++;throw Object.assign(new Error('SYN-K28-INJECTED-PERSISTENCE-FAILURE'),{code:'SYN_K28_PERSISTENCE_FAILURE'})};IDBObjectStore.prototype.put=function(value,key){if(target==='primary'&&this.name==='erp'&&key==='main'&&window.__k28FaultCount===0)fault();return put.call(this,value,key)};Storage.prototype.setItem=function(key,value){if(target!=='primary'&&this===localStorage&&key===target&&window.__k28FaultCount===0)fault();return set.call(this,key,value)}}''',target)
        try:answer=call(page,'saveDailyBatch',values,'',opts)
        finally:page.evaluate('()=>__k28Restore()')
        after=raw(page);report.check(name+': intended real persistence boundary failed once',page.evaluate('()=>__k28FaultCount')==1)
        report.check(name+': failure returns rollback rather than success',not answer['ok'] and answer['error']['code']=='SYN_K28_PERSISTENCE_FAILURE' and answer['error']['transactionStatus'] in ('ROLLED_BACK','REJECTED'),answer)
        report.check(name+': durable financial data all mirrors and published state equal baseline',after['idb']['main']==before['idb']['main'] and after['local']==before['local'] and after['session']==before['session'] and public(page)==before['idb']['main'])
        retry=call(page,'saveDailyBatch',values,'',options(page,values));current=raw(page);committed(report,name+'-retry',before,current,retry,page,NEW_COMMISSION,0)
        report.save(name+'.json',{'failure':answer,'afterFailure':after,'retry':retry,'afterRetry':current});report.case(name)
    finally:ctx.close()


def mixed_employees(browser,server,report):
    name='mixed-paid-and-unpaid-employees-one-construction';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'mixed-employees');values=draft();values['employeeIds']=[EMPLOYEE,OTHER_EMPLOYEE];values['commissionRates']={EMPLOYEE:25,OTHER_EMPLOYEE:25};values['commissionBases']={EMPLOYEE:'preTax',OTHER_EMPLOYEE:'preTax'}
        g0={e:group(page,e) for e in values['employeeIds']};preview=review(page,report,name,values);report.check(name+': both employees may append',not preview['issues'],preview)
        opts=options(page,values);answer=call(page,'saveDailyBatch',values,'',opts);after=raw(page)
        report.check(name+': mixed batch commits',answer['ok'],answer)
        b,a=before['idb']['main'],after['idb']['main'];original_rows(report,name,b,a,(PREFIX+'PAYROLL-B-OPEN',))
        logs=[x for x in a['dailyLogs'] if x.get('batchId')==answer['result']]
        report.check(name+': exactly two worker copies use full construction basis',len(logs)==2 and {x['employee'] for x in logs}=={EMPLOYEE,OTHER_EMPLOYEE} and all(x['commission']==2100 and x['commissionBaseAmount']==8400 for x in logs),logs)
        for employee in values['employeeIds']:
            current=group(page,employee);report.check(name+': employee summary increments once '+employee,current['total']==g0[employee]['total']+2100 and current['paid']==g0[employee]['paid'])
        unbilled=call(page,'unbilledWork',{'project':NEW_PROJECT});report.check(name+': customer billable construction counted once',unbilled['ok'] and len(unbilled['result'])==1 and unbilled['result'][0]['amount']==8400 and unbilled['result'][0]['count']==1,unbilled)
        report.check(name+': one atomic commit and audit for both workers',a['meta']['businessSnapshotRevision']['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and len(a['audit'])==len(b['audit'])+1 and a['audit'][1:]==b['audit'] and public(page)==a and json.loads(after['local'][EMERGENCY])==a)
        replay=call(page,'saveDailyBatch',values,'',opts);report.check(name+': stale mixed batch cannot be duplicated',not replay['ok'] and raw(page)==after,replay)
        report.save(name+'.json',{'preview':preview,'save':answer,'before':before,'after':after,'unbilled':unbilled,'replay':replay});report.case(name)
    finally:ctx.close()


def payment_month_priority(browser,server,report):
    name='payroll-month-wins-over-payment-date';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'payment-date-priority');values=draft();values['date']='2026-05-19';original_group=group(page)
        preview=review(page,report,name,values);report.check(name+': April payroll paid in May does not lock May work',not preview['issues'],preview)
        answer=call(page,'saveDailyBatch',values,'',options(page,values));after=raw(page);committed(report,name,before,after,answer,page,NEW_COMMISSION,0,expected_date='2026-05-19')
        may=group(page,EMPLOYEE,'2026-05');report.check(name+': April summary and paid history remain exact',group(page)==original_group)
        report.check(name+': May work remains entirely unpaid',may['total']==NEW_COMMISSION and may['paid']==0 and may['outstanding']==NEW_COMMISSION,may)
        report.save(name+'.json',{'preview':preview,'save':answer,'before':before,'after':after,'may':may});report.case(name)
    finally:ctx.close()


def reopen(p,launch,server,report,profile):
    name='saved-append-survives-browser-reopen';print('RUN',name,flush=True)
    ctx=p.chromium.launch_persistent_context(str(profile),**launch)
    try:
        page,before=boot(ctx,server,report,name,'full');values=draft();result=call(page,'saveDailyBatch',values,'',options(page,values));after=raw(page);committed(report,name,before,after,result,page,NEW_COMMISSION,0);summary=group(page)
    finally:ctx.close()
    ctx=p.chromium.launch_persistent_context(str(profile),**launch)
    try:
        restrict(ctx,server,report,name+'-reopen');page=open_page(ctx,server)
        report.check(name+': all storage survives reopen before Store loading',raw(page)==after)
        page.add_script_tag(url=server.origin+'/assets/js/erp-store.js');loaded=call(page,'load')
        report.check(name+': loading retains exact committed financial records',loaded['ok'] and public(page)==after['idb']['main'] and raw(page)==after and group(page)==summary,loaded if not loaded['ok'] else None)
        report.save(name+'.json',{'save':result,'after':after,'summary':summary});report.case(name)
    finally:ctx.close()


def baseline(browser,server,report):
    for kind in ('partial','full'):
        name='baseline-'+kind+'-month-lock';print('RUN',name,flush=True);ctx=browser.new_context(service_workers='block')
        try:
            page,before=boot(ctx,server,report,name,kind);values=draft();preview=review(page,report,name,values);strict=call(page,'saveDailyBatch',values,'',options(page,values));direct=call(page,'saveDailyBatch',values)
            report.check(name+': baseline reproduces reviewed month lock',any(i.get('code')=='PAYROLL_LOCKED' for i in preview['issues']) and not strict['ok'] and not direct['ok'],{'preview':preview,'strict':strict,'direct':direct})
            report.check(name+': original source rejects without business mutation',raw(page)==before and public(page)==before['idb']['main'])
            report.save(name+'.json',{'preview':preview,'strict':strict,'direct':direct,'before':before,'after':raw(page)});report.case(name)
        finally:ctx.close()


def select_browser(explicit=None):
    if explicit:return str(explicit)
    candidates=[shutil.which(name) for name in ('google-chrome','google-chrome-stable','chromium','chrome')]
    if os.name=='nt':
        candidates.extend(str(Path(os.environ[key])/'Google/Chrome/Application/chrome.exe') for key in ('ProgramFiles','ProgramFiles(x86)') if os.environ.get(key))
    for path in dict.fromkeys(x for x in candidates if x):
        if not Path(path).is_file():continue
        try:
            tested=subprocess.run([path,'--version'],capture_output=True,text=True,timeout=10)
            if tested.returncode==0:return path
        except (OSError,subprocess.SubprocessError):pass
    return None


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--store',type=Path);parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--mode',choices=('baseline','candidate'),default='candidate');parser.add_argument('--only',choices=('positive','negative','rollback','reopen','protected','snapshot'));parser.add_argument('--browser',type=Path);args=parser.parse_args()
    root=args.root.resolve();store=subprocess.check_output(['git','show',BASE_COMMIT+':assets/js/erp-store.js'],cwd=root) if args.mode=='baseline' else (args.store or root/'assets/js/erp-store.js').read_bytes();report=Report(args.output.resolve(),args.mode);report.data['source']={'sha256':sha(store),'bytes':len(store)}
    try:
        with tempfile.TemporaryDirectory(prefix='KUSHE_K28_SYN_ONLY_') as temp,Server(store,root) as server,sync_playwright() as p:
            executable=select_browser(args.browser);launch={'headless':True,'service_workers':'block'}
            if executable:launch['executable_path']=executable
            report.data['browserExecutable']=executable or 'Playwright managed Chromium'
            browser=p.chromium.launch(**{k:v for k,v in launch.items() if k!='service_workers'})
            try:
                if args.mode=='baseline':baseline(browser,server,report)
                else:
                    if args.only in (None,'positive'):
                        for kind,mode,same in [('partial','commission',False),('full','commission',False),('partial-summary','commission',False),('receipt-reversed','commission',False),('partial','commission',True),('partial','daily',False),('partial','hourly',False),('partial','mixed',False)]:positive(browser,server,report,kind,mode,same)
                        mixed_employees(browser,server,report);payment_month_priority(browser,server,report)
                    if args.only in (None,'negative'):
                        for kind in ('legacy-payment','legacy-bank','missing-bank','wrong-bank-direction','bank-amount-mismatch','allocation-amount-mismatch','unknown-allocation','duplicate-selection','duplicate-payment','source-missing','wrong-employee','stale-payroll-status','cross-employee-unpaid-key','cross-month-unpaid-key','cross-paid-key','conflicting-employee-fields','empty-daily-items','array-payment-amount','blank-payment-amount','nan-payment-amount','cross-employee-duplicate-source','raw-summary-mismatch'):negative(browser,server,report,kind)
                    if args.only in (None,'protected'):protected_edits(browser,server,report)
                    if args.only in (None,'snapshot'):snapshot_dependencies(browser,server,report)
                    if args.only in (None,'rollback'):
                        for target in ('primary',EMERGENCY,STORE_TOKEN,RECEIPT_TOKEN):rollback(browser,server,report,target)
            finally:browser.close()
            if args.mode=='candidate' and args.only in (None,'reopen'):reopen(p,launch,server,report,Path(temp)/'durable-profile')
        report.check('all browser requests stayed within exact owned loopback allowlist',not report.data['externalRequests'],report.data['externalRequests']);report.check('no unhandled browser page errors',not report.data['pageErrors'],report.data['pageErrors']);report.data['status']='K28_BASELINE_CONFIRMED' if args.mode=='baseline' else 'K28_ISOLATED_STORE_PASS';return 0
    except Exception as error:
        report.data['status']='BLOCKED';report.data['failures'].append({'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()});traceback.print_exc();return 1
    finally:report.flush();print(json.dumps({k:report.data[k] for k in ('status','passCount','failCount','source','failures')},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':raise SystemExit(main())
