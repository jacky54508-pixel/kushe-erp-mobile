#!/usr/bin/env python3
"""Fixed 1.7 MB / 100-commit real Store acceptance, wholly synthetic.

Run: python .p41-k29-tests/bulk_input.py --output <artifact-directory>
Optional: --browser <Chromium executable> --store <exact Store source>

Uses unchanged K28 loopback/browser isolation. Historical quotations have the
actual quotation schema, 20 ordinary lines each and notes shorter than 400
characters. No uploaded backup, customer data, production account, CloudSync,
browser quota override, storage mock, writer patch, automatic retry, or reduced
load is used. The normalized durable baseline is the preservation boundary;
the initial synthetic seed and its pre-load storage are also saved separately.
This is a bounded local-capacity and sequential-save/reload check, not a cloud,
cross-device, physical-phone, power-loss, concurrency or unlimited-load claim.
"""
import argparse
import json
import subprocess
import sys
import time
import traceback
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.p41-k28-tests'))
from playwright.sync_api import sync_playwright
from k28_browser_store import Report, Server, restrict, open_page, select_browser, sha
from k28_fixture import fixture, draft, CUSTOMER, PROJECT, NEW_PROJECT, EMPLOYEE, OWNER, STAMP

BASE = '15eff6fc574fb64480682656daf88dc7a906baa8'
TARGET_BYTES = 1_700_000
MAX_SEED_BYTES = 1_750_000
WRITE_COUNT = 100
TOTAL_SECONDS = 480
CALL_SECONDS = 60
PREFIX = 'SYN-K29-BULK-'
MONTH = '2026-06'


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def build_fixture():
    data = fixture('full')
    data['meta']['k29BulkSynthetic'] = True
    # Draft quotes on the existing historical project only enlarge real stored
    # business collections. They are not referenced by any new daily input.
    while len(compact(data).encode('utf-8')) < TARGET_BYTES:
        index = len(data['quotations']) + 1
        quote_id = PREFIX + 'QUOTE-' + str(index).zfill(4)
        lines = []
        for number in range(1, 21):
            qty, price = 1 + number % 3, 117 + (index + number) % 31
            note = (PREFIX + 'historical line ' + str(index) + '/' + str(number) + '. ' +
                    'Synthetic site measurements and ordinary scope description. ' * 5)
            lines.append({'id': quote_id + '-LINE-' + str(number).zfill(2),
                          'house': PREFIX + 'HISTORY-HOUSE-' + str(number),
                          'item': PREFIX + 'HISTORY-WORK-' + str(number),
                          'spec': PREFIX + 'STANDARD', 'unit': '式', 'pricingType': 'actual',
                          'qty': qty, 'estimatedQty': qty, 'price': price, 'lumpSumAmount': 0,
                          'subtotal': qty * price, 'priceSource': 'manual', 'priceId': '',
                          'scope': '', 'note': note})
        amount = sum(line['subtotal'] for line in lines)
        tax = (amount * 5 + 50) // 100
        note = PREFIX + 'synthetic historical quotation ' + str(index)
        data['quotations'].append({'id': quote_id, 'number': 'Q-20260115-' + str(index).zfill(3),
                                  'createdAt': STAMP, 'customer': CUSTOMER, 'customerName': CUSTOMER,
                                  'project': PROJECT, 'projectName': PROJECT, 'date': '2026-01-15',
                                  'dueDate': '', 'pricingMode': 'actual', 'lumpSumTotal': 0,
                                  'billingPlan': 'one_time', 'billingMilestones': [], 'taxMode': '未稅',
                                  'lines': lines, 'amount': amount, 'tax': tax, 'total': amount + tax,
                                  'status': '草稿', 'internalNote': '', 'publicNote': note, 'note': note,
                                  'sourceType': 'manual', 'importTemplateId': '', 'updatedAt': STAMP})
    encoded = compact(data).encode('utf-8')
    assert TARGET_BYTES <= len(encoded) <= MAX_SEED_BYTES
    assert max(len(line['note']) for row in data['quotations'] for line in row['lines']) < 400
    return data


