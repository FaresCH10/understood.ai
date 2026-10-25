# Understood — production hardening, verification, and controlled release prompt

Use this after the seven local implementation phases. This is an instruction for future release work, not a statement that Understood is production-ready.

## Objective

Take the existing locally implemented Understood application through evidence-based production hardening and release verification. Preserve the agreed functionality and simplified experience. Complete all authorized engineering work, resolve failures, and produce a concrete go/no-go release assessment. Do not repeat the redesign or claim readiness merely because local tests pass.

Production readiness means the exact proposed release has passed its required functional, security, privacy, infrastructure, provider, restoration, and device gates for an explicitly defined customer/language/capacity scope. Customer launch requires a separate final authorization against a reviewable release candidate.

## 0. Free-first services and credentials requested when needed

The user wants the free options below incorporated into execution and wants to be asked when credentials or account access are needed. Start with existing compatible project integrations; do not migrate to a new vendor simply because it has a free tier. These are preferred candidates, not proof of account approval, regional eligibility, adequate capacity, privacy approval, or production readiness.

### Cost and account boundaries

- Use genuinely no-cost allowances wherever feasible. Recheck current official terms, quota enforcement, commercial use, Lebanon merchant/account eligibility, available regions, and data-processing terms before choosing or enabling a service. The allowances below were researched on 25 October 2026 and may change.
- Keep paid upgrades, overages, automatic top-ups, paid instances, and card charges disabled. Do not rely on temporary promotional credits as a permanent free service. Do not spread work across multiple accounts to evade a provider's limits.
- Do not create/connect external accounts, provision public resources, submit a payment card, install system-wide software, restart shared Docker/services, upload private backups, or send external email/push/provider requests without the applicable existing authorization. Prepare the concrete configuration and validation plan first, then request the specific missing approval once. Routine reversible code, documentation, and isolated local work should continue.
- If the free option cannot meet an actual release requirement, report the exact gap and offer a reviewable choice: remain blocked, explicitly approve narrower release scope, provide existing hardware/resources, or approve a costed alternative. Never quietly enable billing, weaken security/privacy, remove a requested language, substitute synthetic behavior, or label a limited demo production-ready.

### Preferred free candidates

