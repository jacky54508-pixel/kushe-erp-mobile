(function p37LabClient(){
 'use strict';
 // P37-9C: standalone lab client. No main ERP config, storage, database, cloud sync or business writes.
 const ENDPOINT='https://ldktrfgzzzmklhsnfrol.supabase.co';
 const API_KEY='sb_publishable__rq4IpEIYl-39fNg1QFt8A_xHyAv8b6';
 const ALLOWED_PATHS=new Set(['/auth/v1/settings','/auth/v1/token','/auth/v1/user','/auth/v1/logout',
   '/rest/v1/p37_lab_members','/rest/v1/p37_lab_cases','/rest/v1/p37_lab_allowances']);
 const $=id=>document.getElementById(id);
 let session=null,busy=false,connectionBusy=false;
 function safePath(){return /(?:^|\/)beta\/p37-lab\/(?:index\.html)?$/.test(String(window.location.pathname||''))}
 function verifyEndpoint(){
  const target=new URL(ENDPOINT),isCorrect=target.protocol==='https:'&&target.hostname==='ldktrfgzzzmklhsnfrol.supabase.co'&&target.port===''&&target.pathname==='/';
  return isCorrect&&/^sb_publishable_/.test(API_KEY)&&safePath();
 }
 function message(id,text,style=''){
  const node=$(id);if(!node)return;
  node.textContent=String(text);node.className='message'+(style?' '+style:'');
 }
 function setBusy(value){busy=value;['login-button','logout-button','read-fixtures'].forEach(id=>{const node=$(id);if(node)node.disabled=value||id==='login-button'&&!verifyEndpoint()||id!=='login-button'&&!Boolean(session)})}
 function now(){return Date.now()}
 function clear(){session=null;setBusy(false);const node=$('fixture-list');if(node)node.replaceChildren();message('data-status','尚未通過測試登入與白名單驗證。')}
 function bearer(){
  if(!session)return null;
  if(now()>=session.expiresAt-30000){clear();message('login-status','測試登入已過期，請重新登入。','error');return null}
  return session.accessToken;
 }
 function safeRequest(path,method){
  const target=new URL(path,ENDPOINT);
  if(target.origin!==ENDPOINT||!ALLOWED_PATHS.has(target.pathname))throw new Error('連線端點不屬於允許的測試服務');
  const allowed=method==='GET'&&['/auth/v1/settings','/auth/v1/user',
    '/rest/v1/p37_lab_members','/rest/v1/p37_lab_cases','/rest/v1/p37_lab_allowances'].includes(target.pathname)||
    method==='POST'&&['/auth/v1/token','/auth/v1/logout'].includes(target.pathname);
  if(!allowed)throw new Error('未允許的資料操作已攔截');
  if(target.pathname==='/auth/v1/token'&&target.search!=='?grant_type=password')throw new Error('只允許既有密碼帳號登入');
  return target;
 }
 async function request(path,{method='GET',accessToken='',body=null}={}){
  if(!verifyEndpoint())throw new Error('BETA 網址或獨立測試連線設定不正確，所有操作已鎖定');
  const target=safeRequest(path,method);
  const abort=new AbortController(),clock=setTimeout(()=>abort.abort(),12000);
  const headers={'apikey':API_KEY,'Accept':'application/json'};
  if(body!==null)headers['Content-Type']='application/json';
  if(accessToken)headers.Authorization='Bearer '+accessToken;
  try{
   const response=await window.fetch(target.href,{
    method,headers,body:body===null?undefined:JSON.stringify(body),signal:abort.signal,
    mode:'cors',redirect:'error',credentials:'omit',cache:'no-store'
   });
   const raw=await response.text();
   let data=null;try{data=raw?JSON.parse(raw):null}catch(_){throw new Error('測試雲端回傳格式不符合預期')}
   return {ok:response.ok,status:response.status,data};
  }catch(error){
   throw new Error(error?.name==='AbortError'?'測試雲端連線逾時':'連線失敗，請檢查專用測試網頁與連線安全設定');
  }finally{clearTimeout(clock)}
 }
 async function connectionCheck(){
  if(connectionBusy)return {ok:false,reason:'BUSY'};
  connectionBusy=true;const button=$('check-connection');if(button)button.disabled=true;
  try{
   const settings=await request('/auth/v1/settings');
   if(!settings.ok)throw new Error('Auth Lab 連線回傳 '+settings.status+'，尚未通過');
   const anonymous=await request('/rest/v1/p37_lab_cases?select=id&limit=1');
   if(anonymous.ok)throw new Error('匿名請求可讀取 P37 測試資料，安全檢查不通過');
   if(![401,403].includes(anonymous.status))throw new Error('匿名請求回傳 '+anonymous.status+'，無法證明 RLS 拒絕');
   message('connection-status','PASS：Auth Lab 端點正常；匿名讀取測試表遭拒絕（HTTP '+anonymous.status+'）。沒有連正式 ERP，也沒有寫入測試資料。','pass');
   return {ok:true,anonymousStatus:anonymous.status};
  }catch(e){message('connection-status','未通過：'+(e?.message||String(e)),'error');return {ok:false,reason:e?.message||String(e)}}
  finally{connectionBusy=false;if(button)button.disabled=!verifyEndpoint()}
 }
 async function login(email,password){
  if(busy)return {ok:false,reason:'BUSY'};
  if(typeof email!=='string'||!email.includes('@')||email.length>254||typeof password!=='string'||!password.length||password.length>200){
   message('login-status','請輸入有效的測試帳號 Email 與密碼。','error');return {ok:false,reason:'INPUT'};
  }
  clear();
  setBusy(true);
  try{
   const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email.trim(),password}});
   if(!result.ok||typeof result.data?.access_token!=='string'||!result.data?.user?.id)throw new Error('帳號驗證失敗，僅能使用已配置的 Auth Lab 測試帳號');
   const token=result.data.access_token,userId=String(result.data.user.id);
   const server=await request('/auth/v1/user',{accessToken:token});
   if(!server.ok||String(server.data?.id||'')!==userId)throw new Error('登入身分無法由 Auth Lab 再次驗證');
   const query='/rest/v1/p37_lab_members?select=user_id,enabled,purpose&user_id=eq.'+encodeURIComponent(userId)+'&limit=2';
   const member=await request(query,{accessToken:token});
   if(!member.ok||!Array.isArray(member.data)||member.data.length!==1||
      String(member.data[0].user_id)!==userId||member.data[0].enabled!==true||
      member.data[0].purpose!=='P37_9B_TEST_ONLY')throw new Error('測試身分未列入 P37 專用白名單，資料存取已拒絕');
   const lifetime=Number(result.data.expires_in)||3600;
   if(!Number.isFinite(lifetime)||lifetime<60)throw new Error('測試登入有效期資訊異常');
   session={accessToken:token,userId,expiresAt:now()+Math.min(lifetime,3600)*1000};
   message('login-status','測試帳號已通過 Auth Lab 身分和 P37 白名單檢查。權杖僅在此頁記憶體中保存，不進入正式 ERP。','pass');
   message('data-status','可以按下唯讀查詢，僅取得此測試帳號所屬的虛構單據。');
   return {ok:true};
  }catch(e){clear();message('login-status',e?.message||'測試登入遭拒絕','error');return {ok:false,reason:e?.message||String(e)}}
  finally{const input=$('login-password');if(input)input.value='';setBusy(false)}
 }
 async function readData(){
  const token=bearer();if(!token){message('data-status','尚未通過測試登入與白名單驗證。','error');return {ok:false,reason:'AUTH_REQUIRED'}}
  if(busy)return {ok:false,reason:'BUSY'};
  setBusy(true);
  try{
   const rows=await request('/rest/v1/p37_lab_cases?select=id,owner_id,case_no,invoice_no,revision,original_gross,original_receivable,original_retention&owner_id=eq.'+
      encodeURIComponent(session.userId)+'&limit=10',{accessToken:token});
   const allowances=await request('/rest/v1/p37_lab_allowances?select=id,owner_id,case_id,discount_gross&owner_id=eq.'+
      encodeURIComponent(session.userId)+'&limit=10',{accessToken:token});
   if(!rows.ok||!allowances.ok||!Array.isArray(rows.data)||!Array.isArray(allowances.data))throw new Error('測試資料查詢遭 RLS 或 API 攔截');
   for(const item of rows.data){
    if(item.owner_id!==session.userId||!/^P37-9B-TEST-[A-Z0-9-]+$/.test(String(item.case_no))||!/^P37-9B-INV-[A-Z0-9-]+$/.test(String(item.invoice_no)))
     throw new Error('測試資料歸屬或虛構單號異常，已停止顯示');
   }
   for(const item of allowances.data)if(item.owner_id!==session.userId)throw new Error('偵測到跨帳號折讓資料，已停止顯示');
   const panel=$('fixture-list');if(panel)panel.replaceChildren();
   for(const item of rows.data){
    const box=document.createElement('article');box.className='fixture';
    const strong=document.createElement('strong');strong.textContent=item.case_no;
    const small=document.createElement('small');small.textContent='含稅原額 NT$'+Number(item.original_gross).toLocaleString('zh-TW')+' · 版本 '+item.revision;
    box.append(strong,small);panel?.append(box);
   }
   message('data-status','PASS：RLS 唯讀查詢完成。測試請款 '+rows.data.length+' 筆，測試折讓 '+allowances.data.length+' 筆。無寫入或正式入帳。','pass');
   return {ok:true,caseCount:rows.data.length,allowanceCount:allowances.data.length};
  }catch(e){message('data-status',e?.message||'資料查詢失敗','error');return {ok:false,reason:e?.message||String(e)}}
  finally{setBusy(false)}
 }
 async function logout(){
  const token=session?.accessToken||null;
  clear();message('login-status','已清除本頁測試登入。');if(!token)return;
  try{await request('/auth/v1/logout',{method:'POST',accessToken:token})}catch(_){/* local token cleared unconditionally */}
 }
 function init(){
  if(!verifyEndpoint()){
   message('connection-status','測試頁網址或連線設定不符合安全白名單，所有連線已停止。','error');
   message('login-status','安全隔離檢查未通過，登入功能已關閉。','error');
   ['check-connection','login-button','logout-button','read-fixtures'].forEach(id=>{if($(id))$(id).disabled=true});
   return;
  }
  $('check-connection')?.addEventListener('click',connectionCheck);
  $('login-form')?.addEventListener('submit',event=>{
   event.preventDefault();
   login($('login-email')?.value||'',$('login-password')?.value||'');
  });
  $('read-fixtures')?.addEventListener('click',readData);
  $('logout-button')?.addEventListener('click',logout);
  setBusy(false);
 }
 window.KusheP37Lab=Object.freeze({endpointVerified:verifyEndpoint,routeAllowed:safePath,
   connectionCheck,login,readData,logout});
 init();
})();
