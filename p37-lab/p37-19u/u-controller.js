(() => {
'use strict';
// P37-19U - synthetic localhost integration harness for the UNMOUNTED T module.
// Mocked principal is never a live identity proof or production access.
const MODE='P37_19T_FORMAL_SHAPED_READ_ONLY_REVIEW';
const SCOPE='P37_19U_LOCALHOST_SYNTHETIC_PROOF_ONLY';
const fail=msg=>{throw Error('P37-19U '+msg)};
function guard(){
 if(window.location?.protocol!=='http:'||
    window.location?.hostname!=='127.0.0.1'||
    window.location?.pathname!=='/'||
    window.P37U?.scope!==SCOPE||window.P37U?.isolatedFixture!==true||
    window.P37R?.scope!=='P37_19R_LOCALHOST_SYNTHETIC_READ_ONLY'||
    window.P37R.isolatedFixture!==true)
   fail('UNAUTHORIZED_ORIGINAL_BROWSER_OR_ORIGIN');
}
guard();
const FAKE_OWNER='P37-19-SYN-OWNER';
function syntheticAuth(){
 return {
  user:()=>({id:FAKE_OWNER}),
  companyContext:()=>({companyId:'P37-19-SYN-COMPANY',userId:FAKE_OWNER,
   legacySourceUserId:FAKE_OWNER,role:'owner'}),
  canWrite:name=>name==='billings'
 };
}
let installed=false,originalRead=null,chartCalls=0,detailCalls=0,lastChart=null;
function verify(candidate,original){
 if(candidate?.readOnly!==true||candidate.canPost!==false||
    candidate.releaseGate!=='NO_GO'||candidate.mayMountProduction!==false||
    candidate.officialVoucherVerified!==false||
    candidate.cloudWrites!==0||candidate.bankEntriesAdded!==0||
    candidate.formalReceiptWriterConnected!==false||
    candidate.formalBankWriterConnected!==false||
    candidate.formalCommissionPaid!==false||
    candidate.authorization?.serverSignatureVerified!==false||
    candidate.dashboard?.bank!==original.bank||
    candidate.dashboard?.collected!==original.collected||
    candidate.dashboard?.payrollTotal!==original.payrollTotal)
  fail('CANDIDATE_MUST_BE_NONPOSTING_AND_UNVERIFIED');
 return candidate;
}
function view(month='2026-11'){
 guard();
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))
  fail('MONTH_MUST_BE_EXPLICIT');
 const store=window.KuSheERPStore,view=window.KusheDashboard,
  api=window.KusheP3719TReadOnlyCandidate;
 if(typeof store?.getState!=='function'||typeof view?.readSnapshot!=='function'||
    typeof api?.project!=='function')
  fail('ORIGINAL_ERP_SOURCE_NOT_LOADED');
 const state=store.getState();
 if(!state||!state.meta?.businessSnapshotRevision?.id)
  fail('NO_COMMITTED_STORE_SNAPSHOT');
 if(state.settings?.company!=='P37-19R SYNTHETIC ONLY'||
    !Array.isArray(state.billings)||state.billings.length!==3||
    state.billings.some(b=>!/^P37-19-SYN-[A-Z0-9-]+$/.test(b.id||'')))
  fail('NOT_ISOLATED_SYNTHETIC_STORE');
 const raw=(originalRead||view.readSnapshot.bind(view))(month);
 const before=JSON.stringify({meta:state.meta,billings:state.billings,
  receivables:state.receivables,invoices:state.invoices,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,
  bankTransactions:state.bankTransactions,
  billingAllowances:state.billingAllowances});
 const result=api.project({
  mode:MODE,officialVoucherIndependentlyVerified:false,
  allowFinancialWrites:false,
  auth:syntheticAuth(),state,originalDashboard:raw,
  expectedRevisionId:state.meta.businessSnapshotRevision.id,month,
  effectiveLedger:window.KusheP3718EffectiveLedger,
  formalReadOnlyLedger:window.KusheP3719CFormalReader
 });
 verify(result,raw);
 const after=JSON.stringify({meta:state.meta,billings:state.billings,
  receivables:state.receivables,invoices:state.invoices,
  receipts:state.receipts,retentionReceipts:state.retentionReceipts,
  bankTransactions:state.bankTransactions,
  billingAllowances:state.billingAllowances});
 if(before!==after)fail('CANDIDATE_MUTATED_FINANCIAL_STATE');
 return result;
}
function install(){
 guard();
 if(installed||originalRead)fail('ALREADY_INSTALLED');
 if(!window.KusheKpi?.register||!window.KusheKpi?.model)
  fail('UNMODIFIED_P21_NAVIGATION_REQUIRED');
 const db=window.KusheDashboard;
 originalRead=db.readSnapshot.bind(db);
 // This assignment is confined to the ephemeral CI fixture, never index.html.
 db.readSnapshot=month=>view(month).dashboard;
 window.KusheKpi.register('u-preview',{
  anchor:'#kpiGrid,#attentionList',
  active:()=>installed,
  read:(action,options={})=>details(action,options.month||
    document.querySelector('#dashboardMonth')?.value||'2026-11')
 });
 installed=true;
 return {installed:true,source:'P37-19T-STANDALONE_MODULE',
  principal:'SYNTHETIC_AUTH_ONLY',realSignedSession:false,
  officialTaxVoucherVerified:false,
  formalStoreWriterChanged:false,canPost:false};
}
function details(kind,month='2026-11'){
 const r=view(month),d=r.details(kind,month);
 if(d.readOnly!==true||d.verifiedForFormalPosting!==false)
  fail('DETAIL_UNTRUSTED_WRITER_STATUS');
 const expected=kind==='revenue'?r.adjusted.revenue:
  kind==='ar'?r.adjusted.outstandingAR:r.adjusted.retentionOpen;
 if(d.total!==expected)fail('KPI_DETAIL_TOTAL_NOT_MATCHED');
 detailCalls++;
 return d;
}
function chartPoints(vm,range){
 const r=view(vm?.month);
 if(r.dashboard.revenue!==vm.revenue||
    r.dashboard.outstandingAR!==vm.outstandingAR||
    r.dashboard.data!==vm.data)fail('CHART_AND_DASHBOARD_REVISION_CONFLICT');
 const points=r.chart(range,vm.month);
 if(range===12&&points.at(-1)?.value!==vm.revenue)
  fail('LATEST_CHART_POINT_NOT_CURRENT_REVENUE');
 chartCalls++;
 lastChart={range,month:vm.month,revision:r.sourceRevision,
  points:points.map(p=>({...p})),readOnly:true};
 return points;
}
function tagKpiCards(){
 guard();
 const known={'本月營業額':'revenue','未收帳款':'ar'};
 for(const button of document.querySelectorAll('#kpiGrid button.kpi-card')){
  const title=button.querySelector('.kpi-label')?.textContent?.trim();
  const key=known[title];
  if(!key)continue;
  button.dataset.kpi='u-preview.'+key;
  button.setAttribute('role','button');
  button.setAttribute('tabindex','0');
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-expanded','false');
 }
}
function tagRetentionAlert(){
 guard();
 for(const button of document.querySelectorAll('#attentionList button.attention-item')){
  if(button.querySelector('.attention-copy strong')?.textContent?.trim()!=='保留款待收')
   continue;
  button.dataset.kpi='u-preview.retention';
  button.setAttribute('role','button');
  button.setAttribute('tabindex','0');
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-expanded','false');
 }
}
function observation(){
 guard();
 return {scope:SCOPE,installed,chartCalls,detailCalls,
  lastChart:lastChart?JSON.parse(JSON.stringify(lastChart)):null,
  signedClientSessionsObserved:0,realCloudCASRequests:0,
  officialVoucherVerified:false,formalERPStoreChanged:false,
  formalBankEntriesAdded:0,formalPayrollChanged:false,
  companyDataRead:false,productionReady:false,canPost:false};
}
window.P37UReviewAdapter=Object.freeze({
 view,install,details,chartPoints,tagKpiCards,tagRetentionAlert,observation
});
})();