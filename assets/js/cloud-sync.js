(function () {
  'use strict';

  const config = window.KUSHE_PHASE1_CONFIG || {};
  const BUSINESS_COLLECTIONS = [
    'customers', 'projects', 'vendors', 'materials', 'employees', 'banks', 'quotations',
    'dailyLogs', 'attendance', 'commissions', 'billings', 'receivables', 'payables',
    'invoices', 'payments', 'salaryPayments', 'payroll', 'bankTransactions'
  ];
  const RESTORE_DB_NAME = 'KuSheERP25_Core34_DB';
  const RESTORE_DB_STORE = 'erp';
  const RESTORE_STATE_KEY = 'main';
  const RESTORE_EMERGENCY_KEY = 'KuSheERP25_EMERGENCY';
  const RESTORE_MAX_BYTES = 20 * 1024 * 1024;
  const AUTO_BASELINE_KEY = 'kushe_erp_cloud_auto_v1';
  const AUTO_APPLY_PENDING_KEY = 'kushe_erp_cloud_apply_pending_v1';
  const AUTO_DEBOUNCE_MS = 8000;
  const AUTO_ONLINE_RETRY_MS = 3000;
  const SETTINGS_CREDENTIAL_KEYS = new Set([
    'username', 'password', 'loginusername', 'loginpassword', 'cloudurl',
    'cloudpublishablekey', 'supabaseurl', 'supabasepublishablekey',
    'servicerolekey', 'secretkey', 'jwtsecret'
  ]);
  const TOP_LEVEL_AUTH_KEYS = new Set(['accesstoken', 'refreshtoken', 'session', 'authsession']);
  const SECRET_KEYS = new Set(['password', 'secret', 'servicerole', 'accesstoken', 'refreshtoken', 'jwtsecret']);
  const STATUS_TEXT = {
    AUTH_REQUIRED: '登入狀態已失效，請重新登入。',
    AUTH_CHANGED: '登入帳號已變更，請重新檢查並確認雲端操作。',
    PRINCIPAL_UNBOUND: '本機資料尚未確認屬於目前帳號，請手動核對雲端同步。',
    REMOTE_EMPTY: '雲端尚無資料，可手動上傳本機備份。',
    SYNCED: '本機與雲端一致。',
    LOCAL_NEWER: '本機資料較新，可手動同步至雲端。',
    REMOTE_NEWER: '雲端資料較新，可在確認後安全還原至本機。',
    LOCAL_EMPTY_REMOTE_EXISTS: '此瀏覽器沒有 ERP 資料，可從雲端安全還原。',
    UNKNOWN_CONFLICT: '資料版本無法安全判定，已停止同步。',
    SECRET_BLOCKED: '偵測到未清除的憑證欄位，已停止同步。',
    RACE_BLOCKED: '雲端資料剛剛已更新，為避免覆蓋已停止同步。',
    VERIFY_FAILED: '雲端驗證失敗，請停止操作。',
    CAS_RESPONSE_INVALID: '雲端版本回應無法驗證，已停止同步。',
    SERVER_ERROR: '雲端服務回應錯誤，已停止同步。',
    CANCELLED: '已取消上傳。',
    UPLOAD_COMPLETE: '雲端同步完成。',
    RESTORE_BLOCKED: '目前資料狀態不允許雲端還原。',
    RESTORE_CANCELLED: '已取消雲端還原。',
    RESTORE_RACE_BLOCKED: '雲端資料剛剛已更新，為避免還原錯誤已停止。',
    RESTORE_VERIFY_FAILED: '還原驗證失敗，已嘗試恢復原本本機資料。請停止操作。',
    RESTORE_CRITICAL_FAILURE: 'RESTORE CRITICAL FAILURE：原本本機資料也無法完整恢復，請立即停止操作。',
    RESTORE_COMPLETE: '雲端資料已安全還原，即將重新載入 ERP。',
    RESTORE_HANDOFF_BLOCKED: '資料已完成還原，但同步基準交接未完成。請勿重複還原；需重新核對雲端同步。',
    ERROR: '雲端檢查失敗，請稍後再試。'
  };
  const AUTO_STATUS_TEXT = {
    PRINCIPAL_UNBOUND: '帳號同步基準未綁定，需要手動核對',
    STOPPED: '未啟用',
    CHECKING: '正在確認安全同步基準',
    ARMED: '已啟用',
    WAITING: '等待同步',
    SYNCING: '同步中',
    AUTO_SYNCED: '已同步',
    WAITING_NETWORK: '等待網路',
    MANUAL_REQUIRED: '需要手動同步',
    CONFLICT: '偵測到衝突，已停止',
    RACE_BLOCKED: '雲端版本已變更，已停止',
    SECRET_BLOCKED: '安全檢查未通過，已停止',
    SERVER_ERROR: '雲端回應無法驗證，已停止',
    AUTH_REQUIRED: '未登入'
  };

  let currentStatus = null;
  let busy = false;
  let uiBound = false;
  let autoState = { code: 'STOPPED', message: AUTO_STATUS_TEXT.STOPPED, pending: false, armed: false };
  let autoStarted = false;
  let autoArmed = false;
  let autoRunning = false;
  let autoGeneration = 0;
  let autoTimer = null;
  let autoOnlineTimer = null;
  let autoController = null;
  let autoRetryMode = '';
  let autoPendingVerification = null;
  // Only sync bookkeeping is invalidated. ERP snapshots are never touched here.
  let principalId = null;
  let syncGeneration = 0;
  let operationTail = Promise.resolve();
  let activeOperation = null;
  const pendingOperations = new Map();
  let syncOrigin = 'USER_LOCAL_EDIT';
  const requestControllers = new Set();

  function observedPrincipal() {
    const gate = window.KusheAuthGate;
    return gate?.session()?.access_token ? String(gate.user()?.id || '') : '';
  }

  function observePrincipal() {
    const next = observedPrincipal();
    if (principalId !== null && next !== principalId) {
      stopAutoBackup();
      currentStatus = failure('AUTH_CHANGED');
      autoState = { code: 'PRINCIPAL_UNBOUND', message: AUTO_STATUS_TEXT.PRINCIPAL_UNBOUND, pending: false, armed: false, userId: next };
      renderAutoState();
    }
    principalId = next;
    return next;
  }

  function assertOperation(auth) {
    const id = observePrincipal();
    if ((auth && (auth.user.id !== id || auth.generation !== syncGeneration))
      || (activeOperation && (activeOperation.userId !== id || activeOperation.generation !== syncGeneration))) {
      throw new CloudSyncError('AUTH_CHANGED');
    }
  }

  // Deduplicate each entry point and serialize different entry points. A stale
  // operation keeps its slot until settlement, even if fetch ignores abort.
  function coordinate(kind, work) {
    const userId = observePrincipal(), generation = syncGeneration;
    const key = generation + ':' + userId + ':' + kind;
    if (pendingOperations.has(key)) {
      if (kind === 'auto') scheduleAutoBackup();
      return pendingOperations.get(key);
    }
    const promise = operationTail.then(async () => {
      if (observePrincipal() !== userId || generation !== syncGeneration) return autoStatus();
      activeOperation = { userId, generation, kind };
      try { return await work(); }
      finally { activeOperation = null; }
    });
    operationTail = promise.catch(() => {});
    pendingOperations.set(key, promise);
    promise.then(() => pendingOperations.delete(key), () => pendingOperations.delete(key));
    return promise;
  }

  // Reserved source marker only: this does not apply, restore or persist data.
  function setSyncOrigin(origin) {
    if (!['USER_LOCAL_EDIT', 'REMOTE_APPLY'].includes(origin)) return false;
    syncOrigin = origin;
    if (origin === 'REMOTE_APPLY') { clearAutoTimer(); clearOnlineTimer(); }
    return true;
  }

  function inspect() { return coordinate('inspect', inspectOperation); }
  function uploadLocal() { return coordinate('upload', uploadOperation); }
  function evaluateAutoStart(generation) { return coordinate('start', () => evaluateAutoStartOperation(generation)); }
  function verifyPendingAutoUpload(generation) { return coordinate('verify', () => verifyPendingAutoUploadOperation(generation)); }
  function autoBackupNow() { return coordinate('auto', autoBackupOperation); }


  const CLOUD_RESUME_DELAY_MS = 250;
  const CLOUD_RESUME_THROTTLE_MS = 2000;
  const CLOUD_POLL_MS = 30000;
  let cloudPollTimer = null, cloudPollRunning = false, cloudPollEpoch = 0;
  let cloudEventsEnabled = false, cloudHasStarted = false;
  let cloudRequest = null, cloudTimer = null, cloudLastFinished = 0;

  function cloudVisible() { return document.visibilityState === 'visible'; }
  function reconcileFromCloud(reason) {
    if (!['STARTUP','AUTH_READY','VISIBILITY','FOCUS','ONLINE','POLL'].includes(reason)) return Promise.resolve({code:'CANCELLED'});
    if (!cloudEventsEnabled || !cloudVisible() || !observedPrincipal()) return Promise.resolve({code:'AUTH_REQUIRED',eligibleApply:false});
    if (reason === 'POLL' && navigator.onLine === false) return Promise.resolve({code:'NETWORK_ERROR',eligibleApply:false});
    if (cloudRequest) return cloudRequest.promise;
    if (Date.now() - cloudLastFinished < CLOUD_RESUME_THROTTLE_MS) return Promise.resolve({code:'THROTTLED'});
    const generation = syncGeneration;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const request = {promise,resolve};
    cloudRequest = request;
    cloudTimer = window.setTimeout(async () => {
      cloudTimer = null;
      const valid = () => cloudEventsEnabled && cloudVisible() && generation === syncGeneration && Boolean(observedPrincipal())
        && (reason !== 'POLL' || navigator.onLine !== false);
      try {
        if (!valid()) return resolve({code:'CANCELLED'});
        // Reuse the same operation kind and ownership guard as controlled apply.
        const result = await coordinate('remote-apply', async () => {
          if (!valid()) return {code:'CANCELLED'};
          const ready = await window.KuSheERPStore?.remoteApplyReadiness?.();
          if (!ready?.safe || !valid()) return {code:'STORE_BUSY'};
          return safeApplyOperation(valid);
        });
        resolve(result);
      } catch (_) { resolve({code:'NETWORK_ERROR',eligibleApply:false}); }
      finally {
        if (cloudRequest === request) {
          cloudLastFinished = Date.now();
          cloudRequest = null;
        }
      }
    }, CLOUD_RESUME_DELAY_MS);
    return promise;
  }
  function clearCloudPoll() {
    cloudPollEpoch += 1;
    if (cloudPollTimer !== null) window.clearTimeout(cloudPollTimer);
    cloudPollTimer = null;
    cloudPollRunning = false;
  }
  function scheduleCloudPoll() {
    if (!cloudEventsEnabled || !cloudVisible() || cloudPollTimer !== null || cloudPollRunning) return;
    const generation = syncGeneration, epoch = cloudPollEpoch, userId = observedPrincipal();
    if (!userId) return;
    cloudPollTimer = window.setTimeout(async () => {
      cloudPollTimer = null;
      cloudPollRunning = true;
      try {
        if (epoch !== cloudPollEpoch || generation !== syncGeneration || !cloudEventsEnabled || !cloudVisible()) return;
        if (observePrincipal() !== userId || generation !== syncGeneration) return;
        if (navigator.onLine !== false) await reconcileFromCloud('POLL');
      } finally {
        if (epoch === cloudPollEpoch && generation === syncGeneration) {
          cloudPollRunning = false;
          scheduleCloudPoll();
        }
      }
    }, CLOUD_POLL_MS);
  }
  function cloudFocus() { void reconcileFromCloud('FOCUS'); }
  function cloudVisibility() {
    clearCloudPoll();
    if (cloudVisible()) {
      void reconcileFromCloud('VISIBILITY');
      scheduleCloudPoll();
    }
  }
  function cloudOnline() { void reconcileFromCloud('ONLINE'); }
  function startCloudEvents() {
    cloudEventsEnabled = true;
    window.addEventListener('focus',cloudFocus);
    document.addEventListener('visibilitychange',cloudVisibility);
    window.addEventListener('online',cloudOnline);
    const reason = cloudHasStarted ? 'AUTH_READY' : 'STARTUP';
    cloudHasStarted = true;
    void reconcileFromCloud(reason);
    scheduleCloudPoll();
  }
  function stopCloudEvents() {
    cloudEventsEnabled = false;
    clearCloudPoll();
    window.removeEventListener('focus',cloudFocus);
    document.removeEventListener('visibilitychange',cloudVisibility);
    window.removeEventListener('online',cloudOnline);
    if (cloudTimer !== null) {
      window.clearTimeout(cloudTimer);
      cloudTimer = null;
      cloudRequest?.resolve({code:'CANCELLED'});
      cloudRequest = null;
    }
    cloudLastFinished = 0;
  }

  let editorTouched = false, editorComposition = false, editorGeneration = 0;
  let editorLease = false;
  let editorCommitFloor = '';
  const USER_COMMIT_OPERATIONS = new Set([
    'saveQuotationUnitPreset','saveQuotationPublicNotePreset','deleteQuotationPublicNotePreset',
    'saveCommission','deleteCommission','saveDailyBatch','deleteDailyBatch','saveInvoice','createBilling','updateBilling','deleteBilling',
    'addReceipt','updateReceipt','deleteReceipt','addRetentionReceipt','updateRetentionReceipt','deleteRetentionReceipt','deleteReceivableAccounting',
    'savePayable','deletePayable','addPayablePayment','updatePayablePayment','deletePayablePayment',
    'updatePayrollAdjustments','addSalaryPayment','updateSalaryPayment','deleteSalaryPayment','updateBillingInvoice',
    'saveCustomer','deleteCustomer','saveProject','deleteProject','saveEmployee','deleteEmployee','saveMaterial','deleteMaterial',
    'saveMaterialUsage','deleteMaterialUsage','saveProjectCost','deleteProjectCost','saveQuotationPrice','saveQuotation','setQuotationStatus','deleteQuotation',
    'cancelQuotationConfirmation','createQuotationRevision','saveQuotationTemplate'
  ]);
  function isBusinessEditorEvent(event) {
    const shell = document.getElementById('appShell');
    const target = event?.target;
    return Boolean(shell && !shell.hidden && observedPrincipal()
      && target instanceof Node && shell.contains(target));
  }
  function noteEditorEvent(event) {
    if (!isBusinessEditorEvent(event)) return;
    if (editorLease) { event.preventDefault?.(); event.stopImmediatePropagation?.(); }
    if (event.type === 'compositionend') editorComposition = false;
    if (event.type === 'compositionstart') editorComposition = true;
    editorTouched = true;
    editorCommitFloor = window.KuSheERPStore?.getLastStoreTransactionResult?.()?.operationId || '';
    editorGeneration += 1;
  }
  function noteEditorRoute() {
    editorGeneration += 1;
  }
  ['beforeinput','input','change','compositionstart','compositionend','paste','drop','submit'].forEach(type => document.addEventListener(type,noteEditorEvent,true));
  // Capture business navigation before its handler can create a private draft.
  document.addEventListener('click', event => {
    if (editorLease) { event.preventDefault?.(); event.stopImmediatePropagation?.(); return; }
    const target = event.target?.closest?.('[data-module],[data-route],button,a');
    if (target) editorGeneration += 1;
  },true);
  window.addEventListener('hashchange',noteEditorRoute);
  window.addEventListener('popstate',noteEditorRoute);
  function editorSurfaceSafe(allowLease = false) {
    if (editorComposition || (editorLease && !allowLease) || typeof document.querySelectorAll !== 'function') return false;
    if (document.activeElement?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return false;
    const nodes = document.querySelectorAll('form:not([role="search"]),[role="dialog"],dialog,.erp-detail-overlay,.commission-drawer-layer,.commission-drawer,[contenteditable]:not([contenteditable="false"])');
    for (const node of nodes) {
      if (typeof node.getClientRects !== 'function') return false;
      if (!node.hidden && node.getClientRects().length) return false;
    }
    const shell = document.getElementById('appShell');
    return Boolean(shell && !shell.hidden && 'inert' in shell);
  }
  async function isTrustedUserDurableCommit(detail) {
    if (syncOrigin === 'REMOTE_APPLY' || detail?.syncOrigin === 'REMOTE_APPLY'
      || !detail?.operationId || !detail?.revisionId || typeof detail.action !== 'string'
      || /rollback|recovery|snapshotReplacement|controlledRecovery/i.test(detail.action)
      || detail.operationId === editorCommitFloor) return false;
    const store = window.KuSheERPStore, result = store?.getLastStoreTransactionResult?.();
    if (!result || !['COMMITTED','COMMITTED_WITH_NOTIFICATION_WARNING'].includes(result.status)
      || !USER_COMMIT_OPERATIONS.has(result.operationType) || result.noChange
      || result.operationId !== detail.operationId || result.revisionId !== detail.revisionId) return false;
    const ready = await store.remoteApplyReadiness?.();
    return Boolean(ready?.safe && ready.revision?.id === detail.revisionId
      && ready.revision?.operationId === detail.operationId
      && ready.data?.audit?.[0]?.action === detail.action
      && store.getLastStoreTransactionResult()?.operationId === detail.operationId);
  }
  function handleEditorCommit(event) {
    if (syncOrigin === 'REMOTE_APPLY' || event?.detail?.syncOrigin === 'REMOTE_APPLY') return;
    const detail = {...event?.detail}, generation = editorGeneration;
    // Store records the completed transaction after synchronous notifications.
    window.setTimeout(async () => {
      try {
        if (!await isTrustedUserDurableCommit(detail) || syncOrigin === 'REMOTE_APPLY'
          || generation !== editorGeneration || !editorSurfaceSafe()) return;
        editorTouched = false;
        editorCommitFloor = detail.operationId;
        editorGeneration += 1;
      } catch (_) { /* Unverifiable notifications cannot release a draft. */ }
    },0);
  }
  window.addEventListener('kushe:data-updated',handleEditorCommit);
  function editorReadiness(allowLease = false) {
    const unsafe = {safe:false,code:'EDITOR_DIRTY',generation:editorGeneration};
    if (editorTouched || !editorSurfaceSafe(allowLease)) return unsafe;
    return {safe:true,code:'EDITOR_READY',generation:editorGeneration};
  }
  function decideRemote(input = {}) {
    const result = (code,eligibleApply=false,eligibleUpload=false) => ({code,eligibleApply,eligibleUpload});
    if (!input.userId) return result('AUTH_REQUIRED');
    const base = input.baseline;
    if (base && base.userId !== input.userId) return result('PRINCIPAL_MISMATCH');
    if (input.networkError) return result('NETWORK_ERROR');
    if (!input.remoteExists) return result('REMOTE_MISSING');
    if (!base || !input.metadataValid) return result('VERSION_UNKNOWN');
    let accepted,remote;
    try { accepted=BigInt(serverSyncVersion(base.syncVersion)); remote=BigInt(serverSyncVersion(input.remoteVersion)); }
    catch (_) { return result('VERSION_UNKNOWN'); }
    if (!input.storeSafe) return result('STORE_BUSY');
    if (!input.editorSafe) return result('EDITOR_DIRTY');
    if (![base.remoteFingerprint,base.localFingerprint,input.remoteFingerprint,input.localFingerprint].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value))) return result('VERSION_UNKNOWN');
    const clean = input.localFingerprint === base.localFingerprint;
    if (remote < accepted || remote === accepted && input.remoteFingerprint !== base.remoteFingerprint) return result('CONFLICT');
    if (remote > accepted) return clean ? result('REMOTE_NEWER_SAFE',true) : result('CONFLICT');
    return clean ? result('SYNCED') : result('LOCAL_DIRTY',false,true);
  }
  function invalidateApplyBaseline() {
    // Durable intent is a baseline-validity fence, not a persisted UI suppression flag.
    window.localStorage.setItem(AUTO_APPLY_PENDING_KEY,'1');
    if (window.localStorage.getItem(AUTO_APPLY_PENDING_KEY) !== '1') throw new CloudSyncError('VERIFY_FAILED');
    window.localStorage.removeItem(AUTO_BASELINE_KEY);
    if (window.localStorage.getItem(AUTO_BASELINE_KEY) !== null) throw new CloudSyncError('VERIFY_FAILED');
  }
  function safeApplyRemote() { return coordinate('remote-apply',safeApplyOperation); }
  async function safeApplyOperation(lifecycleGuard = () => true) {
    let invalidated=false,shell=null,priorInert=false;
    try {
      const auth=await authContext(),store=window.KuSheERPStore;
      if (!store?.remoteApplyReadiness || !store?.applyRemoteSnapshot) throw new CloudSyncError('STORE_BUSY');
      const baseline=readBaseline(auth.user.id),row=await readRemote(auth);
      const ready=await store.remoteApplyReadiness(),editor=editorReadiness();
      assertOperation(auth);
      const local=ready.safe?await snapshotInfo(ready.data):null;
      const remote=row?await validateRemoteSnapshot(row.data,row.updated_at):null;
      const decision=decideRemote({userId:auth.user.id,baseline,remoteExists:Boolean(row),remoteVersion:row?.sync_version,
        metadataValid:typeof row?.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at)),
        remoteFingerprint:remote?.fingerprint,localFingerprint:local?.fingerprint,storeSafe:ready.safe,editorSafe:editor.safe});
      if (!decision.eligibleApply) return decision;
      // Baseline and editor may have changed during digest/validation awaits.
      if (JSON.stringify(readBaseline(auth.user.id))!==JSON.stringify(baseline)) throw new CloudSyncError('RACE_BLOCKED');
      const guard=()=>{
        assertOperation(auth);
        const current=editorReadiness(true);
        return Boolean(lifecycleGuard()&&activeOperation?.kind==='remote-apply'&&current.safe&&current.generation===editor.generation);
      };
      if (!guard()) throw new CloudSyncError('EDITOR_DIRTY');
      shell=document.getElementById('appShell');priorInert=shell.inert;shell.inert=true;editorLease=true;
      autoArmed=false;autoGeneration+=1;clearAutoTimer();clearOnlineTimer();autoRetryMode='';autoPendingVerification=null;
      invalidated=true;invalidateApplyBaseline();setSyncOrigin('REMOTE_APPLY');
      const result=await store.applyRemoteSnapshot(remote.data,{userId:auth.user.id,baseline:ready.baseline,guard});
      if (result.status!=='COMMITTED' || !guard()) throw new CloudSyncError('VERIFY_FAILED');
      const after=await store.remoteApplyReadiness();
      if (!after.safe || !guard()) throw new CloudSyncError('VERIFY_FAILED');
      const committed=await snapshotInfo(after.data),expected=await snapshotInfo(result.verifiedSnapshot);
      if (committed.fingerprint!==expected.fingerprint || !guard()) throw new CloudSyncError('VERIFY_FAILED');
      // Store stamps provenance/audit; keep the accepted remote and actual local hashes separately.
      const unchanged=await store.remoteApplyReadiness(after.baseline);
      if (!unchanged.safe || !guard()) throw new CloudSyncError('VERIFY_FAILED');
      if (!await writeBaseline(auth,row,committed.fingerprint)) throw new CloudSyncError('VERIFY_FAILED');
      if (!guard()) throw new CloudSyncError('VERIFY_FAILED');
      autoArmed=true;
      if(!autoStarted){autoStarted=true;autoGeneration+=1;ensureAutoListeners();}
      setAutoState('ARMED',{pending:false,armed:true});
      currentStatus=classified('SYNCED',auth,committed,remote,row,false,false);
      return {code:'REMOTE_APPLIED',syncVersion:serverSyncVersion(row.sync_version),remoteFingerprint:remote.fingerprint,localFingerprint:committed.fingerprint,storeBaseline:after.baseline};
    } catch (error) {
      if(invalidated){
        autoArmed=false;
        try{invalidateApplyBaseline();}catch(_){}
        setAutoState('MANUAL_REQUIRED',{pending:false,armed:false});
      }
      return {code:writeFailureCode(error),eligibleApply:false,eligibleUpload:false};
    } finally {
      if(invalidated)setSyncOrigin('USER_LOCAL_EDIT');
      editorLease=false;if(shell)shell.inert=priorInert;
    }
  }

  class CloudSyncError extends Error {
    constructor(code = 'ERROR') {
      super(code);
      this.name = 'CloudSyncError';
      this.code = code;
    }
  }

  function normalizedKey(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  function hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
  }

  function sanitizeCloudSnapshot(value) {
    const snapshot = deepClone(value);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
    if (snapshot.settings && typeof snapshot.settings === 'object' && !Array.isArray(snapshot.settings)) {
      Object.keys(snapshot.settings).forEach((key) => {
        if (SETTINGS_CREDENTIAL_KEYS.has(normalizedKey(key))) delete snapshot.settings[key];
      });
    }
    Object.keys(snapshot).forEach((key) => {
      if (TOP_LEVEL_AUTH_KEYS.has(normalizedKey(key))) delete snapshot[key];
    });
    if(snapshot.meta){delete snapshot.meta.receiptCommitVersion;delete snapshot.meta.localCommitToken}
    delete snapshot.localCommitToken;delete snapshot.recoveryMarker;delete snapshot.transactionJournal;
    return snapshot;
  }

  function secretAudit(value, path = '$', findings = []) {
    if (!value || typeof value !== 'object') return findings;
    if (Array.isArray(value)) {
      value.forEach((item, index) => secretAudit(item, `${path}[${index}]`, findings));
      return findings;
    }
    Object.entries(value).forEach(([key, item]) => {
      const nextPath = `${path}.${key}`;
      if (SECRET_KEYS.has(normalizedKey(key)) && hasValue(item)) findings.push(nextPath);
      secretAudit(item, nextPath, findings);
    });
    return findings;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  async function fingerprint(value) {
    const canonical = JSON.stringify(canonicalize(value));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function businessScore(value) {
    return BUSINESS_COLLECTIONS.reduce((sum, key) => sum + (Array.isArray(value?.[key]) ? value[key].length : 0), 0);
  }

  function logicalTime(data, fallback = '') {
    const raw = String(data?.meta?.updatedAt || fallback || '').trim();
    const value = Date.parse(raw);
    return Number.isFinite(value) ? { raw, value } : null;
  }

  async function snapshotInfo(value, fallbackTime = '') {
    const data = sanitizeCloudSnapshot(value);
    if (secretAudit(data).length) throw new CloudSyncError('SECRET_BLOCKED');
    return {
      data,
      score: businessScore(data),
      fingerprint: await fingerprint(data),
      time: logicalTime(data, fallbackTime)
    };
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  async function validateRemoteSnapshot(value, fallbackTime = '') {
    if (!isPlainObject(value)) throw new CloudSyncError('RESTORE_BLOCKED');
    ['settings', 'meta'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key) && !isPlainObject(value[key])) {
        throw new CloudSyncError('RESTORE_BLOCKED');
      }
    });
    BUSINESS_COLLECTIONS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key) && !Array.isArray(value[key])) {
        throw new CloudSyncError('RESTORE_BLOCKED');
      }
    });
    const info = await snapshotInfo(value, fallbackTime);
    if (info.score <= 0) throw new CloudSyncError('RESTORE_BLOCKED');
    const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(info.data))).byteLength;
    if (bytes > RESTORE_MAX_BYTES) throw new CloudSyncError('RESTORE_BLOCKED');
    return { ...info, bytes };
  }

  function cloudConfig() {
    const url = String(config.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(config.supabasePublishableKey || '').trim();
    if (!/^https:\/\//i.test(url) || !key || /(?:service[_-]?role|sb_secret_)/i.test(key)) throw new CloudSyncError('ERROR');
    return { url, key };
  }

  async function authContext() {
    const gate = window.KusheAuthGate;
    if (!gate || !await gate.requireAuth()) throw new CloudSyncError('AUTH_REQUIRED');
    const session = gate.session();
    const user = gate.user();
    if (!session?.access_token || !user?.id) throw new CloudSyncError('AUTH_REQUIRED');
    assertOperation();
    return { token: session.access_token, generation: syncGeneration, user: { id: String(user.id), email: String(user.email || '') } };
  }

  async function revalidatePrincipal(expectedAuth) {
    const current=await authContext();
    if(!expectedAuth?.user?.id||current.user.id!==expectedAuth.user.id)throw new CloudSyncError('AUTH_CHANGED');
    return current;
  }

  async function request(path, auth, options = {}) {
    assertOperation(auth);
    if (options.cas && syncOrigin === 'REMOTE_APPLY') throw new CloudSyncError('RACE_BLOCKED');
    const { url, key } = cloudConfig();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${auth.token}`,
      ...(options.headers || {})
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    requestControllers.add(controller);
    try {
      const response = await fetch(`${url}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
      assertOperation(auth);
      if (!response.ok) {
        const code = options.cas ? ([401, 403].includes(response.status) ? 'AUTH_REQUIRED' : 'SERVER_ERROR') : 'ERROR';
        const error = new CloudSyncError(code);
        error.httpStatus = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      let result;
      try { result = await response.json(); } catch (_) { result = null; }
      assertOperation(auth);
      return result;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      requestControllers.delete(controller);
    }
  }

  function remotePath(userId) {
    return `/rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  }

  async function readRemote(auth, options = {}) {
    const rows = await request(remotePath(auth.user.id), auth, options);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function serverSyncVersion(value) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 1) throw new CloudSyncError('CAS_RESPONSE_INVALID');
      return value;
    }
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new CloudSyncError('CAS_RESPONSE_INVALID');
    const version = BigInt(value);
    if (version > 9223372036854775807n) throw new CloudSyncError('CAS_RESPONSE_INVALID');
    return version <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(version) : value;
  }

  function remoteWriteState(row) {
    return { remoteExists: Boolean(row), syncVersion: row ? serverSyncVersion(row.sync_version) : null };
  }

  function sameSyncVersion(left, right) {
    return left === null || right === null ? left === right : String(serverSyncVersion(left)) === String(serverSyncVersion(right));
  }

  async function casWrite(auth, expectedSyncVersion, data, options = {}) {
    const expected = expectedSyncVersion === null ? null : serverSyncVersion(expectedSyncVersion);
    const rows = await request('/rest/v1/rpc/erp_state_cas_write', auth, {
      method: 'POST', cas: true, signal: options.signal,
      body: { expected_sync_version: expected, new_data: data }
    });
    if (!Array.isArray(rows) || rows.length !== 1) throw new CloudSyncError('CAS_RESPONSE_INVALID');
    const result = rows[0];
    if (result?.status === 'CONFLICT' && result.sync_version === null && result.updated_at === null) {
      return { status: 'CONFLICT', syncVersion: null, updatedAt: null };
    }
    if (result?.status !== 'APPLIED') throw new CloudSyncError('CAS_RESPONSE_INVALID');
    const syncVersion = serverSyncVersion(result.sync_version);
    if (BigInt(syncVersion) !== (expected === null ? 1n : BigInt(expected) + 1n)
      || typeof result.updated_at !== 'string' || !Number.isFinite(Date.parse(result.updated_at))) {
      throw new CloudSyncError('CAS_RESPONSE_INVALID');
    }
    return { status: 'APPLIED', syncVersion, updatedAt: result.updated_at };
  }

  function matchesAppliedVersion(row, applied) {
    return Boolean(row) && sameSyncVersion(row.sync_version, applied.syncVersion)
      && String(row.updated_at || '') === applied.updatedAt;
  }

  function writeFailureCode(error) {
    if ([401, 403].includes(error?.httpStatus)) return 'AUTH_REQUIRED';
    if (error?.httpStatus) return 'SERVER_ERROR';
    return error?.code || 'ERROR';
  }

  function pauseAutoForConflict() {
    clearAutoTimer();
    clearOnlineTimer();
    autoArmed = false;
    autoRetryMode = '';
    autoPendingVerification = null;
    return setAutoState('CONFLICT', { pending: false, armed: false });
  }

  // Ordinary reads never delete persisted bookkeeping, including during auth transitions.
  function parsePersistedBaseline() {
    try {
      const raw = window.localStorage.getItem(AUTO_BASELINE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      const baseline = {
        version: value?.version,
        syncVersion: serverSyncVersion(value?.syncVersion),
        userId: value?.userId,
        remoteUpdatedAt: value?.remoteUpdatedAt,
        remoteFingerprint: value?.remoteFingerprint,
        localFingerprint: value?.localFingerprint
      };
      return baseline.version === 2 && typeof baseline.userId === 'string' && baseline.userId
        && baseline.syncVersion !== null
        && typeof baseline.remoteUpdatedAt === 'string' && Number.isFinite(Date.parse(baseline.remoteUpdatedAt))
        && typeof baseline.remoteFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(baseline.remoteFingerprint)
        && typeof baseline.localFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(baseline.localFingerprint)
        ? baseline : null;
    } catch (_) { return null; }
  }

  function readBaseline(userId) {
    try {
      if (!userId || window.localStorage.getItem(AUTO_APPLY_PENDING_KEY)) return null;
      const baseline = parsePersistedBaseline();
      return baseline?.userId === userId ? baseline : null;
    } catch (_) { return null; }
  }

  async function writeBaseline(auth, row, localFingerprint, readinessGuard = null) {
    const remote = await remoteInfo(row);
    assertOperation(auth);
    const baseline = {
      version: 2,
      syncVersion: remoteWriteState(row).syncVersion,
      userId: String(auth?.user?.id || ''),
      remoteUpdatedAt: String(row?.updated_at || ''),
      remoteFingerprint: String(remote?.fingerprint || ''),
      localFingerprint: String(localFingerprint || '')
    };
    if (baseline.syncVersion === null || !baseline.userId || !baseline.remoteUpdatedAt
      || !/^[a-f0-9]{64}$/i.test(baseline.remoteFingerprint)
      || !/^[a-f0-9]{64}$/i.test(baseline.localFingerprint)) return false;
    try {
      if (readinessGuard && !await readinessGuard()) return false;
      assertOperation(auth);
      const encoded=JSON.stringify(baseline);
      window.localStorage.setItem(AUTO_BASELINE_KEY, encoded);
      if(window.localStorage.getItem(AUTO_BASELINE_KEY)!==encoded)return false;
      window.localStorage.removeItem(AUTO_APPLY_PENDING_KEY);
      return window.localStorage.getItem(AUTO_APPLY_PENDING_KEY)===null;
    } catch (_) {
      return false;
    }
  }

  async function readLocal() {
    const store=window.KuSheERPStore;
    if(!store?.readCommittedSnapshot)throw new CloudSyncError('STORE_UNAVAILABLE');
    const committed=await store.readCommittedSnapshot();
    const info = await snapshotInfo(committed.data);
    assertOperation();
    return {...info,storeBaseline:committed.baseline};
  }

  async function remoteInfo(row) {
    const info = row ? await snapshotInfo(row.data, row.updated_at) : null;
    assertOperation();
    return info;
  }

  function classified(code, auth, local, remote, row, canUpload = false, canRestore = false) {
    return { code, message: STATUS_TEXT[code], canUpload, canRestore, auth, local, remote, remoteExists: Boolean(row), syncVersion: row ? row.sync_version : null, remoteUpdatedAt: String(row?.updated_at || '') };
  }

  function classify(auth, local, remote, row) {
    const baseline=readBaseline(auth.user.id);
    if(row&&baseline&&local.fingerprint===baseline.localFingerprint&&baselineMatchesRemote(baseline,row,remote))return classified('SYNCED',auth,local,remote,row,false,false);
    if (!row) return classified('REMOTE_EMPTY', auth, local, null, null, local.score > 0);
    if (local.fingerprint === remote.fingerprint) return classified('SYNCED', auth, local, remote, row, false);
    if (local.score === 0 && remote.score > 0) return classified('LOCAL_EMPTY_REMOTE_EXISTS', auth, local, remote, row, false, true);
    if (!local.time || !remote.time) return classified('UNKNOWN_CONFLICT', auth, local, remote, row, false);
    if (remote.time.value >= local.time.value) return classified('REMOTE_NEWER', auth, local, remote, row, false, remote.score > 0);
    if (local.time.value > remote.time.value && local.score > 0) return classified('LOCAL_NEWER', auth, local, remote, row, true);
    return classified('UNKNOWN_CONFLICT', auth, local, remote, row, false);
  }

  async function inspectCore() {
    const auth = await authContext();
    const row = await readRemote(auth);
    const local = await readLocal();
    const remote = await remoteInfo(row);
    return classify(auth, local, remote, row);
  }

  function shortFingerprint(value) {
    return String(value || '').slice(0, 10) || '—';
  }

  function publicStatus(value = currentStatus) {
    if (!value) return null;
    return deepClone({
      code: value.code,
      message: value.message,
      canUpload: Boolean(value.canUpload),
      canRestore: Boolean(value.canRestore),
      remoteExists: Boolean(value.remoteExists),
      syncVersion: value.syncVersion ?? null,
      userEmail: value.auth?.user?.email || '',
      localUpdatedAt: value.local?.time?.raw || '',
      remoteUpdatedAt: value.remote?.time?.raw || value.remoteUpdatedAt || '',
      localScore: Number(value.local?.score) || 0,
      remoteScore: Number(value.remote?.score) || 0,
      localFingerprint: shortFingerprint(value.local?.fingerprint),
      remoteFingerprint: shortFingerprint(value.remote?.fingerprint)
    });
  }

  function formatTime(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '未知';
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? '—');
  }

  function render(value) {
    const view = publicStatus(value) || {};
    setText('cloudSyncEmail', view.userEmail || '—');
    setText('cloudSyncLocalTime', view.localUpdatedAt ? formatTime(view.localUpdatedAt) : '未知');
    setText('cloudSyncRemoteTime', view.remoteUpdatedAt ? formatTime(view.remoteUpdatedAt) : '尚無資料');
    setText('cloudSyncLocalScore', view.localScore ?? 0);
    setText('cloudSyncRemoteScore', view.remoteScore ?? 0);
    setText('cloudSyncState', view.code || '—');
    setText('cloudSyncMessage', view.message || '');
    setText('cloudSyncFingerprint', `本機 ${view.localFingerprint || '—'}／雲端 ${view.remoteFingerprint || '—'}`);
    const upload = document.getElementById('cloudSyncUpload');
    if (upload) upload.disabled = busy || !view.canUpload;
    const restore = document.getElementById('cloudSyncRestore');
    if (restore) restore.disabled = busy || !view.canRestore;
    renderAutoState();
  }

  function setBusy(value) {
    busy = Boolean(value);
    ['cloudSyncRefresh', 'cloudSyncRestore', 'cloudSyncUpload', 'cloudSyncClose', 'cloudSyncHeaderClose', 'cloudSyncBackdrop'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = busy;
    });
    const refresh = document.getElementById('cloudSyncRefresh');
    if (refresh) refresh.textContent = busy ? '檢查中…' : '重新檢查';
    render(currentStatus);
  }

  function failure(code) {
    return { code, message: STATUS_TEXT[code] || STATUS_TEXT.ERROR, canUpload: false, canRestore: false };
  }

  async function inspectOperation() {
    setBusy(true);
    try {
      currentStatus = await inspectCore();
    } catch (error) {
      if (!activeOperation || activeOperation.generation === syncGeneration) currentStatus = failure(error?.code || 'ERROR');
    } finally {
      setBusy(false);
    }
    return publicStatus();
  }

  async function remoteObservation(row) {
    const info = await remoteInfo(row);
    return { updatedAt: String(row?.updated_at || ''), fingerprint: String(info?.fingerprint || '') };
  }

  function sameObservation(left, right) {
    return left.updatedAt === right.updatedAt && left.fingerprint === right.fingerprint;
  }

  async function restorePreflight() {
    const auth = await authContext();
    const local = await readLocal();
    const row = await readRemote(auth);
    const remote = await remoteInfo(row);
    return { status: classify(auth, local, remote, row), row };
  }

  function restoreConfirmation(preflight) {
    return window.confirm([
      '確定要以雲端備份取代此瀏覽器目前 ERP 資料嗎？',
      `本機更新時間：${formatTime(preflight.local?.time?.raw)}`,
      `雲端更新時間：${formatTime(preflight.remote?.time?.raw || preflight.remoteUpdatedAt)}`,
      `本機資料筆數：${preflight.local?.score || 0}`,
      `雲端資料筆數：${preflight.remote?.score || 0}`,
      `本機 fingerprint：${shortFingerprint(preflight.local?.fingerprint)}`,
      `雲端 fingerprint：${shortFingerprint(preflight.remote?.fingerprint)}`
    ].join('\n'));
  }

  function backupFileName() {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    return `KusheERP_pre_cloud_restore_${stamp}.json`;
  }

  function downloadLocalBackup(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    queueMicrotask(() => URL.revokeObjectURL(url));
    return link.download;
  }

  function restoreRemote() { return coordinate('restore', restoreOperation); }

  async function restoreOperation() {
    let restoreCommitted = false, restoreSource = false;
    setBusy(true);

    try {
      const { status: preflight, row } = await restorePreflight();
      currentStatus = preflight;
      render(currentStatus);
      if (!preflight.canRestore || !['REMOTE_NEWER', 'LOCAL_EMPTY_REMOTE_EXISTS'].includes(preflight.code)) {
        currentStatus = failure('RESTORE_BLOCKED');
        return publicStatus();
      }

      const target = await validateRemoteSnapshot(row?.data, row?.updated_at);
      if (target.fingerprint !== preflight.remote?.fingerprint || !restoreConfirmation(preflight)) {
        currentStatus = target.fingerprint === preflight.remote?.fingerprint
          ? { ...preflight, code: 'RESTORE_CANCELLED', message: STATUS_TEXT.RESTORE_CANCELLED, canUpload: false, canRestore: true }
          : failure('RESTORE_BLOCKED');
        return publicStatus();
      }

      if (preflight.local.score > 0) {
        downloadLocalBackup(preflight.local.data);
        const backupConfirmed = window.confirm('已產生目前本機資料備份檔。請確認瀏覽器已完成下載，再按確定繼續雲端還原。');
        if (!backupConfirmed) {
          currentStatus = { ...preflight, code: 'RESTORE_CANCELLED', message: STATUS_TEXT.RESTORE_CANCELLED, canUpload: false, canRestore: true };
          return publicStatus();
        }
      }

      const expected = { updatedAt: String(row?.updated_at || ''), fingerprint: target.fingerprint };
      const raceRow = await readRemote(await revalidatePrincipal(preflight.auth));
      const actual = await remoteObservation(raceRow);
      if (!sameObservation(expected, actual)) {
        currentStatus = failure('RESTORE_RACE_BLOCKED');
        return publicStatus();
      }
      const raceTarget = await validateRemoteSnapshot(raceRow?.data, raceRow?.updated_at);
      if (raceTarget.fingerprint !== target.fingerprint) {
        currentStatus = failure('RESTORE_RACE_BLOCKED');
        return publicStatus();
      }

      const store = window.KuSheERPStore;
      if(!store?.replaceSnapshot)throw new CloudSyncError('RESTORE_BLOCKED');
      const currentAuth=await revalidatePrincipal(preflight.auth);
      // Suspend echo/polling and fence the old baseline before replacing local state.
      stopCloudEvents(); pauseAutoForConflict(); invalidateApplyBaseline();
      setSyncOrigin('REMOTE_APPLY'); restoreSource = true;
      const committed=await store.replaceSnapshot(raceTarget.data,{confirmed:true,baseline:preflight.local.storeBaseline});
      restoreCommitted = ['COMMITTED','COMMITTED_WITH_NOTIFICATION_WARNING'].includes(committed.status);
      if (!restoreCommitted) throw new CloudSyncError('RESTORE_BLOCKED');
      const durable = await store.remoteApplyReadiness();
      if (!durable.safe) throw new CloudSyncError('VERIFY_FAILED');
      const local = await snapshotInfo(durable.data);
      const handoffAuth = await revalidatePrincipal(currentAuth);
      assertOperation(currentAuth);
      const latestRow = await readRemote(handoffAuth);
      const latest = await remoteObservation(latestRow);
      if (!latestRow || !sameSyncVersion(latestRow.sync_version, raceRow.sync_version)
        || !sameObservation(await remoteObservation(raceRow), latest)) throw new CloudSyncError('RESTORE_RACE_BLOCKED');
      const saved = await writeBaseline(currentAuth, raceRow, local.fingerprint, async () => {
        const verified = await store.remoteApplyReadiness(durable.baseline);
        assertOperation(currentAuth);
        return Boolean(verified.safe);
      });
      if (!saved) throw new CloudSyncError('VERIFY_FAILED');
      autoArmed = true;
      if (!autoStarted) { autoStarted = true; autoGeneration += 1; ensureAutoListeners(); }
      setAutoState('ARMED', { pending: false, armed: true });
      setSyncOrigin('USER_LOCAL_EDIT'); restoreSource = false;
      startCloudEvents();

      currentStatus = classified('RESTORE_COMPLETE', currentAuth, local, raceTarget, raceRow, false, false);
      if(committed.status==='COMMITTED_WITH_NOTIFICATION_WARNING'){
        currentStatus.message='資料已儲存，但畫面更新／通知失敗，請勿重複送出。請自行重新載入。';
        render(currentStatus);return publicStatus();
      }
      render(currentStatus);
      window.requestAnimationFrame(() => window.location.reload());
      return publicStatus();
    } catch (error) {
      if (restoreCommitted) {
        autoArmed = false;
        try { invalidateApplyBaseline(); } catch (_) {}
        setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
        currentStatus = failure('RESTORE_HANDOFF_BLOCKED');
        return publicStatus();
      }
      const code=error?.transactionStatus==='RECOVERY_REQUIRED'?'RESTORE_CRITICAL_FAILURE':error?.transactionStatus==='ROLLED_BACK'?'RESTORE_VERIFY_FAILED':error?.code==='STALE_STORE_STATE'?'RESTORE_RACE_BLOCKED':error?.code==='SECRET_BLOCKED'?'RESTORE_BLOCKED':(error?.code||'RESTORE_BLOCKED');
      currentStatus=failure(code);
      return publicStatus();
    } finally {
      if (restoreSource) setSyncOrigin('USER_LOCAL_EDIT');
      setBusy(false);
    }
  }

  async function uploadOperation() {
    setBusy(true);
    try {
      const preflight = await inspectCore();
      currentStatus = preflight;
      render(currentStatus);
      if (!preflight.canUpload || !['REMOTE_EMPTY', 'LOCAL_NEWER'].includes(preflight.code)) return publicStatus();
      const expectedSyncVersion = preflight.remoteExists ? serverSyncVersion(preflight.syncVersion) : null;

      const approved = window.confirm([
        '確定要以此裝置目前 ERP 資料更新雲端備份嗎？',
        `本機更新時間：${formatTime(preflight.local?.time?.raw)}`,
        `雲端更新時間：${preflight.remote?.time?.raw ? formatTime(preflight.remote.time.raw) : '尚無資料'}`,
        `本機資料筆數：${preflight.local.score}`,
        `雲端資料筆數：${preflight.remote?.score || 0}`
      ].join('\n'));
      if (!approved) {
        currentStatus = { ...preflight, code: 'CANCELLED', message: STATUS_TEXT.CANCELLED, canUpload: true };
        return publicStatus();
      }

      const expected = await remoteObservation(preflight.remote ? { data: preflight.remote.data, updated_at: preflight.remoteUpdatedAt } : null);
      const raceRow = await readRemote(await revalidatePrincipal(preflight.auth));
      const actual = await remoteObservation(raceRow);
      if (!sameObservation(expected, actual) || !sameSyncVersion(expectedSyncVersion, remoteWriteState(raceRow).syncVersion)) {
        currentStatus = failure('RACE_BLOCKED');
        return publicStatus();
      }

      const currentLocal=await readLocal();
      if(currentLocal.storeBaseline!==preflight.local.storeBaseline)throw new CloudSyncError('RACE_BLOCKED');
      const currentAuth=await revalidatePrincipal(preflight.auth);
      const applied = await casWrite(currentAuth, expectedSyncVersion, preflight.local.data);
      if (applied.status === 'CONFLICT') {
        pauseAutoForConflict();
        currentStatus = failure('RACE_BLOCKED');
        return publicStatus();
      }

      const verifiedRow = await readRemote(currentAuth);
      const verified = await remoteInfo(verifiedRow);
      if (!verified || verified.fingerprint !== preflight.local.fingerprint || !matchesAppliedVersion(verifiedRow, applied)) {
        currentStatus = failure('VERIFY_FAILED');
        return publicStatus();
      }
      currentStatus = classified('UPLOAD_COMPLETE', currentAuth, preflight.local, verified, verifiedRow, false);
      await armAutoBackup(currentAuth, verifiedRow, preflight.local.fingerprint, 'ARMED');
      return publicStatus();
    } catch (error) {
      if (!activeOperation || activeOperation.generation === syncGeneration) currentStatus = failure(writeFailureCode(error));
      return publicStatus();
    } finally {
      setBusy(false);
    }
  }

  function autoStatus() {
    return deepClone(autoState);
  }

  function renderAutoState() {
    setText('cloudSyncAutoState', autoState.message || AUTO_STATUS_TEXT[autoState.code] || '—');
  }

  function setAutoState(code, options = {}) {
    if (activeOperation && activeOperation.generation !== syncGeneration) return autoStatus();
    autoState = {
      code,
      userId: principalId || '',
      message: options.message || AUTO_STATUS_TEXT[code] || AUTO_STATUS_TEXT.STOPPED,
      pending: Boolean(options.pending),
      armed: Boolean(options.armed ?? autoArmed)
    };
    renderAutoState();
    return autoStatus();
  }

  function isNetworkFailure(error) {
    return error?.name === 'TypeError' || error?.name === 'NetworkError';
  }

  function clearAutoTimer() {
    if (autoTimer !== null) window.clearTimeout(autoTimer);
    autoTimer = null;
  }

  function clearOnlineTimer() {
    if (autoOnlineTimer !== null) window.clearTimeout(autoOnlineTimer);
    autoOnlineTimer = null;
  }

  function ensureAutoListeners() {
    window.removeEventListener('kushe:data-updated', handleDataUpdated);
    window.removeEventListener('online', handleOnline);
    window.addEventListener('kushe:data-updated', handleDataUpdated);
    window.addEventListener('online', handleOnline);
  }

  function activeAutoRun(generation) {
    observePrincipal();
    return autoStarted && generation === autoGeneration;
  }

  function scheduleAutoBackup(delay = AUTO_DEBOUNCE_MS) {
    observePrincipal();
    if (!autoStarted || !autoArmed || syncOrigin === 'REMOTE_APPLY') return false;
    clearAutoTimer();
    setAutoState('WAITING', { pending: true, armed: true });
    const generation = autoGeneration;
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      if (activeAutoRun(generation)) void autoBackupNow();
    }, delay);
    return true;
  }

  function handleDataUpdated(event) {
    observePrincipal();
    if (syncOrigin === 'REMOTE_APPLY' || event?.detail?.syncOrigin === 'REMOTE_APPLY') {
      clearAutoTimer();
      clearOnlineTimer();
      return;
    }
    if (autoStarted && autoArmed) scheduleAutoBackup();
  }

  function handleOnline() {
    observePrincipal();
    if (syncOrigin === 'REMOTE_APPLY') return;
    if (!autoStarted || autoState.code !== 'WAITING_NETWORK' || !autoState.pending) return;
    clearOnlineTimer();
    const generation = autoGeneration;
    const retryMode = autoRetryMode;
    autoOnlineTimer = window.setTimeout(() => {
      autoOnlineTimer = null;
      if (!activeAutoRun(generation)) return;
      if (retryMode === 'verify') void verifyPendingAutoUpload(generation);
      else if (retryMode === 'upload') void autoBackupNow();
      else void evaluateAutoStart(generation);
    }, AUTO_ONLINE_RETRY_MS);
  }

  function baselineMatchesRemote(baseline, row, remote) {
    return Boolean(baseline && row && remote)
      && baseline.remoteUpdatedAt === String(row.updated_at || '')
      && sameSyncVersion(baseline.syncVersion, remoteWriteState(row).syncVersion)
      && baseline.remoteFingerprint === remote.fingerprint;
  }

  async function armAutoBackup(auth, row, localFingerprint, code = 'ARMED') {
    const saved = await writeBaseline(auth, row, localFingerprint);
    assertOperation(auth);
    if (!saved) {
      autoArmed = false;
      return setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
    }
    if (!autoStarted) {
      autoStarted = true;
      autoGeneration += 1;
      ensureAutoListeners();
    }
    autoArmed = true;
    autoRetryMode = '';
    autoPendingVerification = null;
    return setAutoState(code, { pending: Boolean(autoTimer), armed: true });
  }

  async function recoverSameStateBaseline(checked, generation) {
    const { auth, local, remote } = checked, store = window.KuSheERPStore;
    const editor = editorReadiness();
    const allowed = () => activeAutoRun(generation) && syncOrigin !== 'REMOTE_APPLY'
      && observedPrincipal() === auth.user.id && editorReadiness().safe
      && editorReadiness().generation === editor.generation
      && window.localStorage.getItem(AUTO_BASELINE_KEY) === null
      && window.localStorage.getItem(AUTO_APPLY_PENDING_KEY) === null;
    if (!editor.safe || !allowed() || !checked.remoteExists || !local?.score || !remote?.score
      || local.fingerprint !== remote.fingerprint || serverSyncVersion(checked.syncVersion) === null
      || !Number.isFinite(Date.parse(checked.remoteUpdatedAt))) return false;
    const ready = await store?.remoteApplyReadiness?.(local.storeBaseline);
    if (!ready?.safe || !allowed()) return false;
    const committed = await snapshotInfo(ready.data);
    if (committed.fingerprint !== local.fingerprint) return false;
    const row = await readRemote(auth);
    if (!row || !sameSyncVersion(row.sync_version, checked.syncVersion) || row.updated_at !== checked.remoteUpdatedAt) return false;
    const accepted = await validateRemoteSnapshot(row.data, row.updated_at);
    if (accepted.fingerprint !== committed.fingerprint || !allowed()) return false;
    const saved = await writeBaseline(auth, row, committed.fingerprint, async () => {
      const final = await store.remoteApplyReadiness(ready.baseline);
      return Boolean(final.safe && allowed());
    });
    if (!saved) return false;
    autoArmed = true;
    autoRetryMode = ''; autoPendingVerification = null;
    setAutoState('ARMED', { pending: false, armed: true });
    return true;
  }

  function legacyRestoreEquivalent(local, remote) {
    const audit = local?.audit?.[0], revision = audit?.sourceBusinessRevision;
    if (!isPlainObject(local?.meta) || !isPlainObject(remote?.meta)
      || !Array.isArray(local.audit) || !Array.isArray(remote.audit)
      || audit?.action !== '使用者確認雲端快照還原' || !isPlainObject(revision)
      || !Number.isSafeInteger(revision.sequence) || revision.sequence <= 0
      || !['id', 'operationId', 'committedAt'].every(key => typeof revision[key] === 'string' && revision[key])
      || typeof revision.parentId !== 'string' || !Number.isFinite(Date.parse(revision.committedAt))
      || JSON.stringify(canonicalize(revision)) !== JSON.stringify(canonicalize(remote.meta.businessSnapshotRevision))) return false;
    // Compare every field; only the proven restore commit's provenance is excluded.
    const left = deepClone(local), right = deepClone(remote);
    left.audit.shift();
    for (const value of [left, right]) {
      delete value.meta.updatedAt;
      delete value.meta.businessSnapshotRevision;
      delete value.meta.receiptCommitVersion;
    }
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
  }

  async function recoverLegacyRestoreBaseline(checked, generation) {
    const { auth, local, remote } = checked, store = window.KuSheERPStore;
    const editor = editorReadiness();
    const allowed = () => activeAutoRun(generation) && syncOrigin !== 'REMOTE_APPLY'
      && observedPrincipal() === auth.user.id && editorReadiness().safe
      && editorReadiness().generation === editor.generation
      && window.localStorage.getItem(AUTO_BASELINE_KEY) === null
      && window.localStorage.getItem(AUTO_APPLY_PENDING_KEY) === null;
    if (!editor.safe || !allowed() || !checked.remoteExists || !local?.score || !remote?.score
      || serverSyncVersion(checked.syncVersion) === null
      || !Number.isFinite(Date.parse(checked.remoteUpdatedAt))) return false;
    const ready = await store?.remoteApplyReadiness?.(local.storeBaseline);
    if (!ready?.safe || !allowed() || !legacyRestoreEquivalent(ready.data, remote.data)) return false;
    const committed = await snapshotInfo(ready.data);
    if (committed.fingerprint !== local.fingerprint) return false;
    const row = await readRemote(await revalidatePrincipal(auth));
    if (!row || !sameSyncVersion(row.sync_version, checked.syncVersion) || row.updated_at !== checked.remoteUpdatedAt) return false;
    const accepted = await validateRemoteSnapshot(row.data, row.updated_at);
    if (accepted.fingerprint !== remote.fingerprint || !legacyRestoreEquivalent(ready.data, row.data) || !allowed()) return false;
    const saved = await writeBaseline(auth, row, committed.fingerprint, async () => {
      const final = await store.remoteApplyReadiness(ready.baseline);
      return Boolean(final.safe && allowed());
    });
    if (!saved) return false;
    autoArmed = true;
    autoRetryMode = ''; autoPendingVerification = null;
    currentStatus = classified('SYNCED', auth, committed, accepted, row, false, false);
    setAutoState('ARMED', { pending: false, armed: true });
    return true;
  }

  function legacyBusinessProjection(value) {
    const snapshot=sanitizeCloudSnapshot(value);
    if(snapshot.meta)delete snapshot.meta.businessSnapshotRevision;
    return snapshot;
  }

  async function recoverEquivalentLegacyCloudBaseline(checked, generation) {
    const {auth,local,remote}=checked,store=window.KuSheERPStore,editor=editorReadiness();
    const allowed=()=>activeAutoRun(generation)&&syncOrigin!=='REMOTE_APPLY'
      &&observedPrincipal()===auth.user.id&&editorReadiness().safe
      &&editorReadiness().generation===editor.generation
      &&window.localStorage.getItem(AUTO_BASELINE_KEY)===null
      &&window.localStorage.getItem(AUTO_APPLY_PENDING_KEY)===null;
    const legacyRemote=value=>isPlainObject(value?.meta)&&!Object.prototype.hasOwnProperty.call(value.meta,'businessSnapshotRevision');
    if(!editor.safe||!allowed()||!checked.remoteExists||!local?.score||local.score!==remote?.score
      ||!legacyRemote(remote.data)||typeof local.data?.meta?.updatedAt!=='string'
      ||local.data.meta.updatedAt!==remote.data.meta.updatedAt
      ||serverSyncVersion(checked.syncVersion)===null||!Number.isFinite(Date.parse(checked.remoteUpdatedAt)))return false;
    const proof=await store?.legacyBootstrapEvidence?.(local.storeBaseline);
    if(!proof?.safe||!allowed()||proof.legacyBusinessUpdatedAt!==local.data.meta.updatedAt
      ||JSON.stringify(canonicalize(local.data.meta.businessSnapshotRevision))!==JSON.stringify(canonicalize(proof.revision)))return false;
    const ready=await store.remoteApplyReadiness(proof.baseline);
    if(!ready.safe||!allowed())return false;
    const committed=await snapshotInfo(ready.data);
    if(committed.fingerprint!==local.fingerprint
      ||await fingerprint(legacyBusinessProjection(committed.data))!==await fingerprint(legacyBusinessProjection(remote.data)))return false;
    const row=await readRemote(await revalidatePrincipal(auth));
    if(!row||!sameSyncVersion(row.sync_version,checked.syncVersion)||row.updated_at!==checked.remoteUpdatedAt||!legacyRemote(row.data))return false;
    const accepted=await validateRemoteSnapshot(row.data,row.updated_at);
    if(accepted.fingerprint!==remote.fingerprint||!allowed())return false;
    const saved=await writeBaseline(auth,row,committed.fingerprint,async()=>{
      const latest=await readRemote(await revalidatePrincipal(auth));
      if(!latest||!sameSyncVersion(latest.sync_version,row.sync_version)||latest.updated_at!==row.updated_at)return false;
      const latestInfo=await validateRemoteSnapshot(latest.data,latest.updated_at);
      if(latestInfo.fingerprint!==accepted.fingerprint)return false;
      const finalProof=await store.legacyBootstrapEvidence(proof.baseline);
      if(!finalProof.safe||finalProof.operationId!==proof.operationId||!allowed())return false;
      const final=await store.remoteApplyReadiness(proof.baseline);
      if(!final.safe)return false;
      const finalInfo=await snapshotInfo(final.data);
      return finalInfo.fingerprint===committed.fingerprint&&allowed();
    });
    if(!saved)return false;
    autoArmed=true;autoRetryMode='';autoPendingVerification=null;
    currentStatus=classified('SYNCED',auth,committed,accepted,row,false,false);
    setAutoState('ARMED',{pending:false,armed:true});
    return true;
  }

  async function evaluateAutoStartOperation(generation) {
    try {
      const checked = await inspectCore();
      if (!activeAutoRun(generation)) return autoStatus();
      if (!readBaseline(checked.auth.user.id)) {
        if (await recoverSameStateBaseline(checked, generation)) return autoStatus();
        if (await recoverLegacyRestoreBaseline(checked, generation)) return autoStatus();
        if (await recoverEquivalentLegacyCloudBaseline(checked, generation)) return autoStatus();
        autoArmed = false;
        return setAutoState('PRINCIPAL_UNBOUND', { pending: false, armed: false });
      }
      if (checked.code === 'SYNCED') {
        await armAutoBackup(checked.auth, { data: checked.remote.data, updated_at: checked.remoteUpdatedAt, sync_version: checked.syncVersion }, checked.local.fingerprint, 'ARMED');
        return autoStatus();
      }
      if (checked.code === 'LOCAL_NEWER') {
        const baseline = readBaseline(checked.auth.user.id);
        const row = { data: checked.remote.data, updated_at: checked.remoteUpdatedAt, sync_version: checked.syncVersion };
        if (baselineMatchesRemote(baseline, row, checked.remote)
          && checked.local.fingerprint !== baseline.localFingerprint) {
          autoArmed = true;
          scheduleAutoBackup();
          return autoStatus();
        }
        autoArmed = false;
        return setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
      }
      autoArmed = false;
      if (checked.code === 'REMOTE_EMPTY') return setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
      return setAutoState('CONFLICT', { pending: false, armed: false });
    } catch (error) {
      if (!activeAutoRun(generation) || error?.name === 'AbortError') return autoStatus();
      autoArmed = false;
      if (writeFailureCode(error) === 'AUTH_REQUIRED') return setAutoState('AUTH_REQUIRED', { pending: false, armed: false });
      if (['SERVER_ERROR', 'CAS_RESPONSE_INVALID'].includes(writeFailureCode(error))) return setAutoState('SERVER_ERROR', { pending: false, armed: false });
      if (error?.code === 'SECRET_BLOCKED') return setAutoState('SECRET_BLOCKED', { pending: false, armed: false });
      if (isNetworkFailure(error)) {
        autoRetryMode = 'start';
        return setAutoState('WAITING_NETWORK', { pending: true, armed: false });
      }
      return setAutoState('CONFLICT', { pending: false, armed: false });
    }
  }

  async function verifyPendingAutoUploadOperation(generation) {
    const pending = autoPendingVerification;
    if (!pending || !activeAutoRun(generation)) return autoStatus();
    try {
      const auth = await authContext();
      if (!activeAutoRun(generation) || auth.user.id !== pending.userId) throw new CloudSyncError('AUTH_REQUIRED');
      const row = await readRemote(auth);
      const remote = await remoteInfo(row);
      if (!remote || remote.fingerprint !== pending.localFingerprint || !matchesAppliedVersion(row, pending)) {
        autoArmed = false;
        autoPendingVerification = null;
        return setAutoState('CONFLICT', { pending: false, armed: false });
      }
      await armAutoBackup(auth, row, pending.localFingerprint, 'AUTO_SYNCED');
      return autoStatus();
    } catch (error) {
      if (!activeAutoRun(generation)) return autoStatus();
      if (isNetworkFailure(error)) {
        autoRetryMode = 'verify';
        return setAutoState('WAITING_NETWORK', { pending: true, armed: true });
      }
      autoArmed = false;
      const code = writeFailureCode(error);
      return setAutoState(code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : ['SERVER_ERROR', 'CAS_RESPONSE_INVALID'].includes(code) ? 'SERVER_ERROR' : 'CONFLICT', { pending: false, armed: false });
    }
  }

  async function autoBackupOperation() {
    if (!autoStarted || !autoArmed || syncOrigin === 'REMOTE_APPLY') return autoStatus();
    if (autoRunning || busy) {
      scheduleAutoBackup();
      return autoStatus();
    }
    clearAutoTimer();
    autoRunning = true;
    const generation = autoGeneration;
    autoController = new AbortController();
    setAutoState('SYNCING', { pending: true, armed: true });
    try {
      const auth = await authContext();
      if (!activeAutoRun(generation)) return autoStatus();
      const local = await readLocal();
      if (!activeAutoRun(generation)) return autoStatus();
      if (local.score <= 0) {
        autoArmed = false;
        return setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
      }
      const baseline = readBaseline(auth.user.id);
      if (!baseline) {
        autoArmed = false;
        return setAutoState('MANUAL_REQUIRED', { pending: false, armed: false });
      }

      const firstRow = await readRemote(auth, { signal: autoController.signal });
      const firstRemote = await remoteInfo(firstRow);
      if (!activeAutoRun(generation)) return autoStatus();
      if (!baselineMatchesRemote(baseline, firstRow, firstRemote)) {
        autoArmed = false;
        return setAutoState('CONFLICT', { pending: false, armed: false });
      }
      if (local.fingerprint === baseline.localFingerprint) {
        return setAutoState('ARMED', { pending: false, armed: true });
      }

      const firstObservation = { updatedAt: String(firstRow.updated_at || ''), fingerprint: firstRemote.fingerprint };
      const raceRow = await readRemote(auth, { signal: autoController.signal });
      const raceRemote = await remoteInfo(raceRow);
      const raceObservation = { updatedAt: String(raceRow?.updated_at || ''), fingerprint: String(raceRemote?.fingerprint || '') };
      if (!activeAutoRun(generation)) return autoStatus();
      if (!sameObservation(firstObservation, raceObservation) || !baselineMatchesRemote(baseline, raceRow, raceRemote)) {
        autoArmed = false;
        return setAutoState('RACE_BLOCKED', { pending: false, armed: false });
      }

      const currentLocal=await readLocal();
      if(currentLocal.storeBaseline!==local.storeBaseline)throw new CloudSyncError('RACE_BLOCKED');
      const applied = await casWrite(auth, remoteWriteState(raceRow).syncVersion, local.data, { signal: autoController.signal });
      if (applied.status === 'CONFLICT') return pauseAutoForConflict();
      autoPendingVerification = { userId: auth.user.id, localFingerprint: local.fingerprint, syncVersion: applied.syncVersion, updatedAt: applied.updatedAt };
      if (!activeAutoRun(generation)) return autoStatus();

      const verifiedRow = await readRemote(auth, { signal: autoController.signal });
      const verified = await remoteInfo(verifiedRow);
      if (!verified || verified.fingerprint !== local.fingerprint || !matchesAppliedVersion(verifiedRow, applied)) {
        autoArmed = false;
        autoPendingVerification = null;
        return setAutoState('CONFLICT', { pending: false, armed: false });
      }
      const queued = autoTimer !== null;
      await armAutoBackup(auth, verifiedRow, local.fingerprint, queued ? 'WAITING' : 'AUTO_SYNCED');
      if (queued) setAutoState('WAITING', { pending: true, armed: true });
      return autoStatus();
    } catch (error) {
      if (!activeAutoRun(generation) || error?.name === 'AbortError') return autoStatus();
      if (writeFailureCode(error) === 'AUTH_REQUIRED') {
        autoArmed = false;
        return setAutoState('AUTH_REQUIRED', { pending: false, armed: false });
      }
      if (['SERVER_ERROR', 'CAS_RESPONSE_INVALID'].includes(writeFailureCode(error))) {
        autoArmed = false;
        return setAutoState('SERVER_ERROR', { pending: false, armed: false });
      }
      if (error?.code === 'SECRET_BLOCKED') {
        autoArmed = false;
        return setAutoState('SECRET_BLOCKED', { pending: false, armed: false });
      }
      if (isNetworkFailure(error)) {
        autoRetryMode = autoPendingVerification ? 'verify' : 'upload';
        return setAutoState('WAITING_NETWORK', { pending: true, armed: true });
      }
      autoArmed = false;
      return setAutoState('CONFLICT', { pending: false, armed: false });
    } finally {
      autoRunning = false;
      autoController = null;
    }
  }

  async function startAutoBackup() {
    observePrincipal();
    startCloudEvents();
    if (autoStarted) return coordinate('start', () => autoStatus());
    clearAutoTimer();
    clearOnlineTimer();
    autoStarted = true;
    autoGeneration += 1;
    ensureAutoListeners();
    setAutoState('CHECKING', { pending: false, armed: false });
    return evaluateAutoStart(autoGeneration);
  }

  function stopAutoBackup() {
    stopCloudEvents();
    syncGeneration += 1;
    // Stopping a session does not forget its verified, principal-bound baseline.
    principalId = null;
    requestControllers.forEach(controller => controller.abort());
    requestControllers.clear();
    currentStatus = null;
    syncOrigin = 'USER_LOCAL_EDIT';
    autoStarted = false;
    autoArmed = false;
    autoGeneration += 1;
    clearAutoTimer();
    clearOnlineTimer();
    autoController?.abort();
    autoController = null;
    autoRetryMode = '';
    autoPendingVerification = null;
    window.removeEventListener('kushe:data-updated', handleDataUpdated);
    window.removeEventListener('online', handleOnline);
    autoState = { code: 'STOPPED', message: AUTO_STATUS_TEXT.STOPPED, userId: principalId || '', pending: false, armed: false };
    renderAutoState();
    return autoStatus();
  }

  function ensureUi() {
    if (uiBound) return;
    uiBound = true;
    document.getElementById('cloudSyncRefresh')?.addEventListener('click', () => { void inspect(); });
    document.getElementById('cloudSyncRestore')?.addEventListener('click', () => { void restoreRemote(); });
    document.getElementById('cloudSyncUpload')?.addEventListener('click', () => { void uploadLocal(); });
    document.getElementById('cloudSyncClose')?.addEventListener('click', close);
    document.getElementById('cloudSyncHeaderClose')?.addEventListener('click', close);
    document.getElementById('cloudSyncBackdrop')?.addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById('cloudSyncModal')?.hidden) close();
    });
  }

  function open() {
    ensureUi();
    const modal = document.getElementById('cloudSyncModal');
    if (!modal) return false;
    modal.hidden = false;
    currentStatus = { code: 'CHECKING', message: '正在檢查本機與雲端資料…', canUpload: false, canRestore: false };
    render(currentStatus);
    void inspect();
    return true;
  }

  function close() {
    if (busy) return false;
    const modal = document.getElementById('cloudSyncModal');
    if (modal) modal.hidden = true;
    return true;
  }

  window.KusheCloudSync = Object.freeze({
    inspect, uploadLocal, restoreRemote, status: publicStatus, open, close,
    startAutoBackup, stopAutoBackup, autoStatus, setSyncOrigin, editorReadiness, decideRemote, safeApplyRemote, reconcileFromCloud
  });
}());
