'use strict';
// P37-19X offline checkpoint. Never performs network, Auth, Supabase RPC
// or any ERP transaction. Temporary files are reviewed code/evidence ONLY.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const gatePath=path.resolve(__dirname,'../p37-19w/readiness-gate.cjs');
const pins=Object.freeze({
 'p37-lab/p37-19w/readiness-gate.cjs':'4dc6bc4c28860c7a3bb82107112e719fb055238c',
 'p37-lab/p37-19w/operator-cli.mjs':'f124d712dceab41b0750e351d859a90bb9888d26'
});
const canonical=(buffer)=>Buffer.from(buffer.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
function gitSha(buffer){
 return crypto.createHash('sha1').update(Buffer.from('blob '+buffer.length+'\0')).update(buffer).digest('hex');
}
let temp=null;
try{
 if(process.argv.length!==4||
    path.resolve(process.argv[2])!==gatePath)throw Error('WRONG_SOURCE_GATE');
 const root=path.resolve(process.argv[3]);
 const gate=require(gatePath);
 const list={...gate.PINNED,...pins};
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'p37-19x-source-review-'));
 for(const [relative,expected] of Object.entries(list)){
   const input=canonical(fs.readFileSync(path.join(root,relative)));
   if(gitSha(input)!==expected)throw Error('REVIEW_SOURCE_CHANGED');
   const target=path.join(temp,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,input,{mode:0o600});
 }
 // The earlier W gate still reviews ALL original source identities and
 // release invariants. The normalization is strictly CRLF->LF to support
 // ordinary Windows Git checkouts; any other byte change fails the hash.
 const proof=gate.inspect(temp);
 if(proof.releaseState!=='NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING'||
    proof.canPost!==false||proof.canDeploy!==false||
    proof.mayMergeMain!==false||proof.mayMergeBeta!==false||
    proof.allowStageWithoutCompletedAuthPreflight!==false||
    proof.allowRealRpcWithoutAdminCleanupReadiness!==false||
    proof.earlierSnapshotHasNoCasesAndAllowances!==true)
   throw Error('RELEASE_OR_SOURCE_GUARD_NOT_REVIEWED');
 process.stdout.write('P37-19X SOURCE_GUARD_AND_NO_GO_PASS\n');
}catch(_){
 process.stderr.write('P37-19X SOURCE_GUARD_NO_GO\n');
 process.exitCode=1;
}finally{
 if(temp)fs.rmSync(temp,{recursive:true,force:true});
}
