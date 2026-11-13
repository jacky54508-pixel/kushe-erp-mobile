/* P39-3I isolated candidate. Only publicNote can change; preserve internal notes and accounting. */
(function () {
  'use strict';
  const $=(sel,root=document)=>root.querySelector(sel);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(overlay,billing,info,onSaved) {
    if (!overlay || !billing || !info || !$('.erp-detail-body',overlay)) return false;
    if ($('.p393-note-panel',overlay)) return false;
    const store=window.KuSheERPStore,auth=window.KusheAuthGate;
    const user=auth?.user?.(),context=auth?.companyContext?.();
    const authorized=!!user?.id&&String(context?.userId||'')===String(user.id)&&
      String(context?.legacySourceUserId||'')===String(user.id)&&auth?.canWrite?.('billings');
    const section=document.createElement('section');
    section.className='p393-note-panel';
    let current=null,error='';
    try {current=store?.p39BillingNoteRevisionContext?.(billing.id)}
    catch (cause) {error=cause?.message||String(cause)}
    const note=current?.note??String(billing.publicNote??'');
    const history=Array.isArray(billing.noteRevisionHistory)?billing.noteRevisionHistory:[];
    section.innerHTML='<div class="p393-note-heading"><div><h3>請款備註修訂</h3>'+
      '<p>只修改對外備註，內部備註保持原樣；記錄每次修改原因，不重新計算任何帳務。</p></div>'+
      '<button class="commission-secondary" type="button" data-p393-open'+
      (!authorized||error?' disabled':'')+'>修訂備註</button></div>'+
      '<p class="p393-note-current">目前備註：<strong>'+esc(note||'（無）')+'</strong></p>'+
      '<p class="p393-note-history">歷次修訂：'+history.length+' 筆</p>'+
      '<div class="p393-note-error" role="alert" '+(!error?'hidden':'')+'>'+esc(error)+'</div>'+
      '<form class="p393-note-form" hidden><label><span>新的對外備註</span>'+
      '<textarea name="note" maxlength="2000">'+esc(note)+'</textarea></label>'+
      '<label><span>修訂原因（必填）</span><input name="reason" maxlength="300" required></label>'+
      '<p>確認後只更新請款文件備註及保留歷程，不會重新建立請款或改變其他財務資料。</p>'+
      '<div class="p393-note-actions"><button class="commission-secondary" type="button" data-p393-cancel>取消</button>'+
      '<button class="commission-primary" type="submit">確認修訂備註</button></div>'+
      '<p class="p393-note-feedback" role="status" hidden></p></form>'+
      '<p class="p393-note-locked" '+(authorized?'hidden':'')+'>目前登入身分沒有請款編輯權限。</p>';
    const body=$('.erp-detail-body',overlay);
    // Leave existing PDF, invoice, historical detail and receivable controls untouched.
    body.append(section);
    const form=$('.p393-note-form',section),open=$('[data-p393-open]',section);
    $('[data-p393-open]',section)?.addEventListener('click',()=>{form.hidden=false;open.disabled=true;
      $('[name="reason"]',form)?.focus()});
    $('[data-p393-cancel]',section)?.addEventListener('click',()=>{form.hidden=true;open.disabled=false});
    let committed=false,busy=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy||committed||!authorized||!current)return;
      busy=true;
      const submit=$('button[type="submit"]',form),feedback=$('.p393-note-feedback',form);
      submit.disabled=true;feedback.hidden=false;feedback.textContent='正在以 Store 交易安全保存，請勿重複送出。';
      try{
        const result=await store.saveP39BillingNoteRevision(billing.id,{
          note:$('[name="note"]',form).value,reason:$('[name="reason"]',form).value,
          expectedSnapshot:current.snapshot
        });
        committed=true;feedback.textContent=result.unchanged?'備註未變更，未建立新版本。':'已修訂對外備註，內部備註與所有帳務金額保持不變。';
        try{onSaved?.()}catch(_){feedback.textContent+=' 畫面重繪失敗，請手動重新開啟；勿重新送出。'}
      }catch(error){
        const blocked=error?.transactionStatus==='RECOVERY_REQUIRED';
        feedback.textContent=blocked?'交易狀態待復原，請勿重送、清除或還原資料。':
          '未儲存：'+(error?.message||String(error));
        if(!blocked)submit.disabled=false;
      }finally{busy=false}
    });
    return true;
  }
  window.KusheP39BillingNote=Object.freeze({mount});
})();