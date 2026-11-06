'use strict';
// P37-19W: immutable, read-only evidence manifest. Does NOT read secrets,
// authorize remote staging, operate on ERP money, or certify a live HTTP race.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MODE='P37_19W_TEST_LAB_OPERATOR_PRECHECK_ONLY';
const SCHEMA='kushe-p37-19w-evidence-gate-v1';
const TEST_PROJECT='ldktrfgzzzmklhsnfrol';
const FIXTURE='00000000-0000-4000-8000-000000019019';
const fail=x=>{throw Error('P37-19W '+x)};
const PINNED=Object.freeze({
 'p37-lab/p37-19g/stage-fixture.sql':'877a9cb94c423eddc16434ebc98b09c0cad62d2d',
 'p37-lab/p37-19g/cleanup-fixture.sql':'b6b3773506248ebedfcf1e9f86125b741511a34a',
 'p37-lab/p37-19g/dual-client-rpc.mjs':'b3e792308c2623f74a4bbcff20c64d09887da645',
 'p37-lab/p37-19h/verified-sessions.mjs':'e8f86d9bda6d54d9eff2b7ef9beeda8f7bac392b',
 'p37-lab/p37-19v/signed-http-gate.mjs':'1038b74976425b5d17ccdd93ec81172efbf0a41d',
 'p37-lab/p37-19v/live-lab-readonly-observation.json':'eb44fb6e30b3d4c04c73b17c1f62d4ee94f7ebf3'
});
function digest(data) {
 const bytes=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
 return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
}
function immutableSourceCheck(root) {
 if(typeof root!=='string'||!root)fail('REPOSITORY_ROOT_REQUIRED');
 const out={};
 for(const [rel,pin] of Object.entries(PINNED)){
  const content=fs.readFileSync(path.join(root,rel));
  const actual=digest(content);
  if(actual!==pin)fail('TEST_LAB_REVIEW_SOURCE_CHANGED_'+rel);
  out[rel]={gitBlob:actual,unchanged:true};
 }
 const gStage=fs.readFileSync(path.join(root,'p37-lab/p37-19g/stage-fixture.sql'),'utf8');
 const gClean=fs.readFileSync(path.join(root,'p37-lab/p37-19g/cleanup-fixture.sql'),'utf8');
 if(!gStage.includes("current_user<>'postgres'")||
    !gStage.includes('P37_19G_LAB_MUST_START_EMPTY')||
    !gStage.includes(FIXTURE)||
    !gStage.includes('COMMIT;')||
    !gClean.includes('P37_19G_FOREIGN_ROWS_PRESENT_NO_CLEANUP')||
    !gClean.includes('P37_19G_FIXTURE_IDENTITY_MISMATCH')||
    !gClean.includes(FIXTURE)||
    !gClean.includes('P37_19G_ADMIN_CLEANUP_PASS')||
    !gClean.includes('COMMIT;'))fail('STAGING_OR_CLEANUP_INTEGRITY_MISSING');
 return Object.freeze(out);
}
function inspect(root) {
 const pins=immutableSourceCheck(root);
 const evidence=JSON.parse(fs.readFileSync(path.join(root,
  'p37-lab/p37-19v/live-lab-readonly-observation.json'),'utf8'));
 if(evidence.schema!=='kushe-p37-19v-live-lab-inspection-20261106-v1'||
    evidence.isolatedSupabaseProject!==TEST_PROJECT||
    evidence.remainingSyntheticCases!==0||
    evidence.remainingSyntheticAllowances!==0||
    evidence.enabledTestMembers!==1||
    evidence.tablesRlsEnabled?.p37_lab_cases!==true||
    evidence.tablesRlsEnabled?.p37_lab_allowances!==true||
    evidence.tablesRlsEnabled?.p37_lab_members!==true||
    evidence.rpcIsSecurityInvoker!==true||
    evidence.anonMayExecuteRPC!==false||
    evidence.authenticatedMayExecuteRPC!==true||
    evidence.authenticatedCaseTableFullUpdateGranted!==false||
    JSON.stringify(evidence.authenticatedCaseTableUpdateColumns)!=='["revision"]'||
    evidence.jwtTokensObtained!==false||
    evidence.sessionIdClaimsCompared!==false||
    evidence.actualSignedHttpRpcRacesExecuted!==false||
    evidence.adminCleanupAfterRealSignedHttpRaceVerified!==false||
    evidence.formalERPPostingEnabled!==false||
    evidence.productionReleaseAllowed!==false)fail('PREVIOUS_EVIDENCE_CANNOT_ESTABLISH_SIGNED_HTTP');
 const remoteSessions=evidence.distinctAuthSessionRowIds;
 if(!Number.isInteger(remoteSessions)||remoteSessions<0)
  fail('SESSION_DATABASE_ROW_COUNT_INVALID');
 return Object.freeze({
  schema:SCHEMA,mode:MODE,
  labProjectId:TEST_PROJECT,labCaseId:FIXTURE,
  stageAndCleanupSourcePins:pins,
  earlierManagementSnapshotReadOnly:true,
  earlierSnapshotHasNoCasesAndAllowances:true,
  authSessionDatabaseRowsObserved:remoteSessions,
  distinctSignedJwtClaimsFromHTTPVerified:false,
  twoCurrentAuthTokensDemonstrated:false,
  postgrestRlsAuthenticatedLiveVerified:false,
  twoRealSignedRpcRequestsVerified:false,
  trueRemoteCASRaceOutcomeVerified:false,
  exactCleanupAfterRealRpcVerified:false,
  sampleDbReadOnly:true,formalSupabaseTouched:false,
  formalERPMoneyRowsModified:0,
  actualRoleAndCredentialNeeded:'TRUSTED_TEST_LAB_ENV_ONLY',
  readyForManualAuthOnlyPreflight:true,
  allowStageWithoutCompletedAuthPreflight:false,
  allowRealRpcWithoutAdminCleanupReadiness:false,
  mayMergeBeta:false,mayMergeMain:false,
  releaseState:'NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING',
  canPost:false,canDeploy:false
 });
}
function classify(checkpoint){
 if(!checkpoint||checkpoint.projectId!==TEST_PROJECT||
    checkpoint.caseId!==FIXTURE||
    !['AUTH_ONLY','RPC_RACE','POSTCLEANUP_AUTH_ONLY'].includes(checkpoint.phase))
  fail('WRONG_PROJECT_OR_WORKFLOW_PHASE');
 const proof=checkpoint.runtimeOutcome;
 if(proof&&typeof proof==='object'&&(
   proof.productionReleaseAllowed===true||proof.canPost===true||
   proof.formalERPWrites>0))
  fail('UNTRUSTED_PRODUCTION_PERMISSION');
 if(!proof||typeof proof.status!=='string')
   return Object.freeze({phase:checkpoint.phase,state:'BLOCKED_NO_SIGNED_EVIDENCE',
    verifiedLive:false,productionReleaseAllowed:false});
 if(proof.status.startsWith('MOCK_'))
   return Object.freeze({phase:checkpoint.phase,state:'SIMULATED_NOT_REAL',
    verifiedLive:false,productionReleaseAllowed:false});
 const valid=checkpoint.phase==='RPC_RACE'?
  proof.status==='LAB_SIGNED_RPC_RACE_PROVISIONAL_ADMIN_CLEANUP_REQUIRED':
  proof.status==='LAB_SIGNED_AUTH_READ_ONLY_PREFLIGHT_PASS';
 if(!valid)fail('UNRECOGNIZED_HTTP_EVIDENCE_STATUS');
 return Object.freeze({phase:checkpoint.phase,
  state:checkpoint.phase==='RPC_RACE'?
   'PROVISIONAL_RPC_EVEN_IF_REAL_ADMIN_CLEANUP_REQUIRED':
   'AUTH_ONLY_OR_POSTCLEANUP_RLS_LIMITED',
  verifiedLive:false, // caller-provided objects cannot certify signed HTTP
  mustRecheckAdminSql:true,productionReleaseAllowed:false,
  canPost:false});
}
module.exports=Object.freeze({inspect,classify,digest,PINNED,MODE,SCHEMA,
 TEST_PROJECT,FIXTURE});
