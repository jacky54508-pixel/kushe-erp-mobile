(function p376FinalGate(){
 'use strict';
 // P37-6: FINAL DRY-RUN SAFETY GATE ONLY. This module never posts an allowance, modifies ERP, or syncs.
 const $=(s,r=document)=>r.querySelector(s),str=x=>String(x??'').trim();
 const esc=x=>str(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>'NT$'+Number(x||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const copy=x=>JSON.parse(JSON.stringify(x));
 function fail(s){throw new Error(s)}
 function assertNumber(v,label){
  if(!Number.isSafeInteger(v)||v<0)fail(label+'不是可核對的非負整數');
  return v;
 }
 function identity(g){
  if(!g?.ok||!g.context)fail('P37-3 安全預檢未通過，禁止最終模擬');
  const c=g.context;
  if(!str(c.billingId)||!str(c.receivableId)||!str(c.invoiceId)||!str(c.invoiceNo)||!str(c.documentSnapshot)||!Number.isSafeInteger(c.draftVersion)||c.draftVersion<=0)
   fail('請款、應收、發票或議價草稿識別不完整');
  if(!c.draft||!c.baseline)fail('議價草稿或原始帳務不足');
  return c;
 }
 function proposal(g,projection){
  const c=identity(g),a=projection?.projection;
  if(!projection?.ok||!a||projection.postingEnabled!==false||projection.taxVoucherVerified!==false)
   fail('P37-5 隔離模擬未通過，或來源意外啟用了正式寫入');
  const original=a.originalInvoice,disc=a.allowance,net=a.netSales,ar=a.receivable,ret=a.retention;
  for(const [val,label] of [[original?.untaxed,'原發票未稅'],[original?.tax,'原發票營業稅'],[original?.gross,'原發票含稅'],
     [disc?.untaxed,'折讓未稅'],[disc?.tax,'折讓營業稅'],[disc?.gross,'折讓含稅'],
     [net?.untaxed,'核定未稅'],[net?.tax,'核定營業稅'],[net?.gross,'核定含稅'],
     [ar?.recorded,'原應收'],[ar?.effective,'有效應收'],[ar?.received,'已收'],[ar?.outstanding,'有效未收'],
     [ret?.recorded,'原保留款'],[ret?.effective,'有效保留款'],[ret?.received,'已收保留款'],[ret?.outstanding,'保留款未收']])
    assertNumber(val,label);
  if(original.untaxed+original.tax!==original.gross||disc.untaxed+disc.tax!==disc.gross||net.untaxed+net.tax!==net.gross||
     original.gross-disc.gross!==net.gross||original.untaxed-disc.untaxed!==net.untaxed||original.tax-disc.tax!==net.tax||
     ar.recorded-ar.effective!==c.draft.discountReceivable||ret.recorded-ret.effective!==c.draft.discountRetention||
     ar.effective+ret.effective!==net.gross||ar.outstanding!==ar.effective-ar.received||
     ret.outstanding!==ret.effective-ret.received||disc.gross!==c.draft.discountGross||
     original.gross!==c.baseline.originalGross||str(original.invoiceNo)!==str(c.invoiceNo)||
     original.status!=='issued_unchanged')fail('折讓、應收、保留款、發票有一項不一致');
  if(a.customerDeductions?.additionalAmount!==0||a.customerDeductions?.additionalCount!==0||
     a.bank?.additionalTransactions!==0||a.bank?.additionalIncome!==0||
     a.commissions?.recalculated!==0||a.commissions?.sourceUnchanged!==true||
     a.payroll?.sourceUnchanged!==true||a.status!=='SANDBOX_ONLY_NO_POSTING')fail('模擬包含非預期的客戶扣款、銀行、薪資或抽成異動');
  const ledger=projection.record;
  const key='billing-allowance::'+str(c.billingId)+'::'+str(c.invoiceNo);
  if(ledger?.idempotencyKey!==key||ledger.status!=='DRY_RUN_ONLY'||ledger.billingId!==c.billingId||
     ledger.receivableId!==c.receivableId||ledger.invoiceId!==c.invoiceId||
     ledger.snapshot!==c.documentSnapshot||ledger.draftVersion!==c.draftVersion||
     ledger.adjustment?.gross!==-disc.gross||ledger.adjustment?.tax!==-disc.tax||
     ledger.adjustment?.untaxed!==-disc.untaxed||
     ledger.adjustment?.receivable!==-(ar.recorded-ar.effective)||
     ledger.adjustment?.retention!==-(ret.recorded-ret.effective))fail('折讓帳務預覽紀錄無法匹配原始資料版本');
  const result={
   schema:'kushe-p37-6-final-check-v1',
   stage:'DRY_RUN_NOT_POSTED',
   source:{billingId:str(c.billingId),billingNo:str(c.baseline.number),receivableId:str(c.receivableId),
     invoiceId:str(c.invoiceId),invoiceNo:str(c.invoiceNo),draftVersion:c.draftVersion,documentSnapshot:str(c.documentSnapshot)},
   totals:{originalUntaxed:original.untaxed,originalTax:original.tax,originalGross:original.gross,
     allowanceUntaxed:disc.untaxed,allowanceTax:disc.tax,allowanceGross:disc.gross,
     approvedUntaxed:net.untaxed,approvedTax:net.tax,approvedGross:net.gross,
     effectiveReceivable:ar.effective,effectiveRetention:ret.effective,
     receivableReduction:ar.recorded-ar.effective,retentionReduction:ret.recorded-ret.effective},
   audit:{billings:'UNCHANGED',receivables:'UNCHANGED',invoices:'UNCHANGED',bankTransactions:'UNCHANGED',
     receipts:'UNCHANGED',customerDeductions:'UNCHANGED',commissions:'UNCHANGED',payroll:'UNCHANGED',
     originalDocument:'UNCHANGED',cloudSync:'NOT_EXECUTED'},
   pending:['實際折讓憑證及官方存證尚未由系統驗證',
     '尚未建立經驗收的正式折讓交易寫入與重複入帳保護',
     '尚未完成正式 ERP 與跨裝置同步、復原機制整合驗收',
     '本階段沒有正式入帳授權'],
   canPost:false,taxVerified:false,officiallyIssued:false
  };
  return result;
 }
 function snapshot(state){
  if(!state||typeof state!=='object')fail('ERP 資料尚未載入');
  // Full immutable value comparison in memory, not a weak hash or persistent backup.
  try{return JSON.stringify(state)}catch(_){fail('來源資料無法序列化，不能證明未修改')}
 }
 function validate(id,previous){
  const auth=window.KusheAuthGate,person=auth?.user?.(),company=auth?.companyContext?.();
  if(!/(?:^|\/)beta(?:\/|$)/.test(str(window.location?.pathname))||
     !person?.id||!company?.companyId||str(company.userId)!==str(person.id)||
     str(company.legacySourceUserId)!==str(person.id)||!auth?.canWrite?.('billings'))
   fail('僅能在具備公司請款編輯權限的 BETA 執行');
  const store=window.KuSheERPStore,pre=window.KusheBillingAllowancePreflight,links=window.KusheBillingLinkSimulation;
  if(!store?.getState||!store?.billingDocumentState||!pre?.preflight||!links?.pure)fail('必要的唯讀查核模組尚未完整載入');
  const gate=pre.preflight(id),c=identity(gate);
  if(previous){
   if(!previous?.ok||!previous.review||previous.review.source?.billingId!==str(c.billingId)||
      previous.review.source.documentSnapshot!==str(c.documentSnapshot)||
      previous.review.source.draftVersion!==c.draftVersion||
      previous.review.source.invoiceNo!==str(c.invoiceNo))fail('來源或草稿版本已變動，請重新執行最終查核');
  }
  const firstDoc=store.billingDocumentState(id);
  if(firstDoc?.issues?.length||!firstDoc?.snapshot||str(firstDoc.snapshot)!==str(c.documentSnapshot))
   fail('原始帳務快照不一致，停止隔離模擬');
  const current=store.getState(),before=snapshot(current);
  const linked=links.pure(gate,current,[]);
  const result=proposal(gate,linked);
  const after=snapshot(current);
  if(before!==after)fail('模擬過程意外修改了 ERP 來源資料，已停止');
  const nextDoc=store.billingDocumentState(id);
  if(nextDoc?.issues?.length||str(nextDoc?.snapshot)!==str(c.documentSnapshot))
   fail('模擬期間原始帳務版本異動，已停止');
  return {ok:true,review:result,postingEnabled:false,officialTaxVerified:false};
 }
 function mount(container,id){
  if(!container?.parentElement||!id||container.parentElement.querySelector('.p376-guard'))return false;
  const panel=document.createElement('section');panel.className='p376-guard';
  panel.innerHTML='<h3>P37-6｜正式折讓前最終安全驗證</h3>'+
   '<p>再次核對原始資料版本、應收、發票與保留款，並檢查模擬前後 ERP 資料是否逐值一致。<b>只做隔離驗證，不儲存、不發佈、不開放正式入帳。</b></p>'+
   '<div class="p376-actions"><button type="button" data-p376-check>最終唯讀查核</button><button type="button" data-p376-run disabled>隔離入帳方案驗證（不寫入）</button></div>'+
   '<p class="p376-status" role="status">尚未執行。此檢查不能代替正式折讓憑證或官方平台查核。</p>'+
   '<div class="p376-result" hidden></div>'+
   '<p class="p376-note">正式入帳前仍須會計核對真實折讓憑證，並另行驗收原子交易、防重複、跨裝置同步與復原機制。</p>';
  const after=container.parentElement.querySelector('.p37-link-panel')||container;
  after.insertAdjacentElement('afterend',panel);
  const status=$('.p376-status',panel),output=$('.p376-result',panel),checkButton=$('[data-p376-check]',panel),runButton=$('[data-p376-run]',panel);
  const show=(message,error=false)=>{status.textContent=message;status.classList.toggle('is-error',!!error)};
  let prior=null;
  checkButton.addEventListener('click',()=>{
   try{
    prior=validate(id);runButton.disabled=false;output.hidden=false;
    output.innerHTML='<p class="p376-ok">隔離資料與帳務版本一致；正式帳務仍未入帳。</p>'+
     '<p>發票 '+esc(prior.review.source.invoiceNo)+'｜議價草稿第 '+prior.review.source.draftVersion+' 版｜原單及發票不修改。</p>';
    show('最終唯讀查核通過，可以核對隔離入帳方案；正式入帳仍關閉。');
   }catch(e){prior=null;runButton.disabled=true;output.hidden=false;output.textContent=e?.message||String(e);show('安全查核未通過；沒有修改正式 ERP 資料。',true)}
  });
  runButton.addEventListener('click',()=>{
   if(!prior)return;
   try{
    const latest=validate(id,prior),v=latest.review,values=v.totals;
    output.hidden=false;
    output.innerHTML='<p class="p376-ok">隔離入帳方案驗證完成（無正式寫入）</p>'+
     '<dl class="p376-values">'+[
      ['原始含稅請款／發票',values.originalGross],
      ['獨立擬折讓（含稅）',-values.allowanceGross],
      ['擬折讓營業稅',-values.allowanceTax],
      ['折讓後未稅銷售額',values.approvedUntaxed],
      ['折讓後營業稅',values.approvedTax],
      ['核定後含稅總額',values.approvedGross],
      ['本期有效應收',values.effectiveReceivable],
      ['有效保留款',values.effectiveRetention]
     ].map(([label,n])=>'<div><dt>'+esc(label)+'</dt><dd>'+(n<0?'−':'')+money(Math.abs(n))+'</dd></div>').join('')+'</dl>'+
     '<p>原請款、發票、應收、收款、銀行流水及員工薪資抽成：<b>未修改</b>。跨裝置同步：<b>未執行</b>。</p>'+
     '<p class="p376-block">正式入帳仍不可用：'+v.pending.map(esc).join('；')+'。</p>';
    runButton.disabled=true;show('隔離驗證通過；尚未正式入帳，也沒有變更任何 ERP 資料。');
   }catch(e){runButton.disabled=true;show('隔離驗證停止：'+(e?.message||String(e)),true)}
  });
  // P37-7: in-memory transaction, rollback and two-device mock sync only.
  // A missing or broken module must not silently pass or expose any posting action.
  try{
    if(window.KusheP377SandboxTransactionCore?.mount?.(panel,id)!==true){
      const warning=document.createElement('p');warning.className='p376-status is-error';
      warning.textContent='P37-7 隔離交易核心未載入；請重新整理 BETA。原帳務沒有變更。';
      panel.appendChild(warning);
    }
  }catch(error){
    const warning=document.createElement('p');warning.className='p376-status is-error';
    warning.textContent='P37-7 沙盒未能開啟：'+(error?.message||String(error))+'。沒有正式入帳。';
    panel.appendChild(warning);
  }
  return true;
 }
 window.KusheP376FinalGate=Object.freeze({proposal,validate,mount});
})();
