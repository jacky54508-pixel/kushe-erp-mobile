(function p378isolated(){
 'use strict';
 // P37-8: a separate, synthetic-only IndexedDB. Never open the formal ERP DB or cloud backend.
 const DB_NAME='KUSHE_P37_8_ISOLATED_TEST_ONLY_20261104',DB_VERSION=1;
 const CASES='synthetic_cases',EVENTS='synthetic_events',STABLE_ID='P37-8-TEST-STABLE-001';
 const SCHEMA='kushe-p37-8-isolated-test-v1';
 const $=(q,root=document)=>root.querySelector(q);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>'NT$'+Number(x||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const copy=x=>JSON.parse(JSON.stringify(x));
 const baseline=Object.freeze({invoiceNo:'SYNTHETIC-P37-8-INVOICE',billingNo:'SYNTHETIC-P37-8-BILL',untaxed:1248000,tax:62400,gross:1310400,receivable:1185600,retention:124800});
 const allowance=Object.freeze({untaxed:26000,tax:1300,gross:27300,receivable:24700,retention:2600});
 const numeric=['untaxed','tax','gross','receivable','retention'];
 function error(code,message){const e=new Error(message);e.code=code;return e}
 function stop(code,message){throw error(code,message)}
 function expected(base=baseline,delta={untaxed:0,tax:0,gross:0,receivable:0,retention:0}){
  const out={};for(const key of numeric){out[key]=base[key]-delta[key];if(!Number.isSafeInteger(out[key])||out[key]<0)stop('INVALID_MONEY','隔離金額異常：'+key)}
  if(out.untaxed+out.tax!==out.gross||out.receivable+out.retention!==out.gross)stop('BALANCE_ERROR','隔離未稅、稅額、應收與保留款不平衡');
  return out;
 }
 function freshCase(id){
  if(typeof id!=='string'||!/^P37-8-TEST-[A-Za-z0-9-]{1,100}$/.test(id))stop('INVALID_FIXTURE','不可建立非測試用編號');
  return {schema:SCHEMA,id,revision:0,source:'SYNTHETIC_FIXTURE_ONLY',original:copy(baseline),adjustments:[],effective:expected(),status:'OPEN'};
 }
 function checkCase(row){
  if(!row||row.schema!==SCHEMA||row.source!=='SYNTHETIC_FIXTURE_ONLY'||!/^P37-8-TEST-[A-Za-z0-9-]{1,100}$/.test(String(row.id||''))||
    JSON.stringify(row.original)!==JSON.stringify(baseline)||!Number.isSafeInteger(row.revision)||row.revision<0||row.revision>1||
    !Array.isArray(row.adjustments)||row.adjustments.length!==row.revision)
    stop('FOREIGN_OR_CORRUPT','隔離資料格式異常或來源不符，禁止覆蓋');
  let delta={untaxed:0,tax:0,gross:0,receivable:0,retention:0};
  if(row.revision===1){
   const a=row.adjustments[0];
   if(!a||a.key!==row.id+':1'||a.type!=='TEST_ALLOWANCE_ONLY'||a.status!=='ISOLATED_NOT_POSTED'||
      JSON.stringify(a.amounts)!==JSON.stringify(allowance))
    stop('CORRUPT_JOURNAL','隔離折讓版本或金額異常，禁止覆蓋');
   delta=a.amounts;
  }
  if(JSON.stringify(row.effective)!==JSON.stringify(expected(baseline,delta))||row.status!==(row.revision?'ISOLATED_NOT_POSTED':'OPEN'))
   stop('CORRUPT_BALANCE','隔離有效餘額不符合原始資料及折讓');
  return row;
 }
 function checkAuth(){
  if(!/(?:^|\/)beta(?:\/|$)/.test(String(window.location?.pathname||'')))
   stop('BETA_REQUIRED','P37-8 隔離測試只能在 BETA 執行');
  const auth=window.KusheAuthGate,person=auth?.user?.(),ctx=auth?.companyContext?.();
  if(!person?.id||!ctx?.companyId||String(ctx.userId||'')!==String(person.id)||
     String(ctx.legacySourceUserId||'')!==String(person.id)||!auth.canWrite?.('billings'))
   stop('AUTH_REQUIRED','未取得經驗證的公司請款編輯權限');
  if(!window.indexedDB?.open)stop('IDB_UNAVAILABLE','瀏覽器未提供 IndexedDB，不可測試持久化');
 }
 function checkLive(billingId){
  checkAuth();
  const v=window.KusheP376FinalGate?.validate?.(billingId);
  if(!v?.ok||v.postingEnabled!==false||v.review?.canPost!==false)
   stop('SOURCE_NOT_VERIFIED','原始請款的 P37-6 唯讀預檢未通過');
 }
 function openDB(){
  checkAuth();
  return new Promise((resolve,reject)=>{
   let settled=false;
   const req=window.indexedDB.open(DB_NAME,DB_VERSION);
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains(CASES))db.createObjectStore(CASES,{keyPath:'id'});
    if(!db.objectStoreNames.contains(EVENTS))db.createObjectStore(EVENTS,{keyPath:'key'});
   };
   req.onsuccess=()=>{
    const db=req.result;
    if(settled){db.close();return}
    if(!db.objectStoreNames.contains(CASES)||!db.objectStoreNames.contains(EVENTS)){
     settled=true;db.close();reject(error('DB_STRUCTURE','獨立測試資料庫結構不正確'));return;
    }
    db.onversionchange=()=>db.close();
    settled=true;resolve(db);
   };
   req.onerror=()=>{if(!settled){settled=true;reject(req.error||error('IDB_OPEN_FAILED','無法開啟隔離測試資料庫'))}};
   req.onblocked=()=>{if(!settled){settled=true;reject(error('IDB_BLOCKED','另一個頁面正在使用不同版本的隔離測試資料庫'))}};
  });
 }
 function done(db,stores,mode,enqueue){
  return new Promise((resolve,reject)=>{
   let tx,output,thrown=null;
   try{tx=db.transaction(stores,mode)}catch(e){db.close();reject(e);return}
   tx.oncomplete=()=>{db.close();resolve(output)};
   tx.onabort=()=>{db.close();reject(thrown||tx.error||error('IDB_ABORTED','隔離交易已中止'))};
   tx.onerror=()=>{ /* onabort owns the failure */ };
   const abort=e=>{thrown=e;try{tx.abort()}catch(_){/* transaction already failed */}};
   try{enqueue(tx,(v)=>{output=v},abort)}catch(e){abort(e)}
  });
 }
 async function seed(id=STABLE_ID){
  checkAuth();
  const desired=freshCase(id),db=await openDB();
  return done(db,[CASES],'readwrite',(tx,set,abort)=>{
   const store=tx.objectStore(CASES),req=store.get(id);
   req.onsuccess=()=>{
    try{
     const existing=req.result;
     if(existing){checkCase(existing);set({created:false,case:copy(existing)})}
     else {store.add(desired);set({created:true,case:copy(desired)})}
    }catch(e){abort(e)}
   };
  });
 }
 async function read(id=STABLE_ID){
  checkAuth();
  const db=await openDB();
  const raw=await done(db,[CASES,EVENTS],'readonly',(tx,set)=>{
   let row=null,journal=null;
   const r=tx.objectStore(CASES).get(id),j=tx.objectStore(EVENTS).get(id+':1');
   let finished=0;
   const collect=()=>{finished++;if(finished===2)set({row,journal})};
   r.onsuccess=()=>{row=r.result||null;collect()};
   j.onsuccess=()=>{journal=j.result||null;collect()};
  });
  if(raw?.row){
   checkCase(raw.row);
   if(Boolean(raw.journal)!==Boolean(raw.row.revision===1)||
      raw.journal&&(raw.journal.key!==id+':1'||raw.journal.caseId!==id||raw.journal.revision!==1||
        raw.journal.status!=='ISOLATED_NOT_POSTED'||JSON.stringify(raw.journal.amounts)!==JSON.stringify(allowance)))
    stop('JOURNAL_MISMATCH','隔離帳務與事件紀錄無法一對一核對');
  }else if(raw?.journal)stop('ORPHAN_EVENT','存在無主隔離事件紀錄');
  return raw?.row?{exists:true,case:copy(raw.row),event:raw.journal?copy(raw.journal):null}:{exists:false,case:null,event:null};
 }
 async function apply(id,expectedRevision=0,faultPoint=''){
  checkAuth();
  if(!['','AFTER_CASE_WRITE','AFTER_EVENT_WRITE','BEFORE_COMMIT'].includes(faultPoint))
   stop('INVALID_FAULT','不支援的故障注入位置');
  const db=await openDB();
  return done(db,[CASES,EVENTS],'readwrite',(tx,set,abort)=>{
   const cases=tx.objectStore(CASES),events=tx.objectStore(EVENTS),req=cases.get(id);
   req.onsuccess=()=>{
    try{
     const row=checkCase(req.result);
     if(row.revision>0)stop('ALREADY_APPLIED','同一隔離請款的折讓已存在，禁止重複寫入');
     if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==row.revision)
      stop('VERSION_CONFLICT','隔離資料版本已更新，禁止過期覆蓋');
     const next=copy(row),item={key:id+':1',type:'TEST_ALLOWANCE_ONLY',status:'ISOLATED_NOT_POSTED',amounts:copy(allowance)};
     next.revision=1;next.adjustments=[item];next.effective=expected(baseline,allowance);next.status='ISOLATED_NOT_POSTED';
     checkCase(next);
     cases.put(next);
     if(faultPoint==='AFTER_CASE_WRITE')stop('INJECTED_ROLLBACK','故障注入：案例寫入後交易撤銷');
     events.add({key:item.key,caseId:id,revision:1,status:'ISOLATED_NOT_POSTED',amounts:copy(allowance)});
     if(faultPoint==='AFTER_EVENT_WRITE'||faultPoint==='BEFORE_COMMIT')
      stop('INJECTED_ROLLBACK','故障注入：事件寫入後交易撤銷');
     set({ok:true,case:copy(next),revision:1});
    }catch(e){abort(e)}
   };
  });
 }
 function caseId(type){
  return 'P37-8-TEST-'+type+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
 }
 async function testPersistence(){
  checkAuth();
  const first=await seed();
  const initial=first.case.revision;
  let applied='ALREADY_APPLIED';
  if(initial===0){await apply(STABLE_ID,0);applied='NEW_TRANSACTION'}
  const persisted=await read();
  if(!persisted.exists||persisted.case.revision!==1||!persisted.event||
    persisted.case.effective.gross!==1283100||persisted.case.effective.receivable!==1160900||
    persisted.case.effective.retention!==122200)stop('PERSISTENCE_FAILED','隔離交易跨連線重新讀取未通過');
  let duplicateBlocked=false;
  try{await apply(STABLE_ID,0)}catch(e){duplicateBlocked=e?.code==='ALREADY_APPLIED'}
  if(!duplicateBlocked)stop('IDEMPOTENCY_FAILED','重複折讓未被阻止');
  const checked=await read();
  if(checked.case.revision!==1||!checked.event)stop('JOURNAL_CHANGED','重複操作意外更動既有折讓');
  let rollbacks=0;
  for(const point of ['AFTER_CASE_WRITE','AFTER_EVENT_WRITE','BEFORE_COMMIT']){
   const id=caseId('FAULT');await seed(id);
   let rejected=false;
   try{await apply(id,0,point)}catch(e){rejected=e?.code==='INJECTED_ROLLBACK'}
   const after=await read(id);
   if(!rejected||!after.exists||after.case.revision!==0||after.event)stop('ROLLBACK_FAILED','真正 IndexedDB 故障中止未完全回復：'+point);
   const done=await apply(id,0),recovered=await read(id);
   if(!done.ok||recovered.case.revision!==1||!recovered.event)stop('ROLLBACK_RETRY_FAILED','故障後重新執行未成功：'+point);
   rollbacks++;
  }
  return {ok:true,kind:'REAL_LOCAL_IDB_ONLY',dbName:DB_NAME,storedRevision:checked.case.revision,created:first.created,
    result:applied,reopened:true,duplicateBlocked:true,rollbacksRecovered:rollbacks,
    officialERPUnchanged:true,cloudSyncExecuted:false};
 }
 async function testConcurrent(){
  checkAuth();
  const id=caseId('CAS');await seed(id);
  const result=await Promise.allSettled([apply(id,0),apply(id,0)]);
  const wins=result.filter(r=>r.status==='fulfilled'),losses=result.filter(r=>r.status==='rejected');
  const final=await read(id);
  if(wins.length!==1||losses.length!==1||!['ALREADY_APPLIED','VERSION_CONFLICT'].includes(losses[0].reason?.code)||
     final.case?.revision!==1||!final.event)
   stop('CAS_RACE_FAILED','兩條真實 IndexedDB 連線未能保證只有一筆折讓');
  return {ok:true,connections:2,successfulTransactions:1,rejectedTransactions:1,storedRevision:1,cloudDevicesTested:0};
 }
 function mount(after,billingId){
  if(!after?.insertAdjacentElement||!billingId||after.parentElement?.querySelector('.p378-panel'))return false;
  const panel=document.createElement('section');panel.className='p378-panel';
  panel.innerHTML='<h3>P37-8｜獨立資料庫持久化驗證</h3>'+
   '<p>使用全新的 <strong>IndexedDB 隔離測試資料庫</strong>，保存固定虛構單號與測試金額；不讀寫正式 ERP 資料庫、發票或銀行流水。關閉並重新開啟瀏覽器後可再次讀取測試紀錄。</p>'+
   '<div class="p378-buttons"><button type="button" data-p378-read>建立／讀取隔離測試紀錄</button>'+
   '<button type="button" data-p378-atomic>測試真實持久化、故障回復與防重複</button>'+
   '<button type="button" data-p378-cas>測試同機雙連線版本衝突</button></div>'+
   '<p class="p378-status" role="status">尚未執行。點選才會寫入獨立測試資料庫，不會改動原請款。</p>'+
   '<div class="p378-results" hidden></div>'+
   '<p class="p378-warning"><strong>真正兩台裝置的雲端同步：尚未驗證。</strong> 尚無獲確認的獨立 P37 測試雲端，本階段不接觸正式 ERP 雲端或其他驗證專案；正式入帳仍不可用。</p>';
  after.insertAdjacentElement('afterend',panel);
  const status=$('.p378-status',panel),result=$('.p378-results',panel),buttons=Array.from(panel.querySelectorAll('button'));
  let busy=false;
  async function run(task){
   if(busy)return;busy=true;buttons.forEach(x=>x.disabled=true);
   try{
    checkLive(billingId);
    const v=await task();result.hidden=false;
    result.innerHTML='<p class="p378-ok">'+esc(v.title)+'</p><p>'+esc(v.text)+'</p>';
    status.textContent='只操作獨立 IndexedDB 測試資料，正式帳務與雲端均未修改。';
    status.classList.remove('is-error');
   }catch(e){result.hidden=false;result.textContent=e?.message||String(e);status.textContent='測試未通過，已停止；請勿清除 ERP 網站資料。';status.classList.add('is-error')}
   finally{busy=false;buttons.forEach(x=>x.disabled=false)}
  }
  $('[data-p378-read]',panel).onclick=()=>run(async()=>{
   const seeded=await seed(),rec=await read();
   return {title:'隔離測試資料庫可開啟與讀取',text:'資料庫：'+DB_NAME+'；固定虛構測試單 '+STABLE_ID+
     '；已儲存版本 '+rec.case.revision+'；'+(seeded.created?'首次建立':'從既有資料重新讀取')+'。這不是正式帳務紀錄。'};
  });
  $('[data-p378-atomic]',panel).onclick=()=>run(async()=>{
   const s=await testPersistence();
   return {title:'真實本機 IndexedDB 持久化與交易測試通過',text:'固定虛構單版本 '+s.storedRevision+
     '；故障回復 '+s.rollbacksRecovered+' 次；重複折讓已阻擋；關閉資料庫後重新讀取一致。'};
  });
  $('[data-p378-cas]',panel).onclick=()=>run(async()=>{
   const s=await testConcurrent();
   return {title:'同一瀏覽器雙連線版本競爭測試通過',text:'獨立資料庫連線 '+s.connections+
     ' 條，同時嘗試寫入只有 '+s.successfulTransactions+' 筆成功、'+s.rejectedTransactions+
     ' 筆被攔截；正式跨裝置雲端同步仍未測試。'};
  });
  return true;
 }
 window.KusheP378IsolatedDB=Object.freeze({DB_NAME,STABLE_ID,freshCase,checkCase,checkAuth,seed,read,apply,testPersistence,testConcurrent,mount});
})();
