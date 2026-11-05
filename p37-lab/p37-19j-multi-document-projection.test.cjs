'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const p=require('./p37-19j-multi-document-projection.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const ID1={billingId:'P37-19-SYN-BILL-1',billingNo:'P37-19-SYN-NO-1',invoiceId:'P37-19-SYN-INVOICE-1',invoiceNo:'P37-19-SYN-INVOICENO-1',receivableId:'P37-19-SYN-AR-1'};
const o={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
const discount={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
const e={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
function inspector(){
 const context={window:{}};
 const code=fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8');
 vm.runInNewContext(code,context);
 return context.window.KusheP3718EffectiveLedger;
}
function fixture(){
 const b1={id:ID1.billingId,number:ID1.billingNo,date:'2026-11-01',project:'P37-19-SYN-PROJECT-A',
  receivableId:ID1.receivableId,invoiceStatus:'invoiced',invoiceNo:ID1.invoiceNo,
  amount:o.untaxed,preTaxAmount:o.untaxed,tax:o.tax,taxAmount:o.tax,
  grossTotal:o.gross,taxIncludedAmount:o.gross,total:o.receivable,retention:o.retention,retentionAmount:o.retention};
 const a1={id:ID1.receivableId,billingId:ID1.billingId,sourceNo:ID1.billingNo,
  invoiceNo:ID1.invoiceNo,amount:o.receivable,retention:o.retention,retentionAmount:o.retention,
  received:100000,retentionReceived:0,legacyReceived:0,legacyRetentionReceived:0,
  receivableCheques:[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE-A',
    status:'pending',revision:1,amount:350000,deductions:[{amount:50000}],reservedAmount:400000}]};
 const invoice={id:ID1.invoiceId,billingId:ID1.billingId,sourceType:'billing',sourceId:ID1.billingId,
  invoiceNumber:ID1.invoiceNo,status:'issued',netAmount:o.untaxed,amount:o.untaxed,
  taxAmount:o.tax,tax:o.tax,grossAmount:o.gross,total:o.gross};
 const voucher={schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',
  source:{...ID1,documentSnapshot:'snap-001',draftVersion:1},
  idempotencyKey:'billing-allowance::'+ID1.billingId+'::'+ID1.invoiceNo,
  billingId:ID1.billingId,receivableId:ID1.receivableId,invoiceNo:ID1.invoiceNo,
  original:o,allowance:discount,effective:e,
  posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',approvedBy:'P37-19-SYN-AUDIT',
   approvedAt:'2026-11-06T00:00:00+08:00',verificationReference:'P37-19-SYN-REVIEW'},
  voucher:{number:'P37-19-SYN-CREDIT-NOTE',date:'2026-11-06',proofLocation:'FAKE_SYNTHETIC_ONLY',
   verificationReference:'P37-19-SYN-REVIEW'}};
 const b2={id:'P37-19-SYN-BILL-2',number:'P37-19-SYN-NO-2',date:'2026-10-26',
  project:'P37-19-SYN-PROJECT-B',receivableId:'P37-19-SYN-AR-2',
  invoiceStatus:'no_invoice',invoiceNo:'',amount:50000,preTaxAmount:50000,
  tax:2500,taxAmount:2500,grossTotal:52500,taxIncludedAmount:52500,
  total:52500,retention:0,retentionAmount:0};
 const a2={id:'P37-19-SYN-AR-2',billingId:b2.id,sourceNo:b2.number,
  amount:52500,retention:0,retentionAmount:0,received:0,retentionReceived:0,receivableCheques:[]};
 return {schema:p.FIXTURE,scope:p.SCOPE,productionData:false,postingEnabled:false,cloudWrites:0,
  meta:{businessSnapshotRevision:{id:'P37-19-SYN-REV'}},
  billings:[b1,b2],receivables:[a1,a2],invoices:[invoice],
  billingAllowances:[voucher],
  receipts:[{id:'P37-19-SYN-RECEIPT-A',receivableId:ID1.receivableId,
    billingId:ID1.billingId,cashAmount:90000,deductionAmount:10000,
    deductions:[{amount:10000}],settlementAmount:100000}],
  retentionReceipts:[],bankTransactions:[]};
}
function run(state=fixture(),revision='P37-19-SYN-REV'){
 return p.inspect(state,{mode:'SYNTHETIC_READ_ONLY_BUNDLE',expectedRevisionId:revision,inspector:inspector()});
}
test('two invoices one allowance aggregate into a single consistent receivable/retention/cheque snapshot',()=>{
 const s=fixture(),before=JSON.stringify(s),r=run(s);
 assert.equal(r.count,2);assert.equal(r.summary.original.gross,1362900);
 assert.equal(r.summary.approved.gross,1335600);assert.equal(r.summary.reduction.gross,27300);
 assert.equal(r.summary.original.receivable,1238100);
 assert.equal(r.summary.approved.receivable,1213400);
 assert.equal(r.summary.principalReceived,100000);
 assert.equal(r.summary.principalOutstanding,1113400);
 assert.equal(r.summary.pendingChequeReserved,400000);
 assert.equal(r.summary.receiptInputMaximum,713400);
 assert.equal(r.summary.retentionOutstanding,122200);
 assert.equal(r.rows[0].receiptInputMax,660900);
 assert.equal(r.rows[1].receiptInputMax,52500);
 assert.equal(r.rows[0].allowanceReviewOnly,true);assert.equal(r.rows[1].allowanceReviewOnly,false);
 assert.equal(r.canPost,false);assert.equal(r.releaseBlocked,true);
 assert.equal(r.bankTransactionsAdded,0);assert.equal(r.cloudWrites,0);
 assert.equal(JSON.stringify(s),before);
});
test('monthly report uses adjusted untaxed revenue only for affected invoice period',()=>{
 const r=run();
 assert.deepEqual(r.revenueByMonth,[
  {month:'2026-10',originalUntaxed:50000,projectedUntaxed:50000,adjustment:0},
  {month:'2026-11',originalUntaxed:1248000,projectedUntaxed:1222000,adjustment:26000}]);
 assert.deepEqual(r.delta,{grossBilled:-27300,receivable:-24700,
  retention:-2600,monthlyUntaxedRevenue:-26000,tax:-1300,
  bankIncome:0,receiptCount:0,payroll:0,commissions:0});
});
test('one altered amount, wrong invoice, or fake allowance status cannot change KPI silently',()=>{
 const s=fixture();s.billings[0].total+=1;assert.throws(()=>run(s));
 s.billings[0].total-=1;s.invoices[0].invoiceNumber='OTHER';
 assert.throws(()=>run(s));
 s.invoices[0].invoiceNumber=ID1.invoiceNo;s.billingAllowances[0].status='PENDING';
 assert.throws(()=>run(s));
});
test('duplicated billed number, AR, invoice or counterfeit non-synthetic document is blocked',()=>{
 const s=fixture(),original=clone(s.billings[1]);
 s.billings[1].number=s.billings[0].number;assert.throws(()=>run(s),/重複/);
 s.billings[1]=original;s.receivables[1].id=s.receivables[0].id;assert.throws(()=>run(s));
 s.receivables[1].id='P37-19-SYN-AR-2';s.invoices.push(clone(s.invoices[0]));assert.throws(()=>run(s));
 s.invoices.pop();s.billings[0].id='REAL-CUSTOMER-ID';assert.throws(()=>run(s),/正式ERP/);
});
test('stale business revision and any real production-shaped state rejected',()=>{
 const s=fixture();
 assert.throws(()=>run(s,'P37-19-SYN-REV-OLD'),/快照/);
 for(const patch of [{productionData:true},{postingEnabled:true},{scope:'FORMAL_ERP'},{cloudWrites:1}])
  assert.throws(()=>run({...s,...patch}),/隔離/);
});
test('pending cheque over-reserved vs approved outstanding fails, never changes original state',()=>{
 const s=fixture(),before=JSON.stringify(s);
 s.receivables[0].receivableCheques[0].reservedAmount=1200000;
 assert.throws(()=>run(s));
 const full=clone(s);full.receivables[0].receivableCheques[0].amount=1200000;
 assert.throws(()=>run(full));
 assert.notEqual(JSON.stringify(s),before);
});
test('new receivable without allowance remains original even if invoice is not issued',()=>{
 const s=fixture();s.billingAllowances=[];
 const x=run(s);
 assert.equal(x.summary.reduction.gross,0);
 assert.equal(x.summary.approved.gross,1362900);
 assert.equal(x.summary.principalOutstanding,1138100);
 assert.equal(x.revenueByMonth[1].projectedUntaxed,1248000);
 assert.equal(x.releaseBlocked,true);
});
test('principal payments plus customer deductions are counted once, not bank receipt twice',()=>{
 const s=fixture();
 s.receipts[0].cashAmount=50000;s.receipts[0].deductionAmount=50000;
 s.receipts[0].deductions=[{amount:50000}];
 const x=run(s);
 assert.equal(x.summary.principalReceived,100000);
 assert.equal(x.delta.bankIncome,0);
 assert.equal(x.summary.receiptInputMaximum,713400);
});
test('old ERP bank/payroll/source objects stay untouched even on failure',()=>{
 const s=fixture();s.bankTransactions=[{id:'P37-19-SYN-BANK-HISTORY',amount:90000}];
 const before=JSON.stringify(s);
 const x=run(s);assert.equal(x.bankTransactionsAdded,0);assert.equal(JSON.stringify(s),before);
 s.receivables[0].received=120000;
 const after=JSON.stringify(s);
 assert.throws(()=>run(s));assert.equal(JSON.stringify(s),after);
});
