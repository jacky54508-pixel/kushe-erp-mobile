'use strict';
// P37-19Q: auditable release-readiness gate; NEVER registers a Store writer.
// All evidence is local repository source and synthetic CI only.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const GAPS=require('../p37-19j-financial-integration-gaps.cjs');
const SCHEMA='kushe-p37-19q-no-go-audit-v1';
const REVIEW='P37_19Q_REVIEW_ONLY_NOT_DEPLOYABLE';
const hashes=Object.freeze({
 'assets/js/erp-store.js':'1d74daabcf51a6f47b03bac9bbc5407ca881272d',
 'assets/js/dashboard.js':'7526d31ad66cea0716eaa5351d25b7ccc72c3a5f',
 'assets/js/reports.js':'ee8f75817113c825313c95b2c5942ce54d55b984',
 'assets/js/cloud-sync.js':'92aa70555d90bc22128ecac3f42cf295286fe5df',
 'index.html':'03467689f7674253df7b6974f21395d855fa2b40'
});
const read=(root,file)=>fs.readFileSync(path.resolve(root,file),'utf8');
function gitBlobHash(content){
 const raw=Buffer.from(content,'utf8');
 return crypto.createHash('sha1').update(Buffer.from('blob '+raw.length+'\0','utf8')).update(raw).digest('hex');
}
function assert(cond,code){if(!cond)throw Error('P37-19Q '+code)}
const approvalChecks=Object.freeze([
 {id:'FORMAL_TAX_VOUCHER_AUTHORITY',priority:'BLOCKING',
  explanation:'折讓憑證須獨立核對，不能把 P37 合成 POSTED_VERIFIED 當成真實稅務憑證'},
 {id:'FORMAL_ALLOWANCE_WRITER_AND_IDEMPOTENCY',priority:'BLOCKING',
  explanation:'ERP Store 尚未註冊經正式驗證的折讓寫入、沖回與版本保護'},
 {id:'REAL_COMPANY_OWNER_RLS_SESSION',priority:'BLOCKING',
  explanation:'兩個真的 Supabase Auth 已授權工作階段及身分限制未完成驗收'},
 {id:'REAL_REMOTE_RPC_CONCURRENT_CAS',priority:'BLOCKING',
  explanation:'同一筆真實測試 RPC 的並行版本競爭和拒絕雙入帳尚未驗收'},
 {id:'ORIGINAL_AMOUNT_AND_INVOICE_IMMUTABILITY',priority:'BLOCKING',
  explanation:'正式核定後原請款、發票歷史與折讓憑證都必須不可變並可稽核'},
 {id:'RECEIVABLE_RECEIPT_CREATE_EDIT_DELETE',priority:'BLOCKING',
  explanation:'正式一般收款新增、修改、刪除需用核定金額且防重複沖銷'},
 {id:'CUSTOMER_DEDUCTION_AND_COMPANY_FEES',priority:'BLOCKING',
  explanation:'實收現金、客戶扣款、公司費及銀行實際入帳須同一帳本勾稽'},
 {id:'RETENTION_RECEIPT_CREATE_EDIT_DELETE',priority:'BLOCKING',
  explanation:'核定保留款、歷史保留款和收回沖回須與已結算保留款一致'},
 {id:'PENDING_CHEQUE_CLEARING_AND_REVERSAL',priority:'BLOCKING',
  explanation:'支票預留不提前入帳、兌現一次、拒絕重複與修改及取消異常'},
 {id:'BANK_PAYMENT_AUDIT_AND_REVERSAL',priority:'BLOCKING',
  explanation:'銀行收入流水與收款／支票／保留款核定額必須保有唯一來源及回復'},
 {id:'DASHBOARD_EFFECTIVE_AR_RETENTION_REVENUE',priority:'BLOCKING',
  explanation:'首頁未收、保留款、月營業額與折讓扣減需從核定帳本一致讀取'},
 {id:'MONTHLY_REPORTS_AND_FINANCIAL_COSTS',priority:'BLOCKING',
  explanation:'報表與案場損益須同首頁且不把未兌現支票計入銀行現金'},
 {id:'COMMISSION_RELEASE_AND_PAYROLL_GATES',priority:'BLOCKING',
  explanation:'員工抽成解鎖須經過實際核定已收款與防重複薪資付款'},
 {id:'CROSS_DEVICE_STORE_CLOUD_RECONCILIATION',priority:'BLOCKING',
  explanation:'本機提交但雲端失敗／回應遺失不得覆蓋另一台裝置或顯示同步成功'},
 {id:'REAL_BROWSER_BACKUP_AND_RECOVERY',priority:'BLOCKING',
  explanation:'資料回復、IndexedDB、Emergency mirror、journal、主正式環境須全部驗收'},
 {id:'PDF_AND_LEGAL_DOCUMENT_REGENERATION',priority:'BLOCKING',
  explanation:'請款 PDF、折讓說明、發票資訊及歷史文件應一致且符合發佈簽核'},
 {id:'OWNER_ACCEPTANCE_FOR_MAIN_DEPLOY',priority:'BLOCKING',
  explanation:'以上實際驗收後，仍需公司負責人明確同意發布正式站'}
]);
function audit(root){
 assert(typeof root==='string'&&root.length>0,'REPOSITORY_ROOT_REQUIRED');
 const files={};
 for(const [file,expected] of Object.entries(hashes)){
  const contents=read(root,file);
  const actual=gitBlobHash(contents);
  assert(actual===expected,'FORMAL_SOURCE_CHANGED_'+file);
  files[file]={gitBlob:actual,sourceUnchanged:true};
 }
 const original=read(root,'assets/js/erp-store.js');
 const html=read(root,'index.html'),cloud=read(root,'assets/js/cloud-sync.js');
 const pOverlay=read(root,'p37-lab/p37-19p/lab_overlay.py');
 assert(/function requireAllowancesFullyIntegrated\(ar\)/.test(original),
   'P37_LIVE_ALLOWANCE_SETTLEMENT_BLOCKER_MISSING');
 assert(/此筆已關聯折讓紀錄；P37 正式折讓、收款、保留款與票據尚未完整整合/.test(original),
   'P37_LIVE_ALLOWANCE_BLOCKER_TEXT_CHANGED');
 assert(!/P37_19P_UNVERIFIED_SYNTHETIC_FINANCE_OVERLAY_ONLY/.test(original),
   'LAB_OVERLAY_CONTAMINATED_FORMAL_STORE');
 assert(!/p37-19p\/|p37-19q\//i.test(html),'SANDBOX_CODE_LOADED_BY_FORMAL_ERP');
 assert(/function billingAllowanceFormalReadOnlyReport\(/.test(original),
   'FORMAL_READ_ONLY_REFERENCE_MISSING');
 assert(/function billingAllowanceCandidateReview\(/.test(original),
   'FORMAL_REVIEW_REFERENCE_MISSING');
 assert(/erp_state_cas_write_v2/.test(cloud),'FORMAL_CLOUD_CAS_MISSING');
 assert(/ORIGINAL_SHA = "1d74daabcf51a6f47b03bac9bbc5407ca881272d"/.test(pOverlay),
   'P37_19P_ORIGINAL_PIN_MISSING');
 assert(/window\.location\?\.hostname!=='127\.0\.0\.1'/.test(pOverlay),
   'P37_19P_SANDBOX_ONLY_ORIGIN_GUARD_MISSING');
 const h=JSON.parse(read(root,'p37-lab/p37-19h/evidence.json'));
 const i=JSON.parse(read(root,'p37-lab/p37-19i/evidence.json'));
 assert(h.isolatedProjectRef==='ldktrfgzzzmklhsnfrol'&&h.labCasesAtRead===0&&
   h.labAllowancesAtRead===0,'ISOLATED_TEST_PROJECT_EVIDENCE_UNTRUSTED');
 assert(h.realTwoAuthenticatedRPCRequestsExecuted===false&&
   h.distinctSignedSupabaseSessionsObserved===false&&
   h.officialTaxVoucherVerified===false&&h.productionReleaseAllowed===false,
   'H_REAL_AUTH_OR_VOUCHER_EVIDENCE_CANNOT_BE_PROMOTED');
 assert(i.labProject==='ldktrfgzzzmklhsnfrol'&&
   i.allowanceCommittedInSecondTransaction===true&&
   i.exactAdminCleanupCommittedInThirdTransaction===true&&
   i.finalLabCases===0&&i.finalLabAllowances===0&&
   i.realAuthenticatedTwoClientHTTPTestPassed===false&&
   i.taxVoucherIndependentlyVerified===false&&
   i.crossDeviceLiveERPFinancialRegressionPassed===false,
   'I_ISOLATED_DATABASE_SCOPE_NOT_PROVEN');
 const surface=GAPS.audit(root);
 assert(surface.trackedConsumers===12&&surface.canPostAllowance===false,
   'J_FINANCIAL_SURFACE_INCOMPLETE');
 const found=approvalChecks.map(item=>Object.freeze({
   ...item,met:false,authority:'NOT_ACCEPTED_IN_REAL_ERP',
   evidenceType:item.id.includes('CLOUD')?'REAL_DEVICE_AND_CAS':
     item.id.includes('VOUCHER')?'INDEPENDENT_OFFICIAL_VERIFICATION':
     'FORMAL_TRANSACTION_AND_BUSINESS_ACCEPTANCE'
 }));
 assert(found.length===17&&found.every(c=>c.met===false),
   'RELEASE_BLOCKERS_MUST_REMAIN_OPEN');
 return Object.freeze({
  schema:SCHEMA,phase:REVIEW,runScope:'LOCAL_REPOSITORY_REVIEW_ONLY',
  baselineSourceHashes:files,
  prototypeTestsDocumented:true,actualUnmodifiedStoreBrowserTestDocumented:true,
  genuineDualAuthRPCProven:false,formalTaxVoucherProven:false,
  productionAllowancePostingIntegrated:false,productionKpiReportIntegrated:false,
  trueCrossDeviceCloudRollbackProven:false,
  auditedFormalConsumerCount:surface.trackedConsumers,
  blockingRequirements:found,
  statuses:{syntheticTrial:'PASS_IN_PREVIOUS_CI_ONLY',
    formalReadiness:'NO_GO',productionDeployment:'BLOCKED'},
  officialERPDataRead:false,officialERPDataModified:false,
  formalStoreWriterRegistered:false,formalCloudWrites:0,
  formalBankRowsCreated:0,canApproveRelease:false,
  canMergeBeta:false,canMergeMain:false,
  issueMainPush:false
 });
}
module.exports=Object.freeze({audit,gitBlobHash,hashes,approvalChecks,SCHEMA,REVIEW});
