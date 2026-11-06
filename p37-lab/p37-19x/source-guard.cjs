'use strict';
// P37-19X offline source integrity checkpoint. No HTTP, login, env secrets,
// database action, status writes or production deployment.
const path=require('node:path');
const expected=path.resolve(__dirname,'../p37-19w/readiness-gate.cjs');
const fail=()=>{process.stderr.write('P37-19X SOURCE_GUARD_NO_GO\n');process.exitCode=1;};
try{
 if(process.argv.length!==4||
    path.resolve(process.argv[2])!==expected)throw Error('WRONG_SOURCE_GATE');
 const gate=require(expected);
 const proof=gate.inspect(path.resolve(process.argv[3]));
 if(proof.releaseState!=='NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING'||
    proof.canPost!==false||proof.canDeploy!==false||
    proof.mayMergeMain!==false||proof.mayMergeBeta!==false||
    proof.allowStageWithoutCompletedAuthPreflight!==false||
    proof.allowRealRpcWithoutAdminCleanupReadiness!==false||
    proof.earlierSnapshotHasNoCasesAndAllowances!==true)
  throw Error('RELEASE_OR_SOURCE_GUARD_NOT_REVIEWED');
 process.stdout.write('P37-19X SOURCE_GUARD_AND_NO_GO_PASS\n');
}catch(_){fail();}
