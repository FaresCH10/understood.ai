# 07 — Stabilization roadmap and delivery status

Baseline `270788d`; 2026-11-11. **The user subsequently authorized local fixes.** Delivered status and remaining external gates are recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md); the original task definitions below preserve the reviewed acceptance criteria. Each task should be a small reviewable change with its own evidence. Priorities are not speculative delivery dates.

## Dependency order

1. T00 delivery-data preservation can start independently and should be first.
2. T01 policy correction and T03 delivered-content correction are independent of each other and T00.
3. Resolve product decisions D-01–D-06 before implementing their affected high-impact behavior. T02 additionally requires provider/privacy approval.
4. T04 schema constraints need an existing-data inventory and approved handling of inconsistencies.
5. T05 deadline isolation and T07 header parity are independent targeted corrections.
6. T06 bounded library queries follows T03 semantics; T08 live acceptance follows T02.
7. T11 improvement-count correction is independent of provider changes and must also update database evidence guards.
8. T12 dependency remediation/triage can run independently and must be reviewed before release.
9. T09 native infrastructure rehearsal can run independently with disposable resources; T10 release verification follows the chosen fixes and all required acceptance evidence.

Do not wait for unrelated provider decisions to protect the SQLite delivery ledger. Conversely, a green SQLite fix must not be presented as approval of the live-provider pipeline.

## T00 — Preserve SQLite delivery history (P1, A-06)

- **Files/services:** `server/instruction-schema.mjs`, SQLite schema/startup tests, local backup/migration helpers if needed.
- **Root cause/change:** replace the composite-FK heuristic/drop with exact compatibility validation and a safe transactional migration or explicit diagnostic refusal. Keep a recoverable backup boundary before any schema transformation.
- **Dependencies:** none for implementing a safe guard; actual user-database repair requires a separate reviewed data plan.
- **Acceptance:** valid populated schema preserves every row/hash/reference across startup twice; known unsupported schemas never silently drop data; interrupted migration leaves either original or complete migrated state.
- **Tests:** assertion-based A-06 regression, empty/legacy/valid schema fixtures, FK check, rollback/retry and existing delivery suite.
- **Regression risk:** legacy local startup compatibility. Do not weaken data preservation for convenience.

## T01 — Enforce approved pilot contract (P1, A-01)

- **Files/services:** `server/pilot-policy.mjs`, operator entitlement validation/UI, pilot documentation and policy tests.
- **Root cause/change:** align all policy consumers with 30 days from activation, one site/25 active workers. Keep pending/expired read-only and manual activation.
- **Dependencies:** current confirmed pilot decision; inspect persisted trial handling before touching dates.
- **Acceptance:** a fresh activation receives exactly the approved window; overlong pilot rejected; expiry/approval boundary consistent in server/UI; historical trial and paid dates unchanged without explicit approval.
- **Tests:** hard-coded product contract independent of implementation constant, frozen clock boundaries, replay/stale revision, capacity/reactivation/import and read-only journeys.
- **Regression risk:** operators' current grant workflow and legacy entitlements.

## T02 — Implement approved production translation routing (P1, A-02)

- **Files/services:** production admission/provider policy, production adapters/preparation evidence, stage verification, language capability and worker secret configuration.
- **Root cause/change:** separate DeepL translation from other model stages. Preserve source facts/rubric/choice identities, stage provenance, budgets and artifact hashes. Admit only explicitly approved fallback for an unsupported locale; fail closed otherwise.
- **Dependencies:** current provider account capability evidence; processing-region/DPA/retention/no-training approval; selected provider for nontranslation stages and approved fallback; secret paths provided outside chat.
- **Acceptance:** every translation request uses DeepL when supported; fallback cannot silently handle supported locales or unapproved real data; unsupported/unavailable stages surface blocked/retry state; API/operator processes cannot read worker provider secrets.
- **Tests:** mock transports for routing, capability mismatch, malformed response, timeout/abort/retry, no duplicate billable call on replay, multilingual choice equivalence, stage fingerprint/approval invalidation and separation of synthetic/live startup.
- **Regression risk:** high: production preparation, generated audio, assessment/follow-up provenance and admission. Deliver as a separately reviewed provider change; no live calls without authorization.

## T03 — Correct authoritative content readers (P1/P2, A-03/A-04)

