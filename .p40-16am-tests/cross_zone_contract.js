/* P40-16AM: actual published cross-zone customer-only print view contract.
 * Executed ONLY by an isolated localhost harness; never loaded by formal ERP.
 * Uses the UNMODIFIED official validate() and originalTemplateView() functions
 * extracted from main by the test runner. NO snapshot, invoice, payroll,
 * salary, bank, auth or origin-project list is passed to PDF renderer.
 */
(function(root){
'use strict';
const fail=reason=>{const e=new Error(reason);e.code=reason;throw e;};
const integer=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const clean=v=>String(v??'').trim();
const forbidden=/(PRIVATE-(?:INVOICE|BANK|SALARY|PAYROLL|TOKEN|COMMISSION|SNAPSHOT)|invoiceNo|invoiceRefs|sourceSnapshots|settlementSnapshots|access_token|service_role|refresh_token)/i;
const amountKeys=['salesAmount','taxAmount','totalAmount','retentionAmount','receivableAmount'];
function normalizeCustomerOnly(payload){
  if(!root.P40AMOfficial?.validate||!root.P40AMOfficial?.originalTemplateView)
    fail('PUBLISHED_FUNCTIONS_NOT_AVAILABLE');
  if(payload?.historical===true||payload?.document?.status!=='active')
    fail('ARCHIVED_COPY_REQUIRES_SEPARATE_REVIEW');
  const d=root.P40AMOfficial.validate(payload);
  if(d.schema!=='kushe-external-billing-group-v2'||d.detailMode!=='unified')
    fail('OLDER_SECTIONS_NEED_SEPARATE_VALIDATION');
  // Official source-invoice projection is invoked inside originalTemplateView
  // but must NEVER flow into public customer PDF data.
  const view=root.P40AMOfficial.originalTemplateView(payload,d);
  if(view.schema!=='kushe-external-document-v1'
      ||view.documentType!=='billing'
      ||view.isMergedExternalBilling!==true
      ||!Array.isArray(view.mergedBillingProjects)
      ||view.mergedBillingProjects.length!==1
      ||view.mergedBillingProjects[0]!==d.displayProjectName
      ||view.project!==d.displayProjectName
      ||view.number!=='')fail('CUSTOMER_SCOPE_NOT_SINGLE_SELECTED_PROJECT');
  if(!d.sourceSnapshots.some(s=>s.billingId===d.targetBillingId
    &&s.projectName===d.displayProjectName))fail('MISSING_AUTHORIZED_TARGET_SOURCE');
  if(!clean(view.project)||!clean(view.customer)||!clean(view.date))
    fail('PUBLIC_HEADER_MISSING');
  if(view.taxMode!==d.unified.taxMode)fail('TAX_MODE_DIFFERENT_FROM_UNIFIED');
  const amounts={};
  const map={
    salesAmount:'untaxed',taxAmount:'tax',totalAmount:'grossTotal',
    retentionAmount:'retention',receivableAmount:'receivable'
  };
  for(const k of amountKeys){
    if(!integer(view[k])||view[k]!==d.totals[map[k]])
      fail('APPROVED_AMOUNT_CHANGED');
    amounts[k]=view[k];
  }
  if(amounts.salesAmount+amounts.taxAmount!==amounts.totalAmount
      ||amounts.totalAmount-amounts.retentionAmount!==amounts.receivableAmount)
    fail('APPROVED_AMOUNT_RELATIONS_INVALID');
  if(!Array.isArray(view.lines)||view.lines.length!==d.unified.lines.length
      ||view.lines.length<1||view.lines.length>40)
    fail('ORIGINAL_DETAIL_COUNT_CHANGED_OR_EXCESSIVE');
  const lines=view.lines.map((l,i)=>{
    const reference=d.unified.lines[i];
    if(!clean(l.house)||!clean(l.item)||!clean(l.unit)
        ||!integer(l.amount)||!Number.isFinite(l.qty)||l.qty<=0
        ||!Number.isFinite(l.price)||l.price<0
        ||l.house!==String(reference.house||'')
        ||l.item!==reference.item||l.unit!==reference.unit
        ||l.qty!==reference.qty||l.price!==reference.price
        ||l.amount!==reference.amount)
      fail('ORIGINAL_DETAIL_CHANGED_OR_MISSING');
    if(l.sourcePricingType!=='external-document'
        &&l.sourcePricingType!=='historical-supplement')
      fail('UNEXPECTED_DETAIL_SOURCE_TYPE');
    return {
      house:l.house,item:l.item,unit:l.unit,
      qty:l.qty,price:l.price,amount:l.amount,
      sourcePricingType:l.sourcePricingType
    };
  });
  const printedTotal=lines.reduce((sum,l)=>sum+l.amount,0);
  const requiredTotal=view.taxMode==='含稅'?amounts.totalAmount:amounts.salesAmount;
  if(printedTotal!==requiredTotal)fail('DISPLAYED_DETAIL_TOTAL_DIFFERENT');
  // Official dense customer summary groups by source classification, not by
  // origin billing number, and shows only the selected public project name.
  const groups=new Map();
  for(const l of lines){
    const key=JSON.stringify([l.item,l.unit,l.price,l.sourcePricingType]);
    if(!groups.has(key))groups.set(key,{
      item:l.item,unit:l.unit,qty:0,price:l.price,
      amount:0,sourcePricingType:l.sourcePricingType
    });
    const g=groups.get(key);g.qty+=l.qty;g.amount+=l.amount;
  }
  const summary=[...groups.values()];
  if(summary.reduce((sum,l)=>sum+l.amount,0)!==printedTotal)
    fail('BOTTOM_SUMMARY_TOTAL_MISMATCH');
  const company={};
  for(const k of ['name','englishName','taxId','address','phone','line'])
    if(typeof view.company?.[k]==='string')company[k]=view.company[k];
  const out={
    schema:'kushe-p40am-customer-cross-zone-test-v1',
    project:view.project,customer:view.customer,date:view.date,
    taxMode:view.taxMode,invoiceStatus:view.invoiceStatus,
    publicNote:clean(view.publicNote),company,lines,summary,amounts,
    displayDetailTotal:requiredTotal,
    customerProjects:[view.project],
    flags:{historical:false,ordinaryCombined:false,releaseApproved:false}
  };
  if(forbidden.test(JSON.stringify(out)))fail('PRIVATE_DATA_LEAK_IN_CUSTOMER_VIEW');
  return out;
}
root.P40AM={normalizeCustomerOnly};
})(window);
