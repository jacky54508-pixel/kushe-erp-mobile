(function () {
  'use strict';
  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD', maximumFractionDigits:0 }).format(store.num(value));
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
    const output = values('output'), input = values('input');
    return { output, input, taxDifference: output.tax - input.tax };
  }
  function projectRows(snapshot) {
    return Array.isArray(snapshot?.reportProjects) ? snapshot.reportProjects : [];
  }
  function projectDesktop(rows) {
    return rows.map((row) => `<tr><td><b>${esc(row.name)}</b><small>${esc(row.customer || '—')}</small></td><td class="num">${money(row.billed)}</td><td class="num">${money(row.material)}</td><td class="num">${money(row.labor)}</td><td class="num">${money(row.other)}</td><td class="num">${money(row.customerDeduction)}</td><td class="num"><b>${money(row.totalCost)}</b></td><td class="num"><b class="${row.profit < 0 ? 'negative' : 'positive'}">${money(row.profit)}</b></td><td class="num">${store.num(row.margin).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="9" class="billing-empty">目前沒有可彙整的案場財務資料。</td></tr>';
  }
  function projectMobile(rows) {
    return rows.map((row) => `<article class="reports-project-card"><header><div><span>案場</span><h3>${esc(row.name)}</h3><p>${esc(row.customer || '—')}</p></div><strong class="${row.profit < 0 ? 'negative' : 'positive'}">${money(row.profit)}</strong></header><dl><div><dt>未稅請款</dt><dd>${money(row.billed)}</dd></div><div><dt>材料</dt><dd>${money(row.material)}</dd></div><div><dt>人工／抽成</dt><dd>${money(row.labor)}</dd></div><div><dt>其他成本</dt><dd>${money(row.other)}</dd></div><div><dt>客戶扣款</dt><dd>${money(row.customerDeduction)}</dd></div><div><dt>總成本</dt><dd>${money(row.totalCost)}</dd></div></dl><footer><span>毛利率</span><b>${store.num(row.margin).toFixed(1)}%</b></footer></article>`).join('') || '<p class="reports-empty">目前沒有可彙整的案場財務資料。</p>';
  }
  function invoiceCards(summary) {
    const card = (title, value) => `<article><span>${title}</span><strong>${money(value)}</strong></article>`;
    return [
      card('銷項未稅',summary.output.net), card('銷項稅額',summary.output.tax), card('銷項含稅',summary.output.gross),
      card('進項未稅',summary.input.net), card('進項稅額',summary.input.tax), card('進項含稅',summary.input.gross)
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
        <article><span>本期未稅營業額</span><strong>${money(snapshot.revenue)}</strong><small>${esc(selectedMonth)} 請款未稅</small></article>
        <article class="is-success"><span>本期實收本金</span><strong>${money(snapshot.collected)}</strong><small>依正式收款辨識</small></article>
        <article><span>本期薪資總額</span><strong>${money(payroll.total)}</strong><small>${payroll.count} 組員工月份</small></article>
        <article class="is-warning"><span>本期薪資未付</span><strong>${money(payroll.outstanding)}</strong><small>已付 ${money(payroll.paid)}</small></article>
        <article class="is-warning"><span>目前未收帳款</span><strong>${money(snapshot.outstandingAR)}</strong><small>即時餘額，不是月底快照</small></article>
        <article class="is-warning"><span>目前未付帳款</span><strong>${money(snapshot.outstandingAP)}</strong><small>即時餘額，不是月底快照</small></article>
      </section>
      <section class="commission-panel reports-section">
        <header class="reports-section-head"><div><h2>案場累計毛利</h2><p>沿用首頁營運毛利口徑；依累計未稅請款與即時成本計算。</p></div><span>累計／即時</span></header>
        <div class="commission-table-wrap reports-project-desktop"><table class="commission-table reports-project-table"><thead><tr><th>案場／客戶</th><th class="num">未稅請款</th><th class="num">材料</th><th class="num">人工／抽成</th><th class="num">其他成本</th><th class="num">客戶扣款</th><th class="num">總成本</th><th class="num">毛利</th><th class="num">毛利率</th></tr></thead><tbody>${projectDesktop(projects)}</tbody></table></div>
        <div class="reports-project-mobile">${projectMobile(projects)}</div>
      </section>
      <section class="commission-panel reports-section">
        <header class="reports-section-head"><div><h2>發票稅額</h2><p>只統計 ${esc(selectedMonth)} 已開票（issued）的正式發票。</p></div><span>唯讀</span></header>
        <div class="reports-tax-grid">${invoiceCards(invoices)}</div>
        <div class="reports-tax-difference"><span>銷項稅額 − 進項稅額</span><strong>${money(invoices.taxDifference)}</strong></div>
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
}());
