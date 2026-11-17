'use strict';
/* P40-16D: synthetic-only, in-memory scenarios. Does not use real user records. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const A=require('../assets/js/p40-16a-concession-review.js');
const C=require('../assets/js/p40-16c-accounting-gate.js');
const D=require('../assets/js/p40-16d-ledger-simulator.js');
const amount=(untaxed,tax,retention=0)=>({untaxed,tax,grossTotal:untaxed+tax,retention,receivable:untaxed+tax-retention});
const clone=x=>JSON.parse(JSON.stringify(x));
function inputs(suffix=''){
  const id='SYNTH-DOC'+suffix, a='SYNTH-A'+suffix, b='SYNTH-B'+suffix;
  const sourceInput={
    scope:'merged',documentId:id,documentRevision:1,documentStatus:'active',
    sourceIds:[a,b],originalTotals:amount(602000,30100),approvedGross:600000,
    expectedSnapshot:'SYNTH-SNAP'+suffix,observedSnapshot:'SYNTH-SNAP'+suffix,
    existingAdjustments:[],issues:[],termsChanged:false,settlementChanged:false,
    sources:[
      {billingId:a,receivableId:'AR-'+a,amounts:amount(524000,26200),
        settlement:{received:0,retentionReceived:0,pendingCheque:0},
        invoice:{status:'invoice_pending',number:''}},
      {billingId:b,receivableId:'AR-'+b,amounts:amount(78000,3900),
        settlement:{received:0,retentionReceived:0,pendingCheque:0},
        invoice:{status:'invoiced',number:'SYNTH-INV'}}
    ],
    allocations:[
      {billingId:a,delta:amount(20000,1000)},
      {billingId:b,delta:amount(10571,529)}
    ]
  };
  const plan=C.reviewPostingPlan({
    reviewInput:sourceInput,ledger:[],operationKey:'SYNTH-EARLY-REVIEW-KEY'+suffix,
    approval:{ownerConfirmed:true,accountantConfirmed:true,date:'2026-11-16',
      reason:'SYNTH pre-approval',evidenceRef:'SYNTH-REF'},
    taxEvidence:[
      {billingId:a,accountantChecked:true,checkedOn:'2026-11-16',
       buyerType:'business',filingStatus:'not-reported',taxResolutionRef:'SYNTH-REVIEW-A'},
      {billingId:b,accountantChecked:true,checkedOn:'2026-11-16',
       buyerType:'business',filingStatus:'reported',invoiceNumber:'SYNTH-INV',
       allowanceEvidenceRef:'SYNTH-ALLOWANCE-REF',taxResolutionRef:'SYNTH-REVIEW-B'}
    ],
    policy:{commission:'preserve-original',payroll:'preserve-original',
      bank:'preserve-original',receivable:'manual-contra-review',retention:'manual-contra-review'}
  },A.evaluate);
  assert.equal(plan.readyForFurtherReview,true);
  return {sourceInput,plan};
}
const cmd=(ledger,review,n='1')=>({ledger,expectedRevision:ledger.revision,plan:review.plan,
  reviewInput:review.sourceInput,operationKey:'SYNTH-OP-'+n,eventId:'SYNTH-EVT-'+n,
  expectedSnapshot:review.sourceInput.expectedSnapshot,
  observedSnapshot:review.sourceInput.expectedSnapshot});
const reverse=(ledger,orig='SYNTH-EVT-1',key='SYNTH-REVERSE-OP-1')=>({
  ledger,expectedRevision:ledger.revision,operationKey:key,eventId:'SYNTH-REVERSE-EVENT-'+key,
  reversesEventId:orig,expectedSnapshot:'SYNTH-SNAP',observedSnapshot:'SYNTH-SNAP',
  reason:'SYNTH buyer cancellation'});

test('in-memory append-once preserves original and projects 32100 gross reduction',()=>{
  const base=D.empty(),r=inputs(),prior=JSON.stringify({base,r});
  const out=D.simulateAllowance(cmd(base,r));
  assert.equal(out.simulatedLedger.revision,1);
  assert.equal(out.simulatedLedger.events.length,1);
  assert.equal(out.mutationCount,0);
  assert.equal(out.canPost,false);assert.equal(out.canSave,false);
  assert.equal(out.simulatedLedger.events[0].kind,'SIMULATED_ALLOWANCE');
  assert.equal(out.simulatedLedger.events[0].sourceDeltas.length,2);
  const p=D.projection(out.simulatedLedger,'SYNTH-DOC');
  assert.equal(p.netReductions.grossTotal,32100);
  assert.equal(p.netReductions.untaxed,30571);
  assert.equal(p.netReductions.tax,1529);
  assert.equal(p.activeAllowances,1);
  assert.equal(JSON.stringify({base,r}),prior);
});
test('same operation+payload replay exactly once; different payload or event ID rejected',()=>{
  const review=inputs(),base=D.empty();
  const first=D.simulateAllowance(cmd(base,review));
  const second=D.simulateAllowance({...cmd(first.simulatedLedger,review),expectedRevision:0});
  assert.equal(second.wasDuplicate,true);
  assert.equal(second.simulatedLedger.revision,1);
  assert.equal(second.simulatedLedger.events.length,1);
  assert.throws(()=>D.simulateAllowance({...cmd(first.simulatedLedger,review),eventId:'DIFFERENT-EVENT'}),/重用/);
  assert.throws(()=>D.simulateAllowance({...cmd(first.simulatedLedger,review,'NEW-OP')}),/已有折讓/);
});
test('stale CAS blocks concurrent plan on an updated independent document',()=>{
  const base=D.empty(),r1=inputs(),r2=inputs('-OTHER');
  const first=D.simulateAllowance(cmd(base,r1)).simulatedLedger;
  const stale={...cmd(first,r2,'2'),expectedRevision:0};
  assert.throws(()=>D.simulateAllowance(stale),/CAS/);
  const fresh=D.simulateAllowance(cmd(first,r2,'2')).simulatedLedger;
  assert.equal(fresh.events.length,2);
  assert.equal(D.projection(fresh,'SYNTH-DOC-OTHER').netReductions.grossTotal,32100);
});
test('separate compensating reversal restores net 0 and never destroys original',()=>{
  const original=D.simulateAllowance(cmd(D.empty(),inputs())).simulatedLedger,
    before=JSON.stringify(original);
  const done=D.simulateReversal(reverse(original));
  assert.equal(done.simulatedLedger.revision,2);
  assert.equal(done.simulatedLedger.events[0].kind,'SIMULATED_ALLOWANCE');
  assert.equal(done.simulatedLedger.events[1].kind,'SIMULATED_REVERSAL');
  assert.equal(done.simulatedLedger.events[1].reversesEventId,'SYNTH-EVT-1');
  const p=D.projection(done.simulatedLedger,'SYNTH-DOC');
  assert.equal(p.netReductions.grossTotal,0);
  assert.equal(p.activeAllowances,0);
  assert.equal(JSON.stringify(original),before);
  assert.equal(done.mutationCount,0);
  assert.equal(done.canPost,false);
  const retry=D.simulateReversal({...reverse(done.simulatedLedger),expectedRevision:1});
  assert.equal(retry.wasDuplicate,true);
  assert.equal(retry.simulatedLedger.events.length,2);
  assert.throws(()=>D.simulateReversal(reverse(done.simulatedLedger,
    'SYNTH-EVT-1','SYNTH-REVERSE-OP-2')),/二次回沖/);
});
test('wrong snapshot, mismatched ledger revision or operation key are blocked',()=>{
  const first=D.simulateAllowance(cmd(D.empty(),inputs())).simulatedLedger;
  assert.throws(()=>D.simulateReversal({...reverse(first),observedSnapshot:'changed'}),/快照/);
  assert.throws(()=>D.simulateReversal({...reverse(first),expectedRevision:0}),/CAS/);
  assert.throws(()=>D.simulateAllowance({...cmd(D.empty(),inputs()),observedSnapshot:'changed'}),/快照/);
  assert.throws(()=>D.simulateAllowance({...cmd(D.empty(),inputs()),plan:{canPost:true}}),/會計/);
  assert.throws(()=>D.simulateAllowance({...cmd(D.empty(),inputs()),eventId:''}),/事件/);
});
test('ledger structure, duplicate history, malformed compensating events are rejected',()=>{
  const applied=D.simulateAllowance(cmd(D.empty(),inputs())).simulatedLedger;
  const tampered=[
    {...applied,revision:0},
    {...applied,events:[applied.events[0],applied.events[0]],revision:2},
    {...applied,events:[{...applied.events[0],deltas:{...applied.events[0].deltas,tax:0}}]},
    {...applied,events:[{...applied.events[0],sourceDeltas:[]}]}
  ];
  for(const bad of tampered)assert.throws(()=>D.validate(bad));
  const reversal=D.simulateReversal(reverse(applied)).simulatedLedger;
  const corrupted=clone(reversal);
  corrupted.events[1].deltas.grossTotal++;
  assert.throws(()=>D.validate(corrupted));
});
test('isolated module is never included by formal ERP and has no persistence API',()=>{
  const root=path.join(__dirname,'..'),
    index=fs.readFileSync(path.join(root,'index.html'),'utf8'),
    js=fs.readFileSync(path.join(root,'assets/js/p40-16d-ledger-simulator.js'),'utf8');
  assert.ok(!index.includes('p40-16d-ledger-simulator.js'));
  assert.ok(!index.includes('p40-16c-accounting-gate.js'));
  for(const value of ['fetch(','supabase','XMLHttpRequest','localStorage','indexedDB',
    '.persist(','.saveInvoice(','.updateReceivable(','.saveExternalBillingDocument(',
    '.saveBilling(','.post(','.commit(','document.cookie']){
    assert.equal(js.includes(value),false,value+' not allowed');
  }
});
