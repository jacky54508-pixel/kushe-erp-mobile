#!/usr/bin/env python3
"""Actual Store + manual commission UI on an owned, allowlisted loopback origin.

The existing K28 browser/IndexedDB harness is reused without replacing Store
writers or UI handlers. Fixture HTML is changed only to require K29 synthetic
data and a K29 synthetic principal. No production origin or cloud code loads.
"""
import argparse
import json
import subprocess
import sys
import traceback
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.p41-k28-tests'))
from k28_browser_store import (Report,Server,HTML,restrict,open_page,call,raw,
    public,sha,select_browser,EMERGENCY,JOURNAL,STORE_TOKEN,RECEIPT_TOKEN)
from playwright.sync_api import sync_playwright
from commission_fixture import (fixture,values,PREFIX,CUSTOMER,EMPLOYEE,
    OTHER_EMPLOYEE,PROJECT,OTHER_PROJECT,BILL,OTHER_BILL,COMMISSION,MONTH,DATE)

BASE_REF='15eff6fc574fb64480682656daf88dc7a906baa8'
STYLES=('assets/css/app.css','assets/css/commissions-scoped.css')
VIEWPORTS={'desktop':{'width':1440,'height':1000},'mobile':{'width':390,'height':844}}


def boot(browser,server,report,name,kind='retention',existing=True,viewport='desktop'):
    context=browser.new_context(viewport=VIEWPORTS[viewport],is_mobile=viewport=='mobile',has_touch=viewport=='mobile',service_workers='block')
    restrict(context,server,report,name)
    page=open_page(context,server)
    report.check(name+': seed fresh owned profile with synthetic records',page.evaluate('data=>__k28Seed(data)',fixture(kind,existing)))
    page.add_script_tag(url=server.origin+'/assets/js/erp-store.js')
    loaded=call(page,'load');report.check(name+': actual Store loads fixture',loaded['ok'],loaded if not loaded['ok'] else None)
    setup=call(page,'saveCustomer',{'name':CUSTOMER,'note':PREFIX+'normalized baseline'},CUSTOMER)
    report.check(name+': isolated fixture normalization commits',setup['ok'],setup if not setup['ok'] else None)
    before=raw(page);report.check(name+': public and durable baseline agree',public(page)==before['idb']['main'])
    page.evaluate('''()=>{
      document.body.dataset.route='commissions';
      const root=document.querySelector('#commissionsApp'),section=document.createElement('section');section.id='commissionsView';section.className='view';root.before(section);section.append(root);
      const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';document.head.append(viewport);
      window.__commissionToasts=[];window.KusheKpi={register(){}};window.KushePhase1={toast(message){__commissionToasts.push(String(message))}};
    }''')
    for path in STYLES:page.add_style_tag(url=server.origin+'/'+path)
    page.add_script_tag(url=server.origin+'/assets/js/commissions.js')
    page.evaluate('()=>KusheCommissions.activate()')
    page.locator('#commissionMonthFilter').fill(MONTH);page.locator('#commissionMonthFilter').dispatch_event('change')
    page.locator('[data-workforce-tab="commissions"]').click()
    report.check(name+': actual UI opening never writes business data',raw(page)==before and public(page)==before['idb']['main'])
    return context,page,before


def fields(page):
    return page.evaluate('()=>Object.fromEntries(new FormData(document.querySelector("#commissionForm")))')


def open_existing(page):
    # Desktop and mobile render separate buttons for the same record. CSS
    # chooses the active presentation at this viewport; keep strict clicking
    # so a missing or duplicate visible control still fails the real UI test.
    page.locator('#commissionsApp [data-edit="'+COMMISSION+'"]:visible').click()
    page.locator('#commissionForm').wait_for(state='visible')


def open_new(page,kind='retention'):
    page.locator('#manualCommission').click();page.locator('#commissionForm').wait_for(state='visible')
    page.locator('#commissionForm [name=employee]').select_option(EMPLOYEE)
    page.locator('#commissionForm [name=billing]').select_option(BILL)
    page.locator('#commissionForm [name=rate]').fill('30')
    page.locator('#commissionForm [name=status]').select_option('已列入薪資')
    page.locator('#commissionForm [name=note]').fill(PREFIX+'new '+kind)


