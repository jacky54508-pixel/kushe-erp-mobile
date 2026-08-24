(function () {
  'use strict';

  const config = window.KUSHE_PHASE1_CONFIG || {};
  const BUSINESS_COLLECTIONS = [
    'customers', 'projects', 'vendors', 'materials', 'employees', 'banks', 'quotations',
    'dailyLogs', 'attendance', 'commissions', 'billings', 'receivables', 'payables',
    'invoices', 'payments', 'salaryPayments', 'payroll', 'bankTransactions'
  ];
  const SETTINGS_CREDENTIAL_KEYS = new Set([
    'username', 'password', 'loginusername', 'loginpassword', 'cloudurl',
    'cloudpublishablekey', 'supabaseurl', 'supabasepublishablekey',
    'servicerolekey', 'secretkey', 'jwtsecret'
  ]);
  const TOP_LEVEL_AUTH_KEYS = new Set(['accesstoken', 'refreshtoken', 'session', 'authsession']);
  const SECRET_KEYS = new Set(['password', 'secret', 'servicerole', 'accesstoken', 'refreshtoken', 'jwtsecret']);
  const STATUS_TEXT = {
    AUTH_REQUIRED: '登入狀態已失效，請重新登入。',
    REMOTE_EMPTY: '雲端尚無資料，可手動上傳本機備份。',
    SYNCED: '本機與雲端一致。',
    LOCAL_NEWER: '本機資料較新，可手動同步至雲端。',
    REMOTE_NEWER: '雲端資料較新／可能有衝突。請進入 CLOUD-P2 安全還原流程。',
    LOCAL_EMPTY_REMOTE_EXISTS: '本機資料為空，禁止覆蓋既有雲端資料。',
    UNKNOWN_CONFLICT: '資料版本無法安全判定，已停止同步。',
    SECRET_BLOCKED: '偵測到未清除的憑證欄位，已停止同步。',
    RACE_BLOCKED: '雲端資料剛剛已更新，為避免覆蓋已停止同步。',
    VERIFY_FAILED: '雲端驗證失敗，請停止操作。',
    CANCELLED: '已取消上傳。',
    UPLOAD_COMPLETE: '雲端同步完成。',
    ERROR: '雲端檢查失敗，請稍後再試。'
  };

  let currentStatus = null;
  let busy = false;
  let uiBound = false;

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
    return { token: session.access_token, user: { id: String(user.id), email: String(user.email || '') } };
  }

  async function request(path, auth, options = {}) {
    const { url, key } = cloudConfig();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${auth.token}`,
      ...(options.headers || {})
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${url}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) throw new CloudSyncError('ERROR');
    if (response.status === 204) return null;
    try { return await response.json(); } catch (_) { return null; }
  }

  function remotePath(userId) {
    return `/rest/v1/erp_states?select=data%2Cupdated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  }

  async function readRemote(auth) {
    const rows = await request(remotePath(auth.user.id), auth);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function readLocal() {
    const store = window.KuSheERPStore;
    if (!store?.load || !store?.getState) throw new CloudSyncError('ERROR');
    await store.load();
    return snapshotInfo(deepClone(store.getState()));
  }

  async function remoteInfo(row) {
    return row ? snapshotInfo(row.data, row.updated_at) : null;
  }

  function classified(code, auth, local, remote, row, canUpload = false) {
    return { code, message: STATUS_TEXT[code], canUpload, auth, local, remote, remoteUpdatedAt: String(row?.updated_at || '') };
  }

  function classify(auth, local, remote, row) {
    if (!row) return classified('REMOTE_EMPTY', auth, local, null, null, local.score > 0);
    if (local.fingerprint === remote.fingerprint) return classified('SYNCED', auth, local, remote, row, false);
    if (local.score === 0 && remote.score > 0) return classified('LOCAL_EMPTY_REMOTE_EXISTS', auth, local, remote, row, false);
    if (!local.time || !remote.time) return classified('UNKNOWN_CONFLICT', auth, local, remote, row, false);
    if (remote.time.value >= local.time.value) return classified('REMOTE_NEWER', auth, local, remote, row, false);
    if (local.time.value > remote.time.value && local.score > 0) return classified('LOCAL_NEWER', auth, local, remote, row, true);
    return classified('UNKNOWN_CONFLICT', auth, local, remote, row, false);
  }

  async function inspectCore() {
    const auth = await authContext();
    const local = await readLocal();
    const row = await readRemote(auth);
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
  }

  function setBusy(value) {
    busy = Boolean(value);
    ['cloudSyncRefresh', 'cloudSyncUpload', 'cloudSyncClose', 'cloudSyncHeaderClose', 'cloudSyncBackdrop'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = busy;
    });
    const refresh = document.getElementById('cloudSyncRefresh');
    if (refresh) refresh.textContent = busy ? '檢查中…' : '重新檢查';
    render(currentStatus);
  }

  function failure(code) {
    return { code, message: STATUS_TEXT[code] || STATUS_TEXT.ERROR, canUpload: false };
  }

  async function inspect() {
    setBusy(true);
    try {
      currentStatus = await inspectCore();
    } catch (error) {
      currentStatus = failure(error?.code || 'ERROR');
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

  async function uploadLocal() {
    setBusy(true);
    try {
      const preflight = await inspectCore();
      currentStatus = preflight;
      render(currentStatus);
      if (!preflight.canUpload || !['REMOTE_EMPTY', 'LOCAL_NEWER'].includes(preflight.code)) return publicStatus();

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
      const raceRow = await readRemote(preflight.auth);
      const actual = await remoteObservation(raceRow);
      if (!sameObservation(expected, actual)) {
        currentStatus = failure('RACE_BLOCKED');
        return publicStatus();
      }

      const uploadedAt = new Date().toISOString();
      await request('/rest/v1/erp_states?on_conflict=user_id', preflight.auth, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: preflight.auth.user.id, data: preflight.local.data, updated_at: uploadedAt }
      });

      const verifiedRow = await readRemote(preflight.auth);
      const verified = await remoteInfo(verifiedRow);
      if (!verified || verified.fingerprint !== preflight.local.fingerprint) {
        currentStatus = failure('VERIFY_FAILED');
        return publicStatus();
      }
      currentStatus = classified('UPLOAD_COMPLETE', preflight.auth, preflight.local, verified, verifiedRow, false);
      return publicStatus();
    } catch (error) {
      currentStatus = failure(error?.code || 'ERROR');
      return publicStatus();
    } finally {
      setBusy(false);
    }
  }

  function ensureUi() {
    if (uiBound) return;
    uiBound = true;
    document.getElementById('cloudSyncRefresh')?.addEventListener('click', () => { void inspect(); });
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
    currentStatus = { code: 'CHECKING', message: '正在檢查本機與雲端資料…', canUpload: false };
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

  window.KusheCloudSync = Object.freeze({ inspect, uploadLocal, status: publicStatus, open, close });
}());
