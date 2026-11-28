#!/usr/bin/env python3
"""New-policy guards on the already bootstrapped disposable PostgreSQL database.

Run only after postgres_guard.py succeeds. This file creates no cluster roles,
tables, schemas or hosted resources. JWT claims are local SQL fixtures.
"""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import traceback
from urllib.parse import urlparse
import uuid

import psycopg
from psycopg.types.json import Jsonb

CAP = 'billing-allowances-v2'
POLICY = 'discounted-pretax-v1'
PREFIX = 'SYN-K30-POLICY-PG-'
DATE = '2026-11-28'
STAMP = DATE + 'T08:00:00.000Z'
PROJECT, CUSTOMER, BILL = [PREFIX + key for key in ('PROJECT', 'CUSTOMER', 'BILL')]
EMPLOYEES = [PREFIX + 'EMPLOYEE-A', PREFIX + 'EMPLOYEE-B']
OLD_EMPLOYEE, OLD_LOG, OLD_COMMISSION = [PREFIX + key for key in ('OLD-EMPLOYEE', 'OLD-LOG', 'OLD-COMMISSION')]
GROUP, OLD_GROUP = PREFIX + 'GROUP', PREFIX + 'OLD-GROUP'
AGREEMENT = PREFIX + 'AGREEMENT'
REPORT = {'schema': 'k30-policy-postgres-v1', 'status': 'RUNNING',
          'productionDataTouched': False, 'realPostgreSQL': True,
          'realSupabaseAuth': False, 'hostedDatabaseTest': False,
          'bootstrapsCluster': False, 'payloadSource': 'synthetic-contract-builders',
          'checks': [], 'cases': [], 'failures': []}
URL = ''


def check(name, value):
    REPORT['checks'].append({'name': name, 'passed': bool(value)})
    if not value:
        raise AssertionError(name)


def connection(owner=None):
    conn = psycopg.connect(URL, autocommit=True, connect_timeout=10)
    if owner:
        conn.execute('set role authenticated')
        conn.execute("select set_config('request.jwt.claims',%s,false)",
                     (json.dumps({'sub': owner, 'aal': 'aal2', 'role': 'authenticated'}),))
    return conn


def rpc(owner, version, data, protocol=3, capability=CAP):
    with connection(owner) as conn:
        if protocol == 2:
            return conn.execute('select * from public.erp_state_cas_write_v2(%s,%s,%s)',
                                (version, Jsonb(data), 'trusted')).fetchone()
        return conn.execute('select * from public.erp_state_cas_write_v3(%s,%s,%s,%s)',
                            (version, Jsonb(data), 'trusted', capability)).fetchone()


def stored(owner):
    with connection() as conn:
        return conn.execute('select data,sync_version,updated_at,last_writer_mode,last_base_sync_version '
                            'from public.erp_states where user_id=%s', (owner,)).fetchone()


def applied(label, owner, version, data):
    answer = rpc(owner, version, data)
    check(label + ': actual v3 CAS applies', answer[0] == 'APPLIED')
    check(label + ': exact submitted snapshot persists', stored(owner)[0] == data)
    return stored(owner)[1]


def refused(label, owner, operation, code=None):
    before = stored(owner)
    try:
        operation()
    except psycopg.Error as error:
        check(label + ': rejected by the database', code is None or code in str(error))
    else:
        raise AssertionError(label + ': unexpectedly accepted')
    check(label + ': durable JSON and server revision are unchanged', stored(owner) == before)


def people():
    return [{'employeeId': employee, 'rate': rate, 'agreedDueDate': DATE,
             'paymentTerms': PREFIX + 'AGREED-DATE-INDEPENDENT-OF-CUSTOMER-CASH'}
            for employee, rate in zip(EMPLOYEES, (30, 20))]


