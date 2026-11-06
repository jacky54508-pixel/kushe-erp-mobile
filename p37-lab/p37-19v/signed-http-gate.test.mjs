import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {config,run,MODE,TARGET} from './signed-http-gate.mjs';

const URL='https://ldktrfgzzzmklhsnfrol.supabase.co';
const CASE='00000000-0000-4000-8000-000000019019';
const USER='00000000-0000-4000-8000-000000000099';
const KEY='sb_publishable_SYNTHETIC_TEST_NOT_REAL_KEY';
const EMAIL='lab-fixture@example.invalid';
const PASSWORD='SYNTHETIC_PASSWORD_NEVER_REAL';
const clone=x=>JSON.parse(JSON.stringify(x));
function env(mode=MODE.AUTH){
 return {P37_19V_MODE:mode,P37_19V_CONFIRM_PROJECT:'KUSHE_AUTH_LAB_ONLY',
 P37_19V_URL:URL,P37_19V_TARGET_CASE_ID:CASE,
 P37_19V_PUBLISHABLE_KEY:KEY,P37_19V_TEST_EMAIL:EMAIL,
 P37_19V_TEST_PASSWORD:PASSWORD};
}
function raceEnv(){
 return {...env(MODE.RACE),
  P37_19V_STAGING_COMMITTED:'YES_VERIFIED_BY_ADMIN',
  P37_19V_CLEANUP_OPERATOR_READY:'YES',
  P37_19V_ZERO_DATA_PRECHECK:'CONFIRMED_BEFORE_STAGE'};
}
function response(data,status=200){
 return status===204?new Response(null,{status}):
   new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
}
const sid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function token(n){
 const p={iss:URL+'/auth/v1',aud:'authenticated',role:'authenticated',
  is_anonymous:false,sub:USER,session_id:sid(n),exp:Math.floor(Date.now()/1000)+3600};
 return ['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify(p)).toString('base64url'),
   'synthetic-invalid-signature-not-real-auth'].join('.');
}
function mockClient({race=false,forceSameSession=false}={}){
 const events=[],credentials=new Set([token(1),token(forceSameSession?1:2)]);
 let logged=0,posts=0,sessionLogouts=0,revision=0;
 const state=()=>({events:clone(events),logged,posts,sessionLogouts,revision});
 const fetcher=async (url,options={})=>{
  const target=new globalThis.URL(url);
  assert.equal(target.origin,URL);
  events.push({method:options.method||'GET',pathname:target.pathname,query:target.search});
  const method=options.method||'GET',pathname=target.pathname;
  if(pathname==='/auth/v1/token'&&method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.email,EMAIL);assert.equal(body.password,PASSWORD);
   logged++;
   return response({access_token:token(forceSameSession?1:logged),
    user:{id:USER}});
  }
  const access=String(options.headers?.Authorization||'').replace(/^Bearer /,'');
  assert.ok(credentials.has(access),'unexpected mock JWT');
  if(pathname==='/auth/v1/user'&&method==='GET')return response({id:USER,is_anonymous:false});
  if(pathname==='/auth/v1/logout'&&method==='POST'){
   sessionLogouts++;
   return response(null,204);
  }
  if(pathname==='/rest/v1/p37_lab_members'&&method==='GET')
   return response([{user_id:USER,enabled:true}]);
  if(pathname==='/rest/v1/p37_lab_cases'&&method==='GET'){
   if(!race)return response([]);
   return response([{id:CASE,owner_id:USER,case_no:'P37-9B-TEST-P37-19G-CLEANUP-20261105',
     invoice_no:'P37-9B-INV-P37-19G-CLEANUP-20261105',revision,
     original_untaxed:1248000,original_tax:62400,original_gross:1310400,
     original_receivable:1185600,original_retention:124800}]);
  }
  if(pathname==='/rest/v1/p37_lab_allowances'&&method==='GET'){
   if(!race||revision===0)return response([]);
   return response([{case_id:CASE,idempotency_key:'P37-9B-IDEMP-'+CASE,
    discount_gross:27300,receivable_reduction:24700,retention_reduction:2600}]);
  }
  if(pathname==='/rest/v1/rpc/p37_lab_apply_synthetic_allowance'&&race&&method==='POST'){
   const payload=JSON.parse(options.body);
   assert.equal(payload.p_case_id,CASE);assert.equal(payload.p_expected_revision,0);
   assert.equal(payload.p_failpoint,null);
   posts++;
   if(revision!==0)return response({message:'P37_LAB_DUPLICATE_OR_VERSION_CONFLICT'},409);
   revision=1;
   return response({status:'P37_LAB_TEST_COMMITTED_ONLY',
    discount_gross:27300,effective_gross:1283100,
    effective_receivable:1160900,effective_retention:122200,
    official_erp_posted:false},200);
  }
  throw Error('UNEXPECTED_MOCK_ROUTE_'+pathname);
 };
 return {fetcher,state};
}
test('run configuration must be an explicit non-production mode and exact lab project',()=>{
 assert.equal(TARGET.url,URL);assert.equal(TARGET.id,CASE);
 const cases=[
  {},{P37_19V_MODE:MODE.AUTH},
  {...env(),P37_19V_URL:'https://jimcybsztnwfzrnvexsp.supabase.co'},
  {...env(),P37_19V_TARGET_CASE_ID:'different'},
  {...env(),P37_19V_MODE:'RUN_IN_PRODUCTION'},
  {...env(),P37_19V_CONFIRM_PROJECT:'NO'},
  {...env(),P37_19V_PRODUCTION_APPROVAL:'YES'},
  {...env(),SUPABASE_SERVICE_ROLE_KEY:'forbidden'},
  {...env(),P37_19V_PUBLISHABLE_KEY:'sb_secret_notAllowed'},
  {...env(),P37_19V_TEST_PASSWORD:''}
 ];
 for(const item of cases)assert.throws(()=>config(item),/P37-19[VH] /);
});
test('attempted remote staging is blocked absent exact administrator confirmation',()=>{
 for(const key of ['P37_19V_STAGING_COMMITTED','P37_19V_CLEANUP_OPERATOR_READY',
 'P37_19V_ZERO_DATA_PRECHECK']){
  const options=raceEnv();delete options[key];
  assert.throws(()=>config(options),/P37-19V REAL_ADMIN_STAGE_AND_EXACT_CLEANUP/);
 }
 assert.equal(config(env()).mode,MODE.AUTH);
 assert.equal(config(raceEnv()).mode,MODE.RACE);
});
test('read-only two signed HTTP session protocol is mock-tested, never mislabeled live',async()=>{
 const cf=config(env()),{fetcher,state}=mockClient();
 const v=await run(cf,fetcher),t=state();
 assert.equal(v.status,'MOCK_AUTH_PREFLIGHT_NOT_LIVE_EVIDENCE');
 assert.equal(v.authenticatedPairVerified,false);
 assert.equal(v.signedHttpRpcConcurrentRaceVerified,false);
 assert.equal(v.labRecordsObserved,0);
 assert.equal(v.allowancesObserved,0);
 assert.equal(v.sessionsRevoked,2);
 assert.equal(v.adminCleanupRequired,false);
 assert.equal(v.productionReleaseAllowed,false);
 assert.equal(v.canPost,false);
 assert.equal(t.logged,2);
 assert.equal(t.sessionLogouts,2);
 assert.equal(t.posts,0);
 assert.ok(!t.events.some(e=>e.pathname.includes('/rpc/')));
});
test('two JWTs sharing same session id fail and both signouts still occur',async()=>{
 const cf=config(env()),{fetcher,state}=mockClient({forceSameSession:true});
 await assert.rejects(run(cf,fetcher),/P37-19H (?:NOT_TWO_INDEPENDENT_AUTH_SESSIONS|TWO_DISTINCT_TOKENS_REQUIRED)/);
 const s=state();assert.equal(s.logged,2);assert.equal(s.sessionLogouts,2);
 assert.equal(s.posts,0);
});
test('same staged row, two independent mock signed HTTP RPCs: exactly one accepted',async()=>{
 const cf=config(raceEnv()),{fetcher,state}=mockClient({race:true});
 const result=await run(cf,fetcher),events=state();
 assert.equal(result.status,'MOCK_RPC_RACE_ADMIN_CLEANUP_NOT_REAL');
 assert.equal(result.winners,1);assert.equal(result.conflicts,1);
 assert.equal(result.authenticatedPairVerified,false);
 assert.equal(result.signedHttpRpcConcurrentRaceVerified,false);
 assert.equal(result.adminCleanupRequired,true);
 assert.equal(result.cleanupVerified,false);
 assert.equal(result.productionReleaseAllowed,false);
 assert.equal(result.canPost,false);
 assert.equal(result.formalERPWrites,0);
 assert.equal(events.logged,2);assert.equal(events.sessionLogouts,2);
 assert.equal(events.posts,2);assert.equal(events.revision,1);
});
test('live lab read-only observation must not be promoted into JWT or real RPC acceptance',()=>{
 const pathName=path.resolve(import.meta.dirname,'live-lab-readonly-observation.json');
 const d=JSON.parse(fs.readFileSync(pathName,'utf8'));
 assert.equal(d.isolatedSupabaseProject,'ldktrfgzzzmklhsnfrol');
 assert.deepEqual(d.tablesRlsEnabled,{
   p37_lab_members:true,p37_lab_cases:true,p37_lab_allowances:true
 });
 assert.equal(d.remainingSyntheticCases,0);
 assert.equal(d.remainingSyntheticAllowances,0);
 assert.equal(d.enabledTestMembers,1);
 assert.equal(d.existingAuthSessionRows,2);
 assert.equal(d.distinctAuthSessionRowIds,2);
 assert.deepEqual(d.authenticatedCaseTableUpdateColumns,['revision']);
 assert.equal(d.authenticatedMayExecuteRPC,true);
 assert.equal(d.anonMayExecuteRPC,false);
 assert.equal(d.rpcIsSecurityInvoker,true);
 assert.equal(d.jwtTokensObtained,false);
 assert.equal(d.sessionIdClaimsCompared,false);
 assert.equal(d.distinctSignedUsersVerifiedByAuthApi,false);
 assert.equal(d.actualSignedHttpRpcRacesExecuted,false);
 assert.equal(d.adminCleanupAfterRealSignedHttpRaceVerified,false);
 assert.equal(d.formalERPPostingEnabled,false);
 assert.equal(d.productionReleaseAllowed,false);
});
test('module imports only existing signed-Auth and signed-RPC guarded code',()=>{
 const pathName=path.resolve(import.meta.dirname,'signed-http-gate.mjs');
 const src=fs.readFileSync(pathName,'utf8');
 const imports=[...src.matchAll(/from '([^']+)'/g)].map(m=>m[1]);
 assert.deepEqual(imports,['node:url','../p37-19h/verified-sessions.mjs',
  '../p37-19g/dual-client-rpc.mjs']);
 assert.match(src,/process\.exitCode=2/);
 assert.doesNotMatch(src,/https:\/\/jimcybsztnwfzrnvexsp\.supabase\.co/);
 assert.doesNotMatch(src,/service_role.*'Bearer|console\.log\((?:cfg|env|password|token)/);
 assert.doesNotMatch(src,/\b(?:CREATE TABLE|GRANT ALL|SECURITY DEFINER|DELETE FROM|DROP TABLE)\b/i);
});
