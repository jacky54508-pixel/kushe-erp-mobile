(() => {
'use strict';
// P37-19M isolated-origin synthetic browser recovery harness.
// No ERP Store, finance API, real company data, cookies or Supabase.
if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:' || location.pathname !== '/') {
  throw Error('P37-19M MUST_RUN_ON_ISOLATED_LOOPBACK_ONLY');
}
const SCOPE='P37_19M_SYNTHETIC_LOCAL_ONLY';
const SCHEMA='kushe-p37-19m-real-browser-fixture-v1';
const DB='P37-19M-SYNTHETIC-ISOLATED-INDEXEDDB';
const EMERGENCY='P37-19M-SYNTHETIC-EMERGENCY';
const TOKEN='P37-19M-SYNTHETIC-COMMIT-TOKEN';
const CLOUD='P37-19M-SYNTHETIC-CLOUD-GATE';
const AR='P37-19-SYN-AR-BROWSER';
const BASE_FP='P37-19-SYN-REMOTE-FP-41';
const INITIAL=Object.freeze({
  schema:SCHEMA,scope:SCOPE,productionData:false,formalPostingEnabled:false,
  revision:0,receivableId:AR,
  originalGross:1310400,syntheticAllowanceGross:27300,
  effectiveGross:1283100,effectiveReceivable:1160900,effectiveRetention:122200,
  principalReceived:0,retentionReceived:0,
  receipts:[],bankTransactions:[]
});
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=code=>{throw Error('P37-19M '+code)};
const prefix='P37-19-SYN-TX-';
const syntId=/^P37-19-SYN-[A-Z0-9-]{1,90}$/;
function audit(s) {
  if (!s || s.schema!==SCHEMA || s.scope!==SCOPE || s.productionData!==false ||
    s.formalPostingEnabled!==false || s.receivableId!==AR ||
    s.originalGross!==1310400 || s.syntheticAllowanceGross!==27300 ||
    s.effectiveGross!==1283100 || s.effectiveReceivable!==1160900 ||
    s.effectiveRetention!==122200 || s.retentionReceived!==0 ||
    !Number.isSafeInteger(s.revision) || s.revision<0 || s.revision>1 ||
    !Array.isArray(s.receipts) || !Array.isArray(s.bankTransactions) ||
    s.receipts.length!==s.revision || s.bankTransactions.length!==s.revision)
      fail('INVALID_SYNTHETIC_FINANCIAL_SNAPSHOT');
  if(s.revision===0 && s.principalReceived!==0)fail('GHOST_BALANCE_BEFORE_COMMIT');
  if(s.revision===1){
    const r=s.receipts[0],b=s.bankTransactions[0];
    if(!r||!b||!syntId.test(r.id)||!syntId.test(b.id)||
       r.id===b.id||!r.actionKey?.startsWith(prefix)||
       !Number.isSafeInteger(r.cashAmount)||r.cashAmount<=0||
       r.cashAmount>1160900||r.receivableId!==AR||
       b.receiptId!==r.id||b.receivableId!==AR||
       b.amount!==r.cashAmount||b.bankAccountId!=='P37-19-SYN-BANK'||
       b.type!=='SYNTHETIC_INCOME_NOT_ERP'||
       s.principalReceived!==r.cashAmount)
       fail('RECEIPT_BANK_OR_SETTLEMENT_MISMATCH');
  }
  return true;
}
async function hash(value){
 const src=new TextEncoder().encode(JSON.stringify(value));
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',src));
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
function openDb(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('store'))db.createObjectStore('store');
  };
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>resolve(request.result);
 });
}
async function read(key){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('store','readonly'),request=tx.objectStore('store').get(key);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  tx.oncomplete=()=>db.close();
  tx.onerror=()=>{db.close();reject(tx.error)};
  tx.onabort=()=>{db.close();reject(tx.error)};
 });
}
async function write(rows){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('store','readwrite'),store=tx.objectStore('store');
  for(const [name,value] of Object.entries(rows))store.put(copy(value),name);
  tx.oncomplete=()=>{db.close();resolve()};
  tx.onerror=()=>{db.close();reject(tx.error)};
  tx.onabort=()=>{db.close();reject(tx.error)};
 });
}
async function remote(){
 const response=await fetch('/api/state',{cache:'no-store'});
 if(!response.ok)fail('SYNTHETIC_REMOTE_READ_FAILED');
 const state=await response.json();
 if(state.scope!==SCOPE||!/^([1-9][0-9]*)$/.test(state.version)||
    !state.fingerprint||state.formalERPCloudWrites!==0||
    state.formalBankTransactions!==0)fail('REMOTE_NOT_ISOLATED');
 return state;
}
function cloudGate(){
 const value=localStorage.getItem(CLOUD);
 if(!value)fail('NO_PERSISTENT_CLOUD_GATE');
 let gate;
 try{gate=JSON.parse(value)}catch(_){fail('INVALID_CLOUD_GATE')}
 if(gate.scope!==SCOPE||!['SYNCED','PENDING_UPLOAD','CONFLICT_STOP',
    'UNCERTAIN_REMOTE_ACK','MANUAL_RETRY'].includes(gate.status)||
    !/^[1-9][0-9]*$/.test(gate.baselineVersion)||!gate.baselineFingerprint)
   fail('INVALID_CLOUD_GATE');
 return gate;
}
function setGate(gate){localStorage.setItem(CLOUD,JSON.stringify(gate))}
async function reset(){
 const existing=await openDb();existing.close();
 await new Promise((resolve,reject)=>{
  const q=indexedDB.deleteDatabase(DB);
  q.onsuccess=resolve;q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('DB_BLOCKED'));
 });
 for(const key of [EMERGENCY,TOKEN,CLOUD])localStorage.removeItem(key);
 return {scope:SCOPE,reset:true};
}
async function recover(){
 const before=await read('primary'),j=await read('journal');
 if(before===undefined && j===undefined){
  const server=await remote();
  if(server.version!=='41'||server.fingerprint!==BASE_FP||server.commits.length!==0)
    fail('UNRECOGNIZED_REMOTE_BOOTSTRAP_NOT_SAFE');
  const starting=copy(INITIAL),fp=await hash(starting);
  await write({primary:starting,journal:{phase:'COMMIT_VERIFIED',before:starting,after:starting,
   beforeHash:fp,afterHash:fp}});
  localStorage.setItem(EMERGENCY,JSON.stringify(starting));
  localStorage.setItem(TOKEN,fp);
  setGate({scope:SCOPE,status:'SYNCED',baselineVersion:server.version,
   baselineFingerprint:server.fingerprint,actionKey:null,proposedFingerprint:null});
  return {recovery:'BOOTSTRAP',snapshot:starting,cloud:cloudGate()};
 }
 if(!before||!j||!j.before||!j.after)fail('INCOMPLETE_IDB_SOURCE');
 audit(before);audit(j.before);audit(j.after);
 const originalHash=await hash(j.before),proposedHash=await hash(j.after);
 if(j.beforeHash!==originalHash||j.afterHash!==proposedHash)fail('IDB_JOURNAL_TAMPERED');
 const currentHash=await hash(before),mirror=localStorage.getItem(EMERGENCY),
  token=localStorage.getItem(TOKEN);
 if(!mirror||!token)fail('EMERGENCY_OR_TOKEN_MISSING');
 const phase=j.phase;
 if(['PRIMARY_WRITTEN','EMERGENCY_WRITTEN','TOKENS_WRITTEN'].includes(phase)){
  if(currentHash!==proposedHash)fail('UNVERIFIED_PRIMARY_DOES_NOT_MATCH_JOURNAL');
  const desiredMirror=phase==='PRIMARY_WRITTEN'?JSON.stringify(j.before):JSON.stringify(j.after);
  const desiredToken=phase==='TOKENS_WRITTEN'?proposedHash:originalHash;
  if(mirror!==desiredMirror||token!==desiredToken)
   fail('UNSAFE_RECOVERY_MIRROR_OR_TOKEN_DIVERGENCE');
  await write({primary:j.before,journal:{...j,phase:'ROLLED_BACK'}});
  localStorage.setItem(EMERGENCY,JSON.stringify(j.before));
  localStorage.setItem(TOKEN,originalHash);
  const gate=cloudGate();
  if(gate.status!=='SYNCED')fail('RECOVERY_HAS_UNEXPECTED_SYNC_STATUS');
  return {recovery:'ROLLED_BACK_INCOMPLETE_SYNTHETIC_TRANSACTION',
    snapshot:copy(j.before),cloud:gate};
 }
 if(!['COMMIT_VERIFIED','ROLLED_BACK'].includes(phase))
  fail('UNKNOWN_JOURNAL_PHASE');
 const stableHash=phase==='ROLLED_BACK'?originalHash:proposedHash;
 if(currentHash!==stableHash||mirror!==JSON.stringify(before)||token!==currentHash)
  fail('COMMITTED_IDB_MIRRORS_MISMATCH_STOP');
 const gate=cloudGate();
 if(before.revision===1 && gate.status==='SYNCED' && gate.actionKey===null)
  fail('UNTRACKED_LOCAL_COMMIT_AFTER_ACK_LOSS_STOP');
 if(before.revision===0 && gate.status!=='SYNCED')fail('DIRTY_CLOUD_GATE_WITHOUT_LOCAL_COMMIT');
 return {recovery:phase,snapshot:before,cloud:gate};
}
async function boot(){
 const record=await recover();
 return {scope:SCOPE,recovery:record.recovery,
  revision:record.snapshot.revision,
  principalReceived:record.snapshot.principalReceived,
  receipts:record.snapshot.receipts.length,banks:record.snapshot.bankTransactions.length,
  localBankOnly:true,cloudStatus:record.cloud.status,formalERPConnected:false};
}
async function inspect(){
 const {snapshot:s,cloud:g,recovery:phase}=await recover();
 const journal=await read('journal');
 const fp=await hash(s);
 return {scope:SCOPE,revision:s.revision,principalReceived:s.principalReceived,
  outstanding:1160900-s.principalReceived,retentionOutstanding:122200,
  receiptCount:s.receipts.length,bankCount:s.bankTransactions.length,
  journalPhase:journal.phase,cloudStatus:g.status,
  baselineVersion:g.baselineVersion,actionKey:g.actionKey,
  mirrorValid:fp===localStorage.getItem(TOKEN) &&
    localStorage.getItem(EMERGENCY)===JSON.stringify(s),
  fingerprint:fp,formalStoreWrites:0,formalCloudWrites:0,canPost:false};
}
async function commit(actionKey,amount,fault=null){
 const {snapshot:before,cloud:g}=await recover();
 if(g.status!=='SYNCED'||before.revision!==0||g.actionKey!==null)
  fail('LOCAL_NEW_OPERATION_BLOCKED');
 if(typeof actionKey!=='string'||!actionKey.startsWith(prefix)||
    !syntId.test(actionKey)||!Number.isSafeInteger(amount)||amount<=0||amount>1160900)
  fail('SYNTHETIC_ACTION_OR_EFFECTIVE_LIMIT_INVALID');
 if(fault!==null&&!['AFTER_PRIMARY','AFTER_EMERGENCY','AFTER_TOKENS','AFTER_VERIFIED'].includes(fault))
  fail('UNKNOWN_LOCAL_FAULT');
 const journal=await read('journal'),beforeHash=await hash(before);
 if(journal.phase!=='COMMIT_VERIFIED'&&journal.phase!=='ROLLED_BACK')fail('BUSY_JOURNAL');
 const next=copy(before),receiptId=actionKey+'-R',bankId=actionKey+'-B';
 next.revision=1;next.principalReceived=amount;
 next.receipts=[{id:receiptId,actionKey,receivableId:AR,cashAmount:amount}];
 next.bankTransactions=[{id:bankId,receiptId,receivableId:AR,
  bankAccountId:'P37-19-SYN-BANK',type:'SYNTHETIC_INCOME_NOT_ERP',amount}];
 audit(next);
 const afterHash=await hash(next),entry={phase:'PRIMARY_WRITTEN',before,after:next,
  beforeHash,afterHash};
 await write({primary:next,journal:entry});
 if(fault==='AFTER_PRIMARY')fail('INJECTED_AFTER_PRIMARY');
 localStorage.setItem(EMERGENCY,JSON.stringify(next));
 await write({journal:{...entry,phase:'EMERGENCY_WRITTEN'}});
 if(fault==='AFTER_EMERGENCY')fail('INJECTED_AFTER_EMERGENCY');
 localStorage.setItem(TOKEN,afterHash);
 await write({journal:{...entry,phase:'TOKENS_WRITTEN'}});
 if(fault==='AFTER_TOKENS')fail('INJECTED_AFTER_TOKENS');
 await write({journal:{...entry,phase:'COMMIT_VERIFIED'}});
 if(fault==='AFTER_VERIFIED')fail('INJECTED_AFTER_VERIFIED_ACK_UNKNOWN');
 setGate({...g,status:'PENDING_UPLOAD',actionKey,proposedFingerprint:afterHash});
 return {localCommitted:true,remoteCommitted:false,receiptCount:1,
  bankCount:1,syntheticOnly:true,formalERPConnected:false,canPost:false};
}
async function upload(mode='NORMAL'){
 const {snapshot:s,cloud:g}=await recover();
 if(g.status!=='PENDING_UPLOAD'||s.revision!==1||
    !g.actionKey||g.proposedFingerprint!==await hash(s))
  fail('NO_VERIFIED_OUTBOX_FOR_SYNC');
 if(!['NORMAL','TIMEOUT_BEFORE','ACK_LOST'].includes(mode))fail('BAD_SYNC_SIMULATION');
 const body={scope:SCOPE,expectedVersion:g.baselineVersion,
  expectedFingerprint:g.baselineFingerprint,
  proposedFingerprint:g.proposedFingerprint,actionKey:g.actionKey,
  receivableId:AR,amount:s.principalReceived,
  receiptCount:s.receipts.length,bankCount:s.bankTransactions.length,
  newRevision:s.revision,mode};
 const result=await fetch('/api/cas',{method:'POST',cache:'no-store',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const reply=await result.json();
 if(result.status===200){
  if(reply.status==='APPLIED' &&
    reply.version===(BigInt(g.baselineVersion)+1n).toString() &&
    reply.fingerprint===g.proposedFingerprint &&
    reply.formalERPCloudWrites===0&&reply.formalBankTransactions===0){
   setGate({...g,status:'SYNCED',baselineVersion:reply.version,
    baselineFingerprint:reply.fingerprint});
   return {status:'SYNTHETIC_REMOTE_ACK_CONFIRMED',localRetained:true,formalERPCloudWrites:0};
  }
  setGate({...g,status:'UNCERTAIN_REMOTE_ACK'});
  return {status:'MALFORMED_ACK_STOP',localRetained:true,formalERPCloudWrites:0};
 }
 if(result.status===409){
  setGate({...g,status:'CONFLICT_STOP'});
  return {status:'SYNTHETIC_CAS_CONFLICT_STOP',localRetained:true,formalERPCloudWrites:0};
 }
 setGate({...g,status:'UNCERTAIN_REMOTE_ACK'});
 return {status:'AMBIGUOUS_REMOTE_ACK_STOP',localRetained:true,formalERPCloudWrites:0};
}
async function reconcile(){
 const {snapshot:s,cloud:g}=await recover();
 if(g.status!=='UNCERTAIN_REMOTE_ACK'||s.revision!==1)
  fail('NO_AMBIGUOUS_SYNC_TO_RECONCILE');
 const server=await remote();
 let status;
 if(server.version===(BigInt(g.baselineVersion)+1n).toString() &&
    server.fingerprint===g.proposedFingerprint &&
    server.commits.length===1 &&server.commits[0].actionKey===g.actionKey){
  setGate({...g,status:'SYNCED',baselineVersion:server.version,
   baselineFingerprint:server.fingerprint});
  status='INDEPENDENT_REMOTE_RECONCILED';
 }else if(server.version===g.baselineVersion&&server.fingerprint===g.baselineFingerprint){
  setGate({...g,status:'MANUAL_RETRY'});
  status='REMOTE_UNCHANGED_MANUAL_RETRY_ONLY';
 }else{
  setGate({...g,status:'CONFLICT_STOP'});
  status='REMOTE_CONFLICT_MANUAL_REVIEW';
 }
 return {status,noAutomaticRetry:true,retainedLocalReceipt:true,canPost:false};
}
function tamperEmergencyForTest(){
 localStorage.setItem(EMERGENCY,'P37-19M-INTENTIONALLY-CORRUPTED-SYNTHETIC');
 return {tamperedSyntheticOnly:true};
}
window.KusheP3719MBrowserLab=Object.freeze({
 reset,boot,inspect,commit,upload,reconcile,tamperEmergencyForTest
});
})();