'use strict';
/* ALL test IDs and figures are SYNTHETIC. No actual user ERP data is read. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {check}=require('./financial_links_readonly.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const amounts=(untaxed,tax)=>({
  untaxed,tax,grossTotal:untaxed+tax,retention:0,receivable:untaxed+tax
});
function sample(){
  const a=amounts(524000,26200),b=amounts(78000,3900);
  return {
    meta:{businessSnapshotRevision:{sequence:123,id:'SYNTH-REV'},
      externalBillingDocuments:[{id:'SYNTH-GROUP',revision:2,status:'active',
        sourceIds:['SYNTH-BILL-A','SYNTH-BILL-B'],targetBillingId:'SYNTH-BILL-A',
        sourceSnapshots:[{billingId:'SYNTH-BILL-A',anchors:a},
          {billingId:'SYNTH-BILL-B',anchors:b}],
        settlementSnapshots:[{billingId:'SYNTH-BILL-A'},
          {billingId:'SYNTH-BILL-B'}],
        totals:amounts(602000,30100)}]},
    billings:[
      {id:'SYNTH-BILL-A',number:'SYNTH-001',receivableId:'SYNTH-AR-A',
        preTaxAmount:a.untaxed,taxAmount:a.tax,grossTotal:a.grossTotal,
        retentionAmount:a.retention,total:a.receivable,invoiceStatus:'invoice_pending',invoiceNo:''},
      {id:'SYNTH-BILL-B',number:'SYNTH-002',receivableId:'SYNTH-AR-B',
        preTaxAmount:b.untaxed,taxAmount:b.tax,grossTotal:b.grossTotal,
        retentionAmount:b.retention,total:b.receivable,invoiceStatus:'invoiced',invoiceNo:'SYNTH-INV-01'}
    ],
    receivables:[
      {id:'SYNTH-AR-A',billingId:'SYNTH-BILL-A',amount:a.receivable,received:0,retentionReceived:0},
      {id:'SYNTH-AR-B',billingId:'SYNTH-BILL-B',amount:b.receivable,received:0,retentionReceived:0}
    ],
    invoices:[{id:'SYNTH-INVOICE-1',invoiceType:'output',sourceType:'billing',
      sourceId:'SYNTH-BILL-B',status:'issued',invoiceNumber:'SYNTH-INV-01'}],
    receipts:[],retentionReceipts:[],commissions:[],payroll:[],salaryPayments:[],bankTransactions:[]
  };
}
test('two original bills 632100 gross with one issued invoice remain manual-review locked',()=>{
  const input=sample(),before=JSON.stringify(input),out=check(input,'SYNTH-GROUP');
  assert.equal(out.sourceCount,2);
  assert.equal(out.documentRevision,2);
  assert.equal(out.totals.untaxed,602000);
  assert.equal(out.totals.tax,30100);
  assert.equal(out.totals.grossTotal,632100);
  assert.equal(out.sourceLinks[0].receivableId,'SYNTH-AR-A');
  assert.equal(out.sourceLinks[1].hasInvoiceEvidence,true);
  assert.ok(out.blockers.some(s=>s.includes('已有發票證據')));
  assert.equal(out.readOnly,true);assert.equal(out.canPost,false);
  assert.equal(out.canSave,false);assert.equal(out.changesWritten,0);
  assert.equal(JSON.stringify(input),before);
});
test('unissued uncollected synthetic originals stay manual review even with no blockers',()=>{
  const input=sample();
  input.billings[1].invoiceStatus='invoice_pending';
  input.billings[1].invoiceNo='';
  input.invoices=[];
  const before=JSON.stringify(input),out=check(input,'SYNTH-GROUP');
  assert.equal(out.status,'MANUAL_REVIEW_REQUIRED');
  assert.equal(out.blockers.length,0);
  assert.equal(out.canPost,false);assert.equal(out.canSave,false);
  assert.ok(out.warnings.some(s=>s.includes('不能從合併總額直接重算')));
  assert.equal(JSON.stringify(input),before);
});
test('missing or duplicate explicit billing and AR relations fail closed',()=>{
  const edits=[
    s=>{s.receivables[0].billingId=''},
    s=>{s.receivables[1].billingId='SYNTH-BILL-A'},
    s=>{s.billings.push({...s.billings[0]})},
    s=>{s.receivables[0].amount=1000},
    s=>{s.billings[0].receivableId='SYNTH-AR-B'},
    s=>{s.billings[1].taxAmount=3901},
    s=>{s.billings[0].total=550199},
    s=>{s.meta.externalBillingDocuments[0].sourceIds=['SYNTH-BILL-A','SYNTH-BILL-A']},
    s=>{s.meta.externalBillingDocuments[0].sourceIds=['SYNTH-BILL-A','MISSING']},
    s=>{s.meta.externalBillingDocuments[0].sourceSnapshots[0].billingId='WRONG'},
    s=>{s.meta.externalBillingDocuments[0].settlementSnapshots[0].billingId='WRONG'},
    s=>{s.meta.externalBillingDocuments[0].targetBillingId='OTHER'},
    s=>{delete s.receipts},
    s=>{s.meta.externalBillingDocuments[0].revision=0}
  ];
  for(const edit of edits){
    const s=sample();edit(s);const before=JSON.stringify(s);
    assert.throws(()=>check(s,'SYNTH-GROUP'));
    assert.equal(JSON.stringify(s),before);
  }
});
test('stale anchors or total are blockers, never auto repaired',()=>{
  const s=sample();s.meta.externalBillingDocuments[0].sourceSnapshots[1].anchors.grossTotal=81901;
  // Inconsistent saved anchor itself is a hard failure: never auto-fix stored proof
  assert.throws(()=>check(s,'SYNTH-GROUP'));
  const t=sample();t.meta.externalBillingDocuments[0].sourceSnapshots[1].anchors=amounts(77000,3900);
  const before=JSON.stringify(t),result=check(t,'SYNTH-GROUP');
  assert.ok(result.blockers.some(s=>s.includes('快照不同')));
  assert.equal(JSON.stringify(t),before);
  const u=sample();u.meta.externalBillingDocuments[0].totals=amounts(601000,30100);
  assert.ok(check(u,'SYNTH-GROUP').blockers.some(s=>s.includes('保存合計')));
});
test('two active groups cannot share an original bill',()=>{
  const s=sample(),d=s.meta.externalBillingDocuments[0];
  s.meta.externalBillingDocuments.push({...clone(d),id:'SYNTH-GROUP-2',sourceSnapshots:clone(d.sourceSnapshots)});
  assert.throws(()=>check(s,'SYNTH-GROUP'),/另一份有效合併文件/);
});
test('receipts, retention receipts and bank entries flagged without altering balances',()=>{
  const s=sample();
  s.receipts=[{id:'SYNTH-RECEIPT',receivableId:'SYNTH-AR-A',amount:5000}];
  s.retentionReceipts=[{id:'SYNTH-RET',receivableId:'SYNTH-AR-A',amount:500}];
  s.bankTransactions=[
    {id:'SYNTH-TX1',sourceType:'receipt',sourceId:'SYNTH-RECEIPT',amount:5000},
    {id:'SYNTH-TX2',sourceType:'retention_receipt',sourceId:'SYNTH-RET',amount:500}
  ];
  const before=JSON.stringify(s),result=check(s,'SYNTH-GROUP');
  assert.equal(result.sourceLinks[0].receiptRecordCount,1);
  assert.equal(result.sourceLinks[0].retentionReceiptRecordCount,1);
  assert.equal(result.relatedBankRecordCount,2);
  assert.ok(result.blockers.some(s=>s.includes('收款或保留款')));
  assert.equal(JSON.stringify(s),before);
});
test('paid payroll referenced by direct commission blocks changes; source daily work still requires separate review',()=>{
  const s=sample();
  s.commissions=[{id:'SYNTH-COMM',billingId:'SYNTH-BILL-A',employee:'SYNTH-EMP',
    date:'2026-11-16',commission:7000,untaxedAmount:14000,rate:50}];
  s.payroll=[{id:'SYNTH-SALARY',month:'2026-11',employee:'SYNTH-EMP',status:'已付款'}];
  s.salaryPayments=[{id:'SYNTH-SALPAY',payrollId:'SYNTH-SALARY',amount:7000}];
  const before=JSON.stringify(s),result=check(s,'SYNTH-GROUP');
  assert.equal(result.sourceLinks[0].directCommissionCount,1);
  assert.equal(result.sourceLinks[0].paidPayrollLinked,true);
  assert.ok(result.blockers.some(x=>x.includes('已付款薪資')));
  assert.equal(JSON.stringify(s),before);
});
test('no root, no ambiguous group or missing business snapshot is fail-safe',()=>{
  assert.throws(()=>check(null,'SYNTH-GROUP'));
  assert.throws(()=>check({},'SYNTH-GROUP'));
  const s=sample();delete s.meta.businessSnapshotRevision;
  const r=check(s,'SYNTH-GROUP');
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.blockers.some(x=>x.includes('businessSnapshotRevision')));
  const t=sample();assert.throws(()=>check(t,'NONE'));
});
test('no new module in production index and no writing/network in isolated audit',()=>{
  const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const code=fs.readFileSync(path.join(__dirname,'financial_links_readonly.cjs'),'utf8');
  assert.ok(!index.includes('p40-16i'));
  for(const term of ['fetch(','localStorage','indexedDB','XMLHttpRequest',
    '.saveBilling(','.persist(','.saveInvoice(','.updateReceivable(',
    '.saveExternalBillingDocument(','.commit(','supabase','window.location']){
    assert.equal(code.includes(term),false,term+' must not occur in pure auditor');
  }
});