def fixture():
    old_item = {'workItemId': PREFIX + 'OLD-ITEM', 'qty': 1, 'inputPrice': 40000,
                'untaxedSubtotal': 40000, 'taxMode': '未稅', 'billingId': '', 'billingStatus': '未請款'}
    old_log = {'id': OLD_LOG, 'groupId': OLD_GROUP, 'employee': OLD_EMPLOYEE,
               'project': PROJECT, 'customer': CUSTOMER, 'date': '2026-11-27',
               'rate': 25, 'commission': 8888, 'commissionEnabled': True,
               'items': [old_item]}
    old_commission = {'id': OLD_COMMISSION, 'date': old_log['date'], 'employee': OLD_EMPLOYEE,
                      'project': PROJECT, 'sourceType': 'daily-log', 'sourceId': OLD_LOG,
                      'untaxedAmount': 40000, 'rate': 25, 'commission': 8888,
                      'status': '已列入薪資', 'note': PREFIX + 'IMMUTABLE-OLD-AGREED-AMOUNT'}
    return {'meta': {'k30Synthetic': True, 'k30PolicySynthetic': True}, 'settings': {'defaultTax': 5},
            'audit': [], 'employees': [{'id': e} for e in [*EMPLOYEES, OLD_EMPLOYEE]],
            'projects': [{'id': PROJECT, 'customer': CUSTOMER}], 'customers': [{'id': CUSTOMER}],
            'dailyLogs': [old_log], 'commissions': [old_commission], 'payroll': [],
            'billings': [], 'receivables': [], 'invoices': [], 'receipts': [],
            'retentionReceipts': [], 'salaryPayments': [{'id': PREFIX + 'OLD-SALARY', 'amount': 4444}],
            'commissionSettlements': [], 'banks': [{'id': PREFIX + 'BANK', 'balance': 500000}],
            'bankTransactions': [{'id': PREFIX + 'OLD-BANK', 'amount': 4444}]}


def seed(label):
    owner = str(uuid.uuid4())
    data = fixture()
    check(label + ': fresh local principal seeds through unchanged v2',
          rpc(owner, None, data, protocol=2)[0] == 'APPLIED')
    return owner, data, stored(owner)[1]


def agreement(owner, kind='daily', key='ONE'):
    identifier = AGREEMENT + '-' + key
    scope = 'daily:' + GROUP if kind == 'daily' else 'manual:' + identifier
    row = {'schema': 'kushe.commission.agreement.v1', 'id': identifier, 'policy': POLICY,
           'kind': kind, 'scopeKey': scope, 'groupId': GROUP if kind == 'daily' else '',
           'projectId': PROJECT, 'customerId': CUSTOMER, 'workDate': DATE,
           'workScope': PREFIX + 'NEW-AGREED-WORK-' + key, 'agreedDate': DATE,
           'startDate': DATE, 'reference': PREFIX + 'AGREEMENT-REFERENCE-' + key,
           'originalUntaxedAmount': 60000, 'billingIds': [], 'participants': people(),
           'futureNewAgreementConfirmed': True, 'companyId': PREFIX + 'COMPANY',
           'createdBy': owner, 'createdAt': STAMP}
    if kind == 'manual':
        row['manualSourceIdentity'] = json.dumps([PROJECT, DATE, row['workScope'].lower()],
                                               ensure_ascii=False, separators=(',', ':'))
    return row


def adopt(data, owner, kind='daily'):
    value = deepcopy(data)
    ag = agreement(owner, kind)
    value['meta']['commissionAgreements'] = [ag]
    if kind == 'daily':
        item = {'workItemId': PREFIX + 'ITEM', 'qty': 1, 'inputPrice': 60000,
                'untaxedSubtotal': 60000, 'taxMode': '未稅', 'billingId': '', 'billingStatus': '未請款'}
        for person in ag['participants']:
            value['dailyLogs'].append({'id': PREFIX + 'LOG-' + person['employeeId'],
                'groupId': GROUP, 'employee': person['employeeId'], 'project': PROJECT,
                'customer': CUSTOMER, 'date': DATE, 'rate': person['rate'],
                'commission': 0, 'commissionEnabled': True,
                'estimatedCommission': 60000 * person['rate'] // 100,
                'commissionAgreementId': ag['id'], 'commissionPolicy': POLICY,
                'items': [deepcopy(item)]})
    return value, ag


