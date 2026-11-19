/* P40-16BD: real RSA signatures with keys GENERATED IN CI MEMORY ONLY.
 * 0 real credentials, users, Supabase or ERP records.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {
 FAKE_ISSUER,FAKE_AUDIENCE,verifyAsymmetricJwt,authorizeFakeBillingReview
}=require('./verify_fake_jwt.cjs');
const NOW=1_795_000_000; // fixed synthetic clock; NOT user's actual clock
const USER='FAKE-USER-REVIEWER',EDITOR='FAKE-USER-EDITOR',
      SESSION='FAKE-SESSION-001',DOC='FAKE-DOC-01',CO='FAKE-COMPANY-01',
      HASH='a'.repeat(64);
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const {publicKey:wrongPublic,privateKey:wrongPrivate}=
  crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const JWKS={keys:[{...publicKey.export({format:'jwk'}),
  kid:'FAKE-RSA-KEY-001',alg:'RS256',use:'sig',key_ops:['verify']}]};
const WRONG_JWKS={keys:[{...wrongPublic.export({format:'jwk'}),
  kid:'FAKE-RSA-KEY-001',alg:'RS256',use:'sig',key_ops:['verify']}]};
const base64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function payload(changes={}){
 return {iss:FAKE_ISSUER,aud:FAKE_AUDIENCE,sub:USER,
  role:'authenticated',session_id:SESSION,aal:'aal2',
  iat:NOW-60,nbf:NOW-60,exp:NOW+600,is_anonymous:false,...changes};
}
function signToken(claims=payload(),options={}){
 const head={typ:'JWT',alg:'RS256',kid:'FAKE-RSA-KEY-001',
   ...(options.header||{})};
 const encoded=base64(head)+'.'+base64(claims);
 return encoded+'.'+crypto.sign('RSA-SHA256',
   Buffer.from(encoded,'utf8'),options.privateKey||privateKey).toString('base64url');
}
function registry(){
 return {
  sessions:{[SESSION]:{userId:USER,active:true,revoked:false,expiresAt:NOW+3600}},
  memberships:{[USER+'|'+CO]:{userId:USER,companyId:CO,
    active:true,role:'owner'}},
  documents:{[DOC]:{id:DOC,companyId:CO,revision:4,status:'active',
    workflow:'pending_review',reorganized:true,sourceHash:HASH,
    trustedSourceCurrent:true,editorId:EDITOR,submitterId:EDITOR,
    reason:'FAKE-RECOMPOSE-REASON'}},
  documentAcl:{[USER+'|'+DOC]:{companyId:CO,active:true,canReview:true}}
 };
}
const req=()=>({action:'approve_reorganized',documentId:DOC,revision:4,expectedHash:HASH});
function auth({token=signToken(),jwks=JWKS,nowSeconds=NOW,
  r=registry(),request=req(),issuer=FAKE_ISSUER,audience=FAKE_AUDIENCE}={}){
 return authorizeFakeBillingReview({token,jwks,nowSeconds,registry:r,
  request,issuer,audience});
}
function denied(x,expected){
 assert.equal(x.allowed,false,JSON.stringify(x));
 assert.equal(x.reason,expected,JSON.stringify(x));
}
function badToken(claimUpdate,expected){
 denied(auth({token:signToken(payload(claimUpdate))}),expected);
}
test('genuine test private-key RS256 signature verifies using public JWKS',()=>{
 const c=verifyAsymmetricJwt({token:signToken(),jwks:JWKS,nowSeconds:NOW});
 assert.equal(c.userId,USER);
 assert.equal(c.sessionId,SESSION);
 assert.equal(c.aal,'aal2');
 assert.ok(c.verifiedBy.includes('EPHEMERAL_RSA_SIGNATURE'));
 assert.equal(c.companyId,undefined);
 assert.equal(c.memberRole,undefined);
});
test('valid signed fake session plus server registry returns only approval eligibility',()=>{
 const r=auth();
 assert.equal(r.allowed,true);
 assert.equal(r.next,'ELIGIBLE_FOR_SEPARATE_APPROVAL_JOURNAL');
 assert.equal(r.persistedApproval,false);
 assert.equal(r.pdfBytesDelivered,false);
 assert.equal(r.realBackendIntegrated,false);
 assert.deepEqual(Object.keys(r).sort(),[
  'allowed','next','documentId','revision','sourceHash','action',
  'realBackendIntegrated','pdfBytesDelivered','persistedApproval'].sort());
});
test('no private key material in GitHub source files; key generated only inside CI',()=>{
 const body=fs.readFileSync(path.join(__dirname,'verify_fake_jwt.cjs'),'utf8');
 assert.ok(!body.includes('-----BEGIN '+'PRIVATE KEY-----'));
 assert.ok(!body.includes('supabase.from('));
 assert.ok(!body.includes('window.print('));
 assert.ok(!body.includes('service_'+'role_key'));
});
test('payload tampering after genuine signature is rejected',()=>{
 const t=signToken();const parts=t.split('.');
 parts[1]=base64({...payload(),sub:'FAKE-USER-ATTACKER'});
 denied(auth({token:parts.join('.')}),'JWT_JWT_SIGNATURE_INVALID');
});
test('header tampering to unsupported algorithm is rejected',()=>{
 const t=signToken();const parts=t.split('.');
 parts[0]=base64({typ:'JWT',alg:'none',kid:'FAKE-RSA-KEY-001'});
 denied(auth({token:parts.join('.')}),'JWT_JWT_ALGORITHM_OR_HEADER_BLOCKED');
});
for(const alg of ['none','HS256','ES256','PS256','RS512','EdDSA','']){
 test('algorithm confusion blocked: '+alg,()=>{
  denied(auth({token:signToken(payload(),{header:{alg}})}),
    'JWT_JWT_ALGORITHM_OR_HEADER_BLOCKED');
 });
}
test('wrong private key cannot forge a signature even using an allowed kid',()=>{
 denied(auth({token:signToken(payload(),{privateKey:wrongPrivate})}),
  'JWT_JWT_SIGNATURE_INVALID');
});
test('wrong public JWKS cannot verify a genuine signature',()=>{
 denied(auth({jwks:WRONG_JWKS}),'JWT_JWT_SIGNATURE_INVALID');
});
test('unknown kid is not silently accepted',()=>{
 denied(auth({token:signToken(payload(),{header:{kid:'FAKE-RSA-KEY-UNKNOWN'}})}),
  'JWT_JWKS_KID_NOT_UNIQUE_OR_UNKNOWN');
});
test('duplicate kid in trusted JWKS blocks ambiguous verifier choice',()=>{
 denied(auth({jwks:{keys:[...JWKS.keys,...JWKS.keys]}}),
  'JWT_JWKS_KID_NOT_UNIQUE_OR_UNKNOWN');
});
test('HS256 shared-secret symmetric JWKS cannot satisfy RSA-only gate',()=>{
 denied(auth({jwks:{keys:[{kty:'oct',alg:'HS256',kid:'FAKE-RSA-KEY-001',
  k:'FAKE_SECRET_NOT_AN_ACTUAL_KEY'}]}}),
 'JWT_JWKS_PUBLIC_RSA_VERIFY_KEY_REQUIRED');
});
test('private RSA key parameter in JWKS is rejected to avoid key exposure',()=>{
 denied(auth({jwks:{keys:[{...JWKS.keys[0],d:'PRIVATE'}]}}),
  'JWT_JWKS_PUBLIC_RSA_VERIFY_KEY_REQUIRED');
});
for(const prop of ['jku','jwk','x5u','crit']){
 test('untrusted JWT header key references blocked: '+prop,()=>{
  denied(auth({token:signToken(payload(),{header:{[prop]:'https://attacker.invalid/jwks'}})}),
    'JWT_UNTRUSTED_KEY_REFERENCE_BLOCKED');
 });
}
test('token missing a signature cannot authenticate',()=>{
 const t=signToken(),parts=t.split('.');
 parts[2]='';
 denied(auth({token:parts.join('.')}),'JWT_JWT_SIGNATURE_INVALID');
});
test('token with invalid base64url padding is rejected',()=>{
 const t=signToken();denied(auth({token:t.replace(/\./,'=.')}),'JWT_BAD_TOKEN_ENCODING');
});
test('too large token blocked before parsing',()=>{
 denied(auth({token:'A'.repeat(9000)}),'JWT_TOKEN_SIZE_OR_TYPE');
});
test('malformed segments or unexpected JSON never grant approval',()=>{
 for(const t of ['', 'x.y', 'x.y.z.w', 'notjwt']){
  const r=auth({token:t});assert.equal(r.allowed,false,t);
 }
});
test('invalid signature encoding rejected rather than accepting appended padding',()=>{
 const t=signToken();denied(auth({token:t+'='}),'JWT_INVALID_SIGNATURE_ENCODING');
});
test('issuer claim must exactly match configured trusted issuer',()=>{
 badToken({iss:'https://fake-attacker.invalid/auth/v1'},'JWT_JWT_ISSUER_INVALID');
});
test('verification configured issuer mismatch fails',()=>{
 denied(auth({issuer:'https://wrong-issuer.invalid/auth/v1'}),'JWT_JWT_ISSUER_INVALID');
});
test('audience must be exact authenticated; Postgres JWT role not enough',()=>{
 for(const aud of ['anon','service_role','other',['authenticated','other']]){
  badToken({aud},'JWT_JWT_AUDIENCE_INVALID');
 }
});
test('wrong caller-configured audience rejects valid token',()=>{
 denied(auth({audience:'service_role'}),'JWT_JWT_AUDIENCE_INVALID');
});
test('missing exp, expired exp or noninteger exp never grants access',()=>{
 for(const exp of [undefined,NOW,NOW-1,'123456',1.5]){
  badToken({exp},'JWT_JWT_EXPIRED_OR_INVALID');
 }
});
test('future not-before prevents early session use',()=>{
 badToken({nbf:NOW+120},'JWT_JWT_NOT_BEFORE_INVALID');
});
test('invalid not-before type is rejected',()=>{
 badToken({nbf:'future'},'JWT_JWT_NOT_BEFORE_INVALID');
});
test('optional nbf is permitted when all other claims signed and valid',()=>{
 const p=payload();delete p.nbf;
 assert.equal(auth({token:signToken(p)}).allowed,true);
});
test('missing or future-issued time is denied',()=>{
 for(const iat of [undefined,NOW+120,1.5,'now']){
  badToken({iat},'JWT_JWT_ISSUED_AT_INVALID');
 }
});
test('unreasonably long signature lifetime rejected',()=>{
 badToken({iat:NOW-60,exp:NOW+7200},'JWT_JWT_TTL_TOO_LONG');
});
test('exp before iat never passes even if not expired',()=>{
 badToken({iat:NOW+10,exp:NOW+5},'JWT_JWT_TTL_TOO_LONG');
});
test('bad test clock cannot silently grant access',()=>{
 denied(auth({nowSeconds:-1}),'JWT_TEST_CLOCK_REQUIRED');
});
test('anonymous token even with valid RS256 signature fails',()=>{
 badToken({is_anonymous:true},'JWT_JWT_AUTHENTICATED_ROLE_REQUIRED');
});
test('signed anon or service_role token cannot get user reviewer privileges',()=>{
 for(const role of ['anon','service_role',null,'employee']){
  badToken({role},'JWT_JWT_AUTHENTICATED_ROLE_REQUIRED');
 }
});
test('signed AAL1 token blocked for approval regardless of other claims',()=>{
 badToken({aal:'aal1'},'JWT_JWT_MFA_AAL2_REQUIRED');
});
test('missing MFA claim blocked',()=>{
 badToken({aal:undefined},'JWT_JWT_MFA_AAL2_REQUIRED');
});
test('missing session_id or wrong identity format rejected',()=>{
 for(const claim of [{session_id:undefined},{session_id:'not-a-session'},
  {sub:'REAL-USER-OTHER'},{sub:undefined}]){
  badToken(claim,'JWT_JWT_FAKE_SUBJECT_AND_SESSION_REQUIRED');
 }
});
test('signed JWT user_metadata cannot grant business reviewer permissions',()=>{
 const r=registry();r.memberships[USER+'|'+CO].role='accounting';
 const forged=signToken(payload({user_metadata:{role:'owner',companyId:CO},
   app_metadata:{role:'owner'}}));
 denied(auth({token:forged,r}),'REVIEWER_ROLE_DENIED');
});
test('signed JWT custom company/role claims cannot override server registry company',()=>{
 const r=registry();r.memberships={};
 const token=signToken(payload({company_id:CO,company_role:'owner',
  raw_user_meta_data:{role:'owner'},app_metadata:{role:'owner'}}));
 denied(auth({token,r}),'COMPANY_MEMBERSHIP_DENIED');
});
test('signed JWT does not prove live session; missing registry session blocked',()=>{
 const r=registry();r.sessions={};
 denied(auth({r}),'TRUSTED_SESSION_REVOKED_OR_MISMATCH');
});
test('revoked server-side session blocked even if signature unexpired',()=>{
 const r=registry();r.sessions[SESSION].revoked=true;
 denied(auth({r}),'TRUSTED_SESSION_REVOKED_OR_MISMATCH');
});
test('inactive server-side session blocked',()=>{
 const r=registry();r.sessions[SESSION].active=false;
 denied(auth({r}),'TRUSTED_SESSION_REVOKED_OR_MISMATCH');
});
test('session expired in trusted registry despite JWT not expired blocked',()=>{
 const r=registry();r.sessions[SESSION].expiresAt=NOW;
 denied(auth({r}),'TRUSTED_SESSION_REVOKED_OR_MISMATCH');
});
test('session user does not match signed subject blocked',()=>{
 const r=registry();r.sessions[SESSION].userId='FAKE-USER-OTHER';
 denied(auth({r}),'TRUSTED_SESSION_REVOKED_OR_MISMATCH');
});
test('server-side suspended membership cannot review a bill',()=>{
 const r=registry();r.memberships[USER+'|'+CO].active=false;
 denied(auth({r}),'COMPANY_MEMBERSHIP_DENIED');
});
test('foreign company membership cannot review a different company bill',()=>{
 const r=registry();
 delete r.memberships[USER+'|'+CO];
 r.memberships[USER+'|FAKE-COMPANY-OTHER']={
   userId:USER,companyId:'FAKE-COMPANY-OTHER',role:'owner',active:true};
 denied(auth({r}),'COMPANY_MEMBERSHIP_DENIED');
});
test('missing company role or admin role in server registry denied',()=>{
 for(const role of ['accounting','employee','payroll','',null]){
  const r=registry();r.memberships[USER+'|'+CO].role=role;
  denied(auth({r}),'REVIEWER_ROLE_DENIED');
 }
});
test('admin role may pass only with independent reviewer and live ACL',()=>{
 const r=registry();r.memberships[USER+'|'+CO].role='admin';
 assert.equal(auth({r}).allowed,true);
});
test('no document-specific review ACL => cannot review even if owner',()=>{
 const r=registry();r.documentAcl={};
 denied(auth({r}),'DOCUMENT_REVIEW_ACL_DENIED');
});
test('document read-only ACL without review right blocks',()=>{
 const r=registry();r.documentAcl[USER+'|'+DOC].canReview=false;
 denied(auth({r}),'DOCUMENT_REVIEW_ACL_DENIED');
});
test('document ACL from another company blocked',()=>{
 const r=registry();r.documentAcl[USER+'|'+DOC].companyId='FAKE-COMPANY-OTHER';
 denied(auth({r}),'DOCUMENT_REVIEW_ACL_DENIED');
});
test('document ACL revoked after token issue blocked',()=>{
 const r=registry();r.documentAcl[USER+'|'+DOC].active=false;
 denied(auth({r}),'DOCUMENT_REVIEW_ACL_DENIED');
});
test('company member and document reviewer cannot approve their own submitted version',()=>{
 const r=registry();r.documents[DOC].editorId=USER;r.documents[DOC].submitterId=USER;
 denied(auth({r}),'INDEPENDENT_REVIEWER_REQUIRED');
});
test('last editor matches reviewer even if submitter does not',()=>{
 const r=registry();r.documents[DOC].editorId=USER;
 denied(auth({r}),'INDEPENDENT_REVIEWER_REQUIRED');
});
test('submitter matches reviewer even if editor does not',()=>{
 const r=registry();r.documents[DOC].submitterId=USER;
 denied(auth({r}),'INDEPENDENT_REVIEWER_REQUIRED');
});
test('one person editor owner has no automatic self-approval bypass',()=>{
 const r=registry();r.documents[DOC].editorId=USER;
 r.documents[DOC].submitterId=USER;
 assert.equal(auth({r}).allowed,false);
 assert.equal(auth({r}).persistedApproval,undefined);
});
test('document not found denied without exposing tenant details',()=>{
 const r=registry();r.documents={};
 denied(auth({r}),'DOCUMENT_NOT_CURRENT_OR_MISSING');
});
test('document archived before review denied',()=>{
 const r=registry();r.documents[DOC].status='archived';
 denied(auth({r}),'DOCUMENT_NOT_CURRENT_OR_MISSING');
});
test('document belongs to unrecognized company denied',()=>{
 const r=registry();r.documents[DOC].companyId='REAL-COMPANY';
 denied(auth({r}),'DOCUMENT_COMPANY_UNTRUSTED');
});
test('wrong document id cannot use original document ACL',()=>{
 const r=registry();
 denied(auth({r,request:{...req(),documentId:'FAKE-DOC-OTHER'}}),
   'DOCUMENT_NOT_CURRENT_OR_MISSING');
});
test('client-supplied approval role, company or full ERP content forbidden by exact request allowlist',()=>{
 const extras=['role','companyId','approved','sourceSnapshots','erpState','invoiceNo',
 'bankTransactions','payroll','app_metadata','jwtClaims','actor','privateKey'];
 for(const key of extras){
  denied(auth({request:{...req(),[key]:'FORGED'}}),
   'REQUEST_ONLY_ACTION_DOC_REV_HASH');
 }
});
test('request with unknown action or version invalid',()=>{
 denied(auth({request:{...req(),action:'financial_post'}}),'ACTION_NOT_SUPPORTED');
 denied(auth({request:{...req(),revision:0}}),'REVISION_INVALID');
});
test('request must contain properly formatted source hash',()=>{
 for(const expectedHash of ['BAD','b'.repeat(63),123,null]){
  denied(auth({request:{...req(),expectedHash}}),'EXPECTED_SOURCE_HASH_INVALID');
 }
});
test('stale requested version rejected',()=>{
 denied(auth({request:{...req(),revision:3}}),'DOCUMENT_VERSION_OR_SOURCE_DRIFT');
});
test('source hash changed after preflight rejected',()=>{
 const r=registry();r.documents[DOC].sourceHash='b'.repeat(64);
 denied(auth({r}),'DOCUMENT_VERSION_OR_SOURCE_DRIFT');
});
test('trusted source no longer matches current original billing rejected',()=>{
 const r=registry();r.documents[DOC].trustedSourceCurrent=false;
 denied(auth({r}),'DOCUMENT_VERSION_OR_SOURCE_DRIFT');
});
test('document already approved cannot be re-approved via pending gate',()=>{
 const r=registry();r.documents[DOC].workflow='approved';
 denied(auth({r}),'REARRANGED_BILL_NOT_PENDING_REVIEW');
});
test('unreorganized document cannot be sent to rewritten construction approval',()=>{
 const r=registry();r.documents[DOC].reorganized=false;
 denied(auth({r}),'REARRANGED_BILL_NOT_PENDING_REVIEW');
});
test('empty independent reasoning note must block',()=>{
 const r=registry();r.documents[DOC].reason='   ';
 denied(auth({r}),'REORGANIZATION_REASON_REQUIRED');
});
test('response omits original invoice, bank, payroll, applicant PII and source rows',()=>{
 const r=auth(),str=JSON.stringify(r);
 for(const term of ['FAKE-USER','PRIVATE-INVOICE','sourceSnapshots',
  'companyId','membership','email','payroll','bankTransactions','originalLines']){
  assert.equal(str.includes(term),false,term);
 }
});
test('formal ERP still uses the original independent history and financial CAS',()=>{
 const root=path.join(__dirname,'..');
 const store=fs.readFileSync(path.join(root,'assets/js/erp-store.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'assets/js/billing-groups.js'),'utf8');
 const authSource=fs.readFileSync(path.join(root,'assets/js/auth-gate.js'),'utf8');
 assert.match(store,/saveExternalBillingDocument\(values=\{\}\)/);
 assert.match(store,/values.expectedSnapshot!==ctx.snapshot/);
 assert.match(store,/revision:\(previous\?\.revision\|\|0\)\+1/);
 assert.match(ui,/function printSaved\(id,revision=0,historyOnly=false\)/);
 assert.match(authSource,/sessionAal\(current\)!=='aal2'/);
 assert.ok(!store.includes('authorizeFakeBillingReview'));
 assert.ok(!ui.includes('authorizeFakeBillingReview'));
 assert.ok(!fs.existsSync(path.join(root,'supabase/migrations/p40-16bd.sql')));
});
