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
  let activeBankView = 'ledger';
  let reconciliationSearchTimer = null;
  const reconciliationFilters = { month: '', status: 'all', direction: 'all', source: 'all', keyword: '' };
  const RECONCILIATION_STATUSES = {
    normal: { label: '正常', group: 'normal' },
    'missing-bank': { label: '缺少銀行交易', group: 'abnormal' },
    'missing-source': { label: '來源資料不存在', group: 'abnormal' },
    mismatch: { label: '金額不一致', group: 'abnormal' },
    duplicate: { label: '疑似重複入帳', group: 'abnormal' },
    'history-normal': { label: '歷史資料－金額正常', group: 'normal' },
    'history-pending': { label: '歷史待確認', group: 'attention' }
  };

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

  function collection(state, key) {
    return Array.isArray(state?.[key]) ? state[key] : [];
  }

  function cleanId(value) {
    return String(value || '').trim();
  }

  function transactionAmount(row) {
    return store.num(row?.amount ?? row?.actualCredit ?? row?.actualDebit);
  }

  function sourceBankAmount(row, kind) {
    if (row?.actualDebit !== undefined && ['payable', 'salary'].includes(kind)) return store.num(row.actualDebit);
    if (row?.netAmount !== undefined && ['receipt', 'retention'].includes(kind)) return store.num(row.netAmount);
    const amount = store.num(row?.amount);
    const fee = Math.max(0, store.num(row?.fee));
    if (['receipt', 'retention'].includes(kind)) return row?.feePayer === 'company' ? Math.max(0, amount - fee) : amount;
    return row?.feePayer === 'company' ? amount + fee : amount;
  }

  function sourceDirection(kind) {
    return ['receipt', 'retention'].includes(kind) ? 'in' : 'out';
  }

  function reconciliationSourceLabel(kind, legacy = false) {
    if (legacy) return '歷史付款彙總';
    if (kind === 'receipt') return '客戶收款';
    if (kind === 'retention') return '保留款收款';
    if (kind === 'payable') return '廠商付款';
    if (kind === 'salary') return '薪資付款';
    return '歷史銀行交易';
  }

  function transactionReferencesSource(transaction, row, kind) {
    const id = cleanId(row?.id);
    if (!id) return false;
    const sourceType = cleanId(transaction?.sourceType);
    const aliases = {
      receipt: new Set(['receipt', 'receivable_receipt']),
      retention: new Set(['retention_receipt']),
      payable: new Set(['payable-payment', 'payable_payment']),
      salary: new Set(['salary_payment'])
    }[kind] || new Set();
    return (cleanId(transaction?.sourceId) === id && aliases.has(sourceType))
      || (kind === 'receipt' && cleanId(transaction?.receiptId) === id)
      || (kind === 'retention' && cleanId(transaction?.retentionReceiptId) === id)
      || (kind === 'salary' && cleanId(transaction?.salaryPaymentId) === id);
  }

  function sourceTransactions(state, row, kind) {
    const id = cleanId(row?.id);
    const transactionId = cleanId(row?.bankTransactionId);
    const matches = collection(state, 'bankTransactions').filter((transaction) => {
      return (transactionId && cleanId(transaction.id) === transactionId)
        || transactionReferencesSource(transaction, row, kind);
    });
    const unique = new Map();
    matches.forEach((transaction) => unique.set(cleanId(transaction.id) || transaction, transaction));
    return [...unique.values()];
  }

  function sourceContext(state, row, kind, transaction) {
    let source = null;
    let party = transaction?.customerName || transaction?.vendorName || transaction?.employeeName || '';
    let project = transaction?.projectName || '';
    let sourceNo = transaction?.sourceNo || '';

    if (['receipt', 'retention'].includes(kind)) {
      source = collection(state, 'receivables').find((item) => cleanId(item.id) === cleanId(row.receivableId));
      const customer = collection(state, 'customers').find((item) => cleanId(item.id) === cleanId(source?.customer));
      party ||= source?.customerName || customer?.name || '';
      project ||= source?.projectName || '';
      sourceNo ||= source?.sourceNo || '';
    } else if (kind === 'payable') {
      source = collection(state, 'payables').find((item) => cleanId(item.id) === cleanId(row.payableId));
      const vendor = collection(state, 'vendors').find((item) => cleanId(item.id) === cleanId(source?.vendor));
      party ||= source?.vendorName || vendor?.name || '';
      project ||= source?.projectName || '';
      sourceNo ||= source?.payableNo || source?.sourceNo || '';
    } else if (kind === 'salary') {
      source = collection(state, 'payroll').find((item) => cleanId(item.id) === cleanId(row.payrollId));
      const employee = collection(state, 'employees').find((item) => cleanId(item.id) === cleanId(source?.employee));
      party ||= source?.employeeName || employee?.name || '';
      sourceNo ||= source?.month || '';
    }

    return { party: party || '—', project, sourceNo, source };
  }

  function isHistoricalTransaction(row, source) {
    return source?.legacy === true || !row?.direction || ['receipt', 'receivable', 'payable', 'payroll'].includes(cleanId(row?.sourceType));
  }

  function reconciliationDescription(status, row, kind, transactionCount) {
    const amount = money(store.num(row?.amount));
    const fee = Math.max(0, store.num(row?.fee));
    const feeText = fee ? `原始金額 ${amount}，手續費 ${money(fee)}。` : '';
    if (status === 'normal') return `原始帳務、唯一銀行流水與實際${sourceDirection(kind) === 'in' ? '入帳' : '扣款'}一致。${feeText}`;
    if (status === 'history-normal') return `舊版資料格式較早，但日期、對象與金額可可靠核對一致。${feeText}`;
    if (status === 'missing-bank') return '帳務紀錄存在，但找不到對應的銀行交易。';
    if (status === 'missing-source') return '銀行流水存在，但原付款、收款或薪資付款資料已不存在。';
    if (status === 'mismatch') return `原始帳務計算出的實際${sourceDirection(kind) === 'in' ? '入帳' : '扣款'}與銀行金額不同。${feeText}`;
    if (status === 'duplicate') return `同一筆帳務找到 ${transactionCount} 筆銀行交易，疑似重複入帳。`;
    return '此筆為舊版彙總顯示，沒有獨立銀行流水；不會自動判定為缺漏或補帳。';
  }

  function finishReconciliationItem(item) {
    const statusMeta = RECONCILIATION_STATUSES[item.status] || RECONCILIATION_STATUSES['history-pending'];
    const searchText = [item.date, statusMeta.label, item.sourceLabel, item.party, item.project, item.sourceNo, item.description].join(' ').toLocaleLowerCase('zh-Hant');
    return { ...item, statusLabel: statusMeta.label, statusGroup: statusMeta.group, searchText };
  }

  function sourceReconciliationItem(state, row, kind) {
    const legacy = row?.legacy === true;
    const matches = sourceTransactions(state, row, kind);
    const expected = sourceBankAmount(row, kind);
    const bankTotal = matches.reduce((sum, transaction) => sum + transactionAmount(transaction), 0);
    const linkMismatch = matches.length === 1 && !transactionReferencesSource(matches[0], row, kind);
    let status = 'normal';
    if (!matches.length) status = legacy ? 'history-pending' : 'missing-bank';
    else if (matches.length > 1) status = 'duplicate';
    else if (linkMismatch) status = 'history-pending';
    else if (Math.round(bankTotal) !== Math.round(expected)) status = 'mismatch';
    else if (legacy || isHistoricalTransaction(matches[0], row)) status = 'history-normal';
    const transaction = matches[0] || null;
    const context = sourceContext(state, row, kind, transaction);
    return finishReconciliationItem({
      id: `source:${kind}:${cleanId(row.id)}`,
      date: transaction?.date || row.date || '',
      status,
      direction: sourceDirection(kind),
      sourceKind: legacy ? 'history' : kind,
      sourceLabel: reconciliationSourceLabel(kind, legacy),
      party: context.party,
      project: context.project,
      sourceNo: context.sourceNo,
      accountingAmount: expected,
      bankAmount: matches.length ? bankTotal : null,
      difference: matches.length ? bankTotal - expected : null,
      description: linkMismatch ? '銀行流水編號可找到，但來源關聯與帳務紀錄不一致，需要人工確認。' : reconciliationDescription(status, row, kind, matches.length),
      transactionIds: matches.map((transactionRow) => cleanId(transactionRow.id)),
      sourceId: cleanId(row.id),
      rawSourceType: transaction?.sourceType || (legacy ? 'legacy-payment-summary' : kind)
    });
  }

  function verifiedLegacyPayrollReconciliation(state, transaction) {
    const transactionId = cleanId(transaction?.id);
    const sourceId = cleanId(transaction?.sourceId);
    const payrollId = cleanId(transaction?.payrollId);
    const payrollRows = collection(state, 'payroll');
    const payrollGroupIdentity = (row) => {
      const month = cleanId(row?.month);
      let employee = cleanId(row?.employee || row?.employeeId);
      if (!employee && cleanId(row?.employeeName)) {
        const matches = collection(state, 'employees').filter((item) => cleanId(item.name) === cleanId(row.employeeName));
        if (matches.length === 1) employee = cleanId(matches[0].id);
      }
      return employee && month ? `${employee}::${month}` : '';
    };
    const directSources = payrollRows.filter((row) => {
      const id = cleanId(row.id);
      return id && (id === payrollId || id === sourceId);
    });
    const transactionSources = payrollRows.filter((row) => cleanId(row.paymentTransactionId) === transactionId);
    const source = directSources.length === 1 && payrollGroupIdentity(directSources[0]) ? directSources[0] : null;
    const fallbackGroups = new Set(transactionSources.map(payrollGroupIdentity).filter(Boolean));
    const payroll = source || (fallbackGroups.size === 1 ? transactionSources[0] : null);
    if (!payroll) return null;

    const truth = store.payrollPaymentTruth(payroll);
    if (truth?.integrity !== 'verified-legacy') return { payroll, truth, status: 'history-pending' };
    const verifiedTransactions = truth?.verifiedLegacyTransactions || [];
    const verifiedMatches = verifiedTransactions.filter((row) => cleanId(row.id) === transactionId);
    if (verifiedMatches.length !== 1) return { payroll, truth, status: 'history-pending' };

    const historyMatches = (truth.history || []).filter((row) => cleanId(row.bankTransactionId) === transactionId);
    if (historyMatches.length !== 1) return { payroll, truth, status: 'history-pending' };
    const history = historyMatches[0];
    const accountingAmount = store.num(history.actualDebit ?? history.amount);
    const bankAmount = transactionAmount(transaction);
    return {
      payroll,
      truth,
      status: Math.round(accountingAmount) === Math.round(bankAmount) ? 'history-normal' : 'mismatch',
      accountingAmount,
      bankAmount
    };
  }

  function unmatchedTransactionItem(state, row) {
    const sourceType = cleanId(row.sourceType);
    const bankAmount = transactionAmount(row);
    let status = 'history-pending';
    let kind = 'history';
    let source = null;
    let description = '此筆為舊版銀行流水，目前資料不足以安全判定來源。';
    let accountingAmount = null;
    let difference = null;

    if (sourceType === 'receivable') {
      kind = 'receipt';
      source = collection(state, 'receivables').find((item) => cleanId(item.id) === cleanId(row.sourceId));
      if (!source) {
        status = 'missing-source';
        description = reconciliationDescription(status, row, kind, 1);
      } else if (Math.round(store.num(source.legacyReceived)) === Math.round(bankAmount)) {
        status = 'history-normal';
        description = '此筆為舊版直接收款流水，應收帳款保留相同的歷史收款金額，可可靠核對。';
      }
    } else if (['receipt', 'receivable_receipt', 'retention_receipt'].includes(sourceType)) {
      kind = sourceType === 'retention_receipt' ? 'retention' : 'receipt';
      status = 'missing-source';
      description = reconciliationDescription(status, row, kind, 1);
    } else if (['payable', 'payable-payment', 'payable_payment'].includes(sourceType)) {
      kind = 'payable';
      source = collection(state, 'payables').find((item) => cleanId(item.id) === cleanId(row.sourceId));
      status = 'missing-source';
      description = reconciliationDescription(status, row, kind, 1);
    } else if (['payroll', 'salary_payment'].includes(sourceType)) {
      kind = 'salary';
      const legacyPayroll = verifiedLegacyPayrollReconciliation(state, row);
      source = legacyPayroll?.payroll || collection(state, 'payroll').find((item) => cleanId(item.id) === cleanId(row.payrollId || row.sourceId));
      if (!source) {
        status = 'missing-source';
        description = reconciliationDescription(status, row, kind, 1);
      } else if (!legacyPayroll || legacyPayroll.status === 'history-pending') {
        status = 'history-pending';
        description = '薪資月份仍存在，但目前關聯不足以唯一核對這筆舊版銀行流水。';
      } else {
        status = legacyPayroll.status;
        accountingAmount = legacyPayroll.accountingAmount;
        difference = legacyPayroll.bankAmount - legacyPayroll.accountingAmount;
        description = status === 'history-normal'
          ? '此筆為舊版薪資付款資料，薪資月份與銀行流水仍可完整核對，金額正常。'
          : '舊版薪資付款資料仍可連回薪資月份，但帳務金額與銀行支出不一致。';
      }
    }

    const contextRow = source
      ? kind === 'receipt' ? { receivableId: source.id }
        : kind === 'payable' ? { payableId: source.id }
          : kind === 'salary' ? { payrollId: source.id }
            : row
      : row;
    const context = sourceContext(state, contextRow, kind, row);
    return finishReconciliationItem({
      id: `bank:${cleanId(row.id)}`,
      date: row.date || '',
      status,
      direction: transactionDirection(row),
      sourceKind: kind,
      sourceLabel: reconciliationSourceLabel(kind),
      party: context.party,
      project: context.project,
      sourceNo: row.sourceNo || context.sourceNo,
      accountingAmount: accountingAmount ?? (status === 'history-normal' ? bankAmount : null),
      bankAmount,
      difference: difference ?? (status === 'history-normal' ? 0 : null),
      description,
      transactionIds: [cleanId(row.id)],
      sourceId: cleanId(row.sourceId),
      rawSourceType: sourceType
    });
  }

  function bankReconciliationView(state) {
    const sourceRows = [
      ...collection(state, 'receipts').map((row) => ({ row, kind: 'receipt' })),
      ...collection(state, 'retentionReceipts').map((row) => ({ row, kind: 'retention' })),
      ...collection(state, 'payments').map((row) => ({ row, kind: 'payable' })),
      ...collection(state, 'salaryPayments').map((row) => ({ row, kind: 'salary' }))
    ];
    const items = sourceRows.map(({ row, kind }) => sourceReconciliationItem(state, row, kind));
    const usedTransactionIds = new Set(items.flatMap((item) => item.transactionIds).filter(Boolean));
    collection(state, 'bankTransactions').forEach((transaction) => {
      if (!usedTransactionIds.has(cleanId(transaction.id))) items.push(unmatchedTransactionItem(state, transaction));
    });
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
    const counts = Object.fromEntries(Object.keys(RECONCILIATION_STATUSES).map((status) => [status, items.filter((item) => item.status === status).length]));
    return {
      items,
      counts,
      normalCount: counts.normal + counts['history-normal'],
      attentionCount: counts['history-pending'],
      abnormalCount: counts['missing-bank'] + counts['missing-source'] + counts.mismatch + counts.duplicate,
      sourceChecks: {
        receiptCount: collection(state, 'receipts').length,
        retentionReceiptCount: collection(state, 'retentionReceipts').length,
        payablePaymentCount: collection(state, 'payments').filter((row) => row.legacy !== true).length,
        salaryPaymentCount: collection(state, 'salaryPayments').length,
        legacySummaryCount: collection(state, 'payments').filter((row) => row.legacy === true).length
      }
    };
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
    const closingLabel = view.month === localMonth() ? '本月期末／目前餘額' : '該月底餘額';
    const cards = [
      ['月初餘額', view.monthOpening, `${monthLabel(view.month)}開始時`],
      ['本月收入', view.monthIncome, `${view.rows.filter((item) => item.direction === 'in').length} 筆收入`, 'is-income'],
      ['本月支出', view.monthExpense, `${view.rows.filter((item) => item.direction === 'out').length} 筆支出`, 'is-expense'],
      [closingLabel, view.monthClosing, `${monthLabel(view.month)}結束時`, 'is-closing']
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

  function renderBankTabs() {
    return `<nav class="bank-view-tabs" aria-label="銀行功能">
      <button type="button" data-bank-view="ledger" class="${activeBankView === 'ledger' ? 'is-active' : ''}" aria-pressed="${activeBankView === 'ledger'}">月份查帳</button>
      <button type="button" data-bank-view="reconciliation" class="${activeBankView === 'reconciliation' ? 'is-active' : ''}" aria-pressed="${activeBankView === 'reconciliation'}">銀行對帳</button>
    </nav>`;
  }

  function renderLedger(state) {
    const view = bankMonthView(state, selectedMonth);
    return `<section class="commission-panel bank-month-panel">
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
  }

  function option(value, label, current) {
    return `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
  }

  function reconciliationVisibleItems(view) {
    const keyword = reconciliationFilters.keyword.trim().toLocaleLowerCase('zh-Hant');
    return view.items.filter((item) => {
      if (reconciliationFilters.month && String(item.date || '').slice(0, 7) !== reconciliationFilters.month) return false;
      if (reconciliationFilters.status === 'attention' && item.statusGroup === 'normal') return false;
      if (!['all', 'attention'].includes(reconciliationFilters.status) && item.status !== reconciliationFilters.status) return false;
      if (reconciliationFilters.direction !== 'all' && item.direction !== reconciliationFilters.direction) return false;
      if (reconciliationFilters.source !== 'all' && item.sourceKind !== reconciliationFilters.source) return false;
      return !keyword || item.searchText.includes(keyword);
    });
  }

  function renderReconciliationSummary(view) {
    const cards = [
      ['正常', view.normalCount, '來源與金額可核對', 'is-normal'],
      ['待確認', view.attentionCount, '舊版彙總，僅供查核', 'is-attention'],
      ['異常', view.abnormalCount, '需要人工確認', 'is-abnormal']
    ];
    const breakdown = Object.entries(RECONCILIATION_STATUSES).map(([status, meta]) => `<div><span>${esc(meta.label)}</span><strong>${view.counts[status] || 0}</strong></div>`).join('');
    return `<section class="bank-reconciliation-summary" aria-label="銀行對帳摘要" data-normal-count="${view.normalCount}" data-attention-count="${view.attentionCount}" data-abnormal-count="${view.abnormalCount}">
      ${cards.map(([label, count, note, className]) => `<article class="${className}"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('')}
    </section>
    <section class="bank-reconciliation-breakdown" aria-label="對帳狀態細分">${breakdown}</section>`;
  }

  function renderReconciliationFilters(view) {
    const months = [...new Set(view.items.map((item) => String(item.date || '').slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
    const statusOptions = [
      option('all', '全部狀態', reconciliationFilters.status),
      option('attention', '需要注意', reconciliationFilters.status),
      ...Object.entries(RECONCILIATION_STATUSES).map(([value, meta]) => option(value, meta.label, reconciliationFilters.status))
    ].join('');
    return `<section class="commission-panel bank-reconciliation-filter-panel">
      <div class="bank-reconciliation-quick" aria-label="快速篩選">
        <button type="button" data-bank-reconciliation-quick="all" class="${reconciliationFilters.status === 'all' ? 'is-active' : ''}">全部</button>
        <button type="button" data-bank-reconciliation-quick="attention" class="${reconciliationFilters.status === 'attention' ? 'is-active' : ''}">只看需要注意</button>
      </div>
      <div class="bank-reconciliation-filters">
        <label><span>月份</span><select data-bank-reconciliation-filter="month">${option('', '全部月份', reconciliationFilters.month)}${months.map((month) => option(month, monthLabel(month), reconciliationFilters.month)).join('')}</select></label>
        <label><span>對帳狀態</span><select data-bank-reconciliation-filter="status">${statusOptions}</select></label>
        <label><span>收／支</span><select data-bank-reconciliation-filter="direction">${option('all', '全部收支', reconciliationFilters.direction)}${option('in', '收入', reconciliationFilters.direction)}${option('out', '支出', reconciliationFilters.direction)}</select></label>
        <label><span>來源</span><select data-bank-reconciliation-filter="source">${option('all', '全部來源', reconciliationFilters.source)}${option('receipt', '客戶收款', reconciliationFilters.source)}${option('retention', '保留款收款', reconciliationFilters.source)}${option('payable', '廠商付款', reconciliationFilters.source)}${option('salary', '薪資付款', reconciliationFilters.source)}${option('history', '歷史資料', reconciliationFilters.source)}</select></label>
        <label class="bank-reconciliation-search"><span>關鍵字</span><input type="search" data-bank-reconciliation-filter="keyword" value="${esc(reconciliationFilters.keyword)}" placeholder="客戶、廠商、員工、案場、單號、說明"></label>
      </div>
    </section>`;
  }

  function reconciliationTechnicalInfo(item) {
    const transactionIds = item.transactionIds.filter(Boolean).join('、') || '—';
    return `<details class="bank-reconciliation-technical"><summary>技術資訊</summary><dl>
      <div><dt>帳務資料 ID</dt><dd>${esc(item.sourceId || '—')}</dd></div>
      <div><dt>銀行交易 ID</dt><dd>${esc(transactionIds)}</dd></div>
      <div><dt>原始來源格式</dt><dd>${esc(item.rawSourceType || '—')}</dd></div>
    </dl></details>`;
  }

  function reconciliationDifference(value) {
    if (value === null || value === undefined) return '—';
    const amount = Math.round(store.num(value));
    if (!amount) return '$0';
    return amount > 0 ? `+${money(amount)}` : `-${money(Math.abs(amount))}`;
  }

  function renderReconciliationRows(items) {
    if (!items.length) return '<tr><td colspan="9" class="billing-empty">沒有符合目前篩選條件的對帳資料。</td></tr>';
    return items.map((item) => {
      const directionText = item.direction === 'in' ? '收入' : item.direction === 'out' ? '支出' : '未辨識';
      const directionClass = item.direction === 'in' ? 'is-income' : item.direction === 'out' ? 'is-expense' : 'is-unknown';
      return `<tr data-reconciliation-status="${esc(item.status)}" data-reconciliation-source="${esc(item.sourceKind)}">
        <td class="bank-date">${esc(item.date || '—')}</td>
        <td><span class="bank-reconciliation-status is-${esc(item.statusGroup)}">${esc(item.statusLabel)}</span></td>
        <td><span class="bank-direction ${directionClass}">${esc(directionText)}</span></td>
        <td><span class="bank-source">${esc(item.sourceLabel)}</span></td>
        <td class="bank-counterparty"><strong>${esc(item.party || '—')}</strong>${item.project ? `<small>${esc(item.project)}</small>` : ''}${item.sourceNo ? `<small>${esc(item.sourceNo)}</small>` : ''}</td>
        <td class="num">${item.accountingAmount === null ? '—' : money(item.accountingAmount)}</td>
        <td class="num">${item.bankAmount === null ? '—' : money(item.bankAmount)}</td>
        <td class="num bank-reconciliation-difference ${item.difference ? 'has-difference' : ''}">${reconciliationDifference(item.difference)}</td>
        <td class="bank-reconciliation-description"><p>${esc(item.description)}</p>${reconciliationTechnicalInfo(item)}</td>
      </tr>`;
    }).join('');
  }

  function renderReconciliation(state) {
    const view = bankReconciliationView(state);
    const visibleItems = reconciliationVisibleItems(view);
    const checks = view.sourceChecks;
    return `<section class="bank-reconciliation-heading">
      <div><h2>銀行對帳中心</h2><p>只讀檢查帳務來源、銀行流水、手續費後金額與重複關聯；本頁不會修復或寫入資料。</p></div>
    </section>
    ${renderReconciliationSummary(view)}
    ${renderReconciliationFilters(view)}
    <section class="commission-panel billing-list-panel bank-reconciliation-panel" data-receipt-check-count="${checks.receiptCount}" data-payable-check-count="${checks.payablePaymentCount}" data-salary-check-count="${checks.salaryPaymentCount}" data-legacy-summary-count="${checks.legacySummaryCount}">
      <header class="project-section-title"><div><h2>逐筆對帳結果</h2><p>顯示 ${visibleItems.length}／${view.items.length} 筆；舊版付款彙總不會被當成缺銀行流水。</p></div></header>
      <div class="commission-table-wrap bank-reconciliation-scroll"><table class="commission-table bank-reconciliation-table">
        <thead><tr><th>日期</th><th>狀態</th><th>收／支</th><th>來源</th><th>對象／案場</th><th class="num">帳務金額</th><th class="num">銀行金額</th><th class="num">差額</th><th>說明</th></tr></thead>
        <tbody>${renderReconciliationRows(visibleItems)}</tbody>
      </table></div>
    </section>`;
  }

  function render() {
    if (!active) return;
    const state = store.getState();
    selectedMonth = normalizeMonth(selectedMonth);
    const actualBalance = state.banks.reduce((sum, row) => sum + store.num(row.balance), 0);
    const accountName = state.banks.length === 1 ? bankName(state.banks[0]) : `${state.banks.length} 個銀行帳戶`;
    const app = $('#banksApp');
    if (!app) return;

    app.innerHTML = `<section class="commissions-heading bank-ledger-heading">
      <div><h1>銀行查帳</h1><p>依月份查看銀行收支與逐筆餘額</p></div>
    </section>
    <section class="bank-current-balance-card" aria-label="目前銀行餘額">
      <div class="bank-current-balance-amount"><span>目前銀行餘額</span><strong>${money(actualBalance)}</strong></div>
      <div class="bank-current-balance-context"><strong>${esc(accountName)}</strong><span>依目前全部銀行收支計算</span></div>
    </section>
    ${renderBankTabs()}
    ${activeBankView === 'reconciliation' ? renderReconciliation(state) : renderLedger(state)}`;
    window.KusheIcons?.render(app);
  }

  function bind() {
    if (bound) return;
    const app = $('#banksApp');
    if (!app) return;
    bound = true;
    app.addEventListener('click', (event) => {
      const viewButton = event.target.closest('[data-bank-view]');
      if (viewButton) {
        activeBankView = viewButton.dataset.bankView === 'reconciliation' ? 'reconciliation' : 'ledger';
        render();
        return;
      }
      const quickButton = event.target.closest('[data-bank-reconciliation-quick]');
      if (quickButton) {
        reconciliationFilters.status = quickButton.dataset.bankReconciliationQuick === 'attention' ? 'attention' : 'all';
        render();
        return;
      }
      const button = event.target.closest('[data-bank-month-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.bankMonthAction;
      if (action === 'previous') selectedMonth = shiftMonth(selectedMonth, -1);
      if (action === 'next') selectedMonth = normalizeMonth(shiftMonth(selectedMonth, 1));
      if (action === 'today') selectedMonth = localMonth();
      render();
    });
    app.addEventListener('change', (event) => {
      if (event.target.matches('[data-bank-month-input]')) {
        selectedMonth = normalizeMonth(event.target.value);
        render();
        return;
      }
      const filter = event.target.closest('[data-bank-reconciliation-filter]');
      if (!filter) return;
      reconciliationFilters[filter.dataset.bankReconciliationFilter] = filter.value;
      render();
    });
    app.addEventListener('input', (event) => {
      const filter = event.target.closest('[data-bank-reconciliation-filter="keyword"]');
      if (!filter) return;
      const cursor = filter.selectionStart;
      reconciliationFilters.keyword = filter.value;
      clearTimeout(reconciliationSearchTimer);
      reconciliationSearchTimer = setTimeout(() => {
        render();
        const replacement = app.querySelector('[data-bank-reconciliation-filter="keyword"]');
        replacement?.focus();
        replacement?.setSelectionRange(cursor, cursor);
      }, 120);
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
