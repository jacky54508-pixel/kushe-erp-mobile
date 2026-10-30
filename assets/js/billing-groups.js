(function () {
  'use strict';
  const store=window.KuSheERPStore;
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number.isFinite(v)?'$'+v.toLocaleString('zh-TW',{maximumFractionDigits:0}):'待核對';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const expand=new Set(),rawModes=new Set();
  let indexState=null,indexCache=null;
  function index(){const s=store.getState();if(s!==indexState){indexState=s;indexCache=store.externalBillingDocumentIndex()}return indexCache;}
  function memberId(row,kind){return String(row.id||'');}
  function memberKeys(g,kind){return g.sources.map(s=>kind==='billing'?s.document.billingId:s.document.receivableId);}
  function status(g,kind){const t=g.totals;if(t.outstanding>0)return t.received>0?'部分收款':'未收';return kind==='billing'?'已收':t.retentionOutstanding>0?'本期已收清':'全部收清';}
  function filterRows(rows,kind,filters,match){
    if(rawModes.has(kind)||kind==='receivable'&&filters.view==='employee_cash')return rows.filter(r=>match(r,filters));
    const groups=index().documents.filter(g=>g.canGroup),map=new Map();groups.forEach(g=>memberKeys(g,kind).forEach(id=>map.set(id,g)));
    const visited=new Set(),result=[];
    rows.forEach(row=>{
      const g=map.get(memberId(row,kind));if(!g){if(match(row,filters))result.push(row);return}
      if(visited.has(g.document.id))return;visited.add(g.document.id);
      const keys=new Set(memberKeys(g,kind)),members=rows.filter(r=>keys.has(memberId(r,kind))),t=g.totals;
      if(kind==='billing'&&filters.receipt&&status(g,kind)!==filters.receipt)return;
      if(kind==='receivable'){
        if(filters.view==='outstanding'&&t.outstanding<=0&&t.retentionOutstanding<=0)return;
        if(filters.view==='settled'&&(t.outstanding>0||t.retentionOutstanding>0))return;
        if(filters.status&&filters.status!==status(g,kind)&&!(filters.status==='本期已收清'&&t.outstanding===0))return;
      }
      // The group is a filter unit. Search any member/primary name and show its original members once.
      const f={...filters,view:'all',receipt:'',status:''};
      if(f.project){if(!g.sources.some(s=>s.document.projectId===f.project))return;f.project=''}
      const term=String(f.query||'').toLocaleLowerCase('zh-Hant');
      if(term&&g.document.displayProjectName.toLocaleLowerCase('zh-Hant').includes(term))f.query='';
      if(members.some(r=>match(r,f)))result.push(...members);
    });
    return result;
  }
  function activeFor(billingId){return index().documents.find(g=>g.canGroup&&g.document.sourceIds.includes(String(billingId)));}
  function statusText(g){return g.totals.outstanding>0?(g.totals.received>0?'部分收款':'待收款'):g.totals.retentionOutstanding>0?'本期收清・保留款待收':'全部收清';}
  function groupSummary(g,kind){
    const d=g.document,t=g.totals;
    return '<div class="bg-heading"><div><span class="bg-eyebrow">對外合併請款 · '+d.sourceIds.length+' 張原單</span><h3>'+esc(d.displayProjectName)+'</h3><p>'+esc(d.customerName)+'｜發票各自保留</p></div><div class="bg-amount"><small>本期未沖銷</small><strong>'+money(t.outstanding)+'</strong><span class="bg-state">'+statusText(g)+'</span></div></div><div class="bg-stats"><span>原請款合計 <b>'+money(t.grossTotal)+'</b></span><span>本期應收 <b>'+money(t.receivable)+'</b></span>'+(t.retentionOutstanding?'<span>保留款待收 <b>'+money(t.retentionOutstanding)+'</b></span>':'')+(t.pendingCheque?'<span>待兌現預留 <b>'+money(t.pendingCheque)+'</b></span>':'')+'</div>'+(g.termsChanged?'<p class="bg-warning">原單內容已變動；請核對修訂後再出本次文件。</p>':g.settlementChanged?'<p class="bg-info">收款狀態已更新；列表為即時餘額，重新出單前請修訂確認。</p>':'')+'<div class="bg-actions"><button type="button" class="commission-secondary" data-bg-expand aria-expanded="false">展開原單</button><button type="button" class="commission-secondary" data-bg-edit>對外明細</button><button type="button" class="commission-primary" data-bg-pdf>PDF</button><span>第 '+d.revision+' 版｜不另計一筆應收</span></div>';
  }
  function wireGroup(box,g,kind,content){
    const key=kind+':'+g.document.id,button=$('[data-bg-expand]',box);
    const update=()=>{const opened=expand.has(key);content.hidden=!opened;button.setAttribute('aria-expanded',String(opened));button.textContent=opened?'收合原單':'展開原單（'+g.document.sourceIds.length+' 張）';};
    button.onclick=()=>{if(expand.has(key))expand.delete(key);else expand.add(key);update()};update();
    $('[data-bg-edit]',box).onclick=()=>openEditor(g.document.sourceIds,g.document.id);
    $('[data-bg-pdf]',box).onclick=()=>printSaved(g.document.id);
  }
  function mountList(root,kind,context){
    if(!root)return;
    const model=index(),groups=model.documents.filter(g=>g.canGroup);
    // P31-2: billing owns the permanent create button. Only document navigation
    // is attached here; mount can be repeated without duplicating the toolbar.
    const integrated=kind==='billing'?$('[data-bg-document-tools]',root):null;
    let tools=integrated||$('.bg-list-toolbar',root),place=$('.billing-bundle-toolbar',root)||$('.commission-filters',root)||$('.commissions-heading',root);
    if(!tools){tools=document.createElement('div');tools.className='bg-list-toolbar';place?.after(tools)}
    const hasDocs=model.documents.length>0;
    tools.innerHTML=(hasDocs?'<button type="button" class="commission-secondary" data-bg-library>合併文件（'+model.documents.length+'）</button><button type="button" class="commission-secondary" data-bg-mode aria-pressed="'+rawModes.has(kind)+'">'+(rawModes.has(kind)?'改看合併群組':'查看原始清單')+'</button>':'')+'<span>'+(hasDocs?'分組模式按整組篩選；群組合計不另加到帳款。':'先勾選同客戶的原請款；只新增對外文件，不重新建帳。')+'</span>';
    tools.hidden=Boolean(integrated&&!hasDocs);
    $('[data-bg-library]',tools)?.addEventListener('click',openLibrary);
    $('[data-bg-mode]',tools)?.addEventListener('click',()=>{if(rawModes.has(kind))rawModes.delete(kind);else rawModes.add(kind);context.render()});
    if(model.issues.length){const warning=document.createElement('p');warning.className='bg-warning';warning.textContent=model.issues.join('；')+'。未能安全分組的原單仍分別顯示。';tools.after(warning)}
    // A grouped original cannot be selected as another ad-hoc PDF or another active document.
    if(kind==='billing')$$('[data-billing-bundle-select]',root).forEach(input=>{
      const g=activeFor(input.dataset.billingBundleSelect);if(!g)return;input.checked=false;input.disabled=true;input.title='已納入 '+g.document.displayProjectName+' 的合併文件；請由群組修訂或重印';
      const cell=input.closest('td')||input.closest('label');if(cell&&!$('[data-bg-membership]',cell)){const note=document.createElement('small');note.dataset.bgMembership='';note.className='bg-membership';note.textContent='已分組';cell.append(note)}
    });
    if(rawModes.has(kind)||kind==='receivable'&&context.employeeCash)return;
    const selector=kind==='billing'?'.billing-list-table>tbody':'.receivable-table>tbody',body=$(selector,root);
    if(body)groups.forEach(g=>{
      const ids=new Set(memberKeys(g,kind)),rows=Array.from(body.children).filter(row=>{
        const id=kind==='billing'?$('[data-billing-detail]',row)?.dataset.billingDetail:row.dataset.expandReceivable;return ids.has(id);
      });
      if(!rows.length)return;
      const extra=[];rows.forEach(row=>{if(row.nextElementSibling?.classList.contains('receipt-history-row'))extra.push(row.nextElementSibling)});
      const wrapper=document.createElement('tr');wrapper.className='bg-group-row';wrapper.dataset.bgGroup=g.document.id;
      const td=document.createElement('td');td.colSpan=Math.max(1,rows[0].children.length);wrapper.append(td);
      const box=document.createElement('section');box.className='bg-group';box.innerHTML=groupSummary(g,kind);td.append(box);
      const content=document.createElement('div');content.className='bg-originals';content.hidden=true;
      const note=document.createElement('p');note.className='bg-info';note.textContent='以下是原帳款，不是新增帳款。收款／支票／保留款仍逐原單處理。';content.append(note);
      const scroll=document.createElement('div');scroll.className='bg-original-table-scroll';const table=document.createElement('table');table.className=body.parentElement.className;
      const head=body.parentElement.querySelector(':scope>thead');if(head)table.append(head.cloneNode(true));const inner=document.createElement('tbody');table.append(inner);scroll.append(table);content.append(scroll);box.append(content);
      rows[0].before(wrapper);rows.forEach(row=>{const detail=row.nextElementSibling;inner.append(row);if(extra.includes(detail))inner.append(detail)});
      wireGroup(box,g,kind,content);
    });
    groups.forEach(g=>{
      const ids=new Set(memberKeys(g,kind));
      const cards=kind==='billing'?$$('.mobile-billing-card',root).filter(card=>ids.has($('[data-billing-detail]',card)?.dataset.billingDetail)):$$('[data-mobile-receivable]',root).filter(card=>ids.has(card.dataset.mobileReceivable));
      if(!cards.length)return;
      const box=document.createElement('article');box.className='bg-group bg-group-mobile';box.dataset.bgGroup=g.document.id;box.innerHTML=groupSummary(g,kind);
      const content=document.createElement('div');content.className='bg-originals';content.hidden=true;box.append(content);cards[0].before(box);cards.forEach(card=>content.append(card));wireGroup(box,g,kind,content);
    });
  }
  function modal(title,subtitle){
    const layer=document.createElement('div');layer.className='erp-detail-overlay bg-overlay';
    layer.innerHTML='<section class="erp-detail-card bg-dialog" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header><div><span>對外文件 · 原帳款不變</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle||'')+'</p></div><button type="button" data-bg-close aria-label="關閉">×</button></header><div class="bg-body"></div><footer class="bg-footer"></footer></section>';
    const underlying=$$('.erp-detail-overlay').map(node=>[node,node.inert]);underlying.forEach(([node])=>node.inert=true);
    const previous=document.activeElement;let busy=false,dirty=false,closed=false;
    function close(force=false){if(busy&&!force)return false;if(!force&&dirty&&!window.confirm('尚未儲存的對外明細將不保留，確定關閉？'))return false;closed=true;layer.remove();underlying.forEach(([node,inert])=>{if(node.isConnected)node.inert=inert});previous?.isConnected&&previous.focus({preventScroll:true});return true;}
    document.body.append(layer);$('[data-bg-close]',layer).onclick=()=>close();
    layer.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}if(e.key==='Tab'){const a=$$('input,textarea,select,button,a',layer).filter(n=>!n.disabled&&n.getClientRects().length),first=a[0],last=a.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
    return {layer,body:$('.bg-body',layer),footer:$('.bg-footer',layer),close,isClosed:()=>closed,setDirty:v=>dirty=v,setBusy:v=>{busy=v;layer.inert=v}};
  }
  function notifyError(message){window.KushePhase1?.toast(message)}
  function originalTable(sources,totals){
    return '<div class="bg-original-table-scroll"><table class="bg-anchor-table"><thead><tr><th>原案場／單號</th><th>原發票</th><th>原含稅金額</th><th>本期應收</th><th>已沖銷</th><th>本期未沖銷</th></tr></thead><tbody>'+sources.map(s=>{const d=s.document,p=s.settlement;return '<tr><td><b>'+esc(d.projectName)+'</b><small>'+esc(d.number)+'</small></td><td>'+esc(d.invoiceNo||'尚無票號')+'<small>原金額 '+money(d.anchors.grossTotal)+'</small></td><td>'+money(d.anchors.grossTotal)+'</td><td>'+money(d.anchors.receivable)+'</td><td>'+money(p.received)+'</td><td>'+money(p.outstanding)+'</td></tr>'}).join('')+'</tbody></table></div><p class="bg-info">原未稅 '+money(totals.untaxed)+' ＋原稅額 '+money(totals.tax)+' ＝原含稅 '+money(totals.grossTotal)+'。保留款沿用各原單，不套用 A 的比例重算 B。</p>';
  }
  function defaultSection(s){
    const d=s.document,lines=d.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,qty:l.qty,price:l.price}));
    return {billingId:d.billingId,taxMode:d.taxMode,lines:lines.length?lines:[{house:'',item:'',unit:'',qty:null,price:null}],reason:''};
  }
  function lineMarkup(l={}){
    return '<div class="bg-line">'+[['house','戶別／位置','text'],['item','對外施工品項','text'],['unit','單位','text'],['qty','數量','number'],['price','單價','number']].map(([key,label,type])=>'<label class="bg-'+key+'"><span>'+label+'</span><input data-field="'+key+'" aria-label="'+label+'" type="'+type+'" value="'+esc(l[key]??'')+'" '+(type==='number'?'min="'+(key==='qty'?'0.0001':'0')+'" step="0.0001" inputmode="decimal"':'maxlength="'+(key==='item'?200:key==='unit'?20:100)+'"')+'></label>').join('')+'<div class="bg-subtotal"><span>小計</span><b data-line-total></b></div><button type="button" class="bg-remove" data-line-remove aria-label="移除此筆對外明細">移除</button></div>';
  }
  function openEditor(ids,id=''){
    let ctx;try{ctx=store.externalBillingContext(ids,id)}catch(e){notifyError(e.message);return}
    const previous=ctx.previous,m=modal(previous?'修訂對外合併請款':'建立對外合併請款','統一編排一張對外明細；原請款、發票與應收各自保留。'),token='external-ui-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const sources=ctx.sources,isUnified=previous?.schema==='kushe-external-billing-group-v2';
    // Opening an old document is read-only. Conversion exists only in this unsaved form.
    const legacySections=previous&&!isUnified&&Array.isArray(previous.sections)?previous.sections:[];
    const mixedLegacy=legacySections.length>0&&new Set(legacySections.map(s=>s.taxMode)).size>1;
    const initial=isUnified?copy(previous.unified):legacySections.length&&!mixedLegacy?{taxMode:legacySections[0].taxMode,lines:legacySections.flatMap(s=>copy(s.lines)),reason:legacySections.map(s=>s.reason?((sources.find(x=>x.document.billingId===s.billingId)?.document.projectName||'原單')+'：'+s.reason):'').filter(Boolean).join('\n')}:{taxMode:mixedLegacy?'':'未稅',lines:[],reason:''};
    const legacyNote=legacySections.length?'<p class="bg-info" data-bg-legacy-note>'+ (mixedLegacy?'舊版明細含不同單價方式，不會混加或自動換算。原版本完整保留；請先選統一單價方式，再依原資料編排。':'舊版各區明細已完整放入同一張草稿，未自動刪列或合併數量。請核對重複項目；只有保存後才建立新版，舊版本仍保留。')+'</p>':'';
    m.body.innerHTML='<form id="externalBillingForm" novalidate><div class="bg-form-top"><label><span>對外顯示案場（選 A）</span><select name="targetBillingId" required><option value="">請選擇對外使用的案場</option>'+sources.map(s=>'<option value="'+esc(s.document.billingId)+'">'+esc(s.document.projectName)+'｜'+esc(s.document.number)+'</option>').join('')+'</select></label><label><span>文件日期</span><input name="documentDate" type="date" required value="'+esc(previous?.documentDate||today())+'"></label></div><details class="bg-anchors"><summary>原帳款核對（唯讀） · '+sources.length+' 張原單／發票金額不變</summary>'+originalTable(sources,ctx.totals)+'</details>'+legacyNote+(mixedLegacy?'<details class="bg-anchors"><summary>查看舊版明細（唯讀，不加入本次合計）</summary>'+legacySections.map(s=>'<p class="bg-info">'+esc(sources.find(x=>x.document.billingId===s.billingId)?.document.projectName||'原單')+'｜'+esc(s.taxMode)+'</p><ul>'+s.lines.map(l=>'<li>'+esc([l.house,l.item,l.unit,l.qty,l.price].join('｜'))+'</li>').join('')+'</ul>').join('')+'</details>':'')+'<section class="bg-source-section bg-unified" data-bg-unified><header><div><b>對外施工明細</b><span>整份核對 A＋B，不再分區填兩次。</span></div><label><span>整份單價</span><select name="detailTaxMode" aria-label="整份單價方式"><option value="">請選擇</option><option>未稅</option><option>含稅</option></select></label></header><p class="bg-help">已有品項直接改數量；不同品項才新增一列。下方明細只計一次，不會把 B 原明細再加一次。</p><div class="bg-unified-tools"><button type="button" class="commission-secondary" data-bg-use-primary disabled>沿用 A 原品項</button><span data-bg-seed-note role="status">先選對外案場；依實際工程內容編排，不自動湊數量。</span></div><div data-bg-unified-lines></div><div class="bg-section-tools"><button type="button" class="commission-secondary" data-add-line>＋ 新增對外品項</button><span data-bg-line-count></span></div><label class="bg-note"><span>合併編排說明（內部核對用；與原明細不同時必填）</span><textarea name="detailReason" rows="2" maxlength="1000" placeholder="例如：依建設核對的實際工程，合併相同品項數量；原 A、B 發票金額不變。">'+esc(initial.reason||'')+'</textarea></label></section><label class="bg-note"><span>對外備註（會顯示在 PDF）</span><textarea name="note" rows="2" maxlength="2000">'+esc(previous?.note||'')+'</textarea></label><label class="bg-confirm"><input name="confirmed" type="checkbox"><span>已核對整份對外明細合計與 A＋B 原帳款，品項及數量符合實際工程；原發票金額不變。</span></label></form>';
    const form=$('form',m.body),host=$('[data-bg-unified-lines]',form),tax=form.elements.detailTaxMode,reason=form.elements.detailReason;
    form.elements.targetBillingId.value=previous?.targetBillingId||'';tax.value=initial.taxMode;
    if(previous)$('[data-bg-seed-note]',form).textContent='已載入保存明細；可直接修改。按「沿用 A 原品項」才會替換目前草稿。';
    (initial.lines.length?initial.lines:[{}]).forEach(line=>host.insertAdjacentHTML('beforeend',lineMarkup(line)));
    m.footer.innerHTML='<div class="bg-unified-check" role="status" aria-live="polite"><span>對外明細合計 <b data-bg-total></b></span><span data-bg-target-label>原單未稅合計 <b data-bg-target></b></span><strong data-bg-difference></strong></div><div class="bg-footer-totals"><span>原含稅請款 <b>'+money(ctx.totals.grossTotal)+'</b></span><span>本期未沖銷 <b>'+money(ctx.totals.outstanding)+'</b></span><span>原發票稅額 <b>'+money(ctx.totals.tax)+'</b></span></div><p class="bg-validation" id="externalBillingValidation" data-bg-validation role="status"></p><p class="bg-feedback" data-bg-feedback role="status" aria-live="polite" hidden></p><div class="bg-footer-actions"><span>只儲存文件，不重建帳務</span><button type="button" class="commission-secondary" data-bg-cancel>取消</button>'+(!previous||previous.status==='draft'?'<button type="button" class="commission-secondary" data-bg-draft>暫存草稿</button>':'')+'<button type="button" class="commission-primary" data-bg-save aria-describedby="externalBillingValidation">'+(previous?.status==='active'?'確認保存新版本':'確認建立分組')+'</button></div>';
    const feedback=(message,error=false)=>{const n=$('[data-bg-feedback]',m.layer);n.textContent=message;n.hidden=!message;n.dataset.error=String(error)};
    const read=()=>({taxMode:tax.value,reason:reason.value,lines:$$('.bg-line',host).map(row=>Object.fromEntries(['house','item','unit','qty','price'].map(key=>[key,$('[data-field="'+key+'"]',row).value])))});
    let locked=false,saving=false,hasSeeded=Boolean(previous);
    const shape=l=>({house:String(l.house||'').trim(),item:String(l.item||'').trim(),unit:String(l.unit||'').trim(),qty:l.qty===null||String(l.qty??'').trim()===''?null:Number(l.qty),price:l.price===null||String(l.price??'').trim()===''?null:Number(l.price)});
    const validNumber=(v,qty)=>v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&(!qty||Number(v)>0)&&Number(v)<=1e10&&Math.abs(Number(v)*10000-Math.round(Number(v)*10000))<=0.001;
    function refresh(changed=false){
      if(changed){m.setDirty(true);form.elements.confirmed.checked=false}
      const detail=read(),issues=[];let total=0,complete=detail.lines.length>0&&detail.lines.length<=300;
      if(!form.elements.targetBillingId.value)issues.push('選擇對外案場');
      if(!form.elements.documentDate.value||!form.elements.documentDate.validity.valid)issues.push('填寫有效文件日期');
      if(!['未稅','含稅'].includes(detail.taxMode))issues.push('選擇整份單價方式');
      if(detail.lines.length>300)issues.push('整份最多 300 列');
      detail.lines.forEach((line,i)=>{
        const okay=validNumber(line.qty,true)&&validNumber(line.price,false)&&line.item.trim()&&line.unit.trim()&&line.item.length<=200&&line.unit.length<=20&&line.house.length<=100;
        const n=okay?Math.round(Number(line.qty)*Number(line.price)):null,safe=n!==null&&Number.isSafeInteger(n);if(!safe)complete=false;
        total+=safe?n:0;$('[data-line-total]',$$('.bg-line',host)[i]).textContent=safe?money(n):'—';
      });
      if(!Number.isSafeInteger(total)){complete=false;issues.push('金額超過安全範圍')}
      const target=detail.taxMode==='未稅'?ctx.totals.untaxed:detail.taxMode==='含稅'?ctx.totals.grossTotal:null,difference=target===null?null:total-target;
      $('[data-bg-total]',m.footer).textContent=Number.isSafeInteger(total)?money(total):'待核對';
      $('[data-bg-target-label]',m.footer).innerHTML='原單'+esc(detail.taxMode||'')+'合計 <b data-bg-target>'+(target===null?'待選單價方式':money(target))+'</b>';
      const check=$('[data-bg-difference]',m.footer);check.textContent=difference===null?'請選單價方式':difference===0?(complete?'金額一致':'尚有未完成品項'):'差額 '+money(difference);check.dataset.match=String(difference===0&&complete);
      if(!complete)issues.push('填完整品項、單位、有效數量及單價');
      if(difference!==null&&difference!==0)issues.push('核對差額 '+money(difference));
      const originals=sources.flatMap(s=>s.document.originalLines.map(shape));
      const differs=!sources.every(s=>s.document.taxMode===detail.taxMode)||JSON.stringify(detail.lines.map(shape))!==JSON.stringify(originals);
      reason.required=differs;if(differs&&!detail.reason.trim())issues.push('填寫合併編排說明');
      if(detail.reason.length>1000||form.elements.note.value.length>2000)issues.push('說明或備註超過字數限制');
      if(!form.elements.confirmed.checked)issues.push('勾選已核對');
      const validation=$('[data-bg-validation]',m.footer);validation.textContent=issues.length?'待完成：'+issues.join('；'):'已核對整份合計，可以保存；原帳款不變。';validation.dataset.valid=String(!issues.length);
      $('[data-bg-line-count]',form).textContent=detail.lines.length+' 筆對外品項';
      $('[data-bg-save]',m.footer).disabled=saving||locked||issues.length>0;
      $('[data-bg-use-primary]',form).disabled=saving||locked||!form.elements.targetBillingId.value;
      const draft=$('[data-bg-draft]',m.footer);if(draft)draft.disabled=saving||locked||!form.elements.targetBillingId.value||!form.elements.documentDate.value||!tax.value;
    }
    function seedPrimary(force=false){
      const source=sources.find(s=>s.document.billingId===form.elements.targetBillingId.value);if(!source)return;
      const filled=read().lines.some(l=>Object.values(l).some(v=>String(v).trim()!==''));
      if(force&&filled&&!window.confirm('這只會替換下方尚未保存的對外明細，改用所選 A 原品項；原帳款與舊文件版本不變。確定替換？'))return;
      const d=source.document;host.replaceChildren();tax.value=d.taxMode;
      (d.originalLines.length?d.originalLines:[{}]).forEach(l=>host.insertAdjacentHTML('beforeend',lineMarkup(l)));
      hasSeeded=true;$('[data-bg-seed-note]',form).textContent=d.originalLines.length?'已沿用 '+d.projectName+' 的 '+d.originalLines.length+' 筆原品項。請依實際工程調整到整份合計；B 不會再自動加入。':'此原單沒有施工明細，請依原始資料填寫；不自動編造一式或數量。';refresh(true);
    }
    form.elements.targetBillingId.addEventListener('change',()=>{
      const empty=read().lines.every(l=>Object.values(l).every(v=>String(v).trim()===''));
      if(!hasSeeded&&empty)seedPrimary();else{hasSeeded=true;$('[data-bg-seed-note]',form).textContent='對外案場已選擇；現有明細完整保留。需要替換時才按「沿用 A 原品項」。';refresh(true)}
    });
    $('[data-bg-use-primary]',form).onclick=()=>seedPrimary(true);
    tax.addEventListener('change',()=>{$('[data-bg-seed-note]',form).textContent='單價方式已變更，現有單價與數量沒有換算。請依原始資料重新核對。'});
    form.addEventListener('input',event=>refresh(event.target!==form.elements.confirmed));form.addEventListener('change',event=>refresh(event.target!==form.elements.confirmed));
    form.addEventListener('click',event=>{const remove=event.target.closest('[data-line-remove]'),add=event.target.closest('[data-add-line]');if(remove){remove.closest('.bg-line').remove();refresh(true)}if(add){if($$('.bg-line',host).length>=300){feedback('整份文件最多 300 筆對外明細；原輸入保持原樣。',true);return}host.insertAdjacentHTML('beforeend',lineMarkup());refresh(true);$('[data-field="item"]',host.lastElementChild).focus()}});
    form.onsubmit=event=>event.preventDefault();$('[data-bg-cancel]',m.footer).onclick=()=>m.close();
    async function save(status){
      if(saving||locked)return;refresh();if(status==='active'&&$('[data-bg-save]',m.footer).disabled)return;
      const values={documentId:id,sourceIds:ids.slice(),targetBillingId:form.elements.targetBillingId.value,documentDate:form.elements.documentDate.value,note:form.elements.note.value,detailMode:'unified',unified:read(),status,confirmed:form.elements.confirmed.checked,expectedSnapshot:ctx.snapshot,idempotencyKey:token};
      saving=true;refresh();m.setBusy(true);feedback('正在保存文件，請勿重複送出。');
      try{await store.saveExternalBillingDocument(values)}catch(e){saving=false;m.setBusy(false);locked=e.transactionStatus==='RECOVERY_REQUIRED';feedback(locked?'儲存狀態待核對，請勿重送、清除資料或還原。':(e.message||String(e))+'；輸入仍保留。',true);refresh();return}
      saving=false;m.setBusy(false);m.setDirty(false);m.close(true);indexState=null;
      contextRender();window.KushePhase1?.toast(status==='active'?'對外統一明細已保存；原 A、B 請款、發票與應收未變。':'統一明細草稿已保存；尚未套用清單分組。');
    }
    $('[data-bg-save]',m.footer).onclick=()=>save('active');$('[data-bg-draft]',m.footer)?.addEventListener('click',()=>save('draft'));
    if(previous?.status==='active'){
      const archive=document.createElement('button');archive.type='button';archive.className='commission-secondary bg-archive';archive.textContent='解除分組（原單不刪除）';archive.onclick=()=>{if(!m.close())return;archiveDocument(id)};m.body.append(archive);
      const versions=document.createElement('details');versions.className='bg-versions';versions.innerHTML='<summary>版本紀錄（'+(previous.history.length+1)+' 版）</summary>'+[...previous.history,previous].map(v=>'<p>第 '+v.revision+' 版 · '+esc(v.updatedAt)+' · '+(v.status==='active'?'已確認':'草稿')+(v.status==='active'?'<button type="button" class="commission-secondary" data-version="'+v.revision+'">查看保存版本</button>':'')+'</p>').join('');m.body.append(versions);$$('[data-version]',versions).forEach(b=>b.onclick=()=>printSaved(id,Number(b.dataset.version),true));
    }
    refresh();requestAnimationFrame(()=>form.elements.targetBillingId.focus({preventScroll:true}));
  }
  function contextRender(){window.KusheBilling?.render();window.KusheReceivables?.render()}
  function openLibrary(){
    const data=index(),m=modal('合併文件','草稿不分組；解除只還原清單呈現，不刪任何原帳。');
    m.body.innerHTML=data.documents.map(g=>{const d=g.document;return '<article class="bg-library-row"><div><b>'+esc(d.displayProjectName)+'</b><span>'+esc(d.documentDate)+'｜'+(d.status==='active'?'已確認分組':d.status==='draft'?'草稿':'已解除')+'｜第 '+d.revision+' 版</span>'+(g.issues.length?'<small>'+esc(g.issues.join('；'))+'</small>':'')+'</div><div>'+(d.status!=='archived'?'<button type="button" class="commission-secondary" data-edit="'+esc(d.id)+'">開啟</button><button type="button" class="commission-secondary" data-archive="'+esc(d.id)+'">解除</button>':'')+(d.status!=='draft'?'<button type="button" class="commission-secondary" data-preview="'+esc(d.id)+'">保存版本</button>':'')+'</div></article>'}).join('')||'<p>尚無合併文件。</p>';
    $$('[data-edit]',m.body).forEach(b=>b.onclick=()=>{const d=data.documents.find(g=>g.document.id===b.dataset.edit).document;m.close();openEditor(d.sourceIds,d.id)});
    $$('[data-archive]',m.body).forEach(b=>b.onclick=()=>{m.close();archiveDocument(b.dataset.archive)});
    $$('[data-preview]',m.body).forEach(b=>b.onclick=()=>printSaved(b.dataset.preview,0,true));
  }
  function archiveDocument(id){
    const g=index().documents.find(g=>g.document.id===id);if(!g)return;
    const m=modal('解除對外分組','A、B 原單恢復各自顯示；不刪帳、不撤銷發票，也不撤銷已送出的文件。');
    m.body.innerHTML='<p>'+esc(g.document.displayProjectName)+'｜'+g.document.sourceIds.length+' 張原單</p><label class="bg-note"><span>解除原因</span><textarea rows="3" maxlength="500" data-reason></textarea></label><label class="bg-confirm"><input type="checkbox" data-confirm><span>已確認這是解除畫面分組，原請款與發票均保留。</span></label>';
    m.footer.innerHTML='<p class="bg-feedback" data-error></p><div class="bg-footer-actions"><button type="button" class="commission-secondary" data-cancel>取消</button><button type="button" class="commission-primary" data-confirm-archive disabled>確認解除</button></div>';
    const button=$('[data-confirm-archive]',m.footer);m.body.oninput=()=>{button.disabled=!$('[data-reason]',m.body).value.trim()||!$('[data-confirm]',m.body).checked};$('[data-cancel]',m.footer).onclick=()=>m.close();
    button.onclick=async()=>{if(button.disabled)return;m.setBusy(true);try{await store.archiveExternalBillingDocument(id,{expectedDocument:g.documentSnapshot,reason:$('[data-reason]',m.body).value,confirmed:true});m.setBusy(false);m.close(true);indexState=null;contextRender()}catch(e){m.setBusy(false);$('[data-error]',m.footer).textContent=e.message;if(e.transactionStatus==='RECOVERY_REQUIRED')button.disabled=true}};
  }
  function printSaved(id,revision=0,historyOnly=false){
    const g=index().documents.find(g=>g.document.id===id);if(!g)return;
    const d=revision?[...g.document.history,g.document].find(d=>d.revision===revision):g.document;
    if(!d||d.status==='draft'){notifyError('草稿尚未確認，不能作為正式請款文件');return}
    const historical=historyOnly||g.document.status!=='active'||revision&&revision!==g.document.revision;
    if(!historical&&(g.issues.length||g.termsChanged||g.settlementChanged)){notifyError('原單或收款狀態已更新，請先開啟「對外明細」核對保存新版本；舊版仍可在版本紀錄查看。');return}
    try{
      const payload={schema:'kushe-external-billing-print-v1',historical:Boolean(historical),document:copy(d)};delete payload.document.history;delete payload.document.lastRequestFingerprint;delete payload.document.lastRequestKey;
      // P31-4: current documents reuse the selected original's public template only.
      // This read-only projection never changes the original bill or the saved group.
      if(!historical){
        const primary=store.getState().billings.find(row=>String(row.id)===d.targetBillingId);
        if(!primary||!window.KusheBillingPrint?.buildExternalView)throw new Error('原請款列印模組未完整載入，請保留輸入後重新整理；未修改帳款');
        const view=window.KusheBillingPrint.buildExternalView(primary);
        payload.template={schema:'kushe-original-billing-template-v1',billingId:d.targetBillingId,company:copy(view.company),publicNote:view.publicNote||'',historicalDetails:view.lines.some(line=>line.sourcePricingType==='historical-supplement')};
      }
      const url=new URL('external-billing-print.html?v=p31-4-original-template-1',location.href);url.hash=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
      if(url.href.length>1500000)throw new Error('文件內容過大，請減少對外明細後再匯出');
      const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener';document.body.append(a);a.click();a.remove();
    }catch(e){notifyError(e.message)}
  }
  window.KusheBillingGroups=Object.freeze({filterRows,mountList,activeFor,openEditor,openLibrary,printSaved});
  window.dispatchEvent(new CustomEvent('kushe:billing-groups-ready'));
}());
