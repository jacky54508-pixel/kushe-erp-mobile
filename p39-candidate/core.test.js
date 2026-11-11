'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core.js');

function fixture(status='invoice_pending') {
  const invoiced = status==='invoiced', noInvoice=status==='no_invoice';
  const untaxed=100000, tax=noInvoice?0:5000, gross=untaxed+tax;
  const rate=5,retention=5000,receivable=gross-retention,invoiceNo=invoiced?'SYN-INV-0001':'';
  return {
    __p39Synthetic:core.FIXTURE,
    meta:{p39SyntheticSchema:core.FIXTURE,revision:1},
    billings:[{id:'SYN-B1',number:'SYN-B20261111-001',receivableId:'SYN-AR1',
      note:'原對外備註',invoiceStatus:status,invoiceNo,
      retentionRate:rate,retentionBase:'preTax',preTaxAmount:untaxed,
      taxAmount:tax,grossTotal:gross,retentionAmount:retention,total:receivable}],
    receivables:[{id:'SYN-AR1',billingId:'SYN-B1',sourceNo:'SYN-B20261111-001',
      invoiceNo,amount:receivable,retentionAmount:retention,grossTotal:gross,
      untaxedAmount:untaxed,taxAmount:tax,received:0,retentionReceived:0,
      legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]}],
    invoices:noInvoice?[]:[{id:'SYN-I1',billingId:'SYN-B1',sourceType:'billing',sourceId:'SYN-B1',
      number:invoiceNo,status:invoiced?'issued':'pending',
      netAmount:untaxed,taxAmount:tax,grossAmount:gross}],
    receipts:[],retentionReceipts:[],bankTransactions:[],commissions:[{id:'SYN-C1',amount:100}],
    payroll:[{id:'SYN-P1',amount:100}],salaryPayments:[],customerDeductions:[],
    externalBillingDocuments:[],billingNoteRevisions:[],billingAllowances:[]
  };
}
const voucher=()=>({synthetic:true,issued:true,testVerified:true,type:'electronic',
  number:'SYN-ALLOWANCE-001',date:'2026-11-11'});
const request=(status='invoice_pending')=>({billingId:'SYN-B1',role:'owner',approvedGross:
  status==='no_invoice'?90000:94500,reason:'測試議價',...(status==='invoiced'?{voucher:voucher()}:{})});
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,
  '預期拒絕代碼 '+code);

