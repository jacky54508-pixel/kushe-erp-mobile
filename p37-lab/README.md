# P37-9C isolated test login

**Scope:** only `/beta/p37-lab/`, only **kushe-auth-lab** (`ldktrfgzzzmklhsnfrol`), read-only P37-9B test data.

- This page deliberately does **not** import `/index.html`, ERP Store, Cloud Sync, any formal API config, or use localStorage, sessionStorage or IndexedDB.
- `connect-src` CSP allows only the P37 lab endpoint. Strict client-side allowlist also limits auth requests to password login/logout and GET, and business-data requests to GET only.
- Uses only the project's **publishable** key. No service-role/secret is embedded.
- Auth uses existing Lab email/password accounts only, **no signup**. It fetches `/auth/v1/user` and then requires an enabled entry in `p37_lab_members` under RLS. All access tokens are kept **in memory only**, never persisted.
- On November 4, 2026, Auth Lab has **zero test users and zero allowlist entries**; successful test login cannot be demonstrated until a separately authorized test user and allowlist entry are provisioned.
- Anonymous RLS denial test: `GET /rest/v1/p37_lab_cases?select=id&limit=1` must fail with HTTP 401 or 403.
- No business POST/PATCH/PUT/DELETE, no RPC calls. Even a successfully allowlisted account can only use this web page to read synthetic cases and allowances.
- NOTE: GitHub Pages `/beta/p37-lab/` and the main ERP remain under the **same browser origin**, so origin-level separation is NOT proven. CSP, standalone code and memory-only tokens reduce but do not eliminate this risk. For strict origin separation deploy this isolated page under a separate test domain.
- Avoid using real ERP identities, passwords or business data. All real cross-device write/sync tests remain explicitly outside P37-9C.
