import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {config,verifyPair,preflight} from './verified-sessions.mjs';
const LAB='https://ldktrfgzzzmklhsnfrol.supabase.co';
const USER='e6a1e159-9474-4a67-a0b4-c4718cd831b2';
const SID1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SID2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function token(session=SID1,patch={}){
 const claims={iss:LAB+'/auth/v1',role:'authenticated',aud:'authenticated',
  sub:USER,session_id:session,exp:Math.floor(Date.now()/1000)+3600,is_anonymous:false,...patch};
 return encode({alg:'HS256',typ:'JWT'})+'.'+encode(claims)+'.SYNTHETIC_SIGN_NOT_VALID';
}
function env(){return {P37_19H_MODE:'AUTH_READ_ONLY_LAB_ONLY',P37_19H_URL:LAB,
 P37_19H_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_READONLY_TEST',
 P37_19H_TEST_EMAIL:'test@example.invalid',P37_19H_TEST_PASSWORD:'SYNTHETIC_TEST_PASSWORD'}}
function mock(opts={}){
 let loginCount=0,logoutCount=0;const requests=[];
 const reply=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
 async function fetcher(url,init={}){
  const u=new URL(url),route=u.pathname,method=init.method||'GET';
  requests.push({path:route,method});
  if(u.origin!==LAB)throw new Error('ESCAPED_TEST_PROJECT');
  if(route==='/auth/v1/token'&&method==='POST'){
   loginCount++;
   if(opts.secondLoginFailure&&loginCount===2)return reply(400,{code:'invalid_grant'});
   return reply(200,{access_token:token(opts.sameSession?SID1:loginCount===1?SID1:SID2,
       opts.wrongSub?{sub:'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'}:{}),
    user:{id:USER}});
  }
  if(route==='/auth/v1/user'&&method==='GET'){
   if(opts.userApiFailure)return reply(401,{msg:'expired'});
   return reply(200,{id:opts.wrongUserApi?'ffffffff-ffff-4fff-8fff-ffffffffffff':USER,is_anonymous:false});
  }
  if(route==='/auth/v1/logout'&&method==='POST'){
   logoutCount++;
   if(opts.logoutFailure)return reply(500,{msg:'server error'});
   return reply(204,null);
  }
  if(route==='/rest/v1/p37_lab_members'&&method==='GET')
   return reply(200,opts.missingMembership?[]:[{user_id:USER,enabled:true}]);
  if(route==='/rest/v1/p37_lab_cases'&&method==='GET')
   return reply(200,opts.stagedCase?[{id:'FAKE-CASE'}]:[]);
  if(route==='/rest/v1/p37_lab_allowances'&&method==='GET')
   return reply(200,opts.stagedAllowance?[{id:'FAKE-ALLOWANCE'}]:[]);
  throw new Error('NETWORK_PATH_FORBIDDEN');
 }
 return {fetcher,requests,get logins(){return loginCount},get logouts(){return logoutCount}};
}
test('read-only CLI fails closed without explicit lab-only mode, credentials or publishable key',()=>{
 assert.throws(()=>config({}),/MODE_REQUIRED/);
 assert.throws(()=>config({...env(),P37_19H_URL:'https://jimcybsztnwfzrnvexsp.supabase.co'}),/PRODUCTION_URL/);
 assert.throws(()=>config({...env(),P37_19H_PUBLISHABLE_KEY:'sb_secret_oops'}),/PUBLISHABLE_KEY/);
 assert.throws(()=>config({...env(),P37_19H_TEST_PASSWORD:''}),/CREDENTIALS_REQUIRED/);
});
test('two distinct mock sessions pass server validation and are both revoked, no business writes',async()=>{
 const fake=mock(),result=await preflight(config(env()),fake.fetcher);
 assert.equal(result.status,'P37_19H_AUTH_ONLY_PRECHECK_PASS');
 assert.equal(result.separateSessions,2);assert.equal(result.revokedSessions,2);
 assert.equal(result.realAllowanceRpcCalls,0);assert.equal(result.formalERPWrites,0);
 assert.equal(result.canPost,false);assert.equal(fake.logins,2);assert.equal(fake.logouts,2);
 assert.ok(fake.requests.every(x=>['/auth/v1/token','/auth/v1/user','/auth/v1/logout',
   '/rest/v1/p37_lab_members','/rest/v1/p37_lab_cases','/rest/v1/p37_lab_allowances'].includes(x.path)));
 assert.ok(fake.requests.every(x=>x.method==='GET'||x.method==='POST'));
 assert.ok(fake.requests.filter(x=>x.method==='POST').every(x=>x.path==='/auth/v1/token'||x.path==='/auth/v1/logout'));
 assert.ok(!JSON.stringify(result).includes('password'));
 assert.ok(!JSON.stringify(result).includes(USER));
});
test('two tokens from the same Auth session are rejected and revoked',async()=>{
 const fake=mock({sameSession:true});
 await assert.rejects(preflight(config(env()),fake.fetcher),/INDEPENDENT_AUTH_SESSIONS/);
 assert.equal(fake.logouts,2);
});
test('invalid user, absent allowlist and invalid JWT principal fail closed',async()=>{
 for(const options of [{wrongUserApi:true},{missingMembership:true},{wrongSub:true},{userApiFailure:true}]){
  const fake=mock(options);
  await assert.rejects(preflight(config(env()),fake.fetcher),/NOT_CONFIRMED|INDEPENDENT_AUTH_SESSIONS/);
  assert.equal(fake.logouts,2);
 }
});
test('pre-existing lab case or allowance blocks read-only acceptance and signs out',async()=>{
 for(const options of [{stagedCase:true},{stagedAllowance:true}]){
  const fake=mock(options);
  await assert.rejects(preflight(config(env()),fake.fetcher),/LAB_NOT_EMPTY/);
  assert.equal(fake.logouts,2);
 }
});
test('when second login fails, first session is still revoked',async()=>{
 const fake=mock({secondLoginFailure:true});
 await assert.rejects(preflight(config(env()),fake.fetcher),/BOTH_LAB_SESSIONS/);
 assert.equal(fake.logouts,1);
});
test('any failed Auth logout blocks PASS, even after successful read-only checks',async()=>{
 const fake=mock({logoutFailure:true});
 await assert.rejects(preflight(config(env()),fake.fetcher),/SIGNOUT_INCOMPLETE/);
 assert.equal(fake.logouts,2);
});
test('stale and malformed JWT claims cannot pass the separate-session proof',async()=>{
 const mocker=mock(),cfg=config(env());
 for(const bad of [
  token(SID1,{exp:Math.floor(Date.now()/1000)+20}),
  token(SID1,{role:'anon'}),
  token(SID1,{iss:'https://jimcybsztnwfzrnvexsp.supabase.co/auth/v1'}),
  token(SID1,{is_anonymous:true})
 ]){
  await assert.rejects(verifyPair(cfg,mocker.fetcher,{token:bad,userId:USER},{token:token(SID2),userId:USER}),/JWT_/);
 }
});
test('this new stage cannot silently mount to ERP, publish main, or trigger live RPC in CI',()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const src=fs.readFileSync(path.join(import.meta.dirname,'verified-sessions.mjs'),'utf8');
 const ci=fs.readFileSync(path.join(root,'.github/workflows/p37-19h-readonly-auth.yml'),'utf8');
 assert.doesNotMatch(html,/p37-19h/);
 assert.doesNotMatch(store,/p37-19h/);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.doesNotMatch(src,/\/rest\/v1\/rpc\/p37_lab_apply_synthetic_allowance/);
 assert.doesNotMatch(ci,/P37_19H_TEST_PASSWORD|supabase\.co|run-readonly-preflight\.mjs/);
 assert.match(ci,/node --test p37-lab\/p37-19h\/verified-sessions.test.mjs/);
});
