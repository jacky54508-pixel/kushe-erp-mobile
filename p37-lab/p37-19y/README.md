# P37-19Y — safer Supabase Auth Lab password recovery callback, review-only

**Branch-only security fix. `main`, `beta`, and all company financial/account data stay untouched. No reset email or real password is sent during CI.**

## Verified reason for the user's confusing page

The existing `p37-lab/reset-password.js` on `beta` accepts **only** `#access_token=<...>&type=recovery`. A real Supabase callback may instead return a URL fragment such as `#error=access_denied&error_code=otp_expired&error_description=...` or a query-form `?code=...` (PKCE, which requires a pre-existing paired verifier). Previously these produced an unhelpful generic invalid-link message. Auth Lab logs have recorded recovery/verification errors, but no signed callback secret or user's actual link was inspected, so it cannot be proved whether the latest email was expired or simply unsupported.

## Change in this isolated candidate

- Securely classify `error=access_denied`, `error_code=otp_expired` and other unknown provider failures; display a safe, informative error **without including raw error descriptions, access tokens or email**.
- Explicitly distinguish a PKCE `?code=` redirect from an implicit `#access_token&...&type=recovery` redirect. PKCE is **rejected** unless the flow has a matching verifier. This change does not fabricate or bypass that verifier, and no `/auth/v1/token` exchange is added.
- Explicitly reject `token_hash` as a bearer JWT, non-recovery auth types, missing/multiple access tokens, malformed expiry/expired `expires_at`, and unsupported token type.
- Immediately remove callback query/fragment from address bar before any await/fetch. If URL scrubbing fails, stop processing rather than leave a token visible.
- Existing strict URL/origin, test Supabase endpoint allowlist, authenticated `/auth/v1/user` check, P37 RLS membership check, purpose restrictions, password length, logout, and no token-storage rules remain. A valid-shaped implicit token never enables password fields until **both** user identity and membership are confirmed. Unknown/sensitive inputs never appear in UI error strings.
- Update only the reset page's JS cache-buster in the review branch. No changes to P37 Auth Lab project, Redirect URLs, email frequency, RLS or authorization.

## Automated proof

Node `vm` tests run with fictional callback strings and mock Auth Lab HTTP response functions. They cover expired callback, error masking, PKCE refusal, `token_hash` refusal, no-link/no-request, malformed/double tokens, forged type, valid-shaped synthetic implicit callback + allowlist + mocked password PUT/logout, RLS denial, user denial, HTTP 429, and foreign origin.

The Chromium test loads the **actual reset-password.html/js/css** only through `route.fulfill` at the exact test GitHub Pages origin. It blocks every outgoing URL and mocks `/auth/v1/user`, RLS membership, password update, and logout. It never accesses the live Supabase project or sends an actual recovery email. Its PASS is a browser callback parser/GUI compatibility result, **not** proof that a genuine clicked link has succeeded.

## Remaining before touching beta

Review the candidate's browser CI and source diff, confirm it has no added token, bypass or expanded API permission; then obtain explicit authorization to deploy **only** the P37 Lab reset-password.html/js changes to `beta`. Do not push `main`. Since an already-used/expired recovery link cannot be revived by changing JavaScript, the real-world test still requires one new email after the SMTP rate limit clears. If it again fails, inspect sanitized `error_code` in local Auth logs (not raw tokens) and the callback URL flow, rather than repeatedly sending email.

**All financial posting and production release gates remain NO-GO.**