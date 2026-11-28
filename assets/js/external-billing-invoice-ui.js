/* P39-INV-1: grouped invoice panel. Document-only UI, per-source invoice
 * management delegated to existing KuSheInvoices writer. Never writes groups.
 */
(function(){
  'use strict';
  const engine=window.KusheExternalBillingInvoice;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const money=n=>Number.isSafeInteger(n)?
    '$'+n.toLocaleString('zh-TW',{maximumFractionDigits:0}):'待核對';
  const months=value=>value?value.slice(0,7).replace('-',' / '):'—';
  function markup(model,enableManage){
    const totals=model.totals;
    return '<section class="bg-invoice-crosscheck" aria-label="原單發票對照">'+
      '<header><div><b>原請款／發票對照</b><p>各原單保留自己的發票號碼、開立日期與稅額；合併請款不會重新開立或新增應收。</p></div>'+
      '<span>已開 '+model.issued+'／待開 '+model.pending+'／免開 '+model.exempt+'</span></header>'+
      '<div class="bg-invoice-scroll"><table><thead><tr>'+
      '<th>原案場／請款單號</th><th>狀態</th><th>開立月份／日期</th>'+
      '<th>發票號碼</th><th class="num">原單未稅</th><th class="num">原單稅額</th>'+
      '<th class="num">原單含稅</th>'+(enableManage?'<th>操作</th>':'')+'</tr></thead><tbody>'+
      model.rows.map(row=>'<tr>'+
        '<td><strong>'+esc(row.projectName||'原案場')+'</strong><small>'+esc(row.billingNo||'未記錄單號')+'</small></td>'+
        '<td>'+esc(row.invoiceLabel)+'</td>'+
        '<td>'+esc(row.invoiceDate||'尚未記錄')+'<small>'+esc(months(row.invoiceMonth))+'</small></td>'+
        '<td>'+esc(row.invoiceStatus==='no_invoice'?'免開發票':row.invoiceNo||'待填寫')+'</td>'+
        '<td class="num">'+money(row.originalUntaxed)+'</td>'+
        '<td class="num">'+money(row.originalTax)+'</td>'+
        '<td class="num"><b>'+money(row.originalGross)+'</b></td>'+
        (enableManage?'<td>'+(row.invoiceStatus==='no_invoice'?
          '<span class="bg-inv-disabled">免開發票</span>':
          '<button type="button" class="commission-secondary" data-bg-manage-invoice="'+esc(row.billingId)+'" aria-label="管理原請款 '+esc(row.billingNo)+' 的銷項發票">管理發票</button>')+'</td>':'')+
        '</tr>').join('')+'</tbody><tfoot><tr><th colspan="4">原單加總（不另記帳）</th>'+
        '<th class="num">'+money(totals.untaxed)+'</th>'+
        '<th class="num">'+money(totals.tax)+'</th>'+
        '<th class="num">'+money(totals.grossTotal)+'</th>'+
        (enableManage?'<th>—</th>':'')+'</tr></tfoot></table></div>'+
      (model.warnings.length?'<p class="bg-inv-warning" role="status">'+
        model.warnings.map(esc).join('；')+
        '。請先核對原單資料，不自行推算票號或發票日期。</p>':'')+
      '<p class="bg-inv-hint">表格金額為各「原請款」已記錄金額，不是重新開立的發票金額。開票月份只取各原單實際發票日期，不使用合併文件日期。</p>'+
      '</section>';
  }
  function billingFinancialForDisplay(id,data=window.KuSheERPStore.getState()){const ui=window.KusheBillingAllowance;if(ui?.forBilling)return ui.forBilling(id,data);const ledger=data?.meta?.billingAllowances;if(ledger===undefined||Array.isArray(ledger)&&!ledger.length)return null;return window.KuSheERPStore.billingFinancialState?.(id,data)||{valid:false,issues:['折讓核對元件未完整載入，請重新整理。'],hasAllowanceHistory:true,status:'待核對'}}
  function financialMarkup(model){
    const store=window.KuSheERPStore;if(!store?.billingFinancialState)return '';
    const data=store.getState(),invoices=store.invoiceRows(),rows=model.rows.map(row=>({row,financial:billingFinancialForDisplay(row.billingId,data),invoices:invoices.filter(i=>i.invoiceType==='output'&&String(i.sourceId)===String(row.billingId))}));
    if(!rows.some(x=>x.financial?.hasAllowanceHistory||x.financial?.valid===false))return '';
    return '<section class="bg-invoice-crosscheck" aria-label="折讓與實際發票對照"><header><div><b>有效帳款與實際發票</b><p>原請款金額保留於上表；待開票採有效金額，已開票保留實際票額，票後折讓另列。</p></div></header><div class="bg-invoice-scroll"><table><thead><tr><th>原請款</th><th>累計有效折讓</th><th>有效未稅</th><th>有效稅額</th><th>有效含稅</th><th>發票金額依據</th></tr></thead><tbody>'+rows.map(({row,financial,invoices:matches})=>{const f=financial||{valid:true,original:{grossTotal:row.originalGross},effective:{untaxed:row.originalUntaxed,tax:row.originalTax,grossTotal:row.originalGross}};const invoice=matches.length===1?matches[0]:null;if(f.valid===false)return '<tr><td>'+esc(row.billingNo)+'</td><td colspan="5" role="alert">'+esc((f.issues||[]).join('；'))+'</td></tr>';return '<tr><td>'+esc(row.billingNo)+'</td><td class="num">'+money(f.original.grossTotal-f.effective.grossTotal)+'</td><td class="num">'+money(f.effective.untaxed)+'</td><td class="num">'+money(f.effective.tax)+'</td><td class="num">'+money(f.effective.grossTotal)+'</td><td>'+(f.valid===false?'資料待核對':row.invoiceStatus==='no_invoice'?'免開發票':invoice?esc(invoice.status==='issued'?'已開票':'待開票')+'<small>未稅 '+money(invoice.netAmount)+'／稅額 '+money(invoice.taxAmount)+'／含稅 '+money(invoice.grossAmount)+'</small>':'發票來源待核對')+'</td></tr>'}).join('')+'</tbody></table></div></section>';
  }
  function mount(host,sources,callbacks={}) {
    if(!host||!engine?.project)throw new Error('原請款／發票對照模組尚未載入');
    function render(nextSources=sources){
      const model=engine.project(nextSources);
      host.innerHTML=markup(model,true)+financialMarkup(model);
      host.querySelectorAll('[data-bg-manage-invoice]').forEach(button=>{
        button.onclick=()=>{
          try{
            const id=button.dataset.bgManageInvoice;
            if(!model.rows.some(row=>row.billingId===id))
              throw new Error('原單不屬於此合併文件，停止操作');
            if(!window.KusheInvoices?.openOriginalBillingInvoice)
              throw new Error('銷項發票編輯模組尚未載入，不得繼續');
            window.KusheInvoices.openOriginalBillingInvoice(id,{
              onSaved:()=>{try{callbacks.onSaved?.(id)}catch(error){
                window.KushePhase1?.toast(error.message||'發票已儲存，請重新核對合併文件')}},
              onClosed:()=>{try{callbacks.onClosed?.()}catch(error){
                window.KushePhase1?.toast(error.message||'請重新開啟合併文件')}}
            });
          }catch(error){callbacks.onError?.(error.message||String(error))}
        };
      });
      return model;
    }
    render(sources);
    return Object.freeze({render});
  }
  window.KusheExternalBillingInvoiceUI=Object.freeze({mount,markup});
})();
