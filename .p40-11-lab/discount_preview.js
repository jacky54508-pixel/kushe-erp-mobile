/* P40-11 standalone synthetic-only discount preview. DO NOT connect to ERP Store.
 * No database access, no persistence, no accounting writers and no network.
 * Amounts always mean NT$ integer; approvedGross means the GROSS amount
 * approved by the client, BEFORE retention and receivable settlement.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KusheP40DiscountPreview=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const states=Object.freeze(['no_invoice','invoice_pending','invoiced']);
  function amount(value,label){
    if((typeof value!=='number'&&typeof value!=='string')||value===''||value===null){
      throw new Error(label+'必須是有效的非負整數');
    }
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<0)throw new Error(label+'必須是有效的非負整數');
    return n;
  }
  function settings(s){
    const taxRate=Number(s.taxRate);
    if(!Number.isFinite(taxRate)||taxRate<0||taxRate>30)throw new Error('稅率必須明確且在 0～30%');
    if(!states.includes(s.invoiceStatus))throw new Error('請先確認發票狀態');
    if(!['未稅','含稅'].includes(s.taxMode))throw new Error('請先確認原請款稅額方式');
    if(!['none','5','10','custom'].includes(s.retentionMode))throw new Error('保留款模式不存在');
    if(!['preTax','taxIncluded'].includes(s.retentionBase))throw new Error('保留款計算基準不明');
    const retentionRate=s.retentionMode==='5'?5:s.retentionMode==='10'?10:s.retentionMode==='custom'?Number(s.retentionRate):0;
    if(!Number.isFinite(retentionRate)||retentionRate<0||retentionRate>100)throw new Error('保留款比例不正確');
    const fixed=s.retentionMode==='custom'&&s.retentionCustom!==undefined&&s.retentionCustom!==null
      ?amount(s.retentionCustom,'固定保留款'):null;
    return {taxRate,invoiceStatus:s.invoiceStatus,taxMode:s.taxMode,retentionMode:s.retentionMode,
      retentionBase:s.retentionBase,retentionRate,retentionCustom:fixed};
  }
  function retentionCalc(net,gross,options){
    const base=options.retentionBase==='preTax'?net:gross;
    const raw=options.retentionCustom!==null&&options.retentionCustom>0?options.retentionCustom:Math.round(base*options.retentionRate/100);
    return Math.min(raw,gross);
  }
  function approvedTotals(approvedGross,o){
    let untaxed,tax;
    if(o.invoiceStatus==='no_invoice'){untaxed=approvedGross;tax=0;}
    else{
      untaxed=Math.round(approvedGross/(1+o.taxRate/100));
      tax=approvedGross-untaxed;
      if(o.taxMode==='未稅'){
        // The existing Store's untaxed-price contract rounds tax from NET.
        const expected=untaxed+Math.round(untaxed*o.taxRate/100);
        if(expected!==approvedGross)throw new Error('核定含稅金額無法依現有未稅計價規則精確換算，請人工核定');
      }
    }
    const retention=retentionCalc(untaxed,approvedGross,o);
    return {untaxed,tax,grossTotal:approvedGross,retention,receivable:approvedGross-retention};
  }
  function preview(spec){
    if(!spec||!spec.original)throw new Error('請款來源與原金額不可空白');
    if(spec.approval?.amountType!=='gross')throw new Error('請明確選擇「建商核定含稅／總請款金額」，不能混用未稅或應收');
    const old=spec.original,o=settings(old),recorded=old.recorded||{};
    const original={
      untaxed:amount(recorded.untaxed,'原請款未稅'),
      tax:amount(recorded.tax,'原請款稅額'),
      grossTotal:amount(recorded.grossTotal,'原請款總額'),
      retention:amount(recorded.retention,'原保留款'),
      receivable:amount(recorded.receivable,'原應收')
    };
    if(original.untaxed+original.tax!==original.grossTotal||
       original.grossTotal-original.retention!==original.receivable)
      throw new Error('原請款的未稅、稅額、保留款與應收不一致，禁止試算');
    const collected=amount(old.received??0,'本期已收款'),
      retentionReceived=amount(old.retentionReceived??0,'已收保留款'),
      pendingCheque=amount(old.pendingCheque??0,'支票預留');
    if(collected>original.receivable||retentionReceived>original.retention||
       pendingCheque>original.receivable-collected)
      throw new Error('原始已收款／保留款／支票證據與原帳不一致，停止試算');
    const target=amount(spec.approval.amount,'建商核定總額');
    if(target<=0||target>original.grossTotal)throw new Error('本流程僅供正數且不超過原請款的議價折讓試算');
    const proposed=approvedTotals(target,o);
    const blockers=[];
    function block(code,label){blockers.push({code,label});}
    if(target===original.grossTotal)block('NO_FINANCIAL_DISCOUNT','核定金額與原單相同，尚無實際折讓');
    if(o.invoiceStatus==='invoiced'||old.issuedInvoice||String(old.invoiceNo||'').trim())
      block('ISSUED_INVOICE','已開發票：需人工核對折讓證明與發票處理，不能直接改原單');
    if(old.merged)block('MERGED_BILLING','已合併請款：原單鎖定，不得解散或改寫來源');
    if((old.receiptCount??0)>0||collected>0)block('RECEIPT_EXISTS','已有收款：須核對收款沖銷與銀行，不得回寫');
    if((old.retentionReceiptCount??0)>0||retentionReceived>0)
      block('RETENTION_RECEIPT_EXISTS','已有保留款收回：須核對已收回額');
    if((old.chequeCount??0)>0||pendingCheque>0)block('CHEQUE_EXISTS','已有支票／預留額：須核對票據');
    if(old.bankLinked)block('BANK_LINKED','存在銀行流水：不得直接更動原單');
    if(old.sourceUnresolved)block('SOURCE_UNVERIFIED','原施工／報價來源未核實');
    if(old.invoiceConflict)block('INVOICE_CONFLICT','發票來源或金額不一致，先核對');
    if(proposed.receivable<collected)block('RECEIPTS_OVER_NEW_AR','試算應收低於已收款');
    if(proposed.retention<retentionReceived)block('RETENTION_OVER_NEW_LIMIT','試算保留款低於已收回款');
    if(pendingCheque>Math.max(0,proposed.receivable-collected))block('CHEQUE_OVER_NEW_AR','未兌現票據超過試算剩餘應收');
    const fields=['untaxed','tax','grossTotal','retention','receivable'];
    const delta=Object.fromEntries(fields.map(key=>[key,proposed[key]-original[key]]));
    const originalOutstanding=original.receivable-collected,
      proposedOutstanding=proposed.receivable-collected;
    return {
      readOnly:true,canPost:false,mode:'PREVIEW_ONLY',
      original,proposed,delta,
      negotiatedReduction:original.grossTotal-target,
      settlement:{
        collected,retentionReceived,pendingCheque,
        originalOutstanding,proposedOutstanding,
        proposedRetentionOutstanding:proposed.retention-retentionReceived,
        proposedCollectibleAfterCheque:proposedOutstanding-pendingCheque
      },
      approval:{amountType:'gross',targetGross:target},
      locks:blockers,
      nextStep:blockers.length?'人工核對／另行設計折讓入帳流程':'僅可作為核對草稿，未經確認不得入帳',
      invoiceHandling:'此試算不產生、不作廢、不更正發票；開票後須另行審核折讓證明。',
      payrollHandling:'員工抽成／薪資不自動重算或調整。',
      originalLinesHandling:'原施工明細、戶別、數量與排序均未變更。'
    };
  }
  return Object.freeze({preview,version:'P40-11-readonly-synthetic-v1'});
});