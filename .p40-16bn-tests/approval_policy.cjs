'use strict';
/* P40-16BN: pure, fake-only reviewer POLICY CANDIDATE contract.
 * NO Supabase access, no real approval, no ERP write or PDF generation.
 * All assumed issuer/session/company/ACL evidence is fake and injectable.
 */
const { createHash } = require('node:crypto');
const MODES=Object.freeze(['OWNER_ONLY_WITH_EXPLICIT_SELF_REVIEW_EXCEPTION','SEPARATE_MAKER_CHECKER_OWNER_OR_ADMIN']);
const block = code => Object.freeze({status:'BLOCKED', code, productionApproved:false, canDeploy:false, isRealApproval:false});
const plain = o => o && typeof o==='object' && !Array.isArray(o);
const valid = s => typeof s==='string' && s.trim().length>0;
const canonical = v => JSON.stringify(v);
function contentDigest(doc){
  if(!plain(doc)||!valid(doc.companyId)||!valid(doc.id)||!valid(doc.targetBillingId)||!
    Number.isSafeInteger(doc.revision)||doc.revision<1||!valid(doc.sourceDigest)||
    !valid(doc.receiptDigest)||!valid(doc.invoiceDigest)||!valid(doc.customerId)||
    !['active','draft','archived','historical'].includes(doc.status)||
    !Array.isArray(doc.publicLines)||!doc.publicLines.length||doc.publicLines.length>300||
    doc.publicLines.some(l=>!plain(l)||!valid(l.item)||!valid(l.unit)||typeof l.house!=='string'||
      !Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.price)||l.price<0||
      !Number.isSafeInteger(l.amount)||Math.round(l.qty*l.price)!==l.amount)||
    !plain(doc.money)||['untaxed','tax','grossTotal','retention','receivable'].some(k=>!Number.isSafeInteger(doc.money[k])||doc.money[k]<0)||
    doc.money.untaxed+doc.money.tax!==doc.money.grossTotal||doc.money.grossTotal-doc.money.retention!==doc.money.receivable||
    typeof doc.publicNote!=='string') throw new Error('FAKE_DOCUMENT_FORMAT_INVALID');
  const locked={companyId:doc.companyId,id:doc.id,revision:doc.revision,targetBillingId:doc.targetBillingId,customerId:doc.customerId,
    sourceDigest:doc.sourceDigest,receiptDigest:doc.receiptDigest,invoiceDigest:doc.invoiceDigest,
    publicLines:doc.publicLines.map(l=>({house:l.house,item:l.item,unit:l.unit,qty:l.qty,price:l.price,amount:l.amount})),
    money:{untaxed:doc.money.untaxed,tax:doc.money.tax,grossTotal:doc.money.grossTotal,retention:doc.money.retention,receivable:doc.money.receivable},
    publicNote:doc.publicNote};
  return createHash('sha256').update(canonical(locked)).digest('hex');
}
function candidateReview({policy,doc,editor,reviewer,evidence}={}){
  if(!plain(policy)||policy.status!=='SIMULATED_ONLY_NOT_OWNER_APPROVED'||!MODES.includes(policy.mode))return block('POLICY_UNDECIDED');
  if(!plain(evidence)||!plain(doc)||!plain(editor)||!plain(reviewer))return block('EVIDENCE_MISSING');
  if(doc.status!=='active'||!doc.isCurrentVersion||doc.isLegacy||doc.isHistorical)return block('CURRENT_ACTIVE_ONLY');
  if(!evidence.trustedServerSource||!evidence.verifiedSignedSession||!evidence.sessionActive||evidence.aal!=='aal2'
   ||!evidence.companyMembershipCurrent||!evidence.documentACLCurrent||!evidence.reviewVersionLocked)return block('TRUST_BOUNDARY_UNVERIFIED');
  if(!valid(editor.id)||!valid(reviewer.id)||editor.companyId!==doc.companyId||reviewer.companyId!==doc.companyId||
    !['owner','admin','accounting'].includes(editor.role)||!['owner','admin','accounting'].includes(reviewer.role))return block('ACTOR_NOT_ELIGIBLE');
  if(!['owner','admin'].includes(reviewer.role))return block('REVIEWER_ROLE_DENIED');
  if(!valid(evidence.contentDigest)||!valid(evidence.expectedDocId)||evidence.expectedDocId!==doc.id||
     evidence.expectedRevision!==doc.revision||evidence.expectedCompanyId!==doc.companyId||
     evidence.expectedTargetBillingId!==doc.targetBillingId||evidence.expectedSourceSyncVersion!==doc.sourceSyncVersion)
    return block('DOCUMENT_BINDING_FAILED');
  let currentHash;
  try{currentHash=contentDigest(doc)}catch(_){return block('DOCUMENT_INVALID')}
  if(currentHash!==evidence.contentDigest)return block('DOCUMENT_CHANGED');
  if(policy.mode===MODES[0]){
    if(reviewer.role!=='owner')return block('OWNER_REQUIRED');
    if(editor.id===reviewer.id){
      if(policy.selfReviewExceptionApprovedForSimulation!==true)return block('SELF_REVIEW_EXCEPTION_NOT_APPROVED');
      const confirmation=evidence.selfReview;
      if(!plain(confirmation)||confirmation.reauthenticatedAal2!==true||confirmation.explicitSecondConfirmation!==true||
        !valid(confirmation.reason)||confirmation.reason.length>500||confirmation.documentId!==doc.id||
        confirmation.revision!==doc.revision||confirmation.contentDigest!==currentHash)return block('SELF_REVIEW_INSUFFICIENT');
    }
  } else if(editor.id===reviewer.id)return block('MAKER_CHECKER_SAME_PERSON');
  if(!evidence.trustedDurableAuditReady)return block('DURABLE_AUDIT_NOT_PROVEN');
  return Object.freeze({status:'MOCK_POLICY_PERMITS_REVIEW_ONLY',code:'FAKE_CONTRACT_ONLY',productionApproved:false,
    canDeploy:false,isRealApproval:false,documentId:doc.id,revision:doc.revision,contentDigest:currentHash,
    reviewerMode:policy.mode,selfReview:editor.id===reviewer.id});
}
module.exports=Object.freeze({MODES,candidateReview,contentDigest});
