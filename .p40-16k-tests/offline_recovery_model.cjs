/* P40-16K SYNTHETIC OFFLINE / CROSS-DEVICE RECOVERY STATE MODEL.
 * PURE in-memory lab, never loaded by ERP index.html. Not production backup code.
 * No network, filesystem, indexedDB, localStorage, Supabase or financial POST API.
 * Requires BOTH syncVersion and hypothetical ledgerVersion, which the current
 * production ERP does NOT yet support.
 */
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const checked=x=>{if(!Number.isSafeInteger(x)||x<0)throw Error('INVALID_VERSION');return x;};
const digest=x=>JSON.stringify(x); // synthetic deterministic equality ONLY, NOT cryptographic
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const documentData=(note='base')=>({
 original:{documentId:'SYNTH-BILLING',gross:632100,untaxed:602000,tax:30100,
   retention:0,receivable:632100,sourceIds:['SYNTH-ORIGINAL-A','SYNTH-ORIGINAL-B']},
 ui:{note:String(note)}
});
function validateData(data){
 assert(data&&typeof data==='object'&&!Array.isArray(data),'INVALID_DATA');
 assert(Object.keys(data).sort().join(',')==='original,ui','FORBIDDEN_FINANCIAL_FIELDS');
 const o=data.original;
 assert(o&&o.documentId==='SYNTH-BILLING'&&o.gross===632100&&
   o.untaxed===602000&&o.tax===30100&&o.retention===0&&o.receivable===632100 &&
   Array.isArray(o.sourceIds)&&o.sourceIds.join(',')==='SYNTH-ORIGINAL-A,SYNTH-ORIGINAL-B',
   'ORIGINAL_CHANGED');
 assert(data.ui&&Object.keys(data.ui).join(',')==='note'&&typeof data.ui.note==='string',
   'INVALID_UI_FIELDS');
 return true;
}
function createLab(){
 const cloud={userId:'SYNTH-OWNER-1',syncVersion:1,ledgerVersion:0,
   data:documentData(),history:[]};
 const devices=new Map(),logs=[];
 const snapCloud=()=>clone(cloud);
 function device(id){
   const d=devices.get(id);
   assert(d,'UNKNOWN_DEVICE');
   return d;
 }
 const candidate=(d)=>{
   if(d.frozen)throw Error('RECOVERY_CRITICAL_BLOCK');
   if(d.trust!=='trusted')throw Error('TEMPORARY_DEVICE');
   assert(d.primary&&d.journal?.phase==='COMMIT_VERIFIED','JOURNAL_BLOCK');
   assert(d.token===digest(d.primary)&&d.emergency!==null&&
      digest(d.primary)===digest(d.emergency),'STORE_LAYERS_DIVERGED');
   validateData(d.primary);
   checked(d.baseline.syncVersion);checked(d.baseline.ledgerVersion);
   return d;
 };
 function view(id){return clone(device(id));}
 function state(){return snapCloud();}
 function createDevice(id,trust='trusted'){
   assert(!devices.has(id)&&typeof id==='string'&&id.startsWith('SYNTH-'),'INVALID_DEVICE');
   assert(['trusted','temporary'].includes(trust),'INVALID_TRUST');
   const d={id,userId:cloud.userId,trust,online:true,editorDirty:false,
      primary:trust==='trusted'?clone(cloud.data):null,
      emergency:trust==='trusted'?clone(cloud.data):null,
      token:trust==='trusted'?digest(cloud.data):null,
      journal:trust==='trusted'?{phase:'COMMIT_VERIFIED',operationId:'SYNTH-INIT'}:null,
      baseline:{syncVersion:cloud.syncVersion,ledgerVersion:cloud.ledgerVersion,
        fingerprint:digest(cloud.data)},dirty:false,
      backupMarker:null,backupCopies:[],frozen:false,
      ephemeral:trust==='temporary'?clone(cloud.data):null};
   devices.set(id,d);return view(id);
 }
 function setOnline(id,online){device(id).online=Boolean(online)}
 function setEditorDirty(id,dirty){device(id).editorDirty=Boolean(dirty)}
 function switchPrincipal(id,userId){device(id).userId=userId}
 function edit(id,note){
   const d=candidate(device(id));
   assert(typeof note==='string'&&note.length<=300,'INVALID_NOTE');
   const newData=clone(d.primary);newData.ui.note=note;validateData(newData);
   d.primary=newData;d.emergency=clone(newData);d.token=digest(newData);
   d.journal={phase:'COMMIT_VERIFIED',operationId:'SYNTH-LOCAL-EDIT'};
   d.dirty=true;d.backupMarker=null;
   return 'LOCAL_COMMITTED';
 }
 function cloudEdit(id,note){
   const d=device(id);assert(d.trust==='temporary','NOT_TEMPORARY');
   assert(d.online&&d.userId===cloud.userId,'AUTH_OR_NETWORK_BLOCK');
   assert(d.baseline.syncVersion===cloud.syncVersion&&
      d.baseline.ledgerVersion===cloud.ledgerVersion,'CAS_CONFLICT');
   const next=clone(d.ephemeral);next.ui.note=String(note);validateData(next);
   cloud.data=next;cloud.syncVersion++;
   d.ephemeral=clone(next);
   d.baseline={syncVersion:cloud.syncVersion,ledgerVersion:cloud.ledgerVersion,
      fingerprint:digest(cloud.data)};
   assert(d.primary===null&&d.emergency===null,'TEMPORARY_PERSISTENT_LEAK');
   return 'TEMPORARY_CLOUD_ONLY';
 }
 function simulatedLedgerEvent(key='SYNTH-LEDGER'){
   assert(key.startsWith('SYNTH-'),'INVALID_KEY');
   if(cloud.history.some(e=>e.key===key))return 'DUPLICATE';
   cloud.ledgerVersion++;
   cloud.history.push({key,ledgerVersion:cloud.ledgerVersion,kind:'SIMULATED_ONLY'});
   return 'SIMULATED_LEDGER_CHANGED';
 }
 function resume(id){
   const d=device(id);
   if(!d.online)return 'NETWORK_ERROR';
   if(d.userId!==cloud.userId)return 'AUTH_CHANGED';
   if(d.editorDirty)return 'EDITOR_DIRTY';
   if(d.trust==='temporary'){
     if(d.baseline.syncVersion!==cloud.syncVersion||
        d.baseline.ledgerVersion!==cloud.ledgerVersion)return 'TEMPORARY_REMOTE_CHANGED';
     return 'TEMPORARY_CLOUD_ONLY';
   }
   try{candidate(d)}catch(e){return e.message}
   const localMatch=d.baseline.fingerprint===digest(d.primary);
   const remoteMatch=d.baseline.syncVersion===cloud.syncVersion&&
      d.baseline.ledgerVersion===cloud.ledgerVersion&&
      d.baseline.fingerprint===digest(cloud.data);
   if(localMatch&&remoteMatch)return 'SYNCED';
   if(d.dirty&&remoteMatch)return 'LOCAL_NEWER';
   if(d.dirty)return 'CONFLICT_NO_AUTO_OVERWRITE';
   return 'REMOTE_NEWER_BACKUP_REQUIRED';
 }
 function upload(id,options={}){
   const d=candidate(device(id));
   assert(d.online,'NETWORK_ERROR');assert(d.userId===cloud.userId,'AUTH_CHANGED');
   assert(!d.editorDirty,'EDITOR_DIRTY');assert(d.dirty,'NOT_DIRTY');
   assert(d.baseline.syncVersion===cloud.syncVersion&&
     d.baseline.ledgerVersion===cloud.ledgerVersion&&
     d.baseline.fingerprint===digest(cloud.data),'CAS_CONFLICT');
   if(options.beforeCas)options.beforeCas();
   assert(d.baseline.syncVersion===cloud.syncVersion&&
     d.baseline.ledgerVersion===cloud.ledgerVersion,'CAS_CONFLICT');
   cloud.data=clone(d.primary);cloud.syncVersion++;
   if(options.networkLostAfterWrite)throw Error('VERIFY_REQUIRED_UNKNOWN_COMMIT');
   assert(digest(cloud.data)===digest(d.primary),'UPLOAD_VERIFY_FAILED');
   d.baseline={syncVersion:cloud.syncVersion,ledgerVersion:cloud.ledgerVersion,
     fingerprint:digest(cloud.data)};
   d.dirty=false;
   d.backupMarker=null;
   logs.push({device:id,kind:'verified-synthetic-upload'});
   return 'UPLOAD_VERIFIED';
 }
 function reverifyAmbiguousUpload(id){
   const d=candidate(device(id));assert(d.online,'NETWORK_ERROR');
   assert(d.userId===cloud.userId,'AUTH_CHANGED');
   if(digest(d.primary)!==digest(cloud.data))return 'CONFLICT_NO_AUTO_OVERWRITE';
   if(d.baseline.ledgerVersion!==cloud.ledgerVersion)return 'LEDGER_VERSION_CONFLICT';
   if(cloud.syncVersion<=d.baseline.syncVersion)return 'REMOTE_VERSION_INVALID';
   d.baseline={syncVersion:cloud.syncVersion,ledgerVersion:cloud.ledgerVersion,
       fingerprint:digest(cloud.data)};
   d.dirty=false;return 'UPLOAD_RECOVERED_BY_VERIFICATION';
 }
 function prepareBackup(id,now=10000){
   const d=candidate(device(id));checked(now);
   assert(d.userId===cloud.userId,'AUTH_CHANGED');
   assert(!d.editorDirty,'EDITOR_DIRTY');
   const backup={userId:d.userId,device:id,createdAt:now,
      primary:clone(d.primary),emergency:clone(d.emergency),
      token:d.token,journal:clone(d.journal),
      baseline:clone(d.baseline),fingerprint:digest(d.primary)};
   d.backupCopies.push(backup);
   d.backupMarker={device:id,userId:d.userId,createdAt:now,
     fingerprint:digest(d.primary),cloudSyncVersion:cloud.syncVersion,
     cloudLedgerVersion:cloud.ledgerVersion};
   return clone(d.backupMarker);
 }
 function restore(id,options={}){
   const d=candidate(device(id));const now=options.now??10010;
   assert(d.online,'NETWORK_ERROR');assert(d.userId===cloud.userId,'AUTH_CHANGED');
   assert(!d.editorDirty,'EDITOR_DIRTY');checked(now);
   assert(!d.dirty,'CONFLICT_NO_AUTO_OVERWRITE');
   const mark=d.backupMarker;
   assert(mark&&mark.device===id&&mark.userId===d.userId&&
     mark.fingerprint===digest(d.primary)&&
     now>=mark.createdAt&&now-mark.createdAt<=1800000,
     'BACKUP_REQUIRED');
   assert(mark.cloudSyncVersion===cloud.syncVersion&&
     mark.cloudLedgerVersion===cloud.ledgerVersion,'REMOTE_CHANGED_BEFORE_RESTORE');
   const first=snapCloud();
   if(options.betweenReads)options.betweenReads();
   assert(first.syncVersion===cloud.syncVersion&&
       first.ledgerVersion===cloud.ledgerVersion&&
       digest(first.data)===digest(cloud.data),'RACE_BLOCKED');
   validateData(first.data);
   const before={primary:clone(d.primary),emergency:clone(d.emergency),
     token:d.token,journal:clone(d.journal),baseline:clone(d.baseline)};
   try{
     d.journal={phase:'PREPARING',operationId:'SYNTH-RESTORE-'+id};
     if(options.failAt==='PREPARING')throw Error('INJECTED_PREPARING_FAILURE');
     d.primary=clone(first.data);d.journal.phase='PRIMARY_WRITTEN';
     if(options.failAt==='PRIMARY_WRITTEN')throw Error('INJECTED_PRIMARY_FAILURE');
     d.emergency=clone(first.data);d.journal.phase='EMERGENCY_WRITTEN';
     if(options.failAt==='EMERGENCY_WRITTEN')throw Error('INJECTED_EMERGENCY_FAILURE');
     d.token=digest(first.data);d.journal.phase='TOKENS_WRITTEN';
     if(options.failAt==='TOKENS_WRITTEN')throw Error('INJECTED_TOKEN_FAILURE');
     assert(d.token===digest(d.primary)&&
       digest(d.primary)===digest(d.emergency),'RESTORE_VERIFY_FAILED');
     if(options.beforeFinalize)options.beforeFinalize();
     assert(first.syncVersion===cloud.syncVersion&&
       first.ledgerVersion===cloud.ledgerVersion&&
       digest(first.data)===digest(cloud.data),'RACE_BLOCKED');
     d.journal.phase='COMMIT_VERIFIED';
     d.baseline={syncVersion:first.syncVersion,ledgerVersion:first.ledgerVersion,
       fingerprint:digest(first.data)};
     d.dirty=false;d.backupMarker=null;
     logs.push({device:id,kind:'verified-synthetic-restore'});
     return 'RESTORE_VERIFIED';
   }catch(error){
     if(options.concurrentChange){
       d.frozen=true;
       d.journal={phase:'RECOVERY_BLOCKED',operationId:'SYNTH-CONCURRENT'};
       throw Error('RESTORE_CRITICAL_FAILURE');
     }
     d.primary=before.primary;d.emergency=before.emergency;
     d.token=before.token;d.journal=before.journal;d.baseline=before.baseline;
     throw error;
   }
 }
 function localCorrupt(id,kind){
   const d=device(id);
   if(kind==='emergency')d.emergency={corrupted:true};
   else if(kind==='journal')d.journal={phase:'PRIMARY_WRITTEN',operationId:'SYNTH-ORPHAN'};
   else if(kind==='token')d.token='invalid';
   else if(kind==='primary')d.primary={corrupted:true};
   else throw Error('UNKNOWN_FAULT');
 }
 function preview(id){
   const d=device(id);
   return Object.freeze({device:id,sync:resume(id),
      canPost:false,canSave:false,financialWrites:0,
      localCount:d.primary===null?0:1,
      emergencyCount:d.emergency===null?0:1});
 }
 return Object.freeze({createDevice,setOnline,setEditorDirty,switchPrincipal,
    edit,cloudEdit,simulatedLedgerEvent,resume,upload,reverifyAmbiguousUpload,
    prepareBackup,restore,localCorrupt,view,state,preview,
    getAudit:()=>clone(logs)});
}
module.exports=Object.freeze({createLab,documentData,validateData,version:'P40-16K-simulation-1'});