- **Files/services:** PostgreSQL presentations, responses, case-repeats; corresponding SQLite readers; inspect translation feedback, library filters and any other snapshot-only language consumer.
- **Root cause/change:** introduce a narrowly scoped delivered-content selection contract: original published language where present, otherwise immutable delivered content for the exact assignment/publication/version; preserve current presentation binding as a separate source when reviewing an answer.
- **Dependencies:** none on T02; fixtures can remain synthetic.
- **Acceptance:** the A-03 fixture can present Hindi → Urdu and send a check-back; supervisor sees exactly delivered Hindi question/options. Original snapshot and delivery rows remain byte/semantically unchanged. Retention/withdrawal/revocation continue to deny content.
- **Tests:** both database engines, original/partial/late delivery, acknowledgement/MC/free-form modes, changed language before/after response, check-back frozen message/retry, expired/purged/foreign content, staff evidence and worker presentation bindings.
- **Regression risk:** medium/high: wrong scope or content precedence could expose another assignment or rewrite historical meaning. Prefer a contract/helper over copying fallback code into each route.

## T04 — Strengthen workspace integrity (P2, A-07)

- **Files/services:** additive SQL migration after current latest, SQLite workspace schema, runtime permission/catalog checks, import/backup/restore paths, shared workspace validation.
- **Root cause/change:** inventory invalid rows first; define tenant/site/staff/request/completion relationships, safe JSON/date/size constraints and required compound keys. Respect valid pre-send attachments and archived/deactivated historical principals.
- **Dependencies:** review existing-data anomaly report; approve repair/quarantine behavior. Do not silently remove rows.
- **Acceptance:** valid current drafts/uploads/completions continue; invalid ownership/metadata rejected at database boundary; migration is safe on representative retained data; privileges/backup/import understand new schema.
- **Tests:** migration before/after hashes, malformed existing row diagnostic, invalid direct SQL, legitimate composition before send, completion worker/site mismatch, restore/import, non-owner roles.
- **Regression risk:** medium/high: a constraint can block migration or valid historical workflows. Separate diagnostic/backfill from enforcement when necessary.

## T05 — Isolate inline request budgets (P2, A-05)

- **Files/services:** inline instruction adapter and call sites/runtime cache.
- **Root cause/change:** own deadline/abort state per instruction request; global pacing remains separate and releases slots on every failure.
- **Dependencies:** none; no provider key needed for tests.
- **Acceptance:** starting request B never extends A; expired A performs no new transport call; B retains its own budget; retries/partial delivery report accurately.
- **Tests:** fake-clock interleaving, deadline before/after stage, abort/error/semaphore release and cached adapter concurrency.
- **Regression risk:** medium: demo throughput/timing and Vercel's 30-second boundary.

## T06 — Bound library query cost (P2, A-08)

- **Files/services:** shared workspace library, PostgreSQL/SQLite query adapters, library filter contract/indexes.
- **Root cause/change:** move scope/filter/status/order/count/page work into SQL, fetching only required rows. Use measured plans/indexes; do not add a new cache or rewrite the frontend.
- **Dependencies:** T03 late-delivery/filter semantics.
- **Acceptance:** current visible results/counts match fixtures, stable pagination, query/output work bounded for one page with substantial history; agreed load target measured.
- **Tests:** old/new result oracle on synthetic fixtures, all filters/drafts/archive/latest version, late language, large history, query plan/native timing and memory.
- **Regression risk:** medium: work-state aggregation and historical crew membership.

## T07 — Align deployment content policy (P2, A-09)

- **Files/services:** `vercel.json`, public static server/header contract tests and deployment documentation.
- **Root cause/change:** apply an approved CSP consistently; keep operator/API/public requirements explicit. Verify effective response headers rather than relying only on checked-in config.
- **Dependencies:** no code prerequisite; approved HTTPS synthetic staging for final host verification.
- **Acceptance:** policy covers HTML/assets/error routes; no unapproved execution origin; microphone/playback/service worker/push flows still function; sensitive API responses remain no-store.
- **Tests:** configuration contract plus real staging header/browser checks and CSP violation review.
- **Regression risk:** medium: blocked assets/media/worker registration. No production host change until approved.

## T08 — Complete real-language/device acceptance (P1 release gate, A-10)

- **Files/services:** language registry/readiness/provider-stage evidence and acceptance records; fix only failures reproduced during this task.
- **Dependencies:** T02, approved provider/privacy scope, consenting reviewers/devices, controlled recipients and permitted spend.
- **Acceptance:** en/ar/hi/ur/bn/ml/ta/te/ne/fil/si/ru/pa-Guru/pa-Arab/id independently accepted for applicable instruction/question/options, text/voice/both, answers, help/follow-up, language presentations and attachments/captions. Staff en/ar and RTL/accessibility verified. Missing capability blocks correctly; no silent English substitution.
- **Tests:** real approved stage smoke tests, native reviewers using safety-sensitive examples and negation/numbers, Android/iOS/desktop permissions/playback/push/click/sign-out, denied permission/network loss, independent accessibility/AT evaluation against agreed target.
- **Regression risk:** semantic harm can pass structural tests. Synthetic fixture results cannot replace independent native acceptance. Do not reduce the required languages without product approval.

