(function () {
  'use strict';

  const config=window.KUSHE_PHASE1_CONFIG||{};
  const ALLOWED_TOP_LEVEL=new Set(['schema','companyId','employeeId','role','employee','projects','attendance','dailyLogs','materialUsages','cashCollections']);
  let projection=null;
  let activeTab='projects';

  const $=(selector,root=document)=>root.querySelector(selector);
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function host(){return $('#employeeShellView')}
  function auth(){
    const session=window.KusheAuthGate?.session?.();
    const token=String(session?.access_token||'');
    if(!token)throw new Error('AUTH_REQUIRED');
    return token;
  }
  function endpoint(){
    const url=String(config.supabaseUrl||'').trim().replace(/\/+$/,'');
    const key=String(config.supabasePublishableKey||'').trim();
    if(!/^https:\/\//i.test(url)||!key)throw new Error('CONFIG_INVALID');
    return {url,key};
  }
  async function fetchProjection(){
    const {url,key}=endpoint(),token=auth();
    const response=await fetch(url+'/rest/v1/rpc/employee_erp_read_projection',{
      method:'POST',
      headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:'{}'
    });
    let payload=null;
    try{payload=await response.json()}catch(_){}
    if(!response.ok){
      const message=String(payload?.message||payload?.error||'EMPLOYEE_PROJECTION_FAILED');
      const error=new Error(message);error.code=message;error.status=response.status;throw error;
    }
    return payload;
  }
  function validateProjection(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('EMPLOYEE_PROJECTION_INVALID');
    const keys=Object.keys(value);
    if(keys.some((key)=>!ALLOWED_TOP_LEVEL.has(key)))throw new Error('EMPLOYEE_PROJECTION_UNEXPECTED_FIELD');
    if(value.schema!=='kushe-employee-read-projection-v1'||value.role!=='employee'||!String(value.employeeId||''))throw new Error('EMPLOYEE_PROJECTION_INVALID');
    ['projects','attendance','dailyLogs','materialUsages','cashCollections'].forEach((key)=>{if(!Array.isArray(value[key]))throw new Error('EMPLOYEE_PROJECTION_INVALID')});
    return value;
  }
  function projectName(id,fallback=''){
    return projection?.projects?.find((row)=>String(row.id)===String(id))?.name||fallback||'—';
  }
  function renderHeader(){
    const employee=projection?.employee||{},context=window.KusheAuthGate?.companyContext?.()||{};
    return '<header class="employee-shell-head"><div><span class="employee-shell-eyebrow">員工專區・唯讀</span><h1>'+esc(employee.name||'員工')+'</h1><p>'+esc(context.companyName||'酷舍企業有限公司')+'｜目前僅提供工作相關資料查詢</p></div><button id="employeeLogout" type="button">登出</button></header>';
  }
  function renderTabs(){
    const tabs=[['projects','我的案場'],['work','我的施工'],['materials','我的材料']];
    return '<nav class="employee-shell-tabs" aria-label="員工功能">'+tabs.map(([key,label])=>'<button type="button" data-employee-tab="'+key+'" class="'+(activeTab===key?'is-active':'')+'">'+label+'</button>').join('')+'</nav>';
  }
  function renderProjects(){
    const rows=projection.projects||[];
    return '<section class="employee-shell-panel"><div class="employee-shell-section-title"><h2>我的案場</h2><span>'+rows.length+' 個</span></div><div class="employee-card-grid">'+(rows.map((row)=>'<article class="employee-info-card"><span>'+esc(row.status||'進行中')+'</span><h3>'+esc(row.name||'—')+'</h3><p>'+esc(row.address||'尚未填寫地址')+'</p></article>').join('')||'<p class="employee-empty">目前沒有與你相關的案場。</p>')+'</div></section>';
  }
  function itemText(items){
    return (items||[]).map((item)=>[item.item,item.qty,item.unit].filter((v)=>v!==null&&v!==undefined&&v!=='').join(' ')).filter(Boolean).join('、')||'未填施工項目';
  }
  function renderWork(){
    const rows=projection.dailyLogs||[];
    return '<section class="employee-shell-panel"><div class="employee-shell-section-title"><h2>我的施工</h2><span>'+rows.length+' 筆</span></div><div class="employee-record-list">'+(rows.map((row)=>'<article class="employee-record-card"><header><b>'+esc(row.date||'—')+'</b><span>'+esc(projectName(row.projectId,row.projectName))+'</span></header><h3>'+esc(itemText(row.items))+'</h3>'+(row.note?'<p>'+esc(row.note)+'</p>':'')+'</article>').join('')||'<p class="employee-empty">目前沒有你的施工紀錄。</p>')+'</div></section>';
  }
  function renderMaterials(){
    const rows=projection.materialUsages||[];
    return '<section class="employee-shell-panel"><div class="employee-shell-section-title"><h2>我的材料</h2><span>'+rows.length+' 筆</span></div><div class="employee-record-list">'+(rows.map((row)=>'<article class="employee-record-card"><header><b>'+esc(row.date||'—')+'</b><span>'+esc(projectName(row.projectId,row.projectName))+'</span></header><h3>'+esc(row.materialName||'—')+'</h3><dl><div><dt>型號</dt><dd>'+esc(row.model||'—')+'</dd></div><div><dt>數量</dt><dd>'+esc(row.quantity??0)+' '+esc(row.unit||'')+'</dd></div></dl>'+(row.note?'<p>'+esc(row.note)+'</p>':'')+'</article>').join('')||'<p class="employee-empty">目前沒有你的材料紀錄。</p>')+'</div></section>';
  }
  function render(){
    const root=host();if(!root)return;
    root.innerHTML='<div class="employee-shell-wrap">'+renderHeader()+renderTabs()+(activeTab==='projects'?renderProjects():activeTab==='work'?renderWork():renderMaterials())+'</div>';
    $('#employeeLogout',root)?.addEventListener('click',()=>window.dispatchEvent(new Event('kushe:employee-logout')));
    root.querySelectorAll('[data-employee-tab]').forEach((button)=>button.addEventListener('click',()=>{activeTab=button.dataset.employeeTab;render()}));
  }
  function renderBindingRequired(context){
    const root=host();if(!root)return;
    root.innerHTML='<div class="employee-shell-wrap"><header class="employee-shell-head"><div><span class="employee-shell-eyebrow">員工專區・尚未啟用</span><h1>帳號尚未綁定員工</h1><p>'+esc(context?.companyName||'酷舍企業有限公司')+'｜請由公司管理者完成員工身分綁定後再登入。</p></div><button id="employeeLogout" type="button">登出</button></header><section class="employee-shell-panel employee-binding-panel"><div class="employee-binding-icon">!</div><h2>尚未載入任何 ERP 業務資料</h2><p>此帳號已通過公司身分驗證，但目前沒有對應的員工主檔。系統已停止讀取員工工作資料。</p></section></div>';
    $('#employeeLogout',root)?.addEventListener('click',()=>window.dispatchEvent(new Event('kushe:employee-logout')));
  }
  function renderError(context){
    const root=host();if(!root)return;
    root.innerHTML='<div class="employee-shell-wrap"><header class="employee-shell-head"><div><span class="employee-shell-eyebrow">員工專區</span><h1>資料暫時無法載入</h1><p>'+esc(context?.companyName||'酷舍企業有限公司')+'</p></div><button id="employeeLogout" type="button">登出</button></header><section class="employee-shell-panel employee-binding-panel"><h2>安全檢查未通過</h2><p>系統沒有載入任何公司業務資料，請稍後重新登入或聯絡管理者。</p></section></div>';
    $('#employeeLogout',root)?.addEventListener('click',()=>window.dispatchEvent(new Event('kushe:employee-logout')));
  }
  async function start(context){
    clear();
    const root=host();if(root)root.hidden=false;
    try{
      projection=validateProjection(await fetchProjection());
      render();
      return {status:'READY',employeeId:projection.employeeId};
    }catch(error){
      projection=null;
      if(String(error?.code||error?.message||'').includes('EMPLOYEE_BINDING_REQUIRED'))renderBindingRequired(context);
      else renderError(context);
      return {status:'BLOCKED',code:String(error?.code||error?.message||'')};
    }
  }
  function clear(){
    projection=null;activeTab='projects';
    const root=host();if(root){root.innerHTML='';root.hidden=true}
  }
  function snapshot(){
    if(!projection)return null;
    return {schema:projection.schema,employeeId:projection.employeeId,counts:{projects:projection.projects.length,dailyLogs:projection.dailyLogs.length,materialUsages:projection.materialUsages.length}};
  }

  window.KusheEmployeeShell=Object.freeze({start,clear,snapshot});
}());
