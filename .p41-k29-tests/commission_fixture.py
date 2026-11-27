"""Synthetic manual commissions only; no production exports or personal identities."""
from copy import deepcopy

PREFIX='SYN-K29-COMMISSION-'
CUSTOMER=PREFIX+'CUSTOMER'
EMPLOYEE=PREFIX+'EMPLOYEE-A'
OTHER_EMPLOYEE=PREFIX+'EMPLOYEE-B'
PROJECT=PREFIX+'PROJECT-A'
OTHER_PROJECT=PREFIX+'PROJECT-B'
BILL=PREFIX+'BILL-A'
OTHER_BILL=PREFIX+'BILL-B'
COMMISSION=PREFIX+'OLD'
PAYROLL=PREFIX+'PAYROLL'
BANK=PREFIX+'BANK'
DATE='2026-04-07'
MONTH=DATE[:7]
STAMP='2026-04-08T02:03:04.000Z'
ARRAYS=('commissions','employees','customers','projects','vendors','materials','materialUsages','inventoryReceipts','projectCosts','billings','receivables','payables','invoices','receipts','retentionReceipts','payments','salaryPayments','commissionSettlements','banks','bankTransactions','payroll','attendance','dailyLogs','dailyItemPresets','quotations','quotationPrices','quotationTemplates','audit')


