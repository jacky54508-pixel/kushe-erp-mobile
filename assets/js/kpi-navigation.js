(function () {
  'use strict';
  // P21: presentation-only drill-downs. No storage, save, fetch, or accounting calls.
  const registry = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let current = null, generation = 0;
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && !node.closest('[hidden]'));
  function register(namespace, definition) {
    if (!/^[a-z][a-z-]*$/.test(namespace) || registry.has(namespace) || typeof definition?.read !== 'function') throw new Error('Invalid KPI registration');
    registry.set(namespace, definition);
  }
  function attrs(key, label) {
    return ` data-kpi="${esc(key)}" role="button" tabindex="0" aria-label="查看${esc(label)}對應明細" aria-expanded="false"`;
  }
  function model(key, options) {
    const [namespace, action, extra] = String(key).split('.');
    if (extra || !action) throw new Error('Invalid KPI target');
    const definition = registry.get(namespace);
    if (!definition) throw new Error('KPI target unavailable');
    const value = definition.read(action, options || {});
    if (!value || !Array.isArray(value.columns) || !Array.isArray(value.rows)) throw new Error('KPI detail unavailable');
    return value;
  }
  function focusTarget(node, token) {
    requestAnimationFrame(() => {
      if (token !== generation || !visible(node)) return;
      const frame = node.closest('.page-frame');
      node.focus({preventScroll:true});
      if (frame) {
        const top = Math.max(frame.getBoundingClientRect().top, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0) + 16;
        frame.scrollTo({top:Math.max(0,frame.scrollTop + node.getBoundingClientRect().top - top),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      } else node.scrollIntoView({block:'start',behavior:'auto'});
    });
  }
  function close(restore = false) {
    const old = current; current = null; generation++;
    if (!old) return;
    old.panel.remove();
    if (old.card.isConnected) {old.card.setAttribute('aria-expanded','false');old.card.removeAttribute('aria-controls');}
    if (restore) focusTarget(old.card, generation);
  }
  function show(card) {
    if (!visible(card)) return;
    const key = card.dataset.kpi, definition = registry.get(key?.split('.')[0]);
    if (!definition || (definition.active && !definition.active())) return;
    // Never dismiss an editing drawer or a modal to follow a background KPI.
    if ([...document.querySelectorAll('.erp-detail-overlay,.commission-drawer-layer')].some(visible)) return;
    let value;
    try { value = model(key); }
    catch (_) {window.KushePhase1?.toast('明細暫時無法讀取；未更動任何資料。');return;}
    const anchor = card.closest(definition.anchor);
    if (!anchor) return;
    close();
    const panel = document.createElement('section'), token = generation;
    panel.id = 'kushe-kpi-detail';panel.className = 'kpi-readonly-detail commission-panel';panel.tabIndex = -1;
    panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','kushe-kpi-title');
    panel.dataset.kpiDetail = key;panel.dataset.rowCount = String(value.rows.length);
    panel.innerHTML = `<header class="kpi-detail-head"><div><span class="kpi-readonly-badge">唯讀查詢</span><h2 id="kushe-kpi-title">${esc(value.title)}</h2><p>${esc(value.scope || '沿用此字卡的統計範圍；不更動原清單篩選或任何帳務資料。')}</p></div><button type="button" class="commission-secondary" data-kpi-return>返回字卡</button></header><div class="kpi-detail-content"></div><footer class="kpi-detail-footer"><span role="status" aria-live="polite"></span><div><button type="button" data-kpi-prev>上一頁</button><button type="button" data-kpi-next>下一頁</button></div></footer>`;
    const size = 50;let page = 0;
    const renderRows = () => {
      const rows = value.rows.slice(page*size,(page+1)*size), content = panel.querySelector('.kpi-detail-content');
      const cells = row => Array.isArray(row)?row:row.cells;
      const id = row => Array.isArray(row)?'':String(row.id??'');
      const column = col => typeof col==='string'?col:col.label;
      const cell = v => v===null||v===undefined||v===''?'—':String(v);
      content.innerHTML = rows.length ? `<div class="kpi-detail-table-wrap"><table><thead><tr>${value.columns.map(c=>`<th scope="col">${esc(column(c))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-kpi-source="${esc(id(r))}">${value.columns.map((c,i)=>`<td${c.numeric?' class="num"':''}>${esc(cell(cells(r)[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="kpi-detail-mobile">${rows.map(r=>`<div class="kpi-detail-record" data-kpi-source="${esc(id(r))}"><dl>${value.columns.map((c,i)=>`<div><dt>${esc(column(c))}</dt><dd>${esc(cell(cells(r)[i]))}</dd></div>`).join('')}</dl></div>`).join('')}</div>` : '<p class="kpi-detail-empty">此字卡的統計範圍內沒有符合的資料。</p>';
      panel.querySelector('[role="status"]').textContent = rows.length ? `共 ${value.rows.length} 筆・顯示 ${page*size+1}–${page*size+rows.length} 筆` : '共 0 筆';
      panel.querySelector('[data-kpi-prev]').disabled = page===0;
      panel.querySelector('[data-kpi-next]').disabled = (page+1)*size>=value.rows.length;
      panel.dataset.page = String(page+1);
    };
    panel.querySelector('[data-kpi-return]').onclick=()=>close(true);
    panel.querySelector('[data-kpi-prev]').onclick=()=>{if(page>0){page--;renderRows();focusTarget(panel,token)}};
    panel.querySelector('[data-kpi-next]').onclick=()=>{if((page+1)*size<value.rows.length){page++;renderRows();focusTarget(panel,token)}};
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true)}});
    current={card,panel};anchor.after(panel);renderRows();
    card.setAttribute('aria-expanded','true');card.setAttribute('aria-controls',panel.id);
    focusTarget(panel,token);
  }
  document.addEventListener('click', event => {
    const card = event.target.closest?.('[data-kpi]');
    if (!card || (event.target !== card && event.target.closest('button,a,input,select,textarea'))) return;
    show(card);
  });
  document.addEventListener('keydown', event => {
    const card = event.target.closest?.('[data-kpi]');
    if (!card || event.target!==card || !['Enter',' '].includes(event.key)) return;
    event.preventDefault();if(!event.repeat) show(card);
  });
  // The ERP router uses body.dataset.route rather than hash navigation.
  const watchRoute = () => new MutationObserver(() => {if(current)close();}).observe(document.body,{attributes:true,attributeFilter:['data-route']});
  if(document.body)watchRoute();else document.addEventListener('DOMContentLoaded',watchRoute,{once:true});
  window.addEventListener('hashchange',()=>close());
  window.addEventListener('kushe:data-updated',()=>close());
  window.addEventListener('storage',()=>close());
  window.KusheKpi = Object.freeze({register,attrs,model,close});
}());
