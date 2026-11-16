/* P40-15: whole-document billing concession PREVIEW ONLY.
 * Works from the existing verified externalBillingDocumentIndex (no new bill or AR).
 * NEVER save, persist, sync, post, allocate an invoice, change a PDF or alter source lines.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KusheBillingGroupDiscountPreview = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const fields = ['untaxed', 'tax', 'grossTotal', 'retention', 'receivable'];
  const settlementFields = ['received', 'outstanding', 'retentionReceived', 'retentionOutstanding', 'pendingCheque', 'availableToCollect'];
  const money = n => 'NT$' + n.toLocaleString('zh-TW');
  const plain = v => String(v ?? '');
  function nonnegative(value, label) {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        plain(value).trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0)
      throw Error(label + '不是有效的非負整數，停止試算');
    return Number(value);
  }
  function preview(group, approvedGross) {
    const d = group?.document, s = group?.sources, t = group?.totals;
    if (!d || d.status !== 'active' || group.canGroup !== true ||
        !Array.isArray(group.issues) || group.issues.length ||
        group.termsChanged || !Array.isArray(d.sourceIds) ||
        d.sourceIds.length < 2 || d.sourceIds.length > 30 ||
        new Set(d.sourceIds).size !== d.sourceIds.length ||
        !Array.isArray(s) || s.length !== d.sourceIds.length || !t)
      throw Error('合併文件來源／版本未通過核對，停止試算；原帳維持不變');
    const sum = Object.fromEntries([...fields, ...settlementFields].map(k => [k, 0]));
    const invoiced = [];
    for (let i = 0; i < s.length; i++) {
      const source = s[i], anchor = source?.document?.anchors, receipt = source?.settlement;
      if (!anchor || !receipt || plain(source.document.billingId) !== plain(d.sourceIds[i]) ||
          plain(receipt.billingId) !== plain(d.sourceIds[i]) ||
          !source.document.receivableId)
        throw Error('原單、應收與合併來源識別不一致，停止試算');
      const a = Object.fromEntries(fields.map(k => [k, nonnegative(anchor[k], '原單' + k)]));
      if (a.untaxed + a.tax !== a.grossTotal ||
          a.grossTotal - a.retention !== a.receivable)
        throw Error('原單未稅／稅額／保留款／應收不一致，停止試算');
      const p = Object.fromEntries(settlementFields.map(k => [k, nonnegative(receipt[k], '原收款' + k)]));
      if (p.outstanding !== a.receivable - p.received ||
          p.retentionOutstanding !== a.retention - p.retentionReceived ||
          p.availableToCollect !== p.outstanding - p.pendingCheque)
        throw Error('原收款／保留款／支票預留不一致，停止試算');
      for (const k of fields) sum[k] += a[k];
      for (const k of settlementFields) sum[k] += p[k];
      if (Object.values(sum).some(n => !Number.isSafeInteger(n)))
        throw Error('合併請款金額超過安全範圍');
      const invoiceStatus = plain(source.document.invoiceStatus);
      if (!['no_invoice', 'invoice_pending', 'invoiced'].includes(invoiceStatus))
        throw Error('原單發票狀態不明，停止試算');
      if (invoiceStatus === 'invoiced' || plain(source.document.invoiceNo).trim())
        invoiced.push(plain(source.document.number) || '原單 ' + (i + 1));
    }
    for (const k of Object.keys(sum)) {
      if (nonnegative(t[k], '合併' + k) !== sum[k])
        throw Error('合併帳款與各原單合計不一致，停止試算');
    }
    const target = nonnegative(approvedGross, '建商核定總額');
    if (target === 0 || target > sum.grossTotal)
      throw Error('建商核定總額須大於零且不得超過原合併請款總額');
    const reduction = sum.grossTotal - target;
    const locks = [];
    if (invoiced.length) locks.push('已開發票原單 ' + invoiced.length + ' 張，需核對發票折讓憑證與稅務處理');
    if (sum.received > 0) locks.push('已有收款 ' + money(sum.received) + '，不得直接覆寫應收或銀行');
    if (sum.retentionReceived > 0) locks.push('已收回保留款，須核對原收回紀錄');
    if (sum.pendingCheque > 0) locks.push('存在支票預留，須核對票據');
    if (group.settlementChanged) locks.push('原單收款狀態與合併文件保存時不同，需重新核對');
    if (!reduction) locks.push('核定金額等於原金額，未產生折讓');
    return Object.freeze({
      readOnly: true, canPost: false, type: 'MERGED_DOCUMENT_PREVIEW_ONLY',
      sourceCount: d.sourceIds.length, documentId: d.id,
      original: Object.freeze(sum), approvedGross: target,
      reduction, reductionPercent: sum.grossTotal ? reduction / sum.grossTotal * 100 : 0,
      locks, taxAllocation: '待核對', retentionAllocation: '待核對', receivableAdjustment: '待核對'
    });
  }
  function latest(id) {
    const store = window.KuSheERPStore;
    if (!store?.externalBillingDocumentIndex || !store?.getState())
      throw Error('唯讀財務來源未就緒');
    const model = store.externalBillingDocumentIndex();
    if (!model || !Array.isArray(model.documents)) throw Error('合併文件資料未就緒');
    const groups = model.documents.filter(g => plain(g.document?.id) === plain(id));
    if (groups.length !== 1) throw Error('無法唯一識別合併文件，停止試算');
    return groups[0];
  }
  function el(tag, parent, value, className) {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = value;
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }
  function open(id) {
    const initial = latest(id), init = preview(initial, initial.totals.grossTotal);
    const identity = JSON.stringify({id: initial.document.id, revision: initial.document.revision,
      sources: initial.document.sourceIds, originals: initial.sources.map(s => s.document.anchors)});
    if (!document.getElementById('p40-15-readonly-css')) {
      const style = el('style', document.head); style.id = 'p40-15-readonly-css';
      style.textContent = '.p40-15-shade{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px;background:#08283da8}.p40-15-modal{width:min(700px,100%);max-height:94vh;overflow:auto;border-radius:14px;background:#fff;color:#153955;padding:22px;box-shadow:0 18px 42px #08172566}.p40-15-modal h2{font-size:21px;margin:4px 0}.p40-15-modal p{line-height:1.6;font-size:13px;color:#526b7b}.p40-15-top{display:flex;justify-content:space-between;gap:14px}.p40-15-modal label{display:grid;gap:8px;margin:18px 0;font-weight:650}.p40-15-modal input{padding:12px;width:100%;box-sizing:border-box;border:1px solid #acc4d2;border-radius:9px;font:inherit}.p40-15-out{padding:15px 0;border-top:1px solid #d5e3eb;margin-top:15px}.p40-15-out strong{font-size:19px}.p40-15-warn{padding:12px;background:#fff8e9;border:1px solid #ead8b6;border-radius:9px;white-space:pre-wrap}@media(max-width:650px){.p40-15-modal{padding:15px}}';
    }
    const shade = el('div', document.body, null, 'p40-15-shade');
    const modal = el('section', shade, null, 'p40-15-modal');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '合併請款議價折讓唯讀試算');
    const top = el('div', modal, null, 'p40-15-top'), heading = el('div', top);
    el('h2', heading, '合併請款｜議價／折讓試算');
    el('p', heading, plain(initial.document.displayProjectName) + ' · ' + init.sourceCount + ' 張原單');
    const close = el('button', top, '關閉', 'commission-secondary'); close.type = 'button';
    el('p', modal, '以整張合併請款的總金額一次試算。原始請款、對外施工明細、發票、收款及薪資全部保持不變。');
    el('p', modal, '原合併請款總額：' + money(init.original.grossTotal));
    el('p', modal, '原未稅 ' + money(init.original.untaxed) + ' · 稅額 ' + money(init.original.tax) +
      ' · 保留款 ' + money(init.original.retention) + ' · 應收 ' + money(init.original.receivable));
    const label = el('label', modal, '建商核定整張總額（NT$，未扣保留款）');
    const input = el('input', label); input.type = 'number'; input.step = '1'; input.min = '1';
    input.max = String(init.original.grossTotal); input.placeholder = '輸入建商核定整張請款的總金額';
    const button = el('button', modal, '試算整張折讓（不儲存）', 'commission-primary'); button.type = 'button';
    const output = el('div', modal, null, 'p40-15-out');
    el('p', modal, '稅額、保留款及應收的調整需依原單、發票與收款逐項核定。本視窗不做比例分攤或任何正式入帳。');
    const quit = () => {shade.remove();document.removeEventListener('keydown', onKey)};
    const onKey = event => {if (event.key === 'Escape') quit()};
    close.addEventListener('click', quit);
    shade.addEventListener('click', event => {if (event.target === shade) quit()});
    document.addEventListener('keydown', onKey);
    button.addEventListener('click', () => {
      output.replaceChildren();
      try {
        const fresh = latest(id);
        const current = JSON.stringify({id: fresh.document.id, revision: fresh.document.revision,
          sources: fresh.document.sourceIds, originals: fresh.sources.map(s => s.document.anchors)});
        if (identity !== current) throw Error('原始請款或合併版本已有變動，請重新開啟');
        const data = preview(fresh, input.value);
        el('p', output, '建商核定總額：' + money(data.approvedGross));
        el('strong', output, '整張折讓：' + money(data.reduction) +
          '（' + data.reductionPercent.toFixed(2) + '%）');
        el('p', output, '原應收、已收款、保留款仍維持原帳。稅額／保留款／應收調整：待核對。');
        el('p', output, '注意事項：\n' +
          (data.locks.length ? data.locks.map(x => '• ' + x).join('\n') + '\n' : '') +
          '• 不可將整張折讓再次分配成逐張自動折讓。\n• 未提供儲存、入帳、發票或薪資修改功能。',
          'p40-15-warn');
        output.dataset.status = 'ok';
      } catch (error) {
        el('p', output, '停止試算：' + plain(error.message || error), 'p40-15-warn');
        output.dataset.status = 'blocked';
      }
    });
    input.focus();
    return {readOnly: true, canPost: false, close: quit};
  }
  return Object.freeze({preview, open, version: 'P40-15-readonly-1'});
});
