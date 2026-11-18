/* P40-16AY: persistent FAKE approval evidence and legacy-safe migration.
 * All files are temp test artifacts under OS temporary directories.
 * No Supabase, Cloudflare, real login, bank, invoice or ERP snapshot.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ApprovalJournalLab,digest,officialCheck,rearranged}=
  require('./persistent_approval_lab.cjs');
const {fixture}=require('./fixture.cjs');
const DOC='FAKE-GROUP-001',CO='FAKE-CO-ONE';
const EDIT='FAKE-HANDLE-EDIT',REVIEW='FAKE-HANDLE-REVIEW',
 ADMIN='FAKE-HANDLE-ADMIN',ACCOUNT='FAKE-HANDLE-ACCOUNT',
 STAFF='FAKE-HANDLE-STAFF',FOREIGN='FAKE-HANDLE-FOREIGN',
 UNASSIGNED='FAKE-HANDLE-NO-ACL',NO_MFA='FAKE-HANDLE-AAL1',
 REVOKED='FAKE-HANDLE-REVOKED',SELF_OWNER='FAKE-HANDLE-SELF-OWNER';
const auth=(role,userId,companyId=CO,docs=[DOC],more={})=>({
 role,userId,companyId,allowedDocuments:docs,
 aal:'aal2',fakeVerified:true,sessionActive:true,membershipActive:true,...more
});
function sessions(){
 return {
 [EDIT]:auth('accounting','FAKE-USER-EDIT'),
 [REVIEW]:auth('owner','FAKE-USER-OWNER'),
 [ADMIN]:auth('admin','FAKE-USER-ADMIN'),
 [ACCOUNT]:auth('accounting','FAKE-USER-ACCOUNT'),
 [STAFF]:auth('employee','FAKE-USER-EMPLOYEE'),
 [FOREIGN]:auth('owner','FAKE-USER-OTHER','FAKE-CO-TWO'),
 [UNASSIGNED]:auth('owner','FAKE-USER-NO-ACL',CO,[]),
 [NO_MFA]:auth('owner','FAKE-USER-AAL1',CO,[DOC],{aal:'aal1'}),
 [REVOKED]:auth('owner','FAKE-USER-REVOKED',CO,[DOC],{sessionActive:false}),
 [SELF_OWNER]:auth('owner','FAKE-USER-EDIT')
 };
}
function document({reorg=true,revision=1,opts={}}={}){
 const d=fixture(opts).document;
 d.id=DOC;d.revision=revision;
 if(reorg){
   d.unified.lines[0].item='FAKE-REARRANGED-WORK-NAME';
   d.unified.reason='FAKE-EXPLANATION-IS-NOT-INDEPENDENT-APPROVAL';
 }
 return d;
}
function lab(t,{legacy=false,reorg=true,revision=1,docsessions=sessions()}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p40ay-'));
 const file=path.join(dir,'p40ay-approval-journal.jsonl');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const gate=new ApprovalJournalLab(file,docsessions);
 const d=document({reorg,revision});
 gate.enrol(d,CO,EDIT,{sourceTrusted:true,existingLegacy:legacy});
 return {gate,file,d,docsessions};
}
function blocked(fn,match){
 assert.throws(fn,e=>e instanceof Error&&e.message.includes(match),
   'Expected denial '+match);
}
function status(g){return g.metadata(ACCOUNT,DOC)}
function approve(g,who=REVIEW){
 const s=status(g);return g.approve(who,DOC,s.revision,s.sourceHash);
}
function decide(g,who=ACCOUNT,rev=status(g).revision){
 return g.printDecision(who,DOC,rev);
}

test('real formal billing validation and intact 8/10 month original source',()=>{
 const d=document();
 assert.equal(officialCheck(d),d);
 assert.equal(rearranged(d),true);
 assert.ok(d.sourceSnapshots[0].invoiceNo.startsWith('PRIVATE-INVOICE'));
 const original=document({reorg:false});
 assert.equal(rearranged(original),false);
});

test('existing previously confirmed documents remain printable WITHOUT retrospective approval',t=>{
 const {gate,d}=lab(t,{legacy:true});
 const result=decide(gate);
 assert.equal(result.allowed,true);
 assert.equal(result.scope,'PREEXISTING_LEGACY_COMPATIBILITY');
 assert.equal(status(gate).awaitingApproval,false);
 assert.equal(status(gate).mode,'legacy');
 assert.equal(gate.verify(),true);
});
test('existing documents with revision > 1 are not retroactively forced into v1',t=>{
 const {gate,d}=lab(t,{legacy:true,revision:7});
 assert.equal(decide(gate,ACCOUNT,7).allowed,true);
 assert.equal(status(gate).revision,7);
 assert.equal(status(gate).mode,'legacy');
});
test('legacy unchanged source can still print after restart with trusted exact-source reattach',t=>{
 const {file,d,docsessions}=lab(t,{legacy:true});
 const reloaded=new ApprovalJournalLab(file,docsessions);
 blocked(()=>decide(reloaded),'TRUSTED_SOURCE_NOT_ATTACHED_OR_CHANGED');
 reloaded.reattachFromTrustedSource(DOC,d,true);
 assert.equal(decide(reloaded).scope,'PREEXISTING_LEGACY_COMPATIBILITY');
});
test('legacy protection cannot be turned on via client-supplied mode field',t=>{
 const {gate,d}=lab(t,{legacy:true});
 d.mode='enforced';d.fakeApproved=true;
 assert.equal(decide(gate).scope,'PREEXISTING_LEGACY_COMPATIBILITY');
});
test('editing legacy document automatically opts NEW revision into approval enforcement',t=>{
 const {gate}=lab(t,{legacy:true});
 const edited=gate.revise(EDIT,DOC,1,d=>{d.note='NEW-PUBLIC-NOTE';});
 assert.equal(edited.revision,2);
 assert.equal(edited.mode,'enforced');
 blocked(()=>decide(gate),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
 blocked(()=>gate.printDecision(ACCOUNT,DOC,1),'NOT_CURRENT_VERSION');
 assert.equal(approve(gate).awaitingApproval,false);
 assert.equal(decide(gate).scope,'NEW_ENFORCED_VERSION');
});
test('a legacy doc with no rearrangement edited into unchanged document needs no reviewer',t=>{
 const {gate}=lab(t,{legacy:true,reorg:false});
 gate.revise(EDIT,DOC,1,d=>{d.note='FAKE-NEW-NOTE';});
 assert.equal(status(gate).mode,'enforced');
 assert.equal(decide(gate).needsReview,false);
});
test('new enrolled rearranged documents MUST have independent approval before export',t=>{
 const {gate}=lab(t);
 blocked(()=>decide(gate),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
 assert.equal(status(gate).awaitingApproval,true);
 assert.equal(approve(gate).awaitingApproval,false);
 assert.equal(decide(gate).scope,'NEW_ENFORCED_VERSION');
});
test('new enrolled unchanged construction rows can export after formal financial validation',t=>{
 const {gate}=lab(t,{reorg:false});
 assert.equal(status(gate).mode,'enforced');
 assert.equal(decide(gate).needsReview,false);
 blocked(()=>approve(gate),'NO_REARRANGEMENT_NEEDS_APPROVAL');
});
test('fake reviewer is owner or admin, not editor accounting or employee',t=>{
 const {gate}=lab(t);
 for(const [who,reason] of [[EDIT,'ROLE_DENIED'],
    [ACCOUNT,'ROLE_DENIED'],[STAFF,'ROLE_DENIED'],
    [FOREIGN,'CROSS_COMPANY_ACCESS_DENIED'],
    [UNASSIGNED,'DOCUMENT_ACL_DENIED'],
    [NO_MFA,'FAKE_AUTH_OR_MFA_DENIED'],
    [REVOKED,'FAKE_AUTH_OR_MFA_DENIED']]){
   blocked(()=>approve(gate,who),reason);
 }
 assert.equal(approve(gate,ADMIN).awaitingApproval,false);
});
test('same author cannot approve own work EVEN if author has owner role',t=>{
 const who=sessions();
 who[EDIT].role='owner';
 const {gate}=lab(t,{docsessions:who});
 blocked(()=>approve(gate,EDIT),'SEPARATE_REVIEWER_REQUIRED');
 blocked(()=>approve(gate,SELF_OWNER),'SEPARATE_REVIEWER_REQUIRED');
 assert.equal(approve(gate,REVIEW).awaitingApproval,false);
});
test('approval is bound to exact version and digest; replay/duplicate denied',t=>{
 const {gate}=lab(t);
 const s=status(gate);
 blocked(()=>gate.approve(REVIEW,DOC,2,s.sourceHash),'STALE_APPROVAL_REQUEST');
 blocked(()=>gate.approve(REVIEW,DOC,1,'0'.repeat(64)),'STALE_APPROVAL_REQUEST');
 approve(gate);
 blocked(()=>approve(gate),'ALREADY_APPROVED');
});
test('cross-company and missing document ACL cannot print even when approved',t=>{
 const {gate}=lab(t);
 approve(gate);
 for(const [who,reason] of [[FOREIGN,'CROSS_COMPANY_ACCESS_DENIED'],
    [UNASSIGNED,'DOCUMENT_ACL_DENIED'],[STAFF,'ROLE_DENIED'],
    [NO_MFA,'FAKE_AUTH_OR_MFA_DENIED']]){
   blocked(()=>gate.printDecision(who,DOC,1),reason);
 }
});
const revisionScenarios=[
 ['original house',d=>{d.sourceSnapshots[0].originalLines[0].house='FAKE-OTHER-HOUSE';}],
 ['outward house',d=>{d.unified.lines[0].house='FAKE-OTHER-HOUSE';}],
 ['outward item',d=>{d.unified.lines[0].item='FAKE-UPDATED-ITEM';}],
 ['outward unit',d=>{d.unified.lines[0].unit='組';}],
 ['outward quantity plus inverse price',d=>{d.unified.lines[0].qty=2;d.unified.lines[0].price=50;}],
 ['outward order',d=>{[d.unified.lines[0],d.unified.lines[1]]=
   [d.unified.lines[1],d.unified.lines[0]];}],
 ['outward note',d=>{d.note='FAKE-UPDATED-BILLING-NOTE';}],
 ['document date',d=>{d.documentDate='2026-11-19';}],
 ['invoice number',d=>{d.sourceSnapshots[0].invoiceNo='PRIVATE-INVOICE-OCT-CHANGED';}],
 ['verified paid and outstanding',d=>{
   const s=d.settlementSnapshots[0];
   s.received+=10;s.outstanding-=10;s.availableToCollect-=10;
   d.totals.received+=10;d.totals.outstanding-=10;d.totals.availableToCollect-=10;
 }],
 ['reason edited',d=>{d.unified.reason='FAKE-REVISED-EXPLANATION';}]
];
for(const [name,mutation] of revisionScenarios){
 test('saved revision requires new approval and retains old audit evidence: '+name,t=>{
   const {gate}=lab(t);
   const s=status(gate);
   approve(gate);
   const result=gate.revise(EDIT,DOC,1,mutation);
   assert.equal(result.revision,2);
   assert.notEqual(result.sourceHash,s.sourceHash);
   blocked(()=>gate.printDecision(ACCOUNT,DOC,1),'NOT_CURRENT_VERSION');
   blocked(()=>decide(gate),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
   assert.equal(gate.auditLog().filter(e=>e.action==='APPROVED').length,1);
   approve(gate);
   assert.equal(decide(gate).allowed,true);
   assert.equal(gate.auditLog().filter(e=>e.action==='APPROVED').length,2);
 });
}
test('stale editor cannot overwrite the changed version using old expectedRevision',t=>{
 const {gate}=lab(t);approve(gate);
 gate.revise(EDIT,DOC,1,d=>{d.note='FAKE-EDIT-A';});
 blocked(()=>gate.revise(ACCOUNT,DOC,1,d=>{d.note='FAKE-EDIT-B';}),'STALE_CAS_REVISION');
 assert.equal(status(gate).revision,2);
});
test('corrupt tax, retention, receivable or line amount blocked before commit',t=>{
 const mutations=[
  d=>d.totals.tax++,d=>d.totals.grossTotal++,
  d=>d.totals.receivable++,d=>d.sourceSnapshots[0].anchors.retention++,
  d=>d.unified.lines[0].amount++
 ];
 for(const fn of mutations){
   const {gate}=lab(t);
   const before=status(gate);
   blocked(()=>gate.revise(EDIT,DOC,1,fn),''); // official Chinese fail closed
   assert.deepEqual(status(gate),before);
 }
});
test('source identity/unknown field cannot become a new approved original',t=>{
 const {gate}=lab(t);
 blocked(()=>gate.revise(EDIT,DOC,1,d=>{d.id='FAKE-GROUP-NEW';}),
  'SOURCE_IDENTITY_CHANGED');
 assert.equal(status(gate).revision,1);
});
test('existing trusted source document cannot be reattached with mutated contents',t=>{
 const {file,d,docsessions}=lab(t);
 const recovered=new ApprovalJournalLab(file,docsessions);
 const edited=structuredClone(d);
 edited.unified.lines[0].item='FAKE-TAMPER';
 blocked(()=>recovered.reattachFromTrustedSource(DOC,edited,true),
   'REATTACH_SOURCE_HASH_MISMATCH');
});
test('journal records survive restart but cannot release without trusted source re-attachment',t=>{
 const {gate,file,d,docsessions}=lab(t);
 approve(gate);
 const r=new ApprovalJournalLab(file,docsessions);
 assert.equal(r.verify(),true);
 assert.equal(r.metadata(ACCOUNT,DOC).awaitingApproval,false);
 blocked(()=>decide(r),'TRUSTED_SOURCE_NOT_ATTACHED_OR_CHANGED');
 r.reattachFromTrustedSource(DOC,d,true);
 assert.equal(decide(r).allowed,true);
});
test('approval remains bound after separate process reload',t=>{
 const {gate,file,d,docsessions}=lab(t);
 approve(gate);
 const restarted=new ApprovalJournalLab(file,docsessions);
 restarted.reattachFromTrustedSource(DOC,d,true);
 assert.equal(restarted.auditLog().filter(e=>e.action==='APPROVED').length,1);
 assert.equal(decide(restarted).scope,'NEW_ENFORCED_VERSION');
});
test('if persistent journal changed on disk, fake approval log fails CLOSED on restart',t=>{
 const {gate,file}=lab(t);
 approve(gate);
 const data=fs.readFileSync(file,'utf8');
 fs.writeFileSync(file,data.replace('ENROLLED','REPLACED'),{mode:0o600});
 blocked(()=>new ApprovalJournalLab(file,sessions()),'AUDIT_CHAIN_INVALID');
});
test('partial trailing journal write fails closed (no silent truncation/recovery)',t=>{
 const {file}=lab(t);
 fs.appendFileSync(file,'{"action":"APPROVED"');
 blocked(()=>new ApprovalJournalLab(file,sessions()),'JOURNAL_TRUNCATED');
});
test('untrusted mock source import fails without explicit trusted fixture flag',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p40ay-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const gate=new ApprovalJournalLab(path.join(dir,'p40ay-test.jsonl'),sessions());
 blocked(()=>gate.enrol(document(),CO,EDIT,{sourceTrusted:false}),
  'TRUSTED_INGESTION_REQUIRED');
});
test('an old ledger instance cannot write after a different instance appended events',t=>{
 const {gate,file,d,docsessions}=lab(t);
 const stale=new ApprovalJournalLab(file,docsessions);
 stale.reattachFromTrustedSource(DOC,d,true);
 approve(gate);
 blocked(()=>stale.approve(REVIEW,DOC,1,status(stale).sourceHash),
  'CONCURRENT_LEDGER_CHANGE');
});
test('exclusive writer lock refuses concurrent write instead of racing',t=>{
 const {gate,file}=lab(t);
 fs.writeFileSync(file+'.lock','fake competing writer',{flag:'wx'});
 blocked(()=>approve(gate),'EEXIST');
 fs.unlinkSync(file+'.lock');
 assert.equal(approve(gate).awaitingApproval,false);
});
test('audit exports metadata only; never stores original invoices, construction or finance rows',t=>{
 const {gate,file}=lab(t);
 approve(gate);
 const text=fs.readFileSync(file,'utf8');
 for(const secret of ['sourceSnapshots','settlementSnapshots','originalLines',
   'PRIVATE-INVOICE','FAKE-REARRANGED-WORK','FAKE-CUSTOMER',
   'bankTransactions','salary','payroll','PUBLIC-NOTE']){
   assert.equal(text.includes(secret),false,secret);
 }
 for(const row of gate.auditLog()){
   assert.match(row.eventHash,/^[a-f0-9]{64}$/);
   assert.equal(typeof row.actorId,'string');
 }
 assert.equal(gate.verify(),true);
});
test('audit copy mutation cannot alter actual journal events',t=>{
 const {gate}=lab(t);approve(gate);
 const exposed=gate.auditLog();exposed[0].sourceHash='FAKE-MODIFIED';
 assert.equal(gate.verify(),true);
 assert.notEqual(gate.auditLog()[0].sourceHash,'FAKE-MODIFIED');
});
test('old approval cannot be reused for newer version even with identical construction amounts',t=>{
 const {gate}=lab(t);approve(gate);
 gate.revise(EDIT,DOC,1,d=>{d.note='FAKE-NON-FINANCIAL-CHANGE';});
 blocked(()=>decide(gate),'NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
});
test('no fake approval for unchanged new construction is required',t=>{
 const {gate}=lab(t,{reorg:false});
 assert.equal(decide(gate).needsReview,false);
 blocked(()=>approve(gate),'NO_REARRANGEMENT_NEEDS_APPROVAL');
});
test('no approved-by-client flags or entire ERP state stored in this test branch',()=>{
 const source=fs.readFileSync(path.join(__dirname,'persistent_approval_lab.cjs'),'utf8');
 assert.equal(source.includes('supabase.from('),false);
 assert.equal(source.includes('window.print('),false);
 assert.equal(source.includes('erp_states?select=data'),false);
 assert.equal(fs.existsSync(path.resolve(__dirname,'../supabase/migrations/p40-16ay.sql')),false);
});
