/* P40-16BD — TEST-ONLY asymmetric RS256 JWT verification gate.
 * Uses Node's real crypto.verify against ephemerally generated CI keys.
 * NEVER CONNECT TO REAL SUPABASE. NO REAL JWKS, JWT, USERS OR ERP DATA.
 * Not a complete JWT verification implementation for deployment:
 * production should use supported Supabase SDK/Jose with trusted JWKS
 * rotation, strict issuer/audience, live session and ACL checks.
 */
'use strict';
const crypto=require('node:crypto');
const LIMIT=8192;
const FAKE_ISSUER='https://fake-auth.example.invalid/auth/v1';
const FAKE_AUDIENCE='authenticated';
const DENY=reason=>Object.freeze({allowed:false,reason});
const OK=(action,doc)=>Object.freeze({allowed:true,next:'ELIGIBLE_FOR_SEPARATE_APPROVAL_JOURNAL',
  documentId:doc.id,revision:doc.revision,sourceHash:doc.sourceHash,
  action,realBackendIntegrated:false,pdfBytesDelivered:false,
  persistedApproval:false});
function parsePart(segment){
  if(typeof segment!=='string'||segment.length<2||!/^[A-Za-z0-9_-]+$/.test(segment))
    throw Error('BAD_TOKEN_ENCODING');
  const raw=Buffer.from(segment,'base64url');
  if(raw.toString('base64url')!==segment)throw Error('NON_CANONICAL_BASE64URL');
  const data=JSON.parse(raw.toString('utf8'));
  if(!data||Array.isArray(data)||typeof data!=='object')throw Error('BAD_TOKEN_JSON');
  return data;
}
function fail(condition,reason){if(condition)throw Error(reason)}
function verifyAsymmetricJwt({
 token,jwks,nowSeconds,issuer=FAKE_ISSUER,audience=FAKE_AUDIENCE,
 maxTokenTtlSeconds=3600
}={}){
  fail(typeof token!=='string'||token.length>LIMIT,'TOKEN_SIZE_OR_TYPE');
  const parts=token.split('.');
  fail(parts.length!==3,'TOKEN_THREE_PARTS_REQUIRED');
  const [h,p,s]=parts;
  const header=parsePart(h);
  fail(header.alg!=='RS256'||header.typ!=='JWT'||
    typeof header.kid!=='string'||header.kid.length<8,
    'JWT_ALGORITHM_OR_HEADER_BLOCKED');
  fail(header.jwk!==undefined||header.jku!==undefined||
    header.x5u!==undefined||header.crit!==undefined,
    'UNTRUSTED_KEY_REFERENCE_BLOCKED');
  fail(!jwks||!Array.isArray(jwks.keys),'TRUSTED_JWKS_REQUIRED');
  const candidates=jwks.keys.filter(k=>k.kid===header.kid);
  fail(candidates.length!==1,'JWKS_KID_NOT_UNIQUE_OR_UNKNOWN');
  const key=candidates[0];
  fail(key.kty!=='RSA'||key.alg!=='RS256'||key.use&&key.use!=='sig'||
       key.key_ops&&(!Array.isArray(key.key_ops)||!key.key_ops.includes('verify'))||
       key.d!==undefined,'JWKS_PUBLIC_RSA_VERIFY_KEY_REQUIRED');
  const publicJwk={kty:'RSA',n:key.n,e:key.e};
  let publicKey;
  try{publicKey=crypto.createPublicKey({key:publicJwk,format:'jwk'});}
  catch(_){throw Error('INVALID_RSA_PUBLIC_JWK')}
  const signature=Buffer.from(s,'base64url');
  fail(signature.toString('base64url')!==s,'INVALID_SIGNATURE_ENCODING');
  const valid=crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p,'utf8'),publicKey,signature);
  fail(!valid,'JWT_SIGNATURE_INVALID');
  const claims=parsePart(p);
  fail(typeof claims.iss!=='string'||claims.iss!==issuer,'JWT_ISSUER_INVALID');
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  fail(aud.length!==1||aud[0]!==audience,'JWT_AUDIENCE_INVALID');
  fail(!Number.isSafeInteger(nowSeconds)||nowSeconds<1,'TEST_CLOCK_REQUIRED');
  fail(!Number.isSafeInteger(claims.iat)||claims.iat>nowSeconds+30,
    'JWT_ISSUED_AT_INVALID');
  fail(!Number.isSafeInteger(claims.exp)||claims.exp<=nowSeconds,
    'JWT_EXPIRED_OR_INVALID');
  fail(!Number.isSafeInteger(claims.nbf)||claims.nbf>nowSeconds,
    'JWT_NOT_BEFORE_INVALID');
  fail(claims.exp<=claims.iat||claims.exp-claims.iat>maxTokenTtlSeconds,
    'JWT_TTL_TOO_LONG');
  fail(claims.role!=='authenticated'||claims.is_anonymous===true,
    'JWT_AUTHENTICATED_ROLE_REQUIRED');
  fail(claims.aal!=='aal2','JWT_MFA_AAL2_REQUIRED');
  fail(typeof claims.sub!=='string'||!claims.sub.startsWith('FAKE-USER-')||
       typeof claims.session_id!=='string'||!claims.session_id.startsWith('FAKE-SESSION-'),
    'JWT_FAKE_SUBJECT_AND_SESSION_REQUIRED');
  // No browser-supplied company/role is trusted, even when signed.
  return Object.freeze({userId:claims.sub,sessionId:claims.session_id,
    tokenExpiresAt:claims.exp,aal:claims.aal,
    verifiedBy:'EPHEMERAL_RSA_SIGNATURE_IN_ISOLATED_CI_ONLY'});
}
function authorizeFakeBillingReview({
 token,jwks,nowSeconds,registry,request,issuer=FAKE_ISSUER,audience=FAKE_AUDIENCE
}={}){
  let identity;
  try{
    identity=verifyAsymmetricJwt({token,jwks,nowSeconds,issuer,audience});
  }catch(e){return DENY('JWT_'+e.message)}
  if(!request||Object.getPrototypeOf(request)!==Object.prototype||
     Object.keys(request).sort().join('|')!=='action|documentId|expectedHash|revision')
    return DENY('REQUEST_ONLY_ACTION_DOC_REV_HASH');
  if(request.action!=='approve_reorganized')return DENY('ACTION_NOT_SUPPORTED');
  if(typeof request.documentId!=='string'||!request.documentId.startsWith('FAKE-DOC-'))
    return DENY('NOT_AN_ISOLATED_FAKE_DOCUMENT');
  if(!Number.isSafeInteger(request.revision)||request.revision<1)
    return DENY('REVISION_INVALID');
  if(typeof request.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(request.expectedHash))
    return DENY('EXPECTED_SOURCE_HASH_INVALID');
  if(!registry||!registry.sessions||!registry.memberships||
    !registry.documents||!registry.documentAcl)
    return DENY('TRUSTED_REGISTRY_MISSING');
  const session=registry.sessions[identity.sessionId];
  if(!session||session.userId!==identity.userId||session.active!==true||
     session.revoked===true||session.expiresAt<=nowSeconds)
    return DENY('TRUSTED_SESSION_REVOKED_OR_MISMATCH');
  const d=registry.documents[request.documentId];
  if(!d||d.status!=='active'||d.id!==request.documentId)
    return DENY('DOCUMENT_NOT_CURRENT_OR_MISSING');
  if(d.companyId===undefined||!d.companyId.startsWith('FAKE-COMPANY-'))
    return DENY('DOCUMENT_COMPANY_UNTRUSTED');
  const m=registry.memberships[identity.userId+'|'+d.companyId];
  if(!m||!m.active||m.companyId!==d.companyId||
    m.userId!==identity.userId)return DENY('COMPANY_MEMBERSHIP_DENIED');
  if(!['owner','admin'].includes(m.role))return DENY('REVIEWER_ROLE_DENIED');
  const acl=registry.documentAcl[identity.userId+'|'+d.id];
  if(!acl||acl.companyId!==d.companyId||acl.canReview!==true||acl.active!==true)
    return DENY('DOCUMENT_REVIEW_ACL_DENIED');
  if(d.workflow!=='pending_review'||d.reorganized!==true)
    return DENY('REARRANGED_BILL_NOT_PENDING_REVIEW');
  if(d.revision!==request.revision||d.sourceHash!==request.expectedHash||
    d.trustedSourceCurrent!==true)return DENY('DOCUMENT_VERSION_OR_SOURCE_DRIFT');
  if(identity.userId===d.editorId||identity.userId===d.submitterId)
    return DENY('INDEPENDENT_REVIEWER_REQUIRED');
  if(typeof d.reason!=='string'||!d.reason.trim())
    return DENY('REORGANIZATION_REASON_REQUIRED');
  // This is PRE-APPROVAL ELIGIBILITY ONLY; it cannot write approval,
  // publish customer PDF or change original bill/receivable/bank.
  return OK(request.action,d);
}
module.exports={FAKE_ISSUER,FAKE_AUDIENCE,parsePart,verifyAsymmetricJwt,
  authorizeFakeBillingReview};
