'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('./release-gate.cjs');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'evidence.json'),'utf8'));
const sql=fs.readFileSync(path.join(__dirname,'p37-19f-rollback-rls.sql'),'utf8');
test('Only the exact isolated project and zero synthetic records are accepted',()=>{
 assert.equal(evidence.labProjectRef,'ldktrfgzzzmklhsnfrol');
 assert.equal(evidence.labCasesAfter,0);assert.equal(evidence.labAllowancesAfter,0);
 assert.equal(evidence.productionTouched,false);
 assert.throws(()=>gate.inspect({...evidence,labProjectRef:'jimcybsztnwfzrnvexsp'}),/UNKNOWN_LAB/);
 assert.throws(()=>gate.inspect({...evidence,labCasesAfter:1}),/NONZERO/);
});
test('Real DB rollback evidence has separate status from unverified two-client concurrency',()=>{
 const decision=gate.inspect(evidence);
 assert.equal(decision.realDatabaseRollbackVerified,true);
 assert.equal(decision.realTwoClientRpcConcurrencyVerified,false);
 assert.equal(decision.canPost,false);assert.equal(decision.status,'REVIEW_ONLY_POSTING_DISABLED');
 assert.equal(decision.formalDataChanged,false);assert.equal(decision.cloudWrites,0);
 assert.ok(decision.pending.includes('concurrentAuthorizedRpcAgainstSameCaseTested'));
});
test('Even fully claimed client evidence cannot directly authorize a formal ERP write',()=>{
 const forged={...evidence,realAuthenticatedHttpClientsTested:true,
 concurrentAuthorizedRpcAgainstSameCaseTested:true,sqlLockContentionActuallyObserved:true,
 realProductionCloudCasTested:true,formalVoucherIndependentlyVerified:true,
 settlementWritersFullyIntegrated:true,productionPostingApproved:true};
 const decision=gate.inspect(forged);
 assert.equal(decision.canPost,false);
 assert.equal(decision.allowanceWriterRegistered,false);
});
test('SQL proof is strictly rollback only, scoped to synthetic laboratory, not a deploy or migration',()=>{
 assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,2);
 assert.equal((sql.match(/^ROLLBACK;$/gm)||[]).length,2);
 assert.doesNotMatch(sql,/^\s*(COMMIT|CREATE|ALTER|DROP|TRUNCATE|DELETE|GRANT|REVOKE)\b/im);
 assert.doesNotMatch(sql,/jimcybsztnwfzrnvexsp/);
 assert.match(sql,/ldktrfgzzzmklhsnfrol/);
 assert.match(sql,/SET LOCAL ROLE anon/);
 assert.match(sql,/SET LOCAL ROLE authenticated/);
 assert.match(sql,/AFTER_ALLOWANCE_INSERT/);
 assert.match(sql,/AFTER_REVISION_UPDATE/);
 assert.match(sql,/P37_LAB_DUPLICATE_OR_VERSION_CONFLICT/);
 assert.match(sql,/P37_LAB_EXPECTED_ID_AND_VERSION_REQUIRED/);
 assert.match(sql,/target_cases_after_rollback/);
 assert.match(sql,/target_allowances_after_rollback/);
});
test('GitHub release candidate does not auto-mount P37-19F or introduce writer APIs',()=>{
 const root=path.join(__dirname,'../..');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const sync=fs.readFileSync(path.join(root,'assets/js/cloud-sync.js'),'utf8');
 assert.doesNotMatch(store,/p37-19f/i);assert.doesNotMatch(html,/p37-19f/i);
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.match(store,/billingAllowanceFormalReadOnlyReport/);
 assert.match(sync,/erp_state_cas_write_v2/);
 assert.doesNotMatch(sync,/P37-19F/);
});
