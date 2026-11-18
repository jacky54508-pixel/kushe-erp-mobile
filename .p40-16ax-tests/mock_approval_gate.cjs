/* P40-16AX — ISOLATED FAKE revision-bound approval model.
 * No live JWT/MFA, no Supabase, no ERP Store, no PDF download integration.
 * All identity, source and history objects are FAKE test fixtures.
 * Do NOT deploy this file or use it to approve real customer billings.
 */
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const OFFICIAL=fs.readFileSync(path.join(ROOT,'assets/js/external-billing-print.js'),'utf8');
const start=OFFICIAL.indexOf('  function validate(payload){');
const end=OFFICIAL.indexOf('  // P31-4:',start);
if(start<0||end<=start)throw Error('OFFICIAL_PRINT_VALIDATOR_SOURCE_DRIFT');
const officialValidate=Function('"use strict";'+OFFICIAL.slice(start,end)+'\nreturn validate;')();

function safeClone(value){
  // Never carry custom classes/prototypes, undefined, circular data, nonfinite
  // numbers, symbols, BigInt or functions into a review fingerprint.
  const seen=new Set();
  function walk(x){
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number'&&Number.isFinite(x)&&Number.isSafeInteger(x*10000))return x;
    if(Array.isArray(x)){
      if(seen.has(x))throw Error('DUPLICATE_OR_CYCLIC_OBJECT_REFERENCE');
      seen.add(x);
      const out=x.map(walk);seen.delete(x);return out;
    }
    if(x&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype){
      if(seen.has(x))throw Error('DUPLICATE_OR_CYCLIC_OBJECT_REFERENCE');
      seen.add(x);
      const out={};
      for(const k of Object.keys(x).sort()){
        if(k==='__proto__'||k==='constructor'||k==='prototype')throw Error('UNSAFE_OBJECT_FIELD');
        const val=x[k];
        if(val===undefined)throw Error('UNDEFINED_FIELD');
        out[k]=walk(val);
      }
      seen.delete(x);return out;
    }
    throw Error('INVALID_APPROVAL_DATA_TYPE');
  }
  return walk(value);
}
function hash(value){
  return crypto.createHash('sha256').update(JSON.stringify(safeClone(value))).digest('hex');
}
const duplicate=x=>structuredClone(x);
function validDocument(d){
  if(!d||typeof d!=='object'||Array.isArray(d)||d.schema!=='kushe-external-billing-group-v2'||
    !Number.isSafeInteger(d.revision)||d.revision<1||d.revision>50||
    !['active','archived'].includes(d.status)||
    !String(d.id||'').startsWith('FAKE-GROUP-')||
    !Array.isArray(d.sourceIds)||d.sourceIds.length<2||
    !Array.isArray(d.sourceSnapshots)||!Array.isArray(d.settlementSnapshots))
      throw Error('INVALID_FAKE_APPROVAL_SOURCE');
  if(d.status==='active'){
    // Verbatim official main billing/retention/receipt/recomposition validator:
    officialValidate({schema:'kushe-external-billing-print-v1',document:d,historical:false});
  }
  return d;
}
function changedArrangement(d){
  if(d.schema!=='kushe-external-billing-group-v2')throw Error('UNSUPPORTED_OLD_DOCUMENT');
  const shape=l=>({house:l.house||'',item:l.item,unit:l.unit,qty:l.qty,price:l.price});
  const original=d.sourceSnapshots.flatMap(s=>s.originalLines.map(shape));
  const outward=d.unified.lines.map(shape);
  return !d.sourceSnapshots.every(s=>s.taxMode===d.unified.taxMode)||
    hash(original)!==hash(outward);
}
function identityFor(sessions,handle){
  if(!String(handle||'').startsWith('FAKE-HANDLE-'))throw Error('UNTRUSTED_MOCK_IDENTITY');
  const actor=sessions.get(handle);
  if(!actor||actor.fakeSignatureVerified!==true||actor.fakeSessionActive!==true||
    actor.aal!=='aal2'||!actor.companyId?.startsWith('FAKE-CO-')||
    !actor.userId?.startsWith('FAKE-USER-')||actor.membershipActive!==true)
    throw Error('MOCK_IDENTITY_OR_MFA_DENIED');
  return actor;
}
function checkRole(actor,required){
  if(!required.includes(actor.role))throw Error('FAKE_ROLE_NOT_AUTHORIZED');
}
class MockTrustedApprovalGate{
  #sessions;
  #documents=new Map();
  #approvals=new Map();
  #audit=[];
  #lastAuditHash='GENESIS';
  constructor(sessionHandles){
    this.#sessions=new Map(Object.entries(sessionHandles));
  }
  #actor(handle){return identityFor(this.#sessions,handle);}
  #append(type,actor,id,revision,digest){
    const entry={
      seq:this.#audit.length+1,
      action:type,actor:actor.userId,companyId:actor.companyId,
      documentId:id,revision,digest,
      prevHash:this.#lastAuditHash
    };
    entry.recordHash=hash(entry);
    this.#audit.push(entry);
    this.#lastAuditHash=entry.recordHash;
  }
  #load(id){
    const record=this.#documents.get(id);
    if(!record)throw Error('UNKNOWN_FAKE_DOCUMENT');
    return record;
  }
  #access(actor,record,roles){
    if(actor.companyId!==record.companyId)throw Error('FAKE_CROSS_COMPANY_DENIED');
    if(!actor.allowedDocuments?.includes(record.doc.id))throw Error('FAKE_DOCUMENT_ACL_DENIED');
    checkRole(actor,roles);
  }
  registerInitialTrustedOnly(doc,companyId,editorHandle){
    const editor=this.#actor(editorHandle);
    if(editor.companyId!==companyId)throw Error('FAKE_CROSS_COMPANY_DENIED');
    checkRole(editor,['owner','admin','accounting']);
    if(!editor.allowedDocuments?.includes(doc.id))throw Error('FAKE_DOCUMENT_ACL_DENIED');
    if(!companyId?.startsWith('FAKE-CO-')||this.#documents.has(doc.id))throw Error('DUPLICATE_FAKE_DOCUMENT');
    const x=safeClone(doc);validDocument(x);
    if(x.revision!==1)throw Error('INITIAL_VERSION_MUST_BE_ONE');
    this.#documents.set(x.id,{
      doc:x,companyId,editorId:editor.userId,
      history:[],versionHash:hash(x)
    });
    this.#append('DOCUMENT_REGISTERED',editor,x.id,x.revision,hash(x));
  }
  saveNewRevision(editorHandle,documentId,expectedRevision,mutator){
    const editor=this.#actor(editorHandle);
    const record=this.#load(documentId);
    this.#access(editor,record,['owner','admin','accounting']);
    if(record.doc.status!=='active')throw Error('ARCHIVED_CANNOT_REVISE');
    if(record.doc.revision!==expectedRevision)throw Error('CAS_STALE_VERSION');
    if(record.doc.revision>=50)throw Error('MAXIMUM_VERSIONS');
    if(typeof mutator!=='function')throw Error('FAKE_TRUSTED_STORE_CALLBACK_ONLY');
    const next=duplicate(record.doc);
    mutator(next);
    if(next.id!==record.doc.id||next.schema!==record.doc.schema)
      throw Error('DOCUMENT_ID_OR_SCHEMA_REWRITTEN');
    next.revision=record.doc.revision+1;
    if(next.status!=='active')throw Error('REVISIONS_CANNOT_ARCHIVE_WITHOUT_SEPARATE_GATE');
    const canonical=safeClone(next);
    validDocument(canonical);
    record.history.push({
      revision:record.doc.revision,
      digest:record.versionHash,
      immutableDoc:duplicate(record.doc)
    });
    record.doc=canonical;
    record.versionHash=hash(canonical);
    record.editorId=editor.userId;
    // Old approval remains in the immutable log but cannot approve new version.
    this.#append('REVISION_SAVED',editor,documentId,next.revision,record.versionHash);
    return {revision:record.doc.revision,sourceHash:record.versionHash};
  }
  approveReorganized(reviewerHandle,documentId,expectedRevision,expectedHash){
    const reviewer=this.#actor(reviewerHandle),record=this.#load(documentId);
    this.#access(reviewer,record,['owner','admin']);
    if(reviewer.userId===record.editorId)throw Error('INDEPENDENT_REVIEWER_REQUIRED');
    if(record.doc.status!=='active')throw Error('DOCUMENT_NOT_ACTIVE');
    if(record.doc.revision!==expectedRevision||record.versionHash!==expectedHash||
       record.versionHash!==hash(record.doc))throw Error('APPROVAL_STALE_OR_SOURCE_CHANGED');
    validDocument(record.doc);
    if(!changedArrangement(record.doc))throw Error('NO_REORGANIZATION_TO_APPROVE');
    if(!String(record.doc.unified.reason||'').trim())throw Error('REORGANIZATION_REASON_REQUIRED');
    const key=documentId+'@'+expectedRevision;
    if(this.#approvals.has(key))throw Error('ALREADY_APPROVED');
    const approval=Object.freeze({
      documentId,revision:expectedRevision,
      sourceHash:record.versionHash,companyId:record.companyId,
      reviewerId:reviewer.userId,editorId:record.editorId,
      auditSeq:this.#audit.length+1
    });
    this.#approvals.set(key,approval);
    this.#append('REORGANIZATION_APPROVED',reviewer,documentId,
      expectedRevision,record.versionHash);
    return {approved:true,revision:expectedRevision,sourceHash:record.versionHash};
  }
  authorizationForExport(readHandle,documentId,revision){
    const reader=this.#actor(readHandle),record=this.#load(documentId);
    this.#access(reader,record,['owner','admin','accounting']);
    if(record.doc.status!=='active'||record.doc.revision!==revision)
      throw Error('NOT_CURRENT_ACTIVE_REVISION');
    if(record.versionHash!==hash(record.doc))throw Error('SOURCE_MUTATED_AFTER_REVIEW');
    validDocument(record.doc);
    if(changedArrangement(record.doc)){
      const approval=this.#approvals.get(documentId+'@'+revision);
      if(!approval||approval.sourceHash!==record.versionHash||
        approval.companyId!==record.companyId||
        approval.editorId!==record.editorId)
        throw Error('CURRENT_REVISION_INDEPENDENT_APPROVAL_REQUIRED');
    }
    // This is NOT a PDF-bytes ticket and intentionally does NOT disclose
    // invoices, original rows, actual client View, passwords or ERP snapshots.
    return {allowed:true,documentId,revision,
      sourceHash:record.versionHash,
      independentApprovalRequired:changedArrangement(record.doc),
      evidenceOnly:'FAKE_IN_MEMORY_TEST_ONLY'};
  }
  documentMeta(handle,id){
    const actor=this.#actor(handle),record=this.#load(id);
    this.#access(actor,record,['owner','admin','accounting']);
    return {
      documentId:id,revision:record.doc.revision,
      sourceHash:record.versionHash,
      status:record.doc.status,
      rearranged:changedArrangement(record.doc),
      priorRevisions:record.history.map(x=>x.revision)
    };
  }
  auditMetadata(){
    return duplicate(this.#audit);
  }
  validateAuditChain(){
    let prior='GENESIS';
    for(const entry of this.#audit){
      const {recordHash,...withoutHash}=entry;
      if(entry.prevHash!==prior||hash(withoutHash)!==recordHash)return false;
      prior=recordHash;
    }
    return true;
  }
}
module.exports={MockTrustedApprovalGate,validDocument,changedArrangement,hash};
