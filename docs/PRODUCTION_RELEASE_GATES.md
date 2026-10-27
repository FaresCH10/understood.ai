# Production release gates

Created 25 October 2026 after the seven local implementation phases.

26 October code update: production Gemini integration and the separate guarded launcher are implemented; see PRODUCTION_GEMINI_INTEGRATION.md. The historical test counts/fingerprints below are not current release evidence. Production release gates and deployment authorization remain open. This is a release
control document, not a readiness percentage or a deployment authorization. The current
decision is **NO-GO** for production and real worker data. A customer launch requires a
reviewable release candidate and explicit final authorization.

Status values are limited to `pending`, `failed`, `passed-for-specified-scope` and
`awaiting-external-approval`. A passed status names the exact scope it covers; it does not
carry over to a different schema, source tree, host, provider or data class.

## Candidate identity

Evidence is bound to this working tree, not to a historical test count:

- Git branch and commit: `main` at `e8cd359775a2e9113aecd6db610f5088837e1147`.
- Dirty state at audit time: 340 entries (225 tracked modifications, 115 untracked files).
- Full working-tree fingerprint: SHA-256
  `10fdd10f9ff651815acf56c645420e3a1cfe39255f3f8459e6f2b86d49550e8e` over 2,004
  tracked and untracked non-ignored files (secrets and ignored files excluded).
- Lockfile SHA-256: `ded9dc09264b76a4983c7bcbeed79295a3b093a0868b428eb0fce3e06ac2a306`.
- Built output SHA-256: `fe6b02fc9da679e724903e39c4ca9325759ebcb852aae438cdf21d81926733a4`
  over 69 `dist` files; `dist/index.html` is
  `8b6c49d72b1449b3f7f4c2faf92efd9709035b6d8d519f96291ac6eb560a8259`.
- Migrations: 108 PostgreSQL migration files, latest `108_notification_events.sql`.
- Pre-existing saved services on ports 3020, 3021, 3031 and 3243 were not stopped or
  modified. `.env`, `.env.production.local` and `.env.neon-storage-test` were inspected for
  presence only and their values were not printed.

This fingerprint is not a frozen release candidate. The dirty tree must be reviewed,
committed or archived as an immutable snapshot before any acceptance run is treated as
release evidence. Documentation edits made during this audit, the production-admission
module/script/tests added afterwards, and any later hardening code change invalidate the
working-tree hash above; a fresh fingerprint is required before reusing any evidence.

The baseline hash above is retained as history and is no longer current. A new
working-tree fingerprint covering tracked plus untracked non-ignored files is recorded in
`artifacts/release-fingerprint-2026-10-25.json` with its method and exclusion rules. It
still does not constitute a source freeze: the tree remains dirty and no commit or
immutable archive has been approved as the release candidate.

Verification run on this tree: the standard full suite (1,489 tests) produced 1,484
passed, 0 failed, 4 skipped and 1 cancelled in 3,423,492.6709 ms
(`artifacts/production-admission-2026-10-25/full-suite-retry.log`; an earlier identical run
is in `full-suite.log`). The cancellation is `tests/restore-retention.test.mjs:297`: the
long embedded-PGlite privacy cleanup test was killed at 301,299.4742 ms by the unchanged
300,000 ms per-test timeout under parallel suite load. It is a timeout, not a failed
assertion. The same file passed 16/16 in isolation in 348,809.8558 ms, with the affected
test taking 78,180.1132 ms
(`artifacts/production-admission-2026-10-25/restore-retention-retest.log`). The suite is
therefore **not a clean pass**. No clean full-suite claim may be made until the candidate
is frozen and a complete run finishes without cancellation; the test load/timeout
interaction must be bounded first. Native PostgreSQL tests were run separately because the
suite had no native URL (G3-G5).

## Gate summary

