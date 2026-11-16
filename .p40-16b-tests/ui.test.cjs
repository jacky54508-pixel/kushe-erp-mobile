'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ui=require('../assets/js/p40-16b-concession-allocation-ui.js');
const money=(u,t)=>({untaxed:u,tax:t,grossTotal:u+t,retention:0,receivable:u+t});
const original=()=>({
 scope:'merged',documentId:'SYNTHETIC-G',documentRevision:1,documentStatus:'active',
 sourceIds:['SYNTH-A','SYNTH-B'],originalTotals:money(602000,30100),
 approvedGross:600000,expectedSnapshot:'v1',observedSnapshot:'v1',
 existingAdjustments:[],issues:[],termsChanged:false,settlementChanged:false,
 sources:[
  {billingId:'SYNTH-A',receivableId:'SYNTH-AR-A',amounts:money(524000,26200),
   settlement:{received:0,retentionReceived:0,pendingCheque:0},invoice:{status:'invoice_pending',number:''}},
  {billingId:'SYNTH-B',receivableId:'SYNTH-AR-B',amounts:money(78000,3900),
   settlement:{received:0,retentionReceived:0,pendingCheque:0},invoice:{status:'invoiced',number:'FAKE'}}
 ]});
const fakeForm=()=>({
 date:'2026-11-16',reason:'synthetic approved rebate',evidence:'FAKE document',
 approvedGross:'600000',
 rows:[
  {billingId:'SYNTH-A',untaxed:'20000',tax:'1000',grossTotal:'21000',retention:'0',receivable:'21000'},
  {billingId:'SYNTH-B',untaxed:'10571',tax:'529',grossTotal:'11100',retention:'0',receivable:'11100'}
 ]});
test('manual draft includes exactly matching identified sources, safe integer amounts',()=>{
 const before=original(),snap=JSON.stringify(before),form=fakeForm();
 const result=ui.prepare(before,form);
 assert.equal(result.date,'2026-11-16');assert.equal(result.fields.allocations.length,2);
 assert.equal(result.fields.allocations[0].delta.grossTotal,21000);
 assert.equal(result.fields.allocations[1].delta.grossTotal,11100);
 assert.equal(result.fields.approvedGross,600000);
 assert.equal(JSON.stringify(before),snap);
});
test('invalid date, insufficient evidence, wrong source, missing and non-integer amounts fail',()=>{
 const change=[
  f=>f.date='2026-02-30',f=>f.date='not-date',
  f=>f.reason='',f=>f.reason='x',
  f=>f.evidence='x'.repeat(301),
  f=>f.rows[0].billingId='ANOTHER',
  f=>f.rows.pop(),
  f=>f.rows[1].tax='',
  f=>f.rows[1].tax='1.5',
  f=>f.rows[0].grossTotal='-1',
  f=>f.rows[0].grossTotal='999999999999999999999',
  f=>f.approvedGross=''
 ];
 for(const fn of change){const f=fakeForm();fn(f);assert.throws(()=>ui.prepare(original(),f));}
});
test('not loaded in index and no storage writers in UI module',()=>{
 const root=path.join(__dirname,'..'),
 app=fs.readFileSync(path.join(root,'index.html'),'utf8'),
 source=fs.readFileSync(path.join(root,'assets/js/p40-16b-concession-allocation-ui.js'),'utf8');
 assert.ok(!app.includes('p40-16a-concession-review.js'));
 assert.ok(!app.includes('p40-16b-concession-allocation-ui.js'));
 for(const x of ['localStorage','indexedDB','fetch(','supabase','.persist(','.saveBilling(',
  '.updateBilling(','.saveExternalBillingDocument(','.saveInvoice(','.post(','XMLHttpRequest']){
   assert.equal(source.includes(x),false,x+' must not exist');
 }
 assert.ok(source.includes('canPost:false'));
 assert.ok(source.includes('canSave:false'));
});
