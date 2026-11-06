'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const gate=require('../p37-19w/readiness-gate.cjs');
const root=path.resolve(__dirname,'../..');
const local=fs.readFileSync(path.join(__dirname,'Run_ReadOnly_Auth_Preflight.ps1'),'utf8');
test('Windows launcher references the exact dedicated lab and never production',()=>{
 assert.match(local,/https:\/\/ldktrfgzzzmklhsnfrol\.supabase\.co/);
 assert.match(local,/00000000-0000-4000-8000-000000019019/);
 assert.match(local,/P37_19W_PHASE','AUTH_ONLY'/);
 assert.match(local,/KUSHE_AUTH_LAB_ONLY/);
 assert.doesNotMatch(local,/jimcybsztnwfzrnvexsp/);
 assert.doesNotMatch(local,/RPC_RACE_STAGED_MANUAL_ONLY|STAGE_PREVERIFIED|ADMIN_CLEANUP_READY/);
 assert.doesNotMatch(local,/\b(?:Invoke-RestMethod|Invoke-WebRequest|Start-Process)\b/i);
 assert.doesNotMatch(local,/-ExecutionPolicy\s+(?:Bypass|Unrestricted)/i);
});
test('dedicated test credentials never become command-line arguments or saved files',()=>{
 assert.match(local,/Read-Host 'Dedicated TEST LAB password \(hidden\)' -AsSecureString/);
 assert.match(local,/SecureStringToBSTR/);
 assert.match(local,/ZeroFreeBSTR/);
 assert.match(local,/SetEnvironmentVariable\('P37_19W_TEST_PASSWORD',\$PlainPassword,'Process'\)/);
 assert.match(local,/SetEnvironmentVariable\(\$name,\$null,'Process'\)/);
 assert.doesNotMatch(local,/Write-(?:Host|Output).*(?:PlainPassword|TEST_PASSWORD|SecurePassword)/);
 assert.doesNotMatch(local,/(?:Set-Content|Out-File|Add-Content|Export-Clixml|Tee-Object)/);
 assert.doesNotMatch(local,/Start-Transcript|Get-History|Clear-History/);
});
test('preflight routes only to previously reviewed W Auth-only module, never RPC',()=>{
 assert.match(local,/& \$NodeCommand.Source \$Operator/);
 assert.match(local,/P37_19W_PHASE','AUTH_ONLY'/);
 assert.match(local,/p37-19w\\operator-cli\.mjs/i);
 assert.match(local,/gate\.inspect/);
 assert.match(local,/NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING/);
 assert.match(local,/if \(\$SelfTest\)/);
 assert.match(local,/SELFTEST_PASS - no network/);
 assert.doesNotMatch(local,/\b(?:DELETE FROM|INSERT INTO|CREATE TABLE|ALTER ROLE|DROP TABLE|GRANT ALL)\b/i);
 const verified=gate.inspect(root);
 assert.equal(verified.releaseState,'NO_GO_REAL_HTTP_AND_POSTCLEANUP_PENDING');
 assert.equal(verified.earlierSnapshotHasNoCasesAndAllowances,true);
 assert.equal(verified.canDeploy,false);
 assert.equal(verified.canPost,false);
});
test('official ERP Store, Dashboard and formal Cloud Sync have no P37-19X mount',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const name of ['index.html','assets/js/erp-store.js','assets/js/cloud-sync.js',
 'assets/js/dashboard.js','assets/js/reports.js']){
  const text=fs.readFileSync(path.join(root,name),'utf8');
  assert.doesNotMatch(text,/p37-19x|p3719x/i,name);
 }
 assert.doesNotMatch(html,/Run_ReadOnly_Auth_Preflight/);
 const w=fs.readFileSync(path.join(root,'p37-lab/p37-19w/operator-cli.mjs'),'utf8');
 assert.match(w,/RPC_RACE_STAGED_MANUAL_ONLY/);
 assert.match(w,/AUTH_ONLY/);
});
