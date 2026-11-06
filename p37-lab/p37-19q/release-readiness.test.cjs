'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Q=require('./release-readiness.cjs');
const root=path.resolve(__dirname,'../..');
const copy=(rootFrom,rootTo,relative)=>{
 const source=path.join(rootFrom,relative),target=path.join(rootTo,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.copyFileSync(source,target);
};
const files=[
 ...Object.keys(Q.hashes),
 'p37-lab/p37-19p/lab_overlay.py',
 'p37-lab/p37-19h/evidence.json',
 'p37-lab/p37-19i/evidence.json'
];
function withShadow(work){
 const shadow=fs.mkdtempSync(path.join(os.tmpdir(),'p37-19q-synthetic-audit-'));
 try{for(const rel of files)copy(root,shadow,rel);return work(shadow)}
 finally{fs.rmSync(shadow,{recursive:true,force:true})}
}
test('SHA-pinned unchanged finance Store, UI, reporting, index and cloud CAS',()=>{
 const report=Q.audit(root);
 assert.equal(report.schema,Q.SCHEMA);
 assert.equal(Object.keys(report.baselineSourceHashes).length,5);
 assert.equal(report.statuses.formalReadiness,'NO_GO');
 assert.equal(report.auditedFormalConsumerCount,12);
 assert.equal(report.canApproveRelease,false);
 assert.equal(report.canMergeMain,false);
 assert.equal(report.canMergeBeta,false);
 assert.equal(report.issueMainPush,false);
 assert.equal(report.formalBankRowsCreated,0);
 assert.equal(report.formalCloudWrites,0);
 assert.equal(report.officialERPDataRead,false);
 assert.equal(report.officialERPDataModified,false);
 for(const [file,expected] of Object.entries(Q.hashes))
  assert.equal(report.baselineSourceHashes[file].gitBlob,expected);
});
test('all 17 missing formal acceptance proofs remain blocking',()=>{
 const report=Q.audit(root);
 assert.equal(report.blockingRequirements.length,17);
 assert.ok(report.blockingRequirements.every(x=>x.priority==='BLOCKING'&&x.met===false));
 assert.ok(report.blockingRequirements.every(x=>x.authority==='NOT_ACCEPTED_IN_REAL_ERP'));
 const expected=['FORMAL_TAX_VOUCHER_AUTHORITY','REAL_COMPANY_OWNER_RLS_SESSION',
  'REAL_REMOTE_RPC_CONCURRENT_CAS','RECEIVABLE_RECEIPT_CREATE_EDIT_DELETE',
  'RETENTION_RECEIPT_CREATE_EDIT_DELETE','PENDING_CHEQUE_CLEARING_AND_REVERSAL',
  'DASHBOARD_EFFECTIVE_AR_RETENTION_REVENUE','MONTHLY_REPORTS_AND_FINANCIAL_COSTS',
  'COMMISSION_RELEASE_AND_PAYROLL_GATES','REAL_BROWSER_BACKUP_AND_RECOVERY',
  'CROSS_DEVICE_STORE_CLOUD_RECONCILIATION','OWNER_ACCEPTANCE_FOR_MAIN_DEPLOY'];
 const ids=report.blockingRequirements.map(x=>x.id);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of expected)assert.ok(ids.includes(id),'missing '+id);
});
test('lab evidence cannot be laundered into a real Supabase two-login certification',()=>{
 withShadow(shadow=>{
  const file=path.join(shadow,'p37-lab/p37-19h/evidence.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  data.distinctSignedSupabaseSessionsObserved=true;
  data.realTwoAuthenticatedRPCRequestsExecuted=true;
  fs.writeFileSync(file,JSON.stringify(data));
  // Dependencies to the original J audit deliberately must not be replaced.
  assert.throws(()=>Q.audit(shadow),/H_REAL_AUTH_OR_VOUCHER_EVIDENCE_CANNOT_BE_PROMOTED/);
 });
});
test('a fake official-tax certificate cannot remove the legal/voucher release blocker',()=>{
 withShadow(shadow=>{
  const file=path.join(shadow,'p37-lab/p37-19i/evidence.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  data.taxVoucherIndependentlyVerified=true;
  fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>Q.audit(shadow),/I_ISOLATED_DATABASE_SCOPE_NOT_PROVEN/);
 });
});
test('changes to any original production source fail before an unverified allowance can ship',()=>{
 for(const [name] of Object.entries(Q.hashes)){
  withShadow(shadow=>{
   const filename=path.join(shadow,name);
   fs.appendFileSync(filename,'\n// P37-19Q deliberate synthetic source-mutation test');
   assert.throws(()=>Q.audit(shadow),/FORMAL_SOURCE_CHANGED_/);
  });
 }
});
test('review-only lab overlay cannot be mounted in production HTML',()=>{
 withShadow(shadow=>{
  const file=path.join(shadow,'index.html');
  fs.appendFileSync(file,'\n<script src="p37-lab/p37-19p/lab_overlay.py"></script>');
  assert.throws(()=>Q.audit(shadow),/FORMAL_SOURCE_CHANGED_|SANDBOX_CODE_LOADED/);
 });
});
test('the gate has no network, browser, Store-writer or deployment action dependencies',()=>{
 const src=fs.readFileSync(path.join(__dirname,'release-readiness.cjs'),'utf8');
 const imports=[...src.matchAll(/\brequire\((['"])(.*?)\1\)/g)].map(x=>x[2]);
 assert.deepEqual(imports,['node:fs','node:path','node:crypto',
   '../p37-19j-financial-integration-gaps.cjs']);
 assert.doesNotMatch(src,/\bfetch\s*\(|\bindexedDB\s*\.|\blocalStorage\s*\.|(?:\bwriteFile|\bexecFile|\bspawn|\bhttp\.request)\s*\(/);
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.doesNotMatch(store,/p37-19q|p3719q/i);
 assert.doesNotMatch(html,/p37-19q/i);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/此筆已關聯折讓紀錄；P37 正式折讓、收款、保留款與票據尚未完整整合/);
});
