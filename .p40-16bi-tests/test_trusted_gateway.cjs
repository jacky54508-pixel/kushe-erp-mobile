'use strict';
/**
 * P40-16BI | ISOLATED FAKE INTEGRATION ONLY.
 * Node.js built-in crypto (real ES256 math, fake newly generated key) + temporary
 * node:sqlite DB (real local SQL transaction, NOT PostgreSQL/Supabase RLS).
 * No requests, secrets, production database, ERP files, or PDF bytes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash, generateKeyPairSync, sign, verify} = require('node:crypto');
const NOW = 1800000000; // deterministic FAKE time, not production clock
const ISS = 'https://fake-issuer.invalid/auth/v1';
const AUD = 'authenticated';
const SECRET_MARKERS = ['PRIVATE_OTHER_ZONE_B','PRIVATE_INVOICE','PRIVATE_BANK','PRIVATE_PAYROLL','PRIVATE_COMMISSION','PRIVATE_INTERNAL_NOTE','PRIVATE_REASON','PRIVATE_HR'];
const copy = v => structuredClone(v);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = code => { const e=new Error(code);e.code=code;throw e; };
const requireSafeInt = x => Number.isSafeInteger(x)&&x>=0;
const b64 = v => Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const decode64 = str => {
  if (typeof str!=='string'||!/^[A-Za-z0-9_-]+$/.test(str)) fail('INVALID_JWT');
  const buf=Buffer.from(str,'base64url');
  if (buf.toString('base64url')!==str) fail('INVALID_JWT');
  try {return JSON.parse(buf.toString('utf8'));}catch {fail('INVALID_JWT');}
};
function createFakeAuthority(){
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const kid='fake-p256-current';
  function issue(overrides={},headerOverrides={}){
    const header={typ:'JWT',alg:'ES256',kid,...headerOverrides};
    const claims={iss:ISS,aud:AUD,sub:'owner-A',session_id:'session-A',aal:'aal2',iat:NOW-30,nbf:NOW-30,exp:NOW+180,...overrides};
    const signingInput=b64(header)+'.'+b64(claims);
    const signature=sign('sha256',Buffer.from(signingInput),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    return signingInput+'.'+signature;
  }
  function verifyToken(jwt){
    if(typeof jwt!=='string')fail('INVALID_JWT');
    const parts=jwt.split('.');if(parts.length!==3)fail('INVALID_JWT');
    const [h,p,s]=parts,header=decode64(h),claim=decode64(p);
    if(!header||header.typ!=='JWT'||header.alg!=='ES256'||header.kid!==kid)fail('ALGORITHM_OR_KID_DENIED');
    if(!/^[A-Za-z0-9_-]+$/.test(s)||Buffer.from(s,'base64url').length!==64)fail('INVALID_JWT');
    if(!verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')))fail('BAD_SIGNATURE');
    if(claim.iss!==ISS||claim.aud!==AUD)fail('ISSUER_OR_AUDIENCE_DENIED');
    if(!Number.isInteger(claim.exp)||claim.exp<=NOW||!Number.isInteger(claim.nbf)||claim.nbf>NOW||!Number.isInteger(claim.iat)||claim.iat>NOW)fail('TOKEN_EXPIRED_OR_NOT_YET_VALID');
    if(typeof claim.sub!=='string'||!claim.sub||typeof claim.session_id!=='string'||!claim.session_id)fail('MISSING_IDENTITY');
    if(claim.aal!=='aal2')fail('MFA_REQUIRED');
    return {userId:claim.sub,sessionId:claim.session_id};
  }
  return {issue,verifyToken};
}
const baseDoc=(id,companyId,targetBillingId,sources)=>({
  id,companyId,revision:1,status:'active',targetBillingId,sourceIds:sources.map(s=>s.billingId),sources,
  customerName:'虛構客戶',documentDate:'2026-11-19',publicNote:'虛構對外備註',publicNoteReviewed:true,
  internalNote:'PRIVATE_INTERNAL_NOTE',sourceSnapshots:{invoice:'PRIVATE_INVOICE',bank:'PRIVATE_BANK',salary:'PRIVATE_PAYROLL'},
  unified:{taxMode:'未稅',reason:'PRIVATE_REASON',lines:[{house:'1A',item:'壁面修繕',unit:'式',qty:2,price:1000,amount:2000,personnel:'PRIVATE_HR'}]},
  totals:{untaxed:2000,tax:100,grossTotal:2100,retention:105,receivable:1995,commission:999}
});
const fakeSource=(billingId,projectName)=>({billingId,projectName,sourceVersion:'fake-src-r1',invoiceNo:'PRIVATE_INVOICE'});
function seedDocuments(){
  const A=fakeSource('bill-A','目標 A 區'),B=fakeSource('bill-B','PRIVATE_OTHER_ZONE_B'),C=fakeSource('bill-C','其他公司 C 區');
  return [baseDoc('doc-AB','company-A','bill-A',[A,B]),baseDoc('doc-C','company-B','bill-C',[C])];
}
function projectDocument(d){
  if(!d||typeof d.id!=='string'||!d.id||typeof d.companyId!=='string'||!d.companyId||!Number.isInteger(d.revision)||d.revision<1||d.status!=='active'||d.publicNoteReviewed!==true)fail('DOCUMENT_UNAPPROVED');
  if(!Array.isArray(d.sourceIds)||!Array.isArray(d.sources)||!d.sources.length||d.sourceIds.length!==d.sources.length)fail('BAD_SOURCES');
  if(d.sources.some((s,i)=>!s||s.billingId!==d.sourceIds[i]||typeof s.sourceVersion!=='string'||!s.sourceVersion)||new Set(d.sourceIds).size!==d.sourceIds.length)fail('BAD_SOURCE_VERSION');
  const target=d.sources.find(s=>s.billingId===d.targetBillingId);
  if(!target||typeof target.projectName!=='string'||!target.projectName)fail('TARGET_DENIED');
  if(typeof d.customerName!=='string'||!d.customerName||typeof d.documentDate!=='string'||typeof d.publicNote!=='string')fail('INVALID_PUBLIC_FIELD');
  if(!['未稅','含稅'].includes(d.unified?.taxMode)||!Array.isArray(d.unified?.lines)||!d.unified.lines.length||d.unified.lines.length>300)fail('INVALID_LINES');
  const lines=d.unified.lines.map(l=>{
    if(!l||typeof l.house!=='string'||typeof l.item!=='string'||!l.item||typeof l.unit!=='string'||!l.unit||!Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.price)||l.price<0||!requireSafeInt(l.amount))fail('INVALID_LINE');
    return {house:l.house,item:l.item,unit:l.unit,qty:l.qty,price:l.price,amount:l.amount};
  });
  const keys=['untaxed','tax','grossTotal','retention','receivable'];
  if(keys.some(k=>!requireSafeInt(d.totals?.[k])))fail('INVALID_TOTALS');
  const totals=Object.fromEntries(keys.map(k=>[k,d.totals[k]]));
  if(totals.untaxed+totals.tax!==totals.grossTotal||totals.grossTotal-totals.retention!==totals.receivable)fail('TOTAL_MISMATCH');
  const view={schema:'p40bi-fake-public-view-v1',customerName:d.customerName,projectName:target.projectName,documentDate:d.documentDate,publicNote:d.publicNote,taxMode:d.unified.taxMode,lines,totals};
  const sourceHash=hash({id:d.id,companyId:d.companyId,revision:d.revision,targetBillingId:d.targetBillingId,sourceIds:d.sourceIds,sourceVersions:d.sources.map(s=>s.sourceVersion),view});
  return {view,sourceHash};
}
function initDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE root_states(company_id TEXT PRIMARY KEY, sync_version INTEGER NOT NULL CHECK(sync_version>0), snapshot_json TEXT NOT NULL);
    CREATE TABLE projections(document_id TEXT PRIMARY KEY,company_id TEXT NOT NULL, revision INTEGER NOT NULL,target_billing_id TEXT NOT NULL,source_sync_version INTEGER NOT NULL,source_hash TEXT NOT NULL,public_json TEXT NOT NULL);
    CREATE TABLE approvals(document_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,source_sync_version INTEGER NOT NULL,source_hash TEXT NOT NULL, reviewer_user_id TEXT NOT NULL);
    CREATE TABLE memberships(company_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(company_id,user_id));
    CREATE TABLE document_acl(document_id TEXT NOT NULL,user_id TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(document_id,user_id));
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,active INTEGER NOT NULL);
  `);
  db.prepare('INSERT INTO memberships VALUES(?,?,?,?)').run('company-A','owner-A','owner',1);
  db.prepare('INSERT INTO memberships VALUES(?,?,?,?)').run('company-A','employee-A','employee',1);
  db.prepare('INSERT INTO memberships VALUES(?,?,?,?)').run('company-A','owner-unlisted','owner',1);
  db.prepare('INSERT INTO memberships VALUES(?,?,?,?)').run('company-B','owner-B','owner',1);
  db.prepare('INSERT INTO document_acl VALUES(?,?,?)').run('doc-AB','owner-A',1);
  db.prepare('INSERT INTO document_acl VALUES(?,?,?)').run('doc-AB','employee-A',1);
  db.prepare('INSERT INTO document_acl VALUES(?,?,?)').run('doc-C','owner-B',1);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-A','owner-A',1);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-E','employee-A',1);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-U','owner-unlisted',1);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session-B','owner-B',1);
  return db;
}
/** FAKE trusted ingestion (the actual production trust boundary is NOT solved).
  A transaction connects snapshot and document projection versions in one SQLite DB. */
