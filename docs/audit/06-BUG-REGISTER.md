# 06 — Issue register

Baseline `270788d`; 2026-11-11. **Baseline audit; subsequent local corrections are recorded in [IMPLEMENTATION.md](IMPLEMENTATION.md).** Severity expresses potential impact within the stated scope; it does not assert production exploitation. No P0 was confirmed. A-10 is an acceptance/evidence gap, not a claim that every live locale is broken.

| ID | Priority | Finding | Evidence class | Status |
|---|---|---|---|---|
| A-01 | P1 | Pilot policy still limits grants to 14 rather than approved 30 days | Source/requirement contradiction | Corrected locally; see delivery evidence/limits |
| A-02 | P1 | Required DeepL-primary routing absent from production provider path | Source/requirement contradiction | Corrected locally; see delivery evidence/limits |
| A-03 | P1 | Late-delivered language unavailable to presentation/check-back readers | Disposable PGlite reproduction | Corrected locally; see delivery evidence/limits |
| A-04 | P2 | Staff late-delivery detail loses worker question/localized choices | Disposable PGlite reproduction | Corrected locally; see delivery evidence/limits |
| A-05 | P2 | Overlapping inline requests share/reset a processing deadline | Fake clock/mock transport reproduction | Corrected locally; see delivery evidence/limits |
| A-06 | P1 | SQLite schema repair drops populated valid delivery ledger | Disposable in-memory SQLite reproduction | Corrected locally; see delivery evidence/limits |
| A-07 | P2 | Workspace tables accept invalid ownership/content metadata | Disposable PGlite reproduction + schema review | Corrected locally; see delivery evidence/limits |
| A-08 | P2 | Library pagination loads all site instruction/assignment history | Source-confirmed complexity | Corrected locally; see delivery evidence/limits |
| A-09 | P2 | Vercel static policy omits hosted server's CSP | Configuration comparison | Corrected locally; see delivery evidence/limits |
| A-10 | P1 release gate | Required all-locale live capabilities/quality lack acceptance evidence | Source capability mismatch and missing external evidence | Unverified; blocks stated scope |
| A-11 | P2 | Improvement analysis uses timestamp/UUID ordering instead of latest submission receipt | Disposable SQLite shared-query reproduction | Corrected locally; see delivery evidence/limits |
| A-12 | P1 | Development/build dependency tree contains high-severity advisories | Locked install and npm advisory scan | Corrected locally; see delivery evidence/limits |

## A-01 — Pilot grant duration

- **Module/files:** `server/pilot-policy.mjs:1`; `server/postgres/entitlement-operations.mjs:90`; `docs/PILOT_FLOW.md`; policy tests and operator consumers.
- **Expected:** approved pilot lasts 30 days from operator activation; pending/expired read-only; one site/25 active workers.
- **Actual/evidence:** `PILOT_DAYS=14`; operator rejects a grant ending more than 14 days ahead. Existing tests derive assertions from the same constant.
- **Reproduce:** inspect the constant and operator grant bound; compare to the documented/confirmed 30-day rule. No real entitlement changed.
- **Root cause:** product policy drift hidden by implementation-derived test expectations.
- **Impact:** cannot activate the promised pilot correctly; UI/server may communicate the wrong window.
- **Recommendation/dependencies:** T01; update all consumers and independent contract tests. Do not retroactively alter existing start/end dates without an explicit migration decision.
- **Tests/regression risk:** exact 30-day activation, invalid longer grant, expiry boundary, pending approval, extension/replay, 25-worker cap. Risk: previously issued trials/paid grants.

## A-02 — Production translation policy mismatch

- **Module/files:** `server/postgres/production-admission.mjs:15`, `server/ai/production-gemini.mjs`, `server/ai/provider-policy.mjs`, `server/ai/nemotron-instruction-delivery.mjs`.
- **Expected:** DeepL primary with only explicitly reviewed fallback for unsupported locales; other stages separately approved.
- **Actual/evidence:** live adapter registry/admission and real-data policy use `gemini-approved-v1`; preparation translates through that pipeline. DeepL is in the inline adapter, which is disabled for production tier. Production fallback is currently required disabled.
- **Reproduce:** follow production configuration to preparation adapter; compare demo adapter's production early return. No provider call needed to establish the route mismatch.
- **Root cause:** multiple runtime/provider families with incompatible admission/capability contracts.
- **Impact:** cannot satisfy approved translation policy by configuring a DeepL key; bypassing admission would introduce privacy/reliability risk.
- **Recommendation/dependencies:** T02, after product/provider stage decisions; implement a separately reviewed live translation stage/provenance policy and narrow fallback. Preserve fail-closed startup and worker-only credentials.
- **Tests/regression risk:** correct primary/fallback locale, no silent substitution, unsupported locale block, timeouts/budgets/retries, approval fingerprint, source/provider evidence. Risk: every generated artifact and real-data admission.

