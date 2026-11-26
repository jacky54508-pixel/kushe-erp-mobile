# K24 controlled recovery retry candidate

## Source and scope

- Based on the Store Git blob `95773d5264d54fe1e1d1cfe54b37a2a2656a9fab` in current formal main `09939153538416cfdc3a532b3ec0cd2af5e19238`.
- Original Store SHA-256: `316829fa8d9418a901c9f849e792516604a02d1f686924db8c377f661464097e`.
- Candidate Store SHA-256: `6d0753fb4c24febbc368d5fcca360e77972331b2c16d4a811841ccb81fe5b94e`.
- Candidate Store Git blob: `8e15b2f1c5ddec9d6120920ae024ca0ce9a1bf25`.
- This is an isolated source candidate, not a production release or an instruction to restore real data.

## Defect reproduced by K23

When controlled recovery fails after its primary write and then rolls back, the old implementation writes a compact `ROLLED_BACK` journal. That record omits the full checkpoint and original `recoveryEvidence`; its owner is the new recovery attempt, while the durable recovery gate still belongs to the original interrupted operation. The next preview cannot prove the original recovery target and remains blocked.

The original interrupted state in the K21 fixtures is revision 3. Its trustworthy business checkpoint is revision 2. Rolling back a failed recovery returns storage to the interrupted input; it does not complete the recovery to revision-2 business content.

## Candidate behavior

1. `recoverStore()` captures the validated original operation owner as `checkpoint.recoveryOf`.
2. Every journal produced from that recovery checkpoint carries the same root `recoveryOf` and original evidence chain, including primary and emergency stages and rollback-in-progress records.
3. A controlled recovery's `ROLLED_BACK` journal retains the complete immediate checkpoint, attempted after-state binding, and `recoveryEvidence`. Ordinary writer rollbacks retain their existing compact terminal record shape.
4. If rollback itself fails, recovery markers retain the root `operationId`. The new `recoveryOperationId` field records the particular failed recovery attempt. Existing strict marker checks and clearing rules are unchanged.
5. The checkpoint walk checks each nested record's schema, fingerprint, revision, root ownership, and before/after linkage. It selects the original business checkpoint rather than promoting a partially committed recovery input. A missing or inconsistent root is refused.
6. The existing maximum of eight evidence links is retained. At depth eight, a new retry candidate is refused before any new persistent write, avoiding creation of an unprocessable ninth link. Fully committed recovery resumption still uses the existing verified-commit path.
7. For `restore-before-checkpoint`, public `beforeRevision` now describes the selected original checkpoint. The added `attemptBeforeRevision` preserves the immediate attempt's checkpoint revision for diagnostics.

## Publication guard during recovery

Independent review found a related concrete risk: the old commit kernel publishes recovered memory before `clearRecoveryMarkers()` finishes. If marker clearing fails, a populated `publishedState` can make the public `load()` wrapper return a state while recovery remains blocked.

The candidate adds a private `deferPublication` option only to controlled recovery. The commit kernel verifies its durable writes and returns the revision without assigning public memory. Once the durable recovery gate is retained, controlled recovery clears public state and sets its memory guard. It keeps private load verification unpublished, clears its temporary state before awaiting marker cleanup, and publishes only after the final marker compare-and-swap succeeds. Any recovery error leaves public state null and the guard set.

This option is not used by ordinary writers or snapshot replacement. Their publication and notification behavior is unchanged. A `resume-verified-recovery` retry performs the remaining verification and marker cleanup using the already committed revision, with no extra commit or recovery audit row.

## Expected verification contract

- A successful rollback preserves the original interrupted revision 3 and old mirrors, plus the full root checkpoint chain. A fresh preview selects revision-2 business content; a successful retry creates a new revision 4 with parent revision 3.
- If an injected IDB rollback error leaves the attempted revision 4 primary in place, a fresh validated retry creates revision 5 with parent revision 4, still using the original revision-2 business content.
- If the durable commit is already verified and only final gate cleanup fails, retry resumes that same committed revision and audit.
- Foreign markers, unknown mirrors, changed preview observations or principals, corrupted checkpoints, and invalid chains remain refused.
- Old compact K23 failure evidence that has already lost its checkpoint remains refused. This patch does not invent missing data or use an external file to bypass storage guards.
- The local candidate passed `node --check`. Actual browser and fault-injection acceptance are recorded separately by the root task's CI runner; this note does not claim those tests have completed.

## Limits

The patch does not add UI, change quotation rendering, modify financial calculations, perform business posting, change cloud synchronization or authorization, or authorize production data recovery. Full hardware power loss and arbitrary concurrent storage manipulation are outside this focused candidate's validation claim.
