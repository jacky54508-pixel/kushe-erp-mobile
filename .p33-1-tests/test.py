from playwright.sync_api import sync_playwright
import json, sys, math

with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto("http://127.0.0.1:8766/.p33-1-tests/commission-rule.html")
    page.wait_for_function("() => !!window.KuSheERPStore")
    result=page.evaluate("""async () => {
      const store=window.KuSheERPStore;
      await store.load();

      const customer=await store.saveCustomer({name:'P33 測試建設'});
      const project=await store.saveProject({
        name:'P33 測試案場',customer:customer.id,status:'進行中',
        defaultRetentionMode:'none',defaultRetentionBase:'taxIncluded',
        defaultInvoiceChoice:'no_invoice',defaultTaxMode:'未稅',
        defaultCommissionBasis:'preTax'
      });
      const e1=await store.saveEmployee({name:'測試員工甲',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});
      const e2=await store.saveEmployee({name:'測試員工乙',dailyRate:2000,hourlyRate:0,commissionRate:25,commissionBasis:'preTax',status:'在職'});

      const batch=await store.saveDailyBatch({
        date:'2026-11-02',
        employeeIds:[e1.id,e2.id],
        commissionRates:{[e1.id]:25,[e2.id]:25},
        commissionBases:{[e1.id]:'preTax',[e2.id]:'preTax'},
        workRates:{},
        lines:[{
          project:project.id,house:'A1',item:'P33測試施工',itemName:'P33測試施工',
          unit:'式',qty:14,inputPrice:1000,unitPrice:1000,taxMode:'未稅',
          billable:true,sourceType:'manual',pricingType:'actual'
        }],
        workOnly:false,commissionEnabled:true,workMode:'none',workQty:0,note:'P33-1'
      });

      const state1=store.getState();
      const logs1=state1.dailyLogs.filter(x=>(x.batchId||x.id)===batch).sort((a,b)=>String(a.employee).localeCompare(String(b.employee)));
      const comm1=state1.commissions.filter(x=>x.sourceType==='daily-log'&&logs1.some(l=>l.id===x.sourceId)).sort((a,b)=>String(a.employee).localeCompare(String(b.employee)));
      const payroll1=store.monthlyPayrollGroups().filter(x=>x.month==='2026-11'&&[e1.id,e2.id].includes(x.employeeId)).sort((a,b)=>String(a.employeeId).localeCompare(String(b.employeeId)));
      const unbilled1=store.unbilledWork({project:project.id});

      const snap1={
        logs:logs1.map(x=>({employee:x.employee,performance:x.performance,untaxedPerformance:x.untaxedPerformance,taxIncludedPerformance:x.taxIncludedPerformance,untaxedCommissionBaseAmount:x.untaxedCommissionBaseAmount,taxIncludedCommissionBaseAmount:x.taxIncludedCommissionBaseAmount,commissionBaseAmount:x.commissionBaseAmount,rate:x.rate,commission:x.commission,groupTotal:x.groupTotal})),
        commissions:comm1.map(x=>({employee:x.employee,untaxedAmount:x.untaxedAmount,commissionBaseAmount:x.commissionBaseAmount,rate:x.rate,commission:x.commission})),
        payroll:payroll1.map(x=>({employeeId:x.employeeId,commission:x.commission,total:x.total})),
        unbilled:unbilled1.map(x=>({amount:x.amount,actualAmount:x.actualAmount,count:x.count}))
      };

      if(logs1.length!==2) throw new Error('expected 2 daily logs');
      for(const x of logs1){
        if(x.performance!==7000) throw new Error('performance must split to 7000');
        if(x.commissionBaseAmount!==14000) throw new Error('commission base must remain 14000');
        if(x.commission!==3500) throw new Error('commission must be 3500');
      }
      if(comm1.length!==2) throw new Error('expected 2 commission rows');
      for(const x of comm1){
        if(x.untaxedAmount!==7000) throw new Error('commission row performance must display 7000');
        if(x.commissionBaseAmount!==14000||x.commission!==3500) throw new Error('commission row base/amount mismatch');
      }
      if(payroll1.length!==2||payroll1.some(x=>x.commission!==3500)) throw new Error('payroll commission must be 3500 per employee');
      if(unbilled1.length!==1||unbilled1[0].amount!==14000||unbilled1[0].count!==1) throw new Error('billing source must remain single 14000');

      // Edit the same unbilled source from 14,000 to 16,000.
      const preview=store.dailyUnbilledEditPreview(batch);
      if(!preview.safe) throw new Error('unbilled edit preview not safe: '+preview.reason);
      const group=preview.groups.find(g=>g.safe);
      const row=group.rows.find(r=>r.editable);
      await store.saveDailyUnbilledItems(batch,{
        expectedFingerprint:preview.fingerprint,
        changes:[{groupId:group.groupId,workItemId:row.workItemId,qty:16}],
        additions:[]
      });
      const state2=store.getState();
      const logs2=state2.dailyLogs.filter(x=>(x.batchId||x.id)===batch).sort((a,b)=>String(a.employee).localeCompare(String(b.employee)));
      const comm2=state2.commissions.filter(x=>x.sourceType==='daily-log'&&logs2.some(l=>l.id===x.sourceId)).sort((a,b)=>String(a.employee).localeCompare(String(b.employee)));
      const payroll2=store.monthlyPayrollGroups().filter(x=>x.month==='2026-11'&&[e1.id,e2.id].includes(x.employeeId)).sort((a,b)=>String(a.employeeId).localeCompare(String(b.employeeId)));
      const unbilled2=store.unbilledWork({project:project.id});
      for(const x of logs2){
        if(x.performance!==8000) throw new Error('edited performance must split to 8000');
        if(x.commissionBaseAmount!==16000) throw new Error('edited commission base must be 16000');
        if(x.commission!==4000) throw new Error('edited commission must be 4000');
      }
      if(comm2.some(x=>x.untaxedAmount!==8000||x.commissionBaseAmount!==16000||x.commission!==4000)) throw new Error('edited commission rows mismatch');
      if(payroll2.some(x=>x.commission!==4000)) throw new Error('edited payroll commission mismatch');
      if(unbilled2.length!==1||unbilled2[0].amount!==16000) throw new Error('edited billing source must remain single 16000');

      // Change only employee A to tax-included commission basis: performance stays split,
      // commission base becomes the full tax-included construction amount (16,800).
      const g1=store.monthlyPayrollGroups().find(x=>x.month==='2026-11'&&x.employeeId===e1.id);
      await store.updatePayrollAdjustments(g1.key,{projectCommissionBases:{[project.id]:'taxIncluded'}});
      const state3=store.getState();
      const logA=state3.dailyLogs.find(x=>(x.batchId||x.id)===batch&&x.employee===e1.id);
      const logB=state3.dailyLogs.find(x=>(x.batchId||x.id)===batch&&x.employee===e2.id);
      const cA=state3.commissions.find(x=>x.sourceType==='daily-log'&&x.sourceId===logA.id);
      const cB=state3.commissions.find(x=>x.sourceType==='daily-log'&&x.sourceId===logB.id);
      const pA=store.monthlyPayrollGroups().find(x=>x.month==='2026-11'&&x.employeeId===e1.id);
      const pB=store.monthlyPayrollGroups().find(x=>x.month==='2026-11'&&x.employeeId===e2.id);
      if(logA.performance!==8000) throw new Error('basis switch must not overwrite split performance');
      if(logA.commissionBaseAmount!==16800||logA.commission!==4200) throw new Error('tax-included full-base commission mismatch');
      if(cA.untaxedAmount!==8000||cA.commissionBaseAmount!==16800||cA.commission!==4200) throw new Error('linked tax-included commission row mismatch');
      if(logB.performance!==8000||logB.commissionBaseAmount!==16000||logB.commission!==4000) throw new Error('other employee must remain unchanged');
      if(pA.commission!==4200||pB.commission!==4000) throw new Error('payroll basis switch mismatch');

      return {
        initial:snap1,
        afterUnbilledEdit:{
          logs:logs2.map(x=>({employee:x.employee,performance:x.performance,commissionBaseAmount:x.commissionBaseAmount,commission:x.commission})),
          unbilled:unbilled2.map(x=>({amount:x.amount,count:x.count}))
        },
        afterBasisSwitch:{
          employeeA:{performance:logA.performance,commissionBaseAmount:logA.commissionBaseAmount,commission:logA.commission,payrollCommission:pA.commission},
          employeeB:{performance:logB.performance,commissionBaseAmount:logB.commissionBaseAmount,commission:logB.commission,payrollCommission:pB.commission}
        }
      };
    }""")
    print(json.dumps(result,ensure_ascii=False,indent=2))
    browser.close()
