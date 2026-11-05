'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const p=require('./p37-19-isolated-transaction.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const source={billingId:'P37-19-SYN-BILL',billingNo:'P37-19-SYN-NO',invoiceId:'P37-19-SYN-INVID',invoiceNo:'P37-19-SYN-INVNO',receivableId:'P37-19-SYN-ARID'};
const names=['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','customerDeductions','commissions','payroll','salaryPayments'];
function fixture(){return {schema:p.SCHEMA,scope:'P37_LAB_SYNTHETIC_ONLY',productionData:false,postingEnabled:false,cloudWrites:0,
 cases:[{id:'P37-19-SYN-CASE',source:copy(source),documentSnapshot:'snap-001',revision:0,
 original:{untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800},
 settled:{received:0,retentionReceived:0,pendingCheques:0}}],
 allowances:[],protectedRecords:Object.fromEntries(names.map(k=>[k,[]]))};}
function intent(){return {schema:p.INTENT,scope:'P37_LAB_SYNTHETIC_ONLY',postingEnabled:false,officiallyVerified:false,
 voucher:{kind:'SYNTHETIC_EVIDENCE_NOT_OFFICIAL',officiallyIssued:false},
 caseId:'P37-19-SYN-CASE',source:copy(source),expectedRevision:0,expectedDocumentSnapshot:'snap-001',
 idempotencyKey:'p37-19-synthetic::P37-19-SYN-CASE::P37-19-SYN-INVNO',
 reduction:{untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600}};}
test('27,300 discount balanced, immutable original and all unrelated arrays preserved',()=>{
 const s=fixture(),before=JSON.stringify(s),r=p.simulate(s,intent());
 assert.deepEqual(r.effective,{untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200});
 assert.equal(r.revision,1);assert.equal(JSON.stringify(s),before);
 assert.deepEqual(r.nextState.protectedRecords,s.protectedRecords);
 assert.equal(r.postingEnabled,false);assert.equal(r.postedToERP,false);assert.equal(r.cloudWrites,0);
});
test('CAS, duplicate, stale snapshot and changed original source denied',()=>{
 const s=fixture(),i=intent(),r=p.simulate(s,i);
 assert.throws(()=>p.simulate(r.nextState,i),/CAS|已有折讓/);
 assert.throws(()=>p.simulate(s,{...i,expectedRevision:2}),/CAS/);
 assert.throws(()=>p.simulate(s,{...i,expectedDocumentSnapshot:'old'}),/快照/);
 assert.throws(()=>p.simulate(s,{...i,source:{...i.source,invoiceNo:'P37-19-SYN-OTHER'}}),/來源/);
 const duplicate=fixture();duplicate.cases.push(copy(duplicate.cases[0]));
 assert.throws(()=>p.simulate(duplicate,i),/重複/);
});
test('tax imbalances, negative money, existing collections and cheque block',()=>{
 const s=fixture(),i=intent();
 assert.throws(()=>p.simulate(s,{...i,reduction:{...i.reduction,tax:1301}}),/不平衡/);
 assert.throws(()=>p.simulate(s,{...i,reduction:{...i.reduction,retention:-1}}),/有效金額/);
 for(const k of ['received','retentionReceived','pendingCheques']){
  const x=fixture();x.cases[0].settled[k]=1;
  assert.throws(()=>p.simulate(x,i),/已有收款/);
 }
});
test('real ERP / claimed official voucher / cloud writes are blocked',()=>{
 const s=fixture(),i=intent();
 assert.throws(()=>p.simulate({...s,scope:'FORMAL_ERP'},i),/隔離/);
 assert.throws(()=>p.simulate({...s,productionData:true},i),/隔離/);
 assert.throws(()=>p.simulate({...s,cloudWrites:1},i),/隔離/);
 assert.throws(()=>p.simulate(s,{...i,officiallyVerified:true}),/憑證/);
 assert.throws(()=>p.simulate(s,{...i,voucher:{kind:'electronic',officiallyIssued:true}}),/憑證/);
});
test('three failure injections roll back without modifying original input',()=>{
 for(const failAt of ['AFTER_INSERT','AFTER_REVISION','BEFORE_VERIFY']){
  const s=fixture(),before=JSON.stringify(s);
  assert.throws(()=>p.simulate(s,intent(),{failAt}),/故障注入/);
  assert.equal(JSON.stringify(s),before);
  assert.equal(p.simulate(s,intent()).revision,1);
 }
});
test('P37-18 read-only projection recognizes a synthetic ledger-shaped contract only',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8');
 const context={window:{}};vm.runInNewContext(code,context);
 const reader=context.window.KusheP3718EffectiveLedger;
 const o=fixture().cases[0].original,d=intent().reduction;
 const e=Object.fromEntries(Object.keys(o).map(k=>[k,o[k]-d[k]]));
 const b={id:source.billingId,number:source.billingNo,receivableId:source.receivableId,invoiceNo:source.invoiceNo,invoiceStatus:'invoiced',amount:o.untaxed,preTaxAmount:o.untaxed,tax:o.tax,taxAmount:o.tax,grossTotal:o.gross,taxIncludedAmount:o.gross,total:o.receivable,retention:o.retention,retentionAmount:o.retention};
 const ar={id:source.receivableId,billingId:source.billingId,sourceNo:source.billingNo,invoiceNo:source.invoiceNo,amount:o.receivable,retention:o.retention,retentionAmount:o.retention,received:0,retentionReceived:0};
 const inv={id:source.invoiceId,billingId:source.billingId,invoiceNumber:source.invoiceNo,status:'issued',netAmount:o.untaxed,amount:o.untaxed,taxAmount:o.tax,tax:o.tax,grossAmount:o.gross,total:o.gross};
 const s={billings:[b],receivables:[ar],invoices:[inv],billingAllowances:[]};
 assert.equal(reader.inspect(s,source.receivableId).status,'ORIGINAL_UNADJUSTED');
 s.billingAllowances=[{schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',
  source:{...source,documentSnapshot:'snap-001',draftVersion:1},
  idempotencyKey:'billing-allowance::'+source.billingId+'::'+source.invoiceNo,
  billingId:source.billingId,receivableId:source.receivableId,invoiceNo:source.invoiceNo,
  original:o,allowance:d,effective:e,
  posting:{accountantApproved:true,commitRevision:'SYN-REV',approvedBy:'SYN-APPROVER',approvedAt:'2026-11-05T12:00:00+08:00',verificationReference:'SYN-REF'},
  voucher:{number:'P37-19-SYN-VOUCH',date:'2026-11-05',proofLocation:'SYNTHETIC_ONLY',verificationReference:'SYN-REF'}}];
 const before=JSON.stringify(s),result=reader.inspect(s,source.receivableId);
 assert.equal(result.status,'POSTED_RECORD_CONTRACT_REVIEW_ONLY');
 assert.equal(result.proposed.receivableOutstanding,1160900);
 assert.equal(result.proposed.retentionOutstanding,122200);
 assert.equal(result.proposed.gross,1283100);
 assert.equal(result.appliedToERP,false);assert.equal(result.formalReceiptWriterConnected,false);
 assert.equal(JSON.stringify(s),before);
});
