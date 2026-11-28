#!/usr/bin/env node
'use strict';
// Exact cloud-sync module, synthetic VM/transport. Database/RLS is tested separately.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'assets/js/cloud-sync.js'),'utf8');
const argv=process.argv.slice(2),output=argv.includes('--output')?argv[argv.indexOf('--output')+1]:'';
const report={schema:'k30-cloud-allowance-contract-v1',status:'RUNNING',productionDataTouched:false,realCloudSyncModule:true,realNetwork:false,realDatabase:false,checks:[],cases:[],failures:[],sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
const copy=v=>JSON.parse(JSON.stringify(v));
function check(name,value){report.checks.push({name,passed:!!value});if(!value)throw Error(name)}

function harness(options={}){
 let user='SYN-K30-CLOUD-OWNER',token='SYN-K30-LOCAL-NOT-A-CREDENTIAL',generation=0,epoch=0,online=true;
 let mode=options.mode||'trusted',ephemeral=mode==='temporary',remoteReads=0;
 let state={meta:{updatedAt:'2026-11-28T02:00:00.000Z'},settings:{},customers:[{id:'SYN-K30-CUSTOMER'}],billings:[],receivables:[],invoices:[],receipts:[],retentionReceipts:[]};
 let remote={data:copy(state),updated_at:'2026-11-28T02:00:00.000Z',sync_version:1,last_writer_mode:'trusted',last_base_sync_version:null};
 const entries=new Map(),requests=[],events=[];
 const trust=()=>entries.set('kushe_erp_device_trust_v1',JSON.stringify({schema:'kushe-device-trust-v1',version:1,mode,userId:user,updatedAt:'2026-11-28T02:00:00.000Z'}));trust();
 const capability={capability:'billing-allowances-v2',schema:'kushe.billing.allowances.v1',guardVersion:2,enabled:true};
 const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>copy(data)});
 const listeners=new Map(),shell={hidden:false,inert:false,contains:()=>false};
 const context={console,Object,JSON,AbortController,TextEncoder,Blob,URL,crypto:crypto.webcrypto,Node:class{},MutationObserver:class{observe(){}disconnect(){}},
  navigator:{get onLine(){return online}},location:{href:'http://synthetic.invalid/',hash:'',reload(){}},
  document:{visibilityState:'visible',documentElement:{},activeElement:null,getElementById:id=>id==='appShell'?shell:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame(){},
  KUSHE_PHASE1_CONFIG:{supabaseUrl:'https://k30.example.invalid',supabasePublishableKey:'SYN-K30-PUBLISHABLE-NOT-A-CREDENTIAL'},
  KusheAuthGate:{requireAuth:async()=>true,user:()=>({id:user}),session:()=>({access_token:token})},
  CustomEvent:class{constructor(type,value){this.type=type;this.detail=value?.detail}},
  addEventListener:(t,f)=>listeners.set(t,[...(listeners.get(t)||[]),f]),removeEventListener(){},
  dispatchEvent:event=>{events.push(event);for(const f of listeners.get(event.type)||[])f(event)},
  KuSheERPStore:{getState:()=>state,isEphemeralMode:()=>ephemeral,readCommittedSnapshot:async()=>({data:copy(state),baseline:'SYN-BASE-'+epoch}),
   loadEphemeralSnapshot:async value=>{state=copy(value);epoch++},remoteApplyReadiness:async()=>({safe:true,data:copy(state),baseline:'SYN-BASE-'+epoch}),
   getLastStoreTransactionResult:()=>null},
  fetch:async(url,init)=>{
   if(!url.startsWith('https://k30.example.invalid/'))throw Error('NON_SYNTHETIC_URL');
   const body=init.body?JSON.parse(init.body):null;requests.push({path:new URL(url).pathname,method:init.method,body});
   if(options.onRequest)await options.onRequest({url,body,api:control});
   if(url.includes('/rpc/erp_billing_allowance_capability'))return response(options.capability??capability,options.capabilityStatus??200);
   if(url.includes('/erp_states?')){remoteReads++;if(options.remoteRace&&remoteReads===2)remote.sync_version++;return response([remote])}
   if(url.includes('/rpc/erp_state_cas_write_')){
    const v3=url.endsWith('_v3');
    if(v3&&body.client_capability!=='billing-allowances-v2')return response({},400);
    if(body.expected_sync_version!==remote.sync_version)return response([{status:'CONFLICT',...remote}]);
    remote={data:copy(body.new_data),sync_version:remote.sync_version+1,updated_at:'2026-11-28T03:00:00.000Z',last_writer_mode:body.writer_mode,last_base_sync_version:body.expected_sync_version};
    return response([{status:'APPLIED',sync_version:remote.sync_version,updated_at:remote.updated_at,last_writer_mode:remote.last_writer_mode,last_base_sync_version:remote.last_base_sync_version}]);
   }
   throw Error('UNEXPECTED_SYNTHETIC_REQUEST');
  }};
 context.window=context;
 const control={context,requests,entries,get state(){return state},get remote(){return remote},
  setOnline:v=>{online=v},setUser:v=>{user=v;trust()},setToken:v=>{token=v},
  changeState:()=>{state={...state};epoch++},changeRemote:()=>{remote.data.customers.push({id:'SYN-REMOTE-ONLY'})},
  setMode:v=>{mode=v;ephemeral=v==='temporary';trust()}};
 vm.runInNewContext(source,context,{filename:'assets/js/cloud-sync.js'});
 control.cloud=context.KusheCloudSync;return control;
}

