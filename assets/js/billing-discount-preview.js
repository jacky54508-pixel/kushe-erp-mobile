/* P40-12: Read-only billing concession preview. No saves, sync, PDF or Store writes. */
(function(){
  'use strict';
  const calc=window.KusheP40DiscountPreview,store=window.KuSheERPStore;
  const text=v=>String(v??'').trim();
  const owns=(x,k)=>Object.prototype.hasOwnProperty.call(x||{},k);
  function validMoney(v,label){
    if(v===undefined||v===null||String(v).trim()===''||!Number.isSafeInteger(Number(v))||Number(v)<0)
      throw Error(label+'的已保存金額不完整，停止試算');
    return Number(v);
  }
  function read(row,fields,label,required=true){
    const known=fields.filter(k=>owns(row,k)&&row[k]!==null&&row[k]!==undefined&&row[k]!=='');
    if(!known.length){if(required)throw Error(label+'缺少保存金額，停止試算');return null;}
    const vals=known.map(k=>validMoney(row[k],label));
    if(vals.some(n=>n!==vals[0]))throw Error(label+'不同欄位不一致，停止試算');
    return vals[0];
  }
  function billingSnapshot(id){
    if(!store||!calc)throw Error('議價試算元件尚未就緒');
    const st=store.getState();
    if(!st||!Array.isArray(st.billings)||!Array.isArray(st.receivables))throw Error('帳務資料尚未載入');
    const bills=st.billings.filter(b=>text(b.id)===text(id));
    if(bills.length!==1)throw Error('請款單來源不唯一，停止試算');
    const b=bills[0];
    const ars=st.receivables.filter(ar=>
      b.receivableId&&text(ar.id)===text(b.receivableId)||
      ar.billingId&&text(ar.billingId)===text(b.id)||
      !ar.billingId&&ar.sourceNo&&b.number&&text(ar.sourceNo)===text(b.number));
    if(ars.length!==1)throw Error('請款單無法唯一對應應收帳款');
    const ar=ars[0];
    if(b.receivableId&&text(b.receivableId)!==text(ar.id)||
       ar.billingId&&text(ar.billingId)!==text(b.id))
      throw Error('請款與應收來源識別不一致');

    const recorded={
      untaxed:read(b,['preTaxAmount','amount'],'原未稅金額'),
      tax:read(b,['taxAmount','tax'],'原營業稅'),
      grossTotal:read(b,['taxIncludedAmount','grossTotal'],'原請款總額'),
      retention:read(b,['retentionAmount','retention'],'原保留款'),
      receivable:read(b,['total'],'原本期應收')
    };
    if(recorded.untaxed+recorded.tax!==recorded.grossTotal||
       recorded.grossTotal-recorded.retention!==recorded.receivable)
      throw Error('原請款金額、稅額、保留款與應收加總不一致');
    for(const [keys,amount,label] of [
      [['amount'],recorded.receivable,'應收'],
      [['untaxedAmount','preTaxAmount'],recorded.untaxed,'應收未稅'],
      [['taxAmount','tax'],recorded.tax,'應收稅額'],
      [['grossTotal','taxIncludedAmount'],recorded.grossTotal,'應收含稅'],
      [['retentionAmount','retention'],recorded.retention,'應收保留款']]){
      const value=read(ar,keys,label,keys[0]==='amount');
      if(value!==null&&value!==amount)throw Error(label+'與請款來源金額不同，停止試算');
    }
    const taxMode=text(b.taxMode);
    if(!['含稅','未稅'].includes(taxMode))throw Error('原稅額計算方式不明');
    const invoiceNo=text(b.invoiceNo||ar.invoiceNo);
    const invoiceStatus=['no_invoice','invoice_pending','invoiced'].includes(b.invoiceStatus)?
      b.invoiceStatus:invoiceNo?'invoiced':b.hasInvoice===false?'no_invoice':'invoice_pending';
    const retentionMode=text(b.retentionMode);
    if(!['none','5','10','custom'].includes(retentionMode))throw Error('保留款模式不明，請先核對原單');
    const retentionBase=text(b.retentionBase);
    if(!['preTax','taxIncluded'].includes(retentionBase))throw Error('原保留款計算基準不明');
    const retentionRate=b.retentionRate===undefined?0:Number(b.retentionRate);
    if(!Number.isFinite(retentionRate)||retentionRate<0||retentionRate>100)throw Error('保留款比例不明');
    if(retentionMode==='custom'&&!retentionRate&&recorded.retention>0&&!owns(b,'retentionCustom'))
      throw Error('固定保留款沒有原始計算依據，不能安全試算');
    const retentionCustom=owns(b,'retentionCustom')?validMoney(b.retentionCustom,'固定保留款'):null;
    const received=Math.max(read(ar,['received'],'已收款',false)??0,read(ar,['legacyReceived'],'歷史已收款',false)??0);
    const retentionReceived=read(ar,['retentionReceived'],'已收保留款',false)??0;
    if(owns(b,'retentionReceived')&&validMoney(b.retentionReceived,'請款已收保留款')!==retentionReceived)
      throw Error('請款與應收保留款已收紀錄不一致');
    const related=row=>
      row.receivableId&&text(row.receivableId)===text(ar.id)||
      row.billingId&&text(row.billingId)===text(b.id);
    const receipts=(st.receipts||[]).filter(related),
      retentionReceipts=(st.retentionReceipts||[]).filter(related);
    const cheques=ar.receivableCheques===undefined?[]:ar.receivableCheques;
    if(!Array.isArray(cheques))throw Error('支票登記格式待核對');
    const documents=st.meta?.externalBillingDocuments;
    if(documents!==undefined&&!Array.isArray(documents))throw Error('合併請款來源格式待核對');
    const merged=(documents||[]).some(d=>d.status==='active'&&Array.isArray(d.sourceIds)&&d.sourceIds.map(text).includes(text(b.id)));
    const refids=new Set([...receipts,...retentionReceipts].flatMap(row=>[row.id,row.retentionReceiptId]).filter(Boolean).map(text));
    const bankLinked=(st.bankTransactions||[]).some(row=>
      text(row.billingId)===text(b.id)||text(row.receivableId)===text(ar.id)||
      [text(b.id),text(ar.id)].includes(text(row.sourceId))||
      refids.has(text(row.sourceId))||refids.has(text(row.receiptId))||
      refids.has(text(row.retentionReceiptId))||
      text(row.sourceNo)===text(b.number)&&/receipt|receivable|retention|收款|應收|保留/i.test(text(row.sourceType)+' '+text(row.category)));
    const invoices=(st.invoices||[]).filter(row=>
      text(row.billingId)===text(b.id)||text(row.sourceType)==='billing'&&text(row.sourceId)===text(b.id));
    const issuedInvoice=invoiceStatus==='invoiced'||Boolean(invoiceNo)||invoices.some(row=>
      ['issued','invoiced'].includes(text(row.status))||Boolean(text(row.invoiceNumber||row.number)));
    const invoiceConflict=invoices.length>1||invoices.some(row=>
      row.netAmount!==undefined&&validMoney(row.netAmount,'發票未稅')!==recorded.untaxed||
      row.grossAmount!==undefined&&validMoney(row.grossAmount,'發票含稅')!==recorded.grossTotal);
    const defaultTax=Number(st.settings?.defaultTax)||5;
    if(!Number.isFinite(defaultTax)||defaultTax<=0||defaultTax>30)throw Error('稅率設定待核對');
    let sourceUnresolved=false;
    try{sourceUnresolved=Boolean(store.billingDocumentState?.(id)?.issues?.length)}
    catch(_){sourceUnresolved=true}
    return {billingId:text(b.id),number:text(b.number),customerName:text(b.customerName),projectName:text(b.projectName),
      original:{recorded,taxMode,taxRate:defaultTax,invoiceStatus,invoiceNo,issuedInvoice,
        retentionMode,retentionBase,retentionRate,retentionCustom,received,retentionReceived,
        receiptCount:receipts.length,retentionReceiptCount:retentionReceipts.length,
        chequeCount:cheques.length,pendingCheque:0,merged,bankLinked,invoiceConflict,sourceUnresolved},
      legacyReceipts:Boolean(ar.legacyReceived),chequeEvidence:cheques.length>0,
      editable:store.billingEditable(id)};
  }
  const money=v=>(v<0?'−':'')+'$'+Math.abs(v).toLocaleString('zh-TW');
  function el(tag,parent,label,cls){
    const node=document.createElement(tag);
    if(label!==undefined&&label!==null)node.textContent=label;
    if(cls)node.className=cls;
    if(parent)parent.appendChild(node);
    return node;
  }
  function css(){
    if(document.getElementById('p40-12-style'))return;
    const style=el('style',document.head);style.id='p40-12-style';
    style.textContent='.p40-12-shade{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:15px;background:#08283d92}.p40-12-modal{background:#fff;color:#153955;width:min(760px,100%);max-height:94vh;overflow:auto;padding:22px;border-radius:14px;box-shadow:0 18px 42px #08172566}.p40-12-top{display:flex;justify-content:space-between;align-items:center;gap:15px}.p40-12-modal h2{font-size:21px;margin:5px 0}.p40-12-modal p{font-size:13px;line-height:1.6;color:#526b7b}.p40-12-modal input{width:100%;padding:12px;border:1px solid #acc4d2;border-radius:8px;box-sizing:border-box;font:inherit}.p40-12-modal label{font-size:13px;font-weight:650;display:grid;gap:7px;margin:18px 0}.p40-12-result{margin-top:16px}.p40-12-result table{border-collapse:collapse;width:100%;font-size:13px}.p40-12-result td,.p40-12-result th{padding:9px;border-bottom:1px solid #d5e3eb;text-align:right}.p40-12-result td:first-child,.p40-12-result th:first-child{text-align:left}.p40-12-result th{background:#eff5f8}.p40-12-result .alert{padding:12px;border:1px solid #ead8b6;background:#fff8e9;border-radius:9px;white-space:pre-wrap}@media(max-width:650px){.p40-12-modal{padding:14px}.p40-12-result table{font-size:11px}.p40-12-result td,.p40-12-result th{padding:7px 4px}}';
  }
  function open(id){
    const snap=billingSnapshot(id);
    css();
    const shade=el('div',document.body,null,'p40-12-shade');
    const modal=el('section',shade,null,'p40-12-modal');
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','議價折讓唯讀試算');
    const top=el('div',modal,null,'p40-12-top'),titles=el('div',top);
    el('h2',titles,'議價折讓｜唯讀試算');
    el('p',titles,snap.number+'　'+snap.customerName+'／'+snap.projectName);
    const close=el('button',top,'關閉','commission-secondary');close.type='button';
    el('p',modal,'只核對建商核定含稅總額（未扣保留款）；不改原請款、戶別、施工明細、發票、抽成、薪資或銀行。');
    const label=el('label',modal,'建商核定含稅／總請款金額（NT$）');
    const input=el('input',label);input.type='number';input.min='1';input.step='1';input.max=String(snap.original.recorded.grossTotal);
    input.placeholder='輸入核定總額（不是未稅金額或應收）';
    const btn=el('button',modal,'試算差額（不儲存）','commission-primary');btn.type='button';
    const result=el('div',modal,null,'p40-12-result');
    el('p',modal,'本視窗沒有任何儲存、送出、入帳或資料同步功能。若來源不一致，停止試算。');
    const quit=()=>{shade.remove();document.removeEventListener('keydown',onKey)};
    const onKey=e=>{if(e.key==='Escape')quit()};
    close.addEventListener('click',quit);
    shade.addEventListener('click',e=>{if(e.target===shade)quit()});
    document.addEventListener('keydown',onKey);
    btn.addEventListener('click',()=>{
      result.replaceChildren();
      try{
        const fresh=billingSnapshot(id);
        if(JSON.stringify(fresh.original.recorded)!==JSON.stringify(snap.original.recorded))
          throw Error('原帳金額已變動，請關閉並重新開啟');
        const data=calc.preview({original:fresh.original,approval:{amountType:'gross',amount:input.value}});
        const table=el('table',result),head=el('thead',table),headRow=el('tr',head);
        for(const v of ['項目','原請款','核定試算','差額'])el('th',headRow,v);
        const tbody=el('tbody',table);
        for(const [key,name] of [['untaxed','未稅金額'],['tax','營業稅'],['grossTotal','含稅／總額'],['retention','保留款'],['receivable','本期應收']]){
          const line=el('tr',tbody);
          for(const value of [name,money(data.original[key]),money(data.proposed[key]),money(data.delta[key])])el('td',line,value);
        }
        el('p',result,'建商核定總額 '+money(data.approval.targetGross)+'，試算折讓 '+money(data.negotiatedReduction)+'。');
        el('p',result,'原已收款 '+money(data.settlement.collected)+'；試算剩餘應收 '+money(data.settlement.proposedOutstanding)+'；已收保留款 '+money(data.settlement.retentionReceived)+'。');
        const notes=data.locks.map(item=>item.label);
        if(!fresh.editable)notes.unshift('原單已鎖定，不能直接修改或覆寫');
        if(fresh.chequeEvidence)notes.push('支票登記存在，未兌現金額及銀行對應需人工核對；試算不認列支票為已收');
        if(fresh.legacyReceipts)notes.push('存在歷史收款欄位，須人工核對沖銷及銀行流水');
        if(!notes.length)notes.push('僅供核對，沒有完成折讓或入帳');
        el('p',result,'安全提示：\n'+notes.map(x=>'• '+x).join('\n'),'alert');
        result.dataset.previewStatus='ok';result.dataset.locks=String(data.locks.length);
      }catch(error){
        el('p',result,'停止試算：'+String(error.message||error),'alert');
        result.dataset.previewStatus='blocked';
      }
    });
    input.focus();
    return {readOnly:true,close:quit,element:shade};
  }
  window.KusheBillingDiscountPreview=Object.freeze({open,readBilling:billingSnapshot});
})();