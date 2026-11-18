/* P40-16AJ — source-preserving single-billing adapter LAB ONLY.
 * Prepared for the existing published builder's external view, but not wired
 * to any production ERP/print module. No network, storage, print or mutation.
 * An adapter is NOT a PDF renderer, a JWT verifier, or an accounting authority.
 * Output must NOT be passed to the P40-16AH PDF renderer without new real PDF
 * testing; this adapter intentionally models cases AH currently cannot render.
 */
(function(root){
  'use strict';
  const fail=(why)=>{const err=new Error(why);err.code=why;throw err;};
  const privateMarker=/(PRIVATE-(?:INVOICE|BANK|PAYROLL|COMMISSION|TOKEN|SNAPSHOT)|access_token|refresh_token|service_role)/i;
  const acceptableKinds=new Set(['','historical-supplement','external-document','actual','lump_sum']);
  const moneyKeys=['salesAmount','taxAmount','totalAmount','retentionAmount','receivableAmount'];
  const text=v=>String(v==null?'':v);
  const almost=(a,b)=>Math.abs(a-b)<.01;
  const finiteMoney=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100));
  const decimal4=n=>Math.abs(n*10000-Math.round(n*10000))<.0001;

  function normalizeSingle(publishedView,trust){
    if(!trust || trust.approvedByTrustedCaller!==true || trust.lifecycleStatus!=='active'
       || trust.syncState!=='SYNCED')fail('UNVERIFIED_CONTEXT');
    const d=publishedView;
    if(!d||d.schema!=='kushe-external-document-v1'||d.documentType!=='billing')fail('NOT_SINGLE_BILLING');
    if(d.isMergedExternalBilling===true||d.sourceInvoiceReferences!=null
       ||Array.isArray(d.mergedBillingProjects))fail('MERGED_OR_HISTORICAL_REQUIRES_OWN_ADAPTER');
    if(!['未稅','含稅'].includes(d.taxMode))fail('UNKNOWN_TAX_MODE');
    if(!['no_invoice','invoice_pending','invoiced'].includes(d.invoiceStatus))fail('UNKNOWN_INVOICE_SWITCH');
    if(typeof d.pricingMode!=='string')fail('UNKNOWN_PRICING_SWITCH');
    if(!Array.isArray(d.lines)||d.lines.length<1||d.lines.length>50)fail('INVALID_LINES');
    if(!d.company||typeof d.company!=='object'||Array.isArray(d.company))fail('INVALID_COMPANY');
    const amounts={};
    for(const key of moneyKeys){
      if(!finiteMoney(d[key]))fail('INVALID_APPROVED_AMOUNT');
      amounts[key]=d[key];
    }
    if(!almost(amounts.salesAmount+amounts.taxAmount,amounts.totalAmount)
       ||!almost(amounts.totalAmount-amounts.retentionAmount,amounts.receivableAmount))
      fail('APPROVED_TOTAL_RELATION_INCONSISTENT');
    const lines=d.lines.map((src,index)=>{
      if(!src||typeof src!=='object'||Array.isArray(src))fail('INVALID_LINE');
      const item=text(src.item).trim(),house=text(src.house).trim(),unit=text(src.unit).trim();
      if(!item||!house||!unit)fail('EMPTY_SOURCE_IDENTITY');
      const qty=src.qty==null?null:src.qty;
      const price=src.price==null?null:src.price;
      if(qty!==null&&(!Number.isFinite(qty)||qty<=0||!decimal4(qty)))fail('INVALID_QUANTITY');
      if(price!==null&&(!Number.isFinite(price)||price<0||!decimal4(price)))fail('INVALID_UNIT_PRICE');
      if(!finiteMoney(src.amount))fail('INVALID_ORIGINAL_LINE_AMOUNT');
      const kind=text(src.sourcePricingType);
      if(!acceptableKinds.has(kind))fail('UNKNOWN_SOURCE_PRICING_TYPE');
      if((qty===null||price===null)&&kind!=='historical-supplement'&&src.amount>0)
        fail('MISSING_PRICING_BASIS');
      // Never force qty*price=amount here: the published ERP has explicit
      // historic and approved amounts. Preserve the exact original value.
      return Object.freeze({
        house,item,unit,qty,price,amount:src.amount,sourcePricingType:kind,
        pricingType:text(src.pricingType)
      });
    });
    const taxShown=d.invoiceStatus!=='no_invoice';
    const detailTotal=taxShown&&d.taxMode==='含稅'?amounts.totalAmount:amounts.salesAmount;
    const originalSum=lines.reduce((total,row)=>total+row.amount,0);
    if(!almost(originalSum,detailTotal))fail('ORIGINAL_LINES_DO_NOT_MATCH_PUBLISHED_DETAIL_TOTAL');
    const company={};
    for(const key of ['name','englishName','taxId','address','phone','line']){
      if(typeof d.company[key]==='string')company[key]=d.company[key];
    }
    const view={
      schema:'kushe-p40aj-single-billing-adapter-v1',
      sourceSchema:d.schema,documentType:d.documentType,
      title:text(d.title),customer:text(d.customer),
      project:text(d.project),date:text(d.date),
      taxMode:d.taxMode,invoiceStatus:d.invoiceStatus,pricingMode:d.pricingMode,
      publicNote:text(d.publicNote),company,lines,amounts,
      display:{showTax:taxShown,originalDetailTotal:detailTotal,
               customerSelectedProjectOnly:d.project,showRetention:amounts.retentionAmount>0}
    };
    if(!view.customer||!view.project||!view.date)fail('MISSING_PUBLIC_HEADER');
    // Catch accidental INTERNAL data in allowed notes or line labels.
    if(privateMarker.test(JSON.stringify(view)))fail('PRIVATE_DATA_IN_PUBLIC_PROJECTION');
    return view;
  }

  // Exact dense printed summary grouping: item+unit+price+sourcePricingType.
  // Do NOT group two different pricing source types just because totals equal.
  function denseSummary(view){
    if(view?.schema!=='kushe-p40aj-single-billing-adapter-v1')fail('NOT_ADAPTED_VIEW');
    const grouped=new Map();
    for(const l of view.lines){
      const key=JSON.stringify([l.item,l.unit,l.price,l.sourcePricingType]);
      if(!grouped.has(key))grouped.set(key,{
        item:l.item,unit:l.unit,price:l.price,sourcePricingType:l.sourcePricingType,
        qty:0,amount:0
      });
      const row=grouped.get(key);
      row.qty+=l.qty==null?0:l.qty;
      row.amount+=l.amount;
    }
    const items=[...grouped.values()];
    const total=items.reduce((v,x)=>v+x.amount,0);
    if(!almost(total,view.display.originalDetailTotal))fail('SUMMARY_NOT_MATCHING_ORIGINAL');
    return items;
  }

  function displayNumber(v,maxDecimals){
    if(v==null)return '—';
    if(typeof v!=='number'||!Number.isFinite(v))fail('INVALID_DISPLAY_NUMBER');
    return v.toLocaleString('en-US',{maximumFractionDigits:maxDecimals});
  }

  // Public display-only data. This is NOT approval for use by AH or any
  // production PDF generator. Account values are taken from published view.
  function previewSpec(adapted){
    const summary=denseSummary(adapted);
    return {
      title:adapted.title,customer:adapted.customer,project:adapted.project,
      taxMode:adapted.taxMode,invoiceStatus:adapted.invoiceStatus,
      sourceRows:adapted.lines.map(l=>({
        house:l.house,item:l.item,unit:l.unit,
        qtyText:displayNumber(l.qty,4),priceText:displayNumber(l.price,4),
        amountText:displayNumber(l.amount,2),sourcePricingType:l.sourcePricingType
      })),
      summaryRows:summary.map(l=>({
        item:l.item,unit:l.unit,qtyText:displayNumber(l.qty,4),
        priceText:displayNumber(l.price,4),
        amountText:displayNumber(l.amount,2),sourcePricingType:l.sourcePricingType
      })),
      approvedAmounts:{...adapted.amounts},
      display:{...adapted.display},publicNote:adapted.publicNote,
      company:{...adapted.company},
      safeForProduction:false
    };
  }

  root.P40AJ={normalizeSingle,denseSummary,previewSpec};
})(typeof window!=='undefined'?window:globalThis);
