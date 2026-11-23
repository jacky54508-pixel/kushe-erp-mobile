/* P40-16BB — policy decision contract, TEST-ONLY FAKE ACTORS/DOCUMENTS.
 * NOT a JWT parser, trusted server authorization, DB/RLS, approval database,
 * real ERP module, crypto signature or PDF delivery implementation.
 * Caller supplies fake "verified" actors only from isolated test fixtures.
 * Never wire this module to production or trust browser-provided actors.
 */
'use strict';
const crypto=require('node:crypto');
const ACTIONS=Object.freeze([
  'view_current','view_history','edit','submit','approve','return','withdraw',
  'release_to_pdf_gate'
]);
const EDIT_ROLES=Object.freeze(['owner','admin','accounting']);
const READ_ROLES=EDIT_ROLES;
const POLICIES=Object.freeze({
  'candidate-owner-or-admin-independent':Object.freeze({
    reviewerRoles:Object.freeze(['owner','admin']),
    independentReviewer:true,allowSelfReview:false
  }),
  'alternative-owner-only-independent':Object.freeze({
    reviewerRoles:Object.freeze(['owner']),
    independentReviewer:true,allowSelfReview:false
  })
});
const expectedFields={
 view_current:['action','documentId','revision'],
 view_history:['action','documentId','revision'],
 edit:['action','documentId','revision','expectedHash'],
 submit:['action','documentId','revision','expectedHash'],
 approve:['action','documentId','revision','expectedHash'],
 return:['action','documentId','revision','expectedHash','reason'],
 withdraw:['action','documentId','revision','expectedHash'],
 release_to_pdf_gate:['action','documentId','revision','expectedHash']
};
const deny=(code)=>Object.freeze({allowed:false,reason:code});
const allow=(next,details={})=>Object.freeze({
 allowed:true,next,...details
});
const sha=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
function strict(obj,keys){
  return !!obj&&Object.getPrototypeOf(obj)===Object.prototype&&
    Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
}
function makeDecision({request,principal,document,reviewRecord=null,policyId=
  'candidate-owner-or-admin-independent'}={}){
  const p=POLICIES[policyId];
  if(!p)return deny('POLICY_NOT_APPROVED_OR_UNKNOWN');
  if(!request||!ACTIONS.includes(request.action))return deny('ACTION_UNSUPPORTED');
  if(!strict(request,expectedFields[request.action]))return deny('REQUEST_FIELDS_NOT_ALLOWED');
  if(!document||typeof document!=='object'||!String(document.id||'').startsWith('FAKE-DOC-')||
     !String(document.companyId||'').startsWith('FAKE-COMPANY-'))
    return deny('NO_FAKE_TRUSTED_DOCUMENT');
  if(!principal||!String(principal.userId||'').startsWith('FAKE-USER-')||
     !String(principal.companyId||'').startsWith('FAKE-COMPANY-')||
     !principal.signatureVerified||!principal.issuerVerified||
     !principal.audienceVerified||!principal.expiryVerified||
     !principal.sessionValid||!principal.membershipActive||
     principal.aal!=='aal2')
    return deny('FAKE_IDENTITY_AUTH_MFA_FAILED');
  if(principal.companyId!==document.companyId)return deny('CROSS_COMPANY_DENIED');
  if(!Array.isArray(principal.allowedDocuments)||
      !principal.allowedDocuments.includes(document.id))return deny('DOCUMENT_ACL_DENIED');
  if(!READ_ROLES.includes(principal.role))return deny('BILLING_ROLE_DENIED');
  if(request.documentId!==document.id)return deny('DOCUMENT_ID_MISMATCH');
  if(!Number.isSafeInteger(request.revision)||request.revision<1)
    return deny('INVALID_VERSION');
  if(document.status!=='active'&&request.action!=='view_history')
    return deny('NOT_ACTIVE_CURRENT_DOCUMENT');

  if(request.action==='view_history'){
    const history=Array.isArray(document.historyRevisions)?
      document.historyRevisions:[];
    if(!history.includes(request.revision))return deny('HISTORY_VERSION_NOT_FOUND');
    return allow('READ_ONLY_HISTORICAL_VIEW');
  }
  if(document.revision!==request.revision)return deny('STALE_OR_OTHER_VERSION');
  if(!String(document.fingerprint||'').match(/^[0-9a-f]{64}$/))
    return deny('UNTRUSTED_DOCUMENT_FINGERPRINT');
  if(document.sourceMatchesCurrent!==true)return deny('SOURCE_DRIFT_BLOCKED');
  if(request.action!=='view_current'&&request.expectedHash!==document.fingerprint)
    return deny('SOURCE_FINGERPRINT_MISMATCH');

  if(request.action==='view_current'){
    return allow('READ_ONLY_CURRENT_DOCUMENT');
  }
  const pending=document.workflow==='pending_review';
  const editing=document.workflow==='editing';
  const returned=document.workflow==='returned';
  const approved=document.workflow==='approved';
  const legacy=document.mode==='legacy';

  if(request.action==='edit'){
    if(!EDIT_ROLES.includes(principal.role))return deny('EDITOR_ROLE_DENIED');
    if(pending)return deny('PENDING_MUST_RETURN_OR_WITHDRAW');
    if(document.workflow==='archived')return deny('ARCHIVED_READ_ONLY');
    return allow('CREATE_NEW_REVISION_WITH_FORMAL_CAS_ONLY');
  }
  if(request.action==='submit'){
    if(!editing)return deny(returned?'RETURNED_REQUIRES_NEW_VERSION':'NOT_EDITING');
    if(!document.reorganized)return deny('NO_REORGANIZATION_TO_REVIEW');
    if(typeof document.reason!=='string'||!document.reason.trim())
      return deny('REARRANGEMENT_REASON_REQUIRED');
    return allow('SUBMIT_REVISION_AND_SOURCE_DIGEST');
  }
  if(request.action==='approve'||request.action==='return'){
    if(!p.reviewerRoles.includes(principal.role))return deny('REVIEWER_ROLE_DENIED');
    if(!pending)return deny('NOT_PENDING_INDEPENDENT_REVIEW');
    if(!document.reorganized)return deny('NOT_A_REARRANGED_DOCUMENT');
    if(principal.userId===document.editorId||
       principal.userId===document.submitterId)
      return deny('SEPARATION_OF_DUTIES_REQUIRED');
    if(request.action==='return'){
      if(typeof request.reason!=='string'||request.reason.trim().length<4||
         request.reason.length>120)return deny('RETURN_REASON_REQUIRED');
      return allow('RETURN_FOR_NEW_EDITED_REVISION',{
        reasonDigest:sha(request.reason.trim())
      });
    }
    return allow('RECORD_INDEPENDENT_REVISION_APPROVAL_ONLY');
  }
  if(request.action==='withdraw'){
    if(!pending)return deny('NOT_PENDING_SUBMISSION');
    if(principal.userId!==document.submitterId)
      return deny('ONLY_ORIGINAL_SUBMITTER_CAN_WITHDRAW');
    return allow('WITHDRAW_TO_EDITING');
  }
  if(request.action==='release_to_pdf_gate'){
    if(legacy){
      if(!document.unchangedSinceLegacyEnrollment)return deny('LEGACY_DOC_WAS_MODIFIED');
      return allow('PRESERVE_EXISTING_LEGACY_PRINT');
    }
    if(!document.reorganized)return allow('NEEDS_SEPARATE_PDF_BYTES_CHECK');
    if(!approved)return deny('REVIEW_NOT_APPROVED');
    if(!reviewRecord||!reviewRecord.fakeTrustedRegistryEntry||
       reviewRecord.companyId!==document.companyId||
       reviewRecord.documentId!==document.id||
       reviewRecord.revision!==document.revision||
       reviewRecord.fingerprint!==document.fingerprint||
       reviewRecord.editorId!==document.editorId||
       reviewRecord.submitterId!==document.submitterId||
       !String(reviewRecord.reviewerId||'').startsWith('FAKE-USER-')||
       reviewRecord.reviewerId===document.editorId||
       reviewRecord.reviewerId===document.submitterId||
       !p.reviewerRoles.includes(reviewRecord.reviewerRole))
      return deny('APPROVAL_NOT_TRUSTED_OR_STALE');
    return allow('NEEDS_SEPARATE_PDF_BYTES_CHECK');
  }
  return deny('ACTION_UNSUPPORTED');
}
module.exports={makeDecision,POLICIES,ACTIONS,expectedFields,sha};
