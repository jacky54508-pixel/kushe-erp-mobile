/* P40-16AX: only FAKE documents and FAKE identities.
 * Tests independent review tied to the exact official-source-validated
 * cross-zone document revision, company, original+public lines, totals and
 * source fingerprint. Not an ERP/Supabase/Auth/PDF production test.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const {fixture}=require('./fixture.cjs');
const {MockTrustedApprovalGate,changedArrangement,hash,validDocument}=
  require('./mock_approval_gate.cjs');

const EDITOR='FAKE-HANDLE-EDITOR',REVIEW='FAKE-HANDLE-REVIEWER',
      ADMIN='FAKE-HANDLE-ADMIN',READER='FAKE-HANDLE-READER',
      STAFF='FAKE-HANDLE-STAFF',OTHER='FAKE-HANDLE-OTHER',
      UNASSIGNED='FAKE-HANDLE-UNASSIGNED',NO_MFA='FAKE-HANDLE-NO-MFA',
      REVOKED='FAKE-HANDLE-REVOKED',SAME='FAKE-HANDLE-SAME-EDITOR';
const CO='FAKE-CO-01', DOC='FAKE-GROUP-001';
function actor(role,userId,companyId=CO,docs=[DOC],extra={}){
  return {role,userId,companyId,allowedDocuments:docs,
    aal:'aal2',membershipActive:true,fakeSessionActive:true,
    fakeSignatureVerified:true,...extra};
}
function sessions(){
  return {
    [EDITOR]:actor('accounting','FAKE-USER-EDITOR'),
    [REVIEW]:actor('owner','FAKE-USER-OWNER'),
    [ADMIN]:actor('admin','FAKE-USER-ADMIN'),
    [READER]:actor('accounting','FAKE-USER-READ'),
    [STAFF]:actor('employee','FAKE-USER-STAFF'),
    [OTHER]:actor('owner','FAKE-USER-OTHER','FAKE-CO-02'),
    [UNASSIGNED]:actor('owner','FAKE-USER-UNASSIGNED',CO,[]),
    [NO_MFA]:actor('owner','FAKE-USER-NO-MFA',CO,[DOC],{aal:'aal1'}),
    [REVOKED]:actor('owner','FAKE-USER-REVOKED',CO,[DOC],{fakeSessionActive:false}),
    [SAME]:actor('accounting','FAKE-USER-EDITOR')
  };
}
function document({rearranged=true, options={}}={}){
  const d=fixture(options).document;
  d.id=DOC;
  d.revision=1;
  if(rearranged){
    d.unified.lines[0].item='FAKE-NEW-REORGANIZED-ITEM';
    d.unified.reason='FAKE-INTERNAL-DESCRIPTION-IS-NOT-INDEPENDENT-APPROVAL';
  }
  return d;
}
function setup({rearranged=true, options={}}={}){
  const who=sessions(), d=document({rearranged,options});
  const gate=new MockTrustedApprovalGate(who);
  gate.registerInitialTrustedOnly(d,CO,EDITOR);
  return {gate,who,d};
}
function currentDigest(gate){
  return gate.documentMeta(READER,DOC).sourceHash;
}
function approve(gate,handle=REVIEW){
  const rev=gate.documentMeta(READER,DOC).revision;
  return gate.approveReorganized(handle,DOC,rev,currentDigest(gate));
}
function allowed(gate,handle=READER,rev){
  const n=rev??gate.documentMeta(READER,DOC).revision;
  return gate.authorizationForExport(handle,DOC,n);
}
function reject(fn,part){
  assert.throws(fn,e=>!!e?.message&&e.message.includes(part),
    'Must reject: '+part);
}
function save(gate,fn,editor=EDITOR,expectedRev){
  const n=expectedRev??gate.documentMeta(READER,DOC).revision;
  return gate.saveNewRevision(editor,DOC,n,fn);
}
function approvedReorganized(){
  const {gate,who,d}=setup();
  approve(gate);
  assert.equal(allowed(gate).allowed,true);
  return {gate,who,d};
}

test('actual official main validator unchanged and used before fake review',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../assets/js/external-billing-print.js'),'utf8');
  assert.match(source,/function validate\(payload\)/);
  assert.match(source,/原帳款與收款合計不一致/);
  assert.match(source,/重新編排的對外明細缺少核對說明/);
  assert.ok(source.includes("const same=d.sourceSnapshots.every("));
  assert.ok(!source.includes('P40-16AX'));
  assert.deepEqual(validDocument(document()),validDocument(document()));
});

test('original shape requires no new reorganization approval',()=>{
  const {gate,d}=setup({rearranged:false});
  assert.equal(changedArrangement(d),false);
  const r=allowed(gate);
  assert.equal(r.allowed,true);
  assert.equal(r.independentApprovalRequired,false);
});
test('reorganized same-total lines need independent review even with explanation',()=>{
  const {gate,d}=setup();
  assert.equal(changedArrangement(d),true);
  assert.ok(d.unified.reason);
  reject(()=>allowed(gate),'CURRENT_REVISION_INDEPENDENT_APPROVAL_REQUIRED');
});
test('a fake approval field or reason in a client document cannot forge approval',()=>{
  const {gate,d}=setup();
  d.approval={approved:true,reviewerId:'FAKE-USER-OWNER',sourceHash:'FORGED'};
  d.unified.reason='強行聲稱核准';
  reject(()=>allowed(gate),'CURRENT_REVISION_INDEPENDENT_APPROVAL_REQUIRED');
});
test('real source remains readonly after the test approves its fake copy',()=>{
  const {gate,d}=setup();
  const before=JSON.stringify(d);
  approve(gate);
  assert.equal(JSON.stringify(d),before);
  assert.equal(allowed(gate).revision,1);
});
test('same author cannot approve own changes, even when an editor has reviewer role',()=>{
  const {gate}=setup();
  // The ordinary editor is accounting, so role gate already blocks reviewer.
  reject(()=>approve(gate,EDITOR),'FAKE_ROLE_NOT_AUTHORIZED');
  const who=sessions();
  who[EDITOR].role='owner'; // Special fake owner who edits own document.
  who[SAME].role='owner';   // Distinct fake handle, SAME user ID.
  const independent=new MockTrustedApprovalGate(who),d=document();
  independent.registerInitialTrustedOnly(d,CO,EDITOR);
  reject(()=>independent.approveReorganized(EDITOR,DOC,1,
    independent.documentMeta(READER,DOC).sourceHash),
    'INDEPENDENT_REVIEWER_REQUIRED');
  reject(()=>independent.approveReorganized(SAME,DOC,1,
    independent.documentMeta(READER,DOC).sourceHash),
    'INDEPENDENT_REVIEWER_REQUIRED');
});
test('only proposed fake owner/admin reviewers can approve, not accounting',()=>{
  const {gate}=setup();
  reject(()=>approve(gate,READER),'FAKE_ROLE_NOT_AUTHORIZED');
  reject(()=>approve(gate,STAFF),'FAKE_ROLE_NOT_AUTHORIZED');
  assert.equal(approve(gate,REVIEW).approved,true);
});
test('separate fake admin reviewer can approve if company and document match',()=>{
  const {gate}=setup();
  assert.equal(approve(gate,ADMIN).approved,true);
  assert.equal(allowed(gate).independentApprovalRequired,true);
});
test('unknown / forged fake handles are rejected before document access',()=>{
  const {gate}=setup();
  for(const bad of ['eyJ.not.jwt','',null]){
    reject(()=>gate.approveReorganized(bad,DOC,1,currentDigest(gate)),'UNTRUSTED_MOCK_IDENTITY');
  }
  reject(()=>gate.approveReorganized('FAKE-HANDLE-NOT-IN-REGISTRY',DOC,1,currentDigest(gate)),
    'MOCK_IDENTITY_OR_MFA_DENIED');
});
test('fake missing MFA, expired session, wrong company and no ACL denied',()=>{
  const {gate}=setup();
  reject(()=>approve(gate,NO_MFA),'MOCK_IDENTITY_OR_MFA_DENIED');
  reject(()=>approve(gate,REVOKED),'MOCK_IDENTITY_OR_MFA_DENIED');
  reject(()=>approve(gate,OTHER),'FAKE_CROSS_COMPANY_DENIED');
  reject(()=>approve(gate,UNASSIGNED),'FAKE_DOCUMENT_ACL_DENIED');
});
test('same company but different unassigned document cannot be exported',()=>{
  const {gate}=setup();
  reject(()=>gate.authorizationForExport(UNASSIGNED,DOC,1),'FAKE_DOCUMENT_ACL_DENIED');
});
test('export checks fake role, company and MFA anew after approval',()=>{
  const {gate}=approvedReorganized();
  reject(()=>gate.authorizationForExport(STAFF,DOC,1),'FAKE_ROLE_NOT_AUTHORIZED');
  reject(()=>gate.authorizationForExport(OTHER,DOC,1),'FAKE_CROSS_COMPANY_DENIED');
  reject(()=>gate.authorizationForExport(NO_MFA,DOC,1),'MOCK_IDENTITY_OR_MFA_DENIED');
  reject(()=>gate.authorizationForExport(REVOKED,DOC,1),'MOCK_IDENTITY_OR_MFA_DENIED');
});
test('repeated approval cannot rewrite one revision',()=>{
  const {gate}=approvedReorganized();
  reject(()=>approve(gate),'ALREADY_APPROVED');
});
test('approval expected source hash must match exact current revision',()=>{
  const {gate}=setup();
  reject(()=>gate.approveReorganized(REVIEW,DOC,1,'FAKE-WRONG-HASH'),
    'APPROVAL_STALE_OR_SOURCE_CHANGED');
  reject(()=>gate.approveReorganized(REVIEW,DOC,2,currentDigest(gate)),
    'APPROVAL_STALE_OR_SOURCE_CHANGED');
});
test('valid approval returns only safe metadata not invoice or customer snapshots',()=>{
  const {gate}=approvedReorganized();
  const exportMetadata=allowed(gate);
  assert.deepEqual(Object.keys(exportMetadata).sort(),[
    'allowed','documentId','evidenceOnly','independentApprovalRequired',
    'revision','sourceHash'].sort());
  const s=JSON.stringify(exportMetadata);
  for(const privateMarker of ['PRIVATE-INVOICE','sourceSnapshots',
      'settlementSnapshots','FAKE-L-ZONE','FAKE-ORIGINAL','FAKE-CUSTOMER'])
    assert.ok(!s.includes(privateMarker),privateMarker);
});
test('stored version source digest is stable to input field ordering',()=>{
  const a={b:{z:2,x:1},a:[3,2,1]};
  const b={a:[3,2,1],b:{x:1,z:2}};
  assert.equal(hash(a),hash(b));
  assert.notEqual(hash(a),hash({a:[3,1,2],b:{x:1,z:2}}));
});
test('nested dangerous keys, nonfinite numbers and cyclic structures fail hash boundary',()=>{
  reject(()=>hash({x:Infinity}),'INVALID_APPROVAL_DATA_TYPE');
  reject(()=>hash({x:()=>true}),'INVALID_APPROVAL_DATA_TYPE');
  reject(()=>hash(JSON.parse('{"__proto__":{"admin":true}}')),'UNSAFE_OBJECT_FIELD');
  const a={};a.self=a;
  reject(()=>hash(a),'DUPLICATE_OR_CYCLIC_OBJECT_REFERENCE');
});
const validRevisions=[
  ['house',d=>{d.unified.lines[0].house='FAKE-NEWHOUSE-18A';}],
  ['item',d=>{d.unified.lines[0].item='FAKE-ITEM-CHANGED-AFTER-REVIEW';}],
  ['unit',d=>{d.unified.lines[0].unit='組';}],
  ['quantity and price with same amount',d=>{d.unified.lines[0].qty=2;d.unified.lines[0].price=50;}],
  ['reordered rows',d=>{[d.unified.lines[0],d.unified.lines[1]]=
    [d.unified.lines[1],d.unified.lines[0]];}],
  ['target note',d=>{d.note='FAKE-NEW-PUBLIC-NOTE';}],
  ['document date',d=>{d.documentDate='2026-11-19';}],
  ['source original item changed with unchanged amount',d=>{
     d.sourceSnapshots[0].originalLines[0].item='FAKE-NEW-ORIGINAL-SOURCE-NAME';
  }],
  ['source invoice identifier updated',d=>{
     d.sourceSnapshots[0].invoiceNo='PRIVATE-INVOICE-NEW-AUG';
  }],
  ['source financial received+outstanding snapshot changed',d=>{
     const src=d.settlementSnapshots[0];
     src.received+=10;src.outstanding-=10;src.availableToCollect-=10;
     d.totals.received+=10;d.totals.outstanding-=10;d.totals.availableToCollect-=10;
  }],
  ['reorganization reason changed',d=>{d.unified.reason='FAKE-NEW-REASON';}]
];
for(const [name,mutation] of validRevisions){
  test('new revision invalidates old approval: '+name,()=>{
    const {gate}=approvedReorganized();
    const before=gate.documentMeta(READER,DOC);
    const next=save(gate,mutation);
    assert.equal(next.revision,2);
    assert.notEqual(next.sourceHash,before.sourceHash);
    assert.deepEqual(gate.documentMeta(READER,DOC).priorRevisions,[1]);
    reject(()=>gate.authorizationForExport(READER,DOC,1),'NOT_CURRENT_ACTIVE_REVISION');
    reject(()=>gate.authorizationForExport(READER,DOC,2),'CURRENT_REVISION_INDEPENDENT_APPROVAL_REQUIRED');
    assert.equal(approve(gate).revision,2);
    assert.equal(allowed(gate).allowed,true);
  });
}
test('stale two-editor CAS cannot replace a version already updated',()=>{
  const {gate}=approvedReorganized();
  save(gate,d=>{d.note='FIRST CHANGE';},EDITOR,1);
  reject(()=>save(gate,d=>{d.note='SECOND CHANGE';},READER,1),'CAS_STALE_VERSION');
  assert.deepEqual(gate.documentMeta(READER,DOC).priorRevisions,[1]);
});
test('approval after stale version is forbidden even if original digest known',()=>{
  const {gate}=approvedReorganized();
  const old=currentDigest(gate);
  save(gate,d=>{d.note='UPDATED';});
  reject(()=>gate.approveReorganized(REVIEW,DOC,1,old),'APPROVAL_STALE_OR_SOURCE_CHANGED');
});
test('saving a malicious gross/tax/retention amount stops before mock commit',()=>{
  for(const mutation of [
    d=>{d.totals.grossTotal++;},
    d=>{d.totals.tax++;},
    d=>{d.totals.receivable++;},
    d=>{d.sourceSnapshots[0].anchors.retention++;},
    d=>{d.unified.lines[0].amount++;}
  ]){
    const {gate}=approvedReorganized();
    const before=gate.documentMeta(READER,DOC);
    reject(()=>save(gate,mutation),''); // official validator throws in Chinese
    assert.deepEqual(gate.documentMeta(READER,DOC),before);
    assert.equal(allowed(gate).allowed,true);
  }
});
test('no revision downgrade and no unauthorized forced archive by revision API',()=>{
  const {gate}=approvedReorganized();
  reject(()=>save(gate,d=>{d.status='archived';}),'REVISIONS_CANNOT_ARCHIVE_WITHOUT_SEPARATE_GATE');
  assert.equal(gate.documentMeta(READER,DOC).revision,1);
});
test('only one immutable previous revision is retained after one update',()=>{
  const {gate}=approvedReorganized();
  save(gate,d=>{d.note='FAKE-ONE';});
  save(gate,d=>{d.note='FAKE-TWO';});
  assert.deepEqual(gate.documentMeta(READER,DOC).priorRevisions,[1,2]);
  reject(()=>gate.authorizationForExport(READER,DOC,2),'NOT_CURRENT_ACTIVE_REVISION');
});
test('audit chain records document create, approval, revision and new approval in order',()=>{
  const {gate}=approvedReorganized();
  save(gate,d=>{d.note='EDITED-WITHOUT-AUTO-APPROVAL';});
  approve(gate);
  const audit=gate.auditMetadata();
  assert.deepEqual(audit.map(x=>x.action),[
    'DOCUMENT_REGISTERED','REORGANIZATION_APPROVED',
    'REVISION_SAVED','REORGANIZATION_APPROVED'
  ]);
  assert.ok(gate.validateAuditChain());
  assert.deepEqual(audit.map(x=>x.seq),[1,2,3,4]);
  for(const row of audit){
    assert.match(row.recordHash,/^[a-f0-9]{64}$/);
    const s=JSON.stringify(row);
    for(const secret of ['PRIVATE-INVOICE','originalLines',
      'sourceSnapshots','bankTransactions','payroll','FAKE-L-ZONE'])
      assert.ok(!s.includes(secret));
  }
});
test('changing a returned audit copy cannot overwrite internal audit events',()=>{
  const {gate}=approvedReorganized();
  const audit=gate.auditMetadata();
  audit[0].documentId='FORGED';
  audit[1].digest='TAMPER';
  assert.ok(gate.validateAuditChain());
  assert.equal(gate.auditMetadata()[0].documentId,DOC);
  assert.notEqual(gate.auditMetadata()[1].digest,'TAMPER');
});
test('editing initially unchanged document into a reorganized one requires new review',()=>{
  const {gate}=setup({rearranged:false});
  assert.equal(allowed(gate).independentApprovalRequired,false);
  save(gate,d=>{
    d.unified.lines[0].item='FAKE-NEW-ITEM';d.unified.reason='FAKE-REORG-REASON';
  });
  reject(()=>allowed(gate),'CURRENT_REVISION_INDEPENDENT_APPROVAL_REQUIRED');
  approve(gate);
  assert.equal(allowed(gate).independentApprovalRequired,true);
});
test('returning to original line shape removes reorganization need on a NEW version',()=>{
  const {gate}=approvedReorganized();
  save(gate,d=>{
    d.unified.lines=d.sourceSnapshots.flatMap(s=>
      s.originalLines.map(l=>({house:l.house,item:l.item,unit:l.unit,
        qty:l.qty,price:l.price,amount:l.amount})));
    d.unified.reason='';
  });
  assert.equal(allowed(gate).independentApprovalRequired,false);
});
test('fake employee cannot edit, approve or export',()=>{
  const {gate}=setup();
  reject(()=>save(gate,d=>{d.note='STAFF';},STAFF),'FAKE_ROLE_NOT_AUTHORIZED');
  reject(()=>approve(gate,STAFF),'FAKE_ROLE_NOT_AUTHORIZED');
  reject(()=>gate.authorizationForExport(STAFF,DOC,1),'FAKE_ROLE_NOT_AUTHORIZED');
});
test('different company cannot edit, approve or export',()=>{
  const {gate}=setup();
  reject(()=>save(gate,d=>{d.note='CROSS-CO';},OTHER),'FAKE_CROSS_COMPANY_DENIED');
  reject(()=>approve(gate,OTHER),'FAKE_CROSS_COMPANY_DENIED');
  reject(()=>gate.authorizationForExport(OTHER,DOC,1),'FAKE_CROSS_COMPANY_DENIED');
});
test('external ERP source remains unchanged, nothing writes Supabase or creates PDF',()=>{
  const code=fs.readFileSync(path.join(__dirname,'mock_approval_gate.cjs'),'utf8');
  assert.ok(!code.includes('fetch('));
  assert.ok(!code.includes('supabase.from('));
  assert.ok(!code.includes('service_role_key'));
  assert.ok(!fs.existsSync(path.join(ROOT,'supabase/migrations/p40-16ax.sql')));
  assert.ok(!fs.readFileSync(path.join(ROOT,'assets/js/billing-groups.js'),'utf8')
    .includes('MockTrustedApprovalGate'));
});
