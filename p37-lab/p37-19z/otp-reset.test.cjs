'use strict';
// P37-19Z: offline Node vm tests. Every Auth endpoint is MOCKED;
// no email, no JWT, no Supabase HTTP, no ERP data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const js=fs.readFileSync(path.join(__dirname,'otp-reset.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'otp-reset.html'),'utf8');
const template=fs.readFileSync(path.join(__dirname,'recovery-email-template-REVIEW-ONLY.html'),'utf8');
const SITE='https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/p37-19z/otp-reset.html';
const AUTH='https://ldktrfgzzzmklhsnfrol.supabase.co';
const ID='00000000-0000-4000-8000-000000001900';
const ACCESS='FAKE_ONLY_NOT_A_REAL_JWT_'+ 'X'.repeat(190);
const EMAIL='not-a-real-user@example.invalid';
const OTP='123456';
const validR={
 access_token:ACCESS,token_type:'bearer',expires_in:3600,user:{id:ID}
};
function answer(value,status=200){
 return {ok:status>=200&&status<300,status,
  text:async()=>status===204?'':JSON.stringify(value)};
}
function fixture(opts={}){
 const elements=new Map(),calls=[];
 const e=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',disabled:false,readOnly:false,
   checked:false,textContent:'',className:'',listeners:{},
   addEventListener(action,handler){this.listeners[action]=handler}});
  return elements.get(id);
 };
 const page={
  location:new URL(opts.location||SITE),
  history:{replaceState(_a,_b,newPath){page.location=new URL(newPath,page.location.href)}},
  async fetch(target,request={}){
   const url=new URL(target);
   assert.equal(url.origin,AUTH,'No foreign or production Supabase calls permitted');
   assert.equal(request.credentials,'omit');
   assert.equal(request.redirect,'error');
   assert.equal(request.cache,'no-store');
   assert.equal(request.mode,'cors');
   const body=request.body?JSON.parse(request.body):null;
   calls.push({path:url.pathname,method:request.method,body,
     query:url.search,auth:request.headers?.Authorization||''});
   if(url.pathname==='/auth/v1/recover'&&request.method==='POST'){
    assert.equal(url.searchParams.get('redirect_to'),
      'https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/reset-password.html');
    assert.deepEqual(body,{email:EMAIL});
    return answer({},opts.sendStatus??200);
   }
   if(url.pathname==='/auth/v1/verify'&&request.method==='POST'){
    assert.deepEqual(body,{email:EMAIL,token:OTP,type:'recovery'});
    return answer(opts.verifyResponse??validR,opts.verifyStatus??200);
   }
   if(url.pathname==='/auth/v1/user'&&request.method==='GET'){
    assert.equal(request.headers.Authorization,'Bearer '+ACCESS);
    return answer({id:opts.mismatchedUser?'00000000-0000-4000-8000-000000009999':ID},
      opts.authStatus??200);
   }
   if(url.pathname==='/rest/v1/p37_lab_members'&&request.method==='GET'){
    assert.equal(request.headers.Authorization,'Bearer '+ACCESS);
    return answer(opts.members??[{user_id:ID,enabled:true,purpose:'P37_9B_TEST_ONLY'}],
      opts.rlsStatus??200);
   }
   if(url.pathname==='/auth/v1/user'&&request.method==='PUT'){
    assert.equal(request.headers.Authorization,'Bearer '+ACCESS);
    assert.ok(body.password.length>=12);
    return answer({id:ID},opts.saveStatus??200);
   }
   if(url.pathname==='/auth/v1/logout'&&request.method==='POST'){
    assert.equal(request.headers.Authorization,'Bearer '+ACCESS);
    return answer(null,204);
   }
   throw Error('Mock rejects unknown endpoint '+url.pathname);
  }
 };
 const ctx=vm.createContext({window:page,document:{getElementById:e},
   URL,AbortController,setTimeout,clearTimeout});
 vm.runInContext(js,ctx,{filename:'p37-lab/p37-19z/otp-reset.js'});
 return {page,e,calls};
}
async function begin(x){
 x.e('otp-email').value=EMAIL;
 assert.equal((await x.page.KusheP3719ZOtpRecovery.sendCode()).ok,true);
 x.e('otp-code').value=OTP;
}
test('new page and mail template are isolated, and ORIGINAL beta never imports new candidate',()=>{
 assert.match(js,/const AUTH="https:\/\/ldktrfgzzzmklhsnfrol\.supabase\.co"/);
 assert.match(js,/type:"recovery"/);
 assert.match(template,/\{\{ \.Token \}\}/);
 assert.doesNotMatch(template,/\.ConfirmationURL|\.TokenHash/);
 assert.match(html,/id="otp-code"/);
 assert.match(html,/id="password-new"[^>]*disabled/);
 assert.match(html,/id="save-password"[^>]*disabled/);
 assert.match(html,/content="default-src 'none'/);
 assert.match(html,/connect-src https:\/\/ldktrfgzzzmklhsnfrol\.supabase\.co/);
 assert.doesNotMatch(html,/service_role|sb_secret_|src="https:\/\//);
 assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|erp_state_cas_write|refresh_token\W/);
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const erp=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 assert.doesNotMatch(index,/p37-19z|p3719z/i);
 assert.doesNotMatch(erp,/p37-19z|p3719z/i);
});
test('page load does not send emails, verify tokens, or unlock passwords',()=>{
 const x=fixture();
 assert.equal(x.calls.length,0);
 assert.equal(x.e('password-new').disabled,true);
 assert.equal(x.e('password-confirm').disabled,true);
 assert.equal(x.e('save-password').disabled,true);
 assert.equal(x.e('otp-code').disabled,true);
 assert.equal(x.e('verify-otp').disabled,true);
});
test('only one email recovery POST is issued per loaded page',async()=>{
 const x=fixture();await begin(x);
 assert.equal(x.e('otp-email').readOnly,true);
 assert.equal(x.e('send-otp').disabled,true);
 assert.equal(x.e('otp-code').disabled,false);
 assert.equal((await x.page.KusheP3719ZOtpRecovery.sendCode()).ok,false);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/recover').length,1);
 assert.deepEqual(x.calls.filter(c=>c.path==='/auth/v1/recover')[0].body,{email:EMAIL});
 assert.ok(!x.calls.some(c=>c.path.includes('/rpc/')));
});
test('429 email quota stays blocked, without retries or password unlock',async()=>{
 const x=fixture({sendStatus:429});x.e('otp-email').value=EMAIL;
 assert.equal((await x.page.KusheP3719ZOtpRecovery.sendCode()).ok,false);
 assert.match(x.e('send-result').textContent,/429/);
 assert.equal((await x.page.KusheP3719ZOtpRecovery.sendCode()).ok,false);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/recover').length,1);
 assert.equal(x.e('verify-otp').disabled,true);
 assert.equal(x.e('save-password').disabled,true);
});
test('cannot verify malformed OTP or skip email request',async()=>{
 const x=fixture();
 x.e('otp-code').value=OTP;
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
 await begin(x);
 x.e('otp-code').value='abc456';
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
 x.e('otp-code').value='12345';
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/verify').length,0);
 assert.equal(x.e('save-password').disabled,true);
});
test('bad or expired OTP does not enable password, and never echoes raw server errors',async()=>{
 const x=fixture({verifyStatus:403});await begin(x);
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
 assert.equal(x.e('save-password').disabled,true);
 assert.match(x.e('verify-result').textContent,/403/);
 assert.doesNotMatch(x.e('verify-result').textContent,/123456|not-a-real-user/);
 assert.equal(x.calls.filter(c=>c.method==='PUT').length,0);
});
test('verified OTP still requires exact Auth User and P37 allowlist',async()=>{
 for(const opts of [
  {mismatchedUser:true},
  {rlsStatus:403},
  {members:[]},
  {members:[{user_id:ID,enabled:true,purpose:'NOT_ALLOWED'}]},
  {members:[{user_id:ID,enabled:false,purpose:'P37_9B_TEST_ONLY'}]}
 ]){
  const x=fixture(opts);await begin(x);
  assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
  assert.equal(x.e('password-new').disabled,true);
  assert.equal(x.e('save-password').disabled,true);
  assert.equal(x.calls.filter(c=>c.method==='PUT').length,0);
  assert.equal(x.calls.filter(c=>c.path==='/auth/v1/logout').length,1);
 }
});
test('malformed verify response with no valid bearer or user remains blocked',async()=>{
 const cases=[
  {...validR,access_token:'short'},
  {...validR,token_type:'unknown'},
  {...validR,user:{id:'not-valid'}},
  {...validR,expires_in:0},
  {...validR,expires_in:'NaN'},
  {...validR,expires_in:900000}
 ];
 for(const verifyResponse of cases){
  const x=fixture({verifyResponse});await begin(x);
  assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
  assert.equal(x.e('save-password').disabled,true);
  assert.equal(x.calls.filter(c=>c.method==='PUT').length,0);
 }
});
test('three failed genuine attempts cap the page and do not send repeated email',async()=>{
 const x=fixture({verifyStatus:403});await begin(x);
 for(let j=0;j<3;j++){x.e('otp-code').value=OTP;assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);}
 x.e('otp-code').value=OTP;
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,false);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/verify').length,3);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/recover').length,1);
 assert.equal(x.e('verify-otp').disabled,true);
});
test('success: recovery OTP -> Auth user -> RLS -> password PUT -> signout + cleared fields',async()=>{
 const x=fixture();await begin(x);
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,true);
 assert.equal(x.e('password-new').disabled,false);
 assert.equal(x.e('save-password').disabled,false);
 assert.equal(x.e('otp-code').value,'');
 assert.deepEqual(x.calls.slice(0,4).map(c=>c.path),[
  '/auth/v1/recover','/auth/v1/verify','/auth/v1/user','/rest/v1/p37_lab_members']);
 assert.equal(x.calls[1].auth,'');
 assert.equal(x.calls[2].auth,'Bearer '+ACCESS);
 assert.doesNotMatch(x.e('verify-result').textContent,new RegExp(OTP));
 x.e('password-new').value='short';
 x.e('password-confirm').value='short';
 assert.equal((await x.page.KusheP3719ZOtpRecovery.savePassword()).ok,false);
 assert.equal(x.calls.filter(c=>c.method==='PUT').length,0);
 x.e('password-new').value='not-production-password-12';
 x.e('password-confirm').value='not-production-password-12';
 assert.equal((await x.page.KusheP3719ZOtpRecovery.savePassword()).ok,true);
 assert.equal(x.calls.filter(c=>c.method==='PUT').length,1);
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/logout').length,1);
 assert.equal(x.e('password-new').value,'');
 assert.equal(x.e('password-new').disabled,true);
 assert.equal(x.e('save-password').disabled,true);
});
test('failed password PUT does not leak transient bearer or preserve unlocked controls',async()=>{
 const x=fixture({saveStatus:503});await begin(x);
 assert.equal((await x.page.KusheP3719ZOtpRecovery.verifyCode()).ok,true);
 x.e('password-new').value='not-production-password-12';
 x.e('password-confirm').value='not-production-password-12';
 assert.equal((await x.page.KusheP3719ZOtpRecovery.savePassword()).ok,false);
 assert.equal(x.e('save-password').disabled,true);
 assert.equal(x.e('password-new').value,'');
 assert.equal(x.calls.filter(c=>c.path==='/auth/v1/logout').length,1);
});
test('wrong origin and callback token fragments cannot access the Auth API',async()=>{
 const bad=fixture({location:'https://fake.example/beta/p37-lab/p37-19z/otp-reset.html'});
 bad.e('otp-email').value=EMAIL;
 assert.equal((await bad.page.KusheP3719ZOtpRecovery.sendCode()).ok,false);
 assert.equal(bad.calls.length,0);
 const q=fixture({location:SITE+'#access_token=ONE_TIME_SECRET&type=recovery'});
 assert.equal(q.page.location.hash,'');
 assert.equal(q.e('save-password').disabled,true);
 assert.equal(q.calls.length,0);
 assert.doesNotMatch(q.e('verify-result').textContent,/ONE_TIME_SECRET/);
});
