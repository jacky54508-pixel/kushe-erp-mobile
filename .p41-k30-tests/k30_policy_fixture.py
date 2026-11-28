"""Synthetic prospective commission agreements; no user exports or hosted data."""
from copy import deepcopy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.p41-k29-tests'))
from commission_fixture import fixture as old_manual_fixture
from k30_fixture import (HTML as ALLOWANCE_HTML, fixture as allowance_fixture,
                         output_invoice, OWNER, CUSTOMER, BANK)

PREFIX = 'SYN-K30-POLICY-'
POLICY = 'discounted-pretax-v1'
DATE = '2026-11-28'
STAMP = DATE + 'T02:03:04.000Z'
OLD_DATE = '2026-10-15'
EMPLOYEES = [PREFIX + 'EMPLOYEE-A', PREFIX + 'EMPLOYEE-B']
PROJECT = PREFIX + 'EXISTING-PROJECT'
OTHER_PROJECT = PREFIX + 'NEW-PROJECT'
LEGACY_PREFIX = PREFIX + 'LEGACY-'
LEGACY_PAID = LEGACY_PREFIX + 'OLD'
LEGACY_UNPAID = LEGACY_PREFIX + 'UNPAID'
LEGACY_BILLS = [LEGACY_PREFIX + 'BILL-A', LEGACY_PREFIX + 'BILL-B']
MANUAL_BILL = PREFIX + 'MANUAL-BILL'
RATES = dict(zip(EMPLOYEES, (30, 20)))

HTML = ALLOWANCE_HTML.replace('billing-allowances-v1', 'billing-allowances-v2')
HTML = HTML.replace('<main class="page-frame">', '''<main class="page-frame">
<section class="view" id="commissionsView"><div id="commissionsApp"></div></section>
<section class="view" id="projectsView"><div id="projectsApp"></div></section>
<section class="view" id="payrollView"><div id="payrollApp"></div></section>
<section class="view" id="dashboardView"><div id="dashboardApp"></div></section>''')


def renamed_manual(value):
    if isinstance(value, str):
        return value.replace('SYN-K29-COMMISSION-', LEGACY_PREFIX)
    if isinstance(value, list):
        return [renamed_manual(row) for row in value]
    if isinstance(value, dict):
        return {key: renamed_manual(item) for key, item in value.items()}
    return value


def fixture():
    state = allowance_fixture()
    state['meta']['k30PolicySynthetic'] = True
    for index, employee in enumerate(EMPLOYEES):
        state['employees'].append({'id': employee, 'name': employee,
                                  'commissionRate': (30, 20)[index],
                                  'commissionBasis': 'preTax', 'status': '在職',
                                  'dailyRate': 1000, 'hourlyRate': 250})
    for index, project in enumerate((PROJECT, OTHER_PROJECT)):
        state['projects'].append({'id': project, 'name': project,
                                 'customer': CUSTOMER, 'status': '進行中',
                                 'defaultPricingMode': 'actual',
                                 'createdAt': '2025-01-01T00:00:00.000Z' if index == 0 else STAMP})

    # Existing paid and unpaid manual commissions deliberately precede the new
    # policy, including a non-formula amount that must never be recomputed.
    legacy = renamed_manual(old_manual_fixture('paid'))
    for key, rows in legacy.items():
        if isinstance(rows, list):
            state.setdefault(key, []).extend(rows)
    old = deepcopy(legacy['commissions'][0])
    old.update(id=LEGACY_UNPAID, employee=LEGACY_PREFIX + 'EMPLOYEE-B',
               sourceId=LEGACY_BILLS[1], billingId=LEGACY_BILLS[1],
               sourceNo=LEGACY_BILLS[1] + '-NO', untaxedAmount=8000,
               commission=1777, note=PREFIX + 'PRESERVE-AGREED-UNPAID')
    state['commissions'].append(old)
    payroll = deepcopy(legacy['payroll'][0])
    payroll.update(id=LEGACY_PREFIX + 'UNPAID-PAYROLL', employee=old['employee'],
                   commission=1777, total=1777, status='未付款', paidAmount=0,
                   payDate='', bankId='', paymentTransactionId='', paidAt='')
    state['payroll'].append(payroll)
    for bill in legacy['billings']:
        bill = next(row for row in state['billings'] if row['id'] == bill['id'])
        bill.update(invoiceNo='', invoiceDate='')
        invoice = output_invoice(bill)
        invoice.update(status='pending', invoiceDate='', date='')
        state['invoices'].append(invoice)
    template = next(row for row in state['billings'] if row['id'] == 'SYN-K30-BILL-A')
    bill = deepcopy(template)
    bill.update(id=MANUAL_BILL, number=MANUAL_BILL + '-NO', date=DATE,
                project=PROJECT, projectName=PROJECT, receivableId=MANUAL_BILL + '-AR',
                retention=12000, retentionAmount=12000, total=93000,
                remainingRetention=12000, retentionReceived=0,
                status='未收款', createdAt=STAMP, updatedAt=STAMP)
    bill['lines'][0].update(id=MANUAL_BILL + '-LINE', item=PREFIX + 'INDEPENDENT-MANUAL-WORK')
    ar = deepcopy(next(row for row in state['receivables'] if row['id'] == template['receivableId']))
    ar.update(id=bill['receivableId'], billingId=MANUAL_BILL, sourceNo=bill['number'],
              date=DATE, project=PROJECT, projectName=PROJECT,
              amount=93000, retention=12000, retentionAmount=12000,
              remainingRetention=12000, received=0, legacyReceived=0,
              status='未收', createdAt=STAMP, updatedAt=STAMP)
    invoice = output_invoice(bill)
    invoice.update(status='pending', invoiceDate='', date='')
    state['billings'].append(bill)
    state['receivables'].append(ar)
    state['invoices'].append(invoice)
    return state


