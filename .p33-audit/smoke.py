from playwright.sync_api import sync_playwright
import json, sys

def fail(msg, data=None):
    print("FAIL:",msg)
    if data is not None: print(json.dumps(data,ensure_ascii=False,indent=2))
    sys.exit(1)

with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto("http://127.0.0.1:8765/.p33-audit/store-test.html")
    page.wait_for_function("() => !!window.KuSheERPStore")
    result=page.evaluate("""async () => {
      const store=window.KuSheERPStore;
      const blank=structuredClone(await store.load());
      blank.settings={...(blank.settings||{}),defaultTax:5};
      blank.banks=[{id:'bank-audit',name:'測試銀行',openingBalance:100000,income:0,expense:0,balance:100000,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
      await store.loadEphemeralSnapshot(blank,{userId:'audit-user',syncVersion:1,updatedAt:new Date().toISOString(),fingerprint:'seed'});

      const customer=await store.saveCustomer({name:'合成建設',taxId:'',contact:'',phone:'',email:'',address:'',note:''});
      const project=await store.saveProject({name:'合成案場',customer:customer.id,status:'進行中',defaultRetentionMode:'none',defaultRetentionBase:'taxIncluded',defaultInvoiceChoice:'no_invoice',defaultTaxMode:'未稅',defaultCommissionBasis:'preTax'});
      const e1=await store.saveEmployee({name:'員工甲',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});
      const e2=await store.saveEmployee({name:'員工乙',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});
      const line={project:project.id,house:'A1',item:'合成施工',itemName:'合成施工',unit:'式',qty:2,inputPrice:7000,unitPrice:7000,taxMode:'未稅',billable:true,sourceType:'manual',pricingType:'actual'};

      const one=await store.saveDailyBatch({date:'2026-11-02',employeeIds:[e1.id],commissionRates:{[e1.id]:25},commissionBases:{[e1.id]:'preTax'},workRates:{},lines:[line],workOnly:false,commissionEnabled:true,workMode:'none',workQty:0,note:'single'});
      let state=store.getState();
      const oneLogs=state.dailyLogs.filter(x=>x.batchId===one);
      const oneResult=oneLogs.map(x=>({employee:x.employee,performance:x.performance,commission:x.commission}));
      await store.deleteDailyBatch(one);

      const two=await store.saveDailyBatch({date:'2026-11-02',employeeIds:[e1.id,e2.id],commissionRates:{[e1.id]:25,[e2.id]:25},commissionBases:{[e1.id]:'preTax',[e2.id]:'preTax'},workRates:{},lines:[line],workOnly:false,commissionEnabled:true,workMode:'none',workQty:0,note:'two'});
      state=store.getState();
      const twoLogs=state.dailyLogs.filter(x=>x.batchId===two).sort((a,b)=>String(a.employee).localeCompare(String(b.employee)));
      const twoResult=twoLogs.map(x=>({employee:x.employee,employeeName:x.employeeName,performance:x.performance,commission:x.commission,groupTotal:x.groupTotal}));
      const unbilled=store.unbilledWork({project:project.id});
      const u=unbilled[0];
      const detail=u.details[0];

      const billing=await store.createBilling({
        date:'2026-11-02',customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,
        billingMonth:'2026-11',taxMode:'未稅',invoiceStatus:'no_invoice',retentionMode:'none',retentionBase:'taxIncluded',
        lines:[{date:'2026-11-02',item:detail.item,unit:detail.unit,qty:detail.qty,price:detail.price,sourceRefs:[detail]}],
        sourceItemRefs:[detail],sourceContractRefs:[],note:'synthetic'
      });
      state=store.getState();
      const ar=state.receivables.find(x=>x.billingId===billing.id);
      const receipt=await store.addReceipt({receivableId:ar.id,date:'2026-11-02',amount:ar.amount,fee:0,feePayer:'company',bankId:'bank-audit',paymentMethod:'銀行轉帳',note:'synthetic',idempotencyKey:'receipt-1'});
      state=store.getState();
      const arAfter=state.receivables.find(x=>x.id===ar.id);
      const bankAfterReceipt=state.banks.find(x=>x.id==='bank-audit');

      const payable=await store.savePayable({date:'2026-11-02',payeeName:'合成廠商',projectId:project.id,category:'其他',item:'合成應付',amount:5000,note:'synthetic'});
      const payment=await store.addPayablePayment({payableId:payable.id,date:'2026-11-02',amount:5000,fee:0,feePayer:'company',bankId:'bank-audit',paymentMethod:'銀行轉帳',note:'synthetic',idempotencyKey:'payable-1'});
      state=store.getState();
      const bankFinal=state.banks.find(x=>x.id==='bank-audit');
      const payroll=store.monthlyPayrollGroups().filter(x=>x.month==='2026-11').map(x=>({employeeName:x.employeeName,commission:x.commission,total:x.total,sources:x.sources.map(s=>({type:s.type,amount:s.amount}))}));
      const audit=store.financialIntegrityAudit();
      return {
        oneResult,twoResult,
        unbilled:{amount:u?.amount,count:u?.count,details:u?.details?.length},
        billing:{amount:billing.amount,total:billing.total,grossTotal:billing.grossTotal,retention:billing.retention},
        receivableBefore:{amount:ar.amount},receivableAfter:{amount:arAfter.amount,received:arAfter.received,status:arAfter.status},
        receipt:{amount:receipt.amount,netAmount:receipt.netAmount},
        bankAfterReceipt:{income:bankAfterReceipt.income,expense:bankAfterReceipt.expense,balance:bankAfterReceipt.balance},
        payable:{amount:payable.amount,paid:store.getState().payables.find(x=>x.id===payable.id).paid,status:store.getState().payables.find(x=>x.id===payable.id).status},
        payment:{amount:payment.amount,actualDebit:payment.actualDebit},
        bankFinal:{income:bankFinal.income,expense:bankFinal.expense,balance:bankFinal.balance},
        payroll,
        audit:{summary:audit.summary,issues:(audit.issues||[]).slice(0,20).map(x=>({section:x.section,code:x.code,severity:x.severity,message:x.message}))}
      };
    }""")
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if result["oneResult"][0]["performance"] != 14000 or result["oneResult"][0]["commission"] != 3500:
        fail("single employee commission regression",result)
    if result["unbilled"]["amount"] != 14000:
        fail("unbilled duplicated/missing",result)
    if result["billing"]["amount"] != 14000 or result["receivableAfter"]["received"] != 14000:
        fail("billing/AR/receipt chain mismatch",result)
    if result["bankFinal"]["income"] != 14000 or result["bankFinal"]["expense"] != 5000 or result["bankFinal"]["balance"] != 109000:
        fail("bank chain mismatch",result)
    # Current known defect: two employees are force-split 50/50. Assert exact reproduction so the audit cannot silently drift.
    if sorted((x["performance"],x["commission"]) for x in result["twoResult"]) != [(7000,1750),(7000,1750)]:
        fail("known commission split behavior changed unexpectedly",result)
    print("P33_SYNTHETIC_CHAIN_PASS_WITH_KNOWN_COMMISSION_SPLIT_DEFECT")
    browser.close()
