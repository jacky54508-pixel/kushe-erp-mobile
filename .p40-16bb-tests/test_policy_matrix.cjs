/* P40-16BB: 100% synthetic policy decision matrix, never a JWT verifier.
 * Decisions are hypothetical PRE-APPROVED business-process candidates only.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {makeDecision,POLICIES,ACTIONS,expectedFields,sha}=
  require('./mock_policy_authority.cjs');
const ROOT=path.resolve(__dirname,'..');
const fingerprint='a'.repeat(64);
const ROLES=['owner','admin','accounting','employee'];
const actors={
 owner: 'FAKE-USER-REVIEWER',
 admin: 'FAKE-USER-ADMIN',
 accounting: 'FAKE-USER-ACCOUNTANT',
 employee: 'FAKE-USER-EMPLOYEE'
};
function actor(role='owner',extra={}){
 return {role,userId:actors[role],companyId:'FAKE-COMPANY-ONE',
  allowedDocuments:['FAKE-DOC-ONE'],aal:'aal2',
  signatureVerified:true,issuerVerified:true,audienceVerified:true,
  expiryVerified:true,sessionValid:true,membershipActive:true,...extra};
}
function doc(extra={}){
 return {id:'FAKE-DOC-ONE',companyId:'FAKE-COMPANY-ONE',
  revision:3,status:'active',mode:'enforced',
  workflow:'pending_review',fingerprint,
  sourceMatchesCurrent:true,reorganized:true,reason:'FAKE-REARRANGEMENT',
  editorId:actors.accounting,submitterId:actors.accounting,
  historyRevisions:[1,2],unchangedSinceLegacyEnrollment:false,
  ...extra};
}
function request(action,extra={}){
 const base={action,documentId:'FAKE-DOC-ONE',revision:3};
 if(!['view_current','view_history'].includes(action))base.expectedHash=fingerprint;
 return {...base,...extra};
}
function approval(extra={}){
 return {fakeTrustedRegistryEntry:true,companyId:'FAKE-COMPANY-ONE',
  documentId:'FAKE-DOC-ONE',revision:3,fingerprint,editorId:actors.accounting,
  submitterId:actors.accounting,reviewerId:actors.owner,reviewerRole:'owner',
  ...extra};
}
function decide(action,{role='owner',principal=actor(role),document=doc(),
  requestObj=request(action),reviewRecord=null,policyId}={}){
 return makeDecision({request:requestObj,principal,document,reviewRecord,policyId});
}
function denied(action,reason,overrides={}){
 const r=decide(action,overrides);
 assert.deepEqual(r,{allowed:false,reason});
}
function allowed(action,next,overrides={}){
 const r=decide(action,overrides);
 assert.equal(r.allowed,true,r.reason);
 assert.equal(r.next,next);
 return r;
}
test('roles agree with immutable formal main frontend role matrix',()=>{
 const s=fs.readFileSync(path.join(ROOT,'assets/js/auth-gate.js'),'utf8');
 for(const role of ROLES)assert.ok(s.includes(role+':Object.freeze({'));
 assert.match(s,/function canView\(module\)/);
 assert.match(s,/function canWrite\(module\)/);
 assert.match(s,/sessionAal\(current\)!=='aal2'/);
 assert.match(s,/accounting:Object\.freeze\(\{\s*view:Object\.freeze\(\[[^\]]*'billings'/);
 assert.match(s,/employee:Object\.freeze\(\{\s*view:Object\.freeze\(\['projects','materials','commissions'\]\)/);
});
test('formal store revision and historical print paths unchanged',()=>{
 const s=fs.readFileSync(path.join(ROOT,'assets/js/erp-store.js'),'utf8');
 const ui=fs.readFileSync(path.join(ROOT,'assets/js/billing-groups.js'),'utf8');
 assert.match(s,/values.expectedSnapshot!==ctx.snapshot/);
 assert.match(s,/revision:\(previous\?\.revision\|\|0\)\+1/);
 assert.match(s,/history:previous\?\[/);
 assert.match(ui,/function printSaved\(id,revision=0,historyOnly=false\)/);
 assert.match(ui,/g\.issues.length\|\|g\.termsChanged\|\|g\.settlementChanged/);
});
test('two policy options exist, neither authorizes self approval',()=>{
 assert.deepEqual(Object.keys(POLICIES).sort(),[
  'candidate-owner-or-admin-independent','alternative-owner-only-independent'
 ].sort());
 for(const p of Object.values(POLICIES)){
  assert.equal(p.independentReviewer,true);
  assert.equal(p.allowSelfReview,false);
 }
});
test('unknown policy ID blocks rather than defaulting to all roles',()=>{
 denied('approve','POLICY_NOT_APPROVED_OR_UNKNOWN',{policyId:'anyone_can_approve'});
});
test('unknown action cannot perform privileged operations',()=>{
 const result=makeDecision({request:{action:'delete_all_bills'},
  principal:actor(),document:doc()});
 assert.deepEqual(result,{allowed:false,reason:'ACTION_UNSUPPORTED'});
});
test('all supported actions have a strict allowed request field contract',()=>{
 assert.deepEqual(ACTIONS.slice().sort(),Object.keys(expectedFields).sort());
});
const dangerousFields=[
 'role','companyId','allowedDocuments','approval','approvedBy',
 'publicView','sourceSnapshots','settlementSnapshots','bankTransactions',
 'payroll','invoiceNo','jwt','session','verified','service_role',
 'user_metadata','fakeTrustedRegistryEntry','legacyMode','originalAmount'
];
for(const field of dangerousFields){
 test('cannot smuggle client-supplied authorization or business data: '+field,()=>{
  denied('approve','REQUEST_FIELDS_NOT_ALLOWED',{
   requestObj:request('approve',{[field]:'FORGED'})
  });
 });
}
test('cannot omit explicit document ID / version / fingerprint',()=>{
 for(const key of ['documentId','revision','expectedHash']){
  const q=request('approve');delete q[key];
  denied('approve','REQUEST_FIELDS_NOT_ALLOWED',{requestObj:q});
 }
});
for(const key of ['signatureVerified','issuerVerified','audienceVerified',
 'expiryVerified','sessionValid','membershipActive']){
 test('fake verified identity fails closed when '+key+' false',()=>{
  denied('approve','FAKE_IDENTITY_AUTH_MFA_FAILED',{
   principal:actor('owner',{[key]:false})
  });
 });
}
test('fake AAL1 / MFA missing rejected',()=>{
 denied('approve','FAKE_IDENTITY_AUTH_MFA_FAILED',{
  principal:actor('owner',{aal:'aal1'})
 });
});
test('unknown real-like JWT strings not accepted as fake identity',()=>{
 const r=makeDecision({request:request('approve'),principal:'eyJ.fake.jwt',
  document:doc()});
 assert.equal(r.reason,'FAKE_IDENTITY_AUTH_MFA_FAILED');
});
test('cross-company principal rejected',()=>{
 denied('approve','CROSS_COMPANY_DENIED',{
  principal:actor('owner',{companyId:'FAKE-COMPANY-TWO'})
 });
});
test('cross-document IDOR denied before operation decision',()=>{
 denied('approve','DOCUMENT_ACL_DENIED',{
  principal:actor('owner',{allowedDocuments:['FAKE-DOC-OTHER']})
 });
});
test('request document ID mismatch is denied',()=>{
 denied('approve','DOCUMENT_ID_MISMATCH',{
  requestObj:request('approve',{documentId:'FAKE-DOC-OTHER'})
 });
});
test('fake employee cannot read historical or current billing',()=>{
 for(const action of ['view_current','view_history']){
  denied(action,'BILLING_ROLE_DENIED',{role:'employee'});
 }
});
test('fake employee cannot submit, approve, return or release',()=>{
 for(const action of ['submit','approve','return','release_to_pdf_gate']){
  const req=action==='return'
    ? request('return',{reason:'FAKE-COMPLETE-RETURN-REASON'})
    : request(action);
  denied(action,'BILLING_ROLE_DENIED',{role:'employee',requestObj:req});
 }
});
test('approved owner or admin can review but accounting cannot',()=>{
 for(const role of ['owner','admin'])
  allowed('approve','RECORD_INDEPENDENT_REVISION_APPROVAL_ONLY',{role});
 denied('approve','REVIEWER_ROLE_DENIED',{role:'accounting'});
});
test('alternative owner-only mode excludes admin',()=>{
 denied('approve','REVIEWER_ROLE_DENIED',{
  role:'admin',policyId:'alternative-owner-only-independent'
 });
 allowed('approve','RECORD_INDEPENDENT_REVISION_APPROVAL_ONLY',{
  role:'owner',policyId:'alternative-owner-only-independent'
 });
});
test('owner/editor cannot self-approve even with owner role',()=>{
 denied('approve','SEPARATION_OF_DUTIES_REQUIRED',{
  principal:actor('owner',{userId:actors.accounting})
 });
});
test('owner who was submitter also cannot approve',()=>{
 denied('approve','SEPARATION_OF_DUTIES_REQUIRED',{
  document:doc({submitterId:actors.owner})
 });
});
test('sole person company gets no hidden override or bypass',()=>{
 const principal=actor('owner',{userId:actors.accounting});
 for(const policyId of Object.keys(POLICIES))
  denied('approve','SEPARATION_OF_DUTIES_REQUIRED',{principal,policyId});
});
test('new rearranged document must be currently pending before approval',()=>{
 for(const workflow of ['editing','returned','approved','draft'])
  denied('approve','NOT_PENDING_INDEPENDENT_REVIEW',{
   document:doc({workflow})
  });
});
test('unchanged original construction needs no separate reorganization approval',()=>{
 denied('approve','NOT_A_REARRANGED_DOCUMENT',{
  document:doc({reorganized:false})
 });
});
test('wrong revision or stale source hash never approves',()=>{
 denied('approve','STALE_OR_OTHER_VERSION',{
  requestObj:request('approve',{revision:2})
 });
 denied('approve','SOURCE_FINGERPRINT_MISMATCH',{
  requestObj:request('approve',{expectedHash:'b'.repeat(64)})
 });
});
test('source changed since preflight blocks approval, return and release',()=>{
 for(const action of ['approve','return','release_to_pdf_gate']){
  denied(action,'SOURCE_DRIFT_BLOCKED',{
   document:doc({sourceMatchesCurrent:false}),
   requestObj:request(action,action==='return'?{reason:'FAKE-REVIEW-NOTE'}:{})
  });
 }
});
test('archived current document blocks approval and release',()=>{
 for(const action of ['approve','release_to_pdf_gate'])
  denied(action,'NOT_ACTIVE_CURRENT_DOCUMENT',{document:doc({status:'archived'})});
});
test('all billing editor roles may request edit with formal CAS only',()=>{
 for(const role of ['owner','admin','accounting'])
  allowed('edit','CREATE_NEW_REVISION_WITH_FORMAL_CAS_ONLY',{
   role,document:doc({workflow:'approved'})
  });
});
test('editing must stop if a version is pending review',()=>{
 denied('edit','PENDING_MUST_RETURN_OR_WITHDRAW');
});
test('reorganization requires proper reason at submission',()=>{
 denied('submit','REARRANGEMENT_REASON_REQUIRED',{
  role:'accounting',document:doc({workflow:'editing',reason:' '})
 });
});
test('editing bill can be submitted by accounting with source digest',()=>{
 allowed('submit','SUBMIT_REVISION_AND_SOURCE_DIGEST',{
  role:'accounting',document:doc({workflow:'editing'})
 });
});
test('returned document must be revised before resubmission',()=>{
 denied('submit','RETURNED_REQUIRES_NEW_VERSION',{
  document:doc({workflow:'returned'})
 });
});
test('already pending or approved cannot be resubmitted',()=>{
 for(const workflow of ['pending_review','approved'])
  denied('submit','NOT_EDITING',{document:doc({workflow})});
});
test('no reorganization cannot enter independent review pipeline',()=>{
 denied('submit','NO_REORGANIZATION_TO_REVIEW',{
  document:doc({workflow:'editing',reorganized:false})
 });
});
test('return must carry bounded reason; output stores hash only',()=>{
 for(const reason of ['','a','ab','a'.repeat(121)]){
  denied('return','RETURN_REASON_REQUIRED',{
   requestObj:request('return',{reason})
  });
 }
 const note='FAKE-NEEDS-NEW-ITEM-CHECK';
 const x=allowed('return','RETURN_FOR_NEW_EDITED_REVISION',{
  requestObj:request('return',{reason:note})
 });
 assert.match(x.reasonDigest,/^[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify(x).includes(note));
});
test('accounting cannot return review',()=>{
 denied('return','REVIEWER_ROLE_DENIED',{
  role:'accounting',requestObj:request('return',{reason:'FAKE-REVIEW-REASON'})
 });
});
test('reviewer is independent on both return and approve',()=>{
 denied('return','SEPARATION_OF_DUTIES_REQUIRED',{
  principal:actor('owner',{userId:actors.accounting}),
  requestObj:request('return',{reason:'FAKE-REVIEW-REASON'})
 });
});
test('only original submitting user can withdraw',()=>{
 allowed('withdraw','WITHDRAW_TO_EDITING',{
  principal:actor('accounting')
 });
 denied('withdraw','ONLY_ORIGINAL_SUBMITTER_CAN_WITHDRAW');
});
test('confirmed untouched legacy prints without retrospective approval',()=>{
 const d=doc({mode:'legacy',workflow:'legacy_unchanged',
  unchangedSinceLegacyEnrollment:true});
 allowed('release_to_pdf_gate','PRESERVE_EXISTING_LEGACY_PRINT',{
  document:d
 });
});
test('legacy edited source must not bypass new approval',()=>{
 denied('release_to_pdf_gate','LEGACY_DOC_WAS_MODIFIED',{
  document:doc({mode:'legacy',unchangedSinceLegacyEnrollment:false})
 });
});
test('new original unchanged bill can continue to separate PDF byte checks',()=>{
 allowed('release_to_pdf_gate','NEEDS_SEPARATE_PDF_BYTES_CHECK',{
  document:doc({workflow:'editing',reorganized:false})
 });
});
test('rearranged current bill without independent approval blocks release',()=>{
 denied('release_to_pdf_gate','REVIEW_NOT_APPROVED');
});
test('approved rearrangement with no trusted record still cannot release',()=>{
 denied('release_to_pdf_gate','APPROVAL_NOT_TRUSTED_OR_STALE',{
  document:doc({workflow:'approved'})
 });
});
test('approved with exactly matching hypothetical trusted record eligible for future PDF byte gate',()=>{
 allowed('release_to_pdf_gate','NEEDS_SEPARATE_PDF_BYTES_CHECK',{
  document:doc({workflow:'approved'}),reviewRecord:approval()
 });
});
test('approval certificate cannot be self-created or caller-provided as request field',()=>{
 denied('release_to_pdf_gate','REQUEST_FIELDS_NOT_ALLOWED',{
  document:doc({workflow:'approved'}),
  requestObj:request('release_to_pdf_gate',{reviewRecord:approval()})
 });
});
for(const [name,change] of [
 ['wrong company',{companyId:'FAKE-COMPANY-TWO'}],
 ['wrong document',{documentId:'FAKE-DOC-TWO'}],
 ['old revision',{revision:2}],
 ['changed source hash',{fingerprint:'b'.repeat(64)}],
 ['changed editor',{editorId:'FAKE-USER-OTHER'}],
 ['changed submitter',{submitterId:'FAKE-USER-OTHER'}],
 ['reviewer equals editor',{reviewerId:actors.accounting}],
 ['invalid reviewer role',{reviewerRole:'accounting'}],
 ['unverified fake registry entry',{fakeTrustedRegistryEntry:false}]
]){
 test('stale/forged review cannot unlock PDF: '+name,()=>{
  denied('release_to_pdf_gate','APPROVAL_NOT_TRUSTED_OR_STALE',{
   document:doc({workflow:'approved'}),reviewRecord:approval(change)
  });
 });
}
test('revoked reviewer membership does not silently confer new approvals',()=>{
 denied('approve','FAKE_IDENTITY_AUTH_MFA_FAILED',{
  principal:actor('owner',{membershipActive:false})
 });
});
test('wrong partial document does not silently infer current permission',()=>{
 denied('view_current','NO_FAKE_TRUSTED_DOCUMENT',{document:{id:'REAL-1'}});
});
test('history access requires exact prior version and company ACL',()=>{
 allowed('view_history','READ_ONLY_HISTORICAL_VIEW',{
  requestObj:request('view_history',{revision:2})
 });
 denied('view_history','HISTORY_VERSION_NOT_FOUND',{
  requestObj:request('view_history',{revision:3})
 });
 denied('view_history','DOCUMENT_ACL_DENIED',{
  principal:actor('owner',{allowedDocuments:[]}),
  requestObj:request('view_history',{revision:2})
 });
});
test('historical archived document may be read-only but cannot be approved or edited',()=>{
 allowed('view_history','READ_ONLY_HISTORICAL_VIEW',{
  document:doc({status:'archived'}),requestObj:request('view_history',{revision:1})
 });
 denied('edit','NOT_ACTIVE_CURRENT_DOCUMENT',{document:doc({status:'archived'})});
});
test('read current only returns eligibility metadata not original billing invoice data',()=>{
 const d=doc({workflow:'approved'});
 const x=allowed('view_current','READ_ONLY_CURRENT_DOCUMENT',{document:d});
 for(const marker of ['PRIVATE-INVOICE','sourceSnapshots','bankTransactions','payroll','FAKE-ITEM']){
  assert.ok(!JSON.stringify(x).includes(marker));
 }
});
test('no source code changed to invoke new fake authority or create migrations',()=>{
 const source=fs.readFileSync(path.join(__dirname,'mock_policy_authority.cjs'),'utf8');
 const frontend=fs.readFileSync(path.join(ROOT,'assets/js/billing-groups.js'),'utf8');
 assert.equal(source.includes('window.print('),false);
 assert.equal(source.includes('fetch('),false);
 assert.equal(source.includes('supabase.from('),false);
 assert.equal(frontend.includes('makeDecision('),false);
 assert.equal(fs.existsSync(path.join(ROOT,'supabase/migrations/p40-16bb.sql')),false);
});
