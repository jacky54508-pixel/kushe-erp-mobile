'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candidateReview,contentDigest,MODES}=require('./approval_policy.cjs');
const mkDoc=()=>({companyId:'FAKE_COMPANY_A',id:'FAKE_EXTERNAL_DOC_1',revision:2,status:'active',isCurrentVersion:true,
  targetBillingId:'FAKE_M',customerId:'FAKE_CUSTOMER',sourceDigest:'fake_source_version_9',receiptDigest:'fake_receipts_2',
  invoiceDigest:'fake_invoice_digest_3',sourceSyncVersion:15,publicLines:[{house:'A1',item:'fake work',unit:'M2',qty:2,price:100,amount:200}],
  money:{untaxed:200,tax:10,grossTotal:210,retention:10,receivable:200},publicNote:'customer visible only'});
const mk=()=>{const doc=mkDoc();return {policy:{status:'SIMULATED_ONLY_NOT_OWNER_APPROVED',mode:MODES[0]},doc,
  editor:{id:'FAKE_ACCOUNTANT',role:'accounting',companyId:doc.companyId},
  reviewer:{id:'FAKE_OWNER',role:'owner',companyId:doc.companyId},
  evidence:{trustedServerSource:true,verifiedSignedSession:true,sessionActive:true,aal:'aal2',
    companyMembershipCurrent:true,documentACLCurrent:true,reviewVersionLocked:true,trustedDurableAuditReady:true,
    expectedDocId:doc.id,expectedRevision:doc.revision,expectedCompanyId:doc.companyId,
    expectedTargetBillingId:doc.targetBillingId,expectedSourceSyncVersion:doc.sourceSyncVersion,contentDigest:contentDigest(doc)}}};
const check=(f,code)=>{const v=mk();f(v);assert.equal(candidateReview(v).code,code)};
test('unknown policy blocks; 下一步 is not approval',()=>check(x=>{x.policy.status='UNDECIDED'},'POLICY_UNDECIDED'));
test('unknown reviewer policy blocks',()=>check(x=>x.policy.mode='ALLOW_ALL','POLICY_UNDECIDED'));
test('fake normal accounting to owner candidate accepted only as mock',()=>{const r=candidateReview(mk());assert.equal(r.status,'MOCK_POLICY_PERMITS_REVIEW_ONLY');assert.equal(r.productionApproved,false);assert.equal(r.canDeploy,false);assert.equal(r.isRealApproval,false)});
test('employee may not prepare new signed document',()=>check(x=>x.editor.role='employee','ACTOR_NOT_ELIGIBLE'));
test('accounting cannot approve',()=>check(x=>x.reviewer.role='accounting','REVIEWER_ROLE_DENIED'));
test('owner-only mode rejects admin review',()=>check(x=>x.reviewer.role='admin','OWNER_REQUIRED'));
test('another company reviewer blocked',()=>check(x=>x.reviewer.companyId='FAKE_COMPANY_B','ACTOR_NOT_ELIGIBLE'));
test('same user under owner-only blocked by default',()=>check(x=>{x.editor={...x.reviewer}},'SELF_REVIEW_EXCEPTION_NOT_APPROVED'));
test('owner own edit requires separately simulated exception and explicit second review',()=>{
 const x=mk();x.editor={...x.reviewer};x.policy.selfReviewExceptionApprovedForSimulation=true;
 assert.equal(candidateReview(x).code,'SELF_REVIEW_INSUFFICIENT');
 x.evidence.selfReview={reauthenticatedAal2:true,explicitSecondConfirmation:true,reason:'fake exceptional rationale',
 documentId:x.doc.id,revision:x.doc.revision,contentDigest:x.evidence.contentDigest};
 const r=candidateReview(x);assert.equal(r.selfReview,true);assert.equal(r.productionApproved,false);
});
test('self-review rejects wrong revision confirmation',()=>check(x=>{x.editor={...x.reviewer};x.policy.selfReviewExceptionApprovedForSimulation=true;x.evidence.selfReview={reauthenticatedAal2:true,explicitSecondConfirmation:true,reason:'fake',documentId:x.doc.id,revision:1,contentDigest:x.evidence.contentDigest}},'SELF_REVIEW_INSUFFICIENT'));
test('maker checker allows separate admin reviewer',()=>{const x=mk();x.policy.mode=MODES[1];x.reviewer.role='admin';const r=candidateReview(x);assert.equal(r.status,'MOCK_POLICY_PERMITS_REVIEW_ONLY')});
test('maker checker rejects same actor even owner',()=>check(x=>{x.policy.mode=MODES[1];x.editor={...x.reviewer};x.policy.selfReviewExceptionApprovedForSimulation=true},'MAKER_CHECKER_SAME_PERSON'));
test('maker checker does not accept self review waiver',()=>{const x=mk();x.policy.mode=MODES[1];x.editor={...x.reviewer};x.evidence.selfReview={reauthenticatedAal2:true,explicitSecondConfirmation:true,reason:'fake',documentId:x.doc.id,revision:2,contentDigest:x.evidence.contentDigest};assert.equal(candidateReview(x).code,'MAKER_CHECKER_SAME_PERSON')});
for(const [label,change] of [
 ['untrusted document source',x=>x.evidence.trustedServerSource=false],['no crypto attestation',x=>x.evidence.verifiedSignedSession=false],
 ['revoked session',x=>x.evidence.sessionActive=false],['MFA AAL1',x=>x.evidence.aal='aal1'],
 ['inactive company membership',x=>x.evidence.companyMembershipCurrent=false],['missing document ACL',x=>x.evidence.documentACLCurrent=false],
 ['unlocked review version',x=>x.evidence.reviewVersionLocked=false]])test('rejects '+label,()=>check(change,'TRUST_BOUNDARY_UNVERIFIED'));
