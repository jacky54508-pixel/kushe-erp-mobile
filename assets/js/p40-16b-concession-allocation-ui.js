/* P40-16B ISOLATED ONLY: no production index inclusion, save or posting capability.
 * UI is a transient in-memory review for synthetic-source testing.
 * Accounting allocations are user-entered, NEVER auto-proportioned.
 */
(function (root, factory) {
  'use strict';
  const api=factory();
  if (typeof module==='object'&&module.exports) module.exports=api;
  else if(root)root.KusheP4016AllocationUi=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const money=['untaxed','tax','grossTotal','retention','receivable'];
  const names={untaxed:'折讓未稅',tax:'折讓營業稅',grossTotal:'折讓含稅',retention:'保留款調整',receivable:'應收調整'};
  const decimal=x=>'NT$'+Number(x).toLocaleString('zh-TW');
  const text=x=>String(x??'');
  function node(tag,parent,caption,css){
    const el=document.createElement(tag);
    if(caption!==null&&caption!==undefined)el.textContent=caption;
    if(css)el.className=css;
    if(parent)parent.append(el);
    return el;
  }
  function dated(s){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const d=new Date(s+'T00:00:00Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
  }
  function int(s){
    if(typeof s!=='string'||!/^\d+$/.test(s.trim()))throw Error('分攤金額請輸入非負整數');
    const n=Number(s);
    if(!Number.isSafeInteger(n))throw Error('分攤金額超出安全範圍');
    return n;
  }
  function prepare(original,form){
    const date=text(form.date||'').trim(),reason=text(form.reason||'').trim(),
      evidence=text(form.evidence||'').trim();
    if(!dated(date))throw Error('請輸入有效的建商核定日期');
    if(reason.length<2||reason.length>500)throw Error('請輸入 2～500 字核定原因');
    if(evidence.length>300)throw Error('簽認／證據備註不可超過 300 字');
    if(!original||!Array.isArray(original.sources)||!Array.isArray(form.rows)||
       form.rows.length!==original.sources.length)throw Error('原單分攤數量異常');
    const allocations=form.rows.map((r,i)=>{
      if(text(r.billingId)!==text(original.sources[i]?.billingId))
        throw Error('原單次序或識別已變更，請重新開啟');
      const delta=Object.fromEntries(money.map(k=>[k,int(r[k])]));
      return {billingId:r.billingId,delta};
    });
    const fields={...original,approvedGross:int(text(form.approvedGross)),allocations};
    return {date,reason,evidence,fields};
  }
  function open({host,model,review}){
    if(!host||typeof host.append!=='function'||!model||typeof review?.evaluate!=='function')
      throw Error('唯讀核對元件尚未就緒');
    if(host.querySelector('[data-p4016-root]'))throw Error('請先關閉前一個核對畫面');
    const snapshot=JSON.stringify(model);
    const root=node('section',host,null,'p4016-card');
    root.dataset.p4016Root='true';
    root.setAttribute('aria-label','P40-16B 折讓核定與原單分攤唯讀審核');
    const head=node('div',root,null,'p4016-header');
    node('h2',head,'折讓核定與原單分攤');
    const close=node('button',head,'關閉','p4016-secondary');close.type='button';
    close.addEventListener('click',()=>root.remove());
    node('p',root,'P40-16B 隔離測試｜只能核對，無儲存、入帳、匯出或同步功能。','p4016-disclaimer');
    node('div',root,'原合併總額 '+decimal(model.originalTotals.grossTotal)+' ｜ 核定目標 '+decimal(model.approvedGross),'p4016-total');
    const form=node('form',root);
    const info=node('div',form,null,'p4016-meta');
    function field(parent,label,type,value=''){
      const lab=node('label',parent,label);
      const input=node(type==='textarea'?'textarea':'input',lab);
      if(type!=='textarea')input.type=type;
      input.value=text(value);
      return input;
    }
    const date=field(info,'建商核定日期','date');
    const reason=field(info,'核定原因','textarea');
    const evidence=field(info,'核定／簽認依據（僅文字備註）','textarea');
    const approved=field(info,'整張核定含稅總額','number',model.approvedGross);
    approved.step='1';approved.min='1';
    node('p',form,'每一張原請款必須明確輸入五欄金額；不自動分配 5% 稅額，不修改已開發票，也不推算員工抽成。','p4016-hint');
    const rows=node('div',form,null,'p4016-rows');
    const editors=model.sources.map((source,i)=>{
      const box=node('fieldset',rows,null,'p4016-source');
      node('legend',box,'原始請款 '+(i+1)+'｜'+text(source.billingId));
      node('p',box,'原含稅 '+decimal(source.amounts.grossTotal)+' · 原稅額 '+decimal(source.amounts.tax)+
        ' · 發票狀態 '+(source.invoice?.status==='invoiced'?'已開票':'未開票／待核對'));
      const group=node('div',box,null,'p4016-grid');
      const controls=Object.fromEntries(money.map(k=>{
        const input=field(group,names[k],'number','');
        input.step='1';input.min='0';
        input.dataset.amountKey=k;
        return [k,input];
      }));
      return {billingId:source.billingId,controls};
    });
    const action=node('button',form,'核對分攤（不儲存）','p4016-primary');action.type='submit';
    const result=node('div',root,null,'p4016-result');result.setAttribute('aria-live','polite');
    form.addEventListener('submit',event=>{
      event.preventDefault();
      result.replaceChildren();
      try{
        if(JSON.stringify(model)!==snapshot)throw Error('來源資料已變更，請重新載入，禁止繼續審核');
        const entry=prepare(model,{
          date:date.value,reason:reason.value,evidence:evidence.value,approvedGross:approved.value,
          rows:editors.map(e=>({billingId:e.billingId,...Object.fromEntries(
            money.map(k=>[k,e.controls[k].value]))}))
        });
        const evaluated=review.evaluate(entry.fields);
        node('h3',result,'算術審核結果');
        node('p',result,'原總額 '+decimal(evaluated.originalGross)+' ｜核定 '+decimal(evaluated.approvedGross)+
          ' ｜整張折讓 '+decimal(evaluated.discountGross));
        node('p',result,'逐張分攤：'+(evaluated.allocationMathValid?'算術一致':'待確認')+
          '。此結果不代表發票／稅務核准。');
        const warn=node('ul',result,null,'p4016-warnings');
        for(const s of evaluated.blockers)node('li',warn,s);
        node('p',result,'正式入帳：禁止｜資料儲存：禁止｜應收、發票、薪資及銀行：維持原帳。','p4016-locked');
        result.dataset.status='reviewed';
        result.dataset.canPost='false';
      }catch(error){
        node('p',result,'停止核對：'+text(error?.message||error),'p4016-error');
        result.dataset.status='blocked';result.dataset.canPost='false';
      }
    });
    root.dataset.readonly='true';
    return Object.freeze({close:()=>root.remove(),canPost:false,canSave:false});
  }
  return Object.freeze({prepare,open,version:'P40-16B-sandbox-ui-1'});
});