def link_billing(data):
    value = deepcopy(data)
    refs = [{'sourceType': 'daily-log', 'sourceGroupKey': group, 'workItemId': item}
            for group, item in ((GROUP, PREFIX + 'ITEM'), (OLD_GROUP, PREFIX + 'OLD-ITEM'))]
    bill = {'id': BILL, 'date': DATE, 'number': BILL + '-NO', 'customer': CUSTOMER,
            'project': PROJECT, 'receivableId': BILL + '-AR', 'sourceType': 'daily-work',
            'sourceItemRefs': refs, 'sourceContractRefs': [], 'taxMode': '未稅',
            'amount': 100000, 'preTaxAmount': 100000, 'tax': 0, 'taxAmount': 0,
            'grossTotal': 100000, 'taxIncludedAmount': 100000,
            'retention': 12000, 'retentionAmount': 12000, 'retentionRate': 0,
            'retentionBase': 'preTax', 'retentionMode': 'custom', 'retentionEnabled': True,
            'total': 88000, 'invoiceStatus': 'no_invoice', 'invoiceNo': '',
            'lines': [{'id': PREFIX + 'LINE-' + str(i), 'amount': amount, 'sourceRefs': [ref]}
                      for i, (amount, ref) in enumerate(zip((60000, 40000), refs))]}
    ar = {'id': bill['receivableId'], 'billingId': BILL, 'sourceNo': bill['number'],
          'date': DATE, 'customer': CUSTOMER, 'project': PROJECT,
          'amount': 88000, 'retention': 12000, 'retentionAmount': 12000,
          'received': 0, 'legacyReceived': 0, 'retentionReceived': 0,
          'legacyRetentionReceived': 0, 'receivableCheques': []}
    value['billings'].append(bill)
    value['receivables'].append(ar)
    for log in value['dailyLogs']:
        for item in log['items']:
            item.update(billingId=BILL, billingStatus='已請款', billingNo=bill['number'])
        log.update(billingId=BILL, billingStatus='已請款', billingNo=bill['number'])
    return value


def post_allowance(data, owner, with_terms=True):
    value = deepcopy(data)
    event = {'schema': 'kushe.billing.allowances.v1', 'id': PREFIX + 'ALLOWANCE',
             'eventType': 'post', 'reverseOf': '', 'scope': 'billing', 'billingId': BILL,
             'externalDocumentId': '', 'externalDocumentRevision': 0, 'sourceBillingIds': [BILL],
             'date': DATE, 'reason': PREFIX + 'NEGOTIATED-DISCOUNT', 'reference': PREFIX + 'DISCOUNT-APPROVAL',
             'approvedGrossReduction': 10000,
             'allocations': [{'billingId': BILL, 'receivableId': BILL + '-AR',
                 'customerId': CUSTOMER, 'projectId': PROJECT, 'billingNo': BILL + '-NO',
                 'original': {'untaxed': 100000, 'tax': 0, 'grossTotal': 100000,
                              'retention': 12000, 'receivable': 88000},
                 'reductions': {'untaxed': 10000, 'tax': 0, 'grossTotal': 10000,
                                'retention': 1200, 'receivable': 8800},
                 'invoiceStage': 'no_invoice', 'invoiceId': '', 'invoiceOriginal': None, 'taxBasis': None}],
             'invoiceEvidence': [], 'idempotencyKey': PREFIX + 'ALLOWANCE-KEY',
             'intentFingerprint': PREFIX + 'ALLOWANCE-INTENT', 'sourceSnapshot': PREFIX + 'ALLOWANCE-SOURCE',
             'companyId': PREFIX + 'COMPANY', 'createdBy': owner, 'createdAt': STAMP}
    if with_terms:
        original = next(row for row in value['commissions'] if row['id'] == OLD_COMMISSION)
        term = {'schema': 'kushe.commission.payment-terms.v1', 'id': PREFIX + 'OLD-TERMS',
                'commissionId': OLD_COMMISSION, 'mode': 'agreed-date', 'agreedDueDate': DATE,
                'reference': PREFIX + 'EXPLICIT-OLD-TERMS', 'commissionSnapshot': deepcopy(original),
                'allowanceEventId': event['id'], 'companyId': PREFIX + 'COMPANY',
                'createdBy': owner, 'createdAt': STAMP}
        value['meta']['commissionPaymentTerms'] = [term]
        event['commissionPaymentTermIds'] = [term['id']]
    value['meta'].setdefault('billingAllowances', []).append(event)
    return value


def log_content(log):
    result = deepcopy(log)
    for key in ('billingId', 'billingIds', 'billingNo', 'billingStatus', 'updatedAt'):
        result.pop(key, None)
    for item in result['items']:
        for key in ('billingId', 'billingNo', 'billingStatus'):
            item.pop(key, None)
    return result


