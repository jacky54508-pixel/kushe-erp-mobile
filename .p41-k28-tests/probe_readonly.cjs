'use strict';
// Supplemental source/fixture check only. No browser, IndexedDB, or write API is exercised.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const argv=process.argv.slice(2),take=key=>argv[argv.indexOf(key)+1];
const source=fs.readFileSync(take('--store'),'utf8'),fixtures=JSON.parse(fs.readFileSync(take('--fixtures'),'utf8'));
const output={schema:'k28-memory-only-readonly-probe-v1',browserTest:false,persistenceTest:false,productionDataTouched:false,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases:[]};
(async()=>{
 for(const [name,input] of Object.entries(fixtures)){
  const {data,values}=input;
  if(data?.meta?.k28Synthetic!==true||data.employees.some(e=>!String(e.id).startsWith('SYN-K28-')))throw Error('SYNTHETIC_ONLY');
  const map=new Map(),storage={getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),get length(){return map.size}};
  const sandbox={console,Intl,Date,JSON,Math,Number,Boolean,String,Array,Object,Map,Set,WeakSet,Promise,RegExp,Error,TypeError,Blob,TextEncoder,TextDecoder,URL,structuredClone,crypto:crypto.webcrypto,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,navigator:{},location:{hostname:'127.0.0.1'},dispatchEvent(){},addEventListener(){},removeEventListener(){},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}},KUSHE_PHASE1_CONFIG:{},KusheAuthGate:{session:()=>({access_token:'SYN-K28-LOCAL-ONLY'}),user:()=>({id:'SYN-K28-OWNER'}),companyContext:()=>({userId:'SYN-K28-OWNER',companyId:'SYN-K28-COMPANY',role:'owner',status:'active',shadowVerified:true})}};
  sandbox.window=sandbox;vm.runInContext(source,vm.createContext(sandbox),{timeout:3000,filename:'exact-erp-store-source.js'});
  try{
   const store=sandbox.KuSheERPStore;await store.loadEphemeralSnapshot(data,{userId:'SYN-K28-OWNER',syncVersion:1});
   const before=JSON.stringify(store.getState()),review=store.dailyDraftReview(values,'',store.getState()),groups=store.monthlyPayrollGroups(),plan=store.salaryPaymentPlan('SYN-K28-PAYROLL-PAID');
   const appendPlan=store.dailyPaidMonthAppendPlan?store.dailyPaidMonthAppendPlan('SYN-K28-EMP-A',values.date):null;
   if(JSON.stringify(store.getState())!==before)throw Error('READONLY_MUTATED_STATE');
   output.cases.push({name,ok:true,review,appendPlan,group:groups.find(x=>x.employeeId==='SYN-K28-EMP-A'&&x.month==='2026-04'),paymentPlan:plan,unchanged:true});
  }catch(error){output.cases.push({name,ok:false,error:{code:error.code||'',message:error.message,stack:error.stack}})}
 }
 fs.writeFileSync(take('--output'),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({browserTest:false,persistenceTest:false,sourceSha256:output.sourceSha256,cases:output.cases.map(x=>({name:x.name,ok:x.ok,issues:x.review?.issues,paymentBlockers:x.paymentPlan?.blockers,error:x.error}))},null,2));
 if(output.cases.some(x=>!x.ok))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
