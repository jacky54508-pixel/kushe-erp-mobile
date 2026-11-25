'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {preview,fingerprint,digest,sha256,KEYS:K,PIN,verifyPinnedSource}=require('./k23_preview.cjs');
const root=path.resolve(__dirname,'../..');
const evidence=path.resolve(process.argv[2]||path.join(root,'k21_work/evidence_v4_20261124_214334_e42ecb/evidence_bundle'));
const sourceFile=path.resolve(process.argv[3]||path.join(root,'k21_work/reference/erp-store.js'));
const outputDirectory=process.argv[4]?path.resolve(process.argv[4]):null;
const caseNames=['PRIMARY_WRITTEN_before_emergency','EMERGENCY_WRITTEN_before_store_token','EMERGENCY_WRITTEN_before_receipt_token'];
const knownDigests=[['1faa9d386cd4377e:2281','724bb60e19d99637:2826'],['4655d4930b857261:2281','6df6fe962b6e1a4f:2834'],['0d10fd3ff2bd4b53:2281','7f8a5163829d3b04:2838']];
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const readCase=(name,file)=>readJson(path.join(evidence,name,'evidence',file));
const observations=caseNames.map(name=>readCase(name,'08_raw_after_crash_before_any_store_script.json'));
const sourceBytes=fs.readFileSync(sourceFile);
const inputHashes=new Map();
for(const name of caseNames)for(const file of ['08_raw_after_crash_before_any_store_script.json','05_baseline_ready_for_crash.json']){
  const p=path.join(evidence,name,'evidence',file);inputHashes.set(p,sha256(fs.readFileSync(p)));
}
let tests=0,failures=0;const testResults=[],logLines=[];
function emit(line,error=false){logLines.push(line);if(error)console.error(line);else console.log(line)}
function test(name,work){try{work();tests++;testResults.push({name,pass:true});emit(`PASS ${name}`)}catch(error){tests++;failures++;testResults.push({name,pass:false,error:error.message});emit(`FAIL ${name}: ${error.stack}`,true)}}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
function safeFlags(result){assert.equal(result.allowApply,false);assert.equal(result.canPost,false);assert.equal(result.publishGate,'BLOCKED');assert.equal(result.productionDataTouched,false);assert.equal(result.actualBrowserRecoveryTested,false)}
function reject(name,mutate,code){test(name,()=>{const observation=structuredClone(observations[0]);mutate(observation);const before=fingerprint(observation);freeze(observation);const result=preview(observation);assert.equal(result.status,'BLOCKED');assert.equal(result.candidate,null);assert.equal(result.code,code);safeFlags(result);assert.equal(fingerprint(observation),before)})}
test('Pinned official Store source SHA-256 and Git blob match',()=>{const r=verifyPinnedSource(sourceBytes);assert.equal(r.verified,true);assert.equal(r.sha256,PIN.sha256);assert.equal(r.blob,PIN.blob)});
test('Different Store bytes are refused',()=>assert.throws(()=>verifyPinnedSource(Buffer.concat([sourceBytes,Buffer.from('\n')])),{code:'SOURCE_PIN_MISMATCH'}));
caseNames.forEach((name,i)=>test(`Saved crash case ${i+1}: independently corroborated checkpoint, pure preview and revision plan`,()=>{
  const observation=structuredClone(observations[i]),before=fingerprint(observation);freeze(observation);
  const result=preview(observation),baseline=readCase(name,'05_baseline_ready_for_crash.json');
  assert.equal(result.status,'REVIEW_ONLY_CANDIDATE');safeFlags(result);
  assert.deepEqual(result.candidate.state,baseline.idb.main);assert.notStrictEqual(result.candidate.state,observation.idb[K.journal].before.state);
  assert.equal(result.candidate.isReadyToApplyPayload,false);
  assert.equal(result.source.checkpointStoreFingerprint,knownDigests[i][0]);assert.equal(result.source.currentStoreFingerprint,knownDigests[i][1]);
  assert.equal(result.beforeRevision.sequence,2);assert.equal(result.interruptedRevision.sequence,3);
  assert.equal(result.futureRecoveryPlan.newRevisionSequence,4);assert.equal(result.futureRecoveryPlan.newRevisionParentId,result.interruptedRevision.id);
  assert.deepEqual(result.observedMirrors,{emergency:'EXACT_BEFORE',storeToken:'EXACT_BEFORE',receiptToken:'EXACT_BEFORE'});
  assert.equal(result.businessDelta.customersBefore,2);assert.equal(result.businessDelta.customersInterrupted,3);
  assert.equal(result.businessDelta.uncommittedCustomerRecordsRetainedInEvidence.length,1);
  assert.equal(result.businessDelta.bankFixtureUnchanged,true);assert.equal(result.businessDelta.salaryPaymentsInterrupted,0);assert.equal(result.businessDelta.bankTransactionsInterrupted,0);
  assert.equal(fingerprint(observation),before);
  result.candidate.state.customers[0].name='changed output only';assert.equal(fingerprint(observation),before);
}));
reject('Missing checkpoint refused',o=>delete o.idb[K.journal].before,'CHECKPOINT_MISSING');
reject('Checkpoint not persistently captured refused',o=>o.idb[K.journal].before.persistentHadValue=false,'CHECKPOINT_MISSING');
reject('Damaged checkpoint content refused',o=>o.idb[K.journal].before.state.customers[0].note='corrupt','CHECKPOINT_FINGERPRINT');
reject('Damaged checkpoint fingerprint refused',o=>o.idb[K.journal].before.persistentFingerprint='wrong','CHECKPOINT_FINGERPRINT');
reject('Checkpoint metadata revision mismatch refused',o=>o.idb[K.journal].before.businessSnapshotRevision.id='different','CHECKPOINT_REVISION');
reject('Unrelated primary state refused',o=>o.idb.main.customers[0].note='someone else edited','CURRENT_FINGERPRINT');
reject('Journal after revision mismatch refused',o=>o.idb[K.journal].after.businessSnapshotRevision.id='other','CURRENT_REVISION');
reject('Wrong operation ownership refused',o=>o.idb[K.journal].operationId='other-operation','REVISION_LINK');
reject('Wrong parent chain refused even with recomputed after fingerprint',o=>{o.idb.main.meta.businessSnapshotRevision.parentId='unrelated-parent';o.idb[K.journal].after.businessSnapshotRevision.parentId='unrelated-parent';o.idb[K.journal].after.stateFingerprint=digest(o.idb.main)},'REVISION_LINK');
reject('Current primary synthetic flag required',o=>o.idb.main.meta.k21Synthetic=false,'NOT_SYNTHETIC');
reject('Checkpoint synthetic flag required',o=>o.idb[K.journal].before.state.meta.k21Synthetic=false,'NOT_SYNTHETIC');
reject('Real customer names excluded despite synthetic marker',o=>o.idb.main.customers[0].name='ordinary production customer','SYNTHETIC_SCOPE');
reject('Salary posting evidence excluded from this fixture scope',o=>o.idb.main.salaryPayments.push({id:'SYN-salary',amount:10}),'SYNTHETIC_SCOPE');
reject('Bank posting evidence excluded from this fixture scope',o=>o.idb.main.bankTransactions.push({id:'SYN-bank',amount:10}),'SYNTHETIC_SCOPE');
reject('Changed bank balances excluded',o=>o.idb.main.banks[0].balance=1,'SYNTHETIC_SCOPE');
for(const place of ['idb','local','session'])for(const key of [K.storeRecovery,K.receiptRecovery])
  reject(`Foreign recovery marker refused: ${place}.${key}`,o=>{o[place][key]=place==='idb'?{operationId:'other'}:JSON.stringify({operationId:'other'})},'RECOVERY_MARKER_PRESENT');
