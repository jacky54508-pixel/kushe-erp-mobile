/* P29-1: presentation only. Keep existing controls, calculations and submit handlers. */
(() => {
  'use strict';
  const root = document.getElementById('commissionsApp');
  if (!root) return;
  const selector = '.daily-compact .daily-pay-details';
  const initialized = new WeakSet();
  let panelSequence = 0;

  function enhance(details) {
    if (initialized.has(details) || !root.contains(details)) return;
    const form = details.closest('#dailyWorkForm');
    const summary = details.querySelector(':scope > summary');
    const panel = details.querySelector(':scope > .daily-pay-details-body');
    const label = summary?.querySelector('em');
    if (!form || !summary || !panel || !label) return;
    initialized.add(details);
    details.classList.add('daily-pay-refined');
    if (!panel.id) panel.id = `dailyPayControls-${++panelSequence}`;
    summary.setAttribute('aria-controls', panel.id);

    // Set the initial view once, after the original synchronous drawer render.
    // Never close a panel that already contains focus or a validation error.
    if (!panel.contains(document.activeElement) && !panel.querySelector('[aria-invalid="true"]')) {
      details.open = false;
    }
    function syncSummary() {
      const text = details.open ? '收合設定' : '調整設定';
      if (label.textContent !== text) label.textContent = text;
      summary.setAttribute('aria-expanded', String(details.open));
      const description = summary.querySelector('#dailyPaySummary');
      if (description) description.title = description.textContent || '';
    }
    details.addEventListener('toggle', syncSummary);
    syncSummary();

    // The original work-only handler opens the panel. Preserve the user's
    // current disclosure choice without changing that handler or any field.
    const disclosureBeforeChange = new WeakMap();
    const isEntryMode = event => event.target instanceof HTMLInputElement &&
      event.target.name === 'entryMode' && event.target.type === 'radio';
    form.addEventListener('change', event => {
      if (isEntryMode(event)) disclosureBeforeChange.set(event, details.open);
    }, true);
    form.addEventListener('change', event => {
      if (isEntryMode(event) && disclosureBeforeChange.has(event) &&
          !panel.contains(document.activeElement) && !panel.querySelector('[aria-invalid="true"]')) {
        details.open = disclosureBeforeChange.get(event);
      }
      syncSummary();
    });
    form.addEventListener('input', syncSummary);
    // Native constraint validation must still reveal and focus hidden fields.
    form.addEventListener('invalid', event => {
      if (panel.contains(event.target)) {
        details.open = true;
        syncSummary();
      }
    }, true);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(selector)) enhance(node);
    node.querySelectorAll(selector).forEach(enhance);
  }
  scan(root);
  // Observe only the attendance/commission host, not the whole ERP or data store.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(root, {childList: true, subtree: true});
})();
