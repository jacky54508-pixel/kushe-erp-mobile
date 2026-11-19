'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluate,requiredGateNames}=require('./release-gate.cjs');
const decision=require('../.p40-16bm-review/decision.json');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('production release remains explicitly blocked',()=>{
  assert.equal(decision.production_release,'BLOCKED');
  assert.equal(evaluate(decision.evidence_gates).status,'BLOCKED');
  assert.equal(decision.production_deployment_performed,false);
});
test('official main and beta are pinned; new lab cannot authorize changes',()=>{
  assert.equal(decision.formal_main_pinned,'2ab9c9d5944b1360ba3eebf49695713168caca8a');
  assert.equal(decision.formal_beta_pinned,'62669539053a15174081ba8670b18248195c6f8c');
  assert.equal(decision.production_application_files_modified,0);
  assert.equal(decision.production_schema_or_policies_modified,false);
  assert.equal(decision.real_business_rows_read_or_changed,false);
});
test('dashboard ES256 evidence does not masquerade as a verified live session',()=>{
  assert.equal(decision.current_supabase_signing_algorithm,'ES256_DASHBOARD_SCREENSHOT_ONLY');
  assert.equal(decision.live_session_jwt_verified,false);
  assert.equal(decision.evidence_gates.auth_es256_live_token_verified,false);
});
test('user JSONB browser synchronization is NOT a customer document gateway',()=>{
  assert.equal(decision.source_state.browser_sync_table,'public.erp_states.data');
  assert.equal(decision.source_state.trusted_server_atomic_document_projection_exists,false);
  assert.equal(decision.source_state.company_to_authoritative_document_source_verified,false);
  assert.match(decision.proposal.security_rule,/NOT_ITSELF_INDEPENDENT_FINANCIAL_TRUTH/);
});
test('company data grants are not inferred from RLS or frontend role',()=>{
  assert.equal(decision.source_state.company_state_data_authenticated_select_verified,false);
  assert.equal(decision.source_state.company_context_role_from_frontend_only,true);
  assert.equal(decision.evidence_gates.company_user_ledger_mapping_confirmed,false);
});
test('reviewer model stays undecided without owner action',()=>{
  assert.equal(decision.proposal.reviewer_policy,'UNDECIDED_NOT_OWNER_APPROVED');
  assert.equal(decision.evidence_gates.owner_approved_reviewer_policy,false);
  assert.equal(decision.proposal.reviewer_options_to_approve_separately.length,2);
});
test('historical PDFs stay unchanged and require privacy audit before external use',()=>{
  assert.equal(decision.proposal.legacy_customer_pdf,'UNCHANGED_NOT_REDIRECTED');
  assert.match(decision.proposal.historical_pdf_external_release,/MUST_AUDIT/);
});
test('unrelated financial and operational workflows remain unchanged',()=>{
  assert.equal(decision.proposal.existing_finance_write_path,'UNMODIFIED');
  assert.equal(decision.proposal.fail_closed_if_projection_missing,true);
});
test('required evidence is a nonempty explicit all-true gate, not a loose score',()=>{
  assert.ok(requiredGateNames.length>=12);
  assert.equal(requiredGateNames.length,new Set(requiredGateNames).size);
  assert.deepEqual(requiredGateNames,Object.keys(decision.evidence_gates));
  assert.ok(requiredGateNames.every(name=>decision.evidence_gates[name]===false));
});
test('missing any one authorization/recovery/financial gate blocks review',()=>{
  for(const absent of requiredGateNames){
    const evidence=Object.fromEntries(requiredGateNames.map(name=>[name,true]));
    evidence[absent]=false;
    const result=evaluate(evidence);
    assert.equal(result.status,'BLOCKED',absent);
    assert.deepEqual(result.missing,[absent]);
  }
});
test('non-boolean or undefined evidence never passes',()=>{
  for(const val of [undefined,null,0,1,'true','PASS',{},[]]){
    const evidence=Object.fromEntries(requiredGateNames.map(name=>[name,true]));
    evidence.owner_approved_reviewer_policy=val;
    assert.equal(evaluate(evidence).status,'BLOCKED');
  }
});
test('fake all-true evidence cannot auto deploy anything',()=>{
  const claimed=Object.fromEntries(requiredGateNames.map(name=>[name,true]));
  assert.equal(evaluate(claimed).status,'REVIEW_READY_NO_AUTODEPLOY');
  assert.equal(decision.production_release,'BLOCKED');
});
test('the decision data contains no JWT bearer, private signing keys, or project ID',()=>{
  const content=read('.p40-16bm-review/decision.json');
  assert.doesNotMatch(content,/Bearer\s+|eyJhbGci|sb_secret_|service_role|jimcybsztnwfzrnvexsp|PRIVATE KEY/i);
});
test('offline static design is not falsely labeled live JWT/RLS or PDF validation',()=>{
  assert.equal(decision.github_ci_is_offline_contract_check_not_live_auth_test,true);
  assert.equal(decision.evidence_gates.customer_privacy_historical_pdf_verified,false);
  assert.equal(decision.evidence_gates.pdf_bytes_final_delivery_verified,false);
});
// Important: this runs in GitHub's actual full checkout with CI=true, and must
// not be skipped there. Local isolated directories do not contain repo sources.
test('read-only pin to five real formal source boundaries', {skip:!fs.existsSync(path.join(root,'assets/js/erp-store.js'))&&process.env.GITHUB_ACTIONS!=='true'?'requires full repository checkout':false},()=>{
  const cloud=read('assets/js/cloud-sync.js');
  const auth=read('assets/js/auth-gate.js');
  const store=read('assets/js/erp-store.js');
  const groups=read('assets/js/billing-groups.js');
  const printer=read('assets/js/external-billing-print.js');
  assert.ok(cloud.includes('erp_states?select=data%2Cupdated_at%2Csync_version'));
  assert.ok(cloud.includes("'/rest/v1/rpc/erp_state_cas_write_v2'"));
  assert.ok(auth.includes('company_members?select=company_id,user_id'));
  assert.ok(auth.includes('erp_company_states?select=company_id,sync_version'));
  assert.ok(store.includes('state.meta.externalBillingDocuments=next;'));
  assert.ok(store.includes('sourceSnapshots:ctx.sources.map'));
  assert.ok(groups.includes('function printSaved(id,revision=0,historyOnly=false)'));
  assert.ok(groups.includes("new URL('external-billing-print.html"));
  assert.ok(printer.includes('if(!payload.historical)'));
  assert.ok(printer.includes('const invoices=refs.rows.map'));
});
