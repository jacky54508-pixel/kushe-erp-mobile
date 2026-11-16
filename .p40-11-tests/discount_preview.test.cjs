'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {preview}=require('../.p40-11-lab/discount_preview.js');
const store=fs.readFileSync('assets/js/erp-store.js','utf8');
const num=v=>Number(v)||0;
const from=store.indexOf('function calculateBilling(values = {}) {'),to=store.indexOf('  function cloneBillingRef(',from);
assert.ok(from>=0&&to>from);
const calculateBilling=new Function('num','state',store.slice(from,to)+';return calculateBilling;')(num,{settings:{defaultTax:5}});
const recorded={untaxed:100000,tax:5000,grossTotal:105000,retention:5250,receivable:99750};
const baseline=()=>({recorded:{...recorded},taxRate:5,invoiceStatus:'invoice_pending',taxMode:'未稅',
  retentionMode:'5',retentionBase:'taxIncluded',received:0,retentionReceived:0,pendingCheque:0,
  receiptCount:0,retentionReceiptCount:0,chequeCount:0,issuedInvoice:false,merged:false,bankLinked:false,
  lines:Array.from({length:18},(_,i)=>({house:i%2?'M5':'L6',item:'虛構施工'+i,unit:'式',qty:1,price:1000}))});
const draft=(original=baseline(),gross=99750)=>({original,approval:{amountType:'gross',amount:gross}});
test('P40-11: original+proposed financial calculations conform to actual ERP Store',()=>{
 for(const args of [
   {taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'5',retentionBase:'taxIncluded'},
   {taxMode:'含稅',invoiceStatus:'invoice_pending',retentionMode:'10',retentionBase:'preTax'},
   {taxMode:'未稅',invoiceStatus:'no_invoice',retentionMode:'none',retentionBase:'taxIncluded'},
   {taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'custom',retentionRate:7,retentionCustom:2000,retentionBase:'preTax'},
   {taxMode:'未稅',invoiceStatus:'invoice_pending',retentionMode:'custom',retentionRate:7,retentionCustom:0,retentionBase:'preTax'},
 ]){
  const o=baseline();
  Object.assign(o,args);
  const origLinesPrice=o.taxMode==='含稅'||o.invoiceStatus==='no_invoice'?105000:100000;
  const originalTotals=calculateBilling({lines:[{qty:1,price:origLinesPrice}],...args});
  o.recorded={untaxed:originalTotals.untaxed,tax:originalTotals.tax,grossTotal:originalTotals.grossTotal,
    retention:originalTotals.retention,receivable:originalTotals.receivable};
  const before=JSON.stringify(o);
  const target=99750,actual=preview(draft(o,target)).proposed;
  const expected=calculateBilling({lines:[{qty:1,price:o.taxMode==='含稅'||o.invoiceStatus==='no_invoice'?target:actual.untaxed}],...args});
  for(const key of ['untaxed','tax','grossTotal','retention','receivable'])
   assert.equal(actual[key],expected[key],JSON.stringify({key,args,actual,expected}));
  assert.equal(JSON.stringify(o),before,'must not mutate original or 18 lines');
 }
});
test('P40-11: per-line original source identity, numbering and accounting never mutated',()=>{
 const old=baseline(),frozen=JSON.stringify(old);
 const r=preview(draft(old));
 assert.equal(JSON.stringify(old),frozen);
 assert.deepEqual([r.original.untaxed,r.original.tax,r.original.grossTotal,r.original.retention,r.original.receivable],
   [100000,5000,105000,5250,99750]);
 assert.deepEqual([r.proposed.untaxed,r.proposed.tax,r.proposed.grossTotal,r.proposed.retention,r.proposed.receivable],
   [95000,4750,99750,4988,94762]);
 assert.deepEqual([r.delta.untaxed,r.delta.tax,r.delta.grossTotal,r.delta.retention,r.delta.receivable],
   [-5000,-250,-5250,-262,-4988]);
 assert.equal(r.negotiatedReduction,5250);
 assert.equal(r.mode,'PREVIEW_ONLY');
 assert.equal(r.readOnly,true);assert.equal(r.canPost,false);
 assert.equal(r.locks.length,0);
 assert.equal(old.lines.length,18);
 assert.match(r.originalLinesHandling,/原施工明細/);
});
test('P40-11: invoices, merges, receipts, bank, cheque, retention block direct posting',()=>{
 const old=baseline();Object.assign(old,{
   invoiceStatus:'invoiced',issuedInvoice:true,invoiceNo:'SYN-AA000001',
   merged:true,received:30000,receiptCount:1,bankLinked:true,
   retentionReceived:1000,retentionReceiptCount:1,
   pendingCheque:25000,chequeCount:1,sourceUnresolved:true,invoiceConflict:true
 });
 const before=JSON.stringify(old),r=preview(draft(old,94500)),codes=r.locks.map(x=>x.code);
 for(const key of ['ISSUED_INVOICE','MERGED_BILLING','RECEIPT_EXISTS','RETENTION_RECEIPT_EXISTS',
  'CHEQUE_EXISTS','BANK_LINKED','SOURCE_UNVERIFIED','INVOICE_CONFLICT'])
  assert.ok(codes.includes(key),key);
 assert.equal(r.canPost,false);
 assert.equal(JSON.stringify(old),before,'unsafe case must not mutate');
});
test('P40-11: insufficient receivable and retention for paid originals yields explicit blockers',()=>{
 const old=baseline();old.received=96000;old.retentionReceived=5000;old.pendingCheque=100;
 const r=preview(draft(old,95000)),codes=r.locks.map(x=>x.code);
 for(const name of ['RECEIPTS_OVER_NEW_AR','RETENTION_OVER_NEW_LIMIT','CHEQUE_OVER_NEW_AR'])
  assert.ok(codes.includes(name),name);
});
test('P40-11: source mismatch, ambiguous amount type and invalid amounts fail closed',()=>{
 const missing=baseline();missing.recorded.tax++;
 assert.throws(()=>preview(draft(missing)),/不一致/);
 const bad=baseline();bad.received=bad.recorded.receivable+1;
 assert.throws(()=>preview(draft(bad)),/不一致/);
 assert.throws(()=>preview({original:baseline(),approval:{amount:99750,amountType:'untaxed'}}),/含稅/);
 for(const wrong of [-1,0,105001,'not-number',1.5])
  assert.throws(()=>preview(draft(baseline(),wrong)));
 assert.throws(()=>preview(draft(baseline(),10)),/精確換算/);
});
test('P40-11: no actual concession must not be labelled as a completed discount',()=>{
 const r=preview(draft(baseline(),105000));
 assert.equal(r.negotiatedReduction,0);
 assert.ok(r.locks.some(x=>x.code==='NO_FINANCIAL_DISCOUNT'));
});
test('P40-11: preview module does not expose calls to ERP Store or persistence',()=>{
 const js=fs.readFileSync('.p40-11-lab/discount_preview.js','utf8');
 const html=fs.readFileSync('.p40-11-lab/discount_preview.html','utf8');
 for(const source of [js,html]){
  for(const s of ['KuSheERPStore','fetch(', 'XMLHttpRequest','indexedDB','localStorage','sessionStorage',
    'supabase','saveInvoice(','updateBilling(','createBilling(','persist(','postMessage('])
   assert.ok(!source.includes(s),'forbidden read/write/browser external integration: '+s);
 }
 assert.ok(!html.includes('type="submit"'));
 assert.ok(html.includes('虛構資料專用'));
});