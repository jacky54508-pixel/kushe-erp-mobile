/* P40-16AL — lab-only, read-only public combined billing contract.
 * Receives ONLY actual published KusheBillingBundlePrint.buildCombinedView()
 * output from fictitious originals. No ERP write, cloud access or production
 * authorization. Never flattens separate original billing documents.
 */
(function(root){
'use strict';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const name=v=>String(v??'').trim();
const forbidden=/(?:PRIVATE-(?:INVOICE|BANK|SALARY|PAYROLL|COMMISSION|TOKEN|SNAPSHOT)|access_token|refresh_token|sourceSnapshots|invoiceNo|invoiceRefs|bankAccount|service_role)/i;
const status=new Set(['no_invoice','invoice_pending','invoiced']);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100));
const cents=v=>Math.round(v*100);
const moneyFields=['salesAmount','taxAmount','totalAmount','retentionAmount','receivableAmount'];
const almost=(a,b)=>Math.abs(cents(a)-cents(b))<=1;
const lineCols=['house','item','unit','qty','price','amount','sourcePricingType','pricingType'];

function normalize(combined,trust){
  if(!trust||trust.approvedByTrustedCaller!==true||trust.syncState!=='SYNCED'
      ||trust.lifecycleStatus!=='active')fail('UNVERIFIED_SOURCE_CONTEXT');
  const d=combined;
  if(!d||d.schema!=='kushe-combined-billing-v1'
      ||d.documentType!=='combined-billing')fail('NOT_GENERAL_COMBINED_BILLING');
  if(d.isMergedExternalBilling===true||d.sourceSnapshots||d.invoiceReferences)
    fail('CROSS_ZONE_OR_HISTORICAL_MUST_BE_ISOLATED');
  if(!Array.isArray(d.billings)||d.billings.length<2||d.billings.length>8)
    fail('INVALID_SOURCE_BILLING_COUNT');
  if(!Array.isArray(d.projects)||!d.projects.length)
    fail('PROJECT_SET_MISSING');
  if(!name(d.customer)||!name(d.customerId)||!name(d.dateStart)||!name(d.dateEnd))
    fail('PUBLIC_HEADER_MISSING');
  const used=new Set();
  const bills=[];
  for(const doc of d.billings){
    if(!doc||!name(doc.billingId)||!name(doc.number)||!name(doc.projectId)
       ||!name(doc.projectName)||!name(doc.date))fail('ORIGINAL_IDENTITY_MISSING');
    if(used.has(doc.billingId))fail('DUPLICATE_ORIGINAL_BILL');
    used.add(doc.billingId);
    if(!d.projects.some(p=>name(p.id)===name(doc.projectId)
      && name(p.name)===name(doc.projectName)))fail('PROJECT_NOT_IN_APPROVED_LIST');
    if(!['未稅','含稅'].includes(doc.taxMode))fail('UNSUPPORTED_TAX_MODE');
    if(!status.has(doc.invoiceStatus))fail('UNSUPPORTED_INVOICE_STATUS');
    const amounts={};
    for(const k of moneyFields){
      if(!num(doc[k]))fail('INVALID_APPROVED_BILLING_AMOUNT');
      amounts[k]=doc[k];
    }
    if(!almost(amounts.salesAmount+amounts.taxAmount,amounts.totalAmount)
       ||!almost(amounts.totalAmount-amounts.retentionAmount,amounts.receivableAmount))
      fail('ORIGINAL_TOTAL_MISMATCH');
    if(!Array.isArray(doc.lines)||!doc.lines.length||doc.lines.length>25)
      fail('ORIGINAL_LINES_REQUIRED');
    const original=doc.lines.map(l=>{
      if(!l||!name(l.house)||!name(l.item)||!name(l.unit)||!num(l.amount))
        fail('ORIGINAL_LINE_INVALID');
      if(l.qty!==null&&l.qty!==undefined
          &&(!num(l.qty)||l.qty<=0))fail('ORIGINAL_QUANTITY_INVALID');
      if(l.price!==null&&l.price!==undefined&&!num(l.price))
        fail('ORIGINAL_UNIT_PRICE_INVALID');
      const out={};
      for(const k of lineCols) {
        if(k==='qty'||k==='price'||k==='amount')out[k]=l[k]??(k==='amount'?0:null);
        else out[k]=name(l[k]);
      }
      if((out.qty===null||out.price===null)
          &&out.sourcePricingType!=='historical-supplement')
        fail('NON_HISTORICAL_MISSING_PRICING');
      return out;
    });
    // Do not recompute any approved billing number; check its displayed
    // original lines against the official printer's untaxed/gross basis.
    const detailSum=original.reduce((a,l)=>a+cents(l.amount),0);
    const detailBase=doc.taxMode==='含稅'&&doc.invoiceStatus!=='no_invoice'
      ?amounts.totalAmount:amounts.salesAmount;
    if(Math.abs(detailSum-cents(detailBase))>1)
      fail('ORIGINAL_LINES_NOT_MATCHING_APPROVED_BILL');
    bills.push({
      billingId:name(doc.billingId),number:name(doc.number),
      projectId:name(doc.projectId),projectName:name(doc.projectName),
      date:name(doc.date),taxMode:doc.taxMode,invoiceStatus:doc.invoiceStatus,
      publicNote:name(doc.publicNote),lines:original,amounts,
      displayDetailTotal:detailBase
    });
  }
  const totals={};
  for(const k of moneyFields){
    if(!num(d.totals?.[k]))fail('MISSING_COMBINED_TOTAL');
    const summed=bills.reduce((a,b)=>a+cents(b.amounts[k]),0);
    if(Math.abs(summed-cents(d.totals[k]))>1)fail('COMBINED_TOTAL_MISMATCH');
    totals[k]=d.totals[k];
  }
  if(!almost(totals.salesAmount+totals.taxAmount,totals.totalAmount)
      ||!almost(totals.totalAmount-totals.retentionAmount,totals.receivableAmount))
    fail('COMBINED_RELATION_MISMATCH');
  const company={};
  for(const k of ['name','englishName','taxId','address','phone','line']){
    if(typeof d.company?.[k]==='string')company[k]=d.company[k];
  }
  // Summary preserves originating project and classification. It is a lab
  // extension for comparison, NOT proof of identical official PDF formatting.
  const groups=new Map();
  for(const bill of bills)for(const l of bill.lines){
    const key=JSON.stringify([bill.projectId,l.item,l.unit,l.price,l.sourcePricingType]);
    if(!groups.has(key))groups.set(key,{
      projectName:bill.projectName,projectId:bill.projectId,
      item:l.item,unit:l.unit,price:l.price,
      sourcePricingType:l.sourcePricingType,qty:0,amount:0
    });
    const g=groups.get(key);g.qty+=l.qty??0;g.amount+=l.amount;
  }
  const summary=[...groups.values()];
  const expectedSummary=bills.reduce((s,b)=>s+cents(b.displayDetailTotal),0);
  if(Math.abs(summary.reduce((s,g)=>s+cents(g.amount),0)-expectedSummary)>1)
    fail('SUMMARY_NOT_MATCHING_SOURCE');
  const exposed={
    schema:'kushe-p40al-general-combined-lab-v1',
    customer:name(d.customer),dateStart:name(d.dateStart),dateEnd:name(d.dateEnd),
    projects:d.projects.map(p=>({id:name(p.id),name:name(p.name)})),
    billings:bills,summary,totals,company,
    flags:{safeForProduction:false,historicalSupported:false,
      crossZoneMergedSupported:false}
  };
  // Sanitize only. The policy forbids private markers even when planted
  // in an otherwise public note, item name or company heading.
  if(forbidden.test(JSON.stringify(exposed)))fail('PRIVATE_DATA_IN_PUBLIC_OUTPUT');
  return exposed;
}
root.P40AL={normalize};
})(window);