| ID | Gate | Status | Current evidence boundary |
|---|---|---|---|
| G0 | Candidate identity and source freeze | pending | Baseline fingerprint captured but superseded by later work; no committed or frozen release candidate |
| G1 | Functional contract and requirement traceability | passed-for-specified-scope | `docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md` maps the contract to code/tests; no locally verifiable contract defect found; product-owner acceptance open |
| G2 | Worker/staff locales and content quality | awaiting-external-approval | 15 worker UI locales, source EN/AR, content translation EN/AR/UR, speech EN/AR; native-speaker/provider review absent |
| G3 | Schema, migrations and repository parity | passed-for-specified-scope | 108 migrations on embedded PGlite and on fresh native PostgreSQL 16.15; SQLite/PostgreSQL parity tests pass; production-major native run open |
| G4 | Native PostgreSQL roles, concurrency and TLS | pending | Native PG16.15 concurrency 2/2 and TLS verification pass; native runtime-role execution and production-version parity open |
| G5 | Native backup, restore, quarantine and privacy | passed-for-specified-scope | Native PG16.15 encrypted `pg_dump`/`pg_restore` round trip, isolated readback and quarantine pass; scope is local 16.15 only |
| G6 | Production runtime admission and secret separation | pending | Separate admission review implemented and negative-tested; Gemini production adapter and guarded startup implemented; actual service configuration, external verification and approvals absent |
| G7 | Approved provider and real-data privacy policy | awaiting-external-approval | Synthetic-only Gemini/OpenRouter paths; no approved real-data processor or policy |
| G8 | Email verification, invitation and recovery delivery | awaiting-external-approval | Adapter and synthetic tests exist; no verified domain, approved inboxes or real send |
| G9 | Web push and physical-device acceptance | awaiting-external-approval | Outbox/adapters and service-worker shell verified synthetically; no real push or device acceptance |
| G10 | Independent security review | awaiting-external-approval | Local authorization/secret/dependency tests exist; no independent qualified assessment |
| G11 | Accessibility and assistive-technology acceptance | awaiting-external-approval | Browser keyboard, focus, RTL and 320px checks passed for specific screens; NVDA/physical/AT review absent |
| G12 | Compute, domain, DNS and public TLS | awaiting-external-approval | No approved production compute host, DNS or public certificate; local Caddy validation only |
| G13 | Capacity, load and free-tier quota behavior | pending | The 1,489-test functional suite is not a load test; no measured peak/soak/quota-exhaustion run |
| G14 | Monitoring, alerting and incident drill | pending | Health surfaces and runbook material exist; no deployed alert observed or incident drill |
| G15 | Off-site encrypted backup and disaster recovery | awaiting-external-approval | Local encrypted backup tooling exists; no independent destination, key custody or drill |
| G16 | Staging end-to-end over HTTPS | awaiting-external-approval | No authorized deployed combined system with approved synthetic data |
| G17 | Trial, expiry, manual activation and commercial state | passed-for-specified-scope | Local synthetic tests cover 14-day/25-worker trial, read-only expiry and operator activation; hosted acceptance absent |
| G18 | Release decision and deployment authorization | awaiting-external-approval | Decision is NO-GO; no release candidate approval or rollout authorization |

## Gate detail

### G0 Candidate identity and source freeze

- Scope: exact source, lockfile, migrations, build and runtime configuration proposed for
  acceptance.
- Owner: engineering; release owner must approve the frozen candidate.
- Prerequisites: review and preserve the dirty work; choose a commit or immutable archive;
  rebuild from the frozen source; record artifact hashes.
- Acceptance: reproducible install/build, immutable source snapshot, exact asset and
  migration fingerprints.
