(function isolatedModule(root) {
  'use strict';
  // P37-19A: pure in-memory simulation ONLY. No official ERP writer or persistence.
  const SCHEMA='kushe-p37-19-synthetic-v1';
  const INTENT='kushe-p37-19-synthetic-intent-v1';
  const ENTRY='kushe-p37-19-synthetic-entry-v1';
  const KEYS=['untaxed','tax','gross','receivable','retention'];
  const PROTECTED=['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','customerDeductions','commissions','payroll','salaryPayments'];
  const clone=v=>JSON.parse(JSON.stringify(v));
  const val=v=>String(v??'').trim();
  const stop=m=>{throw new Error('P37-19A '+m)};
  function money(v,label){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)stop(label+' 非有效金額');return v}
  function amounts(a,label) {
    if(!a||typeof a!=='object'||Array.isArray(a))stop(label+'格式錯誤');
    for(const k of KEYS)money(a[k],label+k);
    if(a.untaxed+a.tax!==a.gross||a.receivable+a.retention!==a.gross)stop(label+'金額不平衡');
    return a;
  }
  function synthetic(id,label){
    if(!/^P37-19-SYN-[A-Z0-9-]{1,80}$/.test(val(id)))stop(label+'不能使用正式 ERP 識別');
    return val(id);
  }
  function check(s){
    if(!s||s.schema!==SCHEMA||s.scope!=='P37_LAB_SYNTHETIC_ONLY'||
       s.productionData!==false||s.postingEnabled!==false||s.cloudWrites!==0||
       !Array.isArray(s.cases)||!Array.isArray(s.allowances)||!s.protectedRecords)
      stop('只能使用完全隔離合成資料');
    for(const k of PROTECTED)if(!Array.isArray(s.protectedRecords[k]))stop('保護資料缺少 '+k);
    const ids=new Set(),keys=new Set();
    for(const c of s.cases){
      synthetic(c?.id,'案件');
      if(ids.has(c.id))stop('案件識別重複');ids.add(c.id);
      if(!Number.isSafeInteger(c.revision)||c.revision<0||!val(c.documentSnapshot))stop('案件版本錯誤');
      for(const k of ['billingId','billingNo','invoiceId','invoiceNo','receivableId'])synthetic(c.source?.[k],k);
      amounts(c.original,'原始');
      for(const k of ['received','retentionReceived','pendingCheques'])money(c.settled?.[k],k);
      if(c.settled.received>c.original.receivable||c.settled.retentionReceived>c.original.retention)stop('已收超出原額');
    }
    for(const a of s.allowances){
      if(a?.schema!==ENTRY||a.status!=='SYNTHETIC_ONLY_NOT_POSTED'||a.postedToERP!==false||a.cloudWrites!==0||
         !ids.has(a.caseId)||!val(a.idempotencyKey)||keys.has(a.idempotencyKey))stop('既有折讓資料異常');
      keys.add(a.idempotencyKey);amounts(a.reduction,'既有折讓');
    }
    return true;
  }
  function preflight(s,i){
    check(s);
    if(!i||i.schema!==INTENT||i.scope!=='P37_LAB_SYNTHETIC_ONLY'||
       i.postingEnabled!==false||i.officiallyVerified!==false||
       i.voucher?.kind!=='SYNTHETIC_EVIDENCE_NOT_OFFICIAL'||i.voucher?.officiallyIssued!==false)
      stop('憑證未保持模擬未核驗狀態');
    const id=synthetic(i.caseId,'案件'),cases=s.cases.filter(c=>c.id===id);
    if(cases.length!==1)stop('案件不存在或不唯一');
    const c=cases[0];
    if(!Number.isSafeInteger(i.expectedRevision)||c.revision!==i.expectedRevision)stop('CAS 版本衝突');
    if(!val(i.expectedDocumentSnapshot)||i.expectedDocumentSnapshot!==c.documentSnapshot)stop('來源快照過期');
    for(const k of ['billingId','billingNo','invoiceId','invoiceNo','receivableId'])
      if(val(i.source?.[k])!==c.source[k])stop('來源識別異常 '+k);
    const key='p37-19-synthetic::'+id+'::'+c.source.invoiceNo;
    if(i.idempotencyKey!==key)stop('防重複識別鍵不正確');
    if(s.allowances.some(a=>a.caseId===id||a.idempotencyKey===key||a.source?.invoiceNo===c.source.invoiceNo))
      stop('同請款或發票已有折讓');
    const d=amounts(i.reduction,'折讓'),o=c.original,e={};
    if(d.gross<=0||d.gross>=o.gross)stop('折讓金額不可超過原單');
    for(const k of KEYS)e[k]=money(o[k]-d[k],'核定'+k);
    amounts(e,'核定');
    if(c.settled.received||c.settled.retentionReceived||c.settled.pendingCheques)
      stop('已有收款、保留款或支票，停止模擬');
    return {ok:true,caseId:id,idempotencyKey:key,revision:c.revision,
      source:clone(c.source),original:clone(o),reduction:clone(d),effective:e,
      canPost:false,officiallyVerified:false,cloudWrites:0};
  }
  function simulate(s,i,options={}){
    const before=JSON.stringify(s),review=preflight(s,i);
    const point=val(options.failAt);
    if(point&&!['AFTER_INSERT','AFTER_REVISION','BEFORE_VERIFY'].includes(point))stop('未知故障注入');
    const next=clone(s),c=next.cases.find(x=>x.id===review.caseId);
    const entry={schema:ENTRY,status:'SYNTHETIC_ONLY_NOT_POSTED',
      caseId:review.caseId,idempotencyKey:review.idempotencyKey,
      source:clone(review.source),original:clone(review.original),reduction:clone(review.reduction),
      effective:clone(review.effective),postedToERP:false,cloudWrites:0,bankTransactionsAdded:0};
    next.allowances.push(entry);
    if(point==='AFTER_INSERT')stop('故障注入 AFTER_INSERT');
    c.revision+=1;
    if(point==='AFTER_REVISION')stop('故障注入 AFTER_REVISION');
    c.effective=clone(review.effective);
    if(point==='BEFORE_VERIFY')stop('故障注入 BEFORE_VERIFY');
    check(next);
    if(next.allowances.filter(a=>a.caseId===c.id).length!==1||
       c.revision!==review.revision+1||JSON.stringify(next.protectedRecords)!==JSON.stringify(s.protectedRecords))
      stop('交易驗收不符');
    if(JSON.stringify(s)!==before)stop('原始快照遭修改');
    return {ok:true,mode:'COPY_ONLY_NOT_POSTED',postingEnabled:false,
      postedToERP:false,officiallyVerified:false,cloudWrites:0,
      originalUnchanged:true,revision:c.revision,effective:clone(c.effective),
      ledgerEntry:clone(entry),nextState:next};
  }
  const api=Object.freeze({check,preflight,simulate,SCHEMA,INTENT,ENTRY});
  if(typeof module!=='undefined'&&module&&module.exports)module.exports=api;
  else root.KusheP3719SyntheticGuard=api;
  return api;
})(typeof window!=="undefined"?window:globalThis);
