// P37-19V — real Supabase Auth / PostgREST manual gate, TEST LAB ONLY.
// This module does NOT stage, delete or modify anything on import.
// CI exercises mocks only. No credentials, JWT, passwords or emails in logs.
import {pathToFileURL} from 'node:url';
import {config as hConfig,preflight as hPreflight} from '../p37-19h/verified-sessions.mjs';
import {config as gConfig,execute as gExecute} from '../p37-19g/dual-client-rpc.mjs';

const URL='https://ldktrfgzzzmklhsnfrol.supabase.co';
const CASE_ID='00000000-0000-4000-8000-000000019019';
const fail=code=>{throw Error('P37-19V '+code)};
const MODE_AUTH='AUTH_READ_ONLY_LAB';
const MODE_RACE='SIGNED_RPC_RACE_STAGED_LAB';
const scrub=cfg=>Object.freeze({
 mode:cfg.mode,testLab:'kushe-auth-lab',realCompany:false,
 apiOrigin:URL,requiresCredentials:true,
 officialTaxVoucherVerified:false,formalERPWrites:0,
 productionReleaseAllowed:false
});
export function config(env) {
 if(!env||typeof env!=='object'||env.P37_19V_CONFIRM_PROJECT!=='KUSHE_AUTH_LAB_ONLY')
  fail('EXPLICIT_TEST_PROJECT_OPT_IN_REQUIRED');
 const mode=env.P37_19V_MODE;
 if(![MODE_AUTH,MODE_RACE].includes(mode))fail('EXPLICIT_VERIFICATION_MODE_REQUIRED');
 if(env.P37_19V_URL!==URL||env.P37_19V_TARGET_CASE_ID!==CASE_ID)
  fail('WRONG_PROJECT_OR_STAGING_CASE_BLOCKED');
 if(env.P37_19V_PRODUCTION_APPROVAL==='YES'||env.P37_19V_ALLOW_MAIN==='YES'||
    env.P37_19V_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY)
  fail('REAL_PRODUCTION_OR_ADMIN_SECRET_NOT_PERMITTED');
 const key=env.P37_19V_PUBLISHABLE_KEY;
 const email=env.P37_19V_TEST_EMAIL,password=env.P37_19V_TEST_PASSWORD;
 const base={url:URL,key,email,password};
 if(mode===MODE_AUTH) {
  const valid=hConfig({
   P37_19H_MODE:'AUTH_READ_ONLY_LAB_ONLY',
   P37_19H_URL:URL,
   P37_19H_PUBLISHABLE_KEY:key,
   P37_19H_TEST_EMAIL:email,
   P37_19H_TEST_PASSWORD:password
  });
  return Object.freeze({mode,base:valid,details:scrub({mode})});
 }
 if(env.P37_19V_STAGING_COMMITTED!=='YES_VERIFIED_BY_ADMIN'||
    env.P37_19V_CLEANUP_OPERATOR_READY!=='YES'||
    env.P37_19V_ZERO_DATA_PRECHECK!=='CONFIRMED_BEFORE_STAGE')
  fail('REAL_ADMIN_STAGE_AND_EXACT_CLEANUP_MUST_BE_READY');
 const valid=gConfig({
   P37_19G_ALLOW_REMOTE_TEST:'YES_LAB_ONLY',
   P37_19G_ADMIN_CLEANUP_READY:'YES',
   P37_19G_STAGE_PREVERIFIED:'YES',
   P37_19G_URL:URL,
   P37_19G_FIXTURE_ID:CASE_ID,
   P37_19G_PUBLISHABLE_KEY:key,
   P37_19G_TEST_EMAIL:email,
   P37_19G_TEST_PASSWORD:password
 });
 return Object.freeze({mode,base:valid,details:scrub({mode})});
}
export async function run(cfg,fetchFn=globalThis.fetch){
 if(!cfg||![MODE_AUTH,MODE_RACE].includes(cfg.mode)||
    cfg.base?.url!==URL||typeof fetchFn!=='function')
  fail('TEST_LAB_CONFIG_REQUIRED');
 // The caller must never misreport a fake HTTP harness as real Auth/RPC proof.
 const mocked=fetchFn!==globalThis.fetch;
 if(cfg.mode===MODE_AUTH){
  const result=await hPreflight(cfg.base,fetchFn);
  if(result.status!=='P37_19H_AUTH_ONLY_PRECHECK_PASS'||
     result.separateSessions!==2||result.revokedSessions!==2||
     result.observedLabCases!==0||result.observedLabAllowances!==0||
     result.realAllowanceRpcCalls!==0||result.productionCloudWrites!==0)
   fail('SIGNED_READONLY_PREFLIGHT_INCOMPLETE');
  return Object.freeze({
   status:mocked?'MOCK_AUTH_PREFLIGHT_NOT_LIVE_EVIDENCE':
     'LAB_SIGNED_AUTH_READ_ONLY_PREFLIGHT_PASS',
   authenticatedPairVerified:!mocked,
   signedHttpRpcConcurrentRaceVerified:false,
   labRecordsObserved:0,allowancesObserved:0,sessionsRevoked:2,
   adminCleanupRequired:false,
   officialERPDataTouched:false,formalERPWrites:0,
   productionReleaseAllowed:false,canPost:false
  });
 }
 const result=await gExecute(cfg.base,fetchFn);
 if(result.status!=='LAB_HTTP_RPC_RACE_PASS'||
    result.clients!==2||result.winners!==1||result.conflicts!==1||
    result.realDistinctAuthSessionsPrechecked!==true||
    result.formalErpWrites!==0||result.cleanupVerified!==false||
    result.adminCleanupRequired!==true)
   fail('RACE_OR_CLEANUP_STATE_UNVERIFIED');
 return Object.freeze({
  status:mocked?'MOCK_RPC_RACE_ADMIN_CLEANUP_NOT_REAL':
    'LAB_SIGNED_RPC_RACE_PROVISIONAL_ADMIN_CLEANUP_REQUIRED',
  authenticatedPairVerified:!mocked,
  signedHttpRpcConcurrentRaceVerified:!mocked,
  winners:1,conflicts:1,
  sessionsRevokedByUnderlyingRunner:true,
  adminCleanupRequired:true,
  cleanupVerified:false,
  officialERPDataTouched:false,formalERPWrites:0,
  productionReleaseAllowed:false,canPost:false
 });
}
export const MODE=Object.freeze({AUTH:MODE_AUTH,RACE:MODE_RACE});
export const TARGET=Object.freeze({url:URL,id:CASE_ID});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const cfg=config(process.env),result=await run(cfg);
  // Only sanitized status, never configuration, personal identifiers or tokens.
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.adminCleanupRequired){
   process.stderr.write('P37-19V EXACT LAB ADMIN CLEANUP REQUIRED: check 0 cases and 0 allowances afterward.\n');
   process.exitCode=2; // even an actual HTTP race is NOT a final cleanup PASS
  }
 }catch(_){
  process.stderr.write('P37-19V BLOCKED/NOT VERIFIED. Check test-only environment; if a case was staged, execute exact lab admin cleanup.\n');
  process.exitCode=1;
 }
}
