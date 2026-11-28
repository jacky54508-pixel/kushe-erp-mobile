"""Public-safe, wholly synthetic K30 sources; never imports a user backup."""
from copy import deepcopy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.p41-k28-tests'))
from k28_browser_store import HTML as K28_HTML
from k28_fixture import fixture as historical_fixture

PREFIX = 'SYN-K30-'
OWNER = PREFIX + 'OWNER'
CUSTOMER = PREFIX + 'CUSTOMER'
BANK = PREFIX + 'BANK'
EMPLOYEE = PREFIX + 'EMPLOYEE'
IDS = [PREFIX + 'BILL-' + c for c in 'ABC']
ARS = [bid + '-AR' for bid in IDS]
LEGACY_AR = PREFIX + 'LEGACY-STANDALONE-AR'
LEGACY_BILL = PREFIX + 'LEGACY-MISSING-INVOICE-BILL'
LEGACY_BILL_AR = LEGACY_BILL + '-AR'
DATE = '2026-10-20'
STAMP = '2026-10-20T02:03:04.000Z'
FIELDS = ('untaxed', 'tax', 'grossTotal', 'retention', 'receivable')
ORIGINALS = [dict(zip(FIELDS, row)) for row in (
    (100000, 5000, 105000, 5000, 100000),
    (80000, 4000, 84000, 4000, 80000),
    (20000, 0, 20000, 2000, 18000),
)]
REDUCTIONS = [dict(zip(FIELDS, row)) for row in (
    (10000, 500, 10500, 500, 10000),
    (8000, 400, 8400, 400, 8000),
    (2000, 0, 2000, 200, 1800),
)]

# Keep K28's proven capture/call names so its reusable raw()/call() functions
# observe the same real IndexedDB and mirror layers. The fixture guard and all
# authentication identifiers are K30-specific.
HTML = K28_HTML.replace('SYN-K28', PREFIX.rstrip('-')).replace('k28Synthetic', 'k30Synthetic')
HTML = HTML.replace('<div id="commissionsApp"></div>', '''
<meta name="viewport" content="width=device-width,initial-scale=1">
<main class="page-frame"><section class="view" id="billingsView"><div id="billingsApp"></div></section><section class="view" id="receivablesView"><div id="receivablesApp"></div></section><div id="settingsApp"></div></main>''')
HTML = HTML.replace("'use strict';", """'use strict';
window.__k30CloudReady={ready:true,reason:'SYN-K30 explicit isolated capability fixture',capability:'billing-allowances-v1'};
window.KusheCloudSync={billingAllowanceWriteReadiness:()=>({...__k30CloudReady}),prepareBillingAllowanceWrite:async()=>({...__k30CloudReady}),deviceSecurityStatus:()=>({trusted:true,mode:'trusted'}),subscribe:()=>()=>{}};
window.__k30Toasts=[];window.KushePhase1={toast:m=>__k30Toasts.push(String(m)),navigate(){}};
window.KusheKpi={register(){}};window.KusheIcons={render(){}};
document.body.dataset.route='receivables';
""")


def rename_history(value):
    if isinstance(value, str):
        return value.replace('SYN-K28-', PREFIX + 'HISTORY-')
    if isinstance(value, list):
        return [rename_history(item) for item in value]
    if isinstance(value, dict):
        return {key: rename_history(item) for key, item in value.items()}
    return value


def output_invoice(billing):
    return {
        'id': billing['id'] + '-INVOICE', 'invoiceId': billing['id'] + '-INVOICE',
        'invoiceType': 'output', 'type': '銷項', 'sourceType': 'billing',
        'sourceId': billing['id'], 'billingId': billing['id'], 'sourceNo': billing['number'],
        'status': 'issued', 'invoiceNumber': billing['invoiceNo'], 'number': billing['invoiceNo'],
        'invoiceDate': billing['invoiceDate'], 'date': billing['invoiceDate'],
        'customerId': billing['customer'], 'customer': billing['customer'],
        'projectId': billing['project'], 'project': billing['project'],
        'taxMode': billing['taxMode'], 'netAmount': billing['preTaxAmount'],
        'amount': billing['preTaxAmount'], 'taxAmount': billing['taxAmount'],
        'tax': billing['taxAmount'], 'grossAmount': billing['grossTotal'],
        'total': billing['grossTotal'], 'note': PREFIX + 'ORIGINAL-INVOICE',
        'createdAt': STAMP, 'updatedAt': STAMP,
    }


