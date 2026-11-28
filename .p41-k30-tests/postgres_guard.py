#!/usr/bin/env python3
"""Actual disposable PostgreSQL/RLS/CAS tests. No hosted database or Auth login.

JWT claims are synthetic SQL session fixtures, not an authentication test.
Only a loopback database named k30_synthetic is accepted.
"""
import argparse
import concurrent.futures
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import threading
import traceback
from urllib.parse import urlparse
import uuid

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
CAP = 'billing-allowances-v1'
SCHEMA = 'kushe.billing.allowances.v1'
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
url = os.environ.get('K30_POSTGRES_URL', '')
parsed = urlparse(url)
if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path != '/k30_synthetic':
    raise RuntimeError('Only loopback /k30_synthetic may be used')
if os.environ.get('SUPABASE_ACCESS_TOKEN'):
    raise RuntimeError('Hosted credentials must not be present')
report = {'schema': 'k30-real-postgres-guard-v1', 'status': 'RUNNING',
          'productionDataTouched': False, 'hostedDatabaseTest': False,
          'realPostgreSQL': True, 'realSupabaseAuth': False,
          'checks': [], 'cases': [], 'failures': []}


def check(label, value):
    report['checks'].append({'name': label, 'passed': bool(value)})
    if not value:
        raise AssertionError(label)


def connection(role=None, owner=None, aal='aal2'):
    conn = psycopg.connect(url, autocommit=True, connect_timeout=10)
    if role:
        if role not in ('authenticated', 'anon'):
            raise ValueError(role)
        conn.execute('set role ' + role)
        conn.execute("select set_config('request.jwt.claims',%s,false)",
                     (json.dumps({'sub': owner, 'aal': aal, 'role': role}),))
    return conn


def fixture(owner, issued=False):
    billing = {'id': 'SYN-K30-PG-BILL', 'receivableId': 'SYN-K30-PG-AR',
               'number': 'SYN-K30-PG-NUMBER', 'date': '2026-11-10',
               'customer': 'SYN-K30-PG-CUSTOMER', 'project': 'SYN-K30-PG-PROJECT',
               'amount': 200000, 'preTaxAmount': 200000, 'tax': 10000, 'taxAmount': 10000,
               'grossTotal': 210000, 'taxIncludedAmount': 210000,
               'retention': 12000, 'retentionAmount': 12000, 'total': 198000,
               'invoiceStatus': 'invoice_pending', 'invoiceNo': '', 'taxMode': '未稅',
               'lines': [{'id': 'SYN-K30-PG-LINE', 'amount': 200000}]}
    ar = {'id': billing['receivableId'], 'billingId': billing['id'],
          'sourceNo': billing['number'], 'customer': billing['customer'], 'project': billing['project'],
          'amount': 198000, 'retention': 12000, 'retentionAmount': 12000,
          'legacyReceived': 10000, 'received': 50000, 'legacyRetentionReceived': 1000,
          'retentionReceived': 2000, 'receivableCheques': [],
          'invoiceStatus': 'invoice_pending', 'invoiceNo': '', 'invoiceDate': ''}
    invoice = {'id': 'SYN-K30-PG-INVOICE', 'invoiceId': 'SYN-K30-PG-INVOICE',
               'invoiceType': 'output', 'type': '銷項', 'sourceType': 'billing',
               'sourceId': billing['id'], 'billingId': billing['id'],
               'sourceNo': billing['number'], 'customerId': billing['customer'], 'projectId': billing['project'],
               'status': 'pending', 'invoiceNumber': '', 'number': '', 'invoiceDate': '', 'date': '',
               'taxMode': '未稅', 'netAmount': 200000, 'amount': 200000,
               'taxAmount': 10000, 'tax': 10000, 'grossAmount': 210000, 'total': 210000}
    if issued:
        for source in (billing, ar):
            source.update(invoiceStatus='invoiced', invoiceNo='SYN-K30-PG-ISSUED', invoiceDate='2026-11-12')
        invoice.update(status='issued', invoiceNumber='SYN-K30-PG-ISSUED', number='SYN-K30-PG-ISSUED',
                       invoiceDate='2026-11-12', date='2026-11-12')
    return {'meta': {'k30Synthetic': True}, 'settings': {'defaultTax': 5},
            'audit': [], 'billings': [billing], 'receivables': [ar], 'invoices': [invoice],
            'receipts': [{'id': 'SYN-K30-PG-RECEIPT', 'receivableId': ar['id'],
                          'billingId': billing['id'], 'date': '2026-11-13',
                          'amount': 39000, 'cashAmount': 39000, 'deductions': [{'amount': 1000}],
                          'deductionAmount': 1000, 'settlementAmount': 40000, 'fee': 20,
                          'feePayer': 'company', 'netAmount': 38980, 'collectionType': 'bank',
                          'bankId': 'SYN-K30-PG-BANK', 'bankAccountId': 'SYN-K30-PG-BANK',
                          'bankTransactionId': 'SYN-K30-PG-BANK-RECEIPT', 'paymentMethod': '銀行轉帳'}],
            'retentionReceipts': [{'id': 'SYN-K30-PG-RETENTION', 'receivableId': ar['id'],
                                   'billingId': billing['id'], 'amount': 1000, 'fee': 0, 'feePayer': 'company',
                                   'netAmount': 1000, 'bankId': 'SYN-K30-PG-BANK',
                                   'bankAccountId': 'SYN-K30-PG-BANK', 'bankTransactionId': 'SYN-K30-PG-BANK-RETENTION'}],
            'commissions': [{'id': 'SYN-K30-PG-HISTORICAL-COMMISSION', 'amount': 3210}],
            'salaryPayments': [{'id': 'SYN-K30-PG-HISTORICAL-SALARY', 'amount': 3210}],
            'banks': [{'id': 'SYN-K30-PG-BANK', 'openingBalance': 2000000,
                       'income': 39980, 'expense': 0, 'balance': 2039980}],
            'bankTransactions': [{'id': 'SYN-K30-PG-BANK-RECEIPT', 'amount': 38980, 'actualCredit': 38980,
                                  'netAmount': 38980, 'receiptAmount': 39000, 'fee': 20, 'feePayer': 'company',
                                  'bankId': 'SYN-K30-PG-BANK', 'bankAccountId': 'SYN-K30-PG-BANK',
                                  'sourceType': 'receipt', 'sourceId': 'SYN-K30-PG-RECEIPT',
                                  'receiptId': 'SYN-K30-PG-RECEIPT', 'billingId': billing['id'], 'receivableId': ar['id'],
                                  'type': '收入', 'direction': 'in'},
                                 {'id': 'SYN-K30-PG-BANK-RETENTION', 'amount': 1000, 'actualCredit': 1000,
                                  'netAmount': 1000, 'receiptAmount': 1000, 'fee': 0, 'feePayer': 'company',
                                  'bankId': 'SYN-K30-PG-BANK', 'bankAccountId': 'SYN-K30-PG-BANK',
                                  'sourceType': 'retention_receipt', 'sourceId': 'SYN-K30-PG-RETENTION',
                                  'retentionReceiptId': 'SYN-K30-PG-RETENTION', 'billingId': billing['id'],
                                  'receivableId': ar['id'], 'type': '收入', 'direction': 'in'}]}


