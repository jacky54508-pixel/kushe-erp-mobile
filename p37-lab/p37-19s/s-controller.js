(() => {
'use strict';
// P37-19S original P21 KPI navigation / chart data, LAB ONLY, no Store mutation.
const MODE='P37_19S_SYNTHETIC_READ_ONLY_NAV_AND_TRENDS';
const fmt=n=>'$'+Number(n).toLocaleString('zh-TW',{maximumFractionDigits:0});
const validMonth=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
const abort=why=>{throw Error('P37-19S '+why)};
function guard(){
 if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||
    location.pathname!=='/'||window.P37S?.scope!==MODE||
    window.P37S.isolatedFixture!==true||
    window.P37R?.scope!=='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY'||
    window.P37R.isolatedFixture!==true)abort('NON_LOCAL_SYNTHETIC_SCOPE');
}
guard();
let installed=false,chartCalls=0,lastChart=null,detailCalls=0;
function get(month='2026-11'){
 guard();
 if(!validMonth(month))abort('INVALID_MONTH');
 const p=window.P37RReadOnlyPreview.preview(month);
 if(p.readOnly!==true||p.canPost!==false||
    p.productionReady!==false||p.status!=='P37_19R_LAB_PREVIEW_ONLY'||
    p.sourceRevision!==window.KuSheERPStore.getState()?.meta?.businessSnapshotRevision?.id)
  abort('ORIGINAL_R_SNAPSHOT_OR_RELEASE_STATUS_CHANGED');
 if(!Array.isArray(p.rows)||p.rows.length!==3||
    p.rows.some(row=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(row.billingId)))
  abort('ORIGINAL_R_LEDGER_ROWS_INVALID');
 return p;
}
function sum(rows,key){return rows.reduce((n,r)=>n+r[key],0)}
function monthUTC(dateOffset,year,month){
 const d=new Date(Date.UTC(year,month-1+dateOffset,1));
 return String(d.getUTCFullYear())+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}
function chartPoints(vm,range){
 const p=get(vm?.month);
 if(p.dashboard.revenue!==vm.revenue||
    p.dashboard.outstandingAR!==vm.outstandingAR||
    ![3,4,12].includes(range))abort('CANVAS_READER_NOT_CONSISTENT');
 const rows=p.rows;
 const [year,month]=vm.month.split('-').map(Number);
 let intervals=[];
 if(range===12){
  intervals=Array.from({length:12},(_,index)=>{
   const key=monthUTC(index-11,year,month);
   return {key,label:String(Number(key.slice(5)))+'月',kind:'month'};
  });
 }else if(range===4){
  const quarter=Math.floor((month-1)/3);
  intervals=Array.from({length:4},(_,index)=>{
    const qOffset=quarter+index-3;
    const qYear=year+Math.floor(qOffset/4);
    const q=((qOffset%4)+4)%4;
    return {key:String(qYear)+' Q'+String(q+1),label:'Q'+String(q+1),
      kind:'quarter',year:qYear,quarter:q};
  });
 }else{
  intervals=[2,1,0].map(back=>({
   key:String(year-back),label:String(year-back),
   kind:'year',year:year-back
  }));
 }
 const points=intervals.map(p=>{
  const filtered=rows.filter(r=>{
   if(p.kind==='month')return r.month===p.key;
   const y=Number(r.month.slice(0,4)),m=Number(r.month.slice(5));
   return p.kind==='year'?y===p.year:
     y===p.year&&Math.floor((m-1)/3)===p.quarter;
  });
  const value=sum(filtered,'approvedUntaxed');
  if(!Number.isSafeInteger(value)||value<0)abort('CHART_VALUES_NOT_INTEGER');
  return {key:p.key,label:p.label,value};
 });
 if(range===12&&points[points.length-1].value!==vm.revenue)
  abort('CHART_LAST_MONTH_NOT_KPI');
 const original=window.KuSheERPStore.getState();
 if(!original||original.meta.businessSnapshotRevision.id!==p.sourceRevision)
  abort('CHART_SNAPSHOT_CHANGED');
 chartCalls++;
 lastChart={range,selectedMonth:vm.month,revision:p.sourceRevision,
  points:points.map(x=>({...x})),readOnly:true,canPost:false};
 return points;
}
function details(kind,month='2026-11'){
 const p=get(month),state=window.KuSheERPStore.getState();
 if(!['revenue','ar','retention'].includes(kind))abort('UNREGISTERED_READ_ONLY_DETAIL');
 const source=new Map(state.billings.map(b=>[b.id,b]));
 const chosen=kind==='revenue'?p.rows.filter(r=>r.month===month):p.rows;
 const rows=chosen.map(r=>{
  const bill=source.get(r.billingId);
  if(!bill||bill.receivableId!==r.receivableId||
     !bill.number||!bill.number.startsWith('P37-19-SYN-'))
     abort('DRILLDOWN_SOURCE_NOT_UNIQUE');
  const cols=kind==='revenue'?
    [r.originalUntaxed,r.reducedUntaxed,r.approvedUntaxed]:
    kind==='ar'?
    [r.approvedAR,r.principalReceived,r.outstanding]:
    [r.approvedRetention,r.retentionReceived,r.retentionRemaining];
  return {id:r.billingId,
    cells:[bill.date,bill.number,...cols.map(fmt)]};
 });
 const field=kind==='revenue'?'approvedUntaxed':
  kind==='ar'?'outstanding':'retentionRemaining';
 const total=sum(chosen,field);
 const expected=kind==='revenue'?p.dashboard.revenue:
   kind==='ar'?p.dashboard.outstandingAR:p.adjusted.retentionOpen;
 if(total!==expected)abort('DETAIL_SUM_NOT_DASHBOARD_AND_REPORT');
 const columns=kind==='revenue'?
  ['請款日期','請款單','原未稅','折讓未稅','核定未稅']:
  kind==='ar'?
   ['請款日期','請款單','核定應收','已沖銷','未收應收']:
   ['請款日期','請款單','核定保留款','已收保留款','待收保留款'];
 detailCalls++;
 return Object.freeze({
  title:(kind==='revenue'?month+' 核定未稅營業額來源':
   kind==='ar'?'折讓後未收應收來源':'折讓後待收保留款來源'),
  scope:'P37-19S 127.0.0.1 合成帳務唯讀預覽；不是正式發票或銀行資料；未開放入帳。',
  columns,rows,drawer:{summaryIndex:4,summaryLabel:columns[4],
   scopeLabel:'隔離合成帳務；原始請款與核定金額分列'},
  syntheticTotal:total,revision:p.sourceRevision,
  sourceKey:kind,readOnly:true,canPost:false,
  officialTaxVoucherVerified:false,
  formalPayrollUnlocked:false
 });
}
function tagKpiElements(){
 guard();
 const map={'本月營業額':'revenue','未收帳款':'ar'};
 for(const card of document.querySelectorAll('#kpiGrid button.kpi-card')){
  const label=card.querySelector('.kpi-label')?.textContent?.trim();
  if(!map[label])continue;
  card.dataset.kpi='preview.'+map[label];
  card.setAttribute('role','button');card.setAttribute('tabindex','0');
  card.setAttribute('aria-haspopup','dialog');card.setAttribute('aria-expanded','false');
  card.setAttribute('aria-label','查看'+label+'核定來源（僅合成預覽）');
 }
}
function tagAttentionElements(){
 guard();
 for(const card of document.querySelectorAll('#attentionList .attention-item')){
  const label=card.querySelector('.attention-copy strong')?.textContent?.trim();
  if(label!=='保留款待收')continue;
  card.dataset.kpi='preview.retention';
  card.setAttribute('role','button');card.setAttribute('tabindex','0');
  card.setAttribute('aria-haspopup','dialog');card.setAttribute('aria-expanded','false');
 }
}
function install(){
 guard();
 if(installed)abort('DUPLICATE_CONTROLLER_INSTALL');
 if(!window.KusheKpi?.model||!window.KusheKpi?.register||
    !window.P37RReadOnlyPreview?.install)abort('ORIGINAL_P21_AND_R_READERS_MISSING');
 window.P37RReadOnlyPreview.install();
 window.KusheKpi.register('preview',{
  anchor:'#kpiGrid,#attentionList',
  active:()=>installed,
  read:(action,opts={})=>details(action,opts.month||
    document.querySelector('#dashboardMonth')?.value||'2026-11')
 });
 installed=true;
 return Object.freeze({installed:true,source:'ORIGINAL_P21_KPI_ENGINE',
  genuineTaxVoucher:false,formalStoreModified:false,canPost:false});
}
function observation(){
 guard();
 return Object.freeze({schema:'kushe-p37-19s-lab-ui-v1',
  installed,chartCalls,detailCalls,
  lastChart:lastChart?JSON.parse(JSON.stringify(lastChart)):null,
  originalStoreUnchanged:true,originalReportUnchanged:true,
  officialVoucherVerified:false,realFinancialWriterEnabled:false,
  formalPayrollChanged:false,realCloudConnected:false,
  productionReady:false,canPost:false});
}
window.P37SReadOnlyDrilldown=Object.freeze({
 install,details,chartPoints,tagKpiElements,tagAttentionElements,observation
});
})();