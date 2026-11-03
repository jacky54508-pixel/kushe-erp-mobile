from playwright.sync_api import sync_playwright
import json
from pathlib import Path

ROOT="http://127.0.0.1:8795/.p33-4-tests/fixture.html"
MODULE="/assets/js/p35-historical-correction-ui.js"

def begin(browser,mode):
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    page.goto(ROOT+"?mode="+mode)
    page.wait_for_function("() => !!window.KuSheERPStore")
    page.add_script_tag(url=MODULE)
    page.evaluate("""async()=>{
      await window.KuSheERPStore.load();
      window.__initial=structuredClone(window.KuSheERPStore.getState());
      const btn=document.createElement('button');
      btn.dataset.p35Open='p33-batch';btn.textContent='10月7日更正';
      document.body.appendChild(btn);
    }""")
    return context,page

def test_success(browser):
    ctx,page=begin(browser,"normal")
    page.locator('[data-p35-open]').click()
    page.locator('#p35CommissionCorrectionConfirm').wait_for()
    assert page.locator('[data-p35-submit]').is_disabled()
    page.locator('[data-p35-phrase]').fill('確認更正')
    page.locator('[data-p35-reason]').fill('驗證合成資料依未稅金額重新計算抽成')
    page.locator('[data-p35-scope]').check()
    page.locator('[data-p35-backup-confirm]').check()
    assert page.locator('[data-p35-submit]').is_disabled(), "missing backup confirmation was not enforced"
    with page.expect_download() as outcome:
        page.locator('[data-p35-download]').click()
    downloaded=outcome.value
    assert downloaded.suggested_filename.endswith('.json'),downloaded.suggested_filename
    payload=json.loads(Path(downloaded.path()).read_text(encoding='utf-8'))
    assert payload['format']=='KuSheERP-P35-pre-correction-backup'
    assert payload['scope']['date']=='2026-10-07'
    assert payload['scope']['invoiceNo']=='B20261102-002'
    assert len(payload['data']['dailyLogs'])==2
    page.locator('[data-p35-submit]').click()
    page.wait_for_function("() => document.querySelector('[data-p35-feedback]')?.textContent.includes('已提交')",timeout=15000)
    result=page.evaluate("""()=>{
      const before=window.__initial,after=window.KuSheERPStore.getState();
      const protectedChanged=[];
      for(const key of Object.keys(before).filter(x=>!['dailyLogs','commissions','payroll','meta','audit'].includes(x)))
        if(JSON.stringify(before[key])!==JSON.stringify(after[key]))protectedChanged.push(key);
      return {
        status:document.querySelector('[data-p35-feedback]').textContent,
        protectedChanged,
        daily:after.dailyLogs.map(x=>({id:x.id,commission:x.commission,performance:x.performance,base:x.commissionBaseAmount})),
        commissions:after.commissions.map(x=>({id:x.id,commission:x.commission,untaxedAmount:x.untaxedAmount,base:x.commissionBaseAmount})),
        payroll:after.payroll.map(x=>({id:x.id,total:x.total,commission:x.commission,status:x.status})),
        bankTransactions:after.bankTransactions.length,salaryPayments:after.salaryPayments.length,receipts:after.receipts.length,
        secondGate:window.KuSheERPStore.p33Oct07CommissionRepairPreview('p33-batch').allowed,
        disabled:document.querySelector('[data-p35-submit]').disabled
      };
    }""")
    assert result['protectedChanged']==[],result
    assert all(row['commission']==3500 and row['performance']==7000 and row['base']==14000 for row in result['daily']),result
    assert all(row['commission']==3500 and row['untaxedAmount']==7000 and row['base']==14000 for row in result['commissions']),result
    assert all(row['commission']==3500 and row['total']==3500 and row['status']=='未付款' for row in result['payroll']),result
    assert result['bankTransactions']==result['salaryPayments']==result['receipts']==0,result
    assert result['secondGate']==False and result['disabled'],result
    ctx.close()
    return {"case":"success","backupSaved":True,"protectedCollectionsUnchanged":True,"nonRepeatable":True}

def test_block(browser,mode):
    ctx,page=begin(browser,mode)
    before=page.evaluate("() => JSON.stringify(window.KuSheERPStore.getState())")
    page.locator('[data-p35-open]').click()
    assert page.locator('#p35CommissionCorrectionConfirm').count()==0,mode
    after=page.evaluate("() => JSON.stringify(window.KuSheERPStore.getState())")
    assert before==after,mode
    ctx.close()
    return {"case":mode,"blocked":True,"noMutation":True}

def main():
    outcomes=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        outcomes.append(test_success(browser))
        for mode in ["paid","receipt","wrong-invoice","duplicate","name-mismatch","wrong-amount","partial","settled","not-owner"]:
            outcomes.append(test_block(browser,mode))
        browser.close()
    print(json.dumps(outcomes,ensure_ascii=False,indent=2))
    print("P35_UI_BACKUP_GATES_AND_EXACT_REPAIR_PASS")

if __name__=="__main__":
    main()