def invoice_original(invoice):
    return {'invoiceId': invoice['id'], 'invoiceNumber': invoice['invoiceNumber'],
            'invoiceDate': invoice['invoiceDate'], 'untaxed': invoice['netAmount'],
            'tax': invoice['taxAmount'], 'grossTotal': invoice['grossAmount']}


def event(owner, key='ONE', reductions=None, issued=False):
    original = dict(untaxed=200000, tax=10000, grossTotal=210000, retention=12000, receivable=198000)
    reduction = reductions or dict(untaxed=20000, tax=1000, grossTotal=21000, retention=2000, receivable=19000)
    result = {'schema': SCHEMA, 'id': 'SYN-K30-PG-EVENT-' + key, 'eventType': 'post',
            'reverseOf': '', 'date': '2026-11-28', 'reason': 'Synthetic agreed discount',
            'reference': 'SYN-K30-PG-APPROVAL-' + key, 'scope': 'billing',
            'billingId': 'SYN-K30-PG-BILL', 'externalDocumentId': '', 'externalDocumentRevision': 0,
            'sourceBillingIds': ['SYN-K30-PG-BILL'], 'approvedGrossReduction': reduction['grossTotal'],
            'allocations': [{'billingId': 'SYN-K30-PG-BILL', 'receivableId': 'SYN-K30-PG-AR',
                             'customerId': 'SYN-K30-PG-CUSTOMER', 'projectId': 'SYN-K30-PG-PROJECT',
                             'billingNo': 'SYN-K30-PG-NUMBER', 'original': original,
                             'reductions': reduction, 'invoiceStage': 'postinvoice' if issued else 'preinvoice',
                             'invoiceId': 'SYN-K30-PG-INVOICE',
                             'invoiceOriginal': invoice_original(fixture(owner, issued=True)['invoices'][0]) if issued else None,
                             'taxBasis': None if issued else {'rate': 5, 'taxMode': '未稅', 'originalTaxVerified': True}}],
            'invoiceEvidence': [], 'idempotencyKey': 'SYN-K30-PG-KEY-' + key,
            'intentFingerprint': 'SYN-K30-PG-FINGERPRINT-' + key, 'sourceSnapshot': 'synthetic',
            'companyId': 'SYN-K30-PG-COMPANY', 'createdBy': owner,
            'createdAt': '2026-11-28T03:00:00.000Z'}
    if issued:
        result['invoiceEvidence'] = [{'invoiceId': 'SYN-K30-PG-INVOICE', 'voucherReference': 'SYN-K30-PG-VOUCHER-' + key,
                                      'voucherDate': '2026-11-28', 'verified': True}]
    return result


