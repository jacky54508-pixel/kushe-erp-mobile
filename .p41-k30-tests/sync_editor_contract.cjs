#!/usr/bin/env node
'use strict';
// K30 extends only the two reviewed allowance writers; all K29 behavioral assertions retained.
// Actual cloud-sync module in an isolated VM. This is an event-contract test,
// not a browser, database, authentication or remote synchronization test.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),cp=require('child_process');
const BASE='15eff6fc574fb64480682656daf88dc7a906baa8';
const ROOT=path.resolve(__dirname,'..');
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const mode=arg('--mode','candidate'),output=arg('--output','');
if(!['baseline','candidate'].includes(mode))throw Error('Use --mode baseline or candidate');
const relative='assets/js/cloud-sync.js';
const baseline=cp.execFileSync('git',['show',BASE+':'+relative],{cwd:ROOT});
const bytes=mode==='baseline'?baseline:fs.readFileSync(arg('--cloud',path.join(ROOT,relative)));
const source=bytes.toString('utf8'),digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const additions={
  postBillingAllowance:['billing-allowance-ui.js'],
  reverseBillingAllowance:['billing-allowance-ui.js'],
  saveQuotationBundle:['quotations.js'],
  saveDailyUnbilledItems:['commissions.js'],
  saveVendor:['materials.js'],
  addInventoryReceipt:['materials.js'],
  recordInventoryReceiptPayable:['materials.js'],
  setMaterialOpeningStock:['materials.js'],
  saveReceivableCheque:['receivable-cheques.js','billing.js'],
  clearReceivableCheque:['receivable-cheques.js'],
  cancelReceivableCheque:['receivable-cheques.js'],
  saveExternalBillingDocument:['billing-groups.js'],
  archiveExternalBillingDocument:['billing-groups.js'],
  addProjectCommissionSettlement:['commissions.js']
};
const excluded=['mergeProject','saveHistoricalBillingDetails','createCommissionCorrectionReview','cleanupMaterialPayableTestData','repairMergedPayableHistory','p33Oct07CommissionRepair','repairDailyBillingLinks','recoverStore','replaceSnapshot','loadEphemeralSnapshot'];
const report={schema:'k30-cloud-editor-event-contract-v1',mode,baseCommit:BASE,status:'RUNNING',sourceSha256:digest(bytes),baselineSha256:digest(baseline),browserTest:false,persistenceTest:false,productionDataTouched:false,networkRequests:[],storageWrites:0,checks:[],cases:[],uiSources:{}};
function check(name,passed,details){report.checks.push({name,passed:Boolean(passed),...(details===undefined?{}:{details})});if(!passed)throw Error(name);}
function list(text,name){const match=text.match(new RegExp('const '+name+'\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\);'));if(!match)throw Error('Missing '+name);return new Set([...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));}

