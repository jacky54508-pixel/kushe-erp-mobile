'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const inspection=require('./p37-19j-financial-integration-gaps.cjs');
const root=path.resolve(__dirname,'..');
test('all real ERP consumers are located, all remain officially unintegrated and release stays blocked',()=>{
 const report=inspection.audit(root);
 assert.equal(report.trackedConsumers,12);
 assert.equal(report.releaseStatus,'BLOCKED');
 assert.equal(report.canPostAllowance,false);assert.equal(report.canDeployMain,false);
 assert.equal(report.realFinanceDataRead,false);
 assert.equal(report.cloudWrites,0);
 assert.ok(report.checks.every(r=>r.status==='NOT_CONNECTED_TO_FORMAL_ALLOWANCE_REVIEW'));
 for(const id of ['RECEIVABLE_SETTLEMENT_WRITER','RETENTION_RECEIPT_WRITERS',
   'CHEQUE_RESERVATIONS_AND_CLEARING','DASHBOARD_OPEN_AR','DASHBOARD_RETENTION',
   'REPORTS_REUSE_DASHBOARD','COMMISSION_UNLOCK_ON_ORIGINAL_BILLING',
   'CLOUD_STATE_CAS','LIVE_ALLOWANCE_BLOCKER'])
   assert.ok(report.checks.some(x=>x.id===id),id);
});
test('formal Store writer set remains unchanged: only optional review getter is exposed',()=>{
 const s=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const writerSet=s.slice(s.indexOf('const STORE_WRITER_NAMES'),s.indexOf('function exposeStoreRead'));
 assert.match(s,/function billingAllowanceFormalReadOnlyReport\(receivableId,expectedRevisionId\)/);
 assert.doesNotMatch(writerSet,/billingAllowanceFormalReadOnlyReport/);
 assert.doesNotMatch(s,/p37-19j/);
 assert.match(s,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(s,/P37 正式折讓、收款、保留款與票據尚未完整整合/);
 const sync=fs.readFileSync(path.join(root,'assets/js/cloud-sync.js'),'utf8');
 assert.match(sync,/erp_state_cas_write_v2/);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.doesNotMatch(html,/p37-19j/);
});
test('unexpected consumer mutation fails closed rather than claiming integration',()=>{
 const shadow=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'p3719j-static-'));
 try{
  const keys=['assets/js/erp-store.js','assets/js/dashboard.js',
   'assets/js/reports.js','assets/js/cloud-sync.js','index.html'];
  for(const key of keys){
   const file=path.join(shadow,key);fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.copyFileSync(path.join(root,key),file);
  }
  const dashboard=path.join(shadow,'assets/js/dashboard.js');
  fs.writeFileSync(dashboard,fs.readFileSync(dashboard,'utf8').replace(
   'const outstandingAR = sum(openAR, (row) => Math.max(0, arAmount(row) - paidAR(row)));',
   'const outstandingAR = 1;'));
  assert.throws(()=>inspection.audit(shadow),/DASHBOARD_OPEN_AR/);
 }finally{fs.rmSync(shadow,{recursive:true,force:true})}
});