def with_event(data, item):
    value = deepcopy(data)
    value['meta'].setdefault('billingAllowances', []).append(item)
    value['audit'].insert(0, {'id': item['id'] + '-AUDIT', 'action': 'synthetic allowance'})
    return value


def append_income(data, cash, deduction=0, key='COALESCED'):
    """A later normal receipt/bank transaction in the same pending cloud payload."""
    value = deepcopy(data)
    billing, ar, bank = value['billings'][0], value['receivables'][0], value['banks'][0]
    stamp = '2026-11-28T03:00:03.000Z'
    receipt_id = 'SYN-K30-PG-RECEIPT-' + key
    transaction_id = receipt_id + '-BANK'
    fee = 20
    receipt = {'id': receipt_id, 'receivableId': ar['id'], 'billingId': billing['id'],
               'date': '2026-11-28', 'amount': cash, 'cashAmount': cash,
               'deductions': [{'category': '其他扣款', 'amount': deduction, 'note': 'SYN-K30-PG agreed deduction'}] if deduction else [],
               'deductionAmount': deduction, 'settlementAmount': cash + deduction,
               'fee': fee, 'feePayer': 'company', 'netAmount': cash - fee, 'collectionType': 'bank',
               'bankId': bank['id'], 'bankAccountId': bank['id'], 'bankTransactionId': transaction_id,
               'paymentMethod': '銀行轉帳', 'idempotencyKey': receipt_id + '-KEY',
               'createdAt': stamp, 'updatedAt': stamp}
    transaction = {'id': transaction_id, 'bankId': bank['id'], 'bankAccountId': bank['id'],
                   'sourceType': 'receipt', 'sourceId': receipt_id, 'receiptId': receipt_id,
                   'billingId': billing['id'], 'receivableId': ar['id'], 'sourceNo': billing['number'],
                   'date': receipt['date'], 'type': '收入', 'direction': 'in',
                   'amount': cash - fee, 'actualCredit': cash - fee, 'netAmount': cash - fee,
                   'receiptAmount': cash, 'fee': fee, 'feePayer': 'company', 'createdAt': stamp, 'updatedAt': stamp}
    value['receipts'].append(receipt)
    value['bankTransactions'].append(transaction)
    ar['received'] += cash + deduction
    ar['status'] = '部分收款'
    ar['updatedAt'] = stamp
    billing['status'] = '部分收款'
    billing['updatedAt'] = stamp
    bank['income'] += cash - fee
    bank['balance'] += cash - fee
    bank['updatedAt'] = stamp
    value['meta']['updatedAt'] = stamp
    value['audit'].insert(0, {'id': receipt_id + '-AUDIT', 'action': 'synthetic ordinary receipt', 'time': stamp})
    return value


def reversal_event(posted, key='REVERSE'):
    value = deepcopy(posted)
    value.update(id='SYN-K30-PG-EVENT-' + key, eventType='reverse', reverseOf=posted['id'],
                 idempotencyKey='SYN-K30-PG-KEY-' + key, intentFingerprint='SYN-K30-PG-REVERSE-' + key,
                 reason='Synthetic authorized reversal', reference='SYN-K30-PG-REVERSE-APPROVAL',
                 createdAt='2026-11-28T03:00:05.000Z')
    return value


def issue_effective(data):
    """Same five amounts and frozen invoiceIssueBasis shape as the real Store."""
    value = deepcopy(data)
    billing, ar, invoice = value['billings'][0], value['receivables'][0], value['invoices'][0]
    posts = [item for item in value['meta']['billingAllowances'] if item['eventType'] == 'post']
    reversed_ids = {item['reverseOf'] for item in value['meta']['billingAllowances'] if item['eventType'] == 'reverse'}
    active = [item for item in posts if item['id'] not in reversed_ids]
    allocations = [row for item in active for row in item['allocations'] if row['billingId'] == billing['id']]
    original = deepcopy(allocations[0]['original'])
    effective = {field: amount - sum(row['reductions'][field] for row in allocations) for field, amount in original.items()}
    basis = {'schema': 'kushe.billing.invoice-issue-basis.v1', 'billingId': billing['id'],
             'invoiceId': invoice['id'], 'original': original, 'amounts': effective,
             'allowanceIds': [item['id'] for item in active],
             'taxBasis': deepcopy(allocations[0]['taxBasis']), 'issuedAt': '2026-11-28T03:00:04.000Z'}
    invoice.update(status='issued', invoiceNumber='SYN-K30-PG-EFFECTIVE-INVOICE', number='SYN-K30-PG-EFFECTIVE-INVOICE',
                   invoiceDate='2026-11-28', date='2026-11-28', invoiceIssueBasis=basis,
                   netAmount=effective['untaxed'], amount=effective['untaxed'], taxAmount=effective['tax'],
                   tax=effective['tax'], grossAmount=effective['grossTotal'], total=effective['grossTotal'],
                   updatedAt=basis['issuedAt'])
    for source in (billing, ar):
        source.update(invoiceStatus='invoiced', invoiceNo=invoice['number'], invoiceDate=invoice['invoiceDate'], updatedAt=basis['issuedAt'])
    value['meta']['updatedAt'] = basis['issuedAt']
    value['audit'].insert(0, {'id': invoice['id'] + '-ISSUE-AUDIT', 'action': 'synthetic effective invoice issue'})
    return value