- Actual evidence: baseline fingerprints above (superseded, retained as history); focused
  production-admission tests 6/6; native PostgreSQL 16.15 verification for fresh migration,
  concurrency, encrypted backup/restore and TLS certificate handling (see G3-G5). The
  working-tree fingerprint in `artifacts/release-fingerprint-2026-10-25.json` is not taken
  from a frozen candidate. The latest full suite is not clean: one long embedded-PGlite
  cleanup test timed out under suite concurrency and passes in isolation (see Candidate
  identity). `npm run typecheck` and `npm run build` pass on the current tree.
- Remaining action: freeze the candidate after engineering changes are complete, resolve or
  bound the suite timeout interaction, and rerun affected checks against the frozen
  snapshot.

### G1 Functional contract and requirement traceability

- Scope: every agreed product requirement from the implementation prompt, including staff
  signup, worker credentials, HR/supervisor scope, language choice and history, question
  and media modes, acknowledgment-only work, partial delivery, repeats, resolution, trial,
  read-only expiry, manual activation, notifications, privacy and restore.
- Owner: engineering with product-owner acceptance.
- Prerequisites: audited implementation, current tests and browser evidence per
  requirement.
- Acceptance: a current requirement-to-code-to-evidence matrix with no unexplained gaps;
  release-blocking defects fixed and retested.
- Actual evidence: `docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md` reconciles every contract area to
  implementation files, tests and browser evidence. The audit found no locally verifiable
  contract defect. It corrected stale language-readiness claims (cached presentation reads
  and partial-language delivery are implemented) and made two scope boundaries explicit:
  repeat/review workflows are PostgreSQL-only and hidden in the SQLite demo via
  `canRequestRepeat:false`/`canReview:false`; supervisor scope is whole-site, not per-crew.
- Remaining action: product-owner acceptance of the explicit scope boundaries, then bind the
  matrix to a frozen candidate and deployed evidence under G16/G18.

### G2 Worker/staff locales and content quality

- Scope: 15 worker UI locales for 14 languages (two Punjabi scripts), staff EN/AR (Reports
  also UR), instruction content EN/AR, translated content EN/AR/UR, speech/transcription
  EN/AR, and typed assessment EN/AR/UR.
- Owner: engineering plus independent native-language reviewers.
- Prerequisites: approved synthetic evaluation set, reviewer availability, provider
  privacy approval for live checks.
- Acceptance: UI and direction checks for every locale; content, transcription, speech and
  assessment evidence per locale; native review of meaning, numerals, dates, negation,
  safety wording and mixed-language audio.
- Actual evidence: every locale dictionary/direction test, worker Arabic RTL and English
  browser checks, `docs/LANGUAGE_READINESS.md`; these are UI coverage and synthetic
  contract evidence only.
- Remaining action: native-speaker review and approved live synthetic provider evaluation;
  keep unsupported stages explicitly unavailable.

### G3 Schema, migrations and repository parity

- Scope: fresh-schema migrations, supported upgrade path, SQLite/PostgreSQL behavior parity
  and immutable evidence guards.
- Owner: engineering.
- Prerequisites: current migration ledger and test fixtures.
- Acceptance: all migrations apply to a fresh native database, upgrade tests pass, and
  SQLite/PostgreSQL repository tests agree on scope, receipts and lifecycle behavior.
- Actual evidence: 108 migrations exercised under embedded PGlite and applied in one pass
  to a fresh native PostgreSQL 16.15 database (`artifacts/native-pg16-2026-10-25/migration-native.log`,
  1/1 pass); re-running the migration set returns no pending files in that test. SQLite/PostgreSQL
  parity and import tests pass in the full suite. Parity is scoped to implemented workflows:
  repeat-answer and case-review operations are PostgreSQL-only and the SQLite clarification
  detail reports `canRequestRepeat:false`/`canReview:false`, so the demo hides those controls
  instead of offering a dead action (`docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md`).
- Remaining action: repeat the fresh-schema and upgrade checks on the production PostgreSQL
  major/Neon target under G4/G16; 16.15 is not the production version.

### G4 Native PostgreSQL roles, concurrency and TLS

