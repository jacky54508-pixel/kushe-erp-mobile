/* P40-16BA FAKE-only review workflow tests, grounded in unchanged main.
 * All documents, company and member IDs are synthetically constructed.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./fixture.cjs');
const {FakeReviewWorkflow,hash,verify,hasReorganization}=require('./approval_flow.cjs');
const DOC='FAKE-GROUP-BA',CO='FAKE-CO-01';
const E='FAKE-HANDLE-EDITOR',R='FAKE-HANDLE-REVIEWER',
 A='FAKE-HANDLE-ADMIN',O='FAKE-HANDLE-OWNER',
 U='FAKE-HANDLE-EMPLOYEE',X='FAKE-HANDLE-OTHER-COMPANY',
 N='FAKE-HANDLE-NO-ACL',M='FAKE-HANDLE-NO-MFA',
 D='FAKE-HANDLE-DISABLED',S='FAKE-HANDLE-EDITOR-OWNER';
function actor(role,userId,companyId=CO,allowedDocuments=[DOC],rest={}){
 return {role,userId,companyId,allowedDocuments,aal:'aal2',
   fakeVerified:true,active:true,memberActive:true,...rest};
}
function members(){
 return {
  [E]:actor('accounting','FAKE-USER-EDITOR'),
  [R]:actor('owner','FAKE-USER-REVIEWER'),
  [A]:actor('admin','FAKE-USER-ADMIN'),
  [O]:actor('owner','FAKE-USER-OWNER'),
  [U]:actor('employee','FAKE-USER-EMPLOYEE'),
  [X]:actor('owner','FAKE-USER-X','FAKE-CO-OTHER'),
  [N]:actor('owner','FAKE-USER-NO-ACL',CO,[]),
  [M]:actor('owner','FAKE-USER-NO-MFA',CO,[DOC],{aal:'aal1'}),
  [D]:actor('owner','FAKE-USER-DISABLED',CO,[DOC],{active:false}),
  [S]:actor('owner','FAKE-USER-EDITOR')
 };
}
function doc({reorg=true,rev=1}={}){
 const x=fixture().document;
 x.id=DOC;x.revision=rev;
 if(reorg){
  x.unified.lines[0].item='FAKE-RECOMPOSED-WORK-ITEM';
  x.unified.reason='FAKE-REVIEW-NOTE-NOT-AN-APPROVAL';
 }
 return x;
}
function setup({legacy=false,reorg=true,rev=1,who=members()}={}){
 const d=doc({reorg,rev});
 const flow=new FakeReviewWorkflow(d,CO,who,{legacy,editorHandle:E});
 return {flow,d};
}
function meta(f,actor=E){return f.getSummary(actor)}
function submit(f,user=E){
 const m=meta(f);return f.submit(user,m.revision,m.sourceHash);
}
function approve(f,user=R){
 const m=meta(f);return f.approve(user,m.revision,m.sourceHash);
}
function edit(f,fn,user=E){
 return f.edit(user,meta(f).revision,fn);
}
function denied(fn,substring){
 assert.throws(fn,error=>error instanceof Error &&
   error.message.includes(substring),'Expected '+substring);
}
test('actual formal billing source and stored version/history invariants are not replaced',()=>{
 const root=path.resolve(__dirname,'..');
 const orig=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'assets/js/billing-groups.js'),'utf8');
 const auth=fs.readFileSync(path.join(root,'assets/js/auth-gate.js'),'utf8');
 assert.match(orig,/saveExternalBillingDocument\(values=\{\}\)/);
 assert.match(orig,/values.expectedSnapshot!==ctx.snapshot/);
 assert.match(orig,/revision:\(previous\?\.revision\|\|0\)\+1/);
 assert.match(orig,/history:previous\?\[/);
 assert.match(ui,/function printSaved\(id,revision=0,historyOnly=false\)/);
 assert.match(ui,/const historical=historyOnly\|\|g.document.status!=='active'/);
 assert.match(auth,/function canView\(module\)/);
 assert.match(auth,/function canWrite\(module\)/);
 assert.equal(ui.includes('FakeReviewWorkflow'),false);
});
test('valid real-source fake source has correct amount and two original areas',()=>{
 const d=doc();
 assert.equal(verify(d),d);
 assert.equal(d.sourceSnapshots.length,2);
 assert.equal(d.displayProjectName,'FAKE-M-ZONE');
 assert.equal(d.totals.grossTotal-d.totals.retention,d.totals.receivable);
 assert.equal(hasReorganization(d),true);
});
test('SHA-256 source fingerprint stable under object key order, sensitive to row changes',()=>{
 assert.equal(hash({b:2,a:{y:2,x:1}}),hash({a:{x:1,y:2},b:2}));
 assert.notEqual(hash({a:[1,2]}),hash({a:[2,1]}));
});
test('legacy confirmed document is not retrospectively blocked',()=>{
 const {flow}=setup({legacy:true});
 assert.equal(meta(flow).status,'legacy_unchanged');
 assert.equal(flow.printDecision(E,1).route,'EXISTING_LEGACY_PRINT');
 assert.equal(meta(flow).historyCount,0);
});
test('legacy confirmed document at revision seven stays printable',()=>{
 const {flow}=setup({legacy:true,rev:7});
 assert.equal(flow.printDecision(R,7).route,'EXISTING_LEGACY_PRINT');
});
test('legacy document editing saves a NEW version, old version moves to read-only history',()=>{
 const {flow}=setup({legacy:true});
 const next=edit(flow,d=>{d.note='FAKE-CORRECTED-PUBLIC-NOTE';});
 assert.equal(next.revision,2);
 assert.equal(next.mode,'enforced');
 assert.equal(next.status,'editing');
 denied(()=>flow.printDecision(E,2),'CURRENT_REORGANIZED_REVISION_NOT_APPROVED');
 assert.equal(flow.printDecision(E,1,{history:true}).route,'EXISTING_HISTORY_PRINT');
 assert.deepEqual(flow.history(E).map(v=>v.revision),[1]);
});
test('returning a legacy doc without changes does not create a new approval barrier',()=>{
 const {flow}=setup({legacy:true});
 assert.equal(flow.availableActions(E).edit,true);
 assert.equal(flow.availableActions(E).submit,false);
 assert.equal(flow.printDecision(E,1).eligible,true);
});
test('new document with unchanged original construction does not need reorganization review',()=>{
 const {flow}=setup({reorg:false});
 assert.equal(meta(flow).rearranged,false);
 assert.equal(flow.printDecision(E,1).route,'ORIGINAL_UNCHANGED_PRINT_CONTRACT');
 assert.equal(flow.availableActions(E).submit,false);
});
test('new reorganized document cannot print just from reason text',()=>{
 const {flow,d}=setup();
 assert.ok(d.unified.reason);
 denied(()=>flow.printDecision(E,1),'CURRENT_REORGANIZED_REVISION_NOT_APPROVED');
});
test('normal operation: edit, submit, independent approve, read-only history',()=>{
 const {flow}=setup();
 const s=submit(flow);
 assert.equal(s.status,'pending_review');
 assert.equal(flow.availableActions(E).approve,false);
 assert.equal(flow.availableActions(R).approve,true);
 assert.equal(approve(flow).status,'approved');
 assert.equal(flow.printDecision(E,1).route,'NEW_APPROVED_PRINT_CONTRACT');
 assert.deepEqual(flow.audit(E).map(x=>x.action),['SEED','SUBMITTED','APPROVED']);
});
test('reviewer return requires reason and triggers edit/resubmit cycle on next version',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>flow.returnForChanges(R,1,''),'RETURN_REASON_REQUIRED');
 denied(()=>flow.returnForChanges(R,1,'a'),'RETURN_REASON_REQUIRED');
 assert.equal(flow.returnForChanges(R,1,'請補上施工數量核對資料').status,'returned');
 assert.equal(flow.availableActions(E).submit,false);
 denied(()=>submit(flow),'NOT_EDITABLE_FOR_SUBMISSION');
 const changed=edit(flow,d=>{d.unified.lines[0].item='FAKE-FIXED-ITEM';});
 assert.equal(changed.revision,2);
 assert.equal(changed.status,'editing');
 submit(flow);approve(flow);
 assert.equal(flow.printDecision(E,2).route,'NEW_APPROVED_PRINT_CONTRACT');
 assert.equal(flow.printDecision(E,1,{history:true}).route,'EXISTING_HISTORY_PRINT');
});
test('return reason is not stored in plain text inside audit',()=>{
 const {flow}=setup();
 submit(flow);
 flow.returnForChanges(R,1,'PRIVATE-INVOICE-AUG 請人工修改');
 const t=JSON.stringify(flow.audit(E));
 assert.ok(!t.includes('PRIVATE-INVOICE-AUG'));
 assert.equal(flow.audit(E).at(-1).reasonDigest.length,64);
});
test('editor may withdraw own pending submission before editing, reviewer cannot withdraw',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>flow.withdraw(R),'NOT_OWN_PENDING_SUBMISSION');
 denied(()=>edit(flow,d=>{d.note='NEW';}),'WORKFLOW_MUST_BE_RETURNED_OR_WITHDRAWN_BEFORE_EDIT');
 assert.equal(flow.withdraw(E).status,'editing');
 assert.equal(meta(flow).submissionPending,false);
 assert.equal(submit(flow).status,'pending_review');
});
test('only independent owner/admin may approve',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>approve(flow,E),'ROLE_DENIED');
 denied(()=>approve(flow,U),'ROLE_DENIED');
 assert.equal(approve(flow,A).status,'approved');
});
test('same user editor and reviewer with owner privilege cannot approve own work',()=>{
 const who=members();
 who[E].role='owner';
 const {flow}=setup({who});
 submit(flow);
 denied(()=>approve(flow,E),'INDEPENDENT_APPROVER_REQUIRED');
 denied(()=>approve(flow,S),'INDEPENDENT_APPROVER_REQUIRED');
 assert.equal(approve(flow,R).status,'approved');
});
test('fake roles can see only actions appropriate to document state',()=>{
 const {flow}=setup();
 assert.equal(flow.availableActions(E).submit,true);
 assert.equal(flow.availableActions(E).approve,false);
 assert.equal(flow.availableActions(R).approve,false);
 submit(flow);
 assert.equal(flow.availableActions(E).withdraw,true);
 assert.equal(flow.availableActions(R).approve,true);
 assert.equal(flow.availableActions(R).return,true);
 assert.equal(flow.availableActions(R).edit,false); // pending is frozen
 approve(flow);
 assert.equal(flow.availableActions(E).edit,true);
 assert.equal(flow.availableActions(R).approve,false);
});
test('employee role has no document view or approval actions',()=>{
 const {flow}=setup();
 denied(()=>flow.getSummary(U),'ROLE_DENIED');
 denied(()=>flow.availableActions(U),'ROLE_DENIED');
 denied(()=>flow.printDecision(U,1),'ROLE_DENIED');
});
test('wrong company, no document ACL, missing fake MFA and inactive session denied',()=>{
 const {flow}=setup();
 const cases=[[X,'CROSS_COMPANY_DENIED'],[N,'DOCUMENT_ACL_DENIED'],
   [M,'FAKE_SESSION_OR_MFA_DENIED'],[D,'FAKE_SESSION_OR_MFA_DENIED']];
 for(const [user,why] of cases)denied(()=>flow.getSummary(user),why);
});
test('unknown and real-looking JWTs cannot be fake trust sources',()=>{
 const {flow}=setup();
 denied(()=>flow.getSummary('ey.fake.jwt'),'UNTRUSTED_FAKE_HANDLE');
 denied(()=>flow.getSummary('FAKE-HANDLE-UNKNOWN'),'FAKE_SESSION_OR_MFA_DENIED');
});
test('return request by editor or employee denied',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>flow.returnForChanges(E,1,'請修改施工項目'),'ROLE_DENIED');
 denied(()=>flow.returnForChanges(U,1,'請修改施工項目'),'ROLE_DENIED');
});
test('return request wrong version fails',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>flow.returnForChanges(R,7,'請重新核對金額'),'STALE_RETURN_VERSION');
});
test('approval with stale version or fake source hash fails',()=>{
 const {flow}=setup();
 submit(flow);
 denied(()=>flow.approve(R,2,meta(flow).sourceHash),'STALE_REVIEW_VERSION_OR_HASH');
 denied(()=>flow.approve(R,1,'BAD-DIGEST'),'STALE_REVIEW_VERSION_OR_HASH');
 assert.equal(meta(flow).status,'pending_review');
});
test('double approval cannot replay approved state',()=>{
 const {flow}=setup();submit(flow);approve(flow);
 denied(()=>approve(flow),'NOT_PENDING_REVIEW');
});
test('legacy printed version cannot be addressed as history when no prior versions',()=>{
 const {flow}=setup({legacy:true});
 denied(()=>flow.printDecision(E,1,{history:true}),'HISTORY_REVISION_NOT_FOUND');
});
test('old revision denied from current route and only accessible via history',()=>{
 const {flow}=setup({legacy:true});
 edit(flow,d=>{d.note='changed';});
 denied(()=>flow.printDecision(E,1),'NOT_CURRENT_VERSION');
 assert.equal(flow.printDecision(E,1,{history:true}).route,'EXISTING_HISTORY_PRINT');
});
test('stale edit prevents overwriting a newer document',()=>{
 const {flow}=setup();edit(flow,d=>{d.note='FIRST';});
 denied(()=>flow.edit(E,1,d=>{d.note='SECOND';}),'STALE_EDIT_VERSION');
 assert.equal(meta(flow).revision,2);
});
test('rejected financial tamper cannot create a new version',()=>{
 for(const changed of [
  d=>d.totals.grossTotal++,
  d=>d.totals.tax++,
  d=>d.totals.receivable++,
  d=>d.sourceSnapshots[0].anchors.retention++,
  d=>d.unified.lines[0].amount++
 ]){
  const {flow}=setup();
  const before=meta(flow);
  assert.throws(()=>edit(flow,changed));
  assert.deepEqual(meta(flow),before);
 }
});
const edits=[
 ['house',d=>{d.unified.lines[0].house='FAKE-NEW-HOUSE'}],
 ['item',d=>{d.unified.lines[0].item='FAKE-NEW-ITEM'}],
 ['unit',d=>{d.unified.lines[0].unit='組'}],
 ['qty and price with same money',d=>{d.unified.lines[0].qty=2;d.unified.lines[0].price=50;}],
 ['line order',d=>{[d.unified.lines[0],d.unified.lines[1]]=
  [d.unified.lines[1],d.unified.lines[0]];}],
 ['source original house',d=>{d.sourceSnapshots[0].originalLines[0].house='FAKE-SOURCE-NEW'}],
 ['private original invoice number',d=>{d.sourceSnapshots[0].invoiceNo='PRIVATE-INVOICE-REVISED'}],
 ['note',d=>{d.note='FAKE-NEW-NOTE'}],
 ['date',d=>{d.documentDate='2026-11-19'}],
 ['source tax term only',d=>{d.sourceSnapshots[0].taxMode='含稅'}],
 ['recomposition reason',d=>{d.unified.reason='FAKE-NEW-REASON'}],
 ['received and outstanding balanced',d=>{
  const s=d.settlementSnapshots[0];s.received+=10;s.outstanding-=10;s.availableToCollect-=10;
  d.totals.received+=10;d.totals.outstanding-=10;d.totals.availableToCollect-=10;
 }]
];
for(const [name,change] of edits){
 test('approved revision changes require fresh submission/review: '+name,()=>{
  const {flow}=setup();
  submit(flow);approve(flow);
  const first=meta(flow);
  const result=edit(flow,change);
  assert.equal(result.revision,2);
  assert.notEqual(result.sourceHash,first.sourceHash);
  denied(()=>flow.printDecision(E,2),'CURRENT_REORGANIZED_REVISION_NOT_APPROVED');
  denied(()=>flow.printDecision(E,1),'NOT_CURRENT_VERSION');
  if(result.rearranged){
   submit(flow);approve(flow);
   assert.equal(flow.printDecision(E,2).route,'NEW_APPROVED_PRINT_CONTRACT');
  }else{
   assert.equal(flow.printDecision(E,2).route,'ORIGINAL_UNCHANGED_PRINT_CONTRACT');
  }
 });
}
test('draft approval flow never returns invoice details, salary, bank or entire ERP snapshot',()=>{
 const {flow}=setup();
 submit(flow);approve(flow);
 const data=JSON.stringify({meta:meta(flow),print:flow.printDecision(E,1),history:flow.history(E),audit:flow.audit(E)});
 for(const sensitive of ['PRIVATE-INVOICE','sourceSnapshots','originalLines','settlementSnapshots',
   'bankTransactions','salary','payroll','FAKE-CUSTOMER','FAKE-L-ZONE']){
  assert.ok(!data.includes(sensitive),sensitive);
 }
});
test('revision history and notes never mutate the original input fixture',()=>{
 const d=doc(),before=hash(d);
 const f=new FakeReviewWorkflow(d,CO,members(),{editorHandle:E});
 submit(f);approve(f);edit(f,x=>{x.note='UPDATED'});
 assert.equal(hash(d),before);
 assert.equal(f.history(E).length,1);
});
test('mock approval model does not change the formal ERP files or SQL schema',()=>{
 const root=path.resolve(__dirname,'..');
 const model=fs.readFileSync(path.join(__dirname,'approval_flow.cjs'),'utf8');
 assert.ok(!model.includes('supabase.from('));
 assert.ok(!model.includes('window.print('));
 assert.ok(!model.includes('service_role'));
 assert.equal(fs.existsSync(path.join(root,'supabase/migrations/p40-16ba.sql')),false);
 assert.ok(!fs.readFileSync(path.join(root,'assets/js/billing-groups.js'),'utf8').includes('FakeReviewWorkflow'));
});
