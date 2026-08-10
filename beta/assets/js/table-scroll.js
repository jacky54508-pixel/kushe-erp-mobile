(function(){
  'use strict';
  const selector=['.commission-table-wrap','.table-wrap','.daily-lines-wrap','.receipt-history','.receipt-history-scroll','.payable-history-scroll','.payable-detail-scroll','.project-list-scroll'].join(',');
  const bound=new WeakSet();let target=null,frame=0,sync=false;
  const bar=document.createElement('div'),inner=document.createElement('div');
  bar.className='erp-global-hscroll';bar.setAttribute('aria-label','表格水平捲動');bar.setAttribute('role','scrollbar');inner.className='erp-global-hscroll-inner';bar.appendChild(inner);
  function bind(el){if(bound.has(el))return;bound.add(el);el.classList.add('erp-table-scroll-managed');el.addEventListener('pointerenter',()=>{target=el;schedule()});el.addEventListener('focusin',()=>{target=el;schedule()});el.addEventListener('scroll',()=>{if(target===el&&!sync){sync=true;bar.scrollLeft=el.scrollLeft;sync=false}}, {passive:true});el.addEventListener('wheel',e=>{if(!e.shiftKey||el.scrollWidth<=el.clientWidth+1)return;e.preventDefault();el.scrollLeft+=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX},{passive:false})}
  function candidates(){return Array.from(document.querySelectorAll(selector)).filter(el=>{bind(el);const r=el.getBoundingClientRect();return !el.closest('[hidden]')&&el.scrollWidth>el.clientWidth+1&&r.bottom>72&&r.top<innerHeight-12}).map(el=>{const r=el.getBoundingClientRect();return {el,r,score:Math.max(0,Math.min(r.bottom,innerHeight-12)-Math.max(r.top,72))}}).sort((a,b)=>b.score-a.score)}
  function refresh(){frame=0;let picked=target&&candidates().find(x=>x.el===target);if(!picked)picked=candidates()[0];if(!picked){bar.classList.remove('is-visible');target=null;return}target=picked.el;const left=Math.max(0,picked.r.left),right=Math.min(innerWidth,picked.r.right);if(right-left<100){bar.classList.remove('is-visible');return}bar.style.left=left+'px';bar.style.width=(right-left)+'px';inner.style.width=target.scrollWidth+'px';sync=true;bar.scrollLeft=target.scrollLeft;sync=false;bar.classList.add('is-visible')}
  function schedule(){if(!frame)frame=requestAnimationFrame(refresh)}
  bar.addEventListener('scroll',()=>{if(target&&!sync){sync=true;target.scrollLeft=bar.scrollLeft;sync=false}},{passive:true});
  document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);window.addEventListener('hashchange',()=>setTimeout(schedule));
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
  document.addEventListener('DOMContentLoaded',()=>{document.body.appendChild(bar);schedule()});
  window.KusheTableScroll={refresh:schedule,activate(el){target=el;schedule()}};
})();
