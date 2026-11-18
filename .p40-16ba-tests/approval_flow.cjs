/* P40-16BA: isolated FAKE review state machine. NEVER IMPORT INTO ERP.
 * Not real JWT/MFA, storage, document ACL, signature or PDF byte delivery.
 * Executes formal main validator unmodified, with FAKE billing fixtures only.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const formal=fs.readFileSync(path.resolve(__dirname,'../assets/js/external-billing-print.js'),'utf8');
const start=formal.indexOf('  function validate(payload){');
const end=formal.indexOf('  // P31-4:',start);
if(start<0||end<=start)throw Error('FORMAL_BILLING_VALIDATOR_DRIFT');
const formalValidate=Function('"use strict";'+formal.slice(start,end)+'\nreturn validate;')();
const clone=value=>structuredClone(value);
function canonical(value){
  const seen=new Set();
  function sort(x){
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number'&&Number.isFinite(x))return x;
    if(Array.isArray(x)){
      if(seen.has(x))throw Error('CYCLIC_SOURCE');
      seen.add(x);const result=x.map(sort);seen.delete(x);return result;
    }
    if(x&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype){
      if(seen.has(x))throw Error('CYCLIC_SOURCE');
      seen.add(x);const out={};
      for(const key of Object.keys(x).sort()){
        if(['__proto__','constructor','prototype'].includes(key))throw Error('INVALID_SOURCE_FIELD');
        out[key]=sort(x[key]);
      }
      seen.delete(x);return out;
    }
    throw Error('UNSUPPORTED_SOURCE_DATA');
  }
  const s=JSON.stringify(sort(value));
  if(Buffer.byteLength(s)>1_000_000)throw Error('SOURCE_TOO_LARGE');
  return s;
}
const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function hasReorganization(doc){
  const shape=row=>({house:row.house||'',item:row.item,unit:row.unit,
    qty:row.qty,price:row.price});
  if(doc.schema!=='kushe-external-billing-group-v2')throw Error('UNSUPPORTED_DOCUMENT_SCHEMA');
  return !doc.sourceSnapshots.every(src=>src.taxMode===doc.unified.taxMode)||
    hash(doc.sourceSnapshots.flatMap(src=>src.originalLines.map(shape)))!==
    hash(doc.unified.lines.map(shape));
}
function verify(doc){
  if(!doc||!String(doc.id||'').startsWith('FAKE-GROUP-')||
    !Number.isSafeInteger(doc.revision)||doc.revision<1||doc.status!=='active')
    throw Error('ACTIVE_FAKE_DOCUMENT_ONLY');
  formalValidate({schema:'kushe-external-billing-print-v1',
    historical:false,document:doc});
  return doc;
}
const REVIEW=['owner','admin'],EDIT=['owner','admin','accounting'],
      VIEW=['owner','admin','accounting'];
class FakeReviewWorkflow{
  #record;#sessions;#history=[];#events=[];#lastEditor;
  constructor(doc,companyId,sessions,{legacy=false,editorHandle}={}){
    this.#sessions=clone(sessions);
    const editor=this.#actor(editorHandle);
    if(!String(companyId).startsWith('FAKE-CO-')||
      editor.companyId!==companyId||!EDIT.includes(editor.role)||
      !editor.allowedDocuments.includes(doc.id))
      throw Error('FAKE_DOCUMENT_SETUP_DENIED');
    this.#record=clone(doc);verify(this.#record);
    this.companyId=companyId;
    this.mode=legacy?'legacy':'enforced';
    this.status=legacy?'legacy_unchanged':'editing';
    this.#lastEditor=editor.userId;
    this.currentHash=hash(this.#record);
    this.submission=null;
    this.approval=null;
    this.#log('SEED',editor);
  }
  #actor(handle){
    if(typeof handle!=='string'||!handle.startsWith('FAKE-HANDLE-'))
      throw Error('UNTRUSTED_FAKE_HANDLE');
    const a=this.#sessions[handle];
    if(!a||a.fakeVerified!==true||a.active!==true||
      a.memberActive!==true||a.aal!=='aal2'||!String(a.userId).startsWith('FAKE-USER-'))
      throw Error('FAKE_SESSION_OR_MFA_DENIED');
    return a;
  }
  #allowed(actor,roles){
    if(actor.companyId!==this.companyId)throw Error('CROSS_COMPANY_DENIED');
    if(!actor.allowedDocuments.includes(this.#record.id))throw Error('DOCUMENT_ACL_DENIED');
    if(!roles.includes(actor.role))throw Error('ROLE_DENIED');
  }
  #log(action,actor,reason=''){
    this.#events.push({seq:this.#events.length+1,action,
      userId:actor.userId,documentId:this.#record.id,revision:this.#record.revision,
      fingerprint:this.currentHash,reasonDigest:reason?hash(reason):''});
  }
  #assertUnchangedSource(){
    if(hash(this.#record)!==this.currentHash)throw Error('SOURCE_CHANGED_WITHOUT_VERSION');
    verify(this.#record);
  }
  getSummary(handle){
    const user=this.#actor(handle);this.#allowed(user,VIEW);
    this.#assertUnchangedSource();
    return {documentId:this.#record.id,revision:this.#record.revision,
      status:this.status,mode:this.mode,rearranged:hasReorganization(this.#record),
      submissionPending:this.submission!==null,approved:this.approval?.fingerprint===this.currentHash,
      historyCount:this.#history.length,sourceHash:this.currentHash};
  }
  availableActions(handle){
    const a=this.#actor(handle);this.#allowed(a,VIEW);
    const s=this.getSummary(handle);
    return {
      edit:EDIT.includes(a.role)&&['legacy_unchanged','editing','returned','approved'].includes(s.status),
      submit:EDIT.includes(a.role)&&s.status==='editing'&&
        s.mode==='enforced'&&s.rearranged,
      approve:REVIEW.includes(a.role)&&s.status==='pending_review'&&a.userId!==this.#lastEditor,
      return:REVIEW.includes(a.role)&&s.status==='pending_review'&&a.userId!==this.#lastEditor,
      withdraw:EDIT.includes(a.role)&&s.status==='pending_review'&&a.userId===this.#lastEditor,
      history:true
    };
  }
  edit(handle,expectedRevision,mutator){
    const a=this.#actor(handle);this.#allowed(a,EDIT);
    if(!['legacy_unchanged','editing','returned','approved'].includes(this.status))
      throw Error('WORKFLOW_MUST_BE_RETURNED_OR_WITHDRAWN_BEFORE_EDIT');
    if(this.#record.revision!==expectedRevision)throw Error('STALE_EDIT_VERSION');
    this.#assertUnchangedSource();
    if(typeof mutator!=='function')throw Error('FAKE_TRUSTED_MUTATOR_REQUIRED');
    const next=clone(this.#record);
    mutator(next);next.revision=this.#record.revision+1;
    if(next.id!==this.#record.id||next.schema!==this.#record.schema)
      throw Error('DOCUMENT_IDENTITY_CANNOT_CHANGE');
    verify(next);
    this.#history.push(clone(this.#record));
    this.#record=next;this.currentHash=hash(next);
    this.#lastEditor=a.userId;this.status='editing';this.mode='enforced';
    this.submission=null;this.approval=null;
    this.#log('NEW_REVISION',a);
    return this.getSummary(handle);
  }
  submit(handle,expectedRevision,expectedHash){
    const a=this.#actor(handle);this.#allowed(a,EDIT);
    this.#assertUnchangedSource();
    if(this.status!=='editing'||this.mode!=='enforced')
      throw Error('NOT_EDITABLE_FOR_SUBMISSION');
    if(this.#record.revision!==expectedRevision||this.currentHash!==expectedHash)
      throw Error('STALE_SUBMISSION');
    if(!hasReorganization(this.#record))throw Error('NO_REORGANIZATION_REQUIRES_REVIEW');
    if(!String(this.#record.unified.reason||'').trim())throw Error('REORGANIZATION_REASON_REQUIRED');
    this.status='pending_review';
    this.submission={revision:expectedRevision,fingerprint:expectedHash,submitter:a.userId};
    this.#log('SUBMITTED',a);
    return this.getSummary(handle);
  }
  approve(handle,expectedRevision,expectedHash){
    const a=this.#actor(handle);this.#allowed(a,REVIEW);
    this.#assertUnchangedSource();
    if(this.status!=='pending_review'||!this.submission)throw Error('NOT_PENDING_REVIEW');
    if(a.userId===this.#lastEditor||a.userId===this.submission.submitter)
      throw Error('INDEPENDENT_APPROVER_REQUIRED');
    if(expectedRevision!==this.#record.revision||
      expectedHash!==this.currentHash||this.submission.fingerprint!==this.currentHash)
      throw Error('STALE_REVIEW_VERSION_OR_HASH');
    this.approval={reviewer:a.userId,revision:this.#record.revision,
      fingerprint:this.currentHash};
    this.status='approved';this.submission=null;
    this.#log('APPROVED',a);
    return this.getSummary(handle);
  }
  returnForChanges(handle,expectedRevision,reason){
    const a=this.#actor(handle);this.#allowed(a,REVIEW);
    this.#assertUnchangedSource();
    if(this.status!=='pending_review')throw Error('NOT_PENDING_REVIEW');
    if(a.userId===this.#lastEditor||a.userId===this.submission?.submitter)
      throw Error('INDEPENDENT_REVIEWER_REQUIRED');
    if(expectedRevision!==this.#record.revision)throw Error('STALE_RETURN_VERSION');
    if(typeof reason!=='string'||reason.trim().length<4||reason.length>120)
      throw Error('RETURN_REASON_REQUIRED');
    this.status='returned';this.approval=null;this.submission=null;
    this.#log('RETURNED',a,reason.trim());
    return this.getSummary(handle);
  }
  withdraw(handle){
    const a=this.#actor(handle);this.#allowed(a,EDIT);
    if(this.status!=='pending_review'||a.userId!==this.submission?.submitter)
      throw Error('NOT_OWN_PENDING_SUBMISSION');
    this.status='editing';this.submission=null;
    this.#log('WITHDRAWN',a);
    return this.getSummary(handle);
  }
  printDecision(handle,revision,{history=false}={}){
    const a=this.#actor(handle);this.#allowed(a,VIEW);
    this.#assertUnchangedSource();
    if(history){
      const old=this.#history.find(x=>x.revision===revision);
      if(!old)throw Error('HISTORY_REVISION_NOT_FOUND');
      return {eligible:true,route:'EXISTING_HISTORY_PRINT',revision,sourceHash:hash(old)};
    }
    if(revision!==this.#record.revision)throw Error('NOT_CURRENT_VERSION');
    if(this.mode==='legacy'&&this.status==='legacy_unchanged')
      return {eligible:true,route:'EXISTING_LEGACY_PRINT',revision,sourceHash:this.currentHash};
    if(!hasReorganization(this.#record))
      return {eligible:true,route:'ORIGINAL_UNCHANGED_PRINT_CONTRACT',revision,sourceHash:this.currentHash};
    if(this.status!=='approved'||this.approval?.revision!==revision||
      this.approval.fingerprint!==this.currentHash)
      throw Error('CURRENT_REORGANIZED_REVISION_NOT_APPROVED');
    return {eligible:true,route:'NEW_APPROVED_PRINT_CONTRACT',revision,sourceHash:this.currentHash};
  }
  history(handle){
    const a=this.#actor(handle);this.#allowed(a,VIEW);
    return this.#history.map(old=>({revision:old.revision,
      sourceHash:hash(old),route:'EXISTING_HISTORY_PRINT'}));
  }
  audit(handle){
    const a=this.#actor(handle);this.#allowed(a,VIEW);
    return clone(this.#events);
  }
}
module.exports={FakeReviewWorkflow,hash,verify,hasReorganization};