- Scope: native database startup, migration, runtime role permissions, negative access,
  concurrency, pooling, TLS and proxy transport.
- Owner: engineering; product/environment owner must authorize the production-major hosted
  target and its TLS/proxy contract.
- Prerequisites: isolated native database on the approved production major (18 or the
  selected Neon major) with native tools, disposable test database/schema, no saved demo or
  production data. The local 16.15 evidence satisfies discovery, not the production-major
  requirement.
- Acceptance: the four currently skipped native tests execute with real prerequisites;
  concurrent signup/trial, worker capacity, credential, Send/partial release,
  acknowledgment, repeat, resolution, push reassignment and deletion paths cannot
  oversubscribe or duplicate effects; invalid TLS and role escalation fail closed.
- Actual evidence: a disposable native PostgreSQL 16.15 cluster was started on
  `127.0.0.1:55479` from an existing read-only local runtime, with a temporary data
  directory, local-only trust authentication and no access to any existing cluster or saved
  environment. No Docker restart or repair was performed. Tests: fresh-schema migration
  passed 1/1 (`artifacts/native-pg16-2026-10-25/migration-native.log`); the two concurrency
  tests passed 2/2 (`.../concurrency.log`); TLS 1.3-style certificate verification was
  exercised with a local self-signed certificate for `localhost`/`127.0.0.1`, and an
  unrelated CA was rejected with `DEPTH_ZERO_SELF_SIGNED_CERT`
  (`.../tls-check.log`). The full suite still records four skips because that run set no
  native URL; the native tests were executed separately.
- Boundaries: 16.15 is not the production PostgreSQL version or the hosted Neon target.
  Runtime role-profile and negative role-escalation tests remain embedded-PGlite evidence;
  native role execution, pooled/direct endpoint behavior, public-CA TLS and hosted transport
  were not exercised.
- Remaining action: run the same tests and runtime-role checks on the approved production
  PostgreSQL major and hosted endpoint, with a production CA and proxy contract; then close
  this gate for that exact scope.

### G5 Native backup, restore, quarantine and privacy

- Scope: current relational and private-object backup, isolated restore, quarantine,
  deletion/retention reconciliation and non-revival of credentials, sessions, push
  bindings and queued deliveries.
- Owner: engineering with privacy/operator review.
- Prerequisites: production-major G4 environment, distinct source and empty restore
  targets, native `pg_dump`/`pg_restore`, private object store and separate encryption keys.
- Acceptance: full inventory and integrity, private playback, quarantine, post-backup
  privacy replay, no token/session/push revival and measured restore time.
- Actual evidence: embedded PGlite quarantine and restore tests pass, including push
  revocation and delivery cancellation. The native encrypted round trip now also passes on
  a disposable PostgreSQL 16.15 source and empty restore database using native
  `pg_dump`/`pg_restore`: full relational inventory, encrypted archive, isolated private
  object readback, quarantine and immutable-publication rejection
  (`artifacts/native-pg16-2026-10-25/backup-native.log`, 1/1 pass, 88.3 seconds including
  fixture and cleanup; that duration is not a production RTO measurement).
- Boundaries: local 16.15 only; no off-site destination, separate key custodian, production
  major, hosted restore or measured RPO/RTO. Those remain G15 and G16.
- Remaining action: repeat on the production PostgreSQL major and approved encryption/key
  custody under G15; retain the current 16.15 result as scoped local evidence only.

### G6 Production runtime admission and secret separation

- Scope: explicit production tier admission, approved data class, credential access,
  HTTPS/trusted proxy, private storage, verified database roles, provider policy, mail and
  secret separation.
- Owner: engineering; external provider/privacy approvals are required before enabling.
- Prerequisites: approved production configuration and secrets, verified schema and roles,
  approved provider/data policy, secure transport and storage.