def add_income(state, index, amount, retention=False):
    """Seed an internally linked historical receipt and its real bank credit."""
    bid, arid = IDS[index], ARS[index]
    rid = bid + ('-RETENTION-OLD' if retention else '-RECEIPT-OLD')
    txid = rid + '-BANK'
    fee = 3 if retention else 17
    row = {
        'id': rid, 'receivableId': arid, 'billingId': bid, 'date': '2026-10-19',
        'amount': amount, 'fee': fee, 'feePayer': 'company', 'netAmount': amount - fee,
        'bankId': BANK, 'bankAccountId': BANK, 'bankTransactionId': txid,
        'paymentMethod': '銀行轉帳', 'note': PREFIX + 'EXISTING-REAL-LINKED-INCOME',
        'createdAt': STAMP, 'updatedAt': STAMP,
    }
    if retention:
        row.update(retentionReceiptId=rid, projectId=PREFIX + 'PROJECT-' + 'ABC'[index], customerId=CUSTOMER)
        state['retentionReceipts'].append(row)
    else:
        row.update(cashAmount=amount, settlementAmount=amount, deductionAmount=0,
                   deductions=[], collectionType='bank')
        state['receipts'].append(row)
    tx = {
        'id': txid, 'bankId': BANK, 'bankAccountId': BANK,
        'sourceType': 'retention_receipt' if retention else 'receipt', 'sourceId': rid,
        'receivableId': arid, 'billingId': bid, 'sourceNo': PREFIX + 'NO-' + 'ABC'[index],
        'date': row['date'], 'type': '收入', 'direction': 'in', 'amount': amount - fee,
        'actualCredit': amount - fee, 'netAmount': amount - fee, 'receiptAmount': amount,
        'fee': fee, 'feePayer': 'company', 'createdAt': STAMP, 'updatedAt': STAMP,
    }
    tx['retentionReceiptId' if retention else 'receiptId'] = rid
    state['bankTransactions'].append(tx)
    bank = next(item for item in state['banks'] if item['id'] == BANK)
    bank['income'] += amount - fee
    bank['balance'] += amount - fee
    bill = next(item for item in state['billings'] if item['id'] == bid)
    ar = next(item for item in state['receivables'] if item['id'] == arid)
    if retention:
        for target in (bill, ar):
            target.update(retentionReceived=amount, remainingRetention=target['retentionAmount'] - amount,
                          retentionStatus='partial_retention')
    else:
        ar.update(received=amount, status='部分收款')
        bill['status'] = '部分收款'


