#!/usr/bin/env python3
"""Actual disposable PostgreSQL/RLS/CAS tests. No hosted database or Auth login.

JWT claims are synthetic SQL session fixtures, not an authentication test.
Only a loopback database named k30_synthetic is accepted.
"""
import argparse
import concurrent.futures
from copy import deepcopy
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


def fixture(owner):
    billing = {'id': 'SYN-K30-PG-BILL', 'receivableId': 'SYN-K30-PG-AR',
               'number': 'SYN-K30-PG-NUMBER', 'date': '2026-11-10',
               'customer': 'SYN-K30-PG-CUSTOMER', 'project': 'SYN-K30-PG-PROJECT',
               'amount': 200000, 'preTaxAmount': 200000, 'tax': 10000, 'taxAmount': 10000,
               'grossTotal': 210000, 'taxIncludedAmount': 210000,
               'retention': 12000, 'retentionAmount': 12000, 'total': 198000,
               'invoiceStatus': 'invoice_pending', 'invoiceNo': '', 'taxMode': '未稅',
               'lines': [{'id': 'SYN-K30-PG-LINE', 'amount': 200000}]}
    ar = {'id': billing['receivableId'], 'billingId': billing['id'],
          'amount': 198000, 'retention': 12000, 'retentionAmount': 12000,
          'legacyReceived': 10000, 'received': 50000, 'legacyRetentionReceived': 1000,
          'retentionReceived': 2000, 'receivableCheques': []}
    return {'meta': {'k30Synthetic': True}, 'audit': [], 'billings': [billing],
            'receivables': [ar], 'invoices': [],
            'receipts': [{'id': 'SYN-K30-PG-RECEIPT', 'receivableId': ar['id'],
                          'amount': 39000, 'cashAmount': 39000, 'deductions': [{'amount': 1000}],
                          'deductionAmount': 1000, 'settlementAmount': 40000, 'fee': 20,
                          'netAmount': 38980}],
            'retentionReceipts': [{'id': 'SYN-K30-PG-RETENTION', 'receivableId': ar['id'],
                                   'billingId': billing['id'], 'amount': 1000}],
            'commissions': [{'id': 'SYN-K30-PG-HISTORICAL-COMMISSION', 'amount': 3210}],
            'salaryPayments': [{'id': 'SYN-K30-PG-HISTORICAL-SALARY', 'amount': 3210}],
            'bankTransactions': [{'id': 'SYN-K30-PG-BANK-RECEIPT', 'amount': 38980}]}


def event(owner, key='ONE', reductions=None):
    original = dict(untaxed=200000, tax=10000, grossTotal=210000, retention=12000, receivable=198000)
    reduction = reductions or dict(untaxed=20000, tax=1000, grossTotal=21000, retention=2000, receivable=19000)
    return {'schema': SCHEMA, 'id': 'SYN-K30-PG-EVENT-' + key, 'eventType': 'post',
            'reverseOf': '', 'date': '2026-11-28', 'reason': 'Synthetic agreed discount',
            'reference': 'SYN-K30-PG-APPROVAL-' + key, 'scope': 'billing',
            'billingId': 'SYN-K30-PG-BILL', 'externalDocumentId': '', 'externalDocumentRevision': 0,
            'sourceBillingIds': ['SYN-K30-PG-BILL'], 'approvedGrossReduction': reduction['grossTotal'],
            'allocations': [{'billingId': 'SYN-K30-PG-BILL', 'receivableId': 'SYN-K30-PG-AR',
                             'customerId': 'SYN-K30-PG-CUSTOMER', 'projectId': 'SYN-K30-PG-PROJECT',
                             'billingNo': 'SYN-K30-PG-NUMBER', 'original': original,
                             'reductions': reduction, 'invoiceStage': 'preinvoice',
                             'invoiceId': '', 'invoiceOriginal': None}],
            'invoiceEvidence': [], 'idempotencyKey': 'SYN-K30-PG-KEY-' + key,
            'intentFingerprint': 'SYN-K30-PG-FINGERPRINT-' + key, 'sourceSnapshot': 'synthetic',
            'companyId': 'SYN-K30-PG-COMPANY', 'createdBy': owner,
            'createdAt': '2026-11-28T03:00:00.000Z'}


def with_event(data, item):
    value = deepcopy(data)
    value['meta'].setdefault('billingAllowances', []).append(item)
    value['audit'].insert(0, {'id': item['id'] + '-AUDIT', 'action': 'synthetic allowance'})
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


def seed(label, posted=False):
    owner = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'synthetic-k30-' + label + '.invalid'))
    data = fixture(owner)
    check(label + ': unchanged v2 seed succeeds', rpc(owner, None, data, 2)[0] == 'APPLIED')
    if posted:
        data = with_event(data, event(owner))
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
    bad = with_event(data, event(owner, 'SECOND')); bad['commissions'][0]['amount'] -= 1
    refused('allowance cannot rewrite historical commission', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_POST_MUST_PRESERVE_BUSINESS_ROWS')
    bad = deepcopy(data); bad['billings'][0]['lines'][0]['amount'] -= 1
    refused('original line protected even if totals unchanged', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_ORIGINAL_CHANGED')
    bad = deepcopy(data); bad['billings'][0]['amount'] -= 1
    refused('original alias protected', owner, lambda: rpc(owner, version, bad), 'ALLOWANCE_ORIGINAL_CHANGED')


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
        check('all new functions use invoker with locked search path', len(security) == 5 and all(not row[1] and 'search_path=pg_catalog' in row[2] for row in security))
    for name, work in [('positive-post-and-reverse',positive),('legacy-and-direct-write-fence',legacy),('rls-and-mfa',auth_rls),('invalid-event-rejections',invalid_events),('immutable-history-and-originals',history),('effective-collection-capacities',capacity),('real-concurrent-cas',concurrency)]:
        run_case(name, work)
except Exception as exc:
    report['failures'].append({'name':'setup','error':str(exc),'traceback':traceback.format_exc()})
finally:
    report['status'] = 'PASS' if report['cases'] and not report['failures'] and all(x['passed'] for x in report['checks']) else 'BLOCKED'
    report['passCount'] = sum(x['passed'] for x in report['checks'])
    (args.output/'RESULT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('status','passCount','cases','failures')},ensure_ascii=False),flush=True)
raise SystemExit(0 if report['status']=='PASS' else 1)
