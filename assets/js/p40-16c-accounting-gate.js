/* P40-16C: PURE DOCUMENTARY FINANCIAL REVIEW / FUTURE LEDGER DESIGN ONLY.
 * NO posting, no save, no browser or DB access. NOT loaded by index.html.
 * Signatures and accounting evidence are UNVERIFIED user-entered review metadata,
 * NOT proof that a legally valid tax credit note exists.
 */
(function (root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else if(root)root.KusheP4016AccountingGate=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const text=x=>String(x??'').trim();
  const unique=xs=>new Set(xs).size===xs.length;
  const moneyKeys=['untaxed','tax','grossTotal','retention','receivable'];
  const int=(v,label)=>{
    if(!['number','string'].includes(typeof v)||text(v)===''||
      !Number.isSafeInteger(Number(v))||Number(v)<0)
      throw Error(label+'非有效非負整數，停止會計核對');
    return Number(v);
  };
  function date(s){
    return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
      !Number.isNaN(new Date(s+'T00:00:00Z').getTime())&&
      new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  }
  function token(s,label,length=250){
    if(typeof s!=='string'||s.trim().length<2||s.length>length)
      throw Error(label+'未填或格式有誤');
    return s.trim();
  }
  function ledgerCheck(entries,docId,requestKey){
    if(!Array.isArray(entries))throw Error('缺少完整折讓事件清單，無法安全避免重複入帳');
    const eventIds=[],operationKeys=[];
    for(const e of entries){
      if(!e||!['POSTED_SIMULATED','REVERSED_SIMULATED','PROPOSED_SIMULATED'].includes(e.status))
        throw Error('歷史折讓事件狀態無法核對');
      eventIds.push(token(e.eventId,'事件 ID'));
      operationKeys.push(token(e.operationKey,'事件操作鍵'));
      token(e.documentId,'事件來源文件');
    }
    if(!unique(eventIds)||!unique(operationKeys))
      throw Error('折讓事件識別或操作鍵重複，停止');
    const conflicts=entries.filter(e=>e.documentId===docId);
    const used=entries.some(e=>e.operationKey===requestKey);
    return {conflicts,used};
  }
  function reviewPostingPlan({reviewInput,approval,taxEvidence,policy,ledger,operationKey},evaluate){
    if(typeof evaluate!=='function')throw Error('P40-16A 專用唯讀核對器未載入');
    const audit=evaluate(reviewInput); // fail-closed on original sums, source IDs, snapshots, allocation math
    if(!audit.readOnly||audit.canPost!==false||audit.canSave!==false||
       !audit.allocationMathValid||audit.discountGross<=0||!Array.isArray(reviewInput.allocations))
      throw Error('來源原單、金額及完整分攤尚未通過安全核對');
    const key=token(operationKey,'擬議操作唯一鍵');
    const found=ledgerCheck(ledger,reviewInput.documentId,key);
    const blockers=[],warnings=[];
    if(found.used)blockers.push('操作唯一鍵已被使用；禁止再次試算或將來重送');
    if(found.conflicts.length)blockers.push('同一合併文件已存在折讓事件；需先逐版核對已入帳與回沖餘額');
    if(!approval||approval.ownerConfirmed!==true||
       !approval.accountantConfirmed||typeof approval.accountantConfirmed!=='boolean'||
       !date(approval.date)||!text(approval.reason)||text(approval.reason).length<2||
       !text(approval.evidenceRef)){
      blockers.push('欠缺建商核定日期、原因、憑據及負責人／會計雙確認');
    }
    if(!policy||policy.commission!=='preserve-original'||
       policy.payroll!=='preserve-original'||policy.bank!=='preserve-original'||
       policy.receivable!=='manual-contra-review'||
       policy.retention!=='manual-contra-review')
      blockers.push('抽成、薪資、銀行、應收或保留款處理規則尚未逐項核定');
    if(audit.received||audit.retentionReceived||audit.pendingCheque)
      blockers.push('已收款、已收保留款或待兌支票存在；須另立獨立的退款、票據及沖帳程序');
    const evidences=taxEvidence;
    if(!Array.isArray(evidences)||evidences.length!==reviewInput.sources.length)
      blockers.push('缺少每張原請款的會計／稅務處理證據');
    else{
      const ids=evidences.map(row=>text(row?.billingId));
      if(!unique(ids)||reviewInput.sources.some(row=>!ids.includes(row.billingId)))
        throw Error('稅務憑證與原請款識別不一致');
      for(const row of reviewInput.sources){
        const e=evidences.find(e=>e.billingId===row.billingId);
        const isIssued=row.invoice.status==='invoiced'||Boolean(text(row.invoice.number));
        // User-entered fields are evidence references, not independently verified certificates.
        if(!e||e.accountantChecked!==true||!date(e.checkedOn)||
           !['business','consumer','unknown'].includes(e.buyerType)||e.buyerType==='unknown'||
           !['reported','not-reported','exempt','unknown'].includes(e.filingStatus)||
           e.filingStatus==='unknown'||!text(e.taxResolutionRef)||
           (isIssued&&(!text(e.invoiceNumber)||!text(e.allowanceEvidenceRef))))
          blockers.push('原單 '+row.billingId+' 發票折讓文件或會計查核資料不足');
      }
    }
    if(audit.issuedSourceCount>0)
      warnings.push('已開發票原單的證據欄位僅代表人工登記；未驗證折讓證明單開立、傳輸或申報效力');
    warnings.push('同意核定與分攤金額不等於允許 ERP 寫入；任何正式帳務均需後續獨立授權及交易機制');
    const sum=Object.fromEntries(moneyKeys.map(k=>[k,0]));
    for(const allocation of reviewInput.allocations){
      for(const k of moneyKeys){
        sum[k]+=int(allocation.delta?.[k],'擬調整 '+k);
        if(!Number.isSafeInteger(sum[k]))throw Error('擬調整金額超出安全上限');
      }
    }
    if(sum.untaxed+sum.tax!==sum.grossTotal||
       sum.grossTotal-sum.retention!==sum.receivable||
       sum.grossTotal!==audit.discountGross)
      throw Error('總折讓、營業稅、保留款及應收分攤不一致');
    const readyForFurtherReview=blockers.length===0;
    return Object.freeze({
      schema:'kushe-p40-16c-nonposting-plan-v1',
      reviewOnly:true,canPost:false,canSave:false,
      journalWritten:0,bankWritten:0,invoiceWritten:0,arWritten:0,commissionWritten:0,
      docId:reviewInput.documentId,operationKey:key,
      approvedGross:audit.approvedGross,originalGross:audit.originalGross,
      discountGross:audit.discountGross,sourceCount:audit.sourceCount,
      proposedDeltas:Object.freeze(sum),
      readyForFurtherReview,blockers:Object.freeze(blockers),warnings:Object.freeze(warnings),
      notes:Object.freeze(['純文件核對；沒有真正過帳、沖回、折讓憑證或資料更新',
        '如已開電子發票，依法應以電子方式開立／傳輸／接收折讓證明單；ERP 不代替正式稅務系統',
        '員工抽成基準不因折讓試算自動重算，既有原單及 PDF 明細不變'])
    });
  }
  function reviewReversalPlan({recorded,ledger,operationKey,expectedSnapshot,observedSnapshot}){
    const key=token(operationKey,'回沖唯一鍵');
    if(!expectedSnapshot||!observedSnapshot||expectedSnapshot!==observedSnapshot)
      throw Error('原事件或帳務快照已更新，回沖前須重新核對');
    if(!recorded||recorded.status!=='POSTED_SIMULATED')
      throw Error('只接受已登載的虛構入帳事件進行回沖演練');
    token(recorded.eventId,'原事件識別');
    token(recorded.operationKey,'原事件操作鍵');
    token(recorded.documentId,'原事件單據');
    const state=ledgerCheck(ledger,recorded.documentId,key);
    const original=ledger.filter(x=>x.eventId===recorded.eventId);
    if(original.length!==1||JSON.stringify(original[0])!==JSON.stringify(recorded))
      throw Error('原事件不唯一或已更新，拒絕回沖');
    if(state.used||ledger.some(x=>x.reversesEventId===recorded.eventId))
      throw Error('回沖操作重複或原事件已被回沖');
    const values=Object.fromEntries(moneyKeys.map(k=>[k,int(recorded.deltas?.[k],'原調整 '+k)]));
    if(values.untaxed+values.tax!==values.grossTotal||
       values.grossTotal-values.retention!==values.receivable)
      throw Error('原事件金額不平衡，停止回沖');
    const pendingSideEffects=['發票折讓註銷及申報影響','已收款退款與銀行流水','應收回沖','員工抽成／薪資追溯規則'];
    return Object.freeze({
      schema:'kushe-p40-16c-nonposting-reversal-v1',
      reviewOnly:true,canPost:false,canSave:false,
      originalEventId:recorded.eventId,newOperationKey:key,
      originalGrossAdjustment:values.grossTotal,referenceDeltas:Object.freeze(values),
      reversedAmountPosted:0,requiresIndependentAuthorization:true,
      blockers:Object.freeze(pendingSideEffects),
      message:'只產生回沖評估，未新增或取消任何事件、發票、應收、銀行及薪資資料'
    });
  }
  return Object.freeze({reviewPostingPlan,reviewReversalPlan,version:'P40-16C-safety-design-1'});
});
