/* P39-3 isolated domain contract. NO production writer, cloud API, tax issuing or browser storage.
   Only accepts explicitly marked SYNTHETIC test data. Original billing/invoice ledger is immutable.
   Posting into the ERP must be a separate reviewed integration after cross-module regression. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KusheP393CandidateCore = api;
})(typeof window === 'object' ? window : {}, function () {
  'use strict';
  const FIXTURE = 'kushe-p39-3-synthetic-fixture-v1';
  const LEDGER = 'kushe-p39-3-allowance-candidate-v1';
  const NOTE = 'kushe-p39-3-note-revision-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const str = value => String(value === null || value === undefined ? '' : value).trim();
  function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
  function int(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      fail('INVALID_AMOUNT', label + '必須為安全非負整數');
    return value;
  }
  function text(value, label, max, required) {
    if (typeof value !== 'string' || value !== value.trim() || value.length > max ||
        /[\u0000-\u001f]/.test(value) || (required && !value))
      fail('INVALID_TEXT', label + '格式無效');
    return value;
  }
  function sameId(row, id) { return !!(row && str(row.id) === id); }
  function unique(rows, predicate, label, optional) {
    const hits = rows.filter(predicate);
    if (hits.length !== 1 && !(optional && hits.length === 0))
      fail('IDENTITY_NOT_UNIQUE', label + '並非唯一來源');
    return hits[0] || null;
  }
  function arrays(state) {
    if (!state || state.__p39Synthetic !== FIXTURE || !state.meta ||
        state.meta.p39SyntheticSchema !== FIXTURE || !Number.isSafeInteger(state.meta.revision) ||
        state.meta.revision < 0)
      fail('REAL_DATA_FORBIDDEN', 'P39-3 核心只接受虛構測試快照');
    const keys = ['billings','receivables','invoices','receipts','retentionReceipts',
      'bankTransactions','commissions','payroll','salaryPayments','billingAllowances','billingNoteRevisions'];
    keys.forEach(key => { if (!Array.isArray(state[key])) fail('SCHEMA_INVALID', key + '資料集缺失'); });
    return state;
  }
  function sourceSnapshot(state, billingId) {
    arrays(state);
    const id = str(billingId);
    if (!id) fail('IDENTITY_NOT_UNIQUE', '請款 ID 未指定');
    const billing = unique(state.billings, b => sameId(b, id), '請款');
    const ar = unique(state.receivables, r => r.billingId === id || sameId(r, billing.receivableId), '應收');
    if (ar.billingId !== id || billing.receivableId !== ar.id || ar.sourceNo !== billing.number)
      fail('SOURCE_LINK_INVALID', '請款與應收雙向關聯不一致');
    const invoice = unique(state.invoices, r => r.billingId === id ||
      (r.sourceType === 'billing' && r.sourceId === id), '發票', billing.invoiceStatus === 'no_invoice');
    const taxStatus = billing.invoiceStatus;
    if (!['invoice_pending','no_invoice','invoiced'].includes(taxStatus))
      fail('INVOICE_STATUS', '原請款稅務狀態無法辨識');
    if (taxStatus === 'invoiced') {
      if (!invoice || invoice.status !== 'issued' || !str(invoice.number) ||
          invoice.number !== billing.invoiceNo || ar.invoiceNo !== billing.invoiceNo)
        fail('INVOICE_STATUS', '已開立發票識別不一致');
    } else if (taxStatus === 'invoice_pending') {
      if (str(billing.invoiceNo) || (invoice && invoice.status !== 'pending'))
        fail('INVOICE_STATUS', '待開發票狀態與原資料不一致');
    } else if (invoice || str(billing.invoiceNo)) {
      fail('INVOICE_STATUS', '免開發票不得存在銷項發票或票號');
    }
    const original = {
      untaxed: int(billing.preTaxAmount,'原請款未稅'),
      tax: int(billing.taxAmount,'原稅額'),
      gross: int(billing.grossTotal,'原含稅'),
      retention: int(billing.retentionAmount,'原保留款'),
      receivable: int(billing.total,'原應收')
    };
    if (original.untaxed + original.tax !== original.gross ||
        original.gross - original.retention !== original.receivable ||
        original.receivable !== int(ar.amount,'原應收') ||
        original.retention !== int(ar.retentionAmount,'應收保留款') ||
        original.gross !== int(ar.grossTotal,'應收含稅') ||
        original.untaxed !== int(ar.untaxedAmount,'應收未稅') ||
        original.tax !== int(ar.taxAmount,'應收稅額'))
      fail('AMOUNT_MISMATCH', '原請款、應收、保留款無法勾稽');
    if (original.tax !== Math.round(original.untaxed * 0.05) && original.tax !== 0)
      fail('TAX_UNSUPPORTED', '此候選版本不接受特殊營業稅計算');
    if (taxStatus !== 'no_invoice' && original.tax === 0)
      fail('TAX_UNSUPPORTED', '應開票但營業稅為零，暫停自動試算');
    if (invoice && (int(invoice.netAmount,'發票未稅') !== original.untaxed ||
        int(invoice.taxAmount,'發票稅額') !== original.tax ||
        int(invoice.grossAmount,'發票含稅') !== original.gross))
      fail('INVOICE_MISMATCH', '發票金額與原請款不符');
    const paid = [ar.received,ar.retentionReceived,ar.legacyReceived,ar.legacyRetentionReceived]
      .reduce((sum,v)=>sum+int(v === undefined ? 0 : v, '歷史收款'),0);
    const matches = row => row && (str(row.billingId) === id ||
      str(row.receivableId) === ar.id || str(row.sourceNo) === billing.number ||
      str(row.sourceId) === id || str(row.sourceId) === ar.id);
    const receipts = state.receipts.filter(matches);
    const retentionReceipts = state.retentionReceipts.filter(matches);
    const receiptIds = new Set([...receipts,...retentionReceipts].flatMap(row =>
      [str(row.id),str(row.retentionReceiptId)]).filter(Boolean));
    const bankRows = state.bankTransactions.filter(row => matches(row) ||
      receiptIds.has(str(row.sourceId)) || receiptIds.has(str(row.receiptId)));
    const chequeRows = ar.receivableCheques;
    if (paid > 0 || receipts.length || retentionReceipts.length || bankRows.length ||
        (chequeRows !== undefined && (!Array.isArray(chequeRows) || chequeRows.length)))
      fail('SETTLEMENT_LOCKED', '已有收款、票據或銀行紀錄，禁止直接議價過帳');
    if ((state.externalBillingDocuments || []).some(row =>
      (row.sourceIds || []).includes(id) || row.targetBillingId === id))
      fail('EXTERNAL_DOCUMENT_LOCKED', '已納入對外合併文件，禁止直接變更');
    if ((state.customerDeductions || []).some(matches))
      fail('DEDUCTION_LOCKED', '已有客戶扣款，須專案核對');
    const rate = billing.retentionRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100 ||
        !['preTax','taxIncluded'].includes(billing.retentionBase))
      fail('RETENTION_INVALID', '保留款基準或比例不完整');
    const base = billing.retentionBase === 'preTax' ? original.untaxed : original.gross;
    if (Math.round(base * rate / 100) !== original.retention)
      fail('RETENTION_INVALID', '原始保留款與計算基準不一致');
    const fingerprint = JSON.stringify([billing,ar,invoice,receipts,retentionReceipts,bankRows]);
    return {billing,ar,invoice,original,rate,invoiceStatus:taxStatus,
      fingerprint,revision:state.meta.revision};
  }
  function notePlan(state, input) {
    const c = sourceSnapshot(state,input.billingId);
    if (input.role !== 'owner') fail('NOT_AUTHORIZED','只有已授權負責人可編修備註');
    const next = text(input.note, '對外備註', 2000, false);
    const reason = text(input.reason, '修訂原因', 300, true);
    if (next === str(c.billing.note)) fail('NO_CHANGE','備註未更動，不建立重複修訂');
    return {kind:'note',billingId:c.billing.id,previousNote:str(c.billing.note),nextNote:next,
      reason,expectedRevision:c.revision,expectedSnapshot:c.fingerprint};
  }
  function allowancePlan(state, input) {
    const c = sourceSnapshot(state,input.billingId);
    if (input.role !== 'owner') fail('NOT_AUTHORIZED','只有已授權負責人可核准議價');
    const reason = text(input.reason,'議價原因',500,true);
    const approvedGross = int(input.approvedGross,'核定含稅金額');
    if (approvedGross <= 0 || approvedGross >= c.original.gross)
      fail('AMOUNT_RANGE','核定金額須大於零、低於原請款');
    if (state.billingAllowances.some(x=>x.billingId === c.billing.id ||
      x.receivableId === c.ar.id || (c.invoice && x.invoiceNo === c.invoice.number)))
      fail('ALLOWANCE_ALREADY_EXISTS','這張請款已存在折讓紀錄，禁止重複入帳');
    let voucher = null;
    if (c.invoiceStatus === 'invoiced') {
      const v = input.voucher;
      if (!v || v.synthetic !== true || v.issued !== true ||
          v.testVerified !== true || !['electronic','paper'].includes(v.type))
        fail('VOUCHER_REQUIRED','已開發票須先提供可驗證折讓憑證；此處只允許虛構憑證');
      voucher = {type:v.type,number:text(v.number,'憑證號',100,true),
        date:text(v.date,'日期',10,true),synthetic:true,status:'TEST_VERIFIED_ONLY'};
      if (!/^\d{4}-\d\d-\d\d$/.test(voucher.date) ||
          !Number.isFinite(Date.parse(voucher.date+'T00:00:00Z')))
        fail('VOUCHER_INVALID','憑證日期格式無效');
      if (state.billingAllowances.some(x=>x.voucher && x.voucher.number === voucher.number))
        fail('VOUCHER_DUPLICATE','折讓憑證識別碼重複');
    } else if (input.voucher) {
      fail('VOUCHER_UNEXPECTED','尚未開票的修訂與正式折讓憑證不得混用');
    }
    const approvedUntaxed = c.original.tax === 0 ? approvedGross : Math.round(approvedGross/1.05);
    const approvedTax = approvedGross-approvedUntaxed;
    if (c.original.tax && Math.round(approvedUntaxed*0.05)!==approvedTax)
      fail('TAX_UNSUPPORTED','核定金額的營業稅四捨五入不一致');
    const approvedRetention = Math.round((c.billing.retentionBase==='preTax'?
      approvedUntaxed:approvedGross)*c.rate/100);
    const approvedReceivable = approvedGross-approvedRetention;
    const effective = {untaxed:approvedUntaxed,tax:approvedTax,gross:approvedGross,
      retention:approvedRetention,receivable:approvedReceivable};
    const discount = Object.fromEntries(Object.keys(c.original).map(key =>
      [key,c.original[key]-effective[key]]));
    if (Object.values(discount).some(v=>!Number.isSafeInteger(v)||v<0) ||
        discount.untaxed+discount.tax!==discount.gross ||
        discount.receivable+discount.retention!==discount.gross)
      fail('UNBALANCED','折讓與保留款明細無法平衡');
    return {kind:'allowance',billingId:c.billing.id,receivableId:c.ar.id,
      invoiceNo:c.invoice ? str(c.invoice.number) : '',invoiceStatus:c.invoiceStatus,
      expectedRevision:c.revision,expectedSnapshot:c.fingerprint,
      idempotencyKey:'p39::'+c.billing.id+'::'+(str(c.invoice?.number)||'unissued'),
      reason,voucher,original:c.original,effective,discount,
      debit:discount.untaxed+discount.tax,credit:discount.receivable+discount.retention};
  }
  function apply(state, plan) {
    arrays(state);
    if (!plan || !['note','allowance'].includes(plan.kind))
      fail('PLAN_INVALID','操作計畫不完整');
    if (plan.expectedRevision !== state.meta.revision)
      fail('STALE_REVISION','另一裝置已更新，拒絕使用過期操作');
    const source = sourceSnapshot(state,plan.billingId);
    if (source.fingerprint !== plan.expectedSnapshot)
      fail('STALE_SNAPSHOT','原始請款、應收或收款已更新，禁止覆蓋');
    // All validation above precedes the deep clone. Caller state is never mutated, including failure paths.
    const next = clone(state),now = 'SYNTHETIC_TIME_P39_3',id =
      'p39-synthetic-'+String(state.meta.revision+1);
    if (plan.kind === 'note') {
      if (str(source.billing.note) !== plan.previousNote ||
          str(plan.nextNote) === plan.previousNote)
        fail('STALE_NOTE','備註已變動或沒有改變');
      const original = unique(next.billings,b=>sameId(b,plan.billingId),'請款');
      next.billingNoteRevisions.push({schema:NOTE,id,billingId:plan.billingId,
        before:plan.previousNote,after:plan.nextNote,reason:plan.reason,
        sourceRevision:plan.expectedRevision,createdAt:now});
      original.note=plan.nextNote;
    } else {
      // Recompute every amount from the fresh source; do not trust a caller-supplied plan.
      const fresh = allowancePlan(state,{billingId:plan.billingId,role:'owner',
        approvedGross:plan.effective && plan.effective.gross,reason:plan.reason,
        voucher:plan.voucher ? {type:plan.voucher.type,number:plan.voucher.number,
          date:plan.voucher.date,issued:true,synthetic:true,testVerified:true} : undefined});
      if (JSON.stringify(fresh) !== JSON.stringify(plan))
        fail('PLAN_TAMPERED','提交計畫與重新驗算金額不同');
      if (fresh.debit!==fresh.credit || fresh.credit!==fresh.discount.gross)
        fail('UNBALANCED','折讓分錄借貸不平衡');
      next.billingAllowances.push({schema:LEDGER,id,status:'SYNTHETIC_POSTED_NOT_REAL',
        billingId:fresh.billingId,receivableId:fresh.receivableId,invoiceNo:fresh.invoiceNo,
        sourceRevision:fresh.expectedRevision,original:clone(fresh.original),
        effective:clone(fresh.effective),discount:clone(fresh.discount),
        idempotencyKey:fresh.idempotencyKey,voucher:clone(fresh.voucher),
        reason:fresh.reason,debit:fresh.debit,credit:fresh.credit,createdAt:now,
        productionAuthorized:false,cloudWrites:0});
      // Intentionally do NOT modify original billing, AR, invoice or collection records.
      // Every real downstream consumer must be integrated before any production posting.
    }
    next.meta.revision++;
    return {status:'SYNTHETIC_ONLY',state:next,originalUnchanged:
      JSON.stringify(state) !== JSON.stringify(next),productionWrites:0};
  }
  function effective(state, billingId) {
    const c = sourceSnapshot(state,billingId);
    const rows=state.billingAllowances.filter(x=>x.billingId===c.billing.id);
    if (rows.length>1) fail('ALLOWANCE_ALREADY_EXISTS','同單存在多筆折讓');
    const row=rows[0]||null;
    if (row && (row.schema!==LEDGER || row.status!=='SYNTHETIC_POSTED_NOT_REAL' ||
        row.receivableId!==c.ar.id || row.productionAuthorized!==false ||
        row.original.gross!==c.original.gross))
      fail('LEDGER_INVALID','折讓帳不符合候選規格');
    return {billingId:c.billing.id,original:clone(c.original),
      effective:clone(row ? row.effective:c.original),allowance:row?clone(row.discount):null,
      actualBankIncome:0,postedToFormalERP:false};
  }
  function previewReceipt(state, billingId, kind, value) {
    const view=effective(state,billingId);
    if (!['receivable','retention'].includes(kind)) fail('RECEIPT_KIND','收款類別錯誤');
    const amount=int(value,'測試收款'),max=view.effective[kind];
    if (amount<=0 || amount>max)
      fail('OVER_COLLECTION','收款超過折讓後有效應收／保留款');
    return {allowed:true,simulatedOnly:true,kind,amount,remaining:max-amount,
      bankWrites:0,receiptWrites:0};
  }
  return Object.freeze({FIXTURE,LEDGER,NOTE,sourceSnapshot,notePlan,allowancePlan,
    apply,effective,previewReceipt});
});