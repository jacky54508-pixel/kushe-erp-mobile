(function () {
  'use strict';

  const store = window.KuSheERPStore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const credentialKeys = new Set([
    'username','password','loginusername','loginpassword','cloudurl','cloudpublishablekey',
    'supabaseurl','supabasepublishablekey','servicerolekey','secretkey','jwtsecret'
  ]);
  const topLevelAuthKeys = new Set(['accesstoken','refreshtoken','session','authsession']);
  const normalizedKey = (value) => String(value || '').replace(/[^a-z0-9]/gi,'').toLowerCase();
  let active = false;
  let ready = false;
  let busy = false;

  function state() {
    return store.getState?.() || {};
  }

  function businessStamp(value) {
    const raw = String(value || '').trim();
    if (!raw || !Number.isFinite(Date.parse(raw))) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    }).format(new Date(raw));
  }

  function safeBackupSnapshot(value) {
    const copy = JSON.parse(JSON.stringify(value || {}));
    if (copy.settings && typeof copy.settings === 'object' && !Array.isArray(copy.settings)) {
      Object.keys(copy.settings).forEach((key) => {
        if (credentialKeys.has(normalizedKey(key))) delete copy.settings[key];
      });
    }
    Object.keys(copy).forEach((key) => {
      if (topLevelAuthKeys.has(normalizedKey(key))) delete copy[key];
    });
    delete copy.localCommitToken;
    delete copy.recoveryMarker;
    delete copy.transactionJournal;
    return copy;
  }

  function backupFileName() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    }).formatToParts(new Date()).map((part) => [part.type,part.value]));
    return `KusheERP_safe_backup_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}.json`;
  }

  function input(name) {
    return $("[data-settings-field='" + name + "']");
  }

  function setBusy(value) {
    busy = Boolean(value);
    const host = $('#settingsApp');
    if (!host) return;
    host.querySelectorAll('button,input').forEach((node) => { node.disabled = busy; });
    const save = $('#settingsSave',host);
    if (save) save.textContent = busy ? '儲存中…' : '儲存公司設定';
  }

  function render() {
    if (!active) return;
    const host = $('#settingsApp');
    if (!host) return;
    const data = state(), s = data.settings || {}, user = window.KusheAuthGate?.user?.() || {};
    const auto = window.KusheCloudSync?.autoStatus?.() || {};
    const units = Array.isArray(s.quotationUnitPresets) ? s.quotationUnitPresets.filter(Boolean) : [];
    const notes = Array.isArray(s.quotationPublicNotePresets) ? s.quotationPublicNotePresets : [];
    const defaultTax = store.num(s.defaultTax) || 5;
    host.innerHTML = `
      <section class="commissions-heading settings-heading">
        <div><h1>系統設定</h1><p>管理公司基本資料、帳戶安全與備份入口。登入密碼與雲端憑證不寫入 ERP 業務設定。</p></div>
        <span class="settings-readonly-badge">最後更新 ${esc(businessStamp(data.meta?.updatedAt))}</span>
      </section>
      <section class="settings-layout">
        <article class="commission-panel settings-card settings-company">
          <header class="settings-card-head">
            <div><span class="settings-icon" aria-hidden="true"><i data-icon="building-2"></i></span><div><h2>公司資料</h2><p>套用於 ERP 公司基本資訊與後續文件資料來源。</p></div></div>
            <span class="settings-status-pill">正式設定</span>
          </header>
          <div class="settings-form-grid" role="group" aria-label="公司資料設定">
            <label><span>公司名稱</span><input data-settings-field="company" lang="zh-Hant" autocomplete="organization" value="${esc(s.company || '')}"></label>
            <label><span>統一編號</span><input data-settings-field="taxId" inputmode="numeric" autocomplete="off" value="${esc(s.taxId || '')}"></label>
            <label><span>負責人</span><input data-settings-field="owner" lang="zh-Hant" autocomplete="name" value="${esc(s.owner || '')}"></label>
            <label><span>電話</span><input data-settings-field="phone" inputmode="tel" autocomplete="tel" value="${esc(s.phone || '')}"></label>
            <label class="settings-wide"><span>地址</span><input data-settings-field="address" lang="zh-Hant" autocomplete="street-address" value="${esc(s.address || '')}"></label>
            <label><span>預設稅率（%）</span><input data-settings-field="defaultTax" type="number" min="0.01" max="100" step="0.01" inputmode="decimal" value="${esc(defaultTax)}"></label>
          </div>
          <p class="settings-tax-note">變更預設稅率不會回寫既有請款或發票；儲存前會再次確認。</p>
          <footer class="settings-actions"><button class="commission-primary" id="settingsSave" type="button">儲存公司設定</button></footer>
        </article>

        <div class="settings-side">
          <article class="commission-panel settings-card">
            <header class="settings-card-head"><div><span class="settings-icon" aria-hidden="true"><i data-icon="user-round"></i></span><div><h2>帳戶安全</h2><p>登入由 Supabase Auth 管理，不保存 ERP 登入密碼。</p></div></div></header>
            <dl class="settings-kv"><div><dt>目前登入 Email</dt><dd>${esc(user.email || '—')}</dd></div><div><dt>登入方式</dt><dd>Supabase Auth</dd></div></dl>
            <footer class="settings-actions"><button class="commission-secondary" id="settingsPassword" type="button">變更密碼</button></footer>
          </article>

          <article class="commission-panel settings-card">
            <header class="settings-card-head"><div><span class="settings-icon" aria-hidden="true"><i data-icon="arrow-down-to-line"></i></span><div><h2>同步與備份</h2><p>沿用目前安全 Cloud Sync；偵測衝突時不會強制覆蓋。</p></div></div></header>
            <dl class="settings-kv"><div><dt>自動同步</dt><dd>${esc(auto.message || '正在確認…')}</dd></div><div><dt>ERP 資料更新</dt><dd>${esc(businessStamp(data.meta?.updatedAt))}</dd></div></dl>
            <div class="settings-button-grid">
              <button class="commission-primary" id="settingsCloud" type="button">開啟雲端同步</button>
              <button class="commission-secondary" id="settingsBackup" type="button">下載安全 JSON 備份</button>
            </div>
            <p class="settings-caption">JSON 備份包含已提交的 ERP 業務資料與非敏感設定，不包含登入／雲端憑證。</p>
          </article>

          <article class="commission-panel settings-card">
            <header class="settings-card-head"><div><span class="settings-icon" aria-hidden="true"><i data-icon="file-text"></i></span><div><h2>報價預設值</h2><p>共用單位與常用對外備註由報價單模組維護。</p></div></div></header>
            <div class="settings-stats"><article><span>單位範本</span><strong>${units.length}</strong><small>筆</small></article><article><span>常用對外備註</span><strong>${notes.length}</strong><small>筆</small></article></div>
            <div class="settings-tags">${units.slice(0,8).map((unit)=>`<span>${esc(unit)}</span>`).join('') || '<span>尚無單位範本</span>'}</div>
            <footer class="settings-actions"><button class="commission-secondary" id="settingsQuotation" type="button">前往報價單管理</button></footer>
          </article>
        </div>
      </section>`;

    $('#settingsSave',host)?.addEventListener('click', save);
    $('#settingsPassword',host)?.addEventListener('click', () => document.getElementById('changePasswordButton')?.click());
    $('#settingsCloud',host)?.addEventListener('click', () => window.KusheCloudSync?.open?.());
    $('#settingsBackup',host)?.addEventListener('click', downloadBackup);
    $('#settingsQuotation',host)?.addEventListener('click', () => window.KushePhase1?.navigate?.('quotations'));
    window.KusheIcons?.render(host);
    setBusy(false);
  }

  async function save() {
    if (busy) return;
    const current = state().settings || {}, previousTax = store.num(current.defaultTax) || 5;
    const values = {
      company: input('company')?.value || '',
      taxId: input('taxId')?.value || '',
      owner: input('owner')?.value || '',
      phone: input('phone')?.value || '',
      address: input('address')?.value || '',
      defaultTax: input('defaultTax')?.value || ''
    };
    const nextTax = Number(values.defaultTax);
    if (!Number.isFinite(nextTax) || nextTax <= 0 || nextTax > 100) {
      window.KushePhase1?.toast?.('預設稅率必須大於 0 且不超過 100%。');
      input('defaultTax')?.focus();
      return;
    }
    if (Math.round(nextTax * 100) / 100 !== Math.round(previousTax * 100) / 100) {
      const confirmed = window.confirm(`確定將預設稅率由 ${previousTax}% 改為 ${Math.round(nextTax * 100) / 100}% 嗎？\n\n既有請款／發票不會被回寫；新的預設計算會使用新稅率。`);
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const result = await store.saveSystemSettings(values);
      window.KushePhase1?.toast?.(result?.changed ? '系統設定已儲存' : '設定沒有變更');
      render();
    } catch (error) {
      window.KushePhase1?.toast?.(error?.message || '系統設定儲存失敗');
      setBusy(false);
    }
  }

  async function downloadBackup() {
    if (busy) return;
    setBusy(true);
    try {
      const committed = await store.readCommittedSnapshot();
      const data = safeBackupSnapshot(committed.data);
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = backupFileName(); link.hidden = true;
      document.body.appendChild(link); link.click(); link.remove();
      queueMicrotask(() => URL.revokeObjectURL(url));
      window.KushePhase1?.toast?.('安全 JSON 備份已建立');
    } catch (error) {
      window.KushePhase1?.toast?.(error?.message || '備份建立失敗');
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    active = true;
    if (!ready) { await store.load(); ready = true; }
    render();
  }
  function deactivate() { active = false; }

  window.addEventListener('kushe:data-updated', () => { if (active) render(); });
  window.addEventListener('storage', () => { if (active) render(); });
  window.KusheSettings = Object.freeze({ activate, deactivate, render });
}());
