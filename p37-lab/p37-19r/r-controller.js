(() => {
'use strict';
// P37-19R: Preview/controller lives in the isolated lab, NEVER in real ERP.
const MODE='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY';
const lab=()=>{
 if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||
    location.pathname!=='/'||window.P37R?.scope!==MODE||
    window.P37R.isolatedFixture!==true)
   throw Error('P37-19R LAB_ORIGIN_ONLY');
};
lab();
let originalRead=null,active=false;
function preview(month='2026-11'){
 lab();
 const store=window.KuSheERPStore,main=window.KusheDashboard,
  reader=window.KusheP3719RLabReader;
 if(!store?.getState||!main?.readSnapshot||!reader?.project)
  throw Error('P37-19R ORIGINAL_READERS_UNAVAILABLE');
 const source=store.getState(),baseline=(originalRead||main.readSnapshot)(month);
 return reader.project(source,baseline,
   window.KusheP3718EffectiveLedger,
   window.KusheP3719CFormalReader,{
    mode:MODE,labOnly:true,legalTaxVoucherVerified:false,
    selectedMonth:month,
    expectedRevisionId:source?.meta?.businessSnapshotRevision?.id
   });
}
function install(){
 lab();
 if(active)throw Error('P37-19R LAB_PREVIEW_ALREADY_INSTALLED');
 const dashboard=window.KusheDashboard;
 originalRead=dashboard.readSnapshot.bind(dashboard);
 dashboard.readSnapshot=function(month){return preview(month).dashboard};
 active=true;
 return {installed:true,scope:MODE,writerInstalled:false,
  genuineFinancialIntegration:false,officialReleaseBlocked:true};
}
function renderDashboard(){
 lab();
 const report=preview('2026-11');
 window.KusheDashboard.render(report.dashboard);
 return {revenue:report.dashboard.revenue,
   outstandingAR:report.dashboard.outstandingAR,
   outstandingRetention:report.adjusted.retentionOpen,
   sourceRevision:report.sourceRevision,
   originalInvoiceStillUnmodified:true,realWriterInstalled:false};
}
function audit(){
 lab();
 const store=window.KuSheERPStore,state=store.getState();
 const s=preview('2026-11');
 const rows=s.rows.filter(x=>x.adjustment);
 if(rows.length!==1||s.deductions.untaxed!==26000||
   s.deductions.currentReceivable!==24700||
   s.deductions.retention!==2600)
  throw Error('P37-19R_EXPECTED_SYNTHETIC_ALLOWANCE_MISMATCH');
 return {scope:MODE,revision:state.meta.businessSnapshotRevision.id,
  readOnly:true,cloudWrites:0,bankWrites:0,
  commissionsPaid:0,legalVoucherVerified:false,
  bankBalance:state.banks[0].balance,
  realReceiptWritePathsUnchanged:true,
  preview:{original:s.original,adjusted:s.adjusted,deductions:s.deductions},
  commissions:s.commissionPreview,
  trendChartIntegrated:s.dashboardTrendChartIntegrated,
  kpiDrilldownsIntegrated:s.kpiDrilldownsIntegrated,
  productionReady:false};
}
window.P37RReadOnlyPreview=Object.freeze({
 preview,install,renderDashboard,audit,isInstalled:()=>active
});
})();