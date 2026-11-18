/* P40-16AZ: CONTRACT / TEST-ONLY with synthetic identities and bills.
 * Fake preflight is NOT PDF bytes, real trusted JWT, RLS or production routing.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./fixture.cjs');
const {FakeTrustedIdentitySource,FakeAuthorizedDocumentSource,
  verifyDocument,changedOriginalRows,hash}=require('./mock_integration_boundary.cjs');
const root=path.resolve(__dirname,'..');
const EDITOR='FAKE-HANDLE-EDITOR',REVIEW='FAKE-HANDLE-REVIEW',
      ADMIN='FAKE-HANDLE-ADMIN',ACCOUNT='FAKE-HANDLE-ACCOUNT',
      EMPLOYEE='FAKE-HANDLE-EMPLOYEE',OTHER='FAKE-HANDLE-OTHER',
      NO_ACL='FAKE-HANDLE-NO-ACL',MFA_OFF='FAKE-HANDLE-MFA-OFF',
      REVOKED='FAKE-HANDLE-REVOKED',EDITOR_AS_OWNER='FAKE-HANDLE-EDITOR-OWNER';
const COMPANY='FAKE-CO-01',ID='FAKE-GROUP-001';
const identity=(role,userId,companyId=COMPANY,allowedDocuments=[ID],extra={})=>({
  role,userId,companyId,allowedDocuments,verified:true,aal:'aal2',
  active:true,memberActive:true,...extra
});
const handles=()=>({
 [EDITOR]:identity('accounting','FAKE-USER-EDITOR'),
 [REVIEW]:identity('owner','FAKE-USER-REVIEWER'),
 [ADMIN]:identity('admin','FAKE-USER-ADMIN'),
 [ACCOUNT]:identity('accounting','FAKE-USER-ACCOUNT'),
 [EMPLOYEE]:identity('employee','FAKE-USER-EMPLOYEE'),
 [OTHER]:identity('owner','FAKE-USER-OTHER','FAKE-CO-OTHER'),
 [NO_ACL]:identity('owner','FAKE-USER-NO-ACL',COMPANY,[]),
 [MFA_OFF]:identity('owner','FAKE-USER-MFA-OFF',COMPANY,[ID],{aal:'aal1'}),
 [REVOKED]:identity('owner','FAKE-USER-REVOKED',COMPANY,[ID],{active:false}),
 [EDITOR_AS_OWNER]:identity('owner','FAKE-USER-EDITOR')
});
function bill({reorganized=true,revision=1,opts={}}={}){
 const d=fixture(opts).document;
 d.id=ID;d.revision=revision;
 if(reorganized){
   d.unified.lines[0].item='FAKE-CHANGED-WORK-ITEM';
   d.unified.reason='FAKE-REARRANGEMENT-EXPLANATION-NOT-APPROVAL';
 }
 return d;
}
function lab({legacy=false,reorganized=true,revision=1,actors=handles()}={}){
 const identity=new FakeTrustedIdentitySource(actors);
 const store=new FakeAuthorizedDocumentSource(identity);
 const doc=bill({reorganized,revision});
 store.seedFromFakeTrustedSource(doc,COMPANY,EDITOR,legacy);
 return {store,identity,doc};
}
function deny(fn,phrase){assert.throws(fn,e=>e instanceof Error&&e.message.includes(phrase),phrase);}
function meta(store,actor=ACCOUNT){return store.currentMeta(actor,ID);}
function approve(store,who=REVIEW){
 const m=meta(store);
 return store.approveNewRevision(who,{documentId:ID,
   revision:m.revision,sourceHash:m.sourceHash});
}
function begin(store,who=ACCOUNT,revision=meta(store).revision,printMode='current'){
 return store.beginPreflight(who,{documentId:ID,revision,printMode});
}
function finish(store,ticket,who=ACCOUNT){
 return store.finalizePreflight(who,{ticket});
}
function modify(store,edit,...callback){
 const m=meta(store);
 return store.submitNewRevision(edit,{documentId:ID,expectedRevision:m.revision},
   d=>{for(const cb of callback)cb(d)});
}
test('official original source fingerprint retains original amounts, retention and rows',()=>{
 const d=bill();
 assert.doesNotThrow(()=>verifyDocument(d));
 assert.equal(changedOriginalRows(d),true);
 assert.equal(d.totals.grossTotal-d.totals.retention,d.totals.receivable);
 assert.equal(d.sourceSnapshots.length,2);
 assert.equal(d.sourceSnapshots[0].projectName,'FAKE-L-ZONE');
 assert.equal(d.displayProjectName,'FAKE-M-ZONE');
});
test('actual formal main saved-bill contract has conflict guard/revision/history intact',()=>{
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'assets/js/billing-groups.js'),'utf8');
 const auth=fs.readFileSync(path.join(root,'assets/js/auth-gate.js'),'utf8');
 assert.match(store,/saveExternalBillingDocument\(values=\{\}\)/);
 assert.match(store,/values.expectedSnapshot!==ctx.snapshot/);
 assert.match(store,/revision:\(previous\?\.revision\|\|0\)\+1/);
 assert.match(store,/history:previous\?\[/);
 assert.match(ui,/function printSaved\(id,revision=0,historyOnly=false\)/);
 assert.match(ui,/const historical=historyOnly\|\|g.document.status!=='active'/);
 assert.match(ui,/d.status==='draft'/);
 assert.match(ui,/g.issues.length\|\|g.termsChanged\|\|g.settlementChanged/);
 assert.match(auth,/function canView\(module\)/);
 assert.match(auth,/function canWrite\(module\)/);
 assert.match(auth,/if \(sessionAal\(current\)!=='aal2'\)/);
 assert.ok(!ui.includes('FakeAuthorizedDocumentSource'));
});
test('former valid legacy version 7 remains on existing compatible print route',()=>{
 const {store}=lab({legacy:true,revision:7});
 const p=begin(store,ACCOUNT,7);
 assert.equal(p.route,'PRESERVE_CONFIRMED_LEGACY_PRINT');
 assert.equal(finish(store,p.ticket).route,p.route);
 assert.equal(meta(store).mode,'legacy');
});
test('previously confirmed legacy stays printable despite a reorganization reason',()=>{
 const {store}=lab({legacy:true});
 assert.equal(begin(store).requiresIndependentReview,false);
 assert.equal(meta(store).hasReorganizedLines,true);
});
test('normal new document without revised construction is eligible for verified PDF pilot preflight',()=>{
 const {store}=lab({reorganized:false});
 const p=begin(store);
 assert.equal(p.route,'CANDIDATE_VERIFIED_PDF_ONLY');
 assert.equal(p.requiresIndependentReview,false);
 assert.equal(finish(store,p.ticket).safeToProceedWithFurtherPdfByteVerification,true);
});
test('new document with revised construction needs separate approval',()=>{
 const {store}=lab();
 deny(()=>begin(store),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
 const r=approve(store);
 assert.equal(r.revision,1);
 const ticket=begin(store);
 assert.equal(ticket.requiresIndependentReview,true);
 assert.equal(finish(store,ticket.ticket).route,'CANDIDATE_VERIFIED_PDF_ONLY');
});
test('a free-text explanation does not count as approved',()=>{
 const {store,doc}=lab();
 assert.ok(doc.unified.reason.trim());
 deny(()=>begin(store),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
});
test('client cannot submit approval flag/company/source Snapshot/role into print preflight',()=>{
 for(const field of ['approved','companyId','role','publicView','sourceSnapshots',
    'jwtClaims','signature','approvedBy','isLegacy','expectedSourceHash']){
   const {store}=lab({legacy:true});
   const req={documentId:ID,revision:1,printMode:'current',[field]:'FORGED'};
   deny(()=>store.beginPreflight(ACCOUNT,req),'UNTRUSTED_CLIENT_EXTRA_OR_MISSING_FIELDS');
 }
});
test('client cannot forge approval actor or original source in submit/review',()=>{
 const {store}=lab();
 for(const extra of [
   {companyId:'FAKE-CO-OTHER'},{reviewer:'FAKE-USER-REVIEWER'},
   {sourceSnapshots:[]},{fakeVerified:true},{mode:'legacy'}
 ]){
   const m=meta(store);
   deny(()=>store.approveNewRevision(REVIEW,{documentId:ID,
     revision:1,sourceHash:m.sourceHash,...extra}),
     'UNTRUSTED_CLIENT_EXTRA_OR_MISSING_FIELDS');
 }
});
test('independent owner or admin can approve, accounting cannot',()=>{
 const {store}=lab();
 deny(()=>approve(store,EDITOR),'ROLE_NOT_ALLOWED');
 deny(()=>approve(store,ACCOUNT),'ROLE_NOT_ALLOWED');
 deny(()=>approve(store,EMPLOYEE),'ROLE_NOT_ALLOWED');
 assert.equal(approve(store,ADMIN).revision,1);
});
test('same editor as owner cannot approve own work',()=>{
 const actors=handles();
 actors[EDITOR].role='owner';
 const {store}=lab({actors});
 deny(()=>approve(store,EDITOR),'EDITOR_CANNOT_SELF_APPROVE');
 deny(()=>approve(store,EDITOR_AS_OWNER),'EDITOR_CANNOT_SELF_APPROVE');
 assert.equal(approve(store,REVIEW).revision,1);
});
test('cross-company, inactive, fake MFA, employee and unknown fake session never approve',()=>{
 const {store}=lab();
 const cases=[
   [OTHER,'COMPANY_BOUNDARY_DENIED'],
   [MFA_OFF,'FAKE_SESSION_MFA_OR_MEMBERSHIP_DENIED'],
   [REVOKED,'FAKE_SESSION_MFA_OR_MEMBERSHIP_DENIED'],
   [NO_ACL,'DOCUMENT_ACL_DENIED'],
   [EMPLOYEE,'ROLE_NOT_ALLOWED'],
   ['FAKE-HANDLE-BOGUS','FAKE_SESSION_MFA_OR_MEMBERSHIP_DENIED'],
   ['eyJ.fake.jwt','UNTRUSTED_FAKE_SESSION']
 ];
 for(const [who,reason] of cases)deny(()=>approve(store,who),reason);
});
test('fake two roles read billing and employee explicitly blocked on preflight',()=>{
 const {store}=lab({legacy:true});
 for(const who of [REVIEW,ADMIN,ACCOUNT,EDITOR])
   assert.equal(begin(store,who).route,'PRESERVE_CONFIRMED_LEGACY_PRINT');
 deny(()=>begin(store,EMPLOYEE),'ROLE_NOT_ALLOWED');
});
test('cross-company and missing doc access denied before print',()=>{
 const {store}=lab({legacy:true});
 deny(()=>store.beginPreflight(OTHER,{documentId:ID,revision:1,printMode:'current'}),
   'COMPANY_BOUNDARY_DENIED');
 deny(()=>store.beginPreflight(NO_ACL,{documentId:ID,revision:1,printMode:'current'}),
   'DOCUMENT_ACL_DENIED');
});
test('invalid print mode and unknown document cannot fall through to default public route',()=>{
 const {store}=lab({legacy:true});
 deny(()=>store.beginPreflight(ACCOUNT,{documentId:ID,revision:1,printMode:'other'}),
   'INVALID_PRINT_MODE');
 deny(()=>store.beginPreflight(ACCOUNT,{documentId:'FAKE-UNKNOWN',revision:1,printMode:'current'}),
   'UNKNOWN_FAKE_DOCUMENT');
});
test('old approved version cannot authorize a newer changed revision',()=>{
 const {store}=lab();
 approve(store);
 modify(store,EDITOR,d=>{d.note='CHANGED-PUBLIC-NOTE'});
 assert.equal(meta(store).revision,2);
 deny(()=>begin(store),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
 approve(store);
 assert.equal(begin(store).revision,2);
});
test('changing a previously legacy approved bill switches NEW version to enforced',()=>{
 const {store}=lab({legacy:true});
 const old=begin(store);
 assert.equal(old.route,'PRESERVE_CONFIRMED_LEGACY_PRINT');
 modify(store,EDITOR,d=>{d.note='FAKE-NEW-PUBLIC-NOTE'});
 assert.equal(meta(store).mode,'enforced');
 deny(()=>begin(store),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
 approve(store);
 assert.equal(begin(store).route,'CANDIDATE_VERIFIED_PDF_ONLY');
});
test('the archived previous version is routed to preserved historical print',()=>{
 const {store}=lab({legacy:true});
 modify(store,EDITOR,d=>{d.note='NEW-VERSION'});
 const p=begin(store,ACCOUNT,1,'history');
 assert.equal(p.route,'PRESERVE_EXISTING_HISTORY_PRINT');
 assert.equal(p.mode,'historical');
 assert.equal(finish(store,p.ticket).route,p.route);
});
test('history request cannot route to current document version',()=>{
 const {store}=lab({legacy:true});
 deny(()=>begin(store,ACCOUNT,1,'history'),'REQUESTED_HISTORY_REVISION_MISSING');
});
test('current request cannot print an older document version by falling back to old approved view',()=>{
 const {store}=lab({legacy:true});
 modify(store,EDITOR,d=>{d.note='CHANGED'});
 deny(()=>begin(store,ACCOUNT,1,'current'),'CURRENT_VERSION_NOT_AVAILABLE');
});
test('current source cannot be changed without preserving official financial integrity',()=>{
 const {store}=lab();
 const old=meta(store);
 deny(()=>modify(store,EDITOR,d=>{d.totals.grossTotal+=1}),'');
 assert.deepEqual(meta(store),old);
});
test('client cannot submit missing expectedRevision/extra role for modifying',()=>{
 const {store}=lab();
 for(const req of [{documentId:ID},{documentId:ID,expectedRevision:1,
    companyId:COMPANY},{documentId:ID,expectedRevision:1,sourceSnapshots:[]}])
   deny(()=>store.submitNewRevision(EDITOR,req,d=>{d.note='NEW'}),'UNTRUSTED_CLIENT_EXTRA_OR_MISSING_FIELDS');
});
test('stale version conflict keeps previous document stable',()=>{
 const {store}=lab();
 const first=meta(store);
 modify(store,EDITOR,d=>{d.note='FAKE-CHANGE-ONE'});
 deny(()=>store.submitNewRevision(EDITOR,{documentId:ID,
   expectedRevision:1},d=>{d.note='FAKE-CHANGE-TWO'}),'STALE_EXPECTED_REVISION');
 assert.equal(meta(store).revision,first.revision+1);
});
const modifications=[
 ['outward house',d=>{d.unified.lines[0].house='FAKE-NEW-HOUSE'}],
 ['outward item',d=>{d.unified.lines[0].item='FAKE-RENAMED-ITEM'}],
 ['unit',d=>{d.unified.lines[0].unit='組'}],
 ['quantity/price same amount',d=>{d.unified.lines[0].qty=2;d.unified.lines[0].price=50;}],
 ['source original house',d=>{d.sourceSnapshots[0].originalLines[0].house='FAKE-OTHER-HOUSE';}],
 ['source invoice id',d=>{d.sourceSnapshots[0].invoiceNo='PRIVATE-INVOICE-CORRECTED';}],
 ['tax mode via source original',d=>{d.sourceSnapshots[0].taxMode='含稅'}],
 ['note',d=>{d.note='FAKE-NEW-NOTE'}],
 ['date',d=>{d.documentDate='2026-11-19'}],
 ['settled amounts',d=>{
    const s=d.settlementSnapshots[0];
    s.received+=10;s.outstanding-=10;s.availableToCollect-=10;
    d.totals.received+=10;d.totals.outstanding-=10;d.totals.availableToCollect-=10;
 }],
 ['reorganization explanation',d=>{d.unified.reason='NEW-EXPLANATION'}]
];
for(const [title,mutate] of modifications){
 test('edit invalidates prior approval and requires new version review: '+title,()=>{
   const {store}=lab();
   approve(store);
   const first=meta(store);
   // Official validation can permit a source tax-mode label update if
   // all approved numeric anchors remain internally consistent. Do NOT
   // mistake that for approval: it must save a NEW revision and invalidate
   // the prior review just like any other source term change.
   const updated=modify(store,EDITOR,mutate);
   assert.equal(updated.revision,first.revision+1);
   assert.notEqual(updated.sourceHash,first.sourceHash);
   deny(()=>begin(store),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
   approve(store);
   assert.equal(begin(store).revision,2);
 });
}
test('preflight and finalize are not an actual PDF or browser print function',()=>{
 const {store}=lab({legacy:true});
 const p=begin(store);
 const final=finish(store,p.ticket);
 assert.equal(final.safeToProceedWithFurtherPdfByteVerification,true);
 assert.ok(final.warning.includes('NO_PDF_BYTES'));
 assert.ok(!('pdf' in final));
 assert.ok(!('publicView' in final));
});
test('preflight ticket is single-use',()=>{
 const {store}=lab({legacy:true});
 const p=begin(store);
 finish(store,p.ticket);
 deny(()=>finish(store,p.ticket),'PRECHECK_UNKNOWN_OR_USED');
});
test('preflight ticket cannot be redeemed by another fake user',()=>{
 const {store}=lab({legacy:true});
 const p=begin(store);
 deny(()=>finish(store,p.ticket,ADMIN),'PRECHECK_OTHER_USER_DENIED');
 assert.equal(finish(store,p.ticket).sourceHash,p.sourceHash);
});
test('user revocation between preflight and finalize denies',()=>{
 const {store,identity}=lab({legacy:true});
 const p=begin(store);
 identity.revoke(ACCOUNT);
 deny(()=>finish(store,p.ticket),'FAKE_SESSION_MFA_OR_MEMBERSHIP_DENIED');
});
test('fake role demotion between preflight and finalize denies',()=>{
 const {store,identity}=lab({legacy:true});
 const p=begin(store);
 identity.changeRole(ACCOUNT,'employee');
 deny(()=>finish(store,p.ticket),'ROLE_NOT_ALLOWED');
});
test('document revision change after preflight denies finalize even if old approval existed',()=>{
 const {store}=lab({legacy:true});
 const p=begin(store);
 modify(store,EDITOR,d=>{d.note='FAKE-NEW-VERSION'});
 deny(()=>finish(store,p.ticket),'CURRENT_VERSION_NOT_AVAILABLE');
});
test('history preflight remains tied to exact version after a newer revision',()=>{
 const {store}=lab({legacy:true});
 modify(store,EDITOR,d=>{d.note='FAKE-CURRENT-V2'});
 const historic=begin(store,ACCOUNT,1,'history');
 // Even if V3 is saved, the historic immutable snapshot should still be the
 // same; note this prototype models only a permission preflight.
 modify(store,EDITOR,d=>{d.note='FAKE-CURRENT-V3'});
 assert.equal(finish(store,historic.ticket).sourceHash,historic.sourceHash);
});
test('new reviewer-approved source becomes ineligible if edited between the two checks',()=>{
 const {store}=lab();
 approve(store);
 const p=begin(store);
 modify(store,EDITOR,d=>{d.note='FAKE-SOURCE-UPDATED'});
 deny(()=>finish(store,p.ticket),'CURRENT_VERSION_NOT_AVAILABLE');
});
test('read-only audit does not copy source invoice numbers, salary or client public views',()=>{
 const {store}=lab();
 approve(store);
 modify(store,EDITOR,d=>{d.note='FAKE-V2'});
 const log=store.auditMetadata();
 const txt=JSON.stringify(log);
 for(const secret of ['sourceSnapshots','settlementSnapshots',
  'PRIVATE-INVOICE','FAKE-L-ZONE','bankTransactions','payroll','FAKE-CUSTOMER'])
   assert.ok(!txt.includes(secret),secret);
 assert.deepEqual(log.map(e=>e.action),['SEED','REVIEW_APPROVED','VERSION_SAVED']);
});
test('only exact formal main source and no Supabase migration or JS app integration',()=>{
 const s=fs.readFileSync(path.join(__dirname,'mock_integration_boundary.cjs'),'utf8');
 assert.ok(s.includes("assets/js/external-billing-print.js"));
 assert.ok(!s.includes("supabase.from("));
 assert.ok(!s.includes("window.print("));
 assert.ok(!fs.existsSync(path.join(root,'supabase/migrations/p40-16az.sql')));
 const ui=fs.readFileSync(path.join(root,'assets/js/billing-groups.js'),'utf8');
 assert.ok(!ui.includes('FakeAuthorizedDocumentSource'));
});
