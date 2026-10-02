(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const config = window.KUSHE_PHASE1_CONFIG || {};
  const businessMonthFormatter = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit' });
  const businessMonth = (date = new Date()) => {
    const parts = Object.fromEntries(businessMonthFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}`;
  };
  const ui = { collapsed: false, mobileOpen: false, route: 'dashboard' };
  let initialized = false;
  let authUiBound = false;
  let authUiGeneration = 0;
  let logoutPending = false;
  let mfaFlow = { mode:'', factorId:'', challengeId:'', enrollment:null, busy:false, state:'cancelled', epoch:0, userId:'', qrReady:false, cancelQr:null };
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
  function setAuthView(authenticated) {
    const loginView = $('#loginView'), mfaView=$('#mfaView'), appShell = $('#appShell'), employeeShell = $('#employeeShellView');
    if (loginView) loginView.hidden = Boolean(authenticated);
    if (mfaView) mfaView.hidden = true;
    if (appShell) appShell.hidden = !authenticated;
    if (employeeShell && authenticated) employeeShell.hidden = true;
  }
  function setMfaView(active) {
    const loginView=$('#loginView'),mfaView=$('#mfaView'),appShell=$('#appShell'),employeeShell=$('#employeeShellView');
    if(loginView)loginView.hidden=Boolean(active);
    if(mfaView)mfaView.hidden=!active;
    if(appShell)appShell.hidden=true;
    if(employeeShell)employeeShell.hidden=true;
  }
  function setEmployeeShellView(active) {
    const loginView=$('#loginView'),mfaView=$('#mfaView'),appShell=$('#appShell'),employeeShell=$('#employeeShellView');
    if(loginView)loginView.hidden=Boolean(active);
    if(mfaView)mfaView.hidden=true;
    if(appShell)appShell.hidden=true;
    if(employeeShell)employeeShell.hidden=!active;
  }
  function setLoginMessage(message = '', error = false) {
    const status = $('#loginStatus'), alert = $('#loginError');
    if (status) { status.textContent = error ? '' : message; status.hidden = error || !message; }
    if (alert) { alert.textContent = error ? message : ''; alert.hidden = !error || !message; }
  }
  function setLoginBusy(busy, message = '') {
    const form = $('#loginForm'), submit = $('#loginSubmit');
    $$('input,button', form || document.createElement('div')).forEach((node) => { node.disabled = Boolean(busy); });
    if (submit) submit.textContent = busy ? '登入中…' : '登入';
    if (form) form.setAttribute('aria-busy', String(Boolean(busy)));
    if (message) setLoginMessage(message);
  }
  function setMfaMessage(message='',error=false){
    const status=$('#mfaStatus'),alert=$('#mfaError');
    if(status){status.textContent=error?'':message;status.hidden=error||!message}
    if(alert){alert.textContent=error?message:'';alert.hidden=!error||!message}
  }
  function authUiCurrent(epoch) { return epoch === authUiGeneration && !logoutPending; }
  function mfaCurrent(flow) {
    return flow === mfaFlow && authUiCurrent(flow.epoch) && flow.state !== 'cancelled'
      && Boolean(flow.userId) && window.KusheAuthGate?.user?.()?.id === flow.userId;
  }
  function mfaDigits(){return $$('.mfa-digit')}
  function mfaCode(){return mfaDigits().map((node)=>String(node.value||'').replace(/\D/g,'')).join('').slice(0,6)}
  function clearMfaDigits(){mfaDigits().forEach((node)=>{node.value=''})}
  function focusMfaDigit(index=0){mfaDigits()[Math.max(0,Math.min(5,index))]?.focus()}
  function mfaReady() {
    return mfaCurrent(mfaFlow) && mfaFlow.state === 'ready' && Boolean(mfaFlow.factorId && mfaFlow.challengeId)
      && (mfaFlow.mode === 'challenge' || (mfaFlow.mode === 'enroll' && mfaFlow.qrReady));
  }
  function renderMfaState() {
    const form=$('#mfaForm'),submit=$('#mfaSubmit'),ready=mfaReady();
    mfaFlow.busy=['loading','verifying'].includes(mfaFlow.state);
    mfaDigits().forEach(node=>{node.disabled=!ready});
    if(submit){
      submit.disabled=!ready||!/^[0-9]{6}$/.test(mfaCode());
      submit.textContent=mfaFlow.state==='loading'?'準備驗證中…':mfaFlow.state==='verifying'?'驗證中…':mfaFlow.state==='error'?'驗證尚未就緒':'驗證並進入 ERP';
    }
    if(form){form.setAttribute('aria-busy',String(mfaFlow.busy));form.dataset.mfaState=mfaFlow.state}
    // Cancellation is independent of enrollment/verification readiness.
    if($('#mfaLogout'))$('#mfaLogout').disabled=logoutPending;
    const resetButton=$('#mfaResetSubmit'),resetAccepted=$('#mfaResetAccepted');
    const canReset=mfaCurrent(mfaFlow)&&mfaFlow.state==='error'&&Boolean(mfaFlow.pendingResetFactor);
    if(resetAccepted)resetAccepted.disabled=!canReset;
    if(resetButton)resetButton.disabled=!canReset||!resetAccepted?.checked;
  }
  function setMfaState(state,message='',error=false) {
    mfaFlow.state=state;
    renderMfaState();
    setMfaMessage(message,error);
  }
  function clearMfaSecrets() {
    const image=$('#mfaQr');
    if(image){image.removeAttribute('src');image.hidden=true}
    if($('#mfaSecret'))$('#mfaSecret').textContent='';
    if($('#mfaSecretDetails'))$('#mfaSecretDetails').open=false;
    mfaFlow.enrollment=null;
    mfaFlow.qrReady=false;
  }
  function resetMfaUi(){
    const previous=mfaFlow;
    mfaFlow={mode:'',factorId:'',challengeId:'',enrollment:null,busy:false,state:'cancelled',epoch:authUiGeneration,userId:'',qrReady:false,cancelQr:null};
    previous.cancelQr?.();
    if($('#mfaResetPanel'))$('#mfaResetPanel').hidden=true;
    if($('#mfaResetAccepted'))$('#mfaResetAccepted').checked=false;
    if($('#mfaResetTarget'))$('#mfaResetTarget').textContent='';
    $('#mfaForm')?.reset();clearMfaDigits();clearMfaSecrets();setMfaState('cancelled');
    if($('#mfaEnroll'))$('#mfaEnroll').hidden=true;
    if($('#mfaChallenge'))$('#mfaChallenge').hidden=true;
    if($('#mfaSubtitle'))$('#mfaSubtitle').textContent='為保護公司資料，請完成第二步驗證';
  }
  function loadMfaQr(flow,src) {
    return new Promise((resolve,reject)=>{
      const image=$('#mfaQr');
      if(!image){reject(Object.assign(new Error('MFA QR unavailable'),{code:'invalid_mfa_qr'}));return}
      let settled=false,timer=0;
      const finish=(error)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        image.removeEventListener('load',onLoad);image.removeEventListener('error',onError);
        flow.cancelQr=null;
        if(error)reject(error);else resolve();
      };
      const onLoad=()=>{
        if(!mfaCurrent(flow)){finish(Object.assign(new Error('Stale MFA UI'),{kind:'stale'}));return}
        if(image.getAttribute('src')===src&&image.complete&&image.naturalWidth>0)finish();
      };
      const onError=()=>finish(Object.assign(new Error('MFA QR load failed'),{code:'invalid_mfa_qr'}));
      flow.cancelQr=()=>finish(Object.assign(new Error('Stale MFA UI'),{kind:'stale'}));
      image.addEventListener('load',onLoad);image.addEventListener('error',onError);
      timer=setTimeout(()=>finish(Object.assign(new Error('MFA QR timeout'),{kind:'aborted',code:'mfa_qr_timeout'})),8000);
      image.hidden=true;image.src=src;
      onLoad();
    });
  }
  function failMfa(flow,error) {
    if(!mfaCurrent(flow))return;
    clearMfaSecrets();
    if($('#mfaEnroll'))$('#mfaEnroll').hidden=true;
    if($('#mfaChallenge'))$('#mfaChallenge').hidden=true;
    if($('#mfaSubtitle'))$('#mfaSubtitle').textContent='安全驗證尚未完成';
    const message=error?.code==='mfa_existing_unverified'
      ?'偵測到尚未完成的驗證器綁定，已停止重複設定。舊綁定尚未刪除，請先安全登出，待確認後再重新設定。'
      :error?.code==='invalid_mfa_qr'||error?.code==='mfa_qr_timeout'
      ?'QR Code 未能正常載入，尚未開放驗證。請安全登出後再處理，勿重複建立綁定。'
      :error?.kind==='aborted'
      ?'驗證服務回應逾時。ERP 尚未載入，請安全登出後再試。'
      :'驗證服務暫時無法使用。ERP 尚未載入，請安全登出後再試。';
    setMfaState('error',message,true);
    if(error?.code==='mfa_existing_unverified'&&flow.pendingResetFactor){
      if($('#mfaResetPanel'))$('#mfaResetPanel').hidden=false;
      if($('#mfaResetTarget'))$('#mfaResetTarget').textContent=(window.KusheAuthGate.user()?.email||'目前登入帳號')+'｜綁定編號末八碼 '+flow.pendingResetFactor.id.slice(-8);
      setMfaMessage('偵測到未完成綁定，舊綁定尚未刪除。確認下方內容後，才可撤銷並產生新的 QR Code。',true);
    }
  }
  async function confirmMfaReset(){
    const flow=mfaFlow,target=flow.pendingResetFactor;
    if(!mfaCurrent(flow)||flow.state!=='error'||!target||!$('#mfaResetAccepted')?.checked)return;
    const confirmation={accepted:true,userId:flow.userId,factorId:target.id,createdAt:target.createdAt};
    setMfaState('loading','正在核對並撤銷你確認的未完成綁定…');
    try{
      await window.KusheAuthGate.removeUnverifiedTotp(target.id,confirmation);
      if(!mfaCurrent(flow))return;
      await prepareMfaGate(flow.epoch);
    }catch(error){
      if(!mfaCurrent(flow))return;
      flow.pendingResetFactor=null;
      if($('#mfaResetPanel'))$('#mfaResetPanel').hidden=true;
      failMfa(flow,error);
      setMfaMessage('無法確認重新設定的結果，已停止重送。請安全登出再登入，讓系統重新核對綁定；勿使用舊金鑰。',true);
    }
  }
  async function prepareMfaGate(epoch=authUiGeneration){
    if(!authUiCurrent(epoch))return false;
    resetMfaUi();
    const flow=mfaFlow;
    flow.epoch=epoch;flow.userId=window.KusheAuthGate?.user?.()?.id||'';
    setMfaView(true);setMfaState('loading','正在確認雙重驗證狀態…');
    try{
      const status=await window.KusheAuthGate.mfaStatus();
      if(!mfaCurrent(flow))return false;
      if(status.userId!==flow.userId)throw new Error('MFA principal mismatch');
      if(status.aal==='aal2'){setMfaState('complete');return true}
      const factor=status.verifiedTotp[0];
      if(factor){
        const challenge=await window.KusheAuthGate.createMfaChallenge(factor.id);
        if(!mfaCurrent(flow))return false;
        Object.assign(flow,{mode:'challenge',factorId:factor.id,challengeId:challenge.challengeId});
        if($('#mfaChallenge'))$('#mfaChallenge').hidden=false;
        if($('#mfaSubtitle'))$('#mfaSubtitle').textContent='請完成驗證器第二因素';
        setMfaState('ready','請輸入驗證器目前顯示的 6 位數字。');
        focusMfaDigit();return false;
      }
      const incomplete=status.factors.filter(row=>row.factorType==='totp'&&row.status==='unverified');
      if(incomplete.length){
        if(incomplete.length===1&&!status.factors.some(row=>row.status==='verified')&&incomplete[0].createdAt)flow.pendingResetFactor={...incomplete[0]};
        throw Object.assign(new Error('Existing unverified MFA factor'),{code:'mfa_existing_unverified'});
      }
      setMfaState('loading','正在準備首次綁定 QR Code…');
      const enrollment=await window.KusheAuthGate.enrollTotp();
      if(!mfaCurrent(flow))return false;
      const challenge=await window.KusheAuthGate.createMfaChallenge(enrollment.factorId);
      if(!mfaCurrent(flow))return false;
      Object.assign(flow,{mode:'enroll',factorId:enrollment.factorId,challengeId:challenge.challengeId,enrollment});
      await loadMfaQr(flow,enrollment.qrCode);
      if(!mfaCurrent(flow))return false;
      flow.qrReady=true;
      if($('#mfaQr'))$('#mfaQr').hidden=false;
      if($('#mfaSecret'))$('#mfaSecret').textContent=enrollment.secret;
      if($('#mfaEnroll'))$('#mfaEnroll').hidden=false;
      if($('#mfaSubtitle'))$('#mfaSubtitle').textContent='首次登入必須先綁定驗證器';
      setMfaState('ready','QR Code 已準備完成。請先用驗證器掃描，再輸入 6 位數字。');
      focusMfaDigit();return false;
    }catch(error){failMfa(flow,error);return false}
  }
  async function completeMfa(event){
    event.preventDefault();
    if(!mfaReady())return;
    const flow=mfaFlow,epoch=flow.epoch,code=mfaCode();
    if(!/^[0-9]{6}$/.test(code)){setMfaMessage('請完整輸入驗證器 App 顯示的 6 位數字。',true);focusMfaDigit(code.length);return}
    setMfaState('verifying','正在驗證第二因素…');
    try{
      await window.KusheAuthGate.verifyMfa(flow.factorId,flow.challengeId,code);
      if(!mfaCurrent(flow))return;
      const strong=await window.KusheAuthGate.requireMfa();
      if(!mfaCurrent(flow))return;
      if(!strong)throw new Error('MFA assurance not elevated');
      resetMfaUi();
      await startAuthenticatedApp({skipMfa:true,authEpoch:epoch});
    }catch(error){
      if(!mfaCurrent(flow))return;
      clearMfaDigits();
      // Only known incorrect/expired-code responses may reopen the same factor.
      if(!['mfa_verification_failed','mfa_challenge_expired'].includes(error?.code)){failMfa(flow,error);return}
      flow.challengeId='';
      setMfaState('loading','正在更新驗證請求…');
      try{
        const challenge=await window.KusheAuthGate.createMfaChallenge(flow.factorId);
        if(!mfaCurrent(flow))return;
        flow.challengeId=challenge.challengeId;
        setMfaState('ready','驗證碼不正確或已過期，請輸入驗證器目前顯示的 6 位數字。',true);
        focusMfaDigit();
      }catch(challengeError){failMfa(flow,challengeError)}
    }
  }

  async function startAuthenticatedApp(options={}) {
    const epoch=options.authEpoch??authUiGeneration,userId=window.KusheAuthGate?.user?.()?.id;
    const current=()=>authUiCurrent(epoch)&&Boolean(userId)&&window.KusheAuthGate?.user?.()?.id===userId;
    if(!current())return false;
    setAuthView(false);
    const strong=await window.KusheAuthGate?.requireMfa?.().catch?.(()=>false);
    if(!current())return false;
    if(!strong){
      if(options.skipMfa)return false;
      const ready=await prepareMfaGate(epoch);
      if(!current()||!ready)return false;
    }
    setLoginMessage('正在確認公司身分與權限…');
    try {
      if (!window.KusheAuthGate?.resolveCompanyContext) throw new Error('Company context unavailable');
      const companyContext = await window.KusheAuthGate.resolveCompanyContext();
      if(!current())return false;
      const isLegacySource=Boolean(companyContext?.legacySourceUserId)&&companyContext.userId===companyContext.legacySourceUserId;
      if(companyContext?.role==='employee'&&!isLegacySource){
        window.KusheCloudSync?.stopAutoBackup?.();
        window.KusheCloudSync?.close?.();
        window.KuSheERPStore?.clearEphemeralSession?.();
        setLoginMessage();
        setEmployeeShellView(true);
        if(!window.KusheEmployeeShell?.start)throw new Error('Employee shell unavailable');
        await window.KusheEmployeeShell.start(companyContext);
        return current();
      }
      if (!isLegacySource) {
        window.KusheCloudSync?.stopAutoBackup?.();
        window.KusheCloudSync?.close?.();
        window.KuSheERPStore?.clearEphemeralSession?.();
        setLoginMessage('公司身分驗證成功；多帳號共用資料尚未啟用，未載入 ERP 業務資料。', true);
        return false;
      }
    } catch (error) {
      if(!current())return false;
      window.KusheCloudSync?.stopAutoBackup?.();
      window.KuSheERPStore?.clearEphemeralSession?.();
      const messages = {
        company_membership_missing: '此帳號尚未加入任何公司，無法進入 ERP。',
        company_membership_inactive: '此帳號的公司權限已停用，無法進入 ERP。',
        company_membership_ambiguous: '此帳號目前綁定多個啟用中的公司，請由管理者先確認公司歸屬。',
        company_membership_invalid: '此帳號的公司權限資料不完整，無法進入 ERP。',
        company_unavailable: '無法驗證此帳號所屬公司，請由管理者檢查公司設定。',
        company_state_unavailable: '無法驗證公司 ERP 資料權限，尚未載入任何業務資料。'
      };
      setLoginMessage(messages[error?.code] || '公司身分驗證失敗，尚未載入任何 ERP 業務資料。', true);
      return false;
    }

    setLoginMessage();
    const device=window.KusheCloudSync?.deviceSecurityStatus?.()||{trusted:false};
    try{
      if(device.trusted){
        window.KuSheERPStore?.clearEphemeralSession?.();
        await window.KuSheERPStore.load();
        if(!current())return false;
        await window.KuSheERPStore.readCommittedSnapshot();
      }else{
        await window.KusheCloudSync?.bootstrapTemporarySession?.();
      }
    }
    catch(error){
      if(!current())return false;
      window.KusheCloudSync?.stopAutoBackup?.();
      setAuthView(false);
      setLoginMessage(device.trusted?'ERP 本機資料安全檢查未通過，請使用恢復工具核對。':'無法安全載入公司雲端資料，未在此裝置保存 ERP 業務資料。',true);
      if(device.trusted){
        window.KusheRecovery?.showResult({status:'RECOVERY_REQUIRED',operationId:error.operationId||'',message:error.message});
        await window.KusheRecovery?.open();
      }
      return false;
    }
    if(!current())return false;
    setAuthView(true);
    if (!initialized) {
      init();
      initialized = true;
    }
    applyRoleNavigationPermissions();
    const permittedRoute=currentHashRoute();
    if(decodeURIComponent(window.location.hash.slice(1))!==permittedRoute){
      history.replaceState({route:permittedRoute},'',`#${permittedRoute}`);
      renderRoute(permittedRoute,{instant:true});
    }
    if(device.trusted)try { void Promise.resolve(window.KusheCloudSync?.startAutoBackup?.()).catch(() => {}); } catch (_) {}
    return true;
  }
  async function handleLogout() {
    if(logoutPending)return;
    logoutPending=true;
    const epoch=++authUiGeneration;
    resetMfaUi();
    // Clear local credentials synchronously before any remote logout wait.
    let remoteLogout;
    try { remoteLogout=window.KusheAuthGate?.logout(); } catch (_) {}
    if($('#recoveryModal'))$('#recoveryModal').hidden=true;
    if($('#storeSafetyBanner'))$('#storeSafetyBanner').hidden=true;
    closePopovers();
    window.KusheCloudSync?.stopAutoBackup?.();
    window.KusheCloudSync?.close?.();
    window.KuSheERPStore?.clearEphemeralSession?.();
    window.KusheEmployeeShell?.clear?.();
    setEmployeeShellView(false);
    closeChangePasswordModal(true);
    setAuthView(false);
    $('#loginForm')?.reset();
    setLoginBusy(true,'正在安全登出…');
    try { await remoteLogout; } catch (_) {}
    logoutPending=false;
    if(epoch!==authUiGeneration)return;
    setLoginBusy(false);
    setLoginMessage('已安全登出。');
    $('#loginEmail')?.focus();
  }

  function setChangePasswordError(message = '') {
    const node = $('#changePasswordError');
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }
  function setChangePasswordBusy(busy) {
    const form = $('#changePasswordForm'), submit = $('#changePasswordSubmit');
    $$('input,button', form || document.createElement('div')).forEach((node) => { node.disabled = Boolean(busy); });
    if ($('#changePasswordClose')) $('#changePasswordClose').disabled = Boolean(busy);
    if ($('#changePasswordBackdrop')) $('#changePasswordBackdrop').disabled = Boolean(busy);
    if (submit) submit.textContent = busy ? '變更中…' : '確認變更';
    if (form) form.setAttribute('aria-busy', String(Boolean(busy)));
  }
  function closeChangePasswordModal(force = false) {
    const modal = $('#changePasswordModal'), form = $('#changePasswordForm');
    if (!modal || (!force && form?.getAttribute('aria-busy') === 'true')) return;
    modal.hidden = true;
    form?.reset();
    setChangePasswordBusy(false);
    setChangePasswordError();
  }
  function openChangePasswordModal() {
    closePopovers();
    const modal = $('#changePasswordModal');
    if (!modal) return;
    $('#changePasswordForm')?.reset();
    setChangePasswordBusy(false);
    setChangePasswordError();
    modal.hidden = false;
    $('#currentPassword')?.focus();
  }
  async function handleChangePassword(event) {
    event.preventDefault();
    const form = $('#changePasswordForm');
    const currentPassword = String($('#currentPassword')?.value || '');
    const newPassword = String($('#newPassword')?.value || '');
    const confirmation = String($('#confirmNewPassword')?.value || '');
    form?.reset();
    setChangePasswordError();
    if (newPassword !== confirmation) return setChangePasswordError('兩次輸入的新密碼不一致。');
    if (newPassword.length < 12) return setChangePasswordError('新密碼至少需要 12 個字元。');
    if (newPassword === currentPassword) return setChangePasswordError('新密碼不可與目前密碼相同。');
    setChangePasswordBusy(true);
    window.KusheCloudSync?.stopAutoBackup?.();
    try {
      if (!window.KusheAuthGate?.changePassword) throw new Error('Password change unavailable');
      await window.KusheAuthGate.changePassword(currentPassword, newPassword);
      closeChangePasswordModal(true);
      closePopovers();
      setAuthView(false);
      $('#loginForm')?.reset();
      setLoginBusy(false);
      setLoginMessage('密碼已更新，請使用新密碼重新登入。');
      $('#loginEmail')?.focus();
    } catch (error) {
      try { void Promise.resolve(window.KusheCloudSync?.startAutoBackup?.()).catch(() => {}); } catch (_) {}
      setChangePasswordBusy(false);
      setChangePasswordError(error?.code === 'invalid_current_password' ? '目前密碼不正確。' : '密碼變更失敗，請稍後再試。');
    }
  }
  function bindAuthUi() {
    if (authUiBound) return;
    authUiBound = true;
    $('#recoveryLogout')?.addEventListener('click',()=>void handleLogout());
    $('#loginForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if(logoutPending||$('#loginForm')?.getAttribute('aria-busy')==='true')return;
      const epoch=++authUiGeneration;
      resetMfaUi();
      const email = $('#loginEmail'), password = $('#loginPassword');
      setLoginMessage();
      setLoginBusy(true, '正在驗證登入資訊…');
      try {
        if (!window.KusheAuthGate) throw new Error('Auth gate unavailable');
        await window.KusheAuthGate.login(email?.value, password?.value);
      } catch (_) {
        if(!authUiCurrent(epoch))return;
        if (password) password.value = '';
        setLoginMessage('登入失敗，請確認 Email 與密碼後再試一次。', true);
        setLoginBusy(false);
        return;
      }
      if(!authUiCurrent(epoch))return;
      if (password) password.value = '';
      try {
        await startAuthenticatedApp({authEpoch:epoch});
      } catch (_) {
        if(!authUiCurrent(epoch))return;
        setLoginMessage('登入資訊已驗證，但安全驗證流程發生錯誤；ERP 尚未載入，請重新整理後再試。', true);
      } finally {
        if(authUiCurrent(epoch))setLoginBusy(false);
      }
    });
    $('#mfaResetAccepted')?.addEventListener('change',renderMfaState);
    $('#mfaResetSubmit')?.addEventListener('click',()=>void confirmMfaReset());
    $('#mfaForm')?.addEventListener('submit',completeMfa);
    $('#mfaOtp')?.addEventListener('input',(event)=>{
      const input=event.target.closest?.('.mfa-digit');if(!input||!mfaReady())return;
      input.value=String(input.value||'').replace(/\D/g,'').slice(-1);
      const index=Number(input.dataset.mfaDigit)||0;
      if(input.value&&index<5)focusMfaDigit(index+1);
      setMfaMessage();renderMfaState();
    });
    $('#mfaOtp')?.addEventListener('keydown',(event)=>{
      const input=event.target.closest?.('.mfa-digit');if(!input||!mfaReady())return;
      const index=Number(input.dataset.mfaDigit)||0;
      if(event.key==='Backspace'&&!input.value&&index>0){event.preventDefault();focusMfaDigit(index-1)}
      if(event.key==='ArrowLeft'&&index>0){event.preventDefault();focusMfaDigit(index-1)}
      if(event.key==='ArrowRight'&&index<5){event.preventDefault();focusMfaDigit(index+1)}
    });
    $('#mfaOtp')?.addEventListener('paste',(event)=>{
      if(!mfaReady()){event.preventDefault();return}
      const digits=String(event.clipboardData?.getData('text')||'').replace(/\D/g,'').slice(0,6);
      if(!digits)return;
      event.preventDefault();mfaDigits().forEach((node,index)=>{node.value=digits[index]||''});
      focusMfaDigit(Math.max(0,Math.min(5,digits.length-1)));setMfaMessage();renderMfaState();
    });
    $('#mfaLogout')?.addEventListener('click',()=>void handleLogout());
    $('#changePasswordForm')?.addEventListener('submit', handleChangePassword);
    $('#changePasswordCancel')?.addEventListener('click', () => closeChangePasswordModal());
    $('#changePasswordClose')?.addEventListener('click', () => closeChangePasswordModal());
    $('#changePasswordBackdrop')?.addEventListener('click', () => closeChangePasswordModal());
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#changePasswordModal')?.hidden) closeChangePasswordModal(); });
  }
  async function boot() {
    if(logoutPending)return false;
    const epoch=++authUiGeneration;
    bindAuthUi();
    resetMfaUi();
    setAuthView(false);
    setLoginBusy(true, '正在確認登入狀態…');
    if (!window.KusheAuthGate) {
      setLoginBusy(false);
      setLoginMessage('登入服務目前無法使用。', true);
      return false;
    }
    let authenticated = false;
    try { authenticated = await window.KusheAuthGate.requireAuth(); } catch (_) {}
    if(!authUiCurrent(epoch))return false;
    setLoginBusy(false);
    if (!authenticated) {
      setAuthView(false);
      setLoginMessage();
      $('#loginEmail')?.focus();
      return false;
    }
    return await startAuthenticatedApp({authEpoch:epoch});
  }
  function closePopovers(except) { $$('.topbar-popover.is-open').forEach((node)=>{if(node!==except)node.classList.remove('is-open')}); }
  function togglePopover(id) { const node=$(`#${id}`); if(!node)return; const open=!node.classList.contains('is-open'); closePopovers(node); node.classList.toggle('is-open',open); }
  function knownRoute(module) {
    const route=String(module||'').replace(/^#/,'');
    return route==='dashboard'||config.moduleLabels?.[route]?route:'dashboard';
  }
  function firstAllowedRoute() {
    return window.KusheAuthGate?.firstAllowedRoute?.()||'dashboard';
  }
  function validRoute(module) {
    const route=knownRoute(module);
    if(window.KusheAuthGate?.canView?.(route))return route;
    const fallback=firstAllowedRoute();
    return fallback&&window.KusheAuthGate?.canView?.(fallback)?fallback:'dashboard';
  }
  function applyRoleNavigationPermissions() {
    $$('[data-module]').forEach((node)=>{
      const allowed=Boolean(window.KusheAuthGate?.canView?.(node.dataset.module));
      node.hidden=!allowed;
      node.setAttribute('aria-hidden',String(!allowed));
      if(!allowed&&node.classList.contains('active')){
        node.classList.remove('active');
        node.setAttribute('aria-current','false');
      }
    });
  }
  function currentHashRoute() { return validRoute(decodeURIComponent(window.location.hash.slice(1))); }
  function renderRoute(module, options = {}) {
    const route = validRoute(module);
    ui.route = route;
    const isDashboard = route === 'dashboard';
    const isCommissions = route === 'commissions' || route === 'attendance';
    const isUnbilledWork = route === 'unbilled-work';
    const isBillings = route === 'billings';
    const isBillingDraft = route === 'billing-draft';
    const isReceivables = route === 'receivables';
    const isPayables = route === 'payables';
    const isBanks = route === 'banks';
    const isInvoices = route === 'invoices';
    const isMaterials = route === 'materials';
    const isEmployees = route === 'employees';
    const isPayroll = route === 'payroll';
    const isReports = route === 'reports';
    const isSettings = route === 'settings';
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
    $('#invoicesView').hidden = !isInvoices;
    $('#materialsView').hidden = !isMaterials;
    $('#employeesView').hidden = !isEmployees;
    $('#payrollView').hidden = !isPayroll;
    $('#reportsView').hidden = !isReports;
    $('#settingsView').hidden = !isSettings;
    $('#projectsView').hidden = !isProjects;
    $('#quotationsView').hidden = !isQuotations;
    $('#moduleView').hidden = isDashboard || isCommissions || isUnbilledWork || isBillings || isBillingDraft || isReceivables || isPayables || isBanks || isInvoices || isMaterials || isEmployees || isPayroll || isReports || isSettings || isProjects || isQuotations;
    if (!isBanks) window.KusheBanks?.deactivate();
    if (!isInvoices) window.KusheInvoices?.deactivate();
    if (!isMaterials) window.KusheMaterials?.deactivate();
    if (!isEmployees) window.KusheEmployees?.deactivate();
    if (!isPayroll) window.KushePayroll?.deactivate();
    if (!isReports) window.KusheReports?.deactivate();
    if (!isSettings) window.KusheSettings?.deactivate();
    document.body.dataset.route = route;
    $$('.nav-item[data-module]').forEach((node) => {
      const navRoute = node.dataset.module;
      const active = navRoute === route || (route === 'attendance' && navRoute === 'commissions') || (route === 'customers' && navRoute === 'projects') || (route === 'billing-draft' && navRoute === 'billings');
      node.classList.toggle('active', active);
      node.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (!isProjects) window.KusheProjects?.deactivate();
    if (!isQuotations) window.KusheQuotations?.deactivate();
    if (isProjects) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheProjects?.activate({customer:route==='customers',customerId:route==='customers'?(options.customerId||''):'',projectId:route==='projects'?(options.projectId||''):''});document.title = '酷舍 ERP｜客戶／案場';
    } else if (isQuotations) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheQuotations?.activate();document.title = '酷舍 ERP－報價單管理';
    } else if (isCommissions) {
      window.KusheCommissions?.activate({ route });
      window.KusheUnbilledWork?.deactivate();
      window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();
      document.title = '酷舍 ERP｜出勤／業績管理';
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
    } else if (isInvoices) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheInvoices?.activate();document.title = '酷舍 ERP｜發票管理';
    } else if (isMaterials) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheMaterials?.activate();document.title = '酷舍 ERP｜材料管理';
    } else if (isEmployees) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheEmployees?.activate();document.title = '酷舍 ERP｜員工管理';
    } else if (isPayroll) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KushePayroll?.activate();document.title = '酷舍 ERP｜薪資管理';
    } else if (isReports) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheReports?.activate();document.title = '酷舍 ERP｜統計報表';
    } else if (isSettings) {
      window.KusheCommissions?.deactivate();window.KusheUnbilledWork?.deactivate();window.KusheBilling?.deactivate();window.KusheBilling?.deactivateDraft();window.KusheReceivables?.deactivate();window.KushePayables?.deactivate();window.KusheBanks?.deactivate();
      window.KusheSettings?.activate();document.title = '酷舍 ERP｜系統設定';
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
    const requested=knownRoute(module);
    const route = validRoute(requested);
    if(route!==requested)toast('此帳號沒有此功能的查看權限');
    if (!options.replace && currentHashRoute() !== route) history.pushState({ route }, '', `#${route}`);
    else if (options.replace) history.replaceState({ route }, '', `#${route}`);
    renderRoute(route, options);
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
    const select=$('#dashboardMonth'); const data=window.KuSheERPStore?.getState?.()||window.KuSheLegacyData?.getState?.()||{}; const current=businessMonth(); const keys=dateKeys(data); const latest=[current,...keys].sort().at(-1); const cursor=new Date(`${latest}-01T00:00:00`); const options=[];
    for(let i=0;i<24;i+=1){const d=new Date(cursor.getFullYear(),cursor.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;options.push(`<option value="${key}" ${key===current?'selected':''}>${d.getFullYear()}年${d.getMonth()+1}月</option>`)}
    select.innerHTML=options.join(''); if(!options.some((html)=>html.includes(`value="${current}"`)))select.value=latest;
    select.addEventListener('change',()=>window.KusheDashboard.refresh());
    $('#periodMode').addEventListener('change',(event)=>{const range=event.target.value==='year'?'3':event.target.value==='quarter'?'4':'12';$(`#trendRange [data-range="${range}"]`)?.click()});
  }
  function searchItems() {
    const data=window.KuSheERPStore?.getState?.()||{}; const labels=config.moduleLabels||{};
    const modules=Object.entries(labels).filter(([key])=>key!=='dashboard'&&key!=='billing-draft').map(([module,label])=>({module,label,sub:'功能模組'}));
    const projects=(data.projects||[]).map((row)=>({module:'projects',label:row.name||'—',sub:'案場',targetId:row.id}));
    const customers=(data.customers||[]).map((row)=>({module:'customers',label:row.name||'—',sub:'客戶',targetId:row.id}));
    const docs=[]; (data.billings||[]).forEach((row)=>docs.push({module:'billings',label:row.number||row.sourceNo||'—',sub:row.projectName||'請款單'}));
    (data.receivables||[]).forEach((row)=>{if(row.invoiceNo||row.sourceNo)docs.push({module:'receivables',label:row.invoiceNo||row.sourceNo,sub:row.projectName||'應收帳款'})});
    return [...modules,...projects,...customers,...docs].filter((row)=>row.label&&row.label!=='—');
  }
  function setupSearch() {
    const input=$('#globalSearch'),clear=$('#globalSearchClear'),popover=$('#searchPopover'),syncClear=()=>{clear.hidden=!input.value};
    function render(){const term=input.value.trim().toLocaleLowerCase('zh-Hant');const rows=searchItems().filter((row)=>!term||`${row.label} ${row.sub}`.toLocaleLowerCase('zh-Hant').includes(term));syncClear();popover.innerHTML=rows.length?rows.map((row)=>`<button class="search-result" type="button" data-search-module="${row.module}"${row.targetId?` data-search-target-id="${escapeText(row.targetId)}"`:''}><span><b>${escapeText(row.label)}</b><small>　${escapeText(row.sub)}</small></span><span>→</span></button>`).join(''):'<div class="popover-empty">找不到相符資料</div>';popover.classList.add('is-open');$$('[data-search-module]',popover).forEach((button)=>button.addEventListener('click',()=>{const module=button.dataset.searchModule,targetId=button.dataset.searchTargetId||'',options=module==='customers'&&targetId?{customerId:targetId}:module==='projects'&&targetId?{projectId:targetId}:{};navigate(module,options)}))}
    input.addEventListener('focus',render);input.addEventListener('input',render);input.addEventListener('keydown',(event)=>{if(event.key==='Escape'){popover.classList.remove('is-open');input.blur()}if(event.key==='Enter'){event.preventDefault();const results=$$('[data-search-module]',popover);if(results.length===1)results[0].click()}});clear.addEventListener('click',()=>{input.value='';render();input.focus()});syncClear();
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
    const cloudSyncButton = document.createElement('button');cloudSyncButton.id='cloudSyncButton';cloudSyncButton.type='button';cloudSyncButton.textContent='雲端同步';cloudSyncButton.addEventListener('click',()=>{closePopovers();window.KusheCloudSync?.open()});$('#userPopover')?.appendChild(cloudSyncButton);
    const changePasswordButton = document.createElement('button');changePasswordButton.id='changePasswordButton';changePasswordButton.type='button';changePasswordButton.textContent='變更密碼';changePasswordButton.addEventListener('click',openChangePasswordModal);$('#userPopover')?.appendChild(changePasswordButton);
    const logoutButton = document.createElement('button');logoutButton.id='logoutButton';logoutButton.type='button';logoutButton.textContent='登出';logoutButton.addEventListener('click',handleLogout);$('#userPopover')?.appendChild(logoutButton);
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
  window.addEventListener('kushe:employee-logout',()=>void handleLogout());
  window.KushePhase1={navigate,toast,boot};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void boot()},{once:true});else void boot();
}());
