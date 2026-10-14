from pathlib import Path
import sys,re
root=Path(sys.argv[1])
p=root/'assets/js/payroll.js';s=p.read_text()
def replace(old,new,n=1):
 global s
 assert s.count(old)==n,(old[:100],s.count(old),n)
 s=s.replace(old,new)
replace("  const adjustmentDescriptions={other:['otherNote','例如：臨時獎勵、補貼原因'],deduction:['deductionNote','例如：預支沖抵、工具賠償、其他扣款原因']};", "  const adjustmentDescriptions={other:['otherNote','其他加項說明','例如：日期／案場／補貼或代墊原因'],deduction:['deductionNote','其他扣項說明','例如：日期／案場／預支沖抵或扣款原因']};")
replace('''    return fields.map(([name,label])=>`<label class="payroll-adjustment-field"><span>${label}</span><span class="payroll-adjustment-money"><i aria-hidden="true">$</i><input name="${name}" aria-label="${label}" type="number" inputmode="numeric" min="0" step="1" value="${store.num(group[name])}"></span></label>`).join('');''','''    // P29-4: keep the existing monetary/note names and writer; notes are next to their amount.
    return fields.map(([name,label])=>{
      const description=adjustmentDescriptions[name],amount=`<label class="payroll-adjustment-field"><span>${label}</span><span class="payroll-adjustment-money"><i aria-hidden="true">$</i><input name="${name}" aria-label="${label}" type="number" inputmode="numeric" min="0" step="1" value="${store.num(group[name])}"></span></label>`;
      return description?`<div class="payroll-inline-note-row">${amount}<label class="payroll-inline-note"><span>${description[1]} <small>選填</small></span><textarea name="${description[0]}" aria-label="${description[1]}" rows="2" placeholder="${description[2]}">${esc(group[description[0]]||'')}</textarea></label></div>`:amount;
    }).join('');''')
