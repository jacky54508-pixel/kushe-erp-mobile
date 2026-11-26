(function(){
  'use strict';
  const num=value=>Number(value)||0;
  const text=value=>String(value??'').trim();
  const safeFile=value=>text(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
  function companyView(){return {name:'酷舍企業有限公司',englishName:'Cool Sir Limited Company',taxId:'82980636',address:'台中市豐原區瑞興路 62 號',line:'eing0519'}}
  // Backup pricing is separate from the public work-scope note. Match only the
  // immutable history ID saved on this quotation; never look up today's price.
  function quotationBackupPrice(line,record,history){
    if(text(line.note)==='備用單價')return true;
    const source=text(line.priceSource),id=text(line.priceId);
    if(line.manualPrice===true||!id||!['company','customer','project'].includes(source))return false;
    const matches=history.filter(row=>text(row?.id)===id);
    if(matches.length!==1)return false;
    const saved=matches[0],readPrice=value=>!['string','number'].includes(typeof value)||text(value)===''?null:Number(value);
    const linePrice=readPrice(line.price??line.unitPrice),savedPrice=readPrice(saved.price);
    if(saved.isBackupPrice!==true||text(saved.scope)!==source||
      text(saved.item)!==text(line.item||line.name||line.description)||text(saved.unit)!==text(line.unit)||
      linePrice===null||savedPrice===null||!Number.isFinite(linePrice)||!Number.isFinite(savedPrice)||linePrice!==savedPrice)return false;
    if(source==='company'&&(text(saved.customerId)||text(saved.projectId)))return false;
    if(source==='customer'&&text(saved.projectId))return false;
    if(source!=='company'&&(!text(record.customer)||text(saved.customerId)!==text(record.customer)))return false;
    if(source==='project'&&(!text(record.project)||text(saved.projectId)!==text(record.project)))return false;
    return true;
  }
  // Quotation line.note is the editor's public work-scope field. Never forward internal fields.
  function publicLines(record,type,history){const mode=type==='quotation'?text(record.pricingMode):'',lines=(type==='billing'&&window.KuSheERPStore.billingDocumentLines?window.KuSheERPStore.billingDocumentLines(record):(Array.isArray(record.lines)?record.lines:[])).map(line=>{const pricingType=mode==='mixed'?(line.pricingType==='lump_sum'?'lump_sum':'actual'):mode,rawQty=line.qty??line.quantity,hasQty=rawQty!==null&&rawQty!==undefined&&String(rawQty).trim()!==''&&num(rawQty)>0,amount=line.sourceType==='historical-supplement'?num(line.subtotal):pricingType==='lump_sum'?num(line.lumpSumAmount??line.amount):hasQty?num(line.amount??num(rawQty)*num(line.price??line.unitPrice)):0;return {house:text(line.house||line.unitName||line.building),item:text(line.item||line.name||line.description),unit:text(line.unit),qty:hasQty?num(rawQty):null,price:line.price===null||line.price===undefined?(line.unitPrice===null||line.unitPrice===undefined?null:num(line.unitPrice)):num(line.price),amount,pricingType,...(type==='billing'?{sourcePricingType:line.sourceType==='historical-supplement'?'historical-supplement':text(line.pricingType)}:{}),...(type==='quotation'?{note:text(line.note)}:{}),isBackupPrice:type==='quotation'&&quotationBackupPrice(line,record,history)}}).filter(line=>line.item||line.amount||line.qty);return window.KusheDisplaySort?.sortWorkRows?window.KusheDisplaySort.sortWorkRows(lines):lines}
  function externalView(record,data,type){
    const documentInfo=type==='billing'?window.KuSheERPStore.billingDocumentState?.(record.id):null;if(documentInfo?.protected&&documentInfo.issues.length)throw new Error('歷史請款金額或來源待核對，暫停匯出');const lines=publicLines(record,type,Array.isArray(data.quotationPrices)?data.quotationPrices:[]),sales=documentInfo?.protected?documentInfo.amounts.untaxed:num(record.amount)||lines.reduce((sum,line)=>sum+line.amount,0),tax=documentInfo?.protected?documentInfo.amounts.tax:num(record.tax),total=documentInfo?.protected?documentInfo.amounts.grossTotal:num(record.grossTotal)||num(record.total)||sales+tax;
    const legacyNote=text(record.note),publicNote=text(record.publicNote||(type==='quotation'||!/每日業績|施工紀錄.*彙總|確認後儲存|內部|ERP/i.test(legacyNote)?legacyNote:''));
    const pricing=text(record.pricingMode);
    return {schema:'kushe-external-document-v1',documentType:type==='quotation'?'quotation':'billing',title:type==='quotation'?'報價單':'請款單',number:text(record.number||record.externalNo),customer:text(record.customerName||record.customerLabel),project:text(record.projectName||record.projectLabel),date:text(record.date),taxMode:text(documentInfo?.supplement?.taxMode||record.taxMode),pricingMode:pricing,invoiceStatus:text(record.invoiceStatus),lines,salesAmount:sales,taxAmount:tax,totalAmount:total,retentionAmount:type==='billing'?(documentInfo?.protected?documentInfo.amounts.retention:num(record.retentionAmount??record.retention)):0,receivableAmount:type==='billing'?(documentInfo?.protected?documentInfo.amounts.receivable:num(record.total)):total,publicNote,company:companyView(data.settings)};
  }
  function openView(view,autoPrint){const project=view.project||view.customer||'',month=view.date.slice(0,7),prefix=view.documentType==='quotation'?'酷舍_報價單':'酷舍_請款單',fileName=safeFile([prefix,project,month].filter(Boolean).join('_'))+'.pdf',payload=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({...view,fileName}))))),url=new URL('billing-print.html?v='+(view.documentType==='quotation'?'p41-k27-quote-export-20261127-1':'p30-history-1')+'&print='+(autoPrint?'1':'0'),location.href);url.hash=payload;location.assign(url.href)}
  function openRecord(record,type,autoPrint){if(!record)return;try{openView(externalView(record,window.KuSheERPStore.getState(),type),autoPrint)}catch(error){window.KushePhase1?.toast(error.message||'請款資料待核對，暫停匯出')}}
  window.KusheBillingPrint={export(row){openRecord(row,'billing',true)},print(row){openRecord(row,'billing',false)},buildExternalView(row){return externalView(row,window.KuSheERPStore.getState(),'billing')}};
  window.KusheQuotationPrint={export(row){openRecord(row,'quotation',true)},print(row){openRecord(row,'quotation',false)},buildExternalView(row){return externalView(row,window.KuSheERPStore.getState(),'quotation')}};
})();
