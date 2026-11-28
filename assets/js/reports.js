(function () {
  'use strict';
  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => Number.isNaN(value)?'待核對':new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD', maximumFractionDigits:0 }).format(store.num(value));
  const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' });
  const businessDate = (date = new Date()) => {
    const parts = Object.fromEntries(businessDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const monthOf = (value) => String(value || '').slice(0, 7);
  let active = false;
  let ready = false;
  let selectedMonth = businessDate().slice(0, 7);

  function sum(rows, key) {
    return rows.reduce((total, row) => total + store.num(typeof key === 'function' ? key(row) : row?.[key]), 0);
  }
  function payrollSummary(month) {
    const rows = store.monthlyPayrollGroups().filter((row) => String(row.month || '') === month);
    return {
      total: sum(rows, 'total'),
      paid: sum(rows, 'paid'),
      outstanding: sum(rows, 'outstanding'),
      count: rows.length
    };
  }
  function invoiceSummary(month) {
    const rows = store.invoiceRows().filter((row) => row.status === 'issued' && monthOf(row.invoiceDate) === month);
    const values = (type) => {
      const matches = rows.filter((row) => row.invoiceType === type);
      return { net:sum(matches,'netAmount'), tax:sum(matches,'taxAmount'), gross:sum(matches,'grossAmount'), count:matches.length };
    };
    const output = values('output'), input = values('input'),allowanceRows=(store.invoiceAllowanceRows?.()||[]).filter(row=>monthOf(row.date)===month),allowances={net:sum(allowanceRows,'netAmount'),tax:sum(allowanceRows,'taxAmount'),gross:sum(allowanceRows,'grossAmount'),count:allowanceRows.length};
    return { output, input, allowances, taxDifference: output.tax + allowances.tax - input.tax };
  }
  function projectRows(snapshot) {
    return Array.isArray(snapshot?.reportProjects) ? snapshot.reportProjects : [];
  }
  function projectDesktop(rows) {
    return rows.map((row) => `<tr><td><b>${esc(row.name)}</b><small>${esc(row.customer || '—')}</small></td><td class="num">${money(row.billed)}</td><td class="num">${money(row.material)}</td><td class="num">${money(row.labor)}</td><td class="num">${money(row.other)}</td><td class="num">${money(row.customerDeduction)}</td><td class="num"><b>${money(row.totalCost)}</b></td><td class="num"><b class="${row.profit < 0 ? 'negative' : 'positive'}">${money(row.profit)}</b></td><td class="num">${Number.isFinite(row.margin)?row.margin.toFixed(1)+'%':'待核對'}</td></tr>`).join('') || '<tr><td colspan="9" class="billing-empty">目前沒有可彙整的案場財務資料。</td></tr>';
  }
  function projectMobile(rows) {
    return rows.map((row) => `<article class="reports-project-card"><header><div><span>案場</span><h3>${esc(row.name)}</h3><p>${esc(row.customer || '—')}</p></div><strong class="${row.profit < 0 ? 'negative' : 'positive'}">${money(row.profit)}</strong></header><dl><div><dt>未稅請款</dt><dd>${money(row.billed)}</dd></div><div><dt>材料</dt><dd>${money(row.material)}</dd></div><div><dt>人工／抽成</dt><dd>${money(row.labor)}</dd></div><div><dt>其他成本</dt><dd>${money(row.other)}</dd></div><div><dt>客戶扣款</dt><dd>${money(row.customerDeduction)}</dd></div><div><dt>總成本</dt><dd>${money(row.totalCost)}</dd></div></dl><footer><span>毛利率</span><b>${Number.isFinite(row.margin)?row.margin.toFixed(1)+'%':'待核對'}</b></footer></article>`).join('') || '<p class="reports-empty">目前沒有可彙整的案場財務資料。</p>';
  }
  function invoiceCards(summary) {
    const card = (title, value, key) => `<article${window.KusheKpi.attrs('reports.'+key,title)}><span>${title}</span><strong>${money(value)}</strong></article>`;
    return [
      card('銷項未稅',summary.output.net,'output-net'), card('銷項稅額',summary.output.tax,'output-tax'), card('銷項含稅',summary.output.gross,'output-gross'),
      card('進項未稅',summary.input.net,'input-net'), card('進項稅額',summary.input.tax,'input-tax'), card('進項含稅',summary.input.gross,'input-gross'),
      card('本期銷項折讓／撤銷未稅',summary.allowances.net,'allowance-net'), card('本期銷項折讓／撤銷稅額',summary.allowances.tax,'allowance-tax'), card('本期銷項折讓／撤銷含稅',summary.allowances.gross,'allowance-gross')
    ].join('');
  }
  function render() {
    if (!active) return;
    const host = $('#reportsApp');
    if (!host) return;
    const snapshot = window.KusheDashboard?.readSnapshot?.(selectedMonth);
    if (!snapshot) {
      host.innerHTML = '<section class="commission-panel reports-error"><h2>統計報表暫時無法讀取</h2><p>找不到首頁營運快照來源，未進行任何資料寫入。</p></section>';
      return;
    }
    const payroll = payrollSummary(selectedMonth), invoices = invoiceSummary(selectedMonth), projects = projectRows(snapshot);
    host.innerHTML = `
      <section class="commissions-heading reports-heading">
        <div><h1>統計報表</h1><p>唯讀彙整既有 ERP 正式資料；不建立第二套帳務資料。</p></div>
        <label class="reports-month"><span>報表月份</span><input id="reportsMonth" type="month" value="${esc(selectedMonth)}"></label>
      </section>
      <section class="commission-kpis reports-kpis" aria-label="本期營運總覽">
        <article data-kpi="reports.revenue" role="button" tabindex="0" aria-label="查看本期未稅營業額對應明細" aria-expanded="false"><span>本期未稅營業額</span><strong>${money(snapshot.revenue)}</strong><small>${esc(selectedMonth)} 原請款＋本期折讓／撤銷</small></article>
        <article class="is-success" data-kpi="reports.received" role="button" tabindex="0" aria-label="查看本期實收本金對應明細" aria-expanded="false"><span>本期實收本金</span><strong>${money(snapshot.collected)}</strong><small>依正式收款辨識</small></article>
        <article data-kpi="reports.payroll" role="button" tabindex="0" aria-label="查看本期薪資總額對應明細" aria-expanded="false"><span>本期薪資總額</span><strong>${money(payroll.total)}</strong><small>${payroll.count} 組員工月份</small></article>
        <article class="is-warning" data-kpi="reports.unpaid" role="button" tabindex="0" aria-label="查看本期薪資未付對應明細" aria-expanded="false"><span>本期薪資未付</span><strong>${money(payroll.outstanding)}</strong><small>已付 ${money(payroll.paid)}</small></article>
        <article class="is-warning" data-kpi="reports.ar" role="button" tabindex="0" aria-label="查看目前未收帳款對應明細" aria-expanded="false"><span>目前未收帳款</span><strong>${money(snapshot.outstandingAR)}</strong><small>即時餘額，不是月底快照</small></article>
        <article class="is-warning" data-kpi="reports.ap" role="button" tabindex="0" aria-label="查看目前未付帳款對應明細" aria-expanded="false"><span>目前未付帳款</span><strong>${money(snapshot.outstandingAP)}</strong><small>即時餘額，不是月底快照</small></article>
      </section>
      <section class="commission-panel reports-section">
        <header class="reports-section-head"><div><h2>案場累計毛利</h2><p>沿用首頁營運毛利口徑；依累計有效未稅請款（含正式折讓）與即時成本計算。</p></div><span>累計／即時</span></header>
        <div class="commission-table-wrap reports-project-desktop"><table class="commission-table reports-project-table"><thead><tr><th>案場／客戶</th><th class="num">未稅請款</th><th class="num">材料</th><th class="num">人工／抽成</th><th class="num">其他成本</th><th class="num">客戶扣款</th><th class="num">總成本</th><th class="num">毛利</th><th class="num">毛利率</th></tr></thead><tbody>${projectDesktop(projects)}</tbody></table></div>
        <div class="reports-project-mobile">${projectMobile(projects)}</div>
      </section>
      <section class="commission-panel reports-section">
        <header class="reports-section-head"><div><h2>發票稅額</h2><p>${esc(selectedMonth)} 已開發票與本期票後折讓／撤銷分列；開票前已納入票額的折讓不重複扣除。</p></div><span>唯讀</span></header>
        <div class="reports-tax-grid">${invoiceCards(invoices)}</div>
        <div class="reports-tax-difference"><span>銷項稅額＋本期折讓／撤銷稅額 − 進項稅額</span><strong>${money(invoices.taxDifference)}</strong></div>
        <p class="reports-tax-note">稅額差額僅為 ERP 已開票資料彙總，不等同最終申報應納稅額。</p>
      </section>`;
    $('#reportsMonth',host).onchange = (event) => {
      const value = String(event.target.value || '');
      if (/^\d{4}-\d{2}$/.test(value)) selectedMonth = value;
      render();
    };
    window.KusheIcons?.render(host);
  }
  async function activate() {
    active = true;
    if (!ready) { await store.load(); ready = true; }
    render();
  }
  function deactivate() { active = false; }
  window.addEventListener('kushe:data-updated', () => { if (active) render(); });
  window.addEventListener('storage', () => { if (active) render(); });
  window.KusheReports = Object.freeze({ activate, deactivate, render });

  // P21: read-only KPI destinations; original calculations and save paths are unchanged.

  window.KusheKpi.register('reports',{anchor:'.reports-kpis,.reports-tax-grid',active:()=>active,read(action){
    const data=window.KuSheERPStore.getState();
    if(/^allowance-(net|tax|gross)$/.test(action))return window.KusheKpi.model('invoices.'+action,{month:selectedMonth});
    if(/^(output|input)-(net|tax|gross)$/.test(action))return window.KusheKpi.model('invoices.'+action,{month:selectedMonth});
    if(action==='received')return window.KusheKpi.model('collection.month',{month:selectedMonth});
    if(action==='ar')return window.KusheKpi.model('ar.open');
    if(action==='ap')return window.KusheKpi.model('ap.open');
    if(action==='payroll'||action==='unpaid')return {title:selectedMonth+' '+(action==='unpaid'?'未付薪資':'薪資彙總'),scope:'按同一員工／月份彙整，與本期薪資字卡相同；不付款、不修改歷史。',columns:['月份','員工','薪資總額','已付','未付'],rows:store.monthlyPayrollGroups().filter(r=>String(r.month||'')===selectedMonth&&(action!=='unpaid'||r.outstanding>0)).map(r=>({id:r.key,cells:[r.month,r.employeeName,money(r.total),money(r.paid),money(r.outstanding)]}))};
    if(action==='revenue')return {title:selectedMonth+' 未稅營業額來源',scope:'原請款依原請款月份；正式折讓／撤銷依核定日期另列，不改原請款月份。',columns:['日期','請款單','客戶','案場','來源','未稅金額'],rows:[...data.billings.filter(r=>monthOf(r.date)===selectedMonth).map(r=>({id:r.id,cells:[r.date,r.number,r.customerName,r.projectName,'原請款',money(r.amount??r.untaxedAmount??r.total)]})),...(store.allowanceAccountingRows?.(data)||[]).filter(r=>monthOf(r.date)===selectedMonth).map(r=>({id:r.id,cells:[r.date,r.billingNo,data.customers.find(c=>String(c.id)===String(r.customerId))?.name||'—',data.projects.find(p=>String(p.id)===String(r.projectId))?.name||'—',r.eventType==='reverse'?'折讓撤銷':'正式折讓',money(r.untaxed)]}))]};return null;
  }});

}());
