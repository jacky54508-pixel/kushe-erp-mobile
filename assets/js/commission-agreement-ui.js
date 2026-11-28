(function () {
  'use strict';
  const store = window.KuSheERPStore;
  const POLICY = 'discounted-pretax-v1';
  const START = '2026-11-28';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number.isFinite(Number(value)) ? '$' + Number(value).toLocaleString('zh-TW') : '待核對';
  const issue = row => typeof row === 'string' ? row : row?.message || row?.code || '來源待核對';
  const today = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date()).map(p => [p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const requestKey = () => 'commission-agreement-' + (window.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2));
  const isProspective = row => row?.commissionPolicy === POLICY || Boolean(row?.commissionAgreementId);
  const scopeCache = new WeakMap();
  let activeModal = null;

  function scopes(data = store.getState()) {
    if (Object.isFrozen(data) && scopeCache.has(data)) return scopeCache.get(data);
    let result;
    try {
      if (typeof store.commissionAgreementScopes !== 'function') throw new Error('新約定抽成元件尚未載入，請重新整理後再核對。');
      result = store.commissionAgreementScopes(data);
      if (!result || !Array.isArray(result.agreements)) throw new Error('新約定抽成來源格式待核對。');
    } catch (error) { result = {agreements:[], issues:[issue(error)]}; }
    if (Object.isFrozen(data)) scopeCache.set(data,result);
    return result;
  }
  async function prepare() {
    if (!window.KusheCloudSync?.prepareBillingAllowanceWrite) throw new Error('雲端資料保護尚未載入，請重新整理後再核對。');
    await window.KusheCloudSync.prepareBillingAllowanceWrite();
  }
  function style() {
    if ($('#commissionAgreementStyle')) return;
    const node = document.createElement('style'); node.id = 'commissionAgreementStyle';
    node.textContent = `.commission-agreement-panel{margin:12px 0;padding:14px;border:1px solid #cddce4;border-radius:10px;background:#f3f8fa;color:#18394b}.commission-agreement-panel>label,.ca-check{display:flex!important;align-items:flex-start;gap:9px;line-height:1.6}.commission-agreement-panel input[type=checkbox],.ca-check input[type=checkbox]{width:18px!important;min-height:18px!important;flex:0 0 18px;margin-top:3px}.commission-agreement-panel p,.ca-note{font-size:13px;line-height:1.7;color:#506d7d;margin:8px 0}.ca-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.ca-fields>label{display:grid;gap:6px;min-width:0}.ca-wide{grid-column:1/-1}.ca-fields input,.ca-fields select,.ca-fields textarea,.ca-allocation input{box-sizing:border-box;width:100%;min-height:42px;border:1px solid #b9cbd5;border-radius:8px;background:#fff;padding:9px;font:inherit;color:inherit}.ca-participant{padding:10px 0;border-top:1px solid #dce7ec}.ca-participant>summary{cursor:pointer;font-size:13px}.ca-participant>p{margin:0 0 6px}.ca-status{display:block;font-size:12px;line-height:1.6;margin-top:5px;color:#426475}.ca-error{padding:12px;background:#fff0eb;color:#913f2b;border-radius:8px;line-height:1.6}.ca-overlay{position:fixed;inset:0;z-index:100001;background:#133047a8;display:flex;align-items:center;justify-content:center;padding:18px}.ca-modal{background:#fff;color:#18394b;border-radius:16px;width:min(1020px,100%);max-height:94vh;overflow:auto;box-shadow:0 20px 80px #0b233b55}.ca-modal>header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:22px;border-bottom:1px solid #dce6ed}.ca-modal>header h2{margin:0 0 7px}.ca-modal>header p{margin:0}.ca-modal>header button{min-width:42px;min-height:42px;border:0;border-radius:8px;font-size:24px;background:#edf3f6;cursor:pointer}.ca-body{padding:22px}.ca-modal h3,.ca-modal h4{margin:0 0 12px}.ca-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.ca-actions button{min-height:42px}.ca-review{margin:16px 0;padding:16px;border-radius:10px;background:#eff6f8}.ca-review.is-blocked{background:#fff0eb}.ca-list{display:grid;gap:14px}.ca-card{padding:16px;border:1px solid #d0dfe7;border-radius:11px}.ca-card>header{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.ca-card p{margin:9px 0;line-height:1.6;overflow-wrap:anywhere}.ca-card dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ca-card dt{font-size:12px;color:#58717f}.ca-card dd{margin:5px 0 0}.ca-allocation-bill{margin:18px 0;padding:16px;border:1px solid #cddde6;border-radius:10px}.ca-allocation{display:grid;grid-template-columns:minmax(180px,2fr) minmax(130px,1fr);gap:12px;align-items:center;margin:12px 0;padding-top:12px;border-top:1px solid #e0e8ed}.ca-allocation b,.ca-allocation small{display:block}.ca-allocation small{font-size:12px;color:#597482;line-height:1.6;margin-top:4px}.ca-scroll{overflow:auto}.ca-modal table{border-collapse:collapse;width:100%;min-width:520px}.ca-modal th,.ca-modal td{text-align:right;padding:9px;border-bottom:1px solid #dce5eb;white-space:nowrap}.ca-modal th:first-child,.ca-modal td:first-child{text-align:left}.ca-modal [hidden],.commission-agreement-panel [hidden]{display:none!important}.ca-modal button:disabled{opacity:.5;cursor:not-allowed}.ca-manual-people{display:grid;gap:8px}.ca-manual-person{display:grid;grid-template-columns:minmax(120px,1fr) 100px;gap:12px;align-items:center;padding:10px;border:1px solid #dce5eb;border-radius:8px}.ca-manager-link{margin:12px 0}.ca-success{padding:12px;border-radius:8px;background:#eaf7ed;color:#2d6640}@media(max-width:640px){.ca-overlay{padding:6px}.ca-modal{max-height:98vh;border-radius:12px}.ca-modal>header,.ca-body{padding:16px}.ca-fields,.ca-allocation{grid-template-columns:1fr}.ca-card dl{grid-template-columns:repeat(2,minmax(0,1fr))}.ca-actions>button{flex:1;min-height:44px}.ca-manual-person{grid-template-columns:minmax(100px,1fr) 88px}}`;
    document.head.append(node);
  }
  function agreementText(agreement) {
    if (!agreement) return '新約定來源待核對';
    if (agreement.status === 'cancelled') return '新約定已取消；原來源保留';
    return agreement.status === 'finalized' ? '新約定 A · 已核定，原抽成固定' : '新約定 A · 暫估，待核定';
  }
  function dailyInfo(log, data = store.getState()) {
    if (!isProspective(log)) return null;
    const read = scopes(data), agreement = read.agreements.find(row => String(row.id) === String(log.commissionAgreementId));
    return {agreement, label:agreementText(agreement), estimatedCommission:log.estimatedCommission, issues:read.issues || []};
  }
  function dailyMarkup(log, data = store.getState()) {
    const view = dailyInfo(log,data);
    if (!view) return '';
    const person=view.agreement?.participants?.find(row=>String(row.employeeId)===String(log.employee||log.employeeId));
    return '<span class="ca-status" data-commission-agreement-status>' + esc(view.label) +
      (view.agreement?.status === 'draft' ? ' · 暫估 ' + money(view.estimatedCommission) : '') +
      (person?.agreedDueDate ? ' · 約定付款日 ' + esc(person.agreedDueDate) : '') + '</span>';
  }
  function batchMarkup(logs, legacyAmount = 0, data = store.getState()) {
    const selected = (logs || []).filter(isProspective);
    if (!selected.length) return money(legacyAmount);
    const read = scopes(data), ids = new Set(selected.map(row => String(row.commissionAgreementId))), agreements = read.agreements.filter(row => ids.has(String(row.id)));
    const estimates = selected.filter(log => agreements.some(row => String(row.id) === String(log.commissionAgreementId) && row.status === 'draft'));
    const estimated = estimates.reduce((sum,log) => sum + Number(log.estimatedCommission || 0),0);
    const finalized = agreements.filter(row => row.status === 'finalized');
    const legacy = (logs || []).some(log => !isProspective(log)) ? '<b>' + money(legacyAmount) + '</b><small>原約定抽成</small>' : '';
    return legacy + (estimates.length ? '<b>' + money(estimated) + '</b><small class="ca-status">新約定暫估，待核定</small>' : '') +
      (finalized.length ? '<small class="ca-status">新約定已核定 ' + finalized.length + ' 組；詳見正式抽成</small>' : '') +
      (agreements.some(row => row.status === 'cancelled') ? '<small class="ca-status">含已取消新約定</small>' : '') +
      (read.issues?.length || agreements.length !== ids.size ? '<small class="ca-status">新約定來源待核對</small>' : '');
  }

  function attachDaily(form, options = {}) {
    style();
    const existing = Array.isArray(options.logs) ? options.logs : [], editing = Boolean(options.batchId);
    const body = $('#dailyLines',form), panels = new WeakMap();
    let disposed = false, nextDraft = null;
    const participants = () => $$('input[name="dailyEmployees"]:checked',form).map(input => {
      const id = String(input.value), person = store.getState().employees.find(row => String(row.id) === id), rate = $$('input[name="dailyCommissionRate"]',form).find(row => String(row.dataset.employeeId) === id);
      return {employeeId:id, name:person?.name || id, rate:String(rate?.value ?? '')};
    }).sort((a,b) => a.employeeId.localeCompare(b.employeeId));
    const raw = panel => Object.fromEntries($$('[data-agreement-field]',panel).map(input => [input.dataset.agreementField,input.value.trim()]));
    const signature = panel => JSON.stringify({projectId:panel.dataset.projectId,date:form.elements.date.value,workOnly:form.elements.entryMode?.value==='workOnly',commissionEnabled:form.elements.commissionEnabled.checked,people:participants(),fields:raw(panel),terms:$$('[data-participant-terms]',panel).map(row => [row.dataset.participantTerms,$('[data-participant-due]',row).value,$('[data-participant-payment]',row).value])});
    function syncPanel(block) {
      let panel = panels.get(block);
      const projectId = String($('.daily-house-project',block)?.value || ''), saved = existing.filter(log => String(log.project) === projectId), log = saved.find(isProspective);
      if (!panel) {
        panel = document.createElement('section'); panel.className = 'commission-agreement-panel'; panel.dataset.dailyCommissionAgreement = '';
        block.insertBefore(panel,$('[data-project-houses]',block)); panels.set(block,panel);
        if (editing) panel.innerHTML = '<b data-agreement-existing></b><p>本筆沿用已保存約定。新議定的其他施工請另建每日作業；不會把既有施工轉為另一份約定。</p>';
        else panel.innerHTML = '<label><input type="checkbox" data-agreement-enabled><span><b>本案場本次為新議定施工，採折讓後未稅抽成</b><small class="ca-status">未勾選時沿用原約定，適用補登既有施工。</small></span></label><div data-agreement-details hidden><p>依議價折讓後未稅基數 × 個人比例；保留款、手續費不扣基數。此處先保存約定與暫估，正式抽成另行核定；付款依下方薪資約定。</p><div class="ca-fields">' +
          [['workScope','本次新議定工作範圍','text'],['reference','約定依據／文件編號','text'],['agreedDate','雙方約定日期','date'],['startDate','適用施工起日','date'],['agreedDueDate','約定付款日','date'],['paymentTerms','付款約定內容','text']].map(([key,label,type]) => '<label><span>' + label + '</span><input type="'+type+'" data-agreement-field="'+key+'" name="newAgreement_'+key+'" '+(type==='date'?'min="'+START+'"':'maxlength="500"')+'></label>').join('') +
          '</div><div data-agreement-people></div><label class="ca-check"><input type="checkbox" data-agreement-confirmed><span>已確認這是本次新議定施工，並核對工作範圍、每位員工比例及各自付款約定。</span></label><p data-agreement-feedback role="status"></p></div>';
        if (!editing) {
          $('[data-agreement-enabled]',panel).addEventListener('change',() => { panel._confirmedSignature=''; $('[data-agreement-confirmed]',panel).checked=false; refresh(); });
          $('[data-agreement-confirmed]',panel).addEventListener('change',() => {
            panel._confirmedSignature = $('[data-agreement-confirmed]',panel).checked ? signature(panel) : '';
            $('[data-agreement-feedback]',panel).textContent = panel._confirmedSignature ? '本次約定已確認；修改範圍、日期、員工或比例後須重新確認。' : '';
          });
        }
      }
      const changedProject = panel.dataset.projectId !== undefined && panel.dataset.projectId !== projectId;
      panel.dataset.projectId = projectId; panel.hidden = !projectId || form.elements.entryMode?.value === 'workOnly' || !form.elements.commissionEnabled.checked;
      if (editing) {
        $('[data-agreement-existing]',panel).textContent = log ? dailyInfo(log)?.label || '新約定來源待核對' : '原約定／既有施工';
        if(log&&!$('[data-agreement-existing-terms]',panel)){
          const agreement=dailyInfo(log)?.agreement,detail=document.createElement('p');detail.dataset.agreementExistingTerms='';
          detail.textContent=agreement?(agreement.workScope+'；約定依據 '+agreement.reference+'。'+agreement.participants.map(person=>(store.getState().employees.find(row=>String(row.id)===String(person.employeeId))?.name||person.employeeId)+' '+person.rate+'%／'+person.agreedDueDate+'／'+person.paymentTerms).join('；')):'新約定來源待核對，暫停修改。';
          panel.append(detail);
        }
        return;
      }
      if (changedProject) { $('[data-agreement-enabled]',panel).checked=false; panel._confirmedSignature=''; $('[data-agreement-confirmed]',panel).checked=false; }
      const enabled = $('[data-agreement-enabled]',panel).checked;
      $('[data-agreement-details]',panel).hidden = !enabled;
      const people = participants(), peopleSignature = JSON.stringify(people), host = $('[data-agreement-people]',panel);
      if (panel._peopleSignature !== peopleSignature) {
        const oldTerms = new Map($$('[data-participant-terms]',panel).map(row => [row.dataset.participantTerms,{due:$('[data-participant-due]',row).value,terms:$('[data-participant-payment]',row).value}]));
        host.innerHTML = '<h4>本次個人比例</h4>' + people.map(person => {
          const old = oldTerms.get(person.employeeId) || {};
          return '<details class="ca-participant" data-participant-terms="'+esc(person.employeeId)+'"><summary>'+esc(person.name)+' · '+esc(person.rate || '待填')+'%（付款約定不同時展開）</summary><p>留空即採用上方共同付款日與付款約定。</p><div class="ca-fields"><label><span>個別約定付款日</span><input type="date" min="'+START+'" data-participant-due value="'+esc(old.due||'')+'"></label><label><span>個別付款約定</span><input data-participant-payment maxlength="500" value="'+esc(old.terms||'')+'"></label></div></details>';
        }).join('');
        panel._peopleSignature=peopleSignature;
      }
      if (panel._confirmedSignature && panel._confirmedSignature !== signature(panel)) {
        panel._confirmedSignature=''; $('[data-agreement-confirmed]',panel).checked=false;
        $('[data-agreement-feedback]',panel).textContent='本次約定內容、員工或比例已變更，請重新核對並確認。';
      }
    }
    function refresh() {
      if (disposed || !form.isConnected) return;
      $$('.daily-project-block',body).forEach(syncPanel);
      if (editing && existing.some(isProspective)) {
        $$('input[name="dailyEmployees"],input[name="dailyCommissionRate"]',form).forEach(input => { input.disabled=true; input.title='新約定的員工與個人比例已保存；另一份約定請新增每日作業。'; });
        if (form.elements.commissionEnabled) form.elements.commissionEnabled.disabled=true;
        form.elements.date.disabled=true;
        $$('input[name="entryMode"],.daily-house-project,.daily-project-remove,.daily-quick-project-open,#addDailyLine',form).forEach(input=>{input.disabled=true;});
      }
    }
    const observer = new MutationObserver(() => refresh());
    observer.observe(body,{childList:true});
    const onChange = () => refresh();
    form.addEventListener('input',onChange); form.addEventListener('change',onChange);
    function read() {
      refresh(); const result = {};
      if(editing){
        const saved=scopes().agreements;
        for(const log of existing.filter(isProspective)){
          if(result[String(log.project)])continue;
          const agreement=saved.find(row=>String(row.id)===String(log.commissionAgreementId));
          if(!agreement)throw new Error('原新約定來源待核對，請保留施工草稿並重新開啟。');
          result[String(log.project)]={policy:POLICY,futureNewAgreementConfirmed:true,workScope:agreement.workScope,reference:agreement.reference,agreedDate:agreement.agreedDate,startDate:agreement.startDate,participantPaymentTerms:Object.fromEntries(agreement.participants.map(person=>[person.employeeId,{agreedDueDate:person.agreedDueDate,paymentTerms:person.paymentTerms}]))};
        }
        return result;
      }
      if(form.elements.entryMode?.value === 'workOnly' || !form.elements.commissionEnabled.checked) return result;
      $$('[data-daily-commission-agreement]',body).forEach(panel => {
        if (!$('[data-agreement-enabled]',panel)?.checked || !panel.dataset.projectId) return;
        const participantPaymentTerms = {};
        $$('[data-participant-terms]',panel).forEach(row => {
          const agreedDueDate=$('[data-participant-due]',row).value,paymentTerms=$('[data-participant-payment]',row).value.trim();
          if (agreedDueDate || paymentTerms) participantPaymentTerms[row.dataset.participantTerms]={...(agreedDueDate?{agreedDueDate}:{}),...(paymentTerms?{paymentTerms}:{})};
        });
        result[panel.dataset.projectId]={policy:POLICY,...raw(panel),futureNewAgreementConfirmed:Boolean($('[data-agreement-confirmed]',panel).checked && panel._confirmedSignature===signature(panel)),...(Object.keys(participantPaymentTerms).length?{participantPaymentTerms}:{})};
      });
      return result;
    }
    function validate() {
      const values=read();
      if(editing)return;
      for (const [projectId,value] of Object.entries(values)) {
        const panel=$$('[data-daily-commission-agreement]',body).find(row=>row.dataset.projectId===projectId);
        const fail=(message,field)=>{const target=field?$('[data-agreement-field="'+field+'"]',panel):$('[data-agreement-confirmed]',panel);target?.setAttribute('aria-invalid','true');target?.focus();throw new Error(message);};
        if (!['workScope','reference','agreedDate','startDate','agreedDueDate','paymentTerms'].every(key=>value[key])) fail('新約定請填完整工作範圍、約定依據、日期及付款約定。',['workScope','reference','agreedDate','startDate','agreedDueDate','paymentTerms'].find(key=>!value[key]));
        if (value.agreedDate<START || value.startDate<START || value.agreedDate>value.startDate || value.startDate>form.elements.date.value) fail('新約定僅適用 2026-11-28 起新議定施工；約定日須不晚於適用起日，施工日須在適用起日之後。','startDate');
        if (!value.futureNewAgreementConfirmed) fail('請重新核對本案場的新約定、每位員工比例及付款約定，並勾選確認。');
      }
    }
    refresh();
    return {
      read,validate,refresh,
      beforeSubmit:async values=>{if(Object.keys(values.commissionAgreementsByProject||{}).length||existing.some(isProspective))await prepare();},
      captureNext(){nextDraft=read();},
      restoreNext(){refresh();for(const [projectId,value] of Object.entries(nextDraft||{})){const panel=$$('[data-daily-commission-agreement]',body).find(row=>row.dataset.projectId===projectId);if(!panel||editing)continue;$('[data-agreement-enabled]',panel).checked=true;$$('[data-agreement-field]',panel).forEach(input=>{input.value=value[input.dataset.agreementField]||''});$$('[data-participant-terms]',panel).forEach(row=>{const terms=value.participantPaymentTerms?.[row.dataset.participantTerms];if(terms){$('[data-participant-due]',row).value=terms.agreedDueDate||'';$('[data-participant-payment]',row).value=terms.paymentTerms||'';}});panel._confirmedSignature='';$('[data-agreement-confirmed]',panel).checked=false;$('[data-agreement-feedback]',panel).textContent='約定內容已留作下一筆草稿，請重新確認本次新施工範圍與人員比例。';}nextDraft=null;refresh();},
      dispose(){disposed=true;observer.disconnect();form.removeEventListener('input',onChange);form.removeEventListener('change',onChange);}
    };
  }

  function modal(title,subtitle,html) {
    style();
    if(activeModal?.close()===false)return null;
    const previous=document.activeElement,overlay=document.createElement('div');overlay.className='ca-overlay';
    overlay.innerHTML='<section class="ca-modal" role="dialog" aria-modal="true" aria-labelledby="commissionAgreementTitle"><header><div><h2 id="commissionAgreementTitle">'+esc(title)+'</h2><p class="ca-note">'+esc(subtitle)+'</p></div><button type="button" data-ca-close aria-label="關閉">×</button></header><div class="ca-body">'+html+'</div></section>';
    document.body.append(overlay);
    const api={element:overlay,busy:false,close(){if(api.busy)return false;overlay.remove();document.removeEventListener('keydown',keydown);window.removeEventListener('kushe:data-updated',dataChanged);if(activeModal===api)activeModal=null;previous?.focus?.();return true;},onDataChange:null};
    const dataChanged=()=>{if(!api.busy)api.onDataChange?.();};
    const keydown=event=>{if(event.key==='Escape'){event.preventDefault();api.close();}if(event.key==='Tab'){const nodes=$$('button,input,select,textarea,[tabindex="0"]',overlay).filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',keydown);window.addEventListener('kushe:data-updated',dataChanged);
    $$('[data-ca-close]',overlay).forEach(button=>button.onclick=()=>api.close());overlay.addEventListener('click',event=>{if(event.target===overlay)api.close();});
    activeModal=api;requestAnimationFrame(()=>$('input,select,textarea,button',overlay)?.focus());return api;
  }
  function committed(api,message) {
    api.busy=false;
    api.close();
    try{window.KusheCommissions?.render();window.KushePayroll?.render();window.KushePhase1?.toast(message+' 雲端同步狀態請見頁面提示。');}
    catch(_){const notice=document.createElement('aside');notice.className='ca-success';notice.setAttribute('role','alert');notice.dataset.caCommittedWarning='';notice.textContent=message+' 畫面更新未完成，請重新整理並核對紀錄，請勿重複送出。雲端同步狀態請見頁面提示。';document.body.prepend(notice);}
  }
  function writeFailure(api,form,error,show) {
    api.busy=false;form.inert=false;
    if(error?.transactionStatus==='RECOVERY_REQUIRED'){
      form.dataset.submitLocked='true';
      $$('input,select,textarea,button',form).forEach(node=>node.disabled=true);
      $$('[data-ca-close]',api.element).forEach(node=>node.disabled=false);
      show(new Error('儲存狀態待核對，請保留輸入並重新整理核對，請勿重複送出或清除資料。'));
      return;
    }
    show(error);
  }
  function finalizedMarkup(agreement) {
    if(agreement.status!=='finalized')return '';
    const data=store.getState();
    return '<section class="ca-review"><h4>已核定抽成基數 '+money(agreement.finalBase)+'</h4><p class="ca-note">此基數供每位員工依個人比例計算，不重複計入員工績效。之後折讓不自動回扣已核定金額。</p><ul>'+(agreement.finalCommissions||[]).map(person=>'<li>'+esc(data.employees.find(row=>String(row.id)===String(person.employeeId))?.name||person.employeeId)+' · '+esc(person.rate)+'% · 正式抽成 '+money(person.commission)+' · 付款日 '+esc(person.agreedDueDate)+' · '+esc(person.paymentTerms||'')+'</li>').join('')+'</ul></section>';
  }
  function contractCard(agreement) {
    const data=store.getState(),project=data.projects.find(row=>String(row.id)===String(agreement.projectId));
    return '<article class="ca-card" data-ca-agreement="'+esc(agreement.id)+'"><header><strong>'+esc(project?.name||agreement.projectName||'案場')+' · '+esc(agreement.workDate||'')+'</strong><span>'+esc(agreementText(agreement))+'</span></header><p>'+esc(agreement.workScope||'工作範圍待核對')+'</p><dl><div><dt>約定依據</dt><dd>'+esc(agreement.reference||'—')+'</dd></div><div><dt>暫估未稅基數</dt><dd>'+money(agreement.estimatedBase??agreement.originalUntaxedAmount)+'</dd></div><div><dt>約定付款日</dt><dd>'+esc(agreement.agreedDueDate||'依各人約定')+'</dd></div></dl><p class="ca-note">'+(agreement.participants||[]).map(person=>esc(data.employees.find(row=>String(row.id)===String(person.employeeId))?.name||person.employeeName||person.employeeId)+' '+esc(person.rate)+'% · '+esc(person.agreedDueDate||agreement.agreedDueDate||'付款日待核對')).join('；')+'</p>'+finalizedMarkup(agreement)+'<div class="ca-actions">'+(agreement.status==='draft'?'<button type="button" class="commission-primary" data-ca-finalize="'+esc(agreement.id)+'">核定正式抽成</button><button type="button" class="commission-secondary" data-ca-cancel="'+esc(agreement.id)+'">取消未請款約定</button>':'')+'</div></article>';
  }
  function open(options={}) {
    const read=scopes(),agreements=read.agreements.filter(row=>!options.projectId||String(row.projectId)===String(options.projectId));
    const api=modal('新約定抽成','原約定與既有抽成保持原有金額；此處管理明確新議定的施工。',(options.success?'<p class="ca-success" role="status">'+esc(options.success)+'</p>':'')+(read.issues?.length?'<div class="ca-error" role="alert">'+read.issues.map(issue).map(esc).join('；')+'</div>':'')+'<div class="ca-actions"><button type="button" class="commission-primary" data-ca-new-manual>建立新約定手動抽成</button></div><p class="ca-note">暫估不會自動列入薪資。核定時逐來源確認議價後未稅基數；付款依各自約定，沒有新增客戶收款門檻。</p><div class="ca-list">'+(agreements.map(contractCard).join('')||'<p>目前沒有符合條件的新約定。每日施工可在各案場勾選「本次為新議定施工」。</p>')+'</div>');
    if(!api)return;
    $('[data-ca-new-manual]',api.element).onclick=()=>openManual(options);
    $$('[data-ca-finalize]',api.element).forEach(button=>button.onclick=()=>openFinalization([button.dataset.caFinalize],options));
    $$('[data-ca-cancel]',api.element).forEach(button=>button.onclick=()=>openCancel(button.dataset.caCancel,options));
    api.onDataChange=()=>{const note=document.createElement('p');note.className='ca-note';note.textContent='資料已更新；開啟核定時會重新核對最新來源。';$('.ca-body',api.element).prepend(note);};
    return api;
  }
  function allocationMarkup(rows,totals,previous=new Map()) {
    const data=store.getState(),agreements=scopes(data).agreements;
    const displayLabel=row=>{
      const agreement=agreements.find(item=>String(item.id)===String(row.agreementId));
      if(agreement)return (data.projects.find(item=>String(item.id)===String(agreement.projectId))?.name||'案場')+' · '+agreement.workDate+' · '+agreement.workScope;
      // Preserve the exact Store key in the payload; use its known source only
      // to give the reviewer meaningful project/date/house descriptions.
      if(String(row.scopeKey).startsWith('daily:')){
        const groupId=String(row.scopeKey).slice(6),logs=(data.dailyLogs||[]).filter(log=>String(log.groupId||log.id)===groupId),first=logs[0];
        if(first){const houses=[...new Set((first.items||[]).map(item=>String(item.house||'未指定戶別')))],people=logs.map(log=>log.employeeName||data.employees.find(person=>String(person.id)===String(log.employee))?.name||'員工');return [first.projectName||'案場',first.date,houses.join('、'),people.join('、')].filter(Boolean).join(' · ');}
      }
      return row.label||'原工作範圍';
    };
    const groups=new Map();rows.forEach(row=>{const key=String(row.billingId||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
    return [...groups.entries()].map(([billingId,entries])=>{
      const total=(totals||[]).find(row=>String(row.billingId)===billingId);
      return '<section class="ca-allocation-bill" data-ca-allocation-bill="'+esc(billingId)+'"><h3>'+esc(billingId?(entries[0].billingNo||'原請款'):'尚未請款的工作範圍')+'</h3>'+(total?'<p class="ca-note">原未稅 '+money(total.originalUntaxed)+'；議價折讓後有效未稅 '+money(total.effectiveUntaxed)+'。下列全部範圍的分攤須合計一致。</p>':'<p class="ca-note">可依雙方另行核定的未稅金額確認抽成，不必等待開票；需填明核定依據，且不得超過原工作範圍金額。</p>')+entries.map(row=>{
        const key=JSON.stringify([row.billingId||'',row.scopeKey]),old=previous.get(key),initial=old?old.untaxedAmount:row.requiredUntaxed!==null&&row.requiredUntaxed!==undefined?String(row.requiredUntaxed):'';
        return '<div class="ca-allocation" data-ca-allocation data-billing-id="'+esc(row.billingId||'')+'" data-scope-key="'+esc(row.scopeKey)+'"><div><b>'+esc(displayLabel(row))+'</b><small>'+(row.selected?'本次要核定的新約定':'其他施工／原約定部分，僅核對分攤')+' · 原未稅 '+money(row.originalUntaxed)+'</small>'+(row.requiredUntaxed!==null&&row.requiredUntaxed!==undefined?'<small>已核定分攤需保留 '+money(row.requiredUntaxed)+'</small>':'')+'</div><label><span>人工核定未稅分攤</span><input type="number" min="0" step="1" data-ca-allocation-amount value="'+esc(initial)+'" '+(Number.isFinite(Number(row.maximumUntaxed))?'max="'+esc(row.maximumUntaxed)+'"':'')+' required></label>'+(row.unbilled?'<label class="ca-wide"><span>此未請款範圍的金額核定依據</span><input data-ca-allocation-reference maxlength="500" value="'+esc(old?.approvalReference||'')+'" required></label>':'')+'</div>';
      }).join('')+'</section>';
    }).join('');
  }
  function finalReview(preview) {
    return '<h3>'+(preview.allowed?'核對完成，請確認正式抽成':'尚不能核定')+'</h3>'+(preview.blockers?.length?'<ul>'+preview.blockers.map(row=>'<li>'+esc(issue(row))+'</li>').join('')+'</ul>':'')+(preview.results||[]).map(result=>{
      const agreement=(preview.agreements||[]).find(row=>String(row.id)===String(result.agreementId)),data=store.getState();
      return '<h4>'+esc(agreement?.workScope||'本次新約定')+' · 核定基數 '+money(result.base)+'</h4><p class="ca-note">窄螢幕可左右滑動，核對每位員工的正式金額與付款日期。</p><div class="ca-scroll"><table><thead><tr><th>員工</th><th>約定比例</th><th>正式抽成</th><th>約定付款日</th></tr></thead><tbody>'+(result.participants||[]).map(person=>'<tr><td>'+esc(data.employees.find(row=>String(row.id)===String(person.employeeId))?.name||person.employeeId)+'</td><td>'+esc(person.rate)+'%</td><td>'+money(person.commission)+'</td><td>'+esc(person.agreedDueDate||'待核對')+'</td></tr>').join('')+'</tbody></table></div>';
    }).join('');
  }
  function openFinalization(agreementIds,options={}) {
    if(typeof store.commissionFinalizationPreview!=='function')throw new Error('抽成核定元件尚未載入，請重新整理。');
    const ids=[...new Set(agreementIds.map(String))],initialInput={agreementIds:ids,date:today(),reference:'',reason:'',allocations:[]},initial=store.commissionFinalizationPreview(initialInput);
    const all=scopes().agreements.filter(row=>row.status==='draft'&&(!options.projectId||String(row.projectId)===String(options.projectId)));
    const api=modal('核定新約定正式抽成','先核對工作範圍與完整未稅分攤，再明確確認正式金額。','<form id="commissionFinalizationForm"><p class="ca-note">請款混有不同施工或原約定時，每個範圍都要人工核定分攤；不自動按比例拆分。正式抽成核定後固定，之後折讓只提出差額待核對。</p><fieldset><legend>本次核定的新約定</legend>'+all.map(row=>'<label class="ca-check"><input type="checkbox" data-ca-select-agreement value="'+esc(row.id)+'" '+(ids.includes(String(row.id))?'checked':'')+'><span>'+esc(row.workDate||'')+' · '+esc(row.workScope||row.id)+'</span></label>').join('')+'</fieldset><div class="ca-fields"><label><span>核定日期</span><input name="date" type="date" value="'+today()+'" required></label><label><span>核定依據／文件編號</span><input name="reference" maxlength="500" required></label><label class="ca-wide"><span>本次核定說明</span><textarea name="reason" rows="2" required></textarea></label></div><div class="ca-actions"><button type="button" class="commission-secondary" data-ca-load-scopes>核對所選工作範圍</button></div><div data-ca-allocation-list>'+allocationMarkup(initial.allocationRows||[],initial.billingTotals||[])+'</div><p class="ca-note">保留款與手續費不扣抽成基數。核定只建立正式抽成來源，銀行付款仍需另行確認。</p><div class="ca-actions"><button type="submit" class="commission-primary" data-ca-preview>核對雲端並預覽正式抽成</button></div><section class="ca-review" data-ca-review hidden></section><label class="ca-check"><input type="checkbox" name="confirmed" disabled><span>已核對全部來源分攤、每位員工金額與付款約定，確認將此金額列為正式抽成。</span></label><div class="ca-actions"><button type="button" class="commission-primary" data-ca-final-post disabled>確認核定正式抽成</button><button type="button" class="commission-secondary" data-ca-close>關閉</button></div><p data-ca-message role="status"></p></form>');
    if(!api)return;
    const form=$('#commissionFinalizationForm',api.element),review=$('[data-ca-review]',form),post=$('[data-ca-final-post]',form),message=$('[data-ca-message]',form),confirm=form.elements.confirmed;
    let preview=null,input=null,revision=0,key='',loadedIds=JSON.stringify(ids.sort());
    const selected=()=>$$('[data-ca-select-agreement]:checked',form).map(node=>node.value).sort();
    const readAllocations=()=>$$('[data-ca-allocation]',form).map(row=>({billingId:row.dataset.billingId,scopeKey:row.dataset.scopeKey,untaxedAmount:$('[data-ca-allocation-amount]',row).value,...($('[data-ca-allocation-reference]',row)?{approvalReference:$('[data-ca-allocation-reference]',row).value.trim()}:{} )}));
    const read=()=>({agreementIds:selected(),date:form.elements.date.value,reference:form.elements.reference.value.trim(),reason:form.elements.reason.value.trim(),allocations:readAllocations()});
    const invalidate=()=>{revision++;preview=null;input=null;key='';confirm.checked=false;confirm.disabled=true;post.disabled=true;review.hidden=true;};
    const feedback=error=>{review.innerHTML='<p role="alert">'+esc(issue(error))+'</p>';review.hidden=false;review.classList.add('is-blocked');message.textContent='尚未核定；輸入仍保留，請核對後再送出。';};
    api.onDataChange=()=>{invalidate();message.textContent='來源已更新，請重新核對工作範圍與正式金額；輸入仍保留。';};
    form.addEventListener('input',event=>{if(event.target===confirm){post.disabled=!preview?.allowed||!confirm.checked;return;}invalidate();});
    form.addEventListener('change',event=>{if(event.target===confirm){post.disabled=!preview?.allowed||!confirm.checked;return;}invalidate();if(event.target.matches('[data-ca-select-agreement]'))message.textContent='已變更選取約定，請先按「核對所選工作範圍」。';});
    $('[data-ca-load-scopes]',form).onclick=()=>{
      if(api.busy)return;invalidate();
      try{const old=new Map(readAllocations().map(row=>[JSON.stringify([row.billingId||'',row.scopeKey]),row])),result=store.commissionFinalizationPreview(read());$('[data-ca-allocation-list]',form).innerHTML=allocationMarkup(result.allocationRows||[],result.billingTotals||[],old);loadedIds=JSON.stringify(selected());message.textContent='工作範圍已更新。請逐項填寫核定分攤，再預覽正式抽成。';if(result.blockers?.length){review.innerHTML=finalReview(result);review.hidden=false;review.classList.add('is-blocked');}}catch(error){feedback(error);}
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(api.busy||form.dataset.submitLocked==='true'||!form.reportValidity())return;
      if(loadedIds!==JSON.stringify(selected()))return feedback(new Error('請先核對所選工作範圍，再確認全部人工分攤。'));
      invalidate();const before=revision;api.busy=true;$('[data-ca-preview]',form).disabled=true;message.textContent='正在核對來源與正式抽成…';
      try{const next=read();await prepare();const result=store.commissionFinalizationPreview(next);if(before!==revision){message.textContent='內容已變動，請重新核對。';return;}preview=result;input=next;key=requestKey();review.innerHTML=finalReview(result);review.hidden=false;review.classList.toggle('is-blocked',!result.allowed);confirm.disabled=!result.allowed;message.textContent=result.allowed?'預覽完成，請確認正式金額後核定。':'尚未核定，請依上方原因處理。';review.scrollIntoView({block:'nearest'});}catch(error){feedback(error);}finally{api.busy=false;$('[data-ca-preview]',form).disabled=false;}
    };
    post.onclick=async()=>{
      if(api.busy||form.dataset.submitLocked==='true'||!preview?.allowed||!confirm.checked||!input)return;
      api.busy=true;form.inert=true;message.textContent='正在核定正式抽成…';
      try{await prepare();const fresh=store.commissionFinalizationPreview(input);if(!fresh.allowed)throw new Error((fresh.blockers||[]).map(issue).join('；'));if(fresh.snapshot!==preview.snapshot)throw new Error('來源或抽成約定已變更，請重新核對。');await store.finalizeCommissionAgreements({...input,expectedSnapshot:preview.snapshot,idempotencyKey:key,confirmed:true,finalAmountsApproved:true});}
      catch(error){if(error?.transactionStatus!=='COMMITTED_WITH_NOTIFICATION_WARNING'){invalidate();writeFailure(api,form,error,feedback);return;}}
      committed(api,'正式抽成已核定；付款依各自約定。');
    };
    if(!(initial.allocationRows||[]).length&&(initial.blockers||[]).length){review.innerHTML=finalReview(initial);review.hidden=false;review.classList.add('is-blocked');}
    return api;
  }

  function openManual(options={}) {
    const data=store.getState(),people=store.masterOptions?store.masterOptions('employees'):data.employees;
    const api=modal('建立新約定手動抽成','適用沒有重複每日施工來源的明確新工作範圍。','<form id="commissionAgreementManualForm"><div class="ca-fields"><label><span>案場</span><select name="projectId" required><option value="">請選案場</option>'+data.projects.map(row=>'<option value="'+esc(row.id)+'" '+(String(row.id)===String(options.projectId||'')?'selected':'')+'>'+esc(row.name)+'</option>').join('')+'</select></label><label><span>施工日期</span><input name="workDate" type="date" min="'+START+'" value="'+today()+'" required></label><label class="ca-wide"><span>明確新議定工作範圍</span><input name="workScope" maxlength="500" required></label><label><span>原工作範圍未稅金額</span><input name="originalUntaxedAmount" type="number" min="0" step="1" required></label><label><span>約定依據／文件編號</span><input name="reference" maxlength="500" required></label><label><span>雙方約定日期</span><input name="agreedDate" type="date" min="'+START+'" required></label><label><span>適用施工起日</span><input name="startDate" type="date" min="'+START+'" required></label><label><span>共同約定付款日</span><input name="agreedDueDate" type="date" min="'+START+'" required></label><label><span>付款約定內容</span><input name="paymentTerms" maxlength="500" required></label></div><fieldset><legend>可核對的請款來源（未請款可留空）</legend><div data-ca-manual-bills></div><p class="ca-note">請款含每日施工或來源不明時，會停止手動核定，請改由原施工約定核對。尚未請款可依獨立批准的未稅金額核定，不必等待開票。</p></fieldset><h3>約定員工與各自比例</h3><p class="ca-note">比例合計維持 50%；個別付款日期或約定不同時可另填。</p><div class="ca-manual-people">'+people.map(person=>'<section class="ca-manual-person" data-ca-manual-person="'+esc(person.id)+'"><label class="ca-check"><input type="checkbox" data-ca-person-selected><span>'+esc(person.name)+'</span></label><label><span>個人比例 %</span><input type="number" min="0" max="50" step="0.01" data-ca-person-rate value="0"></label><details class="ca-wide"><summary>個別付款約定（選填）</summary><div class="ca-fields"><label><span>個別付款日</span><input type="date" min="'+START+'" data-ca-person-due></label><label><span>個別付款約定</span><input data-ca-person-terms maxlength="500"></label></div></details></section>').join('')+'</div><p data-ca-manual-pool role="status">已分配 0% / 50%</p><label class="ca-check"><input type="checkbox" name="futureNewAgreementConfirmed" required><span>確認這是新議定施工，原範圍未曾由每日施工或其他抽成來源重複登錄，並已核對員工比例及付款約定。</span></label><div class="ca-actions"><button type="submit" class="commission-primary" data-ca-manual-review>核對新約定</button></div><section class="ca-review" data-ca-manual-summary hidden></section><div class="ca-actions"><button type="button" class="commission-primary" data-ca-manual-create disabled>確認保存新約定</button><button type="button" class="commission-secondary" data-ca-close>關閉</button></div><p data-ca-message role="status"></p></form>');
    if(!api)return;
    const form=$('#commissionAgreementManualForm',api.element),summary=$('[data-ca-manual-summary]',form),button=$('[data-ca-manual-create]',form),message=$('[data-ca-message]',form);let checked=null,signature='';
    const billChoices=()=>{$('[data-ca-manual-bills]',form).innerHTML=data.billings.filter(row=>String(row.project)===form.elements.projectId.value).map(row=>'<label class="ca-check"><input type="checkbox" data-ca-manual-bill value="'+esc(row.id)+'"><span>'+esc(row.number||row.id)+' · 原未稅 '+money(row.preTaxAmount??row.amount)+'</span></label>').join('')||'<p class="ca-note">此案場尚無請款來源，可依未請款工作範圍核定。</p>';};billChoices();
    const read=()=>{const value=Object.fromEntries(new FormData(form)),participantPaymentTerms={},participants=$$('[data-ca-manual-person]',form).filter(row=>$('[data-ca-person-selected]',row).checked).map(row=>{const employeeId=row.dataset.caManualPerson,agreedDueDate=$('[data-ca-person-due]',row).value,paymentTerms=$('[data-ca-person-terms]',row).value.trim();if(agreedDueDate||paymentTerms)participantPaymentTerms[employeeId]={...(agreedDueDate?{agreedDueDate}:{}),...(paymentTerms?{paymentTerms}:{})};return {employeeId,rate:$('[data-ca-person-rate]',row).value};});return {kind:'manual',policy:POLICY,projectId:value.projectId,workDate:value.workDate,workScope:value.workScope.trim(),originalUntaxedAmount:value.originalUntaxedAmount,reference:value.reference.trim(),agreedDate:value.agreedDate,startDate:value.startDate,agreedDueDate:value.agreedDueDate,paymentTerms:value.paymentTerms.trim(),futureNewAgreementConfirmed:form.elements.futureNewAgreementConfirmed.checked,participants,participantPaymentTerms,billingIds:$$('[data-ca-manual-bill]:checked',form).map(row=>row.value)};};
    const invalidate=()=>{checked=null;signature='';button.disabled=true;summary.hidden=true;const total=read().participants.reduce((sum,row)=>sum+Number(row.rate||0),0);$('[data-ca-manual-pool]',form).textContent='已分配 '+total+'% / 50%';};
    form.addEventListener('input',event=>{if(event.target!==form.elements.futureNewAgreementConfirmed)form.elements.futureNewAgreementConfirmed.checked=false;invalidate();});form.addEventListener('change',event=>{if(event.target===form.elements.projectId)billChoices();if(event.target!==form.elements.futureNewAgreementConfirmed)form.elements.futureNewAgreementConfirmed.checked=false;invalidate();});api.onDataChange=()=>{invalidate();message.textContent='來源已更新，請重新核對新約定。';};
    form.onsubmit=event=>{event.preventDefault();if(api.busy||form.dataset.submitLocked==='true'||!form.reportValidity())return;const value=read(),total=value.participants.reduce((sum,row)=>sum+Math.round(Number(row.rate)*100),0);if(!value.participants.length||total!==5000){message.textContent='請選取員工，並將個人比例合計分配為 50%。';return;}checked=value;signature=JSON.stringify(value);summary.innerHTML='<h3>請核對這份新約定</h3><p>'+esc(value.workScope)+' · 原未稅 '+money(value.originalUntaxedAmount)+'</p><p>雙方約定 '+esc(value.agreedDate)+'；適用起日 '+esc(value.startDate)+'；施工 '+esc(value.workDate)+'</p><p>'+value.participants.map(row=>esc(people.find(person=>String(person.id)===row.employeeId)?.name||row.employeeId)+' '+esc(row.rate)+'%').join('；')+'</p><p>保存後請從「新約定抽成核定」開啟此約定，核對人工分攤與正式金額；此步不建立銀行付款。</p>';summary.hidden=false;button.disabled=false;message.textContent='';};
    button.onclick=async()=>{if(api.busy||form.dataset.submitLocked==='true'||!checked||signature!==JSON.stringify(read()))return;api.busy=true;form.inert=true;message.textContent='正在保存新約定…';let record;try{await prepare();record=await store.createCommissionAgreement({...checked,confirmed:true,idempotencyKey:requestKey()});}catch(error){if(error?.transactionStatus!=='COMMITTED_WITH_NOTIFICATION_WARNING'){invalidate();writeFailure(api,form,error,value=>{message.textContent='尚未完成確認：'+issue(value);});return;}}committed(api,'新約定已保存；請從「新約定抽成核定」開啟此約定，再核定正式金額。');};
    return api;
  }
  function openCancel(id,options={}) {
    const agreement=scopes().agreements.find(row=>String(row.id)===String(id));if(!agreement)throw new Error('原約定不存在，請重新開啟核對。');
    const api=modal('取消尚未請款的新約定',agreement.workScope||'原施工來源與取消歷程仍保留。','<form id="commissionAgreementCancelForm"><p class="ca-note">僅能取消尚未核定、完全未請款的新約定；不會把來源改為舊約定，也不會刪除施工紀錄。</p><div class="ca-fields"><label><span>取消日期</span><input name="date" type="date" value="'+today()+'" required></label><label><span>取消依據</span><input name="reference" maxlength="500" required></label><label class="ca-wide"><span>取消原因</span><textarea name="reason" rows="2" required></textarea></label></div><label class="ca-check"><input name="confirmed" type="checkbox" required><span>已確認取消此未請款約定，原施工與約定紀錄保留。</span></label><div class="ca-actions"><button class="commission-primary" type="submit">確認取消約定</button><button class="commission-secondary" type="button" data-ca-close>返回</button></div><p data-ca-message role="status"></p></form>');
    if(!api)return;const form=$('#commissionAgreementCancelForm',api.element),message=$('[data-ca-message]',form),key=requestKey();
    form.onsubmit=async event=>{event.preventDefault();if(api.busy||form.dataset.submitLocked==='true'||!form.reportValidity())return;const value=Object.fromEntries(new FormData(form));api.busy=true;form.inert=true;try{await prepare();await store.cancelCommissionAgreement(id,{date:value.date,reference:value.reference.trim(),reason:value.reason.trim(),expectedSnapshot:agreement.snapshot,idempotencyKey:key,confirmed:true});}catch(error){if(error?.transactionStatus!=='COMMITTED_WITH_NOTIFICATION_WARNING'){writeFailure(api,form,error,value=>{message.textContent='尚未完成取消確認：'+issue(value);});return;}}committed(api,'新約定已取消，原施工與約定紀錄保留。');};return api;
  }
  style();
  window.KusheCommissionAgreements=Object.freeze({POLICY,isProspective,scopes,attachDaily,dailyInfo,dailyMarkup,batchMarkup,open,openManual,openFinalization});
}());
