"""P40-3 real ERP Store, synthetic quotes only; no Supabase or production data."""
import os
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8797/.p40-5b-tests/revision_store.html"
def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel="chrome") if os.getenv("P39_INV_USE_SYSTEM_CHROME")=="1" else pw.chromium.launch(headless=True)
        context=browser.new_context()
        page=context.new_page()
        page.goto(URL)
        page.wait_for_function("() => !!window.KuSheERPStore")
        result=page.evaluate("""async()=> {
          const store=window.KuSheERPStore;
          await store.load();
          const read=()=>structuredClone(store.getState()),before=read();
          const original=before.quotations.find(q=>q.id==='SYN-Q-ORIGINAL');
          const revision=before.quotations.find(q=>q.id==='SYN-Q-REVISION');
          if(!original||!revision||revision.status!=='草稿')throw Error('fixture missing');
          const fields=['commissions','payroll','salaryPayments','billings','receivables','invoices','bankTransactions','banks','receipts','projects','customers'];
          const frozen=Object.fromEntries(fields.map(key=>[key,JSON.stringify(before[key])]));
          let forbidden=0;
          async function rejects(action,label) {
            const pre=JSON.stringify(read());
            let error=null;
            try{await action()}catch(e){error={message:String(e.message||e),code:String(e.code||'')};}
            if(!error||!error.message.includes('議價'))throw Error(label+' did not block note-only revision: '+JSON.stringify(error));
            if(pre!==JSON.stringify(read()))throw Error(label+' mutated Store on failure');
            forbidden++;
          }
          const line=(price)=>({house:'L1',item:'虛構鋁窗美容',unit:'式',pricingType:'actual',qty:52,price,lumpSumAmount:0});
          const values=(price,status)=>({customer:'SYN-CUST',project:'SYN-PROJECT',pricingMode:'actual',taxMode:'未稅',status,lines:[line(price)],date:'2026-11-14',internalNote:'議價每戶改為23500',publicNote:'',lumpSumTotal:0});
          await rejects(()=>store.setQuotationStatus(revision.id,'已送出'),'direct send');
          await rejects(()=>store.setQuotationStatus(revision.id,'已確認'),'direct confirm');
          await rejects(()=>store.saveQuotation(values(24000,'已送出'),revision.id),'saveQuotation send');
          await rejects(()=>store.saveQuotationBundle(values(24000,'已確認'),revision.id,{projectPrices:[]}),'saveQuotationBundle confirm');
          // Saving an unapproved draft is allowed and cannot modify existing accounting.
          await store.saveQuotation(values(24000,'草稿'),revision.id);
          await rejects(()=>store.setQuotationStatus(revision.id,'已確認'),'confirm saved note-only draft');
          // Legitimate negotiated unit price must be changed explicitly.
          await store.saveQuotation(values(23500,'草稿'),revision.id);
          await store.setQuotationStatus(revision.id,'已送出');
          const after=read();
          const revised=after.quotations.find(q=>q.id===revision.id);
          if(revised.status!=='已送出'||revised.lines[0].price!==23500||revised.amount!==1222000)
            throw Error('revised financial preview inaccurate '+JSON.stringify(revised));
          const unchangedOriginal=JSON.stringify(after.quotations.find(q=>q.id===original.id))===JSON.stringify(original);
          if(!unchangedOriginal)throw Error('original confirmed quotation changed');
          for(const key of fields)if(JSON.stringify(after[key])!==frozen[key])throw Error('protected finance changed: '+key);
          return {blockedPaths:forbidden,correctedUnitPrice:revised.lines[0].price,negotiatedAmount:revised.amount,originalUnchanged:unchangedOriginal,protectedCollections:fields.length};
        }""")
        assert result=={"blockedPaths":5,"correctedUnitPrice":23500,"negotiatedAmount":1222000,"originalUnchanged":True,"protectedCollections":11},result
        context.close()
        browser.close()
    print("PASS P40-3: Store direct send/confirm/saveBundle blocked; real revision approved only when price changes; originals and finance unchanged")

if __name__=="__main__":
    main()
