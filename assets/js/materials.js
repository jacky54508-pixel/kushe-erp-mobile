(function () {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const store=window.KuSheERPStore,esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=(value)=>`$${Math.round(store.num(value)).toLocaleString('en-US')}`;
  let active=false,query='',searchTimer=0;
  const usageFilters={month:'',employee:'',project:'',material:'',query:''};
  function state(){return store.getState()}
  function vendorName(material,data){return data.vendors.find((row)=>row.id===material.vendor)?.name||material.vendorName||'—'}
  function optionRows(rows,selected,placeholder){return `<option value="">${esc(placeholder)}</option>${rows.map((row)=>`<option value="${esc(row.id)}" ${String(row.id)===String(selected||'')?'selected':''}>${esc(row.name||'—')}</option>`).join('')}`}
  function overlay(markup){const node=document.createElement('div');node.className='erp-detail-overlay';node.innerHTML=markup;document.body.appendChild(node);const close=()=>node.remove();$$('[data-close-detail]',node).forEach((button)=>button.onclick=close);node.onclick=(event)=>{if(event.target===node)close()};return {node,close}}
  const monthOf=(value)=>String(value||'').slice(0,7);
  function masterName(key,id,fallback='—'){const row=(state()[key]||[]).find((item)=>String(item.id)===String(id||''));return row?.name||fallback||'—'}
  function inventoryReceiptRows(data){
    return (data.inventoryReceipts||[]).map((row)=>{
      const material=data.materials.find((item)=>String(item.id)===String(row.material||row.materialId||''))||{},payable=data.payables.find((item)=>item.id===row.payableId||item.sourceType==='inventory-receipt'&&item.sourceId===row.id),preview=store.inventoryReceiptPayablePreview(row.id);
      return {source:row,id:row.id,date:row.date||'',materialName:row.materialName||material.name||'—',quantity:store.num(row.quantity),unit:row.unit||material.unit||'—',beforeStock:store.num(row.beforeStock),afterStock:store.num(row.afterStock),note:row.note||'',unitPrice:row.unitPrice,amount:row.amount,payable,preview};
    }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.source.createdAt||'').localeCompare(String(a.source.createdAt||'')));
  }
  function receiptAccountingMarkup(row){
    if(row.payable)return '<span class="material-receipt-linked">'+esc(row.payable.payableNo||'已建立應付')+'</span>';
    if(row.preview.allowed)return '<button type="button" class="commission-secondary compact" data-receipt-payable="'+esc(row.id)+'">補登應付</button>';
    return '<span class="material-receipt-review">'+esc(row.preview.reason||'需核對')+'</span>';
  }
  function inventorySection(data){
    const receipts=inventoryReceiptRows(data),pending=receipts.filter((row)=>!row.payable).length;
    const desktop=receipts.map((row)=>`<tr><td>${esc(row.date||'—')}</td><td><b>${esc(row.materialName)}</b></td><td class="num">+${esc(row.quantity)} ${esc(row.unit)}</td><td class="num">${row.unitPrice===undefined?'待確認':money(row.unitPrice)}</td><td class="num"><b>${row.amount===undefined?'待確認':money(row.amount)}</b></td><td>${receiptAccountingMarkup(row)}</td><td class="num">${esc(row.beforeStock)} → ${esc(row.afterStock)}</td><td>${esc(row.note||'—')}</td></tr>`).join('')||'<tr><td colspan="8" class="billing-empty">尚無正式材料入庫紀錄。</td></tr>';
    const mobile=receipts.map((row)=>`<article class="material-usage-mobile-card"><header><div><span>材料入庫</span><h3>${esc(row.materialName)}</h3></div><strong>+${esc(row.quantity)} ${esc(row.unit)}</strong></header><dl class="material-usage-mobile-meta"><div><dt>日期</dt><dd>${esc(row.date||'—')}</dd></div><div><dt>進貨單價</dt><dd>${row.unitPrice===undefined?'待確認':money(row.unitPrice)}</dd></div><div><dt>應付金額</dt><dd>${row.amount===undefined?'待確認':money(row.amount)}</dd></div><div><dt>庫存變化</dt><dd>${esc(row.beforeStock)} → ${esc(row.afterStock)} ${esc(row.unit)}</dd></div></dl><div class="material-receipt-accounting">${receiptAccountingMarkup(row)}</div>${row.note?`<p class="material-usage-mobile-note"><span>備註</span><strong>${esc(row.note)}</strong></p>`:''}</article>`).join('')||'<p class="materials-mobile-empty">尚無正式材料入庫紀錄。</p>';
    return `<section class="commission-panel material-inventory-ledger"><header><div><h2>材料入庫紀錄</h2><p>採購入庫同時增加庫存並建立廠商應付；付款請至應付帳款辦理。</p>${pending?`<p class="material-receipt-pending">${pending} 筆舊入庫待核對應付；確認成交單價後可逐筆補登，庫存不會重複增加。</p>`:''}</div></header><div class="commission-table-wrap material-inventory-desktop"><table class="commission-table"><thead><tr><th>日期</th><th>材料</th><th class="num">入庫數量</th><th class="num">進貨單價</th><th class="num">應付金額</th><th>應付紀錄</th><th class="num">庫存前 → 後</th><th>備註</th></tr></thead><tbody>${desktop}</tbody></table></div><div class="material-inventory-mobile">${mobile}</div></section>`;
  }
  function usageRows(data){
    const keyword=usageFilters.query.trim().toLocaleLowerCase('zh-Hant');
    return (data.materialUsages||[]).map((row)=>{
      const employeeName=masterName('employees',row.employee,row.employeeName||'未紀錄'),projectName=masterName('projects',row.project,row.projectName||'—'),materialName=masterName('materials',row.material,row.materialName||'—'),vendorNameValue=masterName('vendors',row.vendor,row.vendorName||'—'),material=data.materials.find((item)=>String(item.id)===String(row.material||''))||{};
      return {source:row,id:row.id,date:row.date||'',employee:row.employee||'',employeeName,employeeRecorded:Boolean(row.employee||row.employeeName),project:row.project||'',projectName,material:row.material||'',materialName,vendorName:vendorNameValue,model:row.model||material.model||'—',unit:row.unit||material.unit||'—',quantity:store.num(row.quantity),amount:store.num(row.amount),note:row.note||''};
    }).filter((row)=>{
      if(usageFilters.month&&monthOf(row.date)!==usageFilters.month)return false;
      if(usageFilters.employee&&String(row.employee)!==String(usageFilters.employee))return false;
      if(usageFilters.project&&String(row.project)!==String(usageFilters.project))return false;
      if(usageFilters.material&&String(row.material)!==String(usageFilters.material))return false;
      if(!keyword)return true;
      return `${row.employeeName} ${row.projectName} ${row.materialName} ${row.model} ${row.vendorName} ${row.note}`.toLocaleLowerCase('zh-Hant').includes(keyword);
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.source.createdAt||'').localeCompare(String(a.source.createdAt||'')));
  }
  function usageSection(data){
    const rows=usageRows(data),total=rows.reduce((sum,row)=>sum+row.amount,0),missing=rows.filter((row)=>!row.employeeRecorded).length,employees=store.masterOptions('employees'),projects=store.masterOptions('projects'),materials=store.masterOptions('materials');
    const employeeCell=(row)=>`<div class="material-usage-employee-cell"><span class="material-usage-employee ${row.employeeRecorded?'':'is-missing'}">${esc(row.employeeName)}</span>${row.employeeRecorded?'':`<button class="material-usage-assign" type="button" data-assign-material-employee="${esc(row.id)}">補登員工</button>`}</div>`;
    const desktop=rows.map((row)=>`<tr><td>${esc(row.date||'—')}</td><td>${employeeCell(row)}</td><td>${esc(row.projectName)}</td><td><b>${esc(row.materialName)}</b></td><td>${esc(row.model)}</td><td>${esc(row.quantity)} ${esc(row.unit)}</td><td class="num"><b>${money(row.amount)}</b></td><td>${esc(row.vendorName)}</td><td>${esc(row.note||'—')}</td></tr>`).join('')||'<tr><td colspan="9" class="billing-empty">此篩選條件下沒有補料紀錄。</td></tr>';
    const mobile=rows.map((row)=>`<article class="material-usage-mobile-card"><header><div><span>補料材料</span><h3>${esc(row.materialName)}</h3></div>${employeeCell(row)}</header><dl class="material-usage-mobile-meta"><div><dt>日期</dt><dd>${esc(row.date||'—')}</dd></div><div><dt>案場</dt><dd>${esc(row.projectName)}</dd></div><div><dt>數量</dt><dd>${esc(row.quantity)} ${esc(row.unit)}</dd></div><div><dt>規格／型號</dt><dd>${esc(row.model)}</dd></div><div><dt>廠商</dt><dd>${esc(row.vendorName)}</dd></div><div><dt>金額</dt><dd>${money(row.amount)}</dd></div></dl>${row.note?`<p class="material-usage-mobile-note"><span>備註</span><strong>${esc(row.note)}</strong></p>`:''}</article>`).join('')||'<p class="materials-mobile-empty">此篩選條件下沒有補料紀錄。</p>';
    return `<section class="commission-panel material-usage-ledger"><header class="material-usage-head"><div><h2>員工補料紀錄</h2><p>查詢哪個員工在什麼日期補了什麼材料、用在哪一個案場；舊資料未紀錄員工時明確顯示「未紀錄」。</p></div></header><div class="material-usage-kpis"><article data-kpi="materials.count" role="button" tabindex="0" aria-label="查看目前篩選筆數對應明細" aria-expanded="false"><span>目前篩選筆數</span><strong>${rows.length}</strong><small>筆補料紀錄</small></article><article data-kpi="materials.amount" role="button" tabindex="0" aria-label="查看材料金額對應明細" aria-expanded="false"><span>材料金額</span><strong>${money(total)}</strong><small>沿用既有材料成本</small></article><article class="${missing?'is-warning':''}" data-kpi="materials.missing" role="button" tabindex="0" aria-label="查看未紀錄員工對應明細" aria-expanded="false"><span>未紀錄員工</span><strong>${missing}</strong><small>舊資料不自動猜測</small></article></div><div class="material-usage-filters"><label><span>月份</span><input id="materialUsageMonth" type="month" value="${esc(usageFilters.month)}"></label><label><span>員工</span><select id="materialUsageEmployee">${optionRows(employees,usageFilters.employee,'全部員工')}</select></label><label><span>案場</span><select id="materialUsageProject">${optionRows(projects,usageFilters.project,'全部案場')}</select></label><label><span>材料</span><select id="materialUsageMaterial">${optionRows(materials,usageFilters.material,'全部材料')}</select></label><label class="material-usage-search"><span>關鍵字</span><input id="materialUsageQuery" type="search" value="${esc(usageFilters.query)}" placeholder="員工、案場、材料、廠商或備註"></label><button class="commission-clear" id="materialUsageClear" type="button">清除篩選</button></div><div class="commission-table-wrap material-usage-desktop"><table class="commission-table material-usage-table"><thead><tr><th>日期</th><th>補料員工</th><th>案場</th><th>材料</th><th>規格／型號</th><th>數量／單位</th><th class="num">金額</th><th>廠商</th><th>備註</th></tr></thead><tbody>${desktop}</tbody></table></div><div class="material-usage-mobile-list">${mobile}</div></section>`;
  }
  function bindSearch(input,setValue){
    if(!input)return;let composing=false;
    const schedule=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>render(),120)};
    input.addEventListener('compositionstart',()=>{composing=true});
    input.addEventListener('compositionend',()=>{composing=false;setValue(input.value);schedule()});
    input.addEventListener('input',()=>{setValue(input.value);if(!composing)schedule()});
  }
  function bindUsageFilters(host){
    const select=(id,key)=>{const node=$(id,host);if(node)node.onchange=()=>{usageFilters[key]=node.value;render()}};
    select('#materialUsageMonth','month');select('#materialUsageEmployee','employee');select('#materialUsageProject','project');select('#materialUsageMaterial','material');
    bindSearch($('#materialUsageQuery',host),(value)=>{usageFilters.query=value});
    $('#materialUsageClear',host)?.addEventListener('click',()=>{Object.assign(usageFilters,{month:'',employee:'',project:'',material:'',query:''});render()});
  }
  function openEmployeeAssignment(id){
    const data=state(),row=(data.materialUsages||[]).find((item)=>String(item.id)===String(id||''));
    if(!row){window.KushePhase1.toast('找不到這筆補料紀錄');return}
    if(row.employee||row.employeeName){window.KushePhase1.toast('此筆補料紀錄已有員工');return}
    const employees=store.masterOptions('employees'),projectName=masterName('projects',row.project,row.projectName||'—'),materialName=masterName('materials',row.material,row.materialName||'—'),material=data.materials.find((item)=>String(item.id)===String(row.material||''))||{},unit=row.unit||material.unit||'—';
    const modal=overlay(`<section class="erp-detail-card project-master-modal material-employee-assignment-modal" role="dialog" aria-modal="true"><header><div><span>歷史補料補登</span><h2>補登員工</h2><p>這個操作只補上員工，不會修改材料成本、數量、廠商、案場或應付帳款。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="materialEmployeeAssignmentForm"><div class="erp-detail-body"><div class="material-employee-assignment-summary"><div><span>日期</span><strong>${esc(row.date||'—')}</strong></div><div><span>案場</span><strong>${esc(projectName)}</strong></div><div><span>材料</span><strong>${esc(materialName)}</strong></div><div><span>數量</span><strong>${esc(store.num(row.quantity))} ${esc(unit)}</strong></div><div><span>金額</span><strong>${money(row.amount)}</strong></div></div><label class="material-employee-assignment-field"><span>補料員工</span><select name="employee" required>${optionRows(employees,'','請選擇補料員工')}</select></label><p class="material-employee-assignment-note">確認後只會寫入員工 ID、員工姓名與更新時間；既有帳務欄位保持原樣。</p></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">確認補登</button></footer></form></section>`);
    $('#materialEmployeeAssignmentForm',modal.node).onsubmit=async(event)=>{event.preventDefault();const button=event.submitter;if(button)button.disabled=true;try{await store.assignMaterialUsageEmployee(row.id,event.target.elements.employee.value);modal.close();render();window.KushePhase1.toast('補料員工已補登')}catch(error){if(button)button.disabled=false;window.KushePhase1.toast(error.message)}};
  }
  function bindUsageActions(host){
    $$('[data-assign-material-employee]',host).forEach((button)=>button.onclick=()=>openEmployeeAssignment(button.dataset.assignMaterialEmployee));
  }
  function vendorFormMarkup(row={}){
    return '<form id="materialVendorForm"><div class="erp-detail-body"><div class="project-form-grid"><label><span>廠商名稱 *</span><input name="name" value="'+esc(row.name||'')+'" required></label><label><span>聯絡人</span><input name="contact" value="'+esc(row.contact||'')+'"></label><label><span>電話</span><input name="phone" value="'+esc(row.phone||'')+'" inputmode="tel"></label><label><span>統一編號</span><input name="taxId" value="'+esc(row.taxId||'')+'" inputmode="numeric"></label><label class="wide"><span>地址</span><input name="address" value="'+esc(row.address||'')+'"></label><label class="wide"><span>備註</span><textarea name="note" rows="3">'+esc(row.note||'')+'</textarea></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">儲存廠商</button></footer></form>';
  }
  function openVendorForm(id='',afterSave=null){
    const data=state(),row=(data.vendors||[]).find((item)=>String(item.id)===String(id))||{};
    const modal=overlay('<section class="erp-detail-card project-master-modal material-vendor-modal" role="dialog" aria-modal="true"><header><div><span>材料廠商主檔</span><h2>'+(id?'編輯廠商':'新增廠商')+'</h2><p>新增後會共用於材料、應付與案場成本，不建立第二套廠商名單。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header>'+vendorFormMarkup(row)+'</section>');
    $('#materialVendorForm',modal.node).onsubmit=async(event)=>{event.preventDefault();const button=event.submitter;if(button)button.disabled=true;try{const saved=await store.saveVendor(Object.fromEntries(new FormData(event.target)),id);modal.close();if(typeof afterSave==='function')afterSave(saved);else render();window.KushePhase1.toast(id?'廠商資料已更新':'材料廠商已新增')}catch(error){if(button)button.disabled=false;window.KushePhase1.toast(error.message)}};
  }
  function openVendorManager(){
    const vendors=store.materialVendorOptions();
    const rows=vendors.map((row)=>'<tr><td><b>'+esc(row.name||'—')+'</b></td><td>'+esc(row.contact||'—')+'</td><td>'+esc(row.phone||'—')+'</td><td>'+esc(row.taxId||'—')+'</td><td>'+esc(row.address||'—')+'</td><td><button type="button" class="commission-secondary compact" data-edit-material-vendor="'+esc(row.id)+'">編輯</button></td></tr>').join('')||'<tr><td colspan="6" class="billing-empty">尚無材料廠商。</td></tr>';
    const modal=overlay('<section class="erp-detail-card project-master-modal material-vendor-manager-modal" role="dialog" aria-modal="true"><header><div><span>材料管理</span><h2>材料廠商</h2><p>這裡管理共用廠商主檔；已被材料或應付使用的廠商資料不會被刪除。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><div class="erp-detail-body"><div class="material-vendor-manager-actions"><button type="button" class="commission-primary" id="newMaterialVendor">＋ 新增廠商</button></div><div class="commission-table-wrap"><table class="commission-table material-vendor-table"><thead><tr><th>廠商</th><th>聯絡人</th><th>電話</th><th>統編</th><th>地址</th><th>操作</th></tr></thead><tbody>'+rows+'</tbody></table></div></div><footer><button type="button" class="commission-secondary" data-close-detail>關閉</button></footer></section>');
    $('#newMaterialVendor',modal.node).onclick=()=>openVendorForm('',()=>{modal.close();openVendorManager()});
    $('[data-edit-material-vendor]',modal.node).forEach((button)=>button.onclick=()=>openVendorForm(button.dataset.editMaterialVendor,()=>{modal.close();openVendorManager()}));
  }
  async function render(){
    if(!active)return; await store.load(); const data=state(),host=$('#materialsApp');if(!host)return;
    const normalized=query.trim().toLocaleLowerCase('zh-Hant'),rows=data.materials.filter((row)=>!normalized||`${row.name||''} ${row.code||''} ${row.unit||''} ${vendorName(row,data)} ${row.note||''}`.toLocaleLowerCase('zh-Hant').includes(normalized));
    host.innerHTML=`<section class="commissions-heading"><div><h1>材料管理</h1><p>管理材料主檔與正式庫存；材料使用會即時扣庫存，庫存不足時禁止送出。</p></div><div class="materials-heading-actions"><button class="commission-secondary" id="materialVendorManager" type="button">材料廠商</button><button class="commission-primary" id="newMaterial" type="button">＋ 新增材料</button></div></section><section class="commission-panel commission-filters"><label class="payable-search"><span>關鍵字</span><input id="materialQuery" type="search" value="${esc(query)}" placeholder="材料名稱、代碼、廠商或單位"></label></section><section class="commission-panel billing-list-panel materials-list-panel"><div class="commission-table-wrap materials-desktop-table"><table class="commission-table"><thead><tr><th>材料名稱</th><th>材料代碼</th><th>廠商</th><th>規格／型號</th><th>單位</th><th class="num">單價</th><th class="num">目前庫存</th><th>備註</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><b>${esc(row.name||'—')}</b></td><td>${esc(row.code||'—')}</td><td>${esc(vendorName(row,data))}</td><td>${esc(row.model||'—')}</td><td>${esc(row.unit||'—')}</td><td class="num">${money(row.unitPrice)}</td><td class="num"><b>${esc(store.materialInventorySummary(row.id).stock)} ${esc(row.unit||'')}</b></td><td>${esc(row.note||'—')}</td><td><div class="project-row-actions"><button type="button" data-inventory-receive="${esc(row.id)}">入庫</button>${store.materialInventorySummary(row.id).initialized?'':`<button type="button" data-inventory-opening="${esc(row.id)}">設定期初</button>`}<button type="button" data-edit-material-master="${esc(row.id)}">編輯</button><button type="button" data-delete-material-master="${esc(row.id)}">刪除</button></div></td></tr>`).join('')||'<tr><td colspan="9" class="billing-empty">尚無材料主檔。</td></tr>'}</tbody></table></div><div class="materials-mobile-list" aria-label="材料清單">${rows.map((row)=>`<article class="material-mobile-card" data-material-id="${esc(row.id)}"><header class="material-mobile-card-head"><div><span>材料</span><strong>${esc(row.name||'—')}</strong></div><div class="material-mobile-price"><span>單價</span><b>${money(row.unitPrice)}</b></div></header><div class="material-mobile-meta"><div><span>材料代碼</span><strong>${esc(row.code||'—')}</strong></div><div><span>廠商</span><strong>${esc(vendorName(row,data))}</strong></div><div><span>規格／型號</span><strong>${esc(row.model||'—')}</strong></div><div><span>單位</span><strong>${esc(row.unit||'—')}</strong></div><div><span>目前庫存</span><strong>${esc(store.materialInventorySummary(row.id).stock)} ${esc(row.unit||'')}</strong></div></div>${row.note?`<div class="material-mobile-note"><span>備註</span><p>${esc(row.note)}</p></div>`:''}<footer class="material-mobile-actions"><button type="button" data-inventory-receive="${esc(row.id)}">入庫</button>${store.materialInventorySummary(row.id).initialized?'':`<button type="button" data-inventory-opening="${esc(row.id)}">設定期初</button>`}<button type="button" data-edit-material-master="${esc(row.id)}">編輯</button><button type="button" data-delete-material-master="${esc(row.id)}">刪除</button></footer></article>`).join('')||'<p class="materials-mobile-empty">尚無材料主檔。</p>'}</div></section>`;
    host.insertAdjacentHTML('beforeend',inventorySection(data));host.insertAdjacentHTML('beforeend',usageSection(data));
    $('#newMaterial').onclick=()=>openForm();$('#materialVendorManager').onclick=openVendorManager;bindSearch($('#materialQuery',host),(value)=>{query=value});bindUsageFilters(host);bindUsageActions(host);
    $$('[data-inventory-opening]',host).forEach((button)=>button.onclick=()=>openOpeningStock(button.dataset.inventoryOpening));
    $$('[data-inventory-receive]',host).forEach((button)=>button.onclick=()=>openInventoryReceipt(button.dataset.inventoryReceive));
    $$('[data-receipt-payable]',host).forEach((button)=>button.onclick=()=>openInventoryReceipt('',button.dataset.receiptPayable));
    $$('[data-edit-material-master]',host).forEach((button)=>button.onclick=()=>openForm(button.dataset.editMaterialMaster));
    $$('[data-delete-material-master]',host).forEach((button)=>button.onclick=async()=>{if(!confirm('確定刪除此材料主檔？'))return;try{await store.deleteMaterial(button.dataset.deleteMaterialMaster);render();window.KushePhase1.toast('材料已刪除')}catch(error){window.KushePhase1.toast(error.message)}});
    window.KusheTableScroll?.refresh?.();
  }
  function openOpeningStock(materialId){
    const data=state(),material=data.materials.find((row)=>String(row.id)===String(materialId||''));if(!material)return;
    const markup='<section class="erp-detail-card project-master-modal materials-master-modal" role="dialog" aria-modal="true"><header><div><span>庫存基準</span><h2>設定期初庫存</h2><p>'+esc(material.name||'—')+'｜設定後不可直接覆寫，後續請使用正式入庫。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="materialOpeningForm"><div class="erp-detail-body"><div class="project-form-grid"><label><span>期初庫存（'+esc(material.unit||'單位')+'）</span><input name="quantity" type="number" min="0" step="0.01" value="'+store.num(material.stock)+'" required></label><label class="wide"><span>說明</span><input value="P20-6A 庫存上線期初基準" disabled></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">確認期初庫存</button></footer></form></section>';
    const modal=overlay(markup);
    $('#materialOpeningForm',modal.node).onsubmit=async(event)=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await store.setMaterialOpeningStock(material.id,event.target.elements.quantity.value);modal.close();render();window.KushePhase1.toast('期初庫存已建立')}catch(error){button.disabled=false;window.KushePhase1.toast(error.message)}};
  }
  function openInventoryReceipt(materialId,receiptId=''){
    const data=state(),receipt=receiptId?(data.inventoryReceipts||[]).find((row)=>String(row.id)===String(receiptId)):null,preview=receiptId?store.inventoryReceiptPayablePreview(receiptId):null;
    if(receiptId&&(!receipt||!preview.allowed))return window.KushePhase1.toast(preview?.reason||'找不到入庫紀錄');
    const material=data.materials.find((row)=>String(row.id)===String(receipt?.material||receipt?.materialId||materialId||''));if(!material)return;
    const summary=store.materialInventorySummary(material.id);
    if(!receipt&&!summary.initialized)return window.KushePhase1.toast('請先設定期初庫存');
    const todayValue=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),suggestedPrice=store.num(material.unitPrice),requestKey=crypto.randomUUID();
    const markup=`<section class="erp-detail-card project-master-modal materials-master-modal" role="dialog" aria-modal="true"><header><div><span>材料採購</span><h2>${receipt?'補登入庫應付':'新增入庫'}</h2><p>${esc(receipt?.materialName||material.name||'—')}｜${esc(preview?.vendorName||vendorName(material,data))}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="materialReceiptForm"><div class="erp-detail-body"><p class="material-receipt-note">${receipt?'依原入庫建立應付，庫存不變。舊入庫未保存成交單價，請核對下方參考價格。':'確認後同時增加庫存及建立廠商應付；入庫本身不扣銀行餘額。'}</p><div class="project-form-grid"><label><span>入庫日期</span><input name="date" type="date" value="${esc(receipt?.date||todayValue)}" ${receipt?'readonly':''} required></label><label><span>入庫數量（${esc(material.unit||'單位')}）</span><input name="quantity" type="number" min="0.01" step="0.01" value="${receipt?esc(receipt.quantity):''}" ${receipt?'readonly':''} required></label><label><span>進貨單價（未稅）</span><input name="unitPrice" type="number" min="0.01" step="0.01" value="${suggestedPrice>0?suggestedPrice:''}" required></label><label><span>應付金額（未稅）</span><input id="materialReceiptTotal" value="—" readonly></label><label class="wide"><span>備註</span><textarea name="note" rows="3" ${receipt?'readonly':''} placeholder="進貨單號、批次或其他說明">${esc(receipt?.note||'')}</textarea></label></div>${receipt?'<label class="material-receipt-confirm"><input name="confirmed" type="checkbox" required><span>已確認成交單價，且此筆採購尚未記入其他應付</span></label>':''}</div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">${receipt?'確認補登應付':'確認入庫並建立應付'}</button></footer></form></section>`;
    const modal=overlay(markup),form=$('#materialReceiptForm',modal.node),syncTotal=()=>{$('#materialReceiptTotal',modal.node).value=money(store.num(form.elements.quantity.value)*store.num(form.elements.unitPrice.value))};
    form.elements.quantity.oninput=syncTotal;form.elements.unitPrice.oninput=syncTotal;syncTotal();let submitting=false;
    form.onsubmit=async(event)=>{
      event.preventDefault();if(submitting)return;submitting=true;const button=event.submitter||$('button[type="submit"]',form);button.disabled=true;
      try{
        const values=Object.fromEntries(new FormData(form));
        if(receipt)await store.recordInventoryReceiptPayable(receipt.id,{unitPrice:values.unitPrice,confirmed:form.elements.confirmed.checked});
        else await store.addInventoryReceipt({...values,material:material.id,idempotencyKey:requestKey});
        modal.close();render();window.KushePhase1.toast(receipt?'應付已補登，庫存未變動':'材料已入庫，廠商應付已建立');
      }catch(error){submitting=false;button.disabled=false;window.KushePhase1.toast(error.message)}
    };
  }
  function materialNameSuggestions(data,currentId=''){
    const seen=new Set(),current=String(currentId||'');
    return (data.materials||[]).filter((item)=>String(item.id)!==current).map((item)=>String(item.name||'').trim()).filter((name)=>name&&!seen.has(name)&&seen.add(name));
  }
  function openForm(id=''){
    const data=state(),row=data.materials.find((item)=>item.id===id)||{},vendors=store.materialVendorOptions(),nameSuggestions=materialNameSuggestions(data,id);
    const modal=overlay(`<section class="erp-detail-card project-master-modal materials-master-modal" role="dialog" aria-modal="true"><header><div><span>材料主檔</span><h2>${id?'編輯材料':'新增材料'}</h2><p>材料價格供案場材料使用自動帶入；單次使用改價不回寫主檔。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="materialMasterForm" autocomplete="off"><div class="erp-detail-body"><div class="project-form-grid"><label><span>材料名稱</span><input name="materialName" id="materialNameInput" list="materialNameSuggestions" value="${esc(row.name||'')}" autocomplete="off" autocapitalize="off" spellcheck="false" required><datalist id="materialNameSuggestions">${nameSuggestions.map((name)=>`<option value="${esc(name)}"></option>`).join('')}</datalist></label><label><span>材料代碼</span><input name="code" value="${esc(row.code||'')}"></label><label class="material-vendor-field"><span>廠商</span><div class="material-vendor-select-row"><select name="vendor" required>${optionRows(vendors,row.vendor,'請選擇既有廠商')}</select><button type="button" class="commission-secondary compact" id="quickAddMaterialVendor">＋ 新增廠商</button></div></label><label><span>單位</span><input name="unit" value="${esc(row.unit||'')}" required></label><label><span>單價</span><input name="unitPrice" type="number" min="0" step="0.01" value="${store.num(row.unitPrice)}" required></label><label><span>規格／型號</span><input name="model" value="${esc(row.model||'')}"></label>${id?'':`<label><span>期初庫存</span><input name="openingStock" type="number" min="0" step="0.01" value="0" required></label>`}<label class="wide"><span>備註</span><textarea name="note" rows="3">${esc(row.note||'')}</textarea></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">儲存材料</button></footer></form></section>`);
    $('#quickAddMaterialVendor',modal.node).onclick=()=>openVendorForm('',(saved)=>{
      const select=$('[name="vendor"]',modal.node),vendors=store.materialVendorOptions();
      select.innerHTML=optionRows(vendors,saved.id,'請選擇既有廠商');select.value=saved.id;
      window.KushePhase1.toast('新廠商已建立並自動選取');
    });
    $('#materialMasterForm',modal.node).onsubmit=async(event)=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{{const values=Object.fromEntries(new FormData(event.target));values.name=values.materialName;delete values.materialName;await store.saveMaterial(values,id);}modal.close();render();window.KushePhase1.toast('材料主檔已儲存')}catch(error){button.disabled=false;window.KushePhase1.toast(error.message)}};
  }
  window.addEventListener('kushe:data-updated',()=>{if(active)render()});
  window.KusheMaterials={activate(){active=true;render()},deactivate(){active=false;clearTimeout(searchTimer)},render};

  // P21: read-only KPI destinations; original calculations and save paths are unchanged.

  window.KusheKpi.register('materials',{anchor:'.material-usage-kpis',active:()=>active,read(action){
    if(!['count','amount','missing'].includes(action))return null;
    return {title:action==='missing'?'未紀錄員工的補料明細':'材料使用明細',scope:'沿用目前月份、員工、案場、材料與關鍵字；不補登員工、不扣庫存。',columns:['日期','補料員工','案場','材料','規格','數量／單位','金額','廠商'],rows:usageRows(state()).filter(r=>action!=='missing'||!r.employeeRecorded).map(r=>({id:r.id,cells:[r.date,r.employeeName,r.projectName,r.materialName,r.model,r.quantity+' '+r.unit,money(r.amount),r.vendorName]}))};
  }});

})();

