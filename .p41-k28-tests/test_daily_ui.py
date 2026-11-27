#!/usr/bin/env python3
"""K28 real daily drawer + payroll displays, with isolated synthetic records only.

Only allowlisted assets served from an owned loopback server are loaded. The
actual daily form, draft-review controller, Store transaction, and dashboard
projection are used. No production origin or cloud-sync code is loaded.
"""
import argparse
import json
import traceback
from copy import deepcopy
from pathlib import Path

from playwright.sync_api import sync_playwright
from k28_browser_store import (Report, Server, boot, call, raw, public, group,
    original_rows, sha, select_browser, STORE_TOKEN, RECEIPT_TOKEN, JOURNAL,
    EMERGENCY, GATES, restrict, open_page)
from k28_fixture import (PREFIX, EMPLOYEE, NEW_PROJECT, OLD_BATCH, MONTH,
    NEW_DATE, NEW_AMOUNT, NEW_COMMISSION, CUSTOMER, BANK, PAYROLL, fixture)

SCRIPTS = (
    'assets/js/project-billing-defaults.js',
    'assets/js/daily-draft-review.js',
    'assets/js/commissions.js',
    'assets/js/dashboard.js',
)
STYLES = (
    'assets/css/app.css',
    'assets/css/commissions-scoped.css',
    'assets/css/daily-pay-compact.css',
    'assets/css/daily-draft-review.css',
    'assets/css/project-billing-defaults.css',
)
VIEWPORTS = {'desktop': {'width': 1440, 'height': 1000},
             'mobile': {'width': 390, 'height': 844}}


def mount(page, server, report, name, fallback=False):
    before = raw(page)
    page.evaluate('''fallback=>{
      document.body.dataset.route='commissions';
      const root=document.querySelector('#commissionsApp'),section=document.createElement('section');
      section.id='commissionsView';section.className='view';root.before(section);section.append(root);
      const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';document.head.append(viewport);
      window.__k28Kpi={};window.__k28Toasts=[];
      window.KusheKpi={register(name,handler){window.__k28Kpi[name]=handler}};
      window.KushePhase1={toast(message){window.__k28Toasts.push(String(message))}};
      if(fallback){window.__k28RealStore=window.KuSheERPStore;window.KuSheERPStore={...window.__k28RealStore,monthlyPayrollGroups:undefined}}
    }''', fallback)
    for path in STYLES:
        page.add_style_tag(url=server.origin+'/'+path)
    for path in SCRIPTS:
        page.add_script_tag(url=server.origin+'/'+path)
    page.evaluate('()=>KusheCommissions.activate()')
    page.locator('#commissionMonthFilter').fill(MONTH)
    page.locator('#commissionMonthFilter').dispatch_event('change')
    report.check(name+': actual UI mounting is read-only', raw(page)==before and public(page)==before['idb']['main'])


def fill_daily(page):
    page.locator('#addCommission').click()
    page.locator('#dailyWorkForm').wait_for(state='visible')
    page.locator('#dailyWorkForm [name=date]').fill(NEW_DATE)
    page.locator('#dailyWorkForm [name=dailyEmployees][value="'+EMPLOYEE+'"]').check()
    page.locator('#dailyWorkForm .daily-house-project').select_option(NEW_PROJECT)
    page.locator('#dailyWorkForm .daily-house-name').fill(PREFIX+'NEW-HOUSE')
    page.locator('#dailyWorkForm .daily-house-name').dispatch_event('change')
    page.locator('#dailyWorkForm .daily-line-choice').select_option('manual')
    page.locator('#dailyWorkForm .daily-line-item').fill(PREFIX+'NEW-WORK')
    page.locator('#dailyWorkForm .daily-line-price').fill(str(NEW_AMOUNT))
    page.locator('#dailyWorkForm .daily-line-qty').fill('1')
    page.locator('#dailyWorkForm [name=note]').fill('SYN-K28 actual drawer acceptance')
    return page.evaluate('()=>document.querySelector("#dailyWorkForm")._dailySubmitContext.readDraft()')


def submit_twice(page):
    # Two synchronous native form submissions also cover a second click arriving
    # while the first asynchronous Store writer is still pending.
    page.evaluate('''()=>{const form=document.querySelector('#dailyWorkForm');form.requestSubmit();form.requestSubmit()}''')


