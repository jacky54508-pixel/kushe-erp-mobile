(function p37Module(){
  'use strict';
  // P37-1: strictly read-only preview; no ERP Store mutation, persistence, or tax-document issuance.
  const fmt=value=>'NT$'+Number(value).toLocaleString('zh-TW',{maximumFractionDigits:0});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  function exact(value,label){
    if(value===null||value===undefined||value===''||!Number.isSafeInteger(Number(value))||Number(value)<0)throw new Error(label+'不是可核對的非負整數');
    return Number(value);
  }
  function optionalExact(obj,keys,label){
    if(!obj)return null;
    for(const key of keys)if(Object.prototype.hasOwnProperty.call(obj,key)&&obj[key]!==null&&obj[key]!==undefined&&obj[key]!=='')return exact(obj[key],label);
    return null;
  }
  function inspect(reference){
    try{
      const store=window.KuSheERPStore,state=store?.getState?.();
      if(!state||!Array.isArray(state.billings)||!Array.isArray(state.receivables)||!Array.isArray(state.invoices))throw new Error('ERP 帳務尚未完整載入');
      const id=String(reference?.id||'');
      const bills=state.billings.filter(item=>String(item.id)===id);
      if(!id||bills.length!==1)throw new Error('無法辨識唯一請款單');
      const bill=bills[0];
      const ars=state.receivables.filter(item=>String(item.billingId||'')===id||(bill.receivableId&&String(item.id)===String(bill.receivableId)));
      if(ars.length!==1)throw new Error('找不到唯一對應的應收帳款，暫停試算');
      const ar=ars[0];
      if(bill.receivableId&&String(ar.id)!==String(bill.receivableId))throw new Error('請款與應收關聯不一致');
      if(ar.billingId&&String(ar.billingId)!==id)throw new Error('應收關聯到其他請款單');
      const doc=store.billingDocumentState?.(id);
      if(!doc||!doc.amounts||doc.issues?.length)throw new Error('請款原始帳務待核對：'+(doc?.issues||[]).join('；'));
      const originalNet=exact(doc.amounts.untaxed,'原始未稅金額');
      const originalTax=exact(doc.amounts.tax,'原始稅額');
      const originalGross=exact(doc.amounts.grossTotal,'原始含稅金額');
      const originalRetention=exact(doc.amounts.retention,'原始保留款');
      const originalReceivable=exact(doc.amounts.receivable,'原始本期應收');
      if(!originalGross||originalNet+originalTax!==originalGross||originalGross-originalRetention!==originalReceivable)throw new Error('原始請款金額與保留款無法勾稽');
      for(const [value,label] of [
        [optionalExact(bill,['grossTotal'],'請款含稅金額'),'請款含稅金額'],
        [optionalExact(ar,['grossTotal'],'應收含稅金額'),'應收含稅金額']
      ])if(value!==null&&value!==originalGross)throw new Error(label+'與原始請款不一致');
      if(exact(ar.amount,'應收金額')!==originalReceivable)throw new Error('應收帳款與原始請款不一致');
      if(originalTax>0&&Math.round(originalNet*0.05)!==originalTax)throw new Error('此張稅額不是標準 5%，P37-1 暫不自動試算');
      if(originalTax===0&&originalNet!==originalGross)throw new Error('原始免稅金額不一致');
      const retentionMode=String(bill.retentionMode||'none'),retentionBase=String(bill.retentionBase||'');
      let retentionRate=retentionMode==='none'?0:retentionMode==='5'?5:retentionMode==='10'?10:retentionMode==='custom'?Number(bill.retentionRate):NaN;
      if(!Number.isFinite(retentionRate)||retentionRate<0||retentionRate>100||(originalRetention>0&&retentionRate===0))throw new Error('保留款為特殊設定，請先人工核對；P37-1 不推測折讓後保留款');
      if(retentionRate>0&&retentionBase!=='preTax'&&retentionBase!=='taxIncluded')throw new Error('保留款計算基準不明，暫停試算');
      const retentionBasis=retentionBase==='preTax'?originalNet:originalGross;
      if(Math.round(retentionBasis*retentionRate/100)!==originalRetention)throw new Error('現有保留款與設定比例不一致，暫停試算');
      const invoiceRows=state.invoices.filter(item=>(String(item.billingId||'')===id)||(String(item.sourceType||'')==='billing'&&String(item.sourceId||'')===id));
      const issuedRows=invoiceRows.filter(item=>['issued','invoiced','已開票','已開發票'].includes(String(item.status||''))||String(item.invoiceNumber||item.number||'').trim()&&String(item.status||'')!=='void');
      const invoiceStatus=String(bill.invoiceStatus||'');
      if(invoiceStatus==='invoiced'||String(bill.invoiceNo||'').trim()){
        if(issuedRows.length!==1)throw new Error('正式銷項發票紀錄不唯一或不存在，請先核對');
        const invoice=issuedRows[0];
        const number=String(invoice.invoiceNumber||invoice.number||'').trim();
        if(!number||number!==String(bill.invoiceNo||'').trim())throw new Error('請款與正式發票號碼不一致');
        for(const [keys,expected,label] of [[['netAmount','amount'],originalNet,'發票未稅'],[['taxAmount','tax'],originalTax,'發票稅額'],[['grossAmount','total'],originalGross,'發票含稅']]){
          const found=optionalExact(invoice,keys,label);
          if(found!==null&&found!==expected)throw new Error(label+'與原始請款金額不一致');
        }
      }
      const received=exact(ar.received??0,'已收款');
      const retentionReceived=exact(ar.retentionReceived??0,'已收保留款');
      const warnings=[];
      if(received>0||retentionReceived>0)warnings.push('已存在收款或保留款收回；本畫面僅試算核定金額，不計算可直接入帳的餘額');
      if(Array.isArray(ar.receivableCheques)&&ar.receivableCheques.length)warnings.push('已有支票資料，後續正式折讓須另行核對票據');
      if(invoiceStatus==='invoiced')warnings.push('本單已開立正式發票，折讓須先核對合法折讓憑證及發票申報狀態');
      return {ok:true,baseline:Object.freeze({
        id,number:String(bill.number||''),project:String(bill.projectName||''),customer:String(bill.customerName||''),
        invoiceNo:String(bill.invoiceNo||''),invoiceStatus,originalNet,originalTax,originalGross,
        originalRetention,originalReceivable,retentionRate,retentionBase,received,retentionReceived
      }),warnings};
    }catch(error){return {ok:false,error:error?.message||String(error)}}
  }
  function calculate(baseline,input){
    try{
      if(!baseline||!Number.isSafeInteger(baseline.originalGross))throw new Error('請先核對原始請款資料');
      const raw=String(input??'').trim();
      if(!/^\d+$/.test(raw))throw new Error('請輸入不含逗號的含稅核定金額（整數）');
      const approvedGross=exact(raw,'含稅核定金額');
      if(approvedGross===0||approvedGross>baseline.originalGross)throw new Error('核定金額必須大於 0，且不可高於原含稅請款總額');
      const approvedNet=baseline.originalTax===0?approvedGross:Math.round(approvedGross/1.05);
      const approvedTax=approvedGross-approvedNet;
      if(baseline.originalTax>0&&Math.round(approvedNet*0.05)!==approvedTax)throw new Error('核定金額無法以 5% 稅額正確勾稽，請人工確認');
      const retentionBasis=baseline.retentionBase==='preTax'?approvedNet:approvedGross;
      const approvedRetention=Math.round(retentionBasis*baseline.retentionRate/100);
      const approvedReceivable=approvedGross-approvedRetention;
      const discountGross=baseline.originalGross-approvedGross;
      const discountNet=baseline.originalNet-approvedNet;
      const discountTax=baseline.originalTax-approvedTax;
      const discountRetention=baseline.originalRetention-approvedRetention;
      const discountReceivable=baseline.originalReceivable-approvedReceivable;
      if([discountNet,discountTax,discountRetention,discountReceivable].some(n=>n<0)||discountNet+discountTax!==discountGross||discountRetention+discountReceivable!==discountGross)throw new Error('試算結果未能勾稽，已停止顯示');
      return {ok:true,original:{net:baseline.originalNet,tax:baseline.originalTax,gross:baseline.originalGross,retention:baseline.originalRetention,receivable:baseline.originalReceivable},approved:{net:approvedNet,tax:approvedTax,gross:approvedGross,retention:approvedRetention,receivable:approvedReceivable},discount:{net:discountNet,tax:discountTax,gross:discountGross,retention:discountRetention,receivable:discountReceivable}};
    }catch(error){return {ok:false,error:error?.message||String(error)}}
  }
  function open(reference){
    const check=inspect(reference);
    const previousFocus=document.activeElement;
    const overlay=document.createElement('div');
    overlay.className='p37-neg-overlay';
    const message=check.ok?'請輸入建商核定的含稅金額，試算議價差額；不會儲存任何資料。':check.error;
    overlay.innerHTML=`<section class="p37-neg-dialog" role="dialog" aria-modal="true" aria-labelledby="p37NegTitle" tabindex="-1">
      <header class="p37-neg-head"><div><span class="p37-neg-eyebrow">P37-1 · BETA · 唯讀試算</span><h2 id="p37NegTitle">請款議價／折讓試算</h2><p>${check.ok?esc(check.baseline.customer+'｜'+check.baseline.project+'｜'+check.baseline.number):'來源帳務待核對'}</p></div><button type="button" class="p37-neg-close" data-p37-close aria-label="關閉議價試算">×</button></header>
      <div class="p37-neg-body"><p class="p37-neg-warning"><strong>僅供預覽，尚未儲存。</strong> 不會修改原請款單、發票、應收、保留款、施工、薪資抽成或銀行流水，也不會建立正式折讓憑證。</p>
      <p class="p37-neg-source" role="status">${esc(message)}</p>
      ${check.ok?`<div class="p37-neg-meta"><span>發票號碼 <b>${esc(check.baseline.invoiceNo||'尚未開立')}</b></span><span>發票狀態 <b>${check.baseline.invoiceStatus==='invoiced'?'已開立':'尚未開立／待核對'}</b></span><span>保留款 <b>${check.baseline.retentionRate}%（${check.baseline.retentionBase==='preTax'?'未稅':'含稅'}基準）</b></span></div>
      ${check.warnings.map(w=>`<p class="p37-neg-advisory">${esc(w)}</p>`).join('')}
      <div class="p37-neg-fields"><label><span>建商核定含稅總額（NT$）</span><input data-p37-gross inputmode="numeric" autocomplete="off" maxlength="13" placeholder="輸入含稅核定金額" aria-describedby="p37NegFeedback"></label><label><span>議價日期（僅預覽）</span><input type="date" data-p37-date></label></div>
      <label class="p37-neg-reason"><span>議價原因／備註（關閉後不保留）</span><textarea data-p37-reason rows="2" maxlength="500" placeholder="例如：建商議價核定"></textarea></label>
      <p class="p37-neg-feedback" id="p37NegFeedback" aria-live="polite">尚未輸入核定金額。</p>
      <div class="p37-neg-tablewrap" data-p37-table-wrap hidden><table class="p37-neg-table"><thead><tr><th>帳務項目</th><th>原始</th><th>核定後（試算）</th><th>減少</th></tr></thead><tbody>
      ${[['net','未稅工程款'],['tax','營業稅'],['gross','含稅總額'],['retention','保留款'],['receivable','本期應收']].map(([key,label])=>`<tr data-p37-row="${key}"><th>${label}</th><td data-p37-original></td><td data-p37-approved></td><td data-p37-discount></td></tr>`).join('')}
      </tbody></table></div>
      <p class="p37-neg-disclaimer" data-p37-summary hidden></p>`:''}
      </div><footer class="p37-neg-footer"><span>沒有儲存／送出／入帳功能</span><button type="button" class="commission-secondary" data-p37-close>關閉（不儲存）</button></footer>
      </section>`;
    document.body.appendChild(overlay);
    const dialog=overlay.querySelector('.p37-neg-dialog');
    let closed=false;
    function close(){
      if(closed)return;closed=true;
      window.removeEventListener('kushe:data-updated',stale);
      overlay.remove();
      if(previousFocus?.isConnected)previousFocus.focus();
    }
    function stale(){
      const gross=overlay.querySelector('[data-p37-gross]');
      if(gross)gross.disabled=true;
      const feedback=overlay.querySelector('.p37-neg-feedback');
      if(feedback)feedback.textContent='ERP 資料已更新；請關閉後重新開啟試算。';
      const table=overlay.querySelector('[data-p37-table-wrap]');
      if(table)table.hidden=true;
    }
    overlay.querySelectorAll('[data-p37-close]').forEach(b=>b.addEventListener('click',close));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}});
    window.addEventListener('kushe:data-updated',stale);
    if(check.ok){
      const input=overlay.querySelector('[data-p37-gross]'),feedback=overlay.querySelector('.p37-neg-feedback'),table=overlay.querySelector('[data-p37-table-wrap]'),summary=overlay.querySelector('[data-p37-summary]');
      function update(){
        const value=input.value;
        if(!value.trim()){table.hidden=true;summary.hidden=true;feedback.textContent='尚未輸入核定金額。';return}
        const outcome=calculate(check.baseline,value);
        if(!outcome.ok){table.hidden=true;summary.hidden=true;feedback.textContent=outcome.error;return}
        table.hidden=false;summary.hidden=false;
        feedback.textContent=outcome.discount.gross===0?'核定金額與原始金額相同，沒有折讓。':'試算完成。折讓尚未入帳，也未產生折讓證明單。';
        for(const [key] of [['net'],['tax'],['gross'],['retention'],['receivable']]){
          const tr=overlay.querySelector(`[data-p37-row="${key}"]`);
          tr.querySelector('[data-p37-original]').textContent=fmt(outcome.original[key]);
          tr.querySelector('[data-p37-approved]').textContent=fmt(outcome.approved[key]);
          tr.querySelector('[data-p37-discount]').textContent=fmt(outcome.discount[key]);
        }
        summary.textContent='含稅折讓 '+fmt(outcome.discount.gross)+'；本期應收減少 '+fmt(outcome.discount.receivable)+'；保留款減少 '+fmt(outcome.discount.retention)+'。以上僅為未入帳試算。';
      }
      input.addEventListener('input',update);
      input.focus();
    }else dialog.focus();
    return {ok:check.ok,close};
  }
  window.KusheBillingNegotiationPreview=Object.freeze({inspect,calculate,open});
})();
