from playwright.sync_api import sync_playwright
import json, sys

def run():
    with sync_playwright() as p:
        browser=p.chromium.launch()
        context=browser.new_context()
        page=context.new_page()
        page.goto("http://127.0.0.1:8767/.p33-1-tests/full-flow.html")
        page.wait_for_function("() => !!window.KuSheERPStore")
        result=page.evaluate("""async () => {
          const store=window.KuSheERPStore;
          await store.load();

          // First create one normal record so the Store has a committed business revision.
          const customer=await store.saveCustomer({name:'P33 全流程建設'});

          // Seed a synthetic bank only inside this isolated browser database.
          const initial=await store.readCommittedSnapshot();
          const seeded=JSON.parse(JSON.stringify(initial.data));
          seeded.settings=seeded.settings&&typeof seeded.settings==='object'?seeded.settings:{quotationUnitPresets:['式']};
          seeded.meta=seeded.meta&&typeof seeded.meta==='object'?seeded.meta:{};
          seeded.banks=[{id:'bank-p33',name:'P33 測試銀行',bank:'測試銀行',account:'000-test',openingBalance:100000,income:0,expense:0,balance:100000,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
          await store.replaceSnapshot(seeded,{baseline:initial.baseline,confirmed:true});
          const project=await store.saveProject({
            name:'P33 全流程案場',customer:customer.id,status:'進行中',
            defaultRetentionMode:'10',defaultRetentionRate:10,defaultRetentionBase:'taxIncluded',
            defaultInvoiceChoice:'invoice_required',defaultTaxMode:'未稅',
            defaultCommissionBasis:'preTax'
          });
          const e1=await store.saveEmployee({name:'P33 員工甲',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});
          const e2=await store.saveEmployee({name:'P33 員工乙',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});

          // Daily work: two workers share displayed performance, but each commission uses full 14,000.
          const batch=await store.saveDailyBatch({
            date:'2026-11-02',employeeIds:[e1.id,e2.id],
            commissionRates:{[e1.id]:25,[e2.id]:25},
            commissionBases:{[e1.id]:'preTax',[e2.id]:'preTax'},
            workRates:{},
            lines:[{project:project.id,house:'A1',item:'門片修繕',itemName:'門片修繕',unit:'式',qty:14,inputPrice:1000,unitPrice:1000,taxMode:'未稅',billable:true,sourceType:'manual',pricingType:'actual'}],
            workOnly:false,commissionEnabled:true,workMode:'none',workQty:0,note:'P33 全流程'
          });
          let state=store.getState();
          const logs=state.dailyLogs.filter(x=>(x.batchId||x.id)===batch);
          if(logs.length!==2||logs.some(x=>x.performance!==7000||x.commission!==3500||x.commissionBaseAmount!==14000)) throw new Error('daily commission rule failed');

          const first=logs[0], item=first.items[0];
          const ref={workItemId:item.workItemId,sourceGroupKey:first.groupId,sourceItemIndex:0,dailyLogIds:logs.map(x=>x.id)};
          const billing=await store.createBilling({
            date:'2026-11-03',customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,
            lines:[{date:'2026-11-02',house:'A1',item:'門片修繕',unit:'式',qty:14,price:1000,sourceRefs:[ref]}],
            sourceItemRefs:[ref],sourceContractRefs:[],
            taxMode:'未稅',invoiceStatus:'invoice_pending',
            retentionMode:'10',retentionBase:'taxIncluded',retentionRate:10,
            dueDate:'2026-12-03',note:'P33 全流程請款'
          });
          state=store.getState();
          let ar=state.receivables.find(x=>x.id===billing.receivableId);
          if(!ar) throw new Error('receivable not created');
          if(billing.amount!==14000||billing.tax!==700||billing.grossTotal!==14700||billing.retention!==1470||billing.total!==13230) throw new Error('billing tax/retention totals mismatch');
          if(ar.amount!==13230||ar.retentionAmount!==1470||ar.received!==0) throw new Error('receivable totals mismatch');
          if(state.billings.length!==1||state.receivables.length!==1) throw new Error('billing/AR duplicate');
          if(logs.some(l=>l.items[0].billingId===undefined)) throw new Error('source copies not linked');

          await store.updateBillingInvoice(billing.id,{invoiceChoice:'invoice_required',invoiceNo:'P3312345678',invoiceDate:'2026-11-03'});
          state=store.getState();
          const outInvoice=state.invoices.find(x=>x.sourceType==='billing'&&x.sourceId===billing.id);
          if(!outInvoice||outInvoice.status!=='issued'||outInvoice.netAmount!==14000||outInvoice.taxAmount!==700||outInvoice.grossAmount!==14700) throw new Error('output invoice linkage mismatch');

          const receiptValues={
            receivableId:ar.id,date:'2026-11-10',cashAmount:13000,amount:13000,
            deductions:[{category:'清潔費',amount:230,note:'P33 測試扣款'}],
            deductionAmount:230,settlementAmount:13230,fee:30,feePayer:'company',
            bankId:'bank-p33',bankAccountId:'bank-p33',paymentMethod:'銀行轉帳',
            collectionType:'bank',note:'P33 應收全數沖銷',idempotencyKey:'p33-receipt-1'
          };
          const receipt=await store.addReceipt(receiptValues);
          // Exact retry must not duplicate receipt or bank transaction.
          const receiptReplay=await store.addReceipt(receiptValues);
          if(receiptReplay.id!==receipt.id) throw new Error('receipt idempotency replay mismatch');

          state=store.getState(); ar=state.receivables.find(x=>x.id===billing.receivableId);
          let bank=state.banks.find(x=>x.id==='bank-p33');
          if(ar.received!==13230||ar.status!=='已收') throw new Error('receivable settlement mismatch');
          if(state.receipts.length!==1||state.bankTransactions.filter(x=>x.sourceId===receipt.id).length!==1) throw new Error('receipt duplicate linkage');
          if(bank.income!==12970||bank.balance!==112970) throw new Error('receipt bank amount mismatch');
          if(store.projectCustomerDeductionCost(project.id)!==230) throw new Error('customer deduction attribution mismatch');

          // Receipt completion must unlock both employees' full-base commission.
          const pool=store.commissionReleasePool().filter(x=>x.projectId===project.id);
          if(pool.length!==2||pool.some(x=>!x.unlocked||x.amount!==3500||x.untaxedAmount!==7000)) throw new Error('commission release pool mismatch');

          // Pay employee A commission from the unlocked source.
          const groupA=store.monthlyPayrollGroups().find(x=>x.month==='2026-11'&&x.employeeId===e1.id);
          const keyA=pool.find(x=>x.employeeId===e1.id).allocationKey;
          const planA=store.salaryPaymentPlan(groupA.key,[keyA]);
          if(!planA.allowed||planA.selectedCommission!==3500||planA.selectedPayable!==3500) throw new Error('salary payment plan mismatch');
          const salaryValues={payrollId:groupA.primaryPayrollId,date:'2026-11-11',amount:3500,commissionSelectionKeys:[keyA],bankId:'bank-p33',bankAccountId:'bank-p33',paymentMethod:'銀行轉帳',fee:10,feePayer:'company',note:'P33 薪資',idempotencyKey:'p33-salary-1'};
          const salaryPayment=await store.addSalaryPayment(salaryValues);
          const salaryReplay=await store.addSalaryPayment(salaryValues);
          if(salaryReplay.id!==salaryPayment.id) throw new Error('salary payment idempotency mismatch');
          state=store.getState();bank=state.banks.find(x=>x.id==='bank-p33');
          if(state.salaryPayments.length!==1||state.bankTransactions.filter(x=>x.sourceId===salaryPayment.id).length!==1) throw new Error('salary bank linkage duplicate');
          if(bank.expense!==3510||bank.balance!==109460) throw new Error('salary bank debit mismatch');

          // Retention receipt is separate from current AR settlement.
          const retentionValues={receivableId:ar.id,date:'2026-11-20',amount:1470,bankId:'bank-p33',bankAccountId:'bank-p33',paymentMethod:'銀行轉帳',fee:20,feePayer:'company',note:'P33 保留款',idempotencyKey:'p33-retention-1'};
          const retention=await store.addRetentionReceipt(retentionValues);
          const retentionReplay=await store.addRetentionReceipt(retentionValues);
          if(retentionReplay.id!==retention.id) throw new Error('retention idempotency mismatch');
          state=store.getState(); ar=state.receivables.find(x=>x.id===billing.receivableId);bank=state.banks.find(x=>x.id==='bank-p33');
          if(ar.retentionReceived!==1470||ar.remainingRetention!==0) throw new Error('retention summary mismatch');
          if(state.retentionReceipts.length!==1||state.bankTransactions.filter(x=>x.sourceId===retention.id).length!==1) throw new Error('retention bank linkage duplicate');
          if(bank.income!==14420||bank.balance!==110910) throw new Error('retention bank credit mismatch');

          // Material purchase -> payable -> bank payment -> stock usage.
          const vendor=await store.saveVendor({name:'P33 材料商',taxId:'12345678'});
          const materialValues={name:'P33 測試材料',code:'P33-MAT',vendor:vendor.id,unit:'桶',unitPrice:100,model:'',note:'P33',inventoryMode:'purchase',openingStock:0,purchaseQuantity:10,purchaseDate:'2026-11-05',idempotencyKey:'p33-material-create-1'};
          const material=await store.saveMaterial(materialValues);
          const materialReplay=await store.saveMaterial(materialValues);
          if(materialReplay.id!==material.id) throw new Error('material creation idempotency mismatch');
          state=store.getState();
          const inventoryReceipt=state.inventoryReceipts.find(x=>x.material===material.id);
          const payable=state.payables.find(x=>x.id===inventoryReceipt.payableId);
          if(!inventoryReceipt||!payable||inventoryReceipt.quantity!==10||payable.amount!==1000||state.inventoryReceipts.length!==1) throw new Error('inventory receipt/payable mismatch');
          if(state.materials.find(x=>x.id===material.id).stock!==10) throw new Error('inventory stock receipt mismatch');

          const payableValues={payableId:payable.id,date:'2026-11-06',amount:1000,bankId:'bank-p33',bankAccountId:'bank-p33',paymentMethod:'銀行轉帳',fee:5,feePayer:'company',note:'P33 應付',idempotencyKey:'p33-payable-payment-1'};
          const pp=await store.addPayablePayment(payableValues);
          const ppReplay=await store.addPayablePayment(payableValues);
          if(ppReplay.id!==pp.id) throw new Error('payable payment idempotency mismatch');
          state=store.getState();bank=state.banks.find(x=>x.id==='bank-p33');
          const paidPayable=state.payables.find(x=>x.id===payable.id);
          if(paidPayable.status!=='已付清'||paidPayable.paid!==1000) throw new Error('payable payment summary mismatch');
          if(state.payments.length!==1||state.bankTransactions.filter(x=>x.sourceId===pp.id).length!==1) throw new Error('payable bank linkage duplicate');
          if(bank.expense!==4515||bank.balance!==109905) throw new Error('payable bank debit mismatch');

          const usage=await store.saveMaterialUsage({date:'2026-11-07',employee:e1.id,project:project.id,material:material.id,vendor:vendor.id,quantity:2,unitPrice:100,note:'P33 領料'});
          state=store.getState();
          if(state.materials.find(x=>x.id===material.id).stock!==8) throw new Error('material usage stock deduction mismatch');
          if(usage.payableId) throw new Error('inventory usage must not create second payable');

          // Input invoice links to the existing payable without changing its principal.
          const inputInvoice=await store.saveInvoice({invoiceType:'input',sourceId:payable.id,payableId:payable.id,taxMode:'未稅',amount:1000,status:'issued',invoiceNumber:'P33IN0001',invoiceDate:'2026-11-06',note:'P33 進項'});
          if(inputInvoice.netAmount!==1000||inputInvoice.taxAmount!==50||inputInvoice.sourceId!==payable.id) throw new Error('input invoice mismatch');

          // Global consistency audit must find no blocking errors in this synthetic modern flow.
          const audit=await store.financialIntegrityAudit();
          if(audit.summary.blockingIssueCount!==0) throw new Error('financial audit blockers: '+JSON.stringify(audit.issues.filter(x=>x.severity==='BLOCKING')));

          // Read committed snapshot verifies IndexedDB + emergency mirror + journal consistency.
          const committed=await store.readCommittedSnapshot();
          const finalState=store.getState();
          const summary={
            bank:{opening:bank.openingBalance,income:bank.income,expense:bank.expense,balance:bank.balance},
            counts:{
              billings:finalState.billings.length,receivables:finalState.receivables.length,receipts:finalState.receipts.length,retentionReceipts:finalState.retentionReceipts.length,
              commissions:finalState.commissions.length,payroll:finalState.payroll.length,salaryPayments:finalState.salaryPayments.length,
              inventoryReceipts:finalState.inventoryReceipts.length,payables:finalState.payables.length,payments:finalState.payments.length,materialUsages:finalState.materialUsages.length,bankTransactions:finalState.bankTransactions.length
            },
            audit:audit.summary,
            revision:committed.revision
          };
          return {summary,ids:{customer:customer.id,project:project.id,e1:e1.id,e2:e2.id,batch,billing:billing.id,receivable:ar.id,material:material.id,payable:payable.id}};
        }""")

        # Reload in a new tab within the same browser context to verify persistence survives page close/reopen.
        ids=result["ids"]
        page.close()
        page2=context.new_page()
        page2.goto("http://127.0.0.1:8767/.p33-1-tests/full-flow.html")
        page2.wait_for_function("() => !!window.KuSheERPStore")
        persisted=page2.evaluate("""async (ids) => {
          const store=window.KuSheERPStore;await store.load();const s=store.getState();
          const bank=s.banks.find(x=>x.id==='bank-p33');
          const logs=s.dailyLogs.filter(x=>(x.batchId||x.id)===ids.batch);
          const ar=s.receivables.find(x=>x.id===ids.receivable);
          const material=s.materials.find(x=>x.id===ids.material);
          const payable=s.payables.find(x=>x.id===ids.payable);
          const audit=await store.financialIntegrityAudit();
          if(!bank||bank.balance!==109905) throw new Error('persisted bank mismatch');
          if(logs.length!==2||logs.some(x=>x.performance!==7000||x.commission!==3500)) throw new Error('persisted commission mismatch');
          if(!ar||ar.received!==13230||ar.remainingRetention!==0) throw new Error('persisted receivable mismatch');
          if(!material||material.stock!==8) throw new Error('persisted material stock mismatch');
          if(!payable||payable.status!=='已付清') throw new Error('persisted payable mismatch');
          if(audit.summary.blockingIssueCount!==0) throw new Error('persisted audit blockers');
          return {bankBalance:bank.balance,dailyLogs:logs.length,receivableReceived:ar.received,remainingRetention:ar.remainingRetention,stock:material.stock,payableStatus:payable.status,blocking:audit.summary.blockingIssueCount};
        }""", ids)
        print(json.dumps({"firstPass":result["summary"],"reloadPass":persisted},ensure_ascii=False,indent=2))
        browser.close()

if __name__=="__main__":
    run()
