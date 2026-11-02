(function(){
'use strict';
const arr=v=>Array.isArray(v)?v:[];
const tx=v=>String(v==null?'':v);
const num=v=>Number.isFinite(Number(v))?Number(v):NaN;
const id=x=>tx(x?.employee||x?.employeeId);
const proj=x=>tx(x?.project||x?.projectId);
const equal=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.011;
const esc=x=>tx(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isFinite(v)?'NT$ '+Math.round(v).toLocaleString('zh-TW'):'待查核';
const statusText={candidate:'待核准更正',correct:'已符合規則',blocked:'待人工核對'};
function inspect(state,store){
 if(!state||!store)return {readOnly:true,rows:[],counts:{candidate:0,correct:0,blocked:0},candidateDelta:0};
 const groups=new Map(),months=new Map(),byCommission=new Map(),byBilling=new Map();
 for(const x of arr(state.dailyLogs)){
  if(x.workOnly===true||!x.project||!arr(x.items).length)continue;
  const k=JSON.stringify([tx(x.batchId||x.id),tx(x.groupId||x.id)]);
  if(!groups.has(k))groups.set(k,[]);
  groups.get(k).push(x);
 }
 for(const row of arr(state.commissions)){
  if(row.sourceType!=='daily-log')continue;
  const k=tx(row.sourceId);
  if(!byCommission.has(k))byCommission.set(k,[]);
  byCommission.get(k).push(row);
 }
 for(const billing of arr(state.billings)){
  const refs=arr(billing.sourceItemRefs).concat(arr(billing.lines).flatMap(line=>arr(line.sourceRefs)));
  const keys=new Set(refs.map(ref=>tx(ref.sourceGroupKey)).filter(Boolean));
  for(const key of keys){if(!byBilling.has(key))byBilling.set(key,[]);byBilling.get(key).push({billing,keys});}
 }
 const payrollViews=arr(store.monthlyPayrollGroups?.());
 for(const view of payrollViews)months.set(tx(view.employeeId)+'|'+tx(view.month),view);
 const rows=[],counts={candidate:0,correct:0,blocked:0};let candidateDelta=0,blockedDelta=0;
 for(const [batchKey,logs] of groups){
  const first=logs[0],gid=tx(first.groupId||first.id),pid=proj(first),project=arr(state.projects).find(x=>tx(x.id)===pid);
  const title=project?.name||first.projectName||'未知案場',errors=[];
  const block=t=>{if(!errors.includes(t))errors.push(t)};
  const basis=num(first.groupTotal),items=arr(first.items);
  const subtotal=items.reduce((sum,item)=>sum+Number(item.untaxedSubtotal??(Number(item.qty)*Number(item.price))),0);
  if(!Number.isFinite(basis)||basis<=0||!equal(subtotal,basis))block('施工未稅總額與原明細無法核對');
  if(!pid||!project)block('案場主檔不存在');
  if(!gid||logs.some(x=>proj(x)!==pid||tx(x.groupId||x.id)!==gid||!equal(num(x.groupTotal),basis)||JSON.stringify(arr(x.items))!==JSON.stringify(items)))block('同施工群組來源、副本或金額不一致');
  const participants=logs.filter(x=>x.commissionEnabled!==false&&num(x.rate)>0);
  if(!participants.length)continue; // Pure time work or intentionally zero-commission groups are not correction targets.
  if(logs.length!==new Set(logs.map(id)).size)block('員工身分重複');
  if(participants.length!==logs.length&&logs.some(x=>num(x.rate)>0&&x.commissionEnabled===false))block('抽成參與狀態矛盾');
  const totalBps=participants.reduce((sum,x)=>sum+Math.round(num(x.rate)*100),0);
  if(participants.some(x=>!Number.isFinite(num(x.rate))||num(x.rate)<0||num(x.rate)>50||!equal(num(x.rate)*100,Math.round(num(x.rate)*100)))||totalBps!==5000)
    block('抽成員工比例合計不是 50%，不能擅自調整個人比例');
  if(logs.some(x=>x.commissionBasis==='taxIncluded'))block('歷史含稅抽成基準需人工核對');
  // Demand one uniquely provable billing document for exactly this construction group.
  const linked=byBilling.get(gid)||[],sourceBills=[...new Set(linked.map(x=>tx(x.billing.id)))];
  const itemBills=[...new Set(items.map(x=>tx(x.billingId)).filter(Boolean))];
  if(sourceBills.length!==1||itemBills.length!==1||sourceBills[0]!==itemBills[0])block('請款單無法唯一連回原施工群組');
  const billing=linked.length?linked[0].billing:null;
  if(billing){
   const otherGroups=new Set(arr(billing.sourceItemRefs).concat(arr(billing.lines).flatMap(x=>arr(x.sourceRefs))).map(x=>tx(x.sourceGroupKey)).filter(Boolean));
   if(otherGroups.size!==1||!otherGroups.has(gid)||!equal(num(billing.preTaxAmount??billing.amount),basis))
     block('請款單包含其他施工來源或金額不同，不能自行分配');
   if(proj(billing)!==pid)block('請款與施工案場不一致');
   const ars=arr(state.receivables).filter(x=>tx(x.billingId)===tx(billing.id));
   if(ars.length!==1)block('請款對應應收紀錄不唯一');
  }
  const people=[],yearMonth=tx(first.date).slice(0,7);
  for(const log of participants){
   const eid=id(log),person=arr(state.employees).filter(x=>tx(x.id)===eid),name=person[0]?.name||log.employeeName||'未知員工',
       source=byCommission.get(tx(log.id))||[],linkedComm=source[0],old=num(log.commission),
       rate=num(log.rate),newAmount=Math.round(basis*rate/100),delta=newAmount-old;
   if(person.length!==1||!eid||person[0]?.name!==log.employeeName)block(name+'：員工 ID／姓名不一致');
   if(source.length!==1||id(linkedComm)!==eid||proj(linkedComm)!==pid||
      linkedComm?.status!=='已列入薪資'||!equal(num(linkedComm?.commission),old)||
      !equal(num(linkedComm?.rate),rate)||!equal(num(linkedComm?.untaxedAmount),num(log.untaxedPerformance??log.performance)))
      block(name+'：抽成來源、員工或原金額不一致');
   const payrolls=arr(state.payroll).filter(p=>id(p)===eid&&tx(p.month).slice(0,7)===yearMonth),
     view=months.get(eid+'|'+yearMonth),sourceInSalary=arr(view?.sources).filter(x=>x.type==='抽成'&&x.sourceType==='daily-log'&&tx(x.sourceId)===tx(log.id));
   if(payrolls.length!==1||payrolls[0]?.status!=='未付款'||!view||sourceInSalary.length!==1||
      !equal(num(sourceInSalary[0]?.amount),old))block(name+'：未付款薪資或抽成來源無法唯一核對');
   try{
    const lock=store.payrollHistoryLock(eid,yearMonth);
    if(lock.locked)block(name+'：10 月／該月薪資已有付款');
    const sl=store.dailyLogCommissionSettlementLock(log);
    if(sl.locked)block(name+'：抽成已有實際結算');
    const pt=view?store.payrollPaymentTruth(view):null;
    if(!pt||pt.integrity!=='none'||pt.hasVerifiedPayment||arr(pt.history).length||arr(pt.bankTransactionIds).length)block(name+'：付款證據不完整或已付款');
   }catch(_){block(name+'：薪資付款驗證失敗')}
   people.push({name,employeeId:eid,logId:tx(log.id),commissionId:tx(linkedComm?.id),rate,old,newAmount,delta,month:yearMonth,payrollId:tx(payrolls[0]?.id)});
  }
  if(!people.length)continue;
  const diff=people.reduce((sum,x)=>sum+(Number.isFinite(x.delta)?x.delta:0),0);
  const status=errors.length?'blocked':people.every(p=>equal(p.old,p.newAmount))?'correct':'candidate';
  counts[status]++;
  if(status==='candidate')candidateDelta+=diff;
  if(status==='blocked')blockedDelta+=diff;
  rows.push({date:tx(first.date),batchId:tx(first.batchId||first.id),groupId:gid,project:title,amount:basis,staff:people,rateTotal:totalBps/100,status,difference:diff,issues:errors,billingNo:tx(billing?.number)});
 }
 const rank={candidate:0,blocked:1,correct:2};
 rows.sort((a,b)=>rank[a.status]-rank[b.status]||b.date.localeCompare(a.date)||a.project.localeCompare(b.project,'zh-Hant'));
 return {readOnly:true,policy:'PRETAX_50_PERCENT_POOL',rows,counts,candidateDelta,blockedDelta,generatedAt:new Date().toISOString()};
}
function open(store){
 const prev=document.getElementById('kusheCommissionAuditLayer');if(prev)prev.remove();
 const report=inspect(store.getState(),store),layer=document.createElement('div');
 layer.id='kusheCommissionAuditLayer';layer.className='commission-audit-overlay';
 layer.innerHTML='<div class="commission-audit-window" role="dialog" aria-modal="true" aria-labelledby="commissionAuditTitle"><header><div><small>酷舍 ERP｜唯讀全量核對</small><h2 id="commissionAuditTitle">歷史抽成查核報表</h2></div><button type="button" data-audit-close>關閉</button></header><div class="commission-audit-body"></div></div>';
 document.body.appendChild(layer);
 const root=layer.querySelector('.commission-audit-body');
 const summary=document.createElement('div');summary.className='commission-audit-summary';
 summary.innerHTML='<p>只讀取目前已載入的帳務快照；不會新增、刪除或更改資料。正確比例為全案未稅金額 × 個人抽成比例，員工合計固定 50%。</p><div><span>待核准更正：<b>'+report.counts.candidate+' 組</b></span><span>已符合：<b>'+report.counts.correct+' 組</b></span><span>需人工核對：<b>'+report.counts.blocked+' 組</b></span><span>可核對候選差額：<b>'+money(report.candidateDelta)+'</b></span></div><p>注意：上述差額只是預估，未對真實資料進行修正；已付款、來源不清、混合請款或總比例不等於50%的紀錄全部列為待人工核對。</p>';
 root.appendChild(summary);
 const controls=document.createElement('div');controls.className='commission-audit-controls';
 controls.innerHTML='<label>類別<select data-audit-filter><option value="all">全部紀錄</option><option value="candidate">待核准更正</option><option value="blocked">待人工核對</option><option value="correct">已符合規則</option></select></label><button data-audit-csv type="button">匯出完整 CSV</button>';
 root.appendChild(controls);
 const holder=document.createElement('div');holder.className='commission-audit-table-wrap';root.appendChild(holder);
 const filter=controls.querySelector('[data-audit-filter]');
 const render=()=>{
  const rows=report.rows.filter(row=>filter.value==='all'||row.status===filter.value),visible=rows.slice(0,150);
  holder.innerHTML='<p>符合條件 '+rows.length+' 組；畫面顯示前 '+visible.length+' 組。完整清單可匯出 CSV，再核對哪些資料真的需要更正。</p><table><thead><tr><th>日期／案場</th><th>員工</th><th>未稅施工額</th><th>原抽成／試算抽成</th><th>差額</th><th>判定／原因</th></tr></thead><tbody>'+visible.flatMap(row=>row.staff.map((person,index)=>'<tr><td>'+esc(row.date)+' / '+esc(row.project)+(index===0&&row.billingNo?'<small>請款 '+esc(row.billingNo)+'</small>':'')+'</td><td>'+esc(person.name)+' ('+esc(person.rate)+'%)</td><td>'+money(row.amount)+'</td><td>'+money(person.old)+' / '+money(person.newAmount)+'</td><td>'+money(person.delta)+'</td><td>'+esc(statusText[row.status])+(row.issues.length?'<small>'+esc(row.issues.join('；'))+'</small>':'')+'</td></tr>')).join('')+'</tbody></table>';
 };
 filter.onchange=render;render();
 const close=()=>{layer.remove();document.removeEventListener('keydown',escapeHandler)};
 const escapeHandler=ev=>{if(ev.key==='Escape')close()};
 document.addEventListener('keydown',escapeHandler);
 layer.querySelector('[data-audit-close]').onclick=close;
 controls.querySelector('[data-audit-csv]').onclick=()=>{
  const quote=x=>'"'+tx(x).replace(/"/g,'""')+'"';
  const cols=[['日期','案場','請款單號','員工','個人比例','未稅施工額','原抽成','正確試算','差額','狀態','人工查核原因']];
  report.rows.forEach(row=>row.staff.forEach(p=>cols.push([row.date,row.project,row.billingNo,p.name,p.rate,row.amount,p.old,p.newAmount,p.delta,statusText[row.status],row.issues.join('；')])));
  const blob=new Blob(['\uFEFF'+cols.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='酷舍_歷史抽成唯讀查核.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 layer.querySelector('[data-audit-close]').focus();
}
window.KuSheCommissionHistoryAudit=Object.freeze({inspect,open});
}());