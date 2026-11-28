#!/usr/bin/env python3
"""Prospective policy acceptance through the actual Store and durable browser.

Only an owned loopback server, isolated browser profiles and synthetic records
are used. Cloud capability is explicit surrounding infrastructure, not a Store
or writer mock. Hosted Auth/SQL have separate evidence.
"""
import argparse
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import traceback

from playwright.sync_api import sync_playwright

from k30_browser_store import (ROOT, Report as AllowanceReport, Server, call, raw,
    public, restrict, open_page, select_browser, invoke, denied, unchanged,
    JOURNAL, EMERGENCY, STORE_TOKEN, RECEIPT_TOKEN, GATES)
from k30_policy_fixture import (HTML, PREFIX, POLICY, DATE, OLD_DATE, OWNER,
    CUSTOMER, BANK, EMPLOYEES, PROJECT, OTHER_PROJECT, RATES, LEGACY_PAID,
    LEGACY_UNPAID, LEGACY_BILLS, MANUAL_BILL, fixture, terms, line,
    daily_values, manual_values, finalization_values, allowance_values,
    legacy_payment_terms)

BASE = 'c48f29e0b2024263919d41e7c6d08c2eb87d4006'
POLICY_KEYS = ('commissionAgreements', 'commissionFinalizations', 'commissionPaymentTerms')


class Report(AllowanceReport):
    def __init__(self, output):
        super().__init__(output)
        self.data.update(schema='k30-policy-real-store-browser-v1',
                         policy=POLICY, prospectiveBaseCommit=BASE)


def boot(context, server, report, name):
    restrict(context, server, report, name)
    page = open_page(context, server)
    report.check(name + ': owned empty synthetic profile is seeded once',
                 page.evaluate('x=>__k28Seed(x)', fixture()) is True)
    page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
    invoke(page, report, name, 'load')
    invoke(page, report, name, 'saveCustomer',
           {'name': 'SYN-K30-合成客戶', 'note': PREFIX + 'NORMALIZED-BASELINE'}, CUSTOMER)
    before = raw(page)
    report.check(name + ': public baseline is the actual durable primary',
                 public(page) == before['idb']['main'])
    legacy = {row['id']: row for row in public(page)['commissions']}
    report.check(name + ': preserved witnesses include a paid amount and non-formula unpaid agreement',
                 legacy[LEGACY_PAID]['commission'] == 5000
                 and legacy[LEGACY_UNPAID]['commission'] == 1777
                 and bool(public(page)['salaryPayments']))
    return page, before


def preserve_history(report, name, before, after, excluded=None):
    excluded = excluded or {}
    for collection, values in before.items():
        if not isinstance(values, list) or collection == 'audit':
            continue
        lookup = {str(row.get('id')): row for row in after.get(collection, [])
                  if isinstance(row, dict) and row.get('id') is not None}
        protected = [row for row in values if isinstance(row, dict)
                     and row.get('id') is not None
                     and str(row['id']) not in excluded.get(collection, set())]
        report.check(name + ': original ' + collection + ' records remain exact',
                     all(lookup.get(str(row['id'])) == row for row in protected))


def coherent_commit(page, report, name, before, writer):
    after = raw(page)
    old, new = before['idb']['main'], after['idb']['main']
    revision = new['meta']['businessSnapshotRevision']
    previous = old['meta']['businessSnapshotRevision']
    report.check(name + ': one revision and one exact parent are committed',
                 revision['sequence'] == previous['sequence'] + 1
                 and revision['parentId'] == previous['id'])
    report.check(name + ': one audit is added without rewriting history',
                 len(new['audit']) == len(old['audit']) + 1 and new['audit'][1:] == old['audit'])
    report.check(name + ': actual transaction identifies the requested writer',
                 after['idb'][JOURNAL]['phase'] == 'COMMIT_VERIFIED'
                 and after['idb'][JOURNAL]['operationType'] == writer)
    report.check(name + ': primary mirror tokens and public state agree',
                 public(page) == new and json.loads(after['local'][EMERGENCY]) == new
                 and json.loads(after['local'][STORE_TOKEN])['revisionId'] == revision['id']
                 and after['local'][RECEIPT_TOKEN] == revision['id'])
    report.check(name + ': no recovery gate remains',
                 all(after[layer][gate] is None for layer in ('idb', 'local', 'session') for gate in GATES))
    for key in POLICY_KEYS:
        previous_events, events = old['meta'].get(key, []), new['meta'].get(key, [])
        report.check(name + ': ' + key + ' preserves its complete immutable prefix',
                     events[:len(previous_events)] == previous_events)
    return after


def scopes(page, report, name):
    before = raw(page)
    result = invoke(page, report, name, 'commissionAgreementScopes')
    report.check(name + ': agreement reader is read-only and valid',
                 raw(page) == before and not result['issues'], result)
    return result['agreements']


def daily_options(page, values, batch=''):
    answer = call(page, 'dailyDraftSnapshot', values, batch)
    if not answer['ok']:
        raise AssertionError(answer)
    return {'strictRows': True,
            'draftRowKeys': [PREFIX + 'DRAFT-ROW-' + str(index) for index in range(len(values['lines']))],
            'expectedDailyDraftSnapshot': answer['result'], 'expectedDraftPrincipal': OWNER}


