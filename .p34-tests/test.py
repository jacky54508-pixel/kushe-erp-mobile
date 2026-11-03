from playwright.sync_api import sync_playwright
import json

URL = "http://127.0.0.1:8784/.p34-tests/store.html"
LEGACY = "http://127.0.0.1:8784/.p33-4-tests/fixture.html"

def source_case(browser, mode, shares):
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_function("() => !!window.KuSheERPStore")
    result = page.evaluate("""async ({mode,shares})=>{
      const s=window.KuSheERPStore;
      await s.load();
      const c=await s.saveCustomer({name:'模擬測試建設'});
      const p=await s.saveProject({name:'測試工程',customer:c.id,status:'進行中',defaultRetentionMode:'none',defaultInvoiceChoice:'no_invoice',defaultTaxMode:'未稅',defaultCommissionBasis:'taxIncluded'});
      const employees=[];
      for(let i=0;i<Math.max(1,shares.length);i++)
        employees.push(await s.saveEmployee({name:'測試員工'+(i+1),dailyRate:2000,commissionRate:25,commissionBasis:'taxIncluded',status:'在職'}));
      const rates=Object.fromEntries(employees.map((e,i)=>[e.id,shares[i]]));
      const values={date:'2026-11-03',employeeIds:employees.map(e=>e.id),commissionRates:rates,commissionBases:Object.fromEntries(employees.map(e=>[e.id,'projectDefault'])),
        workRates:Object.fromEntries(employees.map(e=>[e.id,2000])),lines:[{project:p.id,house:'A1',item:'測試施工',unit:'式',qty:14,inputPrice:1000,unitPrice:1000,taxMode:'未稅',sourceType:'manual',pricingType:'actual',billable:true}],
        workOnly:mode==='work',commissionEnabled:mode!=='work',workMode:mode==='work'?'daily':'none',workQty:mode==='work'?1:0,note:mode==='work'?'純點工':'新施工抽成'};
      if(mode==='work')values.lines=[];
      const before=JSON.stringify(s.getState()),bankBefore=JSON.stringify(s.getState().banks);
      let batch=null,error=null;
      try{batch=await s.saveDailyBatch(values)}
      catch(e){error={message:String(e.message),code:String(e.code||'')}}
      const after=s.getState(),same=before===JSON.stringify(after),logs=after.dailyLogs.filter(log=>log.batchId===batch);
      if(bankBefore!==JSON.stringify(after.banks))throw Error('bank changed');
      return {mode,shares,error,batch,unchanged:same,logs:logs.map(x=>({commission:x.commission,performance:x.performance,base:x.commissionBaseAmount,basis:x.commissionBasis,groupTotal:x.groupTotal,workMode:x.workMode})),
        payroll:s.monthlyPayrollGroups().map(x=>({total:x.total,commission:x.commission,sourceCount:x.sources.length})),bankTransactions:after.bankTransactions.length,billings:after.billings.length};
    }""", {"mode":mode,"shares":shares})
    ctx.close()
    return result

def legacy_case(browser,mode):
    ctx=browser.new_context()
    page=ctx.new_page()
    page.goto(LEGACY+"?mode="+mode)
    page.wait_for_function("() => !!window.KuSheERPStore")
    page.add_script_tag(url="/assets/js/commission-history-audit.js")
    r=page.evaluate("""async()=>{
      const s=window.KuSheERPStore;await s.load();
      const before=JSON.stringify(s.getState());
      const report=window.KuSheCommissionHistoryAudit.inspect(s.getState(),s);
      if(JSON.stringify(s.getState())!==before)throw Error('audit changed business data');
      if(typeof s.p33Oct07CommissionRepair!=='function')throw Error('P35 guarded single-record writer not registered');
      let forbidden=false;
      try{await s.p33Oct07CommissionRepair('p33-batch',{});}
      catch(e){forbidden=true}
      if(!forbidden||JSON.stringify(s.getState())!==before)throw Error('P35 writer without confirmation must reject without changing data');
      return {counts:report.counts,delta:report.candidateDelta,row:report.rows[0]&&{status:report.rows[0].status,issues:report.rows[0].issues,staff:report.rows[0].staff.map(x=>({old:x.old,newAmount:x.newAmount,delta:x.delta}))},readOnly:report.readOnly};
    }""")
    ctx.close()
    return {"mode":mode,**r}

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        cases=[
          ("one",[50],[7000]),
          ("two",[25,25],[3500,3500]),
          ("three",[16.67,16.67,16.66],[2334,2334,2332]),
          ("custom",[20,15,15],[2800,2100,2100]),
          ("zero-worker",[50,0],[7000,0]),
          ("invalid-one",[25],None),
          ("invalid-two",[30,30],None),
          ("invalid-empty",[0,0],None),
          ("invalid-over",[60],None),
          ("invalid-precision",[16.666,16.667,16.667],None),
          ("work",[25,25],[0,0])
        ]
        out=[]
        for mode,shares,expected in cases:
            result=source_case(browser,mode,shares)
            if expected is None:
                assert result["error"] and result["unchanged"], (mode,"unsafe rejection",result)
            else:
                assert not result["error"] and len(result["logs"])==len(expected), (mode,"save error",result)
                assert sorted(x["commission"] for x in result["logs"])==sorted(expected),(mode,"commission",result)
                assert result["bankTransactions"]==0 and result["billings"]==0,(mode,"unexpected financial writer",result)
                if mode!="work":
                    assert all(x["basis"]=="preTax" and x["base"]==14000 for x in result["logs"]), (mode,"wrong preTax basis",result)
                    assert sorted(x["commission"] for x in result["payroll"])==sorted(x for x in expected if x>0),(mode,"payroll",result)
                else:
                    assert all(x["commission"]==0 for x in result["logs"]),(mode,"work-only commission",result)
            out.append({"mode":mode,"result":"PASS","sample":result["logs"] if expected is not None else result["error"]})
        legacy=legacy_case(browser,"normal")
        assert legacy["counts"]["candidate"]==1 and legacy["delta"]==3500 and legacy["readOnly"],legacy
        assert all(row["old"]==1750 and row["newAmount"]==3500 for row in legacy["row"]["staff"]),legacy
        paid=legacy_case(browser,"paid")
        assert paid["counts"]["blocked"]==1 and paid["counts"]["candidate"]==0,paid
        browser.close()
    print(json.dumps({"pool":out,"legacy_preview":legacy,"paid_gate":paid},ensure_ascii=False,indent=2))
    print("P34_50PCT_POOL_AND_READONLY_HISTORY_PASS")

if __name__=="__main__":
    main()
