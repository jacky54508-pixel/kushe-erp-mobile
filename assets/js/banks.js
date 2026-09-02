(function () {
  'use strict';

  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => `$${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(store.num(value)))}`;
  const businessMonthFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit' });
  const businessMonth = (date = new Date()) => {
    const parts = Object.fromEntries(businessMonthFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}`;
  };

  let active = false;
  let ready = false;
  let bound = false;
  let selectedMonth = businessMonth();
  let activeBankView = 'ledger';
  let reconciliationSearchTimer = null;
  let reconciliationNormalOpen = false;
  const reconciliationFilters = { month: '', status: 'all', direction: 'all', source: 'all', keyword: '' };
  const RECONCILIATION_STATUSES = {
    normal: { label: '正常', group: 'normal' },
    'missing-bank': { label: '缺少銀行交易', group: 'abnormal' },
    'missing-source': { label: '來源資料不存在', group: 'abnormal' },
    mismatch: { label: '金額不一致', group: 'abnormal' },
    duplicate: { label: '疑似重複入帳', group: 'abnormal' },
    'history-normal': { label: '歷史資料－金額正常', group: 'normal' },
    'history-pending': { label: '歷史紀錄', group: 'attention' }
  };

  function calendarMonth(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function normalizeMonth(value) {
    const current = businessMonth();
    const month = /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : current;
    return month > current ? current : month;
  }

  function shiftMonth(month, delta) {
    const [year, value] = normalizeMonth(month).split('-').map(Number);
    return calendarMonth(new Date(year, value - 1 + delta, 1));
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
    if (legacy) return '歷史付款';
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

  function reconciliationDifferenceNote(difference) {
    if (difference === null || difference === undefined) return '';
    const amount = Math.abs(Math.round(store.num(difference)));
    return amount ? `相差 ${money(amount)}。` : '';
  }

  function reconciliationDescription(status, row, kind, transactionCount, difference = null) {
    const fee = Math.max(0, store.num(row?.fee));
    const feeText = fee ? `手續費 ${money(fee)} 也已一併核對。` : '';
    if (status === 'normal') return `這筆${sourceDirection(kind) === 'in' ? '收款' : '付款'}已和銀行對上，金額正確。${feeText}`;
    if (status === 'history-normal') {
      if (kind === 'salary') return `這筆是舊薪資付款，薪資和銀行金額對得上。${feeText}`;
      if (['receipt', 'retention'].includes(kind)) return `這筆是舊客戶收款，收款和銀行金額對得上。${feeText}`;
      if (kind === 'payable') return `這筆是舊廠商付款，付款和銀行金額對得上。${feeText}`;
      return `這筆是舊資料，但金額和銀行紀錄對得上。${feeText}`;
    }
    if (status === 'missing-bank') return `帳務裡有這筆${sourceDirection(kind) === 'in' ? '收款' : '付款'}，但銀行紀錄裡找不到，請確認。`;
    if (status === 'missing-source') return '銀行有這筆交易，但原本的帳務資料已找不到，請人工確認。';
    if (status === 'mismatch') return `帳務金額和銀行金額不同，請確認。${reconciliationDifferenceNote(difference)}`;
    if (status === 'duplicate') return `同一筆帳務可能重複連到銀行，請確認。共找到 ${transactionCount} 筆銀行紀錄。`;
    return '歷史付款紀錄，舊系統留下的紀錄，只供查帳，不影響銀行餘額。';
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
      description: linkMismatch ? '銀行有這筆交易，但目前無法確認它對應哪筆帳務，請人工確認。' : reconciliationDescription(status, row, kind, matches.length, matches.length ? bankTotal - expected : null),
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

  function verifiedLegacyPayableTaxReconciliation(state, transaction) {
    const analyze = window.KushePayables?.historicalTaxPaymentTruth;
    if (typeof analyze !== 'function') return null;
    const transactionId = cleanId(transaction?.id);
    const matches = collection(state, 'payables').map((payable) => {
      const truth = analyze(payable, state);
      return truth?.verified && cleanId(truth.bankTransaction?.id) === transactionId ? { payable, truth } : null;
    }).filter(Boolean);
    if (matches.length !== 1) return null;
    const match = matches[0];
    const bankAmount = transactionAmount(transaction);
    return {
      ...match,
      status: Math.round(match.truth.grossAmount) === Math.round(bankAmount) ? 'history-normal' : 'mismatch',
      accountingAmount: match.truth.grossAmount,
      bankAmount
    };
  }

  function unmatchedTransactionItem(state, row) {
    const sourceType = cleanId(row.sourceType);
    const bankAmount = transactionAmount(row);
    let status = 'history-pending';
    let kind = 'history';
    let source = null;
    let description = '這筆是舊銀行紀錄，目前還無法確認原本對應哪筆帳務。';
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
        description = '這筆是舊客戶收款，收款和銀行金額對得上。';
      }
    } else if (['receipt', 'receivable_receipt', 'retention_receipt'].includes(sourceType)) {
      kind = sourceType === 'retention_receipt' ? 'retention' : 'receipt';
      status = 'missing-source';
      description = reconciliationDescription(status, row, kind, 1);
    } else if (['payable', 'payable-payment', 'payable_payment'].includes(sourceType)) {
      kind = 'payable';
      const historicalTaxPayment = verifiedLegacyPayableTaxReconciliation(state, row);
      source = historicalTaxPayment?.payable || collection(state, 'payables').find((item) => cleanId(item.id) === cleanId(row.sourceId));
      if (historicalTaxPayment) {
        status = historicalTaxPayment.status;
        accountingAmount = historicalTaxPayment.accountingAmount;
        difference = historicalTaxPayment.bankAmount - historicalTaxPayment.accountingAmount;
        description = status === 'history-normal'
          ? '這筆是舊廠商付款，材料、發票和銀行金額都對得上。'
          : `帳務金額和銀行金額不同，請確認。${reconciliationDifferenceNote(difference)}`;
      } else {
        status = 'missing-source';
        description = reconciliationDescription(status, row, kind, 1);
      }
    } else if (['payroll', 'salary_payment'].includes(sourceType)) {
      kind = 'salary';
      const legacyPayroll = verifiedLegacyPayrollReconciliation(state, row);
      source = legacyPayroll?.payroll || collection(state, 'payroll').find((item) => cleanId(item.id) === cleanId(row.payrollId || row.sourceId));
      if (!source) {
        status = 'missing-source';
        description = reconciliationDescription(status, row, kind, 1);
      } else if (!legacyPayroll || legacyPayroll.status === 'history-pending') {
        status = 'history-pending';
        description = '這筆是舊薪資付款，目前還無法確認是否和銀行對上，請人工確認。';
      } else {
        status = legacyPayroll.status;
        accountingAmount = legacyPayroll.accountingAmount;
        difference = legacyPayroll.bankAmount - legacyPayroll.accountingAmount;
        description = status === 'history-normal'
          ? '這筆是舊薪資付款，薪資和銀行金額對得上。'
          : `帳務金額和銀行金額不同，請確認。${reconciliationDifferenceNote(difference)}`;
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
    const closingLabel = view.month === businessMonth() ? '本月期末／目前餘額' : '該月底餘額';
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
        <label class="bank-month-picker"><span>查詢月份</span><input type="month" data-bank-month-input value="${esc(selectedMonth)}" max="${esc(businessMonth())}"></label>
        <button type="button" class="bank-month-button bank-month-next" data-bank-month-action="next" aria-label="下一月" ${selectedMonth >= businessMonth() ? 'disabled' : ''}><span>下一月</span> →</button>
        <button type="button" class="bank-month-today" data-bank-month-action="today" ${selectedMonth === businessMonth() ? 'disabled' : ''}>回到本月</button>
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

  function historyGroupingValue(value) {
    const text = cleanId(value);
    return text && text !== '—' ? text : '';
  }

  function isLegacyHistoryPayment(item) {
    return item.status === 'history-pending'
      && item.sourceKind === 'history'
      && item.rawSourceType === 'legacy-payment-summary';
  }

  function isValidHistoryDate(value) {
    const text = cleanId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function isGroupableHistoryPayment(item) {
    return isLegacyHistoryPayment(item)
      && isValidHistoryDate(item.date)
      && ['in', 'out'].includes(item.direction)
      && item.accountingAmount !== null
      && item.accountingAmount !== undefined
      && Number.isFinite(Number(item.accountingAmount))
      && store.num(item.accountingAmount) > 0
      && item.bankAmount === null
      && Array.isArray(item.transactionIds)
      && item.transactionIds.length === 0;
  }

  function historyGroupKey(item) {
    return [item.date, item.direction, store.num(item.accountingAmount), item.rawSourceType].join('::');
  }

  function uniqueHistoryValue(items, key) {
    const values = [...new Set(items.map((item) => historyGroupingValue(item[key])).filter(Boolean))];
    return { value: values.length === 1 ? values[0] : '', conflict: values.length > 1 };
  }

  function reconciliationDisplayModel(items) {
    const buckets = new Map();
    items.filter(isGroupableHistoryPayment).forEach((item) => {
      const key = historyGroupKey(item);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });

    const groupableBuckets = new Map();
    buckets.forEach((bucket, key) => {
      const party = uniqueHistoryValue(bucket, 'party');
      const project = uniqueHistoryValue(bucket, 'project');
      const sourceNo = uniqueHistoryValue(bucket, 'sourceNo');
      if (bucket.length > 1 && !party.conflict && !project.conflict && !sourceNo.conflict) {
        groupableBuckets.set(key, { items: bucket, party: party.value, project: project.value, sourceNo: sourceNo.value });
      }
    });

    const rows = [];
    const emitted = new Set();
    let historyGroupCount = 0;
    items.forEach((item) => {
      if (!isGroupableHistoryPayment(item)) {
        rows.push({ type: 'item', item });
        if (isLegacyHistoryPayment(item)) historyGroupCount += 1;
        return;
      }
      const key = historyGroupKey(item);
      const bucket = groupableBuckets.get(key);
      if (!bucket) {
        rows.push({ type: 'item', item });
        historyGroupCount += 1;
        return;
      }
      if (emitted.has(key)) return;
      emitted.add(key);
      const groupId = `history-group-${emitted.size}`;
      rows.push({
        type: 'history-group',
        id: groupId,
        items: bucket.items,
        item: {
          ...bucket.items[0],
          id: groupId,
          party: bucket.party,
          project: bucket.project,
          sourceNo: bucket.sourceNo
        }
      });
      historyGroupCount += 1;
    });

    return {
      rows,
      historyRecordCount: items.filter(isLegacyHistoryPayment).length,
      historyGroupCount
    };
  }

  function renderReconciliationSummary(view) {
    const cards = [
      ['需要處理', view.abnormalCount, view.abnormalCount ? '請查看下方需要確認的項目' : '目前沒有需要處理的銀行對帳問題', 'is-abnormal'],
      ['歷史紀錄', view.attentionCount, '舊系統留下的紀錄，僅供查帳', 'is-attention'],
      ['已核對正常', view.normalCount, '銀行金額已核對', 'is-normal']
    ];
    const breakdown = Object.entries(RECONCILIATION_STATUSES).map(([status, meta]) => `<div><span>${esc(meta.label)}</span><strong>${view.counts[status] || 0}</strong></div>`).join('');
    return `<section class="bank-reconciliation-summary" aria-label="銀行對帳摘要" data-normal-count="${view.normalCount}" data-attention-count="${view.attentionCount}" data-abnormal-count="${view.abnormalCount}">
      ${cards.map(([label, count, note, className]) => `<article class="${className}"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('')}
    </section>
    <details class="bank-reconciliation-breakdown-details">
      <summary>查看詳細統計 <span aria-hidden="true">▾</span></summary>
      <section class="bank-reconciliation-breakdown" aria-label="對帳狀態細分">${breakdown}</section>
    </details>`;
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
        <button type="button" data-bank-reconciliation-quick="all" class="${reconciliationFilters.status === 'all' ? 'is-active' : ''}">查看全部</button>
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

  function reconciliationStatusMarkup(item) {
    const historyRecord = item.status === 'history-pending';
    return `<div class="bank-reconciliation-status-stack">
      <span class="bank-reconciliation-status is-${esc(item.statusGroup)}${historyRecord ? ' is-history-record' : ''}">${esc(item.statusLabel)}</span>
      ${historyRecord ? '<small class="bank-reconciliation-status-note">僅供核對</small>' : ''}
    </div>`;
  }

  function reconciliationDescriptionMarkup(item) {
    const historySummary = item.status === 'history-pending' && item.rawSourceType === 'legacy-payment-summary';
    const content = historySummary
      ? '<div class="bank-reconciliation-history-copy"><strong>歷史付款紀錄</strong><small>舊系統留下的紀錄，只供查帳，不影響銀行餘額。</small></div>'
      : `<p>${esc(item.description)}</p>`;
    return `${content}${reconciliationTechnicalInfo(item)}`;
  }

  function reconciliationDirection(item) {
    return {
      text: item.direction === 'in' ? '收入' : item.direction === 'out' ? '支出' : '未辨識',
      className: item.direction === 'in' ? 'is-income' : item.direction === 'out' ? 'is-expense' : 'is-unknown'
    };
  }

  function reconciliationResultText(item) {
    if (item.status === 'normal') return '✓ 金額已對上';
    if (item.status === 'history-normal') {
      if (item.sourceKind === 'salary') return '✓ 薪資與銀行金額已對上';
      if (item.sourceKind === 'payable' && /材料、發票/.test(item.description || '')) return '✓ 材料、發票與銀行金額已對上';
      if (item.sourceKind === 'receipt' || item.sourceKind === 'retention') return '✓ 收款與銀行金額已對上';
      return '✓ 付款與銀行金額已對上';
    }
    if (item.status === 'history-pending') return '○ 僅供查帳';
    if (item.status === 'missing-bank') return '! 銀行紀錄找不到，請確認';
    if (item.status === 'missing-source') return '! 原帳務資料找不到，請確認';
    if (item.status === 'mismatch') return '! 金額不同，請確認';
    if (item.status === 'duplicate') return '! 可能重複入帳，請確認';
    return '! 請人工確認';
  }

  function reconciliationPurposeMarkup(item) {
    const direction = reconciliationDirection(item);
    return `<div class="bank-reconciliation-purpose"><strong>${esc(item.sourceLabel)}</strong><small><span class="bank-direction ${direction.className}">${esc(direction.text)}</span></small></div>`;
  }

  function reconciliationResultMarkup(item) {
    return `<div class="bank-reconciliation-result is-${esc(item.statusGroup)}"><strong>${esc(reconciliationResultText(item))}</strong>
      <details><summary>查看詳情</summary><div>${reconciliationDescriptionMarkup(item)}</div></details>
    </div>`;
  }

  function renderReconciliationItemRow(item) {
    return `<tr data-reconciliation-status="${esc(item.status)}" data-reconciliation-source="${esc(item.sourceKind)}">
      <td class="bank-date">${esc(item.date || '—')}</td>
      <td class="bank-counterparty"><strong>${esc(item.party || '—')}</strong>${item.project ? `<small>${esc(item.project)}</small>` : ''}${item.sourceNo ? `<small>${esc(item.sourceNo)}</small>` : ''}</td>
      <td>${reconciliationPurposeMarkup(item)}</td>
      <td class="num">${item.accountingAmount === null ? '—' : money(item.accountingAmount)}</td>
      <td class="num">${item.bankAmount === null ? '—' : money(item.bankAmount)}</td>
      <td>${reconciliationResultMarkup(item)}</td>
    </tr>`;
  }

  function renderHistoryGroupDetail(group) {
    const rows = group.items.map((item) => `<tr>
      <td>${esc(item.date || '—')}</td>
      <td>${esc(item.party || '—')}${item.project ? `<small>${esc(item.project)}</small>` : ''}</td>
      <td>${esc(item.sourceNo || '—')}</td>
      <td class="num">${item.accountingAmount === null ? '—' : money(item.accountingAmount)}</td>
      <td>${reconciliationTechnicalInfo(item)}</td>
    </tr>`).join('');
    return `<tr class="bank-reconciliation-group-detail" id="${esc(group.id)}-detail" data-bank-history-group-detail="${esc(group.id)}" hidden>
      <td colspan="6"><section class="bank-history-group-panel">
        <header><strong>原始 ${group.items.length} 筆歷史付款紀錄</strong><span>以下保留每筆原始內容，方便逐筆查帳。</span></header>
        <div class="bank-history-group-scroll"><table>
          <thead><tr><th>原日期</th><th>原對象／案場</th><th>原來源單號</th><th class="num">原帳務金額</th><th>技術資訊</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section></td>
    </tr>`;
  }

  function renderHistoryGroupRows(group) {
    const item = group.item;
    const count = group.items.length;
    return `<tr class="bank-reconciliation-group-row" data-reconciliation-status="${esc(item.status)}" data-reconciliation-source="${esc(item.sourceKind)}" data-bank-history-group-count="${count}">
      <td class="bank-date">${esc(item.date || '—')}</td>
      <td class="bank-counterparty"><strong>${esc(item.party || '—')}</strong>${item.project ? `<small>${esc(item.project)}</small>` : ''}${item.sourceNo ? `<small>${esc(item.sourceNo)}</small>` : ''}</td>
      <td>${reconciliationPurposeMarkup(item)}</td>
      <td class="num">${money(item.accountingAmount)}</td>
      <td class="num">—</td>
      <td><div class="bank-history-group-summary">
        <div><strong>○ 僅供查帳</strong><small>共 ${count} 筆歷史付款紀錄</small></div>
        <button type="button" data-bank-history-group-toggle="${esc(group.id)}" data-bank-history-group-count="${count}" aria-expanded="false" aria-controls="${esc(group.id)}-detail"><span data-bank-history-group-label>查看 ${count} 筆</span><span aria-hidden="true">▾</span></button>
      </div></td>
    </tr>${renderHistoryGroupDetail(group)}`;
  }

  function renderReconciliationRows(display) {
    if (!display.rows.length) return '<tr><td colspan="6" class="billing-empty">沒有符合目前篩選條件的對帳資料。</td></tr>';
    return display.rows.map((row) => row.type === 'history-group' ? renderHistoryGroupRows(row) : renderReconciliationItemRow(row.item)).join('');
  }

  function renderReconciliationTable(items, options = {}) {
    const display = reconciliationDisplayModel(items);
    return `<section class="commission-panel billing-list-panel bank-reconciliation-panel ${esc(options.className || '')}" data-history-record-count="${display.historyRecordCount}" data-history-group-count="${display.historyGroupCount}" data-display-row-count="${display.rows.length}">
      <header class="project-section-title"><div><h2>${esc(options.title || '對帳資料')}</h2>${options.note ? `<p>${esc(options.note)}</p>` : ''}</div>${options.countLabel ? `<strong class="bank-reconciliation-section-count">${esc(options.countLabel)}</strong>` : ''}</header>
      <div class="commission-table-wrap bank-reconciliation-scroll"><table class="commission-table bank-reconciliation-table bank-reconciliation-overview-table">
        <thead><tr><th>日期</th><th>對象</th><th>用途</th><th class="num">帳務金額</th><th class="num">銀行金額</th><th>核對結果</th></tr></thead>
        <tbody>${renderReconciliationRows(display)}</tbody>
      </table></div>
    </section>`;
  }

  function renderReconciliation(state, actualBalance) {
    const view = bankReconciliationView(state);
    const visibleItems = reconciliationVisibleItems(view);
    const issueStatuses = new Set(['missing-bank', 'missing-source', 'mismatch', 'duplicate']);
    const issueItems = visibleItems.filter((item) => issueStatuses.has(item.status));
    const historyItems = visibleItems.filter((item) => item.status === 'history-pending');
    const normalItems = visibleItems.filter((item) => item.status === 'normal' || item.status === 'history-normal');
    const historyDisplay = reconciliationDisplayModel(historyItems);
    const checks = view.sourceChecks;
    const issueSection = issueItems.length
      ? renderReconciliationTable(issueItems, { title: '需要處理', note: '只列出需要人工確認的銀行對帳問題。', countLabel: `共 ${issueItems.length} 筆`, className: 'is-issues' })
      : view.abnormalCount === 0
        ? `<section class="commission-panel bank-reconciliation-empty-success" data-bank-reconciliation-issues-empty="true"><strong>✓ 目前沒有需要處理的銀行對帳問題。</strong><span>收付款與銀行紀錄目前沒有發現異常</span></section>`
        : `<section class="commission-panel bank-reconciliation-empty-success is-filtered" data-bank-reconciliation-issues-filtered="true"><strong>目前篩選條件下沒有需要處理的項目。</strong><span>完整資料仍有 ${view.abnormalCount} 筆需要人工確認</span></section>`;
    const historySection = renderReconciliationTable(historyItems, {
      title: '歷史紀錄',
      note: '舊系統留下的紀錄，僅供查帳，不影響銀行餘額。',
      countLabel: historyDisplay.historyRecordCount ? `${historyDisplay.historyRecordCount} 筆紀錄，共 ${historyDisplay.historyGroupCount} 組` : '0 筆',
      className: 'is-history'
    });
    const normalSection = `<details class="bank-reconciliation-normal-section" data-bank-reconciliation-normal-section ${reconciliationNormalOpen ? 'open' : ''}>
      <summary><span><strong>已核對正常</strong><small>銀行金額已核對，平常可保持收合。</small></span><span class="bank-reconciliation-normal-action" role="button" tabindex="0" data-bank-reconciliation-normal-toggle aria-expanded="${reconciliationNormalOpen}">共 ${normalItems.length} 筆　${reconciliationNormalOpen ? '收合' : '查看'}</span></summary>
      ${renderReconciliationTable(normalItems, { title: '已核對正常明細', note: '包含一般正常資料與已驗證的歷史資料。', countLabel: `共 ${normalItems.length} 筆`, className: 'is-normal' })}
    </details>`;
    return `<section class="bank-reconciliation-heading">
      <div><h2>銀行對帳中心</h2><p>逐筆比對收付款與銀行紀錄；本頁只供查看，不會修改任何資料。</p></div>
      <span class="bank-reconciliation-current-balance">目前銀行餘額 <strong>${money(actualBalance)}</strong></span>
    </section>
    ${renderReconciliationSummary(view)}
    ${renderReconciliationFilters(view)}
    <div class="bank-reconciliation-sections" data-receipt-check-count="${checks.receiptCount}" data-payable-check-count="${checks.payablePaymentCount}" data-salary-check-count="${checks.salaryPaymentCount}" data-legacy-summary-count="${checks.legacySummaryCount}" data-visible-raw-count="${visibleItems.length}" data-history-record-count="${historyDisplay.historyRecordCount}" data-history-group-count="${historyDisplay.historyGroupCount}">
      ${issueSection}
      ${historySection}
      ${normalSection}
    </div>`;
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
    ${activeBankView === 'ledger' ? `<section class="bank-current-balance-card" aria-label="目前銀行餘額">
      <div class="bank-current-balance-amount"><span>目前銀行餘額</span><strong>${money(actualBalance)}</strong></div>
      <div class="bank-current-balance-context"><strong>${esc(accountName)}</strong><span>依目前全部銀行收支計算</span></div>
    </section>` : ''}
    ${renderBankTabs()}
    ${activeBankView === 'reconciliation' ? renderReconciliation(state, actualBalance) : renderLedger(state)}`;
    window.KusheIcons?.render(app);
  }

  function bind() {
    if (bound) return;
    const app = $('#banksApp');
    if (!app) return;
    bound = true;
    app.addEventListener('click', (event) => {
      const normalSummary = event.target.closest('[data-bank-reconciliation-normal-section] > summary');
      if (normalSummary) {
        event.preventDefault();
        if (!event.target.closest('[data-bank-reconciliation-normal-toggle]')) return;
        reconciliationNormalOpen = !reconciliationNormalOpen;
        render();
        return;
      }
      const historyGroupButton = event.target.closest('[data-bank-history-group-toggle]');
      if (historyGroupButton) {
        const groupId = historyGroupButton.dataset.bankHistoryGroupToggle;
        const detail = app.querySelector(`[data-bank-history-group-detail="${groupId}"]`);
        if (!detail) return;
        const opening = detail.hidden;
        detail.hidden = !opening;
        historyGroupButton.setAttribute('aria-expanded', String(opening));
        historyGroupButton.classList.toggle('is-expanded', opening);
        const count = historyGroupButton.dataset.bankHistoryGroupCount;
        const label = historyGroupButton.querySelector('[data-bank-history-group-label]');
        if (label) label.textContent = `${opening ? '收合' : '查看'} ${count} 筆`;
        return;
      }
      const viewButton = event.target.closest('[data-bank-view]');
      if (viewButton) {
        const nextView = viewButton.dataset.bankView === 'reconciliation' ? 'reconciliation' : 'ledger';
        if (nextView !== activeBankView) reconciliationNormalOpen = false;
        activeBankView = nextView;
        render();
        return;
      }
      const quickButton = event.target.closest('[data-bank-reconciliation-quick]');
      if (quickButton) {
        const attentionOnly = quickButton.dataset.bankReconciliationQuick === 'attention';
        reconciliationFilters.status = attentionOnly ? 'attention' : 'all';
        if (!attentionOnly) {
          reconciliationFilters.month = '';
          reconciliationFilters.direction = 'all';
          reconciliationFilters.source = 'all';
          reconciliationFilters.keyword = '';
        }
        render();
        return;
      }
      const button = event.target.closest('[data-bank-month-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.bankMonthAction;
      if (action === 'previous') selectedMonth = shiftMonth(selectedMonth, -1);
      if (action === 'next') selectedMonth = normalizeMonth(shiftMonth(selectedMonth, 1));
      if (action === 'today') selectedMonth = businessMonth();
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
    app.addEventListener('keydown', (event) => {
      const normalToggle = event.target.closest('[data-bank-reconciliation-normal-toggle]');
      if (!normalToggle || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      reconciliationNormalOpen = !reconciliationNormalOpen;
      render();
      app.querySelector('[data-bank-reconciliation-normal-toggle]')?.focus();
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