| Requirement | Preferred candidate | Constraints and execution direction |
|---|---|---|
| API, worker, and optional operator compute | Oracle Cloud Always Free VM | Subject to region capacity, account approval, card verification, and idle-instance reclamation. Keep services/identities isolated on the VM. The user previously had concerns about verification holds; ask before account/card/provisioning actions. Do not claim a free VM is an SLA-backed host. If unavailable, use an existing computer for local verification while keeping dependable customer hosting an open gate. |
| Website address | DuckDNS free subdomain | Useful for controlled pilot/staging when acceptable to the user. Requires a reachable host and a tested customer/operator origin arrangement. It is not an owned custom domain and does not automatically satisfy transactional-email domain verification. |
| HTTPS | Existing Caddy integration with Let's Encrypt | Certificates have no purchase fee. Verify DNS/control, network reachability, issuance and automated renewal, and preserve the exact trusted-proxy contract. Local internal-CA evidence is not public certificate acceptance. |
| Hosted relational database | Neon Free | Current pricing lists 1 GB database storage and 100 CU-hours/month per project, with scale-to-zero and transfer limits. Retain the current PostgreSQL adapter. Measure worker polling, connection pooling, and cold starts; do not assume the database can remain continuously active within the allowance. |
| Private instruction/answer audio and artifacts | Neon Object Storage free allowance | Current pricing lists 5 GB. Retain the existing private S3-compatible adapter. Verify scoped access, region, readback/integrity, retention/history behavior, transfer allowance, and deletion limitations. Never make the bucket public. |
| Native migration/concurrency tests | Local PostgreSQL with disposable isolated databases and native tools | No new hosted subscription is needed for local native tests. Diagnose the existing Docker issue safely or use another authorized local PostgreSQL installation. Hosted TLS/network/pooling verification remains a separate gate. |
| Staff verification, invitation, and recovery email | Resend Free through the existing adapter | Current free tier has a 100-email daily limit; recheck its monthly allowance and disable paid overages. Real sending requires a domain the user owns and can verify. If none is available, explicitly identify that prerequisite; free DuckDNS does not solve it. Keep controlled inbox testing and delivery approval separate. |
| Browser/phone push | Existing Web Push/VAPID implementation | Prefer the already implemented protocol/outbox. No paid notification dashboard is required; server resources still have costs/quotas. Generate isolated test keys locally when appropriate, protect private keys, and request authorization before real delivery. Firebase Cloud Messaging is a no-cost alternative only if a concrete compatibility need justifies integration; do not replace working Web Push automatically. |
| Independent backup destination | Backblaze B2 free storage allowance | Current published offer includes the first 10 GB of storage. Verify request/transfer charges, eligibility, private access, retention and restore requirements; no automatic paid overage. Use encrypted backups and separate key custody. If unavailable, a separate existing machine/disk can support local restoration practice but is not automatically sufficient off-site disaster recovery. |
| Worker and backup heartbeat alerts | Healthchecks.io Free | Current plan monitors 20 jobs with limited log history. Use for missed scheduled work/heartbeats; do not claim this alone monitors end-user uptime, private-object integrity, or the entire application. Protect ping URLs and avoid sensitive payloads. |
| Synthetic AI development/evaluation | Gemini API free tier, retaining current synthetic-only gates | Google's pricing identifies unpaid-tier content as used to improve its products. Never route real worker data through this option under the current project policy. Rate limits and language capability still apply. |
| Self-hosted text preparation/translation/question/assessment candidate | Ollama with an explicitly chosen, suitably licensed local model | No hosted inference API fee, but requires sufficient existing hardware, power, secure operation, model licensing, new adapter work, and independent quality/capacity evaluation. Ollama alone is not the model and does not establish support for all languages. Do not install/download large runtimes or models system-wide without the needed authorization. |
| Speech/transcription candidate within free quotas | Azure Speech F0 | Current published allowances include 5 hours/month real-time speech-to-text and 500,000 neural TTS characters/month. This is a candidate, not a selected/approved production data processor. Verify account requirements, supported locales/scripts, privacy/region, real-time versus uploaded-audio integration, and hard quota behavior before implementation. Do not claim all 14 languages or unlimited voice are covered. |
| Security checks | ZAP plus existing dependency/secret/authentication tests | Free tools assist local authorized testing. They do not replace an independent qualified review or prove the absence of vulnerabilities. Restrict active scanning to authorized isolated targets. |
| Accessibility checks | NVDA on existing Windows hardware, keyboard/browser accessibility checks, and owned/borrowed devices | NVDA is free; physical-device and assistive-technology acceptance still require actual sessions. Browser emulation is not physical-device proof. |
| Test inboxes, human reviews, and device access | Existing/volunteered resources with consent | Use dedicated controlled inboxes and existing Android/iPhone devices. Competent volunteer security/accessibility/native-language reviewers may reduce expense, but availability and independent review are not guaranteed free. Synthetic samples only unless real-data sharing is approved. |

No verified completely free, privacy-approved, adequately provisioned end-to-end AI stack for all required languages has been established. Treat that as a real selection/evaluation gate rather than claiming the table resolves it. Keep a service decision matrix identifying selected versus candidate, costs/quota, privacy and region, integration readiness, credentials supplied, and observed tests.

### Ask for credentials at the point of need

