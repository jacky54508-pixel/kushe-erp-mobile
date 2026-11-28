(function () {
  'use strict';
  const store = window.KuSheERPStore;
  const fields = ['untaxed', 'tax', 'grossTotal', 'retention', 'receivable'];
  const labels = {untaxed:'未稅', tax:'稅額', grossTotal:'含稅／總額', retention:'保留款', receivable:'本期應收'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number.isFinite(Number(value)) ? '$' + Number(value).toLocaleString('zh-TW') : '待核對';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const issueText = value => typeof value === 'string' ? value : value?.message || value?.label || value?.code || '資料待核對';
  const today = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date()).map(x => [x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const token = () => 'allowance-' + (window.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2));
  let activeClose = null;
  async function prepareCloud() {
    if (!window.KusheCloudSync?.prepareBillingAllowanceWrite) throw new Error('雲端折讓保護尚未載入，請重新整理後核對；目前僅能預覽。');
    return window.KusheCloudSync.prepareBillingAllowanceWrite();
  }

  // These are presentation helpers only. The Store owns every amount and cap.
  function billing(id, data) { return store.billingFinancialState?.(String(id), data); }
  function receivable(id, data) { return store.receivableFinancialState?.(String(id), data); }
  const presentationHistoryCache = new WeakMap();
  function invalidFinancial(message) {
    return {valid:false,issues:[message],original:null,adjustment:null,effective:null,settlement:null,status:'待核對',hasAllowance:false,hasAllowanceHistory:true,history:[],snapshot:''};
  }
  function presentationHistory(data) {
    if(Object.isFrozen(data)&&presentationHistoryCache.has(data))return presentationHistoryCache.get(data);
    const index={billings:new Set(),receivables:new Set(),error:''},ledger=data?.meta?.billingAllowances;
    try{
      if(ledger!==undefined){
        if(!Array.isArray(ledger))throw new Error('折讓紀錄格式待核對，請先核對資料來源。');
        if(ledger.length){
          if(typeof store.allowanceAccountingRows!=='function')throw new Error('折讓紀錄核對元件未載入，請重新整理。');
          // This Store query validates the complete ledger, including original
          // source identities, reversals and zero-amount group allocations.
          const rows=store.allowanceAccountingRows(data);
          if(!Array.isArray(rows)||!rows.length)throw new Error('折讓紀錄來源缺漏，請先核對。');
          for(const row of rows){
            if(!row?.billingId||!row?.receivableId)throw new Error('折讓紀錄缺少原請款／應收識別。');
            index.billings.add(String(row.billingId));index.receivables.add(String(row.receivableId));
          }
        }
      }
    }catch(error){index.error=error.message||String(error)}
    if(Object.isFrozen(data))presentationHistoryCache.set(data,index);
    return index;
  }
  function forBilling(id,data=store.getState()) {
    const index=presentationHistory(data);
    if(index.error)return invalidFinancial(index.error);
    if(!index.billings.has(String(id)))return null;
    return billing(id,data)||invalidFinancial('有效請款核對元件未載入，請重新整理。');
  }
  function forReceivable(id,data=store.getState()) {
    const index=presentationHistory(data);
    if(index.error)return invalidFinancial(index.error);
    if(!index.receivables.has(String(id)))return null;
    return receivable(id,data)||invalidFinancial('有效應收核對元件未載入，請重新整理。');
  }
  function receiptState(row, data = store.getState()) {
    const f = forBilling(row.id, data);
    if (!f) return store.billingReceiptState(row);
    const ar = data.receivables.find(a => String(a.id) === String(f.receivableId || row.receivableId)) || data.receivables.find(a => String(a.billingId) === String(row.id));
    if(f.valid===false)return {receivable:ar,received:NaN,unreceived:NaN,status:'待核對',financial:f};
    const s=f.settlement;
    return {receivable:ar, received:s.received, unreceived:s.outstanding,
      status:f.valid === false ? '待核對' : s.outstanding > 0 ? (s.received > 0 ? '部分收款' : '未收') : '已收', financial:f};
  }
  function summary(f, title = '折讓與目前餘額') {
    if (!f) return '';
    if(f.valid===false)return '<section class="billing-allowance-summary"><h3>帳款來源待核對</h3><p role="alert">'+(f.issues||[]).map(issueText).map(esc).join('；')+'</p></section>';
    if (!f.hasAllowance && !f.hasAllowanceHistory) return '';
    const a = f.original, e = f.effective, s = f.settlement;
    return '<section class="billing-allowance-summary"><h3>' + esc(title) + '</h3><dl>' +
      [['原請款總額',a.grossTotal],['累計有效折讓',a.grossTotal-e.grossTotal],['調整後總額',e.grossTotal],['本期未沖銷',s.outstanding],['保留款待收',s.retentionOutstanding],['待兌現預留',s.pendingChequeReserved]].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+money(v)+'</dd></div>').join('') + '</dl>' +
      (f.valid === false ? '<p role="alert">' + (f.issues || []).map(issueText).map(esc).join('；') + '</p>' : '') + '</section>';
  }
  function style() {
    if ($('#billingAllowanceStyle')) return;
    const node = document.createElement('style'); node.id = 'billingAllowanceStyle';
    node.textContent = `.billing-allowance-overlay{position:fixed;inset:0;z-index:99999;background:#122c43a8;display:flex;align-items:center;justify-content:center;padding:18px}.billing-allowance-modal{background:#fff;color:#17334b;border-radius:18px;max-height:94vh;overflow:auto;width:min(1040px,100%);box-shadow:0 20px 80px #091a3255}.billing-allowance-modal>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 26px;border-bottom:1px solid #dce6ec}.billing-allowance-modal h2,.billing-allowance-modal h3,.billing-allowance-modal p{margin:0 0 10px}.billing-allowance-modal>header button{border:0;background:#edf3f6;border-radius:8px;font-size:24px;min-width:42px;min-height:42px}.billing-allowance-body{padding:22px 26px}.billing-allowance-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:16px 0}.billing-allowance-modal label{display:grid;gap:6px;font-size:14px}.billing-allowance-modal input,.billing-allowance-modal select,.billing-allowance-modal textarea{box-sizing:border-box;width:100%;min-height:42px;border:1px solid #bacbd7;border-radius:8px;padding:9px;font:inherit;color:inherit;background:#fff}.billing-allowance-modal .allowance-wide{grid-column:1/-1}.billing-allowance-modal input[type=checkbox]{width:18px;min-height:18px}.billing-allowance-modal .allowance-check{display:flex;align-items:flex-start;gap:9px;line-height:1.6}.billing-allowance-source{margin:18px 0;padding:16px;border:1px solid #cfdde6;border-radius:12px;min-width:0}.billing-allowance-source legend{font-weight:700;padding:0 6px;max-width:100%;overflow-wrap:anywhere}.billing-allowance-source small{display:block;color:#557084;line-height:1.7}.allowance-reductions{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px}.allowance-source-totals,.billing-allowance-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:10px 0}.billing-allowance-summary{margin:14px 0;padding:14px;background:#eef7fa;border-radius:10px}.billing-allowance-summary dt{color:#557084;font-size:12px}.billing-allowance-summary dd{margin:5px 0 0;font-weight:700}.allowance-source-totals span{font-size:12px;color:#557084}.allowance-source-totals b{display:block;font-size:16px;color:#17334b;margin-top:3px}.billing-allowance-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.billing-allowance-modal button{cursor:pointer}.billing-allowance-modal button:disabled{cursor:not-allowed;opacity:.5}.billing-allowance-review{margin:16px 0;padding:16px;background:#f3f7fa;border-radius:12px}.billing-allowance-review.is-blocked,.allowance-error{background:#fff2ee;color:#8a3524;padding:14px;border-radius:10px}.billing-allowance-review ul{padding-left:22px}.allowance-review-scroll{overflow:auto}.billing-allowance-modal table{border-collapse:collapse;width:100%;min-width:580px;font-size:13px}.billing-allowance-modal th,.billing-allowance-modal td{text-align:right;padding:9px;border-bottom:1px solid #d8e2e8;white-space:nowrap}.billing-allowance-modal th:first-child,.billing-allowance-modal td:first-child{text-align:left}.billing-allowance-history{margin-top:26px;border-top:1px solid #d8e2e8;padding-top:18px}.allowance-history-row{padding:14px 0;border-bottom:1px solid #e0e8ed;overflow-wrap:anywhere}.allowance-history-row header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.allowance-history-row p{font-size:13px;color:#557084;margin-top:7px}.allowance-note{font-size:13px;color:#557084;line-height:1.7}.billing-allowance-modal [hidden]{display:none!important}.allowance-success{padding:14px;background:#edf8f0;color:#25663d;border-radius:10px;margin-bottom:16px}@media(max-width:640px){.billing-allowance-overlay{padding:6px}.billing-allowance-modal{max-height:98vh;border-radius:12px}.billing-allowance-modal>header,.billing-allowance-body{padding:16px}.billing-allowance-fields{grid-template-columns:1fr}.allowance-reductions{grid-template-columns:repeat(2,minmax(0,1fr))}.allowance-source-totals,.billing-allowance-summary dl{grid-template-columns:repeat(2,minmax(0,1fr))}.billing-allowance-actions>button{flex:1;min-height:44px}}`;
    document.head.append(node);
  }
  function context(options) {
    if (!store.billingAllowancePreview || !store.postBillingAllowance) throw new Error('折讓入帳元件尚未載入，請重新整理後再試。');
    const data = store.getState();
    let ids, documentRow;
    if (options.externalDocumentId) {
      const docs = (data.meta?.externalBillingDocuments || []).filter(d => String(d.id) === String(options.externalDocumentId) && d.status === 'active');
      if (docs.length !== 1) throw new Error('找不到唯一有效的合併請款，請由合併請款清單重新開啟。');
      documentRow = docs[0]; ids = documentRow.sourceIds;
    } else ids = [String(options.billingId || '')];
    if (!Array.isArray(ids) || !ids.length || new Set(ids.map(String)).size !== ids.length) throw new Error('請款來源重複或缺漏，請先核對來源。');
    const sources = ids.map(id => {
      const matches = data.billings.filter(b => String(b.id) === String(id));
      if (matches.length !== 1) throw new Error('找不到唯一原請款單：' + id);
      const bill = matches[0], financial = billing(id, data);
      if (!financial) throw new Error('有效帳款來源尚未載入，請重新整理。');
      const invoices = data.invoices.filter(i => String(i.billingId || '') === String(id) || i.sourceType === 'billing' && String(i.sourceId) === String(id));
      return {bill, financial, invoice:invoices.length === 1 ? invoices[0] : null};
    });
    const history = [...new Map(sources.flatMap(s => s.financial.history || []).map(h => [h.id,h])).values()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    return {data, sources, history, documentRow};
  }
  function sourceMarkup(source) {
    const {bill,financial:f} = source;
    if(f.valid===false)return '<fieldset class="billing-allowance-source" data-allowance-source="'+esc(bill.id)+'"><legend>'+esc(bill.number||bill.id)+'</legend><p class="allowance-error" role="alert">'+(f.issues||[]).map(issueText).map(esc).join('；')+'</p><p>金額待核對，暫停此來源折讓入帳。請先核對原請款、應收與既有收款的關聯。</p></fieldset>';
    const e = f.effective, s = f.settlement;
    return '<fieldset class="billing-allowance-source" data-allowance-source="'+esc(bill.id)+'"><legend>'+esc(bill.number||bill.id)+' · '+esc(bill.projectName||'原案場')+'</legend>'+
      '<small>原請款總額 '+money(f.original.grossTotal)+'；目前有效未稅 '+money(e.untaxed)+'，稅額 '+money(e.tax)+'，保留款 '+money(e.retention)+'</small>'+
      '<div class="allowance-source-totals">'+[['目前有效總額',e.grossTotal],['本期有效應收',e.receivable],['本期已沖銷',s.received],['保留款已收',s.retentionReceived],['待兌現預留',s.pendingChequeReserved],['目前可新增收款',s.available]].map(([k,v])=>'<span>'+esc(k)+'<b>'+money(v)+'</b></span>').join('')+'</div>'+
      '<div class="allowance-reductions">'+fields.map(k=>'<label><span>本次折讓'+esc(labels[k])+'</span><input type="number" min="0" step="1" max="'+esc(e[k])+'" value="0" required data-reduction="'+k+'" aria-label="'+esc((bill.number||bill.id)+' 本次折讓'+labels[k])+'"></label>').join('')+'</div>'+
      '<small>未稅減額＋稅額減額＝總額減額；總額減額－保留款減額＝本期應收減額。各來源依核定明細手動填寫。</small>'+
      (f.valid === false ? '<p class="allowance-error" role="alert">'+(f.issues||[]).map(issueText).map(esc).join('；')+'</p>' : '')+'</fieldset>';
  }
  function evidenceMarkup(sources) {
    return sources.filter(s => s.invoice && (s.invoice.status === 'issued' || s.bill.invoiceStatus === 'invoiced' || s.invoice.invoiceNumber || s.invoice.number)).map(({bill,invoice})=>
      '<fieldset class="billing-allowance-source" data-allowance-evidence="'+esc(invoice.id)+'" data-evidence-billing="'+esc(bill.id)+'"><legend>已開票依據 · '+esc(bill.number||bill.id)+'</legend><p class="allowance-note">原發票 '+esc(invoice.invoiceNumber||invoice.number||'票號待核對')+'。此來源有折讓時，請填已核對的憑證資料。</p><div class="billing-allowance-fields"><label><span>折讓／更正憑證編號</span><input data-voucher-reference maxlength="200"></label><label><span>憑證日期</span><input type="date" data-voucher-date></label></div><label class="allowance-check"><input type="checkbox" data-voucher-verified><span>已核對本次折讓／撤銷所需的票據處理與憑證。</span></label></fieldset>').join('');
  }
  function historyMarkup(history) {
    return '<h3>折讓與撤銷歷程</h3>'+(history.length?history.map(h=>'<article class="allowance-history-row"><header><strong>'+esc(h.date||'')+' · '+esc(h.eventType==='reverse'?'折讓撤銷':h.status==='reversed'?'折讓（已撤銷）':'已入帳折讓')+' · '+money(h.approvedGrossReduction)+'</strong>'+(h.canReverse?'<button type="button" class="commission-secondary" data-allowance-reverse="'+esc(h.id)+'">預覽撤銷</button>':'')+'</header><p>'+esc(h.reason||'')+' · 核定依據 '+esc(h.reference||'—')+'</p><small>紀錄 '+esc(h.id)+(h.reverseOf?' · 對應原折讓 '+esc(h.reverseOf):'')+'</small></article>').join(''):'<p class="allowance-note">目前沒有正式入帳折讓。</p>');
  }
  function commissionImpactMarkup(impact) {
    if(!impact)return '';
    const legacy=impact.legacy||[],drafts=impact.prospectiveDrafts||[],finalized=impact.finalized||[],ambiguous=impact.ambiguous||[];
    if(!legacy.length&&!drafts.length&&!finalized.length&&!ambiguous.length)return '';
    return '<section class="billing-allowance-summary"><h3>本次折讓與員工抽成</h3>'+
      (legacy.length?'<p>原已議定抽成金額保留；付款依逐筆確認的薪資約定。</p><ul>'+legacy.map(row=>'<li>'+esc(row.employeeName||'原抽成')+' · 原抽成 '+money(row.amount)+'，本次不減少'+(row.hasTerms?'；沿用已保存付款約定':'；請在上方確認實際付款約定')+'。</li>').join('')+'</ul>':'')+
      (drafts.length?'<p>本次含 '+drafts.length+' 份尚未核定的新約定；目前為暫估，正式抽成將依人工核定的折讓後未稅基數計算。</p>':'')+
      finalized.map(row=>'<p><b>新約定已核定抽成 '+money(row.frozenCommission)+' 保持不變。</b> '+(row.currentEstimatedCommission!==null&&row.currentEstimatedCommission!==undefined?'依本次有效基數試算 '+money(row.currentEstimatedCommission)+'；待另行核對差額 '+money(row.difference)+'。':'本次差額需人工核對，未自動拆分或減少原抽成。')+(row.message?' '+esc(row.message):'')+'</p>').join('')+
      (ambiguous.length?'<p role="alert">抽成來源尚待核對，請先處理來源關聯後再入帳。</p>':'')+'</section>';
  }
  function readLegacyTerms(form) {
    return $$('[data-legacy-payment-terms]',form).map(row=>({commissionId:row.dataset.legacyPaymentTerms,mode:$('[data-legacy-terms-mode]',row).value,agreedDueDate:$('[data-legacy-terms-date]',row).value,reference:$('[data-legacy-terms-reference]',row).value.trim(),confirmed:$('[data-legacy-terms-confirmed]',row).checked}));
  }
  function renderLegacyTerms(form,impact,reverseOf) {
    const host=$('[data-allowance-commission-terms]',form);if(!host)return;
    const previous=new Map(readLegacyTerms(form).map(row=>[String(row.commissionId),row])),rows=(impact?.legacy||[]).filter(row=>row.requiredTerms||!row.hasTerms);
    host.hidden=Boolean(reverseOf)||!rows.length;
    if(reverseOf){host.replaceChildren();return;}
    host.innerHTML=rows.length?'<h3>保留原抽成並確認實際付款約定</h3><p class="allowance-note">逐筆核對員工原有約定。不能因折讓自行減少抽成，也不會替所有員工新增工程款收清門檻。此付款約定一經確認，撤銷折讓後仍保留。</p>'+rows.map(row=>{
      const old=previous.get(String(row.commissionId))||{};
      return '<fieldset class="billing-allowance-source" data-legacy-payment-terms="'+esc(row.commissionId)+'"><legend>'+esc(row.employeeName||'原抽成員工')+' · 原抽成 '+money(row.amount)+'</legend><div class="billing-allowance-fields"><label><span>這筆實際付款約定</span><select data-legacy-terms-mode required><option value="">請依原約定選擇</option value="agreed-date" '+(old.mode==='agreed-date'?'selected':'')+'>依雙方約定日期給付</option><option value="effective-collection" '+(old.mode==='effective-collection'?'selected':'')+'>原已約定工程款結清後給付（依折讓後有效應收）</option></select></label><label data-legacy-due-field '+(old.mode==='agreed-date'?'':'hidden')+'><span>雙方約定付款日</span><input type="date" data-legacy-terms-date value="'+esc(old.agreedDueDate||'')+'" '+(old.mode==='agreed-date'?'required':'')+'></label><label class="allowance-wide"><span>原付款約定核對依據</span><input data-legacy-terms-reference maxlength="500" value="'+esc(old.reference||'')+'" required></label></div><label class="allowance-check"><input type="checkbox" data-legacy-terms-confirmed '+(old.confirmed?'checked':'')+'><span>確認原抽成 '+money(row.amount)+' 全額保留；上方所填為這位員工實際已約定的付款條件。</span></label></fieldset>';
    }).join(''):'';
    $$('[data-legacy-payment-terms]',host).forEach(row=>$('[data-legacy-terms-mode]',row).addEventListener('change',()=>{const dated=$('[data-legacy-terms-mode]',row).value==='agreed-date';$('[data-legacy-due-field]',row).hidden=!dated;$('[data-legacy-terms-date]',row).required=dated;$('[data-legacy-terms-confirmed]',row).checked=false;}));
  }
  function reviewMarkup(preview) {
    const blockers = preview.blockers || [];
    const rows = (preview.sourceRows || []).map(row=>'<h4>'+esc(row.billingNo||row.billingId)+'</h4><div class="allowance-review-scroll"><table><thead><tr><th>金額</th>'+fields.map(k=>'<th>'+esc(labels[k])+'</th>').join('')+'</tr></thead><tbody>'+[['入帳前',row.before],['本次'+(preview.reverseOf?'恢復':'減額'),row.reductions],['入帳後',row.after]].map(([label,a])=>'<tr><td>'+label+'</td>'+fields.map(k=>'<td>'+money(a?.[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>').join('');
    const totals = preview.totals;
    return '<h3>'+(preview.allowed?'核對結果：可確認入帳':'尚不能入帳，請處理下列項目')+'</h3>'+
      (blockers.length?'<ul>'+blockers.map(b=>'<li>'+esc(issueText(b))+(b.billingId?'（'+esc(b.billingId)+'）':'')+'</li>').join('')+'</ul>':'')+
      (totals?'<p>整筆'+(preview.reverseOf?'撤銷恢復':'折讓減額')+' '+money(totals.reductions?.grossTotal)+'；入帳後總額 '+money(totals.after?.grossTotal)+'、本期應收 '+money(totals.after?.receivable)+'、保留款 '+money(totals.after?.retention)+'</p>':'')+(rows?'<p class="allowance-note">窄螢幕可左右滑動下方表格，核對總額、保留款與本期應收的完整金額。</p>':'')+rows+commissionImpactMarkup(preview.commissionImpact);
  }
  function open(options = {}) {
    style();
    const ctx = context(options), previous = document.activeElement;
    if (activeClose && activeClose() === false) return;
    const shade = document.createElement('div'); shade.className = 'billing-allowance-overlay';
    const title = ctx.documentRow ? '整組議價／折讓入帳' : '議價／折讓入帳';
    shade.innerHTML = '<section class="billing-allowance-modal" role="dialog" aria-modal="true" aria-labelledby="billingAllowanceTitle"><header><div><h2 id="billingAllowanceTitle">'+title+'</h2><p>'+esc(ctx.documentRow?.displayProjectName||ctx.sources[0].bill.projectName||'請款核對')+' · '+ctx.sources.length+' 張原請款</p></div><button type="button" data-allowance-close aria-label="關閉折讓視窗">×</button></header><div class="billing-allowance-body">'+
      (options.success?'<p class="allowance-success" role="status">'+esc(options.success)+'</p>':'')+
      '<p class="allowance-note">依核定明細逐來源登錄本次減額。請款、發票原件及原薪資抽成保留；入帳後以獨立折讓紀錄計算有效餘額。</p>'+
      '<form id="billingAllowanceForm"><p data-allowance-reverse-notice class="allowance-note" hidden></p><div class="billing-allowance-fields"><label><span>本次核定日期</span><input name="date" type="date" value="'+today()+'" required></label><label><span>核定依據／文件編號</span><input name="reference" maxlength="200" required placeholder="核定書、議價紀錄或往來文件編號"></label><label class="allowance-wide"><span>本次原因</span><textarea name="reason" rows="2" maxlength="1000" required></textarea></label><label data-allowance-total-field><span>整筆核定折讓總額（含稅／扣保留款前）</span><input name="approvedGrossReduction" type="number" min="1" step="1" required placeholder="填本次減少的總金額"></label></div><section data-allowance-allocations>'+ctx.sources.map(sourceMarkup).join('')+'</section><section data-allowance-evidence-list>'+evidenceMarkup(ctx.sources)+'</section><section data-allowance-commission-terms hidden></section><div class="billing-allowance-actions"><button type="submit" class="commission-secondary" data-allowance-preview>核對本次入帳</button><button type="button" class="commission-secondary" data-allowance-cancel-reverse hidden>返回新增折讓</button></div><section class="billing-allowance-review" data-allowance-review aria-live="polite" hidden></section><label class="allowance-check"><input name="confirmed" type="checkbox" disabled><span>我已核對逐來源分配、稅額、保留款、既有收款與員工抽成；原已議定金額保持不變，付款依已核對約定，確認依上述結果入帳。</span></label><div class="billing-allowance-actions"><button type="button" class="commission-primary" data-allowance-post disabled>確認折讓入帳</button><button type="button" class="commission-secondary" data-allowance-close>關閉</button></div><p class="allowance-note" data-allowance-message role="status"></p></form><section class="billing-allowance-history" data-allowance-history>'+historyMarkup(ctx.history)+'</section></div></section>';
    document.body.append(shade);
    const form = $('#billingAllowanceForm',shade), review = $('[data-allowance-review]',shade), post = $('[data-allowance-post]',shade), confirm = form.elements.confirmed, previewButton = $('[data-allowance-preview]',shade), message = $('[data-allowance-message]',shade);
    let checked = null, checkedInput = null, reverseOf = '', requestKey = '', busy = false, editRevision = 0;
    const close = () => { if (busy) return false; shade.remove(); window.removeEventListener('kushe:data-updated',invalidateExternal); document.removeEventListener('keydown',keydown); activeClose=null;previous?.focus?.();return true; };
    const invalidate = () => { editRevision++;checked = null; checkedInput = null; confirm.checked = false; confirm.disabled = true; post.disabled = true; review.hidden = true; requestKey = ''; };
    const invalidateExternal = () => { if (!busy && checked) { invalidate(); message.textContent = '資料已更新，請重新核對本次入帳；已填內容仍保留。'; } };
    const keydown = event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = $$('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])',shade).filter(n=>!n.closest('[hidden]'));
        const first=focusable[0],last=focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault();last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
      }
    };
    document.addEventListener('keydown',keydown);window.addEventListener('kushe:data-updated',invalidateExternal);
    activeClose=close;previewButton.textContent='核對雲端並預覽';
    $$('[data-allowance-close]',shade).forEach(b=>b.onclick=close);
    shade.addEventListener('click',event=>{if(event.target===shade)close()});
    form.addEventListener('input',event=>{if(event.target===confirm){post.disabled=!checked?.allowed||!confirm.checked||busy;return}const terms=event.target.closest('[data-legacy-payment-terms]');if(terms&&!event.target.matches('[data-legacy-terms-confirmed]'))$('[data-legacy-terms-confirmed]',terms).checked=false;invalidate();message.textContent=''});
    form.addEventListener('change',event=>{if(event.target!==confirm)invalidate();else post.disabled=!checked?.allowed||!confirm.checked||busy});
    const read = () => {
      const input = {date:form.elements.date.value,reason:form.elements.reason.value.trim(),reference:form.elements.reference.value.trim(),invoiceEvidence:$$('[data-allowance-evidence]',form).filter(row=>$('[data-voucher-verified]',row).checked||$('[data-voucher-reference]',row).value||$('[data-voucher-date]',row).value).map(row=>({invoiceId:row.dataset.allowanceEvidence,voucherReference:$('[data-voucher-reference]',row).value.trim(),voucherDate:$('[data-voucher-date]',row).value,verified:$('[data-voucher-verified]',row).checked}))};
      if(reverseOf)return {...input,reverseOf};
      const legacyPaymentTerms=readLegacyTerms(form);if(legacyPaymentTerms.length)input.legacyPaymentTerms=legacyPaymentTerms;
      return {...input,scope:options.externalDocumentId?'external-document':'billing',...(options.externalDocumentId?{externalDocumentId:String(options.externalDocumentId)}:{billingId:String(options.billingId)}),approvedGrossReduction:form.elements.approvedGrossReduction.value,allocations:$$('[data-allowance-source]',form).map(row=>({billingId:row.dataset.allowanceSource,reductions:Object.fromEntries(fields.map(k=>[k,$('[data-reduction="'+k+'"]',row)?.value??'0']))}))};
    };
    form.onsubmit = async event => {
      event.preventDefault();if(busy||!form.reportValidity())return;invalidate();const revision=editRevision;busy=true;previewButton.disabled=true;message.textContent='正在核對雲端、來源、金額與既有收款…';
      try {
        const input=read();let readinessError=null;try{await prepareCloud()}catch(error){readinessError=error}
        const raw=await store.billingAllowancePreview(input),result=readinessError?{...raw,allowed:false,blockers:[...(raw.blockers||[]),{code:'CLOUD_READINESS',message:readinessError.message||String(readinessError)}]}:raw;
        if(revision!==editRevision){message.textContent='內容已變動，請重新核對。';return}
        renderLegacyTerms(form,result.commissionImpact,reverseOf);
        checked=result;checkedInput=input;requestKey=token();review.innerHTML=reviewMarkup(result);review.hidden=false;review.classList.toggle('is-blocked',!result.allowed);confirm.disabled=!result.allowed;message.textContent=result.allowed?'核對完成，請確認上方逐來源金額後入帳。':'尚未入帳。依上方原因處理後，再按「核對本次入帳」。';
        review.scrollIntoView({block:'nearest',behavior:'smooth'});
      }catch(error){review.innerHTML='<p role="alert">'+esc(error.message||String(error))+'</p>';review.hidden=false;review.classList.add('is-blocked');message.textContent='尚未入帳，已填內容仍保留。'}
      finally{busy=false;previewButton.disabled=false;post.disabled=!checked?.allowed||!confirm.checked}
    };
    post.onclick = async () => {
      if(busy||!checked?.allowed||!checkedInput||!confirm.checked)return;
      busy=true;form.inert=true;post.disabled=true;previewButton.disabled=true;message.textContent='正在儲存正式折讓紀錄…';
      try {
        await prepareCloud();
        const fresh=await store.billingAllowancePreview(checkedInput);
        if(!fresh.allowed)throw new Error((fresh.blockers||[]).map(issueText).join('；')||'目前條件已變更，請重新核對。');
        if(fresh.snapshot!==checked.snapshot)throw new Error('請款、折讓或收款資料已變更，請重新核對最新金額後入帳。');
        const input={...checkedInput,expectedSnapshot:checked.snapshot,idempotencyKey:requestKey,confirmed:true};
        if(reverseOf)await store.reverseBillingAllowance(reverseOf,input);else await store.postBillingAllowance(input);
      }catch(error){busy=false;form.inert=false;invalidate();previewButton.disabled=false;message.textContent=error.message||String(error);review.innerHTML='<p role="alert">'+esc(error.message||String(error))+'</p><p>請重新核對最新資料後再送出。</p>';review.hidden=false;review.classList.add('is-blocked');return}
      // The Store has committed. Presentation failures must never reopen a retry.
      busy=false;checked=null;checkedInput=null;confirm.checked=false;confirm.disabled=true;
      const success=(reverseOf?'折讓撤銷已記錄，有效餘額已更新。':'折讓已記錄，有效餘額已更新。')+'雲端同步狀態請見頁面提示。';
      try{close()}
      catch(error){
        shade.remove();activeClose=null;
        const notice=document.createElement('aside');notice.className='allowance-success';notice.setAttribute('role','alert');notice.dataset.allowanceCommittedWarning='';
        notice.textContent=success+' 紀錄已完成，畫面更新未完成。請重新整理核對最新紀錄，請勿重複送出。';document.body.prepend(notice);
      }
      try{window.KushePhase1?.toast(success)}catch(_){}
    };
    $$('[data-allowance-reverse]',shade).forEach(button=>button.onclick=()=>{
      if(busy)return;invalidate();reverseOf=button.dataset.allowanceReverse;renderLegacyTerms(form,null,reverseOf);const event=ctx.history.find(h=>h.id===reverseOf);form.elements.reason.value='';form.elements.reference.value='';form.elements.date.value=today();
      $$('[data-voucher-reference],[data-voucher-date]',form).forEach(input=>input.value='');$$('[data-voucher-verified]',form).forEach(input=>input.checked=false);
      $('[data-allowance-allocations]',form).hidden=true;$('[data-allowance-total-field]',form).hidden=true;form.elements.approvedGrossReduction.required=false;
      $$('[data-allowance-source] input',form).forEach(n=>n.disabled=true);$('[data-allowance-cancel-reverse]',form).hidden=false;
      const note=$('[data-allowance-reverse-notice]',form);note.hidden=false;note.textContent='撤銷 '+(event?.date||'')+' 的折讓 '+money(event?.approvedGrossReduction)+'。請填撤銷原因與核定依據，再核對恢復金額。';
      post.textContent='確認折讓撤銷';previewButton.textContent='核對雲端並預覽撤銷';message.textContent='';form.elements.reason.focus();
    });
    $('[data-allowance-cancel-reverse]',form).onclick=()=>{if(busy)return;close();open(options)};
    form.elements.reason.focus();
    return {element:shade,close};
  }
  style();
  window.KusheBillingAllowance = Object.freeze({open,billing,receivable,forBilling,forReceivable,receiptState,summary,issueText});
}());
