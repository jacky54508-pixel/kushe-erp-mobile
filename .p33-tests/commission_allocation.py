from playwright.sync_api import sync_playwright
import json, sys

def assert_eq(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")

with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto("http://127.0.0.1:8765/.p33-tests/store.html")
    page.wait_for_function("() => !!window.KuSheERPStore")
    result=page.evaluate("""async () => {
      const store=window.KuSheERPStore;
      await store.load();
      const customer=await store.saveCustomer({name:"測試建設"});
      const project=await store.saveProject({name:"測試案場",customer:customer.id,status:"進行中",defaultRetentionMode:"none",defaultRetentionBase:"taxIncluded",defaultInvoiceChoice:"no_invoice",defaultTaxMode:"未稅",defaultCommissionBasis:"preTax"});
      const a=await store.saveEmployee({name:"員工甲",dailyRate:2000,commissionRate:25,commissionBasis:"preTax",status:"在職"});
      const b=await store.saveEmployee({name:"員工乙",dailyRate:2000,commissionRate:25,commissionBasis:"preTax",status:"在職"});
      const line=(qty=2)=>({project:project.id,house:"A1",item:"合成施工",itemName:"合成施工",unit:"式",qty,inputPrice:7000,unitPrice:7000,taxMode:"未稅",billable:true,sourceType:"manual",pricingType:"actual"});

      const single=await store.saveDailyBatch({date:"2026-11-02",employeeIds:[a.id],commissionRates:{[a.id]:25},commissionBases:{[a.id]:"preTax"},lines:[line()],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"single"});
      let state=store.getState();
      const singleLog=state.dailyLogs.find(x=>x.batchId===single&&x.employee===a.id);
      const singleResult={performance:singleLog.performance,share:singleLog.performanceShare,commission:singleLog.commission};
      await store.deleteDailyBatch(single);

      let missingShareError="";
      try{
        await store.saveDailyBatch({date:"2026-11-03",employeeIds:[a.id,b.id],commissionRates:{[a.id]:25,[b.id]:25},commissionBases:{[a.id]:"preTax",[b.id]:"preTax"},lines:[line()],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"missing"});
      }catch(error){missingShareError=String(error.message||error)}

      let invalidTotalError="";
      try{
        await store.saveDailyBatch({date:"2026-11-03",employeeIds:[a.id,b.id],performanceShares:{[a.id]:60,[b.id]:60},commissionRates:{[a.id]:25,[b.id]:25},commissionBases:{[a.id]:"preTax",[b.id]:"preTax"},lines:[line()],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"invalid"});
      }catch(error){invalidTotalError=String(error.message||error)}

      const allocated=await store.saveDailyBatch({date:"2026-11-04",employeeIds:[a.id,b.id],performanceShares:{[a.id]:100,[b.id]:0},commissionRates:{[a.id]:25,[b.id]:25},commissionBases:{[a.id]:"preTax",[b.id]:"preTax"},lines:[line()],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"100-0"});
      state=store.getState();
      let allocatedLogs=state.dailyLogs.filter(x=>x.batchId===allocated).sort((x,y)=>x.employeeName.localeCompare(y.employeeName,"zh-Hant"));
      const allocatedResult=allocatedLogs.map(x=>({name:x.employeeName,performance:x.performance,share:x.performanceShare,commission:x.commission,groupTotal:x.groupTotal}));
      const unbilledBefore=store.unbilledWork({project:project.id})[0];
      const preview=store.dailyUnbilledEditPreview(allocated);
      const group=preview.groups[0],editable=group.rows.find(row=>row.editable);
      await store.saveDailyUnbilledItems(allocated,{expectedFingerprint:preview.fingerprint,changes:[{groupId:group.groupId,workItemId:editable.workItemId,qty:3}],additions:[]});
      state=store.getState();
      allocatedLogs=state.dailyLogs.filter(x=>x.batchId===allocated).sort((x,y)=>x.employeeName.localeCompare(y.employeeName,"zh-Hant"));
      const amendedResult=allocatedLogs.map(x=>({name:x.employeeName,performance:x.performance,share:x.performanceShare,commission:x.commission,groupTotal:x.groupTotal}));
      const unbilledAfter=store.unbilledWork({project:project.id})[0];
      await store.deleteDailyBatch(allocated);

      const half=await store.saveDailyBatch({date:"2026-11-05",employeeIds:[a.id,b.id],performanceShares:{[a.id]:50,[b.id]:50},commissionRates:{[a.id]:25,[b.id]:25},commissionBases:{[a.id]:"preTax",[b.id]:"preTax"},lines:[line()],workOnly:false,commissionEnabled:true,workMode:"none",workQty:0,note:"50-50"});
      state=store.getState();
      const halfResult=state.dailyLogs.filter(x=>x.batchId===half).map(x=>({performance:x.performance,share:x.performanceShare,commission:x.commission})).sort((x,y)=>x.performance-y.performance);

      return {singleResult,missingShareError,invalidTotalError,allocatedResult,unbilledBefore:{amount:unbilledBefore.amount,count:unbilledBefore.count},amendedResult,unbilledAfter:{amount:unbilledAfter.amount,count:unbilledAfter.count},halfResult};
    }""")
    print(json.dumps(result,ensure_ascii=False,indent=2))

    assert_eq(result["singleResult"],{"performance":14000,"share":100,"commission":3500},"single employee")
    if "業績分配" not in result["missingShareError"]: raise AssertionError("missing share was not blocked")
    if "100%" not in result["invalidTotalError"]: raise AssertionError("invalid total was not blocked")
    assert_eq(sorted((x["performance"],x["share"],x["commission"]) for x in result["allocatedResult"]),[(0,0,0),(14000,100,3500)],"100/0 allocation")
    assert_eq(result["unbilledBefore"],{"amount":14000,"count":1},"unbilled once before amendment")
    assert_eq(sorted((x["performance"],x["share"],x["commission"]) for x in result["amendedResult"]),[(0,0,0),(21000,100,5250)],"100/0 preserved after amendment")
    assert_eq(result["unbilledAfter"],{"amount":21000,"count":1},"unbilled once after amendment")
    assert_eq([(x["performance"],x["share"],x["commission"]) for x in result["halfResult"]],[(7000,50,1750),(7000,50,1750)],"50/50 explicit allocation")
    print("P33_COMMISSION_ALLOCATION_PASS")
    browser.close()
