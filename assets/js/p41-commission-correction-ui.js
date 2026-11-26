(function () {
  'use strict';
  const TEXT = '僅建立待核對紀錄';
  const MAX_SELECTION = 100;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => typeof value === 'number' && Number.isFinite(value) ? 'NT$' + new Intl.NumberFormat('zh-TW', {maximumFractionDigits:0}).format(value) : '待確認';
  const signedMoney = value => typeof value === 'number' && Number.isFinite(value) ? (value > 0 ? '+' : value < 0 ? '−' : '') + money(Math.abs(value)) : '待確認';
  const owner = () => window.KusheAuthGate?.companyContext?.()?.role === 'owner';
  const basisLabel = value => value === 'preTax' ? '未稅' : value === 'taxIncluded' ? '含稅' : '歷史未記載';
  const receiptLabel = value => value?.receiptUnlocked === true ? '收款證據已核對' : value?.unlocked === true ? '已達收款門檻，證據待核對' : '收款尚未完整核對';
  const paymentLabel = value => value?.originalPaid === true ? '此戶有原付款紀錄' : value?.paidMonth === true ? '本月有付款，仍需核對此戶' : '未找到此戶付款選取紀錄';
  const $ = (selector, root = document) => root.querySelector(selector);
  let active = null;

  function reasons(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter(row => row && !seen.has(row.code + '\n' + row.message) && seen.add(row.code + '\n' + row.message));
  }
  function holdList(rows, compact = false) {
    const items = reasons(rows);
    if (!items.length) return '<span class="k25-muted">資料可供核對；尚未核定入帳</span>';
    return '<ul class="k25-reasons' + (compact ? ' is-compact' : '') + '">' + items.map(row => '<li>' + esc(row.message || row.code) + '</li>').join('') + '</ul>';
  }
  function allHouses(plan) {
    return (plan?.groups || []).flatMap(group => (group.workers || []).flatMap(worker => (worker.houses || []).map(house => ({...house, group, worker}))));
  }
  function hasDifference(group) {
    return (group.workers || []).some(worker => worker.conditionalDifference == null || worker.conditionalDifference !== 0);
  }
  function selectable(house) {
    return house.canCreateReview === true && !house.existingReviewId && typeof house.conditionalDifference === 'number' && Number.isFinite(house.conditionalDifference) && house.conditionalDifference !== 0;
  }
  function selectionKeys(node) {
    const perWorker = node.hasAttribute('data-k25-select-worker');
    const group = active.displayedGroups[Number(perWorker ? node.dataset.k25SelectWorker : node.dataset.k25SelectGroup)];
    const workers = perWorker ? [group?.workers?.[Number(node.dataset.k25WorkerIndex)]].filter(Boolean) : group?.workers || [];
    return workers.flatMap(worker => (worker.houses || []).filter(selectable).map(house => house.key));
  }
  function close() {
    if (!active || active.busy) return;
    const previous = active.returnFocus;
    active.pane.remove();
    document.body.style.overflow = active.previousOverflow;
    active = null;
    document.removeEventListener('keydown', onKey);
    if (previous?.isConnected) previous.focus();
  }
  function onKey(event) {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...active.pane.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]')].filter(node => !node.closest('[hidden]') && node.getClientRects().length);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !active.pane.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function status(message, error = false) {
    if (!active) return;
    const node = $('[data-k25-feedback]', active.pane);
    node.textContent = message;
    node.classList.toggle('is-error', error);
  }
  function readPlans() {
    if (!owner()) throw new Error('此項目限公司負責人檢視及建立紀錄。');
    const store = window.KuSheERPStore;
    if (!store?.commissionCorrectionPreview || !store?.commissionCorrectionReviews || !store?.createCommissionCorrectionReview) throw new Error('更正功能尚未載入，請儲存目前工作後重新整理頁面。');
    const plan = store.commissionCorrectionPreview();
    const ledger = store.commissionCorrectionReviews();
    if (!plan || !Array.isArray(plan.groups) || !ledger || !Array.isArray(ledger.records)) throw new Error('無法取得完整的核對清單，請稍後重新整理。');
    return {store, plan, ledger};
  }
  function selectionUpdate() {
    if (!active) return;
    const pane = active.pane, count = active.selected.size;
    $('[data-k25-selection-count]', pane).textContent = String(count);
    $('[data-k25-selected-summary]', pane).textContent = count ? '已選 ' + count + ' 筆戶別差額' : '先展開施工批次，選取要保留的差額紀錄';
    const reason = $('[data-k25-reason]', pane).value.trim();
    $('[data-k25-save]', pane).disabled = active.busy || active.stale || !owner() || active.plan.canCreateReview !== true || !count || count > MAX_SELECTION || reason.length < 4 || !$('[data-k25-confirm]', pane).checked;
    for (const node of pane.querySelectorAll('[data-k25-select-group],[data-k25-select-worker]')) {
      const keys = selectionKeys(node), all = keys.length > 0 && keys.every(key => active.selected.has(key));
      node.textContent = node.hasAttribute('data-k25-select-worker') ? (all ? '取消此員工選取' : '選取此員工差額') : (all ? '取消本批選取' : '選取本批差額');
    }
  }
  function groupCard(group, index) {
    const workers = group.workers || [];
    const keys = workers.flatMap(worker => (worker.houses || []).filter(selectable).map(house => house.key));
    const total = workers.every(worker => typeof worker.conditionalDifference === 'number' && Number.isFinite(worker.conditionalDifference)) ? workers.reduce((sum, worker) => sum + worker.conditionalDifference, 0) : null;
    const summaryRows = workers.map(worker => '<tr><th scope="row">' + esc(worker.employeeName || worker.employeeId) + '</th><td>' + money(worker.original) + '</td><td>' + money(worker.conditionalTarget) + '</td><td class="k25-delta">' + signedMoney(worker.conditionalDifference) + '</td><td>' + (worker.verifiedDifference == null ? '計算基準待確認' : '待核對') + '</td></tr>').join('');
    const taxSources = group.taxEvidence?.billingSources || [];
    const taxDetail = taxSources.length ? '<details class="k25-tax-evidence"><summary>核對原請款的稅別與金額</summary><p>以下為整張原請款金額。多批施工合併請款時，本批試算仍使用本批施工項目。</p><div class="k25-table-scroll"><table><thead><tr><th>原請款</th><th>計價方式</th><th>整張未稅額</th><th>整張含稅額</th></tr></thead><tbody>' + taxSources.map(source => '<tr><th scope="row">' + esc(source.number || source.billingId) + '</th><td>' + esc(source.taxMode || '歷史未記載') + '</td><td>' + money(source.preTaxAmount) + '</td><td>' + money(source.taxIncludedAmount) + '</td></tr>').join('') + '</tbody></table></div></details>' : '';
    const details = workers.map((worker, workerIndex) => '<details class="k25-worker"><summary>' + esc(worker.employeeName || worker.employeeId) + ' · ' + (worker.houses || []).length + ' 戶別明細</summary><div class="k25-group-toolbar"><p class="k25-basis">原抽成基準：' + basisLabel(worker.originalCommissionBasis) + ' · 原施工基準：' + basisLabel(worker.originalDailyCommissionBasis) + ' · 原計算基數：' + money(worker.originalBase) + '</p><button type="button" data-k25-select-worker="' + index + '" data-k25-worker-index="' + workerIndex + '" ' + (!(worker.houses || []).some(selectable) ? 'disabled' : '') + '>選取此員工差額</button></div>' + holdList(worker.holdReasons) + '<div class="k25-house-list">' + (worker.houses || []).map(house => {
      const enabled = selectable(house);
      return '<label class="k25-house' + (!enabled ? ' is-disabled' : '') + '"><input type="checkbox" data-k25-key="' + esc(house.key) + '" ' + (active.selected.has(house.key) ? 'checked ' : '') + (!enabled ? 'disabled' : '') + '><span class="k25-house-main"><strong>' + esc(house.house || '未指定戶別') + '</strong><small>原 ' + money(house.original) + ' → 試算 ' + money(house.conditionalTarget) + '</small><span class="k25-evidence-status"><span>' + receiptLabel(house.receipt) + '</span><span>' + paymentLabel(house.payment) + '</span></span>' + holdList(house.holdReasons, true) + '</span><span class="k25-house-amount"><b>' + signedMoney(house.conditionalDifference) + '</b><small>' + (house.existingReviewId ? '已保存待核對紀錄' : enabled ? '待核對' : '僅供檢視') + '</small></span></label>';
    }).join('') + '</div></details>').join('');
    return '<details class="k25-group" data-k25-group="' + index + '"><summary><span class="k25-group-heading"><small>' + esc(group.date || '日期待確認') + '</small><strong>' + esc(group.projectName || group.projectId || '案場待確認') + '</strong><span>' + workers.map(worker => esc(worker.employeeName || worker.employeeId)).join('、') + '</span></span><span class="k25-group-amount"><small>有條件試算差額</small><strong>' + signedMoney(total) + '</strong><span class="k25-badge">待核對</span></span></summary><div class="k25-group-content"><div class="k25-group-toolbar"><p>施工項目合計 <b>' + money(group.conditionalBase) + '</b> · 按每位員工比例試算</p><button type="button" data-k25-select-group="' + index + '" ' + (!keys.length ? 'disabled' : '') + '>選取本批差額</button></div>' + holdList(group.holdReasons) + '<div class="k25-table-scroll"><table><thead><tr><th>員工</th><th>原保存抽成</th><th>條件試算</th><th>差額</th><th>核對狀態</th></tr></thead><tbody>' + summaryRows + '</tbody></table></div><p class="k25-table-note">試算額尚未核定。戶別差額依原金額與試算金額各自分配後計算。</p>' + taxDetail + details + '</div></details>';
  }
  function renderGroups() {
    const groups = active.plan.groups.filter(hasDifference);
    const month = $('[data-k25-month]', active.pane).value;
    active.displayedGroups = groups.filter(group => !month || String(group.date || '').startsWith(month));
    $('[data-k25-groups]', active.pane).innerHTML = active.displayedGroups.map(groupCard).join('') || '<div class="k25-empty"><strong>此範圍沒有試算差額</strong><p>這表示本次核對未發現金額差異；已保存的待核對紀錄可在另一個分頁查看。</p></div>';
  }
  function renderLedger() {
    const rows = active.ledger.records;
    $('[data-k25-records]', active.pane).innerHTML = rows.map(record => '<article class="k25-record"><header><div><small>' + esc(record.date || '') + '</small><h3>' + esc(record.projectName || record.groupId || '來源待確認') + '</h3><p>' + esc(record.employeeName || record.employeeId || '') + ' · ' + esc(record.house || '未指定戶別') + '</p></div><span class="k25-badge' + (record.sourceChanged ? ' is-changed' : '') + '">' + (record.sourceChanged ? '來源已更新，需重新核對' : '已保存 · 待核對') + '</span></header><dl><div><dt>原保存抽成</dt><dd>' + money(record.original) + '</dd></div><div><dt>有條件試算</dt><dd>' + money(record.conditionalTarget) + '</dd></div><div><dt>條件差額</dt><dd>' + signedMoney(record.conditionalDifference) + '</dd></div></dl>' + holdList(record.sourceChanged ? record.currentHoldReasons : record.holdReasons) + '<footer><span>紀錄原因：' + esc(record.reason || '—') + '</span><time>' + esc(record.createdAt ? new Date(record.createdAt).toLocaleString('zh-TW', {timeZone:'Asia/Taipei',hour12:false}) : '') + '</time></footer></article>').join('') || '<div class="k25-empty"><strong>尚無更正核對紀錄</strong><p>從差異清單選取來源並填寫原因，即可保留一份待核對紀錄。</p></div>';
  }
  function render() {
    const pane = active.pane, relevant = active.plan.groups.filter(hasDifference);
    $('[data-k25-group-count]', pane).textContent = String(relevant.length);
    $('[data-k25-ledger-count]', pane).textContent = String(active.ledger.records.length);
    const months = [...new Set(relevant.map(group => String(group.date || '').slice(0, 7)).filter(month => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
    const monthControl = $('[data-k25-month]', pane), previous = monthControl.value;
    monthControl.innerHTML = '<option value="">全部月份</option>' + months.map(month => '<option value="' + esc(month) + '">' + esc(month) + '</option>').join('');
    if (months.includes(previous)) monthControl.value = previous;
    $('[data-k25-issues]', pane).innerHTML = holdList([...(active.plan.issues || []), ...(active.ledger.issues || [])]);
    $('[data-k25-issues]', pane).hidden = !((active.plan.issues || []).length || (active.ledger.issues || []).length);
    renderGroups(); renderLedger(); selectionUpdate();
  }
  function switchTab(name) {
    if (!active) return;
    active.tab = name;
    for (const node of active.pane.querySelectorAll('[data-k25-tab]')) {
      const selected = node.dataset.k25Tab === name;
      node.classList.toggle('is-active', selected); node.setAttribute('aria-selected', String(selected));
    }
    $('[data-k25-list-panel]', active.pane).hidden = name !== 'list';
    $('[data-k25-ledger-panel]', active.pane).hidden = name !== 'ledger';
    $('[data-k25-save-panel]', active.pane).hidden = name !== 'list';
  }
  function refresh() {
    if (!active || active.busy) return;
    try {
      Object.assign(active, readPlans());
      active.selected.clear(); active.stale = false;
      $('[data-k25-confirm]', active.pane).checked = false;
      render(); status('已重新核對目前資料。請依最新清單選取需要保留的紀錄。');
    } catch (error) { active.stale = true; status(String(error.message || error), true); selectionUpdate(); }
  }
  async function save() {
    if (!active || $('[data-k25-save]', active.pane).disabled) return;
    const current = active, pane = current.pane;
    if (!owner()) { status('登入權限已變更，請關閉此視窗重新核對。', true); current.stale = true; selectionUpdate(); return; }
    current.busy = true; selectionUpdate();
    for (const node of pane.querySelectorAll('button[data-k25-close],button[data-k25-refresh],button[data-k25-export]')) node.disabled = true;
    status('正在保存待核對紀錄…');
    try {
      const result = await current.store.createCommissionCorrectionReview({keys:[...current.selected],expectedSnapshot:current.plan.snapshot,confirmed:true,confirmationText:TEXT,reason:$('[data-k25-reason]', pane).value.trim()});
      if (!result?.created || !Array.isArray(result.recordIds) || result.recordIds.length !== current.selected.size || result.canApply !== false || result.canPost !== false || result.canPay !== false) throw new Error('提交回應無法完整確認。請重新核對已保存紀錄，不要重複提交。');
      const count = result.recordIds.length;
      Object.assign(current, readPlans()); current.selected.clear(); current.stale = false;
      $('[data-k25-confirm]', pane).checked = false; $('[data-k25-reason]', pane).value = '';
      render(); switchTab('ledger'); status('已保存 ' + count + ' 筆待核對紀錄。實際抽成與薪資金額尚未調整。');
    } catch (error) {
      current.stale = true;
      const uncertain = ['RECOVERY_REQUIRED','UNKNOWN','COMMITTED_WITH_NOTIFICATION_WARNING'].includes(String(error?.transactionStatus || ''));
      status((uncertain ? '提交狀態待確認，請先查看復原狀態及已保存紀錄，勿再次提交。 ' : '已停止提交，請重新核對清單。 ') + String(error.message || error), true);
      if (uncertain) window.KusheRecovery?.showResult?.(error);
    } finally {
      current.busy = false;
      for (const node of pane.querySelectorAll('button[data-k25-close],button[data-k25-refresh],button[data-k25-export]')) node.disabled = false;
      selectionUpdate();
    }
  }
  function exportReport() {
    if (!active || active.busy) return;
    try {
      const current = readPlans();
      const payload = {schema:'kushe-commission-correction-export-v1',createdAt:new Date().toISOString(),description:'歷史抽成條件試算與待核對紀錄；未核定入帳或付款。',preview:current.plan,reviews:current.ledger};
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json;charset=utf-8'}));
      const link = document.createElement('a');link.href = url;link.download = '酷舍ERP_歷史抽成核對_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.appendChild(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url), 3000);
      status('已發起核對清單下載。內容為試算與待核對紀錄。');
    } catch (error) { status(String(error.message || error), true); }
  }
  function open() {
    if (active) { $('[data-k25-close]', active.pane).focus(); return; }
    let data;
    try { data = readPlans(); } catch (error) { window.KushePhase1?.toast?.(String(error.message || error)); return; }
    const pane = document.createElement('div');pane.id = 'k25CommissionReview';pane.className = 'k25-overlay';
    pane.innerHTML = '<section class="k25-dialog" role="dialog" aria-modal="true" aria-labelledby="k25-review-title"><header class="k25-header"><div><small>抽成管理</small><h2 id="k25-review-title">歷史抽成更正核對</h2><p>保留原始金額，逐筆核對施工、稅別與付款來源。</p></div><button type="button" data-k25-close aria-label="關閉歷史抽成更正核對">關閉</button></header><div class="k25-stats"><div><span>待核對施工批次</span><strong data-k25-group-count>0</strong></div><div><span>已保存紀錄</span><strong data-k25-ledger-count>0</strong></div><div><span>本次選取戶別</span><strong data-k25-selection-count>0</strong></div></div><div class="k25-notice"><b>目前為更正前核對</b><span>保存紀錄會保留差額與待確認原因。核定金額、原薪資及實際付款需在後續確認。</span></div><nav class="k25-tabs" role="tablist" aria-label="歷史抽成核對內容"><button id="k25-list-tab" type="button" role="tab" aria-controls="k25-list-panel" aria-selected="true" class="is-active" data-k25-tab="list">差異清單</button><button id="k25-ledger-tab" type="button" role="tab" aria-controls="k25-ledger-panel" aria-selected="false" data-k25-tab="ledger">已保存紀錄</button><div class="k25-tools"><button type="button" data-k25-refresh>重新核對</button><button type="button" data-k25-export>下載核對清單</button></div></nav><div class="k25-content"><div data-k25-issues class="k25-global-issues" hidden></div><section id="k25-list-panel" role="tabpanel" aria-labelledby="k25-list-tab" data-k25-list-panel><div class="k25-filter"><label>施工月份 <select data-k25-month aria-label="施工月份"><option value="">全部月份</option></select></label><span>試算金額不代表已核定欠款</span></div><div data-k25-groups></div></section><section id="k25-ledger-panel" role="tabpanel" aria-labelledby="k25-ledger-tab" data-k25-ledger-panel hidden><div data-k25-records></div></section></div><footer class="k25-footer"><div data-k25-save-panel class="k25-save-panel"><div class="k25-reason-field"><label for="k25-review-reason">核對原因</label><textarea id="k25-review-reason" data-k25-reason rows="2" maxlength="500" placeholder="例如：核對歷史多人施工的抽成計算差額"></textarea></div><div class="k25-save-actions"><span data-k25-selected-summary></span><label class="k25-confirm"><input type="checkbox" data-k25-confirm>僅建立待核對紀錄，金額尚未核定</label><button type="button" data-k25-save class="k25-primary" disabled>保存待核對紀錄</button></div></div><p class="k25-feedback" data-k25-feedback role="status" aria-live="polite"></p></footer></section>';
    const previousOverflow = document.body.style.overflow;
    active = {...data,pane,previousOverflow,returnFocus:document.activeElement,selected:new Set(),displayedGroups:[],busy:false,stale:false,tab:'list'};
    document.body.appendChild(pane);document.body.style.overflow = 'hidden';
    pane.addEventListener('click', event => {
      const node = event.target.closest('button');if (!node || !active) return;
      if (node.hasAttribute('data-k25-close')) close();
      else if (node.hasAttribute('data-k25-refresh')) refresh();
      else if (node.hasAttribute('data-k25-export')) exportReport();
      else if (node.hasAttribute('data-k25-save')) save();
      else if (node.dataset.k25Tab) switchTab(node.dataset.k25Tab);
      else if ((node.hasAttribute('data-k25-select-group') || node.hasAttribute('data-k25-select-worker')) && !active.busy && !active.stale) {
        const keys = selectionKeys(node);
        const all = keys.every(key => active.selected.has(key));
        if (!all && new Set([...active.selected, ...keys]).size > MAX_SELECTION) { status('每次最多保存 100 個戶別。可展開員工明細，使用「選取此員工差額」分批保存。', true); return; }
        for (const key of keys) { if (all) active.selected.delete(key); else active.selected.add(key); }
        for (const field of pane.querySelectorAll('[data-k25-key]')) field.checked = active.selected.has(field.dataset.k25Key);
        selectionUpdate();
      }
    });
    pane.addEventListener('change', event => {
      const node = event.target;
      if (node.hasAttribute('data-k25-month')) renderGroups();
      if (node.hasAttribute('data-k25-key')) {
        if (active.busy || active.stale) {node.checked = active.selected.has(node.dataset.k25Key);return;}
        const row = allHouses(active.plan).find(house => house.key === node.dataset.k25Key);
        if (!row || !selectable(row)) {node.checked = false;return;}
        if (node.checked && active.selected.size >= MAX_SELECTION) {node.checked = false;status('每次最多保存 100 個戶別，請分批選取。', true);return;}
        if (node.checked) active.selected.add(node.dataset.k25Key);else active.selected.delete(node.dataset.k25Key);
      }
      selectionUpdate();
    });
    pane.addEventListener('input', selectionUpdate);
    document.addEventListener('keydown', onKey);
    render();$('[data-k25-close]', pane).focus();
  }
  document.addEventListener('click', event => { if (event.target?.closest?.('[data-k25-open]')) {event.preventDefault();open();} });
  window.addEventListener('kushe:data-updated', () => {
    if (!active || active.busy) return;
    active.stale = true;selectionUpdate();status('資料已有更新，請按「重新核對」取得最新清單。', true);
  });
  window.addEventListener('hashchange', () => {if (active && !active.busy) close();});
  window.addEventListener('focus', () => {if (active && !owner() && !active.busy) close();});
  window.KuSheK25CommissionReviewUI = Object.freeze({open,close});
}());
