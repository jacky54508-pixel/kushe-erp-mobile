(function () {
  'use strict';

  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => `$${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(store.num(value)))}`;

  let active = false;
  let ready = false;
  let bound = false;
  let selectedMonth = localMonth();

  function localMonth(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function normalizeMonth(value) {
    const month = /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : localMonth();
    return month > localMonth() ? localMonth() : month;
  }

  function shiftMonth(month, delta) {
    const [year, value] = normalizeMonth(month).split('-').map(Number);
    return localMonth(new Date(year, value - 1 + delta, 1));
  }

  function monthLabel(month) {
    const [year, value] = normalizeMonth(month).split('-').map(Number);
    return `${year} 年 ${value} 月`;
  }

  function bankName(row) {
    return row?.name || row?.bank || row?.account || '銀行帳戶';
  }

  function currentBalance(row) {
    return store.num(row?.openingBalance) + store.num(row?.income) - store.num(row?.expense);
  }

  function transactionBankId(row) {
    return String(row?.bankAccountId || row?.bankId || '');
  }

  function transactionDirection(row) {
    if (row?.direction === 'in') return 'in';
    if (row?.direction === 'out') return 'out';
    const text = `${row?.type || ''} ${row?.category || ''}`;
    if (/收入|收款|入帳|收回/.test(text)) return 'in';
    if (/支出|付款|薪資/.test(text)) return 'out';
    return '';
  }

  function compareTransactions(a, b) {
    return String(a?.date || '').localeCompare(String(b?.date || ''))
      || String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''))
      || String(a?.id || '').localeCompare(String(b?.id || ''));
  }

  function sourceLabel(row) {
    if (!row?.direction) return '歷史銀行交易';
    const source = `${row.category || ''} ${row.sourceType || ''}`;
    if (/保留款/.test(source)) return '保留款收款';
    if (/應收|receivable|receipt/.test(source)) return '客戶收款';
    if (/應付|payable/.test(source)) return '廠商付款';
    if (/薪資|salary|payroll/.test(source)) return '薪資付款';
    return row.category || row.type || '銀行交易';
  }

  function counterpartyLabel(row) {
    const party = row.customerName || row.vendorName || row.employeeName || '';
    const project = row.projectName || '';
    if (party && project && party !== project) return `<strong>${esc(party)}</strong><small>${esc(project)}</small>`;
    if (party || project) return `<strong>${esc(party || project)}</strong>`;
    return '<span class="bank-muted">—</span>';
  }

  function descriptionLabel(row) {
    return row.description || row.note || row.sourceNo || '—';
  }

  function bankMonthView(state, month) {
    const monthRows = [];
    let monthOpening = 0;
    let monthIncome = 0;
    let monthExpense = 0;
    let unknownCount = 0;
    const runningBalances = new Map();

    state.banks.forEach((bank) => {
      const bankId = String(bank.id || '');
      const bankRows = state.bankTransactions
        .filter((row) => transactionBankId(row) === bankId)
        .sort(compareTransactions);
      let opening = store.num(bank.openingBalance);

      bankRows.forEach((row) => {
        if (String(row.date || '').slice(0, 7) >= month) return;
        const direction = transactionDirection(row);
        if (direction === 'in') opening += store.num(row.amount);
        if (direction === 'out') opening -= store.num(row.amount);
      });

      monthOpening += opening;
      let running = opening;
      bankRows.filter((row) => String(row.date || '').slice(0, 7) === month).forEach((row) => {
        const direction = transactionDirection(row);
        const amount = store.num(row.amount);
        if (direction === 'in') {
          monthIncome += amount;
          running += amount;
        } else if (direction === 'out') {
          monthExpense += amount;
          running -= amount;
        } else {
          unknownCount += 1;
        }
        runningBalances.set(String(row.id || ''), direction ? running : null);
        monthRows.push({ row, bank, direction });
      });
    });

    return {
      month,
      monthOpening,
      monthIncome,
      monthExpense,
      monthClosing: monthOpening + monthIncome - monthExpense,
      unknownCount,
      runningBalances,
      rows: monthRows.sort((a, b) => compareTransactions(b.row, a.row))
    };
  }

  function renderSummary(view) {
    const cards = [
      ['月初餘額', view.monthOpening, `${monthLabel(view.month)}開始時`],
      ['本月收入', view.monthIncome, `${view.rows.filter((item) => item.direction === 'in').length} 筆收入`, 'is-income'],
      ['本月支出', view.monthExpense, `${view.rows.filter((item) => item.direction === 'out').length} 筆支出`, 'is-expense'],
      ['月末餘額', view.monthClosing, `${monthLabel(view.month)}結束時`, 'is-closing']
    ];
    return `<section class="bank-month-summary" aria-label="${esc(monthLabel(view.month))}銀行摘要">${cards.map(([label, amount, note, className = '']) => `<article class="${className}"><span>${esc(label)}</span><strong>${money(amount)}</strong><small>${esc(note)}</small></article>`).join('')}</section>`;
  }

  function renderRows(view) {
    if (!view.rows.length) return '<tr><td colspan="9" class="billing-empty">此月份尚無銀行交易。</td></tr>';
    return view.rows.map(({ row, bank, direction }) => {
      const running = view.runningBalances.get(String(row.id || ''));
      const directionText = direction === 'in' ? '收入' : direction === 'out' ? '支出' : '無法辨識';
      const directionClass = direction === 'in' ? 'is-income' : direction === 'out' ? 'is-expense' : 'is-unknown';
      return `<tr>
        <td class="bank-date">${esc(row.date || '—')}</td>
        <td><span class="bank-direction ${directionClass}">${esc(directionText)}</span></td>
        <td><span class="bank-source">${esc(sourceLabel(row))}</span></td>
        <td class="bank-counterparty">${counterpartyLabel(row)}</td>
        <td class="bank-description">${esc(descriptionLabel(row))}</td>
        <td class="num bank-income-amount">${direction === 'in' ? money(row.amount) : '—'}</td>
        <td class="num bank-expense-amount">${direction === 'out' ? money(row.amount) : '—'}</td>
        <td class="num bank-running-balance">${running === null || running === undefined ? '—' : money(running)}</td>
        <td>${esc(bankName(bank))}</td>
      </tr>`;
    }).join('');
  }

  function render() {
    if (!active) return;
    const state = store.getState();
    selectedMonth = normalizeMonth(selectedMonth);
    const view = bankMonthView(state, selectedMonth);
    const actualBalance = state.banks.reduce((sum, row) => sum + currentBalance(row), 0);
    const accountName = state.banks.length === 1 ? bankName(state.banks[0]) : `${state.banks.length} 個銀行帳戶`;
    const app = $('#banksApp');
    if (!app) return;

    app.innerHTML = `<section class="commissions-heading bank-ledger-heading">
      <div><h1>銀行查帳</h1><p>${esc(accountName)}</p></div>
      <div class="bank-current-balance"><span>目前實際餘額</span><strong>${money(actualBalance)}</strong></div>
    </section>
    <section class="commission-panel bank-month-panel">
      <div class="bank-month-toolbar" aria-label="銀行查帳月份">
        <button type="button" class="bank-month-button bank-month-prev" data-bank-month-action="previous" aria-label="上一月">← <span>上一月</span></button>
        <label class="bank-month-picker"><span>查詢月份</span><input type="month" data-bank-month-input value="${esc(selectedMonth)}" max="${esc(localMonth())}"></label>
        <button type="button" class="bank-month-button bank-month-next" data-bank-month-action="next" aria-label="下一月" ${selectedMonth >= localMonth() ? 'disabled' : ''}><span>下一月</span> →</button>
        <button type="button" class="bank-month-today" data-bank-month-action="today" ${selectedMonth === localMonth() ? 'disabled' : ''}>回到本月</button>
      </div>
      <p class="bank-month-caption">目前查看：<strong>${esc(monthLabel(selectedMonth))}</strong></p>
      ${view.unknownCount ? `<div class="bank-month-warning" role="status">此月份存在無法辨識的歷史交易，摘要可能不完整。</div>` : ''}
    </section>
    ${renderSummary(view)}
    <section class="commission-panel billing-list-panel bank-ledger-panel">
      <header class="project-section-title"><div><h2>${esc(monthLabel(selectedMonth))}交易明細</h2><p>共 ${view.rows.length} 筆；交易後餘額依日期、建立時間及系統編號穩定計算。</p></div></header>
      <div class="commission-table-wrap bank-ledger-scroll"><table class="commission-table bank-ledger-table">
        <thead><tr><th>日期</th><th>收／支</th><th>來源</th><th>對象／案場</th><th>說明</th><th class="num">收入</th><th class="num">支出</th><th class="num">交易後餘額</th><th>帳戶</th></tr></thead>
        <tbody>${renderRows(view)}</tbody>
      </table></div>
    </section>`;
    window.KusheIcons?.render(app);
  }

  function bind() {
    if (bound) return;
    const app = $('#banksApp');
    if (!app) return;
    bound = true;
    app.addEventListener('click', (event) => {
      const button = event.target.closest('[data-bank-month-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.bankMonthAction;
      if (action === 'previous') selectedMonth = shiftMonth(selectedMonth, -1);
      if (action === 'next') selectedMonth = normalizeMonth(shiftMonth(selectedMonth, 1));
      if (action === 'today') selectedMonth = localMonth();
      render();
    });
    app.addEventListener('change', (event) => {
      if (!event.target.matches('[data-bank-month-input]')) return;
      selectedMonth = normalizeMonth(event.target.value);
      render();
    });
  }

  async function activate() {
    active = true;
    if (!ready) {
      await store.load();
      ready = true;
    }
    bind();
    render();
  }

  function deactivate() {
    active = false;
  }

  window.addEventListener('kushe:data-updated', render);
  window.KusheBanks = { activate, deactivate, render };
}());
