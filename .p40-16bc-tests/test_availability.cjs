/* P40-16BC: reviewer availability / safe-hold, ALL FAKE.
 * No real users, database, ERP bills, financial posting or PDF bytes.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {FakeReviewAvailabilityQueue,sha}=require('./availability_queue.cjs');
const {POLICIES}=require('./mock_policy_authority.cjs');
const ROOT=path.resolve(__dirname,'..');
const E='FAKE-USER-EDITOR',O='FAKE-USER-OWNER',A='FAKE-USER-ADMIN',
 C='FAKE-USER-ACCOUNTANT',S='FAKE-USER-EMPLOYEE',
 X='FAKE-USER-FOREIGN',N='FAKE-USER-NO-ACL',M='FAKE-USER-MFA-OFF',
 D='FAKE-USER-REVOKED';
const ID='FAKE-DOC-ONE',CO='FAKE-COMPANY-ONE',H='a'.repeat(64);
const clone=x=>structuredClone(x);
function person(role,userId,companyId=CO,allowedDocuments=[ID],overrides={}){
 return {role,userId,companyId,allowedDocuments,
  signatureVerified:true,issuerVerified:true,audienceVerified:true,
  expiryVerified:true,sessionValid:true,membershipActive:true,
  aal:'aal2',...overrides};
}
function roster(){return {
 [E]:person('accounting',E),
 [O]:person('owner',O),
 [A]:person('admin',A),
 [C]:person('accounting',C),
 [S]:person('employee',S),
 [X]:person('owner',X,'FAKE-COMPANY-TWO'),
 [N]:person('owner',N,CO,[]),
 [M]:person('owner',M,CO,[ID],{aal:'aal1'}),
 [D]:person('owner',D,CO,[ID],{sessionValid:false})
};}
function doc(extra={}){return {
 id:ID,companyId:CO,revision:3,status:'active',
 mode:'enforced',workflow:'pending_review',fingerprint:H,
 sourceMatchesCurrent:true,reorganized:true,reason:'FAKE-REORGANIZED',
 editorId:E,submitterId:E,historyRevisions:[1,2],
 unchangedSinceLegacyEnrollment:false,...extra
};}
function build({originalDoc=doc(),users=roster(),
policyId='candidate-owner-or-admin-independent'}={}){
 return new FakeReviewAvailabilityQueue({document:originalDoc,roster:users,policyId});
}
function denied(x,reason){
 assert.equal(x?.allowed,false,JSON.stringify(x));
 assert.equal(x.reason,reason,JSON.stringify(x));
}
function approved(q,who=O){
 const nomination=q.nominate(E,who);
 assert.equal(nomination.allowed,true,JSON.stringify(nomination));
 return q.review(who,{revision:3,expectedHash:H});
}
function status(q,actor=E){
 const s=q.status(actor);assert.equal(s.allowed,true,JSON.stringify(s));return s;
}

test('current formal main/beta source role and version/print contracts are unchanged',()=>{
 const auth=fs.readFileSync(path.join(ROOT,'assets/js/auth-gate.js'),'utf8');
 const store=fs.readFileSync(path.join(ROOT,'assets/js/erp-store.js'),'utf8');
 const groups=fs.readFileSync(path.join(ROOT,'assets/js/billing-groups.js'),'utf8');
 assert.match(auth,/const ROLE_PERMISSIONS = Object.freeze/);
 for(const role of ['owner','admin','accounting','employee'])
   assert.ok(auth.includes(role+':Object.freeze({'));
 assert.match(auth,/if \(sessionAal\(current\)!=='aal2'\)/);
 assert.match(store,/saveExternalBillingDocument\(values=\{\}\)/);
 assert.match(store,/values.expectedSnapshot!==ctx.snapshot/);
 assert.match(store,/revision:\(previous\?\.revision\|\|0\)\+1/);
 assert.match(store,/history:previous\?\[/);
 assert.match(groups,/function printSaved\(id,revision=0,historyOnly=false\)/);
 assert.match(groups,/const historical=historyOnly\|\|g.document.status!=='active'/);
 assert.ok(!groups.includes('FakeReviewAvailabilityQueue'));
});
test('two original BB candidate policies remain undecided',()=>{
 assert.deepEqual(Object.keys(POLICIES).sort(),
  ['candidate-owner-or-admin-independent','alternative-owner-only-independent'].sort());
 for(const id of Object.keys(POLICIES)){
  assert.equal(POLICIES[id].independentReviewer,true);
  assert.equal(POLICIES[id].allowSelfReview,false);
 }
});
test('healthy company with separate owner and admin has two eligible candidate reviewers',()=>{
 const q=build(),s=status(q);
 assert.equal(s.status,'REASSIGN_REVIEWER_REQUIRED');
 assert.equal(s.eligibleCount,2);
 assert.deepEqual(s.eligibleReviewerIds,[A,O]);
 assert.equal(s.nominatedReviewerId,null);
});
test('nomination does not create an approval or PDF',()=>{
 const q=build(),r=q.nominate(E,O);
 assert.equal(r.allowed,true);
 assert.equal(r.approvalCreated,false);
 assert.equal(status(q).status,'AWAITING_NOMINATED_REVIEW');
 assert.equal(status(q).nominatedReviewerId,O);
 denied(q.releaseCheck(E),'REVIEW_NOT_APPROVED');
});
test('only actual nominated owner can approve after revalidating exact revision and hash',()=>{
 const q=build();
 q.nominate(E,O);
 denied(q.review(A,{revision:3,expectedHash:H}),'REVIEWER_NOT_NOMINATED');
 denied(q.review(O,{revision:2,expectedHash:H}),'STALE_REVIEW_VERSION_OR_SOURCE');
 denied(q.review(O,{revision:3,expectedHash:'b'.repeat(64)}),
   'STALE_REVIEW_VERSION_OR_SOURCE');
 const r=q.review(O,{revision:3,expectedHash:H});
 assert.equal(r.allowed,true);
 assert.equal(r.financialPostingPerformed,false);
 const x=q.releaseCheck(E);
 assert.equal(x.allowed,true);
 assert.equal(x.next,'NEEDS_SEPARATE_PDF_BYTES_CHECK');
 assert.equal(x.deliveredPdfBytes,false);
});
test('admin may be nominated under candidate A and approve independently',()=>{
 const q=build();
 const r=approved(q,A);
 assert.equal(r.allowed,true);
 assert.equal(q.releaseCheck(C).allowed,true);
});
test('owner-only policy excludes admin while allowing independent owner',()=>{
 const q=build({policyId:'alternative-owner-only-independent'});
 assert.deepEqual(status(q).eligibleReviewerIds,[O]);
 denied(q.nominate(E,A),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
 assert.equal(approved(q,O).allowed,true);
});
test('cross-company owner cannot become assigned reviewer',()=>{
 const q=build();
 denied(q.nominate(E,X),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
 assert.ok(!status(q).eligibleReviewerIds.includes(X));
});
test('employee cannot be nominated as a reviewer',()=>{
 const q=build();
 denied(q.nominate(E,S),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
 denied(q.status(S),'BILLING_ROLE_DENIED');
});
test('accounting editor cannot nominate themselves even with document access',()=>{
 const q=build();
 denied(q.nominate(E,E),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
});
test('candidate owner cannot nominate themselves if they edited and submitted',()=>{
 const r=roster(),d=doc({editorId:O,submitterId:O});
 const q=build({users:r,originalDoc:d});
 assert.deepEqual(status(q).eligibleReviewerIds,[A]);
 denied(q.nominate(O,O),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
 assert.equal(q.nominate(O,A).allowed,true);
 assert.equal(q.review(A,{revision:3,expectedHash:H}).allowed,true);
});
test('same-person owner with no other user stays SAFE HOLD without auto bypass',()=>{
 const users={[O]:person('owner',O)};
 const q=build({originalDoc:doc({editorId:O,submitterId:O}),users});
 const s=status(q,O);
 assert.equal(s.status,'SAFE_HOLD_NO_REVIEWER');
 assert.equal(s.eligibleCount,0);
 assert.equal(s.legacyExistingPrintUnaffected,false);
 denied(q.nominate(O,O),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
 denied(q.releaseCheck(O),'REVIEW_NOT_APPROVED');
});
test('one-person admin editing and submitting cannot self-approve',()=>{
 const users={[A]:person('admin',A)};
 const q=build({originalDoc:doc({editorId:A,submitterId:A}),users});
 assert.equal(status(q,A).status,'SAFE_HOLD_NO_REVIEWER');
 denied(q.nominate(A,A),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
});
test('owner-only alternative still safe-holds when owner was last editor',()=>{
 const users={[O]:person('owner',O),[A]:person('admin',A)};
 const q=build({originalDoc:doc({editorId:O,submitterId:O}),
   users,policyId:'alternative-owner-only-independent'});
 assert.equal(status(q,O).status,'SAFE_HOLD_NO_REVIEWER');
 denied(q.nominate(O,A),'REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
});
test('policy comparison shows realistic reviewer availability without choosing company rules',()=>{
 const q=build();
 const out=q.comparePolicyAlternatives(E);
 assert.equal(out.allowed,true);
 assert.equal(out.ownerDecision,'NOT YET GIVEN');
 assert.equal(out.automaticOverride,false);
 assert.equal(out.alternatives['candidate-owner-or-admin-independent'].eligibleCount,2);
 assert.equal(out.alternatives['alternative-owner-only-independent'].eligibleCount,1);
});
test('policy comparison for owner-as-editor exposes zero reviewers under owner-only',()=>{
 const q=build({originalDoc:doc({editorId:O,submitterId:O})});
 const d=q.comparePolicyAlternatives(O).alternatives;
 assert.equal(d['candidate-owner-or-admin-independent'].eligibleCount,1);
 assert.equal(d['alternative-owner-only-independent'].eligibleCount,0);
 assert.equal(d['alternative-owner-only-independent'].noReviewerSafeHold,true);
});
test('unknown unauthorized policy cannot silently fall back to broad role',()=>{
 assert.throws(()=>build({policyId:'auto-self-approve'}),/POLICY_UNRECOGNIZED/);
});
test('nomination requires the actual verified submitter',()=>{
 const q=build();
 denied(q.nominate(C,O),'SUBMITTER_ONLY_NOMINATION');
 denied(q.nominate(A,O),'SUBMITTER_ONLY_NOMINATION');
 assert.equal(q.nominate(E,O).allowed,true);
});
test('someone in different company cannot even query reviewer availability',()=>{
 const q=build();
 denied(q.status(X),'CROSS_COMPANY_DENIED');
 denied(q.comparePolicyAlternatives(X),'CROSS_COMPANY_DENIED');
 denied(q.nominate(X,O),'CROSS_COMPANY_DENIED');
});
test('no-document ACL blocks queue read and nomination',()=>{
 const q=build();
 denied(q.status(N),'DOCUMENT_ACL_DENIED');
 denied(q.nominate(N,O),'DOCUMENT_ACL_DENIED');
});
test('fake AAL1 or inactive sessions cannot use review queue',()=>{
 const q=build();
 for(const id of [M,D]){
  denied(q.status(id),'FAKE_IDENTITY_AUTH_MFA_FAILED');
  denied(q.nominate(id,O),'FAKE_IDENTITY_AUTH_MFA_FAILED');
 }
});
test('unrecognized actor cannot forge reviewer from client data',()=>{
 const q=build();
 denied(q.status('FAKE-USER-IMPERSONATION'),'FAKE_IDENTITY_AUTH_MFA_FAILED');
 denied(q.nominate('FAKE-USER-IMPERSONATION',O),'FAKE_IDENTITY_AUTH_MFA_FAILED');
});
test('reviewer session revoked after nomination: approval denied, queue requires reassign',()=>{
 const users=roster(),q=build({users});
 q.nominate(E,O);
 users[O].sessionValid=false;
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.review(O,{revision:3,expectedHash:H}),'FAKE_IDENTITY_AUTH_MFA_FAILED');
 assert.equal(status(q).status,'REASSIGN_REVIEWER_REQUIRED');
 assert.equal(status(q).nominatedReviewerId,null);
 assert.equal(q.nominate(E,A).allowed,true);
 assert.equal(q.review(A,{revision:3,expectedHash:H}).allowed,true);
});
test('reviewer moved to employee role after nomination cannot approve',()=>{
 const users=roster(),q=build({users});
 q.nominate(E,O);
 users[O].role='employee';
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.review(O,{revision:3,expectedHash:H}),'BILLING_ROLE_DENIED');
 assert.deepEqual(status(q).eligibleReviewerIds,[A]);
});
test('reviewer moved to accounting after nomination cannot approve',()=>{
 const users=roster(),q=build({users});
 q.nominate(E,O);
 users[O].role='accounting';
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.review(O,{revision:3,expectedHash:H}),'REVIEWER_ROLE_DENIED');
 assert.deepEqual(status(q).eligibleReviewerIds,[A]);
});
test('reviewer loses document grant between nomination and approval',()=>{
 const users=roster(),q=build({users});
 q.nominate(E,O);
 users[O].allowedDocuments=[];
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.review(O,{revision:3,expectedHash:H}),'DOCUMENT_ACL_DENIED');
 assert.deepEqual(status(q).eligibleReviewerIds,[A]);
});
test('reviewer changes company between nomination and approval',()=>{
 const users=roster(),q=build({users});
 q.nominate(E,O);
 users[O].companyId='FAKE-COMPANY-OTHER';
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.review(O,{revision:3,expectedHash:H}),'CROSS_COMPANY_DENIED');
});
test('reassigning queue nominee cannot mean auto approval',()=>{
 const q=build();
 assert.equal(q.nominate(E,O).allowed,true);
 assert.equal(q.nominate(E,A).allowed,true);
 denied(q.review(O,{revision:3,expectedHash:H}),'REVIEWER_NOT_NOMINATED');
 denied(q.releaseCheck(E),'REVIEW_NOT_APPROVED');
 assert.equal(q.review(A,{revision:3,expectedHash:H}).allowed,true);
});
test('two nominees cannot independently double-approve one revision',()=>{
 const q=build();
 approved(q,O);
 denied(q.review(O,{revision:3,expectedHash:H}),'REVIEWER_NOT_NOMINATED');
 denied(q.review(A,{revision:3,expectedHash:H}),'REVIEWER_NOT_NOMINATED');
 assert.equal(q.releaseCheck(E).next,'NEEDS_SEPARATE_PDF_BYTES_CHECK');
});
test('trusted source version increment invalidates reviewer nomination and old approval',()=>{
 const q=build();q.nominate(E,O);
 q.testOnlyTrustedNewRevision({revision:4,sourceHash:'b'.repeat(64),
  editorId:E,submitterId:E});
 assert.equal(status(q).revision,4);
 assert.equal(status(q).nominatedReviewerId,null);
 denied(q.review(O,{revision:3,expectedHash:H}),'REVIEWER_NOT_NOMINATED');
 denied(q.releaseCheck(E),'REVIEW_NOT_APPROVED');
 assert.equal(q.nominate(E,O).allowed,true);
 assert.equal(q.review(O,{revision:4,expectedHash:'b'.repeat(64)}).allowed,true);
});
test('changed source hash but same version cannot be presented as a legitimate new revision',()=>{
 const q=build();approved(q,O);
 assert.throws(()=>q.testOnlyTrustedNewRevision({revision:3,
  sourceHash:'b'.repeat(64),editorId:E,submitterId:E}),/CAS_REQUIRED/);
});
test('fake version increment with unchanged source digest is not accepted',()=>{
 const q=build();approved(q,O);
 assert.throws(()=>q.testOnlyTrustedNewRevision({revision:4,
  sourceHash:H,editorId:E,submitterId:E}),/CAS_REQUIRED/);
});
test('wrong fake trusted input cannot change approved source',()=>{
 const q=build();approved(q,O);
 const before=status(q);
 for(const params of [
  {revision:4,sourceHash:'invalid',editorId:E,submitterId:E},
  {revision:4,sourceHash:'b'.repeat(64),editorId:'REAL-USER',submitterId:E},
  {revision:4,sourceHash:'b'.repeat(64),editorId:E,submitterId:'REAL-USER'}
 ]){
  assert.throws(()=>q.testOnlyTrustedNewRevision(params),/CAS_REQUIRED/);
  assert.equal(status(q).revision,before.revision);
 }
});
test('single owner legacy confirmed document stays printable without new reviewer',()=>{
 const users={[O]:person('owner',O)};
 const q=build({users,originalDoc:doc({mode:'legacy',workflow:'legacy_unchanged',
  editorId:O,submitterId:O,unchangedSinceLegacyEnrollment:true})});
 const s=status(q,O);
 assert.equal(s.status,'NOT_IN_REVIEW');
 assert.equal(s.legacyExistingPrintUnaffected,true);
 assert.equal(q.releaseCheck(O).next,'PRESERVE_EXISTING_LEGACY_PRINT');
 denied(q.nominate(O,O),'NO_PENDING_NEW_REVIEW');
});
test('if a sole owner edits that legacy doc, new revision safely holds, original print untouched',()=>{
 const users={[O]:person('owner',O)};
 const q=build({users,originalDoc:doc({mode:'legacy',workflow:'legacy_unchanged',
  editorId:O,submitterId:O,unchangedSinceLegacyEnrollment:true})});
 assert.equal(q.releaseCheck(O).allowed,true);
 q.testOnlyTrustedNewRevision({revision:4,sourceHash:'b'.repeat(64),
  editorId:O,submitterId:O});
 assert.equal(status(q,O).status,'SAFE_HOLD_NO_REVIEWER');
 denied(q.releaseCheck(O),'REVIEW_NOT_APPROVED');
});
test('unauthorized principal cannot get legacy current print just because no review required',()=>{
 const q=build({originalDoc:doc({mode:'legacy',workflow:'legacy_unchanged',
  unchangedSinceLegacyEnrollment:true})});
 denied(q.releaseCheck(X),'CROSS_COMPANY_DENIED');
 denied(q.releaseCheck(S),'BILLING_ROLE_DENIED');
});
test('normal approved revision with valid reviewer is only eligible for separate PDF gate',()=>{
 const q=build();approved(q,O);
 const r=q.releaseCheck(C);
 assert.equal(r.allowed,true);
 assert.equal(r.deliveredPdfBytes,false);
 assert.equal(r.releaseVerified,false);
 assert.equal(r.next,'NEEDS_SEPARATE_PDF_BYTES_CHECK');
});
test('pending review can never release PDF gate in either candidate policy',()=>{
 for(const policyId of Object.keys(POLICIES)){
  const q=build({policyId});
  denied(q.releaseCheck(E),'REVIEW_NOT_APPROVED');
 }
});
test('conservative policy: reviewer revoked after approval before delivery => safe hold',()=>{
 const users=roster(),q=build({users});
 approved(q,O);
 users[O].sessionValid=false;
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.releaseCheck(E),'SIGNER_REVOKED_OR_INELIGIBLE_POLICY_DECISION_REQUIRED');
});
test('conservative policy: reviewer role changed after approval => safe hold',()=>{
 const users=roster(),q=build({users});
 approved(q,O);
 users[O].role='accounting';
 q.testOnlyReplaceVerifiedRoster(users);
 denied(q.releaseCheck(E),'SIGNER_ROLE_CHANGED_POLICY_DECISION_REQUIRED');
});
test('independent reviewer remains eligible even after unrelated employee roster changes',()=>{
 const users=roster(),q=build({users});approved(q,O);
 users[S].membershipActive=false;
 q.testOnlyReplaceVerifiedRoster(users);
 assert.equal(q.releaseCheck(E).allowed,true);
});
test('audit reports only FAKE IDs, hashes, never original invoices or amount sources',()=>{
 const q=build();
 q.nominate(E,O);q.nominate(E,A);
 assert.equal(q.review(A,{revision:3,expectedHash:H}).allowed,true);
 const events=q.audit(E);
 assert.deepEqual(events.map(x=>x.type),['NOMINATED','NOMINATED','REVIEWED']);
 for(const line of events){
  assert.match(line.sourceHash,/^[0-9a-f]{64}$/);
  const s=JSON.stringify(line);
  for(const token of ['sourceSnapshots','PRIVATE-INVOICE',
   'bankTransactions','salary','payroll','FAKE-L-ZONE','FAKE-CUSTOMER'])
   assert.ok(!s.includes(token),token);
 }
});
test('unprivileged party cannot retrieve audit metadata',()=>{
 const q=build();
 q.nominate(E,O);
 denied(q.audit(S),'BILLING_ROLE_DENIED');
 denied(q.audit(X),'CROSS_COMPANY_DENIED');
});
test('status claims cannot certify live JWT, actual financial posting or exact PDF bytes',()=>{
 const q=build(),s=status(q);
 assert.equal(s.liveAuthVerified,false);
 assert.equal(s.financialPostingPerformed,false);
 assert.equal(s.separatePdfBytesGateCompleted,false);
 assert.equal('pdf' in s,false);
});
test('mock sources are not imported into the formal ERP or official PDF files',()=>{
 const model=fs.readFileSync(path.join(__dirname,'availability_queue.cjs'),'utf8');
 assert.ok(!model.includes('supabase.from('));
 assert.ok(!model.includes('window.print('));
 assert.ok(!model.includes('service_role_key'));
 assert.ok(!fs.existsSync(path.join(ROOT,'supabase/migrations/p40-16bc.sql')));
 const g=fs.readFileSync(path.join(ROOT,'assets/js/billing-groups.js'),'utf8');
 assert.ok(!g.includes('FakeReviewAvailabilityQueue'));
});
