'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('./release-gate.cjs');
const dir=__dirname,root=path.join(dir,'../..');
const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));
test('actual separate-commit lifecycle evidence passes but production remains blocked',()=>{
 const d=gate.inspect(evidence);
 assert.equal(d.labLifecyclePassed,true);
 assert.equal(d.parallelRealHTTPRpcVerified,false);
 assert.equal(d.formalPostingEnabled,false);assert.equal(d.canMergeMain,false);
 assert.equal(d.bankRowsCreated,0);assert.equal(d.cloudWrites,0);
 const bad=structuredClone(evidence);bad.finalLabAllowances=1;
 assert.throws(()=>gate.inspect(bad),/UNTRUSTED/);
 const forged={...evidence,realAuthenticatedTwoClientHTTPTestPassed:true,
 productionPostingEnabled:true,crossDeviceLiveERPFinancialRegressionPassed:true};
 assert.equal(gate.inspect(forged).formalPostingEnabled,false);
});
test('lab SQL is exact UUID, money, authenticated role, COMMIT; no permission changes',()=>{
 const s=fs.readFileSync(path.join(dir,'apply-separate-committed-allowance.sql'),'utf8');
 assert.match(s,/ldktrfgzzzmklhsnfrol/);
 assert.match(s,/00000000-0000-4000-8000-000000019019/);
 assert.match(s,/SET LOCAL ROLE authenticated;/);
 assert.match(s,/SET CONSTRAINTS ALL IMMEDIATE;/);
 assert.match(s,/COMMIT;/);
 assert.match(s,/P37_19I_DISCOUNT_POSTCHECK_FAILED/);
 assert.doesNotMatch(s,/^\s*(ALTER|DROP|GRANT|REVOKE|TRUNCATE|CREATE)\s/mi);
 assert.doesNotMatch(s,/jimcybsztnwfzrnvexsp/);
});
test('all live business writers remain blocked and previous exact cleanup remains available',()=>{
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(store,/function requireAllowancesFullyIntegrated\(ar\)/);
 assert.doesNotMatch(store,/p37-19i/i);assert.doesNotMatch(index,/p37-19i/i);
 const cleanup=fs.readFileSync(path.join(root,'p37-lab/p37-19g/cleanup-fixture.sql'),'utf8');
 assert.match(cleanup,/P37_19G_FIXTURE_IDENTITY_MISMATCH/);
 assert.match(cleanup,/DELETE FROM public.p37_lab_allowances/);
 assert.match(cleanup,/DELETE FROM public.p37_lab_cases/);
});