async function run(operationType,variant='valid'){
  const listeners={document:new Map(),window:new Map()},timers=[],observers=[];
  let principal='SYN-K29-OWNER',token=true,lastResult=null,reads=0,writes=0,network=0,openForm=false,openDetail=false,focused=false,detailHasInput=false;
  class SyntheticNode{}
  const target=new SyntheticNode(),shell={hidden:false,inert:false,contains:node=>node===target};
  const form={id:'SYN-K29-FORM',hidden:false,closest:()=>null,getClientRects:()=>[{}]};
  const detailOverlay={id:'SYN-K29-CHEQUE-DETAIL',hidden:false,isConnected:true,closest:()=>null,getClientRects:()=>[{}],querySelector:()=>detailHasInput?form:null};
  const outsideTarget=new SyntheticNode();outsideTarget.closest=selector=>selector==='.erp-detail-overlay,.cheque-overlay'?detailOverlay:null;
  const excludedTarget=new SyntheticNode();excludedTarget.closest=selector=>selector==='#cloudSyncModal,.auth-view,.auth-modal-layer'?detailOverlay:selector==='.erp-detail-overlay,.cheque-overlay'?detailOverlay:null;
  const closeButton={closest:selector=>selector==='.cheque-overlay'?detailOverlay:closeButton};
  const otherButton={closest:selector=>selector==='[data-module],[data-route],button,a'?otherButton:null};
  class SyntheticObserver{constructor(fn){this.fn=fn;this.active=false;observers.push(this)}observe(){this.active=true}disconnect(){this.active=false}}
  const mutate=()=>{for(const observer of observers)if(observer.active)observer.fn([{type:'childList'}])};
  const add=(scope,type,fn)=>{const entries=listeners[scope].get(type)||[];entries.push(fn);listeners[scope].set(type,entries)};
  const dispatch=(scope,type,event)=>{for(const fn of listeners[scope].get(type)||[])fn(event)};
  const storage={getItem:()=>null,setItem:()=>{writes++;throw Error('VM persistence forbidden')},removeItem:()=>{writes++;throw Error('VM persistence forbidden')}};
  const context={Node:SyntheticNode,MutationObserver:SyntheticObserver,localStorage:storage,sessionStorage:storage,navigator:{onLine:true},location:{hash:'',href:'http://synthetic.invalid/'},document:{visibilityState:'visible',documentElement:{},get activeElement(){return focused?{matches:()=>true}:null},getElementById:id=>id==='appShell'?shell:null,querySelectorAll:()=>[...(openForm?[form]:[]),...(openDetail?[detailOverlay]:[])],addEventListener:(t,f)=>add('document',t,f),removeEventListener:()=>{}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},URL,AbortController,TextEncoder,Blob,crypto:crypto.webcrypto};
  context.window=context;context.addEventListener=(t,f)=>add('window',t,f);context.removeEventListener=()=>{};
  context.fetch=()=>{network++;throw Error('VM network forbidden')};
  context.KusheAuthGate={user:()=>({id:principal}),session:()=>({access_token:token?'SYN-K29-NOT-A-CREDENTIAL':''})};
  const detail={operationId:'SYN-K29-OP',revisionId:'SYN-K29-REV',action:'SYN-K29 verified save'};
  const ready={safe:true,revision:{id:detail.revisionId,operationId:detail.operationId},data:{audit:[{action:detail.action}]}};
  context.KuSheERPStore={getLastStoreTransactionResult:()=>lastResult,isEphemeralMode:()=>variant.startsWith('temporary-'),remoteApplyReadiness:async()=>{
    reads++;
    if(variant==='principal-during-verification')principal='SYN-K29-OTHER';
    if(variant==='new-input-during-verification')dispatch('document','input',{type:'input',target});
    if(variant==='new-operation-during-verification')lastResult={...lastResult,operationId:'SYN-K29-NEWER'};
    if(variant==='session-reset-during-verification'||variant==='session-reset-during-recheck'&&reads===2)context.KusheCloudSync.stopAutoBackup();
    if(variant==='outside-overlay-input-during-verification')dispatch('document','input',{type:'input',target:outsideTarget});
    if(variant==='readiness-throws')throw Error('SYN-K29 read blocked');
    return ready;
  }};
  vm.runInNewContext(source,context,{filename:relative});
  const clean=context.KusheCloudSync.editorReadiness();
  if(variant==='already-observed-operation')lastResult={operationId:detail.operationId};
  dispatch('document','input',{type:'input',target});
  const dirty=context.KusheCloudSync.editorReadiness();
  lastResult={status:'COMMITTED',operationType,operationId:detail.operationId,revisionId:detail.revisionId,noChange:false};
  if(variant==='warning')lastResult.status='COMMITTED_WITH_NOTIFICATION_WARNING';
  if(variant==='rolled-back')lastResult.status='ROLLED_BACK';
  if(variant==='recovery-required')lastResult.status='RECOVERY_REQUIRED';
  if(variant==='no-change')lastResult.noChange=true;
  if(variant==='result-revision-mismatch')lastResult.revisionId='SYN-K29-OTHER';
  if(variant==='result-operation-mismatch')lastResult.operationId='SYN-K29-OTHER';
  if(variant==='durable-revision-mismatch')ready.revision.id='SYN-K29-OTHER';
  if(variant==='durable-operation-mismatch')ready.revision.operationId='SYN-K29-OTHER';
  if(variant==='durable-audit-mismatch')ready.data.audit[0].action='SYN-K29-OTHER';
  if(variant==='durable-not-ready')ready.safe=false;
  const delayed=['delayed-form-close','temporary-delayed-close','new-input-after-verified','principal-after-verified','durable-revision-after-verified','new-operation-after-verified','failed-after-verified','invalid-delayed-close','editable-dialog-close','readonly-detail-close','readonly-detail-navigation','focusout-after-verified','session-reset-after-verified','session-reset-during-recheck','outside-overlay-input-after-verified','excluded-modal-input-after-verified'].includes(variant);
  if(variant==='form-remains-open'||delayed)openForm=true;
  if(['readonly-detail-close','readonly-detail-navigation','editable-dialog-close'].includes(variant)){openForm=false;openDetail=true;detailHasInput=variant==='editable-dialog-close';}
  if(variant==='focusout-after-verified'){openForm=false;focused=true;}
  if(variant==='invalid-delayed-close')lastResult.status='ROLLED_BACK';
  if(variant==='input-remains-focused')focused=true;
  if(variant==='composition-active')dispatch('document','compositionstart',{type:'compositionstart',target});
  if(variant==='remote-apply')detail.syncOrigin='REMOTE_APPLY';
  if(variant==='recovery-action')detail.action='controlledRecovery';
  if(variant==='no-event-principal')token=false;
  if(variant.startsWith('temporary-')){detail.syncOrigin='TEMPORARY_CLOUD_COMMIT';lastResult.ephemeral=true;ready.ephemeral=true;}
  dispatch('window','kushe:data-updated',{detail});
  if(variant==='principal-before-verification')principal='SYN-K29-OTHER';
  if(variant==='new-input-before-verification')dispatch('document','input',{type:'input',target});
  if(variant==='session-reset-before-verification')context.KusheCloudSync.stopAutoBackup();
  while(timers.length)await timers.shift()();
  const afterFirstCallback=context.KusheCloudSync.editorReadiness(),firstReads=reads;
  if(delayed){
    check(operationType+'/'+variant+': visible surface stays dirty after initial verification',!afterFirstCallback.safe);
    // Arbitrary DOM changes while the surface is open must not poll storage.
    for(let i=0;i<50;i++)mutate();
    while(timers.length)await timers.shift()();
    check(operationType+'/'+variant+': open surface mutations do not reread durable state',reads===firstReads);
    if(variant==='new-input-after-verified')dispatch('document','input',{type:'input',target});
    if(variant==='principal-after-verified')principal='SYN-K29-OTHER';
    if(variant==='durable-revision-after-verified')ready.revision.id='SYN-K29-STALE';
    if(variant==='new-operation-after-verified')lastResult={...lastResult,operationId:'SYN-K29-NEWER'};
    if(variant==='failed-after-verified')lastResult={...lastResult,status:'ROLLED_BACK'};
    if(variant==='session-reset-after-verified')context.KusheCloudSync.stopAutoBackup();
    if(variant==='outside-overlay-input-after-verified')dispatch('document','input',{type:'input',target:outsideTarget});
    if(variant==='excluded-modal-input-after-verified')dispatch('document','input',{type:'input',target:excludedTarget});
    if(['readonly-detail-close','editable-dialog-close'].includes(variant))dispatch('document','click',{target:closeButton});
    if(variant==='readonly-detail-navigation')dispatch('document','click',{target:otherButton});
    openForm=false;openDetail=false;focused=false;detailOverlay.isConnected=false;
    mutate();
    if(variant==='focusout-after-verified')dispatch('document','focusout',{target});
    while(timers.length)await timers.shift()();
  }
  const final=context.KusheCloudSync.editorReadiness();
  check(operationType+'/'+variant+': starts clean and records an editor input',clean.safe&&!dirty.safe);
  check(operationType+'/'+variant+': no storage or network effects',writes===0&&network===0);
  report.storageWrites+=writes;
  return {operationType,variant,before:dirty,afterFirstCallback,after:final,readinessReads:reads,principal,activeObservers:observers.filter(x=>x.active).length,storageWrites:writes,networkRequests:network};
}

