import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configuration,execute,MODE,TARGET} from './operator-cli.mjs';
const LAB='https://ldktrfgzzzmklhsnfrol.supabase.co';
const ID='00000000-0000-4000-8000-000000019019';
const USER='00000000-0000-4000-8000-000000000099';
const fakeEmail='fake-lab-user@example.invalid';
const fakePassword='NOT_A_REAL_PASSWORD';
const fakeKey='sb_publishable_NOT_REAL_MOCK_ONLY_0001';
function env(phase=MODE.AUTH){
 const values={
  P37_19W_PHASE:phase,P37_19W_PROJECT_CONFIRM:'KUSHE_AUTH_LAB_ONLY',
  P37_19W_TEST_URL:LAB,P37_19W_CASE_ID:ID,
  P37_19W_TEST_PUBLISHABLE_KEY:fakeKey,
  P37_19W_TEST_EMAIL:fakeEmail,P37_19W_TEST_PASSWORD:fakePassword
 };
 if(phase===MODE.RACE)Object.assign(values,{
  P37_19W_SIGNED_PREFLIGHT_ALREADY_SUCCEEDED:'YES_ON_DEDICATED_TEST_ACCOUNT',
  P37_19W_STAGED_CASE_CONFIRMED:'YES_ADMIN_COMMITTED_EXACT_CASE',
  P37_19W_CLEANUP_OPERATOR_READY:'YES_OPERATOR_WILL_CLEAN',
  P37_19W_PRESTAGE_ZERO_CONFIRMED:'YES_ZERO_CASES_AND_ALLOWANCES'
 });
 if(phase===MODE.CLEAN)values.P37_19W_ADMIN_CLEANUP_COMMITTED='YES_EXACT_ADMIN_SQL_ALREADY_DONE';
 return values;
}
function reply(data,status=200){
 if(status===204)return new Response(null,{status});
 return new Response(JSON.stringify(data),{status,
  headers:{'Content-Type':'application/json'}});
}
function jwt(n){
 const claim={iss:LAB+'/auth/v1',role:'authenticated',aud:'authenticated',
  is_anonymous:false,sub:USER,
  session_id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),
  exp:Math.floor(Date.now()/1000)+3600};
 return 'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claim)).toString('base64url')+
  '.MOCK_NOT_A_VALID_SIGNATURE';
}
function mockNetwork({race=false,identicalSessions=false}={}){
 let logins=0,logouts=0,rpc=0,rev=0;
 const events=[];
 const fetcher=async(url,options={})=>{
  const u=new globalThis.URL(url),name=u.pathname,method=options.method||'GET';
  assert.equal(u.origin,LAB);
  events.push(name+':'+method);
  if(name==='/auth/v1/token'&&method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.email,fakeEmail);
   assert.equal(body.password,fakePassword);
   logins++;
   return reply({access_token:jwt(identicalSessions?1:logins),user:{id:USER}});
  }
  const token=String(options.headers?.Authorization||'').slice(7);
  assert.ok([jwt(1),jwt(2)].includes(token),'unknown mock bearer');
  if(name==='/auth/v1/user')return reply({id:USER,is_anonymous:false});
  if(name==='/auth/v1/logout'){
   logouts++;
   return reply(null,204);
  }
  if(name==='/rest/v1/p37_lab_members')return reply([{user_id:USER,enabled:true}]);
  if(name==='/rest/v1/p37_lab_cases'){
   if(!race)return reply([]);
   return reply([{id:ID,owner_id:USER,case_no:'P37-9B-TEST-P37-19G-CLEANUP-20261105',
    invoice_no:'P37-9B-INV-P37-19G-CLEANUP-20261105',revision:rev,
    original_untaxed:1248000,original_tax:62400,original_gross:1310400,
    original_receivable:1185600,original_retention:124800}]);
  }
  if(name==='/rest/v1/p37_lab_allowances'){
   if(!race||rev===0)return reply([]);
   return reply([{case_id:ID,idempotency_key:'P37-9B-IDEMP-'+ID,
    discount_gross:27300,receivable_reduction:24700,retention_reduction:2600}]);
  }
  if(name==='/rest/v1/rpc/p37_lab_apply_synthetic_allowance'&&race&&method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.p_case_id,ID);
   assert.equal(body.p_expected_revision,0);
   rpc++;
   if(rev!==0)return reply({message:'P37_LAB_DUPLICATE_OR_VERSION_CONFLICT'},409);
   rev=1;
   return reply({status:'P37_LAB_TEST_COMMITTED_ONLY',
    discount_gross:27300,effective_gross:1283100,
    effective_receivable:1160900,effective_retention:122200,
    official_erp_posted:false},200);
  }
  throw Error('UNEXPECTED_TEST_HTTP_ENDPOINT_'+name);
 };
 return {fetcher,get:()=>({logins,logouts,rpc,rev,events})};
}
test('explicit lab-only stage and cleanup controls forbid ambiguous or production intent',()=>{
 assert.equal(TARGET.origin,LAB);
 assert.equal(TARGET.caseId,ID);
 for(const wrong of [
  {},{...env(),P37_19W_TEST_URL:'https://jimcybsztnwfzrnvexsp.supabase.co'},
  {...env(),P37_19W_CASE_ID:'another'},
  {...env(),P37_19W_PROJECT_CONFIRM:'NOT_APPROVED'},
  {...env(),P37_19W_PHASE:'RELEASE_MAIN'},
  {...env(),P37_19W_ALLOW_MAIN:'YES'},
  {...env(),P37_19W_ADMIN_SECRET:'secret-not-allowed'},
  {...env(),SUPABASE_SERVICE_ROLE_KEY:'secret-not-allowed'},
  {...env(),P37_19W_TEST_PASSWORD:''}
 ])assert.throws(()=>configuration(wrong),/P37-19/);
});
test('no staged race without signed preflight and admin cleanup approvals',()=>{
 const fields=[
  'P37_19W_SIGNED_PREFLIGHT_ALREADY_SUCCEEDED',
  'P37_19W_STAGED_CASE_CONFIRMED',
  'P37_19W_CLEANUP_OPERATOR_READY',
  'P37_19W_PRESTAGE_ZERO_CONFIRMED'];
 for(const field of fields){
  const options=env(MODE.RACE);
  delete options[field];
  assert.throws(()=>configuration(options),/P37-19W PRIOR_AUTH_STAGING_AND_CLEANUP_APPROVAL_REQUIRED/);
 }
 assert.throws(()=>configuration({
  ...env(MODE.CLEAN),P37_19W_ADMIN_CLEANUP_COMMITTED:'NO'
 }),/P37-19W POSTCLEANUP_CANNOT_START_WITHOUT_ADMIN_SQL/);
});
test('mock signed preflight protocol: 2 token logins, real Auth handlers mocked, both revoked',async()=>{
 const transport=mockNetwork();
 const result=await execute(configuration(env()),transport.fetcher);
 assert.equal(result.status,'MOCK_AUTH_ONLY_NOT_SIGNED');
 assert.equal(result.liveAuthProven,false);
 assert.equal(result.verifiedFinalAcceptance,false);
 assert.equal(result.productionReleaseAllowed,false);
 assert.equal(result.canPost,false);
 assert.equal(result.adminCleanupIndependentlyVerified,false);
 assert.equal(result.adminCleanupRequired,false);
 assert.equal(transport.get().logins,2);
 assert.equal(transport.get().logouts,2);
 assert.equal(transport.get().rpc,0);
});
test('same mock JWT must not pass two independent signed session gate',async()=>{
 const transport=mockNetwork({identicalSessions:true});
 await assert.rejects(execute(configuration(env()),transport.fetcher),
  /P37-19H TWO_DISTINCT_TOKENS_REQUIRED/);
 assert.equal(transport.get().logins,2);
 assert.equal(transport.get().logouts,2);
 assert.equal(transport.get().rpc,0);
});
test('two mock signed RPC race attempts produce one winner/one conflict but never final PASS',async()=>{
 const transport=mockNetwork({race:true});
 const res=await execute(configuration(env(MODE.RACE)),transport.fetcher);
 assert.equal(res.status,'MOCK_RACE_NOT_SIGNED');
 assert.equal(res.rpcWinnerCount,1);
 assert.equal(res.rpcConflictCount,1);
 assert.equal(res.adminCleanupRequired,true);
 assert.equal(res.adminPostcheckPending,true);
 assert.equal(res.liveAuthProven,false);
 assert.equal(res.liveRpcProvenBeforeAdminCleanup,false);
 assert.equal(res.canPost,false);
 assert.equal(res.productionReleaseAllowed,false);
 assert.equal(transport.get().logins,2);
 assert.equal(transport.get().logouts,2);
 assert.equal(transport.get().rpc,2);
 assert.equal(transport.get().rev,1);
});
test('postcleanup is still a signed RLS-only 0/0 check; not a DB admin attestation',async()=>{
 const transport=mockNetwork();
 const r=await execute(configuration(env(MODE.CLEAN)),transport.fetcher);
 assert.equal(r.status,'MOCK_AUTH_ONLY_NOT_SIGNED');
 assert.equal(r.mustVerifyAdminSql,true);
 assert.equal(r.adminCleanupIndependentlyVerified,false);
 assert.equal(r.verifiedFinalAcceptance,false);
 assert.equal(r.canPost,false);
 assert.equal(transport.get().rpc,0);
});
test('operator script has no admin SQL mutation and always exits 2 after provisional RPC',()=>{
 const text=fs.readFileSync(new globalThis.URL('./operator-cli.mjs',import.meta.url),'utf8');
 const imports=[...text.matchAll(/from '([^']+)'/g)].map(x=>x[1]);
 assert.deepEqual(imports,['node:url','../p37-19v/signed-http-gate.mjs']);
 assert.match(text,/process\.exitCode=2/);
 assert.match(text,/P37_19W_ADMIN_CLEANUP_COMMITTED/);
 assert.doesNotMatch(text,/\b(?:DELETE FROM|INSERT INTO|UPDATE public|CREATE TABLE|service_role\+|console\.log\(cfg)/i);
 assert.ok(!text.includes('jimcybsztnwfzrnvexsp.supabase.co'));
});