async function denied(name,operation,code){let caught;try{await operation()}catch(e){caught=e}check(name,!!caught&&(!code||caught.code===code))}
async function run(name,fn){try{await fn();report.cases.push({name,passed:true})}catch(e){report.cases.push({name,passed:false});report.failures.push({name,message:e.message,stack:e.stack})}}

(async()=>{
 await run('fresh synced preflight is read-only and bound',async()=>{
  const h=harness(),before=JSON.stringify(h.state);
  check('not ready before explicit check',!h.cloud.billingAllowanceWriteReadiness().ready);
  const ready=await h.cloud.prepareBillingAllowanceWrite();
  check('guard plus identical double read permits candidate',ready.ready&&ready.syncVersion===1);
  check('preflight writes no ERP state',JSON.stringify(h.state)===before&&h.requests.every(r=>!r.path.includes('cas_write')));
  h.changeState();check('any completed local operation invalidates preflight',!h.cloud.billingAllowanceWriteReadiness().ready);
 });
 for(const [name,options,code] of [
  ['missing-server-guard',{capabilityStatus:404},'ALLOWANCE_SERVER_REQUIRED'],
  ['disabled-trigger',{capability:{capability:'billing-allowances-v2',schema:'kushe.billing.allowances.v1',guardVersion:2,enabled:false}},'ALLOWANCE_SERVER_REQUIRED'],
  ['old-server-capability',{capability:{capability:'billing-allowances-v1',schema:'kushe.billing.allowances.v1',guardVersion:1,enabled:true}},'ALLOWANCE_SERVER_REQUIRED'],
  ['unknown-server-version',{capability:{capability:'billing-allowances-v2',schema:'kushe.billing.allowances.v1',guardVersion:3,enabled:true}},'ALLOWANCE_SERVER_REQUIRED'],
  ['temporary-cannot-formally-post',{mode:'temporary'},'DEVICE_TRUST_REQUIRED'],
  ['remote-changes-during-check',{remoteRace:true},'RACE_BLOCKED']]){
  await run(name,async()=>{const h=harness(options);await denied(name,()=>h.cloud.prepareBillingAllowanceWrite(),code);check(name+': never ready',!h.cloud.billingAllowanceWriteReadiness().ready);check(name+': zero cloud business writes',h.requests.every(r=>!r.path.includes('cas_write')))});
 }
 await run('unsynced-local-blocked',async()=>{const h=harness();h.changeRemote();await denied('unsynced local',()=>h.cloud.prepareBillingAllowanceWrite(),'ALLOWANCE_PREFLIGHT_REQUIRED')});
 for(const [name,change]of [['logout',h=>h.setToken('')],['token-rotation',h=>h.setToken('SYN-NEW')],['principal-switch',h=>h.setUser('SYN-OTHER')],['stop-session',h=>h.cloud.stopAutoBackup()],['offline',h=>h.setOnline(false)],['trust-revoked',h=>h.setMode('temporary')]]){
  await run(name+'-invalidates-readiness',async()=>{const h=harness();await h.cloud.prepareBillingAllowanceWrite();change(h);check(name+' refuses retained approval',!h.cloud.billingAllowanceWriteReadiness().ready)});
 }
 await run('principal-race-before-response',async()=>{let fired=false;const h=harness({onRequest:async({url,api})=>{if(!fired&&url.includes('capability')){fired=true;api.setUser('SYN-OTHER')}}});await denied('principal response race',()=>h.cloud.prepareBillingAllowanceWrite(),'AUTH_CHANGED');check('stale response cannot arm',!h.cloud.billingAllowanceWriteReadiness().ready)});
 for(const withLedger of [false,true]){
  await run('temporary-normal-sync-selects-v'+(withLedger?'3':'2'),async()=>{
   const h=harness({mode:'temporary'});await h.cloud.bootstrapTemporarySession();
   const next=copy(h.state);next.meta.updatedAt='2026-11-28T03:00:00.000Z';
   if(withLedger)next.meta.billingAllowances=[{schema:'kushe.billing.allowances.v1',id:'SYN-CONTRACT-ONLY'}];
   const result=await h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'});
   const writes=h.requests.filter(r=>r.path.includes('cas_write'));
   check('one selected CAS endpoint',writes.length===1&&writes[0].path.endsWith(withLedger?'_v3':'_v2'));
   check('server version verified',result.syncVersion===2&&JSON.stringify(result.data)===JSON.stringify(next));
   check('explicit capability only on new protocol',withLedger?writes[0].body.client_capability==='billing-allowances-v2':!('client_capability'in writes[0].body));
  });
 }
 await run('malformed-ledger-never-uploads',async()=>{const h=harness({mode:'temporary'});await h.cloud.bootstrapTemporarySession();const next=copy(h.state);next.meta.billingAllowances={invalid:true};await denied('bad ledger',()=>h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'}),'ALLOWANCE_LEDGER_INVALID');check('no malformed CAS',h.requests.every(r=>!r.path.includes('cas_write')))});
 await run('ledger-cas-fails-closed-without-server-guard',async()=>{const h=harness({mode:'temporary',capabilityStatus:404});await h.cloud.bootstrapTemporarySession();const next=copy(h.state);next.meta.billingAllowances=[{schema:'kushe.billing.allowances.v1',id:'SYN-CONTRACT-ONLY'}];await denied('no fallback to legacy CAS',()=>h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'}),'ALLOWANCE_SERVER_REQUIRED');check('no legacy CAS fallback',h.requests.every(r=>!r.path.includes('cas_write')))});

 for(const [key,schema] of Object.entries({commissionAgreements:'kushe.commission.agreement.v1',commissionFinalizations:'kushe.commission.finalization.v1',commissionPaymentTerms:'kushe.commission.payment-terms.v1'})){
  await run(key+'-alone-requires-v3',async()=>{
   const h=harness({mode:'temporary'});await h.cloud.bootstrapTemporarySession();const next=copy(h.state);next.meta[key]=[{schema,id:'SYN-POLICY-TRANSPORT-ONLY'}];
   await h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'});const writes=h.requests.filter(r=>r.path.includes('cas_write'));
   check(key+' chooses guarded protocol without any allowance',writes.length===1&&writes[0].path.endsWith('_v3')&&writes[0].body.client_capability==='billing-allowances-v2');
  });
  for(const bad of [null,{},[{schema:'unrecognized.v3'}]])await run(key+'-invalid-'+JSON.stringify(bad),async()=>{
   const h=harness({mode:'temporary'});await h.cloud.bootstrapTemporarySession();const next=copy(h.state);next.meta[key]=bad;
   await denied(key+' invalid cannot upload',()=>h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'}),'COMMISSION_POLICY_LEDGER_INVALID');
   check(key+' invalid zero writes',h.requests.every(r=>!r.path.includes('cas_write')));
  });
  await run(key+'-cannot-fallback',async()=>{
   const h=harness({mode:'temporary',capabilityStatus:404});await h.cloud.bootstrapTemporarySession();const next=copy(h.state);next.meta[key]=[{schema,id:'SYN-POLICY-TRANSPORT-ONLY'}];
   await denied(key+' missing guard',()=>h.cloud.commitTemporarySnapshot(next,{userId:'SYN-K30-CLOUD-OWNER'}),'ALLOWANCE_SERVER_REQUIRED');
   check(key+' no legacy protocol fallback',h.requests.every(r=>!r.path.includes('cas_write')));
  });
 }
 report.status=report.failures.length?'BLOCKED':'PASS';report.passCount=report.checks.filter(x=>x.passed).length;
 if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify({status:report.status,passCount:report.passCount,cases:report.cases.length,failures:report.failures},null,2));
 process.exitCode=report.status==='PASS'?0:1;
})().catch(e=>{console.error(e);process.exitCode=1});
