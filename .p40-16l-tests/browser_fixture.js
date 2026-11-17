/* P40-16L. ONLY loaded by the local test page in GitHub CI.
 * Real Chrome IndexedDB, localStorage, reloads, fake HTTP CAS. Never real ERP.
 * Browser code can verify integrity but CANNOT provide tamper-proof banking auth.
 */
(() => {
'use strict';
const DB='P40L_SYNTH_BROWSER_20261116', STORE='erp', STATE='main', JOURNAL='journal';
const EMERGENCY='P40L_SYNTH_EMERGENCY',TOKEN='P40L_SYNTH_TOKEN',MARKER='P40L_SYNTH_MARKER';
const PERSON='SYNTHETIC-OWNER-1';
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=(code)=>{throw new Error(code)};
const assert=(ok,code)=>{if(!ok)fail(code)};
let dbP, editorDirty=false, tempData=null, temporary=false;
const enc=new TextEncoder();
async function sha(value) {
 const bytes=await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify(value)));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function openDb() {
 if(dbP)return dbP;
 dbP=new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))
       r.result.createObjectStore(STORE)};
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>reject(r.error);
 });
 return dbP;
}
async function dbRead(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readonly'),s=t.objectStore(STORE);
  const r1=s.get(STATE),r2=s.get(JOURNAL);
  let state,journal;
  r1.onsuccess=()=>{state=r1.result};r2.onsuccess=()=>{journal=r2.result};
  t.oncomplete=()=>resolve({state,journal});t.onabort=()=>reject(t.error);
  t.onerror=()=>{};
 });
}
async function dbWrite(state,journal) {
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);
  s.put(clone(state),STATE);s.put(clone(journal),JOURNAL);
  t.oncomplete=()=>resolve(true);
  t.onabort=()=>reject(t.error||new Error('IDB_ABORT'));
  t.onerror=()=>{};
 });
}
async function api(url,body) {
 const options=body===undefined?{cache:'no-store'}:
   {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 let response;
 try {response=await fetch(url,options)} catch {fail('NETWORK_ERROR_OR_UNKNOWN_COMMIT')}
 if(!response.ok)fail('REMOTE_HTTP_'+response.status);
 return response.json();
}
async function remote(){return api('/api/state')}
function validateData(data) {
 assert(data&&typeof data==='object'&&!Array.isArray(data),'INVALID_DATA');
 assert(Object.keys(data).sort().join(',')==='original,ui','FORBIDDEN_FINANCIAL_FIELDS');
 const o=data.original;
 assert(o&&o.documentId==='SYNTHETIC-BILLING'&&o.untaxed===602000&&
   o.tax===30100&&o.gross===632100&&o.retention===0&&o.receivable===632100,
   'FINANCIAL_ORIGINAL_CHANGED');
 assert(Array.isArray(o.sourceIds)&&o.sourceIds.join(',')==='SYNTHETIC-A,SYNTHETIC-B',
    'SOURCE_IDS_CHANGED');
 assert(data.ui&&Object.keys(data.ui).join(',')==='note'&&typeof data.ui.note==='string',
    'UI_INVALID');
 return true;
}
async function commit(newState,failAt=''){
 assert(!temporary,'TEMPORARY_NO_LOCAL_PERSIST');
 validateData(newState.data);
 const id='SYNTH-TXN-'+Math.random().toString(36).slice(2);
 const journal={phase:'PRIMARY_WRITTEN',id};
 await dbWrite(newState,journal);
 if(failAt==='AFTER_IDB')fail('INJECT_AFTER_IDB');
 localStorage.setItem(EMERGENCY,JSON.stringify(newState));
 if(failAt==='AFTER_EMERGENCY')fail('INJECT_AFTER_EMERGENCY');
 localStorage.setItem(TOKEN,await sha(newState));
 if(failAt==='AFTER_TOKEN')fail('INJECT_AFTER_TOKEN');
 await dbWrite(newState,{phase:'COMMIT_VERIFIED',id});
 return 'COMMIT_VERIFIED';
}
async function verified(){
 assert(!temporary,'TEMPORARY_NO_LOCAL_STATE');
 const {state,journal}=await dbRead();
 assert(state&&journal,'LOCAL_MISSING');
 assert(journal.phase==='COMMIT_VERIFIED','STORE_JOURNAL_PENDING');
 validateData(state.data);
 assert(state.userId===PERSON,'PRINCIPAL_CHANGED');
 const mirror=localStorage.getItem(EMERGENCY),token=localStorage.getItem(TOKEN);
 assert(mirror!==null&&token!==null,'STORE_LAYERS_MISSING');
 assert(mirror===JSON.stringify(state)&&token===await sha(state),'STORE_LAYERS_DIVERGED');
 assert(typeof state.base?.syncVersion==='number'&&Number.isSafeInteger(state.base.syncVersion)&&
        Number.isSafeInteger(state.base?.ledgerVersion)&&
        typeof state.base?.fingerprint==='string','BASELINE_INVALID');
 return clone(state);
}
function fromRemote(r){
 validateData(r.data);
 return {userId:PERSON,data:clone(r.data),
   base:{syncVersion:r.syncVersion,ledgerVersion:r.ledgerVersion,
         fingerprint:r.fingerprint},dirty:false};
}
async function init(opts={}){
 temporary=opts.temporary===true;
 if(temporary){
   const r=await remote();tempData=fromRemote(r);
   return {status:'TEMPORARY_CLOUD_ONLY',primary:false,emergency:false};
 }
 const old=await dbRead();
 if(!old.state&&!old.journal){
   const r=await remote();await commit(fromRemote(r));
 }
 const state=await verified();
 return {status:'READY',syncVersion:state.base.syncVersion,
         ledgerVersion:state.base.ledgerVersion};
}
async function localEdit(note,opts={}){
 assert(!temporary,'TEMPORARY_NO_LOCAL_PERSIST');
 assert(!editorDirty,'EDITOR_DIRTY');
 const state=await verified();
 assert(typeof note==='string'&&note.length<200,'NOTE_INVALID');
 state.data.ui.note=note;state.dirty=true;
 await commit(state,opts.failAt||'');
 return 'LOCAL_COMMITTED';
}
async function status(){
 try{
  if(temporary)return {status:'TEMPORARY_CLOUD_ONLY',primary:false};
  const local=await verified();
  if(editorDirty)return {status:'EDITOR_DIRTY'};
  const r=await remote();
  if(local.base.syncVersion===r.syncVersion&&
     local.base.ledgerVersion===r.ledgerVersion&&
     local.base.fingerprint===r.fingerprint)
    return {status:local.dirty?'LOCAL_NEWER':'SYNCED'};
  return {status:local.dirty?'CONFLICT_NO_AUTO_OVERWRITE':'REMOTE_NEWER_BACKUP_REQUIRED'};
 }catch(e){return {status:String(e.message)}}
}
async function upload(){
 assert(!temporary,'TEMPORARY_NO_LOCAL_PERSIST');
 assert(!editorDirty,'EDITOR_DIRTY');
 const state=await verified();
 assert(state.dirty,'NOT_DIRTY');
 const r=await remote();
 assert(state.base.syncVersion===r.syncVersion&&
   state.base.ledgerVersion===r.ledgerVersion&&state.base.fingerprint===r.fingerprint,
   'CAS_CONFLICT');
 const result=await api('/api/cas',{
   expectedSync:state.base.syncVersion,expectedLedger:state.base.ledgerVersion,
   data:state.data,operation:'SYNTHETIC-UI-ONLY'
 });
 if(result.status!=='APPLIED')fail('CAS_CONFLICT');
 const after=await remote();
 assert(after.syncVersion===result.syncVersion&&
   after.ledgerVersion===result.ledgerVersion&&
   after.fingerprint===await sha(state.data),'CLOUD_VERIFY_FAILED');
 state.base={syncVersion:after.syncVersion,ledgerVersion:after.ledgerVersion,
    fingerprint:after.fingerprint};state.dirty=false;
 await commit(state);return 'UPLOAD_VERIFIED';
}
async function resolveUnknownUpload(){
 const state=await verified();assert(state.dirty,'NOT_PENDING');
 const r=await remote();
 if(r.fingerprint!==await sha(state.data)||r.ledgerVersion!==state.base.ledgerVersion)
   return 'CONFLICT_NO_AUTO_OVERWRITE';
 if(r.syncVersion<=state.base.syncVersion)return 'REMOTE_VERSION_NOT_INCREMENTED';
 state.base={syncVersion:r.syncVersion,ledgerVersion:r.ledgerVersion,
             fingerprint:r.fingerprint};state.dirty=false;
 await commit(state);
 return 'VERIFIED_AFTER_UNKNOWN_COMMIT';
}
async function exportBackup(){
 const state=await verified();assert(!editorDirty,'EDITOR_DIRTY');
 const snapshot={schema:'P40L_BACKUP_V1',userId:PERSON,
   state,exportedAt:new Date().toISOString(),
   fingerprint:await sha(state)};
 const raw=JSON.stringify(snapshot);
 const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;
 link.download='P40L_SYNTHETIC_backup.json';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),800);
 return snapshot.fingerprint;
}
async function armRestore(backupJson){
 const current=await verified();assert(!editorDirty,'EDITOR_DIRTY');
 const file=typeof backupJson==='string'?JSON.parse(backupJson):backupJson;
 assert(file?.schema==='P40L_BACKUP_V1'&&file.userId===PERSON,'INVALID_BACKUP');
 assert(file.fingerprint===await sha(file.state),'BACKUP_CORRUPT');
 assert(file.fingerprint===await sha(current),'BACKUP_NOT_CURRENT');
 const r=await remote();
 const marker={userId:PERSON,createdAt:Date.now(),fingerprint:file.fingerprint,
   syncVersion:r.syncVersion,ledgerVersion:r.ledgerVersion};
 localStorage.setItem(MARKER,JSON.stringify(marker));
 return 'BACKUP_CONFIRMED';
}
async function restoreRemote(opts={}){
 const old=await verified();assert(!editorDirty,'EDITOR_DIRTY');
 assert(!old.dirty,'UNSYNCED_LOCAL_BLOCK');
 let m;try{m=JSON.parse(localStorage.getItem(MARKER)||'null')}catch{}
 assert(m?.userId===PERSON&&m.fingerprint===await sha(old)&&
        Date.now()-m.createdAt<1800000&&Date.now()>=m.createdAt,'BACKUP_REQUIRED');
 let r=await remote();
 assert(r.syncVersion===m.syncVersion&&r.ledgerVersion===m.ledgerVersion,'REMOTE_CHANGED');
 const second=await remote();
 assert(r.syncVersion===second.syncVersion&&r.ledgerVersion===second.ledgerVersion&&
        r.fingerprint===second.fingerprint,'RESTORE_RACE_BLOCK');
 validateData(second.data);
 await commit(fromRemote(second),opts.failAt||'');
 localStorage.removeItem(MARKER);
 return 'RESTORE_VERIFIED';
}
async function recoverExplicitBackup(backupJson){
 const file=typeof backupJson==='string'?JSON.parse(backupJson):backupJson;
 assert(file?.schema==='P40L_BACKUP_V1'&&file.userId===PERSON,'INVALID_BACKUP');
 assert(file.fingerprint===await sha(file.state),'BACKUP_CORRUPT');
 validateData(file.state.data);
 const r=await remote();
 assert(file.state.base.syncVersion<=r.syncVersion &&
        file.state.base.ledgerVersion===r.ledgerVersion,'BACKUP_LEDGER_CONFLICT');
 // Only a manually supplied external copy; this explicit recovery never
 // changes cloud or derives a new financial balance.
 await commit(file.state);
 return 'EXPLICIT_SYNTHETIC_BACKUP_RECOVERED';
}
async function inspect(){
 const {state,journal}=await dbRead();
 return {state:clone(state??null),journal:clone(journal??null),
   emergency:localStorage.getItem(EMERGENCY),token:localStorage.getItem(TOKEN),
   marker:localStorage.getItem(MARKER),temporary};
}
function tamper(kind){
 if(kind==='emergency')localStorage.setItem(EMERGENCY,'{"corrupted":true}');
 else if(kind==='token')localStorage.setItem(TOKEN,'bad-token');
 else if(kind==='journal')dbP.then(db=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({phase:'PRIMARY_WRITTEN',id:'SYNTH-CORRUPT'},JOURNAL)});
 else fail('UNKNOWN_TAMPER');return 'TAMPERED';
}
function setEditorDirty(v){editorDirty=!!v;}
window.p40l=Object.freeze({init,verified,localEdit,status,upload,resolveUnknownUpload,
 exportBackup,armRestore,restoreRemote,recoverExplicitBackup,inspect,tamper,
 setEditorDirty,validateData});
})();
