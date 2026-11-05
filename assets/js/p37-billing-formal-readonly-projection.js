(function p3719CReader(root){
'use strict';
const SCHEMA='kushe-p37-19c-formal-shaped-readonly-v1';
const MODE='P37_19C_REVIEW_ONLY';
const t=x=>String(x??'').trim();
const fail=x=>{throw new Error('P37-19C '+x)};
const int=(x,n)=>{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0)fail(n+'須為非負安全整數');return x};
function num(r,k,n,defaultValue=0){const v=r?.[k];return v===undefined||v===null||v===''?defaultValue:int(v,n)}
function equal(r,ks,n,required=false){
 const arr=ks.filter(k=>r?.[k]!==undefined&&r[k]!==null&&r[k]!=='').map(k=>int(r[k],n+' '+k));
 if(!arr.length){if(required)fail(n+'欄位缺失');return null}
 if(arr.some(v=>v!==arr[0]))fail(n+'歷史欄位不一致');
 return arr[0];
}
function sum(values,n){let s=0;for(const v of values){s+=int(v,n);if(!Number.isSafeInteger(s))fail(n+'金額溢位')}return s}
const unique=(rows,n)=>{if(rows.length!==1)fail(n+'非唯一來源');return rows[0]};
const related=(r,ar,b)=>r&&(
 t(r.receivableId)===t(ar.id)||
 Boolean(t(r.billingId)&&t(r.billingId)===t(b.id))||
 Boolean(t(r.sourceNo)&&t(r.sourceNo)===t(b.number))
);
function settlements(state,ar,b){
 const receipts=state.receipts.filter(r=>related(r,ar,b));
 const retention=state.retentionReceipts.filter(r=>related(r,ar,b));
 const ids=new Set();
 for(const [rows,label] of [[receipts,'收款'],[retention,'保留款']])for(const r of rows){
   if(!t(r?.id)||ids.has(t(r.id))||t(r.receivableId)!==t(ar.id)||
      (t(r.billingId)&&t(r.billingId)!==t(b.id)))fail(label+'來源重複或對應錯誤');
   ids.add(t(r.id));
 }
 const principal=sum([num(ar,'legacyReceived','歷史應收'),...receipts.map(r=>{
  const cash=num(r,'cashAmount','現金收款',null)??num(r,'amount','現金收款');
  if(r.deductions!==undefined&&!Array.isArray(r.deductions))fail('扣款明細格式錯誤');
  const detail=r.deductions===undefined?null:sum(r.deductions.map(d=>int(d?.amount,'扣款明細')),'扣款明細');
  const deduction=num(r,'deductionAmount','扣款總額',detail??0);
  if(detail!==null&&detail!==deduction)fail('扣款總額與明細不符');
  const settlement=sum([cash,deduction],'應收沖銷');
  if(r.settlementAmount!==undefined&&int(r.settlementAmount,'已沖銷')!==settlement)fail('應收沖銷與實收扣款不一致');
  return settlement;
 })],'應收收款合計');
 const retentionTotal=sum([num(ar,'legacyRetentionReceived','歷史保留款'),...retention.map(r=>int(r.amount,'保留款收回'))],'保留款收回合計');
 if(principal!==num(ar,'received','本期已收'))fail('應收總帳與收款歷史不一致');
 if(retentionTotal!==num(ar,'retentionReceived','保留款已收'))fail('保留款總帳與收款歷史不一致');
 return {receipts,principal,retentionTotal};
}
function pendingCheques(state,ar,receipts){
 const rows=ar.receivableCheques===undefined?[]:ar.receivableCheques;
 if(!Array.isArray(rows))fail('支票資料格式無效');
 const seen=new Set(),pending=[];
 for(const row of rows){
  if(row?.schema!=='kushe-receivable-cheque-v1'||!t(row.id)||
     !['pending','cleared','cancelled'].includes(row.status)||
     !Number.isSafeInteger(row.revision)||row.revision<1||seen.has(t(row.id)))fail('支票狀態、版本或識別錯誤');
  seen.add(t(row.id));
  const face=int(row.amount,'支票面額');if(!face)fail('支票面額不可為零');
  if(row.deductions!==undefined&&!Array.isArray(row.deductions))fail('支票扣款格式錯誤');
  const extra=sum((row.deductions||[]).map(d=>int(d?.amount,'票據扣款')),'支票扣款');
  const reserved=int(row.reservedAmount,'預留金額');
  if(reserved!==sum([face,extra],'支票面額與扣款'))fail('票據預留額度不一致');
  if(row.status==='pending'){
   if(t(row.receiptId)||t(row.bankTransactionId))fail('未兌現票據不應已入銀行');
   pending.push(reserved);
  }
  if(row.status==='cleared'){
   const receipt=unique(receipts.filter(r=>t(r.id)===t(row.receiptId)&&t(r.chequeId)===t(row.id)),'票據已兌現收款');
   if(!t(row.bankTransactionId)||t(receipt.bankTransactionId)!==t(row.bankTransactionId))fail('票據銀行連結不符');
   const bank=unique(state.bankTransactions.filter(r=>t(r.id)===t(row.bankTransactionId)),'兌現銀行流水');
   if(t(bank.receiptId)!==t(receipt.id)||t(bank.receivableId)!==t(ar.id)||t(bank.chequeId)!==t(row.id))fail('兌現銀行流水錯誤');
  }
 }
 return sum(pending,'未兌現支票預留');
}
function project(state,id,ledgerReader,options={}){
 if(options?.mode!==MODE)fail('必須使用唯讀審核模式');
 if(!state||typeof state!=='object'||Array.isArray(state))fail('ERP 快照不存在');
 for(const k of ['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions'])
   if(!Array.isArray(state[k]))fail('財務資料尚未完整載入：'+k);
 const revision=t(state.meta?.businessSnapshotRevision?.id);
 if(!revision||!t(options.expectedRevisionId)||revision!==t(options.expectedRevisionId))fail('ERP 快照版本不一致');
 if(!t(id)||typeof ledgerReader?.inspect!=='function')fail('缺少來源或P37-18唯讀帳本');
 const fence=JSON.stringify({billings:state.billings,receivables:state.receivables,invoices:state.invoices,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,bankTransactions:state.bankTransactions,
  billingAllowances:state.billingAllowances,meta:state.meta});
 const ledger=ledgerReader.inspect(state,id);
 if(!ledger||ledger.readOnly!==true||ledger.appliedToERP!==false||ledger.cloudWrites!==0||
    ledger.formalReceiptWriterConnected!==false||
    !['ORIGINAL_UNADJUSTED','POSTED_RECORD_CONTRACT_REVIEW_ONLY'].includes(ledger.status))
    fail('帳本未維持唯讀門禁');
 const ar=unique(state.receivables.filter(r=>t(r?.id)===t(id)),'原應收');
 const b=unique(state.billings.filter(r=>t(r?.id)===t(ar.billingId)||
   Boolean(t(r?.number)&&t(r.number)===t(ar.sourceNo))||t(r?.receivableId)===t(id)),'原請款');
 if(!t(b.id)||!t(b.number)||t(ar.billingId)!==t(b.id)||t(ar.sourceNo)!==t(b.number)||t(b.receivableId)!==t(ar.id))
   fail('請款應收原始關係錯誤');
 const originalReceivable=int(ar.amount,'原應收'),originalRetention=equal(ar,['retentionAmount','retention'],'原保留款')??0;
 if(equal(b,['total'],'原請款應收',true)!==originalReceivable||
    equal(b,['retention','retentionAmount'],'原請款保留款',true)!==originalRetention)
   fail('原請款與原應收不一致');
 const originalGross=sum([originalReceivable,originalRetention],'原含稅');
 const billedGross=equal(b,['grossTotal','taxIncludedAmount'],'請款含稅');
 if(billedGross!==null&&billedGross!==originalGross)fail('原請款總額不平衡');
 const invoice=state.invoices.filter(r=>(t(r.id)&&t(r.id)===t(b.invoiceId))||
    (t(r.billingId)&&t(r.billingId)===t(b.id))||
    (t(r.sourceType)==='billing'&&t(r.sourceId)===t(b.id)));
 if(invoice.length>1||(ledger.status==='POSTED_RECORD_CONTRACT_REVIEW_ONLY'&&invoice.length!==1))fail('發票來源不唯一');
 if(invoice.length===1&&t(b.invoiceNo)&&t(invoice[0].invoiceNumber||invoice[0].number)!==t(b.invoiceNo))fail('發票號碼不一致');
 const settled=settlements(state,ar,b),pending=pendingCheques(state,ar,settled.receipts);
 if(ledger.status==='ORIGINAL_UNADJUSTED'&&ledger.proposed!==null)fail('未折讓但出現核定額');
 if(ledger.status==='POSTED_RECORD_CONTRACT_REVIEW_ONLY'&&(!ledger.proposed||
    ledger.officialVoucherIndependentlyVerifiedBySystem!==false))fail('折讓憑證驗證狀態錯誤');
 const effectiveAR=ledger.proposed?int(ledger.proposed.receivable,'核定應收'):originalReceivable;
 const effectiveRetention=ledger.proposed?int(ledger.proposed.retention,'核定保留款'):originalRetention;
 const effectiveGross=sum([effectiveAR,effectiveRetention],'核定含稅');
 if(effectiveAR>originalReceivable||effectiveRetention>originalRetention)fail('核定金額高於原金額');
 if(ledger.proposed&&(int(ledger.proposed.gross,'核定總額')!==effectiveGross||
    int(ledger.proposed.received,'核定已收')!==settled.principal||
    int(ledger.proposed.retentionReceived,'核定保留款已收')!==settled.retentionTotal))
    fail('帳本與已收歷史不一致');
 const remaining=effectiveAR-settled.principal,retentionRemaining=effectiveRetention-settled.retentionTotal,available=remaining-pending;
 if(remaining<0||retentionRemaining<0||available<0)fail('核定應收不足以支付已收或支票預留');
 const d={gross:originalGross-effectiveGross,receivable:originalReceivable-effectiveAR,retention:originalRetention-effectiveRetention};
 if(d.gross!==d.receivable+d.retention)fail('折讓合計不平衡');
 const result={
  schema:SCHEMA,mode:MODE,status:ledger.proposed?'ALLOWANCE_RECORD_REVIEW_ONLY':'ORIGINAL_UNADJUSTED_READ_ONLY',
  source:{receivableId:t(id),billingId:t(b.id),billingNo:t(b.number),invoiceNo:t(b.invoiceNo),revision},
  original:{gross:originalGross,receivable:originalReceivable,retention:originalRetention},
  proposed:{gross:effectiveGross,receivable:effectiveAR,retention:effectiveRetention,
   principalReceived:settled.principal,retentionReceived:settled.retentionTotal,
   principalOutstanding:remaining,retentionOutstanding:retentionRemaining,
   pendingChequeReserved:pending,receiptInputMaximum:available,retentionInputMaximum:retentionRemaining},
  kpiDelta:{grossReceivableTotal:-d.gross,currentReceivableTotal:-d.receivable,
    retentionTotal:-d.retention,actualBankIncome:0,actualReceiptCount:0,commissions:0,payroll:0},
  requiresFullWriterIntegration:Boolean(ledger.proposed),readOnly:true,appliedToERP:false,
  postingEnabled:false,cloudWrites:0,bankTransactionsAdded:0,actualKpiModified:false,
  formalReceiptWriterConnected:false,formalRetentionWriterConnected:false,
  formalChequeWriterConnected:false,officialVoucherIndependentlyVerifiedBySystem:false
 };
 if(JSON.stringify({billings:state.billings,receivables:state.receivables,invoices:state.invoices,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,bankTransactions:state.bankTransactions,
  billingAllowances:state.billingAllowances,meta:state.meta})!==fence)fail('唯讀查核變更了原始快照');
 return result;
}
const api=Object.freeze({project,SCHEMA,MODE});
if(typeof module==='object'&&module&&module.exports)module.exports=api;
else root.KusheP3719CFormalReader=api;
})(typeof window!=="undefined"?window:globalThis);
