(function () {
  'use strict';
  const store=window.KuSheERPStore,$=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=(value)=>`$${new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(Math.round(store.num(value)))}`,today=()=>new Date().toISOString().slice(0,10);
  let active=false,ready=false,expanded='';
  const bankName=(id,state)=>state.banks.find((row)=>row.id===id)?.name||'未指定';
  function closeModal(){document.querySelector('.erp-detail-overlay')?.remove()}
  function groups(){return store.monthlyPayrollGroups()}
  function groupFor(reference){return groups().find((group)=>group.key===reference||group.recordIds.some((id)=>String(id)===String(reference)))}
  function paymentForm(group,payment,state,token){
    const otherPaid=group.history.filter((row)=>row!==payment).reduce((sum,row)=>sum+store.num(row.amount),0),maximum=Math.max(0,store.num(group.total)-otherPaid),editing=Boolean(payment),selectedBank=payment?.bankAccountId||payment?.bankId||'',selectedPayer=payment?.feePayer==='recipient'?'recipient':'company';
    return `<section class="erp-detail-card receipt-card" role="dialog" aria-modal="true"><header><div><span>員工薪資付款</span><h2>${editing?'編輯薪資付款':esc(group.employeeName)}</h2><p>${esc(group.month||'—')}｜薪資總額 ${money(group.total)}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="${editing?'editSalaryPaymentForm':'salaryPaymentForm'}"><div class="erp-detail-body"><div class="billing-detail-summary payable-preview"><span>薪資總額<b>${money(group.total)}</b></span><span>已付金額<b>${money(group.paid)}</b></span><span>未付金額<b>${money(group.outstanding)}</b></span><span>實際扣款<b id="salaryActualDebit">${money(payment?.actualDebit??(store.num(payment?.amount)||group.outstanding))}</b></span></div><div class="receipt-form-grid"><label><span>付款日期</span><input name="date" type="date" value="${esc(payment?.date||today())}" required></label><label><span>本次付款金額</span><input name="amount" type="number" min="1" max="${maximum}" value="${store.num(payment?.amount)||group.outstanding}" required></label><label><span>付款銀行帳戶</span><select name="bankId" required><option value="">請選擇帳戶</option>${state.banks.map((bank)=>`<option value="${esc(bank.id)}" ${bank.id===selectedBank?'selected':''}>${esc(bank.name||bank.bank||bank.account||'銀行帳戶')}</option>`).join('')}</select></label><label><span>付款方式</span><select name="paymentMethod">${['銀行轉帳','現金','支票','其他'].map((value)=>`<option ${payment?.paymentMethod===value?'selected':''}>${value}</option>`).join('')}</select></label><label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="${store.num(payment?.fee)}"></label><label><span>手續費負擔方式</span><select name="feePayer"><option value="company" ${selectedPayer==='company'?'selected':''}>公司負擔</option><option value="recipient" ${selectedPayer==='recipient'?'selected':''}>員工負擔</option></select></label><label class="payable-note-field"><span>備註</span><input name="note" value="${esc(payment?.note||'')}"></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">${editing?'儲存修改':'確認付款'}</button></footer></form></section>`;
  }
  function openPayment(groupKey,paymentId=''){
    const state=store.getState(),payment=state.salaryPayments.find((row)=>row.id===paymentId),group=groupFor(payment?.payrollId||groupKey);
    if(!group)return;
    if(!payment&&!group.outstanding)return window.KushePhase1.toast('此筆薪資已付清');
    const token=`salary-${group.primaryPayrollId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,overlay=document.createElement('div');
    overlay.className='erp-detail-overlay';overlay.innerHTML=paymentForm(group,payment,state,token);document.body.appendChild(overlay);
    $$('[data-close-detail]',overlay).forEach((button)=>button.onclick=closeModal);
    const form=$('form',overlay),refresh=()=>{const amount=Math.max(0,Number($('[name="amount"]',form).value)||0),fee=Math.max(0,Number($('[name="fee"]',form).value)||0),company=$('[name="feePayer"]',form).value==='company';$('#salaryActualDebit',overlay).textContent=money(company?amount+fee:amount)};
    ['amount','fee','feePayer'].forEach((name)=>$(`[name="${name}"]`,form).oninput=refresh);
    form.onsubmit=async(event)=>{event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;try{const fd=new FormData(form),values={payrollId:group.primaryPayrollId,date:fd.get('date'),amount:fd.get('amount'),bankId:fd.get('bankId'),paymentMethod:fd.get('paymentMethod'),fee:fd.get('fee'),feePayer:fd.get('feePayer'),note:fd.get('note'),idempotencyKey:token};if(payment)await store.updateSalaryPayment(payment.id,values);else await store.addSalaryPayment(values);closeModal();expanded=group.key;render();window.KushePhase1.toast(payment?'薪資付款與銀行交易已同步更新':'薪資付款已同步銀行')}catch(error){window.KushePhase1.toast(error.message||String(error));button.disabled=false}};
  }
  function sourceTable(group){
    if(!group.sources.length)return '<p class="receipt-history-empty">尚無可追溯的薪資來源明細</p>';
    return `<table><thead><tr><th>日期</th><th>類型</th><th>案場</th><th>內容</th><th>數量／比例</th><th>單價／基準</th><th class="num">金額</th></tr></thead><tbody>${group.sources.map((source)=>`<tr><td>${esc(source.date||'—')}</td><td>${esc(source.type||'—')}</td><td>${esc(source.projectName||'—')}</td><td>${esc(source.content||'—')}</td><td>${esc(source.quantityLabel||'—')}</td><td>${esc(source.rateLabel||'—')}</td><td class="num">${money(source.amount)}</td></tr>`).join('')}</tbody></table>`;
  }
  function paymentTable(group,state){
    if(!group.history.length)return '<p class="receipt-history-empty">尚無付款紀錄</p>';
    return `<table><thead><tr><th>付款日期</th><th class="num">本次付款</th><th>銀行帳戶</th><th>付款方式</th><th class="num">手續費</th><th class="num">實際扣款</th><th>備註</th><th>操作</th></tr></thead><tbody>${group.history.map((payment)=>`<tr><td>${esc(payment.date||'—')}</td><td class="num">${money(payment.amount)}</td><td>${esc(bankName(payment.bankAccountId||payment.bankId,state))}</td><td>${esc(payment.paymentMethod||'銀行轉帳')}</td><td class="num">${money(payment.fee)}</td><td class="num">${money(payment.actualDebit??payment.amount)}</td><td>${esc(payment.note||'—')}</td><td>${payment.readOnly?'<span class="commission-status is-settled">歷史付款（唯讀）</span>':`<button class="commission-link" type="button" data-salary-edit="${esc(payment.id)}">編輯</button> <button class="commission-link" type="button" data-salary-delete="${esc(payment.id)}">刪除</button>`}</td></tr>`).join('')}</tbody></table>`;
  }
  function render(){
    if(!active)return;
    const state=store.getState(),rows=groups();
    $('#payrollApp').innerHTML=`<section class="commissions-heading"><div><h1>薪資管理</h1><p>依員工與月份彙總既有薪資來源，並沿用分次付款與銀行支出。</p></div></section><section class="commission-panel billing-list-panel"><div class="commission-table-wrap"><table class="commission-table"><thead><tr><th>月份</th><th>員工</th><th class="num">薪資總額</th><th class="num">已付</th><th class="num">未付</th><th>付款狀態</th><th>操作</th></tr></thead><tbody>${rows.map((group)=>{const open=expanded===group.key;return `<tr><td>${esc(group.month||'—')}</td><td><b>${esc(group.employeeName)}</b>${group.history.length?`<span class="receipt-count-badge">${group.history.length} 次付款</span>`:''}</td><td class="num"><b>${money(group.total)}</b></td><td class="num">${money(group.paid)}</td><td class="num"><b>${money(group.outstanding)}</b></td><td><span class="commission-status ${group.status==='已付清'?'settled':group.status==='部分付款'?'partial':''}">${group.status}</span></td><td><div class="receivable-actions">${group.outstanding>0?`<button class="commission-primary compact" type="button" data-salary-pay="${esc(group.key)}">付款</button>`:''}<button class="receivable-expand" type="button" data-salary-expand="${esc(group.key)}" aria-expanded="${open}"><span>${open?'⌃':'⌄'}</span></button></div></td></tr>${open?`<tr class="receipt-history-row"><td colspan="7"><section class="receipt-history"><h3>薪資來源明細</h3>${sourceTable(group)}<h3>薪資付款紀錄</h3>${paymentTable(group,state)}</section></td></tr>`:''}`}).join('')||'<tr><td colspan="7" class="billing-empty">目前沒有薪資紀錄。</td></tr>'}</tbody></table></div></section>`;
    $$('[data-salary-pay]').forEach((button)=>button.onclick=()=>openPayment(button.dataset.salaryPay));
    $$('[data-salary-expand]').forEach((button)=>button.onclick=()=>{expanded=expanded===button.dataset.salaryExpand?'':button.dataset.salaryExpand;render()});
    $$('[data-salary-edit]').forEach((button)=>button.onclick=()=>{const payment=state.salaryPayments.find((row)=>row.id===button.dataset.salaryEdit);if(payment)openPayment('',payment.id)});
    $$('[data-salary-delete]').forEach((button)=>button.onclick=async()=>{if(!window.confirm('確定刪除此薪資付款？銀行支出會同步沖回。'))return;try{await store.deleteSalaryPayment(button.dataset.salaryDelete);render();window.KushePhase1.toast('薪資付款已刪除，銀行餘額已還原')}catch(error){window.KushePhase1.toast(error.message||String(error))}});
    window.KusheIcons?.render($('#payrollApp'));
  }
  async function activate(){active=true;if(!ready){await store.load();ready=true}render()}
  function deactivate(){active=false;closeModal()}
  window.addEventListener('kushe:data-updated',()=>{if(active)render()});
  window.KushePayroll={activate,deactivate,render};
}());
