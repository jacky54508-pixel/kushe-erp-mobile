(function () {
  'use strict';
  // P21 KPI-2: read-only presentation. No persistence, network, or accounting calls.
  const registry = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const visible = node => Boolean(node?.isConnected && node.getClientRects().length && !node.closest('[hidden]') && getComputedStyle(node).visibility !== 'hidden');
  const cellsOf = row => Array.isArray(row) ? row : row.cells;
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-Hant');
  const moneyValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = String(value ?? '').trim();
    return /^(?:NT\s*)?\$-?[\d,]+(?:\.\d+)?$/.test(raw) ? Number(raw.replace(/[^\d.-]/g,'')) : null;
  };
  const money = value => '$' + Number(value).toLocaleString('zh-TW',{maximumFractionDigits:2});
  let current = null, generation = 0;
  function register(namespace, definition) {
    if (!/^[a-z][a-z-]*$/.test(namespace) || registry.has(namespace) || typeof definition?.read !== 'function') throw new Error('Invalid KPI registration');
    registry.set(namespace, definition);
  }
  function attrs(key, label) {
    return ` data-kpi="${esc(key)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="查看${esc(label)}對應明細" aria-expanded="false"`;
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
  function lockScroll(card) {
    const nodes = [...new Set([document.documentElement,document.body,card.closest('.page-frame')].filter(Boolean))];
    const positions = nodes.map(node => ({node,top:node.scrollTop,left:node.scrollLeft,overflow:node.style.getPropertyValue('overflow'),priority:node.style.getPropertyPriority('overflow')}));
    nodes.forEach(node => node.style.setProperty('overflow','hidden','important'));
    return positions;
  }
  function restoreScroll(positions, restorePosition) {
    positions.forEach(({node,top,left,overflow,priority}) => {
      if (overflow) node.style.setProperty('overflow',overflow,priority); else node.style.removeProperty('overflow');
      if (restorePosition && node.isConnected) {node.scrollTop=top;node.scrollLeft=left;}
    });
  }
  function close(restore = false) {
    const old = current;current = null;generation++;
    if (!old) return;
    clearTimeout(old.timer);old.timer=0;old.releaseViewport?.();
    const sameRoute = document.body.dataset.route === old.route;
    try { if (old.panel.open) old.panel.close(); } finally {
      old.panel.remove();restoreScroll(old.positions,sameRoute);
      if (old.card.isConnected) {old.card.setAttribute('aria-expanded','false');old.card.removeAttribute('aria-controls');}
      if (restore && sameRoute && visible(old.card)) old.card.focus({preventScroll:true});
    }
  }
  function cellValue(row, column, secondary = false) {
    const index=secondary?column.secondaryIndex:column.index,field=secondary?column.secondaryField:column.field;
    return field ? row[field] : Number.isInteger(index) ? cellsOf(row)[index] : '';
  }
  function displayColumns(value) {
    return value.drawer?.columns || value.columns.map((c,index)=>{
      const column=typeof c==='string'?{label:c}:c,values=value.rows.map(r=>cellsOf(r)[index]).filter(v=>v!==null&&v!==undefined&&v!=='');
      return {...column,index,numeric:column.numeric??(values.length>0&&values.every(v=>moneyValue(v)!==null))};
    });
  }
  function cellMarkup(row, col) {
    const value=cellValue(row,col),secondary=cellValue(row,col,true),amount=moneyValue(value);
    const numeric=Boolean(col.numeric || typeof value==='number' || amount!==null),zero=numeric && (amount===0 || value===0);
    const classes=[numeric?'is-numeric':'',zero?'is-zero':'',col.emphasis?'is-emphasis':''].filter(Boolean).join(' ');
    return {classes,html:`<span class="kpi-cell-primary">${esc(text(value))}</span>${secondary!==''&&secondary!==undefined&&secondary!==null?`<span class="kpi-cell-secondary">${esc(text(secondary))}</span>`:''}`};
  }
  function show(card) {
    if (!visible(card)) return;
    const key=card.dataset.kpi,definition=registry.get(key?.split('.')[0]);
    if (!definition || (definition.active && !definition.active())) return;
    // Do not dismiss or cover an unsaved editor, login gate, or another dialog.
    if ([...document.querySelectorAll('.erp-detail-overlay,.commission-drawer-layer,dialog[open],[role="dialog"][aria-modal="true"]')].some(visible)) return;
    let value;
    try {value=model(key);} catch (_) {window.KushePhase1?.toast('明細暫時無法讀取；未更動任何資料。');return;}
    if (!card.closest(definition.anchor)) return;
    const panel=document.createElement('dialog');
    if (typeof panel.showModal!=='function') {window.KushePhase1?.toast('此瀏覽器不支援明細視窗，請更新瀏覽器；未更動資料。');return;}
    close();
    const token=generation,columns=displayColumns(value),drawer=value.drawer||{};
    // Copy only the presentation snapshot. Never change the source row or its order.
    const records=value.rows.map(row=>({row,search:normalize([...cellsOf(row),...columns.flatMap(c=>[cellValue(row,c),cellValue(row,c,true)])].map(text).join(' '))}));
    const totalText=card.querySelector('strong')?.textContent?.trim()||'',range=drawer.scopeLabel||'沿用字卡統計範圍';
    panel.id='kushe-kpi-detail';panel.className='kpi-readonly-detail kpi-drawer';
    panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','kushe-kpi-title');
    panel.dataset.kpiDetail=key;panel.dataset.rowCount=String(records.length);
    panel.innerHTML=`<header class="kpi-drawer-head"><div class="kpi-drawer-title-row"><div><span class="kpi-readonly-badge">唯讀</span><h2 id="kushe-kpi-title" tabindex="-1">${esc(drawer.title||value.title)}</h2></div><button type="button" class="kpi-close" data-kpi-return aria-label="關閉明細並返回字卡"><span aria-hidden="true">×</span><span>關閉</span></button></div><div class="kpi-drawer-metric"><strong>${esc(totalText)}</strong><span>${esc(range)}</span></div></header><div class="kpi-drawer-tools"><label class="kpi-search"><span class="kpi-search-label">搜尋此明細</span><input type="search" data-kpi-search maxlength="160" autocomplete="off" placeholder="搜尋單號、客戶、案場或其他內容" aria-label="搜尋此明細" aria-controls="kushe-kpi-rows"></label><div class="kpi-search-status"><span data-kpi-result-count role="status" aria-live="polite"></span><button type="button" data-kpi-clear hidden>清除搜尋</button></div><p class="kpi-search-subtotal" data-kpi-subtotal hidden></p></div><div class="kpi-drawer-scroll" id="kushe-kpi-rows" tabindex="0" aria-label="明細列表，可捲動"><details class="kpi-scope-info"><summary>ⓘ 計算與範圍說明</summary><p>${esc(value.scope||'只查看此字卡的資料來源，不改動原清單篩選或任何帳務。')}</p></details><div class="kpi-detail-content"></div></div><footer class="kpi-detail-footer"><span data-kpi-page-status></span><div><button type="button" data-kpi-prev>上一頁</button><button type="button" data-kpi-next>下一頁</button></div></footer>`;
    const state={card,panel,route:document.body.dataset.route,positions:[],timer:0};current=state;
    const size=50,input=panel.querySelector('[data-kpi-search]'),scroll=panel.querySelector('.kpi-drawer-scroll');
    let page=0,query='',composing=false,filtered=records;
    const renderRows=()=>{
      if (current!==state) return;
      const rows=filtered.slice(page*size,(page+1)*size).map(r=>r.row),content=panel.querySelector('.kpi-detail-content');
      const rowId=row=>Array.isArray(row)?'':String(row.id??'');
      const cell=(r,c,tag)=>{const m=cellMarkup(r,c);return `<${tag} class="${m.classes}">${m.html}</${tag}>`;};
      content.innerHTML=rows.length?`<div class="kpi-detail-table-wrap"><table class="kpi-detail-table"><thead><tr>${columns.map(c=>`<th scope="col" class="${c.numeric?'is-numeric':''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-kpi-source="${esc(rowId(r))}">${columns.map(c=>cell(r,c,'td')).join('')}</tr>`).join('')}</tbody></table></div><div class="kpi-detail-mobile">${rows.map(r=>`<article class="kpi-detail-record" data-kpi-source="${esc(rowId(r))}"><dl>${columns.map(c=>`<div><dt>${esc(c.label)}</dt>${cell(r,c,'dd')}</div>`).join('')}</dl></article>`).join('')}</div>`:`<div class="kpi-detail-empty"><strong>${query?'找不到符合的明細':'目前沒有對應明細'}</strong><p>${query?'請調整關鍵字或清除搜尋，原始資料沒有改變。':'此字卡的統計範圍內沒有符合的資料。'}</p></div>`;
      panel.querySelector('[data-kpi-result-count]').textContent=query?`找到 ${filtered.length}／${records.length} 筆`:`共 ${records.length} 筆來源`;
      panel.querySelector('[data-kpi-clear]').hidden=!query;
      const subtotal=panel.querySelector('[data-kpi-subtotal]');subtotal.hidden=true;
      if (query && Number.isInteger(drawer.summaryIndex)) {
        const amounts=filtered.map(r=>moneyValue(cellsOf(r.row)[drawer.summaryIndex]));
        if (amounts.every(n=>n!==null)) {subtotal.textContent=`搜尋結果小計（${drawer.summaryLabel||'金額'}）：${money(amounts.reduce((s,n)=>s+n,0))} · 上方總額不變`;subtotal.hidden=false;}
      }
      panel.querySelector('[data-kpi-page-status]').textContent=filtered.length?`第 ${page+1}／${Math.ceil(filtered.length/size)} 頁 · ${page*size+1}–${page*size+rows.length} 筆`:'共 0 筆';
      panel.querySelector('[data-kpi-prev]').disabled=page===0;
      panel.querySelector('[data-kpi-next]').disabled=(page+1)*size>=filtered.length;
      panel.dataset.page=String(page+1);panel.dataset.filteredCount=String(filtered.length);
    };
    const applySearch=()=>{
      if (current!==state || token!==generation) return;
      query=normalize(input.value).trim();const terms=query.split(/\s+/).filter(Boolean);
      filtered=records.filter(r=>terms.every(term=>r.search.includes(term)));page=0;renderRows();scroll.scrollTop=0;
    };
    const cancelSearch=()=>{clearTimeout(state.timer);state.timer=0;};
    const queueSearch=()=>{cancelSearch();state.timer=setTimeout(applySearch,140);};
    input.addEventListener('compositionstart',()=>{composing=true;cancelSearch();});
    input.addEventListener('compositionend',()=>{composing=false;queueSearch();});
    input.addEventListener('input',event=>{if(!composing&&!event.isComposing)queueSearch();});
    panel.querySelector('[data-kpi-clear]').onclick=()=>{cancelSearch();composing=false;input.value='';applySearch();input.focus({preventScroll:true});};
    panel.querySelector('[data-kpi-return]').onclick=()=>close(true);
    panel.querySelector('[data-kpi-prev]').onclick=()=>{if(page>0){page--;renderRows();scroll.scrollTop=0;}};
    panel.querySelector('[data-kpi-next]').onclick=()=>{if((page+1)*size<filtered.length){page++;renderRows();scroll.scrollTop=0;}};
    panel.addEventListener('cancel',event=>{event.preventDefault();if(!composing)close(true);});
    panel.addEventListener('close',()=>{if(current===state)close(true);});
    // Backdrop dismissal requires both pointer-down and click outside the panel.
    let backdropDown=false;
    const outside=event=>{const r=panel.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
    panel.addEventListener('pointerdown',event=>{backdropDown=event.target===panel&&outside(event);});
    panel.addEventListener('click',event=>{if(backdropDown&&event.target===panel&&outside(event))close(true);backdropDown=false;});
    panel.addEventListener('keydown',event=>{
      if(event.isComposing||composing){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(event.key==='Tab'){
        const controls=[...panel.querySelectorAll('button:not(:disabled),input,summary,[tabindex="0"]')].filter(visible);
        const first=controls[0],last=controls.at(-1),active=document.activeElement;
        if(event.shiftKey&&(active===first||active===panel.querySelector('h2'))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&active===last){event.preventDefault();first?.focus();}
      }
    });
    try {
      document.body.appendChild(panel);state.positions=lockScroll(card);renderRows();panel.showModal();
      const viewport=window.visualViewport;
      if(viewport){
        const syncViewport=()=>{if(current!==state)return;panel.style.setProperty('--kpi-visible-height',viewport.height+'px');panel.style.setProperty('--kpi-visible-top',viewport.offsetTop+'px');panel.classList.toggle('is-compact',viewport.height<500);};
        viewport.addEventListener('resize',syncViewport);viewport.addEventListener('scroll',syncViewport);syncViewport();
        state.releaseViewport=()=>{viewport.removeEventListener('resize',syncViewport);viewport.removeEventListener('scroll',syncViewport);};
      }
      card.setAttribute('aria-haspopup','dialog');card.setAttribute('aria-expanded','true');card.setAttribute('aria-controls',panel.id);
      panel.querySelector('h2').focus({preventScroll:true});
    } catch (_) {close(true);window.KushePhase1?.toast('明細視窗無法開啟；未更動任何資料。');}
  }
  document.addEventListener('click',event=>{
    const card=event.target.closest?.('[data-kpi]');
    if(!card||(event.target!==card&&event.target.closest('button,a,input,select,textarea')))return;
    show(card);
  });
  document.addEventListener('keydown',event=>{
    const card=event.target.closest?.('[data-kpi]');
    if(!card||event.target!==card||!['Enter',' '].includes(event.key))return;
    event.preventDefault();if(!event.repeat)show(card);
  });
  const watch=()=>{
    new MutationObserver(()=>{if(current)close();}).observe(document.body,{attributes:true,attributeFilter:['data-route']});
    const shell=document.getElementById('appShell');
    if(shell)new MutationObserver(()=>{if(current&&shell.hidden)close();}).observe(shell,{attributes:true,attributeFilter:['hidden']});
  };
  if(document.body)watch();else document.addEventListener('DOMContentLoaded',watch,{once:true});
  window.addEventListener('hashchange',()=>close());
  window.addEventListener('kushe:data-updated',()=>close());
  window.addEventListener('storage',()=>close());
  window.addEventListener('pagehide',()=>close());
  window.KusheKpi=Object.freeze({register,attrs,model,close});
}());
