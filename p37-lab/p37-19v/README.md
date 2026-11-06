# P37-19V — live Supabase Auth prerequisite and signed-HTTP RPC race gate

**Scope:** `kushe-auth-lab` (project `ldktrfgzzzmklhsnfrol`) ONLY. Do not touch the official ERP Supabase project, official tax vouchers, original bank/AR/retention records, `main` or `beta`. This phase does not authorize official allowance posting.

## Real live inspection (2026-11-06)

The separate test project was queried with the connected Supabase management service, **read-only**. All 3 public lab tables have RLS enabled; there are zero synthetic cases and zero allowances, with one enabled test-only member. The RPC `p37_lab_apply_synthetic_allowance` is `SECURITY INVOKER` (not definer); `authenticated` can execute it, `anon` cannot. `authenticated` has only `UPDATE(revision)` column permission on `p37_lab_cases`, not broad table UPDATE. Two distinct rows exist in `auth.sessions` for the allowed lab user. **Those rows are not JWT credentials, are not evidence of two current usable signed sessions, and do not prove any HTTP RPC concurrency.**

The inspection is recorded in `live-lab-readonly-observation.json`. `lab-posture-readonly.sql` contains only SELECT queries for repeatable manual checks. This snapshot is dated, not perpetual live monitoring.

## Test-runner modes

`signed-http-gate.mjs` delegates to previously vetted P37-19H signed session verification and P37-19G signed PostgREST RPC race. It performs **no network action on import**. All credentials are read only from a trusted local environment and never from chat, the repository, a public web page, or CI. The runner explicitly rejects production endpoints, admin/service-role secrets, non-publishable API keys, missing mode, or missing admin cleanup readiness.

The same `P37_19V_CONFIRM_PROJECT=KUSHE_AUTH_LAB_ONLY`, `P37_19V_URL=https://ldktrfgzzzmklhsnfrol.supabase.co`, `P37_19V_TARGET_CASE_ID=00000000-0000-4000-8000-000000019019`, `P37_19V_PUBLISHABLE_KEY`, `P37_19V_TEST_EMAIL`, and `P37_19V_TEST_PASSWORD` apply in both modes. Use only a dedicated, already confirmed test Auth account from this lab.

**Mode 1: read-only real Auth preflight** — set `P37_19V_MODE=AUTH_READ_ONLY_LAB` and run `node p37-lab/p37-19v/signed-http-gate.mjs` in a trusted local environment. The underlying H preflight must sign in twice, verify different `session_id` JWT claims for the same allowlisted user, confirm each user via real `/auth/v1/user` and RLS-restricted membership, see empty cases/allowances, then sign out both sessions. It never invokes a finance RPC or stages a row.

**Mode 2: staged signed RPC race (manual administrator coordination only)** — first complete Mode 1. Confirm the lab remains empty, and have an authorized operator stage EXACTLY the existing `p37-lab/p37-19g/stage-fixture.sql` into the lab (never elsewhere). Set `P37_19V_MODE=SIGNED_RPC_RACE_STAGED_LAB`, plus `P37_19V_STAGING_COMMITTED=YES_VERIFIED_BY_ADMIN`, `P37_19V_CLEANUP_OPERATOR_READY=YES` and `P37_19V_ZERO_DATA_PRECHECK=CONFIRMED_BEFORE_STAGE`. Rerun the node script. It delegates to G, which checks both real signed Auth sessions and the exact staged synthetic source, sends two conflicting HTTP RPC calls, expects one win and one version conflict, verifies revision and allowance, then signs out the sessions. The runner reports **provisional only**, with an exit code of 2 even on apparent RPC success because the operator still MUST execute the existing exact lab admin cleanup and independently verify final counts 0/0. If anything fails, run cleanup anyway. No permissions should be widened to allow client deletion.

No live secrets were available to this assistant and **neither real mode was run** during this phase. No test case was staged by this phase. Both true signed HTTP Auth/RPC outcomes therefore remain **PENDING**, as does cleanup after an actual HTTP race. Existing lab DB records stayed at 0/0.

## CI assurance and limitations

GitHub Actions runs `node --test p37-lab/p37-19v/signed-http-gate.test.mjs` with **mocked** requests and fake JWTs to enforce failure modes, session cleanup, two-client CAS arbitration, and sanitized output. It also regresses P37-19G/H, P37-19Q, and P37-19T safeguards. No CI job has real lab credentials or sends remote PostgREST requests.

**Crucial distinction:** a mock-transport success is marked `MOCK_*`, not live evidence. Even a real signed HTTP race would remain provisional until a separate trusted administrator proves cleanup of the exact synthetic case and allowance rows. Main, beta, formal ERP and production posting must remain blocked pending user approval and the broader release gates.