1. Inspect existing configuration contracts and whether required values are present using redacted/presence-only checks. Do not print or copy existing secret values into chat, logs, source, generated evidence, or documentation. Existing presence does not itself authorize a new external action.
2. Complete configuration templates, adapters, tests, and safe local validation before requesting access needed only for a later stage. Do not ask for every vendor credential upfront. Group the fields needed for the next concrete verification step into one concise request.
3. Explain the service, purpose, target environment, exact setting names, required permission scope, and expected quota/cost. Give the user a protected entry location: hosting secret settings, a secrets manager, or a narrowly scoped gitignored local environment file with appropriate filesystem permissions. Do not ask them to paste secrets into the conversation.
4. Prepare blank templates or adapt existing documented templates without overwriting configured environment files. Ensure new secret files are actually ignored. Use separate local/staging/production keys and distinct API/worker/operator/maintenance identities; least privilege remains mandatory even on free tiers.
5. Request service-specific access only when needed: approved compute/SSH access; DuckDNS token if chosen; Neon database URLs and TLS details; private storage endpoint/bucket/access credentials; Resend key plus verified domain/from address; private VAPID configuration if not generated locally; B2 application key/bucket; protected heartbeat URL; approved AI/speech endpoint/keys and explicit data/cost permission. Do not ask for Firebase credentials if the existing Web Push implementation is retained, or for any unselected vendor.
6. Keep backup encryption keys separate from backup storage credentials. Record ownership/recovery procedures without recording the key. Protect OAuth/service sessions and signed endpoint URLs as secrets too.
7. Ask the user to confirm when protected configuration is populated. Validate it with redacted results and only the authorized bounded connection/test. If invalid, explain the affected service and correction needed without echoing credentials or secret-containing errors.
8. Wait for genuinely required access/authorization before that dependent external step; continue independent local work. Never invent a key, bypass verification, disable TLS/ACLs, turn on a paid plan, or fake success to proceed.

Example request format:

> The next check needs the selected database's isolated staging connection and TLS configuration. I have prepared the blank configuration template and validation command. Please populate the listed settings in the protected environment file or hosting secrets and tell me when ready; do not paste the connection URL here. The check uses only the named test target and does not migrate the saved demo or production database.

The same pattern applies to other chosen services. Generating local VAPID keys or fixtures does not authorize external push, and providing an AI key does not approve real worker data or paid dispatch. Request approvals only for the concrete scope not already authorized, and preserve the final production launch boundary in section 9.

### Official references for rechecking free allowances