def assert_append(report, name, page, before):
    after=raw(page);batch=page.locator('#dailyWorkForm').get_attribute('data-last-saved-batch')
    b,a=before['idb']['main'],after['idb']['main']
    original_rows(report,name,b,a)
    new=[r for r in a['dailyLogs'] if r['id'] not in {x['id'] for x in b['dailyLogs']}]
    report.check(name+': repeated submit produced exactly one new daily source',len(new)==1 and new[0]['batchId']==batch and new[0]['commission']==NEW_COMMISSION, new)
    report.check(name+': UI result is one durable transaction',a['meta']['businessSnapshotRevision']['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and len(a['audit'])==len(b['audit'])+1)
    report.check(name+': public primary mirror and commit markers agree',public(page)==a and json.loads(after['local'][EMERGENCY])==a and after['idb'][JOURNAL]['phase']=='COMMIT_VERIFIED' and json.loads(after['local'][STORE_TOKEN])['revisionId']==a['meta']['businessSnapshotRevision']['id'] and after['local'][RECEIPT_TOKEN]==a['meta']['businessSnapshotRevision']['id'])
    report.check(name+': no recovery gate remains',all(after[k][gate] is None for k in ('idb','local','session') for gate in GATES))
    return after


def summaries(page):
    return page.evaluate('''month=>{
      const dashboard=KusheDashboard.readSnapshot(month),attention=dashboard.attentions.find(row=>row.type==='薪資待結算'),unpaid=window.__k28Kpi.workforce.read('unpaid');
      return {total:dashboard.payrollTotal,paid:dashboard.payrollPaid,outstanding:dashboard.payrollOpen,attention,unpaid,
       card:document.querySelector('[data-kpi="workforce.unpaid"]').textContent};
    }''', MONTH)


def success(browser, server, report, viewport, kind):
    name='daily-ui-'+viewport+'-'+kind;print('RUN',name,flush=True)
    ctx=browser.new_context(viewport=VIEWPORTS[viewport],is_mobile=viewport=='mobile',has_touch=viewport=='mobile',service_workers='block',accept_downloads=True)
    try:
        page,before=boot(ctx,server,report,name,kind);initial=group(page)
        mount(page,server,report,name)
        paid_row=page.locator(('[data-daily-card="' if viewport=='mobile' else '[data-daily-batch="')+OLD_BATCH+'"]')
        report.check(name+': original source is actually rendered with the paid lock',paid_row.is_visible() and '已付款鎖定' in paid_row.inner_text())
        report.check(name+': original paid source has no edit or delete control',page.locator('[data-daily-edit="'+OLD_BATCH+'"]').count()==0 and page.locator('[data-daily-delete="'+OLD_BATCH+'"]').count()==0)
        values=fill_daily(page)
        report.check(name+': actual form has one employee at fifty percent and no work pay',values['employeeIds']==[EMPLOYEE] and float(values['commissionRates'][EMPLOYEE])==50 and values['workMode']=='none')
        submit_twice(page)
        page.wait_for_function('()=>Boolean(document.querySelector("#dailyWorkForm")?.dataset.lastSavedBatch)')
        page.wait_for_function('()=>document.querySelector("#dailyWorkForm .daily-save-feedback")?.dataset.tone==="success"')
        after=assert_append(report,name,page,before);current=group(page)
        report.check(name+': only new commission changes grouped wages',current['total']==initial['total']+NEW_COMMISSION and current['paid']==initial['paid'] and current['outstanding']==initial['outstanding']+NEW_COMMISSION)
        report.check(name+': next-entry template clears house and quantity only',page.locator('#dailyWorkForm .daily-house-name').input_value()=='' and page.locator('#dailyWorkForm .daily-line-qty').input_value()=='' and page.locator('#dailyWorkForm .daily-house-project').input_value()==NEW_PROJECT and page.locator('#dailyWorkForm .daily-line-item').input_value()==PREFIX+'NEW-WORK')
        page.locator('#dailyWorkForm [data-cancel]').click();page.locator('#dailyWorkForm').wait_for(state='detached')
        rendered=summaries(page)
        report.check(name+': dashboard uses one grouped total paid and outstanding',rendered['total']==current['total'] and rendered['paid']==current['paid'] and rendered['outstanding']==current['outstanding'],rendered)
        report.check(name+': pending salary and workforce drilldown each count one employee-month',rendered['attention']['count']==1 and rendered['attention']['amount']==current['outstanding'] and len(rendered['unpaid']['rows'])==1 and '1 筆' in rendered['card'],rendered)
        report.check(name+': workforce drilldown presents outstanding not historic-plus-new totals',str(current['outstanding'])==''.join(c for c in rendered['unpaid']['rows'][0]['cells'][2] if c.isdigit()) and rendered['unpaid']['columns'][2]=='未付餘額')
        report.check(name+': read-only summaries do not mutate committed records',raw(page)==after)
        page.screenshot(path=str(report.output/(name+'.png')),full_page=True)
        report.save(name+'.json',{'draft':values,'before':before,'after':after,'summary':rendered});report.case(name)
    finally:ctx.close()


def blocked(browser, server, report, viewport):
    name='daily-ui-'+viewport+'-payment-evidence-block';print('RUN',name,flush=True)
    ctx=browser.new_context(viewport=VIEWPORTS[viewport],is_mobile=viewport=='mobile',has_touch=viewport=='mobile',service_workers='block',accept_downloads=True)
    try:
        page,before=boot(ctx,server,report,name,'missing-bank');mount(page,server,report,name);values=fill_daily(page)
        page.locator('#dailyWorkForm button[type=submit]').click()
        page.locator('[data-draft-export]').wait_for(state='visible')
        text=page.locator('.daily-draft-review').inner_text()
        report.check(name+': payment-specific refusal is shown without false synchronization claim','薪資付款來源' in text and '其他 ERP 分頁或同步已更新' not in text and '匯出草稿' in text,text)
        report.check(name+': rejected submit preserves every draft field',page.evaluate('()=>document.querySelector("#dailyWorkForm")._dailySubmitContext.readDraft()')==values)
        report.check(name+': rejected submit is financially read-only',raw(page)==before and public(page)==before['idb']['main'])
        with page.expect_download() as downloaded:
            page.locator('[data-draft-export]').click()
        payload=json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))
        report.check(name+': explicit export contains exact original draft and reference-only purpose',payload['draft']==values and payload['editingBatchId']=='' and payload['schema']=='kushe-daily-draft-reference-v1' and '請勿匯入還原' in payload['purpose'])
        page.locator('[data-draft-refresh]').click()
        page.locator('[data-draft-confirm]').wait_for(state='visible')
        report.check(name+': unresolved evidence keeps review confirmation disabled',page.locator('[data-draft-confirm]').is_disabled())
        report.check(name+': refresh and export never write financial records',raw(page)==before and public(page)==before['idb']['main'])
        page.screenshot(path=str(report.output/(name+'.png')),full_page=True)
        report.save(name+'.json',{'draft':values,'message':text,'export':payload,'after':raw(page)});report.case(name)
    finally:ctx.close()


