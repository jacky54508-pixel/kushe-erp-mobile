"""Wholly synthetic financial records for paid-month daily append acceptance."""
from copy import deepcopy
import json

PREFIX = 'SYN-K28-'
OWNER = PREFIX + 'OWNER'
EMPLOYEE = PREFIX + 'EMP-A'
OTHER_EMPLOYEE = PREFIX + 'EMP-B'
CUSTOMER = PREFIX + 'CUSTOMER'
PROJECT = PREFIX + 'PROJECT-PAID'
NEW_PROJECT = PREFIX + 'PROJECT-NEW'
PAYROLL = PREFIX + 'PAYROLL-PAID'
OLD_BATCH = PREFIX + 'BATCH-OLD'
OLD_COMMISSION = PREFIX + 'COMMISSION-OLD'
BANK = PREFIX + 'BANK'
DATE = '2026-04-07'
MONTH = DATE[:7]
NEW_DATE = '2026-04-19'
NEW_AMOUNT = 8400
NEW_COMMISSION = 4200
OLD_BASE = 1200
OLD_COMMISSION_AMOUNT = 4800
OLD_TOTAL = OLD_BASE + OLD_COMMISSION_AMOUNT
STAMP = '2026-04-08T02:03:04.000Z'
ARRAYS = ('commissions','employees','customers','projects','vendors','materials','materialUsages','inventoryReceipts','projectCosts','billings','receivables','payables','invoices','receipts','retentionReceipts','payments','salaryPayments','commissionSettlements','banks','bankTransactions','payroll','attendance','dailyLogs','dailyItemPresets','quotations','quotationPrices','quotationTemplates','audit')
PROTECTED_COLLECTIONS = ('customers','projects','employees','vendors','materials','materialUsages','inventoryReceipts','projectCosts','billings','receivables','payables','invoices','receipts','retentionReceipts','payments','salaryPayments','commissionSettlements','banks','bankTransactions','quotations','quotationPrices','quotationTemplates')


def allocation(house):
    return json.dumps([OLD_COMMISSION, PREFIX + house], ensure_ascii=False, separators=(',', ':'))


