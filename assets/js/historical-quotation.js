(function(){
  'use strict';
  // Only documentary drafts are changed here. All persisted writes use the existing Store transaction.
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const decimal=v=>Number(v).toLocaleString('zh-TW',{maximumFractionDigits:4});
  const clone=v=>JSON.parse(JSON.stringify(v)),key=s=>JSON.stringify([s.quotationId,s.lineId]),snapshots=new WeakMap();
  function bindRow(row,line){
    if(!line.quotationSource)return;
    const source=clone(line.quotationSource);snapshots.set(row,source);
    const block=document.createElement('div');block.className='historical-quote-origin';
    block.innerHTML='<p><b>來源報價</b> '+esc(source.quotationNumber)+' · '+esc(source.quotationDate||'日期未填')+' · 品項 '+esc(source.lineNumber)+'<span>引用'+esc(source.taxMode)+'單價 $'+esc(decimal(source.price))+'｜保存當次引用，不隨報價更新</span></p><label data-quote-adjustment><span>與報價不同的原因 <small>更正品項、單位或單價時必填</small></span><textarea name="quotationAdjustmentReason" rows="2" maxlength="300" aria-label="與報價不同的原因" placeholder="例如：依原請款單議定價；請勿為湊齊差額任意調價。">'+esc(line.quotationAdjustmentReason||'')+'</textarea></label>';
    row.append(block);refreshRow(row);
  }
  function refreshRow(row){
    const source=snapshots.get(row);if(!source)return;
    const differs=['item','unit'].some(k=>$('[name="'+k+'"]',row).value.trim()!==source[k])||Number($('[name="price"]',row).value)!==source.price;
    const area=$('[data-quote-adjustment]',row),input=$('[name="quotationAdjustmentReason"]',row);
    area.hidden=!differs&&!input.value.trim();input.required=differs;
  }
  function readRow(row){const source=snapshots.get(row);return source?{quotationSource:clone(source),quotationAdjustmentReason:$('[name="quotationAdjustmentReason"]',row).value}:{};}
  function open(context){
    const store=window.KuSheERPStore;
    if(!store.historicalQuotationChoices)throw new Error('報價引用程式未完整載入，請保留輸入後重新整理。');
    const quotes=store.historicalQuotationChoices(context.billingId),used=new Set(context.existing.filter(l=>l.quotationSource).map(l=>key(l.quotationSource)));
    const layer=document.createElement('div');layer.className='erp-detail-overlay historical-quote-overlay';
    layer.innerHTML='<section class="erp-detail-card historical-quote-card" role="dialog" aria-modal="true" aria-labelledby="historicalQuoteTitle"><header><div><span>僅帶入文件明細，不重新建帳</span><h2 id="historicalQuoteTitle">從報價單帶入</h2></div><button type="button" data-quote-close aria-label="關閉報價選取">×</button></header><div class="historical-quote-body"><p class="historical-help">只列同客戶、同案場的已確認報價。勾選後帶入項目、單位與單價；<b>原請款數量由你填寫</b>，不採用報價預估數量。</p><label class="historical-quote-select"><span>選擇適用報價｜目前補登為 '+esc(context.taxMode)+'單價</span><select data-quote-select aria-label="選擇適用報價"><option value="">請選擇報價單，不自動套用最新一張</option>'+quotes.map((q,i)=>'<option value="'+i+'">'+esc([q.number,q.date||'日期未填',q.taxMode||'稅別未填',q.rows.length+' 項'].join('｜'))+'</option>').join('')+'</select></label><p class="historical-quote-warning" data-quote-warning role="status" hidden></p><div class="historical-quote-tools"><input type="search" data-quote-search aria-label="搜尋報價項目" placeholder="搜尋品項或戶別" autocomplete="off"><button type="button" class="commission-secondary" data-quote-select-all>勾選本張可帶入項目</button><button type="button" class="commission-secondary" data-quote-clear>清除勾選</button></div><div data-quote-lines></div></div><footer><label class="historical-confirm"><input type="checkbox" data-quote-confirm><span>已核對所選報價適用於這張歷史請款，原請款數量仍需另外確認。</span></label><p data-quote-feedback class="billing-document-feedback" role="alert" hidden></p><div class="historical-quote-footer"><span data-quote-count>尚未勾選項目</span><button type="button" class="commission-secondary" data-quote-close>取消</button><button type="button" class="commission-primary" data-quote-append disabled>加入明細，接著填數量</button></div></footer></section>';
    const previousInert=context.parent.inert;context.parent.inert=true;document.body.append(layer);
    const select=$('[data-quote-select]',layer),host=$('[data-quote-lines]',layer),confirm=$('[data-quote-confirm]',layer),append=$('[data-quote-append]',layer),search=$('[data-quote-search]',layer);
    const selected=new Set();let quote=null,done=false,composing=false;
    const reason=row=>row.reason||(!row.source?'無法核對此項報價':row.source.taxMode!==context.taxMode?'稅別不同：請先返回補登表單核對單價方式':used.has(key(row.source))?'已帶入；同品項不同戶別請用「複製到另一戶」':'');
    const feedback=message=>{const node=$('[data-quote-feedback]',layer);node.textContent=message;node.hidden=!message};
    const refresh=()=>{$('[data-quote-count]',layer).textContent=selected.size?'已勾選 '+selected.size+' 項｜數量不會預填':'尚未勾選項目';append.disabled=done||!selected.size||!confirm.checked;};
    const filter=()=>{const term=search.value.trim().toLocaleLowerCase('zh-Hant');$$('[data-quote-option]',host).forEach(row=>row.hidden=Boolean(term&&!row.dataset.search.includes(term)));};
    function render(){
      selected.clear();confirm.checked=false;feedback('');search.value='';
      quote=select.value===''?null:quotes[Number(select.value)];
      const warning=$('[data-quote-warning]',layer);
      warning.textContent=quote?(quote.taxMode!==context.taxMode?'這張報價稅別與補登單價方式不同；不自動換算。請先返回表單核對。':quote.laterThanBill?'注意：報價日期晚於原請款日期，請確認它的品項與價格適用於原單。':''):'';warning.hidden=!warning.textContent;
      if(!quote){host.innerHTML='<p class="historical-empty">'+(quotes.length?'先選報價單，再勾選原請款使用的項目。':'沒有同客戶、同案場的已確認報價；請使用手動新增，不會套用其他案場價格。')+'</p>';refresh();return;}
      host.innerHTML=quote.rows.map((row,i)=>{const why=reason(row),source=row.source;return '<label class="historical-quote-option" data-quote-option data-search="'+esc((row.item+' '+(source?.house||'')).toLocaleLowerCase('zh-Hant'))+'"><input type="checkbox" data-quote-index="'+i+'" aria-label="選取品項 '+esc(row.lineNumber)+' '+esc(row.item)+'" '+(why?'disabled':'')+'><span><strong>'+esc(row.item||'未填項目')+'</strong><small>品項 '+row.lineNumber+(source?.house?'｜'+esc(source.house):'')+'｜'+esc(row.unit||'未填單位')+'</small>'+(why?'<small class="historical-quote-reason">'+esc(why)+'</small>':'')+'</span><b>'+(source?'$'+esc(decimal(source.price)):'待核對')+'</b></label>';}).join('')||'<p class="historical-empty">此報價沒有可辨識的明細。</p>';
      $$('[data-quote-index]',host).forEach(input=>input.onchange=()=>{if(input.checked)selected.add(Number(input.dataset.quoteIndex));else selected.delete(Number(input.dataset.quoteIndex));confirm.checked=false;refresh()});refresh();
    }
    const close=()=>{if(done)return;layer.remove();context.parent.inert=previousInert;context.trigger?.focus({preventScroll:true});};
    $$('[data-quote-close]',layer).forEach(b=>b.onclick=close);select.onchange=render;confirm.onchange=refresh;
    $('[data-quote-select-all]',layer).onclick=()=>{if(!quote)return;$$('[data-quote-index]:not(:disabled)',host).forEach(input=>{if(input.closest('[data-quote-option]').hidden)return;input.checked=true;selected.add(Number(input.dataset.quoteIndex))});confirm.checked=false;refresh();};
    $('[data-quote-clear]',layer).onclick=()=>{selected.clear();$$('[data-quote-index]',host).forEach(input=>input.checked=false);confirm.checked=false;refresh();};
    search.addEventListener('compositionstart',()=>composing=true);search.addEventListener('compositionend',()=>{composing=false;filter()});search.oninput=event=>{if(!composing&&!event.isComposing)filter()};
    append.onclick=()=>{
      if(append.disabled||done||!quote)return;
      try{
        const sources=[...selected].map(i=>quote.rows[i]).filter(row=>!reason(row)).map(row=>row.source);
        if(sources.length!==selected.size)throw new Error('部分選取項目已不能帶入，請重新核對。');
        const current=store.historicalQuotationChoices(context.billingId).flatMap(q=>q.rows).filter(r=>r.source).map(r=>JSON.stringify(r.source));
        if(sources.some(source=>!current.includes(JSON.stringify(source))))throw new Error('報價已更新或失效，未加入明細。請關閉選取視窗再重新核對。');
        context.append(sources.map(source=>({date:'',house:source.house,item:source.item,unit:source.unit,qty:'',price:source.price,quotationSource:clone(source),quotationAdjustmentReason:''})));
        done=true;layer.remove();context.parent.inert=previousInert;context.afterAppend?.();
      }catch(error){feedback(error.message||String(error))}
    };
    layer.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if(event.key==='Enter'&&event.target===search){event.preventDefault();return;}
      if(event.key==='Tab'){const nodes=$$('button,input,select',layer).filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    });
    render();select.focus({preventScroll:true});
  }
  window.KusheHistoricalQuotation=Object.freeze({open,bindRow,refreshRow,readRow});
}());
