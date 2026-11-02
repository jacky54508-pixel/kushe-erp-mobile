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
      if(typeof store.p33Oct07CommissionRepair!=='undefined')
        fail('unsafe P33-4 historic mutation writer must be disabled');
      if(mode==='stale'){
        await store.saveCustomer({name:'synthetic modified snapshot'});
        const changed=read();
        if(changed.baseline===audit.baseline)fail('historical preview baseline was not refreshed');
        return {mode,staleDetected:true,readOnly:true};
      }
      return {mode,previewOnly:true,allowed:audit.allowed,oldTotal:audit.oldCommissionTotal,newTotal:audit.correctCommissionTotal,difference:audit.totalDifference,writerDisabled:true};
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
    print("P33_4_READONLY_PREVIEW_AND_WRITER_DISABLED_PASS")

if __name__ == '__main__':
    main()