def save_daily(page, report, name, values):
    before = raw(page)
    batch = invoke(page, report, name, 'saveDailyBatch', values, '', daily_options(page, values))
    coherent_commit(page, report, name, before, 'saveDailyBatch')
    logs = [row for row in public(page)['dailyLogs'] if row.get('batchId') == batch]
    agreements = [row for row in scopes(page, report, name)
                  if row.get('groupId') in {log['groupId'] for log in logs}]
    return batch, logs, agreements


def bill_sources(page, report, name, selected, retention=0):
    """Use real source refs; copies belonging to other employees are not doubled."""
    refs, lines = [], []
    for log, index in selected:
        item = log['items'][index]
        ref = {'sourceType': 'daily-log', 'sourceGroupKey': log['groupId'],
               'workItemId': item['workItemId']}
        refs.append(ref)
        lines.append({'house': item['house'], 'item': item['item'], 'unit': item['unit'],
                      'qty': item['qty'], 'price': item['untaxedSubtotal'] / item['qty'],
                      'sourceRefs': [ref]})
    values = {'date': DATE, 'number': PREFIX + name, 'project': selected[0][0]['project'],
              'customer': CUSTOMER, 'taxMode': '未稅', 'invoiceStatus': 'invoice_pending',
              'retentionMode': 'custom' if retention else 'none',
              'retentionCustom': retention, 'retentionBase': 'preTax',
              'sourceItemRefs': refs, 'sourceContractRefs': [], 'lines': lines}
    return invoke(page, report, name, 'createBilling', values)


def discount(page, report, name, billing_id, reduction=None, legacy_terms=None):
    values = allowance_values(billing_id, name, reduction, legacy_terms)
    before_preview = raw(page)
    preview = invoke(page, report, name, 'billingAllowancePreview', values)
    report.check(name + ': actual allowance preview is allowed and read-only',
                 preview['allowed'] and raw(page) == before_preview, preview)
    before = raw(page)
    event = invoke(page, report, name, 'postBillingAllowance',
                   {**values, 'expectedSnapshot': preview['snapshot']})
    coherent_commit(page, report, name, before, 'postBillingAllowance')
    return event


def reverse_discount(page, report, name, event):
    values = {'reverseOf': event['id'], 'date': DATE, 'reference': PREFIX + name,
              'reason': PREFIX + 'REVERSE-AGREED-DISCOUNT', 'invoiceEvidence': [],
              'idempotencyKey': PREFIX + name + '-KEY', 'confirmed': True}
    preview = invoke(page, report, name, 'billingAllowancePreview', values)
    report.check(name + ': actual reversal is eligible', preview['allowed'], preview)
    before = raw(page)
    result = invoke(page, report, name, 'reverseBillingAllowance', event['id'],
                    {**values, 'expectedSnapshot': preview['snapshot']})
    coherent_commit(page, report, name, before, 'reverseBillingAllowance')
    return result


def final_preview(page, report, name, values, allowed=None):
    before = raw(page)
    result = invoke(page, report, name, 'commissionFinalizationPreview', values)
    report.check(name + ': finalization preview writes no durable or public data',
                 raw(page) == before and public(page) == before['idb']['main'])
    if allowed is not None:
        report.check(name + ': preview admission is exact', result['allowed'] is allowed, result)
    return result


