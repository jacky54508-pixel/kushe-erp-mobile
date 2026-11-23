/* P41-38 REVIEW-ONLY candidate. DO NOT DEPLOY.
 * Strictly read-only router for existing billing discount entrypoints.
 * No storage/network/DB/PDF/invoice/payroll/bank API calls.
 * All money computations stay within existing read-only previews.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KusheP4138EntryCandidate=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const fail=(message)=>{throw Error(message)};
  const id=x=>typeof x==='string'?x.trim():'';
  function resolve(sourceId,apis){
    const billingId=id(sourceId);
    if(!billingId)fail('請款來源 ID 無效；停止唯讀折讓');
    const store=apis?.store;
    if(typeof store?.getState!=='function')fail('正式 Store 唯讀介面未就緒');
    const state=store.getState();
    if(!state||!Array.isArray(state.billings))fail('請款來源尚未載入');
    if(state.billings.filter(b=>id(b?.id)===billingId).length!==1)fail('請款來源不存在或重複，已停止');
    const docs=state.meta?.externalBillingDocuments;
    if(docs!==undefined&&!Array.isArray(docs))fail('合併請款來源格式無效');
    // Reject unknown membership, but don't deny an unrelated bill merely because
    // another *identifiable* group's other fields are malformed.
    const joined=[];
    for(const d of docs||[]){
      if(d?.status!=='active')continue;
      if(!Array.isArray(d.sourceIds))fail('有效合併文件缺少來源列表，無法確認本請款歸屬');
      if(!d.sourceIds.includes(billingId))continue;
      if(!id(d.id)||d.sourceIds.length<2||d.sourceIds.length>30||
         d.sourceIds.some(x=>!id(x))||new Set(d.sourceIds).size!==d.sourceIds.length)
        fail('本請款所屬的有效合併文件格式待核對');
      joined.push(d);
    }
    if(joined.length>1)fail('本請款被重複納入有效合併文件');
    const group=typeof apis?.groups?.activeFor==='function'?apis.groups.activeFor(billingId):null;
    if(joined.length===1){
      const saved=joined[0],actual=group?.document;
      if(!actual||id(actual.id)!==id(saved.id)||!Array.isArray(actual.sourceIds)||
         actual.sourceIds.length!==saved.sourceIds.length||
         !actual.sourceIds.every(x=>saved.sourceIds.includes(x)))
        fail('合併索引與原始來源不一致；不可回退單筆試算');
      if(group.canGroup!==true||!Array.isArray(group.issues)||group.issues.length||group.termsChanged)
        fail('合併請款來源或版本待核對，已停止試算');
      if(typeof apis?.groupPreview?.open!=='function')fail('整組唯讀試算尚未載入');
      return Object.freeze({kind:'group',billingId,documentId:id(saved.id),readOnly:true,canPost:false});
    }
    if(group)fail('合併索引與來源不一致；不可回退單筆試算');
    if(typeof apis?.singlePreview?.open!=='function')fail('單筆唯讀試算尚未載入');
    return Object.freeze({kind:'single',billingId,documentId:'',readOnly:true,canPost:false});
  }
  function dispatch(plan,apis){
    const preview=plan.kind==='group'?apis.groupPreview:apis.singlePreview;
    const view=preview.open(plan.kind==='group'?plan.documentId:plan.billingId);
    // Existing approved preview modules return a readOnly marker. Any alternate
    // component that returns no proof fails closed; this is not a sandbox for a
    // malicious preview (its open() already ran). Only trusted modules may inject.
    if(!view||view.readOnly!==true||view.canPost===true)fail('試算元件未確認唯讀，已停止');
    return Object.freeze({...plan,opened:true});
  }
  function open(sourceId,apis){return dispatch(resolve(sourceId,apis),apis)}
  function openGroup(group,apis){
    const doc=group?.document;
    if(!id(doc?.id)||!Array.isArray(doc.sourceIds)||!doc.sourceIds.length)fail('合併來源不完整');
    const plan=resolve(doc.sourceIds[0],apis);
    if(plan.kind!=='group'||plan.documentId!==id(doc.id))fail('合併入口與請款路由不一致');
    // Cross-check the caller's FULL source membership against the authoritative
    // validated group. Checking only the first original is insufficient.
    const canonical=typeof apis?.groups?.activeFor==='function'
      ?apis.groups.activeFor(plan.billingId)?.document?.sourceIds:null;
    if(!Array.isArray(canonical)||canonical.length!==doc.sourceIds.length||
       new Set(doc.sourceIds).size!==doc.sourceIds.length||
       doc.sourceIds.some(x=>!id(x)||!canonical.includes(x)))
      fail('合併入口與已核對原單集合不一致；停止唯讀試算');
    return dispatch(plan,apis);
  }
  return Object.freeze({resolve,open,openGroup,version:'P41-38-review-only-v1'});
});
