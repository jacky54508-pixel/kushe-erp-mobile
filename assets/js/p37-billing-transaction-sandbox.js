(function p377SandboxTransactionCore(){
 'use strict';
 // P37-7: SYNTHETIC, IN-MEMORY transaction core. NO production ERP, persistent DB, cloud API or tax-document writes.
 const SCHEMA='kushe-p37-7-sandbox-v1',REMOTE_SCHEMA='kushe-p37-7-mock-remote-v1';
 const $=(sel,root=document)=>root.querySelector(sel);
 const text=x=>String(x??'').trim();
 const esc=x=>text(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=x=>'NT$'+Number(x||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const clone=x=>JSON.parse(JSON.stringify(x));
 const serial=x=>JSON.stringify(x);
 function stop(message){throw new Error(message)}
 function whole(v,label){if(!Number.isSafeInteger(v)||v<0)stop(label+'不是有效的非負整數');return v}
 function checkReview(report){
  if(!report||report.schema!=='kushe-p37-6-final-check-v1'||report.stage!=='DRY_RUN_NOT_POSTED'||
     report.canPost!==false||report.taxVerified!==false||report.officiallyIssued!==false||!Array.isArray(report.pending)||!report.pending.length)
    stop('缺少 P37-6 合格的未入帳驗證結果');
  const s=report.source,t=report.totals;
  if(!s||!t||!text(s.billingId)||!text(s.billingNo)||!text(s.receivableId)||!text(s.invoiceId)||
     !text(s.invoiceNo)||!text(s.documentSnapshot)||!Number.isSafeInteger(s.draftVersion)||s.draftVersion<=0)
    stop('來源請款、應收、發票或草稿版本不足');
  for(const name of ['originalUntaxed','originalTax','originalGross','allowanceUntaxed','allowanceTax','allowanceGross',
    'approvedUntaxed','approvedTax','approvedGross','effectiveReceivable','effectiveRetention','receivableReduction','retentionReduction'])
   whole(t[name],name);
  const initialAR=t.effectiveReceivable+t.receivableReduction,initialRet=t.effectiveRetention+t.retentionReduction;
  if(!Number.isSafeInteger(initialAR)||!Number.isSafeInteger(initialRet)||
    t.originalUntaxed+t.originalTax!==t.originalGross||
    t.allowanceUntaxed+t.allowanceTax!==t.allowanceGross||
    t.approvedUntaxed+t.approvedTax!==t.approvedGross||
    t.originalGross-t.allowanceGross!==t.approvedGross||
    t.originalUntaxed-t.allowanceUntaxed!==t.approvedUntaxed||
    t.originalTax-t.allowanceTax!==t.approvedTax||
    t.allowanceGross!==t.receivableReduction+t.retentionReduction||
    initialAR+initialRet!==t.originalGross||
    t.approvedGross!==t.effectiveReceivable+t.effectiveRetention||t.allowanceGross===0)
    stop('P37-6 折讓、稅額、應收或保留款差額無法勾稽');
  return {source:clone(s),totals:clone(t),initialAR,initialRet};
 }
 function sourceKey(s){return JSON.stringify([s.billingId,s.billingNo,s.receivableId,s.invoiceId,s.invoiceNo,s.documentSnapshot,s.draftVersion])}
 function keyFor(s){return 'sandbox-allowance::'+s.billingId+'::'+s.invoiceNo}
 function makeSandbox(report){
  const info=checkReview(report),s=info.source,t=info.totals;
  // Construct MINIMAL SYNTHETIC fixtures. Do not copy the user's source arrays or mutate live ERP records.
  const fixture={
   billing:{id:s.billingId,number:s.billingNo,net:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,posted:false},
   invoice:{id:s.invoiceId,number:s.invoiceNo,net:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,status:'ISSUED_ORIGINAL_UNCHANGED'},
   receivable:{id:s.receivableId,amount:info.initialAR,received:0},
   retention:{amount:info.initialRet,received:0},
   // These sentinels model unrelated data only. The real ERP records are never loaded into this sandbox.
   other:{receipts:[],customerDeductions:[],bankTransactions:[],commissions:[{id:'synthetic-commission',amount:1234}],
     payroll:[{id:'synthetic-payroll',amount:5678}],cloudSyncWrites:[]}
  };
  const result={
   schema:SCHEMA,mode:'ISOLATED_FIXTURE_ONLY',revision:0,source:s,original:fixture,
   untouchedFence:serial(fixture),allowances:[],derived:{untaxed:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,
     receivable:info.initialAR,retention:info.initialRet},
   status:'NOT_POSTED'
  };
  checkSandbox(result,report);
  return result;
 }
 function derive(sandbox){
  const src=sandbox.original,totals=sandbox.allowances.reduce((agg,a)=>{
   for(const name of ['untaxed','tax','gross','receivable','retention']){
    const num=whole(a.reduction?.[name],name+' 折讓金額');agg[name]+=num;
    if(!Number.isSafeInteger(agg[name]))stop('累計折讓金額溢位');
   }
   return agg;
  },{untaxed:0,tax:0,gross:0,receivable:0,retention:0});
  const effective={
   untaxed:src.billing.net-totals.untaxed,tax:src.billing.tax-totals.tax,gross:src.billing.gross-totals.gross,
   receivable:src.receivable.amount-totals.receivable,retention:src.retention.amount-totals.retention
  };
  Object.entries(effective).forEach(([name,v])=>whole(v,'有效'+name));
  if(effective.untaxed+effective.tax!==effective.gross||
     effective.receivable+effective.retention!==effective.gross||
     totals.untaxed+totals.tax!==totals.gross||totals.receivable+totals.retention!==totals.gross)
   stop('交易後含稅、未稅、應收及保留款無法平衡');
  return effective;
 }
 function checkSandbox(state,report){
  const plan=checkReview(report);
  if(!state||state.schema!==SCHEMA||state.mode!=='ISOLATED_FIXTURE_ONLY'||!state.original||!state.source||!Array.isArray(state.allowances)||
    !Number.isSafeInteger(state.revision)||state.revision<0||state.revision!==state.allowances.length||state.allowances.length>1)
    stop('隔離沙盒資料版本或格式異常');
  if(sourceKey(state.source)!==sourceKey(plan.source))stop('原請款或草稿版本已不同');
  const original=makeOriginal(plan);
  if(serial(state.original)!==serial(original)||state.untouchedFence!==serial(original))stop('原始請款、發票或其他模擬資料被改動');
  const keys=new Set();
  state.allowances.forEach(a=>{
   if(!a||a.schema!=='kushe-p37-7-allowance-sandbox-entry-v1'||a.status!=='SANDBOX_APPLIED_NOT_REAL'||a.idempotencyKey!==keyFor(plan.source)||
     a.sourceSnapshot!==plan.source.documentSnapshot||a.draftVersion!==plan.source.draftVersion||keys.has(a.idempotencyKey))
     stop('隔離折讓已重複、來源版本錯誤或資料格式異常');
   keys.add(a.idempotencyKey);
   const t=plan.totals;
   if(a.reduction?.untaxed!==t.allowanceUntaxed||a.reduction.tax!==t.allowanceTax||a.reduction.gross!==t.allowanceGross||
     a.reduction.receivable!==t.receivableReduction||a.reduction.retention!==t.retentionReduction)
     stop('交易紀錄折讓金額與原審核結果不同');
  });
  const current=derive(state);
  if(serial(state.derived)!==serial(current))stop('隔離有效餘額與累計折讓不一致');
  if(state.revision===0&&state.status!=='NOT_POSTED'||state.revision===1&&state.status!=='SANDBOX_APPLIED_NOT_REAL')
   stop('沙盒交易狀態異常');
  if(state.revision===1){
   const t=plan.totals;
   if(current.untaxed!==t.approvedUntaxed||current.tax!==t.approvedTax||current.gross!==t.approvedGross||
      current.receivable!==t.effectiveReceivable||current.retention!==t.effectiveRetention)
    stop('隔離交易套用後與核定金額不符');
  }
  return {ok:true,revision:state.revision,derived:clone(current)};
 }
 function makeOriginal(plan){
  const s=plan.source,t=plan.totals;
  return {
   billing:{id:s.billingId,number:s.billingNo,net:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,posted:false},
   invoice:{id:s.invoiceId,number:s.invoiceNo,net:t.originalUntaxed,tax:t.originalTax,gross:t.originalGross,status:'ISSUED_ORIGINAL_UNCHANGED'},
   receivable:{id:s.receivableId,amount:plan.initialAR,received:0},
   retention:{amount:plan.initialRet,received:0},
   other:{receipts:[],customerDeductions:[],bankTransactions:[],commissions:[{id:'synthetic-commission',amount:1234}],
    payroll:[{id:'synthetic-payroll',amount:5678}],cloudSyncWrites:[]}
  };
 }
 function applySandbox(state,report,expectedRevision=0,failAt=''){
  const plan=checkReview(report),sourceBefore=serial(state);
  const {revision}=checkSandbox(state,report);
  if(!Number.isSafeInteger(expectedRevision)||revision!==expectedRevision)stop('沙盒版本已更新，禁止覆蓋舊資料');
  if(state.allowances.some(x=>x.idempotencyKey===keyFor(plan.source))||state.allowances.length)
   stop('同一原始請款或發票已存在折讓，禁止重複入帳');
  const t=plan.totals,next=clone(state);
  next.allowances.push({
   schema:'kushe-p37-7-allowance-sandbox-entry-v1',
   idempotencyKey:keyFor(plan.source),billingId:plan.source.billingId,receivableId:plan.source.receivableId,
   invoiceId:plan.source.invoiceId,invoiceNo:plan.source.invoiceNo,sourceSnapshot:plan.source.documentSnapshot,
   draftVersion:plan.source.draftVersion,
   reduction:{untaxed:t.allowanceUntaxed,tax:t.allowanceTax,gross:t.allowanceGross,receivable:t.receivableReduction,retention:t.retentionReduction},
   status:'SANDBOX_APPLIED_NOT_REAL'
  });
  if(failAt==='AFTER_APPEND')stop('隔離故障注入：已追加折讓，模擬交易回復');
  next.derived=derive(next);
  if(failAt==='AFTER_RECALCULATE')stop('隔離故障注入：有效餘額重算後回復');
  next.revision=revision+1;next.status='SANDBOX_APPLIED_NOT_REAL';
  if(failAt==='BEFORE_FINAL_VERIFY')stop('隔離故障注入：提交前校驗失敗，回復原值');
  checkSandbox(next,report);
  if(sourceBefore!==serial(state))stop('來源沙盒於交易期間被修改，已停止');
  return {ok:true,next,version:next.revision,allowance:clone(next.allowances[0]),effective:clone(next.derived),postingEnabled:false,taxVoucherVerified:false};
 }
 function recoveryTest(report){
  const base=makeSandbox(report),before=serial(base),faults=['AFTER_APPEND','AFTER_RECALCULATE','BEFORE_FINAL_VERIFY'];
  for(const point of faults){
   let blocked=false;
   try{applySandbox(base,report,0,point)}catch(e){blocked=String(e.message).includes('隔離故障注入')}
   if(!blocked||serial(base)!==before)stop('故障 '+point+' 並未安全回復原始資料');
  }
  const completed=applySandbox(base,report,0);
  if(serial(base)!==before)stop('重新執行後原始沙盒仍被修改');
  return {ok:true,failuresRecovered:faults.length,retryCommittedInMemory:completed.ok,originalUnchanged:true,version:completed.version};
 }
 function mockCloud(base,report){
  checkSandbox(base,report);
  if(base.revision!==0)stop('模擬遠端必須從原始版本開始');
  return {schema:REMOTE_SCHEMA,remoteVersion:0,sourceKey:sourceKey(base.source),snapshot:clone(base)};
 }
 function mockPublish(remote,local,report,expectedRemoteVersion,deviceMode){
  if(remote?.schema!==REMOTE_SCHEMA||!Number.isSafeInteger(remote.remoteVersion))stop('模擬雲端資料格式異常');
  if(deviceMode!=='trusted')stop('未信任裝置不得直接模擬正式持久化同步');
  if(remote.remoteVersion!==expectedRemoteVersion)stop('REMOTE_VERSION_CONFLICT：遠端已較新，不可覆蓋');
  if(remote.sourceKey!==sourceKey(local?.source)||remote.sourceKey!==sourceKey(report?.source))stop('跨裝置原始來源識別不一致');
  checkSandbox(remote.snapshot,report);checkSandbox(local,report);
  if(local.revision!==remote.snapshot.revision+1||local.revision!==remote.remoteVersion+1)stop('跨裝置資料序列不連續，禁止覆蓋');
  if(remote.snapshot.revision!==0||local.allowances.length!==1)stop('已存在折讓或跨裝置重複提交');
  const next={schema:REMOTE_SCHEMA,remoteVersion:remote.remoteVersion+1,sourceKey:remote.sourceKey,snapshot:clone(local)};
  return next;
 }
 function mockAdopt(remote,local,report,deviceMode){
  if(deviceMode!=='trusted')stop('未信任裝置不允許持久化還原');
  if(remote?.schema!==REMOTE_SCHEMA||remote.sourceKey!==sourceKey(local?.source)||
     remote.sourceKey!==sourceKey(report?.source))stop('跨裝置原始來源識別不一致');
  checkSandbox(remote.snapshot,report);checkSandbox(local,report);
  if(remote.snapshot.revision<=local.revision||remote.remoteVersion!==remote.snapshot.revision)stop('遠端沒有可安全取回的新版本');
  // No local data may be discarded. Only an untouched sandbox fixture may accept a newer preview.
  if(local.revision!==0||local.allowances.length>0)stop('本機存在交易，需人工解決衝突');
  return clone(remote.snapshot);
 }
 function simulateDevices(report){
  const deviceA=makeSandbox(report),deviceB=clone(deviceA),cloud=mockCloud(deviceA,report);
  const appliedA=applySandbox(deviceA,report,0),appliedB=applySandbox(deviceB,report,0);
  const uploaded=mockPublish(cloud,appliedA.next,report,0,'trusted');
  let staleBlocked=false,temporaryBlocked=false;
  try{mockPublish(uploaded,appliedB.next,report,0,'trusted')}catch(e){staleBlocked=/REMOTE_VERSION_CONFLICT/.test(String(e.message))}
  try{mockPublish(cloud,appliedB.next,report,0,'temporary')}catch(_){temporaryBlocked=true}
  if(!staleBlocked||!temporaryBlocked||cloud.remoteVersion!==0||deviceA.revision!==0||deviceB.revision!==0)
   stop('跨裝置測試未能擋下過期或未信任裝置的寫入');
  const restored=mockAdopt(uploaded,deviceB,report,'trusted');
  if(serial(restored)!==serial(appliedA.next)||uploaded.remoteVersion!==1)stop('模擬同步後資料無法一致');
  return {ok:true,remoteVersion:1,deviceARevision:appliedA.next.revision,deviceBRestoredRevision:restored.revision,
   staleOverwriteBlocked:true,temporaryWriterBlocked:true,remoteRollbackSafe:true,cloudRequestsMade:0,sourceUnchanged:true};
 }
 function readReview(id,previous){
  const auth=window.KusheAuthGate,person=auth?.user?.(),company=auth?.companyContext?.();
  if(!/(?:^|\/)beta(?:\/|$)/.test(text(window.location?.pathname))||
     !person?.id||!company?.companyId||text(company.userId)!==text(person.id)||
     text(company.legacySourceUserId)!==text(person.id)||!auth?.canWrite?.('billings'))
   stop('P37-7 僅能由已驗證公司請款權限的 BETA 帳號操作');
  const phase=window.KusheP376FinalGate,read=phase?.validate?.(id);
  if(!read?.ok||read.postingEnabled!==false||read.officialTaxVerified!==false||!read.review)
   stop('P37-6 最終唯讀查核尚未通過');
  checkReview(read.review);
  if(previous&&serial(previous.source)!==serial(read.review.source))stop('請款、發票或議價草稿版本已異動，請重新執行');
  return read.review;
 }
 function mount(parent,billingId){
  if(!parent?.parentElement||!billingId||parent.parentElement.querySelector('.p377-panel'))return false;
  const panel=document.createElement('section');panel.className='p377-panel';
  panel.innerHTML='<h3>P37-7｜獨立折讓交易核心隔離驗證</h3>'+
   '<p>使用與正式 ERP 分離的<strong>記憶體測試資料</strong>，模擬折讓交易、失敗回復及兩裝置同步衝突。沒有連接雲端、沒有儲存資料，也沒有正式入帳功能。</p>'+
   '<div class="p377-actions"><button type="button" data-p377-atomic>驗證交易原子性與回復（不入帳）</button>'+
   '<button type="button" data-p377-sync disabled>模擬兩裝置版本衝突（不連雲端）</button></div>'+
   '<p class="p377-status" role="status">尚未執行測試；原請款、發票、應收及員工資料皆不修改。</p>'+
   '<div class="p377-result" hidden></div>'+
   '<p class="p377-warning"><strong>正式入帳仍不可用。</strong> 此處的交易成功、回復及同步均為沙盒測試；尚未驗證實際雲端部署、跨裝置資料還原或正式折讓憑證。</p>';
  parent.insertAdjacentElement('afterend',panel);
  const atomic=$('[data-p377-atomic]',panel),sync=$('[data-p377-sync]',panel),
    status=$('.p377-status',panel),result=$('.p377-result',panel);
  const show=(s,error=false)=>{status.textContent=s;status.classList.toggle('is-error',!!error)};
  let last=null;
  atomic.addEventListener('click',()=>{
   try{
    const review=readReview(billingId);
    const recovery=recoveryTest(review),base=makeSandbox(review),applied=applySandbox(base,review,0);
    last={review,applied};sync.disabled=false;result.hidden=false;
    result.innerHTML='<p class="p377-ok">沙盒交易與故障回復通過（沒有正式入帳）</p><dl class="p377-values">'+[
      ['原發票含稅（不變）',review.totals.originalGross],
      ['獨立擬折讓（含稅）',-review.totals.allowanceGross],
      ['折讓後未稅額（模擬）',applied.effective.untaxed],
      ['折讓後稅額（模擬）',applied.effective.tax],
      ['有效本期應收（模擬）',applied.effective.receivable],
      ['有效保留款（模擬）',applied.effective.retention]
     ].map(([label,n])=>'<div><dt>'+esc(label)+'</dt><dd>'+(n<0?'−':'')+fmt(Math.abs(n))+'</dd></div>').join('')+
     '</dl><p>沙盒折讓紀錄 1 筆；故障注入回復 '+recovery.failuresRecovered+' 次；原始沙盒逐值不變。</p>';
    show('隔離交易核心及模擬回復通過。尚未驗證真實資料庫回復。');
   }catch(error){last=null;sync.disabled=true;result.hidden=false;result.textContent=error?.message||String(error);show('隔離交易安全檢查未通過，沒有修改任何 ERP 資料。',true)}
  });
  sync.addEventListener('click',()=>{
   if(!last)return;
   try{
    const review=readReview(billingId,last.review);
    const test=simulateDevices(review);
    result.hidden=false;
    result.innerHTML='<p class="p377-ok">兩裝置記憶體同步衝突測試通過（不連雲端）</p>'+
     '<p>模擬遠端版本：'+test.remoteVersion+'；裝置 A：'+test.deviceARevision+'；裝置 B 安全取回：'+test.deviceBRestoredRevision+'。</p>'+
     '<p>過期版本覆蓋已攔截；未信任裝置寫入已攔截；測試用遠端與原始資料都沒有被覆蓋。</p>'+
     '<p>沒有執行任何真實跨裝置同步。正式入帳與部署仍未開放。</p>';
    sync.disabled=true;show('純記憶體同步衝突測試通過；尚未驗證 ERP 實際跨裝置同步。');
   }catch(error){sync.disabled=true;show('跨裝置模擬已停止：'+(error?.message||String(error)),true)}
  });
  // P37-8 uses an entirely separate synthetic IndexedDB. No formal ERP persistence is available here.
  try{
   if(window.KusheP378IsolatedDB?.mount?.(panel,billingId)!==true){
    const warn=document.createElement('p');warn.className='p377-status is-error';
    warn.textContent='P37-8 隔離資料庫模組尚未載入；請重新整理 BETA。沒有修改正式帳務。';
    panel.appendChild(warn);
   }
  }catch(error){
   const warn=document.createElement('p');warn.className='p377-status is-error';
   warn.textContent='P37-8 隔離資料庫無法開啟：'+(error?.message||String(error))+'。正式資料未變。';
   panel.appendChild(warn);
  }
  return true;
 }
 window.KusheP377SandboxTransactionCore=Object.freeze({makeSandbox,checkSandbox,applySandbox,recoveryTest,
   mockCloud,mockPublish,mockAdopt,simulateDevices,readReview,mount});
})();
