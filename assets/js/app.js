(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const config = window.KUSHE_PHASE1_CONFIG || {};
  const ui = { collapsed: false, mobileOpen: false, route: 'dashboard' };
  const moduleIcons = {
    customers: 'contact', projects: 'map-pin', quotations: 'file-text', billings: 'clipboard-list',
    receivables: 'arrow-down-to-line', payables: 'arrow-up-from-line', banks: 'landmark', invoices: 'receipt',
    materials: 'boxes', employees: 'user-round', attendance: 'calendar-check', commissions: 'chart-no-axes-combined', 'unbilled-work': 'clipboard-list',
    payroll: 'wallet', reports: 'bar-chart-3', settings: 'settings'
  };
  function readUi() { try { return JSON.parse(localStorage.getItem(config.uiStorageKey) || '{}'); } catch (_) { return {}; } }
  function saveUi() { try { localStorage.setItem(config.uiStorageKey, JSON.stringify({ collapsed: ui.collapsed })); } catch (_) {} }
  function setShell() {
    document.body.classList.toggle('sidebar-collapsed', ui.collapsed);
    document.body.classList.toggle('mobile-nav-open', ui.mobileOpen);
    $('#mobileMenuButton')?.setAttribute('aria-expanded', String(ui.mobileOpen));
  }
  function toast(message) {
    const node = document.createElement('div'); node.className='toast'; node.textContent=message; $('#toastHost').appendChild(node);
    requestAnimationFrame(()=>node.classList.add('is-visible')); setTimeout(()=>{node.classList.remove('is-visible');setTimeout(()=>node.remove(),220)},2400);
  }
  function closePopovers(except) { $$('.topbar-popover.is-open').forEach((node)=>{if(node!==except)node.classList.remove('is-open')}); }
  function togglePopover(id) { const node=$(`#${id}`); if(!node)return; const open=!node.classList.contains('is-open'); closePopovers(node); node.classList.toggle('is-open',open); }
  function validRoute(module) {
    const route = String(module || '').replace(/^#/, '');
    return route === 'dashboard' || config.moduleLabels?.[route] ? route : 'dashboard';
  }
  function currentHashRoute() { return validRoute(decodeURIComponent(window.location.hash.slice(1))); }
  function renderRoute(module) {
    const route = validRoute(module);
    ui.route = route;
    const isDashboard = route === 'dashboard';
    const isCommissions = route === 'commissions';
    const isUnbilledWork = route === 'unbilled-work';
    const isBillings = route === 'billings';
    const isBillingDraft = route === 'billing-draft';
    const isReceivables = route === 'receivables';
    const isPayables = route === 'payables';
    const isBanks = route === 'banks';
    const isPayroll = route === 'payroll';
    const isProjects = route === 'projects' || route === 'customers';
    const isQuotations = route === 'quotations';
    $('#dashboard').hidden = !isDashboard;
    $('#commissionsView').hidden = !isCommissions;
    $('#unbilledWorkView').hidden = !isUnbilledWork;
    $('#billingsView').hidden = !isBillings;
    $('#billingDraftView').hidden = !isBillingDraft;
    $('#receivablesView').hidden = !isReceivables;
    $('#payablesView').hidden = !isPayables;
    $('#banksView').hidden = !isBanks;
    $('#payrollView').hidden = !isPayroll;
    $('#projectsView').hidden = !isProjects;
    $('#quotationsView').hidden = !isQuotations;
    $('#moduleView').hidden = isDashboard || isCommissions || isUnbilledWork || isBillings || isBillingDraft || isReceivables || isPayables || isBanks || isPayroll || isProjects || isQuotations;
    if (!isBanks) window.KusheBanks?.deactivate();
    if (!isPayroll) window.KushePayroll?.deactivate();
    document.body.dataset.route = route;
    $$('.nav-item[data-module]').forEach((node) => {
      const navRoute = node.dataset.module;
      const active = navRoute === route || (route === 'customers' && navRoute === 'projects') || (route === 'billing-draft' && navRoute === 'billings');
      node.classList.toggle('active', active);
      node.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (!isProjects) window.KusheProjects?.deactivate();
    if (!isQuotations) window.KusheQuotations?.deactivate();
    if (isProjects) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheProjects?.activate({customer:route==='customers'});document.title = '酷舍 ERP｜客戶／案場';
    } else if (isQuotations) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheQuotations?.activate();document.title = '酷舍 ERP－報價單管理';
    } else if (isCommissions) {
      window.KusheCommissions?.activate();
      window.KusheUnbilledWork?.deactivate();
      window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      document.title = '酷舍 ERP｜員工業績／抽成';
    } else if (isUnbilledWork) {
      window.KusheCommissions?.deactivate();
      window.KusheUnbilledWork?.activate();
      window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      document.title = '酷舍 ERP｜待請款施工';
    } else if (isBillings) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      window.KusheBilling?.activate();document.title = '酷舍 ERP｜請款單管理';
    } else if (isBillingDraft) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      window.KusheBilling?.activateDraft();document.title = '酷舍 ERP｜建立請款單';
    } else if (isReceivables) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KushePayables?.deactivate();
      window.KusheReceivables?.activate();document.title = '酷舍 ERP｜應收帳款';
    } else if (isPayables) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();
      window.KushePayables?.activate();document.title = '酷舍 ERP｜應付帳款';
    } else if (isBanks) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      window.KusheBanks?.activate();document.title = '酷舍 ERP｜銀行帳戶';
    } else if (isPayroll) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KushePayroll?.activate();document.title = '酷舍 ERP｜薪資管理';
    } else if (!isDashboard) {
      window.KusheCommissions?.deactivate();
      window.KusheUnbilledWork?.deactivate();
      window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      const label = config.moduleLabels?.[route] || 'ERP 模組';
      $('#moduleTitle').textContent = label;
      $('#moduleBreadcrumb').textContent = label;
      $('#moduleIcon').innerHTML = `<i data-icon="${moduleIcons[route] || 'construction'}"></i>`;
      window.KusheIcons?.render($('#moduleView'));
      document.title = `酷舍 ERP｜${label}`;
    } else {
      window.KusheCommissions?.deactivate();
      window.KusheUnbilledWork?.deactivate();
      window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      document.title = '酷舍 ERP｜首頁總覽';
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }
  function navigate(module, options = {}) {
    const route = validRoute(module);
    if (!options.replace && currentHashRoute() !== route) history.pushState({ route }, '', `#${route}`);
    else if (options.replace) history.replaceState({ route }, '', `#${route}`);
    renderRoute(route);
    ui.mobileOpen = false;
    setShell();
    closePopovers();
    window.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
  }
  function openLegacyModule() {
    const legacy = config.legacyUrl;
    if (!legacy) return toast('尚未設定舊正式版入口');
    const url = new URL(legacy, window.location.href);
    url.hash = ui.route;
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
  function setupNavigation() {
    $('#appShell').addEventListener('click', (event) => {
      const target = event.target.closest('[data-module]');
      if (!target || !$('#appShell').contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(target.dataset.module);
    }, true);
    document.addEventListener('kushe:dashboard-navigate',(event)=>navigate(event.detail?.module));
    $$('[data-route]').forEach((node)=>node.addEventListener('click',()=>navigate(node.dataset.route)));
    $('#openLegacyModule').addEventListener('click', openLegacyModule);
    window.addEventListener('popstate',()=>renderRoute(currentHashRoute()));
  }
  function dateKeys(data) {
    const values=[]; ['billings','receivables','payables','receipts','salaryPayments','bankTransactions','dailyLogs','attendance','materialUsages','invoices'].forEach((key)=>(data[key]||[]).forEach((row)=>{const value=String(row.date||row.month||'').slice(0,7);if(/^\d{4}-\d{2}$/.test(value))values.push(value)}));
    (data.payroll||[]).forEach((row)=>{if(/^\d{4}-\d{2}$/.test(row.month||''))values.push(row.month)}); return values;
  }
  function setupPeriod() {
    const select=$('#dashboardMonth'); const data=window.KuSheLegacyData.getState(); const current=new Date().toISOString().slice(0,7); const keys=dateKeys(data); const latest=[current,...keys].sort().at(-1); const cursor=new Date(`${latest}-01T00:00:00`); const options=[];
    for(let i=0;i<24;i+=1){const d=new Date(cursor.getFullYear(),cursor.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;options.push(`<option value="${key}" ${key===current?'selected':''}>${d.getFullYear()}年${d.getMonth()+1}月</option>`)}
    select.innerHTML=options.join(''); if(!options.some((html)=>html.includes(`value="${current}"`)))select.value=latest;
    select.addEventListener('change',()=>window.KusheDashboard.refresh());
    $('#periodMode').addEventListener('change',(event)=>{const range=event.target.value==='year'?'3':event.target.value==='quarter'?'4':'12';$(`#trendRange [data-range="${range}"]`)?.click()});
  }
  function searchItems() {
    const data=window.KuSheLegacyData.getState(); const labels=config.moduleLabels||{};
    const modules=Object.entries(labels).filter(([key])=>key!=='dashboard'&&key!=='billing-draft').map(([module,label])=>({module,label,sub:'功能模組'}));
    const projects=(data.projects||[]).map((row)=>({module:'projects',label:row.name||'—',sub:'案場'}));
    const customers=(data.customers||[]).map((row)=>({module:'customers',label:row.name||'—',sub:'客戶'}));
    const docs=[]; (data.billings||[]).forEach((row)=>docs.push({module:'billings',label:row.number||row.sourceNo||'—',sub:row.projectName||'請款單'}));
    (data.receivables||[]).forEach((row)=>{if(row.invoiceNo||row.sourceNo)docs.push({module:'receivables',label:row.invoiceNo||row.sourceNo,sub:row.projectName||'應收帳款'})});
    return [...modules,...projects,...customers,...docs].filter((row)=>row.label&&row.label!=='—');
  }
  function setupSearch() {
    const input=$('#globalSearch'),popover=$('#searchPopover');
    function render(){const term=input.value.trim().toLocaleLowerCase('zh-Hant');const rows=searchItems().filter((row)=>!term||`${row.label} ${row.sub}`.toLocaleLowerCase('zh-Hant').includes(term)).slice(0,8);popover.innerHTML=rows.length?rows.map((row)=>`<button class="search-result" type="button" data-search-module="${row.module}"><span><b>${escapeText(row.label)}</b><small>　${escapeText(row.sub)}</small></span><span>→</span></button>`).join(''):'<div class="popover-empty">找不到相符資料</div>';popover.classList.add('is-open');$$('[data-search-module]',popover).forEach((button)=>button.addEventListener('click',()=>navigate(button.dataset.searchModule)))}
    input.addEventListener('focus',render);input.addEventListener('input',render);input.addEventListener('keydown',(event)=>{if(event.key==='Escape'){popover.classList.remove('is-open');input.blur()}if(event.key==='Enter')$('[data-search-module]',popover)?.click()});
    document.addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();input.focus();input.select()}});
  }
  function escapeText(value){return String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function setupHeader() {
    const now=new Date(); const hour=now.getHours(); $('#welcomeTitle').innerHTML=`${hour<11?'早安':hour<18?'午安':'晚安'}！<span>👋</span>`;
    $('#todayLabel').textContent=new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).format(now);
    $('#sidebarToggle').addEventListener('click',()=>{ui.collapsed=!ui.collapsed;saveUi();setShell();hideNavTooltip();setTimeout(()=>window.dispatchEvent(new Event('resize')),220)});
    $('#mobileMenuButton').addEventListener('click',()=>{ui.mobileOpen=!ui.mobileOpen;setShell()});
    $('#mobileNavBackdrop').addEventListener('click',()=>{ui.mobileOpen=false;setShell()});
    $('#notificationButton').addEventListener('click',(event)=>{event.stopPropagation();togglePopover('notificationPopover')});
    $('#userMenuButton').addEventListener('click',(event)=>{event.stopPropagation();togglePopover('userPopover')});
    $('#messageButton').addEventListener('click',()=>toast('目前沒有新訊息'));
    $('#viewAllAttention').addEventListener('click',(event)=>{event.stopPropagation();togglePopover('notificationPopover')});
    $$('[data-backup]').forEach((node)=>node.addEventListener('click',()=>navigate('settings')));
    document.addEventListener('click',(event)=>{if(!event.target.closest('.topbar-action-wrap')&&!event.target.closest('.global-search-wrap'))closePopovers()});
  }
  let navTooltip;
  function hideNavTooltip() { navTooltip?.classList.remove('is-visible'); }
  function setupNavTooltips() {
    navTooltip = document.createElement('div'); navTooltip.className = 'nav-tooltip'; document.body.appendChild(navTooltip);
    $$('.nav-item[data-tooltip]').forEach((node) => {
      node.addEventListener('mouseenter', () => {
        const compact = document.body.classList.contains('sidebar-collapsed') || (window.innerWidth <= 1080 && window.innerWidth > 820);
        if (!compact || window.innerWidth <= 820) return;
        const rect = node.getBoundingClientRect(); navTooltip.textContent = node.dataset.tooltip;
        navTooltip.style.left = `${rect.right + 9}px`; navTooltip.style.top = `${rect.top + rect.height / 2 - 16}px`;
        navTooltip.classList.add('is-visible');
      });
      node.addEventListener('mouseleave', hideNavTooltip);
    });
    window.addEventListener('resize', hideNavTooltip);
  }
  function init() {
    const saved=readUi();ui.collapsed=Boolean(saved.collapsed);setShell();window.KusheIcons?.render(document);
    setupHeader();setupNavigation();setupNavTooltips();setupPeriod();setupSearch();window.KusheDashboard.init();
    navigate(currentHashRoute(), { replace: true, instant: true });
  }
  window.KushePhase1={navigate,toast};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}());
