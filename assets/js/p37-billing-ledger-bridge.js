(function p3712Bridge(){
 'use strict';
 // P37-12: PURE proposed ledger + effective receipt limit. No real posting or persistence.
 // The actual ERP receipt writers are NOT wired to this preview.
 const SCHEMA='kushe-p37-12-synthetic-bridge-v1',ENTRY='kushe-p37-12-mock-entry-v1';
 const t=v=>String(v??'').trim(),clone=v=>JSON.parse(JSON.stringify(v));
 function stop(msg){throw new Error(msg)}
 function whole(v,label){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)stop(label+'須為非負整數');return v}
 function exact(row,keys,label,required=true){
  const values=keys.filter(k=>row?.[k]!==undefined&&row[k]!==null&&row[k]!=='').map(k=>row[k]);
  if(!values.length){if(required)stop(label+'缺少來源金額');return null}
  const numbers=values.map(v=>whole(v,label));
  if(numbers.some(v=>v!==numbers[0]))stop(label+'的歷史欄位金額不一致');
  return numbers[0];
 }
 function sameSource(row,b,a){
  return !!(row&&(t(row.billingId)&&t(row.billingId)===t(b.id)||
   t(row.receivableId)&&t(row.receivableId)===t(a.id)||
   t(row.sourceId)&&t(row.sourceId)===t(b.id)||
   t(row.sourceNo)&&t(row.sourceNo)===t(b.number)));
 }
 function checkPlan(p){
  if(p?.schema!=='kushe-p37-10-allowance-plan-v1'||p.mode!=='BETA_REVIEW_ONLY'||
    p.postingEnabled!==false||p.taxVoucherVerified!==false||p.cloudWrites!==0||
    p.documentStatus!=='OFFICIAL_VOUCHER_NOT_VERIFIED'||
    !p.originalInvoiceUnchanged||!p.receiptsUnchanged||!p.bankUnchanged||
    !p.customerDeductionsUnchanged||!p.commissionsUnchanged||!p.payrollUnchanged)
    stop('來源折讓計畫未保持唯讀，禁止串聯');
  const s=p.source||{},o=p.original||{},d=p.allowance||{},e=p.effective||{};
  if(!t(s.billingId)||!t(s.billingNo)||!t(s.receivableId)||!t(s.invoiceId)||
     !t(s.invoiceNo)||!t(s.snapshot)||!Number.isSafeInteger(s.draftVersion)||s.draftVersion<1||
     p.idempotencyKey!=='billing-allowance::'+t(s.billingId)+'::'+t(s.invoiceNo))
     stop('折讓來源或防重複識別不完整');
  for(const part of [o,d,e])for(const k of ['untaxed','tax','gross','receivable','retention'])whole(part[k],k);
  for(const part of [o,d,e]){
   if(part.untaxed+part.tax!==part.gross||part.receivable+part.retention!==part.gross)stop('金額與保留款不平衡');
  }
  for(const k of ['untaxed','tax','gross','receivable','retention'])
   if(o[k]-d[k]!==e[k])stop('核定金額與折讓無法勾稽');
  if(d.gross<=0||o.gross<=d.gross||p.totals?.debit!==d.gross||p.totals?.credit!==d.gross)
   stop('折讓金額或借貸分錄不平衡');
  return {s,o,d,e};
 }
 function checkState(state,p,sourceSnapshot,revisionId){
  const {s,o,d,e}=checkPlan(p);
  if(!state||typeof state!=='object'||Array.isArray(state))stop('ERP 資料未載入');
  for(const k of ['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','commissions'])
   if(!Array.isArray(state[k]))stop(k+' 尚未載入');
  if(sourceSnapshot!==s.snapshot)stop('原始請款版本已變動，禁止模擬');
  if(revisionId!==undefined&&revisionId!==t(state.meta?.businessSnapshotRevision?.id))
   stop('ERP 快照版本已改變');
  const bills=state.billings.filter(x=>t(x?.id)===s.billingId),ars=state.receivables.filter(x=>t(x?.id)===s.receivableId||t(x?.billingId)===s.billingId||t(x?.sourceNo)===s.billingNo),
   invoices=state.invoices.filter(x=>t(x?.id)===s.invoiceId||t(x?.billingId)===s.billingId||(t(x?.sourceType)==='billing'&&t(x?.sourceId)===s.billingId));
  if(bills.length!==1||ars.length!==1||invoices.length!==1)stop('請款、應收或發票不是唯一一對一');
  const b=bills[0],a=ars[0],i=invoices[0];
  if(t(b.number)!==s.billingNo||t(b.receivableId)!==s.receivableId||t(a.billingId)!==s.billingId||
     t(a.sourceNo)!==s.billingNo||t(i.id)!==s.invoiceId||t(i.billingId)!==s.billingId||
     t(i.sourceType)!=='billing'||t(i.sourceId)!==s.billingId||
     t(b.invoiceNo)!==s.invoiceNo||t(a.invoiceNo)!==s.invoiceNo||
     t(i.invoiceNumber||i.number)!==s.invoiceNo||t(i.status)!=='issued'||t(b.invoiceStatus)!=='invoiced')
   stop('已開立發票與請款、應收來源不一致');
  const values=[
   [b,['preTaxAmount','amount'],o.untaxed,'原請款未稅'],
   [b,['taxAmount','tax'],o.tax,'原請款營業稅'],
   [b,['grossTotal','taxIncludedAmount'],o.gross,'原請款含稅'],
   [b,['retention','retentionAmount'],o.retention,'原請款保留款'],
   [b,['total'],o.receivable,'原請款應收'],
   [a,['amount'],o.receivable,'原應收'],
   [a,['untaxedAmount','preTaxAmount'],o.untaxed,'應收未稅'],
   [a,['taxAmount','tax'],o.tax,'應收稅額'],
   [a,['grossTotal','taxIncludedAmount'],o.gross,'應收含稅'],
   [a,['retention','retentionAmount'],o.retention,'應收保留款'],
   [i,['netAmount','amount'],o.untaxed,'原發票未稅'],
   [i,['taxAmount','tax'],o.tax,'原發票稅額'],
   [i,['grossAmount','total'],o.gross,'原發票含稅']
  ];
  for(const [row,keys,expected,label] of values){
   const val=exact(row,keys,label);
   if(val!==expected)stop(label+'與原始帳務不符');
  }
  for(const k of ['received','retentionReceived','legacyReceived','legacyRetentionReceived'])
   if(whole(a[k]??0,k)!==0)stop('已存在收款，須改用專案折讓程序');
  if(a.receivableCheques!==undefined&&(!Array.isArray(a.receivableCheques)||a.receivableCheques.length))
   stop('已有支票登記或歷史，禁止直接折讓');
  if([...state.receipts,...state.retentionReceipts,...state.bankTransactions].some(row=>sameSource(row,b,a)))
   stop('此筆已有收款或銀行交易，禁止直接折讓');
  for(const k of ['billingAllowances','billingNegotiationAdjustments','salesAllowances','salesCreditNotes','customerDeductions']){
   if(state[k]!==undefined&&!Array.isArray(state[k]))stop(k+' 資料格式異常');
   if(state[k]?.some(row=>t(row?.billingId)===s.billingId||t(row?.receivableId)===s.receivableId||t(row?.invoiceNo)===s.invoiceNo||t(row?.idempotencyKey)===p.idempotencyKey))
    stop('同張請款、應收或發票已有折讓／扣款紀錄');
  }
  return {b,a,i,s,o,d,e};
 }
 function effectiveLimit(state,receivableId){
  const ars=state?.receivables?.filter(x=>t(x?.id)===t(receivableId))||[];
  if(ars.length!==1)stop('找不到唯一的應收帳款');
  const a=ars[0],originalReceivable=exact(a,['amount'],'原應收'),originalRetention=exact(a,['retentionAmount','retention'],'原保留款');
  if(state.billingAllowances!==undefined&&!Array.isArray(state.billingAllowances))stop('折讓帳格式異常');
  const entries=(state.billingAllowances||[]).filter(x=>t(x?.receivableId)===t(receivableId));
  if(entries.length>1)stop('已有多筆折讓，禁止重複核算');
  const row=entries[0]||null;
  if(row&&(row.schema!==ENTRY||row.status!=='SYNTHETIC_NOT_POSTED'||row.source?.receivableId!==t(receivableId)||
      row.idempotencyKey!=='billing-allowance::'+t(row.source.billingId)+'::'+t(row.source.invoiceNo)))
   stop('此帳不是可用於隔離測試的折讓紀錄');
  const reduction=row?.reduction||{receivable:0,retention:0},received=whole(a.received??0,'已收款'),retentionReceived=whole(a.retentionReceived??0,'保留款已收');
  const effectiveReceivable=originalReceivable-whole(reduction.receivable,'本期應收折讓');
  const effectiveRetention=originalRetention-whole(reduction.retention,'保留款折讓');
  if(effectiveReceivable<received||effectiveRetention<retentionReceived)
   stop('折讓後有效餘額低於已收款');
  return {originalReceivable,originalRetention,effectiveReceivable,effectiveRetention,
    receivableOutstanding:effectiveReceivable-received,retentionOutstanding:effectiveRetention-retentionReceived,
    status:'SYNTHETIC_RECEIPT_LIMIT_ONLY',formalReceiptReaderConnected:false};
 }
 function simulate(state,plan,sourceSnapshot,revisionId){
  const input=checkState(state,plan,sourceSnapshot,revisionId),before=JSON.stringify(state);
  const next=clone(state),entry={
   schema:ENTRY,status:'SYNTHETIC_NOT_POSTED',
   idempotencyKey:plan.idempotencyKey,source:clone(plan.source),
   billingId:plan.source.billingId,receivableId:plan.source.receivableId,
   invoiceId:plan.source.invoiceId,invoiceNo:plan.source.invoiceNo,
   original:clone(plan.original),reduction:clone(plan.allowance),effective:clone(plan.effective),
   voucherStatus:'NOT_VERIFIED',postable:false
  };
  if(next.billingAllowances===undefined)next.billingAllowances=[];
  next.billingAllowances.push(entry);
  const limit=effectiveLimit(next,plan.source.receivableId);
  if(limit.effectiveReceivable!==input.e.receivable||limit.effectiveRetention!==input.e.retention)
   stop('折讓與模擬收款上限不同');
  for(const key of ['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','commissions','payroll','salaryPayments'])
   if(JSON.stringify(state[key])!==JSON.stringify(next[key]))stop('模擬中有非折讓資料被更動：'+key);
  if(JSON.stringify(state)!==before)stop('來源 ERP 快照被變更');
  return {ok:true,schema:SCHEMA,ledgerEntry:clone(entry),effective:clone(plan.effective),limit,
    nextState:next,postingEnabled:false,formalReceiptReaderConnected:false,cloudWrites:0,originalStateUnchanged:true};
 }
 window.KusheP3712LedgerBridge=Object.freeze({checkPlan,checkState,effectiveLimit,simulate});
})();