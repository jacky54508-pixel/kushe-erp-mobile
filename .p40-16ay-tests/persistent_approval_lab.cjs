/* P40-16AY — PERSISTENT MOCK APPROVAL JOURNAL, SYNTHETIC ONLY.
 * Local JSONL + fsync laboratory, NOT production ERP, Supabase, JWT/MFA,
 * audit WORM, digital signatures or independently authorized data ingestion.
 * This prototype must NEVER be imported into formal ERP / used for real bills.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const official=fs.readFileSync(path.join(root,'assets/js/external-billing-print.js'),'utf8');
const a=official.indexOf('  function validate(payload){'),b=official.indexOf('  // P31-4:',a);
if(a<0||b<=a)throw Error('PINNED_FORMAL_VALIDATOR_SOURCE_CHANGED');
const validate=Function('"use strict";'+official.slice(a,b)+'\nreturn validate;')();

function canonical(obj){
  const seen=new Set();
  function visit(x,depth){
    if(depth>30)throw Error('EXCESSIVE_DOCUMENT_NESTING');
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number'&&Number.isFinite(x))return x;
    if(Array.isArray(x)){
      if(seen.has(x))throw Error('CYCLE_OR_SHARED_REFERENCE');
      seen.add(x);
      const out=x.map(v=>visit(v,depth+1));seen.delete(x);return out;
    }
    if(x&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype){
      if(seen.has(x))throw Error('CYCLE_OR_SHARED_REFERENCE');
      seen.add(x);
      const out={};
      for(const key of Object.keys(x).sort()){
        if(['__proto__','constructor','prototype'].includes(key))
          throw Error('DANGEROUS_JSON_KEY');
        if(x[key]===undefined)throw Error('UNDEFINED_IN_RECORD');
        out[key]=visit(x[key],depth+1);
      }
      seen.delete(x);return out;
    }
    throw Error('UNSUPPORTED_RECORD_TYPE');
  }
  const s=JSON.stringify(visit(obj,0));
  if(Buffer.byteLength(s)>1_000_000)throw Error('DOCUMENT_TOO_LARGE');
  return s;
}
const digest=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
const copy=x=>JSON.parse(canonical(x));
function officialCheck(doc){
  if(!doc||!String(doc.id||'').startsWith('FAKE-GROUP-')||
     !Number.isSafeInteger(doc.revision)||doc.revision<1||doc.revision>50||
     doc.status!=='active')throw Error('ACTIVE_SYNTHETIC_DOCUMENT_REQUIRED');
  validate({schema:'kushe-external-billing-print-v1',historical:false,document:doc});
  return doc;
}
function rearranged(d){
  if(d.schema!=='kushe-external-billing-group-v2')return true; // unsupported legacy rearrangement -> review
  const shape=l=>({house:l.house||'',item:l.item,unit:l.unit,qty:l.qty,price:l.price});
  return !d.sourceSnapshots.every(s=>s.taxMode===d.unified.taxMode)||
    digest(d.sourceSnapshots.flatMap(s=>s.originalLines.map(shape)))!==
    digest(d.unified.lines.map(shape));
}
function actor(sessions,handle){
  const x=sessions[handle];
  if(typeof handle!=='string'||!handle.startsWith('FAKE-HANDLE-')||
      !x||x.fakeVerified!==true||x.sessionActive!==true||
      x.membershipActive!==true||x.aal!=='aal2'||
      !String(x.userId||'').startsWith('FAKE-USER-')||
      !String(x.companyId||'').startsWith('FAKE-CO-'))
    throw Error('FAKE_AUTH_OR_MFA_DENIED');
  return x;
}
function authorize(x,s,roles){
  if(s.companyId!==x.companyId)throw Error('CROSS_COMPANY_ACCESS_DENIED');
  if(!x.allowedDocuments?.includes(s.documentId))throw Error('DOCUMENT_ACL_DENIED');
  if(!roles.includes(x.role))throw Error('ROLE_DENIED');
}
class ApprovalJournalLab{
  #file; #sessions; #events=[]; #meta=new Map(); #attached=new Map();
  constructor(file,sessions={}){
    if(!path.isAbsolute(file)||!file.includes('p40ay-'))
      throw Error('ISOLATED_TEMP_JOURNAL_PATH_REQUIRED');
    this.#file=file;this.#sessions={...sessions};
    if(fs.existsSync(file)){
      const data=fs.readFileSync(file,'utf8');
      if(data&&!data.endsWith('\n'))throw Error('JOURNAL_TRUNCATED');
      const lines=data.split('\n').filter(Boolean);
      for(const line of lines){
        let entry;
        try{entry=JSON.parse(line)}catch(_){throw Error('JOURNAL_MALFORMED')}
        this.#replay(entry);
      }
    }
  }
  #replay(event){
    const {eventHash,...body}=event;
    if(!eventHash||body.seq!==this.#events.length+1||
      body.prevHash!==(this.#events.at(-1)?.eventHash||'GENESIS')||
      eventHash!==digest(body))throw Error('AUDIT_CHAIN_INVALID');
    const state=this.#meta.get(body.documentId);
    if(body.action==='ENROLLED'){
      if(state||!['legacy','enforced'].includes(body.mode)||
        !String(body.companyId||'').startsWith('FAKE-CO-')||
        !Number.isSafeInteger(body.revision)||body.revision<1||
        !/^[0-9a-f]{64}$/.test(body.sourceHash))
        throw Error('INVALID_ENROLMENT_EVENT');
      this.#meta.set(body.documentId,{documentId:body.documentId,
        companyId:body.companyId,mode:body.mode,revision:body.revision,
        sourceHash:body.sourceHash,editorId:body.actorId,approvedHash:null});
    }else if(body.action==='REVISED'){
      if(!state||body.previousRevision!==state.revision||
        body.revision!==state.revision+1||body.mode!=='enforced'||
        !/^[0-9a-f]{64}$/.test(body.sourceHash))
        throw Error('INVALID_REVISION_EVENT');
      Object.assign(state,{mode:'enforced',revision:body.revision,
        sourceHash:body.sourceHash,editorId:body.actorId,approvedHash:null});
    }else if(body.action==='APPROVED'){
      if(!state||state.mode!=='enforced'||state.revision!==body.revision||
        state.sourceHash!==body.sourceHash||state.approvedHash||
        body.actorId===state.editorId)throw Error('INVALID_APPROVAL_EVENT');
      state.approvedHash=body.sourceHash;
    }else throw Error('UNKNOWN_JOURNAL_ACTION');
    this.#events.push(event);
  }
  #append(body){
    const entry={seq:this.#events.length+1,
      prevHash:this.#events.at(-1)?.eventHash||'GENESIS',
      ...body};
    const event={...entry,eventHash:digest(entry)};
    const lock=this.#file+'.lock';
    let lockFd;
    try{
      lockFd=fs.openSync(lock,'wx',0o600); // competing writer fails CLOSED
      const onDisk=fs.existsSync(this.#file)?
        fs.readFileSync(this.#file,'utf8'):'';
      const lastOnDisk=onDisk?onDisk.trimEnd().split('\n').at(-1):null;
      if(onDisk&&!onDisk.endsWith('\n'))throw Error('JOURNAL_TRUNCATED');
      if(lastOnDisk){
        let last;
        try{last=JSON.parse(lastOnDisk)}catch(_){throw Error('JOURNAL_MALFORMED')}
        if(last.eventHash!==(this.#events.at(-1)?.eventHash||'GENESIS'))
          throw Error('CONCURRENT_LEDGER_CHANGE');
      }else if(this.#events.length!==0)throw Error('LEDGER_WAS_DELETED');
      const fd=fs.openSync(this.#file,'a',0o600);
      try{
        fs.writeSync(fd,JSON.stringify(event)+'\n');
        fs.fsyncSync(fd);
      }finally{fs.closeSync(fd)}
      this.#replay(event);
    }finally{
      if(lockFd!==undefined){
        fs.closeSync(lockFd);
        fs.unlinkSync(lock);
      }
    }
    return event;
  }
  #who(handle){return actor(this.#sessions,handle)}
  #state(id){const s=this.#meta.get(id);if(!s)throw Error('UNREGISTERED_DOCUMENT');return s}
  #current(id){
    const s=this.#state(id),doc=this.#attached.get(id);
    if(!doc||digest(doc)!==s.sourceHash||
      doc.revision!==s.revision)throw Error('TRUSTED_SOURCE_NOT_ATTACHED_OR_CHANGED');
    officialCheck(doc);return {s,doc};
  }
  // registration and reattachment deliberately require TEST-ONLY trusted source
  // hint. This is NOT an independently secure production ingestion pathway.
  enrol(doc,companyId,handle,{existingLegacy=false,sourceTrusted=false}={}){
    if(sourceTrusted!==true)throw Error('TRUSTED_INGESTION_REQUIRED');
    const who=this.#who(handle),d=copy(doc);officialCheck(d);
    if(!String(companyId||'').startsWith('FAKE-CO-'))throw Error('FAKE_COMPANY_ONLY');
    if(who.companyId!==companyId||!who.allowedDocuments?.includes(d.id)||
        !['owner','admin','accounting'].includes(who.role))
      throw Error('FAKE_ENROL_PERMISSION_DENIED');
    if(this.#meta.has(d.id))throw Error('DOCUMENT_ALREADY_ENROLLED');
    if(!existingLegacy&&d.revision!==1)
      throw Error('NEW_DOCUMENT_REVISION_MUST_BE_ONE');
    this.#append({action:'ENROLLED',documentId:d.id,
      companyId,mode:existingLegacy?'legacy':'enforced',
      revision:d.revision,sourceHash:digest(d),actorId:who.userId});
    this.#attached.set(d.id,d);
    return this.metadata(handle,d.id);
  }
  reattachFromTrustedSource(id,doc,sourceTrusted=false){
    if(sourceTrusted!==true)throw Error('TRUSTED_INGESTION_REQUIRED');
    const s=this.#state(id),d=copy(doc);officialCheck(d);
    if(d.id!==id||d.revision!==s.revision||digest(d)!==s.sourceHash)
      throw Error('REATTACH_SOURCE_HASH_MISMATCH');
    this.#attached.set(id,d);
  }
  metadata(handle,id){
    const x=this.#who(handle),s=this.#state(id);
    authorize(x,s,['owner','admin','accounting']);
    return {documentId:id,revision:s.revision,
      sourceHash:s.sourceHash,mode:s.mode,
      awaitingApproval:s.mode==='enforced'&&s.approvedHash!==s.sourceHash};
  }
  revise(handle,id,expectedRevision,modify){
    const x=this.#who(handle),{s,doc}=this.#current(id);
    authorize(x,s,['owner','admin','accounting']);
    if(s.revision!==expectedRevision)throw Error('STALE_CAS_REVISION');
    if(s.revision>=50)throw Error('MAXIMUM_REVISIONS');
    if(typeof modify!=='function')throw Error('TRUSTED_STORE_MUTATION_REQUIRED');
    const next=copy(doc);
    modify(next);
    if(next.id!==id||next.schema!==doc.schema)
      throw Error('SOURCE_IDENTITY_CHANGED');
    next.revision=s.revision+1;
    officialCheck(next);
    const sourceHash=digest(next);
    this.#append({action:'REVISED',documentId:id,companyId:s.companyId,
      previousRevision:s.revision,revision:next.revision,sourceHash,
      mode:'enforced',actorId:x.userId});
    this.#attached.set(id,next);
    return this.metadata(handle,id);
  }
  approve(handle,id,revision,expectedHash){
    const reviewer=this.#who(handle),{s,doc}=this.#current(id);
    authorize(reviewer,s,['owner','admin']);
    if(s.mode!=='enforced')throw Error('LEGACY_NOT_ENFORCED');
    if(reviewer.userId===s.editorId)throw Error('SEPARATE_REVIEWER_REQUIRED');
    if(s.revision!==revision||s.sourceHash!==expectedHash)
      throw Error('STALE_APPROVAL_REQUEST');
    if(!rearranged(doc))throw Error('NO_REARRANGEMENT_NEEDS_APPROVAL');
    if(s.approvedHash===s.sourceHash)throw Error('ALREADY_APPROVED');
    this.#append({action:'APPROVED',documentId:id,
      companyId:s.companyId,revision,sourceHash:s.sourceHash,
      actorId:reviewer.userId});
    return this.metadata(handle,id);
  }
  printDecision(handle,id,revision){
    const reader=this.#who(handle),{s,doc}=this.#current(id);
    authorize(reader,s,['owner','admin','accounting']);
    if(s.revision!==revision)throw Error('NOT_CURRENT_VERSION');
    if(s.mode==='legacy'){
      // COMPATIBILITY contract only: no retroactive forced approval on
      // untouched, previously active saved bills; existing real print
      // routing is NOT modified or intercepted.
      return {allowed:true,scope:'PREEXISTING_LEGACY_COMPATIBILITY',
        version:revision,sourceHash:s.sourceHash,needsReview:false};
    }
    if(rearranged(doc)&&s.approvedHash!==s.sourceHash)
      throw Error('NEW_REVISION_REQUIRES_INDEPENDENT_APPROVAL');
    return {allowed:true,scope:'NEW_ENFORCED_VERSION',
      version:revision,sourceHash:s.sourceHash,
      needsReview:rearranged(doc)};
  }
  auditLog(){
    // SAFETY: only digest + FAKE ids, not source line items or invoices
    return copy(this.#events);
  }
  verify(){return this.#events.every((e,i)=>{
    const {eventHash,...body}=e;
    return body.seq===i+1&&body.prevHash===(this.#events[i-1]?.eventHash||'GENESIS')
      &&digest(body)===eventHash;
  })}
}
module.exports={ApprovalJournalLab,digest,officialCheck,rearranged};
