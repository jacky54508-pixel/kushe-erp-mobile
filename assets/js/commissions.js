(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const store = window.KuSheERPStore;
  const filters = { month: '', employee: '', project: '', query: '', sort: 'date', direction: 'desc' };
  let searchTimer = 0;
  let searchComposing = false;
  let searchRenderPending = false;
  let searchLifecycleGeneration = 0;
  let ready = false;
  let active = false;
  let activeTab = 'daily';
  let editingId = null;
  let manualDrawerActive = false;
  let manualSubmitInFlight = false;
  let manualDrawerGeneration = 0;
  let manualRefreshPending = false;
  let manualViewportCleanup = null;
  let editingDailyBatch = '';
  let dailyLineSequence = 0;
  let quickProjectSaveActive = false;
  let quickProjectGeneration = 0;
  let quickProjectSubmission = null;
  let dailySubmitInFlight = false;
  let dailyEditorActive = false;
  let dailyViewportCleanup = null;
  let dailyDetailActive = false;
  let dailyDetailNeedsRefresh = false;
  let dailyDetailContext = null;
  let settlementDrawerActive = false;
  let settlementSubmitInFlight = false;
  let settlementSelectionKeys = new Set();

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
  function previewCommissionTotal(amount, employeeIds, employees, commissionRates = {}, commissionBases = {}, taxIncludedAmount = amount) {
    const sortedEmployeeIds = [...(employeeIds || [])].sort((a, b) => {
      const left = String(a);
      const right = String(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const performanceIndexByEmployeeId = new Map(sortedEmployeeIds.map((employeeId, index) => [employeeId, index]));
    return sortedEmployeeIds.reduce((sum, employeeId) => {
      const employee = (employees || []).find((row) => row.id === employeeId) || {},basis=(commissionBases[employeeId]||employee.commissionBasis)==='taxIncluded'?'taxIncluded':'preTax',basisAmount=basis==='taxIncluded'?taxIncludedAmount:amount;
      const performance = splitPerformanceAmount(basisAmount,sortedEmployeeIds.length,performanceIndexByEmployeeId.get(employeeId));
      const raw=Object.prototype.hasOwnProperty.call(commissionRates,employeeId)?Number(commissionRates[employeeId]):employee.commissionRate===undefined||employee.commissionRate===null||employee.commissionRate===''?25:Number(employee.commissionRate);
      const rate=Number.isFinite(raw)&&raw>=0&&raw<=100?raw:25;
      return sum + Math.round(performance * rate / 100);
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
  // Read-only mirror of Store sourceMatches: index takes precedence over workItemId.
  function dailyBillingSourceMatches(ref, log, item, index) {
    const groupKey = log.groupId || log.id;
    if (ref.sourceGroupKey && ref.sourceGroupKey !== groupKey) return false;
    if (ref.sourceItemIndex !== undefined && ref.sourceItemIndex !== null) return number(ref.sourceItemIndex) === index;
    return Boolean(ref.workItemId) && ref.workItemId === item.workItemId;
  }
  function dailyBillingStatus(summary) {
    if (summary.inconsistentItemCount) return '請款資料待查核';
    if (!summary.billableItemCount) return '不需請款';
    if (!summary.billedItemCount && summary.unbilledItemCount) return '未請款';
    if (summary.billedItemCount && summary.unbilledItemCount) return '部分已請款';
    if (summary.billedItemCount === summary.billableItemCount) return '已請款';
    return '請款資料待查核';
  }
  function buildDailyBillingSummary(state, projectGroups) {
    const empty = () => ({billableItemCount:0,billedItemCount:0,unbilledItemCount:0,inconsistentItemCount:0,remainingAmount:0,billingNumbers:[]});
    const summary = {...empty(),groups:new Map()};
    const billings = (state.billings || []).map((billing) => ({billing,refs:[...(billing.sourceItemRefs || []),...(billing.lines || []).flatMap((line) => line.sourceRefs || [])]}));
    const billable = (log,item) => item.billable !== false && log.billable !== false && !log.noInvoice && item.pricingType !== 'lump_sum';
    const linkage = (item) => JSON.stringify([item.billingStatus || '',item.billingId || '',item.billingNo || '']);
    projectGroups.forEach((members,id) => {
      const first = members[0], group = {...empty(),items:new Map()}, canonical = new Map();
      // Exactly the existing Daily grouping and group-local unique item keys.
      (first.items || []).forEach((item,index) => {
        const key = item.workItemId || `${first.groupId || first.id}:${index}`;
        if (!canonical.has(key)) canonical.set(key,{item,indexes:[]});
        canonical.get(key).indexes.push(index);
      });
      canonical.forEach(({item,indexes}) => {
        const eligible = billable(first,item), signature = linkage(item);
        let conflict = false;
        members.forEach((log) => {
          indexes.forEach((index) => {
            const copy = (log.items || [])[index];
            if (!copy || (copy.workItemId || '') !== (item.workItemId || '') || linkage(copy) !== signature || billable(log,copy) !== eligible) conflict = true;
          });
          // Also detect conflicting duplicate IDs without counting employee copies again.
          if (item.workItemId) (log.items || []).forEach((copy) => {
            if (copy.workItemId === item.workItemId && (linkage(copy) !== signature || billable(log,copy) !== eligible)) conflict = true;
          });
        });
        const matches = billings.filter(({refs}) => refs.some((ref) => indexes.some((index) => dailyBillingSourceMatches(ref,first,item,index))));
        const linked = billings.filter(({billing}) => Boolean(item.billingId) && billing.id === item.billingId);
        let classification = 'excluded', billingNumber = '';
        if (eligible) {
          group.billableItemCount += 1;
          if (!conflict && item.billingStatus === '已請款' && item.billingId && linked.length === 1 && matches.length === 1 && matches[0] === linked[0]) {
            classification = 'billed';
            billingNumber = item.billingNo || linked[0].billing.number || '';
            group.billedItemCount += 1;
          } else if (!conflict && item.billingStatus === '未請款' && !item.billingId && !matches.length) {
            classification = 'unbilled';
            group.unbilledItemCount += 1;
            // Preserve the existing subtotal / zero fallback semantics.
            group.remainingAmount += number(item.untaxedSubtotal) || number(item.qty) * number(item.price);
          } else classification = 'inconsistent';
        } else if (conflict || item.billingId || matches.length || (item.billingStatus && item.billingStatus !== '未請款')) classification = 'inconsistent';
        if (classification === 'inconsistent') group.inconsistentItemCount += 1;
        if (billingNumber && !group.billingNumbers.includes(billingNumber)) group.billingNumbers.push(billingNumber);
        group.items.set(item,{classification,billingNumber});
      });
      group.status = dailyBillingStatus(group);
      summary.groups.set(id,group);
      ['billableItemCount','billedItemCount','unbilledItemCount','inconsistentItemCount','remainingAmount'].forEach((key) => { summary[key] += group[key]; });
      group.billingNumbers.forEach((value) => { if (!summary.billingNumbers.includes(value)) summary.billingNumbers.push(value); });
    });
    summary.status = dailyBillingStatus(summary);
    return summary;
  }
  function dailyBillingBadge(summary) {
    const kind = {'不需請款':'none','未請款':'open','部分已請款':'partial','已請款':'done','請款資料待查核':'review'}[summary.status];
    return `<span class="commission-status daily-billing-status billing-${kind}">${esc(summary.status)}</span>`;
  }
  function dailyBillingCounts(summary) {
    if (summary.status === '不需請款') return '';
    const text = summary.inconsistentItemCount
      ? `${summary.inconsistentItemCount} 項請款資料待查核；已確認剩餘 ${summary.unbilledItemCount} 項`
      : `已請款 ${summary.billedItemCount} / ${summary.billableItemCount} 項；剩餘 ${summary.unbilledItemCount} 項`;
    return `<small class="daily-billing-counts">${esc(text)}</small>`;
  }
  function dailyBillingAmountLabel(summary) {
    return summary.inconsistentItemCount ? '已確認剩餘可請款（總額待查核）' : '剩餘可請款';
  }
  function dailyBillingAmountText(summary) {
    if (!summary.unbilledItemCount && !summary.inconsistentItemCount) return '';
    return `<small class="daily-billing-counts">${esc(dailyBillingAmountLabel(summary))} ${money(summary.remainingAmount)}</small>`;
  }
  function dailyBillingLockLabel(summary) {
    return {'部分已請款':'部分已請款・已鎖定','已請款':'已請款鎖定','請款資料待查核':'請款資料待查核・已鎖定'}[summary.status] || '已進入請款流程・已鎖定';
  }
  function buildDailyBatch(state,batchId,logs) {
      const projectGroups=new Map();logs.forEach((log)=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,[]);projectGroups.get(key).push(log)});
      let untaxed=0,gross=0,itemCount=0;const projects=[],items=[];
      projectGroups.forEach((members)=>{const first=members[0]||{};projects.push(label(state,'projects',first.project,first.projectName||'—'));const seen=new Set();(first.items||[]).forEach((item,index)=>{const key=item.workItemId||`${first.groupId||first.id}:${index}`;if(seen.has(key))return;seen.add(key);const value=number(item.untaxedSubtotal)||number(item.qty)*number(item.price),shown=number(item.subtotal)||(item.taxMode==='含稅'?store.grossFromUntaxed(value):value);untaxed+=value;gross+=shown;itemCount+=1;items.push(item.item||'')})});
      const employees=[...new Set(logs.map((log)=>label(state,'employees',log.employee,log.employeeName||'—')))];
      const billingSummary=buildDailyBillingSummary(state,projectGroups),billingStatus=billingSummary.status,billingAmount=billingSummary.remainingAmount;
      return {batchId,logs,date:logs[0]?.date||'',employees,projects:[...new Set(projects)],items,untaxed,gross,itemCount,billingAmount,billingStatus,billingSummary,commission:logs.reduce((sum,log)=>sum+number(log.commission),0),work:logs.reduce((sum,log)=>sum+store.dailyWorkAmount(log),0),note:logs[0]?.note||''};
  }
  function dailyBatchById(state,batchId) {
    const logs=(state.dailyLogs||[]).filter((log)=>(log.batchId||log.id)===batchId);
    return logs.length?buildDailyBatch(state,batchId,logs):null;
  }
  function dailyBatches(state) {
    const groups = new Map();
    (state.dailyLogs || []).forEach((log) => { const key=log.batchId||log.id; if(!groups.has(key))groups.set(key,[]); groups.get(key).push(log); });
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    return [...groups.entries()].map(([batchId,logs]) => {
      return buildDailyBatch(state,batchId,logs);
    }).filter((batch)=>{
      if(filters.month&&!batch.date.startsWith(filters.month))return false;
      if(filters.employee&&!batch.logs.some((log)=>log.employee===filters.employee))return false;
      if(filters.project&&!batch.logs.some((log)=>log.project===filters.project))return false;
      return !query||`${batch.employees.join(' ')} ${batch.projects.join(' ')} ${batch.items.join(' ')} ${batch.note}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  }
  function dailyActions(batch) {
    const monthPaidLocked=batch.logs.some((log)=>store.payrollHistoryLock(log.employee,log.date).locked),paidDeleteLocked=batch.logs.some((log)=>store.dailyLogPayrollDeleteLock(log).locked),billingLocked=batch.logs.some((log)=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')),actions=paidDeleteLocked?'<span class="commission-status is-settled" title="此紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。">已付款鎖定</span>':billingLocked?`<span class="commission-status billing-done daily-billing-lock" title="此紀錄已進入請款流程，不可修改或刪除。">${esc(dailyBillingLockLabel(batch.billingSummary))}</span>`:monthPaidLocked?`<div class="commission-row-actions"><span class="commission-status is-settled" title="同月份已有薪資付款，為避免新增薪資來源不可編輯。">編輯鎖定</span><button type="button" data-daily-delete="${esc(batch.batchId)}">刪除</button></div>`:`<div class="commission-row-actions"><button type="button" data-daily-edit="${esc(batch.batchId)}">編輯</button><button type="button" data-daily-delete="${esc(batch.batchId)}">刪除</button></div>`;
    return `<button type="button" data-daily-view="${esc(batch.batchId)}">查看內容</button>${actions}`;
  }
  function dailySection(state,batches) {
    return `<section class="commission-panel daily-work-panel"><header><div><h2>每日作業</h2><p>沿用既有每日施工流程；抽成、點工與待請款仍由同一筆來源串聯。</p></div></header><div class="commission-table-wrap daily-desktop-table"><table class="commission-table daily-work-table"><thead><tr><th>日期</th><th>員工</th><th>客戶／案場</th><th>施工項目</th><th class="num">未稅施工額</th><th class="num">抽成</th><th class="num">點工薪資</th><th>請款狀態</th><th>操作</th></tr></thead><tbody>${batches.map((batch)=>{const actions=dailyActions(batch);return `<tr data-daily-batch="${esc(batch.batchId)}"><td>${esc(batch.date)}</td><td><b>${esc(batch.employees.join('、'))}</b></td><td><span class="daily-project-list">${batch.projects.map(esc).join('<br>')}</span></td><td><span class="commission-source">${esc(batch.items.filter(Boolean).slice(0,3).join('、')||'純點工')}${batch.itemCount>3?` 等 ${batch.itemCount} 項`:''}</span></td><td class="num"><b>${money(batch.untaxed)}</b><small>${batch.itemCount} 筆</small></td><td class="num">${money(batch.commission)}</td><td class="num">${money(batch.work)}</td><td>${dailyBillingBadge(batch.billingSummary)}${dailyBillingCounts(batch.billingSummary)}${dailyBillingAmountText(batch.billingSummary)}</td><td>${actions}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="9">此篩選條件下沒有每日作業紀錄。</td></tr>'}</tbody></table></div><div class="daily-mobile-list" aria-label="每日作業清單">${dailyMobileCards(batches)}</div></section>`;
  }
  function dailyMobileCards(batches) {
    return batches.map((batch)=>`<article class="daily-mobile-card" data-daily-card="${esc(batch.batchId)}"><header><strong>${esc(batch.date)}</strong>${dailyBillingBadge(batch.billingSummary)}</header>${dailyBillingCounts(batch.billingSummary)}<h3>${esc(batch.employees.join('、'))}</h3><p>${esc(batch.projects.join('、'))}</p><p>${esc(batch.items.filter(Boolean).slice(0,3).join('、')||'純點工')}${batch.itemCount>3?` 等 ${batch.itemCount} 項`:''}</p><small>${batch.itemCount} 筆</small><dl>${dailyDetailField('未稅施工額',batch.untaxed,true)}${dailyDetailField('抽成',batch.commission,true)}${dailyDetailField('點工薪資',batch.work,true)}${batch.billingSummary.unbilledItemCount||batch.billingSummary.inconsistentItemCount?dailyDetailField(dailyBillingAmountLabel(batch.billingSummary),batch.billingSummary.remainingAmount,true):''}</dl><footer>${dailyActions(batch)}</footer></article>`).join('')||'<p class="daily-mobile-empty">此篩選條件下沒有每日作業紀錄。</p>';
  }
  function dailyDetailField(title,value,isMoney=false) {
    const text=value===null||value===undefined||value===''?'—':isMoney?money(value):typeof value==='boolean'?(value?'是':'否'):value;
    return `<div><dt>${esc(title)}</dt><dd>${esc(text)}</dd></div>`;
  }
  function dailyDetailGroups(batch) {
    // Match the batch builder: first log per source group, group-local item IDs.
    const groups=new Map();
    batch.logs.forEach((log)=>{const key=log.groupId||log.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(log)});
    return [...groups.entries()].map(([id,logs])=>{
      const first=logs[0],seen=new Set(),items=[];
      (first.items||[]).forEach((item,index)=>{const key=item.workItemId||`${first.groupId||first.id}:${index}`;if(seen.has(key))return;seen.add(key);items.push(item)});
      return {id,first,items};
    });
  }
  function dailyDetailItem(item,billing) {
    const field=dailyDetailField;
    const source=item.sourceType==='quotation'?'報價來源':item.sourceType==='manual'?'手動施工':item.sourceType||'未標示來源';
    return `<article class="daily-detail-item"><h5>${esc(item.item||item.itemName||'未命名施工項目')}</h5><dl>${field('單位',item.unit)}${field('數量',item.qty)}${field('單價',item.price,true)}${field('輸入單價',item.inputPrice,true)}${field('來源單價',item.unitPrice,true)}${field('未稅小計',item.untaxedSubtotal,true)}${field('小計',item.subtotal,true)}${field('稅別',item.taxMode)}${field('可請款',item.billable)}${field('請款狀態',item.billingStatus)}${billing?.classification==='inconsistent'?field('請款查核','請款資料待查核'):''}${field('請款單號',billing?.billingNumber||item.billingNo)}${field('不需請款',item.noInvoice)}${field('來源',source)}${field('報價單號',item.quotationNo)}${field('計價方式',item.pricingType)}${field('整筆金額',item.lumpSumAmount,true)}</dl>${item.note?`<p>備註：${esc(item.note)}</p>`:''}<details><summary>技術資訊</summary><dl>${field('施工項目 ID',item.workItemId)}${field('報價 ID',item.quotationId??item.quoteId)}${field('報價明細 ID',item.quotationLineId??item.quoteLineId)}${field('請款 ID',item.billingId)}</dl></details></article>`;
  }
  function openDailyDetail(batchId,trigger=document.activeElement) {
    const state=store.getState(),batch=dailyBatchById(state,batchId);
    if(!batch)return window.KushePhase1?.toast('找不到對應的每日作業來源');
    const layer=$('#commissionDrawerLayer');if(!layer)return;
    if(!dailyDetailActive)dailyDetailContext={trigger,x:window.scrollX,y:window.scrollY};
    dailyDetailActive=true;
    const field=dailyDetailField;
    const workforce=batch.logs.map((log)=>`<article class="daily-detail-worker"><h4>${esc(label(state,'employees',log.employee,log.employeeName||'—'))}</h4><dl>${field('案場',label(state,'projects',log.project,log.projectName||'—'))}${field('點工類型',log.workMode==='hourly'?'時薪':log.workMode==='daily'?'日薪':'不計點工')}${field('點工數量',log.workQty)}${field('點工單價',log.workRate,true)}${field('點工金額',store.dailyWorkAmount(log),true)}${field('業績',log.performance,true)}${field('抽成比例',log.rate===null||log.rate===undefined?'—':log.rate+'%')}${field('抽成',log.commission,true)}</dl>${log.note?`<p>備註：${esc(log.note)}</p>`:''}</article>`).join('');
    const projects=dailyDetailGroups(batch).map(({id,first,items})=>{
      const billing=batch.billingSummary.groups.get(id);
      const houses=new Map();items.forEach((item)=>{const house=item.house||'未指定戶別';if(!houses.has(house))houses.set(house,[]);houses.get(house).push(item)});
      return `<section class="daily-detail-project" data-detail-group="${esc(id)}"><h3>${esc(label(state,'projects',first.project,first.projectName||'—'))}</h3><dl>${field('客戶',label(state,'customers',first.customer,first.customerName||'—'))}${field('請款狀態',billing.status)}${field('已請款項數',`${billing.billedItemCount} / ${billing.billableItemCount}`)}${field('剩餘項數',billing.unbilledItemCount)}${field(dailyBillingAmountLabel(billing),billing.remainingAmount,true)}${field('待查核項數',billing.inconsistentItemCount)}${field('請款單號',billing.billingNumbers.join('、'))}${field('請款 ID',first.billingId)}${field('可請款',first.billable)}${field('不需請款',first.noInvoice)}</dl>${[...houses.entries()].map(([house,rows])=>`<section class="daily-detail-house"><h4>${esc(house)}</h4>${rows.map((item)=>dailyDetailItem(item,billing.items.get(item))).join('')}</section>`).join('')||'<p>此來源群組沒有施工項目。</p>'}</section>`;
    }).join('');
    layer.hidden=false;layer.innerHTML=`<div class="commission-drawer-backdrop" data-detail-close></div><aside class="commission-drawer daily-readonly-detail" role="dialog" aria-modal="true" aria-labelledby="dailyDetailTitle"><header><div><h2 id="dailyDetailTitle">每日作業內容</h2><p>${esc(batch.date)} · ${esc(batch.billingSummary.status)}</p></div><button type="button" data-detail-close aria-label="關閉每日作業內容">關閉</button></header><div class="daily-detail-body"><p>${esc(batch.employees.join('、'))}</p><dl class="daily-detail-summary">${field('未稅施工額',batch.untaxed,true)}${field('施工總額',batch.gross,true)}${field('抽成',batch.commission,true)}${field('點工薪資',batch.work,true)}${field(dailyBillingAmountLabel(batch.billingSummary),batch.billingSummary.remainingAmount,true)}${field('已請款項數',`${batch.billingSummary.billedItemCount} / ${batch.billingSummary.billableItemCount}`)}${field('剩餘項數',batch.billingSummary.unbilledItemCount)}${field('待查核項數',batch.billingSummary.inconsistentItemCount)}</dl><section><h3>員工作業</h3>${workforce}</section><section><h3>施工明細</h3>${projects}</section></div></aside>`;
    layer.classList.add('is-open');
    $$('[data-detail-close]',layer).forEach((button)=>button.addEventListener('click',closeDailyDetail));
    layer.onkeydown=(event)=>{if(event.key==='Escape'){event.preventDefault();closeDailyDetail()}else if(event.key==='Tab'){const targets=$$('button,summary',layer),first=targets[0],last=targets[targets.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};
    $('button',layer).focus({preventScroll:true});
  }
  function closeDailyDetail() {
    if(!dailyDetailActive)return;
    const context=dailyDetailContext,refresh=dailyDetailNeedsRefresh;
    dailyDetailActive=false;dailyDetailNeedsRefresh=false;dailyDetailContext=null;
    const layer=$('#commissionDrawerLayer');if(layer){layer.onkeydown=null;layer.classList.remove('is-open');layer.hidden=true;layer.innerHTML=''}
    if(refresh&&active)render();
    if(context){if(context.trigger?.isConnected)context.trigger.focus({preventScroll:true});window.scrollTo(context.x,context.y)}
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
  function attendanceMobileCards(state, rows) {
    return rows.map((row) => {
      const employeeId=employeeIdOf(row),projectId=projectIdOf(row),isDaily=row.sourceType==='daily-log',isHourly=row.workMode==='hourly'||number(row.hours)>0,rate=isHourly?row.hourlyRate??row.rate:row.dailyRate??row.rate;
      return `<article class="attendance-mobile-card" data-attendance-id="${esc(row.id)}">
        <header><strong>${esc(row.date||'—')}</strong><span class="commission-status ${row.status==='已列入薪資'?'is-settled':'is-unsettled'}">${esc(row.status||'—')}</span></header>
        <div class="attendance-mobile-primary"><span>員工</span><strong>${esc(label(state,'employees',employeeId,row.employeeName||'—'))}</strong><span>案場</span><b>${esc(label(state,'projects',projectId,row.projectName||'—'))}</b></div>
        <dl class="attendance-mobile-details"><div><dt>點工類型</dt><dd>${esc(isHourly?'時薪':'日薪')}</dd></div><div><dt>天數</dt><dd>${number(row.days)?number(row.days):'—'}</dd></div><div><dt>時數</dt><dd>${number(row.hours)?number(row.hours):'—'}</dd></div><div><dt>單價</dt><dd>${rate===null||rate===undefined?'—':money(rate)}</dd></div></dl>
        <dl class="attendance-mobile-amounts"><div><dt>點工金額</dt><dd>${money(row.amount)}</dd></div><div><dt>油費</dt><dd>${number(row.fuel)?money(row.fuel):'—'}</dd></div></dl>
        <div class="attendance-mobile-source"><span>來源</span><span class="workforce-source-badge ${isDaily?'is-synced':'is-legacy'}">${isDaily?'每日施工同步':'歷史出勤'}</span>${row.sourceNo?`<small>${esc(row.sourceNo)}</small>`:''}</div>
        <footer>${isDaily&&row.sourceId?`<button class="commission-link" type="button" data-view-daily-source="${esc(row.sourceId)}">查看來源</button>`:'<span class="workforce-readonly-row">唯讀</span>'}</footer>
      </article>`;
    }).join('') || '<p class="attendance-mobile-empty">此篩選條件下沒有出勤／點工紀錄。</p>';
  }
  function attendanceSection(state, rows) {
    return `<section class="commission-panel commission-table-panel workforce-attendance-panel"><header><div><h2>出勤／點工</h2><p>直接呈現正式薪資來源；歷史獨立出勤維持唯讀，不進行轉換。</p></div><span class="workforce-readonly">唯讀</span></header><div class="commission-table-wrap attendance-desktop-table"><table class="commission-table workforce-attendance-table"><thead><tr><th>日期</th><th>員工</th><th>案場</th><th>點工類型</th><th class="num">天數</th><th class="num">時數</th><th class="num">單價</th><th class="num">點工金額</th><th class="num">油費</th><th>來源</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>{const employeeId=employeeIdOf(row),projectId=projectIdOf(row),isDaily=row.sourceType==='daily-log',isHourly=row.workMode==='hourly'||number(row.hours)>0,rate=isHourly?row.hourlyRate??row.rate:row.dailyRate??row.rate;return `<tr data-attendance-id="${esc(row.id)}"><td>${esc(row.date||'—')}</td><td><b>${esc(label(state,'employees',employeeId,row.employeeName||'—'))}</b></td><td>${esc(label(state,'projects',projectId,row.projectName||'—'))}</td><td>${esc(isHourly?'時薪':'日薪')}</td><td class="num">${number(row.days)?number(row.days):'—'}</td><td class="num">${number(row.hours)?number(row.hours):'—'}</td><td class="num">${rate===null||rate===undefined?'—':money(rate)}</td><td class="num"><b>${money(row.amount)}</b></td><td class="num">${number(row.fuel)?money(row.fuel):'—'}</td><td><span class="workforce-source-badge ${isDaily?'is-synced':'is-legacy'}">${isDaily?'每日施工同步':'歷史出勤'}</span>${row.sourceNo?`<small class="workforce-source-no">${esc(row.sourceNo)}</small>`:''}</td><td><span class="commission-status ${row.status==='已列入薪資'?'is-settled':'is-unsettled'}">${esc(row.status||'—')}</span></td><td>${isDaily&&row.sourceId?`<button class="commission-link" type="button" data-view-daily-source="${esc(row.sourceId)}">查看來源</button>`:'<span class="workforce-readonly-row">唯讀</span>'}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="12">此篩選條件下沒有出勤／點工紀錄。</td></tr>'}</tbody></table></div><div class="attendance-mobile-list" aria-label="出勤／點工清單">${attendanceMobileCards(state,rows)}</div></section>`;
  }
  function commissionSettlementStatusForRow(row, cache) {
    const employeeId=employeeIdOf(row),projectId=projectIdOf(row),key=`${employeeId}::${projectId}`;
    if(!cache.has(key)){
      let preview=null;
      try{preview=store.projectCommissionSettlementPreview?.(employeeId,projectId,[])}catch(_error){preview=null}
      cache.set(key,preview);
    }
    const allocations=(cache.get(key)?.availableAllocations||[]).filter((item)=>String(item.commissionId||'')===String(row.id||''));
    if(!allocations.length)return {label:'—',className:'is-neutral'};
    const settled=allocations.filter((item)=>item.settled).length;
    if(settled===allocations.length)return {label:'已發',className:'is-settled'};
    if(settled>0)return {label:'部分已發',className:'is-unsettled'};
    return {label:'待發',className:'is-unsettled'};
  }
  function buildCommissionPresentationRows(state, rows) {
    const settlementCache=new Map();
    return rows.map((row)=>{
      const linkedPayroll=state.payroll.filter((item)=>item.month===String(row.date||'').slice(0,7)&&item.employee===row.employee),locked=store.payrollHistoryLock(row.employee,row.date).locked,source=store.commissionBillingLink(row),isDaily=source.kind==='daily-log',sourceView={linked:['請款來源','is-synced'],'orphan-billing':['來源已不存在','is-legacy'],manual:['手動登錄','is-manual'],'daily-log':['每日施工同步','is-synced'],ambiguous:['來源待確認','is-legacy']}[source.kind]||['來源待確認','is-legacy'],projectPayment=commissionSettlementStatusForRow(row,settlementCache);
      return {row,employeeName:label(state,'employees',row.employee,row.employeeName||'—'),projectName:label(state,'projects',row.project,row.projectName||'—'),source,sourceView,gross:grossOf(state,row),locked,actions:locked?`<span class="commission-status is-settled" title="${source.kind==='orphan-billing'?'此抽成已納入真正已付款薪資，不能直接清除來源。':'此紀錄已納入已付款薪資，為保留歷史帳務不可修改。'}">已付款鎖定</span>`:isDaily?'<span class="commission-status" title="請由每日施工來源調整">來源同步</span>':`<div class="commission-row-actions"><button type="button" data-edit="${esc(row.id)}">編輯</button><button type="button" data-delete="${esc(row.id)}">刪除</button></div>`,payrollRecords:linkedPayroll.length,payrollCommission:linkedPayroll.filter((item)=>item.status!=='已付款').reduce((sum,item)=>sum+number(item.commission),0),payrollLabel:row.status==='已列入薪資'?'已列入薪資':'未列入薪資',payrollClass:row.status==='已列入薪資'?'is-settled':'is-unsettled',projectPayment};
    });
  }
  function commissionPresentationAttributes(view) {
    return `data-row-id="${esc(view.row.id)}" data-source-integrity="${esc(view.source.kind)}" data-payroll-records="${view.payrollRecords}" data-payroll-commission="${view.payrollCommission}"`;
  }
  function commissionMobileCards(views) {
    return `<div class="commission-mobile-list">${views.map((view)=>{const row=view.row;return `<article class="commission-mobile-card" ${commissionPresentationAttributes(view)}><header><span>${esc(row.date||'—')}</span><span class="commission-status ${view.projectPayment.className}">${view.projectPayment.label}</span></header><div class="commission-mobile-primary"><strong>${esc(view.employeeName)}</strong><span>${esc(view.projectName)}</span></div><div class="commission-mobile-source"><span class="workforce-source-badge ${view.sourceView[1]}">${view.sourceView[0]}</span>${row.sourceNo?`<small class="workforce-source-no">${esc(row.sourceNo)}</small>`:''}</div><dl><div><dt>含稅金額</dt><dd>${money(view.gross)}</dd></div><div><dt>未稅金額</dt><dd>${money(row.untaxedAmount)}</dd></div><div><dt>抽成 %</dt><dd>${number(row.rate)}%</dd></div><div><dt>抽成金額</dt><dd>${money(row.commission)}</dd></div><div><dt>薪資狀態</dt><dd><span class="commission-status ${view.payrollClass}">${view.payrollLabel}</span></dd></div><div><dt>案場抽成付款</dt><dd><span class="commission-status ${view.projectPayment.className}">${view.projectPayment.label}</span></dd></div></dl><footer>${view.actions}</footer></article>`}).join('')||'<p class="commission-mobile-empty">此篩選條件下沒有業績／抽成紀錄。</p>'}</div>`;
  }
  function settlementHistoryRows(state) {
    return (state.commissionSettlements||[]).filter((row)=>{
      if(filters.employee&&String(row.employeeId||row.employee||'')!==filters.employee)return false;
      if(filters.project&&String(row.projectId||row.project||'')!==filters.project)return false;
      if(filters.month&&!String(row.date||'').startsWith(filters.month))return false;
      const query=filters.query.trim().toLocaleLowerCase('zh-Hant');
      return !query||`${row.employeeName||''} ${row.projectName||''} ${row.note||''}`.toLocaleLowerCase('zh-Hant').includes(query);
    }).sort((a,b)=>String(b.date||b.createdAt||'').localeCompare(String(a.date||a.createdAt||'')));
  }
  function settlementHistorySection(state) {
    const rows=settlementHistoryRows(state);
    const bankName=(row)=>{const id=String(row.bankAccountId||row.bankId||'');const bank=(state.banks||[]).find((item)=>String(item.id||'')===id);return bank?.name||bank?.bank||bank?.account||'—'};
    return `<section class="commission-panel project-settlement-history"><header><div><h2>案場抽成結算紀錄</h2><p>已付款結算可隨時查看或重新匯出結算單；PDF 不顯示抽成比例。</p></div></header><div class="commission-table-wrap project-settlement-history-desktop"><table class="commission-table"><thead><tr><th>結算日期</th><th>員工</th><th>案場</th><th class="num">結算金額</th><th>付款銀行／方式</th><th>備註</th><th>結算單</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${esc(row.date||'—')}</td><td><b>${esc(row.employeeName||label(state,'employees',row.employeeId||row.employee,'—'))}</b></td><td>${esc(row.projectName||label(state,'projects',row.projectId||row.project,'—'))}</td><td class="num"><b>${money(row.amount)}</b></td><td>${esc(bankName(row))}<small class="workforce-source-no">${esc(row.paymentMethod||'銀行轉帳')}</small></td><td>${esc(row.note||'—')}</td><td><div class="commission-row-actions"><button type="button" data-settlement-print="${esc(row.id)}">查看</button><button type="button" data-settlement-export="${esc(row.id)}">匯出 PDF</button></div></td></tr>`).join('')||'<tr><td class="commission-empty" colspan="7">目前沒有符合條件的案場抽成結算紀錄。</td></tr>'}</tbody></table></div><div class="project-settlement-history-mobile">${rows.map((row)=>`<article class="summary-mobile-card"><header><h3>${esc(row.employeeName||label(state,'employees',row.employeeId||row.employee,'—'))}</h3><strong>${money(row.amount)}</strong></header><dl><div><dt>結算日期</dt><dd>${esc(row.date||'—')}</dd></div><div><dt>案場</dt><dd>${esc(row.projectName||label(state,'projects',row.projectId||row.project,'—'))}</dd></div><div><dt>付款</dt><dd>${esc(bankName(row))}／${esc(row.paymentMethod||'銀行轉帳')}</dd></div></dl><footer><button class="commission-link" type="button" data-settlement-print="${esc(row.id)}">查看結算單</button><button class="commission-link" type="button" data-settlement-export="${esc(row.id)}">匯出 PDF</button></footer></article>`).join('')||'<p class="summary-mobile-empty">目前沒有符合條件的案場抽成結算紀錄。</p>'}</div></section>`;
  }
  function commissionSection(state, rows) {
    const views=buildCommissionPresentationRows(state,rows);
    return `<section class="commission-panel commission-table-panel"><header><div><h2>業績／抽成</h2><p>薪資列入狀態與案場抽成實際付款分開呈現，避免把「已列入薪資」誤認為「已付款」。</p></div><button class="commission-primary commission-settlement-open" id="projectCommissionSettlementOpen" type="button">案場抽成結算</button></header><div class="commission-table-wrap commission-desktop-table"><table class="commission-table workforce-commission-table"><thead><tr><th>${sortButton('date','日期')}</th><th>${sortButton('employee','員工')}</th><th>${sortButton('project','案場')}</th><th>業績來源</th><th class="num">含稅金額</th><th class="num">${sortButton('untaxedAmount','未稅金額')}</th><th class="num">${sortButton('rate','抽成 %')}</th><th class="num">${sortButton('commission','抽成金額')}</th><th>${sortButton('status','薪資狀態')}</th><th>案場抽成付款</th><th>操作</th></tr></thead><tbody>${views.map((view)=>{const row=view.row;return `<tr ${commissionPresentationAttributes(view)}><td>${esc(row.date||'—')}</td><td><b>${esc(view.employeeName)}</b></td><td>${esc(view.projectName)}</td><td><span class="workforce-source-badge ${view.sourceView[1]}">${view.sourceView[0]}</span>${row.sourceNo?`<small class="workforce-source-no">${esc(row.sourceNo)}</small>`:''}</td><td class="num">${money(view.gross)}</td><td class="num">${money(row.untaxedAmount)}</td><td class="num">${number(row.rate)}%</td><td class="num"><b>${money(row.commission)}</b></td><td><span class="commission-status ${view.payrollClass}">${view.payrollLabel}</span></td><td><span class="commission-status ${view.projectPayment.className}">${view.projectPayment.label}</span></td><td>${view.actions}</td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="11">此篩選條件下沒有業績／抽成紀錄。</td></tr>'}</tbody></table></div>${commissionMobileCards(views)}</section>${settlementHistorySection(state)}`;
  }

  function settlementHouseGroups(preview) {
    const groups=new Map();
    (preview?.availableAllocations||[]).forEach((row)=>{
      const house=String(row.house||'未指定戶別'),key=house;
      if(!groups.has(key))groups.set(key,{house,dates:new Set(),selectionKeys:[],untaxedAmount:0,amount:0,settledAmount:0,settledCount:0,totalCount:0});
      const group=groups.get(key);group.totalCount+=1;group.dates.add(row.date||'—');
      if(row.settled){group.settledCount+=1;group.settledAmount+=number(row.amount)}
      else{group.selectionKeys.push(row.allocationKey);group.untaxedAmount+=number(row.untaxedAmount);group.amount+=number(row.amount)}
    });
    return [...groups.values()].sort((a,b)=>a.house.localeCompare(b.house,'zh-Hant'));
  }
  function settlementGroupStatus(group) {
    if(group.settledCount===group.totalCount&&group.totalCount>0)return {label:'已發',className:'is-settled'};
    if(group.settledCount>0)return {label:'部分已發',className:'is-unsettled'};
    return {label:'待發',className:'is-unsettled'};
  }
  function renderProjectCommissionSettlementDrawer(employeeId=filters.employee,projectId=filters.project) {
    const layer=$('#commissionDrawerLayer');if(!layer)return;
    const state=store.getState(),employee=String(employeeId||''),project=String(projectId||'');
    let preview=null;try{if(employee&&project)preview=store.projectCommissionSettlementPreview(employee,project,[])}catch(_error){preview=null}
    const groups=settlementHouseGroups(preview);
    const availableKeys=new Set(groups.flatMap((group)=>group.selectionKeys));
    if(!settlementSelectionKeys.size)availableKeys.forEach((key)=>settlementSelectionKeys.add(key));
    [...settlementSelectionKeys].forEach((key)=>{if(!availableKeys.has(key))settlementSelectionKeys.delete(key)});
    const selected=[...settlementSelectionKeys],selectedPreview=employee&&project?store.projectCommissionSettlementPreview(employee,project,selected):null;
    const blockers=selectedPreview?.blockers||[],total=selectedPreview?.total||0;
    settlementDrawerActive=true;layer.dataset.drawerMode='settlement';
    layer.innerHTML=`<aside class="commission-drawer project-settlement-drawer" role="dialog" aria-modal="true" aria-labelledby="projectSettlementTitle">
      <form id="projectSettlementForm">
        <header><div><h2 id="projectSettlementTitle">案場抽成結算</h2><p>同案場、同戶別可跨日期彙整；底層仍保留每筆來源，避免重複付款。</p></div><button type="button" data-settlement-close aria-label="關閉">×</button></header>
        <div class="commission-drawer-body project-settlement-body">
          <div class="project-settlement-selectors">
            <label><span>員工 *</span><select name="employeeId" required>${options(state.employees,employee,'請選員工')}</select></label>
            <label><span>案場 *</span><select name="projectId" required>${options(state.projects,project,'請選案場')}</select></label>
          </div>
          ${employee&&project?`<section class="project-settlement-houses"><header><div><b>戶別抽成</b><small>勾選本次要付款的戶別；已發來源不可再次勾選。</small></div><button type="button" class="commission-secondary" data-settlement-select-all>全選待發</button></header>
            <div class="project-settlement-house-list">${groups.map((group)=>{const status=settlementGroupStatus(group),enabled=group.selectionKeys.length>0,checked=enabled&&group.selectionKeys.every((key)=>settlementSelectionKeys.has(key));return `<label class="project-settlement-house ${enabled?'':'is-disabled'}"><input type="checkbox" data-settlement-house="${esc(group.house)}" ${checked?'checked':''} ${enabled?'':'disabled'}><span class="project-settlement-house-main"><strong>${esc(group.house)}</strong><small>${esc([...group.dates].sort().join('、'))}</small></span><span class="project-settlement-house-money"><b>${money(group.amount)}</b><small>未稅業績 ${money(group.untaxedAmount)}</small></span><span class="commission-status ${status.className}">${status.label}</span></label>`}).join('')||'<p class="commission-mobile-empty">此員工／案場目前沒有可結算戶別。</p>'}</div>
          </section>`:'<p class="project-settlement-empty">請先選擇員工與案場。</p>'}
          <section class="project-settlement-payment">
            <label><span>付款銀行 *</span><select name="bankAccountId" required>${options(state.banks, '', '請選銀行')}</select></label>
            <label><span>付款日期 *</span><input name="date" type="date" value="${today()}" required></label>
            <label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="0"></label>
            <label><span>手續費負擔</span><select name="feePayer"><option value="company">公司負擔</option><option value="recipient">員工負擔</option></select></label>
            <label class="full"><span>備註</span><textarea name="note" rows="3" placeholder="例如：本次結算戶別、轉帳備註"></textarea></label>
          </section>
          <div class="project-settlement-summary"><span>本次勾選</span><strong>${money(total)}</strong><small>${selected.length} 筆戶別來源</small></div>
          ${blockers.length?`<div class="project-settlement-blockers">${blockers.map((row)=>`<p>${esc(row.message||'目前不可結算')}</p>`).join('')}</div>`:''}
        </div>
        <footer><button class="commission-secondary" type="button" data-settlement-close>取消</button><button class="commission-primary" type="submit" ${!employee||!project||!selected.length||!selectedPreview?.allowed?'disabled':''}>確認付款</button></footer>
      </form>
    </aside>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));
    const form=$('#projectSettlementForm',layer),employeeSelect=form.elements.employeeId,projectSelect=form.elements.projectId;
    const rerender=()=>{const nextEmployee=employeeSelect.value,nextProject=projectSelect.value;settlementSelectionKeys=new Set();renderProjectCommissionSettlementDrawer(nextEmployee,nextProject)};
    employeeSelect.addEventListener('change',rerender);projectSelect.addEventListener('change',rerender);
    $$('[data-settlement-house]',form).forEach((input)=>input.addEventListener('change',()=>{
      const group=groups.find((item)=>item.house===input.dataset.settlementHouse);if(!group)return;
      group.selectionKeys.forEach((key)=>input.checked?settlementSelectionKeys.add(key):settlementSelectionKeys.delete(key));
      renderProjectCommissionSettlementDrawer(employee,project);
    }));
    $('[data-settlement-select-all]',form)?.addEventListener('click',()=>{settlementSelectionKeys=new Set(groups.flatMap((group)=>group.selectionKeys));renderProjectCommissionSettlementDrawer(employee,project)});
    $$('[data-settlement-close]',form).forEach((button)=>button.addEventListener('click',closeProjectCommissionSettlementDrawer));
    form.addEventListener('submit',submitProjectCommissionSettlement);
  }
  function closeProjectCommissionSettlementDrawer() {
    const layer=$('#commissionDrawerLayer');if(!layer)return;
    settlementDrawerActive=false;settlementSubmitInFlight=false;settlementSelectionKeys=new Set();layer.classList.remove('is-open');layer.hidden=true;layer.innerHTML='';delete layer.dataset.drawerMode;
    if(searchRenderPending)refreshWorkforceResults();
  }
  async function submitProjectCommissionSettlement(event) {
    event.preventDefault();if(settlementSubmitInFlight)return;
    const form=event.currentTarget,data=new FormData(form),employeeId=String(data.get('employeeId')||''),projectId=String(data.get('projectId')||''),selectionKeys=[...settlementSelectionKeys];
    if(!employeeId||!projectId||!selectionKeys.length)return window.KushePhase1?.toast('請選擇員工、案場與至少一個待發戶別');
    settlementSubmitInFlight=true;const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try{
      await store.addProjectCommissionSettlement({employeeId,projectId,selectionKeys,bankAccountId:String(data.get('bankAccountId')||''),date:String(data.get('date')||today()),fee:number(data.get('fee')),feePayer:String(data.get('feePayer')||'company'),paymentMethod:'銀行轉帳',note:String(data.get('note')||'')});
      closeProjectCommissionSettlementDrawer();refreshWorkforceResults();window.KushePhase1?.toast('案場抽成付款已完成，銀行與薪資摘要已同步');
    }catch(error){window.KushePhase1?.toast(error.message||'案場抽成結算失敗');if(submit)submit.disabled=false}
    finally{settlementSubmitInFlight=false}
  }
  function payrollState(state, employeeId, month) {
    const group=store.monthlyPayrollGroups().find((row)=>row.employeeId===employeeId&&String(row.month||'').slice(0,7)===month);
    if(!group)return {label:'尚未建立',className:'is-neutral'};
    if(group.paid>0&&group.outstanding>0)return {label:'部分已付款',className:'is-unsettled'};
    return group.outstanding<=0&&group.total>0?{label:'已付款',className:'is-settled'}:{label:'未付款',className:'is-unsettled'};
  }
  function buildSummaryRows(state, attendanceRows, commissionRows) {
    const grouped=new Map(),ensure=(employeeId,fallback='—')=>{if(!employeeId)return null;if(!grouped.has(employeeId))grouped.set(employeeId,{employeeId,name:label(state,'employees',employeeId,fallback),days:0,hours:0,work:0,untaxed:0,commission:0});return grouped.get(employeeId)};
    attendanceRows.forEach((row)=>{const target=ensure(employeeIdOf(row),row.employeeName||'—');if(!target)return;target.days+=number(row.days);target.hours+=number(row.hours);target.work+=number(row.amount)});
    commissionRows.forEach((row)=>{const target=ensure(employeeIdOf(row),row.employeeName||'—');if(!target)return;target.untaxed+=number(row.untaxedAmount);target.commission+=number(row.commission)});
    const rows=[...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
    return rows.map((row)=>({...row,payrollStatus:payrollState(state,row.employeeId,filters.month)}));
  }
  function summarySection(state, attendanceRows, commissionRows) {
    const rows=buildSummaryRows(state,attendanceRows,commissionRows);
    return `<section class="commission-panel commission-table-panel workforce-summary-panel"><header><div><h2>月度彙總</h2><p>點工與業績各取唯一正式來源，避免每日作業衍生資料重複加總。</p></div></header><div class="commission-table-wrap summary-desktop-table"><table class="commission-table workforce-summary-table"><thead><tr><th>員工</th><th class="num">出勤天數</th><th class="num">工時</th><th class="num">點工薪資</th><th class="num">未稅業績</th><th class="num">抽成</th><th>薪資狀態</th><th>操作</th></tr></thead><tbody>${rows.map((row)=>{const status=row.payrollStatus;return `<tr><td><b>${esc(row.name)}</b></td><td class="num">${row.days||'—'}</td><td class="num">${row.hours||'—'}</td><td class="num"><b>${money(row.work)}</b></td><td class="num">${row.untaxed?money(row.untaxed):'—'}</td><td class="num">${row.commission?money(row.commission):'—'}</td><td><span class="commission-status ${status.className}">${esc(status.label)}</span></td><td><button class="commission-link" type="button" data-view-payroll="${esc(row.employeeId)}">查看薪資</button></td></tr>`}).join('')||'<tr><td class="commission-empty" colspan="8">此月份沒有可彙總的出勤或抽成來源。</td></tr>'}</tbody></table></div><div class="summary-mobile-list">${rows.map((row)=>`<article class="summary-mobile-card"><header><h3>${esc(row.name)}</h3><span class="commission-status ${row.payrollStatus.className}">${esc(row.payrollStatus.label)}</span></header><dl><div><dt>出勤天數</dt><dd>${row.days||'—'}</dd></div><div><dt>工時</dt><dd>${row.hours||'—'}</dd></div><div><dt>點工薪資</dt><dd>${money(row.work)}</dd></div><div><dt>未稅業績</dt><dd>${row.untaxed?money(row.untaxed):'—'}</dd></div><div><dt>抽成</dt><dd>${row.commission?money(row.commission):'—'}</dd></div></dl><footer><button class="commission-link" type="button" data-view-payroll="${esc(row.employeeId)}">查看薪資</button></footer></article>`).join('')||'<p class="summary-mobile-empty">此月份沒有可彙總的出勤或抽成來源。</p>'}</div></section>`;
  }
  function tabContent(state, batches, attendanceRows, commissionRows) {
    if(activeTab==='attendance')return attendanceSection(state,attendanceRows);
    if(activeTab==='commissions')return commissionSection(state,commissionRows);
    if(activeTab==='summary')return summarySection(state,attendanceRows,commissionRows);
    return `${todayProjectsSection(state)}${dailySection(state,batches)}`;
  }
  function cancelSearchTimer() {
    window.clearTimeout(searchTimer);
    searchTimer = 0;
  }
  function scheduleSearchRefresh() {
    cancelSearchTimer();
    const generation = searchLifecycleGeneration;
    searchTimer = window.setTimeout(() => {
      searchTimer = 0;
      if (!active || generation !== searchLifecycleGeneration) return;
      if (searchComposing) { searchRenderPending = true; return; }
      refreshWorkforceResults();
    }, 180);
  }
  function commitSearchForAction() {
    cancelSearchTimer();
    const input = $('#commissionQueryFilter');
    if (input) filters.query = input.value;
    searchComposing = false;
  }
  function refreshWorkforceResults() {
    cancelSearchTimer();
    if (!active) return;
    if (dailyDetailActive) { dailyDetailNeedsRefresh = true; searchRenderPending = true; return; }
    if (searchComposing || dailyEditorActive || manualDrawerActive || settlementDrawerActive || quickProjectSaveActive || dailySubmitInFlight) {
      searchRenderPending = true;
      return;
    }
    const root = $('#commissionsApp'), panel = $('.workforce-tab-panel', root);
    if (!panel) { render(); return; }
    const view = workforceSnapshot();
    const {state, rows, batches, attendanceRows} = view;
    $('.workforce-kpis', root).outerHTML = workforceKpis(view);
    panel.innerHTML = tabContent(state, batches, attendanceRows, rows);
    // Keep the filter shell and focused search node continuously connected.
    $('#commissionEmployeeFilter').innerHTML = options(state.employees, filters.employee, '全部員工');
    $('#commissionProjectFilter').innerHTML = options(state.projects, filters.project, '全部案場');
    $$('[data-workforce-tab]').forEach((button) => {
      const selected = button.dataset.workforceTab === activeTab;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-active', selected);
    });
    searchRenderPending = false;
    bindWorkforcePanel();
    window.KusheIcons?.render(panel);
  }
  function workforceSnapshot() {
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
    return {state, rows, batches, attendanceRows, totalWork, totalCommission, unpaidPayrollRows, unpaidPayrollEmployees, todayEmployees, monthProjects};
  }
  function workforceKpis(view) {
    const {totalWork, totalCommission, unpaidPayrollRows, unpaidPayrollEmployees, todayEmployees, monthProjects} = view;
    return `<section class="commission-kpis workforce-kpis" aria-label="出勤與業績統計摘要">
        <article data-kpi="workforce.today" role="button" tabindex="0" aria-label="查看今日作業人數對應明細" aria-expanded="false"><span>今日作業人數</span><strong>${todayEmployees.size} 人</strong><small>依實際作業與出勤員工去重</small></article>
        <article data-kpi="workforce.attendance" role="button" tabindex="0" aria-label="查看本月點工薪資對應明細" aria-expanded="false"><span>本月點工薪資</span><strong>${money(totalWork)}</strong><small>依正式點工薪資來源</small></article>
        <article data-kpi="workforce.commission" role="button" tabindex="0" aria-label="查看本月抽成對應明細" aria-expanded="false"><span>本月抽成</span><strong>${money(totalCommission)}</strong><small>依正式抽成來源</small></article>
        <article class="is-warning" data-kpi="workforce.unpaid" role="button" tabindex="0" aria-label="查看未付款薪資對應明細" aria-expanded="false"><span>未付款薪資</span><strong>${unpaidPayrollEmployees.size} 人</strong><small>尚有 ${unpaidPayrollRows.length} 筆薪資待付款</small></article>
        <article class="is-success" data-kpi="workforce.projects" role="button" tabindex="0" aria-label="查看本月作業案場對應明細" aria-expanded="false"><span>本月作業案場</span><strong>${monthProjects.size} 處</strong><small>依實際作業來源去重</small></article>
      </section>`;
  }
  function render() {
    if(dailyDetailActive){dailyDetailNeedsRefresh=true;return}
    if (!active) return;
    cancelSearchTimer();
    if (searchComposing) { searchRenderPending = true; return; }
    const view = workforceSnapshot();
    const {state, rows, batches, attendanceRows} = view;
    searchRenderPending = false;
    $('#commissionsApp').innerHTML = `
      <section class="commissions-heading workforce-heading">
        <div><h1>出勤／業績管理</h1><p>整合每日作業、點工薪資、員工業績與抽成結算</p></div>
        <div class="workforce-heading-actions"><button class="commission-secondary" id="manualCommission" type="button">新增手動抽成</button><button class="commission-primary" id="addCommission" type="button">＋ 新增每日作業</button></div>
      </section>
      ${workforceKpis(view)}
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
    $('#addCommission')?.addEventListener('click', () => openDailyDrawer());
    $('#manualCommission')?.addEventListener('click', () => openDrawer());
    $('#commissionMonthFilter').addEventListener('change', (event) => { commitSearchForAction(); filters.month = event.target.value; refreshWorkforceResults(); });
    $('#commissionEmployeeFilter').addEventListener('change', (event) => { commitSearchForAction(); filters.employee = event.target.value; refreshWorkforceResults(); });
    $('#commissionProjectFilter').addEventListener('change', (event) => { commitSearchForAction(); filters.project = event.target.value; refreshWorkforceResults(); });
    const search = $('#commissionQueryFilter');
    const currentSearch = (input) => active && input.isConnected && input === $('#commissionQueryFilter');
    search.addEventListener('compositionstart', (event) => {
      if (!currentSearch(event.currentTarget)) return;
      searchComposing = true;
      cancelSearchTimer();
    });
    search.addEventListener('input', (event) => {
      if (!currentSearch(event.currentTarget)) return;
      if (searchComposing || event.isComposing) {
        searchComposing = true;
        searchRenderPending = true;
        cancelSearchTimer();
        return;
      }
      filters.query = event.currentTarget.value;
      scheduleSearchRefresh();
    });
    search.addEventListener('compositionend', (event) => {
      if (!currentSearch(event.currentTarget)) return;
      // A filter action can finish the internal session before this event arrives.
      if (!searchComposing) { event.currentTarget.value = filters.query; return; }
      searchComposing = false;
      filters.query = event.currentTarget.value;
      scheduleSearchRefresh();
    });
    $('#commissionClearFilters').addEventListener('click', () => {
      commitSearchForAction();
      Object.assign(filters, {month:monthNow(),employee:'',project:'',query:''});
      $('#commissionMonthFilter').value = filters.month;
      $('#commissionEmployeeFilter').value = '';
      $('#commissionProjectFilter').value = '';
      search.value = '';
      refreshWorkforceResults();
    });
    $$('[data-workforce-tab]').forEach((button)=>button.addEventListener('click',()=>{commitSearchForAction();activeTab=button.dataset.workforceTab;refreshWorkforceResults()}));
    bindWorkforcePanel();
  }
  function bindWorkforcePanel() {
    const panel = $('.workforce-tab-panel', $('#commissionsApp'));
    $$('[data-sort]', panel).forEach((button) => button.addEventListener('click', () => { commitSearchForAction(); const key = button.dataset.sort; filters.direction = filters.sort === key && filters.direction === 'desc' ? 'asc' : 'desc'; filters.sort = key; refreshWorkforceResults(); }));
    $$('[data-edit]', panel).forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.edit)));
    $$('[data-delete]', panel).forEach((button) => button.addEventListener('click', () => remove(button.dataset.delete)));
    $$('[data-daily-view]', panel).forEach((button)=>button.addEventListener('click',()=>openDailyDetail(button.dataset.dailyView,button)));
    $$('[data-daily-edit]', panel).forEach((button) => button.addEventListener('click', () => openDailyDrawer(button.dataset.dailyEdit)));
    $$('[data-daily-delete]', panel).forEach((button) => button.addEventListener('click', () => removeDaily(button.dataset.dailyDelete)));
    $$('[data-view-daily-source]', panel).forEach((button)=>button.addEventListener('click',()=>showDailySource(button.dataset.viewDailySource,button)));
    $$('[data-view-payroll]', panel).forEach((button)=>button.addEventListener('click',()=>{window.KushePayroll?.prepareNavigationTarget({employeeId:button.dataset.viewPayroll,month:filters.month});window.location.hash='#payroll'}));
    $('#projectCommissionSettlementOpen',panel)?.addEventListener('click',()=>{settlementSelectionKeys=new Set();renderProjectCommissionSettlementDrawer(filters.employee,filters.project)});
    $$('[data-settlement-print]',panel).forEach((button)=>button.addEventListener('click',()=>openCommissionSettlementPrint(button.dataset.settlementPrint,false)));
    $$('[data-settlement-export]',panel).forEach((button)=>button.addEventListener('click',()=>openCommissionSettlementPrint(button.dataset.settlementExport,true)));
  }
  function openCommissionSettlementPrint(id,autoPrint) {
    const state=store.getState(),settlement=(state.commissionSettlements||[]).find((row)=>String(row.id||'')===String(id||''));
    if(!settlement)return window.KushePhase1?.toast('找不到案場抽成結算紀錄');
    const printer=window.KusheCommissionSettlementPrint;if(!printer)return window.KushePhase1?.toast('結算單列印功能尚未載入');
    autoPrint?printer.export(settlement,state):printer.open(settlement,state);
  }
  function showDailySource(sourceId,trigger=document.activeElement) {
    const log=(store.getState().dailyLogs||[]).find((row)=>row.id===sourceId);
    if(!log)return window.KushePhase1?.toast('找不到對應的每日作業來源');
    openDailyDetail(log.batchId||log.id,trigger);
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
    layer.innerHTML=`<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer daily-drawer" role="dialog" aria-modal="true" aria-labelledby="dailyDrawerTitle"><header><div><small>每日施工、薪資與待請款共用資料</small><h2 id="dailyDrawerTitle">${batchId?'編輯':'新增'}每日施工紀錄</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header><form id="dailyWorkForm"><div class="commission-drawer-body daily-drawer-body"><div class="daily-form-grid full"><label><span>日期 *</span><input name="date" type="date" value="${esc(first.date||today())}" required></label><label class="daily-wide" id="dailyGeneralNoteField"><span>一般施工備註</span><input name="note" value="${esc(first.note||'')}" placeholder="現場說明或施工備註"></label></div><section class="daily-form-section full"><div class="daily-section-title"><div><h3>員工</h3><p>可複選；同一員工同一天可前往多個案場。</p></div></div><div class="daily-employee-grid">${employeeChoices}</div><div id="dailyCommissionRatePanel" class="daily-commission-rate-panel"></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>案場與施工項目</h3><p>每列可選不同案場；單價 × 數量依正式版規則計算。</p></div><button type="button" class="commission-secondary" id="addDailyLine">＋ 新增案場／項目</button></div><div class="daily-lines-wrap"><table class="daily-lines-table"><thead><tr><th>客戶／案場</th><th>施工項目</th><th>單位</th><th>數量</th><th>稅別</th><th>單價</th><th>小計</th><th>用途</th><th></th></tr></thead><tbody id="dailyLines">${lines.map(lineHtml).join('')}</tbody></table></div><div class="daily-total-bar"><span>施工含稅／輸入合計 <b id="dailyGrossTotal">$0</b></span><span>未稅施工合計 <b id="dailyUntaxedTotal">$0</b></span><span>預估抽成 <b id="dailyCommissionTotal">$0</b></span><span>待請款施工 <b id="dailyBillingTotal">$0</b></span></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>計薪方式</h3><p>選員工後自動帶入主檔日薪／時薪；本次單價會保存為歷史快照，之後調薪不會回頭重算。</p></div></div><div class="daily-pay-grid"><label class="daily-check"><input name="commissionEnabled" type="checkbox" ${commissionEnabled?'checked':''}><span>業績抽成（依每位員工本次基準）</span></label><label><span>點工方式</span><select name="workMode"><option value="none" ${!workLog.workMode||workLog.workMode==='none'?'selected':''}>不計點工</option><option value="daily" ${workLog.workMode==='daily'?'selected':''}>日薪</option><option value="hourly" ${workLog.workMode==='hourly'?'selected':''}>時薪</option></select></label><label><span>點工天數／時數</span><input name="workQty" type="number" min="0" step="0.5" value="${number(workLog.workQty)}"></label><label><span>日薪／時薪單價</span><input name="workRate" type="number" min="0" step="1" value="${number(workLog.workRate)}"></label><div class="daily-work-preview"><span>每位員工點工薪資</span><b id="dailyWorkTotal">$0</b></div></div></section></div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存每日施工</button></footer></form></aside>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));const form=$('#dailyWorkForm',layer),body=$('#dailyLines',layer);
    const calc=()=>{let gross=0,untaxed=0,billing=0;$$('.daily-line',body).forEach((row)=>{const qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal;gross+=subtotal;untaxed+=lineUntaxed;if($('.daily-billable input',row).checked)billing+=lineUntaxed;$('.daily-line-total',row).textContent=money(subtotal);$('.daily-line-untaxed',row).textContent=`未稅 ${money(lineUntaxed)}`});const ids=$$('input[name="dailyEmployees"]:checked',form).map((input)=>input.value),rates=Object.fromEntries($$('input[name="dailyCommissionRate"]',form).map((input)=>[input.dataset.employeeId,input.value])),commission=form.elements.commissionEnabled.checked?previewCommissionTotal(untaxed,ids,state.employees,rates):0,work=form.elements.workMode.value==='none'?0:number(form.elements.workQty.value)*number(form.elements.workRate.value);$('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work)};
    const bindLines=()=>{$$('.daily-line input,.daily-line select',body).forEach((input)=>{input.oninput=calc;input.onchange=calc});$$('.daily-line-remove',body).forEach((button)=>button.onclick=()=>{if(body.children.length>1)button.closest('tr').remove();else button.closest('tr').querySelectorAll('input').forEach((input)=>input.value='');calc()})};
    $('#addDailyLine',layer).onclick=()=>{body.insertAdjacentHTML('beforeend',lineHtml({project:'',item:'',unit:'式',qty:1,inputPrice:0,taxMode:'未稅',billable:true,workItemId:''}));bindLines();calc()};bindLines();$$('input[name="dailyEmployees"],input[name="dailyCommissionRate"],select[name="workMode"],input[name="workQty"],input[name="workRate"],input[name="commissionEnabled"]',form).forEach((input)=>{input.oninput=calc;input.onchange=calc});form.onsubmit=submitDaily;$$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach((button)=>button.addEventListener('click',closeDrawer));calc();
  }
  function openDailyDrawer(batchId='') {
    if(quickProjectSaveActive){window.KushePhase1?.toast('案場新增中，請稍候');return}
    let state=store.getState();
    const logs=batchId?(state.dailyLogs||[]).filter(log=>(log.batchId||log.id)===batchId):[];
    if(logs.some(log=>log.billingId||(log.billingStatus&&log.billingStatus!=='未請款')))return window.KushePhase1?.toast('已進入請款流程的施工紀錄不可直接修改');
    if(logs.some(log=>store.payrollHistoryLock(log.employee,log.date).locked||store.dailyLogCommissionSettlementLock?.(log).locked))return window.KushePhase1?.toast('此施工紀錄已納入已付款薪資或已發案場抽成，為保留歷史帳務不可修改或刪除。');
    stopDailyDrawerViewport();
    editingDailyBatch=batchId;dailyEditorActive=true;
    const first=logs[0]||{},employeeIds=new Set(logs.map(log=>log.employee)),projectGroups=new Map(),legacyItems=new Map();
    const workOnly=Boolean(logs.length)&&logs.every(log=>log.workOnly===true||(!log.project&&!(log.items||[]).length&&log.workMode&&log.workMode!=='none'));
    logs.forEach(log=>{const key=log.groupId||log.id;if(!projectGroups.has(key))projectGroups.set(key,log);(log.items||[]).forEach(item=>{if(item.workItemId)legacyItems.set(item.workItemId,item)})});
    let lines=[];
    projectGroups.forEach(log=>(log.items||[]).forEach(item=>lines.push({project:log.project,house:item.house||'',item:item.itemName||item.item||'',unit:item.unit||'式',qty:number(item.qty),inputPrice:number(item.unitPrice??item.inputPrice??item.price),taxMode:item.taxMode||'未稅',billable:item.billable!==false,workItemId:item.workItemId||'',sourceType:item.sourceType||(item.quotationId?'quotation':'manual'),quotationId:item.quotationId||item.quoteId||'',quotationLineId:item.quotationLineId||item.quoteLineId||'',quotationNo:item.quotationNo||'',pricingType:item.pricingType||'actual',lumpSumAmount:number(item.lumpSumAmount)})));
    const emptyLine=(project='',house='')=>({project,house,item:'',unit:'式',qty:'',inputPrice:0,taxMode:'未稅',billable:true,workItemId:'',sourceType:'',pricingType:'actual'});
    if(!lines.length&&!workOnly)lines=[emptyLine()];
    const workLog=logs.find(log=>log.workMode&&log.workMode!=='none')||{},initialWorkMode=workLog.workMode||'none',commissionEnabled=!workOnly&&(!logs.length||logs.some(log=>number(log.performance)>0)),layer=$('#commissionDrawerLayer');
    const projectOptions=(selected='')=>`<option value="">請選擇案場</option>${store.masterOptions('projects').map(project=>`<option value="${esc(project.id)}" ${String(project.id)===String(selected)?'selected':''}>${esc(label(store.getState(),'customers',project.customer,project.customerName||'未指定客戶'))}｜${esc(project.name)}</option>`).join('')}`;
    const employeeOptions=store.masterOptions('employees');
    const defaultCommissionRate=employee=>employee.commissionRate===undefined||employee.commissionRate===null||employee.commissionRate===''?25:number(employee.commissionRate);
    const commissionRateDraft=Object.fromEntries(employeeOptions.map(employee=>{const saved=logs.find(log=>String(log.employee)===String(employee.id)&&Number.isFinite(Number(log.rate)))?.rate;return [String(employee.id),saved!==undefined?number(saved):defaultCommissionRate(employee)]}));
    const defaultCommissionBasis=employee=>employee.commissionBasis==='taxIncluded'?'taxIncluded':'preTax';
    const commissionBasisDraft=Object.fromEntries(employeeOptions.map(employee=>{const saved=logs.find(log=>String(log.employee)===String(employee.id)&&log.commissionBasis)?.commissionBasis;return [String(employee.id),saved==='taxIncluded'?'taxIncluded':saved==='preTax'?'preTax':'projectDefault']}));
    const defaultWorkRate=(employee,mode)=>number(mode==='hourly'?employee.hourlyRate:employee.dailyRate);
    let currentWorkRateMode=initialWorkMode;
    const workRateDraft=Object.fromEntries(employeeOptions.map(employee=>{const saved=logs.find(log=>String(log.employee)===String(employee.id)&&log.workMode===initialWorkMode&&Number.isFinite(Number(log.workRate)));return [String(employee.id),saved?number(saved.workRate):defaultWorkRate(employee,initialWorkMode)]}));
    const resetWorkRatesForMode=mode=>{currentWorkRateMode=mode;employeeOptions.forEach(employee=>{const saved=logs.find(log=>String(log.employee)===String(employee.id)&&log.workMode===mode&&Number.isFinite(Number(log.workRate)));workRateDraft[String(employee.id)]=saved?number(saved.workRate):defaultWorkRate(employee,mode)})};
    const employeeChoices=employeeOptions.map(employee=>`<label class="daily-employee-choice"><input type="checkbox" name="dailyEmployees" value="${esc(employee.id)}" ${employeeIds.has(employee.id)?'checked':''}><span class="daily-employee-name"><b>${esc(employee.name)}</b><small>日薪 ${number(employee.dailyRate)?money(employee.dailyRate):'未設定'}｜時薪 ${number(employee.hourlyRate)?money(employee.hourlyRate):'未設定'}</small></span></label>`).join('');
    const customerOptions=(selected='')=>`<option value="">請選擇客戶</option>${store.masterOptions('customers').map(customer=>`<option value="${esc(customer.id)}" ${String(customer.id)===String(selected)?'selected':''}>${esc(customer.name)}</option>`).join('')}`;
    const quoteChoices=projectId=>{const project=store.getState().projects.find(row=>String(row.id)===String(projectId));return project?(store.confirmedQuotationItems(project.id,project.customer)||[]).map(item=>({...item,sourceType:'quotation'})):[]};
    const manualChoices=projectId=>(store.dailyManualItems(projectId)||[]).map(item=>({...item,sourceType:'manual'}));
    const lineChoices=projectId=>[...quoteChoices(projectId),...manualChoices(projectId)];
    const choiceKey=item=>JSON.stringify(item.sourceType==='quotation'?[String(item.quotationId),String(item.quotationLineId)]:['manual',String(item.projectId),item.item]);
    const quoteLabel=item=>item.sourceType==='manual'?`${item.item}｜${money(item.price)}/${item.unit||'式'}｜案場歷史`:item.pricingType==='lump_sum'?`${item.item}｜總價 ${money(item.lumpSumAmount)}｜${item.quotationNo||'已確認報價'}`:`${item.item}｜${money(item.price)}/${item.unit||'式'}｜${item.quotationNo||'已確認報價'}`;
    const choiceOptions=(line)=>{const selected=line.quotationId&&line.quotationLineId?JSON.stringify([String(line.quotationId),String(line.quotationLineId)]):line.sourceType==='manual'?'manual':'',choices=lineChoices(line.project);return `<option value="">請選擇報價品項</option><option value="manual" ${selected==='manual'?'selected':''}>手動施工／無報價來源</option>${selected&&selected!=='manual'&&!choices.some(item=>choiceKey(item)===selected)?`<option value="${esc(selected)}" selected>原報價來源（需重新核對）</option>`:''}${choices.map((item,index)=>`<option value="${esc(choiceKey(item))}" ${choiceKey(item)===selected?'selected':''}>${esc(quoteLabel(item))}${item.house?'｜'+esc(item.house):''}｜項次 ${index+1}</option>`).join('')}`};
    const lineHtml=line=>{const quoted=line.sourceType==='quotation'||Boolean(line.quotationId&&line.quotationLineId);return `<tr class="daily-line" data-work-item-id="${esc(line.workItemId||'')}" data-item-name="${esc(line.item||'')}" data-source-type="${esc(line.sourceType||'')}" data-quotation-id="${esc(line.quotationId||'')}" data-quotation-line-id="${esc(line.quotationLineId||'')}" data-quotation-no="${esc(line.quotationNo||'')}" data-pricing-type="${esc(line.pricingType||'actual')}" data-lump-sum-amount="${number(line.lumpSumAmount)}"><td class="daily-line-context" hidden><select class="daily-line-project">${projectOptions(line.project)}</select></td><td class="daily-line-context" hidden><input class="daily-line-house" value="${esc(line.house||'')}"></td><td class="daily-cell-item" data-mobile-label="施工項目"><select class="daily-line-choice" aria-label="正式報價品項／手動施工">${choiceOptions(line)}</select><input aria-label="施工品項名稱" class="daily-line-item" value="${esc(line.item||'')}" placeholder="手動施工品項" ${quoted?'readonly':''}><small class="daily-quote-hint"></small></td><td class="daily-cell-unit" data-mobile-label="單位"><input aria-label="單位" class="daily-line-unit" value="${esc(line.unit||'式')}" ${quoted?'readonly':''}></td><td class="daily-cell-qty" data-mobile-label="數量"><input aria-label="數量" class="daily-line-qty" type="number" min="0" step="0.01" value="${esc(line.qty??'')}"></td><td class="daily-cell-tax" data-mobile-label="稅別"><select aria-label="稅別" class="daily-line-tax" ${quoted?'disabled':''}><option value="未稅" ${line.taxMode!=='含稅'?'selected':''}>未稅</option><option value="含稅" ${line.taxMode==='含稅'?'selected':''}>含稅</option></select></td><td class="daily-cell-price" data-mobile-label="單價"><input aria-label="單價" class="daily-line-price" type="number" min="0" step="0.01" value="${number(line.inputPrice)}" ${quoted?'readonly':''}></td><td class="num daily-cell-total" data-mobile-label="小計"><b class="daily-line-total">$0</b><small class="daily-line-untaxed">未稅 $0</small></td><td class="daily-cell-purpose" data-mobile-label="用途"><label class="daily-billable"><input type="checkbox" ${line.billable!==false?'checked':''} ${line.pricingType==='lump_sum'?'disabled':''}><span>列入待請款</span></label></td><td class="daily-cell-actions" data-mobile-label="操作"><div class="daily-line-actions"><button type="button" class="daily-line-clone">複製</button><button type="button" class="daily-line-remove">刪除此施工項目</button></div></td></tr>`};
    layer.innerHTML=`<button class="commission-drawer-backdrop" type="button" aria-label="關閉"></button><aside class="commission-drawer daily-drawer" role="dialog" aria-modal="true" aria-labelledby="dailyDrawerTitle"><header><div><small>每日施工、薪資與待請款共用資料</small><h2 id="dailyDrawerTitle">${batchId?'編輯':'新增'}每日施工紀錄</h2></div><button class="commission-drawer-close" type="button" aria-label="關閉">×</button></header><form id="dailyWorkForm" class="daily-house-editor"><div class="commission-drawer-body daily-drawer-body"><div class="daily-form-grid full"><label><span>日期 *</span><input name="date" type="date" value="${esc(first.date||today())}" required></label><label class="daily-wide"><span>備註／工作內容</span><input name="note" value="${esc(first.note||'')}" placeholder="現場說明或施工備註"></label></div><section class="daily-form-section full"><div class="daily-section-title"><div><h3>員工</h3><p>可複選；同一員工同一天可前往多個案場。</p></div></div><div class="daily-employee-grid">${employeeChoices}</div><div id="dailyCommissionRatePanel" class="daily-commission-rate-panel"></div></section><section class="daily-form-section full daily-entry-mode-section"><div class="daily-section-title"><div><h3>作業類型</h3><p>純點工／修繕不需要建立案場，也不會產生業績、抽成或待請款。</p></div></div><div class="daily-entry-mode-grid"><label class="daily-entry-mode-card"><input type="radio" name="entryMode" value="construction" ${!workOnly?'checked':''}><span><b>一般施工</b><small>案場施工、業績、抽成與請款照原流程</small></span></label><label class="daily-entry-mode-card"><input type="radio" name="entryMode" value="workOnly" ${workOnly?'checked':''}><span><b>純點工／修繕</b><small>只記出勤與薪資，不建立假案場</small></span></label></div></section><section class="daily-form-section full daily-work-only-section" id="dailyWorkOnlySection" hidden><div class="daily-section-title"><div><h3>今日修繕內容</h3><p>記錄今天實際修繕、巡修或支援的內容；不需要建立案場。</p></div></div><label class="daily-work-description"><span>修繕／工作內容 *</span><textarea name="workDescription" rows="3" placeholder="例如：玄關門補漆、鋁窗刮傷修補、巡修"></textarea><small>可直接寫實際位置與處理事項，例如「梧棲聖陽－玄關門補漆」。</small></label></section><section class="daily-form-section full" id="dailyConstructionSection"><div class="daily-section-title"><div><h3>案場與施工項目</h3><p>選案場後可搜尋該案場所有已確認報價項目；報價單價會保存為施工快照。</p></div><button type="button" class="commission-secondary" id="addDailyLine">＋ 新增另一案場</button></div><div id="dailyLines" class="daily-house-groups"></div><div class="daily-total-bar"><span>施工含稅／輸入合計 <b id="dailyGrossTotal">$0</b></span><span>未稅施工合計 <b id="dailyUntaxedTotal">$0</b></span><span>預估抽成 <b id="dailyCommissionTotal">$0</b></span><span>待請款施工 <b id="dailyBillingTotal">$0</b></span></div></section><section class="daily-form-section full"><div class="daily-section-title"><div><h3>計薪方式</h3><p>可只計抽成、只計點工，或同時使用；日薪同員工同日只計一次。</p></div></div><div class="daily-pay-grid"><label class="daily-check" id="dailyCommissionToggle"><input name="commissionEnabled" type="checkbox" ${commissionEnabled?'checked':''}><span>業績抽成（依未稅業績）</span></label><label><span>點工方式</span><select name="workMode"><option value="none" ${initialWorkMode==='none'?'selected':''}>不計點工</option><option value="daily" ${initialWorkMode==='daily'?'selected':''}>日薪</option><option value="hourly" ${initialWorkMode==='hourly'?'selected':''}>時薪</option></select></label><label><span>點工天數／時數</span><input name="workQty" type="number" min="0" step="0.5" value="${number(workLog.workQty)}"></label><div id="dailyWorkRatePanel" class="daily-commission-rate-panel daily-work-rate-panel"></div><div class="daily-work-preview"><span>本次點工薪資合計</span><b id="dailyWorkTotal">$0</b></div></div></section></div><footer><button class="commission-secondary" type="button" data-cancel>取消</button><button class="commission-primary" type="submit">儲存每日施工</button></footer></form></aside><div class="daily-house-batch-layer" id="dailyHouseBatchLayer" hidden><button class="daily-house-batch-backdrop" type="button" data-daily-house-batch-cancel aria-label="關閉批次新增戶別"></button><section class="daily-house-batch-card" role="dialog" aria-modal="true" aria-labelledby="dailyHouseBatchTitle"><header><div><small>以目前整戶施工項目為範本</small><h3 id="dailyHouseBatchTitle">批次複製整戶</h3></div><button type="button" data-daily-house-batch-cancel aria-label="關閉">×</button></header><label><span>戶別清單</span><textarea id="dailyHouseBatchInput" rows="7" placeholder="2A&#10;2B&#10;2C&#10;2D"></textarea><small>每行一戶，也支援逗號、頓號或分號分隔；重複戶別會自動略過。</small></label><footer><button class="commission-secondary" type="button" data-daily-house-batch-cancel>取消</button><button class="commission-primary" id="confirmDailyHouseBatch" type="button">建立戶別</button></footer></section></div><div class="daily-house-batch-layer daily-quick-project-layer" id="dailyQuickProjectLayer" hidden><button class="daily-house-batch-backdrop" type="button" data-daily-quick-project-cancel aria-label="取消新增案場"></button><form class="daily-house-batch-card daily-quick-project-card" id="dailyQuickProjectForm" role="dialog" aria-modal="true" aria-labelledby="dailyQuickProjectTitle"><header><div><small>每日施工快速建立正式主檔</small><h3 id="dailyQuickProjectTitle">新增案場</h3></div><button type="button" data-daily-quick-project-cancel aria-label="關閉">×</button></header><div class="daily-quick-project-body"><label><span>所屬客戶 *</span><select name="customer" required>${customerOptions()}</select></label><label><span>案場名稱 *</span><input name="name" autocomplete="off" required></label><label><span>工程地址（選填）</span><input name="address" autocomplete="street-address"></label></div><footer><button class="commission-secondary" type="button" data-daily-quick-project-cancel>取消</button><button class="commission-primary" type="submit">新增並使用</button></footer></form></div>`;
    layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('is-open'));
    const form=$('#dailyWorkForm',layer),body=$('#dailyLines',layer),batchLayer=$('#dailyHouseBatchLayer',layer),batchInput=$('#dailyHouseBatchInput',layer),quickProjectLayer=$('#dailyQuickProjectLayer',layer),quickProjectForm=$('#dailyQuickProjectForm',layer);
    form.noValidate=true;
    let batchTemplate=null,quickProjectTargetGroup=null,draftSequence=0;
    const commissionRatePanel=$('#dailyCommissionRatePanel',form),workRatePanel=$('#dailyWorkRatePanel',form),constructionSection=$('#dailyConstructionSection',form),workOnlySection=$('#dailyWorkOnlySection',form),generalNoteField=$('#dailyGeneralNoteField',form),commissionToggle=$('#dailyCommissionToggle',form);form.elements.workDescription.value=workOnly?(first.note||''):'';
    const renderCommissionRatePanel=()=>{
      const selectedIds=$$('input[name="dailyEmployees"]:checked',form).map(input=>String(input.value)),isWorkOnly=form.elements.entryMode?.value==='workOnly';
      if(!selectedIds.length||isWorkOnly){commissionRatePanel.innerHTML='';commissionRatePanel.hidden=true;return}
      commissionRatePanel.hidden=false;
      commissionRatePanel.innerHTML=`<div class="daily-commission-rate-heading"><div><b>本次抽成設定</b><small>比例與基準只影響本次每日施工；既有歷史不會跟著改。</small></div></div><div class="daily-commission-rate-list">${selectedIds.map(id=>{const employee=employeeOptions.find(item=>String(item.id)===id);if(!employee)return '';const fallback=defaultCommissionRate(employee),value=Object.prototype.hasOwnProperty.call(commissionRateDraft,id)?commissionRateDraft[id]:fallback,basis=commissionBasisDraft[id]||'projectDefault';return `<div class="daily-commission-rate-row"><span class="daily-commission-rate-employee"><b>${esc(employee.name)}</b><small>預設 ${fallback}%｜${defaultCommissionBasis(employee)==='taxIncluded'?'含稅':'未稅'}</small></span><label><span>本次抽成</span><span class="daily-commission-rate-input"><input type="number" inputmode="decimal" name="dailyCommissionRate" data-employee-id="${esc(id)}" min="0" max="100" step="0.01" value="${esc(value)}" aria-label="${esc(employee.name)} 本次抽成比例"><em>%</em></span></label><label class="daily-commission-basis-field"><span>計算基準</span><select name="dailyCommissionBasis" data-employee-id="${esc(id)}" aria-label="${esc(employee.name)} 本次抽成基準"><option value="projectDefault" ${basis==='projectDefault'?'selected':''}>依案場／公司設定</option><option value="preTax" ${basis==='preTax'?'selected':''}>未稅</option><option value="taxIncluded" ${basis==='taxIncluded'?'selected':''}>含稅</option></select></label></div>`}).join('')}</div>`;
      $$('input[name="dailyCommissionRate"]',commissionRatePanel).forEach(input=>{input.oninput=()=>{commissionRateDraft[String(input.dataset.employeeId)]=input.value;calc()};input.onchange=input.oninput});
      $$('select[name="dailyCommissionBasis"]',commissionRatePanel).forEach(select=>{select.onchange=()=>{commissionBasisDraft[String(select.dataset.employeeId)]=select.value;calc()}});
    };
    const renderWorkRatePanel=()=>{
      const selectedIds=$$('input[name="dailyEmployees"]:checked',form).map(input=>String(input.value)),mode=form.elements.workMode.value;
      if(!selectedIds.length||mode==='none'){workRatePanel.innerHTML='';workRatePanel.hidden=true;return}
      workRatePanel.hidden=false;
      workRatePanel.innerHTML=`<div class="daily-commission-rate-heading"><div><b>本次點工單價</b><small>自動帶入員工主檔的${mode==='hourly'?'時薪':'日薪'}；只影響本筆，之後調薪不會重算歷史。</small></div></div><div class="daily-commission-rate-list">${selectedIds.map(id=>{const employee=employeeOptions.find(item=>String(item.id)===id);if(!employee)return '';const fallback=defaultWorkRate(employee,mode),value=Object.prototype.hasOwnProperty.call(workRateDraft,id)?workRateDraft[id]:fallback,missing=!number(value);return `<div class="daily-commission-rate-row ${missing?'is-missing-rate':''}"><span class="daily-commission-rate-employee"><b>${esc(employee.name)}</b><small>主檔${mode==='hourly'?'時薪':'日薪'}：${fallback?money(fallback):'未設定'}</small></span><label><span>本次單價</span><span class="daily-commission-rate-input"><input type="number" inputmode="decimal" name="dailyWorkRate" data-employee-id="${esc(id)}" min="0" step="1" value="${esc(value||'')}" aria-label="${esc(employee.name)} 本次${mode==='hourly'?'時薪':'日薪'}"><em>元</em></span></label></div>`}).join('')}</div>`;
      $$('input[name="dailyWorkRate"]',workRatePanel).forEach(input=>{input.oninput=()=>{workRateDraft[String(input.dataset.employeeId)]=input.value;calc()};input.onchange=input.oninput});
    };
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
    const calc=()=>{
      const isWorkOnly=form.elements.entryMode?.value==='workOnly';
      let gross=0,untaxed=0,taxIncluded=0,billing=0;
      if(!isWorkOnly)$$('.daily-line',body).forEach((row)=>{const isLump=row.dataset.pricingType==='lump_sum',qty=number($('.daily-line-qty',row).value),price=number($('.daily-line-price',row).value),subtotal=isLump?0:qty*price,taxMode=$('.daily-line-tax',row).value,lineUntaxed=taxMode==='含稅'?Math.round(subtotal/(1+(number(state.settings.defaultTax)||5)/100)):subtotal,lineTaxIncluded=taxMode==='含稅'?subtotal:lineUntaxed+Math.round(lineUntaxed*(number(state.settings.defaultTax)||5)/100);gross+=subtotal;untaxed+=lineUntaxed;taxIncluded+=lineTaxIncluded;if(!isLump&&$('.daily-billable input',row).checked)billing+=lineUntaxed;row.dataset.previewSubtotal=String(subtotal);$('.daily-line-total',row).textContent=isLump?'進度紀錄':money(subtotal);$('.daily-line-untaxed',row).textContent=isLump?'總價不重複累計':`未稅 ${money(lineUntaxed)}`});
      const ids=$$('input[name="dailyEmployees"]:checked',form).map(input=>String(input.value)),rates=Object.fromEntries($$('input[name="dailyCommissionRate"]',form).map(input=>[input.dataset.employeeId,input.value])),bases=Object.fromEntries($$('select[name="dailyCommissionBasis"]',form).map(select=>[select.dataset.employeeId,select.value])),commission=!isWorkOnly&&form.elements.commissionEnabled.checked?previewCommissionTotal(untaxed,ids,state.employees,rates,bases,taxIncluded):0,mode=form.elements.workMode.value,qty=number(form.elements.workQty.value),workRates=Object.fromEntries($$('input[name="dailyWorkRate"]',form).map(input=>[String(input.dataset.employeeId),number(input.value)])),work=mode==='none'?0:ids.reduce((sum,id)=>sum+qty*number(workRates[id]??workRateDraft[id]),0);
      $('#dailyGrossTotal',layer).textContent=money(gross);$('#dailyUntaxedTotal',layer).textContent=money(untaxed);$('#dailyCommissionTotal',layer).textContent=money(commission);$('#dailyBillingTotal',layer).textContent=money(billing);$('#dailyWorkTotal',layer).textContent=money(work);$$('.daily-house-group',body).forEach(group=>{$('.daily-house-subtotal',group).textContent=money(isWorkOnly?0:$$('.daily-line',group).reduce((sum,row)=>sum+number(row.dataset.previewSubtotal),0))});
    };
    const applyEntryMode=()=>{
      const isWorkOnly=form.elements.entryMode?.value==='workOnly';
      constructionSection.hidden=isWorkOnly;workOnlySection.hidden=!isWorkOnly;generalNoteField.hidden=isWorkOnly;commissionToggle.hidden=isWorkOnly;form.elements.commissionEnabled.disabled=isWorkOnly;
      if(isWorkOnly){form.elements.commissionEnabled.checked=false;if(form.elements.workMode.value==='none'){form.elements.workMode.value='daily';resetWorkRatesForMode('daily')}if(number(form.elements.workQty.value)<=0)form.elements.workQty.value='1';}
      renderCommissionRatePanel();renderWorkRatePanel();calc();
    };
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
    let quickProjectLockedControls=[];
    const quickTargetCurrent=group=>active&&dailyEditorActive&&layer.isConnected&&layer.dataset.drawerMode==='daily'&&$('#commissionDrawerLayer')===layer&&$('#dailyWorkForm',layer)===form&&$('#dailyLines',form)===body&&group?.isConnected&&body.contains(group)&&group.matches('.daily-project-block');
    const selectProjectForGroup=(group,project)=>{if(!quickTargetCurrent(group))return false;refreshProjectDropdowns();const select=projectInput(group);select.value=String(project.id);return select.onchange?.()!==false};
    const closeQuickProject=()=>{if(quickProjectSaveActive)return false;const button=$('button[type="submit"]',quickProjectForm);quickProjectLayer.hidden=true;quickProjectTargetGroup=null;quickProjectForm.reset();if(quickProjectForm.dataset.committed!=='true'&&quickProjectForm.dataset.submitLocked!=='true'){button.disabled=false;button.textContent='新增並使用'}return true};
    const openQuickProject=(group)=>{
      if(quickProjectSaveActive){window.KushePhase1?.toast('案場新增中，請稍候');return}
      const generation=++quickProjectGeneration;
      // A new modal session may reuse controls; the completed session stays locked until now.
      quickProjectLockedControls.forEach(control=>{control.disabled=false});quickProjectLockedControls=[];
      $('button[type="submit"]',quickProjectForm).textContent='新增並使用';
      quickProjectTargetGroup=group;quickProjectForm.reset();delete quickProjectForm.dataset.completed;delete quickProjectForm.dataset.committed;delete quickProjectForm.dataset.submitLocked;quickProjectForm.elements.customer.value=quickProjectCustomer(group);quickProjectLayer.hidden=false;
      requestAnimationFrame(()=>{if(generation!==quickProjectGeneration||!quickProjectForm.isConnected||quickProjectLayer.hidden||$('#dailyQuickProjectForm',layer)!==quickProjectForm)return;const target=quickProjectForm.elements.customer.value?quickProjectForm.elements.name:quickProjectForm.elements.customer;target.focus()});
    };
    const quickCommittedWarning=result=>{
      try{if(window.KusheRecovery?.showResult){window.KusheRecovery.showResult(result);return}}catch(error){console.error('Quick project notification',error)}
      try{window.KushePhase1?.toast(result.message||'案場已新增，但目前每日施工畫面已變更，請重新開啟後選用。')}catch(error){console.error('Quick project notification',error)}
    };
    $$('[data-daily-quick-project-cancel]',quickProjectLayer).forEach((button)=>button.onclick=()=>{if(!quickProjectSaveActive)closeQuickProject()});
    quickProjectLayer.onkeydown=(event)=>{if(event.key==='Escape'&&!quickProjectSaveActive){event.preventDefault();closeQuickProject()}};
    quickProjectForm.onsubmit=async(event)=>{
      event.preventDefault();
      const submittedForm=event.currentTarget;
      if(quickProjectSaveActive||submittedForm.dataset.completed==='true'||submittedForm.dataset.committed==='true'||submittedForm.dataset.submitLocked==='true')return;
      const submissionGeneration=quickProjectGeneration,submissionTargetGroup=quickProjectTargetGroup,submittedLayer=quickProjectLayer;
      const current=()=>active&&dailyEditorActive&&layer.isConnected&&layer.dataset.drawerMode==='daily'&&$('#commissionDrawerLayer')===layer&&$('#dailyWorkForm',layer)===form&&submittedLayer.isConnected&&!submittedLayer.hidden&&$('#dailyQuickProjectLayer',layer)===submittedLayer&&$('#dailyQuickProjectForm',layer)===submittedForm&&submittedForm.isConnected&&submissionGeneration===quickProjectGeneration&&quickProjectTargetGroup===submissionTargetGroup;
      if(!current()||!quickTargetCurrent(submissionTargetGroup))return;
      const operation={};quickProjectSubmission=operation;quickProjectSaveActive=true;
      const release=()=>{if(quickProjectSubmission===operation){quickProjectSubmission=null;quickProjectSaveActive=false}};
      const button=$('button[type="submit"]',submittedForm);
      let enabledControls=[];
      const restoreAfterSaveFailure=()=>enabledControls.forEach(control=>{control.disabled=false});
      let project;
      try{
        const customer=submittedForm.elements.customer.value,name=submittedForm.elements.name.value.trim(),address=submittedForm.elements.address.value.trim();
        if(!customer||!name){window.KushePhase1?.toast('請選擇所屬客戶並輸入案場名稱');return}
        const existing=store.getState().projects.find((project)=>String(project.customer)===String(customer)&&normalizedProjectName(project.name)===normalizedProjectName(name));
        if(existing){
          if(current()&&quickTargetCurrent(submissionTargetGroup)){
            submittedForm.dataset.completed='true';release();
            closeQuickProject();
            if(selectProjectForGroup(submissionTargetGroup,existing))window.KushePhase1?.toast('此客戶已有同名案場，已直接選用既有案場');
          }
          return;
        }
        enabledControls=$$('input,select,textarea,button',submittedLayer).filter(control=>!control.disabled);
        quickProjectLockedControls=enabledControls;
        enabledControls.forEach(control=>{control.disabled=true});button.textContent='新增中…';
        project=await store.saveProject({name,customer,address,status:'進行中'});
      }catch(error){
        release();
        if(error.transactionStatus==='RECOVERY_REQUIRED'){
          submittedForm.dataset.submitLocked='true';button.disabled=true;button.textContent='狀態待核對，請勿重送';
          quickCommittedWarning(error);
        }else{
          restoreAfterSaveFailure();
          button.textContent='新增並使用';
          window.KushePhase1?.toast(`新增案場失敗：${error.message}`);
        }
        return;
      }finally{
        release();
      }
      // A resolved writer is durable; presentation errors must never become save failures.
      submittedForm.dataset.committed='true';
      try{
        const result=store.getLastStoreTransactionResult?.();
        if(!current()||!quickTargetCurrent(submissionTargetGroup))throw new Error('Quick project target changed');
        closeQuickProject();
        if(!selectProjectForGroup(submissionTargetGroup,project))throw new Error('Quick project apply rejected');
        if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING')quickCommittedWarning(result);
        else window.KushePhase1?.toast('案場已新增並選用，完成施工內容後再儲存每日施工');
      }catch(error){
        quickCommittedWarning({status:'COMMITTED_WITH_NOTIFICATION_WARNING',message:'案場已新增，但目前每日施工畫面已變更，請重新開啟後選用。',notificationWarnings:[String(error.message||error)]});
      }
    };
    const initialGroups=new Map();lines.forEach((line,index)=>{const key=groupKey(line.project,line.house);if(!initialGroups.has(key))initialGroups.set(key,[]);initialGroups.get(key).push({...line,draftOrder:index})});draftSequence=lines.length;
    initialGroups.forEach(groupLines=>createGroup(groupLines[0].project,groupLines[0].house,groupLines));
    $('#addDailyLine',layer).onclick=()=>{const block=createProjectBlock('');createGroup('','',[emptyLine()],block);calc();$('.daily-house-project',block).focus()};
    $$('input[name="dailyEmployees"]',form).forEach(input=>{input.onchange=()=>{renderCommissionRatePanel();renderWorkRatePanel();calc()}});
    $$('input[name="entryMode"]',form).forEach(input=>{input.onchange=applyEntryMode});
    form.elements.workMode.onchange=()=>{const mode=form.elements.workMode.value;if(mode!==currentWorkRateMode)resetWorkRatesForMode(mode);renderWorkRatePanel();calc()};form.elements.workMode.oninput=form.elements.workMode.onchange;
    form.elements.workQty.oninput=calc;form.elements.workQty.onchange=calc;form.elements.commissionEnabled.oninput=calc;form.elements.commissionEnabled.onchange=calc;
    const showRowError=(error,rows)=>{
      const row=Number.isInteger(error?.dailyRowIndex)?rows[error.dailyRowIndex]:null,rateField=error?.dailyField==='workRate'?$$('input[name="dailyWorkRate"]',form).find(input=>String(input.dataset.employeeId)===String(error.employeeId||'')):null;
      const field=error?.dailyField==='employee'?$('input[name="dailyEmployees"]',form):error?.dailyField==='workRate'?rateField:error?.dailyField==='workQty'?form.elements.workQty:error?.dailyField==='note'?(form.elements.entryMode?.value==='workOnly'?form.elements.workDescription:form.elements.note):row?(error.dailyField==='house'?$('.daily-house-name',row.closest('.daily-house-group')):error.dailyField==='project'?projectInput(row):error.dailyField==='qty'?$('.daily-line-qty',row):error.dailyField==='quotation'?$('.daily-line-choice',row):$('.daily-line-item',row)):null;
      if(field){field.setAttribute('aria-invalid','true');field.focus();field.scrollIntoView({block:'nearest',inline:'nearest'})}
      const hint=row?$('.daily-quote-hint',row):null;if(hint)hint.textContent=error.message;
    };
    const validateRows=rows=>{
      const selected=$$('input[name="dailyEmployees"]:checked',form),current=store.getState(),isWorkOnly=form.elements.entryMode?.value==='workOnly';
      if(!selected.length){const error=new Error('請至少選擇一位員工');error.dailyField='employee';throw error}
      const mode=form.elements.workMode.value,qty=Number(form.elements.workQty.value);
      if(isWorkOnly){if(!['daily','hourly'].includes(mode)){const error=new Error('純點工／修繕必須選擇日薪或時薪');error.dailyField='workQty';throw error}if(!Number.isFinite(qty)||qty<=0){const error=new Error('請填寫有效的點工天數／時數');error.dailyField='workQty';throw error}if(!form.elements.workDescription.value.trim()){const error=new Error('請填寫今日修繕內容或實際工作地點');error.dailyField='note';throw error}}
      else if(mode!=='none'&&(!Number.isFinite(qty)||qty<=0)){const error=new Error('請填寫有效的點工天數／時數');error.dailyField='workQty';throw error}
      if(mode!=='none')selected.forEach(input=>{const rate=$$('input[name="dailyWorkRate"]',form).find(node=>String(node.dataset.employeeId)===String(input.value)),employee=employeeOptions.find(item=>String(item.id)===String(input.value));if(!rate||number(rate.value)<=0){const error=new Error(`員工 ${employee?.name||input.value} 尚未設定有效${mode==='hourly'?'時薪':'日薪'}，請先至員工主檔設定`);error.dailyField='workRate';error.employeeId=input.value;throw error}});
      if(isWorkOnly)return;
      const ids=new Set();
      rows.forEach((row,index)=>{const draft=rowDraft(row),project=current.projects.find(item=>String(item.id)===String(draft.project)),fail=(message,field)=>{const error=new Error(`第 ${index+1} 筆施工：${message}`);Object.assign(error,{dailyRowIndex:index,dailyField:field});throw error};if(!project||!project.customer||!current.customers.some(item=>String(item.id)===String(project.customer)))fail('請選擇有有效客戶關聯的案場','project');if(!draft.house&&!(legacyItems.has(draft.workItemId)&&!String(legacyItems.get(draft.workItemId).house||'').trim()))fail('請填寫戶別','house');if(!draft.item)fail('請填寫施工品項','item');if(!/^\d+(?:\.\d+)?$/.test(draft.qty.trim())||!Number.isFinite(Number(draft.qty))||Number(draft.qty)<=0||Number(draft.qty)>Number.MAX_SAFE_INTEGER)fail('數量必須是有限正數，不可空白','qty');if(draft.sourceType==='quotation'||draft.quotationId||draft.quotationLineId){if(!draft.quotationId||!draft.quotationLineId||!quoteChoices(draft.project).some(item=>String(item.quotationId)===draft.quotationId&&String(item.quotationLineId)===draft.quotationLineId))fail('報價項目已失效，請重新選擇正式報價來源','quotation')}else if(draft.sourceType!=='manual')fail('請選擇報價品項或明確使用手動施工','quotation');if(draft.workItemId&&ids.has(draft.workItemId))fail('施工來源識別重複','item');if(draft.workItemId)ids.add(draft.workItemId)});
      if(!rows.length)throw new Error('請至少填寫一筆施工項目');
    };
    form._dailySubmitContext={batchId,strictRows:true,workOnly:()=>form.elements.entryMode?.value==='workOnly',validateRows,showRowError,afterCommit:async()=>{if(batchId||form.elements.entryMode?.value==='workOnly'){dailySubmitInFlight=false;closeDrawer();render();return}const templates=$$('.daily-project-block',body).map(block=>{const group=block._dailyTemplate&&block.contains(block._dailyTemplate)?block._dailyTemplate:$('.daily-house-group',block);return {project:groupProject(block),lines:group?groupRows(group).map(nextHouseLine):[]}});state=store.getState();body.replaceChildren();templates.forEach(template=>{const block=createProjectBlock(template.project);createGroup(template.project,'',template.lines.length?template.lines:[emptyLine(template.project)],block)});calc();form.dataset.committed='false';$('.daily-house-name',body)?.focus()}};
    form.onsubmit=submitDaily;
    $$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',layer).forEach(button=>button.addEventListener('click',closeDrawer));
    // Bind essential controls before optional commission-panel initialization.
    renderCommissionRatePanel();renderWorkRatePanel();applyEntryMode();
    $$('[data-daily-house-batch-cancel]',batchLayer).forEach(button=>button.onclick=closeBatch);
    $('#confirmDailyHouseBatch',batchLayer).onclick=()=>{if(!batchTemplate||!body.contains(batchTemplate))return closeBatch();const houses=parseHouseBatch(batchInput.value);if(!houses.length){window.KushePhase1?.toast('請至少輸入一個戶別');return}const project=groupProject(batchTemplate),drafts=groupRows(batchTemplate).map(row=>rowDraft(row)),block=blockOf(batchTemplate),skipped=[],created=[];houses.forEach(house=>{if(findGroup(project,house)){skipped.push(house);return}createGroup(project,house,drafts.map(draft=>cloneDailyLineDraft(draft,house)),block);created.push(house)});closeBatch();calc();window.KushePhase1?.toast([created.length?'已建立 '+created.join('、'):'',skipped.length?skipped.join('、')+' 已存在，已略過':''].filter(Boolean).join('；'))};
    batchLayer.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();closeBatch()}};calc();
    startDailyDrawerViewport(layer);
  }
  // P20 Daily Save-1: feedback stays inside the drawer, even when the body is scrolled.
  function dailySaveFeedback(form,message,tone='error') {
    if(!form?.isConnected)return;
    const footer=$(':scope > footer',form);if(!footer)return;
    let feedback=$('.daily-save-feedback',footer);
    if(!feedback){feedback=document.createElement('p');feedback.className='daily-save-feedback';footer.prepend(feedback)}
    feedback.dataset.tone=tone;feedback.setAttribute('role',tone==='error'?'alert':'status');
    feedback.setAttribute('aria-live',tone==='error'?'assertive':'polite');
    feedback.textContent=String(message||'');feedback.hidden=!message;
  }
  function dailySaveError(form,context,error,rows,message) {
    dailySaveFeedback(form,message||`未儲存：${error?.message||'表單處理失敗，請保留內容後再試。'}`);
    // Error presentation must not throw a second error or discard the original draft.
    try{context?.showRowError?.(error,rows)}catch(_){}
  }
  async function submitDaily(event) {
    event.preventDefault();const form=event.currentTarget,context=form._dailySubmitContext;
    if(dailySubmitInFlight||form.dataset.committed==='true'||form.dataset.submitLocked==='true')return;
    const rows=$$('.daily-line',form).sort((a,b)=>number(a.dataset.draftOrder)-number(b.dataset.draftOrder)),button=$('button[type="submit"]',form);
    $$('[aria-invalid]',form).forEach(input=>input.removeAttribute('aria-invalid'));
    let values;
    try{
      const workOnly=Boolean(context?.workOnly?.());
      context?.validateRows(rows);
      const lines=workOnly?[]:rows.map(row=>({project:$('.daily-line-project',row).value,house:$('.daily-line-house',row).value.trim(),item:row.dataset.itemName||$('.daily-line-item',row).value.trim(),itemName:row.dataset.itemName||$('.daily-line-item',row).value.trim(),unit:$('.daily-line-unit',row).value.trim()||'式',qty:context?.strictRows?$('.daily-line-qty',row).value:number($('.daily-line-qty',row).value),inputPrice:number($('.daily-line-price',row).value),unitPrice:number($('.daily-line-price',row).value),taxMode:$('.daily-line-tax',row).value,billable:row.dataset.pricingType!=='lump_sum'&&$('.daily-billable input',row).checked,sourceType:row.dataset.sourceType||'manual',pricingType:row.dataset.pricingType||'actual',quotationId:row.dataset.quotationId||'',quotationLineId:row.dataset.quotationLineId||'',quotationNo:row.dataset.quotationNo||'',quoteId:row.dataset.quotationId||'',quoteLineId:row.dataset.quotationLineId||'',lumpSumAmount:number(row.dataset.lumpSumAmount),workItemId:row.dataset.workItemId||''}));
      values={date:form.elements.date.value,employeeIds:$$('input[name="dailyEmployees"]:checked',form).map(input=>input.value),commissionRates:Object.fromEntries($$('input[name="dailyCommissionRate"]',form).map(input=>[input.dataset.employeeId,input.value])),commissionBases:Object.fromEntries($$('select[name="dailyCommissionBasis"]',form).map(select=>[select.dataset.employeeId,select.value])),workRates:Object.fromEntries($$('input[name="dailyWorkRate"]',form).map(input=>[input.dataset.employeeId,input.value])),lines,workOnly,commissionEnabled:workOnly?false:form.elements.commissionEnabled.checked,workMode:form.elements.workMode.value,workQty:number(form.elements.workQty.value),note:(workOnly?form.elements.workDescription.value:form.elements.note.value).trim()};
    }catch(error){dailySaveError(form,context,error,rows);return}
    dailySubmitInFlight=true;button.disabled=true;button.textContent='儲存中…';
    dailySaveFeedback(form,'儲存中，請勿重複送出或關閉視窗。','pending');
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
      dailySaveError(form,context,error,rows,error.transactionStatus==='RECOVERY_REQUIRED'?'儲存狀態待核對，請保留此畫面，勿重送。':undefined);
      return;
    }
    // From this point forward the batch is durable. A refresh failure is never a save failure.
    form.dataset.committed='true';form.dataset.lastSavedBatch=batchId;
    let result;
    try{
      result=store.getLastStoreTransactionResult?.();
      enabledControls.forEach(input=>{input.disabled=false});
      if(context)await context.afterCommit();else{dailySubmitInFlight=false;closeDrawer();render()}
      if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING'){
        dailySaveFeedback(form,'資料已儲存，但畫面更新異常；請核對紀錄，勿重送。','warning');
        window.KusheRecovery?.showResult(result);
      }else{
        dailySaveFeedback(form,'本筆已儲存；已保留案場與品項，請填下一戶及數量。','success');
        window.KushePhase1?.toast('每日施工、抽成、點工與待請款已同步儲存');
      }
    }catch(error){
      const warning={status:'COMMITTED_WITH_NOTIFICATION_WARNING',operationId:result?.operationId||'',notificationWarnings:[String(error?.message||error)]};
      form.dataset.committed='true';form.dataset.notificationStatus=warning.status;
      dailySaveFeedback(form,'資料已儲存，但畫面更新異常；請核對紀錄，勿重送。','warning');
      button.textContent='已儲存，請關閉後重新開啟';
      try{window.KusheRecovery?.showResult(warning)}catch(_){}
    }finally{
      dailySubmitInFlight=false;
      if(form.dataset.committed!=='true'){button.disabled=false;button.textContent='儲存每日施工'}else button.disabled=true;
    }
  }
  async function removeDaily(batchId){const batch=dailyBatches(store.getState()).find((row)=>row.batchId===batchId);if(!batch||!window.confirm(`確定刪除 ${batch.date} 的每日施工紀錄？抽成與點工薪資會同步重算。`))return;try{await store.deleteDailyBatch(batchId);render();window.KushePhase1?.toast('每日施工已刪除，薪資與待請款已同步重算')}catch(error){window.KushePhase1?.toast(error.message)}}
  // Daily presentation lifecycle; independent of the Manual drawer controller.
  function stopDailyDrawerViewport() {
    if(dailyViewportCleanup){dailyViewportCleanup();dailyViewportCleanup=null;}
  }
  function startDailyDrawerViewport(layer) {
    layer.dataset.drawerMode='daily';
    layer.style.removeProperty('--daily-drawer-vv-top');
    const viewport=window.visualViewport,form=$('#dailyWorkForm',layer);
    let frame=null,recoveryFrame=null,settleTimer=null,focusedTarget=null,disposed=false;
    const ownsDrawer=()=>!disposed&&dailyEditorActive&&layer.isConnected&&$('#dailyWorkForm',layer)===form&&layer.dataset.drawerMode==='daily';
    const current=()=>ownsDrawer()&&window.matchMedia('(max-width: 820px)').matches;
    const clear=()=>{layer.style.removeProperty('--daily-drawer-vv-height');layer.style.removeProperty('--daily-drawer-vv-y');layer.style.removeProperty('--daily-drawer-vv-top');};
    const sync=()=>{
      frame=null;
      if(!ownsDrawer())return;
      if(!current()||!viewport){clear();return;}
      if(Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.offsetTop)){
        layer.style.setProperty('--daily-drawer-vv-height',viewport.height+'px');
        layer.style.setProperty('--daily-drawer-vv-y',Math.max(0,viewport.offsetTop)+'px');
      }
      else clear();
    };
    const scrollRegion=target=>{
      if(!target||target.closest('.daily-quick-project-layer'))return null;
      const batch=$('#dailyHouseBatchLayer',layer),quick=$('#dailyQuickProjectLayer',layer);
      if(quick&&!quick.hidden)return null;
      if(batch?.contains(target))return !batch.hidden&&target.matches('textarea')?target.closest('.daily-house-batch-card>label'):null;
      if(batch&&!batch.hidden)return null;
      return form.contains(target)&&target.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]),select,textarea')?$('.daily-drawer-body',form):null;
    };
    const recover=()=>{
      if(!current()||!focusedTarget?.isConnected||document.activeElement!==focusedTarget)return;
      const container=scrollRegion(focusedTarget);
      if(!container||!container.isConnected||!focusedTarget.getClientRects().length)return;
      const targetRect=focusedTarget.getBoundingClientRect(),regionRect=container.getBoundingClientRect();
      const margin=Math.min(16,Math.max(0,(container.clientHeight-targetRect.height)/2));
      const top=regionRect.top+container.clientTop+margin,bottom=regionRect.top+container.clientTop+container.clientHeight-margin;
      // Oversized controls reveal their start without alternating between both edges.
      const targetBottom=targetRect.top+Math.min(targetRect.height,bottom-top);
      const delta=targetRect.top<top?targetRect.top-top:targetBottom>bottom?targetBottom-bottom:0;
      if(Math.abs(delta)<1)return;
      const max=Math.max(0,container.scrollHeight-container.clientHeight);
      container.scrollTop=Math.max(0,Math.min(max,container.scrollTop+delta));
    };
    const cancelRecovery=()=>{
      if(recoveryFrame!==null)window.cancelAnimationFrame(recoveryFrame);
      if(settleTimer!==null)window.clearTimeout(settleTimer);
      recoveryFrame=null;settleTimer=null;
    };
    const scheduleRecovery=()=>{
      cancelRecovery();
      if(!current()||!focusedTarget)return;
      recoveryFrame=window.requestAnimationFrame(()=>{
        recoveryFrame=null;
        if(!current())return;
        recoveryFrame=window.requestAnimationFrame(()=>{recoveryFrame=null;recover();});
      });
      settleTimer=window.setTimeout(()=>{settleTimer=null;recover();},300);
    };
    const scheduleGeometry=()=>{if(!disposed&&frame===null)frame=window.requestAnimationFrame(sync);};
    const schedule=()=>{
      if(disposed)return;
      scheduleGeometry();
      scheduleRecovery();
    };
    const onFocus=event=>{
      focusedTarget=scrollRegion(event.target)?event.target:null;
      scheduleRecovery();
    };
    viewport?.addEventListener('resize',schedule);
    viewport?.addEventListener('scroll',scheduleGeometry);
    window.addEventListener('resize',schedule);
    layer.addEventListener('focusin',onFocus);
    dailyViewportCleanup=()=>{
      disposed=true;
      viewport?.removeEventListener('resize',schedule);
      viewport?.removeEventListener('scroll',scheduleGeometry);
      window.removeEventListener('resize',schedule);
      layer.removeEventListener('focusin',onFocus);
      if(frame!==null)window.cancelAnimationFrame(frame);
      frame=null;cancelRecovery();focusedTarget=null;clear();
      if(layer.dataset.drawerMode==='daily')delete layer.dataset.drawerMode;
    };
    sync();
  }
  function stopManualDrawerViewport() {
    manualDrawerActive=false;
    if(manualViewportCleanup){manualViewportCleanup();manualViewportCleanup=null;}
    const layer=$('#commissionDrawerLayer');
    if(layer?.dataset.drawerMode==='manual')delete layer.dataset.drawerMode;
  }
  function startManualDrawerViewport(layer) {
    manualDrawerActive=true;
    layer.dataset.drawerMode='manual';
    const viewport=window.visualViewport,form=$('#commissionForm',layer);
    let frame=null,disposed=false;
    const clear=()=>{layer.style.removeProperty('--manual-drawer-vv-height');layer.style.removeProperty('--manual-drawer-vv-top');};
    const sync=()=>{
      frame=null;
      if(disposed||!manualDrawerActive||!layer.isConnected||$('#commissionForm',layer)!==form||layer.dataset.drawerMode!=='manual')return;
      if(!window.matchMedia('(max-width: 820px)').matches||!viewport){clear();return;}
      if(Number.isFinite(viewport.height)&&viewport.height>0&&Number.isFinite(viewport.offsetTop)){
        layer.style.setProperty('--manual-drawer-vv-height',viewport.height+'px');
        layer.style.setProperty('--manual-drawer-vv-top',Math.max(0,viewport.offsetTop)+'px');
      }else clear();
    };
    const schedule=()=>{if(!disposed&&frame===null)frame=window.requestAnimationFrame(sync);};
    viewport?.addEventListener('resize',schedule);
    viewport?.addEventListener('scroll',schedule);
    window.addEventListener('resize',schedule);
    manualViewportCleanup=()=>{
      disposed=true;
      viewport?.removeEventListener('resize',schedule);
      viewport?.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      if(frame!==null)window.cancelAnimationFrame(frame);
      frame=null;clear();
    };
    schedule();
  }
  function openDrawer(id = null) {
    if(manualSubmitInFlight)return window.KushePhase1?.toast('業績儲存中，請稍候');
    const state = store.getState();
    const row = id ? state.commissions.find((item) => item.id === id) : null;
    if(row&&store.payrollHistoryLock(row.employee,row.date).locked)return window.KushePhase1?.toast('此抽成紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。');
    if(row?.sourceType==='daily-log')return window.KushePhase1?.toast('每日施工衍生抽成必須由每日施工來源調整。');
    stopManualDrawerViewport();
    manualDrawerGeneration += 1;
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
        <label class="full"><span>薪資列入狀態</span><select name="status"><option value="未列入薪資" ${row?.status !== '已列入薪資' ? 'selected' : ''}>未列入薪資</option><option value="已列入薪資" ${row?.status === '已列入薪資' ? 'selected' : ''}>已列入薪資</option></select></label>
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
    startManualDrawerViewport(layer);
  }
  function closeDrawer() {
    if(quickProjectSaveActive&&$('#dailyQuickProjectLayer')&&!$('#dailyQuickProjectLayer').hidden)return;
    if(dailySubmitInFlight)return;
    const wasManual=$('#commissionDrawerLayer')?.dataset.drawerMode==='manual';
    if(manualSubmitInFlight&&wasManual)return;
    stopDailyDrawerViewport();
    if(manualDrawerActive||$('#commissionDrawerLayer')?.dataset.drawerMode==='manual')stopManualDrawerViewport();
    const wasDaily=dailyEditorActive;dailyEditorActive=false;
    const layer=$('#commissionDrawerLayer'),closingContent=layer.firstElementChild;layer.classList.remove('is-open');
    window.setTimeout(()=>{if(dailyEditorActive||dailyDetailActive||layer.firstElementChild!==closingContent)return;layer.hidden=true;layer.innerHTML='';if(wasDaily&&active&&layer.isConnected)render();else if(wasManual&&layer.isConnected)refreshManualPresentation()},180);
  }
  function refreshManualPresentation() {
    if(!manualRefreshPending||!active||manualDrawerActive||dailyEditorActive||dailyDetailActive||manualSubmitInFlight)return;
    render();
    manualRefreshPending=false;
  }
  function showManualCommittedWarning(result) {
    try {
      if(window.KusheRecovery?.showResult){window.KusheRecovery.showResult(result);return;}
    } catch (_) { /* A notification failure must never reopen a committed submission. */ }
    try{window.KushePhase1?.toast('業績已儲存，但畫面通知異常，請關閉後重新開啟；請勿重送。');}catch(_){}
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if(manualSubmitInFlight||form.dataset.committed==='true'||form.dataset.submitLocked==='true')return;
    const submittedForm=form,submissionGeneration=manualDrawerGeneration,submissionEditingId=editingId;
    const submittedLayer=$('#commissionDrawerLayer'),submittedContent=submittedLayer?.firstElementChild;
    const isCurrent=()=>active&&manualDrawerActive&&submittedForm.isConnected&&
      $('#commissionDrawerLayer')===submittedLayer&&submittedLayer?.dataset.drawerMode==='manual'&&
      submittedLayer.firstElementChild===submittedContent&&$('#commissionForm',submittedLayer)===submittedForm&&
      submissionGeneration===manualDrawerGeneration;
    if(!isCurrent())return;
    manualSubmitInFlight=true;
    let button,enabledControls=[],enabledCloseControls=[],result;
    try {
      // Capture the unchanged business payload before disabling any controls.
      try {
        const values = Object.fromEntries(new FormData(form));
        button = $('button[type="submit"]', form);
        enabledControls=$$('input,select,textarea,button',submittedForm).filter(control=>!control.disabled);
        enabledCloseControls=$$('.commission-drawer-backdrop,.commission-drawer-close,[data-cancel]',submittedLayer).filter(control=>!control.disabled);
        enabledControls.forEach(control=>{control.disabled=true});
        enabledCloseControls.forEach(control=>{control.disabled=true});
        button.textContent='儲存中…';
        await store.saveCommission(values, submissionEditingId);
      } catch(error) {
        if(error.transactionStatus==='RECOVERY_REQUIRED'){
          submittedForm.dataset.submitLocked='true';
          if(button){button.disabled=true;button.textContent='狀態待核對，請勿重送';}
          enabledCloseControls.forEach(control=>{control.disabled=false});
          try{
            if(window.KusheRecovery?.showResult)window.KusheRecovery.showResult(error);
            else window.KushePhase1?.toast('狀態待核對，請勿重送');
          }catch(_){}
        }else{
          enabledControls.forEach(control=>{control.disabled=false});
          enabledCloseControls.forEach(control=>{control.disabled=false});
          if(button)button.textContent='儲存業績';
          try{window.KushePhase1?.toast(`儲存失敗：${error.message}`);}catch(_){}
        }
        return;
      }
      // The Store has resolved: errors below are presentation errors, never save failures.
      submittedForm.dataset.committed='true';
      try {
        result=store.getLastStoreTransactionResult?.();
        manualSubmitInFlight=false;
        if(isCurrent()){
          closeDrawer();
          render();
          manualRefreshPending=false;
        }else{
          manualRefreshPending=true;
        }
        if(result?.status==='COMMITTED_WITH_NOTIFICATION_WARNING')showManualCommittedWarning(result);
        else window.KushePhase1?.toast('業績已自動儲存，薪資連動已同步');
      }catch(error){
        manualRefreshPending=true;
        showManualCommittedWarning({status:'COMMITTED_WITH_NOTIFICATION_WARNING',operationId:result?.operationId||'',notificationWarnings:[String(error?.message||error)]});
      }
    } finally {
      manualSubmitInFlight=false;
    }
  }
  async function remove(id) {
    const state = store.getState(); const row = state.commissions.find((item) => item.id === id);
    if (!row || !window.confirm(`確定刪除 ${label(state,'employees',row.employee,'此員工')} 的這筆業績？`)) return;
    try{await store.deleteCommission(id);render();window.KushePhase1?.toast('業績已刪除，薪資連動已重算')}catch(error){window.KushePhase1?.toast(error.message)}
  }
  async function activate(options = {}) {
    cancelSearchTimer();
    searchLifecycleGeneration += 1;
    searchComposing = false;
    searchRenderPending = false;
    active = true;
    if (!ready) { await store.load(); filters.month = monthNow(); ready = true; }
    if (options.route === 'attendance') activeTab = 'attendance';
    render();
    if(!manualDrawerActive&&!dailyDetailActive&&!dailyEditorActive)manualRefreshPending=false;
  }
  function deactivate() {
    cancelSearchTimer();
    searchLifecycleGeneration += 1;
    searchComposing = false;
    searchRenderPending = false;
    active = false; stopDailyDrawerViewport(); stopManualDrawerViewport(); closeDailyDetail(); closeProjectCommissionSettlementDrawer(); dailyDetailNeedsRefresh=false; dailyDetailContext=null; dailyEditorActive = false;
  }
  window.addEventListener('kushe:data-updated', () => { if (active && !quickProjectSaveActive && !dailySubmitInFlight && !dailyEditorActive && !manualDrawerActive && !settlementDrawerActive) refreshWorkforceResults(); });
  window.KusheCommissions = { activate, deactivate, render };

  // P21: read-only KPI destinations; original calculations and save paths are unchanged.

  window.KusheKpi.register('workforce',{anchor:'.workforce-kpis',active:()=>active,read(action){
    const v=workforceSnapshot(),name=id=>v.state.employees.find(e=>String(e.id)===String(id))?.name||id,project=id=>v.state.projects.find(p=>String(p.id)===String(id))?.name||id;
    if(action==='today')return {title:'今日作業員工',scope:today()+'；與字卡相同，依員工／案場篩選並去重。',columns:['日期','員工'],rows:[...v.todayEmployees].map(id=>({id,cells:[today(),name(id)]}))};
    if(action==='projects')return {title:'本月作業案場',scope:'沿用目前月份與員工／案場篩選；每日作業與點工來源去重。',columns:['案場'],rows:[...v.monthProjects].map(id=>({id,cells:[project(id)]}))};
    if(action==='unpaid')return {title:'未付款薪資來源',scope:'沿用字卡的月份／員工範圍；一位員工可能有多筆薪資来源，不執行付款。',columns:['月份','員工','金額','狀態'],rows:v.unpaidPayrollRows.map(r=>({id:r.id,cells:[r.month,name(employeeIdOf(r)),money(r.total),r.status]}))};
    if(action==='attendance')return {title:'本月點工薪資明細',scope:'沿用目前篩選與正式點工來源，不重複加總每日施工衍生紀錄。',columns:['日期','員工','案場','金額'],rows:v.attendanceRows.map(r=>({id:r.id,cells:[r.date,name(employeeIdOf(r)),project(projectIdOf(r)),money(r.amount)]}))};
    if(action==='commission')return {title:'本月抽成明細',scope:'沿用目前篩選與正式抽成來源；不變更抽成比例或付款狀態。',columns:['日期','員工','案場','業績','抽成'],rows:v.rows.map(r=>({id:r.id,cells:[r.date,name(employeeIdOf(r)),project(projectIdOf(r)),money(r.performance),money(r.commission)]}))};return null;
  }});

}());
