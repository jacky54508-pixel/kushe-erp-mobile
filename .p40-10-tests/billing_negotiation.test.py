"""P40-10 real ERP Store reconciliation tests. Synthetic fixture only, loopback localhost."""
import os
from playwright.sync_api import sync_playwright

URL='http://127.0.0.1:8797/.p40-10-tests/synthetic_billing.html'
def main():
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,channel='chrome') if os.getenv('P39_INV_USE_SYSTEM_CHROME')=='1' else pw.chromium.launch(headless=True)
  context=browser.new_context()
  page=context.new_page()
  page.goto(URL)
  page.wait_for_function("() => !!window.KuSheERPStore")
  result=page.evaluate("""async()=>{
   const store=window.KuSheERPStore;
   await store.load();
   const get=()=>structuredClone(store.getState());
   const original=get();
   const protectedSets=['dailyLogs','commissions','payroll','salaryPayments','bankTransactions',
                        'banks','receipts','retentionReceipts','payments','payables','projects','customers'];
   const freeze=Object.fromEntries(protectedSets.map(key=>[key,JSON.stringify(original[key])]));
   const ids=['SYN-EDIT','SYN-ISSUED','SYN-RECEIVED','SYN-CHEQUE','SYN-RETENTION'];
   const editing=ids.map(id=>({id,editable:store.billingEditable(id)}));
   if(JSON.stringify(editing.map(x=>x.editable))!==JSON.stringify([true,false,false,false,false]))
    throw Error('billing lock classification is unsafe '+JSON.stringify(editing));
   // Preview must not persist anything.
   const proposed=store.calculateBilling({taxMode:'未稅',invoiceStatus:'invoice_pending',
     retentionMode:'5',retentionBase:'taxIncluded',
     lines:[{qty:10,price:9500}]});
   if(proposed.untaxed!==95000||proposed.tax!==4750||proposed.grossTotal!==99750||
      proposed.retention!==4988||proposed.receivable!==94762)
      throw Error('discount retention/tax/AR forecast wrong '+JSON.stringify(proposed));
   if(JSON.stringify(get())!==JSON.stringify(original))throw Error('preview wrote to Store');
   const input={date:'2026-11-16',number:'SYN-SYN-EDIT',taxMode:'未稅',invoiceChoice:'invoice_required',
     invoiceStatus:'invoice_pending',invoiceNo:'',retentionMode:'5',retentionBase:'taxIncluded',
     lines:[{id:'SYN-EDIT-LINE',item:'虛構牆面美容',unit:'式',qty:10,price:9500,date:'2026-11-16'}],
     note:'議價後單價調整（虛構測試）'};
   let stopped=0;
   for(const id of ids.slice(1)){
     const before=JSON.stringify(get());let blocked=false;
     try{await store.updateBilling(id,{...input,number:'SYN-'+id,lines:[{...input.lines[0],id:id+'-LINE'}]})}
     catch(error){blocked=true;}
     if(!blocked||JSON.stringify(get())!==before)
       throw Error('locked billing mutation did not reject transaction for '+id);
     stopped++;
   }
   // A standalone, unreceived, unissued invoice MAY be revised through the existing writer.
   await store.updateBilling('SYN-EDIT',input);
   const after=get(),bill=after.billings.find(x=>x.id==='SYN-EDIT'),
     ar=after.receivables.find(x=>x.billingId==='SYN-EDIT'),
     invoices=after.invoices.filter(x=>String(x.billingId||'')==='SYN-EDIT');
   if(!bill||!ar||bill.lines.length!==1||bill.lines[0].price!==9500||
      bill.amount!==95000||bill.tax!==4750||bill.grossTotal!==99750||
      bill.retention!==4988||bill.total!==94762||ar.amount!==94762||
      ar.retention!==4988||ar.tax!==4750||ar.received!==0)
      throw Error('existing Store failed to reconcile billing+AR '+JSON.stringify({bill,ar}));
   if(invoices.length!==1||invoices[0].status!=='pending'||
      invoices[0].netAmount!==95000||invoices[0].grossAmount!==99750)
      throw Error('pending sales invoice desynchronized');
   for(const key of protectedSets)
     if(JSON.stringify(after[key])!==freeze[key])throw Error('protected collection changed: '+key);
   for(const id of ids.slice(1)){
     for(const key of ['billings','receivables','invoices']){
       const find=v=>v.id===id||v.id===id+'-AR'||v.billingId===id;
       const old=original[key].filter(find),later=after[key].filter(find);
       if(JSON.stringify(old)!==JSON.stringify(later))throw Error('locked record changed '+id+' '+key);
     }
   }
   return {locked:stopped,allowedOne:true,preview:proposed,
     preservedOriginalLineCount:bill.lines.length,protectedCollectionCount:protectedSets.length};
  }""")
  assert result['locked']==4,result
  assert result['allowedOne'] is True,result
  assert result['preview']['retention']==4988,result
  context.close()
  browser.close()
 print('PASS: real Store requires approved billing state, tax and retention recomputed, all paid/issued/cheque/retention originals protected')

if __name__=='__main__':
 main()
