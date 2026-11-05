# P37-19F — authentic isolated Supabase database verification and release blocker

## Proven on 2026-11-05

- Only `kushe-auth-lab` (ref `ldktrfgzzzmklhsnfrol`) was accessed. The production ERP cloud was not opened or written.
- Remote PostgreSQL accepted rollback-only synthetic SQL exercising RLS, invoker RPC, the two fault injection points, the 27,300 allowance calculation, idempotent duplicate refusal and stale revision refusal.
- Exact isolated test-case and allowance counts after rollback: `0 / 0`, reconfirmed by read-only query.
- Verified RLS enabled on all three existing P37 lab tables. Anonymous role is not granted RPC execution.
- Two PostgreSQL backend PIDs were observed from independent SQL requests, but **both advisory-lock attempts succeeded**: simultaneous contention was *not* demonstrated. Connector scheduling may have serialized the calls.

## NOT proven

- Two actual authenticated browser/client tokens racing on the *same* remote persisted lab fixture.
- End-to-end Supabase HTTP RPC CAS under real concurrent timing.
- Cross-device formal ERP Cloud Sync, actual tax voucher verification or official billing/receipt/retention/cheque/KPI writer integration.

## Do not broaden permissions to make a green test

Existing lab authenticated grants intentionally omit `DELETE` on synthetic cases/allowances. **Do not create committed HTTP test fixtures without an authenticated, independently accepted cleanup mechanism.** Avoid service-role keys in browser/CI, avoid changing RLS, RPC function permissions, lab memberships or official cloud data as a workaround.

Files in this directory: `p37-19f-rollback-rls.sql` (previously executed in isolated project), `evidence.json` (factual run summary), `release-gate.cjs` (unconditionally disables production posting), and unit regression.

The GitHub Action validates code and regression without re-running any network/SQL writes. If a future end-to-end test is desired, use a separately configured authenticated test-only runner with ephemeral lab fixture setup and guaranteed server-authorized cleanup, followed by cross-device reconciliation and new user approval before release.

**Gate: P37-19F database rollback PASS; real authenticated dual-client CAS PENDING; production release BLOCKED.**