# P37-19H — two independently issued Supabase Auth sessions, read-only preflight

Project: **kushe-auth-lab**, ref `ldktrfgzzzmklhsnfrol` only. It must not contact formal `kushe-erp-cloud`.

## What can be independently verified

- On 2026-11-06, the lab has exactly one enabled allowlisted test member. Metadata-only query confirmed this member has a password set and a confirmed email; no password, email, token or user ID was retrieved or disclosed.
- There are zero cases and zero allowances in the isolated lab. Formal ERP GitHub branches remain unchanged.
- The opt-in preflight logs in twice using the test-only user's credentials supplied through a private ephemeral shell environment, checks two different JWT `session_id` values for the same user and lab issuer, and uses Supabase `/auth/v1/user` to independently validate both tokens. JWT decoding by itself is NOT signature validation.
- It checks allowlisted RLS membership with both independent sessions, reads case/allowance tables to require zero visible records, then attempts to revoke both test sessions on success and failure.
- No request path to a business RPC, no ERP Store, no Supabase service_role, no localStorage, no file write, no GitHub Actions secret is used.

## Manual use (NOT run automatically, as credentials are unavailable in this conversation)

Set the following variables locally in a trusted, ephemeral testing environment, **not in ChatGPT, not in a commit, and not in a public repository**: P37_19H_MODE=AUTH_READ_ONLY_LAB_ONLY, P37_19H_URL=https://ldktrfgzzzmklhsnfrol.supabase.co, P37_19H_PUBLISHABLE_KEY, P37_19H_TEST_EMAIL, P37_19H_TEST_PASSWORD. Run `node p37-lab/p37-19h/run-readonly-preflight.mjs`.

A PASS proves two genuine Supabase Auth sessions and read-only lab RLS access. It does **NOT** prove two concurrent allowance RPC requests. Only after that PASS should the separate G fixture staging, dual-client race, and mandatory administrator cleanup be considered. The G runner still cannot be used without explicit staging and cleanup approvals.

Do not store passwords or JWTs in CI logs. Public GitHub repo workflow runs only offline synthetic tests. A successful read-only preflight should not be interpreted as production financial posting approval.

## Release gate

- Password-set and email-confirmed status: VERIFIED by metadata-only lab query.
- Two distinct real Auth sessions: PENDING (test-only password not available to this assistant).
- Real concurrent lab RPC and cleanup after it: PENDING.
- Tax evidence, all receipt/retention/cheque/cloud writer integration and production release: BLOCKED.