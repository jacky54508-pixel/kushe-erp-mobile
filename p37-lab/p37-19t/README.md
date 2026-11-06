# P37-19T — standalone read-only integration candidate

This independent review-only module is not imported by index.html and is not deployed to beta or main.

It accepts a supplied snapshot, its original Dashboard view, a matched company context and the existing P37-18/P37-19C readers. It computes an adjusted billing preview, KPI detail rows and chart points from one consistent source. It does not create, edit or post any finance records.

The candidate supports only unambiguous one-to-one billing/receivable records, and refuses incomplete, stale or conflicting inputs. It is not an official tax-document verifier. Its release status always remains NO_GO and financial writers are unchanged.

The unit tests use invented accounts and real reader functions. Prior P37-19S browser tests are rerun for regression; this is not a new live-device/browser integration test of the P37-19T module.

Original ERP Store, Dashboard, Reports, Cloud Sync and existing company data are unchanged. Future formal UI integration requires separate review, real device evidence and approval.
