(function p3715VoucherPacket(){
 'use strict';
 // P37-15: a fully read-only manual evidence packet. NOT tax-platform confirmation, not a posting API.
 const SCHEMA='kushe-p37-15-voucher-review-packet-v1';
 const t=x=>String(x??'').trim();
 const clone=x=>JSON.parse(JSON.stringify(x));
 const integer=(v,label)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new Error(label+'金額格式有誤');return v};
 function stop(msg){throw new Error(msg)}
 function dateValid(v){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(t(v));if(!m)return false;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return +m[1]>=2000&&+m[1]<=2100&&d.getUTCFullYear()===+m[1]&&d.getUTCMonth()+1===+m[2]&&d.getUTCDate()===+m[3]}
 function prepare({plan,voucherReport,bridgeReport,state,documentSnapshot,revisionId}){
  if(!plan||plan.schema!=='kushe-p37-10-allowance-plan-v1'||plan.mode!=='BETA_REVIEW_ONLY'||
     plan.postingEnabled!==false||plan.taxVoucherVerified!==false||plan.cloudWrites!==0||
     !plan.originalInvoiceUnchanged||!plan.receiptsUnchanged||!plan.bankUnchanged||
     !plan.customerDeductionsUnchanged||!plan.commissionsUnchanged||!plan.payrollUnchanged)
   stop('P37-10 未通過來源帳務門禁');
  if(!bridgeReport||bridgeReport.schema!=='kushe-p37-12-synthetic-bridge-v1'||
    bridgeReport.ok!==true||bridgeReport.postingEnabled!==false||bridgeReport.cloudWrites!==0||
    bridgeReport.formalReceiptReaderConnected!==false||!bridgeReport.originalStateUnchanged)
   stop('P37-12 隔離帳務尚未通過驗證');
  const s=plan.source||{},a=plan.allowance||{},e=plan.effective||{},v=voucherReport?.manualEvidence;
  if(voucherReport?.ok!==true||voucherReport.postingEnabled!==false||
    voucherReport.externallyVerified!==false||!v)
   stop('P37-4 尚未完成人工憑證欄位核對');
  if(!t(s.billingId)||!t(s.billingNo)||!t(s.receivableId)||!t(s.invoiceId)||!t(s.invoiceNo)||
     !t(s.snapshot)||!Number.isSafeInteger(s.draftVersion)||s.draftVersion<1||
     t(documentSnapshot)!==t(s.snapshot)||plan.idempotencyKey!=='billing-allowance::'+t(s.billingId)+'::'+t(s.invoiceNo))
   stop('議價草稿來源或帳務版本不同');
  if(!state||!Array.isArray(state.billings)||!Array.isArray(state.receivables)||!Array.isArray(state.invoices))
   stop('來源 ERP 資料尚未載入');
  const bill=state.billings.filter(x=>t(x?.id)===s.billingId),
        ar=state.receivables.filter(x=>t(x?.id)===s.receivableId),
        invoice=state.invoices.filter(x=>t(x?.id)===s.invoiceId);
  if(bill.length!==1||ar.length!==1||invoice.length!==1)stop('原請款、應收或發票未能唯一對應');
  if(t(bill[0].number)!==s.billingNo||t(bill[0].receivableId)!==s.receivableId||
     t(ar[0].billingId)!==s.billingId||t(invoice[0].invoiceNumber||invoice[0].number)!==s.invoiceNo||
     t(invoice[0].status)!=='issued')
   stop('原始請款、應收或正式發票關聯已變動');
  if(!['electronic','paper'].includes(v.invoiceKind)||v.invoiceKind!==v.voucherKind||
     !['business','consumer'].includes(v.buyer)||!['reported','not_reported'].includes(v.filing)||
     !/^[^\u0000-\u001f<>]{1,80}$/.test(t(v.number))||t(v.number).toUpperCase()!==t(v.number)||
     !dateValid(v.date)||!t(v.proofLocation)||t(v.proofLocation).length>300||
     v.agreement!==true||v.issued!==true||
     (v.voucherKind==='electronic'&&v.platform!==true)||
     (v.voucherKind==='paper'&&v.paperSigned!==true))
   stop('人工折讓憑證欄位不完整或格式異常');
  if(t(v.number)===t(s.invoiceNo).toUpperCase()||t(voucherReport.originalInvoiceNo)!==s.invoiceNo||
     t(v.invoiceNo)!==s.invoiceNo)
   stop('折讓識別碼或原發票來源不一致');
  const sum=voucherReport.amounts||{};
  for(const k of ['untaxed','tax','gross']){integer(sum[k],'憑證折讓'+k);integer(a[k],'議價折讓'+k);if(sum[k]!==a[k])stop('折讓憑證金額與議價草稿不一致')}
  if(a.untaxed+a.tax!==a.gross||a.receivable+a.retention!==a.gross||e.receivable+e.retention!==e.gross)
   stop('憑證與應收、保留款無法勾稽');
  if(!bridgeReport.ledgerEntry||bridgeReport.ledgerEntry.idempotencyKey!==plan.idempotencyKey||
     bridgeReport.ledgerEntry.reduction?.gross!==a.gross||
     bridgeReport.effective?.gross!==e.gross||
     bridgeReport.effective?.receivable!==e.receivable||
     bridgeReport.effective?.retention!==e.retention)
   stop('折讓帳本與憑證核對的金額或來源不同');
  if(t(revisionId)!==t(state.meta?.businessSnapshotRevision?.id))
   stop('ERP 業務快照版本已變動，請重新核對');
  if(!Array.isArray(state.billingAllowances)&&state.billingAllowances!==undefined)stop('正式折讓紀錄格式有誤');
  for(const key of ['billingAllowances','billingNegotiationAdjustments','salesAllowances','salesCreditNotes']){
   const records=state[key];
   if(records===undefined)continue;
   if(!Array.isArray(records))stop('已存在的折讓資料集格式有誤');
   if(records.some(r=>{
    if(!r||typeof r!=='object')return false;
    const src=r.source||{};
    return [r.billingId,src.billingId].some(x=>t(x)===s.billingId)||
     [r.receivableId,src.receivableId].some(x=>t(x)===s.receivableId)||
     [r.invoiceNo,src.invoiceNo].some(x=>t(x)===s.invoiceNo)||
     [r.voucherNo,r.reference,r.number,src.voucherNo].some(x=>t(x).toUpperCase()===v.number);
   }))stop('已有同請款、原發票或折讓憑證識別碼，禁止重複申請');
  }
  // This packet is a transient, explicit request for independent document review only.
  // Nothing in this result is an authorization to post, or evidence of official platform verification.
  return {
   schema:SCHEMA,status:'PENDING_ACCOUNTANT_AND_OFFICIAL_CONFIRMATION',
   companyDataWritten:false,cloudWrites:0,postable:false,postingEnabled:false,officiallyVerified:false,
   idempotencyKey:plan.idempotencyKey,
   source:{billingId:s.billingId,billingNo:s.billingNo,receivableId:s.receivableId,
    invoiceId:s.invoiceId,invoiceNo:s.invoiceNo,documentSnapshot:s.snapshot,
    draftVersion:s.draftVersion,revisionId:t(revisionId)},
   manualVoucher:{number:t(v.number),date:v.date,invoiceKind:v.invoiceKind,
    voucherKind:v.voucherKind,buyer:v.buyer,filing:v.filing,agreement:true,issued:true,
    platformAttested:v.platform===true,paperSignedAttested:v.paperSigned===true,
    proofLocation:t(v.proofLocation),confirmationType:'SELF_REPORTED_NOT_EXTERNALLY_VERIFIED'},
   amounts:{untaxed:a.untaxed,tax:a.tax,gross:a.gross,
    receivableReduction:a.receivable,retentionReduction:a.retention,
    effectiveReceivable:e.receivable,effectiveRetention:e.retention},
   pending:['會計核對實際憑證原件與稅務適用規則',
    '主管另行授權正式入帳','ERP 原子寫入及跨裝置同步驗收']
  };
 }
 function ensureSame(packet,{plan,state,documentSnapshot,revisionId}){
  if(packet?.schema!==SCHEMA||packet.postable!==false||packet.postingEnabled!==false||
    packet.officiallyVerified!==false||packet.companyDataWritten!==false||packet.cloudWrites!==0)
   stop('核對包不是未入帳的安全狀態');
  const s=packet.source||{},p=plan?.source||{};
  if(s.billingId!==p.billingId||s.receivableId!==p.receivableId||
     s.invoiceNo!==p.invoiceNo||s.documentSnapshot!==p.snapshot||
     s.draftVersion!==p.draftVersion||s.revisionId!==t(revisionId)||
     s.documentSnapshot!==t(documentSnapshot)||s.revisionId!==t(state?.meta?.businessSnapshotRevision?.id))
   stop('核對包來源或 ERP 資料已變動，禁止使用舊版本');
  if(packet.amounts?.gross!==plan.allowance?.gross||packet.amounts?.tax!==plan.allowance?.tax||
     packet.amounts?.effectiveReceivable!==plan.effective?.receivable||
     packet.amounts?.effectiveRetention!==plan.effective?.retention)
   stop('核對包金額已過期');
  return true;
 }
 window.KusheP3715VoucherPacket=Object.freeze({prepare,ensureSame});
})();