test('純虛構資料標記為必要，不能接受正式 ERP 快照',()=>{
  const s=fixture();delete s.__p39Synthetic;
  rejects(()=>core.sourceSnapshot(s,'SYN-B1'),'REAL_DATA_FORBIDDEN');
  rejects(()=>core.apply(s,{}),'REAL_DATA_FORBIDDEN');
});
test('版本與來源唯一：正常範例',()=>{
  const s=fixture(),p=core.allowancePlan(s,request());
  assert.equal(p.original.gross,105000);
  assert.equal(p.effective.gross,94500);
  assert.deepEqual(p.discount,{untaxed:10000,tax:500,gross:10500,retention:500,receivable:10000});
  assert.equal(p.debit,p.credit);
  assert.equal(p.credit,10500);
});
test('純預覽不改任何來源',()=>{
  const s=fixture(),before=structuredClone(s);core.allowancePlan(s,request());
  assert.deepEqual(s,before);
});
test('議價草稿與獨立折讓採用新狀態，原請款/發票/應收不變',()=>{
  const s=fixture('invoiced'),before=structuredClone(s),p=core.allowancePlan(s,request('invoiced'));
  const r=core.apply(s,p);assert.equal(r.status,'SYNTHETIC_ONLY');
  assert.deepEqual(s,before);
  for(const key of ['billings','receivables','invoices','receipts','retentionReceipts',
    'bankTransactions','commissions','payroll','salaryPayments'])
    assert.deepEqual(r.state[key],before[key],key+' 不應被改');
  assert.equal(r.state.meta.revision,2);
  assert.equal(r.state.billingAllowances.length,1);
  assert.equal(r.state.billingAllowances[0].status,'SYNTHETIC_POSTED_NOT_REAL');
  assert.equal(r.state.billingAllowances[0].productionAuthorized,false);
  assert.equal(r.state.billingAllowances[0].cloudWrites,0);
  assert.equal(core.effective(r.state,'SYN-B1').effective.receivable,90000);
});
test('同張請款禁止再建第二筆折讓',()=>{
  const s=fixture(),once=core.apply(s,core.allowancePlan(s,request())).state;
  rejects(()=>core.allowancePlan(once,request()),'ALLOWANCE_ALREADY_EXISTS');
});
test('同筆候選交易不可重送；另一裝置快照更新阻擋舊提交',()=>{
  const s=fixture(),p=core.allowancePlan(s,request());
  const next=core.apply(s,p).state;
  rejects(()=>core.apply(next,p),'STALE_REVISION');
  const s2=fixture();s2.billings[0].note='外部已改備註';
  rejects(()=>core.apply(s2,p),'STALE_SNAPSHOT');
});
test('不同角色不可批准議價',()=>{
  rejects(()=>core.allowancePlan(fixture(),{...request(),role:'employee'}),'NOT_AUTHORIZED');
});
test('未填原因拒絕',()=>{
  rejects(()=>core.allowancePlan(fixture(),{...request(),reason:''}),'INVALID_TEXT');
});
test('不能填無效或增加的核定金額',()=>{
  for(const approvedGross of [0,105000,105001])
    rejects(()=>core.allowancePlan(fixture(),{...request(),approvedGross}),'AMOUNT_RANGE');
  for(const approvedGross of [-1,0.5,'90000',Number.MAX_SAFE_INTEGER+1])
    rejects(()=>core.allowancePlan(fixture(),{...request(),approvedGross}),'INVALID_AMOUNT');
});
test('請款與應收識別不一致停止',()=>{
  const s=fixture();s.receivables[0].billingId='SYN-WRONG';
  rejects(()=>core.allowancePlan(s,request()),'SOURCE_LINK_INVALID');
});
test('發票金額被改動不得執行',()=>{
  const s=fixture('invoiced');s.invoices[0].grossAmount+=1;
  rejects(()=>core.allowancePlan(s,request('invoiced')),'INVOICE_MISMATCH');
});
test('已開發票沒有虛構憑證拒絕',()=>{
  const s=fixture('invoiced'),p=request('invoiced');delete p.voucher;
  rejects(()=>core.allowancePlan(s,p),'VOUCHER_REQUIRED');
});
test('虛構折讓憑證必須通過測試標記',()=>{
  const s=fixture('invoiced'),p=request('invoiced');
  p.voucher.testVerified=false;
  rejects(()=>core.allowancePlan(s,p),'VOUCHER_REQUIRED');
});
test('未開發票不能混入已開折讓憑證',()=>{
  rejects(()=>core.allowancePlan(fixture(),{...request(),voucher:voucher()}),'VOUCHER_UNEXPECTED');
});
test('免開發票的試算不用增加營業稅',()=>{
  const s=fixture('no_invoice'),p=core.allowancePlan(s,request('no_invoice'));
  assert.equal(p.discount.tax,0);
  assert.equal(p.effective.gross,90000);
  assert.equal(p.debit,p.credit);
});
test('已有一般收款、保留款收回、歷史收款、支票、銀行交易一律鎖住',()=>{
  const cases=[
    s=>{s.receivables[0].received=1},
    s=>{s.receivables[0].retentionReceived=1},
    s=>{s.receivables[0].legacyReceived=1},
    s=>{s.receivables[0].receivableCheques=[{id:'SYN-Q'}]},
    s=>{s.receipts.push({id:'SYN-REC',receivableId:'SYN-AR1'})},
    s=>{s.retentionReceipts.push({id:'SYN-RET',billingId:'SYN-B1'})},
    s=>{s.bankTransactions.push({id:'SYN-BANK',sourceNo:'SYN-B20261111-001'})}
  ];
  cases.forEach(modify=>{const s=fixture();modify(s);
    rejects(()=>core.allowancePlan(s,request()),'SETTLEMENT_LOCKED')});
});
test('已納入對外文件或客戶扣款禁止議價',()=>{
  const s=fixture();s.externalBillingDocuments=[{sourceIds:['SYN-B1']}];
  rejects(()=>core.allowancePlan(s,request()),'EXTERNAL_DOCUMENT_LOCKED');
  const s2=fixture();s2.customerDeductions=[{billingId:'SYN-B1',amount:1}];
  rejects(()=>core.allowancePlan(s2,request()),'DEDUCTION_LOCKED');
});
test('原始稅額錯誤不推測新稅',()=>{
  const s=fixture();s.billings[0].taxAmount=4900;
  rejects(()=>core.allowancePlan(s,request()),'AMOUNT_MISMATCH');
});
test('保留款比例與原始金額不一致要拒絕',()=>{
  const s=fixture();s.billings[0].retentionRate=10;
  rejects(()=>core.allowancePlan(s,request()),'RETENTION_INVALID');
});
test('折讓後收款上限、保留款上限與超收阻擋',()=>{
  const s=fixture(),next=core.apply(s,core.allowancePlan(s,request())).state;
  assert.equal(core.previewReceipt(next,'SYN-B1','receivable',90000).remaining,0);
  assert.equal(core.previewReceipt(next,'SYN-B1','retention',4500).remaining,0);
  rejects(()=>core.previewReceipt(next,'SYN-B1','receivable',90001),'OVER_COLLECTION');
  rejects(()=>core.previewReceipt(next,'SYN-B1','retention',4501),'OVER_COLLECTION');
  assert.deepEqual(next.receipts,[]);
  assert.deepEqual(next.bankTransactions,[]);
});
test('備註修訂只改備註並完整保留歷程，不重算薪資/應收',()=>{
  const s=fixture(),before=structuredClone(s);
  const p=core.notePlan(s,{role:'owner',billingId:'SYN-B1',note:'議價討論中，仍以正式帳務為準',reason:'測試調整'});
  const next=core.apply(s,p).state;
  assert.equal(next.billings[0].note,'議價討論中，仍以正式帳務為準');
  assert.equal(next.billingNoteRevisions[0].before,'原對外備註');
  assert.equal(next.billingNoteRevisions[0].after,next.billings[0].note);
  assert.deepEqual(s,before);
  for(const key of ['receivables','invoices','bankTransactions','commissions','payroll',
    'salaryPayments','receipts'])assert.deepEqual(next[key],before[key]);
});
test('備註草稿空值、重複、未授權、失效版本全部阻擋',()=>{
  const s=fixture();
  rejects(()=>core.notePlan(s,{role:'owner',billingId:'SYN-B1',note:'原對外備註',reason:'再存'}),'NO_CHANGE');
  rejects(()=>core.notePlan(s,{role:'employee',billingId:'SYN-B1',note:'改',reason:'不能'}),'NOT_AUTHORIZED');
  const p=core.notePlan(s,{role:'owner',billingId:'SYN-B1',note:'更新',reason:'備註修正'});
  const next=core.apply(s,p).state;
  rejects(()=>core.apply(next,p),'STALE_REVISION');
});
test('竄改議價分錄/核定金額後不得提交',()=>{
  const s=fixture(),p=core.allowancePlan(s,request());
  p.discount.gross=1;
  rejects(()=>core.apply(s,p),'PLAN_TAMPERED');
});
test('候選交易和真實帳務完全斷開，不做任何銀行/雲端寫入',()=>{
  const s=fixture('invoiced');
  const next=core.apply(s,core.allowancePlan(s,request('invoiced'))).state;
  assert.equal(next.billingAllowances[0].cloudWrites,0);
  assert.equal(core.effective(next,'SYN-B1').postedToFormalERP,false);
  assert.equal(core.previewReceipt(next,'SYN-B1','receivable',1).bankWrites,0);
});