## A-03 — Late delivery cannot be presented or used for check-back

- **Module/files:** `server/postgres/presentations.mjs:40`; `server/postgres/case-repeats.mjs:10`; delivery ledger in `server/postgres/instructions.mjs`. Also inspect snapshot-only language consumers such as translation feedback and library language filtering.
- **Expected:** a worker successfully delivered a language after initial publication can view retained content in a newly approved language and receive a check-back based on the delivered question.
- **Actual/evidence:** initial delivery count 1, retry count 2; Hindi ledger has question/options; presentation returns `content_unavailable`, including after profile changes Hindi → Urdu. After an accepted answer/help case, check-back throws `Check-back question unavailable`.
- **Reproduce:** run `evidence/repro-late-delivery.mjs` following evidence README: prepare en/hi, publish en only, restore hi preparation, retry same publication, change profile language, request presentation, submit a published choice, request help, request check-back.
- **Root cause:** immutable initial snapshot is treated as the only localized source even though later delivery is recorded separately. SQLite already has equivalent presentation fallback.
- **Impact:** legitimate recipients lose language-change/re-answer workflow after partial sending. P1 applies to this core workflow, not all instructions.
- **Recommendation/dependencies:** T03; define scoped authoritative delivered-content resolution and use it for every affected reader without rewriting historical snapshots/ledger.
- **Tests/regression risk:** late/original delivery, language approval before/after answer, typed/audio/history sources, repeat frozen message, revoked/withdrawn/purged content, cross-tenant lookup. Risk: wrong version/language or disclosure if scope checks weakened.

## A-04 — Staff evidence does not match late delivered content

- **Module/files:** `server/postgres/responses.mjs:137–139`; compare SQLite `server/responses.mjs` delivery fallback.
- **Expected:** supervisor response detail displays the question/options actually delivered to that assignment.
- **Actual/evidence:** same A-03 fixture returns `workerQuestion:null` and English choices while immutable delivery contains Hindi question/options.
- **Reproduce:** query `getPublicationResponse` for the late Hindi assignment in the retained reproduction.
- **Root cause:** same content-authority drift as A-03; separate observable staff contract.
- **Impact:** misleading review context and evidence, particularly after repeat/language changes.
- **Recommendation/dependencies:** T03 shared resolver; retain distinction between delivered content and later presentation binding.
- **Tests/regression risk:** compare exact localized question/options and answer binding for original/late delivery, acknowledgement mode and retained/expired content. Risk: retroactively presenting current rather than answered version.

## A-05 — Shared inline deadline

- **Module/files:** `server/ai/nemotron-instruction-delivery.mjs` closure deadline/prepare/translate; cached Vercel adapter instance.
- **Expected:** each instruction has its own elapsed-time budget; another request cannot extend it.
- **Actual/evidence:** prepare at t=0, second prepare at t=24s, translate at t=26s still calls mock provider and succeeds despite first request's 25s budget.
- **Reproduce:** `evidence/repro-local-invariants.mjs`, fake clock + mock fetch, no API key or real HTTP.
- **Root cause:** mutable request deadline belongs to the adapter instance rather than one processing request.
- **Impact:** unpredictable deadlines/transport termination under overlapping demo requests. Production Gemini impact was not established.
- **Recommendation/dependencies:** T05; pass request budget/context explicitly or create request-owned adapters; retain shared pacing separately.
- **Tests/regression risk:** interleaved requests, expiry between stages, aborted transport, semaphore release/error. Risk: retries and partial delivery timing.

## A-06 — Destructive SQLite repair

- **Module/files:** `server/instruction-schema.mjs:25–29`.
- **Expected:** valid historical delivery evidence survives startup/schema upgrade; unknown corrupt state fails safely.
- **Actual/evidence:** valid composite worker FK detected as a bad schema, table dropped/recreated; populated synthetic ledger count 1 → 0, prior FK check clean.
- **Reproduce:** `evidence/repro-local-invariants.mjs` creates valid minimal composite-FK ledger and invokes `ensureInstructionSchema`.
- **Root cause:** heuristic conflates composite FK with broken schema; comment assumes empty data without enforcing it; destructive DDL used as runtime repair.
- **Impact:** conditional irreversible history loss on affected local/legacy database schemas. No evidence the user's current data was lost.
- **Recommendation/dependencies:** T00 first; remove automatic destructive repair, validate exact schema/data, back up and migrate transactionally or fail closed with actionable diagnostics.
- **Tests/regression risk:** populated valid composite FK, known legacy broken schema, empty table, interrupted migration, replay and row/hash/FK preservation. Risk: blocking old demo startup; do not trade that for silent deletion.