def notification_failure(browser, server, report, viewport):
    name='daily-ui-'+viewport+'-committed-notification-failure';print('RUN',name,flush=True)
    ctx=browser.new_context(viewport=VIEWPORTS[viewport],is_mobile=viewport=='mobile',has_touch=viewport=='mobile',service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'full');mount(page,server,report,name);fill_daily(page)
        page.evaluate('''()=>{document.querySelector('#dailyWorkForm')._dailySubmitContext.afterCommit=async()=>{throw new Error('SYN-K28 injected post-commit presentation failure')}}''')
        submit_twice(page)
        page.wait_for_function('()=>document.querySelector("#dailyWorkForm")?.dataset.notificationStatus==="COMMITTED_WITH_NOTIFICATION_WARNING"')
        after=assert_append(report,name,page,before)
        report.check(name+': durable success is explicitly marked and resubmit disabled',page.locator('#dailyWorkForm').get_attribute('data-committed')=='true' and page.locator('#dailyWorkForm button[type=submit]').is_disabled() and '資料已儲存' in page.locator('.daily-save-feedback').inner_text())
        submit_twice(page)
        report.check(name+': even forced repeat submit cannot duplicate durable success',raw(page)==after and public(page)==after['idb']['main'])
        page.screenshot(path=str(report.output/(name+'.png')),full_page=True)
        report.save(name+'.json',{'before':before,'after':after,'message':page.locator('.daily-save-feedback').inner_text()});report.case(name)
    finally:ctx.close()


