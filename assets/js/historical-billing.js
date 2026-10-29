(function(){
  'use strict';
  const store=window.KuSheERPStore,$=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=value=>value===null?'待核對':'$'+Number(value||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
  function mount(overlay,billing,info,onSaved){
    if(!info||!info.protected)return;
    const body=$('.erp-detail-body',overlay),banner=document.createElement('section');banner.className='historical-billing-banner';
    const missing=!Array.isArray(billing.lines)||!billing.lines.length,showButton=info.eligible;
    const title=info.isHistorical?(info.supplementValid?'歷史明細已補登':'歷史請款｜施工明細待補登'):'帳款已鎖定';
    banner.innerHTML='<div><strong>'+title+'</strong><p>'+(missing?'金額沿用已保存帳款，不以空明細重算。補登只補文件內容，不新增施工、薪資或應收。':'已開票或進入收款流程；此處只更正票號與日期，不重新計算帳款。')+'</p></div>'+(showButton?'<button type="button" class="commission-secondary" data-history-open>'+(info.supplementValid?'更正補登明細':'補登歷史明細')+'</button>':'');
    body.insertBefore(banner,$('.billing-desktop-detail',body));
    if(info.issues.length){const note=document.createElement('p');note.className='billing-document-feedback';note.textContent='資料待核對：'+info.issues.join('；');banner.append(note);$$('[data-export-billing],[data-print-billing]',overlay).forEach(b=>b.disabled=true)}
    if(missing&&!info.supplementValid){const tbody=$('.billing-desktop-detail tbody',overlay);if(tbody){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.className='historical-empty';td.textContent='尚無歷史施工明細；這不代表原帳款為零。';tr.append(td);tbody.append(tr)}}
    if(info.supplementValid){const meta=$$('.billing-detail-meta>span',overlay)[2];if(meta)meta.innerHTML='補登明細單價<b>'+esc(info.supplement.taxMode)+'</b>'}
    $('[data-history-open]',banner)?.addEventListener('click',()=>open(overlay,billing,info,onSaved));
  }
  function lineMarkup(line={}){
    return '<section class="historical-line">'+[['date','施工日期','date'],['house','戶別／位置','text'],['item','施工項目','text'],['unit','單位','text'],['qty','數量','number'],['price','單價','number']].map(([name,label,type])=>'<label class="historical-cell historical-'+name+'"><span>'+label+(name==='date'||name==='house'?'（選填）':'')+'</span><input name="'+name+'" aria-label="'+label+'" type="'+type+'" value="'+esc(line[name]??'')+'" '+(type==='number'?'inputmode="decimal" min="'+(name==='qty'?'0.0001':'0')+'" step="0.0001" ':'')+(['item','unit','qty','price'].includes(name)?'required ':'')+(type==='text'?'maxlength="'+(name==='item'?200:name==='unit'?20:100)+'" ':'')+'></label>').join('')+'<div class="historical-line-total"><span>小計</span><strong data-line-total>$0</strong></div><button type="button" class="historical-remove" data-remove-line aria-label="移除此筆明細">移除</button></section>';
  }
  function open(parent,billing,info,onSaved){
    if(!info.eligible)return;
    if(!window.KusheHistoricalQuotation||!store.historicalQuotationChoices){window.KushePhase1?.toast('補登程式尚未完整載入，請保留輸入後重新整理。');return}
    const layer=document.createElement('div');layer.className='erp-detail-overlay historical-detail-overlay';
    const previous=info.supplement,amounts=info.amounts;
    layer.innerHTML='<section class="erp-detail-card historical-detail-card" role="dialog" aria-modal="true" aria-labelledby="historicalDetailTitle"><header><div><span>歷史請款・僅補文件明細</span><h2 id="historicalDetailTitle">'+(previous?'更正補登明細':'補登歷史明細')+'</h2><p>'+esc(billing.customerName||'')+'｜'+esc(billing.projectName||'')+'</p></div><button type="button" data-history-close aria-label="關閉">×</button></header><form id="historicalBillingForm" novalidate autocomplete="off"><div class="erp-detail-body"><section class="historical-anchors"><span>原未稅<b>'+money(amounts.untaxed)+'</b></span><span>原稅額<b>'+money(amounts.tax)+'</b></span><span>原含稅<b>'+money(amounts.grossTotal)+'</b></span><span>原應收<b>'+money(amounts.receivable)+'</b></span></section><p class="historical-help">依原始資料補登；原發票、應收、收款與銀行金額保持不變。稅額沿用歷史紀錄，不套用目前稅率；每列小計四捨五入至元後加總。</p><div class="historical-controls"><label><span>原始明細單價方式</span><select name="taxMode"><option value="未稅">未稅單價</option><option value="含稅">含稅單價</option></select></label><div class="historical-input-actions"><button type="button" class="commission-primary" data-import-quote>從報價單帶入</button><button type="button" class="commission-secondary" data-add-history>＋ 手動新增</button></div></div><div data-historical-lines></div><label class="historical-reference"><span>原始資料依據（必填）</span><textarea name="reference" rows="2" maxlength="1000" required placeholder="例如：原始請款單日期、施工明細表或核對依據；不確定的細項請勿猜填。">'+esc(previous?.reference||'')+'</textarea></label><label class="historical-confirm"><input type="checkbox" name="confirmed"><span>已核對原始請款資料，明細合計與原帳款一致。</span></label>'+(previous?'<p class="historical-help">目前為第 '+previous.revision+' 版；更正後保留前一版明細。</p>':'')+'</div><footer><div class="historical-checksum"><span>補登合計 <b data-history-total>$0</b></span><span>原帳款目標 <b data-history-target></b></span><strong data-history-difference></strong></div><p class="billing-document-feedback" data-history-feedback role="status" aria-live="polite" hidden></p><div class="historical-footer-actions"><span>僅保存明細，不重建帳務</span><button type="button" class="commission-secondary" data-history-close>取消</button><button type="submit" class="commission-primary">儲存歷史明細</button></div></footer></form></section>';
    parent.classList.add('historical-billing-parent');parent.hidden=true;document.body.append(layer);const form=$('form',layer),host=$('[data-historical-lines]',form),submit=$('button[type="submit"]',form);let saving=false,committed=false,locked=false;
    form.elements.taxMode.value=previous?.taxMode||(billing.taxMode==='含稅'?'含稅':'未稅');
    const readLines=()=>$$('.historical-line',host).map(row=>({...Object.fromEntries(['date','house','item','unit','qty','price'].map(key=>[key,$('[name="'+key+'"]',row).value])),...window.KusheHistoricalQuotation.readRow(row)}));
    const feedback=(message,error=false)=>{const node=$('[data-history-feedback]',form);node.hidden=!message;node.textContent=message;node.dataset.tone=error?'error':'info';node.setAttribute('role',error?'alert':'status')};
    const refresh=()=>{
      let total=0;$$('.historical-line',host).forEach(row=>{window.KusheHistoricalQuotation.refreshRow(row);const amount=Number($('[name="qty"]',row).value)*Number($('[name="price"]',row).value);total+=Number.isFinite(amount)?Math.round(amount):0;$('[data-line-total]',row).textContent=Number.isFinite(amount)?money(Math.round(amount)):'待核對'});total=Math.round(total);
      const target=form.elements.taxMode.value==='含稅'?amounts.grossTotal:amounts.untaxed,diff=total-target;
      $('[data-history-total]',form).textContent=money(total);$('[data-history-target]',form).textContent=money(target);$('[data-history-difference]',form).textContent=diff===0?'金額一致':'差額 '+money(diff);$('[data-history-difference]',form).dataset.match=String(diff===0);
      const taxMismatch=readLines().some(line=>line.quotationSource&&line.quotationSource.taxMode!==form.elements.taxMode.value);
      if(taxMismatch){$('[data-history-difference]',form).textContent='引用報價稅別不同，請核對單價方式';$('[data-history-difference]',form).dataset.match='false'}
      submit.disabled=saving||locked||committed||diff!==0||taxMismatch||!form.elements.confirmed.checked;
    };
    const add=line=>{
      host.insertAdjacentHTML('beforeend',lineMarkup(line));const row=host.lastElementChild;
      window.KusheHistoricalQuotation.bindRow(row,line);
      $('[data-remove-line]',row).onclick=()=>{if(saving||locked)return;row.remove();form.elements.confirmed.checked=false;refresh()};
      const duplicate=document.createElement('button');duplicate.type='button';duplicate.className='historical-copy';duplicate.textContent='複製到另一戶';duplicate.onclick=()=>{if(saving||locked)return;if(host.children.length>=200){feedback('最多 200 筆歷史明細。',true);return}const current=readLines()[$$('.historical-line',host).indexOf(row)];add({...current,date:'',house:'',qty:''});form.elements.confirmed.checked=false;refresh();$('[name="house"]',host.lastElementChild).focus()};row.append(duplicate);refresh();
    };
    (previous?.lines.length?previous.lines:[{}]).forEach(add);$('[data-add-history]',form).onclick=()=>{if(saving||locked)return;if(host.children.length>=200){feedback('最多 200 筆歷史明細。',true);return}add({});form.elements.confirmed.checked=false;refresh();$('[name="item"]',host.lastElementChild).focus()};
    $('[data-import-quote]',form).onclick=()=>{
      if(saving||locked)return;
      try{window.KusheHistoricalQuotation.open({parent:layer,billingId:billing.id,taxMode:form.elements.taxMode.value,existing:readLines(),trigger:$('[data-import-quote]',form),append:lines=>{
        const existing=readLines(),blank=existing.length===1&&!existing[0].quotationSource&&Object.values(existing[0]).every(v=>v==='');
        if(existing.length-(blank?1:0)+lines.length>200)throw new Error('帶入後超過 200 筆，請先核對明細。');
        if(blank)host.replaceChildren();lines.forEach(add);
        if(!form.elements.reference.value.trim())form.elements.reference.value='來源報價：'+[...new Set(lines.map(line=>line.quotationSource.quotationNumber))].join('、')+'；品項與單價參考，原請款數量已另核對。';
        form.elements.confirmed.checked=false;feedback('已帶入 '+lines.length+' 項，請填原請款數量並核對差額；尚未儲存。');refresh();
      },afterAppend:()=>$$('[name="qty"]',host).find(input=>!input.value)?.focus()})}catch(error){feedback(error.message||String(error),true)}
    };
    const edited=event=>{if(event.target!==form.elements.confirmed)form.elements.confirmed.checked=false;refresh()};
    form.addEventListener('input',edited);form.addEventListener('change',edited);
    const close=()=>{if(saving)return;layer.remove();if(parent.isConnected){parent.hidden=false;$('[data-history-open]',parent)?.focus()}};
    $$('[data-history-close]',layer).forEach(b=>b.onclick=close);
    layer.addEventListener('keydown',event=>{
      if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();close()}
      if(event.key==='Tab'){const nodes=$$('button,input,select,textarea',layer).filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    });
    form.onsubmit=async event=>{
      event.preventDefault();if(saving||locked||committed||submit.disabled)return;
      if(!form.checkValidity()){const invalid=$(':invalid',form);invalid?.focus();invalid?.reportValidity();feedback('請先填完整有效的施工項目、單位、數量、單價及資料依據。',true);return}
      const values={lines:readLines(),taxMode:form.elements.taxMode.value,reference:form.elements.reference.value,confirmed:form.elements.confirmed.checked,expectedSnapshot:info.snapshot};
      saving=true;layer.inert=true;submit.disabled=true;feedback('正在儲存，請勿重複送出。');
      try{await store.saveHistoricalBillingDetails(billing.id,values)}catch(error){
        saving=false;layer.inert=false;locked=error.transactionStatus==='RECOVERY_REQUIRED';feedback(locked?'儲存狀態待核對，請勿重送、清除資料或還原。':'未儲存：'+(error.message||String(error)),true);refresh();return;
      }
      committed=true;saving=false;layer.inert=false;layer.remove();if(parent.isConnected)parent.hidden=false;
      try{onSaved();window.KushePhase1?.toast('歷史明細已保存；原帳款與施工資料未變。')}catch(_){window.KushePhase1?.toast('明細已儲存，畫面更新異常；請重新開啟，勿重送。')}
    };
    refresh();requestAnimationFrame(()=>$('[name="item"]',host)?.focus({preventScroll:true}));
  }
  window.KusheHistoricalBilling=Object.freeze({mount});
}());
