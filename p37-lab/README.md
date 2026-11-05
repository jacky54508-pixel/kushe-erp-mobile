# P37-9C isolated test login

**Scope:** only `/beta/p37-lab/`, only **kushe-auth-lab** (`ldktrfgzzzmklhsnfrol`), read-only P37-9B test data.

- This page deliberately does **not** import `/index.html`, ERP Store, Cloud Sync, any formal API config, or use localStorage, sessionStorage or IndexedDB.
- `connect-src` CSP allows only the P37 lab endpoint. Strict client-side allowlist also limits auth requests to password login/logout and GET, and business-data requests to GET only.
- Uses only the project's **publishable** key. No service-role/secret is embedded.
- Auth uses existing Lab email/password accounts only, **no signup**. It fetches `/auth/v1/user` and then requires an enabled entry in `p37_lab_members` under RLS. All access tokens are kept **in memory only**, never persisted.
- On November 5, 2026, the isolated Auth Lab has **one allowlisted test member**, with **zero synthetic cases and zero allowances** after the P37-17 transaction-rollback regression. Browser login and true two-device synchronization are separate acceptance checks.
- Anonymous RLS denial test: `GET /rest/v1/p37_lab_cases?select=id&limit=1` must fail with HTTP 401 or 403.
- No business POST/PATCH/PUT/DELETE, no RPC calls. Even a successfully allowlisted account can only use this web page to read synthetic cases and allowances.
- NOTE: GitHub Pages `/beta/p37-lab/` and the main ERP remain under the **same browser origin**, so origin-level separation is NOT proven. CSP, standalone code and memory-only tokens reduce but do not eliminate this risk. For strict origin separation deploy this isolated page under a separate test domain.
- Avoid using real ERP identities, passwords or business data. All real cross-device write/sync tests remain explicitly outside P37-9C.

## P37-17 — isolated database atomic-transaction regression

The SQL regression file is [p37-17-atomic-rls-rollback.sql](./p37-17-atomic-rls-rollback.sql). It is **not** loaded by the web page.

- **Run only in** `kushe-auth-lab`, project ref `ldktrfgzzzmklhsnfrol`, using a privileged trusted SQL editor. **Never** execute it in `kushe-erp-cloud`, project ref `jimcybsztnwfzrnvexsp`.
- Uses the existing `p37_lab_cases`, `p37_lab_allowances`, allowlist RLS and `p37_lab_apply_synthetic_allowance` security-invoker RPC; no schema changes or new roles.
- The test asserts anonymous denial, an allowlisted `authenticated` role, rollback after allowance insert and revision update faults, valid 27,300 tax-inclusive discount, deferred constraints, duplicate rejection, stale-version rejection, and unbalanced-value rejection.
- All test writes are inside explicit `BEGIN … ROLLBACK`; verify the final two columns are **0**. No customer or other official ERP data is loaded.
- Verified November 5, 2026: both isolated transaction tests succeeded; final lab counts **cases=0, allowances=0**. The test did **not** involve two simultaneously connected devices, a real customer, tax-platform verification, the formal Store, or formal Supabase.
- This SQL test is **database-level evidence only**, not approval to post P37 allowances. The Lab website remains strictly read-only and has **no write or RPC access in its JavaScript**.

