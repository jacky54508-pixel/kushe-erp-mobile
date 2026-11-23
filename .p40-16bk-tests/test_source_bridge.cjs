'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeGateway,dataHash}=require('./source_bridge.cjs');
const deep=x=>structuredClone(x);
function original(billingId,projectName,base,customerId='fake-customer'){
  return {billingId,projectName,customerName:'虛構建商',customerId,
    invoiceNo:'PRIVATE-INVOICE-'+billingId,invoiceDate:'2026-11-01',invoiceStatus:'invoiced',
    internalBankAccount:'SENSITIVE',originalLines:[],
    anchors:{untaxed:base,tax:0,grossTotal:base,retention:0,receivable:base}};
}
const settles=ids=>ids.map(billingId=>({billingId,received:0,outstanding:1000,retentionReceived:0,retentionOutstanding:0,pendingCheque:0,availableToCollect:1000,privateRemark:'SALARY AND BANK DATA'}));
function fixture(){
  const s1=original('fake-bill-a','虛構工程 A 區',1000),s2=original('fake-bill-b','虛構工程 B 區',1000);
  const doc={schema:'kushe-external-billing-group-v2',detailMode:'unified',id:'fake-merged-001',
    companyId:'fake-company-a',revision:1,status:'active',sourceIds:['fake-bill-a','fake-bill-b'],
    sourceSnapshots:[s1,s2],settlementSnapshots:settles(['fake-bill-a','fake-bill-b']),
    targetBillingId:'fake-bill-a',displayProjectName:s1.projectName,customerId:'fake-customer',
    customerName:'虛構建商',documentDate:'2026-11-19',note:'已經人工核對之對外備註',
    unified:{taxMode:'未稅',lines:[{house:'1A',item:'地板修繕',unit:'式',qty:2,price:1000,amount:2000,
      employeeCommission:400,bankTransaction:'HIDDEN'}],reason:'跨區對外明細人工重編',total:2000,target:2000},
    totals:{untaxed:2000,tax:0,grossTotal:2000,retention:0,receivable:2000,
      received:0,outstanding:2000,retentionReceived:0,retentionOutstanding:0,pendingCheque:0,availableToCollect:2000},
    internalAudit:'NOT_PUBLIC',history:[{revision:0,private:'OLD'}]};
  const row={syncVersion:'321',data:{meta:{externalBillingDocuments:[doc]},
    payroll:[{secret:'PAYROLL'}],bankTransactions:[{secret:'BANK'}],invoices:[{secret:'INVOICE'}],
    employees:[{secret:'EMPLOYEE'}],billings:[{secret:'OTHER_SOURCE'}]}};
  return {row,doc,liveSources:doc.sourceSnapshots.map((document,i)=>({document:deep(document),settlement:deep(doc.settlementSnapshots[i])})),request:{documentId:doc.id,revision:1,expectedSyncVersion:'321'},
    identity:{fakeIssuerVerified:true,sessionActive:true,aal:'aal2',userId:'fake-user-a'},
    acl:{active:true,role:'owner',documentAllowed:true},
    approval:{reviewStatus:'approved',revision:1,syncVersion:'321',digest:dataHash(doc),publicNoteReviewed:true}};
}
function scenario(mutator=()=>{}){
  const f=fixture();mutator(f);
  let reads=0;
  const gateway=fakeGateway({trustedSource:async()=>{reads++;return deep(f.row)},
    trustedIdentity:async()=>deep(f.identity),trustedAcl:async()=>deep(f.acl),trustedApproval:async()=>deep(f.approval),
    trustedIndexer:async()=>({sources:deep(f.liveSources)})});
  return {f,reads:()=>reads,run:(request=f.request)=>gateway(request)};
}
async function denied(fn,code){await assert.rejects(fn,err=>err?.code===code,`expected ${code}`)}
test('approved same-company target zone returns one explicitly allowed public shape',async()=>{
  const s=scenario(),out=await s.run();
  assert.equal(out.public.project,'虛構工程 A 區');assert.equal(out.public.customer,'虛構建商');
  assert.equal(out.public.lines[0].item,'地板修繕');assert.equal(out.public.lines[0].amount,2000);
  assert.deepEqual(Object.keys(out.public).sort(),['customer','date','lines','project','publicNote','schema','taxMode','totals'].sort());
  assert.equal(out.public.totals.grossTotal,2000);assert.equal(s.reads(),2);
  assert.equal(out.handoff.sourceSyncVersion,'321');
});
test('never exports source invoices, other zone, payroll, bank, employee or internal notes',async()=>{
  const out=await scenario().run(),plain=JSON.stringify(out);
  for(const secret of ['fake-bill-b','虛構工程 B 區','PRIVATE-INVOICE','privateRemark','payroll','bankTransactions','internalAudit','employeeCommission','bankTransaction','history','originalLines','合併編排'])assert.equal(plain.includes(secret),false,secret);
});
test('only document identifiers and versions accepted from request: no JSONB snapshots',async()=>{
  const s=scenario();await denied(()=>s.run({...s.f.request,data:s.f.row.data}),'REQUEST_NOT_DOCUMENT_ONLY');
});
test('client cannot supply fake auth role or ACL in request',async()=>{const s=scenario();await denied(()=>s.run({...s.f.request,role:'owner'}),'REQUEST_NOT_DOCUMENT_ONLY')});
test('document must exist once',async()=>{const s=scenario();await denied(()=>s.run({...s.f.request,documentId:'foreign'}),'DOCUMENT_NOT_UNIQUE')});
test('duplicate doc id rejected',async()=>{const s=scenario(f=>f.row.data.meta.externalBillingDocuments.push(deep(f.doc)));await denied(()=>s.run(),'DOCUMENT_NOT_UNIQUE')});
test('stale sync_version rejected',async()=>{const s=scenario();await denied(()=>s.run({...s.f.request,expectedSyncVersion:'320'}),'SOURCE_STALE')});
test('noncanonical invalid version rejected',async()=>{const s=scenario();await denied(()=>s.run({...s.f.request,expectedSyncVersion:'0321'}),'VERSION_INVALID')});
test('stale revision rejected',async()=>{const s=scenario();await denied(()=>s.run({...s.f.request,revision:2}),'DOCUMENT_REVISION_MISMATCH')});
test('unapproved draft not delivered',async()=>{const s=scenario(f=>f.doc.status='draft');await denied(()=>s.run(),'DOCUMENT_NOT_ACTIVE')});
test('archived document does not enter new gateway, existing legacy display untouched',async()=>{const s=scenario(f=>f.doc.status='archived');await denied(()=>s.run(),'DOCUMENT_NOT_ACTIVE')});
test('v1 historical/section-only document must use untouched legacy print path',async()=>{const s=scenario(f=>f.doc.schema='kushe-external-billing-group-v1');await denied(()=>s.run(),'ONLY_V2_CURRENT_SUPPORTED')});
test('fake unsigned identity rejected',async()=>{const s=scenario(f=>f.identity.fakeIssuerVerified=false);await denied(()=>s.run(),'AUTH_REQUIRED')});
test('fake revoked session rejected',async()=>{const s=scenario(f=>f.identity.sessionActive=false);await denied(()=>s.run(),'AUTH_REQUIRED')});
test('fake AAL1 rejected',async()=>{const s=scenario(f=>f.identity.aal='aal1');await denied(()=>s.run(),'AUTH_REQUIRED')});
test('fake other-company member rejected',async()=>{const s=scenario(f=>f.acl.documentAllowed=false);await denied(()=>s.run(),'DOCUMENT_ACCESS_DENIED')});
test('fake employee role rejected',async()=>{const s=scenario(f=>f.acl.role='employee');await denied(()=>s.run(),'DOCUMENT_ACCESS_DENIED')});
test('fake membership revoked rejected',async()=>{const s=scenario(f=>f.acl.active=false);await denied(()=>s.run(),'DOCUMENT_ACCESS_DENIED')});
test('fake approval missing rejected',async()=>{const s=scenario(f=>f.approval.reviewStatus='pending_review');await denied(()=>s.run(),'APPROVAL_STALE')});
test('fake approval must bind source digest; invoice changes invalidate',async()=>{const s=scenario(f=>{f.doc.sourceSnapshots[1].invoiceNo='changed';f.liveSources[1].document.invoiceNo='changed'});await denied(()=>s.run(),'APPROVAL_STALE')});
test('edited public note invalidates saved fake approval',async()=>{const s=scenario(f=>f.doc.note='new note');await denied(()=>s.run(),'APPROVAL_STALE')});
test('unreviewed public note blocked',async()=>{const s=scenario(f=>f.approval.publicNoteReviewed=false);await denied(()=>s.run(),'APPROVAL_STALE')});
test('a new document revision cannot reuse old fake approval',async()=>{const s=scenario(f=>{f.doc.revision=2;f.request.revision=2});await denied(()=>s.run(),'APPROVAL_STALE')});
test('a new source sync version cannot reuse old fake approval',async()=>{const s=scenario(f=>{f.row.syncVersion='322';f.request.expectedSyncVersion='322'});await denied(()=>s.run(),'APPROVAL_STALE')});
test('source snapshots must match sourceIds order',async()=>{const s=scenario(f=>{f.doc.sourceSnapshots.reverse()});await denied(()=>s.run(),'SOURCE_LINK_INVALID')});
test('target original must be one of sources',async()=>{const s=scenario(f=>f.doc.targetBillingId='fake-bill-c');await denied(()=>s.run(),'TARGET_INVALID')});
test('cross customer source prevented',async()=>{const s=scenario(f=>f.doc.sourceSnapshots[1].customerId='fake-other');await denied(()=>s.run(),'CROSS_CUSTOMER_SOURCE')});
test('saved document cannot override newer current source billing facts',async()=>{
 const s=scenario(f=>{f.liveSources[0].document.anchors.grossTotal=1100});
 await denied(()=>s.run(),'CURRENT_SOURCE_DRIFT');
});
test('saved document cannot override newer current settlement facts',async()=>{
 const s=scenario(f=>{f.liveSources[0].settlement.outstanding=900});
 await denied(()=>s.run(),'CURRENT_SOURCE_DRIFT');
});
test('missing current billing source blocks new gateway',async()=>{
 const s=scenario(f=>{f.liveSources.pop()});await denied(()=>s.run(),'CURRENT_SOURCE_MISSING');
});
test('other zone may not masquerade as target project',async()=>{const s=scenario(f=>f.doc.displayProjectName='虛構工程 B 區');await denied(()=>s.run(),'TARGET_INVALID')});
test('original account subtotal mismatch blocks handoff',async()=>{const s=scenario(f=>f.doc.sourceSnapshots[0].anchors.grossTotal=1200);await denied(()=>s.run(),'FINANCE_INVALID')});
test('settlement drift blocks handoff',async()=>{const s=scenario(f=>f.doc.settlementSnapshots[0].outstanding=900);await denied(()=>s.run(),'SETTLEMENT_INVALID')});
test('stale stored consolidated totals block handoff',async()=>{const s=scenario(f=>f.doc.totals.grossTotal=999);await denied(()=>s.run(),'TOTALS_INVALID')});
test('unified line mismatch does not silently rebalance prices',async()=>{const s=scenario(f=>f.doc.unified.lines[0].amount=1999);await denied(()=>s.run(),'LINES_INVALID')});
test('unified total mismatch not silently corrected',async()=>{const s=scenario(f=>f.doc.unified.target=1000);await denied(()=>s.run(),'LINES_TOTAL_INVALID')});
test('read fence detects source mutation between two trusted reads',async()=>{
 const f=fixture();let reads=0;const g=fakeGateway({trustedSource:async()=>{reads++;if(reads===2)f.row.data.employees[0].secret='CHANGED';return deep(f.row)},trustedIdentity:async()=>f.identity,
  trustedAcl:async()=>f.acl,trustedApproval:async()=>f.approval,trustedIndexer:async()=>({sources:deep(f.liveSources)})});
 await denied(()=>g(f.request),'SOURCE_CHANGED_DURING_READ');
});
test('read-only bridge leaves fake business snapshot unchanged',async()=>{
 const s=scenario(),before=JSON.stringify(s.f.row);await s.run();assert.equal(JSON.stringify(s.f.row),before);
});
test('output contains no actual PDF bytes and is only data+fake handoff metadata',async()=>{
 const out=await scenario().run();assert.equal(Object.hasOwn(out,'pdf'),false);assert.equal(Object.hasOwn(out,'bytes'),false);
});
test('formal source contract is static checked when running within official repository',(t)=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const files=['assets/js/erp-store.js','assets/js/billing-groups.js','assets/js/cloud-sync.js','assets/js/external-billing-print.js'];
 if(!files.every(f=>fs.existsSync(path.join(root,f)))){t.skip('Formal GitHub repository checkout unavailable in local offline workspace');return;}
 const store=fs.readFileSync(path.join(root,files[0]),'utf8'),groups=fs.readFileSync(path.join(root,files[1]),'utf8');
 const cloud=fs.readFileSync(path.join(root,files[2]),'utf8'),out=fs.readFileSync(path.join(root,files[3]),'utf8');
 for(const token of ['state.meta.externalBillingDocuments=next','function externalBillingDocumentIndex()','sourceSnapshots:ctx.sources.map','settlementSnapshots:ctx.sources.map'])assert.ok(store.includes(token),token);
 assert.ok(groups.includes('function printSaved(id,revision=0,historyOnly=false)'));
 assert.ok(groups.includes("store.getState().billings.find("));
 assert.ok(cloud.includes('/rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version'));
 assert.ok(out.includes("const mergedBillingProjects=[String(d.displayProjectName||'').trim()]"));
});