def durable(report,name,page,before,allowed=('commissions','payroll')):
    after=raw(page);a,b=after['idb']['main'],before['idb']['main']
    report.check(name+': unrelated financial records remain exact',all(a.get(k)==v for k,v in b.items() if k not in {*allowed,'meta','audit'}))
    report.check(name+': one durable revision and audit entry',a['meta']['businessSnapshotRevision']['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and len(a['audit'])==len(b['audit'])+1)
    report.check(name+': real primary emergency mirror public state and tokens agree',public(page)==a and json.loads(after['local'][EMERGENCY])==a and after['idb'][JOURNAL]['phase']=='COMMIT_VERIFIED' and json.loads(after['local'][STORE_TOKEN])['revisionId']==a['meta']['businessSnapshotRevision']['id'] and after['local'][RECEIPT_TOKEN]==a['meta']['businessSnapshotRevision']['id'])
    return after


def submit(page):
    page.locator('#commissionForm button[type=submit]').click()
    page.locator('#commissionForm').wait_for(state='detached')


def new_case(browser,server,report,kind,viewport='desktop',baseline=False):
    name=('baseline-' if baseline else '')+'new-'+kind+'-'+viewport;print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,kind,False,viewport)
    try:
        open_new(page,kind);draft=fields(page)
        expected_base=19000 if baseline and kind=='retention' else 19048 if baseline and kind=='no-invoice' else 20000
        expected_commission=round(expected_base*.30)
        report.check(name+': actual form has the expected source basis and percentage',float(draft['untaxedAmount'])==expected_base and float(draft['commission'])==expected_commission,draft)
        if not baseline:
            report.check(name+': a selected bill displays its gross before retention',float(draft['gross'])==(20000 if kind=='no-invoice' else 21000) and page.locator('#commissionForm [name=gross]').get_attribute('readonly') is not None)
        submit(page);after=durable(report,name,page,before);rows=after['idb']['main']['commissions']
        report.check(name+': actual Store persists exactly one linked commission',len(rows)==1 and rows[0]['untaxedAmount']==expected_base and rows[0]['commission']==expected_commission and rows[0]['sourceId']==BILL and rows[0]['billingId']==BILL,rows)
        groups=call(page,'monthlyPayrollGroups')['result']
        report.check(name+': payroll includes the commission exactly once',sum(g['total'] for g in groups if g['employeeId']==EMPLOYEE and g['month']==MONTH)==expected_commission)
        report.save(name+'.json',{'draft':draft,'before':before,'after':after});report.case(name)
    finally:context.close()


def note_case(browser,server,report,kind,viewport='desktop',baseline=False):
    name=('baseline-' if baseline else '')+'note-only-'+kind+'-'+viewport;print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,kind,True,viewport)
    try:
        original=before['idb']['main']['commissions'][0]
        open_existing(page);draft=fields(page)
        expected_base=19000 if baseline and kind=='retention' else 19048 if baseline and kind=='no-invoice' else original['untaxedAmount']
        expected_commission=round(float(expected_base)*.25) if baseline else original['commission']
        report.check(name+': opening existing form has expected base and saved commission',float(draft['untaxedAmount'])==float(expected_base) and float(draft['commission'])==float(expected_commission),draft)
        report.check(name+': opening drawer did not modify durable or public data',raw(page)==before and public(page)==before['idb']['main'])
        page.locator('#commissionForm [name=note]').fill(PREFIX+'changed note only');submit(page)
        after=durable(report,name,page,before,('commissions','payroll') if baseline else ('commissions',));row=after['idb']['main']['commissions'][0]
        report.check(name+': actual saved monetary fields match expected result',row['untaxedAmount']==expected_base and row['commission']==expected_commission,row)
        if not baseline:
            report.check(name+': every original field except note and update time stays exact',all(row.get(key)==value for key,value in original.items() if key not in ('note','updatedAt')) and set(row)==set(original))
            report.check(name+': note-only edit leaves every payroll row exact',after['idb']['main']['payroll']==before['idb']['main']['payroll'])
            open_existing(page);report.check(name+': reopening preserved historical values',float(fields(page)['commission'])==float(original['commission']) and raw(page)==after)
        report.save(name+'.json',{'draft':draft,'before':before,'after':after});report.case(name)
    finally:context.close()


