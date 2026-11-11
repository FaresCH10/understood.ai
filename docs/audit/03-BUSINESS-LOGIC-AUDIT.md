# 03 — Business logic audit

Baseline `270788d`; 2026-11-11. Findings are not fixes. Reproduction scripts use disposable synthetic data only.

## Rules and transitions traced

| Journey | Preconditions / changes / failure and retry rules |
|---|---|
| Registration | Valid company/account input and email proof; registration receipt and mail/OTP state; creates credentials/site and pending activation. Email possession is not operational approval. Retry must preserve the exact registration request |
| Pilot activation | Operator identity, expected entitlement revision, confirmed command and pending request; entitlement/transition/operator receipt committed together; activation starts clock, extensions preserve start; stale/duplicate commands conflict or replay |
| Operational entitlement | Writes call entitlement checks; expiry produces effective read-only; receipts can replay already committed work. Missing entitlement currently means unmanaged/write-allowed, not read-only |
| Worker identity | Company locator + normalized worker ID + password; setup/reset revisions invalidate prior access; first-use language required before eligible delivery; disable/deletion must revoke access without erasing historical assignment evidence |
| Crews | Active site-scoped workers and crew; membership moves validate expected current crew; archived crew cannot receive new audience; historical audience snapshots remain as published |
| Instruction send | Valid immutable request ID/source/modes/audience; capture eligible workers; prepare then publish available languages; unavailable recipients remain in delivery ledger; retry rechecks access/language/deadline and is capped/idempotent |
| Publication | Ready content with exact revision/version/glossary/provider evidence; supersedes prior publication; published snapshot immutable; withdrawals reject new activity but preserve earlier history |
| Response | Own assignment, active publication/content, entitlement and deadline/repeat checks; immutable submission receipt; typed/audio IDs cannot conflict; assessment asynchronous in PostgreSQL |
| Assessment / help | Result is matched, clarification or unassessable; failed processing must surface attention; help independent of answering; open case blocks finishing work; old resolution must not approve a newer attempt |
| Follow-up | Open scoped case and current authority; clarification, requested repeat, review or resolution; repeated answer tied to new repeat receipt; preserve all attempts and histories |
| Actual completion | Acknowledged or current successful/resolved understanding, no blocking open case, current publication/content; worker completion idempotent; completion audit/push event distinct from response receipt |
| Language change | First selection direct; later worker request needs staff approval; profile changes but historical assignment language remains frozen; presentation artifacts provide new-language views without rewriting past evidence |
| Billing / plan | Owner records invoices, partial payments and unpaid voids with integer cents and replay checks; this ledger does not automatically activate a SaaS subscription; operator activation is separate |
| Retention / restore | Policy-specific asynchronous purge, scoped evidence and private-object verification; restored environment quarantined with sessions/push revoked; no automatic real-data activation |

## Confirmed discrepancies

### A-01 — Pilot period

Observed: `PILOT_DAYS=14` in `server/pilot-policy.mjs:1`; operator pilot-grant validation consumes that value in `server/postgres/entitlement-operations.mjs`. Intended: approved 30-day activation described in `docs/PILOT_FLOW.md` and confirmed by the user. A 30-day grant is outside the current server bound. Tests import the same constant, so they can pass while validating the wrong requirement. Correct all policy consumers and independently assert the business duration; preserve existing entitlement dates.

### A-02 — Translation policy cannot be expressed by the production pipeline

Production admission registers only `gemini-approved-v1` for its stages; `productionGeminiAdapters` provides translation inside preparation. `nemotronInstructionDelivery` explicitly returns null for the production tier; that is where DeepL is currently used. Required DeepL-primary/fallback policy is not implemented in the real-data path. Changing a provider environment variable alone is insufficient. Keep admission fail-closed while adding approved stage-specific routing and evidence.

### A-03/A-04 — Late delivery is not a universal content authority

