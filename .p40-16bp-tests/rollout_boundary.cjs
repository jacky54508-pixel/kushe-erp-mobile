'use strict';
// P40-16BP isolated pure simulation. Not linked to ERP/Supabase/real customer PDF.
// Owner has NOT approved the proposed policy or a self-review exception.
const {createHash}=require('node:crypto');
const freeze=o=>Object.freeze(o);
const blocked=(code)=>freeze({status:'BLOCKED',code,actualApproval:false,canDeploy:false,canWrite:false});
const legacy=(route)=>freeze({status:'LEGACY_ROUTE_UNCHANGED',route,actualApproval:false,canDeploy:false,canWrite:false});
const isText=s=>typeof s==='string'&&s.length>0&&s.length<201;
const isObj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const number=n=>Number.isSafeInteger(n)&&n>=0;
const exactHash=(doc)=>{
  if(!isObj(doc)||!isText(doc.companyId)||!isText(doc.documentId)||!isText(doc.targetBillingId)||!isText(doc.customerId)
    ||!number(doc.revision)||doc.revision===0||!number(doc.syncVersion)||doc.syncVersion===0
    ||!isText(doc.sourceDigest)||!isText(doc.settlementDigest)||!isText(doc.invoiceDigest)
    ||(typeof doc.publicNote!=='string'||doc.publicNote.length>2000)||!isObj(doc.anchors)||!Array.isArray(doc.lines)||doc.lines.length===0||doc.lines.length>300)
    throw Error('DOCUMENT_INVALID');
  const money=['untaxed','tax','grossTotal','retention','receivable'];
  if(money.some(k=>!number(doc.anchors[k]))||doc.anchors.untaxed+doc.anchors.tax!==doc.anchors.grossTotal||doc.anchors.grossTotal-doc.anchors.retention!==doc.anchors.receivable)
    throw Error('ANCHORS_INVALID');
  if(doc.lines.some(l=>!isObj(l)||!isText(l.item)||!isText(l.unit)||typeof l.house!=='string'||typeof l.qty!=='number'||l.qty<=0||typeof l.price!=='number'||l.price<0||!number(l.amount)||Math.round(l.qty*l.price)!==l.amount))
    throw Error('LINES_INVALID');
  // Explicit allowlist: never hash or publish unrelated payroll, bank, employee or original invoice numbers.
  const locked={companyId:doc.companyId,documentId:doc.documentId,targetBillingId:doc.targetBillingId,customerId:doc.customerId,
    revision:doc.revision,syncVersion:doc.syncVersion,sourceDigest:doc.sourceDigest,settlementDigest:doc.settlementDigest,invoiceDigest:doc.invoiceDigest,
    publicNote:doc.publicNote,anchors:money.map(k=>doc.anchors[k]),lines:doc.lines.map(l=>[l.house,l.item,l.unit,l.qty,l.price,l.amount])};
  return createHash('sha256').update(JSON.stringify(locked)).digest('hex');
};
const ROUTES=freeze(['existing-single-print','existing-current-merged-print','existing-historical-print','existing-billing-save','existing-daily-construction-save','existing-payroll-save']);
function decide({route,policy,doc,actor,reviewer,evidence}={}) {
  // The prototype has no router hook: this LEGACY status only documents intended noninterference.
  if(ROUTES.includes(route))return legacy(route);
  if(route!=='new-external-document-approval')return blocked('UNKNOWN_ROUTE');
  if(!isObj(policy)||policy.ownerSelected!==true||policy.mode!=='OWNER_REVIEW_SELF_DENIED'||policy.fakeOnly!==true||policy.selfReviewEnabled!==false)
    return blocked('OWNER_POLICY_NOT_SELECTED');
  if(!isObj(doc)||doc.status!=='active'||doc.current!==true||doc.historical||doc.legacy)return blocked('NEW_ACTIVE_DOCUMENTS_ONLY');
  if(!isObj(actor)||!isObj(reviewer)||!isObj(evidence))return blocked('MISSING_EVIDENCE');
  if(!isText(actor.id)||!isText(reviewer.id)||actor.id===reviewer.id)return blocked('NO_SELF_REVIEW');
  if(actor.companyId!==doc.companyId||reviewer.companyId!==doc.companyId||!['owner','admin','accounting'].includes(actor.role)||reviewer.role!=='owner')return blocked('REVIEWER_OR_COMPANY_DENIED');
  if(evidence.mockTrustedSource!==true||evidence.mockVerifiedSession!==true||evidence.mockSessionCurrent!==true||evidence.mockAal!=='aal2'||evidence.mockCompanyActive!==true||evidence.mockDocumentAcl!==true||evidence.mockDurableRevisionAudit!==true)return blocked('MOCK_AUTHZ_EVIDENCE_INCOMPLETE');
  if(evidence.companyId!==doc.companyId||evidence.documentId!==doc.documentId||evidence.targetBillingId!==doc.targetBillingId||evidence.revision!==doc.revision||evidence.syncVersion!==doc.syncVersion)return blocked('DOCUMENT_BINDING_MISMATCH');
  let digest;try{digest=exactHash(doc)}catch(_){return blocked('DOCUMENT_INVALID')}
  if(evidence.docDigest!==digest)return blocked('DOCUMENT_CHANGED');
  if(evidence.finalReadDigest!==digest)return blocked('FINAL_READ_CHANGED');
  return freeze({status:'FAKE_ELIGIBLE_FOR_REVIEW_ONLY',code:'SIMULATION_NO_REAL_APPROVAL',actualApproval:false,canDeploy:false,canWrite:false,documentId:doc.documentId,revision:doc.revision});
}
module.exports=freeze({decide,exactHash,ROUTES});
