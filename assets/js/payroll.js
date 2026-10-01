(function () {
  'use strict';
  const store=window.KuSheERPStore,$=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const businessDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
  const today=(date=new Date())=>{const parts=Object.fromEntries(businessDateFormatter.formatToParts(date).map((part)=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`};
  const money=(value)=>`$${new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(Math.round(store.num(value)))}`;
  let active=false,ready=false,expanded='';
  let pendingNavigationTarget=null,activationToken=0,navigationFrame=null;
  const bankName=(id,state)=>state.banks.find((row)=>row.id===id)?.name||'未指定';
  function closeModal(){document.querySelector('.erp-detail-overlay')?.remove()}
  function groups(){return store.monthlyPayrollGroups()}
  function groupFor(reference){return groups().find((group)=>group.key===reference||group.recordIds.some((id)=>String(id)===String(reference)))}
  function performanceMap(month){return new Map((store.employeePerformanceSummary?.(month)||[]).map((row)=>[String(row.employeeId),row]))}
  function releaseRowsFor(group){
    return (store.commissionReleasePool?.()||[]).filter((row)=>String(row.employeeId||'')===String(group.employeeId||'')&&String(row.month||'')===String(group.month||''));
  }
  function payrollInsight(group,performanceByEmployee){
    const performance=performanceByEmployee.get(String(group.employeeId||''))||{performance:0,days:0,projectCount:0},plan=store.salaryPaymentPlan(group.key,[]);
    const releaseRows=releaseRowsFor(group),unlockedRows=releaseRows.filter((row)=>row.unlocked&&!row.settled),lockedRows=releaseRows.filter((row)=>!row.unlocked&&!row.settled),settledRows=releaseRows.filter((row)=>row.settled);
    return {
      performance:store.num(performance.performance),
      performanceDays:store.num(performance.days),
      performanceProjects:store.num(performance.projectCount),
      dayWagePayable:store.num(plan.baseOutstanding),
      unlockedCommission:store.num(plan.availableCommission),
      lockedCommission:store.num(plan.lockedCommission),
      settledCommission:store.num(plan.settledCommission),
      currentPayable:store.num(plan.currentPayable),
      paymentBlocked:!plan.allowed,
      paymentBlockers:plan.blockers||[],
      releaseRows,unlockedRows,lockedRows,settledRows
    };
  }
  function releaseStatusClass(row){return row.settled?'settled':row.unlocked?'is-success':row.releaseStatus==='部分收款'?'partial':'is-warning'}
  function releaseStatusLabel(row){return row.settled?'已發':row.unlocked?'可發':row.releaseStatus||'未解鎖'}
  function releaseSourceLabel(row){
    const customer=row.customerName||'—',project=row.projectName||'—',house=row.house||'未指定戶別',billing=(row.billingNumbers||[]).join('、');
    return {customer,project,house,billing:billing||'—'};
  }
  function releaseTable(group,insight){
    if(!insight.releaseRows.length)return '<p class="receipt-history-empty">目前沒有抽成來源。</p>';
    return `<div class="payroll-release-wrap"><table class="payroll-release-table"><thead><tr><th>建設公司</th><th>案場</th><th>戶別</th><th>請款單</th><th class="num">業績</th><th class="num">抽成</th><th>收款／發放狀態</th></tr></thead><tbody>${insight.releaseRows.map((row)=>{const source=releaseSourceLabel(row);return `<tr><td>${esc(source.customer)}</td><td>${esc(source.project)}</td><td>${esc(source.house)}</td><td>${esc(source.billing)}</td><td class="num">${money(row.untaxedAmount)}</td><td class="num"><b>${money(row.amount)}</b></td><td><span class="commission-status ${releaseStatusClass(row)}">${esc(releaseStatusLabel(row))}</span>${!row.unlocked&&!row.settled?`<small class="payroll-release-note">${esc(row.releaseStatus||'尚未解鎖')}</small>`:''}</td></tr>`}).join('')}</tbody></table></div>`;
  }
  function releaseMobileCards(insight){
    if(!insight.releaseRows.length)return '<p class="receipt-history-empty">目前沒有抽成來源。</p>';
    return '<div class="payroll-release-mobile-list">'+insight.releaseRows.map((row)=>{const source=releaseSourceLabel(row);return '<article class="payroll-release-mobile-card">'+payrollMobileFields([['建設公司',esc(source.customer)],['案場',esc(source.project)],['戶別',esc(source.house)],['請款單',esc(source.billing)],['業績',money(row.untaxedAmount)],['抽成',money(row.amount)]])+'<footer><span class="commission-status '+releaseStatusClass(row)+'">'+esc(releaseStatusLabel(row))+'</span>'+(row.unlocked||row.settled?'':'<small>'+esc(row.releaseStatus||'尚未解鎖')+'</small>')+'</footer></article>'}).join('')+'</div>';
  }
  const adjustmentAdditions=[['manualFuel','額外油資'],['meal','餐費'],['overtime','加班'],['bonus','獎金'],['allowance','其他津貼'],['other','其他加項']],adjustmentDeductions=[['advance','預支'],['laborInsurance','勞健保'],['incomeTax','所得稅'],['deduction','其他扣項']];
  const adjustmentDescriptions={other:['otherNote','例如：臨時獎勵、補貼原因'],deduction:['deductionNote','例如：預支沖抵、工具賠償、其他扣款原因']};
  function adjustmentInputs(fields,group){return fields.map(([name,label])=>{const description=adjustmentDescriptions[name];return `<label><span>${label}</span><input name="${name}" type="number" min="0" step="1" value="${store.num(group[name])}"></label>${description?`<label><span>說明</span><input name="${description[0]}" value="${esc(group[description[0]]||'')}" placeholder="${description[1]}"></label>`:''}`}).join('')}
  function projectCommissionBasisRows(group){
    const state=store.getState(),logs=(state.dailyLogs||[]).filter((log)=>String(log.employee||'')===String(group.employeeId||'')&&String(log.date||'').slice(0,7)===String(group.month||'')),map=new Map();
    logs.forEach((log)=>{const projectId=String(log.project||'');if(!projectId)return;const project=state.projects.find((row)=>String(row.id)===projectId),entry=map.get(projectId)||{projectId,projectName:project?.name||log.projectName||'—',commission:0,bases:new Set()};entry.commission+=store.num(log.commission);entry.bases.add(log.commissionBasis==='taxIncluded'?'taxIncluded':'preTax');map.set(projectId,entry)});
    return [...map.values()].map((row)=>{const amounts=store.projectCommissionBasisAmounts(group.employeeId,group.month,row.projectId);return {...row,preTax:amounts.preTax,taxIncluded:amounts.taxIncluded,amountSource:amounts.source,resolved:amounts.resolved,billingNumbers:amounts.billingNumbers||[],basis:row.bases.size===1?[...row.bases][0]:'mixed'}}).sort((a,b)=>a.projectName.localeCompare(b.projectName,'zh-Hant'));
  }
  function projectCommissionBasisSection(group){
    const rows=projectCommissionBasisRows(group);if(!rows.length)return '';
    return `<section class="payroll-adjustment-section payroll-commission-basis-section"><div class="payroll-adjustment-section-heading"><div><span class="payroll-section-eyebrow">案場別設定</span><h3>案場抽成計算基準</h3><p>只影響此員工、此月份、此案場尚未付款的抽成；每日施工與請款金額不會改動。</p></div><span class="payroll-safe-badge">安全調整</span></div><div class="payroll-commission-basis-list">${rows.map((row)=>{const basisLabel=row.basis==='taxIncluded'?'含稅抽成':row.basis==='preTax'?'未稅抽成':'混合基準';return `<article class="payroll-commission-basis-card"><header><div class="payroll-commission-project"><span>案場</span><strong>${esc(row.projectName)}</strong></div><span class="payroll-commission-current-basis">${esc(basisLabel)}</span></header><div class="payroll-commission-metrics"><div><span>未稅金額</span><b>${money(row.preTax)}</b></div><div><span>含稅金額</span><b>${money(row.taxIncluded)}</b></div><div class="is-emphasis"><span>目前抽成</span><b>${money(row.commission)}</b></div></div><label class="payroll-commission-basis-control"><span><b>抽成計算基準</b><small>${row.resolved?(row.amountSource==='billing'?`正式請款單：${esc(row.billingNumbers.join('、')||'已連結')}`:'尚未請款，依每日施工金額'):'請款關聯待核對，暫停更正'}</small></span><select name="projectCommissionBasis" data-project-id="${esc(row.projectId)}" aria-label="${esc(row.projectName)} 抽成計算基準" ${row.resolved?'':'disabled'}><option value="preTax" ${row.basis!=='taxIncluded'?'selected':''}>未稅抽成</option><option value="taxIncluded" ${row.basis==='taxIncluded'?'selected':''}>含稅抽成</option></select></label></article>`}).join('')}</div></section>`;
  }
  function adjustmentForm(group){
    const automatic=store.num(group.baseSalary)+store.num(group.commission)+store.num(group.sourceFuel),additions=adjustmentAdditions.reduce((sum,[name])=>sum+store.num(group[name]),0),deductions=adjustmentDeductions.reduce((sum,[name])=>sum+store.num(group[name]),0);
    return `<section class="erp-detail-card receipt-card payroll-adjustment-card" role="dialog" aria-modal="true"><header><div><span>薪資人工調整</span><h2>${esc(group.employeeName)}</h2><p>${esc(group.month)}｜自動來源與人工加減項分開保存</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="payrollAdjustmentForm"><div class="erp-detail-body"><div class="billing-detail-summary payable-preview payroll-adjustment-source"><span>點工／出勤<b>${money(group.baseSalary)}</b></span><span>抽成<b>${money(group.commission)}</b></span><span>出勤來源油費<b>${money(group.sourceFuel)}</b></span><span>目前應領<b>${money(group.total)}</b></span></div>${projectCommissionBasisSection(group)}<section class="payroll-adjustment-section"><h3>加項</h3><div class="receipt-form-grid">${adjustmentInputs(adjustmentAdditions,group)}</div></section><section class="payroll-adjustment-section"><h3>扣項</h3><div class="receipt-form-grid">${adjustmentInputs(adjustmentDeductions,group)}</div></section><section class="payroll-adjustment-section"><h3>備註</h3><label class="payable-note-field"><span>薪資調整備註</span><textarea name="adjustmentNote" rows="3">${esc(group.payrollAdjustmentNote||'')}</textarea></label></section><div class="billing-detail-summary payable-preview payroll-adjustment-preview"><span>自動薪資<b id="payrollAutomaticTotal">${money(automatic)}</b></span><span>人工加項<b id="payrollAdditionTotal">${money(additions)}</b></span><span>人工扣項<b id="payrollDeductionTotal">${money(deductions)}</b></span><span>本月應領<b id="payrollAdjustedTotal">${money(Math.max(0,automatic+additions-deductions))}</b></span></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">儲存薪資調整</button></footer></form></section>`;
  }
  function openAdjustments(groupKey){
    const group=groupFor(groupKey);if(!group)return;const truth=store.payrollPaymentTruth(group);
    if(truth.paid>0||truth.hasVerifiedPayment)return window.KushePhase1.toast('此月份已有薪資付款，請先刪除／沖回薪資付款後再調整薪資。');
    const overlay=document.createElement('div');overlay.className='erp-detail-overlay';overlay.innerHTML=adjustmentForm(group);document.body.appendChild(overlay);$$('[data-close-detail]',overlay).forEach((button)=>button.onclick=closeModal);
    const form=$('#payrollAdjustmentForm',overlay),read=(name)=>{const value=Number($(`[name="${name}"]`,form).value);return Number.isFinite(value)&&value>0?Math.round(value):0},automatic=store.num(group.baseSalary)+store.num(group.commission)+store.num(group.sourceFuel),refresh=()=>{const additions=adjustmentAdditions.reduce((sum,[name])=>sum+read(name),0),deductions=adjustmentDeductions.reduce((sum,[name])=>sum+read(name),0);$('#payrollAutomaticTotal',form).textContent=money(automatic);$('#payrollAdditionTotal',form).textContent=money(additions);$('#payrollDeductionTotal',form).textContent=money(deductions);$('#payrollAdjustedTotal',form).textContent=money(Math.max(0,automatic+additions-deductions))};
    [...adjustmentAdditions,...adjustmentDeductions].forEach(([name])=>$(`[name="${name}"]`,form).oninput=refresh);
    form.onsubmit=async(event)=>{event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;try{const fd=new FormData(form),values=Object.fromEntries([...adjustmentAdditions,...adjustmentDeductions].map(([name])=>[name,fd.get(name)]));values.adjustmentNote=fd.get('adjustmentNote');values.otherNote=fd.get('otherNote');values.deductionNote=fd.get('deductionNote');values.projectCommissionBases=Object.fromEntries($$('select[name="projectCommissionBasis"]',form).map((select)=>[select.dataset.projectId,select.value]));await store.updatePayrollAdjustments(group.key,values);closeModal();expanded=group.key;render();window.KushePhase1.toast('薪資調整已儲存')}catch(error){window.KushePhase1.toast(error.message||String(error));button.disabled=false}};
  }
  function legacyPaymentForm(group,payment,state,token){
    const otherPaid=group.history.filter((row)=>row!==payment).reduce((sum,row)=>sum+store.num(row.amount),0),maximum=Math.max(0,store.num(group.total)-otherPaid),editing=Boolean(payment),selectedBank=payment?.bankAccountId||payment?.bankId||'',selectedPayer=payment?.feePayer==='recipient'?'recipient':'company';
    return `<section class="erp-detail-card receipt-card" role="dialog" aria-modal="true"><header><div><span>員工薪資付款</span><h2>${editing?'編輯薪資付款':esc(group.employeeName)}</h2><p>${esc(group.month||'—')}｜薪資總額 ${money(group.total)}</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="${editing?'editSalaryPaymentForm':'salaryPaymentForm'}"><div class="erp-detail-body"><div class="billing-detail-summary payable-preview"><span>薪資總額<b>${money(group.total)}</b></span><span>已付金額<b>${money(group.paid)}</b></span><span>未付金額<b>${money(group.outstanding)}</b></span><span>實際扣款<b id="salaryActualDebit">${money(payment?.actualDebit??(store.num(payment?.amount)||group.outstanding))}</b></span></div><div class="receipt-form-grid"><label><span>付款日期</span><input name="date" type="date" value="${esc(payment?.date||today())}" required></label><label><span>本次付款金額</span><input name="amount" type="number" min="1" max="${maximum}" value="${store.num(payment?.amount)||group.outstanding}" required></label><label><span>付款銀行帳戶</span><select name="bankId" required><option value="">請選擇帳戶</option>${state.banks.map((bank)=>`<option value="${esc(bank.id)}" ${bank.id===selectedBank?'selected':''}>${esc(bank.name||bank.bank||bank.account||'銀行帳戶')}</option>`).join('')}</select></label><label><span>付款方式</span><select name="paymentMethod">${['銀行轉帳','現金','支票','其他'].map((value)=>`<option ${payment?.paymentMethod===value?'selected':''}>${value}</option>`).join('')}</select></label><label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="${store.num(payment?.fee)}"></label><label><span>手續費負擔方式</span><select name="feePayer"><option value="company" ${selectedPayer==='company'?'selected':''}>公司負擔</option><option value="recipient" ${selectedPayer==='recipient'?'selected':''}>員工負擔</option></select></label><label class="payable-note-field"><span>備註</span><input name="note" value="${esc(payment?.note||'')}"></label></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary">${editing?'儲存修改':'確認付款'}</button></footer></form></section>`;
  }
  function paymentCommissionOptions(plan){
    if(!plan.available.length)return '<p class="payroll-payment-empty">目前沒有已收款解鎖的抽成。</p>';
    return '<div class="payroll-payment-commission-list">'+plan.available.map((row)=>'<label class="payroll-payment-commission-row"><input type="checkbox" name="commissionSelection" value="'+esc(row.allocationKey)+'"><span><b>'+esc((row.customerName||'—')+'｜'+(row.projectName||'—'))+'</b><small>'+esc((row.house||'未指定戶別')+'｜'+((row.billingNumbers||[]).join('、')||'請款來源'))+'</small></span><strong>'+money(row.amount)+'</strong></label>').join('')+'</div>';
  }
  function sourceAwarePaymentForm(group,state){
    const plan=store.salaryPaymentPlan(group.key,[]);
    return '<section class="erp-detail-card receipt-card payroll-source-payment-card" role="dialog" aria-modal="true"><header><div><span>員工薪資付款</span><h2>'+esc(group.employeeName)+'</h2><p>'+esc(group.month||'—')+'｜只可支付日薪／點工與已收款解鎖抽成</p></div><button type="button" data-close-detail aria-label="關閉">×</button></header><form id="salaryPaymentForm"><div class="erp-detail-body"><div class="payroll-payment-summary"><article><span>日薪／點工可付</span><b>'+money(plan.baseOutstanding)+'</b></article><article><span>可發抽成</span><b>'+money(plan.availableCommission)+'</b></article><article class="is-muted"><span>等待收款抽成</span><b>'+money(plan.lockedCommission)+'</b></article><article class="is-primary"><span>本次付款</span><b id="salaryPaymentSelectedTotal">'+money(plan.baseOutstanding)+'</b></article></div>'+(plan.blockers.length?'<div class="project-settlement-blockers">'+plan.blockers.map((row)=>'<p>'+esc(row.message)+'</p>').join('')+'</div>':'')+'<section class="payroll-payment-source-section"><header><div><h3>本次發放抽成</h3><p>只顯示已收款解鎖來源；未勾選的抽成會留待下次發放。</p></div></header>'+paymentCommissionOptions(plan)+'</section><div class="receipt-form-grid"><label><span>付款日期</span><input name="date" type="date" value="'+today()+'" required></label><label><span>本次付款金額</span><input name="amount" type="number" value="'+plan.baseOutstanding+'" readonly required></label><label><span>付款銀行帳戶</span><select name="bankId" required><option value="">請選擇帳戶</option>'+state.banks.map((bank)=>'<option value="'+esc(bank.id)+'">'+esc(bank.name||bank.bank||bank.account||'銀行帳戶')+'</option>').join('')+'</select></label><label><span>付款方式</span><select name="paymentMethod">'+['銀行轉帳','現金','支票','其他'].map((value)=>'<option>'+value+'</option>').join('')+'</select></label><label><span>手續費</span><input name="fee" type="number" min="0" step="1" value="0"></label><label><span>手續費負擔方式</span><select name="feePayer"><option value="company">公司負擔</option><option value="recipient">員工負擔</option></select></label><label class="payable-note-field"><span>備註</span><input name="note" value=""></label></div><div class="billing-detail-summary payable-preview"><span>本次薪資<b id="salaryPaymentAmountPreview">'+money(plan.baseOutstanding)+'</b></span><span>手續費<b id="salaryPaymentFeePreview">$0</b></span><span>實際扣款<b id="salaryActualDebit">'+money(plan.baseOutstanding)+'</b></span></div></div><footer><button type="button" class="commission-secondary" data-close-detail>取消</button><button type="submit" class="commission-primary" '+(!plan.allowed||plan.currentPayable<=0?'disabled':'')+'>確認付款</button></footer></form></section>';
  }
  function openPayment(groupKey,paymentId=''){
    const state=store.getState(),payment=state.salaryPayments.find((row)=>row.id===paymentId),group=groupFor(payment?.payrollId||groupKey);
    if(!group)return;
    if(payment){
      if(Number(payment.paymentAllocationVersion)===2)return window.KushePhase1.toast('新版來源式付款如需修改，請刪除後重新建立。');
      const token='salary-edit-'+payment.id+'-'+Date.now(),overlay=document.createElement('div');overlay.className='erp-detail-overlay';overlay.innerHTML=legacyPaymentForm(group,payment,state,token);document.body.appendChild(overlay);$$('[data-close-detail]',overlay).forEach((button)=>button.onclick=closeModal);
      const form=$('form',overlay),refresh=()=>{const amount=Math.max(0,Number($('[name="amount"]',form).value)||0),fee=Math.max(0,Number($('[name="fee"]',form).value)||0),company=$('[name="feePayer"]',form).value==='company';$('#salaryActualDebit',overlay).textContent=money(company?amount+fee:amount)};['amount','fee','feePayer'].forEach((name)=>$('[name="'+name+'"]',form).oninput=refresh);
      form.onsubmit=async(event)=>{event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;try{const fd=new FormData(form);await store.updateSalaryPayment(payment.id,{date:fd.get('date'),amount:fd.get('amount'),bankId:fd.get('bankId'),paymentMethod:fd.get('paymentMethod'),fee:fd.get('fee'),feePayer:fd.get('feePayer'),note:fd.get('note')});closeModal();expanded=group.key;render();window.KushePhase1.toast('歷史薪資付款已更新')}catch(error){window.KushePhase1.toast(error.message||String(error));button.disabled=false}};return;
    }
    const initialPlan=store.salaryPaymentPlan(group.key,[]);if(!initialPlan.allowed)return window.KushePhase1.toast(initialPlan.blockers[0]?.message||'此月份目前不可付款');
    if(initialPlan.currentPayable<=0)return window.KushePhase1.toast(initialPlan.lockedCommission>0?'目前只有等待收款的抽成，尚無可付款金額。':'此筆薪資目前沒有可付款金額。');
    const token='salary-'+group.primaryPayrollId+'-'+Date.now()+'-'+Math.random().toString(36).slice(2),overlay=document.createElement('div');overlay.className='erp-detail-overlay';overlay.innerHTML=sourceAwarePaymentForm(group,state);document.body.appendChild(overlay);$$('[data-close-detail]',overlay).forEach((button)=>button.onclick=closeModal);
    const form=$('form',overlay),selection=()=>$$('[name="commissionSelection"]:checked',form).map((input)=>input.value),refresh=()=>{const plan=store.salaryPaymentPlan(group.key,selection()),amount=plan.selectedPayable,fee=Math.max(0,Number($('[name="fee"]',form).value)||0),company=$('[name="feePayer"]',form).value==='company';$('[name="amount"]',form).value=amount;$('#salaryPaymentSelectedTotal',form).textContent=money(amount);$('#salaryPaymentAmountPreview',form).textContent=money(amount);$('#salaryPaymentFeePreview',form).textContent=money(fee);$('#salaryActualDebit',form).textContent=money(company?amount+fee:amount);$('button[type="submit"]',form).disabled=!plan.allowed||amount<=0};
    $$('[name="commissionSelection"]',form).forEach((input)=>input.onchange=refresh);['fee','feePayer'].forEach((name)=>$('[name="'+name+'"]',form).oninput=refresh);
    form.onsubmit=async(event)=>{event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;try{const keys=selection(),plan=store.salaryPaymentPlan(group.key,keys),fd=new FormData(form),values={payrollId:group.primaryPayrollId,date:fd.get('date'),amount:plan.selectedPayable,commissionSelectionKeys:keys,bankId:fd.get('bankId'),paymentMethod:fd.get('paymentMethod'),fee:fd.get('fee'),feePayer:fd.get('feePayer'),note:fd.get('note'),idempotencyKey:token};await store.addSalaryPayment(values);closeModal();expanded=group.key;render();window.KushePhase1.toast('薪資付款已依可發來源完成並同步銀行')}catch(error){window.KushePhase1.toast(error.message||String(error));button.disabled=false}};
  }
  function sourceTable(group){
    if(!group.sources.length)return '<p class="receipt-history-empty">尚無可追溯的薪資來源明細</p>';
    return `<table><thead><tr><th>日期</th><th>類型</th><th>案場</th><th>內容</th><th>數量／比例</th><th>單價／基準</th><th class="num">金額</th></tr></thead><tbody>${group.sources.map((source)=>`<tr><td>${esc(source.date||'—')}</td><td>${esc(source.type||'—')}</td><td>${esc(source.projectName||'—')}</td><td>${esc(source.content||'—')}</td><td>${esc(source.quantityLabel||'—')}</td><td>${esc(source.rateLabel||'—')}</td><td class="num">${money(source.amount)}</td></tr>`).join('')}</tbody></table>`;
  }
  function paymentTable(group,state){
    if(!group.history.length)return '<p class="receipt-history-empty">尚無付款紀錄</p>';
    return `<table><thead><tr><th>付款日期</th><th class="num">本次付款</th><th>銀行帳戶</th><th>付款方式</th><th class="num">手續費</th><th class="num">實際扣款</th><th>備註</th><th>操作</th></tr></thead><tbody>${group.history.map((payment)=>`<tr><td>${esc(payment.date||'—')}</td><td class="num">${money(payment.amount)}</td><td>${esc(bankName(payment.bankAccountId||payment.bankId,state))}</td><td>${esc(payment.paymentMethod||'銀行轉帳')}</td><td class="num">${money(payment.fee)}</td><td class="num">${money(payment.actualDebit??payment.amount)}</td><td>${esc(payment.note||'—')}</td><td>${payment.readOnly?'<span class="commission-status is-settled">歷史付款（唯讀）</span>':Number(payment.paymentAllocationVersion)===2?`<span class="commission-status is-settled">來源式付款</span> <button class="commission-link" type="button" data-salary-delete="${esc(payment.id)}">刪除</button>`:`<button class="commission-link" type="button" data-salary-edit="${esc(payment.id)}">編輯</button> <button class="commission-link" type="button" data-salary-delete="${esc(payment.id)}">刪除</button>`}</td></tr>`).join('')}</tbody></table>`;
  }
  function payrollGroupActions(group,presentation,mobile=false){
    const {open,adjustmentLocked}=presentation;
    return `${adjustmentLocked?'<span class="commission-status settled" title="請先刪除／沖回薪資付款後再調整">薪資調整鎖定</span>':`<button class="commission-secondary compact" type="button" data-salary-adjust="${esc(group.key)}">薪資調整</button>`}${presentation.canPay?`<button class="commission-primary compact" type="button" data-salary-pay="${esc(group.key)}">付款</button>`:presentation.waitingReceipt?'<span class="commission-status is-warning">等待收款</span>':''}<button class="commission-secondary compact" type="button" data-salary-pdf="${esc(group.key)}">薪資單 PDF</button><button class="receivable-expand" type="button" data-salary-expand="${esc(group.key)}" aria-expanded="${open}"><span>${mobile?(open?'收合':'查看明細'):(open?'⌃':'⌄')}</span></button>`;
  }
  function payrollMobileFields(fields){
    return '<dl class="payroll-mobile-fields">'+fields.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>';
  }
  function sourceMobileCards(group){
    if(!group.sources.length)return '<p class="receipt-history-empty">尚無可追溯的薪資來源明細</p>';
    return '<div class="payroll-source-list">'+group.sources.map((source)=>'<article class="payroll-source-card">'+payrollMobileFields([['日期',esc(source.date||'—')],['類型',esc(source.type||'—')],['案場',esc(source.projectName||'—')],['內容',esc(source.content||'—')],['數量／比例',esc(source.quantityLabel||'—')],['單價／基準',esc(source.rateLabel||'—')],['金額',money(source.amount)]])+'</article>').join('')+'</div>';
  }
  function paymentMobileCards(group,state){
    if(!group.history.length)return '<p class="receipt-history-empty">尚無付款紀錄</p>';
    return '<div class="payroll-payment-list">'+group.history.map((payment)=>'<article class="payroll-payment-card">'+payrollMobileFields([['付款日期',esc(payment.date||'—')],['本次付款',money(payment.amount)],['銀行帳戶',esc(bankName(payment.bankAccountId||payment.bankId,state))],['付款方式',esc(payment.paymentMethod||'銀行轉帳')],['手續費',money(payment.fee)],['實際扣款',money(payment.actualDebit??payment.amount)],['備註',esc(payment.note||'—')]])+'<div class="payroll-mobile-actions" aria-label="操作">'+(payment.readOnly?'<span class="commission-status is-settled">歷史付款（唯讀）</span>':Number(payment.paymentAllocationVersion)===2?'<span class="commission-status is-settled">來源式付款</span> <button class="commission-link" type="button" data-salary-delete="'+esc(payment.id)+'">刪除</button>':'<button class="commission-link" type="button" data-salary-edit="'+esc(payment.id)+'">編輯</button> <button class="commission-link" type="button" data-salary-delete="'+esc(payment.id)+'">刪除</button>')+'</div></article>').join('')+'</div>';
  }
  function payrollMobileCards(rows,presentations,state,insights){
    return '<div class="payroll-mobile-list">'+(rows.map((group)=>{const presentation=presentations.get(group),insight=insights.get(group);return '<article class="payroll-mobile-card"><header><div><p>'+esc(group.month||'—')+'</p><h2>'+esc(group.employeeName)+'</h2>'+(group.history.length?'<span class="receipt-count-badge">'+group.history.length+' 次付款</span>':'')+'</div><span class="commission-status '+presentation.statusClass+'">'+esc(presentation.statusLabel)+'</span></header>'+payrollMobileFields([['本月業績',money(insight.performance)],['日薪／點工可付',money(insight.dayWagePayable)],['可發抽成',money(insight.unlockedCommission)],['等待收款抽成',money(insight.lockedCommission)],['目前可付款',money(insight.currentPayable)]])+'<div class="payroll-mobile-actions">'+payrollGroupActions(group,presentation,true)+'</div>'+(presentation.open?'<section class="payroll-mobile-detail"><h3>可發抽成／收款狀態</h3>'+releaseMobileCards(insight)+'<h3>薪資來源明細</h3>'+sourceMobileCards(group)+'<h3>薪資付款紀錄</h3>'+paymentMobileCards(group,state)+'</section>':'')+'</article>'}).join('')||'<p class="billing-empty">目前沒有薪資紀錄。</p>')+'</div>';
  }
  function render(){
    if(!active)return;
    const state=store.getState(),rows=groups(),months=[...new Set(rows.map((group)=>String(group.month||'')).filter(Boolean))],performanceByMonth=new Map(months.map((month)=>[month,performanceMap(month)]));
    const insights=new Map(rows.map((group)=>[group,payrollInsight(group,performanceByMonth.get(String(group.month||''))||new Map())]));
    const presentations=new Map(rows.map((group)=>{const insight=insights.get(group),waitingReceipt=insight.currentPayable<=0&&insight.lockedCommission>0,statusLabel=insight.paymentBlocked?'付款鎖定':waitingReceipt?'等待收款':insight.currentPayable>0?'可付款':group.paid>0?'已付款':'無應付';return [group,{open:expanded===group.key,adjustmentLocked:group.paid>0||group.hasVerifiedPayment,canPay:insight.currentPayable>0&&!insight.paymentBlocked,waitingReceipt,statusLabel,statusClass:insight.paymentBlocked?'is-warning':waitingReceipt?'is-warning':insight.currentPayable>0?'partial':'settled'}]}));
    $('#payrollApp').innerHTML=`<section class="commissions-heading"><div><h1>薪資管理</h1><p>業績與薪資分開管理；日薪／點工可直接支付，抽成只在對應工程款收清後才能發放。</p></div></section><section class="commission-panel billing-list-panel"><div class="commission-table-wrap payroll-desktop-table"><table class="commission-table payroll-center-table"><thead><tr><th>月份</th><th>員工</th><th class="num">本月業績</th><th class="num">日薪／點工可付</th><th class="num">可發抽成</th><th class="num">等待收款抽成</th><th class="num payroll-current-payable-head">目前可付款</th><th>狀態</th><th>操作</th></tr></thead><tbody>${rows.map((group)=>{const presentation=presentations.get(group),insight=insights.get(group),{open}=presentation;return `<tr><td>${esc(group.month||'—')}</td><td><b>${esc(group.employeeName)}</b>${group.history.length?`<span class="receipt-count-badge">${group.history.length} 次付款</span>`:''}</td><td class="num"><b>${money(insight.performance)}</b></td><td class="num">${money(insight.dayWagePayable)}</td><td class="num"><b>${money(insight.unlockedCommission)}</b></td><td class="num">${money(insight.lockedCommission)}</td><td class="num payroll-current-payable"><b>${money(insight.currentPayable)}</b></td><td><span class="commission-status ${presentation.statusClass}">${esc(presentation.statusLabel)}</span></td><td><div class="receivable-actions">${payrollGroupActions(group,presentation)}</div></td></tr>${open?`<tr class="receipt-history-row"><td colspan="9"><section class="receipt-history payroll-center-detail"><h3>抽成收款／發放狀態</h3>${releaseTable(group,insight)}<h3>薪資來源明細</h3>${sourceTable(group)}<h3>薪資付款紀錄</h3>${paymentTable(group,state)}</section></td></tr>`:''}`}).join('')||'<tr><td colspan="9" class="billing-empty">目前沒有薪資紀錄。</td></tr>'}</tbody></table></div>${payrollMobileCards(rows,presentations,state,insights)}</section>`;
    $$('[data-salary-adjust]').forEach((button)=>button.onclick=()=>openAdjustments(button.dataset.salaryAdjust));
    $$('[data-salary-pay]').forEach((button)=>button.onclick=()=>openPayment(button.dataset.salaryPay));
    $$('[data-salary-pdf]').forEach((button)=>button.onclick=()=>{const group=groupFor(button.dataset.salaryPdf);if(group)window.KushePayrollPrint?.open(group)});
    $$('[data-salary-expand]').forEach((button)=>button.onclick=()=>{expanded=expanded===button.dataset.salaryExpand?'':button.dataset.salaryExpand;render()});
    $$('[data-salary-edit]').forEach((button)=>button.onclick=()=>{const payment=state.salaryPayments.find((row)=>row.id===button.dataset.salaryEdit);if(payment)openPayment('',payment.id)});
    $$('[data-salary-delete]').forEach((button)=>button.onclick=async()=>{if(!window.confirm('確定刪除此薪資付款？銀行支出會同步沖回。'))return;try{await store.deleteSalaryPayment(button.dataset.salaryDelete);render();window.KushePhase1.toast('薪資付款已刪除，銀行餘額已還原')}catch(error){window.KushePhase1.toast(error.message||String(error))}});
    window.KusheIcons?.render($('#payrollApp'));
  }
  function cancelNavigationFrame(){
    if(navigationFrame!==null){window.cancelAnimationFrame(navigationFrame);navigationFrame=null;}
  }
  function prepareNavigationTarget(context={}){
    const employeeId=String(context?.employeeId??'').trim(),month=String(context?.month??'').trim();
    pendingNavigationTarget={employeeId,month,valid:Boolean(employeeId)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)};
  }
  function scheduleNavigationScroll(groupKey,token){
    navigationFrame=window.requestAnimationFrame(()=>{
      navigationFrame=null;
      if(!active||token!==activationToken||document.body.dataset.route!=='payroll')return;
      const root=$('#payrollApp');
      const visible=(node)=>Boolean(node?.isConnected&&node.getClientRects().length);
      const button=root&&$$('[data-salary-expand]',root).find((node)=>node.dataset.salaryExpand===groupKey&&visible(node));
      const target=button?.closest('.payroll-mobile-card, tr');
      const frame=target?.closest('.page-frame');
      if(!visible(target)||!frame)return;
      // Measure the shell obstruction; only adjust its vertical scrolling position.
      const frameRect=frame.getBoundingClientRect(),topbar=$('.topbar');
      const desiredTop=Math.max(frameRect.top,topbar?.getBoundingClientRect().bottom??frameRect.top)+12;
      frame.scrollTop+=target.getBoundingClientRect().top-desiredTop;
    });
  }
  async function activate(){
    const target=pendingNavigationTarget;pendingNavigationTarget=null;
    const token=++activationToken;cancelNavigationFrame();active=true;
    if(!ready){await store.load();ready=true;}
    if(!active||token!==activationToken)return;
    if(!target){render();return;}
    if(document.body.dataset.route!=='payroll')return;
    expanded='';
    let message='',groupKey='';
    if(!target.valid)message='薪資定位資訊無效';
    else{
      const matches=groups().filter((group)=>group.employeeId===target.employeeId&&String(group.month||'').slice(0,7)===target.month);
      if(matches.length===1){groupKey=matches[0].key;expanded=groupKey;}
      else message=matches.length?'薪資資料匹配不唯一，請人工確認':'此員工此月份尚未建立薪資資料';
    }
    render();
    if(message)window.KushePhase1.toast(message);
    else scheduleNavigationScroll(groupKey,token);
  }
  function deactivate(){active=false;pendingNavigationTarget=null;activationToken+=1;cancelNavigationFrame();closeModal();}
  window.addEventListener('kushe:data-updated',()=>{if(active)render()});
  window.KushePayroll={activate,deactivate,render,prepareNavigationTarget};
}());
