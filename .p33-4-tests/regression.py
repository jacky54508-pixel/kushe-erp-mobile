from playwright.sync_api import sync_playwright
import json

ROOT = "http://127.0.0.1:8774/.p33-4-tests/fixture.html"
APPROVAL = "P33-4|2026-10-07|宏觀展業|劉佳勳+柯智耀"

def case(browser, mode):
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(ROOT + "?mode=" + mode)
    page.wait_for_function("() => !!window.KuSheERPStore")
    result = page.evaluate("""async (mode) => {
      const store=window.KuSheERPStore;
      await store.load();
      const read=()=>store.p33Oct07CommissionRepairPreview('p33-batch');
      const audit=read();
      const baseline=JSON.stringify(store.getState());
      const fail=(message)=>{throw new Error(message)};
      if(mode!=='normal'&&mode!=='stale'){
        if(audit.allowed||!audit.blockers.length)fail(mode+' must be BLOCKED');
        if(JSON.stringify(store.getState())!==baseline)fail(mode+' preview mutated original data');
        return {mode,allowed:audit.allowed,blockers:audit.blockers.map(b=>b.code),unchanged:true};
      }
      if(!audit.allowed)fail('normal synthetic preview blocked: '+JSON.stringify(audit.blockers));
      if(audit.payroll.length!==2||audit.payroll.some(x=>x.oldCommission!==1750||x.expectedCommission!==3500||x.difference!==1750||x.oldPayrollTotal!==1750||x.expectedPayrollTotal!==3500))fail('wrong synthetic preview');
      if(JSON.stringify(store.getState())!==baseline)fail('read only preview modified data');
      let rejected=false;
      try{await store.p33Oct07CommissionRepair('p33-batch',{confirmed:true,baseline:audit.baseline,phrase:'wrong',reason:'synthetic test'});}
      catch(e){rejected=true}
      if(!rejected||JSON.stringify(store.getState())!==baseline)fail('invalid approval was not rejected');
      if(mode==='stale'){
        await store.saveCustomer({name:'other synthetic customer'});
        const beforeStale=JSON.stringify(store.getState());
        try{await store.p33Oct07CommissionRepair('p33-batch',{confirmed:true,baseline:audit.baseline,phrase:'P33-4|2026-10-07|宏觀展業|劉佳勳+柯智耀',reason:'isolated baseline guard'});fail('stale baseline unexpectedly accepted')}
        catch(e){if(/unexpectedly accepted/.test(e.message))throw e;}
        if(JSON.stringify(store.getState())!==beforeStale)fail('stale rejection mutated state');
        return {mode,staleRejected:true,unchanged:true};
      }
      const before=structuredClone(store.getState());
      const result=await store.p33Oct07CommissionRepair('p33-batch',{confirmed:true,baseline:audit.baseline,phrase:'P33-4|2026-10-07|宏觀展業|劉佳勳+柯智耀',reason:'isolated finance regression'});
      if(!result.applied||result.changes.length!==2||!result.billingUnchanged)fail('writer result invalid');
      const after=store.getState();
      for(const k of Object.keys(before).filter(x=>!['dailyLogs','commissions','payroll','meta','audit'].includes(x)))
        if(JSON.stringify(before[k])!==JSON.stringify(after[k]))fail('protected collection changed: '+k);
      const unchanged=(key,ids)=>JSON.stringify(before[key].filter(x=>!ids.includes(x.id)))===JSON.stringify(after[key].filter(x=>!ids.includes(x.id)));
      if(!unchanged('dailyLogs',['p33-log-a','p33-log-b'])||!unchanged('commissions',['p33-com-a','p33-com-b'])||!unchanged('payroll',['p33-payroll-a','p33-payroll-b']))fail('unrelated business data changed');
      if(after.dailyLogs.some(x=>x.commission!==3500||x.performance!==7000||x.groupTotal!==14000||x.commissionBaseAmount!==14000))fail('daily values wrong');
      if(after.commissions.some(x=>x.commission!==3500||x.untaxedAmount!==7000||x.commissionBaseAmount!==14000))fail('commissions wrong');
      if(after.payroll.some(x=>x.commission!==3500||x.total!==3500||x.status!=='未付款'))fail('payroll totals wrong');
      if(after.bankTransactions.length||after.salaryPayments.length||after.receipts.length)fail('payment or bank appeared');
      const afterAudit=read();
      if(afterAudit.allowed)fail('applied correction may never be replayable');
      if(!after.audit.some(x=>String(x.action||'').includes('P33-4')))fail('missing audit trail');
      return {mode,allowed:audit.allowed,oldTotal:audit.oldCommissionTotal,newTotal:audit.correctCommissionTotal,difference:audit.totalDifference,applied:true,nonTargetsUnchanged:true,replayBlocked:true};
    }""", mode)
    ctx.close()
    return result

def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for mode in ['normal','stale','paid','receipt','duplicate','name-mismatch','wrong-amount','partial']:
            results.append(case(browser,mode))
        browser.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))
    print("P33_4_SYNTHETIC_FINANCIAL_GATES_PASS")

if __name__ == '__main__':
    main()
