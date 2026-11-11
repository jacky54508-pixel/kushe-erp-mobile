'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const core=require('./core.js'),review=require('./voucher-review.js');
function input(invoiceStatus){
  const tax=invoiceStatus==='no_invoice'?0:5000,gross=100000+tax;
  const invoiceNo=invoiceStatus==='invoiced'?'SYN-INV-0001':'';
  const s={
    __p39Synthetic:core.FIXTURE,meta:{revision:1,p39SyntheticSchema:core.FIXTURE},
    billings:[{id:'SYN-B1',receivableId:'SYN-AR1',number:'SYN-B20261111-001',
      preTaxAmount:100000,taxAmount:tax,grossTotal:gross,retentionAmount:5000,
      total:gross-5000,retentionRate:5,retentionBase:'preTax',
      invoiceStatus,invoiceNo,note:'synthetic'}],
    receivables:[{id:'SYN-AR1',billingId:'SYN-B1',sourceNo:'SYN-B20261111-001',
      amount:gross-5000,retentionAmount:5000,untaxedAmount:100000,
      taxAmount:tax,grossTotal:gross,invoiceNo,received:0,retentionReceived:0}],
    invoices:invoiceStatus==='no_invoice'?[]:[{id:'SYN-I1',billingId:'SYN-B1',sourceType:'billing',
      sourceId:'SYN-B1',number:invoiceNo,status:invoiceStatus==='invoiced'?'issued':'pending',
      netAmount:100000,taxAmount:tax,grossAmount:gross}],
    receipts:[],retentionReceipts:[],bankTransactions:[],commissions:[],payroll:[],
    salaryPayments:[],billingAllowances:[],billingNoteRevisions:[]
  };
  const voucher=invoiceStatus==='invoiced'?{synthetic:true,issued:true,testVerified:true,
    type:'electronic',number:'SYN-ALL-0001',date:'2026-11-11'}:undefined;
  const plan=core.allowancePlan(s,{billingId:'SYN-B1',role:'owner',reason:'虛構建商議價',
    approvedGross:invoiceStatus==='no_invoice'?90000:94500,voucher});
  const evidence={synthetic:true,agreementRef:'SYN-AGREE-0001',reviewerRef:'SYN-OWNER-0001',
    reviewedAt:'2026-11-11',...(voucher?{externalAllowance:{
      number:voucher.number,date:voucher.date,type:voucher.type,originalInvoiceNo:invoiceNo,
      transport:'SIMULATED_ELECTRONIC_FLOW',synthetic:true}}:{})};
  return {plan,evidence};
}
const rejected=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('待開票虛構議價證據通過，但不宣稱稅務驗證或正式入帳',()=>{
  const {plan,evidence}=input('invoice_pending');
  const result=review.inspect(plan,evidence);
  assert.equal(result.kind,'SYNTHETIC_MANUAL_EVIDENCE_REVIEW');
  assert.equal(result.productionPostingAllowed,false);
  assert.equal(result.externallyVerified,false);
  assert.equal(result.formalTaxFilingUpdated,false);
  assert.equal(result.voucher,null);
});
test('免開發票虛構議價證據可通過且不得產生稅額',()=>{
  const {plan,evidence}=input('no_invoice');
  const result=review.inspect(plan,evidence);
  assert.equal(plan.discount.tax,0);
  assert.equal(result.voucher,null);
});
test('已開電子發票測試折讓須有原票識別及虛構電子證明',()=>{
  const {plan,evidence}=input('invoiced');
  const result=review.inspect(plan,evidence);
  assert.equal(result.voucher.originalInvoiceNo,plan.invoiceNo);
  assert.equal(result.voucher.officialPlatformConfirmed,false);
  assert.equal(result.productionPostingAllowed,false);
});
test('已開票缺外部證據直接拒絕',()=>{
  const {plan,evidence}=input('invoiced');
  delete evidence.externalAllowance;
  rejected(()=>review.inspect(plan,evidence),'P39_INVOICE_VOUCHER_MISMATCH');
});
test('已開票折讓單號錯、日期錯、原發票錯都拒絕',()=>{
  for(const field of ['number','date','originalInvoiceNo']){
    const {plan,evidence}=input('invoiced');
    evidence.externalAllowance[field]='SYN-OTHER-0001';
    rejected(()=>review.inspect(plan,evidence),'P39_INVOICE_VOUCHER_MISMATCH');
  }
});
test('正式稅務確認欄位不能由前端測試標記冒充',()=>{
  for(const field of ['actualAuthorityVerified','productionAuthorized']){
    const {plan,evidence}=input('invoiced');
    evidence[field]=true;
    rejected(()=>review.inspect(plan,evidence),'P39_EXTERNAL_VERIFICATION_FORBIDDEN');
  }
});
test('未開票不得偷夾有價折讓證明',()=>{
  const {plan,evidence}=input('invoice_pending');
  evidence.externalAllowance={synthetic:true};
  rejected(()=>review.inspect(plan,evidence),'P39_UNEXPECTED_TAX_VOUCHER');
});
test('不允許虛構證據缺少雙方同意及覆核者',()=>{
  for(const key of ['agreementRef','reviewerRef']){
    const {plan,evidence}=input('invoiced');
    evidence[key]='';
    rejected(()=>review.inspect(plan,evidence),'P39_EVIDENCE_REF_INVALID');
  }
});
test('嚴格檢查日期有效性',()=>{
  const {plan,evidence}=input('invoiced');
  evidence.reviewedAt='2026-02-30';
  rejected(()=>review.inspect(plan,evidence),'P39_EVIDENCE_DATE_INVALID');
});
test('借貸不一致與無效折讓不能產生審查結果',()=>{
  const {plan,evidence}=input('invoiced');
  plan.debit++;
  rejected(()=>review.inspect(plan,evidence),'P39_LEDGER_UNBALANCED');
});
