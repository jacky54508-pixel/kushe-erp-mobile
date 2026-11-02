(function () {
  'use strict';
  var DATE = '2026-10-07';
  var list = function (x) { return Array.isArray(x) ? x : []; };
  var text = function (x) { return String(x == null ? '' : x); };
  var n = function (x) { return x == null || x === '' ? NaN : Number(x); };
  var equal = function (a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < 0.01; };
  var esc = function (x) { return text(x).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var money = function (x) { return Number.isFinite(x) ? '$' + Math.round(x).toLocaleString('en-US') : '待查核'; };
  var emp = function (x) { return text(x && (x.employee || x.employeeId)); };
  var proj = function (x) { return text(x && (x.project || x.projectId)); };

  function preview(state, batch, store) {
    if (!state || !batch || batch.date !== DATE || !list(batch.logs).length) return null;
    var byGroup = new Map(), groups = [], allIssues = [], allWarnings = [], oldTotal = 0, afterTotal = 0, counted = 0;
    list(batch.logs).forEach(function (log) {
      var key = text(log.groupId || log.id);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(log);
    });
    var payrollViews = store && store.monthlyPayrollGroups ? list(store.monthlyPayrollGroups()) : [];
    byGroup.forEach(function (logs, groupId) {
      var first = logs[0], sum = n(first.groupTotal), issues = [], warnings = [];
      var sourceItems = list(first.items), itemsTotal = sourceItems.reduce(function (total, item) {
        var value = n(item.untaxedSubtotal);
        return total + (Number.isFinite(value) ? value : n(item.qty)*n(item.price));
      }, 0);
      var sameGroup = sum > 0 && logs.every(function (log) { return equal(n(log.groupTotal), sum) && proj(log) === proj(first); });
      var sourceOK = sourceItems.length > 0 && equal(itemsTotal, sum);
      if (logs.length !== 2) issues.push('此來源員工人數不是兩人');
      if (!sameGroup) issues.push('同組施工總額或案場不一致');
      if (!sourceOK) issues.push('施工明細未稅總額無法核對');
      var billing = batch.billingSummary && batch.billingSummary.groups && batch.billingSummary.groups.get(groupId);
      if (billing && billing.inconsistentItemCount) issues.push('請款明細存在待查核來源');
      var itemBillingIds = Array.from(new Set(sourceItems.map(function (x) { return text(x.billingId); }).filter(Boolean)));
      var refBillingIds = list(state.billings).filter(function (bill) {
        var refs = list(bill.sourceItemRefs).concat(list(bill.lines).flatMap(function (line) { return list(line.sourceRefs); }));
        return refs.some(function (ref) { return text(ref.sourceGroupKey) === groupId; });
      }).map(function (x) { return text(x.id); });
      if (refBillingIds.some(function (id) { return !itemBillingIds.includes(id); })) issues.push('請款單來源引用與施工紀錄 ID 不一致');
      var billingIds = Array.from(new Set(itemBillingIds.concat(refBillingIds)));
      var actualBills = billingIds.map(function (id) { return list(state.billings).filter(function (x) { return text(x.id) === id; }); });
      if (actualBills.some(function (rows) { return rows.length !== 1; })) issues.push('請款單 ID 無法唯一追溯');
      var arIds = actualBills.flatMap(function (rows) { return rows.length === 1 ? list(state.receivables).filter(function (r) { return text(r.billingId) === text(rows[0].id); }).map(function (r) { return text(r.id); }) : []; });
      var receiptCount = list(state.receipts).filter(function (r) { return arIds.includes(text(r.receivableId)); }).length;
      var employees = logs.map(function (log) {
        var id = emp(log), month = text(log.date).slice(0,7), person = list(state.employees).find(function (x) { return text(x.id) === id; });
        var name = (person && person.name) || log.employeeName || '未知員工', rate = n(log.rate), old = n(log.commission);
        var basis = log.commissionBasis === 'taxIncluded' ? 'taxIncluded' : 'preTax';
        var base = basis === 'preTax' ? sum : n(log.taxIncludedCommissionBaseAmount);
        var valid = logs.length === 2 && sameGroup && sourceOK && Number.isFinite(rate) && rate >= 0 && rate <= 100 && Number.isFinite(old) && Number.isFinite(base) && base >= 0;
        var after = valid ? Math.round(base * rate / 100) : NaN;
        if (!valid) issues.push(name + '：原始抽成比例或計算基準不完整');
        var linked = list(state.commissions).filter(function (row) { return row.sourceType === 'daily-log' && text(row.sourceId) === text(log.id); });
        var linkOK = linked.length === 1 && emp(linked[0]) === id && equal(n(linked[0].commission), old);
        if (!linkOK) issues.push(name + '：抽成來源缺漏、重複或金額不一致');
        var payrollRecords = list(state.payroll).filter(function (row) { return emp(row) === id && text(row.month).slice(0,7) === month; });
        var view = payrollViews.find(function (row) { return text(row.employeeId) === id && text(row.month).slice(0,7) === month; });
        var sourceInPayroll = list(view && view.sources).filter(function (row) { return row.type === '抽成' && row.sourceType === 'daily-log' && text(row.sourceId) === text(log.id); });
        if (linkOK && linked[0].status === '已列入薪資' && sourceInPayroll.length !== 1) issues.push(name + '：薪資來源無法唯一追溯');
        var salaryLocked = false, settlementLocked = false;
        try { salaryLocked = Boolean(store && store.payrollHistoryLock && store.payrollHistoryLock(id, month).locked); }
        catch (error) { issues.push(name + '：薪資付款鎖定狀態無法讀取'); }
        try { settlementLocked = Boolean(store && store.dailyLogCommissionSettlementLock && store.dailyLogCommissionSettlementLock(log).locked); }
        catch (error) { issues.push(name + '：抽成結算狀態無法讀取'); }
        if (salaryLocked) warnings.push(name + ' 10 月薪資已有付款，禁止直接改舊帳');
        if (settlementLocked) warnings.push(name + ' 抽成已有案場結算，禁止重複發放');
        if (Number.isFinite(old)) oldTotal += old;
        if (Number.isFinite(after)) { afterTotal += after; counted++; }
        return {name:name,performance:n(log.performance),rate:rate,old:old,after:after,difference:after-old,lock:salaryLocked,settled:settlementLocked,payrollStatus:(view && view.status) || (payrollRecords[0] && payrollRecords[0].status) || '尚無薪資彙總',sourceOK:linkOK};
      });
      groups.push({project:(list(state.projects).find(function (x) { return text(x.id) === proj(first); }) || {}).name || first.projectName || '未指定案場',amount:sum,billingStatus:(billing && billing.status) || (billingIds.length ? '來源待核對' : '未請款'),billingCount:actualBills.filter(function (x) { return x.length === 1; }).length,receiptCount:receiptCount,employees:employees,issues:issues});
      allIssues.push.apply(allIssues, issues);
      allWarnings.push.apply(allWarnings, warnings);
    });
    var complete = counted === batch.logs.length;
    return {readOnly:true,date:batch.date,groups:groups,oldTotal:oldTotal,afterTotal:complete?afterTotal:NaN,difference:complete?afterTotal-oldTotal:NaN,issues:Array.from(new Set(allIssues)),warnings:Array.from(new Set(allWarnings))};
  }

  function render(state, batch, store) {
    var audit = preview(state, batch, store);
    if (!audit) return '';
    var html = '<details class="p33-preview"><summary>10/7 歷史抽成差異核對（唯讀）</summary><div class="p33-preview-body">';
    html += '<p>僅預覽差額，<strong>不儲存、不修改歷史薪資、不重算請款或執行付款</strong>。</p>';
    html += '<div class="p33-preview-totals"><span>原抽成 <b>'+money(audit.oldTotal)+'</b></span><span>試算抽成 <b>'+money(audit.afterTotal)+'</b></span><span>差額 <b>'+money(audit.difference)+'</b></span></div>';
    audit.groups.forEach(function (group) {
      html += '<div class="p33-preview-group"><h4>'+esc(group.project)+'｜未稅施工額 '+money(group.amount)+'</h4>';
      html += '<div class="p33-preview-scroll"><table><thead><tr><th>員工</th><th>原業績</th><th>比例</th><th>原抽成</th><th>試算抽成</th><th>差額</th><th>薪資與結算</th></tr></thead><tbody>';
      group.employees.forEach(function (row) {
        html += '<tr><td>'+esc(row.name)+'</td><td>'+money(row.performance)+'</td><td>'+(Number.isFinite(row.rate)?esc(row.rate)+'%':'待查核')+'</td><td>'+money(row.old)+'</td><td>'+money(row.after)+'</td><td>'+money(row.difference)+'</td><td>'+esc(row.payrollStatus)+(row.lock?'｜已付款鎖定':'')+(row.settled?'｜案場抽成已發':'')+(row.sourceOK?'':'｜來源待查核')+'</td></tr>';
      });
      html += '</tbody></table></div><p>請款：'+esc(group.billingStatus)+'；連結請款單 '+group.billingCount+' 張；收款紀錄 '+group.receiptCount+' 筆。</p>';
      if (group.issues.length) html += '<p class="p33-preview-warning">人工確認：'+group.issues.map(esc).join('；')+'</p>';
      html += '</div>';
    });
    if (audit.warnings.length) html += '<p class="p33-preview-warning">付款保護：'+audit.warnings.map(esc).join('；')+'</p>';
    html += '<p class="p33-preview-footnote">根據此裝置已載入的 ERP 紀錄試算；此預覽不代表已核准更正，且無任何儲存按鈕。</p></div></details>';
    return html;
  }
  window.KuSheP33HistoricalPreview = Object.freeze({preview:preview,render:render});
}());
