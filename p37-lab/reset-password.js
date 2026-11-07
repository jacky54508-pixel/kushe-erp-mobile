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
   if(!response.ok){
    if(response.status===429)throw Error("寄送太頻繁（HTTP 429）。Auth Lab 已達寄信限制；請先查看先前成功寄出的郵件，不要連續重試。等寄信配額恢復後再試一次。");
    if(response.status===400||response.status===422)throw Error("測試帳號寄信遭拒（HTTP "+response.status+"）。請核對收件帳號是否獲准收信及 Auth Lab 郵件服務設定。");
    throw Error("寄送未完成（HTTP "+response.status+"）。請核對 Auth Lab 郵件發送設定及限制。");
   }
   show("send-result","若測試帳號符合寄信條件，請到信箱開啟最新一封密碼設定信；不要轉傳連結或驗證碼。");
   return {ok:true};
  }catch(e){show("send-result",e?.message||"寄送失敗",true);return {ok:false}}
  finally{busy=false;if(button)button.disabled=!onPage()}
 }
 function classifyCallback(fragment,query){
  // Do not expose, log, persist or echo raw URL data or Auth tokens.
  const f=new URLSearchParams(fragment.startsWith("#")?fragment.slice(1):fragment);
  const q=new URLSearchParams(query.startsWith("?")?query.slice(1):query);
  const errorCode=(f.get("error_code")||q.get("error_code")||"").toLowerCase();
  const error=(f.get("error")||q.get("error")||"").toLowerCase();
  if(errorCode||error){
   if(["otp_expired","token_expired","expired_token"].includes(errorCode)){
    return {kind:"denied",message:"Supabase 回報：密碼重設連結已過期或已使用（otp_expired）。請等待寄信額度恢復，使用最新的重設信。"};
   }
   return {kind:"denied",message:"Supabase 拒絕此驗證連結（"+(errorCode==="access_denied"?"access_denied":"授權失敗")+"）。可能已使用、過期或驗證遭拒，請勿重複點擊舊連結。"};
  }
  // PKCE needs the matching locally created code_verifier; accepting a naked
  // ?code= token or token_hash as a bearer would bypass the intended flow.
  if(q.has("code")||f.has("code")){
   return {kind:"unsupported",message:"這是 PKCE 授權碼連結（?code=），目前測試頁沒有配對的驗證碼，不能安全換取登入權杖。請檢查重設信的驗證流程，勿重複寄送。"};
  }
  if(q.has("token_hash")||f.has("token_hash")){
   return {kind:"unsupported",message:"這是 token_hash 驗證格式，本測試頁尚未支援安全驗證。請勿把驗證碼當成登入權杖或貼給任何人。"};
  }
  if(!fragment){
   const cacheOnly=/^\?(?:v|cache)=[A-Za-z0-9_-]{1,80}$/.test(query);
   return {kind:query&&!cacheOnly?"unsupported":"empty",
    message:query&&!cacheOnly?"此驗證連結的格式不適用，尚未通過身份認證。請檢查最新郵件的回呼網址。":"尚未由有效的密碼設定信開啟。"};
  }
  const access=f.getAll("access_token");
  const kind=f.getAll("type");
  const ttls=f.getAll("expires_in");
  const times=f.getAll("expires_at");
  if(access.length!==1||kind.length!==1||kind[0]!=="recovery"){
   return {kind:"unsupported",message:"此連結不是有效的密碼復原登入格式；請確認它來自最新的測試帳號重設郵件。"};
  }
  const ttl=ttls.length===0?600:Number(ttls[0]);
  if(ttls.length>1||!Number.isFinite(ttl)||ttl<30||
     access[0].length<40||access[0].length>8192){
   return {kind:"invalid",message:"密碼設定連結缺少有效權杖或有效期限，已停止驗證。請勿反覆使用舊連結。"};
  }
  if(times.length>1||times.length===1&&
     (!/^\d{10}$/.test(times[0])||Number(times[0])<=Date.now()/1000)){
   return {kind:"expired",message:"此密碼設定連結已超過有效期限，請改用最新的測試郵件。"};
  }
  if(f.has("token_type")&&f.get("token_type")!=="bearer"){
   return {kind:"invalid",message:"驗證連結的權杖類型不符合安全設定。"};
  }
  return {kind:"token",access:access[0],ttl:Math.min(ttl,600)};
 }
 async function verifyLink(){
  clearAuth();
  const l=window.location,fragment=String(l.hash||""),query=String(l.search||"");
  // Scrub sensitive callback URL *synchronously* before any await or fetch.
  if(fragment||query){
   try{window.history.replaceState(null,"",l.pathname)}
   catch(_){
    show("verify-result","瀏覽器無法安全移除驗證連結資訊，已停止操作。",true);
    return {ok:false};
   }
  }
  const callback=classifyCallback(fragment,query);
  if(callback.kind!=="token"){
   show("verify-result",callback.message,callback.kind!=="empty");
   return {ok:false};
  }
  try{
   const user=await call("/auth/v1/user","GET",null,callback.access);
   if(!user.ok){
    if(user.status===401||user.status===403)
     throw Error("Auth Lab 拒絕此登入權杖（HTTP "+user.status+"），可能已失效；未允許設定密碼。");
    throw Error("Auth Lab 尚未確認登入身分（HTTP "+user.status+"），已停止設定密碼。");
   }
   const id=String(user.data?.id||"").toLowerCase();
   if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))
    throw Error("Auth Lab 回傳的使用者身分無效");
   const membership=await call("/rest/v1/p37_lab_members?select=user_id,enabled,purpose&user_id=eq."+id+"&limit=1","GET",null,callback.access);
   if(!membership.ok||!Array.isArray(membership.data)||membership.data.length!==1||
     String(membership.data[0].user_id).toLowerCase()!==id||membership.data[0].enabled!==true||
     membership.data[0].purpose!=="P37_9B_TEST_ONLY")
    throw Error("此帳號未獲 P37 測試白名單授權");
   token=callback.access;userId=id;expiresAt=Date.now()+callback.ttl*1000;
   lock(true);show("verify-result","已通過 Auth Lab 身分與 P37 白名單驗證，可以設定專用測試密碼。");
   return {ok:true};
  }catch(e){clearAuth();show("verify-result",e?.message||"驗證失敗，已停止操作。",true);return {ok:false}}
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
