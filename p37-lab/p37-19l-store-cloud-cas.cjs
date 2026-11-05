'use strict';
// P37-19L: synthetic in-memory rehearsal of Store local transaction + remote CAS.
// This is NEVER a real distributed transaction or official ERP writer.
const K=require('./p37-19k-atomic-settlement.cjs');
const SCHEMA='kushe-p37-19l-synthetic-store-cloud-cas-v1';
const PLAN='kushe-p37-19l-synthetic-plan-v1';
const SCOPE='P37_LAB_SYNTHETIC_ONLY';
const ID=/^P37-19-SYN-[A-Z0-9-]{1,80}$/;
const names=['P37-19-SYN-DEVICE-A','P37-19-SYN-DEVICE-B'];
const copy=x=>JSON.parse(JSON.stringify(x));
const error=code=>{throw new Error('P37-19L '+code)};
const requireId=(s,label)=>{if(typeof s!=='string'||!ID.test(s))error(label+'_NOT_SYNTHETIC');return s};
function version(s){
 if(typeof s!=='string'||!/^[1-9][0-9]{0,18}$/.test(s)||BigInt(s)>9223372036854775807n)
   error('INVALID_REMOTE_VERSION');
 return BigInt(s);
}
const fingerprint=env=>K.digest(env);
function validate(input,inspector){
 if(!input||input.schema!==SCHEMA||input.scope!==SCOPE||
  input.productionData!==false||input.formalStoreWrites!==0||
  input.formalBankWrites!==0||input.realCloudRequests!==0||
  !input.remote||!Array.isArray(input.devices)||input.devices.length!==2)
    error('NOT_A_SYNTHETIC_SCENARIO');
 const remote=input.remote;
 version(remote.version);
 if(remote.writerMode!=='trusted'||remote.lastBaseVersion===undefined||
   remote.fingerprint!==fingerprint(remote.envelope))
   error('REMOTE_VERSION_OR_SNAPSHOT_CORRUPT');
 K.stateView(remote.envelope,inspector);
 const ids=new Set();
 for(const d of input.devices){
  requireId(d.id,'DEVICE');requireId(d.userId,'USER');requireId(d.companyId,'COMPANY');
  if(!names.includes(d.id)||ids.has(d.id)||d.trusted!==true||
     d.companyId!=='P37-19-SYN-COMPANY'||d.userId!=='P37-19-SYN-OWNER')
    error('TRUSTED_DEVICE_PRINCIPAL_MISMATCH');
  ids.add(d.id);
  if(!['READY','PENDING_UPLOAD','SYNCED','CONFLICT_STOP',
    'UNCERTAIN_REMOTE_ACK','MANUAL_RETRY_REQUIRED'].includes(d.status))
    error('UNKNOWN_SYNC_STATE');
  version(d.baselineVersion);
  if(d.localDigest!==fingerprint(d.local)||d.emergencyMirrorDigest!==d.localDigest||
     d.commitTokenDigest!==d.localDigest||
     !['COMMIT_VERIFIED','BOOTSTRAP'].includes(d.storeJournalStatus))
    error('LOCAL_STORE_MIRRORS_OR_COMMIT_TOKEN_DIFFER');
  const report=K.stateView(d.local,inspector);
  if(report.report.canPost!==false)error('FORMAL_WRITE_WAS_UNLOCKED');
  if(['READY','SYNCED'].includes(d.status)&&d.outbox!==null)
    error('CLEAN_DEVICE_HAS_UNSENT_OUTBOX');
  if(!['READY','SYNCED'].includes(d.status)){
   if(!d.outbox||d.outbox.proposedDigest!==d.localDigest||
      d.outbox.expectedVersion!==d.baselineVersion||
      d.outbox.expectedFingerprint!==d.baselineFingerprint)
     error('UNRESOLVED_LOCAL_OUTBOX_MISSING_OR_STALE');
  }
 }
 if(ids.size!==2)error('MISSING_SECOND_DEVICE');
 return true;
}
function initialize(envelope,inspector){
 if(envelope?.scope!==SCOPE||envelope?.revision!==0||
  envelope.schema!==K.SCHEMA||envelope.postingEnabled!==false||
  envelope.cloudWrites!==0||envelope.formalERPWriterConnected!==false)
   error('UNKNOWN_STARTING_STORE_SNAPSHOT');
 K.stateView(envelope,inspector);
 const base=copy(envelope),dg=fingerprint(base);
 const devices=names.map(id=>({
  id,userId:'P37-19-SYN-OWNER',companyId:'P37-19-SYN-COMPANY',
  trusted:true,local:copy(base),localDigest:dg,emergencyMirrorDigest:dg,
  commitTokenDigest:dg,storeJournalStatus:'BOOTSTRAP',status:'READY',
  baselineVersion:'41',baselineFingerprint:dg,outbox:null
 }));
 const result={schema:SCHEMA,scope:SCOPE,productionData:false,
  formalStoreWrites:0,formalBankWrites:0,realCloudRequests:0,
  remote:{version:'41',fingerprint:dg,writerMode:'trusted',lastBaseVersion:'40',envelope:copy(base)},
  devices};
 validate(result,inspector);
 return result;
}
function deviceOf(system,name){
 const d=system.devices.filter(d=>d.id===requireId(name,'DEVICE'));
 if(d.length!==1)error('UNKNOWN_DEVICE');
 return d[0];
}
function prepare(system,name,intent,inspector){
 validate(system,inspector);
 const d=deviceOf(system,name);
 if(!['READY','SYNCED'].includes(d.status)||d.outbox)
  error('DEVICE_NOT_READY_FOR_NEW_FINANCIAL_ACTION');
 const before=JSON.stringify(system);
 const draft=K.simulate(d.local,intent,inspector);
 if(draft.ok!==true||draft.postedToERP!==false||draft.cloudWrites!==0||
  draft.formalBankEntriesAdded!==0||draft.formalPayrollUnlocked!==false)
   error('SYNTHETIC_FINANCE_ACTION_NOT_READONLY');
 const result={
  schema:PLAN,scope:SCOPE,deviceId:d.id,userId:d.userId,companyId:d.companyId,
  beforeDigest:d.localDigest,expectedBusinessRevision:d.local.data.meta.businessSnapshotRevision.id,
  expectedLocalRevision:d.local.revision,expectedRemoteVersion:d.baselineVersion,
  expectedRemoteFingerprint:d.baselineFingerprint,action:copy(intent),
  proposedDigest:fingerprint(draft.nextState),draft:copy(draft.nextState),
  canWriteFormalERP:false
 };
 if(JSON.stringify(system)!==before)error('INPUT_SCENARIO_MUTATED_DURING_PREPARE');
 return result;
}
function localCommit(system,plan,inspector,options={}){
 validate(system,inspector);
 const before=JSON.stringify(system),d=deviceOf(system,plan?.deviceId);
 if(!plan||plan.schema!==PLAN||plan.scope!==SCOPE||plan.canWriteFormalERP!==false||
  plan.userId!==d.userId||plan.companyId!==d.companyId||
  !['READY','SYNCED'].includes(d.status)||d.outbox||
  plan.beforeDigest!==d.localDigest||plan.expectedLocalRevision!==d.local.revision||
  plan.expectedBusinessRevision!==d.local.data.meta.businessSnapshotRevision.id||
  plan.expectedRemoteVersion!==d.baselineVersion||
  plan.expectedRemoteFingerprint!==d.baselineFingerprint)
  error('LOCAL_PRECOMMIT_SNAPSHOT_OR_DEVICE_CHANGED');
 const predicted=K.simulate(d.local,plan.action,inspector);
 if(predicted.ok!==true||fingerprint(predicted.nextState)!==plan.proposedDigest||
  JSON.stringify(predicted.nextState)!==JSON.stringify(plan.draft))
  error('PLAN_TAMPERED_OR_UNVERIFIED');
 const failAt=options.failAt||null;
 if(failAt&&!['AFTER_PRIMARY','AFTER_EMERGENCY','AFTER_TOKENS','BEFORE_COMMIT_VERIFIED'].includes(failAt))
  error('UNKNOWN_LOCAL_FAULT');
 const fail=point=>{if(failAt===point)error('INJECTED_LOCAL_ROLLBACK_'+point)};
 const next=copy(system),out=deviceOf(next,plan.deviceId);
 // All stages are in memory. If any stage fails the caller receives no draft.
 const staged=copy(predicted.nextState),newDigest=fingerprint(staged);
 out.storeJournalStatus='PRIMARY_WRITTEN';fail('AFTER_PRIMARY');
 out.emergencyMirrorDigest=newDigest;
 out.storeJournalStatus='EMERGENCY_WRITTEN';fail('AFTER_EMERGENCY');
 out.commitTokenDigest=newDigest;
 out.storeJournalStatus='TOKENS_WRITTEN';fail('AFTER_TOKENS');
 K.stateView(staged,inspector);fail('BEFORE_COMMIT_VERIFIED');
 out.local=staged;out.localDigest=newDigest;
 out.storeJournalStatus='COMMIT_VERIFIED';
 out.status='PENDING_UPLOAD';
 out.outbox={schema:PLAN,actionKey:plan.action.key,
  expectedVersion:plan.expectedRemoteVersion,
  expectedFingerprint:plan.expectedRemoteFingerprint,
  proposedDigest:newDigest,
  businessRevision:staged.data.meta.businessSnapshotRevision.id};
 validate(next,inspector);
 if(JSON.stringify(system)!==before)error('CALLER_CHANGED_ON_LOCAL_COMMIT');
 return {status:'SYNTHETIC_LOCAL_COMMIT_ONLY',scenario:next,
  localCommitted:true,remoteCommitted:false,realCloudRequests:0,
  formalStoreWrites:0,formalBankWrites:0,canPost:false};
}
function send(system,name,inspector,{mode='APPLIED'}={}){
 validate(system,inspector);
 if(!['APPLIED','TIMEOUT_BEFORE_REMOTE','TIMEOUT_AFTER_REMOTE','AUTH_REJECTED'].includes(mode))
  error('UNKNOWN_REMOTE_RESPONSE_MODE');
 const before=JSON.stringify(system),next=copy(system),d=deviceOf(next,name);
 if(d.status!=='PENDING_UPLOAD'||!d.outbox)error('NO_COMMITTED_LOCAL_OUTBOX');
 const remote=next.remote,out=d.outbox;
 const existingMismatch=remote.version!==out.expectedVersion||
  remote.fingerprint!==out.expectedFingerprint;
 let status;
 if(existingMismatch){
  d.status='CONFLICT_STOP';status='REMOTE_CAS_CONFLICT_STOP';
 }else if(mode==='AUTH_REJECTED'){
  d.status='UNCERTAIN_REMOTE_ACK';status='REQUIRES_REMOTE_READ_NO_AUTH_RETRY';
 }else if(mode==='TIMEOUT_BEFORE_REMOTE'){
  d.status='UNCERTAIN_REMOTE_ACK';status='REMOTE_ACK_AMBIGUOUS_NO_AUTORETRY';
 }else{
  // Synthetic in-memory CAS: copy local draft only if remote baseline matches.
  remote.lastBaseVersion=remote.version;
  remote.version=(version(remote.version)+1n).toString();
  remote.envelope=copy(d.local);
  remote.fingerprint=d.localDigest;
  if(mode==='TIMEOUT_AFTER_REMOTE'){
   d.status='UNCERTAIN_REMOTE_ACK';status='REMOTE_APPLIED_BUT_ACK_LOST';
  }else{
   d.baselineVersion=remote.version;d.baselineFingerprint=remote.fingerprint;
   d.status='SYNCED';d.outbox=null;status='SYNTHETIC_REMOTE_APPLIED';
  }
 }
 validate(next,inspector);
 if(JSON.stringify(system)!==before)error('ORIGINAL_SCENARIO_CHANGED_BY_REMOTE_SIMULATION');
 return {status,scenario:next,localDurable:true,
  remotelyVerified:status==='SYNTHETIC_REMOTE_APPLIED',
  formalStoreWrites:0,realCloudRequests:0,canPost:false};
}
function reconcile(system,name,inspector){
 validate(system,inspector);
 const before=JSON.stringify(system),next=copy(system),d=deviceOf(next,name);
 if(d.status!=='UNCERTAIN_REMOTE_ACK'||!d.outbox)
  error('NO_AMBIGUOUS_REMOTE_RESULT_TO_RECONCILE');
 const {remote}=next,out=d.outbox;
 let status;
 if(version(remote.version)===version(out.expectedVersion)+1n&&
    remote.fingerprint===out.proposedDigest){
  d.baselineVersion=remote.version;d.baselineFingerprint=remote.fingerprint;
  d.status='SYNCED';d.outbox=null;status='REMOTE_RECONCILED_SAME_SNAPSHOT';
 }else if(remote.version===out.expectedVersion&&
   remote.fingerprint===out.expectedFingerprint){
  d.status='MANUAL_RETRY_REQUIRED';status='UNCHANGED_REMOTE_EXPLICIT_RETRY_REQUIRED';
 }else{
  d.status='CONFLICT_STOP';status='REMOTE_CONFLICT_REQUIRES_MANUAL_RECONCILIATION';
 }
 validate(next,inspector);
 if(JSON.stringify(system)!==before)error('RECONCILE_MUTATED_INPUT');
 return {status,scenario:next,noAutomaticResubmit:true,
  canPost:false,formalStoreWrites:0,realCloudRequests:0};
}
function status(system,inspector){
 validate(system,inspector);
 return {schema:SCHEMA,scope:SCOPE,synthetic:true,
  devices:system.devices.map(d=>({deviceId:d.id,status:d.status,
   localRevision:d.local.revision,baselineVersion:d.baselineVersion,
   pendingOutbox:Boolean(d.outbox)})),
  remoteVersion:system.remote.version,
  remoteFingerprintMatches:system.remote.fingerprint===fingerprint(system.remote.envelope),
  formalERPConnected:false,realCloudRequests:0,formalBankWrites:0,
  postingEnabled:false,canPost:false,releaseBlocked:true,
  realTwoBrowserCASVerified:false};
}
module.exports=Object.freeze({initialize,prepare,localCommit,send,reconcile,status,validate,SCHEMA,PLAN,SCOPE});
