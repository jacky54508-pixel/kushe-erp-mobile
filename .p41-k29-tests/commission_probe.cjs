'use strict';
// Supplemental readonly resolver check. Never a browser, persistence, or writer pass.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const args=process.argv.slice(2),take=key=>args[args.indexOf(key)+1];
const source=fs.readFileSync(take('--store'),'utf8'),fixtures=JSON.parse(fs.readFileSync(take('--fixtures'),'utf8'));
const report={schema:'k29-commission-readonly-probe-v1',browserTest:false,persistenceTest:false,writerTest:false,productionDataTouched:false,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases:[]};
(async()=>{
 for(const [name,data] of Object.entries(fixtures)){
  if(data?.meta?.k29Synthetic!==true||data.employees.some(row=>!String(row.id).startsWith('SYN-K29-COMMISSION-')))throw Error('SYNTHETIC_ONLY');
  const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),get length(){return map.size}};
  const sandbox={console,Intl,Date,JSON,Math,Number,Boolean,String,Array,Object,Map,Set,WeakSet,Promise,RegExp,Error,TypeError,Blob,TextEncoder,TextDecoder,URL,structuredClone,crypto:crypto.webcrypto,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,navigator:{},location:{hostname:'127.0.0.1'},dispatchEvent(){},addEventListener(){},removeEventListener(){},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}},KUSHE_PHASE1_CONFIG:{},KusheAuthGate:{session:()=>({access_token:'SYN-K29-LOCAL-ONLY'}),user:()=>({id:'SYN-K29-OWNER'}),companyContext:()=>({userId:'SYN-K29-OWNER',companyId:'SYN-K29-COMPANY',role:'owner',status:'active',shadowVerified:true})}};
  sandbox.window=sandbox;vm.runInContext(source,vm.createContext(sandbox),{timeout:5000,filename:'exact-candidate-erp-store.js'});
  const store=sandbox.KuSheERPStore;await store.loadEphemeralSnapshot(data,{userId:'SYN-K29-OWNER',syncVersion:1});
  const before=JSON.stringify(store.getState());let amounts,error;
  try{amounts=store.manualCommissionBillingAmounts('SYN-K29-COMMISSION-BILL-A')}catch(caught){error=caught.message}
  const blocked=['invalid-alias','missing-gross','duplicate-id'].includes(name);
  const valid=blocked?Boolean(error):!error&&amounts.preTaxAmount===20000&&amounts.grossTotal===(name==='no-invoice'?20000:21000);
  const unchanged=before===JSON.stringify(store.getState());report.cases.push({name,passed:valid&&unchanged,blocked,error,amounts,unchanged});
 }
 report.passed=report.cases.every(row=>row.passed);
 fs.writeFileSync(take('--output'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
