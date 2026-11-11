"""P39-INV-1: real ERP Store writer with two completely synthetic invoices."""
from playwright.sync_api import sync_playwright

URL="http://127.0.0.1:8797/.p39-inv1-tests/real-store.html"

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,channel='chrome') if __import__('os').environ.get('P39_INV_USE_SYSTEM_CHROME')=='1' else pw.chromium.launch(headless=True)
        ctx=browser.new_context()
        page=ctx.new_page()
        page.goto(URL)
        page.wait_for_function("!!window.KuSheERPStore")
        result=page.evaluate("""async()=> {
          const store=window.KuSheERPStore;
          await store.load();
          const get=()=>structuredClone(store.getState());
          const before=get();
          const ids=['SYN-B-A','SYN-B-B'];
          const prior=store.externalBillingContext(ids);
          if(prior.sources.length!==2)throw Error('two sources missing');
          if(prior.sources[0].document.invoiceDate!=='2026-08-20'||
             prior.sources[1].document.invoiceDate!=='2026-10-20')
            throw Error('date mismatch');
          await store.saveInvoice({
            invoiceType:'output',sourceId:'SYN-B-A',billingId:'SYN-B-A',
            status:'issued',invoiceNumber:'SYN-AA000009',
            invoiceDate:'2026-08-25',note:'合成發票測試'
          },'SYN-B-A-I');
          const after=get(),current=store.externalBillingContext(ids);
          for(const key of ['receipts','retentionReceipts','bankTransactions',
            'banks','commissions','payroll','salaryPayments','attendance',
            'dailyLogs','projectCosts','payables','payments','customers','projects'])
            if(JSON.stringify(before[key])!==JSON.stringify(after[key]))
              throw Error('protected collection changed: '+key);
          const bSource=id=>String(id).startsWith('SYN-B-B');
          for(const key of ['billings','receivables','invoices']){
            const original=before[key].find(x=>bSource(x.id));
            const later=after[key].find(x=>x.id===original?.id);
            if(!original||JSON.stringify(original)!==JSON.stringify(later))
              throw Error('B source changed: '+key);
          }
          for(const [key,field] of [['billings','grossTotal'],
            ['receivables','amount'],['invoices','grossAmount']])
            if(JSON.stringify(before[key].map(x=>x[field]))!==
               JSON.stringify(after[key].map(x=>x[field])))
              throw Error('original finance amount changed: '+key);
          for(const key of ['billings','receivables','invoices'])
            if(after[key].length!==before[key].length)
              throw Error('duplicate financial record: '+key);
          if(current.sources[0].document.invoiceNo!=='SYN-AA000009'||
             current.sources[0].document.invoiceDate!=='2026-08-25'||
             current.sources[1].document.invoiceNo!=='SYN-BB000002'||
             current.sources[1].document.invoiceDate!=='2026-10-20'||
             current.snapshot===prior.snapshot)
            throw Error('original invoice link or CAS not refreshed');
          if(after.meta.externalBillingDocuments?.length)
            throw Error('group payment record created without permission');
          return {changedA:true,untouchedB:true,unchangedAmounts:true,
            twoInvoices:after.invoices.length,groupWrites:0};
        }""")
        assert result=={"changedA":True,"untouchedB":True,
            "unchangedAmounts":True,"twoInvoices":2,"groupWrites":0},result
        ctx.close()
        browser.close()
    print("P39_INV1_REAL_STORE_SYNTHETIC_PASS")

if __name__=="__main__":
    main()