- Acceptance: production startup rejects demo identities, synthetic adapters, unapproved
  free-tier dispatch, missing TLS/proxy/storage/role prerequisites and mixed service
  secrets; valid production configuration can only be enabled with the approved values.
- Actual evidence: `server/postgres/hosted-config.mjs` admits explicit `staging` synthetic
  configuration only; `server/auth.mjs` rejects production; `pipelineStatus` reports
  `realDataAllowed:false` and `productionReady:false`. Synthetic staging tests pass.
  A separate `server/postgres/production-admission.mjs` now validates a production-only
  configuration and an `understood-production-approval-v1` manifest bound to the candidate
  SHA-256, all G0-G18 statuses, seven named approvals and a bounded customer/language/
  capacity/data-class scope. `scripts/production-admission-check.mjs` reports blocker codes
  and exits 1 without starting a listener or connecting to an external service.
  `tests/production-admission.test.mjs` passes 6/6, covering staging/demo identities,
  synthetic evaluators, mocked speech, fixture mailboxes, wildcard/broad proxy networks,
  unregistered/free-tier adapters, missing fallback declarations and operator secret
  separation. `LIVE_PROVIDER_ADAPTERS` is deliberately empty, so API and worker admission
  cannot pass even with a complete manifest; there is no production startup wiring.
- Remaining action: obtain the external approvals, implement and register live provider
  adapters with provider/privacy evidence, then wire production startup in a separately
  reviewed change. Do not weaken or delete the staging guard.

Production admission contract, implemented but not approved:

- Runtime identity must be `production`/`live`/`credential`/`real`; legacy mode, demo
  identities, fixture hosts, pilot redirects, test URLs, synthetic hash allowlists and
  provider-test mode are blockers.
- Exact HTTPS public origin; a separate operator origin; exact proxy addresses only
  (`/32` or `/128`), with trusted-proxy Host/Proto/For checks.
- Certificate-verified PostgreSQL TLS plus an absolute CA file, a production-only
  `understood_prod_*` schema and the service's matching database role profile.
- Private storage with health checks, a verified-domain Resend mailbox, webpush VAPID keys
  with a non-fixture subject, and no customer secrets in the operator service.
- All six provider stages explicitly named. `LIVE_PROVIDER_ADAPTERS` is empty, so named
  adapters remain blocked until a reviewed implementation registers them. Synthetic, mock,
  fixture, local and free-tier names are rejected; `UNDERSTOOD_PROVIDER_FALLBACK=disabled`
  and an explicit free-tier dispatch decision are required.
- An `understood-production-approval-v1` manifest must match the candidate SHA-256, mark
  G0-G18 `passed-for-specified-scope` with evidence, name product/engineering/security/
  privacy/accessibility/operations/provider approvals, and bound the customer, worker
  languages, worker capacity and real-data scope to a validity window.
- `node --env-file=<approved-env-file> scripts/production-admission-check.mjs` prints the
  blocker codes and exits 1 unless every check passes. It never starts a listener, opens a
  database connection, calls a provider or prints secret values. Admission is configuration
  review only: G18 deployment authorization and production startup wiring remain separate,
  and staging/synthetic startup still uses the unchanged `hostedSyntheticConfig` path.

### G7 Approved provider and real-data privacy policy

- Scope: transcription, preparation/translation, speech, typed/recorded assessment,
  clarification follow-up, and the data-processing terms for each.
- Owner: product owner plus privacy review.
- Prerequisites: selected provider, approved data class and region, retention/training
  terms, real-data authorization, budgets and cost controls.
- Acceptance: no real worker content reaches an unapproved provider; provider evidence is
  separated from synthetic fixtures; fallback is explicit and fail-closed.
- Actual evidence: only synthetic adapters and allowlists; the Gemini free tier is
  synthetic-only; no live provider call is authorized.
- Remaining action: select and approve a real-data processor or keep real-data operation
  blocked; complete language/provider evaluations after approval.

### G8 Email verification, invitation and recovery delivery