def make_draft(index):
    values = draft(project=NEW_PROJECT)
    marker = PREFIX + 'INPUT-' + str(index).zfill(3)
    price = 742 + 14 * (index % 13)  # Entirely synthetic and even: exact 50% commission.
    values.update(date=MONTH + '-' + str(1 + (index - 1) % 28).zfill(2), note=marker)
    values['lines'][0].update(house=marker + '-HOUSE', item=marker + '-WORK',
                              itemName=marker + '-WORK', inputPrice=price, unitPrice=price)
    return values


WATCH_JS = r'''() => {
  window.__k29BulkEvents=[];
  window.addEventListener('kushe:data-updated',event=>{
    __k29BulkEvents.push({detail:JSON.parse(JSON.stringify(event.detail||{})),atMs:performance.now()});
  });
}'''


# Read-only observation of the exact Store, IndexedDB and WebStorage. Expected
# baseline values live only in harness memory, never in a business collection.
OBSERVE_JS = r'''baseline => {
  const stringify=JSON.stringify;
  const appendKeys=['dailyLogs','commissions','dailyItemPresets'];
  const mutable=new Set([...appendKeys,'payroll','meta','audit']);
  const ids=Object.fromEntries([...appendKeys,'payroll'].map(key=>[key,new Set(baseline[key].map(row=>String(row.id)))]));
  const project=data=>{
    const fixed=Object.fromEntries(Object.entries(data).filter(([key])=>!mutable.has(key)));
    const original=Object.fromEntries([...appendKeys,'payroll'].map(key=>[key,data[key].filter(row=>ids[key].has(String(row.id)))]));
    const meta=Object.fromEntries(Object.entries(data.meta).filter(([key])=>!['updatedAt','businessSnapshotRevision','receiptCommitVersion'].includes(key)));
    return stringify({fixed,original,meta});
  };
  const protectedBefore=project(baseline);
  let previous=Object.fromEntries(appendKeys.map(key=>[key,baseline[key]]));
  const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(value=>value.toString(16).padStart(2,'0')).join('');
  const size=async text=>({sha256:await digest(text),utf8Bytes:new TextEncoder().encode(text).length,utf16CodeUnits:text.length,utf16Bytes:text.length*2});
  window.__k29BulkObserve=async()=>{
    const raw=await __k28Raw(),data=raw.idb.main,primary=stringify(data),mirror=raw.local.KuSheERP25_EMERGENCY;
    const memory=stringify(KuSheERPStore.getState()),journal=raw.idb['store:transaction:journal:v1'];
    const protectedAfter=project(data),revision=data.meta.businessSnapshotRevision;
    const token=JSON.parse(raw.local.KuSheERP25_LOCAL_COMMIT_TOKEN||'null');
    const oldRowsPreserved=Object.fromEntries(appendKeys.map(key=>{
      const oldIds=new Set(previous[key].map(row=>String(row.id)));
      return [key,stringify(data[key].filter(row=>oldIds.has(String(row.id))))===stringify(previous[key])];
    }));
    previous=Object.fromEntries(appendKeys.map(key=>[key,data[key]]));
    const logs=data.dailyLogs.filter(row=>!ids.dailyLogs.has(String(row.id)));
    const commissions=data.commissions.filter(row=>!ids.commissions.has(String(row.id)));
    const payroll=data.payroll.filter(row=>!ids.payroll.has(String(row.id)));
    const unique=values=>values.every(value=>typeof value==='string'&&value.length>0)&&new Set(values).size===values.length;
    const uniqueCollections=Object.fromEntries(Object.entries(data).filter(([,value])=>Array.isArray(value)).map(([key,rows])=>[key,unique(rows.map(row=>row.id))]));
    let storageEstimate;
    try{storageEstimate=await navigator.storage.estimate()}catch(error){storageEstimate={error:String(error)}}
    const localEntries=Object.keys(localStorage).map(key=>({key,codeUnits:key.length+(localStorage.getItem(key)||'').length}));
    return {
      revision,transaction:KuSheERPStore.getLastStoreTransactionResult(),journal,token,
      receiptToken:raw.local.KuSheERP25_RECEIPT_COMMIT_VERSION,
      events:window.__k29BulkEvents||[],
      primary:await size(primary),mirror:await size(mirror||''),memory:await size(memory),
      publicExact:primary===memory,mirrorExact:primary===mirror,
      protectedExact:protectedBefore===protectedAfter,
      protectedBeforeSha256:await digest(protectedBefore),protectedAfterSha256:await digest(protectedAfter),
      oldRowsPreserved,uniqueCollections,
      audit:{count:data.audit.length,sha256:await digest(stringify(data.audit)),tailSha256:await digest(stringify(data.audit.slice(1)))},
      newLogs:logs.map(row=>({id:row.id,batchId:row.batchId,groupId:row.groupId,date:row.date,note:row.note,employee:row.employee,project:row.project,commission:row.commission,items:row.items.map(item=>({workItemId:item.workItemId,house:item.house,item:item.item,qty:item.qty,inputPrice:item.inputPrice,untaxedSubtotal:item.untaxedSubtotal}))})),
      newCommissions:commissions.map(row=>({id:row.id,sourceType:row.sourceType,sourceId:row.sourceId,employee:row.employee,date:row.date,commission:row.commission})),
      newPayroll:payroll,
      counts:Object.fromEntries(Object.entries(data).filter(([,value])=>Array.isArray(value)).map(([key,rows])=>[key,rows.length])),
      noRecoveryGate:['idb','local','session'].every(layer=>['KuSheERP25_STORE_RECOVERY_REQUIRED','KuSheERP25_RECEIPT_RECOVERY_REQUIRED'].every(key=>raw[layer][key]===null)),
      capacity:{storageEstimate,primaryAndMirrorUtf8Bytes:new TextEncoder().encode(primary).length+new TextEncoder().encode(mirror||'').length,journalUtf8Bytes:new TextEncoder().encode(stringify(journal)).length,localStorageUtf16Bytes:localEntries.reduce((sum,row)=>sum+row.codeUnits*2,0),localEntries}
    };
  };
}'''


