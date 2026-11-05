// P37-19H manual read-only authentication preflight.
// Does not contact production, does not call the allowance RPC, and does not
// read or write any ERP finance records.
import {config,preflight} from './verified-sessions.mjs';
try{
 const result=await preflight(config(process.env));
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(_){
 // Deliberately do NOT print error details or credential-derived values.
 process.stderr.write('P37-19H LAB AUTH-ONLY PREFLIGHT NOT VERIFIED; no posting permitted.\n');
 process.exitCode=1;
}
