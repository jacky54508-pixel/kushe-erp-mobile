"""P39-3B synthetic Store integration: effective AR/retention shared with actual receipt transaction gates.
No real customer information; local Chromium fixture, no cloud calls or production server.
"""
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8796/p39-candidate/effective-store-fixture.html"

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        ctx=browser.new_context()
        page=ctx.new_page()
        errors=[]
        remote=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        page.on("request",lambda request:remote.append(request.url)
                if not request.url.startswith("http://127.0.0.1:8796/") else None)
        page.goto(URL)
        page.wait_for_function("!!window.KuSheERPStore && !!window.KusheP393EffectiveAccounting")
        result=page.evaluate("""async()=>{
          const store=window.KuSheERPStore;
          await store.load();
          const s=()=>store.getState();
          const view=()=>store.p39ReceivableEffectiveAmounts('syn-ar');
          const original=JSON.parse(JSON.stringify(s()));
          if(!view().hasAllowance||view().receivable!==90000||
             view().retention!==4500||view().outstanding!==90000)
            throw Error('effective AR/retention mismatch');
          const summary=store.p39BillingAllowanceSummary();
          if(summary.count!==1||summary.gross!==10500||summary.receivable!==10000)
            throw Error('independent allowance summary mismatch');
          if(store.billingEditable('syn-b'))
            throw Error('original billing must be edit-locked after candidate allowance');
          let invoiceLocked=false;
          try{
            await store.updateBillingInvoice('syn-b',{invoiceChoice:'invoice_required',invoiceNo:'',invoiceDate:'2026-11-11'});
          }catch(e){invoiceLocked=e.code==='P39_ALLOWANCE_INVOICE_LOCKED'}
          if(!invoiceLocked)throw Error('original invoice writer not locked');
          if(JSON.stringify(s())!==JSON.stringify(original))
            throw Error('invoice denial unexpectedly modified state');
          const collect=(amount)=>store.addReceipt({receivableId:'syn-ar',date:'2026-11-11',
            amount:String(amount),bankId:'syn-bank',paymentMethod:'銀行轉帳',
            fee:'0',feePayer:'company',note:'合成收款'});
          let overBlocked=false;
          try{await collect(90001)}catch(e){overBlocked=/超過|未收餘額|剩餘|可收/.test(e.message||'')}
          if(!overBlocked)throw Error('overcollection was not blocked');
          if(JSON.stringify(s())!==JSON.stringify(original))
            throw Error('failed receipt changed original or bank');
          const receipt=await collect(90000);
          if(!receipt?.id||s().receivables[0].received!==90000)
            throw Error('expected synthetic receipt was not committed');
          if(s().receivables[0].amount!==100000||view().outstanding!==0)
            throw Error('original AR overwritten or effective balance mismatch');
          if(s().bankTransactions.length!==1||s().bankTransactions[0].amount!==90000)
            throw Error('synthetic bank income not consistent');
          let extraBlocked=false;
          try{await collect(1)}catch(e){extraBlocked=true}
          if(!extraBlocked)throw Error('repeat overcollection accepted');
          const retained=(amount)=>store.addRetentionReceipt({receivableId:'syn-ar',
            amount:String(amount),bankId:'syn-bank',date:'2026-11-11',
            fee:0,feePayer:'company',paymentMethod:'銀行轉帳',note:'合成保留款'});
          const afterReceipt=JSON.stringify(s());
          let retentionBlocked=false;
          try{await retained(4501)}catch(e){retentionBlocked=/保留款|剩餘/.test(e.message||'')}
          if(!retentionBlocked)throw Error('over-retention was not blocked');
          if(JSON.stringify(s())!==afterReceipt)
            throw Error('failed retention changed original data');
          const retention=await retained(4500);
          if(!retention?.id||view().retentionOutstanding!==0||
             s().receivables[0].retentionAmount!==5000||
             s().receivables[0].retentionReceived!==4500)
            throw Error('synthetic retention receipt and original retention mismatch');
          if(s().bankTransactions.length!==2)
            throw Error('expected only two synthetic bank records');
          if(s().payroll.length||s().commissions.length||s().salaryPayments.length)
            throw Error('protected payroll/commission collections changed');
          if(s().billings[0].grossTotal!==105000||s().invoices[0].grossAmount!==105000)
            throw Error('historical billing/invoice totals overwritten');
          return {invoiceLocked,overBlocked,extraBlocked,retentionBlocked,
            originalGross:s().billings[0].grossTotal,originalAR:s().receivables[0].amount,
            effectiveAR:view().receivable,effectiveRetention:view().retention,
            bankTransactions:s().bankTransactions.length};
        }""")
        assert result["invoiceLocked"] and result["overBlocked"],result
        assert result["extraBlocked"] and result["retentionBlocked"],result
        assert result["originalGross"]==105000 and result["originalAR"]==100000,result
        assert result["effectiveAR"]==90000 and result["effectiveRetention"]==4500,result
        assert result["bankTransactions"]==2,result
        assert not errors,errors
        assert not remote,remote
        print("PASS P39-3B synthetic Store: invoice lock, AR/retention collection ceiling, CAS, bank, originals unchanged")
        ctx.close()
        browser.close()

if __name__=="__main__":
    main()
