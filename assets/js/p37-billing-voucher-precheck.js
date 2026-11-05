(function voucherPrecheck(){
 'use strict';
 // P37-4: manual voucher information check in memory only; no ERP writes or official issuance.
 const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const str=v=>String(v??"").trim();
 const fmt=n=>"NT$"+Number(n||0).toLocaleString("zh-TW",{maximumFractionDigits:0});
 function dateValid(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));if(!m)return false;const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),v=new Date(Date.UTC(y,mo-1,d));return y>=2000&&y<=2100&&v.getUTCFullYear()===y&&v.getUTCMonth()+1===mo&&v.getUTCDate()===d}
 function today(){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+"-"+p.month+"-"+p.day}
 function check(id,values){
  const issues=[];
  const deny=s=>{if(!issues.includes(s))issues.push(s)};
  try{
   if(!/(?:^|\/)beta(?:\/|$)/.test(str(window.location?.pathname)))deny("此功能僅允許在 BETA");
   const auth=window.KusheAuthGate,person=auth?.user?.(),company=auth?.companyContext?.();
   if(!person?.id||!company?.companyId||str(company.userId)!==str(person.id)||str(company.legacySourceUserId)!==str(person.id)||!auth?.canWrite?.("billings"))deny("公司請款權限未通過驗證");
   const p37=window.KusheBillingAllowancePreflight,gate=p37?.preflight?.(id);
   if(!gate?.ok||!gate.context)deny("原始帳務預檢未通過："+(gate?.issues||["來源無法核對"]).join("；"));
   if(issues.length)return {ok:false,issues,postingEnabled:false,externallyVerified:false};
   const state=window.KuSheERPStore?.getState?.(),ctx=gate.context;
   if(!Array.isArray(state?.invoices))deny("找不到完整銷項發票資料");
   const invoices=(state?.invoices||[]).filter(x=>str(x.billingId)===str(ctx.billingId)||(str(x.sourceType)==="billing"&&str(x.sourceId)===str(ctx.billingId)));
   if(invoices.length!==1)deny("已開立的銷項發票來源不唯一");
   const invoice=invoices.length===1?invoices[0]:null;
   if(invoice&&str(invoice.invoiceNumber||invoice.number)!==str(ctx.invoiceNo))deny("原始發票號碼不一致");
   if(invoice&&str(invoice.status)!=="issued")deny("原始發票狀態不是已開立");
   const invoiceDate=str(invoice?.invoiceDate||invoice?.date);
   if(!dateValid(invoiceDate))deny("原發票日期不是有效日期");
   const v=values||{};
   const invoiceKind=str(v.invoiceKind),voucherKind=str(v.voucherKind),buyer=str(v.buyer),filing=str(v.filing),number=str(v.number).toUpperCase(),date=str(v.date);
   if(!["electronic","paper"].includes(invoiceKind))deny("請先確認原發票是電子或紙本");
   if(!["electronic","paper"].includes(voucherKind))deny("請選擇折讓憑證種類");
   if(["electronic","paper"].includes(invoiceKind)&&["electronic","paper"].includes(voucherKind)&&invoiceKind!==voucherKind)deny("原發票與折讓憑證種類不一致");
   if(!["business","consumer"].includes(buyer))deny("請確認買受人是否為營業人");
   if(!["reported","not_reported"].includes(filing))deny("請確認原發票銷售額是否已申報");
   if(!number||number.length>80||/[\x00-\x1f<>]/.test(number))deny("請依實際折讓單填寫有效憑證識別碼");
   if(number&&number===str(ctx.invoiceNo).toUpperCase())deny("折讓單識別碼不可直接沿用原發票號碼");
   if(!dateValid(date)||date<invoiceDate||date>today())deny("折讓單日期未填或早於原發票／晚於今天");
   if(v.agreement!==true)deny("請先確認雙方有折讓合意或證明");
   if(v.issued!==true)deny("請先確認折讓憑證已實際開立");
   if(voucherKind==="electronic"&&v.platform!==true)deny("電子折讓單尚未確認上傳平台存證");
   if(voucherKind==="paper"&&v.paperSigned!==true)deny("尚未確認買方出具／簽認紙本折讓證明");
   if(!str(v.proofLocation)||str(v.proofLocation).length>300)deny("請填寫原始憑證／平台存證檔的查核位置");
   const totals=p37?.simulatePure?.(gate,[]);
   if(!totals?.ok||totals.entry?.adjustment?.gross!==-ctx.draft.discountGross||totals.entry?.adjustment?.tax!==-ctx.draft.discountTax)deny("折讓金額、稅額與議價草稿無法勾稽");
   if(Array.isArray(state?.billingAllowances)&&state.billingAllowances.some(x=>str(x.voucherNo||x.reference)===number&&number))deny("折讓憑證識別碼與既有正式紀錄重複");
   return {ok:issues.length===0,issues,postingEnabled:false,externallyVerified:false,
     manualEvidence:issues.length?null:Object.freeze({
       invoiceNo:ctx.invoiceNo,invoiceKind,voucherKind,buyer,filing,number,date,
       agreement:v.agreement===true,issued:v.issued===true,platform:v.platform===true,
       paperSigned:v.paperSigned===true,proofLocation:str(v.proofLocation)
     }),
     originalInvoiceNo:ctx.invoiceNo,amounts:totals?.entry?.adjustment?{untaxed:-totals.entry.adjustment.untaxed,tax:-totals.entry.adjustment.tax,gross:-totals.entry.adjustment.gross}:null,
     note:"僅核對人工填寫的資料與 ERP 原始金額；不能證明財政部平台已存證或申報完成"};
  }catch(error){deny("安全檢查無法完成："+(error?.message||String(error)));return {ok:false,issues,postingEnabled:false,externallyVerified:false}}
 }
 function mount(section,billingId){
  if(!section?.insertAdjacentElement||!billingId||section.parentNode?.querySelector(".p37v-check"))return false;
  const box=document.createElement("section");box.className="p37v-check";box.setAttribute("aria-label","P37-4 憑證核對");
  box.innerHTML=`<h3>P37-4｜折讓憑證入帳前核對</h3>
   <p>先確認憑證類型、開立與存證資訊。<b>本階段資料只在視窗內檢查，不會儲存、開立憑證或正式入帳。</b></p>
   <div class="p37v-fields">
    <label>原發票種類<select data-p37v="invoiceKind"><option value="">尚未確認</option><option value="electronic">電子發票</option><option value="paper">紙本發票</option></select></label>
    <label>折讓憑證種類<select data-p37v="voucherKind"><option value="">尚未確認</option><option value="electronic">電子折讓單</option><option value="paper">紙本折讓證明單</option></select></label>
    <label>買受人身分<select data-p37v="buyer"><option value="">尚未確認</option><option value="business">營業人</option><option value="consumer">非營業人</option></select></label>
    <label>原發票申報狀態<select data-p37v="filing"><option value="">尚未確認</option><option value="reported">已申報</option><option value="not_reported">尚未申報</option></select></label>
    <label>折讓憑證識別碼<input data-p37v="number" maxlength="80" autocomplete="off" placeholder="依實際憑證，非原發票票號"></label>
    <label>折讓憑證開立日期<input data-p37v="date" type="date"></label>
   </div>
   <fieldset class="p37v-checks"><legend>依實際憑證確認</legend>
    <label><input type="checkbox" data-p37v="agreement"> 買賣雙方已有折讓合意證明</label>
    <label><input type="checkbox" data-p37v="issued"> 折讓憑證已實際開立</label>
    <label><input type="checkbox" data-p37v="platform"> 電子折讓單已上傳財政部平台（自行核對）</label>
    <label><input type="checkbox" data-p37v="paperSigned"> 已取得買方出具／簽認紙本折讓證明</label>
   </fieldset>
   <label class="p37v-proof">原始折讓憑證或平台存證資料位置<input data-p37v="proofLocation" maxlength="300" placeholder="例如：存證檔名或公司紙本資料夾"></label>
   <p class="p37v-note">電子折讓單依法須由賣方開立並傳輸存證，買方為營業人原則於開立翌日起算 7 日內上傳，非營業人為 2 日。本程式無法連線驗證平台資料；紙本仍須依申報狀態與買方身分個別確認。</p>
   <button type="button" class="p37v-run">核對憑證資訊（不入帳）</button>
   <p class="p37v-status" role="status">尚未核對；正式入帳維持關閉。</p>
   <div class="p37v-result" hidden></div>`;
  section.insertAdjacentElement("afterend",box);
  const field=name=>box.querySelector('[data-p37v="'+name+'"]'),out=box.querySelector(".p37v-status"),result=box.querySelector(".p37v-result");
  box.querySelector(".p37v-run").addEventListener("click",()=>{
   const names=["invoiceKind","voucherKind","buyer","filing","number","date","agreement","issued","platform","paperSigned","proofLocation"],v={};
   names.forEach(n=>{const x=field(n);v[n]=x.type==="checkbox"?x.checked:x.value});
   const report=check(billingId,v);result.hidden=false;
   if(report.ok){
        let reviewMessage="人工欄位與議價金額核對完成；尚未官方驗證、尚未入帳。";
    try {
      const final=window.KusheP376FinalGate?.validate?.(billingId);
      if(!final?.ok||final.postingEnabled!==false)throw new Error("P37-6 原帳務核對未通過");
      const plan=window.KusheP3710AllowancePlan?.makePlan?.(final.review);
      const state=window.KuSheERPStore?.getState?.();
      const doc=window.KuSheERPStore?.billingDocumentState?.(billingId);
      if(!doc||doc.issues?.length||doc.snapshot!==plan?.source?.snapshot)throw new Error("原帳務快照已變動");
      const bridge=window.KusheP3712LedgerBridge?.simulate?.(state,plan,doc.snapshot,state?.meta?.businessSnapshotRevision?.id);
      const packet=window.KusheP3715VoucherPacket?.prepare?.({
        plan,voucherReport:report,bridgeReport:bridge,state,
        documentSnapshot:doc.snapshot,revisionId:state?.meta?.businessSnapshotRevision?.id
      });
      if(!packet||packet.postable!==false||packet.officiallyVerified!==false||packet.cloudWrites!==0)
        throw new Error("P37-15 核對包未建立");
      window.KusheP3715VoucherPacket.ensureSame(packet,{plan,state,documentSnapshot:doc.snapshot,
        revisionId:state?.meta?.businessSnapshotRevision?.id});
      reviewMessage="P37-15 人工憑證資料與原請款已核對，待會計及官方存證確認；尚未入帳。";
      result.dataset.reviewReady="manual-only";
    }catch(error){
      reviewMessage="人工欄位核對通過，但 P37-15 來源安全核對未完成："+(error?.message||String(error))+"；沒有入帳。";
      result.dataset.reviewReady="blocked";
    }
    out.textContent=reviewMessage;
    result.innerHTML="<p>發票："+esc(report.originalInvoiceNo)+"｜未稅折讓 "+fmt(report.amounts.untaxed)+"｜稅額 "+fmt(report.amounts.tax)+"｜含稅折讓 "+fmt(report.amounts.gross)+"</p><p>仍須會計確認實際憑證與財政部存證情形。正式入帳不開放。</p>";
   }else{
    out.textContent="安全檢查未通過，沒有修改任何 ERP 資料。";
    result.innerHTML="<p>請補齊或核對：</p><ul>"+report.issues.map(x=>"<li>"+esc(x)+"</li>").join("")+"</ul>";
   }
  });
  return true;
 }
 window.KusheBillingVoucherPrecheck=Object.freeze({check,mount});
})();
