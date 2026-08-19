(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const store = window.KuSheERPStore;
  const filters = { month: '', employee: '', project: '', status: '', billingStatus: '', query: '', sort: 'date', direction: 'desc' };
  let ready = false;
  let active = false;
  let editingId = null;
  let editingDailyBatch = '';
  let dailyLineSequence = 0;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD', maximumFractionDigits:0 }).format(Number(value) || 0);
  const number = (value) => Number(value) || 0;
  const monthNow = () => new Date().toISOString().slice(0, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  function label(state, module, id, fallback = '—') {
    const row = (state[module] || []).find((item) => item.id === id);
    return row?.name || row?.number || fallback;
  }
  function grossOf(state, row) {
    const billing = (state.billings || []).find((item) => item.number && item.number === row.sourceNo);
    if (billing && number(billing.amount) === number(row.untaxedAmount) && number(billing.total)) return number(billing.total);
    return store.grossFromUntaxed(row.untaxedAmount);
  }
  function latestMonth(state) {
    const months = (state.commissions || []).map((row) => String(row.date || '').slice(0, 7)).filter((value) => /^\d{4}-\d{2}$/.test(value));
    return months.includes(monthNow()) ? monthNow() : (months.sort().at(-1) || monthNow());
  }
  function rowsFor(state) {
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    const rows = (state.commissions || []).filter((row) => {
      if (filters.month && !String(row.date || '').startsWith(filters.month)) return false;
      if (filters.employee && row.employee !== filters.employee) return false;
      if (filters.project && row.project !== filters.project) return false;
      if (filters.status && row.status !== filters.status) return false;
      const employee = label(state, 'employees', row.employee, row.employeeName || '');
      const project = label(state, 'projects', row.project, row.projectName || '');
      return !query || `${employee} ${project} ${row.sourceNo || ''} ${row.note || ''}`.toLocaleLowerCase('zh-Hant').includes(query);
    });
    const direction = filters.direction === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      if (filters.sort === 'employee') return direction * label(state, 'employees', a.employee, a.employeeName || '').localeCompare(label(state, 'employees', b.employee, b.employeeName || ''), 'zh-Hant');
      if (filters.sort === 'project') return direction * label(state, 'projects', a.project, a.projectName || '').localeCompare(label(state, 'projects', b.project, b.projectName || ''), 'zh-Hant');
      if (['untaxedAmount','rate','commission'].includes(filters.sort)) return direction * (number(a[filters.sort]) - number(b[filters.sort]));
      if (filters.sort === 'status') return direction * String(a.status || '').localeCompare(String(b.status || ''), 'zh-Hant');
      return direction * String(a.date || '').localeCompare(String(b.date || ''));
    });
  }
  function options(rows, selected, emptyLabel, labelKey = 'name') {
    const state=store.getState(),key=['employees','projects','customers','banks'].find((name)=>rows===state[name]),source=key?store.masterOptions(key):rows;
    return `<option value="">${emptyLabel}</option>${source.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row[labelKey] || row.number || '—')}</option>`).join('')}`;
  }
  function sortButton(key, text) {
    const arrow = filters.sort === key ? (filters.direction === 'asc' ? '↑' : '↓') : '';
    return `<button type="button" class="commission-sort" data-sort="${key}">${text}<span>${arrow}</span></button>`;
  }
  function dailyBatches(state) {
    const groups = new Map();
    (state.dailyLogs || []).forEach((log) => { const key=log.batchId||log.id; if(!groups.has(key))groups.set(key,[]); groups.get(key).push(log); });
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    return [...groups.entries()].map(([batchId,logs]) => {
      const projectGroups=new Map();logs.forEach((log)=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,[]);projectGroups.get(key).push(log)});
      let untaxed=0,gross=0,itemCount=0,billingAmount=0;const projects=[],items=[];
      projectGroups.forEach((members)=>{const first=members[0]||{};projects.push(label(state,'projects',first.project,first.projectName||'—'));const seen=new Set();(first.items||[]).forEach((item,index)=>{const key=item.workItemId||`${first.groupId||first.id}:${index}`;if(seen.has(key))return;seen.add(key);const value=number(item.untaxedSubtotal)||number(item.qty)*number(item.price),shown=number(item.subtotal)||(item.taxMode==='含稅'?store.grossFromUntaxed(value):value);untaxed+=value;gross+=shown;itemCount+=1;if(item.billable!==false&&first.billable!==false&&!first.noInvoice&&(item.billingStatus||first.billingStatus||'未請款')==='未請款'&&!item.billingId&&!first.billingId)billingAmount+=value;items.push(item.item||'')})});
      const employees=[...new Set(logs.map((log)=>label(state,'employees',log.employee,log.employeeName||'—')))];
      const statuses=logs.map((log)=>log.billingStatus||(log.billingId?'已請款':log.billable===false||log.noInvoice?'':'未請款')).filter(Boolean);
      const billingStatus=statuses.includes('已請款')?'已請款':statuses.includes('草稿中')?'草稿中':statuses.includes('未請款')?'未請款':'不需請款';
      return {batchId,logs,date:logs[0]?.date||'',employees,projects:[...new Set(projects)],items,untaxed,gross,itemCount,billingAmount,billingStatus,commission:logs.reduce((sum,log)=>sum+number(log.commission),0),work:logs.reduce((sum,log)=>sum+store.dailyWorkAmount(log),0),note:logs[0]?.note||''};
    }).filter((batch)=>{
      if(filters.month&&!batch.date.startsWith(filters.month))return false;
      if(filters.employee&&!batch.logs.some((log)=>log.employee===filters.employee))return false;
      if(filters.project&&!batch.logs.some((log)=>log.project===filters.project))return false;
      if(filters.billingStatus&&batch.billingStatus!==filters.billingStatus)return false;
      return !query||`${batch.employees.join(' ')} ${batch.projects.join(' ')} ${batch.items.join(' ')} ${batch.note}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  }
  function dailySection(state,batches) {
    return `<section class="commission-panel daily-work-panel"><header><div><h2>每日施工紀錄</h2><p>同一天可記錄多個案場與多筆施工項目；抽成、點工與待請款共用同一筆資料。</p></div><button class="commission-secondary" id="manualCommission" type="button">新增手動抽成</button></header><div class="commission-table-wrap"><table class="commission-table daily-work-table"><thead><tr><th>日期</th><th>員工</th><th>客戶／案場</th><th>施工項目</th><th class="num">未稅施工額</th><th class="num">抽成</th><th class="num">點工薪資</th><th>請款狀態</th><th>操作</th></tr></thead><tbody>${batches.map((batch)=>{const locked=batch.logs.some((log)=>store.payrollHistoryLock(log.employee,log.date).locked),actions=locked?'<span class="commission-status is-settled" title="此紀錄已納入已付款薪資，為保留歷史帳務不可修改。">已付款鎖定</span>':`<div class="commission-row-actions"><button type="button" data-daily-edit="${esc(batch.batchId)}">編輯</button><button type="button" data-daily-delete="${esc(batch.batchId)}">刪除</button></div>`;return `<tr data-daily-batch="${esc(batch.batchId)}"><td>${esc(batch.date)}</td><td><b>${esc(batch.employees.join('、'))}</b></td><td><span class="daily-project-list">${batch.projects.map(esc).join('<br>')}</span></td><td><span class="commission-source">${esc(batch.items.filter(Boolean).slice(0,3).join('、')||'純點工')}${batch.itemCount>3?` 等 ${batch.itemCount} 項`:''}</span></td><td class="num"><b>${money(batch.untaxed)}</b><small>${batch.itemCount} 筆</small></td><td class="num">${money(batch.commission)}</td><td class="num">${money(batch.work)}</td><td><span class="commission-status billing-${batch.billingStatus==='未請款'?'open':batch.billingStatus==='草稿中'?'draft':batch.billingStatus==='已請款'?'done':'none'}">${esc(batch.billingStatus)}</span>${batch.billingAmount>0?`<small>${money(batch.billingAmount)}</small>`:''}</td><td>${actions}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="9">此篩選條件下沒有每日施工紀錄。</td></tr>'}</tbody></table></div></section>`;
  }
  function render() {
    if (!active) return;
    const state = store.getState();
    const rows = rowsFor(state);
    const batches = dailyBatches(state);
    const totalGross = rows.reduce((sum, row) => sum + grossOf(state, row), 0);
    const totalUntaxed = rows.reduce((sum, row) => sum + number(row.untaxedAmount), 0);
    const totalCommission = rows.reduce((sum, row) => sum + number(row.commission), 0);
    const unsettled = rows.filter((row) => row.status !== '已列入薪資').reduce((sum, row) => sum + number(row.commission), 0);
    const settled = rows.filter((row) => row.status === '已列入薪資').reduce((sum, row) => sum + number(row.commission), 0);
    $('#commissionsApp').innerHTML = `
      <section class="commissions-heading">
        <div><h1>員工業績／抽成</h1><p>管理員工業績、抽成與薪資結算</p></div>
        <button class="commission-primary" id="addCommission" type="button">＋ 新增業績／施工</button>
      </section>
      <section class="commission-kpis" aria-label="抽成統計摘要">
        <article><span>本月總業績</span><strong>${money(totalGross)}</strong><small>${rows.length} 筆業績（含稅）</small></article>
        <article><span>本月未稅業績</span><strong>${money(totalUntaxed)}</strong><small>抽成計算基礎</small></article>
        <article><span>本月抽成總額</span><strong>${money(totalCommission)}</strong><small>依正式版公式</small></article>
        <article class="is-warning"><span>未結算抽成</span><strong>${money(unsettled)}</strong><small>尚未列入薪資</small></article>
        <article class="is-success"><span>已結算抽成</span><strong>${money(settled)}</strong><small>已列入薪資</small></article>
      </section>
      <section class="commission-panel commission-filters" aria-label="搜尋與篩選">
        <div class="commission-filter-grid">
          <label><span>月份</span><input id="commissionMonthFilter" type="month" value="${esc(filters.month)}"></label>
          <label><span>員工</span><select id="commissionEmployeeFilter">${options(state.employees, filters.employee, '全部員工')}</select></label>
          <label><span>案場</span><select id="commissionProjectFilter">${options(state.projects, filters.project, '全部案場')}</select></label>
          <label><span>結算狀態</span><select id="commissionStatusFilter"><option value="">全部狀態</option><option value="未列入薪資" ${filters.status === '未列入薪資' ? 'selected' : ''}>未結算</option><option value="已列入薪資" ${filters.status === '已列入薪資' ? 'selected' : ''}>已結算</option></select></label>
          <label><span>請款狀態</span><select id="commissionBillingFilter"><option value="">全部請款狀態</option><option value="未請款" ${filters.billingStatus==='未請款'?'selected':''}>未請款</option><option value="草稿中" ${filters.billingStatus==='草稿中'?'selected':''}>草稿中</option><option value="已請款" ${filters.billingStatus==='已請款'?'selected':''}>已請款</option><option value="不需請款" ${filters.billingStatus==='不需請款'?'selected':''}>不需請款</option></select></label>
          <label class="commission-search"><span>關鍵字搜尋</span><input id="commissionQueryFilter" type="search" value="${esc(filters.query)}" placeholder="員工、案場、來源單號、備註"></label>
          <button class="commission-clear" id="commissionClearFilters" type="button">清除篩選</button>
        </div>
      </section>
      ${dailySection(state,batches)}
      <section class="commission-panel commission-table-panel">
        <header><div><h2>抽成明細</h2><p>由每日施工紀錄自動同步，並保留既有手動抽成資料。</p></div></header>
        <div class="commission-table-wrap"><table class="commission-table">
          <thead><tr><th>${sortButton('date','日期')}</th><th>${sortButton('employee','員工')}</th><th>${sortButton('project','案場')}</th><th>業績來源</th><th class="num">含稅金額</th><th class="num">${sortButton('untaxedAmount','未稅金額')}</th><th class="num">${sortButton('rate','抽成 %')}</th><th class="num">${sortButton('commission','抽成金額')}</th><th>${sortButton('status','結算狀態')}</th><th>操作</th></tr></thead>
          <tbody>${rows.map((row) => { const linkedPayroll = state.payroll.filter((item) => item.month === String(row.date || '').slice(0,7) && item.employee === row.employee),locked=store.payrollHistoryLock(row.employee,row.date).locked,actions=locked?'<span class="commission-status is-settled" title="此紀錄已納入已付款薪資，為保留歷史帳務不可修改。">已付款鎖定</span>':row.sourceType==='daily-log'?'<span class="commission-status" title="請由每日施工來源調整">來源同步</span>':`<div class="commission-row-actions"><button type="button" data-edit="${esc(row.id)}">編輯</button><button type="button" data-delete="${esc(row.id)}">刪除</button></div>`; return `<tr data-row-id="${esc(row.id)}" data-payroll-records="${linkedPayroll.length}" data-payroll-commission="${linkedPayroll.filter((item) => item.status !== '已付款').reduce((sum,item) => sum + number(item.commission),0)}"><td>${esc(row.date || '—')}</td><td><b>${esc(label(state, 'employees', row.employee, row.employeeName || '—'))}</b></td><td>${esc(label(state, 'projects', row.project, row.projectName || '—'))}</td><td><span class="commission-source">${esc(row.sourceNo || (row.sourceType === 'daily-log' ? '每日業績' : '手動登錄'))}</span></td><td class="num">${money(grossOf(state, row))}</td><td class="num">${money(row.untaxedAmount)}</td><td class="num">${number(row.rate)}%</td><td class="num"><b>${money(row.commission)}</b></td><td><span class="commission-status ${row.status === '已列入薪資' ? 'is-settled' : 'is-unsettled'}">${row.status === '已列入薪資' ? '已結算' : '未結算'}</span></td><td>${actions}</td></tr>`; }).join('') || '<tr><td class="commission-empty" colspan="10">此篩選條件下沒有業績紀錄。</td></tr>'}</tbody>
        </table></div>
      </section>
      <div class="commission-drawer-layer" id="commissionDrawerLayer" hidden></div>`;
    bind();
    window.KusheIcons?.render($('#commissionsView'));
  }
  function bind() {
    $('#addCommission').addEventListener('click', () => openDailyDrawer());
    $('#manualCommission').addEventListener('click', () => openDrawer());
    $('#commissionMonthFilter').addEventListener('change', (event) => { filters.month = event.target.value; render(); });
    $('#commissionEmployeeFilter').addEventListener('change', (event) => { filters.employee = event.target.value; render(); });
    $('#commissionProjectFilter').addEventListener('change', (event) => { filters.project = event.target.value; render(); });
    $('#commissionStatusFilter').addEventListener('change', (event) => { filters.status = event.target.value; render(); });
    $('#commissionBillingFilter').addEventListener('change', (event) => { filters.billingStatus = event.target.value; render(); });
    $('#commissionQueryFilter').addEventListener('input', (event) => { filters.query = event.target.value; window.clearTimeout(bind.searchTimer); bind.searchTimer = window.setTimeout(render, 180); });
    $('#commissionClearFilters').addEventListener('click', () => { Object.assign(filters, {month:latestMonth(store.getState()),employee:'',project:'',status:'',billingStatus:'',query:''}); render(); });
    $$('[data-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.sort; filters.direction = filters.sort === key && filters.direction === 'desc' ? 'asc' : 'desc'; filters.sort = key; render(); }));
    $$('[data-edit]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.edit)));
    $$('[data-delete]').forEach((button) => button.addEventListener('click', () => remove(button.dataset.delete)));
    $$('[data-daily-edit]').forEach((button) => button.addEventListener('click', () => openDailyDrawer(button.dataset.dailyEdit)));
    $$('[data-daily-delete]').forEach((button) => button.addEventListener('click', () => removeDaily(button.dataset.dailyDelete)));
  }
  function openDailyDrawerLegacy(batchId='') {
    const state=store.getState(),logs=batchId?(state.dailyLogs||[]).filter((log)=>(log.batchId||log.id)===batchId):[];
    if(logs.some((log)=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')))return window.KushePhase1?.toast('已進入請款流程的施工紀錄不可直接修改');
    editingDailyBatch=batchId;const first=logs[0]||{},employeeIds=new Set(logs.map((log)=>log.employee));
    const projectGroups=new Map();logs.forEach((log)=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,log)});
    let lines=[];projectGroups.forEach((log)=>{(log.items||[]).forEach((item)=>lines.push({project:log.project,item:item.item||'',unit:item.unit||'式',qty:number(item.qty)||1,inputPrice:number(item.inputPrice??item.price),taxMode:item.taxMode||'未稅',billable:item.billable!==false,workItemId:item.workItemId||''}))});
    if(!lines.length)lines=[{project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:''}];
    const workLog=logs.find((log)=>log.workMode&&log.workMode!=='none')||{},commissionEnabled=!logs.length||logs.some((log)=>number(log.performance)>0),layer=$('#commissionDrawerLayer');
    const projectOptions=(selected='')=>`<option value="">請選擇案場</option>${store.masterOptions('projects').map((project)=>{const customer=label(state,'customers',project.customer,project.customerName||'未指定客戶');return `<option value="${esc(project.id)}" ${project.id===selected?'selected':''}>${esc(customer)}｜${esc(project.name)}</option>`}).join('')}`;
    const employeeChoices=store.masterOptions('employees').map((employee)=>`<label class="daily-employee-choice"><input type="checkbox" name="dailyEmployees" value="${esc(employee.id)}" ${employeeIds.has(employee.id)?'checked':''}><span><b>${esc(employee.name)}</b><small>抽成 ${number(employee.commissionRate)}%</small></span></label>`).join('');
    const lineHtml=(line)=>`<tr class="daily-line" data-work-item-id="${esc(line.workItemId||'')}"><td><select class="daily-line-project">${projectOptions(line.project)}</select></td><td><input class="daily-line-item" value="${esc(line.item)}" placeholder="施工項目"></td><td><input class="daily-line-unit" value="${esc(line.unit||'式')}"></td><td><input class="daily-line-qty" type="number" min="0" step="0.01" value="${number(line.qty)||1}"></td><td><select class="daily-line-tax"><option value="未稅" ${line.taxMode!=='含稅'?'selected':''}>未稅</option><option value="含稅" ${line.taxMode==='含稅'?'selected':''}>含稅</option></select></td><td><input class="daily-line-price" type="number" min="0" step="0.01" value="${number(line.inputPrice)}"></td><td class="num"><b class="daily-line-total">$0</b><small class="daily-line-untaxed">未稅 $0</small></td><td><label class="daily-billable"><input type="checkbox" ${line.billable!==false?'checked':''}><span>列入待請款</span></label></td><td><button type="button" class="daily-line-remove">刪除</button></td></tr>`;
    layer.innerHTML=`<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer daily-drawer" role="dialog" aria-modal="true" aria-labelledby="dailyDrawerTitle"><header><div><small>每日施工、薪資與待請款共用資料</small><h2 id="dailyDrawerTitle">${batchId?'編輯':'新增'}每日施工紀錄</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header><form id="dailyWorkForm"><div class="commission-drawer-body daily-drawer-body"><div class="daily-form-grid full"><label><span>日期 *</span><input name="date" type="date" value="${esc(first.date||today())}" required></label><label class="daily-wide"><span>備註／工作內容</span><input name="note" value="${esc(first.note||'')}" placeholder="現場說明或施工備註"></label></div><section class="daily-form-section full"><div class="daily-section-title"><div><h3>員工</h3><p>可複選；同一員工同一天可前往多個案場。</p></div></div><div class="daily-employee-grid">${employeeChoices}</div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>案場與施工項目</h3><p>每列可選不同案場；單價 × 數量依正式版規則計算。</p></div><button type="button" class="commission-secondary" id="addDailyLine">＋ 新增案場／項目</button></div><div class="daily-lines-wrap"><table class="daily-lines-table"><thead><tr><th>客戶／案場</th><th>施工項目</th><th>單位</th><th>數量</th><th>稅別</th><th>單價</th><th>小計</th><th>用途</th><th></th></tr></thead><tbody id="dailyLines">${lines.map(lineHtml).join('')}</tbody></table></div><div class="daily-total-bar"><span>施工含稅／輸入合計 <b id="dailyGrossTotal">$0</b></span><span>未稅施工合計 <b id="dailyUntaxedTotal">$0</b></span><span>預估抽成 <b id="dailyCommissionTotal">$0</b></span><span>待請款施工 <b id="dailyBillingTotal">$0</b></span></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>計薪方式</h3><p>可只計抽成、只計點工，或同時使用；日薪同員工同日只計一次。</p></div></div><div class="daily-pay-grid"><label class="daily-check"><input name="commissionEnabled" type="checkbox" ${commissionEnabled?'checked':''}><span>業績抽成（依未稅業績）</span></label><label><span>點工方式</span><select name="workMode"><option value="none" ${!workLog.workMode||workLog.workMode==='none'?'selected':''}>不計點工</option><option value="daily" ${workLog.workMode==='daily'?'selected':''}>日薪</option><option value="hourly" ${workLog.workMode==='hourly'?'selected':''}>時薪</option></select></label><label><span>點工天數／時數</span><input name="workQty" type="number" min="0" step="0.5" value="${number(workLog.workQty)}"></label><label><span>日薪／時薪單價</span><input name="workRate" type="number" min="0" step="1" value="${number(workLog.workRate)}"></label><div class="daily-work-preview"><span>每位員工點工薪資</span><b id="dailyWorkTotal">$0</b></div></div></section></div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存每日施工</button></footer></form></aside>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));const form=$('#dailyWorkForm',layer),body=$('#dailyLines',layer);
    const calc=()=>{let gross=0,untaxed=0,billing=0;$$('.daily-line',body).forEach((row)=>{const qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal;gross+=subtotal;untaxed+=lineUntaxed;if($('.daily-billable input',row).checked)billing+=lineUntaxed;$('.daily-line-total',row).textContent=money(subtotal);$('.daily-line-untaxed',row).textContent=`未稅 ${money(lineUntaxed)}`});const ids=$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),commission=form.elements.commissionEnabled.checked?ids.reduce((sum,id)=>sum+Math.round(untaxed*number(state.employees.find((employee)=>employee.id===id)?.commissionRate)/100),0):0,work=form.elements.workMode.value==='none'?0:number(form.elements.workQty.value)*number(form.elements.workRate.value);$('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work)};
    const bindLines=()=>{$$('.daily-line input,.daily-line select',body).forEach((input)=>{input.oninput=calc;input.onchange=calc});$$('.daily-line-remove',body).forEach((button)=>button.onclick=()=>{if(body.children.length>1)button.closest('tr').remove();else button.closest('tr').querySelectorAll('input').forEach((input)=>input.value='');calc()})};
    $('#addDailyLine',layer).onclick=()=>{body.insertAdjacentHTML('beforeend',lineHtml({project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:''}));bindLines();calc()};bindLines();$$('input[name="dailyEmployees"],select[name="workMode"],input[name="workQty"],input[name="workRate"],input[name="commissionEnabled"]',form).forEach((input)=>{input.oninput=calc;input.onchange=calc});form.onsubmit=submitDaily;$$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach((button)=>button.addEventListener('click',closeDrawer));calc();
  }
  function openDailyDrawer(batchId='') {
    const state=store.getState(),logs=batchId?(state.dailyLogs||[]).filter((log)=>(log.batchId||log.id)===batchId):[];
    if(logs.some((log)=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')))return window.KushePhase1?.toast('已進入請款流程的施工紀錄不可直接修改');
    if(logs.some((log)=>store.payrollHistoryLock(log.employee,log.date).locked))return window.KushePhase1?.toast('此施工紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。');
    editingDailyBatch=batchId;
    const first=logs[0]||{},employeeIds=new Set(logs.map((log)=>log.employee)),projectGroups=new Map();
    logs.forEach((log)=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,log)});
    let lines=[];
    projectGroups.forEach((log)=>{(log.items||[]).forEach((item)=>lines.push({
      project:log.project,item:item.itemName||item.item||'',unit:item.unit||'式',qty:number(item.qty)||1,inputPrice:number(item.unitPrice??item.inputPrice??item.price),taxMode:item.taxMode||'未稅',billable:item.billable!==false,workItemId:item.workItemId||'',sourceType:item.sourceType||(item.quotationId?'quotation':'manual'),quotationId:item.quotationId||item.quoteId||'',quotationLineId:item.quotationLineId||item.quoteLineId||'',quotationNo:item.quotationNo||'',pricingType:item.pricingType||'actual',lumpSumAmount:number(item.lumpSumAmount)
    }))});
    if(!lines.length)lines=[{project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:'',sourceType:'manual',pricingType:'actual'}];
    const workLog=logs.find((log)=>log.workMode&&log.workMode!=='none')||{},commissionEnabled=!logs.length||logs.some((log)=>number(log.performance)>0),layer=$('#commissionDrawerLayer');
    const projectOptions=(selected='')=>`<option value="">請選擇案場</option>${store.masterOptions('projects').map((project)=>{const customer=label(state,'customers',project.customer,project.customerName||'未指定客戶');return `<option value="${esc(project.id)}" ${String(project.id)===String(selected)?'selected':''}>${esc(customer)}｜${esc(project.name)}</option>`}).join('')}`;
    const employeeChoices=store.masterOptions('employees').map((employee)=>`<label class="daily-employee-choice"><input type="checkbox" name="dailyEmployees" value="${esc(employee.id)}" ${employeeIds.has(employee.id)?'checked':''}><span><b>${esc(employee.name)}</b><small>抽成 ${number(employee.commissionRate)}%</small></span></label>`).join('');
    const quoteChoices=(projectId)=>{const project=state.projects.find((row)=>String(row.id)===String(projectId));return project?(store.confirmedQuotationItems?.(project.id,project.customer)||[]).map((item)=>({...item,sourceType:'quotation'})):[]};
    const manualChoices=(projectId)=>(store.dailyManualItems?.(projectId)||[]).map((item)=>({...item,sourceType:'manual'}));
    const lineChoices=(projectId)=>[...quoteChoices(projectId),...manualChoices(projectId)];
    const quoteLabel=(item)=>item.sourceType==='manual'?`${item.item}｜${money(item.price)}/${item.unit||'式'}｜案場歷史`:item.pricingType==='lump_sum'?`${item.item}｜總價 ${money(item.lumpSumAmount)}｜${item.quotationNo||'已確認報價'}`:`${item.item}｜${money(item.price)}/${item.unit||'式'}｜${item.quotationNo||'已確認報價'}`;
    const lineHtml=(line)=>{
      const listId=`dailyQuoteItems${++dailyLineSequence}`,choices=lineChoices(line.project),selected=choices.find((item)=>item.sourceType==='quotation'&&String(item.quotationId)===String(line.quotationId)&&String(item.quotationLineId)===String(line.quotationLineId));
      const shown=selected?quoteLabel(selected):(line.item||'');
      return `<tr class="daily-line" data-work-item-id="${esc(line.workItemId||'')}" data-item-name="${esc(line.item||'')}" data-source-type="${esc(selected?'quotation':line.sourceType||'manual')}" data-quotation-id="${esc(selected?.quotationId||line.quotationId||'')}" data-quotation-line-id="${esc(selected?.quotationLineId||line.quotationLineId||'')}" data-pricing-type="${esc(selected?.pricingType||line.pricingType||'actual')}" data-lump-sum-amount="${number(selected?.lumpSumAmount??line.lumpSumAmount)}"><td><select class="daily-line-project">${projectOptions(line.project)}</select></td><td><input class="daily-line-item" type="search" list="${listId}" value="${esc(shown)}" placeholder="搜尋或輸入施工項目" autocomplete="off"><datalist id="${listId}" class="daily-quote-options">${choices.map((item)=>`<option value="${esc(quoteLabel(item))}"></option>`).join('')}</datalist><small class="daily-quote-hint"></small></td><td><input class="daily-line-unit" value="${esc(selected?.unit||line.unit||'式')}" ${selected?'readonly':''}></td><td><input class="daily-line-qty" type="number" min="0" step="0.01" value="${number(line.qty)||1}"></td><td><select class="daily-line-tax" ${selected?'disabled':''}><option value="未稅" ${(selected?.taxMode||line.taxMode)!=='含稅'?'selected':''}>未稅</option><option value="含稅" ${(selected?.taxMode||line.taxMode)==='含稅'?'selected':''}>含稅</option></select></td><td><input class="daily-line-price" type="number" min="0" step="0.01" value="${number(selected?(selected.pricingType==='lump_sum'?selected.lumpSumAmount:selected.price):line.inputPrice)}" ${selected?'readonly':''}></td><td class="num"><b class="daily-line-total">$0</b><small class="daily-line-untaxed">未稅 $0</small></td><td><label class="daily-billable"><input type="checkbox" ${line.billable!==false?'checked':''}><span>列入待請款</span></label></td><td><button type="button" class="daily-line-remove">刪除</button></td></tr>`;
    };
    layer.innerHTML=`<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer daily-drawer" role="dialog" aria-modal="true" aria-labelledby="dailyDrawerTitle"><header><div><small>每日施工、薪資與待請款共用資料</small><h2 id="dailyDrawerTitle">${batchId?'編輯':'新增'}每日施工紀錄</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header><form id="dailyWorkForm"><div class="commission-drawer-body daily-drawer-body"><div class="daily-form-grid full"><label><span>日期 *</span><input name="date" type="date" value="${esc(first.date||today())}" required></label><label class="daily-wide"><span>備註／工作內容</span><input name="note" value="${esc(first.note||'')}" placeholder="現場說明或施工備註"></label></div><section class="daily-form-section full"><div class="daily-section-title"><div><h3>員工</h3><p>可複選；同一員工同一天可前往多個案場。</p></div></div><div class="daily-employee-grid">${employeeChoices}</div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>案場與施工項目</h3><p>選案場後可搜尋該案場所有已確認報價項目；報價單價會保存為施工快照。</p></div><button type="button" class="commission-secondary" id="addDailyLine">＋ 新增案場／項目</button></div><div class="daily-lines-wrap"><table class="daily-lines-table"><thead><tr><th>客戶／案場</th><th>施工項目</th><th>單位</th><th>數量</th><th>稅別</th><th>單價</th><th>小計</th><th>用途</th><th></th></tr></thead><tbody id="dailyLines">${lines.map(lineHtml).join('')}</tbody></table></div><div class="daily-total-bar"><span>施工含稅／輸入合計 <b id="dailyGrossTotal">$0</b></span><span>未稅施工合計 <b id="dailyUntaxedTotal">$0</b></span><span>預估抽成 <b id="dailyCommissionTotal">$0</b></span><span>待請款施工 <b id="dailyBillingTotal">$0</b></span></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>計薪方式</h3><p>可只計抽成、只計點工，或同時使用；日薪同員工同日只計一次。</p></div></div><div class="daily-pay-grid"><label class="daily-check"><input name="commissionEnabled" type="checkbox" ${commissionEnabled?'checked':''}><span>業績抽成（依未稅業績）</span></label><label><span>點工方式</span><select name="workMode"><option value="none" ${!workLog.workMode||workLog.workMode==='none'?'selected':''}>不計點工</option><option value="daily" ${workLog.workMode==='daily'?'selected':''}>日薪</option><option value="hourly" ${workLog.workMode==='hourly'?'selected':''}>時薪</option></select></label><label><span>點工天數／時數</span><input name="workQty" type="number" min="0" step="0.5" value="${number(workLog.workQty)}"></label><label><span>日薪／時薪單價</span><input name="workRate" type="number" min="0" step="1" value="${number(workLog.workRate)}"></label><div class="daily-work-preview"><span>每位員工點工薪資</span><b id="dailyWorkTotal">$0</b></div></div></section></div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存每日施工</button></footer></form></aside>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));
    const form=$('#dailyWorkForm',layer),body=$('#dailyLines',layer);
    const choicesForRow=(row)=>lineChoices($('.daily-line-project',row).value);
    const clearQuote=(row)=>{row.dataset.sourceType='manual';row.dataset.quotationId='';row.dataset.quotationLineId='';row.dataset.quotationNo='';row.dataset.pricingType='actual';row.dataset.lumpSumAmount='0';row.dataset.itemName=$('.daily-line-item',row).value.trim();$('.daily-line-unit',row).readOnly=false;$('.daily-line-price',row).readOnly=false;$('.daily-line-tax',row).disabled=false;$('.daily-billable input',row).disabled=false};
    const updateHint=(row)=>{const projectId=$('.daily-line-project',row).value,quotes=quoteChoices(projectId),manual=manualChoices(projectId),hint=$('.daily-quote-hint',row);if(!projectId){hint.textContent='請先選擇客戶／案場。';return}if(!quotes.length&&!manual.length){hint.textContent='此案場尚無已確認報價或施工歷史，可手動輸入施工項目。';return}if(row.dataset.sourceType==='quotation'){const type=row.dataset.pricingType==='lump_sum'?'總價（施工數量不增加待請款）':'實做實算';hint.textContent=`已連結 ${row.dataset.quotationNo||'已確認報價'}｜${type}`;return}if(row.dataset.itemName&&manual.some((item)=>item.item===row.dataset.itemName)){hint.textContent='已帶入此案場的手動施工歷史，可再修改單位或單價。';return}hint.textContent=quotes.length?'優先顯示此案場已確認報價，另含此案場自己的施工歷史。':'此案場尚無已確認報價，僅顯示此案場自己的施工歷史。'};
    const refreshChoices=(row)=>{const list=$('.daily-quote-options',row),choices=choicesForRow(row);list.innerHTML=choices.map((item)=>`<option value="${esc(quoteLabel(item))}"></option>`).join('');updateHint(row)};
    const applyChoice=(row)=>{const input=$('.daily-line-item',row),value=input.value.trim(),choices=choicesForRow(row);let matched=choices.find((item)=>quoteLabel(item)===value);if(!matched){const exact=choices.filter((item)=>item.item===value);if(exact.length===1)matched=exact[0]}if(!matched){clearQuote(row);updateHint(row);return false}const quoted=matched.sourceType==='quotation';row.dataset.sourceType=quoted?'quotation':'manual';row.dataset.quotationId=quoted?matched.quotationId:'';row.dataset.quotationLineId=quoted?matched.quotationLineId:'';row.dataset.quotationNo=quoted?(matched.quotationNo||''):'';row.dataset.pricingType=matched.pricingType||'actual';row.dataset.lumpSumAmount=String(number(matched.lumpSumAmount));row.dataset.itemName=matched.item;input.value=quoteLabel(matched);const unit=$('.daily-line-unit',row),price=$('.daily-line-price',row),tax=$('.daily-line-tax',row),billable=$('.daily-billable input',row);unit.value=matched.unit||'式';unit.readOnly=quoted;price.value=matched.pricingType==='lump_sum'?number(matched.lumpSumAmount):number(matched.price);price.readOnly=quoted;tax.value=matched.taxMode||'未稅';tax.disabled=quoted;billable.checked=matched.pricingType!=='lump_sum';billable.disabled=matched.pricingType==='lump_sum';updateHint(row);return true};
    const calc=()=>{let gross=0,untaxed=0,billing=0;$$('.daily-line',body).forEach((row)=>{const isLump=row.dataset.pricingType==='lump_sum',qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=isLump?0:qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal;gross+=subtotal;untaxed+=lineUntaxed;if(!isLump&&$('.daily-billable input',row).checked)billing+=lineUntaxed;$('.daily-line-total',row).textContent=isLump?'進度紀錄':money(subtotal);$('.daily-line-untaxed',row).textContent=isLump?'總價不重複累計':`未稅 ${money(lineUntaxed)}`});const ids=$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),commission=form.elements.commissionEnabled.checked?ids.reduce((sum,id)=>sum+Math.round(untaxed*number(state.employees.find((employee)=>employee.id===id)?.commissionRate)/100),0):0,work=form.elements.workMode.value==='none'?0:number(form.elements.workQty.value)*number(form.elements.workRate.value);$('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work)};
    const bindRow=(row)=>{const project=$('.daily-line-project',row),item=$('.daily-line-item',row);project.onchange=()=>{item.value='';clearQuote(row);$('.daily-line-unit',row).value='式';$('.daily-line-price',row).value='0';$('.daily-line-tax',row).value='未稅';$('.daily-billable input',row).checked=true;refreshChoices(row);calc()};item.oninput=()=>{applyChoice(row);calc()};item.onchange=()=>{applyChoice(row);calc()};$$('input,select',row).forEach((input)=>{if(input!==project&&input!==item){input.oninput=calc;input.onchange=calc}});$('.daily-line-remove',row).onclick=()=>{if(body.children.length>1)row.remove();else{item.value='';clearQuote(row);$('.daily-line-unit',row).value='式';$('.daily-line-price',row).value='0'}calc()};if(row.dataset.sourceType==='quotation')applyChoice(row);else updateHint(row)};
    $('#addDailyLine',layer).onclick=()=>{body.insertAdjacentHTML('beforeend',lineHtml({project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:'',sourceType:'manual',pricingType:'actual'}));bindRow(body.lastElementChild);calc()};
    $$('.daily-line',body).forEach(bindRow);$$('input[name="dailyEmployees"],select[name="workMode"],input[name="workQty"],input[name="workRate"],input[name="commissionEnabled"]',form).forEach((input)=>{input.oninput=calc;input.onchange=calc});form.onsubmit=submitDaily;$$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach((button)=>button.addEventListener('click',closeDrawer));calc();
  }
  async function submitDaily(event){event.preventDefault();const form=event.currentTarget,lines=$$('.daily-line',form).map((row)=>({project:$('.daily-line-project',row).value,item:row.dataset.itemName||$('.daily-line-item',row).value.trim(),itemName:row.dataset.itemName||$('.daily-line-item',row).value.trim(),unit:$('.daily-line-unit',row).value.trim()||'式',qty:number($('.daily-line-qty',row).value),inputPrice:number($('.daily-line-price',row).value),unitPrice:number($('.daily-line-price',row).value),taxMode:$('.daily-line-tax',row).value,billable:row.dataset.pricingType!=='lump_sum'&&$('.daily-billable input',row).checked,sourceType:row.dataset.sourceType||'manual',pricingType:row.dataset.pricingType||'actual',quotationId:row.dataset.quotationId||'',quotationLineId:row.dataset.quotationLineId||'',quoteId:row.dataset.quotationId||'',quoteLineId:row.dataset.quotationLineId||'',lumpSumAmount:number(row.dataset.lumpSumAmount),workItemId:row.dataset.workItemId||''})),values={date:form.elements.date.value,employeeIds:$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),lines,commissionEnabled:form.elements.commissionEnabled.checked,workMode:form.elements.workMode.value,workQty:number(form.elements.workQty.value),workRate:number(form.elements.workRate.value),note:form.elements.note.value.trim()},button=$('button[type="submit"]',form);button.disabled=true;button.textContent='儲存中…';try{await store.saveDailyBatch(values,editingDailyBatch);closeDrawer();render();window.KushePhase1?.toast('每日施工、抽成、點工與待請款已同步儲存')}catch(error){button.disabled=false;button.textContent='儲存每日施工';window.KushePhase1?.toast(`儲存失敗：${error.message}`)}}
  async function removeDaily(batchId){const batch=dailyBatches(store.getState()).find((row)=>row.batchId===batchId);if(!batch||!window.confirm(`確定刪除 ${batch.date} 的每日施工紀錄？抽成與點工薪資會同步重算。`))return;try{await store.deleteDailyBatch(batchId);render();window.KushePhase1?.toast('每日施工已刪除，薪資與待請款已同步重算')}catch(error){window.KushePhase1?.toast(error.message)}}
  function openDrawer(id = null) {
    const state = store.getState();
    const row = id ? state.commissions.find((item) => item.id === id) : null;
    if(row&&store.payrollHistoryLock(row.employee,row.date).locked)return window.KushePhase1?.toast('此抽成紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。');
    if(row?.sourceType==='daily-log')return window.KushePhase1?.toast('每日施工衍生抽成必須由每日施工來源調整。');
    editingId = row?.id || null;
    const gross = row ? grossOf(state, row) : 0;
    const layer = $('#commissionDrawerLayer');
    layer.innerHTML = `<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer" role="dialog" aria-modal="true" aria-labelledby="commissionDrawerTitle">
      <header><div><small>${editingId ? '編輯既有紀錄' : '建立新紀錄'}</small><h2 id="commissionDrawerTitle">${editingId ? '編輯業績' : '新增業績'}</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header>
      <form id="commissionForm"><div class="commission-drawer-body">
        <label><span>日期 *</span><input name="date" type="date" value="${esc(row?.date || today())}" required></label>
        <label><span>員工 *</span><select name="employee" required>${options(state.employees, row?.employee || '', '請選擇員工')}</select></label>
        <label><span>案場 *</span><select name="project" required>${options(state.projects, row?.project || '', '請選擇案場')}</select></label>
        <label class="full"><span>請款單／業績來源</span><select name="billing"><option value="">手動登錄</option>${(state.billings || []).map((billing) => `<option value="${esc(billing.id)}" ${billing.number && billing.number === row?.sourceNo ? 'selected' : ''}>${esc(billing.number || '未編號')}｜${esc(label(state, 'projects', billing.project, billing.projectName || '未指定案場'))}｜${money(billing.total || billing.amount)}</option>`).join('')}</select></label>
        <label class="full"><span>來源單號</span><input name="sourceNo" value="${esc(row?.sourceNo || '')}" placeholder="例如：請款單號或手動來源"></label>
        <label><span>含稅金額 *</span><input name="gross" type="number" min="0" step="1" value="${gross}" required></label>
        <label><span>未稅金額</span><input name="untaxedAmount" type="number" value="${number(row?.untaxedAmount)}" readonly></label>
        <label><span>抽成比例（%）*</span><input name="rate" type="number" min="0" step="0.1" value="${number(row?.rate)}" required></label>
        <label><span>抽成金額</span><input name="commission" type="number" value="${number(row?.commission)}" readonly></label>
        <label class="full"><span>結算狀態</span><select name="status"><option value="未列入薪資" ${row?.status !== '已列入薪資' ? 'selected' : ''}>未結算（未列入薪資）</option><option value="已列入薪資" ${row?.status === '已列入薪資' ? 'selected' : ''}>已結算（列入薪資）</option></select></label>
        <label class="full"><span>備註</span><textarea name="note" rows="3" placeholder="補充說明">${esc(row?.note || '')}</textarea></label>
        <div class="commission-calc-note full"><b>正式版計算規則</b><span id="commissionTaxHint">含稅 → 未稅 → 抽成金額</span></div>
      </div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存業績</button></footer></form>
    </aside>`;
    layer.hidden = false;
    requestAnimationFrame(() => layer.classList.add('is-open'));
    const form = $('#commissionForm', layer);
    const calc = () => {
      const values = store.taxValues(form.elements.gross.value);
      form.elements.untaxedAmount.value = values.untaxed;
      form.elements.commission.value = Math.round(values.untaxed * number(form.elements.rate.value) / 100);
      $('#commissionTaxHint', layer).textContent = `${money(values.total)} ÷ 1.${String(values.rate).padStart(2,'0')} = ${money(values.untaxed)}（未稅）；抽成 ${money(form.elements.commission.value)}`;
    };
    form.elements.employee.addEventListener('change', () => { const employee = state.employees.find((item) => item.id === form.elements.employee.value); if (employee && !number(form.elements.rate.value)) form.elements.rate.value = number(employee.commissionRate); calc(); });
    form.elements.billing.addEventListener('change', () => { const billing = state.billings.find((item) => item.id === form.elements.billing.value); if (!billing) return; form.elements.date.value = billing.date || form.elements.date.value; form.elements.project.value = billing.project || ''; form.elements.sourceNo.value = billing.number || ''; form.elements.gross.value = number(billing.total) || store.grossFromUntaxed(billing.amount); form.elements.untaxedAmount.value = number(billing.amount); form.elements.commission.value = Math.round(number(billing.amount) * number(form.elements.rate.value) / 100); $('#commissionTaxHint', layer).textContent = `已由 ${billing.number || '請款單'} 帶入既有未稅金額 ${money(billing.amount)}`; });
    ['gross','rate'].forEach((name) => form.elements[name].addEventListener('input', calc));
    form.addEventListener('submit', submit);
    $$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]', layer).forEach((button) => button.addEventListener('click', closeDrawer));
    calc();
  }
  function closeDrawer() {
    const layer = $('#commissionDrawerLayer');
    layer.classList.remove('is-open');
    window.setTimeout(() => { layer.hidden = true; layer.innerHTML = ''; }, 180);
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const button = $('button[type="submit"]', form); button.disabled = true; button.textContent = '儲存中…';
    try {
      await store.saveCommission(values, editingId);
      closeDrawer(); render(); window.KushePhase1?.toast('業績已自動儲存，薪資連動已同步');
    } catch (error) { button.disabled = false; button.textContent = '儲存業績'; window.KushePhase1?.toast(`儲存失敗：${error.message}`); }
  }
  async function remove(id) {
    const state = store.getState(); const row = state.commissions.find((item) => item.id === id);
    if (!row || !window.confirm(`確定刪除 ${label(state,'employees',row.employee,'此員工')} 的這筆業績？`)) return;
    try{await store.deleteCommission(id);render();window.KushePhase1?.toast('業績已刪除，薪資連動已重算')}catch(error){window.KushePhase1?.toast(error.message)}
  }
  async function activate() {
    active = true;
    if (!ready) { await store.load(); filters.month = latestMonth(store.getState()); ready = true; }
    render();
  }
  function deactivate() { active = false; }
  window.addEventListener('kushe:data-updated', () => { if (active) render(); });
  window.KusheCommissions = { activate, deactivate, render };
}());
