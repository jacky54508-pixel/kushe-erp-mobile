"""Wholly synthetic receivables, two original invoices and one saved group."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.p41-k28-tests'))
from k28_browser_store import HTML as BASE_HTML
from k28_fixture import ARRAYS

CUSTOMER = 'SYN-K29-CUSTOMER'
IDS = ['SYN-K29-BILL-A', 'SYN-K29-BILL-B', 'SYN-K29-BILL-C', 'SYN-K29-BILL-D']
HTML = BASE_HTML.replace('SYN-K28', 'SYN-K29').replace('__k28', '__k29').replace('k28Synthetic', 'k29Synthetic')
HTML = HTML.replace('<div id="commissionsApp"></div>', '<main class="page-frame"><section class="view" id="receivablesView"><div id="receivablesApp"></div></section></main>')
HTML = HTML.replace('<script>', '<meta name="viewport" content="width=device-width,initial-scale=1"><script>', 1)
HTML = HTML.replace("'use strict';", "'use strict';document.body.dataset.route='receivables';window.__k29Toasts=[];window.KushePhase1={toast:m=>__k29Toasts.push(m),navigate(){}};window.KusheKpi={register(){}};window.KusheIcons={render(){}};")


def fixture():
    state = {key: [] for key in ARRAYS}
    state['meta'] = {'version': '5.0.0', 'k29Synthetic': True, 'quotationPriceMigrated': True, 'updatedAt': '2026-11-25T02:00:00.000Z'}
    state['settings'] = {'defaultTax': 5, 'quotationUnitPresets': ['式']}
    state['customers'] = [{'id': CUSTOMER, 'name': '合成建設有限公司｜長名稱對齊測試'}]
    for i, (amount, tax, retention, received, invoice_status) in enumerate([
        (100000, 5000, 5000, 40000, 'invoiced'),
        (80000, 4000, 4000, 0, 'invoice_pending'),
        (20000, 0, 2000, 18000, 'no_invoice'),
        (12345, 617, 0, 0, 'invoice_pending'),
    ]):
        bid = IDS[i]
        project = 'SYN-K29-PROJECT-' + chr(65 + i)
        project_name = '合成案場 ' + chr(65 + i) + (' 區｜第一期公共設施及住宅施工長名稱核對' if i == 0 else ' 區')
        state['projects'].append({'id': project, 'customer': CUSTOMER, 'name': project_name})
        gross = amount + tax
        arid = bid + '-AR'
        number = 'SYN-K29-NO-' + chr(65 + i)
        invoice_no = 'SYN-K29-INV-A' if i == 0 else ''
        billing = {'id': bid, 'number': number, 'date': '2026-11-' + str(10 + i), 'sourceType': 'manual',
                   'customer': CUSTOMER, 'customerName': state['customers'][0]['name'], 'project': project, 'projectName': project_name,
                   'invoiceStatus': invoice_status, 'invoiceNo': invoice_no, 'invoiceDate': '2026-11-12' if i == 0 else '', 'hasInvoice': invoice_status != 'no_invoice',
                   'amount': amount, 'preTaxAmount': amount, 'tax': tax, 'taxAmount': tax, 'taxIncludedAmount': gross, 'grossTotal': gross,
                   'retention': retention, 'retentionAmount': retention, 'retentionReceived': 0, 'retentionRate': 0, 'retentionEnabled': bool(retention),
                   'retentionMode': 'custom' if retention else 'none', 'retentionBase': 'preTax', 'total': gross - retention,
                   'taxMode': '未稅', 'receivableId': arid, 'sourceItemRefs': [], 'sourceContractRefs': [],
                   'lines': [{'id': bid + '-LINE', 'house': 'A1', 'item': 'SYN-K29-WORK-' + chr(65 + i), 'unit': '式', 'qty': 1, 'price': amount, 'amount': amount, 'subtotal': amount}]}
        receivable = {'id': arid, 'billingId': bid, 'sourceNo': number, 'date': billing['date'], 'customer': CUSTOMER,
                      'project': project, 'customerName': billing['customerName'], 'projectName': project_name,
                      'amount': gross - retention, 'untaxedAmount': amount, 'preTaxAmount': amount, 'tax': tax, 'taxAmount': tax,
                      'taxIncludedAmount': gross, 'grossTotal': gross, 'retention': retention, 'retentionAmount': retention,
                      'retentionReceived': 0, 'received': received, 'legacyReceived': received, 'invoiceNo': invoice_no,
                      'invoiceStatus': invoice_status, 'taxMode': '未稅', 'receivableCheques': []}
        state['billings'].append(billing)
        state['receivables'].append(receivable)
        if i == 0:
            state['invoices'].append({'id': bid + '-INVOICE', 'invoiceId': bid + '-INVOICE', 'invoiceType': 'output', 'type': '銷項',
                                      'sourceType': 'billing', 'sourceId': bid, 'billingId': bid, 'sourceNo': number, 'status': 'issued',
                                      'invoiceNumber': invoice_no, 'number': invoice_no, 'invoiceDate': '2026-11-12', 'date': '2026-11-12',
                                      'customer': CUSTOMER, 'project': project, 'netAmount': amount, 'amount': amount, 'taxAmount': tax, 'tax': tax,
                                      'grossAmount': gross, 'total': gross})
    return state


GROUP_SETUP = r'''async()=>{
 const s=KuSheERPStore,ids=['SYN-K29-BILL-A','SYN-K29-BILL-B'];
 let context=s.externalBillingContext(ids);
 const values={sourceIds:ids,targetBillingId:ids[0],documentDate:'2026-11-25',status:'active',confirmed:true,
  detailMode:'unified',unified:{taxMode:'未稅',reason:'合成資料合併顯示驗收',lines:context.sources.flatMap(x=>x.document.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,qty:l.qty,price:l.price})))},note:'SYN-K29-PUBLIC-NOTE',expectedSnapshot:context.snapshot,idempotencyKey:'SYN-K29-GROUP-V1'};
 const first=await s.saveExternalBillingDocument(values);
 context=s.externalBillingContext(ids,first.id);
 await s.saveExternalBillingDocument({...values,documentId:first.id,documentDate:'2026-11-26',expectedSnapshot:context.snapshot,idempotencyKey:'SYN-K29-GROUP-V2'});
 const index=s.externalBillingDocumentIndex();if(index.documents.length!==1||!index.documents[0].canGroup)throw Error(JSON.stringify(index));
 return index.documents[0];
}'''
