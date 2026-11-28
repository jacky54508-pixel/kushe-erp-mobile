#!/usr/bin/env python3
"""K30 real Store acceptance in owned empty browser profiles, synthetic data only.

No production URL, credentials, user backup, remote service or mocked Store is
used. The explicit cloud capability fixture tests the Store boundary only; the
real cloud/CAS contract is a separate suite owned by the release orchestrator.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import traceback

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.p41-k28-tests'))
from k28_browser_store import (Report as BaseReport, Server, call, raw, public,
    restrict, open_page, select_browser, JOURNAL, EMERGENCY, STORE_TOKEN, RECEIPT_TOKEN, GATES)
from k30_fixture import (HTML, PREFIX, OWNER, CUSTOMER, BANK, EMPLOYEE, IDS, ARS,
    DATE, FIELDS, ORIGINALS, REDUCTIONS, GROUP_SETUP, fixture, allowance_input, reversal_input)

BASE_COMMIT = '3a8fc71efa70ea56332fbbd781f8db78a680448f'
SCHEMA = 'kushe.billing.allowances.v1'
META_WRITES = {'billingAllowances', 'updatedAt', 'businessSnapshotRevision', 'receiptCommitVersion'}


class Report(BaseReport):
    def __init__(self, output):
        super().__init__(output)
        self.data.update(schema='k30-real-store-browser-v1', baseCommit=BASE_COMMIT,
                         cloudEvidence='isolated capability fixture; real cloud/CAS tested separately')
        self.qa = output / 'screenshots'
        self.qa.mkdir(parents=True, exist_ok=True)


def ledger(state):
    rows = state.get('meta', {}).get('billingAllowances', [])
    if not isinstance(rows, list):
        raise AssertionError('billingAllowances must be an append-only array')
    return rows


def boot(context, server, report, name, kind='standard'):
    restrict(context, server, report, name)
    page = open_page(context, server)
    report.check(name + ': owned empty synthetic profile is seeded exactly once', page.evaluate('x=>__k28Seed(x)', fixture(kind)) is True)
    page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
    answer = call(page, 'load')
    report.check(name + ': actual Store loads synthetic financial fixture', answer['ok'], answer if not answer['ok'] else None)
    normalized = call(page, 'saveCustomer', {'name': PREFIX + '合成客戶', 'note': PREFIX + 'NORMALIZED-SYNTHETIC-BASELINE'}, CUSTOMER)
    report.check(name + ': actual Store commits normalized baseline', normalized['ok'], normalized if not normalized['ok'] else None)
    before = raw(page)
    report.check(name + ': public baseline equals actual durable primary', public(page) == before['idb']['main'])
    report.check(name + ': immutable witnesses include real invoices, receipts, retention, salary and bank records', all(before['idb']['main'].get(key) for key in ('invoices', 'receipts', 'retentionReceipts', 'commissions', 'dailyLogs', 'payroll', 'salaryPayments', 'bankTransactions', 'banks')))
    return page, before


def invoke(page, report, name, method, *args):
    answer = call(page, method, *args)
    report.check(name + ': actual ' + method + ' succeeds', answer['ok'], answer if not answer['ok'] else None)
    return answer['result']


def preview(page, report, name, values, allowed=True):
    before, state = raw(page), public(page)
    result = invoke(page, report, name, 'billingAllowancePreview', values)
    report.check(name + ': preview is read-only across every storage layer', raw(page) == before and public(page) == state)
    report.check(name + ': preview decision matches expected admission', result['allowed'] is allowed, result)
    if allowed:
        report.check(name + ': admitted preview has snapshot and no blockers', bool(result.get('snapshot')) and not result.get('blockers'), result)
    else:
        report.check(name + ': refused preview explains its blockers', bool(result.get('blockers')), result)
    return result


def prepared(page, report, name, values):
    plan = preview(page, report, name, values)
    return {**deepcopy(values), 'expectedSnapshot': plan['snapshot']}, plan


def unchanged(report, name, page, before):
    after = raw(page)
    report.check(name + ': durable data, mirrors, tokens, session and public state remain unchanged',
                 after['idb']['main'] == before['idb']['main'] and after['local'] == before['local']
                 and after['session'] == before['session'] and public(page) == before['idb']['main'])
    return after


def denied(page, report, name, method, *args):
    before = raw(page)
    result = call(page, method, *args)
    report.check(name + ': unsafe writer returns failure', not result['ok'], result)
    unchanged(report, name, page, before)
    return result


def check_commit(report, name, page, before, result, event_type='post'):
    if result is not None:
        report.check(name + ': formal writer succeeds', result['ok'], result)
    after = raw(page)
    old, new = before['idb']['main'], after['idb']['main']
    old_events, new_events = ledger(old), ledger(new)
    report.check(name + ': exactly one append-only ledger event is added', len(new_events) == len(old_events) + 1 and new_events[:-1] == old_events)
    event = new_events[-1]
    report.check(name + ': persisted event has exact formal identity and type', event.get('schema') == SCHEMA and event.get('eventType') == event_type and (result is None or result['result'].get('id') == event.get('id')) and bool(event.get('id')), event)
    report.check(name + ': every original collection and settings are byte-equivalent', all(new.get(key) == value for key, value in old.items() if key not in ('meta', 'audit')) and set(new) == set(old))
    report.check(name + ': unrelated metadata remains byte-equivalent',
                 {k: v for k, v in new['meta'].items() if k not in META_WRITES} == {k: v for k, v in old['meta'].items() if k not in META_WRITES})
    revision, previous = new['meta']['businessSnapshotRevision'], old['meta']['businessSnapshotRevision']
    report.check(name + ': one revision and its exact parent are committed', revision['sequence'] == previous['sequence'] + 1 and revision['parentId'] == previous['id'])
    report.check(name + ': exactly one audit is added without rewriting history', len(new['audit']) == len(old['audit']) + 1 and new['audit'][1:] == old['audit'])
    journal = after['idb'][JOURNAL]
    expected_writer = 'postBillingAllowance' if event_type == 'post' else 'reverseBillingAllowance'
    report.check(name + ': real transaction journal identifies the formal writer', journal['phase'] == 'COMMIT_VERIFIED' and journal.get('operationType') == expected_writer, journal)
    report.check(name + ': durable primary, emergency mirror and commit tokens agree', json.loads(after['local'][EMERGENCY]) == new and json.loads(after['local'][STORE_TOKEN])['revisionId'] == revision['id'] and after['local'][RECEIPT_TOKEN] == revision['id'])
    report.check(name + ': public state is unmodified durable state and recovery gates are clear', public(page) == new and all(after[layer][gate] is None for layer in ('idb', 'local', 'session') for gate in GATES))
    return event, after


def post(page, report, name, values):
    request, plan = prepared(page, report, name, values)
    before = raw(page)
    answer = call(page, 'postBillingAllowance', request)
    event, after = check_commit(report, name, page, before, answer)
    return event, after, request, plan


def financial(page, report, name, index=0):
    result = invoke(page, report, name, 'billingFinancialState', IDS[index])
    other = invoke(page, report, name, 'receivableFinancialState', ARS[index])
    report.check(name + ': billing and receivable resolve one valid effective source', result['valid'] and other['valid'] and result['effective'] == other['effective'] and result['settlement'] == other['settlement'], result)
    return result


def receipt(amount, key='RECEIPT', index=0, deduction=0):
    return {'receivableId': ARS[index], 'date': DATE, 'amount': amount, 'cashAmount': amount,
            'collectionType': 'bank', 'bankId': BANK, 'paymentMethod': '銀行轉帳', 'fee': 17,
            'feePayer': 'company', 'note': PREFIX + key, 'idempotencyKey': PREFIX + key,
            'deductions': [{'category': '修繕／缺失扣款', 'amount': deduction, 'note': PREFIX + 'AGREED-DEDUCTION'}] if deduction else []}


def retention(amount, key='RETENTION', index=0):
    return {'receivableId': ARS[index], 'date': DATE, 'amount': amount, 'bankId': BANK,
            'bankAccountId': BANK, 'fee': 3, 'feePayer': 'company', 'paymentMethod': '銀行轉帳',
            'note': PREFIX + key, 'idempotencyKey': PREFIX + key}


def cheque(page, amount, key='CHEQUE', index=0, deduction=0):
    answer = call(page, 'receivableChequeSnapshot', ARS[index])
    if not answer['ok']:
        raise AssertionError(answer)
    return {'number': PREFIX + key, 'amount': amount, 'receivedDate': '2026-10-18',
            'dueDate': DATE, 'reminderDays': 3, 'issuerBank': PREFIX + 'DRAWER-BANK',
            'drawer': PREFIX + 'DRAWER', 'note': PREFIX + key, 'idempotencyKey': PREFIX + key,
            'expectedSnapshot': answer['result'], 'deductions': [{'category': '修繕／缺失扣款',
            'amount': deduction, 'note': PREFIX + 'CHEQUE-DEDUCTION'}] if deduction else []}


def run_positive(browser, server, report, kind='standard', group=False, zero_source=False):
    name = 'post-' + kind + ('-group-zero-source' if zero_source else '-group' if group else '-single')
    context = browser.new_context(service_workers='block')
    try:
        page, baseline = boot(context, server, report, name, kind)
        group_row = page.evaluate(GROUP_SETUP) if group else None
        values = allowance_input(group_id=group_row['document']['id'] if group else '', issued=kind == 'issued')
        if zero_source:
            values['allocations'][1]['reductions'] = {key: 0 for key in FIELDS}
            values['approvedGrossReduction'] = REDUCTIONS[0]['grossTotal']
        before_finance = financial(page, report, name + '-before')
        event, after, request, plan = post(page, report, name, values)
        actual = financial(page, report, name + '-after')
        expected = {key: ORIGINALS[0][key] - REDUCTIONS[0][key] for key in FIELDS}
        report.check(name + ': exact effective amounts preserve original amounts', actual['original'] == ORIGINALS[0] and actual['effective'] == expected and actual['hasAllowance'] is True, actual)
        expected_received = 41000 if kind == 'legacy-received' else 40000
        expected_outstanding = 90000 - expected_received
        report.check(name + ': linked prior cash and effective available amount are exact', actual['settlement']['received'] == expected_received and actual['settlement']['outstanding'] == expected_outstanding and actual['settlement']['available'] == expected_outstanding and actual['settlement']['retentionOutstanding'] == 4500, actual['settlement'])
        if group:
            other = financial(page, report, name + '-source-b', 1)
            b_reduction = {key: 0 for key in FIELDS} if zero_source else REDUCTIONS[1]
            report.check(name + ': each grouped source changes only by its own explicit allocation', other['effective'] == {key: ORIGINALS[1][key] - b_reduction[key] for key in FIELDS} and len(event['allocations']) == 2)
            report.check(name + ': group allowance is booked once across sources', sum(row['reductions']['grossTotal'] for row in event['allocations']) == values['approvedGrossReduction'])
            index = invoke(page, report, name, 'externalBillingDocumentIndex')
            grouped = next(row for row in index['documents'] if row['document']['id'] == group_row['document']['id'])
            report.check(name + ': group balances equal the sum of its effective original sources', grouped['totals']['outstanding'] == actual['settlement']['outstanding'] + other['settlement']['outstanding'] and grouped['totals']['retentionOutstanding'] == actual['settlement']['retentionOutstanding'] + other['settlement']['retentionOutstanding'], grouped['totals'])
        accounting = invoke(page, report, name, 'allowanceAccountingRows')
        rows = [row for row in accounting if row['eventId'] == event['id']]
        report.check(name + ': accounting exports one signed row per original source', len(rows) == len(values['allocations']) and sum(row['grossTotal'] for row in rows) == -values['approvedGrossReduction'] and sum(row['tax'] for row in rows) == -sum(row['reductions']['tax'] for row in values['allocations']), rows)
        replay = call(page, 'postBillingAllowance', request)
        report.check(name + ': identical replay never creates a second transaction', raw(page) == after and (not replay['ok'] or replay['result']['id'] == event['id']), replay)
        report.save(name + '.json', {'preview': plan, 'event': event, 'before': before_finance, 'after': actual, 'accountingRows': rows, 'replay': replay})
        report.case(name)
    finally:
        context.close()


def run_reversal(browser, server, report, issued=False, received_after=False, later=False):
    name = 'reverse' + ('-issued' if issued else '') + ('-after-ordinary-receipt' if received_after else '') + ('-later-active-block' if later else '')
    context = browser.new_context(service_workers='block')
    try:
        page, baseline = boot(context, server, report, name, 'issued' if issued else 'standard')
        event, _, _, _ = post(page, report, name + '-post', allowance_input(issued=issued))
        if received_after:
            invoke(page, report, name, 'addReceipt', receipt(1000, key='AFTER-POST'))
        if later:
            values = allowance_input(reductions={key: value // 10 for key, value in REDUCTIONS[0].items()}, key='LATER')
            post(page, report, name + '-later', values)
        values = reversal_input(event['id'], invoice_id=IDS[0] + '-INVOICE' if issued else '')
        if later:
            plan = preview(page, report, name, values, allowed=False)
            denied(page, report, name, 'reverseBillingAllowance', event['id'], {**values, 'expectedSnapshot': plan.get('snapshot', '')})
        else:
            request, plan = prepared(page, report, name, values)
            before = raw(page)
            reversed_event, after = check_commit(report, name, page, before, call(page, 'reverseBillingAllowance', event['id'], request), 'reverse')
            report.check(name + ': reversal references original posting without editing it', reversed_event['reverseOf'] == event['id'] and ledger(after['idb']['main'])[0] == event)
            projection = financial(page, report, name)
            report.check(name + ': effective amounts return exactly to original basis', projection['effective'] == ORIGINALS[0] and projection['settlement']['received'] == (41000 if received_after else 40000))
            accounting = invoke(page, report, name, 'allowanceAccountingRows')
            report.check(name + ': posting and reversal net to zero in every accounting amount', all(sum(row[key] for row in accounting if row['billingId'] == IDS[0]) == 0 for key in FIELDS), accounting)
            repeated = reversal_input(event['id'], key='SECOND-REVERSE', invoice_id=IDS[0] + '-INVOICE' if issued else '')
            rejected = preview(page, report, name + '-double', repeated, allowed=False)
            denied(page, report, name + '-double', 'reverseBillingAllowance', event['id'], {**repeated, 'expectedSnapshot': rejected.get('snapshot', '')})
        report.case(name)
    finally:
        context.close()


def run_invalid(browser, server, report, case):
    name = 'reject-' + case
    context = browser.new_context(service_workers='block')
    try:
        kind = case if case in ('linked-commission', 'duplicate-ar', 'conflicting-alias', 'legacy-received', 'tax-rate-changed') else 'issued' if case.startswith('invoice-') else 'standard'
        page, _ = boot(context, server, report, name, kind)
        values = allowance_input(issued=case.startswith('invoice-'))
        if case == 'approved-total':
            values['approvedGrossReduction'] += 1
        elif case == 'gross-equation':
            values['allocations'][0]['reductions']['grossTotal'] += 1
            values['approvedGrossReduction'] += 1
        elif case == 'receivable-equation':
            values['allocations'][0]['reductions']['receivable'] += 1
        elif case == 'pending-tax-equation':
            values = allowance_input(reductions=dict(zip(FIELDS, (10000, 0, 10000, 500, 9500))))
        elif case == 'negative-reduction':
            values['allocations'][0]['reductions']['tax'] = -1
        elif case == 'fractional-reduction':
            values['allocations'][0]['reductions']['untaxed'] = 10000.5
        elif case == 'duplicate-source':
            values['allocations'].append(deepcopy(values['allocations'][0]))
            values['approvedGrossReduction'] *= 2
        elif case == 'missing-source':
            values['allocations'] = []
        elif case == 'wrong-source':
            values['allocations'][0]['billingId'] = IDS[1]
        elif case == 'over-already-received':
            values = allowance_input(reductions=dict(zip(FIELDS, (70000, 3500, 73500, 3500, 70000))))
        elif case == 'retention-already-received':
            values = allowance_input(index=1, reductions=dict(zip(FIELDS, (70000, 3500, 73500, 3500, 70000))))
        elif case == 'invoice-no-voucher':
            values['invoiceEvidence'] = []
        elif case == 'invoice-wrong-id':
            values['invoiceEvidence'][0]['invoiceId'] = PREFIX + 'MISSING-INVOICE'
        elif case == 'invoice-unverified':
            values['invoiceEvidence'][0]['verified'] = False
        elif case == 'cloud-capability':
            page.evaluate("()=>{__k30CloudReady={ready:false,reason:'SYN-K30 capability unavailable',capability:'billing-allowances-v1'}}")
        elif case == 'cloud-hook-absent':
            page.evaluate('()=>{delete KusheCloudSync.billingAllowanceWriteReadiness}')
        elif case == 'owner-role':
            page.evaluate("()=>{__k28Auth.role='staff'}")
        elif case == 'wrong-company-user':
            page.evaluate("()=>{__k28Auth.contextUser='SYN-K30-OTHER-OWNER'}")
        elif case == 'untrusted':
            page.evaluate("()=>localStorage.removeItem('kushe_erp_device_trust_v1')")
        elif case == 'group-incomplete':
            group = page.evaluate(GROUP_SETUP)
            values = allowance_input(group_id=group['document']['id'])
            values['allocations'].pop()
            values['approvedGrossReduction'] = REDUCTIONS[0]['grossTotal']
        elif case == 'single-inside-group':
            page.evaluate(GROUP_SETUP)
        plan = preview(page, report, name, values, allowed=False)
        if case == 'linked-commission':
            report.check(name + ': unresolved commission policy is explicit', any('COMMISSION_POLICY_REVIEW' in row.get('code', '') for row in plan['blockers']), plan)
        denied(page, report, name, 'postBillingAllowance', {**values, 'expectedSnapshot': plan.get('snapshot', '')})
        report.case(name)
    finally:
        context.close()


def run_missing_submit_guard(browser, server, report, case):
    name = 'submit-guard-' + case
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        request, _ = prepared(page, report, name, allowance_input())
        request.pop(case, None)
        denied(page, report, name, 'postBillingAllowance', request)
        report.case(name)
    finally:
        context.close()


def run_stale(browser, server, report, change):
    name = 'stale-' + change
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        request, _ = prepared(page, report, name, allowance_input())
        if change == 'receipt':
            invoke(page, report, name, 'addReceipt', receipt(1000, key='STALE-RECEIPT'))
        elif change == 'retention':
            invoke(page, report, name, 'addRetentionReceipt', retention(1000, key='STALE-RETENTION'))
        elif change == 'cheque':
            invoke(page, report, name, 'saveReceivableCheque', ARS[0], cheque(page, 1000, key='STALE-CHEQUE'))
        elif change == 'invoice':
            invoke(page, report, name, 'saveInvoice', {'invoiceType': 'output', 'sourceId': IDS[0], 'status': 'issued', 'invoiceNumber': PREFIX + 'STALE-INVOICE', 'invoiceDate': DATE})
        elif change == 'allowance':
            post(page, report, name + '-other', allowance_input(key='OTHER-POST'))
        elif change == 'tax-setting':
            invoke(page, report, name, 'saveSystemSettings', {**public(page)['settings'], 'defaultTax': 10})
        denied(page, report, name, 'postBillingAllowance', request)
        report.case(name)
    finally:
        context.close()


def run_idempotency_conflict(browser, server, report):
    name = 'idempotency-key-payload-conflict'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        values = allowance_input()
        post(page, report, name, values)
        changed = allowance_input(reductions={key: amount // 10 for key, amount in REDUCTIONS[0].items()})
        plan = invoke(page, report, name, 'billingAllowancePreview', changed)
        denied(page, report, name, 'postBillingAllowance', {**changed, 'expectedSnapshot': plan['snapshot']})
        report.case(name)
    finally:
        context.close()


def run_missing_reversal_id(browser, server, report):
    name = 'empty-reversal-id-never-falls-through-to-valid-post'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        # This payload is independently admitted as a complete valid posting.
        # Only the reversal identifier is missing; rejection cannot be explained
        # by another malformed field, stale snapshot or absent confirmation.
        request, _ = prepared(page, report, name, allowance_input())
        for missing in ('', None):
            before = raw(page)
            answer = denied(page, report, name, 'reverseBillingAllowance', missing, request)
            report.check(name + ': missing reversal target is explicitly rejected', answer['error']['code'] == 'ALLOWANCE_NOT_FOUND', answer)
            report.check(name + ': rejection writes no primary, journal, mirrors or tokens', raw(page) == before and ledger(public(page)) == [])
        report.case(name)
    finally:
        context.close()


def run_late_auth(browser, server, report, field):
    name = 'late-authority-' + field
    context = browser.new_context(service_workers='block')
    try:
        page, before = boot(context, server, report, name)
        request, _ = prepared(page, report, name, allowance_input())
        page.evaluate("""field=>{
          const original=navigator.storage.estimate.bind(navigator.storage);window.__k30LateCalls=0;
          navigator.storage.estimate=async()=>{const answer=await original();window.__k30LateCalls++;
            if(field==='role')__k28Auth.role='staff';else if(field==='epoch')KuSheERPStore.clearEphemeralSession();
            else if(field==='cloud')__k30CloudReady.ready=false;else __k28Auth.principal='SYN-K30-CHANGED-PRINCIPAL';return answer};
          window.__k30RestoreEstimate=()=>{navigator.storage.estimate=original};
        }""", field)
        try:
            answer = call(page, 'postBillingAllowance', request)
        finally:
            page.evaluate('()=>__k30RestoreEstimate()')
        report.check(name + ': identity changes at the actual capacity await', page.evaluate('()=>__k30LateCalls') == 1)
        report.check(name + ': authority is rechecked before committing', not answer['ok'], answer)
        unchanged(report, name, page, before)
        report.case(name)
    finally:
        context.close()


def run_rollback(browser, server, report, target, reversal=False):
    name = ('reverse' if reversal else 'post') + '-rollback-' + target
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        event = post(page, report, name + '-setup', allowance_input())[0] if reversal else None
        values = reversal_input(event['id']) if reversal else allowance_input()
        request, _ = prepared(page, report, name, values)
        before = raw(page)
        page.evaluate("""target=>{
          const put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;window.__k30FaultCount=0;
          window.__k30Restore=()=>{IDBObjectStore.prototype.put=put;Storage.prototype.setItem=set};
          const fault=()=>{window.__k30FaultCount++;throw Object.assign(new Error('SYN-K30 injected persistence failure'),{code:'SYN_K30_PERSISTENCE_FAILURE'})};
          IDBObjectStore.prototype.put=function(value,key){if(target==='primary'&&this.name==='erp'&&key==='main'&&window.__k30FaultCount===0)fault();return put.call(this,value,key)};
          Storage.prototype.setItem=function(key,value){if(target!=='primary'&&this===localStorage&&key===target&&window.__k30FaultCount===0)fault();return set.call(this,key,value)};
        }""", target)
        method, args = ('reverseBillingAllowance', [event['id'], request]) if reversal else ('postBillingAllowance', [request])
        try:
            answer = call(page, method, *args)
        finally:
            page.evaluate('()=>__k30Restore()')
        report.check(name + ': intended actual persistence boundary fails exactly once', page.evaluate('()=>__k30FaultCount') == 1)
        report.check(name + ': persistence failure is rolled back rather than reported successful', not answer['ok'] and answer['error']['code'] == 'SYN_K30_PERSISTENCE_FAILURE' and answer['error']['transactionStatus'] in ('ROLLED_BACK', 'REJECTED'), answer)
        unchanged(report, name, page, before)
        retry, _ = prepared(page, report, name + '-retry', values)
        result = call(page, method, *([event['id'], retry] if reversal else [retry]))
        check_commit(report, name + '-retry', page, before, result, 'reverse' if reversal else 'post')
        report.case(name)
    finally:
        context.close()


def run_receipts(browser, server, report):
    name = 'receipt-cash-deductions-update-delete-effective-capacity'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        event = post(page, report, name + '-post', allowance_input())[0]
        preserved = public(page)
        denied(page, report, name + '-one-over', 'addReceipt', receipt(49901, deduction=100))
        saved = invoke(page, report, name, 'addReceipt', receipt(49000, deduction=1000))
        state = public(page)
        transaction = next(row for row in state['bankTransactions'] if row['id'] == saved['bankTransactionId'])
        report.check(name + ': cash plus deduction settles exact effective balance with correct bank net', saved['settlementAmount'] == 50000 and saved['cashAmount'] == 49000 and saved['deductionAmount'] == 1000 and transaction['amount'] == 48983)
        summary = financial(page, report, name)
        report.check(name + ': settled balance reaches zero without changing original amount', summary['settlement']['outstanding'] == 0 and summary['original'] == ORIGINALS[0])
        denied(page, report, name + '-update-over', 'updateReceipt', saved['id'], receipt(49901, deduction=100))
        invoke(page, report, name, 'updateReceipt', saved['id'], receipt(48000, deduction=1000))
        report.check(name + ': valid edit restores exactly the effective available difference', financial(page, report, name)['settlement']['outstanding'] == 1000)
        invoke(page, report, name, 'deleteReceipt', saved['id'])
        after = public(page)
        report.check(name + ': deleting only the new receipt restores the original receipt and bank records', after['receipts'] == preserved['receipts'] and after['bankTransactions'] == preserved['bankTransactions'] and ledger(after) == [event])
        for key in ('commissions', 'dailyLogs', 'payroll', 'salaryPayments', 'invoices'):
            report.check(name + ': collection remains exact ' + key, after[key] == preserved[key])
        report.check(name + ': receipt removal restores effective available balance', financial(page, report, name)['settlement']['available'] == 50000)
        report.case(name)
    finally:
        context.close()


def run_retention(browser, server, report):
    name = 'retention-effective-capacity-and-original-income'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        post(page, report, name + '-post', allowance_input(index=1))
        preserved = public(page)
        denied(page, report, name + '-one-over', 'addRetentionReceipt', retention(2601, index=1))
        saved = invoke(page, report, name, 'addRetentionReceipt', retention(2600, index=1))
        report.check(name + ': previous 1000 plus new 2600 settles effective retention exactly', financial(page, report, name, 1)['settlement']['retentionOutstanding'] == 0)
        denied(page, report, name + '-update-over', 'updateRetentionReceipt', saved['id'], retention(2601, index=1))
        invoke(page, report, name, 'updateRetentionReceipt', saved['id'], retention(2500, index=1))
        report.check(name + ': editing only new retention restores exact remainder', financial(page, report, name, 1)['settlement']['retentionOutstanding'] == 100)
        invoke(page, report, name, 'deleteRetentionReceipt', saved['id'])
        after = public(page)
        report.check(name + ': original retention and bank transaction records survive untouched', after['retentionReceipts'] == preserved['retentionReceipts'] and after['bankTransactions'] == preserved['bankTransactions'])
        report.check(name + ': effective retention remainder returns to 2600', financial(page, report, name, 1)['settlement']['retentionOutstanding'] == 2600)
        report.case(name)
    finally:
        context.close()


def run_cheques(browser, server, report):
    name = 'cheque-reservation-clear-cancel-effective-capacity'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        old_form = cheque(page, 1000, key='FORM-BEFORE-ALLOWANCE')
        post(page, report, name + '-post', allowance_input())
        denied(page, report, name + '-stale-form', 'saveReceivableCheque', ARS[0], old_form)
        denied(page, report, name + '-one-over', 'saveReceivableCheque', ARS[0], cheque(page, 49001, deduction=1000))
        registered = invoke(page, report, name, 'saveReceivableCheque', ARS[0], cheque(page, 9000, deduction=1000))
        capacity = invoke(page, report, name, 'receivableChequeCapacity', ARS[0])
        report.check(name + ': cheque cash and deductions both reserve effective capacity', capacity['outstanding'] == 50000 and capacity['reserved'] == 10000 and capacity['available'] == 40000, capacity)
        denied(page, report, name + '-receipt-reservation', 'addReceipt', receipt(40001, key='RESERVED-OVER'))
        values = allowance_input(reductions=dict(zip(FIELDS, (45000, 2250, 47250, 2250, 45000))), key='CHEQUE-OVERLAP')
        rejected = preview(page, report, name + '-occupied', values, allowed=False)
        denied(page, report, name + '-occupied', 'postBillingAllowance', {**values, 'expectedSnapshot': rejected.get('snapshot', '')})
        edited = cheque(page, 8000, key='CHEQUE-EDIT', deduction=1000)
        invoke(page, report, name, 'saveReceivableCheque', ARS[0], edited, registered['id'])
        before = raw(page)
        confirmed = invoke(page, report, name, 'clearReceivableCheque', ARS[0], registered['id'], {
            'date': DATE, 'bankId': BANK, 'fee': 17, 'feePayer': 'company', 'confirmed': True,
            'expectedSnapshot': call(page, 'receivableChequeSnapshot', ARS[0])['result'], 'idempotencyKey': PREFIX + 'CLEAR', 'note': PREFIX + 'ACTUAL-BANK-CREDIT'})
        after = raw(page)
        report.check(name + ': actual cheque clear is one outer atomic transaction', after['idb']['main']['meta']['businessSnapshotRevision']['sequence'] == before['idb']['main']['meta']['businessSnapshotRevision']['sequence'] + 1 and len(after['idb']['main']['audit']) == len(before['idb']['main']['audit']) + 1)
        cleared_receipt = next(row for row in after['idb']['main']['receipts'] if row['id'] == confirmed['receiptId'])
        bank = next(row for row in after['idb']['main']['bankTransactions'] if row['id'] == confirmed['bankTransactionId'])
        report.check(name + ': cleared cheque links exactly one 9000 settlement and 7983 bank credit', cleared_receipt['settlementAmount'] == 9000 and bank['amount'] == 7983 and bank['chequeId'] == registered['id'])
        second = invoke(page, report, name, 'saveReceivableCheque', ARS[0], cheque(page, 1000, key='CANCELLED-CHEQUE'))
        invoke(page, report, name, 'cancelReceivableCheque', ARS[0], second['id'], {'reason': PREFIX + 'RETURNED-CHEQUE', 'expectedSnapshot': call(page, 'receivableChequeSnapshot', ARS[0])['result']})
        current = financial(page, report, name)
        report.check(name + ': cleared and cancelled cheques no longer reserve twice', current['settlement']['pendingChequeReserved'] == 0 and current['settlement']['received'] == 49000 and current['settlement']['available'] == 41000)
        report.case(name)
    finally:
        context.close()


def run_commission_gate(browser, server, report):
    name = 'discounted-source-manual-commission-policy-preserves-history'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        post(page, report, name + '-post', allowance_input())
        original = public(page)
        denied(page, report, name, 'saveCommission', {'date': DATE, 'employee': EMPLOYEE,
            'project': PREFIX + 'PROJECT-A', 'billing': IDS[0], 'sourceNo': PREFIX + 'NO-A',
            'untaxedAmount': 90000, 'rate': 25, 'commissionAmountMode': 'billing',
            'status': '未列入薪資', 'note': PREFIX + 'POLICY-NOT-DECIDED'})
        report.check(name + ': historical commission and payroll remain exact', all(public(page)[key] == original[key] for key in ('dailyLogs', 'commissions', 'payroll', 'salaryPayments')))
        for method, args in (('deleteBilling', [IDS[0]]), ('deleteReceivableAccounting', [ARS[0]])):
            denied(page, report, name + '-' + method, method, *args)
        report.case(name)
    finally:
        context.close()


def run_invoice_lifecycle(browser, server, report, changed_tax=False):
    name = 'pending-invoice-effective-issue-and-no-double-tax' + ('-frozen-five-percent-after-setting-change' if changed_tax else '')
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        first = post(page, report, name + '-preinvoice', allowance_input())[0]
        if changed_tax:
            invoke(page, report, name, 'saveSystemSettings', {**public(page)['settings'], 'defaultTax': 10})
        projection = financial(page, report, name)
        original = public(page)
        values = {'invoiceType': 'output', 'sourceId': IDS[0], 'status': 'issued',
                  'invoiceNumber': PREFIX + 'ISSUED-AFTER-ALLOWANCE', 'invoiceDate': DATE,
                  'expectedFinancialSnapshot': projection['snapshot']}
        missing = dict(values)
        missing.pop('expectedFinancialSnapshot')
        denied(page, report, name + '-missing-snapshot', 'saveInvoice', missing)
        issued = invoke(page, report, name, 'saveInvoice', values)
        report.check(name + ': invoice issues only effective amounts', issued['netAmount'] == 90000 and issued['taxAmount'] == 4500 and issued['grossAmount'] == 94500, issued)
        after_issue = public(page)
        original_bill = next(row for row in original['billings'] if row['id'] == IDS[0])
        issued_bill = next(row for row in after_issue['billings'] if row['id'] == IDS[0])
        protected_fields = ('amount', 'preTaxAmount', 'tax', 'taxAmount', 'grossTotal', 'taxIncludedAmount', 'total', 'retention', 'retentionAmount', 'lines')
        report.check(name + ': invoice issuance preserves original billing money and rows', all(issued_bill[key] == original_bill[key] for key in protected_fields))
        report.check(name + ': issuance does not rewrite allowance history', ledger(after_issue) == ledger(original))
        fiscal = invoke(page, report, name, 'invoiceAllowanceRows')
        report.check(name + ': included preinvoice allowance is excluded from invoice tax adjustment rows', not any(row.get('eventId') == first['id'] for row in fiscal), fiscal)
        reverse_values = reversal_input(first['id'], invoice_id=issued['id'])
        plan = preview(page, report, name + '-included-reversal', reverse_values, allowed=False)
        denied(page, report, name + '-included-reversal', 'reverseBillingAllowance', first['id'], {**reverse_values, 'expectedSnapshot': plan.get('snapshot', '')})
        second_values = allowance_input(reductions={key: value // 10 for key, value in REDUCTIONS[0].items()}, key='POST-INVOICE')
        second_values['invoiceEvidence'] = [{'invoiceId': issued['id'], 'voucherReference': PREFIX + 'POST-ISSUE-VOUCHER', 'voucherDate': DATE, 'verified': True}]
        second = post(page, report, name + '-postinvoice', second_values)[0]
        fiscal = invoke(page, report, name, 'invoiceAllowanceRows')
        selected = [row for row in fiscal if row.get('eventId') in (first['id'], second['id'])]
        report.check(name + ': invoice accounting subtracts only subsequent voucher tax once', len(selected) == 1 and selected[0]['eventId'] == second['id'] and selected[0]['tax'] == -50 and selected[0]['grossTotal'] == -1050, selected)
        report.check(name + ': original issued invoice voucher is unchanged by subsequent posting', next(row for row in public(page)['invoices'] if row['id'] == issued['id']) == next(row for row in after_issue['invoices'] if row['id'] == issued['id']))
        report.case(name)
    finally:
        context.close()


def run_two_tabs(browser, server, report):
    name = 'two-real-tabs-compete-on-one-durable-source'
    context = browser.new_context(service_workers='block')
    try:
        first, _ = boot(context, server, report, name)
        second = open_page(context, server)
        second.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        invoke(second, report, name, 'load')
        request1, _ = prepared(first, report, name + '-tab1', allowance_input(key='TAB1'))
        request2, _ = prepared(second, report, name + '-tab2', allowance_input(key='TAB2'))
        before = raw(first)
        first.evaluate("r=>{window.__k30Pending=__k28Call({name:'postBillingAllowance',args:[r]});return true}", request1)
        second.evaluate("r=>{window.__k30Pending=__k28Call({name:'postBillingAllowance',args:[r]});return true}", request2)
        results = [first.evaluate('()=>__k30Pending'), second.evaluate('()=>__k30Pending')]
        report.check(name + ': exactly one actual tab commits', sum(item['ok'] for item in results) == 1, results)
        after = raw(first)
        report.check(name + ': shared durable ledger and audit increment exactly once', len(ledger(after['idb']['main'])) == 1 and after['idb']['main']['meta']['businessSnapshotRevision']['sequence'] == before['idb']['main']['meta']['businessSnapshotRevision']['sequence'] + 1 and len(after['idb']['main']['audit']) == len(before['idb']['main']['audit']) + 1)
        report.check(name + ': losing tab cannot overwrite the winning durable data', raw(second) == after)
        report.case(name)
    finally:
        context.close()


def run_malformed(browser, server, report):
    name = 'malformed-ledger-preserved-and-refused'
    context = browser.new_context(service_workers='block')
    try:
        restrict(context, server, report, name)
        page = open_page(context, server)
        seed = fixture('malformed-ledger')
        report.check(name + ': isolated malformed synthetic ledger seeded', page.evaluate('x=>__k28Seed(x)', seed))
        before = raw(page)
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        loaded = call(page, 'load')
        if loaded['ok']:
            plan = invoke(page, report, name, 'billingAllowancePreview', allowance_input())
            report.check(name + ': malformed ledger cannot be admitted', not plan['allowed'] and bool(plan['blockers']), plan)
            result = call(page, 'postBillingAllowance', {**allowance_input(), 'expectedSnapshot': plan.get('snapshot', '')})
            report.check(name + ': actual writer refuses malformed ledger', not result['ok'], result)
        report.check(name + ': malformed source is never normalized away or persisted', raw(page) == before and raw(page)['idb']['main']['meta']['billingAllowances'] == seed['meta']['billingAllowances'])
        report.case(name)
    finally:
        context.close()


def run_reopen(playwright, launch, server, report, profile):
    name = 'formal-ledger-survives-browser-close-and-reopen'
    context = playwright.chromium.launch_persistent_context(str(profile), **launch)
    try:
        page, _ = boot(context, server, report, name)
        event, after, _, _ = post(page, report, name, allowance_input())
        projection = financial(page, report, name)
    finally:
        context.close()
    context = playwright.chromium.launch_persistent_context(str(profile), **launch)
    try:
        restrict(context, server, report, name + '-reopened')
        page = open_page(context, server)
        report.check(name + ': durable layers survive process reopen before Store loading', raw(page) == after)
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        invoke(page, report, name, 'load')
        report.check(name + ': actual load preserves exact committed data and effective projection', raw(page) == after and public(page) == after['idb']['main'] and financial(page, report, name) == projection)
        invoke(page, report, name, 'saveCustomer', {'name': PREFIX + '合成客戶', 'note': PREFIX + 'ORDINARY-SAVE-AFTER-REOPEN'}, CUSTOMER)
        report.check(name + ': ordinary unrelated write preserves ledger and original financial sources', ledger(public(page)) == [event] and all(public(page)[key] == after['idb']['main'][key] for key in ('billings', 'receivables', 'invoices', 'receipts', 'retentionReceipts', 'commissions', 'salaryPayments', 'banks', 'bankTransactions')))
        report.case(name)
    finally:
        context.close()


def run_backup(browser, server, report):
    name = 'actual-settings-json-backup-and-fresh-profile-load'
    context = browser.new_context(service_workers='block', accept_downloads=True)
    try:
        page, _ = boot(context, server, report, name)
        event, after, _, _ = post(page, report, name, allowance_input())
        expected = financial(page, report, name)
        page.add_script_tag(url=server.origin + '/assets/js/settings.js')
        page.evaluate('()=>KusheSettings.activate()')
        before = raw(page)
        with page.expect_download() as download_info:
            page.locator('#settingsBackup').click()
        download = download_info.value
        destination = report.output / (PREFIX + 'SAFE-BACKUP.json')
        download.save_as(str(destination))
        backup = json.loads(destination.read_text(encoding='utf-8'))
        report.check(name + ': downloaded actual backup includes complete allowance ledger and original financial data', ledger(backup) == [event] and all(backup[key] == after['idb']['main'][key] for key in ('billings', 'receivables', 'invoices', 'receipts', 'retentionReceipts', 'commissions', 'payroll', 'salaryPayments', 'banks', 'bankTransactions')))
        report.check(name + ': export is read-only across every layer', raw(page) == before)
    finally:
        context.close()
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name + '-restore')
        committed = invoke(page, report, name, 'readCommittedSnapshot')
        loaded = call(page, 'replaceSnapshot', backup, {'confirmed': True, 'baseline': committed['baseline']})
        report.check(name + ': downloaded snapshot restores through actual Store replacement in a fresh owned profile', loaded['ok'], loaded)
        report.check(name + ': restored ledger, effective values and original financial rows are complete', ledger(public(page)) == [event] and financial(page, report, name)['effective'] == expected['effective'] and all(public(page)[key] == backup[key] for key in ('billings', 'receivables', 'invoices', 'receipts', 'retentionReceipts', 'salaryPayments', 'bankTransactions')))
        report.case(name)
    finally:
        context.close()


def run_restore_history_guard(browser, server, report):
    name = 'restore-cannot-erase-or-rewrite-established-allowance-history'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        before_post = invoke(page, report, name, 'readCommittedSnapshot')['data']
        post(page, report, name, allowance_input())
        for variant in ('older-backup', 'edited-event'):
            current = invoke(page, report, name, 'readCommittedSnapshot')
            replacement = deepcopy(before_post if variant == 'older-backup' else current['data'])
            if variant == 'edited-event':
                replacement['meta']['billingAllowances'][0]['reason'] = PREFIX + 'FORGED-CHANGE'
            denied(page, report, name + '-' + variant, 'replaceSnapshot', replacement, {'confirmed': True, 'baseline': current['baseline']})
        report.case(name)
    finally:
        context.close()


def run_no_invoice(browser, server, report):
    name = 'no-invoice-source-post-and-reverse-with-zero-tax'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        event = post(page, report, name, allowance_input(index=2))[0]
        projection = financial(page, report, name, 2)
        report.check(name + ': no-invoice effective money is exact without invented tax', projection['effective'] == dict(zip(FIELDS, (18000, 0, 18000, 1800, 16200))) and event['allocations'][0]['invoiceStage'] == 'no_invoice')
        report.check(name + ': no-invoice posting never enters invoice tax adjustment rows', not any(row['eventId'] == event['id'] for row in invoke(page, report, name, 'invoiceAllowanceRows')))
        request, _ = prepared(page, report, name + '-reverse', reversal_input(event['id']))
        before = raw(page)
        check_commit(report, name + '-reverse', page, before, call(page, 'reverseBillingAllowance', event['id'], request), 'reverse')
        report.check(name + ': reverse restores exact untaxed original', financial(page, report, name, 2)['effective'] == ORIGINALS[2])
        report.case(name)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--store', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    parser.add_argument('--only', choices=('positive', 'negative', 'lifecycle', 'authority', 'rollback', 'durability'))
    args = parser.parse_args()
    root = args.root.resolve()
    store = (args.store or root / 'assets/js/erp-store.js').read_bytes()
    report = Report(args.output.resolve())
    report.data['headCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    report.data['source'] = {'sha256': hashlib.sha256(store).hexdigest(), 'bytes': len(store)}
    report.data['supportSources'] = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in ('assets/js/settings.js',)}
    def execute(function, *arguments):
        try:
            function(*arguments)
        except Exception as error:
            report.data['failures'].append({'case': function.__name__, 'arguments': [str(x) for x in arguments[3:] if isinstance(x, (str, bool))], 'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
            report.flush()
            traceback.print_exc()
    try:
        server = Server(store, root, extra=['assets/js/settings.js'])
        server.resources['/fixture.html'] = (HTML.encode('utf-8'), 'text/html; charset=utf-8')
        with tempfile.TemporaryDirectory(prefix='KUSHE_K30_SYN_ONLY_') as temp, server, sync_playwright() as playwright:
            executable = select_browser(args.browser)
            launch = {'headless': True, 'service_workers': 'block'}
            if executable:
                launch['executable_path'] = executable
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            browser = playwright.chromium.launch(**{key: value for key, value in launch.items() if key != 'service_workers'})
            try:
                if args.only in (None, 'positive'):
                    for kind, group, zero in (('standard', False, False), ('issued', False, False), ('legacy-received', False, False), ('standard', True, False), ('standard', True, True)):
                        execute(run_positive, browser, server, report, kind, group, zero)
                    for issued, received, later in ((False, False, False), (True, False, False), (False, True, False), (False, False, True)):
                        execute(run_reversal, browser, server, report, issued, received, later)
                    execute(run_no_invoice, browser, server, report)
                if args.only in (None, 'negative'):
                    for case in ('linked-commission', 'duplicate-ar', 'conflicting-alias', 'tax-rate-changed', 'approved-total', 'gross-equation', 'receivable-equation', 'pending-tax-equation', 'negative-reduction', 'fractional-reduction', 'duplicate-source', 'missing-source', 'wrong-source', 'over-already-received', 'retention-already-received', 'invoice-no-voucher', 'invoice-wrong-id', 'invoice-unverified', 'group-incomplete', 'single-inside-group'):
                        execute(run_invalid, browser, server, report, case)
                    for key in ('expectedSnapshot', 'idempotencyKey', 'confirmed'):
                        execute(run_missing_submit_guard, browser, server, report, key)
                    for change in ('receipt', 'retention', 'cheque', 'invoice', 'allowance', 'tax-setting'):
                        execute(run_stale, browser, server, report, change)
                    execute(run_idempotency_conflict, browser, server, report)
                    execute(run_missing_reversal_id, browser, server, report)
                    execute(run_malformed, browser, server, report)
                if args.only in (None, 'authority'):
                    for case in ('cloud-capability', 'cloud-hook-absent', 'owner-role', 'wrong-company-user'):
                        execute(run_invalid, browser, server, report, case)
                    for field in ('role', 'principal', 'epoch', 'cloud'):
                        execute(run_late_auth, browser, server, report, field)
                if args.only in (None, 'rollback'):
                    for reversal in (False, True):
                        for target in ('primary', EMERGENCY, STORE_TOKEN, RECEIPT_TOKEN):
                            execute(run_rollback, browser, server, report, target, reversal)
                if args.only in (None, 'lifecycle'):
                    for function in (run_receipts, run_retention, run_cheques, run_commission_gate, run_invoice_lifecycle):
                        execute(function, browser, server, report)
                    execute(run_invoice_lifecycle, browser, server, report, True)
                if args.only in (None, 'durability'):
                    execute(run_two_tabs, browser, server, report)
                    execute(run_backup, browser, server, report)
                    execute(run_restore_history_guard, browser, server, report)
            finally:
                browser.close()
            if args.only in (None, 'durability'):
                execute(run_reopen, playwright, launch, server, report, Path(temp) / 'durable-profile')
        report.check('all actual browser requests stayed inside exact owned loopback allowlist', not report.data['externalRequests'], report.data['externalRequests'])
        report.check('no unhandled browser page errors', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'BLOCKED' if report.data['failures'] or any(not row['passed'] for row in report.data['checks']) else 'K30_ISOLATED_STORE_PASS'
        return 0 if report.data['status'] == 'K30_ISOLATED_STORE_PASS' else 1
    except Exception as error:
        report.data['status'] = 'BLOCKED'
        report.data['failures'].append({'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
        traceback.print_exc()
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data[key] for key in ('status', 'passCount', 'failCount', 'source', 'failures')}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
