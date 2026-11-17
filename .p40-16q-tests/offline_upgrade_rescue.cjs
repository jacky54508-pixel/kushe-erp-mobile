/* P40-16Q: PURE in-memory synthetic offline-upgrade rescue protocol.
 * No FS, browser storage, web requests, existing ERP app, or financial posting.
 * A SHA-256 digest detects accidental corruption; NOT trustworthy provenance.
 */
'use strict';
const crypto=require('node:crypto');
const clone=v=>JSON.parse(JSON.stringify(v));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const assert=(test,code)=>{if(!test)throw Error(code)};
const MODULES=Object.freeze(['daily','projects','billings','receivables','invoices',
 'receipts','retentionReceipts','materials','payables','payroll','commissions',
 'bankTransactions','settings']);
function makeClient(device='SYNTH-Q-PC',remote){
 assert(device.startsWith('SYNTH-'),'SYNTH_DEVICE_ONLY');
 assert(remote&&Number.isSafeInteger(remote.sync)&&Number.isSafeInteger(remote.ledger)&&
  remote.sync>=1&&remote.ledger>=0,'BAD_REMOTE_VERSION');
 const context={device,user:'SYNTH-Q-OWNER',generation:1,
   baseline:{sync:remote.sync,ledger:remote.ledger,fingerprint:hash(remote.snapshot)},
   primary:clone(remote.snapshot),emergency:clone(remote.snapshot),
   journal:{phase:'COMMIT_VERIFIED',rev:1},dirty:false,
   pending:[],upgraded:false,backups:[],authOk:true};
 function verify(){
   assert(context.authOk,'AUTH_CHANGED');
   assert(context.primary&&context.emergency&&
       hash(context.primary)===hash(context.emergency),'LOCAL_MIRROR_DIVERGED');
   assert(context.journal.phase==='COMMIT_VERIFIED','INCOMPLETE_JOURNAL');
   assert(context.primary.original&&context.primary.ledgerProjection,'INVALID_ORIGINAL');
   assert(context.primary.original.doc==='SYNTH-Q-BILL','REAL_DATA_NOT_ALLOWED');
   return true;
 }
 function queue(collection,object){
   verify();
   assert(MODULES.includes(collection),'UNKNOWN_MODULE');
   if(collection==='settings') {
     assert(object&&object.testSetting!==undefined,'BAD_SETTING');
     context.primary.settings={...context.primary.settings,...clone(object)};
   } else {
     assert(object?.id?.startsWith('SYNTH-'),'SYNTH_ITEM_REQUIRED');
     context.primary[collection].push(clone(object));
   }
   context.emergency=clone(context.primary);
   context.journal={phase:'COMMIT_VERIFIED',rev:context.journal.rev+1};
   context.pending.push({collection,payload:clone(object),ordinal:context.pending.length+1});
   context.dirty=true;
   return 'LOCAL_PENDING_UNSYNCED';
 }
 function backup(){
   verify();
   const bundle={schema:'P40Q_OFFLINE_RESCUE_V1',
     device:context.device,user:context.user,generation:context.generation,
     baseline:clone(context.baseline),primary:clone(context.primary),
     pending:clone(context.pending),journal:clone(context.journal),
     createdAt:10000};
   const receipt={bundle:clone(bundle),digest:hash(bundle)};
   context.backups.push(receipt);
   return clone(receipt);
 }
 function upgrade(backupReceipt){
   verify();
   assert(backupReceipt?.digest&&
     backupReceipt.digest===hash(backupReceipt.bundle),'BACKUP_CORRUPTED');
   assert(backupReceipt.bundle.user===context.user&&
     backupReceipt.bundle.device===context.device,'BACKUP_OWNER_MISMATCH');
   assert(backupReceipt.bundle.generation===1,'BACKUP_ALREADY_MIGRATED');
   assert(hash(backupReceipt.bundle.primary)===hash(context.primary)&&
     hash(backupReceipt.bundle.pending)===hash(context.pending),'BACKUP_NOT_CURRENT');
   context.generation=2;context.upgraded=true;
   return 'UPGRADE_LOCAL_ONLY_NO_UPLOAD';
 }
 function status(remote){
   try{verify()}catch(e){return {code:e.message,canUpload:false,canPost:false}}
   if(!remote||!Number.isSafeInteger(remote.sync)||!Number.isSafeInteger(remote.ledger))
     return {code:'NETWORK_UNAVAILABLE',canUpload:false,canPost:false};
   if(context.generation===1&&remote.phase==='guarded')
     return {code:'UPGRADE_REQUIRED_BACKUP_LOCAL',canUpload:false,canPost:false};
   if(!context.upgraded&&remote.phase==='shadow')
     return {code:'LEGACY_STILL_SUPPORTED_NOT_LEDGER_READY',canUpload:!context.dirty,
      canPost:false};
   const eq=context.baseline.sync===remote.sync&&
       context.baseline.ledger===remote.ledger&&
       context.baseline.fingerprint===hash(remote.snapshot);
   if(!eq)return {code:context.dirty?'CONFLICT_EXPORT_PENDING':'REMOTE_NEWER_BACKUP_REQUIRED',
     canUpload:false,canPost:false};
   if(!context.dirty)return {code:'SYNCED',canUpload:false,canPost:false};
   if(remote.ledger>0&&context.pending.some(p=>MODULES.includes(p.collection)))
     return {code:'ACCOUNTING_RULES_NOT_APPROVED',canUpload:false,canPost:false};
   return {code:'CURRENT_BASELINE_SAFE_TO_PROPOSE',canUpload:true,canPost:false};
 }
 function propose(remote){
   verify();
   assert(context.generation===2,'UPGRADE_REQUIRED_BACKUP_LOCAL');
   const value=status(remote);
   assert(value.canUpload,'UPLOAD_BLOCKED_'+value.code);
   return {schema:'P40Q_PROPOSE_ONLY',device:context.device,
      expectedSync:context.baseline.sync,
      expectedLedger:context.baseline.ledger,
      snapshot:clone(context.primary),fingerprint:hash(context.primary),
      pendingCount:context.pending.length,canPost:false};
 }
 function confirm(ack){
   verify();
   assert(context.dirty&&context.generation===2,'NO_PENDING_MODERN_UPLOAD');
   assert(ack&&ack.status==='APPLIED'&&
     Number.isSafeInteger(ack.sync)&&ack.sync>context.baseline.sync&&
     ack.ledger===context.baseline.ledger&&
     ack.fingerprint===hash(context.primary),'UNVERIFIED_REMOTE_COMMIT');
   context.baseline={sync:ack.sync,ledger:ack.ledger,fingerprint:ack.fingerprint};
   context.pending=[];context.dirty=false;
   return 'VERIFIED_SYNCED';
 }
 function failMirror(){
   context.emergency={corrupt:true};
 }
 function changeUser(){context.authOk=false}
 function getState(){return clone(context)}
 return Object.freeze({verify,queue,backup,upgrade,status,propose,confirm,failMirror,
   changeUser,getState});
}
module.exports=Object.freeze({makeClient,hash,MODULES});