## A-07 — Workspace integrity gaps

- **Module/files:** migration `114_instruction_workspace.sql`; caption column in migration 122; `server/workspace.mjs` application validation.
- **Expected:** database rejects inconsistent ownership and impossible metadata even from a future writer/import/maintenance tool.
- **Actual/evidence:** disposable fully migrated schema accepted a composition for nonexistent org/site/staff with invalid JSON/date, and an attachment with nonexistent references, negative bytes and invalid base64. `assignment_completions` has an assignment FK but no corresponding compound worker/site relationship.
- **Reproduce:** final inserts in `evidence/repro-late-delivery.mjs`; deliberately invalid direct SQL, not an HTTP bypass.
- **Root cause:** newer workspace tables do not carry the integrity conventions of the older core schema.
- **Impact:** orphan/cross-context data and fragile cleanup/report assumptions if application validation is bypassed. No live corruption or tenant exploit proven.
- **Recommendation/dependencies:** T04; inventory existing rows, choose repair/report policy, add additive relationship/type/check constraints appropriate to both engines. Do not require a sent request FK for legitimate pre-send attachments.
- **Tests/regression risk:** valid draft/upload/send/complete and restore/import; reject invalid scope/negative size; migration with legacy malformed rows produces a safe report. Risk: previously accepted records blocking migration.

## A-08 — Unbounded library pagination

- **Module/files:** `server/workspace.mjs:103–126`.
- **Expected:** page-size work is bounded by scoped SQL filtering/pagination or an explicit history limit.
- **Actual/evidence:** selects all site briefings/snapshots and assignments, groups/filter/sorts in JS, then slices requested page. Complexity grows with full history.
- **Reproduce:** source query inspection; no benchmark or user-visible timeout was reproduced.
- **Root cause:** UI pagination added after materializing the whole site data set.
- **Impact:** growing database/memory/latency cost; 25 active workers does not cap instruction history.
- **Recommendation/dependencies:** T06 after T03 content semantics; scoped SQL counts/status/filter/order/page, measured indexes/query plans.
- **Tests/regression risk:** result/count equivalence for all filters, stable order, drafts, archived/latest versions, original/late languages, many-history fixture. Risk: changed work-state or historical audience semantics.

## A-09 — Hosting CSP parity

- **Module/files:** `server/public-build.mjs:52`; `vercel.json:18`.
- **Expected:** supported public hosting paths apply an approved content-execution policy compatible with app/media/service worker.
- **Actual/evidence:** hosted Node static server emits CSP; checked-in Vercel headers do not specify one. Other security headers do exist.
- **Reproduce:** compare source header declarations; inspect actual HTTPS headers in an approved staging release before concluding final host behavior.
- **Root cause:** transport-specific security configuration drifts.
- **Impact:** reduced defense in depth on one deployment path if no external policy supplies it. No XSS demonstrated.
- **Recommendation/dependencies:** T07; shared documented policy/contract plus Vercel configuration, then effective header/browser verification. No production deployment during audit.
- **Tests/regression risk:** headers on HTML/assets/API/error pages; source/audio playback, microphone, push service worker, operator bundle. Risk: overly strict CSP breaks legitimate capture/playback.

## A-10 — All-language real-worker acceptance missing

- **Module/files:** `server/languages.mjs`; provider adapter language maps/evidence/admission; localized worker UI. 15 locale codes represent 14 languages with Punjabi scripts separate.
- **Expected:** every advertised required locale works through the applicable instruction/question/speech/answer/follow-up/presentation flows, with native review and explicit provider support.
- **Actual/evidence:** fixtures declare speech/transcription en/ar and typed assessment en/ar/ur; demo DeepL map covers 13 codes, not Sinhala/Shahmukhi. Those facts do not establish live provider capabilities. No current account capabilities or independent native-language acceptance were supplied.
- **Reproduce:** compare registry, runtime-family capabilities and current live admission; actual provider/language evaluation remains not executed.
- **Root cause:** selectable locale and synthetic fixture support are not equivalent to release-approved end-to-end support.
- **Impact:** cannot claim the user's required real-worker pilot scope ready. Do not solve by silently reducing supported languages.
- **Recommendation/dependencies:** T02 then T08; stage × locale matrix, current primary-provider capability query, approved fallback, native text/voice safety review and physical-device testing.
- **Tests/regression risk:** all 15 codes, RTL/scripts, names/numbers/negation/safety terms, captions/choice equivalence, text/voice/both, answer/follow-up/presentation, missing capability/outage. Risk: semantically wrong instruction despite valid JSON/script.

