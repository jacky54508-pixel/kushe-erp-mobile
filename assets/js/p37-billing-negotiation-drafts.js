(function p37DraftModule(){
 'use strict';
 // P37-2: strictly beta-local drafts. No ERP Store mutation, Cloud Sync or formal tax-document issuance.
 const SCHEMA='kushe-p37-beta-drafts-v1',PREFIX='kushe_p37_beta_drafts_v1::',MAX_VERSIONS=250;
 const ANCHORS=['id','number','customer','project','invoiceNo','invoiceStatus','originalNet','originalTax','originalGross','originalRetention','originalReceivable','retentionRate','retentionBase','received','retentionReceived'];
 const fmt=value=>'$'+Number(value).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function stop(msg){throw new Error(msg)}
 function validDate(input){
  const s=String(input??''),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)return false;
  const y=Number(m[1]),month=Number(m[2]),d=Number(m[3]),v=new Date(Date.UTC(y,month-1,d));
  return y>=2000&&y<=2100&&v.getUTCFullYear()===y&&v.getUTCMonth()+1===month&&v.getUTCDate()===d;
 }
 function anchor(b){
  if(!b||!String(b.id||''))stop('請先核對原始請款資料');
  return JSON.stringify(ANCHORS.map(k=>b[k]??null));
 }
 function owner(){
  if(!/(?:^|\/)beta(?:\/|$)/.test(String(window.location?.pathname||'')))stop('草稿功能僅允許在 beta 測試站使用');
  const auth=window.KusheAuthGate,user=auth?.user?.(),context=auth?.companyContext?.(),userId=String(user?.id||''),companyId=String(context?.companyId||'');
  if(!userId||!companyId||String(context.userId||'')!==userId||String(context.legacySourceUserId||'')!==userId||!auth.canWrite?.('billings'))stop('請款草稿權限或公司身分尚未通過驗證');
  if(!window.localStorage?.getItem||!window.localStorage?.setItem)stop('此瀏覽器無法使用本機草稿儲存區');
  return {userId,companyId,key:PREFIX+encodeURIComponent(companyId)+'::'+encodeURIComponent(userId)};
 }
 function empty(ctx){return {schema:SCHEMA,userId:ctx.userId,companyId:ctx.companyId,records:{}}}
 function get(ctx){
  let raw;try{raw=window.localStorage.getItem(ctx.key)}catch(_){stop('無法讀取 beta 本機草稿')}
  if(raw===null)return empty(ctx);
  if(typeof raw!=='string'||raw.length>4000000)stop('本機草稿檔案過大，禁止覆蓋');
  let data;try{data=JSON.parse(raw)}catch(_){stop('本機草稿 JSON 損壞，為避免資料遺失已禁止覆蓋')}
  if(!data||data.schema!==SCHEMA||data.userId!==ctx.userId||data.companyId!==ctx.companyId||!data.records||typeof data.records!=='object'||Array.isArray(data.records))stop('草稿格式或歸屬不符，禁止覆蓋');
  for(const [id,row] of Object.entries(data.records)){
   if(!row||row.billingId!==id||typeof row.anchor!=='string'||!Array.isArray(row.history)||!row.history.length||row.history.length>MAX_VERSIONS)stop('草稿修改歷程異常，禁止覆蓋');
   row.history.forEach((item,i)=>{
    if(!item||item.version!==i+1||!Number.isSafeInteger(item.approvedGross)||item.approvedGross<=0||!validDate(item.date)||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>500||typeof item.savedAt!=='string'||!Number.isFinite(Date.parse(item.savedAt)))stop('草稿版本內容損壞，禁止覆蓋');
   });
  }
  return data;
 }
 function clone(v){return JSON.parse(JSON.stringify(v))}
 function read(baseline){
  try{
   const ctx=owner(),data=get(ctx),row=Object.prototype.hasOwnProperty.call(data.records,baseline.id)?data.records[baseline.id]:null;
   const history=row?clone(row.history):[];
   return {ok:true,key:ctx.key,history,version:history.length,latest:history.at(-1)||null,stale:Boolean(row&&row.anchor!==anchor(baseline))};
  }catch(error){return {ok:false,error:error?.message||String(error),history:[],version:0,latest:null,stale:true}}
 }
 function save(baseline,input,expectedVersion){
  const ctx=owner(),signature=anchor(baseline);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)stop('草稿版本無效，請重新開啟');
  const preview=window.KusheBillingNegotiationPreview,live=preview?.inspect?.({id:baseline.id});
  if(!live?.ok||anchor(live.baseline)!==signature)stop('原始請款、發票、收款或保留款資料已異動，請關閉重新核對');
  const outcome=preview.calculate(live.baseline,String(input?.approvedGross??''));
  if(!outcome?.ok||outcome.discount.gross<=0)stop(outcome?.error||'折讓金額必須大於零才可儲存草稿');
  const date=String(input?.date??''),reason=String(input?.reason??'').trim();
  if(!validDate(date))stop('請輸入有效的議價日期');
  if(!reason||reason.length>500)stop('議價原因必須為 1 至 500 字');
  const data=get(ctx),prior=Object.prototype.hasOwnProperty.call(data.records,baseline.id)?data.records[baseline.id]:null,version=prior?.history.length||0;
  if(version!==expectedVersion)stop('草稿已有新版本，請關閉重新開啟以免覆蓋');
  if(prior&&prior.anchor!==signature)stop('原始帳務與既有草稿不一致，禁止覆蓋');
  const last=prior?.history.at(-1);
  if(last&&last.approvedGross===outcome.approved.gross&&last.date===date&&last.reason===reason)return {ok:true,unchanged:true,version,latest:clone(last)};
  if(version>=MAX_VERSIONS)stop('草稿已達版本上限，不能刪除舊版來繼續儲存');
  const item={
   version:version+1,savedAt:new Date().toISOString(),date,reason,approvedGross:outcome.approved.gross,
   approvedNet:outcome.approved.net,approvedTax:outcome.approved.tax,approvedRetention:outcome.approved.retention,approvedReceivable:outcome.approved.receivable,
   discountGross:outcome.discount.gross,discountNet:outcome.discount.net,discountTax:outcome.discount.tax,discountRetention:outcome.discount.retention,discountReceivable:outcome.discount.receivable,
   authorUserId:ctx.userId,status:'BETA_LOCAL_DRAFT_ONLY'
  };
  const rec={billingId:baseline.id,billingNo:String(baseline.number||''),anchor:signature,history:[...(prior?.history||[]),item]};
  const next={schema:SCHEMA,userId:ctx.userId,companyId:ctx.companyId,records:{...data.records,[baseline.id]:rec}};
  const raw=JSON.stringify(next);
  if(raw.length>4000000)stop('草稿儲存容量超限；原始草稿不會被刪除');
  try{window.localStorage.setItem(ctx.key,raw)}catch(_){stop('本機草稿寫入失敗；正式 ERP 帳務不受影響')}
  let verify;try{verify=window.localStorage.getItem(ctx.key)}catch(_){stop('草稿寫入後無法驗證，請勿重複送出')}
  if(verify!==raw)stop('草稿寫入驗證不一致，請勿重複送出');
  return {ok:true,unchanged:false,version:item.version,latest:clone(item)};
 }
 function historyMarkup(records){
  if(!records.length)return '<p>尚無本機草稿。</p>';
  return '<ol class="p37-draft-list">'+records.slice().reverse().map(v=>'<li><div><b>第 '+Number(v.version)+' 版</b><span>'+esc(new Date(v.savedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}))+'</span></div><p>核定含稅 '+fmt(v.approvedGross)+' ｜折讓 '+fmt(v.discountGross)+' ｜議價日期 '+esc(v.date)+'</p><p>備註：'+esc(v.reason)+'</p></li>').join('')+'</ol>';
 }
 function open(reference){
  const preview=window.KusheBillingNegotiationPreview;
  if(!preview?.open)stop('P37-1 議價試算未載入');
  const presented=preview.open(reference);
  if(!presented?.ok)return presented;
  const overlay=document.querySelector('.p37-neg-overlay'),checked=preview.inspect(reference);
  if(!overlay||!checked.ok)return presented;
  const b=checked.baseline,record=read(b),latest=record.ok?record.latest:null;
  let version=record.ok?record.version:0,blocked=!record.ok||record.stale;
  const gross=overlay.querySelector('[data-p37-gross]'),date=overlay.querySelector('[data-p37-date]'),reason=overlay.querySelector('[data-p37-reason]'),body=overlay.querySelector('.p37-neg-body'),footer=overlay.querySelector('.p37-neg-footer');
  if(!gross||!date||!reason||!body||!footer)return presented;
  const title=overlay.querySelector('#p37NegTitle'),eyebrow=overlay.querySelector('.p37-neg-eyebrow'),banner=overlay.querySelector('.p37-neg-warning');
  if(title)title.textContent='請款議價／折讓草稿';
  if(eyebrow)eyebrow.textContent='P37-2 · BETA · 本機草稿';
  if(banner)banner.textContent='可以儲存 beta 專屬本機草稿與歷程，但不修改正式 ERP 請款、發票、應收、保留款、施工、抽成或銀行流水；不開立折讓憑證，也不跨裝置同步。';
  const dateTitle=date.closest('label')?.querySelector('span'),reasonTitle=reason.closest('label')?.querySelector('span');
  if(dateTitle)dateTitle.textContent='議價日期（草稿）';
  if(reasonTitle)reasonTitle.textContent='議價原因／備註（草稿）';
  const status=document.createElement('p');status.className='p37-draft-status';status.setAttribute('role','status');
  const history=document.createElement('details');history.className='p37-draft-history';
  const head=document.createElement('summary');head.textContent='本機草稿修改歷程（'+(record.ok?record.version:0)+' 版）';
  const content=document.createElement('div');content.className='p37-draft-history-content';content.innerHTML=historyMarkup(record.ok?record.history:[]);
  history.append(head,content);body.append(status,history);
  const saveButton=document.createElement('button');saveButton.type='button';saveButton.className='p37-draft-save';saveButton.textContent='儲存本機草稿（不入帳）';saveButton.disabled=blocked;
  footer.insertBefore(saveButton,footer.querySelector('[data-p37-close]'));
  const footerNote=footer.querySelector('span');if(footerNote)footerNote.textContent='BETA 本機草稿，不是正式帳務紀錄';
  if(latest){
   gross.value=String(latest.approvedGross);date.value=latest.date;reason.value=latest.reason;
   gross.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function show(message,error=false){status.textContent=message;status.classList.toggle('is-error',Boolean(error))}
  if(!record.ok)show('草稿暫不可用：'+record.error+'；為防止資料遺失，已關閉儲存。',true);
  else if(record.stale)show('原始帳務與舊草稿已不同，可以查看歷程，但禁止再儲存。',true);
  else if(record.version)show('已載入此瀏覽器本機草稿第 '+record.version+' 版；尚未入帳。');
  else show('目前沒有本機草稿，輸入核定含稅金額、議價日期及原因後可儲存。');
  saveButton.addEventListener('click',()=>{
   if(blocked||saveButton.disabled)return;
   saveButton.disabled=true;
   try{
    const saved=save(b,{approvedGross:gross.value,date:date.value,reason:reason.value},version);
    version=saved.version;
    const updated=read(b);
    if(!updated.ok||updated.stale)stop('儲存後無法核對，請停止操作');
    head.textContent='本機草稿修改歷程（'+updated.version+' 版）';
    content.innerHTML=historyMarkup(updated.history);
    show(saved.unchanged?'草稿內容未變，原版本保留。':'已儲存第 '+version+' 版本機草稿；尚未入帳。');
   }catch(e){show('未儲存：'+(e?.message||String(e)),true)}
   finally{saveButton.disabled=blocked}
  });
  // Another tab's draft update cannot silently replace the opened editor.
  if(record.ok){
   const key=record.key;
   const onStorage=event=>{if(event.key===key||event.key===null){blocked=true;saveButton.disabled=true;show('其他分頁已更新草稿，請重新開啟後再修改。',true)}};
   const cleanup=()=>window.removeEventListener('storage',onStorage);
   window.addEventListener('storage',onStorage);
   overlay.querySelectorAll('[data-p37-close]').forEach(button=>button.addEventListener('click',cleanup));
   overlay.addEventListener('click',event=>{if(event.target===overlay)cleanup()});
   overlay.addEventListener('keydown',event=>{if(event.key==='Escape')cleanup()});
  }
  // Fail visibly when the optional preflight script is missing, rather than silently hiding P37-3.
  try {
   const preflight=window.KusheBillingAllowancePreflight;
   if(!preflight?.mount||preflight.mount(overlay,b)!==true){
    const warning=document.createElement('p');
    warning.className='p37-draft-status is-error';
    warning.textContent='P37-3 安全檢查尚未載入；請重新整理 BETA 後重新開啟。草稿與正式帳務沒有變動。';
    overlay.querySelector('.p37-neg-body')?.append(warning);
   }
  }catch(error){
   const warning=document.createElement('p');
   warning.className='p37-draft-status is-error';
   warning.textContent='P37-3 安全檢查無法開啟：'+(error?.message||String(error))+'。本次沒有入帳。';
   overlay.querySelector('.p37-neg-body')?.append(warning);
  }
  return presented;
 }
 window.KusheBillingNegotiationDrafts=Object.freeze({anchor,read,save,open});
})();