function commitFakeSnapshot(db,companyId,expectedVersion,nextDocs,{fault}={}){
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Array.isArray(nextDocs))fail('INVALID_INPUT');
  if(nextDocs.some(d=>d.companyId!==companyId))fail('CROSS_COMPANY_INGEST');
  if(new Set(nextDocs.map(d=>d.id)).size!==nextDocs.length)fail('DUPLICATE_DOCUMENT');
  const projected=nextDocs.map(d=>({...projectDocument(d),doc:d}));
  db.exec('BEGIN IMMEDIATE');
  try{
    const current=db.prepare('SELECT sync_version FROM root_states WHERE company_id=?').get(companyId);
    if((current?.sync_version||0)!==expectedVersion)fail('STALE_SOURCE_VERSION');
    const nextVersion=expectedVersion+1;
    if(current)db.prepare('UPDATE root_states SET sync_version=?,snapshot_json=? WHERE company_id=? AND sync_version=?').run(nextVersion,JSON.stringify(nextDocs),companyId,expectedVersion);
    else db.prepare('INSERT INTO root_states(company_id,sync_version,snapshot_json) VALUES(?,?,?)').run(companyId,nextVersion,JSON.stringify(nextDocs));
    if(fault==='AFTER_ROOT')fail('FAULT_INJECTED_AFTER_ROOT');
    db.prepare('DELETE FROM projections WHERE company_id=?').run(companyId);
    const ins=db.prepare('INSERT INTO projections(document_id,company_id,revision,target_billing_id,source_sync_version,source_hash,public_json) VALUES(?,?,?,?,?,?,?)');
    for(const {doc,sourceHash,view} of projected)ins.run(doc.id,companyId,doc.revision,doc.targetBillingId,nextVersion,sourceHash,JSON.stringify(view));
    if(fault==='AFTER_PROJECTION')fail('FAULT_INJECTED_AFTER_PROJECTION');
    db.exec('COMMIT');return nextVersion;
  }catch(err){db.exec('ROLLBACK');throw err;}
}
function approveFromFakeTrustedProcess(db,documentId){
  const p=db.prepare('SELECT * FROM projections WHERE document_id=?').get(documentId);
  if(!p)fail('NO_DOCUMENT');
  db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET revision=excluded.revision,source_sync_version=excluded.source_sync_version,source_hash=excluded.source_hash,reviewer_user_id=excluded.reviewer_user_id').run(documentId,p.revision,p.source_sync_version,p.source_hash,'fake-reviewer-only');
}
function fakeGateway(db,authority){
  return ({documentId,revision,targetBillingId},jwt)=>{
    const identity=authority.verifyToken(jwt); // independently verify signature, not frontend base64 decode
    const session=db.prepare('SELECT active FROM sessions WHERE session_id=? AND user_id=?').get(identity.sessionId,identity.userId);
    if(session?.active!==1)fail('SESSION_DENIED');
    const p=db.prepare('SELECT * FROM projections WHERE document_id=?').get(documentId);
    if(!p||p.revision!==revision||p.target_billing_id!==targetBillingId)fail('DOCUMENT_VERSION_DENIED');
    const member=db.prepare('SELECT role,active FROM memberships WHERE company_id=? AND user_id=?').get(p.company_id,identity.userId);
    if(member?.active!==1||!['owner','admin','accounting'].includes(member.role))fail('MEMBERSHIP_DENIED');
    const acl=db.prepare('SELECT active FROM document_acl WHERE document_id=? AND user_id=?').get(documentId,identity.userId);
    if(acl?.active!==1)fail('DOCUMENT_ACL_DENIED');
    const root=db.prepare('SELECT sync_version,snapshot_json FROM root_states WHERE company_id=?').get(p.company_id);
    if(!root||root.sync_version!==p.source_sync_version)fail('SYNC_DRIFT_DENIED');
    const source=JSON.parse(root.snapshot_json).find(d=>d.id===documentId);
    if(!source||source.revision!==p.revision||source.targetBillingId!==p.target_billing_id)fail('SOURCE_DRIFT_DENIED');
    const built=projectDocument(source);
    if(built.sourceHash!==p.source_hash||JSON.stringify(built.view)!==p.public_json)fail('SOURCE_DRIFT_DENIED');
    const approval=db.prepare('SELECT * FROM approvals WHERE document_id=?').get(documentId);
    if(!approval||approval.revision!==p.revision||approval.source_sync_version!==p.source_sync_version||approval.source_hash!==p.source_hash)fail('APPROVAL_DENIED');
    return copy(built.view); // only whitelisted public fields, never full snapshot or secrets
  };
}
function fixture(){
  const authority=createFakeAuthority(),db=initDb(),docs=seedDocuments();
  commitFakeSnapshot(db,'company-A',0,[docs[0]]);
  commitFakeSnapshot(db,'company-B',0,[docs[1]]);
  approveFromFakeTrustedProcess(db,'doc-AB');approveFromFakeTrustedProcess(db,'doc-C');
  return {db,authority,docs,read:fakeGateway(db,authority)};
}
const request={documentId:'doc-AB',revision:1,targetBillingId:'bill-A'};
const expectCode=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
const asOwnerB=(authority)=>authority.issue({sub:'owner-B',session_id:'session-B'});
const asEmployee=(authority)=>authority.issue({sub:'employee-A',session_id:'session-E'});
const asUnlisted=(authority)=>authority.issue({sub:'owner-unlisted',session_id:'session-U'});

