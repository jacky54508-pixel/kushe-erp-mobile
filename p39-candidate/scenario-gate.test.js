'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gate=require('./scenario-gate.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function base(status='invoice_pending'){
 const issued=status==='invoiced',noInvoice=status==='no_invoice';
 const invoiceNo=issued?'SYN-INV-001':'',tax=noInvoice?0:5000,gross=100000+tax;
 return {
  __p39Synthetic:gate.FIXTURE,meta:{p39SyntheticSchema:gate.FIXTURE,revision:1},
  billings:[{id:'SYN-B',number:'SYN-BILL-001',receivableId:'SYN-AR',
    invoiceStatus:status,invoiceNo,customer:'SYN-CUST',project:'SYN-PROJECT',
    preTaxAmount:100000,taxAmount:tax,grossTotal:gross,total:gross-5000,
    retentionAmount:5000,retentionBase:'preTax',retentionRate:5}],
  receivables:[{id:'SYN-AR',billingId:'SYN-B',sourceNo:'SYN-BILL-001',
    invoiceNo,amount:gross-5000,retentionAmount:5000,received:0,retentionReceived:0}],
  invoices:noInvoice?[]:[{id:'SYN-I',sourceType:'billing',sourceId:'SYN-B',
    billingId:'SYN-B',status:issued?'issued':'pending',number:invoiceNo}],
  receipts:[],retentionReceipts:[],bankTransactions:[],receivableCheques:[],
  cheques:[],customerDeductions:[],billingAllowances:[],externalBillingDocuments:[],
  commissions:[],commissionSettlements:[],payroll:[],salaryPayments:[]
 };
}
const codes=x=>gate.inspect(x,'SYN-B').blockers.map(b=>b.code);
const has=(x,code)=>assert.ok(codes(x).includes(code),JSON.stringify(codes(x)));
test('待開票未收款：合成候選通過，但正式入帳永遠未啟用',()=>{
 const r=gate.inspect(base(),'SYN-B');
 assert.equal(r.status,'SYNTHETIC_PREVIEW_ELIGIBLE');
 assert.equal(r.candidateEligible,true);
 assert.equal(r.productionPostingAllowed,false);
 assert.equal(r.cloudWriteAvailable,false);
 assert.deepEqual(r.blockers,[]);
});
test('免開發票未收款：合成候選通過',()=>{
 const r=gate.inspect(base('no_invoice'),'SYN-B');
 assert.equal(r.candidateEligible,true);
 assert.equal(r.invoiceState,'no_invoice');
});
test('已開票即使模擬憑證完整也要先關閉過帳',()=>{
 const s=base('invoiced'),r=gate.inspect(s,'SYN-B');
 assert.equal(r.candidateEligible,false);
 has(s,'ISSUED_INVOICE_NEEDS_OFFICIAL_PLATFORM');
});
test('收款、保留款、歷史收款全部阻擋',()=>{
 for(const key of ['received','retentionReceived','legacyReceived','legacyRetentionReceived']){
  const s=base();s.receivables[0][key]=1;
  has(s,'COLLECTED_OR_RETENTION_PAID');
 }
});
test('收款及保留款歷程不因原應收合計是零而忽略',()=>{
 let s=base();s.receipts.push({id:'SYN-RECEIPT',receivableId:'SYN-AR'});
 has(s,'SETTLEMENT_HISTORY_PRESENT');
 s=base();s.retentionReceipts.push({id:'SYN-RET',billingId:'SYN-B'});
 has(s,'SETTLEMENT_HISTORY_PRESENT');
});
test('銀行流水有來源識別即阻擋',()=>{
 const s=base();s.bankTransactions.push({id:'SYN-BANK',sourceNo:'SYN-BILL-001'});
 has(s,'BANK_TRANSACTION_LINKED');
});
test('待兌現支票、已兌現歷程及預留款均阻擋',()=>{
 let s=base();s.receivables[0].receivableCheques=[{id:'SYN-Q1',status:'cancelled'}];
 has(s,'CHEQUE_HISTORY_PRESENT');
 s=base();s.receivables[0].pendingChequeAmount=20000;
 has(s,'CHEQUE_HISTORY_PRESENT');
 s=base();s.cheques.push({id:'SYN-Q2',receivableId:'SYN-AR',status:'pending'});
 has(s,'CHEQUE_HISTORY_PRESENT');
});
test('對外合併請款保存在 state 或 meta 都要阻擋',()=>{
 let s=base();s.externalBillingDocuments.push({sourceIds:['SYN-B']});
 has(s,'EXTERNAL_BILLING_GROUP');
 s=base();s.meta.externalBillingDocuments=[{targetBillingId:'SYN-B'}];
 has(s,'EXTERNAL_BILLING_GROUP');
});
test('建商扣款、其他費用不得誤當成一般議價折讓',()=>{
 const s=base();s.customerDeductions.push({id:'SYN-CUT',billingId:'SYN-B'});
 has(s,'CUSTOMER_DEDUCTION');
});
test('同案場的抽成與已結算抽成都須人工核對',()=>{
 let s=base();s.commissions.push({id:'SYN-COM',project:'SYN-PROJECT'});
 has(s,'COMMISSION_PAYROLL_REVIEW_REQUIRED');
 s=base();s.commissionSettlements.push({id:'SYN-COMSETTLED',projectId:'SYN-PROJECT'});
 has(s,'COMMISSION_PAYROLL_REVIEW_REQUIRED');
});
test('薪資及銀行發薪資料存在時不得自動重算',()=>{
 let s=base();s.payroll.push({id:'SYN-PAY',billingId:'SYN-B'});
 has(s,'COMMISSION_PAYROLL_REVIEW_REQUIRED');
 s=base();s.salaryPayments.push({id:'SYN-SAL',projectId:'SYN-PROJECT'});
 has(s,'COMMISSION_PAYROLL_REVIEW_REQUIRED');
});
test('同單已存在折讓記錄不得重複',()=>{
 const s=base();s.billingAllowances=[{id:'SYN-AL',billingId:'SYN-B'}];
 has(s,'ALLOWANCE_ALREADY_RECORDED');
});
test('已開票與待開票歷程不符、免開卻有發票須阻擋',()=>{
 let s=base();s.invoices[0].status='issued';
 has(s,'INVOICE_LIFECYCLE_MISMATCH');
 s=base();s.billings[0].invoiceNo='SYN-INV-001';
 has(s,'PENDING_HAS_INVOICE_NUMBER');
 s=base('no_invoice');s.invoices.push({id:'SYN-I',billingId:'SYN-B',status:'pending'});
 has(s,'NO_INVOICE_HAS_INVOICE_ROW');
});
test('來源識別不唯一直接拒絕，不用隱含第一筆',()=>{
 const s=base();s.receivables.push(clone(s.receivables[0]));
 assert.throws(()=>gate.inspect(s,'SYN-B'),e=>e.code==='P39_SCENARIO_SOURCE_NOT_UNIQUE');
});
test('資料集合格式或金額格式錯誤必須停止',()=>{
 let s=base();s.receipts={};
 assert.throws(()=>gate.inspect(s,'SYN-B'),e=>e.code==='P39_SCENARIO_INVALID_COLLECTION');
 s=base();s.receivables[0].received='100';
 assert.throws(()=>gate.inspect(s,'SYN-B'),e=>e.code==='P39_SCENARIO_INVALID_AMOUNT');
});
test('絕不允許真實 ERP 快照',()=>{
 const s=base();delete s.__p39Synthetic;
 assert.throws(()=>gate.inspect(s,'SYN-B'),e=>e.code==='P39_SCENARIO_SYNTHETIC_ONLY');
});
test('只讀、不修改原始資料',()=>{
 const s=base(),before=clone(s);gate.inspect(s,'SYN-B');
 assert.deepEqual(s,before);
});