reject('Even an owned marker requires separate review',o=>o.idb[K.storeRecovery]={operationId:o.idb[K.journal].operationId},'RECOVERY_MARKER_PRESENT');
reject('Unresolved receipt active marker refused',o=>o.local[K.receiptActive]='{}','RECEIPT_ACTIVE');
reject('Unknown Emergency full state refused',o=>{const value=JSON.parse(o.local[K.emergency]);value.customers[0].note='other';o.local[K.emergency]=JSON.stringify(value)},'EMERGENCY_UNKNOWN');
reject('Malformed Emergency JSON refused',o=>o.local[K.emergency]='{bad','EMERGENCY_UNKNOWN');
reject('Missing Emergency refused',o=>o.local[K.emergency]=null,'EMERGENCY_UNKNOWN');
reject('Unknown Store token refused',o=>{const t=JSON.parse(o.local[K.storeToken]);t.revisionId='unknown';o.local[K.storeToken]=JSON.stringify(t)},'TOKEN_UNKNOWN');
reject('Malformed Store token refused',o=>o.local[K.storeToken]='{bad','TOKEN_UNKNOWN');
reject('Unknown Receipt token refused',o=>o.local[K.receiptToken]='unknown','TOKEN_UNKNOWN');
reject('Damaged checkpoint Emergency refused',o=>o.idb[K.journal].before.emergencyRaw='{}','CHECKPOINT_EMERGENCY');
reject('Damaged checkpoint Store token refused',o=>o.idb[K.journal].before.localCommitTokenRaw='{}','CHECKPOINT_TOKEN');
reject('Wrong checkpoint Receipt token refused',o=>o.idb[K.journal].before.receiptCommitTokenRaw='unknown','CHECKPOINT_TOKEN');
reject('Terminal commit is outside this incomplete-operation preview',o=>o.idb[K.journal].phase='COMMIT_VERIFIED','JOURNAL_PHASE');
reject('Unknown journal phase refused',o=>o.idb[K.journal].phase='UNRECOGNIZED','JOURNAL_PHASE');
reject('Inconsistent phase flags refused',o=>o.idb[K.journal].steps.verified=true,'JOURNAL_STEPS');
reject('Different operation type refused',o=>o.idb[K.journal].operationType='salaryPayment','JOURNAL_SCOPE');
reject('Nested recovery chain requires separate review',o=>o.idb[K.journal].recoveryEvidence={},'JOURNAL_SCOPE');
reject('Missing captured field refused',o=>delete o.local[K.receiptActive],'SNAPSHOT_SHAPE');
reject('Missing database refused',o=>o.dbExists=false,'SNAPSHOT_SHAPE');
test('Null input safely blocked',()=>{const r=preview(null);assert.equal(r.status,'BLOCKED');assert.equal(r.code,'SNAPSHOT_SHAPE');safeFlags(r)});
test('Verified after-state mirrors remain review-only, never a committed transaction',()=>{
  const o=structuredClone(observations[1]),j=o.idb[K.journal],r=o.idb.main.meta.businessSnapshotRevision;
  o.local[K.emergency]=JSON.stringify(o.idb.main);o.local[K.storeToken]=JSON.stringify({schema:j.schema,revisionId:r.id,sequence:r.sequence,stateFingerprint:j.after.stateFingerprint,committedAt:r.committedAt});o.local[K.receiptToken]=r.id;
  const p=preview(o);assert.equal(p.status,'REVIEW_ONLY_CANDIDATE');safeFlags(p);assert.equal(p.candidate.state.meta.businessSnapshotRevision.sequence,2);
  assert.deepEqual(p.observedMirrors,{emergency:'CURRENT_AFTER_STATE',storeToken:'CURRENT_AFTER_STATE',receiptToken:'CURRENT_AFTER_STATE'});
});
test('All inspected evidence files remain byte-identical',()=>{for(const [p,hash] of inputHashes)assert.equal(sha256(fs.readFileSync(p)),hash)});
const summary={schema:'k23-preview-regressions-v1',tests,passed:tests-failures,failed:failures,
  scope:'Pure offline evidence calculation only; no browser recovery, database writes, or production modification',
  sourcePin:PIN,inputFileSha256:Object.fromEntries(inputHashes),results:testResults};
const summaryText=JSON.stringify(summary,null,2);
emit(summaryText);
if(outputDirectory){
  fs.mkdirSync(outputDirectory,{recursive:true});
  fs.writeFileSync(path.join(outputDirectory,'K23_PREVIEW_TESTS.json'),summaryText+'\n');
  fs.writeFileSync(path.join(outputDirectory,'K23_PREVIEW_TESTS.log'),logLines.join('\n')+'\n');
}
if(failures)process.exitCode=1;
