'use strict';
// OFFLINE REVIEW CHECKLIST ONLY. Not a JWT verifier, document access service,
// automatic deployment gate, company role engine or authenticated API.
const decision=require('../.p40-16bm-review/decision.json');
const keys=Object.keys(decision.evidence_gates);
function evaluate(evidence){
  if(!evidence || typeof evidence!=='object' || Array.isArray(evidence))
    return Object.freeze({status:'BLOCKED',missing:keys.slice()});
  const missing=keys.filter(key=>evidence[key]!==true);
  return Object.freeze({
    status:missing.length?'BLOCKED':'REVIEW_READY_NO_AUTODEPLOY',
    missing:Object.freeze(missing)
  });
}
module.exports=Object.freeze({evaluate,requiredGateNames:Object.freeze(keys.slice())});