def financial_edit(browser,server,report,change):
    name='explicit-'+change;print('RUN',name,flush=True)
    kind='same-amount-new-source' if change=='source' else 'partial' if change=='rate' else 'manual'
    context,page,before=boot(browser,server,report,name,kind)
    try:
        open_existing(page)
        if change=='rate':page.locator('#commissionForm [name=rate]').fill('30');expected=2400
        elif change=='source':page.locator('#commissionForm [name=billing]').select_option(OTHER_BILL);expected=5000
        elif change=='employee':page.locator('#commissionForm [name=employee]').select_option(OTHER_EMPLOYEE);expected=2000
        elif change=='month':page.locator('#commissionForm [name=date]').fill('2026-05-09');page.locator('#commissionForm [name=date]').dispatch_event('change');expected=2000
        elif change=='project':page.locator('#commissionForm [name=project]').select_option(OTHER_PROJECT);expected=2000
        elif change=='status':page.locator('#commissionForm [name=status]').select_option('未列入薪資');expected=2000
        else:raise ValueError(change)
        draft=fields(page);report.check(name+': explicit change displays the intended recomputed amount',float(draft['commission'])==expected,draft)
        submit(page);after=durable(report,name,page,before);row=after['idb']['main']['commissions'][0]
        report.check(name+': actual writer applies only the intentional new basis or rate',row['commission']==expected and row['untaxedAmount']==(20000 if change=='source' else 8000),row)
        if change=='source':report.check(name+': equal bill amount still changes source and recalculates stale old commission',row['sourceId']==OTHER_BILL and row['billingId']==OTHER_BILL and row['sourceNo']==OTHER_BILL+'-NO' and before['idb']['main']['commissions'][0]['commission']==4777)
        groups=call(page,'monthlyPayrollGroups')['result']
        target_employee=OTHER_EMPLOYEE if change=='employee' else EMPLOYEE
        target_month='2026-05' if change=='month' else MONTH
        target_total=sum(g['total'] for g in groups if g['employeeId']==target_employee and g['month']==target_month)
        report.check(name+': correct employee month receives rebuilt wages',target_total==(0 if change=='status' else expected),groups)
        if change in ('employee','month'):
            report.check(name+': original employee month no longer retains moved salary',sum(g['total'] for g in groups if g['employeeId']==EMPLOYEE and g['month']==MONTH)==0,groups)
            old=next((r for r in after['idb']['main']['payroll'] if r['id']==before['idb']['main']['payroll'][0]['id']),None)
            report.check(name+': old persisted summary is empty or removed by existing rebuild rules',old is None or old['commission']==0 and old['total']==0,old)
        report.save(name+'.json',{'draft':draft,'before':before,'after':after,'groups':groups});report.case(name)
    finally:context.close()


def free_manual(browser,server,report):
    name='new-unlinked-manual-input';print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,'retention',False)
    try:
        page.locator('#manualCommission').click()
        page.locator('#commissionForm [name=employee]').select_option(EMPLOYEE)
        page.locator('#commissionForm [name=project]').select_option(PROJECT)
        page.locator('#commissionForm [name=date]').fill(DATE)
        page.locator('#commissionForm [name=gross]').fill('21000')
        page.locator('#commissionForm [name=rate]').fill('25')
        page.locator('#commissionForm [name=status]').select_option('已列入薪資')
        draft=fields(page);report.check(name+': free manual amount retains existing tax calculation',float(draft['untaxedAmount'])==20000 and float(draft['commission'])==5000,draft)
        submit(page);after=durable(report,name,page,before);row=after['idb']['main']['commissions'][0]
        report.check(name+': manual entry does not invent a billing link',row['commission']==5000 and row['untaxedAmount']==20000 and not row.get('sourceId') and not row.get('billingId'),row)
        report.save(name+'.json',{'draft':draft,'before':before,'after':after});report.case(name)
    finally:context.close()


