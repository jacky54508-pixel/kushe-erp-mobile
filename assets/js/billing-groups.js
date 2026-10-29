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
    let tools=document.createElement('div');tools.className='bg-list-toolbar';
    const hasDocs=model.documents.length>0;
    tools.innerHTML=(kind==='billing'?'<button type="button" class="commission-primary" data-bg-create '+(context.selected().length<2?'disabled':'')+'>建立對外合併請款</button>':'')+(hasDocs?'<button type="button" class="commission-secondary" data-bg-library>合併文件（'+model.documents.length+'）</button><button type="button" class="commission-secondary" data-bg-mode aria-pressed="'+rawModes.has(kind)+'">'+(rawModes.has(kind)?'改看合併群組':'查看原始清單')+'</button>':'')+'<span>'+(hasDocs?'分組模式按整組篩選；群組合計不另加到帳款。':'先勾選同客戶的原請款；只新增對外文件，不重新建帳。')+'</span>';
    const place=$('.billing-bundle-toolbar',root)||$('.commission-filters',root)||$('.commissions-heading',root);place?.after(tools);
    $('[data-bg-create]',tools)?.addEventListener('click',()=>openEditor(context.selected().map(r=>String(r.id))));
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
    const previous=ctx.previous,m=modal(previous?'修訂對外合併請款':'建立對外合併請款','只保存文件與分組，不新增施工、發票或應收。'),token='external-ui-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const sources=ctx.sources,sections=previous?previous.sections:sources.map(defaultSection);
    m.body.innerHTML='<form id="externalBillingForm" novalidate><div class="bg-form-top"><label><span>對外顯示案場（選 A）</span><select name="targetBillingId" required><option value="">請選擇對外使用的案場</option>'+sources.map(s=>'<option value="'+esc(s.document.billingId)+'">'+esc(s.document.projectName)+'｜'+esc(s.document.number)+'</option>').join('')+'</select></label><label><span>文件日期</span><input name="documentDate" type="date" required value="'+esc(previous?.documentDate||today())+'"></label></div><details class="bg-anchors" open><summary>原帳款核對 · '+sources.length+' 張原單／發票各自保留</summary>'+originalTable(sources,ctx.totals)+'</details><p class="bg-help">下方只編排對外文件。每組必須對回自己的原金額；新明細取代該組的對外呈現，不會加計原明細第二次。</p><div data-bg-sections></div><label class="bg-note"><span>對外備註（會顯示在 PDF）</span><textarea name="note" rows="2" maxlength="2000">'+esc(previous?.note||'')+'</textarea></label><label class="bg-confirm"><input name="confirmed" type="checkbox"><span>已核對各組明細及原 A、B 發票金額；這只是合併請款文件，不是新增應收或新增工程。</span></label></form>';
    const form=$('form',m.body),host=$('[data-bg-sections]',form);if(window.matchMedia('(max-width:650px)').matches)$('.bg-anchors',form).open=false;form.elements.targetBillingId.value=previous?.targetBillingId||'';
    sections.forEach(section=>{
      const source=sources.find(s=>s.document.billingId===section.billingId),d=source.document,box=document.createElement('section');box.className='bg-source-section';box.dataset.source=section.billingId;
      box.innerHTML='<header><div><b>'+esc(d.projectName)+'</b><span>'+esc(d.number)+' · 原發票 '+esc(d.invoiceNo||'未填')+'</span></div><label><span>本組單價</span><select data-section-tax><option>未稅</option><option>含稅</option></select></label></header><div data-lines></div><div class="bg-section-tools"><button type="button" class="commission-secondary" data-add-line>＋ 新增對外品項</button><strong data-section-check></strong></div><label class="bg-note"><span>重編依據／說明（只供內部核對；品項、數量或單價與原單不同時必填）</span><textarea data-section-reason rows="2" maxlength="1000" placeholder="依實際工程內容及建設要求重新分類；不為湊金額任意改價。">'+esc(section.reason||'')+'</textarea></label>';
      $('[data-section-tax]',box).value=section.taxMode;
      (section.lines.length?section.lines:[{}]).forEach(line=>$('[data-lines]',box).insertAdjacentHTML('beforeend',lineMarkup(line)));
      host.append(box);
    });
    m.footer.innerHTML='<div class="bg-footer-totals"><span>原請款合計 <b>'+money(ctx.totals.grossTotal)+'</b></span><span>本期應收 <b>'+money(ctx.totals.receivable)+'</b></span><span>本期未沖銷 <b>'+money(ctx.totals.outstanding)+'</b></span></div><p class="bg-feedback" data-bg-feedback role="status" aria-live="polite" hidden></p><div class="bg-footer-actions"><span>只儲存文件，不重建帳務</span><button type="button" class="commission-secondary" data-bg-cancel>取消</button>'+(!previous||previous.status==='draft'?'<button type="button" class="commission-secondary" data-bg-draft>暫存草稿</button>':'')+'<button type="button" class="commission-primary" data-bg-save>'+(previous?.status==='active'?'確認保存新版本':'確認建立分組')+'</button></div>';
    const feedback=(message,error=false)=>{const n=$('[data-bg-feedback]',m.layer);n.textContent=message;n.hidden=!message;n.dataset.error=String(error)};
    let locked=false,saving=false;
    const read=()=>$$('.bg-source-section',host).map(box=>({billingId:box.dataset.source,taxMode:$('[data-section-tax]',box).value,reason:$('[data-section-reason]',box).value,lines:$$('.bg-line',box).map(row=>Object.fromEntries(['house','item','unit','qty','price'].map(key=>[key,$('[data-field="'+key+'"]',row).value])))}));
    function refresh(changed=false){
      if(changed){m.setDirty(true);form.elements.confirmed.checked=false}
      let valid=Boolean(form.elements.targetBillingId.value&&form.elements.documentDate.value);
      read().forEach(section=>{
        const box=$$('.bg-source-section',host).find(x=>x.dataset.source===section.billingId),d=sources.find(s=>s.document.billingId===section.billingId).document;
        let total=0,complete=section.lines.length>0;
        section.lines.forEach((l,i)=>{const v=Number(l.qty)*Number(l.price),okay=l.qty.trim()!==''&&l.price.trim()!==''&&Number.isFinite(v)&&Number(l.qty)>0&&Number(l.price)>=0&&l.item.trim()&&l.unit.trim();if(!okay)complete=false;const n=okay?Math.round(v):null;total+=n||0;$('[data-line-total]',$$('.bg-line',box)[i]).textContent=n===null?'—':money(n)});
        const shape=l=>({house:String(l.house||'').trim(),item:String(l.item||'').trim(),unit:String(l.unit||'').trim(),qty:l.qty===null||l.qty===''?null:Number(l.qty),price:l.price===null||l.price===''?null:Number(l.price)});
        const differs=section.taxMode!==d.taxMode||JSON.stringify(section.lines.map(shape))!==JSON.stringify(d.originalLines.map(shape));
        $('[data-section-reason]',box).closest('label').hidden=!differs&&!section.reason.trim();
        const target=section.taxMode==='未稅'?d.anchors.untaxed:d.anchors.grossTotal,node=$('[data-section-check]',box),difference=total-target;
        node.textContent='本組 '+money(total)+'／原'+section.taxMode+' '+money(target)+' · '+(difference===0&&complete?'一致':'差額 '+money(difference));node.dataset.match=String(difference===0&&complete);valid=valid&&complete&&difference===0;
      });
      $('[data-bg-save]',m.footer).disabled=saving||locked||!valid||!form.elements.confirmed.checked;
      const draft=$('[data-bg-draft]',m.footer);if(draft)draft.disabled=saving||locked;
    }
    form.addEventListener('input',event=>refresh(event.target!==form.elements.confirmed));form.addEventListener('change',event=>refresh(event.target!==form.elements.confirmed));
    form.addEventListener('click',event=>{const remove=event.target.closest('[data-line-remove]'),add=event.target.closest('[data-add-line]');if(remove){remove.closest('.bg-line').remove();refresh(true)}if(add){const lines=$('[data-lines]',add.closest('.bg-source-section'));lines.insertAdjacentHTML('beforeend',lineMarkup());refresh(true);$('[data-field="item"]',lines.lastElementChild).focus()}});
    form.onsubmit=event=>event.preventDefault();$('[data-bg-cancel]',m.footer).onclick=()=>m.close();
    async function save(status){
      if(saving||locked||status==='active'&&$('[data-bg-save]',m.footer).disabled)return;
      const values={documentId:id,sourceIds:ids.slice(),targetBillingId:form.elements.targetBillingId.value,documentDate:form.elements.documentDate.value,note:form.elements.note.value,sections:read(),status,confirmed:form.elements.confirmed.checked,expectedSnapshot:ctx.snapshot,idempotencyKey:token};
      saving=true;refresh();m.setBusy(true);feedback('正在保存文件，請勿重複送出。');
      try{await store.saveExternalBillingDocument(values)}catch(e){saving=false;m.setBusy(false);locked=e.transactionStatus==='RECOVERY_REQUIRED';feedback(locked?'儲存狀態待核對，請勿重送、清除資料或還原。':(e.message||String(e))+'；輸入仍保留。',true);refresh();return}
      saving=false;m.setBusy(false);m.setDirty(false);m.close(true);indexState=null;
      contextRender();window.KushePhase1?.toast(status==='active'?'對外分組已保存；原請款、發票與應收未變。':'文件草稿已保存；尚未套用清單分組。');
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
      const url=new URL('external-billing-print.html?v=p31-groups-1',location.href);url.hash=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
      if(url.href.length>1500000)throw new Error('文件內容過大，請減少對外明細後再匯出');
      const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener';document.body.append(a);a.click();a.remove();
    }catch(e){notifyError(e.message)}
  }
  window.KusheBillingGroups=Object.freeze({filterRows,mountList,activeFor,openEditor,openLibrary,printSaved});
}());