def round_money(base, rate):
    return int((Decimal(str(base)) * Decimal(str(rate)) / Decimal(100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def finalize(page, report, name, values, expected_bases):
    preview = final_preview(page, report, name, values, allowed=True)
    request = {**deepcopy(values), 'expectedSnapshot': preview['snapshot']}
    before = raw(page)
    event = invoke(page, report, name, 'finalizeCommissionAgreements', request)
    after = coherent_commit(page, report, name, before, 'finalizeCommissionAgreements')
    old, new = before['idb']['main'], after['idb']['main']
    events = new['meta'].get('commissionFinalizations', [])
    report.check(name + ': exactly one immutable formal finalization is appended',
                 events == old['meta'].get('commissionFinalizations', []) + [event]
                 and event['schema'] == 'kushe.commission.finalization.v1'
                 and event['eventType'] == 'finalize')
    new_rows = [row for row in new['commissions'] if row.get('commissionFinalizationId') == event['id']]
    agreements = {row['id']: row for row in scopes(page, report, name)}
    expected = []
    for agreement_id, base in expected_bases.items():
        agreement = agreements[agreement_id]
        report.check(name + ': scope is finalized at the independently expected net base ' + agreement_id,
                     agreement['status'] == 'finalized' and agreement['finalBase'] == base)
        for participant in agreement['participants']:
            expected.append((agreement_id, participant['employeeId'], base,
                             participant['rate'], round_money(base, participant['rate'])))
    actual = [(row['commissionAgreementId'], row['employee'], row['commissionBaseAmount'],
               row['rate'], row['commission']) for row in new_rows]
    report.check(name + ': formal rows use the frozen individual rates and whole approved pretax bases',
                 sorted(actual) == sorted(expected), {'actual': actual, 'expected': expected})
    report.check(name + ': finalization never rewrites daily estimates original billing or payment records',
                 all(new[key] == old[key] for key in ('dailyLogs', 'billings', 'receivables',
                     'invoices', 'receipts', 'retentionReceipts', 'salaryPayments',
                     'commissionSettlements', 'banks', 'bankTransactions')))
    report.check(name + ': prior commission rows remain byte-equivalent',
                 all(next((r for r in new['commissions'] if r['id'] == row['id']), None) == row
                     for row in old['commissions']))
    report.check(name + ': event stores exact new commission snapshots',
                 sorted(event['commissionRows'], key=lambda r: r['id']) == sorted(new_rows, key=lambda r: r['id']))
    report.save(name + '-finalization.json', {'preview': preview, 'request': request, 'event': event,
                                            'state': new})
    return event, new_rows, request, after


def unbilled_allocation(agreement, amount):
    return {'billingId': '', 'scopeKey': agreement['scopeKey'], 'untaxedAmount': amount,
            'approvalReference': PREFIX + 'EXPLICIT-UNBILLED-FINAL-NET'}


def run_upgrade(browser, server, report, baseline_bytes):
    name = 'policy-cold-upgrade-never-enrols-or-recalculates-existing-work'
    context = browser.new_context(service_workers='block')
    candidate = server.resources['/assets/js/erp-store.js']
    try:
        server.resources['/assets/js/erp-store.js'] = (baseline_bytes, candidate[1])
        page, before = boot(context, server, report, name)
        server.resources['/assets/js/erp-store.js'] = candidate
        page.reload()
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        invoke(page, report, name, 'load')
        report.check(name + ': exact former release upgrades without a single persistent write',
                     raw(page) == before and public(page) == before['idb']['main'])
        report.check(name + ': no existing row is automatically enrolled',
                     scopes(page, report, name) == []
                     and all(not public(page)['meta'].get(key) for key in POLICY_KEYS))
        report.save(name + '.json', {'oldStoreSha256': hashlib.sha256(baseline_bytes).hexdigest(),
                                     'candidateStoreSha256': hashlib.sha256(candidate[0]).hexdigest()})
        report.case(name)
    finally:
        server.resources['/assets/js/erp-store.js'] = candidate
        context.close()


def run_daily_selection(browser, server, report):
    name = 'policy-explicit-per-project-daily-estimates-with-legacy-default'
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        values = daily_values(lines=[line(PROJECT, 100000), line(OTHER_PROJECT, 10000, 'B1', 'LEGACY')])
        _, logs, agreements = save_daily(page, report, name, values)
        prospective = [row for row in logs if row['project'] == PROJECT]
        old_rule = [row for row in logs if row['project'] == OTHER_PROJECT]
        report.check(name + ': only the expressly opted-in project creates an agreement',
                     len(agreements) == 1 and agreements[0]['projectId'] == PROJECT)
        agreement = agreements[0]
        report.check(name + ': agreement freezes the actual participants and agreed fifty-percent pool',
                     {p['employeeId']: p['rate'] for p in agreement['participants']} == RATES
                     and sum(p['rate'] for p in agreement['participants']) == 50)
        report.check(name + ': new daily records contain estimates and zero formal wages',
                     len(prospective) == 2 and all(row['commission'] == 0
                         and row['estimatedCommission'] == round_money(100000, RATES[row['employee']])
                         and row['commissionAgreementId'] == agreement['id']
                         and row['commissionPolicy'] == POLICY for row in prospective))
        report.check(name + ': absent opt-in keeps the other project on its original earned calculation',
                     len(old_rule) == 2 and all(not row.get('commissionAgreementId')
                         and row['commission'] == round_money(10000, RATES[row['employee']]) for row in old_rule))
        state = public(page)
        report.check(name + ': no formal commission is created for the new agreement before finalization',
                     not any(row.get('sourceId') in {log['id'] for log in prospective}
                             or row.get('commissionAgreementId') == agreement['id'] for row in state['commissions']))
        report.check(name + ': policy selection creates neither salary nor bank payment',
                     all(state[key] == initial['idb']['main'][key] for key in
                         ('salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
        preserve_history(report, name, initial['idb']['main'], state)
        report.case(name)
    finally:
        context.close()


def run_backfill(browser, server, report):
    name = 'policy-late-historical-backfill-is-legacy-even-in-new-project'
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        values = daily_values(False, OTHER_PROJECT, 20000, OLD_DATE)
        batch, logs, agreements = save_daily(page, report, name, values)
        report.check(name + ': newly entered historical work retains original earned amounts',
                     not agreements and all(not row.get('commissionPolicy')
                         and row['commission'] == round_money(20000, RATES[row['employee']]) for row in logs))
        retrofit = deepcopy(values)
        retrofit['date'] = DATE
        retrofit['commissionAgreementsByProject'] = {OTHER_PROJECT: terms()}
        result = denied(page, report, name, 'saveDailyBatch', retrofit, batch)
        report.check(name + ': changing dates cannot retrofit an existing source ID',
                     result['error']['code'] == 'COMMISSION_AGREEMENT_RETROFIT_FORBIDDEN', result)
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_invalid_terms(browser, server, report):
    name = 'policy-invalid-new-agreement-terms-write-nothing'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        changes = [
            ('unconfirmed', {'futureNewAgreementConfirmed': False}),
            ('pre-adoption', {'agreedDate': '2026-11-27'}),
            ('work-before-start', {'startDate': '2026-11-29'}),
            ('missing-reference', {'reference': ''}),
            ('missing-work-scope', {'workScope': ''}),
            ('missing-due-date', {'agreedDueDate': ''}),
            ('missing-payment-terms', {'paymentTerms': ''}),
        ]
        for label, patch in changes:
            values = daily_values(agreement=terms(**patch))
            denied(page, report, name + '-' + label, 'saveDailyBatch', values)
        rates = daily_values()
        rates['commissionRates'][EMPLOYEES[0]] = 31
        denied(page, report, name + '-pool-not-fifty', 'saveDailyBatch', rates)
        save_daily(page, report, name + '-valid-retry', daily_values())
        report.case(name)
    finally:
        context.close()


def run_frozen_terms(browser, server, report):
    name = 'policy-saved-participants-rates-and-terms-cannot-be-replaced'
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        values = daily_values()
        batch, _, agreements = save_daily(page, report, name, values)
        for label in ('rates', 'reference', 'remove'):
            altered = deepcopy(values)
            if label == 'rates':
                altered['commissionRates'] = {employee: 25 for employee in EMPLOYEES}
            elif label == 'reference':
                altered['commissionAgreementsByProject'][PROJECT]['reference'] += '-CHANGED'
            else:
                altered.pop('commissionAgreementsByProject')
            result = denied(page, report, name + '-' + label, 'saveDailyBatch', altered, batch)
            report.check(name + ': saved agreement cannot be retagged by ' + label,
                         result['error']['code'] == 'COMMISSION_AGREEMENT_IMMUTABLE', result)
        agreement = agreements[0]
        invoke(page, report, name, 'saveEmployee',
               {'name': EMPLOYEES[0], 'commissionRate': 10, 'status': '在職',
                'dailyRate': 1000, 'hourlyRate': 250}, EMPLOYEES[0])
        values = finalization_values([agreement['id']], [unbilled_allocation(agreement, 90000)])
        finalize(page, report, name, values, {agreement['id']: 90000})
        preserve_history(report, name, initial['idb']['main'], public(page),
                         {'employees': {EMPLOYEES[0]}})
        report.case(name)
    finally:
        context.close()


def run_billed_finalization(browser, server, report, rounding=False):
    name = 'policy-discounted-pretax-excludes-retention-cash-and-fees' + ('-rounding' if rounding else '')
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        original, final_base = (100001, 90002) if rounding else (100000, 90000)
        _, logs, agreements = save_daily(page, report, name, daily_values(amount=original))
        agreement = agreements[0]
        bill = bill_sources(page, report, name + '-BILL', [(logs[0], 0)], retention=12000)
        reduction = {'untaxed': original - final_base, 'tax': 500,
                     'grossTotal': original - final_base + 500, 'retention': 1200,
                     'receivable': original - final_base - 700}
        discount(page, report, name, bill['id'], reduction)
        invoke(page, report, name, 'addReceipt',
               {'receivableId': bill['receivableId'], 'date': DATE,
                'amount': 40000, 'cashAmount': 40000, 'collectionType': 'bank',
                'bankId': BANK, 'paymentMethod': '銀行轉帳', 'fee': 25,
                'feePayer': 'company', 'deductions': [], 'note': PREFIX + 'PARTIAL-CASH',
                'idempotencyKey': PREFIX + name + '-RECEIPT'})
        financial = invoke(page, report, name, 'billingFinancialState', bill['id'])
        report.check(name + ': witness distinguishes pretax gross retention receivable and actual bank cash',
                     financial['effective']['untaxed'] == final_base
                     and financial['effective']['retention'] == 10800
                     and financial['effective']['receivable'] == final_base + 4500 - 10800
                     and financial['settlement']['received'] == 40000
                     and any(row.get('receivableId') == bill['receivableId'] and row.get('actualCredit') == 39975
                             for row in public(page)['bankTransactions']))
        values = finalization_values([agreement['id']],
                    [{'billingId': bill['id'], 'scopeKey': agreement['scopeKey'], 'untaxedAmount': final_base}],
                    name)
        event, rows, request, after = finalize(page, report, name, values, {agreement['id']: final_base})
        release = [row for row in invoke(page, report, name, 'commissionReleasePool')
                   if row['commissionId'] in {item['id'] for item in rows}]
        report.check(name + ': new commission is payable by its agreed date despite customer balance',
                     len(release) == len(rows) == 2 and all(row['unlocked'] for row in release)
                     and financial['settlement']['outstanding'] > 0)
        repeated = call(page, 'finalizeCommissionAgreements', request)
        report.check(name + ': same operation replay never duplicates formal sources or a transaction',
                     repeated['ok'] and repeated['result']['id'] == event['id'] and raw(page) == after, repeated)
        changed = deepcopy(request)
        changed['reference'] += '-DIFFERENT'
        conflict = denied(page, report, name + '-idempotency-conflict', 'finalizeCommissionAgreements', changed)
        report.check(name + ': reused operation key with another intent is refused',
                     conflict['error']['code'] == 'COMMISSION_FINALIZATION_IDEMPOTENCY_CONFLICT')
        preserve_history(report, name, initial['idb']['main'], public(page), {'banks': {BANK}})
        report.case(name)
    finally:
        context.close()


def run_complete_matrix(browser, server, report):
    name = 'policy-complete-manual-matrix-mixed-legacy-and-split-bills'
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        _, a_logs, a = save_daily(page, report, name + '-A', daily_values(
            agreement=terms(workScope=PREFIX + 'GROUP-A'),
            lines=[line(amount=60000, name='A-FIRST'), line(amount=40000, house='A2', name='A-SECOND')]))
        _, b_logs, b = save_daily(page, report, name + '-B', daily_values(
            amount=30000, agreement=terms(workScope=PREFIX + 'GROUP-B')))
        _, old_logs, _ = save_daily(page, report, name + '-LEGACY', daily_values(False, amount=20000))
        legacy_commissions = [row for row in public(page)['commissions']
                              if row.get('sourceId') in {log['id'] for log in old_logs}]
        bill1 = bill_sources(page, report, name + '-ONE', [(a_logs[0], 0), (old_logs[0], 0)])
        bill2 = bill_sources(page, report, name + '-TWO', [(a_logs[0], 1), (b_logs[0], 0)])
        explicit = [legacy_payment_terms(row['id']) for row in legacy_commissions]
        discount(page, report, name + '-ONE', bill1['id'],
                 {'untaxed': 8000, 'tax': 400, 'grossTotal': 8400, 'retention': 0, 'receivable': 8400}, explicit)
        discount(page, report, name + '-TWO', bill2['id'],
                 {'untaxed': 7000, 'tax': 350, 'grossTotal': 7350, 'retention': 0, 'receivable': 7350})
        agreement_a, agreement_b = a[0], b[0]
        old_scope = 'daily:' + old_logs[0]['groupId']
        allocations = [
            {'billingId': bill1['id'], 'scopeKey': agreement_a['scopeKey'], 'untaxedAmount': 54000},
            {'billingId': bill1['id'], 'scopeKey': old_scope, 'untaxedAmount': 18000},
            {'billingId': bill2['id'], 'scopeKey': agreement_a['scopeKey'], 'untaxedAmount': 36000},
            {'billingId': bill2['id'], 'scopeKey': agreement_b['scopeKey'], 'untaxedAmount': 27000},
        ]
        values = finalization_values([agreement_a['id'], agreement_b['id']], allocations, 'MATRIX')
        empty = final_preview(page, report, name, {**values, 'allocations': []}, allowed=False)
        report.check(name + ': real context includes each whole bill scope including legacy remainder exactly once',
                     {(row['billingId'], row['scopeKey']) for row in empty['allocationRows']}
                     == {(row['billingId'], row['scopeKey']) for row in allocations}
                     and len(empty['allocationRows']) == 4)
        for variant in ('missing-legacy', 'duplicate', 'inflate-new-scope', 'whole-bill-per-group'):
            bad = deepcopy(values)
            if variant == 'missing-legacy':
                bad['allocations'].pop(1)
            elif variant == 'duplicate':
                bad['allocations'].append(deepcopy(bad['allocations'][0]))
            elif variant == 'inflate-new-scope':
                bad['allocations'][0]['untaxedAmount'] = 72000
                bad['allocations'][1]['untaxedAmount'] = 0
            else:
                bad['allocations'][2]['untaxedAmount'] = 63000
            final_preview(page, report, name + '-' + variant, bad, allowed=False)
            denied(page, report, name + '-' + variant, 'finalizeCommissionAgreements',
                   {**bad, 'expectedSnapshot': 'SYN-K30-POLICY-REJECT-INVALID-MATRIX'})
        finalize(page, report, name, values, {agreement_a['id']: 90000, agreement_b['id']: 27000})
        report.check(name + ': legacy earned commissions are not cut by the new matrix',
                     all(next(row for row in public(page)['commissions'] if row['id'] == prior['id']) == prior
                         for prior in legacy_commissions))
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_unbilled_due_and_later_billing(browser, server, report, future=False):
    name = 'policy-approved-unbilled-finalization-' + ('future-agreed-date' if future else 'due-without-customer-cash')
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        _, logs, agreements = save_daily(page, report, name,
            daily_values(agreement=terms(due_date='2099-12-31' if future else DATE)))
        agreement = agreements[0]
        allocation = unbilled_allocation(agreement, 90000)
        values = finalization_values([agreement['id']], [allocation], name)
        for variant in ('missing-approval', 'exceeds-original'):
            bad = deepcopy(values)
            if variant == 'missing-approval':
                bad['allocations'][0]['approvalReference'] = ''
            else:
                bad['allocations'][0]['untaxedAmount'] = 100001
            final_preview(page, report, name + '-' + variant, bad, allowed=False)
        _, rows, _, _ = finalize(page, report, name, values, {agreement['id']: 90000})
        selected = {row['id'] for row in rows}
        release = [row for row in invoke(page, report, name, 'commissionReleasePool') if row['commissionId'] in selected]
        report.check(name + ': actual payment eligibility follows the frozen due date without any invoice',
                     len(release) == 2 and all(row['unlocked'] is (not future) and not row['settled'] for row in release), release)
        payment_values = {'employeeId': EMPLOYEES[0], 'projectId': PROJECT,
                          'sourceCommissionIds': [row['id'] for row in rows if row['employee'] == EMPLOYEES[0]],
                          'date': DATE, 'bankId': BANK, 'fee': 25, 'feePayer': 'company',
                          'paymentMethod': '銀行轉帳', 'idempotencyKey': PREFIX + name + '-PAYMENT'}
        if future:
            denied(page, report, name + '-not-yet-due', 'addProjectCommissionSettlement', payment_values)
        else:
            before_payment = raw(page)
            settlement = invoke(page, report, name, 'addProjectCommissionSettlement', payment_values)
            coherent_commit(page, report, name, before_payment, 'addProjectCommissionSettlement')
            report.check(name + ': only an explicit payment writes the frozen amount and fee to the bank',
                         settlement['amount'] == 27000 and settlement['actualDebit'] == 27025)
        before_link = public(page)
        bill = bill_sources(page, report, name + '-LATER-BILL', [(logs[0], 0)])
        event = discount(page, report, name + '-LATER-ALLOWANCE', bill['id'],
                         {'untaxed': 10000, 'tax': 500, 'grossTotal': 10500, 'retention': 0, 'receivable': 10500})
        reverse_discount(page, report, name + '-LATER-REVERSAL', event)
        state = public(page)
        report.check(name + ': later billing discount and reversal never change already finalized wages or payment',
                     all(state[key] == before_link[key] for key in
                         ('commissions', 'payroll', 'salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
        refused = denied(page, report, name + '-no-second-finalization',
                         'finalizeCommissionAgreements', {**values, 'idempotencyKey': PREFIX + name + '-DUPLICATE'})
        report.check(name + ': a later invoice cannot make the same work eligible twice',
                     refused['error']['code'] == 'COMMISSION_ALREADY_FINALIZED')
        preserve_history(report, name, initial['idb']['main'], state,
                         {'banks': {BANK}} if not future else None)
        report.case(name)
    finally:
        context.close()


def run_manual(browser, server, report, linked=True):
    name = 'policy-manual-' + ('discounted-bill' if linked else 'approved-unbilled')
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        values = manual_values(billingIds=[MANUAL_BILL] if linked else [])
        before = raw(page)
        agreement = invoke(page, report, name, 'createCommissionAgreement', values)
        coherent_commit(page, report, name, before, 'createCommissionAgreement')
        report.check(name + ': creating an agreement writes no formal commission or payment',
                     all(public(page)[key] == before['idb']['main'][key] for key in
                         ('commissions', 'payroll', 'salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
        duplicate = deepcopy(values)
        duplicate['reference'] += '-OTHER-REFERENCE'
        denied(page, report, name + '-same-work-cannot-be-claimed-twice', 'createCommissionAgreement', duplicate)
        if linked:
            discount(page, report, name, MANUAL_BILL)
            allocation = {'billingId': MANUAL_BILL, 'scopeKey': agreement['scopeKey'], 'untaxedAmount': 90000}
        else:
            allocation = unbilled_allocation(agreement, 90000)
        finalize(page, report, name, finalization_values([agreement['id']], [allocation], name),
                 {agreement['id']: 90000})
        preserve_history(report, name, initial['idb']['main'], public(page))
        report.case(name)
    finally:
        context.close()


def run_manual_daily_conflict(browser, server, report):
    name = 'policy-manual-cannot-reclaim-known-daily-work'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        _, logs, _ = save_daily(page, report, name, daily_values())
        bill = bill_sources(page, report, name + '-BILL', [(logs[0], 0)])
        result = denied(page, report, name, 'createCommissionAgreement',
                        manual_values(billingIds=[bill['id']]))
        report.check(name + ': known daily billing sources cannot be claimed through manual agreement',
                     result['error']['code'] == 'COMMISSION_DUPLICATE_SOURCE_CLAIM', result)
        report.case(name)
    finally:
        context.close()


def run_legacy_terms(browser, server, report, paid=False):
    name = 'policy-explicit-legacy-payment-terms-preserve-' + ('paid' if paid else 'unpaid')
    context = browser.new_context(service_workers='block')
    try:
        page, initial = boot(context, server, report, name)
        commission_id, bill_id = (LEGACY_PAID, LEGACY_BILLS[0]) if paid else (LEGACY_UNPAID, LEGACY_BILLS[1])
        reduction = {'untaxed': 2000, 'tax': 100, 'grossTotal': 2100, 'retention': 105, 'receivable': 1995}
        values = allowance_values(bill_id, name, reduction)
        before = raw(page)
        preview = invoke(page, report, name, 'billingAllowancePreview', values)
        report.check(name + ': absence of explicit old payment terms blocks rather than guessing',
                     not preview['allowed'] and raw(page) == before
                     and any(row.get('code') in ('COMMISSION_PAYMENT_TERMS_REQUIRED', 'COMMISSION_POLICY_REVIEW')
                             for row in preview['blockers']), preview)
        old_gate = invoke(page, report, name, 'commissionReleasePool')
        event = discount(page, report, name, bill_id, reduction,
                         [legacy_payment_terms(commission_id)])
        saved_terms = deepcopy(public(page)['meta']['commissionPaymentTerms'])
        report.check(name + ': only an explicit confirmation appends immutable legacy terms',
                     len(saved_terms) == 1 and saved_terms[0]['commissionId'] == commission_id)
        reverse_discount(page, report, name + '-REVERSE', event)
        state = public(page)
        report.check(name + ': reverse keeps confirmed payment terms instead of silently reinstating another gate',
                     state['meta']['commissionPaymentTerms'] == saved_terms)
        report.check(name + ': every original earned amount and actual payment remains exact',
                     all(state[key] == initial['idb']['main'][key] for key in
                         ('commissions', 'payroll', 'salaryPayments', 'commissionSettlements', 'banks', 'bankTransactions')))
        new_gate = invoke(page, report, name, 'commissionReleasePool')
        report.check(name + ': unrelated old payment gates remain unchanged',
                     [r for r in new_gate if r['commissionId'] != commission_id]
                     == [r for r in old_gate if r['commissionId'] != commission_id])
        preserve_history(report, name, initial['idb']['main'], state)
        report.case(name)
    finally:
        context.close()


def run_stale_finalization(browser, server, report):
    name = 'policy-stale-finalization-rejects-a-changed-allowance-history'
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        _, logs, agreements = save_daily(page, report, name, daily_values())
        agreement = agreements[0]
        bill = bill_sources(page, report, name + '-BILL', [(logs[0], 0)])
        values = finalization_values([agreement['id']],
                   [{'billingId': bill['id'], 'scopeKey': agreement['scopeKey'], 'untaxedAmount': 100000}], name)
        preview = final_preview(page, report, name, values, allowed=True)
        event = discount(page, report, name, bill['id'],
                         {'untaxed': 10000, 'tax': 500, 'grossTotal': 10500, 'retention': 0, 'receivable': 10500})
        reverse_discount(page, report, name + '-REVERSE', event)
        refused = denied(page, report, name, 'finalizeCommissionAgreements',
                         {**values, 'expectedSnapshot': preview['snapshot']})
        report.check(name + ': equal final money cannot hide a changed source history',
                     refused['error']['code'] == 'COMMISSION_FINALIZATION_STALE_SNAPSHOT', refused)
        finalize(page, report, name + '-fresh', values, {agreement['id']: 100000})
        report.case(name)
    finally:
        context.close()


def run_finalization_guards(browser, server, report, late=False):
    name = 'policy-finalization-' + ('late-principal-change' if late else 'mirror-failure-rollback')
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name)
        agreement = invoke(page, report, name, 'createCommissionAgreement', manual_values())
        values = finalization_values([agreement['id']], [unbilled_allocation(agreement, 90000)], name)
        plan = final_preview(page, report, name, values, allowed=True)
        request = {**values, 'expectedSnapshot': plan['snapshot']}
        before = raw(page)
        if late:
            page.evaluate("""()=>{const original=navigator.storage.estimate.bind(navigator.storage);
              window.__policyFaultCount=0;window.__policyRestore=()=>{navigator.storage.estimate=original};
              navigator.storage.estimate=async()=>{const answer=await original();__policyFaultCount++;
                __k28Auth.principal='SYN-K30-POLICY-DIFFERENT-PRINCIPAL';return answer}}""")
        else:
            page.evaluate("""key=>{const original=Storage.prototype.setItem;window.__policyFaultCount=0;
              window.__policyRestore=()=>{Storage.prototype.setItem=original};
              Storage.prototype.setItem=function(k,v){if(this===localStorage&&k===key&&!__policyFaultCount++){
                throw Object.assign(new Error('SYN-K30-POLICY injected mirror failure'),{code:'POLICY_TEST_MIRROR_FAILURE'})}
                return original.call(this,k,v)}}""", EMERGENCY)
        try:
            result = call(page, 'finalizeCommissionAgreements', request)
        finally:
            page.evaluate('()=>__policyRestore()')
        report.check(name + ': the intended asynchronous or persistent boundary was reached',
                     page.evaluate('()=>__policyFaultCount') >= 1)
        report.check(name + ': guarded finalization refuses success', not result['ok'], result)
        unchanged(report, name, page, before)
        report.check(name + ': no agreement finalization commission payroll or bank fragment leaked',
                     public(page) == before['idb']['main'])
        report.case(name)
    finally:
        context.close()


def run_backup_reload(browser, server, report):
    name = 'policy-real-backup-reload-and-tampered-finalization-refusal'
    context = browser.new_context(service_workers='block', accept_downloads=True)
    try:
        page, _ = boot(context, server, report, name)
        _, _, agreements = save_daily(page, report, name, daily_values())
        agreement = agreements[0]
        event, rows, _, _ = finalize(page, report, name,
            finalization_values([agreement['id']], [unbilled_allocation(agreement, 90000)], name),
            {agreement['id']: 90000})
        page.add_script_tag(url=server.origin + '/assets/js/settings.js')
        page.evaluate('()=>KusheSettings.activate()')
        before_export = raw(page)
        with page.expect_download() as pending:
            page.locator('#settingsBackup').click()
        destination = report.output / (PREFIX + 'POLICY-SYNTHETIC-BACKUP.json')
        pending.value.save_as(str(destination))
        backup = json.loads(destination.read_text(encoding='utf-8'))
        report.check(name + ': actual settings backup contains exact agreements finalization and earned rows',
                     backup['meta']['commissionFinalizations'] == [event]
                     and all(next(r for r in backup['commissions'] if r['id'] == row['id']) == row for row in rows)
                     and raw(page) == before_export)
    finally:
        context.close()
    context = browser.new_context(service_workers='block')
    try:
        page, _ = boot(context, server, report, name + '-restore')
        committed = invoke(page, report, name, 'readCommittedSnapshot')
        malformed = deepcopy(backup)
        malformed['meta']['commissionFinalizations'][0]['results'][0]['base'] += 1
        denied(page, report, name + '-forged-base', 'replaceSnapshot', malformed,
               {'confirmed': True, 'baseline': committed['baseline']})
        invoke(page, report, name, 'replaceSnapshot', backup,
               {'confirmed': True, 'baseline': committed['baseline']})
        restored = raw(page)
        page.reload()
        page.add_script_tag(url=server.origin + '/assets/js/erp-store.js')
        invoke(page, report, name, 'load')
        report.check(name + ': actual reload retains the exact restored durable state',
                     raw(page) == restored and public(page) == restored['idb']['main'])
        report.check(name + ': restored agreement resolves its original frozen amount',
                     next(row for row in scopes(page, report, name) if row['id'] == agreement['id'])['finalBase'] == 90000)
        current = invoke(page, report, name, 'readCommittedSnapshot')
        removed = deepcopy(current['data'])
        removed['meta']['commissionFinalizations'] = []
        denied(page, report, name + '-cannot-erase-history', 'replaceSnapshot', removed,
               {'confirmed': True, 'baseline': current['baseline']})
        report.case(name)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    source = (root / 'assets/js/erp-store.js').read_bytes()
    baseline = subprocess.check_output(['git', 'show', BASE + ':assets/js/erp-store.js'], cwd=root)
    report = Report(args.output.resolve())
    report.data.update(headCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
                       source={'sha256': hashlib.sha256(source).hexdigest(), 'bytes': len(source)})
    try:
        server = Server(source, root, extra=['assets/js/settings.js'])
        server.resources['/fixture.html'] = (HTML.encode('utf-8'), 'text/html; charset=utf-8')
        with server, sync_playwright() as playwright:
            executable = select_browser(args.browser)
            report.data['browserExecutable'] = executable or 'Playwright managed Chromium'
            browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            try:
                tasks = [
                    (run_upgrade, (baseline,)), (run_daily_selection, ()), (run_backfill, ()),
                    (run_invalid_terms, ()), (run_frozen_terms, ()),
                    (run_billed_finalization, (False,)), (run_billed_finalization, (True,)),
                    (run_complete_matrix, ()), (run_unbilled_due_and_later_billing, (False,)),
                    (run_unbilled_due_and_later_billing, (True,)),
                    (run_manual, (True,)), (run_manual, (False,)), (run_manual_daily_conflict, ()),
                    (run_legacy_terms, (False,)), (run_legacy_terms, (True,)),
                    (run_stale_finalization, ()), (run_finalization_guards, (False,)),
                    (run_finalization_guards, (True,)), (run_backup_reload, ()),
                ]
                for function, arguments in tasks:
                    try:
                        print('RUN', function.__name__, flush=True)
                        function(browser, server, report, *arguments)
                    except Exception as error:
                        report.data['failures'].append({'case': function.__name__,
                            'arguments': [str(x) for x in arguments if not isinstance(x, bytes)],
                            'message': str(error), 'traceback': traceback.format_exc()})
                        report.flush()
                        traceback.print_exc()
            finally:
                browser.close()
        report.check('all policy browser requests stayed in the exact owned loopback allowlist',
                     not report.data['externalRequests'], report.data['externalRequests'])
        report.check('no unhandled policy page errors', not report.data['pageErrors'], report.data['pageErrors'])
        report.data['status'] = 'BLOCKED' if report.data['failures'] or any(not row['passed'] for row in report.data['checks']) else 'K30_POLICY_STORE_PASS'
        return 0 if report.data['status'] == 'K30_POLICY_STORE_PASS' else 1
    except Exception as error:
        report.data['status'] = 'BLOCKED'
        report.data['failures'].append({'message': str(error), 'traceback': traceback.format_exc()})
        return 1
    finally:
        report.flush()
        print(json.dumps({key: report.data[key] for key in ('status', 'passCount', 'failCount', 'failures')},
                         ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
