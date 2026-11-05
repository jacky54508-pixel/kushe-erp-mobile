# P37-19I — real isolated database lifecycle across separate commits

On 2026-11-06, the isolated `kushe-auth-lab` PostgreSQL database was used, not the real ERP cloud.
The existing G script staged and COMMITTED exactly one synthetic case. An independently executed transaction applied and COMMITTED exactly one 27,300 allowance via the existing invoker RPC as a test authenticated SQL role. A third, separate privileged transaction cleaned the exact case and allowance. A fourth, independent read-only database query confirmed **0 cases / 0 allowances**.

The confirmed synthetic values were original gross NT$1,310,400; discount NT$27,300; effective gross NT$1,283,100; effective receivable NT$1,160,900; effective retention NT$122,200.

Important: SQL role simulation is not a signed Supabase Auth HTTP session. Real two authenticated HTTP clients racing one RPC, independent tax-voucher verification, live cross-device synchronization and full formal receipt/retention/cheque/bank integration are still not proven. Formal posting is explicitly blocked.

This branch adds only documentary SQL and offline regression tests, not a writer or new database schema. The SQL is NOT executed by GitHub Actions. To repeat it, use only the authorized isolated lab and the G manual stage and cleanup scripts, with exact account safeguards and a trusted operator ready to restore zero records.

P37-19I: real separate committed transaction and cleanup PASS; real two-client authenticated HTTP RPC PENDING; production main/beta remains unchanged.