def finalization(data, owner, base=54000, billed=True):
    value = deepcopy(data)
    ag = value['meta']['commissionAgreements'][0]
    event_id = PREFIX + 'FINAL'
    allocations = [{'billingId': BILL if billed else '', 'scopeKey': ag['scopeKey'],
                    'untaxedAmount': base,
                    'approvalReference': '' if billed else PREFIX + 'UNBILLED-FINAL-NET'}]
    if billed:
        allocations.append({'billingId': BILL, 'scopeKey': 'daily:' + OLD_GROUP,
                            'untaxedAmount': 90000 - base, 'approvalReference': ''})
    participants, rows = [], []
    for person in ag['participants']:
        participant = {**deepcopy(person), 'commission': (base * person['rate'] + 50) // 100,
                       'commissionId': event_id + '-' + person['employeeId']}
        participants.append(participant)
        rows.append({'id': participant['commissionId'], 'date': ag['workDate'],
            'employee': person['employeeId'], 'employeeName': person['employeeId'],
            'customer': CUSTOMER, 'project': PROJECT, 'projectName': PROJECT,
            'sourceNo': ag['reference'], 'sourceType': 'commission-finalization',
            'sourceId': event_id + ':' + ag['id'], 'untaxedAmount': base, 'commissionBaseAmount': base,
            'commissionBasis': 'preTax', 'rate': person['rate'], 'commission': participant['commission'],
            'status': '已列入薪資', 'commissionPolicy': POLICY, 'commissionAgreementId': ag['id'],
            'commissionFinalizationId': event_id,
            'paymentTerms': {'mode': 'agreed-date', 'dueDate': person['agreedDueDate'],
                             'terms': person['paymentTerms'], 'reference': ag['reference']},
            'billingIds': [BILL] if billed else [], 'note': PREFIX + 'FINAL-APPROVAL',
            'createdAt': STAMP, 'updatedAt': STAMP})
    snapshots = []
    if billed:
        bill = value['billings'][0]
        keep = ('id', 'date', 'number', 'customer', 'project', 'taxMode', 'lines', 'amount',
                'preTaxAmount', 'tax', 'taxAmount', 'grossTotal', 'taxIncludedAmount', 'total',
                'retention', 'retentionAmount', 'retentionRate', 'retentionBase', 'retentionMode',
                'sourceType', 'sourceItemRefs', 'sourceContractRefs', 'receivableId')
        snapshots = [{'billingId': BILL, 'originalUntaxed': 100000, 'effectiveUntaxed': 90000,
                      'allowanceHistoryLength': len(value['meta']['billingAllowances']),
                      'allowanceIds': [PREFIX + 'ALLOWANCE'],
                      'sourceScopes': [{'scopeKey': 'daily:' + GROUP, 'originalUntaxed': 60000},
                                       {'scopeKey': 'daily:' + OLD_GROUP, 'originalUntaxed': 40000}],
                      'originalSource': {key: deepcopy(bill[key]) for key in keep if key in bill}}]
    event = {'schema': 'kushe.commission.finalization.v1', 'id': event_id, 'eventType': 'finalize',
             'agreementIds': [ag['id']], 'date': DATE, 'reference': PREFIX + 'FINAL-REFERENCE',
             'reason': PREFIX + 'FINAL-APPROVAL', 'allocations': allocations,
             'billingSnapshots': snapshots,
             'sourceSnapshots': [{'dailyLogId': log['id'], 'content': log_content(log)}
                                 for log in value['dailyLogs'] if log.get('commissionAgreementId') == ag['id']],
             'results': [{'agreementId': ag['id'], 'scopeKey': ag['scopeKey'], 'base': base,
                          'participants': participants}], 'commissionRows': rows,
             'idempotencyKey': PREFIX + 'FINAL-KEY', 'intentFingerprint': PREFIX + 'FINAL-INTENT',
             'sourceSnapshot': PREFIX + 'FINAL-SOURCE', 'companyId': PREFIX + 'COMPANY',
             'createdBy': owner, 'createdAt': STAMP}
    value['meta'].setdefault('commissionFinalizations', []).append(event)
    value['commissions'].extend(deepcopy(rows))
    return value


