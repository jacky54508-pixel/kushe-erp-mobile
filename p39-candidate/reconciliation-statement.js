/* P39-3C: read-only negotiation reconciliation statement and internal report.
 * Not a sales allowance certificate, invoice, tax filing or official PDF.
 * The original billing and issued invoice remain immutable.
 */
(function(root,factory){
 'use strict';
 const api=factory(typeof module==='object'&&module.exports?
   require('./effective-accounting.js'):root.KusheP393EffectiveAccounting);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.KusheP393ReconciliationStatement=api;
})(typeof window==='object'?window:{},function(effective){
 'use strict';
 const DOC='kushe-p39-3c-synthetic-reconciliation-v1';
 const label='虛構議價對帳摘要｜非統一發票、非正式折讓證明單';
 const text=v=>String(v??'').trim();
 const esc=s=>String(s??'').replace(/[&<>"']/g,k=>({
   '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[k]);
 const fmt=n=>Number(n).toLocaleString('zh-TW',{maximumFractionDigits:0});
 const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e};
 function read(state,billingId){
   if(state?.__p39Synthetic!=='kushe-p39-3-synthetic-fixture-v1'||
      state.meta?.p39SyntheticSchema!==state.__p39Synthetic)
     fail('P39_DOCUMENT_SYNTHETIC_ONLY','不可把正式 ERP 資料輸出為模擬折讓結算憑證');
   const v=effective.inspect(state,billingId);
   if(!v.hasAllowance||!v.synthetic||v.source!=='SYNTHETIC_CANDIDATE_LEDGER_ONLY')
     fail('P39_DOCUMENT_NO_VERIFIED_TEST_LEDGER','沒有可用的合成折讓分錄');
   const records=state.billingAllowances.filter(r=>text(r.billingId)===text(billingId));
   if(records.length!==1)fail('P39_DOCUMENT_LEDGER_DUPLICATE','找不到唯一折讓紀錄');
   const row=records[0],bill=state.billings.find(b=>text(b.id)===text(billingId));
   const review=row.evidenceReview;
   if(review?.schema!=='kushe-p39-3c-synthetic-tax-review-v1'||
      review?.productionPostingAllowed!==false||
      review?.externallyVerified!==false||
      review?.formalTaxFilingUpdated!==false)
     fail('P39_DOCUMENT_REVIEW_MISSING','正式稅務審查尚未完成，不能輸出對帳摘要');
   if(row.productionAuthorized!==false||row.officialVoucherVerified!==false)
     fail('P39_DOCUMENT_TAX_MISREPRESENTED','模擬紀錄不得宣稱已完成正式稅務處理');
   const date=review.reviewedAt,received=v.received,
     retentionReceived=v.retentionReceived;
   const columns=[
     {key:'untaxed',name:'未稅金額'},
     {key:'tax',name:'營業稅'},
     {key:'gross',name:'含稅請款總額'},
     {key:'retention',name:'保留款'},
     {key:'receivable',name:'本期應收'}
   ].map(x=>({key:x.key,name:x.name,original:v.original[x.key],
     allowance:v.allowance[x.key],effective:v.effective[x.key]}));
   if(columns.some(r=>r.original-r.allowance!==r.effective))
     fail('P39_DOCUMENT_UNBALANCED','對帳明細無法平衡');
   return Object.freeze({
     schema:DOC,heading:label,
     billingId:v.billingId,billingNo:text(bill.number),
     date,invoiceStatus:text(bill.invoiceStatus),originalInvoiceNo:text(bill.invoiceNo),
     reconciliationOnly:true,issuedAsTaxDocument:false,officialVoucherVerified:false,
     taxFilingUpdated:false,
     evidence:{agreementRef:text(review.agreementRef),
       reviewerRef:text(review.reviewerRef),
       voucherNo:text(review.voucher?.number),externalVerified:false},
     rows:columns,
     summary:{originalGross:v.original.gross,
       proposedDiscount:v.allowance.gross,proposedGross:v.effective.gross,
       currentReceivable:v.receivable,currentRetention:v.retention,
       received,retentionReceived,
       outstanding:v.outstanding,retentionOutstanding:v.retentionOutstanding},
     originalBillingModified:false,
     originalInvoiceModified:false,
     warning:'虛構測試資料；請保留原請款與原發票。正式電子折讓應另行完成電子開立、傳輸、存證與稅務核對。'
   });
 }
 function html(statement){
   if(statement?.schema!==DOC||statement.reconciliationOnly!==true||
      statement.issuedAsTaxDocument!==false)
     fail('P39_DOCUMENT_INVALID','文件不是安全對帳摘要');
   const rows=statement.rows.map(row=>'<tr><th>'+esc(row.name)+'</th>'+
     '<td>'+fmt(row.original)+'</td><td>−'+fmt(row.allowance)+'</td>'+
     '<td>'+fmt(row.effective)+'</td></tr>').join('');
   return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>'+
     esc(statement.heading)+'</title>'+
     '<style>body{font-family:system-ui,sans-serif;color:#183353;max-width:760px;margin:40px auto;padding:0 20px}'+
     'header{border-bottom:2px solid #234e84;padding-bottom:16px}h1{font-size:24px}'+
     '.warn{padding:12px;border:1px solid #bc7945;background:#fff7e9;margin:20px 0}'+
     'table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #dde5f0;text-align:right}'+
     'th:first-child{text-align:left}.muted{color:#60758c}'+
     '@media print{body{margin:10mm auto}.warn{border:1px solid #444}}</style></head><body>'+
     '<header><small class="muted">酷舍 ERP｜P39-3C 隔離虛構測試</small><h1>'+esc(statement.heading)+'</h1>'+
     '<p>原請款單號：'+esc(statement.billingNo)+'　對帳日期：'+esc(statement.date)+'</p>'+
     '<p>原發票號碼：'+esc(statement.originalInvoiceNo||'尚無正式發票號碼')+'</p></header>'+
     '<p class="warn">'+esc(statement.warning)+'</p>'+
     '<table><thead><tr><th>項目</th><th>原始</th><th>擬議折讓</th><th>有效試算</th></tr></thead><tbody>'+
     rows+'</tbody></table><p>本期應收未收：'+fmt(statement.summary.outstanding)+
     '　保留款未收：'+fmt(statement.summary.retentionOutstanding)+'</p>'+
     '<p class="muted">內部證據：'+esc(statement.evidence.agreementRef)+
     '｜覆核：'+esc(statement.evidence.reviewerRef)+
     '｜官方存證：未驗證</p></body></html>';
 }
 function summary(state){
   const records=Array.isArray(state?.billingAllowances)?state.billingAllowances:[];
   const result={recordCount:records.length,discountUntaxed:0,
     discountTax:0,discountGross:0,discountReceivable:0,
     discountRetention:0,officiallyTaxVerifiedCount:0,
     provisionalOnly:true};
   for(const row of records){
     const doc=read(state,row.billingId);
     const byKey=Object.fromEntries(doc.rows.map(r=>[r.key,r.allowance]));
     for(const [dest,source] of Object.entries({
       discountUntaxed:'untaxed',discountTax:'tax',discountGross:'gross',
       discountReceivable:'receivable',discountRetention:'retention'
     })){
       const next=result[dest]+byKey[source];
       if(!Number.isSafeInteger(next))fail('P39_DOCUMENT_SUM_OVERFLOW','合計金額溢位');
       result[dest]=next;
     }
   }
   return Object.freeze(result);
 }
 return Object.freeze({DOC,label,read,html,summary});
});