def rpc(owner, version, data, protocol=3, capability=CAP, aal='aal2'):
    with connection('authenticated', owner, aal) as conn:
        if protocol == 1:
            return conn.execute('select * from public.erp_state_cas_write(%s,%s)', (version, Jsonb(data))).fetchone()
        if protocol == 2:
            return conn.execute('select * from public.erp_state_cas_write_v2(%s,%s,%s)', (version, Jsonb(data), 'trusted')).fetchone()
        return conn.execute('select * from public.erp_state_cas_write_v3(%s,%s,%s,%s)', (version, Jsonb(data), 'trusted', capability)).fetchone()


def stored(owner):
    with connection() as conn:
        row = conn.execute('select data,sync_version,updated_at,last_writer_mode,last_base_sync_version from public.erp_states where user_id=%s', (owner,)).fetchone()
    return row


def seed(label, posted=False, issued=False, transform=None):
    owner = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'synthetic-k30-' + label + '.invalid'))
    data = fixture(owner, issued)
    if transform:
        transform(data)
    check(label + ': unchanged v2 seed succeeds', rpc(owner, None, data, 2)[0] == 'APPLIED')
    if posted:
        data = with_event(data, event(owner, issued=issued))
        check(label + ': formal v3 post succeeds', rpc(owner, 1, data)[0] == 'APPLIED')
    return owner, data, 2 if posted else 1


def refused(label, owner, operation, code=None):
    before = stored(owner)
    try:
        operation()
    except psycopg.Error as exc:
        check(label + ': rejected', code is None or code in str(exc))
    else:
        raise AssertionError(label + ': unexpectedly accepted')
    check(label + ': all rows and server revision rolled back', stored(owner) == before)


def run_case(name, work):
    try:
        work()
        report['cases'].append({'name': name, 'passed': True})
    except Exception as exc:
        report['cases'].append({'name': name, 'passed': False})
        report['failures'].append({'name': name, 'error': str(exc), 'traceback': traceback.format_exc()})
    print(json.dumps(report['cases'][-1]), flush=True)


def positive():
    owner, data, version = seed('positive')
    with connection('authenticated', owner) as conn:
        capability = conn.execute('select public.erp_billing_allowance_capability()').fetchone()[0]
        check('capability verifies installed guard', capability == {'capability': CAP, 'schema': SCHEMA, 'guardVersion': 1, 'enabled': True})
    posted = with_event(data, event(owner))
    applied = rpc(owner, version, posted)
    check('post increments server CAS exactly once', applied[0] == 'APPLIED' and applied[1] == 2)
    check('post preserves every original business collection', {k:v for k,v in posted.items() if k not in ('meta','audit')} == {k:v for k,v in data.items() if k not in ('meta','audit')})
    check('exact snapshot stored', stored(owner)[0] == posted)
    check('repeated same stale request conflicts without duplicate', rpc(owner, version, posted)[0] == 'CONFLICT' and len(stored(owner)[0]['meta']['billingAllowances']) == 1)
    reversal = deepcopy(event(owner, 'REVERSE')); reversal['eventType'] = 'reverse'; reversal['reverseOf'] = event(owner)['id']
    reversed_data = with_event(posted, reversal)
    check('append-only reversal succeeds', rpc(owner, 2, reversed_data)[0] == 'APPLIED')
    check('original event remains exact', stored(owner)[0]['meta']['billingAllowances'][0] == posted['meta']['billingAllowances'][0])


