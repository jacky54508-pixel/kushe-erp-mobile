(function () {
  'use strict';
  // P29-2: form drafts and explanatory text only. No Store writes or storage access.
  const mounted = new WeakMap();
  const emptyDefaults = Object.freeze({defaultRetentionMode:'none',defaultRetentionRate:0,defaultRetentionBase:'taxIncluded',defaultInvoiceChoice:'no_invoice',defaultTaxMode:'未稅',defaultPricingMode:'actual',defaultCommissionBasis:'preTax'});
  const rateOf = value => value.retentionMode === '5' ? 5 : value.retentionMode === '10' ? 10 : Number(value.retentionRate) || 0;
  const conditionKey = value => JSON.stringify(value.retentionMode === 'none'
    ? [Boolean(value.hasInvoice), 'none']
    : [Boolean(value.hasInvoice), 'has', value.retentionMode === 'custom' && Number(value.retentionCustom) > 0 ? ['amount',Number(value.retentionCustom)] : ['rate',rateOf(value)], value.retentionBase === 'preTax' ? 'preTax' : 'taxIncluded']);
  function describeDraft(node, initial, current) {
    if (!node) return;
    const invoice = current.hasInvoice ? '需開發票' : '不開發票';
    const retention = current.retentionMode === 'none' ? '無保留款'
      : (Number(current.retentionCustom) > 0 && current.retentionMode === 'custom'
        ? '保留款 $' + Number(current.retentionCustom).toLocaleString('zh-TW')
        : '保留款 ' + rateOf(current).toLocaleString('zh-TW',{maximumFractionDigits:6}) + '%')
        + '｜依' + (current.retentionBase === 'preTax' ? '未稅' : '含稅') + '金額';
    const changed = initial && conditionKey(initial) !== conditionKey(current);
    node.textContent = (changed ? '本張請款已調整：' : initial?.configured ? '已帶入案場設定：' : '案場尚未完整設定，請核對：') + invoice + '｜' + retention;
    node.dataset.source = changed ? 'invoice' : initial?.configured ? 'project' : 'review';
  }
  function mountQuick(form, store) {
    if (mounted.has(form)) return mounted.get(form);
    const section = document.createElement('section');
    section.className = 'quick-project-conditions';
    section.innerHTML = '<h4>請款條件</h4><p class="quick-condition-intro">設定一次，之後新建請款單自動帶入；單張仍可調整。</p><div class="quick-condition-grid"><label><span>發票需求</span><select name="defaultInvoiceChoice"><option value="no_invoice">不開發票</option><option value="invoice_required">需要開發票</option></select></label><label><span>保留款</span><select name="retentionChoice"><option value="none">無保留款</option><option value="has">有保留款</option></select></label><label data-retention-field hidden><span>保留比例（%）</span><input name="defaultRetentionRate" type="number" inputmode="decimal" min="0" max="100" step="any" placeholder="例如 5 或 10"></label><label data-retention-field hidden><span>保留款計算基準</span><select name="defaultRetentionBase"><option value="taxIncluded">含稅金額</option><option value="preTax">未稅金額</option></select></label><label data-tax-field hidden><span>預設金額方式</span><select name="defaultTaxMode"><option value="未稅">未稅</option><option value="含稅">含稅</option></select></label></div><p class="quick-company-default-hint"></p><p class="quick-condition-error" role="alert" hidden></p>';
    form.querySelector('.daily-quick-project-body').appendChild(section);
    const fields = form.elements, error = section.querySelector('.quick-condition-error');
    let inherited = {...emptyDefaults};
    const showError = message => {error.textContent = String(message || ''); error.hidden = !message;};
    const sync = () => {
      const has = fields.retentionChoice.value === 'has';
      section.querySelectorAll('[data-retention-field]').forEach(node => {node.hidden = !has;});
      section.querySelector('[data-tax-field]').hidden = fields.defaultInvoiceChoice.value !== 'invoice_required';
      fields.defaultRetentionRate.required = has;
    };
    const applyCompany = () => {
      const data = store.getState(), customer = data.customers.find(row => String(row.id) === String(fields.customer.value));
      inherited = customer ? {...emptyDefaults,...store.companyProjectDefaults(customer)} : {...emptyDefaults};
      const mode = inherited.defaultRetentionMode;
      fields.retentionChoice.value = mode === 'none' ? 'none' : 'has';
      fields.defaultRetentionRate.value = mode === 'none' ? '' : mode === '5' ? 5 : mode === '10' ? 10 : inherited.defaultRetentionRate;
      fields.defaultRetentionBase.value = inherited.defaultRetentionBase;
      fields.defaultInvoiceChoice.value = inherited.defaultInvoiceChoice;
      fields.defaultTaxMode.value = inherited.defaultTaxMode;
      const configured = customer && (customer.projectDefaultsConfigured === true || data.projects.some(row => String(row.customer) === String(customer.id)));
      section.querySelector('.quick-company-default-hint').textContent = configured
        ? '已帶入「' + customer.name + '」的公司預設，可依本案場調整；不變更其他既有案場。'
        : '請確認本案場條件。儲存後也會記住為公司預設，供下次新增案場使用。';
      showError(''); sync();
    };
    const read = () => {
      const has = fields.retentionChoice.value === 'has', raw = fields.defaultRetentionRate.value.trim(), rate = Number(raw);
      if (has && (!raw || !Number.isFinite(rate) || rate < 0 || rate > 100)) {
        showError('請填寫 0～100% 的保留比例'); fields.defaultRetentionRate.focus();
        throw new Error('請填寫 0～100% 的保留比例');
      }
      return {...inherited,defaultRetentionMode:has?'custom':'none',defaultRetentionRate:has?rate:0,
        defaultRetentionBase:fields.defaultRetentionBase.value,defaultInvoiceChoice:fields.defaultInvoiceChoice.value,defaultTaxMode:fields.defaultTaxMode.value};
    };
    section.addEventListener('input', () => showError(''));
    section.addEventListener('change', () => {showError(''); sync();});
    fields.customer.addEventListener('change', applyCompany);
    const api = Object.freeze({applyCompany,read,showError}); mounted.set(form,api); applyCompany(); return api;
  }
  window.KusheProjectBillingDefaults = Object.freeze({mountQuick,describeDraft});
}());