def set_final_base(value, base):
    """Keep a negative payload internally coherent so only its source cap fails."""
    event = value['meta']['commissionFinalizations'][0]
    event['results'][0]['base'] = base
    for person in event['results'][0]['participants']:
        amount = (base * person['rate'] + 50) // 100
        person['commission'] = amount
        for rows in (event['commissionRows'], value['commissions']):
            row = next(row for row in rows if row['id'] == person['commissionId'])
            row.update(untaxedAmount=base, commissionBaseAmount=base, commission=amount)


def manual_and_fence():
    owner, baseline, version = seed('manual')
    state, ag = adopt(baseline, owner, 'manual')
    version = applied('manual new agreement', owner, version, state)
    for protocol, capability in ((2, CAP), (3, 'billing-allowances-v1')):
        refused('old client cannot touch policy records', owner,
                lambda: rpc(owner, version, state, protocol, capability), 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED')
    final = finalization(state, owner, billed=False)
    version = applied('approved unbilled finalization', owner, version, final)
    check('new formal rows preserve every historical commission and payment',
          final['commissions'][0] == baseline['commissions'][0]
          and final['salaryPayments'] == baseline['salaryPayments']
          and final['bankTransactions'] == baseline['bankTransactions'])
    for variant in ('erase-history', 'rewrite-rate', 'rewrite-earned-row', 'duplicate-identity'):
        bad = deepcopy(final)
        if variant == 'erase-history':
            bad['meta']['commissionFinalizations'] = []
        elif variant == 'rewrite-rate':
            bad['meta']['commissionAgreements'][0]['participants'][0]['rate'] = 31
        elif variant == 'rewrite-earned-row':
            bad['commissions'][-1]['commission'] += 1
        else:
            duplicate = deepcopy(ag)
            duplicate.update(id=ag['id'] + '-DUPLICATE', scopeKey='manual:' + ag['id'] + '-DUPLICATE',
                             reference=PREFIX + 'OTHER-REFERENCE')
            bad['meta']['commissionAgreements'].append(duplicate)
        refused('manual ' + variant, owner, lambda: rpc(owner, version, bad))


def mixed_matrix(coalesced=False):
    owner, baseline, version = seed('matrix')
    adopted, _ = adopt(baseline, owner)
    version = applied('daily agreement and estimated sources', owner, version, adopted)
    linked = link_billing(adopted)
    version = applied('normal later billing links', owner, version, linked)
    missing_terms = post_allowance(linked, owner, False)
    refused('affected legacy commission cannot use an implicit payment rule', owner,
            lambda: rpc(owner, version, missing_terms), 'COMMISSION_PAYMENT_TERMS_REQUIRED')
    posted = post_allowance(linked, owner)
    if not coalesced:
        version = applied('discount with explicit legacy terms', owner, version, posted)
    final = finalization(posted, owner)
    for variant in ('missing-legacy-scope', 'inflate-new-scope', 'changed-old-amount', 'incorrect-new-rate',
                    'rewrite-first-work-anchor'):
        bad = deepcopy(final)
        event = bad['meta']['commissionFinalizations'][0]
        if variant == 'missing-legacy-scope':
            event['allocations'].pop()
        elif variant == 'inflate-new-scope':
            event['allocations'][0]['untaxedAmount'] = 72000
            event['allocations'][1]['untaxedAmount'] = 18000
            set_final_base(bad, 72000)
        elif variant == 'changed-old-amount':
            bad['commissions'][0]['commission'] += 1
        elif variant == 'rewrite-first-work-anchor':
            for source in event['sourceSnapshots']:
                row = next(row for row in bad['dailyLogs'] if row['id'] == source['dailyLogId'])
                row['note'] = PREFIX + 'FORGED-ORIGINAL-WORK'
                source['content'] = log_content(row)
        else:
            event['results'][0]['participants'][0]['commission'] += 1
        refused('matrix ' + variant, owner, lambda: rpc(owner, version, bad))
    version = applied('coalesced discount and finalization' if coalesced else 'full mixed-source matrix',
                      owner, version, final)
    check('manual matrix assigns the new work only 54000 of whole discounted bill 90000',
          [p['commission'] for p in final['meta']['commissionFinalizations'][0]['results'][0]['participants']]
          == [16200, 10800])
    check('legacy amount stays 8888 rather than being recalculated', stored(owner)[0]['commissions'][0]['commission'] == 8888)
    unchanged = deepcopy(final)
    unchanged['settings']['syntheticOrdinarySetting'] = 'separate normal writer'
    applied('ordinary capable writer with immutable policy history', owner, version, unchanged)


def prospective_unbilled_then_invoice(coalesced=False):
    owner, baseline, version = seed('unbilled')
    state, _ = adopt(baseline, owner)
    version = applied('independent unbilled daily agreement', owner, version, state)
    final = finalization(state, owner, billed=False)
    if not coalesced:
        version = applied('independent unbilled wage approval', owner, version, final)
    linked = link_billing(final)
    version = applied('unbilled wage approval and immediate invoice in one CAS' if coalesced
                      else 'later invoice preserves finalized source content', owner, version, linked)
    posted = post_allowance(linked, owner)
    version = applied('later discount preserves finalized wages', owner, version, posted)
    reversed_state = deepcopy(posted)
    reverse = deepcopy(posted['meta']['billingAllowances'][0])
    reverse.update(id=PREFIX + 'ALLOWANCE-REVERSE', eventType='reverse', reverseOf=PREFIX + 'ALLOWANCE',
                   idempotencyKey=PREFIX + 'REVERSE-KEY', intentFingerprint=PREFIX + 'REVERSE-INTENT')
    reversed_state['meta']['billingAllowances'].append(reverse)
    applied('later reversal preserves explicit old payment terms and finalized wages', owner, version, reversed_state)
    check('later customer accounting leaves formal and old commission snapshots exact',
          reversed_state['commissions'] == final['commissions']
          and reversed_state['meta']['commissionFinalizations'] == final['meta']['commissionFinalizations']
          and reversed_state['meta']['commissionPaymentTerms'] == posted['meta']['commissionPaymentTerms'])


def fractional_unbilled_ceiling():
    owner, baseline, version = seed('fractional')
    state, ag = adopt(baseline, owner)
    ag['originalUntaxedAmount'] = 101
    for log in state['dailyLogs']:
        if log.get('commissionAgreementId') != ag['id']:
            continue
        first = log['items'][0]
        first.update(inputPrice=50.6, untaxedSubtotal=50.6)
        second = deepcopy(first)
        second.update(workItemId=PREFIX + 'UNBILLED-FRACTION', inputPrice=50.2, untaxedSubtotal=50.2)
        log['items'].append(second)
        log['estimatedCommission'] = 30 if log['rate'] == 30 else 20
    version = applied('fractional daily agreement preserves original item amounts', owner, version, state)
    linked = link_billing(state)
    bill = linked['billings'][0]
    bill['sourceItemRefs'] = bill['sourceItemRefs'][:1]
    bill['lines'] = bill['lines'][:1]
    bill['lines'][0]['amount'] = 51
    bill.update(amount=51, preTaxAmount=51, grossTotal=51, taxIncludedAmount=51,
                total=51, retention=0, retentionAmount=0, retentionEnabled=False)
    linked['receivables'][0].update(amount=51, retention=0, retentionAmount=0)
    for log, original_log in zip(linked['dailyLogs'], state['dailyLogs']):
        if log.get('commissionAgreementId') == ag['id']:
            log['items'][1] = deepcopy(original_log['items'][1])
        else:
            log.clear()
            log.update(deepcopy(original_log))
    version = applied('only the 50.6 item is billed at rounded 51', owner, version, linked)
    final = finalization(linked, owner, base=101, billed=False)
    event = final['meta']['commissionFinalizations'][0]
    event['allocations'] = [
        {'billingId': BILL, 'scopeKey': ag['scopeKey'], 'untaxedAmount': 51, 'approvalReference': ''},
        {'billingId': '', 'scopeKey': ag['scopeKey'], 'untaxedAmount': 50,
         'approvalReference': PREFIX + 'UNBILLED-50-OF-50.2'}]
    keep = ('id', 'date', 'number', 'customer', 'project', 'taxMode', 'lines', 'amount',
            'preTaxAmount', 'tax', 'taxAmount', 'grossTotal', 'taxIncludedAmount', 'total',
            'retention', 'retentionAmount', 'retentionRate', 'retentionBase', 'retentionMode',
            'sourceType', 'sourceItemRefs', 'sourceContractRefs', 'receivableId')
    event['billingSnapshots'] = [{'billingId': BILL, 'originalUntaxed': 51, 'effectiveUntaxed': 51,
        'allowanceHistoryLength': 0, 'allowanceIds': [],
        'sourceScopes': [{'scopeKey': ag['scopeKey'], 'originalUntaxed': 51}],
        'originalSource': {key: deepcopy(bill[key]) for key in keep if key in bill}}]
    for row in event['commissionRows']:
        row['billingIds'] = [BILL]
        next(item for item in final['commissions'] if item['id'] == row['id'])['billingIds'] = [BILL]
    too_large = deepcopy(final)
    too_large['meta']['commissionFinalizations'][0]['allocations'][1]['untaxedAmount'] = 51
    set_final_base(too_large, 102)
    refused('unbilled 50.2 source cannot be approved as 51', owner,
            lambda: rpc(owner, version, too_large), 'COMMISSION_UNBILLED_BASE_INVALID')
    applied('billed rounding never reduces the independent unbilled ceiling from 50 to 49',
            owner, version, final)


def no_retrofit():
    owner, baseline, version = seed('retrofit')
    bad = deepcopy(baseline)
    ag = agreement(owner)
    ag.update(groupId=OLD_GROUP, scopeKey='daily:' + OLD_GROUP,
              originalUntaxedAmount=40000,
              participants=[{**people()[0], 'employeeId': OLD_EMPLOYEE, 'rate': 50}])
    bad['meta']['commissionAgreements'] = [ag]
    log = bad['dailyLogs'][0]
    log.update(date=DATE, rate=50, commission=0, commissionAgreementId=ag['id'],
               commissionPolicy=POLICY, estimatedCommission=20000)
    refused('coherent retagging of an existing daily ID is still forbidden', owner,
            lambda: rpc(owner, version, bad), 'COMMISSION_AGREEMENT_RETROFIT_FORBIDDEN')


def main():
    global URL
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    URL = os.environ.get('K30_POSTGRES_URL', '')
    parsed = urlparse(URL)
    if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path != '/k30_synthetic':
        raise RuntimeError('Only existing loopback /k30_synthetic is allowed')
    if os.environ.get('SUPABASE_ACCESS_TOKEN'):
        raise RuntimeError('Hosted credentials must not be present')
    try:
        owner = str(uuid.uuid4())
        with connection(owner) as conn:
            capability = conn.execute('select public.erp_billing_allowance_capability()').fetchone()[0]
        check('already installed guard declares version2 and matching capability',
              capability['capability'] == CAP and capability['guardVersion'] == 2)
        for name, function in (
            ('manual unbilled finalization and history fence', manual_and_fence),
            ('complete mixed daily and legacy matrix', mixed_matrix),
            ('coalesced local discount and finalization', lambda: mixed_matrix(True)),
            ('approved unbilled source then invoice discount and reversal', prospective_unbilled_then_invoice),
            ('unbilled finalization and immediate invoice in the same CAS', lambda: prospective_unbilled_then_invoice(True)),
            ('fractional billed and unbilled sources retain independent rounding', fractional_unbilled_ceiling),
            ('historical daily ID cannot be opted into new policy', no_retrofit),
        ):
            try:
                function()
                REPORT['cases'].append({'name': name, 'passed': True})
            except Exception as error:
                REPORT['cases'].append({'name': name, 'passed': False})
                REPORT['failures'].append({'case': name, 'message': str(error), 'traceback': traceback.format_exc()})
            print(json.dumps(REPORT['cases'][-1]), flush=True)
        REPORT['status'] = 'PASS' if not REPORT['failures'] else 'FAIL'
    except Exception as error:
        REPORT['status'] = 'BLOCKED'
        REPORT['failures'].append({'message': str(error), 'traceback': traceback.format_exc()})
    finally:
        REPORT['passCount'] = sum(row['passed'] for row in REPORT['checks'])
        REPORT['failCount'] = sum(not row['passed'] for row in REPORT['checks'])
        (args.output / 'RESULT.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(REPORT, ensure_ascii=False, indent=2), flush=True)
    return 0 if REPORT['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
