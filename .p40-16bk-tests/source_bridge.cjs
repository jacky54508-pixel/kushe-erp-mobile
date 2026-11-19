'use strict';
/* P40-16BK: ISOLATED MODEL ONLY. Never ship as a production handler.
 * The injected `trustedSource` and `trustedIdentity` are FAKE trusted-side objects.
 * They are not derived from untrusted client JSON, and are NOT a real authority.
 */
const {createHash} = require('node:crypto');
const safeClone = x => structuredClone(x);
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
class Denied extends Error {constructor(code){super(code);this.name='Denied';this.code=code}}
function fail(code){throw new Denied(code)}
function assert(c,code){if(!c)fail(code)}
function money(v){assert(Number.isSafeInteger(v)&&v>=0,'FINANCE_INVALID');return v}
function version(v){assert(typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&BigInt(v)<=9223372036854775807n,'VERSION_INVALID');return v}
function plain(v,max,required=true){assert(typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),'TEXT_INVALID');return v}
function dataHash(document){
  // Approval binds all source-sensitive material, including invoices/settlements
  // which are *never* exported to customer-facing projection.
  return hash({id:document.id,companyId:document.companyId,status:document.status,revision:document.revision,
    sourceIds:document.sourceIds,targetBillingId:document.targetBillingId,sourceSnapshots:document.sourceSnapshots,
    settlementSnapshots:document.settlementSnapshots,totals:document.totals,unified:document.unified,
    customerId:document.customerId,customerName:document.customerName,displayProjectName:document.displayProjectName,
    documentDate:document.documentDate,note:document.note});
}
function signedSnapshotKey(row){return hash({syncVersion:row.syncVersion,data:row.data})}
const amountFields=['untaxed','tax','grossTotal','retention','receivable'];
const settlementFields=['received','outstanding','retentionReceived','retentionOutstanding','pendingCheque','availableToCollect'];
function snapshotDocument(row,request){
  assert(row&&typeof row==='object'&&row.data?.meta?.externalBillingDocuments&&Array.isArray(row.data.meta.externalBillingDocuments),'SOURCE_UNAVAILABLE');
  assert(version(row.syncVersion)===version(request.expectedSyncVersion),'SOURCE_STALE');
  const documents=row.data.meta.externalBillingDocuments.filter(d=>d&&d.id===request.documentId);
  assert(documents.length===1,'DOCUMENT_NOT_UNIQUE');
  const d=documents[0];
  assert(d.schema==='kushe-external-billing-group-v2'&&d.detailMode==='unified'&&d.sections===undefined,'ONLY_V2_CURRENT_SUPPORTED');
  assert(d.status==='active','DOCUMENT_NOT_ACTIVE');
  assert(Number.isSafeInteger(d.revision)&&d.revision>0&&d.revision===request.revision,'DOCUMENT_REVISION_MISMATCH');
  assert(Array.isArray(d.sourceIds)&&d.sourceIds.length>=2&&d.sourceIds.length<=30&&new Set(d.sourceIds).size===d.sourceIds.length,'SOURCES_INVALID');
  assert(d.sourceIds.every(x=>typeof x==='string'&&x.length>0),'SOURCES_INVALID');
  assert(d.sourceIds.includes(d.targetBillingId),'TARGET_INVALID');
  assert(Array.isArray(d.sourceSnapshots)&&Array.isArray(d.settlementSnapshots)&&d.sourceSnapshots.length===d.sourceIds.length&&d.settlementSnapshots.length===d.sourceIds.length,'SNAPSHOT_INVALID');
  const sum=Object.fromEntries([...amountFields,...settlementFields].map(k=>[k,0]));
  for(let i=0;i<d.sourceIds.length;i++){
    const s=d.sourceSnapshots[i],p=d.settlementSnapshots[i];
    assert(s&&p&&s.billingId===d.sourceIds[i]&&p.billingId===d.sourceIds[i],'SOURCE_LINK_INVALID');
    assert(s.customerId===d.customerId,'CROSS_CUSTOMER_SOURCE');
    const a=s.anchors;
    assert(a&&typeof a==='object','FINANCE_INVALID');
    for(const key of amountFields){sum[key]+=money(a[key]);assert(Number.isSafeInteger(sum[key]),'FINANCE_INVALID')}
    for(const key of settlementFields){sum[key]+=money(p[key]);assert(Number.isSafeInteger(sum[key]),'FINANCE_INVALID')}
    assert(a.untaxed+a.tax===a.grossTotal&&a.grossTotal-a.retention===a.receivable,'FINANCE_INVALID');
    assert(p.outstanding+p.received===a.receivable&&p.retentionOutstanding+p.retentionReceived===a.retention&&p.availableToCollect+p.pendingCheque===p.outstanding,'SETTLEMENT_INVALID');
  }
  const target=d.sourceSnapshots.filter(x=>x.billingId===d.targetBillingId);
  assert(target.length===1&&plain(d.displayProjectName,200)===plain(target[0].projectName,200),'TARGET_INVALID');
  assert(d.customerName===target[0].customerName,'CUSTOMER_INVALID');
  for(const key of [...amountFields,...settlementFields])assert(money(d.totals?.[key])===sum[key],'TOTALS_INVALID');
  const u=d.unified;
  assert(u&&['未稅','含稅'].includes(u.taxMode)&&Array.isArray(u.lines)&&u.lines.length>0&&u.lines.length<=300,'LINES_INVALID');
  const expected=u.taxMode==='未稅'?sum.untaxed:sum.grossTotal;
  let total=0;
  const lines=u.lines.map(l=>{
    assert(l&&typeof l==='object','LINES_INVALID');
    const house=plain(l.house,100,false),item=plain(l.item,200),unit=plain(l.unit,20);
    assert(Number.isFinite(l.qty)&&l.qty>0&&l.qty<=1e10&&Math.abs(l.qty*10000-Math.round(l.qty*10000))<0.001,'LINES_INVALID');
    assert(Number.isFinite(l.price)&&l.price>=0&&l.price<=1e10&&Math.abs(l.price*10000-Math.round(l.price*10000))<0.001,'LINES_INVALID');
    assert(money(l.amount)===Math.round(l.qty*l.price),'LINES_INVALID');
    total+=l.amount;assert(Number.isSafeInteger(total),'LINES_INVALID');
    // No spread: private nested metadata, invoice numbers and original-source refs disappear.
    return {house,item,unit,qty:l.qty,price:l.price,amount:l.amount};
  });
  assert(total===expected&&u.total===total&&u.target===expected,'LINES_TOTAL_INVALID');
  plain(d.customerName,200);plain(d.documentDate,10);plain(d.note,2000,false);
  // A reviewed note flag in FAKE approval does not automatically sanitize text.
  const publicData={schema:'kushe-customer-billing-projection-lab-v1',project:d.displayProjectName,
    customer:d.customerName,date:d.documentDate,taxMode:u.taxMode,lines,
    totals:Object.fromEntries(amountFields.map(k=>[k,sum[k]])),publicNote:d.note};
  return {d,publicData,digest:dataHash(d)};
}
function fakeGateway({trustedSource,trustedIdentity,trustedAcl,trustedApproval,trustedIndexer}){
  // All dependencies are injected by the FAKE test host. No real Supabase access.
  return async function getOne(request){
    assert(request&&typeof request==='object'&&!Array.isArray(request)&&Object.keys(request).sort().join(',')==='documentId,expectedSyncVersion,revision','REQUEST_NOT_DOCUMENT_ONLY');
    plain(request.documentId,200);assert(Number.isSafeInteger(request.revision)&&request.revision>0,'DOCUMENT_REVISION_MISMATCH');
    version(request.expectedSyncVersion);
    const identity=await trustedIdentity();
    assert(identity&&identity.fakeIssuerVerified===true&&identity.sessionActive===true&&identity.aal==='aal2'&&typeof identity.userId==='string','AUTH_REQUIRED');
    const first=await trustedSource();
    const {d,publicData,digest}=snapshotDocument(first,request);
    // This MUST eventually be implemented using the real server-authorized ERP
    // current source resolver in the same trusted database snapshot.  In the
    // isolated lab `trustedIndexer` simply supplies FAKE normalized current facts.
    assert(typeof trustedIndexer==='function','INDEXER_UNAVAILABLE');
    const live=await trustedIndexer(first.data,d.sourceIds);
    assert(live&&Array.isArray(live.sources)&&live.sources.length===d.sourceIds.length,'CURRENT_SOURCE_MISSING');
    const liveDocs=live.sources.map(s=>s.document),liveSettlements=live.sources.map(s=>s.settlement);
    assert(hash(liveDocs)===hash(d.sourceSnapshots)&&hash(liveSettlements)===hash(d.settlementSnapshots),'CURRENT_SOURCE_DRIFT');
    const m=await trustedAcl(identity.userId,d.companyId,d.id);
    assert(m?.active===true&&['owner','admin','accounting'].includes(m?.role)&&m?.documentAllowed===true,'DOCUMENT_ACCESS_DENIED');
    const approval=await trustedApproval(d.id);
    assert(approval?.reviewStatus==='approved'&&approval?.revision===d.revision&&approval?.syncVersion===first.syncVersion&&approval?.digest===digest&&approval?.publicNoteReviewed===true,'APPROVAL_STALE');
    // Simulate pre-handoff revalidation. Real atomic read/handoff must be built in
    // a properly authorized server/database transaction; this is NOT that proof.
    const second=await trustedSource();
    assert(first.syncVersion===second.syncVersion&&signedSnapshotKey(first)===signedSnapshotKey(second),'SOURCE_CHANGED_DURING_READ');
    return {handoff:{documentId:d.id,revision:d.revision,sourceSyncVersion:first.syncVersion,
      candidateDigest:hash({digest,publicData})},public:publicData};
  }
}
module.exports={Denied,fakeGateway,dataHash,snapshotDocument,signedSnapshotKey};
