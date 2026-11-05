(function p3718EffectiveLedger(){
 'use strict';
 // P37-18: pure ledger reader. NEVER applies proposed money to the formal ERP.
 const SCHEMA='kushe-p37-18-effective-ledger-review-v1';
 const RECORD='kushe-p37-18-posted-ledger-contract-v1';
 const clean=v=>String(v??'').trim();
 const copy=v=>JSON.parse(JSON.stringify(v));
 function fail(msg){throw new Error('P37-18 '+msg)}
 function money(v,label){
  if(typeof v==='string'){
   if(!/^(0|[1-9]\d*)$/.test(v))fail(label+'不是有效金額');
   v=Number(v);
  }
  if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)fail(label+'不是有效非負整數');
  return v;
 }
 function sameNumber(row,fields,label,required=true){
  const vals=fields.filter(k=>row?.[k]!==undefined&&row[k]!==null&&row[k]!=='').map(k=>money(row[k],label));
  if(vals.length===0){if(required)fail(label+'缺少金額');return null}
  if(vals.some(v=>v!==vals[0]))fail(label+'的不同欄位金額不一致');
  return vals[0];
 }
 function related(row,receivable,bills){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('折讓資料格式無法辨識');
  const src=row.source&&typeof row.source==='object'&&!Array.isArray(row.source)?row.source:{};
  const billed=new Set([clean(receivable.billingId),...bills.map(b=>clean(b.id))].filter(Boolean));
  const billNos=new Set([clean(receivable.sourceNo),...bills.map(b=>clean(b.number))].filter(Boolean));
  const invoiceNos=new Set([clean(receivable.invoiceNo),...bills.map(b=>clean(b.invoiceNo))].filter(Boolean));
  return [row.receivableId,src.receivableId].some(x=>clean(x)!==''&&clean(x)===clean(receivable.id))||
   [row.billingId,src.billingId].some(x=>clean(x)!==''&&billed.has(clean(x)))||
   [row.billingNo,row.sourceNo,src.billingNo].some(x=>clean(x)!==''&&billNos.has(clean(x)))||
   [row.invoiceNo,row.invoiceNumber,src.invoiceNo].some(x=>clean(x)!==''&&invoiceNos.has(clean(x)));
 }
 function inspect(state,id){
  if(!state||!Array.isArray(state.receivables)||!Array.isArray(state.billings)||!Array.isArray(state.invoices))
   fail('ERP 基本帳務尚未完整載入');
  const rid=clean(id),ars=state.receivables.filter(a=>clean(a?.id)===rid);
  if(!rid||ars.length!==1)fail('找不到唯一的應收帳款');
  const ar=ars[0],originalAR=sameNumber(ar,['amount'],'原應收'),
   originalRetention=sameNumber(ar,['retentionAmount','retention'],'原保留款',false)??0;
  const received=money(ar.received??0,'本期已收'),retentionReceived=money(ar.retentionReceived??0,'保留款已收');
  if(received>originalAR||retentionReceived>originalRetention)
   fail('原應收或原保留款已收超過可收金額');
  const bills=state.billings.filter(b=>
    (clean(ar.billingId)&&clean(b?.id)===clean(ar.billingId))||
    (clean(ar.sourceNo)&&clean(b?.number)===clean(ar.sourceNo)));
  const possible=[];
  for(const key of ['billingAllowances','billingNegotiationAdjustments','salesAllowances','salesCreditNotes']){
   if(state[key]===undefined)continue;
   if(!Array.isArray(state[key]))fail(key+'資料集格式異常');
   for(const row of state[key])if(related(row,ar,bills))possible.push({key,row});
  }
  const original={receivable:originalAR,retention:originalRetention,
   received,retentionReceived,
   receivableOutstanding:originalAR-received,retentionOutstanding:originalRetention-retentionReceived};
  if(possible.length===0)return {schema:SCHEMA,status:'ORIGINAL_UNADJUSTED',readOnly:true,
   source:{receivableId:rid,billingId:clean(ar.billingId),billingNo:clean(ar.sourceNo)},
   original,proposed:null,appliedToERP:false,formalReceiptWriterConnected:false,cloudWrites:0};
  if(possible.length!==1||possible[0].key!=='billingAllowances')
   fail('關聯折讓紀錄不唯一或來自尚未整合的資料集');
  const item=possible[0].row;
  if(item.schema!==RECORD||item.status!=='POSTED_VERIFIED'||
     item.posting?.accountantApproved!==true||!clean(item.posting?.commitRevision)||
     !clean(item.posting?.approvedBy)||!clean(item.posting?.approvedAt)||
     !clean(item.posting?.verificationReference))
   fail('折讓雖有關聯，但不符合已核准入帳紀錄格式');
  const src=item.source||{},originalRow=item.original||{},discount=item.allowance||{},effective=item.effective||{},voucher=item.voucher||{};
  if(!clean(src.billingId)||!clean(src.billingNo)||!clean(src.invoiceId)||!clean(src.invoiceNo)||
     !clean(src.receivableId)||!clean(src.documentSnapshot)||!Number.isSafeInteger(src.draftVersion)||src.draftVersion<1||
     clean(item.idempotencyKey)!=='billing-allowance::'+clean(src.billingId)+'::'+clean(src.invoiceNo)||
     clean(src.receivableId)!==rid||clean(item.receivableId)!==rid||
     clean(item.billingId)!==clean(src.billingId)||clean(item.invoiceNo)!==clean(src.invoiceNo))
   fail('折讓與原請款、發票識別不一致');
  if(bills.length!==1)fail('原請款關係不唯一');
  const bill=bills[0],invoices=state.invoices.filter(i=>clean(i?.id)===clean(src.invoiceId)||
    clean(i?.billingId)===clean(src.billingId));
  if(invoices.length!==1)fail('原發票關係不唯一');
  const invoice=invoices[0];
  if(clean(bill.id)!==clean(src.billingId)||clean(bill.number)!==clean(src.billingNo)||
     clean(bill.receivableId)!==rid||clean(bill.invoiceNo)!==clean(src.invoiceNo)||
     clean(ar.billingId)!==clean(src.billingId)||clean(ar.sourceNo)!==clean(src.billingNo)||
     clean(invoice.id)!==clean(src.invoiceId)||clean(invoice.billingId)!==clean(src.billingId)||
     clean(invoice.invoiceNumber||invoice.number)!==clean(src.invoiceNo)||
     clean(invoice.status)!=='issued'||clean(bill.invoiceStatus)!=='invoiced')
   fail('請款、應收與已開發票原始關聯不一致');
  if(!clean(voucher.number)||!clean(voucher.date)||!clean(voucher.proofLocation)||
     !clean(voucher.verificationReference)||clean(voucher.verificationReference)!==clean(item.posting.verificationReference)||
     clean(voucher.number)===clean(src.invoiceNo))
   fail('折讓憑證的證據或核准來源不足');
  if(Array.isArray(state.billingAllowances)){
   const duplicate=state.billingAllowances.filter(row=>
     clean(row?.voucher?.number)===clean(voucher.number)&&clean(voucher.number)!=='');
   if(duplicate.length!==1)fail('相同折讓憑證識別碼對應多筆資料');
  }
  const amounts={
   untaxed:sameNumber(bill,['amount','preTaxAmount'],'原請款未稅'),
   tax:sameNumber(bill,['tax','taxAmount'],'原請款稅額'),
   gross:sameNumber(bill,['grossTotal','taxIncludedAmount'],'原請款含稅'),
   receivable:sameNumber(bill,['total'],'原請款本期應收'),
   retention:sameNumber(bill,['retention','retentionAmount'],'原請款保留款')
  };
  if(amounts.untaxed+amounts.tax!==amounts.gross||
     amounts.receivable+amounts.retention!==amounts.gross)
   fail('原請款未稅與含稅或保留款不平衡');
  if(sameNumber(invoice,['netAmount','amount'],'原發票未稅')!==amounts.untaxed||
     sameNumber(invoice,['taxAmount','tax'],'原發票稅額')!==amounts.tax||
     sameNumber(invoice,['grossAmount','total'],'原發票含稅')!==amounts.gross||
     originalAR!==amounts.receivable||originalRetention!==amounts.retention)
   fail('原應收或已開發票金額不一致');
  for(const k of ['untaxed','tax','gross','receivable','retention']){
   if(money(originalRow[k],'原始'+k)!==amounts[k])fail('折讓保存的原始金額與請款不同');
   money(discount[k],'折讓'+k);money(effective[k],'核定'+k);
   if(originalRow[k]-discount[k]!==effective[k])fail('核定差額與折讓不一致');
  }
  if(discount.gross<=0||discount.gross>=amounts.gross||
     discount.untaxed+discount.tax!==discount.gross||
     discount.receivable+discount.retention!==discount.gross||
     effective.untaxed+effective.tax!==effective.gross||
     effective.receivable+effective.retention!==effective.gross||
     received>effective.receivable||retentionReceived>effective.retention)
   fail('折讓、已收或有效餘額無法勾稽');
  const proposed={
   ...copy(effective),received,retentionReceived,
   receivableOutstanding:effective.receivable-received,
   retentionOutstanding:effective.retention-retentionReceived,
   voucherNo:clean(voucher.number)
  };
  return {schema:SCHEMA,status:'POSTED_RECORD_CONTRACT_REVIEW_ONLY',readOnly:true,
   source:{receivableId:rid,billingId:clean(src.billingId),billingNo:clean(src.billingNo),invoiceNo:clean(src.invoiceNo)},
   original,proposed,appliedToERP:false,formalReceiptWriterConnected:false,
   officialVoucherIndependentlyVerifiedBySystem:false,cloudWrites:0};
 }
 window.KusheP3718EffectiveLedger=Object.freeze({inspect});
})();