- Scope: staff verification, invitations, recovery, expiry, reuse denial, retry and
  source-of-truth receipts.
- Owner: product owner; provider account and domain owner.
- Prerequisites: verified sending domain, approved provider, server-only key, controlled
  inboxes and explicit delivery authorization.
- Acceptance: real controlled-inbox tests cover delivery, bounce/failure, retry, expiry,
  reuse denial and disabled accounts; no customer contact without approval.
- Actual evidence: adapter and synthetic tests pass; no real email sent and no verified
  domain recorded.
- Remaining action: provide a verified domain and controlled inboxes, then run approved
  tests.

### G9 Web push and physical-device acceptance

- Scope: Android, iPhone and desktop browser/PWA push with production-like HTTPS, service
  worker, permissions, background/closed app, click-through and shared-device isolation.
- Owner: product owner supplies consenting devices/accounts; engineering runs the checks.
- Prerequisites: approved HTTPS staging origin, VAPID configuration, consenting devices,
  test workers and staff.
- Acceptance: visible generic notification and authenticated click-through on real
  devices; permission denial/unsupported fallback; endpoint expiry/reassignment, logout,
  worker deletion and revoked-session behavior; no cross-worker leakage.
- Actual evidence: synthetic adapter, service-worker shell activation and in-app inbox
  browser checks; no external push or physical-device acceptance.
- Remaining action: provide devices and authorize staging push delivery; keep the in-app
  inbox as the fallback.

### G10 Independent security review

- Scope: authorization/IDOR, tenant/site/team boundaries, worker credentials, resets,
  push bindings, private audio, exports, operator separation, CSRF/origin/context fences,
  injection/XSS/CSV safety, upload and SSRF controls, secret handling and logging.
- Owner: independent reviewer; engineering remediates.
- Prerequisites: frozen candidate, authorized isolated target, rules of engagement.
- Acceptance: qualified independent assessment and retest of material findings; local
  self-review and scans are supporting evidence only.
- Actual evidence: local authorization, secret-scanning and dependency checks are present;
  no independent assessment is commissioned.
- Remaining action: commission the review after the candidate and staging target exist.

### G11 Accessibility and assistive-technology acceptance

- Scope: staff Arabic, all worker locale/script paths, 320px/reflow/zoom, mixed direction,
  keyboard/focus, screen readers, contrast, reduced motion, touch, dialogs, soft keyboard,
  microphone denial/interruption, playback, offline work and shared-device handoff.
- Owner: engineering plus independent accessibility/native-language reviewers and device
  owners.
- Prerequisites: frozen candidate, NVDA, physical devices and reviewer availability.
- Acceptance: observed AT and physical-device sessions, not only emulation; material issues
  remediated and retested.
- Actual evidence: Phase 7 exact-320px and 1440px browser checks, keyboard Enter/focus
  outlines and reduced-motion emulation for selected screens; no AT or physical-device
  acceptance.
- Remaining action: run NVDA and device acceptance on the frozen candidate; re-drive staff
  Arabic and all locale/script paths.

### G12 Compute, domain, DNS and public TLS

- Scope: approved compute host/region, DNS ownership, public HTTPS certificate issuance and
  renewal, trusted proxy contract and network isolation.
- Owner: product owner/provisioning; engineering verifies.
- Prerequisites: compute decision and budget, DNS control, host access and deployment
  authorization.
- Acceptance: public certificate issuance/renewal, correct proxy headers and client-address
  attribution, no direct backend exposure; free-tier limits documented.
- Actual evidence: Caddy configuration and local TLS validation; no public DNS, host or
  certificate.
- Remaining action: select/approve a host and domain, then provision only after explicit
  authorization.

### G13 Capacity, load and free-tier quota behavior

- Scope: expected customer/worker counts, 25-worker trials, audio sizes, simultaneous
  sends/responses, translated-history generation, queue backlog, database connection
  limits and browser responsiveness.
