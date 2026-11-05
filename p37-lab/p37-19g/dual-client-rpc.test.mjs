import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {config,execute} from './dual-client-rpc.mjs';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const makeJwt=(subject,session)=>encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'https://ldktrfgzzzmklhsnfrol.supabase.co/auth/v1',sub:subject,session_id:session,aud:'authenticated',role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600})+'.SYNTHETIC_TEST_SIGNATURE';
const dir=import.meta.dirname;
function env(){
 return {P37_19G_ALLOW_REMOTE_TEST:'YES_LAB_ONLY',P37_19G_ADMIN_CLEANUP_READY:'YES',
  P37_19G_STAGE_PREVERIFIED:'YES',
  P37_19G_URL:'https://ldktrfgzzzmklhsnfrol.supabase.co',
  P37_19G_FIXTURE_ID:'00000000-0000-4000-8000-000000019019',
  P37_19G_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_TEST',
  P37_19G_TEST_EMAIL:'synthetic@example.invalid',
  P37_19G_TEST_PASSWORD:'synthetic-test-password'};
}
test('no real remote call by default; wrong project and secret keys denied',()=>{
 assert.throws(()=>config({}),/APPROVAL/);
 for(const k of ['P37_19G_ALLOW_REMOTE_TEST','P37_19G_ADMIN_CLEANUP_READY','P37_19G_STAGE_PREVERIFIED']){
  const e=env();delete e[k];assert.throws(()=>config(e),/APPROVAL/);
 }
 assert.throws(()=>config({...env(),P37_19G_URL:'https://jimcybsztnwfzrnvexsp.supabase.co'}),/WRONG_LAB/);
 assert.throws(()=>config({...env(),P37_19G_PUBLISHABLE_KEY:'sb_secret_hazard'}),/INVALID_PUBLISHABLE/);
 assert.throws(()=>config({...env(),P37_19G_FIXTURE_ID:'another'}),/WRONG_LAB/);
});
test('staging and cleanup are manual, exact one-row, and make no permission changes',()=>{
 const stage=fs.readFileSync(path.join(dir,'stage-fixture.sql'),'utf8');
 const cleanup=fs.readFileSync(path.join(dir,'cleanup-fixture.sql'),'utf8');
 for(const q of [stage,cleanup]){
  assert.match(q,/ldktrfgzzzmklhsnfrol/);
  assert.match(q,/00000000-0000-4000-8000-000000019019/);
  assert.match(q,/P37-9B-TEST-P37-19G-CLEANUP-20261105/);
  assert.match(q,/COMMIT;/);
  assert.doesNotMatch(q,/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\s/mi);
  assert.doesNotMatch(q,/jimcybsztnwfzrnvexsp/);
 }
 assert.match(cleanup,/DELETE FROM public.p37_lab_allowances/);
 assert.match(cleanup,/DELETE FROM public.p37_lab_cases/);
 assert.match(cleanup,/FOREIGN_ROWS_PRESENT_NO_CLEANUP/);
 const root=path.join(dir,'../..');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.doesNotMatch(store,/p37-19g/i);
 assert.doesNotMatch(index,/p37-19g/i);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
});
test('mock concurrent HTTP behavior tests one winner, one rejected duplicate without network',async()=>{
 const cfg=config(env());
 const testId='00000000-0000-4000-8000-000000019019';
 let signIns=0,logouts=0,revision=0,allowances=[];
 const record={id:testId,owner_id:'e6a1e159-9474-4a67-a0b4-c4718cd831b2',case_no:'P37-9B-TEST-P37-19G-CLEANUP-20261105',
  invoice_no:'P37-9B-INV-P37-19G-CLEANUP-20261105',revision:0,original_untaxed:1248000,
  original_tax:62400,original_gross:1310400,original_receivable:1185600,original_retention:124800};
 const reply=(status,value)=>({ok:status>=200&&status<300,status,json:async()=>value});
 async function mockFetch(url,options={}){
  const u=String(url);
  if(u.endsWith('/auth/v1/token?grant_type=password')){
    signIns++;
    const session=signIns===1?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    return reply(200,{access_token:makeJwt(record.owner_id,session),user:{id:record.owner_id}});
  }
  if(u.endsWith('/auth/v1/user'))return reply(200,{id:record.owner_id,is_anonymous:false});
  if(u.includes('/rest/v1/p37_lab_members?'))return reply(200,[{user_id:record.owner_id,enabled:true}]);
  if(u.endsWith('/auth/v1/logout')){logouts++;return reply(204,null)}
  if(u.includes('/rest/v1/p37_lab_cases?'))return reply(200,[{...record,revision}]);
  if(u.includes('/rest/v1/p37_lab_allowances?'))return reply(200,[...allowances]);
  if(u.endsWith('/rest/v1/rpc/p37_lab_apply_synthetic_allowance')){
   const body=JSON.parse(options.body);
   assert.equal(body.p_case_id,testId);
   if(revision===1)return reply(400,{message:'P37_LAB_DUPLICATE_OR_VERSION_CONFLICT'});
   revision=1;
   allowances=[{case_id:testId,idempotency_key:'P37-9B-IDEMP-'+testId,discount_gross:27300,receivable_reduction:24700,retention_reduction:2600}];
   return reply(200,{status:'P37_LAB_TEST_COMMITTED_ONLY',official_erp_posted:false,
    discount_gross:27300,effective_gross:1283100,effective_receivable:1160900,effective_retention:122200});
  }
  throw new Error('MOCK_REQUEST_WENT_TO_UNEXPECTED_ENDPOINT');
 }
 const result=await execute(cfg,mockFetch);
 assert.equal(result.winners,1);
 assert.equal(result.conflicts,1);
 assert.equal(result.cleanupVerified,false);
 assert.equal(result.adminCleanupRequired,true);
 assert.equal(signIns,2);
 assert.equal(logouts,2);
 assert.equal(result.realDistinctAuthSessionsPrechecked,true);
});
