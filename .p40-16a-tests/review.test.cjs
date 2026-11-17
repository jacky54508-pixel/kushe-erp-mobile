/* P40-16A isolated fake inputs only; no production ERP data or network calls. */
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../assets/js/p40-16a-concession-review.js');
const amounts=(untaxed,tax,retention=0)=>({untaxed,tax,grossTotal:untaxed+tax,retention,receivable:untaxed+tax-retention});
const line=(i)=>({item:'SYNTHETIC ITEM '+i,qty:1,price:100,house:'F'+i});
function fixture(){
  const sources=[
    {billingId:'FAKE-A',receivableId:'FAKE-AR-A',amounts:amounts(524000,26200),
     settlement:{received:0,retentionReceived:0,pendingCheque:0},invoice:{status:'invoice_pending',number:''}},
    {billingId:'FAKE-B',receivableId:'FAKE-AR-B',amounts:amounts(78000,3900),
     settlement:{received:0,retentionReceived:0,pendingCheque:0},invoice:{status:'invoiced',number:'SYNTH-INV'}}
  ];
  return {scope:'merged',documentId:'FAKE-MERGED',documentRevision:1,documentStatus:'active',
    sourceIds:['FAKE-A','FAKE-B'],sources,originalTotals:amounts(602000,30100),
    approvedGross:600000,expectedSnapshot:'fake-snapshot',observedSnapshot:'fake-snapshot',
    existingAdjustments:[],issues:[],termsChanged:false,settlementChanged:false,
    originalPublicLines:Array.from({length:18},(_,i)=>line(i))};
}
test('merged 632100 to 600000 -> 32100, issued invoice explicitly blocks posting',()=>{
  const src=fixture(),before=JSON.stringify(src);
  const view=api.evaluate(src);
  assert.equal(view.schema,'kushe-p40-16a-readonly-review-v1');
  assert.equal(view.originalGross,632100);assert.equal(view.approvedGross,600000);
  assert.equal(view.discountGross,32100);assert.equal(view.issuedSourceCount,1);
  assert.equal(view.sourceCount,2);assert.equal(view.allocationMathValid,false);
  assert.equal(view.canPost,false);assert.equal(view.canSave,false);assert.equal(view.readOnly,true);
  assert.ok(view.blockers.some(x=>x.includes('發票')));
  assert.ok(view.blockers.some(x=>x.includes('分攤')));
  assert.equal(src.originalPublicLines.length,18);
  assert.equal(JSON.stringify(src),before);
});
test('explicit valid allocation maths NEVER implies approval or posting',()=>{
  const src=fixture(),before=JSON.stringify(src);
  src.allocations=[
    {billingId:'FAKE-A',delta:amounts(20000,1000)},
    {billingId:'FAKE-B',delta:amounts(10571,529)}
  ]; // 21000 + 11100 == 32100; no automated tax allocation.
  const view=api.evaluate(src);
  assert.equal(view.allocationMathValid,true);
  assert.equal(view.canPost,false);assert.equal(view.canSave,false);
  assert.ok(view.blockers.some(x=>x.includes('發票')));
  assert.equal(src.sources.length,2);
  assert.equal(JSON.stringify(src),JSON.stringify({...JSON.parse(before),allocations:src.allocations}));
});
test('reject incorrect allocations and duplicate source identification',()=>{
  const variants=[
    s=>s.allocations=[{billingId:'FAKE-A',delta:amounts(20000,1000)}],
    s=>s.allocations=[{billingId:'FAKE-A',delta:amounts(20000,1000)},{billingId:'FAKE-B',delta:amounts(10000,500)}],
    s=>s.sources[1].billingId='FAKE-A',
    s=>s.sources[1].receivableId='FAKE-AR-A',
    s=>s.originalTotals.tax=30101,
    s=>s.sourceIds[1]='FAKE-A',
    s=>s.expectedSnapshot='stale-snapshot',
    s=>s.documentStatus='archived',
    s=>s.termsChanged=true,
    s=>s.settlementChanged=true,
    s=>s.issues.push('source conflict'),
    s=>s.existingAdjustments=null,
    s=>s.sources[0].invoice.status='unknown',
    s=>s.sources[1].invoice.status='no_invoice',
    s=>s.approvedGross=632101,
    s=>s.approvedGross=632100,
    s=>s.approvedGross=0
  ];
  for(const change of variants){const s=fixture();change(s);
    assert.throws(()=>api.evaluate(s),'expected validation failure');}
});
test('existing credits, collected payments and pending cheques block future posting',()=>{
  const s=fixture();
  s.existingAdjustments=[{id:'FAKE-EXISTING'}];
  s.sources[0].settlement.received=50000;
  s.sources[0].settlement.pendingCheque=10000;
  const before=JSON.stringify(s),v=api.evaluate(s);
  assert.equal(v.received,50000);assert.equal(v.pendingCheque,10000);
  assert.ok(v.blockers.some(x=>x.includes('其他折讓')));
  assert.ok(v.blockers.some(x=>x.includes('收款')));
  assert.ok(v.blockers.some(x=>x.includes('支票')));
  assert.equal(JSON.stringify(s),before);
});
test('single bill review needs exactly one original source, never saves',()=>{
  const s=fixture();
  s.scope='single';s.documentId='FAKE-SINGLE';
  s.sources=[s.sources[0]];s.sourceIds=undefined;
  s.originalTotals=amounts(524000,26200);s.approvedGross=540200;
  const view=api.evaluate(s);
  assert.equal(view.discountGross,10000);assert.equal(view.sourceCount,1);
  assert.equal(view.canPost,false);assert.equal(view.canSave,false);
});
test('no app inclusion and no writer API in the review module',()=>{
  const root=path.join(__dirname,'..');
  const file=fs.readFileSync(path.join(root,'assets/js/p40-16a-concession-review.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(!app.includes('p40-16a-concession-review.js'));
  for(const marker of ['.persist(','.saveBilling(','.saveExternalBillingDocument(',
    '.updateReceivable(','.saveInvoice(','.post(','fetch(','XMLHttpRequest',
    'supabase','localStorage','indexedDB','document.cookie','window.location']){
      assert.equal(file.includes(marker),false,marker+' is forbidden');
  }
});
