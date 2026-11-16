"""P40-14: ONLY imaginary 6 historical billing patterns; no real customer/accounting reads.
Test actual KuShe ERP billing Store and prospective readonly customer modal.
"""
import json,os
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8797/.p40-14-tests/synthetic_history.html"
def main():
  with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
    context=browser.new_context(viewport={"width":1180,"height":920},device_scale_factor=1)
    page=context.new_page()
    unexpected=[]
    page.on("request",lambda req:unexpected.append(req.url) if not req.url.startswith("http://127.0.0.1:8797/") else None)
    page.goto(URL,wait_until="load")
    page.wait_for_function("() => !!window.KuSheERPStore && !!window.KusheBillingDiscountPreview && !!window.KusheBilling")
    page.evaluate("async()=>await window.KuSheERPStore.load()")
    before=page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")
    result=page.evaluate("""()=>{
      const fn=window.KusheBillingDiscountPreview.readBilling;
      const list=[];
      for(let i=1;i<=6;i++){
        const id='SYN-LEGACY-'+i;
        try{fn(id);list.push({id,result:'UNSAFE_ACCEPT'})}
        catch(error){list.push({id,result:'SAFE_BLOCK',reason:String(error.message||error)})}
      }
      for(const id of ['SYN-INVALID-AR','SYN-AMBIGUOUS']){
        try{fn(id);list.push({id,result:'UNSAFE_ACCEPT'})}
        catch(error){list.push({id,result:'SAFE_BLOCK',reason:String(error.message||error)})}
      }
      const valid=fn('SYN-EDIT'),money=window.KusheP40DiscountPreview.preview({
        original:valid.original,approval:{amountType:'gross',amount:99750}});
      return {list,validTotal:money.proposed.grossTotal,validReceivable:money.proposed.receivable};
    }""")
    assert len(result["list"])==8,result
    assert all(x["result"]=="SAFE_BLOCK" for x in result["list"]),result
    assert all("稅額" in x["reason"] for x in result["list"][:5]),result
    assert "保留款" in result["list"][5]["reason"],result
    assert "金額" in result["list"][6]["reason"] or "應收" in result["list"][6]["reason"],result
    assert "唯一" in result["list"][7]["reason"],result
    assert result["validTotal"]==99750,result
    assert result["validReceivable"]==94762,result
    assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before

    # Inspect the actual customer flow in original billing detail.
    page.evaluate("window.KusheBilling.openDetail('SYN-LEGACY-1')")
    button=page.locator("[data-billing-discount-readonly]")
    assert button.count()==1
    button.click()
    toast=page.evaluate("window.__p40_last_toast")
    assert "原稅額計算方式不明" in toast,toast
    assert page.locator(".p40-12-shade").count()==0
    assert page.evaluate("JSON.stringify(window.KuSheERPStore.getState())")==before
    assert not unexpected,unexpected
    context.close()
    browser.close()
  print("PASS P40-14: 6 realistic legacy missing-field patterns, AR mismatch and ambiguous source fail closed; one complete invoice calculates, zero Store writes")

if __name__=="__main__":
  main()
