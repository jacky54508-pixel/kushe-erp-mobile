'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const gate=require('./p37-19d-precommit-review.cjs');
const reader=require('../assets/js/p37-billing-formal-readonly-projection.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const ids={billingId:'P37-19-SYN-BILL',billingNo:'P37-19-SYN-NO',invoiceId:'P37-19-SYN-INVID',invoiceNo:'P37-19-SYN-INVNO',receivableId:'P37-19-SYN-ARID'};
const original={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
const discount={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
const effective={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
function ledgerReader(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8'),context);return context.window.KusheP3718EffectiveLedger;}
function state(){
 const b={id:ids.billingId,number:ids.billingNo,receivableId:ids.receivableId,invoiceNo:ids.invoiceNo,invoiceStatus:'invoiced',amount:original.untaxed,preTaxAmount:original.untaxed,tax:original.tax,taxAmount:original.tax,grossTotal:original.gross,taxIncludedAmount:original.gross,total:original.receivable,retention:original.retention,retentionAmount:original.retention};
 const ar={id:ids.receivableId,billingId:ids.billingId,sourceNo:ids.billingNo,invoiceNo:ids.invoiceNo,amount:original.receivable,retention:original.retention,retentionAmount:original.retention,received:0,retentionReceived:0,legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]};
 const inv={id:ids.invoiceId,billingId:ids.billingId,sourceType:'billing',sourceId:ids.billingId,invoiceNumber:ids.invoiceNo,status:'issued',netAmount:original.untaxed,amount:original.untaxed,taxAmount:original.tax,tax:original.tax,grossAmount:original.gross,total:original.gross};
 const allowance={schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',
  source:{...ids,documentSnapshot:'P37-19-SYN-SNAP',draftVersion:1},
  idempotencyKey:'billing-allowance::'+ids.billingId+'::'+ids.invoiceNo,
  billingId:ids.billingId,receivableId:ids.receivableId,invoiceNo:ids.invoiceNo,
  original,allowance:discount,effective,
  posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',approvedBy:'P37-19-SYN-APPROVER',approvedAt:'2026-11-05T12:00:00+08:00',verificationReference:'P37-19-SYN-REF'},
  voucher:{number:'P37-19-SYN-VOUCH',date:'2026-11-05',proofLocation:'SYNTHETIC_ONLY_NOT_VERIFIED',verificationReference:'P37-19-SYN-REF'}};
 return {meta:{businessSnapshotRevision:{id:'P37-19-SYN-REV'}},billings:[b],receivables:[ar],
  invoices:[inv],billingAllowances:[allowance],receipts:[],retentionReceipts:[],bankTransactions:[]};
}
function setup(s=state()){
 const projection=reader.project(s,ids.receivableId,ledgerReader(),{mode:reader.MODE,expectedRevisionId:'P37-19-SYN-REV'});
 const remote={schema:gate.REMOTE,scope:gate.SCOPE,simulated:true,productionSource:false,cloudWrites:0,
  userId:'P37-19-SYN-USER',companyId:'P37-19-SYN-COMPANY',
  syncVersion:'41',snapshotRevisionId:'P37-19-SYN-REV',
  fingerprint:'P37-19-SYN-FINGERPRINT',sourceFingerprint:'P37-19-SYN-SOURCE'};
 const device=(id)=>({schema:gate.DEVICE,scope:gate.SCOPE,id,userId:'P37-19-SYN-USER',companyId:'P37-19-SYN-COMPANY',trusted:true,
  authLevel:'SYNTHETIC_AAL2_ONLY',permissions:'SYNTHETIC_OWNER_ONLY',
  storeRevisionId:'P37-19-SYN-REV',sourceFingerprint:'P37-19-SYN-SOURCE',
  lastRemoteSyncVersion:'41',lastRemoteFingerprint:'P37-19-SYN-FINGERPRINT',
  pendingLocalWrites:0,editorDirty:false,syncBusy:false,recoveryPending:false,storeTransactionActive:false});
 const intent=(dev,kind,amount,id)=>({
  schema:gate.INTENT,scope:gate.SCOPE,postingEnabled:false,requestedByDevice:dev.id,
  expectedStoreRevision:'P37-19-SYN-REV',expectedRemoteSyncVersion:'41',
  expectedRemoteFingerprint:'P37-19-SYN-FINGERPRINT',receivableId:ids.receivableId,billingId:ids.billingId,invoiceNo:ids.invoiceNo,
  idempotencyKey:'P37-19-SYN-ACTION-'+id,kind,amount});
 return {projection,remote,device,intent};
}
test('valid synthetic principal receipt is still never authorized for formal posting',()=>{
 const x=setup(),dev=x.device('P37-19-SYN-DEVICE-A'),before=JSON.stringify(x);
 const result=gate.preview(x.projection,dev,x.remote,x.intent(dev,'receipt',1160900,'R1'));
 assert.equal(result.syntheticEligible,true);assert.equal(result.maximum,1160900);
 assert.equal(result.canPost,false);assert.equal(result.postingEnabled,false);assert.equal(result.cloudWrites,0);
 assert.equal(result.actualBankIncome,0);assert.equal(result.formalReceiptCount,0);
 assert.equal(result.blockers.length,4);assert.equal(JSON.stringify(x),before);
});
test('one-dollar overlimit in principal and retention is blocked',()=>{
 const x=setup(),d=x.device('P37-19-SYN-DEVICE-A');
 assert.throws(()=>gate.preview(x.projection,d,x.remote,x.intent(d,'receipt',1160901,'OVER1')),/超過/);
 assert.throws(()=>gate.preview(x.projection,d,x.remote,x.intent(d,'retention',122201,'OVER2')),/超過/);
 assert.equal(gate.preview(x.projection,d,x.remote,x.intent(d,'retention',122200,'OK')).formalRetentionReceiptCount,0);
});
test('pending cheque reduces new receipt available capacity and cheque registration limit',()=>{
 const s=state();s.receivables[0].receivableCheques=[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE-1',status:'pending',revision:1,amount:350000,deductions:[{amount:50000}],reservedAmount:400000}];
 const x=setup(s),d=x.device('P37-19-SYN-DEVICE-A');
 assert.equal(x.projection.proposed.receiptInputMaximum,760900);
 assert.throws(()=>gate.preview(x.projection,d,x.remote,x.intent(d,'receipt',760901,'OVER3')),/超過/);
 assert.equal(gate.preview(x.projection,d,x.remote,x.intent(d,'cheque_register',760900,'OK2')).canPost,false);
});
test('cheque clearing needs exact synthetic evidence and cannot register bank income',()=>{
 const s=state();s.receivables[0].receivableCheques=[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE-1',status:'pending',revision:1,amount:400000,deductions:[],reservedAmount:400000}];
 const x=setup(s),d=x.device('P37-19-SYN-DEVICE-A');
 const intent=x.intent(d,'cheque_clear',400000,'CLR');
 assert.throws(()=>gate.preview(x.projection,d,x.remote,intent),/模擬支票/);
 intent.syntheticCheque={id:'P37-19-SYN-CHEQUE-1',scope:gate.SCOPE,status:'pending',
  receivableId:ids.receivableId,reservedAmount:400000,existingReceiptCount:0,existingBankCount:0};
 const result=gate.preview(x.projection,d,x.remote,intent);
 assert.equal(result.formalChequeCount,0);assert.equal(result.cloudWrites,0);assert.equal(result.canPost,false);
 const bad={...intent,syntheticCheque:{...intent.syntheticCheque,existingBankCount:1}};
 assert.throws(()=>gate.preview(x.projection,d,x.remote,bad),/不符合/);
});
test('untrusted, dirty editor, pending recovery, busy sync or wrong company all fail closed',()=>{
 const x=setup(),d=x.device('P37-19-SYN-DEVICE-A'),i=x.intent(d,'receipt',100,'SAFE');
 for(const data of [{trusted:false},{editorDirty:true},{pendingLocalWrites:1},{recoveryPending:true},{syncBusy:true},{storeTransactionActive:true},{companyId:'P37-19-SYN-OTHER'}]){
  assert.throws(()=>gate.preview(x.projection,{...d,...data},x.remote,i));
 }
});
test('stale remote version, stale fingerprint and changed business revision all fail closed',()=>{
 const x=setup(),d=x.device('P37-19-SYN-DEVICE-A'),i=x.intent(d,'receipt',100,'SAFE');
 assert.throws(()=>gate.preview(x.projection,d,{...x.remote,syncVersion:'42'},i),/過期|不一致/);
 assert.throws(()=>gate.preview(x.projection,d,{...x.remote,fingerprint:'P37-19-SYN-OTHER'},i),/過期|不一致/);
 assert.throws(()=>gate.preview(x.projection,d,{...x.remote,snapshotRevisionId:'P37-19-SYN-NEWER'},i),/較新|不一致/);
 assert.throws(()=>gate.preview(x.projection,d,x.remote,{...i,expectedStoreRevision:'P37-19-SYN-OLDER'}),/版本/);
});
test('two synthetic devices racing against the same remote baseline deny stale second',()=>{
 const x=setup(),a=x.device('P37-19-SYN-DEVICE-A'),b=x.device('P37-19-SYN-DEVICE-B');
 const first=x.intent(a,'receipt',100,'RACE-A'),second=x.intent(b,'receipt',100,'RACE-B');
 const before=JSON.stringify([x,a,b,first,second]);
 const result=gate.simulateRace(x.projection,x.remote,a,first,b,second);
 assert.equal(result.firstDevice,'SYNTHETIC_PREVIEW_ONLY');assert.equal(result.secondDevice,'BLOCKED_STALE_REMOTE');
 assert.equal(result.proposedRemoteSyncVersion,'42');assert.equal(result.cloudWrites,0);
 assert.equal(result.realCloudRequests,0);assert.equal(result.sourceUnchanged,true);
 assert.equal(JSON.stringify([x,a,b,first,second]),before);
 const reverse=gate.simulateRace(x.projection,x.remote,b,second,a,first);
 assert.equal(reverse.secondDevice,'BLOCKED_STALE_REMOTE');
});
test('operations requiring currently unverified settlement lifecycle never claim support',()=>{
 const x=setup(),d=x.device('P37-19-SYN-DEVICE-A');
 for(const kind of ['employee_cash_handover','allowance_post','bank_reconciliation','payroll_release'])
  assert.throws(()=>gate.preview(x.projection,d,x.remote,x.intent(d,kind,100,kind.toUpperCase().replace(/_/g,'-'))),/尚未整合/);
});
test('pure gate rejects fabricated real-company identity, fake successful status or malformed amounts',()=>{
 const x=setup(),d=x.device('P37-19-SYN-DEVICE-A'),i=x.intent(d,'receipt',100,'A1');
 assert.throws(()=>gate.preview({...x.projection,postingEnabled:true},d,x.remote,i),/唯讀/);
 assert.throws(()=>gate.preview({...x.projection,status:'FORMAL_POSTED'},d,x.remote,i),/唯讀/);
 assert.throws(()=>gate.preview(x.projection,{...d,id:'real-device-id'},x.remote,i),/真實/);
 assert.throws(()=>gate.preview(x.projection,d,{...x.remote,productionSource:true},i),/隔離/);
 assert.throws(()=>gate.preview(x.projection,d,x.remote,{...i,amount:100.5}),/安全整數/);
});
test('regression: original ERP money writers and Cloud Sync API still protected and untouched',()=>{
 const dir=path.join(__dirname,'../assets/js');
 const store=fs.readFileSync(path.join(dir,'erp-store.js'),'utf8');
 const sync=fs.readFileSync(path.join(dir,'cloud-sync.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const names=['addReceipt','updateReceipt','deleteReceipt','addRetentionReceipt','updateRetentionReceipt','deleteRetentionReceipt','saveReceivableCheque','clearReceivableCheque'];
 const writers=store.slice(store.indexOf('const STORE_WRITER_NAMES='),store.indexOf('function exposeStoreRead'));
 for(const name of names)assert.match(writers,new RegExp("'"+name+"'"));
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/此筆已關聯折讓紀錄；P37 正式折讓、收款、保留款與票據尚未完整整合/);
 assert.match(store,/function billingAllowanceFormalReadOnlyReport\(receivableId,expectedRevisionId\)/);
 assert.match(sync,/erp_state_cas_write_v2/);
 assert.match(sync,/REMOTE_NEWER/);
 assert.doesNotMatch(html,/p37-19d-precommit-review/);
 assert.doesNotMatch(store,/KusheP3719DPrecommitReview/);
});
