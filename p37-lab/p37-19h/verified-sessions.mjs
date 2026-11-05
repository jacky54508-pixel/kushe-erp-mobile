// P37-19H: ISOLATED LAB ONLY. No ERP Store, Supabase admin, or accounting writes.
// Two real Supabase Auth sessions must have distinct session_id claims.
// Tokens remain in memory; no token, password, email or user ID is ever logged.
const TARGET='https://ldktrfgzzzmklhsnfrol.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=x=>String(x??'').trim();
const stop=code=>{throw new Error('P37-19H '+code)};
export function config(env){
 if(env.P37_19H_MODE!=='AUTH_READ_ONLY_LAB_ONLY')stop('EXPLICIT_READ_ONLY_LAB_MODE_REQUIRED');
 if(env.P37_19H_URL!==TARGET)stop('NON_LAB_OR_PRODUCTION_URL_BLOCKED');
 const key=text(env.P37_19H_PUBLISHABLE_KEY);
 if(!/^sb_publishable_[A-Za-z0-9_-]{5,}$/.test(key)||/service_role|sb_secret_/i.test(key))
  stop('PUBLISHABLE_KEY_REQUIRED');
 const email=text(env.P37_19H_TEST_EMAIL),password=env.P37_19H_TEST_PASSWORD;
 if(!email.includes('@')||typeof password!=='string'||!password)
  stop('DEDICATED_LAB_CREDENTIALS_REQUIRED');
 return Object.freeze({url:TARGET,key,email,password});
}
function assertTarget(url){
 const u=new URL(url);
 if(u.origin!==TARGET||u.username||u.password||u.hash||
   !['/auth/v1/token','/auth/v1/user','/auth/v1/logout',
      '/rest/v1/p37_lab_members','/rest/v1/p37_lab_cases',
      '/rest/v1/p37_lab_allowances'].includes(u.pathname))
  stop('UNAPPROVED_NETWORK_DESTINATION');
}
async function request(fetchFn,url,options={}){
 assertTarget(url);
 let res;
 try{res=await fetchFn(url,{redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(12000),...options})}
 catch(_){stop('LAB_REQUEST_FAILED')}
 const body=res.status===204?null:await res.json().catch(()=>null);
 return {ok:res.ok,status:res.status,value:body};
}
function authHeader(cfg,token){
 return {apikey:cfg.key,Authorization:'Bearer '+token,'Cache-Control':'no-store'};
}
function claims(jwt,nowSeconds){
 if(typeof jwt!=='string'||jwt.length>8192||jwt.split('.').length!==3)
  stop('NOT_AN_ACCESS_TOKEN_JWT');
 let claim;
 try{claim=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8'))}
 catch(_){stop('INVALID_JWT_PAYLOAD')}
 // JWT decoding is NOT signature verification. /auth/v1/user below verifies
 // the credential server-side under the real, isolated Supabase Auth service.
 if(claim.iss!==TARGET+'/auth/v1'||claim.role!=='authenticated'||
    !(claim.aud==='authenticated'||Array.isArray(claim.aud)&&claim.aud.includes('authenticated'))||
    !UUID.test(text(claim.sub))||!UUID.test(text(claim.session_id))||
    claim.is_anonymous===true||!Number.isSafeInteger(claim.exp)||
    claim.exp<nowSeconds+120)stop('LAB_JWT_IDENTITY_SESSION_OR_EXPIRY_INVALID');
 return {sub:claim.sub,session:claim.session_id};
}
export async function verifyPair(cfg,fetchFn,first,second,nowSeconds=Math.floor(Date.now()/1000)){
 if(cfg?.url!==TARGET||!/^sb_publishable_/.test(cfg.key||''))stop('WRONG_PROJECT_OR_KEY');
 if(!first?.token||!second?.token||first.token===second.token)
  stop('TWO_DISTINCT_TOKENS_REQUIRED');
 const a=claims(first.token,nowSeconds),b=claims(second.token,nowSeconds);
 if(a.sub!==b.sub||a.session===b.session||
    first.userId!==a.sub||second.userId!==b.sub)
   stop('NOT_TWO_INDEPENDENT_AUTH_SESSIONS');
 const check=async (token,claim)=>{
  const [user,members]=await Promise.all([
   request(fetchFn,TARGET+'/auth/v1/user',{headers:authHeader(cfg,token)}),
   request(fetchFn,TARGET+'/rest/v1/p37_lab_members?select=user_id,enabled&user_id=eq.'+claim.sub,
    {headers:authHeader(cfg,token)})
  ]);
  if(!user.ok||user.value?.id!==claim.sub||user.value?.is_anonymous===true||
     !members.ok||!Array.isArray(members.value)||members.value.length!==1||
     members.value[0].user_id!==claim.sub||members.value[0].enabled!==true)
   stop('AUTH_SERVER_OR_LAB_RLS_NOT_CONFIRMED');
 };
 await Promise.all([check(first.token,a),check(second.token,b)]);
 return Object.freeze({separateAuthSessions:true,serverValidatedUsers:2,
  rlsAllowlisted:true,syntheticOnly:true,financialWrites:0});
}
export async function signOut(cfg,fetchFn,session){
 if(!session?.token)return false;
 const r=await request(fetchFn,TARGET+'/auth/v1/logout',
  {method:'POST',headers:authHeader(cfg,session.token)});
 if(!r.ok)stop('AUTH_SIGNOUT_UNCONFIRMED');
 return true;
}
async function login(cfg,fetchFn){
 const r=await request(fetchFn,TARGET+'/auth/v1/token?grant_type=password',
  {method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},
   body:JSON.stringify({email:cfg.email,password:cfg.password})});
 if(!r.ok||typeof r.value?.access_token!=='string'||!UUID.test(text(r.value?.user?.id)))
  stop('TEST_ACCOUNT_LOGIN_REJECTED');
 return {token:r.value.access_token,userId:r.value.user.id};
}
async function emptyLabRead(cfg,fetchFn,token){
 const paths=['/rest/v1/p37_lab_cases?select=id&limit=2',
              '/rest/v1/p37_lab_allowances?select=id&limit=2'];
 const v=await Promise.all(paths.map(path=>request(fetchFn,TARGET+path,
  {headers:authHeader(cfg,token)})));
 if(v.some(x=>!x.ok||!Array.isArray(x.value)||x.value.length!==0))
  stop('LAB_NOT_EMPTY_OR_RLS_READ_FAILED');
}
export async function preflight(cfg,fetchFn=fetch){
 if(cfg?.url!==TARGET||!cfg.email||!cfg.password)stop('READ_ONLY_LAB_CONFIG_REQUIRED');
 const acquired=[];
 let error=null,proof=null;
 try{
  const logins=await Promise.allSettled([login(cfg,fetchFn),login(cfg,fetchFn)]);
  for(const result of logins)if(result.status==='fulfilled')acquired.push(result.value);
  if(acquired.length!==2)stop('BOTH_LAB_SESSIONS_NOT_CREATED');
  proof=await verifyPair(cfg,fetchFn,acquired[0],acquired[1]);
  await Promise.all(acquired.map(s=>emptyLabRead(cfg,fetchFn,s.token)));
 }catch(e){error=e}
 // Revoke both Auth sessions before reporting success or failure.
 const signedOut=await Promise.allSettled(acquired.map(s=>signOut(cfg,fetchFn,s)));
 if(signedOut.some(x=>x.status!=='fulfilled'||x.value!==true))
  stop('TEST_AUTH_SESSIONS_SIGNOUT_INCOMPLETE');
 if(error)throw error;
 if(!proof?.separateAuthSessions)stop('NO_INDEPENDENT_AUTH_PROOF');
 return Object.freeze({status:'P37_19H_AUTH_ONLY_PRECHECK_PASS',
  testProject:'kushe-auth-lab',separateSessions:2,serverVerified:2,
  observedLabCases:0,observedLabAllowances:0,
  revokedSessions:signedOut.length,realAllowanceRpcCalls:0,
  formalERPWrites:0,productionCloudWrites:0,canPost:false});
}
// This module has no direct-run entrypoint: use the separate manual CLI so
// importing this file from offline tests cannot issue remote auth requests.
