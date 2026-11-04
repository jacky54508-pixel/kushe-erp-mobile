(function p375(){
 'use strict';
 // P37-5: read-only accounting projection. No persistence, tax issuance, cash or commission writes.
 const $=(s,r=document)=>r.querySelector(s),txt=x=>String(x??'').trim();
 const esc=x=>txt(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>'NT$'+Number(x||0).toLocaleString('zh-TW',{maximumFractionDigits:0});
 function fail(x){throw new Error(x)}
 function amount(x,label){if((typeof x!=='number'&&typeof x!=='string')||String(x).trim()===''||!Number.isSafeInteger(Number(x))||Number(x)<0)fail(label+'不是有效金額');return Number(x)}
 function get(row,keys){for(const k of keys)if(row?.[k]!==undefined&&row[k]!==null&&row[k]!=='')return row[k];return undefined}
 function linked(row,bill,ar){
  return !!(row&&(txt(row.billingId)&&txt(row.billingId)===txt(bill.id)||
    txt(row.receivableId)&&txt(row.receivableId)===txt(ar.id)||
    txt(row.sourceId)&&txt(row.sourceId)===txt(bill.id)||
    txt(row.sourceNo)&&txt(row.sourceNo)===txt(bill.number)));
 }
 function pure(gate,state,ledger=[]){
  if(!gate?.ok||!gate.context||!state||!Array.isArray(ledger))fail('P37-3 來源尚未通過唯讀檢查');
  for(const k of ['billings','receivables','invoices','receipts','retentionReceipts','bankTransactions','commissions'])
   if(!Array.isArray(state[k]))fail(k+' 資料集未載入，不可試算');
  const c=gate.context,b=c.baseline,d=c.draft,id=txt(c.billingId),arId=txt(c.receivableId),invoiceId=txt(c.invoiceId);
  if(!id||!arId||!invoiceId||!txt(c.invoiceNo)||!txt(c.documentSnapshot)||!Number.isSafeInteger(c.draftVersion))fail('請款、應收、發票或草稿識別不完整');
  const bills=state.billings.filter(x=>txt(x.id)===id);
  const ars=state.receivables.filter(x=>txt(x.id)===arId||txt(x.billingId)===id||(!x.billingId&&txt(x.sourceNo)===txt(b.number)));
  const invoices=state.invoices.filter(x=>txt(x.id)===invoiceId||txt(x.billingId)===id||(txt(x.sourceType)==='billing'&&txt(x.sourceId)===id));
  if(bills.length!==1||ars.length!==1||invoices.length!==1)fail('原請款、應收、銷項發票關聯不唯一');
  const bill=bills[0],ar=ars[0],invoice=invoices[0];
  if(txt(bill.number)!==txt(b.number)||txt(bill.receivableId)!==arId||txt(ar.id)!==arId||
    txt(ar.billingId)!==id||txt(invoice.id)!==invoiceId||txt(invoice.billingId)!==id||
    txt(invoice.invoiceNumber||invoice.number)!==txt(c.invoiceNo)||txt(invoice.status)!=='issued')fail('請款、應收、發票或開立狀態不一致');
  const invoiceNet=amount(get(invoice,['netAmount','amount']),'發票未稅'),invoiceTax=amount(get(invoice,['taxAmount','tax']),'發票稅額'),invoiceGross=amount(get(invoice,['grossAmount','total']),'發票含稅');
  if(invoiceNet!==amount(b.originalNet,'原未稅')||invoiceTax!==amount(b.originalTax,'原稅額')||
     invoiceGross!==amount(b.originalGross,'原含稅')||invoiceNet+invoiceTax!==invoiceGross)fail('原發票與請款金額不符');
  const originalAR=amount(ar.amount,'應收金額'),already=amount(ar.received??0,'已收款'),holdReceived=amount(ar.retentionReceived??0,'保留款已收');
  if(originalAR!==amount(b.originalReceivable,'原應收')||amount(bill.total,'請款應收')!==originalAR||amount(bill.grossTotal,'請款含稅')!==invoiceGross)fail('原應收與請款金額不符');
  if(already||holdReceived||amount(ar.legacyReceived??0,'歷史已收')||amount(ar.legacyRetentionReceived??0,'歷史保留款已收'))fail('已有收款或保留款收回，不可直接套用一般折讓');
  if(ar.receivableCheques!==undefined&&(!Array.isArray(ar.receivableCheques)||ar.receivableCheques.length))fail('已有支票登記或歷程');
  if([...state.receipts,...state.retentionReceipts,...state.bankTransactions].some(x=>linked(x,bill,ar)))fail('已有收款、客戶扣款或銀行流水，禁止重複沖銷');
  for(const k of ['billingAllowances','billingNegotiationAdjustments','salesAllowances','salesCreditNotes','customerDeductions']){
   if(state[k]!==undefined&&!Array.isArray(state[k]))fail(k+' 格式異常');
   if(state[k]?.some(x=>txt(x.billingId)===id||txt(x.receivableId)===arId||txt(x.invoiceNo)===txt(c.invoiceNo)))fail('已存在同單折讓或客戶扣款紀錄');
  }
  const key='billing-allowance::'+id+'::'+txt(c.invoiceNo);
  if(ledger.some(x=>txt(x.idempotencyKey)===key||txt(x.billingId)===id||txt(x.invoiceNo)===txt(c.invoiceNo)))fail('隔離紀錄已存在同單折讓');
  for(const k of ['originalNet','originalTax','originalGross','originalRetention','originalReceivable'])amount(b[k],k);
  for(const k of ['approvedNet','approvedTax','approvedGross','approvedRetention','approvedReceivable','discountNet','discountTax','discountGross','discountRetention','discountReceivable'])amount(d[k],k);
  if(!d.discountGross||d.discountNet+d.discountTax!==d.discountGross||d.discountRetention+d.discountReceivable!==d.discountGross||
    b.originalNet-d.discountNet!==d.approvedNet||b.originalTax-d.discountTax!==d.approvedTax||
    b.originalGross-d.discountGross!==d.approvedGross||b.originalRetention-d.discountRetention!==d.approvedRetention||
    b.originalReceivable-d.discountReceivable!==d.approvedReceivable||
    b.originalGross-b.originalRetention!==b.originalReceivable||d.approvedGross-d.approvedRetention!==d.approvedReceivable||
    already>d.approvedReceivable||holdReceived>d.approvedRetention)fail('未稅、稅額、應收與保留款折讓勾稽不符');
  const projection={
   originalInvoice:{invoiceNo:txt(c.invoiceNo),untaxed:invoiceNet,tax:invoiceTax,gross:invoiceGross,status:'issued_unchanged'},
   allowance:{untaxed:d.discountNet,tax:d.discountTax,gross:d.discountGross},
   netSales:{untaxed:d.approvedNet,tax:d.approvedTax,gross:d.approvedGross},
   receivable:{recorded:originalAR,effective:d.approvedReceivable,received:already,outstanding:d.approvedReceivable-already,reduction:d.discountReceivable},
   retention:{recorded:b.originalRetention,effective:d.approvedRetention,received:holdReceived,outstanding:d.approvedRetention-holdReceived,reduction:d.discountRetention},
   customerDeductions:{additionalAmount:0,additionalCount:0},bank:{additionalTransactions:0,additionalIncome:0},
   commissions:{existingCount:state.commissions.length,recalculated:0,sourceUnchanged:true},
   payroll:{sourceUnchanged:true},status:'SANDBOX_ONLY_NO_POSTING'
  };
  const record={schema:'kushe-p37-5-dry-run-v1',idempotencyKey:key,billingId:id,receivableId:arId,invoiceId,invoiceNo:txt(c.invoiceNo),
   snapshot:txt(c.documentSnapshot),draftVersion:c.draftVersion,adjustment:{untaxed:-d.discountNet,tax:-d.discountTax,gross:-d.discountGross,receivable:-d.discountReceivable,retention:-d.discountRetention},status:'DRY_RUN_ONLY'};
  return {ok:true,postingEnabled:false,taxVoucherVerified:false,projection,record,previewLedger:[...ledger.map(x=>JSON.parse(JSON.stringify(x))),JSON.parse(JSON.stringify(record))]};
 }
 function inspect(id,previous=null){
  const auth=window.KusheAuthGate,user=auth?.user?.(),ctx=auth?.companyContext?.();
  if(!/(?:^|\/)beta(?:\/|$)/.test(txt(window.location?.pathname))||!user?.id||!ctx?.companyId||txt(ctx.userId)!==txt(user.id)||
    txt(ctx.legacySourceUserId)!==txt(user.id)||!auth.canWrite?.('billings'))fail('僅限 BETA 已驗證的請款編輯權限');
  const gate=window.KusheBillingAllowancePreflight?.preflight?.(id);
  if(!gate?.ok||!gate.context)fail('P37-3 安全檢查未通過：'+(gate?.issues||['來源待查']).join('；'));
  if(previous&&(previous.context?.billingId!==gate.context.billingId||previous.context?.invoiceNo!==gate.context.invoiceNo||
    previous.context?.documentSnapshot!==gate.context.documentSnapshot||previous.context?.draftVersion!==gate.context.draftVersion))fail('來源帳務或草稿版本已異動，請重新執行預檢');
  const state=window.KuSheERPStore?.getState?.();
  return {gate,result:pure(gate,state,[])};
 }
 function mount(section,billingId){
  if(!section?.parentElement||!billingId||section.parentElement.querySelector('.p37-link-panel'))return false;
  const box=document.createElement('section');box.className='p37-link-panel';
  box.innerHTML='<h3>P37-5｜議價折讓帳務串聯隔離模擬</h3>'+
   '<p>核對請款、已開立發票、應收及保留款。<b>客戶扣款、銀行、薪資及員工抽成不更動；沒有正式入帳功能。</b></p>'+
   '<div class="p37-link-actions"><button type="button" data-check>跨帳務唯讀查核</button><button type="button" data-run disabled>隔離串聯模擬（不入帳）</button></div>'+
   '<p class="p37-link-status" role="status">尚未執行查核；無須為模擬填入假的折讓憑證。</p><div class="p37-link-results" hidden></div>'+
   '<p class="p37-link-note">原發票不直接改價；只以獨立減項模擬折讓後淨銷售額。此畫面不代表正式稅務折讓已開立。</p>';
  const after=section.parentElement.querySelector('.p37v-check')||section;after.insertAdjacentElement('afterend',box);
  const status=$('.p37-link-status',box),result=$('.p37-link-results',box),checkButton=$('[data-check]',box),runButton=$('[data-run]',box);
  const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad)};
  let previous=null;
  checkButton.addEventListener('click',()=>{
   try{
    previous=inspect(billingId);runButton.disabled=false;result.hidden=false;
    result.textContent='原請款、應收、銷項發票與議價草稿來源一致；未發現已收款、支票或關聯銀行流水。';
    say('唯讀查核通過，可執行隔離模擬。',false);
   }catch(e){previous=null;runButton.disabled=true;result.hidden=false;result.textContent=e?.message||String(e);say('唯讀查核未通過，沒有修改 ERP 資料。',true)}
  });
  runButton.addEventListener('click',()=>{
   if(!previous)return;
   try{
    const checked=inspect(billingId,previous.gate),v=checked.result.projection;
    result.hidden=false;
    result.innerHTML='<p class="p37-link-ok">隔離模擬完成（尚未入帳）</p><dl class="p37-link-grid">'+[
     ['原請款／原發票含稅（不變）',v.originalInvoice.gross],
     ['獨立擬折讓（含稅）',-v.allowance.gross],
     ['獨立擬折讓稅額',-v.allowance.tax],
     ['折讓後未稅銷售額（模擬）',v.netSales.untaxed],
     ['折讓後營業稅（模擬）',v.netSales.tax],
     ['核定後含稅請款總額（模擬）',v.netSales.gross],
     ['有效本期應收（模擬）',v.receivable.effective],
     ['本期未收（模擬）',v.receivable.outstanding],
     ['有效保留款（模擬）',v.retention.effective],
     ['保留款待收（模擬）',v.retention.outstanding]
    ].map(([label,n])=>'<div><dt>'+esc(label)+'</dt><dd>'+ (n<0?'−':'')+money(Math.abs(n))+'</dd></div>').join('')+
    '</dl><p>新增客戶扣款 0 筆；新增銀行流水 0 筆；抽成重算 0 筆。原始資料全部保留。</p>'+
    '<p>本次只形成記憶體中的折讓預覽，發票與稅務資料沒有更新。</p>';
    runButton.disabled=true;say('隔離串聯模擬完成；沒有儲存、收款、同步或正式入帳。',false);
   }catch(e){runButton.disabled=true;say('模擬已停止：'+(e?.message||String(e)),true)}
  });
  return true;
 }
 window.KusheBillingLinkSimulation=Object.freeze({pure,inspect,mount});
})();
