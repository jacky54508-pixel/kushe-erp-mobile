"""Synthetic K25 financial sources. No production identifiers or amounts imported."""
from copy import deepcopy
import json

PREFIX = 'SYN-K25-'
GROUP = PREFIX + 'GROUP'
DATE = '2026-10-08'
MONTH = DATE[:7]
EMPLOYEES = [PREFIX + 'EMP-A', PREFIX + 'EMP-B']
HOUSES = [PREFIX + 'HOUSE-A', PREFIX + 'HOUSE-B', PREFIX + 'HOUSE-C']
WEIGHTS = [4666, 4667, 4667]
PROTECTED = ('dailyLogs','commissions','payroll','salaryPayments','banks','bankTransactions','billings','receivables','receipts','retentionReceipts','commissionSettlements','invoices','payments','payables')


def fixture(kind='unpaid'):
    if kind=='mixed-scope':
        s=fixture('unpaid');second=fixture('negative')
        def rename(value):
            if isinstance(value,str):return value.replace(PREFIX,PREFIX+'SECOND-')
            if isinstance(value,list):return [rename(v) for v in value]
            if isinstance(value,dict):return {k:rename(v) for k,v in value.items()}
            return value
        for key,value in second.items():
            if isinstance(value,list):s[key].extend(rename(value))
        return s
    if kind in ('inactive-work-only','inactive-disabled-zero','inactive-enabled-zero-rate','inactive-legacy-work','missing-nonzero-source'):
        s=fixture('unpaid');s['commissions']=[];s['payroll']=[]
        if kind!='missing-nonzero-source':
            for log in s['dailyLogs']:
                log.update(commission=0,rate=25 if kind=='inactive-disabled-zero' else 0,workOnly=kind=='inactive-work-only',commissionEnabled=kind=='inactive-enabled-zero-rate')
                if kind=='inactive-legacy-work':
                    log.update(rate=50,payType='點工',performance=0,untaxedPerformance=0,taxIncludedPerformance=0,groupTotal=0,grossTotal=0,workMode='none',items=[])
                    log.pop('commissionEnabled');log.pop('workOnly')
        return s
    if kind=='billing-lines-subtotal-only':
        s=fixture('received')
        for bill in s['billings']:
            bill['lines']=[{k:v for k,v in line.items() if k in ('qty','price','taxMode','subtotal','sourceRefs')} for line in bill['lines']]
        return s
    if kind=='decimal-rate-pool':
        s=fixture('received');employee=PREFIX+'EMP-C'
        s['employees'].append(dict(s['employees'][0],id=employee,name=employee))
        s['dailyLogs'].append(dict(deepcopy(s['dailyLogs'][0]),id=PREFIX+'LOG-2',employee=employee,employeeName=employee))
        s['commissions'].append(dict(s['commissions'][0],id=PREFIX+'COMMISSION-2',sourceId=PREFIX+'LOG-2',employee=employee,employeeName=employee))
        s['payroll'].append(dict(s['payroll'][0],id=PREFIX+'PAYROLL-2',employee=employee,employeeName=employee))
        for i,(rate,amount,base) in enumerate(((0.01,0,4666),(32.16,1501,4667),(17.83,832,4667))):
            s['employees'][i]['commissionRate']=rate
            s['dailyLogs'][i].update(rate=rate,commission=amount,commissionBaseAmount=base,performance=base,untaxedPerformance=base,taxIncludedPerformance=round(base*1.05))
            s['commissions'][i].update(rate=rate,commission=amount,commissionBaseAmount=base,untaxedAmount=base)
            s['payroll'][i].update(commission=amount,total=amount)
        return s
    if kind=='commission-amount-mismatch':
        s=fixture('received');s['dailyLogs'][0]['commission']=1749
        return s
    if kind in ('same-month-other-paid','payment-bank-missing','payment-payroll-missing'):
        s=fixture('paid-house')
        if kind=='same-month-other-paid':
            other=PREFIX+'OTHER-COMMISSION'
            s['commissions'].append({'id':other,'date':DATE,'employee':EMPLOYEES[0],'employeeName':EMPLOYEES[0],'project':PREFIX+'PROJECT','projectName':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','rate':25,'commission':583,'untaxedAmount':2332,'commissionBasis':'preTax','sourceType':'manual','sourceNo':PREFIX+'UNRELATED','status':'已列入薪資'})
            s['salaryPayments'][0]['commissionSelectionKeys']=[json.dumps([other,'未指定戶別'],ensure_ascii=False,separators=(',',':'))]
            s['payroll'][0].update(commission=2333,total=2333)
        elif kind=='payment-bank-missing':s['bankTransactions']=[t for t in s['bankTransactions'] if t['id']!=PREFIX+'BANK-OUT']
        else:s['payroll']=[r for r in s['payroll'] if r['id']!=PREFIX+'PAYROLL-0']
        return s
    if kind=='two-bills-one-house':
        s=fixture('received')
        for l in s['dailyLogs']:
            a=l['items'][0];a.update(qty=1,price=2333,inputPrice=2333,unitPrice=2333,subtotal=2333,untaxedSubtotal=2333)
            l['items'].insert(1,dict(a,workItemId=PREFIX+'WORK-SPLIT',billingId=PREFIX+'BILL-2',billingNo=PREFIX+'BILL-NO-2'))
            l['billingIds']=[PREFIX+'BILL',PREFIX+'BILL-2']
        b=s['billings'][0];b.update(amount=11667,preTaxAmount=11667,tax=583,taxAmount=583,grossTotal=12250,taxIncludedAmount=12250,total=12250)
        b['lines'][0].update(price=2333,inputPrice=2333,unitPrice=2333,subtotal=2333,untaxedSubtotal=2333)
        s['receivables'][0].update(amount=12250,untaxedAmount=11667,preTaxAmount=11667,tax=583,taxAmount=583,grossTotal=12250,taxIncludedAmount=12250,received=12250)
        s['receipts'][0].update(amount=12250,cashAmount=12250,settlementAmount=12250,netAmount=12250)
        s['bankTransactions'][0].update(amount=12250,actualCredit=12250,netAmount=12250,receiptAmount=12250)
        s['banks'][0].update(income=12250,balance=112250)
        ref={'sourceGroupKey':GROUP,'workItemId':PREFIX+'WORK-SPLIT','sourceType':'daily-log'}
        b2=deepcopy(b);b2.update(id=PREFIX+'BILL-2',number=PREFIX+'BILL-NO-2',receivableId=PREFIX+'AR-2',amount=2333,preTaxAmount=2333,tax=117,taxAmount=117,grossTotal=2450,taxIncludedAmount=2450,total=2450,status='未收款',lines=[dict(s['dailyLogs'][0]['items'][1],sourceRefs=[ref])],sourceItemRefs=[ref])
        s['billings'].append(b2)
        a2=deepcopy(s['receivables'][0]);a2.update(id=PREFIX+'AR-2',billingId=PREFIX+'BILL-2',sourceNo=PREFIX+'BILL-NO-2',amount=2450,untaxedAmount=2333,preTaxAmount=2333,tax=117,taxAmount=117,grossTotal=2450,taxIncludedAmount=2450,received=0,status='未收')
        s['receivables'].append(a2)
        return s
    if kind=='missing-tax':
        s=fixture('unpaid');s['billings'][0].pop('taxMode');s['receivables'][0].pop('taxMode')
        return s
    arrays = ('commissions','employees','customers','projects','vendors','materials','materialUsages','inventoryReceipts','projectCosts','billings','receivables','payables','invoices','receipts','retentionReceipts','payments','salaryPayments','commissionSettlements','banks','bankTransactions','payroll','attendance','dailyLogs','dailyItemPresets','quotations','quotationPrices','quotationTemplates','audit')
    s = {k: [] for k in arrays}
    s['meta'] = {'k25Synthetic': True, 'version':'5.0.0', 'createdAt':'2026-10-01T00:00:00.000Z', 'updatedAt':'2026-10-08T00:00:00.000Z', 'quotationPriceMigrated':True}
    s['settings'] = {'company':PREFIX+'COMPANY', 'defaultTax':5, 'quotationUnitPresets':['式']}
    s['customers'] = [{'id':PREFIX+'CUSTOMER','name':PREFIX+'CUSTOMER','note':''}]
    s['projects'] = [{'id':PREFIX+'PROJECT','name':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','customerName':PREFIX+'CUSTOMER'}]
    s['employees'] = [{'id':e,'name':e,'status':'在職','commissionRate':25,'commissionBasis':'preTax'} for e in EMPLOYEES]
    items = [{'workItemId':PREFIX+'WORK-'+str(i),'house':h,'item':PREFIX+'WORK','itemName':PREFIX+'WORK','unit':'式','qty':1,'price':w,'inputPrice':w,'unitPrice':w,'subtotal':w,'untaxedSubtotal':w,'taxMode':'未稅','billable':True,'billingStatus':'已請款','billingId':PREFIX+'BILL','billingNo':PREFIX+'BILL-NO','project':PREFIX+'PROJECT','sourceType':'manual'} for i,(h,w) in enumerate(zip(HOUSES,WEIGHTS))]
    for i,e in enumerate(EMPLOYEES):
        log_id=PREFIX+'LOG-'+str(i);comm_id=PREFIX+'COMMISSION-'+str(i)
        s['dailyLogs'].append({'id':log_id,'date':DATE,'batchId':PREFIX+'BATCH','groupId':GROUP,'employee':e,'employeeName':e,'project':PREFIX+'PROJECT','projectName':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','customerName':PREFIX+'CUSTOMER','rate':25,'groupTotal':14000,'grossTotal':14000,'performance':7000,'untaxedPerformance':7000,'taxIncludedPerformance':7350,'commission':1750,'commissionBaseAmount':7000,'commissionBasis':'preTax','commissionEnabled':True,'workOnly':False,'workMode':'none','payType':'業績抽成','billable':True,'billingId':PREFIX+'BILL','billingIds':[PREFIX+'BILL'],'billingStatus':'已請款','items':deepcopy(items),'createdAt':'2026-10-08T00:00:00.000Z','updatedAt':'2026-10-08T00:00:00.000Z'})
        s['commissions'].append({'id':comm_id,'date':DATE,'employee':e,'employeeName':e,'project':PREFIX+'PROJECT','projectName':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','rate':25,'commission':1750,'untaxedAmount':7000,'commissionBaseAmount':7000,'commissionBasis':'preTax','sourceType':'daily-log','sourceId':log_id,'sourceNo':PREFIX+'SOURCE','status':'已列入薪資','createdAt':'2026-10-08T00:00:00.000Z','updatedAt':'2026-10-08T00:00:00.000Z'})
        s['payroll'].append({'id':PREFIX+'PAYROLL-'+str(i),'employee':e,'employeeName':e,'month':MONTH,'baseSalary':0,'commission':1750,'total':1750,'status':'未付款','createdAt':'2026-10-08T00:00:00.000Z','updatedAt':'2026-10-08T00:00:00.000Z'})
    refs=[{'sourceGroupKey':GROUP,'workItemId':i['workItemId'],'sourceType':'daily-log'} for i in items]
    s['billings']=[{'id':PREFIX+'BILL','number':PREFIX+'BILL-NO','date':DATE,'project':PREFIX+'PROJECT','projectName':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','customerName':PREFIX+'CUSTOMER','taxMode':'未稅','sourceType':'manual','amount':14000,'preTaxAmount':14000,'tax':700,'taxAmount':700,'grossTotal':14700,'taxIncludedAmount':14700,'total':14700,'retention':0,'retentionAmount':0,'retentionRate':0,'retentionReceived':0,'retentionEnabled':False,'retentionStatus':'no_retention','receivableId':PREFIX+'AR','invoiceStatus':'invoice_pending','hasInvoice':True,'status':'未收款','lines':[dict(i,sourceRefs=[refs[n]]) for n,i in enumerate(items)],'sourceItemRefs':refs,'sourceContractRefs':[]}]
    s['receivables']=[{'id':PREFIX+'AR','billingId':PREFIX+'BILL','sourceNo':PREFIX+'BILL-NO','project':PREFIX+'PROJECT','customer':PREFIX+'CUSTOMER','date':DATE,'taxMode':'未稅','amount':14700,'untaxedAmount':14000,'preTaxAmount':14000,'tax':700,'taxAmount':700,'grossTotal':14700,'taxIncludedAmount':14700,'received':0,'legacyReceived':0,'retention':0,'retentionAmount':0,'retentionReceived':0,'remainingRetention':0,'retentionStatus':'no_retention','status':'未收'}]
    s['banks']=[{'id':PREFIX+'BANK','name':PREFIX+'BANK','openingBalance':100000,'income':0,'expense':0,'balance':100000}]
    if kind in ('received','partial-receipt','paid-house','pending-cash','broken-bank','legacy-received','duplicate-ar','negative','zero','malformed-ledger'):
        amount=7350 if kind=='partial-receipt' else 14700
        s['receivables'][0]['received']=amount;s['receivables'][0]['status']='已收' if amount==14700 else '部分收款'
        s['billings'][0]['status']='已收款' if amount==14700 else '部分收款'
        if kind=='legacy-received':s['receivables'][0]['legacyReceived']=amount
        else:
            s['receipts']=[{'id':PREFIX+'RECEIPT','receivableId':PREFIX+'AR','billingId':PREFIX+'BILL','date':'2026-10-09','amount':amount,'cashAmount':amount,'settlementAmount':amount,'deductionAmount':0,'deductions':[],'fee':0,'feePayer':'company','netAmount':amount,'collectionType':'bank','bankId':PREFIX+'BANK','bankAccountId':PREFIX+'BANK','bankTransactionId':PREFIX+'BANK-IN','paymentMethod':'銀行轉帳'}]
            s['bankTransactions']=[{'id':PREFIX+'BANK-IN','bankId':PREFIX+'BANK','bankAccountId':PREFIX+'BANK','sourceType':'receipt','sourceId':PREFIX+'RECEIPT','receiptId':PREFIX+'RECEIPT','receivableId':PREFIX+'AR','billingId':PREFIX+'BILL','sourceNo':PREFIX+'BILL-NO','date':'2026-10-09','type':'收入','direction':'in','amount':amount,'actualCredit':amount,'netAmount':amount,'receiptAmount':amount,'fee':0,'feePayer':'company'}]
            s['banks'][0]['income']=amount;s['banks'][0]['balance']+=amount
    if kind=='paid-house':
        amount=583;key=json.dumps([PREFIX+'COMMISSION-0',HOUSES[0]],separators=(',',':'))
        s['salaryPayments']=[{'id':PREFIX+'SALARY','payrollId':PREFIX+'PAYROLL-0','employee':EMPLOYEES[0],'month':MONTH,'date':'2026-10-10','amount':amount,'baseAmount':0,'commissionAmount':amount,'fee':0,'feePayer':'company','actualDebit':amount,'paymentAllocationVersion':2,'commissionSelectionKeys':[key],'bankId':PREFIX+'BANK','bankAccountId':PREFIX+'BANK','bankTransactionId':PREFIX+'BANK-OUT','paymentMethod':'銀行轉帳'}]
        s['bankTransactions'].append({'id':PREFIX+'BANK-OUT','bankId':PREFIX+'BANK','bankAccountId':PREFIX+'BANK','sourceType':'salary_payment','sourceId':PREFIX+'SALARY','salaryPaymentId':PREFIX+'SALARY','payrollId':PREFIX+'PAYROLL-0','employee':EMPLOYEES[0],'month':MONTH,'date':'2026-10-10','type':'支出','direction':'out','amount':amount,'actualDebit':amount,'salaryAmount':amount,'fee':0,'feePayer':'company'})
        s['banks'][0]['expense']=amount;s['banks'][0]['balance']-=amount;s['payroll'][0]['status']='部分付款'
    elif kind=='pending-cash':
        r=s['receipts'][0];r.update({'collectionType':'employee_cash','collectorEmployeeId':EMPLOYEES[0],'collectorEmployeeName':EMPLOYEES[0],'collectedAt':'2026-10-09','handoverStatus':'pending','handedOverAt':'','handoverBankId':'','handoverTransactionId':'','bankId':'','bankAccountId':'','bankTransactionId':'','netAmount':0,'paymentMethod':'員工現金代收'})
        s['bankTransactions']=[];s['banks'][0].update(income=0,balance=100000)
    elif kind=='broken-bank':s['bankTransactions'][0]['amount']-=1
    elif kind=='duplicate-ar':s['receivables'].append(dict(s['receivables'][0],id=PREFIX+'AR-DUP'))
    elif kind=='tax-conflict':
        s['billings'][0].update(taxMode='含稅',amount=13333,preTaxAmount=13333,tax=667,taxAmount=667,grossTotal=14000,taxIncludedAmount=14000,total=14000)
        s['receivables'][0].update(taxMode='含稅',amount=14000,untaxedAmount=13333,preTaxAmount=13333,tax=667,taxAmount=667,grossTotal=14000,taxIncludedAmount=14000)
    elif kind=='rate-pool':
        s['dailyLogs'][0]['rate']=30;s['commissions'][0]['rate']=30
    elif kind=='duplicate-source':s['commissions'].append(dict(s['commissions'][0],id=PREFIX+'COMMISSION-DUP'))
    elif kind=='items-mismatch':s['dailyLogs'][1]['items'][0]['untaxedSubtotal']+=1
    elif kind in ('negative','zero'):
        amount=4000 if kind=='negative' else 3500
        for rows in (s['dailyLogs'],s['commissions']):
            for r in rows:r['commission']=amount
        for r in s['payroll']:r.update(commission=amount,total=amount)
    elif kind=='malformed-ledger':s['meta']['commissionCorrectionReviews']={'unexpected':'SYN-K25-INVALID'}
    elif kind=='july-scope':
        for k in ('dailyLogs','commissions'): 
            for r in s[k]:r['date']='2026-07-29'
        for r in s['payroll']:r['month']='2026-07'
    if kind=='html-text':
        value='SYN-K25-<img src=x onerror=\"window.__k25Injected=true\">'
        s['projects'][0]['name']=value
        for k in ('dailyLogs','commissions','billings'):
            for r in s[k]:r['projectName']=value
    return s
