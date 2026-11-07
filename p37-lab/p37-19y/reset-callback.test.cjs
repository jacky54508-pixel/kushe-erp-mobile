'use strict';
// P37-19Y — offline security test of P37 Auth Lab recovery callbacks.
// No browser secrets, real Auth calls, real SMTP, company financial data.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'p37-lab/reset-password.js'),'utf8');
const html=fs.readFileSync(path.join(root,'p37-lab/reset-password.html'),'utf8');
const URL_SITE='https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/reset-password.html';
const AUTH='https://ldktrfgzzzmklhsnfrol.supabase.co';
const USER='00000000-0000-4000-8000-0000000019aa';
const TOKEN='fake-lab-recovery-access-token-'+ 'a'.repeat(180);
const fakeEmail='p37-lab-tester@example.invalid';
function once(raw,status=200){
 return {ok:status>=200&&status<300,status, text:async()=>raw===null?'':JSON.stringify(raw)};
}
function setup(suffix='',options={}){
 const controls=new Map();
 const el=name=>{
  if(!controls.has(name))controls.set(name,{id:name,disabled:false,value:'',
   textContent:'',className:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
  return controls.get(name);
 };
 const calls=[];
 let scrubbed=0;
 const browser={
  location:new URL(URL_SITE+suffix),
  history:{replaceState(_a,_b,next){
   scrubbed++;
   browser.location=new URL(next,browser.location.origin);
  }},
  fetch:async(address,request)=>{
   const u=new URL(address);
   assert.equal(u.origin,AUTH,'Only Auth lab HTTPS mock allowed');
   assert.equal(request.mode,'cors');
   assert.equal(request.credentials,'omit');
   assert.equal(request.redirect,'error');
   assert.equal(request.cache,'no-store');
   calls.push({path:u.pathname,method:request.method,headers:request.headers,
    body:request.body,query:u.search});
   if(u.pathname==='/auth/v1/recover'&&request.method==='POST')
    return once(null,options.emailResponseStatus||200);
   if(u.pathname==='/auth/v1/user'&&request.method==='GET')
    return once(options.deniedToken?{message:'invalid'}:{id:USER},options.deniedToken?401:200);
   if(u.pathname==='/rest/v1/p37_lab_members')
    return once(options.deniedRls?[]:[{user_id:USER,enabled:true,purpose:'P37_9B_TEST_ONLY'}]);
   if(u.pathname==='/auth/v1/user'&&request.method==='PUT')return once({id:USER});
   if(u.pathname==='/auth/v1/logout'&&request.method==='POST')return once(null,204);
   throw Error('Unexpected mock path '+u.pathname);
  }
 };
 const document={getElementById:el};
 const context=vm.createContext({window:browser,document,URL,URLSearchParams,
  AbortController,setTimeout,clearTimeout});
 vm.runInContext(source,context,{filename:'p37-lab/reset-password.js'});
 return {
  win:browser,el,calls,getScrubCount:()=>scrubbed,
  async settled(){for(let k=0;k<5;k++)await new Promise(resolve=>setImmediate(resolve));}
 };
}
test('stable original project scope, no production API or token storage',()=>{
 const sha=x=>{const raw=Buffer.from(x);return crypto.createHash('sha1').update(Buffer.from('blob '+raw.length+'\\0')).update(raw).digest('hex');};
 const originalStore=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const origIndex=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(source,/https:\/\/ldktrfgzzzmklhsnfrol\.supabase\.co/);
 assert.match(source,/const CALLBACK="https:\/\/jacky54508-pixel\.github\.io\/kushe-erp-mobile\/beta\/p37-lab\/reset-password.html"/);
 assert.doesNotMatch(source,/jimcybsztnwfzrnvexsp|service_role|sb_secret_|localStorage|sessionStorage|document\.cookie/);
 assert.doesNotMatch(source,/erp_state_cas_write|addReceipt|completeEmployeeCashHandover/);
 assert.doesNotMatch(originalStore,/p37-19y|p3719y/i);
 assert.doesNotMatch(origIndex,/p37-19y|p3719y/i);
 assert.match(html,/reset-password\.js\?v=p37-19y-safe-recovery-errors-1/);
 assert.equal(sha(source).length,40);
});
test('OTP-expired callback fragment shows an explanatory error without requests or tokens',async()=>{
 const x=setup('#error=access_denied&error_code=otp_expired&error_description=Secret123');
 await x.settled();
 assert.match(x.el('verify-result').textContent,/otp_expired|過期/);
 assert.doesNotMatch(x.el('verify-result').textContent,/Secret123/);
 assert.equal(x.el('verify-result').className,'message error');
 assert.equal(x.el('save-password').disabled,true);
 assert.equal(x.calls.length,0);
 assert.equal(x.win.location.hash,'');
 assert.equal(x.getScrubCount(),1);
});
test('OTP-expired query callback is categorized, not misread as an empty-page visit',async()=>{
 const x=setup('?error=access_denied&error_code=otp_expired&error_description=HiddenRawToken');
 await x.settled();
 assert.match(x.el('verify-result').textContent,/過期/);
 assert.doesNotMatch(x.el('verify-result').textContent,/HiddenRawToken/);
 assert.equal(x.win.location.search,'');
 assert.equal(x.calls.length,0);
 assert.equal(x.el('password-new').disabled,true);
});
test('unknown Supabase access-denied reasons remain blocked and do not echo details',async()=>{
 const x=setup('#error=access_denied&error_code=other_code&error_description=DO_NOT_ECHO');
 await x.settled();
 assert.match(x.el('verify-result').textContent,/拒絕|授權失敗/);
 assert.doesNotMatch(x.el('verify-result').textContent,/DO_NOT_ECHO/);
 assert.equal(x.calls.length,0);
});
test('PKCE ?code= cannot bypass absent verifier; no HTTP token exchange occurs',async()=>{
 const x=setup('?code=synthetic-recovery-code-not-authenticated');
 await x.settled();
 assert.match(x.el('verify-result').textContent,/PKCE/);
 assert.equal(x.el('password-new').disabled,true);
 assert.equal(x.calls.length,0);
 assert.equal(x.win.location.search,'');
});
test('token_hash cannot be silently treated as valid bearer access token',async()=>{
 const x=setup('?token_hash=fake&type=recovery');
 await x.settled();
 assert.match(x.el('verify-result').textContent,/token_hash/);
 assert.equal(x.calls.length,0);
 assert.equal(x.el('save-password').disabled,true);
});
test('ordinary visit and harmless cache query do not claim expired link',async()=>{
 for(const suffix of ['', '?v=preview42']){
  const x=setup(suffix);await x.settled();
  assert.match(x.el('verify-result').textContent,/尚未由有效/);
  assert.equal(x.el('verify-result').className,'message pass');
  assert.equal(x.el('save-password').disabled,true);
  assert.equal(x.calls.length,0);
 }
});
test('wrong recovery type and malformed or duplicate fragment tokens are blocked',async()=>{
 for(const suffix of [
  '#access_token='+TOKEN+'&type=signup',
  '#access_token=short&type=recovery',
  '#access_token='+TOKEN+'&access_token='+TOKEN+'&type=recovery',
  '#type=recovery',
  '#access_token='+TOKEN+'&type=recovery&token_type=not-bearer',
  '#access_token='+TOKEN+'&type=recovery&expires_in=abc',
  '#access_token='+TOKEN+'&type=recovery&expires_at=1111111111'
 ]){
  const x=setup(suffix);await x.settled();
  assert.equal(x.el('save-password').disabled,true,suffix.slice(0,35));
  assert.equal(x.calls.length,0);
  assert.equal(x.win.location.hash,'');
  assert.match(x.el('verify-result').className,/error/);
 }
});
test('valid recovery requires Auth user + RLS allowlist before enabling password',async()=>{
 const x=setup('#access_token='+TOKEN+'&type=recovery&expires_in=300&token_type=bearer');
 await x.settled();
 assert.equal(x.el('password-new').disabled,false);
 assert.equal(x.el('password-confirm').disabled,false);
 assert.equal(x.el('save-password').disabled,false);
 assert.match(x.el('verify-result').textContent,/已通過.*白名單/);
 assert.equal(x.win.location.hash,'');
 assert.equal(x.calls.length,2);
 assert.equal(x.calls[0].path,'/auth/v1/user');
 assert.equal(x.calls[1].path,'/rest/v1/p37_lab_members');
 assert.equal(x.calls[0].headers.Authorization,'Bearer '+TOKEN);
 assert.doesNotMatch(x.el('verify-result').textContent,/fake-lab-recovery-access-token/);
 // Only the mock endpoint can accept the test password after verified Auth.
 x.el('password-new').value='nonproduction-new-password-12';
 x.el('password-confirm').value='nonproduction-new-password-12';
 const result=await x.win.KusheP37Reset.changePassword();
 assert.equal(result.ok,true);
 assert.equal(x.calls.filter(r=>r.method==='PUT').length,1);
 assert.equal(x.calls.filter(r=>r.path==='/auth/v1/logout').length,1);
 assert.equal(x.el('password-new').disabled,true);
 assert.equal(x.el('password-new').value,'');
});
test('rejected Auth token and mismatched RLS membership never unlock password',async()=>{
 for(const opts of [{deniedToken:true},{deniedRls:true}]){
  const x=setup('#access_token='+TOKEN+'&type=recovery',opts);
  await x.settled();
  assert.equal(x.el('save-password').disabled,true);
  assert.equal(x.el('password-new').disabled,true);
  assert.equal(x.calls.filter(r=>r.method==='PUT').length,0);
  assert.match(x.el('verify-result').className,/error/);
 }
});
test('SMTP HTTP 429 is shown without attempted retries or account writes',async()=>{
 const x=setup('',{emailResponseStatus:429});
 x.el('reset-email').value=fakeEmail;
 const v=await x.win.KusheP37Reset.sendEmail();
 assert.equal(v.ok,false);
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].path,'/auth/v1/recover');
 assert.equal(x.calls[0].method,'POST');
 assert.match(x.el('send-result').textContent,/HTTP 429/);
 assert.doesNotMatch(x.el('send-result').textContent,new RegExp(fakeEmail));
 assert.equal(x.calls.filter(a=>a.method==='PUT').length,0);
});
test('no page-load request on arbitrary origin, so user is not exposed to test Auth',async()=>{
 const sourceWindow={
  location:new URL('https://unknown.example/reset-password.html'),
  history:{replaceState() {throw Error('should not run')}},
  fetch(){throw Error('should never call external Auth')}
 };
 const controls=new Map();
 const doc={getElementById(id){
  if(!controls.has(id))controls.set(id,{disabled:false,textContent:'',className:'',
   value:'',addEventListener(){}});
  return controls.get(id);
 }};
 vm.runInNewContext(source,{window:sourceWindow,document:doc,URL,URLSearchParams,
  AbortController,setTimeout,clearTimeout});
 assert.equal(controls.get('send-reset').disabled,true);
 assert.equal(controls.get('save-password').disabled,true);
});