(async()=>{
  try{
    const actual=list(source,'USER_COMMIT_OPERATIONS'),old=list(baseline.toString('utf8'),'USER_COMMIT_OPERATIONS'),writers=list(fs.readFileSync(path.join(ROOT,'assets/js/erp-store.js'),'utf8'),'STORE_WRITER_NAMES');
    check('existing explicit normal writers remain allowed',[...old].every(name=>actual.has(name)));
    check('only reviewed normal writers are added',[...actual].filter(name=>!old.has(name)).sort().join('|')===(mode==='candidate'?Object.keys(additions).sort().join('|'):''));
    for(const [name,files] of Object.entries(additions)){
      check(name+': actual Store transaction wrapper exists',writers.has(name));
      const sites=[];
      for(const file of files){const lines=fs.readFileSync(path.join(ROOT,'assets/js',file),'utf8').split('\n');for(let i=0;i<lines.length;i++)if(new RegExp('\\bstore\\.'+name+'\\s*\\(').test(lines[i]))sites.push({file:'assets/js/'+file,line:i+1});}
      check(name+': verified normal UI call site',sites.length>0);report.uiSources[name]=sites;
      for(const variant of ['valid','warning','rolled-back','recovery-required','no-change','form-remains-open','input-remains-focused','composition-active','result-revision-mismatch','result-operation-mismatch','durable-revision-mismatch','durable-operation-mismatch','durable-audit-mismatch','durable-not-ready','already-observed-operation','new-input-before-verification','new-input-during-verification','new-operation-during-verification','readiness-throws','remote-apply','recovery-action']){
        const result=await run(name,variant),expected=mode==='candidate'&&['valid','warning'].includes(variant);
        check(name+'/'+variant+': exact release decision',result.after.safe===expected,result);report.cases.push(result);
      }
    }
    for(const name of [...excluded,'SYN-K29-UNKNOWN-WRITER']){
      check(name+': remains outside normal writer whitelist',!actual.has(name));
      const result=await run(name);check(name+': cannot release editor',!result.after.safe,result);report.cases.push(result);
    }
    for(const variant of ['valid','principal-before-verification','principal-during-verification','no-event-principal','session-reset-before-verification','session-reset-during-verification','outside-overlay-input-during-verification']){
      const result=await run('saveQuotation',variant),expected=variant==='valid'||mode==='baseline';
      check('existing writer/'+variant+': baseline race is reproduced or candidate refuses stale principal',result.after.safe===expected,result);report.cases.push(result);
    }
    const temporary=await run('saveQuotation','temporary-valid');check('temporary verified cloud commit retains previous behavior',temporary.after.safe,temporary);report.cases.push(temporary);
    for(const name of ['saveQuotation','saveDailyUnbilledItems']){
      for(const variant of ['delayed-form-close','readonly-detail-close','focusout-after-verified','new-input-after-verified','principal-after-verified','durable-revision-after-verified','new-operation-after-verified','failed-after-verified','invalid-delayed-close','editable-dialog-close','readonly-detail-navigation','session-reset-after-verified','session-reset-during-recheck','outside-overlay-input-after-verified','excluded-modal-input-after-verified']){
        const result=await run(name,variant),expected=mode==='candidate'&&['delayed-form-close','readonly-detail-close','focusout-after-verified','excluded-modal-input-after-verified'].includes(variant);
        check(name+'/'+variant+': a delayed close still needs original principal generation and fresh durable evidence',result.after.safe===expected,result);
        check(name+'/'+variant+': terminal decision releases its observer',result.activeObservers===0,result);report.cases.push(result);
      }
    }
    const delayedUnknown=await run('SYN-K29-UNKNOWN-WRITER','delayed-form-close');check('unknown writer is never made trusted by closing a form',!delayedUnknown.after.safe&&delayedUnknown.activeObservers===0,delayedUnknown);report.cases.push(delayedUnknown);
    const delayedTemporary=await run('saveQuotation','temporary-delayed-close');check('temporary commit delayed close requires the same verified cloud evidence',delayedTemporary.after.safe===(mode==='candidate')&&delayedTemporary.activeObservers===0,delayedTemporary);report.cases.push(delayedTemporary);
    report.status=mode==='baseline'?'K29_SYNC_BASELINE_REPRODUCED':'K30_SYNC_EVENT_CONTRACT_PASS';
  }catch(error){report.status='BLOCKED';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
  finally{
    report.passCount=report.checks.filter(row=>row.passed).length;report.failCount=report.checks.filter(row=>!row.passed).length;
    if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
    console.log(JSON.stringify({status:report.status,mode,passCount:report.passCount,failCount:report.failCount,cases:report.cases.length,sourceSha256:report.sourceSha256,error:report.error},null,2));
  }
})();