def timed_call(page, name, args, deadline):
    remaining = min(CALL_SECONDS, deadline - time.monotonic())
    if remaining <= 0:
        raise TimeoutError('K29_BULK_TOTAL_TIMEOUT: fixed 480-second budget exhausted; no retry')
    result = page.evaluate(r'''async input=>{
      let timer;
      try{return await Promise.race([
        __k28Call({name:input.name,args:input.args}),
        new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('K29_BULK_CALL_TIMEOUT: '+input.name+'; operation is not retried and may still be in flight')),input.timeoutMs)})
      ])}finally{clearTimeout(timer)}
    }''', {'name': name, 'args': args, 'timeoutMs': int(remaining * 1000)})
    return result


def snapshot(page):
    return page.evaluate(r'''async()=>{
      let timer;
      try{return await Promise.race([__k28Raw(),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('K29_BULK_DIAGNOSTIC_TIMEOUT')),15000)})])}
      finally{clearTimeout(timer)}
    }''')


def observe(page):
    return page.evaluate(r'''async()=>{
      let timer;
      try{return await Promise.race([__k29BulkObserve(),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('K29_BULK_OBSERVATION_TIMEOUT')),15000)})])}
      finally{clearTimeout(timer)}
    }''')


def verify_observation(report, label, current):
    revision = current['revision']
    report.check(label + ': primary, mirror and published state are byte-identical JSON', current['mirrorExact'] and current['publicExact'])
    report.check(label + ': original paid payroll, payments, banks and every protected business value remain byte-identical', current['protectedExact'] and current['protectedBeforeSha256'] == current['protectedAfterSha256'])
    report.check(label + ': all earlier daily sources, commissions and presets remain byte-identical and ordered', all(current['oldRowsPreserved'].values()), current['oldRowsPreserved'])
    report.check(label + ': all collection record IDs are present and unique', all(current['uniqueCollections'].values()), current['uniqueCollections'])
    report.check(label + ': actual journal and both tokens bind the current revision',
                 current['journal']['phase'] == 'COMMIT_VERIFIED' and
                 current['journal']['after']['businessSnapshotRevision'] == revision and
                 current['token']['revisionId'] == revision['id'] and
                 current['token']['sequence'] == revision['sequence'] and
                 current['receiptToken'] == revision['id'])
    report.check(label + ': no durable, local or session recovery marker', current['noRecoveryGate'])


