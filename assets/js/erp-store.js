(function () {
  'use strict';
  const DB_NAME = 'KuSheERP25_Core34_DB';
  const DB_STORE = 'erp';
  const STATE_KEY = 'main';
  const EMERGENCY_KEY = 'KuSheERP25_EMERGENCY';
  let state = null;
  let db = null;

  const num = (value) => Number(value) || 0;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const monthOf = (value) => String(value || '').slice(0, 7);
  const MASTER_COLLECTIONS = ['customers','projects','vendors','materials','employees','banks'];
  const masterLabel = (row, key) => {
    const value = key === 'banks' ? (row?.name ?? row?.bank ?? row?.account ?? row?.accountName) : row?.name;
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  };
  const normalizedMasterLabel = (value) => String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('zh-Hant');
  function masterOptions(key) {
    if (!MASTER_COLLECTIONS.includes(key) || !Array.isArray(state?.[key])) return [];
    const foreignLabels = new Set();
    if (key === 'vendors') {
      ['customers','projects','materials','employees','banks'].forEach((foreignKey) => {
        (state[foreignKey] || []).forEach((row) => {
          const label = normalizedMasterLabel(masterLabel(row, foreignKey));
          if (label) foreignLabels.add(label);
        });
      });
    }
    const materialVendorIds = new Set();
    if (key === 'vendors') {
      [...(state.materials || []), ...(state.materialUsages || [])].forEach((row) => {
        const value = row?.vendor ?? row?.vendorId;
        if (typeof value === 'string' || typeof value === 'number') materialVendorIds.add(String(value));
      });
      (state.payables || []).filter((row) => /material/i.test(String(row?.sourceType || '')) || String(row?.category || '').includes('材料')).forEach((row) => {
        const value = row?.vendor ?? row?.vendorId;
        if (typeof value === 'string' || typeof value === 'number') materialVendorIds.add(String(value));
      });
    }
    const seenIds = new Set(), rows = [];
    state[key].forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const rawId = row.id;
      const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).trim() : '';
      const label = masterLabel(row, key), normalized = normalizedMasterLabel(label);
      if (!id || !normalized || seenIds.has(id)) return;
      if (key === 'vendors' && foreignLabels.has(normalized) && !materialVendorIds.has(id)) return;
      seenIds.add(id); rows.push({...row,id,name:label});
    });
    return rows;
  }
  function materialVendorOptions() {
    const foreignLabels = new Set();
    ['customers','projects','materials','employees','banks'].forEach((foreignKey) => {
      (state?.[foreignKey] || []).forEach((row) => {
        const label = normalizedMasterLabel(masterLabel(row, foreignKey));
        if (label) foreignLabels.add(label);
      });
    });
    const supplierIds = new Set(), supplierLabels = new Set();
    (Array.isArray(state?.suppliers) ? state.suppliers : []).forEach((row) => {
      const id = row?.id === undefined || row?.id === null ? '' : String(row.id).trim();
      const label = normalizedMasterLabel(row?.name ?? row?.supplierName);
      if (id) supplierIds.add(id);
      if (label) supplierLabels.add(label);
    });
    return masterOptions('vendors').filter((row) => {
      const id = String(row.id || '').trim(), label = normalizedMasterLabel(row.name);
      const type = normalizedMasterLabel(row.entityType ?? row.masterType ?? row.kind ?? row.type ?? row.role);
      const explicitlyVendor = row.isVendor === true || row.isSupplier === true || type === 'vendor' || type === 'supplier' || supplierIds.has(id) || supplierLabels.has(label);
      return explicitlyVendor || !foreignLabels.has(label);
    });
  }
  function retentionState(amount, received, current) {
    const total=num(amount),paid=num(received);
    if(total<=0)return 'no_retention';
    if(paid>=total)return 'collected';
    if(paid>0)return 'partial';
    return current==='claimable'?'claimable':'holding';
  }
  const score = (value) => ['commissions','employees','customers','projects','billings','payroll','attendance','dailyLogs'].reduce((sum, key) => sum + (Array.isArray(value?.[key]) ? value[key].length : 0), 0);
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function dbGet(key) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function dbSet(key, value) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
  function mergeQuotationUnitPresets(...sources) {
    if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) state.settings = {};
    const existing = Array.isArray(state.settings.quotationUnitPresets) ? state.settings.quotationUnitPresets : [];
    const seen = new Set(), merged = [];
    [...existing, ...sources.flat(Infinity)].forEach((value) => {
      const label = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '', key = label.toLocaleLowerCase('zh-Hant');
      if (!label || seen.has(key)) return;
      seen.add(key); merged.push(label);
    });
    state.settings.quotationUnitPresets = merged;
    return merged;
  }
  async function saveQuotationUnitPreset(value) {
    await load();
    const unit = clean(value);
    if (!unit) return false;
    const presets = Array.isArray(state.settings.quotationUnitPresets) ? state.settings.quotationUnitPresets : [], key = unit.toLocaleLowerCase('zh-Hant');
    if (presets.some((item) => clean(item).toLocaleLowerCase('zh-Hant') === key)) return false;
    const previous = [...presets];
    mergeQuotationUnitPresets(unit);
    try { await persist(`新增報價單位 ${unit}`); }
    catch (error) { state.settings.quotationUnitPresets = previous; throw error; }
    return true;
  }
  async function load() {
    if (state) return state;
    try {
      db = await openDB();
      state = await dbGet(STATE_KEY);
    } catch (_) { db = null; }
    if (!score(state)) {
      try { const emergency = JSON.parse(localStorage.getItem(EMERGENCY_KEY) || 'null'); if (score(emergency)) state = emergency; } catch (_) {}
    }
    if (!score(state)) state = window.KuSheLegacyData?.getState() || window.KUSHE_PHASE1_BACKUP || {};
    ['commissions','employees','customers','projects','vendors','materials','materialUsages','projectCosts','billings','receivables','payables','invoices','receipts','retentionReceipts','payments','salaryPayments','banks','bankTransactions','payroll','attendance','dailyLogs','dailyItemPresets','quotations','quotationPrices','quotationTemplates','audit'].forEach((key) => { if (!Array.isArray(state[key])) state[key] = []; });
    if (!state.settings) state.settings = {};
    if (!state.meta) state.meta = {};
    state.quotations.forEach((quote) => {
      if (!quote.number) quote.number = `Q-${String(quote.date || '').replaceAll('-','') || 'LEGACY'}`;
      if (!['草稿','已送出','已確認','作廢'].includes(quote.status)) quote.status = '草稿';
      if (!quote.publicNote) quote.publicNote = quote.note || '';
      if (!quote.internalNote) quote.internalNote = '';
      if (!Array.isArray(quote.lines)) quote.lines = [];
      quote.lines.forEach((line) => {
        if (!line.id) line.id = uid();
        if (line.subtotal === undefined) line.subtotal = num(line.qty) * num(line.price);
        if (!line.priceSource) line.priceSource = 'legacy';
      });
    });
    if (!state.meta.quotationPriceMigrated && state.projectItemPrices && typeof state.projectItemPrices === 'object') {
      Object.entries(state.projectItemPrices).forEach(([key, price], index) => {
        const split = key.indexOf('::'), projectKey = split >= 0 ? key.slice(0, split) : '', item = split >= 0 ? key.slice(split + 2) : key;
        const project = state.projects.find((row) => String(row.id) === projectKey || sameName(row.name, projectKey));
        if (!project || !item || num(price) < 0) return;
        const exists = state.quotationPrices.some((row) => row.scope === 'project' && row.projectId === project.id && sameName(row.item,item));
        if (!exists) state.quotationPrices.push({id:`legacy-price-${index}-${project.id}`,scope:'project',customerId:project.customer||'',projectId:project.id,item,unit:'',price:num(price),effectiveDate:'2000-01-01',createdSource:'legacy-project-price',createdAt:project.createdAt||new Date().toISOString()});
      });
      state.meta.quotationPriceMigrated = true;
    }
    mergeQuotationUnitPresets('式', state.quotationPrices.map((row) => row.unit), state.quotations.flatMap((quote) => (quote.lines || []).map((line) => line.unit)));
    state.dailyLogs.forEach((log) => {
      const billable = log.billable !== false && !log.noInvoice && (num(log.groupTotal) > 0 || num(log.performance) > 0 || (log.items || []).some((item) => num(item.qty) * num(item.price) > 0));
      if (log.billable === undefined) log.billable = billable;
      if (billable && !log.billingStatus) log.billingStatus = log.billingId ? '已請款' : '未請款';
      if (!log.billingId) log.billingId = '';
      (log.items || []).forEach((item) => {
        if (!item.workItemId) item.workItemId = uid();
        if (item.billable === undefined) item.billable = billable;
        if (item.billable && !item.billingStatus) item.billingStatus = log.billingId ? '已請款' : '未請款';
        if (!item.billingId) item.billingId = log.billingId || '';
        if (!item.taxMode) item.taxMode = '未稅';
        if (item.inputPrice === undefined) item.inputPrice = num(item.price);
        if (item.untaxedSubtotal === undefined) item.untaxedSubtotal = num(item.qty) * num(item.price);
        if (item.subtotal === undefined) item.subtotal = item.taxMode === '含稅' ? grossFromUntaxed(item.untaxedSubtotal) : item.untaxedSubtotal;
      });
    });
    state.billings.forEach((billing) => {
      if (billing.grossTotal === undefined) billing.grossTotal = num(billing.amount) + num(billing.tax);
      if (billing.retentionRate === undefined) billing.retentionRate = 0;
      if (billing.retentionReceived === undefined) billing.retentionReceived = 0;
      if (billing.retentionAmount === undefined) billing.retentionAmount = num(billing.retention);
      if (billing.preTaxAmount === undefined) billing.preTaxAmount = num(billing.amount);
      if (billing.taxAmount === undefined) billing.taxAmount = num(billing.tax);
      if (billing.taxIncludedAmount === undefined) billing.taxIncludedAmount = num(billing.grossTotal);
      if (billing.retentionEnabled === undefined) billing.retentionEnabled = num(billing.retention) > 0;
      billing.retentionStatus = retentionState(billing.retention,billing.retentionReceived,billing.retentionStatus);
      if (!['no_invoice','invoice_pending','invoiced'].includes(billing.invoiceStatus)) billing.invoiceStatus = billing.invoiceNo ? 'invoiced' : (billing.sourceType === 'daily-work' && billing.hasInvoice === false ? 'no_invoice' : 'invoice_pending');
      billing.hasInvoice = billing.invoiceStatus !== 'no_invoice';
      if (!Array.isArray(billing.sourceItemRefs)) billing.sourceItemRefs = [];
      if (!Array.isArray(billing.sourceContractRefs)) billing.sourceContractRefs = [];
      const receivable = state.receivables.find((row) => row.billingId === billing.id || String(row.sourceNo||'') === String(billing.number||''));
      if (receivable && !receivable.billingId) receivable.billingId = billing.id;
      if (receivable && !billing.receivableId) billing.receivableId = receivable.id;
      if (receivable) {
        if (receivable.retentionAmount === undefined) receivable.retentionAmount = num(receivable.retention ?? billing.retention);
        if (receivable.retentionReceived === undefined) receivable.retentionReceived = num(billing.retentionReceived);
        receivable.remainingRetention = Math.max(0,num(receivable.retentionAmount)-num(receivable.retentionReceived));
        receivable.retentionStatus = retentionState(receivable.retention ?? billing.retention,receivable.retentionReceived,receivable.retentionStatus || billing.retentionStatus);
      }
      if (billing.invoiceStatus === 'no_invoice' && Array.isArray(billing.lines) && billing.lines.length) {
        const totals = calculateBilling({lines:billing.lines,taxMode:billing.taxMode,invoiceStatus:'no_invoice',retentionMode:billing.retentionMode,retentionRate:billing.retentionRate,retentionCustom:billing.retentionMode==='custom'?billing.retention:undefined});
        if (!receivable || num(receivable.received) <= totals.receivable) {
          Object.assign(billing,{amount:totals.untaxed,tax:0,grossTotal:totals.grossTotal,retention:totals.retention,total:totals.receivable});
          if (receivable) Object.assign(receivable,{taxMode:billing.taxMode,untaxedAmount:totals.untaxed,tax:0,grossTotal:totals.grossTotal,retention:totals.retention,amount:totals.receivable,status:num(receivable.received)>=totals.receivable&&totals.receivable>0?'已收':num(receivable.received)>0?'部分收款':'未收'});
        }
      }
    });
    state.receipts.forEach((receipt) => {
      if (receipt.fee === undefined) receipt.fee = 0;
      const historicalTransaction = state.bankTransactions.find((row) => row.sourceId === receipt.id && ['receipt','receivable_receipt'].includes(row.sourceType));
      const historicalNet = receipt.netAmount !== undefined ? num(receipt.netAmount) : historicalTransaction ? num(historicalTransaction.amount) : undefined;
      if (!receipt.feePayer) receipt.feePayer = historicalNet !== undefined && historicalNet === num(receipt.amount) ? 'counterparty' : 'company';
      if (receipt.netAmount === undefined) receipt.netAmount = historicalNet ?? Math.max(0, num(receipt.amount) - num(receipt.fee));
      if (!receipt.paymentMethod) receipt.paymentMethod = '銀行轉帳';
      if (!receipt.bankAccountId && receipt.bankId) receipt.bankAccountId = receipt.bankId;
      if (!receipt.bankId && receipt.bankAccountId) receipt.bankId = receipt.bankAccountId;
      if (!receipt.bankTransactionId) {
        if (historicalTransaction) receipt.bankTransactionId = historicalTransaction.id;
      }
    });
    state.retentionReceipts.forEach((receipt) => {
      if (!receipt.retentionReceiptId) receipt.retentionReceiptId = receipt.id || uid();
      if (!receipt.id) receipt.id = receipt.retentionReceiptId;
      receipt.amount = Math.max(0,Math.round(num(receipt.amount)));
      if (!receipt.bankAccountId && receipt.bankId) receipt.bankAccountId = receipt.bankId;
      if (!receipt.bankId && receipt.bankAccountId) receipt.bankId = receipt.bankAccountId;
      if (receipt.fee === undefined) receipt.fee = 0;
      const historicalTransaction = state.bankTransactions.find((row) => row.sourceId === receipt.id && row.sourceType === 'retention_receipt');
      const historicalNet = receipt.netAmount !== undefined ? num(receipt.netAmount) : historicalTransaction ? num(historicalTransaction.amount) : undefined;
      if (!receipt.feePayer) receipt.feePayer = historicalNet !== undefined && historicalNet === num(receipt.amount) ? 'counterparty' : 'company';
      if (receipt.netAmount === undefined) receipt.netAmount = historicalNet ?? Math.max(0,num(receipt.amount)-num(receipt.fee));
      if (!receipt.paymentMethod) receipt.paymentMethod = '銀行轉帳';
      if (!receipt.bankTransactionId) {
        if (historicalTransaction) receipt.bankTransactionId = historicalTransaction.id;
      }
    });
    state.receivables.forEach((receivable) => {
      if (receivable.legacyReceived === undefined) {
        const recordedReceipts=state.receipts.filter((row)=>row.receivableId===receivable.id).reduce((sum,row)=>sum+num(row.amount),0);
        receivable.legacyReceived=Math.max(0,num(receivable.received)-recordedReceipts);
      }
      const billing=state.billings.find((row)=>row.id===receivable.billingId||String(row.number||'')===String(receivable.sourceNo||''));
      const retentionAmount=num(receivable.retentionAmount ?? receivable.retention ?? billing?.retentionAmount ?? billing?.retention);
      const recorded=state.retentionReceipts.filter((row)=>row.receivableId===receivable.id||row.billingId&&row.billingId===receivable.billingId).reduce((sum,row)=>sum+num(row.amount),0);
      if (receivable.legacyRetentionReceived === undefined) receivable.legacyRetentionReceived=Math.max(0,Math.max(num(receivable.retentionReceived),num(billing?.retentionReceived))-recorded);
      const received=Math.min(retentionAmount,num(receivable.legacyRetentionReceived)+recorded);
      receivable.retentionAmount=retentionAmount;receivable.retentionReceived=received;receivable.remainingRetention=Math.max(0,retentionAmount-received);receivable.retentionStatus=retentionState(retentionAmount,received,receivable.retentionStatus);
      if(billing){billing.retentionAmount=num(billing.retentionAmount ?? billing.retention);billing.retentionReceived=received;billing.remainingRetention=Math.max(0,billing.retentionAmount-received);billing.retentionStatus=retentionState(billing.retentionAmount,received,billing.retentionStatus)}
    });
    state.payables.forEach((payable, index) => {
      if (!payable.payableNo) payable.payableNo = payable.number || `AP-${String(payable.date || '').replaceAll('-','') || 'LEGACY'}-${String(index + 1).padStart(3,'0')}`;
      if (!payable.category) payable.category = /material|inventory/i.test(payable.sourceType || '') ? '材料採購' : '廠商款項';
      if (!payable.item) payable.item = payable.description || payable.sourceNo || payable.note || '';
      if (!payable.dueDate) payable.dueDate = '';
      if (!payable.sourceId) payable.sourceId = Array.isArray(payable.usageIds) && payable.usageIds.length ? payable.usageIds.join(',') : payable.id;
      payable.paid = Math.min(Math.max(0,num(payable.paid)),Math.max(0,num(payable.amount)));
      payable.status = payable.paid >= num(payable.amount) && num(payable.amount) > 0 ? '已付清' : payable.paid > 0 ? '部分付款' : '未付款';
      const hasHistory = state.payments.some((payment) => payment.payableId === payable.id);
      if (payable.paid > 0 && !hasHistory) {
        const tx = state.bankTransactions.find((row) => row.id === payable.paymentTransactionId || (row.sourceType === 'payable' && row.sourceId === payable.id));
        state.payments.push({id:`legacy-${payable.id}`,idempotencyKey:`legacy-${payable.id}`,payableId:payable.id,date:payable.payDate||tx?.date||payable.date||'',amount:payable.paid,fee:num(payable.fee),actualDebit:num(tx?.amount)||payable.paid,bankId:payable.bankId||tx?.bankId||'',paymentMethod:payable.paymentMethod||'銀行轉帳',feePayer:payable.feeParty==='公司負擔'?'company':'recipient',note:payable.note||'',bankTransactionId:tx?.id||payable.paymentTransactionId||'',legacy:true,createdAt:payable.updatedAt||payable.createdAt||new Date().toISOString()});
      }
    });
    state.payments.forEach((payment) => {
      if (!payment.bankAccountId && payment.bankId) payment.bankAccountId=payment.bankId;
      if (!payment.bankId && payment.bankAccountId) payment.bankId=payment.bankAccountId;
      if (!payment.bankTransactionId) {
        const transaction=state.bankTransactions.find((row)=>row.sourceId===payment.id&&['payable-payment','payable_payment'].includes(row.sourceType));
        if(transaction)payment.bankTransactionId=transaction.id;
      }
    });
    state.salaryPayments.forEach((payment) => {
      if (!payment.bankAccountId && payment.bankId) payment.bankAccountId=payment.bankId;
      if (!payment.bankId && payment.bankAccountId) payment.bankId=payment.bankAccountId;
      if (payment.fee === undefined) payment.fee=0;
      const historicalTransaction=state.bankTransactions.find((row)=>row.sourceType==='salary_payment'&&row.sourceId===payment.id);
      const historicalDebit=payment.actualDebit!==undefined?num(payment.actualDebit):historicalTransaction?num(historicalTransaction.amount):undefined;
      if (!payment.feePayer) payment.feePayer=historicalDebit!==undefined&&historicalDebit===num(payment.amount)?'recipient':'company';
      if (payment.actualDebit === undefined) payment.actualDebit=historicalDebit??num(payment.amount);
      if (!payment.bankTransactionId) {
        if(historicalTransaction)payment.bankTransactionId=historicalTransaction.id;
      }
    });
    state.payables.filter((payable) => Array.isArray(payable.usageIds)).forEach((payable) => {
      payable.usageIds.forEach((usageId) => {
        const usage = state.materialUsages.find((row) => String(row.id) === String(usageId));
        if (usage && !usage.payableId) usage.payableId = payable.id;
      });
    });
    state.billings.filter((billing)=>['daily-work','mixed-pricing'].includes(billing.sourceType)).forEach((billing)=>{
      (billing.sourceItemRefs||[]).filter((ref)=>ref.sourceGroupKey).forEach((ref)=>availableSourceCopies(ref).forEach(({log,item})=>{item.billingStatus='已請款';item.billingId=billing.id;item.billingNo=billing.number||'';syncLogBillingState(log)}));
    });
    return state;
  }
  function payrollNet(p) {
    return num(p.baseSalary)+num(p.commission)+num(p.fuel)+num(p.meal)+num(p.other)+num(p.overtime)+num(p.bonus)+num(p.allowance)-num(p.advance)-num(p.laborInsurance)-num(p.incomeTax)-num(p.deduction);
  }
  const PAID_PAYROLL_SOURCE_ERROR = '此施工紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。';
  const PAID_COMMISSION_SOURCE_ERROR = '此抽成紀錄已納入已付款薪資，為保留歷史帳務不可修改或刪除。';
  const DAILY_LOG_COMMISSION_ERROR = '每日施工衍生抽成必須由每日施工來源調整，不可直接修改或刪除。';
  function payrollHistoryLock(employeeId, dateOrMonth) {
    const employee=String(employeeId||''),month=monthOf(dateOrMonth);
    if(!employee||!month)return {locked:false,reason:'',payrollIds:[],salaryPaymentIds:[],bankTransactionIds:[]};
    const payrollRows=(state?.payroll||[]).filter((row)=>String(row.employee||row.employeeId||'')===employee&&monthOf(row.month)===month);
    if(!payrollRows.length)return {locked:false,reason:'',payrollIds:[],salaryPaymentIds:[],bankTransactionIds:[]};
    const truth=payrollPaymentTruth({employee,month,recordIds:payrollRows.map((row)=>row.id),total:Math.max(0,...payrollRows.map((row)=>num(row.total)))});
    return {locked:truth.hasVerifiedPayment,reason:truth.explicitPayments.length?'salary-payment':truth.verifiedLegacyTransactions.length?'salary-bank-transaction':'',payrollIds:truth.recordIds,salaryPaymentIds:truth.explicitPayments.map((row)=>String(row.id)),bankTransactionIds:truth.bankTransactionIds};
  }
  function rebuildPayrollFor(month, employee) {
    if (!month || !employee) return;
    const atts = state.attendance.filter((x) => monthOf(x.date) === month && x.employee === employee);
    const comms = state.commissions.filter((x) => monthOf(x.date) === month && x.employee === employee && x.status === '已列入薪資');
    let payroll = state.payroll.find((x) => x.month === month && x.employee === employee && x.status !== '已付款');
    if (!payroll) {
      payroll = {id:uid(),month,employee,days:0,baseSalary:0,commission:0,fuel:0,meal:0,other:0,overtime:0,bonus:0,allowance:0,advance:0,laborInsurance:0,incomeTax:0,deduction:0,total:0,payDate:'',bankId:'',paymentTransactionId:'',paidAt:'',status:'未付款',note:'由請款單、抽成與點工自動彙整',createdAt:new Date().toISOString()};
      state.payroll.unshift(payroll);
    }
    payroll.days = atts.reduce((sum, x) => sum + num(x.days), 0);
    payroll.hours = atts.reduce((sum, x) => sum + num(x.hours), 0);
    payroll.baseSalary = atts.reduce((sum, x) => sum + num(x.amount), 0);
    payroll.fuel = atts.reduce((sum, x) => sum + num(x.fuel), 0);
    payroll.commission = comms.reduce((sum, x) => sum + num(x.commission), 0);
    payroll.total = payrollNet(payroll);
    payroll.updatedAt = new Date().toISOString();
    const otherValues = ['fuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'].some((key) => num(payroll[key]));
    if (!atts.length && !comms.length && !otherValues && payroll.status !== '已付款') state.payroll = state.payroll.filter((x) => x.id !== payroll.id);
  }
  async function persist(action) {
    state.meta.updatedAt = new Date().toISOString();
    if (action) {
      state.audit.unshift({ id: uid(), time: new Date().toISOString(), action });
      state.audit = state.audit.slice(0, 300);
    }
    if (!db) { try { db = await openDB(); } catch (_) { db = null; } }
    if (db) await dbSet(STATE_KEY, state);
    localStorage.setItem(EMERGENCY_KEY, JSON.stringify(state));
    window.KuSheLegacyData?.refresh();
    window.dispatchEvent(new CustomEvent('kushe:data-updated', { detail: { action } }));
  }
  function taxValues(gross) {
    const rate = num(state.settings.defaultTax) || 5;
    const total = Math.max(0, num(gross));
    const untaxed = Math.round(total / (1 + rate / 100));
    return { total, untaxed, tax: total - untaxed, rate };
  }
  function grossFromUntaxed(untaxed) {
    const value = Math.max(0, num(untaxed));
    return value + Math.round(value * (num(state.settings.defaultTax) || 5) / 100);
  }
  function dailyWorkAmount(log) {
    if (!log || log.isPrimaryWork === false || log.workMode === 'none') return 0;
    return Math.round(num(log.workQty) * num(log.workRate));
  }
  function dailyLogHasPayrollSource(log) {
    if (!log) return false;
    const sourceId=String(log.id||''),linkedAttendance=sourceId?(state.attendance||[]).filter((row)=>row.sourceType==='daily-log'&&String(row.sourceId||'')===sourceId):[],linkedCommissions=sourceId?(state.commissions||[]).filter((row)=>row.sourceType==='daily-log'&&String(row.sourceId||'')===sourceId):[];
    return dailyWorkAmount(log)>0||num(log.commission)>0||Math.round(num(log.performance)*num(log.rate)/100)>0||linkedAttendance.some((row)=>num(row.amount)>0||num(row.fuel)>0)||linkedCommissions.some((row)=>num(row.commission)>0);
  }
  function dailyLogPayrollDeleteLock(log) {
    const history=payrollHistoryLock(log?.employee,log?.date),hasPayrollSource=dailyLogHasPayrollSource(log);
    return {...history,locked:hasPayrollSource&&history.locked,historyLocked:history.locked,hasPayrollSource};
  }
  function syncDailyLogLinks(log, oldLog = null) {
    const pairs = [];
    if (oldLog?.employee) pairs.push([monthOf(oldLog.date), oldLog.employee]);
    if (log?.employee) pairs.push([monthOf(log.date), log.employee]);
    state.commissions = state.commissions.filter((row) => !(row.sourceType === 'daily-log' && row.sourceId === log.id));
    state.attendance = state.attendance.filter((row) => !(row.sourceType === 'daily-log' && row.sourceId === log.id));
    const now = new Date().toISOString();
    if (num(log.performance) > 0) {
      state.commissions.unshift({id:uid(),date:log.date,employee:log.employee,employeeName:log.employeeName||'',customer:log.customer||'',project:log.project,projectName:log.projectName||'',sourceNo:log.billingNo||'每日業績',sourceType:'daily-log',sourceId:log.id,untaxedAmount:num(log.performance),rate:num(log.rate),commission:Math.round(num(log.performance)*num(log.rate)/100),status:'已列入薪資',note:`每日業績：${log.note||''}`,createdAt:now,updatedAt:now});
    }
    const workAmount = dailyWorkAmount(log);
    if (workAmount > 0) {
      state.attendance.unshift({id:uid(),date:log.date,employee:log.employee,employeeName:log.employeeName||'',customer:log.customer||'',project:log.project,projectName:log.projectName||'',sourceNo:log.billingNo||'每日點工',sourceType:'daily-log',sourceId:log.id,workMode:log.workMode,days:log.workMode==='daily'?num(log.workQty):0,hours:log.workMode==='hourly'?num(log.workQty):0,dailyRate:num(log.workRate),hourlyRate:log.workMode==='hourly'?num(log.workRate):0,amount:workAmount,fuel:0,status:'已列入薪資',note:`每日點工：${log.note||''}`,createdAt:now,updatedAt:now});
    }
    const seen = new Set();
    pairs.forEach(([month, employee]) => { const key = `${month}__${employee}`; if (month && employee && !seen.has(key)) { seen.add(key); rebuildPayrollFor(month, employee); } });
  }
  function batchRows(batchId) {
    return state.dailyLogs.filter((log) => (log.batchId || log.id) === batchId);
  }
  const pricingModes = ['actual','lump_sum','mixed'];
  function pricingMode(value) { return pricingModes.includes(value) ? value : ''; }
  function pricingTypeFor(quote, line) {
    const mode=pricingMode(quote?.pricingMode);
    if(mode==='mixed')return line?.pricingType==='lump_sum'?'lump_sum':'actual';
    return mode;
  }
  function confirmedQuoteForProject(projectId) {
    return [...state.quotations].filter((row)=>row.status==='已確認'&&String(row.project)===String(projectId)&&pricingMode(row.pricingMode)).sort((a,b)=>String(b.date||b.updatedAt||'').localeCompare(String(a.date||a.updatedAt||'')))[0]||null;
  }
  function projectPricingMode(projectId) {
    const quote=confirmedQuoteForProject(projectId),project=state.projects.find((row)=>String(row.id)===String(projectId));
    return pricingMode(quote?.pricingMode)||pricingMode(project?.defaultPricingMode);
  }
  function contractSources(quote) {
    const mode=pricingMode(quote?.pricingMode);if(!quote||!['lump_sum','mixed'].includes(mode))return [];
    if(mode==='lump_sum')return [{contractKey:`${quote.id}:contract`,quotationId:quote.id,quotationNo:quote.number||'',quotationLineId:'',item:'總價承攬',unit:'式',contractAmount:Math.max(0,num(quote.lumpSumTotal??quote.amount)),pricingType:'lump_sum'}];
    return (quote.lines||[]).filter((line)=>pricingTypeFor(quote,line)==='lump_sum').map((line)=>({contractKey:`${quote.id}:${line.id}`,quotationId:quote.id,quotationNo:quote.number||'',quotationLineId:line.id,item:line.item||'總價工程',unit:line.unit||'式',contractAmount:Math.max(0,num(line.lumpSumAmount??line.subtotal)),pricingType:'lump_sum'}));
  }
  function billedContractAmount(contractKey) {
    return state.billings.reduce((sum,billing)=>sum+(billing.sourceContractRefs||[]).filter((ref)=>ref.contractKey===contractKey).reduce((part,ref)=>part+num(ref.billingAmount),0),0);
  }
  function contractSourceByKey(contractKey) {
    for(const quote of state.quotations){const found=contractSources(quote).find((source)=>source.contractKey===contractKey);if(found)return {...found,quote};}return null;
  }
  function unbilledWork(filters = {}) {
    const groups = new Map();
    state.dailyLogs.forEach((log) => {
      if (filters.month && monthOf(log.date) !== filters.month) return;
      if (filters.customer && String(log.customer || '') !== String(filters.customer)) return;
      if (filters.project && String(log.project || '') !== String(filters.project)) return;
      const groupKey = log.groupId || log.id;
      if (!groups.has(groupKey)) groups.set(groupKey, { logs: [], items: new Map() });
      const group = groups.get(groupKey); group.logs.push(log);
      (log.items || []).forEach((item, index) => {
        const status = item.billingStatus || log.billingStatus || (log.billingId ? '已請款' : '未請款');
        const billable = item.billable !== false && log.billable !== false && !log.noInvoice;
        if (!billable || item.pricingType==='lump_sum' || status !== '未請款' || item.billingId) return;
        const itemKey = `${groupKey}:${index}`;
        if (!group.items.has(itemKey)) group.items.set(itemKey, { item, index, groupKey });
      });
    });
    const projects = new Map();
    groups.forEach((group) => {
      if (!group.items.size) return;
      const first = group.logs[0] || {};
      const project = state.projects.find((row) => String(row.id) === String(first.project)) || {};
      const customerId = first.customer || project.customer || '';
      const customer = state.customers.find((row) => String(row.id) === String(customerId)) || {};
      const key = `${customerId}__${first.project || first.projectName || ''}`;
      if (!projects.has(key)) projects.set(key, {key,customerId,customerName:customer.name||first.customerName||project.customerName||'未指定客戶',projectId:first.project||'',projectName:project.name||first.projectName||'未指定案場',pricingMode:projectPricingMode(first.project),amount:0,actualAmount:0,contractAmount:0,count:0,dates:[],details:[],contractDetails:[]});
      const target = projects.get(key);
      const employees = [...new Set(group.logs.map((log) => state.employees.find((row) => row.id === log.employee)?.name || log.employeeName).filter(Boolean))].join('、') || '—';
      group.items.forEach(({item,index,groupKey}) => {
        const amount = num(item.untaxedSubtotal) || num(item.qty) * num(item.price);
        target.amount += amount; target.actualAmount += amount; target.count += 1; target.dates.push(first.date || '');
        target.details.push({sourceType:'daily-work',pricingType:'actual',quotationId:item.quotationId||'',quotationLineId:item.quotationLineId||'',date:first.date||'',employees,item:item.item||'',unit:item.unit||'式',price:num(item.price),inputPrice:num(item.inputPrice??item.price),qty:num(item.qty),subtotal:amount,grossSubtotal:num(item.subtotal)||amount,taxMode:item.taxMode||'未稅',note:first.note||'',workItemId:item.workItemId||'',sourceGroupKey:groupKey,sourceItemIndex:index,dailyLogIds:group.logs.map((log)=>log.id)});
      });
    });
    state.quotations.filter((quote)=>quote.status==='已確認'&&['lump_sum','mixed'].includes(pricingMode(quote.pricingMode))).forEach((quote)=>{
      if(filters.customer&&String(quote.customer)!==String(filters.customer))return;if(filters.project&&String(quote.project)!==String(filters.project))return;
      const project=state.projects.find((row)=>String(row.id)===String(quote.project))||{},customer=state.customers.find((row)=>String(row.id)===String(quote.customer||project.customer))||{},key=`${quote.customer||project.customer||''}__${quote.project||project.name||''}`;
      const sources=contractSources(quote).map((source)=>{const billedAmount=billedContractAmount(source.contractKey),remainingAmount=Math.max(0,source.contractAmount-billedAmount);return {...source,billedAmount,remainingAmount,date:quote.date||''};}).filter((source)=>source.remainingAmount>0);
      if(!sources.length)return;
      if(!projects.has(key))projects.set(key,{key,customerId:quote.customer||project.customer||'',customerName:quote.customerName||customer.name||project.customerName||'未指定客戶',projectId:quote.project||'',projectName:quote.projectName||project.name||'未指定案場',pricingMode:pricingMode(quote.pricingMode),amount:0,actualAmount:0,contractAmount:0,count:0,dates:[],details:[],contractDetails:[]});
      const target=projects.get(key);sources.forEach((source)=>{target.contractDetails.push(source);target.contractAmount+=source.remainingAmount;target.amount+=source.remainingAmount;target.count+=1;target.dates.push(source.date)});
    });
    return [...projects.values()].map((row) => ({...row,earliest:row.dates.filter(Boolean).sort()[0]||'—',latest:row.dates.filter(Boolean).sort().at(-1)||'—'})).sort((a,b) => String(a.earliest).localeCompare(String(b.earliest)));
  }
  async function saveDailyBatch(values, editingBatchId = '') {
    await load();
    const previous = editingBatchId ? batchRows(editingBatchId) : [];
    if (previous.some((log) => log.billingId || (log.billingStatus && log.billingStatus !== '未請款'))) throw new Error('已進入請款流程的施工紀錄不可直接修改');
    const date = values.date;
    const employeeIds = values.employeeIds || [];
    if ([...previous.map((log)=>[log.employee,log.date]),...employeeIds.map((employeeId)=>[employeeId,date])].some(([employeeId,workDate])=>payrollHistoryLock(employeeId,workDate).locked)) throw new Error(PAID_PAYROLL_SOURCE_ERROR);
    previous.forEach((log) => syncDailyLogLinks({...log,performance:0,workMode:'none'}, log));
    if (previous.length) state.dailyLogs = state.dailyLogs.filter((log) => (log.batchId || log.id) !== editingBatchId);
    const lines = (values.lines || []).filter((line) => line.project && line.item && num(line.qty) > 0);
    if (!employeeIds.length || !lines.length) throw new Error('請至少選擇一位員工並填寫一筆施工項目');
    const prepared = lines.map((line) => {
      const project=state.projects.find((row)=>String(row.id)===String(line.project))||{};
      const quotationId=line.quotationId||line.quoteId||'',quotationLineId=line.quotationLineId||line.quoteLineId||'';
      const quoteItem=quotationId&&quotationLineId
        ? confirmedQuotationItems(line.project,project.customer).find((item)=>String(item.quotationId)===String(quotationId)&&String(item.quotationLineId)===String(quotationLineId))
        : null;
      if((line.sourceType==='quotation'||quotationId||quotationLineId)&&!quoteItem)throw new Error('選取的報價項目已失效，請重新選擇已確認報價項目');
      const type=quoteItem?.pricingType||(line.pricingType==='lump_sum'?'lump_sum':'actual');
      const qty=num(line.qty),inputPrice=quoteItem?(type==='actual'?num(quoteItem.price):num(quoteItem.lumpSumAmount)):num(line.inputPrice);
      const gross=type==='actual'?qty*inputPrice:0,taxMode=quoteItem?.taxMode||line.taxMode||'未稅';
      const untaxedSubtotal=taxMode==='含稅'?Math.round(gross/(1+(num(state.settings.defaultTax)||5)/100)):gross;
      const billable=type==='actual'&&line.billable!==false;
      return {...line,item:quoteItem?.item||line.item,itemName:quoteItem?.item||line.item,unit:quoteItem?.unit||line.unit,qty,inputPrice,unitPrice:inputPrice,price:qty&&type==='actual'?untaxedSubtotal/qty:0,subtotal:gross,untaxedSubtotal,taxMode,pricingType:type,sourceType:quoteItem?'quotation':'manual',quotationId:quoteItem?.quotationId||'',quotationLineId:quoteItem?.quotationLineId||'',quoteId:quoteItem?.quotationId||'',quoteLineId:quoteItem?.quotationLineId||'',quotationNo:quoteItem?.quotationNo||'',lumpSumAmount:num(quoteItem?.lumpSumAmount),workItemId:line.workItemId||uid(),billable,billingStatus:billable?'未請款':'',billingId:''};
    });
    const byProject = new Map();
    prepared.forEach((line) => { if (!byProject.has(line.project)) byProject.set(line.project, []); byProject.get(line.project).push(line); });
    const batchId = editingBatchId || uid(), now = new Date().toISOString();
    employeeIds.forEach((employeeId) => {
      const employee = state.employees.find((row) => row.id === employeeId) || {};
      const hasDaily = state.dailyLogs.some((row) => row.employee === employeeId && row.date === date && row.workMode === 'daily' && row.isPrimaryWork !== false);
      let firstProject = true;
      byProject.forEach((projectLines, projectId) => {
        const project = state.projects.find((row) => row.id === projectId) || {};
        const customer = state.customers.find((row) => row.id === project.customer) || {};
        const total = projectLines.reduce((sum, line) => sum + num(line.untaxedSubtotal), 0);
        const billableTotal = projectLines.filter((line) => line.billable).reduce((sum, line) => sum + num(line.untaxedSubtotal), 0);
        const canAddWork = firstProject && !(values.workMode === 'daily' && hasDaily);
        const performance = values.commissionEnabled === false ? 0 : total;
        const workMode = canAddWork ? values.workMode : 'none';
        const log = {id:uid(),batchId,groupId:`${batchId}:${projectId}`,date,employee:employeeId,employeeName:employee.name||'',customer:project.customer||'',customerName:customer.name||project.customerName||'',project:projectId,projectName:project.name||'',payType:performance>0&&workMode!=='none'?'業績抽成／點工':performance>0?'業績抽成':'點工',items:projectLines.map((line)=>({...line})),groupTotal:total,grossTotal:projectLines.reduce((sum,line)=>sum+num(line.subtotal),0),billingTotal:billableTotal,billable:billableTotal>0,billingStatus:billableTotal>0?'未請款':'',billingId:'',billingNo:'',performance,rate:num(employee.commissionRate),commission:Math.round(performance*num(employee.commissionRate)/100),workMode,workQty:canAddWork?num(values.workQty):0,workRate:canAddWork?num(values.workRate):0,isPrimaryWork:canAddWork,note:values.note||'',createdAt:previous[0]?.createdAt||now,updatedAt:now};
        state.dailyLogs.unshift(log); syncDailyLogLinks(log); firstProject = false;
      });
    });
    state.dailyItemPresets = state.dailyItemPresets || [];
    prepared.filter((line)=>line.sourceType==='manual').forEach((line) => { const existing = state.dailyItemPresets.find((row) => String(row.projectId||'') === String(line.project||'') && String(row.item||'').trim() === String(line.item||'').trim()); const preset={projectId:line.project,item:line.item,unit:line.unit||'式',qty:line.qty,inputPrice:line.inputPrice,price:line.inputPrice,taxMode:line.taxMode||'未稅',pricingType:line.pricingType||'actual',updatedAt:now}; if(existing)Object.assign(existing,preset);else state.dailyItemPresets.push({id:uid(),...preset}); });
    await persist(`${previous.length?'修改':'新增'}多案場每日施工紀錄`);
    return batchId;
  }
  async function deleteDailyBatch(batchId) {
    await load(); const rows = batchRows(batchId); if (!rows.length) return false;
    if (rows.some((log) => log.billingId || (log.billingStatus && log.billingStatus !== '未請款'))) throw new Error('已進入請款流程的施工紀錄不可刪除');
    if (rows.some((log)=>dailyLogPayrollDeleteLock(log).locked)) throw new Error(PAID_PAYROLL_SOURCE_ERROR);
    rows.forEach((log) => {
      if(dailyLogHasPayrollSource(log))return syncDailyLogLinks({...log,performance:0,workMode:'none'},log);
      const sourceId=String(log.id||'');if(!sourceId)return;
      state.commissions=state.commissions.filter((row)=>!(row.sourceType==='daily-log'&&String(row.sourceId||'')===sourceId));
      state.attendance=state.attendance.filter((row)=>!(row.sourceType==='daily-log'&&String(row.sourceId||'')===sourceId));
    });
    state.dailyLogs = state.dailyLogs.filter((log) => (log.batchId || log.id) !== batchId);
    await persist('刪除多案場每日施工紀錄'); return true;
  }
  function dailyManualItems(projectId) {
    if(!projectId)return [];
    const items=new Map(),remember=(row,date='')=>{const name=clean(row.itemName||row.item);if(!name)return;const key=name.toLocaleLowerCase('zh-Hant'),candidate={projectId,item:name,itemName:name,unit:clean(row.unit)||'式',price:num(row.inputPrice??row.unitPrice??row.price),unitPrice:num(row.inputPrice??row.unitPrice??row.price),taxMode:row.taxMode||'未稅',pricingType:row.pricingType==='lump_sum'?'lump_sum':'actual',sourceType:'manual',updatedAt:row.updatedAt||date||''},current=items.get(key);if(!current||String(candidate.updatedAt)>=String(current.updatedAt))items.set(key,candidate)};
    state.dailyLogs.filter((log)=>String(log.project)===String(projectId)).forEach((log)=>(log.items||[]).filter((item)=>!item.quotationId&&!item.quoteId&&item.sourceType!=='quotation').forEach((item)=>remember(item,log.updatedAt||log.date)));
    state.dailyItemPresets.filter((row)=>String(row.projectId||'')===String(projectId)).forEach((row)=>remember(row,row.updatedAt));
    return [...items.values()].sort((a,b)=>a.item.localeCompare(b.item,'zh-Hant'));
  }
  async function saveCommission(values, id) {
    await load();
    const existing = id ? state.commissions.find((x) => x.id === id) : null;
    if (existing?.sourceType === 'daily-log') {
      if (payrollHistoryLock(existing.employee,existing.date).locked) throw new Error(PAID_COMMISSION_SOURCE_ERROR);
      throw new Error(DAILY_LOG_COMMISSION_ERROR);
    }
    if ([[existing?.employee,existing?.date],[values.employee,values.date]].some(([employeeId,date])=>employeeId&&payrollHistoryLock(employeeId,date).locked)) throw new Error(PAID_COMMISSION_SOURCE_ERROR);
    const before = existing ? { date: existing.date, employee: existing.employee } : null;
    const row = existing || { id: uid(), createdAt: new Date().toISOString() };
    Object.assign(row, {
      date: values.date,
      employee: values.employee,
      project: values.project,
      sourceNo: values.sourceNo || '',
      untaxedAmount: num(values.untaxedAmount),
      rate: num(values.rate),
      commission: Math.round(num(values.untaxedAmount) * num(values.rate) / 100),
      status: values.status === '已列入薪資' ? '已列入薪資' : '未列入薪資',
      note: values.note || '',
      updatedAt: new Date().toISOString()
    });
    if (!existing) state.commissions.unshift(row);
    if (before?.employee) rebuildPayrollFor(monthOf(before.date), before.employee);
    rebuildPayrollFor(monthOf(row.date), row.employee);
    await persist(`${existing ? '修改' : '新增'}員工業績抽成`);
    return row;
  }
  async function deleteCommission(id) {
    await load();
    const row = state.commissions.find((x) => x.id === id);
    if (!row) return false;
    if (payrollHistoryLock(row.employee,row.date).locked) throw new Error(PAID_COMMISSION_SOURCE_ERROR);
    if (row.sourceType === 'daily-log') throw new Error(DAILY_LOG_COMMISSION_ERROR);
    state.commissions = state.commissions.filter((x) => x.id !== id);
    rebuildPayrollFor(monthOf(row.date), row.employee);
    await persist('刪除員工業績抽成');
    return true;
  }
  function nextBillingNumber(date) {
    const compact = String(date || new Date().toISOString().slice(0,10)).replaceAll('-','');
    const prefix = `B${compact}-`;
    const max = state.billings.reduce((value, row) => {
      const number = String(row.number || '');
      return number.startsWith(prefix) ? Math.max(value, num(number.slice(prefix.length))) : value;
    }, 0);
    return `${prefix}${String(max + 1).padStart(3,'0')}`;
  }
  function calculateBilling(values = {}) {
    const rate = num(state.settings.defaultTax) || 5;
    const constructionAmount = Math.round((values.lines || []).reduce((sum, line) => sum + num(line.qty) * num(line.price), 0));
    const taxMode = values.taxMode === '含稅' ? '含稅' : '未稅';
    const noInvoice = values.invoiceStatus === 'no_invoice';
    const untaxed = noInvoice ? constructionAmount : taxMode === '含稅' ? Math.round(constructionAmount / (1 + rate / 100)) : constructionAmount;
    const tax = noInvoice ? 0 : taxMode === '含稅' ? constructionAmount - untaxed : Math.round(untaxed * rate / 100);
    const grossTotal = noInvoice ? constructionAmount : taxMode === '含稅' ? constructionAmount : untaxed + tax;
    const retentionMode = values.retentionMode || 'none';
    const retentionRate = retentionMode === '5' ? 5 : retentionMode === '10' ? 10 : retentionMode === 'custom' ? num(values.retentionRate) : 0;
    const retentionBase = values.retentionBase === 'preTax' ? 'preTax' : 'taxIncluded';
    const retentionBaseAmount = retentionBase === 'preTax' ? untaxed : grossTotal;
    const retention = retentionMode === 'custom' && num(values.retentionCustom) > 0
      ? Math.max(0, Math.round(num(values.retentionCustom)))
      : Math.max(0, Math.round(retentionBaseAmount * retentionRate / 100));
    return { constructionAmount, untaxed, tax, grossTotal, retention: Math.min(retention, grossTotal), retentionRate, retentionBase, retentionBaseAmount, receivable: Math.max(0, grossTotal - retention), rate, taxMode };
  }
  function sourceMatches(ref, log, item, index) {
    const groupKey = log.groupId || log.id;
    if (ref.sourceGroupKey && ref.sourceGroupKey !== groupKey) return false;
    if (ref.sourceItemIndex !== undefined && ref.sourceItemIndex !== null) return num(ref.sourceItemIndex) === index;
    return Boolean(ref.workItemId) && ref.workItemId === item.workItemId;
  }
  function availableSourceCopies(ref) {
    const rows = [];
    state.dailyLogs.forEach((log) => (log.items || []).forEach((item,index) => {
      if (sourceMatches(ref,log,item,index)) rows.push({log,item,index});
    }));
    return rows;
  }
  function syncLogBillingState(log) {
    const billable = (log.items || []).filter((item) => item.billable !== false);
    const billed = billable.filter((item) => item.billingStatus === '已請款' && item.billingId);
    const ids = [...new Set(billed.map((item) => item.billingId).filter(Boolean))];
    log.billingIds = ids;
    log.billingId = ids[0] || '';
    log.billingNo = ids.length ? (state.billings.find((row) => row.id === ids[0])?.number || '') : '';
    log.billingStatus = billable.length && billed.length === billable.length ? '已請款' : '未請款';
    log.updatedAt = new Date().toISOString();
  }
  function billingInvoiceStatus(billing) {
    if (['no_invoice','invoice_pending','invoiced'].includes(billing?.invoiceStatus)) return billing.invoiceStatus;
    if (String(billing?.invoiceNo || '').trim()) return 'invoiced';
    return billing?.hasInvoice === false ? 'no_invoice' : 'invoice_pending';
  }
  function invoiceStatus(value, number = '') {
    const status=String(value||'').trim().toLowerCase();
    if (['void','作廢','取消'].includes(status)) return 'void';
    if (['issued','invoiced','已開票','已開發票'].includes(status) || String(number||'').trim()) return 'issued';
    return 'pending';
  }
  function invoiceAmounts(taxMode, value) {
    const mode=taxMode==='含稅'?'含稅':'未稅',amount=Math.max(0,Math.round(num(value)));
    if(mode==='含稅'){const result=taxValues(amount);return {taxMode:mode,netAmount:result.untaxed,taxAmount:result.tax,grossAmount:result.total}}
    const gross=grossFromUntaxed(amount);return {taxMode:mode,netAmount:amount,taxAmount:gross-amount,grossAmount:gross};
  }
  function billingInvoiceRecord(billing) {
    return state.invoices.find((row)=>String(row.sourceType||'')==='billing'&&String(row.sourceId||'')===String(billing.id))
      || state.invoices.find((row)=>String(row.billingId||'')===String(billing.id))
      || state.invoices.find((row)=>String(row.sourceNo||'')===String(billing.number||'')&&/請款單/.test(String(row.note||'')));
  }
  function syncBillingInvoiceRecord(billing, now, overrides={}) {
    const billingStatus=billingInvoiceStatus(billing),existing=billingInvoiceRecord(billing);
    if(billingStatus==='no_invoice'&&!existing)return null;
    const row=existing||{id:uid(),invoiceId:'',createdAt:now};
    if(!existing)state.invoices.unshift(row);
    const number=billingStatus==='no_invoice'?String(row.invoiceNumber||row.number||'').trim():String(overrides.invoiceNumber??billing.invoiceNo??'').trim();
    const status=billingStatus==='no_invoice'?'void':invoiceStatus(overrides.status,billingStatus==='invoiced'?number:'');
    Object.assign(row,{invoiceId:row.invoiceId||row.id,invoiceType:'output',type:'銷項',invoiceNumber:number,number,invoiceDate:overrides.invoiceDate??billing.invoiceDate??billing.date,date:overrides.invoiceDate??billing.invoiceDate??billing.date,customerId:billing.customer||'',customer:billing.customer||'',vendorId:'',projectId:billing.project||'',project:billing.project||'',party:billing.customerName||'',projectName:billing.projectName||'',sourceType:'billing',sourceId:billing.id,billingId:billing.id,sourceNo:billing.number||'',taxMode:billing.taxMode||'未稅',netAmount:num(billing.preTaxAmount??billing.amount),taxAmount:num(billing.taxAmount??billing.tax),grossAmount:num(billing.taxIncludedAmount??billing.grossTotal)||num(billing.amount)+num(billing.tax),amount:num(billing.preTaxAmount??billing.amount),tax:num(billing.taxAmount??billing.tax),total:num(billing.taxIncludedAmount??billing.grossTotal)||num(billing.amount)+num(billing.tax),status,note:overrides.note===undefined?(row.note&&!/由新版請款單自動串聯/.test(row.note)?row.note:(billing.note||'由新版請款單自動串聯')):String(overrides.note||''),updatedAt:now});
    return row;
  }
  function legacyInvoicePayable(row) {
    const directId=String(row.sourceId||row.payableId||'').trim();
    if(directId){
      const direct=state.payables.find((item)=>String(item.id)===directId)||null;
      if(direct){
        const invoiceVendor=normalizedMasterLabel(row.party||row.vendorName||state.vendors.find((vendor)=>String(vendor.id)===String(row.vendorId||row.vendor))?.name),payableVendor=normalizedMasterLabel(direct.vendorName||state.vendors.find((vendor)=>vendor.id===direct.vendor)?.name);
        const invoiceAmount=num(row.netAmount??row.amount),payableAmount=num(direct.amount),invoiceSourceNo=String(row.sourceNo||'').trim(),payableSourceNos=[direct.payableNo,direct.sourceNo].map((value)=>String(value||'').trim()).filter(Boolean);
        const vendorConflict=Boolean(invoiceVendor&&payableVendor&&invoiceVendor!==payableVendor),amountConflict=Boolean(invoiceAmount>0&&payableAmount>0&&invoiceAmount!==payableAmount),sourceConflict=Boolean(/^AP-/i.test(invoiceSourceNo)&&payableSourceNos.some((value)=>/^AP-/i.test(value))&&!payableSourceNos.includes(invoiceSourceNo));
        if(!vendorConflict&&!amountConflict&&!sourceConflict)return direct;
      }
    }
    if(!/進項/.test(String(row.type||''))&&row.invoiceType!=='input')return null;
    const party=normalizedMasterLabel(row.party||row.vendorName),sourceNo=String(row.sourceNo||'').trim(),amount=num(row.netAmount??row.amount);
    if(!party||!sourceNo||amount<=0)return null;
    const matches=state.payables.filter((item)=>normalizedMasterLabel(item.vendorName||state.vendors.find((vendor)=>vendor.id===item.vendor)?.name)===party&&[item.payableNo,item.sourceNo].some((value)=>String(value||'').trim()===sourceNo)&&num(item.amount)===amount);
    return matches.length===1?matches[0]:null;
  }
  function normalizedInvoice(row) {
    const type=row.invoiceType||(/進項/.test(String(row.type||''))?'input':'output'),billing=type==='output'?state.billings.find((item)=>String(item.id)===String(row.sourceId||row.billingId||'')):null,payable=type==='input'?legacyInvoicePayable(row):null;
    const number=String(row.invoiceNumber??row.number??'').trim(),date=row.invoiceDate||row.date||billing?.date||payable?.date||'',net=num(row.netAmount??row.amount),tax=num(row.taxAmount??row.tax),gross=num(row.grossAmount??row.total)||(net+tax);
    return {...row,id:row.id||row.invoiceId,invoiceId:row.invoiceId||row.id,invoiceType:type,invoiceNumber:number,invoiceDate:date,customerId:row.customerId||row.customer||billing?.customer||'',vendorId:row.vendorId||row.vendor||payable?.vendor||'',projectId:row.projectId||row.project||billing?.project||payable?.project||'',sourceType:type==='input'?(payable?'payable':'legacy_invoice'):(row.sourceType||(row.billingId?'billing':'legacy_invoice')),sourceId:type==='input'?(payable?.id||''):(row.sourceId||row.billingId||row.payableId||''),taxMode:row.taxMode||billing?.taxMode||'未稅',netAmount:net,taxAmount:tax,grossAmount:gross,status:invoiceStatus(row.status,number),party:row.party||billing?.customerName||payable?.vendorName||'',projectName:row.projectName||billing?.projectName||payable?.projectName||'',sourceNo:row.sourceNo||billing?.number||payable?.payableNo||''};
  }
  function invoiceRows() {
    const rows=state.invoices.map(normalizedInvoice),keys=new Set(rows.filter((row)=>row.sourceId).map((row)=>`${row.sourceType}:${row.sourceId}`));
    state.billings.forEach((billing)=>{if(billingInvoiceStatus(billing)==='no_invoice')return;const key=`billing:${billing.id}`;if(keys.has(key))return;rows.push(normalizedInvoice({id:`pending-${billing.id}`,invoiceType:'output',invoiceNumber:billing.invoiceNo||'',invoiceDate:billing.invoiceDate||billing.date,customerId:billing.customer,projectId:billing.project,party:billing.customerName,projectName:billing.projectName,sourceType:'billing',sourceId:billing.id,billingId:billing.id,sourceNo:billing.number,taxMode:billing.taxMode,netAmount:billing.preTaxAmount??billing.amount,taxAmount:billing.taxAmount??billing.tax,grossAmount:billing.taxIncludedAmount??billing.grossTotal,status:billingInvoiceStatus(billing)==='invoiced'?'issued':'pending',note:billing.note||'',virtual:true}));keys.add(key)});
    state.payables.filter((payable)=>!/salary|payroll/i.test(String(payable.sourceType||''))).forEach((payable)=>{const key=`payable:${payable.id}`;if(keys.has(key))return;const amounts=invoiceAmounts('未稅',payable.amount);rows.push(normalizedInvoice({id:`pending-${payable.id}`,invoiceType:'input',invoiceDate:new Date().toISOString().slice(0,10),vendorId:payable.vendor,projectId:payable.project,party:payable.vendorName,projectName:payable.projectName,sourceType:'payable',sourceId:payable.id,payableId:payable.id,sourceNo:payable.payableNo||payable.sourceNo,taxMode:amounts.taxMode,...amounts,status:'pending',note:payable.note||'',virtual:true}));keys.add(key)});
    return rows;
  }
  async function saveInvoice(values,id='') {
    await load();const now=new Date().toISOString(),type=values.invoiceType==='input'?'input':'output',status=invoiceStatus(values.status,values.invoiceNumber),number=String(values.invoiceNumber||'').trim();
    if(status==='issued'&&!number)throw new Error('已開票狀態必須輸入發票號碼');
    if(type==='output'){
      const billing=state.billings.find((row)=>String(row.id)===String(values.sourceId||values.billingId));if(!billing)throw new Error('找不到來源請款單');
      billing.invoiceStatus=status==='issued'?'invoiced':'invoice_pending';billing.hasInvoice=true;billing.invoiceNo=status==='issued'?number:'';billing.invoiceDate=values.invoiceDate||billing.date;billing.updatedAt=now;
      const receivable=state.receivables.find((row)=>row.id===billing.receivableId||row.billingId===billing.id);if(receivable){receivable.invoiceNo=billing.invoiceNo;receivable.updatedAt=now}
      const invoice=syncBillingInvoiceRecord(billing,now,{invoiceNumber:number,invoiceDate:values.invoiceDate||billing.date,status,note:values.note});if(status==='void')invoice.status='void';await persist(`更新銷項發票 ${billing.number}`);return invoice;
    }
    const payable=state.payables.find((row)=>String(row.id)===String(values.sourceId||values.payableId));if(!payable)throw new Error('找不到來源應付帳款');
    const existing=state.invoices.find((row)=>String(row.id)===String(id))||state.invoices.find((row)=>String(row.sourceType||'')==='payable'&&String(row.sourceId||row.payableId||'')===String(payable.id));
    const row=existing||{id:uid(),invoiceId:'',createdAt:now},amounts=invoiceAmounts(values.taxMode,values.amount);
    if(!existing)state.invoices.unshift(row);
    Object.assign(row,{invoiceId:row.invoiceId||row.id,invoiceType:'input',type:'進項',invoiceNumber:number,number,invoiceDate:values.invoiceDate||payable.date||now.slice(0,10),date:values.invoiceDate||payable.date||now.slice(0,10),customerId:'',vendorId:payable.vendor||'',vendor:payable.vendor||'',projectId:payable.project||'',project:payable.project||'',party:payable.vendorName||'',projectName:payable.projectName||'',sourceType:'payable',sourceId:payable.id,payableId:payable.id,sourceNo:payable.payableNo||payable.sourceNo||'',...amounts,amount:amounts.netAmount,tax:amounts.taxAmount,total:amounts.grossAmount,status,note:String(values.note||''),updatedAt:now});
    await persist(`${existing?'更新':'新增'}進項發票 ${row.sourceNo}`);return row;
  }
  async function createBilling(values) {
    await load();
    const sourceRefs = (values.sourceItemRefs || []).filter(Boolean);
    const sourceContractRefs=(values.sourceContractRefs||[]).filter((ref)=>ref&&ref.contractKey&&num(ref.billingAmount)>0);
    if (!sourceRefs.length&&!sourceContractRefs.length) throw new Error('請至少選擇一筆施工紀錄或總價進度款');
    const canonical = [];
    sourceRefs.forEach((ref) => {
      const copies = availableSourceCopies(ref);
      if (!copies.length) throw new Error('找不到施工來源，請重新開啟請款草稿');
      if (copies.some(({item}) => item.billingStatus !== '未請款' || item.billingId)) throw new Error('部分施工紀錄已被請款，請重新整理後再試');
      canonical.push({ref,copies});
    });
    const canonicalContracts=sourceContractRefs.map((ref)=>{const source=contractSourceByKey(ref.contractKey);if(!source)throw new Error('找不到總價報價來源，請重新開啟請款草稿');const billed=billedContractAmount(ref.contractKey),available=Math.max(0,source.contractAmount-billed),amount=Math.round(num(ref.billingAmount));if(amount<=0)throw new Error('總價進度請款金額必須大於 0');if(amount>available)throw new Error(`${source.item} 累計請款不可超過合約總價`);return {...ref,quotationId:source.quotationId,quotationLineId:source.quotationLineId,contractKey:source.contractKey,item:source.item,contractAmount:source.contractAmount,priorBilled:billed,billingAmount:amount,pricingType:'lump_sum'};});
    const date = values.date || new Date().toISOString().slice(0,10);
    const number = String(values.number || '').trim() || nextBillingNumber(date);
    if (state.billings.some((row) => String(row.number||'').trim() === number)) throw new Error('請款單號已存在');
    const totals = calculateBilling(values), now = new Date().toISOString(), id = uid();
    const billing = {
      id, date, number, customer:values.customer||'', customerName:values.customerName||'', project:values.project||'', projectName:values.projectName||'',
      billingMonth:values.billingMonth||monthOf(date), periodStart:values.periodStart||'', periodEnd:values.periodEnd||'', taxMode:totals.taxMode,
      lines:(values.lines||[]).map((line)=>({...line,qty:num(line.qty),price:num(line.price),subtotal:Math.round(num(line.qty)*num(line.price)),sourceRefs:(line.sourceRefs||[]).map((ref)=>({...ref}))})),
      amount:totals.untaxed, tax:totals.tax, grossTotal:totals.grossTotal, preTaxAmount:totals.untaxed, taxAmount:totals.tax, taxIncludedAmount:totals.grossTotal,
      retention:totals.retention, retentionAmount:totals.retention, retentionRate:totals.retentionRate, retentionBase:totals.retentionBase, retentionEnabled:totals.retention>0,
      retentionMode:values.retentionMode||'none', retentionReceived:0, remainingRetention:totals.retention, retentionStatus:retentionState(totals.retention,0), total:totals.receivable,
      invoiceStatus:values.invoiceStatus==='no_invoice'?'no_invoice':String(values.invoiceNo||'').trim()?'invoiced':'invoice_pending',
      hasInvoice:values.invoiceStatus!=='no_invoice', invoiceNo:values.invoiceStatus==='no_invoice'?'':String(values.invoiceNo||'').trim(), invoiceDate:values.invoiceStatus==='no_invoice'?'':values.invoiceDate||'', status:'未收款', note:values.note||'',
      sourceType:sourceRefs.length&&canonicalContracts.length?'mixed-pricing':canonicalContracts.length?'quotation-progress':'daily-work', sourceItemRefs:sourceRefs.map((ref)=>({...ref})),sourceContractRefs:canonicalContracts.map((ref)=>({...ref})), createdAt:now, updatedAt:now
    };
    const receivable = {id:uid(),billingId:id,date,customer:billing.customer,customerName:billing.customerName,project:billing.project,projectName:billing.projectName,sourceNo:number,invoiceNo:billing.invoiceNo,taxMode:billing.taxMode,untaxedAmount:billing.amount,tax:billing.tax,grossTotal:billing.grossTotal,preTaxAmount:billing.preTaxAmount,taxAmount:billing.taxAmount,taxIncludedAmount:billing.taxIncludedAmount,retention:billing.retention,retentionAmount:billing.retentionAmount,retentionRate:billing.retentionRate,retentionBase:billing.retentionBase,retentionEnabled:billing.retentionEnabled,retentionReceived:0,remainingRetention:billing.retentionAmount,retentionStatus:billing.retentionStatus,amount:billing.total,received:0,bankId:'',receiptDate:'',dueDate:values.dueDate||'',status:'未收',note:'由新版請款單自動建立',createdAt:now,updatedAt:now};
    billing.receivableId = receivable.id;
    state.billings.unshift(billing); state.receivables.unshift(receivable);
    if(values.saveProjectRetentionDefault){const project=state.projects.find((row)=>row.id===billing.project);if(project){project.defaultRetentionMode=totals.retention>0?(values.retentionMode||'none'):'none';project.defaultRetentionRate=totals.retention>0?totals.retentionRate:0;project.defaultRetentionAmount=values.retentionMode==='custom'?num(values.retentionCustom):0;project.defaultRetentionBase=totals.retentionBase;project.updatedAt=now}}
    if (billing.invoiceStatus !== 'no_invoice') syncBillingInvoiceRecord(billing,now);
    canonical.forEach(({copies}) => copies.forEach(({log,item}) => { item.billingStatus='已請款'; item.billingId=id; item.billingNo=number; syncLogBillingState(log); }));
    await persist(`建立新版請款單 ${number}`);
    return billing;
  }
  function billingReceivable(billing) {
    if (!billing) return null;
    const direct=state.receivables.filter((row)=>String(row.id)===String(billing.receivableId||'')||String(row.billingId||'')===String(billing.id));
    if(direct.length)return direct.length===1?direct[0]:null;
    const legacy=state.receivables.filter((row)=>String(row.sourceNo||'')===String(billing.number||''));
    return legacy.length===1?legacy[0]:null;
  }
  function billingInvoiceRecords(billing) {
    if(!billing)return [];
    return state.invoices.filter((row)=>String(row.billingId||'')===String(billing.id)||(String(row.sourceType||'')==='billing'&&String(row.sourceId||'')===String(billing.id))||(!row.billingId&&!row.sourceId&&String(row.sourceNo||'')===String(billing.number||'')&&/請款單|新版請款/.test(String(row.note||''))));
  }
  function billingSafety(id) {
    if(!state)return {editable:false,deletable:false,reason:'資料尚未載入',billing:null,receivable:null};
    const billing=typeof id==='object'&&id?id:state.billings.find((row)=>String(row.id)===String(id));
    if(!billing)return {editable:false,deletable:false,reason:'找不到請款單',billing:null,receivable:null};
    const receivable=billingReceivable(billing);
    if(!receivable)return {editable:false,deletable:false,reason:'找不到唯一對應應收帳款',billing,receivable:null};
    const receipts=state.receipts.filter((row)=>String(row.receivableId||'')===String(receivable.id)||String(row.billingId||'')===String(billing.id));
    const retentionReceipts=state.retentionReceipts.filter((row)=>String(row.receivableId||'')===String(receivable.id)||String(row.billingId||'')===String(billing.id));
    const receiptIds=new Set([...receipts,...retentionReceipts].flatMap((row)=>[row.id,row.retentionReceiptId]).filter(Boolean).map(String));
    const bankLinked=state.bankTransactions.some((row)=>String(row.billingId||'')===String(billing.id)||String(row.receivableId||'')===String(receivable.id)||[String(billing.id),String(receivable.id)].includes(String(row.sourceId||''))||receiptIds.has(String(row.sourceId||''))||receiptIds.has(String(row.receiptId||''))||receiptIds.has(String(row.retentionReceiptId||''))||(String(row.sourceNo||'')===String(billing.number||'')&&/receipt|receivable|retention|收款|應收|保留/i.test(`${row.sourceType||''} ${row.category||''}`)));
    const issuedInvoice=billingInvoiceStatus(billing)==='invoiced'||Boolean(String(billing.invoiceNo||'').trim())||billingInvoiceRecords(billing).some((row)=>invoiceStatus(row.status,row.invoiceNumber||row.number)==='issued'||Boolean(String(row.invoiceNumber||row.number||'').trim()));
    let reason='';
    if(receipts.length)reason='已有一般收款紀錄';
    else if(retentionReceipts.length)reason='已有保留款收回紀錄';
    else if(num(receivable.received)>0||num(receivable.legacyReceived)>0)reason='對應應收已有收款';
    else if(bankLinked)reason='已有關聯銀行入帳交易';
    else if(issuedInvoice)reason='已正式開立發票';
    return {editable:!reason,deletable:!reason,reason,billing,receivable,receipts,retentionReceipts,bankLinked,issuedInvoice};
  }
  function billingEditable(id) { return billingSafety(id).editable; }
  function billingSourceRefs(billing) { return billing?[...(billing.sourceItemRefs||[]),...(billing.lines||[]).flatMap((line)=>line.sourceRefs||[])]:[]; }
  function billingSourcesResolvable(billing) { return billingSourceRefs(billing).every((ref)=>availableSourceCopies(ref).length>0); }
  function billingDeletable(id) { const safety=billingSafety(id);return safety.deletable&&billingSourcesResolvable(safety.billing); }
  const accountingDeleteToken=Symbol('accounting-delete');
  function receivableBillingCandidates(receivable) {
    if(!receivable)return [];
    const direct=state.billings.filter((row)=>String(row.id)===String(receivable.billingId||'')||String(row.receivableId||'')===String(receivable.id));
    if(direct.length)return direct;
    return state.billings.filter((row)=>String(row.number||'')===String(receivable.sourceNo||''));
  }
  function receiptBankTransactions(receipt) {
    const id=String(receipt?.id||''),transactionId=String(receipt?.bankTransactionId||'');
    return state.bankTransactions.filter((row)=>(transactionId&&String(row.id)===transactionId)||(id&&String(row.sourceId||'')===id&&['receipt','receivable_receipt'].includes(row.sourceType)));
  }
  function retentionBankTransactions(receipt) {
    const id=String(receipt?.id||''),transactionId=String(receipt?.bankTransactionId||'');
    return state.bankTransactions.filter((row)=>(transactionId&&String(row.id)===transactionId)||(id&&String(row.sourceId||'')===id&&row.sourceType==='retention_receipt'));
  }
  function accountingDeletionPreflight(receivableId) {
    const receivable=state.receivables.find((row)=>String(row.id)===String(receivableId));
    if(!receivable)throw new Error('找不到應收帳款');
    const billings=receivableBillingCandidates(receivable);
    if(billings.length!==1)throw new Error('找不到唯一 Billing／Receivable 關係，為避免誤刪已停止');
    const billing=billings[0];
    if(billingReceivable(billing)!==receivable)throw new Error('找不到唯一 Billing／Receivable 關係，為避免誤刪已停止');
    const invoiceRecords=[...new Set([...billingInvoiceRecords(billing),...state.invoices.filter((row)=>String(row.receivableId||'')===String(receivable.id))])],billingStatus=billingInvoiceStatus(billing),billingInvoiceNumber=String(billing.invoiceNo||'').trim(),issuedInvoice=billingStatus==='invoiced'||billingStatus!=='no_invoice'&&Boolean(billingInvoiceNumber)||invoiceRecords.some((row)=>invoiceStatus(row.status,row.invoiceNumber||row.invoiceNo||row.number)==='issued');
    if(issuedInvoice)throw new Error('此筆已正式開立發票，為保留正式帳務不可直接刪除。');
    const receipts=state.receipts.filter((row)=>String(row.receivableId||'')===String(receivable.id)||String(row.billingId||'')===String(billing.id)),retentionReceipts=state.retentionReceipts.filter((row)=>String(row.receivableId||'')===String(receivable.id)||String(row.billingId||'')===String(billing.id));
    if(receipts.some((row)=>row.receivableId&&String(row.receivableId)!==String(receivable.id)||row.billingId&&String(row.billingId)!==String(billing.id))||retentionReceipts.some((row)=>row.receivableId&&String(row.receivableId)!==String(receivable.id)||row.billingId&&String(row.billingId)!==String(billing.id)))throw new Error('收款與請款關聯不一致，為避免帳務斷鏈已停止刪除。');
    if(num(receivable.legacyReceived)>0||num(receivable.legacyRetentionReceived)>0)throw new Error('存在無法逐筆解析的歷史收款，為避免帳務斷鏈已停止刪除。');
    const dailyRefs=billingSourceRefs(billing),contractRefs=[...(billing.sourceContractRefs||[]),...(billing.lines||[]).flatMap((line)=>line.sourceContractRefs||[])],requiresDailySource=['daily-work','mixed-pricing'].includes(String(billing.sourceType||''));
    if((requiresDailySource&&!dailyRefs.length)||dailyRefs.some((ref)=>!availableSourceCopies(ref).length)||contractRefs.some((ref)=>!ref?.contractKey||!contractSourceByKey(ref.contractKey))||!dailyRefs.length&&!contractRefs.length)throw new Error('找不到完整施工來源，為避免帳務斷鏈已停止刪除。');
    const receiptTransactions=receipts.map((receipt)=>{const matches=receiptBankTransactions(receipt);if(matches.length!==1)throw new Error('一般收款的銀行交易關係不完整，為避免帳務斷鏈已停止刪除。');return matches[0]}),retentionTransactions=retentionReceipts.map((receipt)=>{const matches=retentionBankTransactions(receipt);if(matches.length!==1)throw new Error('保留款收回的銀行交易關係不完整，為避免帳務斷鏈已停止刪除。');return matches[0]}),transactions=[...receiptTransactions,...retentionTransactions],transactionIds=new Set(transactions.map((row)=>String(row.id)));
    if(transactionIds.size!==transactions.length)throw new Error('銀行交易重複關聯多筆收款，為避免帳務斷鏈已停止刪除。');
    if(transactions.some((row)=>!state.banks.some((bank)=>String(bank.id)===String(row.bankAccountId||row.bankId||''))))throw new Error('找不到收款對應銀行帳戶，為避免帳務斷鏈已停止刪除。');
    const receiptIds=new Set([...receipts,...retentionReceipts].flatMap((row)=>[row.id,row.retentionReceiptId]).filter(Boolean).map(String)),linkedTransactions=state.bankTransactions.filter((row)=>String(row.billingId||'')===String(billing.id)||String(row.receivableId||'')===String(receivable.id)||[String(billing.id),String(receivable.id)].includes(String(row.sourceId||''))||receiptIds.has(String(row.sourceId||''))||receiptIds.has(String(row.receiptId||''))||receiptIds.has(String(row.retentionReceiptId||''))||(String(row.sourceNo||'')===String(billing.number||'')&&/receipt|receivable|retention|收款|應收|保留/i.test(`${row.sourceType||''} ${row.category||''}`)));
    if(linkedTransactions.some((row)=>!transactionIds.has(String(row.id))))throw new Error('存在無法對應收款紀錄的銀行交易，為避免帳務斷鏈已停止刪除。');
    return {receivable,billing,receipts,retentionReceipts,transactions,invoiceRecords,dailyRefs,contractRefs};
  }
  function accountingDeletionSummary(plan) {
    const {receivable,billing,receipts,retentionReceipts,transactions}=plan;
    return {receivableId:receivable.id,billingId:billing.id,billingNo:billing.number||receivable.sourceNo||'',customerName:billing.customerName||receivable.customerName||'',projectName:billing.projectName||receivable.projectName||'',billingDate:billing.date||receivable.date||'',grossTotal:num(billing.grossTotal??receivable.grossTotal??billing.total??receivable.amount),receiptCount:receipts.length,retentionReceiptCount:retentionReceipts.length,bankTransactionCount:transactions.length};
  }
  async function receivableAccountingDeletePreview(receivableId) { await load();return accountingDeletionSummary(accountingDeletionPreflight(receivableId)); }
  function normalizedBillingLineInput(value, label) {
    const raw=String(value??'').trim(),number=Number(raw);
    if(raw===''||!Number.isFinite(number)||number<0)throw new Error(`${label}必須是 0 以上的數字`);
    return number;
  }
  async function updateBilling(id, values={}) {
    await load();
    const safety=billingSafety(id);if(!safety.billing)throw new Error('找不到請款單');if(!safety.editable)throw new Error(`此請款已鎖定：${safety.reason}`);
    const billing=safety.billing,receivable=safety.receivable,number=String(values.number??billing.number??'').trim();
    if(!number)throw new Error('請輸入請款單號');
    if(state.billings.some((row)=>row!==billing&&String(row.number||'').trim()===number))throw new Error('請款單號已存在');
    const inputs=Array.isArray(values.lines)?values.lines:[];
    if(inputs.length!==(billing.lines||[]).length)throw new Error('請款明細來源數量不一致，請重新開啟編輯');
    const contractAmounts=new Map(),normalizedLines=(billing.lines||[]).map((line,index)=>{
      const input=inputs[index]||{};
      if(line.id&&input.id&&String(line.id)!==String(input.id))throw new Error('請款明細來源識別不一致，請重新開啟編輯');
      const pricingType=line.pricingType==='lump_sum'?'lump_sum':'actual',item=String(input.item??line.item??'').trim(),unit=String(input.unit??line.unit??'').trim(),date=String(input.date??line.date??'').trim();
      if(!item)throw new Error('施工項目不可空白');
      if(pricingType==='lump_sum'){
        const ref=(line.sourceContractRefs||[])[0]||(billing.sourceContractRefs||[]).find((row)=>String(row.contractKey||'')===String(input.contractKey||''));
        if(!ref?.contractKey)throw new Error(`${item} 缺少總價合約來源，無法安全修改`);
        const amount=Math.round(normalizedBillingLineInput(input.billingAmount??input.price,'本次請款金額'));
        const otherBilled=state.billings.filter((row)=>row!==billing).reduce((sum,row)=>sum+(row.sourceContractRefs||[]).filter((entry)=>entry.contractKey===ref.contractKey).reduce((part,entry)=>part+num(entry.billingAmount),0),0),contractAmount=Math.max(0,num(ref.contractAmount));
        if(amount<=0)throw new Error('總價進度請款金額必須大於 0');
        if(otherBilled+amount>contractAmount)throw new Error(`${item} 累計請款不可超過合約總價`);
        contractAmounts.set(ref.contractKey,amount);
        return {...line,date,item,unit,qty:1,price:amount,amount,subtotal:amount,sourceRefs:(line.sourceRefs||[]).map((entry)=>({...entry})),sourceContractRefs:(line.sourceContractRefs||[]).map((entry)=>entry.contractKey===ref.contractKey?{...entry,billingAmount:amount}:{...entry})};
      }
      const qty=normalizedBillingLineInput(input.qty,'數量'),price=normalizedBillingLineInput(input.price,'單價');
      return {...line,date,item,unit,qty,price,subtotal:Math.round(qty*price),sourceRefs:(line.sourceRefs||[]).map((entry)=>({...entry})),sourceContractRefs:(line.sourceContractRefs||[]).map((entry)=>({...entry}))};
    });
    const sourceContractRefs=(billing.sourceContractRefs||[]).map((ref)=>contractAmounts.has(ref.contractKey)?{...ref,billingAmount:contractAmounts.get(ref.contractKey)}:{...ref});
    const invoiceNo=String(values.invoiceNo??billing.invoiceNo??'').trim(),requestedInvoice=values.invoiceStatus??values.invoiceChoice,invoiceStatusValue=requestedInvoice===undefined?billingInvoiceStatus(billing):requestedInvoice==='no_invoice'?'no_invoice':invoiceNo?'invoiced':'invoice_pending';
    const retentionMode=['5','10','custom'].includes(values.retentionMode)?values.retentionMode:'none',retentionRate=retentionMode==='custom'?Math.max(0,num(values.retentionRate)):0,retentionCustom=retentionMode==='custom'?Math.max(0,num(values.retentionCustom)):0;
    const calculatedValues={lines:normalizedLines,taxMode:values.taxMode==='含稅'?'含稅':'未稅',invoiceStatus:invoiceStatusValue,retentionMode,retentionRate,retentionCustom,retentionBase:values.retentionBase==='preTax'?'preTax':'taxIncluded'},totals=calculateBilling(calculatedValues),now=new Date().toISOString(),date=String(values.date||billing.date||now.slice(0,10));
    const billingChanges={date,number,billingMonth:String(values.billingMonth||monthOf(date)),periodStart:String(values.periodStart??billing.periodStart??''),periodEnd:String(values.periodEnd??billing.periodEnd??''),taxMode:totals.taxMode,lines:normalizedLines,constructionAmount:totals.constructionAmount,amount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionRate:totals.retentionRate,retentionBase:totals.retentionBase,retentionEnabled:totals.retention>0,retentionMode,remainingRetention:totals.retention,retentionStatus:retentionState(totals.retention,0),total:totals.receivable,invoiceStatus:invoiceStatusValue,hasInvoice:invoiceStatusValue!=='no_invoice',invoiceNo:invoiceStatusValue==='no_invoice'?'':invoiceNo,invoiceDate:invoiceStatusValue==='no_invoice'?'':String(values.invoiceDate||billing.invoiceDate||date),status:'未收款',note:String(values.note??billing.note??''),sourceContractRefs,updatedAt:now};
    const receivableChanges={date,sourceNo:number,invoiceNo:billingChanges.invoiceNo,invoiceStatus:invoiceStatusValue,taxMode:totals.taxMode,untaxedAmount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionRate:totals.retentionRate,retentionBase:totals.retentionBase,retentionEnabled:totals.retention>0,retentionReceived:0,remainingRetention:totals.retention,retentionStatus:retentionState(totals.retention,0),amount:totals.receivable,received:0,status:'未收',updatedAt:now};
    Object.assign(billing,billingChanges);Object.assign(receivable,receivableChanges);
    syncBillingInvoiceRecord(billing,now);
    billingSourceRefs(billing).forEach((ref)=>availableSourceCopies(ref).forEach(({log,item})=>{if(item.billingId===billing.id){item.billingNo=number;syncLogBillingState(log)}}));
    await persist(`修改請款單 ${number}`);return billing;
  }
  async function deleteBilling(id, token) {
    await load();
    const safety=billingSafety(id);if(!safety.billing)throw new Error('找不到請款單');if(!safety.receivable)throw new Error(`此請款已鎖定：${safety.reason}`);if(token!==accountingDeleteToken&&!safety.deletable)throw new Error(`此請款已鎖定：${safety.reason}`);if(!billingSourcesResolvable(safety.billing))throw new Error('找不到完整施工來源，為避免誤刪已停止刪除');
    const billing=safety.billing,receivable=safety.receivable,refs=billingSourceRefs(billing),seen=new Set(),affected=[];
    refs.forEach((ref)=>{const copies=availableSourceCopies(ref);if(!copies.length)throw new Error('找不到原施工來源，為避免帳務斷鏈已停止刪除');copies.forEach((copy)=>{const key=`${copy.log.id}:${copy.index}`;if(!seen.has(key)){seen.add(key);affected.push(copy)}})});
    const linkedInvoices=billingInvoiceRecords(billing),otherBillings=state.billings.filter((row)=>row!==billing),otherFor=(copy)=>otherBillings.find((row)=>[...(row.sourceItemRefs||[]),...(row.lines||[]).flatMap((line)=>line.sourceRefs||[])].some((ref)=>sourceMatches(ref,copy.log,copy.item,copy.index)));
    state.billings=otherBillings;
    state.receivables=state.receivables.filter((row)=>row!==receivable);
    if(linkedInvoices.length){const linked=new Set(linkedInvoices);state.invoices=state.invoices.filter((row)=>!linked.has(row));}
    affected.forEach(({log,item,index})=>{const replacement=otherFor({log,item,index});if(replacement){item.billingStatus='已請款';item.billingId=replacement.id;item.billingNo=replacement.number||''}else if(String(item.billingId||'')===String(billing.id)){item.billingStatus='未請款';item.billingId='';item.billingNo=''}syncLogBillingState(log)});
    if(token!==accountingDeleteToken)await persist(`刪除請款單 ${billing.number}`);return true;
  }
  function billingReceiptState(billing) {
    const ar = state.receivables.find((row) => row.id === billing.receivableId || row.billingId === billing.id || String(row.sourceNo||'') === String(billing.number||''));
    const received = num(ar?.received), amount = num(ar?.amount ?? billing.total);
    return {receivable:ar,received,unreceived:Math.max(0,amount-received),status:amount>0&&received>=amount?'已收':received>0?'部分收款':'未收'};
  }
  function receiptBankTransaction(receipt) {
    return state.bankTransactions.find((row) => row.id === receipt.bankTransactionId || (row.sourceId === receipt.id && ['receipt','receivable_receipt'].includes(row.sourceType)));
  }
  function adjustBankIncome(bank, delta, now) {
    if (!bank || !delta) return;
    bank.income = Math.max(0,num(bank.income)+delta);
    bank.balance = num(bank.openingBalance)+num(bank.income)-num(bank.expense);
    bank.updatedAt = now;
  }
  function incomeSettlement(amountValue, feeValue, payerValue) {
    const amount=Math.round(num(amountValue)),fee=Math.max(0,Math.round(num(feeValue))),feePayer=payerValue==='counterparty'?'counterparty':'company';
    if(feePayer==='company'&&fee>amount)throw new Error('公司負擔的手續費不可高於本次收款');
    return {amount,fee,feePayer,netAmount:feePayer==='company'?amount-fee:amount};
  }
  function syncReceivableSummary(ar, now) {
    const history=state.receipts.filter((row)=>row.receivableId===ar.id),received=num(ar.legacyReceived)+history.reduce((sum,row)=>sum+num(row.amount),0),latest=[...history].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    ar.received=Math.min(num(ar.amount),received);ar.bankId=latest?.bankAccountId||latest?.bankId||'';ar.receiptDate=latest?.date||'';ar.status=ar.received>=num(ar.amount)&&num(ar.amount)>0?'已收':ar.received>0?'部分收款':'未收';ar.updatedAt=now;
    const billing=state.billings.find((row)=>row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||''));
    if(billing){billing.status=ar.status==='已收'?'已收款':ar.status==='部分收款'?'部分收款':'未收款';billing.updatedAt=now}
  }
  function syncReceiptBankTransaction(receipt, ar, now) {
    const bankId=String(receipt.bankAccountId||receipt.bankId||''),bank=state.banks.find((row)=>row.id===bankId);
    if(!bank)throw new Error('請選擇收款銀行帳戶');
    const amount=Math.max(0,num(receipt.netAmount)),existing=receiptBankTransaction(receipt);
    if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankIncome(previousBank,-num(existing.amount),now)}
    const transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:receipt.date,bankId:bank.id,bankAccountId:bank.id,type:'收入',direction:'in',category:'應收收款',amount,receiptAmount:num(receipt.amount),fee:num(receipt.fee),feePayer:receipt.feePayer,netAmount:amount,actualCredit:amount,paymentMethod:receipt.paymentMethod||'銀行轉帳',sourceType:'receivable_receipt',sourceId:receipt.id,receivableId:ar.id,billingId:ar.billingId||'',customer:ar.customer,customerName:ar.customerName||'',project:ar.project,projectName:ar.projectName||'',sourceNo:ar.sourceNo||'',description:`${ar.projectName||ar.sourceNo||'應收帳款'} 收款`,note:receipt.note||`${ar.sourceNo||''} 收款`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);
    receipt.bankId=bank.id;receipt.bankAccountId=bank.id;receipt.bankTransactionId=transaction.id;
    adjustBankIncome(bank,amount,now);
    return transaction;
  }
  function retentionBankTransaction(receipt) {
    return state.bankTransactions.find((row) => row.id === receipt.bankTransactionId || (row.sourceType === 'retention_receipt' && row.sourceId === receipt.id));
  }
  function syncRetentionSummary(ar, billing, now) {
    const retentionAmount=Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention)),recorded=state.retentionReceipts.filter((row)=>row.receivableId===ar.id||row.billingId&&row.billingId===ar.billingId).reduce((sum,row)=>sum+num(row.amount),0),received=Math.min(retentionAmount,num(ar.legacyRetentionReceived)+recorded),remaining=Math.max(0,retentionAmount-received),nextState=retentionState(retentionAmount,received,ar.retentionStatus);
    Object.assign(ar,{retentionAmount,retention:retentionAmount,retentionReceived:received,remainingRetention:remaining,retentionStatus:nextState,updatedAt:now});
    if(billing){Object.assign(billing,{retentionAmount,retention:retentionAmount,retentionReceived:received,remainingRetention:remaining,retentionStatus:nextState,updatedAt:now});billing.status=num(ar.received)>=num(ar.amount)&&remaining===0?'全部收清':num(ar.received)>=num(ar.amount)?'已收款':num(ar.received)>0?'部分收款':'未收款'}
  }
  function syncRetentionBankTransaction(receipt, ar, billing, now) {
    const bankId=String(receipt.bankAccountId||receipt.bankId||''),bank=state.banks.find((row)=>row.id===bankId);
    if(!bank)throw new Error('請選擇入帳銀行帳戶');
    const existing=retentionBankTransaction(receipt);
    if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankIncome(previousBank,-num(existing.amount),now)}
    const transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:receipt.date,bankId:bank.id,bankAccountId:bank.id,type:'收入',direction:'in',category:'保留款收回',amount:num(receipt.netAmount),receiptAmount:num(receipt.amount),fee:num(receipt.fee),feePayer:receipt.feePayer,netAmount:num(receipt.netAmount),actualCredit:num(receipt.netAmount),sourceType:'retention_receipt',sourceId:receipt.id,retentionReceiptId:receipt.retentionReceiptId||receipt.id,receivableId:ar.id,billingId:billing?.id||ar.billingId||'',customer:ar.customer,customerName:ar.customerName||billing?.customerName||'',project:ar.project,projectName:ar.projectName||billing?.projectName||'',sourceNo:ar.sourceNo||billing?.number||'',description:`${ar.projectName||ar.sourceNo||'應收帳款'} 保留款收回`,note:receipt.note||`${ar.sourceNo||''} 保留款收回`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);
    receipt.bankId=bank.id;receipt.bankAccountId=bank.id;receipt.bankTransactionId=transaction.id;
    adjustBankIncome(bank,num(receipt.netAmount),now);
    return transaction;
  }
  async function addReceipt(values) {
    await load();
    const idempotencyKey = String(values.idempotencyKey || '').trim();
    if (idempotencyKey) {
      const existing = state.receipts.find((row) => row.idempotencyKey === idempotencyKey);
      if (existing) {
        const ar=state.receivables.find((row)=>row.id===existing.receivableId);
        if(ar&&!receiptBankTransaction(existing)){const now=new Date().toISOString();syncReceiptBankTransaction(existing,ar,now);syncReceivableSummary(ar,now);await persist(`補齊一般收款銀行交易 ${ar.sourceNo||''}`)}
        return existing;
      }
    }
    const ar = state.receivables.find((row) => row.id === values.receivableId);
    if (!ar) throw new Error('找不到對應應收帳款');
    const settlement=incomeSettlement(values.amount,values.fee,values.feePayer),{amount,fee,feePayer,netAmount}=settlement,outstanding = Math.max(0,num(ar.amount)-num(ar.received));
    if (amount <= 0 || amount > outstanding) throw new Error('本次收款金額不可超過未收餘額');
    const bank = state.banks.find((row) => row.id === values.bankId);
    if (!bank) throw new Error('請選擇收款銀行帳戶');
    const now = new Date().toISOString(), receipt = {id:uid(),idempotencyKey:idempotencyKey||uid(),receivableId:ar.id,billingId:ar.billingId||'',date:values.date||now.slice(0,10),amount,fee,feePayer,netAmount,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',note:values.note||'',createdAt:now,updatedAt:now};
    state.receipts.unshift(receipt);syncReceiptBankTransaction(receipt,ar,now);syncReceivableSummary(ar,now);
    await persist(`新增分次收款 ${ar.sourceNo}`); return receipt;
  }
  async function updateReceipt(id, values = {}) {
    await load();
    const receipt=state.receipts.find((row)=>row.id===id);if(!receipt)throw new Error('找不到收款紀錄');
    const ar=state.receivables.find((row)=>row.id===receipt.receivableId);if(!ar)throw new Error('找不到對應應收帳款');
    const otherReceived=num(ar.legacyReceived)+state.receipts.filter((row)=>row!==receipt&&row.receivableId===ar.id).reduce((sum,row)=>sum+num(row.amount),0),settlement=incomeSettlement(values.amount,values.fee===undefined?receipt.fee:values.fee,values.feePayer===undefined?receipt.feePayer:values.feePayer),{amount,fee,feePayer,netAmount}=settlement,bankId=String(values.bankAccountId||values.bankId||'');
    if(amount<=0||otherReceived+amount>num(ar.amount))throw new Error('本次收款金額不可超過本期剩餘應收');
    if(!state.banks.some((row)=>row.id===bankId))throw new Error('請選擇收款銀行帳戶');
    const now=new Date().toISOString();
    Object.assign(receipt,{date:values.date||receipt.date||now.slice(0,10),amount,fee,feePayer,netAmount,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||receipt.paymentMethod||'銀行轉帳',note:values.note===undefined?receipt.note:String(values.note||''),updatedAt:now});
    syncReceiptBankTransaction(receipt,ar,now);syncReceivableSummary(ar,now);await persist(`修改應收收款 ${ar.sourceNo||''}`);return receipt;
  }
  async function deleteReceipt(id, token) {
    await load();
    const receipt=state.receipts.find((row)=>row.id===id);if(!receipt)throw new Error('找不到收款紀錄');
    const ar=state.receivables.find((row)=>row.id===receipt.receivableId);if(!ar)throw new Error('找不到對應應收帳款');
    const now=new Date().toISOString(),transaction=receiptBankTransaction(receipt);
    if(transaction){const bank=state.banks.find((row)=>row.id===(transaction.bankAccountId||transaction.bankId));adjustBankIncome(bank,-num(transaction.amount),now);state.bankTransactions=state.bankTransactions.filter((row)=>row.id!==transaction.id)}
    state.receipts=state.receipts.filter((row)=>row.id!==receipt.id);syncReceivableSummary(ar,now);if(token!==accountingDeleteToken)await persist(`刪除應收收款 ${ar.sourceNo||''}`);return true;
  }
  async function addRetentionReceipt(values) {
    await load();
    const idempotencyKey=String(values.idempotencyKey||'').trim();
    if(idempotencyKey){const existing=state.retentionReceipts.find((row)=>row.idempotencyKey===idempotencyKey);if(existing)return existing}
    const ar=state.receivables.find((row)=>row.id===values.receivableId);if(!ar)throw new Error('找不到對應應收帳款');
    const billing=state.billings.find((row)=>row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||''));
    const retentionAmount=Math.max(0,num(ar.retentionAmount ?? ar.retention ?? billing?.retentionAmount ?? billing?.retention));
    const retentionReceived=Math.max(0,num(ar.retentionReceived ?? billing?.retentionReceived));
    const remaining=Math.max(0,retentionAmount-retentionReceived),settlement=incomeSettlement(values.amount,values.fee,values.feePayer),{amount,fee,feePayer,netAmount}=settlement;
    if(amount<=0)throw new Error('本次收回保留款必須大於 0');
    if(amount>remaining)throw new Error('本次收回金額不可超過剩餘保留款');
    const now=new Date().toISOString(),id=uid(),bankAccountId=String(values.bankAccountId||values.bankId||'');
    if(!state.banks.some((row)=>row.id===bankAccountId))throw new Error('請選擇入帳銀行帳戶');
    const receipt={id,retentionReceiptId:id,idempotencyKey:idempotencyKey||uid(),receivableId:ar.id,billingId:billing?.id||ar.billingId||'',projectId:ar.project||billing?.project||'',customerId:ar.customer||billing?.customer||'',date:values.date||now.slice(0,10),amount,paymentMethod:values.paymentMethod||'銀行轉帳',bankAccountId,bankId:bankAccountId,fee,feePayer,netAmount,note:String(values.note||''),createdAt:now,updatedAt:now};
    state.retentionReceipts.unshift(receipt);
    syncRetentionBankTransaction(receipt,ar,billing,now);syncRetentionSummary(ar,billing,now);
    await persist(`收回保留款 ${ar.sourceNo}`);return receipt;
  }
  async function updateRetentionReceipt(id, values = {}) {
    await load();
    const receipt=state.retentionReceipts.find((row)=>row.id===id||row.retentionReceiptId===id);if(!receipt)throw new Error('找不到保留款收回紀錄');
    const ar=state.receivables.find((row)=>row.id===receipt.receivableId);if(!ar)throw new Error('找不到對應應收帳款');
    const billing=state.billings.find((row)=>row.id===receipt.billingId||row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||''));
    const retentionAmount=Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention));
    const settlement=incomeSettlement(values.amount,values.fee===undefined?receipt.fee:values.fee,values.feePayer===undefined?receipt.feePayer:values.feePayer),{amount,fee,feePayer,netAmount}=settlement;
    if(amount<=0)throw new Error('本次收回保留款必須大於 0');
    const otherReceived=num(ar.legacyRetentionReceived)+state.retentionReceipts.filter((row)=>row!==receipt&&(row.receivableId===ar.id||row.billingId&&row.billingId===ar.billingId)).reduce((sum,row)=>sum+num(row.amount),0);
    if(otherReceived+amount>retentionAmount)throw new Error('本次收回金額不可超過剩餘保留款');
    const now=new Date().toISOString(),bankAccountId=String(values.bankAccountId||values.bankId||'');
    if(!state.banks.some((row)=>row.id===bankAccountId))throw new Error('請選擇入帳銀行帳戶');
    Object.assign(receipt,{date:values.date||receipt.date||now.slice(0,10),amount,bankAccountId,bankId:bankAccountId,paymentMethod:values.paymentMethod||'銀行轉帳',fee,feePayer,netAmount,note:String(values.note||''),updatedAt:now});
    syncRetentionBankTransaction(receipt,ar,billing,now);syncRetentionSummary(ar,billing,now);
    await persist(`修改保留款收回紀錄 ${ar.sourceNo}`);return receipt;
  }
  async function deleteRetentionReceipt(id, token) {
    await load();
    const receipt=state.retentionReceipts.find((row)=>row.id===id||row.retentionReceiptId===id);if(!receipt)throw new Error('找不到保留款收回紀錄');
    const ar=state.receivables.find((row)=>row.id===receipt.receivableId);if(!ar)throw new Error('找不到對應應收帳款');
    const billing=state.billings.find((row)=>row.id===receipt.billingId||row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||'')),now=new Date().toISOString(),transaction=retentionBankTransaction(receipt);
    if(transaction){const bank=state.banks.find((row)=>row.id===(transaction.bankAccountId||transaction.bankId));adjustBankIncome(bank,-num(transaction.amount),now);state.bankTransactions=state.bankTransactions.filter((row)=>row.id!==transaction.id)}
    state.retentionReceipts=state.retentionReceipts.filter((row)=>row!==receipt);syncRetentionSummary(ar,billing,now);if(token!==accountingDeleteToken)await persist(`刪除保留款收回紀錄 ${ar.sourceNo||''}`);return true;
  }
  async function deleteReceivableAccounting(receivableId) {
    await load();
    const plan=accountingDeletionPreflight(receivableId),summary=accountingDeletionSummary(plan),snapshot=JSON.parse(JSON.stringify(state));
    try {
      for(const receipt of plan.receipts)await deleteReceipt(receipt.id,accountingDeleteToken);
      for(const receipt of plan.retentionReceipts)await deleteRetentionReceipt(receipt.retentionReceiptId||receipt.id,accountingDeleteToken);
      await deleteBilling(plan.billing.id,accountingDeleteToken);
      if(plan.invoiceRecords.length){const linked=new Set(plan.invoiceRecords);state.invoices=state.invoices.filter((row)=>!linked.has(row))}
      await persist(`安全刪除整筆測試帳務 ${summary.billingNo}`);
      return summary;
    } catch(error) {
      state=snapshot;
      try{await persist()}catch(_){/* 保留原始錯誤；記憶體已還原，持久層回復採最大努力 */}
      throw error;
    }
  }
  function nextPayableNumber(date) {
    const compact = String(date || new Date().toISOString().slice(0,10)).replaceAll('-','');
    const prefix = `AP-${compact}-`;
    const max = state.payables.reduce((value, row) => {
      const number = String(row.payableNo || row.number || '');
      return number.startsWith(prefix) ? Math.max(value,num(number.slice(prefix.length))) : value;
    },0);
    return `${prefix}${String(max + 1).padStart(3,'0')}`;
  }
  async function savePayable(values) {
    await load();
    const amount = Math.max(0,Math.round(num(values.amount)));
    if (!amount) throw new Error('應付金額必須大於 0');
    let vendor = state.vendors.find((row) => row.id === values.vendorId);
    const payeeName = String(values.payeeName || vendor?.name || '').trim();
    if (!vendor && payeeName) {
      vendor = state.vendors.find((row) => String(row.name||'').trim().toLocaleLowerCase('zh-Hant') === payeeName.toLocaleLowerCase('zh-Hant'));
      if (!vendor) { vendor={id:uid(),name:payeeName,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; state.vendors.unshift(vendor); }
    }
    if (!vendor && !payeeName) throw new Error('請選擇或輸入廠商／收款人');
    const project = state.projects.find((row) => row.id === values.projectId), now = new Date().toISOString(), date = values.date || now.slice(0,10), id=uid();
    const row = {id,payableNo:nextPayableNumber(date),date,vendor:vendor?.id||'',vendorName:vendor?.name||payeeName,project:project?.id||'',projectName:project?.name||'',category:values.category||'其他',item:String(values.item||'').trim(),amount,paid:0,dueDate:values.dueDate||'',status:'未付款',note:values.note||'',sourceType:'manual-payable',sourceId:values.sourceId||id,createdAt:now,updatedAt:now};
    state.payables.unshift(row); await persist(`新增應付 ${row.payableNo}`); return row;
  }
  async function addPayablePayment(values) {
    await load();
    const idempotencyKey = String(values.idempotencyKey || '').trim();
    if (idempotencyKey) { const existing=state.payments.find((row)=>row.idempotencyKey===idempotencyKey); if(existing)return existing; }
    const payable = state.payables.find((row) => row.id === values.payableId);
    if (!payable) throw new Error('找不到這筆應付帳款');
    const amount=Math.round(num(values.amount)),fee=Math.max(0,Math.round(num(values.fee))),outstanding=Math.max(0,num(payable.amount)-num(payable.paid));
    if (amount<=0 || amount>outstanding) throw new Error('本次付款不可超過未付金額');
    const bank=state.banks.find((row)=>row.id===values.bankId);if(!bank)throw new Error('請選擇付款銀行帳戶');
    const feePayer=values.feePayer==='recipient'?'recipient':'company';
    if(feePayer==='recipient'&&fee>amount)throw new Error('收款人負擔的手續費不可高於本次付款');
    const actualDebit=feePayer==='company'?amount+fee:amount,now=new Date().toISOString(),paymentId=uid(),transactionId=uid();
    const payment={id:paymentId,idempotencyKey:idempotencyKey||uid(),payableId:payable.id,date:values.date||now.slice(0,10),amount,fee,actualDebit,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',feePayer,note:values.note||'',bankTransactionId:transactionId,createdAt:now,updatedAt:now};
    state.payments.unshift(payment);
    payable.paid=num(payable.paid)+amount;payable.bankId=bank.id;payable.payDate=payment.date;payable.fee=num(payable.fee)+fee;payable.feeParty=feePayer==='company'?'公司負擔':'收款人負擔';payable.status=payable.paid>=num(payable.amount)?'已付清':'部分付款';payable.updatedAt=now;
    bank.expense=num(bank.expense)+actualDebit;bank.balance=num(bank.openingBalance)+num(bank.income)-num(bank.expense);bank.updatedAt=now;
    state.bankTransactions.unshift({id:transactionId,date:payment.date,bankId:bank.id,bankAccountId:bank.id,type:'支出',direction:'out',category:'應付帳款付款',amount:actualDebit,payableAmount:amount,fee,actualDebit,feePayer,paymentMethod:payment.paymentMethod,sourceType:'payable_payment',sourceId:payment.id,payableId:payable.id,vendor:payable.vendor,vendorName:payable.vendorName||'',project:payable.project,projectName:payable.projectName||'',sourceNo:payable.payableNo||payable.sourceNo||'',description:`${payable.vendorName||payable.payableNo||'應付帳款'} 付款`,note:payment.note||`${payable.payableNo||''} 付款`,createdAt:now,updatedAt:now});
    await persist(`新增應付付款 ${payable.payableNo||payable.sourceNo||''}`); return payment;
  }
  function payablePaymentTransaction(payment) {
    return state.bankTransactions.find((row)=>row.id===payment.bankTransactionId||(row.sourceId===payment.id&&['payable-payment','payable_payment'].includes(row.sourceType)));
  }
  function adjustBankExpense(bank, delta, now) {
    if(!bank||!delta)return;
    bank.expense=Math.max(0,num(bank.expense)+delta);bank.balance=num(bank.openingBalance)+num(bank.income)-num(bank.expense);bank.updatedAt=now;
  }
  function syncPayableSummary(payable, now) {
    const history=state.payments.filter((row)=>row.payableId===payable.id),paid=history.reduce((sum,row)=>sum+num(row.amount),0),fee=history.reduce((sum,row)=>sum+num(row.fee),0),latest=[...history].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    payable.paid=Math.min(num(payable.amount),paid);payable.fee=fee;payable.bankId=latest?.bankAccountId||latest?.bankId||'';payable.payDate=latest?.date||'';payable.feeParty=latest?(latest.feePayer==='company'?'公司負擔':'收款人負擔'):'';payable.status=payable.paid>=num(payable.amount)&&num(payable.amount)>0?'已付清':payable.paid>0?'部分付款':'未付款';payable.updatedAt=now;
  }
  function syncPayableBankTransaction(payment, payable, now) {
    const bankId=String(payment.bankAccountId||payment.bankId||''),bank=state.banks.find((row)=>row.id===bankId);if(!bank)throw new Error('請選擇付款銀行帳戶');
    const existing=payablePaymentTransaction(payment);if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankExpense(previousBank,-num(existing.amount),now)}
    const transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:payment.date,bankId:bank.id,bankAccountId:bank.id,type:'支出',direction:'out',category:'應付帳款付款',amount:num(payment.actualDebit),payableAmount:num(payment.amount),fee:num(payment.fee),actualDebit:num(payment.actualDebit),feePayer:payment.feePayer,paymentMethod:payment.paymentMethod||'銀行轉帳',sourceType:'payable_payment',sourceId:payment.id,payableId:payable.id,vendor:payable.vendor,vendorName:payable.vendorName||'',project:payable.project,projectName:payable.projectName||'',sourceNo:payable.payableNo||payable.sourceNo||'',description:`${payable.vendorName||payable.payableNo||'應付帳款'} 付款`,note:payment.note||`${payable.payableNo||''} 付款`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);payment.bankId=bank.id;payment.bankAccountId=bank.id;payment.bankTransactionId=transaction.id;adjustBankExpense(bank,num(payment.actualDebit),now);return transaction;
  }
  async function updatePayablePayment(id, values={}) {
    await load();const payment=state.payments.find((row)=>row.id===id);if(!payment)throw new Error('找不到付款紀錄');if(payment.legacy)throw new Error('歷史付款紀錄不可直接修改');
    const payable=state.payables.find((row)=>row.id===payment.payableId);if(!payable)throw new Error('找不到這筆應付帳款');
    const otherPaid=state.payments.filter((row)=>row!==payment&&row.payableId===payable.id).reduce((sum,row)=>sum+num(row.amount),0),amount=Math.round(num(values.amount)),fee=values.fee===undefined?num(payment.fee):Math.max(0,Math.round(num(values.fee))),feePayer=values.feePayer==='recipient'?'recipient':'company',bankId=String(values.bankAccountId||values.bankId||'');
    if(amount<=0||otherPaid+amount>num(payable.amount))throw new Error('本次付款不可超過未付金額');if(feePayer==='recipient'&&fee>amount)throw new Error('收款人負擔的手續費不可高於本次付款');if(!state.banks.some((row)=>row.id===bankId))throw new Error('請選擇付款銀行帳戶');
    const now=new Date().toISOString(),actualDebit=feePayer==='company'?amount+fee:amount;Object.assign(payment,{date:values.date||payment.date||now.slice(0,10),amount,fee,actualDebit,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||payment.paymentMethod||'銀行轉帳',feePayer,note:values.note===undefined?payment.note:String(values.note||''),updatedAt:now});
    syncPayableBankTransaction(payment,payable,now);syncPayableSummary(payable,now);await persist(`修改應付付款 ${payable.payableNo||''}`);return payment;
  }
  async function deletePayablePayment(id) {
    await load();const payment=state.payments.find((row)=>row.id===id);if(!payment)throw new Error('找不到付款紀錄');if(payment.legacy)throw new Error('歷史付款紀錄不可直接刪除');
    const payable=state.payables.find((row)=>row.id===payment.payableId);if(!payable)throw new Error('找不到這筆應付帳款');const now=new Date().toISOString(),transaction=payablePaymentTransaction(payment);
    if(transaction){const bank=state.banks.find((row)=>row.id===(transaction.bankAccountId||transaction.bankId));adjustBankExpense(bank,-num(transaction.amount),now);state.bankTransactions=state.bankTransactions.filter((row)=>row.id!==transaction.id)}
    state.payments=state.payments.filter((row)=>row!==payment);syncPayableSummary(payable,now);await persist(`刪除應付付款 ${payable.payableNo||''}`);return true;
  }
  const salaryAdjustmentFields = [
    ['fuel','油費','加項'],['meal','伙食','加項'],['other','其他加項','加項'],['overtime','加班','加項'],['bonus','獎金','加項'],['allowance','其他津貼','加項'],
    ['advance','預支','扣項'],['laborInsurance','勞健保','扣項'],['incomeTax','所得稅','扣項'],['deduction','其他扣項','扣項']
  ];
  function payrollEmployeeId(payroll) {
    const direct=String(payroll?.employee||payroll?.employeeId||'').trim();
    if(direct)return direct;
    const name=clean(payroll?.employeeName),matches=state.employees.filter((row)=>sameName(row.name,name));
    return matches.length===1?String(matches[0].id):`legacy:${normalizedMasterLabel(name)}:${payroll?.id||uid()}`;
  }
  function payrollGroupRows(payroll) {
    if(Array.isArray(payroll?.recordIds)){const ids=new Set(payroll.recordIds.map(String));return state.payroll.filter((row)=>ids.has(String(row.id)))}
    const employeeId=payrollEmployeeId(payroll),month=String(payroll?.month||'');
    return state.payroll.filter((row)=>payrollEmployeeId(row)===employeeId&&String(row.month||'')===month);
  }
  function payrollPaymentTruth(payroll) {
    const records=payrollGroupRows(payroll),recordIds=new Set(records.map((row)=>String(row.id))),employeeId=payrollEmployeeId(payroll),month=String(payroll?.month||records[0]?.month||''),total=payroll?.total!==undefined&&Array.isArray(payroll?.recordIds)?Math.max(0,num(payroll.total)):Math.max(0,...records.map((row)=>num(row.total)));
    const explicitPayments=state.salaryPayments.filter((row)=>recordIds.has(String(row.payrollId||''))||(!String(row.payrollId||'').trim()&&String(row.employee||row.employeeId||'')===employeeId&&monthOf(row.month||row.date)===month));
    const paymentIds=new Set(explicitPayments.map((row)=>String(row.id))),explicitTransactionIds=new Set(explicitPayments.map((row)=>String(row.bankTransactionId||'')).filter(Boolean)),explicitBankTransactions=[];
    state.bankTransactions.forEach((row)=>{const transactionId=String(row.id||''),sourceType=String(row.sourceType||''),sourceId=String(row.sourceId||''),salaryPaymentId=String(row.salaryPaymentId||'');if(explicitTransactionIds.has(transactionId)||(sourceType==='salary_payment'&&(paymentIds.has(sourceId)||paymentIds.has(salaryPaymentId))))explicitBankTransactions.push(row)});
    const explicitBankIds=new Set(explicitBankTransactions.map((row)=>String(row.id||''))),verifiedLegacyTransactions=[],legacyHistory=[],seenLegacy=new Set();
    state.bankTransactions.forEach((row)=>{
      const transactionId=String(row.id||'').trim(),sourceType=String(row.sourceType||'').trim(),sourceId=String(row.sourceId||'').trim(),payrollId=String(row.payrollId||'').trim();
      if(!transactionId||explicitBankIds.has(transactionId)||seenLegacy.has(transactionId))return;
      const referencedRecord=records.find((record)=>String(record.paymentTransactionId||'')===transactionId),directPayrollLink=recordIds.has(payrollId)||(sourceType==='payroll'&&recordIds.has(sourceId))||(sourceType==='salary_payment'&&(recordIds.has(payrollId)||recordIds.has(sourceId)));
      if(!referencedRecord&&!directPayrollLink)return;
      const amount=Math.max(0,num(row.salaryAmount??row.payrollAmount??row.paymentAmount??row.amount));if(amount<=0)return;
      seenLegacy.add(transactionId);verifiedLegacyTransactions.push(row);
      const record=referencedRecord||records.find((item)=>String(item.id)===payrollId||String(item.id)===sourceId);
      legacyHistory.push({id:`legacy-bank-${transactionId}`,payrollId:record?.id||payrollId||sourceId,date:row.date||record?.payDate||'',amount,fee:Math.max(0,num(row.fee)),actualDebit:Math.max(0,num(row.actualDebit??row.amount)),bankId:row.bankId||row.bankAccountId||record?.bankId||'',bankAccountId:row.bankAccountId||row.bankId||record?.bankId||'',paymentMethod:row.paymentMethod||'歷史銀行交易',note:row.note||row.description||'可驗證的歷史薪資付款',bankTransactionId:transactionId,legacy:true,readOnly:true});
    });
    const history=[...explicitPayments,...legacyHistory].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))),paid=Math.min(total,history.reduce((sum,row)=>sum+Math.max(0,num(row.amount)),0)),outstanding=Math.max(0,total-paid),status=paid>0&&outstanding<=0&&total>0?'已付清':paid>0?'部分付款':'未付款',hasVerifiedPayment=explicitPayments.length>0||verifiedLegacyTransactions.length>0;
    const stalePayrollStatus=!hasVerifiedPayment&&records.some((row)=>row.status==='已付款'||num(row.paidAmount)>0||row.payDate||row.paidAt||row.paymentTransactionId),missingBankPaymentIds=explicitPayments.filter((payment)=>!explicitBankTransactions.some((row)=>String(row.id||'')===String(payment.bankTransactionId||'')||(row.sourceType==='salary_payment'&&(String(row.sourceId||'')===String(payment.id)||String(row.salaryPaymentId||'')===String(payment.id))))).map((row)=>String(row.id));
    const integrity=missingBankPaymentIds.length?'explicit-missing-bank-transaction':explicitPayments.length&&verifiedLegacyTransactions.length?'explicit-and-legacy':explicitPayments.length?'explicit':verifiedLegacyTransactions.length?'verified-legacy':stalePayrollStatus?'stale-payroll-status':'none';
    return {explicitPayments,verifiedLegacyTransactions,history,paid,outstanding,status,hasVerifiedPayment,integrity,missingBankPaymentIds,total,recordIds:[...recordIds],bankTransactionIds:[...new Set([...explicitBankTransactions,...verifiedLegacyTransactions].map((row)=>String(row.id||'')).filter(Boolean))],legacyPaid:verifiedLegacyTransactions.length>0};
  }
  function salarySourceIdentity(row,type) {
    const sourceId=String(row?.sourceId||row?.attendanceId||row?.commissionId||'').trim();
    if(sourceId)return `${type}:${row?.sourceType||'source'}:${sourceId}`;
    if(row?.id)return `${type}:id:${row.id}`;
    return `${type}:${row?.date||''}:${row?.project||''}:${num(row?.amount??row?.commission)}:${row?.note||''}`;
  }
  function monthlySalarySources(employeeId,month,records) {
    const seen=new Set(),rows=[];
    const push=(key,row)=>{if(seen.has(key))return;seen.add(key);rows.push(row)};
    state.attendance.filter((row)=>String(row.employee||row.employeeId||'')===employeeId&&monthOf(row.date)===month).forEach((row)=>{
      const project=state.projects.find((item)=>String(item.id)===String(row.project));
      const mode=row.workMode==='hourly'?'小時':'天',quantity=row.workMode==='hourly'?num(row.hours):num(row.days),rate=row.workMode==='hourly'?num(row.hourlyRate):num(row.dailyRate);
      push(salarySourceIdentity(row,'attendance'),{id:row.id,date:row.date||'',type:row.workMode==='hourly'?'出勤':'點工',projectId:row.project||'',projectName:project?.name||row.projectName||'—',content:row.note||row.sourceNo||'點工／出勤',quantity,quantityLabel:quantity?`${quantity} ${mode}`:'',rate,rateLabel:rate?`$${Math.round(rate).toLocaleString('zh-TW')}`:'',amount:num(row.amount),sourceType:row.sourceType||'attendance',sourceId:row.sourceId||row.id});
      if(num(row.fuel)>0)push(`${salarySourceIdentity(row,'attendance')}:fuel`,{id:`${row.id||row.sourceId}-fuel`,date:row.date||'',type:'油費',projectId:row.project||'',projectName:project?.name||row.projectName||'—',content:row.note||'出勤油費',quantity:0,quantityLabel:'',rate:0,rateLabel:'',amount:num(row.fuel),sourceType:row.sourceType||'attendance',sourceId:row.sourceId||row.id});
    });
    state.commissions.filter((row)=>String(row.employee||row.employeeId||'')===employeeId&&monthOf(row.date)===month&&row.status==='已列入薪資').forEach((row)=>{
      const project=state.projects.find((item)=>String(item.id)===String(row.project)),base=num(row.untaxedAmount),rate=num(row.rate);
      push(salarySourceIdentity(row,'commission'),{id:row.id,date:row.date||'',type:'抽成',projectId:row.project||'',projectName:project?.name||row.projectName||'—',content:row.note||row.sourceNo||'業績抽成',quantity:base,quantityLabel:base?`$${Math.round(base).toLocaleString('zh-TW')}`:'',rate,rateLabel:rate?`${rate}%`:'',amount:num(row.commission),sourceType:row.sourceType||'commission',sourceId:row.sourceId||row.id});
    });
    const sorted=[...records].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
    salaryAdjustmentFields.forEach(([field,label,direction])=>{if(field==='fuel'&&rows.some((row)=>row.type==='油費'))return;const record=sorted.find((row)=>num(row[field])!==0),value=num(record?.[field]);if(!value)return;push(`adjustment:${field}`,{id:`${record.id}-${field}`,date:record.updatedAt?.slice(0,10)||'',type:label,projectId:'',projectName:'—',content:record.note||label,quantity:0,quantityLabel:'',rate:0,rateLabel:'',amount:direction==='扣項'?-Math.abs(value):Math.abs(value),sourceType:'payroll-adjustment',sourceId:record.id})});
    return rows.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.type).localeCompare(String(b.type),'zh-Hant'));
  }
  function monthlyPayrollGroups() {
    const groups=new Map();
    state.payroll.forEach((row)=>{const employeeId=payrollEmployeeId(row),month=String(row.month||''),key=`${employeeId}__${month}`;if(!groups.has(key))groups.set(key,{key,id:key,employeeId,month,records:[]});groups.get(key).records.push(row)});
    return [...groups.values()].map((group)=>{
      const records=[...group.records].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))),primary=records[0],employee=state.employees.find((row)=>String(row.id)===group.employeeId);
      const sources=monthlySalarySources(group.employeeId,group.month,records),sourceTotal=sources.reduce((sum,row)=>sum+num(row.amount),0),sourceBase=sources.filter((row)=>['點工','出勤'].includes(row.type)).reduce((sum,row)=>sum+num(row.amount),0),sourceCommission=sources.filter((row)=>row.type==='抽成').reduce((sum,row)=>sum+num(row.amount),0);
      const total=sources.length?Math.max(0,sourceTotal):Math.max(0,...records.map((row)=>num(row.total))),baseSalary=sourceBase||Math.max(0,...records.map((row)=>num(row.baseSalary))),commission=sourceCommission||Math.max(0,...records.map((row)=>num(row.commission)));
      const view={...group,recordIds:records.map((row)=>row.id),primaryPayrollId:primary.id,employee:group.employeeId,employeeName:employee?.name||primary.employeeName||'—',total,baseSalary,commission,sources};
      const summary=salaryPaymentSummary(view);return {...view,...summary,status:summary.status};
    }).sort((a,b)=>String(b.month).localeCompare(String(a.month))||String(a.employeeName).localeCompare(String(b.employeeName),'zh-Hant'));
  }
  function salaryPaymentSummary(payroll) {
    return payrollPaymentTruth(payroll);
  }
  function salaryPaymentTransaction(payment) {
    return state.bankTransactions.find((row)=>row.id===payment.bankTransactionId||(row.sourceType==='salary_payment'&&row.sourceId===payment.id));
  }
  function syncSalarySummary(payroll, now) {
    const summary=salaryPaymentSummary(payroll),latest=[...summary.history].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    payroll.paidAmount=summary.paid;payroll.status=summary.status==='已付清'?'已付款':summary.status;payroll.bankId=latest?.bankAccountId||latest?.bankId||'';payroll.payDate=latest?.date||'';payroll.paymentTransactionId=summary.history.length===1?summary.history[0].bankTransactionId||'':'';payroll.paidAt=summary.outstanding<=0&&summary.paid>0?(payroll.paidAt||now):'';payroll.updatedAt=now;
    return summary;
  }
  function syncSalaryBankTransaction(payment, payroll, now) {
    const bankId=String(payment.bankAccountId||payment.bankId||''),bank=state.banks.find((row)=>row.id===bankId);if(!bank)throw new Error('請選擇薪資付款銀行帳戶');
    const existing=salaryPaymentTransaction(payment);if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankExpense(previousBank,-num(existing.amount),now)}
    const employee=state.employees.find((row)=>row.id===payroll.employee),employeeName=employee?.name||payroll.employeeName||'員工',transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:payment.date,bankId:bank.id,bankAccountId:bank.id,type:'支出',direction:'out',category:'員工薪資',amount:num(payment.actualDebit),salaryAmount:num(payment.amount),fee:num(payment.fee),feePayer:payment.feePayer,actualDebit:num(payment.actualDebit),employeeNetAmount:Math.max(0,num(payment.amount)-num(payment.fee)*(payment.feePayer==='recipient'?1:0)),sourceType:'salary_payment',sourceId:payment.id,salaryPaymentId:payment.id,payrollId:payroll.id,employee:payroll.employee,employeeName,month:payroll.month,sourceNo:payroll.month||'',description:`${employeeName} ${payroll.month||''} 薪資付款`,note:payment.note||`${employeeName} ${payroll.month||''} 薪資付款`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);payment.bankId=bank.id;payment.bankAccountId=bank.id;payment.bankTransactionId=transaction.id;adjustBankExpense(bank,num(payment.actualDebit),now);return transaction;
  }
  async function addSalaryPayment(values) {
    await load();const idempotencyKey=String(values.idempotencyKey||'').trim();if(idempotencyKey){const existing=state.salaryPayments.find((row)=>row.idempotencyKey===idempotencyKey);if(existing)return existing}
    const payroll=state.payroll.find((row)=>row.id===values.payrollId);if(!payroll)throw new Error('找不到薪資紀錄');const summary=salaryPaymentSummary(payroll),amount=Math.round(num(values.amount)),fee=Math.max(0,Math.round(num(values.fee))),feePayer=values.feePayer==='recipient'?'recipient':'company',actualDebit=feePayer==='company'?amount+fee:amount;if(amount<=0||amount>summary.outstanding)throw new Error('本次付款不可超過未付薪資');if(feePayer==='recipient'&&fee>amount)throw new Error('員工負擔的手續費不可高於本次付款');
    const bank=state.banks.find((row)=>row.id===String(values.bankAccountId||values.bankId||''));if(!bank)throw new Error('請選擇薪資付款銀行帳戶');const now=new Date().toISOString(),payment={id:uid(),idempotencyKey:idempotencyKey||uid(),payrollId:payroll.id,date:values.date||now.slice(0,10),amount,fee,feePayer,actualDebit,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',note:String(values.note||''),createdAt:now,updatedAt:now};
    state.salaryPayments.unshift(payment);syncSalaryBankTransaction(payment,payroll,now);syncSalarySummary(payroll,now);await persist(`新增薪資付款 ${payroll.month||''}`);return payment;
  }
  async function updateSalaryPayment(id, values={}) {
    await load();const payment=state.salaryPayments.find((row)=>row.id===id);if(!payment)throw new Error('找不到薪資付款紀錄');const payroll=state.payroll.find((row)=>row.id===payment.payrollId);if(!payroll)throw new Error('找不到薪資紀錄');const summary=salaryPaymentSummary(payroll),otherPaid=summary.history.filter((row)=>row!==payment).reduce((sum,row)=>sum+num(row.amount),0),amount=Math.round(num(values.amount)),fee=values.fee===undefined?num(payment.fee):Math.max(0,Math.round(num(values.fee))),feePayer=(values.feePayer===undefined?payment.feePayer:values.feePayer)==='recipient'?'recipient':'company',actualDebit=feePayer==='company'?amount+fee:amount,bankId=String(values.bankAccountId||values.bankId||'');if(amount<=0||otherPaid+amount>summary.total)throw new Error('本次付款不可超過未付薪資');if(feePayer==='recipient'&&fee>amount)throw new Error('員工負擔的手續費不可高於本次付款');if(!state.banks.some((row)=>row.id===bankId))throw new Error('請選擇薪資付款銀行帳戶');
    const now=new Date().toISOString();Object.assign(payment,{date:values.date||payment.date||now.slice(0,10),amount,fee,feePayer,actualDebit,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||payment.paymentMethod||'銀行轉帳',note:values.note===undefined?payment.note:String(values.note||''),updatedAt:now});syncSalaryBankTransaction(payment,payroll,now);syncSalarySummary(payroll,now);await persist(`修改薪資付款 ${payroll.month||''}`);return payment;
  }
  async function deleteSalaryPayment(id) {
    await load();const payment=state.salaryPayments.find((row)=>row.id===id);if(!payment)throw new Error('找不到薪資付款紀錄');const payroll=state.payroll.find((row)=>row.id===payment.payrollId);if(!payroll)throw new Error('找不到薪資紀錄');const now=new Date().toISOString(),transaction=salaryPaymentTransaction(payment);if(transaction){const bank=state.banks.find((row)=>row.id===(transaction.bankAccountId||transaction.bankId));adjustBankExpense(bank,-num(transaction.amount),now);state.bankTransactions=state.bankTransactions.filter((row)=>row!==transaction)}
    state.salaryPayments=state.salaryPayments.filter((row)=>row!==payment);syncSalarySummary(payroll,now);await persist(`刪除薪資付款 ${payroll.month||''}`);return true;
  }
  async function updateBillingInvoice(id, values = {}) {
    await load(); const billing=state.billings.find((row)=>row.id===id);if(!billing)throw new Error('找不到請款單');
    const now=new Date().toISOString(),choice=values.invoiceChoice==='invoice_required'?'invoice_required':'no_invoice',number=choice==='no_invoice'?'':String(values.invoiceNo||'').trim(),date=choice==='no_invoice'?'':values.invoiceDate||billing.date||now.slice(0,10);
    const nextInvoiceStatus=choice==='no_invoice'?'no_invoice':number?'invoiced':'invoice_pending';
    const totals=calculateBilling({lines:billing.lines||[],taxMode:billing.taxMode,invoiceStatus:nextInvoiceStatus,retentionMode:billing.retentionMode,retentionRate:billing.retentionRate,retentionBase:billing.retentionBase||'taxIncluded',retentionCustom:!billing.retentionBase&&billing.retentionMode==='custom'?billing.retention:undefined});
    const ar=state.receivables.find((row)=>row.id===billing.receivableId||row.billingId===billing.id||String(row.sourceNo||'')===String(billing.number||''));
    if(ar&&num(ar.received)>totals.receivable)throw new Error('切換後應收金額低於既有收款，請先確認收款紀錄');
    Object.assign(billing,{invoiceStatus:nextInvoiceStatus,hasInvoice:nextInvoiceStatus!=='no_invoice',invoiceNo:number,invoiceDate:date,amount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionBase:totals.retentionBase,retentionStatus:retentionState(totals.retention,billing.retentionReceived,billing.retentionStatus),remainingRetention:Math.max(0,totals.retention-num(billing.retentionReceived)),total:totals.receivable,updatedAt:now});
    if(ar){Object.assign(ar,{invoiceNo:number,taxMode:billing.taxMode,untaxedAmount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionBase:totals.retentionBase,retentionStatus:retentionState(totals.retention,ar.retentionReceived,ar.retentionStatus),remainingRetention:Math.max(0,totals.retention-num(ar.retentionReceived)),amount:totals.receivable,status:num(ar.received)>=totals.receivable&&totals.receivable>0?'已收':num(ar.received)>0?'部分收款':'未收',updatedAt:now})}
    syncBillingInvoiceRecord(billing,now);
    await persist(`更新請款單發票 ${billing.number}`);return billing;
  }
  const clean = (value) => String(value ?? '').trim();
  const sameName = (left, right) => clean(left).replace(/\s+/g,' ').toLocaleLowerCase('zh-Hant') === clean(right).replace(/\s+/g,' ').toLocaleLowerCase('zh-Hant');
  function payableForUsage(usage) {
    return state.payables.find((row) => row.id === usage?.payableId || (row.usageIds || []).some((id) => String(id) === String(usage?.id)));
  }
  function payableLocked(payable) {
    return Boolean(payable && (num(payable.paid) > 0 || state.payments.some((payment) => payment.payableId === payable.id)));
  }
  function syncMaterialPayable(payable) {
    if (!payable) return;
    const ids = new Set((payable.usageIds || []).map(String));
    const usages = state.materialUsages.filter((row) => ids.has(String(row.id)));
    if (!usages.length) {
      if (payableLocked(payable)) throw new Error('此材料應付已有付款紀錄，不能移除其全部來源');
      state.payables = state.payables.filter((row) => row.id !== payable.id);
      return;
    }
    const amount = Math.round(usages.reduce((sum, row) => sum + num(row.amount ?? num(row.quantity) * num(row.unitPrice)), 0));
    if (amount < num(payable.paid)) throw new Error('材料調整後金額低於已付款金額，為避免帳務不一致已停止修改');
    const projects = new Set(usages.map((row) => row.project).filter(Boolean));
    payable.usageIds = usages.map((row) => row.id);
    payable.amount = amount;
    payable.date = usages.map((row) => row.date || '').sort().at(-1) || payable.date;
    payable.status = num(payable.paid) >= amount && amount > 0 ? '已付清' : num(payable.paid) > 0 ? '部分付款' : '未付款';
    payable.note = `依材料使用紀錄彙總 ${usages.length} 筆，涵蓋 ${projects.size} 個案場`;
    payable.updatedAt = new Date().toISOString();
    usages.forEach((usage) => { usage.payableId = payable.id; });
  }
  function assignMaterialUsage(usage) {
    let payable = state.payables.find((row) => row.id === usage.payableId);
    if (!payable) {
      payable = state.payables.find((row) => /material/i.test(row.sourceType || '') && row.vendor === usage.vendor && !payableLocked(row));
    }
    if (!payable) {
      const vendor = state.vendors.find((row) => row.id === usage.vendor) || {};
      payable = {id:uid(),payableNo:nextPayableNumber(usage.date),date:usage.date,vendor:usage.vendor,vendorName:vendor.name||usage.vendorName||'',project:'',projectName:'',category:'材料採購',item:'案場材料使用',amount:0,paid:0,dueDate:'',status:'未付款',note:'',sourceType:'material-project',sourceId:usage.id,usageIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      state.payables.unshift(payable);
    }
    if (!Array.isArray(payable.usageIds)) payable.usageIds = [];
    if (!payable.usageIds.some((id) => String(id) === String(usage.id))) payable.usageIds.push(usage.id);
    usage.payableId = payable.id;
    syncMaterialPayable(payable);
    return payable;
  }
  async function saveCustomer(values, id = '') {
    await load();
    const name = clean(values.name); if (!name) throw new Error('請輸入客戶／建設公司名稱');
    const duplicate = state.customers.find((row) => row.id !== id && sameName(row.name,name));
    if (duplicate) throw new Error('客戶名稱已存在，請直接編輯既有客戶');
    const now = new Date().toISOString();
    const row = state.customers.find((item) => item.id === id) || {id:uid(),createdAt:now};
    Object.assign(row,{name,taxId:clean(values.taxId),contact:clean(values.contact),phone:clean(values.phone),email:clean(values.email),address:clean(values.address),note:clean(values.note),updatedAt:now});
    if (!id) state.customers.unshift(row);
    state.projects.filter((project) => project.customer === row.id).forEach((project) => { project.customerName=row.name; });
    await persist(`${id?'修改':'新增'}客戶 ${row.name}`); return row;
  }
  async function saveProject(values, id = '') {
    await load();
    const name=clean(values.name),customer=state.customers.find((row)=>row.id===values.customer);
    if(!name)throw new Error('請輸入案場名稱'); if(!customer)throw new Error('請選擇所屬客戶');
    const duplicate=state.projects.find((row)=>row.id!==id&&sameName(row.name,name)&&row.customer===customer.id);
    if(duplicate)throw new Error('此客戶已有同名案場，請直接編輯既有案場');
    const now=new Date().toISOString(),row=state.projects.find((item)=>item.id===id)||{id:uid(),createdAt:now};
    const retentionMode=['5','10','custom'].includes(values.defaultRetentionMode)?values.defaultRetentionMode:'none';
    Object.assign(row,{name,customer:customer.id,customerName:customer.name,address:clean(values.address),startDate:values.startDate||'',expectedEndDate:values.expectedEndDate||'',actualEndDate:values.actualEndDate||'',status:['進行中','已完工','暫停'].includes(values.status)?values.status:'進行中',contractAmount:Math.max(0,num(values.contractAmount)),note:clean(values.note),defaultRetentionMode:retentionMode,defaultRetentionRate:retentionMode==='5'?5:retentionMode==='10'?10:retentionMode==='custom'?Math.max(0,num(values.defaultRetentionRate)):0,defaultRetentionAmount:0,defaultRetentionBase:values.defaultRetentionBase==='preTax'?'preTax':'taxIncluded',defaultInvoiceChoice:values.defaultInvoiceChoice==='invoice_required'?'invoice_required':'no_invoice',defaultTaxMode:values.defaultTaxMode==='含稅'?'含稅':'未稅',defaultPricingMode:pricingMode(values.defaultPricingMode)||row.defaultPricingMode||'',updatedAt:now});
    if(!id)state.projects.unshift(row); await persist(`${id?'修改':'新增'}案場 ${row.name}`); return row;
  }
  function employeeUsage(id) {
    const employeeId=String(id||''),sameEmployee=(row)=>String(row?.employee||row?.employeeId||'')===employeeId;
    const payrollRows=state.payroll.filter(sameEmployee),payrollIds=new Set(payrollRows.map((row)=>String(row.id)));
    const counts={dailyLogs:state.dailyLogs.filter(sameEmployee).length,attendance:state.attendance.filter(sameEmployee).length,commissions:state.commissions.filter(sameEmployee).length,payroll:payrollRows.length,salaryPayments:state.salaryPayments.filter((row)=>sameEmployee(row)||payrollIds.has(String(row.payrollId||''))).length,bankTransactions:state.bankTransactions.filter(sameEmployee).length,calendar:(state.calendar||[]).filter(sameEmployee).length};
    return {...counts,used:Object.values(counts).some((count)=>count>0)};
  }
  async function saveEmployee(values, id = '') {
    await load();
    const name=clean(values.name),dailyRate=values.dailyRate===''||values.dailyRate===undefined?0:Number(values.dailyRate),commissionRate=values.commissionRate===''||values.commissionRate===undefined?0:Number(values.commissionRate);
    if(!name)throw new Error('請輸入員工姓名');
    if(!Number.isFinite(dailyRate)||dailyRate<0)throw new Error('日薪不可小於 0');
    if(!Number.isFinite(commissionRate)||commissionRate<0||commissionRate>100)throw new Error('抽成比例必須介於 0～100');
    const now=new Date().toISOString(),row=state.employees.find((item)=>String(item.id)===String(id))||{id:uid(),createdAt:now};
    Object.assign(row,{name,phone:clean(values.phone),role:clean(values.role),dailyRate,commissionRate,startDate:values.startDate||'',status:clean(values.status)||row.status||'在職',note:clean(values.note),updatedAt:now});
    if(!id)state.employees.unshift(row);
    await persist(`${id?'修改':'新增'}員工 ${row.name}`); return row;
  }
  async function deleteEmployee(id) {
    await load(); const row=state.employees.find((item)=>String(item.id)===String(id)); if(!row)return false;
    if(employeeUsage(id).used)throw new Error('此員工已有出勤、抽成、薪資或銀行歷史，請改為離職／停用，不可直接刪除');
    state.employees=state.employees.filter((item)=>item!==row); await persist(`刪除員工 ${row.name||''}`); return true;
  }
  async function saveMaterial(values, id = '') {
    await load();
    const name=clean(values.name),code=clean(values.code),unit=clean(values.unit),vendor=state.vendors.find((row)=>row.id===values.vendor),unitPrice=Math.max(0,num(values.unitPrice));
    if(!name)throw new Error('請輸入材料名稱'); if(!unit)throw new Error('請輸入材料單位'); if(!vendor)throw new Error('請選擇材料廠商');
    const duplicate=state.materials.find((row)=>row.id!==id&&sameName(row.name,name)&&String(row.vendor||'')===String(vendor.id));
    if(duplicate)throw new Error('此廠商已有相同名稱的材料');
    if(code&&state.materials.some((row)=>row.id!==id&&sameName(row.code,code)))throw new Error('材料代碼已存在');
    const now=new Date().toISOString(),row=state.materials.find((item)=>item.id===id)||{id:uid(),stock:0,safeStock:0,createdAt:now};
    Object.assign(row,{name,code,vendor:vendor.id,vendorName:vendor.name||'',unit,unitPrice,model:clean(values.model),note:clean(values.note),updatedAt:now});
    if(!id)state.materials.unshift(row);
    await persist(`${id?'修改':'新增'}材料 ${row.name}`); return row;
  }
  async function deleteMaterial(id) {
    await load(); const row=state.materials.find((item)=>item.id===id); if(!row)return false;
    if(state.materialUsages.some((usage)=>String(usage.material)===String(id)))throw new Error('此材料已有使用紀錄，為保留案場成本與應付來源不能刪除');
    state.materials=state.materials.filter((item)=>item!==row); await persist(`刪除材料 ${row.name||''}`); return true;
  }
  async function saveMaterialUsage(values, id = '') {
    await load();
    const project=state.projects.find((row)=>row.id===values.project),material=state.materials.find((row)=>row.id===values.material),vendor=state.vendors.find((row)=>row.id===(values.vendor||material?.vendor));
    const quantity=num(values.quantity),unitPrice=num(values.unitPrice);
    if(!project)throw new Error('找不到案場'); if(!material)throw new Error('請選擇既有材料'); if(!vendor)throw new Error('請選擇材料廠商'); if(quantity<=0)throw new Error('數量必須大於 0'); if(unitPrice<0)throw new Error('單價不可小於 0');
    const now=new Date().toISOString(),existing=state.materialUsages.find((row)=>row.id===id),oldPayable=payableForUsage(existing);
    if(existing&&payableLocked(oldPayable))throw new Error('此材料來源的應付已付款，不能直接修改；請先以正式帳務方式處理');
    const row=existing||{id:uid(),createdAt:now,status:'未付'};
    if(existing&&oldPayable){oldPayable.usageIds=(oldPayable.usageIds||[]).filter((usageId)=>String(usageId)!==String(existing.id));}
    Object.assign(row,{date:values.date||now.slice(0,10),project:project.id,projectName:project.name,material:material.id,materialName:material.name||'',vendor:vendor.id,vendorName:vendor.name||'',quantity,unitPrice,amount:Math.round(quantity*unitPrice),unit:material.unit||'',model:material.model||'',note:clean(values.note),updatedAt:now,payableId:''});
    if(!existing)state.materialUsages.unshift(row);
    if(oldPayable)syncMaterialPayable(oldPayable); assignMaterialUsage(row);
    await persist(`${id?'修改':'新增'}案場材料 ${project.name}`); return row;
  }
  async function deleteMaterialUsage(id) {
    await load(); const row=state.materialUsages.find((item)=>item.id===id); if(!row)return false;
    const payable=payableForUsage(row); if(payableLocked(payable))throw new Error('此材料來源的應付已有付款紀錄，不能直接刪除');
    state.materialUsages=state.materialUsages.filter((item)=>item.id!==id);
    if(payable){payable.usageIds=(payable.usageIds||[]).filter((usageId)=>String(usageId)!==String(id));syncMaterialPayable(payable)}
    await persist('刪除案場材料使用'); return true;
  }
  async function saveProjectCost(values, id = '') {
    await load(); const project=state.projects.find((row)=>row.id===values.project),amount=Math.max(0,Math.round(num(values.amount)));
    if(!project)throw new Error('找不到案場'); if(!amount)throw new Error('成本金額必須大於 0');
    const now=new Date().toISOString(),row=state.projectCosts.find((item)=>item.id===id)||{id:uid(),createdAt:now,payableId:''};
    const linked=state.payables.find((item)=>item.id===row.payableId); if(linked&&payableLocked(linked))throw new Error('此成本的應付已有付款紀錄，不能直接修改');
    let vendor=state.vendors.find((item)=>item.id===values.vendor),payeeName=clean(values.payeeName||vendor?.name);
    if(values.createPayable&&!vendor){if(!payeeName)throw new Error('產生應付時請選擇或輸入廠商／收款人');vendor=state.vendors.find((item)=>sameName(item.name,payeeName));if(!vendor){vendor={id:uid(),name:payeeName,createdAt:now,updatedAt:now};state.vendors.unshift(vendor)}}
    Object.assign(row,{date:values.date||now.slice(0,10),project:project.id,projectName:project.name,category:clean(values.category)||'其他工程費用',description:clean(values.description),amount,vendor:vendor?.id||'',vendorName:vendor?.name||payeeName||'',createPayable:Boolean(values.createPayable),note:clean(values.note),updatedAt:now});
    if(!id)state.projectCosts.unshift(row);
    if(row.createPayable){const payable=linked||{id:uid(),payableNo:nextPayableNumber(row.date),paid:0,status:'未付款',sourceType:'project-cost',sourceId:row.id,createdAt:now};Object.assign(payable,{date:row.date,vendor:row.vendor,vendorName:row.vendorName,project:project.id,projectName:project.name,category:row.category,item:row.description||row.category,amount:row.amount,dueDate:'',note:row.note,status:'未付款',updatedAt:now});if(!linked)state.payables.unshift(payable);row.payableId=payable.id}else if(linked){state.payables=state.payables.filter((item)=>item.id!==linked.id);row.payableId=''}
    await persist(`${id?'修改':'新增'}案場其他成本 ${project.name}`); return row;
  }
  async function deleteProjectCost(id) {
    await load();const row=state.projectCosts.find((item)=>item.id===id);if(!row)return false;const payable=state.payables.find((item)=>item.id===row.payableId);if(payableLocked(payable))throw new Error('此成本的應付已有付款紀錄，不能直接刪除');state.projectCosts=state.projectCosts.filter((item)=>item.id!==id);if(payable)state.payables=state.payables.filter((item)=>item.id!==payable.id);await persist('刪除案場其他成本');return true;
  }
  function quotationTotals(lines, taxMode = '未稅', mode = '', lumpSumTotal = 0) {
    const normalized=pricingMode(mode),entered = Math.round(normalized==='lump_sum'?num(lumpSumTotal):(lines || []).reduce((sum, line) => sum + (line.pricingType==='lump_sum'?num(line.lumpSumAmount??line.subtotal):num(line.subtotal ?? num(line.qty) * num(line.price))), 0));
    if (taxMode === '含稅') {
      const values = taxValues(entered);
      return {amount:values.untaxed,tax:values.tax,total:values.total};
    }
    return {amount:entered,tax:Math.round(entered * (num(state.settings.defaultTax) || 5) / 100),total:entered + Math.round(entered * (num(state.settings.defaultTax) || 5) / 100)};
  }
  function nextQuotationNumber(date = new Date().toISOString().slice(0,10)) {
    const stem=`Q-${String(date).replaceAll('-','')}`,count=state.quotations.filter((row)=>String(row.number||'').startsWith(stem)).length+1;
    return `${stem}-${String(count).padStart(3,'0')}`;
  }
  function quotationPriceFor({item,customerId='',projectId='',date=''}) {
    const key=clean(item),at=date||new Date().toISOString().slice(0,10);
    const matching=(state.quotationPrices||[]).filter((row)=>sameName(row.item,key)&&(!row.effectiveDate||row.effectiveDate<=at));
    const newest=(rows)=>rows.sort((a,b)=>String(b.effectiveDate||'').localeCompare(String(a.effectiveDate||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    const project=newest(matching.filter((row)=>row.scope==='project'&&String(row.projectId)===String(projectId)));
    const customer=newest(matching.filter((row)=>row.scope==='customer'&&String(row.customerId)===String(customerId)&&!row.projectId));
    const company=newest(matching.filter((row)=>row.scope==='company'&&!row.customerId&&!row.projectId));
    const row=project||customer||company;
    return row?{...row,source:project?'project':customer?'customer':'company'}:null;
  }
  async function saveQuotationPrice(values) {
    await load(); const item=clean(values.item),price=Math.max(0,num(values.price)),scope=['company','customer','project'].includes(values.scope)?values.scope:'company';
    if(!item)throw new Error('請輸入施工項目'); if(!clean(values.unit))throw new Error('請輸入單位');
    if(scope==='customer'&&!values.customerId)throw new Error('請選擇客戶'); if(scope==='project'&&!values.projectId)throw new Error('請選擇案場');
    const row={id:uid(),scope,customerId:scope==='company'?'':values.customerId||'',projectId:scope==='project'?values.projectId||'':'',item,unit:clean(values.unit),price,effectiveDate:values.effectiveDate||new Date().toISOString().slice(0,10),createdSource:clean(values.createdSource)||'manual',createdAt:new Date().toISOString()};
    state.quotationPrices.unshift(row); await persist(`新增報價價格歷史 ${item}`); return row;
  }
  async function saveQuotation(values, id = '') {
    await load(); const customer=state.customers.find((row)=>String(row.id)===String(values.customer)),project=state.projects.find((row)=>String(row.id)===String(values.project));
    if(!customer)throw new Error('請選擇客戶／建設公司'); if(!project)throw new Error('請選擇案場');
    const mode=pricingMode(values.pricingMode)||pricingMode(project.defaultPricingMode)||(String(values.sourceType||'').startsWith('import-')?'actual':'');if(!mode)throw new Error('請選擇計價方式');
    const lines=(values.lines||[]).filter((line)=>clean(line.item)).map((line)=>{const type=mode==='mixed'?(line.pricingType==='lump_sum'?'lump_sum':'actual'):mode,qty=String(line.qty??'').trim()===''?null:Math.max(0,num(line.qty)),price=Math.max(0,num(line.price)),enteredLump=Number(line.lumpSumAmount),hasEnteredLump=String(line.lumpSumAmount??'').trim()!==''&&Number.isFinite(enteredLump)&&enteredLump>=0,lumpSumAmount=type==='lump_sum'?Math.max(0,hasEnteredLump?enteredLump:qty!==null&&price>0?Math.round(qty*price):0):0;return {id:line.id||uid(),house:clean(line.house),item:clean(line.item),spec:clean(line.spec),unit:clean(line.unit)||'式',pricingType:type,qty,estimatedQty:qty,price,lumpSumAmount,subtotal:type==='lump_sum'?Math.round(lumpSumAmount):qty===null?0:Math.round(qty*price),priceSource:line.priceSource||'manual',priceId:line.priceId||'',scope:clean(line.scope),note:clean(line.note)};});
    if(!lines.length)throw new Error('請至少新增一筆報價明細');
    const now=new Date().toISOString(),existing=state.quotations.find((row)=>row.id===id);
    if(existing?.status==='已確認'&&values.allowConfirmedEdit!==true)throw new Error('已確認報價不可直接修改歷史內容');
    const lumpSumTotal=mode==='lump_sum'?Math.max(0,num(values.lumpSumTotal)):0;if(mode==='lump_sum'&&lumpSumTotal<=0)throw new Error('請輸入合約／報價總價');
    const totals=quotationTotals(lines,values.taxMode,mode,lumpSumTotal),row=existing||{id:uid(),number:nextQuotationNumber(values.date),createdAt:now};
    Object.assign(row,{customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,date:values.date||now.slice(0,10),dueDate:values.dueDate||'',pricingMode:mode,lumpSumTotal,billingPlan:values.billingPlan||row.billingPlan||'one_time',billingMilestones:Array.isArray(row.billingMilestones)?row.billingMilestones:[],taxMode:values.taxMode==='含稅'?'含稅':'未稅',lines,amount:totals.amount,tax:totals.tax,total:totals.total,status:['草稿','已送出','已確認','作廢'].includes(values.status)?values.status:(row.status||'草稿'),internalNote:clean(values.internalNote),publicNote:clean(values.publicNote),note:clean(values.publicNote),sourceType:values.sourceType||row.sourceType||'manual',importTemplateId:values.importTemplateId||row.importTemplateId||'',updatedAt:now});
    if(!existing)state.quotations.unshift(row); mergeQuotationUnitPresets(lines.map((line)=>line.unit)); await persist(`${id?'修改':'新增'}報價單 ${row.number}`); return row;
  }
  async function setQuotationStatus(id,status) {
    await load(); const row=state.quotations.find((item)=>item.id===id); if(!row)throw new Error('找不到報價單');
    if(!['草稿','已送出','已確認','作廢'].includes(status))throw new Error('無效的報價狀態');
    if(row.status==='已確認'&&status!=='已確認')throw new Error('已確認報價請使用「取消確認」或「建立修訂版」');
    row.status=status;row.updatedAt=new Date().toISOString();await persist(`報價單 ${row.number} 狀態改為 ${status}`);return row;
  }
  function quotationUsage(id) {
    const daily=[];state.dailyLogs.forEach((log)=>(log.items||[]).forEach((item)=>{if(String(item.quotationId||item.quoteId||'')===String(id))daily.push({logId:log.id,workItemId:item.workItemId||''})}));
    const billings=state.billings.filter((billing)=>String(billing.quotationId||billing.quoteId||'')===String(id)||(billing.sourceContractRefs||[]).some((ref)=>String(ref.quotationId||ref.quoteId||'')===String(id))||(billing.sourceRefs||[]).some((ref)=>String(ref.quotationId||ref.quoteId||'')===String(id))||(billing.lines||[]).some((line)=>String(line.quotationId||line.quoteId||'')===String(id)));
    const billingIds=new Set(billings.map((row)=>String(row.id))),receivables=state.receivables.filter((row)=>billingIds.has(String(row.billingId||row.sourceId||''))||String(row.quotationId||row.quoteId||'')===String(id));
    return {used:daily.length>0||billings.length>0||receivables.length>0,dailyCount:daily.length,billingCount:billings.length,receivableCount:receivables.length};
  }
  async function deleteQuotation(id) {
    await load();const row=state.quotations.find((item)=>item.id===id);if(!row)throw new Error('找不到報價單');const usage=quotationUsage(id);
    if(usage.used)throw new Error('此報價已被施工或請款資料使用，為保留歷史紀錄無法刪除。請使用「建立修訂版」。');
    if(row.status==='已確認')throw new Error('已確認報價請先取消確認，再回到草稿刪除');
    if(!['草稿','已送出'].includes(row.status))throw new Error('此狀態的報價不可刪除');
    state.quotations=state.quotations.filter((item)=>item.id!==id);await persist(`刪除報價單 ${row.number}`);return true;
  }
  async function cancelQuotationConfirmation(id) {
    await load();const row=state.quotations.find((item)=>item.id===id);if(!row)throw new Error('找不到報價單');if(row.status!=='已確認')throw new Error('只有已確認報價可以取消確認');
    if(quotationUsage(id).used)throw new Error('此報價已被施工或請款資料使用，無法取消確認。請使用「建立修訂版」。');
    row.status='草稿';row.updatedAt=new Date().toISOString();await persist(`取消確認報價單 ${row.number}`);return row;
  }
  async function createQuotationRevision(id) {
    await load();const source=state.quotations.find((item)=>item.id===id);if(!source)throw new Error('找不到報價單');if(source.status!=='已確認')throw new Error('只有已確認報價可以建立修訂版');if(!quotationUsage(id).used)throw new Error('此報價尚未被使用，可先取消確認後編輯');
    const rootId=source.revisionOf||source.id,siblings=state.quotations.filter((row)=>String(row.revisionOf||'')===String(rootId)),revisionNumber=Math.max(0,...siblings.map((row)=>num(row.revisionNumber)))+1,now=new Date().toISOString(),row={...source,id:uid(),number:`${String(source.number||'報價單').replace(/\s+Rev\.\d+$/i,'')} Rev.${revisionNumber}`,status:'草稿',revisionOf:rootId,revisionNumber,lines:(source.lines||[]).map((line)=>({...line,id:uid()})),createdAt:now,updatedAt:now};
    state.quotations.unshift(row);await persist(`建立報價修訂版 ${row.number}`);return row;
  }
  async function saveQuotationTemplate(values,id='') {
    await load(); const customer=state.customers.find((row)=>row.id===values.customerId);if(!customer)throw new Error('請選擇客戶／建設公司');if(!clean(values.name))throw new Error('請輸入模板名稱');
    const now=new Date().toISOString(),row=state.quotationTemplates.find((item)=>item.id===id)||{id:uid(),createdAt:now};
    Object.assign(row,{name:clean(values.name),customerId:customer.id,customerName:customer.name,fileFormat:clean(values.fileFormat)||'excel',headerRow:Math.max(1,num(values.headerRow)||1),detailStartRow:Math.max(1,num(values.detailStartRow)||2),mapping:{house:clean(values.mapping?.house),item:clean(values.mapping?.item),unit:clean(values.mapping?.unit),qty:clean(values.mapping?.qty),price:clean(values.mapping?.price),amount:clean(values.mapping?.amount),note:clean(values.mapping?.note)},updatedAt:now});
    if(!id)state.quotationTemplates.unshift(row);await persist(`${id?'修改':'新增'}報價模板 ${row.name}`);return row;
  }
  function confirmedQuotationItems(projectId, customerId) {
    const rows=[],seen=new Set();
    [...state.quotations]
      .filter((quote)=>quote.status==='已確認'&&(!projectId||String(quote.project)===String(projectId))&&(!customerId||String(quote.customer)===String(customerId)))
      .sort((a,b)=>String(b.date||b.updatedAt||'').localeCompare(String(a.date||a.updatedAt||'')))
      .forEach((quote)=>(quote.lines||[]).forEach((line,index)=>{
        const type=pricingTypeFor(quote,line);if(!type)return;
        const lineId=line.id||`${quote.id}:line:${index}`,key=`${quote.id}__${lineId}`;if(seen.has(key))return;seen.add(key);
        const lumpSumAmount=type==='lump_sum'&&pricingMode(quote.pricingMode)==='lump_sum'?num(quote.lumpSumTotal??quote.amount):num(line.lumpSumAmount);
        rows.push({quotationId:quote.id,quoteId:quote.id,quotationNo:quote.number||'',quotationLineId:lineId,quoteLineId:lineId,quoteDate:quote.date||'',customerId:quote.customer||'',projectId:quote.project,house:line.house||'',item:line.item||'',itemName:line.item||'',unit:line.unit||'式',price:num(line.price),unitPrice:num(line.price),taxMode:quote.taxMode||'未稅',pricingMode:quote.pricingMode,pricingType:type,lumpSumAmount});
      }));
    return rows;
  }
  window.KuSheERPStore = { load, getState: () => state, masterOptions, materialVendorOptions, payrollHistoryLock, payrollPaymentTruth, dailyLogPayrollDeleteLock, saveCommission, deleteCommission, saveDailyBatch, deleteDailyBatch, dailyManualItems, unbilledWork, dailyWorkAmount, taxValues, grossFromUntaxed, calculateBilling, nextBillingNumber, createBilling, billingEditable, billingDeletable, updateBilling, deleteBilling, receivableAccountingDeletePreview, deleteReceivableAccounting, billingReceiptState, addReceipt, updateReceipt, deleteReceipt, addRetentionReceipt, updateRetentionReceipt, deleteRetentionReceipt, nextPayableNumber, savePayable, addPayablePayment, updatePayablePayment, deletePayablePayment, monthlyPayrollGroups, salaryPaymentSummary, addSalaryPayment, updateSalaryPayment, deleteSalaryPayment, updateBillingInvoice, invoiceAmounts, invoiceRows, saveInvoice, saveCustomer, saveProject, saveEmployee, employeeUsage, deleteEmployee, saveMaterial, deleteMaterial, saveMaterialUsage, deleteMaterialUsage, saveProjectCost, deleteProjectCost, quotationTotals, nextQuotationNumber, quotationPriceFor, saveQuotationPrice, saveQuotationUnitPreset, saveQuotation, setQuotationStatus, quotationUsage, deleteQuotation, cancelQuotationConfirmation, createQuotationRevision, saveQuotationTemplate, confirmedQuotationItems, projectPricingMode, contractSources, billedContractAmount, persist, num };
}());
