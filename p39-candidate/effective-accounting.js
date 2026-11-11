/* P39-3B: shared immutable effective billing projection.
 * No Store mutation, no cloud calls, no storage, no official tax issuance.
 * Synthetic candidate ledger entries are never accepted for real ERP snapshots.
 * Legacy/non-allowance receivables retain their original values.
 */
(function (root, factory) {
  'use strict';
  const api=factory();
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.KusheP393EffectiveAccounting=api;
})(typeof window==='object'?window:{},function () {
  'use strict';
  const SCHEMA='kushe-p39-3-allowance-candidate-v1';
  const FIXTURE='kushe-p39-3-synthetic-fixture-v1';
  const POSTED='SYNTHETIC_POSTED_NOT_REAL';
  const clean=value=>String(value??'').trim();
  const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e};
  const int=(value,label)=> {
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)
      fail('EFFECTIVE_INVALID_AMOUNT',label+'不是有效非負整數');
    return value;
  };
  const optional=(row,field,defaultValue=0)=>int(row?.[field]===undefined?defaultValue:row[field],field);
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function unique(items,predicate,label){
    const matches=items.filter(predicate);
    if(matches.length!==1)fail('EFFECTIVE_SOURCE_NOT_UNIQUE',label+'不是唯一來源');
    return matches[0];
  }
  function arrays(state){
    if(!state||!Array.isArray(state.receivables)||!Array.isArray(state.billings))
      fail('EFFECTIVE_SOURCE_INVALID','缺少請款與應收資料');
    if(state.billingAllowances!==undefined&&!Array.isArray(state.billingAllowances))
      fail('EFFECTIVE_LEDGER_INVALID','折讓帳務資料集格式不正確');
  }
  function ledgerRows(state){arrays(state);return state.billingAllowances||[]}
  function originalReceivable(row,strict=false){
    // Legacy records without any allowance must keep their historical display semantics;
    // special historical/decimal/null values are not silently rewritten or rejected.
    const legacyNum=(value)=>{const n=Number(value);return Number.isFinite(n)?n:0};
    const amount=strict?optional(row,'amount'):legacyNum(row.amount);
    const retention=strict?optional(row,'retentionAmount',optional(row,'retention',0)):
      legacyNum(row.retentionAmount??row.retention);
    const received=strict?optional(row,'received'):legacyNum(row.received);
    const retentionReceived=strict?optional(row,'retentionReceived'):legacyNum(row.retentionReceived);
    if(strict&&(received>amount||retentionReceived>retention))
      fail('EFFECTIVE_OVER_SETTLED','原應收已收金額超過原始上限');
    return {receivable:amount,retention,received,retentionReceived,
      outstanding:Math.max(0,amount-received),retentionOutstanding:Math.max(0,retention-retentionReceived),
      discountReceivable:0,discountRetention:0,hasAllowance:false,
      synthetic:false,source:'UNCHANGED_ORIGINAL_AR'};
  }
  function allowanceFor(state,billingId){
    const id=clean(billingId);
    const matches=ledgerRows(state).filter(r=>clean(r?.billingId)===id);
    if(matches.length>1)fail('EFFECTIVE_DUPLICATE_LEDGER','同一請款不可同時存在多筆折讓');
    return matches[0]||null;
  }
  function inspect(state,billingId) {
    arrays(state);
    const id=clean(billingId);
    if(!id)fail('EFFECTIVE_SOURCE_INVALID','請款識別不可空白');
    const billing=unique(state.billings,b=>clean(b?.id)===id,'請款單');
    const receivable=unique(state.receivables,r=>(clean(r?.billingId)===id)||
      (clean(r?.id)===clean(billing.receivableId)&&clean(billing.receivableId)!==''),'應收帳款');
    if(clean(receivable.billingId)!==id||clean(billing.receivableId)!==clean(receivable.id))
      fail('EFFECTIVE_SOURCE_LINK_INVALID','請款、應收雙向關聯不一致');
    const base=originalReceivable(receivable,true);
    const expected={
      untaxed:int(billing.preTaxAmount,'原始未稅'),tax:int(billing.taxAmount,'原始稅額'),
      gross:int(billing.grossTotal,'原含稅'),retention:int(billing.retentionAmount,'原保留款'),
      receivable:int(billing.total,'原請款應收')
    };
    if(expected.untaxed+expected.tax!==expected.gross||
       expected.gross-expected.retention!==expected.receivable||
       expected.receivable!==base.receivable||expected.retention!==base.retention)
      fail('EFFECTIVE_ORIGINAL_MISMATCH','原請款與應收金額不一致');
    const row=allowanceFor(state,id);
    if(!row)return {billingId:id,receivableId:receivable.id,original:expected,
      effective:{...expected},allowance:null,
      ...base};
    // The ledger is an isolated candidate contract. Production states are forbidden
    // from treating a synthetic journal as a formal posting.
    if(row.schema!==SCHEMA||row.status!==POSTED||
       row.productionAuthorized!==false||row.cloudWrites!==0||
       state.__p39Synthetic!==FIXTURE||state.meta?.p39SyntheticSchema!==FIXTURE)
      fail('EFFECTIVE_UNVERIFIED_LEDGER','正式帳務不得採用虛構或未驗證折讓');
    if(clean(row.receivableId)!==clean(receivable.id)||
       clean(row.invoiceNo)!==clean(billing.invoiceNo))
      fail('EFFECTIVE_SOURCE_LINK_INVALID','折讓來源識別與原帳務不一致');
    const original=row.original,effective=row.effective,discount=row.discount;
    if(!original||!effective||!discount)
      fail('EFFECTIVE_LEDGER_INVALID','折讓資料不完整');
    for(const key of ['untaxed','tax','gross','retention','receivable']){
      int(original[key],'原始'+key);int(effective[key],'有效'+key);int(discount[key],'折讓'+key);
      if(original[key]!==expected[key]||expected[key]-effective[key]!==discount[key])
        fail('EFFECTIVE_LEDGER_MISMATCH','折讓紀錄與原始金額不一致：'+key);
    }
    if(effective.untaxed+effective.tax!==effective.gross||
       effective.gross-effective.retention!==effective.receivable||
       discount.untaxed+discount.tax!==discount.gross||
       discount.retention+discount.receivable!==discount.gross||
       row.debit!==discount.gross||row.credit!==discount.gross||
       clean(row.idempotencyKey)!==('p39::'+id+'::'+
         (clean(billing.invoiceNo)||'unissued')))
      fail('EFFECTIVE_LEDGER_MISMATCH','折讓借貸或有效餘額勾稽失敗');
    if(base.received>effective.receivable||base.retentionReceived>effective.retention)
      fail('EFFECTIVE_OVER_SETTLED','已收款大於折讓後應收上限');
    return {
      billingId:id,receivableId:receivable.id,original:expected,
      effective:{...effective},allowance:{...discount},
      receivable:effective.receivable,retention:effective.retention,
      received:base.received,retentionReceived:base.retentionReceived,
      outstanding:effective.receivable-base.received,
      retentionOutstanding:effective.retention-base.retentionReceived,
      discountReceivable:discount.receivable,discountRetention:discount.retention,
      hasAllowance:true,synthetic:true,source:'SYNTHETIC_CANDIDATE_LEDGER_ONLY'
    };
  }
  function forReceivable(state,receivableId){
    arrays(state);
    const id=clean(receivableId);
    const ar=unique(state.receivables,r=>clean(r?.id)===id,'應收帳款');
    const matching=ledgerRows(state).filter(r=>clean(r?.receivableId)===id||
      (ar.billingId&&clean(r?.billingId)===clean(ar.billingId)));
    if(!matching.length)return {...originalReceivable(ar),receivableId:id,
      billingId:clean(ar.billingId)};
    if(matching.length>1)fail('EFFECTIVE_DUPLICATE_LEDGER','應收存在重複折讓');
    if(clean(matching[0].receivableId)!==id||
       clean(matching[0].billingId)!==clean(ar.billingId))
      fail('EFFECTIVE_SOURCE_LINK_INVALID','折讓與應收關聯不完整');
    return inspect(state,ar.billingId);
  }
  function receiptLimit(state,receivableId,kind,requestedAmount){
    const view=forReceivable(state,receivableId);
    if(!['receivable','retention'].includes(kind))
      fail('EFFECTIVE_RECEIPT_KIND','未知收款類別');
    const requested=int(requestedAmount,'收款金額'),remaining=kind==='receivable'?
      view.outstanding:view.retentionOutstanding;
    if(!requested||requested>remaining)
      fail('EFFECTIVE_OVER_COLLECTION','超過折讓後可收金額');
    return {allowed:true,requested,remainingAfter:remaining-requested,
      synthetic:view.synthetic===true};
  }
  function summarize(state){
    const rows=ledgerRows(state),out={count:0,gross:0,untaxed:0,
      tax:0,receivable:0,retention:0};
    const seen=new Set();
    for(const row of rows){
      const id=clean(row?.billingId);
      if(seen.has(id))fail('EFFECTIVE_DUPLICATE_LEDGER','重複折讓來源');
      seen.add(id);
      const view=inspect(state,id);
      if(!view.hasAllowance)fail('EFFECTIVE_LEDGER_INVALID','折讓帳務紀錄未能解析');
      out.count++;
      for(const field of ['gross','untaxed','tax','receivable','retention']){
        const val=out[field]+view.allowance[field];
        if(!Number.isSafeInteger(val))fail('EFFECTIVE_INVALID_AMOUNT','彙總金額超出安全範圍');
        out[field]=val;
      }
    }
    return out;
  }
  return Object.freeze({SCHEMA,FIXTURE,POSTED,inspect,forReceivable,receiptLimit,summarize});
});