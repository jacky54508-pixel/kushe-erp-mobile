'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const K=require('./p37-19k-atomic-settlement.cjs');
const L=require('./p37-19l-store-cloud-cas.cjs');
const J=require('./p37-19j-multi-document-projection.cjs');
const A='P37-19-SYN-DEVICE-A',B='P37-19-SYN-DEVICE-B';
const AR='P37-19-SYN-AR-1',BILL='P37-19-SYN-BILL-1',BANK='P37-19-SYN-BANK-1';
const original={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
const reduction={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
const effective={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
const IDs={billingId:BILL,billingNo:'P37-19-SYN-NO-1',invoiceId:'P37-19-SYN-INVOICE-1',invoiceNo:'P37-19-SYN-INVOICENO-1',receivableId:AR};
const copy=x=>JSON.parse(JSON.stringify(x));
function inspector(){
 const ctx={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8'),ctx);
 return ctx.window.KusheP3718EffectiveLedger;
}
const ledger=inspector();
function source(){
 const b={id:BILL,number:IDs.billingNo,receivableId:AR,invoiceStatus:'invoiced',
   invoiceNo:IDs.invoiceNo,date:'2026-11-01',project:'P37-19-SYN-PROJECT-A',
   amount:original.untaxed,preTaxAmount:original.untaxed,tax:original.tax,taxAmount:original.tax,
   grossTotal:original.gross,taxIncludedAmount:original.gross,total:original.receivable,
   retention:original.retention,retentionAmount:original.retention};
 const ar={id:AR,billingId:BILL,sourceNo:IDs.billingNo,invoiceNo:IDs.invoiceNo,
   amount:original.receivable,retention:original.retention,retentionAmount:original.retention,
   received:100000,legacyReceived:100000,retentionReceived:0,legacyRetentionReceived:0,
   receivableCheques:[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE-A',
    status:'pending',revision:1,amount:350000,deductions:[{amount:50000}],reservedAmount:400000}]};
 const i={id:IDs.invoiceId,billingId:BILL,sourceType:'billing',sourceId:BILL,
  invoiceNumber:IDs.invoiceNo,status:'issued',amount:original.untaxed,netAmount:original.untaxed,
  tax:original.tax,taxAmount:original.tax,total:original.gross,grossAmount:original.gross};
 const a={schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',
  source:{...IDs,documentSnapshot:'P37-19-SYN-DOCUMENT',draftVersion:1},
  idempotencyKey:'billing-allowance::'+BILL+'::'+IDs.invoiceNo,billingId:BILL,receivableId:AR,
  invoiceNo:IDs.invoiceNo,original,reduction:null,allowance:reduction,effective,
  posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',
   approvedBy:'P37-19-SYN-AUDIT',approvedAt:'2026-11-06T00:00:00+08:00',
   verificationReference:'P37-19-SYN-REF'},
  voucher:{number:'P37-19-SYN-VOUCHER',date:'2026-11-06',
   proofLocation:'SYNTHETIC_NOT_OFFICIAL',verificationReference:'P37-19-SYN-REF'}};
 const b2={id:'P37-19-SYN-BILL-2',number:'P37-19-SYN-NO-2',
  receivableId:'P37-19-SYN-AR-2',invoiceStatus:'no_invoice',invoiceNo:'',
  date:'2026-10-26',amount:50000,preTaxAmount:50000,tax:2500,taxAmount:2500,
  grossTotal:52500,taxIncludedAmount:52500,total:52500,retention:0,retentionAmount:0};
 const a2={id:'P37-19-SYN-AR-2',billingId:b2.id,sourceNo:b2.number,
  amount:52500,retention:0,retentionAmount:0,received:0,retentionReceived:0,
  legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]};
 return {schema:J.FIXTURE,scope:J.SCOPE,productionData:false,postingEnabled:false,cloudWrites:0,
   meta:{businessSnapshotRevision:{id:'P37-19-SYN-REV'}},billings:[b,b2],
   receivables:[ar,a2],invoices:[i],billingAllowances:[a],
   receipts:[],retentionReceipts:[],bankTransactions:[]};
}
const make=()=>L.initialize(K.sandbox(source(),ledger),ledger);
const receipt=(sys,device,key,amount=50000,entry)=>({
 schema:K.TX,kind:'receipt_add',key:'P37-19-SYN-TX-'+key,
 receivableId:AR,billingId:BILL,
 expectedRevision:sys.devices.find(d=>d.id===device).local.revision,
 expectedFingerprint:K.digest(sys.devices.find(d=>d.id===device).local),
 expectedBusinessRevision:sys.devices.find(d=>d.id===device).local.data.meta.businessSnapshotRevision.id,
 entryId:entry||'P37-19-SYN-RECEIPT-'+key,cashAmount:amount,
 deductions:[],fee:0,bankId:BANK
});
const retention=(sys,device,key,amount=2000)=>({
 schema:K.TX,kind:'retention_add',key:'P37-19-SYN-TX-'+key,
 receivableId:AR,billingId:BILL,
 expectedRevision:sys.devices.find(d=>d.id===device).local.revision,
 expectedFingerprint:K.digest(sys.devices.find(d=>d.id===device).local),
 expectedBusinessRevision:sys.devices.find(d=>d.id===device).local.data.meta.businessSnapshotRevision.id,
 entryId:'P37-19-SYN-RETENTION-'+key,cashAmount:amount,fee:100,bankId:BANK
});
const stage=(sys,device,intent)=>L.localCommit(sys,L.prepare(sys,device,intent,ledger),ledger).scenario;
test('two fake devices start on the exact same synthetic source and remote baseline',()=>{
 const s=make(),before=JSON.stringify(s),v=L.status(s,ledger);
 assert.equal(v.devices.length,2);
 assert.deepEqual(v.devices.map(x=>x.status),['READY','READY']);
 assert.equal(v.remoteVersion,'41');assert.equal(v.remoteFingerprintMatches,true);
 assert.equal(v.realTwoBrowserCASVerified,false);
 assert.equal(v.postingEnabled,false);assert.equal(v.releaseBlocked,true);
 assert.equal(JSON.stringify(s),before);
});
test('local draft commit does not claim remote sync or real bank posting',()=>{
 const s=make(),before=JSON.stringify(s),a=receipt(s,A,'A');
 const plan=L.prepare(s,A,a,ledger);
 assert.equal(plan.canWriteFormalERP,false);
 const result=L.localCommit(s,plan,ledger),next=result.scenario;
 assert.equal(result.localCommitted,true);assert.equal(result.remoteCommitted,false);
 assert.equal(next.devices[0].status,'PENDING_UPLOAD');
 assert.equal(next.devices[0].local.revision,1);
 assert.equal(next.devices[0].local.data.receipts.length,1);
 assert.equal(next.devices[0].local.data.bankTransactions.length,1);
 assert.equal(next.devices[0].local.data.bankTransactions[0].amount,50000);
 assert.equal(next.devices[0].emergencyMirrorDigest,next.devices[0].localDigest);
 assert.equal(next.devices[0].commitTokenDigest,next.devices[0].localDigest);
 assert.equal(next.remote.version,'41');assert.equal(next.remote.envelope.revision,0);
 assert.equal(JSON.stringify(s),before);
});
test('two devices race against one version; exactly one mock cloud CAS wins and losing local journal is retained',()=>{
 const s=make(),a=L.prepare(s,A,receipt(s,A,'RACE-A',50000),ledger),
  b=L.prepare(s,B,receipt(s,B,'RACE-B',75000),ledger);
 const first=L.localCommit(s,a,ledger).scenario;
 const both=L.localCommit(first,b,ledger).scenario;
 const win=L.send(both,A,ledger).scenario;
 assert.equal(win.remote.version,'42');
 assert.equal(win.devices[0].status,'SYNCED');
 assert.equal(win.devices[1].status,'PENDING_UPLOAD');
 const rejected=L.send(win,B,ledger);
 assert.equal(rejected.status,'REMOTE_CAS_CONFLICT_STOP');
 assert.equal(rejected.scenario.devices[1].status,'CONFLICT_STOP');
 assert.equal(rejected.scenario.devices[1].local.data.receipts.length,1);
 assert.equal(rejected.scenario.remote.envelope.data.receipts.length,1);
 assert.equal(rejected.scenario.remote.envelope.data.receipts[0].cashAmount,50000);
 assert.equal(rejected.scenario.devices[1].outbox.expectedVersion,'41');
 assert.equal(rejected.scenario.remote.version,'42');
 assert.throws(()=>L.send(rejected.scenario,B,ledger),/NO_COMMITTED_LOCAL_OUTBOX/);
 assert.equal(L.status(rejected.scenario,ledger).realCloudRequests,0);
 assert.equal(JSON.stringify(s),JSON.stringify(make()));
});
test('reverse race: B wins, A receives conflict; never auto-overwrite newer remote',()=>{
 const s=make(),planA=L.prepare(s,A,receipt(s,A,'A2',35000),ledger),
 planB=L.prepare(s,B,receipt(s,B,'B2',80000),ledger);
 const both=L.localCommit(L.localCommit(s,planA,ledger).scenario,planB,ledger).scenario;
 const win=L.send(both,B,ledger).scenario;
 const rejected=L.send(win,A,ledger);
 assert.equal(rejected.status,'REMOTE_CAS_CONFLICT_STOP');
 assert.equal(rejected.scenario.remote.envelope.data.receipts[0].cashAmount,80000);
 assert.equal(rejected.scenario.devices[0].local.data.receipts[0].cashAmount,35000);
});
test('local store failures after each staged layer leave source and remote byte-identical and retryable',()=>{
 const failures=['AFTER_PRIMARY','AFTER_EMERGENCY','AFTER_TOKENS','BEFORE_COMMIT_VERIFIED'];
 for(const point of failures){
  const s=make(),before=JSON.stringify(s),p=L.prepare(s,A,receipt(s,A,'CRASH-'+point.replaceAll('_','-'),10000),ledger);
  assert.throws(()=>L.localCommit(s,p,ledger,{failAt:point}),/INJECTED_LOCAL_ROLLBACK/);
  assert.equal(JSON.stringify(s),before);
  const successful=L.localCommit(s,p,ledger);
  assert.equal(successful.scenario.devices[0].status,'PENDING_UPLOAD');
  assert.equal(successful.scenario.remote.version,'41');
 }
});
test('remote may have applied before ACK was lost: no success until independent re-read reconciliation',()=>{
 const s=make(),d=stage(s,A,receipt(s,A,'ACK-LOST',15000)),before=JSON.stringify(d);
 const ambiguous=L.send(d,A,ledger,{mode:'TIMEOUT_AFTER_REMOTE'});
 assert.equal(ambiguous.status,'REMOTE_APPLIED_BUT_ACK_LOST');
 assert.equal(ambiguous.scenario.remote.version,'42');
 assert.equal(ambiguous.scenario.devices[0].status,'UNCERTAIN_REMOTE_ACK');
 assert.equal(ambiguous.remotelyVerified,false);
 assert.throws(()=>L.prepare(ambiguous.scenario,A,receipt(ambiguous.scenario,A,'NEW-ACTION'),ledger),/DEVICE_NOT_READY/);
 const verified=L.reconcile(ambiguous.scenario,A,ledger);
 assert.equal(verified.status,'REMOTE_RECONCILED_SAME_SNAPSHOT');
 assert.equal(verified.scenario.devices[0].status,'SYNCED');
 assert.equal(verified.scenario.devices[0].outbox,null);
 assert.equal(verified.noAutomaticResubmit,true);
 assert.equal(JSON.stringify(d),before);
});
test('timeout before remote commit remains unresolved; cannot silently retry or discard committed local entry',()=>{
 const s=make(),d=stage(s,A,receipt(s,A,'NOT-APPLIED',16000));
 const ambiguous=L.send(d,A,ledger,{mode:'TIMEOUT_BEFORE_REMOTE'});
 assert.equal(ambiguous.scenario.remote.version,'41');
 assert.equal(ambiguous.scenario.devices[0].status,'UNCERTAIN_REMOTE_ACK');
 const unresolved=L.reconcile(ambiguous.scenario,A,ledger);
 assert.equal(unresolved.status,'UNCHANGED_REMOTE_EXPLICIT_RETRY_REQUIRED');
 assert.equal(unresolved.scenario.devices[0].status,'MANUAL_RETRY_REQUIRED');
 assert.equal(unresolved.scenario.devices[0].local.data.receipts.length,1);
 assert.equal(unresolved.scenario.remote.envelope.data.receipts.length,0);
 assert.throws(()=>L.send(unresolved.scenario,A,ledger),/NO_COMMITTED_LOCAL_OUTBOX/);
});
test('authorization failure cannot accidentally succeed or clear the pending outbox',()=>{
 const s=make(),d=stage(s,A,receipt(s,A,'AUTH-FAIL',12000));
 const result=L.send(d,A,ledger,{mode:'AUTH_REJECTED'});
 assert.equal(result.status,'REQUIRES_REMOTE_READ_NO_AUTH_RETRY');
 assert.equal(result.scenario.devices[0].status,'UNCERTAIN_REMOTE_ACK');
 assert.equal(result.scenario.remote.version,'41');
 assert.equal(L.status(result.scenario,ledger).canPost,false);
});
test('retention change goes through the same mocked local and remote integrity barriers',()=>{
 const s=make(),d=stage(s,B,retention(s,B,'RETENTION',2200));
 assert.equal(d.devices[1].local.data.retentionReceipts.length,1);
 assert.equal(d.devices[1].local.data.bankTransactions[0].amount,2100);
 assert.equal(d.remote.envelope.data.retentionReceipts.length,0);
 const done=L.send(d,B,ledger);
 assert.equal(done.status,'SYNTHETIC_REMOTE_APPLIED');
 assert.equal(done.scenario.remote.envelope.data.retentionReceipts.length,1);
 assert.equal(done.scenario.remote.envelope.data.receivables[0].retentionReceived,2200);
 assert.equal(done.scenario.formalStoreWrites,0);
});
test('tampered draft, stale receipt intent, lost mirror and forged remote version all fail closed',()=>{
 const s=make(),intent=receipt(s,A,'TAMPER',20000),plan=L.prepare(s,A,intent,ledger);
 const forged=copy(plan);forged.draft.data.receipts[0].cashAmount+=1;
 assert.throws(()=>L.localCommit(s,forged,ledger),/PLAN_TAMPERED/);
 const wrong=copy(s);wrong.devices[0].emergencyMirrorDigest='not-a-checksum';
 assert.throws(()=>L.status(wrong,ledger),/MIRRORS/);
 const badRemote=copy(s);badRemote.remote.fingerprint='bad';
 assert.throws(()=>L.status(badRemote,ledger),/REMOTE_VERSION_OR_SNAPSHOT/);
 const stale=copy(plan);stale.expectedRemoteVersion='40';
 assert.throws(()=>L.localCommit(s,stale,ledger),/PRECOMMIT/);
 const changed=copy(s);changed.devices[0].trusted=false;
 assert.throws(()=>L.status(changed,ledger),/TRUSTED_DEVICE/);
});
test('nothing in the model can enable live financial writes; real Store and Cloud Sync integration remains absent',()=>{
 const file=fs.readFileSync(path.join(__dirname,'p37-19l-store-cloud-cas.cjs'),'utf8');
 const store=fs.readFileSync(path.join(__dirname,'../assets/js/erp-store.js'),'utf8');
 const sync=fs.readFileSync(path.join(__dirname,'../assets/js/cloud-sync.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.doesNotMatch(html,/p37-19l/i);
 assert.doesNotMatch(store,/p37-19l/i);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/STORE_LOCK_NAME/);
 assert.match(store,/dbReplaceStateCas/);
 assert.match(sync,/erp_state_cas_write_v2/);
 assert.doesNotMatch(file,/\b(?:indexedDB|localStorage|window)\s*(?:\.|\[|\()/);
 assert.doesNotMatch(file,/https:\/\/.*supabase\.co|service_role|KusheERPStore/);
 const imports=[...file.matchAll(/\brequire\((['"])(.*?)\1\)/g)].map(x=>x[2]);
 assert.deepEqual(imports,['./p37-19k-atomic-settlement.cjs']);
});
