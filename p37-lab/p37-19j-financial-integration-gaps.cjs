'use strict';
// P37-19J fail-closed inventory of actual, unmodified ERP finance consumers.
// This is NOT an implementation/approval of the formal allowance writer.
const fs=require('node:fs');
const path=require('node:path');
const CHECKS=Object.freeze([
 {id:'RECEIVABLE_SETTLEMENT_WRITER',file:'assets/js/erp-store.js',
  pattern:/function assertReceivableSettlementBaseline\(ar\)\s*\{\s*requireAllowancesFullyIntegrated\(ar\);/,
  reason:'收款檢查仍阻擋折讓，且使用原 ar.amount'},
 {id:'PRINCIPAL_RECEIPT_INPUT_AND_EDIT',file:'assets/js/erp-store.js',
  pattern:/function addReceiptUnlocked\(values\)[\s\S]*?const ar=arMatches\[0\],baseline=assertReceivableSettlementBaseline\(ar\)/,
  reason:'新增／編輯／刪除收款尚未用核定應收全流程驗收'},
 {id:'RECEIVABLE_SUMMARY_AND_BILLING_STATUS',file:'assets/js/erp-store.js',
  pattern:/function syncReceivableSummary\(ar, now\)[\s\S]*?strictReceiptMoney\(ar\.amount,'應收金額'\)/,
  reason:'正式收款狀態仍以原始應收為基準'},
 {id:'RETENTION_RECEIPT_WRITERS',file:'assets/js/erp-store.js',
  pattern:/function syncRetentionSummary\(ar, billing, now\)\s*\{\s*requireAllowancesFullyIntegrated\(ar\);/,
  reason:'保留款收回／修改／刪除仍未接核定保留款'},
 {id:'CHEQUE_RESERVATIONS_AND_CLEARING',file:'assets/js/erp-store.js',
  pattern:/function receivableChequeCapacity\(receivableId\)[\s\S]*?baseline=assertReceivableSettlementBaseline\(ar\)/,
  reason:'支票預留、取消及兌現須使用相同核定剩餘額'},
 {id:'BILLING_RECEIPT_STATE',file:'assets/js/erp-store.js',
  pattern:/function billingReceiptState\(billing\)[\s\S]*?const received = num\(ar\?\.received\), amount = num\(ar\?\.amount \?\? billing\.total\);/,
  reason:'請款收款狀態仍使用原請款金額'},
 {id:'DASHBOARD_OPEN_AR',file:'assets/js/dashboard.js',
  pattern:/const outstandingAR = sum\(openAR, \(row\) => Math\.max\(0, arAmount\(row\) - paidAR\(row\)\)\);/,
  reason:'首頁未收帳款仍使用原始應收'},
 {id:'DASHBOARD_RETENTION',file:'assets/js/dashboard.js',
  pattern:/const retentionOpen=sum\(retentionBillings,\(row\)=>Math\.max\(0,number\(row\.retention\)-number\(row\.retentionReceived\)\)\);/,
  reason:'首頁保留款仍使用原始保留款'},
 {id:'REPORTS_REUSE_DASHBOARD',file:'assets/js/reports.js',
  pattern:/window\.KusheDashboard\?\.readSnapshot\?\.\(selectedMonth\)/,
  reason:'報表沿用首頁 KPI，未獨立核對折讓後餘額'},
 {id:'COMMISSION_UNLOCK_ON_ORIGINAL_BILLING',file:'assets/js/erp-store.js',
  pattern:/const states=billings\.map\(\(billing\)=>\(\{billing,receipt:billingReceiptState\(billing\)\}\)\);/,
  reason:'員工抽成解鎖依原請款收款狀態，尚未整合核定應收'},
 {id:'CLOUD_STATE_CAS',file:'assets/js/cloud-sync.js',
  pattern:/\/rest\/v1\/rpc\/erp_state_cas_write_v2/,
  reason:'原跨裝置同步 CAS 尚未驗證折讓核定帳本正式交易'},
 {id:'LIVE_ALLOWANCE_BLOCKER',file:'assets/js/erp-store.js',
  pattern:/此筆已關聯折讓紀錄；P37 正式折讓、收款、保留款與票據尚未完整整合/,
  reason:'正確保留正式折讓收款阻擋，不可提前移除'}
]);
function audit(root){
 if(typeof root!=='string'||!root)throw Error('P37-19J repository root required');
 const cache=new Map(),identified=[];
 for(const check of CHECKS){
  const file=path.join(root,check.file);
  let src=cache.get(file);
  if(src===undefined){src=fs.readFileSync(file,'utf8');cache.set(file,src)}
  if(!check.pattern.test(src))throw Error('P37-19J expected formal finance safety surface changed: '+check.id);
  identified.push({id:check.id,file:check.file,reason:check.reason,
    status:'NOT_CONNECTED_TO_FORMAL_ALLOWANCE_REVIEW'});
 }
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 if(/p37-19j.*(?:script|module)|(?:script|module).*p37-19j/i.test(html))throw Error('P37-19J illegal ERP auto-mount');
 return {schema:'kushe-p37-19j-financial-integration-gap-v1',
   ok:true,readOnly:true,realFinanceDataRead:false,formalERPFilesModified:false,
   trackedConsumers:identified.length,checks:identified,
   officialTaxEvidenceVerified:false,actualCrossDeviceCloudCASSuccess:false,
   realReceiptWriterIntegrated:false,realRetentionWriterIntegrated:false,
   realChequeWriterIntegrated:false,realPayrollCommissionUnlockIntegrated:false,
   realDashboardReportIntegrated:false,
   releaseStatus:'BLOCKED',canPostAllowance:false,canDeployMain:false,
   cloudWrites:0,bankEntriesCreated:0};
}
module.exports=Object.freeze({audit,CHECKS});
