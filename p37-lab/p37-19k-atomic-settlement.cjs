'use strict';
// P37-19K: isolated synthetic Store transaction planner.
// No formal ERP imports, IndexedDB, localStorage, Supabase or financial writes.
const crypto=require('node:crypto');
const J=require('./p37-19j-multi-document-projection.cjs');
const SCHEMA='kushe-p37-19k-atomic-synthetic-v1';
const TX='kushe-p37-19k-atomic-action-v1';
const SCOPE='P37_LAB_SYNTHETIC_ONLY';
const fake=/^P37-19-SYN-[A-Z0-9-]{1,80}$/;
const clone=v=>JSON.parse(JSON.stringify(v));
const id=(v,label)=>{if(typeof v!=='string'||!fake.test(v))throw Error('P37-19K '+label+' non-synthetic identifier');return v};
const m=(v,label)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('P37-19K '+label+' invalid nonnegative integer');return v};
const fail=(code)=>{throw Error('P37-19K '+code)};
function sum(arr,label){let v=0;for(const x of arr){v+=m(x,label);if(!Number.isSafeInteger(v))fail('MONEY_OVERFLOW')}return v}
function digest(env){return crypto.createHash('sha256').update(JSON.stringify({
 revision:env.revision,data:env.data,accounts:env.accounts,journal:env.journal,commissionLinks:env.commissionLinks
})).digest('hex')}
function assertMoneyAccount(env){
 if(!Array.isArray(env.accounts)||env.accounts.length!==1||
    !Array.isArray(env.data.bankTransactions))fail('BANK_ACCOUNT_CONFIG_INVALID');
 const account=env.accounts[0];id(account.id,'bank');
 for(const k of ['openingBalance','income','expense','balance'])m(account[k],k);
 const ids=new Set();let actual=0;
 for(const bankTx of env.data.bankTransactions){
  id(bankTx.id,'bankTx');if(ids.has(bankTx.id))fail('BANK_TRANSACTION_DUPLICATE');ids.add(bankTx.id);
  if(bankTx.bankId!==account.id||bankTx.bankAccountId!==account.id||
     bankTx.direction!=='in'||!['receivable_receipt','retention_receipt'].includes(bankTx.sourceType))
    fail('BANK_TRANSACTION_NOT_SYNTHETIC_INCOME');
  const credited=m(bankTx.amount,'bank credited');
  if(credited!==m(bankTx.actualCredit,'bank actualCredit'))fail('BANK_AMOUNT_MISMATCH');
  const entries=bankTx.sourceType==='receivable_receipt'?env.data.receipts:env.data.retentionReceipts;
  const matches=entries.filter(r=>r.id===bankTx.sourceId&&r.bankTransactionId===bankTx.id&&r.receivableId===bankTx.receivableId);
  if(matches.length!==1||bankTx.receiptId!==matches[0].id)fail('BANK_RECEIPT_LINK_NOT_UNIQUE');
  const row=matches[0];
  const face=m(row.cashAmount??row.amount,'receipt cash');
  if(credited!==face-m(row.fee,'receipt fee')||credited<0)fail('BANK_RECEIPT_FEE_MISMATCH');
  if(bankTx.sourceType==='receivable_receipt'&&row.chequeId!==undefined&&row.chequeId!==bankTx.chequeId)
   fail('CHEQUE_BANK_IDENTITY_MISMATCH');
  actual+=credited;
 }
 if(actual!==account.income||account.balance!==account.openingBalance+account.income-account.expense)
  fail('BANK_TOTAL_LEDGER_MISMATCH');
}
function check(env,inspector){
 if(!env||env.schema!==SCHEMA||env.scope!==SCOPE||env.postingEnabled!==false||
    env.productionData!==false||env.formalERPWriterConnected!==false||
    env.cloudWrites!==0||!Number.isSafeInteger(env.revision)||env.revision<0)
   fail('SYNTHETIC_SCOPE_OR_STATE_INVALID');
 if(!Array.isArray(env.journal)||env.journal.length!==env.revision)fail('JOURNAL_VERSION_MISMATCH');
 const seen=new Set();
 env.journal.forEach((r,i)=>{
  if(r.schema!==TX||r.revision!==i+1||!fake.test(r.key)||seen.has(r.key))
   fail('JOURNAL_IDEMPOTENCY_INVALID');
  seen.add(r.key);
 });
 if(env.data?.meta?.businessSnapshotRevision?.id!==(env.revision===0?'P37-19-SYN-REV':'P37-19-SYN-REV-'+env.revision))
   fail('BUSINESS_REVISION_MISMATCH');
 if(!Array.isArray(env.commissionLinks)||env.commissionLinks.length<1)fail('COMMISSION_LINKS_MISSING');
 for(const c of env.commissionLinks){
  id(c.id,'commission');if(!Array.isArray(c.billingIds)||!c.billingIds.length)fail('COMMISSION_LINKS_INVALID');
  for(const link of c.billingIds)id(link,'commission billing');
  m(c.syntheticCommissionAmount,'commission amount');
 }
 for(const name of ['receipts','retentionReceipts']){
  if(!Array.isArray(env.data?.[name]))fail('SOURCE_RECEIPT_TABLE_INVALID');
  const observed=new Set();
  for(const row of env.data[name]){
   id(row.id,name+' ID');if(observed.has(row.id))fail('RECEIPT_DUPLICATE');observed.add(row.id);
   id(row.receivableId,name+' AR');if(row.billingId)id(row.billingId,name+' billing');
   if(row.bankTransactionId)id(row.bankTransactionId,name+' bankTx');
   if(row.chequeId)id(row.chequeId,name+' cheque');
  }
 }
 assertMoneyAccount(env);
 if(typeof inspector?.inspect!=='function')fail('LEDGER_READER_MISSING');
 const report=J.inspect(env.data,{mode:'SYNTHETIC_READ_ONLY_BUNDLE',
  expectedRevisionId:env.data.meta.businessSnapshotRevision.id,inspector});
 if(report.canPost!==false||report.releaseBlocked!==true||
    report.cloudWrites!==0||report.bankTransactionsAdded!==0||
    report.originalStateUnchanged!==true||report.formalPayrollUnlockChanged!==false)
   fail('EXTERNAL_PROJECTION_NOT_READ_ONLY');
 return report;
}
function commissionPreview(env,report){
 const byId=new Map(report.rows.map(row=>[row.billingId,row]));
 return env.commissionLinks.map(link=>{
  const src=link.billingIds.map(id=>byId.get(id));
  if(src.some(v=>!v))fail('COMMISSION_SOURCE_NOT_IN_BUNDLE');
  const fullySettled=src.every(r=>r.outstanding===0&&r.pendingChequeReserved===0);
  const receipts=env.data.receipts.filter(r=>link.billingIds.includes(r.billingId)&&r.bankTransactionId);
  const bankIncome=env.data.bankTransactions.filter(t=>receipts.some(r=>r.bankTransactionId===t.id))
   .reduce((n,t)=>n+m(t.amount,'synthetic bank income'),0);
  return {commissionId:link.id,eligibleForHypotheticalReview:fullySettled&&bankIncome>0,
   unpaidBecause:fullySettled?'BANK_INCOME_NOT_VERIFIED':'RECEIVABLE_NOT_SETTLED',
   syntheticBankIncome:bankIncome,formalCommissionUnlocked:false,
   payrollPaymentsCreated:0};
 });
}
function stateView(env,inspector){
 const report=check(env,inspector);
 return {snapshot:digest(env),revision:env.revision,businessRevision:env.data.meta.businessSnapshotRevision.id,
  report,commissionPreview:commissionPreview(env,report),formalCommissionUnlocked:false,
  postingEnabled:false,cloudWrites:0};
}
function sandbox(source,inspector,options={}){
 if(source?.schema!==J.FIXTURE||source.scope!==SCOPE||source.productionData!==false||
    source.postingEnabled!==false||source.cloudWrites!==0)
    fail('UNAUTHORIZED_SOURCE_SNAPSHOT');
 const data=clone(source),accountId=options.accountId||'P37-19-SYN-BANK-1';
 id(accountId,'bank');
 if(data.meta?.businessSnapshotRevision?.id!=='P37-19-SYN-REV')fail('BASE_REVISION_INVALID');
 if(data.bankTransactions.length!==0)fail('NONEMPTY_BANK_HISTORY_NOT_IN_SYNTHETIC_PLAN');
 const env={
  schema:SCHEMA,scope:SCOPE,productionData:false,postingEnabled:false,
  formalERPWriterConnected:false,cloudWrites:0,revision:0,data,
  accounts:[{id:accountId,openingBalance:100000,income:0,expense:0,balance:100000}],
  journal:[],commissionLinks:[
   {id:'P37-19-SYN-COMM-1',billingIds:['P37-19-SYN-BILL-1'],syntheticCommissionAmount:3500},
   {id:'P37-19-SYN-COMM-2',billingIds:['P37-19-SYN-BILL-1','P37-19-SYN-BILL-2'],syntheticCommissionAmount:2500}
  ]
 };
 check(env,inspector);
 return env;
}
function deductions(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>12)fail('DEDUCTIONS_NOT_AN_ARRAY');
 return value.map((row)=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['amount','category'].includes(k)))
   fail('DEDUCTION_INPUT_INVALID');
  const amount=m(row.amount,'deduction');
  if(!amount)fail('ZERO_DEDUCTION_NOT_ALLOWED');
  return {amount,category:'SYNTHETIC_CUSTOMER_DEDUCTION'};
 });
}
function addBank(env,ar,billing,receipt,fee,chequeId){
 const account=env.accounts[0],cash=m(receipt.cashAmount??receipt.amount,'cash');
 const credited=cash-m(fee,'fee');if(credited<0)fail('FEE_EXCEEDS_CASH');
 const txid=receipt.id+'-BANK';
 id(txid,'synthetic transaction');
 if(env.data.bankTransactions.some(row=>row.id===txid))fail('BANK_ENTRY_DUPLICATE');
 receipt.bankTransactionId=txid;
 receipt.bankAccountId=account.id;
 const record={id:txid,sourceType:receipt.schema==='P37-19K-RETENTION'?
  'retention_receipt':'receivable_receipt',sourceId:receipt.id,receiptId:receipt.id,
  receivableId:ar.id,billingId:billing.id,bankId:account.id,bankAccountId:account.id,
  direction:'in',amount:credited,actualCredit:credited,receiptAmount:cash,fee,
  ...(chequeId?{chequeId}:{}),status:'SIMULATED_NOT_POSTED'};
 env.data.bankTransactions.push(record);
 account.income+=credited;account.balance+=credited;
}
const ALLOWED={
 receipt_add:['cashAmount','deductions','fee','entryId','bankId'],
 retention_add:['cashAmount','fee','entryId','bankId'],
 cheque_register:['chequeId','faceAmount','deductions'],
 cheque_cancel:['chequeId','expectedChequeRevision'],
 cheque_clear:['chequeId','expectedChequeRevision','fee','entryId','bankId'],
 receipt_reverse:['entryId'],
 retention_reverse:['entryId']
};
function simulate(env,intent,inspector,options={}){
 const untouched=JSON.stringify(env),pre=stateView(env,inspector);
 const before=pre.report,failAt=options.failAt||null;
 if(failAt&&!['AFTER_MAIN_ROW','AFTER_BANK_ENTRY','AFTER_BALANCE','BEFORE_POSTCHECK','AFTER_POSTCHECK'].includes(failAt))
   fail('UNSUPPORTED_FAULT_INJECTION');
 if(!intent||typeof intent!=='object'||Array.isArray(intent)||intent.schema!==TX||
    !Object.hasOwn(ALLOWED,intent.kind)||
    intent.expectedRevision!==env.revision||intent.expectedFingerprint!==pre.snapshot||
    intent.expectedBusinessRevision!==pre.businessRevision)
   fail('STALE_OR_UNKNOWN_TRANSACTION_INTENT');
 const allowed=new Set(['schema','kind','key','receivableId','billingId',
  'expectedRevision','expectedFingerprint','expectedBusinessRevision',...ALLOWED[intent.kind]]);
 if(Object.keys(intent).some(k=>!allowed.has(k)))fail('UNKNOWN_MUTATION_PARAMETERS');
 const key=id(intent.key,'idempotency');
 if(env.journal.some(r=>r.key===key))fail('REPLAY_OR_DUPLICATE_TRANSACTION');
 const rid=id(intent.receivableId,'receivable'),bid=id(intent.billingId,'billing');
 const summary=before.rows.find(row=>row.receivableId===rid&&row.billingId===bid);
 if(!summary)fail('SOURCE_BILLING_RELATION_INVALID');
 const draft=clone(env),ar=draft.data.receivables.find(r=>r.id===rid),
  billing=draft.data.billings.find(r=>r.id===bid);
 if(!ar||!billing)fail('SOURCE_NOT_UNIQUE');
 const bankFor=()=>{if(intent.bankId!==draft.accounts[0].id)fail('BANK_NOT_UNIQUE');return draft.accounts[0]};
 const newId=()=>{const r=id(intent.entryId,'entry');if(draft.data.receipts.some(x=>x.id===r)||
   draft.data.retentionReceipts.some(x=>x.id===r))fail('DUPLICATE_ENTRY_ID');return r};
 const stopAt=point=>{if(failAt===point)fail('INJECTED_ROLLBACK_'+point)};
 const fee=()=>m(intent.fee??0,'fee');
 if(intent.kind==='receipt_add'){
  const cash=m(intent.cashAmount,'receipt cash'),ded=deductions(intent.deductions);
  const deduction=sum(ded.map(r=>r.amount),'deductions'),total=sum([cash,deduction],'settlement');
  if(cash<=0||total>summary.receiptInputMax)fail('RECEIPT_OVER_APPROVED_LIMIT');
  bankFor();if(fee()>cash)fail('FEE_EXCEEDS_CASH');
  const rec={id:newId(),schema:'P37-19K-RECEIPT',receivableId:rid,billingId:bid,
   cashAmount:cash,amount:cash,deductions:ded,deductionAmount:deduction,settlementAmount:total,
   fee:fee(),idempotencyKey:key,status:'SIMULATED_NOT_POSTED'};
  draft.data.receipts.push(rec);stopAt('AFTER_MAIN_ROW');
  addBank(draft,ar,billing,rec,rec.fee);stopAt('AFTER_BANK_ENTRY');
  ar.received=m(ar.received??0,'received')+total;stopAt('AFTER_BALANCE');
 }else if(intent.kind==='retention_add'){
  const cash=m(intent.cashAmount,'retention cash');
  if(cash<=0||cash>summary.retentionInputMax)fail('RETENTION_OVER_APPROVED_LIMIT');
  bankFor();if(fee()>cash)fail('FEE_EXCEEDS_CASH');
  const row={id:newId(),schema:'P37-19K-RETENTION',receivableId:rid,billingId:bid,
   amount:cash,cashAmount:cash,fee:fee(),idempotencyKey:key,status:'SIMULATED_NOT_POSTED'};
  draft.data.retentionReceipts.push(row);stopAt('AFTER_MAIN_ROW');
  addBank(draft,ar,billing,row,row.fee);stopAt('AFTER_BANK_ENTRY');
  ar.retentionReceived=m(ar.retentionReceived??0,'retentionReceived')+cash;stopAt('AFTER_BALANCE');
 }else if(intent.kind==='cheque_register'){
  const face=m(intent.faceAmount,'cheque face'),ded=deductions(intent.deductions);
  const amount=sum([face,...ded.map(r=>r.amount)],'reservedAmount');
  const cid=id(intent.chequeId,'cheque');
  if(face<=0||amount>summary.receiptInputMax||
     draft.data.receivables.some(r=>(r.receivableCheques||[]).some(c=>c.id===cid)))
    fail('CHEQUE_RESERVATION_OVER_APPROVED_LIMIT_OR_DUPLICATE');
  if(!Array.isArray(ar.receivableCheques))fail('INVALID_CHEQUE_ARRAY');
  ar.receivableCheques.push({id:cid,schema:'kushe-receivable-cheque-v1',status:'pending',
    revision:1,amount:face,deductions:ded,reservedAmount:amount,
    idempotencyKey:key});stopAt('AFTER_MAIN_ROW');
  stopAt('AFTER_BANK_ENTRY');stopAt('AFTER_BALANCE');
 }else if(intent.kind==='cheque_cancel'){
  const cid=id(intent.chequeId,'cheque'),match=(ar.receivableCheques||[]).filter(c=>c.id===cid);
  if(match.length!==1||match[0].status!=='pending'||match[0].revision!==intent.expectedChequeRevision)
   fail('STALE_OR_NONPENDING_CHEQUE');
  match[0].status='cancelled';match[0].revision+=1;stopAt('AFTER_MAIN_ROW');
  stopAt('AFTER_BANK_ENTRY');stopAt('AFTER_BALANCE');
 }else if(intent.kind==='cheque_clear'){
  const cid=id(intent.chequeId,'cheque'),match=(ar.receivableCheques||[]).filter(c=>c.id===cid);
  if(match.length!==1||match[0].status!=='pending'||match[0].revision!==intent.expectedChequeRevision)
   fail('STALE_OR_NONPENDING_CHEQUE');
  const cheque=match[0],face=m(cheque.amount,'cheque face'),reserved=m(cheque.reservedAmount,'cheque reserved');
  const deduction=sum((cheque.deductions||[]).map(r=>m(r.amount,'cheque deduction')),'cheque deductions');
  if(reserved!==face+deduction||reserved>summary.outstanding||
     reserved>summary.pendingChequeReserved)fail('CHEQUE_APPROVED_LIMIT_INVALID');
  bankFor();if(fee()>face)fail('FEE_EXCEEDS_CASH');
  const rec={id:newId(),schema:'P37-19K-RECEIPT',receivableId:rid,billingId:bid,
   chequeId:cid,cashAmount:face,amount:face,deductions:clone(cheque.deductions||[]),
   deductionAmount:deduction,settlementAmount:reserved,fee:fee(),
   idempotencyKey:key,status:'SIMULATED_NOT_POSTED'};
  draft.data.receipts.push(rec);stopAt('AFTER_MAIN_ROW');
  addBank(draft,ar,billing,rec,rec.fee,cid);stopAt('AFTER_BANK_ENTRY');
  ar.received=m(ar.received??0,'received')+reserved;
  cheque.status='cleared';cheque.revision+=1;
  cheque.receiptId=rec.id;cheque.bankTransactionId=rec.bankTransactionId;stopAt('AFTER_BALANCE');
 }else if(intent.kind==='receipt_reverse'||intent.kind==='retention_reverse'){
  const retention=intent.kind==='retention_reverse',table=retention?'retentionReceipts':'receipts';
  const entry=id(intent.entryId,'reverse entry'),found=draft.data[table].filter(r=>r.id===entry&&r.receivableId===rid&&r.billingId===bid);
  if(found.length!==1||found[0].schema!==(retention?'P37-19K-RETENTION':'P37-19K-RECEIPT')||
     found[0].chequeId)fail('REVERSE_NOT_SYNTHETIC_OR_CHEQUE_LINKED');
  const row=found[0],tx=draft.data.bankTransactions.filter(t=>t.id===row.bankTransactionId&&
   t.receiptId===row.id&&t.receivableId===rid);
  if(tx.length!==1)fail('BANK_TRANSACTION_REVERSE_LINK_INVALID');
  draft.data[table]=draft.data[table].filter(r=>r!==row);stopAt('AFTER_MAIN_ROW');
  draft.data.bankTransactions=draft.data.bankTransactions.filter(t=>t!==tx[0]);
  const account=draft.accounts[0];account.income-=tx[0].amount;account.balance-=tx[0].amount;
  stopAt('AFTER_BANK_ENTRY');
  const value=retention?row.amount:row.settlementAmount,field=retention?'retentionReceived':'received';
  ar[field]-=value;if(ar[field]<0)fail('REVERSE_NEGATIVE_BALANCE');
  stopAt('AFTER_BALANCE');
 }
 // Preserve original invoice and approved allowance records byte-for-byte.
 if(JSON.stringify(draft.data.billings)!==JSON.stringify(env.data.billings)||
    JSON.stringify(draft.data.invoices)!==JSON.stringify(env.data.invoices)||
    JSON.stringify(draft.data.billingAllowances)!==JSON.stringify(env.data.billingAllowances))
   fail('FORMAL_DOCUMENT_AMOUNT_OR_INVOICE_CHANGED');
 const originalMoney=(list)=>list.map(r=>({id:r.id,amount:r.amount,retention:r.retention,
   retentionAmount:r.retentionAmount,sourceNo:r.sourceNo,billingId:r.billingId}));
 if(JSON.stringify(originalMoney(draft.data.receivables))!==JSON.stringify(originalMoney(env.data.receivables)))
   fail('ORIGINAL_RECEIVABLE_FIELDS_CHANGED');
 stopAt('BEFORE_POSTCHECK');
 draft.revision+=1;
 draft.data.meta.businessSnapshotRevision.id='P37-19-SYN-REV-'+draft.revision;
 draft.journal.push({schema:TX,key,revision:draft.revision,kind:intent.kind,
   receivableId:rid,billingId:bid,status:'SIMULATED_NOT_POSTED'});
 const after=stateView(draft,inspector);
 stopAt('AFTER_POSTCHECK');
 if(after.report.summary.reduction.gross!==before.summary.reduction.gross||
    after.report.summary.reduction.receivable!==before.summary.reduction.receivable||
    after.report.summary.reduction.retention!==before.summary.reduction.retention)
   fail('ALLOWANCE_REDUCTION_CHANGED_WITH_SETTLEMENT');
 if(JSON.stringify(env)!==untouched)fail('CALLER_STATE_MUTATED');
 return {ok:true,status:'SYNTHETIC_DRAFT_ONLY_NOT_COMMITTED_TO_ERP',
  previousRevision:env.revision,nextRevision:draft.revision,
  previousSnapshot:pre.snapshot,nextSnapshot:after.snapshot,
  nextState:draft,nextReadOnlyReport:after.report,nextCommissionReview:after.commissionPreview,
  simulationBankEntries:draft.data.bankTransactions.length-env.data.bankTransactions.length,
  formalBankEntriesAdded:0,formalReceiptsAdded:0,formalPayrollUnlocked:false,
  erpWriterConnected:false,cloudWrites:0,postedToERP:false,canPost:false};
}
module.exports=Object.freeze({sandbox,stateView,simulate,digest,SCHEMA,TX,SCOPE});
