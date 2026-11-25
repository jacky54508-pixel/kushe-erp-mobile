'use strict';

// Pure, narrow K23 evidence inspection. No browser, database, network, or write API.
// This is NOT a replacement for Store.recoveryPreview/recoverStore and cannot apply
// a recovery. It accepts only the observed K21 synthetic saveCustomer crash shape.
const { createHash } = require('node:crypto');
const KEYS = Object.freeze({
  journal: 'store:transaction:journal:v1', emergency: 'KuSheERP25_EMERGENCY',
  storeToken: 'KuSheERP25_LOCAL_COMMIT_TOKEN', receiptToken: 'KuSheERP25_RECEIPT_COMMIT_VERSION',
  storeRecovery: 'KuSheERP25_STORE_RECOVERY_REQUIRED', receiptRecovery: 'KuSheERP25_RECEIPT_RECOVERY_REQUIRED',
  receiptActive: 'KuSheERP25_RECEIPT_TRANSACTION_ACTIVE'
});
const SCHEMA = 'kushe-store-transaction-v1';
const PIN = Object.freeze({
  commit: 'edf1c1886aac09958caa9e4b304502cca44f6937',
  blob: '95773d5264d54fe1e1d1cfe54b37a2a2656a9fab',
  sha256: '316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e'
});
const EMPTY_COLLECTIONS = Object.freeze(['projects','employees','dailyLogs','commissions','attendance','payroll',
  'billings','receivables','invoices','receipts','retentionReceipts','salaryPayments','commissionSettlements',
  'bankTransactions','payables','payments','vendors','materials','materialUsages','inventoryReceipts',
  'projectCosts','dailyItemPresets','quotations','quotationPrices','quotationTemplates']);
const BASE_FLAGS = Object.freeze({allowApply:false, canPost:false, productionDataTouched:false,
  realFinancialPostingTested:false, actualBrowserRecoveryTested:false, publishGate:'BLOCKED'});
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const check = (condition, code, message) => { if (!condition) throw Object.assign(new Error(message), {code}); };

