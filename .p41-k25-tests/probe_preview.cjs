'use strict';
// Pure in-memory source/fixture contract probe. This is NOT a browser or storage test.
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const args=process.argv.slice(2),take=k=>args[args.indexOf(k)+1];
const source=fs.readFileSync(take('--store'),'utf8');
const inputs=JSON.parse(fs.readFileSync(take('--fixtures'),'utf8'));
const out={schema:'k25-memory-only-preview-contract-probe-v1',browserTest:false,persistenceTest:false,productionDataTouched:false,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),cases:[]};
(async()=>{
 for(const [name,data] of Object.entries(inputs)){
  if(data?.meta?.k25Synthetic!==true||data.employees.some(e=>!e.id.startsWith('SYN-K25-')))throw Error('SYNTHETIC_ONLY');
  const values=new Map(),storage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),get length(){return values.size}};
  const sandbox={console,Intl,Date,JSON,Math,Number,Boolean,String,Array,Object,Map,Set,WeakSet,Promise,RegExp,Error,TypeError,Blob,TextEncoder,TextDecoder,URL,structuredClone,crypto:crypto.webcrypto,setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,navigator:{},location:{hostname:'127.0.0.1'},dispatchEvent(){},addEventListener(){},removeEventListener(){},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}},KUSHE_PHASE1_CONFIG:{},KusheAuthGate:{session:()=>({access_token:'SYN-K25-LOCAL-ONLY'}),user:()=>({id:'SYN-K25-OWNER'}),companyContext:()=>({userId:'SYN-K25-OWNER',companyId:'SYN-K25-COMPANY',role:'owner',status:'active',shadowVerified:true})}};
  sandbox.window=sandbox;const context=vm.createContext(sandbox);vm.runInContext(source,context,{timeout:2000,filename:'unchanged-candidate-erp-store.js'});
  try{
   await sandbox.KuSheERPStore.loadEphemeralSnapshot(data,{userId:'SYN-K25-OWNER',syncVersion:1});
   const before=JSON.stringify(sandbox.KuSheERPStore.getState());
   const result=sandbox.KuSheERPStore.commissionCorrectionPreview();
   const filtered=sandbox.KuSheERPStore.commissionCorrectionPreview({groupId:'SYN-K25-GROUP'});
   if(JSON.stringify(sandbox.KuSheERPStore.getState())!==before)throw Error('PREVIEW_MUTATED_INPUT');
   const cases=result.groups.map(g=>({groupId:g.groupId,conditionalBase:g.conditionalBase,verifiedBase:g.verifiedBase,holdReasons:g.holdReasons,workers:g.workers.map(w=>({employeeId:w.employeeId,original:w.original,conditionalTarget:w.conditionalTarget,conditionalDifference:w.conditionalDifference,verifiedTarget:w.verifiedTarget,verifiedDifference:w.verifiedDifference,holdReasons:w.holdReasons,houses:w.houses.map(h=>({house:h.house,original:h.original,conditionalTarget:h.conditionalTarget,conditionalDifference:h.conditionalDifference,verifiedTarget:h.verifiedTarget,verifiedDifference:h.verifiedDifference,holdReasons:h.holdReasons,canCreateReview:h.canCreateReview}))}))}));
   out.cases.push({name,ok:true,readOnly:result.readOnly,canCreateReview:result.canCreateReview,canApply:result.canApply,canPost:result.canPost,canPay:result.canPay,issues:result.issues,summary:result.summary,filteredSummary:filtered.summary,filteredGroupIds:filtered.groups.map(g=>g.groupId),snapshotStableAcrossFilter:result.snapshot===filtered.snapshot,groups:cases});
  }catch(error){out.cases.push({name,ok:false,error:{code:error.code,message:error.message,stack:error.stack}})}
 }
 fs.writeFileSync(take('--output'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({browserTest:false,persistenceTest:false,cases:out.cases.map(c=>({name:c.name,ok:c.ok,error:c.error?.code||c.error?.message,groups:c.groups?.length,holdCodes:[...new Set((c.groups||[]).flatMap(g=>[...g.holdReasons,...g.workers.flatMap(w=>[...w.holdReasons,...w.houses.flatMap(h=>h.holdReasons)])]).map(x=>x.code))]}))},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
