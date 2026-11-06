// P37-19W — credentialed OPERATOR-ONLY sequencing, no network on import.
// Uses the already verified P37-19V guarded real request runner.
// CI injects mocked fetch and cannot establish real signed HTTP evidence.
import {pathToFileURL} from 'node:url';
import {config as vConfig,run as vRun,MODE as V_MODE,TARGET} from '../p37-19v/signed-http-gate.mjs';
const LAB='https://ldktrfgzzzmklhsnfrol.supabase.co';
const ID='00000000-0000-4000-8000-000000019019';
const APPROVE='KUSHE_AUTH_LAB_ONLY';
const OP_MODE=Object.freeze({
 AUTH:'AUTH_ONLY',
 RACE:'RPC_RACE_STAGED_MANUAL_ONLY',
 CLEAN:'POSTCLEANUP_AUTH_ONLY'
});
const fail=message=>{throw Error('P37-19W '+message)};
const neutral=()=>Object.freeze({canPost:false,productionReleaseAllowed:false,
 officialTaxVoucherVerified:false,formalERPCloudWrites:0,
 adminCleanupIndependentlyVerified:false});
export function configuration(env){
 if(!env||env.P37_19W_PROJECT_CONFIRM!==APPROVE||
    env.P37_19W_TEST_URL!==LAB||
    env.P37_19W_CASE_ID!==ID)fail('ISOLATED_PROJECT_AND_CASE_CONFIRMATION_REQUIRED');
 const phase=env.P37_19W_PHASE;
 if(!Object.values(OP_MODE).includes(phase))fail('UNKNOWN_OPERATOR_PHASE');
 if(env.P37_19W_ALLOW_MAIN==='YES'||env.P37_19W_ALLOW_BETA==='YES'||
    env.P37_19W_ADMIN_SECRET||env.P37_19W_SERVICE_ROLE||env.SUPABASE_SERVICE_ROLE_KEY)
    fail('PRODUCTION_OR_ADMIN_SECRET_REJECTED');
 const vEnv={
  P37_19V_CONFIRM_PROJECT:APPROVE,
  P37_19V_URL:LAB,
  P37_19V_TARGET_CASE_ID:ID,
  P37_19V_PUBLISHABLE_KEY:env.P37_19W_TEST_PUBLISHABLE_KEY,
  P37_19V_TEST_EMAIL:env.P37_19W_TEST_EMAIL,
  P37_19V_TEST_PASSWORD:env.P37_19W_TEST_PASSWORD
 };
 if(phase===OP_MODE.RACE){
  if(env.P37_19W_SIGNED_PREFLIGHT_ALREADY_SUCCEEDED!=='YES_ON_DEDICATED_TEST_ACCOUNT'||
     env.P37_19W_STAGED_CASE_CONFIRMED!=='YES_ADMIN_COMMITTED_EXACT_CASE'||
     env.P37_19W_CLEANUP_OPERATOR_READY!=='YES_OPERATOR_WILL_CLEAN'||
     env.P37_19W_PRESTAGE_ZERO_CONFIRMED!=='YES_ZERO_CASES_AND_ALLOWANCES')
    fail('PRIOR_AUTH_STAGING_AND_CLEANUP_APPROVAL_REQUIRED');
  Object.assign(vEnv,{
   P37_19V_MODE:V_MODE.RACE,
   P37_19V_STAGING_COMMITTED:'YES_VERIFIED_BY_ADMIN',
   P37_19V_CLEANUP_OPERATOR_READY:'YES',
   P37_19V_ZERO_DATA_PRECHECK:'CONFIRMED_BEFORE_STAGE'
  });
 }else{
  if(phase===OP_MODE.CLEAN&&
    env.P37_19W_ADMIN_CLEANUP_COMMITTED!=='YES_EXACT_ADMIN_SQL_ALREADY_DONE')
    fail('POSTCLEANUP_CANNOT_START_WITHOUT_ADMIN_SQL');
  Object.assign(vEnv,{P37_19V_MODE:V_MODE.AUTH});
 }
 const v=vConfig(vEnv);
 return Object.freeze({phase,delegate:v,networkTarget:LAB,
  syntheticCaseId:ID,productionReleaseAllowed:false});
}
export async function execute(cfg,fetcher=globalThis.fetch){
 if(!cfg||!Object.values(OP_MODE).includes(cfg.phase)||
    cfg.networkTarget!==LAB||cfg.syntheticCaseId!==ID||
    cfg.delegate?.base?.url!==LAB)fail('OPERATOR_CONFIG_NOT_APPROVED');
 if(typeof fetcher!=='function')fail('HTTP_TRANSPORT_NOT_AVAILABLE');
 const output=await vRun(cfg.delegate,fetcher);
 const simulated=fetcher!==globalThis.fetch;
 if(output.productionReleaseAllowed!==false||output.canPost!==false||
    output.formalERPWrites!==0||output.officialERPDataTouched!==false)
   fail('UNSAFE_LAB_RESPONSE_CANNOT_AUTHORIZE_FINANCE');
 if(cfg.phase===OP_MODE.RACE){
  if(output.winners!==1||output.conflicts!==1||
     output.adminCleanupRequired!==true||output.cleanupVerified!==false||
     output.sessionsRevokedByUnderlyingRunner!==true)
     fail('RACE_OR_MANDATORY_CLEANUP_NOT_PROVEN');
  return Object.freeze({...neutral(),phase:cfg.phase,
    status:simulated?'MOCK_RACE_NOT_SIGNED':
      'REAL_LAB_RACE_PROVISIONAL_ADMIN_CLEANUP_REQUIRED',
    liveAuthProven:!simulated,
    liveRpcProvenBeforeAdminCleanup:!simulated,
    rpcWinnerCount:1,rpcConflictCount:1,
    adminCleanupRequired:true,adminPostcheckPending:true,
    verifiedFinalAcceptance:false});
 }
 if(output.sessionsRevoked!==2||output.labRecordsObserved!==0||
    output.allowancesObserved!==0||
    output.signedHttpRpcConcurrentRaceVerified!==false)
  fail('AUTH_EMPTY_LAB_OR_SIGNOUT_NOT_VALIDATED');
 return Object.freeze({...neutral(),phase:cfg.phase,
  status:simulated?'MOCK_AUTH_ONLY_NOT_SIGNED':
    cfg.phase===OP_MODE.CLEAN?'REAL_LAB_POSTCLEANUP_AUTH_ZERO_RLS_ONLY':
      'REAL_LAB_TWO_AUTH_SESSIONS_READONLY_PRECHECK',
  liveAuthProven:!simulated,liveRpcProvenBeforeAdminCleanup:false,
  verifiedFinalAcceptance:false,
  adminCleanupRequired:cfg.phase!==OP_MODE.CLEAN,
  mustVerifyAdminSql:cfg.phase===OP_MODE.CLEAN});
}
export const MODE=OP_MODE;
export const TARGET=Object.freeze({origin:LAB,caseId:ID});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await execute(configuration(process.env));
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.phase===OP_MODE.RACE){
   // Admin cleanup is necessary even when the RPC returns apparent success.
   process.stderr.write('P37-19W: RUN EXACT ADMIN CLEANUP IN kushe-auth-lab; independently SELECT 0/0. NO PRODUCTION DEPLOYMENT.\n');
   process.exitCode=2;
  }
 }catch(_){
  // Never print emails, passwords, tokens, full HTTP bodies or JWT claims.
  process.stderr.write('P37-19W BLOCKED / NO VERIFIED SIGNED EVIDENCE. If a synthetic case was staged, perform exact LAB admin cleanup before another attempt.\n');
  process.exitCode=1;
 }
}
