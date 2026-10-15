(function(){
  'use strict';
  const $=(s,r)=>r.querySelector(s),$$=(s,r)=>Array.from(r.querySelectorAll(s));
  const staleCodes=new Set(['STALE_STORE_STATE','STORE_CAS_MISMATCH','STORE_JOURNAL_CAS_MISMATCH','DAILY_DRAFT_CONTEXT_CHANGED','DAILY_DRAFT_SOURCE_CHANGED']);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function attach(form,context,initial){
    const store=window.KuSheERPStore,principal=String(window.KusheAuthGate?.user?.()?.id||'');
    let origin=initial,accepted=initial,latest=null,phase='ready',busy=false,disposed=false,report=null;
    const footer=$(':scope>footer',form),panel=document.createElement('section');
    panel.className='daily-draft-review';panel.hidden=true;panel.setAttribute('aria-label','施工草稿版本核對');footer.prepend(panel);
    const present=()=>!disposed&&form.isConnected;
    const blocked=()=>!present()||context.canReview?.()===false||busy;
    const error=(message,code='DAILY_DRAFT_REVIEW_REQUIRED')=>Object.assign(new Error(message),{code});
    function notice(message,tone='warning'){
      if(!present())return;
      panel.hidden=false;panel.dataset.tone=tone;
      const oldFeedback=$('.daily-save-feedback',form);if(oldFeedback)oldFeedback.hidden=true;
      panel.innerHTML='<div class="daily-draft-review-heading"><strong>施工草稿仍保留，尚未儲存</strong><span data-draft-status role="status" aria-live="polite">'+esc(message)+'</span></div><ul data-draft-issues></ul><div class="daily-draft-review-actions"><button type="button" class="commission-primary" data-draft-refresh>保留草稿，核對最新資料</button><button type="button" class="commission-secondary" data-draft-export>匯出草稿</button></div><p class="daily-draft-review-note">只讀取本機已提交資料，不還原雲端、不自動儲存。草稿目前只留在此視窗，關閉或重新整理前請先匯出。</p>';
      $('[data-draft-refresh]',panel).onclick=refresh;$('[data-draft-export]',panel).onclick=exportDraft;
      form.dataset.draftReviewRequired='true';
    }
    function exportDraft(){
      if(!present()||busy)return;
      // User-initiated file only: never put business drafts into local/session storage.
      const data={schema:'kushe-daily-draft-reference-v1',purpose:'施工輸入草稿，非 ERP 備份；請勿匯入還原',exportedAt:new Date().toISOString(),editingBatchId:context.batchId||'',draft:context.readDraft(),fields:$$('input,select,textarea',form).filter(n=>n.name).map(n=>({name:n.name,employeeId:n.dataset.employeeId||'',value:n.value,checked:(n.type==='checkbox'||n.type==='radio')?n.checked:undefined}))};
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='酷舍ERP_每日施工草稿_'+String(data.draft.date||'未填日期')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function renderReview(){
      if(!present()||phase!=='review')return;
      if(store.getState()!==latest){phase='stale';notice('核對期間資料再次更新，請再讀取最新資料。');return}
      try{report=store.dailyDraftReview(context.readDraft(),context.batchId||'',origin)}catch(e){notice('無法完成來源核對：'+e.message);return}
      const list=$('[data-draft-issues]',panel);list.replaceChildren();
      const entries=[...report.changes.map(message=>({message})),...report.issues];
      if(!entries.length)entries.push({message:'草稿的員工、案場、報價與相關來源未變；日期、戶別、數量、薪資設定及備註均已保留。'});
      entries.forEach(item=>{
        const li=document.createElement('li');li.textContent=item.message;if(item.code)li.className='is-blocking';
        if(item.canApply){const b=document.createElement('button');b.type='button';b.className='commission-secondary';b.textContent='套用此項最新報價';b.onclick=()=>{if(blocked()||store.getState()!==latest)return;context.applyLatestQuote(item.rowIndex);renderReview()};li.append(' ',b)}
        list.append(li);
      });
      $('[data-draft-status]',panel).textContent=report.issues.length?'請先處理下列項目；尚未新增或修改施工。':'最新本機資料已讀取。請核對下方試算金額，再繼續編輯。';
      let confirm=$('[data-draft-confirm]',panel);
      if(!confirm){confirm=document.createElement('button');confirm.type='button';confirm.className='commission-primary';confirm.dataset.draftConfirm='';$('.daily-draft-review-actions',panel).prepend(confirm);confirm.onclick=confirmReview}
      confirm.textContent='已核對，繼續編輯';confirm.disabled=report.issues.length>0;
      $('[data-draft-refresh]',panel).className='commission-secondary';$('[data-draft-refresh]',panel).textContent='重新核對';
    }
    async function refresh(){
      if(blocked())return;
      if(!store.refreshDailyDraftBase||!store.dailyDraftReview){notice('程式版本未完整載入；請先匯出草稿，再重新整理。');return}
      busy=true;phase='loading';notice('正在核對本機最新版本，請稍候…');panel.setAttribute('aria-busy','true');
      // Lock the drawer, not its controls' values. Keep the original nodes/FormData.
      const drawer=form.closest('aside'),wasInert=drawer?.inert;if(drawer)drawer.inert=true;
      try{
        const result=await store.refreshDailyDraftBase();
        if(!present())return;
        latest=result.data;context.refreshDraftView();phase='review';notice('最新資料已讀取；草稿仍未儲存。');renderReview();
      }catch(e){
        if(present()){phase='stale';notice('核對未完成：'+(e.message||String(e))+' 草稿保持原樣。','error')}
      }finally{
        busy=false;if(drawer)drawer.inert=wasInert;if(present()){panel.removeAttribute('aria-busy');$('[data-draft-confirm]',panel)?.focus({preventScroll:true})}
      }
    }
    function confirmReview(){
      if(blocked()||phase!=='review')return;
      renderReview();if(phase!=='review'||!report||report.issues.length)return;
      accepted=latest;phase='ready';delete form.dataset.draftReviewRequired;panel.dataset.tone='success';
      panel.innerHTML='<strong role="status">核對完成，草稿尚未儲存。</strong><span>請確認金額後按「儲存每日施工」。如其他頁面再次更新，仍會停止舊版本寫入。</span>';
      const old=$('.daily-save-feedback',form);if(old)old.hidden=true;
      // No automatic submit, no accounting mutation.
    }
    function onError(e){
      if(!present()||e?.transactionStatus==='RECOVERY_REQUIRED'||form.dataset.submitLocked==='true'||!staleCodes.has(e?.code))return false;
      phase='stale';latest=null;notice('其他 ERP 分頁或同步已更新本機資料。請先保留草稿並核對最新版本，再自行儲存。');return true;
    }
    function beforeSubmit(){
      if(!store.dailyDraftSnapshot||!store.dailyDraftReview){phase='stale';notice('程式版本未完整載入；請先匯出草稿，再重新整理。');throw error('程式版本未完整載入，請先保留草稿。')}
      if(!present()||phase!=='ready')throw error('草稿尚未完成最新版本核對，請先使用「保留草稿，核對最新資料」。');
      if(String(window.KusheAuthGate?.user?.()?.id||'')!==principal)throw error('登入帳號已變更，不能送出原帳號草稿。','DAILY_DRAFT_SESSION_CHANGED');
    }
    const onInput=()=>{if(phase==='review'&&!busy)renderReview()},unload=e=>{if(present()&&phase!=='ready'){e.preventDefault();e.returnValue=''}};
    const storage=e=>{if(present()&&!busy&&context.canReview?.()!==false&&e.key==='KuSheERP25_LOCAL_COMMIT_TOKEN'&&e.newValue!==e.oldValue)onError({code:'STALE_STORE_STATE'})};
    form.addEventListener('change',onInput);window.addEventListener('beforeunload',unload);window.addEventListener('storage',storage);
    return {
      get busy(){return busy},beforeSubmit,onError,
      saveOptions:values=>({expectedDailyDraftSnapshot:store.dailyDraftSnapshot(values,context.batchId||'',accepted),expectedDraftPrincipal:principal}),
      allowClose:()=>phase==='ready'||window.confirm('這筆施工草稿尚未儲存。建議先匯出草稿；確定要關閉並放棄本視窗輸入嗎？'),
      afterCommit(){origin=accepted=store.getState();latest=null;phase='ready';panel.hidden=true;delete form.dataset.draftReviewRequired},
      dispose(){disposed=true;form.removeEventListener('change',onInput);window.removeEventListener('beforeunload',unload);window.removeEventListener('storage',storage)}
    };
  }
  window.KusheDailyDraftReview=Object.freeze({attach});
}());