def changed_message(browser, server, report):
    name='daily-ui-paid-source-changed-message';print('RUN',name,flush=True)
    ctx=browser.new_context(viewport=VIEWPORTS['desktop'],service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'partial');mount(page,server,report,name);values=fill_daily(page)
        # Core stale-evidence rejection is exercised by the Store suite. Here the
        # public controller receives that exact code to check its UI-only path.
        handled=page.evaluate('''()=>document.querySelector('#dailyWorkForm')._dailySubmitContext.review.onError({code:'DAILY_PAID_MONTH_CHANGED',message:'SYN-K28 changed payment evidence'})''')
        text=page.locator('.daily-draft-review').inner_text()
        report.check(name+': changed-payment code is handled with accurate draft-preserving guidance',handled is True and '薪資或付款來源已更新' in text and '其他 ERP 分頁或同步已更新' not in text and page.locator('[data-draft-export]').count()==1,text)
        report.check(name+': code presentation does not alter fields or records',page.evaluate('()=>document.querySelector("#dailyWorkForm")._dailySubmitContext.readDraft()')==values and raw(page)==before)
        report.case(name)
    finally:ctx.close()


def fallback(browser, server, report):
    name='daily-ui-legacy-helper-absence-fallback';print('RUN',name,flush=True)
    ctx=browser.new_context(viewport=VIEWPORTS['desktop'],service_workers='block')
    try:
        page,before=boot(ctx,server,report,name,'partial');mount(page,server,report,name,fallback=True)
        rendered=summaries(page)
        report.check(name+': missing grouped helper preserves existing payroll display',rendered['total']==6000 and rendered['paid']==3600 and rendered['outstanding']==2400 and len(rendered['unpaid']['rows'])==1,rendered)
        report.check(name+': fallback and drilldown remain read-only',raw(page)==before and public(page)==before['idb']['main'])
        report.case(name)
    finally:ctx.close()