## T09 — Rehearse native infrastructure/recovery/security (release gate)

- **Files/services:** existing native PostgreSQL, role/TLS/concurrency, backup/restore scripts/tests and operational runbooks; monitoring/deployment configuration.
- **Dependencies:** disposable PostgreSQL 18 plus isolated restore target and native tools; staging-only infrastructure access; separate application/worker/operator roles and approved proxy/origin settings.
- **Acceptance:** native suite actually runs with no unexplained skip; TLS/least privilege verified; concurrent replay/revocation/lease tests pass; encrypted off-site backup restores under isolated identity and privacy/access quarantine; measured RPO/RTO and alert/rollback drills meet agreed targets.
- **Tests:** existing native suites, interruption/lost-commit tests, storage scanner failure, database disconnect, worker heartbeat/queue lag, mail/push outage and independent security review with agreed scope.
- **Regression risk:** these tests can be destructive if misconfigured. Explicitly isolate disposable resources, never use the live database as a rehearsal target.

## T10 — Freeze and reassess release (release gate)

- **Files/services:** audit/READINESS evidence, candidate fingerprint/approval manifest and deployment runbooks.
- **Dependencies:** chosen fixes verified; D-01–D-06 resolved/accepted; T08/T09 evidence; load targets, data-retention/privacy approvals, release owner.
- **Acceptance:** clean reproducible candidate, lockfile install/build/typecheck/full suite at supported CI settings, all blockers closed or formally accepted with scope, seven required approvals/current config fingerprint, explicit release/rollback decision. Known unresolved P1s cannot be hidden by passing tests.
- **Tests:** documented complete registration → activation → workforce/crew → send/partial retry → worker response/help → supervisor follow-up/repeat → completion/report → expiry/recovery/deletion/restore; negative tenant/role checks and failure recovery.
- **Regression risk:** release evidence becomes stale when code/config/provider changes. Re-freeze and repeat affected checks; never claim deployment from a local test result.

## T11 — Align improvement analysis with latest receipts (P2, A-11)

- **Files/services:** shared self-healing input query, SQLite/PostgreSQL self-healing repositories and additive evidence-guard migration/runtime fingerprints where required.
- **Root cause/change:** use established latest accepted receipt semantics rather than timestamp/random ID ordering. Decide explicitly how newest pending/failed audio affects “latest assessed” without silently using an older answer. Preserve historical frozen signals and the human review requirement.
- **Dependencies:** inspect existing response-state contract; clarify any ambiguity in “latest assessed” versus “latest accepted” before changing thresholds. No provider integration required.
- **Acceptance:** equal-timestamp reverse-ID fixture selects the same current response as authoritative reports; pending/failed/assessment states are consistent and documented; new signal inserts satisfy updated guards; old signals unchanged.
- **Tests:** shared-query invariant plus both-engine repeat/assessment/audio journey, signal thresholds, follow-up cohort, deletion and additive migration/guard tests.
- **Regression risk:** medium: changing query semantics without matching stored guard logic can block signals or misrepresent history.

## T12 — Remediate and assess development/build dependencies (P1, A-12)

- **Files/services:** package manifest/lockfile, Vite/Reticle configuration and build output evidence.
- **Root cause/change:** review advisories against actual enabled paths; update compatible Vite and Reticle dependencies or remove unused instrumentation only with scope approval. Resolve the transitive Zod chain through a compatible upstream release; do not force a major override.
- **Dependencies:** independent of provider decisions; use an isolated locked installation. Advisory triage must distinguish development/build exposure from deployed runtime.
- **Acceptance:** reported entries removed by supported updates or individually documented applicability/mitigation accepted by the security owner; production-only scan remains clean; clean install/build and relevant UI/dev tooling work; no secrets or unexpected instrumentation introduced into release artifacts.
- **Tests:** retain before/after advisory JSON/tree, inspect production output, build/typecheck, affected local UI/instrumentation checks and supported CI/regression suite as warranted.
- **Regression risk:** medium: incompatible plugin/validator APIs and changes to generated assets. No blanket `npm audit fix --force`.

## Remaining product and release decisions

Local correction scope was authorized by “fix all”. Resolve D-01 HR permissions, D-02 question/answer mode, D-03 supervisor scope, D-04 unmanaged tenants, D-05 language-change/retention semantics and D-06 manual renewal responsibility. The independent local corrections have been implemented and verified as recorded in the delivery report. No commit, push, deployment, live migration, paid call or real-worker action is implied by approving this audit document.
