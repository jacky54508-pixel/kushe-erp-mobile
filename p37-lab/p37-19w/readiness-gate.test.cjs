'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('./readiness-gate.cjs');
const root=path.resolve(__dirname,'../..');
const URL_LAB='https://ldktrfgzzzmklhsnfrol.supabase.co';
const ID='00000000-0000-4000-8000-000000019019';
const files=[...Object.keys(W.PINNED)];
function withTemp(copyMutator){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p37-19w-review-only-'));
 try{
  for(const file of files){
   const dest=path.join(tmp,file);
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   fs.copyFileSync(path.join(root,file),dest);
  }
  return copyMutator(tmp);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
test('all six critical G/H/V stage, cleanup and signed auth sources remain SHA-pinned',()=>{
 const result=W.inspect(root);
 assert.equal(result.schema,W.SCHEMA);
 assert.equal(result.labProjectId,'ldktrfgzzzmklhsnfrol');
 assert.equal(result.labCaseId,ID);
 assert.equal(Object.keys(result.stageAndCleanupSourcePins).length,6);
 assert.ok(Object.values(result.stageAndCleanupSourcePins).every(r=>r.unchanged));
 assert.equal(result.earlierSnapshotHasNoCasesAndAllowances,true);
 assert.equal(result.authSessionDatabaseRowsObserved,2);
 assert.equal(result.twoCurrentAuthTokensDemonstrated,false);
 assert.equal(result.twoRealSignedRpcRequestsVerified,false);
 assert.equal(result.exactCleanupAfterRealRpcVerified,false);
 assert.equal(result.allowStageWithoutCompletedAuthPreflight,false);
 assert.equal(result.allowRealRpcWithoutAdminCleanupReadiness,false);
 assert.equal(result.releaseState,'NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING');
 assert.equal(result.canPost,false);
 assert.equal(result.canDeploy,false);
 assert.equal(result.mayMergeMain,false);
 assert.equal(result.mayMergeBeta,false);
});
test('mutated stage, cleanup, auth, RPC, V protocol and lab evidence all refuse approval',()=>{
 for(const file of files)withTemp(tmp=>{
   fs.appendFileSync(path.join(tmp,file),'\nINVALID_MODIFICATION_DO_NOT_TRUST');
   assert.throws(()=>W.inspect(tmp),/TEST_LAB_REVIEW_SOURCE_CHANGED_/);
 });
});
test('two database session rows never certify distinct signed JWT claims or HTTP RPC',()=>{
 const result=W.inspect(root);
 assert.equal(result.authSessionDatabaseRowsObserved,2);
 assert.equal(result.distinctSignedJwtClaimsFromHTTPVerified,false);
 assert.equal(result.postgrestRlsAuthenticatedLiveVerified,false);
 assert.equal(result.trueRemoteCASRaceOutcomeVerified,false);
});
test('mock evidence is always a simulation, and final account release stays NO-GO',()=>{
 for(const phase of ['AUTH_ONLY','RPC_RACE','POSTCLEANUP_AUTH_ONLY']){
  const result=W.classify({projectId:W.TEST_PROJECT,caseId:W.FIXTURE,
   phase,runtimeOutcome:{status:'MOCK_AUTH_ONLY_NOT_SIGNED',productionReleaseAllowed:false}});
  assert.equal(result.verifiedLive,false);
  assert.equal(result.state,'SIMULATED_NOT_REAL');
  assert.equal(result.productionReleaseAllowed,false);
 }
});
test('even supplied provisional real-sounding evidence must demand independent admin cleanup',()=>{
 const v=W.classify({projectId:W.TEST_PROJECT,caseId:W.FIXTURE,
   phase:'RPC_RACE',runtimeOutcome:{
    status:'LAB_SIGNED_RPC_RACE_PROVISIONAL_ADMIN_CLEANUP_REQUIRED',
    canPost:false,productionReleaseAllowed:false,formalERPWrites:0
   }});
 assert.equal(v.verifiedLive,false);
 assert.equal(v.mustRecheckAdminSql,true);
 assert.equal(v.canPost,false);
 assert.equal(v.productionReleaseAllowed,false);
});
test('wrong project, fixture, phase, privilege and missing proof all fail closed',()=>{
 const base={projectId:W.TEST_PROJECT,caseId:W.FIXTURE,phase:'AUTH_ONLY',
  runtimeOutcome:{status:'MOCK_AUTH_ONLY_NOT_SIGNED'}};
 assert.throws(()=>W.classify({...base,projectId:'jimcybsztnwfzrnvexsp'}),/WRONG_PROJECT/);
 assert.throws(()=>W.classify({...base,caseId:'UNKNOWN'}),/WRONG_PROJECT/);
 assert.throws(()=>W.classify({...base,phase:'PRODUCTION_WRITE'}),/WRONG_PROJECT/);
 assert.throws(()=>W.classify({...base,runtimeOutcome:{...base.runtimeOutcome,canPost:true}}),/UNTRUSTED_PRODUCTION/);
 assert.throws(()=>W.classify({...base,runtimeOutcome:{status:'LIVE_SUCCESS'}}),/UNRECOGNIZED_HTTP/);
 const unknown=W.classify({...base,runtimeOutcome:null});
 assert.equal(unknown.state,'BLOCKED_NO_SIGNED_EVIDENCE');
});
test('W manifest cannot alter ERP Store, fetch from Supabase or issue SQL mutations',()=>{
 const source=fs.readFileSync(path.join(__dirname,'readiness-gate.cjs'),'utf8');
 const imports=[...source.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)].map(x=>x[1]);
 assert.deepEqual(imports,['node:fs','node:path','node:crypto']);
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage)\s*(?:\(|\.|\[)/);
 assert.doesNotMatch(source,/\b(?:CREATE TABLE|INSERT INTO|DELETE FROM|GRANT ALL|UPDATE public\.)\b/i);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'),/p37-19w|p3719w/i);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8'),/p37-19w|p3719w/i);
});