def fixture(kind='partial'):
    s = {k: [] for k in ARRAYS}
    s['meta'] = {'k28Synthetic': True, 'version':'5.0.0', 'createdAt':STAMP, 'updatedAt':STAMP, 'quotationPriceMigrated':True}
    s['settings'] = {'company':PREFIX+'COMPANY', 'defaultTax':5, 'quotationUnitPresets':['式']}
    s['customers'] = [{'id':CUSTOMER,'name':CUSTOMER,'note':'SYN-K28 fixture customer'}]
    s['projects'] = [{'id':p,'name':p,'customer':CUSTOMER,'customerName':CUSTOMER,'status':'進行中','commissionBasis':'preTax','defaultCommissionBasis':'preTax'} for p in (PROJECT, NEW_PROJECT)]
    s['employees'] = [{'id':e,'name':e,'status':'在職','commissionRate':50,'commissionBasis':'preTax','dailyRate':1000,'hourlyRate':250} for e in (EMPLOYEE,OTHER_EMPLOYEE)]
    items = [{'workItemId':PREFIX+'WORK-'+str(i),'house':PREFIX+h,'item':PREFIX+'OLD-WORK','itemName':PREFIX+'OLD-WORK','unit':'式','qty':1,'price':4800,'inputPrice':4800,'unitPrice':4800,'subtotal':4800,'untaxedSubtotal':4800,'taxMode':'未稅','billable':True,'billingStatus':'已請款','billingId':PREFIX+'BILL','billingNo':PREFIX+'BILL-NO','project':PROJECT,'sourceType':'manual'} for i,h in enumerate(('HOUSE-A','HOUSE-B'))]
    s['dailyLogs'] = [{'id':PREFIX+'LOG-OLD','date':DATE,'batchId':OLD_BATCH,'groupId':PREFIX+'GROUP-OLD','employee':EMPLOYEE,'employeeName':EMPLOYEE,'project':PROJECT,'projectName':PROJECT,'customer':CUSTOMER,'customerName':CUSTOMER,'rate':50,'groupTotal':9600,'grossTotal':9600,'performance':9600,'untaxedPerformance':9600,'taxIncludedPerformance':10080,'commission':OLD_COMMISSION_AMOUNT,'commissionBaseAmount':9600,'commissionBasis':'preTax','commissionEnabled':True,'workOnly':False,'workMode':'none','payType':'業績抽成','billable':True,'billingId':PREFIX+'BILL','billingIds':[PREFIX+'BILL'],'billingStatus':'已請款','items':deepcopy(items),'createdAt':STAMP,'updatedAt':STAMP}]
    s['commissions'] = [{'id':OLD_COMMISSION,'date':DATE,'employee':EMPLOYEE,'employeeName':EMPLOYEE,'project':PROJECT,'projectName':PROJECT,'customer':CUSTOMER,'rate':50,'commission':OLD_COMMISSION_AMOUNT,'untaxedAmount':9600,'commissionBaseAmount':9600,'commissionBasis':'preTax','sourceType':'daily-log','sourceId':PREFIX+'LOG-OLD','sourceNo':PREFIX+'BILL-NO','status':'已列入薪資','createdAt':STAMP,'updatedAt':STAMP}]
    s['attendance'] = [{'id':PREFIX+'ATTENDANCE-OLD','date':DATE,'employee':EMPLOYEE,'employeeName':EMPLOYEE,'project':PROJECT,'projectName':PROJECT,'workMode':'daily','days':1,'hours':0,'dailyRate':OLD_BASE,'amount':OLD_BASE,'fuel':0,'sourceType':'manual','status':'已列入薪資','note':'SYN-K28 original attendance','createdAt':STAMP,'updatedAt':STAMP}]
    s['payroll'] = [{'id':PAYROLL,'employee':EMPLOYEE,'employeeName':EMPLOYEE,'month':MONTH,'days':1,'hours':0,'baseSalary':OLD_BASE,'commission':OLD_COMMISSION_AMOUNT,'total':OLD_TOTAL,'fuel':0,'manualFuel':0,'meal':0,'other':0,'overtime':0,'bonus':0,'allowance':0,'advance':0,'laborInsurance':0,'incomeTax':0,'deduction':0,'status':'部分付款','createdAt':STAMP,'updatedAt':STAMP,'note':'SYN-K28 preserve complete original payroll','otherNote':'SYN-K28 original note'}, {'id':PREFIX+'PAYROLL-UNRELATED','employee':OTHER_EMPLOYEE,'employeeName':OTHER_EMPLOYEE,'month':'2026-03','baseSalary':333,'commission':0,'total':333,'status':'未付款','note':'SYN-K28 unrelated payroll','createdAt':STAMP,'updatedAt':STAMP}]
    refs=[{'sourceGroupKey':PREFIX+'GROUP-OLD','workItemId':i['workItemId'],'sourceType':'daily-log'} for i in items]
    s['billings']=[{'id':PREFIX+'BILL','number':PREFIX+'BILL-NO','date':DATE,'project':PROJECT,'projectName':PROJECT,'customer':CUSTOMER,'customerName':CUSTOMER,'taxMode':'未稅','sourceType':'manual','amount':9600,'preTaxAmount':9600,'tax':480,'taxAmount':480,'grossTotal':10080,'taxIncludedAmount':10080,'total':10080,'retention':0,'retentionAmount':0,'retentionRate':0,'retentionReceived':0,'retentionEnabled':False,'retentionStatus':'no_retention','receivableId':PREFIX+'AR','invoiceStatus':'invoice_pending','hasInvoice':True,'status':'已收款','lines':[dict(i,sourceRefs=[refs[n]]) for n,i in enumerate(items)],'sourceItemRefs':refs,'sourceContractRefs':[]}]
    s['receivables']=[{'id':PREFIX+'AR','billingId':PREFIX+'BILL','sourceNo':PREFIX+'BILL-NO','project':PROJECT,'customer':CUSTOMER,'date':DATE,'taxMode':'未稅','amount':10080,'untaxedAmount':9600,'preTaxAmount':9600,'tax':480,'taxAmount':480,'grossTotal':10080,'taxIncludedAmount':10080,'received':10080,'legacyReceived':0,'retention':0,'retentionAmount':0,'retentionReceived':0,'remainingRetention':0,'retentionStatus':'no_retention','status':'已收'}]
    s['receipts']=[{'id':PREFIX+'RECEIPT','receivableId':PREFIX+'AR','billingId':PREFIX+'BILL','date':'2026-04-08','amount':10080,'cashAmount':10080,'settlementAmount':10080,'deductionAmount':0,'deductions':[],'fee':0,'feePayer':'company','netAmount':10080,'collectionType':'bank','bankId':BANK,'bankAccountId':BANK,'bankTransactionId':PREFIX+'BANK-IN','paymentMethod':'銀行轉帳'}]
    paid_commission=OLD_COMMISSION_AMOUNT if kind=='full' else 2400
    paid=OLD_BASE+paid_commission
    keys=[allocation('HOUSE-A')]+([allocation('HOUSE-B')] if kind=='full' else [])
    s['salaryPayments']=[{'id':PREFIX+'SALARY','payrollId':PAYROLL,'employee':EMPLOYEE,'month':MONTH,'date':'2026-05-02','amount':paid,'baseAmount':OLD_BASE,'commissionAmount':paid_commission,'fee':17,'feePayer':'company','actualDebit':paid+17,'paymentAllocationVersion':2,'commissionSelectionKeys':keys,'bankId':BANK,'bankAccountId':BANK,'bankTransactionId':PREFIX+'BANK-OUT','paymentMethod':'銀行轉帳','note':'SYN-K28 preserve original payment','createdAt':STAMP,'updatedAt':STAMP}]
    s['payroll'][0].update(status='已付款' if kind=='full' else '部分付款',paidAmount=paid,payDate='2026-05-02',bankId=BANK,paymentTransactionId=PREFIX+'BANK-OUT',paidAt=STAMP if kind=='full' else '')
    s['bankTransactions']=[{'id':PREFIX+'BANK-IN','bankId':BANK,'bankAccountId':BANK,'sourceType':'receipt','sourceId':PREFIX+'RECEIPT','receiptId':PREFIX+'RECEIPT','receivableId':PREFIX+'AR','billingId':PREFIX+'BILL','sourceNo':PREFIX+'BILL-NO','date':'2026-04-08','type':'收入','direction':'in','amount':10080,'actualCredit':10080,'netAmount':10080,'receiptAmount':10080,'fee':0,'feePayer':'company'}, {'id':PREFIX+'BANK-OUT','bankId':BANK,'bankAccountId':BANK,'sourceType':'salary_payment','sourceId':PREFIX+'SALARY','salaryPaymentId':PREFIX+'SALARY','payrollId':PAYROLL,'employee':EMPLOYEE,'month':MONTH,'date':'2026-05-02','type':'支出','direction':'out','amount':paid+17,'actualDebit':paid+17,'salaryAmount':paid,'fee':17,'feePayer':'company','note':'SYN-K28 preserve original bank transaction'}]
    s['banks']=[{'id':BANK,'name':BANK,'openingBalance':90000,'income':10080,'expense':paid+17,'balance':90000+10080-paid-17}]
    if kind=='unpaid':
        s['salaryPayments']=[];s['bankTransactions']=s['bankTransactions'][:1]
        s['banks'][0].update(expense=0,balance=100080)
        s['payroll'][0].update(status='未付款',paidAmount=0,payDate='',bankId='',paymentTransactionId='',paidAt='')
    elif kind=='legacy-payment':s['salaryPayments'][0].pop('paymentAllocationVersion')
    elif kind=='missing-bank':s['bankTransactions']=s['bankTransactions'][:1]
    elif kind=='wrong-bank-direction':s['bankTransactions'][1].update(type='收入',direction='in')
    elif kind=='bank-amount-mismatch':s['bankTransactions'][1]['amount']+=1
    elif kind=='allocation-amount-mismatch':s['salaryPayments'][0]['commissionAmount']-=1
    elif kind=='unknown-allocation':s['salaryPayments'][0]['commissionSelectionKeys']=[json.dumps([PREFIX+'MISSING-COMMISSION',PREFIX+'HOUSE-A'],separators=(',',':'))]
    elif kind=='duplicate-selection':s['salaryPayments'][0]['commissionSelectionKeys']*=2
    elif kind=='duplicate-payment':s['salaryPayments'].append(deepcopy(s['salaryPayments'][0]))
    elif kind=='source-missing':s['commissions']=[]
    elif kind=='wrong-employee':s['salaryPayments'][0]['employee']=OTHER_EMPLOYEE
    elif kind=='legacy-bank':
        s['salaryPayments']=[];s['bankTransactions'][1].update(sourceType='payroll',sourceId=PAYROLL);s['bankTransactions'][1].pop('salaryPaymentId')
    elif kind=='stale-payroll-status':
        s['salaryPayments']=[];s['bankTransactions']=s['bankTransactions'][:1]
        s['payroll'][0].update(status='已付款',paidAmount=OLD_TOTAL)
    elif kind=='partial-summary':
        summary=deepcopy(s['payroll'][0])
        summary.update(id=PREFIX+'PAYROLL-OPEN',status='未付款',paidAmount=0,payDate='',bankId='',paymentTransactionId='',paidAt='',note='SYN-K28 editable derived summary')
        s['payroll'].insert(0,summary)
    elif kind=='mixed-employees':
        attendance=deepcopy(s['attendance'][0])
        attendance.update(id=PREFIX+'ATTENDANCE-B',employee=OTHER_EMPLOYEE,employeeName=OTHER_EMPLOYEE,dailyRate=800,amount=800)
        s['attendance'].append(attendance)
        s['payroll'].append({'id':PREFIX+'PAYROLL-B-OPEN','employee':OTHER_EMPLOYEE,'employeeName':OTHER_EMPLOYEE,'month':MONTH,'days':1,'hours':0,'baseSalary':800,'commission':0,'total':800,'fuel':0,'manualFuel':0,'status':'未付款','createdAt':STAMP,'updatedAt':STAMP,'note':'SYN-K28 unrelated worker open summary'})
    elif kind=='payment-date-priority':s['salaryPayments'][0].pop('month')
    elif kind in ('cross-employee-unpaid-key','cross-month-unpaid-key','cross-paid-key'):
        external_employee=EMPLOYEE if kind=='cross-month-unpaid-key' else OTHER_EMPLOYEE
        external_payroll=PREFIX+'PAYROLL-EXTERNAL'
        s['payroll'].append({'id':external_payroll,'employee':external_employee,'month':'2026-03','baseSalary':0,'commission':2400,'total':2400,'status':'已付款','paidAmount':2400,'payDate':'2026-05-02','bankId':BANK,'paymentTransactionId':PREFIX+'BANK-EXTERNAL','createdAt':STAMP,'updatedAt':STAMP})
        payment=deepcopy(s['salaryPayments'][0]);payment.update(id=PREFIX+'SALARY-EXTERNAL',payrollId=external_payroll,employee=external_employee,month='2026-03',amount=2400,baseAmount=0,commissionAmount=2400,fee=0,actualDebit=2400,commissionSelectionKeys=[allocation('HOUSE-A' if kind=='cross-paid-key' else 'HOUSE-B')],bankTransactionId=PREFIX+'BANK-EXTERNAL')
        transaction=deepcopy(s['bankTransactions'][1]);transaction.update(id=PREFIX+'BANK-EXTERNAL',sourceId=payment['id'],salaryPaymentId=payment['id'],payrollId=external_payroll,employee=external_employee,month='2026-03',amount=2400,actualDebit=2400,salaryAmount=2400,fee=0)
        s['salaryPayments'].append(payment);s['bankTransactions'].append(transaction);s['banks'][0]['expense']+=2400;s['banks'][0]['balance']-=2400
    elif kind=='conflicting-employee-fields':s['salaryPayments'][0]['employeeId']=OTHER_EMPLOYEE
    elif kind=='empty-daily-items':
        s['dailyLogs'][0]['items']=[]
        s['salaryPayments'][0].update(commissionSelectionKeys=[json.dumps([OLD_COMMISSION,'未指定戶別'],ensure_ascii=False,separators=(',',':'))],amount=6000,commissionAmount=4800,actualDebit=6017)
        s['bankTransactions'][1].update(amount=6017,actualDebit=6017,salaryAmount=6000)
        s['payroll'][0]['paidAmount']=6000;s['banks'][0]['expense']=6017;s['banks'][0]['balance']=90000+10080-6017
    elif kind=='array-payment-amount':s['salaryPayments'][0]['amount']=[s['salaryPayments'][0]['amount']]
    elif kind=='blank-payment-amount':s['salaryPayments'][0]['amount']='   '
    elif kind=='nan-payment-amount':s['salaryPayments'][0]['amount']='NaN'
    elif kind=='cross-employee-duplicate-source':
        duplicate=deepcopy(s['commissions'][0]);duplicate.update(id=PREFIX+'COMMISSION-DUP-SOURCE',employee=OTHER_EMPLOYEE,employeeName=OTHER_EMPLOYEE)
        s['commissions'].append(duplicate)
    elif kind=='receipt-reversed':
        s['receipts']=[];s['bankTransactions']=s['bankTransactions'][1:]
        s['billings'][0]['status']='未收款';s['receivables'][0].update(received=0,status='未收')
        s['banks'][0].update(income=0,balance=90000-paid-17)
    elif kind=='raw-summary-mismatch':s['payroll'][0]['total']-=1
    return s


def draft(mode='commission', project=NEW_PROJECT, employee=EMPLOYEE):
    work_only=mode in ('daily','hourly')
    work_mode=mode if work_only else 'daily' if mode=='mixed' else 'none'
    return {'date':NEW_DATE,'employeeIds':[employee],'commissionRates':{employee:50},'commissionBases':{employee:'preTax'},'workRates':{employee:250 if mode=='hourly' else 1000},'lines':[] if work_only else [{'project':project,'house':PREFIX+'NEW-HOUSE','item':PREFIX+'NEW-WORK','itemName':PREFIX+'NEW-WORK','unit':'式','qty':'1','inputPrice':NEW_AMOUNT,'unitPrice':NEW_AMOUNT,'taxMode':'未稅','sourceType':'manual','pricingType':'actual','billable':True,'workItemId':''}],'workOnly':work_only,'commissionEnabled':not work_only,'workMode':work_mode,'workQty':2 if mode=='hourly' else 1 if work_mode=='daily' else 0,'note':'SYN-K28 append new work only'}
