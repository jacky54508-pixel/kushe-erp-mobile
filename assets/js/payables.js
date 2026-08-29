(function () {
  'use strict';

  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = (value) => new Intl.NumberFormat('zh-TW', {style:'currency',currency:'TWD',maximumFractionDigits:0}).format(store.num(value));
  const today = () => new Date().toISOString().slice(0, 10);
  const monthOf = (value) => String(value || '').slice(0, 7);
  const filters = {month:'',vendor:'',project:'',category:'',status:'',query:''};
  let active = false;
  let ready = false;
  let queryTimer = 0;
  let stickyScrollbar = null;
  let stickyScrollbarInner = null;
  let stickyTarget = null;
  let stickyFrame = 0;
  let syncingHorizontalScroll = false;
  const managedScrollContainers = new WeakSet();

  function ensureStickyScrollbar() {
    if (stickyScrollbar) return stickyScrollbar;
    stickyScrollbar = document.createElement('div');
    stickyScrollbar.className = 'payable-sticky-scrollbar';
    stickyScrollbar.setAttribute('role', 'scrollbar');
    stickyScrollbar.setAttribute('aria-label', '表格水平捲動');
    stickyScrollbar.setAttribute('aria-orientation', 'horizontal');
    stickyScrollbarInner = document.createElement('div');
    stickyScrollbarInner.className = 'payable-sticky-scrollbar-inner';
    stickyScrollbar.appendChild(stickyScrollbarInner);
    document.body.appendChild(stickyScrollbar);
    stickyScrollbar.addEventListener('scroll', () => {
      if (!stickyTarget || syncingHorizontalScroll) return;
      syncingHorizontalScroll = true;
      stickyTarget.scrollLeft = stickyScrollbar.scrollLeft;
      syncingHorizontalScroll = false;
      updateStickyAria();
    }, {passive:true});
    return stickyScrollbar;
  }
  function updateStickyAria() {
    if (!stickyScrollbar || !stickyTarget) return;
    stickyScrollbar.setAttribute('aria-valuemin', '0');
    stickyScrollbar.setAttribute('aria-valuemax', String(Math.max(0, stickyTarget.scrollWidth - stickyTarget.clientWidth)));
    stickyScrollbar.setAttribute('aria-valuenow', String(Math.round(stickyTarget.scrollLeft)));
  }
  function hideStickyScrollbar() {
    if (!stickyScrollbar) return;
    stickyScrollbar.classList.remove('is-visible');
    stickyScrollbar.setAttribute('aria-hidden', 'true');
    stickyTarget = null;
  }
  function registerScrollContainer(container) {
    container.classList.add('payable-scroll-managed');
    if (managedScrollContainers.has(container)) return;
    managedScrollContainers.add(container);
    container.addEventListener('scroll', () => {
      if (stickyTarget !== container || syncingHorizontalScroll || !stickyScrollbar) return;
      syncingHorizontalScroll = true;
      stickyScrollbar.scrollLeft = container.scrollLeft;
      syncingHorizontalScroll = false;
      updateStickyAria();
    }, {passive:true});
    container.addEventListener('wheel', (event) => {
      if (!event.shiftKey || container.scrollWidth <= container.clientWidth + 1) return;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      container.scrollLeft += delta;
    }, {passive:false});
  }
  function visibleScrollTarget() {
    const host = $('#payablesApp');
    if (!host || host.closest('[hidden]') || document.body.dataset.route !== 'payables') return null;
    const viewportBottom = window.innerHeight - 18;
    return $$('.commission-table-wrap,.payable-detail-scroll,.payable-history-scroll', host).map((container) => {
      registerScrollContainer(container);
      const rect = container.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, 70));
      const detailPriority = container.matches('.payable-detail-scroll,.payable-history-scroll') ? 100000 : 0;
      return {container,rect,visibleHeight,score:detailPriority + visibleHeight};
    }).filter((item) => item.container.scrollWidth > item.container.clientWidth + 1 && item.visibleHeight > 0)
      .sort((a,b) => b.score - a.score)[0] || null;
  }
  function refreshStickyScrollbar() {
    stickyFrame = 0;
    const selected = visibleScrollTarget();
    if (!selected) return hideStickyScrollbar();
    const bar = ensureStickyScrollbar();
    stickyTarget = selected.container;
    const left = Math.max(0, selected.rect.left);
    const right = Math.min(window.innerWidth, selected.rect.right);
    if (right - left < 80) return hideStickyScrollbar();
    bar.style.left = `${left}px`;
    bar.style.width = `${right - left}px`;
    stickyScrollbarInner.style.width = `${stickyTarget.scrollWidth}px`;
    bar.classList.add('is-visible');
    bar.setAttribute('aria-hidden', 'false');
    syncingHorizontalScroll = true;
    bar.scrollLeft = stickyTarget.scrollLeft;
    syncingHorizontalScroll = false;
    updateStickyAria();
  }
  function scheduleStickyScrollbar() {
    if (stickyFrame) return;
    stickyFrame = requestAnimationFrame(refreshStickyScrollbar);
  }
  document.addEventListener('scroll', scheduleStickyScrollbar, true);
  window.addEventListener('resize', scheduleStickyScrollbar);
  window.addEventListener('load', () => setTimeout(scheduleStickyScrollbar, 120));

  function closeModal() { document.querySelector('.erp-detail-overlay')?.remove(); }
  function closePayableMenus() {
    $$('.payable-more-menu').forEach((menu) => menu.remove());
    $$('[data-payable-more]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }
  document.addEventListener('click', (event) => { if (!event.target.closest('.payable-more')) closePayableMenus(); });
  function openPayableMenu(button, payableId) {
    const opening = button.getAttribute('aria-expanded') !== 'true';
    closePayableMenus();
    if (!opening) return;
    const menu = document.createElement('div');
    menu.className = 'payable-more-menu';
    menu.innerHTML = `<button class="payable-more-delete" type="button">刪除整筆帳務</button>`;
    document.body.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect(), width = 176;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    menu.style.top = `${rect.bottom + 5}px`;
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, rect.top - menuRect.height - 5)}px`;
    menu.onclick = (event) => event.stopPropagation();
    $('.payable-more-delete', menu).onclick = (event) => {
      event.stopPropagation();
      closePayableMenus();
      openPayableDelete(payableId);
    };
  }
  function selectOptions(rows, value, empty) {
    const state = store.getState(), key = ['vendors','projects','banks'].find((name) => rows === state[name]);
    const source = key ? store.masterOptions(key) : rows;
    return `<option value="">${empty}</option>${source.map((row) => `<option value="${esc(row.id)}" ${row.id === value ? 'selected' : ''}>${esc(row.name || '—')}</option>`).join('')}`;
  }
  function materialSource(payable) {
    return /material|inventory/i.test(payable.sourceType || '') || payable.category === '材料採購';
  }
  const payableSourceLabels = {
    'material-project':'單筆材料應付',
    'material-merged':'合併材料應付',
    'manual-payable':'手動新增應付',
    'project-cost':'案場成本應付'
  };
  function payableSourceLabel(value) {
    return payableSourceLabels[String(value || '').trim()] || '其他未確認帳務來源';
  }
  function payableReferenceLabel(value) {
    const labels = {
      'payable.usageIds[]':'此材料已包含在這筆合併應付中',
      'payable.sourceId':'此材料是這筆應付帳款的來源',
      'materialUsage.payableId':'此材料紀錄目前連結到這筆應付帳款'
    };
    const values = String(value || '').split('、').map((item) => item.trim()).filter(Boolean);
    return values.length ? values.map((item) => labels[item] || '其他實際帳務關聯').join('；') : '其他實際帳務關聯';
  }
  function payableBlockerLabel(row) {
    return ({
      notFound:'應付帳款',
      sourceType:'帳務來源',
      paid:'已付款金額',
      payments:'付款紀錄',
      bankTransactions:'銀行交易紀錄',
      invoiceNo:'進項發票號碼',
      invoiceStatus:'進項發票狀態',
      invoices:'進項發票紀錄',
      invoiceRecordCount:'進項發票紀錄',
      invoiceIdentity:'進項發票資料',
      materialUsages:'材料使用紀錄',
      sharedMaterialUsages:'此材料同時被其他應付帳款使用',
      inventoryReceipts:'材料入庫紀錄',
      projectCosts:'案場成本紀錄',
      unknownRelations:'其他未確認關聯'
    })[row?.key] || '安全檢查項目';
  }
  function payableBlockerMessage(row, context = {}) {
    const messages = {
      notFound:'找不到這筆應付帳款。',
      paid:'此筆已有付款金額，銀行對帳完成前不能刪除整筆帳務。',
      payments:'此筆已有付款紀錄，銀行對帳完成前不能刪除整筆帳務。',
      bankTransactions:'此筆已有關聯的銀行交易紀錄，銀行對帳完成前不能刪除整筆帳務。',
      invoiceNo:'此筆已有正式進項發票號碼，不能直接刪除。',
      invoiceStatus:'此筆已標記為正式進項發票，不能直接刪除。',
      invoices:'此筆已有進項發票紀錄，不能直接刪除。',
      invoiceIdentity:'進項發票資料缺少唯一識別，為避免誤刪已停止清理。',
      inventoryReceipts:'此筆已有材料入庫紀錄，不能直接清理。',
      projectCosts:'此筆已有案場成本紀錄，不能直接清理。',
      unknownRelations:'此筆存在其他未確認、缺失或衝突的關聯，為避免帳務斷鏈已停止清理。'
    };
    if (row?.key === 'sourceType') return context.sourceType === 'material-project'
      ? '此筆由材料使用紀錄建立，請先確認原始材料資料。'
      : context.sourceType === 'project-cost'
        ? '此筆由案場成本紀錄建立，請先從案場成本來源確認。'
        : '此筆不是可直接刪除的手動新增應付，未確認或歷史帳務來源一律停止刪除。';
    if (row?.key === 'sharedMaterialUsages') return context.hasPaidShared
      ? '另一筆應付帳款已有付款紀錄，目前不能刪除此材料或解除關聯，以免影響已付款金額與銀行帳務。'
      : '此筆材料已包含在另一筆應付帳款中，因此目前不能直接刪除，以免影響其他帳務。';
    if (row?.key === 'materialUsages') return context.cleanup
      ? '找不到可唯一對應的材料使用紀錄。'
      : '此筆已有材料使用紀錄，請先從原始材料資料確認。';
    if (row?.key === 'invoiceRecordCount') return Number(context.invoiceRecordCount) > 1
      ? '找到多筆關聯的進項發票紀錄，無法唯一確認要處理的資料。'
      : '找不到唯一對應的進項發票紀錄。';
    return messages[row?.key] || '此筆資料未通過安全檢查，目前不開放刪除或清理。';
  }
  function payableView(row, state) {
    const amount = store.num(row.amount);
    const paid = Math.min(amount, Math.max(0, store.num(row.paid)));
    const outstanding = Math.max(0, amount - paid);
    const dueDate = row.dueDate || '';
    const baseStatus = outstanding <= 0 && amount > 0 ? '已付清' : paid > 0 ? '部分付款' : '未付款';
    const overdue = Boolean(dueDate && dueDate < today() && outstanding > 0);
    return {
      ...row, amount, paid, outstanding, dueDate, baseStatus, overdue,
      status: overdue ? '逾期' : baseStatus,
      vendorName: row.vendorName || state.vendors.find((item) => item.id === row.vendor)?.name || '—',
      projectName: row.projectName || state.projects.find((item) => item.id === row.project)?.name || '—',
      category: row.category || (materialSource(row) ? '材料採購' : '廠商款項'),
      item: row.item || row.description || row.sourceNo || row.note || '—',
      payableNo: row.payableNo || row.number || row.sourceNo || '—'
    };
  }
  function allRows() {
    const state = store.getState();
    return state.payables.filter((row) => !/payroll|salary/i.test(row.sourceType || '')).map((row) => payableView(row, state));
  }
  function linkedMaterialLines(payable, state) {
    const usageIds = new Set((payable.usageIds || []).map(String));
    const usages = (state.materialUsages || []).filter((row) => usageIds.has(String(row.id)));
    const usageLines = usages.map((usage) => {
      const material = state.materials.find((row) => row.id === usage.material) || {};
      const project = state.projects.find((row) => row.id === usage.project) || {};
      const quantity = store.num(usage.quantity ?? usage.qty);
      const unitPrice = store.num(usage.unitPrice ?? usage.price ?? material.unitPrice);
      return {
        id: usage.id,
        projectId: usage.project || '',
        projectName: usage.projectName || project.name || '未指定案場',
        materialName: usage.materialName || material.name || '未命名材料',
        model: usage.model || usage.spec || material.model || '',
        unit: usage.unit || material.unit || '—',
        quantity,
        unitPrice,
        amount: usage.amount === undefined ? quantity * unitPrice : store.num(usage.amount),
        date: usage.date || '',
        note: usage.note || ''
      };
    });
    const receiptLines = (state.inventoryReceipts || []).filter((row) => row.payableId === payable.id).map((receipt) => {
      const material = state.materials.find((row) => row.id === receipt.material) || {};
      const project = state.projects.find((row) => row.id === receipt.project) || {};
      const quantity = store.num(receipt.quantity ?? receipt.qty);
      const unitPrice = store.num(receipt.unitPrice ?? receipt.price ?? material.unitPrice);
      return {
        id: receipt.id,
        projectId: receipt.project || '',
        projectName: receipt.projectName || project.name || '未指定案場',
        materialName: receipt.materialName || material.name || '未命名材料',
        model: receipt.model || receipt.spec || material.model || '',
        unit: receipt.unit || material.unit || '—',
        quantity,
        unitPrice,
        amount: receipt.amount === undefined ? quantity * unitPrice : store.num(receipt.amount),
        date: receipt.date || '',
        note: receipt.note || ''
      };
    });
    return [...usageLines, ...receiptLines];
  }
  function projectLabel(payable, state) {
    const materialLines = linkedMaterialLines(payable, state);
    const names = [...new Set(materialLines.map((line) => line.projectName).filter((name) => name && name !== '未指定案場'))];
    if (names.length > 1) return `${names.length} 個案場`;
    if (names.length === 1) return names[0];
    return payable.projectName || state.projects.find((row) => row.id === payable.project)?.name || '—';
  }
  function filteredRows() {
    const state = store.getState();
    const query = filters.query.trim().toLocaleLowerCase('zh-Hant');
    return allRows().filter((row) => {
      const materialLines = linkedMaterialLines(row, state);
      const relatedProjects = new Set(materialLines.map((line) => line.projectId).filter(Boolean));
      const projectMatch = !filters.project || row.project === filters.project || relatedProjects.has(filters.project);
      const searchableDetails = materialLines.map((line) => `${line.projectName} ${line.materialName} ${line.model}`).join(' ');
      return (!filters.month || monthOf(row.date) === filters.month)
        && (!filters.vendor || row.vendor === filters.vendor)
        && projectMatch
        && (!filters.category || row.category === filters.category)
        && (!filters.status || row.baseStatus === filters.status)
        && (!query || `${row.payableNo} ${row.vendorName} ${projectLabel(row,state)} ${row.category} ${row.item} ${row.note || ''} ${searchableDetails}`.toLocaleLowerCase('zh-Hant').includes(query));
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }
  function materialDetailsMarkup(payable, state) {
    const lines = linkedMaterialLines(payable, state);
    if (!lines.length) {
      return `<section class="payable-source-section"><header><div><h3>材料使用明細</h3><p>直接讀取既有材料來源</p></div></header><div class="payable-source-empty"><b>現有資料未保存可展開的逐筆材料明細</b><span>${esc(payable.note || payable.sourceNo || '僅保留應付彙總資料')}</span></div></section>`;
    }
    const groups = new Map();
    lines.forEach((line) => {
      const key = line.projectId || line.projectName || 'unassigned';
      if (!groups.has(key)) groups.set(key, {name:line.projectName,lines:[]});
      groups.get(key).lines.push(line);
    });
    const sourceTotal = lines.reduce((sum, line) => sum + store.num(line.amount), 0);
    const matches = Math.abs(sourceTotal - store.num(payable.amount)) < 0.5;
    return `<section class="payable-source-section"><header><div><h3>材料使用明細</h3><p>${groups.size} 個案場・${lines.length} 筆既有材料來源</p></div></header><div class="payable-material-groups">${[...groups.values()].map((group) => {
      const subtotal = group.lines.reduce((sum, line) => sum + store.num(line.amount), 0);
      return `<article class="payable-material-group"><div class="payable-material-group-head"><b>${esc(group.name)}</b><span>案場小計 ${money(subtotal)}</span></div><div class="payable-detail-scroll"><table class="payable-source-table"><thead><tr><th>案場</th><th>材料名稱</th><th>規格／型號</th><th>單位</th><th class="num">數量</th><th class="num">單價</th><th class="num">小計</th><th>使用／紀錄日期</th></tr></thead><tbody>${group.lines.map((line) => `<tr><td>${esc(line.projectName)}</td><td><b>${esc(line.materialName)}</b></td><td>${esc(line.model || '—')}</td><td>${esc(line.unit)}</td><td class="num">${line.quantity}</td><td class="num">${money(line.unitPrice)}</td><td class="num"><b>${money(line.amount)}</b></td><td>${esc(line.date || '—')}</td></tr>`).join('')}</tbody></table></div></article>`;
    }).join('')}</div><div class="payable-source-total ${matches ? 'is-matched' : 'is-mismatch'}"><span>材料應付合計</span><strong>${money(sourceTotal)}</strong><small>${matches ? '與應付金額一致' : `應付帳款金額 ${money(payable.amount)}，現有來源資料有差異`}</small></div></section>`;
  }
  function expenseDetailsMarkup(payable, state) {
    const project = payable.projectName || state.projects.find((row) => row.id === payable.project)?.name || '—';
    return `<section class="payable-source-section"><header><div><h3>費用明細</h3><p>直接顯示此筆應付既有來源</p></div></header><div class="payable-detail-scroll"><table class="payable-expense-table"><thead><tr><th>日期</th><th>案場</th><th>類別／來源</th><th>項目／說明</th><th class="num">金額</th><th>備註</th></tr></thead><tbody><tr><td>${esc(payable.date || '—')}</td><td>${esc(project)}</td><td>${esc(payable.category || payable.sourceNo || '其他')}</td><td>${esc(payable.item || payable.description || payable.sourceNo || '—')}</td><td class="num"><b>${money(payable.amount)}</b></td><td>${esc(payable.note || '—')}</td></tr></tbody></table></div></section>`;
  }
  function paymentHistoryMarkup(payable, state) {
    const history = state.payments.filter((row) => row.payableId === payable.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return `<section class="payable-payment-section"><header><div><h3>付款紀錄</h3><p>${history.length ? `${history.length} 次付款` : '尚未付款'}</p></div></header>${history.length ? `<div class="payable-history-scroll"><table class="payable-detail-table"><thead><tr><th>付款日期</th><th class="num">本次付款</th><th>銀行帳戶</th><th>付款方式</th><th class="num">手續費</th><th class="num">實際扣款</th><th>備註</th><th>操作</th></tr></thead><tbody>${history.map((payment) => {
      const bank = state.banks.find((item) => item.id === payment.bankId);
      return `<tr><td>${esc(payment.date || '—')}</td><td class="num">${money(payment.amount)}</td><td>${esc(bank?.name || bank?.bank || bank?.account || '—')}</td><td>${esc(payment.paymentMethod || '銀行轉帳')}</td><td class="num">${money(payment.fee)}</td><td class="num">${money(payment.actualDebit ?? payment.amount)}</td><td>${esc(payment.note || '—')}</td><td>${payment.legacy?'—':`<button class="commission-link" type="button" data-edit-payment="${esc(payment.id)}">編輯</button><button class="commission-link" type="button" data-delete-payment="${esc(payment.id)}">刪除</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="payable-empty-state"><span>尚無付款紀錄</span><button class="commission-secondary compact" type="button" data-empty-pay="${esc(payable.id)}">＋ 新增付款</button></div>`}</section>`;
  }
  function detailMarkup(id, state) {
    const raw = state.payables.find((row) => row.id === id);
    if (!raw) return '';
    const payable = payableView(raw, state);
    const source = materialSource(payable) ? materialDetailsMarkup(payable, state) : expenseDetailsMarkup(payable, state);
    return `<tr class="payable-history-row" data-payment-detail="${esc(id)}"><td colspan="9"><div class="payable-expanded-content">${source}${paymentHistoryMarkup(payable,state)}</div></td></tr>`;
  }
  function toggleDetail(id) {
    const main = $(`[data-expand-payable="${CSS.escape(id)}"]`);
    if (!main) return;
    let detail = main.nextElementSibling?.matches('[data-payment-detail]') ? main.nextElementSibling : null;
    const expanded = !main.classList.contains('is-expanded');
    if (expanded && !detail) {
      main.insertAdjacentHTML('afterend', detailMarkup(id, store.getState()));
      detail = main.nextElementSibling;
      $('[data-empty-pay]', detail)?.addEventListener('click', (event) => { event.stopPropagation(); openPayment(id); });
      $$('[data-edit-payment]',detail).forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();openEditPayment(button.dataset.editPayment)}));
      $$('[data-delete-payment]',detail).forEach((button)=>button.addEventListener('click',async(event)=>{event.stopPropagation();if(!window.confirm('確定要刪除此付款紀錄嗎？銀行扣款將同步沖回。'))return;try{await store.deletePayablePayment(button.dataset.deletePayment);render();setTimeout(()=>toggleDetail(id),0);window.KushePhase1.toast('付款已刪除，銀行扣款已沖回')}catch(error){window.KushePhase1.toast(error.message||String(error))}}));
    }
    if (detail) detail.hidden = !expanded;
    main.classList.toggle('is-expanded', expanded);
    main.setAttribute('aria-expanded', String(expanded));
    const button = $('[data-expand-button]', main);
    if (button) {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${expanded ? '收合' : '展開'}應付明細`);
      $('span', button).textContent = expanded ? '⌃' : '⌄';
    }
    requestAnimationFrame(scheduleStickyScrollbar);
  }
  function openPayableTestCleanup(id) {
    let preview;
    try { preview = store.materialPayableTestCleanupPreview(id); }
    catch (error) { window.KushePhase1.toast(error.message || String(error)); return; }
    if (preview.allowed !== true) {
      const reason = preview.blockers.map((row) => row.message).join(' ');
      window.KushePhase1.toast(reason || '此組資料不可安全清理');
      return;
    }
    closeModal();
    const overlay = document.createElement('div');
    const invoiceRows = preview.invoices.map((row) => `<tr><td>${esc(row.invoiceNo || row.id || '—')}</td><td>${esc(row.date || '—')}</td><td>${esc(row.status === 'issued' ? '已開發票' : row.status === 'void' ? '已作廢' : '待開發票')}</td><td class="num">${money(row.amount)}</td></tr>`).join('');
    const usageRows = preview.materialUsages.map((row) => `<tr><td>${esc(row.date || '—')}</td><td>${esc(row.projectName || preview.projectName || '—')}</td><td>${esc(row.materialName || '—')}</td><td class="num">${money(row.amount)}</td></tr>`).join('');
    overlay.className = 'erp-detail-overlay';
    overlay.innerHTML = `<section class="erp-detail-card payable-test-cleanup-modal" role="dialog" aria-modal="true" aria-labelledby="payableTestCleanupTitle"><header><div><span>受控測試資料清理</span><h2 id="payableTestCleanupTitle">材料 → 應付 → 進項發票</h2><p>${esc(preview.payableNo || '—')}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="payableTestCleanupForm" class="payable-test-cleanup-form"><div class="erp-detail-body"><div class="billing-detail-summary payable-test-cleanup-summary"><span>應付編號<b>${esc(preview.payableNo || '—')}</b></span><span>廠商／收款人<b>${esc(preview.vendorName || '—')}</b></span><span>案場<b>${esc(preview.projectName || '—')}</b></span><span>帳務來源<b>${esc(payableSourceLabel(preview.sourceType))}</b></span><span>應付金額<b>${money(preview.amount)}</b></span><span>已付金額<b>${money(preview.paid)}</b></span><span>付款紀錄數<b>${preview.paymentCount}</b></span><span>銀行交易紀錄數<b>${preview.bankTransactionCount}</b></span></div><section class="payable-test-cleanup-warning"><strong>此功能只適用於人工確認的測試資料。</strong><span>正式帳務與正式發票不得使用。系統只確認資料鏈符合安全清理條件，不會自行判定資料是否為測試資料。</span></section><section class="payable-test-chain"><h3>進項發票 <small>${preview.invoiceRecordCount} 筆</small></h3><div class="payable-test-chain-scroll"><table><thead><tr><th>發票號碼</th><th>日期</th><th>狀態</th><th class="num">金額</th></tr></thead><tbody>${invoiceRows}</tbody></table></div><h3>應付帳款 <small>1 筆</small></h3><div class="payable-test-chain-single"><span>${esc(preview.payableNo || '—')}</span><b>${esc(preview.vendorName || '—')}</b><em>${money(preview.amount)}</em></div><h3>材料使用紀錄 <small>${preview.materialUsageCount} 筆</small></h3><div class="payable-test-chain-scroll"><table><thead><tr><th>日期</th><th>案場</th><th>材料</th><th class="num">金額</th></tr></thead><tbody>${usageRows}</tbody></table></div></section><div class="payable-test-cleanup-confirm"><label><input type="checkbox" name="confirmed" required><span>我確認此整組資料為測試資料</span></label><label><span>清理原因（必填）</span><textarea name="reason" rows="3" maxlength="300" required placeholder="請輸入人工判定為測試資料的原因"></textarea></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-secondary danger">確認清理整組測試資料</button></footer></form></section>`;
    document.body.appendChild(overlay);
    $$('[data-close-detail]', overlay).forEach((button) => { button.onclick = closeModal; });
    overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };
    $('#payableTestCleanupForm', overlay).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, values = new FormData(form), confirmed = $('[name="confirmed"]', form).checked, reason = String(values.get('reason') || '').trim(), submitButton = $('button[type="submit"]', form);
      if (!confirmed) { window.KushePhase1.toast('請先確認整組資料為測試資料'); return; }
      if (!reason) { window.KushePhase1.toast('請輸入測試資料清理原因'); return; }
      if (!window.confirm(`最後確認清理「${preview.payableNo || preview.vendorName || '此組資料'}」的進項發票、材料使用與應付帳款？正式帳務不得使用，且此操作無法復原。`)) return;
      submitButton.disabled = true;
      try {
        await store.cleanupMaterialPayableTestData(id, {confirmed:true,reason});
        closeModal();
        render();
        window.KushePhase1.toast('已安全清理材料測試資料鏈');
      } catch (error) {
        window.KushePhase1.toast(error.message || String(error));
        submitButton.disabled = false;
      }
    };
  }
  function openMergedPayableRepair(id) {
    let preview;
    try { preview = store.mergedPayableRepairPreview(id); }
    catch (error) { window.KushePhase1.toast(error.message || String(error)); return; }
    if (preview.allowed !== true) {
      window.KushePhase1.toast(preview.blockers.map((row) => row.message).join(' ') || '此筆歷史帳務不可安全修復');
      return;
    }
    closeModal();
    const overlay = document.createElement('div');
    const paymentRows = preview.truePayments.map((row) => `<tr><td>${esc(row.date || '—')}</td><td class="num">${money(row.amount)}</td><td class="num">${money(row.fee)}</td><td class="num">${money(row.bankTransaction?.amount ?? row.actualDebit)}</td><td>${esc(row.bankName || '—')}</td><td>${esc(row.paymentMethod || '—')}</td></tr>`).join('');
    const materialRows = preview.materialUsages.map((row) => `<tr><td>${esc(row.materialName || '—')}</td><td>${esc(row.projectName || '—')}</td><td class="num">${money(row.amount)}</td></tr>`).join('');
    const merged = preview.mergedPayable, duplicate = preview.duplicatePayable, invoice = preview.testInvoice;
    overlay.className = 'erp-detail-overlay';
    overlay.innerHTML = `<section class="erp-detail-card payable-merged-repair-modal" role="dialog" aria-modal="true" aria-labelledby="payableMergedRepairTitle"><header><div><span>受控歷史帳務整理</span><h2 id="payableMergedRepairTitle">歷史合併帳務修復</h2><p>${esc(merged.payableNo || '—')}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="payableMergedRepairForm" class="payable-test-cleanup-form"><div class="erp-detail-body"><section class="payable-merged-repair-notice"><strong>本次只整理帳務關聯，不會改變付款金額或銀行餘額。</strong><span>系統已逐筆核對真正付款、銀行交易、材料來源與歷史彙總；執行前仍需人工確認舊帳及進項發票為測試／歷史殘留資料。</span></section><section class="payable-repair-section"><h3>保留的正確帳款</h3><div class="billing-detail-summary payable-test-cleanup-summary"><span>應付編號<b>${esc(merged.payableNo || '—')}</b></span><span>廠商<b>${esc(merged.vendorName || '—')}</b></span><span>應付金額<b>${money(merged.amount)}</b></span><span>已付款<b>${money(preview.truePaymentTotal)}</b></span><span>手續費<b>${money(preview.trueFeeTotal)}</b></span><span>未付款<b>${money(Math.max(0, merged.amount - preview.truePaymentTotal))}</b></span></div></section><section class="payable-repair-section"><h3>真正付款 <small>${preview.truePayments.length} 筆</small></h3><div class="payable-test-chain-scroll"><table><thead><tr><th>付款日期</th><th class="num">付款金額</th><th class="num">手續費</th><th class="num">銀行實際扣款</th><th>付款銀行</th><th>付款方式</th></tr></thead><tbody>${paymentRows}</tbody><tfoot><tr><th>合計</th><th class="num">${money(preview.truePaymentTotal)}</th><th class="num">${money(preview.trueFeeTotal)}</th><th class="num">${money(preview.bankActualDebitTotal)}</th><th colspan="2"></th></tr></tfoot></table></div></section><section class="payable-repair-section"><h3>銀行影響</h3><div class="payable-bank-impact"><span>目前銀行實際支出<b>${money(preview.bankActualDebitTotal)}</b></span><span>修復後銀行實際支出<b>${money(preview.bankActualDebitTotal)}</b></span><span>差額<b>${money(0)}</b></span></div></section><section class="payable-repair-section"><h3>保留的材料來源 <small>${preview.materialUsages.length} 筆</small></h3><div class="payable-test-chain-scroll"><table><thead><tr><th>材料名稱</th><th>案場</th><th class="num">材料金額</th></tr></thead><tbody>${materialRows}</tbody><tfoot><tr><th colspan="2">合計</th><th class="num">${money(preview.materialTotal)}</th></tr></tfoot></table></div></section><section class="payable-repair-section is-removal"><h3>將清理的舊資料</h3><div class="payable-repair-removals"><span>重複舊應付<b>${esc(duplicate.payableNo || '—')}｜${money(duplicate.amount)}</b></span><span>測試進項發票<b>${esc(invoice?.invoiceNo || '—')}｜${money(invoice?.amount)}</b></span><span>歷史彙總顯示<b>${money(preview.legacySummary?.amount)}（無獨立銀行交易）</b></span></div></section><details class="payable-diagnostic-technical"><summary>技術資訊</summary><dl><div><dt>保留的應付資料 ID</dt><dd>${esc(merged.id)}</dd></div><div><dt>清理的應付資料 ID</dt><dd>${esc(duplicate.id)}</dd></div><div><dt>歷史彙總 ID</dt><dd>${esc(preview.legacySummary?.id || '—')}</dd></div><div><dt>進項發票 ID</dt><dd>${esc(invoice?.id || '—')}</dd></div></dl></details><div class="payable-test-cleanup-confirm"><label><input type="checkbox" name="confirmed" required><span>我確認上述舊帳與發票為測試／歷史殘留資料</span></label><label><span>修復原因（必填）</span><textarea name="reason" rows="3" maxlength="300" required placeholder="請輸入人工確認與本次關聯整理原因"></textarea></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-secondary danger">確認整理歷史帳務關聯</button></footer></form></section>`;
    document.body.appendChild(overlay);
    $$('[data-close-detail]', overlay).forEach((button) => { button.onclick = closeModal; });
    overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };
    $('#payableMergedRepairForm', overlay).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, values = new FormData(form), confirmed = $('[name="confirmed"]', form).checked, reason = String(values.get('reason') || '').trim(), submitButton = $('button[type="submit"]', form);
      if (!confirmed) { window.KushePhase1.toast('請先確認舊帳與發票為測試／歷史殘留資料'); return; }
      if (!reason) { window.KushePhase1.toast('請輸入歷史帳務修復原因'); return; }
      if (!window.confirm(`最後確認整理「${merged.payableNo || '此筆合併應付'}」的付款、銀行與材料歸屬，並清理「${duplicate.payableNo || '舊帳'}」及其唯一測試進項發票？本次不會改變任何金額。`)) return;
      submitButton.disabled = true;
      try {
        await store.repairMergedPayableHistory(id, {confirmed:true,reason});
        closeModal();
        render();
        window.KushePhase1.toast('已完成歷史合併帳務關聯整理');
      } catch (error) {
        window.KushePhase1.toast(error.message || String(error));
        submitButton.disabled = false;
      }
    };
  }
  function openPayableDelete(id) {
    let preview;
    try { preview = store.payableDeletePreview(id); }
    catch (error) { window.KushePhase1.toast(error.message || String(error)); return; }
    let testCleanupPreview = null;
    if (preview.allowed !== true) {
      try { testCleanupPreview = store.materialPayableTestCleanupPreview(id); }
      catch (_) { testCleanupPreview = null; }
    }
    const testCleanupAllowed = testCleanupPreview?.allowed === true;
    let mergedRepairPreview = null;
    if (preview.allowed !== true) {
      try { mergedRepairPreview = store.mergedPayableRepairPreview(id); }
      catch (_) { mergedRepairPreview = null; }
    }
    const mergedRepairAllowed = mergedRepairPreview?.allowed === true;
    closeModal();
    const overlay = document.createElement('div');
    const sourceLabel = payableSourceLabel(preview.sourceType);
    const blockers = preview.blockers.map((row) => `<li><strong>${esc(payableBlockerLabel(row))}</strong><span>${esc(payableBlockerMessage(row, {sourceType:preview.sourceType,cleanup:false}))}</span></li>`).join('');
    const testCleanupBlocked = preview.allowed !== true && testCleanupPreview && testCleanupPreview.allowed !== true;
    const sharedHasPaid = testCleanupBlocked && (testCleanupPreview.sharedMaterialUsageDetails || []).some((usage) => (usage.otherPayables || []).some((other) => store.num(other.paid) > 0));
    const sharedUsageDetails = testCleanupBlocked ? (testCleanupPreview.sharedMaterialUsageDetails || []).map((usage) => {
      const relatedRows = (usage.otherPayables || []).map((other) => `<tr><td><strong>${esc(other.payableNo || '—')}</strong></td><td>${esc(other.vendorName || '—')}</td><td>${money(other.amount)}</td><td>${money(other.paid)}</td><td>${esc(payableSourceLabel(other.sourceType))}</td><td>${esc(payableReferenceLabel(other.referenceType))}</td></tr>`).join('');
      const technicalRows = (usage.otherPayables || []).map((other) => `<tr><td>${esc(other.payableNo || '—')}</td><td>${esc(other.payableId || '—')}</td><td>${esc(other.sourceType || '—')}</td><td>${esc(other.referenceType || '—')}</td></tr>`).join('');
      return `<article class="payable-shared-usage-detail"><h4>此材料同時出現在其他應付帳款</h4><dl><div><dt>材料名稱</dt><dd>${esc(usage.materialName || '—')}</dd></div><div><dt>案場</dt><dd>${esc(usage.projectName || '—')}</dd></div><div><dt>材料金額</dt><dd>${money(usage.amount)}</dd></div></dl><h4>目前帳款</h4><dl><div><dt>應付編號</dt><dd>${esc(usage.currentPayableNo || '—')}</dd></div></dl><h4>相關的另一筆帳款</h4><div class="payable-shared-usage-scroll"><table><thead><tr><th>應付編號</th><th>廠商</th><th>應付金額</th><th>已付款</th><th>帳務來源</th><th>關聯原因</th></tr></thead><tbody>${relatedRows}</tbody></table></div><details class="payable-diagnostic-technical"><summary>技術資訊</summary><dl><div><dt>材料紀錄 ID</dt><dd>${esc(usage.usageId || '—')}</dd></div><div><dt>應付資料 ID</dt><dd>${esc(usage.currentPayableId || '—')}</dd></div></dl><div class="payable-shared-usage-scroll"><table><thead><tr><th>應付編號</th><th>應付資料 ID</th><th>原始 sourceType</th><th>referenceType</th></tr></thead><tbody>${technicalRows}</tbody></table></div></details></article>`;
    }).join('') : '';
    const testCleanupBlockers = testCleanupBlocked ? testCleanupPreview.blockers.map((row) => `<li><strong>${esc(payableBlockerLabel(row))}</strong><span>${esc(payableBlockerMessage(row, {sourceType:testCleanupPreview.sourceType,cleanup:true,hasPaidShared:sharedHasPaid,invoiceRecordCount:testCleanupPreview.invoiceRecordCount}))}</span>${row.count !== undefined ? `<small>數量：${esc(row.count)}</small>` : ''}${row.key === 'sharedMaterialUsages' ? `${sharedUsageDetails}<p class="payable-shared-usage-warning">請先確認另一筆應付帳款是否也是測試資料。<br>目前不會自動解除或刪除任何關聯。</p>` : ''}</li>`).join('') : '';
    const testCleanupDiagnostic = testCleanupBlocked ? `<section class="payable-test-cleanup-diagnostic" aria-live="polite"><h3>測試資料清理安全檢查</h3><ul>${testCleanupBlockers}</ul><div class="payable-test-cleanup-diagnostic-summary"><span>進項發票紀錄<b>${testCleanupPreview.invoiceRecordCount}</b></span><span>材料使用紀錄<b>${testCleanupPreview.materialUsageCount}</b></span><span>其他應付共用材料<b>${testCleanupPreview.sharedMaterialUsageCount}</b></span><span>材料入庫紀錄<b>${testCleanupPreview.inventoryReceiptCount}</b></span><span>案場成本紀錄<b>${testCleanupPreview.projectCostCount}</b></span><span>其他未確認關聯<b>${testCleanupPreview.unknownRelationCount}</b></span><span>付款紀錄<b>${testCleanupPreview.paymentCount}</b></span><span>銀行交易紀錄<b>${testCleanupPreview.bankTransactionCount}</b></span></div><p>目前尚未通過測試資料安全清理條件，因此清理按鈕不開放。</p></section>` : '';
    overlay.className = 'erp-detail-overlay';
    overlay.innerHTML = `<section class="erp-detail-card receipt-card payable-delete-modal" role="dialog" aria-modal="true" aria-labelledby="payableDeleteTitle"><header><div><span>應付帳款安全刪除</span><h2 id="payableDeleteTitle">刪除整筆帳務</h2><p>${esc(preview.payableNo || '—')}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><div class="erp-detail-body"><div class="billing-detail-summary payable-delete-summary"><span>應付編號<b>${esc(preview.payableNo || '—')}</b></span><span>廠商／收款人<b>${esc(preview.vendorName || '—')}</b></span><span>案場<b>${esc(preview.projectName || '—')}</b></span><span>帳務來源<b>${esc(sourceLabel)}</b></span><span>應付金額<b>${money(preview.amount)}</b></span><span>已付金額<b>${money(preview.paid)}</b></span><span>付款紀錄數<b>${preview.paymentCount}</b></span><span>銀行交易紀錄數<b>${preview.bankTransactionCount}</b></span><span>發票狀態<b>${esc(preview.invoiceStatus)}</b></span><span>材料使用／入庫紀錄數<b>${preview.materialUsageCount + preview.inventoryReceiptCount}</b></span><span>案場成本紀錄數<b>${preview.projectCostCount}</b></span><span>其他未確認關聯數<b>${preview.unknownRelationCount}</b></span></div><section class="payable-delete-result ${preview.allowed ? 'is-allowed' : 'is-blocked'}" aria-live="polite"><h3>安全檢查結果</h3>${preview.allowed ? '<p>此筆為未付款手動新增應付，沒有付款、銀行、發票或來源關聯，可安全刪除。</p>' : `<ul>${blockers}</ul>`}${testCleanupAllowed ? '<p class="payable-test-cleanup-available">此筆材料資料鏈通過安全清理條件；僅在人工確認整組皆為測試資料時，才可進入受控清理。</p>' : ''}${mergedRepairAllowed ? '<p class="payable-merged-repair-available">付款、銀行與材料來源已通過歷史合併帳務逐筆核對；人工確認後可只整理關聯並清理舊帳。</p>' : ''}</section>${testCleanupDiagnostic}</div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button>${mergedRepairAllowed ? '<button type="button" class="commission-secondary danger" data-open-merged-payable-repair>歷史合併帳務修復</button>' : ''}${testCleanupAllowed ? '<button type="button" class="commission-secondary danger" data-open-payable-test-cleanup>測試資料安全清理</button>' : ''}${preview.allowed ? '<button type="button" class="commission-secondary danger" data-confirm-payable-delete>確認刪除此筆應付</button>' : ''}</footer></section>`;
    document.body.appendChild(overlay);
    $$('[data-close-detail]', overlay).forEach((button) => { button.onclick = closeModal; });
    overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };
    const confirmButton = $('[data-confirm-payable-delete]', overlay);
    const testCleanupButton = $('[data-open-payable-test-cleanup]', overlay);
    const mergedRepairButton = $('[data-open-merged-payable-repair]', overlay);
    if (mergedRepairButton) mergedRepairButton.onclick = () => openMergedPayableRepair(id);
    if (testCleanupButton) testCleanupButton.onclick = () => openPayableTestCleanup(id);
    if (confirmButton) confirmButton.onclick = async () => {
      if (!window.confirm(`最後確認刪除未付款手動應付「${preview.payableNo || preview.vendorName || '此筆應付'}」？此操作無法復原。`)) return;
      confirmButton.disabled = true;
      try {
        await store.deletePayable(id);
        closeModal();
        render();
        window.KushePhase1.toast('已安全刪除未付款手動應付帳款');
      } catch (error) {
        window.KushePhase1.toast(error.message || String(error));
        confirmButton.disabled = false;
      }
    };
  }
  function bindListEvents() {
    [['payableMonth','month'],['payableVendor','vendor'],['payableProject','project'],['payableCategory','category'],['payableStatus','status']].forEach(([id,key]) => {
      $(`#${id}`).onchange = (event) => { filters[key] = event.target.value; render(); };
    });
    $('#payableQuery').oninput = (event) => {
      filters.query = event.target.value;
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => {
        render();
        const input = $('#payableQuery');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }, 140);
    };
    $('#newPayable').onclick = openNewPayable;
    $$('[data-pay]').forEach((button) => { button.onclick = (event) => { event.stopPropagation(); openPayment(button.dataset.pay); }; });
    $$('[data-expand-button]').forEach((button) => { button.onclick = (event) => { event.stopPropagation(); toggleDetail(button.dataset.expandButton); }; });
    $$('[data-payable-more]').forEach((button) => { button.onclick = (event) => {
      event.stopPropagation();
      openPayableMenu(button, button.dataset.payableMore);
    }; });
    $$('[data-expand-payable]').forEach((row) => {
      row.onclick = (event) => { if (!event.target.closest('button,a,input,select')) toggleDetail(row.dataset.expandPayable); };
      row.onkeydown = (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,a,input,select')) {
          event.preventDefault();
          toggleDetail(row.dataset.expandPayable);
        }
      };
    });
  }
  function render() {
    if (!active) return;
    const state = store.getState();
    const rows = filteredRows();
    const all = allRows();
    const month = monthOf(today());
    const payments = state.payments.filter((row) => monthOf(row.date) === month);
    const total = all.reduce((sum, row) => sum + row.amount, 0);
    const monthPaid = payments.reduce((sum, row) => sum + store.num(row.amount), 0);
    const open = all.reduce((sum, row) => sum + row.outstanding, 0);
    const overdue = all.filter((row) => row.overdue).reduce((sum, row) => sum + row.outstanding, 0);
    const monthAdded = all.filter((row) => monthOf(row.date) === month).reduce((sum, row) => sum + row.amount, 0);
    const categories = [...new Set(all.map((row) => row.category).filter(Boolean))].sort();
    $('#payablesApp').innerHTML = `<section class="commissions-heading"><div><h1>應付帳款</h1><p>管理廠商款項、分次付款與銀行實際扣款</p></div><button class="commission-primary" id="newPayable" type="button">＋ 新增應付</button></section>
      <section class="commission-kpis payable-kpis"><article><span>應付總額</span><strong>${money(total)}</strong><small>${all.length} 筆應付</small></article><article class="is-success"><span>本月已付</span><strong>${money(monthPaid)}</strong><small>${esc(month)} 付款</small></article><article class="is-warning"><span>未付帳款</span><strong>${money(open)}</strong><small>含部分付款餘額</small></article><article class="is-warning"><span>逾期應付</span><strong>${money(overdue)}</strong><small>已超過到期日</small></article><article><span>本月新增應付</span><strong>${money(monthAdded)}</strong><small>${esc(month)} 新增</small></article></section>
      <section class="commission-panel commission-filters"><div class="payable-filter-grid"><label><span>月份</span><input id="payableMonth" type="month" value="${esc(filters.month)}"></label><label><span>廠商／收款人</span><select id="payableVendor">${selectOptions(state.vendors,filters.vendor,'全部廠商／收款人')}</select></label><label><span>案場</span><select id="payableProject">${selectOptions(state.projects,filters.project,'全部案場')}</select></label><label><span>類別</span><select id="payableCategory"><option value="">全部類別</option>${categories.map((value) => `<option ${filters.category === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label><span>付款狀態</span><select id="payableStatus"><option value="">全部狀態</option>${['未付款','部分付款','已付清'].map((value) => `<option ${filters.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="payable-search"><span>關鍵字</span><input id="payableQuery" type="search" value="${esc(filters.query)}" placeholder="廠商、案場、材料或費用"></label></div></section>
      <section class="commission-panel billing-list-panel"><div class="commission-table-wrap"><table class="commission-table payable-table"><thead><tr><th>日期</th><th>廠商／收款人</th><th>案場</th><th>類別／來源</th><th class="num">應付金額</th><th class="num">已付</th><th class="num">未付</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map((row) => {
        const history = state.payments.filter((payment) => payment.payableId === row.id);
        const project = projectLabel(row, state);
        const source = row.sourceNo || row.item || row.category;
        return `<tr class="payable-main-row" data-expand-payable="${esc(row.id)}" tabindex="0" aria-expanded="false"><td>${esc(row.date || '—')}</td><td><b>${esc(row.vendorName)}</b>${history.length ? `<span class="receipt-count-badge">${history.length} 次付款</span>` : ''}</td><td><b>${esc(project)}</b></td><td><span class="payable-category">${esc(row.category)}</span><small class="payable-source-label">${esc(source)}</small></td><td class="num">${money(row.amount)}</td><td class="num">${money(row.paid)}</td><td class="num"><b>${money(row.outstanding)}</b></td><td><span class="commission-status ${row.baseStatus === '已付清' ? 'settled' : row.baseStatus === '部分付款' ? 'partial' : row.overdue ? 'overdue' : ''}">${esc(row.status)}</span></td><td><div class="receivable-actions payable-row-actions">${row.outstanding > 0 ? `<button class="commission-primary compact" type="button" data-pay="${esc(row.id)}">付款</button>` : ''}<button class="receivable-expand" type="button" data-expand-button="${esc(row.id)}" aria-label="展開應付明細" aria-expanded="false"><span aria-hidden="true">⌄</span></button><div class="payable-more"><button class="payable-more-toggle" type="button" data-payable-more="${esc(row.id)}" aria-label="更多操作" aria-expanded="false">⋯</button></div></div></td></tr>`;
      }).join('') || '<tr><td colspan="9" class="billing-empty">此篩選條件下沒有應付帳款。</td></tr>'}</tbody></table></div></section>`;
    bindListEvents();
    requestAnimationFrame(scheduleStickyScrollbar);
  }
  function openNewPayable() {
    const state = store.getState();
    const overlay = document.createElement('div');
    overlay.className = 'erp-detail-overlay';
    overlay.innerHTML = `<section class="erp-detail-card payable-modal" role="dialog" aria-modal="true"><header><div><span>應付帳款</span><h2>新增應付</h2><p>沿用廠商、案場與既有應付資料結構</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="newPayableForm"><div class="erp-detail-body"><div class="receipt-form-grid"><label><span>日期</span><input name="date" type="date" value="${today()}" required></label><label><span>既有廠商／收款人</span><select name="vendorId">${selectOptions(state.vendors,'','請選擇既有主檔')}</select></label><label><span>新增收款人名稱</span><input name="payeeName" placeholder="主檔沒有時才輸入"></label><label><span>案場</span><select name="projectId">${selectOptions(state.projects,'','不指定案場')}</select></label><label><span>類別</span><select name="category"><option>材料採購</option><option>廠商款項</option><option>工程費用</option><option>外包／協力廠商</option><option>公司費用</option><option selected>其他</option></select></label><label><span>項目／說明</span><input name="item" required placeholder="款項內容"></label><label><span>應付金額</span><input name="amount" type="number" min="1" step="1" required></label><label><span>到期日</span><input name="dueDate" type="date"></label><label class="payable-note-field"><span>備註</span><textarea name="note" rows="3"></textarea></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">儲存應付</button></footer></form></section>`;
    document.body.appendChild(overlay);
    $$('[data-close-detail]', overlay).forEach((button) => { button.onclick = closeModal; });
    $('#newPayableForm', overlay).onsubmit = async (event) => {
      event.preventDefault();
      const button = $('button[type="submit"]', event.currentTarget);
      button.disabled = true;
      try {
        const fd = new FormData(event.currentTarget);
        await store.savePayable(Object.fromEntries(fd.entries()));
        closeModal();
        window.KushePhase1.toast('應付帳款已新增');
        render();
      } catch (error) {
        window.KushePhase1.toast(error.message || String(error));
        button.disabled = false;
      }
    };
  }
  function openPayment(id) {
    const state = store.getState();
    const payable = state.payables.find((row) => row.id === id);
    if (!payable) return;
    const row = payableView(payable, state);
    if (!row.outstanding) return window.KushePhase1.toast('此筆應付已付清');
    closeModal();
    const token = `payment-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const overlay = document.createElement('div');
    overlay.className = 'erp-detail-overlay';
    overlay.innerHTML = `<section class="erp-detail-card receipt-card" role="dialog" aria-modal="true"><header><div><span>應付帳款付款</span><h2>${esc(row.vendorName)}</h2><p>${esc(projectLabel(row,state))}｜${esc(row.category)}；可分次付款且每筆銀行交易只入帳一次。</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="payablePaymentForm"><div class="erp-detail-body"><div class="billing-detail-summary payable-preview"><span>應付金額<b>${money(row.amount)}</b></span><span>已付金額<b>${money(row.paid)}</b></span><span>未付金額<b>${money(row.outstanding)}</b></span><span>本次付款<b id="paymentPreviewAmount">${money(row.outstanding)}</b></span><span>手續費<b id="paymentPreviewFee">$0</b></span><span>實際扣款<b id="paymentPreviewDebit">${money(row.outstanding)}</b></span><span>付款後未付<b id="paymentPreviewOpen">$0</b></span></div><div class="receipt-form-grid"><label><span>付款日期</span><input name="date" type="date" value="${today()}" required></label><label><span>本次付款金額</span><input name="amount" type="number" min="1" max="${row.outstanding}" value="${row.outstanding}" required></label><label><span>付款銀行帳戶</span><select name="bankId" required><option value="">請選擇帳戶</option>${state.banks.map((bank) => `<option value="${esc(bank.id)}">${esc(bank.name || bank.bank || bank.account || '銀行帳戶')}</option>`).join('')}</select></label><label><span>付款方式</span><select name="paymentMethod"><option>銀行轉帳</option><option>現金</option><option>支票</option><option>其他</option></select></label><label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="0"></label><label><span>手續費負擔方式</span><select name="feePayer"><option value="company">公司／轉帳人負擔</option><option value="recipient">收款人負擔</option></select></label><label class="payable-note-field"><span>備註</span><input name="note" placeholder="付款說明"></label></div><p class="payable-fee-hint" id="paymentFeeHint">公司負擔：應付沖帳依本次付款，銀行另加手續費扣款。</p></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">確認付款</button></footer></form></section>`;
    document.body.appendChild(overlay);
    $$('[data-close-detail]', overlay).forEach((button) => { button.onclick = closeModal; });
    const form = $('#payablePaymentForm', overlay);
    const refresh = () => {
      const amount = Math.max(0, Number($('[name="amount"]', form).value) || 0);
      const fee = Math.max(0, Number($('[name="fee"]', form).value) || 0);
      const company = $('[name="feePayer"]', form).value === 'company';
      const debit = company ? amount + fee : amount;
      $('#paymentPreviewAmount', overlay).textContent = money(amount);
      $('#paymentPreviewFee', overlay).textContent = money(fee);
      $('#paymentPreviewDebit', overlay).textContent = money(debit);
      $('#paymentPreviewOpen', overlay).textContent = money(Math.max(0, row.outstanding - amount));
      $('#paymentFeeHint', overlay).textContent = company ? '公司負擔：應付沖帳依本次付款，銀行另加手續費扣款。' : '收款人負擔：沿用正式版規則，銀行只扣本次應付沖帳金額。';
    };
    ['amount','fee','feePayer'].forEach((name) => { $(`[name="${name}"]`, form).oninput = refresh; });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = $('button[type="submit"]', form);
      button.disabled = true;
      try {
        const fd = new FormData(form);
        await store.addPayablePayment({payableId:id,date:fd.get('date'),amount:fd.get('amount'),bankId:fd.get('bankId'),paymentMethod:fd.get('paymentMethod'),fee:fd.get('fee'),feePayer:fd.get('feePayer'),note:fd.get('note'),idempotencyKey:token});
        closeModal();
        window.KushePhase1.toast('付款已儲存，應付餘額、銀行與 Dashboard 已同步');
        render();
        setTimeout(() => toggleDetail(id), 0);
      } catch (error) {
        window.KushePhase1.toast(error.message || String(error));
        button.disabled = false;
      }
    };
  }
  function openEditPayment(id) {
    const state=store.getState(),payment=state.payments.find((row)=>row.id===id);
    if(!payment||payment.legacy)return;
    const payable=state.payables.find((row)=>row.id===payment.payableId);
    if(!payable)return;
    const row=payableView(payable,state),otherPaid=state.payments.filter((item)=>item!==payment&&item.payableId===payable.id).reduce((sum,item)=>sum+store.num(item.amount),0),maximum=Math.max(0,row.amount-otherPaid),selectedBank=payment.bankAccountId||payment.bankId||'';
    closeModal();
    const overlay=document.createElement('div');overlay.className='erp-detail-overlay';
    overlay.innerHTML=`<section class="erp-detail-card receipt-card" role="dialog" aria-modal="true"><header><div><span>應付帳款付款</span><h2>編輯付款</h2><p>${esc(row.vendorName)}｜${esc(projectLabel(row,state))}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="editPayablePaymentForm"><div class="erp-detail-body"><div class="billing-detail-summary payable-preview"><span>應付金額<b>${money(row.amount)}</b></span><span>其他付款<b>${money(otherPaid)}</b></span><span>本次付款<b id="editPaymentPreviewAmount">${money(payment.amount)}</b></span><span>實際扣款<b id="editPaymentPreviewDebit">${money(payment.actualDebit??payment.amount)}</b></span><span>修改後未付<b id="editPaymentPreviewOpen">${money(Math.max(0,row.amount-otherPaid-store.num(payment.amount)))}</b></span></div><div class="receipt-form-grid"><label><span>付款日期</span><input name="date" type="date" value="${esc(payment.date||today())}" required></label><label><span>本次付款金額</span><input name="amount" type="number" min="1" max="${maximum}" value="${store.num(payment.amount)}" required></label><label><span>付款銀行帳戶</span><select name="bankId" required><option value="">請選擇帳戶</option>${state.banks.map((bank)=>`<option value="${esc(bank.id)}" ${bank.id===selectedBank?'selected':''}>${esc(bank.name||bank.bank||bank.account||'銀行帳戶')}</option>`).join('')}</select></label><label><span>付款方式</span><select name="paymentMethod">${['銀行轉帳','現金','支票','其他'].map((value)=>`<option ${payment.paymentMethod===value?'selected':''}>${value}</option>`).join('')}</select></label><label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="${store.num(payment.fee)}"></label><label><span>手續費負擔方式</span><select name="feePayer"><option value="company" ${payment.feePayer!=='recipient'?'selected':''}>公司／轉帳人負擔</option><option value="recipient" ${payment.feePayer==='recipient'?'selected':''}>收款人負擔</option></select></label><label class="payable-note-field"><span>備註</span><input name="note" value="${esc(payment.note||'')}"></label></div><p>修改金額或付款銀行時，原銀行交易會以相同付款 ID 更新，不會重複扣款。</p></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">儲存修改</button></footer></form></section>`;
    document.body.appendChild(overlay);$$('[data-close-detail]',overlay).forEach((button)=>{button.onclick=closeModal});
    const form=$('#editPayablePaymentForm',overlay),refresh=()=>{const amount=Math.max(0,Number($('[name="amount"]',form).value)||0),fee=Math.max(0,Number($('[name="fee"]',form).value)||0),company=$('[name="feePayer"]',form).value==='company',debit=company?amount+fee:amount;$('#editPaymentPreviewAmount',overlay).textContent=money(amount);$('#editPaymentPreviewDebit',overlay).textContent=money(debit);$('#editPaymentPreviewOpen',overlay).textContent=money(Math.max(0,row.amount-otherPaid-amount))};
    ['amount','fee','feePayer'].forEach((name)=>{$(`[name="${name}"]`,form).oninput=refresh});
    form.onsubmit=async(event)=>{event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;try{const fd=new FormData(form);await store.updatePayablePayment(id,{date:fd.get('date'),amount:fd.get('amount'),bankId:fd.get('bankId'),paymentMethod:fd.get('paymentMethod'),fee:fd.get('fee'),feePayer:fd.get('feePayer'),note:fd.get('note')});closeModal();render();setTimeout(()=>toggleDetail(payable.id),0);window.KushePhase1.toast('付款與銀行交易已同步更新')}catch(error){window.KushePhase1.toast(error.message||String(error));button.disabled=false}};
  }
  async function activate() {
    active = true;
    if (!ready) { await store.load(); ready = true; }
    render();
    setTimeout(scheduleStickyScrollbar, 180);
  }
  function deactivate() {
    active = false;
    if (document.body.dataset.route !== 'payables') hideStickyScrollbar();
  }
  window.addEventListener('kushe:data-updated', () => { if (active) render(); });
  window.KushePayables = {activate,deactivate,render};
}());
