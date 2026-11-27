#!/usr/bin/env python3
"""Actual Store commits and actual CloudSync editor listener, synthetic only.

Uses an owned loopback server and fresh browser contexts. No cloud startup,
network synchronization, production origin, account or uploaded backup is used.
Most surfaces are synthetic. One additional case uses the actual unbilled-work
UI, including its existing delayed drawer close. Store and cloud code are exact.
"""
import argparse
import json
import subprocess
import sys
import traceback
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.p41-k28-tests'))
from playwright.sync_api import sync_playwright
from k28_browser_store import Report, Server, boot, call, raw, public, options, select_browser, sha, EMERGENCY, JOURNAL
from k28_fixture import CUSTOMER, NEW_PROJECT, draft

BASE = '15eff6fc574fb64480682656daf88dc7a906baa8'
CLOUD = 'assets/js/cloud-sync.js'
PROTECTED = ('salaryPayments', 'banks', 'bankTransactions', 'billings', 'receivables', 'receipts', 'payments', 'invoices', 'commissionSettlements')
UI_RESOURCES = ('assets/js/commissions.js', 'assets/css/app.css', 'assets/css/commissions-scoped.css')


def prepare_values(page, report, name, operation):
    arguments = None
    if operation == 'saveDailyUnbilledItems':
        values = draft()
        values['date'] = '2026-05-19'
        saved = call(page, 'saveDailyBatch', values, '', options(page, values))
        report.check(name + ': initial unbilled synthetic work is actually committed', saved['ok'], saved)
        preview = call(page, 'dailyUnbilledEditPreview', saved['result'])
        report.check(name + ': actual unbilled preview is eligible', preview['ok'] and preview['result']['safe'], preview)
        group = preview['result']['groups'][0]
        row = next(r for r in group['rows'] if r['editable'])
        arguments = [saved['result'], {'expectedFingerprint': preview['result']['fingerprint'], 'changes': [{'groupId': group['groupId'], 'workItemId': row['workItemId'], 'qty': 2}], 'additions': []}]
    else:
        arguments = [{'customer': CUSTOMER, 'project': NEW_PROJECT, 'date': '2026-05-19', 'pricingMode': 'actual', 'taxMode': '未稅', 'status': '草稿', 'publicNote': 'SYN-K29 saved outward note', 'lines': [{'house': 'SYN-K29-HOUSE', 'item': 'SYN-K29-WORK', 'unit': '式', 'qty': 1, 'price': 1100, 'pricingType': 'actual', 'priceSource': 'manual'}]}, '', {}]
    return arguments


def mount_cloud(page, server, report, name):
    page.evaluate('''() => {
      const shell=document.createElement('main');shell.id='appShell';shell.hidden=false;shell.inert=false;
      document.body.append(shell);
      window.__k29Events=[];window.__k29ZeroScheduled=0;window.__k29ZeroCompleted=0;
      const timer=window.setTimeout.bind(window);
      window.setTimeout=(fn,delay,...args)=>{
        if(delay===0&&typeof fn==='function'){
          window.__k29ZeroScheduled++;
          return timer(async()=>{try{await fn(...args)}finally{window.__k29ZeroCompleted++}},delay);
        }
        return timer(fn,delay,...args);
      };
      window.addEventListener('kushe:data-updated',event=>window.__k29Events.push({...event.detail}));
    }''')
    page.add_script_tag(url=server.origin + '/' + CLOUD)
    report.check(name + ': new editor starts ready', page.evaluate('()=>KusheCloudSync.editorReadiness().safe'))


def prepare(page, server, report, name, operation):
    arguments = prepare_values(page, report, name, operation)
    mount_cloud(page, server, report, name)
    page.evaluate('''() => {
      document.querySelector('#appShell').innerHTML='<form id="k29Form"><input id="k29Input" value=""></form>';
    }''')
    page.locator('#k29Input').fill('SYN-K29 unsaved user input')
    report.check(name + ': actual DOM input marks editor dirty', not page.evaluate('()=>KusheCloudSync.editorReadiness().safe'))
    return arguments