def legacy():
    owner, data, version = seed('legacy', True)
    for protocol in (1, 2):
        refused('old protocol ' + str(protocol), owner, lambda p=protocol: rpc(owner, version, data, p), 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED')
    def direct():
        with connection('authenticated', owner) as conn:
            conn.execute('update public.erp_states set data=%s where user_id=%s', (Jsonb(data), owner))
    refused('direct table write', owner, direct, 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED')
    missing = deepcopy(data); missing['meta'].pop('billingAllowances')
    refused('old client drops unknown ledger', owner, lambda: rpc(owner, version, missing, 2), 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED')
    refused('v3 cannot drop history', owner, lambda: rpc(owner, version, missing), 'ALLOWANCE_HISTORY_IMMUTABLE')
    refused('capability argument required', owner, lambda: rpc(owner, version, data, capability='old'), 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED')
    def marker_does_not_leak():
        with connection('authenticated', owner) as conn:
            conn.execute('select * from public.erp_state_cas_write_v3(%s,%s,%s,%s)', (version, Jsonb(data), 'trusted', CAP))
            check('transaction-local capability reset', conn.execute("select current_setting('kushe.erp_allowance_capability',true)").fetchone()[0] in ('', None))
            conn.execute('update public.erp_states set data=data where user_id=%s', (owner,))
    before = stored(owner)
    try: marker_does_not_leak()
    except psycopg.Error as exc: check('later direct write still denied', 'ALLOWANCE_CLIENT_UPGRADE_REQUIRED' in str(exc))
    else: raise AssertionError('marker leaked')
    check('only valid v3 request committed', stored(owner)[1] == before[1]+1)


def auth_rls():
    owner, data, version = seed('rls', True)
    other = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'synthetic-k30-other.invalid'))
    refused('MFA remains mandatory', owner, lambda: rpc(owner, version, data, aal='aal1'), 'AUTH_REQUIRED')
    with connection('authenticated', other) as conn:
        check('other principal cannot read source', conn.execute('select data from public.erp_states where user_id=%s', (owner,)).fetchall() == [])
        check('other principal cannot update source', conn.execute('update public.erp_states set data=data where user_id=%s returning user_id', (owner,)).fetchall() == [])
    check('other principal CAS cannot access owner row', rpc(other, version, data)[0] == 'CONFLICT')
    def anon():
        with connection('anon') as conn: conn.execute('select public.erp_billing_allowance_capability()')
    refused('anonymous capability denied', owner, anon)
    bad = with_event(data, event(other, 'FORGED'))
    refused('posted author must be authenticated principal', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_AUTHOR_MISMATCH')


def invalid_events():
    variants = [
        ('null-schema', lambda e: e.update(schema=None)),
        ('null-event-type', lambda e: e.update(eventType=None)),
        ('empty-source', lambda e: e['allocations'][0].update(billingId='')),
        ('bad-source-set', lambda e: e.update(sourceBillingIds=['WRONG'])),
        ('bad-total', lambda e: e.update(approvedGrossReduction=21001)),
        ('negative', lambda e: e['allocations'][0]['reductions'].update(untaxed=-1)),
        ('fractional', lambda e: e['allocations'][0]['reductions'].update(tax=1.5)),
        ('unsafe-integer', lambda e: e['allocations'][0]['reductions'].update(tax=9007199254740992)),
        ('unbalanced', lambda e: e['allocations'][0]['reductions'].update(receivable=19001)),
        ('missing-source', lambda e: e['allocations'][0].update(receivableId='MISSING')),
        ('forged-original', lambda e: e['allocations'][0]['original'].update(untaxed=200001)),
        ('unknown-reversal', lambda e: e.update(eventType='reverse', reverseOf='MISSING')),
        ('malformed-invoice-stage', lambda e: e['allocations'][0].update(invoiceStage=None)),
    ]
    for name, mutate in variants:
        owner, data, version = seed('invalid-' + name)
        item = event(owner); mutate(item)
        refused(name, owner, lambda: rpc(owner, version, with_event(data, item)))


def history():
    owner, data, version = seed('history', True)
    bad = deepcopy(data); bad['meta']['billingAllowances'][0]['reason'] = 'rewrite'
    refused('rewrite earlier event', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_HISTORY_IMMUTABLE')
    bad = with_event(data, event(owner))
    refused('duplicate id and idempotency key', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_DUPLICATE_OPERATION')
    # A cloud payload can aggregate separate legitimate local writers. The
    # server protects affected source anchors, not every unrelated collection.
    bad = with_event(data, event(owner, 'SECOND')); bad['billings'][0]['lines'][0]['amount'] -= 1
    refused('coalesced append cannot rewrite affected original source', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_ORIGINAL_CHANGED')
    bad = deepcopy(data); bad['billings'][0]['lines'][0]['amount'] -= 1
    refused('original line protected even if totals unchanged', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_ORIGINAL_CHANGED')
    bad = deepcopy(data); bad['billings'][0]['amount'] -= 1
    refused('original alias protected', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_ORIGINAL_CHANGED')


def aggregated_writers():
    owner, data, version = seed('coalesced-post-receipt-bank')
    payload = append_income(with_event(data, event(owner)), 128000, 1000)
    delta = datetime.fromisoformat(payload['receipts'][-1]['createdAt'].replace('Z', '+00:00')) - datetime.fromisoformat(payload['meta']['billingAllowances'][0]['createdAt'].replace('Z', '+00:00'))
    check('fixture models separate local post and ordinary receipt inside eight-second cloud debounce', 0 < delta.total_seconds() < 8)
    result = rpc(owner, version, payload)
    check('one cloud payload accepts post plus normal receipt and bank balance update', result[0] == 'APPLIED' and result[1] == version + 1)
    check('coalesced receipt settles exact effective cap with exact bank credit', stored(owner)[0] == payload and payload['receivables'][0]['received'] == 179000 and payload['bankTransactions'][-1]['amount'] == 127980)
    check('coalesced cloud commit keeps original historical witnesses intact', payload['commissions'] == data['commissions'] and payload['salaryPayments'] == data['salaryPayments'])
    owner, data, version = seed('coalesced-post-over-cap')
    over = append_income(with_event(data, event(owner)), 128001, 1000)
    refused('same payload post plus one above effective settlement cap rejected', owner, lambda: rpc(owner, version, over), 'ALLOWANCE_COLLECTION_LIMIT')


def first_post_originals():
    for variant in ('lines', 'coherent-amount-rewrite', 'issued-voucher-rewrite'):
        issued = variant == 'issued-voucher-rewrite'
        owner, data, version = seed('first-post-protection-' + variant, issued=issued)
        item = event(owner, issued=issued)
        candidate = deepcopy(data)
        if variant == 'lines':
            candidate['billings'][0]['lines'][0]['amount'] -= 1
        elif variant == 'coherent-amount-rewrite':
            candidate['billings'][0].update(amount=210000, preTaxAmount=210000, tax=10500, taxAmount=10500,
                                           grossTotal=220500, taxIncludedAmount=220500, total=208500)
            candidate['receivables'][0]['amount'] = 208500
            candidate['invoices'][0].update(netAmount=210000, amount=210000, taxAmount=10500, tax=10500,
                                           grossAmount=220500, total=220500)
            item['allocations'][0]['original'].update(untaxed=210000, tax=10500, grossTotal=220500, receivable=208500)
        else:
            candidate['invoices'][0].update(invoiceNumber='SYN-K30-PG-FORGED-VOUCHER', number='SYN-K30-PG-FORGED-VOUCHER')
            candidate['billings'][0]['invoiceNo'] = 'SYN-K30-PG-FORGED-VOUCHER'
            candidate['receivables'][0]['invoiceNo'] = 'SYN-K30-PG-FORGED-VOUCHER'
            item['allocations'][0]['invoiceOriginal'] = invoice_original(candidate['invoices'][0])
        refused('first allowance protects previously stored ' + variant, owner,
                lambda: rpc(owner, version, with_event(candidate, item)), 'ALLOWANCE_')
        valid = with_event(data, event(owner, issued=issued))
        check('unchanged original counterpart remains admissible ' + variant, rpc(owner, version, valid)[0] == 'APPLIED')


def mixed_group_zero_issued():
    def add_source(data):
        billing = deepcopy(data['billings'][0])
        billing.update(id='SYN-K30-PG-BILL-B', receivableId='SYN-K30-PG-AR-B', number='SYN-K30-PG-NUMBER-B',
                       project='SYN-K30-PG-PROJECT-B', amount=100000, preTaxAmount=100000, tax=5000, taxAmount=5000,
                       grossTotal=105000, taxIncludedAmount=105000, retention=0, retentionAmount=0, total=105000,
                       invoiceStatus='invoiced', invoiceNo='SYN-K30-PG-ISSUED-B', invoiceDate='2026-11-12',
                       lines=[{'id': 'SYN-K30-PG-LINE-B', 'amount': 100000}])
        ar = deepcopy(data['receivables'][0])
        ar.update(id=billing['receivableId'], billingId=billing['id'], sourceNo=billing['number'], project=billing['project'],
                  amount=105000, retention=0, retentionAmount=0, legacyReceived=0, received=0,
                  legacyRetentionReceived=0, retentionReceived=0, invoiceStatus='invoiced',
                  invoiceNo=billing['invoiceNo'], invoiceDate=billing['invoiceDate'])
        invoice = deepcopy(data['invoices'][0])
        invoice.update(id='SYN-K30-PG-INVOICE-B', invoiceId='SYN-K30-PG-INVOICE-B', billingId=billing['id'], sourceId=billing['id'],
                       sourceNo=billing['number'], projectId=billing['project'], status='issued', invoiceNumber=billing['invoiceNo'],
                       number=billing['invoiceNo'], invoiceDate=billing['invoiceDate'], date=billing['invoiceDate'],
                       netAmount=100000, amount=100000, taxAmount=5000, tax=5000, grossAmount=105000, total=105000)
        data['billings'].append(billing)
        data['receivables'].append(ar)
        data['invoices'].append(invoice)
        data['meta']['externalBillingDocuments'] = [{'id': 'SYN-K30-PG-GROUP', 'schema': 'kushe-external-billing-group-v2',
            'status': 'active', 'revision': 1, 'sourceIds': [data['billings'][0]['id'], billing['id']],
            'targetBillingId': data['billings'][0]['id'], 'customerId': billing['customer'], 'customerName': 'Synthetic customer',
            'displayProjectName': 'Synthetic grouped projects', 'documentDate': '2026-11-20', 'history': []}]
    owner, data, version = seed('group-zero-issued', transform=add_source)
    item = event(owner)
    item.update(scope='external-document', billingId='', externalDocumentId='SYN-K30-PG-GROUP', externalDocumentRevision=1,
                sourceBillingIds=[row['id'] for row in data['billings']])
    item['allocations'].append({'billingId': 'SYN-K30-PG-BILL-B', 'receivableId': 'SYN-K30-PG-AR-B',
        'customerId': 'SYN-K30-PG-CUSTOMER', 'projectId': 'SYN-K30-PG-PROJECT-B', 'billingNo': 'SYN-K30-PG-NUMBER-B',
        'original': dict(untaxed=100000, tax=5000, grossTotal=105000, retention=0, receivable=105000),
        'reductions': dict(untaxed=0, tax=0, grossTotal=0, retention=0, receivable=0),
        'invoiceStage': 'postinvoice', 'invoiceId': 'SYN-K30-PG-INVOICE-B',
        'invoiceOriginal': invoice_original(data['invoices'][1]), 'taxBasis': None})
    candidate = with_event(data, item)
    check('zero-allocation issued source needs no fabricated voucher evidence', item['invoiceEvidence'] == [] and rpc(owner, version, candidate)[0] == 'APPLIED')
    saved = stored(owner)[0]
    check('mixed group books approved reduction once and preserves zero source invoice', saved == candidate and saved['invoices'][1] == data['invoices'][1] and sum(row['reductions']['grossTotal'] for row in item['allocations']) == 21000)


def invoice_basis_protection():
    owner, data, version = seed('valid-effective-invoice', posted=True)
    issued = issue_effective(data)
    check('effective invoice issue with complete frozen basis is accepted', rpc(owner, version, issued)[0] == 'APPLIED')
    check('invoice issue uses exact effective amounts and original source anchors', issued['invoices'][0]['netAmount'] == 180000 and issued['invoices'][0]['taxAmount'] == 9000 and issued['invoices'][0]['grossAmount'] == 189000 and issued['billings'][0]['amount'] == 200000)
    version += 1
    for variant in ('removed', 'changed-issued-at'):
        altered = deepcopy(issued)
        if variant == 'removed':
            altered['invoices'][0].pop('invoiceIssueBasis')
        else:
            altered['invoices'][0]['invoiceIssueBasis']['issuedAt'] = '2026-11-28T03:00:06.000Z'
        refused('v3 cannot rewrite established invoice basis ' + variant, owner, lambda: rpc(owner, version, altered), 'ALLOWANCE_')
    reversal = reversal_event(issued['meta']['billingAllowances'][0], 'INVOICED-REVERSE')
    refused('included preinvoice allowance cannot reverse after effective issuance', owner,
            lambda: rpc(owner, version, with_event(issued, reversal)), 'ALLOWANCE_')
    # Rebuild an otherwise valid old pending invoice and append a mathematically
    # valid reversal in one payload. Validation of NEW alone cannot detect this;
    # OLD.invoiceIssueBasis must remain protected across every later v3 write.
    bypass = with_event(data, reversal)
    refused('removing basis and reverting invoice cannot bypass reversal restriction', owner,
            lambda: rpc(owner, version, bypass), 'ALLOWANCE_')
    owner, original, version = seed('coalesced-post-and-effective-issue')
    coalesced = issue_effective(with_event(original, event(owner)))
    check('post plus valid effective invoice issuance may share one cloud snapshot', rpc(owner, version, coalesced)[0] == 'APPLIED')
    check('coalesced issuance retains original pending source money and stores complete basis', stored(owner)[0] == coalesced and coalesced['invoices'][0]['invoiceIssueBasis']['allowanceIds'] == [event(owner)['id']])


def capacity():
    owner, data, version = seed('capacity', True)
    effective = 179000
    paid = deepcopy(data)
    paid['receipts'].append({'id':'SYN-K30-PG-FINAL','receivableId':'SYN-K30-PG-AR','amount':effective-50000})
    paid['receivables'][0]['received'] = effective
    check('exact effective cap succeeds', rpc(owner, version, paid)[0] == 'APPLIED')
    too_much = deepcopy(paid); too_much['receipts'][-1]['amount'] += 1; too_much['receivables'][0]['received'] += 1
    refused('one over cap rejected', owner, lambda: rpc(owner, 3, too_much), 'ALLOWANCE_COLLECTION_LIMIT')
    owner, data, version = seed('retention-capacity', True)
    data['retentionReceipts'].append({'id':'SYN-K30-PG-RET-FINAL','receivableId':'SYN-K30-PG-AR','billingId':'SYN-K30-PG-BILL','amount':8000})
    data['receivables'][0]['retentionReceived'] = 10000
    check('exact effective retention cap succeeds', rpc(owner, version, data)[0] == 'APPLIED')
    data['retentionReceipts'][-1]['amount'] += 1; data['receivables'][0]['retentionReceived'] += 1
    refused('retention one over cap rejected', owner, lambda: rpc(owner, 3, data), 'ALLOWANCE_COLLECTION_LIMIT')
    owner, data, version = seed('cheque-capacity', True)
    data['receivables'][0]['receivableCheques'] = [{'id':'SYN-K30-PG-CHEQUE','schema':'kushe-receivable-cheque-v1','status':'pending','amount':128500,'deductions':[{'amount':500}],'reservedAmount':129000}]
    check('cash plus deduction cheque hold at cap succeeds', rpc(owner, version, data)[0] == 'APPLIED')
    data['receivables'][0]['receivableCheques'][0]['amount'] += 1
    data['receivables'][0]['receivableCheques'][0]['reservedAmount'] += 1
    refused('cheque reservation over cap rejected', owner, lambda: rpc(owner, 3, data), 'ALLOWANCE_COLLECTION_LIMIT')


def concurrency():
    owner, data, version = seed('race')
    barrier = threading.Barrier(2)
    def contender(key):
        payload = with_event(data, event(owner, key)); barrier.wait()
        return rpc(owner, version, payload)[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(contender, ('RACE-A', 'RACE-B')))
    check('two real PostgreSQL connections have one winner', sorted(results) == ['APPLIED','CONFLICT'])
    check('winning state contains one complete event', stored(owner)[1] == 2 and len(stored(owner)[0]['meta']['billingAllowances']) == 1)


try:
    migration = list((ROOT/'supabase/migrations').glob('*_k30_billing_allowance_guard.sql'))
    check('one exact candidate migration', len(migration) == 1)
    report['migrationSha256'] = hashlib.sha256(migration[0].read_bytes()).hexdigest()
    with connection() as conn:
        check('fresh disposable database only', conn.execute("select to_regclass('public.erp_states')").fetchone()[0] is None)
        conn.execute((ROOT/'.p41-k30-tests/postgres_bootstrap.sql').read_text())
        conn.execute(migration[0].read_text())
        report['serverVersion'] = conn.execute('show server_version').fetchone()[0]
        security = conn.execute("select proname,prosecdef,proconfig from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='erp_allowance_internal' or proname in ('erp_state_cas_write_v3','erp_billing_allowance_capability')").fetchall()
        expected_functions = {'money', 'money_aliases', 'verify_tax', 'validate_snapshot', 'guard_state_write',
                              'erp_state_cas_write_v3', 'erp_billing_allowance_capability'}
        check('exact seven reviewed functions use invoker with locked search path',
              len(security) == len(expected_functions) and {row[0] for row in security} == expected_functions
              and all(not row[1] and 'search_path=pg_catalog' in row[2] for row in security))
    for name, work in [('positive-post-and-reverse',positive),('legacy-and-direct-write-fence',legacy),('rls-and-mfa',auth_rls),('invalid-event-rejections',invalid_events),('immutable-history-and-originals',history),('coalesced-local-writers-in-one-cloud-payload',aggregated_writers),('first-post-preserves-original-anchors',first_post_originals),('mixed-group-issued-zero-allocation',mixed_group_zero_issued),('invoice-basis-and-reversal-protection',invoice_basis_protection),('effective-collection-capacities',capacity),('real-concurrent-cas',concurrency)]:
        run_case(name, work)
except Exception as exc:
    report['failures'].append({'name':'setup','error':str(exc),'traceback':traceback.format_exc()})
finally:
    report['status'] = 'PASS' if report['cases'] and not report['failures'] and all(x['passed'] for x in report['checks']) else 'BLOCKED'
    report['passCount'] = sum(x['passed'] for x in report['checks'])
    (args.output/'RESULT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('status','passCount','cases','failures')},ensure_ascii=False),flush=True)
raise SystemExit(0 if report['status']=='PASS' else 1)
