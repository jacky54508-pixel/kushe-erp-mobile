(function(){
  'use strict';
  function payload(row,state){const settings=state.settings||{};return {billing:row,company:{name:settings.company||settings.companyName||'酷舍企業有限公司',taxId:settings.taxId||'',phone:settings.phone||'',address:settings.address||'',owner:settings.owner||''},fileName:['酷舍_請款單',row.projectName||row.customerName||'',String(row.date||'').slice(0,7)].filter(Boolean).join('_').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.pdf'} }
  function open(row,autoPrint){if(!row)return;const state=window.KuSheERPStore.getState(),data=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload(row,state))))));window.open('billing-print.html?print='+(autoPrint?'1':'0')+'#'+data,'_blank','noopener')}
  window.KusheBillingPrint={export(row){open(row,true)},print(row){open(row,false)}};
})();
