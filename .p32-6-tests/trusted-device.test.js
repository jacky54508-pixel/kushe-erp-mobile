const fs=require('fs'),vm=require('vm'),assert=require('assert');

class Store{
  constructor(){this.m=new Map()}
  getItem(k){return this.m.has(k)?this.m.get(k):null}
  setItem(k,v){this.m.set(String(k),String(v))}
  removeItem(k){this.m.delete(String(k))}
  clear(){this.m.clear()}
}
global.sessionStorage=new Store();
global.localStorage=new Store();
global.window={KUSHE_PHASE1_CONFIG:{supabaseUrl:'https://synthetic.invalid',supabasePublishableKey:'sb_publishable_test',authSessionStorageKey:'p32_6_session'}};
window.sessionStorage=sessionStorage;window.localStorage=localStorage;
const USER={id:'user-1',email:'synthetic@example.invalid'};
function jwt(aal){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');return enc({alg:'none'})+'.'+enc({aal,sub:USER.id})+'.x'}
let mode='normal',refreshCount=0,fetchCount=0;
function ok(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
global.fetch=async(url,opts={})=>{
  fetchCount++;
  const u=new URL(url),p=u.pathname+u.search;
  if(mode==='network'&&p.includes('grant_type=refresh_token')) throw new TypeError('offline');
  if(p==='/auth/v1/token?grant_type=password') return ok({access_token:jwt('aal1'),refresh_token:'rt-login',expires_in:3600,user:USER});
  if(p==='/auth/v1/user') return ok(USER);
  if(p==='/auth/v1/factors/f1/challenge') return ok({id:'c1'});
  if(p==='/auth/v1/factors/f1/verify'){
    return ok({access_token:jwt('aal2'),refresh_token:'rt-aal2',expires_in:3600,user:USER});
  }
  if(p==='/auth/v1/token?grant_type=refresh_token'){
    refreshCount++;
    if(mode==='wrong-user') return ok({access_token:jwt('aal2'),refresh_token:'rt-wrong',expires_in:3600,user:{id:'other',email:'other@example.invalid'}});
    if(mode==='low-aal') return ok({access_token:jwt('aal1'),refresh_token:'rt-low',expires_in:3600,user:USER});
    if(mode==='unauthorized') return ok({error_code:'refresh_token_not_found'},401);
    return ok({access_token:jwt('aal2'),refresh_token:'rt-rotated-'+refreshCount,expires_in:3600,user:USER});
  }
  if(p==='/auth/v1/logout') return ok({});
  throw new Error('unexpected fetch '+p);
};
global.atob=s=>Buffer.from(s,'base64').toString('binary');
vm.runInThisContext(fs.readFileSync('assets/js/auth-gate.js','utf8'),{filename:'auth-gate.js'});
const gate=window.KusheAuthGate;
const TKEY='p32_6_session__trusted_v1';

(async()=>{
  assert.strictEqual(gate.trustedDeviceStatus().active,false,'no trust initially');
  await gate.login(USER.email,'pw');
  assert.strictEqual(gate.session().user.id,USER.id);
  assert.strictEqual(localStorage.getItem(TKEY),null,'aal1 login must not persist trust');
  assert.throws(()=>gate.trustCurrentDevice(),/Authentication request failed/,'aal1 cannot be trusted');

  await gate.verifyMfa('f1','c1','123456');
  assert.strictEqual((JSON.parse(Buffer.from(gate.session().access_token.split('.')[1],'base64url').toString())).aal,'aal2');
  const trusted=gate.trustCurrentDevice();
  assert.strictEqual(trusted.active,true);
  let rec=JSON.parse(localStorage.getItem(TKEY));
  assert.strictEqual(rec.user_id,USER.id);
  assert.strictEqual(rec.refresh_token,'rt-aal2');
  assert(!('access_token' in rec),'access token must not be persisted');
  assert(rec.expires_at-rec.created_at<=7*24*60*60*1000+1000);

  // Browser close: active session disappears but trusted refresh survives.
  sessionStorage.clear();
  assert.strictEqual(gate.session(),null);
  mode='normal';
  assert.strictEqual(await gate.restoreTrustedSession(),true);
  assert.strictEqual(await gate.requireAuth(),true);
  rec=JSON.parse(localStorage.getItem(TKEY));
  assert(/^rt-rotated-/.test(rec.refresh_token),'refresh token must rotate in trusted storage');
  assert.strictEqual((JSON.parse(Buffer.from(gate.session().access_token.split('.')[1],'base64url').toString())).aal,'aal2');

  // Explicit logout revokes local trust.
  await gate.logout();
  assert.strictEqual(localStorage.getItem(TKEY),null);
  assert.strictEqual(gate.session(),null);

  // Recreate trusted record then prove low-AAL refresh cannot restore.
  await gate.login(USER.email,'pw');
  await gate.verifyMfa('f1','c1','123456');gate.trustCurrentDevice();sessionStorage.clear();
  mode='low-aal';
  assert.strictEqual(await gate.restoreTrustedSession(),false);
  assert.strictEqual(localStorage.getItem(TKEY),null,'low aal must clear trust');
  assert.strictEqual(gate.session(),null);

  // Principal mismatch cannot restore.
  mode='normal';await gate.login(USER.email,'pw');await gate.verifyMfa('f1','c1','123456');gate.trustCurrentDevice();sessionStorage.clear();
  mode='wrong-user';
  assert.strictEqual(await gate.restoreTrustedSession(),false);
  assert.strictEqual(localStorage.getItem(TKEY),null,'principal mismatch must clear trust');

  // Expired record is rejected before network.
  mode='normal';await gate.login(USER.email,'pw');await gate.verifyMfa('f1','c1','123456');gate.trustCurrentDevice();sessionStorage.clear();
  rec=JSON.parse(localStorage.getItem(TKEY));rec.expires_at=Date.now()-1;localStorage.setItem(TKEY,JSON.stringify(rec));
  const before=fetchCount;
  assert.strictEqual(await gate.restoreTrustedSession(),false);
  assert.strictEqual(fetchCount,before,'expired trust must not hit network');
  assert.strictEqual(localStorage.getItem(TKEY),null);

  // Idle >24h is rejected before network.
  await gate.login(USER.email,'pw');await gate.verifyMfa('f1','c1','123456');gate.trustCurrentDevice();sessionStorage.clear();
  rec=JSON.parse(localStorage.getItem(TKEY));rec.last_used_at=Date.now()-(24*60*60*1000+2000);localStorage.setItem(TKEY,JSON.stringify(rec));
  const beforeIdle=fetchCount;
  assert.strictEqual(await gate.restoreTrustedSession(),false);
  assert.strictEqual(fetchCount,beforeIdle);
  assert.strictEqual(localStorage.getItem(TKEY),null);

  // Transient network error does not destroy a still-valid trusted record.
  await gate.login(USER.email,'pw');await gate.verifyMfa('f1','c1','123456');gate.trustCurrentDevice();sessionStorage.clear();
  mode='network';
  assert.strictEqual(await gate.restoreTrustedSession(),false);
  assert(localStorage.getItem(TKEY),'transient error should preserve trust');
  mode='normal';
  assert.strictEqual(await gate.restoreTrustedSession(),true);

  // Manual password login intentionally clears previous trusted-device record.
  sessionStorage.clear();
  await gate.login(USER.email,'pw');
  assert.strictEqual(localStorage.getItem(TKEY),null,'manual login must clear old trust');

  console.log('P32-6 synthetic trusted-device checks: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