def scenario(browser, server, report, operation, variant, mode):
    name = operation + '-' + variant
    print('RUN', name, flush=True)
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        arguments = prepare(page, server, report, name, operation)
        before = raw(page)
        if variant == 'failed-writer':
            if operation == 'saveQuotationBundle':
                arguments[0]['lines'] = []
            else:
                arguments[1]['expectedFingerprint'] = 'SYN-K29-stale-preview'
        outcome = page.evaluate('''async ({operation,args,variant})=>{
          const result=await window.__k28Call({name:operation,args});
          document.activeElement?.blur?.();
          const delayed=['delayed-form-close','late-new-input','late-principal','late-invalid-durable'].includes(variant);
          if(variant!=='open-form'&&!delayed)document.querySelector('#k29Form').remove();
          if(['readonly-detail-close','editable-detail-close'].includes(variant)){
            const overlay=document.createElement('div');overlay.className='erp-detail-overlay cheque-overlay';overlay.id='k29ChequeDetail';
            overlay.innerHTML='<section role="dialog"><p>SYN-K29 committed detail</p><button type="button" data-cheque-close>Close</button>'+(variant==='editable-detail-close'?'<form><input value="SYN-K29 remaining draft"></form>':'')+'</section>';
            overlay.querySelector('button').onclick=()=>overlay.remove();document.body.append(overlay);
          }
          if(variant==='changed-principal'){
            window.__k28Auth.principal='SYN-K29-OTHER-OWNER';
            window.__k28Auth.contextUser='SYN-K29-OTHER-OWNER';
          }
          if(variant==='new-input'){
            const form=document.createElement('form');form.innerHTML='<input id="k29NewInput">';
            document.querySelector('#appShell').append(form);
            const input=form.querySelector('input');input.value='SYN-K29 next unfinished draft';
            input.dispatchEvent(new Event('input',{bubbles:true}));form.remove();
          }
          return result;
        }''', {'operation': operation, 'args': arguments, 'variant': variant})
        if variant != 'failed-writer':
            page.wait_for_function('()=>__k29ZeroScheduled>0&&__k29ZeroCompleted===__k29ZeroScheduled')
        first_editor = page.evaluate('()=>KusheCloudSync.editorReadiness()')
        first_zero = page.evaluate('()=>({scheduled:__k29ZeroScheduled,completed:__k29ZeroCompleted})')
        delayed = variant in ('delayed-form-close', 'late-new-input', 'late-principal', 'late-invalid-durable')
        detail = variant in ('readonly-detail-close', 'editable-detail-close')
        if delayed or detail:
            report.check(name + ': verified commit keeps an open form or detail dirty', not first_editor['safe'], first_editor)
            if delayed:
                page.evaluate('''variant=>new Promise(resolve=>setTimeout(()=>{
                  if(variant==='late-new-input'){
                    const input=document.querySelector('#k29Input');input.value='SYN-K29 newer unsaved content';input.dispatchEvent(new Event('input',{bubbles:true}));
                  }
                  if(variant==='late-principal'){
                    __k28Auth.principal='SYN-K29-OTHER-OWNER';__k28Auth.contextUser='SYN-K29-OTHER-OWNER';
                  }
                  if(variant==='late-invalid-durable'){
                    // Deliberate fault in this owned synthetic profile only.
                    // Actual Store readiness must refuse the new recovery gate.
                    localStorage.setItem('KuSheERP25_STORE_RECOVERY_REQUIRED',JSON.stringify({schema:'SYN-K29-invalid-durable-evidence'}));
                  }
                  document.querySelector('#k29Form').remove();resolve();
                },180))''', variant)
            else:
                page.locator('#k29ChequeDetail [data-cheque-close]').click()
            if mode == 'candidate' and variant in ('delayed-form-close', 'readonly-detail-close'):
                page.wait_for_function('()=>KusheCloudSync.editorReadiness().safe')
            page.wait_for_function('()=>__k29ZeroCompleted===__k29ZeroScheduled')
        editor = page.evaluate('()=>KusheCloudSync.editorReadiness()')
        after = raw(page)
        transaction = page.evaluate('()=>KuSheERPStore.getLastStoreTransactionResult()')
        events = page.evaluate('()=>__k29Events')
        if variant == 'failed-writer':
            report.check(name + ': actual writer rejects and storage stays exact', not outcome['ok'] and after == before, outcome)
            report.check(name + ': failed writer emits no data commit event', events == [], events)
        else:
            a, b = after['idb']['main'], before['idb']['main']
            report.check(name + ': actual writer commits once', outcome['ok'] and a['meta']['businessSnapshotRevision']['sequence'] == b['meta']['businessSnapshotRevision']['sequence'] + 1, outcome)
            report.check(name + ': actual transaction and notification agree', transaction['operationType'] == operation and transaction['status'] in ('COMMITTED', 'COMMITTED_WITH_NOTIFICATION_WARNING') and len(events) == 1 and events[0]['operationId'] == transaction['operationId'] and events[0]['revisionId'] == transaction['revisionId'], {'transaction': transaction, 'events': events})
            report.check(name + ': public state and durable layers agree', public(page) == a and json.loads(after['local'][EMERGENCY]) == a and after['idb'][JOURNAL]['phase'] == 'COMMIT_VERIFIED')
            report.check(name + ': paid history and financial collections stay exact', all(a.get(key) == b.get(key) for key in PROTECTED))
            if operation == 'saveQuotationBundle':
                report.check(name + ': one quotation is added with saved content', len(a['quotations']) == len(b['quotations']) + 1 and a['quotations'][0]['publicNote'] == 'SYN-K29 saved outward note')
            else:
                batch_id = arguments[0]
                changed = [r for r in a['dailyLogs'] if r.get('batchId') == batch_id]
                report.check(name + ': existing unbilled work is amended without duplicate logs', len(a['dailyLogs']) == len(b['dailyLogs']) and len(changed) == 1 and changed[0]['items'][0]['qty'] == 2)
        expected_ready = mode == 'candidate' and variant in ('closed-form', 'delayed-form-close', 'readonly-detail-close')
        report.check(name + ': editor release matches verified commit and unchanged closed surface', editor['safe'] == expected_ready, editor)
        report.check(name + ': inspecting editor readiness has no storage effects', raw(page) == after)
        if mode == 'candidate' and variant in ('delayed-form-close', 'readonly-detail-close', 'late-invalid-durable'):
            report.check(name + ': the later close causes a second actual verification callback', page.evaluate('()=>__k29ZeroCompleted') > first_zero['completed'])
        report.save(name + '.json', {'mode': mode, 'operation': operation, 'variant': variant, 'before': before, 'writer': outcome, 'transaction': transaction, 'events': events, 'firstEditor': first_editor, 'firstCallbacks': first_zero, 'editor': editor, 'after': after})
        report.case(name)
    finally:
        context.close()


