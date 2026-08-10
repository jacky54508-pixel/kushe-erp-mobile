(function () {
  'use strict';
  const arrays = ['banks','receivables','payables','billings','receipts','payroll','projects','customers','vendors','dailyLogs','employees','materials','attendance','quotations','commissions','invoices','materialUsages','bankTransactions'];
  const config = window.KUSHE_PHASE1_CONFIG || {};
  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const state = Object.assign({}, source);
    arrays.forEach((key) => { state[key] = Array.isArray(source[key]) ? source[key] : []; });
    return state;
  }
  function score(value) { return arrays.reduce((sum, key) => sum + (Array.isArray(value?.[key]) ? value[key].length : 0), 0); }
  function readLocal() {
    const candidates = [];
    try {
      const primary = localStorage.getItem(config.legacyStorageKey || 'KuSheERP25_EMERGENCY');
      if (primary) candidates.push({ key: config.legacyStorageKey || 'KuSheERP25_EMERGENCY', value: JSON.parse(primary), primary: true });
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || key === config.uiStorageKey || key === config.legacyStorageKey || key.startsWith('kushe_erp_dashboard')) continue;
        try { const value = JSON.parse(localStorage.getItem(key)); if (score(value) > 0) candidates.push({ key, value }); } catch (_) {}
      }
    } catch (_) {}
    return candidates.sort((a, b) => Number(b.primary) - Number(a.primary) || score(b.value) - score(a.value))[0] || null;
  }
  let state;
  let sourceInfo;
  function refresh() {
    const local = readLocal();
    if (local && score(local.value)) {
      state = normalize(local.value);
      sourceInfo = { type: 'localStorage', label: '現有正式版 ERP 即時資料（唯讀）', key: local.key, updatedAt: state.meta?.updatedAt || '' };
    } else {
      state = normalize(window.KUSHE_PHASE1_BACKUP || {});
      sourceInfo = { type: 'backup-snapshot', label: '現有 ERP 最新備份快照（唯讀）', updatedAt: state.meta?.updatedAt || '' };
    }
    return state;
  }
  refresh();
  window.KuSheLegacyData = { getState: () => state, getSourceInfo: () => Object.assign({}, sourceInfo), refresh, score };
}());
