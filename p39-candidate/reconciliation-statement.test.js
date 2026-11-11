'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('./core.js'),review=require('./voucher-review.js');
const statement=require('./reconciliation-statement.js');

function fixture(invoiceStatus='invoice_pending'){
 const invoiceNo=invoiceStatus==='invoiced'?'SYN-INV-001':'';
 const noInvoice=invoiceStatus==='no_invoice',tax=noInvoice?0:5000,gross=100000+tax;
 const data={
  __p39Synthetic:core.FIXTURE,meta:{revision:1,p39SyntheticSchema:core.FIXTURE},
  billings:[{id:'SYN-B',receivableId:'SYN-AR',number:'SYN-B20261111-001',invoiceStatus,
    invoiceNo,preTaxAmount:100000,taxAmount:tax,grossTotal:gross,
    retentionAmount:5000,total:gross-5000,retentionBase:'preTax',retentionRate:5,
    note:'內部測試單'}],
  receivables:[{id:'SYN-AR',billingId:'SYN-B',sourceNo:'SYN-B20261111-001',
    invoiceNo,amount:gross-5000,retentionAmount:5000,grossTotal:gross,
    untaxedAmount:100000,taxAmount:tax,received:0,retentionReceived:0}],
  invoices:noInvoice?[]:[{id:'SYN-I',billingId:'SYN-B',sourceType:'billing',sourceId:'SYN-B',
    status:invoiceStatus==='invoiced'?'issued':'pending',number:invoiceNo,
    netAmount:100000,taxAmount:tax,grossAmount:gross}],
  receipts:[],retentionReceipts:[],bankTransactions:[],commissions:[],payroll:[],
  salaryPayments:[],billingAllowances:[],billingNoteRevisions:[]
 };
 const voucher=invoiceStatus==='invoiced'?{synthetic:true,issued:true,testVerified:true,
   type:'electronic',number:'SYN-ALL-001',date:'2026-11-11'}:undefined;
 const plan=core.allowancePlan(data,{billingId:'SYN-B',role:'owner',
   approvedGross:noInvoice?90000:94500,reason:'合成議價',voucher});
 const evidence={synthetic:true,agreementRef:'SYN-AGREE-001',reviewerRef:'SYN-OWNER-001',
   reviewedAt:'2026-11-11'};
 if(voucher)evidence.externalAllowance={...voucher,transport:'SIMULATED_ELECTRONIC_FLOW',
   originalInvoiceNo:invoiceNo};
 const result=core.apply(data,plan).state;
 const row=result.billingAllowances[0];
 row.evidenceReview=review.inspect(plan,evidence);
 row.officialVoucherVerified=false;
 return {before:data,after:result};
}
const blocked=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('未開票內部對帳：原請款原應收未變，金額欄位借貸一致',()=>{
 const {before,after}=fixture(),d=statement.read(after,'SYN-B');
 assert.deepEqual(before.billings,after.billings);
 assert.deepEqual(before.receivables,after.receivables);
 assert.deepEqual(before.invoices,after.invoices);
 assert.equal(d.heading,'虛構議價對帳摘要｜非統一發票、非正式折讓證明單');
 assert.equal(d.summary.originalGross,105000);
 assert.equal(d.summary.proposedGross,94500);
 assert.equal(d.summary.proposedDiscount,10500);
 assert.equal(d.summary.currentReceivable,90000);
 assert.equal(d.summary.currentRetention,4500);
 assert.deepEqual(d.rows.map(x=>x.original-x.allowance),d.rows.map(x=>x.effective));
 assert.equal(d.issuedAsTaxDocument,false);
 assert.equal(d.taxFilingUpdated,false);
 assert.equal(d.evidence.externalVerified,false);
});
test('已開票保留原發票與證明單未驗證警語',()=>{
 const {before,after}=fixture('invoiced'),d=statement.read(after,'SYN-B');
 assert.equal(d.originalInvoiceNo,'SYN-INV-001');
 assert.equal(d.evidence.voucherNo,'SYN-ALL-001');
 assert.equal(d.officialVoucherVerified,false);
 assert.deepEqual(before.invoices,after.invoices);
 assert.match(statement.html(d),/非正式折讓證明單/);
 assert.match(statement.html(d),/官方存證：未驗證/);
});
test('免開發票的對帳表不會產生營業稅',()=>{
 const {after}=fixture('no_invoice');
 const d=statement.read(after,'SYN-B');
 const tax=d.rows.find(x=>x.key==='tax');
 assert.equal(tax.original,0);assert.equal(tax.allowance,0);assert.equal(tax.effective,0);
 assert.equal(d.summary.proposedGross,90000);
});
test('只能以已通過虛構覆核的分錄輸出；不接受冒充正式憑證',()=>{
 const {after}=fixture('invoiced');
 delete after.billingAllowances[0].evidenceReview;
 blocked(()=>statement.read(after,'SYN-B'),'P39_DOCUMENT_REVIEW_MISSING');
 const sample=fixture('invoiced').after;
 sample.billingAllowances[0].officialVoucherVerified=true;
 blocked(()=>statement.read(sample,'SYN-B'),'P39_DOCUMENT_TAX_MISREPRESENTED');
});
test('惡意輸入會在可列印 HTML 中跳脫',()=>{
 const {after}=fixture();
 after.billings[0].number='<script>alert("x")</script>';
 const document=statement.read(after,'SYN-B'),html=statement.html(document);
 assert.ok(!html.includes('<script>alert('));
 assert.match(html,/&lt;script&gt;/);
});
test('只讀摘要會依實際已收款更新餘額，不修改銀行',()=>{
 const {after}=fixture();
 after.receivables[0].received=20000;
 const original=JSON.stringify(after);
 const document=statement.read(after,'SYN-B');
 assert.equal(document.summary.outstanding,70000);
 assert.equal(statement.summary(after).discountGross,10500);
 assert.equal(statement.summary(after).discountTax,500);
 assert.equal(statement.summary(after).officiallyTaxVerifiedCount,0);
 assert.equal(JSON.stringify(after),original);
 assert.deepEqual(after.bankTransactions,[]);
});
test('試圖輸出真實資料與無折讓資料一律拒絕',()=>{
 const plain=fixture().before;
 blocked(()=>statement.read(plain,'SYN-B'),'P39_DOCUMENT_NO_VERIFIED_TEST_LEDGER');
 const {after}=fixture();
 delete after.__p39Synthetic;
 blocked(()=>statement.read(after,'SYN-B'),'P39_DOCUMENT_SYNTHETIC_ONLY');
});