def actual_unbilled_ui(browser, server, report, mode):
    name='actual-unbilled-ui-delayed-close'
    print('RUN',name,flush=True)
    context=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block')
    try:
        page,_=boot(context,server,report,name)
        arguments=prepare_values(page,report,name,'saveDailyUnbilledItems')
        mount_cloud(page,server,report,name)
        before=raw(page)
        page.evaluate('''()=>{
          document.body.dataset.route='commissions';
          const section=document.createElement('section');section.id='commissionsView';section.className='view';
          section.append(document.querySelector('#commissionsApp'));document.querySelector('#appShell').append(section);
          window.KusheKpi={register(){}};window.KushePhase1={toast(){}};
        }''')
        for resource in UI_RESOURCES:
            if resource.endswith('.css'):page.add_style_tag(url=server.origin+'/'+resource)
            else:page.add_script_tag(url=server.origin+'/'+resource)
        page.evaluate('()=>KusheCommissions.activate()')
        page.locator('#commissionMonthFilter').fill('2026-05')
        page.locator('#commissionMonthFilter').dispatch_event('change')
        page.locator('[data-daily-unbilled="'+arguments[0]+'"]:visible').first.click()
        page.locator('#dailyWorkForm [data-unbilled-qty]').first.fill('2')
        page.locator('#dailyWorkForm button[type=submit]').click()
        page.locator('#unbilledReview').wait_for(state='visible')
        report.check(name+': real UI editing and review have not written data',raw(page)==before)
        page.locator('#dailyWorkForm button[type=submit]').click()
        page.locator('#dailyWorkForm').wait_for(state='detached')
        if mode=='candidate':page.wait_for_function('()=>KusheCloudSync.editorReadiness().safe')
        page.wait_for_function('()=>__k29ZeroScheduled>0&&__k29ZeroCompleted===__k29ZeroScheduled')
        after=raw(page);a,b=after['idb']['main'],before['idb']['main']
        editor=page.evaluate('()=>KusheCloudSync.editorReadiness()');events=page.evaluate('()=>__k29Events')
        transaction=page.evaluate('()=>KuSheERPStore.getLastStoreTransactionResult()')
        changed=[r for r in a['dailyLogs'] if r.get('batchId')==arguments[0]]
        report.check(name+': real UI commits one requested unbilled edit',a['meta']['businessSnapshotRevision']['sequence']==b['meta']['businessSnapshotRevision']['sequence']+1 and len(a['dailyLogs'])==len(b['dailyLogs']) and len(changed)==1 and changed[0]['items'][0]['qty']==2)
        report.check(name+': actual Store event identifies the successful UI writer',transaction['operationType']=='saveDailyUnbilledItems' and transaction['status'] in ('COMMITTED','COMMITTED_WITH_NOTIFICATION_WARNING') and len(events)==1 and events[0]['operationId']==transaction['operationId'])
        report.check(name+': real UI and source preserve paid records and durable mirrors',public(page)==a and json.loads(after['local'][EMERGENCY])==a and after['idb'][JOURNAL]['phase']=='COMMIT_VERIFIED' and all(a.get(key)==b.get(key) for key in PROTECTED))
        report.check(name+': real UI closing animation releases only verified candidate',editor['safe']==(mode=='candidate'),editor)
        report.save(name+'.json',{'mode':mode,'before':before,'after':after,'events':events,'transaction':transaction,'editor':editor})
        report.case(name)
    finally:context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('baseline', 'candidate'), default='candidate')
    parser.add_argument('--cloud', type=Path)
    parser.add_argument('--browser')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    cloud = subprocess.check_output(['git', 'show', BASE + ':' + CLOUD], cwd=ROOT) if args.mode == 'baseline' else (args.cloud or ROOT / CLOUD).read_bytes()
    store = (ROOT / 'assets/js/erp-store.js').read_bytes()
    report = Report(args.output.resolve(), args.mode)
    report.data.update(schema='k29-real-store-cloud-editor-browser-v1', baseCommit=BASE, cloudSha256=sha(cloud), storeSha256=sha(store), unbilledUiSha256=sha((ROOT/'assets/js/commissions.js').read_bytes()), realCloudSyncTested=False, realAuthenticationTested=False, physicalPhoneTested=False, scope='Actual Store and CloudSync with synthetic surface delay cases plus the real unbilled-work UI; exact loopback resources only')
    try:
        with Server(store, ROOT, UI_RESOURCES) as server, sync_playwright() as playwright:
            server.resources['/' + CLOUD] = (cloud, 'text/javascript; charset=utf-8')
            executable = select_browser(args.browser)
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            launch = {'headless': True}
            if executable:
                launch['executable_path'] = executable
            browser = playwright.chromium.launch(**launch)
            report.data['browserVersion'] = browser.version
            try:
                for operation in ('saveQuotationBundle', 'saveDailyUnbilledItems'):
                    for variant in ('closed-form', 'open-form', 'failed-writer', 'changed-principal', 'new-input', 'delayed-form-close', 'late-new-input', 'late-principal', 'late-invalid-durable', 'readonly-detail-close', 'editable-detail-close'):
                        scenario(browser, server, report, operation, variant, args.mode)
                actual_unbilled_ui(browser,server,report,args.mode)
            finally:
                browser.close()
        report.check('all requests remain on exact owned loopback allowlist', not report.data['externalRequests'], report.data['externalRequests'])
        report.check('no uncaught page errors', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'K29_SYNC_BROWSER_BASELINE_REPRODUCED' if args.mode == 'baseline' else 'K29_SYNC_BROWSER_PASS'
        return 0
    except Exception as error:
        report.data['status'] = 'BLOCKED'
        report.data['failures'].append({'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data.get(key) for key in ('status', 'mode', 'passCount', 'failCount', 'cloudSha256', 'storeSha256', 'failures')}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
