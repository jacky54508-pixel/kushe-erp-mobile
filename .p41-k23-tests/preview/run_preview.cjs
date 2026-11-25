'use strict';
// File adapter: reads evidence and prints JSON. No source/evidence files modified.
const fs=require('node:fs'),path=require('node:path');
const {preview,sha256,verifyPinnedSource}=require('./k23_preview.cjs');
const workRoot=path.resolve(__dirname,'../..');
const evidenceRoot=process.argv[2]||path.join(workRoot,'k21_work/evidence_v4_20261124_214334_e42ecb/evidence_bundle');
const sourceFile=process.argv[3]||path.join(workRoot,'k21_work/reference/erp-store.js');
const pin=verifyPinnedSource(fs.readFileSync(sourceFile));
const cases=['PRIMARY_WRITTEN_before_emergency','EMERGENCY_WRITTEN_before_store_token','EMERGENCY_WRITTEN_before_receipt_token'];
const results=cases.map(scenario=>{
  const relativeFile=`${scenario}/evidence/08_raw_after_crash_before_any_store_script.json`;
  const bytes=fs.readFileSync(path.join(evidenceRoot,relativeFile));
  return {scenario,sourceFile:relativeFile,sourceFileSha256:sha256(bytes),...preview(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')))};
});
console.log(JSON.stringify({schema:'k23-readonly-preview-bundle-v1',sourcePin:pin,
  status:results.every(x=>x.status==='REVIEW_ONLY_CANDIDATE')?'THREE_REVIEW_ONLY_CANDIDATES':'BLOCKED',
  publishGate:'BLOCKED',allowApply:false,results},null,2));
if(results.some(x=>x.status!=='REVIEW_ONLY_CANDIDATE'))process.exitCode=1;
