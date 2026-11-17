/* P40-16A: PURE DRAFT/READ-ONLY concession posting review.
 * Never write invoices, AR, original billings, payroll, commissions, bank or PDF.
 * Not loaded by production index.html. No save, submit or posting endpoint.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.KusheP4016ConcessionReview = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const moneyKeys = ['untaxed','tax','grossTotal','retention','receivable'];
  const unique = xs => new Set(xs).size === xs.length;
  const text = x => String(x ?? '').trim();
  const integer = (x, name) => {
    if (!['string','number'].includes(typeof x) || text(x)==='' ||
        !Number.isSafeInteger(Number(x)) || Number(x)<0) throw Error(name+' 必須是有效非負整數');
    return Number(x);
  };
  const validToken = (x,label) => {
    if (typeof x!=='string' || !x.trim() || x.length>250)
      throw Error(label+' 不完整，停止審核');
    return x;
  };
  const amounts = (obj, label) => {
    const a=Object.fromEntries(moneyKeys.map(k=>[k,integer(obj?.[k],label+'.'+k)]));
    if(a.untaxed+a.tax!==a.grossTotal || a.grossTotal-a.retention!==a.receivable)
      throw Error(label+' 未稅／稅額／含稅／保留款／應收無法勾稽');
    return a;
  };
  function evaluate(input) {
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw Error('缺少待審核議價來源');
    const scope=input.scope;
    if(!['single','merged'].includes(scope)) throw Error('請款範圍未識別');
    validToken(input.documentId,'單據身分');
    validToken(input.expectedSnapshot,'開啟時快照');
    validToken(input.observedSnapshot,'即時快照');
    if(input.expectedSnapshot!==input.observedSnapshot)
      throw Error('來源請款、收款或發票已更新；停止折讓審核');
    const sourceRows=input.sources;
    if(!Array.isArray(sourceRows)||sourceRows.length!==(scope==='single'?1:input.sourceIds?.length)||
        sourceRows.length>(scope==='merged'?30:1)||scope==='merged'&&sourceRows.length<2)
      throw Error('原始請款數量不符');
    if(scope==='merged'&&(input.documentStatus!=='active'||
        !Number.isSafeInteger(input.documentRevision)||input.documentRevision<1||
        !Array.isArray(input.issues)||input.issues.length||
        input.termsChanged||input.settlementChanged))
      throw Error('合併請款有效版本／來源／收款未通過核對');
    const ids=sourceRows.map(s=>validToken(s?.billingId,'原單識別')),
      ars=sourceRows.map(s=>validToken(s?.receivableId,'應收識別'));
    if(!unique(ids)||!unique(ars))throw Error('原單或應收重複，停止審核');
    if(scope==='merged'&&(!unique(input.sourceIds)||input.sourceIds.some((id,i)=>id!==ids[i])))
      throw Error('合併來源的順序或身分不一致');
    const sums=Object.fromEntries(moneyKeys.map(k=>[k,0]));
    let issued=0,received=0,retentionReceived=0,pendingCheque=0;
    const contexts=sourceRows.map((s,i)=>{
      const a=amounts(s?.amounts,'原請款 '+(i+1));
      for(const k of moneyKeys){
        sums[k]+=a[k];
        if(!Number.isSafeInteger(sums[k]))throw Error('合併金額超出安全範圍');
      }
      const r=integer(s?.settlement?.received,'已收款'),
        rr=integer(s?.settlement?.retentionReceived,'已收保留款'),
        cheque=integer(s?.settlement?.pendingCheque,'待兌支票');
      if(r>a.receivable||rr>a.retention||cheque>a.receivable-r)
        throw Error('原收款、保留款與支票狀態不一致');
      received+=r;retentionReceived+=rr;pendingCheque+=cheque;
      if([received,retentionReceived,pendingCheque].some(n=>!Number.isSafeInteger(n)))
        throw Error('收款合計超過安全範圍');
      const status=text(s?.invoice?.status),number=text(s?.invoice?.number);
      if(!['invoiced','invoice_pending','no_invoice'].includes(status))
        throw Error('原單發票狀態不明');
      if(status==='no_invoice'&&number)throw Error('免開發票原單存在票號，需先核對');
      const hasIssued=status==='invoiced'||Boolean(number);
      if(hasIssued)issued++;
      return Object.freeze({billingId:ids[i],receivableId:ars[i],amounts:Object.freeze(a),
        received:r,retentionReceived:rr,pendingCheque:cheque,invoiceStatus:status,
        hasIssuedInvoice:hasIssued});
    });
    const totals=amounts(input.originalTotals,'整張原請款');
    for(const k of moneyKeys)if(sums[k]!==totals[k])
      throw Error('整張原請款與各來源合計不一致：'+k);
    const approvedGross=integer(input.approvedGross,'建商核定總額');
    if(approvedGross<=0||approvedGross>=totals.grossTotal)
      throw Error('核定總額須大於零且小於原總額，才可規劃折讓');
    const discountGross=totals.grossTotal-approvedGross;
    const blockers=[];
    const notes=[];
    if(issued)blockers.push('已有 '+issued+' 張原單開立發票或記載票號；必須由會計確認發票折讓憑證、稅額及日期');
    if(received||retentionReceived)blockers.push('已有收款／保留款收回，不得覆寫原收款或銀行流水');
    if(pendingCheque)blockers.push('存在支票預留，須先核對票據');
    if(!Array.isArray(input.existingAdjustments))
      throw Error('缺少既有折讓紀錄比對資料，防止重複入帳');
    if(input.existingAdjustments.length)
      blockers.push('存在其他折讓紀錄，需核對唯一操作編號、已入帳餘額及剩餘可折讓額');
    const allocations=input.allocations;
    let allocationMathValid=false;
    if(allocations===undefined||allocations===null){
      blockers.push('尚未依原請款逐筆指定折讓分攤及未稅、稅額、保留款、應收差額');
    }else{
      if(!Array.isArray(allocations)||allocations.length!==contexts.length||
          !unique(allocations.map(a=>text(a?.billingId))))
        throw Error('折讓分攤必須與原請款一對一');
      let totalDelta=0;
      for(let i=0;i<contexts.length;i++){
        const c=contexts[i],row=allocations.find(a=>text(a.billingId)===c.billingId);
        if(!row)throw Error('未找到完整的原請款折讓分攤');
        const delta=amounts(row?.delta,'第 '+(i+1)+' 筆分攤');
        for(const k of moneyKeys)if(delta[k]>c.amounts[k])
          throw Error('分攤金額超過原請款已保存金額');
        if(c.amounts.receivable-delta.receivable<c.received)
          blockers.push('有已收應收大於折讓後原單應收，須先處理退款／沖帳');
        if(c.amounts.retention-delta.retention<c.retentionReceived)
          blockers.push('有已收保留款大於折讓後保留款');
        if(c.amounts.receivable-delta.receivable-c.received<c.pendingCheque)
          blockers.push('折讓後應收不足覆蓋待兌支票');
        totalDelta+=delta.grossTotal;
      }
      if(totalDelta!==discountGross)
        throw Error('各原單折讓總額不等於整張折讓金額');
      allocationMathValid=true;
      notes.push('分攤金額僅通過算術勾稽，並非稅務核准或允許入帳');
    }
    notes.push('原請款、18 項對外明細、發票、應收、收款、銀行、薪資及抽成均維持原值');
    notes.push('正式入帳須另行實作不可變調整流水、核定依據、併發／重送保護及回沖機制');
    const result={
      schema:'kushe-p40-16a-readonly-review-v1',readOnly:true,canPost:false,canSave:false,
      scope,documentId:input.documentId,sourceCount:contexts.length,
      originalGross:totals.grossTotal,approvedGross,discountGross,
      issuedSourceCount:issued,received,retentionReceived,pendingCheque,
      allocationMathValid,requiresManualFinancialReview:true,
      taxEffect:'待核對',retentionEffect:'待核對',receivableEffect:'待核對',
      bankEffect:'維持原帳',payrollEffect:'維持原帳',commissionEffect:'維持原帳',
      blockers:Object.freeze(blockers),notes:Object.freeze(notes)
    };
    return Object.freeze(result);
  }
  return Object.freeze({evaluate,version:'P40-16A-safe-review-1'});
});
