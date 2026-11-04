(function p37Reset(){
 "use strict";
 // P37-9D: isolated Auth Lab recovery. No main ERP API, sessions or business-data writes.
 const AUTH="https://ldktrfgzzzmklhsnfrol.supabase.co";
 const CALLBACK="https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/reset-password.html";
 const KEY="sb_publishable__rq4IpEIYl-39fNg1QFt8A_xHyAv8b6";
 const byId=id=>document.getElementById(id);
 let token="",userId="",expiresAt=0,busy=false;
 function onPage(){const l=window.location;return l?.protocol==="https:"&&l?.hostname==="jacky54508-pixel.github.io"&&l?.pathname==="/kushe-erp-mobile/beta/p37-lab/reset-password.html"}
 function show(id,content,bad=false){const e=byId(id);if(e){e.textContent=String(content);e.className="message "+(bad?"error":"pass")}}
 function lock(unlocked){for(const id of ["password-new","password-confirm","save-password"]){const e=byId(id);if(e)e.disabled=!unlocked}}
 function clearAuth(){token="";userId="";expiresAt=0;lock(false);for(const id of ["password-new","password-confirm"]){const e=byId(id);if(e)e.value=""}}
 function ready(){return !!token&&!!userId&&Date.now()<expiresAt}
 function endpoint(path,method){
  if(!onPage()||!KEY.startsWith("sb_publishable_"))throw Error("測試頁網址或公開金鑰不符合隔離限制");
  const u=new URL(path,AUTH);
  if(u.origin!==AUTH||u.protocol!=="https:")throw Error("只允許指定的 Auth Lab 雲端");
  const p=u.pathname;
  if(method==="POST"&&p==="/auth/v1/recover"){
   if(u.searchParams.get("redirect_to")!==CALLBACK||Array.from(u.searchParams.keys()).length!==1)throw Error("密碼設定回呼網址不正確");
   return u;
  }
  if(method==="GET"&&p==="/auth/v1/user"&&u.search==="")return u;
  if(method==="GET"&&p==="/rest/v1/p37_lab_members"&&
    /^\?select=user_id,enabled,purpose&user_id=eq\.[0-9a-f-]{36}&limit=1$/.test(u.search))return u;
  if(method==="PUT"&&p==="/auth/v1/user"&&u.search==="")return u;
  if(method==="POST"&&p==="/auth/v1/logout"&&u.search==="")return u;
  throw Error("未允許的測試登入 API");
 }
 async function call(path,method="GET",body=null,accessToken=""){
  const u=endpoint(path,method);
  const headers={apikey:KEY,Accept:"application/json"};
  if(body!==null)headers["Content-Type"]="application/json";
  if(accessToken)headers.Authorization="Bearer "+accessToken;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const res=await window.fetch(u.href,{method,headers,body:body===null?undefined:JSON.stringify(body),
     signal:controller.signal,credentials:"omit",redirect:"error",cache:"no-store",mode:"cors"});
   const raw=await res.text();
   let data=null;
   if(raw){try{data=JSON.parse(raw)}catch(_){throw Error("測試雲端回傳格式錯誤")}}
   return {ok:res.ok,status:res.status,data};
  }catch(e){throw Error(e?.message==="測試雲端回傳格式錯誤"?e.message:"測試雲端無法安全連線，請確認 Auth Lab 轉址與網路")}
  finally{clearTimeout(timeout)}
 }
 async function sendEmail(){
  if(busy)return {ok:false};
  busy=true;const button=byId("send-reset");if(button)button.disabled=true;
  try{
   const email=String(byId("reset-email")?.value||"").trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error("請填寫有效的 P37 測試 Email");
   const path="/auth/v1/recover?redirect_to="+encodeURIComponent(CALLBACK);
   const response=await call(path,"POST",{email});
   if(!response.ok)throw Error("寄送未完成；請確認 Redirect URLs 已加入密碼重設頁，並注意郵件發送限制");
   show("send-result","若測試帳號符合寄信條件，請到信箱開啟最新一封密碼設定信；不要轉傳連結或驗證碼。");
   return {ok:true};
  }catch(e){show("send-result",e?.message||"寄送失敗",true);return {ok:false}}
  finally{busy=false;if(button)button.disabled=!onPage()}
 }
 async function verifyLink(){
  clearAuth();
  const l=window.location,fragment=String(l.hash||""),query=String(l.search||"");
  // Consume the one-time fragment before any awaited request, never put tokens in persistent storage.
  if(fragment||query)try{window.history.replaceState(null,"",l.pathname)}catch(_){}
  if(!fragment){
   show("verify-result",query?"此驗證連結的格式不適用，請重新寄送密碼設定信。":"尚未由有效的密碼設定信開啟。",Boolean(query));
   return {ok:false};
  }
  const params=new URLSearchParams(fragment.slice(1));
  const access=params.get("access_token")||"",type=params.get("type")||"";
  const ttl=Number(params.get("expires_in")||"600");
  if(type!=="recovery"||access.length<40||access.length>8192||!Number.isFinite(ttl)||ttl<30){
   show("verify-result","密碼設定連結無效，請重新寄送。",true);return {ok:false};
  }
  try{
   const user=await call("/auth/v1/user","GET",null,access);
   const id=String(user.data?.id||"").toLowerCase();
   if(!user.ok||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw Error("Auth Lab 驗證身分失敗");
   const membership=await call("/rest/v1/p37_lab_members?select=user_id,enabled,purpose&user_id=eq."+id+"&limit=1","GET",null,access);
   if(!membership.ok||!Array.isArray(membership.data)||membership.data.length!==1||
     String(membership.data[0].user_id).toLowerCase()!==id||membership.data[0].enabled!==true||
     membership.data[0].purpose!=="P37_9B_TEST_ONLY")throw Error("此帳號未獲 P37 測試白名單授權");
   token=access;userId=id;expiresAt=Date.now()+Math.min(ttl,600)*1000;
   lock(true);show("verify-result","已通過測試身分與白名單驗證，可以設定專用測試密碼。");
   return {ok:true};
  }catch(e){clearAuth();show("verify-result",e?.message||"驗證失敗",true);return {ok:false}}
 }
 async function changePassword(){
  if(busy)return {ok:false};
  if(!ready()){clearAuth();show("change-result","密碼設定連結已失效，請重新寄送。",true);return {ok:false}}
  const password=String(byId("password-new")?.value||"");
  const confirmed=String(byId("password-confirm")?.value||"");
  if(password.length<12||password.length>128||password!==confirmed){
   show("change-result","請輸入兩次相同的全新測試密碼（12～128 個字元）。",true);return {ok:false};
  }
  busy=true;const button=byId("save-password");if(button)button.disabled=true;
  const access=token,id=userId;
  try{
   const result=await call("/auth/v1/user","PUT",{password},access);
   if(!result.ok||String(result.data?.id||"").toLowerCase()!==id)throw Error("Auth Lab 尚未確認密碼設定成功");
   clearAuth();
   // A transient Auth Lab logout is permitted; no tokens remain in local state.
   try{await call("/auth/v1/logout","POST",null,access)}catch(_){}
   show("change-result","測試密碼設定成功。返回 P37 測試登入頁，用剛剛設定的新密碼登入。");
   return {ok:true};
  }catch(e){show("change-result",e?.message||"測試密碼設定失敗",true);return {ok:false}}
  finally{busy=false;if(button)button.disabled=!ready()}
 }
 function init(){
  clearAuth();
  if(!onPage()||!KEY.startsWith("sb_publishable_")){
   show("verify-result","不是指定的測試網頁，所有功能已停止。",true);
   if(byId("send-reset"))byId("send-reset").disabled=true;
   return;
  }
  byId("send-reset")?.addEventListener("click",sendEmail);
  byId("save-password")?.addEventListener("click",changePassword);
  verifyLink();
 }
 window.KusheP37Reset=Object.freeze({onPage,sendEmail,verifyLink,changePassword});
 init();
})();
