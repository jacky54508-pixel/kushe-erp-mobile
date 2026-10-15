(function () {
  'use strict';
  // P29-5: draft selection only. Store remains the sole authority for eligibility and payment.
  const $=(s,r)=>r.querySelector(s), $$=(s,r)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>'$'+Number(v||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
  const text=v=>String(v??'').trim();
  const compare=(a,b)=>text(a).localeCompare(text(b),'zh-Hant',{numeric:true});
  const total=rows=>rows.reduce((sum,row)=>sum+Math.max(0,Number(row.amount)||0),0);
  const arrow='<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function groups(plan,data){
    const projects=new Map((data.projects||[]).map(row=>[text(row.id),row])),customers=new Map((data.customers||[]).map(row=>[text(row.id),row.name]));
    const byProject=new Map();
    for(const [kind,rows] of [['available',plan.available||[]],['locked',plan.locked||[]]]){
      rows.forEach((row,index)=>{
        // Never group by display names or house names. Missing identities stay separate.
        const key=text(row.projectId)?JSON.stringify(['project',text(row.projectId)]):JSON.stringify(['source',kind,text(row.allocationKey)||index]);
        const project=projects.get(text(row.projectId));
        if(!byProject.has(key))byProject.set(key,{key,project:text(row.projectName)||text(project?.name)||'未指定案場',customer:text(row.customerName)||text(customers.get(text(row.customerId)||text(project?.customer))),available:[],locked:[]});
        const group=byProject.get(key);if(!group.customer&&row.customerName)group.customer=text(row.customerName);
        if(group.project==='未指定案場'&&row.projectName)group.project=text(row.projectName);
        group[kind].push(row);
      });
    }
    return [...byProject.values()].sort((a,b)=>Number(!a.available.length)-Number(!b.available.length)||compare(a.customer,b.customer)||compare(a.project,b.project)||compare(a.key,b.key));
  }
  function rowsHtml(rows,selectable){
    const byBill=new Map();
    rows.forEach((row,index)=>{
      const ids=[...new Set((row.billingIds||[]).map(text).filter(Boolean))].sort();
      const key=ids.length?JSON.stringify(ids):JSON.stringify(['source',text(row.allocationKey)||index]);
      if(!byBill.has(key))byBill.set(key,{numbers:(row.billingNumbers||[]).join('、')||'尚無可核對請款單',rows:[]});
      byBill.get(key).rows.push(row);
    });
    return [...byBill.values()].sort((a,b)=>compare(a.numbers,b.numbers)).map(bill=>'<section class="cp-bill"><h4>請款單 '+esc(bill.numbers)+'</h4><div class="cp-source-list">'+bill.rows.slice().sort((a,b)=>compare(a.house,b.house)||compare(a.date,b.date)||compare(a.allocationKey,b.allocationKey)).map(row=>{
      const title=[text(row.house)||'未指定戶別',text(row.date),text(row.sourceNo)||text(row.commissionId)].filter(Boolean).join(' · ');
      const body='<span class="cp-source-house"><b>'+esc(row.house||'未指定戶別')+'</b><small>'+esc([row.date,row.sourceNo].filter(Boolean).join(' · ')||'施工來源')+'</small></span>'+(selectable?'':'<span class="cp-lock-reason">'+esc(row.releaseStatus||'待核對')+'</span>')+'<strong>'+money(row.amount)+'</strong>';
      return selectable?'<label class="cp-source-row" title="'+esc(title)+'"><span class="cp-check-target"><input type="checkbox" name="commissionSelection" value="'+esc(row.allocationKey)+'" aria-label="選取 '+esc(title)+' 抽成 '+money(row.amount)+'"></span>'+body+'</label>':'<div class="cp-source-row cp-source-locked" title="'+esc(title)+'">'+body+'</div>';
    }).join('')+'</div></section>').join('');
  }
  function render(plan,data={}){
    const projects=groups(plan,data),available=plan.available||[],selectable=projects.filter(g=>g.available.length).length;
    if(!projects.length)return '<div class="cp-picker" data-commission-picker><p class="cp-empty">目前沒有待發抽成；可依原流程支付其他可付薪資。</p></div>';
    return '<div class="cp-picker" data-commission-picker><div class="cp-toolbar"><span>可發 <b>'+available.length+'</b> 筆 · <b>'+selectable+'</b> 個案場</span><div><button type="button" data-cp-all '+(!available.length?'disabled':'')+'>全選可發</button><button type="button" data-cp-clear disabled>清除選取</button></div></div>'+projects.map((g,index)=>{
      const count=g.available.length,caption=(g.customer?g.customer+'｜':'')+g.project,detailId='cp-project-details-'+index;
      return '<section class="cp-project '+(!count?'cp-project-waiting':'')+'" data-cp-project="'+index+'"><header class="cp-project-header"><label class="cp-group-toggle" title="'+esc(caption)+'"><span class="cp-check-target"><input type="checkbox" data-cp-group '+(!count?'disabled':'')+' aria-label="'+esc(caption)+' 全選可發 '+count+' 筆"></span><span class="cp-project-title"><b>'+esc(caption)+'</b><small>'+(count?'勾選即全選可發 '+count+' 筆':'目前無可發抽成')+'</small></span></label><div class="cp-project-amount"><span>可發合計</span><b>'+money(total(g.available))+'</b></div><div class="cp-project-status"><span class="cp-ready-count">可發 '+count+' 筆</span>'+(g.locked.length?'<span class="cp-wait-count">待解鎖 '+g.locked.length+' 筆</span>':'')+'<span class="cp-picked" data-cp-picked>未選取</span></div><button type="button" class="cp-expand" data-cp-expand aria-expanded="false" aria-controls="'+detailId+'" aria-label="展開 '+esc(caption)+' 的戶別明細"><span>戶別明細</span>'+arrow+'</button></header><div id="'+detailId+'" class="cp-project-detail" hidden>'+(count?rowsHtml(g.available,true):'')+(g.locked.length?'<details class="cp-locked-details"><summary>待解鎖 '+g.locked.length+' 筆 · '+money(total(g.locked))+'<span>不可選取 '+arrow+'</span></summary><p>以下未符合發放條件，不會加入本次付款。</p>'+rowsHtml(g.locked,false)+'</details>':'')+'</div></section>';
    }).join('')+'</div>';
  }
  function snapshot(plan){
    // Only this employee/month, not the whole ERP. Do not silently accept a changed payment plan.
    const rows=kind=>(plan[kind]||[]).map(row=>[text(row.allocationKey),Number(row.amount),text(row.projectId),text(row.house),text(row.commissionId),text(row.date),(row.billingIds||[]).map(text).sort(),text(row.releaseStatus)]).sort((a,b)=>compare(a[0],b[0]));
    return JSON.stringify([plan.groupKey,plan.payrollId,plan.allowed,plan.baseOutstanding,plan.truthOutstanding,plan.currentPayable,rows('available'),rows('locked'),rows('settled'),(plan.blockers||[]).map(x=>x.code)]);
  }
  function bind(form,{getPlan,onChange}){
    const root=$('[data-commission-picker]',form);if(!root)return null;
    const abort=new AbortController(),signal=abort.signal,initial=getPlan([]),baseline=snapshot(initial);
    const entries=new Map((initial.available||[]).map(row=>[text(row.allocationKey),row]));
    const feedback=$('[data-cp-feedback]',form),summary=$('[data-cp-summary]',form),submit=$('button[type="submit"]',form);
    const overlay=form.closest('.erp-detail-overlay');
    let stale=false,busy=false;
    const inputs=()=>$$('[name="commissionSelection"]',root);
    const selected=()=>inputs().filter(n=>n.checked).map(n=>n.value);
    function warn(message){
      stale=true;
      if(feedback){feedback.textContent=message;feedback.hidden=false;feedback.setAttribute('role','alert')}
      $$('input[type="checkbox"],[data-cp-all],[data-cp-clear]',root).forEach(n=>n.disabled=true);
      submit.disabled=true;
    }
    function current(){
      if(stale)return null;
      try{const now=getPlan([]);if(snapshot(now)!==baseline){warn('可發來源或薪資金額已更新。請取消並重新開啟付款視窗核對；目前未送出付款。');return null}return now}
      catch(_){warn('目前無法核對可發來源，已停止付款。請取消並重新開啟後核對。');return null}
    }
    function sync(){
      const keys=selected();let projects=0;
      $$('[data-cp-project]',root).forEach(section=>{
        const all=$$('[name="commissionSelection"]',section),chosen=all.filter(n=>n.checked),group=$('[data-cp-group]',section);
        group.checked=all.length>0&&chosen.length===all.length;group.indeterminate=chosen.length>0&&chosen.length<all.length;
        group.setAttribute('aria-checked',group.indeterminate?'mixed':String(group.checked));
        section.classList.toggle('is-selected',chosen.length>0);if(chosen.length)projects++;
        $('[data-cp-picked]',section).textContent=chosen.length?'已選 '+chosen.length+'/'+all.length+' 筆 · '+money(chosen.reduce((sum,n)=>sum+Number(entries.get(n.value)?.amount||0),0)):'未選取';
      });
      if(summary)summary.textContent=keys.length?'已選 '+projects+' 個案場 · '+keys.length+' 筆抽成 · '+money(keys.reduce((sum,k)=>sum+Number(entries.get(k)?.amount||0),0)):'尚未選取抽成 · $0';
      const clear=$('[data-cp-clear]',root);if(clear)clear.disabled=stale||!keys.length;
      const all=$('[data-cp-all]',root);if(all)all.disabled=stale||!inputs().length||keys.length===inputs().length;
    }
    function changed(){if(!current())return;onChange();sync()}
    root.addEventListener('click',event=>{
      const expand=event.target.closest('[data-cp-expand]');if(expand&&root.contains(expand)){
        const section=expand.closest('[data-cp-project]'),detail=$('.cp-project-detail',section),open=detail.hidden;
        detail.hidden=!open;expand.setAttribute('aria-expanded',String(open));$('span',expand).textContent=open?'收合明細':'戶別明細';
        expand.setAttribute('aria-label',(open?'收合 ':'展開 ')+$('.cp-project-title>b',section).textContent+' 的戶別明細');return;
      }
      const action=event.target.closest('[data-cp-all],[data-cp-clear]');if(!action||!root.contains(action)||!current())return;
      inputs().forEach(input=>{if(!input.disabled)input.checked=action.hasAttribute('data-cp-all')});changed();
    },{signal});
    root.addEventListener('change',event=>{
      if(event.target.matches('[data-cp-group]')){
        if(!current())return;
        $$('[name="commissionSelection"]',event.target.closest('[data-cp-project]')).forEach(input=>{if(!input.disabled)input.checked=event.target.checked});
      }
      if(event.target.matches('[data-cp-group],[name="commissionSelection"]'))changed();
    },{signal});
    // Run before the original onchange and submit handlers; original payment writer is unchanged.
    form.addEventListener('input',event=>{if(busy||!current()){event.stopImmediatePropagation();event.preventDefault()}},{capture:true,signal});
    form.addEventListener('change',event=>{if(busy||!current()){event.stopImmediatePropagation();event.preventDefault()}},{capture:true,signal});
    form.addEventListener('submit',event=>{
      if(busy||!current()){event.preventDefault();event.stopImmediatePropagation();if(!busy)feedback?.focus();return}
      const keys=selected(),plan=getPlan(keys);
      const invalid=keys.some(k=>!entries.has(k))||new Set(keys).size!==keys.length;
      if(invalid||!plan.allowed||Number(plan.selectedPayable)<=0){event.preventDefault();event.stopImmediatePropagation();warn(plan.blockers?.[0]?.message||'本次尚無有效可付金額，請重新開啟後核對。');return}
      // Inert does not remove fields from FormData. The original handler still collects and writes once.
      busy=true;form.setAttribute('aria-busy','true');if(overlay)overlay.inert=true;
    },{capture:true,signal});
    const onUpdated=()=>{if(form.isConnected&&!busy)current()};window.addEventListener('kushe:data-updated',onUpdated,{signal});
    const busyObserver=new MutationObserver(()=>{
      if(busy&&!submit.disabled){busy=false;form.setAttribute('aria-busy','false');if(overlay)overlay.inert=false;current()}
    });
    busyObserver.observe(submit,{attributes:true,attributeFilter:['disabled']});
    overlay?.addEventListener('keydown',event=>{
      if(event.isComposing||busy)return;
      if(event.key==='Escape'){event.preventDefault();$('[data-close-detail]',overlay)?.click();return}
      if(event.key==='Tab'){
        const nodes=$$('button,input,select,summary,textarea',overlay).filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    },{signal});
    const removal=new MutationObserver(()=>{if(!form.isConnected){abort.abort();removal.disconnect();busyObserver.disconnect()}});
    removal.observe(form.closest('.erp-detail-overlay')?.parentNode||document.body,{childList:true});
    // Invalid duplicate source identities are not made payable by this presentation layer.
    if(entries.size!==(initial.available||[]).length||inputs().some(n=>!text(n.value)))warn('可發來源識別無法唯一核對，已停止選取與付款；請先核對來源。');
    else onChange();
    sync();
    return {sync};
  }
  window.KusheCommissionPicker={render,bind};
}());