- Owner: engineering with product-owner targets.
- Prerequisites: agreed service objectives and a representative synthetic workload.
- Acceptance: baseline/peak/recovery measurements, stop conditions, quota exhaustion and
  safe admission pause without duplicate or lost accepted work.
- Actual evidence: none beyond functional tests; no load or quota-exhaustion run.
- Remaining action: define targets and run an isolated synthetic load test.

### G14 Monitoring, alerting and incident drill

- Scope: API/worker heartbeats, queue age/stuck work, provider and push/mail failures,
  storage/database capacity, trial/activation expiry and backup freshness.
- Owner: engineering and operator.
- Prerequisites: deployed health endpoints, external heartbeat service and an authorized
  operator channel.
- Acceptance: at least one safe alert reaches the authorized operator and one incident or
  recovery drill is observed; logs exclude worker content and secrets.
- Actual evidence: health/readiness surfaces and runbook material; no deployed alert or
  drill.
- Remaining action: configure a monitoring candidate after a host exists; run a drill.

### G15 Off-site encrypted backup and disaster recovery

- Scope: automated encrypted relational and private-object backups, separate key custody,
  retention, restore reconciliation and measured RPO/RTO.
- Owner: product owner for destination/key custody; engineering for automation and drills.
- Prerequisites: approved independent destination, encryption keys kept separately from
  storage credentials, isolated restore target.
- Acceptance: scheduled backup, restore drill, integrity/inventory/playback verification
  and recorded restore time/loss window.
- Actual evidence: local encrypted backup/restore scripts and embedded tests; native
  current-schema round trip and off-site destination remain open.
- Remaining action: establish destination and key custody, then run and observe a drill.

### G16 Staging end-to-end over HTTPS

- Scope: the combined deployed system with approved synthetic data, real database roles,
  private storage, worker, operator, email and push.
- Owner: product owner authorizes; engineering executes.
- Prerequisites: G4/G5 native evidence, approved staging host/domain, secrets supplied
  privately, device/inbox access and a cleanup/rollback plan.
- Acceptance: complete owner/HR/supervisor/worker journey over HTTPS, including expiry,
  activation, notification click, read-only behavior and restore; logs and exits retained.
- Actual evidence: local loopback browser fixtures only.
- Remaining action: prepare the staging plan and request the specific missing approvals.

### G17 Trial, expiry, manual activation and commercial state

- Scope: verified owner registration, 14-day/25-worker trial, no-card state, read-only
  expiry, manual activation request and operator activation without a payment gateway.
- Owner: engineering; product owner approves commercial behavior.
- Prerequisites: hosted database and operator origin for deployed acceptance.
- Acceptance: local and deployed flows produce exactly one trial/activation effect,
  preserve evidence and deny bypass attempts.
- Actual evidence: local SQLite/PostgreSQL entitlement, registration, activation and
  read-only tests pass; the operator activation UI and column profile are locally tested.
- Remaining action: verify the same flow in an authorized hosted staging environment.

### G18 Release decision and deployment authorization

- Scope: final go/no-go against an exact frozen candidate and explicitly approved
  customer/language/capacity scope.
- Owner: product owner/release owner; engineering supplies evidence.
- Prerequisites: all release-critical gates passed for the approved scope, or an explicit
  narrower scope approved by the product owner.
- Acceptance: concrete release candidate, deployment/rollback/monitoring/backup plan,
  authorized accounts and final written authorization.
- Actual evidence: current decision is **NO-GO**; no release candidate is frozen and no
  deployment is authorized.
- Remaining action: close or explicitly scope the blockers above, then request final
  authorization.

## Service decision register

These are candidates, not account approvals or production selections. Recheck current
official terms, regional/commercial eligibility and data-processing terms before use.

