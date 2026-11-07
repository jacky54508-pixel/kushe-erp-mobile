# P37-19Z — P37 Auth Lab 6-digit Recovery OTP (isolated review ONLY)

**Nothing in this branch deploys to the user-facing beta site or main.** There is NO change to an actual Supabase email template, Auth user/password, RLS, redirect URLs, email quota, Store, billing, bank, commissions, payroll or Cloud Sync. Testing uses invented addresses, codes and mock responses only.

## Why

The user repeatedly received `otp_expired` after clicking a new recovery email. The P37-19Y diagnostic display correctly distinguishes this server-side denial, but cannot resurrect a consumed single-use link. A human-entered 6-digit **Recovery OTP** avoids requiring the user to click a link that might be pre-fetched. This is a *candidate approach*, not proof of the specific original failure cause.

## Reviewed flow

1. The new standalone `p37-lab/p37-19z/otp-reset.html` / `otp-reset.js` is intended only for the test GitHub Pages origin `/kushe-erp-mobile/beta/p37-lab/p37-19z/otp-reset.html` and fixed test Supabase project `ldktrfgzzzmklhsnfrol`. It does not change the existing `reset-password.html`/`.js`.
2. Send at most one request per page to `POST /auth/v1/recover?redirect_to=<the existing, already allowlisted reset-password.html URL>`. The server's *Recovery* email template must first be **manually** changed to include `{{ .Token }}`, which is the Supabase-provided six-digit OTP. The example mail template here is NOT automatically applied.
3. Enter six decimal digits **manually**. Call `POST /auth/v1/verify` with `{email,token,type:'recovery'}`. Supabase determines whether the OTP is current, correct and unconsumed. Reject malformed values and cap client attempts to 3 per page; Supabase enforces actual server rate/expiry controls.
4. The returned access token is not sufficient by itself. Require a valid bearer response with reasonable expiry, then independently check `/auth/v1/user` and P37's `p37_lab_members` RLS-protected row with `purpose:'P37_9B_TEST_ONLY'` before unlocking password inputs.
5. Only after both checks may `PUT /auth/v1/user` update this test user's password. Then attempt logout and clear all transient token/password/OTP fields. No localStorage/sessionStorage/cookies, no payment, invoices, registration, admin keys, service role or RPC.

## Safety and limitations

- The test page is on the same GitHub Pages origin as the ERP site; using a different URL path is not full origin isolation. The candidate retains strict CSP, same-domain path check, fixed Auth Lab API allowlist and nonpersistent transient bearer token, but a distinct test origin would be safer for real-world use.
- Six-digit OTP verification does **not** override Supabase email rate limits. The earlier project used a low built-in SMTP quota; do not send repeatedly if 429 occurs. The existing project-specific email delivery and template must be separately verified.
- The OTP mail example must be reviewed with the operator before changing Supabase's **Reset Password** email template. It includes exactly `{{ .Token }}` and a manually opened test page URL, not `{{ .ConfirmationURL }}`. A template change affects all password recovery messages in the **test** Supabase project, so requires separate approval.
- The client never produces or verifies OTPs itself; the server does. UI limits are not a substitute for backend rate limits.
- **Main, beta, formal ERP and test Auth Lab credentials/data are untouched.** Completion of mock browser tests is NOT a live signed Auth or two-client RPC evidence and not a formal tax/finance release.

## CI verification

`otp-reset.test.cjs` runs fully mocked Auth and RLS flows in Node vm, validating one-send, 429/no retry, expired/malformed OTP, identity mismatch, revoked RLS membership, simulated password change and logout, no raw token or unauthorized finance actions. `browser_otp_e2e.py` runs real Chromium rendering at an intercepted fake GitHub Pages URL, with every outgoing request route-mocked and any unrecognized destination aborted. Neither CI job has test login secrets or sends a real email.

**After PASS**: only with explicit additional approval should the test-project mail template and a minimal beta deployment of this independent page be considered, followed by a genuine test-only password recovery acceptance. Existing `main` and all formal financial writers remain NO-GO.