def fixture(kind='standard'):
    state = rename_history(historical_fixture('partial'))
    state['meta'].pop('k28Synthetic', None)
    state['meta'].update(k30Synthetic=True, updatedAt=STAMP)
    state['settings']['company'] = PREFIX + 'COMPANY'
    history_bill = state['billings'][0]
    history_bill.update(invoiceStatus='invoiced', invoiceNo=PREFIX + 'HISTORY-INVOICE-NO', invoiceDate='2026-04-08')
    state['receivables'][0].update(invoiceStatus='invoiced', invoiceNo=history_bill['invoiceNo'])
    state['invoices'].append(output_invoice(history_bill))
    state['customers'].append({'id': CUSTOMER, 'name': PREFIX + '合成客戶', 'note': PREFIX + 'ORIGINAL-CUSTOMER'})
    state['employees'].append({'id': EMPLOYEE, 'name': EMPLOYEE, 'status': '在職', 'commissionRate': 25, 'commissionBasis': 'preTax'})
    state['banks'].append({'id': BANK, 'name': BANK, 'openingBalance': 500000, 'income': 0, 'expense': 0, 'balance': 500000})
    for i, amounts in enumerate(ORIGINALS):
        project = PREFIX + 'PROJECT-' + 'ABC'[i]
        state['projects'].append({'id': project, 'name': project, 'customer': CUSTOMER, 'customerName': PREFIX + '合成客戶', 'status': '進行中'})
        invoice_status = 'no_invoice' if i == 2 else 'invoice_pending'
        bill = {
            'id': IDS[i], 'number': PREFIX + 'NO-' + 'ABC'[i], 'date': '2026-10-1' + str(i + 1),
            'sourceType': 'manual', 'customer': CUSTOMER, 'customerName': PREFIX + '合成客戶',
            'project': project, 'projectName': project, 'taxMode': '未稅',
            'invoiceStatus': invoice_status, 'hasInvoice': invoice_status != 'no_invoice',
            'invoiceNo': '', 'invoiceDate': '', 'amount': amounts['untaxed'], 'preTaxAmount': amounts['untaxed'],
            'tax': amounts['tax'], 'taxAmount': amounts['tax'], 'grossTotal': amounts['grossTotal'],
            'taxIncludedAmount': amounts['grossTotal'], 'total': amounts['receivable'],
            'retention': amounts['retention'], 'retentionAmount': amounts['retention'],
            'retentionMode': 'custom', 'retentionRate': 0, 'retentionBase': 'preTax',
            'retentionEnabled': True, 'retentionReceived': 0, 'remainingRetention': amounts['retention'],
            'retentionStatus': 'unreceived', 'receivableId': ARS[i], 'status': '未收款',
            'sourceItemRefs': [], 'sourceContractRefs': [], 'createdAt': STAMP, 'updatedAt': STAMP,
            'note': PREFIX + 'ORIGINAL-BILL-TEXT',
            'lines': [{'id': IDS[i] + '-LINE', 'house': 'A1', 'item': PREFIX + 'ORIGINAL-WORK-' + 'ABC'[i],
                       'itemName': PREFIX + 'ORIGINAL-WORK-' + 'ABC'[i], 'unit': '式', 'qty': 1,
                       'price': amounts['untaxed'], 'subtotal': amounts['untaxed'], 'amount': amounts['untaxed'], 'taxMode': '未稅'}],
        }
        ar = {
            'id': ARS[i], 'billingId': IDS[i], 'sourceNo': bill['number'], 'date': bill['date'],
            'customer': CUSTOMER, 'customerName': bill['customerName'], 'project': project, 'projectName': project,
            'amount': amounts['receivable'], 'untaxedAmount': amounts['untaxed'], 'preTaxAmount': amounts['untaxed'],
            'tax': amounts['tax'], 'taxAmount': amounts['tax'], 'taxIncludedAmount': amounts['grossTotal'],
            'grossTotal': amounts['grossTotal'], 'retention': amounts['retention'], 'retentionAmount': amounts['retention'],
            'retentionRate': 0, 'retentionBase': 'preTax', 'retentionEnabled': True,
            'retentionReceived': 0, 'legacyRetentionReceived': 0, 'remainingRetention': amounts['retention'],
            'retentionStatus': 'unreceived', 'received': 0, 'legacyReceived': 0, 'status': '未收',
            'invoiceNo': '', 'invoiceStatus': invoice_status, 'taxMode': '未稅', 'receivableCheques': [],
            'createdAt': STAMP, 'updatedAt': STAMP,
        }
        state['billings'].append(bill)
        state['receivables'].append(ar)
        if invoice_status != 'no_invoice':
            pending = output_invoice(bill)
            pending.update(status='pending', invoiceDate='', date='', note=PREFIX + 'ORIGINAL-PENDING-INVOICE')
            state['invoices'].append(pending)
    add_income(state, 0, 40000)
    add_income(state, 1, 1000, retention=True)
    if kind == 'issued':
        bill = next(item for item in state['billings'] if item['id'] == IDS[0])
        bill.update(invoiceStatus='invoiced', invoiceNo=PREFIX + 'INVOICE-A', invoiceDate='2026-10-18')
        next(item for item in state['receivables'] if item['id'] == ARS[0]).update(invoiceStatus='invoiced', invoiceNo=bill['invoiceNo'])
        state['invoices'] = [output_invoice(bill) if row['id'] == bill['id'] + '-INVOICE' else row for row in state['invoices']]
    elif kind == 'linked-commission':
        state['commissions'].append({'id': PREFIX + 'TARGET-COMMISSION', 'date': '2026-10-13',
            'employee': EMPLOYEE, 'employeeName': EMPLOYEE, 'project': PREFIX + 'PROJECT-A',
            'sourceType': 'billing', 'sourceId': IDS[0], 'billingId': IDS[0], 'sourceNo': PREFIX + 'NO-A',
            'untaxedAmount': 100000, 'rate': 25, 'commission': 25000, 'status': '未列入薪資', 'note': PREFIX + 'PRESERVE'})
    elif kind == 'duplicate-ar':
        row = deepcopy(next(item for item in state['receivables'] if item['id'] == ARS[0]))
        row['id'] += '-DUPLICATE'
        state['receivables'].append(row)
    elif kind == 'malformed-ledger':
        state['meta']['billingAllowances'] = {'unexpected': PREFIX + 'INVALID'}
    elif kind == 'conflicting-alias':
        next(item for item in state['billings'] if item['id'] == IDS[0])['preTaxAmount'] += 1
    elif kind == 'legacy-received':
        next(item for item in state['receivables'] if item['id'] == ARS[0]).update(received=41000, legacyReceived=1000)
    elif kind == 'tax-rate-changed':
        state['settings']['defaultTax'] = 10
    elif kind == 'legacy-consumers':
        project = PREFIX + 'LEGACY-PROJECT'
        state['projects'].append({'id': project, 'name': project, 'customer': CUSTOMER, 'customerName': PREFIX + '合成客戶'})
        state['receivables'].append({'id': LEGACY_AR, 'sourceNo': PREFIX + 'LEGACY-STANDALONE-NO',
            'date': '2026-10-15', 'customer': CUSTOMER, 'customerName': PREFIX + '合成客戶',
            'project': project, 'projectName': project, 'amount': 10000, 'received': 2500,
            'legacyReceived': 2500, 'retention': 0, 'retentionAmount': 0, 'retentionReceived': 0,
            'legacyRetentionReceived': 0, 'receivableCheques': [], 'status': '部分收款',
            'createdAt': STAMP, 'updatedAt': STAMP})
        old_bill = deepcopy(next(row for row in state['billings'] if row['id'] == IDS[0]))
        old_bill.update(id=LEGACY_BILL, number=PREFIX + 'LEGACY-MISSING-INVOICE-NO', receivableId=LEGACY_BILL_AR,
            project=project, projectName=project, invoiceStatus='invoiced', hasInvoice=True,
            invoiceNo=PREFIX + 'LEGACY-ISSUED-VOUCHER', invoiceDate='2026-10-16')
        old_bill['lines'][0]['id'] = LEGACY_BILL + '-LINE'
        old_ar = deepcopy(next(row for row in state['receivables'] if row['id'] == ARS[0]))
        old_ar.update(id=LEGACY_BILL_AR, billingId=LEGACY_BILL, sourceNo=old_bill['number'],
            project=project, projectName=project, received=40000, legacyReceived=40000,
            invoiceStatus='invoiced', invoiceNo=old_bill['invoiceNo'], invoiceDate=old_bill['invoiceDate'])
        state['billings'].append(old_bill)
        state['receivables'].append(old_ar)
        # Deliberately no invoice row: existing ordinary K29 receipt consumers
        # accept this saved legacy source, while formal allowance admission must
        # still require its complete original invoice evidence.
    return state


