'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('./core.js');
const effective=require('./effective-accounting.js');

function sample(status='invoice_pending'){
  const tax=status==='no_invoice'?0:5000,gross=100000+tax,retention=5000;
  const invoiceNo=status==='invoiced'?'SYN-INV-001':'';
  return {
    __p39Synthetic:core.FIXTURE,meta:{revision:1,p39SyntheticSchema:core.FIXTURE},
    billings:[{id:'SYN-B',number:'SYN-B001',receivableId:'SYN-AR',note:'old note',
      invoiceStatus:status,invoiceNo,retentionRate:5,retentionBase:'preTax',
      preTaxAmount:100000,taxAmount:tax,grossTotal:gross,retentionAmount:retention,
      total:gross-retention}],
    receivables:[{id:'SYN-AR',billingId:'SYN-B',sourceNo:'SYN-B001',
      invoiceNo,amount:gross-retention,retentionAmount:retention,
      grossTotal:gross,untaxedAmount:100000,taxAmount:tax,received:0,
      retentionReceived:0,receivableCheques:[]}],
    invoices:status==='no_invoice'?[]:[{id:'SYN-I',billingId:'SYN-B',
      sourceType:'billing',sourceId:'SYN-B',status:status==='invoiced'?'issued':'pending',
      number:invoiceNo,netAmount:100000,taxAmount:tax,grossAmount:gross}],
    receipts:[],retentionReceipts:[],bankTransactions:[],commissions:[],payroll:[],
    salaryPayments:[],billingAllowances:[],billingNoteRevisions:[],
    customerDeductions:[],externalBillingDocuments:[]
  };
}
function posted(status='invoice_pending'){
  const state=sample(status),params={billingId:'SYN-B',role:'owner',
    approvedGross:status==='no_invoice'?90000:94500,reason:'議價測試'};
  if(status==='invoiced')params.voucher={synthetic:true,issued:true,testVerified:true,
    type:'electronic',number:'SYN-ALLOW-001',date:'2026-11-11'};
  const plan=core.allowancePlan(state,params);
  return {before:state,plan,after:core.apply(state,plan).state};
}
const blocked=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('原資料沒有折讓：應收與保留款完全使用原始金額',()=>{
  const state=sample(),v=effective.forReceivable(state,'SYN-AR');
  assert.deepEqual({
    amount:v.receivable,retention:v.retention,outstanding:v.outstanding,
    retentionOutstanding:v.retentionOutstanding,hasAllowance:v.hasAllowance
  },{amount:100000,retention:5000,outstanding:100000,
    retentionOutstanding:5000,hasAllowance:false});
  assert.deepEqual(effective.summarize(state),{count:0,gross:0,untaxed:0,
    tax:0,receivable:0,retention:0});
});
test('獨立折讓後所有應收計算與一張原請款對應',()=>{
  const {before,after}=posted();
  const source=effective.inspect(after,'SYN-B'),row=effective.forReceivable(after,'SYN-AR');
  assert.equal(source.receivable,90000);
  assert.equal(row.outstanding,90000);
  assert.equal(source.retention,4500);
  assert.equal(row.retentionOutstanding,4500);
  assert.equal(source.discountReceivable,10000);
  assert.equal(source.discountRetention,500);
  assert.deepEqual(before.receivables,after.receivables);
  assert.deepEqual(before.billings,after.billings);
  assert.deepEqual(before.invoices,after.invoices);
  assert.deepEqual(before.bankTransactions,after.bankTransactions);
  assert.deepEqual(effective.summarize(after),{count:1,gross:10500,untaxed:10000,
    tax:500,receivable:10000,retention:500});
});
test('同一有效餘額供收款與保留款上限共用',()=>{
  const {after}=posted();
  assert.equal(effective.receiptLimit(after,'SYN-AR','receivable',90000).remainingAfter,0);
  assert.equal(effective.receiptLimit(after,'SYN-AR','retention',4500).remainingAfter,0);
  blocked(()=>effective.receiptLimit(after,'SYN-AR','receivable',90001),'EFFECTIVE_OVER_COLLECTION');
  blocked(()=>effective.receiptLimit(after,'SYN-AR','retention',4501),'EFFECTIVE_OVER_COLLECTION');
  blocked(()=>effective.receiptLimit(after,'SYN-AR','retention',0),'EFFECTIVE_OVER_COLLECTION');
});
test('收款進度變更應連動折讓有效餘額，但不直接寫銀行',()=>{
  const {after}=posted();
  after.receivables[0].received=20000;
  after.receivables[0].retentionReceived=1000;
  const v=effective.forReceivable(after,'SYN-AR');
  assert.equal(v.outstanding,70000);
  assert.equal(v.retentionOutstanding,3500);
  assert.equal(effective.receiptLimit(after,'SYN-AR','receivable',70000).remainingAfter,0);
  assert.equal(after.bankTransactions.length,0);
});
test('已收款超過折讓後可收上限直接拒絕',()=>{
  const {after}=posted();after.receivables[0].received=90001;
  blocked(()=>effective.forReceivable(after,'SYN-AR'),'EFFECTIVE_OVER_SETTLED');
});
test('同張請款重複折讓拒絕',()=>{
  const {after}=posted();
  after.billingAllowances.push(structuredClone(after.billingAllowances[0]));
  blocked(()=>effective.inspect(after,'SYN-B'),'EFFECTIVE_DUPLICATE_LEDGER');
  blocked(()=>effective.summarize(after),'EFFECTIVE_DUPLICATE_LEDGER');
});
test('不同來源應收混入折讓拒絕',()=>{
  const {after}=posted();
  after.billingAllowances[0].receivableId='SYN-OTHER';
  blocked(()=>effective.inspect(after,'SYN-B'),'EFFECTIVE_SOURCE_LINK_INVALID');
});
test('折讓金額與原始單或借貸不相符拒絕',()=>{
  const {after}=posted();
  after.billingAllowances[0].discount.receivable+=1;
  blocked(()=>effective.forReceivable(after,'SYN-AR'),'EFFECTIVE_LEDGER_MISMATCH');
});
test('虛構折讓不能被當成真實 ERP 正式折讓',()=>{
  const {after}=posted();delete after.__p39Synthetic;
  blocked(()=>effective.forReceivable(after,'SYN-AR'),'EFFECTIVE_UNVERIFIED_LEDGER');
});
test('無法辨識的正式折讓狀態必須阻擋，不得靜默忽略',()=>{
  const {after}=posted();after.billingAllowances[0].status='POSTED_VERIFIED';
  blocked(()=>effective.forReceivable(after,'SYN-AR'),'EFFECTIVE_UNVERIFIED_LEDGER');
});
test('發票已開與免開發票皆可準確對齊虛構測試值',()=>{
  for(const status of ['invoiced','no_invoice']){
    const {before,after}=posted(status);
    const result=effective.inspect(after,'SYN-B');
    assert.equal(result.effective.gross,status==='no_invoice'?90000:94500);
    assert.equal(result.effective.tax,status==='no_invoice'?0:4500);
    assert.deepEqual(before.invoices,after.invoices);
  }
});
test('沒有折讓的舊式獨立應收不依賴請款資料存在',()=>{
  const s={billings:[],receivables:[{id:'legacy-ar',amount:500,retentionAmount:0,received:200}],billingAllowances:[]};
  const v=effective.forReceivable(s,'legacy-ar');
  assert.equal(v.outstanding,300);assert.equal(v.hasAllowance,false);
});
