from playwright.sync_api import sync_playwright
import json, sys

def check(cond,msg,data=None):
    if not cond:
        print("FAIL",msg)
        if data is not None: print(json.dumps(data,ensure_ascii=False,indent=2))
        sys.exit(1)

with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto("http://127.0.0.1:8765/.p33-tests/store.html")
    page.wait_for_function("() => !!window.KuSheERPStore")
    r=page.evaluate("""async () => {
      const store=window.KuSheERPStore; let stage="load";
      try{
      await store.load();
      stage="saveCustomer"; const customer=await store.saveCustomer({name:"鏈路測試建設"});
      stage="saveProject"; const project=await store.saveProject({name:"鏈路測試案場",customer:customer.id,status:"進行中",defaultRetentionMode:"none",defaultRetentionBase:"taxIncluded",defaultInvoiceChoice:"no_invoice",defaultTaxMode:"未稅",defaultCommissionBasis:"preTax"});
      stage="saveEmployeeA"; const a=await store.saveEmployee({name:"鏈路員工甲",dailyRate:2000,commissionRate:25,commissionBasis:"preTax",status:"在職"});
      stage="saveEmployeeB"; const b=await store.saveEmployee({name:"鏈路員工乙",dailyRate:2000,commissionRate:25,commissionBasis:"preTax",status:"在職"});
      const line={project:project.id,house:"A1",item:"鏈路施工",itemName:"鏈路施工",unit:"式",qty:2,inputPrice:7000,unitPrice:7000,taxMode:"未稅",billable:true,sourceType:"manual",pricingType:"actual"};

      stage="saveDailyBatch"; const batch=await store.saveDailyBatch({date:"2026-11-10",employeeIds:[a.id,b.id],performanceShares:{[a.id]:100,[b.id]:0},commissionRates:{[a.id]:25,[b.id]:25},commissionBases:{[a.id]:"preTax",[b.id]:"preTax"},workRates:{},lines:[line],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"chain"});
      let state=store.getState();
      const daily=state.dailyLogs.filter(x=>x.batchId===batch);
      const commissions=state.commissions.filter(x=>daily.some(d=>d.id===x.sourceId));
      const unbilled=store.unbilledWork({project:project.id})[0];
      const detail=unbilled.details[0];
      const sourceRef={workItemId:detail.workItemId||"",sourceGroupKey:detail.sourceGroupKey||"",sourceItemIndex:detail.sourceItemIndex,dailyLogIds:[...(detail.dailyLogIds||[])],date:detail.date||"",pricingType:detail.pricingType||"actual",taxMode:detail.taxMode||"未稅",quotationId:detail.quotationId||"",quotationLineId:detail.quotationLineId||""};

      stage="createBilling"; const billing=await store.createBilling({
        date:"2026-11-10",customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,billingMonth:"2026-11",
        taxMode:"未稅",invoiceStatus:"no_invoice",retentionMode:"none",retentionBase:"taxIncluded",
        lines:[{date:detail.date,house:String(detail.house||"").trim(),item:detail.item,unit:detail.unit,qty:detail.qty,price:detail.price,note:detail.note||"",pricingType:detail.pricingType||"actual",taxMode:detail.taxMode||"未稅",sourceRefs:[sourceRef]}],
        sourceItemRefs:[sourceRef],sourceContractRefs:[],note:"chain"
      });
      state=store.getState();
      const ar=state.receivables.filter(x=>x.billingId===billing.id);
      const billedLogs=state.dailyLogs.filter(x=>x.batchId===batch);
      let duplicateBillingError="";
      try{
        await store.createBilling({
          date:"2026-11-11",customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,billingMonth:"2026-11",
          taxMode:"未稅",invoiceStatus:"no_invoice",retentionMode:"none",retentionBase:"taxIncluded",
          lines:[{date:detail.date,house:String(detail.house||"").trim(),item:detail.item,unit:detail.unit,qty:detail.qty,price:detail.price,note:detail.note||"",pricingType:detail.pricingType||"actual",taxMode:detail.taxMode||"未稅",sourceRefs:[sourceRef]}],
          sourceItemRefs:[sourceRef],sourceContractRefs:[],note:"duplicate"
        });
      }catch(e){duplicateBillingError=String(e.message||e)}

      stage="saveWorkOnly"; const workBatch=await store.saveDailyBatch({date:"2026-11-12",employeeIds:[a.id],workRates:{[a.id]:2000},lines:[],workOnly:true,commissionEnabled:false,workMode:"daily",workQty:1,note:"純點工測試"});
      state=store.getState();
      const workLog=state.dailyLogs.find(x=>x.batchId===workBatch);
      const payroll=store.monthlyPayrollGroups().filter(x=>x.month==="2026-11").map(x=>({employeeId:x.employeeId,employeeName:x.employeeName,baseSalary:x.baseSalary,commission:x.commission,total:x.total}));

      stage="saveVendor"; const vendor=await store.saveVendor({name:"鏈路材料廠商"});
      stage="saveMaterial"; const material=await store.saveMaterial({name:"鏈路材料",code:"P33-MAT",unit:"支",vendor:vendor.id,unitPrice:100,inventoryMode:"opening",openingStock:10,note:""});
      stage="addInventoryReceipt"; const receipt=await store.addInventoryReceipt({material:material.id,quantity:5,unitPrice:100,date:"2026-11-10",note:"進貨",idempotencyKey:"p33-inv-1"});
      state=store.getState();
      const invPayable=state.payables.find(x=>x.id===receipt.payableId);
      const payableCountBeforeUsage=state.payables.length;
      stage="saveMaterialUsage"; const usage=await store.saveMaterialUsage({date:"2026-11-11",employee:a.id,project:project.id,material:material.id,vendor:vendor.id,quantity:3,unitPrice:100,note:"領料"});
      state=store.getState();
      const materialAfter=state.materials.find(x=>x.id===material.id);
      const payableCountAfterUsage=state.payables.length;
      stage="financialIntegrityAudit"; const audit=store.financialIntegrityAudit();

      return {
        __stage:"complete",
        daily:daily.map(x=>({employee:x.employee,performance:x.performance,share:x.performanceShare,commission:x.commission,groupTotal:x.groupTotal})),
        commissions:commissions.map(x=>({employee:x.employee,untaxedAmount:x.untaxedAmount,commission:x.commission})),
        unbilled:{amount:unbilled.amount,count:unbilled.count,details:unbilled.details.length},
        billing:{amount:billing.amount,total:billing.total,sourceRefs:(billing.sourceItemRefs||[]).length},
        ar:ar.map(x=>({amount:x.amount,received:x.received,status:x.status,billingId:x.billingId})),
        billedItems:billedLogs.map(x=>x.items.map(i=>({status:i.billingStatus,billingId:i.billingId}))),
        duplicateBillingError,
        work:{performance:workLog.performance,commission:workLog.commission,workMode:workLog.workMode,workQty:workLog.workQty,workRate:workLog.workRate,billable:workLog.billable},
        payroll,
        inventory:{opening:material.openingStock,afterReceipt:receipt.afterStock,afterUsage:materialAfter.stock,receiptAmount:receipt.amount,payableAmount:invPayable.amount,payableSourceType:invPayable.sourceType,usageMode:usage.accountingMode,payableCountBeforeUsage,payableCountAfterUsage},
        auditSummary:audit.summary,
        auditBlocking:(audit.issues||[]).filter(x=>x.severity==="BLOCKING").map(x=>({section:x.section,code:x.code,message:x.message}))
      };
      }catch(error){return {__error:String(error?.message||error),__stage:stage,stack:String(error?.stack||"")}}
    }""")
    print(json.dumps(r,ensure_ascii=False,indent=2))
    check("__error" not in r,"core chain JS error",r)
    check(sorted((x["performance"],x["share"],x["commission"]) for x in r["daily"])==[(0,0,0),(14000,100,3500)],"daily allocation",r)
    check(len(r["commissions"])==1 and r["commissions"][0]["untaxedAmount"]==14000 and r["commissions"][0]["commission"]==3500,"commission link",r)
    check(r["unbilled"]=={"amount":14000,"count":1,"details":1},"unbilled dedupe",r)
    check(r["billing"]["amount"]==14000 and r["billing"]["total"]==14000 and r["billing"]["sourceRefs"]>=1,"billing totals",r)
    check(len(r["ar"])==1 and r["ar"][0]["amount"]==14000 and r["ar"][0]["received"]==0,"billing -> AR",r)
    check(all(i["status"]=="已請款" and i["billingId"] for group in r["billedItems"] for i in group),"billing source lock",r)
    check(bool(r["duplicateBillingError"]),"duplicate billing was not blocked",r)
    check(r["work"]["performance"]==0 and r["work"]["commission"]==0 and r["work"]["billable"]==False and r["work"]["workRate"]==2000,"pure work separation",r)
    pA=next(x for x in r["payroll"] if x["employeeName"]=="鏈路員工甲")
    pB=next(x for x in r["payroll"] if x["employeeName"]=="鏈路員工乙")
    check(pA["baseSalary"]==2000 and pA["commission"]==3500 and pA["total"]==5500,"payroll A",r)
    check(pB["commission"]==0,"payroll B zero allocation",r)
    check(r["inventory"]["opening"]==10 and r["inventory"]["afterReceipt"]==15 and r["inventory"]["afterUsage"]==12,"inventory math",r)
    check(r["inventory"]["receiptAmount"]==500 and r["inventory"]["payableAmount"]==500 and r["inventory"]["payableSourceType"]=="inventory-receipt","inventory payable",r)
    check(r["inventory"]["usageMode"]=="inventory-cost-only" and r["inventory"]["payableCountBeforeUsage"]==r["inventory"]["payableCountAfterUsage"],"usage duplicated payable",r)
    check(len(r["auditBlocking"])==0,"financial integrity blocking issues",r)
    print("P33_CORE_CHAIN_PASS")
    browser.close()