## A-11 — Improvement analysis disagrees with latest-response authority

- **Module/files:** `server/self-healing-input.mjs:4` (`improvementSampleFrom`), both self-healing repositories, persisted improvement evidence guards in migration 119 and SQLite schema.
- **Expected:** improvement analysis uses the same latest accepted response ordering as reports and worker status, including equal timestamps and typed/audio transitions.
- **Actual/evidence:** shared analysis query selects latest by `received_at`, breaking ties by random attempt ID. Disposable query fixture has an older `clarification` with lexically larger ID and newer `matched` with receipt sequence 2 at the same timestamp; improvement selects `clarification` while receipt-authoritative query selects `matched`.
- **Reproduce:** final `improvement_latest_receipt` case in `evidence/repro-local-invariants.mjs`. This reproduces the shared query discrepancy; a full HTTP signal/review journey with tied timestamps was not executed.
- **Root cause:** newer analytics reimplemented latest-answer selection without the established monotonic receipt contract. Schema evidence guards embed the same assumptions.
- **Impact:** incorrect current match/clarification counts, spurious or missed improvement suggestions and misleading before/after comparison. It does not demonstrate mutation of an earlier answer or automatic publication.
- **Recommendation/dependencies:** T11; define authoritative latest-receipt semantics including pending/failed audio, update both query consumers and compatible database guards additively; preserve frozen historical signals.
- **Tests/regression risk:** equal timestamps/reverse IDs, multiple repeats, pending/failed newest audio, pending assessment, deletion, original/follow-up cohort and guard consistency. Risk: changing analytics without its guard causes inserts to reject; do not rewrite old immutable signals.

## A-12 — Development/build dependency advisories

- **Module/files:** `package.json`, `package-lock.json`, `vite.config.ts`; retained all-dependency advisory JSON and installed dependency tree.
- **Expected:** release build and development tooling have reviewed dependency exposure; known advisories are remediated or specifically assessed and accepted.
- **Actual/evidence:** `npm audit --json` exits 1 and reports eight high-severity affected package entries. Installed Vite is 8.3.2; direct development dependencies Reticle React/Vite plugin are 3.6.0. Reticle/core/open-verification pull Zod 3.25.76. Production-only scan is clean; Neon uses Zod 4.6.7. The eight entries include transitive propagation, not eight independent demonstrated vulnerabilities.
- **Reproduce:** clean locked install then `npm audit --json` and `npm ls vite @reticlehq/react @reticlehq/vite-plugin zod --depth=6`. Advisory database can change after this captured run. No exploit was executed.
- **Applicability:** Reticle is enabled by the Vite configuration, whose dev host is loopback. Vite advisories have different preconditions; Windows editor handling and Zod untrusted-input paths need targeted review. The custom-middleware advisory does not establish exposure in this ordinary SPA configuration. Production-output injection and reachable vulnerable validation were not verified. See [Vite Windows editor advisory](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [custom middleware advisory](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), and [Zod resource-exhaustion advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- **Root cause:** locked development/build versions intersect published advisory ranges; dependency ownership crosses Reticle's transitive chain.
- **Impact/severity:** P1 remediation/triage priority for build workstation and release supply chain; no production compromise, arbitrary HTTP exploit or vulnerable path reachability was proved.
- **Recommendation/dependencies:** T12; review compatible upstream patches and instrumentation necessity. Avoid blanket forced upgrades or overriding Zod 3 with incompatible major 4. Preserve lockfile reproducibility.
- **Tests/regression risk:** fresh install, all/production advisory checks, build/typecheck and affected development instrumentation/UI checks; repeat required CI/regression gates. Risk: plugin/API incompatibility or altered generated build.

## Decisions and exclusions

D-01–D-06 in report 03 are separate product decisions, not counted as confirmed bugs. In particular unmanaged entitlements are a conditional policy risk; no arbitrary authentication bypass was demonstrated. Native infrastructure, load, mail/push, independent security/accessibility and recovery evidence are release gates, not fabricated defects. Reproduction scripts document observations and must be converted to assertion-based regression tests during approved implementation.
