# P37-19G — isolated Supabase staging and administrator cleanup

2026-11-05: real isolated database administrator create / apply synthetic 27,300 allowance / exact delete / COMMIT lifecycle verified; final cases=0, allowances=0.

MANUAL ONLY. Never run staging or cleanup against formal ERP cloud. Only allowed project: kushe-auth-lab (ldktrfgzzzmklhsnfrol).

1. Verify test lab is empty, the one allowlisted user can sign in with two distinct sessions, and trusted administrator is ready to clean up.
2. In the isolated lab trusted SQL editor run stage-fixture.sql. It commits one synthetic case. This was NOT run by CI.
3. Only when the strict env flags, test-only publishable key, and dedicated account credentials exist, run dual-client-rpc.mjs. It refuses other projects or missing cleanup approval. It verifies one RPC winner and one version conflict in two authenticated HTTP sessions.
4. ALWAYS run cleanup-fixture.sql via the lab administrator SQL editor even on failure; independently check 0 case and 0 allowance. No authenticated DELETE permission is added.
5. Remove temporary test credentials and flags. Never use actual business logins, service-role keys or formal company data.

Real lab admin cleanup within a single committed transaction: PASS. Actual independent authenticated parallel HTTP RPC: PENDING. Cleanup after a separately committed HTTP test: PENDING. Production release and financial posting: BLOCKED.
GitHub Actions runs only mocked HTTP tests and static source checks, never authenticates to Supabase or executes staging scripts.

ERP Store, Cloud Sync, invoice, receivable, bank, payroll and company data remain unchanged.