test('ES256 cryptography: valid fake signature gives one approved target zone only',()=>{
  const {read,authority}=fixture();const view=read(request,authority.issue());
  assert.equal(view.projectName,'目標 A 區');assert.equal(view.totals.grossTotal,2100);
  assert.deepEqual(Object.keys(view),['schema','customerName','projectName','documentDate','publicNote','taxMode','lines','totals']);
});
test('no source invoice, other zone, salaries, bank, commission or private employee fields exported',()=>{
  const {read,authority}=fixture(),s=JSON.stringify(read(request,authority.issue()));
  for(const token of SECRET_MARKERS)assert.equal(s.includes(token),false,token);
  for(const key of ['sourceIds','sourceSnapshots','reviewer','session_id','internalNote','sourceHash'])assert.equal(s.includes(key),false,key);
});
test('tampered signed JWT payload is rejected even when fake role and MFA look valid',()=>{
  const {read,authority}=fixture(),token=authority.issue();const chunks=token.split('.');
  const fakePayload=JSON.parse(Buffer.from(chunks[1],'base64url').toString());fakePayload.sub='owner-B';
  const tampered=chunks[0]+'.'+b64(fakePayload)+'.'+chunks[2];expectCode(()=>read(request,tampered),'BAD_SIGNATURE');
});
test('HS256 algorithm confusion, other kid, foreign fake ES256 public key are denied',()=>{
  const {read,authority}=fixture();expectCode(()=>read(request,authority.issue({}, {alg:'HS256'})),'ALGORITHM_OR_KID_DENIED');
  expectCode(()=>read(request,authority.issue({}, {kid:'wrong-key'})),'ALGORITHM_OR_KID_DENIED');
  const foreign=createFakeAuthority();expectCode(()=>read(request,foreign.issue()),'BAD_SIGNATURE');
});
test('expired/not-yet-valid JWT, incorrect issuer/audience and missing identity denied',()=>{
  const {read,authority}=fixture();
  expectCode(()=>read(request,authority.issue({exp:NOW-1})),'TOKEN_EXPIRED_OR_NOT_YET_VALID');
  expectCode(()=>read(request,authority.issue({nbf:NOW+5})),'TOKEN_EXPIRED_OR_NOT_YET_VALID');
  expectCode(()=>read(request,authority.issue({iss:'https://fraud.invalid'})),'ISSUER_OR_AUDIENCE_DENIED');
  expectCode(()=>read(request,authority.issue({aud:'other'})),'ISSUER_OR_AUDIENCE_DENIED');
  expectCode(()=>read(request,authority.issue({session_id:''})),'MISSING_IDENTITY');
});
test('AAL1 cannot read, signed AAL2 still needs current session status',()=>{
  const {db,read,authority}=fixture();expectCode(()=>read(request,authority.issue({aal:'aal1'})),'MFA_REQUIRED');
  db.prepare('UPDATE sessions SET active=0 WHERE session_id=?').run('session-A');expectCode(()=>read(request,authority.issue()),'SESSION_DENIED');
});
test('employee role and unlisted same-company owner denied despite signed AAL2',()=>{
  const {read,authority}=fixture();expectCode(()=>read(request,asEmployee(authority)),'MEMBERSHIP_DENIED');
  expectCode(()=>read(request,asUnlisted(authority)),'DOCUMENT_ACL_DENIED');
});
test('cross-company owner with own valid session cannot view another document',()=>{
  const {read,authority}=fixture();expectCode(()=>read(request,asOwnerB(authority)),'MEMBERSHIP_DENIED');
});
test('revoked membership or document ACL invalidates previously valid token',()=>{
  const {db,read,authority}=fixture(),token=authority.issue();assert.ok(read(request,token));
  db.prepare('UPDATE document_acl SET active=0 WHERE document_id=? AND user_id=?').run('doc-AB','owner-A');
  expectCode(()=>read(request,token),'DOCUMENT_ACL_DENIED');
  db.prepare('UPDATE document_acl SET active=1 WHERE document_id=? AND user_id=?').run('doc-AB','owner-A');
  db.prepare('UPDATE memberships SET active=0 WHERE company_id=? AND user_id=?').run('company-A','owner-A');
  expectCode(()=>read(request,token),'MEMBERSHIP_DENIED');
});
test('wrong revision, guessed document and alternate target zone fail closed',()=>{
  const {read,authority}=fixture(),token=authority.issue();
  for(const q of [{...request,revision:2},{...request,documentId:'no-such-doc'},{...request,targetBillingId:'bill-B'}])expectCode(()=>read(q,token),'DOCUMENT_VERSION_DENIED');
});
test('successful SQL transaction persists source and projections together, revokes old approval',()=>{
  const {db,read,authority,docs}=fixture(),next=copy(docs[0]);next.revision=2;next.unified.lines[0].qty=3;next.unified.lines[0].amount=3000;
  next.totals={untaxed:3000,tax:150,grossTotal:3150,retention:150,receivable:3000};
  assert.equal(commitFakeSnapshot(db,'company-A',1,[next]),2);
  expectCode(()=>read(request,authority.issue()),'DOCUMENT_VERSION_DENIED');
  const q={...request,revision:2};expectCode(()=>read(q,authority.issue()),'APPROVAL_DENIED');
  approveFromFakeTrustedProcess(db,'doc-AB');assert.equal(read(q,authority.issue()).totals.grossTotal,3150);
});
test('SQLite atomic rollback when failure injected AFTER source update',()=>{
  const {db,read,authority,docs}=fixture(),next=copy(docs[0]);next.revision=2;
  expectCode(()=>commitFakeSnapshot(db,'company-A',1,[next],{fault:'AFTER_ROOT'}),'FAULT_INJECTED_AFTER_ROOT');
  assert.equal(db.prepare('SELECT sync_version FROM root_states WHERE company_id=?').get('company-A').sync_version,1);
  assert.equal(db.prepare('SELECT revision FROM projections WHERE document_id=?').get('doc-AB').revision,1);
  assert.equal(read(request,authority.issue()).totals.grossTotal,2100);
});
test('SQLite atomic rollback when failure injected AFTER projection update',()=>{
  const {db,read,authority,docs}=fixture(),next=copy(docs[0]);next.revision=2;
  expectCode(()=>commitFakeSnapshot(db,'company-A',1,[next],{fault:'AFTER_PROJECTION'}),'FAULT_INJECTED_AFTER_PROJECTION');
  assert.equal(db.prepare('SELECT sync_version FROM root_states WHERE company_id=?').get('company-A').sync_version,1);
  assert.equal(read(request,authority.issue()).projectName,'目標 A 區');
});
test('stale sync compare-and-swap and duplicate source IDs refuse write',()=>{
  const {db,docs}=fixture(),next=copy(docs[0]);
  expectCode(()=>commitFakeSnapshot(db,'company-A',0,[next]),'STALE_SOURCE_VERSION');
  next.sourceIds=['bill-A','bill-A'];expectCode(()=>commitFakeSnapshot(db,'company-A',1,[next]),'BAD_SOURCE_VERSION');
  assert.equal(db.prepare('SELECT sync_version FROM root_states WHERE company_id=?').get('company-A').sync_version,1);
});
test('cross-company ingress is blocked before transaction, no root state changes',()=>{
  const {db,docs}=fixture();expectCode(()=>commitFakeSnapshot(db,'company-A',1,[docs[1]]),'CROSS_COMPANY_INGEST');
  assert.equal(db.prepare('SELECT count(*) AS n FROM projections').get().n,2);
});
test('source/projection version drift is denied rather than emitting stale data',()=>{
  const {db,read,authority}=fixture();
  db.prepare('UPDATE projections SET source_sync_version=0 WHERE document_id=?').run('doc-AB');
  expectCode(()=>read(request,authority.issue()),'SYNC_DRIFT_DENIED');
});
test('silent projection tampering is denied by compare-to-source, not trusted',()=>{
  const {db,read,authority}=fixture();
  db.prepare('UPDATE projections SET public_json=? WHERE document_id=?').run('{"invalid":"fake"}','doc-AB');
  expectCode(()=>read(request,authority.issue()),'SOURCE_DRIFT_DENIED');
});
test('parameterized documentId avoids injecting a SQL condition',()=>{
  const {read,authority}=fixture();expectCode(()=>read({...request,documentId:"doc-AB' OR 1=1 --"},authority.issue()),'DOCUMENT_VERSION_DENIED');
});
test('all tests are offline fake; no Supabase requests, real keys or PDF service',()=>{
  assert.equal(ISS.endsWith('.invalid/auth/v1'),true);
  assert.equal(typeof createFakeAuthority().issue,'function');
  assert.equal(typeof fakeGateway,'function');
});