def allowance_input(index=0, *, group_id='', reductions=None, issued=False, key='POST'):
    indices = (0, 1) if group_id else (index,)
    rows = [{'billingId': IDS[i], 'reductions': deepcopy(reductions if reductions is not None else REDUCTIONS[i])} for i in indices]
    result = {'scope': 'external-document' if group_id else 'billing', 'date': DATE,
              'reason': PREFIX + 'SYNTHETIC-NEGOTIATED-ALLOWANCE', 'reference': PREFIX + 'AGREEMENT-' + key,
              'approvedGrossReduction': sum(row['reductions']['grossTotal'] for row in rows),
              'allocations': rows, 'invoiceEvidence': [], 'idempotencyKey': PREFIX + key, 'confirmed': True}
    result['externalDocumentId' if group_id else 'billingId'] = group_id or IDS[index]
    if issued:
        result['invoiceEvidence'] = [{'invoiceId': IDS[0] + '-INVOICE', 'voucherReference': PREFIX + 'VOUCHER-' + key,
                                      'voucherDate': DATE, 'verified': True}]
    return result


def reversal_input(event_id, key='REVERSE', invoice_id=''):
    result = {'reverseOf': event_id, 'date': DATE, 'reason': PREFIX + 'SYNTHETIC-REVERSAL',
              'reference': PREFIX + 'REVERSAL-AGREEMENT', 'invoiceEvidence': [],
              'idempotencyKey': PREFIX + key, 'confirmed': True}
    if invoice_id:
        result['invoiceEvidence'] = [{'invoiceId': invoice_id, 'voucherReference': PREFIX + 'REVERSE-VOUCHER',
                                      'voucherDate': DATE, 'verified': True}]
    return result


GROUP_SETUP = r'''async()=>{
 const s=KuSheERPStore,ids=['SYN-K30-BILL-A','SYN-K30-BILL-B'];
 const context=s.externalBillingContext(ids);
 const values={sourceIds:ids,targetBillingId:ids[0],documentDate:'2026-10-20',status:'active',confirmed:true,
  detailMode:'unified',unified:{taxMode:'未稅',reason:'SYN-K30 synthetic merged display',lines:context.sources.flatMap(x=>x.document.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,qty:l.qty,price:l.price})))},
  note:'SYN-K30 synthetic public group',expectedSnapshot:context.snapshot,idempotencyKey:'SYN-K30-GROUP-CREATE'};
 const saved=await s.saveExternalBillingDocument(values);
 const row=s.externalBillingDocumentIndex().documents.find(x=>x.document.id===saved.id);
 if(!row||!row.canGroup)throw Error('SYN-K30 valid real Store group required: '+JSON.stringify(row));
 return row;
}'''
