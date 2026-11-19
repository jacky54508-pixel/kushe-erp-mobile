'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {decide,exactHash,ROUTES}=require('./rollout_boundary.cjs');
const create=()=>{
 const doc={companyId:'FAKE_CO',documentId:'FAKE_MERGED_001',targetBillingId:'FAKE_M_AREA',customerId:'FAKE_BUILDER',status:'active',current:true,historical:false,legacy:false,revision:5,syncVersion:19,
  sourceDigest:'FAKE_SRC_V5',settlementDigest:'FAKE_RECEIPT_V4',invoiceDigest:'FAKE_INVOICE_V2',publicNote:'For fake customer only',
  anchors:{untaxed:1000,tax:50,grossTotal:1050,retention:50,receivable:1000},lines:[{house:'M-01',item:'fake repair',unit:'m2',qty:2,price:500,amount:1000}],
  secretPayroll:'NEVER_EXPORT',secretBank:'NEVER_EXPORT',originalInvoiceNumbers:['INV-SECRET']};
 const evidence={mockTrustedSource:true,mockVerifiedSession:true,mockSessionCurrent:true,mockAal:'aal2',mockCompanyActive:true,mockDocumentAcl:true,mockDurableRevisionAudit:true,
  companyId:doc.companyId,documentId:doc.documentId,targetBillingId:doc.targetBillingId,revision:doc.revision,syncVersion:doc.syncVersion,docDigest:exactHash(doc),finalReadDigest:exactHash(doc)};
 return {route:'new-external-document-approval',policy:{ownerSelected:true,mode:'OWNER_REVIEW_SELF_DENIED',fakeOnly:true,selfReviewEnabled:false},
  doc,actor:{id:'FAKE_ACCOUNTING',role:'accounting',companyId:doc.companyId},reviewer:{id:'FAKE_OWNER',role:'owner',companyId:doc.companyId},evidence};
};
const code=(mut,expect)=>{let o=create();mut(o);assert.equal(decide(o).code,expect)};
test('unselected owner policy blocks despite 下一步',()=>code(o=>o.policy.ownerSelected=false,'OWNER_POLICY_NOT_SELECTED'));
test('missing policy blocks',()=>code(o=>{delete o.policy},'OWNER_POLICY_NOT_SELECTED'));
test('self exception cannot be enabled in conservative candidate',()=>code(o=>{o.policy.selfReviewEnabled=true},'OWNER_POLICY_NOT_SELECTED'));
test('two-person owner-only FAKE candidate returns no real approval',()=>{let o=create(),r=decide(o);assert.equal(r.status,'FAKE_ELIGIBLE_FOR_REVIEW_ONLY');assert.equal(r.actualApproval,false);assert.equal(r.canDeploy,false);assert.equal(r.canWrite,false)});
test('owner editing the same document cannot self review',()=>code(o=>{o.actor={...o.reviewer};o.evidence.selfReview={confirmation:true}},'NO_SELF_REVIEW'));
test('same owner with different role label still same user blocked',()=>code(o=>{o.actor.id=o.reviewer.id;o.actor.role='admin'},'NO_SELF_REVIEW'));
test('accounting cannot approve',()=>code(o=>o.reviewer.role='accounting','REVIEWER_OR_COMPANY_DENIED'));
test('employee cannot edit new approved document',()=>code(o=>o.actor.role='employee','REVIEWER_OR_COMPANY_DENIED'));
test('outsider company editor blocked',()=>code(o=>o.actor.companyId='FAKE_OTHER','REVIEWER_OR_COMPANY_DENIED'));
test('outsider company owner blocked',()=>code(o=>o.reviewer.companyId='FAKE_OTHER','REVIEWER_OR_COMPANY_DENIED'));
test('expired mock session blocks',()=>code(o=>o.evidence.mockSessionCurrent=false,'MOCK_AUTHZ_EVIDENCE_INCOMPLETE'));
test('AAL1 blocks',()=>code(o=>o.evidence.mockAal='aal1','MOCK_AUTHZ_EVIDENCE_INCOMPLETE'));
test('revoked fake document ACL blocks',()=>code(o=>o.evidence.mockDocumentAcl=false,'MOCK_AUTHZ_EVIDENCE_INCOMPLETE'));
test('missing durable revision audit blocks',()=>code(o=>o.evidence.mockDurableRevisionAudit=false,'MOCK_AUTHZ_EVIDENCE_INCOMPLETE'));
test('wrong document binding blocks',()=>code(o=>o.evidence.documentId='OTHER','DOCUMENT_BINDING_MISMATCH'));
test('wrong target M/L zone blocks',()=>code(o=>o.evidence.targetBillingId='FAKE_L_AREA','DOCUMENT_BINDING_MISMATCH'));
test('old revision blocks',()=>code(o=>o.evidence.revision=4,'DOCUMENT_BINDING_MISMATCH'));
test('old sync version blocks',()=>code(o=>o.evidence.syncVersion=18,'DOCUMENT_BINDING_MISMATCH'));
test('source changed => old approval blocked',()=>code(o=>o.doc.sourceDigest='changed source','DOCUMENT_CHANGED'));
test('settlement changed => old approval blocked',()=>code(o=>o.doc.settlementDigest='changed receipt','DOCUMENT_CHANGED'));
test('invoice changed => old approval blocked',()=>code(o=>o.doc.invoiceDigest='changed invoice','DOCUMENT_CHANGED'));
test('customer-facing note changed => old approval blocked',()=>code(o=>o.doc.publicNote='changed note','DOCUMENT_CHANGED'));
test('amount changed => old approval blocked',()=>code(o=>{o.doc.anchors.untaxed=1100;o.doc.anchors.grossTotal=1150;o.doc.anchors.receivable=1100},'DOCUMENT_CHANGED'));
test('line changed => old approval blocked',()=>code(o=>{o.doc.lines[0].item='new repair'},'DOCUMENT_CHANGED'));
test('final-read different digest blocks PDF eligibility',()=>code(o=>o.evidence.finalReadDigest='old','FINAL_READ_CHANGED'));
test('invalid document line blocks',()=>code(o=>{o.doc.lines[0].qty=0},'DOCUMENT_INVALID'));
test('historical document cannot be routed through new approval',()=>code(o=>{o.doc.historical=true},'NEW_ACTIVE_DOCUMENTS_ONLY'));
test('legacy saved document cannot be routed through new approval',()=>code(o=>{o.doc.legacy=true},'NEW_ACTIVE_DOCUMENTS_ONLY'));
test('draft document cannot be approved',()=>code(o=>{o.doc.status='draft'},'NEW_ACTIVE_DOCUMENTS_ONLY'));
test('unknown route blocks',()=>code(o=>{o.route='production-deploy'},'UNKNOWN_ROUTE'));
for(const route of ROUTES){test('pre-existing ERP route is untouched in isolated design: '+route,()=>{let r=decide({route,policy:{ownerSelected:false}});assert.equal(r.status,'LEGACY_ROUTE_UNCHANGED');assert.equal(r.canWrite,false);assert.equal(r.actualApproval,false)})}
test('optional empty public note is valid',()=>{let o=create();o.doc.publicNote='';o.evidence.docDigest=exactHash(o.doc);o.evidence.finalReadDigest=exactHash(o.doc);assert.equal(decide(o).status,'FAKE_ELIGIBLE_FOR_REVIEW_ONLY')});
test('unrelated payroll/bank not used in approval fingerprint',()=>{let o=create(),h=exactHash(o.doc);o.doc.secretPayroll='new fake salary';o.doc.secretBank='new fake bank';assert.equal(exactHash(o.doc),h)});
test('source digest cannot disclose raw invoice or employee details',()=>{let o=create(),h=exactHash(o.doc);assert.equal(h.includes('NEVER_EXPORT'),false);assert.equal(h.includes('INV-SECRET'),false);assert.equal(Object.keys(o.doc).includes('secretPayroll'),true)});
test('official GitHub source guard: legacy entry points unchanged, current print target-only, historical privacy flagged',t=>{
 const root=path.resolve(__dirname,'..'),files=['assets/js/erp-store.js','assets/js/cloud-sync.js','assets/js/billing-groups.js','assets/js/external-billing-print.js'];
 if(!files.every(f=>fs.existsSync(path.join(root,f)))){if(process.env.P40BP_FULL_SOURCE_REQUIRED==='true')throw Error('CI_SOURCE_MISSING');return t.skip('only full GitHub checkout may PASS source guard')}
 const get=f=>fs.readFileSync(path.join(root,f),'utf8'); const store=get(files[0]),sync=get(files[1]),groups=get(files[2]),print=get(files[3]);
 assert.ok(sync.includes('erp_state_cas_write_v2')); assert.ok(sync.includes('remotePath(userId)'));
 assert.ok(store.includes('function externalBillingDocumentIndex()')); assert.ok(store.includes('state.meta.externalBillingDocuments'));
 assert.ok(groups.includes('function printSaved(id,revision=0,historyOnly=false)'));
 assert.ok(print.includes('const mergedBillingProjects=[String(d.displayProjectName'));
 assert.ok(print.includes('if(!payload.historical)'));
 assert.ok(print.includes('const invoices=refs.rows.map')); // historical invoice details require external privacy audit, DO NOT auto-route to new service
});