def fixture(kind='retention', existing=True):
    data={key:[] for key in ARRAYS}
    data['meta']={'k29Synthetic':True,'version':'5.0.0','createdAt':STAMP,'updatedAt':STAMP,'quotationPriceMigrated':True}
    data['settings']={'company':PREFIX+'COMPANY','defaultTax':5,'quotationUnitPresets':['式']}
    data['customers']=[{'id':CUSTOMER,'name':CUSTOMER}]
    data['projects']=[{'id':p,'name':p,'customer':CUSTOMER,'customerName':CUSTOMER,'status':'進行中'} for p in (PROJECT,OTHER_PROJECT)]
    data['employees']=[{'id':e,'name':e,'status':'在職','commissionRate':25,'dailyRate':1000,'hourlyRate':250} for e in (EMPLOYEE,OTHER_EMPLOYEE)]
    no_invoice=kind=='no-invoice'
    gross=20000 if no_invoice else 21000
    tax=0 if no_invoice else 1000
    retention=1050 if kind in ('retention','paid') else 0
    for index,identifier in enumerate((BILL,OTHER_BILL)):
        receivable=identifier+'-AR'
        bill={'id':identifier,'number':identifier+'-NO','date':DATE,'project':PROJECT,'projectName':PROJECT,'customer':CUSTOMER,'customerName':CUSTOMER,'taxMode':'含稅' if kind=='tax-included' else '未稅','sourceType':'manual','amount':20000,'preTaxAmount':20000,'tax':tax,'taxAmount':tax,'grossTotal':gross,'taxIncludedAmount':gross,'total':gross-retention,'retention':retention,'retentionAmount':retention,'retentionRate':5 if retention else 0,'retentionReceived':0,'remainingRetention':retention,'retentionEnabled':bool(retention),'retentionStatus':'未收' if retention else 'no_retention','receivableId':receivable,'invoiceStatus':'no_invoice' if no_invoice else 'invoice_pending','hasInvoice':not no_invoice,'status':'未收款','lines':[],'sourceItemRefs':[],'sourceContractRefs':[],'note':PREFIX+'billing-'+str(index)}
        data['billings'].append(bill)
        data['receivables'].append({'id':receivable,'billingId':identifier,'sourceNo':bill['number'],'date':DATE,'project':PROJECT,'customer':CUSTOMER,'amount':gross-retention,'untaxedAmount':20000,'preTaxAmount':20000,'tax':tax,'taxAmount':tax,'grossTotal':gross,'taxIncludedAmount':gross,'received':0,'legacyReceived':0,'retention':retention,'retentionAmount':retention,'retentionReceived':0,'remainingRetention':retention,'status':'未收'})
    data['banks']=[{'id':BANK,'name':BANK,'openingBalance':100000,'income':0,'expense':0,'balance':100000}]
    if existing:
        partial=kind in ('partial','orphan','conflicting-source','invalid-alias','manual','raw-strings','missing-source-fields','missing-status','blank-status','missing-date','blank-date','legacy-note')
        base,commission=(8000,1777) if partial else (20000,4777 if kind=='same-amount-new-source' else 5000)
        row={'id':COMMISSION,'date':DATE,'employee':EMPLOYEE,'project':PROJECT,'sourceType':'billing','sourceId':BILL,'billingId':BILL,'sourceNo':BILL+'-NO','untaxedAmount':base,'rate':25,'commission':commission,'status':'已列入薪資','note':PREFIX+'original note','createdAt':STAMP,'updatedAt':STAMP}
        if kind=='orphan':row.update(sourceId=PREFIX+'MISSING',billingId=PREFIX+'MISSING')
        if kind=='conflicting-source':row['sourceId']=OTHER_BILL
        if kind=='manual':row.update(sourceType='manual',sourceNo='');row.pop('sourceId');row.pop('billingId')
        if kind=='missing-source-fields':
            row['sourceType']='manual'
            for field in ('sourceNo','sourceId','billingId'):row.pop(field)
        if kind=='missing-status':row.pop('status')
        if kind=='blank-status':row['status']=''
        if kind=='missing-date':row.pop('date')
        if kind=='blank-date':row['date']=''
        if kind=='legacy-note':
            for field in ('sourceType','sourceId','billingId'):row.pop(field)
            row['note']='由請款單自動建立｜比例分配'
        if kind=='raw-strings':
            for field in ('untaxedAmount','rate','commission'):row[field]=str(row[field])
        if kind=='daily':row.update(sourceType='daily-log',sourceId=PREFIX+'DAILY-LOG');row.pop('billingId')
        data['commissions']=[row]
        data['payroll']=[{'id':PAYROLL,'employee':EMPLOYEE,'month':MONTH,'days':0,'hours':0,'baseSalary':0,'commission':commission,'total':commission,'fuel':0,'manualFuel':0,'meal':0,'other':0,'overtime':0,'bonus':0,'allowance':0,'advance':0,'laborInsurance':0,'incomeTax':0,'deduction':0,'status':'未付款','note':PREFIX+'preserve payroll','createdAt':STAMP,'updatedAt':STAMP}]
        if kind=='paid':
            data['payroll'][0].update(status='已付款',paidAmount=commission,payDate=DATE,bankId=BANK,paymentTransactionId=PREFIX+'BANK-OUT',paidAt=STAMP)
            data['salaryPayments']=[{'id':PREFIX+'PAYMENT','payrollId':PAYROLL,'employee':EMPLOYEE,'month':MONTH,'date':DATE,'amount':commission,'baseAmount':0,'commissionAmount':commission,'paymentAllocationVersion':2,'commissionSelectionKeys':['["'+COMMISSION+'","未指定戶別"]'],'fee':0,'feePayer':'company','actualDebit':commission,'bankId':BANK,'bankAccountId':BANK,'bankTransactionId':PREFIX+'BANK-OUT'}]
            data['bankTransactions']=[{'id':PREFIX+'BANK-OUT','sourceType':'salary_payment','sourceId':PREFIX+'PAYMENT','salaryPaymentId':PREFIX+'PAYMENT','payrollId':PAYROLL,'employee':EMPLOYEE,'month':MONTH,'date':DATE,'type':'支出','direction':'out','amount':commission,'actualDebit':commission,'salaryAmount':commission,'bankId':BANK,'bankAccountId':BANK}]
            data['banks'][0].update(expense=commission,balance=100000-commission)
    if kind=='invalid-alias':data['billings'][0]['preTaxAmount']=19000
    if kind=='missing-gross':
        data['billings'][0]['grossTotal']=None;data['billings'][0]['taxIncludedAmount']=None
    if kind=='duplicate-id':data['billings'].append(deepcopy(data['billings'][0]))
    return data


def values(data, **changes):
    row=data['commissions'][0]
    result={key:row.get(key,'') for key in ('date','employee','project','sourceNo','untaxedAmount','rate','commission','status','note')}
    result['billing']=''
    result.update(changes)
    return result


if __name__=='__main__':
    import argparse,json
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    from pathlib import Path
    cases={kind:fixture(kind) for kind in ('retention','no-invoice','tax-included','partial','orphan','invalid-alias','missing-gross','duplicate-id')}
    Path(args.output).write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
