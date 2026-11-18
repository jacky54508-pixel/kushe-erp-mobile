/* P40-16AZ - FAKE review/print integration adapter, NEVER IMPORT IN ERP.
 * This module only verifies hypothetical server-side contract in CI.
 * No real Auth/JWT/MFA, persistent approval, Supabase, PDF byte rendering or
 * trusted live single-document source is implemented.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const official=fs.readFileSync(path.join(ROOT,'assets/js/external-billing-print.js'),'utf8');
const a=official.indexOf('  function validate(payload){');
const b=official.indexOf('  // P31-4:',a);
if(a<0||b<=a)throw Error('FORMAL_VALIDATOR_SIGNATURE_CHANGED');
const verifyOriginal=Function('"use strict";'+official.slice(a,b)+'\nreturn validate;')();
const clone=x=>structuredClone(x);
function canonical(input){
  const visited=new Set();
  function norm(v,depth){
    if(depth>35)throw Error('UNSAFE_NESTING');
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(Array.isArray(v)){
      if(visited.has(v))throw Error('SHARED_OR_CYCLIC_REFERENCE');
      visited.add(v);const result=v.map(x=>norm(x,depth+1));visited.delete(v);return result;
    }
    if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){
      if(visited.has(v))throw Error('SHARED_OR_CYCLIC_REFERENCE');
      visited.add(v);const out={};
      for(const key of Object.keys(v).sort()){
        if(['__proto__','constructor','prototype'].includes(key))throw Error('UNSAFE_FIELD_NAME');
        if(v[key]===undefined)throw Error('UNDEFINED_VALUE');
        out[key]=norm(v[key],depth+1);
      }
      visited.delete(v);return out;
    }
    throw Error('UNSUPPORTED_DOCUMENT_VALUE');
  }
  const result=JSON.stringify(norm(input,0));
  if(Buffer.byteLength(result)>1000000)throw Error('DOCUMENT_TOO_LARGE');
  return result;
}
const hash=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
function changedOriginalRows(d){
  if(d.schema!=='kushe-external-billing-group-v2'||!d.unified)
    throw Error('UNSUPPORTED_APPROVAL_DOCUMENT');
  const shape=l=>({house:l.house||'',item:l.item,unit:l.unit,
    qty:l.qty,price:l.price});
  const originals=d.sourceSnapshots.flatMap(s=>s.originalLines.map(shape));
  const now=d.unified.lines.map(shape);
  return !d.sourceSnapshots.every(s=>s.taxMode===d.unified.taxMode)||
    hash(originals)!==hash(now);
}
function verifyDocument(d){
  if(!d||!String(d.id||'').startsWith('FAKE-GROUP-')||
     !Number.isSafeInteger(d.revision)||d.revision<1||
     !['active','archived'].includes(d.status))
    throw Error('ONLY_FAKE_VERSIONED_BILLING');
  verifyOriginal({schema:'kushe-external-billing-print-v1',
    historical:d.status==='archived',document:d});
  return d;
}
function assertExactKeys(obj,keys){
  if(!obj||Array.isArray(obj)||typeof obj!=='object'||
    Object.keys(obj).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('UNTRUSTED_CLIENT_EXTRA_OR_MISSING_FIELDS');
}
const ALLOWED_ROLES_FOR_READ=['owner','admin','accounting'];
const CANDIDATE_REVIEWER_ROLES=['owner','admin'];
const CANDIDATE_EDITOR_ROLES=['owner','admin','accounting'];
class FakeTrustedIdentitySource{
  #sessions;
  constructor(sessionHandles){this.#sessions=clone(sessionHandles);}
  verify(handle){
    if(!String(handle||'').startsWith('FAKE-HANDLE-'))
      throw Error('UNTRUSTED_FAKE_SESSION');
    const actor=this.#sessions[handle];
    if(!actor||actor.verified!==true||actor.aal!=='aal2'||
      actor.active!==true||actor.memberActive!==true||
      !String(actor.userId).startsWith('FAKE-USER-')||
      !String(actor.companyId).startsWith('FAKE-CO-'))
      throw Error('FAKE_SESSION_MFA_OR_MEMBERSHIP_DENIED');
    return clone(actor);
  }
  revoke(handle){if(this.#sessions[handle])this.#sessions[handle].active=false;}
  changeRole(handle,role){if(this.#sessions[handle])this.#sessions[handle].role=role;}
}
class FakeAuthorizedDocumentSource{
  #records=new Map();
  #tickets=new Map();
  #approvals=new Map();
  #eventAudit=[];
  #clock=0;
  constructor(identity){this.identity=identity;}
  #registerLog(event,id,rev,actorId,sourceHash){
    this.#eventAudit.push({seq:this.#eventAudit.length+1,action:event,
      documentId:id,revision:rev,actorId,sourceHash});
  }
  #actor(handle){return this.identity.verify(handle);}
  #authorized(actor,record,roles){
    if(actor.companyId!==record.companyId)throw Error('COMPANY_BOUNDARY_DENIED');
    if(!actor.allowedDocuments?.includes(record.current.id))
      throw Error('DOCUMENT_ACL_DENIED');
    if(!roles.includes(actor.role))throw Error('ROLE_NOT_ALLOWED');
  }
  #lookup(id){const r=this.#records.get(id);if(!r)throw Error('UNKNOWN_FAKE_DOCUMENT');return r;}
  #current(id){
    const r=this.#lookup(id);
    if(hash(r.current)!==r.sourceHash)throw Error('SOURCE_CHANGED_OUTSIDE_TRUSTED_RECORD');
    verifyDocument(r.current);
    return r;
  }
  seedFromFakeTrustedSource(doc,companyId,editorHandle,preExisting=false){
    const actor=this.#actor(editorHandle),d=clone(doc);
    verifyDocument(d);
    if(!String(companyId).startsWith('FAKE-CO-')||
      !String(d.id).startsWith('FAKE-GROUP-'))
      throw Error('FAKE_ONLY_TRUSTED_SEED');
    if(actor.companyId!==companyId||!actor.allowedDocuments?.includes(d.id)||
      !CANDIDATE_EDITOR_ROLES.includes(actor.role))
      throw Error('FAKE_DOCUMENT_SEED_UNAUTHORIZED');
    if(this.#records.has(d.id))throw Error('DUPLICATE_TRUSTED_DOCUMENT');
    if(!preExisting&&d.revision!==1)throw Error('NEW_DOCUMENT_MUST_START_VERSION_ONE');
    this.#records.set(d.id,{companyId,current:d,sourceHash:hash(d),
      mode:preExisting?'legacy':'enforced',editorId:actor.userId,history:[]});
    this.#registerLog('SEED',d.id,d.revision,actor.userId,hash(d));
  }
  currentMeta(handle,id){
    const actor=this.#actor(handle),r=this.#current(id);
    this.#authorized(actor,r,ALLOWED_ROLES_FOR_READ);
    return {id,revision:r.current.revision,sourceHash:r.sourceHash,mode:r.mode,
      hasReorganizedLines:changedOriginalRows(r.current),historicalCount:r.history.length};
  }
  submitNewRevision(handle,request,mutateTrustedCopy){
    assertExactKeys(request,['documentId','expectedRevision']);
    const actor=this.#actor(handle),r=this.#current(request.documentId);
    this.#authorized(actor,r,CANDIDATE_EDITOR_ROLES);
    if(r.current.status!=='active')throw Error('ARCHIVED_DOCUMENT_CANNOT_BE_REVISED');
    if(r.current.revision!==request.expectedRevision)throw Error('STALE_EXPECTED_REVISION');
    if(r.current.revision>=50)throw Error('MAXIMUM_DOCUMENT_REVISIONS');
    if(typeof mutateTrustedCopy!=='function')throw Error('TRUSTED_SOURCE_REVISION_CALLBACK_REQUIRED');
    const next=clone(r.current);
    mutateTrustedCopy(next);
    if(next.id!==r.current.id||next.schema!==r.current.schema)
      throw Error('REWRITTEN_SOURCE_IDENTITY');
    next.revision=r.current.revision+1;
    verifyDocument(next);
    r.history.push(clone(r.current));
    r.current=next;r.sourceHash=hash(next);r.mode='enforced';r.editorId=actor.userId;
    this.#registerLog('VERSION_SAVED',next.id,next.revision,actor.userId,r.sourceHash);
    return {id:next.id,revision:next.revision,sourceHash:r.sourceHash};
  }
  approveNewRevision(handle,request){
    assertExactKeys(request,['documentId','revision','sourceHash']);
    const actor=this.#actor(handle),r=this.#current(request.documentId);
    this.#authorized(actor,r,CANDIDATE_REVIEWER_ROLES);
    if(actor.userId===r.editorId)throw Error('EDITOR_CANNOT_SELF_APPROVE');
    if(r.mode!=='enforced'||r.current.status!=='active')
      throw Error('NOT_NEW_ACTIVE_DOCUMENT');
    if(!changedOriginalRows(r.current))throw Error('NO_REORGANIZATION_TO_APPROVE');
    if(!String(r.current.unified.reason||'').trim())throw Error('REORGANIZATION_REASON_MISSING');
    if(r.current.revision!==request.revision||r.sourceHash!==request.sourceHash)
      throw Error('STALE_APPROVAL_VERSION_OR_HASH');
    const id=request.documentId+'@'+request.revision;
    if(this.#approvals.has(id))throw Error('ALREADY_APPROVED');
    this.#approvals.set(id,{companyId:r.companyId,sourceHash:r.sourceHash,
      reviewerId:actor.userId,editorId:r.editorId});
    this.#registerLog('REVIEW_APPROVED',r.current.id,r.current.revision,
      actor.userId,r.sourceHash);
    return {revision:r.current.revision,approvedSourceHash:r.sourceHash};
  }
  #decision(actor,r,requestedVersion,historyMode){
    this.#authorized(actor,r,ALLOWED_ROLES_FOR_READ);
    const current=r.current;
    if(historyMode){
      // This is a pure compatibility plan. It never modifies formal printSaved.
      const historic=r.history.find(x=>x.revision===requestedVersion);
      if(!historic)throw Error('REQUESTED_HISTORY_REVISION_MISSING');
      if(historic.status==='draft')throw Error('HISTORICAL_DRAFT_CANNOT_PRINT');
      return {route:'PRESERVE_EXISTING_HISTORY_PRINT',revision:requestedVersion,
        sourceHash:hash(historic),mode:'historical',requiresIndependentReview:false};
    }
    if(current.status!=='active'||current.revision!==requestedVersion)
      throw Error('CURRENT_VERSION_NOT_AVAILABLE');
    if(r.mode==='legacy')
      return {route:'PRESERVE_CONFIRMED_LEGACY_PRINT',revision:current.revision,
        sourceHash:r.sourceHash,mode:r.mode,requiresIndependentReview:false};
    const needs=changedOriginalRows(current);
    if(needs){
      const approved=this.#approvals.get(current.id+'@'+requestedVersion);
      if(!approved||approved.companyId!==r.companyId||
        approved.sourceHash!==r.sourceHash||approved.editorId!==r.editorId)
        throw Error('NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
    }
    return {route:'CANDIDATE_VERIFIED_PDF_ONLY',revision:current.revision,
      sourceHash:r.sourceHash,mode:r.mode,requiresIndependentReview:needs};
  }
  // Client can only send a locator. Privileges are resolved from the FAKE
  // server identity/session+document source and never from request fields.
  beginPreflight(handle,request){
    assertExactKeys(request,['documentId','revision','printMode']);
    if(!['current','history'].includes(request.printMode))
      throw Error('INVALID_PRINT_MODE');
    const actor=this.#actor(handle),r=this.#current(request.documentId);
    const decision=this.#decision(actor,r,request.revision,
      request.printMode==='history');
    const ticket='FAKE-ONE-USE-PREFLIGHT-'+(++this.#clock);
    this.#tickets.set(ticket,{documentId:request.documentId,actorId:actor.userId,
      companyId:actor.companyId,sourceHash:decision.sourceHash,
      revision:request.revision,printMode:request.printMode,
      route:decision.route});
    return {ticket,...decision};
  }
  // Simulates a post-render / pre-download recheck, but DOES NOT accept or
  // deliver PDF bytes. Actual PDF-first generation and byte matching belong
  // to future separately approved service architecture.
  finalizePreflight(handle,request){
    assertExactKeys(request,['ticket']);
    const actor=this.#actor(handle),entry=this.#tickets.get(request.ticket);
    if(!entry)throw Error('PRECHECK_UNKNOWN_OR_USED');
    if(actor.userId!==entry.actorId||actor.companyId!==entry.companyId)
      throw Error('PRECHECK_OTHER_USER_DENIED');
    const r=this.#current(entry.documentId);
    const next=this.#decision(actor,r,entry.revision,entry.printMode==='history');
    if(next.sourceHash!==entry.sourceHash||next.route!==entry.route)
      throw Error('SOURCE_CHANGED_BETWEEN_CHECK_AND_DELIVERY');
    this.#tickets.delete(request.ticket);
    return {safeToProceedWithFurtherPdfByteVerification:true,
      documentId:entry.documentId,revision:entry.revision,
      sourceHash:next.sourceHash,route:next.route,
      warning:'FAKE_PREFLIGHT_ONLY_NO_PDF_BYTES_OR_PRODUCTION_APPROVAL'};
  }
  auditMetadata(){return clone(this.#eventAudit);}
}
module.exports={
  FakeTrustedIdentitySource,FakeAuthorizedDocumentSource,
  verifyDocument,changedOriginalRows,hash
};
