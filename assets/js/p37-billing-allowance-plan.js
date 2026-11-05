(function p3710AllowancePlanModule(){
  'use strict';
  // P37-10: beta-only, read-only accounting projection; no ERP persistence or cloud write.
  const SCHEMA='kushe-p37-10-allowance-plan-v1';
  const txt=v=>String(v??'').trim();
  const copy=v=>JSON.parse(JSON.stringify(v));
  const money=v=>'NT$'+Number(v).toLocaleString('zh-TW',{maximumFractionDigits:0});
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function stop(message){throw new Error(message)}
  function integer(x,label){if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0)stop(label+' 不是有效的非負整數');return x}
  function check(report){
    if(report?.schema!=='kushe-p37-6-final-check-v1'||report.stage!=='DRY_RUN_NOT_POSTED'||
       report.canPost!==false||report.taxVerified!==false||report.officiallyIssued!==false||
       !Array.isArray(report.pending)||!report.pending.length)stop('只接受 P37-6 未入帳的核對結果');
    const s=report.source||{},t=report.totals||{},a=report.audit||{};
    for(const k of ['billingId','billingNo','receivableId','invoiceId','invoiceNo','documentSnapshot'])
      if(!txt(s[k]))stop('來源識別缺失：'+k);
    if(!Number.isSafeInteger(s.draftVersion)||s.draftVersion<=0)stop('議價草稿版本無效');
    for(const k of ['billings','receivables','invoices','bankTransactions','receipts','customerDeductions',
      'commissions','payroll','originalDocument'])if(a[k]!=='UNCHANGED')stop('來源保護檢查未通過：'+k);
    if(a.cloudSync!=='NOT_EXECUTED')stop('正式雲端同步不得參與預覽');
    for(const k of ['originalUntaxed','originalTax','originalGross','allowanceUntaxed','allowanceTax','allowanceGross',
      'approvedUntaxed','approvedTax','approvedGross','effectiveReceivable','effectiveRetention',
      'receivableReduction','retentionReduction'])integer(t[k],k);
    const originalAR=t.effectiveReceivable+t.receivableReduction;
    const originalRetention=t.effectiveRetention+t.retentionReduction;
    if(!Number.isSafeInteger(originalAR)||!Number.isSafeInteger(originalRetention)||
       !t.originalGross||!t.allowanceGross||t.allowanceGross>t.originalGross||
       t.originalUntaxed+t.originalTax!==t.originalGross||
       t.allowanceUntaxed+t.allowanceTax!==t.allowanceGross||
       t.approvedUntaxed+t.approvedTax!==t.approvedGross||
       t.originalUntaxed-t.allowanceUntaxed!==t.approvedUntaxed||
       t.originalTax-t.allowanceTax!==t.approvedTax||
       t.originalGross-t.allowanceGross!==t.approvedGross||
       originalAR+originalRetention!==t.originalGross||
       t.receivableReduction+t.retentionReduction!==t.allowanceGross||
       t.effectiveReceivable+t.effectiveRetention!==t.approvedGross)
       stop('請款折讓與應收、保留款無法勾稽，禁止模擬');
    return {s,t,originalAR,originalRetention};
  }
  function makePlan(report){
    const {s,t,originalAR,originalRetention}=check(report);
    const journal=[
      {side:'借',account:'銷貨折讓（未稅；擬議）',amount:t.allowanceUntaxed},
      {side:'借',account:'銷項稅額調整（擬議）',amount:t.allowanceTax},
      {side:'貸',account:'本期應收減少（擬議）',amount:t.receivableReduction},
      {side:'貸',account:'保留款應收減少（擬議）',amount:t.retentionReduction}
    ];
    const debit=journal.filter(x=>x.side==='借').reduce((sum,x)=>sum+x.amount,0);
    const credit=journal.filter(x=>x.side==='貸').reduce((sum,x)=>sum+x.amount,0);
    if(debit!==credit||debit!==t.allowanceGross)stop('折讓擬議分錄借貸不平衡');
    return {
      schema:SCHEMA,mode:'BETA_REVIEW_ONLY',postingEnabled:false,taxVoucherVerified:false,cloudWrites:0,
      idempotencyKey:'billing-allowance::'+txt(s.billingId)+'::'+txt(s.invoiceNo),
      source:{billingId:txt(s.billingId),billingNo:txt(s.billingNo),receivableId:txt(s.receivableId),
        invoiceId:txt(s.invoiceId),invoiceNo:txt(s.invoiceNo),snapshot:txt(s.documentSnapshot),
        draftVersion:s.draftVersion},
      original:{untaxed:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,
        receivable:originalAR,retention:originalRetention},
      allowance:{untaxed:t.allowanceUntaxed,tax:t.allowanceTax,gross:t.allowanceGross,
        receivable:t.receivableReduction,retention:t.retentionReduction},
      effective:{untaxed:t.approvedUntaxed,tax:t.approvedTax,gross:t.approvedGross,
        receivable:t.effectiveReceivable,retention:t.effectiveRetention},
      journal,totals:{debit,credit},
      originalInvoiceUnchanged:true,receiptsUnchanged:true,bankUnchanged:true,
      customerDeductionsUnchanged:true,commissionsUnchanged:true,payrollUnchanged:true,
      documentStatus:'OFFICIAL_VOUCHER_NOT_VERIFIED',pending:copy(report.pending)
    };
  }
  function simulate(plan,ledger=[],expectedRevision=0){
    if(plan?.schema!==SCHEMA||plan.mode!=='BETA_REVIEW_ONLY'||plan.postingEnabled!==false||
       plan.taxVoucherVerified!==false||plan.cloudWrites!==0||
       plan.documentStatus!=='OFFICIAL_VOUCHER_NOT_VERIFIED'||
       !plan.originalInvoiceUnchanged||!plan.receiptsUnchanged||!plan.bankUnchanged||
       !plan.customerDeductionsUnchanged||!plan.commissionsUnchanged||!plan.payrollUnchanged)
       stop('正式寫入門禁未關閉，禁止操作');
    if(!Array.isArray(ledger)||!Number.isSafeInteger(expectedRevision)||ledger.length!==expectedRevision)
       stop('隔離版本不一致，禁止過期覆蓋');
    if(ledger.length>0||ledger.some(x=>x?.idempotencyKey===plan.idempotencyKey))stop('同張請款已有模擬折讓，禁止重複');
    if(!plan.source?.billingId||!plan.source?.snapshot||!plan.source?.invoiceNo||
       !plan.idempotencyKey||plan.idempotencyKey!=='billing-allowance::'+plan.source.billingId+'::'+plan.source.invoiceNo||
       !plan.original||!plan.allowance||!plan.effective||!Array.isArray(plan.journal)||plan.journal.length!==4)
       stop('擬議折讓資料不完整');
    for(const k of ['untaxed','tax','gross','receivable','retention']){
      integer(plan.original[k],'原始'+k);integer(plan.allowance[k],'折讓'+k);integer(plan.effective[k],'有效'+k);
      if(plan.original[k]-plan.allowance[k]!==plan.effective[k])stop('有效金額不一致：'+k);
    }
    for(const p of [plan.original,plan.allowance,plan.effective])
      if(p.untaxed+p.tax!==p.gross||p.receivable+p.retention!==p.gross)stop('金額無法勾稽');
    const ref=[['借','銷貨折讓（未稅；擬議）',plan.allowance.untaxed],
      ['借','銷項稅額調整（擬議）',plan.allowance.tax],
      ['貸','本期應收減少（擬議）',plan.allowance.receivable],
      ['貸','保留款應收減少（擬議）',plan.allowance.retention]];
    for(let i=0;i<4;i++){
      const row=plan.journal[i],x=ref[i];
      if(row?.side!==x[0]||row?.account!==x[1]||row?.amount!==x[2])stop('分錄內容不一致');
    }
    if(plan.totals?.debit!==plan.allowance.gross||plan.totals?.credit!==plan.allowance.gross)
      stop('模擬借貸不平衡');
    const sourceBefore=JSON.stringify(ledger);
    const next=copy(ledger);
    next.push({schema:'kushe-p37-10-synthetic-ledger-event-v1',idempotencyKey:plan.idempotencyKey,
      source:copy(plan.source),journal:copy(plan.journal),reduction:copy(plan.allowance),status:'SYNTHETIC_NOT_POSTED'});
    if(JSON.stringify(ledger)!==sourceBefore)stop('原始隔離紀錄被修改');
    return {ok:true,ledger:next,revision:next.length,effective:copy(plan.effective),
      postingEnabled:false,cloudWrites:0};
  }
  function mount(parent,billingId){
    if(!parent?.appendChild||!billingId||parent.querySelector('.p3710-panel')||
       !/(?:^|\/)beta(?:\/|$)/.test(txt(window.location?.pathname)))return false;
    const wrapper=document.createElement('details');wrapper.className='p3710-panel';
    wrapper.innerHTML='<summary><strong>P37-10｜折讓帳務分錄核對</strong>（僅預覽）</summary>'+
      '<p>依原請款、原發票、應收與保留款產生擬議分錄，檢查借貸平衡及重複折讓。<strong>不修改原始請款、發票、銀行或薪資。</strong></p>'+
      '<div class="p378-buttons"><button type="button" data-p3710-check>驗算折讓分錄（不入帳）</button></div>'+
      '<p class="p378-status" data-p3710-status role="status">尚未驗算；正式折讓入帳仍關閉。</p>'+
      '<div class="p378-results" data-p3710-output hidden></div>';
    parent.appendChild(wrapper);
    const btn=wrapper.querySelector('[data-p3710-check]'),status=wrapper.querySelector('[data-p3710-status]'),
      out=wrapper.querySelector('[data-p3710-output]');
    btn.addEventListener('click',()=>{
      btn.disabled=true;
      try{
        const gate=window.KusheP376FinalGate?.validate?.(billingId);
        if(!gate?.ok||gate.postingEnabled!==false||gate.officialTaxVerified!==false||!gate.review)
          stop('P37-6 來源唯讀驗證尚未通過');
        const plan=makePlan(gate.review),first=simulate(plan,[],0);
        let blocked=false;
        try{simulate(plan,first.ledger,1)}catch(e){blocked=String(e?.message||'').includes('禁止重複')}
        if(!blocked)stop('同張折讓防重複檢查未通過');
        const item=(label,value)=>'<div><dt>'+esc(label)+'</dt><dd>'+money(value)+'</dd></div>';
        out.innerHTML='<p class="p378-ok">分錄核對通過（尚未入帳）</p>'+
          '<p>原請款 '+esc(plan.source.billingNo)+'；原發票 '+esc(plan.source.invoiceNo)+
          '；議價草稿第 '+plan.source.draftVersion+' 版</p>'+
          '<dl class="p376-values">'+item('原請款含稅',plan.original.gross)+item('核定含稅',plan.effective.gross)+
          item('含稅折讓',plan.allowance.gross)+item('核定本期應收',plan.effective.receivable)+
          item('核定保留款',plan.effective.retention)+'</dl>'+
          '<p><strong>擬議分錄（非正式會計傳票）</strong></p><ul>'+
          plan.journal.map(x=>'<li>'+esc(x.side)+'方｜'+esc(x.account)+'：'+money(x.amount)+'</li>').join('')+
          '</ul><p>借方 '+money(plan.totals.debit)+'、貸方 '+money(plan.totals.credit)+
          '；原請款、正式發票、收款、銀行及薪資抽成不變；模擬重複入帳已阻擋。</p>'+
          '<p><strong>正式入帳仍禁止：</strong>須完成真實折讓憑證核對、ERP 安全交易與跨裝置同步驗收。</p>';
        out.hidden=false;status.textContent='P37-10 隔離金額、借貸平衡與防重複測試通過；正式 ERP 未修改。';
        status.classList.remove('is-error');
      }catch(error){
        out.hidden=false;out.textContent=error?.message||String(error);
        status.textContent='P37-10 未通過，已停止；正式 ERP 沒有修改。';
        status.classList.add('is-error');
      }finally{btn.disabled=false}
    });
    return true;
  }
  window.KusheP3710AllowancePlan=Object.freeze({makePlan,simulate,mount});
})();