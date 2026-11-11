/* P39-3C: synthetic voucher and negotiation evidence preflight.
 * IMPORTANT: Not an e-invoice integration or official verification service.
 * Taiwan-issued electronic allowance documents require external creation/
 * transmission/retention by the relevant system. This module NEVER asserts
 * that an official tax document exists or that tax was reported.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KusheP393VoucherReview=api;
})(typeof window==='object'?window:{},function(){
  'use strict';
  const POLICY='kushe-p39-3c-synthetic-tax-review-v1';
  function fail(code,message){const e=new Error(message);e.code=code;throw e}
  const val=x=>typeof x==='string'?x.trim():'';
  function syntheticRef(value,label){
    const s=val(value);
    if(!/^SYN-[A-Z0-9][A-Z0-9._-]{2,79}$/.test(s))
      fail('P39_EVIDENCE_REF_INVALID',label+'必須是虛構測試識別碼');
    return s;
  }
  function date(value){
    const s=val(value),time=Date.parse(s+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(time)||
       new Date(time).toISOString().slice(0,10)!==s)
      fail('P39_EVIDENCE_DATE_INVALID','核對日期無效');
    return s;
  }
  function inspect(plan,evidence){
    if(!plan||plan.kind!=='allowance'||
       !['invoice_pending','no_invoice','invoiced'].includes(plan.invoiceStatus))
      fail('P39_PLAN_INVALID','議價計畫及發票狀態無法確認');
    if(!Number.isSafeInteger(plan.discount?.gross)||plan.discount.gross<=0||
       plan.debit!==plan.credit||plan.debit!==plan.discount.gross)
      fail('P39_LEDGER_UNBALANCED','折讓金額必須借貸平衡');
    if(!evidence||evidence.synthetic!==true||evidence.actualAuthorityVerified===true||
       evidence.productionAuthorized===true)
      fail('P39_EXTERNAL_VERIFICATION_FORBIDDEN','不可將測試確認冒充正式稅務驗證');
    const agreement=syntheticRef(evidence.agreementRef,'買賣雙方議價依據');
    const operator=syntheticRef(evidence.reviewerRef,'覆核者');
    const reviewedAt=date(evidence.reviewedAt);
    let voucher=null;
    if(plan.invoiceStatus==='invoiced'){
      if(!val(plan.invoiceNo)||plan.voucher?.synthetic!==true||
         plan.voucher.status!=='TEST_VERIFIED_ONLY')
        fail('P39_INVOICE_VOUCHER_REQUIRED','已開票須有獨立的虛構折讓證明單');
      const supplied=evidence.externalAllowance;
      if(!supplied||supplied.synthetic!==true||
         supplied.transport!=='SIMULATED_ELECTRONIC_FLOW'||
         supplied.originalInvoiceNo!==plan.invoiceNo||
         supplied.number!==plan.voucher.number||
         supplied.date!==plan.voucher.date||
         supplied.type!==plan.voucher.type)
        fail('P39_INVOICE_VOUCHER_MISMATCH','折讓單與原始發票或外部證明不一致');
      syntheticRef(supplied.number,'電子折讓證明單號');
      voucher={number:supplied.number,date:date(supplied.date),type:supplied.type,
        transport:'SIMULATED_ELECTRONIC_FLOW',originalInvoiceNo:supplied.originalInvoiceNo,
        officialPlatformConfirmed:false};
    }else if(evidence.externalAllowance||plan.voucher){
      fail('P39_UNEXPECTED_TAX_VOUCHER','未開票流程不得偽造已開電子折讓單');
    }
    const normalized={
      schema:POLICY,kind:'SYNTHETIC_MANUAL_EVIDENCE_REVIEW',
      agreementRef:agreement,reviewerRef:operator,reviewedAt,
      originalInvoiceNo:plan.invoiceNo||'',voucher,
      externallyVerified:false,formalTaxFilingUpdated:false,
      productionPostingAllowed:false,synthetic:true
    };
    return Object.freeze(normalized);
  }
  return Object.freeze({POLICY,inspect});
});