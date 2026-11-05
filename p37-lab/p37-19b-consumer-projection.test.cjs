'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const a=require('./p37-19-isolated-transaction.js'),b=require('./p37-19b-consumer-projection.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const source={billingId:'P37-19-SYN-BILL',billingNo:'P37-19-SYN-NO',invoiceId:'P37-19-SYN-INVID',invoiceNo:'P37-19-SYN-INVNO',receivableId:'P37-19-SYN-ARID'};
const protectedKeys=['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','customerDeductions','commissions','payroll','salaryPayments'];
function fixture(){
 return {schema:a.SCHEMA,scope:'P37_LAB_SYNTHETIC_ONLY',productionData:false,postingEnabled:false,cloudWrites:0,
  cases:[{id:'P37-19-SYN-CASE',source:copy(source),documentSnapshot:'snap-001',revision:0,
   original:{untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800},
   settled:{received:0,retentionReceived:0,pendingCheques:0}}],
  allowances:[],protectedRecords:Object.fromEntries(protectedKeys.map(k=>[k,[]]))};
}
function intent(){
 return {schema:a.INTENT,scope:'P37_LAB_SYNTHETIC_ONLY',postingEnabled:false,officiallyVerified:false,
  voucher:{kind:'SYNTHETIC_EVIDENCE_NOT_OFFICIAL',officiallyIssued:false},
  caseId:'P37-19-SYN-CASE',source:copy(source),expectedRevision:0,expectedDocumentSnapshot:'snap-001',
  idempotencyKey:'p37-19-synthetic::P37-19-SYN-CASE::P37-19-SYN-INVNO',
  reduction:{untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600}};
}
function setup(){const original=fixture(),result=a.simulate(original,intent()),scenario=b.newScenario(result);return {original,result,scenario};}
function action(result,scenario,kind,amount,id){
 return {kind,amount,idempotencyKey:'P37-19-SYN-ACT-'+id,
  expectedCaseRevision:result.revision,expectedScenarioRevision:scenario.revision,
  expectedSourceSnapshot:result.nextState.cases[0].documentSnapshot};
}
test('single approved source of truth; receivable/retention/KPI and bank deltas balanced',()=>{
 const {original,result,scenario}=setup(),before=JSON.stringify(result),model=b.project(result,scenario);
 assert.equal(model.view.originalGross,1310400);assert.equal(model.view.allowanceGross,27300);
 assert.equal(model.view.approvedGross,1283100);
 assert.equal(model.view.principalOutstanding,1160900);assert.equal(model.view.retentionOutstanding,122200);
 assert.equal(model.view.receiptInputMaximum,1160900);assert.equal(model.view.retentionInputMaximum,122200);
 assert.deepEqual(model.kpiDelta,{grossBilled:-27300,currentReceivable:-24700,retention:-2600,actualBankIncome:0,actualReceiptCount:0,actualChequeClearedCount:0,commissions:0,payroll:0});
 assert.equal(model.formalReceiptWriterConnected,false);assert.equal(model.formalChequeWriterConnected,false);
 assert.equal(model.cloudWrites,0);assert.equal(model.postedToERP,false);
 assert.equal(JSON.stringify(result),before);assert.equal(original.allowances.length,0);
});
test('partial and full simulated receipts; reject over-collection even by one dollar',()=>{
 const {result,scenario}=setup();
 const p=b.simulateAction(result,scenario,action(result,scenario,'receipt',100000,'R-1'));
 assert.equal(p.nextProjection.view.principalOutstanding,1060900);
 assert.equal(p.nextProjection.view.principalStatus,'模擬部分收款');
 const rest=b.simulateAction(result,p.nextScenario,action(result,p.nextScenario,'receipt',1060900,'R-2'));
 assert.equal(rest.nextProjection.view.principalOutstanding,0);
 assert.equal(rest.nextProjection.view.principalStatus,'模擬收清');
 assert.equal(rest.nextProjection.view.receiptInputMaximum,0);
 assert.throws(()=>b.simulateAction(result,p.nextScenario,action(result,p.nextScenario,'receipt',1060901,'R-3')),/超過/);
 assert.equal(rest.bankTransactionsAdded,0);assert.equal(rest.formalReceiptAdded,0);
});
test('cheque reservation reduces available receipt capacity, without reducing principal outstanding',()=>{
 const {result,scenario}=setup();
 const reserve=b.simulateAction(result,scenario,action(result,scenario,'cheque_reserve',600000,'C-1'));
 assert.equal(reserve.nextProjection.view.pendingChequeReserved,600000);
 assert.equal(reserve.nextProjection.view.principalOutstanding,1160900);
 assert.equal(reserve.nextProjection.view.receiptInputMaximum,560900);
 assert.throws(()=>b.simulateAction(result,reserve.nextScenario,action(result,reserve.nextScenario,'receipt',560901,'R-OVR')),/超過/);
 const cash=b.simulateAction(result,reserve.nextScenario,action(result,reserve.nextScenario,'receipt',560900,'R-OK'));
 assert.equal(cash.nextProjection.view.receiptInputMaximum,0);
 const clear=b.simulateAction(result,cash.nextScenario,action(result,cash.nextScenario,'cheque_clear',600000,'C-CLEAR'));
 assert.equal(clear.nextProjection.view.principalOutstanding,0);
 assert.equal(clear.nextProjection.view.pendingChequeReserved,0);
 assert.equal(clear.nextProjection.view.simulatedPrincipalReceived,1160900);
 assert.equal(clear.nextProjection.kpiDelta.actualBankIncome,0);
});
test('cheque release frees reserved amount; cannot clear or release more than reserved',()=>{
 const {result,scenario}=setup(),p=b.simulateAction(result,scenario,action(result,scenario,'cheque_reserve',80000,'C2'));
 assert.throws(()=>b.simulateAction(result,p.nextScenario,action(result,p.nextScenario,'cheque_clear',80001,'C3')),/超過/);
 assert.throws(()=>b.simulateAction(result,p.nextScenario,action(result,p.nextScenario,'cheque_release',80001,'C4')),/超過/);
 const released=b.simulateAction(result,p.nextScenario,action(result,p.nextScenario,'cheque_release',80000,'C5'));
 assert.equal(released.nextProjection.view.pendingChequeReserved,0);
 assert.equal(released.nextProjection.view.receiptInputMaximum,1160900);
});
test('retention settles independently from principal and does not create a bank transaction',()=>{
 const {result,scenario}=setup();
 const half=b.simulateAction(result,scenario,action(result,scenario,'retention',2200,'T1'));
 assert.equal(half.nextProjection.view.retentionOutstanding,120000);
 assert.equal(half.nextProjection.view.principalOutstanding,1160900);
 const all=b.simulateAction(result,half.nextScenario,action(result,half.nextScenario,'retention',120000,'T2'));
 assert.equal(all.nextProjection.view.retentionOutstanding,0);
 assert.equal(all.nextProjection.view.retentionStatus,'模擬收清');
 assert.throws(()=>b.simulateAction(result,half.nextScenario,action(result,half.nextScenario,'retention',120001,'T3')),/超過/);
 assert.equal(all.nextProjection.kpiDelta.actualReceiptCount,0);
});
test('duplicate action id and stale scenario/source/case revisions block',()=>{
 const {result,scenario}=setup();
 const first=b.simulateAction(result,scenario,action(result,scenario,'receipt',100,'R1'));
 assert.throws(()=>b.simulateAction(result,first.nextScenario,action(result,first.nextScenario,'receipt',100,'R1')),/重複|已執行/);
 const stale=action(result,first.nextScenario,'receipt',10,'R2');stale.expectedScenarioRevision=0;
 assert.throws(()=>b.simulateAction(result,first.nextScenario,stale),/過期/);
 const other=action(result,first.nextScenario,'receipt',10,'R3');other.expectedSourceSnapshot='old-snapshot';
 assert.throws(()=>b.simulateAction(result,first.nextScenario,other),/過期/);
 const changed=copy(first.nextScenario);changed.expectedCaseRevision+=1;
 assert.throws(()=>b.project(result,changed),/已變動/);
});
test('injected failure leaves both report and scenario byte-identical at every point',()=>{
 const {result,scenario}=setup(),beforeReport=JSON.stringify(result),beforeScenario=JSON.stringify(scenario);
 for(const failAt of ['AFTER_APPEND','AFTER_REVISION','BEFORE_RECHECK']){
  assert.throws(()=>b.simulateAction(result,scenario,action(result,scenario,'receipt',123,'FAIL'),{failAt}),/故障注入/);
  assert.equal(JSON.stringify(result),beforeReport);assert.equal(JSON.stringify(scenario),beforeScenario);
 }
 const again=b.simulateAction(result,scenario,action(result,scenario,'receipt',123,'RETRY'));
 assert.equal(again.nextProjection.view.principalOutstanding,1160777);
});
test('reject tampered amount/ledger, foreign data, fake posted status',()=>{
 const {result,scenario}=setup();
 const gross=copy(result);gross.nextState.allowances[0].effective.gross+=1;
 assert.throws(()=>b.project(gross,scenario));
 const fake=copy(result);fake.nextState.allowances[0].status='POSTED_VERIFIED';
 assert.throws(()=>b.project(fake,scenario));
 const foreign=copy(result);foreign.nextState.protectedRecords.receipts.push({id:'REAL-PAYMENT'});
 assert.throws(()=>b.project(foreign,scenario),/混入/);
 const bypass=copy(result);bypass.postedToERP=true;assert.throws(()=>b.project(bypass,scenario),/未入帳/);
 const changed=copy(result);changed.nextState.cases[0].documentSnapshot='stale';
 assert.throws(()=>b.project(changed,scenario),/已變動/);
});
test('P37-13 independent synthetic ledger reader matches P37-19B base and rejects overlimit',()=>{
 const {result,scenario}=setup(),model=b.project(result,scenario),c=result.nextState.cases[0],aRow=result.ledgerEntry,o=c.original,e=aRow.effective,d=aRow.reduction;
 const context={window:{}};
 for(const name of ['p37-billing-ledger-bridge.js','p37-billing-effective-consumers.js']){
  const code=fs.readFileSync(path.join(__dirname,'../assets/js',name),'utf8');vm.runInNewContext(code,context);
 }
 const s={billings:[{id:source.billingId,number:source.billingNo,receivableId:source.receivableId,invoiceNo:source.invoiceNo}],
  receivables:[{id:source.receivableId,billingId:source.billingId,sourceNo:source.billingNo,invoiceNo:source.invoiceNo,amount:o.receivable,retention:o.retention,retentionAmount:o.retention,received:0,retentionReceived:0}],
  invoices:[{id:source.invoiceId,billingId:source.billingId,invoiceNumber:source.invoiceNo}],
  billingAllowances:[]};
 const entry={schema:'kushe-p37-12-mock-entry-v1',status:'SYNTHETIC_NOT_POSTED',
  idempotencyKey:'billing-allowance::'+source.billingId+'::'+source.invoiceNo,
  source:{billingId:source.billingId,receivableId:source.receivableId,invoiceNo:source.invoiceNo,snapshot:c.documentSnapshot},
  billingId:source.billingId,receivableId:source.receivableId,invoiceId:source.invoiceId,invoiceNo:source.invoiceNo,
  original:o,reduction:d,effective:e,voucherStatus:'NOT_VERIFIED',postable:false};
 s.billingAllowances.push(entry);
 const bridge={ok:true,schema:'kushe-p37-12-synthetic-bridge-v1',postingEnabled:false,formalReceiptReaderConnected:false,cloudWrites:0,originalStateUnchanged:true,nextState:s,ledgerEntry:entry,effective:e};
 const legacy=context.window.KusheP3713EffectiveConsumers.project(bridge,context.window.KusheP3712LedgerBridge);
 assert.equal(legacy.receiptInputMax,model.view.receiptInputMaximum);
 assert.equal(legacy.retentionInputMax,model.view.retentionInputMaximum);
 assert.equal(legacy.kpiDelta.currentReceivableTotal,model.kpiDelta.currentReceivable);
 assert.equal(legacy.kpiDelta.retentionTotal,model.kpiDelta.retention);
 assert.throws(()=>context.window.KusheP3713EffectiveConsumers.checkPayment(legacy,'receipt',1160901),/超過/);
 assert.equal(legacy.formalReceiptWriterConnected,false);
});
