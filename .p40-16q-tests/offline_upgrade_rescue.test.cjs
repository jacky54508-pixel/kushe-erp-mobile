'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeClient,hash,MODULES}=require('./offline_upgrade_rescue.cjs');
const data=()=>({original:{doc:'SYNTH-Q-BILL',gross:632100,
 sourceIds:['SYNTH-A','SYNTH-B']},ledgerProjection:{gross:632100},
 ui:{note:'base'},daily:[],projects:[],billings:[],receivables:[],
 invoices:[],receipts:[],retentionReceipts:[],materials:[],payables:[],
 payroll:[],commissions:[],bankTransactions:[],settings:{}});
const remote=(phase='shadow',sync=2,ledger=0,snapshot=data())=>
 ({phase,sync,ledger,snapshot});
const setup=()=>{const cloud=remote();return {cloud,client:makeClient('SYNTH-Q-PC',cloud)}};
test('original hash and known business module list stable',()=>{
 assert.equal(MODULES.length,13);
 assert.equal(hash(data()),hash(data()));
 assert.equal(data().original.gross,632100);
});
test('no pending actions stays synced, cannot submit or post',()=>{
 const {cloud,client}=setup();
 assert.equal(client.status(cloud).code,'LEGACY_STILL_SUPPORTED_NOT_LEDGER_READY');
 assert.equal(client.status(cloud).canPost,false);
 assert.throws(()=>client.propose(cloud),/UPGRADE_REQUIRED/);
});
test('offline daily work is written to both fake local layers and journal',()=>{
 const {client}=setup();
 assert.equal(client.queue('daily',{id:'SYNTH-DAILY-A'}),'LOCAL_PENDING_UNSYNCED');
 const x=client.getState();
 assert.deepEqual(x.primary,x.emergency);
 assert.equal(x.primary.daily.length,1);
 assert.equal(x.pending.length,1);
 assert.equal(x.journal.phase,'COMMIT_VERIFIED');
});
test('offline bills receipts payroll and bank drafts all retained independently',()=>{
 const {client}=setup();
 for(const m of MODULES.filter(m=>m!=='settings'))
   client.queue(m,{id:'SYNTH-'+m});
 client.queue('settings',{testSetting:1});
 const x=client.getState();
 assert.equal(x.pending.length,13);
 assert.equal(x.primary.payroll.length,1);
 assert.equal(x.primary.bankTransactions.length,1);
 assert.equal(x.primary.settings.testSetting,1);
 assert.equal(x.primary.original.gross,632100);
});
test('backup export contains every unsynced draft with integrity receipt',()=>{
 const {client}=setup();
 client.queue('billings',{id:'SYNTH-B1',amount:14000});
 const receipt=client.backup();
 assert.equal(receipt.digest,hash(receipt.bundle));
 assert.equal(receipt.bundle.pending[0].collection,'billings');
 assert.equal(receipt.bundle.primary.billings[0].amount,14000);
});
test('local upgrade without backup is refused',()=>{
 const {client}=setup();
 assert.throws(()=>client.upgrade(null),/BACKUP_CORRUPTED/);
 assert.equal(client.getState().generation,1);
});
test('tampered offline backup is rejected without losing pending data',()=>{
 const {client}=setup();
 client.queue('receipts',{id:'SYNTH-RECEIPT'});
 const copy=client.backup();
 copy.bundle.primary.receipts[0].id='REAL';
 assert.throws(()=>client.upgrade(copy),/BACKUP_CORRUPTED/);
 assert.equal(client.getState().primary.receipts[0].id,'SYNTH-RECEIPT');
});
test('backup created before new offline edit cannot authorize switch',()=>{
 const {client}=setup();
 const older=client.backup();
 client.queue('commissions',{id:'SYNTH-COMM'});
 assert.throws(()=>client.upgrade(older),/BACKUP_NOT_CURRENT/);
});
test('another device backup cannot authorize upgrade',()=>{
 const {client,cloud}=setup();
 const other=makeClient('SYNTH-Q-PHONE',cloud);
 assert.throws(()=>client.upgrade(other.backup()),/BACKUP_OWNER_MISMATCH/);
});
test('upgrade preserves unsynced data and does not write fake cloud',()=>{
 const {client,cloud}=setup();
 client.queue('payroll',{id:'SYNTH-SALARY'});
 const before=JSON.stringify(cloud);
 assert.equal(client.upgrade(client.backup()),'UPGRADE_LOCAL_ONLY_NO_UPLOAD');
 assert.equal(client.getState().generation,2);
 assert.equal(client.getState().pending.length,1);
 assert.equal(JSON.stringify(cloud),before);
});
test('matching two remote versions permits proposal but never financial posting',()=>{
 const {client,cloud}=setup();
 client.queue('billings',{id:'SYNTH-BILL'});
 client.upgrade(client.backup());
 const p=client.propose(cloud);
 assert.equal(p.expectedSync,2);
 assert.equal(p.expectedLedger,0);
 assert.equal(p.pendingCount,1);
 assert.equal(p.snapshot.billings[0].id,'SYNTH-BILL');
 assert.equal(p.canPost,false);
});
test('cloud now has newer sync version: preserve local draft, block overwrite',()=>{
 const {client,cloud}=setup();
 client.queue('materials',{id:'SYNTH-MAT'});
 client.upgrade(client.backup());
 const next={...cloud,sync:cloud.sync+1};
 assert.equal(client.status(next).code,'CONFLICT_EXPORT_PENDING');
 assert.throws(()=>client.propose(next),/UPLOAD_BLOCKED_CONFLICT/);
 assert.equal(client.getState().pending.length,1);
});
test('cloud now has newer ledger version: preserve offline draft and block upload',()=>{
 const {client,cloud}=setup();
 client.queue('invoices',{id:'SYNTH-INVOICE'});
 client.upgrade(client.backup());
 const latest={...cloud,ledger:1,phase:'guarded'};
 assert.equal(client.status(latest).code,'CONFLICT_EXPORT_PENDING');
 assert.throws(()=>client.propose(latest),/UPLOAD_BLOCKED_CONFLICT/);
 assert.equal(client.getState().primary.invoices.length,1);
});
test('stale legacy device on guarded mode exports drafts, cannot upload',()=>{
 const {client,cloud}=setup();
 client.queue('daily',{id:'SYNTH-D'});
 const guarded={...cloud,phase:'guarded',sync:3};
 assert.equal(client.status(guarded).code,'UPGRADE_REQUIRED_BACKUP_LOCAL');
 assert.equal(client.status(guarded).canUpload,false);
 assert.equal(client.backup().bundle.pending.length,1);
});
test('disconnect is network unavailable, local journal is unchanged',()=>{
 const {client}=setup();
 client.queue('daily',{id:'SYNTH-D'});
 const before=JSON.stringify(client.getState());
 assert.equal(client.status(null).code,'NETWORK_UNAVAILABLE');
 assert.equal(JSON.stringify(client.getState()),before);
});
test('server response lost is NOT confirmed, pending remains until valid receipt',()=>{
 const {client,cloud}=setup();
 client.queue('receivables',{id:'SYNTH-AR'});
 client.upgrade(client.backup());
 client.propose(cloud);
 assert.throws(()=>client.confirm({status:'APPLIED',sync:3,ledger:0,
   fingerprint:'wrong'}),/UNVERIFIED_REMOTE_COMMIT/);
 assert.equal(client.getState().pending.length,1);
});
test('verified server fingerprint and incremented version clear pending once',()=>{
 const {client,cloud}=setup();
 client.queue('payables',{id:'SYNTH-PAYABLE'});
 client.upgrade(client.backup());
 const p=client.propose(cloud);
 assert.equal(client.confirm({status:'APPLIED',sync:3,ledger:0,
   fingerprint:p.fingerprint}),'VERIFIED_SYNCED');
 assert.equal(client.getState().pending.length,0);
 assert.equal(client.getState().baseline.sync,3);
 assert.equal(client.getState().dirty,false);
});
test('ack with wrong or stale ledger version rejected',()=>{
 const {client,cloud}=setup();
 client.queue('bankTransactions',{id:'SYNTH-BANK'});
 client.upgrade(client.backup());
 const p=client.propose(cloud);
 assert.throws(()=>client.confirm({status:'APPLIED',sync:3,ledger:1,
   fingerprint:p.fingerprint}),/UNVERIFIED_REMOTE_COMMIT/);
});
test('corrupted Emergency mirror blocks staging and backup',()=>{
 const {client}=setup();
 client.queue('daily',{id:'SYNTH-D'});
 client.failMirror();
 assert.equal(client.status(remote()).code,'LOCAL_MIRROR_DIVERGED');
 assert.throws(()=>client.backup(),/LOCAL_MIRROR_DIVERGED/);
});
test('principal change blocks backup, upload and upgrade',()=>{
 const {client,cloud}=setup();
 client.queue('daily',{id:'SYNTH-D'});
 const a=client.backup();
 client.changeUser();
 assert.throws(()=>client.backup(),/AUTH_CHANGED/);
 assert.throws(()=>client.upgrade(a),/AUTH_CHANGED/);
 assert.throws(()=>client.propose(cloud),/AUTH_CHANGED/);
});
test('changing original financial projection is never a client API feature',()=>{
 const {client}=setup();
 assert.throws(()=>client.queue('ledgerProjection',{id:'SYNTH-EV'}),/UNKNOWN_MODULE/);
 assert.throws(()=>client.queue('original',{id:'SYNTH-EV'}),/UNKNOWN_MODULE/);
 assert.equal(client.getState().primary.ledgerProjection.gross,632100);
});
test('isolated rescue module has no real app IO or server API access',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'offline_upgrade_rescue.cjs'),'utf8');
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.ok(!index.includes('p40-16q'));
 for(const s of ['fetch(','indexedDB.','localStorage.','supabase.',
   'XMLHttpRequest','writeFileSync(','axios.','/rest/v1/'])
   assert.ok(!src.includes(s),s);
});
