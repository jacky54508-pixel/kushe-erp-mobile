(function(){
  'use strict';
  const store=window.KuSheERPStore,$=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>'$'+Number(v||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
  const today=()=>{const p=Object.fromEntries(formatter.formatToParts(new Date()).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`};
  const token=()=> 'cheque-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const labels={pending:'待兌現',upcoming:'即將到期',today:'今日到期',overdue:'已到期未兌現',cleared:'已兌現',cancelled:'已取消／退回',invalid:'資料待核對'};
  let current=null,lastDay=today();const receiptBindings=new WeakMap();
  function rows(id=''){return store.receivableChequeRows(id,today())}
  function badge(row){return `<span class="cheque-status is-${esc(row.reminderState)}">${labels[row.reminderState]||'待核對'}</span>`}
  function close(restore=true){if(current?.busy)return;const focus=current?.returnFocus;current?.node.remove();current=null;if(restore!==false&&focus?.isConnected)focus.focus({preventScroll:true})}
  function shell(title,subtitle,body,footer){
    const returnFocus=current?.returnFocus||document.activeElement;close(false);if(current)return null;
    const node=document.createElement('div');node.className='erp-detail-overlay cheque-overlay';
    node.innerHTML=`<section class="erp-detail-card cheque-card" role="dialog" aria-modal="true" aria-labelledby="chequeTitle"><header><div><small>應收支票</small><h2 id="chequeTitle">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button type="button" class="cheque-close" data-cheque-close aria-label="關閉">×</button></header><div class="cheque-body">${body}</div><footer><p class="cheque-feedback" role="status" aria-live="polite" hidden></p>${footer}</footer></section>`;
    document.body.append(node);current={node,busy:false,stale:false,returnFocus};
    $$('[data-cheque-close]',node).forEach(b=>b.onclick=close);
    node.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){
      const focus=$$('button,input,select,textarea,summary',node).filter(n=>!n.disabled&&n.getClientRects().length),first=focus[0],last=focus.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }});
    requestAnimationFrame(()=>$('[data-cheque-close]',node)?.focus({preventScroll:true}));return current;
  }
  function feedback(ctx,message,tone='error'){
    if(!ctx?.node.isConnected)return;const n=$('.cheque-feedback',ctx.node);n.textContent=message;n.hidden=!message;n.dataset.tone=tone;n.setAttribute('role',tone==='error'?'alert':'status');
  }
  function modalActions(ctx){
    $$('[data-cheque-open]',ctx.node).forEach(b=>b.onclick=()=>openDetail(b.dataset.ar,b.dataset.chequeOpen));
  }
  function openManager(options={}){
    const all=rows(options.receivableId||''),filter=options.filter||'all',query=options.query||'';
    const matching=r=>(filter==='all'||filter==='pending'&&r.status==='pending'||r.reminderState===filter)&&(!query||`${r.number} ${r.customerName} ${r.projectName} ${r.sourceNo}`.toLocaleLowerCase('zh-Hant').includes(query.toLocaleLowerCase('zh-Hant')));
    const sorted=all.filter(matching).sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||''))||String(a.number).localeCompare(String(b.number))),pending=all.filter(r=>r.status==='pending'),legacy=(store.getState().receipts||[]).filter(r=>r.paymentMethod==='支票'&&!r.chequeId&&(!options.receivableId||String(r.receivableId)===String(options.receivableId)));
    const list=sorted.map(r=>`<article class="cheque-list-row"><div><strong>${esc(r.number)}</strong><small>${esc(r.issuerBank||'付款銀行未填')}</small></div><div><b>${esc(r.projectName)}</b><small>${esc(r.customerName)} · ${esc(r.sourceNo)}</small></div><div><b>${esc(r.dueDate||'—')}</b>${badge(r)}</div><strong class="cheque-amount">${money(r.amount)}</strong><button type="button" class="commission-secondary" data-ar="${esc(r.receivableId)}" data-cheque-open="${esc(r.id)}">查看</button></article>`).join('')||'<p class="cheque-empty">沒有符合條件的支票。</p>';
    const ctx=shell('支票管理','收到支票先登記；銀行實際入帳後再確認兌現。',`<div class="cheque-list-summary"><span>待兌現 <b>${pending.length} 張</b></span><span>票面合計 <b>${money(pending.reduce((s,r)=>s+r.amount,0))}</b></span></div><p class="cheque-help">待兌現仍包含在未沖銷應收內，不要重複加總；未兌現不解鎖抽成。提醒顯示於 ERP 內，關閉網站時不會推播。</p><div class="cheque-filter"><label><span>狀態</span><select id="chequeFilter">${[['all','全部'],['pending','全部待兌現'],['upcoming','即將到期'],['today','今日到期'],['overdue','已到期未兌現'],['cleared','已兌現'],['cancelled','已取消／退回'],['invalid','待核對']].map(([v,l])=>`<option value="${v}" ${filter===v?'selected':''}>${l}</option>`).join('')}</select></label><label><span>搜尋票號／客戶／案場</span><input id="chequeSearch" type="search" value="${esc(query)}" placeholder="輸入關鍵字"></label></div><div class="cheque-list">${list}</div>${legacy.length?`<details class="cheque-legacy"><summary>歷史支票收款 ${legacy.length} 筆（原已入帳紀錄）</summary><p>未自動轉成待兌現，也不猜票號或到期日。以下只供核對；本次不改寫歷史銀行收入。</p>${legacy.map(r=>`<div>${esc(r.date)} · ${money(r.cashAmount??r.amount)} · ${esc(r.note||'無備註')}</div>`).join('')}</details>`:''}`,`<button type="button" class="commission-secondary" data-cheque-close>關閉</button>`);
    if(!ctx)return;ctx.manager=options;modalActions(ctx);
    $('#chequeFilter',ctx.node).onchange=e=>openManager({...options,filter:e.target.value,query:$('#chequeSearch',ctx.node).value});
    const search=$('#chequeSearch',ctx.node);let timer=0,composing=false;
    const run=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!ctx.node.isConnected)return;const cursor=search.selectionStart;openManager({...options,filter:$('#chequeFilter',ctx.node).value,query:search.value});const next=$('#chequeSearch',current?.node||document);next?.focus();try{next?.setSelectionRange(cursor,cursor)}catch(_){}},200)};
    search.oncompositionstart=()=>{composing=true;clearTimeout(timer)};search.oncompositionend=()=>{composing=false;run()};search.oninput=e=>{if(!composing&&!e.isComposing)run()};
  }
  function getRow(arId,id){return rows(arId).find(r=>String(r.id)===String(id))}
  function detailMarkup(row){return `<div class="cheque-ticket-head"><div><small>支票號碼</small><strong>${esc(row.number)}</strong></div>${badge(row)}<strong class="cheque-ticket-amount">${money(row.amount)}</strong></div><dl class="cheque-meta">${[['客戶／案場',row.customerName+'／'+row.projectName],['對應請款單',row.sourceNo],['收票日期',row.receivedDate],['到期日／票面日期',row.dueDate],['付款銀行',row.issuerBank||'未填'],['發票人',row.drawer||'未填'],['提醒',row.reminderDays===0?'到期當天':'到期前 '+row.reminderDays+' 天'],['備註',row.note||'無'],['客戶扣款（兌現時才沖銷）',money((row.deductions||[]).reduce((s,r)=>s+r.amount,0))]].map(([l,v])=>`<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${row.deductions?.length?`<details class="cheque-deductions"><summary>查看客戶扣款 ${row.deductions.length} 筆</summary>${row.deductions.map(d=>`<p>${esc(d.category)} · ${money(d.amount)} · ${esc(d.note)}</p>`).join('')}</details>`:''}`}
  function openDetail(arId,id){
    const row=getRow(arId,id);if(!row)return window.KushePhase1?.toast('找不到支票，請重新開啟清單');
    const editable=row.status==='pending'&&row.reminderState!=='invalid';
    const ctx=shell('支票明細',row.projectName+' · '+row.sourceNo,detailMarkup(row)+(row.status==='cleared'?`<p class="cheque-success">已於 ${esc(row.clearedDate)} 確認入帳 ${money(row.amount-(row.feePayer==='company'?row.fee:0))}。對應收款與銀行交易均保留，不可從一般收款直接修改或刪除。</p>`:row.status==='cancelled'?`<p class="cheque-help">取消／退回原因：${esc(row.cancelReason)}</p>`:'<p class="cheque-help">日期到期只會提醒，不會自動入帳，也不會直接認定退票。</p>'),`<button type="button" class="commission-secondary" id="chequeBack">返回清單</button>${editable?'<button type="button" class="commission-secondary" id="chequeEdit">編輯票據</button><button type="button" class="commission-secondary cheque-danger" id="chequeCancel">取消／退回</button><button type="button" class="commission-primary" id="chequeClear">確認兌現…</button>':''}`);
    if(!ctx)return;$('#chequeBack',ctx.node).onclick=()=>openManager({receivableId:arId});
    if(editable){$('#chequeEdit',ctx.node).onclick=()=>openEdit(arId,id);$('#chequeCancel',ctx.node).onclick=()=>openCancel(arId,id);$('#chequeClear',ctx.node).onclick=()=>openClear(arId,id)}
  }
  function ticketFields(row={}){
    return `<div class="cheque-fields"><label><span>支票號碼 *</span><input name="chequeNumber" aria-label="支票號碼" type="text" maxlength="80" autocomplete="off" value="${esc(row.number||'')}" placeholder="保留前面的 0，例如 0012345" required></label><label><span>到期日／票面日期 *</span><input name="chequeDueDate" aria-label="到期日／票面日期" type="date" value="${esc(row.dueDate||'')}" required></label><label><span>到期提醒</span><select name="chequeReminderDays">${[[3,'到期前 3 天'],[1,'到期前 1 天'],[7,'到期前 7 天'],[0,'到期當天']].map(([v,l])=>`<option value="${v}" ${Number(row.reminderDays??3)===v?'selected':''}>${l}</option>`).join('')}</select></label><label><span>付款銀行（選填）</span><input name="chequeIssuerBank" value="${esc(row.issuerBank||'')}" placeholder="票面上的付款銀行"></label><label><span>發票人（選填）</span><input name="chequeDrawer" value="${esc(row.drawer||'')}" placeholder="開票公司或個人"></label></div>`;
  }
  const readTicket=form=>({number:form.elements.chequeNumber.value,dueDate:form.elements.chequeDueDate.value,reminderDays:form.elements.chequeReminderDays.value,issuerBank:form.elements.chequeIssuerBank.value,drawer:form.elements.chequeDrawer.value});
  function prepareForm(ctx,arId,id,work){
    ctx.arId=arId;ctx.snapshot=store.receivableChequeSnapshot(arId);const request=token(),form=$('form',ctx.node);
    form.onsubmit=async e=>{
      e.preventDefault();if(ctx.busy||ctx.stale||form.dataset.committed)return;
      if(!form.reportValidity())return;
      ctx.busy=true;ctx.node.setAttribute('aria-busy','true');$('.cheque-card',ctx.node).inert=true;feedback(ctx,'儲存中，請勿重送。','status');
      try{await work(form,{expectedSnapshot:ctx.snapshot,idempotencyKey:request})}catch(error){
        ctx.busy=false;ctx.node.removeAttribute('aria-busy');$('.cheque-card',ctx.node).inert=false;
        if(error.transactionStatus==='RECOVERY_REQUIRED'){ctx.stale=true;$$('button[type="submit"],input,select,textarea',ctx.node).forEach(n=>n.disabled=true);feedback(ctx,'儲存狀態待核對，請勿重送或清除資料。請保留本視窗內容。')}
        else feedback(ctx,'未儲存：'+(error.message||String(error)));
        return;
      }
      form.dataset.committed='true';ctx.busy=false;$('.cheque-card',ctx.node).inert=false;
      // A presentation failure after a resolved writer is never reported as a failed write.
      try{openDetail(arId,id);const result=store.getLastStoreTransactionResult?.();if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING')window.KusheRecovery?.showResult?.(result);else window.KushePhase1?.toast('支票紀錄已儲存')}catch(_){feedback(ctx,'資料已儲存；畫面更新異常，請重新整理，勿重送。','status')}
    };
    $('#chequeBack',ctx.node).onclick=()=>openDetail(arId,id);
  }
  function openEdit(arId,id){
    const row=getRow(arId,id);if(!row)return;
    const ctx=shell('編輯待兌現支票',row.projectName+' · '+row.sourceNo,`<form id="chequeEditForm">${ticketFields(row)}<div class="cheque-fields"><label><span>收票日期 *</span><input name="receivedDate" type="date" value="${esc(row.receivedDate)}" max="${today()}" required></label><label><span>票面金額 *</span><input name="amount" type="number" min="1" step="1" value="${row.amount}" required></label><label class="cheque-wide"><span>票據備註</span><textarea name="note" rows="2">${esc(row.note)}</textarea></label></div><p class="cheque-help">只更新這張未兌現票據，不改銀行入帳。原客戶扣款保持不變，金額合計 ${money((row.deductions||[]).reduce((s,r)=>s+r.amount,0))}。</p></form>`,`<button type="button" class="commission-secondary" id="chequeBack">取消編輯</button><button type="submit" form="chequeEditForm" class="commission-primary">儲存票據</button>`);
    if(ctx)prepareForm(ctx,arId,id,(f,meta)=>store.saveReceivableCheque(arId,{...readTicket(f),receivedDate:f.elements.receivedDate.value,amount:f.elements.amount.value,note:f.elements.note.value,deductions:row.deductions,...meta},id));
  }
  function openCancel(arId,id){
    const row=getRow(arId,id);if(!row)return;
    const ctx=shell('取消／退回待兌現支票',row.number+' · '+money(row.amount),`<form id="chequeCancelForm"><p class="cheque-help">保留原票據歷程並釋放預留額度，不會建立或撤銷銀行入帳。到期未兌現不會被系統自動取消。</p><label><span>取消／退回原因 *</span><textarea name="reason" rows="3" required placeholder="例如：客戶收回換票、登記錯誤（請依實際情況填寫）"></textarea></label></form>`,`<button type="button" class="commission-secondary" id="chequeBack">返回</button><button type="submit" form="chequeCancelForm" class="commission-primary">確認取消／退回</button>`);
    if(ctx)prepareForm(ctx,arId,id,(f,meta)=>store.cancelReceivableCheque(arId,id,{reason:f.elements.reason.value,...meta}));
  }
  function openClear(arId,id){
    const row=getRow(arId,id);if(!row)return;
    const ctx=shell('確認支票已兌現',row.number+' · '+row.projectName,`<div class="cheque-clear-amount"><span>票面金額</span><strong>${money(row.amount)}</strong></div><form id="chequeClearForm"><div class="cheque-fields"><label><span>實際入帳日期 *</span><input name="date" type="date" value="${today()}" min="${esc([row.receivedDate,row.dueDate].sort().at(-1))}" max="${today()}" required></label><label><span>實際入帳銀行 *</span><select name="bankId" required><option value="">請選擇銀行帳戶</option>${(store.masterOptions('banks')||[]).map(b=>`<option value="${esc(b.id)}">${esc(b.name||b.bank||b.account)}</option>`).join('')}</select></label><label><span>銀行手續費</span><input name="fee" type="number" min="0" step="1" value="0" required></label><label><span>手續費負擔</span><select name="feePayer"><option value="company">公司負擔</option><option value="counterparty">付款人負擔</option></select></label><label class="cheque-wide"><span>入帳備註（選填）</span><input name="note" value="${esc(row.note)}"></label></div><div class="cheque-clear-preview"><span>銀行實際入帳 <b id="chequeBankCredit">${money(row.amount)}</b></span><span>本次沖銷應收 <b>${money(row.reservedAmount)}</b></span></div><label class="cheque-confirm"><input name="confirmed" type="checkbox" required><span>我已核對銀行，確認這張支票已實際入帳；不是只因到期就確認。</span></label><p class="cheque-help">確認後會建立一筆銀行收入及對應收款，並依原收清條件判斷抽成是否可發。客戶扣款 ${money(row.reservedAmount-row.amount)} 在這次一起沖銷，不列為銀行收入。</p></form>`,`<button type="button" class="commission-secondary" id="chequeBack">取消</button><button type="submit" form="chequeClearForm" class="commission-primary">確認已入帳</button>`);
    if(!ctx)return;const f=$('form',ctx.node);const update=()=>{$('#chequeBankCredit',ctx.node).textContent=money(Math.max(0,row.amount-(f.elements.feePayer.value==='company'?Number(f.elements.fee.value)||0:0)))};f.oninput=update;f.onchange=update;
    prepareForm(ctx,arId,id,(f,meta)=>store.clearReceivableCheque(arId,id,{date:f.elements.date.value,bankId:f.elements.bankId.value,fee:f.elements.fee.value,feePayer:f.elements.feePayer.value,note:f.elements.note.value,confirmed:f.elements.confirmed.checked,...meta}));
  }
  function bindReceiptEditor({form,ar,receipt,refresh}){
    const method=form.elements.paymentMethod;
    if(receipt){
      if(receipt.paymentMethod==='支票')form.querySelector('.receipt-form-grid')?.insertAdjacentHTML('beforeend','<p class="cheque-entry-note">這是歷史已入帳支票，保留原收款；本次不自動轉成待兌現，也不補猜票號或到期日。</p>');
      else Array.from(method.options).find(o=>o.value==='支票')?.setAttribute('disabled','');
      return null;
    }
    const expectedSnapshot=store.receivableChequeSnapshot(ar.id),card=form.closest('section');
    let capacity,capacityError='';try{capacity=store.receivableChequeCapacity(ar.id)}catch(error){capacityError=error.message;capacity={outstanding:Math.max(0,Number(ar.amount||0)-Number(ar.received||0)),reserved:0,available:0}}

    const fieldset=document.createElement('fieldset');fieldset.className='cheque-entry-fields';fieldset.hidden=true;fieldset.innerHTML='<legend>支票資料</legend>'+ticketFields()+'<p class="cheque-help">儲存後為待兌現：銀行不入帳、應收暫不沖銷、抽成不提前解鎖。客戶扣款先保留，確認兌現時再處理。</p>';
    method.closest('label').after(fieldset);
    if(capacity.reserved>0)form.querySelector('.receipt-form-grid').insertAdjacentHTML('beforebegin',`<p class="cheque-entry-note">已有待兌現預留 ${money(capacity.reserved)}，本次可再收款／登記 ${money(capacity.available)}。待兌現金額仍包含在未沖銷應收內。</p>`);
    const isCheque=()=>form.elements.collectionType.value!=='employee_cash'&&method.value==='支票';
    const caption=(name,value)=>{const n=form.elements[name].closest('label').querySelector(':scope>span');if(n)n.textContent=value};
    const summary=(id,text,value)=>{const n=$('#'+id,form);if(!n)return;if(n.parentElement.firstChild?.nodeType===3)n.parentElement.firstChild.textContent=text;n.textContent=money(value)};
    const sync=()=>{
      const cheque=isCheque();fieldset.hidden=!cheque;
      const header=card.querySelector(':scope>header p');if(header)header.textContent=cheque?'支票先登記待兌現；銀行實際入帳後再確認，到期日只作提醒。':'銀行收款會同步銀行入帳；員工現金代收只沖銷應收，先標記「待繳回」。';
      const companyOption=Array.from(form.elements.collectionType.options).find(o=>o.value==='bank');if(companyOption)companyOption.textContent=cheque?'公司收票／待兌現':'公司直接收款／入銀行';
      for(const [id,text] of [['customerCashPreview',cheque?'本次收票面額':'本次客戶付款'],['customerDeductionPreview',cheque?'待確認客戶扣款':'客戶扣款合計']]){const n=$('#'+id,form);if(n?.parentElement.firstChild?.nodeType===3)n.parentElement.firstChild.textContent=text}
      form.elements.note.placeholder=cheque?'票據用途、收票說明或其他備註':'匯款末五碼、現場代收說明或其他備註';$$('input,select',fieldset).forEach(n=>n.disabled=!cheque);
      caption('date',cheque?'收票日期':'收款日期');caption('cashAmount',cheque?'支票票面金額':'本次客戶付款');
      if(cheque){['bankId','fee','feePayer'].forEach(name=>{const n=form.elements[name];n.disabled=true;n.required=false;n.closest('label').hidden=true;n.closest('label').style.display='none'});form.elements.cashAmount.min='1';
        summary('customerBankPreview','銀行本次入帳',0);summary('customerSettlementPreview','本次立即沖銷',0);summary('customerOutstandingPreview','原未沖銷應收',capacity.outstanding);
      }else{form.elements.cashAmount.min='0';
        for(const [id,text] of [['customerBankPreview','銀行實際入帳'],['customerSettlementPreview','本次沖銷應收'],['customerOutstandingPreview','沖銷後未收']]){const n=$('#'+id,form);if(n?.parentElement.firstChild?.nodeType===3)n.parentElement.firstChild.textContent=text}
      }
      const b=$('button[type="submit"]',form);if(!b.disabled)b.textContent=cheque?'登記待兌現支票':'確認收款';
    };
    receiptBindings.set(form,sync);form.addEventListener('change',sync);form.addEventListener('input',sync);sync();
    return {isCheque,read:()=>({...readTicket(form),receivedDate:form.elements.date.value,expectedSnapshot}),lock(value){card.inert=value},check(){if(capacityError)throw Error(capacityError);if(store.receivableChequeSnapshot(ar.id)!==expectedSnapshot)throw Error('應收或支票已變動，請保留輸入並重新開啟核對')}};
  }
  function enhanceReceivables(app){
    if(!app||$('#chequeToolbar',app))return;
    const all=rows(),pending=all.filter(r=>r.status==='pending'),due=pending.filter(r=>['upcoming','today','overdue'].includes(r.reminderState));
    const bar=document.createElement('section');bar.id='chequeToolbar';bar.className='cheque-toolbar';bar.innerHTML=`<div><strong>應收支票</strong><span>待兌現 ${pending.length} 張 · ${money(pending.reduce((s,r)=>s+r.amount,0))}${due.length?' · 到期提醒 '+due.length+' 張':''}</span></div><button class="commission-secondary" type="button">管理支票</button>`;
    const heading=$('.commissions-heading',app);if(heading)heading.after(bar);else app.prepend(bar);$('button',bar).onclick=()=>openManager();
    $$('[data-expand-receivable],[data-mobile-receivable]',app).forEach(n=>{
      const arId=n.dataset.expandReceivable||n.dataset.mobileReceivable,related=all.filter(r=>String(r.receivableId)===arId);if(!related.length)return;
      const host=$('.receivable-actions',n);if(!host||$('[data-cheque-history]',host))return;
      const b=document.createElement('button');b.type='button';b.dataset.chequeHistory=arId;b.className='cheque-row-link';b.textContent='支票 '+related.length+' 張';b.onclick=e=>{e.stopPropagation();openManager({receivableId:arId})};host.append(b);
    });
  }
  function attentionItems(data,asOf=today()){
    const all=store.receivableChequeRows('',asOf,data),types=[['overdue','支票到期未兌現','red'],['today','支票今日到期','orange'],['upcoming','支票即將到期','blue'],['invalid','支票資料待核對','red']];
    return types.flatMap(([state,type,tone])=>{const matched=all.filter(r=>r.reminderState===state);return matched.length?[{type,tone,icon:'calendar-clock',count:matched.length,countLabel:matched.length+' 張',amount:matched.reduce((s,r)=>s+Number(r.amount||0),0),chequeFilter:state}]:[]});
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-cheque-filter]');if(!b)return;e.preventDefault();e.stopPropagation();openManager({filter:b.dataset.chequeFilter})},true);
  window.addEventListener('kushe:data-updated',()=>{
    const ctx=current;if(!ctx||ctx.busy||!ctx.snapshot)return;
    try{if(store.receivableChequeSnapshot(ctx.arId)===ctx.snapshot)return}catch(_){}
    ctx.stale=true;$$('button[type="submit"]',ctx.node).forEach(b=>b.disabled=true);feedback(ctx,'此筆應收或支票已由其他操作更新。輸入已保留，請取消後重新開啟核對。');
  });
  const refreshDate=()=>{const day=today();if(day===lastDay||!store.getState())return;lastDay=day;window.KusheDashboard?.refresh?.();if(current?.manager&&!current.busy)openManager(current.manager)};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate()});setInterval(refreshDate,60000);
  window.KusheCheques={syncReceiptEditor:form=>receiptBindings.get(form)?.(),receiptError(form,error){let p=$('.cheque-entry-feedback',form);if(!p){p=document.createElement('p');p.className='cheque-entry-note cheque-entry-feedback';p.setAttribute('role','alert');$('footer',form).prepend(p)}p.textContent=error.transactionStatus==='RECOVERY_REQUIRED'?'儲存狀態待核對，請勿重送或清除資料。輸入已保留。':'未儲存：'+(error.message||String(error));},bindReceiptEditor,enhanceReceivables,attentionItems,openManager,openDetail,close};
}());