def verify_sources(report, label, current, expected):
    logs, commissions = current['newLogs'], current['newCommissions']
    count = len(expected)
    markers = [row['note'] for row in logs]
    report.check(label + ': every successful unique input exists exactly once',
                 len(logs) == count and len(set(markers)) == count and
                 set(markers) == {row['values']['note'] for row in expected})
    ids = [row['id'] for row in logs]
    batches = [row['batchId'] for row in logs]
    work_ids = [item['workItemId'] for row in logs for item in row['items']]
    report.check(label + ': generated batch, daily and work-item IDs are nonempty and unique',
                 all(ids + batches + work_ids) and len(set(ids)) == count and
                 len(set(batches)) == count and len(work_ids) == count and len(set(work_ids)) == count)
    by_marker = {row['note']: row for row in logs}
    valid = True
    for saved in expected:
        values, batch = saved['values'], saved['batchId']
        log = by_marker.get(values['note'])
        item = values['lines'][0]
        valid = valid and bool(log) and log['batchId'] == batch and log['date'] == values['date'] and log['employee'] == EMPLOYEE and log['project'] == NEW_PROJECT and len(log['items']) == 1
        if valid:
            stored = log['items'][0]
            valid = all(stored[key] == item[key] for key in ('house', 'item', 'inputPrice')) and stored['qty'] == 1 and stored['untaxedSubtotal'] == item['inputPrice'] and log['commission'] == item['inputPrice'] // 2
    report.check(label + ': each durable source matches its own submitted date, employee, work, quantity and exact amount', valid)
    by_id = {row['id']: row for row in logs}
    report.check(label + ': exactly one commission source per new daily record',
                 len(commissions) == count and len({row['sourceId'] for row in commissions}) == count and
                 {row['sourceId'] for row in commissions} == set(ids) and
                 all(row['sourceType'] == 'daily-log' and row['employee'] == EMPLOYEE and
                     row['employee'] == by_id[row['sourceId']]['employee'] and
                     row['date'] == by_id[row['sourceId']]['date'] and
                     row['commission'] == by_id[row['sourceId']]['commission'] for row in commissions))
    total = sum(saved['values']['lines'][0]['inputPrice'] // 2 for saved in expected)
    report.check(label + ': one new unpaid-month summary contains only the exact new commissions',
                 len(current['newPayroll']) == 1 and current['newPayroll'][0]['employee'] == EMPLOYEE and
                 current['newPayroll'][0]['month'] == MONTH and current['newPayroll'][0]['status'] == '未付款' and
                 current['newPayroll'][0]['commission'] == total and current['newPayroll'][0]['total'] == total and
                 sum(row['commission'] for row in commissions) == total)


def run_case(browser, server, report, seed):
    name = 'fixed-1700kb-100-daily-commits-and-reload'
    context = browser.new_context(service_workers='block')
    page = None
    expected, steps = [], []
    deadline = time.monotonic() + TOTAL_SECONDS
    try:
        restrict(context, server, report, name)
        page = open_page(context, server)
        report.check('seed is written once to an owned empty browser profile', page.evaluate('data=>__k28Seed(data)', seed) is True)
        report.save('seed-raw-before-load.json', snapshot(page))
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        loaded = timed_call(page, 'load', [], deadline)
        report.check('exact candidate Store loads the full-size synthetic seed', loaded['ok'], loaded if not loaded['ok'] else None)
        # Same actual normalization commit as the unchanged K28 browser helper.
        setup = timed_call(page, 'saveCustomer', [{'name': CUSTOMER, 'note': PREFIX + 'normalized baseline'}, CUSTOMER], deadline)
        report.check('actual setup commit persists load-time normalization', setup['ok'], setup if not setup['ok'] else None)
        before = snapshot(page)
        report.save('before-raw.json', before)
        baseline = before['idb']['main']
        report.check('baseline still contains at least 1.7 MB of business JSON', len(compact(baseline).encode('utf-8')) >= TARGET_BYTES)
        report.check('test month has no payroll, payment or attendance source at baseline',
                     not any(row.get('month') == MONTH for row in baseline['payroll'] + baseline['salaryPayments']) and
                     not any(str(row.get('date', '')).startswith(MONTH) for row in baseline['attendance'] + baseline['commissions'] + baseline['dailyLogs']))
        report.check('baseline contains a fully paid original payroll and linked payment and bank records',
                     any(row.get('status') == '已付款' for row in baseline['payroll']) and
                     bool(baseline['salaryPayments']) and bool(baseline['banks']) and bool(baseline['bankTransactions']))
        page.evaluate(WATCH_JS)
        page.evaluate(OBSERVE_JS, baseline)
        previous = observe(page)
        report.save('before-observation.json', previous)
        verify_observation(report, 'baseline', previous)
        starting_revision = previous['revision']['sequence']
        for index in range(1, WRITE_COUNT + 1):
            started = time.monotonic()
            values = make_draft(index)
            report.data['attemptedInputs'] = index
            report.save('latest-attempt.json', {'index': index, 'input': values, 'save': None})
            token = timed_call(page, 'dailyDraftSnapshot', [values, ''], deadline)
            report.check('input %03d: actual scoped draft snapshot succeeds' % index, token['ok'], token if not token['ok'] else None)
            opts = {'strictRows': True, 'draftRowKeys': [PREFIX + 'DRAFT-ROW-' + str(index)],
                    'expectedDailyDraftSnapshot': token['result'], 'expectedDraftPrincipal': OWNER}
            # Keep exact pre-attempt raw evidence in harness memory. On failure
            # it is exported before closing the profile; no 100-copy artifact.
            page.evaluate(r'''async()=>{
              let timer;
              try{window.__k29BulkBeforeAttempt=await Promise.race([__k28Raw(),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('K29_BULK_BEFORE_ATTEMPT_TIMEOUT')),15000)})])}
              finally{clearTimeout(timer)}
            }''')
            result = timed_call(page, 'saveDailyBatch', [values, '', opts], deadline)
            report.save('latest-attempt.json', {'index': index, 'input': values, 'save': result})
            current = observe(page)
            step = {'index': index, 'seconds': round(time.monotonic() - started, 4),
                    'input': values, 'save': result, 'observation': current}
            steps.append(step)
            # Evidence is written before assertions, including a rejected writer.
            report.save('steps.json', steps)
            report.check('input %03d: actual daily writer succeeds exactly once without retry' % index,
                         result['ok'] and isinstance(result.get('result'), str) and bool(result['result']), result)
            expected.append({'values': values, 'batchId': result['result']})
            report.data['completedInputs'] = len(expected)
            label = 'input %03d' % index
            verify_observation(report, label, current)
            verify_sources(report, label, current, expected)
            revision, prior = current['revision'], previous['revision']
            transaction = current['transaction']
            report.check(label + ': one new revision, matching parent and one audit entry',
                         revision['sequence'] == prior['sequence'] + 1 and revision['parentId'] == prior['id'] and
                         current['audit']['count'] == previous['audit']['count'] + 1 and
                         current['audit']['tailSha256'] == previous['audit']['sha256'])
            report.check(label + ': exactly one matching committed transaction and durable event',
                         transaction['status'] in ('COMMITTED', 'COMMITTED_WITH_NOTIFICATION_WARNING') and
                         transaction['operationType'] == 'saveDailyBatch' and
                         transaction['operationId'] == revision['operationId'] and transaction['revisionId'] == revision['id'] and
                         len(current['events']) == index and
                         current['events'][-1]['detail'].get('operationId') == revision['operationId'] and
                         current['events'][-1]['detail'].get('revisionId') == revision['id'] and
                         current['journal']['operationId'] == revision['operationId'])
            previous = current
            if index % 10 == 0:
                report.flush()
                print(json.dumps({'completed': index, 'target': WRITE_COUNT,
                                  'primaryUtf8Bytes': current['primary']['utf8Bytes'],
                                  'mirrorUtf16Bytes': current['mirror']['utf16Bytes'],
                                  'elapsedSeconds': round(TOTAL_SECONDS - (deadline - time.monotonic()), 2)}), flush=True)
        after = snapshot(page)
        report.save('after-raw.json', after)
        report.save('after-observation.json', previous)
        report.check('100 calls produce exactly 100 new durable revisions', previous['revision']['sequence'] == starting_revision + WRITE_COUNT)
        report.check('100 successful commits have 100 unique operation IDs', len({row['observation']['revision']['operationId'] for row in steps}) == WRITE_COUNT)
        report.data['beforeCapacity'] = json.loads((report.output / 'before-observation.json').read_text(encoding='utf-8'))['capacity']
        report.data['afterCapacity'] = previous['capacity']
        # Real page reload of the same origin/profile, not state assignment or a
        # second seed. Install the event observer before loading the real Store.
        page.reload(wait_until='load')
        page.evaluate(WATCH_JS)
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        reloaded = timed_call(page, 'load', [], deadline)
        report.save('reload-raw.json', snapshot(page))
        report.check('same-origin page reload loads persisted data without another seed or writer', reloaded['ok'], reloaded if not reloaded['ok'] else None)
        page.evaluate(OBSERVE_JS, baseline)
        reopened = observe(page)
        report.save('reload-observation.json', reopened)
        verify_observation(report, 'reload', reopened)
        verify_sources(report, 'reload', reopened, expected)
        report.check('reload preserves raw primary, mirror, journal, tokens and recovery markers exactly', snapshot(page) == after)
        report.check('reload publishes the identical complete business snapshot and revision with zero commit events',
                     reopened['primary'] == previous['primary'] and reopened['memory'] == previous['memory'] and
                     reopened['revision'] == previous['revision'] and not reopened['events'])
        report.data['reloadCapacity'] = reopened['capacity']
        report.data['elapsedSeconds'] = round(TOTAL_SECONDS - (deadline - time.monotonic()), 2)
        report.case(name)
    except Exception:
        report.data['completedInputs'] = len(expected)
        report.save('completed-inputs-before-failure.json', expected)
        if page is not None:
            try:
                report.save('failure-before-attempt-raw.json', page.evaluate('()=>window.__k29BulkBeforeAttempt||null'))
            except Exception as error:
                report.save('failure-before-attempt-unavailable.json', {'message': str(error)})
            try:
                report.save('failure-raw.json', snapshot(page))
            except Exception as error:
                report.save('failure-raw-unavailable.json', {'message': str(error), 'stateMayBeInFlight': True})
            try:
                report.save('failure-observation.json', observe(page))
            except Exception as error:
                report.save('failure-observation-unavailable.json', {'message': str(error)})
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', type=Path)
    parser.add_argument('--browser')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    store = (args.store or ROOT / 'assets/js/erp-store.js').read_bytes()
    report = Report(args.output.resolve())
    report.data.update(schema='k29-fixed-bulk-durable-browser-v1', baseCommit=BASE,
                       targetSeedUtf8Bytes=TARGET_BYTES, targetInputs=WRITE_COUNT, attemptedInputs=0, completedInputs=0,
                       storeSha256=sha(store), realCloudSyncTested=False, realAuthenticationTested=False,
                       crossDeviceTested=False, physicalPhoneTested=False, automaticRetries=0,
                       totalBudgetSeconds=TOTAL_SECONDS, perCallBudgetSeconds=CALL_SECONDS)
    browser_started = False
    try:
        seed = build_fixture()
        report.save('synthetic-seed.json', seed)
        report.data['fixture'] = {'compactUtf8Bytes': len(compact(seed).encode('utf-8')),
                                  'compactSha256': sha(compact(seed).encode('utf-8')),
                                  'quotations': len(seed['quotations']),
                                  'quotationLines': sum(len(row['lines']) for row in seed['quotations']),
                                  'maximumLineNoteCharacters': max(len(line['note']) for row in seed['quotations'] for line in row['lines'])}
        sources = {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in
                   (Path(__file__).resolve(), ROOT / '.p41-k28-tests/k28_browser_store.py', ROOT / '.p41-k28-tests/k28_fixture.py')}
        report.save('SOURCE_SCOPE.json', {'storeSha256': sha(store), 'sources': sources, 'fixture': report.data['fixture'],
                    'headCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                    'scope': __doc__, 'productionDataTouched': False, 'publishGate': 'BLOCKED'})
        report.flush()
        with Server(store, ROOT) as server, sync_playwright() as playwright:
            executable = select_browser(args.browser)
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            launch = {'headless': True}
            if executable:
                launch['executable_path'] = executable
            browser = playwright.chromium.launch(**launch)
            browser_started = True
            report.data['browserVersion'] = browser.version
            try:
                run_case(browser, server, report, seed)
            finally:
                browser.close()
        report.check('every request stayed within the exact owned loopback allowlist', not report.data['externalRequests'], report.data['externalRequests'])
        report.check('no unhandled browser page errors', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'K29_BULK_INPUT_PASS'
        return 0
    except Exception as error:
        report.data['status'] = 'FAIL' if browser_started else 'BLOCKED'
        report.data['failures'].append({'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data.get(key) for key in ('status', 'passCount', 'failCount', 'completedInputs', 'targetInputs', 'fixture', 'storeSha256', 'failures')}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
