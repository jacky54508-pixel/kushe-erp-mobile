// P37-19G: manual opt-in REAL lab RPC test. Never imported by ERP or auto-CI.
// Requires separate test-only Auth logins, staged synthetic case, and admin cleanup.
import {pathToFileURL} from 'node:url';
const TARGET='https://ldktrfgzzzmklhsnfrol.supabase.co';
const ID='00000000-0000-4000-8000-000000019019';
const CASE='P37-9B-TEST-P37-19G-CLEANUP-20261105';
const INVOICE='P37-9B-INV-P37-19G-CLEANUP-20261105';
const failure=code=>{throw new Error('P37-19G '+code)};
export function config(env){
 if(env.P37_19G_ALLOW_REMOTE_TEST!=='YES_LAB_ONLY'||
    env.P37_19G_ADMIN_CLEANUP_READY!=='YES'||
    env.P37_19G_STAGE_PREVERIFIED!=='YES')failure('EXPLICIT_CLEANUP_AND_MANUAL_APPROVAL_REQUIRED');
 if(env.P37_19G_URL!==TARGET||env.P37_19G_FIXTURE_ID!==ID)failure('WRONG_LAB_OR_FIXTURE');
 const key=String(env.P37_19G_PUBLISHABLE_KEY||'');
 if(!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)||/service_role|sb_secret_/i.test(key))
   failure('INVALID_PUBLISHABLE_KEY');
 const email=String(env.P37_19G_TEST_EMAIL||'');
 const password=env.P37_19G_TEST_PASSWORD;
 if(!email.includes('@')||typeof password!=='string'||!password)
   failure('NO_DEDICATED_TEST_LOGIN');
 return Object.freeze({url:TARGET,id:ID,key,email,password});
}
const headers=(cfg,token)=>({apikey:cfg.key,Authorization:'Bearer '+token,
 'Content-Type':'application/json','Cache-Control':'no-store'});
async function req(fetcher,url,options={}){
 const response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
 return {ok:response.ok,status:response.status,value:await response.json()};
}
async function login(cfg,fetcher){
 const x=await req(fetcher,cfg.url+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},
  body:JSON.stringify({email:cfg.email,password:cfg.password})});
 if(!x.ok||!x.value?.access_token||!x.value?.user?.id)failure('TEST_AUTH_REJECTED');
 return {token:x.value.access_token,userId:x.value.user.id};
}
async function rows(cfg,token,fetcher,path){
 const x=await req(fetcher,cfg.url+path,{headers:headers(cfg,token)});
 if(!x.ok||!Array.isArray(x.value))failure('RLS_READ_REJECTED');
 return x.value;
}
function casesPath(){return '/rest/v1/p37_lab_cases?select=id,owner_id,case_no,invoice_no,revision,original_untaxed,original_tax,original_gross,original_receivable,original_retention&id=eq.'+ID}
function allowancesPath(){return '/rest/v1/p37_lab_allowances?select=case_id,idempotency_key,discount_gross,receivable_reduction,retention_reduction&case_id=eq.'+ID}
function validCase(row,userId){
 return row?.id===ID&&row.owner_id===userId&&row.case_no===CASE&&row.invoice_no===INVOICE&&
 row.revision===0&&Number(row.original_untaxed)===1248000&&
 Number(row.original_tax)===62400&&Number(row.original_gross)===1310400&&
 Number(row.original_receivable)===1185600&&Number(row.original_retention)===124800;
}
export async function execute(cfg,fetcher=fetch){
 if(cfg?.url!==TARGET||cfg?.id!==ID)failure('INVALID_RUN_CONFIGURATION');
 const [a,b]=await Promise.all([login(cfg,fetcher),login(cfg,fetcher)]);
 if(a.token===b.token||a.userId!==b.userId)failure('SEPARATE_SESSION_PROOF_MISSING');
 const [ca,cb,allowances]=await Promise.all([
  rows(cfg,a.token,fetcher,casesPath()),
  rows(cfg,b.token,fetcher,casesPath()),
  rows(cfg,a.token,fetcher,allowancesPath())]);
 if(ca.length!==1||cb.length!==1||allowances.length!==0||
    !validCase(ca[0],a.userId)||!validCase(cb[0],b.userId))
   failure('STAGED_FIXTURE_OR_RLS_UNSAFE');
 const payload={p_case_id:ID,p_expected_revision:0,p_idempotency_key:'P37-9B-IDEMP-'+ID,
  p_discount_untaxed:26000,p_discount_tax:1300,
  p_receivable_reduction:24700,p_retention_reduction:2600,p_failpoint:null};
 const post=token=>req(fetcher,cfg.url+'/rest/v1/rpc/p37_lab_apply_synthetic_allowance',{
  method:'POST',headers:headers(cfg,token),body:JSON.stringify(payload)});
 // Two real HTTP requests race against the same committed lab fixture.
 // Test leaves at most one synthetic allowance; admin cleanup is mandatory.
 const [left,right]=await Promise.all([post(a.token),post(b.token)]);
 const wins=[left,right].filter(x=>x.ok),losses=[left,right].filter(x=>!x.ok);
 if(wins.length!==1||losses.length!==1||
  wins[0].value?.status!=='P37_LAB_TEST_COMMITTED_ONLY'||
  wins[0].value?.official_erp_posted!==false||
  Number(wins[0].value?.discount_gross)!==27300||
  Number(wins[0].value?.effective_gross)!==1283100||
  Number(wins[0].value?.effective_receivable)!==1160900||
  Number(wins[0].value?.effective_retention)!==122200||
  !String(losses[0].value?.message||'').includes('P37_LAB_DUPLICATE_OR_VERSION_CONFLICT'))
  failure('CONCURRENT_RPC_ACCEPTANCE_FAILED_CLEANUP_REQUIRED');
 const [casesAfter,allowancesAfter]=await Promise.all([
  rows(cfg,a.token,fetcher,casesPath()),
  rows(cfg,a.token,fetcher,allowancesPath())]);
 if(casesAfter.length!==1||casesAfter[0].revision!==1||
    allowancesAfter.length!==1||
    Number(allowancesAfter[0].discount_gross)!==27300||
    Number(allowancesAfter[0].receivable_reduction)!==24700||
    Number(allowancesAfter[0].retention_reduction)!==2600)
   failure('POSTCHECK_FAILED_CLEANUP_REQUIRED');
 return {status:'LAB_HTTP_RPC_RACE_PASS',clients:2,winners:1,conflicts:1,
    formalErpWrites:0,adminCleanupRequired:true,cleanupVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await execute(config(process.env));
  process.stdout.write(JSON.stringify(result)+'\n');
  process.stderr.write('P37-19G: ADMIN CLEANUP REQUIRED in kushe-auth-lab; verify 0/0 afterward.\n');
 }catch(_){
  process.stderr.write('P37-19G blocked/failed. If staged, run exact admin cleanup in isolated LAB; no credentials logged.\n');
  process.exitCode=1;
 }
}