def invalid_source(browser,server,report,kind):
    name='refuse-new-'+kind;print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,kind,False)
    try:
        page.locator('#manualCommission').click();page.locator('#commissionForm [name=employee]').select_option(EMPLOYEE)
        page.locator('#commissionForm [name=billing]').select_option(BILL)
        report.check(name+': actual source selection explains invalid saved amounts',not page.locator('#commissionForm [name=billing]').evaluate('(field)=>field.checkValidity()'))
        result=call(page,'saveCommission',{'date':DATE,'employee':EMPLOYEE,'project':PROJECT,'billing':BILL,'untaxedAmount':20000,'rate':25,'status':'已列入薪資','commissionAmountMode':'billing'})
        report.check(name+': actual writer refuses guessing invalid source',not result['ok'] and raw(page)==before and public(page)==before['idb']['main'],result)
        report.save(name+'.json',{'result':result,'after':raw(page)});report.case(name)
    finally:context.close()


def protected_source(browser,server,report,kind):
    name='preserve-'+kind+'-gate';print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,kind)
    try:
        report.check(name+': UI does not expose protected source edit',page.locator('[data-edit="'+COMMISSION+'"]').count()==0)
        result=call(page,'saveCommission',values(before['idb']['main'],note=PREFIX+'forbidden edit'),COMMISSION)
        report.check(name+': direct actual Store refuses protected edit',not result['ok'] and raw(page)==before and public(page)==before['idb']['main'],result)
        if kind=='paid':
            open_new(page,'paid');draft=fields(page)
            page.locator('#commissionForm button[type=submit]').click()
            page.wait_for_function('()=>window.__commissionToasts.some(text=>text.includes("儲存失敗"))')
            report.check(name+': actual paid-month manual form refuses without losing draft',raw(page)==before and fields(page)==draft and page.locator('#commissionForm button[type=submit]').is_enabled())
            result=call(page,'saveCommission',{'date':DATE,'employee':EMPLOYEE,'project':PROJECT,'billing':BILL,'untaxedAmount':20000,'rate':25,'status':'已列入薪資'})
            report.check(name+': paid-month new manual gate stays closed',not result['ok'] and raw(page)==before,result)
        report.save(name+'.json',result);report.case(name)
    finally:context.close()


def stale_and_direct(browser,server,report):
    name='store-preservation-and-stale-guards';print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,'partial')
    try:
        old=before['idb']['main']['commissions'][0]
        snapshot=page.evaluate('id=>JSON.stringify(KuSheERPStore.getState().commissions.find(row=>row.id===id))',COMMISSION)
        payload=values(before['idb']['main'],note=PREFIX+'direct note',expectedCommissionSnapshot=snapshot)
        result=call(page,'saveCommission',payload,COMMISSION);report.check(name+': direct note-only writer succeeds',result['ok'],result)
        after=durable(report,name,page,before,('commissions',))
        report.check(name+': direct caller preserves historical amount without relying on UI',after['idb']['main']['commissions'][0]['commission']==old['commission'])
        stale=call(page,'saveCommission',payload,COMMISSION)
        report.check(name+': stale exact original row is refused without a second commit',not stale['ok'] and raw(page)==after,stale)
        missing=call(page,'saveCommission',payload,PREFIX+'REMOVED')
        report.check(name+': missing edit never turns into an accidental insert',not missing['ok'] and raw(page)==after,missing)
        invalid=call(page,'saveCommission',{'date':DATE,'employee':EMPLOYEE,'project':PROJECT,'billing':BILL,'untaxedAmount':20000,'rate':25,'status':'已列入薪資','expectedCommissionBillingSnapshot':'SYN-K29 stale billing'})
        report.check(name+': changed saved billing cannot be silently substituted',not invalid['ok'] and raw(page)==after,invalid)
        partial=call(page,'saveCommission',{'date':DATE,'employee':EMPLOYEE,'project':PROJECT,'billing':BILL,'untaxedAmount':8000,'rate':25,'status':'已列入薪資'})
        report.check(name+': undeclared partial new amount is never promoted to whole bill',not partial['ok'] and raw(page)==after,partial)
        report.save(name+'.json',{'direct':result,'stale':stale,'missing':missing,'billingChanged':invalid,'partialNew':partial});report.case(name)
    finally:context.close()


