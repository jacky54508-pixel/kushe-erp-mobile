(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  const money = (value) => `$${nf.format(Math.round(Number(value) || 0))}`;
  const number = (value) => { const n = Number(String(value ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
  const text = (value) => String(value ?? '').trim();
  const sum = (rows, getter) => rows.reduce((total, row) => total + number(getter(row)), 0);
  const monthOf = (row, keys = ['date']) => { for (const key of keys) if (row?.[key]) return String(row[key]).slice(0, 7); return ''; };
  const inMonth = (row, month, keys) => monthOf(row, keys) === month;
  const previousMonth = (month) => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const validDate = (value) => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const paidAR = (row) => number(row.received ?? row.receivedAmount ?? row.paidAmount);
  const paidAP = (row) => number(row.paid ?? row.paidAmount);
  const arAmount = (row) => number(row.amount ?? row.totalAmount ?? row.receivableAmount);
  const apAmount = (row) => number(row.amount ?? row.totalAmount ?? row.payableAmount);
  const billingAmount = (row) => number(row.amount ?? row.untaxedAmount ?? row.total);
  const invoiceState = (row) => ['no_invoice','invoice_pending','invoiced'].includes(row?.invoiceStatus) ? row.invoiceStatus : text(row?.invoiceNo) ? 'invoiced' : row?.sourceType === 'daily-work' && row?.hasInvoice === false ? 'no_invoice' : 'invoice_pending';
  const projectId = (row) => text(row.project ?? row.projectId);
  const isPayrollPaid = (row) => /已付款|已付|paid/i.test(text(row.status)) || Boolean(row.payDate && row.paymentTransactionId);
  const payrollPaidAmount = (data,row) => { const history=(data.salaryPayments||[]).filter((payment)=>text(payment.payrollId)===text(row.id)); return history.length?Math.min(number(row.total),sum(history,(payment)=>payment.amount)):isPayrollPaid(row)?number(row.total):0; };
  const collectionTx = (row) => /receipt|receivable/i.test(text(row.sourceType)) || /應收|收款/i.test(`${row.category || ''}${row.note || ''}`);
  const incomeTx = (row) => /收入|入帳|income/i.test(text(row.type));
  const expenseTx = (row) => /支出|付款|expense/i.test(text(row.type));
  const entityName = (map, id, fallback) => text(map.get(id)?.name || fallback) || '—';

  function selectedMonth() { return $('#dashboardMonth')?.value || new Date().toISOString().slice(0, 7); }
  function relationMaps(data) {
    return {
      projects: new Map(data.projects.map((row) => [text(row.id), row])),
      customers: new Map(data.customers.map((row) => [text(row.id), row])),
      vendors: new Map(data.vendors.map((row) => [text(row.id), row])),
      employees: new Map(data.employees.map((row) => [text(row.id), row]))
    };
  }
  function monthRevenue(data, month) { return sum(data.billings.filter((row) => inMonth(row, month)), billingAmount); }
  function monthCollections(data, month) {
    const receipts = data.receipts.filter((row) => inMonth(row, month));
    if (receipts.length) return sum(receipts, (row) => row.amount);
    const transactions = data.bankTransactions.filter((row) => inMonth(row, month) && incomeTx(row) && collectionTx(row));
    if (transactions.length) return sum(transactions, (row) => row.amount);
    return sum(data.receivables.filter((row) => inMonth(row, month, ['receiptDate'])), paidAR);
  }
  function monthCash(data, month) {
    const rows = data.bankTransactions.filter((row) => inMonth(row, month));
    if (rows.length) return sum(rows.filter(incomeTx), (row) => row.amount) - sum(rows.filter(expenseTx), (row) => row.amount);
    const paidPayables = sum(data.payables.filter((row) => inMonth(row, month, ['payDate', 'date']) && paidAP(row) > 0), paidAP);
    const paidPayroll = sum(data.payroll.filter((row) => row.month === month && isPayrollPaid(row)), (row) => row.total);
    return monthCollections(data, month) - paidPayables - paidPayroll;
  }
  function bankTotal(data) { return sum(data.banks, (row) => number(row.balance) || (number(row.openingBalance) + number(row.income) - number(row.expense))); }
  function delta(current, previous) {
    if (!previous) return { text: '—', className: 'neutral' };
    const rate = (current - previous) / Math.abs(previous) * 100;
    return { text: `${rate >= 0 ? '↑' : '↓'} ${Math.abs(rate).toFixed(1)}%`, className: rate >= 0 ? 'positive' : 'negative' };
  }
  function unbilledWorkSummary(data) {
    const groups=new Map();
    (data.dailyLogs||[]).forEach((log)=>{const key=log.groupId||log.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(log)});
    const projects=new Set();let amount=0;
    groups.forEach((logs)=>{const first=logs[0]||{},seen=new Set();(first.items||[]).forEach((item,index)=>{const key=item.workItemId||`${first.groupId||first.id}:${index}`;if(seen.has(key))return;seen.add(key);const billable=item.billable!==false&&first.billable!==false&&!first.noInvoice,status=item.billingStatus||first.billingStatus||(first.billingId?'已請款':'未請款');if(!billable||status!=='未請款'||item.billingId||first.billingId)return;projects.add(first.project||first.projectName||key);amount+=number(item.untaxedSubtotal)||number(item.qty)*number(item.price)})});
    return {count:projects.size,amount};
  }

  function derive(data, month) {
    const maps = relationMaps(data);
    const prev = previousMonth(month);
    const revenue = monthRevenue(data, month);
    const collected = monthCollections(data, month);
    const openAR = data.receivables.filter((row) => arAmount(row) > paidAR(row));
    const openAP = data.payables.filter((row) => apAmount(row) > paidAP(row));
    const outstandingAR = sum(openAR, (row) => Math.max(0, arAmount(row) - paidAR(row)));
    const outstandingAP = sum(openAP, (row) => Math.max(0, apAmount(row) - paidAP(row)));
    const prevOpenAR = sum(data.receivables.filter((row) => inMonth(row, prev)), (row) => Math.max(0, arAmount(row) - paidAR(row)));
    const prevOpenAP = sum(data.payables.filter((row) => inMonth(row, prev)), (row) => Math.max(0, apAmount(row) - paidAP(row)));
    const monthAR = data.receivables.filter((row) => inMonth(row, month));
    const structureTotal = sum(monthAR, arAmount) || revenue;
    const structurePaid = structureTotal ? Math.min(structureTotal, sum(monthAR, paidAR) || collected) : 0;
    const structureOpen = Math.max(0, structureTotal - structurePaid);
    const allAR = sum(data.receivables, arAmount);
    const allReceived = sum(data.receivables, paidAR);

    const projects = data.projects.map((project) => {
      const id = text(project.id);
      const bills = data.billings.filter((row) => projectId(row) === id);
      const ars = data.receivables.filter((row) => projectId(row) === id);
      const materials = data.materialUsages.filter((row) => projectId(row) === id);
      const attendance = data.attendance.filter((row) => projectId(row) === id);
      const commissions = data.commissions.filter((row) => projectId(row) === id);
      const otherCosts = (data.projectCosts || []).filter((row) => projectId(row) === id);
      const billed = sum(bills, billingAmount);
      const received = sum(ars, paidAR);
      const outstanding = sum(ars, (row) => Math.max(0, arAmount(row) - paidAR(row)));
      const material = sum(materials, (row) => row.amount);
      const labor = sum(attendance, (row) => row.amount) + sum(commissions, (row) => row.commission);
      const other = sum(otherCosts, (row) => row.amount);
      const profit = billed - material - labor - other;
      const margin = billed ? profit / billed * 100 : 0;
      return { id, name: text(project.name) || '—', customer: entityName(maps.customers, text(project.customer), project.customerName), billed, received, outstanding, material, labor, other, profit, margin, status: text(project.status) || '進行中', activity: billed + received + outstanding + material + labor + other };
    }).filter((row) => row.activity > 0).sort((a, b) => b.billed - a.billed || b.activity - a.activity).slice(0, 6);

    const now = new Date();
    const overdue = openAR.filter((row) => { const due = validDate(row.dueDate); return due && due < now; });
    const overduePayables = openAP.filter((row) => { const due = validDate(row.dueDate); return due && due < now; });
    const missingInvoices = data.billings.filter((row) => invoiceState(row) === 'invoice_pending');
    const missingInvoiceAmount = sum(missingInvoices, (billing) => {
      const ar = data.receivables.find((row) => text(row.billingId) === text(billing.id) || text(row.sourceNo) === text(billing.number));
      return ar ? Math.max(0, arAmount(ar) - paidAR(ar)) : number(billing.total ?? billing.grossTotal);
    });
    const payrollRows = data.payroll.filter((row) => text(row.month) === month);
    const payrollTotal = sum(payrollRows, (row) => row.total);
    const payrollPaid = sum(payrollRows, (row) => payrollPaidAmount(data,row));
    const unbilledWork=unbilledWorkSummary(data);
    const retentionBillings=data.billings.filter((row)=>number(row.retention)>number(row.retentionReceived));
    const retentionOpen=sum(retentionBillings,(row)=>Math.max(0,number(row.retention)-number(row.retentionReceived)));
    const attentions = [
      { type: '待請款施工', count: unbilledWork.count, countLabel: `${unbilledWork.count} 個案場`, amount: unbilledWork.amount, module: 'unbilled-work', tone: 'blue', icon: 'clipboard-list' },
      { type: '逾期應收', count: overdue.length, amount: sum(overdue, (row) => Math.max(0, arAmount(row) - paidAR(row))), module: 'receivables', tone: 'red', icon: 'circle-alert' },
      { type: '待收款', count: openAR.length, amount: outstandingAR, module: 'receivables', tone: 'orange', icon: 'arrow-down-to-line' },
      { type: '保留款待收', count: retentionBillings.length, amount: retentionOpen, module: 'receivables', tone: 'blue', icon: 'shield-check' },
      { type: '待付款', count: openAP.length, amount: outstandingAP, module: 'payables', tone: 'orange', icon: 'arrow-up-from-line' },
      { type: '逾期應付', count: overduePayables.length, amount: sum(overduePayables, (row) => Math.max(0, apAmount(row) - paidAP(row))), module: 'payables', tone: 'red', icon: 'circle-alert' },
      { type: '待開發票', count: missingInvoices.length, amount: missingInvoiceAmount, module: 'invoices', tone: 'blue', icon: 'receipt' },
      { type: '薪資待結算', count: payrollRows.filter((row) => payrollPaidAmount(data,row)<number(row.total)).length, amount: Math.max(0, payrollTotal - payrollPaid), module: 'payroll', tone: 'violet', icon: 'wallet' }
    ].filter((row) => row.count || row.amount);

    return {
      data, month, maps, bank: bankTotal(data), revenue, collected, outstandingAR, outstandingAP, cash: monthCash(data, month),
      deltas: {
        bank: { text: '即時', className: 'neutral' }, revenue: delta(revenue, monthRevenue(data, prev)),
        collected: delta(collected, monthCollections(data, prev)), ar: delta(outstandingAR, prevOpenAR),
        ap: delta(outstandingAP, prevOpenAP), cash: delta(monthCash(data, month), monthCash(data, prev))
      }, structureTotal, structurePaid, structureOpen,
      collectionRate: structureTotal ? structurePaid / structureTotal * 100 : 0,
      recoveryRate: allAR ? Math.min(100, allReceived / allAR * 100) : 0,
      projects, attentions, payrollTotal, payrollPaid, payrollOpen: Math.max(0, payrollTotal - payrollPaid)
    };
  }

  function renderKpis(vm) {
    const cards = [
      ['銀行總餘額', vm.bank, 'bank', 'banks', 'violet', 'landmark'], ['本月營業額', vm.revenue, 'revenue', 'billings', 'green', 'chart-no-axes-combined'],
      ['本月已收', vm.collected, 'collected', 'receivables', 'blue', 'arrow-down-to-line'], ['未收帳款', vm.outstandingAR, 'ar', 'receivables', 'orange', 'circle-dollar-sign'],
      ['應付帳款', vm.outstandingAP, 'ap', 'payables', 'red', 'arrow-up-from-line'], ['本月淨現金流', vm.cash, 'cash', 'banks', 'teal', 'wallet']
    ];
    $('#kpiGrid').innerHTML = cards.map(([label, value, key, module, tone, icon]) => `<button class="kpi-card tone-${tone}" type="button" data-module="${module}"><div class="kpi-top"><span class="kpi-icon"><i data-icon="${icon}"></i></span><div><span class="kpi-label">${label}</span><strong class="kpi-value">${money(value)}</strong></div></div><div class="kpi-meta"><span>${key === 'bank' ? '資料狀態' : '較上月'}</span><em class="${vm.deltas[key].className}">${vm.deltas[key].text}</em></div></button>`).join('');
  }

  function trendPoints(data, month, range) {
    const base = new Date(`${month}-01T00:00:00`);
    if (range === 4) {
      const points = [];
      for (let i = 3; i >= 0; i -= 1) {
        const cursor = new Date(base.getFullYear(), base.getMonth() - i * 3, 1);
        const q = Math.floor(cursor.getMonth() / 3);
        let value = 0;
        for (let m = 0; m < 3; m += 1) { const d = new Date(cursor.getFullYear(), q * 3 + m, 1); value += monthRevenue(data, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
        points.push({ key: `${cursor.getFullYear()} Q${q + 1}`, label: `Q${q + 1}`, value });
      }
      return points;
    }
    if (range === 3) {
      return [2,1,0].map((back) => { const year = base.getFullYear() - back; return { key: String(year), label: String(year), value: data.billings.filter((row) => monthOf(row).startsWith(String(year))).reduce((total, row) => total + billingAmount(row), 0) }; });
    }
    const points = [];
    for (let i = 11; i >= 0; i -= 1) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; points.push({ key, label: `${d.getMonth() + 1}月`, value: monthRevenue(data, key) }); }
    return points;
  }

  let activeVm = null;
  let activeRange = 12;
  let chartPositions = [];
  function renderChart() {
    if (!activeVm) return;
    const canvas = $('#trendChart');
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const w = rect.width, h = rect.height, left = 44, right = 18, top = 20, bottom = 30;
    const points = trendPoints(activeVm.data, activeVm.month, activeRange);
    const rawMax = Math.max(...points.map((p) => p.value), 1);
    const magnitude = 10 ** Math.floor(Math.log10(rawMax));
    const max = Math.ceil(rawMax / magnitude) * magnitude;
    ctx.font = '11px Microsoft JhengHei'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) { const y = top + (h - top - bottom) * i / 4; ctx.strokeStyle = '#e5ebf2'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w-right, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#50627c'; const value = max * (1 - i / 4); ctx.fillText(value >= 10000 ? `${Math.round(value / 10000)}萬` : nf.format(Math.round(value)), 1, y); }
    chartPositions = points.map((point, index) => ({ ...point, x: left + (w-left-right) * (points.length === 1 ? .5 : index/(points.length-1)), y: top + (h-top-bottom) * (1 - point.value/max) }));
    const area = ctx.createLinearGradient(0, top, 0, h-bottom); area.addColorStop(0, 'rgba(25,95,222,.22)'); area.addColorStop(1, 'rgba(25,95,222,0)');
    ctx.beginPath(); chartPositions.forEach((p, i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.lineTo(chartPositions.at(-1).x,h-bottom); ctx.lineTo(chartPositions[0].x,h-bottom); ctx.closePath(); ctx.fillStyle=area; ctx.fill();
    ctx.beginPath(); chartPositions.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.strokeStyle='#0b5bd6'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();
    chartPositions.forEach((p) => { ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#0b5bd6';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#40536f';ctx.textAlign='center';ctx.fillText(p.label,p.x,h-11); }); ctx.textAlign='left';
  }

  function renderStructure(vm) {
    const paidRate = Math.max(0, Math.min(100, vm.collectionRate));
    $('#collectionDonut').style.background = `conic-gradient(var(--green) 0 ${paidRate}%,var(--orange) ${paidRate}% 100%)`;
    $('#structureTotal').textContent = money(vm.structureTotal); $('#structurePaid').textContent = money(vm.structurePaid); $('#structureOpen').textContent = money(vm.structureOpen);
    $('#collectionRate').textContent = `${paidRate.toFixed(1)}%`; $('#collectionBar').style.width = `${paidRate}%`;
    $('#recoveryRate').textContent = `${vm.recoveryRate.toFixed(1)}%`; $('#recoveryBar').style.width = `${vm.recoveryRate}%`;
  }
  function renderProjects(vm) {
    $('#projectRows').innerHTML = vm.projects.length ? vm.projects.map((row) => `<tr data-module="projects"><td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td><td>${money(row.billed)}</td><td>${money(row.received)}</td><td>${money(row.outstanding)}</td><td>${money(row.material)}</td><td>${money(row.labor)}</td><td>${money(row.profit)}</td><td>${row.margin.toFixed(1)}%</td><td><span class="status-pill ${/已完工/.test(row.status) ? 'done' : /暫停|未完工/.test(row.status) ? 'hold' : ''}">${escapeHtml(row.status)}</span></td></tr>`).join('') : '<tr><td colspan="9" class="empty-cell">目前沒有可彙整的案場資料</td></tr>';
  }
  function attentionMarkup(rows) {
    return rows.length ? rows.map((row) => `<button class="attention-item" type="button" data-module="${row.module}"><span class="attention-icon ${row.tone}"><i data-icon="${row.icon}"></i></span><span class="attention-copy"><strong>${row.type}</strong><small class="count-pill">${row.countLabel||`${row.count} 筆`}</small></span><b class="attention-amount">${money(row.amount)}</b><i class="attention-arrow" data-icon="chevron-right"></i></button>`).join('') : '<div class="all-clear">目前沒有待處理項目</div>';
  }
  function renderAttention(vm) {
    $('#attentionList').innerHTML = attentionMarkup(vm.attentions);
    $('#notificationItems').innerHTML = attentionMarkup(vm.attentions.slice(0, 5));
    const total = vm.attentions.reduce((n, row) => n + row.count, 0);
    $('#notificationCount').textContent = total; $('#noticeTotal').textContent = `${total} 筆`;
  }
  function renderPayroll(vm) {
    $('#payrollSummary').innerHTML = `<div><span>薪資總額</span><strong>${money(vm.payrollTotal)}</strong></div><div><span>已付款</span><strong>${money(vm.payrollPaid)}</strong></div><div><span>未付款</span><strong>${money(vm.payrollOpen)}</strong></div><button type="button" data-module="payroll">查看薪資管理　→</button>`;
  }
  function render(vm) {
    activeVm = vm; renderKpis(vm); renderStructure(vm); renderProjects(vm); renderAttention(vm); renderPayroll(vm);
    $('#trendCurrent').textContent = money(vm.revenue); const d = vm.deltas.revenue; $('#trendDelta').textContent = d.text; $('#trendDelta').className = d.className;
    renderChart(); window.KusheIcons?.render(document);
    const info = window.KuSheLegacyData.getSourceInfo();
    const count = window.KuSheLegacyData.score(vm.data);
    const stamp = info.updatedAt ? new Date(info.updatedAt).toLocaleString('zh-TW', { hour12:false }) : '—';
    $('#dataSourceLabel').textContent = count ? `${info.label}｜${count} 筆既有資料｜更新 ${stamp}` : '尚未讀取到既有 ERP 資料；所有缺少項目均顯示 0 或 —';
  }
  function refresh() { const data = window.KuSheLegacyData.refresh(); render(derive(data, selectedMonth())); }
  function setupChart() {
    const canvas = $('#trendChart'); const tooltip = $('#chartTooltip');
    canvas.addEventListener('mousemove', (event) => { if (!chartPositions.length) return; const rect=canvas.getBoundingClientRect(); const x=event.clientX-rect.left; const point=chartPositions.reduce((best,p)=>Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,chartPositions[0]); tooltip.hidden=false; tooltip.textContent=`${point.key}　${money(point.value)}`; tooltip.style.left=`${point.x}px`; tooltip.style.top=`${point.y}px`; });
    canvas.addEventListener('mouseleave',()=>{tooltip.hidden=true});
    window.addEventListener('resize',()=>requestAnimationFrame(renderChart));
    document.querySelectorAll('#trendRange [data-range]').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('#trendRange button').forEach((b)=>b.classList.remove('is-active'));button.classList.add('is-active');activeRange=Number(button.dataset.range);renderChart()}));
  }
  function init() { setupChart(); refresh(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()}); window.addEventListener('storage', refresh); window.addEventListener('kushe:data-updated', refresh); setInterval(()=>{if(!document.hidden)refresh()},10000); }
  window.KusheDashboard = { init, refresh, render, getState: () => activeVm };
}());
