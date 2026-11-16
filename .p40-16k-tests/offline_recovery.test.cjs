'use strict';
/* P40-16K all fictional. Tests illustrate required future safety checks,
 * NOT verification of production recovery implementation. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createLab,documentData,validateData}=require('./offline_recovery_model.cjs');
const setup=()=>{const lab=createLab();lab.createDevice('SYNTH-PC');return lab;};

test('initial trusted browser receives same baseline without financial posting',()=>{
 const lab=setup(),v=lab.view('SYNTH-PC');
 assert.equal(lab.resume('SYNTH-PC'),'SYNCED');
 assert.equal(v.baseline.syncVersion,1);
 assert.equal(v.baseline.ledgerVersion,0);
 assert.equal(v.token,JSON.stringify(v.primary));
 assert.equal(lab.preview('SYNTH-PC').canPost,false);
 assert.equal(lab.preview('SYNTH-PC').canSave,false);
});
test('offline note edit keeps independent primary emergency journal and resumes safely',()=>{
 const l=setup();l.setOnline('SYNTH-PC',false);
 assert.equal(l.edit('SYNTH-PC','offline A'),'LOCAL_COMMITTED');
 assert.equal(l.resume('SYNTH-PC'),'NETWORK_ERROR');
 assert.throws(()=>l.upload('SYNTH-PC'),/NETWORK_ERROR/);
 const local=l.view('SYNTH-PC');
 assert.equal(local.primary.ui.note,'offline A');
 assert.deepEqual(local.primary,local.emergency);
 assert.equal(local.journal.phase,'COMMIT_VERIFIED');
 assert.equal(l.state().syncVersion,1);
 l.setOnline('SYNTH-PC',true);
 assert.equal(l.resume('SYNTH-PC'),'LOCAL_NEWER');
 assert.equal(l.upload('SYNTH-PC'),'UPLOAD_VERIFIED');
 assert.equal(l.resume('SYNTH-PC'),'SYNCED');
 assert.equal(l.state().syncVersion,2);
 assert.equal(l.state().data.ui.note,'offline A');
});
test('two devices cannot overwrite each other with old remote version',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PC','desktop change');
 l.edit('SYNTH-PHONE','phone change');
 assert.equal(l.upload('SYNTH-PHONE'),'UPLOAD_VERIFIED');
 assert.equal(l.resume('SYNTH-PC'),'CONFLICT_NO_AUTO_OVERWRITE');
 assert.throws(()=>l.upload('SYNTH-PC'),/CAS_CONFLICT/);
 assert.equal(l.state().data.ui.note,'phone change');
 assert.equal(l.view('SYNTH-PC').primary.ui.note,'desktop change');
});
test('offline device remains conflict blocked after remote ledger revision',()=>{
 const l=setup();l.setOnline('SYNTH-PC',false);l.edit('SYNTH-PC','offline');
 l.simulatedLedgerEvent('SYNTH-DISCOUNT');
 l.setOnline('SYNTH-PC',true);
 assert.equal(l.resume('SYNTH-PC'),'CONFLICT_NO_AUTO_OVERWRITE');
 assert.throws(()=>l.upload('SYNTH-PC'),/CAS_CONFLICT/);
 assert.equal(l.state().ledgerVersion,1);
});
test('simulated ledger version repeated operation is idempotent',()=>{
 const l=setup();
 assert.equal(l.simulatedLedgerEvent('SYNTH-ONE'),'SIMULATED_LEDGER_CHANGED');
 assert.equal(l.simulatedLedgerEvent('SYNTH-ONE'),'DUPLICATE');
 assert.equal(l.state().ledgerVersion,1);
 assert.equal(l.preview('SYNTH-PC').canPost,false);
});
test('upload rechecks version after another writer interleaves before CAS',()=>{
 const l=setup();l.edit('SYNTH-PC','new');
 assert.throws(()=>l.upload('SYNTH-PC',{
   beforeCas:()=>l.simulatedLedgerEvent('SYNTH-EXTERNAL')
 }),/CAS_CONFLICT/);
 assert.equal(l.state().syncVersion,1);
 assert.equal(l.state().ledgerVersion,1);
 assert.equal(l.view('SYNTH-PC').dirty,true);
});
test('lost network after server applied requires fresh read confirmation',()=>{
 const l=setup();l.edit('SYNTH-PC','pending proof');
 assert.throws(()=>l.upload('SYNTH-PC',{networkLostAfterWrite:true}),
   /VERIFY_REQUIRED_UNKNOWN_COMMIT/);
 assert.equal(l.view('SYNTH-PC').dirty,true);
 assert.equal(l.state().syncVersion,2);
 assert.equal(l.reverifyAmbiguousUpload('SYNTH-PC'),'UPLOAD_RECOVERED_BY_VERIFICATION');
 assert.equal(l.view('SYNTH-PC').dirty,false);
 assert.equal(l.resume('SYNTH-PC'),'SYNCED');
});
test('ambiguous upload with new remote content must never pretend success',()=>{
 const l=setup();
 l.edit('SYNTH-PC','pending');
 assert.throws(()=>l.upload('SYNTH-PC',{networkLostAfterWrite:true}));
 // A genuinely clean device signs in AFTER the first ambiguous commit. Its
 // newer verified upload must not falsely complete the PC's old operation.
 l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','newer cloud');
 assert.equal(l.upload('SYNTH-PHONE'),'UPLOAD_VERIFIED');
 assert.equal(l.reverifyAmbiguousUpload('SYNTH-PC'),'CONFLICT_NO_AUTO_OVERWRITE');
 assert.equal(l.view('SYNTH-PC').dirty,true);
});
test('read-only recovery requires explicit durable backup before replacing local data',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','phone latest');l.upload('SYNTH-PHONE');
 assert.equal(l.resume('SYNTH-PC'),'REMOTE_NEWER_BACKUP_REQUIRED');
 assert.throws(()=>l.restore('SYNTH-PC'),/BACKUP_REQUIRED/);
 assert.equal(l.view('SYNTH-PC').primary.ui.note,'base');
});
test('backup marker ties to principal, local fingerprint, cloud version and TTL',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','second');l.upload('SYNTH-PHONE');
 const marker=l.prepareBackup('SYNTH-PC',10000);
 assert.equal(marker.userId,'SYNTH-OWNER-1');
 assert.equal(l.view('SYNTH-PC').backupCopies.length,1);
 assert.throws(()=>l.restore('SYNTH-PC',{now:1810010}),/BACKUP_REQUIRED/);
 assert.equal(l.restore('SYNTH-PC',{now:11000}),'RESTORE_VERIFIED');
 assert.equal(l.view('SYNTH-PC').backupMarker,null);
 assert.equal(l.view('SYNTH-PC').primary.ui.note,'second');
});
test('successful remote restore binds IDB emergency token journal and remote baseline',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','verified cloud');l.upload('SYNTH-PHONE');
 l.prepareBackup('SYNTH-PC');
 assert.equal(l.restore('SYNTH-PC'),'RESTORE_VERIFIED');
 const d=l.view('SYNTH-PC');
 assert.equal(d.primary.ui.note,'verified cloud');
 assert.deepEqual(d.primary,d.emergency);
 assert.equal(d.token,JSON.stringify(d.primary));
 assert.equal(d.journal.phase,'COMMIT_VERIFIED');
 assert.equal(d.baseline.syncVersion,2);
 assert.equal(l.resume('SYNTH-PC'),'SYNCED');
 assert.equal(d.backupCopies[0].primary.ui.note,'base');
});
test('different cloud version since backup stops remote restore without local change',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','one');l.upload('SYNTH-PHONE');
 l.prepareBackup('SYNTH-PC');
 l.simulatedLedgerEvent('SYNTH-CLOUD-CHANGED');
 const before=l.view('SYNTH-PC').primary;
 assert.throws(()=>l.restore('SYNTH-PC'),/REMOTE_CHANGED_BEFORE_RESTORE/);
 assert.deepEqual(l.view('SYNTH-PC').primary,before);
});
test('double remote read prevents restore if cloud changes before any local write',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','remote');l.upload('SYNTH-PHONE');l.prepareBackup('SYNTH-PC');
 const before=l.view('SYNTH-PC').primary;
 assert.throws(()=>l.restore('SYNTH-PC',{betweenReads:()=>
   l.simulatedLedgerEvent('SYNTH-RACE')}),/RACE_BLOCKED/);
 assert.deepEqual(l.view('SYNTH-PC').primary,before);
});
test('remote version change after local primary write triggers verified rollback',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','remote');l.upload('SYNTH-PHONE');l.prepareBackup('SYNTH-PC');
 const before=l.view('SYNTH-PC');
 assert.throws(()=>l.restore('SYNTH-PC',{beforeFinalize:()=>
   l.simulatedLedgerEvent('SYNTH-POST-WRITE-RACE')}),/RACE_BLOCKED/);
 const after=l.view('SYNTH-PC');
 assert.deepEqual(after.primary,before.primary);
 assert.deepEqual(after.emergency,before.emergency);
 assert.equal(after.token,before.token);
 assert.deepEqual(after.journal,before.journal);
});
test('injected failures at each staged restore checkpoint rollback all local layers',()=>{
 for(const phase of ['PREPARING','PRIMARY_WRITTEN','EMERGENCY_WRITTEN','TOKENS_WRITTEN']){
   const l=setup();l.createDevice('SYNTH-PHONE');
   l.edit('SYNTH-PHONE','new remote');l.upload('SYNTH-PHONE');
   l.prepareBackup('SYNTH-PC');
   const before=l.view('SYNTH-PC');
   assert.throws(()=>l.restore('SYNTH-PC',{failAt:phase}),/INJECTED/);
   const after=l.view('SYNTH-PC');
   for(const field of ['primary','emergency','token','journal','baseline'])
     assert.deepEqual(after[field],before[field],phase+' '+field);
   assert.equal(after.frozen,false);
   assert.equal(l.state().data.ui.note,'new remote');
 }
});
test('if rollback ownership is lost, fail critical and permanently block local writes',()=>{
 const l=setup();l.createDevice('SYNTH-PHONE');
 l.edit('SYNTH-PHONE','new remote');l.upload('SYNTH-PHONE');l.prepareBackup('SYNTH-PC');
 assert.throws(()=>l.restore('SYNTH-PC',{
    failAt:'EMERGENCY_WRITTEN',concurrentChange:true
 }),/RESTORE_CRITICAL_FAILURE/);
 assert.equal(l.view('SYNTH-PC').frozen,true);
 assert.equal(l.resume('SYNTH-PC'),'RECOVERY_CRITICAL_BLOCK');
 assert.throws(()=>l.edit('SYNTH-PC','unsafe'),/RECOVERY_CRITICAL_BLOCK/);
});
test('local IDB and emergency mismatch blocks upload and cloud restore',()=>{
 for(const layer of ['primary','emergency','token','journal']){
   const l=setup();l.localCorrupt('SYNTH-PC',layer);
   assert.notEqual(l.resume('SYNTH-PC'),'SYNCED');
   assert.throws(()=>l.prepareBackup('SYNTH-PC'));
   assert.throws(()=>l.edit('SYNTH-PC','unsafe'));
 }
});
test('dirty editor prevents inspecting/publishing/restore',()=>{
 const l=setup();l.setEditorDirty('SYNTH-PC',true);
 assert.equal(l.resume('SYNTH-PC'),'EDITOR_DIRTY');
 assert.throws(()=>l.prepareBackup('SYNTH-PC'),/EDITOR_DIRTY/);
 l.setEditorDirty('SYNTH-PC',false);l.edit('SYNTH-PC','draft');
 l.setEditorDirty('SYNTH-PC',true);
 assert.throws(()=>l.upload('SYNTH-PC'),/EDITOR_DIRTY/);
});
test('auth change blocks reconnect, upload and restore',()=>{
 const l=setup();l.edit('SYNTH-PC','draft');
 l.switchPrincipal('SYNTH-PC','SYNTH-OTHER-USER');
 assert.equal(l.resume('SYNTH-PC'),'AUTH_CHANGED');
 assert.throws(()=>l.upload('SYNTH-PC'),/AUTH_CHANGED/);
 assert.throws(()=>l.prepareBackup('SYNTH-PC'),/AUTH_CHANGED/);
});
test('dirty local changes never restored away even with preexisting cloud backup',()=>{
 const l=setup();
 l.prepareBackup('SYNTH-PC');
 l.edit('SYNTH-PC','important unsynced data');
 assert.throws(()=>l.restore('SYNTH-PC'),/CONFLICT_NO_AUTO_OVERWRITE/);
 assert.equal(l.view('SYNTH-PC').primary.ui.note,'important unsynced data');
});
test('temporary device changes only cloud, never IDB/emergency',()=>{
 const l=setup();l.createDevice('SYNTH-TEMP','temporary');
 assert.equal(l.resume('SYNTH-TEMP'),'TEMPORARY_CLOUD_ONLY');
 assert.equal(l.cloudEdit('SYNTH-TEMP','cloud direct'),'TEMPORARY_CLOUD_ONLY');
 assert.equal(l.state().data.ui.note,'cloud direct');
 assert.equal(l.view('SYNTH-TEMP').primary,null);
 assert.equal(l.view('SYNTH-TEMP').emergency,null);
 assert.equal(l.resume('SYNTH-PC'),'REMOTE_NEWER_BACKUP_REQUIRED');
 assert.throws(()=>l.edit('SYNTH-TEMP','not allowed'),/TEMPORARY_DEVICE/);
});
test('temporary device cannot apply stale ephemeral baseline',()=>{
 const l=setup();l.createDevice('SYNTH-TEMP','temporary');
 l.simulatedLedgerEvent('SYNTH-LEDGER-OTHER');
 assert.equal(l.resume('SYNTH-TEMP'),'TEMPORARY_REMOTE_CHANGED');
 assert.throws(()=>l.cloudEdit('SYNTH-TEMP','stale'),/CAS_CONFLICT/);
});
test('all hypothetical original financial fields unchanged and extra keys rejected',()=>{
 const d=documentData('test');
 assert.equal(validateData(d),true);
 for(const bad of [
  {...d,original:{...d.original,gross:600000}},
  {...d,effectiveReceivable:600000},
  {...d,ui:{...d.ui,invoiceNo:'FAKE'}},
  {...d,original:{...d.original,sourceIds:['SYNTH-X']}}
 ])assert.throws(()=>validateData(bad));
});
test('isolated model is absent from production index and has no real IO APIs',()=>{
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'offline_recovery_model.cjs'),'utf8');
 assert.ok(!index.includes('p40-16k'));
 for(const term of ['fetch(','XMLHttpRequest','indexedDB.','localStorage.','supabase.',
  '.saveBilling(','.persist(','.commit(','.updateReceivable(',
  '.saveInvoice(','.savePayroll('])assert.equal(js.includes(term),false,term);
});
