'use strict';
/* P40-16BL FAKE-ONLY lab. Not a production adapter/migration; no Supabase access. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {readFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
const anchors=(untaxed,tax,retention)=>({untaxed,tax,grossTotal:untaxed+tax,retention,receivable:untaxed+tax-retention});
const settlement=(billingId,a,received=0)=>({billingId,received,outstanding:a.receivable-received,retentionReceived:0,retentionOutstanding:a.retention,pendingCheque:0,availableToCollect:a.receivable-received});
const a=anchors(1000,50,105),b=anchors(2000,100,210);
const sourceA={billingId:'fake-A',customerId:'fake-C',projectName:'目標 M 區',anchors:a,invoiceNo:'FAKE-INVOICE-A',invoiceStatus:'invoiced',originalLines:[]};
const sourceB={billingId:'fake-B',customerId:'fake-C',projectName:'其他 L 區',anchors:b,invoiceNo:'FAKE-INVOICE-B',invoiceStatus:'invoiced',originalLines:[]};
const makeState=()=>({
  meta:{externalBillingDocuments:[{id:'fake-D',schema:'kushe-external-billing-group-v2',status:'active',revision:1,sourceIds:['fake-A','fake-B'],targetBillingId:'fake-A',customerName:'虛構建商',displayProjectName:'目標 M 區',documentDate:'2026-11-19',note:'對外施工備註',sourceSnapshots:[clone(sourceA),clone(sourceB)],settlementSnapshots:[settlement('fake-A',a),settlement('fake-B',b)],totals:{untaxed:3000,tax:150,grossTotal:3150,retention:315,receivable:2835,received:0,outstanding:2835,retentionReceived:0,retentionOutstanding:315,pendingCheque:0,availableToCollect:2835},detailMode:'unified',unified:{taxMode:'未稅',lines:[{house:'1A',item:'修補施工',unit:'式',qty:3,price:1000,amount:3000}],reason:'內部重編原因'}}]},
  fakeCurrentDocuments:[clone(sourceA),clone(sourceB)],
  fakeCurrentSettlements:[settlement('fake-A',a),settlement('fake-B',b)],
  payroll:[{employee:'虛構員工',amount:567}],bankTransactions:[{account:'FAKE BANK ACCOUNT'}],internalNote:'公司內部備註',
  customers:[{id:'fake-C',name:'虛構建商'}]
});
function sum(xs,key){return xs.reduce((s,x)=>s+x[key],0)}
function normalizedDoc(current,doc){
 if(!doc || typeof doc.id!=='string'||!doc.id || doc.schema!=='kushe-external-billing-group-v2' || doc.status!=='active'||!Number.isSafeInteger(doc.revision)||doc.revision<1)throw Error('DOC_NOT_ACTIVE');
 const ids=doc.sourceIds;
 if(!Array.isArray(ids)||ids.length<2||ids.length>30||new Set(ids).size!==ids.length||!ids.includes(doc.targetBillingId))throw Error('INVALID_SOURCES');
 if(!Array.isArray(doc.sourceSnapshots)||doc.sourceSnapshots.length!==ids.length || !Array.isArray(doc.settlementSnapshots)||doc.settlementSnapshots.length!==ids.length)throw Error('MISSING_SNAPSHOTS');
 for(let i=0;i<ids.length;i++){
  const s=doc.sourceSnapshots[i],p=doc.settlementSnapshots[i];
  if(s.billingId!==ids[i]||p.billingId!==ids[i]||s.customerId!==doc.sourceSnapshots[0].customerId)throw Error('SOURCE_ID_MISMATCH');
  const live=current.fakeCurrentDocuments.filter(x=>x.billingId===ids[i]);
  const settlementLive=current.fakeCurrentSettlements.filter(x=>x.billingId===ids[i]);
  if(live.length!==1||settlementLive.length!==1||hash(live[0])!==hash(s)||hash(settlementLive[0])!==hash(p))throw Error('LIVE_SOURCE_DRIFT');
  const aa=s.anchors;
  if(!aa || !Object.values(aa).every(Number.isSafeInteger)||aa.untaxed+aa.tax!==aa.grossTotal||aa.grossTotal-aa.retention!==aa.receivable||p.received+p.outstanding!==aa.receivable||p.retentionReceived+p.retentionOutstanding!==aa.retention||p.availableToCollect+p.pendingCheque!==p.outstanding)throw Error('FINANCIAL_MISMATCH');
 }
 const ss=doc.sourceSnapshots.map(x=>x.anchors),ps=doc.settlementSnapshots,t=doc.totals;
 for(const k of ['untaxed','tax','grossTotal','retention','receivable'])if(sum(ss,k)!==t[k])throw Error('TOTALS_INVALID');
 for(const k of ['received','outstanding','retentionReceived','retentionOutstanding','pendingCheque','availableToCollect'])if(sum(ps,k)!==t[k])throw Error('SETTLEMENT_INVALID');
 if(doc.displayProjectName!==doc.sourceSnapshots.find(s=>s.billingId===doc.targetBillingId)?.projectName)throw Error('TARGET_ZONE_INVALID');
 const u=doc.unified;
 if(doc.detailMode!=='unified'||!u||u.taxMode!=='未稅'||!Array.isArray(u.lines)||u.lines.length===0||u.lines.length>300)throw Error('UNSUPPORTED_DETAILS');
 const lines=u.lines.map(l=>{
  if(!l||typeof l.house!=='string'||typeof l.item!=='string'||!l.item||typeof l.unit!=='string'||!Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.price)||l.price<0||!Number.isSafeInteger(l.amount)||Math.round(l.qty*l.price)!==l.amount)throw Error('INVALID_LINE');
  return Object.fromEntries(['house','item','unit','qty','price','amount'].map(k=>[k,l[k]]));
 });
 if(sum(lines,'amount')!==t.untaxed)throw Error('LINE_TOTAL_INVALID');
 const publicDoc={customer:doc.customerName,project:doc.displayProjectName,date:doc.documentDate,publicNote:doc.note,taxMode:u.taxMode,lines,totals:Object.fromEntries(['untaxed','tax','grossTotal','retention','receivable'].map(k=>[k,t[k]]))};
 const fingerprint=hash({id:doc.id,revision:doc.revision,target:doc.targetBillingId,sources:doc.sourceSnapshots,settlements:doc.settlementSnapshots,totals:doc.totals,unified:doc.unified,publicNote:doc.note,displayProjectName:doc.displayProjectName,customerName:doc.customerName,documentDate:doc.documentDate});
 return {publicDoc,fingerprint};
}
function makeLab(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE source(company TEXT PRIMARY KEY, version INTEGER NOT NULL, snapshot TEXT NOT NULL);
 CREATE TABLE projection(company TEXT, id TEXT, revision INTEGER, sync_version INTEGER, status TEXT NOT NULL, fingerprint TEXT, public_json TEXT, PRIMARY KEY(company,id));
 CREATE TABLE approvals(company TEXT, id TEXT, revision INTEGER, fingerprint TEXT, reviewer TEXT, PRIMARY KEY(company,id,revision,fingerprint));
 CREATE TABLE audit(event_no INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, source_version INTEGER NOT NULL, prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL);`);
 const log=(type,v)=>{const row=db.prepare('SELECT event_hash FROM audit ORDER BY event_no DESC LIMIT 1').get();const prev=row?.event_hash||'GENESIS';db.prepare('INSERT INTO audit(event_type,source_version,prev_hash,event_hash) VALUES (?,?,?,?)').run(type,v,prev,hash({type,v,prev}));};
 const row=()=>db.prepare('SELECT version,snapshot FROM source WHERE company=?').get('FAKE_CO');
 function publish(snapshot,expectedVersion,failpoint=''){
  db.exec('BEGIN IMMEDIATE');
  try{
   if(!snapshot||typeof snapshot!=='object')throw Error('TRUSTED_SNAPSHOT_REQUIRED');
   const current=row(); if(current?(current.version!==expectedVersion):(expectedVersion!==0))throw Error('SYNC_CAS_CONFLICT');
   const version=expectedVersion+1;
   if(current)db.prepare('UPDATE source SET version=?,snapshot=? WHERE company=?').run(version,JSON.stringify(snapshot),'FAKE_CO');
   else db.prepare('INSERT INTO source VALUES (?,?,?)').run('FAKE_CO',version,JSON.stringify(snapshot));
   if(failpoint==='before_projections')throw Error('SIMULATED_DB_FAILURE');
   const docs=snapshot?.meta?.externalBillingDocuments;
   const rows=Array.isArray(docs)?docs:[];
   db.prepare('DELETE FROM projection WHERE company=?').run('FAKE_CO');
   let failed=0;
   const seen=new Set();
   for(const d of rows){
    const documentId=String(d?.id||'');
    if(seen.has(documentId)){
      db.prepare("UPDATE projection SET status='BLOCKED_STALE',fingerprint=NULL,public_json=NULL WHERE company=? AND id=?").run('FAKE_CO',documentId);
      failed++;
      continue;
    }
    seen.add(documentId);
    let result=null,status='READY';
    try{result=normalizedDoc(snapshot,d)}catch(_){status='BLOCKED_STALE';failed++}
    db.prepare('INSERT INTO projection VALUES (?,?,?,?,?,?,?)').run('FAKE_CO',documentId,d?.revision||0,version,status,result?.fingerprint||null,result?JSON.stringify(result.publicDoc):null);
   }
   if(!Array.isArray(docs))failed++;
   if(failpoint==='before_commit')throw Error('SIMULATED_DB_FAILURE');
   log('TRUSTED_FAKE_CAS',version);
   db.exec('COMMIT');
   return {version,blocked:failed};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function approve({docId='fake-D',reviewer='fake-owner'}={}){
  const r=db.prepare('SELECT * FROM projection WHERE company=? AND id=?').get('FAKE_CO',docId);
  if(!r||r.status!=='READY')throw Error('DOCUMENT_NOT_READY');
  db.prepare('INSERT OR REPLACE INTO approvals VALUES (?,?,?,?,?)').run('FAKE_CO',docId,r.revision,r.fingerprint,reviewer);log('FAKE_REVIEW',r.sync_version);return r;
 }
 function read(request,authority){
  if(Object.keys(request).some(k=>!['docId','targetZone','revision','expectedSyncVersion'].includes(k)))throw Error('FORBIDDEN_REQUEST_FIELDS');
  if(!authority||authority.issuerVerified!==true||authority.sessionActive!==true||authority.aal!=='aal2'||authority.company!=='FAKE_CO'||!['owner','admin','accounting'].includes(authority.role)||!authority.allowedIds?.includes(request.docId))throw Error('UNAUTHORIZED');
  db.exec('BEGIN');
  try{
   const source=row(),doc=db.prepare('SELECT * FROM projection WHERE company=? AND id=?').get('FAKE_CO',request.docId);
   if(!source||!doc||doc.status!=='READY'||doc.sync_version!==source.version||request.expectedSyncVersion!==source.version||request.revision!==doc.revision)throw Error('STALE_OR_BLOCKED');
   const approval=db.prepare('SELECT * FROM approvals WHERE company=? AND id=? AND revision=? AND fingerprint=?').get('FAKE_CO',request.docId,doc.revision,doc.fingerprint);
   if(!approval)throw Error('APPROVAL_REQUIRED');
   const payload=JSON.parse(doc.public_json);
   if(payload.project!==request.targetZone)throw Error('TARGET_MISMATCH');
   const sourceSnapshot=JSON.parse(source.snapshot);
   const official=sourceSnapshot.meta?.externalBillingDocuments?.find(x=>x.id===request.docId);
   const checked=normalizedDoc(sourceSnapshot,official);
   if(checked.fingerprint!==doc.fingerprint||hash(checked.publicDoc)!==hash(payload))throw Error('SOURCE_MISMATCH');
   db.exec('COMMIT');return payload;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function inspect(){return {source:row(),doc:db.prepare('SELECT * FROM projection WHERE company=? AND id=?').get('FAKE_CO','fake-D'),approvals:db.prepare('SELECT * FROM approvals').all(),audit:db.prepare('SELECT * FROM audit ORDER BY event_no').all()}}
 return {publish,approve,read,inspect,close:()=>db.close()};
}
const owner={issuerVerified:true,sessionActive:true,aal:'aal2',company:'FAKE_CO',role:'owner',allowedIds:['fake-D']};
const req=(v=1,revision=1)=>({docId:'fake-D',targetZone:'目標 M 區',revision,expectedSyncVersion:v});
function prepared(){const lab=makeLab();lab.publish(makeState(),0);lab.approve();return lab;}
// These are LOCAL FAKE tests, not live JWT/PostgREST or a production schema migration.
test('can publish one validated synthetic document',()=>{const l=prepared(),x=l.inspect();assert.equal(x.source.version,1);assert.equal(x.doc.status,'READY');l.close()});
test('returns only intended public fields and target M zone',()=>{const l=prepared(),x=l.read(req(),owner);assert.equal(x.project,'目標 M 區');assert.deepEqual(Object.keys(x).sort(),['customer','date','lines','project','publicNote','taxMode','totals'].sort());assert.equal(x.lines.length,1);l.close()});
test('does not expose other zone, invoices, salary, banks, internal rework reason',()=>{const l=prepared(),x=JSON.stringify(l.read(req(),owner));for(const term of ['其他 L 區','FAKE-INVOICE-A','FAKE-INVOICE-B','虛構員工','FAKE BANK ACCOUNT','內部重編原因','fake-A','fake-B','公司內部備註'])assert.ok(!x.includes(term),term);l.close()});
test('rejects browser-sent role, snapshots, approvals and custom payload',()=>{const l=prepared();for(const key of ['role','snapshot','approved','publicProjection'])assert.throws(()=>l.read({...req(),[key]:'unsafe'},owner),/FORBIDDEN/);l.close()});
test('fails when verified issuer missing',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,issuerVerified:false}),/UNAUTHORIZED/);l.close()});
test('fails on inactive session',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,sessionActive:false}),/UNAUTHORIZED/);l.close()});
test('fails without aal2',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,aal:'aal1'}),/UNAUTHORIZED/);l.close()});
test('fails on different company',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,company:'FAKE_OTHER'}),/UNAUTHORIZED/);l.close()});
test('fails without document ACL',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,allowedIds:[]}),/UNAUTHORIZED/);l.close()});
test('fails for employee even if ACL exists',()=>{const l=prepared();assert.throws(()=>l.read(req(),{...owner,role:'employee'}),/UNAUTHORIZED/);l.close()});
test('fails mismatched target zone',()=>{const l=prepared();assert.throws(()=>l.read({...req(),targetZone:'其他 L 區'},owner),/TARGET_MISMATCH/);l.close()});
test('fails stale client sync version',()=>{const l=prepared();assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('unrelated payroll edit keeps document approval, current sync fence updated',()=>{const l=prepared(),s=makeState();s.payroll[0].amount=1001;let x=l.publish(s,1);assert.equal(x.blocked,0);assert.equal(l.inspect().doc.sync_version,2);assert.deepEqual(l.read(req(2),owner).totals,{untaxed:3000,tax:150,grossTotal:3150,retention:315,receivable:2835});l.close()});
test('unrelated bank edit keeps document approval and never leaks private bank',()=>{const l=prepared(),s=makeState();s.bankTransactions.push({account:'PRIVATE BANK NO'});l.publish(s,1);assert.ok(!JSON.stringify(l.read(req(2),owner)).includes('PRIVATE BANK'));l.close()});
test('receipt changes committed to fake source but blocks only the document, no stale new PDF',()=>{const l=prepared(),s=makeState();s.fakeCurrentSettlements[0].received=1;s.fakeCurrentSettlements[0].outstanding=944;s.fakeCurrentSettlements[0].availableToCollect=944;const x=l.publish(s,1);assert.equal(x.blocked,1);assert.equal(l.inspect().source.version,2);assert.equal(l.inspect().doc.status,'BLOCKED_STALE');assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('source invoice edit blocks projection until source document revalidated',()=>{const l=prepared(),s=makeState();s.fakeCurrentDocuments[0].invoiceNo='FAKE-CHANGED';assert.equal(l.publish(s,1).blocked,1);assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('when saved document snapshot matches updated receipt, reapproval is needed',()=>{const l=prepared(),s=makeState();s.fakeCurrentSettlements[0].received=1;s.fakeCurrentSettlements[0].outstanding=944;s.fakeCurrentSettlements[0].availableToCollect=944;s.meta.externalBillingDocuments[0].settlementSnapshots[0]=clone(s.fakeCurrentSettlements[0]);s.meta.externalBillingDocuments[0].totals.received=1;s.meta.externalBillingDocuments[0].totals.outstanding=2834;s.meta.externalBillingDocuments[0].totals.availableToCollect=2834;assert.equal(l.publish(s,1).blocked,0);assert.throws(()=>l.read(req(2),owner),/APPROVAL_REQUIRED/);l.approve();assert.equal(l.read(req(2),owner).project,'目標 M 區');l.close()});
test('document revision increment needs new approval',()=>{const l=prepared(),s=makeState();s.meta.externalBillingDocuments[0].revision=2;l.publish(s,1);assert.throws(()=>l.read(req(2,2),owner),/APPROVAL_REQUIRED/);l.approve();assert.ok(l.read(req(2,2),owner));l.close()});
test('old client version rejected even when projection unchanged',()=>{const l=prepared();l.publish(makeState(),1);assert.throws(()=>l.read(req(1),owner),/STALE_OR_BLOCKED/);l.close()});
test('fake trusted CAS rejects stale expected version without changing state',()=>{const l=prepared(),before=l.inspect();assert.throws(()=>l.publish(makeState(),0),/SYNC_CAS_CONFLICT/);assert.deepEqual(l.inspect(),before);l.close()});
test('transaction failure before projections rolls back source',()=>{const l=prepared(),before=l.inspect();assert.throws(()=>l.publish(makeState(),1,'before_projections'),/SIMULATED_DB_FAILURE/);assert.deepEqual(l.inspect(),before);l.close()});
test('transaction failure before commit rolls back both source and projection',()=>{const l=prepared(),before=l.inspect();assert.throws(()=>l.publish(makeState(),1,'before_commit'),/SIMULATED_DB_FAILURE/);assert.deepEqual(l.inspect(),before);l.close()});
test('invalid document does not prevent unrelated ERP source saving, but blocks PDF',()=>{const l=prepared(),s=makeState();s.meta.externalBillingDocuments[0].totals.grossTotal=5000;s.payroll.push({employee:'OTHER',amount:1});const result=l.publish(s,1);assert.equal(result.blocked,1);assert.equal(JSON.parse(l.inspect().source.snapshot).payroll.length,2);assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('fake audit events are chained but not claimed as cryptographic signatures',()=>{const l=prepared(),s=makeState();s.payroll[0].amount=333;l.publish(s,1);const history=l.inspect().audit;assert.equal(history.length,3);assert.equal(history[0].prev_hash,'GENESIS');for(let i=1;i<history.length;i++)assert.equal(history[i].prev_hash,history[i-1].event_hash);l.close()});
test('no PDF bytes: gateway returns JSON only, never claims a deliverable PDF',()=>{const l=prepared(),out=l.read(req(),owner);assert.ok(!Buffer.isBuffer(out));assert.equal(out.fileBytes,undefined);l.close()});
test('legacy / archive documents excluded from new projection, prior print path remains out of scope',()=>{const l=prepared(),s=makeState();s.meta.externalBillingDocuments[0].status='archived';assert.equal(l.publish(s,1).blocked,1);assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('duplicate fake document IDs block the document rather than core sync',()=>{const l=prepared(),s=makeState();s.meta.externalBillingDocuments.push(clone(s.meta.externalBillingDocuments[0]));const x=l.publish(s,1);assert.equal(x.blocked,1);assert.equal(l.inspect().source.version,2);assert.equal(l.inspect().doc.status,'BLOCKED_STALE');assert.throws(()=>l.read(req(2),owner),/STALE_OR_BLOCKED/);l.close()});
test('invalid zero quantity blocks document without rejecting unrelated ERP storage',()=>{const l=prepared(),s=makeState();s.meta.externalBillingDocuments[0].unified.lines[0].qty=0;const x=l.publish(s,1);assert.equal(x.blocked,1);assert.equal(l.inspect().source.version,2);l.close()});
test('source file drift protection: formal GitHub code shapes checked when available',()=>{const root=join(__dirname,'..');const names=['assets/js/cloud-sync.js','assets/js/billing-groups.js','assets/js/erp-store.js','assets/js/external-billing-print.js'];if(names.some(p=>!existsSync(join(root,p)))){if(process.env.CI==='true')assert.fail('Full official source checkout required');test.skip('Full official source checkout required in CI');return;}const files=names.map(n=>readFileSync(join(root,n),'utf8'));assert.ok(files[0].includes('/rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version'));assert.ok(files[0].includes('erp_state_cas_write_v2'));assert.ok(files[1].includes('function printSaved(id,revision=0,historyOnly=false)'));assert.ok(files[2].includes('state.meta.externalBillingDocuments=next'));assert.ok(files[3].includes('mergedBillingProjects=[String(d.displayProjectName'));});
