(function(){
 'use strict';
 const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
 const store=window.KuSheERPStore,filters={month:'',customer:'',project:''},monthSelections=new Map(),expandedProjectKeys=new Set();let active=false,ready=false;
 const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const money=(value)=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(value)||0);
 const monthOf=(value)=>String(value||'').slice(0,7);
 const options=(rows,selected,empty)=>{const state=store.getState(),key=['customers','projects'].find((name)=>rows===state[name]),source=key?store.masterOptions(key):rows;return `<option value="">${empty}</option>${source.map((row)=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>${esc(row.name||'—')}</option>`).join('')}`};

 function monthGroups(row){
  const groups=new Map();
  (row.details||[]).forEach((detail)=>{
   const month=monthOf(detail.date);
   if(!groups.has(month))groups.set(month,{month,details:[],count:0,amount:0,dates:[]});
   const group=groups.get(month);group.details.push(detail);group.count+=1;group.amount+=Number(detail.subtotal)||0;if(detail.date)group.dates.push(detail.date);
  });
  return [...groups.values()].map((group)=>{const dates=[...group.dates].sort();return {...group,details:[...group.details].sort((a,b)=>String(a.date).localeCompare(String(b.date))),earliest:dates[0]||'',latest:dates.at(-1)||''}}).sort((a,b)=>String(a.month).localeCompare(String(b.month)));
 }
 function selectedMonths(row){const key=typeof row==='string'?row:row.key;if(!monthSelections.has(key))monthSelections.set(key,new Set());return monthSelections.get(key)}
 function selectedActualDetails(row){const selected=selectedMonths(row);return (row.details||[]).filter((detail)=>selected.has(monthOf(detail.date)))}
 function selectionSummary(row){const details=selectedActualDetails(row),months=new Set(details.map((detail)=>monthOf(detail.date)));return {months:months.size,count:details.length,amount:details.reduce((sum,detail)=>sum+(Number(detail.subtotal)||0),0)}}
 function buildUnbilledPresentation(row){
  const groups=monthGroups(row),selected=selectedMonths(row),summary=selectionSummary(row),details=row.details||[],contractDetails=row.contractDetails||[];
  const detailPresentation=groups.map((group)=>({...group,selected:selected.has(group.month),details:group.details.map((detail)=>({sourceRecord:detail,date:detail.date||'',employees:detail.employees||'',house:detail.house||'',item:detail.item||'',unit:detail.unit||'',price:detail.price,qty:detail.qty,subtotal:detail.subtotal,sourceCaption:detail.quotationNo||detail.sourceLabel||''}))}));
  const contractPresentation=contractDetails.map((detail)=>({sourceRecord:detail,quotationNo:detail.quotationNo||'',item:detail.item||'',contractAmount:detail.contractAmount,billedAmount:detail.billedAmount,remainingAmount:detail.remainingAmount}));
  return {...row,sourceRecord:row,monthGroups:detailPresentation,contractPresentation,selectionSummary:summary,monthCount:groups.length,houseCount:new Set(details.map((detail)=>detail.house).filter(Boolean)).size,workCount:Number(row.count)||0,canCreate:summary.count>0||contractDetails.length>0};
 }
 function temporaryRow(row){
  const details=selectedActualDetails(row),actualDates=details.map((detail)=>detail.date).filter(Boolean).sort(),contractDates=(row.contractDetails||[]).map((detail)=>detail.date).filter(Boolean).sort(),dates=actualDates.length?actualDates:contractDates;
  const actualAmount=details.reduce((sum,detail)=>sum+(Number(detail.subtotal)||0),0),contractAmount=Number(row.contractAmount)||0;
  return {...row,details:[...details],actualAmount,amount:actualAmount+contractAmount,count:details.length+(row.contractDetails||[]).length,dates:[...dates],earliest:dates[0]||'—',latest:dates.at(-1)||'—'};
 }
 function actualDetailRows(row){return row.monthGroups.map((group)=>`<tr class="unbilled-detail-month"><th colspan="8">${esc(group.month||'未指定月份')}<span>${group.count} 筆・${money(group.amount)}</span></th></tr>${group.details.map((detail)=>`<tr><td>${esc(detail.date)}</td><td><b>${esc(detail.employees)}</b></td><td>${esc(detail.house||'—')}</td><td>${esc(detail.item)}</td><td>${esc(detail.unit)}</td><td class="num">${money(detail.price)}</td><td class="num">${detail.qty}</td><td class="num"><b>${money(detail.subtotal)}</b></td></tr>`).join('')}`).join('')}
 function monthSelection(row){
  const groups=row.monthGroups,summary=row.selectionSummary;
  if(!groups.length)return '';
  return `<section class="unbilled-month-selection"><header><div><h3>實做實算施工月份</h3><p>可勾選單一月份，或跨月份合併建立一張請款單。</p></div><strong data-unbilled-selection-summary="${esc(row.key)}">已選 ${summary.months} 個月份・${summary.count} 筆・${money(summary.amount)}</strong></header><div class="unbilled-month-list">${groups.map((group)=>`<label><input type="checkbox" data-unbilled-month="${esc(group.month)}" data-unbilled-month-key="${esc(row.key)}" ${group.selected?'checked':''}><span><b>${esc(group.month||'未指定月份')}</b>${group.earliest||group.latest?`<small>${esc(group.earliest)} ～ ${esc(group.latest)}</small>`:''}</span><em>${group.count} 筆</em><strong>${money(group.amount)}</strong></label>`).join('')}</div></section>`;
 }
 function mobileDetails(row){
  const contracts=row.contractPresentation.length?`<section class="unbilled-mobile-source"><h3>總價／進度請款</h3>${row.contractPresentation.map((detail)=>`<article class="mobile-card unbilled-mobile-detail-card"><header><div><span class="mobile-card-kicker">${esc(detail.quotationNo||'總價工程')}</span><h4>${esc(detail.item||'未命名項目')}</h4></div><strong>${money(detail.remainingAmount)}</strong></header><dl class="mobile-meta"><div><dt>合約總價</dt><dd>${money(detail.contractAmount)}</dd></div><div><dt>累計已請</dt><dd>${money(detail.billedAmount)}</dd></div></dl></article>`).join('')}</section>`:'';
  const actual=row.monthGroups.length?`<section class="unbilled-mobile-source"><h3>實做實算施工明細</h3>${row.monthGroups.map((group)=>`<section class="unbilled-mobile-month"><header><div><strong>${esc(group.month||'未指定月份')}</strong>${group.earliest||group.latest?`<small>${esc(group.earliest)} ～ ${esc(group.latest)}</small>`:''}</div><span>${group.count} 筆・${money(group.amount)}</span></header>${group.details.map((detail)=>`<article class="mobile-card unbilled-mobile-detail-card"><header><div><span class="mobile-card-kicker">${esc(detail.house||'未指定戶別')}</span><h4>${esc(detail.item||'未命名項目')}</h4></div><strong>${money(detail.subtotal)}</strong></header><dl class="mobile-meta">${detail.date?`<div><dt>施工日期</dt><dd>${esc(detail.date)}</dd></div>`:''}${detail.employees?`<div><dt>員工</dt><dd>${esc(detail.employees)}</dd></div>`:''}<div><dt>數量</dt><dd>${esc(detail.qty)}${detail.unit?` ${esc(detail.unit)}`:''}</dd></div><div><dt>單價</dt><dd>${money(detail.price)}</dd></div>${detail.sourceCaption?`<div><dt>來源</dt><dd>${esc(detail.sourceCaption)}</dd></div>`:''}</dl></article>`).join('')}</section>`).join('')}</section>`:'';
  return `<div class="unbilled-mobile-details">${contracts}${actual}</div>`;
 }
 function patchProjectSelectionUI(row){
  const presentation=buildUnbilledPresentation(row.sourceRecord),summary=presentation.selectionSummary,project=$(`[data-unbilled-key="${CSS.escape(row.key)}"]`);
  if(!project)return;
  const summaryNode=$(`[data-unbilled-selection-summary="${CSS.escape(row.key)}"]`,project),createButton=$('[data-create-billing]',project);
  if(summaryNode)summaryNode.textContent=`已選 ${summary.months} 個月份・${summary.count} 筆・${money(summary.amount)}`;
  if(createButton)createButton.disabled=!presentation.canCreate;
 }
 function render(){
  if(!active)return;
  const state=store.getState(),rows=store.unbilledWork(filters).map(buildUnbilledPresentation),amount=rows.reduce((sum,row)=>sum+row.amount,0),count=rows.reduce((sum,row)=>sum+row.count,0);
  $('#unbilledWorkApp').innerHTML=`<section class="commissions-heading"><div><h1>待請款施工</h1><p>實做實算依施工明細、總價承攬依合約進度分開追蹤</p></div><button class="commission-secondary" id="openBillingManagement" type="button">請款單管理</button></section><section class="unbilled-summary"><article><span>尚未請款案場</span><strong>${rows.length}</strong><small>個案場</small></article><article><span>尚未請款合計</span><strong>${money(amount)}</strong><small>${count} 筆可請款來源</small></article></section><section class="commission-panel commission-filters"><div class="unbilled-filter-grid"><label><span>月份</span><input id="unbilledMonth" type="month" value="${esc(filters.month)}"></label><label><span>客戶</span><select id="unbilledCustomer">${options(state.customers,filters.customer,'全部客戶')}</select></label><label><span>案場</span><select id="unbilledProject">${options(state.projects,filters.project,'全部案場')}</select></label><button class="commission-clear" id="unbilledClear" type="button">清除篩選</button></div></section><section class="unbilled-list">${rows.map((row,index)=>{const expanded=expandedProjectKeys.has(row.key);return `<article class="commission-panel unbilled-project" data-unbilled-key="${esc(row.key)}"><header><div><span class="unbilled-customer">${esc(row.customerName)}</span><h2>${esc(row.projectName)}</h2><p>${esc(row.earliest)} ～ ${esc(row.latest)}</p><dl class="mobile-meta unbilled-project-meta"><div><dt>月份</dt><dd>${row.monthCount}</dd></div><div><dt>戶別</dt><dd>${row.houseCount}</dd></div><div><dt>工作</dt><dd>${row.workCount} 筆</dd></div></dl></div><div class="unbilled-project-stats">${row.contractAmount?`<span>總價工程剩餘未請款<b>${money(row.contractAmount)}</b></span>`:''}${row.actualAmount?`<span>本期實做實算待請款<b>${money(row.actualAmount)}</b></span>`:''}<span>待請款合計<b>${money(row.amount)}</b></span><div class="unbilled-card-actions"><button class="commission-secondary" type="button" data-unbilled-toggle="${esc(row.key)}">${expanded?'收合明細':'查看明細'}</button><button class="commission-primary mobile-action-primary" type="button" data-create-billing="${index}" ${row.canCreate?'':'disabled'}>產生請款單</button></div></div></header>${monthSelection(row)}<div class="unbilled-details" data-unbilled-details="${esc(row.key)}" ${expanded?'':'hidden'}><div class="unbilled-desktop-details">${row.contractPresentation.length?`<section class="unbilled-source-section"><h3>總價／進度請款</h3><div class="commission-table-wrap"><table class="commission-table"><thead><tr><th>報價單</th><th>總價工程項目</th><th class="num">合約總價</th><th class="num">累計已請</th><th class="num">剩餘未請款</th></tr></thead><tbody>${row.contractPresentation.map((detail)=>`<tr><td>${esc(detail.quotationNo)}</td><td><b>${esc(detail.item)}</b></td><td class="num">${money(detail.contractAmount)}</td><td class="num">${money(detail.billedAmount)}</td><td class="num"><b>${money(detail.remainingAmount)}</b></td></tr>`).join('')}</tbody></table></div></section>`:''}${row.monthGroups.length?`<section class="unbilled-source-section"><h3>實做實算施工明細</h3><div class="commission-table-wrap"><table class="commission-table"><thead><tr><th>日期</th><th>員工</th><th>戶別</th><th>施工項目</th><th>單位</th><th class="num">單價</th><th class="num">數量</th><th class="num">小計（未稅）</th></tr></thead><tbody>${actualDetailRows(row)}</tbody></table></div></section>`:''}</div>${mobileDetails(row)}</div></article>`}).join('')||'<section class="commission-panel unbilled-empty"><h2>目前沒有待請款來源</h2><p>實做實算施工或總價合約剩餘款，會自動出現在這裡。</p></section>'}</section>`;
  $('#openBillingManagement').onclick=()=>window.KushePhase1.navigate('billings');
  $('#unbilledMonth').onchange=(event)=>{filters.month=event.target.value;render()};
  $('#unbilledCustomer').onchange=(event)=>{filters.customer=event.target.value;render()};
  $('#unbilledProject').onchange=(event)=>{filters.project=event.target.value;render()};
  $('#unbilledClear').onclick=()=>{Object.assign(filters,{month:'',customer:'',project:''});render()};
  $$('[data-unbilled-toggle]').forEach((button)=>button.onclick=()=>{const key=button.dataset.unbilledToggle,details=$(`[data-unbilled-details="${CSS.escape(key)}"]`),open=details.hidden;details.hidden=!open;if(open)expandedProjectKeys.add(key);else expandedProjectKeys.delete(key);button.textContent=open?'收合明細':'查看明細'});
  $$('[data-unbilled-month]').forEach((input)=>input.onchange=()=>{const key=input.dataset.unbilledMonthKey,selected=selectedMonths(key);if(input.checked)selected.add(input.dataset.unbilledMonth);else selected.delete(input.dataset.unbilledMonth);patchProjectSelectionUI(rows.find((row)=>row.key===key))});
  $$('[data-create-billing]').forEach((button)=>button.onclick=()=>{const row=temporaryRow(rows[Number(button.dataset.createBilling)].sourceRecord);window.KusheBilling.startDraft(row,filters)});
 }
 async function activate(){active=true;if(!ready){await store.load();ready=true}render()}
 function deactivate(){active=false;monthSelections.clear();expandedProjectKeys.clear()}
 window.addEventListener('kushe:data-updated',()=>{if(active)render()});window.KusheUnbilledWork={activate,deactivate,render};
}());
