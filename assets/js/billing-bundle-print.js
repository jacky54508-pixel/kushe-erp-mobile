(function(){
  'use strict';
  const num=(value)=>Number(value)||0;
  const text=(value)=>String(value??'').trim();
  const normalizeName=(value)=>text(value).replace(/\s+/g,' ').toLocaleLowerCase('zh-Hant');
  const safeFile=(value)=>text(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
  const monthOf=(value)=>text(value).slice(0,7);
  const invoiceLabel=(value)=>value==='no_invoice'?'免開發票':value==='invoiced'?'已開發票':value==='invoice_pending'?'待開發票':text(value);

  function customerIdentity(row){
    const customerId=text(row?.customer);
    if(customerId)return `id:${customerId}`;
    const legacyName=normalizeName(row?.customerName||row?.customerLabel);
    return legacyName?`name:${legacyName}`:'';
  }

  function sameCustomer(left,right){
    const leftId=text(left?.customer),rightId=text(right?.customer);
    if(leftId&&rightId)return leftId===rightId;
    const leftName=normalizeName(left?.customerName||left?.customerLabel),rightName=normalizeName(right?.customerName||right?.customerLabel);
    return Boolean(leftName)&&leftName===rightName;
  }

  function commonLabel(values){
    const unique=[...new Set(values.map(text).filter(Boolean))];
    return unique.length===1?unique[0]:'依各案場請款設定';
  }

  function buildCombinedView(rows){
    if(!Array.isArray(rows)||rows.length<2)throw new Error('請至少選擇 2 張請款單');
    if(!window.KusheBillingPrint?.buildExternalView)throw new Error('正式請款 PDF 模組尚未載入');
    if(!customerIdentity(rows[0])||rows.some((row)=>!sameCustomer(rows[0],row)))throw new Error('合併請款只能選擇同一客戶／設計公司的請款單');
    const externalViews=rows.map((row)=>window.KusheBillingPrint.buildExternalView(row));
    const billings=rows.map((row,index)=>{
      const view=externalViews[index];
      return {
        billingId:text(row.id),
        number:text(view.number||row.number),
        projectId:text(row.project),
        projectName:text(view.project||row.projectName),
        date:text(view.date||row.date),
        taxMode:text(view.taxMode),
        invoiceStatus:text(view.invoiceStatus),
        lines:Array.isArray(view.lines)?view.lines.map((line)=>({...line})):[],
        salesAmount:num(view.salesAmount),
        taxAmount:num(view.taxAmount),
        totalAmount:num(view.totalAmount),
        retentionAmount:num(view.retentionAmount),
        receivableAmount:num(view.receivableAmount),
        publicNote:text(view.publicNote)
      };
    });
    const dates=billings.map((row)=>row.date).filter(Boolean).sort();
    const projects=[...new Map(billings.map((row)=>[row.projectId||`legacy:${normalizeName(row.projectName)}`,{id:row.projectId,name:row.projectName}])).values()];
    const totals=['salesAmount','taxAmount','totalAmount','retentionAmount','receivableAmount'].reduce((result,key)=>{result[key]=billings.reduce((sum,row)=>sum+Math.round(num(row[key])*100),0)/100;return result},{});
    const months=[...new Set(dates.map(monthOf).filter(Boolean))];
    const monthLabel=months.length<2?(months[0]||''):`${months[0]}-${months.at(-1)}`;
    const customer=text(externalViews[0]?.customer||rows[0]?.customerName||rows[0]?.customerLabel);
    return {
      schema:'kushe-combined-billing-v1',
      documentType:'combined-billing',
      title:'請款單',
      subtitle:'多案場合併請款明細',
      customer,
      customerId:text(rows[0]?.customer),
      dateStart:dates[0]||'',
      dateEnd:dates.at(-1)||'',
      taxMode:commonLabel(billings.map((row)=>row.taxMode)),
      invoiceStatus:commonLabel(billings.map((row)=>row.invoiceStatus)),
      invoiceDisplay:commonLabel(billings.map((row)=>invoiceLabel(row.invoiceStatus))),
      billings,
      projects,
      totals,
      company:externalViews[0]?.company||{},
      fileName:`${safeFile(['酷舍_合併請款單',customer,monthLabel].filter(Boolean).join('_'))}.pdf`
    };
  }

  function openView(view,autoPrint){
    const payload=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(view)))));
    const url=new URL(`billing-bundle-print.html?v=20260908-p15-2-combined-billing1&print=${autoPrint?'1':'0'}`,location.href);
    url.hash=payload;
    location.assign(url.href);
  }

  window.KusheBillingBundlePrint={
    customerIdentity,
    sameCustomer,
    buildCombinedView,
    openView,
    export(rows){openView(buildCombinedView(rows),true)},
    print(rows){openView(buildCombinedView(rows),false)}
  };
}());