- [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) and [Always Free restrictions](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [DuckDNS](https://www.duckdns.org/why.jsp) and [Let's Encrypt](https://letsencrypt.org/)
- [Neon pricing](https://neon.com/pricing)
- [Resend pricing](https://resend.com/pricing) and [verified-domain requirements](https://resend.com/docs/dashboard/domains/introduction)
- [Firebase Cloud Messaging pricing, if an alternative is actually needed](https://firebase.google.com/pricing)
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing) and [Healthchecks.io pricing](https://healthchecks.io/pricing/)
- [Gemini pricing/data-use distinction](https://ai.google.dev/gemini-api/docs/pricing), [Ollama](https://github.com/ollama/ollama), and [Azure Speech pricing](https://azure.microsoft.com/en-gb/pricing/details/speech/)
- [ZAP](https://www.zaproxy.org/) and [NVDA](https://www.nvaccess.org/download/)

## 1. Establish the actual baseline

Read applicable repository instructions, BUILD_STATUS.md, docs/READINESS.md, docs/UNDERSTOOD_IMPLEMENTATION_PROMPT_2026-10-23.md, and current runtime/configuration/tests. Inspect Git state, migration ledger, service processes, environment contracts, and actual files. Preserve dirty work, saved demo data, pre-existing servers, secrets, and unrelated resources.

Reported Phase 7 baseline, to verify rather than blindly repeat:

- npm test: 1,483 tests; 1,479 passed; zero failures; four native skips; approximately 45 minutes 38 seconds.
- The available log is artifacts/phase7/full-suite-2026-10-25-summary.log, an excerpt, not a captured complete run.
- Typecheck and build pass with existing large-chunk and ineffective-dynamic-import warnings.
- Native migration/concurrency and native backup/restore remain unexecuted for the current schema.
- No real external push, physical-device notification acceptance, production deployment, real-data AI approval, or independent security/accessibility acceptance is established.

Inspect rather than assume the current migration count, dependency versions, test filenames, and prerequisites. Bind evidence to an exact commit plus dirty-source fingerprint or a frozen release snapshot, lockfile, migrations, and built assets. Historical tests against an older schema do not satisfy current release acceptance.

Create docs/PRODUCTION_RELEASE_GATES.md with each gate's scope, owner, prerequisites, acceptance criteria, status, actual evidence, and remaining action. Use pending, failed, passed-for-specified-scope, or awaiting-external-approval; no invented percentages.

## 2. Reconcile functional completeness with the agreed contract

Audit actual behavior, not just the Phase 7 completion label. Prioritize differences that affect the promised production experience.

Confirmed current-source concerns:

- server/postgres/hosted-config.mjs explicitly admits synthetic staging, not production real-data operation.
- server/ai/pipeline-status.mjs projects synthetic-only provider contracts and realDataAllowed:false.
- server/languages.mjs registers 15 worker UI locales representing 14 languages with two Punjabi scripts. It currently declares translation/assessment only for English, Arabic, Urdu and speech/transcription only for English, Arabic. A localized dropdown is not end-to-end language support.
- docs/LANGUAGE_READINESS.md also records open language/presentation acceptance items. Verify whether each is still a code gap or stale documentation and fix the applicable gap.

Build a requirement-to-implementation-to-evidence matrix covering verified staff signup; worker ID/password setup/reset; team-scoped HR/supervisor permissions; first language choice and supervised changes; history translations; English/Arabic source; question toggle; Text/Voice/Both; text-default answers; acknowledgment-only mode; partial delivery; repeat answers; case resolution; 14-day no-card trial; 25-worker capacity; no fixed trial instruction allowance; read-only expiry; manual activation; notifications; privacy; restore.

Fix release-blocking defects. Preserve original answers, recordings, published snapshots, assignment/audience provenance, assessed-versus-acknowledged distinctions, and immutable receipts. Verify translated historical views do not rewrite evidence, reset completed work, bypass read-only policies, or inflate reports.

Deliver ready recipients once while showing failures for unreleased recipients. No duplicate assignment, case, acknowledgment, push, or billable dispatch on retry. Do not silently reduce the agreed language/product scope to make the release pass. If full scope is externally blocked, present a clearly limited pilot alternative for explicit user approval; otherwise the full-scope decision remains no-go.

## 3. Close current native PostgreSQL and restoration gaps

Inspect the stalled disposable Docker resource and diagnose safely. Do not restart Docker, kill pre-existing services, or delete resources belonging to other work without specific authorization if it would disrupt them. Continue independent engineering while an environment problem is unresolved.

Use an explicitly isolated native PostgreSQL test environment compatible with current permission requirements, never the saved demo or production database. Run the four previously skipped tests with their real prerequisites. The current concurrency harness requires an explicitly local test database; do not point it at a hosted database by bypassing that safety check. Add a separately scoped hosted rehearsal where needed.

Current native backup test requires distinct source and empty restore targets, native pg_dump/pg_restore, and explicit isolation configuration. Read the actual tests before setting nonsecret configuration; keep connection URLs in protected environment/secrets storage, not chat or logs.

Prove:

- All current migrations apply to a fresh database and upgrade the supported prior schema safely.
- API, worker, operator, maintenance, and backup identities have their exact required permissions and negative-access tests. Runtime identities do not own schema or gain broad privilege to pass startup.
- Valid TLS succeeds and invalid certificates/unsafe transport fail closed. Deployment proxy headers and client-address attribution are verified against the actual host contract.
- Concurrent signup/trial activation, 25-worker creation/import/reactivation, credential setup/reset, language approval/correction, Send/partial release, acknowledgment, response replay, repeat acceptance, resolution, push endpoint reassignment, and deletion cannot oversubscribe or duplicate effects. Existing older concurrency tests may not cover these new workflows; extend meaningful native coverage.
- API/worker restart, stale leases, lost commit acknowledgements, pooling/reconnection, and provider-uncertain states retain correct recovery semantics.
- Native backup includes the full current relational model and required private-object families. Restore into an isolated target, verify inventory/integrity/private playback, then exercise quarantine and post-backup privacy reconciliation.
- Restored sessions, setup/reset/verification secrets, push bindings, queued deliveries, and notification endpoints cannot silently reactivate. Trial/paid timestamps do not renew through restore.

Retain full logs and actual exits for these runs. Native tests still skipped because prerequisites are absent remain an open gate, not a pass. Remove only verified task-owned disposable resources after preserving needed evidence.

## 4. Implement an actual secure production runtime path

The current staging guard must not simply be removed. Audit which auth, mail, provider, data-class, storage, worker, budget, and startup contracts are synthetic-only. Implement a separate explicitly validated production configuration path and tests where missing.

Production admission must require the necessary approved provider/data policy, credential mode, secure cookies and HTTPS, trusted proxy contract, private storage, verified schema and database grants, bounded runtime settings, separate operator boundary, and correctly configured secrets. Missing/unsafe prerequisites reject startup or affected admission with an actionable operator error.

Preserve clearly isolated local synthetic and staging modes. Production must reject demo identities, canonical synthetic answer evaluators, mocked speech, fixture mailboxes, wildcard real-input allowlists, unapproved free-tier dispatch, and silent provider fallback. A constant changed from productionReady:false to true is not a release mechanism or proof.

Design production provider authorization for actual approved input and tenant purpose; do not treat synthetic input fingerprints as consent or hash real worker content into a synthetic allowlist to bypass restrictions. Retain per-stage authority, source/version binding, provenance, conservative budgets, retries, leases, and cost controls.

Use negative tests to prove production cannot accidentally inherit synthetic adapters or wrong credentials. Prepare an exact environment/secrets inventory without printing secret values. Test credential/key rotation and previous-key/session invalidation where applicable.

Keep the production path unavailable until its actual external approvals/configuration exist. Engineering can implement and test admission locally without enabling customer traffic.

## 5. Approve and verify real providers and language quality

Identify candidate transcription, preparation/translation, speech, assessment, email, push, and storage services. Check current official capabilities, business eligibility, processing regions, retention/training terms, deletion/history semantics, limits, costs, and relevant agreements. Do not assume earlier model IDs, prices, or country availability remain valid.

Prepare a decision brief identifying the required account/configuration and exact remaining approval. The user's Lebanese business location and intended Gulf customers matter to service eligibility, support, and data arrangements. Do not make a blanket legal-compliance claim or invent legal advice. Real worker-data processing and paid requests require explicit applicable authorization.

Build a language matrix for English, Arabic, Hindi, Urdu, Bengali, Malayalam, Tamil, Telugu, Nepali, Filipino, Sinhala, Russian, Punjabi Gurmukhi/Shahmukhi, and Indonesian. For each locale show separate evidence for UI, translation, question fidelity, input transcription, instruction/question/follow-up speech, typed assessment, recorded assessment, and historical presentations.

Evaluate numerals, dates, locations, negation, safety-sensitive wording, accents, noise, mixed-language speech, unfamiliar vocabulary, low-literacy use, contradictory/partial answers, and unassessable audio. Ground questions/facts in the actual source, and require exact answer evidence for matched outcomes.

Use approved synthetic recordings and independent native-language reviewers before real-worker use. Machine schema checks or an LLM grading itself are insufficient evidence of linguistic correctness. Research and record workable quality criteria before scoring. Avoid unsupported claims of comprehension or safe work.

Complete a bounded live synthetic provider rehearsal after authorization, recording request counts/costs without private content in logs. Unverified services or languages remain unavailable, not labelled supported. If the user approves a narrower release, enforce that scope in runtime, audience admission, marketing, and documentation while preserving the full-scope backlog.

## 6. Verify actual email and push delivery

After approved service configuration, test email verification, staff invitation, recovery, expiry, reuse denial, disabled accounts, delivery failure, retry, and source-of-truth receipts on controlled test inboxes. Confirm the sending domain and chosen email authentication setup using current provider guidance. No real customer contact is authorized by test preparation alone.

For push, use controlled consenting test users/devices and correct production-like HTTPS/service-worker configuration. Exercise at least supported Android and iPhone browser/PWA flows using current documented platform prerequisites, plus desktop.

Verify permission granted/denied, unsupported behavior, foreground/background/closed app, visible generic notification, notification click requiring authentication, subscription expiry/refusal, endpoint reassignment, logout, shared-device switch, worker disable/deletion, restore quarantine, and revoked sessions. No previous worker's private data or notifications may leak to a new device user.

Exercise worker instruction/follow-up/repeat/language-decision/reminder events and supervisor help/clarification/language-request/partial-send alerts. Preserve deduplication and do not issue success based only on push-service acceptance. Where the browser/device gives no guarantee, state the limitation and keep the in-app inbox operational.

Real-device checks unavailable to the execution environment require a concise human test script and pending gate. Do not label emulation or a mocked endpoint as physical-device acceptance.

## 7. Security, accessibility, and physical-device review

Review and fix authorization/IDOR across companies, sites, teams, account switching, HR limits, worker passwords/resets, verification, push bindings, native audio/download GETs, exports, private notes, and operator separation. Test brute force/rate limits, session fixation/revocation, CSRF/origin/context fences, injection/XSS/CSV safety, upload parsing/limits, URL/endpoint SSRF controls, secret handling, and sensitive logging.

Check all direct endpoints and background jobs, not only visible buttons. Test trial read-only and manual activation bypass attempts, concurrent capacity writes, tampered question/media modes, translated-history access after deletion, and receipt ownership.

Run dependency/secret/build-asset scans and document findings. Obtain a separate qualified security assessment; another local scan or the implementing agent's self-review is not independent certification. Remediate material findings and retain retest evidence.

Reverify staff Arabic, workers in all selectable locale/script paths, 320px/reflow/zoom, mixed-direction text, keyboard/focus, screen readers, contrast, reduced motion, touch, dialogs, soft keyboard, microphone denial/interruption, playback, offline/unsent work, and shared-device handoff. Exercise physical recordings and notification clicks. Have independent accessibility/native-language reviewers assess relevant workflows. Do not equate a few zero-overflow screenshots with complete acceptance.

## 8. Hosting, capacity, operations, and recovery

No production compute host is currently established by the reviewed deployment target. Confirm an approved host, region, domain/DNS ownership, budget, database/storage plan and quota headroom, email/push/provider accounts, and operator origin. Neon Free is the recorded database/storage choice, not proof that compute is free or production capacity is adequate. Do not automatically upgrade or provision paid services.

Verify intended customer counts, 25-worker trials, audio sizes, simultaneous sends/responses, translated-history generation, worker throughput, queue backlog, and browser responsiveness against explicit agreed service objectives. Record baseline/peak/recovery load with synthetic data, stop conditions, budget, and limits. Passing 1,483 tests is not a load test.

Prepare actual deployment topology, minimal database/service identities, secret management, HTTPS/TLS renewal, strict reverse-proxy overwrite and network isolation, private buckets, public-shell cache behavior, rolling assets, migrations and compatible code rollback. Test provider/database/storage failure, connection exhaustion, cold starts, retry storms, process kills, and quota exhaustion without losing accepted work or duplicating sends.

Implement operational health and external monitoring for API, worker heartbeat, queue age/stuck work, provider errors/cost reservations, mail/push failures, storage availability/integrity, database capacity, trial/activation expiry, and backup freshness. Logs must avoid worker content and secrets. Demonstrate at least one safe alert reaching the authorized operator and one incident/recovery drill; documentation alone is not observed monitoring.

Define recovery point/time objectives and retention with the operator. Automate encrypted backups, separated key custody, retention/restore reconciliation, and scheduled restoration drills. Measure actual restoration time and loss window using isolated targets. Write release, rollback, incident, key rotation, account recovery, abuse, privacy/deletion, and operator activation runbooks.

## 9. Staging, final verification, and launch boundary

Prepare a concrete staging plan first, including host/region, estimated costs, data class, recipients/devices, exact resources, secrets supplied privately, and cleanup/rollback. Carry out all authorized local preparation before seeking approval for the external action. Do not pause all engineering because one service decision is missing; group missing choices and continue independent work.

After staging authorization, run the actual deployed combined system over HTTPS with approved synthetic data, actual database roles/storage, worker, email, and push. Execute the complete owner/HR/supervisor/worker journey: signup, setup/reset, language approval/history, question and acknowledgment modes, media modes, partial send, answer assessment, help, repeat, resolution, notification click, read-only expiry, and operator activation.

Rerun appropriate focused tests after fixes, then the integrated suite/typecheck/build/evaluations for the exact release snapshot. Use the real native prerequisites; all release-critical skips must be resolved or remain explicit no-go blockers. Capture full stdout/stderr logs and exit codes, build/source/migration fingerprints, browser/device environments, and actual results. Existing warnings need impact assessment; do not silence them just for a clean summary.

Do not repeat a 45-minute suite without new changes or unresolved reasons. Provide durable checkpoints before long runs and maintain useful progress communication. Test evidence becomes stale when relevant source/config/schema changes; rerun affected checks and bind final acceptance to the final artifacts.

Only after the release candidate and gate evidence are concrete should you request production rollout authorization, identifying scope, accounts, data, costs, migration/backup, rollback, monitoring, and operator responsibility. This prompt itself does not authorize deployment or real customer processing. If authorization is absent, deliver the prepared release and exact approval request without pretending launch happened.

After authorized deployment, perform production smoke checks on synthetic control accounts before customer onboarding. Roll back or pause admission if required checks fail. Never onboard real workers before applicable provider/privacy/security and deployment approval.

## 10. Required handoff and truthfulness

Deliver:

1. Updated production gate matrix with passed/failed/pending status, exact scope, owners, and evidence.
2. Changes and migrations made, tests run and actual outcomes, resource changes, and preserved data notes.
3. Native current-schema PostgreSQL and backup/restore evidence, plus deployed transport/role/pooling evidence where approved.
4. Per-language/provider/real-data approval and quality matrix.
5. Real email/push/device results and remaining platform limitations.
6. Independent security/accessibility findings and remediation/retest status.
7. Capacity, monitoring, backup/restore, incident, rollback, and manual-activation evidence/runbooks.
8. Exact release candidate fingerprint, deployment plan, authorized scope, and remaining approvals.
9. A clear **GO for the explicitly approved scope** or **NO-GO with concrete blockers**. Do not collapse locally implemented, synthetically verified, staging verified, privacy approved, and deployed into one Done label.

Update BUILD_STATUS.md and READINESS.md so the newest state is unambiguous. Do not overwrite historical evidence, replace a failure with a percentage, report skipped/blocked/unavailable work as passed, or fabricate reviews/provider calls/device checks.

Start by auditing the baseline and opening the gate matrix. Then complete all work available within current authorization. Ask for only genuinely missing decisions/access, with a concrete explanation and a reviewable next action. Production readiness must be earned through verified gates, not asserted by the wording of this prompt.