Reproduced: publish with Hindi unavailable, restore Hindi prepared content, retry delivery successfully on the same publication. The worker's delivery ledger contains the question/options. PostgreSQL presentation creation nevertheless returns `content_unavailable`; staff response detail returns `workerQuestion:null` and English choices. These readers use only the immutable initial snapshot. SQLite already has delivery fallback in the equivalent readers. Root cause: publication snapshot and later immutable delivery content are read through inconsistent paths.

Check-back also fails in the same fixture: after an accepted answer and help request, requesting another answer throws `Check-back question unavailable`. A profile language change from Hindi to Urdu still returns `content_unavailable` for presentation. Repair the shared authoritative content selection while preserving publication and delivered content immutability.

### A-05 — Cross-request demo processing budget

Reproduced with a fake clock and mock HTTP: a second preparation resets a closure-wide deadline; translation associated with the first preparation still succeeds at 26 seconds despite its 25-second budget. The adapter instance is cached across Vercel requests. This concerns the synthetic inline adapter, not demonstrated production Gemini processing. Concurrency/request ownership must be explicit.

### A-06 — SQLite repair can discard delivery evidence

Reproduced with a valid populated composite foreign-key table: `ensureInstructionSchema` interprets any multi-column worker FK as broken, executes `DROP TABLE instruction_deliveries`, then recreates an empty table. Row count changes 1 → 0. The comment assumes an empty ledger but the code checks neither emptiness nor actual FK validity. This is a conditional upgrade/data-integrity defect, not evidence of loss in the user's existing database.

### A-11 — Improvement analytics uses a different latest-answer rule

The improvement query sorts equal response timestamps by attempt ID, while authoritative response paths use monotonic submission receipt sequence. A disposable shared-query fixture selects an older clarification over a newer matched answer at the same timestamp. This affects both database consumers and their evidence guards. Correcting only the visible count is insufficient; update the shared query and guards without rewriting frozen historical signals.

## Decisions requiring product review

| ID | Current behavior / uncertainty | Recommended options and consequence |
|---|---|---|
| D-01 | No HR role; administrator manages staff access, while owner/supervisor manage workers | Define workforce-only HR permissions explicitly, or approve removal of that earlier role requirement. Do not grant broad supervisor access merely to make an HR screen work |
| D-02 | New question instructions use multiple-choice; recording API rejects voice answers for them | Approve MC as the intended flow, retain free-form text/voice as a distinct response mode, or restore the earlier default. This changes assessment and UI contracts; do not choose silently |
| D-03 | Supervisor scope generally covers a site, not only their own crew | Confirm site-wide delegation or define explicit crew assignments. Absence of crew-level restriction is not by itself a proven authorization vulnerability |
| D-04 | Missing entitlement is unmanaged, unlimited and write-allowed; migrations preserve legacy tenants | Require explicit grandfathered approval, or make missing entitlement read-only for real-data production. Preserve demo compatibility separately; do not reinterpret all historical companies without review |
| D-05 | Changing language uses on-demand presentation artifacts; old content is not rewritten; historical answers can be expired | Define 'everything changes language' as presentation of retained content. Provider failures and retention expiry must remain visible; do not regenerate deleted data |
| D-06 | Paid plans and manual invoice records exist, but no automatic reconciliation/renewal processor was established | Keep documented manual operator activation for the pilot; specify renewal/expiry ownership before expanding sales. Payment gateway selection remains deferred |

## Root causes and regression boundaries

1. Duplicated SQLite/PostgreSQL logic drifts, especially new readers added after delivery-ledger support.
2. Tests sometimes derive expected behavior from the implementation constant they should independently challenge.
3. Different runtime families expose different capability/provenance models; 'configured' cannot mean 'reviewed for real workers'.
4. Runtime schema repair mixes compatibility detection with destructive DDL instead of a verified migration.
5. Work, comprehension, response receipt, case resolution and delivery availability are separate states. Preserve those distinctions in reports, notifications and UI filters.

Required regression scenarios include original and late delivery, approved language changes before/after response, stale crew membership, same request/new payload, revoked session during external processing, expiry between acceptance and completion, retry after a lost response, and retention/deletion during a leased job. Existing test names alone are not proof all combinations are covered.