def cash_projection(browser,server,report,kind):
    name='dashboard-payroll-cash-'+kind;print('RUN',name,flush=True)
    state=fixture('full')
    # A wholly synthetic archived projection: April wages have two cumulative
    # snapshots, while two explicit payments actually occur in May. No writer is
    # used to create a payment from unresolved sources; this tests readers only.
    appended=deepcopy(state['payroll'][0]);appended.update(id=PREFIX+'PAYROLL-APPENDED',total=10200,commission=9000,paidAmount=10200,payDate='2026-05-20',paymentTransactionId=PREFIX+'BANK-APPENDED',updatedAt='2026-05-20T04:00:00.000Z')
    state['payroll'].insert(0,appended)
    state['commissions'].append({'id':PREFIX+'COMMISSION-APPENDED','date':NEW_DATE,'employee':EMPLOYEE,'project':NEW_PROJECT,'rate':50,'commission':NEW_COMMISSION,'untaxedAmount':NEW_AMOUNT,'sourceType':'manual','status':'已列入薪資'})
    later=deepcopy(state['salaryPayments'][0]);later.update(id=PREFIX+'SALARY-APPENDED',payrollId=appended['id'],date='2026-05-20',amount=4200,baseAmount=0,commissionAmount=4200,fee=5,actualDebit=4205,bankTransactionId=PREFIX+'BANK-APPENDED',commissionSelectionKeys=[json.dumps([PREFIX+'COMMISSION-APPENDED','未指定戶別'],ensure_ascii=False,separators=(',',':'))])
    state['salaryPayments'].append(later)
    bank=deepcopy(state['bankTransactions'][1]);bank.update(id=PREFIX+'BANK-APPENDED',sourceId=later['id'],salaryPaymentId=later['id'],payrollId=appended['id'],date=later['date'],amount=4205,actualDebit=4205,salaryAmount=4200,fee=5)
    state['bankTransactions']=[state['bankTransactions'][1],bank]
    state['receipts']=[]
    if kind=='history-without-bank-mirror':state['bankTransactions']=[]
    elif kind=='bank-date-precedes-wage-month':
        for row in state['salaryPayments']:row['date']='2026-04-25'
    elif kind in ('legacy-group-max','legacy-no-helper'):
        state['salaryPayments']=[];state['bankTransactions']=[]
        for row in state['payroll']:
            row.update(payDate='',paidAt='',paymentTransactionId='',bankId='')
        if kind=='legacy-no-helper':
            state['payroll']=[r for r in state['payroll'] if r['id']!=appended['id']]
            state['commissions']=[r for r in state['commissions'] if r['id']!=PREFIX+'COMMISSION-APPENDED']
    ctx=browser.new_context(viewport=VIEWPORTS['desktop'],service_workers='block')
    try:
        restrict(ctx,server,report,name);page=open_page(ctx,server)
        report.check(name+': only owned fresh synthetic projection seeded',page.evaluate('x=>__k28Seed(x)',state) is True)
        page.add_script_tag(url=server.origin+'/assets/js/erp-store.js')
        loaded=call(page,'load');report.check(name+': actual Store loads projection fixture',loaded['ok'],loaded)
        setup=call(page,'saveCustomer',{'name':CUSTOMER,'note':'SYN-K28 normalized cash projection'},CUSTOMER)
        report.check(name+': synthetic normalization commits',setup['ok'],setup)
        before=raw(page);mount(page,server,report,name,fallback=kind=='legacy-no-helper')
        snapshots=page.evaluate('''()=>Object.fromEntries(['2026-04','2026-05'].map(month=>{const v=KusheDashboard.readSnapshot(month);return [month,{cash:v.cash,total:v.payrollTotal,paid:v.payrollPaid,outstanding:v.payrollOpen}]}))''')
        if kind in ('history-without-bank-mirror','bank-date-precedes-wage-month','bank-rows-authoritative'):
            report.check(name+': April never deducts May payments or both cumulative salary rows',snapshots['2026-04']['cash']==0,snapshots)
            report.check(name+': May deducts two actual debits including company fees exactly once',snapshots['2026-05']['cash']==-(6017+4205),snapshots)
            report.check(name+': salary summary still counts the grouped sources once',snapshots['2026-04']['total']==10200 and snapshots['2026-04']['paid']==10200 and snapshots['2026-04']['outstanding']==0,snapshots)
        elif kind=='legacy-group-max':
            report.check(name+': no-evidence legacy month uses maximum paid snapshot once',snapshots['2026-04']['cash']==-10200 and snapshots['2026-05']['cash']==0,snapshots)
        else:
            report.check(name+': absent helper retains original raw legacy cash fallback',snapshots['2026-04']['cash']==-6000 and snapshots['2026-05']['cash']==0,snapshots)
        report.check(name+': cash readers leave all persistent and public data unchanged',raw(page)==before and public(page)==before['idb']['main'])
        report.save(name+'.json',{'snapshots':snapshots,'state':before['idb']['main']});report.case(name)
    finally:ctx.close()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--store',type=Path);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--browser');parser.add_argument('--only',choices=('success','blocked','notification','messages','fallback','cash'));args=parser.parse_args()
    root=args.root.resolve();store=(args.store or root/'assets/js/erp-store.js').read_bytes();report=Report(args.output.resolve())
    report.data.update(schema='k28-real-daily-ui-browser-v1',sourceSha256={'assets/js/erp-store.js':sha(store),**{p:sha((root/p).read_bytes()) for p in SCRIPTS+STYLES}},viewports=VIEWPORTS)
    try:
        with Server(store,root,extra=list(SCRIPTS+STYLES)) as server,sync_playwright() as p:
            executable=select_browser(args.browser);launch={'headless':True}
            if executable:launch['executable_path']=executable
            report.data['browserExecutable']=executable or 'Playwright managed Chromium'
            browser=p.chromium.launch(**launch);report.data['browserVersion']=browser.version
            try:
                if args.only in (None,'success'):
                    for size in VIEWPORTS:
                        for kind in ('partial','full'):success(browser,server,report,size,kind)
                if args.only in (None,'blocked'):
                    for size in VIEWPORTS:blocked(browser,server,report,size)
                if args.only in (None,'notification'):
                    for size in VIEWPORTS:notification_failure(browser,server,report,size)
                if args.only in (None,'messages'):changed_message(browser,server,report)
                if args.only in (None,'fallback'):fallback(browser,server,report)
                if args.only in (None,'cash'):
                    for kind in ('history-without-bank-mirror','bank-date-precedes-wage-month','bank-rows-authoritative','legacy-group-max','legacy-no-helper'):cash_projection(browser,server,report,kind)
                report.check('All requests stayed within owned exact loopback allowlist',not report.data['externalRequests'],report.data['externalRequests'])
                report.check('No unhandled page errors',not report.data['pageErrors'],report.data['pageErrors'])
                report.data['status']='PASS'
            finally:browser.close()
    except Exception as error:
        report.data['status']='BLOCKED' if not report.data['checks'] else 'FAIL';report.data['failures'].append({'message':str(error),'traceback':traceback.format_exc()});raise
    finally:report.flush();print(json.dumps({k:report.data.get(k) for k in ('status','passCount','failCount','cases','failures')},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
