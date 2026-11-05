'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const p=require('../assets/js/p37-billing-formal-readonly-projection.js');
const ids={billingId:'P37-19-SYN-BILL',billingNo:'P37-19-SYN-NO',invoiceId:'P37-19-SYN-INVID',invoiceNo:'P37-19-SYN-INVNO',receivableId:'P37-19-SYN-ARID'};
const o={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800},d={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600},e={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
const copy=x=>JSON.parse(JSON.stringify(x));
function inspector(){const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8'),context);return context.window.KusheP3718EffectiveLedger;}
function fixture(posted=true){
 const b={id:ids.billingId,number:ids.billingNo,receivableId:ids.receivableId,invoiceNo:ids.invoiceNo,invoiceStatus:'invoiced',amount:o.untaxed,preTaxAmount:o.untaxed,tax:o.tax,taxAmount:o.tax,grossTotal:o.gross,taxIncludedAmount:o.gross,total:o.receivable,retention:o.retention,retentionAmount:o.retention};
 const ar={id:ids.receivableId,billingId:ids.billingId,sourceNo:ids.billingNo,invoiceNo:ids.invoiceNo,amount:o.receivable,retention:o.retention,retentionAmount:o.retention,received:0,retentionReceived:0,legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]};
 const invoice={id:ids.invoiceId,billingId:ids.billingId,sourceType:'billing',sourceId:ids.billingId,invoiceNumber:ids.invoiceNo,status:'issued',netAmount:o.untaxed,amount:o.untaxed,taxAmount:o.tax,tax:o.tax,grossAmount:o.gross,total:o.gross};
 const allowance={schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',source:{...ids,documentSnapshot:'snap-001',draftVersion:1},idempotencyKey:'billing-allowance::'+ids.billingId+'::'+ids.invoiceNo,billingId:ids.billingId,receivableId:ids.receivableId,invoiceNo:ids.invoiceNo,original:o,allowance:d,effective:e,posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',approvedBy:'P37-19-SYN-TEST',approvedAt:'2026-11-05T12:00:00+08:00',verificationReference:'P37-19-SYN-REF'},voucher:{number:'P37-19-SYN-VOUCH',date:'2026-11-05',proofLocation:'SYNTHETIC_ONLY',verificationReference:'P37-19-SYN-REF'}};
 return {meta:{businessSnapshotRevision:{id:'P37-19-SYN-REV'}},billings:[b],receivables:[ar],invoices:[invoice],billingAllowances:posted?[allowance]:[],receipts:[],retentionReceipts:[],bankTransactions:[]};
}
const options={mode:p.MODE,expectedRevisionId:'P37-19-SYN-REV'},view=s=>p.project(s,ids.receivableId,inspector(),options);
test('original billed values unchanged and proposal read-only 0 writes',()=>{
 const s=fixture(false),before=JSON.stringify(s),x=view(s);
 assert.equal(x.status,'ORIGINAL_UNADJUSTED_READ_ONLY');assert.equal(x.proposed.receivable,1185600);assert.equal(x.proposed.retention,124800);
 assert.equal(x.kpiDelta.grossReceivableTotal,0);assert.equal(x.bankTransactionsAdded,0);
 assert.equal(x.readOnly,true);assert.equal(x.postingEnabled,false);assert.equal(JSON.stringify(s),before);
});
test('posted-shaped ledger is review-only; same gross, receivable, retention and KPI',()=>{
 const s=fixture(),before=JSON.stringify(s),x=view(s);
 assert.deepEqual(x.original,{gross:1310400,receivable:1185600,retention:124800});
 assert.equal(x.proposed.gross,1283100);assert.equal(x.proposed.receivable,1160900);
 assert.equal(x.proposed.retention,122200);assert.equal(x.proposed.receiptInputMaximum,1160900);
 assert.equal(x.proposed.retentionInputMaximum,122200);
 assert.deepEqual(x.kpiDelta,{grossReceivableTotal:-27300,currentReceivableTotal:-24700,retentionTotal:-2600,actualBankIncome:0,actualReceiptCount:0,commissions:0,payroll:0});
 assert.equal(x.requiresFullWriterIntegration,true);assert.equal(x.officialVoucherIndependentlyVerifiedBySystem,false);
 assert.equal(x.formalReceiptWriterConnected,false);assert.equal(x.actualKpiModified,false);assert.equal(JSON.stringify(s),before);
});
test('cash plus customer deductions as single settlement; do not add bank income',()=>{
 const s=fixture();s.receipts.push({id:'P37-19-SYN-REC',receivableId:ids.receivableId,billingId:ids.billingId,cashAmount:90000,deductionAmount:10000,deductions:[{amount:10000}],settlementAmount:100000});
 s.receivables[0].received=100000;
 const x=view(s);assert.equal(x.proposed.principalReceived,100000);assert.equal(x.proposed.principalOutstanding,1060900);assert.equal(x.kpiDelta.actualBankIncome,0);
});
test('pending cheque reserves receipt capacity but does not count as paid',()=>{
 const s=fixture();s.receivables[0].receivableCheques=[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE',status:'pending',revision:1,amount:350000,deductions:[{amount:50000}],reservedAmount:400000}];
 const x=view(s);assert.equal(x.proposed.principalOutstanding,1160900);assert.equal(x.proposed.pendingChequeReserved,400000);assert.equal(x.proposed.receiptInputMaximum,760900);
});
test('cheque clearing must match one receipt and bank transaction',()=>{
 const s=fixture(),id='P37-19-SYN-CHEQUE',rid='P37-19-SYN-RECEIPT',bid='P37-19-SYN-BANK';
 s.receivables[0].receivableCheques=[{schema:'kushe-receivable-cheque-v1',id,status:'cleared',revision:2,amount:400000,deductions:[],reservedAmount:400000,receiptId:rid,bankTransactionId:bid}];
 s.receipts=[{id:rid,receivableId:ids.receivableId,billingId:ids.billingId,chequeId:id,bankTransactionId:bid,cashAmount:400000,settlementAmount:400000}];
 s.bankTransactions=[{id:bid,receiptId:rid,chequeId:id,receivableId:ids.receivableId}];s.receivables[0].received=400000;
 assert.equal(view(s).proposed.principalOutstanding,760900);
 s.bankTransactions[0].chequeId='WRONG';assert.throws(()=>view(s),/銀行流水錯誤/);
});
test('retention settlement distinct from principal; no bank mutation',()=>{
 const s=fixture();s.retentionReceipts=[{id:'P37-19-SYN-RET',receivableId:ids.receivableId,billingId:ids.billingId,amount:2200}];s.receivables[0].retentionReceived=2200;
 const x=view(s);assert.equal(x.proposed.retentionOutstanding,120000);assert.equal(x.proposed.principalOutstanding,1160900);assert.equal(x.bankTransactionsAdded,0);
});
test('fail closed on duplicate source, fake voucher, stale revision or mismatch receipt',()=>{
 const s=fixture();s.billings.push(copy(s.billings[0]));assert.throws(()=>view(s));s.billings.pop();
 s.receivables[0].received=99;assert.throws(()=>view(s));s.receivables[0].received=0;
 s.billingAllowances[0].status='PENDING';assert.throws(()=>view(s));s.billingAllowances[0].status='POSTED_VERIFIED';
 assert.throws(()=>p.project(s,ids.receivableId,inspector(),{mode:p.MODE,expectedRevisionId:'STALE'}),/版本/);
 assert.throws(()=>p.project(s,ids.receivableId,inspector(),{mode:'PRODUCTION_WRITE',expectedRevisionId:'P37-19-SYN-REV'}),/唯讀/);
});
test('reject overreserved cheque, inconsistent deduction and foreign receipt source',()=>{
 const s=fixture();s.receivables[0].receivableCheques=[{schema:'kushe-receivable-cheque-v1',id:'P37-19-SYN-CHEQUE',status:'pending',revision:1,amount:1160901,deductions:[],reservedAmount:1160901}];assert.throws(()=>view(s),/不足|餘額/);
 s.receivables[0].receivableCheques=[];
 s.receipts=[{id:'R1',receivableId:ids.receivableId,billingId:ids.billingId,cashAmount:90000,deductionAmount:0,deductions:[{amount:10000}]}];s.receivables[0].received=100000;assert.throws(()=>view(s),/扣款/);
 s.receipts=[{id:'R2',receivableId:ids.receivableId,billingId:'FOREIGN',amount:1}];s.receivables[0].received=1;assert.throws(()=>view(s),/來源|對應/);
});
test('actual ERP Store bridge remains a read API and existing writers remain guarded',()=>{
 const store=fs.readFileSync(path.join(__dirname,'../assets/js/erp-store.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(store,/function billingAllowanceFormalReadOnlyReport\(receivableId,expectedRevisionId\)/);
 assert.match(store,/const core=window.KusheP3719CFormalReader;/);
 assert.match(store,/billingAllowanceFormalReadOnlyReport, billingAllowanceCandidateReview/);
 const writers=store.slice(store.indexOf('const STORE_WRITER_NAMES='),store.indexOf('function exposeStoreRead'));
 assert.doesNotMatch(writers,/billingAllowanceFormalReadOnlyReport/);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/此筆已關聯折讓紀錄；P37 正式折讓、收款、保留款與票據尚未完整整合/);
 assert.match(html,/assets\/js\/p37-billing-formal-readonly-projection\.js/);
 assert.ok(html.indexOf('p37-billing-effective-ledger.js')<html.indexOf('p37-billing-formal-readonly-projection.js'));
});
