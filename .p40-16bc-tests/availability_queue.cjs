/* P40-16BC — reviewer-availability/escalation queue, entirely FAKE + local.
 * This is a research-only state machine. The test roster is NOT Supabase
 * Auth, JWT signature validation, real company membership or PDF approval.
 * DO NOT import it into ERP or trust a browser-supplied "verified" actor.
 */
'use strict';
const {makeDecision,sha,POLICIES}=require('./mock_policy_authority.cjs');
const clone=x=>structuredClone(x);
const deny=reason=>Object.freeze({allowed:false,reason});
const approveAction=Object.freeze({action:'approve',documentId:'FAKE-DOC-ONE',revision:1,expectedHash:'a'.repeat(64)});

class FakeReviewAvailabilityQueue{
  #doc;#roster;#nominated=null;#review=null;#events=[];#policyId;
  constructor({document,roster,policyId='candidate-owner-or-admin-independent'}){
    if(!POLICIES[policyId])throw Error('POLICY_UNRECOGNIZED');
    if(!document||!String(document.id||'').startsWith('FAKE-DOC-')||
       !String(document.companyId||'').startsWith('FAKE-COMPANY-')||
       !Number.isSafeInteger(document.revision)||document.revision<1)
      throw Error('FAKE_DOCUMENT_REQUIRED');
    this.#policyId=policyId;
    this.#doc=clone(document);
    this.#roster=clone(roster);
  }
  #principal(userId){return clone(this.#roster[userId]||null);}
  #q(action,extra={}){
    const q={action,documentId:this.#doc.id,revision:this.#doc.revision};
    if(!['view_current','view_history'].includes(action))
      q.expectedHash=this.#doc.fingerprint;
    return {...q,...extra};
  }
  #check(userId,action,extra={}){
    return makeDecision({request:this.#q(action,extra),
      principal:this.#principal(userId),
      document:clone(this.#doc),
      reviewRecord:clone(this.#review),
      policyId:this.#policyId});
  }
  #record(type,actor,details={}){
    this.#events.push(Object.freeze({seq:this.#events.length+1,
      type,actor,documentId:this.#doc.id,revision:this.#doc.revision,
      sourceHash:this.#doc.fingerprint,
      ...details
    }));
  }
  #findEligible(){
    if(this.#doc.workflow!=='pending_review'||this.#doc.mode==='legacy')return [];
    return Object.keys(this.#roster)
      .sort()
      .filter(id=>this.#check(id,'approve').allowed);
  }
  #summary(){
    const eligible=this.#findEligible();
    const assigned=this.#nominated;
    const assignedEligible=!!assigned&&eligible.includes(assigned);
    const needsReviewer=this.#doc.mode!=='legacy'&&
      this.#doc.workflow==='pending_review';
    return {
      status:needsReviewer?
        assignedEligible?'AWAITING_NOMINATED_REVIEW':
        eligible.length?'REASSIGN_REVIEWER_REQUIRED':'SAFE_HOLD_NO_REVIEWER'
        :'NOT_IN_REVIEW',
      policyId:this.#policyId,
      documentId:this.#doc.id,revision:this.#doc.revision,
      eligibleCount:eligible.length,
      eligibleReviewerIds:eligible,
      nominatedReviewerId:assignedEligible?assigned:null,
      legacyExistingPrintUnaffected:this.#doc.mode==='legacy'&&
        this.#doc.unchangedSinceLegacyEnrollment===true,
      financialPostingPerformed:false,
      liveAuthVerified:false,
      separatePdfBytesGateCompleted:false
    };
  }
  status(requesterId){
    const x=this.#check(requesterId,'view_current');
    if(!x.allowed)return x;
    return Object.freeze({allowed:true,...this.#summary()});
  }
  // "Nomination" is queue routing, never authorization/approval or role
  // assignment. Fake submitter can only choose an ALREADY eligible reviewer.
  nominate(submitterId,reviewerId){
    const read=this.#check(submitterId,'view_current');
    if(!read.allowed)return read;
    if(this.#doc.workflow!=='pending_review'||this.#doc.mode==='legacy')
      return deny('NO_PENDING_NEW_REVIEW');
    if(submitterId!==this.#doc.submitterId)return deny('SUBMITTER_ONLY_NOMINATION');
    if(!this.#findEligible().includes(reviewerId))
      return deny('REVIEWER_NOT_ELIGIBLE_OR_UNAVAILABLE');
    this.#nominated=reviewerId;
    this.#record('NOMINATED',submitterId,{candidateReviewerId:reviewerId});
    return Object.freeze({allowed:true,next:'AWAIT_INDEPENDENT_REVIEW',
      nominatedReviewerId:reviewerId,approvalCreated:false});
  }
  // Revalidate policy + company + current role/ACL/MFA on every step.
  review(reviewerId,{revision,expectedHash}={}){
    if(this.#nominated!==reviewerId)return deny('REVIEWER_NOT_NOMINATED');
    if(this.#doc.revision!==revision||this.#doc.fingerprint!==expectedHash)
      return deny('STALE_REVIEW_VERSION_OR_SOURCE');
    const decision=this.#check(reviewerId,'approve');
    if(!decision.allowed)return decision;
    if(!this.#findEligible().includes(reviewerId))
      return deny('REVIEWER_LOST_ELIGIBILITY');
    this.#doc.workflow='approved';
    this.#review={
      fakeTrustedRegistryEntry:true,
      companyId:this.#doc.companyId,
      documentId:this.#doc.id,
      revision:this.#doc.revision,
      fingerprint:this.#doc.fingerprint,
      editorId:this.#doc.editorId,
      submitterId:this.#doc.submitterId,
      reviewerId,
      reviewerRole:this.#principal(reviewerId).role
    };
    this.#record('REVIEWED',reviewerId,{reviewerId});
    this.#nominated=null;
    return Object.freeze({allowed:true,next:'MOCK_APPROVED_REQUIRES_PDF_GATE',
      approvalBindsRevision:revision,financialPostingPerformed:false});
  }
  releaseCheck(requesterId){
    const x=this.#check(requesterId,'release_to_pdf_gate');
    if(!x.allowed)return x;
    return Object.freeze({allowed:true,next:x.next,
      // this means ONLY next-stage eligibility, never PDF bytes delivered
      deliveredPdfBytes:false,releaseVerified:false});
  }
  // A policy decision cannot be changed by the submitter to escape a queue.
  // This is an explicitly TEST-ONLY way to model a separate future owner
  // decision. In production only a trusted owner-policy governance action
  // and a new reviewed policy revision could do something equivalent.
  comparePolicyAlternatives(requesterId){
    const x=this.#check(requesterId,'view_current');
    if(!x.allowed)return x;
    const out={};
    for(const id of Object.keys(POLICIES)){
      const candidate=Object.keys(this.#roster).filter(userId=>{
        const p=this.#principal(userId);
        return makeDecision({request:this.#q('approve'),principal:p,
          document:clone(this.#doc),policyId:id}).allowed;
      }).sort();
      out[id]={eligibleCount:candidate.length,
        noReviewerSafeHold:candidate.length===0&&this.#doc.workflow==='pending_review'};
    }
    return Object.freeze({allowed:true,alternatives:out,
      ownerDecision:'NOT YET GIVEN',automaticOverride:false});
  }
  // NOTE only synthetic CI fixture changes. This is NOT self-service role
  // promotion, user invitation, actual signed membership change or RLS.
  testOnlyReplaceVerifiedRoster(roster){
    this.#roster=clone(roster);
    // Keep old nomination for audit history but every action rechecks it.
    // A withdrawn reviewer must not be an automatic approval.
  }
  testOnlyTrustedNewRevision({revision,sourceHash,editorId,submitterId,
      status='pending_review'}={}){
    if(!Number.isSafeInteger(revision)||revision!==this.#doc.revision+1||
       typeof sourceHash!=='string'||!/^[0-9a-f]{64}$/.test(sourceHash)||
       sourceHash===this.#doc.fingerprint||
       !String(editorId||'').startsWith('FAKE-USER-')||
       !String(submitterId||'').startsWith('FAKE-USER-'))
      throw Error('FAKE_TRUSTED_VERSION_CAS_REQUIRED');
    this.#doc.revision=revision;
    this.#doc.fingerprint=sourceHash;
    this.#doc.editorId=editorId;
    this.#doc.submitterId=submitterId;
    this.#doc.mode='enforced';this.#doc.workflow=status;
    this.#doc.unchangedSinceLegacyEnrollment=false;
    this.#nominated=null;this.#review=null;
    this.#record('NEW_VERSION',editorId);
  }
  audit(requesterId){
    const x=this.#check(requesterId,'view_current');
    if(!x.allowed)return x;
    return clone(this.#events);
  }
}
module.exports={FakeReviewAvailabilityQueue,sha};
