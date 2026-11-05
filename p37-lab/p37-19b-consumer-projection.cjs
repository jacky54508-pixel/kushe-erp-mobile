'use strict';
const base=require('./p37-19-isolated-transaction.js');
(function buildP3719B(core,moduleRef){
'use strict';
const SCHEMA='kushe-p37-19b-synthetic-consumer-v1';
const SCENARIO='kushe-p37-19b-synthetic-scenario-v1';
const ACTION='kushe-p37-19b-synthetic-action-v1';
const SOURCE_KEYS=['billingId','billingNo','invoiceId','invoiceNo','receivableId'];
const MONEY_KEYS=['untaxed','tax','gross','receivable','retention'];
const PROTECTED=['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','customerDeductions','commissions','payroll','salaryPayments'];
const text=v=>String(v??'').trim();
const clone=v=>JSON.parse(JSON.stringify(v));
function stop(reason){throw new Error('P37-19B '+reason)}
function whole(v,name){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)stop(name+'不是有效非負金額');return v}
function reportCheck(report){
 if(!report||report.ok!==true||report.mode!=='COPY_ONLY_NOT_POSTED'||report.postingEnabled!==false||
    report.postedToERP!==false||report.officiallyVerified!==false||report.cloudWrites!==0||
    report.originalUnchanged!==true||!report.nextState||!report.ledgerEntry)stop('只允許 P37-19A 完成的未入帳合成模擬');
 const state=report.nextState;core.check(state);
 if(state.cases.length!==1||state.allowances.length!==1)stop('只能核對單筆隔離案例，禁止合併未知資料');
 for(const k of PROTECTED)if(state.protectedRecords[k].length!==0)stop('測試資料混入其他帳務記錄 '+k);
 const c=state.cases[0],a=state.allowances[0];
 if(!Number.isSafeInteger(report.revision)||report.revision!==c.revision||c.revision!==1||
    a.schema!==core.ENTRY||a.status!=='SYNTHETIC_ONLY_NOT_POSTED'||
    a.caseId!==c.id||a.idempotencyKey!=='p37-19-synthetic::'+c.id+'::'+c.source.invoiceNo||
    JSON.stringify(report.ledgerEntry)!==JSON.stringify(a)||
    JSON.stringify(report.effective)!==JSON.stringify(a.effective)||
    JSON.stringify(c.effective)!==JSON.stringify(a.effective)||
    JSON.stringify(c.original)!==JSON.stringify(a.original)||
    JSON.stringify(c.source)!==JSON.stringify(a.source))stop('原始請款、合成折讓帳本與版本不一致');
 for(const k of SOURCE_KEYS)if(!/^P37-19-SYN-[A-Z0-9-]+$/.test(text(c.source[k])))stop('非合成請款來源：'+k);
 for(const k of MONEY_KEYS){
   const o=whole(c.original[k],'原始'+k),d=whole(a.reduction[k],'折讓'+k),e=whole(a.effective[k],'核定'+k);
   if(o-d!==e)stop('折讓與核定金額無法勾稽 '+k);
 }
 for(const row of [c.original,a.reduction,a.effective])if(row.untaxed+row.tax!==row.gross||row.receivable+row.retention!==row.gross)stop('未稅、含稅與保留款不平衡');
 if(a.reduction.gross<=0||a.reduction.gross>=c.original.gross||
    a.postedToERP!==false||a.cloudWrites!==0||a.bankTransactionsAdded!==0)stop('折讓來源狀態不安全');
 return {state,c,entry:a};
}
function newScenario(report){
 const {c}=reportCheck(report);
 return {schema:SCENARIO,scope:'P37_LAB_SYNTHETIC_ONLY',caseId:c.id,
   expectedCaseRevision:c.revision,documentSnapshot:c.documentSnapshot,
   revision:0,actions:[],postingEnabled:false,postedToERP:false,cloudWrites:0};
}
function replay(report,scenario){
 const {c,entry}=reportCheck(report),e=entry.effective;
 if(!scenario||scenario.schema!==SCENARIO||scenario.scope!=='P37_LAB_SYNTHETIC_ONLY'||
    scenario.caseId!==c.id||scenario.expectedCaseRevision!==c.revision||
    scenario.documentSnapshot!==c.documentSnapshot||
    !Number.isSafeInteger(scenario.revision)||scenario.revision<0||
    !Array.isArray(scenario.actions)||scenario.actions.length!==scenario.revision||
    scenario.postingEnabled!==false||scenario.postedToERP!==false||scenario.cloudWrites!==0)
    stop('隔離預覽版本或來源已變動');
 const allowed=new Set(['schema','scope','caseId','expectedCaseRevision','documentSnapshot','revision','actions','postingEnabled','postedToERP','cloudWrites']);
 if(Object.keys(scenario).some(k=>!allowed.has(k)))stop('模擬狀態含有未授權欄位');
 let received=0,retentionReceived=0,pendingCheque=0;
 const used=new Set();
 scenario.actions.forEach((act,index)=>{
   if(!act||act.schema!==ACTION||act.status!=='SIMULATED_NOT_SAVED'||
      act.caseId!==c.id||act.version!==index+1||
      !/^P37-19-SYN-ACT-[A-Z0-9-]{1,80}$/.test(text(act.idempotencyKey))||
      used.has(act.idempotencyKey))stop('模擬收款操作識別、順序或防重複資料異常');
   used.add(act.idempotencyKey);
   const n=whole(act.amount,'模擬操作金額');
   if(n<=0)stop('模擬操作金額必須大於零');
   const outstanding=e.receivable-received,remaining=e.retention-retentionReceived;
   if(outstanding<0||remaining<0||pendingCheque>outstanding)stop('模擬已超額');
   if(act.kind==='receipt'){
     if(n>outstanding-pendingCheque)stop('超過折讓後且扣除待兌現支票的可收餘額');
     received+=n;
   }else if(act.kind==='retention'){
     if(n>remaining)stop('超過核定保留款');
     retentionReceived+=n;
   }else if(act.kind==='cheque_reserve'){
     if(n>outstanding-pendingCheque)stop('待兌現支票預留超過餘額');
     pendingCheque+=n;
   }else if(act.kind==='cheque_release'){
     if(n>pendingCheque)stop('取消支票超過已預留金額');
     pendingCheque-=n;
   }else if(act.kind==='cheque_clear'){
     if(n>pendingCheque)stop('支票兌現金額超過已預留金額');
     pendingCheque-=n;received+=n;
   }else stop('不支援的模擬收款操作');
 });
 const outstanding=e.receivable-received,retentionOutstanding=e.retention-retentionReceived;
 const available=outstanding-pendingCheque;
 if(outstanding<0||retentionOutstanding<0||available<0||
    e.receivable+e.retention!==e.gross||
    outstanding+received!==e.receivable||
    retentionOutstanding+retentionReceived!==e.retention||
    available+pendingCheque!==outstanding)stop('收款、保留款、支票與核定金額不平衡');
 return {c,entry,received,retentionReceived,pendingCheque,outstanding,retentionOutstanding,available};
}
function project(report,scenario){
 const sourceBefore=JSON.stringify(report),scenarioBefore=JSON.stringify(scenario);
 const z=replay(report,scenario),c=z.c,a=z.entry,o=c.original,e=a.effective,d=a.reduction;
 const view={
  billingId:c.source.billingId,billingNo:c.source.billingNo,invoiceId:c.source.invoiceId,
  originalInvoiceNo:c.source.invoiceNo,receivableId:c.source.receivableId,
  originalGross:o.gross,allowanceGross:d.gross,approvedGross:e.gross,
  originalReceivable:o.receivable,effectiveReceivable:e.receivable,
  originalRetention:o.retention,effectiveRetention:e.retention,
  simulatedPrincipalReceived:z.received,principalOutstanding:z.outstanding,
  pendingChequeReserved:z.pendingCheque,receiptInputMaximum:z.available,
  simulatedRetentionReceived:z.retentionReceived,retentionOutstanding:z.retentionOutstanding,
  retentionInputMaximum:z.retentionOutstanding,
  principalStatus:z.outstanding===0?'模擬收清':z.received>0?'模擬部分收款':'未收',
  retentionStatus:z.retentionOutstanding===0?'模擬收清':z.retentionReceived>0?'模擬部分收回':'保留中'
 };
 const kpi={
  billedGross:e.gross,receivableTotal:e.receivable,retentionTotal:e.retention,
  principalOutstanding:z.outstanding,retentionOutstanding:z.retentionOutstanding,
  pendingChequeReserved:z.pendingCheque,availableToReceive:z.available,
  discountGross:d.gross,discountReceivable:d.receivable,discountRetention:d.retention
 };
 const delta={grossBilled:-d.gross,currentReceivable:-d.receivable,retention:-d.retention,
  actualBankIncome:0,actualReceiptCount:0,actualChequeClearedCount:0,commissions:0,payroll:0};
 if(-delta.grossBilled!==-delta.currentReceivable-delta.retention)stop('報表折讓總額與應收、保留款不平衡');
 if(JSON.stringify(report)!==sourceBefore||JSON.stringify(scenario)!==scenarioBefore)stop('來源模擬資料遭修改');
 return {schema:SCHEMA,scope:'P37_LAB_SYNTHETIC_ONLY',mode:'ISOLATED_READ_ONLY_PROJECTION',
  postingEnabled:false,postedToERP:false,officiallyVerified:false,cloudWrites:0,
  formalReceiptWriterConnected:false,formalChequeWriterConnected:false,formalKpiReaderConnected:false,
  sourceSnapshot:c.documentSnapshot,caseRevision:c.revision,scenarioRevision:scenario.revision,
  view,kpi,kpiDelta:delta,protectedRecordsUnchanged:true,simulatedActions:scenario.actions.length};
}
function simulateAction(report,scenario,input,options={}){
 const beforeReport=JSON.stringify(report),beforeScenario=JSON.stringify(scenario);
 const now=project(report,scenario);
 if(!input||typeof input!=='object'||Array.isArray(input)||
    input.expectedCaseRevision!==now.caseRevision||
    input.expectedScenarioRevision!==now.scenarioRevision||
    input.expectedSourceSnapshot!==now.sourceSnapshot)
    stop('編輯視窗的版本已過期');
 const key=text(input.idempotencyKey);
 if(!/^P37-19-SYN-ACT-[A-Z0-9-]{1,80}$/.test(key))stop('模擬操作鍵格式錯誤');
 if(scenario.actions.some(a=>a.idempotencyKey===key))stop('相同操作已執行過，不可重複');
 if(!['receipt','retention','cheque_reserve','cheque_release','cheque_clear'].includes(input.kind))stop('操作類別不支援');
 const amount=whole(input.amount,'本次模擬金額');
 if(amount===0)stop('本次模擬金額必須大於零');
 const failAt=text(options.failAt);
 if(failAt&&!['AFTER_APPEND','AFTER_REVISION','BEFORE_RECHECK'].includes(failAt))stop('未知故障注入');
 const next=clone(scenario);
 next.actions.push({schema:ACTION,status:'SIMULATED_NOT_SAVED',
  caseId:scenario.caseId,idempotencyKey:key,kind:input.kind,amount,version:scenario.revision+1});
 if(failAt==='AFTER_APPEND')stop('隔離故障注入 AFTER_APPEND');
 next.revision+=1;
 if(failAt==='AFTER_REVISION')stop('隔離故障注入 AFTER_REVISION');
 if(failAt==='BEFORE_RECHECK')stop('隔離故障注入 BEFORE_RECHECK');
 const projected=project(report,next);
 if(JSON.stringify(report)!==beforeReport||JSON.stringify(scenario)!==beforeScenario)stop('原始來源遭修改');
 return {ok:true,mode:'SIMULATED_NOT_SAVED',postedToERP:false,cloudWrites:0,
  bankTransactionsAdded:0,formalReceiptAdded:0,nextScenario:next,nextProjection:projected};
}
const api=Object.freeze({newScenario,project,simulateAction,SCHEMA,SCENARIO,ACTION});
if(moduleRef&&moduleRef.exports)moduleRef.exports=api;
return api;
})(base,module);
