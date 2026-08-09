(function(){
  'use strict';
  const num=value=>Number(value)||0;
  const text=value=>String(value??'').trim();
  const safeFile=value=>text(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
  function companyView(settings={}){return {name:text(settings.company||settings.companyName||'酷舍企業有限公司'),englishName:text(settings.englishName||'Cool Sir Limited Company'),taxId:text(settings.taxId),phone:text(settings.phone),address:text(settings.address),line:text(settings.line||settings.lineId)}}
  function publicLines(record){return (Array.isArray(record.lines)?record.lines:[]).map(line=>({house:text(line.house||line.unitName||line.building),item:text(line.item||line.name||line.description),unit:text(line.unit),qty:num(line.qty??line.quantity),price:num(line.price??line.unitPrice),amount:num(line.amount??num(line.qty??line.quantity)*num(line.price??line.unitPrice))})).filter(line=>line.item||line.amount||line.qty)}
  function externalView(record,settings,type){
    const lines=publicLines(record),sales=num(record.amount)||lines.reduce((sum,line)=>sum+line.amount,0),tax=num(record.tax),total=num(record.grossTotal)||sales+tax;
    const legacyNote=text(record.note),publicNote=text(record.publicNote||(type==='quotation'||!/每日業績|施工紀錄.*彙總|確認後儲存|內部|ERP/i.test(legacyNote)?legacyNote:''));
    return {schema:'kushe-external-document-v1',documentType:type==='quotation'?'quotation':'billing',title:type==='quotation'?'報價單':'請款單',number:text(record.number||record.externalNo),customer:text(record.customerName||record.customerLabel),project:text(record.projectName||record.projectLabel),date:text(record.date),taxMode:text(record.taxMode),lines,salesAmount:sales,taxAmount:tax,totalAmount:total,publicNote,company:companyView(settings)};
  }
  function openView(view,autoPrint){const project=view.project||view.customer||'',month=view.date.slice(0,7),prefix=view.documentType==='quotation'?'酷舍_報價單':'酷舍_請款單',fileName=safeFile([prefix,project,month].filter(Boolean).join('_'))+'.pdf',payload=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({...view,fileName})))));window.open('billing-print.html?print='+(autoPrint?'1':'0')+'#'+payload,'_blank','noopener')}
  function openRecord(record,type,autoPrint){if(!record)return;openView(externalView(record,window.KuSheERPStore.getState().settings,type),autoPrint)}
  window.KusheBillingPrint={export(row){openRecord(row,'billing',true)},print(row){openRecord(row,'billing',false)},buildExternalView(row){return externalView(row,window.KuSheERPStore.getState().settings,'billing')}};
  window.KusheQuotationPrint={export(row){openRecord(row,'quotation',true)},print(row){openRecord(row,'quotation',false)},buildExternalView(row){return externalView(row,window.KuSheERPStore.getState().settings,'quotation')}};
})();