for(const [label,change] of [
 ['wrong doc id',x=>x.evidence.expectedDocId='FAKE_OTHER'],['old revision',x=>x.evidence.expectedRevision=1],
 ['wrong source sync version',x=>x.evidence.expectedSourceSyncVersion=14],['wrong target zone',x=>x.evidence.expectedTargetBillingId='FAKE_B'],
 ['wrong company',x=>x.evidence.expectedCompanyId='FAKE_COMPANY_B']])test('rejects '+label,()=>check(change,'DOCUMENT_BINDING_FAILED'));
for(const [label,change] of [
 ['line quantity changed',x=>{x.doc.publicLines[0].qty=3;x.doc.publicLines[0].amount=300}],
 ['customer note changed',x=>x.doc.publicNote='new public note'],
 ['source digest changed',x=>x.doc.sourceDigest='fake_revised'],
 ['settlement digest changed',x=>x.doc.receiptDigest='fake_receipts_3'],
 ['invoice digest changed',x=>x.doc.invoiceDigest='fake_invoice_4'],
 ['customer changed',x=>x.doc.customerId='FAKE_CUSTOMER_B']])test('rejects '+label,()=>check(change,'DOCUMENT_CHANGED'));
for(const status of ['draft','archived','historical'])test('legacy mode does not block existing PDF; new gate refuses '+status,()=>check(x=>x.doc.status=status,'CURRENT_ACTIVE_ONLY'));
test('not current document',()=>check(x=>x.doc.isCurrentVersion=false,'CURRENT_ACTIVE_ONLY'));
test('new gateway refuses historical legacy document',()=>check(x=>x.doc.isLegacy=true,'CURRENT_ACTIVE_ONLY'));
test('must have durable audit evidence',()=>check(x=>x.evidence.trustedDurableAuditReady=false,'DURABLE_AUDIT_NOT_PROVEN'));
test('rejects invalid line amounts rather than recomputing accounting amounts',()=>check(x=>x.doc.publicLines[0].amount=500,'DOCUMENT_INVALID'));
test('fake internal data does not go into hash or result',()=>{
 const x=mk();x.doc.bankAccounts=['PRIVATE_BANK_SENTINEL'];x.doc.payroll=['PRIVATE_PAYROLL_SENTINEL'];
 assert.equal(x.evidence.contentDigest,contentDigest(x.doc));const r=candidateReview(x);assert(!JSON.stringify(r).includes('PRIVATE_BANK_SENTINEL'));assert(!JSON.stringify(r).includes('PRIVATE_PAYROLL_SENTINEL'));
});
test('no file system, HTTP, SQL, or deployment actions in policy module',()=>{
 const fs=require('node:fs'),src=fs.readFileSync(require.resolve('./approval_policy.cjs'),'utf8');
 for(const s of ['fetch(', 'https.request', 'execSync(', 'createClient(', 'service_role', 'process.env.', 'writeFileSync(', 'INSERT INTO', 'window.print('])assert.equal(src.includes(s),false,s);
});
test('production release JSON remains BLOCKED and no owner approval asserted',()=>{
 const d=require('../.p40-16bn-review/decision.json');assert.equal(d.production_release,'BLOCKED');assert.equal(d.owner_policy_selected,false);
 assert.equal(d.official_main_unchanged_required,true);assert.equal(d.eligible_for_real_approvals,false);assert.equal(d.migrate_existing_bills,false);
});
test('official source behavior verified only in full GitHub checkout; CI must never skip',t=>{
 const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
 const files=['assets/js/erp-store.js','assets/js/billing-groups.js','assets/js/cloud-sync.js','assets/js/auth-gate.js'];
 if(files.some(f=>!fs.existsSync(path.join(root,f)))){
    if(process.env.GITHUB_ACTIONS==='true')assert.fail('FULL_CHECKOUT_REQUIRED');
    t.skip('source guard runs in GitHub CI full checkout');return;
 }
 const store=fs.readFileSync(path.join(root,files[0]),'utf8'),ui=fs.readFileSync(path.join(root,files[1]),'utf8'),cloud=fs.readFileSync(path.join(root,files[2]),'utf8'),auth=fs.readFileSync(path.join(root,files[3]),'utf8');
 assert.match(store,/externalBillingDocuments/);assert.match(store,/expectedSnapshot/);assert.match(store,/sourceSnapshots/);
 assert.match(ui,/printSaved\(/);assert.match(cloud,/erp_state_cas_write_v2/);assert.match(auth,/company_members/);assert.match(auth,/aal2/);
});
