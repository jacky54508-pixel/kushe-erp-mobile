'use strict';
/* P40-16C exclusively synthetic, never connects to actual ERP or the network. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const A=require('../assets/js/p40-16a-concession-review.js');
const C=require('../assets/js/p40-16c-accounting-gate.js');
const a=(untaxed,tax,retention=0)=>({untaxed,tax,grossTotal:untaxed+tax,retention,receivable:untaxed+tax-retention});
function fixture(){
 const reviewInput={
  scope:'merged',documentId:'SYNTHETIC-MERGED',documentStatus:'active',documentRevision:2,
  sourceIds:['SYNTHETIC-A','SYNTHETIC-B'],originalTotals:a(602000,30100),
  approvedGross:600000,expectedSnapshot:'SYNTHETIC-SNAPSHOT-1',observedSnapshot:'SYNTHETIC-SNAPSHOT-1',
  existingAdjustments:[],issues:[],termsChanged:false,settlementChanged:false,
  sources:[
   {billingId:'SYNTHETIC-A',receivableId:'SYNTH-AR-A',amounts:a(524000,26200),
    settlement:{received:0,retentionReceived:0,pendingCheque:0},
    invoice:{status:'invoice_pending',number:''}},
   {billingId:'SYNTHETIC-B',receivableId:'SYNTH-AR-B',amounts:a(78000,3900),
    settlement:{received:0,retentionReceived:0,pendingCheque:0},
    invoice:{status:'invoiced',number:'FAKE-INV-B'}}
  ],
  allocations:[
   {billingId:'SYNTHETIC-A',delta:a(20000,1000)},
   {billingId:'SYNTHETIC-B',delta:a(10571,529)}
  ]
 };
 return {
  reviewInput,operationKey:'SYNTHETIC-UNIQUE-001',ledger:[],
  approval:{ownerConfirmed:true,accountantConfirmed:true,date:'2026-11-16',
    reason:'synthetic construction allowance',evidenceRef:'SYNTH-LETTER'},
  taxEvidence:[
   {billingId:'SYNTHETIC-A',accountantChecked:true,checkedOn:'2026-11-16',
    buyerType:'business',filingStatus:'not-reported',taxResolutionRef:'FAKE-TAX-REVIEW-A'},
   {billingId:'SYNTHETIC-B',accountantChecked:true,checkedOn:'2026-11-16',
    buyerType:'business',filingStatus:'reported',invoiceNumber:'FAKE-INV-B',
    allowanceEvidenceRef:'FAKE-CREDIT-EVIDENCE',taxResolutionRef:'FAKE-TAX-REVIEW-B'}
  ],
  policy:{commission:'preserve-original',payroll:'preserve-original',bank:'preserve-original',
    receivable:'manual-contra-review',retention:'manual-contra-review'}
 };
}
const evaluate=review=>A.evaluate(review);
test('fully documented synthetic review passes paperwork stage but NEVER posts',()=>{
 const p=fixture(),before=JSON.stringify(p),o=C.reviewPostingPlan(p,evaluate);
 assert.equal(o.schema,'kushe-p40-16c-nonposting-plan-v1');
 assert.equal(o.discountGross,32100);
 assert.equal(o.approvedGross,600000);assert.equal(o.originalGross,632100);
 assert.equal(o.readyForFurtherReview,true);
 assert.equal(o.canPost,false);assert.equal(o.canSave,false);assert.equal(o.reviewOnly,true);
 assert.deepEqual(o.proposedDeltas,a(30571,1529));
 for(const k of ['journalWritten','bankWritten','invoiceWritten','arWritten','commissionWritten'])assert.equal(o[k],0);
 assert.equal(JSON.stringify(p),before);
 assert.ok(o.warnings.some(x=>x.includes('未驗證')));
});
test('missing tax evidence or unknown filing/buyer rejects further review, preserving source',()=>{
 const modifiers=[
  p=>{p.taxEvidence=[]},
  p=>{p.taxEvidence[1].invoiceNumber=''},
  p=>{p.taxEvidence[1].allowanceEvidenceRef=''},
  p=>{p.taxEvidence[1].filingStatus='unknown'},
  p=>{p.taxEvidence[1].buyerType='unknown'},
  p=>{p.taxEvidence[1].accountantChecked=false},
  p=>{p.taxEvidence[0].taxResolutionRef=''},
  p=>{p.approval.ownerConfirmed=false},
  p=>{p.approval.accountantConfirmed=false},
  p=>{p.approval.evidenceRef=''},
  p=>{p.policy.commission='recalculate'},
  p=>{p.policy.receivable='overwrite-original'},
  p=>{p.reviewInput.sources[0].settlement.received=1000},
  p=>{p.reviewInput.sources[0].settlement.pendingCheque=900}
 ];
 for(const modify of modifiers){const p=fixture();modify(p),before=JSON.stringify(p);
   const o=C.reviewPostingPlan(p,evaluate);
   assert.equal(o.readyForFurtherReview,false);
   assert.ok(o.blockers.length);
   assert.equal(o.canPost,false);
   assert.equal(JSON.stringify(p),before);
 }
});
test('rejects duplicate request keys and prior allowance events',()=>{
 const event={eventId:'SYNTHETIC-EVENT-1',operationKey:'SYNTHETIC-KEY-1',
  documentId:'SYNTHETIC-MERGED',status:'POSTED_SIMULATED',deltas:a(30571,1529)};
 const repeat=fixture();repeat.ledger=[event];repeat.operationKey='SYNTHETIC-KEY-1';
 const a1=C.reviewPostingPlan(repeat,evaluate);
 assert.equal(a1.readyForFurtherReview,false);
 assert.ok(a1.blockers.some(x=>x.includes('唯一鍵')));
 const again=fixture();again.ledger=[event];
 const a2=C.reviewPostingPlan(again,evaluate);
 assert.equal(a2.readyForFurtherReview,false);
 assert.ok(a2.blockers.some(x=>x.includes('已存在折讓')));
 const bad=fixture();bad.ledger=[event,{...event}];
 assert.throws(()=>C.reviewPostingPlan(bad,evaluate),/重複/);
});
test('source tamper, stale snapshot, imbalanced allocations all fail closed',()=>{
 const mutations=[
 p=>p.reviewInput.expectedSnapshot='older',
 p=>p.reviewInput.sourceIds[1]='SYNTHETIC-A',
 p=>p.reviewInput.allocations[0].delta.tax=1001,
 p=>p.reviewInput.allocations[1].delta.grossTotal=11101,
 p=>p.reviewInput.originalTotals.grossTotal=632101,
 p=>p.reviewInput.sources[1].receivableId='SYNTH-AR-A'
 ];
 for(const change of mutations){const p=fixture();change(p);assert.throws(()=>C.reviewPostingPlan(p,evaluate));}
});
test('reversal preview requires an existing posted event and unique new key, does not modify ledgers',()=>{
 const event={eventId:'SYNTH-POSTED-1',operationKey:'SYNTH-OLD-KEY',
  documentId:'SYNTHETIC-MERGED',status:'POSTED_SIMULATED',deltas:a(30571,1529)};
 const rows=[event],before=JSON.stringify(rows);
 const input={recorded:event,ledger:rows,operationKey:'SYNTH-REVERSE-1',
   expectedSnapshot:'SYNTH-STATE-V2',observedSnapshot:'SYNTH-STATE-V2'};
 const o=C.reviewReversalPlan(input);
 assert.equal(o.originalGrossAdjustment,32100);
 assert.equal(o.reversedAmountPosted,0);assert.equal(o.canPost,false);
 assert.equal(o.canSave,false);
 assert.equal(JSON.stringify(rows),before);
 const stale={...input,observedSnapshot:'changed'};
 assert.throws(()=>C.reviewReversalPlan(stale),/快照/);
 const dup={...input,ledger:[event,{eventId:'SYNTH-REV-EVENT',
   operationKey:'SYNTH-REVERSE-OLD',documentId:'SYNTHETIC-MERGED',
   status:'REVERSED_SIMULATED',reversesEventId:event.eventId}]};
 assert.throws(()=>C.reviewReversalPlan(dup),/已被回沖/);
 const replay={...input,operationKey:'SYNTH-OLD-KEY'};
 assert.throws(()=>C.reviewReversalPlan(replay),/重複/);
 const invalid={...input,recorded:{...event,status:'PROPOSED_SIMULATED'}};
 assert.throws(()=>C.reviewReversalPlan(invalid));
});
test('all new modules excluded from ERP and contain no writer or network API',()=>{
 const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const code=fs.readFileSync(path.join(root,'assets/js/p40-16c-accounting-gate.js'),'utf8');
 assert.ok(!app.includes('p40-16c-accounting-gate.js'));
 for(const writer of ['fetch(','localStorage','indexedDB','document.cookie','XMLHttpRequest',
  '.persist(','.saveBilling(','.updateBilling(','.saveInvoice(','.updateReceivable(',
  '.saveExternalBillingDocument(','.savePayroll(','.commit(','.post(','supabase']){
   assert.equal(code.includes(writer),false,writer+' is not allowed');
 }
 assert.ok(code.includes('canPost:false'));assert.ok(code.includes('canSave:false'));
});
