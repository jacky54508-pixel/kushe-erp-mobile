(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const store = window.KuSheERPStore;
  const filters = { month: '', employee: '', project: '', query: '', sort: 'date', direction: 'desc' };
  let ready = false;
  let active = false;
  let activeTab = 'daily';
  let editingId = null;
  let editingDailyBatch = '';
  let dailyLineSequence = 0;
  let quickProjectSaveActive = false;
  let dailySubmitInFlight = false;
  let dailyEditorActive = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD', maximumFractionDigits:0 }).format(Number(value) || 0);
  const number = (value) => Number(value) || 0;
  const normalizedProjectName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-Hant');
  function splitPerformanceAmount(amount, count, index) {
    const parts = Math.max(0, Math.trunc(number(count)));
    const partIndex = Math.max(0, Math.trunc(number(index)));
    if (!parts || partIndex >= parts) return 0;
    const cents = Math.round(number(amount) * 100);
    const base = Math.floor(cents / parts);
    const remainder = cents - base * parts;
    return (base + (partIndex < remainder ? 1 : 0)) / 100;
  }
  function previewCommissionTotal(amount, employeeIds, employees) {
    const sortedEmployeeIds = [...(employeeIds || [])].sort((a, b) => {
      const left = String(a);
      const right = String(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const performanceIndexByEmployeeId = new Map(
      sortedEmployeeIds.map((employeeId, index) => [employeeId, index])
    );
    return sortedEmployeeIds.reduce((sum, employeeId) => {
      const performance = splitPerformanceAmount(
        amount,
        sortedEmployeeIds.length,
        performanceIndexByEmployeeId.get(employeeId)
      );
      const employee = (employees || []).find((row) => row.id === employeeId) || {};
      return sum + Math.round(performance * number(employee.commissionRate) / 100);
    }, 0);
  }
  const parseHouseBatch = (value) => {
    const seen = new Set();
    return String(value || '').split(/[\r\n,，、;；]+/).map((item) => item.trim()).filter((item) => item && !seen.has(item) && seen.add(item));
  };
  const cloneDailyLineDraft = (line, house = '') => ({...line, house, workItemId:''});
  const houseBatchPlan = (currentHouse, value) => {
    const current = String(currentHouse || '').trim(), parsed = parseHouseBatch(value);
    if (!parsed.length) return {templateHouse:current, cloneHouses:[], houses:[]};
    const cloneHouses = current ? parsed.filter((house) => house !== current) : parsed.slice(1);
    return {templateHouse:current || parsed[0], cloneHouses, houses:current ? [current, ...cloneHouses] : parsed};
  };
  const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' });
  const today = (date = new Date()) => {
    const parts = Object.fromEntries(businessDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const monthNow = (date = new Date()) => today(date).slice(0, 7);
  function label(state, module, id, fallback = '—') {
    const row = (state[module] || []).find((item) => item.id === id);
    return row?.name || row?.number || fallback;
  }
  function grossOf(state, row) {
    const billing = (state.billings || []).find((item) => item.number && item.number === row.sourceNo);
    if (billing && number(billing.amount) === number(row.untaxedAmount) && number(billing.total)) return number(billing.total);
    return store.grossFromUntaxed(row.untaxedAmount);
  }
  const employeeIdOf = (row) => String(row?.employee || row?.employeeId || '');
  const projectIdOf = (row) => String(row?.project || row?.projectId || '');
  function rowsFor(state) {
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    const rows = (state.commissions || []).filter((row) => {
      if (filters.month && !String(row.date || '').startsWith(filters.month)) return false;
      if (filters.employee && row.employee !== filters.employee) return false;
      if (filters.project && row.project !== filters.project) return false;
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
  function attendanceRowsFor(state) {
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    return (state.attendance || []).filter((row) => {
      const employeeId = employeeIdOf(row), projectId = projectIdOf(row);
      if (filters.month && !String(row.date || '').startsWith(filters.month)) return false;
      if (filters.employee && employeeId !== filters.employee) return false;
      if (filters.project && projectId !== filters.project) return false;
      const employee = label(state, 'employees', employeeId, row.employeeName || '');
      const project = label(state, 'projects', projectId, row.projectName || '');
      return !query || `${employee} ${project} ${row.sourceNo || ''} ${row.note || ''} ${row.workMode || ''}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
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
      return !query||`${batch.employees.join(' ')} ${batch.projects.join(' ')} ${batch.items.join(' ')} ${batch.note}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  }
  const houseCollator = new Intl.Collator('zh-Hant', {numeric:true, sensitivity:'base'});
  function compareDailyHouse(a, b) {
    const left=String(a??'').trim(),right=String(b??'').trim(),x=/^(\d+)(.*)$/.exec(left),y=/^(\d+)(.*)$/.exec(right);
    if(x&&y){
      const xn=x[1].replace(/^0+(?=\d)/,''),yn=y[1].replace(/^0+(?=\d)/,'');
      if(xn.length!==yn.length)return xn.length-yn.length;
      if(xn!==yn)return xn<yn?-1:1;
      const xs=x[2].toUpperCase(),ys=y[2].toUpperCase();
      if(/^[A-Z]*$/.test(xs)&&/^[A-Z]*$/.test(ys))return xs<ys?-1:xs>ys?1:0;
      return houseCollator.compare(xs,ys);
    }
    if(x||y)return x?-1:1;
    return houseCollator.compare(left,right);
  }
  function dailyPrintProjects(state, batches) {
    const projects=new Map();
    batches.forEach(batch=>{
      const groups=new Map();
      batch.logs.filter(log=>(!filters.employee||employeeIdOf(log)===filters.employee)&&(!filters.project||projectIdOf(log)===filters.project)&&(!filters.month||String(log.date||'').startsWith(filters.month))).forEach(log=>{
        const key=JSON.stringify([projectIdOf(log),log.groupId||log.id]);
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(log);
      });
      groups.forEach(logs=>{
        const first=logs[0],projectId=projectIdOf(first),key=projectId||`missing:${first.id}`;
        if(!projects.has(key))projects.set(key,{name:label(state,'projects',projectId,first.projectName||'未指定案場'),houses:new Map()});
        const project=projects.get(key),employees=[...new Set(logs.map(log=>label(state,'employees',employeeIdOf(log),log.employeeName||'—')))];
        // Shared employee records describe one work group, just as dailyBatches does.
        const seen=new Set();
        (first.items||[]).forEach((item,index)=>{
          const source=item.workItemId||index;if(seen.has(source))return;seen.add(source);
          const house=String(item.house??'').trim(),name=String(item.itemName||item.item||'—'),unit=String(item.unit||'—'),price=number(item.inputPrice??item.unitPrice??item.price);
          if(!project.houses.has(house))project.houses.set(house,{house,rows:new Map()});
          const rows=project.houses.get(house).rows;
          const identity=JSON.stringify([name,unit,price,item.taxMode||'未稅',item.pricingType||'actual']);
          if(!rows.has(identity))rows.set(identity,{item:name,unit,price,qty:0,amount:0,employees:[]});
          const row=rows.get(identity),qty=number(item.qty);
          row.qty+=qty;
          row.amount+=item.untaxedSubtotal!==undefined&&item.untaxedSubtotal!==null&&item.untaxedSubtotal!==''?number(item.untaxedSubtotal):qty*number(item.price??price);
          employees.forEach(name=>{if(!row.employees.includes(name))row.employees.push(name)});
        });
      });
    });
    return [...projects.values()].map(project=>({name:project.name,houses:[...project.houses.values()].sort((a,b)=>compareDailyHouse(a.house,b.house)).map(house=>({house:house.house,rows:[...house.rows.values()]}))}));
  }
  function dailyPrintHtml(state, projects) {
    const fmt=value=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:10}).format(value);
    let qty=0,amount=0;
    const sections=projects.map(project=>`<section><h2>${esc(project.name)}</h2><table><thead><tr><th>戶別</th><th>施工項目</th><th>員工</th><th>單位</th><th class="num">單價</th><th class="num">數量</th><th class="num">未稅小計</th></tr></thead><tbody>${project.houses.map(group=>group.rows.map((row,index)=>{qty+=row.qty;amount+=row.amount;return `<tr><td>${index===0?esc(group.house||'—'):''}</td><td>${esc(row.item)}</td><td>${esc(row.employees.join('、'))}</td><td>${esc(row.unit)}</td><td class="num">${esc(fmt(row.price))}</td><td class="num">${esc(fmt(row.qty))}</td><td class="num">${esc(fmt(row.amount))}</td></tr>`}).join('')).join('')}</tbody></table></section>`).join('');
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>每日業績施工統計</title><style>
      @page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#172234;margin:24px;font-size:12px}h1{font-size:24px;margin:0 0 12px}h2{font-size:17px;margin:22px 0 8px;break-after:avoid}p{line-height:1.8;color:#465265}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #cbd2dc;padding:8px;text-align:left;overflow-wrap:anywhere;vertical-align:top}th{background:#eef2f6}th:first-child{width:8%}th:nth-child(2){width:24%}th:nth-child(3){width:24%}th:nth-child(4){width:7%}.num{text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid}.total{text-align:right;font-weight:bold;margin-top:20px}.toolbar{margin-bottom:24px}.toolbar button{padding:10px 18px;margin-right:12px}@media print{body{margin:0}.toolbar{display:none}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">列印／另存為 PDF</button><button onclick="window.close()">關閉</button></div><h1>每日業績施工統計</h1><p>篩選期間：${esc(filters.month||'全部')}　員工：${esc(filters.employee?label(state,'employees',filters.employee):'全部')}<br>案場：${esc(filters.project?label(state,'projects',filters.project):'全部')}　關鍵字：${esc(filters.query||'無')}<br>同一篩選期間內依案場、戶別及施工計價整合；金額為來源未稅小計。</p>${sections||'<p>目前篩選條件下沒有施工明細。</p>'}<p class="total">數量合計：${esc(fmt(qty))}　未稅金額合計：${esc(fmt(amount))}</p></body></html>`;
  }
  function exportDailyPerformance() {
    const state=store.getState(),html=dailyPrintHtml(state,dailyPrintProjects(state,dailyBatches(state)));
    const popup=window.open('','_blank');
    if(!popup){window.KushePhase1?.toast('請允許彈出視窗以開啟每日業績 PDF 預覽');return}
    popup.opener=null;popup.document.open();popup.document.write(html);popup.document.close();
    const print=()=>{if(!popup.closed){popup.focus();popup.print()}};
    if(popup.document.fonts?.ready)popup.document.fonts.ready.then(()=>popup.requestAnimationFrame(print));
    else popup.setTimeout(print,100);
  }
  function dailySection(state,batches) {
    return `<section class="commission-panel daily-work-panel"><header><div><h2>每日作業</h2><p>沿用既有每日施工流程；抽成、點工與待請款仍由同一筆來源串聯。</p></div><button class="commission-secondary" id="exportDailyPerformance" type="button">匯出每日業績 PDF</button></header><div class="commission-table-wrap"><table class="commission-table daily-work-table"><thead><tr><th>日期</th><th>員工</th><th>客戶／案場</th><th>施工項目</th><th class="num">未稅施工額</th><th class="num">抽成</th><th class="num">點工薪資</th><th>請款狀態</th><th>操作</th></tr></thead><tbody>${batches.map((batch)=>{const monthPaidLocked=batch.logs.some((log)=>store.payrollHistoryLock(log.employee,log.date).locked),paidDeleteLocked=batch.logs.some((log)=>store.dailyLogPayrollDeleteLock(log).locked),billingLocked=batch.logs.some((log)=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')),actions=paidDeleteLocked?'<span class="commission-status is-settled" title="此紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。">已付款鎖定</span>':billingLocked?'<span class="commission-status billing-done" title="此紀錄已進入請款流程，不可修改或刪除。">已請款鎖定</span>':monthPaidLocked?`<div class="commission-row-actions"><span class="commission-status is-settled" title="同月份已有薪資付款，為避免新增薪資來源不可編輯。">編輯鎖定</span><button type="button" data-daily-delete="${esc(batch.batchId)}">刪除</button></div>`:`<div class="commission-row-actions"><button type="button" data-daily-edit="${esc(batch.batchId)}">編輯</button><button type="button" data-daily-delete="${esc(batch.batchId)}">刪除</button></div>`;return `<tr data-daily-batch="${esc(batch.batchId)}"><td>${esc(batch.date)}</td><td><b>${esc(batch.employees.join('、'))}</b></td><td><span class="daily-project-list">${batch.projects.map(esc).join('<br>')}</span></td><td><span class="commission-source">${esc(batch.items.filter(Boolean).slice(0,3).join('、')||'純點工')}${batch.itemCount>3?` 等 ${batch.itemCount} 項`:''}</span></td><td class="num"><b>${money(batch.untaxed)}</b><small>${batch.itemCount} 筆</small></td><td class="num">${money(batch.commission)}</td><td class="num">${money(batch.work)}</td><td><span class="commission-status billing-${batch.billingStatus==='未請款'?'open':batch.billingStatus==='草稿中'?'draft':batch.billingStatus==='已請款'?'done':'none'}">${esc(batch.billingStatus)}</span>${batch.billingAmount>0?`<small>${money(batch.billingAmount)}</small>`:''}</td><td>${actions}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="9">此篩選條件下沒有每日作業紀錄。</td></tr>'}</tbody></table></div></section>`;
  }
  function todayProjectsSection(state) {
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant'), groups = new Map();
    (state.dailyLogs || []).filter((log) => {
      if (String(log.date || '') !== today()) return false;
      if (filters.employee && employeeIdOf(log) !== filters.employee) return false;
      if (filters.project && projectIdOf(log) !== filters.project) return false;
      const employee = label(state, 'employees', employeeIdOf(log), log.employeeName || '');
      const project = label(state, 'projects', projectIdOf(log), log.projectName || '');
      const items = (log.items || []).map((item) => item.item || '').join(' ');
      return !query || `${employee} ${project} ${items} ${log.note || ''}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).forEach((log) => {
      const projectId = projectIdOf(log) || log.projectName || 'unknown';
      if (!groups.has(projectId)) groups.set(projectId, { name: label(state, 'projects', projectIdOf(log), log.projectName || '未指定案場'), employees: new Set() });
      groups.get(projectId).employees.add(label(state, 'employees', employeeIdOf(log), log.employeeName || '—'));
    });
    const cards = [...groups.values()].map((row) => `<article><b>${esc(row.name)}</b><span>${esc([...row.employees].join('、'))}</span></article>`).join('');
    return `<section class="commission-panel workforce-today"><header><div><h2>今日案場</h2><p>${esc(today())} 實際作業摘要</p></div></header><div class="workforce-today-grid">${cards || '<p class="workforce-empty-note">今日尚無作業紀錄</p>'}</div></section>`;
  }
  function attendanceSection(state, rows) {
    return `<section class="commission-panel commission-table-panel workforce-attendance-panel"><header><div><h2>出勤／點工</h2><p>直接呈現正式薪資來源；歷史獨立出勤維持唯讀，不進行轉換。</p></div><span class="workforce-readonly">唯讀</span></header><div class="commission-table-wrap"><table class="commission-table workforce-attendance-table"><thead><tr><th>日期</th><th>員工</th><th>案場</th><th>點工類型</th><th class="num">天數</th><th class="num">時數</th><th class="num">單價</th><th class="num">點工金額</th><th class="num">油費</th><th>來源</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>{const employeeId=employeeIdOf(row),projectId=projectIdOf(row),isDaily=row.sourceType==='daily-log',isHourly=row.workMode==='hourly'||number(row.hours)>0,rate=isHourly?row.hourlyRate??row.rate:row.dailyRate??row.rate;return `<tr data-attendance-id="${esc(row.id)}"><td>${esc(row.date||'—')}</td><td><b>${esc(label(state,'employees',employeeId,row.employeeName||'—'))}</b></td><td>${esc(label(state,'projects',projectId,row.projectName||'—'))}</td><td>${esc(isHourly?'時薪':'日薪')}</td><td class="num">${number(row.days)?number(row.days):'—'}</td><td class="num">${number(row.hours)?number(row.hours):'—'}</td><td class="num">${rate===null||rate===undefined?'—':money(rate)}</td><td class="num"><b>${money(row.amount)}</b></td><td class="num">${number(row.fuel)?money(row.fuel):'—'}</td><td><span class="workforce-source-badge ${isDaily?'is-synced':'is-legacy'}">${isDaily?'每日施工同步':'歷史出勤'}</span>${row.sourceNo?`<small class="workforce-source-no">${esc(row.sourceNo)}</small>`:''}</td><td><span class="commission-status ${row.status==='已列入薪資'?'is-settled':'is-unsettled'}">${esc(row.status||'—')}</span></td><td>${isDaily&&row.sourceId?`<button class="commission-link" type="button" data-view-daily-source="${esc(row.sourceId)}">查看來源</button>`:'<span class="workforce-readonly-row">唯讀</span>'}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="12">此篩選條件下沒有出勤／點工紀錄。</td></tr>'}</tbody></table></div></section>`;
  }
  function commissionSection(state, rows) {
    return `<section class="commission-panel commission-table-panel"><header><div><h2>業績／抽成</h2><p>每日施工同步與手動登錄分流呈現，既有抽成公式與薪資狀態保持不變。</p></div></header><div class="commission-table-wrap"><table class="commission-table workforce-commission-table"><thead><tr><th>${sortButton('date','日期')}</th><th>${sortButton('employee','員工')}</th><th>${sortButton('project','案場')}</th><th>業績來源</th><th class="num">含稅金額</th><th class="num">${sortButton('untaxedAmount','未稅金額')}</th><th class="num">${sortButton('rate','抽成 %')}</th><th class="num">${sortButton('commission','抽成金額')}</th><th>${sortButton('status','結算狀態')}</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>{const linkedPayroll=state.payroll.filter((item)=>item.month===String(row.date||'').slice(0,7)&&item.employee===row.employee),locked=store.payrollHistoryLock(row.employee,row.date).locked,source=store.commissionBillingLink(row),isDaily=source.kind==='daily-log',sourceView={linked:['請款來源','is-synced'],'orphan-billing':['來源已不存在','is-legacy'],manual:['手動登錄','is-manual'],'daily-log':['每日施工同步','is-synced'],ambiguous:['來源待確認','is-legacy']}[source.kind]||['來源待確認','is-legacy'],actions=locked?`<span class="commission-status is-settled" title="${source.kind==='orphan-billing'?'此抽成已納入真正已付款薪資，不能直接清除來源。':'此紀錄已納入已付款薪資，為保留歷史帳務不可修改。'}">已付款鎖定</span>`:isDaily?'<span class="commission-status" title="請由每日施工來源調整">來源同步</span>':`<div class="commission-row-actions"><button type="button" data-edit="${esc(row.id)}">編輯</button><button type="button" data-delete="${esc(row.id)}">刪除</button></div>`;return `<tr data-row-id="${esc(row.id)}" data-source-integrity="${esc(source.kind)}" data-payroll-records="${linkedPayroll.length}" data-payroll-commission="${linkedPayroll.filter((item)=>item.status!=='已付款').reduce((sum,item)=>sum+number(item.commission),0)}"><td>${esc(row.date||'—')}</td><td><b>${esc(label(state,'employees',row.employee,row.employeeName||'—'))}</b></td><td>${esc(label(state,'projects',row.project,row.projectName||'—'))}</td><td><span class="workforce-source-badge ${sourceView[1]}">${sourceView[0]}</span>${row.sourceNo?`<small class="workforce-source-no">${esc(row.sourceNo)}</small>`:''}</td><td class="num">${money(grossOf(state,row))}</td><td class="num">${money(row.untaxedAmount)}</td><td class="num">${number(row.rate)}%</td><td class="num"><b>${money(row.commission)}</b></td><td><span class="commission-status ${row.status==='已列入薪資'?'is-settled':'is-unsettled'}">${row.status==='已列入薪資'?'已結算':'未結算'}</span></td><td>${actions}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="10">此篩選條件下沒有業績／抽成紀錄。</td></tr>'}</tbody></table></div></section>`;
  }
  function payrollState(state, employeeId, month) {
    const group=store.monthlyPayrollGroups().find((row)=>row.employeeId===employeeId&&String(row.month||'').slice(0,7)===month);
    if(!group)return {label:'尚未建立',className:'is-neutral'};
    if(group.paid>0&&group.outstanding>0)return {label:'部分已付款',className:'is-unsettled'};
    return group.outstanding<=0&&group.total>0?{label:'已付款',className:'is-settled'}:{label:'未付款',className:'is-unsettled'};
  }
  function summarySection(state, attendanceRows, commissionRows) {
    const grouped=new Map(),ensure=(employeeId,fallback='—')=>{if(!employeeId)return null;if(!grouped.has(employeeId))grouped.set(employeeId,{employeeId,name:label(state,'employees',employeeId,fallback),days:0,hours:0,work:0,untaxed:0,commission:0});return grouped.get(employeeId)};
    attendanceRows.forEach((row)=>{const target=ensure(employeeIdOf(row),row.employeeName||'—');if(!target)return;target.days+=number(row.days);target.hours+=number(row.hours);target.work+=number(row.amount)});
    commissionRows.forEach((row)=>{const target=ensure(employeeIdOf(row),row.employeeName||'—');if(!target)return;target.untaxed+=number(row.untaxedAmount);target.commission+=number(row.commission)});
    const rows=[...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
    return `<section class="commission-panel commission-table-panel workforce-summary-panel"><header><div><h2>月度彙總</h2><p>點工與業績各取唯一正式來源，避免每日作業衍生資料重複加總。</p></div></header><div class="commission-table-wrap"><table class="commission-table workforce-summary-table"><thead><tr><th>員工</th><th class="num">出勤天數</th><th class="num">工時</th><th class="num">點工薪資</th><th class="num">未稅業績</th><th class="num">抽成</th><th>薪資狀態</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>{const status=payrollState(state,row.employeeId,filters.month);return `<tr><td><b>${esc(row.name)}</b></td><td class="num">${row.days||'—'}</td><td class="num">${row.hours||'—'}</td><td class="num"><b>${money(row.work)}</b></td><td class="num">${row.untaxed?money(row.untaxed):'—'}</td><td class="num">${row.commission?money(row.commission):'—'}</td><td><span class="commission-status ${status.className}">${esc(status.label)}</span></td><td><button class="commission-link" type="button" data-view-payroll="${esc(row.employeeId)}">查看薪資</button></td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="8">此月份沒有可彙總的出勤或抽成來源。</td></tr>'}</tbody></table></div></section>`;
  }
  function tabContent(state, batches, attendanceRows, commissionRows) {
    if(activeTab==='attendance')return attendanceSection(state,attendanceRows);
    if(activeTab==='commissions')return commissionSection(state,commissionRows);
    if(activeTab==='summary')return summarySection(state,attendanceRows,commissionRows);
    return `${todayProjectsSection(state)}${dailySection(state,batches)}`;
  }
  function render() {
    if (!active) return;
    const state = store.getState();
    const rows = rowsFor(state);
    const batches = dailyBatches(state);
    const attendanceRows = attendanceRowsFor(state);
    const totalWork = attendanceRows.reduce((sum,row)=>sum+number(row.amount),0);
    const totalCommission = rows.reduce((sum,row)=>sum+number(row.commission),0);
    const payrollRows=(state.payroll||[]).filter((row)=>String(row.month||'').slice(0,7)===filters.month&&(!filters.employee||employeeIdOf(row)===filters.employee));
    const unpaidPayrollRows=payrollRows.filter((row)=>row.status!=='已付款');
    const unpaidPayrollEmployees=new Set(unpaidPayrollRows.map(employeeIdOf).filter(Boolean));
    const todayEmployees = new Set([...(state.dailyLogs||[]),...(state.attendance||[])].filter((row)=>String(row.date||'')===today()&&(!filters.employee||employeeIdOf(row)===filters.employee)&&(!filters.project||projectIdOf(row)===filters.project)).map(employeeIdOf).filter(Boolean));
    const monthProjects = new Set([...batches.flatMap((batch)=>batch.logs),...attendanceRows].map(projectIdOf).filter(Boolean));
    $('#commissionsApp').innerHTML = `
      <section class="commissions-heading workforce-heading">
        <div><h1>出勤／業績管理</h1><p>整合每日作業、點工薪資、員工業績與抽成結算</p></div>
        <div class="workforce-heading-actions"><button class="commission-secondary" id="manualCommission" type="button">新增手動抽成</button><button class="commission-primary" id="addCommission" type="button">＋ 新增每日作業</button></div>
      </section>
      <section class="commission-kpis workforce-kpis" aria-label="出勤與業績統計摘要">
        <article><span>今日作業人數</span><strong>${todayEmployees.size} 人</strong><small>依實際作業與出勤員工去重</small></article>
        <article><span>本月點工薪資</span><strong>${money(totalWork)}</strong><small>依正式點工薪資來源</small></article>
        <article><span>本月抽成</span><strong>${money(totalCommission)}</strong><small>依正式抽成來源</small></article>
        <article class="is-warning"><span>未付款薪資</span><strong>${unpaidPayrollEmployees.size} 人</strong><small>尚有 ${unpaidPayrollRows.length} 筆薪資待付款</small></article>
        <article class="is-success"><span>本月作業案場</span><strong>${monthProjects.size} 處</strong><small>依實際作業來源去重</small></article>
      </section>
      <section class="commission-panel commission-filters workforce-filters" aria-label="共用搜尋與篩選">
        <div class="commission-filter-grid workforce-filter-grid">
          <label><span>月份</span><input id="commissionMonthFilter" type="month" value="${esc(filters.month)}"></label>
          <label><span>員工</span><select id="commissionEmployeeFilter">${options(state.employees, filters.employee, '全部員工')}</select></label>
          <label><span>案場</span><select id="commissionProjectFilter">${options(state.projects, filters.project, '全部案場')}</select></label>
          <label class="commission-search workforce-search"><span>關鍵字搜尋</span><input id="commissionQueryFilter" type="search" value="${esc(filters.query)}" placeholder="員工、案場、施工項目、備註、來源單號"></label>
          <button class="commission-clear" id="commissionClearFilters" type="button">清除篩選</button>
        </div>
      </section>
      <nav class="workforce-tabs" role="tablist" aria-label="出勤與業績資料分頁">${[['daily','每日作業'],['attendance','出勤／點工'],['commissions','業績／抽成'],['summary','月度彙總']].map(([key,text])=>`<button type="button" role="tab" data-workforce-tab="${key}" aria-selected="${activeTab===key}" class="workforce-tab ${activeTab===key?'is-active':''}">${text}</button>`).join('')}</nav>
      <div class="workforce-tab-panel" role="tabpanel">${tabContent(state,batches,attendanceRows,rows)}</div>
      <div class="commission-drawer-layer" id="commissionDrawerLayer" hidden></div>`;
    bind();
    window.KusheIcons?.render($('#commissionsView'));
  }
  function bind() {
    $('#exportDailyPerformance')?.addEventListener('click', exportDailyPerformance);
    $('#addCommission')?.addEventListener('click', () => openDailyDrawer());
    $('#manualCommission')?.addEventListener('click', () => openDrawer());
    $('#commissionMonthFilter').addEventListener('change', (event) => { filters.month = event.target.value; render(); });
    $('#commissionEmployeeFilter').addEventListener('change', (event) => { filters.employee = event.target.value; render(); });
    $('#commissionProjectFilter').addEventListener('change', (event) => { filters.project = event.target.value; render(); });
    $('#commissionQueryFilter').addEventListener('input', (event) => { filters.query = event.target.value; window.clearTimeout(bind.searchTimer); bind.searchTimer = window.setTimeout(render, 180); });
    $('#commissionClearFilters').addEventListener('click', () => { Object.assign(filters, {month:monthNow(),employee:'',project:'',query:''}); render(); });
    $$('[data-workforce-tab]').forEach((button)=>button.addEventListener('click',()=>{activeTab=button.dataset.workforceTab;render()}));
    $$('[data-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.sort; filters.direction = filters.sort === key && filters.direction === 'desc' ? 'asc' : 'desc'; filters.sort = key; render(); }));
    $$('[data-edit]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.edit)));
    $$('[data-delete]').forEach((button) => button.addEventListener('click', () => remove(button.dataset.delete)));
    $$('[data-daily-edit]').forEach((button) => button.addEventListener('click', () => openDailyDrawer(button.dataset.dailyEdit)));
    $$('[data-daily-delete]').forEach((button) => button.addEventListener('click', () => removeDaily(button.dataset.dailyDelete)));
    $$('[data-view-daily-source]').forEach((button)=>button.addEventListener('click',()=>showDailySource(button.dataset.viewDailySource)));
    $$('[data-view-payroll]').forEach((button)=>button.addEventListener('click',()=>{window.location.hash='#payroll'}));
  }
  function showDailySource(sourceId) {
    const log=(store.getState().dailyLogs||[]).find((row)=>row.id===sourceId);
    if(!log)return window.KushePhase1?.toast('找不到對應的每日作業來源');
    activeTab='daily';filters.month=String(log.date||'').slice(0,7);filters.employee='';filters.project='';filters.query='';render();
    requestAnimationFrame(()=>{const target=$$('[data-daily-batch]').find((row)=>row.dataset.dailyBatch===(log.batchId||log.id));target?.scrollIntoView({block:'center'});target?.classList.add('is-highlighted');window.setTimeout(()=>target?.classList.remove('is-highlighted'),1800)});
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
    const calc=()=>{let gross=0,untaxed=0,billing=0;$$('.daily-line',body).forEach((row)=>{const qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal;gross+=subtotal;untaxed+=lineUntaxed;if($('.daily-billable input',row).checked)billing+=lineUntaxed;$('.daily-line-total',row).textContent=money(subtotal);$('.daily-line-untaxed',row).textContent=`未稅 ${money(lineUntaxed)}`});const ids=$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),commission=form.elements.commissionEnabled.checked?previewCommissionTotal(untaxed,ids,state.employees):0,work=form.elements.workMode.value==='none'?0:number(form.elements.workQty.value)*number(form.elements.workRate.value);$('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work)};
    const bindLines=()=>{$$('.daily-line input,.daily-line select',body).forEach((input)=>{input.oninput=calc;input.onchange=calc});$$('.daily-line-remove',body).forEach((button)=>button.onclick=()=>{if(body.children.length>1)button.closest('tr').remove();else button.closest('tr').querySelectorAll('input').forEach((input)=>input.value='');calc()})};
    $('#addDailyLine',layer).onclick=()=>{body.insertAdjacentHTML('beforeend',lineHtml({project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:''}));bindLines();calc()};bindLines();$$('input[name="dailyEmployees"],select[name="workMode"],input[name="workQty"],input[name="workRate"],input[name="commissionEnabled"]',form).forEach((input)=>{input.oninput=calc;input.onchange=calc});form.onsubmit=submitDaily;$$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach((button)=>button.addEventListener('click',closeDrawer));calc();
  }
  function openDailyDrawer(batchId='') {
    let state=store.getState();
    const logs=batchId?(state.dailyLogs||[]).filter(log=>(log.batchId||log.id)===batchId):[];
    if(logs.some(log=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')))return window.KushePhase1?.toast('已進入請款流程的施工紀錄不可直接修改');
    if(logs.some(log=>store.payrollHistoryLock(log.employee,log.date).locked))return window.KushePhase1?.toast('此施工紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。');
    editingDailyBatch=batchId;dailyEditorActive=true;
    const first=logs[0]||{},employeeIds=new Set(logs.map(log=>log.employee)),projectGroups=new Map(),legacyItems=new Map();
    logs.forEach(log=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,log);(log.items||[]).forEach(item=>{if(item.workItemId)legacyItems.set(item.workItemId,item)})});
    let lines=[];
    projectGroups.forEach(log=>(log.items||[]).forEach(item=>lines.push({project:log.project,house:item.house||'',item:item.itemName||item.item||'',unit:item.unit||'式',qty:number(item.qty),inputPrice:number(item.unitPrice??item.inputPrice??item.price),taxMode:item.taxMode||'未稅',billable:item.billable!==false,workItemId:item.workItemId||'',sourceType:item.sourceType||(item.quotationId?'quotation':'manual'),quotationId:item.quotationId||item.quoteId||'',quotationLineId:item.quotationLineId||item.quoteLineId||'',quotationNo:item.quotationNo||'',pricingType:item.pricingType||'actual',lumpSumAmount:number(item.lumpSumAmount)})));
    const emptyLine=(project='',house='')=>({project,house,item:'',unit:'式',qty:'',inputPrice:0,taxMode:'未稅',billable:true,workItemId:'',sourceType:'',pricingType:'actual'});
    if(!lines.length)lines=[emptyLine()];
    const workLog=logs.find(log=>log.workMode&&log.workMode!=='none')||{},commissionEnabled=!logs.length||logs.some(log=>number(log.performance)>0),layer=$('#commissionDrawerLayer');
    const projectOptions=(selected='')=>`<option value="">請選擇案場</option>${store.masterOptions('projects').map(project=>`<option value="${esc(project.id)}" ${String(project.id)===String(selected)?'selected':''}>${esc(label(store.getState(),'customers',project.customer,project.customerName||'未指定客戶'))}｜${esc(project.name)}</option>`).join('')}`;
    const employeeChoices=store.masterOptions('employees').map(employee=>`<label class="daily-employee-choice"><input type="checkbox" name="dailyEmployees" value="${esc(employee.id)}" ${employeeIds.has(employee.id)?'checked':''}><span><b>${esc(employee.name)}</b><small>抽成 ${number(employee.commissionRate)}%</small></span></label>`).join('');
    const customerOptions=(selected='')=>`<option value="">請選擇客戶</option>${store.masterOptions('customers').map(customer=>`<option value="${esc(customer.id)}" ${String(customer.id)===String(selected)?'selected':''}>${esc(customer.name)}</option>`).join('')}`;
    const quoteChoices=projectId=>{const project=store.getState().projects.find(row=>String(row.id)===String(projectId));return project?(store.confirmedQuotationItems(project.id,project.customer)||[]).map(item=>({...item,sourceType:'quotation'})):[]};
    const manualChoices=projectId=>(store.dailyManualItems(projectId)||[]).map(item=>({...item,sourceType:'manual'}));
    const lineChoices=projectId=>[...quoteChoices(projectId),...manualChoices(projectId)];
    const choiceKey=item=>JSON.stringify(item.sourceType==='quotation'?[String(item.quotationId),String(item.quotationLineId)]:['manual',String(item.projectId),item.item]);
    const quoteLabel=item=>item.sourceType==='manual'?`${item.item}｜${money(item.price)}/${item.unit||'式'}｜案場歷史`:item.pricingType==='lump_sum'?`${item.item}｜總價 ${money(item.lumpSumAmount)}｜${item.quotationNo||'已確認報價'}`:`${item.item}｜${money(item.price)}/${item.unit||'式'}｜${item.quotationNo||'已確認報價'}`;
    const choiceOptions=(line)=>{const selected=line.quotationId&&line.quotationLineId?JSON.stringify([String(line.quotationId),String(line.quotationLineId)]):line.sourceType==='manual'?'manual':'',choices=lineChoices(line.project);return `<option value="">請選擇報價品項</option><option value="manual" ${selected==='manual'?'selected':''}>手動施工／無報價來源</option>${selected&&selected!=='manual'&&!choices.some(item=>choiceKey(item)===selected)?`<option value="${esc(selected)}" selected>原報價來源（需重新核對）</option>`:''}${choices.map((item,index)=>`<option value="${esc(choiceKey(item))}" ${choiceKey(item)===selected?'selected':''}>${esc(quoteLabel(item))}${item.house?'｜'+esc(item.house):''}｜項次 ${index+1}</option>`).join('')}`};
    const lineHtml=line=>{const quoted=line.sourceType==='quotation'||Boolean(line.quotationId&&line.quotationLineId);return `<tr class="daily-line" data-work-item-id="${esc(line.workItemId||'')}" data-item-name="${esc(line.item||'')}" data-source-type="${esc(line.sourceType||'')}" data-quotation-id="${esc(line.quotationId||'')}" data-quotation-line-id="${esc(line.quotationLineId||'')}" data-quotation-no="${esc(line.quotationNo||'')}" data-pricing-type="${esc(line.pricingType||'actual')}" data-lump-sum-amount="${number(line.lumpSumAmount)}"><td class="daily-line-context" hidden><select class="daily-line-project">${projectOptions(line.project)}</select></td><td class="daily-line-context" hidden><input class="daily-line-house" value="${esc(line.house||'')}"></td><td><select class="daily-line-choice" aria-label="正式報價品項／手動施工">${choiceOptions(line)}</select><input class="daily-line-item" value="${esc(line.item||'')}" placeholder="手動施工品項" ${quoted?'readonly':''}><small class="daily-quote-hint"></small></td><td><input class="daily-line-unit" value="${esc(line.unit||'式')}" ${quoted?'readonly':''}></td><td><input class="daily-line-qty" type="number" min="0" step="0.01" value="${esc(line.qty??'')}"></td><td><select class="daily-line-tax" ${quoted?'disabled':''}><option value="未稅" ${line.taxMode!=='含稅'?'selected':''}>未稅</option><option value="含稅" ${line.taxMode==='含稅'?'selected':''}>含稅</option></select></td><td><input class="daily-line-price" type="number" min="0" step="0.01" value="${number(line.inputPrice)}" ${quoted?'readonly':''}></td><td class="num"><b class="daily-line-total">$0</b><small class="daily-line-untaxed">未稅 $0</small></td><td><label class="daily-billable"><input type="checkbox" ${line.billable!==false?'checked':''} ${line.pricingType==='lump_sum'?'disabled':''}><span>列入待請款</span></label></td><td><div class="daily-line-actions"><button type="button" class="daily-line-clone">複製</button><button type="button" class="daily-line-remove">刪除此施工項目</button></div></td></tr>`};
    layer.innerHTML=`<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer daily-drawer" role="dialog" aria-modal="true" aria-labelledby="dailyDrawerTitle"><header><div><small>每日施工、薪資與待請款共用資料</small><h2 id="dailyDrawerTitle">${batchId?'編輯':'新增'}每日施工紀錄</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header><form id="dailyWorkForm" class="daily-house-editor"><div class="commission-drawer-body daily-drawer-body"><div class="daily-form-grid full"><label><span>日期 *</span><input name="date" type="date" value="${esc(first.date||today())}" required></label><label class="daily-wide"><span>備註／工作內容</span><input name="note" value="${esc(first.note||'')}" placeholder="現場說明或施工備註"></label></div><section class="daily-form-section full"><div class="daily-section-title"><div><h3>員工</h3><p>可複選；同一員工同一天可前往多個案場。</p></div></div><div class="daily-employee-grid">${employeeChoices}</div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>案場與施工項目</h3><p>選案場後可搜尋該案場所有已確認報價項目；報價單價會保存為施工快照。</p></div><button type="button" class="commission-secondary" id="addDailyLine">＋ 新增另一案場</button></div><div id="dailyLines" class="daily-house-groups"></div><div class="daily-total-bar"><span>施工含稅／輸入合計 <b id="dailyGrossTotal">$0</b></span><span>未稅施工合計 <b id="dailyUntaxedTotal">$0</b></span><span>預估抽成 <b id="dailyCommissionTotal">$0</b></span><span>待請款施工 <b id="dailyBillingTotal">$0</b></span></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>計薪方式</h3><p>可只計抽成、只計點工，或同時使用；日薪同員工同日只計一次。</p></div></div><div class="daily-pay-grid"><label class="daily-check"><input name="commissionEnabled" type="checkbox" ${commissionEnabled?'checked':''}><span>業績抽成（依未稅業績）</span></label><label><span>點工方式</span><select name="workMode"><option value="none" ${!workLog.workMode||workLog.workMode==='none'?'selected':''}>不計點工</option><option value="daily" ${workLog.workMode==='daily'?'selected':''}>日薪</option><option value="hourly" ${workLog.workMode==='hourly'?'selected':''}>時薪</option></select></label><label><span>點工天數／時數</span><input name="workQty" type="number" min="0" step="0.5" value="${number(workLog.workQty)}"></label><label><span>日薪／時薪單價</span><input name="workRate" type="number" min="0" step="1" value="${number(workLog.workRate)}"></label><div class="daily-work-preview"><span>每位員工點工薪資</span><b id="dailyWorkTotal">$0</b></div></div></section></div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存每日施工</button></footer></form></aside><div class="daily-house-batch-layer" id="dailyHouseBatchLayer" hidden><button class="daily-house-batch-backdrop" type="button" data-daily-house-batch-cancel aria-label="關閉批次新增戶別"></button><section class="daily-house-batch-card" role="dialog" aria-modal="true" aria-labelledby="dailyHouseBatchTitle"><header><div><small>以目前整戶施工項目為範本</small><h3 id="dailyHouseBatchTitle">批次複製整戶</h3></div><button type="button" data-daily-house-batch-cancel aria-label="關閉">×</button></header><label><span>戶別清單</span><textarea id="dailyHouseBatchInput" rows="7" placeholder="2A&#10;2B&#10;2C&#10;2D"></textarea><small>每行一戶，也支援逗號、頓號或分號分隔；重複戶別會自動略過。</small></label><footer><button class="commission-secondary" type="button" data-daily-house-batch-cancel>取消</button><button class="commission-primary" id="confirmDailyHouseBatch" type="button">建立戶別</button></footer></section></div><div class="daily-house-batch-layer daily-quick-project-layer" id="dailyQuickProjectLayer" hidden><button class="daily-house-batch-backdrop" type="button" data-daily-quick-project-cancel aria-label="取消新增案場"></button><form class="daily-house-batch-card daily-quick-project-card" id="dailyQuickProjectForm" role="dialog" aria-modal="true" aria-labelledby="dailyQuickProjectTitle"><header><div><small>每日施工快速建立正式主檔</small><h3 id="dailyQuickProjectTitle">新增案場</h3></div><button type="button" data-daily-quick-project-cancel aria-label="關閉">×</button></header><label><span>所屬客戶 *</span><select name="customer" required>${customerOptions()}</select></label><label><span>案場名稱 *</span><input name="name" autocomplete="off" required></label><label><span>工程地址（選填）</span><input name="address" autocomplete="street-address"></label><footer><button class="commission-secondary" type="button" data-daily-quick-project-cancel>取消</button><button class="commission-primary" type="submit">新增並使用</button></footer></form></div>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));
    const form=$('#dailyWorkForm',layer),body=$('#dailyLines',layer),batchLayer=$('#dailyHouseBatchLayer',layer),batchInput=$('#dailyHouseBatchInput',layer),quickProjectLayer=$('#dailyQuickProjectLayer',layer),quickProjectForm=$('#dailyQuickProjectForm',layer);
    form.noValidate=true;
    let batchTemplate=null,quickProjectTargetGroup=null,draftSequence=0;
    const groupRows=group=>$$('.daily-line',group),blockOf=node=>node.closest('.daily-project-block'),projectInput=node=>$('.daily-house-project',blockOf(node));
    const groupProject=group=>projectInput(group).value,groupHouse=group=>$('.daily-house-name',group).value.trim();
    const groupKey=(project,house)=>JSON.stringify([String(project||''),String(house||'').trim()]);
    const findGroup=(project,house,except)=>$$('.daily-house-group',body).find(group=>group!==except&&groupKey(groupProject(group),groupHouse(group))===groupKey(project,house));
    const rowDraft=(row,house=$('.daily-line-house',row).value.trim(),workItemId=row.dataset.workItemId||'')=>({project:$('.daily-line-project',row).value,house,item:row.dataset.itemName||$('.daily-line-item',row).value.trim(),itemName:row.dataset.itemName||$('.daily-line-item',row).value.trim(),unit:$('.daily-line-unit',row).value.trim()||'式',qty:$('.daily-line-qty',row).value,inputPrice:number($('.daily-line-price',row).value),unitPrice:number($('.daily-line-price',row).value),taxMode:$('.daily-line-tax',row).value,billable:row.dataset.pricingType!=='lump_sum'&&$('.daily-billable input',row).checked,sourceType:row.dataset.sourceType||'',pricingType:row.dataset.pricingType||'actual',quotationId:row.dataset.quotationId||'',quotationLineId:row.dataset.quotationLineId||'',quotationNo:row.dataset.quotationNo||'',lumpSumAmount:number(row.dataset.lumpSumAmount),workItemId});
    // This allowlist is a UI template only: never copy persisted source/billing identities.
    const nextHouseLine=row=>{const value=rowDraft(row);return {project:value.project,house:'',item:value.item,itemName:value.itemName,unit:value.unit,qty:'',inputPrice:value.inputPrice,unitPrice:value.unitPrice,taxMode:value.taxMode,billable:value.billable,sourceType:value.sourceType,pricingType:value.pricingType,quotationId:value.quotationId,quotationLineId:value.quotationLineId,quotationNo:value.quotationNo,lumpSumAmount:value.lumpSumAmount,workItemId:''}};
    const updateHint=row=>{const projectId=$('.daily-line-project',row).value,hint=$('.daily-quote-hint',row);hint.textContent=!projectId?'請先選擇客戶／案場。':row.dataset.sourceType==='quotation'?`已連結 ${row.dataset.quotationNo||'已確認報價'}｜${row.dataset.pricingType==='lump_sum'?'總價（施工數量不增加待請款）':'實做實算'}`:!quoteChoices(projectId).length&&!manualChoices(projectId).length?'此案場尚無已確認報價或施工歷史，可手動輸入施工項目。':'請以報價選單指定來源；手動施工不會依品名猜測報價。'};
    const clearQuote=row=>{Object.assign(row.dataset,{sourceType:'manual',quotationId:'',quotationLineId:'',quotationNo:'',pricingType:'actual',lumpSumAmount:'0',itemName:$('.daily-line-item',row).value.trim()});$('.daily-line-item',row).readOnly=false;$('.daily-line-unit',row).readOnly=false;$('.daily-line-price',row).readOnly=false;$('.daily-line-tax',row).disabled=false;$('.daily-billable input',row).disabled=false};
    const refreshChoices=row=>{$('.daily-line-choice',row).innerHTML=choiceOptions(rowDraft(row));updateHint(row)};
    const applyChoice=row=>{const select=$('.daily-line-choice',row),matched=lineChoices($('.daily-line-project',row).value).find(item=>choiceKey(item)===select.value);if(!matched){clearQuote(row);if(!select.value){row.dataset.sourceType='';row.dataset.itemName='';$('.daily-line-item',row).value=''}updateHint(row);return select.value==='manual'}const quoted=matched.sourceType==='quotation';Object.assign(row.dataset,{sourceType:quoted?'quotation':'manual',quotationId:quoted?matched.quotationId:'',quotationLineId:quoted?matched.quotationLineId:'',quotationNo:quoted?(matched.quotationNo||''):'',pricingType:matched.pricingType||'actual',lumpSumAmount:String(number(matched.lumpSumAmount)),itemName:matched.item});const item=$('.daily-line-item',row),unit=$('.daily-line-unit',row),price=$('.daily-line-price',row),tax=$('.daily-line-tax',row),billable=$('.daily-billable input',row);item.value=matched.item;item.readOnly=quoted;unit.value=matched.unit||'式';unit.readOnly=quoted;price.value=matched.pricingType==='lump_sum'?number(matched.lumpSumAmount):number(matched.price);price.readOnly=quoted;tax.value=matched.taxMode||'未稅';tax.disabled=quoted;billable.checked=matched.pricingType!=='lump_sum';billable.disabled=matched.pricingType==='lump_sum';updateHint(row);return true};
    const calc=()=>{let gross=0,untaxed=0,billing=0;$$('.daily-line',body).forEach((row)=>{const isLump=row.dataset.pricingType==='lump_sum',qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=isLump?0:qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal;gross+=subtotal;untaxed+=lineUntaxed;if(!isLump&&$('.daily-billable input',row).checked)billing+=lineUntaxed;row.dataset.previewSubtotal=String(subtotal);$('.daily-line-total',row).textContent=isLump?'進度紀錄':money(subtotal);$('.daily-line-untaxed',row).textContent=isLump?'總價不重複累計':`未稅 ${money(lineUntaxed)}`});const ids=$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),commission=form.elements.commissionEnabled.checked?previewCommissionTotal(untaxed,ids,state.employees):0,work=form.elements.workMode.value==='none'?0:number(form.elements.workQty.value)*number(form.elements.workRate.value);$('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work);$$('.daily-house-group',body).forEach((group)=>{$('.daily-house-subtotal',group).textContent=money($$('.daily-line',group).reduce((sum,row)=>sum+number(row.dataset.previewSubtotal),0))})};
    const selectTemplate=group=>{const block=blockOf(group);block._dailyTemplate=group;$('.daily-next-source',block).textContent=`沿用戶別：${groupHouse(group)||'目前未填戶別'}（點選戶別可切換範本）`};
    const appendLine=(group,line,order)=>{const tbody=$('tbody',group);tbody.insertAdjacentHTML('beforeend',lineHtml(line));const row=tbody.lastElementChild;row.dataset.draftOrder=String(order??draftSequence++);row.dataset.draftRowKey=`daily-row-${++dailyLineSequence}`;bindRow(row);return row};
    const closeBatch=()=>{batchLayer.hidden=true;batchTemplate=null;batchInput.value=''};
    const openBatch=group=>{if(!groupProject(group)){window.KushePhase1?.toast('請先選擇案場');projectInput(group).focus();return}batchTemplate=group;batchInput.value='';batchLayer.hidden=false;requestAnimationFrame(()=>batchInput.focus())};
    const bindRow=row=>{
      const project=$('.daily-line-project',row),item=$('.daily-line-item',row),choice=$('.daily-line-choice',row);
      project.onchange=()=>{item.value='';clearQuote(row);row.dataset.sourceType='';$('.daily-line-unit',row).value='式';$('.daily-line-price',row).value='0';$('.daily-line-qty',row).value='';$('.daily-line-tax',row).value='未稅';$('.daily-billable input',row).checked=true;refreshChoices(row);calc()};
      choice.onchange=()=>{applyChoice(row);calc()};
      let composing=false;const typeManual=event=>{if(composing||event?.isComposing||item.readOnly)return;clearQuote(row);choice.value='manual';updateHint(row);calc()};
      item.oncompositionstart=()=>{composing=true};item.oncompositionend=()=>{composing=false;typeManual()};item.oninput=typeManual;item.onchange=typeManual;
      $$('input,select',row).forEach(input=>{if(input!==project&&input!==item&&input!==choice){input.oninput=calc;input.onchange=calc}});
      $('.daily-line-clone',row).onclick=()=>{const draft=cloneDailyLineDraft(rowDraft(row)),block=blockOf(row),group=findGroup(draft.project,'')||createGroup(draft.project,'',[],block);appendLine(group,draft);selectTemplate(group);calc();$('.daily-house-name',group).focus()};
      $('.daily-line-remove',row).onclick=()=>{const group=row.closest('.daily-house-group');if(groupRows(group).length>1)row.remove();else{const order=number(row.dataset.draftOrder);row.remove();appendLine(group,emptyLine(groupProject(group),groupHouse(group)),order)}calc()};updateHint(row);
    };
    const createProjectBlock=project=>{
      const block=document.createElement('section');block.className='daily-form-section daily-project-block';block.dataset.project=String(project||'');
      block.innerHTML=`<header class="daily-house-header"><div class="daily-house-project-control"><label><span>客戶｜案場（此區只選一次）</span><select class="daily-house-project">${projectOptions(project)}</select></label><button type="button" class="commission-secondary daily-quick-project-open">＋ 新增案場</button></div><div class="daily-house-actions"><button type="button" class="commission-secondary daily-project-remove">移除此案場</button></div></header><div class="daily-house-groups" data-project-houses></div><footer class="daily-section-title"><div><button type="button" class="commission-secondary daily-next-house">＋ 下一戶，沿用品項</button><p class="daily-next-source"></p></div></footer>`;
      body.appendChild(block);const select=$('.daily-house-project',block);
      select.onchange=()=>{if(select.value&&$$('.daily-project-block',body).some(other=>other!==block&&$('.daily-house-project',other).value===select.value)){select.value=block.dataset.project;window.KushePhase1?.toast('此案場已在本批次，請於原案場區塊新增戶別');return false}block.dataset.project=select.value;$$('.daily-house-group',block).forEach(group=>{group.dataset.project=select.value;groupRows(group).forEach(row=>{const context=$('.daily-line-project',row);context.value=select.value;context.onchange()})});return true};
      $('.daily-quick-project-open',block).onclick=()=>openQuickProject(block);
      $('.daily-project-remove',block).onclick=()=>{block.remove();if(!body.children.length)createGroup('','',[emptyLine()],createProjectBlock(''));calc()};
      $('.daily-next-house',block).onclick=()=>{const template=block._dailyTemplate;if(!template||!block.contains(template))return;if(!select.value||!groupHouse(template)){window.KushePhase1?.toast('請先填寫目前案場與戶別');(!select.value?select:$('.daily-house-name',template)).focus();return}const pending=$$('.daily-house-group',block).find(group=>!groupHouse(group));if(pending){$('.daily-house-name',pending).focus();return}const drafts=groupRows(template).map(nextHouseLine),group=createGroup(select.value,'',drafts.length?drafts:[emptyLine(select.value)],block);selectTemplate(group);calc();$('.daily-house-name',group).focus()};
      return block;
    };
    const createGroup=(project,house,groupLines,block)=>{
      block=block||$$('.daily-project-block',body).find(node=>$('.daily-house-project',node).value===String(project||''))||createProjectBlock(project);
      const group=document.createElement('section');group.className='daily-house-group';group.dataset.project=String(project||'');group.dataset.house=String(house||'').trim();
      group.innerHTML='<header class="daily-house-header"><label><span>戶別</span><input class="daily-house-name" value="'+esc(house||'')+'" placeholder="未指定戶別"></label><div class="daily-house-amount"><span>戶別施工小計</span><b class="daily-house-subtotal">$0</b></div><div class="daily-house-actions"><button type="button" class="commission-secondary daily-house-batch">批次複製整戶</button><button type="button" class="commission-secondary daily-house-remove">刪除整戶</button></div></header><div class="daily-lines-wrap"><table class="daily-lines-table daily-house-items"><colgroup><col class="daily-col-item"><col class="daily-col-unit"><col class="daily-col-qty"><col class="daily-col-tax"><col class="daily-col-price"><col class="daily-col-total"><col class="daily-col-purpose"><col class="daily-col-actions"></colgroup><thead><tr><th>施工項目</th><th>單位</th><th>數量</th><th>稅別</th><th>單價</th><th>小計</th><th>用途</th><th>操作</th></tr></thead><tbody></tbody></table></div><footer><button type="button" class="commission-secondary daily-house-add">＋ 新增施工項目</button></footer>';
      $('[data-project-houses]',block).appendChild(group);groupLines.forEach(line=>appendLine(group,line,line.draftOrder));
      const houseInput=$('.daily-house-name',group),syncHouse=()=>{groupRows(group).forEach(row=>{$('.daily-line-house',row).value=houseInput.value.trim()});selectTemplate(group)};
      const acceptHeader=()=>{const house=houseInput.value.trim();if(house&&findGroup(groupProject(group),house,group)){houseInput.value=group.dataset.house;syncHouse();window.KushePhase1?.toast('此案場戶別已存在，請在原戶別新增施工項目');return false}group.dataset.house=house;syncHouse();return true};
      houseInput.oninput=syncHouse;houseInput.onchange=acceptHeader;group.addEventListener('focusin',()=>selectTemplate(group));
      $('.daily-house-add',group).onclick=()=>{if(!acceptHeader())return;const row=appendLine(group,emptyLine(groupProject(group),groupHouse(group)));calc();$('.daily-line-choice',row).focus()};
      $('.daily-house-batch',group).onclick=()=>{if(acceptHeader())openBatch(group)};
      $('.daily-house-remove',group).onclick=()=>{group.remove();if(!$('[data-project-houses]',block).children.length)createGroup(groupProject(block),'',[emptyLine(groupProject(block))],block);else selectTemplate($$('.daily-house-group',block).at(-1));calc()};
      selectTemplate(group);return group;
    };
    const quickProjectCustomer=group=>{const currentState=store.getState(),current=currentState.projects.find(project=>String(project.id)===String(groupProject(group)));if(current?.customer)return String(current.customer);const ids=new Set($$('.daily-house-project',body).map(select=>currentState.projects.find(project=>String(project.id)===String(select.value))?.customer).filter(Boolean).map(String));return ids.size===1?[...ids][0]:''};
    const refreshProjectDropdowns=()=>{state=store.getState();$$('select.daily-house-project,select.daily-line-project',body).forEach(select=>{const value=select.value;select.innerHTML=projectOptions(value);select.value=value})};
    const selectProjectForGroup=(group,project)=>{refreshProjectDropdowns();if(!group||!body.contains(group))return false;const select=projectInput(group);select.value=String(project.id);return select.onchange?.()!==false};
    const closeQuickProject=()=>{const button=$('button[type="submit"]',quickProjectForm);quickProjectLayer.hidden=true;quickProjectTargetGroup=null;quickProjectForm.reset();button.disabled=false;button.textContent='新增並使用'};
    const openQuickProject=(group)=>{
      quickProjectTargetGroup=group;quickProjectForm.reset();quickProjectForm.elements.customer.value=quickProjectCustomer(group);quickProjectLayer.hidden=false;
      requestAnimationFrame(()=>{const target=quickProjectForm.elements.customer.value?quickProjectForm.elements.name:quickProjectForm.elements.customer;target.focus()});
    };
    $$('[data-daily-quick-project-cancel]',quickProjectLayer).forEach((button)=>button.onclick=()=>{if(!quickProjectSaveActive)closeQuickProject()});
    quickProjectLayer.onkeydown=(event)=>{if(event.key==='Escape'&&!quickProjectSaveActive){event.preventDefault();closeQuickProject()}};
    quickProjectForm.onsubmit=async(event)=>{
      event.preventDefault();
      const customer=quickProjectForm.elements.customer.value,name=quickProjectForm.elements.name.value.trim(),address=quickProjectForm.elements.address.value.trim(),targetGroup=quickProjectTargetGroup;
      if(!customer||!name){window.KushePhase1?.toast('請選擇所屬客戶並輸入案場名稱');return}
      const existing=store.getState().projects.find((project)=>String(project.customer)===String(customer)&&normalizedProjectName(project.name)===normalizedProjectName(name));
      if(existing){closeQuickProject();selectProjectForGroup(targetGroup,existing);window.KushePhase1?.toast('此客戶已有同名案場，已直接選用既有案場');return}
      const button=event.submitter||$('button[type="submit"]',quickProjectForm);button.disabled=true;button.textContent='新增中…';
      try{
        quickProjectSaveActive=true;
        const project=await store.saveProject({name,customer,address,status:'進行中'});
        closeQuickProject();selectProjectForGroup(targetGroup,project);window.KushePhase1?.toast('案場已新增並選用，完成施工內容後再儲存每日施工');
      }catch(error){button.disabled=false;button.textContent='新增並使用';window.KushePhase1?.toast(`新增案場失敗：${error.message}`)}
      finally{quickProjectSaveActive=false}
    };
    const initialGroups=new Map();lines.forEach((line,index)=>{const key=groupKey(line.project,line.house);if(!initialGroups.has(key))initialGroups.set(key,[]);initialGroups.get(key).push({...line,draftOrder:index})});draftSequence=lines.length;
    initialGroups.forEach(groupLines=>createGroup(groupLines[0].project,groupLines[0].house,groupLines));
    $('#addDailyLine',layer).onclick=()=>{const block=createProjectBlock('');createGroup('','',[emptyLine()],block);calc();$('.daily-house-project',block).focus()};
    $$('input[name="dailyEmployees"],select[name="workMode"],input[name="workQty"],input[name="workRate"],input[name="commissionEnabled"]',form).forEach(input=>{input.oninput=calc;input.onchange=calc});
    const showRowError=(error,rows)=>{const row=rows[error.dailyRowIndex]||rows[0];if(row){const field=error.dailyField==='house'?$('.daily-house-name',row.closest('.daily-house-group')):error.dailyField==='project'?projectInput(row):error.dailyField==='qty'?$('.daily-line-qty',row):error.dailyField==='quotation'?$('.daily-line-choice',row):$('.daily-line-item',row);field.setAttribute('aria-invalid','true');$('.daily-quote-hint',row).textContent=error.message;field.focus();field.scrollIntoView({block:'nearest',inline:'nearest'})}window.KushePhase1?.toast(error.message)};
    const validateRows=rows=>{const ids=new Set(),current=store.getState();if(!$('input[name="dailyEmployees"]:checked',form))throw new Error('請至少選擇一位員工');rows.forEach((row,index)=>{const draft=rowDraft(row),project=current.projects.find(item=>String(item.id)===String(draft.project)),fail=(message,field)=>{const error=new Error(`第 ${index+1} 筆施工：${message}`);Object.assign(error,{dailyRowIndex:index,dailyField:field});throw error};if(!project||!project.customer||!current.customers.some(item=>String(item.id)===String(project.customer)))fail('請選擇有有效客戶關聯的案場','project');if(!draft.house&&!(legacyItems.has(draft.workItemId)&&!String(legacyItems.get(draft.workItemId).house||'').trim()))fail('請填寫戶別','house');if(!draft.item)fail('請填寫施工品項','item');if(!/^\d+(?:\.\d+)?$/.test(draft.qty.trim())||!Number.isFinite(Number(draft.qty))||Number(draft.qty)<=0||Number(draft.qty)>Number.MAX_SAFE_INTEGER)fail('數量必須是有限正數，不可空白','qty');if(draft.sourceType==='quotation'||draft.quotationId||draft.quotationLineId){if(!draft.quotationId||!draft.quotationLineId||!quoteChoices(draft.project).some(item=>String(item.quotationId)===draft.quotationId&&String(item.quotationLineId)===draft.quotationLineId))fail('報價項目已失效，請重新選擇正式報價來源','quotation')}else if(draft.sourceType!=='manual')fail('請選擇報價品項或明確使用手動施工','quotation');if(draft.workItemId&&ids.has(draft.workItemId))fail('施工來源識別重複','item');if(draft.workItemId)ids.add(draft.workItemId)});if(!rows.length)throw new Error('請至少填寫一筆施工項目')};
    form._dailySubmitContext={batchId,strictRows:true,validateRows,showRowError,afterCommit:async()=>{if(batchId){dailySubmitInFlight=false;closeDrawer();render();return}const templates=$$('.daily-project-block',body).map(block=>{const group=block._dailyTemplate&&block.contains(block._dailyTemplate)?block._dailyTemplate:$('.daily-house-group',block);return {project:groupProject(block),lines:group?groupRows(group).map(nextHouseLine):[]}});state=store.getState();body.replaceChildren();templates.forEach(template=>{const block=createProjectBlock(template.project);createGroup(template.project,'',template.lines.length?template.lines:[emptyLine(template.project)],block)});calc();form.dataset.committed='false';$('.daily-house-name',body)?.focus()}};
    form.onsubmit=submitDaily;
    $$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach(button=>button.addEventListener('click',closeDrawer));
    $$('[data-daily-house-batch-cancel]',batchLayer).forEach(button=>button.onclick=closeBatch);
    $('#confirmDailyHouseBatch',batchLayer).onclick=()=>{if(!batchTemplate||!body.contains(batchTemplate))return closeBatch();const houses=parseHouseBatch(batchInput.value);if(!houses.length){window.KushePhase1?.toast('請至少輸入一個戶別');return}const project=groupProject(batchTemplate),drafts=groupRows(batchTemplate).map(row=>rowDraft(row)),block=blockOf(batchTemplate),skipped=[],created=[];houses.forEach(house=>{if(findGroup(project,house)){skipped.push(house);return}createGroup(project,house,drafts.map(draft=>cloneDailyLineDraft(draft,house)),block);created.push(house)});closeBatch();calc();window.KushePhase1?.toast([created.length?'已建立 '+created.join('、'):'',skipped.length?skipped.join('、')+' 已存在，已略過':''].filter(Boolean).join('；'))};
    batchLayer.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeBatch()}};calc();
  }
  async function submitDaily(event) {
    event.preventDefault();const form=event.currentTarget,context=form._dailySubmitContext;
    if(dailySubmitInFlight||form.dataset.committed==='true'||form.dataset.submitLocked==='true')return;
    const rows=$$('.daily-line',form).sort((a,b)=>number(a.dataset.draftOrder)-number(b.dataset.draftOrder)),button=$('button[type="submit"]',form);
    $$('[aria-invalid]',form).forEach(input=>input.removeAttribute('aria-invalid'));
    try{context?.validateRows(rows)}catch(error){context?.showRowError(error,rows);return}
    const lines=rows.map(row=>({project:$('.daily-line-project',row).value,house:$('.daily-line-house',row).value.trim(),item:row.dataset.itemName||$('.daily-line-item',row).value.trim(),itemName:row.dataset.itemName||$('.daily-line-item',row).value.trim(),unit:$('.daily-line-unit',row).value.trim()||'式',qty:context?.strictRows?$('.daily-line-qty',row).value:number($('.daily-line-qty',row).value),inputPrice:number($('.daily-line-price',row).value),unitPrice:number($('.daily-line-price',row).value),taxMode:$('.daily-line-tax',row).value,billable:row.dataset.pricingType!=='lump_sum'&&$('.daily-billable input',row).checked,sourceType:row.dataset.sourceType||'manual',pricingType:row.dataset.pricingType||'actual',quotationId:row.dataset.quotationId||'',quotationLineId:row.dataset.quotationLineId||'',quotationNo:row.dataset.quotationNo||'',quoteId:row.dataset.quotationId||'',quoteLineId:row.dataset.quotationLineId||'',lumpSumAmount:number(row.dataset.lumpSumAmount),workItemId:row.dataset.workItemId||''}));
    const values={date:form.elements.date.value,employeeIds:$$('input[name="dailyEmployees"]:checked',form).map(input=>input.value),lines,commissionEnabled:form.elements.commissionEnabled.checked,workMode:form.elements.workMode.value,workQty:number(form.elements.workQty.value),workRate:number(form.elements.workRate.value),note:form.elements.note.value.trim()};
    dailySubmitInFlight=true;button.disabled=true;button.textContent='儲存中…';
    // Freeze this form's controls while its immutable payload is being committed.
    const enabledControls=$$('input,select,textarea,button',form).filter(input=>!input.disabled);
    enabledControls.forEach(input=>{input.disabled=true});
    let batchId;
    try{
      batchId=await store.saveDailyBatch(values,context?.batchId??editingDailyBatch,context?.strictRows?{strictRows:true,draftRowKeys:rows.map(row=>row.dataset.draftRowKey)}:{});
    }catch(error){
      dailySubmitInFlight=false;
      if(error.transactionStatus==='RECOVERY_REQUIRED'){form.dataset.submitLocked='true';window.KusheRecovery?.showResult(error);button.textContent='狀態待核對，請勿重送'}
      else{enabledControls.forEach(input=>{input.disabled=false});button.disabled=false;button.textContent='儲存每日施工'}
      if(context)context.showRowError(error,rows);else window.KushePhase1?.toast(`儲存失敗：${error.message}`);
      return;
    }
    // From this point forward the batch is durable. A refresh failure is never a save failure.
    form.dataset.committed='true';form.dataset.lastSavedBatch=batchId;
    const result=store.getLastStoreTransactionResult?.();
    try{
      enabledControls.forEach(input=>{input.disabled=false});
      if(context)await context.afterCommit();else{dailySubmitInFlight=false;closeDrawer();render()}
      if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING')window.KusheRecovery?.showResult(result);
      else window.KushePhase1?.toast('每日施工、抽成、點工與待請款已同步儲存');
    }catch(error){
      const warning={status:'COMMITTED_WITH_NOTIFICATION_WARNING',operationId:result?.operationId||'',notificationWarnings:[String(error?.message||error)]};
      form.dataset.committed='true';form.dataset.notificationStatus=warning.status;
      window.KusheRecovery?.showResult(warning);button.textContent='已儲存，請關閉後重新開啟';
    }finally{
      dailySubmitInFlight=false;
      if(form.dataset.committed!=='true'){button.disabled=false;button.textContent='儲存每日施工'}else button.disabled=true;
    }
  }
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
    if(dailySubmitInFlight)return;
    const wasDaily=dailyEditorActive;dailyEditorActive=false;
    const layer=$('#commissionDrawerLayer');layer.classList.remove('is-open');
    window.setTimeout(()=>{if(dailyEditorActive)return;layer.hidden=true;layer.innerHTML='';if(wasDaily&&active&&layer.isConnected)render()},180);
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
  async function activate(options = {}) {
    active = true;
    if (!ready) { await store.load(); filters.month = monthNow(); ready = true; }
    if (options.route === 'attendance') activeTab = 'attendance';
    render();
  }
  function deactivate() { active = false; dailyEditorActive = false; }
  window.addEventListener('kushe:data-updated', () => { if (active && !quickProjectSaveActive && !dailySubmitInFlight && !dailyEditorActive) render(); });
  window.KusheCommissions = { activate, deactivate, render };
}());