// Implements the pinned Store's structural encoding and UTF-16 digest semantics.
// A digest here is the Store's comparison value, not a cryptographic signature.
function fingerprint(value) {
  const seen = new Map(); let nextId = 1;
  const encode = current => {
    if (current === undefined) return ['undefined'];
    if (current === null) return ['null'];
    if (typeof current === 'number') return Number.isNaN(current) ? ['number','NaN'] : current === Infinity ? ['number','Infinity'] : current === -Infinity ? ['number','-Infinity'] : Object.is(current,-0) ? ['number','-0'] : ['number',String(current)];
    if (typeof current === 'string' || typeof current === 'boolean' || typeof current === 'bigint') return [typeof current,String(current)];
    if (typeof current !== 'object') return [typeof current,String(current)];
    if (seen.has(current)) return ['reference',seen.get(current)];
    const id = nextId++; seen.set(current,id);
    if (current instanceof Date) return ['date',id,current.toISOString()];
    if (Array.isArray(current)) return ['array',id,current.map(encode)];
    return ['object',id,Object.keys(current).sort().map(key => [key,encode(current[key])])];
  };
  return JSON.stringify(encode(value));
}
function digest(value) {
  const text = fingerprint(value); let a = 2166136261, b = 0x9e3779b9;
  for (let i=0;i<text.length;i++) { const code=text.charCodeAt(i); a=Math.imul(a^code,16777619)>>>0; b=Math.imul((b+code+i)>>>0,2246822519)>>>0; }
  return `${a.toString(16).padStart(8,'0')}${b.toString(16).padStart(8,'0')}:${text.length}`;
}
const equal = (a,b) => fingerprint(a) === fingerprint(b);
function parseRaw(raw, code, label) {
  check(typeof raw === 'string' && raw.length>0, code, `${label} is missing or not a string`);
  try { return JSON.parse(raw); } catch (_) { check(false,code,`${label} is not valid JSON`); }
}
function revision(value, label) {
  const r=value?.meta?.businessSnapshotRevision;
  check(record(r) && Number.isSafeInteger(r.sequence) && r.sequence>0 &&
    ['id','parentId','operationId','committedAt'].every(k => typeof r[k]==='string' && r[k].length>0),
    'REVISION_INVALID',`${label} revision is incomplete`);
  check(Number.isFinite(Date.parse(r.committedAt)), 'REVISION_INVALID',`${label} timestamp is invalid`);
  return r;
}
function checkToken(raw, r, expectedDigest, code, label) {
  const t=parseRaw(raw,code,label);
  check(record(t) && t.schema===SCHEMA && t.revisionId===r.id && t.sequence===r.sequence &&
    t.stateFingerprint===expectedDigest && t.committedAt===r.committedAt,code,`${label} does not bind to its complete state and revision`);
}
function requireSynthetic(state,label) {
  check(record(state) && state.meta?.k21Synthetic===true,'NOT_SYNTHETIC',`${label} is not marked K21 synthetic`);
  check(Array.isArray(state.customers) && state.customers.every(x => record(x) &&
    typeof x.id==='string' && typeof x.name==='string' && x.name.startsWith('SYN-K21-')),
    'SYNTHETIC_SCOPE',`${label} contains customers outside the K21 fixture`);
  check(new Set(state.customers.map(x=>x.id)).size===state.customers.length,'SYNTHETIC_SCOPE',`${label} contains duplicate customer ids`);
  check(EMPTY_COLLECTIONS.every(k=>Array.isArray(state[k]) && state[k].length===0),
    'SYNTHETIC_SCOPE',`${label} has nonempty or missing out-of-scope business collections`);
  check(Array.isArray(state.banks) && state.banks.length===1 && state.banks[0].id==='SYN-K21-BANK-0' &&
    state.banks[0].name==='SYN-K21-Only-Bank' && state.banks[0].openingBalance===250000 &&
    state.banks[0].balance===250000 && state.banks[0].income===0 && state.banks[0].expense===0,
    'SYNTHETIC_SCOPE',`${label} bank fixture is out of scope`);
  check(Array.isArray(state.audit), 'SYNTHETIC_SCOPE',`${label} audit is not an array`);
}
function verifyPinnedSource(bytes) {
  const actualSha256=sha256(bytes), actualBlob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  check(actualSha256===PIN.sha256 && actualBlob===PIN.blob,'SOURCE_PIN_MISMATCH','Store source bytes do not match the evidence pin');
  return { ...PIN, byteLength:bytes.length, verified:true };
}
function derive(snapshot) {
  check(record(snapshot) && snapshot.dbExists===true && snapshot.storeExists===true &&
    ['idb','local','session'].every(k=>record(snapshot[k])),'SNAPSHOT_SHAPE','Complete captured storage observation is required');
  for (const k of ['main',KEYS.journal,KEYS.storeRecovery,KEYS.receiptRecovery])
    check(Object.hasOwn(snapshot.idb,k),'SNAPSHOT_SHAPE',`Missing captured IDB field ${k}`);
  for (const k of [KEYS.emergency,KEYS.storeToken,KEYS.receiptToken,KEYS.storeRecovery,KEYS.receiptRecovery,KEYS.receiptActive])
    check(Object.hasOwn(snapshot.local,k),'SNAPSHOT_SHAPE',`Missing captured local field ${k}`);
  for (const k of [KEYS.storeRecovery,KEYS.receiptRecovery])
    check(Object.hasOwn(snapshot.session,k),'SNAPSHOT_SHAPE',`Missing captured session field ${k}`);
  const current=snapshot.idb.main,j=snapshot.idb[KEYS.journal];
  requireSynthetic(current,'Current primary');
  check(record(j) && j.schema===SCHEMA && typeof j.operationId==='string' && j.operationId.length>0,
    'JOURNAL_INVALID','Recognized operation journal is required');
  check(j.operationType==='saveCustomer' && !j.recoveryOf && !j.recoveryEvidence,
    'JOURNAL_SCOPE','Only original K21 saveCustomer interruption journals are in scope');
  check(['PRIMARY_WRITTEN','EMERGENCY_WRITTEN'].includes(j.phase),'JOURNAL_PHASE','This journal phase is outside the observed K21 cases');
  check(record(j.steps) && j.steps.journalPrepared===true && j.steps.primaryWritten===true &&
    j.steps.emergencyWritten===(j.phase==='EMERGENCY_WRITTEN') && j.steps.versionWritten===false && j.steps.verified===false,
    'JOURNAL_STEPS','Journal steps do not match the observed incomplete phase');
  check(record(j.before) && j.before.persistentHadValue===true && record(j.before.state),'CHECKPOINT_MISSING','A complete persisted before-checkpoint is required');
  const before=j.before, candidate=before.state;
  requireSynthetic(candidate,'Before checkpoint');
  const beforeRevision=revision(candidate,'Before checkpoint'),currentRevision=revision(current,'Current primary');
  const beforeDigest=digest(candidate),currentDigest=digest(current);
  check(before.persistentFingerprint===beforeDigest,'CHECKPOINT_FINGERPRINT','Before-checkpoint content does not match its stored fingerprint');
  check(equal(before.businessSnapshotRevision,beforeRevision),'CHECKPOINT_REVISION','Checkpoint revision differs from checkpoint content');
  check(record(j.after) && j.after.stateFingerprint===currentDigest,'CURRENT_FINGERPRINT','Current primary is not the interrupted journal after-state');
  check(equal(j.after.businessSnapshotRevision,currentRevision),'CURRENT_REVISION','Journal after-revision differs from current primary');
  check(beforeRevision.sequence===2 && currentRevision.sequence===3 && currentRevision.parentId===beforeRevision.id &&
    currentRevision.operationId===j.operationId && currentRevision.id!==beforeRevision.id,
    'REVISION_LINK','Current revision does not identify the K21 interrupted operation and parent');
  check(candidate.meta.receiptCommitVersion===beforeRevision.id && current.meta.receiptCommitVersion===currentRevision.id,
    'RECEIPT_REVISION','State receipt versions do not match business revisions');
  const checkpointEmergency=parseRaw(before.emergencyRaw,'CHECKPOINT_EMERGENCY','Checkpoint Emergency');
  check(equal(checkpointEmergency,candidate),'CHECKPOINT_EMERGENCY','Checkpoint Emergency does not equal the before state');
  checkToken(before.localCommitTokenRaw,beforeRevision,beforeDigest,'CHECKPOINT_TOKEN','Checkpoint Store token');
  check(before.receiptCommitTokenRaw===beforeRevision.id,'CHECKPOINT_TOKEN','Checkpoint Receipt token does not identify the before state');
  // Deliberately reject all non-null markers: this evidence-only tool does not
  // adjudicate or clear recovery markers, even if they appear to have an owner.
  for (const place of ['idb','local','session']) for (const key of [KEYS.storeRecovery,KEYS.receiptRecovery])
    check(snapshot[place][key]===null,'RECOVERY_MARKER_PRESENT',`${place}.${key} needs a separate recovery-marker review`);
  check(snapshot.local[KEYS.receiptActive]===null,'RECEIPT_ACTIVE','Unresolved receipt active marker is present');
  const mirrorClassifications={};
  const liveEmergency=parseRaw(snapshot.local[KEYS.emergency],'EMERGENCY_UNKNOWN','Captured Emergency');
  if (snapshot.local[KEYS.emergency]===before.emergencyRaw) mirrorClassifications.emergency='EXACT_BEFORE';
  else {
    check(equal(liveEmergency,current),'EMERGENCY_UNKNOWN','Captured Emergency is neither the exact before string nor full current primary');
    mirrorClassifications.emergency='CURRENT_AFTER_STATE';
  }
  if (snapshot.local[KEYS.storeToken]===before.localCommitTokenRaw) mirrorClassifications.storeToken='EXACT_BEFORE';
  else { checkToken(snapshot.local[KEYS.storeToken],currentRevision,currentDigest,'TOKEN_UNKNOWN','Captured Store token'); mirrorClassifications.storeToken='CURRENT_AFTER_STATE'; }
  check([before.receiptCommitTokenRaw,currentRevision.id].includes(snapshot.local[KEYS.receiptToken]),'TOKEN_UNKNOWN','Captured Receipt token belongs to an unknown revision');
  mirrorClassifications.receiptToken=snapshot.local[KEYS.receiptToken]===before.receiptCommitTokenRaw?'EXACT_BEFORE':'CURRENT_AFTER_STATE';
  // Stage completion is not inferred from a newer mirror. K21 recovery remains
  // review-only regardless of which of these known full versions was retained.
  const changedFields=Object.keys({...candidate,...current}).filter(k=>!equal(candidate[k],current[k])).sort();
  check(equal(changedFields,['audit','customers','meta']),'BUSINESS_DELTA_SCOPE','Business changes extend beyond the isolated K21 customer operation');
  const oldById=new Map(candidate.customers.map(row=>[row.id,row]));
  check(current.customers.length===candidate.customers.length+1 && candidate.customers.every(row=>
    current.customers.some(cur=>cur.id===row.id && equal(cur,row))),'BUSINESS_DELTA_SCOPE','Existing customer records changed during this fixture');
  const uncommittedCustomers=current.customers.filter(row=>!oldById.has(row.id));
  check(uncommittedCustomers.length===1 && uncommittedCustomers[0].name.startsWith('SYN-K21-CRASH-'),
    'BUSINESS_DELTA_SCOPE','Exactly one interrupted synthetic customer addition is required');
  check(current.audit.length===candidate.audit.length+1 && equal(current.audit.slice(1),candidate.audit),
    'BUSINESS_DELTA_SCOPE','Audit changes exceed one interrupted operation');
  const oldMeta=clone(candidate.meta),newMeta=clone(current.meta);
  for (const k of ['updatedAt','businessSnapshotRevision','receiptCommitVersion']) {delete oldMeta[k];delete newMeta[k];}
  check(equal(oldMeta,newMeta),'BUSINESS_DELTA_SCOPE','Unexpected metadata changed');
  return {
    schema:'k23-readonly-recovery-preview-v1',status:'REVIEW_ONLY_CANDIDATE',...BASE_FLAGS,
    scope:'SYNTHETIC_K21_SAVE_CUSTOMER_ONLY',operationId:j.operationId,phase:j.phase,
    source:{observationStructuralSha256:sha256(fingerprint(snapshot)),journalStructuralSha256:sha256(fingerprint(j)),
      currentStateSha256:sha256(fingerprint(current)),checkpointStateSha256:sha256(fingerprint(candidate)),
      currentStoreFingerprint:currentDigest,checkpointStoreFingerprint:beforeDigest},
    beforeRevision:clone(beforeRevision),interruptedRevision:clone(currentRevision),
    candidate:{kind:'restore-before-checkpoint',source:'idb.store:transaction:journal:v1.before.state',
      state:clone(candidate),isReadyToApplyPayload:false,
      note:'Business contents only. The original revision-2 object is evidence, not a directly writable restored snapshot.'},
    businessDelta:{changedTopLevelFields:changedFields,customersBefore:candidate.customers.length,customersInterrupted:current.customers.length,
      uncommittedCustomerRecordsRetainedInEvidence:clone(uncommittedCustomers),
      salaryPaymentsBefore:candidate.salaryPayments.length,salaryPaymentsInterrupted:current.salaryPayments.length,
      bankTransactionsBefore:candidate.bankTransactions.length,bankTransactionsInterrupted:current.bankTransactions.length,
      bankFixtureUnchanged:equal(candidate.banks,current.banks)},
    observedMirrors:mirrorClassifications,
    futureRecoveryPlan:{execution:'NOT_EXECUTED',officialAPI:'Store.recoveryPreview then Store.recoverStore',
      contentSource:'Original before-checkpoint business content',newRevisionSequence:currentRevision.sequence+1,
      newRevisionParentId:currentRevision.id,newRevisionId:'ASSIGNED_BY_OFFICIAL_COMMIT_KERNEL',
      newOperationId:'ASSIGNED_BY_OFFICIAL_COMMIT_KERNEL',newAuditEntry:'使用者確認恢復操作前快照; recoveredOperationId points to the interrupted operation',
      primary:'Create a new controlledRecovery commit from checkpoint business content; do not rewind the revision counter',
      emergency:'Regenerate from the complete newly committed recovery snapshot',
      storeToken:'Regenerate with the new revision, sequence, fingerprint and committedAt',
      receiptToken:'Set to the new recovery revision id',
      journal:'Preserve original journal as recoveryEvidence; require COMMIT_VERIFIED and complete state verification',
      gate:'Keep durable recovery protection until official reload and marker compare-and-swap verification complete',
      preserve:'Keep the entire original crash observation and interrupted revision-3 data as evidence; do not auto-forward the incomplete operation'},
    limitations:['No real recovery was applied','No IndexedDB or browser persistence was tested by this pure calculator',
      'No real payroll, bank posting, historical commission correction, or cloud CAS was tested',
      'Known-version mirror classification is not proof of crash durability or business transaction completion']
  };
}
function preview(snapshot) {
  try { return derive(snapshot); }
  catch(error) { return {schema:'k23-readonly-recovery-preview-v1',status:'BLOCKED',...BASE_FLAGS,
    candidate:null,code:error.code||'UNSUPPORTED_INPUT',reason:String(error.message||error)}; }
}
module.exports={preview,fingerprint,digest,sha256,equal,KEYS,PIN,verifyPinnedSource};