| Service | Decision state | Known allowance/limit | Credentials/config | Observed evidence |
|---|---|---|---|---|
| Neon Free PostgreSQL and Object Storage | Selected database/storage adapter; production purchase/provisioning not authorized | 1 GB database, 100 CU-hours/month, 5 GB object storage per current published terms | Isolated synthetic test resources exist outside the repo; values not read or printed | Adapter tests and an isolated storage smoke test passed; deployed combined system not verified |
| Oracle Cloud Always Free VM | Candidate compute; not selected or provisioned | Region capacity, card verification and reclamation limits apply | None supplied | No host, DNS or public endpoint |
| DuckDNS subdomain | Candidate staging name; not configured | Free subdomain, not an owned domain | None supplied | None |
| Caddy and Let's Encrypt | Selected TLS/proxy approach | Certificates no purchase fee; DNS/reachability required | Local configuration only | Local internal-CA validation; no public issuance/renewal |
| Resend Free | Candidate email provider through the existing adapter | 100 emails/day currently published; verified domain required | No verified domain or key recorded | Synthetic adapter tests only |
| Existing Web Push/VAPID | Selected push protocol | No notification dashboard fee; server/device prerequisites apply | No production VAPID configuration recorded | Synthetic adapter, inbox and service-worker shell |
| Gemini free tier | Synthetic AI evaluation only | Free-tier content may be used to improve Google products; no real worker data | Existing synthetic configuration; value not printed | Mock/synthetic tests only; no live provider call |
| OpenRouter free | Synthetic text adapter alternative | Free-model limits and data terms apply | Existing synthetic configuration; value not printed | Synthetic tests only |
| Ollama local models | Candidate self-hosted inference; not selected | Hardware, power, licensing and quality evaluation required | None installed | None |
| Azure Speech F0 | Candidate speech service; not selected/approved | Published real-time/TTS quotas; locale coverage limited | None supplied | None |
| Backblaze B2 free | Candidate off-site backup; not configured | 10 GB storage allowance; transfer terms apply | None supplied | None |
| Healthchecks.io Free | Candidate heartbeat monitoring; not configured | 20 monitors and limited history | None supplied | None |
| ZAP and local scans | Supporting security tooling | Free; not a substitute for independent review | Local only | Dependency/secret/authorization tests exist |
| NVDA and owned/borrowed devices | Candidate accessibility/device acceptance | Requires physical sessions and consent | None supplied | Browser emulation only |

## Current NO-GO blockers

1. Native PostgreSQL 16.15 migration, concurrency, TLS-certificate and encrypted
   backup/restore checks pass locally, but the production PostgreSQL major/Neon endpoint,
   native runtime-role execution and hosted TLS/proxy behavior are not verified. The failed
   Docker 18 attempt was not restarted or repaired.
2. No approved real-data provider/privacy policy; only synthetic AI adapters are available.
3. No verified email domain, real inbox tests or real push/device acceptance.
4. No independent security or accessibility review.
5. No approved compute host, DNS, public TLS or staging environment.
6. No measured capacity/quota behavior, deployed monitoring or observed incident drill.
7. No off-site encrypted backup destination and observed restore drill.
8. The source tree is dirty and has not been frozen as a release candidate.
9. No deployment authorization.

## Next actions within current authorization

- Completed locally: the functional requirement matrix is reconciled; the separate
  production admission path is implemented and negative-tested while production remains
  unavailable; native PostgreSQL 16.15 migration, concurrency, TLS-certificate and encrypted
  backup/restore checks pass on a disposable local cluster.
- Run remaining local dependency/secret/authorization/accessibility checks that do not need
  external accounts.
- Prepare the production-major/Neon and staging plans so the next approval request is
  concrete.
- Request only the missing environment action or credentials for the next dependent step:
  an approved production-major PostgreSQL/Neon target with runtime roles and TLS, then an
  authorized staging host/domain for G16. A Docker restart/repair is no longer the blocking
  item for local evidence.
