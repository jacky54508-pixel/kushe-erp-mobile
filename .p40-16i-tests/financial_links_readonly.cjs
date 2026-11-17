/* P40-16I: PURE READ-ONLY structure audit for SYNTHETIC ERP snapshots.
 * NOT included in index.html. Never loads, saves or repairs business data.
 * Warns on historical/ambiguous links; NEVER claims legal or accounting approval.
 * In particular, does not infer a commission correction from a merged total.
 */
'use strict';
const FIELDS=Object.freeze(['untaxed','tax','grossTotal','retention','receivable']);
const ARRAYS=Object.freeze(['billings','receivables','invoices','receipts',
  'retentionReceipts','commissions','payroll','salaryPayments','bankTransactions']);
const id=x=>String(x??'').trim();
const isMoney=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const unique=values=>new Set(values).size===values.length;
const freeze=x=>Object.freeze(x);
function verifyAmounts(raw,label){
  if(!raw||FIELDS.some(k=>!isMoney(raw[k])))throw Error(label+'：原金額欄位缺漏或不是安全非負整數');
  const a=Object.fromEntries(FIELDS.map(k=>[k,raw[k]]));
  if(a.untaxed+a.tax!==a.grossTotal||a.grossTotal-a.retention!==a.receivable)
    throw Error(label+'：未稅、稅額、含稅、保留款和應收金額無法勾稽');
  return a;
}
function check(input,groupId){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('ERP 業務快照格式錯誤');
  const base=Object.fromEntries(ARRAYS.map(k=>{
    if(!Array.isArray(input[k]))throw Error('缺少必要的唯讀帳務陣列：'+k);
    return [k,input[k]];
  }));
  const docs=input.meta?.externalBillingDocuments;
  if(!Array.isArray(docs))throw Error('缺少對外合併請款文件資料');
  if(docs.length>5000)throw Error('文件數量超出審核上限');
  const matches=docs.filter(x=>id(x?.id)===id(groupId));
  if(matches.length!==1)throw Error('合併請款文件未能唯一識別');
  const g=matches[0];
  if(g.status!=='active'||!Number.isSafeInteger(g.revision)||g.revision<1)
    throw Error('合併請款非有效正式版，停止核對');
  if(!Array.isArray(g.sourceIds)||g.sourceIds.length<2||g.sourceIds.length>30||
     g.sourceIds.some(x=>!id(x))||!unique(g.sourceIds.map(id)))
    throw Error('合併來源原單數量／身分不完整或重複');
  if(!g.sourceIds.some(x=>id(x)===id(g.targetBillingId)))
    throw Error('對外顯示區域不是本合併來源，停止核對');
  if(!Array.isArray(g.sourceSnapshots)||g.sourceSnapshots.length!==g.sourceIds.length||
     !Array.isArray(g.settlementSnapshots)||g.settlementSnapshots.length!==g.sourceIds.length)
    throw Error('來源或收款版本快照缺失');
  const ids=g.sourceIds.map(id),warnings=[],blockers=[],originals=[];
  const sums=Object.fromEntries(FIELDS.map(k=>[k,0]));
  const boundArIds=new Set(),relatedReceipts=new Set(),relatedRetentionReceipts=new Set();
  const allBillings=base.billings,allAr=base.receivables;
  for(let i=0;i<ids.length;i++){
    const originalId=ids[i],match=allBillings.filter(b=>id(b?.id)===originalId);
    if(match.length!==1)throw Error('原單不存在或重複：'+originalId);
    const bill=match[0],arCandidates=allAr.filter(a=>id(a?.billingId)===originalId);
    // No fallback from a billing number: legacy numbers are documentary hints,
    // and must be verified independently before enabling accounting posting.
    if(arCandidates.length!==1)throw Error('原單缺少唯一 billingId 應收關聯：'+originalId);
    const ar=arCandidates[0];
    if(!id(ar.id)||boundArIds.has(id(ar.id)))throw Error('原單對應應收身分重複');
    boundArIds.add(id(ar.id));
    if(bill.receivableId&&id(bill.receivableId)!==id(ar.id))
      throw Error('原單保存的 receivableId 與應收主檔不一致');
    const detail=verifyAmounts({
      untaxed:bill.preTaxAmount??bill.amount,
      tax:bill.taxAmount??bill.tax,
      grossTotal:bill.grossTotal,
      retention:bill.retentionAmount??bill.retention,
      receivable:bill.total
    },'原單 '+(i+1));
    if(!isMoney(ar.amount)||ar.amount!==detail.receivable)
      throw Error('應收金額與原始請款不符：'+originalId);
    for(const k of FIELDS){
      sums[k]+=detail[k];
      if(!Number.isSafeInteger(sums[k]))throw Error('合併總額超出安全整數');
    }
    const saved=g.sourceSnapshots[i],settled=g.settlementSnapshots[i];
    if(id(saved?.billingId)!==originalId||id(settled?.billingId)!==originalId)
      throw Error('來源或收款快照對應原單錯誤');
    if(!saved.anchors)throw Error('來源快照缺少原單保存金額');
    const anchor=verifyAmounts(saved.anchors,'保存快照 '+(i+1));
    for(const k of FIELDS)if(anchor[k]!==detail[k])
      blockers.push('第 '+(i+1)+' 張原單金額與保存快照不同，需重新核對');
    const outputInvoices=base.invoices.filter(inv=>{
      const typ=id(inv?.invoiceType);
      return (typ==='output'||typ==='') &&
        (id(inv?.sourceId)===originalId||id(inv?.billingId)===originalId);
    });
    if(outputInvoices.length>1)
      blockers.push('第 '+(i+1)+' 張原單關聯多張銷項發票紀錄，需人工核對');
    const invoiced=bill.invoiceStatus==='invoiced'||Boolean(id(bill.invoiceNo))||
      outputInvoices.some(inv=>inv.status==='issued');
    if(invoiced){
      blockers.push('第 '+(i+1)+' 張原單已有發票證據，須會計核對折讓憑證及稅額');
      if(!id(bill.invoiceNo)&&!outputInvoices.some(inv=>id(inv.invoiceNumber)))
        warnings.push('第 '+(i+1)+' 張原單的已開票資料缺少可核對票號');
    }
    const receiptRows=base.receipts.filter(x=>id(x?.receivableId)===id(ar.id)||
      id(x?.billingId)===originalId);
    const retentionRows=base.retentionReceipts.filter(x=>id(x?.receivableId)===id(ar.id)||
      id(x?.billingId)===originalId);
    for(const r of receiptRows)relatedReceipts.add(id(r.id));
    for(const r of retentionRows)relatedRetentionReceipts.add(id(r.id));
    if(receiptRows.length||retentionRows.length||Number(ar.received)>0||
       Number(ar.retentionReceived)>0)
      blockers.push('第 '+(i+1)+' 張原單已有收款或保留款紀錄，需獨立對帳');
    const directs=base.commissions.filter(x=>id(x?.billingId)===originalId||
      x?.sourceType==='billing'&&id(x?.sourceId)===originalId);
    if(directs.length)warnings.push('第 '+(i+1)+' 張原單關聯 '+directs.length+
      ' 筆直接抽成紀錄；仍須核對每日施工衍生抽成');
    let paidPayroll=false;
    for(const c of directs){
      const month=id(c.date).slice(0,7);
      if(base.payroll.some(p=>id(p.employee||p.employeeId)===id(c.employee)&&
          id(p.month)===month&&p.status==='已付款'))paidPayroll=true;
    }
    if(paidPayroll)blockers.push('第 '+(i+1)+' 張原單存在已付款薪資相關抽成，禁止改寫');
    originals.push(freeze({billingId:originalId,receivableId:id(ar.id),
      invoiceStatus:id(bill.invoiceStatus),hasInvoiceEvidence:invoiced,
      receiptRecordCount:receiptRows.length,retentionReceiptRecordCount:retentionRows.length,
      directCommissionCount:directs.length,paidPayrollLinked:paidPayroll,
      amounts:freeze(detail)}));
  }
  const savedTotals=verifyAmounts(g.totals,'合併文件已保存合計');
  for(const k of FIELDS){
    if(savedTotals[k]!==sums[k])
      blockers.push('合併文件已保存合計與現在來源不同：'+k);
  }
  const sharedOther=docs.filter(d=>d!==g&&d.status==='active'&&
    Array.isArray(d.sourceIds)&&d.sourceIds.some(sourceId=>ids.includes(id(sourceId))));
  if(sharedOther.length)throw Error('同一原單同時出現在另一份有效合併文件');
  const relatedBanks=base.bankTransactions.filter(tx=>
    ids.includes(id(tx?.sourceId))||boundArIds.has(id(tx?.sourceId))||
    relatedReceipts.has(id(tx?.sourceId))||
    relatedRetentionReceipts.has(id(tx?.sourceId)));
  if(relatedBanks.length)warnings.push('相關銀行交易存在 '+relatedBanks.length+
    ' 筆，原始銀行流水必須保持不變');
  if(!input.meta?.businessSnapshotRevision||typeof input.meta.businessSnapshotRevision!=='object')
    blockers.push('本機業務版本缺少完整的 businessSnapshotRevision');
  warnings.push('抽成可能由每日施工、原單或人工來源產生；不能從合併總額直接重算');
  warnings.push('發票尚需人工確認原單、憑證、申報狀態；此唯讀查核不是法定折讓');
  return freeze({
    schema:'kushe-p40-16i-financial-links-readonly-v1',
    documentId:id(g.id),documentRevision:g.revision,
    sourceCount:ids.length,targetBillingId:id(g.targetBillingId),
    totals:freeze(sums),sourceLinks:freeze(originals),
    relatedBankRecordCount:relatedBanks.length,
    blockers:freeze(blockers),warnings:freeze(warnings),
    readOnly:true,canPost:false,canSave:false,changesWritten:0,
    status:blockers.length?'BLOCKED':'MANUAL_REVIEW_REQUIRED'
  });
}
module.exports=freeze({check,schema:'kushe-p40-16i-financial-links-readonly-v1'});