def terms(due_date=DATE, **changes):
    result = {'policy': POLICY, 'futureNewAgreementConfirmed': True,
              'workScope': PREFIX + 'NEW-AGREED-WORK', 'agreedDate': DATE,
              'startDate': DATE, 'reference': PREFIX + 'SIGNED-AGREEMENT',
              'agreedDueDate': due_date,
              'paymentTerms': PREFIX + 'PAYABLE-ON-AGREED-DATE-INDEPENDENT-OF-CUSTOMER-CASH'}
    result.update(changes)
    return result


def line(project=PROJECT, amount=100000, house='A1', name='WORK'):
    return {'project': project, 'house': PREFIX + house,
            'item': PREFIX + name, 'itemName': PREFIX + name, 'unit': '式',
            'qty': '1', 'inputPrice': amount, 'unitPrice': amount,
            'taxMode': '未稅', 'sourceType': 'manual', 'pricingType': 'actual',
            'billable': True, 'workItemId': ''}


def daily_values(agreed=True, project=PROJECT, amount=100000, date=DATE,
                 agreement=None, lines=None):
    values = {'date': date, 'employeeIds': list(EMPLOYEES),
              'commissionRates': dict(RATES),
              'commissionBases': {employee: 'preTax' for employee in EMPLOYEES},
              'workRates': {employee: 1000 for employee in EMPLOYEES},
              'lines': deepcopy(lines) if lines is not None else [line(project, amount)],
              'workOnly': False, 'commissionEnabled': True, 'workMode': 'none',
              'workQty': 0, 'note': PREFIX + ('NEW-AGREEMENT' if agreed else 'LEGACY-BACKFILL')}
    if agreed:
        values['commissionAgreementsByProject'] = {project: deepcopy(agreement or terms())}
    return values


def manual_values(project=PROJECT, amount=100000, due_date=DATE, **changes):
    result = {'kind': 'manual', 'projectId': project, 'workDate': DATE,
              'originalUntaxedAmount': amount, 'billingIds': [],
              'participants': [{'employeeId': employee, 'rate': RATES[employee]}
                               for employee in EMPLOYEES],
              **terms(due_date), 'confirmed': True}
    result.update(changes)
    return result


def finalization_values(agreement_ids, allocations=None, key='FINAL'):
    return {'agreementIds': list(agreement_ids), 'date': DATE,
            'reference': PREFIX + key + '-APPROVAL', 'reason': PREFIX + 'FINAL-AGREED-NET',
            'allocations': deepcopy(allocations or []),
            'idempotencyKey': PREFIX + key + '-KEY', 'confirmed': True,
            'finalAmountsApproved': True}


def allowance_values(billing_id, key='ALLOWANCE', reduction=None, legacy_terms=None):
    result = {'scope': 'billing', 'billingId': billing_id, 'date': DATE,
              'reason': PREFIX + 'CUSTOMER-NEGOTIATED-DISCOUNT',
              'reference': PREFIX + key + '-REFERENCE',
              'allocations': [{'billingId': billing_id,
                               'reductions': reduction or {'untaxed': 10000, 'tax': 500,
                                                          'grossTotal': 10500, 'retention': 1200,
                                                          'receivable': 9300}}],
              'invoiceEvidence': [], 'idempotencyKey': PREFIX + key + '-KEY',
              'confirmed': True}
    result['approvedGrossReduction'] = result['allocations'][0]['reductions']['grossTotal']
    if legacy_terms is not None:
        result['legacyPaymentTerms'] = deepcopy(legacy_terms)
    return result


def legacy_payment_terms(commission_id, mode='agreed-date', due_date=DATE):
    return {'commissionId': commission_id, 'mode': mode, 'agreedDueDate': due_date,
            'reference': PREFIX + 'EXPLICIT-LEGACY-PAYMENT-AGREEMENT', 'confirmed': True}
