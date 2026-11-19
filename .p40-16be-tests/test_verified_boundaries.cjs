/* P40-16BE — OFFLINE regression for a human-recorded LIVE METADATA-ONLY
 * read-only snapshot. No Supabase connection or real data in GitHub CI.
 * Assertions against report JSON are not live RLS/JWT tests and never
 * substitute for actual company document permissions or JWT signing mode.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const decision=JSON.parse(read('.p40-16be-review/decision.json'));
const m=decision.verified_database_metadata,auth=decision.auth_signing_mode;

test('report is explicitly read-only and does not claim a production release',()=>{
 assert.equal(decision.production_release,'BLOCKED');
 assert.equal(decision.result,'READ_ONLY_AUDIT_COMPLETED_NO_FORMAL_RELEASE');
 assert.equal(decision.repository.code_files_changed,0);
 assert.equal(decision.scope.production_schema_or_policies_modified,false);
 assert.equal(decision.scope.edge_functions_deployed,false);
});
test('no real ERP business, auth user, or session ROWS read',()=>{
 assert.equal(decision.scope.business_rows_read,0);
 assert.equal(decision.scope.auth_users_or_sessions_rows_read,0);
 assert.equal(decision.scope.jwt_or_private_signing_secrets_read,0);
});
test('pinned official main/beta SHA documented and immutable to this add-only branch',()=>{
 assert.equal(decision.repository.formal_main,'2ab9c9d5944b1360ba3eebf49695713168caca8a');
 assert.equal(decision.repository.formal_beta,'62669539053a15174081ba8670b18248195c6f8c');
});
test('all public production state stores are JSONB with RLS enabled',()=>{
 for(const key of ['erp_states','erp_company_states']){
  assert.equal(m.public_tables[key].data_column,'jsonb');
  assert.equal(m.public_tables[key].rls,true);
  assert.equal(m.public_tables[key].has_restrictive_mfa_policy,true);
 }
});
test('employee/user state data has SELECT grants but remains user-policy scoped',()=>{
 assert.equal(m.public_tables.erp_states.authenticated_select_data_column,true);
 assert.match(m.public_tables.erp_states.read_boundary,/User-specific/i);
});
test('company full JSONB state has NO SELECT grant to authenticated',()=>{
 assert.equal(m.public_tables.erp_company_states.authenticated_select_data_column,false);
 assert.equal(m.public_tables.erp_company_states.authenticated_select_metadata_columns,true);
 assert.match(m.public_tables.erp_company_states.read_boundary,/RLS policy alone/);
});
test('company and membership tables have RLS and MFA restriction',()=>{
 assert.equal(m.public_tables.companies.rls,true);
 assert.equal(m.public_tables.company_members.rls,true);
 assert.equal(m.public_tables.company_members.has_restrictive_mfa_policy,true);
});
test('business company membership roles match production front end',()=>{
 assert.deepEqual(m.public_tables.company_members.roles,
  ['owner','admin','accounting','employee']);
});
test('maintenance backup data remains inaccessible for authenticated SELECT',()=>{
 assert.equal(m.excluded_sensitive_table.name,'erp_maintenance.recovery_backups');
 assert.equal(m.excluded_sensitive_table.rls,true);
 assert.equal(m.excluded_sensitive_table.authenticated_select,false);
});
test('no independent single-billing table/view discovered',()=>{
 assert.equal(m.per_billing_table_or_view_present,false);
});
test('no independent single-billing trusted RPC discovered',()=>{
 assert.equal(m.per_billing_auth_rpc_present,false);
});
test('existing employee projection must NOT be misrepresented as a billing PDF API',()=>{
 assert.equal(m.limited_employee_projection_rpc_present,true);
 assert.equal(m.per_billing_auth_rpc_present,false);
});
test('no deployed edge function available for customer PDF generation',()=>{
 assert.equal(m.edge_functions_count,0);
});
test('critical JWT algorithm remains UNKNOWN, never infer RS256 from fake CI',()=>{
 assert.equal(decision.jwt_current_algorithm_verified,false);
 assert.equal(auth.conclusion,'UNKNOWN_NEITHER_RS256_ES256_NOR_HS256_CONFIRMED');
});
test('unavailable JWKS is not proof of HS256',()=>{
 assert.match(auth.empty_jwks_warning,/NOT prove legacy HS256/);
 assert.match(auth.public_jwks_read_result,/Inaccessible/);
});
test('advertised standby JWKS keys do NOT prove currently active signing mode',()=>{
 assert.match(auth.jwks_warning,/does NOT establish/);
});
test('authoritative current signing key check is required',()=>{
 assert.match(auth.required_verification,/CURRENT signing key/);
});
test('never add real project ref or tokens in public review file',()=>{
 const txt=JSON.stringify(decision);
 assert.equal(txt.includes('jimcybsztnwfzrnvexsp'),false);
 assert.equal(txt.includes('Bearer '),false);
 assert.equal(txt.includes('eyJhbGci'),false);
});
test('formal config points to Supabase URL rather than made-up billing backend',()=>{
 const config=read('assets/js/config.js');
 assert.match(config,/supabaseUrl\s*:/);
});
test('existing cloud sync reads ERP full user state with version metadata',()=>{
 const sync=read('assets/js/cloud-sync.js');
 assert.ok(sync.includes('remotePath(userId)'));
 assert.ok(sync.includes('/rest/v1/erp_states?select=data%2Cupdated_at%2Csync_version'));
 assert.ok(sync.includes('readRemote('));
});
test('no new trusted document projection exists in formal export route',()=>{
 const groups=read('assets/js/billing-groups.js');
 assert.ok(groups.includes('function printSaved(id,revision=0,historyOnly=false)'));
 assert.ok(groups.includes("store.getState().billings.find("));
 assert.ok(groups.includes("new URL('external-billing-print.html"));
 assert.equal(decision.trusted_document_projection_exists,false);
});
test('history version selection remains explicit in official UI',()=>{
 const groups=read('assets/js/billing-groups.js');
 assert.match(groups,/const d=revision\?\[\.\.\.g\.document\.history,g\.document\]/);
 assert.match(groups,/const historical=historyOnly\|\|g\.document\.status!=='active'/);
});
test('formal bill print blocks source / settlements drift for current version',()=>{
 const groups=read('assets/js/billing-groups.js');
 assert.ok(groups.includes('g.issues.length||g.termsChanged||g.settlementChanged'));
});
test('frontend JWT payload decoding is not a new backend signature verification',()=>{
 const authgate=read('assets/js/auth-gate.js');
 assert.ok(authgate.includes('function decodeJwtPayload(token)'));
 assert.ok(authgate.includes('function sessionAal('));
 assert.ok(authgate.includes("sessionAal(current)!=='aal2'"));
 assert.match(decision.verified_formal_git_source.auth_gate_js,/do not constitute cryptographic server authority/i);
});
test('all necessary formal release gates remain incomplete',()=>{
 assert.equal(decision.owner_policy_approved,false);
 assert.equal(decision.synced_checked,false);
 assert.equal(decision.backup_recovery_tested,false);
 assert.equal(decision.device_acceptance_done,false);
 assert.equal(decision.production_release,'BLOCKED');
});
test('owner must explicitly approve any main, policy, database or deployment change',()=>{
 const gates=decision.production_deployment_gates.join('\n');
 for(const term of ['owner-approved','per-document','AAL2','RLS','backup','Separate explicit owner permission']){
  assert.ok(gates.includes(term),term);
 }
});
test('no changes to official Supabase client or financial/print production modules',()=>{
 const own=read('.p40-16be-review/README.md');
 assert.match(own,/NO MERGE/);
 assert.match(own,/NO DEPLOY/);
 assert.match(own,/JWT/);
 assert.match(own,/JSONB/);
});
