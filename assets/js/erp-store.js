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
  const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' });
  const businessDate = (date = new Date()) => {
    const parts = Object.fromEntries(businessDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
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
  function quotationPublicNotePresets(customerId = '') {
    const target = clean(customerId), presets = Array.isArray(state?.settings?.quotationPublicNotePresets) ? state.settings.quotationPublicNotePresets : [];
    if (!target) return [];
    return presets.filter((row) => row && clean(row.id) && String(row.customerId) === target && clean(row.text)).map((row) => ({...row,text:clean(row.text)})).sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }
  async function saveQuotationPublicNotePreset(customerId, value) {
    await load();
    const target = clean(customerId), text = clean(value), customer = state.customers.find((row) => String(row.id) === target);
    if (!customer || !text) throw new Error('請先選擇客戶並輸入對外備註');
    const previous = Array.isArray(state.settings.quotationPublicNotePresets) ? state.settings.quotationPublicNotePresets : undefined;
    const presets = (previous || []).map((row) => ({...row})), index = presets.findIndex((row) => String(row.customerId) === target && clean(row.text) === text), now = new Date().toISOString();
    const row = index >= 0 ? {...presets[index],text,updatedAt:now} : {id:uid(),customerId:target,text,createdAt:now,updatedAt:now};
    if (index >= 0) presets.splice(index,1);
    presets.unshift(row); state.settings.quotationPublicNotePresets = presets;
    try { await persist(`儲存 ${customer.name} 常用對外備註`); }
    catch (error) { if (previous === undefined) delete state.settings.quotationPublicNotePresets; else state.settings.quotationPublicNotePresets = previous; throw error; }
    return row;
  }
  async function deleteQuotationPublicNotePreset(customerId, presetId) {
    await load();
    const target = clean(customerId), id = clean(presetId), previous = Array.isArray(state.settings.quotationPublicNotePresets) ? state.settings.quotationPublicNotePresets : undefined;
    const presets = previous || [], row = presets.find((item) => clean(item?.id) === id && String(item?.customerId) === target);
    if (!row) throw new Error('找不到此客戶的常用備註範本');
    state.settings.quotationPublicNotePresets = presets.filter((item) => item !== row);
    try { await persist('刪除客戶常用對外備註'); }
    catch (error) { state.settings.quotationPublicNotePresets = previous; throw error; }
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
    if (!score(state)) state = window.KuSheLegacyData?.getState() || {};
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
  const PAID_ORPHAN_COMMISSION_ERROR = '此抽成已納入真正已付款薪資，不能直接清除來源。';
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
      payroll = {id:uid(),month,employee,days:0,baseSalary:0,commission:0,fuel:0,manualFuel:0,meal:0,other:0,overtime:0,bonus:0,allowance:0,advance:0,laborInsurance:0,incomeTax:0,deduction:0,total:0,payDate:'',bankId:'',paymentTransactionId:'',paidAt:'',status:'未付款',note:'由請款單、抽成與點工自動彙整',payrollAdjustmentNote:'',otherNote:'',deductionNote:'',createdAt:new Date().toISOString()};
      state.payroll.unshift(payroll);
    }
    payroll.days = atts.reduce((sum, x) => sum + num(x.days), 0);
    payroll.hours = atts.reduce((sum, x) => sum + num(x.hours), 0);
    payroll.baseSalary = atts.reduce((sum, x) => sum + num(x.amount), 0);
    payroll.manualFuel = Math.max(0, num(payroll.manualFuel));
    payroll.fuel = atts.reduce((sum, x) => sum + num(x.fuel), 0) + payroll.manualFuel;
    payroll.commission = comms.reduce((sum, x) => sum + num(x.commission), 0);
    payroll.total = payrollNet(payroll);
    payroll.updatedAt = new Date().toISOString();
    const otherValues = ['fuel','manualFuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'].some((key) => num(payroll[key]));
    if (!atts.length && !comms.length && !otherValues && payroll.status !== '已付款') state.payroll = state.payroll.filter((x) => x.id !== payroll.id);
  }
  const HISTORICAL_COMMISSION_REPAIR_TARGETS = [
    {key:'A',commissionId:'msew0ec2m60dfx',dailyLogId:'msethpigr5vn88',employeeId:'ms4pbmy6fo0p2o',employeeName:'劉佳勳',projectId:'ms7l8l5pl9jel7',projectName:'富華-心之所向',date:'2026-07-29',payrollMonth:'2026-07',currentPerformance:19500,currentCommission:9750,expectedPerformance:19500,expectedCommission:4875},
    {key:'B',commissionId:'msew0ec2el4z96',dailyLogId:'msethpigaddmde',employeeId:'ms4pcc0de0yero',employeeName:'柯智耀',projectId:'ms7l8l5pl9jel7',projectName:'富華-心之所向',date:'2026-07-29',payrollMonth:'2026-07',currentPerformance:19500,currentCommission:9750,expectedPerformance:19500,expectedCommission:4875},
    {key:'C',commissionId:'msew0ec2arwfg3',dailyLogId:'mseuczcnweq51e',employeeId:'ms4pbmy6fo0p2o',employeeName:'劉佳勳',projectId:'msddq446t3xytw',projectName:'壹山E區',date:'2026-08-03',payrollMonth:'2026-08',currentPerformance:4000,currentCommission:2000,expectedPerformance:4000,expectedCommission:1000},
    {key:'D',commissionId:'msew0ec2doxme5',dailyLogId:'mseuczcn9stryc',employeeId:'ms4pcc0de0yero',employeeName:'柯智耀',projectId:'msddq446t3xytw',projectName:'壹山E區',date:'2026-08-03',payrollMonth:'2026-08',currentPerformance:4000,currentCommission:2000,expectedPerformance:4000,expectedCommission:1000},
    {key:'E',commissionId:'mt6qjz7mswv73p',dailyLogId:'mt6qjz7mmouj43',employeeId:'ms4pbmy6fo0p2o',employeeName:'劉佳勳',projectId:'ms4p52iyxojeei',projectName:'謙富',date:'2026-08-24',payrollMonth:'2026-08',billingId:'mt6qn33i0yxiom',billingNo:'B20260824-001',currentPerformance:1379600,currentCommission:344900,expectedPerformance:1313905,expectedCommission:328476},
    {key:'F',commissionId:'mt6qjz7le4ncbx',dailyLogId:'mt6qjz7la94uvn',employeeId:'ms4pcc0de0yero',employeeName:'柯智耀',projectId:'ms4p52iyxojeei',projectName:'謙富',date:'2026-08-24',payrollMonth:'2026-08',billingId:'mt6qn33i0yxiom',billingNo:'B20260824-001',currentPerformance:1379600,currentCommission:344900,expectedPerformance:1313905,expectedCommission:328476}
  ];
  const HISTORICAL_COMMISSION_REPAIR_PAYROLLS = [
    {employeeId:'ms4pbmy6fo0p2o',employeeName:'劉佳勳',month:'2026-07',payrollId:'msethpigyox9l5',currentTotal:9750,expectedTotal:4875},
    {employeeId:'ms4pcc0de0yero',employeeName:'柯智耀',month:'2026-07',payrollId:'msethpigdm4nq9',currentTotal:9750,expectedTotal:4875},
    {employeeId:'ms4pbmy6fo0p2o',employeeName:'劉佳勳',month:'2026-08',payrollId:'mseuczcnxagw47',currentTotal:678900,expectedTotal:661476},
    {employeeId:'ms4pcc0de0yero',employeeName:'柯智耀',month:'2026-08',payrollId:'mseuczcno7jshz',currentTotal:678900,expectedTotal:661476}
  ];
  const HISTORICAL_COMMISSION_REPAIR_BILLING = {id:'mt6qn33i0yxiom',number:'B20260824-001',projectId:'ms4p52iyxojeei',customerId:'ms4p52iyh72ucz',untaxed:1313905,tax:65695,gross:1379600,total:1241640};
  const HISTORICAL_COMMISSION_REPAIR_DEFERRED = {commissionId:'mserk82jtpdlfs',sourceNo:'B845317',untaxedAmount:4500,rate:0,commission:0};
  const historicalCommissionRepairFingerprint = (value) => JSON.stringify(value);
  const historicalCommissionRepairOmit = (row, keys) => Object.fromEntries(Object.entries(row||{}).filter(([key])=>!keys.includes(key)));
  function historicalCommissionRepairProtectedFingerprints() {
    const keys=['employees','attendance','salaryPayments','bankTransactions','banks','billings','receivables','invoices','receipts','retentionReceipts','payments','payables'];
    return Object.fromEntries(keys.map((key)=>[key,historicalCommissionRepairFingerprint(state[key]||[])]));
  }
  function historicalCommissionRepairPlan() {
    const blockers=[],block=(key,message)=>blockers.push({key,message}),targets=[],groups=[];
    HISTORICAL_COMMISSION_REPAIR_TARGETS.forEach((target)=>{
      const commissionMatches=(state.commissions||[]).filter((row)=>String(row.id||'')===target.commissionId),dailyLogMatches=(state.dailyLogs||[]).filter((row)=>String(row.id||'')===target.dailyLogId),commission=commissionMatches[0],dailyLog=dailyLogMatches[0];
      if(commissionMatches.length!==1)block(`commission-${target.key}`,`${target.key} 的抽成紀錄必須精確命中 1 筆，目前為 ${commissionMatches.length} 筆。`);
      if(dailyLogMatches.length!==1)block(`daily-log-${target.key}`,`${target.key} 的每日施工紀錄必須精確命中 1 筆，目前為 ${dailyLogMatches.length} 筆。`);
      if(commission&&dailyLog){
        const linked=(state.commissions||[]).filter((row)=>String(row.sourceType||'')==='daily-log'&&String(row.sourceId||'')===target.dailyLogId);
        if(linked.length!==1||linked[0]!==commission)block(`source-${target.key}`,`${target.key} 的每日施工來源未唯一指向指定抽成紀錄。`);
        const commissionIdentity=String(commission.sourceType||'')==='daily-log'&&String(commission.sourceId||'')===target.dailyLogId&&String(commission.employee||commission.employeeId||'')===target.employeeId&&String(commission.project||commission.projectId||'')===target.projectId&&String(commission.date||'')===target.date&&num(commission.untaxedAmount)===target.currentPerformance&&num(commission.rate)===25&&num(commission.commission)===target.currentCommission&&String(commission.status||'')==='已列入薪資';
        const dailyLogIdentity=String(dailyLog.employee||dailyLog.employeeId||'')===target.employeeId&&String(dailyLog.project||dailyLog.projectId||'')===target.projectId&&String(dailyLog.date||'')===target.date&&num(dailyLog.performance)===target.currentPerformance&&num(dailyLog.rate)===25&&num(dailyLog.commission)===target.currentCommission;
        if(!commissionIdentity)block(`commission-identity-${target.key}`,`${target.key} 的抽成欄位已不同於核准的修復前狀態。`);
        if(!dailyLogIdentity)block(`daily-log-identity-${target.key}`,`${target.key} 的每日施工欄位已不同於核准的修復前狀態。`);
        if(target.billingId){
          if(String(dailyLog.billingId||'')!==target.billingId||String(dailyLog.billingNo||'')!==target.billingNo)block(`billing-link-${target.key}`,`${target.key} 無法精確連回 ${target.billingNo}。`);
        }else if(String(dailyLog.billingId||'').trim())block(`unexpected-billing-${target.key}`,`${target.key} 出現未核准的請款單關聯。`);
      }
      targets.push({key:target.key,commissionId:target.commissionId,dailyLogId:target.dailyLogId,employee:commission?.employeeName||dailyLog?.employeeName||target.employeeName,date:commission?.date||dailyLog?.date||target.date,project:commission?.projectName||dailyLog?.projectName||target.projectName,sourceType:commission?.sourceType||'',sourceId:commission?.sourceId||'',sourceNo:commission?.sourceNo||'',billingId:dailyLog?.billingId||'',currentPerformance:num(dailyLog?.performance),currentRate:num(dailyLog?.rate),currentCommission:num(commission?.commission),expectedPerformance:target.expectedPerformance,expectedCommission:target.expectedCommission,payrollMonth:target.payrollMonth,payrollCurrentTotal:0,payrollExpectedTotal:0,paymentLock:null,createdAt:commission?.createdAt||'',updatedAt:commission?.updatedAt||''});
    });
    const payrollViews=monthlyPayrollGroups();
    HISTORICAL_COMMISSION_REPAIR_PAYROLLS.forEach((expected)=>{
      const records=(state.payroll||[]).filter((row)=>String(row.id||'')===expected.payrollId),matchingRecords=(state.payroll||[]).filter((row)=>String(row.employee||row.employeeId||'')===expected.employeeId&&String(row.month||'')===expected.month),viewMatches=payrollViews.filter((row)=>String(row.employeeId||'')===expected.employeeId&&String(row.month||'')===expected.month),view=viewMatches[0],truth=view?payrollPaymentTruth(view):null,lock=payrollHistoryLock(expected.employeeId,expected.month),salaryPaymentCount=(state.salaryPayments||[]).filter((row)=>records.some((record)=>String(row.payrollId||'')===String(record.id||''))||(!String(row.payrollId||'').trim()&&String(row.employee||row.employeeId||'')===expected.employeeId&&monthOf(row.month||row.date)===expected.month)).length;
      if(records.length!==1||matchingRecords.length!==1||viewMatches.length!==1)block(`payroll-${expected.employeeId}-${expected.month}`,`${expected.month} ${expected.employeeName} 的薪資群組或薪資紀錄不唯一。`);
      if(view&&num(view.total)!==expected.currentTotal)block(`payroll-total-${expected.employeeId}-${expected.month}`,`${expected.month} ${expected.employeeName} 的目前應領已不同於核准基準。`);
      const paymentSafe=Boolean(truth)&&num(truth.paid)===0&&truth.explicitPayments.length===0&&truth.verifiedLegacyTransactions.length===0&&truth.bankTransactionIds.length===0&&salaryPaymentCount===0&&lock.locked===false;
      if(!paymentSafe)block(`payment-lock-${expected.employeeId}-${expected.month}`,`${expected.month} ${expected.employeeName} 已有付款或無法排除歷史付款，禁止修復。`);
      const paymentLock={paid:num(truth?.paid),salaryPayments:truth?.explicitPayments?.length||0,verifiedLegacyPayments:truth?.verifiedLegacyTransactions?.length||0,salaryBankTransactions:truth?.bankTransactionIds?.length||0,locked:Boolean(lock.locked)};
      groups.push({...expected,recordCount:matchingRecords.length,recordIds:matchingRecords.map((row)=>row.id),paymentLock});
      targets.filter((row)=>row.payrollMonth===expected.month&&HISTORICAL_COMMISSION_REPAIR_TARGETS.find((target)=>target.key===row.key)?.employeeId===expected.employeeId).forEach((row)=>{row.payrollCurrentTotal=num(view?.total);row.payrollExpectedTotal=expected.expectedTotal;row.paymentLock=paymentLock});
    });
    const billingMatches=(state.billings||[]).filter((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.id),billing=billingMatches[0],billingReceivables=(state.receivables||[]).filter((row)=>String(row.billingId||row.sourceId||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.id||String(row.sourceNo||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.number),billingInvoices=(state.invoices||[]).filter((row)=>String(row.sourceId||row.billingId||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.id||String(row.invoiceNumber||row.invoiceNo||'')===String(billing?.invoiceNo||''));
    const billingValid=billingMatches.length===1&&String(billing.number||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.number&&String(billing.project||billing.projectId||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.projectId&&String(billing.customer||billing.customerId||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.customerId&&num(billing.amount??billing.preTaxAmount)===HISTORICAL_COMMISSION_REPAIR_BILLING.untaxed&&num(billing.preTaxAmount??billing.amount)===HISTORICAL_COMMISSION_REPAIR_BILLING.untaxed&&num(billing.tax??billing.taxAmount)===HISTORICAL_COMMISSION_REPAIR_BILLING.tax&&num(billing.grossTotal??billing.taxIncludedAmount)===HISTORICAL_COMMISSION_REPAIR_BILLING.gross&&num(billing.total)===HISTORICAL_COMMISSION_REPAIR_BILLING.total&&HISTORICAL_COMMISSION_REPAIR_TARGETS.filter((target)=>target.billingId).every((target)=>(billing.sourceItemRefs||[]).some((ref)=>String(ref.sourceId||ref.dailyLogId||ref.logId||'')===target.dailyLogId||(ref.dailyLogIds||[]).some((id)=>String(id)===target.dailyLogId)));
    if(!billingValid||billingReceivables.length!==1||billingInvoices.length!==1)block('protected-billing',`${HISTORICAL_COMMISSION_REPAIR_BILLING.number} 或其應收／發票關聯已不同於核准基準。`);
    const deferredMatches=(state.commissions||[]).filter((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_DEFERRED.commissionId),deferred=deferredMatches[0];
    if(deferredMatches.length!==1||String(deferred.sourceNo||'')!==HISTORICAL_COMMISSION_REPAIR_DEFERRED.sourceNo||num(deferred.untaxedAmount)!==HISTORICAL_COMMISSION_REPAIR_DEFERRED.untaxedAmount||num(deferred.rate)!==0||num(deferred.commission)!==0)block('deferred-b845317','B845317 延後處理項目已不同於核准基準。');
    const totalReduction=targets.reduce((sum,row)=>sum+Math.max(0,row.currentCommission-row.expectedCommission),0),payrollReduction=groups.reduce((sum,row)=>sum+Math.max(0,row.currentTotal-row.expectedTotal),0);
    if(totalReduction!==44598||payrollReduction!==44598)block('total-reduction','六筆抽成或四組薪資的預計總差額不是 44,598。');
    return {allowed:blockers.length===0,blockers,targets,groups,totalReduction,payrollReduction,billing:{id:billing?.id||'',number:billing?.number||'',untaxed:num(billing?.preTaxAmount??billing?.amount),tax:num(billing?.taxAmount??billing?.tax),gross:num(billing?.grossTotal??billing?.taxIncludedAmount),receivableIds:billingReceivables.map((row)=>row.id),invoiceIds:billingInvoices.map((row)=>row.id)},deferred:{...HISTORICAL_COMMISSION_REPAIR_DEFERRED,unchanged:deferredMatches.length===1}};
  }
  async function historicalCommissionRepairPreview() {
    await load();
    return historicalCommissionRepairPlan();
  }
  function recalculateHistoricalCommissionPayroll(group, now) {
    const rows=(state.payroll||[]).filter((row)=>String(row.id||'')===group.payrollId);
    if(rows.length!==1)throw new Error(`${group.month} ${group.employeeName} 無法精確找到核准的薪資紀錄。`);
    const payroll=rows[0],employeeId=String(payroll.employee||payroll.employeeId||''),month=String(payroll.month||'');
    if(employeeId!==group.employeeId||month!==group.month)throw new Error(`${group.month} ${group.employeeName} 的薪資編號、員工或月份不符合核准目標。`);
    const nextCommission=(state.commissions||[]).filter((row)=>String(row.employee||row.employeeId||'')===group.employeeId&&monthOf(row.date)===group.month&&String(row.status||'')==='已列入薪資').reduce((sum,row)=>sum+num(row.commission),0);
    payroll.commission=nextCommission;
    payroll.total=payrollNet({...payroll,commission:nextCommission});
    payroll.updatedAt=now;
    return payroll;
  }
  async function repairHistoricalCommissionData(confirmation={}) {
    await load();
    const reason=String(confirmation?.reason||'').trim();
    if(confirmation?.confirmed!==true)throw new Error('必須明確確認執行六筆歷史抽成修復。');
    if(!reason)throw new Error('請輸入歷史抽成修復原因。');
    const preview=historicalCommissionRepairPlan();
    if(preview.allowed!==true)throw new Error(`歷史抽成不可安全修復：${preview.blockers.map((row)=>row.message).join(' ')}`);
    const snapshot=JSON.parse(JSON.stringify(state)),protectedBefore=historicalCommissionRepairProtectedFingerprints(),countsBefore={commissions:state.commissions.length,dailyLogs:state.dailyLogs.length,payroll:state.payroll.length},targetCommissionBefore=new Map(),targetDailyLogBefore=new Map(),targetPayrollBefore=new Map(),targetCommissionIds=new Set(HISTORICAL_COMMISSION_REPAIR_TARGETS.map((row)=>row.commissionId)),targetDailyLogIds=new Set(HISTORICAL_COMMISSION_REPAIR_TARGETS.map((row)=>row.dailyLogId)),targetPayrollIds=new Set(HISTORICAL_COMMISSION_REPAIR_PAYROLLS.map((row)=>row.payrollId)),otherCommissionsBefore=historicalCommissionRepairFingerprint(state.commissions.filter((row)=>!targetCommissionIds.has(String(row.id||'')))),otherDailyLogsBefore=historicalCommissionRepairFingerprint(state.dailyLogs.filter((row)=>!targetDailyLogIds.has(String(row.id||'')))),otherPayrollBefore=historicalCommissionRepairFingerprint(state.payroll.filter((row)=>!targetPayrollIds.has(String(row.id||'')))),billingBefore=historicalCommissionRepairFingerprint(state.billings.find((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.id)),receivablesBefore=historicalCommissionRepairFingerprint(state.receivables),invoicesBefore=historicalCommissionRepairFingerprint(state.invoices),receiptsBefore=historicalCommissionRepairFingerprint(state.receipts),retentionReceiptsBefore=historicalCommissionRepairFingerprint(state.retentionReceipts),deferredBefore=historicalCommissionRepairFingerprint(state.commissions.find((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_DEFERRED.commissionId));
    HISTORICAL_COMMISSION_REPAIR_TARGETS.forEach((target)=>{
      const commission=state.commissions.find((row)=>String(row.id||'')===target.commissionId),dailyLog=state.dailyLogs.find((row)=>String(row.id||'')===target.dailyLogId);
      targetCommissionBefore.set(target.commissionId,historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(commission,target.billingId?['untaxedAmount','commission']:['commission'])));
      targetDailyLogBefore.set(target.dailyLogId,historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(dailyLog,target.billingId?['performance','commission']:['commission'])));
    });
    HISTORICAL_COMMISSION_REPAIR_PAYROLLS.forEach((group)=>{const row=state.payroll.find((item)=>String(item.id||'')===group.payrollId);targetPayrollBefore.set(group.payrollId,historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(row,['commission','total','updatedAt'])))});
    const restore=async()=>{
      state=snapshot;
      let rollbackError=null;
      try{if(!db){try{db=await openDB()}catch(_){db=null}}if(db)await dbSet(STATE_KEY,state)}catch(error){rollbackError=error}
      try{localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state));window.KuSheLegacyData?.refresh()}catch(error){rollbackError=rollbackError||error}
      return rollbackError;
    };
    try {
      HISTORICAL_COMMISSION_REPAIR_TARGETS.forEach((target)=>{
        const commission=state.commissions.find((row)=>String(row.id||'')===target.commissionId),dailyLog=state.dailyLogs.find((row)=>String(row.id||'')===target.dailyLogId);
        dailyLog.commission=target.expectedCommission;
        commission.commission=target.expectedCommission;
        if(target.billingId){dailyLog.performance=target.expectedPerformance;commission.untaxedAmount=target.expectedPerformance}
      });
      const now=new Date().toISOString();
      HISTORICAL_COMMISSION_REPAIR_PAYROLLS.forEach((group)=>recalculateHistoricalCommissionPayroll(group,now));
      if(state.commissions.length!==countsBefore.commissions||state.dailyLogs.length!==countsBefore.dailyLogs||state.payroll.length!==countsBefore.payroll)throw new Error('修復後 commissions、dailyLogs 或 payroll 筆數改變。');
      HISTORICAL_COMMISSION_REPAIR_TARGETS.forEach((target)=>{
        const commissions=state.commissions.filter((row)=>String(row.id||'')===target.commissionId),dailyLogs=state.dailyLogs.filter((row)=>String(row.id||'')===target.dailyLogId),commission=commissions[0],dailyLog=dailyLogs[0];
        if(commissions.length!==1||dailyLogs.length!==1||num(commission.commission)!==target.expectedCommission||num(dailyLog.commission)!==target.expectedCommission||num(commission.untaxedAmount)!==target.expectedPerformance||num(dailyLog.performance)!==target.expectedPerformance)throw new Error(`${target.key} 修復後欄位不符合預期。`);
        if(historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(commission,target.billingId?['untaxedAmount','commission']:['commission']))!==targetCommissionBefore.get(target.commissionId)||historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(dailyLog,target.billingId?['performance','commission']:['commission']))!==targetDailyLogBefore.get(target.dailyLogId))throw new Error(`${target.key} 出現未核准的欄位變動。`);
      });
      const postGroups=monthlyPayrollGroups();
      HISTORICAL_COMMISSION_REPAIR_PAYROLLS.forEach((expected)=>{
        const rows=state.payroll.filter((row)=>String(row.id||'')===expected.payrollId),view=postGroups.find((row)=>String(row.employeeId||'')===expected.employeeId&&String(row.month||'')===expected.month);
        if(rows.length!==1||!view||num(view.total)!==expected.expectedTotal||num(rows[0].total)!==expected.expectedTotal)throw new Error(`${expected.month} ${expected.employeeName} 修復後薪資總額不正確。`);
        if(historicalCommissionRepairFingerprint(historicalCommissionRepairOmit(rows[0],['commission','total','updatedAt']))!==targetPayrollBefore.get(expected.payrollId))throw new Error(`${expected.month} ${expected.employeeName} 的出勤、油費、人工加減項或其他薪資欄位發生變動。`);
        const truth=payrollPaymentTruth(view),lock=payrollHistoryLock(expected.employeeId,expected.month);
        if(num(truth.paid)!==0||truth.explicitPayments.length||truth.verifiedLegacyTransactions.length||truth.bankTransactionIds.length||lock.locked)throw new Error(`${expected.month} ${expected.employeeName} 修復後出現付款鎖。`);
      });
      const postReduction=preview.groups.reduce((sum,row)=>sum+row.currentTotal-(postGroups.find((group)=>group.employeeId===row.employeeId&&group.month===row.month)?.total||0),0);
      if(postReduction!==44598)throw new Error('修復後四組薪資總下降金額不是 44,598。');
      if(historicalCommissionRepairFingerprint(state.commissions.filter((row)=>!targetCommissionIds.has(String(row.id||''))))!==otherCommissionsBefore||historicalCommissionRepairFingerprint(state.dailyLogs.filter((row)=>!targetDailyLogIds.has(String(row.id||''))))!==otherDailyLogsBefore||historicalCommissionRepairFingerprint(state.payroll.filter((row)=>!targetPayrollIds.has(String(row.id||''))))!==otherPayrollBefore)throw new Error('非目標抽成、每日施工或其他薪資紀錄發生變動。');
      if(historicalCommissionRepairFingerprint(state.billings.find((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_BILLING.id))!==billingBefore||historicalCommissionRepairFingerprint(state.receivables)!==receivablesBefore||historicalCommissionRepairFingerprint(state.invoices)!==invoicesBefore||historicalCommissionRepairFingerprint(state.receipts)!==receiptsBefore||historicalCommissionRepairFingerprint(state.retentionReceipts)!==retentionReceiptsBefore)throw new Error(`${HISTORICAL_COMMISSION_REPAIR_BILLING.number} 的請款、應收、發票或收款資料發生變動。`);
      if(historicalCommissionRepairFingerprint(state.commissions.find((row)=>String(row.id||'')===HISTORICAL_COMMISSION_REPAIR_DEFERRED.commissionId))!==deferredBefore)throw new Error('B845317 延後處理項目發生變動。');
      const protectedAfter=historicalCommissionRepairProtectedFingerprints();
      Object.keys(protectedBefore).forEach((key)=>{if(protectedAfter[key]!==protectedBefore[key])throw new Error(`${key} 發生未核准變動。`)});
      await persist(`歷史抽成安全修復｜6 筆未稅抽成校正｜總差額 44,598｜原因：${reason}`);
      const protectedPersisted=historicalCommissionRepairProtectedFingerprints();
      Object.keys(protectedBefore).forEach((key)=>{if(protectedPersisted[key]!==protectedBefore[key])throw new Error(`儲存後 ${key} 發生未核准變動。`)});
      return {...preview,reason,repaired:true,finalGroups:HISTORICAL_COMMISSION_REPAIR_PAYROLLS.map((expected)=>({employeeId:expected.employeeId,employeeName:expected.employeeName,month:expected.month,total:monthlyPayrollGroups().find((row)=>row.employeeId===expected.employeeId&&row.month===expected.month)?.total||0})),totalReduction:44598};
    } catch(error) {
      const rollbackError=await restore();
      if(rollbackError)error.rollbackError=rollbackError;
      throw error;
    }
  }
  const ORPHAN_B920384_CLEANUP_TARGET = Object.freeze({
    billing:{id:'msgxwjuofipz7e',number:'B920384',sourceType:'daily-log-summary',grossTotal:8925,total:8925,invoiceStatus:'invoice_pending',invoiceNo:''},
    dailyLog:{id:'msfwqn64lb9ub2',batchId:'msfwqn64x468hs',date:'2026-08-04',employee:'ms4pb1q8m834ic',employeeName:'林子嶽',project:'ms4p1u5lc5d5ft',projectName:'富宇大地C1區',billingStatus:'已請款',performance:8500,commission:0,workMode:'daily',workQty:1,workRate:2000},
    items:[
      {workItemId:'mspu25iecwamqv',house:'C28',item:'鋁門窗框',qty:7,price:400,untaxedSubtotal:2800},
      {workItemId:'mspu25ie9qwh6h',house:'C28',item:'木門框',qty:10,price:400,untaxedSubtotal:4000},
      {workItemId:'mspu25iel7vx5h',house:'C28',item:'玄關門框',qty:2,price:400,untaxedSubtotal:800},
      {workItemId:'mspu25ie1g46tk',house:'C28',item:'地壁磚',qty:1,price:400,untaxedSubtotal:400},
      {workItemId:'mspu25ieqngi5i',house:'C28',item:'門檻',qty:1,price:500,untaxedSubtotal:500}
    ],
    commission:{id:'msgxwjup65wr8x',sourceType:'daily-log',sourceId:'msfwqn64lb9ub2',employee:'ms4pb1q8m834ic',date:'2026-08-04',commission:0,status:'已列入薪資'},
    attendance:{id:'msgxwjup9zhmb3',sourceType:'daily-log',sourceId:'msfwqn64lb9ub2',employee:'ms4pb1q8m834ic',date:'2026-08-04',days:1,hours:0,amount:2000},
    sibling:{id:'msfwqn658k7id3',batchId:'msfwqn64x468hs',date:'2026-08-04',employee:'ms4pb1q8m834ic',employeeName:'林子嶽',project:'msfwqn63nfvm5t',projectName:'小賴(親家)',billingId:'msfwtqet8zssvp',billingNo:'B643124',billingStatus:'已請款',performance:1750,workMode:'none',workItemId:'mspu25ie7lk4w6',house:'13G',item:'玄關框',qty:1,price:1750},
    payroll:{employee:'ms4pb1q8m834ic',month:'2026-08',unpaid:{id:'msypkfjaycya0r',status:'未付款',days:1,baseSalary:2000,commission:0,total:2000},paid:{id:'msdfc59cbvc6p7',status:'已付款',days:2,baseSalary:4000,commission:0,total:4000,paidAt:'2026-08-17T07:25:34.099Z'}}
  });
  const orphanBillingCleanupText = (value) => String(value ?? '').trim();
  const orphanBillingCleanupClone = (value) => JSON.parse(JSON.stringify(value));
  const orphanBillingCleanupFingerprint = (value) => JSON.stringify(value);
  function orphanBillingCleanupProtectedFingerprints(source) {
    const target=ORPHAN_B920384_CLEANUP_TARGET,mutableKeys=new Set(['billings','dailyLogs','commissions','attendance','payroll','meta','audit']),topLevel={};
    Object.keys(source||{}).sort().forEach((key)=>{if(!mutableKeys.has(key))topLevel[key]=orphanBillingCleanupFingerprint(source[key])});
    return {
      topLevel,
      billings:orphanBillingCleanupFingerprint((source?.billings||[]).filter((row)=>orphanBillingCleanupText(row.id)!==target.billing.id)),
      dailyLogs:orphanBillingCleanupFingerprint((source?.dailyLogs||[]).filter((row)=>orphanBillingCleanupText(row.id)!==target.dailyLog.id)),
      commissions:orphanBillingCleanupFingerprint((source?.commissions||[]).filter((row)=>orphanBillingCleanupText(row.id)!==target.commission.id)),
      attendance:orphanBillingCleanupFingerprint((source?.attendance||[]).filter((row)=>orphanBillingCleanupText(row.id)!==target.attendance.id)),
      payroll:orphanBillingCleanupFingerprint((source?.payroll||[]).filter((row)=>orphanBillingCleanupText(row.id)!==target.payroll.unpaid.id))
    };
  }
  function assertOrphanBillingCleanupProtectedFingerprints(source, expected, stage) {
    const actual=orphanBillingCleanupProtectedFingerprints(source);
    Object.keys(expected.topLevel).forEach((key)=>{if(actual.topLevel[key]!==expected.topLevel[key])throw new Error(`${stage}：非目標資料 ${key} 發生變動。`)});
    ['billings','dailyLogs','commissions','attendance','payroll'].forEach((key)=>{if(actual[key]!==expected[key])throw new Error(`${stage}：非目標 ${key} 發生變動。`)});
  }
  function orphanBillingTestCleanupPlan() {
    const target=ORPHAN_B920384_CLEANUP_TARGET,blockers=[],block=(key,message)=>blockers.push({key,message}),text=orphanBillingCleanupText;
    const billingById=(state.billings||[]).filter((row)=>text(row.id)===target.billing.id),billingByNo=(state.billings||[]).filter((row)=>text(row.number)===target.billing.number),billing=billingById.length===1&&billingByNo.length===1&&billingById[0]===billingByNo[0]?billingById[0]:null;
    if(!billing)block('billing-identity',`Billing ${target.billing.id} / ${target.billing.number} 必須同時唯一且指向同一筆資料。`);
    if(billing&&!(text(billing.sourceType)===target.billing.sourceType&&num(billing.grossTotal)===target.billing.grossTotal&&num(billing.total)===target.billing.total&&text(billing.invoiceStatus)===target.billing.invoiceStatus&&text(billing.invoiceNo)===''))block('billing-values','Billing 類型、金額或待開票狀態已不同於核准基準。');

    const dailyMatches=(state.dailyLogs||[]).filter((row)=>text(row.id)===target.dailyLog.id),dailyLog=dailyMatches[0],dailyIdentity=Boolean(dailyLog)&&text(dailyLog.batchId||dailyLog.id)===target.dailyLog.batchId&&text(dailyLog.date)===target.dailyLog.date&&text(dailyLog.employee||dailyLog.employeeId)===target.dailyLog.employee&&text(dailyLog.employeeName)===target.dailyLog.employeeName&&text(dailyLog.project||dailyLog.projectId)===target.dailyLog.project&&text(dailyLog.projectName)===target.dailyLog.projectName&&text(dailyLog.billingId)===target.billing.id&&text(dailyLog.billingNo)===target.billing.number&&text(dailyLog.billingStatus)===target.dailyLog.billingStatus&&num(dailyLog.performance)===target.dailyLog.performance&&num(dailyLog.commission)===target.dailyLog.commission&&text(dailyLog.workMode)===target.dailyLog.workMode&&num(dailyLog.workQty)===target.dailyLog.workQty&&num(dailyLog.workRate)===target.dailyLog.workRate;
    if(dailyMatches.length!==1||!dailyIdentity)block('daily-log-identity',`Daily Log ${target.dailyLog.id} 不唯一或欄位已不同於核准基準。`);

    const itemRows=Array.isArray(dailyLog?.items)?dailyLog.items:[],itemChecks=target.items.map((expected)=>{
      const matches=itemRows.filter((item)=>text(item.workItemId)===expected.workItemId),item=matches[0],valid=matches.length===1&&text(item.house)===expected.house&&text(item.item||item.itemName)===expected.item&&num(item.qty)===expected.qty&&num(item.price)===expected.price&&num(item.untaxedSubtotal)===expected.untaxedSubtotal&&text(item.billingId)===target.billing.id&&text(item.billingStatus)===target.dailyLog.billingStatus;
      return {...expected,matchCount:matches.length,valid};
    }),itemTotal=itemRows.reduce((sum,item)=>sum+num(item.untaxedSubtotal),0),itemsValid=itemRows.length===target.items.length&&itemChecks.every((row)=>row.valid)&&itemTotal===8500;
    if(!itemsValid)block('work-items','5 個 workItem、戶別、項目、數量、單價、未稅小計或請款鎖定已不同於核准基準。');

    const batchRows=(state.dailyLogs||[]).filter((row)=>text(row.batchId||row.id)===target.dailyLog.batchId),siblingMatches=(state.dailyLogs||[]).filter((row)=>text(row.id)===target.sibling.id),sibling=siblingMatches[0],siblingItems=Array.isArray(sibling?.items)?sibling.items:[],siblingItemMatches=siblingItems.filter((item)=>text(item.workItemId)===target.sibling.workItemId),siblingItem=siblingItemMatches[0];
    const siblingValid=siblingMatches.length===1&&batchRows.length===2&&batchRows.includes(dailyLog)&&batchRows.includes(sibling)&&text(sibling.batchId||sibling.id)===target.sibling.batchId&&text(sibling.date)===target.sibling.date&&text(sibling.employee||sibling.employeeId)===target.sibling.employee&&text(sibling.employeeName)===target.sibling.employeeName&&text(sibling.project||sibling.projectId)===target.sibling.project&&text(sibling.projectName)===target.sibling.projectName&&text(sibling.billingId)===target.sibling.billingId&&text(sibling.billingNo)===target.sibling.billingNo&&text(sibling.billingStatus)===target.sibling.billingStatus&&num(sibling.performance)===target.sibling.performance&&text(sibling.workMode)===target.sibling.workMode&&siblingItems.length===1&&siblingItemMatches.length===1&&text(siblingItem.house)===target.sibling.house&&text(siblingItem.item||siblingItem.itemName)===target.sibling.item&&num(siblingItem.qty)===target.sibling.qty&&num(siblingItem.price)===target.sibling.price;
    if(!siblingValid)block('sibling-daily-log',`同 batch sibling ${target.sibling.id} / ${target.sibling.billingNo} 不存在、不是唯一 sibling，或內容已改變。`);
    const siblingBillingsById=(state.billings||[]).filter((row)=>text(row.id)===target.sibling.billingId),siblingBillingsByNo=(state.billings||[]).filter((row)=>text(row.number)===target.sibling.billingNo),siblingBilling=siblingBillingsById.length===1&&siblingBillingsByNo.length===1&&siblingBillingsById[0]===siblingBillingsByNo[0]?siblingBillingsById[0]:null;
    if(!siblingBilling)block('sibling-billing',`受保護的 sibling Billing ${target.sibling.billingNo} 不唯一或不存在。`);

    const receivableId=text(billing?.receivableId),receivables=billing?(state.receivables||[]).filter((row)=>(receivableId&&text(row.id)===receivableId)||text(row.billingId)===target.billing.id||text(row.sourceId)===target.billing.id||text(row.sourceNo)===target.billing.number):[],receivableIds=new Set(receivables.map((row)=>text(row.id)).filter(Boolean));
    const receipts=billing?(state.receipts||[]).filter((row)=>text(row.billingId)===target.billing.id||text(row.sourceId)===target.billing.id||text(row.sourceNo)===target.billing.number||receivableIds.has(text(row.receivableId))):[];
    const retentionReceipts=billing?(state.retentionReceipts||[]).filter((row)=>text(row.billingId)===target.billing.id||text(row.sourceId)===target.billing.id||text(row.sourceNo)===target.billing.number||receivableIds.has(text(row.receivableId))):[];
    const receiptIds=new Set([...receipts,...retentionReceipts].flatMap((row)=>[text(row.id),text(row.retentionReceiptId)]).filter(Boolean));
    const bankTransactions=billing?(state.bankTransactions||[]).filter((row)=>text(row.billingId)===target.billing.id||text(row.sourceId)===target.billing.id||text(row.sourceNo)===target.billing.number||receivableIds.has(text(row.receivableId))||receivableIds.has(text(row.sourceId))||receiptIds.has(text(row.sourceId))||receiptIds.has(text(row.receiptId))||receiptIds.has(text(row.retentionReceiptId))):[];
    const invoices=billing?(state.invoices||[]).filter((row)=>text(row.billingId)===target.billing.id||text(row.sourceId)===target.billing.id||text(row.sourceNo)===target.billing.number||receivableIds.has(text(row.receivableId))):[];
    if(receivables.length)block('receivables',`找到 ${receivables.length} 筆應收，Billing 不是可清除的孤兒。`);
    if(receipts.length)block('receipts',`找到 ${receipts.length} 筆一般收款。`);
    if(retentionReceipts.length)block('retention-receipts',`找到 ${retentionReceipts.length} 筆保留款收回。`);
    if(bankTransactions.length)block('bank-transactions',`找到 ${bankTransactions.length} 筆關聯銀行交易。`);
    if(invoices.length)block('invoices',`找到 ${invoices.length} 筆關聯發票。`);

    const relatedCommissions=(state.commissions||[]).filter((row)=>text(row.sourceId)===target.dailyLog.id||text(row.billingId)===target.billing.id||text(row.sourceNo)===target.billing.number),commission=relatedCommissions[0],commissionValid=relatedCommissions.length===1&&text(commission.id)===target.commission.id&&text(commission.sourceType)===target.commission.sourceType&&text(commission.sourceId)===target.commission.sourceId&&text(commission.employee||commission.employeeId)===target.commission.employee&&text(commission.date)===target.commission.date&&num(commission.commission)===target.commission.commission&&text(commission.status)===target.commission.status;
    if(!commissionValid)block('commission',`目標 Daily Log 的 Commission 必須精確且唯一為 ${target.commission.id}。`);
    const relatedAttendance=(state.attendance||[]).filter((row)=>text(row.sourceId)===target.dailyLog.id),attendance=relatedAttendance[0],attendanceValid=relatedAttendance.length===1&&text(attendance.id)===target.attendance.id&&text(attendance.sourceType)===target.attendance.sourceType&&text(attendance.sourceId)===target.attendance.sourceId&&text(attendance.employee||attendance.employeeId)===target.attendance.employee&&text(attendance.date)===target.attendance.date&&num(attendance.days)===target.attendance.days&&num(attendance.hours)===target.attendance.hours&&num(attendance.amount)===target.attendance.amount;
    if(!attendanceValid)block('attendance',`目標 Daily Log 的 Attendance 必須精確且唯一為 ${target.attendance.id} / $2,000。`);
    const employeeMonthAttendance=(state.attendance||[]).filter((row)=>text(row.employee||row.employeeId)===target.payroll.employee&&monthOf(row.date)===target.payroll.month),employeeMonthIncludedCommissions=(state.commissions||[]).filter((row)=>text(row.employee||row.employeeId)===target.payroll.employee&&monthOf(row.date)===target.payroll.month&&text(row.status)==='已列入薪資');
    if(employeeMonthAttendance.length!==1||employeeMonthAttendance[0]!==attendance)block('payroll-attendance-source','2026-08 林子嶽的 Attendance 不只目標一筆，禁止重建未付款薪資。');
    if(employeeMonthIncludedCommissions.length!==1||employeeMonthIncludedCommissions[0]!==commission)block('payroll-commission-source','2026-08 林子嶽的已列入薪資 Commission 不只目標一筆，禁止重建未付款薪資。');

    const employeeMonthPayroll=(state.payroll||[]).filter((row)=>text(row.employee||row.employeeId)===target.payroll.employee&&text(row.month)===target.payroll.month),unpaidMatches=(state.payroll||[]).filter((row)=>text(row.id)===target.payroll.unpaid.id),paidMatches=(state.payroll||[]).filter((row)=>text(row.id)===target.payroll.paid.id),unpaid=unpaidMatches[0],paid=paidMatches[0],unpaidNoAdjustments=Boolean(unpaid)&&['fuel','manualFuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'].every((key)=>num(unpaid[key])===0);
    const unpaidValid=unpaidMatches.length===1&&employeeMonthPayroll.length===2&&text(unpaid.employee||unpaid.employeeId)===target.payroll.employee&&text(unpaid.month)===target.payroll.month&&text(unpaid.status)===target.payroll.unpaid.status&&num(unpaid.days)===target.payroll.unpaid.days&&num(unpaid.baseSalary)===target.payroll.unpaid.baseSalary&&num(unpaid.commission)===target.payroll.unpaid.commission&&num(unpaid.total)===target.payroll.unpaid.total&&unpaidNoAdjustments;
    const paidValid=paidMatches.length===1&&employeeMonthPayroll.includes(paid)&&text(paid.employee||paid.employeeId)===target.payroll.employee&&text(paid.month)===target.payroll.month&&text(paid.status)===target.payroll.paid.status&&num(paid.days)===target.payroll.paid.days&&num(paid.baseSalary)===target.payroll.paid.baseSalary&&num(paid.commission)===target.payroll.paid.commission&&num(paid.total)===target.payroll.paid.total&&text(paid.paidAt)===target.payroll.paid.paidAt;
    if(!unpaidValid)block('unpaid-payroll',`未付款 Payroll ${target.payroll.unpaid.id} 不唯一、金額不符、有人工調整或同月薪資列數異常。`);
    if(!paidValid)block('paid-payroll',`受保護的已付款 Payroll ${target.payroll.paid.id} 不唯一或內容已不同於核准基準。`);
    const payrollRecordIds=new Set([target.payroll.unpaid.id,target.payroll.paid.id]),salaryPayments=(state.salaryPayments||[]).filter((row)=>payrollRecordIds.has(text(row.payrollId))||(!text(row.payrollId)&&text(row.employee||row.employeeId)===target.payroll.employee&&monthOf(row.month||row.date)===target.payroll.month));
    const paymentTruth=employeeMonthPayroll.length?payrollPaymentTruth({employee:target.payroll.employee,month:target.payroll.month,recordIds:employeeMonthPayroll.map((row)=>row.id),total:Math.max(0,...employeeMonthPayroll.map((row)=>num(row.total)))}):null,payrollLock=payrollHistoryLock(target.payroll.employee,target.payroll.month),salaryBankTransactions=(state.bankTransactions||[]).filter((row)=>text(row.sourceType)==='salary_payment'&&(payrollRecordIds.has(text(row.payrollId))||text(row.employee||row.employeeId)===target.payroll.employee&&monthOf(row.month||row.date)===target.payroll.month));
    const payrollPaymentSafe=salaryPayments.length===0&&salaryBankTransactions.length===0&&paymentTruth?.hasVerifiedPayment===false&&(paymentTruth?.bankTransactionIds||[]).length===0&&payrollLock.locked===false;
    if(!payrollPaymentSafe)block('payroll-payment-lock','2026-08 林子嶽存在 Salary Payment、已驗證薪資銀行交易或 Payroll lock。');
    if(!db)block('indexeddb','IndexedDB 尚未可用，禁止執行需要直接 rollback 的專用修復。');

    return {
      allowed:blockers.length===0,blockers,target:{billingId:target.billing.id,billingNo:target.billing.number,dailyLogId:target.dailyLog.id,batchId:target.dailyLog.batchId},
      identity:{billingByIdCount:billingById.length,billingByNoCount:billingByNo.length,dailyLogCount:dailyMatches.length,batchRowCount:batchRows.length,siblingCount:siblingMatches.length,siblingBillingIdCount:siblingBillingsById.length,siblingBillingNoCount:siblingBillingsByNo.length},
      amounts:{itemUntaxedTotal:itemTotal,billingGross:num(billing?.grossTotal),billingTotal:num(billing?.total)},itemChecks,
      accounting:{receivableCount:receivables.length,receiptCount:receipts.length,retentionReceiptCount:retentionReceipts.length,bankTransactionCount:bankTransactions.length,invoiceCount:invoices.length},
      derived:{commissionCount:relatedCommissions.length,attendanceCount:relatedAttendance.length,employeeMonthAttendanceCount:employeeMonthAttendance.length,employeeMonthIncludedCommissionCount:employeeMonthIncludedCommissions.length},
      payroll:{rowCount:employeeMonthPayroll.length,unpaidId:unpaid?.id||'',paidId:paid?.id||'',salaryPaymentCount:salaryPayments.length,verifiedSalaryBankTransactionCount:Math.max(salaryBankTransactions.length,(paymentTruth?.bankTransactionIds||[]).length),payrollLocked:Boolean(payrollLock.locked)},
      sibling:{dailyLogId:sibling?.id||'',billingId:siblingBilling?.id||'',billingNo:siblingBilling?.number||'',workItemId:siblingItem?.workItemId||''}
    };
  }
  async function orphanBillingTestCleanupPreview() {
    await load();
    return orphanBillingTestCleanupPlan();
  }
  async function cleanupOrphanBillingTestData(confirmation={}) {
    await load();
    const target=ORPHAN_B920384_CLEANUP_TARGET,reason=orphanBillingCleanupText(confirmation?.reason),preview=orphanBillingTestCleanupPlan();
    if(confirmation?.confirmed!==true)throw new Error(`必須明確確認只清除孤兒測試帳務 ${target.billing.number}。`);
    if(!reason)throw new Error('請輸入孤兒測試帳務清理原因。');
    if(preview.allowed!==true)throw new Error(`孤兒測試帳務不可安全清理：${preview.blockers.map((row)=>row.message).join(' ')}`);
    const snapshot=orphanBillingCleanupClone(state),snapshotFingerprint=orphanBillingCleanupFingerprint(snapshot),protectedBefore=orphanBillingCleanupProtectedFingerprints(state),metaBefore=orphanBillingCleanupFingerprint(state.meta),auditBefore=orphanBillingCleanupFingerprint(state.audit),paidBefore=orphanBillingCleanupFingerprint(state.payroll.find((row)=>orphanBillingCleanupText(row.id)===target.payroll.paid.id)),siblingBefore=orphanBillingCleanupFingerprint(state.dailyLogs.find((row)=>orphanBillingCleanupText(row.id)===target.sibling.id)),siblingBillingBefore=orphanBillingCleanupFingerprint(state.billings.find((row)=>orphanBillingCleanupText(row.id)===target.sibling.billingId)),countsBefore={billings:state.billings.length,dailyLogs:state.dailyLogs.length,commissions:state.commissions.length,attendance:state.attendance.length,payroll:state.payroll.length};
    const assertPostState=(source,stage)=>{
      if((source.billings||[]).some((row)=>orphanBillingCleanupText(row.id)===target.billing.id||orphanBillingCleanupText(row.number)===target.billing.number))throw new Error(`${stage}：${target.billing.number} 尚未完整移除。`);
      if((source.dailyLogs||[]).some((row)=>orphanBillingCleanupText(row.id)===target.dailyLog.id))throw new Error(`${stage}：目標 Daily Log 尚未移除。`);
      if((source.commissions||[]).some((row)=>orphanBillingCleanupText(row.id)===target.commission.id))throw new Error(`${stage}：目標 Commission 尚未移除。`);
      if((source.attendance||[]).some((row)=>orphanBillingCleanupText(row.id)===target.attendance.id))throw new Error(`${stage}：目標 Attendance 尚未移除。`);
      if((source.payroll||[]).some((row)=>orphanBillingCleanupText(row.id)===target.payroll.unpaid.id))throw new Error(`${stage}：無來源的未付款 Payroll 尚未移除。`);
      if(orphanBillingCleanupFingerprint((source.payroll||[]).find((row)=>orphanBillingCleanupText(row.id)===target.payroll.paid.id))!==paidBefore)throw new Error(`${stage}：歷史已付款 Payroll 發生變動。`);
      if(orphanBillingCleanupFingerprint((source.dailyLogs||[]).find((row)=>orphanBillingCleanupText(row.id)===target.sibling.id))!==siblingBefore)throw new Error(`${stage}：同 batch sibling Daily Log 發生變動。`);
      if(orphanBillingCleanupFingerprint((source.billings||[]).find((row)=>orphanBillingCleanupText(row.id)===target.sibling.billingId))!==siblingBillingBefore)throw new Error(`${stage}：受保護的 ${target.sibling.billingNo} 發生變動。`);
      assertOrphanBillingCleanupProtectedFingerprints(source,protectedBefore,stage);
    };
    const restore=async()=>{
      state=orphanBillingCleanupClone(snapshot);
      if(!db)db=await openDB();
      if(!db)throw new Error('rollback 無法取得 IndexedDB。');
      await dbSet(STATE_KEY,state);
      localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state));
      window.KuSheLegacyData?.refresh();
      const dbState=await dbGet(STATE_KEY),emergency=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null');
      if(orphanBillingCleanupFingerprint(state)!==snapshotFingerprint||orphanBillingCleanupFingerprint(dbState)!==snapshotFingerprint||orphanBillingCleanupFingerprint(emergency)!==snapshotFingerprint)throw new Error('rollback fingerprint 驗證失敗。');
      return true;
    };
    try {
      state.billings=state.billings.filter((row)=>orphanBillingCleanupText(row.id)!==target.billing.id);
      state.dailyLogs=state.dailyLogs.filter((row)=>orphanBillingCleanupText(row.id)!==target.dailyLog.id);
      state.commissions=state.commissions.filter((row)=>orphanBillingCleanupText(row.id)!==target.commission.id);
      state.attendance=state.attendance.filter((row)=>orphanBillingCleanupText(row.id)!==target.attendance.id);
      rebuildPayrollFor(target.payroll.month,target.payroll.employee);
      assertPostState(state,'persist 前');
      if(state.billings.length!==countsBefore.billings-1||state.dailyLogs.length!==countsBefore.dailyLogs-1||state.commissions.length!==countsBefore.commissions-1||state.attendance.length!==countsBefore.attendance-1||state.payroll.length!==countsBefore.payroll-1)throw new Error('persist 前：目標 collections 筆數不符合精確移除範圍。');
      if(orphanBillingCleanupFingerprint(state.meta)!==metaBefore||orphanBillingCleanupFingerprint(state.audit)!==auditBefore)throw new Error('persist 前：meta 或 audit 提前發生變動。');
      await persist(`孤兒測試帳務專用清理｜${target.billing.number}｜原因：${reason}`);
      assertPostState(state,'persist 後記憶體');
      const persistedState=await dbGet(STATE_KEY),emergencyState=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null');
      assertPostState(persistedState,'persist 後 IndexedDB');
      assertPostState(emergencyState,'persist 後 emergency backup');
      return {...preview,reason,cleaned:true,singlePersist:true,removed:{billing:1,dailyLog:1,commission:1,attendance:1,unpaidPayroll:1},protected:{paidPayroll:target.payroll.paid.id,siblingDailyLog:target.sibling.id,siblingBilling:target.sibling.billingNo}};
    } catch(error) {
      try { await restore(); error.rollbackVerified=true; }
      catch(rollbackError) { error.rollbackVerified=false; error.rollbackError=rollbackError; }
      throw error;
    }
  }
  const FINANCIAL_INTEGRITY_REPAIR = Object.freeze({
    SAFE:'SAFE_AUTO_REPAIR_CANDIDATE',
    SEMANTIC:'NEEDS_SEMANTIC_REPAIR',
    LEGACY:'KEEP_AS_VERIFIED_LEGACY',
    MANUAL:'BLOCK_MANUAL_REVIEW'
  });
  const financialAuditText=(value)=>String(value??'').trim();
  const financialAuditMoneyEqual=(left,right)=>Math.abs(num(left)-num(right))<0.01;
  const financialAuditUnique=(rows)=>[...new Set(rows)];
  const financialAuditHas=(row,key)=>Object.prototype.hasOwnProperty.call(row||{},key)&&row[key]!==undefined&&row[key]!==null&&row[key]!=='';
  const financialAuditFirst=(row,keys,fallback=0)=>{
    for(const key of keys)if(financialAuditHas(row,key))return row[key];
    return fallback;
  };
  const financialAuditDuplicateGroups=(rows,valueFor,idFor)=>{
    const groups=new Map();
    rows.forEach((row,index)=>{const value=financialAuditText(valueFor(row));if(!value)return;if(!groups.has(value))groups.set(value,[]);groups.get(value).push(financialAuditText(idFor(row,index))||`index:${index}`)});
    return [...groups.entries()].filter(([,ids])=>ids.length>1).map(([value,ids])=>({value,count:ids.length,ids}));
  };
  function financialIntegrityAuditReport() {
    const repair=FINANCIAL_INTEGRITY_REPAIR,issues=[];
    const billings=state.billings||[],receivables=state.receivables||[],receipts=state.receipts||[],retentionReceipts=state.retentionReceipts||[],invoices=state.invoices||[],dailyLogs=state.dailyLogs||[],payrollRows=state.payroll||[],payables=state.payables||[],payments=state.payments||[],salaryPayments=state.salaryPayments||[],bankTransactions=state.bankTransactions||[],materialUsages=state.materialUsages||[];
    const addIssue=(section,id,code,severity,repairClassification,message)=>{issues.push({section,id:financialAuditText(id),code,severity,repairClassification,message})};
    const billingValues=(billing)=>{
      const lineUntaxed=(billing.lines||[]).reduce((sum,line)=>sum+num(line.untaxedSubtotal??line.preTaxAmount??line.amount??num(line.qty)*num(line.price)),0);
      const amount=num(financialAuditFirst(billing,['amount','preTaxAmount'],lineUntaxed));
      const tax=num(financialAuditFirst(billing,['tax','taxAmount'],0));
      const gross=num(financialAuditFirst(billing,['grossTotal','taxIncludedAmount'],amount+tax));
      const retention=num(financialAuditFirst(billing,['retention','retentionAmount'],0));
      const total=num(financialAuditFirst(billing,['total'],gross-retention));
      return {constructionAmount:num(financialAuditFirst(billing,['constructionAmount'],lineUntaxed)),amount,preTaxAmount:num(financialAuditFirst(billing,['preTaxAmount','amount'],amount)),tax,taxAmount:num(financialAuditFirst(billing,['taxAmount','tax'],tax)),grossTotal:gross,taxIncludedAmount:num(financialAuditFirst(billing,['taxIncludedAmount','grossTotal'],gross)),retention,retentionAmount:num(financialAuditFirst(billing,['retentionAmount','retention'],retention)),remainingRetention:num(financialAuditFirst(billing,['remainingRetention'],retention)),total};
    };
    const billingMatchesForReceivable=(receivable)=>financialAuditUnique(billings.filter((billing)=>
      financialAuditText(receivable.billingId)&&financialAuditText(receivable.billingId)===financialAuditText(billing.id)||
      financialAuditText(receivable.sourceNo)&&financialAuditText(receivable.sourceNo)===financialAuditText(billing.number)||
      financialAuditText(billing.receivableId)&&financialAuditText(billing.receivableId)===financialAuditText(receivable.id)
    ));
    const receivableMatchesForBilling=(billing)=>financialAuditUnique(receivables.filter((receivable)=>
      financialAuditText(billing.receivableId)&&financialAuditText(billing.receivableId)===financialAuditText(receivable.id)||
      financialAuditText(receivable.billingId)&&financialAuditText(receivable.billingId)===financialAuditText(billing.id)||
      financialAuditText(receivable.sourceNo)&&financialAuditText(receivable.sourceNo)===financialAuditText(billing.number)
    ));
    const receivableReceiptRows=(receivable)=>receipts.filter((receipt)=>financialAuditText(receipt.receivableId)===financialAuditText(receivable.id));
    const receivableRetentionRows=(receivable)=>retentionReceipts.filter((receipt)=>financialAuditText(receipt.receivableId)===financialAuditText(receivable.id));
    const receivableIdentityBankRows=(receivable,billing=null)=>bankTransactions.filter((transaction)=>{
      const receivableId=financialAuditText(receivable.id),billingId=financialAuditText(billing?.id||receivable.billingId),sourceNo=financialAuditText(billing?.number||receivable.sourceNo);
      return receivableId&&financialAuditText(transaction.receivableId)===receivableId||
        billingId&&financialAuditText(transaction.billingId)===billingId||
        receivableId&&financialAuditText(transaction.sourceId)===receivableId||
        sourceNo&&financialAuditText(transaction.sourceNo)===sourceNo;
    });
    const legacyBankEvidence=(receivable,billing=null)=>{
      const principal=num(receivable.legacyReceived),candidates=receivableIdentityBankRows(receivable,billing).filter((transaction)=>{
        const semantics=`${transaction.sourceType||''} ${transaction.type||''} ${transaction.category||''} ${transaction.description||''}`;
        const incoming=['in','income'].includes(financialAuditText(transaction.direction).toLocaleLowerCase('en-US'))||/收入|入帳|收款/u.test(financialAuditText(transaction.type));
        return incoming&&/receipt|receivable|legacy|收款|應收/u.test(semantics);
      });
      const amountMatches=(transaction)=>[transaction.receiptAmount,transaction.amount,transaction.netAmount,transaction.actualCredit,num(transaction.actualCredit)+num(transaction.fee)].some((value)=>value!==undefined&&value!==null&&value!==''&&financialAuditMoneyEqual(value,principal));
      const verified=candidates.length===1&&amountMatches(candidates[0]);
      return {legacyBankCandidateCount:candidates.length,legacyBankVerified:verified,legacyBankTransactionIds:candidates.map((row)=>financialAuditText(row.id)),candidateAmounts:candidates.map((row)=>({id:financialAuditText(row.id),amount:num(row.amount),netAmount:num(row.netAmount),actualCredit:num(row.actualCredit),fee:num(row.fee),amountMatches:amountMatches(row)}))};
    };
    const receiptTruthFor=(receivable,billing=null)=>{
      const explicitRows=receivableReceiptRows(receivable),explicitReceiptTotal=explicitRows.reduce((sum,row)=>sum+num(row.amount),0),legacyReceived=num(receivable.legacyReceived),storedReceived=num(receivable.received),expectedReceived=Math.min(num(receivable.amount),legacyReceived+explicitReceiptTotal),legacyEvidence=legacyReceived>0?legacyBankEvidence(receivable,billing):{legacyBankCandidateCount:0,legacyBankVerified:false,legacyBankTransactionIds:[],candidateAmounts:[]};
      const classification=explicitReceiptTotal>0?'MODERN_RECEIPT':legacyReceived>0?(legacyEvidence.legacyBankVerified?'LEGACY_RECEIVED_VERIFIED':'LEGACY_RECEIVED_UNVERIFIED'):'NO_RECEIPT';
      return {classification,explicitReceiptCount:explicitRows.length,explicitReceiptTotal,legacyReceived,storedReceived,expectedReceived,storedReceivedMatch:financialAuditMoneyEqual(storedReceived,expectedReceived),...legacyEvidence};
    };
    const billingReceivablePairs=billings.map((billing)=>{
      const matches=receivableMatchesForBilling(billing),relation=matches.length===1?'EXACT':matches.length===0?'ORPHAN':'AMBIGUOUS',values=billingValues(billing),receivable=matches.length===1?matches[0]:null;
      const receivedRetention=num(receivable?.retentionReceived),receivableRetention=num(financialAuditFirst(receivable,['retentionAmount','retention'],values.retention)),remainingRetention=num(financialAuditFirst(receivable,['remainingRetention'],Math.max(0,receivableRetention-receivedRetention)));
      const amountChecks=receivable?{amountMatch:financialAuditMoneyEqual(receivable.amount,values.total),grossMatch:financialAuditMoneyEqual(financialAuditFirst(receivable,['grossTotal','taxIncludedAmount'],values.grossTotal),values.grossTotal),untaxedMatch:financialAuditMoneyEqual(financialAuditFirst(receivable,['untaxedAmount','preTaxAmount'],values.amount),values.amount),taxMatch:financialAuditMoneyEqual(financialAuditFirst(receivable,['tax','taxAmount'],values.tax),values.tax),retentionMatch:financialAuditMoneyEqual(receivableRetention,values.retention)&&financialAuditMoneyEqual(remainingRetention,Math.max(0,values.retention-receivedRetention))}:null;
      const amountMatch=Boolean(amountChecks&&Object.values(amountChecks).every(Boolean));
      if(relation==='ORPHAN')addIssue('billing-receivable',billing.id,'ORPHAN_BILLING','BLOCKING',repair.SEMANTIC,'Billing 找不到對應 Receivable。');
      if(relation==='AMBIGUOUS')addIssue('billing-receivable',billing.id,'AMBIGUOUS_BILLING_RECEIVABLE','BLOCKING',repair.MANUAL,'Billing 對應到多筆 Receivable。');
      if(receivable&&!amountMatch)addIssue('billing-receivable',billing.id,'BILLING_AMOUNT_MISMATCH','BLOCKING',repair.SEMANTIC,'Billing 與 Receivable 金額欄位不一致。');
      const matchEvidence=matches.map((row)=>({receivableId:row.id,directReceivableId:financialAuditText(billing.receivableId)===financialAuditText(row.id),billingId:financialAuditText(row.billingId)===financialAuditText(billing.id),sourceNo:financialAuditText(row.sourceNo)===financialAuditText(billing.number)}));
      return {id:billing.id,number:billing.number||'',date:billing.date||'',customer:billing.customer||'',customerName:billing.customerName||'',project:billing.project||'',projectName:billing.projectName||'',sourceType:billing.sourceType||'',...values,receivableMatchCount:matches.length,receivableIds:matches.map((row)=>row.id),matchEvidence,relation,receivableAmounts:receivable?{amount:num(receivable.amount),grossTotal:num(financialAuditFirst(receivable,['grossTotal','taxIncludedAmount'],0)),untaxedAmount:num(financialAuditFirst(receivable,['untaxedAmount','preTaxAmount'],0)),tax:num(financialAuditFirst(receivable,['tax','taxAmount'],0)),retentionAmount:receivableRetention,remainingRetention}:null,amountChecks,amountMatch,repairClassification:relation==='AMBIGUOUS'?repair.MANUAL:relation==='ORPHAN'||!amountMatch?repair.SEMANTIC:null};
    });
    const semanticBillingCandidates=(receivable)=>billings.map((billing)=>{
      const values=billingValues(billing),reasons=[];
      if(financialAuditText(receivable.project)&&financialAuditText(receivable.project)===financialAuditText(billing.project))reasons.push(['projectId',4]);
      if(financialAuditText(receivable.projectName)&&financialAuditText(receivable.projectName)===financialAuditText(billing.projectName))reasons.push(['projectName',2]);
      if(financialAuditText(receivable.customer)&&financialAuditText(receivable.customer)===financialAuditText(billing.customer))reasons.push(['customerId',3]);
      if(financialAuditText(receivable.customerName)&&financialAuditText(receivable.customerName)===financialAuditText(billing.customerName))reasons.push(['customerName',2]);
      if(financialAuditText(receivable.date)&&financialAuditText(receivable.date)===financialAuditText(billing.date))reasons.push(['date',2]);
      if(num(receivable.amount)>0&&financialAuditMoneyEqual(receivable.amount,values.total))reasons.push(['amount',3]);
      if(num(receivable.grossTotal)>0&&financialAuditMoneyEqual(receivable.grossTotal,values.grossTotal))reasons.push(['grossTotal',3]);
      const score=reasons.reduce((sum,[,value])=>sum+value,0);
      return {billingId:billing.id,billingNo:billing.number||'',score,reasons:reasons.map(([name])=>name)};
    }).filter((row)=>row.score>=5).sort((a,b)=>b.score-a.score);
    const receivableAudit=receivables.map((receivable)=>{
      const billingMatches=billingMatchesForReceivable(receivable),billing=billingMatches.length===1?billingMatches[0]:null,truth=receiptTruthFor(receivable,billing),receiptRows=receivableReceiptRows(receivable),retentionRows=receivableRetentionRows(receivable),bankRows=receivableIdentityBankRows(receivable,billing),invoiceRowsFor=invoices.filter((invoice)=>financialAuditText(invoice.receivableId)===financialAuditText(receivable.id)||billing&&[financialAuditText(billing.id),financialAuditText(billing.number)].includes(financialAuditText(invoice.billingId||invoice.sourceId||invoice.sourceNo)));
      const candidates=billingMatches.length?[]:semanticBillingCandidates(receivable);
      let orphanClassification='';
      if(!billingMatches.length){
        if(candidates.length===1)orphanClassification='LIKELY_DUPLICATE';
        else if(candidates.length>1)orphanClassification='AMBIGUOUS';
        else if(!receiptRows.length&&!retentionRows.length&&!bankRows.length&&!invoiceRowsFor.length&&num(receivable.received)===0&&num(receivable.legacyReceived)===0)orphanClassification='ORPHAN_EMPTY';
        else if(receiptRows.length||truth.legacyBankVerified)orphanClassification='LEGACY_SETTLED';
        else orphanClassification='LEGACY_OPEN';
      }
      let repairClassification=null;
      if(orphanClassification==='ORPHAN_EMPTY')repairClassification=repair.SAFE;
      else if(orphanClassification==='LIKELY_DUPLICATE')repairClassification=repair.SEMANTIC;
      else if(orphanClassification==='LEGACY_SETTLED')repairClassification=repair.LEGACY;
      else if(orphanClassification)repairClassification=repair.MANUAL;
      if(orphanClassification)addIssue('receivable',receivable.id,orphanClassification,orphanClassification==='ORPHAN_EMPTY'?'WARNING':'BLOCKING',repairClassification,'Receivable 找不到直接 Billing 關聯。');
      if(!truth.storedReceivedMatch)addIssue('receivable',receivable.id,'STORED_RECEIVED_MISMATCH','BLOCKING',repair.SEMANTIC,'stored received 與 receipt truth 加總不一致。');
      if(truth.classification==='LEGACY_RECEIVED_UNVERIFIED')addIssue('receivable',receivable.id,'UNVERIFIED_LEGACY_RECEIVED','BLOCKING',repair.MANUAL,'legacyReceived 找不到唯一可信銀行收款證據。');
      return {id:receivable.id,date:receivable.date||'',project:receivable.project||'',projectName:receivable.projectName||'',customer:receivable.customer||'',customerName:receivable.customerName||'',sourceNo:receivable.sourceNo||'',amount:num(receivable.amount),grossTotal:num(receivable.grossTotal),received:num(receivable.received),legacyReceived:num(receivable.legacyReceived),billingMatchCount:billingMatches.length,billingIds:billingMatches.map((row)=>row.id),receiptCount:receiptRows.length,retentionReceiptCount:retentionRows.length,bankTransactionCount:bankRows.length,invoiceCount:invoiceRowsFor.length,receiptTruth:truth,semanticBillingCandidates:candidates,orphanClassification,repairClassification};
    });
    const bankMatchesForReceipt=(receipt,isRetention=false)=>bankTransactions.filter((transaction)=>{
      const sourceTypes=isRetention?['retention_receipt','retention-receipt']:['receipt','receivable_receipt'];
      const directId=financialAuditText(receipt.id),retentionId=financialAuditText(receipt.retentionReceiptId);
      return financialAuditText(receipt.bankTransactionId)&&financialAuditText(transaction.id)===financialAuditText(receipt.bankTransactionId)||
        sourceTypes.includes(financialAuditText(transaction.sourceType))&&(directId&&financialAuditText(transaction.sourceId)===directId||isRetention&&retentionId&&financialAuditText(transaction.sourceId)===retentionId)||
        !isRetention&&directId&&financialAuditText(transaction.receiptId)===directId||
        isRetention&&(directId&&financialAuditText(transaction.retentionReceiptId)===directId||retentionId&&financialAuditText(transaction.retentionReceiptId)===retentionId);
    });
    const auditReceipt=(receipt,isRetention=false)=>{
      const collection=isRetention?retentionReceipts:receipts,receivableMatches=receivables.filter((receivable)=>financialAuditText(receipt.receivableId)===financialAuditText(receivable.id)),billingMatches=financialAuditUnique(billings.filter((billing)=>financialAuditText(receipt.billingId)&&financialAuditText(receipt.billingId)===financialAuditText(billing.id)||receivableMatches.some((receivable)=>billingMatchesForReceivable(receivable).includes(billing)))),bankMatches=financialAuditUnique(bankMatchesForReceipt(receipt,isRetention)),transaction=bankMatches.length===1?bankMatches[0]:null;
      const amountMismatch=Boolean(transaction&&!financialAuditMoneyEqual(financialAuditFirst(transaction,['receiptAmount'],transaction.amount),receipt.amount));
      const expectedNet=num(financialAuditFirst(receipt,['netAmount'],num(receipt.amount)-(receipt.feePayer==='recipient'?num(receipt.fee):0))),netAmountMismatch=Boolean(transaction&&!financialAuditMoneyEqual(financialAuditFirst(transaction,['actualCredit','netAmount','amount'],0),expectedNet));
      const orphanReceipt=receivableMatches.length===0,ambiguousReceipt=receivableMatches.length>1,missingBankTransaction=bankMatches.length===0,duplicateBankTransaction=bankMatches.length>1;
      const section=isRetention?'retention-receipt':'receipt';
      if(orphanReceipt)addIssue(section,receipt.id,'ORPHAN_RECEIPT','BLOCKING',repair.MANUAL,'收款找不到 Receivable。');
      if(ambiguousReceipt)addIssue(section,receipt.id,'AMBIGUOUS_RECEIPT','BLOCKING',repair.MANUAL,'收款對應多筆 Receivable。');
      if(isRetention&&billingMatches.length!==1)addIssue(section,receipt.id,billingMatches.length?'AMBIGUOUS_RETENTION_BILLING':'ORPHAN_RETENTION_BILLING','BLOCKING',repair.MANUAL,'保留款收回無法唯一反查 Billing。');
      if(missingBankTransaction)addIssue(section,receipt.id,'MISSING_BANK_TRANSACTION','BLOCKING',repair.SEMANTIC,'收款缺少銀行流水。');
      if(duplicateBankTransaction)addIssue(section,receipt.id,'DUPLICATE_BANK_TRANSACTION','BLOCKING',repair.MANUAL,'收款對應多筆銀行流水。');
      if(amountMismatch||netAmountMismatch)addIssue(section,receipt.id,'RECEIPT_BANK_AMOUNT_MISMATCH','BLOCKING',repair.SEMANTIC,'收款與銀行流水金額不一致。');
      return {id:receipt.id,retentionReceiptId:receipt.retentionReceiptId||'',receivableId:receipt.receivableId||'',billingId:receipt.billingId||'',amount:num(receipt.amount),netAmount:expectedNet,duplicateIdentityCount:collection.filter((row)=>financialAuditText(row.id)===financialAuditText(receipt.id)).length,receivableMatchCount:receivableMatches.length,billingMatchCount:billingMatches.length,billingIds:billingMatches.map((row)=>row.id),bankTransactionIds:bankMatches.map((row)=>row.id),orphanReceipt,ambiguousReceipt,missingBankTransaction,duplicateBankTransaction,amountMismatch,netAmountMismatch,repairClassification:orphanReceipt||ambiguousReceipt||duplicateBankTransaction||isRetention&&billingMatches.length!==1?repair.MANUAL:missingBankTransaction||amountMismatch||netAmountMismatch?repair.SEMANTIC:null};
    };
    const receiptAudit=receipts.map((row)=>auditReceipt(row,false)),retentionReceiptAudit=retentionReceipts.map((row)=>auditReceipt(row,true));
    const outputInvoices=invoices.filter((row)=>row.invoiceType!=='input'&&!/進項/u.test(financialAuditText(row.type)));
    const invoiceAudit=outputInvoices.map((invoice)=>{
      const number=financialAuditText(invoice.invoiceNumber||invoice.invoiceNo||invoice.number),billingMatches=financialAuditUnique(billings.filter((billing)=>
        financialAuditText(invoice.billingId)&&financialAuditText(invoice.billingId)===financialAuditText(billing.id)||
        financialAuditText(invoice.sourceId)&&financialAuditText(invoice.sourceId)===financialAuditText(billing.id)||
        financialAuditText(invoice.sourceNo)&&financialAuditText(invoice.sourceNo)===financialAuditText(billing.number)||
        number&&number===financialAuditText(billing.invoiceNo)
      )),billing=billingMatches.length===1?billingMatches[0]:null,values=billing?billingValues(billing):null;
      const receivableMatches=financialAuditUnique(receivables.filter((receivable)=>financialAuditText(invoice.receivableId)&&financialAuditText(invoice.receivableId)===financialAuditText(receivable.id)||billingMatches.some((matchedBilling)=>billingMatchesForReceivable(receivable).includes(matchedBilling)))),orphanInvoice=billingMatches.length===0,ambiguousInvoice=billingMatches.length>1,receivableLinkMismatch=billingMatches.length===1&&receivableMatches.length!==1,amountMismatch=Boolean(values&&(!financialAuditMoneyEqual(financialAuditFirst(invoice,['netAmount','amount'],0),values.amount)||!financialAuditMoneyEqual(financialAuditFirst(invoice,['taxAmount','tax'],0),values.tax)||!financialAuditMoneyEqual(financialAuditFirst(invoice,['grossAmount','total'],0),values.grossTotal)));
      const actualStatus=invoiceStatus(invoice.status,number),expectedStatus=billing?billingInvoiceStatus(billing):'',statusMismatch=Boolean(billing&&!((expectedStatus==='invoiced'&&actualStatus==='issued')||(expectedStatus==='invoice_pending'&&actualStatus==='pending')||(expectedStatus==='no_invoice'&&actualStatus==='void')));
      if(orphanInvoice)addIssue('invoice',invoice.id,'ORPHAN_INVOICE','BLOCKING',repair.MANUAL,'銷項發票找不到 Billing。');
      if(ambiguousInvoice)addIssue('invoice',invoice.id,'AMBIGUOUS_INVOICE','BLOCKING',repair.MANUAL,'銷項發票對應多筆 Billing。');
      if(receivableLinkMismatch)addIssue('invoice',invoice.id,'INVOICE_RECEIVABLE_LINK_MISMATCH','BLOCKING',repair.MANUAL,'銷項發票無法透過 Billing 唯一反查 Receivable。');
      if(amountMismatch)addIssue('invoice',invoice.id,'INVOICE_AMOUNT_MISMATCH','BLOCKING',repair.SEMANTIC,'銷項發票與 Billing 金額不一致。');
      if(statusMismatch)addIssue('invoice',invoice.id,'INVOICE_STATUS_MISMATCH','WARNING',repair.SEMANTIC,'銷項發票與 Billing 狀態不一致。');
      return {id:invoice.id,invoiceNo:number,billingMatchCount:billingMatches.length,billingIds:billingMatches.map((row)=>row.id),receivableMatchCount:receivableMatches.length,receivableIds:receivableMatches.map((row)=>row.id),orphanInvoice,ambiguousInvoice,receivableLinkMismatch,amountMismatch,statusMismatch,actualStatus,expectedStatus,repairClassification:orphanInvoice||ambiguousInvoice||receivableLinkMismatch?repair.MANUAL:amountMismatch||statusMismatch?repair.SEMANTIC:null};
    });
    const allDailyItems=dailyLogs.flatMap((log)=>(log.items||[]).map((item,index)=>({log,item,index}))),allDailyBillingRows=dailyLogs.flatMap((log)=>(log.items||[]).length?(log.items||[]).map((item,index)=>({log,item,index})):[{log,item:{},index:null}]);
    const billingSources=billings.map((billing)=>{
      const sourceType=financialAuditText(billing.sourceType),sourceCategory=['daily-work','mixed-pricing','quotation-progress','daily-log-summary','legacy-ar-invoice-rebuild'].includes(sourceType)?sourceType:'UNKNOWN_SOURCE',legacy=['daily-log-summary','legacy-ar-invoice-rebuild'].includes(sourceCategory),itemRefs=[...(billing.sourceItemRefs||[]),...(billing.lines||[]).flatMap((line)=>line.sourceRefs||[])],contractRefs=[...(billing.sourceContractRefs||[]),...(billing.lines||[]).flatMap((line)=>line.sourceContractRefs||[])];
      const itemRefChecks=itemRefs.map((ref)=>{const matches=allDailyItems.filter(({log,item,index})=>sourceMatches(ref,log,item,index));return {workItemId:ref.workItemId||'',sourceGroupKey:ref.sourceGroupKey||'',sourceItemIndex:ref.sourceItemIndex??null,matchCount:matches.length,dailyLogIds:[...new Set(matches.map(({log})=>log.id))],valid:matches.length>0}});
      const contractRefChecks=contractRefs.map((ref)=>{const source=financialAuditText(ref.contractKey)?contractSourceByKey(ref.contractKey):null;return {contractKey:ref.contractKey||'',quotationId:ref.quotationId||'',quotationLineId:ref.quotationLineId||'',valid:Boolean(source),matchedQuotationId:source?.quotationId||''}});
      const modern=['daily-work','mixed-pricing','quotation-progress'].includes(sourceType),requiresItems=['daily-work','mixed-pricing'].includes(sourceType),requiresContracts=sourceType==='quotation-progress',sourceOrphan=Boolean(modern&&((requiresItems&&!itemRefs.length&&!(sourceType==='mixed-pricing'&&contractRefs.length))||(requiresContracts&&!contractRefs.length&&!itemRefs.length)||itemRefChecks.some((row)=>!row.valid)||contractRefChecks.some((row)=>!row.valid)));
      if(sourceOrphan)addIssue('billing-source',billing.id,'SOURCE_ORPHAN','BLOCKING',repair.MANUAL,'Billing 找不到完整施工或承攬來源。');
      if(sourceCategory==='UNKNOWN_SOURCE')addIssue('billing-source',billing.id,'UNKNOWN_BILLING_SOURCE_TYPE','WARNING',repair.MANUAL,'Billing sourceType 無法分類。');
      return {billingId:billing.id,billingNo:billing.number||'',sourceType,sourceCategory,modern,classification:legacy?'LEGACY_SOURCE':sourceCategory==='UNKNOWN_SOURCE'?'UNKNOWN_SOURCE':sourceOrphan?'SOURCE_ORPHAN':'SOURCE_VALID',itemRefCount:itemRefs.length,contractRefCount:contractRefs.length,itemRefChecks,contractRefChecks,sourceOrphan,repairClassification:legacy?repair.LEGACY:sourceOrphan||sourceCategory==='UNKNOWN_SOURCE'?repair.MANUAL:null};
    });
    const dailyBillingLinks=allDailyBillingRows.filter(({log,item})=>financialAuditText(item.billingStatus||log.billingStatus)==='已請款'||financialAuditText(item.billingId||log.billingId)).map(({log,item,index})=>{
      const billingId=financialAuditText(item.billingId||log.billingId),billingNo=financialAuditText(item.billingNo||log.billingNo),matches=financialAuditUnique(billings.filter((billing)=>billingId&&financialAuditText(billing.id)===billingId||!billingId&&billingNo&&financialAuditText(billing.number)===billingNo)),billing=matches.length===1?matches[0]:null,dailyOrphanBilling=matches.length===0,ambiguous=matches.length>1,dailyBillingMismatch=Boolean(billing&&billingNo&&financialAuditText(billing.number)!==billingNo);
      if(dailyOrphanBilling)addIssue('daily-billing',item.workItemId||`${log.id}:${index}`,'DAILY_ORPHAN_BILLING','BLOCKING',repair.MANUAL,'已請款 Daily item 找不到 Billing。');
      if(ambiguous)addIssue('daily-billing',item.workItemId||`${log.id}:${index}`,'DAILY_AMBIGUOUS_BILLING','BLOCKING',repair.MANUAL,'Daily item 對應多筆 Billing。');
      if(dailyBillingMismatch)addIssue('daily-billing',item.workItemId||`${log.id}:${index}`,'DAILY_BILLING_MISMATCH','BLOCKING',repair.SEMANTIC,'Daily item 的 billingNo 與 Billing 不一致。');
      return {dailyLogId:log.id,workItemId:item.workItemId||'',billingStatus:item.billingStatus||log.billingStatus||'',billingId,billingNo,billingMatchCount:matches.length,dailyOrphanBilling,ambiguous,dailyBillingMismatch,repairClassification:dailyOrphanBilling||ambiguous?repair.MANUAL:dailyBillingMismatch?repair.SEMANTIC:null};
    });
    const payrollAudit=payrollRows.map((payroll)=>{
      const employeeId=payrollEmployeeId(payroll),month=financialAuditText(payroll.month||payroll.date).slice(0,7),attendanceRows=(state.attendance||[]).filter((row)=>financialAuditText(row.employee||row.employeeId)===employeeId&&monthOf(row.date)===month),commissionRows=(state.commissions||[]).filter((row)=>financialAuditText(row.employee||row.employeeId)===employeeId&&monthOf(row.date)===month&&row.status==='已列入薪資'),adjustmentTotal=['manualFuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'].reduce((sum,key)=>sum+Math.abs(num(payroll[key])),0),truth=payrollPaymentTruth(payroll),hasSources=attendanceRows.length>0||commissionRows.length>0||adjustmentTotal>0,stalePayrollStatus=!truth.hasVerifiedPayment&&(payroll.status==='已付款'||num(payroll.paidAmount)>0||Boolean(payroll.payDate)||Boolean(payroll.paidAt)||Boolean(payroll.paymentTransactionId)),orphanPayroll=!hasSources&&!truth.hasVerifiedPayment&&!truth.explicitPayments.length&&!stalePayrollStatus;
      const classification=stalePayrollStatus?'STALE_PAYROLL_STATUS':orphanPayroll?'ORPHAN_PAYROLL':truth.hasVerifiedPayment?'VALID_PAID_PAYROLL':'VALID_SOURCE_PAYROLL';
      if(stalePayrollStatus)addIssue('payroll',payroll.id,'STALE_PAYROLL_STATUS','BLOCKING',repair.MANUAL,'Payroll 顯示已付款但沒有可驗證付款。');
      else if(orphanPayroll)addIssue('payroll',payroll.id,'ORPHAN_PAYROLL','WARNING',repair.SAFE,'Payroll 沒有薪資來源或付款依據。');
      if(truth.missingBankPaymentIds.length)addIssue('payroll',payroll.id,'SALARY_PAYMENT_MISSING_BANK','BLOCKING',repair.MANUAL,'Salary Payment 缺少銀行流水。');
      return {id:payroll.id,employee:employeeId,employeeName:payroll.employeeName||state.employees.find((row)=>financialAuditText(row.id)===employeeId)?.name||'',month,status:payroll.status||'',total:num(payroll.total),attendanceCount:attendanceRows.length,commissionCount:commissionRows.length,adjustmentTotal,salaryPaymentCount:truth.explicitPayments.length,verifiedBankTransactionCount:truth.bankTransactionIds.length,paymentTruth:{hasVerifiedPayment:truth.hasVerifiedPayment,integrity:truth.integrity,paid:truth.paid,outstanding:truth.outstanding,missingBankPaymentIds:truth.missingBankPaymentIds},classification,repairClassification:stalePayrollStatus?repair.MANUAL:orphanPayroll?repair.SAFE:null};
    });
    const paymentAudit=payments.map((payment)=>{
      const paymentId=financialAuditText(payment.id),payableMatches=payables.filter((payable)=>financialAuditText(payable.id)===financialAuditText(payment.payableId)),bankMatches=financialAuditUnique(bankTransactions.filter((transaction)=>
        financialAuditText(payment.bankTransactionId)&&financialAuditText(transaction.id)===financialAuditText(payment.bankTransactionId)||
        ['payable_payment','payable-payment'].includes(financialAuditText(transaction.sourceType))&&paymentId&&(financialAuditText(transaction.sourceId)===paymentId||financialAuditText(transaction.paymentId)===paymentId)
      )),transaction=bankMatches.length===1?bankMatches[0]:null,amountMismatch=Boolean(transaction&&!financialAuditMoneyEqual(financialAuditFirst(transaction,['payableAmount'],transaction.amount),payment.amount)),expectedDebit=num(financialAuditFirst(payment,['actualDebit'],num(payment.amount)+(payment.feePayer==='company'?num(payment.fee):0))),netAmountMismatch=Boolean(transaction&&!financialAuditMoneyEqual(financialAuditFirst(transaction,['actualDebit','amount'],0),expectedDebit));
      const orphanPayment=payableMatches.length===0,ambiguousPayment=payableMatches.length>1,missingBank=bankMatches.length===0&&!payment.legacy,duplicateBank=bankMatches.length>1,duplicatePayment=Boolean(paymentId&&payments.filter((row)=>financialAuditText(row.id)===paymentId).length>1);
      if(orphanPayment)addIssue('payment',payment.id,'ORPHAN_PAYMENT','BLOCKING',repair.MANUAL,'Payment 找不到 Payable。');
      if(ambiguousPayment||duplicateBank)addIssue('payment',payment.id,'AMBIGUOUS_PAYMENT_LINK','BLOCKING',repair.MANUAL,'Payment 關聯不唯一。');
      if(duplicatePayment)addIssue('payment',payment.id,'DUPLICATE_PAYMENT','BLOCKING',repair.MANUAL,'Payment ID 不唯一。');
      if(missingBank)addIssue('payment',payment.id,'PAYMENT_MISSING_BANK','BLOCKING',repair.SEMANTIC,'Payment 缺少銀行流水。');
      if(amountMismatch||netAmountMismatch)addIssue('payment',payment.id,'PAYMENT_BANK_AMOUNT_MISMATCH','BLOCKING',repair.SEMANTIC,'Payment 與銀行流水金額不一致。');
      return {id:payment.id,payableId:payment.payableId||'',amount:num(payment.amount),legacy:Boolean(payment.legacy),payableMatchCount:payableMatches.length,bankTransactionIds:bankMatches.map((row)=>row.id),orphanPayment,ambiguousPayment,missingBank,duplicateBank,duplicatePayment,amountMismatch,netAmountMismatch,repairClassification:orphanPayment||ambiguousPayment||duplicateBank||duplicatePayment?repair.MANUAL:missingBank||amountMismatch||netAmountMismatch?repair.SEMANTIC:null};
    });
    const payableAudit=payables.map((payable)=>{
      const payablePayments=payments.filter((payment)=>financialAuditText(payment.payableId)===financialAuditText(payable.id)),inputInvoices=invoices.filter((invoice)=>(invoice.invoiceType==='input'||/進項/u.test(financialAuditText(invoice.type)))&&(financialAuditText(invoice.payableId||invoice.sourceId)===financialAuditText(payable.id)||legacyInvoicePayable(invoice)===payable)),usageIds=new Set((payable.usageIds||[]).map(financialAuditText).filter(Boolean)),linkedMaterials=materialUsages.filter((usage)=>financialAuditText(usage.payableId)===financialAuditText(payable.id)||usageIds.has(financialAuditText(usage.id))||financialAuditText(payable.sourceId)&&financialAuditText(usage.id)===financialAuditText(payable.sourceId)),sourceType=financialAuditText(payable.sourceType),expectsMaterial=/material|inventory|usage/i.test(sourceType)||/材料/u.test(financialAuditText(payable.category)),materialLinkMismatch=expectsMaterial&&!linkedMaterials.length||usageIds.size>linkedMaterials.filter((usage)=>usageIds.has(financialAuditText(usage.id))).length;
      const invoiceAmountChecks=inputInvoices.map((invoice)=>{
        const payableNet=num(financialAuditFirst(payable,['preTaxAmount','amount'],0)),invoiceNet=num(financialAuditFirst(invoice,['netAmount','amount'],0)),invoiceGross=num(financialAuditFirst(invoice,['grossAmount','total'],invoiceNet+num(financialAuditFirst(invoice,['taxAmount','tax'],0)))),explicitPayableGrossValues=['grossTotal','taxIncludedAmount'].filter((key)=>financialAuditHas(payable,key)).map((key)=>num(payable[key])),netMatch=financialAuditMoneyEqual(payableNet,invoiceNet),explicitGrossMatch=explicitPayableGrossValues.every((value)=>financialAuditMoneyEqual(value,invoiceGross));
        return {invoiceId:financialAuditText(invoice.id||invoice.invoiceId),payableNet,invoiceNet,invoiceGross,explicitPayableGrossValues,netMatch,explicitGrossMatch,mismatch:!netMatch||!explicitGrossMatch};
      }),invoiceMismatch=invoiceAmountChecks.some((row)=>row.mismatch),orphanPayable=!payablePayments.length&&!inputInvoices.length&&!linkedMaterials.length&&Boolean(sourceType)&&!/^manual/u.test(sourceType);
      if(orphanPayable)addIssue('payable',payable.id,'ORPHAN_PAYABLE','WARNING',repair.MANUAL,'Payable 找不到付款、發票或來源資料。');
      if(invoiceMismatch)addIssue('payable',payable.id,'PAYABLE_INVOICE_MISMATCH','BLOCKING',repair.SEMANTIC,'Payable 與進項發票金額不一致。');
      if(materialLinkMismatch)addIssue('payable',payable.id,'MATERIAL_LINK_MISMATCH','BLOCKING',repair.MANUAL,'Material 與 Payable 關聯不完整。');
      return {id:payable.id,payableNo:payable.payableNo||payable.number||payable.sourceNo||'',sourceType,amount:num(payable.amount),paid:num(payable.paid),paymentCount:payablePayments.length,inputInvoiceCount:inputInvoices.length,materialUsageCount:linkedMaterials.length,invoiceAmountChecks,orphanPayable,invoiceMismatch,materialLinkMismatch,repairClassification:orphanPayable||materialLinkMismatch?repair.MANUAL:invoiceMismatch?repair.SEMANTIC:null};
    });
    const materialPayableLinks=materialUsages.filter((usage)=>financialAuditText(usage.payableId)).map((usage)=>{
      const matches=payables.filter((payable)=>financialAuditText(payable.id)===financialAuditText(usage.payableId)),orphanMaterialPayable=matches.length===0,ambiguousMaterialPayable=matches.length>1;
      if(orphanMaterialPayable)addIssue('material-payable',usage.id,'MATERIAL_ORPHAN_PAYABLE','BLOCKING',repair.MANUAL,'Material Usage 指向不存在的 Payable。');
      if(ambiguousMaterialPayable)addIssue('material-payable',usage.id,'MATERIAL_AMBIGUOUS_PAYABLE','BLOCKING',repair.MANUAL,'Material Usage 對應多筆 Payable。');
      return {materialUsageId:usage.id,payableId:usage.payableId,payableMatchCount:matches.length,orphanMaterialPayable,ambiguousMaterialPayable,repairClassification:orphanMaterialPayable||ambiguousMaterialPayable?repair.MANUAL:null};
    });
    const bankAudit=bankTransactions.map((transaction)=>{
      const sourceType=financialAuditText(transaction.sourceType).toLocaleLowerCase('en-US');
      let classification='unknown',matches=[];
      if(['receipt','receivable_receipt'].includes(sourceType)){classification='receipt';matches=receipts.filter((row)=>financialAuditText(row.id)===financialAuditText(transaction.sourceId||transaction.receiptId));}
      else if(['retention_receipt','retention-receipt'].includes(sourceType)){classification='retention_receipt';matches=retentionReceipts.filter((row)=>[financialAuditText(row.id),financialAuditText(row.retentionReceiptId)].includes(financialAuditText(transaction.sourceId||transaction.retentionReceiptId)));}
      else if(['payable_payment','payable-payment'].includes(sourceType)){classification='payable_payment';matches=payments.filter((row)=>financialAuditText(row.id)===financialAuditText(transaction.sourceId||transaction.paymentId));}
      else if(['salary_payment','salary-payment'].includes(sourceType)){classification='salary_payment';matches=salaryPayments.filter((row)=>financialAuditText(row.id)===financialAuditText(transaction.sourceId||transaction.salaryPaymentId));}
      else if(sourceType.includes('legacy')||['payable','payroll','receivable','billing'].includes(sourceType))classification='legacy';
      else if(!sourceType||sourceType==='manual'||sourceType.startsWith('manual_')||sourceType.startsWith('manual-'))classification='manual';
      const knownSource=['receipt','retention_receipt','payable_payment','salary_payment'].includes(classification),orphanBankTransaction=knownSource&&matches.length===0,ambiguousBankTransaction=knownSource&&matches.length>1,unknownSourceTransaction=classification==='unknown';
      if(orphanBankTransaction)addIssue('bank',transaction.id,'ORPHAN_BANK_TRANSACTION','BLOCKING',repair.MANUAL,'銀行流水找不到來源紀錄。');
      if(ambiguousBankTransaction)addIssue('bank',transaction.id,'AMBIGUOUS_BANK_TRANSACTION','BLOCKING',repair.MANUAL,'銀行流水反查到多筆來源。');
      if(unknownSourceTransaction)addIssue('bank',transaction.id,'UNKNOWN_SOURCE_TRANSACTION','WARNING',repair.MANUAL,'銀行流水 sourceType 無法分類。');
      return {id:transaction.id,date:transaction.date||'',sourceType:transaction.sourceType||'',sourceId:transaction.sourceId||'',sourceNo:transaction.sourceNo||'',amount:num(transaction.amount),classification,sourceMatchCount:matches.length,sourceIds:matches.map((row)=>row.id),orphanBankTransaction,ambiguousBankTransaction,unknownSourceTransaction,repairClassification:orphanBankTransaction||ambiguousBankTransaction||unknownSourceTransaction?repair.MANUAL:classification==='legacy'?repair.LEGACY:null};
    });
    const workItemDuplicateGroups=(()=>{
      const groups=new Map();
      allDailyItems.forEach(({log,item,index})=>{const value=financialAuditText(item.workItemId);if(!value)return;if(!groups.has(value))groups.set(value,[]);groups.get(value).push({logId:log.id,sourceKey:`${log.groupId||log.id}:${index}`})});
      return [...groups.entries()].map(([value,occurrences])=>({value,count:occurrences.length,sourceCount:new Set(occurrences.map((row)=>row.sourceKey)).size,ids:occurrences.map((row)=>`${row.logId}:${row.sourceKey}`),occurrences})).filter((row)=>row.sourceCount>1);
    })();
    const duplicates={
      billingNumber:financialAuditDuplicateGroups(billings,(row)=>row.number,(row)=>row.id),
      receivableSourceNo:financialAuditDuplicateGroups(receivables,(row)=>row.sourceNo,(row)=>row.id),
      receiptId:financialAuditDuplicateGroups(receipts,(row)=>row.id,(row,index)=>row.id||index),
      paymentId:financialAuditDuplicateGroups(payments,(row)=>row.id,(row,index)=>row.id||index),
      invoiceNumber:financialAuditDuplicateGroups(invoices,(row)=>row.invoiceNumber||row.invoiceNo||row.number,(row)=>row.id||row.invoiceId),
      workItemId:workItemDuplicateGroups,
      bankTransactionId:financialAuditDuplicateGroups(bankTransactions,(row)=>row.id,(row,index)=>row.id||index)
    };
    Object.entries(duplicates).forEach(([kind,groups])=>groups.forEach((group)=>addIssue('identity',group.value,`DUPLICATE_${kind.replace(/([A-Z])/g,'_$1').toUpperCase()}`,'BLOCKING',repair.MANUAL,`${kind} 存在重複 identity。`)));
    const b643Pair=billingReceivablePairs.find((row)=>financialAuditText(row.number)==='B643124'),b643Billing=b643Pair?billings.find((row)=>financialAuditText(row.id)===financialAuditText(b643Pair.id)):null,b643Receivable=b643Billing&&receivableMatchesForBilling(b643Billing).length===1?receivableMatchesForBilling(b643Billing)[0]:null,b643Truth=b643Receivable?receiptTruthFor(b643Receivable,b643Billing):null;
    const b643124={billing:b643Billing?{id:b643Billing.id,number:b643Billing.number,sourceType:b643Billing.sourceType||''}:null,receivable:b643Receivable?{id:b643Receivable.id,sourceNo:b643Receivable.sourceNo||''}:null,billingTotal:b643Billing?billingValues(b643Billing).total:0,receivableAmount:num(b643Receivable?.amount),storedReceived:num(b643Receivable?.received),explicitReceiptTotal:b643Truth?.explicitReceiptTotal||0,legacyReceived:b643Truth?.legacyReceived||0,legacyBankCandidateCount:b643Truth?.legacyBankCandidateCount||0,legacyBankVerified:Boolean(b643Truth?.legacyBankVerified),legacyBankTransactionIds:b643Truth?.legacyBankTransactionIds||[],receiptTruthClassification:b643Truth?.classification||'NOT_FOUND',correctExpectedReceived:b643Truth?.classification==='LEGACY_RECEIVED_UNVERIFIED'?null:b643Truth?.expectedReceived??null,integrityResult:!b643Billing||!b643Receivable?'MISSING_TARGET':b643Truth.classification==='LEGACY_RECEIVED_VERIFIED'?'VERIFIED_LEGACY_RECEIPT':b643Truth.classification==='LEGACY_RECEIVED_UNVERIFIED'?'BLOCK_MANUAL_REVIEW_UNVERIFIED_LEGACY_RECEIVED':b643Truth.storedReceivedMatch?'PASS':'RECEIVED_MISMATCH',repairClassification:b643Truth?.classification==='LEGACY_RECEIVED_VERIFIED'?repair.LEGACY:b643Truth?.classification==='LEGACY_RECEIVED_UNVERIFIED'?repair.MANUAL:null};
    const specialPayroll=payrollAudit.find((row)=>financialAuditText(row.id)==='msdfc59cbvc6p7')||null;
    const duplicateIdentityCount=Object.values(duplicates).reduce((sum,groups)=>sum+groups.length,0),billingAmountMismatchCount=billingReceivablePairs.filter((row)=>row.amountChecks&&!row.amountMatch).length,orphanReceiptCount=[...receiptAudit,...retentionReceiptAudit].filter((row)=>row.orphanReceipt).length,receiptBankMismatchCount=[...receiptAudit,...retentionReceiptAudit].filter((row)=>row.missingBankTransaction||row.duplicateBankTransaction||row.amountMismatch||row.netAmountMismatch).length,paymentIntegrityIssueCount=paymentAudit.filter((row)=>row.orphanPayment||row.ambiguousPayment||row.missingBank||row.duplicateBank||row.duplicatePayment||row.amountMismatch||row.netAmountMismatch).length;
    const summary={billingCount:billings.length,receivableCount:receivables.length,exactBillingReceivablePairs:billingReceivablePairs.filter((row)=>row.relation==='EXACT').length,orphanBillingCount:billingReceivablePairs.filter((row)=>row.relation==='ORPHAN').length,ambiguousBillingCount:billingReceivablePairs.filter((row)=>row.relation==='AMBIGUOUS').length,orphanReceivableCount:receivableAudit.filter((row)=>row.orphanClassification).length,legacyReceivableCount:receivableAudit.filter((row)=>/^LEGACY_/u.test(row.orphanClassification)||/^LEGACY_/u.test(row.receiptTruth.classification)).length,likelyDuplicateReceivableCount:receivableAudit.filter((row)=>row.orphanClassification==='LIKELY_DUPLICATE').length,billingAmountMismatchCount,unverifiedLegacyReceivedCount:receivableAudit.filter((row)=>row.receiptTruth.classification==='LEGACY_RECEIVED_UNVERIFIED').length,orphanReceiptCount,receiptBankMismatchCount,orphanInvoiceCount:invoiceAudit.filter((row)=>row.orphanInvoice).length,dailyBillingOrphanCount:dailyBillingLinks.filter((row)=>row.dailyOrphanBilling).length,orphanPayrollCount:payrollAudit.filter((row)=>row.classification==='ORPHAN_PAYROLL').length,stalePayrollCount:payrollAudit.filter((row)=>row.classification==='STALE_PAYROLL_STATUS').length,orphanPayableCount:payableAudit.filter((row)=>row.orphanPayable).length,paymentIntegrityIssueCount,orphanBankTransactionCount:bankAudit.filter((row)=>row.orphanBankTransaction).length,duplicateIdentityCount,blockingIssueCount:issues.filter((row)=>row.severity==='BLOCKING').length,warningIssueCount:issues.filter((row)=>row.severity==='WARNING').length};
    return {readOnly:true,auditVersion:'global-financial-integrity-v1',generatedAt:new Date().toISOString(),repairClassifications:Object.values(repair),billingReceivablePairs,receivables:receivableAudit,receipts:receiptAudit,retentionReceipts:retentionReceiptAudit,invoices:invoiceAudit,billingSources,dailyBillingLinks,payroll:payrollAudit,payables:payableAudit,payments:paymentAudit,materialPayableLinks,bankTransactions:bankAudit,duplicates,special:{B643124:b643124,linZiYue202608PaidPayroll:specialPayroll},issues,summary};
  }
  async function financialIntegrityAudit() {
    await load();
    return financialIntegrityAuditReport();
  }
  const GLOBAL_FINANCIAL_REPAIR_TARGETS = Object.freeze({
    b643124:{billingId:'msfwtqet8zssvp',billingNo:'B643124',receivableId:'msfwv2he9e3ep8',bankTransactionId:'mshnkktr79x422',decision:'COLLECT_REMAINING_TAX_88'},
    stalePayroll:{id:'msdfc59cbvc6p7',employee:'ms4pb1q8m834ic',month:'2026-08'}
  });
  const financialRepairFingerprint=(value)=>{
    const text=JSON.stringify(value),source=text===undefined?'undefined':text;
    let hash=2166136261;
    for(let index=0;index<source.length;index+=1){hash^=source.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return `${source.length}:${(hash>>>0).toString(16).padStart(8,'0')}`;
  };
  const legacyBillingConstructionAmount=(billing)=>{
    if(financialAuditHas(billing,'constructionAmount')){
      const value=Number(billing.constructionAmount);
      return {valid:Number.isFinite(value),value,source:'constructionAmount'};
    }
    if(financialAuditText(billing?.sourceType)!=='daily-log-summary'||!Array.isArray(billing?.lines)||!billing.lines.length)return {valid:false,value:null,source:'missing'};
    let total=0;
    for(const line of billing.lines){
      if(!financialAuditText(line?.qty)||!financialAuditText(line?.price))return {valid:false,value:null,source:'invalid-lines'};
      const qty=Number(line.qty),price=Number(line.price);
      if(!Number.isFinite(qty)||!Number.isFinite(price))return {valid:false,value:null,source:'invalid-lines'};
      total+=qty*price;
    }
    return {valid:Number.isFinite(total),value:Math.round(total),source:'derived-lines'};
  };
  function financialIntegrityRepairPlan(options,audit) {
    const target=GLOBAL_FINANCIAL_REPAIR_TARGETS,decisions=options?.decisions||{},blockers=[],warnings=[],deterministicRepairs=[],preservedLegacy=[],manualReview=[];
    const block=(code,message,details={})=>blockers.push({code,message,...details}),warn=(code,message,details={})=>warnings.push({code,message,...details}),text=financialAuditText;
    const billingById=state.billings.filter((row)=>text(row.id)===target.b643124.billingId),billingByNo=state.billings.filter((row)=>text(row.number)===target.b643124.billingNo),billing=billingById.length===1&&billingByNo.length===1&&billingById[0]===billingByNo[0]?billingById[0]:null;
    const receivableMatches=state.receivables.filter((row)=>text(row.id)===target.b643124.receivableId),receivable=receivableMatches.length===1?receivableMatches[0]:null,b643Audit=audit.special.B643124;
    if(decisions.B643124!==target.b643124.decision)block('B643124_DECISION_REQUIRED',`decisions.B643124 必須明確指定 ${target.b643124.decision}。`);
    if(!billing)block('B643124_BILLING_IDENTITY',`${target.b643124.billingNo} 的 Billing ID / No 無法同時唯一確認。`,{billingByIdCount:billingById.length,billingByNoCount:billingByNo.length});
    if(!receivable)block('B643124_RECEIVABLE_IDENTITY','B643124 的 Receivable 無法唯一確認。',{receivableMatchCount:receivableMatches.length});
    const b643Construction=billing?legacyBillingConstructionAmount(billing):null;
    if(billing&&!(text(billing.sourceType)==='daily-log-summary'&&text(billing.customerName||billing.customer)==='小賴'&&text(billing.projectName||billing.project)==='親家one city'&&b643Construction.valid&&financialAuditMoneyEqual(b643Construction.value,1750)&&financialAuditMoneyEqual(billing.amount,1750)&&financialAuditMoneyEqual(billing.preTaxAmount,1750)&&financialAuditMoneyEqual(billing.tax,88)&&financialAuditMoneyEqual(billing.taxAmount,88)&&financialAuditMoneyEqual(billing.grossTotal,1838)&&financialAuditMoneyEqual(billing.taxIncludedAmount,1838)&&financialAuditMoneyEqual(billing.retention,0)&&financialAuditMoneyEqual(billing.total,1838)&&text(billing.invoiceStatus)==='invoice_pending'&&!text(billing.invoiceNo)))block('B643124_BILLING_FACTS_CHANGED','B643124 Billing 金額、對象或狀態已偏離人工確認基準。',{constructionAmount:b643Construction});
    if(billing&&receivable&&!(text(billing.receivableId)===target.b643124.receivableId&&text(receivable.billingId)===target.b643124.billingId&&text(receivable.sourceNo)===target.b643124.billingNo))block('B643124_LINK_CHANGED','B643124 Billing / Receivable identity link 不完整。');
    if(receivable&&!(financialAuditMoneyEqual(receivable.amount,1750)&&financialAuditMoneyEqual(receivable.grossTotal,0)&&financialAuditMoneyEqual(receivable.untaxedAmount,1667)&&financialAuditMoneyEqual(receivable.tax,83)&&financialAuditMoneyEqual(receivable.received,1750)&&financialAuditMoneyEqual(receivable.legacyReceived,1750)))block('B643124_STALE_VALUES_CHANGED','B643124 Receivable 已不再符合已驗證的舊錯位值。');
    const b643Receipts=state.receipts.filter((row)=>text(row.receivableId)===target.b643124.receivableId||text(row.billingId)===target.b643124.billingId),b643Retention=state.retentionReceipts.filter((row)=>text(row.receivableId)===target.b643124.receivableId||text(row.billingId)===target.b643124.billingId),b643Invoices=state.invoices.filter((row)=>text(row.receivableId)===target.b643124.receivableId||text(row.billingId)===target.b643124.billingId||text(row.sourceId)===target.b643124.billingId||text(row.sourceNo)===target.b643124.billingNo),b643BankIds=b643Audit?.legacyBankTransactionIds||[],b643BankRows=state.bankTransactions.filter((row)=>b643BankIds.includes(text(row.id)));
    if(b643Receipts.length||b643Retention.length||b643Invoices.length)block('B643124_NEW_ACCOUNTING_EVIDENCE','B643124 出現新的 Receipt、Retention Receipt 或 Invoice，禁止套用既定修復。',{receiptCount:b643Receipts.length,retentionReceiptCount:b643Retention.length,invoiceCount:b643Invoices.length});
    if(!(b643Audit?.receiptTruthClassification==='LEGACY_RECEIVED_VERIFIED'&&b643Audit.legacyBankVerified===true&&b643Audit.legacyBankCandidateCount===1&&b643BankIds.length===1&&b643BankIds[0]===target.b643124.bankTransactionId&&b643BankRows.length===1))block('B643124_BANK_EVIDENCE','B643124 無法唯一驗證指定歷史銀行收款。',{audit:b643Audit||null});
    const b643Ready=!blockers.some((row)=>row.code.startsWith('B643124_'));
    if(b643Ready)deterministicRepairs.push({action:'UPDATE_RECEIVABLE_AMOUNT_ONLY',target:{collection:'receivables',id:target.b643124.receivableId,billingId:target.b643124.billingId,sourceNo:target.b643124.billingNo},decision:target.b643124.decision,before:{amount:num(receivable.amount),grossTotal:num(receivable.grossTotal),untaxedAmount:num(receivable.untaxedAmount),tax:num(receivable.tax),received:num(receivable.received),legacyReceived:num(receivable.legacyReceived)},patch:{amount:1838,grossTotal:1838,taxIncludedAmount:1838,untaxedAmount:1750,preTaxAmount:1750,tax:88,taxAmount:88,retention:0,retentionAmount:0,received:1750,legacyReceived:1750,status:'部分收款'},expected:{outstanding:88,status:'部分收款'},forbidden:['legacyReceived','bank transaction','Billing amount','Daily Log','invoice status','sourceNo','billingId']});
    const payrollMatches=state.payroll.filter((row)=>text(row.id)===target.stalePayroll.id),stalePayroll=payrollMatches.length===1?payrollMatches[0]:null,attendance=state.attendance.filter((row)=>text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.date)===target.stalePayroll.month),commissions=state.commissions.filter((row)=>text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.date)===target.stalePayroll.month&&row.status==='已列入薪資'),adjustmentFields=['manualFuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'],adjustmentTotal=stalePayroll?adjustmentFields.reduce((sum,key)=>sum+Math.abs(num(stalePayroll[key])),0):0,salaryPayments=state.salaryPayments.filter((row)=>text(row.payrollId)===target.stalePayroll.id||!text(row.payrollId)&&text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.month||row.date)===target.stalePayroll.month),payrollTruth=stalePayroll?payrollPaymentTruth(stalePayroll):null;
    if(!stalePayroll)block('STALE_PAYROLL_IDENTITY','指定 stale Payroll 無法唯一確認。',{matchCount:payrollMatches.length});
    if(stalePayroll&&!(text(stalePayroll.employee||stalePayroll.employeeId)===target.stalePayroll.employee&&text(stalePayroll.month)===target.stalePayroll.month&&financialAuditMoneyEqual(stalePayroll.total,4000)&&text(stalePayroll.status)==='已付款'))block('STALE_PAYROLL_FACTS_CHANGED','指定 Payroll 已偏離已驗證的 stale 歷史列。');
    if(attendance.length)block('STALE_PAYROLL_ATTENDANCE_PRESENT','林子嶽 2026-08 已重新出現 attendance。',{count:attendance.length});
    if(commissions.length)block('STALE_PAYROLL_COMMISSION_PRESENT','林子嶽 2026-08 已重新出現 included commission。',{count:commissions.length});
    if(adjustmentTotal)block('STALE_PAYROLL_ADJUSTMENT_PRESENT','指定 Payroll 已重新出現 adjustment。',{adjustmentTotal});
    if(salaryPayments.length)block('STALE_PAYROLL_PAYMENT_PRESENT','指定 Payroll 已出現 Salary Payment。',{count:salaryPayments.length});
    if(payrollTruth&&(payrollTruth.hasVerifiedPayment||payrollTruth.bankTransactionIds.length||payrollTruth.integrity!=='stale-payroll-status'))block('STALE_PAYROLL_BANK_OR_TRUTH_PRESENT','指定 Payroll 的付款 truth 已改變，禁止刪除。',{paymentTruth:{hasVerifiedPayment:payrollTruth.hasVerifiedPayment,integrity:payrollTruth.integrity,bankTransactionIds:payrollTruth.bankTransactionIds}});
    const payrollReady=!blockers.some((row)=>row.code.startsWith('STALE_PAYROLL_'));
    if(payrollReady)deterministicRepairs.push({action:'DELETE_STALE_PAYROLL',target:{collection:'payroll',id:target.stalePayroll.id,employee:target.stalePayroll.employee,month:target.stalePayroll.month},before:{status:stalePayroll.status,total:num(stalePayroll.total)},gates:{attendance:0,includedCommission:0,adjustment:0,salaryPayment:0,verifiedBankPayment:0,paymentTruth:'stale-payroll-status'}});
    const orphanReceivables=audit.receivables.filter((row)=>row.orphanClassification).map((row)=>{
      const source=state.receivables.find((item)=>text(item.id)===text(row.id))||{},candidate=row.semanticBillingCandidates.length===1?state.billings.find((item)=>text(item.id)===text(row.semanticBillingCandidates[0].billingId)):null,candidateTotal=candidate?num(candidate.total??candidate.grossTotal):0,projectExact=Boolean(candidate&&((text(source.project)&&text(source.project)===text(candidate.project))||(text(source.projectName)&&text(source.projectName)===text(candidate.projectName)))),dateExact=Boolean(candidate&&text(source.date)&&text(source.date)===text(candidate.date)),amountExact=Boolean(candidate&&financialAuditMoneyEqual(source.amount,candidateTotal)),uniqueExact=Boolean(candidate&&projectExact&&dateExact&&amountExact);
      let recommendedAction='BLOCK_MANUAL_REVIEW',reason='沒有足夠唯一證據可自動處理。',repairClassification=FINANCIAL_INTEGRITY_REPAIR.MANUAL;
      if(row.orphanClassification==='LEGACY_SETTLED'){recommendedAction='KEEP_AS_VERIFIED_LEGACY';reason='已有 Receipt 或唯一可信銀行證據，必須保留。';repairClassification=FINANCIAL_INTEGRITY_REPAIR.LEGACY}
      else if(row.orphanClassification==='LEGACY_OPEN'){recommendedAction='KEEP_AS_LEGACY_OPEN';reason='仍可能是真實歷史未收帳款，禁止自動刪除。'}
      else if(row.orphanClassification==='ORPHAN_EMPTY'){recommendedAction='REVIEW_ORPHAN_EMPTY';reason='沒有帳務痕跡仍可能是真實舊應收，只能人工確認。'}
      else if(row.orphanClassification==='LIKELY_DUPLICATE'&&uniqueExact){recommendedAction='LINK_OR_MERGE';reason='僅找到一筆日期、案場與金額皆相同的候選 Billing；仍需語意確認。';repairClassification=FINANCIAL_INTEGRITY_REPAIR.SEMANTIC}
      const plan={id:row.id,project:row.project||row.projectName||'',date:row.date||'',amount:row.amount,received:row.received,legacyReceived:row.legacyReceived,receiptCount:row.receiptCount,bankCount:row.bankTransactionCount,invoiceCount:row.invoiceCount,classification:row.orphanClassification,repairClassification,recommendedAction,reason,semanticCandidates:row.semanticBillingCandidates,uniqueExactSemanticTarget:uniqueExact,blocked:row.orphanClassification==='AMBIGUOUS'};
      if(recommendedAction.startsWith('KEEP_'))preservedLegacy.push({type:'RECEIVABLE',...plan});else manualReview.push({type:'RECEIVABLE',...plan});
      return plan;
    });
    const invoiceValue=(row,keys)=>num(financialAuditFirst(row,keys,0)),orphanInvoices=audit.invoices.filter((row)=>row.orphanInvoice).map((row)=>{
      const source=state.invoices.find((item)=>text(item.id||item.invoiceId)===text(row.id))||{},number=text(source.invoiceNumber||source.invoiceNo||source.number),date=text(source.invoiceDate||source.date),party=text(source.party||source.customerName||source.vendorName),project=text(source.projectId||source.project),projectName=text(source.projectName),amount=invoiceValue(source,['netAmount','amount']),tax=invoiceValue(source,['taxAmount','tax']),gross=invoiceValue(source,['grossAmount','total']),candidates=state.billings.map((candidate)=>{const candidateAmount=num(candidate.amount??candidate.preTaxAmount),candidateTax=num(candidate.tax??candidate.taxAmount),candidateGross=num(candidate.grossTotal??candidate.taxIncludedAmount??candidate.total),projectMatch=Boolean(project&&project===text(candidate.project)||projectName&&projectName===text(candidate.projectName)),partyMatch=Boolean(party&&party===text(candidate.customerName||candidate.customer)),dateMatch=Boolean(date&&date===text(candidate.date)),amountMatch=financialAuditMoneyEqual(amount,candidateAmount)&&financialAuditMoneyEqual(tax,candidateTax)&&financialAuditMoneyEqual(gross,candidateGross);return {billingId:candidate.id,billingNo:candidate.number||'',projectMatch,partyMatch,dateMatch,amountMatch,exact:Boolean(projectMatch&&dateMatch&&amountMatch)}}).filter((candidate)=>candidate.exact),empty=!number&&!date&&!party&&!project&&!projectName&&amount===0&&tax===0&&gross===0,legacy=/legacy/u.test(text(source.sourceType).toLocaleLowerCase('en-US'))&&Boolean(number&&date&&party&&gross>0);
      let classification='AMBIGUOUS',recommendedAction='BLOCK_MANUAL_REVIEW',reason='沒有唯一 Billing 證據。',repairClassification=FINANCIAL_INTEGRITY_REPAIR.MANUAL;
      if(candidates.length===1){classification='UNIQUE_LINK_CANDIDATE';recommendedAction='LINK_CANDIDATE_REVIEW';reason='日期、案場與金額唯一符合一筆 Billing，仍須人工確認後才可連結。';repairClassification=FINANCIAL_INTEGRITY_REPAIR.SEMANTIC}
      else if(empty){classification='EMPTY_TEST_CANDIDATE';recommendedAction='REVIEW_EMPTY_TEST_CANDIDATE';reason='空白測試候選仍不得由 Preview 自動刪除。';repairClassification=FINANCIAL_INTEGRITY_REPAIR.SAFE}
      else if(legacy&&candidates.length===0){classification='VERIFIED_LEGACY_INVOICE';recommendedAction='KEEP_AS_VERIFIED_LEGACY';reason='具有完整歷史發票識別，但無現代 Billing link，保留為歷史資料。';repairClassification=FINANCIAL_INTEGRITY_REPAIR.LEGACY}
      const plan={invoiceId:row.id,number,date,party,project:project||projectName,amount,tax,gross,sourceId:source.sourceId||source.billingId||'',sourceNo:source.sourceNo||'',billingCandidateCount:candidates.length,billingCandidates:candidates,classification,repairClassification,recommendedAction,reason,blocked:classification==='AMBIGUOUS'};
      if(recommendedAction==='KEEP_AS_VERIFIED_LEGACY')preservedLegacy.push({type:'INVOICE',...plan});else manualReview.push({type:'INVOICE',...plan});
      return plan;
    });
    const paymentIntegrityPlan=[];
    const addPaymentIssue=(type,row,targetId,bankIds,issueTypes)=>{if(!issueTypes.length)return;const plan={paymentType:type,paymentId:row.id||row.retentionReceiptId||'',targetId:targetId||'',bankTransactionIds:bankIds,amount:num(row.amount),issueTypes,recommendedAction:'REVIEW_ONLY',executeAllowed:false};paymentIntegrityPlan.push(plan);manualReview.push({type:'PAYMENT_INTEGRITY',...plan,repairClassification:FINANCIAL_INTEGRITY_REPAIR.MANUAL})};
    audit.receipts.forEach((row)=>{const source=state.receipts.find((item)=>text(item.id)===text(row.id))||row;addPaymentIssue('RECEIPT',source,source.receivableId,row.bankTransactionIds,[row.orphanReceipt&&'ORPHAN_RECEIPT',row.ambiguousReceipt&&'AMBIGUOUS_RECEIPT',row.missingBankTransaction&&'MISSING_BANK_TRANSACTION',row.duplicateBankTransaction&&'DUPLICATE_BANK_TRANSACTION',row.amountMismatch&&'AMOUNT_MISMATCH',row.netAmountMismatch&&'NET_AMOUNT_MISMATCH'].filter(Boolean))});
    audit.retentionReceipts.forEach((row)=>{const source=state.retentionReceipts.find((item)=>text(item.id)===text(row.id))||row;addPaymentIssue('RETENTION_RECEIPT',source,source.receivableId,row.bankTransactionIds,[row.orphanReceipt&&'ORPHAN_RECEIPT',row.billingMatchCount!==1&&'BILLING_LINK_MISMATCH',row.missingBankTransaction&&'MISSING_BANK_TRANSACTION',row.duplicateBankTransaction&&'DUPLICATE_BANK_TRANSACTION',row.amountMismatch&&'AMOUNT_MISMATCH',row.netAmountMismatch&&'NET_AMOUNT_MISMATCH'].filter(Boolean))});
    audit.payments.forEach((row)=>{const source=state.payments.find((item)=>text(item.id)===text(row.id))||row;addPaymentIssue('PAYABLE_PAYMENT',source,source.payableId,row.bankTransactionIds,[row.orphanPayment&&'ORPHAN_PAYMENT',row.ambiguousPayment&&'AMBIGUOUS_PAYMENT',row.missingBank&&'MISSING_BANK_TRANSACTION',row.duplicateBank&&'DUPLICATE_BANK_TRANSACTION',row.duplicatePayment&&'DUPLICATE_PAYMENT',row.amountMismatch&&'AMOUNT_MISMATCH',row.netAmountMismatch&&'NET_AMOUNT_MISMATCH'].filter(Boolean))});
    state.salaryPayments.forEach((payment)=>{const payroll=state.payroll.filter((row)=>text(row.id)===text(payment.payrollId)),banks=state.bankTransactions.filter((row)=>text(payment.bankTransactionId)&&text(row.id)===text(payment.bankTransactionId)||text(row.sourceType)==='salary_payment'&&text(row.sourceId||row.salaryPaymentId)===text(payment.id)),issues=[payroll.length!==1&&'PAYROLL_LINK_MISMATCH',banks.length===0&&'MISSING_BANK_TRANSACTION',banks.length>1&&'DUPLICATE_BANK_TRANSACTION'].filter(Boolean);addPaymentIssue('SALARY_PAYMENT',payment,payment.payrollId,banks.map((row)=>row.id),issues)});
    if(paymentIntegrityPlan.length!==audit.summary.paymentIntegrityIssueCount)warn('PAYMENT_ISSUE_SCOPE_NOTE','Payment plan 會展開 receipt / retention / AP / salary 問題，筆數可能與 summary 的 AP payment 計數口徑不同。',{auditPaymentIntegrityIssueCount:audit.summary.paymentIntegrityIssueCount,previewIssueCount:paymentIntegrityPlan.length});
    const healthyPairs=audit.billingReceivablePairs.filter((row)=>row.relation==='EXACT'&&row.amountMatch&&row.number!==target.b643124.billingNo).map((row)=>({billing:state.billings.find((item)=>text(item.id)===text(row.id)),receivable:state.receivables.find((item)=>text(item.id)===text(row.receivableIds[0]))}));
    const protectedFingerprints={healthyBillingReceivables:{count:healthyPairs.length,fingerprint:financialRepairFingerprint(healthyPairs)},payables:{count:state.payables.length,fingerprint:financialRepairFingerprint(state.payables)},payments:{count:state.payments.length,fingerprint:financialRepairFingerprint(state.payments)},bankTransactions:{count:state.bankTransactions.length,fingerprint:financialRepairFingerprint(state.bankTransactions)},b643124LegacyBank:{id:target.b643124.bankTransactionId,fingerprint:financialRepairFingerprint(state.bankTransactions.find((row)=>text(row.id)===target.b643124.bankTransactionId))}};
    const postRepairExpectedSummary={billingCount:audit.summary.billingCount,receivableCount:audit.summary.receivableCount,payrollCount:Math.max(0,state.payroll.length-(payrollReady?1:0)),billingAmountMismatchCount:Math.max(0,audit.summary.billingAmountMismatchCount-(b643Ready?1:0)),stalePayrollCount:Math.max(0,audit.summary.stalePayrollCount-(payrollReady?1:0)),orphanReceivableCount:audit.summary.orphanReceivableCount,orphanInvoiceCount:audit.summary.orphanInvoiceCount,paymentIntegrityIssueCount:audit.summary.paymentIntegrityIssueCount,orphanPayableCount:audit.summary.orphanPayableCount,orphanBankTransactionCount:audit.summary.orphanBankTransactionCount};
    if(manualReview.length)warn('MANUAL_REVIEW_PRESERVED','manualReview 項目不屬於可執行範圍，不影響確定性 repair 的 allowed。',{count:manualReview.length});
    return {allowed:blockers.length===0&&deterministicRepairs.length===2,previewOnly:true,executeAvailable:true,blockers,warnings,deterministicRepairs,preservedLegacy,manualReview,orphanReceivables,orphanInvoices,paymentIntegrityPlan,protectedFingerprints,postRepairExpectedSummary,auditSummary:audit.summary};
  }
  async function financialIntegrityRepairPreview(options={}) {
    await load();
    return financialIntegrityRepairPlan(options,financialIntegrityAuditReport());
  }
  const GLOBAL_FINANCIAL_REPAIR_PATCH = Object.freeze({amount:1838,grossTotal:1838,taxIncludedAmount:1838,untaxedAmount:1750,preTaxAmount:1750,tax:88,taxAmount:88,retention:0,retentionAmount:0,received:1750,legacyReceived:1750,status:'部分收款'});
  const globalFinancialRepairClone=(value)=>JSON.parse(JSON.stringify(value));
  const globalFinancialRepairOmit=(row,keys)=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!keys.includes(key)));
  const globalFinancialRepairExactObject=(actual,expected)=>{
    const actualKeys=Object.keys(actual||{}).sort(),expectedKeys=Object.keys(expected).sort();
    return actualKeys.length===expectedKeys.length&&actualKeys.every((key,index)=>key===expectedKeys[index]&&financialRepairFingerprint(actual[key])===financialRepairFingerprint(expected[key]));
  };
  const globalFinancialRepairCounts=(source)=>Object.fromEntries(Object.keys(source||{}).filter((key)=>Array.isArray(source[key])).sort().map((key)=>[key,source[key].length]));
  function globalFinancialRepairPreviewFingerprints(audit) {
    const target=GLOBAL_FINANCIAL_REPAIR_TARGETS,healthyPairs=(audit?.billingReceivablePairs||[]).filter((row)=>row.relation==='EXACT'&&row.amountMatch&&row.number!==target.b643124.billingNo).map((row)=>({billing:state.billings.find((item)=>financialAuditText(item.id)===financialAuditText(row.id)),receivable:state.receivables.find((item)=>financialAuditText(item.id)===financialAuditText(row.receivableIds[0]))}));
    return {healthyBillingReceivables:{count:healthyPairs.length,fingerprint:financialRepairFingerprint(healthyPairs)},payables:{count:state.payables.length,fingerprint:financialRepairFingerprint(state.payables)},payments:{count:state.payments.length,fingerprint:financialRepairFingerprint(state.payments)},bankTransactions:{count:state.bankTransactions.length,fingerprint:financialRepairFingerprint(state.bankTransactions)},b643124LegacyBank:{id:target.b643124.bankTransactionId,fingerprint:financialRepairFingerprint(state.bankTransactions.find((row)=>financialAuditText(row.id)===target.b643124.bankTransactionId))}};
  }
  function globalFinancialRepairStateFingerprints(source) {
    const target=GLOBAL_FINANCIAL_REPAIR_TARGETS,rows=(key)=>Array.isArray(source?.[key])?source[key]:[],nonTarget={};
    Object.keys(source||{}).sort().forEach((key)=>{
      if(key==='meta'||key==='audit')return;
      if(key==='receivables')nonTarget[key]=rows(key).filter((row)=>financialAuditText(row.id)!==target.b643124.receivableId);
      else if(key==='payroll')nonTarget[key]=rows(key).filter((row)=>financialAuditText(row.id)!==target.stalePayroll.id);
      else nonTarget[key]=source[key];
    });
    return {
      allNonTarget:financialRepairFingerprint(nonTarget),
      billings:financialRepairFingerprint(rows('billings')),
      receivablesExceptTarget:financialRepairFingerprint(rows('receivables').filter((row)=>financialAuditText(row.id)!==target.b643124.receivableId)),
      payrollExceptTarget:financialRepairFingerprint(rows('payroll').filter((row)=>financialAuditText(row.id)!==target.stalePayroll.id)),
      receipts:financialRepairFingerprint(rows('receipts')),
      retentionReceipts:financialRepairFingerprint(rows('retentionReceipts')),
      invoices:financialRepairFingerprint(rows('invoices')),
      salaryPayments:financialRepairFingerprint(rows('salaryPayments')),
      attendance:financialRepairFingerprint(rows('attendance')),
      commissions:financialRepairFingerprint(rows('commissions')),
      dailyLogs:financialRepairFingerprint(rows('dailyLogs')),
      banks:financialRepairFingerprint(rows('banks')),
      projects:financialRepairFingerprint(rows('projects')),
      customers:financialRepairFingerprint(rows('customers')),
      quotations:financialRepairFingerprint(rows('quotations')),
      payables:financialRepairFingerprint(rows('payables')),
      payments:financialRepairFingerprint(rows('payments')),
      bankTransactions:financialRepairFingerprint(rows('bankTransactions')),
      materialData:financialRepairFingerprint({materialUsages:rows('materialUsages'),materials:rows('materials'),projectCosts:rows('projectCosts')})
    };
  }
  function globalFinancialRepairAssertFingerprints(actual,expected,stage) {
    Object.keys(expected).forEach((key)=>{if(actual[key]!==expected[key])throw new Error(`${stage}：受保護資料 ${key} 發生未核准變動。`)});
  }
  function globalFinancialRepairDeterministicScope(preview) {
    if(preview?.allowed!==true)throw new Error(`GLOBAL Repair Preview 未通過：${(preview?.blockers||[]).map((row)=>row.message||row.code).join(' ')}`);
    if(!Array.isArray(preview.blockers)||preview.blockers.length)throw new Error('GLOBAL Repair Preview 仍有 blocker。');
    if(!Array.isArray(preview.deterministicRepairs)||preview.deterministicRepairs.length!==2)throw new Error('GLOBAL Repair deterministic repairs 必須精確為 2 筆。');
    const receivableRepairs=preview.deterministicRepairs.filter((row)=>row.action==='UPDATE_RECEIVABLE_AMOUNT_ONLY'),payrollRepairs=preview.deterministicRepairs.filter((row)=>row.action==='DELETE_STALE_PAYROLL'),receivableRepair=receivableRepairs[0],payrollRepair=payrollRepairs[0];
    if(receivableRepairs.length!==1||payrollRepairs.length!==1)throw new Error('GLOBAL Repair action scope 不符合核准的兩筆修復。');
    if(!globalFinancialRepairExactObject(receivableRepair.target,{collection:'receivables',id:'msfwv2he9e3ep8',billingId:'msfwtqet8zssvp',sourceNo:'B643124'})||!globalFinancialRepairExactObject(payrollRepair.target,{collection:'payroll',id:'msdfc59cbvc6p7',employee:'ms4pb1q8m834ic',month:'2026-08'}))throw new Error('GLOBAL Repair target identity 不符合核准範圍。');
    if(!globalFinancialRepairExactObject(receivableRepair.patch,GLOBAL_FINANCIAL_REPAIR_PATCH))throw new Error('B643124 Receivable patch 不符合核准內容。');
    return {receivableRepair,payrollRepair};
  }
  function globalFinancialRepairTargetGate(preview) {
    const target=GLOBAL_FINANCIAL_REPAIR_TARGETS,text=financialAuditText,billings=state.billings.filter((row)=>text(row.id)===target.b643124.billingId&&text(row.number)===target.b643124.billingNo),receivables=state.receivables.filter((row)=>text(row.id)===target.b643124.receivableId),payrollRows=state.payroll.filter((row)=>text(row.id)===target.stalePayroll.id),legacyBanks=state.bankTransactions.filter((row)=>text(row.id)===target.b643124.bankTransactionId);
    if(billings.length!==1||receivables.length!==1||payrollRows.length!==1||legacyBanks.length!==1)throw new Error('GLOBAL Repair target identity 在 Execute 前已改變。');
    const billing=billings[0],receivable=receivables[0],stalePayroll=payrollRows[0],legacyBank=legacyBanks[0],construction=legacyBillingConstructionAmount(billing);
    if(!(text(billing.sourceType)==='daily-log-summary'&&text(billing.customerName||billing.customer)==='小賴'&&text(billing.projectName||billing.project)==='親家one city'&&construction.valid&&financialAuditMoneyEqual(construction.value,1750)&&financialAuditMoneyEqual(billing.amount,1750)&&financialAuditMoneyEqual(billing.preTaxAmount,1750)&&financialAuditMoneyEqual(billing.tax,88)&&financialAuditMoneyEqual(billing.taxAmount,88)&&financialAuditMoneyEqual(billing.grossTotal,1838)&&financialAuditMoneyEqual(billing.taxIncludedAmount,1838)&&financialAuditMoneyEqual(billing.retention,0)&&financialAuditMoneyEqual(billing.total,1838)&&text(billing.invoiceStatus)==='invoice_pending'&&!text(billing.invoiceNo)))throw new Error('B643124 Billing facts 在 Execute 前已改變。');
    if(!(text(billing.receivableId)===target.b643124.receivableId&&text(receivable.billingId)===target.b643124.billingId&&text(receivable.sourceNo)===target.b643124.billingNo&&financialAuditMoneyEqual(receivable.amount,1750)&&financialAuditMoneyEqual(receivable.grossTotal,0)&&financialAuditMoneyEqual(receivable.untaxedAmount,1667)&&financialAuditMoneyEqual(receivable.tax,83)&&financialAuditMoneyEqual(receivable.received,1750)&&financialAuditMoneyEqual(receivable.legacyReceived,1750)))throw new Error('B643124 Receivable identity 或 stale values 在 Execute 前已改變。');
    if(financialRepairFingerprint(legacyBank)!==preview.protectedFingerprints?.b643124LegacyBank?.fingerprint)throw new Error('B643124 verified legacy bank fingerprint 已改變。');
    const attendance=state.attendance.filter((row)=>text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.date)===target.stalePayroll.month),commissions=state.commissions.filter((row)=>text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.date)===target.stalePayroll.month&&row.status==='已列入薪資'),adjustmentFields=['manualFuel','meal','other','overtime','bonus','allowance','advance','laborInsurance','incomeTax','deduction'],adjustmentTotal=adjustmentFields.reduce((sum,key)=>sum+Math.abs(num(stalePayroll[key])),0),salaryPayments=state.salaryPayments.filter((row)=>text(row.payrollId)===target.stalePayroll.id||!text(row.payrollId)&&text(row.employee||row.employeeId)===target.stalePayroll.employee&&monthOf(row.month||row.date)===target.stalePayroll.month),truth=payrollPaymentTruth(stalePayroll);
    if(!(text(stalePayroll.employee||stalePayroll.employeeId)===target.stalePayroll.employee&&text(stalePayroll.month)===target.stalePayroll.month&&text(stalePayroll.status)==='已付款'&&financialAuditMoneyEqual(stalePayroll.total,4000)&&attendance.length===0&&commissions.length===0&&adjustmentTotal===0&&salaryPayments.length===0&&truth.hasVerifiedPayment===false&&truth.bankTransactionIds.length===0&&truth.integrity==='stale-payroll-status'))throw new Error('Stale Payroll facts 或付款 truth 在 Execute 前已改變。');
    return {billing,receivable,stalePayroll,legacyBank};
  }
  function globalFinancialRepairAssertSummary(before,after,stage) {
    if(before.billingAmountMismatchCount!==1||after.billingAmountMismatchCount!==0||after.billingAmountMismatchCount!==before.billingAmountMismatchCount-1)throw new Error(`${stage}：billingAmountMismatchCount 未精確減 1 至 0。`);
    if(before.stalePayrollCount!==1||after.stalePayrollCount!==0||after.stalePayrollCount!==before.stalePayrollCount-1)throw new Error(`${stage}：stalePayrollCount 未精確減 1 至 0。`);
    ['billingCount','receivableCount','orphanReceivableCount','orphanInvoiceCount','paymentIntegrityIssueCount','orphanPayableCount','orphanBankTransactionCount'].forEach((key)=>{if(after[key]!==before[key])throw new Error(`${stage}：${key} 發生非預期變動。`)});
  }
  function globalFinancialRepairAssertState(source,protection,stage,afterPersist=false) {
    const target=GLOBAL_FINANCIAL_REPAIR_TARGETS,text=financialAuditText,receivables=(source?.receivables||[]).filter((row)=>text(row.id)===target.b643124.receivableId),billings=(source?.billings||[]).filter((row)=>text(row.id)===target.b643124.billingId&&text(row.number)===target.b643124.billingNo),legacyBanks=(source?.bankTransactions||[]).filter((row)=>text(row.id)===target.b643124.bankTransactionId),stalePayroll=(source?.payroll||[]).filter((row)=>text(row.id)===target.stalePayroll.id);
    if(receivables.length!==1||billings.length!==1||legacyBanks.length!==1||stalePayroll.length!==0)throw new Error(`${stage}：Repair target post-state 不正確。`);
    const receivable=receivables[0];
    Object.entries(GLOBAL_FINANCIAL_REPAIR_PATCH).forEach(([key,value])=>{const matches=typeof value==='number'?financialAuditMoneyEqual(receivable[key],value):receivable[key]===value;if(!matches)throw new Error(`${stage}：B643124 Receivable.${key} 不正確。`)});
    if(financialAuditMoneyEqual(num(receivable.amount)-num(receivable.received),88)===false||Object.prototype.hasOwnProperty.call(receivable,'remainingRetention')&&!financialAuditMoneyEqual(receivable.remainingRetention,0))throw new Error(`${stage}：B643124 outstanding 或 remainingRetention 不正確。`);
    if(financialRepairFingerprint(globalFinancialRepairOmit(receivable,protection.receivableMutableFields))!==protection.receivableImmutableFingerprint)throw new Error(`${stage}：B643124 Receivable 非核准欄位發生變動。`);
    if(financialRepairFingerprint(billings[0])!==protection.billingFingerprint||financialRepairFingerprint(legacyBanks[0])!==protection.legacyBankFingerprint)throw new Error(`${stage}：B643124 Billing 或 legacy bank 發生變動。`);
    globalFinancialRepairAssertFingerprints(globalFinancialRepairStateFingerprints(source),protection.stateFingerprints,stage);
    const counts=globalFinancialRepairCounts(source);
    Object.keys(protection.counts).forEach((key)=>{const expected=key==='payroll'?protection.counts[key]-1:key==='audit'&&afterPersist?Math.min(300,protection.counts[key]+1):protection.counts[key];if(counts[key]!==expected)throw new Error(`${stage}：${key} collection count 發生非預期變動。`)});
  }
  async function financialIntegrityRepairExecute(confirmation={}) {
    await load();
    const decisions=confirmation?.decisions||{},preview=await financialIntegrityRepairPreview({decisions}),reason=String(confirmation?.reason||'').trim();
    if(confirmation?.confirmed!==true)throw new Error('必須明確確認執行 GLOBAL FINANCIAL INTEGRITY REPAIR。');
    if(!reason)throw new Error('請輸入 GLOBAL FINANCIAL INTEGRITY REPAIR 原因。');
    const repairs=globalFinancialRepairDeterministicScope(preview),beforeAudit=financialIntegrityAuditReport(),previewFingerprints=globalFinancialRepairPreviewFingerprints(beforeAudit);
    if(financialRepairFingerprint(preview.protectedFingerprints)!==financialRepairFingerprint(previewFingerprints))throw new Error('Preview protectedFingerprints 已失效。');
    if(beforeAudit.summary.billingAmountMismatchCount!==1||beforeAudit.summary.stalePayrollCount!==1)throw new Error('GLOBAL Repair before-summary 不符合精確兩筆 deterministic repair。');
    const targets=globalFinancialRepairTargetGate(preview),snapshot=globalFinancialRepairClone(state),snapshotFingerprint=financialRepairFingerprint(snapshot),counts=globalFinancialRepairCounts(snapshot),metaFingerprint=financialRepairFingerprint(snapshot.meta),auditFingerprint=financialRepairFingerprint(snapshot.audit),stateFingerprints=globalFinancialRepairStateFingerprints(snapshot),billingFingerprint=financialRepairFingerprint(targets.billing),legacyBankFingerprint=financialRepairFingerprint(targets.legacyBank),receivableMutableFields=[...Object.keys(GLOBAL_FINANCIAL_REPAIR_PATCH),'remainingRetention'],receivableImmutableFingerprint=financialRepairFingerprint(globalFinancialRepairOmit(targets.receivable,receivableMutableFields)),protection={counts,stateFingerprints,billingFingerprint,legacyBankFingerprint,receivableMutableFields,receivableImmutableFingerprint},persistAction=`GLOBAL FINANCIAL INTEGRITY REPAIR｜B643124 + stale payroll｜原因：${reason}`;
    const restore=async()=>{
      state=globalFinancialRepairClone(snapshot);
      if(!db)db=await openDB();
      if(!db)throw new Error('GLOBAL Repair rollback 無法取得 IndexedDB。');
      await dbSet(STATE_KEY,state);
      localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state));
      window.KuSheLegacyData?.refresh();
      const dbState=await dbGet(STATE_KEY),emergencyState=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null');
      if(financialRepairFingerprint(state)!==snapshotFingerprint||financialRepairFingerprint(dbState)!==snapshotFingerprint||financialRepairFingerprint(emergencyState)!==snapshotFingerprint)throw new Error('GLOBAL Repair rollback fingerprint 驗證失敗。');
      return true;
    };
    try {
      Object.assign(targets.receivable,repairs.receivableRepair.patch);
      if(Object.prototype.hasOwnProperty.call(targets.receivable,'remainingRetention'))targets.receivable.remainingRetention=0;
      state.payroll=state.payroll.filter((row)=>financialAuditText(row.id)!==GLOBAL_FINANCIAL_REPAIR_TARGETS.stalePayroll.id);
      globalFinancialRepairAssertState(state,protection,'persist 前');
      if(financialRepairFingerprint(state.meta)!==metaFingerprint||financialRepairFingerprint(state.audit)!==auditFingerprint)throw new Error('persist 前：meta 或 audit 提前發生變動。');
      const prePersistAudit=financialIntegrityAuditReport();
      globalFinancialRepairAssertSummary(beforeAudit.summary,prePersistAudit.summary,'persist 前 audit');
      let persistCount=0;
      persistCount+=1;
      await persist(persistAction);
      if(persistCount!==1)throw new Error('GLOBAL Repair persist 次數不等於 1。');
      globalFinancialRepairAssertState(state,protection,'persist 後 memory',true);
      if(!db)throw new Error('persist 後無法取得 IndexedDB。');
      const persistedState=await dbGet(STATE_KEY),emergencyState=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null'),persistedFingerprint=financialRepairFingerprint(state);
      globalFinancialRepairAssertState(persistedState,protection,'persist 後 IndexedDB',true);
      globalFinancialRepairAssertState(emergencyState,protection,'persist 後 Emergency backup',true);
      if(financialRepairFingerprint(persistedState)!==persistedFingerprint||financialRepairFingerprint(emergencyState)!==persistedFingerprint)throw new Error('persist 後三層完整 state fingerprint 不一致。');
      const postRepairAudit=financialIntegrityAuditReport();
      globalFinancialRepairAssertSummary(beforeAudit.summary,postRepairAudit.summary,'persist 後 audit');
      return {repaired:true,singlePersist:true,reason,repairs:{B643124:{receivableId:GLOBAL_FINANCIAL_REPAIR_TARGETS.b643124.receivableId,amountBefore:1750,amountAfter:1838,received:1750,outstanding:88,status:'部分收款'},stalePayroll:{id:GLOBAL_FINANCIAL_REPAIR_TARGETS.stalePayroll.id,removed:true}},protected:{legacyBank:GLOBAL_FINANCIAL_REPAIR_TARGETS.b643124.bankTransactionId,manualReviewCount:preview.manualReview.length,preservedLegacyCount:preview.preservedLegacy.length},postRepairSummary:postRepairAudit.summary};
    } catch(error) {
      try { await restore(); error.rollbackVerified=true; }
      catch(rollbackError) { error.rollbackVerified=false; error.rollbackError=rollbackError; }
      throw error;
    }
  }
  const FINANCIAL_PHASE2_VERIFIED_LEGACY_AR_IDS = new Set(['ms5wu3kfv2eiyi','ms5wqxzh6t3v2h','ms5m66l0di3nvs']);
  const financialPhase2Clone=(value)=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const financialPhase2Date=(row)=>financialAuditText(row?.invoiceDate||row?.date||row?.createdAt).slice(0,10);
  const financialPhase2Month=(row)=>financialPhase2Date(row).slice(0,7);
  const financialPhase2Project=(row)=>{
    const id=financialAuditText(row?.project||row?.projectId),found=(state.projects||[]).find((item)=>financialAuditText(item.id)===id);
    return {id,name:financialAuditText(row?.projectName||found?.name)};
  };
  const financialPhase2Party=(row,side='AR')=>{
    const isAP=side==='AP',id=financialAuditText(isAP?(row?.vendor||row?.vendorId||row?.supplier||row?.supplierId):(row?.customer||row?.customerId)),collection=isAP?(state.vendors||[]):(state.customers||[]),found=collection.find((item)=>financialAuditText(item.id)===id),fallback=isAP?(row?.vendorName||row?.supplierName||row?.partyName||row?.party):(row?.customerName||row?.partyName||row?.party);
    return {id,name:financialAuditText(fallback||found?.name)};
  };
  const financialPhase2SameIdentity=(left,right)=>Boolean(left.id&&right.id&&left.id===right.id||left.name&&right.name&&sameName(left.name,right.name));
  const financialPhase2AmountValues=(row,kind='generic')=>{
    const values=[];
    const add=(value)=>{if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))values.push(Number(value))};
    if(kind==='invoice'){
      add(row?.grossAmount);add(row?.grossTotal);add(row?.taxIncludedAmount);add(row?.total);
      if(financialAuditHas(row,'netAmount')||financialAuditHas(row,'taxAmount'))add(num(row?.netAmount)+num(row?.taxAmount));
      add(row?.amount);
    } else if(kind==='daily'){
      const untaxed=(row?.items||[]).reduce((sum,item)=>sum+num(financialAuditFirst(item,['untaxedSubtotal','preTaxAmount','amount'],num(item.qty)*num(item.price))),0);
      add(untaxed);add(Math.round(untaxed*(1+(num(state.settings?.defaultTax)||5)/100)));add(row?.performance);
    } else if(kind==='quotation'){
      const untaxed=(row?.lines||row?.items||[]).reduce((sum,item)=>sum+num(financialAuditFirst(item,['untaxedSubtotal','preTaxAmount','amount'],num(item.qty)*num(item.price))),0);
      add(row?.grossTotal);add(row?.taxIncludedAmount);add(row?.total);add(row?.amount);add(untaxed);
    } else {
      add(row?.grossTotal);add(row?.grossAmount);add(row?.taxIncludedAmount);add(row?.total);add(row?.amount);add(row?.preTaxAmount);add(row?.untaxedAmount);
    }
    return [...new Set(values)];
  };
  const financialPhase2SemanticEvidence=(left,right,{side='AR',leftKind='generic',rightKind='generic'}={})=>{
    const leftProject=financialPhase2Project(left),rightProject=financialPhase2Project(right),leftParty=financialPhase2Party(left,side),rightParty=financialPhase2Party(right,side),leftDate=financialPhase2Date(left),rightDate=financialPhase2Date(right),leftAmounts=financialPhase2AmountValues(left,leftKind),rightAmounts=financialPhase2AmountValues(right,rightKind);
    const projectExact=financialPhase2SameIdentity(leftProject,rightProject),partyExact=financialPhase2SameIdentity(leftParty,rightParty),dateExact=Boolean(leftDate&&rightDate&&leftDate===rightDate),dateCompatible=Boolean(dateExact||financialPhase2Month(left)&&financialPhase2Month(left)===financialPhase2Month(right)),amountExact=leftAmounts.some((value)=>rightAmounts.some((candidate)=>financialAuditMoneyEqual(value,candidate))),leftSource=financialAuditText(left?.sourceNo||left?.billingNo||left?.payableNo),rightSourceValues=[right?.sourceNo,right?.number,right?.billingNo,right?.payableNo,right?.invoiceNumber,right?.invoiceNo].map(financialAuditText).filter(Boolean),sourceExact=Boolean(leftSource&&rightSourceValues.includes(leftSource));
    let confidence='';
    if(projectExact&&partyExact&&dateCompatible&&amountExact)confidence='EXACT';
    else if(sourceExact&&(projectExact||partyExact)&&amountExact)confidence='EXACT';
    else if(projectExact&&amountExact&&(partyExact||dateCompatible))confidence='STRONG';
    else if(sourceExact||projectExact&&partyExact||projectExact&&amountExact||partyExact&&amountExact)confidence='WEAK';
    return {projectExact,partyExact,dateExact,dateCompatible,amountExact,sourceExact,confidence,leftProject,rightProject,leftParty,rightParty,leftDate,rightDate,leftAmounts,rightAmounts};
  };
  const financialPhase2StrictARInvoiceExact=(evidence)=>Boolean(evidence?.projectExact&&evidence?.partyExact&&evidence?.dateCompatible&&evidence?.amountExact);
  const financialPhase2InputInvoice=(invoice)=>invoice?.invoiceType==='input'||/進項/u.test(financialAuditText(invoice?.type));
  const financialPhase2InvoiceNumber=(invoice)=>financialAuditText(invoice?.invoiceNumber||invoice?.invoiceNo||invoice?.number);
  const financialPhase2RawInvoice=(invoice)=>({
    raw:financialPhase2Clone(invoice),id:financialAuditText(invoice?.id||invoice?.invoiceId),invoiceNumber:financialAuditText(invoice?.invoiceNumber),number:financialAuditText(invoice?.number),invoiceDate:invoice?.invoiceDate||'',date:invoice?.date||'',invoiceType:invoice?.invoiceType||'',type:invoice?.type||'',party:invoice?.party||'',customer:invoice?.customer||'',customerName:invoice?.customerName||'',vendor:invoice?.vendor||'',vendorName:invoice?.vendorName||'',project:invoice?.project||'',projectName:invoice?.projectName||'',sourceType:invoice?.sourceType||'',sourceId:invoice?.sourceId||'',sourceNo:invoice?.sourceNo||'',billingId:invoice?.billingId||'',receivableId:invoice?.receivableId||'',payableId:invoice?.payableId||'',netAmount:num(invoice?.netAmount??invoice?.amount),amount:num(invoice?.amount),taxAmount:num(invoice?.taxAmount??invoice?.tax),tax:num(invoice?.tax),grossAmount:num(invoice?.grossAmount??invoice?.total),total:num(invoice?.total),status:invoice?.status||'',note:invoice?.note||'',createdAt:invoice?.createdAt||'',updatedAt:invoice?.updatedAt||''
  });
  const financialPhase2AuditHistory=(terms)=>{
    const needles=terms.map(financialAuditText).filter(Boolean);
    if(!needles.length)return [];
    return (state.audit||[]).filter((row)=>{const haystack=JSON.stringify(row);return needles.some((term)=>haystack.includes(term))}).map(financialPhase2Clone);
  };
  function financialIntegrityPhase2AuditReport() {
    const beforeFingerprint=financialRepairFingerprint(state),baseAudit=financialIntegrityAuditReport(),billings=state.billings||[],receivables=state.receivables||[],invoices=state.invoices||[],dailyLogs=state.dailyLogs||[],quotations=state.quotations||[],receipts=state.receipts||[],retentionReceipts=state.retentionReceipts||[],banks=state.banks||[],bankTransactions=state.bankTransactions||[],payables=state.payables||[],payments=state.payments||[],materialUsages=state.materialUsages||[];
    const orphanReceivableIds=new Set(baseAudit.receivables.filter((row)=>row.orphanClassification).map((row)=>financialAuditText(row.id))),orphanInvoiceIds=new Set(baseAudit.invoices.filter((row)=>row.orphanInvoice).map((row)=>financialAuditText(row.id))),orphanPaymentIds=new Set(baseAudit.payments.filter((row)=>row.orphanPayment).map((row)=>financialAuditText(row.id))),orphanMaterialIds=new Set(baseAudit.materialPayableLinks.filter((row)=>row.orphanMaterialPayable).map((row)=>financialAuditText(row.materialUsageId)));
    const orphanReceivables=receivables.filter((row)=>orphanReceivableIds.has(financialAuditText(row.id))),orphanInvoices=invoices.filter((row)=>orphanInvoiceIds.has(financialAuditText(row.id))),orphanPayments=payments.filter((row)=>orphanPaymentIds.has(financialAuditText(row.id))),orphanMaterials=materialUsages.filter((row)=>orphanMaterialIds.has(financialAuditText(row.id)));
    const receiptRowsFor=(receivable)=>receipts.filter((row)=>financialAuditText(row.receivableId)===financialAuditText(receivable.id)),retentionRowsFor=(receivable)=>retentionReceipts.filter((row)=>financialAuditText(row.receivableId)===financialAuditText(receivable.id)),bankRowsForReceivable=(receivable)=>bankTransactions.filter((row)=>[row.receivableId,row.sourceId].map(financialAuditText).includes(financialAuditText(receivable.id))||financialAuditText(receivable.sourceNo)&&financialAuditText(row.sourceNo)===financialAuditText(receivable.sourceNo));
    const receivableFindings=orphanReceivables.map((receivable)=>{
      const invoiceCandidates=orphanInvoices.map((invoice)=>({id:financialAuditText(invoice.id),number:financialPhase2InvoiceNumber(invoice),evidence:financialPhase2SemanticEvidence(receivable,invoice,{side:'AR',rightKind:'invoice'})})).filter((row)=>row.evidence.confidence),billingCandidates=billings.map((billing)=>({id:financialAuditText(billing.id),number:financialAuditText(billing.number),evidence:financialPhase2SemanticEvidence(receivable,billing,{side:'AR'})})).filter((row)=>row.evidence.confidence),dailyCandidates=dailyLogs.map((daily)=>({id:financialAuditText(daily.id),workItemIds:(daily.items||[]).map((item)=>financialAuditText(item.workItemId)).filter(Boolean),items:financialPhase2Clone(daily.items||[]),evidence:financialPhase2SemanticEvidence(receivable,daily,{side:'AR',rightKind:'daily'})})).filter((row)=>row.evidence.confidence),quotationCandidates=quotations.filter((row)=>financialAuditText(row.status)==='已確認').map((quotation)=>({id:financialAuditText(quotation.id),number:financialAuditText(quotation.number),lineIds:(quotation.lines||quotation.items||[]).map((line)=>financialAuditText(line.id)).filter(Boolean),lines:financialPhase2Clone(quotation.lines||quotation.items||[]),evidence:financialPhase2SemanticEvidence(receivable,quotation,{side:'AR',rightKind:'quotation'})})).filter((row)=>row.evidence.confidence),receiptRows=receiptRowsFor(receivable),retentionRows=retentionRowsFor(receivable),bankRows=bankRowsForReceivable(receivable),directInvoices=invoices.filter((invoice)=>financialAuditText(invoice.receivableId)===financialAuditText(receivable.id)||financialAuditText(receivable.sourceNo)&&financialAuditText(invoice.sourceNo)===financialAuditText(receivable.sourceNo)),exactInvoices=invoiceCandidates.filter((row)=>financialPhase2StrictARInvoiceExact(row.evidence)),exactDaily=dailyCandidates.filter((row)=>row.evidence.projectExact&&row.evidence.dateCompatible&&row.evidence.amountExact),multipleStrong=[...invoiceCandidates,...billingCandidates,...dailyCandidates,...quotationCandidates].filter((row)=>['EXACT','STRONG'].includes(row.evidence.confidence)).length>1;
      const verifiedLegacy=FINANCIAL_PHASE2_VERIFIED_LEGACY_AR_IDS.has(financialAuditText(receivable.id))&&(receiptRows.length>0||bankRows.length>0);
      let classification='TEST_OR_STALE_CANDIDATE',reason='未找到可唯一證明此應收的 Billing、Invoice、施工、報價或收款證據。';
      if(FINANCIAL_PHASE2_VERIFIED_LEGACY_AR_IDS.has(financialAuditText(receivable.id))&&!verifiedLegacy){classification='AMBIGUOUS';reason='已知 verified legacy AR 的 Receipt／Bank 證據已改變。';}
      else if(verifiedLegacy){classification='KEEP_AS_VERIFIED_LEGACY';reason='已驗證歷史已收應收，保留且只做 fingerprint 保護。';}
      else if(exactInvoices.length===1){classification='LEGACY_AR_INVOICE_BUNDLE';reason='存在唯一 project/customer/date/amount 相符的 orphan Invoice。';}
      else if(exactDaily.length===1){classification='REBUILD_BILLING_PARENT_CANDIDATE';reason='存在唯一可解析施工來源，可供後續重建 Billing parent 評估。';}
      else if(multipleStrong){classification='AMBIGUOUS';reason='存在多個 EXACT／STRONG 語意候選。';}
      else if([...invoiceCandidates,...dailyCandidates,...quotationCandidates].length){classification='LEGACY_OPEN_REAL';reason='存在施工、報價或發票歷史證據，但不足以 deterministic 重建。';}
      return {id:financialAuditText(receivable.id),raw:financialPhase2Clone(receivable),customer:financialPhase2Party(receivable,'AR'),project:financialPhase2Project(receivable),date:financialPhase2Date(receivable),sourceNo:financialAuditText(receivable.sourceNo),amount:num(receivable.amount),taxFields:{grossTotal:num(receivable.grossTotal),taxIncludedAmount:num(receivable.taxIncludedAmount),untaxedAmount:num(receivable.untaxedAmount),preTaxAmount:num(receivable.preTaxAmount),tax:num(receivable.tax),taxAmount:num(receivable.taxAmount)},received:num(receivable.received),legacyReceived:num(receivable.legacyReceived),note:receivable.note||'',createdAt:receivable.createdAt||'',updatedAt:receivable.updatedAt||'',receiptCount:receiptRows.length,retentionReceiptCount:retentionRows.length,bankCount:bankRows.length,directInvoiceIds:directInvoices.map((row)=>financialAuditText(row.id)),evidence:{billingCandidates,invoiceCandidates,dailyCandidates,quotationCandidates,bankTransactionIds:bankRows.map((row)=>financialAuditText(row.id)),receiptIds:receiptRows.map((row)=>financialAuditText(row.id)),auditHistory:financialPhase2AuditHistory([receivable.id,receivable.sourceNo,financialPhase2Project(receivable).name])},classification,reason,repairEligible:false};
    });
    const invoiceFindings=orphanInvoices.map((invoice)=>{
      const arCandidates=receivableFindings.map((finding)=>({id:finding.id,evidence:financialPhase2SemanticEvidence(finding.raw,invoice,{side:'AR',rightKind:'invoice'})})).filter((row)=>row.evidence.confidence),billingCandidates=billings.map((billing)=>({id:financialAuditText(billing.id),number:financialAuditText(billing.number),evidence:financialPhase2SemanticEvidence(invoice,billing,{side:'AR',leftKind:'invoice'})})).filter((row)=>row.evidence.confidence),exactAR=arCandidates.filter((row)=>financialPhase2StrictARInvoiceExact(row.evidence)),exactBilling=billingCandidates.filter((row)=>financialPhase2StrictARInvoiceExact(row.evidence)),identity=financialPhase2RawInvoice(invoice),empty=!financialPhase2InvoiceNumber(invoice)&&!financialPhase2Project(invoice).id&&!financialPhase2Project(invoice).name&&!financialPhase2Party(invoice,'AR').id&&!financialPhase2Party(invoice,'AR').name&&financialPhase2AmountValues(invoice,'invoice').every((value)=>financialAuditMoneyEqual(value,0)),completeLegacy=Boolean(financialPhase2InvoiceNumber(invoice)&&financialPhase2Date(invoice)&&financialPhase2AmountValues(invoice,'invoice').some((value)=>value>0)&&(financialPhase2Project(invoice).id||financialPhase2Project(invoice).name||financialPhase2Party(invoice,'AR').id||financialPhase2Party(invoice,'AR').name));
      let classification='KEEP_AS_VERIFIED_LEGACY_INVOICE',reason='具完整歷史發票欄位，但沒有唯一現代 parent。';
      if(exactAR.length===1&&receivableFindings.find((row)=>row.id===exactAR[0].id)?.classification==='KEEP_AS_VERIFIED_LEGACY'){classification='KEEP_AS_VERIFIED_LEGACY_INVOICE';reason='與已驗證歷史已收 Receivable 精確成組，只保留並做 fingerprint 保護。';}
      else if(exactAR.length===1){classification='LEGACY_AR_INVOICE_BUNDLE';reason='與唯一 orphan Receivable 的 project/customer/date/amount 精確吻合。';}
      else if(exactBilling.length===1){classification='UNIQUE_BILLING_LINK_CANDIDATE';reason='與唯一現有 Billing 精確吻合。';}
      else if(exactAR.length>1||exactBilling.length>1){classification='AMBIGUOUS';reason='存在多個精確 parent 候選。';}
      else if(empty){classification='EMPTY_TEST_CANDIDATE';reason='發票缺少 identity、來源與有效金額。';}
      else if(!completeLegacy){classification='AMBIGUOUS';reason='發票只有部分歷史 identity，無法證明為完整 legacy Invoice。';}
      return {...identity,projectIdentity:financialPhase2Project(invoice),partyIdentity:financialPhase2Party(invoice,'AR'),billingCandidateCount:billingCandidates.length,receivableCandidateCount:arCandidates.length,billingCandidates,receivableCandidates:arCandidates,evidence:{dailyCandidates:dailyLogs.map((daily)=>({id:financialAuditText(daily.id),evidence:financialPhase2SemanticEvidence(invoice,daily,{side:'AR',leftKind:'invoice',rightKind:'daily'})})).filter((row)=>row.evidence.confidence),auditHistory:financialPhase2AuditHistory([invoice.id,financialPhase2InvoiceNumber(invoice),invoice.sourceNo])},classification,reason,repairEligible:false};
    });
    const paymentFindings=orphanPayments.map((payment)=>{
      const payableId=financialAuditText(payment.payableId),materials=materialUsages.filter((row)=>financialAuditText(row.payableId)===payableId),linkedInvoices=invoices.filter((row)=>financialPhase2InputInvoice(row)&&[row.payableId,row.sourceId].map(financialAuditText).includes(payableId)),linkedBanks=bankTransactions.filter((row)=>[row.payableId,row.sourceId,row.paymentId].map(financialAuditText).includes(payableId)||financialAuditText(row.sourceId)===financialAuditText(payment.id)),payableCandidates=payables.map((payable)=>({id:financialAuditText(payable.id),number:financialAuditText(payable.payableNo||payable.number),evidence:financialPhase2SemanticEvidence(payment,payable,{side:'AP'})})).filter((row)=>row.evidence.confidence),exact=payableCandidates.filter((row)=>row.evidence.confidence==='EXACT');
      let classification='STALE_LEGACY_PAYMENT_ONLY',reason='只有 legacy Payment，沒有 parent、材料、發票或銀行證據。';
      if(materials.length||linkedInvoices.length){classification='MISSING_PAYABLE_PARENT_BUNDLE';reason='同一 missing payableId 尚有材料或發票 child。';}
      else if(exact.length===1){classification='CURRENT_PAYABLE_RELINK_CANDIDATE';reason='存在唯一 exact 現有 Payable 候選。';}
      else if(exact.length>1||payableCandidates.filter((row)=>row.evidence.confidence==='STRONG').length>1){classification='AMBIGUOUS';reason='存在多個 Payable 候選。';}
      return {id:financialAuditText(payment.id),raw:financialPhase2Clone(payment),payableId,amount:num(payment.amount),date:financialPhase2Date(payment),vendor:financialPhase2Party(payment,'AP'),project:financialPhase2Project(payment),note:payment.note||payment.description||'',bankTransactionIds:linkedBanks.map((row)=>financialAuditText(row.id)),materialUsageIds:materials.map((row)=>financialAuditText(row.id)),invoiceIds:linkedInvoices.map((row)=>financialAuditText(row.id)),payableCandidates,classification,reason,repairEligible:false,auditHistory:financialPhase2AuditHistory([payment.id,payableId])};
    });
    const materialGroups=new Map();
    orphanMaterials.forEach((usage)=>{const key=financialAuditText(usage.payableId)||'(missing-id)';if(!materialGroups.has(key))materialGroups.set(key,[]);materialGroups.get(key).push(usage)});
    const missingPayableBundles=[...materialGroups.entries()].map(([missingPayableId,rows])=>{
      const totalMaterialAmount=rows.reduce((sum,row)=>sum+num(row.amount??num(row.quantity??row.qty)*num(row.unitPrice??row.price)),0),representative={...rows[0],amount:totalMaterialAmount,date:rows.map(financialPhase2Date).filter(Boolean).sort()[0]||''},relatedPayments=payments.filter((row)=>financialAuditText(row.payableId)===missingPayableId),relatedInvoices=invoices.filter((row)=>financialPhase2InputInvoice(row)&&[row.payableId,row.sourceId].map(financialAuditText).includes(missingPayableId)),relatedBanks=bankTransactions.filter((row)=>[row.payableId,row.sourceId].map(financialAuditText).includes(missingPayableId)),payableCandidates=payables.map((payable)=>({id:financialAuditText(payable.id),number:financialAuditText(payable.payableNo||payable.number),evidence:financialPhase2SemanticEvidence(representative,payable,{side:'AP'})})).filter((row)=>row.evidence.confidence),exact=payableCandidates.filter((row)=>row.evidence.confidence==='EXACT'),validMaterials=rows.every((row)=>financialAuditText(row.id)&&financialAuditText(row.materialName||row.material||row.materialId)&&num(row.amount??num(row.quantity??row.qty)*num(row.unitPrice??row.price))>0);
      let classification='HISTORICAL_MATERIAL_ONLY',reason='材料歷史存在，但證據不足以安全重建 parent。';
      if(exact.length===1){classification='RELINK_TO_EXISTING_PAYABLE';reason='材料 bundle 與唯一現有 Payable 精確吻合。';}
      else if(exact.length>1||payableCandidates.filter((row)=>row.evidence.confidence==='STRONG').length>1){classification='AMBIGUOUS';reason='材料 bundle 對應多個 Payable 候選。';}
      else if(validMaterials&&totalMaterialAmount>0&&(financialPhase2Project(representative).id||financialPhase2Project(representative).name)&&(financialPhase2Party(representative,'AP').id||financialPhase2Party(representative,'AP').name)&&financialPhase2Date(representative)){classification='REBUILD_MISSING_PAYABLE_PARENT';reason='同一 missing payableId 具有完整材料來源、廠商、案場、日期與可重建金額。';}
      else if(!validMaterials){classification='TEST_OR_STALE_MATERIAL';reason='材料 identity 或有效金額不足。';}
      return {missingPayableId,materialUsageIds:rows.map((row)=>financialAuditText(row.id)),count:rows.length,rawMaterialUsages:financialPhase2Clone(rows),vendor:financialPhase2Party(representative,'AP'),project:financialPhase2Project(representative),dates:[...new Set(rows.map(financialPhase2Date).filter(Boolean))],materials:rows.map((row)=>({id:financialAuditText(row.id),name:financialAuditText(row.materialName||row.material||row.materialId),quantity:num(row.quantity??row.qty),unitPrice:num(row.unitPrice??row.price),amount:num(row.amount??num(row.quantity??row.qty)*num(row.unitPrice??row.price))})),totalMaterialAmount,paymentIds:relatedPayments.map((row)=>financialAuditText(row.id)),invoiceIds:relatedInvoices.map((row)=>financialAuditText(row.id)),bankTransactionIds:relatedBanks.map((row)=>financialAuditText(row.id)),payableCandidates,classification,reason,repairEligible:false,auditHistory:financialPhase2AuditHistory([missingPayableId,...rows.map((row)=>row.id)])};
    });
    const mismatchIds=new Set(baseAudit.payables.filter((row)=>row.invoiceMismatch).map((row)=>financialAuditText(row.id)));
    const payableInvoiceMismatches=payables.filter((row)=>mismatchIds.has(financialAuditText(row.id))).map((payable)=>{
      const linkedInvoices=invoices.filter((invoice)=>financialPhase2InputInvoice(invoice)&&(financialAuditText(invoice.payableId||invoice.sourceId)===financialAuditText(payable.id)||legacyInvoicePayable(invoice)===payable)),payableAmount=num(financialAuditFirst(payable,['grossTotal','total','amount'],0)),identityMismatch=linkedInvoices.some((invoice)=>{const evidence=financialPhase2SemanticEvidence(payable,invoice,{side:'AP',rightKind:'invoice'});return financialPhase2Project(payable).id||financialPhase2Project(payable).name||financialPhase2Party(payable,'AP').id||financialPhase2Party(payable,'AP').name?!evidence.projectExact&&!evidence.partyExact:false}),netMatches=linkedInvoices.length>0&&linkedInvoices.every((invoice)=>financialAuditMoneyEqual(payableAmount,financialAuditFirst(invoice,['netAmount','amount'],0))),grossMatches=linkedInvoices.length>0&&linkedInvoices.every((invoice)=>financialAuditMoneyEqual(payableAmount,financialAuditFirst(invoice,['grossAmount','total'],num(invoice.netAmount)+num(invoice.taxAmount))));
      let classification='ACTUAL_AMOUNT_ERROR',reason='關聯 identity 可解析，但 Payable 與 Invoice 金額無法一致。';
      if(linkedInvoices.length!==1)classification='AMBIGUOUS',reason='Linked input Invoice 數量不是 1。';
      else if(identityMismatch)classification='WRONG_INVOICE_LINK',reason='Payable 與 Invoice 的 vendor/project identity 不一致。';
      else if(netMatches&&!grossMatches)classification='NET_VS_GROSS_INTERPRETATION',reason='Payable amount 對應 invoice net，而非 gross。';
      else if(/legacy/i.test(financialAuditText(payable.sourceType)))classification='LEGACY_AMOUNT',reason='Legacy Payable 金額口徑與 linked Invoice 不一致。';
      return {payableId:financialAuditText(payable.id),rawPayable:financialPhase2Clone(payable),payable:{payableNo:payable.payableNo||payable.number||payable.sourceNo||'',vendor:payable.vendor||'',vendorName:payable.vendorName||'',project:payable.project||'',projectName:payable.projectName||'',amount:num(payable.amount),paid:num(payable.paid),taxMode:payable.taxMode||'',sourceType:payable.sourceType||'',sourceId:payable.sourceId||'',invoiceNo:payable.invoiceNo||'',status:payable.status||''},linkedInvoices:linkedInvoices.map(financialPhase2RawInvoice),classification,reason,repairEligible:false};
    });
    const crossBundles=[];
    receivableFindings.forEach((row)=>{if(['LEGACY_AR_INVOICE_BUNDLE','REBUILD_BILLING_PARENT_CANDIDATE'].includes(row.classification)){const relatedInvoices=invoiceFindings.filter((invoice)=>invoice.receivableCandidates.some((candidate)=>candidate.id===row.id&&candidate.evidence.confidence==='EXACT'));crossBundles.push({bundleId:`AR:${row.id}`,side:'AR',records:{receivableIds:[row.id],invoiceIds:relatedInvoices.map((item)=>item.id),dailyLogIds:row.evidence.dailyCandidates.filter((item)=>item.evidence.confidence==='EXACT').map((item)=>item.id)},evidence:{classification:row.classification,reason:row.reason},suggestedParent:'Billing',confidence:'EXACT'})}});
    invoiceFindings.forEach((invoice)=>invoice.receivableCandidates.filter((candidate)=>financialPhase2StrictARInvoiceExact(candidate.evidence)).forEach((candidate)=>{const id=`AR:${candidate.id}`,receivable=receivableFindings.find((row)=>row.id===candidate.id);if(!crossBundles.some((row)=>row.bundleId===id))crossBundles.push({bundleId:id,side:'AR',records:{receivableIds:[candidate.id],invoiceIds:[invoice.id],dailyLogIds:[]},evidence:{classification:receivable?.classification==='KEEP_AS_VERIFIED_LEGACY'?'KEEP_AS_VERIFIED_LEGACY_BUNDLE':'LEGACY_AR_INVOICE_BUNDLE',reason:invoice.reason},suggestedParent:receivable?.classification==='KEEP_AS_VERIFIED_LEGACY'?'KEEP_LEGACY':'Billing',confidence:'EXACT'})}));
    missingPayableBundles.forEach((row)=>{const confidence=row.classification==='REBUILD_MISSING_PAYABLE_PARENT'||row.classification==='RELINK_TO_EXISTING_PAYABLE'?'EXACT':row.classification==='AMBIGUOUS'?'AMBIGUOUS':'WEAK';crossBundles.push({bundleId:`AP:${row.missingPayableId}`,side:'AP',records:{materialUsageIds:row.materialUsageIds,paymentIds:row.paymentIds,invoiceIds:row.invoiceIds},evidence:{classification:row.classification,reason:row.reason,totalMaterialAmount:row.totalMaterialAmount},suggestedParent:row.classification==='RELINK_TO_EXISTING_PAYABLE'?row.payableCandidates.find((item)=>item.evidence.confidence==='EXACT')?.id||'Payable':'Payable',confidence})});
    const preservedLegacy=[...receivableFindings.filter((row)=>row.classification==='KEEP_AS_VERIFIED_LEGACY').map((row)=>({type:'receivable',id:row.id,fingerprint:financialRepairFingerprint(row.raw),reason:row.reason})),...invoiceFindings.filter((row)=>row.classification==='KEEP_AS_VERIFIED_LEGACY_INVOICE').map((row)=>({type:'invoice',id:row.id,fingerprint:financialRepairFingerprint(row.raw),reason:row.reason}))],rebuildCandidates=crossBundles.filter((row)=>row.confidence==='EXACT'&&['LEGACY_AR_INVOICE_BUNDLE','REBUILD_BILLING_PARENT_CANDIDATE','REBUILD_MISSING_PAYABLE_PARENT'].includes(row.evidence.classification)),relinkCandidates=[...invoiceFindings.filter((row)=>row.classification==='UNIQUE_BILLING_LINK_CANDIDATE').map((row)=>({type:'invoice',id:row.id,candidate:row.billingCandidates.find((candidate)=>financialPhase2StrictARInvoiceExact(candidate.evidence))})),...paymentFindings.filter((row)=>row.classification==='CURRENT_PAYABLE_RELINK_CANDIDATE').map((row)=>({type:'payment',id:row.id,candidate:row.payableCandidates.find((candidate)=>candidate.evidence.confidence==='EXACT')})),...missingPayableBundles.filter((row)=>row.classification==='RELINK_TO_EXISTING_PAYABLE').map((row)=>({type:'material-payable-bundle',id:row.missingPayableId,candidate:row.payableCandidates.find((candidate)=>candidate.evidence.confidence==='EXACT')}))],staleCandidates=[...receivableFindings.filter((row)=>row.classification==='TEST_OR_STALE_CANDIDATE').map((row)=>({type:'receivable',id:row.id,action:'REVIEW_ONLY'})),...invoiceFindings.filter((row)=>row.classification==='EMPTY_TEST_CANDIDATE').map((row)=>({type:'invoice',id:row.id,action:'REVIEW_ONLY'})),...paymentFindings.filter((row)=>row.classification==='STALE_LEGACY_PAYMENT_ONLY').map((row)=>({type:'payment',id:row.id,action:'REVIEW_ONLY'})),...missingPayableBundles.filter((row)=>row.classification==='TEST_OR_STALE_MATERIAL').map((row)=>({type:'material-payable-bundle',id:row.missingPayableId,action:'REVIEW_ONLY'}))];
    const exactMaterialParentIds=new Set(missingPayableBundles.filter((row)=>['REBUILD_MISSING_PAYABLE_PARENT','RELINK_TO_EXISTING_PAYABLE'].includes(row.classification)).map((row)=>row.missingPayableId));
    const manualReview=[...receivableFindings.filter((row)=>['LEGACY_OPEN_REAL','TEST_OR_STALE_CANDIDATE','AMBIGUOUS'].includes(row.classification)).map((row)=>({type:'receivable',id:row.id,classification:row.classification,reason:row.reason})),...invoiceFindings.filter((row)=>['EMPTY_TEST_CANDIDATE','AMBIGUOUS'].includes(row.classification)).map((row)=>({type:'invoice',id:row.id,classification:row.classification,reason:row.reason})),...paymentFindings.filter((row)=>['STALE_LEGACY_PAYMENT_ONLY','AMBIGUOUS'].includes(row.classification)||row.classification==='MISSING_PAYABLE_PARENT_BUNDLE'&&!exactMaterialParentIds.has(row.payableId)).map((row)=>({type:'payment',id:row.id,classification:row.classification,reason:row.reason})),...missingPayableBundles.filter((row)=>['HISTORICAL_MATERIAL_ONLY','TEST_OR_STALE_MATERIAL','AMBIGUOUS'].includes(row.classification)).map((row)=>({type:'material-payable-bundle',id:row.missingPayableId,classification:row.classification,reason:row.reason})),...payableInvoiceMismatches.map((row)=>({type:'payable-invoice-mismatch',id:row.payableId,classification:row.classification,reason:row.reason}))];
    const protectedFingerprints={fullState:beforeFingerprint,modernBillingReceivables:financialRepairFingerprint({billings,receivables:receivables.filter((row)=>!orphanReceivableIds.has(financialAuditText(row.id)))}),B643124:financialRepairFingerprint({billing:billings.find((row)=>financialAuditText(row.number)==='B643124'),receivable:receivables.find((row)=>financialAuditText(row.sourceNo)==='B643124')}),verifiedLegacyReceivables:financialRepairFingerprint(receivables.filter((row)=>FINANCIAL_PHASE2_VERIFIED_LEGACY_AR_IDS.has(financialAuditText(row.id)))),banks:financialRepairFingerprint(banks),bankTransactions:financialRepairFingerprint(bankTransactions),payables:financialRepairFingerprint(payables),payments:financialRepairFingerprint(payments),invoices:financialRepairFingerprint(invoices),materialUsages:financialRepairFingerprint(materialUsages)};
    const afterFingerprint=financialRepairFingerprint(state);
    if(afterFingerprint!==beforeFingerprint)throw new Error('financialIntegrityPhase2Audit 必須是純 READ-ONLY，state fingerprint 發生變動。');
    const summary={...baseAudit.summary,phase2OrphanReceivableCount:receivableFindings.length,phase2OrphanInvoiceCount:invoiceFindings.length,phase2OrphanPaymentCount:paymentFindings.length,phase2MissingPayableBundleCount:missingPayableBundles.length,phase2MaterialUsageCount:orphanMaterials.length,payableInvoiceMismatchCount:payableInvoiceMismatches.length,preservedLegacyCount:preservedLegacy.length,rebuildCandidateCount:rebuildCandidates.length,relinkCandidateCount:relinkCandidates.length,staleCandidateCount:staleCandidates.length,manualReviewCount:manualReview.length,crossBundleCount:crossBundles.length};
    return {readOnly:true,auditVersion:'global-financial-integrity-phase2-v1',generatedAt:new Date().toISOString(),summary,receivableFindings,invoiceFindings,paymentFindings,missingPayableBundles,payableInvoiceMismatches,crossBundles,preservedLegacy,rebuildCandidates,relinkCandidates,staleCandidates,manualReview,phase2BlockingCount:manualReview.length,protectedFingerprints};
  }
  async function financialIntegrityPhase2Audit() {
    await load();
    const before=financialRepairFingerprint(state),report=financialIntegrityPhase2AuditReport();
    if(financialRepairFingerprint(state)!==before)throw new Error('financialIntegrityPhase2Audit 不得修改 Business state。');
    return report;
  }
  const FINANCIAL_PHASE2_REPAIR_TARGETS=Object.freeze({
    ar:[
      {receivableId:'ms5wovzs0mwbks',invoiceId:'ms5wovzsr2j7ct',invoiceNo:'ZX20151569',projectName:'富宇大地B2區',date:'2026-06-26',net:71000,tax:3550,gross:74550},
      {receivableId:'ms5wn0nx6non8s',invoiceId:'ms5wn0nxki8qrh',invoiceNo:'ZX20151568',projectName:'耀時代O3-1',date:'2026-06-26',net:78000,tax:3900,gross:81900},
      {receivableId:'ms5wjo2kt1h7gq',invoiceId:'ms5wjo2k3n42ob',invoiceNo:'ZX20151567',projectName:'富宇大地B1區',date:'2026-06-26',net:269900,tax:13495,gross:283395},
      {receivableId:'ms5mmiwlr0wtih',invoiceId:'ms5wk18zlfj0h5',invoiceNo:'ZX20151565',projectName:'富宇大地C1區',date:'2026-06-26',net:16300,tax:815,gross:17115}
    ],
    ap:{missingPayableId:'msg1ce0ewz9trw',existingPayableId:'msypsa7zelvm1l',invoiceId:'msdd013t26mzmu',invoiceNo:'ZX17129822',legacyPaymentId:'legacy-msg1ce0ewz9trw',vendorName:'健宏油漆',date:'2026-08-03',net:61550,tax:3078,gross:64628,materialUsageIds:['msdcwitv59ctzs','msdcwitvnr8owq','msdcwitvis6vt0','msdctn13t6mudb','msdctn135g8xqa','msdctn13fyrvw2','msdcqi4p4wewrm','msdcp9k13llhxo','msdcp9k1v77l6d','msbvc1ow6p9f1j','ms5yipqhqhu2pe','ms5yj3il3xb6yy','ms5yjc3h32ofdq','ms5yo7tck6kuld','ms5ynaiysljf10','ms5yn7wovxpgw4','ms5yn3rtpmmlrb','ms5ymylqb6yzxg','ms5ympgx7nsqti','ms5ylbckhu95ks','ms5yl4rc1ezjss']},
    fuhua:{receivableId:'ms7l97t7d1m1b7',dailyLogIds:['msethpigr5vn88','msethpigaddmde']},
    stalePaymentIds:['legacy-msro3jackxpx6x','legacy-msro3jacekpp8y','legacy-mssfwwk0ggr5bj','legacy-mssfwwk0r5xp02'],verifiedReceivableIds:['ms5wu3kfv2eiyi','ms5wqxzh6t3v2h','ms5m66l0di3nvs'],verifiedInvoiceIds:['ms5wu3kgb8vmgd','ms5wqxzhk6tqlo']
  });
  const financialPhase2RepairSet=(values)=>new Set((values||[]).flatMap((value)=>Array.isArray(value)?value:String(value??'').split(/[\s,，、;；]+/u)).map(financialAuditText).filter(Boolean));
  const financialPhase2RepairSetEqual=(left,right)=>left.size===right.size&&[...left].every((value)=>right.has(value));
  const financialPhase2RepairUnique=(rows,id,label,blockers)=>{const matches=rows.filter((row)=>financialAuditText(row.id||row.invoiceId)===id);if(matches.length!==1)blockers.push({code:`${label}_IDENTITY_CHANGED`,message:`${label} ${id} 必須精確存在 1 筆，實際 ${matches.length} 筆。`});return matches.length===1?matches[0]:null};
  const financialPhase2RepairInputValues=(invoice)=>{const net=num(financialAuditFirst(invoice,['netAmount','amount'],0)),tax=num(financialAuditFirst(invoice,['taxAmount','tax'],0)),gross=num(financialAuditFirst(invoice,['grossAmount','total'],net+tax));return {net,tax,gross}};
  function financialIntegrityPhase2RepairPlan() {
    const targets=FINANCIAL_PHASE2_REPAIR_TARGETS,beforeFingerprint=financialRepairFingerprint(state),baseAudit=financialIntegrityAuditReport(),phase2Audit=financialIntegrityPhase2AuditReport(),blockers=[],warnings=[],arRebuilds=[];
    const block=(code,message,details={})=>blockers.push({code,message,...details}),warn=(code,message,details={})=>warnings.push({code,message,...details});
    targets.ar.forEach((target)=>{
      const receivable=financialPhase2RepairUnique(state.receivables||[],target.receivableId,'AR_RECEIVABLE',blockers),invoice=financialPhase2RepairUnique(state.invoices||[],target.invoiceId,'AR_INVOICE',blockers),finding=phase2Audit.receivableFindings.find((row)=>row.id===target.receivableId),invoiceFinding=phase2Audit.invoiceFindings.find((row)=>row.id===target.invoiceId),bundle=phase2Audit.crossBundles.find((row)=>row.bundleId===`AR:${target.receivableId}`),billingId=`legacy-billing-${target.receivableId}`,billingNo=`LEGACY-${target.invoiceNo}`;
      if(!receivable||!invoice)return;
      const invoiceValues=financialPhase2RepairInputValues(invoice),semantic=financialPhase2SemanticEvidence(receivable,invoice,{side:'AR',rightKind:'invoice'}),receivableProject=financialPhase2Project(receivable),invoiceProject=financialPhase2Project(invoice),receivableParty=financialPhase2Party(receivable,'AR'),invoiceParty=financialPhase2Party(invoice,'AR'),gates={classification:finding?.classification==='LEGACY_AR_INVOICE_BUNDLE'&&invoiceFinding?.classification==='LEGACY_AR_INVOICE_BUNDLE',bundleExact:bundle?.confidence==='EXACT'&&bundle.records?.invoiceIds?.includes(target.invoiceId),strictIdentity:financialPhase2StrictARInvoiceExact(semantic),invoiceIdentity:financialPhase2InvoiceNumber(invoice)===target.invoiceNo,project:receivableProject.name===target.projectName&&invoiceProject.name===target.projectName,date:financialPhase2Date(receivable)===target.date&&financialPhase2Date(invoice)===target.date,amount:financialAuditMoneyEqual(receivable.amount,target.gross)&&financialAuditMoneyEqual(invoiceValues.net,target.net)&&financialAuditMoneyEqual(invoiceValues.tax,target.tax)&&financialAuditMoneyEqual(invoiceValues.gross,target.gross)&&financialAuditMoneyEqual(invoiceValues.net+invoiceValues.tax,target.gross),unreceived:financialAuditMoneyEqual(receivable.received,0)&&financialAuditMoneyEqual(receivable.legacyReceived,0),billingIdAvailable:!(state.billings||[]).some((row)=>financialAuditText(row.id)===billingId),billingNoAvailable:!(state.billings||[]).some((row)=>financialAuditText(row.number)===billingNo)};
      Object.entries(gates).filter(([,passed])=>!passed).forEach(([gate])=>block(`AR_${target.receivableId}_${gate.toUpperCase()}`,`${target.receivableId} / ${target.invoiceId} 的 ${gate} Gate 未通過。`));
      if(Object.values(gates).every(Boolean)){
        const customer=financialAuditText(receivable.customer||receivable.customerId||invoice.customer||invoice.customerId),customerName=financialAuditText(receivable.customerName||invoice.customerName||receivableParty.name||invoiceParty.name),project=financialAuditText(receivable.project||receivable.projectId||invoice.project||invoice.projectId),projectName=target.projectName,date=target.date;
        arRebuilds.push({action:'REBUILD_LEGACY_BILLING_PARENT',receivableId:target.receivableId,invoiceId:target.invoiceId,confidence:'EXACT',proposedBilling:{id:billingId,number:billingNo,date,customer,customerName,project,projectName,amount:target.net,preTaxAmount:target.net,tax:target.tax,taxAmount:target.tax,grossTotal:target.gross,taxIncludedAmount:target.gross,retention:0,retentionAmount:0,total:target.gross,invoiceNo:target.invoiceNo,invoiceStatus:'invoiced',hasInvoice:true,sourceType:'legacy-ar-invoice-rebuild',receivableId:target.receivableId,lines:[],note:'歷史 Billing Parent 重建；來源為既有 Receivable + Invoice；未重建施工明細'},receivablePatch:{billingId,grossTotal:target.gross,taxIncludedAmount:target.gross,untaxedAmount:target.net,preTaxAmount:target.net,tax:target.tax,taxAmount:target.tax,retentionAmount:0,remainingRetention:0,status:'未收'},invoicePatch:{billingId,receivableId:target.receivableId},protected:{receivableFingerprint:financialRepairFingerprint(receivable),invoiceFingerprint:financialRepairFingerprint(invoice)}});
      }
    });
    const apTarget=targets.ap,payable=financialPhase2RepairUnique(state.payables||[],apTarget.existingPayableId,'AP_PAYABLE',blockers),inputInvoice=financialPhase2RepairUnique(state.invoices||[],apTarget.invoiceId,'AP_INVOICE',blockers),legacyPayment=financialPhase2RepairUnique(state.payments||[],apTarget.legacyPaymentId,'AP_LEGACY_PAYMENT',blockers),expectedUsageIdSet=new Set(apTarget.materialUsageIds),targetMaterialRows=(state.materialUsages||[]).filter((row)=>financialAuditText(row.payableId)===apTarget.missingPayableId),materialUsageIdSet=new Set(targetMaterialRows.map((row)=>financialAuditText(row.id))),existingPayableUsageIdSet=payable?financialPhase2RepairSet([payable.usageIds||[],payable.sourceId||'']):new Set(),materialTotal=targetMaterialRows.reduce((sum,row)=>sum+num(row.amount??num(row.quantity??row.qty)*num(row.unitPrice??row.price)),0),invoiceValues=inputInvoice?financialPhase2RepairInputValues(inputInvoice):{net:0,tax:0,gross:0},payableAudit=baseAudit.payables.find((row)=>row.id===apTarget.existingPayableId),vendorName=payable?financialPhase2Party(payable,'AP').name:'',materialVendors=new Set(targetMaterialRows.map((row)=>normalizedMasterLabel(financialPhase2Party(row,'AP').name)).filter(Boolean)),apGates={targetUsageSet:financialPhase2RepairSetEqual(materialUsageIdSet,expectedUsageIdSet),payableUsageSet:financialPhase2RepairSetEqual(existingPayableUsageIdSet,expectedUsageIdSet),sourceType:financialAuditText(payable?.sourceType)==='material-merged',payableAmount:financialAuditMoneyEqual(payable?.amount,apTarget.net)&&financialAuditMoneyEqual(materialTotal,apTarget.net),vendor:normalizedMasterLabel(vendorName)===normalizedMasterLabel(apTarget.vendorName)&&materialVendors.size===1&&materialVendors.has(normalizedMasterLabel(apTarget.vendorName)),invoiceIdentity:financialAuditText(inputInvoice?.invoiceNumber||inputInvoice?.invoiceNo||inputInvoice?.number)===apTarget.invoiceNo,invoiceAmounts:financialAuditMoneyEqual(invoiceValues.net,apTarget.net)&&financialAuditMoneyEqual(invoiceValues.tax,apTarget.tax)&&financialAuditMoneyEqual(invoiceValues.gross,apTarget.gross),auditNetSemantics:payableAudit?.invoiceMismatch===false&&payableAudit?.invoiceAmountChecks?.some((row)=>row.invoiceId===apTarget.invoiceId&&row.netMatch&&row.explicitGrossMatch)};
    Object.entries(apGates).filter(([,passed])=>!passed).forEach(([gate])=>block(`AP_${gate.toUpperCase()}`,`健宏材料 bundle 的 ${gate} Gate 未通過。`));
    const legacyPaymentBankRows=legacyPayment?(state.bankTransactions||[]).filter((row)=>financialAuditText(row.id)===financialAuditText(legacyPayment.bankTransactionId)||[row.sourceId,row.paymentId].map(financialAuditText).includes(apTarget.legacyPaymentId)):[],existingPayablePayments=(state.payments||[]).filter((row)=>financialAuditText(row.payableId)===apTarget.existingPayableId&&financialAuditText(row.id)!==apTarget.legacyPaymentId);
    let legacyPaymentDisposition={classification:'AMBIGUOUS',paymentId:apTarget.legacyPaymentId,existingPaymentIds:existingPayablePayments.map((row)=>financialAuditText(row.id)),reason:'無法唯一判定 orphan legacy payment 的 duplicate／relink 語意。'};
    const legacyPaymentFacts=Boolean(legacyPayment&&financialAuditText(legacyPayment.payableId)===apTarget.missingPayableId&&financialAuditMoneyEqual(legacyPayment.amount,apTarget.net)&&financialPhase2Date(legacyPayment)===apTarget.date&&legacyPaymentBankRows.length===0);
    if(legacyPaymentFacts&&existingPayablePayments.length===1){const existing=existingPayablePayments[0],duplicateIdentity=financialAuditMoneyEqual(existing.amount,apTarget.net)&&financialPhase2Date(existing)===apTarget.date&&(existing.legacy===true||/^legacy-/u.test(financialAuditText(existing.id)));if(duplicateIdentity)legacyPaymentDisposition={classification:'DELETE_DUPLICATE_LEGACY_PAYMENT_CANDIDATE',paymentId:apTarget.legacyPaymentId,duplicateOf:financialAuditText(existing.id),reason:'Existing Payable 具有唯一同額、同日且具 legacy identity 的 Payment summary。'};}
    else if(legacyPaymentFacts&&existingPayablePayments.length===0)legacyPaymentDisposition={classification:'RELINK_LEGACY_PAYMENT_TO_EXISTING_PAYABLE_CANDIDATE',paymentId:apTarget.legacyPaymentId,targetPayableId:apTarget.existingPayableId,reason:'Existing Payable 無 Payment history，orphan legacy payment 與 AP structural bundle 唯一一致。'};
    if(legacyPaymentDisposition.classification==='AMBIGUOUS')block('AP_LEGACY_PAYMENT_AMBIGUOUS',legacyPaymentDisposition.reason);
    const apRepair={missingPayableId:apTarget.missingPayableId,existingPayableId:apTarget.existingPayableId,classification:Object.values(apGates).every(Boolean)?'RELINK_MATERIAL_BUNDLE_TO_EXISTING_PAYABLE':'BLOCK',materialUsageIds:[...materialUsageIdSet],existingPayableUsageIds:[...existingPayableUsageIdSet],materialTotal,materialPatches:targetMaterialRows.map((row)=>({id:financialAuditText(row.id),before:{payableId:financialAuditText(row.payableId)},patch:{payableId:apTarget.existingPayableId},protectedFingerprint:financialRepairFingerprint(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='payableId')))})),legacyPaymentDisposition,protectedPayableFingerprint:financialRepairFingerprint(payable),protectedInvoiceFingerprint:financialRepairFingerprint(inputInvoice)};
    const preservedLegacy=[...targets.verifiedReceivableIds.map((id)=>{const row=(state.receivables||[]).find((item)=>financialAuditText(item.id)===id);if(!row)block('VERIFIED_LEGACY_AR_MISSING',`Verified legacy Receivable ${id} 不存在。`);return {type:'receivable',id,fingerprint:financialRepairFingerprint(row)}}),...targets.verifiedInvoiceIds.map((id)=>{const row=(state.invoices||[]).find((item)=>financialAuditText(item.id)===id);if(!row)block('VERIFIED_LEGACY_INVOICE_MISSING',`Verified legacy Invoice ${id} 不存在。`);return {type:'invoice',id,fingerprint:financialRepairFingerprint(row)}})];
    const stalePayments=targets.stalePaymentIds.map((id)=>{const row=(state.payments||[]).find((item)=>financialAuditText(item.id)===id);if(!row)block('STALE_PAYMENT_MISSING',`Review-only legacy Payment ${id} 不存在。`);return {type:'payment',id,action:'REVIEW_ONLY',fingerprint:financialRepairFingerprint(row)}}),fuhuaFinding=phase2Audit.receivableFindings.find((row)=>row.id===targets.fuhua.receivableId),fuhuaCandidates=fuhuaFinding?.evidence?.dailyCandidates?.filter((row)=>targets.fuhua.dailyLogIds.includes(row.id)&&row.evidence?.confidence==='STRONG')||[];
    if(fuhuaFinding?.classification!=='AMBIGUOUS'||fuhuaCandidates.length!==2)block('FUHUA_AMBIGUOUS_FACTS_CHANGED','富華應收不再是兩個 STRONG Daily candidates 的 AMBIGUOUS 狀態。');
    const manualReview=[{type:'receivable',id:targets.fuhua.receivableId,action:'MANUAL_REVIEW_ONLY',classification:fuhuaFinding?.classification||'MISSING',dailyCandidateIds:fuhuaCandidates.map((row)=>row.id),fingerprint:financialRepairFingerprint((state.receivables||[]).find((row)=>financialAuditText(row.id)===targets.fuhua.receivableId))},...stalePayments];warn('EXCLUDED_MANUAL_REVIEW','富華 AMBIGUOUS 應收與四筆 stale legacy payments 明確排除於 Repair scope。');
    const arTargetIds=new Set(targets.ar.map((row)=>row.receivableId)),invoiceTargetIds=new Set(targets.ar.map((row)=>row.invoiceId)),materialTargetIds=expectedUsageIdSet,paymentTargetIds=new Set([apTarget.legacyPaymentId]),protectedFingerprints={fullState:beforeFingerprint,allExistingBillings:{count:(state.billings||[]).length,fingerprint:financialRepairFingerprint(state.billings||[])},nonTargetReceivables:financialRepairFingerprint((state.receivables||[]).filter((row)=>!arTargetIds.has(financialAuditText(row.id)))),B643124:financialRepairFingerprint({billing:(state.billings||[]).find((row)=>financialAuditText(row.number)==='B643124'),receivable:(state.receivables||[]).find((row)=>financialAuditText(row.sourceNo)==='B643124')}),verifiedLegacyReceivables:financialRepairFingerprint((state.receivables||[]).filter((row)=>targets.verifiedReceivableIds.includes(financialAuditText(row.id)))),verifiedLegacyInvoices:financialRepairFingerprint((state.invoices||[]).filter((row)=>targets.verifiedInvoiceIds.includes(financialAuditText(row.id)))),banks:financialRepairFingerprint(state.banks||[]),bankTransactions:financialRepairFingerprint(state.bankTransactions||[]),receipts:financialRepairFingerprint(state.receipts||[]),retentionReceipts:financialRepairFingerprint(state.retentionReceipts||[]),allExistingPayables:financialRepairFingerprint(state.payables||[]),targetPayable:financialRepairFingerprint(payable),otherMismatchPayable:financialRepairFingerprint((state.payables||[]).find((row)=>financialAuditText(row.id)==='mtcnpjx1q7pdr0')),nonTargetPayments:financialRepairFingerprint((state.payments||[]).filter((row)=>!paymentTargetIds.has(financialAuditText(row.id)))),staleLegacyPayments:financialRepairFingerprint((state.payments||[]).filter((row)=>targets.stalePaymentIds.includes(financialAuditText(row.id)))),nonTargetInvoices:financialRepairFingerprint((state.invoices||[]).filter((row)=>!invoiceTargetIds.has(financialAuditText(row.id)))),nonTargetMaterialUsages:financialRepairFingerprint((state.materialUsages||[]).filter((row)=>!materialTargetIds.has(financialAuditText(row.id)))),dailyLogs:financialRepairFingerprint(state.dailyLogs||[]),fuhuaDailyCandidates:financialRepairFingerprint((state.dailyLogs||[]).filter((row)=>targets.fuhua.dailyLogIds.includes(financialAuditText(row.id)))),payroll:financialRepairFingerprint(state.payroll||[]),attendance:financialRepairFingerprint(state.attendance||[]),commissions:financialRepairFingerprint(state.commissions||[])};
    if((state.billings||[]).length!==8)block('BILLING_BASELINE_CHANGED',`Production Billing baseline 必須為 8，實際 ${(state.billings||[]).length}。`);if(arRebuilds.length!==4)block('AR_REBUILD_SCOPE_CHANGED',`AR rebuild proposals 必須精確為 4，實際 ${arRebuilds.length}。`);if(apRepair.classification!=='RELINK_MATERIAL_BUNDLE_TO_EXISTING_PAYABLE')block('AP_REPAIR_NOT_EXACT','AP structural Set 尚未精確對應既有 Payable。');
    const expectedPostRepairSummary={billingCountBefore:baseAudit.summary.billingCount,billingCountAfter:baseAudit.summary.billingCount+4,orphanReceivableCountBefore:baseAudit.summary.orphanReceivableCount,orphanReceivableCountAfter:baseAudit.summary.orphanReceivableCount-4,orphanInvoiceCountBefore:baseAudit.summary.orphanInvoiceCount,orphanInvoiceCountAfter:baseAudit.summary.orphanInvoiceCount-4,materialOrphanUsageCountBefore:phase2Audit.summary.phase2MaterialUsageCount,materialOrphanUsageCountAfter:phase2Audit.summary.phase2MaterialUsageCount-targets.ap.materialUsageIds.length,payableInvoiceMismatchCountBefore:baseAudit.payables.filter((row)=>row.invoiceMismatch).length,payableInvoiceMismatchCountAfter:0,payableCountBefore:state.payables.length,payableCountAfter:state.payables.length,targetPayableId:apTarget.existingPayableId,targetPayableAmount:apTarget.net,verifiedLegacyReceivableCount:targets.verifiedReceivableIds.length,verifiedLegacyInvoiceCount:targets.verifiedInvoiceIds.length,fuhuaManualReviewPreserved:true};
    if(expectedPostRepairSummary.payableInvoiceMismatchCountBefore!==0)block('AP_NET_GROSS_AUDIT_STILL_MISMATCH','修正後 PAYABLE_INVOICE_MISMATCH 應為 0。');if(financialRepairFingerprint(state)!==beforeFingerprint)throw new Error('financialIntegrityPhase2RepairPreview 必須是純 READ-ONLY，state fingerprint 發生變動。');
    return {allowed:blockers.length===0,previewOnly:true,executeAvailable:true,blockers,warnings,arRebuilds,apRepair,preservedLegacy,manualReview,protectedFingerprints,expectedPostRepairSummary,audits:{financialIntegrityAuditVersion:baseAudit.auditVersion,financialIntegrityPhase2AuditVersion:phase2Audit.auditVersion}};
  }
  async function financialIntegrityPhase2RepairPreview() {await load();const before=financialRepairFingerprint(state),preview=financialIntegrityPhase2RepairPlan();if(financialRepairFingerprint(state)!==before)throw new Error('financialIntegrityPhase2RepairPreview 不得修改 Business state。');return preview}
  const FINANCIAL_PHASE2_EXECUTE_EXPECTED_SUMMARY=Object.freeze({billingCount:12,exactBillingReceivablePairs:12,orphanBillingCount:0,ambiguousBillingCount:0,orphanReceivableCount:4,billingAmountMismatchCount:0,orphanInvoiceCount:2,dailyBillingOrphanCount:0,orphanPayrollCount:0,stalePayrollCount:0,orphanPayableCount:0,paymentIntegrityIssueCount:4,orphanBankTransactionCount:0,duplicateIdentityCount:0,blockingIssueCount:9,warningIssueCount:7});
  const FINANCIAL_PHASE2_EXECUTE_EXPECTED_PHASE2=Object.freeze({phase2OrphanReceivableCount:4,phase2OrphanInvoiceCount:2,phase2OrphanPaymentCount:4,phase2MissingPayableBundleCount:0,phase2MaterialUsageCount:0,payableInvoiceMismatchCount:0,preservedLegacyCount:5,rebuildCandidateCount:0,relinkCandidateCount:0,staleCandidateCount:4,manualReviewCount:5,crossBundleCount:2});
  const financialPhase2ExecuteOmit=(row,keys)=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!keys.includes(key)));
  const financialPhase2ExecuteRows=(source,key)=>Array.isArray(source?.[key])?source[key]:[];
  const financialPhase2ExecuteOne=(rows,id,label)=>{
    const matches=(rows||[]).filter((row)=>financialAuditText(row.id||row.invoiceId)===id);
    if(matches.length!==1)throw new Error(`${label} ${id} 必須精確存在 1 筆，實際 ${matches.length} 筆。`);
    return matches[0];
  };
  function financialPhase2ExecuteScope(preview) {
    const targets=FINANCIAL_PHASE2_REPAIR_TARGETS;
    if(preview?.allowed!==true)throw new Error(`Phase 2 Repair Preview 未通過：${(preview?.blockers||[]).map((row)=>row.message||row.code).join(' ')}`);
    if(!Array.isArray(preview.blockers)||preview.blockers.length)throw new Error('Phase 2 Repair Preview 仍有 blocker。');
    if(!Array.isArray(preview.arRebuilds)||preview.arRebuilds.length!==4)throw new Error('Phase 2 AR rebuild scope 必須精確為 4 組。');
    const arRebuilds=targets.ar.map((target)=>{
      const matches=preview.arRebuilds.filter((row)=>row.action==='REBUILD_LEGACY_BILLING_PARENT'&&row.receivableId===target.receivableId&&row.invoiceId===target.invoiceId),row=matches[0],billingId=`legacy-billing-${target.receivableId}`,billingNo=`LEGACY-${target.invoiceNo}`;
      if(matches.length!==1||row.confidence!=='EXACT')throw new Error(`Phase 2 AR scope ${target.receivableId} / ${target.invoiceId} 不符合 EXACT。`);
      const billing=row.proposedBilling||{},receivablePatch=row.receivablePatch||{},invoicePatch=row.invoicePatch||{};
      const billingFacts={id:billing.id,number:billing.number,amount:num(billing.amount),preTaxAmount:num(billing.preTaxAmount),tax:num(billing.tax),taxAmount:num(billing.taxAmount),grossTotal:num(billing.grossTotal),taxIncludedAmount:num(billing.taxIncludedAmount),retention:num(billing.retention),retentionAmount:num(billing.retentionAmount),total:num(billing.total),invoiceNo:billing.invoiceNo,invoiceStatus:billing.invoiceStatus,hasInvoice:billing.hasInvoice,sourceType:billing.sourceType,receivableId:billing.receivableId,lines:billing.lines};
      const expectedBillingFacts={id:billingId,number:billingNo,amount:target.net,preTaxAmount:target.net,tax:target.tax,taxAmount:target.tax,grossTotal:target.gross,taxIncludedAmount:target.gross,retention:0,retentionAmount:0,total:target.gross,invoiceNo:target.invoiceNo,invoiceStatus:'invoiced',hasInvoice:true,sourceType:'legacy-ar-invoice-rebuild',receivableId:target.receivableId,lines:[]};
      const expectedReceivablePatch={billingId,grossTotal:target.gross,taxIncludedAmount:target.gross,untaxedAmount:target.net,preTaxAmount:target.net,tax:target.tax,taxAmount:target.tax,retentionAmount:0,remainingRetention:0,status:'未收'},expectedInvoicePatch={billingId,receivableId:target.receivableId};
      if(!globalFinancialRepairExactObject(billingFacts,expectedBillingFacts)||!globalFinancialRepairExactObject(receivablePatch,expectedReceivablePatch)||!globalFinancialRepairExactObject(invoicePatch,expectedInvoicePatch))throw new Error(`Phase 2 AR ${target.receivableId} 的 Billing / AR / Invoice patch 已偏離核准範圍。`);
      return row;
    });
    const ap=preview.apRepair,disposition=ap?.legacyPaymentDisposition;
    if(ap?.classification!=='RELINK_MATERIAL_BUNDLE_TO_EXISTING_PAYABLE'||ap.existingPayableId!==targets.ap.existingPayableId||ap.missingPayableId!==targets.ap.missingPayableId)throw new Error('Phase 2 AP action 必須精確為 relink 至既有 Payable。');
    if(!Array.isArray(ap.materialPatches)||ap.materialPatches.length!==21||!financialPhase2RepairSetEqual(new Set(ap.materialPatches.map((row)=>row.id)),new Set(targets.ap.materialUsageIds)))throw new Error('Phase 2 Material patch scope 必須精確為 21 筆。');
    ap.materialPatches.forEach((row)=>{if(!globalFinancialRepairExactObject(row.before,{payableId:targets.ap.missingPayableId})||!globalFinancialRepairExactObject(row.patch,{payableId:targets.ap.existingPayableId}))throw new Error(`Material ${row.id} patch 已偏離核准範圍。`)});
    if(disposition?.classification!=='DELETE_DUPLICATE_LEGACY_PAYMENT_CANDIDATE'||disposition.paymentId!==targets.ap.legacyPaymentId||disposition.duplicateOf!=='legacy-msypsa7zelvm1l')throw new Error('Phase 2 duplicate legacy Payment disposition 不符合核准內容。');
    return {arRebuilds,apRepair:ap};
  }
  function financialPhase2ExecuteTargetGate(preview,scope) {
    const targets=FINANCIAL_PHASE2_REPAIR_TARGETS,text=financialAuditText;
    if(preview.protectedFingerprints?.fullState!==financialRepairFingerprint(state))throw new Error('Phase 2 Preview fullState fingerprint 已失效。');
    const freshPlan=financialIntegrityPhase2RepairPlan();
    if(financialRepairFingerprint(freshPlan.protectedFingerprints)!==financialRepairFingerprint(preview.protectedFingerprints))throw new Error('Phase 2 protectedFingerprints 已改變。');
    const arTargets=scope.arRebuilds.map((repair)=>{
      if((state.billings||[]).some((row)=>text(row.id)===repair.proposedBilling.id||text(row.number)===repair.proposedBilling.number))throw new Error(`Legacy Billing ${repair.proposedBilling.id} / ${repair.proposedBilling.number} 已存在。`);
      const receivable=financialPhase2ExecuteOne(state.receivables,repair.receivableId,'Receivable'),invoice=financialPhase2ExecuteOne(state.invoices,repair.invoiceId,'Invoice');
      if(financialRepairFingerprint(receivable)!==repair.protected?.receivableFingerprint||financialRepairFingerprint(invoice)!==repair.protected?.invoiceFingerprint)throw new Error(`AR target ${repair.receivableId} / ${repair.invoiceId} fingerprint 已改變。`);
      if(!financialAuditMoneyEqual(receivable.received,0)||!financialAuditMoneyEqual(receivable.legacyReceived,0))throw new Error(`AR target ${repair.receivableId} 已出現收款，不允許重建。`);
      return {repair,receivable,invoice};
    });
    const apTarget=targets.ap,payable=financialPhase2ExecuteOne(state.payables,apTarget.existingPayableId,'Payable'),inputInvoice=financialPhase2ExecuteOne(state.invoices,apTarget.invoiceId,'Input Invoice'),orphanPayment=financialPhase2ExecuteOne(state.payments,apTarget.legacyPaymentId,'Orphan legacy Payment'),preservedPayment=financialPhase2ExecuteOne(state.payments,'legacy-msypsa7zelvm1l','Preserved legacy Payment');
    if(financialRepairFingerprint(payable)!==scope.apRepair.protectedPayableFingerprint||financialRepairFingerprint(inputInvoice)!==scope.apRepair.protectedInvoiceFingerprint)throw new Error('Target Payable 或 Input Invoice fingerprint 已改變。');
    if(!(text(payable.sourceType)==='material-merged'&&financialAuditMoneyEqual(payable.amount,61550)&&financialAuditMoneyEqual(payable.paid,61550)&&text(payable.status)==='已付清'))throw new Error('Target Payable amount / paid / status / sourceType 已改變。');
    const invoiceValues=financialPhase2RepairInputValues(inputInvoice);
    if(!(text(inputInvoice.invoiceNumber||inputInvoice.invoiceNo||inputInvoice.number)===apTarget.invoiceNo&&financialAuditMoneyEqual(invoiceValues.net,apTarget.net)&&financialAuditMoneyEqual(invoiceValues.tax,apTarget.tax)&&financialAuditMoneyEqual(invoiceValues.gross,apTarget.gross)))throw new Error('Target Input Invoice identity 或 net/tax/gross 已改變。');
    const materialRows=scope.apRepair.materialPatches.map((patch)=>{
      const row=financialPhase2ExecuteOne(state.materialUsages,patch.id,'Material Usage');
      if(text(row.payableId)!==apTarget.missingPayableId||financialRepairFingerprint(financialPhase2ExecuteOmit(row,['payableId']))!==patch.protectedFingerprint)throw new Error(`Material Usage ${patch.id} fingerprint 或 missing parent 已改變。`);
      return {patch,row};
    });
    const orphanBankRows=(state.bankTransactions||[]).filter((row)=>text(row.id)===text(orphanPayment.bankTransactionId)||[row.sourceId,row.paymentId].map(text).includes(apTarget.legacyPaymentId));
    const preservedMatches=(state.payments||[]).filter((row)=>text(row.id)==='legacy-msypsa7zelvm1l');
    if(!(text(orphanPayment.payableId)===apTarget.missingPayableId&&financialAuditMoneyEqual(orphanPayment.amount,apTarget.net)&&financialPhase2Date(orphanPayment)===apTarget.date&&orphanBankRows.length===0))throw new Error('Duplicate orphan legacy Payment facts 已改變。');
    if(!(preservedMatches.length===1&&text(preservedPayment.payableId)===apTarget.existingPayableId&&financialAuditMoneyEqual(preservedPayment.amount,apTarget.net)&&financialPhase2Date(preservedPayment)===apTarget.date&&(preservedPayment.legacy===true||/^legacy-/u.test(text(preservedPayment.id)))))throw new Error('Preserved legacy Payment facts 已改變。');
    return {arTargets,payable,inputInvoice,materialRows,orphanPayment,preservedPayment};
  }
  function financialPhase2ExecuteNormalizedState(source) {
    const targets=FINANCIAL_PHASE2_REPAIR_TARGETS,arIds=new Set(targets.ar.map((row)=>row.receivableId)),invoiceIds=new Set(targets.ar.map((row)=>row.invoiceId)),billingIds=new Set(targets.ar.map((row)=>`legacy-billing-${row.receivableId}`)),materialIds=new Set(targets.ap.materialUsageIds),result={};
    Object.keys(source||{}).sort().forEach((key)=>{
      if(key==='meta'||key==='audit')return;
      const value=source[key];
      if(key==='billings')result[key]=financialPhase2ExecuteRows(source,key).filter((row)=>!billingIds.has(financialAuditText(row.id)));
      else if(key==='receivables')result[key]=financialPhase2ExecuteRows(source,key).map((row)=>arIds.has(financialAuditText(row.id))?financialPhase2ExecuteOmit(row,['billingId','grossTotal','taxIncludedAmount','untaxedAmount','preTaxAmount','tax','taxAmount','retentionAmount','remainingRetention','status']):row);
      else if(key==='invoices')result[key]=financialPhase2ExecuteRows(source,key).map((row)=>invoiceIds.has(financialAuditText(row.id))?financialPhase2ExecuteOmit(row,['billingId','receivableId']):row);
      else if(key==='materialUsages')result[key]=financialPhase2ExecuteRows(source,key).map((row)=>materialIds.has(financialAuditText(row.id))?financialPhase2ExecuteOmit(row,['payableId']):row);
      else if(key==='payments')result[key]=financialPhase2ExecuteRows(source,key).filter((row)=>financialAuditText(row.id)!==targets.ap.legacyPaymentId);
      else result[key]=value;
    });
    return financialRepairFingerprint(result);
  }
  function financialPhase2ExecuteProtection(snapshot,preview,targets) {
    return {snapshotFingerprint:financialRepairFingerprint(snapshot),counts:globalFinancialRepairCounts(snapshot),metaFingerprint:financialRepairFingerprint(snapshot.meta),auditFingerprint:financialRepairFingerprint(snapshot.audit),auditBaselineFingerprint:financialRepairFingerprint({global:financialIntegrityAuditReport().summary,phase2:financialIntegrityPhase2AuditReport().summary}),normalizedStateFingerprint:financialPhase2ExecuteNormalizedState(snapshot),existingBillingFingerprints:new Map((snapshot.billings||[]).map((row)=>[financialAuditText(row.id),financialRepairFingerprint(row)])),targetReceivables:targets.arTargets.map(({repair,receivable})=>({id:repair.receivableId,immutable:financialRepairFingerprint(financialPhase2ExecuteOmit(receivable,Object.keys(repair.receivablePatch))),patch:financialPhase2Clone(repair.receivablePatch)})),targetInvoices:targets.arTargets.map(({repair,invoice})=>({id:repair.invoiceId,immutable:financialRepairFingerprint(financialPhase2ExecuteOmit(invoice,Object.keys(repair.invoicePatch))),patch:financialPhase2Clone(repair.invoicePatch)})),targetMaterials:targets.materialRows.map(({patch,row})=>({id:patch.id,immutable:financialRepairFingerprint(financialPhase2ExecuteOmit(row,['payableId']))})),payableFingerprint:financialRepairFingerprint(targets.payable),inputInvoiceFingerprint:financialRepairFingerprint(targets.inputInvoice),preservedPaymentFingerprint:financialRepairFingerprint(targets.preservedPayment),previewFingerprints:financialPhase2Clone(preview.protectedFingerprints)};
  }
  function financialPhase2ExecuteAssertState(source,preview,protection,stage,afterPersist=false) {
    const target=FINANCIAL_PHASE2_REPAIR_TARGETS,text=financialAuditText;
    preview.arRebuilds.forEach((repair)=>{
      const billing=financialPhase2ExecuteOne(source.billings,repair.proposedBilling.id,'Created Legacy Billing'),receivable=financialPhase2ExecuteOne(source.receivables,repair.receivableId,'Patched Receivable'),invoice=financialPhase2ExecuteOne(source.invoices,repair.invoiceId,'Patched Invoice'),receivableProtection=protection.targetReceivables.find((row)=>row.id===repair.receivableId),invoiceProtection=protection.targetInvoices.find((row)=>row.id===repair.invoiceId);
      if(financialRepairFingerprint(billing)!==financialRepairFingerprint(repair.proposedBilling))throw new Error(`${stage}：Legacy Billing ${billing.id} 不是 Preview 精確 proposedBilling。`);
      Object.entries(receivableProtection.patch).forEach(([key,value])=>{if(financialRepairFingerprint(receivable[key])!==financialRepairFingerprint(value))throw new Error(`${stage}：Receivable ${receivable.id}.${key} 不符合 Preview patch。`)});
      if(financialRepairFingerprint(financialPhase2ExecuteOmit(receivable,Object.keys(receivableProtection.patch)))!==receivableProtection.immutable)throw new Error(`${stage}：Receivable ${receivable.id} 非核准欄位發生變動。`);
      Object.entries(invoiceProtection.patch).forEach(([key,value])=>{if(financialRepairFingerprint(invoice[key])!==financialRepairFingerprint(value))throw new Error(`${stage}：Invoice ${invoice.id}.${key} 不符合 Preview patch。`)});
      if(financialRepairFingerprint(financialPhase2ExecuteOmit(invoice,Object.keys(invoiceProtection.patch)))!==invoiceProtection.immutable)throw new Error(`${stage}：Invoice ${invoice.id} 非核准欄位發生變動。`);
    });
    protection.existingBillingFingerprints.forEach((fingerprint,id)=>{if(financialRepairFingerprint(financialPhase2ExecuteOne(source.billings,id,'Existing Billing'))!==fingerprint)throw new Error(`${stage}：既有 Billing ${id} 發生變動。`)});
    protection.targetMaterials.forEach((item)=>{const row=financialPhase2ExecuteOne(source.materialUsages,item.id,'Relinked Material Usage');if(text(row.payableId)!==target.ap.existingPayableId||financialRepairFingerprint(financialPhase2ExecuteOmit(row,['payableId']))!==item.immutable)throw new Error(`${stage}：Material Usage ${item.id} 非 payableId 欄位發生變動。`)});
    if((source.payments||[]).some((row)=>text(row.id)===target.ap.legacyPaymentId))throw new Error(`${stage}：duplicate legacy Payment 尚未移除。`);
    if(financialRepairFingerprint(financialPhase2ExecuteOne(source.payments,'legacy-msypsa7zelvm1l','Preserved legacy Payment'))!==protection.preservedPaymentFingerprint)throw new Error(`${stage}：保留的 legacy Payment 發生變動。`);
    if(financialRepairFingerprint(financialPhase2ExecuteOne(source.payables,target.ap.existingPayableId,'Target Payable'))!==protection.payableFingerprint||financialRepairFingerprint(financialPhase2ExecuteOne(source.invoices,target.ap.invoiceId,'Input Invoice'))!==protection.inputInvoiceFingerprint)throw new Error(`${stage}：Target Payable 或 Input Invoice 發生變動。`);
    if(financialPhase2ExecuteNormalizedState(source)!==protection.normalizedStateFingerprint)throw new Error(`${stage}：非目標 Business state fingerprint 發生變動。`);
    const counts=globalFinancialRepairCounts(source);
    Object.keys(protection.counts).forEach((key)=>{let expected=protection.counts[key];if(key==='billings')expected+=4;else if(key==='payments')expected-=1;else if(key==='audit'&&afterPersist)expected=Math.min(300,expected+1);if(counts[key]!==expected)throw new Error(`${stage}：${key} collection count 不符合精確 scope。`)});
  }
  function financialPhase2ExecuteAssertGlobalAudit(report,stage) {
    Object.entries(FINANCIAL_PHASE2_EXECUTE_EXPECTED_SUMMARY).forEach(([key,value])=>{if(report?.summary?.[key]!==value)throw new Error(`${stage}：Global Audit ${key} 預期 ${value}，實際 ${report?.summary?.[key]}。`)});
    if((report.payables||[]).filter((row)=>row.invoiceMismatch).length!==0||(report.materialPayableLinks||[]).filter((row)=>row.orphanMaterialPayable).length!==0)throw new Error(`${stage}：AP invoice mismatch 或 material orphan 尚未歸零。`);
    const expectedIds=new Set(FINANCIAL_PHASE2_REPAIR_TARGETS.ar.map((row)=>`legacy-billing-${row.receivableId}`)),sources=(report.billingSources||[]).filter((row)=>expectedIds.has(row.billingId));
    if(sources.length!==4||sources.some((row)=>row.sourceType!=='legacy-ar-invoice-rebuild'||row.modern!==false||row.classification!=='LEGACY_SOURCE'||row.sourceOrphan!==false))throw new Error(`${stage}：legacy-ar-invoice-rebuild 未正確分類為 LEGACY_SOURCE。`);
    if((report.issues||[]).some((row)=>expectedIds.has(row.id)&&['UNKNOWN_BILLING_SOURCE_TYPE','SOURCE_ORPHAN'].includes(row.code)))throw new Error(`${stage}：Legacy Billing 產生 UNKNOWN/SOURCE_ORPHAN。`);
  }
  function financialPhase2ExecuteAssertPhase2Audit(report,stage) {
    Object.entries(FINANCIAL_PHASE2_EXECUTE_EXPECTED_PHASE2).forEach(([key,value])=>{if(report?.summary?.[key]!==value)throw new Error(`${stage}：Phase 2 Audit ${key} 預期 ${value}，實際 ${report?.summary?.[key]}。`)});
    if(report.phase2BlockingCount!==5)throw new Error(`${stage}：Phase 2 blocking count 預期 5，實際 ${report.phase2BlockingCount}。`);
  }
  async function financialIntegrityPhase2RepairExecute(confirmation={}) {
    await load();
    const preview=await financialIntegrityPhase2RepairPreview(),reason=String(confirmation?.reason||'').trim();
    if(confirmation?.confirmed!==true)throw new Error('必須明確確認執行 GLOBAL FINANCIAL PHASE 2 REPAIR。');
    if(!reason)throw new Error('請輸入 GLOBAL FINANCIAL PHASE 2 REPAIR 原因。');
    const scope=financialPhase2ExecuteScope(preview),targets=financialPhase2ExecuteTargetGate(preview,scope),snapshot=financialPhase2Clone(state),protection=financialPhase2ExecuteProtection(snapshot,preview,targets),persistAction=`GLOBAL FINANCIAL PHASE 2 REPAIR｜4 Legacy Billing + Material AP relink + duplicate legacy payment cleanup｜原因：${reason}`;
    const restore=async()=>{
      state=financialPhase2Clone(snapshot);
      if(!db)db=await openDB();
      if(!db)throw new Error('Phase 2 Repair rollback 無法取得 IndexedDB。');
      await dbSet(STATE_KEY,state);
      localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state));
      window.KuSheLegacyData?.refresh();
      const dbState=await dbGet(STATE_KEY),emergencyState=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null');
      if(financialRepairFingerprint(state)!==protection.snapshotFingerprint||financialRepairFingerprint(dbState)!==protection.snapshotFingerprint||financialRepairFingerprint(emergencyState)!==protection.snapshotFingerprint)throw new Error('Phase 2 Repair rollback 三層 fingerprint 驗證失敗。');
      return true;
    };
    try {
      targets.arTargets.forEach(({repair,receivable,invoice})=>{state.billings.push(financialPhase2Clone(repair.proposedBilling));Object.assign(receivable,financialPhase2Clone(repair.receivablePatch));Object.assign(invoice,financialPhase2Clone(repair.invoicePatch))});
      targets.materialRows.forEach(({patch,row})=>{row.payableId=patch.patch.payableId});
      state.payments=state.payments.filter((row)=>financialAuditText(row.id)!==FINANCIAL_PHASE2_REPAIR_TARGETS.ap.legacyPaymentId);
      financialPhase2ExecuteAssertState(state,preview,protection,'persist 前');
      if(financialRepairFingerprint(state.meta)!==protection.metaFingerprint||financialRepairFingerprint(state.audit)!==protection.auditFingerprint)throw new Error('persist 前：meta 或 audit 提前發生變動。');
      const prePersistAudit=financialIntegrityAuditReport(),prePersistPhase2Audit=financialIntegrityPhase2AuditReport();
      financialPhase2ExecuteAssertGlobalAudit(prePersistAudit,'persist 前');
      financialPhase2ExecuteAssertPhase2Audit(prePersistPhase2Audit,'persist 前');
      let persistCount=0;
      persistCount+=1;
      await persist(persistAction);
      if(persistCount!==1)throw new Error('Phase 2 Repair persist 次數不等於 1。');
      financialPhase2ExecuteAssertState(state,preview,protection,'persist 後 memory',true);
      if(!db)throw new Error('persist 後無法取得 IndexedDB。');
      const dbState=await dbGet(STATE_KEY),emergencyState=JSON.parse(localStorage.getItem(EMERGENCY_KEY)||'null'),persistedFingerprint=financialRepairFingerprint(state);
      financialPhase2ExecuteAssertState(dbState,preview,protection,'persist 後 IndexedDB',true);
      financialPhase2ExecuteAssertState(emergencyState,preview,protection,'persist 後 Emergency backup',true);
      if(financialRepairFingerprint(dbState)!==persistedFingerprint||financialRepairFingerprint(emergencyState)!==persistedFingerprint)throw new Error('Phase 2 Repair persist 後三層完整 state fingerprint 不一致。');
      const postRepairSummary=financialIntegrityAuditReport(),phase2PostRepairSummary=financialIntegrityPhase2AuditReport();
      financialPhase2ExecuteAssertGlobalAudit(postRepairSummary,'persist 後');
      financialPhase2ExecuteAssertPhase2Audit(phase2PostRepairSummary,'persist 後');
      return {repaired:true,singlePersist:true,reason,arRepair:{billingCreated:4,receivablesLinked:4,invoicesLinked:4},apRepair:{payableId:FINANCIAL_PHASE2_REPAIR_TARGETS.ap.existingPayableId,materialRelinked:21,duplicateLegacyPaymentDeleted:FINANCIAL_PHASE2_REPAIR_TARGETS.ap.legacyPaymentId,preservedLegacyPayment:'legacy-msypsa7zelvm1l'},protected:{fuhua:true,stalePayments:4,verifiedLegacyReceivables:3,verifiedLegacyInvoices:2,banksUnchanged:true},postRepairSummary:postRepairSummary.summary,phase2PostRepairSummary:phase2PostRepairSummary.summary};
    } catch(error) {
      try { await restore(); error.rollbackVerified=true; }
      catch(rollbackError) { error.rollbackVerified=false; error.rollbackError=rollbackError; }
      throw error;
    }
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
        target.details.push({sourceType:'daily-work',pricingType:'actual',quotationId:item.quotationId||'',quotationLineId:item.quotationLineId||'',date:first.date||'',employees,house:item.house||'',item:item.item||'',unit:item.unit||'式',price:num(item.price),inputPrice:num(item.inputPrice??item.price),qty:num(item.qty),subtotal:amount,grossSubtotal:num(item.subtotal)||amount,taxMode:item.taxMode||'未稅',note:first.note||'',workItemId:item.workItemId||'',sourceGroupKey:groupKey,sourceItemIndex:index,dailyLogIds:group.logs.map((log)=>log.id)});
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
      return {...line,house:String(line.house||'').trim(),item:quoteItem?.item||line.item,itemName:quoteItem?.item||line.item,unit:quoteItem?.unit||line.unit,qty,inputPrice,unitPrice:inputPrice,price:qty&&type==='actual'?untaxedSubtotal/qty:0,subtotal:gross,untaxedSubtotal,taxMode,pricingType:type,sourceType:quoteItem?'quotation':'manual',quotationId:quoteItem?.quotationId||'',quotationLineId:quoteItem?.quotationLineId||'',quoteId:quoteItem?.quotationId||'',quoteLineId:quoteItem?.quotationLineId||'',quotationNo:quoteItem?.quotationNo||'',lumpSumAmount:num(quoteItem?.lumpSumAmount),workItemId:line.workItemId||uid(),billable,billingStatus:billable?'未請款':'',billingId:''};
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
  function commissionBillingLink(row) {
    if(!row||typeof row!=='object')return {kind:'ambiguous',billing:null,evidence:'invalid-row'};
    const sourceType=String(row.sourceType||'').trim().toLocaleLowerCase('en-US');
    if(sourceType==='daily-log')return {kind:'daily-log',billing:null,evidence:'source-type'};
    const billingSourceTypes=new Set(['billing','billing-commission','billing_commission','legacy-billing','legacy_billing','billing-inline']),isBillingSource=billingSourceTypes.has(sourceType),billingId=String(row.billingId||'').trim(),sourceId=isBillingSource?String(row.sourceId||'').trim():'',directIds=[...new Set([billingId,sourceId].filter(Boolean))];
    if(directIds.length){
      const matches=state.billings.filter((billing)=>directIds.includes(String(billing.id)));
      if(directIds.length===1&&matches.length===1)return {kind:'linked',billing:matches[0],evidence:billingId?'billing-id':'source-id'};
      if(!matches.length)return {kind:'orphan-billing',billing:null,evidence:billingId?'missing-billing-id':'missing-source-id'};
      return {kind:'ambiguous',billing:null,evidence:'conflicting-billing-ids'};
    }
    const sourceNo=String(row.sourceNo||'').trim(),note=String(row.note||'').trim(),legacySignature=/^由請款單自動建立(?:$|｜(?:固定金額|比例分配)(?:$|｜))/u.test(note),hasBillingEvidence=isBillingSource||legacySignature;
    if(hasBillingEvidence&&sourceNo){
      const matches=state.billings.filter((billing)=>String(billing.number||'').trim()===sourceNo);
      if(matches.length===1)return {kind:'linked',billing:matches[0],evidence:isBillingSource?'billing-source-number':'legacy-note-number'};
      if(!matches.length)return {kind:'orphan-billing',billing:null,evidence:isBillingSource?'missing-billing-source-number':'missing-legacy-note-number'};
      return {kind:'ambiguous',billing:null,evidence:'duplicate-billing-number'};
    }
    if(hasBillingEvidence)return {kind:'ambiguous',billing:null,evidence:'billing-evidence-without-identity'};
    if(sourceType&&sourceType!=='manual')return {kind:'ambiguous',billing:null,evidence:'unknown-source-type'};
    if(sourceNo)return {kind:'ambiguous',billing:null,evidence:'unverified-source-number'};
    return {kind:'manual',billing:null,evidence:sourceType==='manual'?'source-type':'no-billing-evidence'};
  }
  async function saveCommission(values, id) {
    await load();
    const existing = id ? state.commissions.find((x) => x.id === id) : null;
    if (existing?.sourceType === 'daily-log') {
      if (payrollHistoryLock(existing.employee,existing.date).locked) throw new Error(PAID_COMMISSION_SOURCE_ERROR);
      throw new Error(DAILY_LOG_COMMISSION_ERROR);
    }
    if ([[existing?.employee,existing?.date],[values.employee,values.date]].some(([employeeId,date])=>employeeId&&payrollHistoryLock(employeeId,date).locked)) throw new Error(PAID_COMMISSION_SOURCE_ERROR);
    const selectedBilling=values.billing?state.billings.find((billing)=>String(billing.id)===String(values.billing)):null;
    if(values.billing&&!selectedBilling)throw new Error('找不到選擇的請款來源');
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
    if(selectedBilling)Object.assign(row,{sourceType:'billing',sourceId:selectedBilling.id,billingId:selectedBilling.id,sourceNo:selectedBilling.number||row.sourceNo||''});
    if (!existing) state.commissions.unshift(row);
    if (before?.employee) rebuildPayrollFor(monthOf(before.date), before.employee);
    rebuildPayrollFor(monthOf(row.date), row.employee);
    await persist(`${existing ? '修改' : '新增'}員工業績抽成`);
    return row;
  }
  async function deleteCommission(id, token) {
    await load();
    const row = state.commissions.find((x) => x.id === id);
    if (!row) return false;
    const source=commissionBillingLink(row);
    if (payrollHistoryLock(row.employee,row.date).locked) throw new Error(source.kind==='orphan-billing'?PAID_ORPHAN_COMMISSION_ERROR:PAID_COMMISSION_SOURCE_ERROR);
    if (row.sourceType === 'daily-log') throw new Error(DAILY_LOG_COMMISSION_ERROR);
    state.commissions = state.commissions.filter((x) => x.id !== id);
    rebuildPayrollFor(monthOf(row.date), row.employee);
    if(token!==accountingDeleteToken)await persist('刪除員工業績抽成');
    return true;
  }
  function nextBillingNumber(date) {
    const compact = String(date || businessDate()).replaceAll('-','');
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
    const number=String(row.invoiceNumber??row.number??'').trim(),status=invoiceStatus(row.status,number),date=status==='pending'?'':row.invoiceDate||row.date||billing?.date||payable?.date||'',net=num(row.netAmount??row.amount),tax=num(row.taxAmount??row.tax),gross=num(row.grossAmount??row.total)||(net+tax);
    return {...row,id:row.id||row.invoiceId,invoiceId:row.invoiceId||row.id,invoiceType:type,invoiceNumber:number,invoiceDate:date,customerId:row.customerId||row.customer||billing?.customer||'',vendorId:row.vendorId||row.vendor||payable?.vendor||'',projectId:row.projectId||row.project||billing?.project||payable?.project||'',sourceType:type==='input'?(payable?'payable':'legacy_invoice'):(row.sourceType||(row.billingId?'billing':'legacy_invoice')),sourceId:type==='input'?(payable?.id||''):(row.sourceId||row.billingId||row.payableId||''),taxMode:row.taxMode||billing?.taxMode||'未稅',netAmount:net,taxAmount:tax,grossAmount:gross,status,party:row.party||billing?.customerName||payable?.vendorName||'',projectName:row.projectName||billing?.projectName||payable?.projectName||'',sourceNo:row.sourceNo||billing?.number||payable?.payableNo||''};
  }
  function invoiceRows() {
    const rows=state.invoices.map(normalizedInvoice),keys=new Set(rows.filter((row)=>row.sourceId).map((row)=>`${row.sourceType}:${row.sourceId}`));
    state.billings.forEach((billing)=>{if(billingInvoiceStatus(billing)==='no_invoice')return;const key=`billing:${billing.id}`;if(keys.has(key))return;rows.push(normalizedInvoice({id:`pending-${billing.id}`,invoiceType:'output',invoiceNumber:billing.invoiceNo||'',invoiceDate:billing.invoiceDate||billing.date,customerId:billing.customer,projectId:billing.project,party:billing.customerName,projectName:billing.projectName,sourceType:'billing',sourceId:billing.id,billingId:billing.id,sourceNo:billing.number,taxMode:billing.taxMode,netAmount:billing.preTaxAmount??billing.amount,taxAmount:billing.taxAmount??billing.tax,grossAmount:billing.taxIncludedAmount??billing.grossTotal,status:billingInvoiceStatus(billing)==='invoiced'?'issued':'pending',note:billing.note||'',virtual:true}));keys.add(key)});
    state.payables.filter((payable)=>!/salary|payroll/i.test(String(payable.sourceType||''))).forEach((payable)=>{const key=`payable:${payable.id}`;if(keys.has(key))return;const amounts=invoiceAmounts('未稅',payable.amount);rows.push(normalizedInvoice({id:`pending-${payable.id}`,invoiceType:'input',invoiceDate:businessDate(),vendorId:payable.vendor,projectId:payable.project,party:payable.vendorName,projectName:payable.projectName,sourceType:'payable',sourceId:payable.id,payableId:payable.id,sourceNo:payable.payableNo||payable.sourceNo,taxMode:amounts.taxMode,...amounts,status:'pending',note:payable.note||'',virtual:true}));keys.add(key)});
    return rows;
  }
  async function saveInvoice(values,id='') {
    await load();const now=new Date().toISOString(),type=values.invoiceType==='input'?'input':'output',status=invoiceStatus(values.status,values.invoiceNumber),number=String(values.invoiceNumber||'').trim();
    if(status==='issued'&&!number)throw new Error('已開票狀態必須輸入發票號碼');
    if(type==='output'){
      const billing=state.billings.find((row)=>String(row.id)===String(values.sourceId||values.billingId));if(!billing)throw new Error('找不到來源請款單');
      billing.invoiceStatus=status==='issued'?'invoiced':'invoice_pending';billing.hasInvoice=true;billing.invoiceNo=status==='issued'?number:'';billing.invoiceDate=values.invoiceDate||billing.date;billing.updatedAt=now;
      const receivable=state.receivables.find((row)=>row.id===billing.receivableId||row.billingId===billing.id);if(receivable){receivable.invoiceNo=billing.invoiceNo;receivable.invoiceStatus=billing.invoiceStatus;receivable.updatedAt=now}
      const invoice=syncBillingInvoiceRecord(billing,now,{invoiceNumber:number,invoiceDate:values.invoiceDate||billing.date,status,note:values.note});if(status==='void')invoice.status='void';await persist(`更新銷項發票 ${billing.number}`);return invoice;
    }
    const payable=state.payables.find((row)=>String(row.id)===String(values.sourceId||values.payableId));if(!payable)throw new Error('找不到來源應付帳款');
    const existing=state.invoices.find((row)=>String(row.id)===String(id))||state.invoices.find((row)=>String(row.sourceType||'')==='payable'&&String(row.sourceId||row.payableId||'')===String(payable.id));
    const row=existing||{id:uid(),invoiceId:'',createdAt:now},amounts=invoiceAmounts(values.taxMode,values.amount);
    if(!existing)state.invoices.unshift(row);
    Object.assign(row,{invoiceId:row.invoiceId||row.id,invoiceType:'input',type:'進項',invoiceNumber:number,number,invoiceDate:values.invoiceDate||payable.date||businessDate(new Date(now)),date:values.invoiceDate||payable.date||businessDate(new Date(now)),customerId:'',vendorId:payable.vendor||'',vendor:payable.vendor||'',projectId:payable.project||'',project:payable.project||'',party:payable.vendorName||'',projectName:payable.projectName||'',sourceType:'payable',sourceId:payable.id,payableId:payable.id,sourceNo:payable.payableNo||payable.sourceNo||'',...amounts,amount:amounts.netAmount,tax:amounts.taxAmount,total:amounts.grossAmount,status,note:String(values.note||''),updatedAt:now});
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
    const date = values.date || businessDate();
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
    const linkedCommissions=state.commissions.filter((row)=>{const link=commissionBillingLink(row);return link.kind==='linked'&&link.billing===billing});
    if(linkedCommissions.some((row)=>payrollHistoryLock(row.employee,row.date).locked))throw new Error(PAID_ORPHAN_COMMISSION_ERROR);
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
    return {receivable,billing,receipts,retentionReceipts,transactions,invoiceRecords,dailyRefs,contractRefs,linkedCommissions};
  }
  function accountingDeletionSummary(plan) {
    const {receivable,billing,receipts,retentionReceipts,transactions}=plan;
    return {receivableId:receivable.id,billingId:billing.id,billingNo:billing.number||receivable.sourceNo||'',customerName:billing.customerName||receivable.customerName||'',projectName:billing.projectName||receivable.projectName||'',billingDate:billing.date||receivable.date||'',grossTotal:num(billing.grossTotal??receivable.grossTotal??billing.total??receivable.amount),receiptCount:receipts.length,retentionReceiptCount:retentionReceipts.length,bankTransactionCount:transactions.length,commissionCount:plan.linkedCommissions.length};
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
    const calculatedValues={lines:normalizedLines,taxMode:values.taxMode==='含稅'?'含稅':'未稅',invoiceStatus:invoiceStatusValue,retentionMode,retentionRate,retentionCustom,retentionBase:values.retentionBase==='preTax'?'preTax':'taxIncluded'},totals=calculateBilling(calculatedValues),now=new Date().toISOString(),date=String(values.date||billing.date||businessDate(new Date(now)));
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
  function linkedBankTransactionCandidates(record, sourceTypes) {
    const sourceId=String(record?.id||''),transactionId=String(record?.bankTransactionId||''),idMatches=transactionId?state.bankTransactions.filter((row)=>String(row.id||'')===transactionId):[],sourceMatches=sourceId?state.bankTransactions.filter((row)=>sourceTypes.includes(String(row.sourceType||''))&&String(row.sourceId||'')===sourceId):[];
    return {transactionId,idMatches,sourceMatches,candidates:[...new Set([...idMatches,...sourceMatches])]};
  }
  function linkedBankTransaction(record, sourceTypes, label) {
    const matches=linkedBankTransactionCandidates(record,sourceTypes).candidates;
    if(matches.length>1)throw new Error(`${label}對應到多筆銀行流水，為避免重複沖回已停止操作`);
    return matches[0]||null;
  }
  function strictBankReference(row, label) {
    const ids=[row?.bankAccountId,row?.bankId].map((value)=>String(value||'')).filter(Boolean),uniqueIds=[...new Set(ids)];
    if(uniqueIds.length!==1)throw new Error(`${label}的銀行帳戶不完整或不一致，已停止操作`);
    const matches=state.banks.filter((bank)=>String(bank.id||'')===uniqueIds[0]);
    if(matches.length!==1)throw new Error(`${label}無法唯一找到銀行帳戶，已停止操作`);
    return {id:uniqueIds[0],bank:matches[0]};
  }
  const hasAccountingValue = (row, key) => row?.[key]!==undefined&&row?.[key]!==null&&row?.[key]!=='';
  function strictExistingBankTransaction(record, sourceTypes, label) {
    const sourceId=String(record?.id||'');
    if(!sourceId)throw new Error(`${label}缺少可驗證的系統編號，已停止操作`);
    const {transactionId,idMatches,candidates}=linkedBankTransactionCandidates(record,sourceTypes);
    if(transactionId&&idMatches.length!==1)throw new Error(idMatches.length?`${label}指定的銀行流水編號不唯一，已停止操作`:`${label}找不到指定的銀行流水，已停止操作`);
    if(candidates.length!==1)throw new Error(candidates.length?`${label}對應到多筆銀行流水，為避免重複沖回已停止操作`:`${label}找不到銀行流水，為避免帳務斷鏈已停止操作`);
    const transaction=candidates[0];
    if(!sourceTypes.includes(String(transaction.sourceType||''))||String(transaction.sourceId||'')!==sourceId)throw new Error(`${label}與銀行流水的來源不一致，已停止操作`);
    if(transactionId&&String(transaction.id||'')!==transactionId)throw new Error(`${label}與指定銀行流水不一致，已停止操作`);
    return transaction;
  }
  async function restoreBankLinkedMutation(snapshot, error) {
    state=snapshot;
    let rollbackError=null;
    try{if(!db){try{db=await openDB()}catch(_){db=null}}if(db)await dbSet(STATE_KEY,state)}catch(current){rollbackError=current}
    try{localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state))}catch(current){rollbackError=rollbackError||current}
    try{window.KuSheLegacyData?.refresh()}catch(current){rollbackError=rollbackError||current}
    if(rollbackError)error.rollbackError=rollbackError;
  }
  function receiptMutationPlan(receipt) {
    const transaction=strictExistingBankTransaction(receipt,['receipt','receivable_receipt'],'一般收款'),receiptBank=strictBankReference(receipt,'一般收款'),transactionBank=strictBankReference(transaction,'一般收款銀行流水');
    if(receiptBank.id!==transactionBank.id)throw new Error('一般收款與銀行流水的帳戶不一致，已停止操作');
    if(!hasAccountingValue(receipt,'netAmount'))throw new Error('一般收款缺少可驗證的實際入帳金額，已停止操作');
    const netAmount=num(receipt.netAmount);
    if(num(transaction.amount)!==netAmount||hasAccountingValue(transaction,'actualCredit')&&num(transaction.actualCredit)!==netAmount)throw new Error('一般收款與銀行流水的入帳金額不一致，已停止操作');
    if(String(transaction.date||'')!==String(receipt.date||''))throw new Error('一般收款與銀行流水的日期不一致，已停止操作');
    if(hasAccountingValue(transaction,'receiptId')&&String(transaction.receiptId)!==String(receipt.id))throw new Error('一般收款與銀行流水的收款編號不一致，已停止操作');
    if(hasAccountingValue(transaction,'receivableId')&&String(transaction.receivableId)!==String(receipt.receivableId||''))throw new Error('一般收款與銀行流水的應收關聯不一致，已停止操作');
    if(hasAccountingValue(transaction,'billingId')&&String(transaction.billingId)!==String(receipt.billingId||''))throw new Error('一般收款與銀行流水的請款關聯不一致，已停止操作');
    return {transaction,bank:transactionBank.bank,amount:num(transaction.amount)};
  }
  function receiptBankTransaction(receipt) {
    return linkedBankTransaction(receipt,['receipt','receivable_receipt'],'一般收款');
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
  function syncReceiptBankTransaction(receipt, ar, now, existingTransaction) {
    const bankId=String(receipt.bankAccountId||receipt.bankId||''),bank=state.banks.find((row)=>row.id===bankId);
    if(!bank)throw new Error('請選擇收款銀行帳戶');
    const amount=Math.max(0,num(receipt.netAmount)),existing=existingTransaction===undefined?receiptBankTransaction(receipt):existingTransaction;
    if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankIncome(previousBank,-num(existing.amount),now)}
    const transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:receipt.date,bankId:bank.id,bankAccountId:bank.id,type:'收入',direction:'in',category:'應收收款',amount,receiptAmount:num(receipt.amount),fee:num(receipt.fee),feePayer:receipt.feePayer,netAmount:amount,actualCredit:amount,paymentMethod:receipt.paymentMethod||'銀行轉帳',sourceType:'receivable_receipt',sourceId:receipt.id,receivableId:ar.id,billingId:ar.billingId||'',customer:ar.customer,customerName:ar.customerName||'',project:ar.project,projectName:ar.projectName||'',sourceNo:ar.sourceNo||'',description:`${ar.projectName||ar.sourceNo||'應收帳款'} 收款`,note:receipt.note||`${ar.sourceNo||''} 收款`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);
    receipt.bankId=bank.id;receipt.bankAccountId=bank.id;receipt.bankTransactionId=transaction.id;
    adjustBankIncome(bank,amount,now);
    return transaction;
  }
  function retentionMutationPlan(receipt) {
    const transaction=strictExistingBankTransaction(receipt,['retention_receipt'],'保留款收回'),receiptBank=strictBankReference(receipt,'保留款收回'),transactionBank=strictBankReference(transaction,'保留款銀行流水'),receiptIds=new Set([receipt.id,receipt.retentionReceiptId].map((value)=>String(value||'')).filter(Boolean));
    if(receiptBank.id!==transactionBank.id)throw new Error('保留款收回與銀行流水的帳戶不一致，已停止操作');
    if(hasAccountingValue(transaction,'retentionReceiptId')&&!receiptIds.has(String(transaction.retentionReceiptId)))throw new Error('保留款銀行流水的收回編號不一致，已停止操作');
    if(hasAccountingValue(transaction,'receivableId')&&String(transaction.receivableId)!==String(receipt.receivableId||''))throw new Error('保留款銀行流水的應收關聯不一致，已停止操作');
    if(hasAccountingValue(transaction,'billingId')&&String(transaction.billingId)!==String(receipt.billingId||''))throw new Error('保留款銀行流水的請款關聯不一致，已停止操作');
    if(!hasAccountingValue(receipt,'netAmount'))throw new Error('保留款收回缺少可驗證的實際入帳金額，已停止操作');
    const netAmount=num(receipt.netAmount);
    if(num(transaction.amount)!==netAmount||hasAccountingValue(transaction,'actualCredit')&&num(transaction.actualCredit)!==netAmount)throw new Error('保留款收回與銀行流水的入帳金額不一致，已停止操作');
    if(String(transaction.date||'')!==String(receipt.date||''))throw new Error('保留款收回與銀行流水的日期不一致，已停止操作');
    return {transaction,bank:transactionBank.bank,amount:num(transaction.amount)};
  }
  function retentionBankTransaction(receipt) {
    return linkedBankTransaction(receipt,['retention_receipt'],'保留款收回');
  }
  function syncRetentionSummary(ar, billing, now) {
    const retentionAmount=Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention)),recorded=state.retentionReceipts.filter((row)=>row.receivableId===ar.id||row.billingId&&row.billingId===ar.billingId).reduce((sum,row)=>sum+num(row.amount),0),received=Math.min(retentionAmount,num(ar.legacyRetentionReceived)+recorded),remaining=Math.max(0,retentionAmount-received),nextState=retentionState(retentionAmount,received,ar.retentionStatus);
    Object.assign(ar,{retentionAmount,retention:retentionAmount,retentionReceived:received,remainingRetention:remaining,retentionStatus:nextState,updatedAt:now});
    if(billing){Object.assign(billing,{retentionAmount,retention:retentionAmount,retentionReceived:received,remainingRetention:remaining,retentionStatus:nextState,updatedAt:now});billing.status=num(ar.received)>=num(ar.amount)&&remaining===0?'全部收清':num(ar.received)>=num(ar.amount)?'已收款':num(ar.received)>0?'部分收款':'未收款'}
  }
  function syncRetentionBankTransaction(receipt, ar, billing, now, existingTransaction) {
    const bankId=String(receipt.bankAccountId||receipt.bankId||''),bank=state.banks.find((row)=>row.id===bankId);
    if(!bank)throw new Error('請選擇入帳銀行帳戶');
    const existing=existingTransaction===undefined?retentionBankTransaction(receipt):existingTransaction;
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
    const now = new Date().toISOString(), receipt = {id:uid(),idempotencyKey:idempotencyKey||uid(),receivableId:ar.id,billingId:ar.billingId||'',date:values.date||businessDate(new Date(now)),amount,fee,feePayer,netAmount,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',note:values.note||'',createdAt:now,updatedAt:now};
    state.receipts.unshift(receipt);syncReceiptBankTransaction(receipt,ar,now);syncReceivableSummary(ar,now);
    await persist(`新增分次收款 ${ar.sourceNo}`); return receipt;
  }
  async function updateReceipt(id, values = {}) {
    await load();
    const receiptMatches=state.receipts.filter((row)=>String(row.id||'')===String(id||''));if(receiptMatches.length!==1)throw new Error(receiptMatches.length?'收款紀錄編號不唯一，已停止修改':'找不到收款紀錄');const receipt=receiptMatches[0];
    const arMatches=state.receivables.filter((row)=>String(row.id||'')===String(receipt.receivableId||''));if(arMatches.length!==1)throw new Error(arMatches.length?'對應應收帳款不唯一，已停止修改':'找不到對應應收帳款');const ar=arMatches[0];
    const otherReceived=num(ar.legacyReceived)+state.receipts.filter((row)=>row!==receipt&&row.receivableId===ar.id).reduce((sum,row)=>sum+num(row.amount),0),settlement=incomeSettlement(values.amount,values.fee===undefined?receipt.fee:values.fee,values.feePayer===undefined?receipt.feePayer:values.feePayer),{amount,fee,feePayer,netAmount}=settlement,bankId=String(values.bankAccountId||values.bankId||'');
    if(amount<=0||otherReceived+amount>num(ar.amount))throw new Error('本次收款金額不可超過本期剩餘應收');
    strictBankReference({bankId},'新的收款銀行帳戶');const plan=receiptMutationPlan(receipt),snapshot=JSON.parse(JSON.stringify(state)),now=new Date().toISOString();
    try {
      Object.assign(receipt,{date:values.date||receipt.date||businessDate(new Date(now)),amount,fee,feePayer,netAmount,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||receipt.paymentMethod||'銀行轉帳',note:values.note===undefined?receipt.note:String(values.note||''),updatedAt:now});
      syncReceiptBankTransaction(receipt,ar,now,plan.transaction);syncReceivableSummary(ar,now);await persist(`修改應收收款 ${ar.sourceNo||''}`);return receipt;
    } catch(error) { await restoreBankLinkedMutation(snapshot,error);throw error; }
  }
  async function deleteReceipt(id, token) {
    await load();
    const receiptMatches=state.receipts.filter((row)=>String(row.id||'')===String(id||''));if(receiptMatches.length!==1)throw new Error(receiptMatches.length?'收款紀錄編號不唯一，已停止刪除':'找不到收款紀錄');const receipt=receiptMatches[0];
    const arMatches=state.receivables.filter((row)=>String(row.id||'')===String(receipt.receivableId||''));if(arMatches.length!==1)throw new Error(arMatches.length?'對應應收帳款不唯一，已停止刪除':'找不到對應應收帳款');const ar=arMatches[0],plan=receiptMutationPlan(receipt),snapshot=token===accountingDeleteToken?null:JSON.parse(JSON.stringify(state)),now=new Date().toISOString();
    try {
      adjustBankIncome(plan.bank,-plan.amount,now);state.bankTransactions=state.bankTransactions.filter((row)=>row!==plan.transaction);state.receipts=state.receipts.filter((row)=>row!==receipt);syncReceivableSummary(ar,now);if(token!==accountingDeleteToken)await persist(`刪除應收收款 ${ar.sourceNo||''}`);return true;
    } catch(error) { if(snapshot)await restoreBankLinkedMutation(snapshot,error);throw error; }
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
    const receipt={id,retentionReceiptId:id,idempotencyKey:idempotencyKey||uid(),receivableId:ar.id,billingId:billing?.id||ar.billingId||'',projectId:ar.project||billing?.project||'',customerId:ar.customer||billing?.customer||'',date:values.date||businessDate(new Date(now)),amount,paymentMethod:values.paymentMethod||'銀行轉帳',bankAccountId,bankId:bankAccountId,fee,feePayer,netAmount,note:String(values.note||''),createdAt:now,updatedAt:now};
    state.retentionReceipts.unshift(receipt);
    syncRetentionBankTransaction(receipt,ar,billing,now);syncRetentionSummary(ar,billing,now);
    await persist(`收回保留款 ${ar.sourceNo}`);return receipt;
  }
  async function updateRetentionReceipt(id, values = {}) {
    await load();
    const receiptMatches=state.retentionReceipts.filter((row)=>String(row.id||'')===String(id||'')||String(row.retentionReceiptId||'')===String(id||''));if(receiptMatches.length!==1)throw new Error(receiptMatches.length?'保留款收回紀錄編號不唯一，已停止修改':'找不到保留款收回紀錄');const receipt=receiptMatches[0];
    const arMatches=state.receivables.filter((row)=>String(row.id||'')===String(receipt.receivableId||''));if(arMatches.length!==1)throw new Error(arMatches.length?'對應應收帳款不唯一，已停止修改':'找不到對應應收帳款');const ar=arMatches[0];
    const billing=state.billings.find((row)=>row.id===receipt.billingId||row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||''));
    const retentionAmount=Math.max(0,num(ar.retentionAmount??ar.retention??billing?.retentionAmount??billing?.retention));
    const settlement=incomeSettlement(values.amount,values.fee===undefined?receipt.fee:values.fee,values.feePayer===undefined?receipt.feePayer:values.feePayer),{amount,fee,feePayer,netAmount}=settlement;
    if(amount<=0)throw new Error('本次收回保留款必須大於 0');
    const otherReceived=num(ar.legacyRetentionReceived)+state.retentionReceipts.filter((row)=>row!==receipt&&(row.receivableId===ar.id||row.billingId&&row.billingId===ar.billingId)).reduce((sum,row)=>sum+num(row.amount),0);
    if(otherReceived+amount>retentionAmount)throw new Error('本次收回金額不可超過剩餘保留款');
    const now=new Date().toISOString(),bankAccountId=String(values.bankAccountId||values.bankId||'');
    strictBankReference({bankId:bankAccountId},'新的保留款入帳銀行帳戶');const plan=retentionMutationPlan(receipt),snapshot=JSON.parse(JSON.stringify(state));
    try {
      Object.assign(receipt,{date:values.date||receipt.date||businessDate(new Date(now)),amount,bankAccountId,bankId:bankAccountId,paymentMethod:values.paymentMethod||'銀行轉帳',fee,feePayer,netAmount,note:String(values.note||''),updatedAt:now});
      syncRetentionBankTransaction(receipt,ar,billing,now,plan.transaction);syncRetentionSummary(ar,billing,now);await persist(`修改保留款收回紀錄 ${ar.sourceNo}`);return receipt;
    } catch(error) { await restoreBankLinkedMutation(snapshot,error);throw error; }
  }
  async function deleteRetentionReceipt(id, token) {
    await load();
    const receiptMatches=state.retentionReceipts.filter((row)=>String(row.id||'')===String(id||'')||String(row.retentionReceiptId||'')===String(id||''));if(receiptMatches.length!==1)throw new Error(receiptMatches.length?'保留款收回紀錄編號不唯一，已停止刪除':'找不到保留款收回紀錄');const receipt=receiptMatches[0];
    const arMatches=state.receivables.filter((row)=>String(row.id||'')===String(receipt.receivableId||''));if(arMatches.length!==1)throw new Error(arMatches.length?'對應應收帳款不唯一，已停止刪除':'找不到對應應收帳款');const ar=arMatches[0],billing=state.billings.find((row)=>row.id===receipt.billingId||row.id===ar.billingId||String(row.number||'')===String(ar.sourceNo||'')),plan=retentionMutationPlan(receipt),snapshot=token===accountingDeleteToken?null:JSON.parse(JSON.stringify(state)),now=new Date().toISOString();
    try {
      adjustBankIncome(plan.bank,-plan.amount,now);state.bankTransactions=state.bankTransactions.filter((row)=>row!==plan.transaction);state.retentionReceipts=state.retentionReceipts.filter((row)=>row!==receipt);syncRetentionSummary(ar,billing,now);if(token!==accountingDeleteToken)await persist(`刪除保留款收回紀錄 ${ar.sourceNo||''}`);return true;
    } catch(error) { if(snapshot)await restoreBankLinkedMutation(snapshot,error);throw error; }
  }
  async function deleteReceivableAccounting(receivableId) {
    await load();
    const plan=accountingDeletionPreflight(receivableId),summary=accountingDeletionSummary(plan),snapshot=JSON.parse(JSON.stringify(state));
    try {
      for(const receipt of plan.receipts)await deleteReceipt(receipt.id,accountingDeleteToken);
      for(const receipt of plan.retentionReceipts)await deleteRetentionReceipt(receipt.retentionReceiptId||receipt.id,accountingDeleteToken);
      for(const commission of plan.linkedCommissions)await deleteCommission(commission.id,accountingDeleteToken);
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
    const compact = String(date || businessDate()).replaceAll('-','');
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
    const project = state.projects.find((row) => row.id === values.projectId), now = new Date().toISOString(), date = values.date || businessDate(new Date(now)), id=uid();
    const row = {id,payableNo:nextPayableNumber(date),date,vendor:vendor?.id||'',vendorName:vendor?.name||payeeName,project:project?.id||'',projectName:project?.name||'',category:values.category||'其他',item:String(values.item||'').trim(),amount,paid:0,dueDate:values.dueDate||'',status:'未付款',note:values.note||'',sourceType:'manual-payable',sourceId:values.sourceId||id,createdAt:now,updatedAt:now};
    state.payables.unshift(row); await persist(`新增應付 ${row.payableNo}`); return row;
  }
  function payableDeletePreview(payableId) {
    const id=clean(payableId),payable=state?.payables?.find((row)=>String(row.id)===id),empty={payableId:id,allowed:false,blockers:[],sourceType:'',amount:0,paid:0,paymentCount:0,bankTransactionCount:0,invoiceNo:'',invoiceRecordCount:0,materialUsageCount:0,inventoryReceiptCount:0,projectCostCount:0,unknownRelationCount:0,payableNo:'',vendorName:'',projectName:'',invoiceStatus:'無正式發票'};
    if(!payable)return {...empty,blockers:[{key:'notFound',label:'應付帳款',count:1,message:'找不到應付帳款資料。'}]};
    const payments=(state.payments||[]).filter((row)=>String(row.payableId||'')===id),paymentIds=new Set(payments.map((row)=>String(row.id||'')).filter(Boolean)),paymentTransactionIds=new Set(payments.map((row)=>String(row.bankTransactionId||'')).filter(Boolean));
    const bankTransactions=(state.bankTransactions||[]).filter((row)=>String(row.payableId||'')===id||paymentTransactionIds.has(String(row.id||''))||paymentIds.has(String(row.sourceId||''))||(String(row.sourceId||'')===id&&/payable|應付/i.test(`${row.sourceType||''} ${row.type||''} ${row.category||''}`))||(String(payable.paymentTransactionId||'')&&String(row.id||'')===String(payable.paymentTransactionId)));
    const invoiceRecords=(state.invoices||[]).filter((row)=>String(row.payableId||'')===id||String(row.sourceId||'')===id);
    const materialUsageIds=new Set();
    (state.materialUsages||[]).forEach((row,index)=>{if(String(row.payableId||'')===id)materialUsageIds.add(String(row.id||`direct-${index}`))});
    (Array.isArray(payable.usageIds)?payable.usageIds:[]).forEach((usageId,index)=>materialUsageIds.add(String(usageId||`source-${index}`)));
    const inventoryReceipts=(Array.isArray(state.inventoryReceipts)?state.inventoryReceipts:[]).filter((row)=>String(row.payableId||'')===id);
    const projectCosts=(state.projectCosts||[]).filter((row)=>String(row.payableId||'')===id||(clean(payable.sourceId)&&String(row.id||'')===String(payable.sourceId||'')));
    const knownCollections=new Set(['payables','payments','bankTransactions','invoices','materialUsages','inventoryReceipts','projectCosts','audit']);
    let unknownRelationCount=String(payable.sourceType||'')==='manual-payable'&&clean(payable.sourceId)&&String(payable.sourceId)!==id?1:0;
    Object.entries(state||{}).forEach(([key,rows])=>{
      if(knownCollections.has(key)||!Array.isArray(rows))return;
      rows.forEach((row)=>{
        if(!row||typeof row!=='object')return;
        const direct=[row.payableId,row.payable].some((value)=>clean(value)===id),listed=Array.isArray(row.payableIds)&&row.payableIds.some((value)=>clean(value)===id),typedSource=clean(row.sourceId)===id&&/payable|應付/i.test(`${row.sourceType||''} ${row.type||''} ${row.category||''}`);
        if(direct||listed||typedSource)unknownRelationCount+=1;
      });
    });
    const sourceType=String(payable.sourceType||''),paid=num(payable.paid),invoiceNo=String(payable.invoiceNo||'').trim(),issuedInvoice=invoiceRecords.some((row)=>invoiceStatus(row.status,row.invoiceNumber||row.invoiceNo||row.number)==='issued'||String(row.invoiceNumber||row.invoiceNo||row.number||'').trim()),issuedPayableStatus=['issued','invoiced','已開票','已開發票'].includes(String(payable.invoiceStatus||'').trim());
    const blockers=[],add=(key,label,count,message)=>{if(count>0)blockers.push({key,label,count,message})};
    if(sourceType!=='manual-payable')add('sourceType','來源類型',1,sourceType==='material-project'?'此筆由材料使用自動建立，請從材料來源處理。':sourceType==='project-cost'?'此筆由案場成本建立，請從案場成本來源處理。':'此筆不是可安全刪除的手動應付，未知或歷史來源一律禁止直接刪除。');
    add('paid','已付金額',paid!==0?1:0,'此筆已有付款金額，銀行對帳完成前禁止整筆刪除。');
    add('payments','付款紀錄',payments.length,'此筆已有付款紀錄，銀行對帳完成前禁止整筆刪除。');
    add('bankTransactions','銀行流水',bankTransactions.length,'此筆已有關聯銀行流水，銀行對帳完成前禁止整筆刪除。');
    add('invoiceNo','發票號碼',invoiceNo?1:0,'此筆已有正式進項發票號碼，不可直接刪除。');
    add('invoiceStatus','發票狀態',issuedPayableStatus?1:0,'此筆已標記正式進項發票，不可直接刪除。');
    add('invoices','進項發票',invoiceRecords.length,'此筆已有持久化進項發票紀錄，不可直接刪除。');
    add('materialUsages','材料來源',materialUsageIds.size,'此筆由材料使用關聯，請從材料來源處理。');
    add('inventoryReceipts','入庫來源',inventoryReceipts.length,'此筆已有材料入庫來源，請從材料來源處理。');
    add('projectCosts','案場成本來源',projectCosts.length,'此筆由案場成本建立，請從案場成本來源處理。');
    add('unknownRelations','未知關聯',unknownRelationCount,'此筆存在未識別的來源關聯，為避免帳務斷鏈已停止刪除。');
    return {payableId:id,allowed:blockers.length===0,blockers,sourceType,amount:num(payable.amount),paid,paymentCount:payments.length,bankTransactionCount:bankTransactions.length,invoiceNo,invoiceRecordCount:invoiceRecords.length,materialUsageCount:materialUsageIds.size,inventoryReceiptCount:inventoryReceipts.length,projectCostCount:projectCosts.length,unknownRelationCount,payableNo:payable.payableNo||payable.number||payable.sourceNo||'',vendorName:payable.vendorName||state.vendors?.find((row)=>String(row.id)===String(payable.vendor||''))?.name||'',projectName:payable.projectName||state.projects?.find((row)=>String(row.id)===String(payable.project||''))?.name||'',invoiceStatus:invoiceRecords.length?(issuedInvoice?'已有正式進項發票':'已有進項發票紀錄'):invoiceNo?'已填發票號碼':'無正式發票'};
  }
  async function deletePayable(payableId) {
    await load();
    const id=clean(payableId),payable=state.payables.find((row)=>String(row.id)===id);
    if(!payable)throw new Error('找不到應付帳款資料');
    const preview=payableDeletePreview(id);
    if(preview.allowed!==true)throw new Error(`此筆應付帳款不能刪除：${preview.blockers.map((row)=>row.message).join(' ')}`);
    const previousPayables=state.payables,previousMeta={...state.meta},previousAudit=[...state.audit];
    state.payables=state.payables.filter((row)=>row!==payable);
    try{await persist(`刪除未付款手動應付帳款｜${payable.payableNo||payable.sourceNo||payable.id}｜${payable.vendorName||''}｜${num(payable.amount)}`)}
    catch(error){
      state.payables=previousPayables;state.meta=previousMeta;state.audit=previousAudit;
      try{if(!db)db=await openDB();if(db)await dbSet(STATE_KEY,state);localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state))}catch(_){/* 原始錯誤優先；記憶體狀態已完整還原 */}
      throw error;
    }
    return preview;
  }
  function materialPayableTestCleanupPreview(payableId) {
    const id=clean(payableId),payable=state?.payables?.find((row)=>String(row.id)===id),empty={payableId:id,allowed:false,blockers:[],sourceType:'',payableNo:'',vendorName:'',projectName:'',amount:0,paid:0,paymentCount:0,bankTransactionCount:0,invoiceRecordCount:0,materialUsageCount:0,inventoryReceiptCount:0,projectCostCount:0,sharedMaterialUsageCount:0,sharedMaterialUsageDetails:[],unknownRelationCount:0,invoices:[],materialUsages:[]};
    if(!payable)return {...empty,blockers:[{key:'notFound',label:'應付帳款',count:1,message:'找不到應付帳款資料。'}]};
    const payments=(state.payments||[]).filter((row)=>String(row.payableId||'')===id),paymentIds=new Set(payments.map((row)=>clean(row.id)).filter(Boolean)),paymentTransactionIds=new Set(payments.map((row)=>clean(row.bankTransactionId)).filter(Boolean));
    const bankTransactions=(state.bankTransactions||[]).filter((row)=>String(row.payableId||'')===id||paymentTransactionIds.has(clean(row.id))||paymentIds.has(clean(row.sourceId))||(clean(row.sourceId)===id&&/payable|應付/i.test(`${row.sourceType||''} ${row.type||''} ${row.category||''}`))||(clean(payable.paymentTransactionId)&&clean(row.id)===clean(payable.paymentTransactionId)));
    const inputInvoices=(state.invoices||[]).filter((row)=>(row.invoiceType==='input'||/進項/.test(String(row.type||'')))&&legacyInvoicePayable(row)===payable);
    const directInvoiceRelations=(state.invoices||[]).filter((row)=>clean(row.payableId)===id||clean(row.sourceId)===id),unrecognizedInvoices=directInvoiceRelations.filter((row)=>!inputInvoices.includes(row));
    const usageIds=Array.isArray(payable.usageIds)?payable.usageIds.map((value)=>clean(value)).filter(Boolean):[],usageIdSet=new Set(usageIds),materialUsages=(state.materialUsages||[]).filter((row)=>clean(row.payableId)===id||usageIdSet.has(clean(row.id)));
    const materialUsageIds=materialUsages.map((row)=>clean(row.id)),missingUsageIds=[...usageIdSet].filter((usageId)=>!(state.materialUsages||[]).some((row)=>clean(row.id)===usageId)),duplicateUsageIds=[...materialUsageIds.filter((usageId,index,rows)=>!usageId||rows.indexOf(usageId)!==index),...usageIds.filter((usageId,index,rows)=>rows.indexOf(usageId)!==index)];
    const sharedMaterialUsages=materialUsages.filter((usage)=>{
      const usageId=clean(usage.id),directOwner=clean(usage.payableId);
      return Boolean(directOwner&&directOwner!==id)||state.payables.some((row)=>row!==payable&&(Array.isArray(row.usageIds)&&row.usageIds.some((value)=>clean(value)===usageId)||String(row.sourceType||'')==='material-project'&&clean(row.sourceId)===usageId));
    });
    const sharedMaterialUsageDetails=sharedMaterialUsages.map((usage)=>{
      const usageId=clean(usage.id),relations=new Map(),addRelation=(otherPayable,referenceType,relatedId='')=>{
        const payableId=clean(otherPayable?.id||relatedId),key=payableId||`${referenceType}:${relations.size}`;
        if(!relations.has(key))relations.set(key,{payable:otherPayable||null,payableId,referenceTypes:new Set()});
        relations.get(key).referenceTypes.add(referenceType);
      };
      const directOwner=clean(usage.payableId);
      if(directOwner&&directOwner!==id)addRelation(state.payables.find((row)=>clean(row.id)===directOwner),'materialUsage.payableId',directOwner);
      state.payables.forEach((row)=>{
        if(row===payable)return;
        if(Array.isArray(row.usageIds)&&row.usageIds.some((value)=>clean(value)===usageId))addRelation(row,'payable.usageIds[]');
        if(String(row.sourceType||'')==='material-project'&&clean(row.sourceId)===usageId)addRelation(row,'payable.sourceId');
      });
      return {usageId,materialName:usage.materialName||state.materials?.find((row)=>clean(row.id)===clean(usage.material||usage.materialId))?.name||'',projectName:usage.projectName||state.projects?.find((row)=>clean(row.id)===clean(usage.project||usage.projectId))?.name||'',amount:num(usage.amount??num(usage.quantity)*num(usage.unitPrice)),currentPayableId:id,currentPayableNo:payable.payableNo||payable.number||payable.sourceNo||'',otherPayables:[...relations.values()].map(({payable:other,payableId,referenceTypes})=>({payableId,payableNo:other?.payableNo||other?.number||other?.sourceNo||'',vendorName:other?.vendorName||state.vendors?.find((row)=>clean(row.id)===clean(other?.vendor))?.name||'',amount:num(other?.amount),paid:num(other?.paid),sourceType:String(other?.sourceType||''),referenceType:[...referenceTypes].join('、')}))};
    });
    const inventoryReceipts=(Array.isArray(state.inventoryReceipts)?state.inventoryReceipts:[]).filter((row)=>clean(row.payableId)===id),projectCosts=(state.projectCosts||[]).filter((row)=>clean(row.payableId)===id||(clean(payable.sourceId)&&clean(row.id)===clean(payable.sourceId)));
    const knownCollections=new Set(['payables','payments','bankTransactions','invoices','materialUsages','inventoryReceipts','projectCosts','audit']);
    let unknownRelationCount=unrecognizedInvoices.length+missingUsageIds.length+duplicateUsageIds.length;
    Object.entries(state||{}).forEach(([key,rows])=>{
      if(knownCollections.has(key)||!Array.isArray(rows))return;
      rows.forEach((row)=>{
        if(!row||typeof row!=='object')return;
        const direct=[row.payableId,row.payable].some((value)=>clean(value)===id),listed=Array.isArray(row.payableIds)&&row.payableIds.some((value)=>clean(value)===id),typedSource=clean(row.sourceId)===id&&/payable|應付/i.test(`${row.sourceType||''} ${row.type||''} ${row.category||''}`);
        if(direct||listed||typedSource)unknownRelationCount+=1;
      });
    });
    const sourceId=clean(payable.sourceId),knownSourceId=Boolean(sourceId)&&materialUsages.some((row)=>clean(row.id)===sourceId);
    if(!knownSourceId)unknownRelationCount+=1;
    const sourceType=String(payable.sourceType||''),paid=num(payable.paid),invoiceIds=inputInvoices.map((row)=>clean(row.id)),invalidInvoiceIdentity=invoiceIds.some((invoiceId)=>!invoiceId)||new Set(invoiceIds).size!==invoiceIds.length;
    const blockers=[],add=(key,label,count,message)=>{if(count>0)blockers.push({key,label,count,message})};
    add('sourceType','來源類型',sourceType==='material-project'?0:1,'只允許清理材料使用所建立的測試應付資料。');
    add('paid','已付金額',paid===0?0:1,'此筆已有付款金額，禁止測試資料清理。');
    add('payments','付款紀錄',payments.length,'此筆已有付款紀錄，禁止測試資料清理。');
    add('bankTransactions','銀行流水',bankTransactions.length,'此筆已有關聯銀行流水，禁止測試資料清理。');
    add('materialUsages','材料使用',materialUsages.length>0?0:1,'找不到可唯一對應的材料使用來源。');
    add('sharedMaterialUsages','共用材料來源',sharedMaterialUsages.length,'材料使用同時被其他應付引用，禁止清理。');
    add('inventoryReceipts','入庫來源',inventoryReceipts.length,'此筆存在材料入庫關聯，禁止清理。');
    add('projectCosts','案場成本',projectCosts.length,'此筆存在案場成本關聯，禁止清理。');
    add('invoiceRecordCount','進項發票',inputInvoices.length===1?0:Math.abs(inputInvoices.length-1)||1,inputInvoices.length?'關聯進項發票不唯一，禁止清理。':'找不到唯一的持久化進項發票紀錄。');
    add('invoiceIdentity','發票識別',invalidInvoiceIdentity?1:0,'進項發票缺少唯一識別，禁止清理。');
    add('unknownRelations','未知關聯',unknownRelationCount,'此筆存在未識別、缺失或衝突關聯，禁止清理。');
    return {payableId:id,allowed:blockers.length===0,blockers,sourceType,payableNo:payable.payableNo||payable.number||payable.sourceNo||'',vendorName:payable.vendorName||state.vendors?.find((row)=>clean(row.id)===clean(payable.vendor))?.name||'',projectName:payable.projectName||state.projects?.find((row)=>clean(row.id)===clean(payable.project))?.name||'',amount:num(payable.amount),paid,paymentCount:payments.length,bankTransactionCount:bankTransactions.length,invoiceRecordCount:inputInvoices.length,materialUsageCount:materialUsages.length,inventoryReceiptCount:inventoryReceipts.length,projectCostCount:projectCosts.length,sharedMaterialUsageCount:sharedMaterialUsages.length,sharedMaterialUsageDetails,unknownRelationCount,invoices:inputInvoices.map((row)=>({id:clean(row.id),invoiceNo:String(row.invoiceNumber||row.invoiceNo||row.number||''),date:row.invoiceDate||row.date||'',status:invoiceStatus(row.status,row.invoiceNumber||row.invoiceNo||row.number),amount:num(row.grossAmount??row.total??row.netAmount??row.amount),sourceNo:row.sourceNo||''})),materialUsages:materialUsages.map((row)=>({id:clean(row.id),date:row.date||'',projectId:row.project||row.projectId||'',projectName:row.projectName||state.projects?.find((project)=>clean(project.id)===clean(row.project||row.projectId))?.name||'',materialId:row.material||row.materialId||'',materialName:row.materialName||state.materials?.find((material)=>clean(material.id)===clean(row.material||row.materialId))?.name||'',amount:num(row.amount??num(row.quantity)*num(row.unitPrice))}))};
  }
  async function cleanupMaterialPayableTestData(payableId, confirmation={}) {
    await load();
    const id=clean(payableId),preview=materialPayableTestCleanupPreview(id),reason=clean(confirmation?.reason);
    if(confirmation?.confirmed!==true)throw new Error('必須明確確認整組資料為測試資料。');
    if(!reason)throw new Error('請輸入測試資料清理原因。');
    if(preview.allowed!==true)throw new Error(`此組資料不可安全清理：${preview.blockers.map((row)=>row.message).join(' ')}`);
    const snapshot=JSON.parse(JSON.stringify(state)),invoiceIds=new Set(preview.invoices.map((row)=>row.id)),usageIds=new Set(preview.materialUsages.map((row)=>row.id)),fingerprint=(value)=>JSON.stringify(value),protectedFingerprints={payments:fingerprint(state.payments),bankTransactions:fingerprint(state.bankTransactions),banks:fingerprint(state.banks)},otherFingerprints={invoices:fingerprint(state.invoices.filter((row)=>!invoiceIds.has(clean(row.id)))),materialUsages:fingerprint(state.materialUsages.filter((row)=>!usageIds.has(clean(row.id)))),payables:fingerprint(state.payables.filter((row)=>clean(row.id)!==id))};
    const assertUnchanged=()=>{
      if(fingerprint(state.payments)!==protectedFingerprints.payments)throw new Error('付款紀錄發生非預期變動，已停止清理。');
      if(fingerprint(state.bankTransactions)!==protectedFingerprints.bankTransactions)throw new Error('銀行流水發生非預期變動，已停止清理。');
      if(fingerprint(state.banks)!==protectedFingerprints.banks)throw new Error('銀行帳戶發生非預期變動，已停止清理。');
    };
    try {
      state.invoices=state.invoices.filter((row)=>!invoiceIds.has(clean(row.id)));
      state.materialUsages=state.materialUsages.filter((row)=>!usageIds.has(clean(row.id)));
      const target=state.payables.find((row)=>clean(row.id)===id);
      if(!target)throw new Error('清理過程找不到目標應付帳款。');
      target.usageIds=[];
      state.payables=state.payables.filter((row)=>row!==target);
      assertUnchanged();
      if(state.invoices.some((row)=>invoiceIds.has(clean(row.id))||clean(row.payableId)===id||clean(row.sourceId)===id))throw new Error('目標進項發票未完整移除。');
      if(state.materialUsages.some((row)=>usageIds.has(clean(row.id))||clean(row.payableId)===id))throw new Error('目標材料使用未完整移除。');
      if(state.payables.some((row)=>clean(row.id)===id))throw new Error('目標應付帳款未完整移除。');
      if(fingerprint(state.invoices)!==otherFingerprints.invoices)throw new Error('其他進項發票發生非預期變動。');
      if(fingerprint(state.materialUsages)!==otherFingerprints.materialUsages)throw new Error('其他材料使用發生非預期變動。');
      if(fingerprint(state.payables)!==otherFingerprints.payables)throw new Error('其他應付帳款發生非預期變動。');
      if(state.payables.some((row)=>Array.isArray(row.usageIds)&&row.usageIds.some((usageId)=>usageIds.has(clean(usageId)))))throw new Error('刪除後仍有應付引用目標材料使用。');
      if((state.inventoryReceipts||[]).some((row)=>clean(row.payableId)===id))throw new Error('刪除後留下入庫孤兒關聯。');
      if((state.projectCosts||[]).some((row)=>clean(row.payableId)===id))throw new Error('刪除後留下案場成本孤兒關聯。');
      await persist(`測試資料安全清理｜材料→應付→進項發票｜${preview.payableNo||id}｜原因：${reason}`);
      assertUnchanged();
      return {...preview,reason,deletedInvoiceCount:invoiceIds.size,deletedMaterialUsageCount:usageIds.size,deletedPayableCount:1};
    } catch(error) {
      state=snapshot;
      try{if(!db)db=await openDB();if(db)await dbSet(STATE_KEY,state)}catch(_){/* 持久層採最大努力還原，原始錯誤優先 */}
      try{localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state))}catch(_){/* 緊急備份採最大努力還原，原始錯誤優先 */}
      throw error;
    }
  }
  function mergedPayableRepairPreview(duplicatePayableId) {
    const id=clean(duplicatePayableId),duplicate=state?.payables?.find((row)=>clean(row.id)===id),empty={duplicatePayableId:id,allowed:false,blockers:[],duplicatePayable:null,mergedPayable:null,materialUsages:[],truePayments:[],legacySummary:null,testInvoice:null,materialTotal:0,truePaymentTotal:0,trueFeeTotal:0,bankActualDebitTotal:0,bankTransactionCount:0,orphanPayableIds:[],unknownRelationCount:0};
    if(!duplicate)return {...empty,blockers:[{key:'notFound',label:'舊應付帳款',count:1,message:'找不到要檢查的舊應付帳款。'}]};
    const blockers=[],add=(key,label,count,message)=>{if(count>0)blockers.push({key,label,count,message})},moneyEqual=(left,right)=>Math.abs(num(left)-num(right))<0.001,vendorName=(row)=>row?.vendorName||state.vendors?.find((vendor)=>clean(vendor.id)===clean(row?.vendor||row?.vendorId))?.name||'',sameVendor=(left,right)=>{
      const leftId=clean(left?.vendor||left?.vendorId),rightId=clean(right?.vendor||right?.vendorId);
      if(leftId&&rightId)return leftId===rightId;
      return Boolean(normalizedMasterLabel(vendorName(left))&&normalizedMasterLabel(vendorName(left))===normalizedMasterLabel(vendorName(right)));
    };
    const duplicateUsageIds=new Set((Array.isArray(duplicate.usageIds)?duplicate.usageIds:[]).map(clean).filter(Boolean)),duplicateSourceId=clean(duplicate.sourceId);
    if(duplicateSourceId&&(state.materialUsages||[]).some((row)=>clean(row.id)===duplicateSourceId))duplicateUsageIds.add(duplicateSourceId);
    (state.materialUsages||[]).forEach((row)=>{if(clean(row.payableId)===id)duplicateUsageIds.add(clean(row.id))});
    const duplicateUsages=[...duplicateUsageIds].map((usageId)=>(state.materialUsages||[]).find((row)=>clean(row.id)===usageId)).filter(Boolean),missingDuplicateUsages=[...duplicateUsageIds].filter((usageId)=>!duplicateUsages.some((row)=>clean(row.id)===usageId)),duplicateMaterialTotal=duplicateUsages.reduce((sum,row)=>sum+num(row.amount??num(row.quantity)*num(row.unitPrice)),0);
    const candidates=(state.payables||[]).filter((row)=>row!==duplicate&&String(row.sourceType||'')==='material-merged'&&sameVendor(row,duplicate)&&duplicateUsageIds.size>0&&[...duplicateUsageIds].every((usageId)=>(Array.isArray(row.usageIds)?row.usageIds:[]).some((value)=>clean(value)===usageId))),merged=candidates.length===1?candidates[0]:null;
    const mergedUsageIds=merged?(Array.isArray(merged.usageIds)?merged.usageIds:[]).map(clean).filter(Boolean):[],duplicateMergedUsageIds=mergedUsageIds.filter((usageId,index,rows)=>rows.indexOf(usageId)!==index),mergedUsages=mergedUsageIds.map((usageId)=>(state.materialUsages||[]).filter((row)=>clean(row.id)===usageId)),missingMergedUsageIds=mergedUsages.filter((rows)=>rows.length!==1).length,materialUsages=mergedUsages.flat(),materialTotal=materialUsages.reduce((sum,row)=>sum+num(row.amount??num(row.quantity)*num(row.unitPrice)),0);
    const relatedPayables=merged?state.payables.filter((row)=>row!==merged&&row!==duplicate&&materialUsages.some((usage)=>{
      const usageId=clean(usage.id);
      return (Array.isArray(row.usageIds)&&row.usageIds.some((value)=>clean(value)===usageId))||(String(row.sourceType||'')==='material-project'&&clean(row.sourceId)===usageId);
    })):[];
    const ownerIds=new Set(materialUsages.map((row)=>clean(row.payableId)).filter(Boolean)),orphanPayableIds=[...ownerIds].filter((ownerId)=>ownerId!==id&&ownerId!==clean(merged?.id)&&!state.payables.some((row)=>clean(row.id)===ownerId)),conflictingOwners=[...ownerIds].filter((ownerId)=>ownerId!==id&&ownerId!==clean(merged?.id)&&!orphanPayableIds.includes(ownerId));
    const truePayments=(state.payments||[]).filter((row)=>orphanPayableIds.includes(clean(row.payableId))),ownerIdsWithoutPayments=orphanPayableIds.filter((ownerId)=>!truePayments.some((row)=>clean(row.payableId)===ownerId)),duplicatePayments=(state.payments||[]).filter((row)=>clean(row.payableId)===id),mergedPayments=merged?(state.payments||[]).filter((row)=>clean(row.payableId)===clean(merged.id)):[],legacySummaries=mergedPayments.filter((row)=>row.legacy===true&&clean(row.id)===`legacy-${clean(merged.id)}`),unexpectedMergedPayments=mergedPayments.filter((row)=>!legacySummaries.includes(row));
    const transactionUse=new Map(),paymentDetails=truePayments.map((payment)=>{
      const paymentId=clean(payment.id),matches=(state.bankTransactions||[]).filter((row)=>clean(row.id)===clean(payment.bankTransactionId)||(clean(row.sourceId)===paymentId&&['payable-payment','payable_payment'].includes(String(row.sourceType||'')))),transaction=matches.length===1?matches[0]:null;
      if(transaction){const transactionId=clean(transaction.id);transactionUse.set(transactionId,(transactionUse.get(transactionId)||0)+1)}
      const paymentBankId=clean(payment.bankAccountId||payment.bankId),transactionBankId=clean(transaction?.bankAccountId||transaction?.bankId),expectedDebit=num(payment.actualDebit??payment.amount),issues=[];
      if(matches.length!==1)issues.push(matches.length?'一筆付款對應多筆銀行交易。':'付款缺少對應銀行交易。');
      if(!clean(payment.id))issues.push('付款紀錄缺少唯一編號。');
      if(num(payment.amount)<=0||num(payment.fee)<0||expectedDebit<=0)issues.push('付款金額、手續費或實際扣款不符合有效付款條件。');
      if(transaction&&clean(transaction.sourceId)!==paymentId)issues.push('銀行交易未指向原付款紀錄。');
      if(transaction&&clean(transaction.payableId)!==clean(payment.payableId))issues.push('付款與銀行交易目前指向不同舊帳。');
      if(transaction&&String(transaction.direction||'').toLowerCase()!=='out'&&String(transaction.type||'')!=='支出')issues.push('銀行交易不是支出紀錄。');
      if(!paymentBankId||!state.banks.some((row)=>clean(row.id)===paymentBankId))issues.push('付款銀行帳戶無法確認。');
      if(transaction&&paymentBankId!==transactionBankId)issues.push('付款與銀行交易的銀行帳戶不一致。');
      if(transaction&&!moneyEqual(transaction.amount,expectedDebit))issues.push('銀行實際扣款與付款紀錄不一致。');
      if(transaction&&transaction.payableAmount!==undefined&&!moneyEqual(transaction.payableAmount,payment.amount))issues.push('銀行交易的應付金額與付款金額不一致。');
      if(transaction&&transaction.fee!==undefined&&!moneyEqual(transaction.fee,payment.fee))issues.push('付款與銀行交易的手續費不一致。');
      if(transaction&&clean(transaction.feePayer)&&clean(payment.feePayer)&&clean(transaction.feePayer)!==clean(payment.feePayer))issues.push('付款與銀行交易的手續費負擔方式不一致。');
      if(transaction&&clean(transaction.paymentMethod)&&clean(payment.paymentMethod)&&clean(transaction.paymentMethod)!==clean(payment.paymentMethod))issues.push('付款方式與銀行交易不一致。');
      if(transaction&&merged&&!sameVendor(transaction,merged))issues.push('銀行交易廠商與合併應付不一致。');
      return {payment,transaction,matches,issues};
    });
    const matchedTransactionIds=new Set(paymentDetails.flatMap((row)=>row.matches.map((transaction)=>clean(transaction.id)))),oldTransactions=(state.bankTransactions||[]).filter((row)=>orphanPayableIds.includes(clean(row.payableId))||truePayments.some((payment)=>clean(row.sourceId)===clean(payment.id))),unmatchedOldTransactions=oldTransactions.filter((row)=>!matchedTransactionIds.has(clean(row.id))),duplicateTransactions=(state.bankTransactions||[]).filter((row)=>clean(row.payableId)===id||duplicatePayments.some((payment)=>clean(row.sourceId)===clean(payment.id)||clean(row.id)===clean(payment.bankTransactionId)));
    const truePaymentTotal=truePayments.reduce((sum,row)=>sum+num(row.amount),0),trueFeeTotal=truePayments.reduce((sum,row)=>sum+num(row.fee),0),bankActualDebitTotal=paymentDetails.reduce((sum,row)=>sum+num(row.transaction?.amount),0),legacySummary=legacySummaries.length===1?legacySummaries[0]:null,legacyTransactions=legacySummary?(state.bankTransactions||[]).filter((row)=>clean(row.id)===clean(legacySummary.bankTransactionId)||clean(row.sourceId)===clean(legacySummary.id)):[];
    const inputInvoices=(state.invoices||[]).filter((row)=>(row.invoiceType==='input'||/進項/.test(String(row.type||'')))&&legacyInvoicePayable(row)===duplicate),directDuplicateInvoices=(state.invoices||[]).filter((row)=>clean(row.payableId)===id||clean(row.sourceId)===id),unknownDuplicateInvoices=directDuplicateInvoices.filter((row)=>!inputInvoices.includes(row)),testInvoice=inputInvoices.length===1?inputInvoices[0]:null;
    const duplicateInventory=(state.inventoryReceipts||[]).filter((row)=>clean(row.payableId)===id),duplicateProjectCosts=(state.projectCosts||[]).filter((row)=>clean(row.payableId)===id),oldInventory=(state.inventoryReceipts||[]).filter((row)=>orphanPayableIds.includes(clean(row.payableId))),oldProjectCosts=(state.projectCosts||[]).filter((row)=>orphanPayableIds.includes(clean(row.payableId)));
    const knownCollections=new Set(['payables','payments','bankTransactions','invoices','materialUsages','inventoryReceipts','projectCosts','audit']),checkedIds=new Set([id,...orphanPayableIds]),unknownRelations=[];
    Object.entries(state||{}).forEach(([key,rows])=>{
      if(knownCollections.has(key)||!Array.isArray(rows))return;
      rows.forEach((row)=>{if(!row||typeof row!=='object')return;const direct=[row.payableId,row.payable].some((value)=>checkedIds.has(clean(value))),listed=Array.isArray(row.payableIds)&&row.payableIds.some((value)=>checkedIds.has(clean(value))),typedSource=checkedIds.has(clean(row.sourceId))&&/payable|應付/i.test(`${row.sourceType||''} ${row.type||''} ${row.category||''}`);if(direct||listed||typedSource)unknownRelations.push({collection:key,id:clean(row.id)})});
    });
    add('duplicateSource','舊帳來源',String(duplicate.sourceType||'')==='material-project'?0:1,'只有單筆材料應付才能進行歷史合併帳務修復。');
    add('duplicateUsages','舊帳材料來源',duplicateUsageIds.size===1&&missingDuplicateUsages.length===0?0:1,'舊帳必須只能對應一筆可唯一辨識的材料來源。');
    add('duplicateMaterialAmount','舊帳材料金額',moneyEqual(duplicateMaterialTotal,duplicate.amount)?0:1,'舊帳金額與其單筆材料金額不一致。');
    add('mergedPayable','合併應付',candidates.length===1?0:Math.abs(candidates.length-1)||1,candidates.length?'找到多筆可能的合併應付，禁止自動判斷。':'找不到唯一包含此材料的合併應付。');
    add('mergedVendor','廠商',merged&&sameVendor(merged,duplicate)?0:1,'舊帳與合併應付的廠商不一致。');
    add('mergedUsages','合併材料',mergedUsageIds.length>0&&missingMergedUsageIds===0&&duplicateMergedUsageIds.length===0?0:1,'合併應付的材料來源缺失、重複或不唯一。');
    add('materialAmounts','材料金額',materialUsages.some((row)=>num(row.amount??num(row.quantity)*num(row.unitPrice))<=0)?1:0,'合併應付包含無效的材料金額。');
    add('materialTotal','材料合計',merged&&moneyEqual(materialTotal,merged.amount)?0:1,'材料合計與合併應付金額不一致。');
    add('sharedPayables','其他材料帳務',relatedPayables.length,'材料仍被第三筆應付帳款引用，禁止修復。');
    add('conflictingOwners','材料歸屬',conflictingOwners.length,'材料目前指向仍存在的其他應付帳款，禁止修復。');
    add('orphanOwners','歷史舊帳線索',orphanPayableIds.length>0?0:1,'找不到材料所指向的已不存在舊帳，無法證明歷史付款來源。');
    add('orphanOwnerPayments','歷史舊帳付款',ownerIdsWithoutPayments.length,'材料指向的歷史舊帳缺少可核對的真正付款。');
    add('truePayments','真正付款',truePayments.length>0?0:1,'找不到掛在歷史舊帳上的真正付款紀錄。');
    add('paymentIdentity','付款識別',truePayments.some((row)=>!clean(row.id))?1:0,'真正付款紀錄缺少唯一識別。');
    add('paymentVendor','付款廠商',truePayments.filter((row)=>vendorName(row)&&merged&&!sameVendor(row,merged)).length,'付款紀錄廠商與合併應付不一致。');
    add('paymentBankLinks','付款與銀行關聯',paymentDetails.reduce((sum,row)=>sum+row.issues.length,0),paymentDetails.flatMap((row)=>row.issues).join(' ')||'付款與銀行交易關聯不完整。');
    add('bankTransactionReuse','銀行交易重複關聯',[...transactionUse.values()].filter((count)=>count!==1).length,'同一筆銀行交易被多筆付款共用。');
    add('unmatchedBankTransactions','銀行交易',unmatchedOldTransactions.length,'歷史舊帳仍有無法唯一歸屬的銀行交易。');
    add('legacySummary','歷史彙總',legacySummaries.length===1&&unexpectedMergedPayments.length===0?0:Math.abs(legacySummaries.length-1)+unexpectedMergedPayments.length||1,'合併應付的歷史彙總付款不唯一，或同時存在其他付款紀錄。');
    add('legacySummaryBank','歷史彙總銀行紀錄',legacyTransactions.length,'歷史彙總已有自己的銀行交易，禁止移除。');
    add('legacySummaryAmount','歷史彙總金額',legacySummary&&moneyEqual(legacySummary.amount,truePaymentTotal)&&moneyEqual(legacySummary.fee,trueFeeTotal)&&moneyEqual(merged?.paid,truePaymentTotal)?0:1,'真正付款合計、帳面已付與歷史彙總金額不一致。');
    add('legacySummaryDebit','歷史彙總實際扣款',legacySummary&&moneyEqual(legacySummary.actualDebit,bankActualDebitTotal)?0:1,'歷史彙總的實際扣款與真正銀行交易合計不一致。');
    add('duplicatePaid','舊帳已付款',num(duplicate.paid)===0?0:1,'要清理的舊帳已有付款金額。');
    add('duplicatePayments','舊帳付款',duplicatePayments.length,'要清理的舊帳仍有付款紀錄。');
    add('duplicateTransactions','舊帳銀行交易',duplicateTransactions.length,'要清理的舊帳仍有銀行交易。');
    add('testInvoice','測試進項發票',inputInvoices.length===1&&clean(testInvoice?.id)?0:Math.abs(inputInvoices.length-1)||1,inputInvoices.length?'舊帳的進項發票不唯一。':'找不到舊帳唯一對應的進項發票。');
    add('unknownInvoices','其他發票關聯',unknownDuplicateInvoices.length,'舊帳仍有無法辨識的發票關聯。');
    add('inventoryReceipts','材料入庫',duplicateInventory.length+oldInventory.length,'舊帳或歷史帳務仍有材料入庫關聯。');
    add('projectCosts','案場成本',duplicateProjectCosts.length+oldProjectCosts.length,'舊帳或歷史帳務仍有案場成本關聯。');
    add('unknownRelations','其他未確認關聯',unknownRelations.length,'發現其他未確認關聯，為避免帳務斷鏈已停止修復。');
    const mappedPayments=paymentDetails.map(({payment,transaction,issues})=>({id:clean(payment.id),date:payment.date||'',amount:num(payment.amount),fee:num(payment.fee),actualDebit:num(payment.actualDebit??payment.amount),bankId:clean(payment.bankAccountId||payment.bankId),bankName:state.banks.find((row)=>clean(row.id)===clean(payment.bankAccountId||payment.bankId))?.name||'',paymentMethod:payment.paymentMethod||'',feePayer:payment.feePayer||'',oldPayableId:clean(payment.payableId),bankTransaction:transaction?{id:clean(transaction.id),date:transaction.date||'',amount:num(transaction.amount),payableAmount:num(transaction.payableAmount),fee:num(transaction.fee),actualDebit:num(transaction.actualDebit??transaction.amount),bankId:clean(transaction.bankAccountId||transaction.bankId),sourceId:clean(transaction.sourceId),sourceNo:transaction.sourceNo||''}:null,issues}));
    return {duplicatePayableId:id,allowed:blockers.length===0,blockers,duplicatePayable:{id,payableNo:duplicate.payableNo||duplicate.number||duplicate.sourceNo||'',vendorName:vendorName(duplicate),projectName:duplicate.projectName||state.projects?.find((row)=>clean(row.id)===clean(duplicate.project))?.name||'',sourceType:String(duplicate.sourceType||''),sourceId:clean(duplicate.sourceId),usageIds:[...duplicateUsageIds],amount:num(duplicate.amount),paid:num(duplicate.paid),createdAt:duplicate.createdAt||'',updatedAt:duplicate.updatedAt||''},mergedPayable:merged?{id:clean(merged.id),payableNo:merged.payableNo||merged.number||merged.sourceNo||'',vendorName:vendorName(merged),projectName:merged.projectName||state.projects?.find((row)=>clean(row.id)===clean(merged.project))?.name||'',sourceType:String(merged.sourceType||''),sourceId:clean(merged.sourceId),usageIds:mergedUsageIds,amount:num(merged.amount),paid:num(merged.paid),fee:num(merged.fee),createdAt:merged.createdAt||'',updatedAt:merged.updatedAt||''}:null,materialUsages:materialUsages.map((row)=>({id:clean(row.id),materialName:row.materialName||state.materials?.find((material)=>clean(material.id)===clean(row.material||row.materialId))?.name||'',projectName:row.projectName||state.projects?.find((project)=>clean(project.id)===clean(row.project||row.projectId))?.name||'',amount:num(row.amount??num(row.quantity)*num(row.unitPrice)),currentPayableId:clean(row.payableId)})),truePayments:mappedPayments,legacySummary:legacySummary?{id:clean(legacySummary.id),amount:num(legacySummary.amount),fee:num(legacySummary.fee),actualDebit:num(legacySummary.actualDebit??legacySummary.amount),bankTransactionId:clean(legacySummary.bankTransactionId),legacy:legacySummary.legacy===true}:null,testInvoice:testInvoice?{id:clean(testInvoice.id),invoiceNo:String(testInvoice.invoiceNumber||testInvoice.invoiceNo||testInvoice.number||''),date:testInvoice.invoiceDate||testInvoice.date||'',status:invoiceStatus(testInvoice.status,testInvoice.invoiceNumber||testInvoice.invoiceNo||testInvoice.number),amount:num(testInvoice.grossAmount??testInvoice.total??testInvoice.netAmount??testInvoice.amount)}:null,materialTotal,truePaymentTotal,trueFeeTotal,bankActualDebitTotal,bankTransactionCount:matchedTransactionIds.size,orphanPayableIds,unknownRelationCount:unknownRelations.length};
  }
  async function repairMergedPayableHistory(duplicatePayableId, confirmation={}) {
    await load();
    const id=clean(duplicatePayableId),reason=clean(confirmation?.reason),preview=mergedPayableRepairPreview(id);
    if(confirmation?.confirmed!==true)throw new Error('必須明確確認舊帳與進項發票為測試／歷史殘留資料。');
    if(!reason)throw new Error('請輸入歷史帳務修復原因。');
    if(preview.allowed!==true)throw new Error(`此筆歷史帳務不可安全修復：${preview.blockers.map((row)=>row.message).join(' ')}`);
    const snapshot=JSON.parse(JSON.stringify(state)),fingerprint=(value)=>JSON.stringify(value),omit=(row,keys)=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!keys.includes(key))),mergedId=preview.mergedPayable.id,legacyId=preview.legacySummary.id,invoiceId=preview.testInvoice.id,truePaymentIds=new Set(preview.truePayments.map((row)=>row.id)),transactionIds=new Set(preview.truePayments.map((row)=>row.bankTransaction?.id).filter(Boolean)),usageIds=new Set(preview.materialUsages.map((row)=>row.id)),oldOwnerIds=new Set(preview.orphanPayableIds),bankFingerprint=fingerprint(state.banks),beforeCounts={payments:state.payments.length,bankTransactions:state.bankTransactions.length,materialUsages:state.materialUsages.length,invoices:state.invoices.length,payables:state.payables.length},otherFingerprints={payments:fingerprint(state.payments.filter((row)=>!truePaymentIds.has(clean(row.id))&&clean(row.id)!==legacyId)),bankTransactions:fingerprint(state.bankTransactions.filter((row)=>!transactionIds.has(clean(row.id)))),materialUsages:fingerprint(state.materialUsages.filter((row)=>!usageIds.has(clean(row.id)))),invoices:fingerprint(state.invoices.filter((row)=>clean(row.id)!==invoiceId)),payables:fingerprint(state.payables.filter((row)=>![id,mergedId].includes(clean(row.id))))},paymentBefore=new Map(state.payments.filter((row)=>truePaymentIds.has(clean(row.id))).map((row)=>[clean(row.id),fingerprint(omit(row,['payableId']))])),transactionBefore=new Map(state.bankTransactions.filter((row)=>transactionIds.has(clean(row.id))).map((row)=>[clean(row.id),fingerprint(omit(row,['payableId','sourceNo']))])),usageBefore=new Map(state.materialUsages.filter((row)=>usageIds.has(clean(row.id))).map((row)=>[clean(row.id),fingerprint(omit(row,['payableId']))]));
    const restore=async()=>{state=snapshot;try{if(!db)db=await openDB();if(db)await dbSet(STATE_KEY,state)}catch(_){/* 持久層採最大努力還原，原始錯誤優先 */}try{localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state))}catch(_){/* 緊急備份採最大努力還原，原始錯誤優先 */}};
    try {
      state.payments.forEach((row)=>{if(truePaymentIds.has(clean(row.id)))row.payableId=mergedId});
      state.bankTransactions.forEach((row)=>{if(transactionIds.has(clean(row.id))){row.payableId=mergedId;row.sourceNo=preview.mergedPayable.payableNo}});
      state.payments=state.payments.filter((row)=>clean(row.id)!==legacyId);
      state.materialUsages.forEach((row)=>{if(usageIds.has(clean(row.id)))row.payableId=mergedId});
      state.invoices=state.invoices.filter((row)=>clean(row.id)!==invoiceId);
      state.payables=state.payables.filter((row)=>clean(row.id)!==id);
      const merged=state.payables.find((row)=>clean(row.id)===mergedId);
      if(!merged)throw new Error('修復過程找不到要保留的合併應付帳款。');
      const mergedAmount=num(merged.amount),now=new Date().toISOString();
      syncPayableSummary(merged,now);
      if(num(merged.amount)!==mergedAmount||num(merged.amount)!==preview.mergedPayable.amount)throw new Error('合併應付金額發生非預期變動。');
      if(num(merged.paid)!==preview.truePaymentTotal||num(merged.fee)!==preview.trueFeeTotal)throw new Error('重新彙總後的已付金額或手續費不一致。');
      if(state.payments.length!==beforeCounts.payments-1||state.bankTransactions.length!==beforeCounts.bankTransactions||state.materialUsages.length!==beforeCounts.materialUsages||state.invoices.length!==beforeCounts.invoices-1||state.payables.length!==beforeCounts.payables-1)throw new Error('修復後的資料筆數不符合預期。');
      if(fingerprint(state.banks)!==bankFingerprint)throw new Error('銀行帳戶金額發生非預期變動。');
      if(fingerprint(state.payments.filter((row)=>!truePaymentIds.has(clean(row.id))))!==otherFingerprints.payments)throw new Error('其他付款紀錄發生非預期變動。');
      if(fingerprint(state.bankTransactions.filter((row)=>!transactionIds.has(clean(row.id))))!==otherFingerprints.bankTransactions)throw new Error('其他銀行交易發生非預期變動。');
      if(fingerprint(state.materialUsages.filter((row)=>!usageIds.has(clean(row.id))))!==otherFingerprints.materialUsages)throw new Error('其他材料紀錄發生非預期變動。');
      if(fingerprint(state.invoices)!==otherFingerprints.invoices)throw new Error('其他進項發票發生非預期變動。');
      if(fingerprint(state.payables.filter((row)=>clean(row.id)!==mergedId))!==otherFingerprints.payables)throw new Error('其他應付帳款發生非預期變動。');
      state.payments.filter((row)=>truePaymentIds.has(clean(row.id))).forEach((row)=>{if(clean(row.payableId)!==mergedId||fingerprint(omit(row,['payableId']))!==paymentBefore.get(clean(row.id)))throw new Error('真正付款除歸屬外發生非預期變動。')});
      state.bankTransactions.filter((row)=>transactionIds.has(clean(row.id))).forEach((row)=>{if(clean(row.payableId)!==mergedId||clean(row.sourceId)!==clean(state.payments.find((payment)=>clean(payment.bankTransactionId)===clean(row.id)||clean(row.sourceId)===clean(payment.id))?.id)||fingerprint(omit(row,['payableId','sourceNo']))!==transactionBefore.get(clean(row.id)))throw new Error('銀行交易除應付歸屬外發生非預期變動。')});
      state.materialUsages.filter((row)=>usageIds.has(clean(row.id))).forEach((row)=>{if(clean(row.payableId)!==mergedId||fingerprint(omit(row,['payableId']))!==usageBefore.get(clean(row.id)))throw new Error('材料紀錄除應付歸屬外發生非預期變動。')});
      if(state.payments.some((row)=>oldOwnerIds.has(clean(row.payableId))||clean(row.payableId)===id||clean(row.id)===legacyId))throw new Error('修復後仍有付款指向舊帳。');
      if(state.bankTransactions.some((row)=>oldOwnerIds.has(clean(row.payableId))||clean(row.payableId)===id))throw new Error('修復後仍有銀行交易指向舊帳。');
      if(state.materialUsages.some((row)=>usageIds.has(clean(row.id))&&clean(row.payableId)!==mergedId))throw new Error('修復後仍有材料指向舊帳。');
      if(state.payables.some((row)=>clean(row.id)===id)||state.invoices.some((row)=>clean(row.id)===invoiceId))throw new Error('舊帳或測試進項發票未完整清理。');
      const repairedPayments=state.payments.filter((row)=>clean(row.payableId)===mergedId),repairedTotal=repairedPayments.reduce((sum,row)=>sum+num(row.amount),0),repairedFee=repairedPayments.reduce((sum,row)=>sum+num(row.fee),0),repairedBankTotal=state.bankTransactions.filter((row)=>transactionIds.has(clean(row.id))).reduce((sum,row)=>sum+num(row.amount),0),repairedMaterialTotal=state.materialUsages.filter((row)=>usageIds.has(clean(row.id))).reduce((sum,row)=>sum+num(row.amount??num(row.quantity)*num(row.unitPrice)),0);
      if(repairedPayments.length!==truePaymentIds.size||repairedTotal!==preview.truePaymentTotal||repairedFee!==preview.trueFeeTotal)throw new Error('合併應付的真正付款彙總不正確。');
      if(repairedBankTotal!==preview.bankActualDebitTotal)throw new Error('銀行實際支出合計發生非預期變動。');
      if(repairedMaterialTotal!==preview.materialTotal)throw new Error('材料金額合計發生非預期變動。');
      await persist(`歷史合併帳務修復｜付款、材料與應付關聯整理｜原因：${reason}`);
      if(fingerprint(state.banks)!==bankFingerprint)throw new Error('儲存後銀行帳戶金額發生非預期變動。');
      return {...preview,reason,repairedPayableId:mergedId,removedLegacyPaymentCount:1,removedDuplicatePayableCount:1,removedTestInvoiceCount:1,remainingAmount:Math.max(0,preview.mergedPayable.amount-preview.truePaymentTotal)};
    } catch(error) {
      await restore();
      throw error;
    }
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
    const payment={id:paymentId,idempotencyKey:idempotencyKey||uid(),payableId:payable.id,date:values.date||businessDate(new Date(now)),amount,fee,actualDebit,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',feePayer,note:values.note||'',bankTransactionId:transactionId,createdAt:now,updatedAt:now};
    state.payments.unshift(payment);
    payable.paid=num(payable.paid)+amount;payable.bankId=bank.id;payable.payDate=payment.date;payable.fee=num(payable.fee)+fee;payable.feeParty=feePayer==='company'?'公司負擔':'收款人負擔';payable.status=payable.paid>=num(payable.amount)?'已付清':'部分付款';payable.updatedAt=now;
    bank.expense=num(bank.expense)+actualDebit;bank.balance=num(bank.openingBalance)+num(bank.income)-num(bank.expense);bank.updatedAt=now;
    state.bankTransactions.unshift({id:transactionId,date:payment.date,bankId:bank.id,bankAccountId:bank.id,type:'支出',direction:'out',category:'應付帳款付款',amount:actualDebit,payableAmount:amount,fee,actualDebit,feePayer,paymentMethod:payment.paymentMethod,sourceType:'payable_payment',sourceId:payment.id,payableId:payable.id,vendor:payable.vendor,vendorName:payable.vendorName||'',project:payable.project,projectName:payable.projectName||'',sourceNo:payable.payableNo||payable.sourceNo||'',description:`${payable.vendorName||payable.payableNo||'應付帳款'} 付款`,note:payment.note||`${payable.payableNo||''} 付款`,createdAt:now,updatedAt:now});
    await persist(`新增應付付款 ${payable.payableNo||payable.sourceNo||''}`); return payment;
  }
  function payablePaymentTransaction(payment) {
    return linkedBankTransaction(payment,['payable-payment','payable_payment'],'應付付款');
  }
  function payablePaymentMutationPlan(payment) {
    const transaction=strictExistingBankTransaction(payment,['payable-payment','payable_payment'],'應付付款'),paymentBank=strictBankReference(payment,'應付付款'),transactionBank=strictBankReference(transaction,'應付付款銀行流水');
    if(paymentBank.id!==transactionBank.id)throw new Error('應付付款與銀行流水的帳戶不一致，已停止操作');
    if(!hasAccountingValue(payment,'actualDebit'))throw new Error('應付付款缺少可驗證的實際扣款金額，已停止操作');
    const actualDebit=num(payment.actualDebit);
    if(num(transaction.amount)!==actualDebit||hasAccountingValue(transaction,'actualDebit')&&num(transaction.actualDebit)!==actualDebit)throw new Error('應付付款與銀行流水的扣款金額不一致，已停止操作');
    if(hasAccountingValue(transaction,'payableAmount')&&num(transaction.payableAmount)!==num(payment.amount))throw new Error('應付付款與銀行流水的本金不一致，已停止操作');
    if(hasAccountingValue(transaction,'fee')&&num(transaction.fee)!==num(payment.fee))throw new Error('應付付款與銀行流水的手續費不一致，已停止操作');
    if(hasAccountingValue(transaction,'payableId')&&String(transaction.payableId)!==String(payment.payableId||''))throw new Error('應付付款與銀行流水的應付關聯不一致，已停止操作');
    if(String(transaction.date||'')!==String(payment.date||''))throw new Error('應付付款與銀行流水的日期不一致，已停止操作');
    return {transaction,bank:transactionBank.bank,amount:num(transaction.amount)};
  }
  function adjustBankExpense(bank, delta, now) {
    if(!bank||!delta)return;
    bank.expense=Math.max(0,num(bank.expense)+delta);bank.balance=num(bank.openingBalance)+num(bank.income)-num(bank.expense);bank.updatedAt=now;
  }
  function syncPayableSummary(payable, now) {
    const history=state.payments.filter((row)=>row.payableId===payable.id),paid=history.reduce((sum,row)=>sum+num(row.amount),0),fee=history.reduce((sum,row)=>sum+num(row.fee),0),latest=[...history].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
    payable.paid=Math.min(num(payable.amount),paid);payable.fee=fee;payable.bankId=latest?.bankAccountId||latest?.bankId||'';payable.payDate=latest?.date||'';payable.feeParty=latest?(latest.feePayer==='company'?'公司負擔':'收款人負擔'):'';payable.status=payable.paid>=num(payable.amount)&&num(payable.amount)>0?'已付清':payable.paid>0?'部分付款':'未付款';payable.updatedAt=now;
  }
  function syncPayableBankTransaction(payment, payable, now, existingTransaction) {
    const bankId=String(payment.bankAccountId||payment.bankId||''),bank=state.banks.find((row)=>row.id===bankId);if(!bank)throw new Error('請選擇付款銀行帳戶');
    const existing=existingTransaction===undefined?payablePaymentTransaction(payment):existingTransaction;if(existing){const previousBank=state.banks.find((row)=>row.id===(existing.bankAccountId||existing.bankId));adjustBankExpense(previousBank,-num(existing.amount),now)}
    const transaction=existing||{id:uid(),createdAt:now};
    Object.assign(transaction,{date:payment.date,bankId:bank.id,bankAccountId:bank.id,type:'支出',direction:'out',category:'應付帳款付款',amount:num(payment.actualDebit),payableAmount:num(payment.amount),fee:num(payment.fee),actualDebit:num(payment.actualDebit),feePayer:payment.feePayer,paymentMethod:payment.paymentMethod||'銀行轉帳',sourceType:'payable_payment',sourceId:payment.id,payableId:payable.id,vendor:payable.vendor,vendorName:payable.vendorName||'',project:payable.project,projectName:payable.projectName||'',sourceNo:payable.payableNo||payable.sourceNo||'',description:`${payable.vendorName||payable.payableNo||'應付帳款'} 付款`,note:payment.note||`${payable.payableNo||''} 付款`,updatedAt:now});
    if(!existing)state.bankTransactions.unshift(transaction);payment.bankId=bank.id;payment.bankAccountId=bank.id;payment.bankTransactionId=transaction.id;adjustBankExpense(bank,num(payment.actualDebit),now);return transaction;
  }
  async function updatePayablePayment(id, values={}) {
    await load();const paymentMatches=state.payments.filter((row)=>String(row.id||'')===String(id||''));if(paymentMatches.length!==1)throw new Error(paymentMatches.length?'付款紀錄編號不唯一，已停止修改':'找不到付款紀錄');const payment=paymentMatches[0];if(payment.legacy)throw new Error('歷史付款紀錄不可直接修改');
    const payableMatches=state.payables.filter((row)=>String(row.id||'')===String(payment.payableId||''));if(payableMatches.length!==1)throw new Error(payableMatches.length?'對應應付帳款不唯一，已停止修改':'找不到這筆應付帳款');const payable=payableMatches[0];
    const otherPaid=state.payments.filter((row)=>row!==payment&&row.payableId===payable.id).reduce((sum,row)=>sum+num(row.amount),0),amount=Math.round(num(values.amount)),fee=values.fee===undefined?num(payment.fee):Math.max(0,Math.round(num(values.fee))),feePayer=values.feePayer==='recipient'?'recipient':'company',bankId=String(values.bankAccountId||values.bankId||'');
    if(amount<=0||otherPaid+amount>num(payable.amount))throw new Error('本次付款不可超過未付金額');if(feePayer==='recipient'&&fee>amount)throw new Error('收款人負擔的手續費不可高於本次付款');strictBankReference({bankId},'新的付款銀行帳戶');
    const plan=payablePaymentMutationPlan(payment),snapshot=JSON.parse(JSON.stringify(state)),now=new Date().toISOString(),actualDebit=feePayer==='company'?amount+fee:amount;
    try {
      Object.assign(payment,{date:values.date||payment.date||businessDate(new Date(now)),amount,fee,actualDebit,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||payment.paymentMethod||'銀行轉帳',feePayer,note:values.note===undefined?payment.note:String(values.note||''),updatedAt:now});
      syncPayableBankTransaction(payment,payable,now,plan.transaction);syncPayableSummary(payable,now);await persist(`修改應付付款 ${payable.payableNo||''}`);return payment;
    } catch(error) { await restoreBankLinkedMutation(snapshot,error);throw error; }
  }
  async function deletePayablePayment(id) {
    await load();const paymentMatches=state.payments.filter((row)=>String(row.id||'')===String(id||''));if(paymentMatches.length!==1)throw new Error(paymentMatches.length?'付款紀錄編號不唯一，已停止刪除':'找不到付款紀錄');const payment=paymentMatches[0];if(payment.legacy)throw new Error('歷史付款紀錄不可直接刪除');
    const payableMatches=state.payables.filter((row)=>String(row.id||'')===String(payment.payableId||''));if(payableMatches.length!==1)throw new Error(payableMatches.length?'對應應付帳款不唯一，已停止刪除':'找不到這筆應付帳款');const payable=payableMatches[0],plan=payablePaymentMutationPlan(payment),snapshot=JSON.parse(JSON.stringify(state)),now=new Date().toISOString();
    try {
      adjustBankExpense(plan.bank,-plan.amount,now);state.bankTransactions=state.bankTransactions.filter((row)=>row!==plan.transaction);state.payments=state.payments.filter((row)=>row!==payment);syncPayableSummary(payable,now);await persist(`刪除應付付款 ${payable.payableNo||''}`);return true;
    } catch(error) { await restoreBankLinkedMutation(snapshot,error);throw error; }
  }
  const salaryAdjustmentFields = [
    ['manualFuel','額外油資','加項'],['meal','餐費','加項'],['other','其他加項','加項'],['overtime','加班','加項'],['bonus','獎金','加項'],['allowance','其他津貼','加項'],
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
    salaryAdjustmentFields.forEach(([field,label,direction])=>{const record=sorted.find((row)=>num(row[field])!==0),value=num(record?.[field]);if(!value)return;const fieldNote=field==='other'?record.otherNote:field==='deduction'?record.deductionNote:'',content=['other','deduction'].includes(field)?String(fieldNote||'').trim()||String(record.payrollAdjustmentNote||'').trim()||label:record.payrollAdjustmentNote||label;push(`adjustment:${field}`,{id:`${record.id}-${field}`,date:record.updatedAt?.slice(0,10)||'',type:label,projectId:'',projectName:'—',content,quantity:0,quantityLabel:'',rate:0,rateLabel:'',amount:direction==='扣項'?-Math.abs(value):Math.abs(value),sourceType:'payroll-adjustment',sourceId:record.id})});
    return rows.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.type).localeCompare(String(b.type),'zh-Hant'));
  }
  function monthlyPayrollGroups() {
    const groups=new Map();
    state.payroll.forEach((row)=>{const employeeId=payrollEmployeeId(row),month=String(row.month||''),key=`${employeeId}__${month}`;if(!groups.has(key))groups.set(key,{key,id:key,employeeId,month,records:[]});groups.get(key).records.push(row)});
    return [...groups.values()].map((group)=>{
      const records=[...group.records].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))),primary=records[0],employee=state.employees.find((row)=>String(row.id)===group.employeeId);
      const sources=monthlySalarySources(group.employeeId,group.month,records),sourceTotal=sources.reduce((sum,row)=>sum+num(row.amount),0),sourceBase=sources.filter((row)=>['點工','出勤'].includes(row.type)).reduce((sum,row)=>sum+num(row.amount),0),sourceCommission=sources.filter((row)=>row.type==='抽成').reduce((sum,row)=>sum+num(row.amount),0),sourceFuel=sources.filter((row)=>row.type==='油費').reduce((sum,row)=>sum+num(row.amount),0);
      const total=sources.length?Math.max(0,sourceTotal):Math.max(0,...records.map((row)=>num(row.total))),baseSalary=sourceBase||Math.max(0,...records.map((row)=>num(row.baseSalary))),commission=sourceCommission||Math.max(0,...records.map((row)=>num(row.commission)));
      const adjustments=Object.fromEntries(salaryAdjustmentFields.map(([field])=>[field,num(records.find((row)=>num(row[field])!==0)?.[field])])),payrollAdjustmentNote=String(records.find((row)=>String(row.payrollAdjustmentNote||'').trim())?.payrollAdjustmentNote||''),otherNote=String(records.find((row)=>String(row.otherNote||'').trim())?.otherNote||''),deductionNote=String(records.find((row)=>String(row.deductionNote||'').trim())?.deductionNote||'');
      const view={...group,recordIds:records.map((row)=>row.id),primaryPayrollId:primary.id,employee:group.employeeId,employeeName:employee?.name||primary.employeeName||'—',total,baseSalary,commission,sourceFuel,fuel:sourceFuel+adjustments.manualFuel,...adjustments,payrollAdjustmentNote,otherNote,deductionNote,sources};
      const summary=salaryPaymentSummary(view);return {...view,...summary,status:summary.status};
    }).sort((a,b)=>String(b.month).localeCompare(String(a.month))||String(a.employeeName).localeCompare(String(b.employeeName),'zh-Hant'));
  }
  function salaryPaymentSummary(payroll) {
    return payrollPaymentTruth(payroll);
  }
  function payrollAdjustmentAmount(value, label) {
    const text=String(value??'').trim();if(!text)return 0;const amount=Number(text);
    if(!Number.isFinite(amount)||amount<0)throw new Error(`${label}必須是 0 以上的有限數字`);
    return Math.round(amount);
  }
  async function updatePayrollAdjustments(groupKey, values={}) {
    await load();
    const reference=String(groupKey||''),group=monthlyPayrollGroups().find((row)=>row.key===reference||row.recordIds.some((id)=>String(id)===reference));
    let employeeId=group?.employeeId||'',month=group?.month||'';
    if(!group){const divider=reference.lastIndexOf('__');if(divider>0){employeeId=reference.slice(0,divider);month=reference.slice(divider+2)}}
    if(!employeeId||!/^\d{4}-\d{2}$/.test(month))throw new Error('找不到薪資月份或員工');
    const records=state.payroll.filter((row)=>payrollEmployeeId(row)===employeeId&&String(row.month||'')===month),truth=payrollPaymentTruth({employee:employeeId,month,recordIds:records.map((row)=>row.id),total:Math.max(0,...records.map((row)=>num(row.total)))});
    if(truth.paid>0||truth.hasVerifiedPayment)throw new Error('此月份已有薪資付款，請先刪除／沖回薪資付款後再調整薪資。');
    const normalized=Object.fromEntries(salaryAdjustmentFields.map(([field,label])=>[field,payrollAdjustmentAmount(values[field],label)])),payrollAdjustmentNote=String(values.adjustmentNote??values.payrollAdjustmentNote??'').trim(),otherNote=String(values.otherNote??records.find((row)=>String(row.otherNote||'').trim())?.otherNote??'').trim(),deductionNote=String(values.deductionNote??records.find((row)=>String(row.deductionNote||'').trim())?.deductionNote??'').trim();
    const employeeRecord=state.employees.find((row)=>String(row.id)===employeeId),employeeValue=records[0]?.employee??records[0]?.employeeId??employeeRecord?.id;
    if(employeeValue===undefined||employeeValue===null||employeeValue==='')throw new Error('找不到員工資料');
    let payroll=state.payroll.find((row)=>payrollEmployeeId(row)===employeeId&&String(row.month||'')===month&&row.status!=='已付款')||records[0];
    if(!payroll){payroll={id:uid(),month,employee:employeeValue,days:0,hours:0,baseSalary:0,commission:0,fuel:0,manualFuel:0,meal:0,other:0,overtime:0,bonus:0,allowance:0,advance:0,laborInsurance:0,incomeTax:0,deduction:0,total:0,payDate:'',bankId:'',paymentTransactionId:'',paidAt:'',status:'未付款',note:'由請款單、抽成與點工自動彙整',payrollAdjustmentNote:'',otherNote:'',deductionNote:'',createdAt:new Date().toISOString()};state.payroll.unshift(payroll)}
    if(payroll.status==='已付款'){Object.assign(payroll,{status:'未付款',paidAmount:0,payDate:'',paidAt:'',paymentTransactionId:'',bankId:''})}
    records.filter((row)=>row!==payroll).forEach((row)=>{salaryAdjustmentFields.forEach(([field])=>{row[field]=0});row.payrollAdjustmentNote='';row.otherNote='';row.deductionNote=''});
    Object.assign(payroll,normalized,{payrollAdjustmentNote,otherNote,deductionNote});rebuildPayrollFor(month,employeeValue);
    await persist(`更新薪資調整 ${month}`);
    return monthlyPayrollGroups().find((row)=>row.employeeId===employeeId&&row.month===month)||null;
  }
  function salaryPaymentTransaction(payment) {
    return state.bankTransactions.find((row)=>row.id===payment.bankTransactionId||(row.sourceType==='salary_payment'&&row.sourceId===payment.id));
  }
  function salaryPaymentDeletionPlan(payment) {
    const paymentId=String(payment?.id||''),transactionId=String(payment?.bankTransactionId||''),sourceMatches=state.bankTransactions.filter((row)=>row.sourceType==='salary_payment'&&(String(row.sourceId||'')===paymentId||String(row.salaryPaymentId||'')===paymentId));
    if(!paymentId)throw new Error('薪資付款缺少可驗證的系統編號，為避免帳務不一致已停止刪除');
    let transaction;
    if(transactionId){
      const idMatches=state.bankTransactions.filter((row)=>String(row.id||'')===transactionId),candidates=state.bankTransactions.filter((row)=>String(row.id||'')===transactionId||sourceMatches.includes(row));
      if(idMatches.length!==1)throw new Error(idMatches.length?'薪資付款對應到多筆相同編號的銀行流水，為避免帳務不一致已停止刪除':'薪資付款找不到指定的銀行流水，為避免帳務不一致已停止刪除');
      if(candidates.length!==1)throw new Error('薪資付款對應到多筆銀行流水，為避免重複沖回已停止刪除');
      transaction=idMatches[0];
    }else{
      if(sourceMatches.length!==1)throw new Error(sourceMatches.length?'薪資付款對應到多筆銀行流水，為避免重複沖回已停止刪除':'薪資付款找不到銀行流水，為避免帳務不一致已停止刪除');
      transaction=sourceMatches[0];
    }
    const sourceMatchesPayment=transaction.sourceType==='salary_payment'&&(String(transaction.sourceId||'')===paymentId||String(transaction.salaryPaymentId||'')===paymentId);
    if(!sourceMatchesPayment)throw new Error('銀行流水與薪資付款的來源不一致，為避免帳務不一致已停止刪除');
    const paymentBankIds=[payment.bankAccountId,payment.bankId].map((value)=>String(value||'')).filter(Boolean),transactionBankIds=[transaction.bankAccountId,transaction.bankId].map((value)=>String(value||'')).filter(Boolean),uniquePaymentBankIds=[...new Set(paymentBankIds)],uniqueTransactionBankIds=[...new Set(transactionBankIds)];
    if(uniquePaymentBankIds.length!==1||uniqueTransactionBankIds.length!==1||uniquePaymentBankIds[0]!==uniqueTransactionBankIds[0])throw new Error('薪資付款與銀行流水的帳戶不一致，為避免帳務不一致已停止刪除');
    const bankMatches=state.banks.filter((row)=>String(row.id||'')===uniquePaymentBankIds[0]);
    if(bankMatches.length!==1)throw new Error('薪資付款無法唯一找到銀行帳戶，為避免帳務不一致已停止刪除');
    const hasActualDebit=payment.actualDebit!==undefined&&payment.actualDebit!==null&&payment.actualDebit!=='';
    const actualDebit=hasActualDebit?num(payment.actualDebit):num(payment.amount)+(payment.feePayer==='recipient'?0:Math.max(0,num(payment.fee)));
    if(actualDebit<=0||num(transaction.amount)!==actualDebit||(transaction.actualDebit!==undefined&&transaction.actualDebit!==null&&transaction.actualDebit!==''&&num(transaction.actualDebit)!==actualDebit))throw new Error('薪資付款與銀行流水的扣款金額不一致，為避免帳務不一致已停止刪除');
    return {transaction,bank:bankMatches[0],actualDebit};
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
    const bank=state.banks.find((row)=>row.id===String(values.bankAccountId||values.bankId||''));if(!bank)throw new Error('請選擇薪資付款銀行帳戶');const now=new Date().toISOString(),payment={id:uid(),idempotencyKey:idempotencyKey||uid(),payrollId:payroll.id,date:values.date||businessDate(new Date(now)),amount,fee,feePayer,actualDebit,bankId:bank.id,bankAccountId:bank.id,paymentMethod:values.paymentMethod||'銀行轉帳',note:String(values.note||''),createdAt:now,updatedAt:now};
    state.salaryPayments.unshift(payment);syncSalaryBankTransaction(payment,payroll,now);syncSalarySummary(payroll,now);await persist(`新增薪資付款 ${payroll.month||''}`);return payment;
  }
  async function updateSalaryPayment(id, values={}) {
    await load();const payment=state.salaryPayments.find((row)=>row.id===id);if(!payment)throw new Error('找不到薪資付款紀錄');const payroll=state.payroll.find((row)=>row.id===payment.payrollId);if(!payroll)throw new Error('找不到薪資紀錄');const summary=salaryPaymentSummary(payroll),otherPaid=summary.history.filter((row)=>row!==payment).reduce((sum,row)=>sum+num(row.amount),0),amount=Math.round(num(values.amount)),fee=values.fee===undefined?num(payment.fee):Math.max(0,Math.round(num(values.fee))),feePayer=(values.feePayer===undefined?payment.feePayer:values.feePayer)==='recipient'?'recipient':'company',actualDebit=feePayer==='company'?amount+fee:amount,bankId=String(values.bankAccountId||values.bankId||'');if(amount<=0||otherPaid+amount>summary.total)throw new Error('本次付款不可超過未付薪資');if(feePayer==='recipient'&&fee>amount)throw new Error('員工負擔的手續費不可高於本次付款');if(!state.banks.some((row)=>row.id===bankId))throw new Error('請選擇薪資付款銀行帳戶');
    const now=new Date().toISOString();Object.assign(payment,{date:values.date||payment.date||businessDate(new Date(now)),amount,fee,feePayer,actualDebit,bankId,bankAccountId:bankId,paymentMethod:values.paymentMethod||payment.paymentMethod||'銀行轉帳',note:values.note===undefined?payment.note:String(values.note||''),updatedAt:now});syncSalaryBankTransaction(payment,payroll,now);syncSalarySummary(payroll,now);await persist(`修改薪資付款 ${payroll.month||''}`);return payment;
  }
  async function deleteSalaryPayment(id) {
    await load();const payment=state.salaryPayments.find((row)=>row.id===id);if(!payment)throw new Error('找不到薪資付款紀錄');const payroll=state.payroll.find((row)=>row.id===payment.payrollId);if(!payroll)throw new Error('找不到薪資紀錄');const plan=salaryPaymentDeletionPlan(payment),snapshot=JSON.parse(JSON.stringify(state)),now=new Date().toISOString();
    try {
      adjustBankExpense(plan.bank,-plan.actualDebit,now);state.bankTransactions=state.bankTransactions.filter((row)=>row!==plan.transaction);state.salaryPayments=state.salaryPayments.filter((row)=>row!==payment);syncSalarySummary(payroll,now);await persist(`刪除薪資付款 ${payroll.month||''}`);return true;
    } catch (error) {
      state=snapshot;
      try {
        if(!db){try{db=await openDB()}catch(_){db=null}}
        if(db)await dbSet(STATE_KEY,state);
        localStorage.setItem(EMERGENCY_KEY,JSON.stringify(state));
        window.KuSheLegacyData?.refresh();
      } catch (rollbackError) { error.rollbackError=rollbackError; }
      throw error;
    }
  }
  async function updateBillingInvoice(id, values = {}) {
    await load(); const billing=state.billings.find((row)=>row.id===id);if(!billing)throw new Error('找不到請款單');
    const now=new Date().toISOString(),choice=values.invoiceChoice==='invoice_required'?'invoice_required':'no_invoice',number=choice==='no_invoice'?'':String(values.invoiceNo||'').trim(),date=choice==='no_invoice'?'':values.invoiceDate||billing.date||businessDate(new Date(now));
    const nextInvoiceStatus=choice==='no_invoice'?'no_invoice':number?'invoiced':'invoice_pending';
    const totals=calculateBilling({lines:billing.lines||[],taxMode:billing.taxMode,invoiceStatus:nextInvoiceStatus,retentionMode:billing.retentionMode,retentionRate:billing.retentionRate,retentionBase:billing.retentionBase||'taxIncluded',retentionCustom:!billing.retentionBase&&billing.retentionMode==='custom'?billing.retention:undefined});
    const ar=state.receivables.find((row)=>row.id===billing.receivableId||row.billingId===billing.id||String(row.sourceNo||'')===String(billing.number||''));
    if(ar&&num(ar.received)>totals.receivable)throw new Error('切換後應收金額低於既有收款，請先確認收款紀錄');
    Object.assign(billing,{invoiceStatus:nextInvoiceStatus,hasInvoice:nextInvoiceStatus!=='no_invoice',invoiceNo:number,invoiceDate:date,amount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionBase:totals.retentionBase,retentionStatus:retentionState(totals.retention,billing.retentionReceived,billing.retentionStatus),remainingRetention:Math.max(0,totals.retention-num(billing.retentionReceived)),total:totals.receivable,updatedAt:now});
    if(ar){Object.assign(ar,{invoiceNo:number,invoiceStatus:nextInvoiceStatus,taxMode:billing.taxMode,untaxedAmount:totals.untaxed,tax:totals.tax,grossTotal:totals.grossTotal,preTaxAmount:totals.untaxed,taxAmount:totals.tax,taxIncludedAmount:totals.grossTotal,retention:totals.retention,retentionAmount:totals.retention,retentionBase:totals.retentionBase,retentionStatus:retentionState(totals.retention,ar.retentionReceived,ar.retentionStatus),remainingRetention:Math.max(0,totals.retention-num(ar.retentionReceived)),amount:totals.receivable,status:num(ar.received)>=totals.receivable&&totals.receivable>0?'已收':num(ar.received)>0?'部分收款':'未收',updatedAt:now})}
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
  const CUSTOMER_DELETE_BLOCKERS = [
    ['projects','案場'],
    ['quotations','報價單'],
    ['quotationPrices','價格歷史'],
    ['quotationTemplates','報價模板'],
    ['billings','請款單'],
    ['receivables','應收'],
    ['invoices','發票'],
    ['dailyLogs','每日施工'],
    ['attendance','出勤'],
    ['commissions','抽成'],
    ['materialUsages','材料使用'],
    ['projectCosts','案場成本'],
    ['payables','應付']
  ];
  function customerReferenceMatches(row, customer) {
    if (!row || typeof row !== 'object') return false;
    const referenceIds = [row.customerId,row.customer]
      .filter((value) => (typeof value === 'string' || typeof value === 'number') && clean(value));
    if (referenceIds.length) return referenceIds.some((value) => clean(value) === String(customer.id));
    return [row.customerName,row.customerLabel].some((value) => clean(value) && sameName(value,customer.name));
  }
  function customerDeletePreview(customerId) {
    const id=clean(customerId),customer=state?.customers?.find((row)=>String(row.id)===id);
    const counts=Object.fromEntries(CUSTOMER_DELETE_BLOCKERS.map(([key])=>[key,0]));
    counts.quotationPublicNotePresets=0;
    if(customer){
      CUSTOMER_DELETE_BLOCKERS.forEach(([key])=>{counts[key]=(state[key]||[]).filter((row)=>customerReferenceMatches(row,customer)).length});
      const presets=Array.isArray(state.settings?.quotationPublicNotePresets)?state.settings.quotationPublicNotePresets:[];
      counts.quotationPublicNotePresets=presets.filter((row)=>customerReferenceMatches(row,customer)).length;
    }
    const labels=new Map([...CUSTOMER_DELETE_BLOCKERS,['quotationPublicNotePresets','常用對外備註']]);
    const blockers=Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=>({key,label:labels.get(key),count}));
    return {customerId:id,customerName:customer?.name||'',deletable:Boolean(customer)&&blockers.length===0,blockers,counts};
  }
  const customerDeleteBlockedMessage = (preview) => `此客戶仍有關聯資料，不能刪除：${preview.blockers.map((row)=>`${row.label} ${row.count} 筆`).join('、')}`;
  async function deleteCustomer(customerId) {
    await load();
    const id=clean(customerId),customer=state.customers.find((row)=>String(row.id)===id);
    if(!customer)throw new Error('找不到客戶資料');
    const preview=customerDeletePreview(id);
    if(preview.deletable!==true)throw new Error(customerDeleteBlockedMessage(preview));
    const previousCustomers=state.customers,previousMeta={...state.meta},previousAudit=[...state.audit];
    state.customers=state.customers.filter((row)=>row!==customer);
    try{await persist(`刪除客戶 ${customer.name}`)}
    catch(error){state.customers=previousCustomers;state.meta=previousMeta;state.audit=previousAudit;throw error}
    return true;
  }
  const PROJECT_DELETE_BLOCKERS = [
    ['quotations','報價單'],
    ['quotationPrices','價格歷史'],
    ['quotationTemplates','報價模板'],
    ['dailyLogs','每日施工'],
    ['dailyItemPresets','施工項目預設'],
    ['attendance','出勤／點工'],
    ['commissions','業績／抽成'],
    ['billings','請款單'],
    ['receivables','應收'],
    ['invoices','發票'],
    ['materialUsages','材料使用'],
    ['projectCosts','案場成本'],
    ['payables','應付'],
    ['retentionReceipts','保留款收回'],
    ['bankTransactions','銀行交易'],
    ['calendar','行事曆／排程']
  ];
  function projectReferenceMatches(row, project) {
    if (!row || typeof row !== 'object') return false;
    const referenceIds = [row.projectId,row.project]
      .filter((value) => (typeof value === 'string' || typeof value === 'number') && clean(value));
    if (referenceIds.length) return referenceIds.some((value) => clean(value) === String(project.id));
    return [row.projectName,row.projectLabel].some((value) => clean(value) && sameName(value,project.name));
  }
  function legacyProjectItemPriceCount(project) {
    const prices=state.projectItemPrices;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return 0;
    return Object.keys(prices).filter((key) => {
      const projectKey=clean(String(key).split('::')[0]);
      return projectKey && (projectKey===String(project.id)||sameName(projectKey,project.name));
    }).length;
  }
  function projectDeletePreview(projectId) {
    const id=clean(projectId),project=state?.projects?.find((row)=>String(row.id)===id);
    const counts=Object.fromEntries(PROJECT_DELETE_BLOCKERS.map(([key])=>[key,0]));
    counts.legacyProjectItemPrices=0;
    if(project){
      PROJECT_DELETE_BLOCKERS.forEach(([key])=>{counts[key]=(Array.isArray(state[key])?state[key]:[]).filter((row)=>projectReferenceMatches(row,project)).length});
      counts.legacyProjectItemPrices=legacyProjectItemPriceCount(project);
    }
    const labels=new Map([...PROJECT_DELETE_BLOCKERS,['legacyProjectItemPrices','舊版案場價格']]);
    const blockers=Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=>({key,label:labels.get(key),count}));
    const customerId=project?clean(project.customerId||project.customer):'',customer=state?.customers?.find((row)=>String(row.id)===customerId);
    return {projectId:id,projectName:project?.name||'',customerId,customerName:customer?.name||project?.customerName||'',deletable:Boolean(project)&&blockers.length===0,blockers,counts};
  }
  const projectDeleteBlockedMessage = (preview) => `此案場仍有關聯資料，不能刪除：${preview.blockers.map((row)=>`${row.label} ${row.count} 筆`).join('、')}`;
  async function deleteProject(projectId) {
    await load();
    const id=clean(projectId),project=state.projects.find((row)=>String(row.id)===id);
    if(!project)throw new Error('找不到案場資料');
    const preview=projectDeletePreview(id);
    if(preview.deletable!==true)throw new Error(projectDeleteBlockedMessage(preview));
    const previousProjects=state.projects,previousMeta={...state.meta},previousAudit=[...state.audit];
    state.projects=state.projects.filter((row)=>row!==project);
    try{await persist(`刪除案場 ${project.name}`)}
    catch(error){state.projects=previousProjects;state.meta=previousMeta;state.audit=previousAudit;throw error}
    return true;
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
    const duplicate=state.employees.find((row)=>String(row.id)!==String(id)&&sameName(row.name,name));
    if(duplicate)throw new Error('已有同名員工，請直接編輯既有員工');
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
    Object.assign(row,{date:values.date||businessDate(new Date(now)),project:project.id,projectName:project.name,material:material.id,materialName:material.name||'',vendor:vendor.id,vendorName:vendor.name||'',quantity,unitPrice,amount:Math.round(quantity*unitPrice),unit:material.unit||'',model:material.model||'',note:clean(values.note),updatedAt:now,payableId:''});
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
    Object.assign(row,{date:values.date||businessDate(new Date(now)),project:project.id,projectName:project.name,category:clean(values.category)||'其他工程費用',description:clean(values.description),amount,vendor:vendor?.id||'',vendorName:vendor?.name||payeeName||'',createPayable:Boolean(values.createPayable),note:clean(values.note),updatedAt:now});
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
  function nextQuotationNumber(date = businessDate()) {
    const stem=`Q-${String(date).replaceAll('-','')}`,count=state.quotations.filter((row)=>String(row.number||'').startsWith(stem)).length+1;
    return `${stem}-${String(count).padStart(3,'0')}`;
  }
  function quotationPriceFor({item,customerId='',projectId='',date=''}) {
    const key=clean(item),at=date||businessDate();
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
    const backupValue=values.isBackupPrice,isBackupPrice=backupValue===true||['true','1','on'].includes(String(backupValue??'').toLowerCase());
    const row={id:uid(),scope,customerId:scope==='company'?'':values.customerId||'',projectId:scope==='project'?values.projectId||'':'',item,unit:clean(values.unit),price,isBackupPrice,effectiveDate:values.effectiveDate||businessDate(),createdSource:clean(values.createdSource)||'manual',createdAt:new Date().toISOString()};
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
    Object.assign(row,{customer:customer.id,customerName:customer.name,project:project.id,projectName:project.name,date:values.date||businessDate(new Date(now)),dueDate:values.dueDate||'',pricingMode:mode,lumpSumTotal,billingPlan:values.billingPlan||row.billingPlan||'one_time',billingMilestones:Array.isArray(row.billingMilestones)?row.billingMilestones:[],taxMode:values.taxMode==='含稅'?'含稅':'未稅',lines,amount:totals.amount,tax:totals.tax,total:totals.total,status:['草稿','已送出','已確認','作廢'].includes(values.status)?values.status:(row.status||'草稿'),internalNote:clean(values.internalNote),publicNote:clean(values.publicNote),note:clean(values.publicNote),sourceType:values.sourceType||row.sourceType||'manual',importTemplateId:values.importTemplateId||row.importTemplateId||'',updatedAt:now});
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
  window.KuSheERPStore = { load, getState: () => state, masterOptions, materialVendorOptions, payrollHistoryLock, payrollPaymentTruth, financialIntegrityAudit, financialIntegrityPhase2Audit, financialIntegrityPhase2RepairPreview, financialIntegrityPhase2RepairExecute, financialIntegrityRepairPreview, financialIntegrityRepairExecute, historicalCommissionRepairPreview, repairHistoricalCommissionData, orphanBillingTestCleanupPreview, cleanupOrphanBillingTestData, dailyLogPayrollDeleteLock, commissionBillingLink, saveCommission, deleteCommission, saveDailyBatch, deleteDailyBatch, dailyManualItems, unbilledWork, dailyWorkAmount, taxValues, grossFromUntaxed, calculateBilling, nextBillingNumber, createBilling, billingEditable, billingDeletable, updateBilling, deleteBilling, receivableAccountingDeletePreview, deleteReceivableAccounting, billingReceiptState, addReceipt, updateReceipt, deleteReceipt, addRetentionReceipt, updateRetentionReceipt, deleteRetentionReceipt, nextPayableNumber, savePayable, payableDeletePreview, deletePayable, materialPayableTestCleanupPreview, cleanupMaterialPayableTestData, mergedPayableRepairPreview, repairMergedPayableHistory, addPayablePayment, updatePayablePayment, deletePayablePayment, monthlyPayrollGroups, salaryPaymentSummary, updatePayrollAdjustments, addSalaryPayment, updateSalaryPayment, deleteSalaryPayment, updateBillingInvoice, invoiceAmounts, invoiceRows, saveInvoice, saveCustomer, customerDeletePreview, deleteCustomer, saveProject, projectDeletePreview, deleteProject, saveEmployee, employeeUsage, deleteEmployee, saveMaterial, deleteMaterial, saveMaterialUsage, deleteMaterialUsage, saveProjectCost, deleteProjectCost, quotationTotals, nextQuotationNumber, quotationPriceFor, saveQuotationPrice, saveQuotationUnitPreset, quotationPublicNotePresets, saveQuotationPublicNotePreset, deleteQuotationPublicNotePreset, saveQuotation, setQuotationStatus, quotationUsage, deleteQuotation, cancelQuotationConfirmation, createQuotationRevision, saveQuotationTemplate, confirmedQuotationItems, projectPricingMode, contractSources, billedContractAmount, persist, num };
}());