replace("    const hasNotes=Boolean(group.otherNote||group.deductionNote||group.payrollAdjustmentNote);\n",'')
replace("${deductions>0?'open':''}","${deductions>0||group.deductionNote?'open':''}")
old='''<details class="payroll-adjustment-fold" ${hasNotes?'open':''}><summary><span>說明與備註</span><em>編輯</em></summary><div class="payroll-fold-body payroll-adjustment-notes"><label><span>其他加項說明</span><input name="otherNote" value="${esc(group.otherNote||'')}" placeholder="例如：臨時獎勵、補貼原因"></label><label><span>其他扣項說明</span><input name="deductionNote" value="${esc(group.deductionNote||'')}" placeholder="例如：預支沖抵、工具賠償"></label><label class="payroll-note-wide"><span>薪資調整備註</span><textarea name="adjustmentNote" rows="2">${esc(group.payrollAdjustmentNote||'')}</textarea></label></div></details>'''
new='''<section class="payroll-month-note"><label><span>本月備註 <small>選填，可補充油資、餐費及其他說明</small></span><textarea name="adjustmentNote" aria-label="本月備註" rows="2" placeholder="例如：油資日期、補貼原因；代收工程款請另至應收帳款登記">${esc(group.payrollAdjustmentNote||'')}</textarea></label><details class="payroll-cash-help"><summary>員工在案場收現金，該記在哪裡？</summary><div><p><b>代收客戶工程款：</b>到「應收帳款 → 收款」，收款類型選「員工現金代收」，填員工、日期、金額與案場說明；繳回時再到「員工代收款」確認繳回。</p><p><b>薪資備註僅作說明：</b>不會沖銷應收、標記現金繳回或自動抵薪。請勿把代收工程款直接當成其他扣項，以免重複扣款。</p></div></details></section>'''
replace(old,new)
a=s.index('  function payrollGroupActions(group,presentation){');b=s.index('  function payrollMobileFields',a)
s=s[:a]+'''  function payrollGroupActions(group,presentation){
    const context=esc(`${group.employeeName} ${group.month}`),lockedReason='此月份已有付款紀錄，薪資調整已鎖定；請先核對付款紀錄。';
    const adjustment=presentation.adjustmentLocked?`<button class="payroll-action-secondary" type="button" disabled title="${lockedReason}" aria-label="${context} 薪資調整已鎖定">調整</button>`:`<button class="payroll-action-secondary" type="button" data-salary-adjust="${esc(group.key)}" aria-label="${context} 薪資調整">調整</button>`;
    const reason=presentation.statusLabel==='付款鎖定'?'付款來源待核對，暫不可付款':presentation.waitingReceipt?'對應工程款尚未收清，抽成暫不可發放':presentation.statusLabel==='已付款'?'此月份目前沒有可付餘額':'目前沒有可付款金額';
    const payment=presentation.canPay?`<button class="commission-primary payroll-action-pay" type="button" data-salary-pay="${esc(group.key)}" aria-label="${context} 開啟付款確認">付款</button>`:`<button class="payroll-action-pay" type="button" disabled title="${reason}" aria-label="${context} ${reason}">付款</button>`;
    const pdf=`<button class="payroll-action-secondary" type="button" data-salary-pdf="${esc(group.key)}" aria-label="${context} 薪資單 PDF" title="查看／列印薪資單 PDF">薪資單</button>`;
    return `<span class="payroll-action-slot">${payment}</span><span class="payroll-action-slot">${adjustment}</span><span class="payroll-action-slot">${pdf}</span>`;
  }
  function payrollDetailButton(group,presentation){
    const label=presentation.open?'收合明細':'展開明細';
    return `<button class="payroll-detail-toggle" type="button" data-salary-expand="${esc(group.key)}" aria-expanded="${presentation.open}" aria-label="${esc(`${group.employeeName} ${group.month} ${label}`)}"><svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${presentation.open?'收合':'明細'}</span></button>`;
  }
''' + s[b:]
replace("'<div class=\"payroll-mobile-actions\">'+payrollGroupActions", "'<div class=\"payroll-mobile-actions payroll-primary-actions\">'+payrollGroupActions")
replace('payroll-center-table"><thead','payroll-center-table payroll-actions-v4"><thead')
replace('<th class="num payroll-current-payable-head">目前可付款</th><th>狀態</th><th>操作</th>', '<th class="num payroll-current-payable-head">目前可付款／狀態</th><th>操作</th>')
replace('<td class="num payroll-current-payable"><b>${money(insight.currentPayable)}</b></td><td><span class="commission-status ${presentation.statusClass}">${esc(presentation.statusLabel)}</span></td>', '<td class="num payroll-current-payable"><b>${money(insight.currentPayable)}</b><span class="commission-status ${presentation.statusClass}">${esc(presentation.statusLabel)}</span></td>')
replace('colspan="9"','colspan="8"',2)
replace("    $$('[data-salary-expand]').forEach((button)=>button.onclick=()=>{expanded=expanded===button.dataset.salaryExpand?'':button.dataset.salaryExpand;render()});", """    $$('[data-salary-expand]').forEach((button)=>button.onclick=()=>{
      const key=button.dataset.salaryExpand,selector=button.closest('.payroll-mobile-list')?'.payroll-mobile-list':'.payroll-desktop-table';
      expanded=expanded===key?'':key;render();
      // Keep keyboard focus on the same employee/month after replacing the list.
      const host=$(selector,$('#payrollApp'));$$('[data-salary-expand]',host||$('#payrollApp')).find(node=>node.dataset.salaryExpand===key)?.focus({preventScroll:true});
    });""")
p.write_text(s)
p=root/'index.html';s=p.read_text()
matches=re.findall(r'  <link rel="stylesheet" href="assets/css/payroll-adjustments.css[^\n]+',s);assert len(matches)==1
s=s.replace(matches[0],matches[0]+'\n  <link rel="stylesheet" href="assets/css/payroll-actions-notes.css?v=p29-4-actions-notes-1">')
s,n=re.subn(r'assets/js/payroll.js\?v=[^"\s]+','assets/js/payroll.js?v=p29-4-actions-notes-1',s);assert n==1
p.write_text(s)