def source_scope(browser,server,report,existing=False):
    name='source-scope-'+('existing' if existing else 'new');print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,'partial' if existing else 'retention',existing)
    try:
        if existing:open_existing(page)
        else:open_new(page)
        page.locator('#commissionForm [name=project]').select_option(OTHER_PROJECT)
        report.check(name+': UI rejects a different project under the same bill',not page.locator('#commissionForm [name=project]').evaluate('(field)=>field.checkValidity()'))
        if existing:payload=values(before['idb']['main'],project=OTHER_PROJECT)
        else:payload={'date':DATE,'employee':EMPLOYEE,'project':OTHER_PROJECT,'billing':BILL,'untaxedAmount':20000,'rate':30,'status':'已列入薪資','commissionAmountMode':'billing'}
        result=call(page,'saveCommission',payload,*([COMMISSION] if existing else []))
        report.check(name+': Store rejects cross-project source without mutations',not result['ok'] and raw(page)==before,result)
        page.locator('#commissionForm [name=project]').select_option(PROJECT)
        if existing:
            page.locator('#commissionForm [name=sourceNo]').fill(OTHER_BILL+'-NO');page.locator('#commissionForm [name=sourceNo]').dispatch_event('change')
            report.check(name+': UI refuses a source number conflicting with retained IDs',not page.locator('#commissionForm [name=sourceNo]').evaluate('(field)=>field.checkValidity()'))
            result=call(page,'saveCommission',values(before['idb']['main'],sourceNo=OTHER_BILL+'-NO'),COMMISSION)
            report.check(name+': Store rejects contradictory source number',not result['ok'] and raw(page)==before,result)
        else:
            page.locator('#commissionForm [name=date]').fill('2026-05-09');page.locator('#commissionForm [name=date]').dispatch_event('change')
            submit(page);after=durable(report,name,page,before);row=after['idb']['main']['commissions'][0]
            report.check(name+': commission month may differ from billing date',row['date']=='2026-05-09' and row['sourceId']==BILL and row['commission']==6000,row)
            groups=call(page,'monthlyPayrollGroups')['result']
            report.check(name+': selected earning month receives exact salary',sum(g['total'] for g in groups if g['employeeId']==EMPLOYEE and g['month']=='2026-05')==6000,groups)
        report.save(name+'.json',{'result':result,'after':raw(page)});report.case(name)
    finally:context.close()


def legacy_note_evidence(browser,server,report):
    name='legacy-note-source-evidence';print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,'legacy-note')
    try:
        open_existing(page);draft=fields(page)
        report.check(name+': partial legacy amount is preserved when opened',float(draft['untaxedAmount'])==8000 and float(draft['commission'])==1777,draft)
        page.locator('#commissionForm [name=note]').fill(PREFIX+'would remove sole source evidence')
        page.locator('#commissionForm button[type=submit]').click()
        page.wait_for_function('()=>window.__commissionToasts.some(text=>text.includes("來源仍依"))')
        report.check(name+': note edit cannot sever the only verified source or auto-rebind whole bill',raw(page)==before and public(page)==before['idb']['main'] and page.locator('#commissionForm').is_visible())
        report.save(name+'.json',{'draft':draft,'after':raw(page),'messages':page.evaluate('()=>__commissionToasts')});report.case(name)
    finally:context.close()


