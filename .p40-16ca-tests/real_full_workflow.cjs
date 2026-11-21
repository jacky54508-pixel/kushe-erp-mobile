'use strict';
/* P40-16CA: Run the actual ERP store against wholly FAKE, throwaway Chromium
   localhost-origin IndexedDB and localStorage. Never load any user backup. */
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require('/tmp/p40bz/node_modules/playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'p40ca-artifacts');
const fake={
 meta:{version:'5.0.0',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'},
 settings:{company:'FAKE COMPANY NEVER REAL',defaultTax:5,owner:'FAKE',taxId:'',address:'FAKE ADDRESS'},
 customers:[{id:'fake-customer',name:'FAKE CUSTOMER'}],
 projects:[{id:'fake-project',name:'FAKE PROJECT',customer:'fake-customer'}],
 employees:[{id:'fake-employee',name:'FAKE EMPLOYEE',dailyRate:2000}],
 banks:[{id:'fake-bank',name:'FAKE BANK',openingBalance:100000,income:0,expense:0,balance:100000}],
 billings:[{id:'fake-billing',number:'B20261101-001',date:'2026-11-01',project:'fake-project',customer:'fake-customer',projectName:'FAKE PROJECT',customerName:'FAKE CUSTOMER',amount:10000,tax:500,grossTotal:10500,retention:500,total:10000,retentionAmount:500,retentionReceived:0,invoiceStatus:'invoice_pending',taxMode:'未稅',lines:[{house:'FAKE-1',item:'FAKE construction',unit:'式',qty:1,price:10000,subtotal:10000}]}],
 receivables:[{id:'fake-ar',billingId:'fake-billing',sourceNo:'B20261101-001',date:'2026-11-01',project:'fake-project',customer:'fake-customer',projectName:'FAKE PROJECT',customerName:'FAKE CUSTOMER',amount:10000,received:0,retention:500,retentionAmount:500,retentionReceived:0,status:'未收'}],
 attendance:[{id:'fake-attendance',date:'2026-11-01',employee:'fake-employee',project:'fake-project',days:1,hours:8,dailyRate:2000,amount:2000}],
 payroll:[{id:'fake-payroll',month:'2026-11',employee:'fake-employee',days:1,baseSalary:2000,commission:0,fuel:0,meal:0,other:0,overtime:0,bonus:0,allowance:0,advance:0,laborInsurance:0,incomeTax:0,deduction:0,total:2000,status:'未付款'}],
 receipts:[],retentionReceipts:[],payables:[],payments:[],salaryPayments:[],commissions:[],bankTransactions:[],invoices:[],dailyLogs:[],quotations:[],audit:[]
};
const errorText=e=>String(e?.message||e||'unknown').slice(0,360);
const css='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>P40-16CA offline REAL ERP Store fake origin</title><body><h1>FAKE ERP isolated browser</h1><script>window.KusheAuthGate={session:()=>null,user:()=>({id:"FAKE-PRINCIPAL-NOT-REAL"}),requireAuth:async()=>true};</script><script src="/assets/js/legacy-adapter.js"></script><script src="/assets/js/erp-store.js"></script></body></html>';
function serve(req,res){
 const u=new URL(req.url,'http://127.0.0.1');let asset;
 if(u.pathname==='/p40ca-fake.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(css)}
 if(!['/assets/js/legacy-adapter.js','/assets/js/erp-store.js'].includes(u.pathname)){res.writeHead(403);return res.end('DENIED_FAKE_ONLY')}
 asset=path.resolve(ROOT,'.'+u.pathname);if(!asset.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('DENIED')}
 res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(asset).pipe(res);
}
function checks(snapshot){const s=snapshot.data||snapshot;return {customer:s.customers?.length,project:s.projects?.length,billing:s.billings?.length,receivable:s.receivables?.length,receipt:s.receipts?.length,payable:s.payables?.length,payment:s.payments?.length,payroll:s.payroll?.length,salary:s.salaryPayments?.length,commission:s.commissions?.length,bankTxn:s.bankTransactions?.length};}
async function run(){
 for(const f of ['assets/js/legacy-adapter.js','assets/js/erp-store.js'])assert(fs.existsSync(path.join(ROOT,f)),'MISSING_ORIGINAL_ERP_PROGRAM_'+f);
 fs.mkdirSync(OUT,{recursive:true});const server=http.createServer(serve);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const denied=[];
 const passed=[];const log=(label,value)=>{passed.push({test:label,status:'PASS',...value});console.log('PASS '+label)};
 let ctx;
 try{
  ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base+'/'))return route.continue();denied.push(url);return route.abort()});
  await ctx.addInitScript(value=>{
   if(location.hostname!=='127.0.0.1')return;
   if(!localStorage.getItem('P40BZ_FAKE_ONLY_SEEDED')){
    localStorage.setItem('KuSheERP25_EMERGENCY',JSON.stringify(value));
    localStorage.setItem('P40BZ_FAKE_ONLY_SEEDED','true');
   }
  },fake);
  const page=await ctx.newPage();page.on('pageerror',e=>console.error('FAKE browser pageerror: '+errorText(e)));
  await page.goto(base+'/p40ca-fake.html',{waitUntil:'load'});
  const boot=await page.evaluate(async()=>{
   const store=window.KuSheERPStore;if(!store)throw Error('REAL_KUSHE_STORE_NOT_LOADED');
   const state=await store.load();const snap=await store.readCommittedSnapshot();
   const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('KuSheERP25_Core34_DB');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
   const read=key=>new Promise((resolve,reject)=>{const req=db.transaction('erp','readonly').objectStore('erp').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
   const idb=await read('main'),journal=await read('store:transaction:journal:v1');db.close();
   return {initial:{billings:state.billings.length,receivables:state.receivables.length,employees:state.employees.length},idbMatches:JSON.stringify(idb)===localStorage.getItem('KuSheERP25_EMERGENCY'),journalPhase:journal?.phase,revision:idb?.meta?.businessSnapshotRevision?.id,tokenPresent:Boolean(localStorage.getItem('KuSheERP25_LOCAL_COMMIT_TOKEN')),receiptTokenPresent:Boolean(localStorage.getItem('KuSheERP25_RECEIPT_COMMIT_VERSION')),snapshot: {billings:snap.data.billings.length,receivables:snap.data.receivables.length}};
  });
  assert.equal(boot.initial.billings,1);assert.equal(boot.initial.receivables,1);assert.equal(boot.initial.employees,1);
  assert.equal(boot.idbMatches,true,'EMERGENCY_NOT_IDENTICAL_TO_IDB');assert.equal(boot.journalPhase,'COMMIT_VERIFIED');assert.ok(boot.revision&&boot.tokenPresent&&boot.receiptTokenPresent);
  log('REAL_INDEXEDDB_EMERGENCY_LEGACY_BOOTSTRAP',{journalPhase:boot.journalPhase});
  const before=await page.evaluate(async()=>{const s=await window.KuSheERPStore.readCommittedSnapshot();return {baseline:s.baseline,revision:s.revision.id,counts:{billings:s.data.billings.length,receivables:s.data.receivables.length},audit:s.data.audit.length}});
  await page.reload({waitUntil:'load'});const reloaded=await page.evaluate(async()=>{const s=await window.KuSheERPStore.load();const a=await window.KuSheERPStore.readCommittedSnapshot();return {rev:a.revision.id,billing:s.billings.length,receivable:s.receivables.length,audit:s.audit.length}});
  assert.equal(before.revision,reloaded.rev);assert.equal(reloaded.billing,1);assert.equal(before.audit,reloaded.audit);
  log('RELOAD_SAME_VERSION_NO_DUPLICATE_OR_UNAPPROVED_WRITE');
  const rejected=await page.evaluate(async()=>{
   const s=window.KuSheERPStore;const prior=await s.readCommittedSnapshot();let error='';try{await s.savePayable({payeeName:'FAKE',amount:-42})}catch(e){error=String(e.message)}const after=await s.readCommittedSnapshot();return {error,same:prior.baseline===after.baseline,prior:prior.data.payables.length,after:after.data.payables.length};
  });assert.ok(rejected.error);assert.ok(rejected.same);assert.equal(rejected.after,rejected.prior);log('REJECT_BAD_PAYABLE_NO_PERSIST_OR_BANK_SIDE_EFFECT');
  const receipt=await page.evaluate(async()=>{const s=window.KuSheERPStore;const r=await s.addReceipt({idempotencyKey:'fake-receipt-once',receivableId:'fake-ar',date:'2026-11-02',amount:500,fee:5,feePayer:'company',bankId:'fake-bank',paymentMethod:'銀行轉帳',note:'FAKE'});const after=s.getState();return {id:r.id,ar:after.receivables.find(x=>x.id==='fake-ar'),receipt:after.receipts.find(x=>x.id===r.id),txn:after.bankTransactions.find(x=>x.sourceId===r.id),bank:after.banks.find(x=>x.id==='fake-bank'),count:after.receipts.length}});
  assert.equal(receipt.count,1);assert.equal(receipt.ar.received,500);assert.equal(receipt.bank.income,495);assert.equal(receipt.bank.balance,100495);assert.equal(receipt.txn.amount,495);assert.equal(receipt.receipt.netAmount,495);log('REAL_RECEIPT_TO_RECEIVABLE_AND_BANK_EXACT');
  const replay=await page.evaluate(async()=>{const s=window.KuSheERPStore;const x=await s.addReceipt({idempotencyKey:'fake-receipt-once',receivableId:'fake-ar',date:'2026-11-02',amount:500,fee:5,feePayer:'company',bankId:'fake-bank',paymentMethod:'銀行轉帳',note:'FAKE'});return {id:x.id,count:s.getState().receipts.length,bankTxns:s.getState().bankTransactions.length}});
  assert.equal(replay.id,receipt.id);assert.equal(replay.count,1);assert.equal(replay.bankTxns,1);log('REAL_RECEIPT_IDEMPOTENCY_ONE_BANK_ENTRY');
  const badreceipt=await page.evaluate(async()=>{const s=window.KuSheERPStore,b=await s.readCommittedSnapshot();let error='';try{await s.addReceipt({receivableId:'fake-ar',amount:999999,bankId:'fake-bank'})}catch(e){error=String(e.message)}const a=await s.readCommittedSnapshot();return {error,unchanged:a.baseline===b.baseline,bank: a.data.banks.find(x=>x.id==='fake-bank').balance}});
  assert.ok(badreceipt.error&&badreceipt.unchanged);assert.equal(badreceipt.bank,100495);log('REJECT_RECEIPT_OVERPAY_NO_ACCOUNTING_WRITE');
  const payable=await page.evaluate(async()=>{const s=window.KuSheERPStore;const p=await s.savePayable({payeeName:'FAKE VENDOR',projectId:'fake-project',date:'2026-11-04',item:'FAKE material',amount:2000});const a=await s.addPayablePayment({payableId:p.id,idempotencyKey:'fake-payment-once',bankId:'fake-bank',date:'2026-11-05',amount:1200,fee:20,feePayer:'company'});const st=s.getState();return {id:p.id,payment:a,paid:st.payables.find(x=>x.id===p.id).paid,bank:st.banks.find(x=>x.id==='fake-bank'),transaction:st.bankTransactions.find(x=>x.sourceId===a.id),n:st.payments.length}});
  assert.equal(payable.paid,1200);assert.equal(payable.bank.expense,1220);assert.equal(payable.bank.balance,99275);assert.equal(payable.transaction.amount,1220);assert.equal(payable.n,1);log('REAL_PAYABLE_TO_BANK_PAYMENT_EXACT');
  const retained=await page.evaluate(async()=>{const s=window.KuSheERPStore;const r=await s.addRetentionReceipt({idempotencyKey:'fake-retention-once',receivableId:'fake-ar',date:'2026-11-06',amount:300,fee:0,feePayer:'company',bankId:'fake-bank'});const st=s.getState();return {id:r.id,retention:st.receivables.find(x=>x.id==='fake-ar').retentionReceived,billingRetention:st.billings.find(x=>x.id==='fake-billing').retentionReceived,bank:st.banks.find(x=>x.id==='fake-bank'),txn:st.bankTransactions.find(x=>x.sourceId===r.id),n:st.retentionReceipts.length}});
  assert.equal(retained.n,1);assert.equal(retained.retention,300);assert.equal(retained.billingRetention,300);assert.equal(retained.bank.income,795);assert.equal(retained.bank.balance,99575);assert.equal(retained.txn.amount,300);log('REAL_RETENTION_COLLECTION_BANK_AND_SOURCE_LINKS');
  const overretention=await page.evaluate(async()=>{const s=window.KuSheERPStore;const b=await s.readCommittedSnapshot();let error='';try{await s.addRetentionReceipt({receivableId:'fake-ar',bankId:'fake-bank',amount:1000,fee:0})}catch(e){error=String(e.message)}const a=await s.readCommittedSnapshot();return {error,unchanged:a.baseline===b.baseline}});
  assert.ok(overretention.error&&overretention.unchanged);log('REJECT_RETENTION_OVERPAY_NO_WRITE');
  const invoice=await page.evaluate(async()=>{const s=window.KuSheERPStore;const i=await s.saveInvoice({invoiceType:'output',sourceId:'fake-billing',status:'issued',invoiceNumber:'FAKE-OUTPUT-INVOICE-100',invoiceDate:'2026-11-06'});const st=s.getState();return {id:i.id,number:i.invoiceNumber,billingNo:st.billings.find(x=>x.id==='fake-billing').invoiceNo,receivableNo:st.receivables.find(x=>x.id==='fake-ar').invoiceNo,invoices:st.invoices.length}});
  assert.equal(invoice.invoices,1);assert.equal(invoice.billingNo,'FAKE-OUTPUT-INVOICE-100');assert.equal(invoice.receivableNo,invoice.billingNo);log('REAL_OUTPUT_INVOICE_TO_BILLING_RECEIVABLE_METADATA');
  const salary=await page.evaluate(async()=>{const s=window.KuSheERPStore;const plan=s.salaryPaymentPlan('fake-payroll',[]);const r=await s.addSalaryPayment({payrollId:'fake-payroll',idempotencyKey:'fake-salary-once',date:'2026-11-07',amount:2000,fee:10,feePayer:'company',bankId:'fake-bank',commissionSelectionKeys:[]});const st=s.getState();return {plan:{allowed:plan.allowed,payable:plan.currentPayable},id:r.id,amount:r.amount,fee:r.fee,bank:st.banks.find(x=>x.id==='fake-bank'),txn:st.bankTransactions.find(x=>x.sourceId===r.id),paid:st.salaryPayments.length}});
  assert.equal(salary.paid,1);assert.equal(salary.amount,2000);assert.equal(salary.txn.amount,2010);assert.equal(salary.bank.expense,3230);assert.equal(salary.bank.balance,97565);log('REAL_SALARY_PAYMENT_BANK_AND_FEE_EXACT');
  const com=await page.evaluate(async()=>{const s=window.KuSheERPStore;const x=await s.saveCommission({date:'2026-10-09',employee:'fake-employee',project:'fake-project',untaxedAmount:14000,rate:25,status:'未列入薪資'});const state=s.getState();return {id:x.id,amount:x.commission,payroll:state.payroll.map(p=>({month:p.month,commission:p.commission,total:p.total,status:p.status}))}});
  assert.equal(com.amount,3500);log('REAL_PRETAX_14000_X_25PCT_COMMISSION_3500');
  const restore=await page.evaluate(async()=>{const s=window.KuSheERPStore;const committed=await s.readCommittedSnapshot();const countBefore={b:committed.data.billings.length,ar:committed.data.receivables.length,rec:committed.data.receipts.length,pay:committed.data.payments.length,comm:committed.data.commissions.length,bank:committed.data.bankTransactions.length};let refused='';try{await s.replaceSnapshot(committed.data,{baseline:'FAKE_STALE_BASELINE',confirmed:true})}catch(e){refused=String(e.message)};const afterReject=await s.readCommittedSnapshot();if(afterReject.baseline!==committed.baseline)throw Error('STALE_REPLACEMENT_CHANGED_SNAPSHOT');const ok=await s.replaceSnapshot(committed.data,{baseline:committed.baseline,confirmed:true});const after=await s.readCommittedSnapshot();const countAfter={b:after.data.billings.length,ar:after.data.receivables.length,rec:after.data.receipts.length,pay:after.data.payments.length,comm:after.data.commissions.length,bank:after.data.bankTransactions.length};return {refused,revisionBefore:committed.revision.id,revisionAfter:after.revision.id,status:ok.status||ok.transactionStatus, countBefore,countAfter,amountBefore:committed.data.receivables[0].received,amountAfter:after.data.receivables[0].received};});
  assert.ok(restore.refused);assert.notEqual(restore.revisionAfter,restore.revisionBefore);assert.deepEqual(restore.countAfter,restore.countBefore);assert.equal(restore.amountBefore,restore.amountAfter);log('REAL_REPLACE_SNAPSHOT_STALE_REJECT_AND_FAKE_RESTORE_PRESERVES_ACCOUNTING');
  const snapshot=await page.evaluate(async()=>{const c=await window.KuSheERPStore.readCommittedSnapshot();return {baseline:c.baseline,revision:c.revision.id,counts:{receipts:c.data.receipts.length,payments:c.data.payments.length,bankTransactions:c.data.bankTransactions.length},mirror:localStorage.getItem('KuSheERP25_EMERGENCY')}});
  await page.reload({waitUntil:'load'});const afterR=await page.evaluate(async()=>{const s=await window.KuSheERPStore.load();const a=await window.KuSheERPStore.readCommittedSnapshot();return {baseline:a.baseline,revision:a.revision.id,receipts:s.receipts.length,payments:s.payments.length,bankTxns:s.bankTransactions.length}});
  assert.equal(afterR.revision,snapshot.revision);assert.equal(afterR.receipts,snapshot.counts.receipts);assert.equal(afterR.payments,snapshot.counts.payments);assert.equal(afterR.bankTxns,snapshot.counts.bankTransactions);log('REAL_RESTART_AFTER_PAYMENTS_RESTORES_LINKS');
  await page.evaluate(()=>localStorage.setItem('KuSheERP25_EMERGENCY','{CORRUPTED_FAKE_MIRROR'));
  await page.reload({waitUntil:'load'});const blocked=await page.evaluate(async()=>{let err='';try{await window.KuSheERPStore.load()}catch(e){err=String(e.code||e.message)};let idbRev='';const req=indexedDB.open('KuSheERP25_Core34_DB');const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});const x=db.transaction('erp','readonly').objectStore('erp').get('main');const v=await new Promise((resolve,reject)=>{x.onsuccess=()=>resolve(x.result);x.onerror=()=>reject(x.error)});idbRev=v?.meta?.businessSnapshotRevision?.id;db.close();return {err,idbRev}});
  assert.ok(blocked.err,'MIRROR_CORRUPTION_MUST_FAIL_CLOSED');assert.equal(blocked.idbRev,snapshot.revision);log('CORRUPTED_EMERGENCY_REJECTED_IDB_LEFT_INTACT');
  await page.evaluate(value=>localStorage.setItem('KuSheERP25_EMERGENCY',value),snapshot.mirror);await page.reload({waitUntil:'load'});const recovered=await page.evaluate(async()=>{const a=await window.KuSheERPStore.readCommittedSnapshot();return {revision:a.revision.id,receipts:a.data.receipts.length,payments:a.data.payments.length}});
  assert.equal(recovered.revision,snapshot.revision);assert.equal(recovered.receipts,1);assert.equal(recovered.payments,1);log('FAKE_MIRROR_RESTORED_RELOAD_SUCCESS');

  // P40-16CA synthetic-only workflow extensions — real ERP Store in browser.
  const daily=await page.evaluate(async()=>{
    const s=window.KuSheERPStore;
    const batch=await s.saveDailyBatch({date:'2026-12-03',employeeIds:['fake-employee'],workMode:'none',
      commissionEnabled:true,commissionRates:{'fake-employee':50},note:'FAKE daily work',
      lines:[{project:'fake-project',house:'FAKE-M101',item:'FAKE repair M',unit:'式',qty:1,inputPrice:2000,taxMode:'未稅'}]});
    const row=s.getState().dailyLogs.find(x=>x.batchId===batch);
    const d=s.unbilledWork({project:'fake-project'}).flatMap(x=>x.details||[]).find(x=>x.house==='FAKE-M101');
    return {batch,logId:row?.id,status:row?.billingStatus,commission:row?.commission,
      generated:s.getState().commissions.find(x=>x.sourceId===row?.id)?.commission,detail:d,
      locked:s.commissionReleasePool().filter(x=>x.month==='2026-12').every(x=>!x.unlocked)};
  });
  assert.equal(daily.status,'未請款');assert.equal(daily.commission,1000);
  assert.equal(daily.generated,1000);assert.equal(daily.detail?.subtotal,2000);assert.ok(daily.locked);
  log('DAILY_BATCH_PRETAX_COMMISSION_AND_UNBILLED_SOURCE');
  const billed=await page.evaluate(async detail=>{
    const s=window.KuSheERPStore;
    const ref={sourceGroupKey:detail.sourceGroupKey,sourceItemIndex:detail.sourceItemIndex,workItemId:detail.workItemId};
    const row=await s.createBilling({date:'2026-12-04',customer:'fake-customer',customerName:'FAKE CUSTOMER',
      project:'fake-project',projectName:'FAKE PROJECT',sourceItemRefs:[ref],
      lines:[{house:detail.house,item:detail.item,unit:detail.unit,qty:detail.qty,price:detail.price,sourceRefs:[ref]}],
      taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'none'});
    const state=s.getState(), ar=state.receivables.find(x=>x.billingId===row.id);
    return {id:row.id,ar:ar.id,gross:row.grossTotal,arAmount:ar.amount,
      linked:state.dailyLogs.find(x=>x.id===detail.dailyLogIds[0])?.items?.[0]?.billingId,
      invoice:state.invoices.some(x=>x.billingId===row.id)};
  },daily.detail);
  assert.equal(billed.gross,2100);assert.equal(billed.arAmount,2100);assert.equal(billed.linked,billed.id);
  assert.ok(billed.invoice);log('DAILY_SOURCE_TO_BILLING_RECEIVABLE_AND_INVOICE');
  const blockedDuplicate=await page.evaluate(async d=>{
    const s=window.KuSheERPStore,b=await s.readCommittedSnapshot();let error='';
    try{await s.createBilling({sourceItemRefs:[{sourceGroupKey:d.sourceGroupKey,sourceItemIndex:d.sourceItemIndex}],
      lines:[{qty:1,price:2000}],customer:'fake-customer',project:'fake-project'})}catch(e){error=e.message}
    return {error,same:b.baseline===(await s.readCommittedSnapshot()).baseline};
  },daily.detail);
  assert.ok(blockedDuplicate.error&&blockedDuplicate.same);log('DUPLICATE_DAILY_BILLING_REJECTS_WITHOUT_WRITE');
  const release=await page.evaluate(async id=>{
    const s=window.KuSheERPStore,before=s.commissionReleasePool().filter(x=>x.month==='2026-12');
    const r=await s.addReceipt({idempotencyKey:'fake-dec-payment',receivableId:id,date:'2026-12-05',amount:2100,
      fee:10,feePayer:'company',bankId:'fake-bank',paymentMethod:'銀行轉帳'});
    const state=s.getState();
    return {before:before.map(x=>x.unlocked),after:s.commissionReleasePool().filter(x=>x.month==='2026-12').map(x=>x.unlocked),
      bank:state.bankTransactions.find(x=>x.sourceId===r.id)?.amount};
  },billed.ar);
  assert.ok(release.before.length&&release.before.every(x=>!x));
  assert.ok(release.after.length&&release.after.every(Boolean));assert.equal(release.bank,2090);
  log('FULL_RECEIPT_UNLOCKS_COMMISSION_AND_BANK_NET');
  const material=await page.evaluate(async()=>{
    const s=window.KuSheERPStore,v=await s.saveVendor({name:'FAKE SUPPLIER MATERIAL 2026'});
    const m=await s.saveMaterial({name:'FAKE SOLVENT',code:'FAKE-CA-1',unit:'瓶',unitPrice:100,
      vendor:v.id,inventoryMode:'opening',openingStock:0});
    const purchase={material:m.id,quantity:5,unitPrice:120,date:'2026-12-10',note:'FAKE',idempotencyKey:'fake-material-once'};
    const input=await s.addInventoryReceipt(purchase),replay=await s.addInventoryReceipt(purchase);
    const afterInput=s.getState();const payable=afterInput.payables.find(x=>x.id===input.payableId);
    const payablesBefore=afterInput.payables.length;
    const usage=await s.saveMaterialUsage({project:'fake-project',employee:'fake-employee',
      vendor:v.id,material:m.id,quantity:2,unitPrice:120,date:'2026-12-11'});
    return {id:m.id,receiptId:input.id,replayId:replay.id,receipts:s.getState().inventoryReceipts.filter(x=>x.material===m.id).length,
      stock:s.materialInventorySummary(m.id).stock,opening:s.materialInventorySummary(m.id).openingStock,
      payable:payable?.amount,usage:usage.amount,usageMode:usage.accountingMode,
      noDuplicatePayable:s.getState().payables.length===payablesBefore};
  });
  assert.equal(material.receiptId,material.replayId);assert.equal(material.receipts,1);
  assert.equal(material.opening,0);assert.equal(material.stock,3);assert.equal(material.payable,600);
  assert.equal(material.usage,240);assert.equal(material.usageMode,'inventory-cost-only');assert.ok(material.noDuplicatePayable);
  log('MATERIAL_ZERO_OPENING_PURCHASE_PAYABLE_ONCE_AND_USAGE_STOCK_ONLY');
  const insufficient=await page.evaluate(async id=>{
    const s=window.KuSheERPStore,b=await s.readCommittedSnapshot();let error='';
    try{await s.saveMaterialUsage({project:'fake-project',employee:'fake-employee',material:id,quantity:999,unitPrice:120})}catch(e){error=e.message}
    return {error,same:b.baseline===(await s.readCommittedSnapshot()).baseline};
  },material.id);
  assert.ok(insufficient.error&&insufficient.same);log('MATERIAL_OVERSTOCK_REJECTED_NO_ACCOUNTING_WRITE');


  const second=await page.evaluate(async()=>{
    const s=window.KuSheERPStore,proj=await s.saveProject({name:'FAKE OTHER AREA L',customer:'fake-customer'});
    await s.saveDailyBatch({date:'2026-12-06',employeeIds:['fake-employee'],workMode:'none',
      commissionEnabled:false,lines:[{project:proj.id,house:'FAKE-L101',item:'FAKE repair L',unit:'式',qty:1,inputPrice:3000,taxMode:'未稅'}]});
    const d=s.unbilledWork({project:proj.id})[0]?.details?.[0];if(!d)throw Error('FAKE_SECOND_AREA_SOURCE_MISSING');
    const ref={sourceGroupKey:d.sourceGroupKey,sourceItemIndex:d.sourceItemIndex,workItemId:d.workItemId};
    const b=await s.createBilling({date:'2026-12-07',customer:'fake-customer',customerName:'FAKE CUSTOMER',project:proj.id,projectName:proj.name,
      sourceItemRefs:[ref],lines:[{house:d.house,item:d.item,unit:d.unit,qty:1,price:3000,sourceRefs:[ref]}],
      taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'none'});
    return {id:b.id,projectName:proj.name,amount:b.amount,gross:b.grossTotal,unbilled:s.unbilledWork({project:proj.id}).length};
  });
  assert.equal(second.amount,3000);assert.equal(second.gross,3150);assert.equal(second.unbilled,0);
  log('SECOND_AREA_HAS_SEPARATE_SOURCE_AND_BILLING');
  const merge=await page.evaluate(async ids=>{
    const s=window.KuSheERPStore,before=await s.readCommittedSnapshot(),ctx=s.externalBillingContext(ids);
    const doc=await s.saveExternalBillingDocument({idempotencyKey:'fake-merge-CA',sourceIds:ids,targetBillingId:ids[0],
      expectedSnapshot:ctx.snapshot,status:'active',confirmed:true,detailMode:'unified',documentDate:'2026-12-08',
      note:'FAKE external project only',unified:{taxMode:'未稅',reason:'FAKE composite view from two source areas',
        lines:[{house:'FAKE-M101',item:'FAKE repair M',unit:'式',qty:1,price:2000},
          {house:'FAKE-L101',item:'FAKE repair L',unit:'式',qty:1,price:3000}]}});
    const after=await s.readCommittedSnapshot(),index=s.externalBillingDocumentIndex();
    const entry=index.documents.find(x=>x.document.id===doc.id);
    const unchanged=ids.every(id=>{
      const a=before.data.billings.find(x=>x.id===id),b=after.data.billings.find(x=>x.id===id);
      const arA=before.data.receivables.find(x=>x.id===a?.receivableId),arB=after.data.receivables.find(x=>x.id===b?.receivableId);
      return JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(arA)===JSON.stringify(arB);
    });
    return {id:doc.id,target:doc.displayProjectName,sourceCount:doc.sourceIds.length,totals:doc.totals,
      details:doc.unified.lines.length,amount:doc.unified.total,ledgerUnchanged:unchanged,indexed:entry?.canGroup,
      issues:entry?.issues};
  },[billed.id,second.id]);
  assert.equal(merge.sourceCount,2);assert.equal(merge.target,'FAKE PROJECT');
  assert.equal(merge.totals.untaxed,5000);assert.equal(merge.totals.grossTotal,5250);
  assert.equal(merge.amount,5000);assert.equal(merge.details,2);
  assert.ok(merge.ledgerUnchanged);assert.ok(merge.indexed,'FAKE MERGE INDEX '+JSON.stringify(merge.issues));
  log('CROSS_ZONE_MERGED_PUBLIC_TARGET_AND_FINANCIAL_SOURCE_IMMUTABILITY');
  const staleMerge=await page.evaluate(async ids=>{
    const s=window.KuSheERPStore,b=await s.readCommittedSnapshot();let error='';
    try{await s.saveExternalBillingDocument({documentId:ids[2],sourceIds:ids.slice(0,2),targetBillingId:ids[0],
      expectedSnapshot:'FAKE_STALE_SOURCE',status:'active',confirmed:true,detailMode:'unified',
      idempotencyKey:'fake-stale-CA',documentDate:'2026-12-08',
      unified:{taxMode:'未稅',reason:'FAKE',lines:[{house:'FAKE',item:'FAKE',unit:'式',qty:1,price:5000}]}})}
    catch(e){error=e.message}
    return {error,untouched:b.baseline===(await s.readCommittedSnapshot()).baseline};
  },[billed.id,second.id,merge.id]);
  assert.ok(staleMerge.error&&staleMerge.untouched);
  log('STALE_CROSS_ZONE_MERGE_REJECTED_NO_WRITE');
  const discount=require(path.join(ROOT,'assets/js/billing-discount-calculator.js'));
  const beforeDiscount=await page.evaluate(async()=> (await window.KuSheERPStore.readCommittedSnapshot()).baseline);
  const calc=discount.preview({original:{recorded:{untaxed:2000,tax:100,grossTotal:2100,retention:0,receivable:2100},
    invoiceStatus:'invoice_pending',taxMode:'未稅',taxRate:5,retentionMode:'none',retentionBase:'taxIncluded',
    received:2100,receiptCount:1,merged:true,bankLinked:true},approval:{amountType:'gross',amount:1890}});
  const afterDiscount=await page.evaluate(async()=> (await window.KuSheERPStore.readCommittedSnapshot()).baseline);
  assert.equal(calc.readOnly,true);assert.equal(calc.canPost,false);assert.equal(calc.negotiatedReduction,210);
  assert.equal(beforeDiscount,afterDiscount);
  for(const key of ['MERGED_BILLING','RECEIPT_EXISTS','BANK_LINKED','RECEIPTS_OVER_NEW_AR'])
    assert.ok(calc.locks.some(x=>x.code===key),'DISCOUNT_LOCK_MISSING '+key);
  log('CONCESSION_PREVIEW_READONLY_WITH_MERGED_RECEIPT_BANK_LOCKS');
  const checkpoint=await page.evaluate(async()=>{
    const s=await window.KuSheERPStore.readCommittedSnapshot();
    return {rev:s.revision.id,baseline:s.baseline, counts:{billings:s.data.billings.length,
      ar:s.data.receivables.length,materials:s.data.materials.length,inv:s.data.inventoryReceipts.length,
      usages:s.data.materialUsages.length,docs:s.data.meta.externalBillingDocuments?.length||0,
      receipts:s.data.receipts.length,bank:s.data.bankTransactions.length}};
  });
  await page.reload({waitUntil:'load'});
  const persisted=await page.evaluate(async()=>{
    await window.KuSheERPStore.load();const s=await window.KuSheERPStore.readCommittedSnapshot();
    return {rev:s.revision.id,baseline:s.baseline, counts:{billings:s.data.billings.length,
      ar:s.data.receivables.length,materials:s.data.materials.length,inv:s.data.inventoryReceipts.length,
      usages:s.data.materialUsages.length,docs:s.data.meta.externalBillingDocuments?.length||0,
      receipts:s.data.receipts.length,bank:s.data.bankTransactions.length}};
  });
  assert.deepEqual(checkpoint,persisted);
  log('FULL_FAKE_WORKFLOW_INDEXEDDB_EMERGENCY_RELOAD_PERSISTENCE');

  assert.deepEqual(denied,[],'NO_EXTERNAL_REQUEST_ALLOWED');log('NO_PRODUCTION_NETWORK_OR_EXTERNAL_ORIGINS');
  const result={phase:'P40-16CA',fakeOnly:true,realBrowser:true,actualERPStore:true,actualIndexedDB:true,actualEmergencyMirror:true,rollbackVerified:true,financialStaticAndMutationTests:true,productionDataUsed:false,userBackupUploadedToGithub:false,realAuthUsed:false,realSupabaseTouched:false,mainBetaModified:false,production_release:'BLOCKED',passed};
  fs.writeFileSync(path.join(OUT,'RESULT.json'),JSON.stringify(result,null,2));console.log('P40-16CA_REAL_CHROMIUM_PASS '+passed.length);
 }catch(e){console.error('P40-16CA_REAL_CHROMIUM_FAILURE '+(e?.stack||e));process.exitCode=1}
 finally{if(ctx)await ctx.close();await browser.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(e=>{console.error(e.stack);process.exitCode=1});
