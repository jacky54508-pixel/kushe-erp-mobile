(function p3719zOtpRecovery(){
"use strict";
// P37-19Z: isolated TEST-LAB-only password recovery OTP candidate.
// Unmounted review file: NEVER use an ERP account or finance APIs.
const AUTH="https://ldktrfgzzzmklhsnfrol.supabase.co";
const PAGE="https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/p37-19z/otp-reset.html";
const CALLBACK="https://jacky54508-pixel.github.io/kushe-erp-mobile/beta/p37-lab/reset-password.html";
const KEY="sb_publishable__rq4IpEIYl-39fNg1QFt8A_xHyAv8b6";
const byId=id=>document.getElementById(id);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
let email="",access="",userId="",expiresAt=0,busy=false,sentOnce=false,attempts=0;
function onPage(){
 const l=window.location;
 return l?.protocol==="https:"&&l?.hostname==="jacky54508-pixel.github.io"&&
  l?.pathname==="/kushe-erp-mobile/beta/p37-lab/p37-19z/otp-reset.html";
}
function status(id,message,error=false){
 const el=byId(id);
 if(el){el.textContent=String(message);el.className="message "+(error?"error":"pass");}
}
function lock(enabled){
 for(const id of ["password-new","password-confirm","save-password"]){
  const el=byId(id);if(el)el.disabled=!enabled;
 }
}
function clearSession(){
 access="";userId="";expiresAt=0;lock(false);
 for(const id of ["password-new","password-confirm"]){const e=byId(id);if(e)e.value="";}
}
function ready(){return Boolean(access&&userId&&Date.now()<expiresAt);}
function endpoint(path,method){
 if(!onPage()||!KEY.startsWith("sb_publishable_"))throw Error("非指定測試環境，驗證已停止。");
 const u=new URL(path,AUTH);
 if(u.protocol!=="https:"||u.origin!==AUTH)throw Error("只允許指定的 Auth Lab 端點。");
 if(method==="POST"&&u.pathname==="/auth/v1/recover"&&
  u.searchParams.get("redirect_to")===CALLBACK&&
  [...u.searchParams.keys()].length===1)return u;
 if(method==="POST"&&u.pathname==="/auth/v1/verify"&&u.search==="")return u;
 if(method==="GET"&&u.pathname==="/auth/v1/user"&&u.search==="")return u;
 if(method==="PUT"&&u.pathname==="/auth/v1/user"&&u.search==="")return u;
 if(method==="POST"&&u.pathname==="/auth/v1/logout"&&u.search==="")return u;
 if(method==="GET"&&u.pathname==="/rest/v1/p37_lab_members"&&
  /^\?select=user_id,enabled,purpose&user_id=eq\.[0-9a-f-]{36}&limit=1$/.test(u.search))return u;
 throw Error("未允許的 Auth Lab API。");
}
async function api(path,method="GET",body=null,bearer=""){
 const u=endpoint(path,method);
 const headers={apikey:KEY,Accept:"application/json"};
 if(body!==null)headers["Content-Type"]="application/json";
 if(bearer)headers.Authorization="Bearer "+bearer;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const resp=await window.fetch(u.href,{method,headers,
   body:body===null?undefined:JSON.stringify(body),signal:controller.signal,
   credentials:"omit",redirect:"error",cache:"no-store",mode:"cors"});
  const raw=await resp.text();
  let data=null;
  if(raw){try{data=JSON.parse(raw)}catch(_){throw Error("測試雲端回傳非預期資料。");}}
  return {ok:resp.ok,status:resp.status,data};
 }catch(e){
  throw Error(e?.message==="測試雲端回傳非預期資料。"?
   e.message:"測試 Auth Lab 連線失敗，未完成驗證。");
 }finally{clearTimeout(timer);}
}
function isEmail(v){return v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function classify(statusCode,action){
 if(statusCode===429)return "Auth Lab 已達速率或寄信限制（HTTP 429），請勿連續重試。";
 if(statusCode===401||statusCode===403)return "測試驗證未通過（HTTP "+statusCode+"）。";
 if(statusCode===400||statusCode===422)return action==="code"?
  "驗證碼無效、已過期或已使用（HTTP "+statusCode+"），請勿反覆嘗試。":
  "Auth Lab 尚未接受此請求（HTTP "+statusCode+"）。";
 return "測試雲端未確認操作（HTTP "+statusCode+"）。";
}
async function sendCode(){
 if(busy||sentOnce){status("send-result","本頁已嘗試寄送一次。請查看郵件，勿連續寄送。",true);return {ok:false};}
 busy=true;const button=byId("send-otp");if(button)button.disabled=true;
 try{
  const e=String(byId("otp-email")?.value||"").trim().toLowerCase();
  if(!isEmail(e))throw Error("請輸入已建立的 Auth Lab 測試帳號 Email。");
  // A failed HTTP request must not trigger automatic resend attempts.
  sentOnce=true;
  const response=await api("/auth/v1/recover?redirect_to="+encodeURIComponent(CALLBACK),"POST",{email:e});
  if(!response.ok)throw Error(classify(response.status,"send"));
  email=e;
  if(byId("otp-email"))byId("otp-email").readOnly=true;
  if(byId("otp-code"))byId("otp-code").disabled=false;
  if(byId("verify-otp"))byId("verify-otp").disabled=false;
  status("send-result","已提出一次寄送請求。請查看最新的測試郵件，將其中 6 位驗證碼輸入下方；信件必須使用含驗證碼的 Recovery 範本。");
  return {ok:true};
 }catch(e){status("send-result",e?.message||"寄送失敗。",true);return {ok:false};}
 finally{busy=false;if(button)button.disabled=sentOnce||!onPage();}
}
async function bestEffortLogout(bearer){
 if(!bearer)return;
 try{await api("/auth/v1/logout","POST",null,bearer)}catch(_){}
}
async function verifyCode(){
 if(busy)return {ok:false};
 if(!onPage()||!isEmail(email)||attempts>=3){
  status("verify-result","驗證條件不足或本頁已達本機嘗試上限，請停止操作。",true);
  return {ok:false};
 }
 const code=String(byId("otp-code")?.value||"").trim();
 if(!/^\d{6}$/.test(code)){
  status("verify-result","請輸入郵件中完整的 6 位數字驗證碼。",true);
  return {ok:false};
 }
 attempts++;
 busy=true;
 if(byId("verify-otp"))byId("verify-otp").disabled=true;
 let candidate="";
 try{
  const result=await api("/auth/v1/verify","POST",{email,token:code,type:"recovery"});
  if(!result.ok)throw Error(classify(result.status,"code"));
  candidate=String(result.data?.access_token||"");
  const proposedId=String(result.data?.user?.id||"").toLowerCase();
  const ttl=Number(result.data?.expires_in);
  if(candidate.length<40||candidate.length>8192||!UUID.test(proposedId)||
   !Number.isFinite(ttl)||ttl<30||ttl>86400||
   String(result.data?.token_type||"").toLowerCase()!=="bearer")
   throw Error("驗證回應不完整，已停止設定密碼。");
  // Never trust a JWT or user metadata alone: obtain the live Auth user,
  // then enforce membership and purpose through signed PostgREST RLS.
  const user=await api("/auth/v1/user","GET",null,candidate);
  if(!user.ok||String(user.data?.id||"").toLowerCase()!==proposedId)
   throw Error("Auth Lab 登入身分驗證未通過。");
  const members=await api("/rest/v1/p37_lab_members?select=user_id,enabled,purpose&user_id=eq."+
   proposedId+"&limit=1","GET",null,candidate);
  if(!members.ok||!Array.isArray(members.data)||members.data.length!==1||
   String(members.data[0].user_id||"").toLowerCase()!==proposedId||
   members.data[0].enabled!==true||members.data[0].purpose!=="P37_9B_TEST_ONLY")
   throw Error("P37 測試白名單未授權，已停止設定密碼。");
  access=candidate;userId=proposedId;expiresAt=Date.now()+Math.min(ttl,600)*1000;
  candidate="";
  if(byId("otp-code"))byId("otp-code").value="";
  lock(true);
  status("verify-result","已通過測試帳號及 P37 白名單驗證，可以設定新密碼。");
  return {ok:true};
 }catch(e){
  await bestEffortLogout(candidate);
  clearSession();
  status("verify-result",e?.message||"驗證失敗。",true);
  return {ok:false};
 }finally{
  busy=false;
  if(byId("otp-code"))byId("otp-code").value="";
  if(byId("verify-otp"))byId("verify-otp").disabled=ready()||attempts>=3||!onPage();
 }
}
async function savePassword(){
 if(busy||!ready()){clearSession();status("change-result","尚未完成安全驗證或驗證已過期。",true);return {ok:false};}
 const password=String(byId("password-new")?.value||"");
 const confirm=String(byId("password-confirm")?.value||"");
 if(password.length<12||password.length>128||confirm!==password){
  status("change-result","請輸入兩次相同的新測試密碼（12 至 128 個字元）。",true);return {ok:false};
 }
 busy=true;if(byId("save-password"))byId("save-password").disabled=true;
 const bearer=access,identity=userId;
 try{
  const updated=await api("/auth/v1/user","PUT",{password},bearer);
  if(!updated.ok||String(updated.data?.id||"").toLowerCase()!==identity)
   throw Error("Auth Lab 未確認密碼更新成功。");
  status("change-result","測試密碼設定成功。請使用新密碼執行 P37-19X 本機雙登入唯讀預檢。");
  return {ok:true};
 }catch(e){status("change-result",e?.message||"設定密碼失敗。",true);return {ok:false};}
 finally{clearSession();await bestEffortLogout(bearer);busy=false;}
}
function init(){
 clearSession();
 if(!onPage()||!KEY.startsWith("sb_publishable_")){
  status("verify-result","不是指定的測試網頁，已停止所有功能。",true);
  if(byId("send-otp"))byId("send-otp").disabled=true;
  if(byId("verify-otp"))byId("verify-otp").disabled=true;
  return;
 }
 const {hash,search,pathname}=window.location;
 if(hash||search){
  try{window.history.replaceState(null,"",pathname);}
  catch(_){
   status("verify-result","無法安全清除回呼網址，已停止所有操作。",true);
   if(byId("send-otp"))byId("send-otp").disabled=true;
   return;
  }
  status("verify-result","本頁不接受郵件連結中的權杖或參數；請直接輸入郵件中的 6 位驗證碼。",true);
 }
 if(byId("otp-code"))byId("otp-code").disabled=true;
 if(byId("verify-otp"))byId("verify-otp").disabled=true;
 byId("send-otp")?.addEventListener("click",sendCode);
 byId("verify-otp")?.addEventListener("click",verifyCode);
 byId("save-password")?.addEventListener("click",savePassword);
}
window.KusheP3719ZOtpRecovery=Object.freeze({sendCode,verifyCode,savePassword,onPage});
init();
})();