def missing_date(browser,server,report,kind):
    name='preserve-'+kind;print('RUN',name,flush=True)
    context,page,before=boot(browser,server,report,name,kind)
    try:
        original=before['idb']['main']['commissions'][0]
        page.locator('#commissionMonthFilter').fill('');page.locator('#commissionMonthFilter').dispatch_event('change')
        open_existing(page)
        report.check(name+': missing date is not replaced with today and required gate remains',page.locator('#commissionForm [name=date]').input_value()=='' and page.locator('#commissionForm [name=date]').get_attribute('required') is not None)
        page.locator('#commissionForm [name=note]').fill(PREFIX+'note with missing date');page.locator('#commissionForm button[type=submit]').click()
        report.check(name+': incomplete UI date does not change raw data or silently move month',raw(page)==before and public(page)==before['idb']['main'])
        result=call(page,'saveCommission',values(before['idb']['main'],note=PREFIX+'direct note preserving missing date'),COMMISSION)
        report.check(name+': existing direct note edit can preserve exact missing date',result['ok'],result)
        after=durable(report,name,page,before,('commissions',));row=after['idb']['main']['commissions'][0]
        report.check(name+': raw date presence and all financial fields are preserved',set(row)==set(original) and all(row.get(k)==v for k,v in original.items() if k not in ('note','updatedAt')),row)
        report.save(name+'.json',{'result':result,'before':before,'after':after});report.case(name)
    finally:context.close()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=ROOT);parser.add_argument('--store',type=Path);parser.add_argument('--ui',type=Path);parser.add_argument('--baseline-ref',default=BASE_REF);parser.add_argument('--mode',choices=('baseline','candidate'),default='candidate');parser.add_argument('--output',type=Path,required=True);parser.add_argument('--browser',type=Path);args=parser.parse_args()
    root=args.root.resolve();report=Report(args.output.resolve(),args.mode);report.data.update(schema='k29-manual-commission-real-browser-v1',baseCommit=args.baseline_ref)
    try:
        def source(path,override):
            return subprocess.check_output(['git','show',args.baseline_ref+':'+path],cwd=root) if args.mode=='baseline' else (override or root/path).read_bytes()
        store=source('assets/js/erp-store.js',args.store);ui=source('assets/js/commissions.js',args.ui)
        report.data['source']={'storeSha256':sha(store),'uiSha256':sha(ui)}
        with Server(store,root,STYLES) as server,sync_playwright() as p:
            html=HTML.replace('SYN-K28-','SYN-K29-').replace('meta?.k28Synthetic','meta?.k29Synthetic')
            server.resources['/fixture.html']=(html.encode(),'text/html; charset=utf-8')
            server.resources['/assets/js/commissions.js']=(ui,'text/javascript; charset=utf-8')
            executable=select_browser(args.browser);report.data['browserExecutable']=executable or 'Playwright managed Chromium'
            browser=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
            try:
                if args.mode=='baseline':
                    for kind in ('retention','no-invoice'):new_case(browser,server,report,kind,baseline=True);note_case(browser,server,report,kind,baseline=True)
                else:
                    for kind in ('retention','no-invoice','tax-included'):new_case(browser,server,report,kind)
                    for kind in ('retention','no-invoice','partial','orphan','conflicting-source','invalid-alias','raw-strings','missing-source-fields','missing-status','blank-status'):note_case(browser,server,report,kind)
                    new_case(browser,server,report,'retention','mobile');note_case(browser,server,report,'partial','mobile')
                    free_manual(browser,server,report)
                    for change in ('rate','source','employee','month','project','status'):financial_edit(browser,server,report,change)
                    for kind in ('invalid-alias','missing-gross','duplicate-id'):invalid_source(browser,server,report,kind)
                    for kind in ('paid','daily'):protected_source(browser,server,report,kind)
                    stale_and_direct(browser,server,report)
                    source_scope(browser,server,report,False);source_scope(browser,server,report,True);legacy_note_evidence(browser,server,report)
                    for kind in ('missing-date','blank-date'):missing_date(browser,server,report,kind)
            finally:browser.close()
        report.check('all browser requests stayed inside the exact loopback allowlist',not report.data['externalRequests'],report.data['externalRequests'])
        report.check('actual Store and UI produced no unhandled page errors',not report.data['pageErrors'],report.data['pageErrors'])
        report.data['status']='K29_COMMISSION_BASELINE_REPRODUCED' if args.mode=='baseline' else 'K29_COMMISSION_STORE_UI_PASS';return 0
    except Exception as error:
        report.data['status']='BLOCKED';report.data['failures'].append({'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()});traceback.print_exc();return 1
    finally:
        report.flush();print(json.dumps({k:report.data.get(k) for k in ('status','passCount','failCount','source','failures')},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':raise SystemExit(main())
