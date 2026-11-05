'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const k=require('./p37-19k-atomic-settlement.cjs');
const J=require('./p37-19j-multi-document-projection.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const BILL='P37-19-SYN-BILL-1',AR='P37-19-SYN-AR-1',BANK='P37-19-SYN-BANK-1',CH='P37-19-SYN-CHEQUE-A';
const ids={billingId:BILL,billingNo:'P37-19-SYN-NO-1',invoiceId:'P37-19-SYN-INVOICE-1',
 invoiceNo:'P37-19-SYN-INVOICENO-1',receivableId:AR};
const orig={untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800};
const reduction={untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600};
const eff={untaxed:1222000,tax:61100,gross:1283100,receivable:1160900,retention:122200};
function inspector(){
 const ctx={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/p37-billing-effective-ledger.js'),'utf8'),ctx);
 return ctx.window.KusheP3718EffectiveLedger;
}
function fixture(){
 const b={id:BILL,number:ids.billingNo,receivableId:AR,invoiceStatus:'invoiced',
   invoiceNo:ids.invoiceNo,date:'2026-11-01',project:'P37-19-SYN-PROJECT-A',
   amount:orig.untaxed,preTaxAmount:orig.untaxed,tax:orig.tax,taxAmount:orig.tax,
   grossTotal:orig.gross,taxIncludedAmount:orig.gross,total:orig.receivable,
   retention:orig.retention,retentionAmount:orig.retention};
 const a={id:AR,billingId:BILL,sourceNo:ids.billingNo,invoiceNo:ids.invoiceNo,
  amount:orig.receivable,retention:orig.retention,retentionAmount:orig.retention,
  received:100000,legacyReceived:100000,retentionReceived:0,legacyRetentionReceived:0,
  receivableCheques:[{id:CH,schema:'kushe-receivable-cheque-v1',
    status:'pending',revision:1,amount:350000,deductions:[{amount:50000}],reservedAmount:400000}]};
 const i={id:ids.invoiceId,billingId:BILL,sourceType:'billing',sourceId:BILL,
  invoiceNumber:ids.invoiceNo,status:'issued',amount:orig.untaxed,netAmount:orig.untaxed,
  tax:orig.tax,taxAmount:orig.tax,total:orig.gross,grossAmount:orig.gross};
 const allowance={schema:'kushe-p37-18-posted-ledger-contract-v1',status:'POSTED_VERIFIED',
  source:{...ids,documentSnapshot:'P37-19-SYN-DOCUMENT',draftVersion:1},
  idempotencyKey:'billing-allowance::'+BILL+'::'+ids.invoiceNo,billingId:BILL,receivableId:AR,
  invoiceNo:ids.invoiceNo,original:orig,allowance:reduction,effective:eff,
  posting:{accountantApproved:true,commitRevision:'P37-19-SYN-REV',
    approvedBy:'P37-19-SYN-AUDIT',approvedAt:'2026-11-06T00:00:00+08:00',verificationReference:'P37-19-SYN-REF'},
  voucher:{number:'P37-19-SYN-VOUCHER',date:'2026-11-06',
    proofLocation:'SYNTHETIC_NOT_OFFICIAL',verificationReference:'P37-19-SYN-REF'}};
 const b2={id:'P37-19-SYN-BILL-2',number:'P37-19-SYN-NO-2',
   receivableId:'P37-19-SYN-AR-2',invoiceStatus:'no_invoice',invoiceNo:'',
   date:'2026-10-26',amount:50000,preTaxAmount:50000,tax:2500,taxAmount:2500,
   grossTotal:52500,taxIncludedAmount:52500,total:52500,retention:0,retentionAmount:0};
 const a2={id:'P37-19-SYN-AR-2',billingId:b2.id,sourceNo:b2.number,
  amount:52500,retention:0,retentionAmount:0,received:0,retentionReceived:0,
  legacyReceived:0,legacyRetentionReceived:0,receivableCheques:[]};
 return {schema:J.FIXTURE,scope:J.SCOPE,productionData:false,postingEnabled:false,cloudWrites:0,
  meta:{businessSnapshotRevision:{id:'P37-19-SYN-REV'}},
  billings:[b,b2],receivables:[a,a2],invoices:[i],billingAllowances:[allowance],
  receipts:[],retentionReceipts:[],bankTransactions:[]};
}
const lab=inspector();
const newEnv=()=>k.sandbox(fixture(),lab);
function next(env,kind,key,rest={}){
 return {schema:k.TX,kind,key:'P37-19-SYN-TX-'+key,
   receivableId:rest.receivableId??AR,billingId:rest.billingId??BILL,
   expectedRevision:env.revision,expectedFingerprint:k.digest(env),
   expectedBusinessRevision:env.data.meta.businessSnapshotRevision.id,
   ...rest};
}
function run(env,kind,key,rest={},opts={}){return k.simulate(env,next(env,kind,key,rest),lab,opts)}
function receipt(amount=50000,entry='P37-19-SYN-RECEIPT-NEW',deduct=10000,fee=500){
 return {entryId:entry,bankId:BANK,cashAmount:amount,deductions:deduct?[{amount:deduct}]:[],fee}
}
function retention(amount=2200,entry='P37-19-SYN-RETENTION-NEW',fee=200){
 return {entryId:entry,bankId:BANK,cashAmount:amount,fee}
}
function cleared(entry='P37-19-SYN-RECEIPT-CHEQUE'){return {chequeId:CH,
  expectedChequeRevision:1,bankId:BANK,entryId:entry,fee:500}}
test('initial approved allowance, historical collected principal, pending cheque and two bills reconcile',()=>{
 const source=fixture(),before=JSON.stringify(source),env=k.sandbox(source,lab),x=k.stateView(env,lab);
 assert.equal(x.report.summary.approved.gross,1335600);
 assert.equal(x.report.summary.approved.receivable,1213400);
 assert.equal(x.report.summary.principalReceived,100000);
 assert.equal(x.report.summary.principalOutstanding,1113400);
 assert.equal(x.report.summary.receiptInputMaximum,713400);
 assert.equal(x.report.rows[0].receiptInputMax,660900);
 assert.equal(x.report.rows[0].pendingChequeReserved,400000);
 assert.equal(x.commissionPreview[0].eligibleForHypotheticalReview,false);
 assert.equal(JSON.stringify(source),before);
 assert.equal(env.postingEnabled,false);
});
test('atomic principal receipt + customer deductions + company fee reconciles with exactly one synthetic bank credit',()=>{
 const env=newEnv(),before=JSON.stringify(env);
 const t=run(env,'receipt_add','RECEIPT1',receipt());
 assert.equal(t.ok,true);assert.equal(t.nextState.revision,1);
 assert.equal(t.nextState.data.receipts.length,1);
 assert.equal(t.nextState.data.receipts[0].settlementAmount,60000);
 assert.equal(t.nextState.data.bankTransactions.length,1);
 assert.equal(t.nextState.data.bankTransactions[0].amount,49500);
 assert.equal(t.nextState.accounts[0].balance,149500);
 assert.equal(t.nextState.data.receivables[0].received,160000);
 assert.equal(t.nextReadOnlyReport.rows[0].outstanding,1000900);
 assert.equal(t.nextReadOnlyReport.rows[0].receiptInputMax,600900);
 assert.equal(t.nextCommissionReview[0].eligibleForHypotheticalReview,false);
 assert.equal(t.formalBankEntriesAdded,0);assert.equal(t.formalReceiptsAdded,0);assert.equal(t.canPost,false);
 assert.equal(JSON.stringify(env),before);
});
test('retention receipt leaves principal unchanged, bank credit excludes the fee',()=>{
 const env=newEnv(),t=run(env,'retention_add','RET1',retention());
 assert.equal(t.nextState.data.retentionReceipts.length,1);
 assert.equal(t.nextState.data.bankTransactions[0].amount,2000);
 assert.equal(t.nextReadOnlyReport.rows[0].retentionOutstanding,120000);
 assert.equal(t.nextReadOnlyReport.rows[0].outstanding,1060900);
 assert.equal(t.nextState.accounts[0].income,2000);
 assert.equal(t.formalBankEntriesAdded,0);
});
test('new pending cheque reserves full face plus deduction but does not touch bank or commission',()=>{
 const env=newEnv();
 const t=run(env,'cheque_register','CHEQUE1',{
  chequeId:'P37-19-SYN-CHEQUE-NEW',faceAmount:20000,deductions:[{amount:1000}]});
 assert.equal(t.nextState.data.receivables[0].receivableCheques.length,2);
 assert.equal(t.nextReadOnlyReport.rows[0].pendingChequeReserved,421000);
 assert.equal(t.nextReadOnlyReport.rows[0].receiptInputMax,639900);
 assert.equal(t.nextReadOnlyReport.rows[0].outstanding,1060900);
 assert.equal(t.nextState.data.bankTransactions.length,0);
 assert.equal(t.nextCommissionReview[0].eligibleForHypotheticalReview,false);
 const cancelled=run(t.nextState,'cheque_cancel','CHEQUE2',{
  chequeId:'P37-19-SYN-CHEQUE-NEW',expectedChequeRevision:1});
 assert.equal(cancelled.nextReadOnlyReport.rows[0].pendingChequeReserved,400000);
 assert.equal(cancelled.nextReadOnlyReport.rows[0].receiptInputMax,660900);
 assert.equal(cancelled.nextState.data.bankTransactions.length,0);
 assert.throws(()=>run(cancelled.nextState,'cheque_clear','CANCELLED',{
   chequeId:'P37-19-SYN-CHEQUE-NEW',expectedChequeRevision:2,entryId:'P37-19-SYN-RECEIPT-INVALID',bankId:BANK}),/NONPENDING/);
});
test('cheque clears as one receipt and one bank entry, consumes reserved settlement once',()=>{
 const env=newEnv(),t=run(env,'cheque_clear','CHEQUE-CLEAR',cleared());
 assert.equal(t.nextState.data.receipts.length,1);
 assert.equal(t.nextState.data.receipts[0].cashAmount,350000);
 assert.equal(t.nextState.data.receipts[0].deductionAmount,50000);
 assert.equal(t.nextState.data.receipts[0].settlementAmount,400000);
 assert.equal(t.nextState.data.bankTransactions.length,1);
 assert.equal(t.nextState.data.bankTransactions[0].amount,349500);
 assert.equal(t.nextState.data.receivables[0].received,500000);
 assert.equal(t.nextReadOnlyReport.rows[0].outstanding,660900);
 assert.equal(t.nextReadOnlyReport.rows[0].pendingChequeReserved,0);
 assert.equal(t.nextReadOnlyReport.rows[0].receiptInputMax,660900);
 assert.equal(t.nextState.data.receivables[0].receivableCheques[0].status,'cleared');
 assert.equal(t.nextState.data.receivables[0].receivableCheques[0].revision,2);
 assert.throws(()=>run(t.nextState,'cheque_clear','TWICE',cleared('P37-19-SYN-RECEIPT-OTHER')),/NONPENDING/);
});
test('full verified synthetic settlement changes only hypothetical commission eligibility; payroll remains locked',()=>{
 const env=newEnv(),ch=run(env,'cheque_clear','CLEAR',cleared());
 const full=run(ch.nextState,'receipt_add','FINAL',receipt(660900,'P37-19-SYN-RECEIPT-FINAL',0,0));
 assert.equal(full.nextReadOnlyReport.rows[0].outstanding,0);
 assert.equal(full.nextReadOnlyReport.rows[0].pendingChequeReserved,0);
 assert.equal(full.nextCommissionReview[0].eligibleForHypotheticalReview,true);
 assert.equal(full.nextCommissionReview[0].unpaidBecause,'');
 assert.equal(full.nextCommissionReview[0].formalCommissionUnlocked,false);
 assert.equal(full.nextCommissionReview[1].eligibleForHypotheticalReview,false);
 const other=run(full.nextState,'receipt_add','OTHERBILL',{...receipt(52500,'P37-19-SYN-RECEIPT-B2',0,0),
  receivableId:'P37-19-SYN-AR-2',billingId:'P37-19-SYN-BILL-2'});
 assert.equal(other.nextCommissionReview[1].eligibleForHypotheticalReview,true);
 assert.equal(other.nextCommissionReview[1].formalCommissionUnlocked,false);
 assert.equal(other.formalPayrollUnlocked,false);
 assert.equal(other.nextState.data.invoices.length,1);
});
test('receipt reverse and retention reverse delete ONLY self-created synthetic rows and their bank entry',()=>{
 const env=newEnv(),one=run(env,'receipt_add','A',receipt());
 const returned=run(one.nextState,'receipt_reverse','B',{entryId:'P37-19-SYN-RECEIPT-NEW'});
 assert.equal(returned.nextState.data.receipts.length,0);
 assert.equal(returned.nextState.data.bankTransactions.length,0);
 assert.equal(returned.nextState.accounts[0].income,0);
 assert.equal(returned.nextState.data.receivables[0].received,100000);
 assert.equal(returned.nextReadOnlyReport.rows[0].receiptInputMax,660900);
 const ret=run(env,'retention_add','C',retention());
 const revert=run(ret.nextState,'retention_reverse','D',{entryId:'P37-19-SYN-RETENTION-NEW'});
 assert.equal(revert.nextState.data.retentionReceipts.length,0);
 assert.equal(revert.nextState.data.bankTransactions.length,0);
 assert.equal(revert.nextReadOnlyReport.rows[0].retentionOutstanding,122200);
 assert.throws(()=>run(env,'receipt_reverse','UNLINKED',{entryId:'P37-19-SYN-LEGACY-NONEXISTENT'}),/REVERSE/);
 const ch=run(env,'cheque_clear','CLEAR',cleared());
 assert.throws(()=>run(ch.nextState,'receipt_reverse','CHEQUE-REVERSE',{entryId:'P37-19-SYN-RECEIPT-CHEQUE'}),/REVERSE/);
});
test('all injected crash points leave the caller byte-for-byte unchanged and allow a new attempt',()=>{
 const cases=[
  ['receipt_add',receipt()],['retention_add',retention()],
  ['cheque_clear',cleared()],['cheque_register',{chequeId:'P37-19-SYN-CHEQUE-NEW',faceAmount:15000,deductions:[]}]
 ];
 for(const [kind,input] of cases)for(const failAt of
  ['AFTER_MAIN_ROW','AFTER_BANK_ENTRY','AFTER_BALANCE','BEFORE_POSTCHECK','AFTER_POSTCHECK']){
  const env=newEnv(),before=JSON.stringify(env);
  assert.throws(()=>run(env,kind,'FAIL-'+kind.toUpperCase().replace('_','-'),input,{failAt}),/INJECTED_ROLLBACK/);
  assert.equal(JSON.stringify(env),before,kind+' '+failAt);
  const success=run(env,kind,'RETRY-'+kind.toUpperCase().replace('_','-'),input);
  assert.equal(success.ok,true);
 }
});
test('reject stale CAS revisions, same operation id, foreign source, overshoot and unknown fields',()=>{
 const env=newEnv(),receiptDetails=receipt();
 assert.throws(()=>run(env,'receipt_add','TOO-MUCH',receipt(660901,'P37-19-SYN-RECEIPT-OVER',0,0)),/OVER_APPROVED/);
 assert.throws(()=>run(env,'retention_add','RET-OVER',retention(122201,'P37-19-SYN-RETENTION-OVER',0)),/OVER_APPROVED/);
 assert.throws(()=>run(env,'cheque_register','CH-OVER',{chequeId:'P37-19-SYN-CHEQUE-OVER',faceAmount:660901,deductions:[]}),/OVER_APPROVED/);
 const t=run(env,'receipt_add','GOOD',receiptDetails);
 assert.throws(()=>k.simulate(t.nextState,next(env,'receipt_add','STALE',receiptDetails),lab),/STALE/);
 assert.throws(()=>run(t.nextState,'receipt_add','GOOD',receipt(50,'P37-19-SYN-RECEIPT-OTHER',0,0)),/REPLAY/);
 assert.throws(()=>run(env,'receipt_add','FOREIGN',{...receiptDetails,receivableId:'REAL-CUSTOMER-AR'}),/non-synthetic/);
 assert.throws(()=>run(env,'receipt_add','DIFFERENT-BILL',{...receiptDetails,billingId:'P37-19-SYN-BILL-2'}),/RELATION/);
 assert.throws(()=>run(env,'receipt_add','FAKE-POST',{...receiptDetails,postingEnabled:true}),/UNKNOWN_MUTATION/);
 assert.throws(()=>run(env,'receipt_add','FAKE-BANK',{...receiptDetails,bankId:'P37-19-SYN-BANK-OTHER'}),/BANK_NOT_UNIQUE/);
});
test('invalid fee, malformed deductions, and corrupted bank evidence prevent any draft',()=>{
 const env=newEnv(),before=JSON.stringify(env);
 assert.throws(()=>run(env,'receipt_add','HIGH-FEE',receipt(100,'P37-19-SYN-RECEIPT-HIGHFEE',0,101)),/FEE_EXCEEDS/);
 assert.throws(()=>run(env,'receipt_add','BAD-DED',{...receipt(),deductions:[{amount:-1}]}),/invalid/);
 assert.equal(JSON.stringify(env),before);
 const after=run(env,'receipt_add','GOOD',receipt()).nextState;
 const tampered=clone(after);tampered.accounts[0].income+=1;
 assert.throws(()=>k.stateView(tampered,lab),/BANK_TOTAL/);
 const noTx=clone(after);noTx.data.bankTransactions=[];
 assert.throws(()=>k.stateView(noTx,lab),/BANK_TOTAL/);
});
test('any tax, invoice, deduction, or allowance metadata tampering blocks simulated workflow',()=>{
 const base=fixture(),copyBase=JSON.stringify(base);
 base.invoices[0].grossAmount+=1;
 assert.throws(()=>k.sandbox(base,lab));
 base.invoices[0].grossAmount-=1;
 base.billingAllowances[0].status='PENDING';
 assert.throws(()=>k.sandbox(base,lab));
 assert.notEqual(JSON.stringify(base),copyBase);
 for(const patch of [{productionData:true},{postingEnabled:true},{scope:'PROD'},{cloudWrites:1}])
  assert.throws(()=>k.sandbox({...fixture(),...patch},lab),/UNAUTHORIZED/);
});
test('production code still blocks receipt with allowance, and K module has no ERP/writer/network imports',()=>{
 const root=path.join(__dirname,'..');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8'),
  html=fs.readFileSync(path.join(root,'index.html'),'utf8'),
  sync=fs.readFileSync(path.join(root,'assets/js/cloud-sync.js'),'utf8'),
  src=fs.readFileSync(path.join(__dirname,'p37-19k-atomic-settlement.cjs'),'utf8');
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/P37 正式折讓、收款、保留款與票據尚未完整整合/);
 assert.match(sync,/erp_state_cas_write_v2/);
 assert.doesNotMatch(html,/p37-19k/i);
 assert.doesNotMatch(store,/p37-19k/i);
 assert.doesNotMatch(src,/\b(?:indexedDB|localStorage|window)\s*(?:\.|\[|\()/i);
 assert.doesNotMatch(src,/service_role|supabase\.co|KusheERPStore/i);
 const imported=[...src.matchAll(/\brequire\((['\"])(.*?)\1\)/g)].map(x=>x[2]);
 assert.deepEqual(imported,['node:crypto','./p37-19j-multi-document-projection.cjs']);
 const Jgap=require('./p37-19j-financial-integration-gaps.cjs').audit(root);
 assert.equal(Jgap.releaseStatus,'BLOCKED');assert.equal(Jgap.canPostAllowance,false);
});
