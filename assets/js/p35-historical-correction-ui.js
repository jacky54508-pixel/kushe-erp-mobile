(function(){
  'use strict';
  // P35: double-confirmed single-batch transaction; never writes on page load or on preview.
  const TEXT='確認更正';
  const PHRASE='P33-4|2026-10-07|宏觀展業|劉佳勳+柯智耀';
  const INVOICE='B20261102-002';
  const $=(sel,root=document)=>root.querySelector(sel);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(v)||0);
  let active=null;
  function safePlan(store,batchId){
    if(!store||typeof store.p33Oct07CommissionRepairPreview!=='function'||typeof store.p33Oct07CommissionRepair!=='function')return null;
    const result=store.p33Oct07CommissionRepairPreview(batchId);
    const names=result?.payroll?.map(row=>row.employeeName).sort()||[];
    if(!result?.allowed||result.date!=='2026-10-07'||result.project!=='宏觀展業'||
      result.constructionTotal!==14000||result.totalDifference!==3500||result.oldCommissionTotal!==3500||
      result.correctCommissionTotal!==7000||result.billingIds?.length!==1||
      result.payroll?.length!==2||names.join('|')!==['劉佳勳','柯智耀'].sort().join('|')||
      result.payroll.some(x=>x.oldCommission!==1750||x.expectedCommission!==3500||x.difference!==1750||x.payrollStatus!=='未付款')||
      !result.baseline||!result.receivableId||result.receiptCount!==0)return null;
    return result;
  }
  function open(batchId){
    if(active)return;
    const store=window.KuSheERPStore;
    let gate;
    try{gate=safePlan(store,batchId)}catch(error){window.KushePhase1?.toast?.('來源核對失敗：'+String(error.message||error));return;}
    if(!gate){window.KushePhase1?.toast?.('此筆不符合指定更正的安全條件，禁止修改歷史帳務');return;}
    const pane=document.createElement('div');
    pane.className='p35-confirm-overlay';pane.id='p35CommissionCorrectionConfirm';
    pane.innerHTML='<section class="p35-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="p35-title">'+
      '<header><div><small>只有本次兩位員工｜P35 安全更正</small><h2 id="p35-title">10/7 宏觀展業抽成更正</h2></div><button data-p35-close type="button">關閉</button></header>'+
      '<div class="p35-confirm-content"><p><strong>這會修改實際 ERP 資料。</strong>只更新指定兩筆施工抽成、兩筆抽成來源及兩位員工 10 月未付款薪資；不新建請款、收款或銀行流水。</p>'+
      '<div class="p35-info-row"><span>請款來源：<b>'+esc(INVOICE)+'</b></span><span>未稅施工總額：<b>NT$14,000</b></span><span>總計增加：<b>NT$3,500</b></span></div>'+
      '<div class="p35-scroll"><table><thead><tr><th>員工</th><th>原抽成</th><th>更正後</th><th>抽成差額</th><th>10 月原薪資</th><th>更正後薪資</th></tr></thead><tbody>'+
      gate.payroll.map(x=>'<tr><td>'+esc(x.employeeName)+'</td><td>'+money(x.oldCommission)+'</td><td>'+money(x.expectedCommission)+'</td><td>'+money(x.difference)+'</td><td>'+money(x.oldPayrollTotal)+'</td><td>'+money(x.expectedPayrollTotal)+'</td></tr>').join('')+
      '</tbody></table></div>'+
      '<div class="p35-backup-block"><h3>第一步｜先保存更正前完整備份</h3><p>備份只下載到這台裝置，不會上傳給我。檔案包含公司帳務資料，請妥善保存。</p>'+
      '<button type="button" data-p35-download>下載更正前 ERP 備份（JSON）</button><span data-p35-backup-status>尚未下載</span>'+
      '<label><input type="checkbox" data-p35-backup-confirm> 我已確認完整備份檔實際儲存在電腦或可信任儲存位置</label></div>'+
      '<div class="p35-approve-block"><h3>第二步｜明確核准這兩筆歷史更正</h3>'+
      '<label><span>更正原因（必填）</span><textarea data-p35-reason rows="2" placeholder="例如：依 P34 規則，請款未稅金額 × 個人 25% 補正歷史抽成"></textarea></label>'+
      '<label><span>請輸入「'+esc(TEXT)+'」</span><input data-p35-phrase autocomplete="off" placeholder="'+esc(TEXT)+'"></label>'+
      '<label><input type="checkbox" data-p35-scope> 我確認僅更正 2026/10/07 宏觀展業的劉佳勳、柯智耀兩筆抽成及未付款薪資</label>'+
      '<p data-p35-feedback role="status" aria-live="polite"></p></div></div>'+
      '<footer><button type="button" data-p35-cancel>取消，不更正</button><button type="button" class="p35-danger" data-p35-submit disabled>確認執行指定更正</button></footer></section>';
    document.body.appendChild(pane);
    active={pane,batchId,gate,busy:false,startedDownload:false,completed:false};
    const $in=sel=>$(sel,pane),feedback=(msg)=>{$in('[data-p35-feedback]').textContent=msg};
    const cancel=()=>{if(!active||active.busy)return;pane.remove();active=null;document.removeEventListener('keydown',onEsc)};
    const onEsc=ev=>{if(ev.key==='Escape')cancel()};
    document.addEventListener('keydown',onEsc);
    $in('[data-p35-close]').onclick=cancel;
    $in('[data-p35-cancel]').onclick=cancel;
    const update=()=>{
      const a=active;
      if(!a||a.busy||a.completed)return;
      const confirmedBackup=$in('[data-p35-backup-confirm]').checked,
        confirmedScope=$in('[data-p35-scope]').checked,
        phrase=$in('[data-p35-phrase]').value.trim()===TEXT,
        reason=$in('[data-p35-reason]').value.trim().length>=4;
      $in('[data-p35-submit]').disabled=!(a.startedDownload&&confirmedBackup&&confirmedScope&&phrase&&reason);
    };
    for(const field of ['[data-p35-backup-confirm]','[data-p35-scope]','[data-p35-phrase]','[data-p35-reason]']){
      $in(field).addEventListener('input',update);$in(field).addEventListener('change',update);
    }
    $in('[data-p35-download]').onclick=async()=>{
      if(!active||active.busy||active.completed)return;
      active.busy=true;$in('[data-p35-download]').disabled=true;feedback('正在核對原始帳務版本並準備本機備份…');
      try{
        const current=safePlan(store,batchId);
        if(!current||current.baseline!==gate.baseline)throw new Error('核對期間資料已更新。請關閉並重新打開來源明細，勿使用舊清單。');
        const snapshot=await store.readCommittedSnapshot();
        if(!snapshot?.data?.dailyLogs||!snapshot?.data?.commissions||!snapshot?.data?.payroll)throw new Error('無法取得完整正式資料快照，已停止');
        const after=safePlan(store,batchId);
        if(!after||after.baseline!==gate.baseline)throw new Error('下載期間來源帳務已變更，請重新核對');
        const packageData={format:'KuSheERP-P35-pre-correction-backup',createdAt:new Date().toISOString(),scope:{batchId,date:gate.date,invoiceNo:INVOICE,employeeIds:gate.payroll.map(x=>x.employeeId)},revision:snapshot.revision,precheckBaseline:gate.baseline,data:snapshot.data};
        const raw=JSON.stringify(packageData);
        if(!raw||raw.length<300)throw new Error('備份內容不完整，已停止');
        const obj=new Blob([raw],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(obj),link=document.createElement('a');
        link.href=url;link.download='酷舍ERP_P35更正前完整備份_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
        document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
        active.startedDownload=true;
        $in('[data-p35-backup-status]').textContent='已發起下載；請確認檔案確實儲存後再勾選';
        feedback('請先確認備份檔已實際存放於安全位置。');
      }catch(error){feedback('備份失敗，禁止更正：'+String(error.message||error))}
      finally{if(active){active.busy=false;$in('[data-p35-download]').disabled=false;update()}}
    };
    $in('[data-p35-submit]').onclick=async()=>{
      const a=active;if(!a||a.busy||a.completed||$in('[data-p35-submit]').disabled)return;
      const reason=$in('[data-p35-reason]').value.trim();
      const start=safePlan(store,batchId);
      if(!start||start.baseline!==gate.baseline){
        feedback('來源資料已變動，已停止更正；請關閉重新核對最新帳務。');$in('[data-p35-submit]').disabled=true;return;
      }
      if(!a.startedDownload||!$in('[data-p35-backup-confirm]').checked||!$in('[data-p35-scope]').checked||$in('[data-p35-phrase]').value.trim()!==TEXT||reason.length<4)return;
      a.busy=true;$in('[data-p35-submit]').disabled=true;$in('[data-p35-cancel]').disabled=true;$in('[data-p35-close]').disabled=true;
      feedback('正在執行受保護交易，請勿重複點擊或關閉網頁。');
      try{
        const result=await store.p33Oct07CommissionRepair(batchId,{confirmed:true,phrase:PHRASE,baseline:gate.baseline,reason});
        if(!result?.applied||result.changes?.length!==2)throw new Error('更正提交後回應不完整；請勿重送，先重新核對正式帳務');
        a.completed=true;$in('[data-p35-backup-block]')?.setAttribute('hidden','');
        feedback('P35 更正已提交：劉佳勳、柯智耀各增加 NT$1,750，10 月未付款薪資已同步。其他帳務未執行修改。請重新整理畫面核對。');
        $in('[data-p35-submit]').textContent='已提交（不可重複送出）';
        $in('[data-p35-cancel]').textContent='重新整理並核對';
        $in('[data-p35-cancel]').disabled=false;
        $in('[data-p35-cancel]').onclick=()=>window.location.reload();
        $in('[data-p35-close]').disabled=false;
        $in('[data-p35-close]').onclick=()=>window.location.reload();
      }catch(error){
        const status=String(error?.transactionStatus||'');
        const uncertain=status==='RECOVERY_REQUIRED'||status==='UNKNOWN'||status==='COMMITTED_WITH_NOTIFICATION_WARNING';
        feedback((uncertain?'更正結果無法確認，請勿再次執行，先查看資料復原與付款紀錄。':'操作已停止，請重新核對來源，不要重送舊視窗。')+' '+String(error.message||error));
        if(uncertain)window.KusheRecovery?.showResult?.(error);
        $in('[data-p35-cancel]').disabled=false;$in('[data-p35-close]').disabled=false;
        $in('[data-p35-submit]').disabled=true;
      }finally{if(active)active.busy=false}
    };
    $in('[data-p35-close]').focus();
  }
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-p35-open]');
    if(!button)return;
    event.preventDefault();
    open(String(button.dataset.p35Open||''));
  });
  window.KuSheP35CorrectionUI=Object.freeze({safePlan});
}());