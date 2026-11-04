(function p37PreflightModule(){
 'use strict';
 // P37-3: READ-ONLY accounting gates and isolated in-memory rehearsal. No persistent accounting postings.
 const $=(s,r=document)=>r.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>'NT$'+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const money=n=>Number.isSafeInteger(Number(n))&&Number(n)>=0?Number(n):null;
 const str=v=>String(v??'').trim();
 function clone(v){return JSON.parse(JSON.stringify(v))}
 function preflight(id){
  const issues=[],add=m=>{if(!issues.includes(m))issues.push(m)};
  let context=null;
  try{
   const auth=window.KusheAuthGate,me=auth?.user?.(),ctx=auth?.companyContext?.();
   if(!/(?:^|\/)beta(?:\/|$)/.test(String(window.location?.pathname||'')))add('此功能只允許在 beta 執行');
   if(!me?.id||!ctx?.companyId||str(ctx.userId)!==str(me.id)||str(ctx.legacySourceUserId)!==str(me.id)||!auth?.canWrite?.('billings'))add('公司請款權限尚未通過驗證');
   const store=window.KuSheERPStore,preview=window.KusheBillingNegotiationPreview,drafts=window.KusheBillingNegotiationDrafts;
   if(!store?.getState||!store?.billingDocumentState||!preview?.inspect||!drafts?.read||!drafts?.anchor)throw new Error('必要模組尚未完整載入');
   const state=store.getState();
   for(const key of ['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions']){
    if(!Array.isArray(state?.[key]))add('缺少帳務資料集：'+key);
   }
   if(issues.length)return {ok:false,issues,context:null,postingEnabled:false};
   const matches=state.billings.filter(x=>str(x.id)===str(id)),bill=matches[0];
   if(!str(id)||matches.length!==1){add('找不到唯一原始請款單');return {ok:false,issues,context:null,postingEnabled:false}}
   const inspected=preview.inspect({id:bill.id});
   if(!inspected.ok){add('原始帳務核對不通過：'+str(inspected.error));return {ok:false,issues,context:null,postingEnabled:false}}
   const base=inspected.baseline;
   if(str(base.number)!==str(bill.number))add('請款號碼與原始查核不一致');
   const doc=store.billingDocumentState(bill.id);
   if(doc?.issues?.length)doc.issues.forEach(x=>add('原始帳務：'+str(x)));
   if(!doc||typeof doc.snapshot!=='string'||!doc.snapshot)add('無法建立原始帳務版本快照');
   const ars=state.receivables.filter(x=>str(x.billingId)===str(bill.id)||(bill.receivableId&&str(x.id)===str(bill.receivableId))||(!x.billingId&&str(x.sourceNo)===str(bill.number)));
   if(ars.length!==1)add('原始請款須唯一對應應收');
   const ar=ars.length===1?ars[0]:null;
   if(ar&&(str(ar.billingId)&&str(ar.billingId)!==str(bill.id)||str(bill.receivableId)&&str(bill.receivableId)!==str(ar.id)))add('請款與應收雙向關聯不一致');
   const invoices=state.invoices.filter(x=>str(x.billingId)===str(bill.id)||(str(x.sourceType)==='billing'&&str(x.sourceId)===str(bill.id))||(!x.billingId&&!x.sourceId&&str(x.sourceNo)===str(bill.number)));
   if(invoices.length!==1)add('原始請款須唯一對應銷項發票');
   const invoice=invoices.length===1?invoices[0]:null;
   if(str(base.invoiceStatus)!=='invoiced'||!str(base.invoiceNo))add('尚未確認此請款的已開立正式發票');
   if(invoice){
    if(str(invoice.status)!=='issued')add('來源發票必須為已開立狀態');
    if(str(invoice.invoiceType)&&str(invoice.invoiceType)!=='output'||/進項/.test(str(invoice.type)))add('來源發票不是銷項發票');
    if(str(invoice.invoiceNumber||invoice.number)!==str(base.invoiceNo))add('發票號碼與請款不一致');
   }
   const local=drafts.read(base);
   if(!local.ok)add('無法讀取經授權的 beta 本機草稿：'+str(local.error));
   else if(local.stale)add('草稿已與原始請款資料不一致');
   else if(!local.latest||local.version<1)add('尚未儲存任何議價草稿');
   const last=local.ok?local.latest:null;
   if(last){
    if(last.version!==local.version||last.status!=='BETA_LOCAL_DRAFT_ONLY')add('草稿版本或狀態不正確');
    const recomputed=preview.calculate(base,String(last.approvedGross));
    if(!recomputed?.ok||recomputed.discount.gross<=0)add('草稿折讓金額不可計算');
    else if(!['approvedGross','approvedNet','approvedTax','approvedRetention','approvedReceivable','discountGross','discountNet','discountTax','discountRetention','discountReceivable'].every((field)=>{
      const collection=field.startsWith('approved')?recomputed.approved:recomputed.discount;
      return money(last[field])===money(collection[field.startsWith('approved')?field.slice(8).toLowerCase():field.slice(8).toLowerCase()]);
    })){
      // Re-evaluate with explicit trusted field mapping below instead of accepting ambiguous fields.
      const a=recomputed.approved,d=recomputed.discount;
      if(last.approvedGross!==a.gross||last.approvedNet!==a.net||last.approvedTax!==a.tax||last.approvedRetention!==a.retention||last.approvedReceivable!==a.receivable||
         last.discountGross!==d.gross||last.discountNet!==d.net||last.discountTax!==d.tax||last.discountRetention!==d.retention||last.discountReceivable!==d.receivable)add('草稿所存金額與最新試算不一致');
    }
   }
   // Disallow settlement edits or adjustment posting while a bank, cheque, receipt or retention link exists.
   if(ar){
    if([ar.received,ar.legacyReceived,ar.retentionReceived,ar.legacyRetentionReceived].some(x=>money(x??0)===null||money(x??0)>0))add('此筆已有收款或保留款紀錄，須進行專案帳務核對');
    if(ar.receivableCheques!==undefined&&(!Array.isArray(ar.receivableCheques)||ar.receivableCheques.length>0))add('此筆已有支票登記或歷史，禁止直接折讓入帳');
    if(money(ar.amount)!==money(base.originalReceivable))add('應收原始金額已與來源不一致');
   }
   const related=(row)=>[str(bill.id),str(ar?.id)].includes(str(row.billingId))&&str(row.billingId)!==''||
      str(row.receivableId)===str(ar?.id)&&str(row.receivableId)!==''||
      str(row.sourceId)===str(bill.id)&&str(row.sourceId)!==''||
      str(row.sourceNo)===str(bill.number)&&str(row.sourceNo)!=='';
   if(state.receipts.some(related))add('已有一般收款或客戶扣款來源紀錄');
   if(state.retentionReceipts.some(related))add('已有保留款收回來源紀錄');
   const receiptIds=new Set([...state.receipts,...state.retentionReceipts].filter(related).flatMap(x=>[x.id,x.retentionReceiptId]).filter(Boolean).map(str));
   if(state.bankTransactions.some(x=>related(x)||receiptIds.has(str(x.sourceId))||receiptIds.has(str(x.receiptId))||receiptIds.has(str(x.retentionReceiptId))))add('已有銀行交易或關聯流水');
   for(const key of ['billingNegotiationAdjustments','billingAllowances']){
    if(state[key]!==undefined&&!Array.isArray(state[key]))add('既有折讓資料集格式異常：'+key);
    else if(Array.isArray(state[key])&&state[key].some(x=>str(x.billingId)===str(bill.id)||str(x.invoiceNo)===str(base.invoiceNo)))add('已有同單折讓紀錄，禁止重複處理');
   }
   if(last&&last.approvedReceivable<(money(ar?.received??0)||0))add('核定應收低於已收款');
   if(last&&last.approvedRetention<(money(ar?.retentionReceived??0)||0))add('核定保留款低於已收保留款');
   if(!issues.length){
    context={billingId:String(bill.id),receivableId:String(ar.id),invoiceId:String(invoice.id||''),invoiceNo:String(base.invoiceNo),
       draftVersion:local.version,documentSnapshot:doc.snapshot,baseline:clone(base),draft:clone(last)};
   }
   return {ok:issues.length===0,issues,context,postingEnabled:false,taxVoucherVerified:false};
  }catch(e){
   add('帳務預檢未完成：'+(e?.message||String(e)));
   return {ok:false,issues,context:null,postingEnabled:false};
  }
 }
 function simulatePure(source,ledger=[]){
  if(!source||!source.context||!source.ok)throw new Error('必須先通過入帳前唯讀檢查');
  if(!Array.isArray(ledger))throw new Error('折讓帳務紀錄格式異常');
  const ctx=source.context,b=ctx.baseline,d=ctx.draft;
  const key='billing-allowance::'+ctx.billingId+'::'+ctx.invoiceNo;
  if(ledger.some(x=>x&&x.idempotencyKey===key||x&&str(x.billingId)===ctx.billingId||x&&str(x.invoiceNo)===ctx.invoiceNo))throw new Error('偵測到重複折讓，已停止模擬');
  if([b.originalNet,b.originalTax,b.originalGross,b.originalRetention,b.originalReceivable,d.approvedNet,d.approvedTax,d.approvedGross,d.approvedRetention,d.approvedReceivable,d.discountNet,d.discountTax,d.discountGross,d.discountRetention,d.discountReceivable].some(x=>!Number.isSafeInteger(x)||x<0))throw new Error('原始與折讓金額格式異常');
  if(b.originalNet-b.originalTax<0){} // no-op: never normalize or rewrite recorded amounts.
  const effective={untaxed:b.originalNet-d.discountNet,tax:b.originalTax-d.discountTax,gross:b.originalGross-d.discountGross,retention:b.originalRetention-d.discountRetention,receivable:b.originalReceivable-d.discountReceivable};
  if(effective.untaxed!==d.approvedNet||effective.tax!==d.approvedTax||effective.gross!==d.approvedGross||effective.retention!==d.approvedRetention||effective.receivable!==d.approvedReceivable||
     effective.untaxed+effective.tax!==effective.gross||effective.gross-effective.retention!==effective.receivable||
     d.discountNet+d.discountTax!==d.discountGross||d.discountReceivable+d.discountRetention!==d.discountGross)throw new Error('折讓及有效餘額勾稽未通過');
  const entry={
    schema:'kushe-billing-allowance-simulation-v1',idempotencyKey:key,
    billingId:ctx.billingId,receivableId:ctx.receivableId,invoiceId:ctx.invoiceId,invoiceNo:ctx.invoiceNo,
    draftVersion:ctx.draftVersion,sourceSnapshot:ctx.documentSnapshot,
    original:{untaxed:b.originalNet,tax:b.originalTax,gross:b.originalGross,retention:b.originalRetention,receivable:b.originalReceivable},
    adjustment:{untaxed:-d.discountNet,tax:-d.discountTax,gross:-d.discountGross,retention:-d.discountRetention,receivable:-d.discountReceivable},
    effective,reason:d.reason||'',negotiationDate:d.date||'',status:'SANDBOX_ONLY_NO_POSTING',taxVoucherStatus:'UNVERIFIED'
  };
  return {ok:true,entry,ledger:[...clone(ledger),clone(entry)],effective,postingEnabled:false,taxVoucherVerified:false};
 }
 function simulate(id,previous){
  const fresh=preflight(id);
  if(!fresh.ok)throw new Error('最新帳務狀態未通過：'+fresh.issues.join('；'));
  if(previous&&(!previous.ok||!previous.context||previous.context.documentSnapshot!==fresh.context.documentSnapshot||previous.context.draftVersion!==fresh.context.draftVersion))throw new Error('帳務或草稿已變動，請重新執行唯讀查核');
  return simulatePure(fresh,[]);
 }
 function mount(overlay,baseline){
  if(!overlay||!baseline||!overlay.querySelector)return false;
  const body=$('.p37-neg-body',overlay),history=$('.p37-draft-history',overlay);
  if(!body||!history||$('.p37-post-gate',overlay))return false;
  const section=document.createElement('section');section.className='p37-post-gate';
  section.innerHTML='<h3>P37-3｜正式折讓入帳安全檢查</h3>'+
    '<p class="p37-post-description">只核對最新帳務與已儲存草稿，並在記憶體模擬獨立折讓紀錄。<strong>沒有正式入帳按鈕，也不會更新任何 ERP 資料。</strong></p>'+
    '<div class="p37-post-actions"><button type="button" class="p37-post-check">執行唯讀預檢</button><button type="button" class="p37-post-simulate" disabled>隔離模擬折讓（不入帳）</button></div>'+
    '<p class="p37-post-status" role="status">尚未執行帳務查核。最新草稿需先儲存，再執行預檢。</p>'+
    '<div class="p37-post-result" hidden></div>'+
    '<p class="p37-post-tax">折讓憑證種類、開立狀態及申報資訊尚未由系統驗證；即使隔離模擬通過，也不得視為正式折讓入帳或稅務憑證已完成。</p>';
  history.insertAdjacentElement('afterend',section);
  const checkButton=$('.p37-post-check',section),simButton=$('.p37-post-simulate',section),status=$('.p37-post-status',section),result=$('.p37-post-result',section);
  let lastCheck=null;
  const show=(msg,error)=>{status.textContent=msg;status.classList.toggle('is-error',Boolean(error))};
  checkButton.addEventListener('click',()=>{
    lastCheck=preflight(baseline.id);
    simButton.disabled=!lastCheck.ok;
    result.hidden=false;
    result.innerHTML=lastCheck.ok?
      '<p class="p37-post-ok">資料預檢通過：請款、應收、正式發票、收款及草稿來源一致。尚未驗證稅務憑證。</p>'+
      '<p>發票：'+esc(lastCheck.context.invoiceNo)+'｜草稿第 '+lastCheck.context.draftVersion+' 版｜原始含稅 '+fmt(lastCheck.context.baseline.originalGross)+'｜議價折讓 '+fmt(lastCheck.context.draft.discountGross)+'</p>':
      '<p class="p37-post-blocked">安全檢查阻擋正式折讓：</p><ul>'+lastCheck.issues.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';
    show(lastCheck.ok?'已通過資料來源預檢，可以進行隔離模擬；正式入帳仍未開放。':'預檢未通過，沒有任何帳務被變更。',!lastCheck.ok);
  });
  simButton.addEventListener('click',()=>{
    if(!lastCheck?.ok)return;
    try{
      const sim=simulate(baseline.id,lastCheck);
      result.hidden=false;
      result.innerHTML='<p class="p37-post-ok">隔離模擬完成：僅建立記憶體中的獨立折讓紀錄，未寫入 ERP。</p>'+
       '<dl class="p37-post-values"><div><dt>原含稅</dt><dd>'+fmt(sim.entry.original.gross)+'</dd></div>'+
       '<div><dt>折讓含稅</dt><dd>'+fmt(-sim.entry.adjustment.gross)+'</dd></div>'+
       '<div><dt>有效含稅（模擬）</dt><dd>'+fmt(sim.effective.gross)+'</dd></div>'+
       '<div><dt>有效本期應收（模擬）</dt><dd>'+fmt(sim.effective.receivable)+'</dd></div>'+
       '<div><dt>有效保留款（模擬）</dt><dd>'+fmt(sim.effective.retention)+'</dd></div></dl>'+
       '<p class="p37-post-notice">原請款、原發票、銀行流水、薪資抽成均未改寫。折讓憑證尚未核實，正式入帳功能維持關閉。</p>';
      simButton.disabled=true;show('隔離模擬完成，沒有寫入、同步或正式折讓入帳。',false);
    }catch(e){simButton.disabled=true;show('模擬已停止：'+(e?.message||String(e)),true)}
  });
  try{
   if(window.KusheBillingVoucherPrecheck?.mount?.(section,baseline.id)!==true){
    const note=document.createElement("p");note.className="p37-post-status is-error";note.textContent="P37-4 核對模組未載入，請重新整理 BETA；資料沒有變更。";section.appendChild(note);
   }
  }catch(error){
   const note=document.createElement("p");note.className="p37-post-status is-error";note.textContent="P37-4 核對模組無法開啟："+(error?.message||String(error))+"；沒有入帳。";section.appendChild(note);
  }
  // P37-5 read-only settlement projection. A missing module must not hide the error.
  try{
    if(window.KusheBillingLinkSimulation?.mount?.(section,baseline.id)!==true){
      const warning=document.createElement('p');warning.className='p37-post-status is-error';
      warning.textContent='P37-5 帳務串聯模擬未載入，請重新整理 BETA；資料沒有更動。';
      section.appendChild(warning);
    }
  }catch(error){
    const warning=document.createElement('p');warning.className='p37-post-status is-error';
    warning.textContent='P37-5 無法開啟：'+(error?.message||String(error))+'。本次沒有入帳。';
    section.appendChild(warning);
  }
  return true;
 }
 window.KusheBillingAllowancePreflight=Object.freeze({preflight,simulatePure,simulate,mount});
})();
